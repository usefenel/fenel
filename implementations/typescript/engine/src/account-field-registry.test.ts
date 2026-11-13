import { describe, expect, test } from "bun:test";
import type { FieldPersistenceSnapshot } from "./field-authoring";
import { getEntityTypeByName } from "./type-catalog";
import type { FenelFunction, FenelModule, FenelType } from "./types";
import { fieldDefinitionSnapshotFromJsonWire, fieldDefinitionSnapshotToJsonWire } from "./authoring/expression-json";
import { fieldPersistenceSnapshotMatches, planFieldPersistence } from "./field-authoring";
import {
  createAccountFieldRegistry,
  projectAccountFieldRegistrySnapshot,
  createLocalFieldRegistry,
  projectLocalFieldRegistrySnapshot,
} from "./account-field-registry";
import { createAccountRegistry } from "./repository-registry";
import { userFunctionsAsModule } from "./account-registries";
import { loadFenelModule } from "./fenel-module";
import { evaluate } from "./json-logic";
import { buildAuthoringCatalogSnapshot, rankAuthoringFunctionSuggestions } from "./authoring/environment";

const LIVE = "0f6aeb3a-d11c-4a1b-aadf-a6e32c674620";
// F0 (2026-11-01): a Local definition id is a UUID (its name is a Codeable), so
// the fixtures that also build Local registries use UUID ids.
const SAVED_RESULT = "5a7ed0e5-0000-4000-8000-000000000001";
const SAVED_LIFT = "5a7ed0e5-0000-4000-8000-000000000002";
const SAVED_MAYBE = "5a7ed0e5-0000-4000-8000-000000000003";
const TAB_ARTICLE = "5a7ed0e5-0000-4000-8000-000000000004";
const TAB_LEGACY_BOX = "5a7ed0e5-0000-4000-8000-000000000005";
const TAB_LEGACY_PROBE = "5a7ed0e5-0000-4000-8000-000000000006";
const DEAD = "f0aa2128-e567-47bc-96dd-6dd76df7af12";
const Nothing = { $tag: "Nothing" } as const;

describe("saved function signature ingress", () => {
  const fn = (): FenelFunction => ({ id: SAVED_RESULT, params: [], returns: { $ref: "String" }, body: 42,
    signatureDeclaration: { functionId: SAVED_RESULT, declarationName: "savedResult", codeName: "savedResult",
      params: [], returns: { $tag: "Absent" } } });
  const ownerSnapshot = (definition: FenelFunction): FieldPersistenceSnapshot => ({ owners: [{
    ownerKey: `function:${definition.id}`, kind: "function", storageName: definition.id, definition,
  }], fields: [], facets: [] });

  test("account and This infer from saved input after JSON and retain the input mode", () => {
    const reopened = fieldDefinitionSnapshotFromJsonWire(JSON.parse(JSON.stringify(fieldDefinitionSnapshotToJsonWire(ownerSnapshot(fn())))));
    for (const registry of [createAccountFieldRegistry([], "account-signature", reopened), createLocalFieldRegistry([], "tab-signature", reopened)]) {
      const info = registry.getFunctionSignatureInfo(SAVED_RESULT)!;
      expect(info.outcome.$tag).toBe("Solved");
      expect(info.returns.$tag).toBe("Inferred");
      expect(registry.getFunction(SAVED_RESULT)?.returns).not.toEqual({ $ref: "String" });
      expect(registry.getFunction(SAVED_RESULT)?.signatureDeclaration?.returns).toEqual({ $tag: "Absent" });
    }
    expect(reopened.owners[0]!.definition).toEqual(fn());
  }, 60_000);

  test("declaration-only edits participate in the existing atomic plan and freshness comparison", () => {
    const current = ownerSnapshot(fn());
    const explicit = fn();
    explicit.signatureDeclaration = { ...explicit.signatureDeclaration!, returns: {
      $tag: "Authored", source: { $tag: "HostSpec", module: "saved-editor" },
    } };
    const desired = ownerSnapshot(explicit);
    expect(fieldPersistenceSnapshotMatches(current, desired)).toBe(false);
    const plan = planFieldPersistence({ currentOwners: current.owners, currentFields: [], currentFacets: [],
      ownerMutations: [{ kind: "upsert", owner: desired.owners[0]! }] });
    expect(plan.ownerUpserts).toHaveLength(1);
    expect(plan.snapshot.owners[0]!.definition).toEqual(explicit);
  }, 60_000);

  test("mismatched declaration owners and forged inferred ingress refuse", () => {
    const mismatched = fn();
    mismatched.signatureDeclaration = { ...mismatched.signatureDeclaration!, functionId: "other" };
    expect(() => projectAccountFieldRegistrySnapshot("account-signature", ownerSnapshot(mismatched))).toThrow("exact saved function");
    const forged = fn();
    forged.signatureDeclaration = { ...forged.signatureDeclaration!, returns: {
      $tag: "Inferred", engine: "caller", version: "1", derivation: {},
    } };
    expect(() => createLocalFieldRegistry([], "tab-signature", ownerSnapshot(forged))).toThrow("input declarations cannot contain inferred slots");
    let reads = 0;
    const accessor = fn();
    Object.defineProperty(accessor, "signatureDeclaration", { enumerable: true, get() { reads++; return {}; } });
    expect(() => projectLocalFieldRegistrySnapshot("tab-signature", ownerSnapshot(accessor))).toThrow("own data");
    expect(reads).toBe(0);
  }, 60_000);
});

