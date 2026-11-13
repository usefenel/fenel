import { describe, expect, test } from "bun:test";

import {
  accountFieldReuseCatalogCandidates,
  fieldPersistenceSnapshotMatches,
  migrateLegacyFieldDefinitions,
  planFieldPersistence,
  queryFieldReuseCatalogCandidates,
  queryFieldResurrectionCandidates,
  tryMigrateLegacyFieldDefinitions,
  tryNormalizeFieldOccurrenceDraft,
  tryPlanFieldPersistence,
  type DesiredFieldFacetValue,
  type DurableFieldEntity,
  type FieldOwnerDefinition,
} from "./field-authoring";
import { Just, Nothing } from "./type-foundation";
import type { FenelType } from "./types";

const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

// Fresh owners use identities distinct from the Field UUIDs. Existing textual
// owner fixtures remain textual so loaded-legacy behavior stays exercised.
const FRESH_OWNER_IDS = {
  target: "51000000-0000-4000-8000-000000000001",
  inlineLabel: "51000000-0000-4000-8000-000000000002",
  inlineUi: "51000000-0000-4000-8000-000000000003",
  facet: "51000000-0000-4000-8000-000000000004",
  resurrected: "51000000-0000-4000-8000-000000000005",
  other: "51000000-0000-4000-8000-000000000006",
};

function displayHint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    widget: Nothing,
    placeholder: Nothing,
    helpText: Nothing,
    prefix: Nothing,
    suffix: Nothing,
    options: Nothing,
    format: Nothing,
    columns: Nothing,
    refFilter: Nothing,
    ...overrides,
  };
}

function legacyOwner(ownerKey: string, storageName: string): FieldOwnerDefinition {
  const type = {
    $record: {
      fields: [{
        name: "payload",
        label: Just("Payload label"),
        ui: Nothing,
        meta: {},
        type: {
          $variant: {
            cases: [
              { name: "Nothing", label: Nothing },
              {
                name: "Just",
                label: Nothing,
                fields: [{
                  name: "value",
                  label: Nothing,
                  ui: Just({ widget: Just("text"), helpText: Nothing }),
                  meta: {},
                  type: { $ref: "String" },
                }],
              },
            ],
          },
        },
      }],
    },
  } as FenelType;
  return {
    ownerKey,
    kind: "type",
    storageName,
    definition: { id: storageName, type },
  };
}

function migrateWithRequestedIds(owners: FieldOwnerDefinition[]) {
  const minted = new Map<string, string>();
  for (;;) {
    const result = tryMigrateLegacyFieldDefinitions({ owners, mintedFieldIds: minted });
    if (result.ok) return { projection: result.value, minted };
    expect(result.error.$tag).toBe("LegacyFieldMigrationMissingId");
    const name = String(result.error.qualifiedName);
    expect(name.startsWith("field:")).toBe(true);
    minted.set(name, UUIDS[minted.size]!);
  }
}

function canonicalOwner(
  storageName: string,
  fieldId: string,
  codeName = "payload",
  label: any = Nothing,
  ui: any = Nothing,
): Extract<FieldOwnerDefinition, { readonly kind: "type" }> {
  return {
    ownerKey: `type:${storageName}`,
    kind: "type",
    storageName,
    definition: {
      id: storageName,
      type: {
        $record: {
          fields: [{
            name: codeName,
            key: { $tag: "NamedField", ref: { $ref: fieldId } },
            label,
            ui,
            meta: {},
            type: { $ref: "String" },
          }],
        },
      },
    },
  };
}

