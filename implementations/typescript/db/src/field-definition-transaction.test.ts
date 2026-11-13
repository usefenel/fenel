import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { FieldDef, FenelType, TypeScheme } from "@fenel/engine/types";
import { REPOSITORY_IDENTITY_MANIFEST } from "@fenel/engine/repository-identity-manifest";
import { accounts } from "./schema/accounts";
import { entityInstances } from "./schema/entity-instances";
import { functions } from "./schema/functions";
import { types } from "./schema/types";
import { closeDb, getDb } from "./client";
import {
  executeCapturedFieldDefinitionCommandTransaction,
  executeFieldDefinitionCommandTransaction,
  executeFieldDefinitionPersistencePlan,
  createDispatchInstance,
  createEntityInstance,
  deleteEntityInstance,
  FieldControlPlaneWriteConflict,
  FieldDefinitionPersistenceConflict,
  loadAccountFieldDefinitionGraph,
  loadAccountFieldDefinitionMigrationGraph,
  listTypes,
  getDispatchInstance,
  updateEntityInstance,
  updateDispatchInstance,
  deleteDispatchInstance,
  type FieldDefinitionFaultPoint,
  type StoredDurableFieldEntity,
  type StoredFieldFacetValue,
  type StoredFieldOwnerDefinition,
  type StoredFieldPersistencePlan,
} from "./index";

const enabled = Boolean(process.env["DATABASE_URL"]);
const integration = enabled ? describe : describe.skip;

const accountIds: string[] = [];

function field(id = crypto.randomUUID()): StoredDurableFieldEntity {
  return {
    id,
    currentCodeName: "contactEmail",
    status: "live",
    realm: "account",
    reuseVisibility: "account",
  };
}

function facet(
  f: StoredDurableFieldEntity,
  typeName: StoredFieldFacetValue["typeName"] = "Codeable",
): StoredFieldFacetValue {
  return {
    fieldId: f.id,
    typeName,
    methods: typeName === "Codeable"
      ? { codeName: f.currentCodeName }
      : { label: "Contact email" },
    scope: "account",
    priority: 100,
  };
}

function owner(name: string): StoredFieldOwnerDefinition {
  return {
    ownerKey: `type:${name}`,
    kind: "type",
    storageName: name,
    definition: {
      id: name,
      type: {
        $record: {
          fields: [],
        },
      },
    },
  };
}

function plan(input: Partial<StoredFieldPersistencePlan>): StoredFieldPersistencePlan {
  return {
    ownerUpserts: [],
    ownerDeletes: [],
    fieldUpserts: [],
    fieldTombstones: [],
    facetUpserts: [],
    facetDeletes: [],
    retainedFacets: [],
    snapshot: { owners: [], fields: [], facets: [] },
    ...input,
  };
}

async function createTestAccount(): Promise<string> {
  const id = crypto.randomUUID();
  const db = getDb();
  await db.insert(accounts).values({
    id,
    slug: `field-definition-test-${id}`,
    name: "Field definition transaction test",
  });
  accountIds.push(id);
  return id;
}

async function counts(accountId: string) {
  const db = getDb();
  const [typeRows, functionRows, instanceRows] = await Promise.all([
    db.select().from(types).where(eq(types.accountId, accountId)),
    db.select().from(functions).where(eq(functions.accountId, accountId)),
    db
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.accountId, accountId)),
  ]);
  return {
    types: typeRows.length,
    functions: functionRows.length,
    instances: instanceRows.length,
  };
}

async function expectFieldControlPlaneConflict(
  operation: Promise<unknown>,
): Promise<void> {
  let rejected: unknown;
  try {
    await operation;
  } catch (error) {
    rejected = error;
  }
  expect(rejected).toBeInstanceOf(FieldControlPlaneWriteConflict);
}

describe("field definition graph read boundary", () => {
  test("loads owners, Fields, and facets through one MVCC statement", async () => {
    let statements = 0;
    const reader = {
      execute: async () => {
        statements += 1;
        return [{ physicalRowTexts: [] }];
      },
    };

    const loaded = await loadAccountFieldDefinitionGraph(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      reader as any,
    );

    expect(statements).toBe(1);
    expect(loaded).toEqual({
      currentOwners: [],
      currentFields: [],
      currentFacets: [],
      storageIssues: [],
    });
  });
});