const LOCAL_COUNTER = "f7c9121e-46d8-4115-bab7-3453a15c4b90";
function localConstructorSnapshot(fieldType: FenelType): FieldPersistenceSnapshot {
  return {
    owners: [{ ownerKey: `type:${LOCAL_COUNTER}`, kind: "type", storageName: LOCAL_COUNTER,
      definition: { id: LOCAL_COUNTER, type: { $record: { fields: [{
        name: "count", key: { $tag: "NamedField", ref: { $ref: LIVE } }, type: fieldType,
        label: Nothing, ui: Nothing, meta: {},
      }] } } } }],
    fields: [{ id: LIVE, currentCodeName: "count", status: "live", realm: "account", reuseVisibility: "owner" }],
    facets: [],
  };
}

describe("authored local type constructor schemes", () => {
  test("saved source type applications retain kind and arity fences", () => {
    const source = loadFenelModule("SavedLift f a = Lift f<a>", "saved_type_fixture");
    const entity = source.entities?.find(row => row.id === "SavedLift");
    if (!entity?.typeScheme?.applications?.length) throw new Error("Expected source-owned kinded application");
    // The parsed scheme names its binders after the source name; the saved
    // Local owner's id is a UUID, so its binders are re-keyed to it.
    const rekey = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('"SavedLift:', `"${SAVED_LIFT}:`)
      .replaceAll('"SavedLift"', `"${SAVED_LIFT}"`)) as T;
    const definition = rekey({ id: entity.id, type: entity.type, params: entity.params, typeScheme: entity.typeScheme });
    const snapshotFor = (typeScheme = entity.typeScheme): FieldPersistenceSnapshot => ({ owners: [{
      ownerKey: `type:${definition.id}`, kind: "type", storageName: definition.id,
      definition: { ...definition, type: typeScheme!.body, typeScheme },
    }], fields: [], facets: [] });
    const valid = createLocalFieldRegistry([], "source-kind-valid", snapshotFor(definition.typeScheme));
    expect(valid.listConstructorSignatures().find(row => row.ownerName === SAVED_LIFT)?.outcome.$tag).toBe("Solved");
    const malformed = structuredClone(definition.typeScheme!);
    const applications = malformed.applications!.map(application => ({ ...application, kind: { $tag: "KType" as const } }));
    const invalid = createLocalFieldRegistry([], "source-kind-invalid", snapshotFor({ ...malformed, applications }));
    const constructor = invalid.listConstructorSignatures().find(row => row.ownerName === SAVED_LIFT);
    expect(constructor?.outcome.$tag).not.toBe("Solved");
    expect(constructor?.scheme).toBeUndefined();
  }, 120_000);

  test("saved generic type owner retains its binder and constructor scheme in account and This", () => {
    const body: FenelType = { $variant: { cases: [{ name: "Present", label: Nothing, fields: [{
      name: "_0", key: { $tag: "PositionalField", index: 0 }, type: { $var: "a" }, label: Nothing, ui: Nothing, meta: {},
    }] }] } };
    const source: FieldPersistenceSnapshot = { owners: [{ ownerKey: `type:${SAVED_MAYBE}`, kind: "type", storageName: SAVED_MAYBE,
      definition: { id: SAVED_MAYBE, type: body, params: ["a"], typeScheme: {
        quantified: [{ id: `${SAVED_MAYBE}:a`, sourceName: "a", kind: { $tag: "KType" } }], body,
      } } }], fields: [], facets: [] };
    const reopened = fieldDefinitionSnapshotFromJsonWire(JSON.parse(JSON.stringify(fieldDefinitionSnapshotToJsonWire(source))));
    for (const registry of [createAccountFieldRegistry([], "account-generic", reopened), createLocalFieldRegistry([], "tab-generic", reopened)]) {
      const owner = registry.getIdentifiedEntity(SAVED_MAYBE);
      expect(owner?.params).toEqual(["a"]);
      expect(owner?.typeScheme?.quantified).toEqual([{ id: `${SAVED_MAYBE}:a`, sourceName: "a", kind: { $tag: "KType" } }]);
      const constructor = registry.listConstructorSignatures().find(row => row.ownerName === SAVED_MAYBE && row.name === "Present");
      expect(constructor?.outcome.$tag).toBe("Solved");
      expect(constructor?.scheme?.quantified[0]?.sourceName).toBe("a");
    }
  }, 60_000);

  test("a checked UUID record supplies its nominal constructor through the canonical authoring catalog", () => {
    const source = localConstructorSnapshot({ $ref: "Number" });
    const registry = createLocalFieldRegistry([], "tab-counter", source);
    const entity = registry.getIdentifiedEntity(LOCAL_COUNTER);
    expect(entity?.typeScheme?.quantified).toEqual([]);
    expect(entity?.typeScheme?.body).toBe(entity?.type);
    const constructors = registry.listConstructorSignatures().filter(row => row.ownerName === LOCAL_COUNTER);
    expect(constructors).toHaveLength(1);
    const constructor = constructors[0]!;
    expect(constructor.outcome.$tag).toBe("Solved");
    expect(constructor.params[0]?.key).toEqual({ $tag: "NamedField", ref: { $ref: LIVE } });
    expect(constructor.returns).toEqual({ $ref: LOCAL_COUNTER });
    const catalog = buildAuthoringCatalogSnapshot([], { registry });
    const entries = catalog.functions.filter(row => row.parentEntity === LOCAL_COUNTER);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetId).toBe(constructor.targetId);
    expect(rankAuthoringFunctionSuggestions(entries, { $ref: LOCAL_COUNTER }, { registry })[0]?.match).toBe("direct");
    expect(evaluate({ construct: [constructor.targetId, { count: 42 }] }, {}, registry.evaluateContext()))
      .toEqual({ $tag: LOCAL_COUNTER, count: 42 });
    expect(getEntityTypeByName(LOCAL_COUNTER)).toBeUndefined();
  }, 180_000);

  for (const [name, fieldType] of [
    ["unbound variable", { $var: "a" }],
    ["dependent application without a sidecar", { $el: { call: ["List", { $ref: "Number" }] } }],
  ] as const) test(`${name} retains the existing constructor annotation fence`, () => {
    const registry = createLocalFieldRegistry([], "tab-counter-fence", localConstructorSnapshot(fieldType as FenelType));
    const constructors = registry.listConstructorSignatures().filter(row => row.ownerName === LOCAL_COUNTER);
    expect(constructors).toHaveLength(1);
    expect(constructors[0]?.outcome.$tag).toBe("AnnotationRequired");
    const catalog = buildAuthoringCatalogSnapshot([], { registry });
    const entries = catalog.functions.filter(row => row.parentEntity === LOCAL_COUNTER);
    expect(rankAuthoringFunctionSuggestions(entries, { $ref: LOCAL_COUNTER }, { registry })[0]?.match).toBe("unavailable");
  }, 180_000);
});

