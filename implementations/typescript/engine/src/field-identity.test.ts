// field-identity Phase 1 — additive identity oracles.
//
// Controlled definitions + controlled locks keep UUID assertions stable. The
// real-roster test checks injectivity/shape only; it never snapshots generated
// UUIDs or depends on the global lock's particular values.

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  collectFieldIdentities as collectFieldIdentitiesKernel,
  fieldPath,
  fieldLockRequirements,
  fieldOwnerForEntity,
  fieldOwnerForFunction,
  identifiedDefinitionView,
  normalizeFieldDeclarations,
  qualifiedFieldName,
} from "./field-identity";
import { createRegistry } from "./registry";
import { repositoryIdentityLock } from "./repository-identity-manifest";
import { specEntities } from "./system-entities";
import type {
  FenelFunction,
  FenelModule,
  FenelType,
  FieldDef,
  FieldKey,
  FunctionSignatureDeclaration,
} from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };

function field(name: string, key?: FieldKey, type: FenelType = StringT): FieldDef {
  return {
    name,
    ...(key ? { key } : {}),
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

const UUID_A = "10000000-0000-4000-8000-000000000001";
const UUID_B = "10000000-0000-4000-8000-000000000002";
const UUID_C = "10000000-0000-4000-8000-000000000003";

function legacyOwner(owner: ReturnType<typeof fieldOwnerForEntity> | ReturnType<typeof fieldOwnerForFunction>): string {
  switch (owner.$tag) {
    case "TypeFieldOwner": {
      const local = owner.module.$tag === "Just"
        ? `${owner.module._0}:${owner.localId}`
        : owner.localId;
      return `type:${local}`;
    }
    case "FunctionFieldOwner": return `function:${owner.id}`;
    case "InlineNominalFieldOwner": return `type:inline:${legacyOwner(owner.parent)}:${owner.name}`;
  }
}

function legacyPath(segment: Parameters<typeof qualifiedFieldName>[1][number]): string {
  switch (segment.$tag) {
    case "FieldNamed": return `named:${segment.name}`;
    case "FieldPosition": return `position:${segment.index}`;
    case "FieldCase": return `case:${segment.name}`;
    case "FieldArrowReturn": return "arrow-return";
    case "FieldTuple": return `tuple:${segment.index}`;
    case "FieldTypeArg": return `type-arg:${segment.index}`;
    case "FieldMapValue": return "map-value";
    case "FieldRefinedBase": return "refined-base";
    case "FieldUnion": return `union:${segment.index}`;
    case "FieldIntersect": return `intersect:${segment.index}`;
    case "FieldComplement": return "complement";
    case "FieldTaggedValue": return "tagged-value";
    case "FieldTaggedPhantom": return "tagged-phantom";
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : canonicalize(item));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) out[key] = canonicalize(item);
  }
  return out;
}

/** Phase-1 snapshot view. Phase 2a deliberately makes parser-origin positional
 * keys explicit inside nested occurrence types; Phase 1 had no such property.
 * Strip only that approved additive marker before comparing the frozen corpus. */
function phase1OccurrenceType(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(phase1OccurrenceType);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (
      key === "key" &&
      item !== null &&
      typeof item === "object" &&
      (item as { $tag?: string }).$tag === "PositionalField"
    ) continue;
    out[key] = phase1OccurrenceType(item);
  }
  return out;
}

function collectFieldIdentities(
  entities: Parameters<typeof collectFieldIdentitiesKernel>[0],
  functions: Parameters<typeof collectFieldIdentitiesKernel>[1],
  lock?: ReadonlyMap<string, string>,
) {
  return collectFieldIdentitiesKernel(
    entities,
    functions,
    lock === undefined
      ? {
          realm: "repository-source",
          mode: "collect-requirements",
        }
      : {
          realm: "repository-source",
          mode: "strict-embedded",
          lock,
        },
  );
}

