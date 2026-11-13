import { invalidateRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { and, DrizzleQueryError, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Database } from "../client";
import { entityInstances } from "../schema/entity-instances";
import { functions } from "../schema/functions";
import { types } from "../schema/types";
import {
  durableFieldFromStorageData,
  durableFieldToStorageData,
  type DurableFieldEntity,
  type FieldFacetValue,
  type FieldOwnerDefinition,
  type FieldPersistencePlan,
  type FieldStorageIssue as EngineFieldStorageIssue,
  type AccountFieldDefinitionGraph as EngineAccountFieldDefinitionGraph,
} from "@fenel/engine/field-authoring";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import { functionDefinitionFromJsonWire, functionDefinitionToJsonWire, typeDefinitionFromJsonWire, typeDefinitionToJsonWire, typeFromJsonWire, typeToJsonWire } from "@fenel/engine/authoring/expression";
import { fieldRepresentationalInterfaceNames } from "@fenel/engine/repository-field-catalog";
import {
  withFieldControlPlaneAccountTransaction,
  type FieldControlPlaneTransaction,
} from "./field-control-plane";

export type FieldOwnerKind = "type" | "function";

export type StoredFieldOwnerDefinition = FieldOwnerDefinition;
export type StoredDurableFieldEntity = DurableFieldEntity;
export type StoredFieldFacetValue = FieldFacetValue;
export type FieldStorageIssue = EngineFieldStorageIssue;

export type AccountFieldDefinitionGraph = EngineAccountFieldDefinitionGraph;

export type StoredFieldPersistencePlan = FieldPersistencePlan;

const FIELD_FACET_TYPES = fieldRepresentationalInterfaceNames();

type FieldFacetType = string;

function isFieldFacetType(value: string): value is FieldFacetType {
  return (FIELD_FACET_TYPES as readonly string[]).includes(value);
}

function ownerKey(kind: FieldOwnerKind, storageName: string): string {
  // This is only construction of the engine's documented structural key. The
  // persistence leaf never parses this value; storageName is carried beside it.
  return `${kind}:${storageName}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readDurableField(row: {
  id: string;
  data: Record<string, unknown>;
}): StoredDurableFieldEntity {
  return durableFieldFromStorageData(row.id, row.data);
}

export type FieldDefinitionPhysicalBeforeImageRow = {
  readonly _table: "types" | "functions" | "entity_instances";
  readonly row: Record<string, unknown>;
};

type AccountFieldDefinitionPhysicalSnapshot = {
  graph: AccountFieldDefinitionGraph;
  beforeImage: FieldDefinitionPhysicalBeforeImageRow[];
  /** PostgreSQL-produced JSONB envelope text. This is the recovery artifact;
   * never stringify the JS planner DTO back into a backup because JSON numbers
   * may have exceeded IEEE-754 precision while being decoded. */
  beforeImageText: string[];
};

type FieldDefinitionGraphReader = Pick<Database, "execute">;

type FieldDefinitionSnapshotOptions = {
  /** One-shot migration ingress only. Product readers require the canonical
   * target marker so an unrelated/pre-seeded representation can never become a
   * Field facet merely because a Field later reserves the same UUID. */
  includeLegacyUnmarkedFieldFacets?: boolean;
};

/** Load only the current user-authored definition graph for one account.
 * Repository/system rows are supplied to the planner through the immutable
 * repository catalog, never duplicated from seeded DB rows.
 *
 * All four physical families are aggregated by one SQL statement. PostgreSQL
 * therefore supplies one MVCC statement snapshot even at READ COMMITTED: a
 * catalog/snapshot read cannot combine owners from before a concurrent commit
 * with Fields or facets from after it. The command path can also acquire its
 * advisory lock first and then run this statement, avoiding both torn reads
 * and a REPEATABLE READ snapshot taken before a contended lock is acquired. */
async function loadAccountFieldDefinitionPhysicalSnapshot(
  accountId: string,
  db: FieldDefinitionGraphReader = getDb(),
  options: FieldDefinitionSnapshotOptions = {},
): Promise<AccountFieldDefinitionPhysicalSnapshot> {
  const facetTypes = FIELD_FACET_TYPES.map((typeName) => sql`${typeName}`);
  const rows = await db.execute(sql`
    with physical as (
      select 'types'::text as "_table", to_jsonb(authored_type.*) as row
      from ${types} authored_type
      where authored_type.account_id = ${accountId}
        and authored_type.is_system = false
      union all
      select 'functions'::text as "_table", to_jsonb(authored_function.*) as row
      from ${functions} authored_function
      where authored_function.account_id = ${accountId}
        and authored_function.is_system = false
        and authored_function.source_registry_id is null
      union all
      select 'entity_instances'::text as "_table", to_jsonb(field_value.*) as row
      from ${entityInstances} field_value
      where field_value.account_id = ${accountId}
        and (
          field_value.entity_type = 'Field'
          or field_value.entity_type in (${sql.join(facetTypes, sql`, `)})
        )
    )
    select coalesce(
      array_agg(
        jsonb_build_object('_table', physical."_table", 'row', physical.row)::text
        order by physical."_table", physical.row->>'id'
      ),
      array[]::text[]
    ) as "physicalRowTexts"
    from physical
  `) as unknown as { physicalRowTexts: string[] }[];
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Account field-definition graph query returned no aggregate row");
  }
  const beforeImageText = row.physicalRowTexts;
  if (!Array.isArray(beforeImageText)) {
    throw new Error("Account field-definition physical snapshot was not a text array");
  }
  const beforeImage = beforeImageText.map((text): FieldDefinitionPhysicalBeforeImageRow => {
    const parsed = JSON.parse(text) as Partial<FieldDefinitionPhysicalBeforeImageRow>;
    if (
      !["types", "functions", "entity_instances"].includes(String(parsed._table))
      || parsed.row === null
      || typeof parsed.row !== "object"
      || Array.isArray(parsed.row)
    ) {
      throw new Error("Account field-definition physical snapshot had an invalid envelope");
    }
    return parsed as FieldDefinitionPhysicalBeforeImageRow;
  });
  const typeRows = beforeImage
    .filter((item) => item._table === "types")
    .map((item) => item.row);
  const functionRows = beforeImage
    .filter((item) => item._table === "functions")
    .map((item) => item.row);
  const instanceRows = beforeImage
    .filter((item) => item._table === "entity_instances")
    .map((item) => item.row);
  const fieldRows = instanceRows.filter((item) => item["entity_type"] === "Field");
  const facetRows = instanceRows.filter((item) => item["entity_type"] !== "Field");

  const currentOwners: StoredFieldOwnerDefinition[] = typeRows.map((row) => ({
    ownerKey: ownerKey("type", String(row["name"])),
    kind: "type",
    storageName: String(row["name"]),
    storageId: String(row["id"]),
    definition: {
      ...typeDefinitionFromJsonWire(asRecord(row["declaration"])),
      id: String(row["name"]),
      type: typeFromJsonWire(row["type"] as FenelType),
      defaultTemplate: row["default_template"] as string | null,
      defaultTemplateInline: row["default_template_inline"] as string | null,
    },
  }));
  const storageIssues: FieldStorageIssue[] = [];

  const functionsByName = new Map<string, Record<string, unknown>[]>();
  for (const row of functionRows) {
    const name = String(row["name"]);
    const bucket = functionsByName.get(name) ?? [];
    bucket.push(row);
    functionsByName.set(name, bucket);
  }
  for (const [name, rows] of functionsByName) {
    // The mutable pre-release owner remains editable when execution is
    // paused. Multiple/historical rows still require versioning resolution.
    const active = rows.length === 1 && rows[0]!["version"] === 1
      ? rows
      : rows.filter((row) => row["active"] === true);
    if (active.length !== 1) {
      storageIssues.push({
        ownerKind: "function",
        storageName: name,
        rowIds: rows.map((row) => String(row["id"])).sort(),
        reason: "multiple-current",
      });
      continue;
    }
    if (rows.length !== 1 || active[0]!["version"] !== 1) {
      storageIssues.push({
        ownerKind: "function",
        storageName: name,
        rowIds: rows.map((row) => String(row["id"])).sort(),
        reason: "version-shaped",
      });
    }
    const row = active[0]!;
    const { name: _legacyName, ...storedFunction } = asRecord(row["function"]);
    currentOwners.push({
      ownerKey: ownerKey("function", String(row["name"])),
      kind: "function",
      storageName: String(row["name"]),
      storageId: String(row["id"]),
      definition: functionDefinitionFromJsonWire({ ...storedFunction, id: String(row["name"]) } as FenelFunction),
    });
  }

  const currentFields = fieldRows.map((row) =>
    readDurableField({ id: String(row["id"]), data: asRecord(row["data"]) }),
  );
  const fieldIds = new Set(currentFields.map((field) => field.id));
  const currentFacets: StoredFieldFacetValue[] = facetRows.flatMap((row) => {
    const entityType = String(row["entity_type"]);
    if (!isFieldFacetType(entityType)) return [];
    const data = asRecord(row["data"]);
    const targetCanonical = data["targetEntityType"] === "Field";
    const typeCanonical = data["type"] === entityType;
    const argsCanonical = Array.isArray(data["args"])
      && data["args"].length === 1
      && typeof data["args"][0] === "string";
    const methodsCanonical = data["methods"] !== null
      && typeof data["methods"] === "object"
      && !Array.isArray(data["methods"]);
    const storageCanonical = targetCanonical
      && typeCanonical
      && argsCanonical
      && methodsCanonical;
    const targetLegacy = data["targetEntityType"] === undefined
      || data["targetEntityType"] === null;
    const typeLegacy = data["type"] === undefined || data["type"] === null;
    const migratableLegacyStorage = (targetCanonical || targetLegacy)
      && (typeCanonical || typeLegacy)
      && argsCanonical
      && methodsCanonical;
    if (
      !storageCanonical
      && !(migratableLegacyStorage && options.includeLegacyUnmarkedFieldFacets)
    ) return [];
    const args = data["args"] as unknown[];
    const fieldId = typeof args[0] === "string" ? args[0] : "";
    if (!fieldIds.has(fieldId)) return [];
    const rawScope = data["scope"] ?? "account";
    const scope = rawScope === "account"
      || (rawScope !== null
        && typeof rawScope === "object"
        && !Array.isArray(rawScope)
        && (rawScope as Record<string, unknown>)["kind"] === "account")
      ? "account"
      : null;
    if (scope === null) return [];
    return [{
      rowId: String(row["id"]),
      fieldId,
      typeName: entityType,
      methods: asRecord(data["methods"]),
      scope: "account" as const,
      priority: typeof data["priority"] === "number" ? data["priority"] : 100,
      ...(storageCanonical ? {} : { storageCanonical: false as const }),
    }];
  });

  return {
    graph: { currentOwners, currentFields, currentFacets, storageIssues },
    beforeImage,
    beforeImageText,
  };
}

export async function loadAccountFieldDefinitionGraph(
  accountId: string,
  db: FieldDefinitionGraphReader = getDb(),
): Promise<AccountFieldDefinitionGraph> {
  return (await loadAccountFieldDefinitionPhysicalSnapshot(accountId, db)).graph;
}

/** Migration-only legacy ingress. It exposes otherwise-valid unary facets that
 * predate the mandatory `targetEntityType: "Field"` marker so the Fenel plan
 * can force their canonical rewrite. Product reads must use the strict loader
 * above. */
export async function loadAccountFieldDefinitionMigrationGraph(
  accountId: string,
  db: FieldDefinitionGraphReader = getDb(),
): Promise<AccountFieldDefinitionGraph> {
  return (await loadAccountFieldDefinitionPhysicalSnapshot(accountId, db, {
    includeLegacyUnmarkedFieldFacets: true,
  })).graph;
}

export type FieldDefinitionFaultPoint = {
  phase: "owner" | "field" | "facet-delete" | "facet-upsert";
  index: number;
};

export type FieldDefinitionTransactionOptions = {
  /** Test-only seam used to prove rollback at every physical write boundary. */
  faultInjector?: (point: FieldDefinitionFaultPoint) => void | Promise<void>;
};

export type CapturedFieldDefinitionTransactionOptions =
  & FieldDefinitionTransactionOptions
  & {
    /** Persist the exact physical pre-state before any semantic plan or write.
     * Throwing aborts the still-locked transaction. */
    persistBeforeImage: (
      rows: readonly string[],
    ) => void | Promise<void>;
    /** One-shot Phase-2b migration ingress; canonical command readers never
     * admit an unmarked representation as a Field facet. */
    includeLegacyUnmarkedFieldFacets?: boolean;
  };

export type CapturedFieldDefinitionTransactionResult = {
  snapshot: StoredFieldPersistencePlan["snapshot"];
  beforeImage: readonly FieldDefinitionPhysicalBeforeImageRow[];
};

export class FieldDefinitionPersistenceConflict extends Error {
  readonly diagnostic: {
    $tag: "PersistenceConflict";
    message: string;
  };
  constructor(message: string) {
    super(message);
    this.name = "FieldDefinitionPersistenceConflict";
    this.diagnostic = { $tag: "PersistenceConflict", message };
  }
}

function fieldData(field: StoredDurableFieldEntity): Record<string, unknown> {
  return asRecord(durableFieldToStorageData(field));
}

function facetData(facet: StoredFieldFacetValue): Record<string, unknown> {
  return {
    type: facet.typeName,
    args: [facet.fieldId],
    methods: facet.methods,
    scope: facet.scope,
    priority: facet.priority,
    targetEntityType: "Field",
  };
}

function typeOwnerData(owner: Extract<StoredFieldOwnerDefinition, { kind: "type" }>): {
  type: Record<string, unknown> | null;
  declaration: Record<string, unknown> | null;
  defaultTemplate?: string | null;
  defaultTemplateInline?: string | null;
} {
  const definition = asRecord(owner.definition);
  const rawType = definition["type"];
  const values: {
    type: Record<string, unknown> | null;
    declaration: Record<string, unknown> | null;
    defaultTemplate?: string | null;
    defaultTemplateInline?: string | null;
  } = {
    declaration: owner.definition.params === undefined && owner.definition.typeScheme === undefined
      ? null
      : typeDefinitionToJsonWire({
          ...(owner.definition.params === undefined ? {} : { params: owner.definition.params }),
          ...(owner.definition.typeScheme === undefined ? {} : { typeScheme: owner.definition.typeScheme }),
        }),
    type: rawType !== null && typeof rawType === "object"
      ? (typeToJsonWire(rawType as FenelType) as Record<string, unknown>)
      : null,
  };
  for (const key of ["defaultTemplate", "defaultTemplateInline"] as const) {
    if (!(key in definition)) continue;
    const value = definition[key];
    if (value !== null && typeof value !== "string") {
      throw new FieldDefinitionPersistenceConflict(
        `Invalid ${key} metadata for type owner ${owner.storageName}`,
      );
    }
    values[key] = value;
  }
  return values;
}

async function injectFault(
  options: FieldDefinitionTransactionOptions,
  point: FieldDefinitionFaultPoint,
): Promise<void> {
  await options.faultInjector?.(point);
}

type FieldDefinitionTransaction = FieldControlPlaneTransaction;

async function executeFieldDefinitionPersistencePlanInTransaction(
  accountId: string,
  plan: StoredFieldPersistencePlan,
  tx: FieldDefinitionTransaction,
  options: FieldDefinitionTransactionOptions = {},
): Promise<StoredFieldPersistencePlan["snapshot"]> {
    let ownerIndex = 0;
    for (const owner of plan.ownerUpserts) {
      if (owner.kind === "type") {
        const values = typeOwnerData(owner);
        if (owner.storageId) {
          const updated = await tx
            .update(types)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(
                eq(types.accountId, accountId),
                eq(types.id, owner.storageId),
                eq(types.name, owner.storageName),
                eq(types.isSystem, false),
              ),
            )
            .returning({ id: types.id });
          if (updated.length !== 1) {
            throw new FieldDefinitionPersistenceConflict(
              `Account-scoped type owner disappeared: ${owner.storageName}`,
            );
          }
        } else {
          await tx.insert(types).values({
            accountId,
            name: owner.storageName,
            ...values,
            isSystem: false,
          });
        }
      } else if (owner.storageId) {
        const updated = await tx
          .update(functions)
          .set({ function: functionDefinitionToJsonWire(owner.definition), updatedAt: new Date() })
          .where(
            and(
              eq(functions.accountId, accountId),
              eq(functions.id, owner.storageId),
              eq(functions.name, owner.storageName),
              eq(functions.version, 1),
              eq(functions.isSystem, false),
              isNull(functions.sourceRegistryId),
            ),
          )
          .returning({ id: functions.id });
        if (updated.length !== 1) {
          throw new FieldDefinitionPersistenceConflict(
            `Account-scoped function owner disappeared: ${owner.storageName}`,
          );
        }
      } else {
        await tx.insert(functions).values({
          accountId,
          name: owner.storageName,
          function: functionDefinitionToJsonWire(owner.definition),
          version: 1,
          active: true,
          isSystem: false,
        });
      }
      await injectFault(options, { phase: "owner", index: ownerIndex++ });
    }

    for (const owner of plan.ownerDeletes) {
      const deleted = owner.kind === "type"
        ? await tx
            .delete(types)
            .where(
              and(
                eq(types.accountId, accountId),
                ...(owner.storageId ? [eq(types.id, owner.storageId)] : []),
                eq(types.name, owner.storageName),
                eq(types.isSystem, false),
              ),
            )
            .returning({ id: types.id })
        : await tx
            .delete(functions)
            .where(
              and(
                eq(functions.accountId, accountId),
                ...(owner.storageId ? [eq(functions.id, owner.storageId)] : []),
                eq(functions.name, owner.storageName),
                eq(functions.active, true),
                eq(functions.isSystem, false),
                isNull(functions.sourceRegistryId),
              ),
            )
            .returning({ id: functions.id });
      if (deleted.length !== 1) {
        throw new FieldDefinitionPersistenceConflict(
          `Account-scoped owner delete did not match: ${owner.storageName}`,
        );
      }
      await injectFault(options, { phase: "owner", index: ownerIndex++ });
    }

    let fieldIndex = 0;
    for (const field of [...plan.fieldUpserts, ...plan.fieldTombstones]) {
      const [reserved] = await tx
        .select({
          id: entityInstances.id,
          accountId: entityInstances.accountId,
          entityType: entityInstances.entityType,
        })
        .from(entityInstances)
        .where(eq(entityInstances.id, field.id))
        .limit(1);
      if (
        reserved
        && (reserved.accountId !== accountId || reserved.entityType !== "Field")
      ) {
        throw new FieldDefinitionPersistenceConflict(
          "Field identity is already reserved outside this account Field catalog",
        );
      }
      const existing = reserved;
      if (existing) {
        await tx
          .update(entityInstances)
          // Terminal A1/B3 egress: Drizzle inspects the column prototype before
          // JSONB encoding. Spread preserves own __proto__ data and nested records.
          .set({ data: { ...fieldData(field) }, updatedAt: new Date() })
          .where(
            and(
              eq(entityInstances.accountId, accountId),
              eq(entityInstances.id, field.id),
              eq(entityInstances.entityType, "Field"),
            ),
          );
      } else {
        await tx.insert(entityInstances).values({
          id: field.id,
          accountId,
          entityType: "Field",
          data: { ...fieldData(field) },
        });
      }
      await injectFault(options, { phase: "field", index: fieldIndex++ });
    }

    let facetDeleteIndex = 0;
    for (const facet of plan.facetDeletes) {
      if (!facet.rowId) {
        throw new FieldDefinitionPersistenceConflict(
          `Facet delete has no persisted row id: ${facet.typeName}/${facet.fieldId}`,
        );
      }
      const deleted = await tx
        .delete(entityInstances)
        .where(
          and(
            eq(entityInstances.accountId, accountId),
            eq(entityInstances.id, facet.rowId),
            eq(entityInstances.entityType, facet.typeName),
          ),
        )
        .returning({ id: entityInstances.id });
      if (deleted.length !== 1) {
        throw new FieldDefinitionPersistenceConflict(
          `Account-scoped facet delete did not match: ${facet.rowId}`,
        );
      }
      await injectFault(options, {
        phase: "facet-delete",
        index: facetDeleteIndex++,
      });
    }

    let facetUpsertIndex = 0;
    for (const facet of plan.facetUpserts) {
      if (facet.rowId) {
        const updated = await tx
          .update(entityInstances)
          .set({ data: facetData(facet), updatedAt: new Date() })
          .where(
            and(
              eq(entityInstances.accountId, accountId),
              eq(entityInstances.id, facet.rowId),
              eq(entityInstances.entityType, facet.typeName),
            ),
          )
          .returning({ id: entityInstances.id });
        if (updated.length !== 1) {
          throw new FieldDefinitionPersistenceConflict(
            `Account-scoped facet update did not match: ${facet.rowId}`,
          );
        }
      } else {
        const data = facetData(facet);
        const [logicalExisting] = await tx
          .select({ id: entityInstances.id, data: entityInstances.data })
          .from(entityInstances)
          .where(
            and(
              eq(entityInstances.accountId, accountId),
              eq(entityInstances.entityType, facet.typeName),
              sql`${entityInstances.data}->'args'->>0 = ${facet.fieldId}`,
              sql`(case
                when ${entityInstances.data}->'scope' is null
                  or ${entityInstances.data}->'scope' = 'null'::jsonb
                  or ${entityInstances.data}->'scope' = '{"kind":"account"}'::jsonb
                then '"account"'::jsonb
                else ${entityInstances.data}->'scope'
              end) = '"account"'::jsonb`,
            ),
          )
          .limit(1);
        if (logicalExisting) {
          const same = await tx
            .select({ id: entityInstances.id })
            .from(entityInstances)
            .where(
              and(
                eq(entityInstances.id, logicalExisting.id),
                sql`${entityInstances.data} = ${JSON.stringify(data)}::jsonb`,
              ),
            )
            .limit(1);
          if (same.length !== 1) {
            throw new FieldDefinitionPersistenceConflict(
              `Logical facet already exists with different data: ${facet.typeName}/${facet.fieldId}`,
            );
          }
        } else {
          await tx.insert(entityInstances).values({
            id: crypto.randomUUID(),
            accountId,
            entityType: facet.typeName,
            data,
          });
        }
      }
      await injectFault(options, {
        phase: "facet-upsert",
        index: facetUpsertIndex++,
      });
    }

    const committed = await loadAccountFieldDefinitionGraph(accountId, tx);
    return {
      owners: committed.currentOwners,
      fields: committed.currentFields,
      facets: committed.currentFacets,
    };
}

async function withLockedFieldDefinitionTransaction<T>(
  accountId: string,
  operation: (tx: FieldDefinitionTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await withFieldControlPlaneAccountTransaction(accountId, operation);
  } catch (error) {
    if (error instanceof FieldDefinitionPersistenceConflict) throw error;
    // Drizzle wraps query failures; transaction/commit failures can still be
    // raised directly by the PostgreSQL driver.
    const driverError = error instanceof DrizzleQueryError ? error.cause : error;
    const code = asRecord(driverError).code;
    if (code === "23505" || code === "40001") {
      throw new FieldDefinitionPersistenceConflict(
        "Definition bundle conflicted with a concurrent or reserved identity write",
      );
    }
    throw error;
  }
}

export type FieldDefinitionPlanCurrent = (
  current: AccountFieldDefinitionGraph,
) => StoredFieldPersistencePlan | Promise<StoredFieldPersistencePlan>;

/** Lock, reload, plan, and write one account definition graph in one
 * transaction. The supplied callback owns all semantic planning; this DB leaf
 * only supplies the fresh graph and executes the returned physical plan. */
export async function executeFieldDefinitionCommandTransaction(
  accountId: string,
  planCurrent: FieldDefinitionPlanCurrent,
  options: FieldDefinitionTransactionOptions = {},
): Promise<StoredFieldPersistencePlan["snapshot"]> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return withLockedFieldDefinitionTransaction(accountId, async (tx) => {
    const current = await loadAccountFieldDefinitionGraph(accountId, tx);
    const plan = await planCurrent(current);
    return executeFieldDefinitionPersistencePlanInTransaction(
      accountId,
      plan,
      tx,
      options,
    );
  });
}

/** Variant for migrations and recovery-sensitive maintenance. The account
 * lock is acquired before one physical-snapshot/graph statement; the caller
 * must durably persist that exact before-image before planning or writes can
 * continue. This keeps backup, semantic input, and applied plan on one side
 * of the same serialization boundary without exposing a transaction handle. */
export async function executeCapturedFieldDefinitionCommandTransaction(
  accountId: string,
  planCurrent: FieldDefinitionPlanCurrent,
  options: CapturedFieldDefinitionTransactionOptions,
): Promise<CapturedFieldDefinitionTransactionResult> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return withLockedFieldDefinitionTransaction(accountId, async (tx) => {
    const current = await loadAccountFieldDefinitionPhysicalSnapshot(accountId, tx, {
      includeLegacyUnmarkedFieldFacets:
        options.includeLegacyUnmarkedFieldFacets === true,
    });
    await options.persistBeforeImage(current.beforeImageText);
    const plan = await planCurrent(current.graph);
    const snapshot = await executeFieldDefinitionPersistencePlanInTransaction(
      accountId,
      plan,
      tx,
      options,
    );
    return { snapshot, beforeImage: current.beforeImage };
  });
}

/** Execute an already-decided Fenel persistence plan under one account-scoped
 * transaction. Prefer executeFieldDefinitionCommandTransaction for commands
 * whose plan depends on current account state. */
export async function executeFieldDefinitionPersistencePlan(
  accountId: string,
  plan: StoredFieldPersistencePlan,
  options: FieldDefinitionTransactionOptions = {},
): Promise<StoredFieldPersistencePlan["snapshot"]> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return withLockedFieldDefinitionTransaction(
    accountId,
    (tx) => executeFieldDefinitionPersistencePlanInTransaction(
      accountId,
      plan,
      tx,
      options,
    ),
  );
}