function snapshot(): FieldPersistenceSnapshot {
  return {
    owners: [{
      ownerKey: "type:article",
      kind: "type",
      storageName: "article",
      definition: {
        id: "article",
        type: {
          $record: {
            fields: [{
              name: "title",
              key: { $tag: "NamedField", ref: { $ref: LIVE } },
              type: { $ref: "String" },
              label: { $tag: "Nothing" },
              ui: { $tag: "Nothing" },
              meta: {},
            }],
          },
        },
      },
    }],
    fields: [
      {
        id: LIVE,
        currentCodeName: "title",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      },
      {
        id: DEAD,
        currentCodeName: "retiredTitle",
        status: "tombstoned",
        realm: "account",
        reuseVisibility: "account",
      },
    ],
    facets: [
      {
        fieldId: LIVE,
        typeName: "Codeable",
        methods: { codeName: "title" },
        scope: "account",
        priority: 100,
      },
      {
        fieldId: LIVE,
        typeName: "Labelable",
        methods: { label: "Account title" },
        scope: "account",
        priority: 100,
      },
      {
        fieldId: LIVE,
        typeName: "Displayable",
        methods: { hint: { widget: "account-text" } },
        scope: "account",
        priority: 100,
      },
      {
        fieldId: DEAD,
        typeName: "Labelable",
        methods: { label: "Must not hydrate" },
        scope: "account",
        priority: 100,
      },
    ],
  };
}

