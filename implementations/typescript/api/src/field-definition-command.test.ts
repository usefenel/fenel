import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type {
  AccountFieldDefinitionGraph,
  StoredFieldPersistencePlan,
} from "@fenel/db";
import {
  accounts,
  closeDb,
  entityInstances,
  functions,
  getDb,
  types,
} from "@fenel/db";
import type { FieldDefinitionCommandDependencies } from "@fenel/core/field-definition-command";
import {
  executeFieldDefinitionCatalogQuery,
  executeFieldDefinitionCommand,
  executeFieldDefinitionIdentityQuery,
  executeFieldDefinitionResurrectionQuery,
  fieldDefinitionCatalogToWire,
} from "./field-definition-command";

const emptyGraph: AccountFieldDefinitionGraph = {
  currentOwners: [],
  currentFields: [],
  currentFacets: [],
  storageIssues: [],
};

const emptyPlan: StoredFieldPersistencePlan = {
  ownerUpserts: [],
  ownerDeletes: [],
  fieldUpserts: [],
  fieldTombstones: [],
  facetUpserts: [],
  facetDeletes: [],
  retainedFacets: [],
  snapshot: { owners: [], fields: [], facets: [] },
};

const Nothing = { $tag: "Nothing" } as const;
const Just = <T>(value: T) => ({ $tag: "Just" as const, _0: value });

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