integration("field definition bundle transaction", () => {
  beforeAll(async () => {
    // Fail early with a small round trip instead of producing misleading
    // per-test assertion failures when an advertised URL is unusable.
    await getDb().select({ id: accounts.id }).from(accounts).limit(1);
  });

  afterAll(async () => {
    const db = getDb();
    for (const accountId of accountIds) {
      await db
        .delete(entityInstances)
        .where(eq(entityInstances.accountId, accountId));
      await db.delete(functions).where(eq(functions.accountId, accountId));
      await db.delete(types).where(eq(types.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
    }
    await closeDb();
  });

  test("generic declaration persists atomically, reloads native types, and enters the physical recovery image", async () => {
    const accountId = await createTestAccount();
    const genericOwner = owner("GenericDeclaration") as Extract<StoredFieldOwnerDefinition, { kind: "type" }>;
    const nativeType: FenelType = { $refined: { base: { $ref: "String" }, set: {
      $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity },
    } } };
    const scheme: TypeScheme = {
      quantified: [{ id: "q-stable", sourceName: "a", kind: { $tag: "KType" } }],
      body: nativeType,
      applications: [{ path: [], headRef: "nominal-stable", args: [nativeType], kind: { $tag: "KType" } }],
      nominals: [{ path: [], identity: "nominal-stable", publicName: "GenericDeclaration" }],
      diagnostics: [],
    };
    const declared = { ...genericOwner, definition: { ...genericOwner.definition,
      params: [{ name: "a", constraints: [] }], typeScheme: scheme,
    } };
    await executeFieldDefinitionPersistencePlan(accountId, plan({ ownerUpserts: [declared] }));
    const graph = await loadAccountFieldDefinitionGraph(accountId);
    expect(graph.currentOwners[0]!.definition).toMatchObject(declared.definition);
    const listed = (await listTypes(accountId)).find(row => row.name === declared.storageName)!;
    expect(listed.typeScheme).toEqual(scheme);
    expect(listed.params).toEqual(declared.definition.params);

    let captured: readonly string[] = [];
    await executeCapturedFieldDefinitionCommandTransaction(accountId, () => plan({}), {
      persistBeforeImage: rows => { captured = rows; },
    });
    const physical = JSON.parse(captured[0]!).row;
    expect(physical.declaration.typeScheme.quantified[0].id).toBe("q-stable");
    expect(physical.declaration.typeScheme.body.$refined.set.pattern.max).toBe("unbounded");
    expect(physical.declaration.typeScheme.applications[0].args[0].$refined.set.pattern.max).toBe("unbounded");

    const persisted = graph.currentOwners[0]! as Extract<StoredFieldOwnerDefinition, { kind: "type" }>;
    const changed = { ...persisted, definition: { ...persisted.definition,
      type: { $ref: "String" }, params: [{ name: "renamed", constraints: [] }],
      typeScheme: { ...scheme, quantified: [{ ...scheme.quantified[0]!, sourceName: "renamed" }] },
    } };
    let failure: unknown;
    try {
      await executeFieldDefinitionPersistencePlan(accountId, plan({ ownerUpserts: [changed] }), {
        faultInjector: () => { throw new Error("generic owner rollback"); },
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("generic owner rollback");
    expect((await loadAccountFieldDefinitionGraph(accountId)).currentOwners).toEqual(graph.currentOwners);
    await executeFieldDefinitionPersistencePlan(accountId, plan({ ownerUpserts: [changed] }));
    expect((await loadAccountFieldDefinitionGraph(accountId)).currentOwners[0]!.definition).toMatchObject(changed.definition);

    const { params: _params, typeScheme: _scheme, ...groundDefinition } = persisted.definition;
    await executeFieldDefinitionPersistencePlan(accountId, plan({ ownerUpserts: [{ ...persisted, definition: groundDefinition }] }));
    const ground = (await listTypes(accountId)).find(row => row.name === declared.storageName)!;
    expect(ground.declaration).toBeNull();
    expect(ground.typeScheme).toBeUndefined();
  });

  const faultPoints: FieldDefinitionFaultPoint[] = [
    { phase: "owner", index: 0 },
    { phase: "field", index: 0 },
    { phase: "facet-upsert", index: 0 },
    { phase: "facet-upsert", index: 1 },
  ];

  for (const faultPoint of faultPoints) {
    test(`rolls back after ${faultPoint.phase}[${faultPoint.index}]`, async () => {
      const accountId = await createTestAccount();
      const f = field();
      const p = plan({
        ownerUpserts: [owner(`rollback_${faultPoint.phase}_${faultPoint.index}`)],
        fieldUpserts: [f],
        facetUpserts: [facet(f), facet(f, "Labelable")],
      });
      let injected: unknown;
      try {
        await executeFieldDefinitionPersistencePlan(accountId, p, {
          faultInjector: (point) => {
            if (point.phase === faultPoint.phase && point.index === faultPoint.index) {
              throw new Error("injected transaction failure");
            }
          },
        });
      } catch (error) {
        injected = error;
      }
      expect(injected).toBeInstanceOf(Error);
      expect((injected as Error).message).toBe("injected transaction failure");
      expect(await counts(accountId)).toEqual({
        types: 0,
        functions: 0,
        instances: 0,
      });
    });
  }

  test("a stable Field/facet plan is idempotent", async () => {
    const accountId = await createTestAccount();
    const f = field();
    const p = plan({ fieldUpserts: [f], facetUpserts: [facet(f)] });
    await executeFieldDefinitionPersistencePlan(accountId, p);
    await executeFieldDefinitionPersistencePlan(accountId, p);
    const rows = await getDb()
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.accountId, accountId));
    expect(rows.filter((row) => row.entityType === "Field")).toHaveLength(1);
    expect(rows.filter((row) => row.entityType === "Codeable")).toHaveLength(1);
  });

  test("captured commands persist the locked physical before-image before planning", async () => {
    const accountId = await createTestAccount();
    const storedOwner = owner("CapturedBeforeImage");
    await executeFieldDefinitionPersistencePlan(accountId, plan({
      ownerUpserts: [storedOwner],
      snapshot: { owners: [storedOwner], fields: [], facets: [] },
    }));
    let plannerRan = false;
    let capturedRows: readonly string[] = [];
    let rejected: unknown;

    try {
      await executeCapturedFieldDefinitionCommandTransaction(
        accountId,
        () => {
          plannerRan = true;
          return plan({});
        },
        {
          persistBeforeImage: (rows) => {
            capturedRows = rows;
            throw new Error("backup unavailable");
          },
        },
      );
    } catch (error) {
      rejected = error;
    }

    expect((rejected as Error).message).toBe("backup unavailable");
    expect(plannerRan).toBe(false);
    expect(capturedRows).toHaveLength(1);
    const captured = JSON.parse(capturedRows[0]!) as {
      _table: string;
      row: Record<string, unknown>;
    };
    expect(captured._table).toBe("types");
    expect(captured.row["account_id"]).toBe(accountId);
    expect(
      (await loadAccountFieldDefinitionGraph(accountId)).currentOwners,
    ).toHaveLength(1);
  });

  for (const deleteIndex of [0, 1]) {
    test(`rolls back between facet deletes at index ${deleteIndex}`, async () => {
      const accountId = await createTestAccount();
      const f = field();
      await executeFieldDefinitionPersistencePlan(
        accountId,
        plan({ fieldUpserts: [f], facetUpserts: [facet(f), facet(f, "Labelable")] }),
      );
      const persisted = await getDb()
        .select()
        .from(entityInstances)
        .where(eq(entityInstances.accountId, accountId));
      const deletes = persisted
        .filter((row) => row.entityType === "Codeable" || row.entityType === "Labelable")
        .map((row) => ({
          ...facet(f, row.entityType as "Codeable" | "Labelable"),
          rowId: row.id,
        }));
      let injected: unknown;
      try {
        await executeFieldDefinitionPersistencePlan(
          accountId,
          plan({ facetDeletes: deletes }),
          {
            faultInjector: (point) => {
              if (point.phase === "facet-delete" && point.index === deleteIndex) {
                throw new Error("injected facet delete failure");
              }
            },
          },
        );
      } catch (error) {
        injected = error;
      }
      expect(injected).toBeInstanceOf(Error);
      const after = await getDb()
        .select()
        .from(entityInstances)
        .where(eq(entityInstances.accountId, accountId));
      expect(after.filter((row) => row.entityType === "Codeable")).toHaveLength(1);
      expect(after.filter((row) => row.entityType === "Labelable")).toHaveLength(1);
    });
  }

  test("last-occurrence tombstone retains its Field and Codeable while deleting optional facets", async () => {
    const accountId = await createTestAccount();
    const live = field();
    await executeFieldDefinitionPersistencePlan(
      accountId,
      plan({
        fieldUpserts: [live],
        facetUpserts: [facet(live), facet(live, "Labelable")],
      }),
    );
    const stored = await getDb()
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.accountId, accountId));
    const codeableRow = stored.find((row) => row.entityType === "Codeable")!;
    const labelRow = stored.find((row) => row.entityType === "Labelable")!;
    const tombstone = { ...live, status: "tombstoned" as const };
    await executeFieldDefinitionPersistencePlan(
      accountId,
      plan({
        fieldTombstones: [tombstone],
        facetUpserts: [{ ...facet(tombstone), rowId: codeableRow.id }],
        facetDeletes: [{ ...facet(live, "Labelable"), rowId: labelRow.id }],
      }),
    );
    const after = await getDb()
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.accountId, accountId));
    const graph = await loadAccountFieldDefinitionGraph(accountId);
    expect(graph.currentFields).toHaveLength(1);
    expect(graph.currentFields[0]!.status).toBe("tombstoned");
    expect(after.filter((row) => row.entityType === "Codeable")).toHaveLength(1);
    expect(after.filter((row) => row.entityType === "Labelable")).toHaveLength(0);
  });

  test("concurrent saves of one logical facet converge to one row", async () => {
    const accountId = await createTestAccount();
    const f = field();
    const p = plan({ fieldUpserts: [f], facetUpserts: [facet(f)] });
    await Promise.all([
      executeFieldDefinitionPersistencePlan(accountId, p),
      executeFieldDefinitionPersistencePlan(accountId, p),
    ]);
    const rows = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.entityType, "Codeable"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  test("concurrent same-owner commands replan from the serially committed graph", async () => {
    const accountId = await createTestAccount();
    const ownerName = "concurrent_owner";
    const fieldIds = [crypto.randomUUID(), crypto.randomUUID()];
    const observedFieldCounts: number[] = [];

    await Promise.all(fieldIds.map((fieldId, index) =>
      executeFieldDefinitionCommandTransaction(accountId, (current) => {
        const existing = current.currentOwners.find(
          (candidate) => candidate.ownerKey === `type:${ownerName}`,
        );
        const definition = existing?.definition as
          | { type?: { $record?: { fields?: FieldDef[] } } }
          | undefined;
        const currentOccurrences = definition?.type?.$record?.fields ?? [];
        observedFieldCounts.push(currentOccurrences.length);
        return plan({
          ownerUpserts: [{
            ownerKey: `type:${ownerName}`,
            kind: "type",
            storageName: ownerName,
            ...(existing?.storageId === undefined
              ? {}
              : { storageId: existing.storageId }),
            definition: {
              id: ownerName,
              type: {
                $record: {
                  fields: [...currentOccurrences, {
                    name: `field_${index}`,
                    key: { $tag: "NamedField", ref: { $ref: fieldId } },
                    type: { $ref: "String" },
                    label: { $tag: "Nothing" },
                    ui: { $tag: "Nothing" },
                    meta: {},
                  }],
                },
              },
            },
          }],
          fieldUpserts: [field(fieldId)],
        });
      })
    ));

    const committed = await loadAccountFieldDefinitionGraph(accountId);
    const savedOwner = committed.currentOwners.find(
      (candidate) => candidate.ownerKey === `type:${ownerName}`,
    );
    const savedOccurrences = (
      savedOwner?.definition as { type?: { $record?: { fields?: { name: string }[] } } }
    )?.type?.$record?.fields ?? [];
    expect(observedFieldCounts.sort()).toEqual([0, 1]);
    expect(savedOccurrences.map((occurrence) => occurrence.name).sort()).toEqual([
      "field_0",
      "field_1",
    ]);
    expect(committed.currentFields.map((candidate) => candidate.id).sort()).toEqual(
      [...fieldIds].sort(),
    );
  });

  test("a stale or forged owner storage id cannot take over a sibling row", async () => {
    const accountId = await createTestAccount();
    const db = getDb();
    const [protectedType] = await db.insert(types).values({
      accountId,
      name: "protected_type",
      type: { $record: { fields: [] } },
      isSystem: false,
    }).returning();
    const [protectedFunction] = await db.insert(functions).values({
      accountId,
      name: "protected_function",
      function: {
        id: "protected_function",
        params: [],
        returns: { $ref: "Unit" },
      },
      version: 1,
      active: true,
      isSystem: false,
    }).returning();

    let typeConflict: unknown;
    try {
      await executeFieldDefinitionPersistencePlan(accountId, plan({
        ownerUpserts: [{
          ownerKey: "type:forged_type",
          kind: "type",
          storageName: "forged_type",
          storageId: protectedType!.id,
          definition: {
            id: "forged_type",
            type: { $record: { fields: [] } },
          },
        }],
      }));
    } catch (error) {
      typeConflict = error;
    }
    expect(typeConflict).toBeInstanceOf(FieldDefinitionPersistenceConflict);

    let functionConflict: unknown;
    try {
      await executeFieldDefinitionPersistencePlan(accountId, plan({
        ownerUpserts: [{
          ownerKey: "function:forged_function",
          kind: "function",
          storageName: "forged_function",
          storageId: protectedFunction!.id,
          definition: {
            id: "forged_function",
            params: [],
            returns: { $ref: "Unit" },
          },
        }],
      }));
    } catch (error) {
      functionConflict = error;
    }
    expect(functionConflict).toBeInstanceOf(FieldDefinitionPersistenceConflict);

    const [typeAfter] = await db.select().from(types)
      .where(eq(types.id, protectedType!.id));
    const [functionAfter] = await db.select().from(functions)
      .where(eq(functions.id, protectedFunction!.id));
    expect(typeAfter?.name).toBe("protected_type");
    expect(typeAfter?.type).toEqual({ $record: { fields: [] } });
    expect(functionAfter?.name).toBe("protected_function");
    expect(functionAfter?.function).toEqual({
      id: "protected_function",
      params: [],
      returns: { $ref: "Unit" },
    });
  });

  test("type owner render-template metadata round-trips without clearing omitted values", async () => {
    const accountId = await createTestAccount();
    const name = "templated_owner";
    await executeFieldDefinitionPersistencePlan(accountId, plan({
      ownerUpserts: [{
        ownerKey: `type:${name}`,
        kind: "type",
        storageName: name,
        definition: {
          id: name,
          type: { $record: { fields: [] } },
          defaultTemplate: "detail-v1",
          defaultTemplateInline: "inline-v1",
        },
      }],
    }));

    const created = await loadAccountFieldDefinitionGraph(accountId);
    const createdOwner = created.currentOwners.find(
      (candidate) => candidate.ownerKey === `type:${name}`,
    );
    expect(createdOwner?.definition).toMatchObject({
      defaultTemplate: "detail-v1",
      defaultTemplateInline: "inline-v1",
    });

    await executeFieldDefinitionPersistencePlan(accountId, plan({
      ownerUpserts: [{
        ownerKey: `type:${name}`,
        kind: "type",
        storageName: name,
        storageId: createdOwner!.storageId,
        definition: {
          id: name,
          type: { $record: { fields: [] } },
          defaultTemplate: "detail-v2",
        },
      }],
    }));

    const updated = await loadAccountFieldDefinitionGraph(accountId);
    const updatedOwner = updated.currentOwners.find(
      (candidate) => candidate.ownerKey === `type:${name}`,
    );
    expect(updatedOwner?.definition).toMatchObject({
      defaultTemplate: "detail-v2",
      defaultTemplateInline: "inline-v1",
    });
  });

  test("cross-account dispatch ids cannot be read, changed, or deleted", async () => {
    const accountA = await createTestAccount();
    const accountB = await createTestAccount();
    const f = field();
    await executeFieldDefinitionPersistencePlan(
      accountB,
      plan({ fieldUpserts: [f], facetUpserts: [facet(f)] }),
    );
    const [row] = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountB),
          eq(entityInstances.entityType, "Codeable"),
        ),
      );
    expect(row).toBeDefined();
    expect(await getDispatchInstance(accountA, row!.id)).toBeNull();
    expect(
      await updateDispatchInstance(accountA, row!.id, {
        instance: { methods: { codeName: "stolen" } },
      }),
    ).toBeNull();
    await deleteDispatchInstance(accountA, row!.id);
    const [preserved] = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountB),
          eq(entityInstances.id, row!.id),
        ),
      );
    expect(preserved).toBeDefined();
  });

  test("generic entity and dispatch helpers cannot mutate Field control-plane rows", async () => {
    const accountId = await createTestAccount();
    const f = field();
    await executeFieldDefinitionPersistencePlan(
      accountId,
      plan({ fieldUpserts: [f], facetUpserts: [facet(f)] }),
    );

    await expectFieldControlPlaneConflict(createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [f.id],
      instance: { methods: { label: "bypass" } },
    }));
    await expectFieldControlPlaneConflict(createEntityInstance(accountId, "Field", {}));
    await expectFieldControlPlaneConflict(createEntityInstance(accountId, "Labelable", {
      type: "Labelable",
      args: [f.id],
      targetEntityType: "Field",
      methods: { label: "bypass" },
    }));

    const rows = await getDb()
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.accountId, accountId));
    const fieldRow = rows.find((row) => row.entityType === "Field");
    const facetRow = rows.find((row) => row.entityType === "Codeable");
    expect(fieldRow).toBeDefined();
    expect(facetRow).toBeDefined();
    await expectFieldControlPlaneConflict(
      updateEntityInstance(accountId, fieldRow!.id, {}),
    );
    await expectFieldControlPlaneConflict(deleteEntityInstance(accountId, fieldRow!.id));
    await expectFieldControlPlaneConflict(updateEntityInstance(accountId, facetRow!.id, {
      methods: { codeName: "bypass" },
    }));
    await expectFieldControlPlaneConflict(deleteEntityInstance(accountId, facetRow!.id));
    await expectFieldControlPlaneConflict(updateDispatchInstance(accountId, facetRow!.id, {
      instance: { methods: { codeName: "bypass" } },
    }));
    await expectFieldControlPlaneConflict(deleteDispatchInstance(accountId, facetRow!.id));

    const [preserved] = await getDb()
      .select()
      .from(entityInstances)
      .where(eq(entityInstances.id, facetRow!.id));
    expect(preserved?.data).toEqual(facetRow!.data);
  });

  test("a dangling representation UUID cannot be pre-seeded before its Field exists", async () => {
    const accountId = await createTestAccount();
    const f = field();
    await expectFieldControlPlaneConflict(createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [f.id],
      instance: { methods: { label: "preseed" }, scope: "account", priority: 100 },
    }));

    await executeFieldDefinitionPersistencePlan(
      accountId,
      plan({ fieldUpserts: [f], facetUpserts: [facet(f)] }),
    );
    const graph = await loadAccountFieldDefinitionGraph(accountId);
    expect(graph.currentFacets.map((candidate) => candidate.typeName)).toEqual(["Codeable"]);
  });

  test("generic preseed and bundle creation races serialize with the bundle winning", async () => {
    const accountId = await createTestAccount();
    const f = field();
    const [generic, bundle] = await Promise.allSettled([
      createDispatchInstance(accountId, {
        typeName: "Labelable",
        args: [f.id],
        instance: { methods: { label: "racing preseed" }, scope: "account" },
      }),
      executeFieldDefinitionPersistencePlan(
        accountId,
        plan({ fieldUpserts: [f], facetUpserts: [facet(f)] }),
      ),
    ]);
    expect(generic.status).toBe("rejected");
    expect((generic as PromiseRejectedResult).reason)
      .toBeInstanceOf(FieldControlPlaneWriteConflict);
    expect(bundle.status).toBe("fulfilled");
    const graph = await loadAccountFieldDefinitionGraph(accountId);
    expect(graph.currentFields.map((candidate) => candidate.id)).toEqual([f.id]);
    expect(graph.currentFacets.map((candidate) => candidate.typeName)).toEqual(["Codeable"]);
  });

  test("strict product reads admit only fully marked canonical Field facets", async () => {
    const accountId = await createTestAccount();
    const f = field();
    await executeFieldDefinitionPersistencePlan(accountId, plan({ fieldUpserts: [f] }));
    await getDb().insert(entityInstances).values([
      {
        id: crypto.randomUUID(),
        accountId,
        entityType: "Labelable",
        data: {
          type: "Labelable",
          args: [f.id],
          methods: { label: "legacy" },
          scope: "account",
        },
      },
      {
        id: crypto.randomUUID(),
        accountId,
        entityType: "Iconable",
        data: {
          type: "wrong-interface",
          args: [f.id],
          methods: { icon: "wrong" },
          scope: "account",
          targetEntityType: "Field",
        },
      },
    ]);

    expect((await loadAccountFieldDefinitionGraph(accountId)).currentFacets).toEqual([]);
    const migration = await loadAccountFieldDefinitionMigrationGraph(accountId);
    expect(migration.currentFacets).toHaveLength(1);
    expect(migration.currentFacets[0]).toMatchObject({
      typeName: "Labelable",
      storageCanonical: false,
    });
  });

  test("general live and repository representations remain valid while reservations fail closed", async () => {
    const accountId = await createTestAccount();
    const targetId = crypto.randomUUID();
    await getDb().insert(entityInstances).values({
      id: targetId,
      accountId,
      entityType: "profile",
      data: {},
    });
    await createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [targetId],
      instance: { methods: { label: "low" }, scope: "account", priority: 10 },
    });
    await createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [targetId],
      instance: { methods: { label: "high" }, scope: "account", priority: 20 },
    });
    const rows = await getDb().select().from(entityInstances).where(and(
      eq(entityInstances.accountId, accountId),
      eq(entityInstances.entityType, "Labelable"),
    ));
    expect(rows).toHaveLength(2);

    const repositoryType = REPOSITORY_IDENTITY_MANIFEST.entries.find(
      ([, , kind]) => kind === "type",
    )!;
    expect(await createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [repositoryType[1]],
      instance: { methods: { label: "repository type" } },
    })).toBeDefined();
    const reserved = REPOSITORY_IDENTITY_MANIFEST.entries.find(
      ([, , kind]) => kind === "reserved",
    )!;
    await expectFieldControlPlaneConflict(createDispatchInstance(accountId, {
      typeName: "Labelable",
      args: [reserved[1]],
      instance: { methods: { label: "reserved" } },
    }));
  });

  test("the account graph loader normalizes legacy function name/id from the authoritative storage name", async () => {
    const accountId = await createTestAccount();
    const storageName = "stored_function_name";
    await getDb().insert(functions).values({
      accountId,
      name: storageName,
      isSystem: false,
      function: {
        name: "stale_payload_name",
        params: [],
        returns: { $ref: "Unit" },
      },
    });
    const graph = await loadAccountFieldDefinitionGraph(accountId);
    const loaded = graph.currentOwners.find((candidate) => candidate.kind === "function");
    expect(loaded?.storageName).toBe(storageName);
    expect((loaded?.definition as Record<string, unknown>)["id"]).toBe(storageName);
    expect("name" in (loaded?.definition as Record<string, unknown>)).toBe(false);
  });
});