const ACCOUNT_LOCAL_TYPE = "Phase2bAccountScopedCollision_7f3e6d";

function typeOnlySnapshot(type: FenelType): FieldPersistenceSnapshot {
  return {
    owners: [{
      ownerKey: `type:${ACCOUNT_LOCAL_TYPE}`,
      kind: "type",
      storageName: ACCOUNT_LOCAL_TYPE,
      definition: { id: ACCOUNT_LOCAL_TYPE, type },
    }],
    fields: [],
    facets: [],
  };
}

function legacyStaleBodySnapshot(): FieldPersistenceSnapshot {
  const fieldId = "cc4f8506-e003-48bc-a613-e726b5afd131";
  return {
    owners: [
      {
        ownerKey: "type:legacy-box",
        kind: "type",
        storageName: "legacy-box",
        definition: {
          id: "LegacyAccountBox",
          type: {
            $variant: {
              cases: [{
                name: "LegacyAccountBoxed",
                label: Nothing,
                fields: [{
                  name: "payload",
                  key: { $tag: "NamedField", ref: { $ref: fieldId } },
                  type: { $ref: "String" },
                  label: Nothing,
                  ui: Nothing,
                  meta: {},
                }],
              }],
            },
          },
        },
      },
      {
        ownerKey: "function:legacy-probe",
        kind: "function",
        storageName: "legacy-probe",
        definition: {
          id: "legacy-probe",
          params: [],
          returns: { $ref: "String" },
          body: {
            match: [
              { var: "box" },
              { $tag: "LegacyAccountBoxed", oldPayload: { $bind: "value" } },
              { var: "value" },
            ],
          },
        },
      },
    ],
    fields: [{
      id: fieldId,
      currentCodeName: "payload",
      status: "live",
      realm: "account",
      reuseVisibility: "account",
    }],
    facets: [],
  };
}

