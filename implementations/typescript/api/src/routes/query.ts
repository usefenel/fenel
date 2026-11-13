// ---------------------------------------------------------------------------
// /api/query — Universal entity query endpoint
//
// POST /api/query
//   Body: EntityQuery
//   Returns: QueryResult
//
// Same SetExpr used for form validation now powers arbitrary entity queries.
// One constraint language. Validation, filtering, segmentation, stats.
//
// Phase 12c-routes sub-step 4 — disposition sweep.
//
// All 5 routes (POST / + POST /compare + POST /funnel + GET /schema +
// GET /schema/:entity) are B-permanent (B-thin): each is a wrapper over
// the @fenel/db query-engine surface (executeQuery / executeCompareQuery
// / executeFunnelQuery / queryableEntities / queryableFields /
// queryableRelations). The query engine itself is a 600+ LOC pure-TS
// surface in @fenel/db — its migration is a SEPARATE WORKSTREAM, not a
// 12c-routes target. Could collapse the route wrappers to thin
// invokeIOAction shims via state:executeQuery etc. but the perceived
// saving is small (~5 LOC × 5 routes); deferred until the query-engine
// workstream opens. The fieldTypesFor helper is D-portable (pure
// transform combining queryableFields + getSystemEntity); deferred for
// the same reason.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { EntityQuery, FenelType } from "@fenel/engine";
import { getSystemEntity } from "@fenel/engine";
import {
  executeQuery,
  executeCompareQuery,
  executeFunnelQuery,
  queryableEntities,
  queryableFields,
  queryableRelations,
  isQueryableEntity,
  QueryError,
} from "@fenel/db";
import type { CompareQuery, FunnelQuery } from "@fenel/engine";
import { getAuthenticatedUserAccountId } from "../middleware/auth";
import { nativeJsonResponse, readNativeJson } from "../native-json";

type FieldSchema = { name: string; type: FenelType };

const COLUMN_TYPE_FALLBACKS: Record<string, FenelType> = {
  id: { $ref: "String" },
  createdAt: { $ref: "Date" },
  updatedAt: { $ref: "Date" },
  startedAt: { $ref: "Date" },
  completedAt: { $ref: "Date" },
  active: { $ref: "Boolean" },
  version: { $ref: "Number" },
};

function fieldTypesFor(entity: string): FieldSchema[] {
  const cols = queryableFields(entity);
  const sys = getSystemEntity(entity);
  const recordFields =
    sys && sys.type && "$record" in sys.type ? sys.type.$record.fields : [];
  const byName = new Map(recordFields.map((f) => [f.name, f.type]));

  return cols.map((name) => ({
    name,
    type: byName.get(name) ?? COLUMN_TYPE_FALLBACKS[name] ?? { $ref: "String" },
  }));
}

export type QueryRouteDependencies = {
  account: typeof getAuthenticatedUserAccountId;
  execute: typeof executeQuery;
  compare: typeof executeCompareQuery;
  funnel: typeof executeFunnelQuery;
  entities: typeof queryableEntities;
  fields: typeof fieldTypesFor;
  relations: typeof queryableRelations;
  isEntity: typeof isQueryableEntity;
};
const DEFAULT_QUERY_DEPENDENCIES: QueryRouteDependencies = {
  account: getAuthenticatedUserAccountId, execute: executeQuery, compare: executeCompareQuery,
  funnel: executeFunnelQuery, entities: queryableEntities, fields: fieldTypesFor,
  relations: queryableRelations, isEntity: isQueryableEntity,
};