describe("field definition command", () => {

  test("an actual reservation refusal aborts a mixed edit/create bundle before any transaction write", async () => {
    const { tryPlanFieldPersistence } = await import("@fenel/engine/field-authoring");
    const { repositoryIdentityKinds } = await import("@fenel/engine/repository-identity-manifest");
    const reserved = [...repositoryIdentityKinds()].find(([, kind]) => kind === "function")?.[0];
    if (!reserved) throw new Error("Expected a repository function reservation");
    const previous = { ownerKey: "type:LegacySizing", storageName: "LegacySizing", kind: "type" as const,
      storageId: "f0f0f0f0-0000-4000-8000-000000000013",
      definition: { id: "LegacySizing", type: { $ref: "Number" } } };
    const edited = { ...previous, definition: { id: "LegacySizing", type: { $ref: "String" } } };
    let writes = 0, validations = 0;
    const result = await executeFieldDefinitionCommand("identity-reservations", { ownerMutations: [
      { kind: "upsert", owner: edited },
      { kind: "upsert", owner: { ownerKey: `function:${reserved}`, storageName: reserved, kind: "function",
        definition: { id: reserved, params: [], returns: { $ref: "Number" }, body: 1 } } },
    ] }, {
      plan: tryPlanFieldPersistence,
      validateSnapshot: () => { validations++; },
      executeTransaction: async (_accountId, planCurrent) => {
        const planned = await planCurrent({ ...emptyGraph, currentOwners: [previous] });
        writes++;
        return planned.snapshot;
      },
    });
    expect(result).toMatchObject({ ok: false, error: {
      $tag: "ReservedDefinitionIdentity", handle: reserved, repositoryKind: "function",
    } });
    expect(validations).toBe(0);
    expect(writes).toBe(0);
  });
  test("a declaration-only binder identity change rejects the stale draft before planning", async () => {
    let plans = 0;
    let writes = 0;
    const previous = {
      ownerKey: "type:Generic", kind: "type" as const, storageName: "Generic",
      storageId: "11111111-1111-4111-8111-111111111111",
      definition: { id: "Generic", type: { $var: "a" }, params: [{ name: "a", constraints: [] }],
        typeScheme: { body: { $var: "a" }, quantified: [{ id: "q-original", sourceName: "a", kind: { $tag: "KType" as const } }] },
      },
    };
    const updated = { ...previous, definition: { ...previous.definition,
      typeScheme: { ...previous.definition.typeScheme, quantified: [{ ...previous.definition.typeScheme.quantified[0]!, id: "q-replaced" }] },
    } };
    const result = await executeFieldDefinitionCommand(crypto.randomUUID(), {
      ownerMutations: [], expectedSnapshot: { owners: [previous], fields: [], facets: [] },
    }, {
      plan: () => { plans++; return { ok: true, value: emptyPlan }; },
      executeTransaction: async (_accountId, planCurrent) => {
        const planned = await planCurrent({ ...emptyGraph, currentOwners: [updated] });
        writes++;
        return planned.snapshot;
      },
    });
    expect(result).toMatchObject({ ok: false, error: { $tag: "PersistenceConflict" } });
    expect(plans).toBe(0);
    expect(writes).toBe(0);
  });
  test("a stale definition draft rejects under the transaction before planning or writing", async () => {
    let plans = 0;
    let writes = 0;
    const current = { ...emptyGraph, currentOwners: [{
      ownerKey: "type:Contact", kind: "type" as const, storageName: "Contact",
      storageId: "11111111-1111-4111-8111-111111111111",
      definition: { id: "Contact", type: { $ref: "String" } },
    }] };
    const result = await executeFieldDefinitionCommand(crypto.randomUUID(), {
      ownerMutations: [], expectedSnapshot: emptyPlan.snapshot,
    }, {
      plan: () => { plans++; return { ok: true, value: emptyPlan }; },
      executeTransaction: async (_accountId, planCurrent) => {
        const plan = await planCurrent(current);
        writes++;
        return plan.snapshot;
      },
    });
    expect(result).toEqual({ ok: false, error: { $tag: "PersistenceConflict", message: "Definitions changed since this draft was opened" } });
    expect(plans).toBe(0);
    expect(writes).toBe(0);
  });

  test("an unchanged definition draft plans from the locked graph", async () => {
    let writes = 0;
    const result = await executeFieldDefinitionCommand(crypto.randomUUID(), {
      ownerMutations: [], expectedSnapshot: emptyPlan.snapshot,
    }, {
      plan: () => ({ ok: true, value: emptyPlan }),
      executeTransaction: async (_accountId, planCurrent) => {
        const plan = await planCurrent(emptyGraph);
        writes++;
        return plan.snapshot;
      },
    });
    expect(result).toEqual({ ok: true, snapshot: emptyPlan.snapshot });
    expect(writes).toBe(1);
  });
  test("a Fenel planner error rejects before any transaction write", async () => {
    let writes = 0;
    const dependencies: FieldDefinitionCommandDependencies = {
      plan: () => ({
        ok: false,
        error: {
          $tag: "AmbiguousOwnerStorage",
          message: "ambiguous owner storage",
        },
      }),
      executeTransaction: async (_accountId, planCurrent) => {
        const planned = await planCurrent(emptyGraph);
        writes++;
        return planned.snapshot;
      },
    };
    const result = await executeFieldDefinitionCommand(
      crypto.randomUUID(),
      { ownerMutations: [], desiredFacets: [] },
      dependencies,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        $tag: "AmbiguousOwnerStorage",
        message: "ambiguous owner storage",
      },
    });
    expect(writes).toBe(0);
  });

  test("body-spelling validation rejects the planned account bundle before commit", async () => {
    const accountId = crypto.randomUUID();
    let writes = 0;
    let validatedSnapshot: unknown;
    const diagnostic = {
      $tag: "UnresolvedFieldSpelling",
      message: "unresolved constructor-pattern field spelling oldPayload",
      owner: "account:probe",
      path: "body.match[1].oldPayload",
      spelling: "oldPayload",
      candidates: ["payload"],
      kind: "unresolved",
    };
    const dependencies: FieldDefinitionCommandDependencies = {
      plan: () => ({ ok: true, value: emptyPlan }),
      validateSnapshot: (_targetAccount, snapshot) => {
        validatedSnapshot = snapshot;
        const rejected = new Error(diagnostic.message) as Error & {
          diagnostic: typeof diagnostic;
        };
        rejected.diagnostic = diagnostic;
        throw rejected;
      },
      executeTransaction: async (_targetAccount, planCurrent) => {
        const planned = await planCurrent(emptyGraph);
        writes++;
        return planned.snapshot;
      },
    };

    const result = await executeFieldDefinitionCommand(
      accountId,
      { ownerMutations: [] },
      dependencies,
    );

    expect(validatedSnapshot).toBe(emptyPlan.snapshot);
    expect(result).toEqual({ ok: false, error: diagnostic });
    expect(writes).toBe(0);
  });

  test("passes the complete account graph and mutations to Fenel, then returns the committed snapshot", async () => {
    const accountId = crypto.randomUUID();
    const mutation = {
      kind: "upsert" as const,
      owner: {
        ownerKey: "type:contact",
        kind: "type" as const,
        storageName: "contact",
        definition: { id: "contact", type: { $record: { fields: [] } } },
      },
    };
    let plannerInput: unknown;
    let executedAccount: string | undefined;
    const committed = {
      owners: [{ ...mutation.owner, storageId: crypto.randomUUID() }],
      fields: [],
      facets: [],
    };
    const dependencies: FieldDefinitionCommandDependencies = {
      plan: (input) => {
        plannerInput = input;
        return { ok: true, value: emptyPlan };
      },
      executeTransaction: async (targetAccount, planCurrent) => {
        executedAccount = targetAccount;
        const value = await planCurrent(emptyGraph);
        expect(value).toBe(emptyPlan);
        return committed;
      },
    };
    const result = await executeFieldDefinitionCommand(
      accountId,
      {
        ownerMutations: [mutation],
        desiredFacets: [],
        replaceFacetFieldIds: ["11111111-1111-4111-8111-111111111111"],
        resurrectFieldIds: ["11111111-1111-4111-8111-111111111111"],
      },
      dependencies,
    );
    expect(plannerInput).toEqual({
      ...emptyGraph,
      ownerMutations: [mutation],
      desiredFacets: [],
      replaceFacetFieldIds: ["11111111-1111-4111-8111-111111111111"],
      resurrectFieldIds: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(executedAccount).toBe(accountId);
    expect(result).toEqual({ ok: true, snapshot: committed });
  });

  test("preserves an omitted desiredFacets request as undefined", async () => {
    let plannerInput: Parameters<FieldDefinitionCommandDependencies["plan"]>[0] | undefined;
    const dependencies: FieldDefinitionCommandDependencies = {
      plan: (input) => {
        plannerInput = input;
        return { ok: true, value: emptyPlan };
      },
      executeTransaction: async (_accountId, planCurrent) => {
        const planned = await planCurrent(emptyGraph);
        return planned.snapshot;
      },
    };
    const result = await executeFieldDefinitionCommand(
      crypto.randomUUID(),
      { ownerMutations: [] },
      dependencies,
    );
    expect(result.ok).toBe(true);
    expect(plannerInput).toBeDefined();
    expect("desiredFacets" in plannerInput!).toBe(false);
  });

  test("rejects forged cross-owner reuse and moves of an owner-only Field", async () => {
    const accountId = crypto.randomUUID();
    const fieldId = "11111111-1111-4111-8111-111111111111";
    const targetId = "f0f0f0f0-0000-4000-8000-000000000014";
    const sourceOwner = {
      ownerKey: "type:source",
      kind: "type" as const,
      storageName: "source",
      storageId: "source-row",
      definition: {
        id: "source",
        type: {
          $record: {
            fields: [{
              name: "payload",
              key: { $tag: "NamedField" as const, ref: { $ref: fieldId } },
              type: { $ref: "String" },
              label: Nothing,
              ui: Nothing,
              meta: {},
            }],
          },
        },
      },
    };
    const targetOwner = {
      ownerKey: `type:${targetId}`,
      kind: "type" as const,
      storageName: targetId,
      definition: {
        id: targetId,
        type: structuredClone(sourceOwner.definition.type),
      },
    };
    const current: AccountFieldDefinitionGraph = {
      currentOwners: [sourceOwner],
      currentFields: [{
        id: fieldId,
        currentCodeName: "payload",
        status: "live",
        realm: "account",
        reuseVisibility: "owner",
        origin: {
          owner: { $tag: "TypeFieldOwner", module: Nothing, localId: "source" },
          path: [{ $tag: "FieldNamed", name: "payload" }],
        },
      }],
      currentFacets: [{
        rowId: "22222222-2222-4222-8222-222222222222",
        fieldId,
        typeName: "Codeable",
        methods: { codeName: "payload" },
        scope: "account",
        priority: 100,
      }],
      storageIssues: [],
    };
    let physicalWrites = 0;
    const dependencies: Partial<FieldDefinitionCommandDependencies> = {
      executeTransaction: async (_targetAccount, planCurrent) => {
        const planned = await planCurrent(current);
        physicalWrites++;
        return planned.snapshot;
      },
    };

    const directReuse = await executeFieldDefinitionCommand(accountId, {
      ownerMutations: [{ kind: "upsert", owner: targetOwner }],
    }, dependencies);
    expect(directReuse.ok).toBe(false);
    if (!directReuse.ok) expect(directReuse.error.$tag).toBe("FieldReuseNotVisible");

    const forgedMove = await executeFieldDefinitionCommand(accountId, {
      ownerMutations: [
        {
          kind: "upsert",
          owner: {
            ownerKey: "type:source",
            kind: "type",
            storageName: "source",
            definition: { id: "source", type: { $record: { fields: [] } } },
          },
        },
        { kind: "upsert", owner: targetOwner },
      ],
    }, dependencies);
    expect(forgedMove.ok).toBe(false);
    if (!forgedMove.ok) expect(forgedMove.error.$tag).toBe("FieldReuseNotVisible");
    expect(physicalWrites).toBe(0);
    // rights R2a — the authority mint warms the execution registry on the
    // first call in a process. The build is memoised and the API server pays
    // it at boot in production; here it lands inside the 5s default.
  }, 300_000);
});