describe("committed account field registry", () => {
  test("projects live external fields/facets while reserving tombstones", () => {
    const projected = projectAccountFieldRegistrySnapshot("acct/one", snapshot());
    expect(projected.ownerModules).toHaveLength(1);
    expect(projected.ownerModules[0]?.name).toContain("acct%2Fone");
    expect(projected.ownerModules[0]?.name).not.toContain(":");
    expect(Object.hasOwn(projected.ownerModules[0]!, "functionNamespace")).toBe(false);
    expect(projectAccountFieldRegistrySnapshot("acct/one", snapshot()).ownerModules[0]?.name)
      .toBe(projected.ownerModules[0]?.name);

    const leftSource = snapshot();
    const left = {
      ...leftSource,
      owners: [{ ...leftSource.owners[0]!, ownerKey: "b:c" }],
    };
    const rightSource = snapshot();
    const right = {
      ...rightSource,
      owners: [{ ...rightSource.owners[0]!, ownerKey: "c" }],
    };
    expect(projectAccountFieldRegistrySnapshot("a", left).ownerModules[0]?.name)
      .not.toBe(projectAccountFieldRegistrySnapshot("a:b", right).ownerModules[0]?.name);

    const collisionAccount = "collision-account";
    const collisionSource = snapshot();
    const collisionBase = projectAccountFieldRegistrySnapshot(
      collisionAccount,
      collisionSource,
    ).ownerModules[0]!.name;
    const collisionId = `${collisionBase}:invented-member`;
    const collisionOwner = collisionSource.owners[0]!;
    if (collisionOwner.kind !== "type") throw new Error("expected type owner fixture");
    const collidingSnapshot: FieldPersistenceSnapshot = {
      ...collisionSource,
      owners: [{
        ...collisionOwner,
        definition: {
          ...collisionOwner.definition,
          id: collisionId,
        },
      }],
    };
    const collisionModule = projectAccountFieldRegistrySnapshot(
      collisionAccount,
      collidingSnapshot,
    ).ownerModules[0]!;
    expect(collisionModule.name).not.toBe(collisionBase);
    expect(collisionId.startsWith(`${collisionModule.name}:`)).toBe(false);
    expect(projected.externalFields.map((field) => field.id)).toEqual([LIVE]);
    expect([...projected.identityKinds]).toEqual([
      [LIVE, "field"],
      [DEAD, "field"],
    ]);
    expect(projected.fieldRepresentations.map((facet) => facet.args[0])).toEqual([
      LIVE,
      LIVE,
      LIVE,
    ]);
  });

  test("builds an identified, registry-local account presentation", () => {
    const source = snapshot();
    const first = createAccountFieldRegistry([], "acct", source);
    const second = createAccountFieldRegistry([], "acct", source);
    const entity = first.getIdentifiedEntity("article");
    const field = entity?.type && "$record" in entity.type
      ? entity.type.$record.fields[0]
      : undefined;
    expect(field?.key).toEqual({ $tag: "NamedField", ref: { $ref: LIVE } });
    expect(first.resolveFieldPresentation(LIVE).label).toBe("Account title");
    expect(first.getFieldRepresentation("Labelable", DEAD, "account")).toBeUndefined();

    const firstFacet = first.getFieldRepresentation("Labelable", LIVE, "account");
    const secondFacet = second.getFieldRepresentation("Labelable", LIVE, "account");
    expect(firstFacet).toBeDefined();
    expect(secondFacet).toBeDefined();
    expect(firstFacet).not.toBe(secondFacet);
    firstFacet!.methods.label = "local mutation";
    expect(second.resolveFieldPresentation(LIVE).label).toBe("Account title");

    const sourceDisplay = source.facets.find((facet) => facet.typeName === "Displayable")!;
    const sourceHint = sourceDisplay.methods.hint as { widget: string };
    sourceHint.widget = "caller mutation";
    expect(first.resolveFieldPresentation(LIVE).display).toEqual({ widget: "account-text" });
    expect(second.resolveFieldPresentation(LIVE).display).toEqual({ widget: "account-text" });

    const firstDisplay = first.getFieldRepresentation("Displayable", LIVE, "account")!;
    (firstDisplay.methods.hint as { widget: string }).widget = "registry-one mutation";
    expect(second.resolveFieldPresentation(LIVE).display).toEqual({ widget: "account-text" });
  }, 600_000);

  test("keeps same-named account types out of the process-global catalog", () => {
    expect(getEntityTypeByName(ACCOUNT_LOCAL_TYPE)).toBeUndefined();

    const firstType = { $ref: "String" } as const;
    const secondType = { $ref: "Number" } as const;
    const first = createAccountFieldRegistry([], "account-one", typeOnlySnapshot(firstType));
    const second = createAccountFieldRegistry([], "account-two", typeOnlySnapshot(secondType));

    expect(first.getIdentifiedEntity(ACCOUNT_LOCAL_TYPE)?.type).toEqual(firstType);
    expect(second.getIdentifiedEntity(ACCOUNT_LOCAL_TYPE)?.type).toEqual(secondType);
    expect(getEntityTypeByName(ACCOUNT_LOCAL_TYPE)).toBeUndefined();
  }, 600_000);

  test("defers stale bodies only for committed legacy DB hydration", () => {
    const committed = legacyStaleBodySnapshot();
    const legacyRegistry = createAccountFieldRegistry([], "legacy-account", committed);
    expect(legacyRegistry.evaluateContext()._strictPatternFields).toBe(false);
    const legacyProbe = legacyRegistry.getFunction("legacy-probe");
    expect(legacyProbe?.body).toBeDefined();
    expect(evaluate(
      legacyProbe!.body!,
      { box: { $tag: "LegacyAccountBoxed", oldPayload: "legacy value" } },
      legacyRegistry.evaluateContext(),
    )).toBe("legacy value");
    expect(() => createAccountFieldRegistry([], "legacy-account", committed, {
      bodySpellingPolicy: "reject",
    })).toThrow(/UnresolvedFieldSpelling|unresolved constructor-pattern field spelling/);
    const staleRepositorySource: FenelModule = {
      name: "phase4b-repository-stale-body",
      label: "Phase 4b repository stale body",
      functions: [{
        id: "phase4b-repository-stale-body:probe",
        params: [],
        returns: { $ref: "String" },
        body: {
          match: [
            { var: "box" },
            { $tag: "LegacyAccountBoxed", oldPayload: { $bind: "value" } },
            { var: "value" },
          ],
        },
      }],
    };
    expect(() => createAccountFieldRegistry(
      [staleRepositorySource],
      "legacy-account",
      committed,
    )).toThrow(/UnresolvedFieldSpelling|unresolved constructor-pattern field spelling/);

    // Both registries share the exact module identities/cache key. A deferred
    // proof must not prime the reject posture's body-spelling memo entry.
    const memoAccountModule: FenelModule = {
      name: "phase4b-account-body-memo",
      label: "Phase 4b account body memo",
      functions: [{
        id: "phase4b-account-body-memo:probe",
        params: [],
        returns: { $ref: "String" },
        body: {
          match: [
            { var: "maybe" },
            { $tag: "Just", oldValue: { $bind: "value" } },
            { var: "value" },
          ],
        },
      }],
    };
    expect(() => createAccountRegistry([], [memoAccountModule], {
      bodySpellingPolicy: "defer-legacy-db",
    })).not.toThrow();
    expect(() => createAccountRegistry([], [memoAccountModule], {
      bodySpellingPolicy: "reject",
    })).toThrow(/UnresolvedFieldSpelling|unresolved constructor-pattern field spelling/);
  }, 900_000);

  test("keeps persisted exact function ids callable without inventing namespace ownership", () => {
    const accountId = "acct:with:delimiter";
    const baseName = userFunctionsAsModule(accountId, []).name;
    const exactId = `${baseName}:probe`;
    const module = userFunctionsAsModule(accountId, [{
      id: exactId,
      params: [],
      returns: { $ref: "String" },
      body: "ok",
    }]);
    expect(module.name).not.toContain(":");
    expect(module.name).not.toBe(baseName);
    expect(exactId.startsWith(`${module.name}:`)).toBe(false);
    expect(Object.hasOwn(module, "functionNamespace")).toBe(false);

    const registry = createAccountRegistry([], [module]);
    expect(registry.getFunction(exactId)?.id).toBe(exactId);
    expect(registry.listModuleMembers(module.name)).toEqual([]);
  }, 600_000);
});