describe("field-identity Phase 1 — explicit named/positional keys", () => {
  test("same local spelling in two constructor scopes gets two owner-qualified identities", () => {
    const type: FenelType = {
      $variant: {
        cases: [
          { name: "Left", label: Nothing, fields: [field("value")] },
          { name: "Right", label: Nothing, fields: [field("value")] },
        ],
      },
    };
    const owner = fieldOwnerForEntity({ id: "Eitherish", module: "demo" });
    const leftName = qualifiedFieldName(owner, [
      fieldPath.variantCase("Left"),
      fieldPath.named("value"),
    ]);
    const rightName = qualifiedFieldName(owner, [
      fieldPath.variantCase("Right"),
      fieldPath.named("value"),
    ]);
    const ids = collectFieldIdentities(
      [{ id: "Eitherish", module: "demo", type }],
      [],
      new Map([
        [leftName, UUID_A],
        [rightName, UUID_B],
      ]),
    );

    expect(ids.map((x) => x.qualifiedName)).toEqual([leftName, rightName].sort());
    expect(ids.map((x) => x.field.key)).toEqual([
      { $tag: "NamedField", ref: { $ref: UUID_A } },
      { $tag: "NamedField", ref: { $ref: UUID_B } },
    ]);
  });

  test("same qualified spelling on a type and function stays in disjoint owner namespaces", () => {
    const type = { $record: { fields: [field("x")] } } satisfies FenelType;
    const fn = { id: "demo:Same", params: [field("x")], returns: StringT };
    const ids = collectFieldIdentities(
      [{ id: "Same", module: "demo", type }],
      [fn],
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids.map((x) => JSON.stringify(x.owner)))).toEqual(
      new Set([
        JSON.stringify(fieldOwnerForEntity({ id: "Same", module: "demo" })),
        JSON.stringify(fieldOwnerForFunction(fn)),
      ]),
    );
    expect(new Set(ids.map((x) => x.qualifiedName)).size).toBe(2);
  });

  test("author names cannot collide with structural traversal path roles", () => {
    const nested = { $record: { fields: [field("x")] } } satisfies FenelType;
    const type: FenelType = {
      $arrow: {
        params: [field("_return", undefined, nested)],
        returns: { $arrow: { params: [field("x")], returns: StringT } },
      },
    };
    const owner = fieldOwnerForEntity({ id: "PathRoles", module: "demo" });
    const ids = collectFieldIdentities(
      [{ id: "PathRoles", module: "demo", type }],
      [],
    );

    expect(ids).toHaveLength(3);
    expect(new Set(ids.map((x) => x.qualifiedName))).toEqual(
      new Set([
        qualifiedFieldName(owner, [fieldPath.named("_return")]),
        qualifiedFieldName(owner, [
          fieldPath.named("_return"),
          fieldPath.named("x"),
        ]),
        qualifiedFieldName(owner, [fieldPath.arrowReturn, fieldPath.named("x")]),
      ]),
    );
  });

  test("positional identity uses occurrence order, not repeated _0 compatibility digits", () => {
    const fn = {
      id: "demo:curriedAnonymous",
      params: [field("_0"), field("_0")],
      returns: StringT,
    };
    const ids = collectFieldIdentities([], [fn]);
    expect(ids.map((x) => x.path)).toEqual([
      [fieldPath.position(0)],
      [fieldPath.position(1)],
    ]);
    expect(ids.map((x) => x.field.key)).toEqual([
      { $tag: "PositionalField", index: 0 },
      { $tag: "PositionalField", index: 1 },
    ]);
    expect(ids.every((identity) => identity.lockRequest === undefined)).toBe(true);
  });

  test("the _n namespace is reserved and non-canonical leading-zero spellings reject", () => {
    const canonical = collectFieldIdentities([], [{
      id: "demo:canonical-positional",
      params: [field("_0"), field("_12")],
      returns: StringT,
    }]);
    expect(canonical.map((identity) => identity.field.key)).toEqual([
      { $tag: "PositionalField", index: 0 },
      { $tag: "PositionalField", index: 1 },
    ]);
    expect(() => collectFieldIdentities([], [{
      id: "demo:bad-positional",
      params: [field("_00")],
      returns: StringT,
    }])).toThrow("non-canonical");
  });
});

