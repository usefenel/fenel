import { Hono } from "hono";
import type { SaveFieldDefinitionBundleRequest } from "@fenel/core/field-definition-command";
import { getAuthenticatedUserAccountId } from "../middleware/auth";
import { fieldDefinitionSnapshotToJsonWire } from "@fenel/engine/authoring/expression";
import {
  executeFieldDefinitionCatalogQuery,
  executeFieldDefinitionCommand,
  executeFieldDefinitionIdentityQuery,
  executeFieldDefinitionResurrectionQuery,
  executeFieldDefinitionSnapshotQuery,
  fieldDefinitionCatalogRowToWire,
  fieldDefinitionCatalogToWire,
} from "../field-definition-command";

export const fieldDefinitionBundleRoutes = new Hono();

fieldDefinitionBundleRoutes.get("/", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Account context required" }, 401);
  try {
    const snapshot = await executeFieldDefinitionSnapshotQuery(accountId);
    return c.json({ snapshot: fieldDefinitionSnapshotToJsonWire(snapshot) });
  } catch (error) {
    const diagnostic = (error as { diagnostic?: { message?: string } }).diagnostic;
    if (diagnostic !== undefined) {
      return c.json(
        { error: diagnostic.message ?? "Invalid field-definition snapshot", diagnostic },
        409,
      );
    }
    throw error;
  }
});

fieldDefinitionBundleRoutes.get("/catalog", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Account context required" }, 401);
  const page = await executeFieldDefinitionCatalogQuery(accountId, {
    search: c.req.query("q") ?? "",
    ...(c.req.query("cursor") === undefined
      ? {}
      : { cursor: c.req.query("cursor") }),
    limit: 50,
  });
  return c.json(fieldDefinitionCatalogToWire(page));
});

fieldDefinitionBundleRoutes.get("/catalog/:fieldId", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Account context required" }, 401);
  const field = await executeFieldDefinitionIdentityQuery(
    accountId,
    c.req.param("fieldId"),
  );
  return c.json({
    field: field === undefined ? null : fieldDefinitionCatalogRowToWire(field),
  });
});

fieldDefinitionBundleRoutes.get("/resurrections", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Account context required" }, 401);
  const ownerKey = c.req.query("ownerKey") ?? "";
  if (ownerKey.length === 0) return c.json({ error: "ownerKey is required" }, 422);
  const ownerKind = c.req.query("ownerKind");
  const storageName = c.req.query("storageName");
  if ((ownerKind === undefined) !== (storageName === undefined)) {
    return c.json({ error: "ownerKind and storageName must be supplied together" }, 422);
  }
  if (ownerKind !== undefined && ownerKind !== "type" && ownerKind !== "function") {
    return c.json({ error: "ownerKind must be type or function" }, 422);
  }
  const fields = await executeFieldDefinitionResurrectionQuery(
    accountId,
    ownerKey,
    ownerKind === undefined || storageName === undefined
      ? undefined
      : { ownerKey, kind: ownerKind, storageName },
  );
  if (fields === undefined) return c.json({ error: "Field owner not found" }, 404);
  return c.json({ fields });
});

fieldDefinitionBundleRoutes.post("/", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Account context required" }, 401);
  const body = await c.req.json<Partial<SaveFieldDefinitionBundleRequest>>();
  if (!Array.isArray(body.ownerMutations)) {
    return c.json({ error: "Body must include ownerMutations[]" }, 422);
  }
  if (body.expectedSnapshot !== undefined && (body.expectedSnapshot === null
    || !Array.isArray(body.expectedSnapshot.owners)
    || !Array.isArray(body.expectedSnapshot.fields)
    || !Array.isArray(body.expectedSnapshot.facets))) {
    return c.json({ error: "expectedSnapshot must include owners[], fields[] and facets[]" }, 422);
  }
  if (body.desiredFacets !== undefined && !Array.isArray(body.desiredFacets)) {
    return c.json({ error: "desiredFacets must be an array" }, 422);
  }
  if (body.resurrectFieldIds !== undefined && !Array.isArray(body.resurrectFieldIds)) {
    return c.json({ error: "resurrectFieldIds must be an array" }, 422);
  }
  if (body.replaceFacetFieldIds !== undefined && !Array.isArray(body.replaceFacetFieldIds)) {
    return c.json({ error: "replaceFacetFieldIds must be an array" }, 422);
  }
  const result = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: body.ownerMutations,
    ...(body.expectedSnapshot === undefined ? {} : { expectedSnapshot: body.expectedSnapshot }),
    ...(body.resurrectFieldIds === undefined
      ? {}
      : { resurrectFieldIds: body.resurrectFieldIds }),
    ...(body.desiredFacets === undefined
      ? {}
      : { desiredFacets: body.desiredFacets }),
    ...(body.replaceFacetFieldIds === undefined
      ? {}
      : { replaceFacetFieldIds: body.replaceFacetFieldIds }),
  });
  if (!result.ok) {
    return c.json(
      { error: result.error.message, diagnostic: result.error },
      result.error.$tag === "PersistenceConflict" ? 409 : 422,
    );
  }
  return c.json({ snapshot: fieldDefinitionSnapshotToJsonWire(result.snapshot) });
});