describe("tab-local definition registry", () => {
  test("retains explicit UUID fields and private facets without account scope or global publication", () => {
    const source = snapshot();
    const owner = source.owners[0]!;
    if (owner.kind !== "type") throw new Error("expected type owner");
    const localName = TAB_ARTICLE;
    const local = { ...source, owners: [{ ...owner, definition: { ...owner.definition, id: localName } }] };
    const projected = projectLocalFieldRegistrySnapshot("tab-one", local);
    expect(projected.ownerModules[0]!.name.startsWith("local-owner-")).toBe(true);
    expect(projected.fieldRepresentations.every(facet => facet.scope === undefined)).toBe(true);
    expect(getEntityTypeByName(localName)).toBeUndefined();
    const first = createLocalFieldRegistry([], "tab-one", local);
    const second = createLocalFieldRegistry([], "tab-two", local);
    expect(first.getFieldIdentityByHandle(LIVE)?.realm).toBe("transient-draft");
    expect(first.resolveFieldPresentation(LIVE).label).toBe("Account title");
    expect(first.getFieldRepresentation("Labelable", DEAD)).toBeUndefined();
    expect(first.getFieldRepresentation("Labelable", LIVE, "account")).toBeUndefined();
    expect(getEntityTypeByName(localName)).toBeUndefined();
    first.getFieldRepresentation("Labelable", LIVE)!.methods.label = "Changed in one tab";
    expect(second.resolveFieldPresentation(LIVE).label).toBe("Account title");
  }, 600_000);

  for (const spelling of ["implicit", "uuid-name", "source-handle"] as const) {
    test(`refuses ${spelling} fields at the strict tab boundary`, () => {
      const source = snapshot();
      const owner = source.owners[0]!;
      if (owner.kind !== "type" || !("$record" in owner.definition.type)) throw new Error("expected record owner");
      const field = { ...owner.definition.type.$record.fields[0]! };
      if (spelling === "source-handle") field.key = { $tag: "NamedField", ref: { $ref: "field:local/title" } };
      else { delete field.key; if (spelling === "uuid-name") field.name = LIVE; }
      const local = { ...source, owners: [{ ...owner, definition: { ...owner.definition, id: TAB_ARTICLE,
        type: { $record: { fields: [field] } } } }] };
      expect(() => createLocalFieldRegistry([], "tab-rejected", local)).toThrow(/strict transient.*explicit/);
    }, 600_000);
  }

  test("retains strict named body checks for transient definitions", () => {
    // The Local copy of the legacy snapshot carries UUID ids (F0).
    const legacy = legacyStaleBodySnapshot();
    const local = { ...legacy, owners: legacy.owners.map(owner => ({ ...owner,
      definition: { ...owner.definition, id: owner.kind === "type" ? TAB_LEGACY_BOX : TAB_LEGACY_PROBE } })) } as FieldPersistenceSnapshot;
    expect(() => createLocalFieldRegistry([], "tab-body", local))
      .toThrow(/UnresolvedFieldSpelling|unresolved constructor-pattern field spelling/);
  }, 600_000);
});