describe("field-identity Phase 1 — adoption, reuse, and integrity", () => {
  test("a UUID-shaped legacy name is adopted exactly and requested as a preferred lock id", () => {
    const owner = fieldOwnerForEntity({ id: "LegacyUuid", module: "demo" });
    const type: FenelType = { $record: { fields: [field(UUID_A)] } };
    const ids = collectFieldIdentities([{ id: "LegacyUuid", module: "demo", type }], []);
    const expectedLockName = qualifiedFieldName(owner, [fieldPath.named(UUID_A)]);
    expect(ids).toHaveLength(1);
    expect(ids[0]!.field.name).toBe(UUID_A);
    expect(ids[0]!.field.key).toEqual({ $tag: "NamedField", ref: { $ref: UUID_A } });
    expect(ids[0]?.lockRequest).toEqual({ name: expectedLockName, preferredId: UUID_A });
  });

  test("a conflicting existing pin rejects instead of reminting or overwriting", () => {
    const owner = fieldOwnerForEntity({ id: "LegacyUuid", module: "demo" });
    const lockName = qualifiedFieldName(owner, [fieldPath.named(UUID_A)]);
    const type: FenelType = { $record: { fields: [field(UUID_A)] } };
    expect(() =>
      collectFieldIdentities(
        [{ id: "LegacyUuid", module: "demo", type }],
        [],
        new Map([[lockName, UUID_B]]),
      ),
    ).toThrow("preferred UUID conflict");
  });

  test("an ordinary named-field lock pin must be a UUID", () => {
    const owner = fieldOwnerForEntity({ id: "MalformedPin", module: "demo" });
    const lockName = qualifiedFieldName(owner, [fieldPath.named("value")]);
    const type: FenelType = { $record: { fields: [field("value")] } };
    expect(() =>
      collectFieldIdentities(
        [{ id: "MalformedPin", module: "demo", type }],
        [],
        new Map([[lockName, "not-a-uuid"]]),
      ),
    ).toThrow("is not a UUID");
  });

  test("an explicit NamedField UUID can be reused under one current name but not twice in one field list", () => {
    const reuse: FieldKey = { $tag: "NamedField", ref: { $ref: UUID_C } };
    const a: FenelType = { $record: { fields: [field("externalId", reuse)] } };
    const b: FenelType = { $record: { fields: [field("externalId", reuse)] } };
    const ids = collectFieldIdentities(
      [
        { id: "A", module: "demo", type: a },
        { id: "B", module: "demo", type: b },
      ],
      [],
    );
    expect(ids.map((x) => x.field.key)).toEqual([
      { $tag: "NamedField", ref: { $ref: UUID_C } },
      { $tag: "NamedField", ref: { $ref: UUID_C } },
    ]);
    expect(ids.filter((identity) => identity.preferredId === UUID_C)).toHaveLength(2);

    const conflictingName: FenelType = {
      $record: { fields: [field("id", reuse)] },
    };
    expect(() => collectFieldIdentities(
      [
        { id: "A", module: "demo", type: a },
        { id: "B", module: "demo", type: conflictingName },
      ],
      [],
    )).toThrow("two current Codeable names");

    const invalid: FenelType = {
      $record: { fields: [field("a", reuse), field("b", reuse)] },
    };
    expect(() =>
      collectFieldIdentities([{ id: "Bad", module: "demo", type: invalid }], []),
    ).toThrow("duplicate field identity");
  });

  test("a non-UUID explicit ref requires a live declaration or external field, not a lock tombstone", () => {
    const targetOwner = fieldOwnerForEntity({ id: "Target", module: "demo" });
    const targetHandle = qualifiedFieldName(targetOwner, [fieldPath.named("id")]);
    const reuse: FieldKey = { $tag: "NamedField", ref: { $ref: targetHandle } };
    const source: FenelType = { $record: { fields: [field("targetId", reuse)] } };

    expect(() =>
      collectFieldIdentities(
        [{ id: "Source", module: "demo", type: source }],
        [],
        new Map(),
      ),
    ).toThrow("unresolved explicit field ref");

    expect(() => collectFieldIdentities(
      [{ id: "Source", module: "demo", type: source }],
      [],
      new Map([[targetHandle, UUID_A]]),
    )).toThrow("lock row or is unresolved");

    const ids = collectFieldIdentitiesKernel(
      [{ id: "Source", module: "demo", type: source }],
      [],
      {
        realm: "repository-source",
        mode: "strict-embedded",
        lock: new Map([[targetHandle, UUID_A]]),
        externalFields: [{ id: UUID_A, currentCodeName: "targetId" }],
      },
    );
    expect(ids[0]!.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: UUID_A },
    });
    expect(ids[0]!.preferredId).toBe(UUID_A);

    const wrongKind: FieldKey = { $tag: "NamedField", ref: { $ref: "String" } };
    const invalid: FenelType = { $record: { fields: [field("x", wrongKind)] } };
    expect(() =>
      collectFieldIdentities([{ id: "BadRef", module: "demo", type: invalid }], []),
    ).toThrow("field handle or UUID");
  });

  test("whole repeated owner declarations dedupe only when identical", () => {
    const a: { id: string; module: string; type: FenelType } = {
      id: "Repeated",
      module: "demo",
      type: { $record: { fields: [field("a")] } },
    };
    const identical = collectFieldIdentities([a, a], []);
    expect(identical).toHaveLength(1);

    const conflicting = {
      id: "Repeated",
      module: "demo",
      type: { $record: { fields: [field("b")] } } satisfies FenelType,
    };
    expect(() => collectFieldIdentities([a, conflicting], [])).toThrow(
      "conflicting declarations",
    );

    const firstFn = { id: "demo:repeated", params: [field("a")], returns: StringT };
    const secondFn = { id: "demo:repeated", params: [field("b")], returns: StringT };
    expect(() => collectFieldIdentities([], [firstFn, secondFn])).toThrow(
      "conflicting declarations",
    );
  });

  test("conflicting repeated nominal definitions reject instead of first-one-wins", () => {
    const stringBox: FenelType = {
      $opaque: { name: "Box", pure: { $record: { fields: [field("value")] } } },
    };
    const numberBox: FenelType = {
      $opaque: {
        name: "Box",
        pure: { $record: { fields: [field("value", undefined, { $ref: "Number" })] } },
      },
    };
    expect(() =>
      collectFieldIdentities(
        [
          { id: "Box", module: "demo", type: stringBox },
          { id: "Box", module: "demo", type: numberBox },
        ],
        [],
      ),
    ).toThrow("conflicting declarations");
  });

  test("unregistered inline nominals are containing-owner scoped and conflict-checked", () => {
    const ghost = (fieldName: string): FenelType => ({
      $opaque: {
        name: "Ghost",
        pure: { $record: { fields: [field(fieldName)] } },
      },
    });
    const alpha = {
      id: "alpha:use",
      params: [field("ghost", undefined, ghost("left"))],
      returns: StringT,
    };
    const beta = {
      id: "beta:use",
      params: [field("ghost", undefined, ghost("right"))],
      returns: StringT,
    };
    const ids = collectFieldIdentities([], [alpha, beta]);
    const inline = ids.filter((x) => x.owner.$tag === "InlineNominalFieldOwner");
    expect(inline.map((x) => x.field.name).sort()).toEqual(["left", "right"]);
    expect(new Set(inline.map((x) => x.owner)).size).toBe(2);

    const conflicting = {
      id: "alpha:conflicting",
      params: [
        field("first", undefined, ghost("left")),
        field("second", undefined, ghost("right")),
      ],
      returns: StringT,
    };
    expect(() => collectFieldIdentities([], [conflicting])).toThrow(
      "conflicting nominal definitions",
    );
  });
});