describe("Fenel field authoring bridge", () => {
  test("definition draft baselines compare keyed rows and preserve native atoms", () => {
    const first = canonicalOwner("First", UUIDS[0]!);
    const second = canonicalOwner("Second", UUIDS[1]!);
    const fields: DurableFieldEntity[] = [
      { id: UUIDS[0]!, currentCodeName: "payload", status: "live", realm: "account", reuseVisibility: "account" },
      { id: UUIDS[1]!, currentCodeName: "payload", status: "live", realm: "account", reuseVisibility: "account" },
    ];
    const baseline = { owners: [first, second], fields, facets: [] };
    expect(fieldPersistenceSnapshotMatches(baseline, {
      ...baseline, owners: [...baseline.owners].reverse(), fields: [...fields].reverse(),
    })).toBe(true);
    expect(fieldPersistenceSnapshotMatches(baseline, { ...baseline, owners: [first, first] })).toBe(false);
    expect(fieldPersistenceSnapshotMatches(baseline, {
      ...baseline, owners: [{ ...first, storageId: UUIDS[2] }, second],
    })).toBe(false);
    expect(fieldPersistenceSnapshotMatches(baseline, {
      ...baseline, fields: [{ ...fields[0]!, status: "tombstoned" }, fields[1]!],
    })).toBe(false);
    const native = { owners: [], fields: [], facets: [{
      rowId: UUIDS[2]!, fieldId: UUIDS[0]!, typeName: "Viewable" as const,
      methods: { bytes: Uint8Array.of(1, 255).buffer, max: Infinity, raw: { $fenelCheckpoint: ["number", "+infinity"] } },
      scope: "account" as const, priority: 100,
    }] };
    expect(fieldPersistenceSnapshotMatches(native, structuredClone(native))).toBe(true);
    expect(fieldPersistenceSnapshotMatches(native, {
      ...native, facets: [{ ...native.facets[0]!, methods: { ...native.facets[0]!.methods, bytes: Uint8Array.of(2, 255).buffer } }],
    })).toBe(false);
  });
  test("account catalog ownership normalizes repository-backed occurrences without returning repository rows", () => {
    const owner = canonicalOwner("Mixed", UUIDS[0]!);
    const record = (owner.definition as any).type.$record as { fields: any[] };
    record.fields.push({
      ...record.fields[0],
      name: "shared",
      key: { $tag: "NamedField", ref: { $ref: UUIDS[1]! } },
    });
    const candidates = accountFieldReuseCatalogCandidates({
      owners: [owner],
      fields: [{
        id: UUIDS[0]!,
        currentCodeName: "payload",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      facets: [],
      externalFields: [{
        id: UUIDS[1]!,
        currentCodeName: "shared",
        status: "live",
        realm: "repository",
        reuseVisibility: "repository",
      }],
    });
    expect(candidates.map((candidate) => candidate.fieldId)).toEqual([UUIDS[0]!]);
    expect(candidates[0]?.owners).toHaveLength(1);
  });

  test("Fenel owns localized search and normalized cursor/limit policy", () => {
    const candidates = [
      {
        fieldId: UUIDS[0]!,
        codeName: "alpha",
        label: { en: "Invoice", fr: "Facture" },
        owners: ["type:a"],
        occurrenceTypes: [{ $ref: "String" } as FenelType],
        status: "live" as const,
        realm: "account" as const,
        reuseVisibility: "account" as const,
      },
      {
        fieldId: UUIDS[1]!,
        codeName: "beta",
        label: "Customer",
        owners: ["type:b"],
        occurrenceTypes: [{ $ref: "Number" } as FenelType],
        status: "live" as const,
        realm: "account" as const,
        reuseVisibility: "account" as const,
      },
    ];

    expect(queryFieldReuseCatalogCandidates(candidates, { search: "FACTURE" }).fields)
      .toEqual([expect.objectContaining({ fieldId: UUIDS[0]! })]);
    const invalidCursor = queryFieldReuseCatalogCandidates(candidates, {
      cursor: "1x",
      limit: 0,
    });
    expect(invalidCursor.fields.map((field) => field.fieldId)).toEqual([UUIDS[0]!]);
    expect(invalidCursor.nextCursor).toBe("1");
    expect(queryFieldReuseCatalogCandidates(candidates, {
      cursor: "-1",
      limit: 500,
    }).fields.map((field) => field.fieldId).sort()).toEqual([UUIDS[0]!, UUIDS[1]!]);
    expect(queryFieldReuseCatalogCandidates(candidates, {
      cursor: "9007199254740991",
      limit: 1,
    }).fields).toEqual([]);
    expect(queryFieldReuseCatalogCandidates(candidates, {
      cursor: "9007199254740992",
      limit: 1,
    }).fields.map((field) => field.fieldId)).toEqual([UUIDS[0]!]);
  });

  test("Fenel structurally deduplicates occurrence types independent of record key order", () => {
    const first = canonicalOwner("FirstUse", UUIDS[0]!, "shared");
    const second = canonicalOwner("SecondUse", UUIDS[0]!, "shared");
    const firstRefinement = {
      base: { $ref: "String" },
      set: { $tag: "SeAll" },
    };
    const secondRefinement = {
      set: { $tag: "SeAll" },
      base: { $ref: "String" },
    };
    (first.definition as any).type.$record.fields[0].type = {
      $refined: firstRefinement,
    };
    (second.definition as any).type.$record.fields[0].type = {
      $refined: secondRefinement,
    };
    const candidates = accountFieldReuseCatalogCandidates({
      owners: [first, second],
      fields: [{
        id: UUIDS[0]!,
        currentCodeName: "shared",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      facets: [],
    });

    expect(candidates[0]?.owners).toHaveLength(2);
    expect(candidates[0]?.occurrenceTypes).toHaveLength(1);
  });

  test("legacy migration stamps nested record/variant fields and lifts inline facets", () => {
    const owner = legacyOwner("type:one", "One");
    const { projection } = migrateWithRequestedIds([owner]);
    const migrated = projection.owners[0]!.definition as { type: any };
    const payload = migrated.type.$record.fields[0];
    const value = payload.type.$variant.cases[1].fields[0];
    expect(payload.key.$tag).toBe("NamedField");
    expect(value.key.$tag).toBe("NamedField");
    expect(payload.label).toEqual(Nothing);
    expect(payload.ui).toEqual(Nothing);
    expect(value.label).toEqual(Nothing);
    expect(value.ui).toEqual(Nothing);
    expect(projection.fields).toHaveLength(2);
    expect(projection.facets.map((facet) => facet.typeName).sort()).toEqual([
      "Displayable",
      "Labelable",
    ]);
  }, 15_000);

  test("repeated local codenames request distinct owner-qualified mints", () => {
    const { minted } = migrateWithRequestedIds([
      legacyOwner("type:one", "One"),
      legacyOwner("type:two", "Two"),
    ]);
    const valueNames = [...minted.keys()].filter((name) => name.includes("named%3Avalue"));
    expect(valueNames).toHaveLength(2);
    expect(new Set(valueNames).size).toBe(2);
  });

  test("UUID-as-name is rejected until a readable Codeable mapping is explicit", () => {
    const uuidNameOwner: FieldOwnerDefinition = {
      ownerKey: "type:uuid-name",
      kind: "type",
      storageName: "UuidName",
      definition: {
        id: "UuidName",
        type: {
          $record: {
            fields: [{
              name: UUIDS[0]!,
              label: Just("Readable"),
              ui: Nothing,
              meta: {},
              type: { $ref: "String" },
            }],
          },
        },
      },
    };
    const result = tryMigrateLegacyFieldDefinitions({
      owners: [uuidNameOwner],
      mintedFieldIds: new Map(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("LegacyFieldMigrationAmbiguous");
  });

  test("legacy facet lift accepts equal cloned methods and rejects a conflict", () => {
    const owners = [legacyOwner("type:one", "One")];
    const { projection, minted } = migrateWithRequestedIds(owners);
    const currentFacets = projection.facets.map((facet) => ({
      ...facet,
      methods: structuredClone(facet.methods),
      scope: "account" as const,
      priority: 100,
    }));
    const rerun = migrateLegacyFieldDefinitions({
      owners,
      mintedFieldIds: minted,
      currentFacets,
    });
    expect(rerun.facets).toEqual(projection.facets);

    const conflicting = currentFacets.map((facet) => facet.typeName === "Labelable"
      ? { ...facet, methods: { label: "Conflicting label" } }
      : facet);
    const conflict = tryMigrateLegacyFieldDefinitions({
      owners,
      mintedFieldIds: minted,
      currentFacets: conflicting,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.$tag).toBe("LegacyFieldMigrationAmbiguous");
  });

  test("persistence plan is retry-safe and inherits owner storage id", () => {
    const owner = legacyOwner("type:One", "One");
    const { projection } = migrateWithRequestedIds([owner]);
    const currentOwner = { ...projection.owners[0]!, storageId: "stored-row" };
    const requestedOwner = { ...projection.owners[0]!, storageId: undefined };
    const first = planFieldPersistence({
      currentOwners: [currentOwner],
      ownerMutations: [{ kind: "upsert", owner: requestedOwner }],
      currentFields: [],
      currentFacets: [],
      desiredFacets: projection.facets,
      replaceFacetFieldIds: [...new Set(projection.facets.map((facet) => facet.fieldId))],
    });
    expect(first.snapshot.owners[0]?.storageId).toBe("stored-row");
    const retry = planFieldPersistence({
      currentOwners: structuredClone(first.snapshot.owners),
      ownerMutations: [{ kind: "upsert", owner: structuredClone(first.snapshot.owners[0]!) }],
      currentFields: structuredClone(first.snapshot.fields),
      currentFacets: structuredClone(first.snapshot.facets),
      desiredFacets: structuredClone(projection.facets),
      replaceFacetFieldIds: [...new Set(projection.facets.map((facet) => facet.fieldId))],
    });
    expect(retry.fieldUpserts).toHaveLength(0);
    expect(retry.fieldTombstones).toHaveLength(0);
    expect(retry.facetUpserts).toHaveLength(0);
    expect(retry.retainedFacets).toHaveLength(first.snapshot.facets.length);
  });

  test("Codeable rename preserves the persisted logical facet row", () => {
    const currentOwner = {
      ...canonicalOwner("RenamedOwner", UUIDS[0]!, "payload"),
      storageId: "stored-owner",
    };
    const renamedOwner = canonicalOwner("RenamedOwner", UUIDS[0]!, "renamedPayload");
    const plan = planFieldPersistence({
      currentOwners: [currentOwner],
      ownerMutations: [{ kind: "upsert", owner: renamedOwner }],
      currentFields: [{
        id: UUIDS[0]!,
        currentCodeName: "payload",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
      }],
      currentFacets: [{
        rowId: UUIDS[1]!,
        fieldId: UUIDS[0]!,
        typeName: "Codeable",
        methods: { codeName: "payload" },
        scope: "account",
        priority: 100,
      }],
    });

    expect(plan.fieldUpserts).toEqual([
      expect.objectContaining({ id: UUIDS[0]!, currentCodeName: "renamedPayload" }),
    ]);
    expect(plan.facetUpserts).toEqual([
      expect.objectContaining({
        rowId: UUIDS[1]!,
        fieldId: UUIDS[0]!,
        typeName: "Codeable",
        methods: { codeName: "renamedPayload" },
      }),
    ]);
    expect(plan.facetDeletes).toHaveLength(0);
    expect(plan.snapshot.facets).toEqual([
      expect.objectContaining({ rowId: UUIDS[1]!, typeName: "Codeable" }),
    ]);
  });

  test("complete owner graph enforces durable reuse visibility", () => {
    const source = {
      ...canonicalOwner("Source", UUIDS[0]!),
      storageId: "source-row",
    };
    const target = canonicalOwner(FRESH_OWNER_IDS.target, UUIDS[0]!);
    const emptiedSource: FieldOwnerDefinition = {
      ...source,
      definition: { id: "Source", type: { $record: { fields: [] } } },
    };
    const ownerOnly: DurableFieldEntity = {
      id: UUIDS[0]!,
      currentCodeName: "payload",
      status: "live",
      realm: "account",
      reuseVisibility: "owner",
      origin: {
        owner: { $tag: "TypeFieldOwner", module: Nothing, localId: "Source" },
        path: [{ $tag: "FieldNamed", name: "payload" }],
      },
    };
    const codeable = {
      rowId: UUIDS[1]!,
      fieldId: UUIDS[0]!,
      typeName: "Codeable",
      methods: { codeName: "payload" },
      scope: "account" as const,
      priority: 100,
    };

    for (const ownerMutations of [
      [{ kind: "upsert" as const, owner: target }],
      [
        { kind: "upsert" as const, owner: emptiedSource },
        { kind: "upsert" as const, owner: target },
      ],
    ]) {
      const forged = tryPlanFieldPersistence({
        currentOwners: [source],
        ownerMutations,
        currentFields: [ownerOnly],
        currentFacets: [codeable],
      });
      expect(forged.ok).toBe(false);
      if (!forged.ok) expect(forged.error.$tag).toBe("FieldReuseNotVisible");
    }

    const retained = tryPlanFieldPersistence({
      currentOwners: [source],
      ownerMutations: [{ kind: "upsert", owner: canonicalOwner("Source", UUIDS[0]!) }],
      currentFields: [ownerOnly],
      currentFacets: [codeable],
    });
    expect(retained.ok).toBe(true);

    const nestedDraft = tryNormalizeFieldOccurrenceDraft({
      draftId: "nested-owner-reuse",
      owner: {
        $tag: "InlineNominalFieldOwner",
        parent: { $tag: "TypeFieldOwner", module: Nothing, localId: "Source" },
        name: "OwnerLocalPayload",
      },
      action: { kind: "reuse", fieldId: UUIDS[0]! },
      codeName: "payload",
      occurrenceType: { $ref: "String" },
      facets: {},
    }, [ownerOnly]);
    expect(nestedDraft.ok).toBe(true);

    const nestedSource = structuredClone(source);
    const outer = (nestedSource.definition.type as any).$record.fields[0]!;
    outer.type = {
      $opaque: {
        name: "OwnerLocalPayload",
        pure: {
          $record: {
            fields: [{
              ...structuredClone(outer),
              type: { $ref: "String" },
            }],
          },
        },
      },
    };
    const retainedAcrossOwnerSubtree = tryPlanFieldPersistence({
      currentOwners: [nestedSource],
      ownerMutations: [{ kind: "upsert", owner: nestedSource }],
      currentFields: [ownerOnly],
      currentFacets: [codeable],
    });
    expect(retainedAcrossOwnerSubtree.ok).toBe(true);

    const accountReusable = tryPlanFieldPersistence({
      currentOwners: [source],
      ownerMutations: [
        { kind: "upsert", owner: emptiedSource },
        { kind: "upsert", owner: target },
      ],
      currentFields: [{ ...ownerOnly, reuseVisibility: "account" }],
      currentFacets: [codeable],
    });
    expect(accountReusable.ok).toBe(true);
    if (accountReusable.ok) {
      expect(accountReusable.value.fieldTombstones).toHaveLength(0);
      expect(accountReusable.value.snapshot.fields).toContainEqual(
        expect.objectContaining({ id: UUIDS[0]!, status: "live" }),
      );
    }
  });

  test("owner storage identity is server-authoritative and cannot target a sibling row", () => {
    const currentOwner = {
      ...canonicalOwner("OwnerA", UUIDS[0]!),
      storageId: "stored-owner-a",
    };
    const takeover = tryPlanFieldPersistence({
      currentOwners: [currentOwner],
      ownerMutations: [{
        kind: "upsert",
        owner: {
          ...canonicalOwner("OwnerA", UUIDS[0]!),
          storageId: "stored-owner-b",
        },
      }],
      currentFields: [],
      currentFacets: [],
    });
    expect(takeover.ok).toBe(false);
    if (!takeover.ok) {
      expect(takeover.error.$tag).toBe("InvalidOwnerStorageIdentity");
      expect(takeover.error.reason).toBe("owner-storage-id-mismatch");
    }

    const exactRetry = tryPlanFieldPersistence({
      currentOwners: [currentOwner],
      ownerMutations: [{
        kind: "upsert",
        owner: { ...canonicalOwner("OwnerA", UUIDS[0]!), storageId: "stored-owner-a" },
      }],
      currentFields: [],
      currentFacets: [],
    });
    expect(exactRetry.ok).toBe(true);
    if (exactRetry.ok) {
      expect(exactRetry.value.snapshot.owners[0]?.storageId).toBe("stored-owner-a");
    }
  });

  test("new owners cannot import storage ids and owner metadata must be canonical", () => {
    const suppliedStorageId = tryPlanFieldPersistence({
      currentOwners: [],
      ownerMutations: [{
        kind: "upsert",
        owner: { ...canonicalOwner("NewOwner", UUIDS[0]!), storageId: "stored-owner-b" },
      }],
      currentFields: [],
      currentFacets: [],
    });
    expect(suppliedStorageId.ok).toBe(false);
    if (!suppliedStorageId.ok) {
      expect(suppliedStorageId.error.$tag).toBe("InvalidOwnerStorageIdentity");
      expect(suppliedStorageId.error.reason).toBe("new-owner-storage-id");
    }

    for (const owner of [
      { ...canonicalOwner("Canonical", UUIDS[0]!), ownerKey: "type:Other" },
      {
        ...canonicalOwner("Canonical", UUIDS[0]!),
        definition: { ...canonicalOwner("Canonical", UUIDS[0]!).definition, id: "Other" },
      },
    ]) {
      const result = tryPlanFieldPersistence({
        currentOwners: [],
        ownerMutations: [{ kind: "upsert", owner }],
        currentFields: [],
        currentFacets: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe("InvalidOwnerStorageIdentity");
    }
  });

  test("owner deletes must repeat the server-loaded canonical metadata", () => {
    const currentOwner = {
      ...canonicalOwner("OwnerA", UUIDS[0]!),
      storageId: "stored-owner-a",
    };
    for (const mutation of [
      {
        kind: "delete" as const,
        ownerKey: "type:OwnerA",
        ownerKind: "function" as const,
        storageName: "OwnerA",
      },
      {
        kind: "delete" as const,
        ownerKey: "type:OwnerA",
        ownerKind: "type" as const,
        storageName: "OwnerB",
      },
    ]) {
      const result = tryPlanFieldPersistence({
        currentOwners: [currentOwner],
        ownerMutations: [mutation],
        currentFields: [],
        currentFacets: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe("InvalidOwnerStorageIdentity");
    }
  });

  test("facet replacement is per hydrated field and preserves untouched siblings", () => {
    const owner: FieldOwnerDefinition = {
      ownerKey: "type:TwoFields",
      kind: "type",
      storageName: "TwoFields",
      definition: {
        id: "TwoFields",
        type: {
          $record: {
            fields: [
              {
                name: "first",
                key: { $tag: "NamedField", ref: { $ref: UUIDS[0]! } },
                type: { $ref: "String" },
                label: Nothing,
                ui: Nothing,
                meta: {},
              },
              {
                name: "second",
                key: { $tag: "NamedField", ref: { $ref: UUIDS[1]! } },
                type: { $ref: "String" },
                label: Nothing,
                ui: Nothing,
                meta: {},
              },
            ],
          },
        },
      },
    };
    const fields: DurableFieldEntity[] = [
      { id: UUIDS[0]!, currentCodeName: "first", status: "live", realm: "account", reuseVisibility: "account" },
      { id: UUIDS[1]!, currentCodeName: "second", status: "live", realm: "account", reuseVisibility: "account" },
    ];
    const currentFacets = [
      { rowId: UUIDS[2]!, fieldId: UUIDS[0]!, typeName: "Labelable", methods: { label: "First" }, scope: "account" as const, priority: 100 },
      { rowId: UUIDS[3]!, fieldId: UUIDS[1]!, typeName: "Labelable", methods: { label: "Second" }, scope: "account" as const, priority: 100 },
    ];
    const plan = planFieldPersistence({
      currentOwners: [owner],
      ownerMutations: [{ kind: "upsert", owner }],
      currentFields: fields,
      currentFacets,
      desiredFacets: [{ fieldId: UUIDS[0]!, typeName: "Labelable", methods: { label: "First updated" } }],
      replaceFacetFieldIds: [UUIDS[0]!],
    });
    expect(plan.snapshot.facets.find((facet) => facet.fieldId === UUIDS[1] && facet.typeName === "Labelable")?.methods).toEqual({ label: "Second" });
    expect(plan.facetDeletes.some((facet) => facet.fieldId === UUIDS[1])).toBe(false);
    expect(plan.facetUpserts.find((facet) => facet.fieldId === UUIDS[0] && facet.typeName === "Labelable")?.rowId).toBe(UUIDS[2]);
  });

  test("one multi-owner mutation moves an occurrence without a tombstone or facet gap", () => {
    const source = canonicalOwner("Source", UUIDS[0]!);
    const emptiedSource: FieldOwnerDefinition = {
      ...source,
      storageId: "source-row",
      definition: {
        id: "Source",
        type: { $record: { fields: [] } },
      },
    };
    const target = canonicalOwner(FRESH_OWNER_IDS.target, UUIDS[0]!);
    const plan = planFieldPersistence({
      currentOwners: [{ ...source, storageId: "source-row" }],
      ownerMutations: [
        { kind: "upsert", owner: emptiedSource },
        { kind: "upsert", owner: target },
      ],
      currentFields: [{
        id: UUIDS[0]!,
        currentCodeName: "payload",
        status: "live",
        realm: "account",
        reuseVisibility: "account",
        origin: {
          owner: { $tag: "TypeFieldOwner", module: Nothing, localId: "Source" },
          path: [{ $tag: "FieldNamed", name: "payload" }],
        },
      }],
      currentFacets: [
        {
          rowId: UUIDS[1]!,
          fieldId: UUIDS[0]!,
          typeName: "Codeable",
          methods: { codeName: "payload" },
          scope: "account",
          priority: 100,
        },
        {
          rowId: UUIDS[2]!,
          fieldId: UUIDS[0]!,
          typeName: "Labelable",
          methods: { label: "Payload" },
          scope: "account",
          priority: 100,
        },
      ],
    });
    expect(plan.ownerUpserts.map((owner) => owner.ownerKey).sort()).toEqual([
      "type:Source",
      `type:${FRESH_OWNER_IDS.target}`,
    ].sort());
    expect(plan.fieldTombstones).toHaveLength(0);
    expect(plan.snapshot.fields).toEqual([
      expect.objectContaining({ id: UUIDS[0]!, status: "live" }),
    ]);
    expect(plan.snapshot.facets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldId: UUIDS[0]!,
        typeName: "Codeable",
        methods: { codeName: "payload" },
      }),
      expect.objectContaining({ rowId: UUIDS[2]!, typeName: "Labelable" }),
    ]));
  });

  test("normal planning rejects declaration-level label/UI instead of persisting legacy overlays", () => {
    for (const owner of [
      canonicalOwner(FRESH_OWNER_IDS.inlineLabel, UUIDS[0]!, "payload", Just("Legacy label")),
      canonicalOwner(FRESH_OWNER_IDS.inlineUi, UUIDS[1]!, "payload", Nothing, Just({ widget: "text" })),
    ]) {
      const result = tryPlanFieldPersistence({
        currentOwners: [],
        ownerMutations: [{ kind: "upsert", owner }],
        currentFields: [],
        currentFacets: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe("NonCanonicalFieldPresentation");
    }
  });

  test("Fenel inventory rejects a field UUID already reserved as another identity kind", () => {
    const result = tryPlanFieldPersistence({
      currentOwners: [],
      ownerMutations: [],
      currentFields: [{
        id: UUIDS[0]!,
        currentCodeName: "payload",
        status: "tombstoned",
        realm: "account",
        reuseVisibility: "account",
      }],
      currentFacets: [],
      identityKinds: new Map([[UUIDS[0]!, "function"]]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.$tag).toBe("FieldIdentityKindConflict");
  });

  test("optional facet methods are Fenel-validated and Codeable cannot be requested", () => {
    const owner = canonicalOwner(FRESH_OWNER_IDS.facet, UUIDS[0]!);
    const invalid: Array<{ facet: DesiredFieldFacetValue; tag: string }> = [
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Codeable", methods: { codeName: "payload" } } as any,
        tag: "ImmutableFieldCodeableFacet",
      },
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Labelable", methods: { label: 42 } },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Describable", methods: { description: "ok", extra: true } },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Iconable", methods: { icon: "" } },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Displayable", methods: { hint: "textarea" } },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: { fieldId: UUIDS[0]!, typeName: "Displayable", methods: { hint: {} } },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: {
          fieldId: UUIDS[0]!,
          typeName: "Displayable",
          methods: { hint: displayHint({ columns: { $tag: "Just", _0: 0 } }) },
        },
        tag: "InvalidFieldFacetMethods",
      },
      {
        facet: {
          fieldId: UUIDS[0]!,
          typeName: "Displayable",
          methods: { hint: { ...displayHint(), surprise: Nothing } },
        },
        tag: "InvalidFieldFacetMethods",
      },
    ];
    for (const testCase of invalid) {
      const result = tryPlanFieldPersistence({
        currentOwners: [],
        ownerMutations: [{ kind: "upsert", owner }],
        currentFields: [],
        currentFacets: [],
        desiredFacets: [testCase.facet],
        replaceFacetFieldIds: [UUIDS[0]!],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.$tag).toBe(testCase.tag);
    }

    const valid = tryPlanFieldPersistence({
      currentOwners: [],
      ownerMutations: [{ kind: "upsert", owner }],
      currentFields: [],
      currentFacets: [],
      desiredFacets: [
        { fieldId: UUIDS[0]!, typeName: "Labelable", methods: { label: { en: "Payload", fr: "Charge" } } },
        { fieldId: UUIDS[0]!, typeName: "Describable", methods: { description: "Payload value" } },
        { fieldId: UUIDS[0]!, typeName: "Iconable", methods: { icon: "inbox" } },
        { fieldId: UUIDS[0]!, typeName: "Displayable", methods: { hint: displayHint({ widget: Just("textarea") }) } },
      ],
      replaceFacetFieldIds: [UUIDS[0]!],
    });
    expect(valid.ok).toBe(true);
  });

  test("tombstones require explicit owner-local resurrection and stay out of reuse results", () => {
    const tombstone: DurableFieldEntity = {
      id: UUIDS[0]!,
      currentCodeName: "payload",
      status: "tombstoned",
      realm: "account",
      reuseVisibility: "account",
      origin: {
        owner: { $tag: "TypeFieldOwner", module: Nothing, localId: FRESH_OWNER_IDS.resurrected },
        path: [{ $tag: "FieldNamed", name: "payload" }],
      },
    };
    const owner = canonicalOwner(FRESH_OWNER_IDS.resurrected, UUIDS[0]!);
    const occurrenceOwner = {
      $tag: "TypeFieldOwner" as const,
      module: Nothing,
      localId: FRESH_OWNER_IDS.resurrected,
    };
    expect(queryFieldResurrectionCandidates(owner, [tombstone])).toEqual([{
      fieldId: UUIDS[0]!,
      codeName: "payload",
    }]);
    expect(queryFieldResurrectionCandidates(
      canonicalOwner(FRESH_OWNER_IDS.other, UUIDS[1]!),
      [tombstone],
    )).toEqual([]);
    const resurrectedDraft = tryNormalizeFieldOccurrenceDraft({
      draftId: "resurrected-draft",
      owner: occurrenceOwner,
      action: { kind: "resurrect", fieldId: UUIDS[0]! },
      codeName: "payload",
      occurrenceType: { $ref: "String" },
      facets: {},
    }, [tombstone]);
    expect(resurrectedDraft.ok).toBe(true);
    const wrongDraftOwner = tryNormalizeFieldOccurrenceDraft({
      draftId: "wrong-owner-draft",
      owner: { ...occurrenceOwner, localId: FRESH_OWNER_IDS.other },
      action: { kind: "resurrect", fieldId: UUIDS[0]! },
      codeName: "payload",
      occurrenceType: { $ref: "String" },
      facets: {},
    }, [tombstone]);
    expect(wrongDraftOwner.ok).toBe(false);
    if (!wrongDraftOwner.ok) expect(wrongDraftOwner.error.$tag).toBe("FieldResurrectionNotVisible");
    const renamedDraft = tryNormalizeFieldOccurrenceDraft({
      draftId: "renamed-resurrection-draft",
      owner: occurrenceOwner,
      action: { kind: "resurrect", fieldId: UUIDS[0]! },
      codeName: "renamed",
      occurrenceType: { $ref: "String" },
      facets: {},
    }, [tombstone]);
    expect(renamedDraft.ok).toBe(false);
    if (!renamedDraft.ok) expect(renamedDraft.error.$tag).toBe("InvalidFieldCodeName");
    const base = {
      currentOwners: [] as FieldOwnerDefinition[],
      ownerMutations: [{ kind: "upsert" as const, owner }],
      currentFields: [tombstone],
      currentFacets: [],
    };
    const ordinary = tryPlanFieldPersistence(base);
    expect(ordinary.ok).toBe(false);
    if (!ordinary.ok) expect(ordinary.error.$tag).toBe("TombstonedFieldReuse");

    const explicit = tryPlanFieldPersistence({ ...base, resurrectFieldIds: [UUIDS[0]!] });
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.value.fieldUpserts).toEqual([
        expect.objectContaining({ id: UUIDS[0]!, status: "live" }),
      ]);
    }

    const wrongOwner = tryPlanFieldPersistence({
      ...base,
      ownerMutations: [{ kind: "upsert", owner: canonicalOwner(FRESH_OWNER_IDS.other, UUIDS[0]!) }],
      resurrectFieldIds: [UUIDS[0]!],
    });
    expect(wrongOwner.ok).toBe(false);
    if (!wrongOwner.ok) expect(wrongOwner.error.$tag).toBe("FieldResurrectionNotVisible");

    const unused = tryPlanFieldPersistence({
      ...base,
      ownerMutations: [],
      resurrectFieldIds: [UUIDS[0]!],
    });
    expect(unused.ok).toBe(false);
    if (!unused.ok) expect(unused.error.$tag).toBe("UnusedFieldResurrection");

    const duplicate = tryPlanFieldPersistence({
      ...base,
      resurrectFieldIds: [UUIDS[0]!, UUIDS[0]!],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.$tag).toBe("DuplicateFieldResurrection");

    const live = tryPlanFieldPersistence({
      ...base,
      currentFields: [{ ...tombstone, status: "live" }],
      resurrectFieldIds: [UUIDS[0]!],
    });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.error.$tag).toBe("InvalidFieldResurrection");

    expect(queryFieldReuseCatalogCandidates([{
      fieldId: tombstone.id,
      codeName: tombstone.currentCodeName,
      owners: [FRESH_OWNER_IDS.resurrected],
      occurrenceTypes: [{ $ref: "String" }],
      status: "tombstoned",
      realm: "account",
      reuseVisibility: "account",
    }]).fields).toEqual([]);
  });
});
