// ---------------------------------------------------------------------------
// Entity Query executor — SetExpr-powered universal querying
//
// Takes an EntityQuery (entity name + SetExpr filters + projection + pagination),
// resolves the entity type to a Drizzle table, compiles SetExpr constraints to SQL,
// and executes.
//
// One query language for everything: dashboard filters, API endpoints,
// audience segmentation, flow triggers, automated stats.
// ---------------------------------------------------------------------------

import { sql, eq, and, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { EntityQuery, QueryResult, FunnelQuery, FunnelResult } from "@fenel/engine";
import { getDb } from "../client";
import { setExprToSQL, toSnakeCase } from "../set-expr-sql";

// Schema imports — entity → table mapping
import { functions, functionInstances } from "../schema/functions";
import { savedQueries } from "../schema/saved-queries";
import { queryCategories, queryCategoryMembers } from "../schema/query-categories";
import { entityInstances } from "../schema/entity-instances";
import { decodeCheckpointRow } from "@fenel/engine/checkpoint-json";
import { decodeSavedQueryRow } from "./saved-queries";

// ---------------------------------------------------------------------------
// Entity → Table registry
// ---------------------------------------------------------------------------

/** Config for a 1:N relation (join table) */
type RelationConfig = {
  table: PgTable<any>;
  /** FK column in the relation table pointing to the parent entity */
  foreignKey: string;
  /** Columns in the relation table: fieldName → columnName */
  columns: Record<string, string>;
};

type EntityTableConfig = {
  table: PgTable<any>;
  /** Column that scopes to an account (all entities are multi-tenant) */
  accountIdColumn: string;
  /** Fields that are real columns (not JSONB). Maps fieldName → columnName. */
  columns: Record<string, string>;
  /** JSONB column for extended/custom fields, if any */
  dataColumn?: string;
  /** Default ordering */
  defaultOrder?: { column: string; dir: "asc" | "desc" };
  /** Fields that support full-text search */
  searchFields?: string[];
  /** 1:N relations (handles, phones, tags, etc.) */
  relations?: Record<string, RelationConfig>;
  /** FK references to other entities: fieldName → target entity name */
  refs?: Record<string, string>;
  /** When set, filters the table by `entity_type = <value>` — used when
   *  multiple logical entities share the `entity_instances` storage. */
  entityTypeFilter?: { column: string; value: string };
};

const ENTITY_TABLES: Record<string, EntityTableConfig> = {
  profile: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["firstName", "lastName", "email", "phone"],
    entityTypeFilter: { column: "entity_type", value: "profile" },
    // Profile relations (handles, phones, tags, intents, relationships)
    // are first-class entities now (profile_handle / profile_phone / …),
    // queryable through entity_query directly via their own ENTITY_TABLES
    // entries (auto-derived from entity_type filter on entity_instances).
  },
  item: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["name", "slug"],
    entityTypeFilter: { column: "entity_type", value: "item" },
  },
  plan: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["name", "slug"],
    entityTypeFilter: { column: "entity_type", value: "plan" },
  },
  function: {
    table: functions,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      name: "name",
      version: "version",
      active: "active",
      createdAt: "created_at",
    },
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["name"],
  },
  functionInstance: {
    table: functionInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      functionId: "function_id",
      profileId: "profile_id",
      status: "status",
      currentStepPath: "current_step_path",
      variables: "variables",
      triggerEvent: "trigger_event",
      parentInstanceId: "parent_instance_id",
      startedAt: "started_at",
      completedAt: "completed_at",
    },
    dataColumn: "variables",
    defaultOrder: { column: "started_at", dir: "desc" },
    refs: { profileId: "profile", functionId: "function" },
  },
  // storage-as-effect Phase 4e — the `form:` entity-query config is RETIRED.
  // There is no "form" concept (forms-collapse): a form is the auto-derived
  // input view over a type. The 3 `entity_type='form'` rows are dissolved into
  // their types (migration 0084); this config had no caller (grep-confirmed).
  page: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["name", "slug"],
    entityTypeFilter: { column: "entity_type", value: "page" },
  },
  proxy_link: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["tag", "url", "title"],
    entityTypeFilter: { column: "entity_type", value: "proxy_link" },
  },
  inventory: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["slug"],
    entityTypeFilter: { column: "entity_type", value: "inventory" },
  },
  email_template: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    searchFields: ["slug", "subject"],
    entityTypeFilter: { column: "entity_type", value: "email_template" },
  },
  purchase: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "created_at", dir: "desc" },
    refs: { profileId: "profile", planId: "plan" },
    entityTypeFilter: { column: "entity_type", value: "purchase" },
    // payment_step is its own entity type now (back-refs to purchase via
    // data->>'purchaseId'). UI auto-discovers it via discoverBackRefs.
  },
  bot: {
    table: entityInstances,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    dataColumn: "data",
    defaultOrder: { column: "updated_at", dir: "desc" },
    searchFields: ["label", "username"],
    entityTypeFilter: { column: "entity_type", value: "Bot" },
  },
  savedQuery: {
    table: savedQueries,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      slug: "slug",
      name: "name",
      description: "description",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    dataColumn: "query",
    defaultOrder: { column: "updated_at", dir: "desc" },
    searchFields: ["name", "slug", "description"],
  },
  queryCategory: {
    table: queryCategories,
    accountIdColumn: "account_id",
    columns: {
      id: "id",
      slug: "slug",
      name: "name",
      description: "description",
      parentId: "parent_id",
      createdAt: "created_at",
    },
    defaultOrder: { column: "name", dir: "asc" },
    searchFields: ["name", "slug"],
    relations: {
      queries: {
        table: queryCategoryMembers,
        foreignKey: "category_id",
        columns: {
          queryId: "query_id",
          createdAt: "created_at",
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute an entity query.
 *
 * @example
 *   await executeQuery("acc-123", {
 *     entity: "profile",
 *     filter: {
 *       email: { $tag: "SeRef", handle: "format:email" },
 *       type: { $tag: "SeEnum", values: ["person"] },
 *     },
 *     orderBy: [{ field: "createdAt", dir: "desc" }],
 *     limit: 50,
 *   });
 */
async function resolveQueryRefs(
  accountId: string,
  query: EntityQuery,
  depth = 0,
): Promise<EntityQuery> {
  if (depth > 5) throw new QueryError("Query $ref depth exceeded (max 5)");
  const db = getDb();
  const resolved = { ...query };

  if (query.filter) {
    const expandedFilter: Record<string, unknown> = {};
    for (const [field, expr] of Object.entries(query.filter as Record<string, unknown>)) {
      if (field === "$ref" && typeof expr === "string") {
        const slug = (expr as string).replace(/^query:/, "");
        const [ref] = await db.select().from(savedQueries)
          .where(and(eq(savedQueries.accountId, accountId), eq(savedQueries.slug, slug)));
        if (!ref) throw new QueryError(`Referenced query not found: ${slug}`);
        const refQuery = decodeSavedQueryRow(ref).query as Record<string, unknown> | null;
        if (!refQuery || typeof refQuery !== "object" || Array.isArray(refQuery)) throw new QueryError(`Referenced query is not an executable query object: ${slug}`);
        if (refQuery.filter) {
          const innerResolved = await resolveQueryRefs(accountId, refQuery as EntityQuery, depth + 1);
          Object.assign(expandedFilter, innerResolved.filter);
        }
        if (refQuery.relations && !resolved.relations) {
          resolved.relations = refQuery.relations as EntityQuery["relations"];
        } else if (refQuery.relations) {
          resolved.relations = { ...resolved.relations, ...(refQuery.relations as EntityQuery["relations"]) };
        }
      } else {
        expandedFilter[field] = expr;
      }
    }
    resolved.filter = expandedFilter as EntityQuery["filter"];
  }

  return resolved;
}

export async function executeQuery(
  accountId: string,
  rawQuery: EntityQuery,
): Promise<QueryResult> {
  const start = performance.now();
  const query = await resolveQueryRefs(accountId, rawQuery);
  const config = ENTITY_TABLES[query.entity];
  if (!config) {
    throw new QueryError(`Unknown entity type: ${query.entity}`);
  }

  const db = getDb();

  // --- Build WHERE conditions ---
  const conditions: SQL[] = [
    sql`${sql.raw(`"${getTableName(config.table)}"."${config.accountIdColumn}"`)} = ${accountId}`,
  ];

  if (config.entityTypeFilter) {
    const f = config.entityTypeFilter;
    conditions.push(
      sql`${sql.raw(`"${getTableName(config.table)}"."${f.column}"`)} = ${f.value}`,
    );
  }

  if (query.filter) {
    for (const [field, setExpr] of Object.entries(query.filter)) {
      const col = resolveColumn(field, config);
      if (col) {
        conditions.push(setExprToSQL(setExpr, col));
      }
    }
  }

  // --- Relation constraints (handles, phones, tags, etc.) ---
  if (query.relations && config.relations) {
    const parentTable = getTableName(config.table);
    for (const [relName, relFilter] of Object.entries(query.relations)) {
      const relConfig = config.relations[relName];
      if (!relConfig) continue;
      const relTable = getTableName(relConfig.table);
      const fk = relConfig.foreignKey;

      // $any → EXISTS (SELECT 1 FROM rel WHERE fk = parent.id AND <field constraints>)
      if (relFilter.any) {
        const relConditions: SQL[] = [
          sql`${sql.raw(`"${relTable}"."${fk}"`)} = ${sql.raw(`"${parentTable}"."id"`)}`,
        ];
        for (const [field, setExpr] of Object.entries(relFilter.any)) {
          const colName = relConfig.columns[field];
          if (colName) {
            relConditions.push(setExprToSQL(setExpr, sql.raw(`"${relTable}"."${colName}"`)));
          }
        }
        conditions.push(
          sql`EXISTS (SELECT 1 FROM ${sql.raw(`"${relTable}"`)} WHERE ${sql.join(relConditions, sql` AND `)})`,
        );
      }

      // $every → NOT EXISTS (SELECT 1 FROM rel WHERE fk = parent.id AND NOT (<field constraints>))
      if (relFilter.every) {
        const fieldChecks: SQL[] = [];
        for (const [field, setExpr] of Object.entries(relFilter.every)) {
          const colName = relConfig.columns[field];
          if (colName) {
            fieldChecks.push(setExprToSQL(setExpr, sql.raw(`"${relTable}"."${colName}"`)));
          }
        }
        if (fieldChecks.length > 0) {
          const allMatch = fieldChecks.length === 1
            ? fieldChecks[0]!
            : sql`(${sql.join(fieldChecks, sql` AND `)})`;
          conditions.push(
            sql`NOT EXISTS (SELECT 1 FROM ${sql.raw(`"${relTable}"`)} WHERE ${sql.raw(`"${relTable}"."${fk}"`)} = ${sql.raw(`"${parentTable}"."id"`)} AND NOT (${allMatch}))`,
          );
        }
      }

      // $count → (SELECT COUNT(*) FROM rel WHERE fk = parent.id) ∈ SetExpr
      if (relFilter.count) {
        const countSubquery = sql`(SELECT COUNT(*) FROM ${sql.raw(`"${relTable}"`)} WHERE ${sql.raw(`"${relTable}"."${fk}"`)} = ${sql.raw(`"${parentTable}"."id"`)})`;
        conditions.push(setExprToSQL(relFilter.count, countSubquery));
      }
    }
  }

  if (query.search && config.searchFields?.length) {
    const searchConditions = config.searchFields
      .map((field) => resolveColumn(field, config))
      .filter((c): c is SQL => c !== null)
      .map((col) => sql`${col}::text ILIKE ${"%" + query.search + "%"}`);
    if (searchConditions.length > 0) {
      conditions.push(sql`(${sql.join(searchConditions, sql` OR `)})`);
    }
  }

  const where = sql.join(conditions, sql` AND `);

  // --- Aggregation query ---
  if (query.aggregate?.length) {
    return executeAggregateQuery(db, config, query, where, start);
  }

  // --- Standard SELECT query ---
  const tableName = getTableName(config.table);
  const selectCols = query.select
    ? query.select
        .map((f) => config.columns[f] ?? (f === config.dataColumn ? config.dataColumn : undefined))
        .filter(Boolean)
        .map((c) => sql.raw(`"${c}"`))
    : [sql.raw("*")];
  if (config.table === functionInstances && query.select?.includes("variables")) {
    // Storage provenance is selected for decoding and never becomes a public
    // field of the language-level function instance.
    selectCols.push(sql.raw('"variables_encoding"'));
  }
  if (config.table === functionInstances && query.select?.includes("triggerEvent")) {
    selectCols.push(sql.raw('"trigger_event_encoding"'));
  }
  if (config.table === savedQueries && query.select?.includes("query")) {
    selectCols.push(sql.raw('"query_encoding"'));
  }

  // ORDER BY
  const orderClauses = buildOrderBy(query, config);

  // LIMIT / OFFSET
  const limit = Math.min(query.limit ?? 100, 1000);
  const offset = query.offset ?? 0;

  const querySQL = sql`
    SELECT ${sql.join(selectCols, sql`, `)}
    FROM ${sql.raw(`"${tableName}"`)}
    WHERE ${where}
    ${orderClauses}
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const rows = await db.execute(querySQL) as unknown as Record<string, unknown>[];

  // --- Optional total count ---
  let total: number | undefined;
  if (query.includeTotal) {
    const countSQL = sql`
      SELECT COUNT(*) as "count"
      FROM ${sql.raw(`"${tableName}"`)}
      WHERE ${where}
    `;
    const countResult = await db.execute(countSQL) as unknown as { count: number }[];
    total = Number(countResult[0]?.count ?? 0);
  }

  return {
    rows: normalizeRows(rows, config),
    total,
    meta: {
      entity: query.entity,
      query,
      executionMs: performance.now() - start,
    },
  };
}

/**
 * Execute two queries and compute row-level diffs.
 * Both queries must target the same entity and produce the same shape.
 */
export async function executeCompareQuery(
  accountId: string,
  current: EntityQuery,
  previous: EntityQuery,
): Promise<{ current: QueryResult; previous: QueryResult; diff: Record<string, unknown>[] }> {
  const [curResult, prevResult] = await Promise.all([
    executeQuery(accountId, current),
    executeQuery(accountId, previous),
  ]);

  const groupKey = current.groupBy?.[0] ?? current.bucket?.as ?? "bucket";
  const valueKeys = (current.aggregate ?? []).map((a) => a.as);

  const prevMap = new Map<string, Record<string, unknown>>();
  for (const row of prevResult.rows) {
    prevMap.set(String(row[groupKey] ?? ""), row);
  }

  const diff = curResult.rows.map((row) => {
    const key = String(row[groupKey] ?? "");
    const prev = prevMap.get(key);
    const d: Record<string, unknown> = { [groupKey]: row[groupKey] };
    for (const vk of valueKeys) {
      const cur = Number(row[vk] ?? 0);
      const prv = Number(prev?.[vk] ?? 0);
      d[vk] = cur;
      d[`${vk}_prev`] = prv;
      d[`${vk}_delta`] = cur - prv;
      d[`${vk}_pct`] = prv !== 0 ? Math.round(((cur - prv) / prv) * 10000) / 100 : null;
    }
    return d;
  });

  return { current: curResult, previous: prevResult, diff };
}

/**
 * Execute a funnel query — ordered steps with conversion rates.
 * Each step counts distinct profiles matching its criteria.
 * Rate = step[n] / step[n-1].
 */
export async function executeFunnelQuery(
  accountId: string,
  funnel: FunnelQuery,
): Promise<FunnelResult> {
  const db = getDb();
  const steps: { name: string; count: number; rate: number | null }[] = [];

  for (let i = 0; i < funnel.steps.length; i++) {
    const step = funnel.steps[i]!;
    const stepConfig = ENTITY_TABLES[step.entity];
    if (!stepConfig) {
      steps.push({ name: step.name, count: 0, rate: null });
      continue;
    }

    const defaultLink = step.entity === "profile" ? "id" : (funnel.linkField ?? "profileId");
    const linkField = step.linkField ?? defaultLink;
    const linkCol = stepConfig.columns[linkField];
    if (!linkCol) {
      steps.push({ name: step.name, count: 0, rate: null });
      continue;
    }

    const tableName = getTableName(stepConfig.table);
    const where = buildWhereFromFilters(stepConfig, step.filter ?? {}, accountId);

    const countSQL = sql`
      SELECT COUNT(DISTINCT ${sql.raw(`"${linkCol}"`)}) as "count"
      FROM ${sql.raw(`"${tableName}"`)}
      WHERE ${where}
    `;

    const result = await db.execute(countSQL) as unknown as { count: number }[];
    const count = Number(result[0]?.count ?? 0);
    const prevCount = i > 0 ? steps[i - 1]!.count : null;
    const rate = prevCount != null && prevCount > 0
      ? Math.round((count / prevCount) * 10000) / 100
      : null;

    steps.push({ name: step.name, count, rate });
  }

  const overall = steps.length >= 2 && steps[0]!.count > 0
    ? Math.round((steps[steps.length - 1]!.count / steps[0]!.count) * 10000) / 100
    : null;

  return { steps, overall };
}

/** Build WHERE clause from filter map */
function buildWhereFromFilters(
  config: EntityTableConfig,
  filters: Record<string, unknown>,
  accountId: string,
): SQL {
  const conditions: SQL[] = [
    sql`${sql.raw(`"${getTableName(config.table)}"."${config.accountIdColumn}"`)} = ${accountId}`,
  ];

  if (config.entityTypeFilter) {
    const f = config.entityTypeFilter;
    conditions.push(
      sql`${sql.raw(`"${getTableName(config.table)}"."${f.column}"`)} = ${f.value}`,
    );
  }

  for (const [field, expr] of Object.entries(filters)) {
    const colName = config.columns[field];
    if (!colName || !expr) continue;
    const compiled = setExprToSQL(expr, sql.raw(`"${colName}"`));
    if (compiled) conditions.push(compiled);
  }

  return sql.join(conditions, sql` AND `);
}

/** List all registered entity types */
export function queryableEntities(): string[] {
  return Object.keys(ENTITY_TABLES);
}

/** Check if an entity type is queryable */
export function isQueryableEntity(entity: string): boolean {
  return typeof entity === "string" && Object.hasOwn(ENTITY_TABLES, entity);
}

/** Get the queryable columns for an entity type */
export function queryableFields(entity: string): string[] {
  const config = ENTITY_TABLES[entity];
  if (!config) return [];
  return Object.keys(config.columns);
}

/** Get the queryable relations for an entity type, with their fields */
export function queryableRelations(entity: string): Record<string, string[]> {
  const config = ENTITY_TABLES[entity];
  if (!config?.relations) return {};
  const result: Record<string, string[]> = {};
  for (const [name, rel] of Object.entries(config.relations)) {
    result[name] = Object.keys(rel.columns);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aggregate queries
// ---------------------------------------------------------------------------

/** Drizzle's identifier wrapper adds quotes but does not escape their content. */
function queryAlias(value: string): SQL {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new QueryError("Query alias must be a non-empty SQL identifier");
  }
  return sql.raw(`"${value.replaceAll('"', '""')}"`);
}

async function executeAggregateQuery(
  db: ReturnType<typeof getDb>,
  config: EntityTableConfig,
  query: EntityQuery,
  where: SQL,
  start: number,
): Promise<QueryResult> {
  const tableName = getTableName(config.table);

  // Build SELECT for aggregates
  const aggCols: SQL[] = [];
  const groupByCols: SQL[] = [];

  // Time bucket — date_trunc on a timestamp field
  if (query.bucket) {
    const bucketCol = config.columns[query.bucket.field];
    if (bucketCol) {
      const alias = query.bucket.as ?? "bucket";
      const truncExpr = sql`date_trunc(${query.bucket.interval}, ${sql.identifier(bucketCol)})`;
      aggCols.push(sql`${truncExpr} AS ${queryAlias(alias)}`);
      // Re-rendering truncExpr allocates a second interval placeholder, so
      // PostgreSQL cannot match it to the SELECT expression. Its ordinal also
      // avoids ambiguity when a user alias equals an input column name.
      groupByCols.push(sql.raw(String(aggCols.length)));
    }
  }

  // Group by columns (supports dot notation for cross-entity: "profile.tags.tag")
  const joinClauses: SQL[] = [];
  if (query.groupBy?.length) {
    for (const field of query.groupBy) {
      if (field.includes(".")) {
        const resolved = resolveDotPath(field, config, tableName);
        if (resolved) {
          for (const j of resolved.joins) joinClauses.push(j);
          aggCols.push(sql`${resolved.column} AS ${queryAlias(field)}`);
          groupByCols.push(resolved.column);
        }
      } else {
        const colName = config.columns[field];
        if (colName) {
          aggCols.push(sql`${sql.raw(`"${tableName}"."${colName}"`)} AS ${queryAlias(field)}`);
          groupByCols.push(sql.raw(`"${tableName}"."${colName}"`));
        }
      }
    }
  }

  // Aggregate functions
  for (const agg of query.aggregate!) {
    const alias = sql.raw(`"${agg.as.replace(/[^a-zA-Z0-9_]/g, "")}"`);
    if (agg.fn === "count" && !agg.field) {
      aggCols.push(sql`COUNT(*) AS ${alias}`);
    } else {
      const colName = agg.field ? config.columns[agg.field] : null;
      if (!colName) continue;
      const col = sql.raw(`"${colName}"`);
      switch (agg.fn) {
        case "count": aggCols.push(sql`COUNT(${col}) AS ${alias}`); break;
        case "sum":   aggCols.push(sql`SUM(${col}) AS ${alias}`); break;
        case "avg":   aggCols.push(sql`AVG(${col}) AS ${alias}`); break;
        case "min":   aggCols.push(sql`MIN(${col}) AS ${alias}`); break;
        case "max":   aggCols.push(sql`MAX(${col}) AS ${alias}`); break;
      }
    }
  }

  // GROUP BY
  const groupBySQL = groupByCols.length > 0
    ? sql`GROUP BY ${sql.join(groupByCols, sql`, `)}`
    : sql``;

  // ORDER BY — only use explicit orderBy for aggregates (default order may reference non-grouped columns)
  let orderClauses: SQL = sql``;
  if (query.orderBy?.length) {
    orderClauses = buildOrderBy(query, config);
  }

  // LIMIT
  const limit = Math.min(query.limit ?? 100, 1000);

  const joinSQL = joinClauses.length > 0
    ? sql.join(joinClauses, sql` `)
    : sql``;

  const querySQL = sql`
    SELECT ${sql.join(aggCols, sql`, `)}
    FROM ${sql.raw(`"${tableName}"`)}
    ${joinSQL}
    WHERE ${where}
    ${groupBySQL}
    ${orderClauses}
    LIMIT ${limit}
  `;

  const rows = await db.execute(querySQL) as unknown as Record<string, unknown>[];

  return {
    rows: rows as Record<string, unknown>[],
    meta: {
      entity: query.entity,
      query,
      executionMs: performance.now() - start,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation path like "profile.tags.tag" to SQL JOINs + column ref.
 * Path format: [refField].[relation].[column] or [refField].[column]
 */
function resolveDotPath(
  path: string,
  sourceConfig: EntityTableConfig,
  sourceTable: string,
): { joins: SQL[]; column: SQL } | null {
  const parts = path.split(".");
  if (parts.length < 2) return null;

  const joins: SQL[] = [];
  let currentConfig = sourceConfig;
  let currentTable = sourceTable;
  let partIdx = 0;

  // First segment: FK reference to another entity (match by ref key OR target entity name)
  const refField = parts[partIdx]!;
  let targetEntity = currentConfig.refs?.[refField];
  let refKey = refField;
  if (!targetEntity && currentConfig.refs) {
    for (const [k, v] of Object.entries(currentConfig.refs)) {
      if (v === refField) { targetEntity = v; refKey = k; break; }
    }
  }
  if (!targetEntity) {
    // Maybe it's a direct relation on the current entity
    const rel = currentConfig.relations?.[refField];
    if (rel && parts.length === 2) {
      const relTable = getTableName(rel.table);
      const colName = rel.columns[parts[1]!];
      if (!colName) return null;
      joins.push(sql.raw(
        `LEFT JOIN "${relTable}" ON "${relTable}"."${rel.foreignKey}" = "${currentTable}"."id"`,
      ));
      return { joins, column: sql.raw(`"${relTable}"."${colName}"`) };
    }
    return null;
  }

  const targetConfig = ENTITY_TABLES[targetEntity];
  if (!targetConfig) return null;

  const fkCol = currentConfig.columns[refKey];
  if (!fkCol) return null;
  const targetTable = getTableName(targetConfig.table);
  const targetAlias = `_j_${targetEntity}`;

  joins.push(sql.raw(
    `LEFT JOIN "${targetTable}" "${targetAlias}" ON "${targetAlias}"."id" = "${currentTable}"."${fkCol}"`,
  ));

  currentConfig = targetConfig;
  currentTable = targetAlias;
  partIdx++;

  // Remaining segments: either a column on the target, or relation.column
  if (partIdx >= parts.length) return null;

  const nextPart = parts[partIdx]!;

  // Direct column on target entity
  if (partIdx === parts.length - 1) {
    const colName = currentConfig.columns[nextPart];
    if (!colName) return null;
    return { joins, column: sql.raw(`"${currentTable}"."${colName}"`) };
  }

  // Relation on target entity
  const rel = currentConfig.relations?.[nextPart];
  if (!rel) return null;
  partIdx++;

  if (partIdx >= parts.length) return null;
  const relColName = rel.columns[parts[partIdx]!];
  if (!relColName) return null;

  const relTable = getTableName(rel.table);
  const relAlias = `_j_${nextPart}`;

  joins.push(sql.raw(
    `LEFT JOIN "${relTable}" "${relAlias}" ON "${relAlias}"."${rel.foreignKey}" = "${currentTable}"."id"`,
  ));

  return { joins, column: sql.raw(`"${relAlias}"."${relColName}"`) };
}

/** Resolve a field name to a SQL column reference */
function resolveColumn(field: string, config: EntityTableConfig): SQL | null {
  const colName = config.columns[field];
  if (colName) return sql.raw(`"${colName}"`);

  // Try snake_case version
  const snaked = toSnakeCase(field);
  for (const [, col] of Object.entries(config.columns)) {
    if (col === snaked) return sql.raw(`"${col}"`);
  }

  // JSONB field fallback
  if (config.dataColumn) {
    return sql.raw(`"${config.dataColumn}"->>'${field.replace(/[^a-zA-Z0-9_]/g, "")}'`);
  }

  return null;
}

function buildOrderBy(query: EntityQuery, config: EntityTableConfig): SQL {
  if (query.orderBy?.length) {
    const clauses = query.orderBy
      .map((o) => {
        const col = resolveColumn(o.field, config);
        if (!col) return null;
        const direction = o.dir === "asc" ? sql`ASC` : sql`DESC`;
        return sql`${col} ${direction}`;
      })
      .filter(Boolean) as SQL[];
    if (clauses.length > 0) {
      return sql`ORDER BY ${sql.join(clauses, sql`, `)}`;
    }
  }

  // Default ordering
  if (config.defaultOrder) {
    const dir = config.defaultOrder.dir === "asc" ? sql`ASC` : sql`DESC`;
    return sql`ORDER BY ${sql.raw(`"${config.defaultOrder.column}"`)} ${dir}`;
  }

  return sql``;
}

/** Extract actual table name from a Drizzle table definition */
function getTableName(table: PgTable<any>): string {
  const sym = (table as any)[Symbol.for("drizzle:Name")];
  if (typeof sym === "string") return sym;
  const tableConfig = sym ?? (table as any)["_"] ?? {};
  return tableConfig.name ?? tableConfig.tableName ?? "unknown";
}

/** Convert snake_case SQL rows back to camelCase */
function normalizeRows(
  rows: Record<string, unknown>[],
  config: EntityTableConfig,
): Record<string, unknown>[] {
  // Build reverse map: snake_case → camelCase
  const reverseMap: Record<string, string> = {};
  for (const [camel, snake] of Object.entries(config.columns)) {
    reverseMap[snake] = camel;
  }

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[reverseMap[key] ?? key] = value;
    }
    if (config.table === functionInstances) {
      const { variables_encoding: physicalEncoding, trigger_event_encoding: eventEncoding, ...instance } = normalized;
      return decodeCheckpointRow({ ...instance, variablesEncoding: physicalEncoding, triggerEventEncoding: eventEncoding });
    }
    if (config.table === savedQueries) {
      const { query_encoding: encoding, ...query } = normalized;
      return decodeSavedQueryRow({ ...query, queryEncoding: encoding });
    }
    return normalized;
  });
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}