const integration = process.env["DATABASE_URL"] ? describe : describe.skip;
const integrationAccounts: string[] = [];

integration("field definition command integration", () => {
  test("repository subpath loading preserves nonempty catalog order, identity and facets", async () => {
    const { repositoryFieldCatalog, queryRepositoryFieldReuse } = await import("@fenel/engine/repository-field-catalog");
    const accountId = crypto.randomUUID();
    integrationAccounts.push(accountId);
    await getDb().insert(accounts).values({ id: accountId, slug: `l2a-catalog-${accountId}`, name: "Repository catalog parity" });
    const actual = await executeFieldDefinitionCatalogQuery(accountId, { limit: 5 });
    const repository = repositoryFieldCatalog();
    expect(repository.fields.length).toBeGreaterThan(0);
    const expected = queryRepositoryFieldReuse({ limit: 5 });
    expect(expected.fields.length).toBeGreaterThan(0);
    expect(fieldDefinitionCatalogToWire(actual)).toEqual(fieldDefinitionCatalogToWire({
      fields: [...expected.fields], facetInterfaceNames: expected.facetInterfaceNames,
      ...(expected.nextCursor === undefined ? {} : { nextCursor: expected.nextCursor }),
    }));
    expect(actual.facetInterfaceNames).toEqual(repository.facetInterfaceNames);
    for (const row of expected.fields) {
      const identity = await executeFieldDefinitionIdentityQuery(accountId, row.fieldId);
      expect(identity).toBeDefined();
      expect(identity?.fieldId).toBe(row.fieldId);
      expect(identity?.codeName).toBe(row.codeName);
      expect(identity?.owners).toEqual(row.owners);
      expect(identity?.occurrenceTypes).toEqual(row.occurrenceTypes);
    }
  }, 300_000);

  afterAll(async () => {
    const db = getDb();
    for (const accountId of integrationAccounts) {
      await db.delete(entityInstances).where(eq(entityInstances.accountId, accountId));
      await db.delete(functions).where(eq(functions.accountId, accountId));
      await db.delete(types).where(eq(types.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
    }
    await closeDb();
  });

  test("plans, commits, returns actual row ids, and converges on retry", async () => {
    const accountId = crypto.randomUUID();
    const fieldId = crypto.randomUUID();
    integrationAccounts.push(accountId);
    await getDb().insert(accounts).values({
      id: accountId,
      slug: `field-command-test-${accountId}`,
      name: "Field command integration test",
    });
    const request = {
      ownerMutations: [{
        kind: "upsert" as const,
        owner: {
          ownerKey: "type:contact",
          kind: "type" as const,
          storageName: "contact",
          definition: {
            id: "contact",
            type: {
              $record: {
                fields: [{
                  name: "email",
                  key: { $tag: "NamedField" as const, ref: { $ref: fieldId } },
                  type: { $ref: "String" },
                  label: { $tag: "Nothing" as const },
                  ui: { $tag: "Nothing" as const },
                  meta: {},
                }],
              },
            },
          },
        },
      }],
      desiredFacets: [{
        fieldId,
        typeName: "Labelable" as const,
        methods: { label: "Email" },
      }],
      replaceFacetFieldIds: [fieldId],
    };
    const first = await executeFieldDefinitionCommand(accountId, request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.snapshot.owners[0]?.storageId).toBeDefined();
    expect(first.snapshot.fields.map((field) => field.id)).toEqual([fieldId]);
    expect(first.snapshot.facets).toHaveLength(2);
    expect(first.snapshot.facets.every((facet) => facet.rowId !== undefined)).toBe(true);

    const persistedFacets = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.entityType, "Labelable"),
        ),
      );
    expect(persistedFacets).toHaveLength(1);
    expect(
      (persistedFacets[0]!.data as Record<string, unknown>)["targetEntityType"],
    ).toBe("Field");

    const second = await executeFieldDefinitionCommand(accountId, request);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.snapshot.owners[0]?.storageId).toBe(
      first.snapshot.owners[0]?.storageId,
    );
    expect(second.snapshot.facets.map((facet) => facet.rowId).sort()).toEqual(
      first.snapshot.facets.map((facet) => facet.rowId).sort(),
    );

    const labelRowId = first.snapshot.facets.find((facet) => facet.typeName === "Labelable")?.rowId;
    const changed = await executeFieldDefinitionCommand(accountId, {
      ...request,
      desiredFacets: [
        { fieldId, typeName: "Labelable", methods: { label: "Updated email" } },
        { fieldId, typeName: "Displayable", methods: { hint: displayHint({ widget: Just("email") }) } },
      ],
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.snapshot.facets.find((facet) => facet.typeName === "Labelable")?.rowId).toBe(labelRowId);
    expect(changed.snapshot.facets.find((facet) => facet.typeName === "Labelable")?.methods).toEqual({
      label: "Updated email",
    });
    expect(changed.snapshot.facets.find((facet) => facet.typeName === "Displayable")?.methods).toEqual({
      hint: displayHint({ widget: Just("email") }),
    });

    const codeableBeforeRename = changed.snapshot.facets.find(
      (facet) => facet.typeName === "Codeable",
    );
    const codeableRowId = codeableBeforeRename?.rowId;
    expect(codeableRowId).toBeDefined();
    if (codeableRowId === undefined) throw new Error("Committed Codeable row id missing");
    const renamedOwner = structuredClone(request.ownerMutations[0]!.owner);
    renamedOwner.definition.type.$record.fields[0]!.name = "invoice_email";
    const renamedRequest = {
      ownerMutations: [{ kind: "upsert" as const, owner: renamedOwner }],
    };
    const renamed = await executeFieldDefinitionCommand(accountId, renamedRequest);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.snapshot.fields).toContainEqual(
      expect.objectContaining({ id: fieldId, currentCodeName: "invoice_email" }),
    );
    const codeablesAfterRename = renamed.snapshot.facets.filter(
      (facet) => facet.typeName === "Codeable" && facet.fieldId === fieldId,
    );
    expect(codeablesAfterRename).toEqual([
      expect.objectContaining({
        rowId: codeableRowId,
        methods: { codeName: "invoice_email" },
      }),
    ]);
    const persistedCodeablesAfterRename = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.entityType, "Codeable"),
        ),
      );
    expect(persistedCodeablesAfterRename).toHaveLength(1);
    expect(persistedCodeablesAfterRename[0]!.id).toBe(codeableRowId);
    expect(
      (persistedCodeablesAfterRename[0]!.data as Record<string, unknown>)["methods"],
    ).toEqual({ codeName: "invoice_email" });

    const catalog = await executeFieldDefinitionCatalogQuery(accountId, {
      search: "invoice_email",
    });
    expect(catalog.fields).toHaveLength(1);
    expect(catalog.fields[0]?.fieldId).toBe(fieldId);
    expect(catalog.fields[0]?.codeName).toBe("invoice_email");
    expect(catalog.facetInterfaceNames).toContain("Labelable");
    expect(catalog.facetInterfaceNames).toContain("Displayable");
    const wire = fieldDefinitionCatalogToWire(catalog);
    expect(wire.fields[0]?.label).toBe("Updated email");
    expect(wire.fields[0]?.occurrenceTypes.every((type) => typeof type === "string")).toBe(true);

    const exactIdentity = await executeFieldDefinitionIdentityQuery(accountId, fieldId);
    expect(exactIdentity).toEqual(expect.objectContaining({
      fieldId,
      realm: "account",
    }));
    expect(exactIdentity?.owners).toHaveLength(1);

    const otherAccountId = crypto.randomUUID();
    const otherFieldId = crypto.randomUUID();
    integrationAccounts.push(otherAccountId);
    await getDb().insert(accounts).values({
      id: otherAccountId,
      slug: `field-command-test-${otherAccountId}`,
      name: "Other field command integration test",
    });
    const other = await executeFieldDefinitionCommand(otherAccountId, {
      ownerMutations: [{
        kind: "upsert",
        owner: {
          ownerKey: "type:other",
          kind: "type",
          storageName: "other",
          definition: {
            id: "other",
            type: {
              $record: {
                fields: [{
                  name: "otherSecret",
                  key: { $tag: "NamedField", ref: { $ref: otherFieldId } },
                  type: { $ref: "String" },
                  label: { $tag: "Nothing" },
                  ui: { $tag: "Nothing" },
                  meta: {},
                }],
              },
            },
          },
        },
      }],
      desiredFacets: [],
    });
    expect(other.ok).toBe(true);
    const isolated = await executeFieldDefinitionCatalogQuery(accountId, {
      search: "otherSecret",
    });
    expect(isolated.fields).toHaveLength(0);

    const removed = await executeFieldDefinitionCommand(accountId, {
      ownerMutations: [{
        kind: "delete",
        ownerKey: "type:contact",
        ownerKind: "type",
        storageName: "contact",
      }],
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.snapshot.fields[0]?.status).toBe("tombstoned");
    const afterDelete = await executeFieldDefinitionCatalogQuery(accountId, {
      search: "invoice_email",
    });
    expect(afterDelete.fields).toHaveLength(0);
    const wholeOwnerResurrections = await executeFieldDefinitionResurrectionQuery(
      accountId,
      "type:contact",
      { ownerKey: "type:contact", kind: "type", storageName: "contact" },
    );
    expect(wholeOwnerResurrections).toEqual([{ fieldId, codeName: "invoice_email" }]);

    const ordinaryReuse = await executeFieldDefinitionCommand(accountId, renamedRequest);
    expect(ordinaryReuse.ok).toBe(false);
    if (!ordinaryReuse.ok) {
      expect(ordinaryReuse.error.$tag).toBe("TombstonedFieldReuse");
    }

    const resurrected = await executeFieldDefinitionCommand(accountId, {
      ...renamedRequest,
      resurrectFieldIds: [fieldId],
    });
    expect(resurrected.ok).toBe(true);
    if (!resurrected.ok) return;
    expect(resurrected.snapshot.fields).toEqual([
      expect.objectContaining({ id: fieldId, status: "live" }),
    ]);
    const afterResurrection = await executeFieldDefinitionCatalogQuery(accountId, {
      search: "invoice_email",
    });
    expect(afterResurrection.fields.map((field) => field.fieldId)).toEqual([fieldId]);
    // rights R2a — the authority mint warms the execution registry on the first
    // call in a process; the build is memoised and the API server pays it at
    // boot in production.
  }, 300_000);
});