describe("field-identity Phase 1 — registry-local/no-mutation discipline", () => {
  const sourceField = field("name");
  const entityType: FenelType = { $record: { fields: [sourceField] } };
  const mod: FenelModule = {
    name: "demo",
    label: "Demo",
    entities: [{ id: "Person", type: entityType }],
    functions: [],
  };
  const owner = fieldOwnerForEntity({ id: "Person", module: "demo" });
  const path = [fieldPath.named("name")] as const;
  const lockName = qualifiedFieldName(owner, path);

  // Both two-registry isolation cases use the real-roster cold-start budget,
  // including when a filtered run has not warmed the engine first.
  test("locked and then lock-less registries resolve independently without stamping the shared FieldDef", () => {
    const lock = repositoryIdentityLock();
    lock.set(lockName, UUID_A);
    const locked = createRegistry([mod], {
      codeNameLock: lock,
      fieldIdentity: {
        mode: "strict-embedded",
        defaultRealm: "repository-source",
        lock,
      },
    });
    expect(locked.getFieldIdentity(owner, path)?.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: UUID_A },
    });
    expect(locked.getFieldIdentityByHandle(UUID_A)?.qualifiedName).toBe(lockName);
    expect("key" in sourceField).toBe(false);

    const lockless = createRegistry([mod]);
    expect(lockless.getFieldIdentity(owner, path)?.field.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: lockName },
    });
    expect(lockless.getFieldIdentityByHandle(UUID_A)).toBeUndefined();
    expect(sourceField.name).toBe("name");
    expect("key" in sourceField).toBe(false);
  }, 300_000);

  test("nested public identity DTO mutations cannot reach source modules or sibling registries", () => {
    const options = {
      fieldIdentity: {
        mode: "source-handles" as const,
        defaultRealm: "repository-source" as const,
        cacheKey: "field-identity-registry-local-copy-test",
      },
    };
    const first = createRegistry([mod], options);
    const identity = first.getFieldIdentity(owner, path)!;
    (identity.field.type as { $ref: string }).$ref = "MutatedType";
    (identity.field.meta as Record<string, unknown>)["mutated"] = true;
    (identity.sourceField.type as { $ref: string }).$ref = "MutatedSourceCopy";
    (identity.sourceField.meta as Record<string, unknown>)["mutated"] = true;

    expect((sourceField.type as { $ref: string }).$ref).toBe("String");
    expect(sourceField.meta).toEqual({});

    const siblingRegistry = createRegistry([mod], options);
    const sibling = siblingRegistry.getFieldIdentity(owner, path)!;
    expect((sibling.field.type as { $ref: string }).$ref).toBe("String");
    expect(sibling.field.meta).toEqual({});
    expect((sibling.sourceField.type as { $ref: string }).$ref).toBe("String");
    expect(sibling.sourceField.meta).toEqual({});
    expect(sibling.field.type).not.toBe(identity.field.type);
    expect(sibling.sourceField).not.toBe(identity.sourceField);

    const firstRequests = first.listFieldLockRequests() as Array<{ name: string }>;
    const firstRequest = firstRequests.find((request) => request.name === lockName);
    expect(firstRequest).toBeDefined();
    firstRequest!.name = "mutated-lock-request";
    expect(siblingRegistry.listFieldLockRequests().find((request) => request.name === lockName)?.name).toBe(lockName);

    const firstEntity = first.listFieldEntities().find((entity) =>
      entity.occurrences.some((occurrence) => occurrence.qualifiedName === lockName)
    ) as {
      currentCodeName: string;
    } | undefined;
    expect(firstEntity).toBeDefined();
    if (firstEntity === undefined) throw new Error("missing demo Person fixture field entity");
    firstEntity.currentCodeName = "mutated-entity";
    expect(siblingRegistry.listFieldEntities().find((entity) =>
      entity.occurrences.some((occurrence) => occurrence.qualifiedName === lockName)
    )?.currentCodeName).toBe("name");
  }, 300_000);

  test("identified views retain distinct identities for one FieldDef aliased across paths and roots", () => {
    const aliased = field("value");
    const sharedNested: FenelType = { $record: { fields: [aliased] } };
    const type: FenelType = {
      $record: {
        fields: [
          field("left", undefined, sharedNested),
          field("right", undefined, sharedNested),
        ],
      },
    };
    const secondType: FenelType = { $record: { fields: [aliased] } };
    const collection = normalizeFieldDeclarations(
      [
        {
          kind: "type",
          realm: "repository-source",
          entity: { id: "Aliased", module: "demo", type },
        },
        {
          kind: "type",
          realm: "repository-source",
          entity: { id: "OtherAliased", module: "demo", type: secondType },
        },
      ],
      { mode: "collect-requirements" },
    );
    const identities = collection.occurrences;
    const aliasedOccurrences = identities.filter((identity) => identity.sourceField === aliased);
    expect(aliasedOccurrences).toHaveLength(3);

    const view = identifiedDefinitionView(type, collection.viewPlans[0]!) as typeof type;
    if (!("$record" in view)) throw new Error("expected identified record view");
    const left = view.$record.fields[0]!.type;
    const right = view.$record.fields[1]!.type;
    if (!("$record" in left) || !("$record" in right)) {
      throw new Error("expected nested record views");
    }
    const leftRef = left.$record.fields[0]!.key;
    const rightRef = right.$record.fields[0]!.key;
    expect(leftRef).toEqual({
      $tag: "NamedField",
      ref: { $ref: aliasedOccurrences[0]!.qualifiedName },
    });
    expect(rightRef).toEqual({
      $tag: "NamedField",
      ref: { $ref: aliasedOccurrences[1]!.qualifiedName },
    });
    expect(leftRef).not.toEqual(rightRef);

    const secondView = identifiedDefinitionView(secondType, collection.viewPlans[1]!);
    if (!("$record" in secondView)) throw new Error("expected second identified record view");
    expect(secondView.$record.fields[0]!.key).toEqual({
      $tag: "NamedField",
      ref: { $ref: aliasedOccurrences[2]!.qualifiedName },
    });
    expect("key" in aliased).toBe(false);
  });

  test("identified definition views preserve Bytes as isolated Uint8Array leaves", () => {
    const sourceBytes = new Uint8Array([1, 2, 255]);
    const source = {
      direct: sourceBytes,
      nested: [{ bytes: sourceBytes }],
    };
    const view = identifiedDefinitionView(source, {
      owner: fieldOwnerForFunction({ id: "bytes-view:direct" }),
      token: "bytes-view-root",
      kind: "function",
      fields: [],
    });

    expect(view.direct).toBeInstanceOf(Uint8Array);
    expect(view.nested[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(view.direct)).toEqual([1, 2, 255]);
    expect(Array.from(view.nested[0]!.bytes)).toEqual([1, 2, 255]);
    expect(view.direct).not.toBe(sourceBytes);
    expect(view.nested[0]!.bytes).not.toBe(sourceBytes);

    sourceBytes[0] = 99;
    view.direct[1] = 88;
    expect(Array.from(view.direct)).toEqual([1, 88, 255]);
    expect(Array.from(view.nested[0]!.bytes)).toEqual([1, 2, 255]);
    expect(Array.from(sourceBytes)).toEqual([99, 2, 255]);
  });

  test("finalized product views isolate Bytes while effective schemes stay canonical", () => {
    const functionBytes = new Uint8Array([3, 5, 8]);
    const entityBytes = new Uint8Array([13, 21, 34]);
    const functionParam = field("payload", undefined, { $ref: "Bytes" });
    functionParam.meta = { exampleBytes: functionBytes } as never;
    const entityField = field("payload", undefined, { $ref: "Bytes" });
    entityField.meta = { exampleBytes: entityBytes } as never;
    const entityType: FenelType = { $record: { fields: [entityField] } };
    const metaBytes = (definitionField: FieldDef): Uint8Array => {
      const bytes = (
        definitionField.meta as unknown as { exampleBytes: unknown }
      ).exampleBytes;
      if (!(bytes instanceof Uint8Array)) {
        throw new Error("finalized registry view lost its Bytes representation");
      }
      return bytes;
    };
    const fn: FenelFunction = {
      id: "bytes-product:constant",
      params: [functionParam],
      returns: { $ref: "String" },
    };
    const source = {
      $tag: "HostSpec" as const,
      module: "bytes-product",
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: fn.id,
      declarationName: "constant",
      codeName: "constant",
      scheme: {
        quantified: [],
        body: {
          $arrow: {
            params: [functionParam],
            returns: { $ref: "String" },
          },
        },
      },
      params: [{ $tag: "Authored", source }],
      returns: { $tag: "Authored", source },
    };
    const module: FenelModule = {
      name: "bytes-product",
      label: "Bytes product",
      entities: [{
        id: "BytesProductEntity",
        module: "bytes-product",
        type: entityType,
        typeScheme: { quantified: [], body: entityType },
      }],
      functions: [fn],
      functionSignatureDeclarations: [declaration],
      instances: [{
        typeName: "Codeable",
        args: [fn.id],
        methods: { codeName: "constant" },
      }],
      nativeImpls: {
        [fn.id]: () => "ok",
      },
    };
    const registry = createRegistry([module], { publishCatalogEntities: false });

    const firstFunction = registry.getFunction(fn.id)!;
    const firstFunctionBytes = metaBytes(firstFunction.params[0]!);
    const signature = registry.getFunctionSignatureInfo(fn.id)!;
    if (!("$arrow" in signature.scheme.body)) {
      throw new Error("expected finalized arrow scheme");
    }
    // Effective schemes are semantic judgments, not presentation/runtime-data
    // transport. The Fenel planner deliberately canonicalizes their field
    // envelopes instead of retaining arbitrary metadata from the host spec.
    expect(signature.scheme.body.$arrow.params[0]!.meta).toEqual({});
    const firstEntity = registry.getIdentifiedEntity("BytesProductEntity")!;
    if (!("$record" in firstEntity.type)) {
      throw new Error("expected finalized record entity");
    }
    const firstEntityBytes = metaBytes(firstEntity.type.$record.fields[0]!);

    expect(signature.outcome.$tag).toBe("Solved");
    expect(Array.from(firstFunctionBytes)).toEqual([3, 5, 8]);
    expect(Array.from(firstEntityBytes)).toEqual([13, 21, 34]);
    expect(firstFunctionBytes).not.toBe(functionBytes);
    expect(firstEntityBytes).not.toBe(entityBytes);

    functionBytes[0] = 99;
    entityBytes[0] = 99;
    firstFunctionBytes[1] = 88;
    firstEntityBytes[1] = 66;

    expect(Array.from(metaBytes(registry.getFunction(fn.id)!.params[0]!))).toEqual([3, 5, 8]);
    const rereadSignature = registry.getFunctionSignatureInfo(fn.id)!;
    if (!("$arrow" in rereadSignature.scheme.body)) {
      throw new Error("expected reread finalized arrow scheme");
    }
    expect(rereadSignature.scheme.body.$arrow.params[0]!.meta).toEqual({});
    const rereadEntity = registry.getIdentifiedEntity("BytesProductEntity")!;
    if (!("$record" in rereadEntity.type)) {
      throw new Error("expected reread record entity");
    }
    expect(Array.from(metaBytes(rereadEntity.type.$record.fields[0]!))).toEqual([13, 21, 34]);
  }, 180_000);

  test("a nominal $opaque pure view is declared once even when reused by a function", () => {
    const nominal: FenelType = {
      $opaque: {
        name: "Box",
        pure: { $record: { fields: [field("value")] } },
      },
    };
    const fn = { id: "demo:useBox", params: [field("box", undefined, nominal)], returns: nominal };
    const ids = collectFieldIdentities(
      [{ id: "Box", module: "demo", type: nominal }],
      [fn],
    );
    const valueIds = ids.filter((x) => x.field.name === "value");
    expect(valueIds).toHaveLength(1);
    expect(valueIds[0]!.owner).toEqual(
      fieldOwnerForEntity({ id: "Box", module: "demo" }),
    );
  });
});