export function createQueryRoutes(dependencies: Partial<QueryRouteDependencies> = {}): Hono {
const io = { ...DEFAULT_QUERY_DEPENDENCIES, ...dependencies };
const queryRoutes = new Hono();

// Query results are account-private. Resolve the partition only from a
// matching authenticated User + server-side session; X-Account-Id remains a
// public embed selector and cannot confer query authority.
queryRoutes.use("*", async (c, next) => {
  const accountId = io.account(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  c.set("accountId" as never, accountId as never);
  await next();
});

function getAccountId(c: { get: (key: string) => unknown }): string {
  return c.get("accountId") as string;
}

/** `setExprToTag` rejects malformed untrusted filter values before SQL
 * compilation. Keep that specific boundary rejection a client error without
 * swallowing unrelated TypeErrors from query execution.
 *
 * signature-substrate P4 slice 3a added a SECOND rejection at the same gateway:
 * a caller-supplied validation rigid. It is the same class of event — malformed
 * input caught at the boundary — so it is a 400, not a 500. Matching on the
 * exact legacy message alone would have logged it as an internal error. */
function isSetExprBoundaryError(err: unknown): err is TypeError {
  return err instanceof TypeError
    && (err.message === "Expected a SetExpr value at the SetExpr boundary"
      || err.message.startsWith("fenel.validation.rigid:"));
}

// ---------------------------------------------------------------------------
// POST /api/query — execute an entity query
// ---------------------------------------------------------------------------

queryRoutes.post("/", async (c) => {
  const accountId = getAccountId(c);
  // SetExpr fields originate as untrusted JSON. `setExprToSQL` is the one DB
  // gateway that accepts those values as `unknown` and normalizes legacy input
  // to the canonical 14-case `$tag` ADT before Fenel dispatch.
  const body = await readNativeJson<EntityQuery>(c);

  // Validate entity type
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.entity !== "string" || !io.isEntity(body.entity)) {
    return c.json(
      {
        error: `Unknown entity: ${body?.entity}`,
        available: io.entities(),
      },
      400,
    );
  }

  // Validate limit
  if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 1000)) {
    return c.json({ error: "limit must be between 1 and 1000" }, 400);
  }

  try {
    const result = await io.execute(accountId, body);
    return nativeJsonResponse(c, result);
  } catch (err) {
    if (err instanceof QueryError || isSetExprBoundaryError(err)) {
      return c.json({ error: err.message }, 400);
    }
    console.error("[query] execution failed:", err);
    return c.json({ error: "Query execution failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/query/compare — execute two queries and compute diffs
// ---------------------------------------------------------------------------

queryRoutes.post("/compare", async (c) => {
  const accountId = getAccountId(c);
  const body = await readNativeJson<CompareQuery>(c);

  if (!body?.current?.entity || !body?.previous?.entity) {
    return c.json({ error: "Both current and previous queries required" }, 400);
  }

  if (typeof body.current.entity !== "string" || typeof body.previous.entity !== "string" || !io.isEntity(body.current.entity) || !io.isEntity(body.previous.entity)) {
    return c.json({ error: "Unknown entity in compare query" }, 400);
  }

  try {
    const result = await io.compare(accountId, body.current, body.previous);
    return nativeJsonResponse(c, result);
  } catch (err) {
    if (err instanceof QueryError || isSetExprBoundaryError(err)) {
      return c.json({ error: err.message }, 400);
    }
    console.error("[query/compare] execution failed:", err);
    return c.json({ error: "Compare query failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/query/funnel — multi-step conversion funnel
// ---------------------------------------------------------------------------

queryRoutes.post("/funnel", async (c) => {
  const accountId = getAccountId(c);
  const body = await readNativeJson<FunnelQuery>(c);

  if (!Array.isArray(body?.steps) || !body.steps.length) {
    return c.json({ error: "At least one funnel step required" }, 400);
  }

  for (const step of body.steps) {
    if (!step || typeof step.entity !== "string" || !io.isEntity(step.entity)) {
      return c.json({ error: `Unknown entity in step "${step?.name}": ${step?.entity}` }, 400);
    }
  }

  try {
    const result = await io.funnel(accountId, body);
    return nativeJsonResponse(c, result);
  } catch (err) {
    if (err instanceof QueryError || isSetExprBoundaryError(err)) {
      return c.json({ error: err.message }, 400);
    }
    console.error("[query/funnel] execution failed:", err);
    return c.json({ error: "Funnel query failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/query/schema — list queryable entities and their fields
// ---------------------------------------------------------------------------

queryRoutes.get("/schema", (c) => {
  const entities: Record<string, { fields: FieldSchema[]; relations: Record<string, string[]> }> = {};
  for (const entity of io.entities()) {
    entities[entity] = {
      fields: io.fields(entity),
      relations: io.relations(entity),
    };
  }
  return nativeJsonResponse(c, { entities });
});

// ---------------------------------------------------------------------------
// GET /api/query/schema/:entity — get queryable fields for an entity
// ---------------------------------------------------------------------------

queryRoutes.get("/schema/:entity", (c) => {
  const entity = c.req.param("entity");
  if (!io.isEntity(entity)) {
    return c.json({ error: `Unknown entity: ${entity}` }, 404);
  }
  return nativeJsonResponse(c, {
    entity,
    fields: io.fields(entity),
    relations: io.relations(entity),
  });
});

return queryRoutes;
}
export const queryRoutes = createQueryRoutes();