describe("field-identity Phase 1 — real repository roster", () => {
  test("qualified occurrence handles are injective and positional fields never request lock rows", async () => {
    const { getSystemRegistry } = await import("./system-registry");
    const reg = getSystemRegistry();
    const ids = reg.listFieldIdentities();
    const handles = ids.map((x) => x.qualifiedName);
    expect(new Set(handles).size).toBe(handles.length);
    expect(ids.length).toBeGreaterThan(4_000);
    expect(
      ids
        .filter((x) => x.field.key.$tag === "PositionalField")
        .every((x) => x.lockName === null),
    ).toBe(true);
    const requirements = fieldLockRequirements({
      lockRequests: reg.listFieldLockRequests(),
    });
    expect(requirements.codeNames.length).toBeGreaterThan(4_000);
  }, 300_000);

  test("the complete Phase-1 subset keeps its canonical paired projection", async () => {
    const { getSystemRegistry } = await import("./system-registry");
    const reg = getSystemRegistry();
    const strict = [...reg.listFieldIdentities()]
      .sort((a, b) => a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0);
    const registeredEntityIds = new Set(reg.listEntities().map((entity) => entity.id));
    const entityRoots = [
      ...reg.listEntities(),
      ...specEntities
        .filter((entity) => entity.type !== undefined && !registeredEntityIds.has(entity.id))
        .map((entity) => ({ id: entity.id, type: entity.type!, module: "system" })),
    ];
    // Normal roster reads are now the finalized, FieldKey-enriched effective
    // functions. This oracle deliberately reconstructs the repository-source
    // half of the pair, so use the explicit non-authoritative raw-definition
    // escape hatch rather than feeding effective nominal specializations back
    // through source collection.
    const sourceFunctions = reg.listFunctions().map((fn) => {
      const raw = reg.getRawFunctionForDebug(fn.id);
      if (raw === undefined) {
        throw new Error(`missing raw source definition for ${fn.id}`);
      }
      return raw;
    });
    const source = collectFieldIdentitiesKernel(
      entityRoots,
      sourceFunctions,
      { realm: "repository-source", mode: "source-handles" },
    ).sort((a, b) => a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0);
    const sourceBy = new Map(source.map((identity) => [identity.qualifiedName, identity]));
    expect(strict).toHaveLength(7_417);
    expect(source).toHaveLength(7_417);
    expect(source.map((identity) => identity.qualifiedName)).toEqual(strict.map((identity) => identity.qualifiedName));

    const projection = strict.map((identity) => {
      const sourceIdentity = sourceBy.get(identity.qualifiedName)!;
      const key = identity.field.key;
      const sourceKey = sourceIdentity.field.key;
      return {
        encodedOwner: legacyOwner(identity.owner),
        rolePath: identity.path.map(legacyPath),
        encodedLockName: identity.qualifiedName,
        lockRequest: identity.lockName,
        preferredUuid: identity.preferredId ?? null,
        sourceName: identity.field.name,
        verdict: key.$tag,
        index: key.$tag === "PositionalField" ? key.index : null,
        strictHandle: key.$tag === "NamedField" ? key.ref.$ref : null,
        sourceHandle: sourceKey.$tag === "NamedField" ? sourceKey.ref.$ref : null,
        occurrenceType: phase1OccurrenceType(identity.field.type),
      };
    });
    const json = JSON.stringify(canonicalize(projection));
    const digest = createHash("sha256").update(json, "utf8").digest("hex");
    // The source-authoritative roster includes the formerly TS-keyed List
    // carrier graph plus the signature-cutover corpus. Keep the paired strict /
    // source projection as one byte-for-byte canary over that complete graph.
    // The isolated 7c159526 baseline and current source yield this same entire
    // paired projection, not just its row count. Keep the complete canary so
    // future changes must still explain any added, removed or changed rows.
    // This is the complete SYSTEM_REGISTRY_MODULES validation profile, not the
    // full runtime catalog. The 2026-10-01 drawing/public-binding additions
    // live outside that profile; the combined source preserves these bytes.
    expect({ bytes: Buffer.byteLength(json), digest }).toEqual({
      bytes: 4_013_626,
      digest: "4c94eb9284ea1e8cc239049193083c9f143a9e76c788a8795aadcb552ea3a134",
    });
  }, 300_000);
});
