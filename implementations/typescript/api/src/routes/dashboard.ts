// ---------------------------------------------------------------------------
// Dashboard routes — Fenel-bodied via the 12a arc.
//
// Phase 12c-routes sub-step 4 — disposition: Fenel-bodied (A) end-to-end.
// 75 dashboard:* fnIds LANDED across Phase 12a sub-steps 1-8; each route
// here is a thin TS wrapper calling invokeIOAction against the matching
// Fenel body. Per-route headers below recap each body's fnId where
// useful; the source of truth for behavior is the Fenel body + the
// defineFunction spec.
//
// 2026-05-24 (Phase 12c-routes sub-step 2 — Decision U): the
// dashboardModule was missing from runtime/src/evaluator.ts:loadRegistry
// pre-12c-2; production-runtime invokeIOAction calls against any
// dashboard:* fnId reproducibly threw "No IO handler registered". The
// registry fix landed alongside mixedIngressModule in 12c-routes-2
// (runtime/src/evaluator.ts:loadRegistry now includes both). Audit-
// tooling sub-step (walk getCatalog() asserting every ioAction has a
// runtime handler) is deferred per Decision II — see
// notes/phase-12c-routes-close.md.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
// ts-elimination-completion Phase 4 — dashboard.ts is now a pure Hono route
// shell: every read/write goes through state:* / dashboard:* IO leaves via
// invokeIOAction. No direct @fenel/db / drizzle imports remain (the file drains
// from DIRECT_DB_LEAF_ALLOW this commit).
import { startFunctionInstance, startFunctionInstanceByName, FunctionStartUnavailable, invokeIOActionAs, permitsIOActionAs, getRuntimeAccountFieldRegistry, loadAccountExecutionRegistryForRequest } from "@fenel/runtime";
import { valueFromJsonWire, valueToJsonWire, instanceFromJsonWire, instanceToJsonWire, VALUE_JSON_ENCODING, INSTANCE_JSON_ENCODING, isValueJsonEncoding, isInstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { functionDefinitionToJsonWire, ownerDefinitionToJsonWire, typeDefinitionToJsonWire, viewDefinitionToJsonWire } from "@fenel/engine/authoring/expression";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { systemEntities, getDefaultView, getDefaultInlineView, resolveEffect } from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import {
  fieldRepresentationalInterfaceNames,
  repositoryFieldCatalog,
} from "@fenel/engine/repository-field-catalog";
import type { Context } from "hono";
import type { FenelFunction } from "@fenel/engine/types";
import type { FieldOwnerEntity } from "@fenel/engine/field-identity";
import { executeFieldDefinitionCommand } from "../field-definition-command";
import { getAuthenticatedUserAccountId, getAuthority, getSession, getSessionToken } from "../middleware/auth";
import type { AuthorityRef } from "@fenel/engine/authority";
import { IOStopContractError, prepareIOStop } from "../io-stop";
import { nativeJsonResponse, readNativeJson } from "../native-json";
import { catalogResponse } from "../catalog-response-cache";
import { createReaderMetadataTargetsRoutes, projectReaderMetadata } from "../reader-metadata";
import { listAccounts, personalAccountForToken } from "@fenel/core";
import type { WorkspaceBootstrapRoot } from "../workspace-bootstrap";
import { createWorkspaceBootstrapRoutes } from "./workspace-bootstrap";
import { projectLocusTypeDescriptions } from "../../../engine/src/authoring/locus-type-presentation";

const dashboardRoutes = new Hono();

// Dashboard/admin authority requires a real bearer/cookie session. Tenant
// selectors (including the public embed X-Account-Id header) carry no actor
// authority and are rejected before any route can reach an IO leaf.
dashboardRoutes.use("*", async (c, next) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  c.set("accountId" as never, accountId as never);
  // rights R2a — MINT WHERE THE AUTHENTICATION HAPPENS. Every helper below used
  // to take a bare `accountId` string and hand it to `invokeIOAction`, which
  // made the string itself the principal: anything that could name an account
  // could act as it. They now take the opaque handle. `accountId` survives as
  // the PARTITION key (registry loads, field graphs); rights R2b makes the
  // state family argue it, at which point most of these stop passing it.
  c.set("authority" as never, (await getAuthority(c)) as never);
  await next();
});

function getAccountId(c: { get: (key: string) => unknown }): string {
  return c.get("accountId") as string;
}

function authorityOf(c: { get: (key: string) => unknown }): AuthorityRef {
  return c.get("authority") as AuthorityRef;
}

/** Short data operations use the registered Fenel body under the same reader
 * authority without depending on per-account copies in the functions table.
 * Dynamic function invocation and long-running actions keep their normal mode. */
function invokeDataAction(authority: AuthorityRef, profileId: string | null, action: string, params: Record<string, unknown>) {
  return invokeIOActionAs(authority, profileId, action, params, { persistence: "ephemeral" });
}

/** Project the validated entity_definition payload into the type-owner wire
 * shape. Template names are storage/render metadata: the Fenel planner carries
 * them opaquely while Field identity logic only consumes id/type. */
export function typeOwnerDefinitionFromValidated(
  name: string,
  validated: Record<string, unknown>,
): FieldOwnerEntity {
  return {
    id: name,
    type: validated["type"] as FieldOwnerEntity["type"],
    ...(typeof validated["defaultTemplate"] === "string"
      ? { defaultTemplate: validated["defaultTemplate"] }
      : {}),
    ...(typeof validated["defaultTemplateInline"] === "string"
      ? { defaultTemplateInline: validated["defaultTemplateInline"] }
      : {}),
  };
}

// Phase 4.2 — full entity_instances envelope row, fetched via the
// state:getInstanceById leaf (account-scoped via ctx) instead of a direct
// @fenel/db getEntityInstance read. The leaf returns Maybe; this helper
// unwraps it to the row or null. Pure marshalling over the substrate boundary.
type EntityRow = {
  id: string;
  accountId: string;
  entityType: string;
  data: unknown;
  dataEncoding?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

async function instanceValueResponse(row: EntityRow | null, authority?: ModuleRegistry) {
  if (!row) return null;
  if (isValueJsonEncoding(row.dataEncoding) || isInstanceJsonEncoding(row.dataEncoding)) return { ...row, valueEncoding: row.dataEncoding };
  if (row.dataEncoding != null) throw new Error(`Unsupported stored value encoding: ${row.dataEncoding}`);
  const registry = authority ?? await getRuntimeAccountFieldRegistry(row.accountId);
  const type = registry.getIdentifiedEntity(row.entityType)?.type ?? registry.getEntity(row.entityType)?.type;
  // Legacy rows are encoded as raw values, never decoded by marker shape.
  return type ? { ...row, data: valueToJsonWire(type, row.data, registry, VALUE_JSON_ENCODING), valueEncoding: VALUE_JSON_ENCODING } : row;
}

async function incomingEntityValue(accountId: string, c: Context, typeName: string, raw: unknown, encoding: unknown): Promise<unknown | Response> {
  if (encoding === undefined) return raw;
  if (!isValueJsonEncoding(encoding)) return c.json({ error: "Unsupported value encoding" }, 422);
  const registry = await getRuntimeAccountFieldRegistry(accountId);
  const type = registry.getIdentifiedEntity(typeName)?.type ?? registry.getEntity(typeName)?.type;
  if (!type) return c.json({ error: `Unknown entity type: ${typeName}` }, 422);
  try { return valueFromJsonWire(type, raw, registry, encoding); }
  catch (cause) { return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 422); }
}
async function getInstanceById(authority: AuthorityRef, id: string): Promise<EntityRow | null> {
  const m = (await invokeIOActionAs(authority, null, "state:getInstanceById", { id })) as
    | { $tag: "Just"; _0: EntityRow }
    | { $tag: "Nothing" };
  return m.$tag === "Just" ? m._0 : null;
}

// Phase 12b — Zod retirement. Replaces the per-route Zod-validate prelude
// with a call through to the `state:validateEntityInstance` substrate
// primitive. Validates `raw` against the registered FenelType for
// `typeName`; returns the validated/coerced record on success, or a Hono
// 422 Response on failure (containing the canonical `errors: [{path,
// message}]` shape the frontend's AdminForm / type-detail consumers read).
// Callers route: `const data = await validateBody(...); if (data instanceof
// Response) return data;` — works because Hono's Response is structurally
// distinct from a plain record. `partial=true` narrows the validation to
// only fields present in `raw`, matching the legacy Zod `.partial()` /
// `.optional()` permissivity.
async function validateBody<T = Record<string, unknown>>(
  authority: AuthorityRef,
  c: Context,
  typeName: string,
  raw: unknown,
  partial: boolean,
): Promise<T | Response> {
  const result = (await invokeIOActionAs(
    authority,
    null,
    "state:validateEntityInstance",
    { typeName, raw, partial },
  )) as
    | { ok: true; value: T }
    | { ok: false; errors: { path: string; message: string }[] };
  if (!result.ok) {
    return c.json(
      { error: "Validation failed", errors: result.errors ?? [] },
      422,
    );
  }
  return result.value;
}

// ---- Profiles ----

/** Flatten an entity_instance row into the legacy profile shape downstream
 *  callers expect. Used by the PUT /profiles/:id wrapper (12a-2 — calls
 *  getEntityInstance after the patch and flattens the raw drizzle row)
 *  and by the POST /profiles wrapper (flattens the newly-fetched row for
 *  the 201 body). */
function flattenProfile(row: { id: string; accountId: string; data: unknown; createdAt: Date | string }): any {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    accountId: row.accountId,
    type: data.type ?? "person",
    gender: data.gender ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    dob: data.dob ?? null,
    avatar: data.avatar ?? null,
    notes: data.notes ?? null,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    nicknames: data.nicknames ?? null,
    archivedAt: data.archivedAt ?? null,
    createdAt: row.createdAt,
  };
}

dashboardRoutes.get("/profiles", async (c) => {
  const authority = authorityOf(c);
  // Aggregation (profile rows + tags + handleCount stitching) happens in
  // the Fenel body; the TS wrapper does sort + 100-limit (no std:sortBy /
  // std:take primitives yet — same disposition as 12a-2's listPurchases).
  const result = (await invokeIOActionAs(authority, null, "dashboard:listProfilesAggregated", {})) as Array<{ createdAt: Date | string }>;
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ profiles: result.slice(0, 100) });
});

dashboardRoutes.get("/profiles/:id", async (c) => {
  const authority = authorityOf(c);
  const profileId = c.req.param("id");

  const detailMaybe = (await invokeIOActionAs(authority, null, "dashboard:getProfileDetail", { profileId })) as
    | { $tag: "Nothing" }
    | { $tag: "Just"; _0: Record<string, unknown> }
    | null;
  if (!detailMaybe || detailMaybe.$tag !== "Just" || !detailMaybe._0) {
    return c.json({ error: "Not found" }, 404);
  }
  const detail = detailMaybe._0;

  // Phase 4.3 — entitlements + activeFlows re-pointed off direct @fenel/db
  // reads to state:getProfileEntitlements + state:listActiveFlowsByProfile
  // (the latter reproduces the in-flight-status query verbatim). Spliced into
  // the body's ProfileDetail-Core to complete the wire shape.
  const entitlements = await invokeIOActionAs(authority, null, "state:getProfileEntitlements", { profileId });
  const activeFlows = await invokeIOActionAs(authority, null, "state:listActiveFlowsByProfile", { profileId });

  return c.json({ ...detail, entitlements, activeFlows });
});

dashboardRoutes.post("/profiles", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "profile", body, true);
  if (v instanceof Response) return v;
  // Sub-rows (handles / phones / tags) aren't part of the profile entity's
  // own type — they're separate entity-instance rows. Pull them off the raw
  // body (they weren't part of the validation pass since the type doesn't
  // declare them) and iterate after the profile is persisted.
  const handles = (body as Record<string, unknown>).handles as
    | Array<Record<string, unknown>>
    | undefined;
  const phones = (body as Record<string, unknown>).phones as
    | Array<Record<string, unknown>>
    | undefined;
  const tags = (body as Record<string, unknown>).tags as
    | Array<Record<string, unknown>>
    | undefined;

  // Whitelist + defaults — the legacy field set; data is passed through
  // to the Fenel body's tryCreateInstanceByName.
  const profileFields = {
    type: v.type ?? "person",
    gender: v.gender ?? null,
    email: v.email || null,
    phone: v.phone || null,
    dob: v.dob || null,
    avatar: v.avatar || null,
    notes: v.notes || null,
    firstName: v.firstName || null,
    lastName: v.lastName || null,
    nicknames: Array.isArray(v.nicknames) && v.nicknames.length ? v.nicknames : null,
  };

  const createResult = (await invokeIOActionAs(authority, null, "dashboard:createProfile", { data: profileFields })) as { ok: boolean; value?: string; error?: string };
  if (!createResult.ok || !createResult.value) {
    return c.json({ error: createResult.error ?? "create failed" }, 422);
  }
  const newProfileId = createResult.value;

  // Decision G — handles/phones/tags iteration stays in TS. Each element
  // dispatches through dashboard:createEntityInstanceByType (existing
  // 12a-2 fnId) so the substrate-first path is preserved. The legacy
  // didn't roll back on partial failure either; mirror that.
  for (const h of handles ?? []) {
    await invokeDataAction(authority, null, "dashboard:createEntityInstanceByType", {
      entityType: "profile_handle",
      data: {
        profileId: newProfileId,
        platform: h.platform,
        handle: h.handle,
        suspected: h.suspected ?? false,
        validFrom: h.validFrom,
        validTo: h.validTo,
      },
    });
  }
  for (const p of phones ?? []) {
    await invokeDataAction(authority, null, "dashboard:createEntityInstanceByType", {
      entityType: "profile_phone",
      data: {
        profileId: newProfileId,
        number: p.number,
        label: p.label || "mobile",
      },
    });
  }
  for (const t of tags ?? []) {
    await invokeDataAction(authority, null, "dashboard:createEntityInstanceByType", {
      entityType: "profile_tag",
      data: {
        profileId: newProfileId,
        tag: t.tag,
        context: t.context,
        importance: t.importance ?? null,
        validFrom: t.validFrom ?? new Date().toISOString(),
      },
    });
  }

  // Fetch + flatten for the 201 response. The createProfile body returns
  // only the new id (Result-shape); the response shape needs the full row.
  const newRow = await getInstanceById(authority, newProfileId);
  return c.json({ profile: newRow ? flattenProfile(newRow) : null }, 201);
});

// Whitelist of profile-data fields the legacy route accepted (handles /
// phones / tags arrays in the Zod schema are managed via the generic
// /entity-instances endpoints, not via this route). The empty-string-to-null
// coercion preserves the legacy convention for nullable string fields.
const PROFILE_DATA_KEYS = [
  "type", "gender", "email", "phone", "dob", "avatar",
  "notes", "firstName", "lastName", "nicknames", "archivedAt",
] as const;
const PROFILE_NULLABLE_STRING_KEYS = new Set([
  "email", "phone", "dob", "avatar", "notes", "firstName", "lastName",
]);

function buildProfileDataPatch(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_DATA_KEYS) {
    if (!(k in data)) continue;
    let v = data[k];
    if (PROFILE_NULLABLE_STRING_KEYS.has(k) && v === "") v = null;
    out[k] = v;
  }
  return out;
}

dashboardRoutes.put("/profiles/:id", async (c) => {
  const authority = authorityOf(c);
  const profileId = c.req.param("id");
  const body = await c.req.json();
  const v = await validateBody(authority, c, "profile", body, true);
  if (v instanceof Response) return v;

  const existing = await getInstanceById(authority, profileId);
  if (!existing || existing.entityType !== "profile") {
    return c.json({ error: "Not found" }, 404);
  }

  const patch = buildProfileDataPatch(v);
  await invokeIOActionAs(authority, null, "dashboard:patchProfile", {
    id: profileId,
    patch,
  });

  // handles / phones / tags / etc. are managed via the generic entity-instance
  // endpoints now (POST/DELETE /entity-instances/profile_handle/...) — see
  // ENTITY_CONFIG.profile.relationActions in the dashboard.

  const updatedRow = await getInstanceById(authority, profileId);
  return c.json({ profile: updatedRow ? flattenProfile(updatedRow) : null });
});

// Profile relations (handles, phones, tags, intents, relationships) are
// first-class entities now — managed via the generic /entity-instances
// CRUD endpoints. Bespoke routes for them retired in 9b-P.

// ---- Events ----

dashboardRoutes.get("/events", async (c) => {
  const authority = authorityOf(c);
  // Phase 4.4 — re-pointed off the direct DB read to state:listEventsRecent (the
  // query is reproduced verbatim in the leaf). The limit cap stays in the shell.
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const result = await invokeIOActionAs(authority, null, "state:listEventsRecent", { limit });
  return c.json({ events: result });
});

// ---- Purchases ----

dashboardRoutes.get("/purchases", async (c) => {
  const authority = authorityOf(c);
  const result = (await invokeIOActionAs(authority, null, "dashboard:listPurchases", {})) as Array<{ createdAt: Date | string }>;
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ purchases: result });
});

dashboardRoutes.get("/purchases/:id", async (c) => {
  const authority = authorityOf(c);
  const purchaseId = c.req.param("id");

  // Phase 4.4 — re-pointed off direct @fenel/db reads to state:* leaves.
  const purchaseM = (await invokeIOActionAs(authority, null, "state:findPurchaseById", { purchaseId })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (purchaseM.$tag !== "Just") return c.json({ error: "Not found" }, 404);
  const purchase = purchaseM._0;

  const steps = await invokeIOActionAs(authority, null, "state:getPurchaseSteps", { purchaseId });
  const planM = (await invokeIOActionAs(authority, null, "state:findPlanById", { planId: purchase.planId })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  // Match the legacy shape: omit `plan` when the plan is absent (JSON drops
  // undefined keys), rather than emitting null.
  const plan = planM.$tag === "Just" ? planM._0 : undefined;

  return c.json({ purchase, steps, plan });
});

// ---- Inventory ----

dashboardRoutes.get("/inventory", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  // Phase 4.1 — re-pointed off direct @fenel/db reads. state:listInstancesByName
  // returns merged-envelope rows (data spread to top level → `row.slug`, not
  // `row.data.slug`) and lists up to 1000 (benign widening vs the legacy 100).
  // state:getInventoryStatus returns Maybe (Just {_0} / Nothing) — unwrap it,
  // replacing the old value-or-null + filter(Boolean).
  const invRows = (await invokeIOActionAs(authority, null, "state:listInstancesByName", {
    typeName: "inventory",
  })) as Array<Record<string, unknown>>;
  const result = await Promise.all(
    invRows.map(async (row) => {
      const slug = (row as { slug?: string }).slug;
      if (!slug) return null;
      const status = (await invokeIOActionAs(authority, null, "state:getInventoryStatus", {
        accountId,
        slug,
      })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
      return status.$tag === "Just" ? status._0 : null;
    }),
  );

  return c.json({ inventories: result.filter(Boolean) });
});

// ---- Function instances (running invocations of any FenelFunction) ----
//
// All FenelFunction CRUD lives at `/dashboard/functions/:name` further down.
// Library and durable functions share the same `functions` table; durability
// is a property of the function (it has a trigger), not a separate kind.

dashboardRoutes.get("/function-instances", async (c) => {
  const authority = authorityOf(c);
  // Phase 4.7 — re-pointed off the direct DB read to state:listFunctionInstancesByAccount
  // (full rows, optional single-status filter; query reproduced verbatim in the leaf).
  const status = c.req.query("status");
  const result = await invokeIOActionAs(authority, null, "state:listFunctionInstancesByAccount", {
    status: status ? { $tag: "Just", _0: status } : { $tag: "Nothing" },
  });
  return nativeJsonResponse(c, { instances: result });
});

// ---- Items ----

// Bespoke flatten for the legacy ItemRow wire shape: slug/name/type hoisted
// to top level, remaining data nested under `config`. Can't be expressed as
// a Fenel body until a `std:recordEntries` primitive lands (flagged in
// 12a-1 surprise 4); kept as a TS shape-helper in this route file.
function flattenItemEnvelope(row: Record<string, unknown>): Record<string, unknown> {
  const { id, accountId, createdAt, updatedAt: _u, slug, name, type, ...rest } = row as {
    id: string; accountId: string; createdAt: Date | string; updatedAt?: Date | string;
    slug?: string; name?: string; type?: string;
    [k: string]: unknown;
  };
  return {
    id,
    accountId,
    slug: slug ?? "",
    name: name ?? "",
    type: type ?? "",
    config: rest as Record<string, unknown>,
    createdAt,
  };
}

dashboardRoutes.get("/items", async (c) => {
  const authority = authorityOf(c);
  const rows = (await invokeIOActionAs(authority, null, "dashboard:listItemsRaw", {})) as Array<Record<string, unknown>>;
  const result = rows.map(flattenItemEnvelope);
  result.sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  return c.json({ items: result });
});

dashboardRoutes.get("/items/:id", async (c) => {
  const authority = authorityOf(c);
  const itemId = c.req.param("id");
  const maybe = (await invokeIOActionAs(authority, null, "dashboard:getItemRaw", { id: itemId })) as { $tag?: string; _0?: Record<string, unknown> } | null;
  if (!maybe || maybe.$tag !== "Just" || !maybe._0) return c.json({ error: "Not found" }, 404);
  return c.json({ item: flattenItemEnvelope(maybe._0) });
});

// ---- Plans ----

// Bespoke flatten for the legacy PlanRow wire shape: many specifically-named
// fields hoisted + remaining data under `config`. Same recordEntries gap as
// items — kept as a TS shape-helper.
function flattenPlanEnvelope(row: Record<string, unknown>): Record<string, unknown> {
  const {
    id, accountId, createdAt, updatedAt: _u,
    slug, name, amount, currency, duration, providers, onRefund,
    grants, steps, terms,
    ...rest
  } = row as Record<string, unknown> & {
    id: string; accountId: string; createdAt: Date | string; updatedAt?: Date | string;
  };
  return {
    id,
    accountId,
    slug: (slug as string) ?? "",
    name: (name as string) ?? "",
    amount: (amount as number | null) ?? null,
    currency: (currency as string | null) ?? "USD",
    duration: (duration as string | null) ?? null,
    providers: (providers as string[]) ?? [],
    onRefund: (onRefund as string) ?? "manual",
    grants: grants ?? [],
    steps: steps ?? null,
    terms: terms ?? null,
    config: rest as Record<string, unknown>,
    createdAt,
  };
}

dashboardRoutes.get("/plans", async (c) => {
  const authority = authorityOf(c);
  const rows = (await invokeIOActionAs(authority, null, "dashboard:listPlansRaw", {})) as Array<Record<string, unknown>>;
  const result = rows.map(flattenPlanEnvelope);
  result.sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  return c.json({ plans: result });
});

dashboardRoutes.get("/plans/:id", async (c) => {
  const authority = authorityOf(c);
  const planId = c.req.param("id");
  const maybe = (await invokeIOActionAs(authority, null, "dashboard:getPlanRaw", { id: planId })) as { $tag?: string; _0?: Record<string, unknown> } | null;
  if (!maybe || maybe.$tag !== "Just" || !maybe._0) return c.json({ error: "Not found" }, 404);
  return c.json({ plan: flattenPlanEnvelope(maybe._0) });
});

// ---- Forms ----
// forms-collapse Phase 4 (2026-06-08) — the legacy form list + detail routes
// (GET /forms + GET /forms/:id) RETIRED. A funnel is a registered type; its
// detail surface is `/app/types/entity:<name>` (its captures = the type's
// instances) since Phase 1b. The `forms` surface is gone — see
// design/forms-collapse.md + workstreams/forms-collapse/roadmap.md.

// ---- Channels (for integrations) ----

dashboardRoutes.get("/channels", async (c) => {
  const authority = authorityOf(c);
  // Phase 4.4 — re-pointed off the direct DB read to state:listChannels (verbatim query).
  const result = await invokeIOActionAs(authority, null, "state:listChannels", {});
  return c.json({ channels: result });
});

// ---- Proxy Links ----

function flattenInstance(row: any): any {
  return {
    id: row.id,
    accountId: row.accountId,
    ...(row.data ?? {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

dashboardRoutes.get("/proxy-links", async (c) => {
  const authority = authorityOf(c);
  const result = (await invokeIOActionAs(authority, null, "dashboard:listProxyLinks", {})) as Array<{ createdAt: Date | string }>;
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ proxyLinks: result });
});

dashboardRoutes.get("/proxy-links/stats", async (c) => {
  const authority = authorityOf(c);
  const stats = (await invokeIOActionAs(authority, null, "dashboard:proxyLinksStatsBody", {})) as Record<
    string,
    { totalClicks: number; uniqueVisitors: number }
  >;
  return c.json({ stats });
});

dashboardRoutes.post("/proxy-links", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "proxy_link", body, true);
  if (v instanceof Response) return v;
  const result = (await invokeIOActionAs(authority, null, "dashboard:createProxyLink", {
    data: v,
  })) as { ok: boolean; value?: string; error?: string };
  if (!result.ok) return c.json({ error: "Validation failed", errors: [{ path: "", message: result.error ?? "create failed" }] }, 422);
  const created = await getInstanceById(authority, result.value!);
  return c.json({ proxyLink: created ? flattenInstance(created) : null }, 201);
});

dashboardRoutes.put("/proxy-links/:id", async (c) => {
  const authority = authorityOf(c);
  const linkId = c.req.param("id");
  const body = await c.req.json();
  const v = await validateBody(authority, c, "proxy_link", body, true);
  if (v instanceof Response) return v;
  const existing = await getInstanceById(authority, linkId);
  if (!existing || existing.entityType !== "proxy_link") return c.json({ error: "Not found" }, 404);
  try {
    await invokeIOActionAs(authority, null, "dashboard:updateProxyLink", {
      id: linkId,
      patch: v,
    });
  } catch (err) {
    // Phase 4.2 — structural validation-error check (drops the @fenel/db
    // EntityInstanceValidationError type import); a validation error carries an
    // `issues` array. Validation already happens up-front via validateBody, so
    // this arm is defensive.
    const issues = (err as { issues?: unknown })?.issues;
    if (Array.isArray(issues)) {
      return c.json({ error: "Validation failed", errors: issues }, 422);
    }
    throw err;
  }
  const updated = await getInstanceById(authority, linkId);
  return c.json({ proxyLink: updated ? flattenInstance(updated) : null });
});

dashboardRoutes.delete("/proxy-links/:id", async (c) => {
  const authority = authorityOf(c);
  const linkId = c.req.param("id");
  await invokeIOActionAs(authority, null, "dashboard:deleteProxyLink", { id: linkId });
  return c.json({ ok: true });
});

// ---- Email Templates ----

dashboardRoutes.get("/email-templates", async (c) => {
  const authority = authorityOf(c);
  const result = (await invokeIOActionAs(authority, null, "dashboard:listEmailTemplates", {})) as Array<{ createdAt: Date | string }>;
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ emailTemplates: result });
});

dashboardRoutes.post("/email-templates", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "email_template", body, true);
  if (v instanceof Response) return v;
  const result = (await invokeIOActionAs(authority, null, "dashboard:createEmailTemplate", {
    data: v,
  })) as { ok: boolean; value?: string; error?: string };
  if (!result.ok) return c.json({ error: "Validation failed", errors: [{ path: "", message: result.error ?? "create failed" }] }, 422);
  const created = await getInstanceById(authority, result.value!);
  return c.json({ emailTemplate: created ? flattenInstance(created) : null }, 201);
});

dashboardRoutes.put("/email-templates/:id", async (c) => {
  const authority = authorityOf(c);
  const templateId = c.req.param("id");
  const body = await c.req.json();
  const v = await validateBody(authority, c, "email_template", body, true);
  if (v instanceof Response) return v;
  const existing = await getInstanceById(authority, templateId);
  if (!existing || existing.entityType !== "email_template") return c.json({ error: "Not found" }, 404);
  try {
    await invokeIOActionAs(authority, null, "dashboard:updateEmailTemplate", {
      id: templateId,
      patch: v,
    });
  } catch (err) {
    // Phase 4.2 — structural validation-error check (drops the @fenel/db
    // EntityInstanceValidationError type import); a validation error carries an
    // `issues` array. Validation already happens up-front via validateBody, so
    // this arm is defensive.
    const issues = (err as { issues?: unknown })?.issues;
    if (Array.isArray(issues)) {
      return c.json({ error: "Validation failed", errors: issues }, 422);
    }
    throw err;
  }
  const updated = await getInstanceById(authority, templateId);
  return c.json({ emailTemplate: updated ? flattenInstance(updated) : null });
});

dashboardRoutes.delete("/email-templates/:id", async (c) => {
  const authority = authorityOf(c);
  const templateId = c.req.param("id");
  await invokeIOActionAs(authority, null, "dashboard:deleteEmailTemplate", { id: templateId });
  return c.json({ ok: true });
});

// ---- Account ----

dashboardRoutes.get("/account", async (c) => {
  const authority = authorityOf(c);
  // Phase 4.4 — re-pointed off the direct DB read to state:getAccountById (ctx-scoped).
  const accM = (await invokeIOActionAs(authority, null, "state:getAccountById", {})) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (accM.$tag !== "Just") return c.json({ error: "Account not found" }, 404);
  return c.json({ account: accM._0 });
});

dashboardRoutes.put("/account", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "account", body, true);
  if (v instanceof Response) return v;
  // Whitelist + empty-patch guard stay in the shell; the UPDATE moves to
  // state:updateAccount (ctx-scoped, returns Maybe of the updated row).
  const updates: Record<string, unknown> = {};
  if (v.name !== undefined) updates.name = v.name;
  if (v.slug !== undefined) updates.slug = v.slug;
  if (v.config !== undefined) updates.config = v.config;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const updatedM = (await invokeIOActionAs(authority, null, "state:updateAccount", { patch: updates })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  return c.json({ account: updatedM.$tag === "Just" ? updatedM._0 : undefined });
});

// ---- Stats ----

dashboardRoutes.get("/stats", async (c) => {
  const authority = authorityOf(c);
  const result = (await invokeDataAction(authority, null, "dashboard:dashboardStats", {})) as Record<
    string,
    unknown
  >;
  return c.json(result);
});

// ---- Analytics (time-series) ----

dashboardRoutes.get("/analytics/timeseries", async (c) => {
  const authority = authorityOf(c);
  const days = Math.min(parseInt(c.req.query("days") ?? "30", 10) || 30, 90);
  const eventTypeRaw = c.req.query("type");
  const since = new Date();
  since.setDate(since.getDate() - days);
  const eventType =
    eventTypeRaw === undefined
      ? { $tag: "Nothing" as const }
      : { $tag: "Just" as const, _0: eventTypeRaw };
  const result = (await invokeDataAction(authority, null, "dashboard:analyticsTimeseriesBody", {
    since: since.toISOString(),
    eventType,
    days,
  })) as Record<string, unknown>;
  return c.json(result);
});

dashboardRoutes.get("/analytics/summary", async (c) => {
  const authority = authorityOf(c);
  const now = new Date();
  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  const result = (await invokeDataAction(authority, null, "dashboard:analyticsSummary", {
    d7: d7.toISOString(),
    d30: d30.toISOString(),
  })) as Record<string, unknown>;
  return c.json(result);
});

// ---- Types (the FenelType registry; was entity_definitions pre-9.I) ----

function typeRowToJsonWire(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...typeDefinitionToJsonWire(row),
    ...(objectRecord(row.declaration) ? { declaration: typeDefinitionToJsonWire(row.declaration as Record<string, unknown>) } : {}),
  };
}

dashboardRoutes.get("/types", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  return catalogResponse(accountId, "types", c.req.header("If-None-Match"),
    { authority, action: "dashboard:listTypesMerged", params: { accountId } },
    (merged) => ({ types: (merged as Array<Record<string, unknown>>).map(typeRowToJsonWire) }));
});

dashboardRoutes.get("/types/:name", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const maybe = (await invokeDataAction(authority, null, "dashboard:getTypeDetail", {
    accountId,
    name,
  })) as { $tag?: string; _0?: Record<string, unknown> } | null;
  if (!maybe || maybe.$tag !== "Just" || !maybe._0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ definition: typeRowToJsonWire(maybe._0) });
});

dashboardRoutes.post("/types", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const body = await c.req.json();
  // typed-function-references Phase 9a-4 — `name` is the type's Codeable
  // codeName AND the load-bearing `types.name` persistence KEY; it is no
  // longer a declared field on the `entity_definition` $record (identity is
  // a Codeable projection, not a schema field). Source it off the raw body
  // BEFORE validate — `validate(.., {coerce})` keeps only declared fields, so
  // an undeclared `name` would be dropped from `v`. Same pre-pull the PUT does
  // from its route param and `/profiles` does for its sub-rows. The Codeable
  // owner/field identities are committed through the definition-bundle
  // command below; owner-level representations remain ordinary instances.
  const name = typeof (body as Record<string, unknown>).name === "string"
    ? ((body as Record<string, unknown>).name as string).trim()
    : "";
  if (!name) return c.json({ error: "name is required" }, 422);
  const v = await validateBody(authority, c, "entity_definition", body, true);
  if (v instanceof Response) return v;
  const ownerKey = `type:${name}`;
  const saved = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: [{
      kind: "upsert",
      owner: {
        ownerKey,
        kind: "type",
        storageName: name,
        definition: typeOwnerDefinitionFromValidated(name, v),
      },
    }],
  });
  if (!saved.ok) {
    return c.json({ error: saved.error.message, diagnostic: saved.error }, 422);
  }
  const def = saved.snapshot.owners.find((owner) => owner.ownerKey === ownerKey);
  return c.json({ definition: def ? ownerDefinitionToJsonWire(def) : def }, 201);
});

dashboardRoutes.put("/types/:name", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const body = await c.req.json();
  const v = await validateBody(authority, c, "entity_definition", body, true);
  if (v instanceof Response) return v;
  // `name` is sourced from the route param (the persistence KEY / Codeable
  // codeName), not from the validated body — it is no longer a declared
  // `entity_definition` field (Phase 9a-4). label/description/codeName are
  // committed with its Field catalog/facets by the definition-bundle command.
  // The types row carries only name (key) + type + templates.
  const ownerKey = `type:${name}`;
  const saved = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: [{
      kind: "upsert",
      owner: {
        ownerKey,
        kind: "type",
        storageName: name,
        definition: typeOwnerDefinitionFromValidated(name, v),
      },
    }],
  });
  if (!saved.ok) {
    return c.json({ error: saved.error.message, diagnostic: saved.error }, 422);
  }
  const def = saved.snapshot.owners.find((owner) => owner.ownerKey === ownerKey);
  return c.json({ definition: def ? ownerDefinitionToJsonWire(def) : def });
});

dashboardRoutes.delete("/types/:name", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const name = c.req.param("name");
  // Existence + isSystem guards via the existing state:getType leaf; the
  // delete via the new state:deleteType leaf.
  const existingM = (await invokeIOActionAs(authority, null, "state:getType", { name })) as
    | { $tag: "Just"; _0: { isSystem?: boolean } }
    | { $tag: "Nothing" };
  if (existingM.$tag !== "Just") return c.json({ error: "Not found" }, 404);
  if (existingM._0.isSystem) return c.json({ error: "Cannot delete system type" }, 403);
  const deleted = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: [{
      kind: "delete",
      ownerKey: `type:${name}`,
      ownerKind: "type",
      storageName: name,
    }],
  });
  if (!deleted.ok) {
    return c.json({ error: deleted.error.message, diagnostic: deleted.error }, 422);
  }
  return c.json({ ok: true });
});

// Seed system types for this account (idempotent)
dashboardRoutes.post("/types/seed", async (c) => {
  const authority = authorityOf(c);
  const seeded = [];
  for (const entity of systemEntities) {
    // label / description for system types live in their built-in
    // Labelable / Describable instances (registered at engine boot).
    // No mirror into the types row needed.
    const def = await invokeIOActionAs(authority, null, "state:upsertType", {
      def: {
        name: entity.id,
        type: entity.type as Record<string, unknown>,
        defaultTemplate: getDefaultView(entity.id),
        defaultTemplateInline: getDefaultInlineView(entity.id),
        isSystem: true,
      },
    });
    seeded.push(objectRecord(def) ? typeRowToJsonWire(def as Record<string, unknown>) : def);
  }
  return c.json({ types: seeded });
});

// ---- Views (per-account user-defined TypeView records, 9.I.2) ----

function viewRowToJsonWire(row: Record<string, unknown>): Record<string, unknown> {
  const view = objectRecord(row.view);
  return view ? { ...row, view: viewDefinitionToJsonWire(view) } : row;
}

dashboardRoutes.get("/views", async (c) => {
  const authority = authorityOf(c);
  const rows = await invokeIOActionAs(authority, null, "state:listViews", {}) as Array<Record<string, unknown>>;
  return c.json({ views: rows.map(viewRowToJsonWire) });
});

dashboardRoutes.get("/views/:name", async (c) => {
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const rowM = (await invokeIOActionAs(authority, null, "state:getView", { name })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (rowM.$tag !== "Just") return c.json({ error: "Not found" }, 404);
  return c.json({ definition: viewRowToJsonWire(rowM._0) });
});

dashboardRoutes.put("/views/:name", async (c) => {
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const body = await c.req.json<{ view: Record<string, unknown> }>();
  if (!body.view || typeof body.view !== "object") {
    return c.json({ error: "Body must include `view` object" }, 422);
  }
  const row = await invokeIOActionAs(authority, null, "state:upsertView", { name, view: body.view }) as Record<string, unknown>;
  return c.json({ definition: viewRowToJsonWire(row) });
});

dashboardRoutes.delete("/views/:name", async (c) => {
  const authority = authorityOf(c);
  const name = c.req.param("name");
  await invokeIOActionAs(authority, null, "state:deleteView", { name });
  return c.json({ ok: true });
});

// ---- Functions (per-account FenelFunction records — unified library + durable) ----
//
// Single CRUD surface for ALL FenelFunctions. A function with a `trigger` field
// is durable (produces instances when the trigger fires); without one it is a
// callable library function invoked explicitly.

function functionRowToJsonWire(row: Record<string, unknown>): Record<string, unknown> {
  const fn = objectRecord(row.function);
  return fn && Array.isArray(fn.params) && objectRecord(fn.returns)
    ? { ...row, function: functionDefinitionToJsonWire(fn as unknown as FenelFunction) }
    : row;
}

dashboardRoutes.get("/functions", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  return catalogResponse(accountId, "functions", c.req.header("If-None-Match"),
    { authority, action: "dashboard:listFunctionsMerged", params: { accountId } },
    (merged) => ({ functions: (merged as Array<Record<string, unknown>>).map(functionRowToJsonWire) }));
});

// Register literal function paths before /functions/:name so Hono does not
// interpret them as function names.
// Bulk live counts — one row per function (running / waiting). Powers the
// "Running" column on the functions listing without N+1 fetches.
dashboardRoutes.get("/functions/live-counts", async (c) => {
  const authority = authorityOf(c);
  const counts = (await invokeIOActionAs(authority,
    null,
    "dashboard:functionLiveCountsBody",
    {},
  )) as Record<string, { running: number; waiting: number }>;
  return c.json({ counts });
});

dashboardRoutes.get("/functions/:name", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const maybe = (await invokeDataAction(authority, null, "dashboard:getFunctionDetail", {
    accountId,
    name,
  })) as { $tag?: string; _0?: Record<string, unknown> } | null;
  if (!maybe || maybe.$tag !== "Just" || !maybe._0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ definition: functionRowToJsonWire(maybe._0) });
});

dashboardRoutes.patch("/functions/:id/active", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json<{ active?: unknown }>();
  if (typeof body.active !== "boolean") return c.json({ error: "active must be a boolean" }, 422);
  const result = await invokeIOActionAs(authority, null, "state:setFunctionActive", {
    functionId: c.req.param("id"), active: body.active,
  }) as { $tag: "Nothing" } | { $tag: "Just"; _0: { id: string; active: boolean } };
  if (result.$tag !== "Just") return c.json({ error: "Current editable function not found" }, 404);
  return c.json(result._0);
});

dashboardRoutes.put("/functions/:name", async (c) => {
  const accountId = getAccountId(c);
  const name = c.req.param("name");
  const body = await c.req.json<{ function: Record<string, unknown> }>();
  if (!body.function || typeof body.function !== "object") {
    return c.json({ error: "Body must include `function` object" }, 422);
  }
  const { name: _legacyFunctionName, ...functionDefinition } = body.function;
  const ownerKey = `function:${name}`;
  const saved = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: [{
      kind: "upsert",
      owner: {
        ownerKey,
        kind: "function",
        storageName: name,
        definition: { ...functionDefinition, id: typeof functionDefinition.id === "string" ? functionDefinition.id : name } as FenelFunction,
      },
    }],
  });
  if (!saved.ok) {
    return c.json({ error: saved.error.message, diagnostic: saved.error }, 422);
  }
  const row = saved.snapshot.owners.find((owner) => owner.ownerKey === ownerKey);
  return c.json({ definition: row ? ownerDefinitionToJsonWire(row) : row });
});

dashboardRoutes.delete("/functions/:name", async (c) => {
  const accountId = getAccountId(c);
  const name = c.req.param("name");
  const deleted = await executeFieldDefinitionCommand(accountId, {
    ownerMutations: [{
      kind: "delete",
      ownerKey: `function:${name}`,
      ownerKind: "function",
      storageName: name,
    }],
  });
  if (!deleted.ok) {
    return c.json({ error: deleted.error.message, diagnostic: deleted.error }, 422);
  }
  return c.json({ ok: true });
});

// Manually start a new instance of a function (durable test runner).
dashboardRoutes.post("/functions/:name/run", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const body = await readNativeJson<{
    profileId: string;
    payload?: Record<string, unknown>;
  }>(c);

  if (!body.profileId) {
    return c.json({ error: "profileId is required" }, 400);
  }

  const profileM = (await invokeIOActionAs(authority, null, "state:findProfileById", { profileId: body.profileId })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (profileM.$tag !== "Just") return c.json({ error: "Profile not found" }, 404);

  try {
    // rights R2a — the REQUEST authority, not a fresh sessionless one. A
    // dashboard-initiated run is a session acting; attributing it to the
    // `"trigger"` lane would also corrupt R4's ingress census.
    const instanceId = await startFunctionInstanceByName(
      accountId, name, body.profileId, "_manual_run", body.payload ?? {}, authorityOf(c),
    );
    return c.json({ instanceId, started: true }, 201);
  } catch (error) {
    if (error instanceof FunctionStartUnavailable) return c.json({ error: error.message }, 409);
    throw error;
  }
});

// ---------------------------------------------------------------------------
// IO invocation — runs a built-in io-tagged function (e.g.
// `runTelegramCollector`) by dispatching to its registered runtime IO
// handler. Used by the /dashboard "Run" button on pinned function-call
// instances. Body: { fnId, args } where args is an ordered array of
// already-evaluated plain values (the client pre-runs the call's arg
// expressions through the pure evaluator).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 12a sub-step 5 — /io routes ported to Fenel-bodied shims.
//
// Five routes: POST /io/instances, GET /io/last-result, GET /io/awaiting,
// POST /io/awaiting/:id/resolve, POST /io/invoke. The Fenel bodies live in
// fenel/modules/dashboard/io.fenel and consume the 12a-5 substrate
// (state:listFunctionInstances / getFunctionInstance / resumeWaitingInstance /
// findLastCompletedInstance + dispatch:getModuleFunction + the existing
// engine:get*Action surface from Phase 10b sub-step 1).
//
// The architectural decision pattern is the InvokeDecision ADT (declared
// in io.fenel; exposed via dashboardModule.entities) — decideInvoke
// returns a discriminated union; this wrapper pattern-matches $tag and
// executes the matching IO arm. Each arm is trivial (HTTP framing +
// runtime call) but stays in TS because invokeIOAction takes a runtime-
// determined action string which has no Fenel-side dispatch primitive.
// ---------------------------------------------------------------------------

dashboardRoutes.post("/io/instances", async (c) => {
  const authority = authorityOf(c);
  const body = await readNativeJson<{ fnId?: string; args?: unknown[] }>(c);
  const fnId = body.fnId;
  if (typeof fnId !== "string") {
    return c.json({ error: "fnId required" }, 400);
  }

  const base = (await invokeIOActionAs(authority, null, "dashboard:listIoInstancesBase", { fnName: fnId })) as {
    runs: Array<{ id: string; status: string; startedAt: unknown; completedAt: unknown; variables: Record<string, unknown> | null }>;
    listAction: { $tag: "Just"; _0: string } | { $tag: "Nothing" };
  };

  // Per-row format — record-key iteration + JSON.stringify+slice has no
  // std primitive yet (Decision U). The Fenel body returns raw rows;
  // this wrapper does the lastResult truncation + ISO timestamp slice.
  const runs = base.runs.map((r) => {
    const vars = (r.variables ?? {}) as Record<string, unknown>;
    const lastResult = vars["_lastResult"];
    const lastResultStr =
      lastResult == null
        ? null
        : typeof lastResult === "string"
        ? lastResult
        : JSON.stringify(lastResult, (_key, value) =>
            typeof value === "number" && !Number.isFinite(value) ? String(value)
            : value instanceof Uint8Array ? `Bytes(${Array.from(value).join(", ")})`
            : value instanceof ArrayBuffer ? `Bytes(${Array.from(new Uint8Array(value)).join(", ")})`
            : value).slice(0, 120);
    const startedAt =
      r.startedAt instanceof Date
        ? r.startedAt.toISOString().slice(0, 16).replace("T", " ")
        : String(r.startedAt);
    return {
      id: r.id,
      label: `${r.status} · ${startedAt}`,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      lastResult: lastResultStr,
    };
  });

  // Specialized listing — when listInstancesAction is declared, dispatch
  // through the runtime registry with the params built from fn.params +
  // args. Stays in TS because invokeIOAction's action string is runtime-
  // determined (no Fenel-side dynamic-dispatch primitive today).
  let deployments: unknown[] | null = null;
  let deploymentsError: string | null = null;
  if (base.listAction.$tag === "Just") {
    const action = base.listAction._0;
    const reg = getSystemRegistry();
    const fn = reg.getFunction(fnId);
    const args = Array.isArray(body.args) ? body.args : [];
    const params: Record<string, unknown> = Object.fromEntries(fn?.params.map((p, i) => [p.name, args[i]]) ?? []);
    try {
      const value = await invokeIOActionAs(authority, null, action, params);
      deployments = Array.isArray(value) ? value : [];
    } catch (e: any) {
      deployments = [];
      deploymentsError = e?.message ?? String(e);
    }
  }

  return nativeJsonResponse(c, {
    ok: true,
    supported: true,
    runs,
    deployments,
    deploymentsError,
  });
});

dashboardRoutes.get("/io/last-result", async (c) => {
  const authority = authorityOf(c);
  const fnId = c.req.query("fnId");
  if (!fnId) return c.json({ ok: false, error: "fnId query param required" }, 400);
  const result = (await invokeIOActionAs(authority, null, "dashboard:lastResult", { fnName: fnId })) as
    | { $tag: "Just"; _0: { id: string; value: unknown; startedAt: unknown; completedAt: unknown } }
    | { $tag: "Nothing" };
  if (result.$tag === "Just") {
    return nativeJsonResponse(c, { ok: true, instance: result._0 });
  }
  return nativeJsonResponse(c, { ok: true, instance: null });
});

dashboardRoutes.get("/io/awaiting", async (c) => {
  const authority = authorityOf(c);
  const awaiting = (await invokeIOActionAs(authority, null, "dashboard:listAwaiting", {})) as unknown[];
  return nativeJsonResponse(c, { awaiting });
});

dashboardRoutes.post("/io/awaiting/:instanceId/resolve", async (c) => {
  const authority = authorityOf(c);
  const instanceId = c.req.param("instanceId");
  const body = await readNativeJson<{ value: unknown; suspensionId?: string | null }>(c);
  if (body.suspensionId != null && (typeof body.suspensionId !== "string" || !body.suspensionId)) {
    return c.json({ error: "suspensionId must be a nonempty string or null" }, 400);
  }
  const result = (await invokeIOActionAs(authority, null, "dashboard:resolveAwaiting", {
    instanceId, value: body.value,
    expectedSuspensionId: body.suspensionId ? { $tag: "Just", _0: body.suspensionId } : { $tag: "Nothing" },
  })) as {
    ok: boolean;
    value?: unknown;
    suspended?: boolean;
    status?: string | null;
    suspensionId?: string | null;
    error?: string | null;
  };
  if (!result.ok) {
    const errMsg = result.error ?? "resume failed";
    if (errMsg === "This prompt has changed. Refresh before responding.") return c.json({ ok: false, error: errMsg }, 409);
    if (errMsg === "input does not match the requested type") return c.json({ ok: false, error: errMsg }, 400);
    if (errMsg === "Instance not found" || errMsg === "instance not found") {
      return c.json({ error: errMsg }, 404);
    }
    return c.json({ ok: false, error: errMsg }, 500);
  }
  if (result.suspended) {
    return c.json({ ok: true, suspended: true, status: result.status, suspensionId: result.suspensionId ?? null });
  }
  return nativeJsonResponse(c, { ok: true, value: result.value ?? null });
});

dashboardRoutes.post("/io/invoke", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const body = await readNativeJson<{ fnId: string; args: unknown[]; mode?: "run" | "stop" }>(c);

  if (!body?.fnId || !Array.isArray(body.args)) {
    return c.json({ error: "fnId and args[] required" }, 400);
  }

  const mode = body.mode ?? "run";
  if (mode !== "run" && mode !== "stop") return c.json({ error: "Invalid invocation mode" }, 400);

  // Build params from fn.params + args (the dynamic-key record build has
  // no std:recordEntries primitive today; matches Decision G precedent).
  const reg = getSystemRegistry();
  const fn = reg.getFunction(body.fnId);
  if (!fn) return c.json({ error: `Function not found: ${body.fnId}` }, 404);
  const args = body.args;
  const params: Record<string, unknown> = Object.fromEntries(fn.params.map((p, i) => [p.name, args[i]]));

  const decision = (await invokeIOActionAs(authority, null, "dashboard:decideInvoke", { fnId: body.fnId, mode })) as
    | { $tag: "NotFoundFn"; fnId: string }
    | { $tag: "NotSeededInDb"; fnId: string }
    | { $tag: "DurableStart"; dbFnId: string }
    | { $tag: "OneShotRun"; action: string }
    | { $tag: "OneShotStop"; action: string }
    | { $tag: "NoActionConfigured"; fnId: string; mode: string };

  switch (decision.$tag) {
    case "NotFoundFn":
      return c.json({ error: `Function not found: ${decision.fnId}` }, 404);
    case "NotSeededInDb":
      return c.json({ ok: false, error: `Function ${decision.fnId} not seeded in DB` }, 404);
    case "NoActionConfigured":
      return c.json(
        { error: `Function ${decision.fnId} has no ${decision.mode === "stop" ? "stopAction" : "IOInvokable"} — cannot ${decision.mode}.` },
        400,
      );
    case "DurableStart": {
      try {
        const instanceId = await startFunctionInstance(
          accountId,
          decision.dbFnId,
          null,
          "_dashboard_io_invoke",
          params,
          // rights R2a — the REQUEST authority; see the note on the manual-run
          // route above.
          authorityOf(c),
        );
        // Post-start row read — the durable runtime may have already completed
        // the body synchronously or left it suspended. Phase 4.1 — re-pointed
        // off the dynamic getDb import to state:getFunctionInstance (returns
        // Maybe of the full account-scoped function_instances row; the just-
        // started instance belongs to this account, so the leaf's accountId
        // filter is satisfied).
        const instMaybe = (await invokeIOActionAs(authority, null, "state:getFunctionInstance", {
          instanceId,
        })) as
          | { $tag: "Just"; _0: { status: string; variables?: Record<string, unknown> | null } }
          | { $tag: "Nothing" };
        if (instMaybe.$tag !== "Just") return c.json({ ok: false, error: "Instance not found after start" }, 500);
        const inst = instMaybe._0;
        if (inst.status === "completed") {
          const vars = (inst.variables ?? {}) as Record<string, unknown>;
          return nativeJsonResponse(c, { ok: true, value: vars["_lastResult"] ?? null, instanceId });
        }
        if (inst.status === "failed" || inst.status === "cancelled") {
          return c.json({ ok: false, error: String(inst.variables?._error ?? `instance ${inst.status}`), instanceId }, 500);
        }
        return c.json({ ok: true, suspended: true, instanceId, status: inst.status, suspensionId: inst.variables?._suspensionId ?? null });
      } catch (e: any) {
        return c.json({ ok: false, error: e?.message ?? String(e) }, 500);
      }
    }
    case "OneShotStop": {
      try {
        const stop = prepareIOStop(reg, body.fnId, decision.action, args);
        const value = await invokeIOActionAs(authority, null, decision.action, stop.params);
        return nativeJsonResponse(c, { ok: true, value, ...stop.complete(value) });
      } catch (e: any) {
        return c.json({ ok: false, error: e?.message ?? String(e) }, e instanceof IOStopContractError ? 400 : 500);
      }
    }
    case "OneShotRun": {
      try {
        const value = await invokeIOActionAs(authority, null, decision.action, params);
        return nativeJsonResponse(c, { ok: true, value });
      } catch (e: any) {
        return c.json({ ok: false, error: e?.message ?? String(e) }, 500);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Function triggers — bindings that fire a function when an event matches.
//
// PR-S-3 cutover: bindings live in `subscriptions` (source = event). The
// API still speaks the legacy `{trigger, cancelWhen, args, active}` shape
// — translation lives in flattenSubscriptionToTrigger / metadata payload.
// ---------------------------------------------------------------------------

// Phase 4.7 — local shape (was `Awaited<ReturnType<typeof getSubscriptionById>>`)
// so the last @fenel/db import can leave dashboard.ts and drain the gate.
type SubscriptionRow = {
  id: string;
  accountId: string;
  handlerFunctionId: string | null;
  metadata: string | null;
  enabled: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
} | null;

function readMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function flattenSubscriptionToTrigger(row: NonNullable<SubscriptionRow>) {
  const meta = readMetadata(row.metadata);
  return {
    id: row.id,
    accountId: row.accountId,
    functionId: row.handlerFunctionId,
    trigger: meta.trigger ?? null,
    cancelWhen: meta.cancelWhen ?? null,
    args: meta.args ?? null,
    active: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

dashboardRoutes.get("/functions/:name/triggers", async (c) => {
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const result = (await invokeIOActionAs(authority, null, "dashboard:listFunctionTriggers", { name })) as
    | { $tag: "Just"; _0: Array<{ createdAt: Date | string }> }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Function not found" }, 404);
  const rows = result._0;
  rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return c.json({ triggers: rows.map(flattenSubscriptionToTrigger as never) });
});

dashboardRoutes.post("/functions/:name/triggers", async (c) => {
  const authority = authorityOf(c);
  const name = c.req.param("name");
  const body = await c.req.json<{
    trigger: Record<string, unknown>;
    cancelWhen?: Record<string, unknown>;
    args?: Record<string, unknown>;
    active?: boolean;
  }>();
  if (!body.trigger || typeof body.trigger !== "object") {
    return c.json({ error: "Body must include `trigger` object" }, 422);
  }
  const eventType = typeof body.trigger.type === "string" ? body.trigger.type : null;
  if (!eventType) {
    return c.json({ error: "trigger.type required" }, 422);
  }
  const slug = `evt-${crypto.randomUUID()}`;
  const result = (await invokeIOActionAs(authority, null, "dashboard:createFunctionTrigger", {
    name,
    slug,
    eventType,
    triggerBody: body.trigger,
    cancelWhen: body.cancelWhen ?? null,
    args: body.args ?? null,
    active: body.active ?? true,
  })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Function not found" }, 404);
  return c.json({ trigger: result._0 }, 201);
});

dashboardRoutes.put("/triggers/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await c.req.json<{
    trigger?: Record<string, unknown>;
    cancelWhen?: Record<string, unknown> | null;
    args?: Record<string, unknown> | null;
    active?: boolean;
  }>();
  // Wrap the 4 optional body fields as Fenel-side Maybes. undefined →
  // Nothing (don't touch the column / preserve the metadata key);
  // present → Just (overwrite). Null arrives as Just null so the body
  // can choose to overwrite with null.
  const toMaybe = (v: unknown): { $tag: "Just"; _0: unknown } | { $tag: "Nothing" } =>
    v === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: v };
  const result = (await invokeIOActionAs(authority, null, "dashboard:updateTriggerById", {
    id,
    trig: toMaybe(body.trigger),
    cw: toMaybe(body.cancelWhen),
    args: toMaybe(body.args),
    active: toMaybe(body.active),
  })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
  return c.json({ trigger: result._0 });
});

dashboardRoutes.delete("/triggers/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const ok = (await invokeIOActionAs(authority, null, "dashboard:deleteTriggerById", { id })) as boolean;
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---- Dispatch instances (per-account interface overrides, 9.I.2) ----
//
// Identity is on (id) rather than (account_id, typeName, args) because `args`
// is JSONB and the natural composite key would need a stable hash. Listing
// supports optional ?typeName filtering; ?class remains an inbound legacy alias.

dashboardRoutes.route("/", createReaderMetadataTargetsRoutes({
  canRead: c => permitsIOActionAs(authorityOf(c), "state:listSpecInstances", { typeName: { $tag: "Nothing" } }),
  readRows: async c => await invokeDataAction(authorityOf(c), null, "state:listSpecInstances", {
    typeName: { $tag: "Nothing" },
  }) as Array<{ args: unknown[] }>,
}));

dashboardRoutes.post("/reader-metadata", async (c) => {
  let body: { targets?: unknown } | null;
  try { body = await c.req.json(); }
  catch { return c.json({ error: "Provide a JSON object with target identifiers." }, 400); }
  if (!body || typeof body !== "object" || !Array.isArray(body.targets) || body.targets.length > 128
    || body.targets.some((target) => typeof target !== "string" || target.length === 0 || target.length > 512)) {
    return c.json({ error: "Provide at most 128 target identifiers." }, 400);
  }
  const authority = authorityOf(c);
  // This is a read of account instance data, not permission to inspect an
  // arbitrary handler class. The projection itself fixes the visible classes.
  if (!await permitsIOActionAs(authority, "state:listSpecInstances", { typeName: { $tag: "Nothing" } })) {
    return c.json({ error: "Instance metadata is not available to this reader." }, 403);
  }
  c.header("Cache-Control", "private, no-store");
  if (body.targets.length === 0) return nativeJsonResponse(c, { entries: [] });
  const rows = await invokeDataAction(authority, null, "state:listSpecInstances", {
    typeName: { $tag: "Nothing" },
  }) as Array<{ instance: Parameters<typeof projectReaderMetadata>[2][number] }>;
  const registry = await loadAccountExecutionRegistryForRequest(getAccountId(c));
  const frame = { ...registry.evaluateContext(), _authority: authority };
  return nativeJsonResponse(c, projectReaderMetadata(frame, body.targets as string[], rows.map(row => row.instance)));
});

async function listDispatchInstancesRoute(c: any) {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const typeName = c.req.query("typeName") ?? c.req.query("class");
  const rows = (await invokeDataAction(authority, null, "dashboard:listSpecInstancesAll", {
    typeName: typeName ? { $tag: "Just", _0: typeName } : { $tag: "Nothing" },
  })) as unknown[];
  const registry = await getRuntimeAccountFieldRegistry(accountId);
  const wire = rows.map((row) => dispatchInstanceResponse(row, registry));
  return c.json({ dispatchInstances: wire, specInstances: wire });
}

function dispatchInstanceResponse(row: unknown, registry: ModuleRegistry): unknown {
  const record = objectRecord(row);
  const instance = objectRecord(record?.instance);
  return record && instance ? { ...record, instance: instanceToJsonWire(instance, registry, undefined, INSTANCE_JSON_ENCODING), valueEncoding: INSTANCE_JSON_ENCODING } : row;
}

const FIELD_REPRESENTATIONAL_TYPES = new Set<string>(
  fieldRepresentationalInterfaceNames(),
);
const REPOSITORY_FIELD_IDS = new Set(
  repositoryFieldCatalog().fields.map((field) => field.fieldId),
);
const FIELD_CONTROL_PLANE_WRITE_ERROR =
  "Field control-plane rows must be changed through /definition-bundles";

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Classify both canonical Field facets (`targetEntityType: \"Field\"`) and
 * older/general dispatch rows whose unary target is a live account or
 * repository Field UUID. Reads are allowed; only generic writes are fenced. */
async function isFieldControlPlaneWrite(
  authority: AuthorityRef,
  entityType: string,
  data: unknown,
): Promise<boolean> {
  if (entityType === "Field") return true;
  if (!FIELD_REPRESENTATIONAL_TYPES.has(entityType)) return false;
  const record = objectRecord(data);
  if (record?.["targetEntityType"] === "Field") return true;
  const args = Array.isArray(record?.["args"]) ? record["args"] : [];
  const targetId = typeof args[0] === "string" ? args[0] : undefined;
  if (targetId === undefined) return false;
  if (REPOSITORY_FIELD_IDS.has(targetId)) return true;
  const target = await getInstanceById(authority, targetId);
  return target?.entityType === "Field";
}

function rejectFieldControlPlaneWrite(c: Context): Response {
  return c.json({ error: FIELD_CONTROL_PLANE_WRITE_ERROR }, 409);
}

function isFieldControlPlaneWriteConflict(error: unknown): boolean {
  return error instanceof Error
    && error.name === "FieldControlPlaneWriteConflict";
}

async function getDispatchInstanceRoute(c: any) {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const result = (await invokeDataAction(authority, null, "dashboard:getSpecInstanceById", { id })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
  return c.json({ definition: dispatchInstanceResponse(result._0, await getRuntimeAccountFieldRegistry(accountId)) });
}

async function createDispatchInstanceRoute(c: any) {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const body = await c.req.json() as {
    id?: string;
    typeName: string;
    args: unknown[];
    instance: Record<string, unknown>;
    targetEntityType?: string | null;
    valueEncoding?: string;
  };
  if (!body.typeName || !Array.isArray(body.args) || !body.instance) {
    return c.json(
      { error: "Body must include typeName, args[], instance" },
      422,
    );
  }
  if (body.valueEncoding !== undefined && !isInstanceJsonEncoding(body.valueEncoding)) return c.json({ error: "Unsupported instance value encoding" }, 422);
  const registry = await getRuntimeAccountFieldRegistry(accountId);
  if (isInstanceJsonEncoding(body.valueEncoding)) {
    try { body.instance = instanceFromJsonWire({ ...body.instance, typeName: body.typeName, args: body.args }, registry, undefined, body.valueEncoding); }
    catch (cause) { return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 422); }
  }
  delete body.valueEncoding;
  if (await isFieldControlPlaneWrite(authority, body.typeName, {
    ...body.instance,
    args: body.args,
    ...(body.targetEntityType === undefined
      ? {}
      : { targetEntityType: body.targetEntityType }),
  })) {
    return rejectFieldControlPlaneWrite(c);
  }
  try {
    const row = await invokeDataAction(authority,
      null,
      "dashboard:createAccountSpecInstance",
      { body },
    );
    return c.json({ definition: dispatchInstanceResponse(row, registry) }, 201);
  } catch (error) {
    if (error instanceof Error && error.name === "DispatchInstancePersistenceConflict") {
      return c.json({ error: error.message, diagnostic: { $tag: "PersistenceConflict", message: error.message } }, 409);
    }
    if (error instanceof TypeError) return c.json({ error: error.message }, 422);
    if (isFieldControlPlaneWriteConflict(error)) {
      return rejectFieldControlPlaneWrite(c);
    }
    throw error;
  }
}

async function updateDispatchInstanceRoute(c: any) {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await c.req.json() as { instance: Record<string, unknown>; expectedInstance?: Record<string, unknown>; valueEncoding?: string };
  if (!body.instance || typeof body.instance !== "object") {
    return c.json({ error: "Body must include `instance` object" }, 422);
  }
  if (Object.hasOwn(body, "expectedInstance") && !objectRecord(body.expectedInstance)) {
    return c.json({ error: "expectedInstance must be an object when supplied" }, 422);
  }
  const existing = await getInstanceById(authority, id);
  if (!existing) return Object.hasOwn(body, "expectedInstance")
    ? c.json({ error: "Data changed since this draft was opened", diagnostic: { $tag: "PersistenceConflict" } }, 409)
    : c.json({ error: "Not found" }, 404);
  if (body.valueEncoding !== undefined && !isInstanceJsonEncoding(body.valueEncoding)) return c.json({ error: "Unsupported instance value encoding" }, 422);
  const registry = await getRuntimeAccountFieldRegistry(accountId);
  if (isInstanceJsonEncoding(body.valueEncoding)) {
    const found = await invokeDataAction(authority, null, "dashboard:getSpecInstanceById", { id }) as { $tag: "Just"; _0: { args: unknown[] } } | { $tag: "Nothing" };
    if (found.$tag === "Nothing") return Object.hasOwn(body, "expectedInstance")
      ? c.json({ error: "Data changed since this draft was opened", diagnostic: { $tag: "PersistenceConflict" } }, 409)
      : c.json({ error: "Not found" }, 404);
    try {
      body.instance = instanceFromJsonWire({ ...body.instance, typeName: existing.entityType, args: Array.isArray(body.instance.args) ? body.instance.args : found._0.args }, registry, undefined, body.valueEncoding);
      if (Object.hasOwn(body, "expectedInstance")) body.expectedInstance = instanceFromJsonWire(body.expectedInstance!, registry, undefined, body.valueEncoding);
    }
    catch (cause) { return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 422); }
  }
  delete body.valueEncoding;
  if (
    existing !== null
    && await isFieldControlPlaneWrite(authority, existing.entityType, existing.data)
  ) {
    return rejectFieldControlPlaneWrite(c);
  }
  try {
    const row = await invokeDataAction(authority,
      null,
      "dashboard:updateAccountSpecInstance",
      { id, body },
    );
    if (!row) return Object.hasOwn(body, "expectedInstance")
      ? c.json({ error: "Data changed since this draft was opened", diagnostic: { $tag: "PersistenceConflict" } }, 409)
      : c.json({ error: "Not found" }, 404);
    return c.json({ definition: dispatchInstanceResponse(row, registry) });
  } catch (error) {
    if (error instanceof Error && error.name === "DispatchInstancePersistenceConflict") {
      return c.json({ error: error.message, diagnostic: { $tag: "PersistenceConflict", message: error.message } }, 409);
    }
    if (isFieldControlPlaneWriteConflict(error)) {
      return rejectFieldControlPlaneWrite(c);
    }
    throw error;
  }
}

async function deleteDispatchInstanceRoute(c: any) {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = c.req.raw.body ? await readNativeJson<{ expectedInstance?: Record<string, unknown> }>(c) : {};
  if (!objectRecord(body)) return c.json({ error: "Body must be an object when supplied" }, 422);
  if (Object.hasOwn(body, "expectedInstance") && !objectRecord(body.expectedInstance)) {
    return c.json({ error: "expectedInstance must be an object when supplied" }, 422);
  }
  const existing = await getInstanceById(authority, id);
  if (
    existing !== null
    && await isFieldControlPlaneWrite(authority, existing.entityType, existing.data)
  ) {
    return rejectFieldControlPlaneWrite(c);
  }
  try {
    await invokeDataAction(authority,
      null,
      "dashboard:deleteAccountSpecInstance",
      { id, expectedInstance: toMaybe(body.expectedInstance) },
    );
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "DispatchInstancePersistenceConflict") {
      return c.json({ error: error.message, diagnostic: { $tag: "PersistenceConflict", message: error.message } }, 409);
    }
    if (isFieldControlPlaneWriteConflict(error)) {
      return rejectFieldControlPlaneWrite(c);
    }
    throw error;
  }
}

dashboardRoutes.get("/dispatch-instances", listDispatchInstancesRoute);
dashboardRoutes.get("/dispatch-instances/:id", getDispatchInstanceRoute);
dashboardRoutes.post("/dispatch-instances", createDispatchInstanceRoute);
dashboardRoutes.put("/dispatch-instances/:id", updateDispatchInstanceRoute);
dashboardRoutes.delete("/dispatch-instances/:id", deleteDispatchInstanceRoute);

dashboardRoutes.get("/spec-instances", listDispatchInstancesRoute);
dashboardRoutes.get("/spec-instances/:id", getDispatchInstanceRoute);
dashboardRoutes.post("/spec-instances", createDispatchInstanceRoute);
dashboardRoutes.put("/spec-instances/:id", updateDispatchInstanceRoute);
dashboardRoutes.delete("/spec-instances/:id", deleteDispatchInstanceRoute);

// ---------------------------------------------------------------------------
// Function bidirectional tracking — running-instance views.
// ---------------------------------------------------------------------------

// Profile → Functions: "what functions is this profile running?"
dashboardRoutes.get("/profiles/:id/functions", async (c) => {
  const authority = authorityOf(c);
  const profileId = c.req.param("id");
  const status = c.req.query("status");
  const fns = await invokeIOActionAs(authority, null, "state:getProfileFunctions", {
    profileId,
    status: status ? { $tag: "Just", _0: status } : { $tag: "Nothing" },
  });
  return c.json({ functions: fns });
});

// Function → Instances: "what profiles are in this function, and where?"
dashboardRoutes.get("/functions/:id/instances", async (c) => {
  const authority = authorityOf(c);
  const fnId = c.req.param("id");
  const status = c.req.query("status");
  const limit = Number(c.req.query("limit") || 100);
  const offset = Number(c.req.query("offset") || 0);
  const instances = await invokeIOActionAs(authority, null, "state:getFunctionInstancesByFn", {
    functionId: fnId,
    status: status ? { $tag: "Just", _0: status } : { $tag: "Nothing" },
    limit,
    offset,
  });
  return nativeJsonResponse(c, { instances });
});

// Function stats: aggregate counts by status + checkpoint breakdown
dashboardRoutes.get("/functions/:id/stats", async (c) => {
  const authority = authorityOf(c);
  const fnId = c.req.param("id");
  const stats = (await invokeIOActionAs(authority, null, "dashboard:functionStatsBody", {
    fnId,
  })) as Record<string, unknown>;
  return c.json(stats);
});

// Instance timeline — merged event + trace stream for a single instance.
dashboardRoutes.get("/functions/:fnId/instances/:instId/timeline", async (c) => {
  const authority = authorityOf(c);
  const instId = c.req.param("instId");
  const result = (await invokeIOActionAs(authority, null, "dashboard:functionInstanceTimeline", { instId })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Instance not found" }, 404);
  return nativeJsonResponse(c, result._0);
});

// Latest activity for a type — recent traces touching values of `:typeName`.
dashboardRoutes.get("/types/:typeName/activity", async (c) => {
  const authority = authorityOf(c);
  const typeName = c.req.param("typeName");
  const limit = Number(c.req.query("limit") || 50);
  const traces = (await invokeIOActionAs(authority, null, "dashboard:typeActivityBody", {
    typeName,
    limit,
  })) as Array<Record<string, unknown>>;
  return nativeJsonResponse(c, { traces });
});

// ---------------------------------------------------------------------------
// Entity instance deletion
// ---------------------------------------------------------------------------

dashboardRoutes.delete("/profiles/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  await invokeIOActionAs(authority, null, "dashboard:deleteProfile", { id });
  return c.json({ ok: true });
});

dashboardRoutes.delete("/items/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  await invokeIOActionAs(authority, null, "dashboard:deleteItem", { id });
  return c.json({ ok: true });
});

dashboardRoutes.delete("/plans/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  await invokeIOActionAs(authority, null, "dashboard:deletePlan", { id });
  return c.json({ ok: true });
});

dashboardRoutes.delete("/functions/:id/by-id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  // Phase 4.6 — select-then-delete moved into state:deleteFunctionById (returns
  // Boolean: false when the row doesn't exist / is cross-account → 404).
  const ok = (await invokeIOActionAs(authority, null, "state:deleteFunctionById", { id })) as boolean;
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Generic entity instances — CRUD for user-defined types
// ---------------------------------------------------------------------------

dashboardRoutes.get("/entity-instances/:entityType", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const entityType = c.req.param("entityType");
  const instances = (await invokeIOActionAs(authority, null, "state.list_instances_by_name", {
    typeName: entityType, envelope: true,
  })) as Array<Record<string, unknown>>;
  const registry = instances.some((instance) => instance.dataEncoding == null) ? await getRuntimeAccountFieldRegistry(accountId) : undefined;
  return c.json({ instances: await Promise.all(instances.map((instance) => instanceValueResponse(instance as unknown as EntityRow, registry))) });
});

dashboardRoutes.post("/entity-instances/:entityType", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const entityType = c.req.param("entityType");
  const body = await c.req.json();
  // The envelope carries a value of the declared type: a record, variant,
  // list or scalar. Missing data is distinct from null/false/zero.
  const rawData = (body as { data?: unknown })?.data;
  if (rawData === undefined) return c.json({ error: "data is required" }, 422);
  const data = await incomingEntityValue(accountId, c, entityType, rawData, (body as { valueEncoding?: unknown }).valueEncoding);
  if (data instanceof Response) return data;
  if (await isFieldControlPlaneWrite(authority, entityType, data)) {
    return rejectFieldControlPlaneWrite(c);
  }
  const v = await validateBody<unknown>(authority, c, entityType, data, false);
  if (v instanceof Response) return v;
  const result = (await invokeDataAction(authority, null, "dashboard:createEntityInstanceByType", {
    entityType,
    data: v,
  })) as { ok: boolean; value?: string; error?: string };
  if (!result.ok) return c.json({ error: "Validation failed", errors: [{ path: "", message: result.error ?? "create failed" }] }, 422);
  const instance = await getInstanceById(authority, result.value!);
  return c.json({ instance: await instanceValueResponse(instance) }, 201);
});

dashboardRoutes.put("/entity-instances/:id", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const existingPre = await getInstanceById(authority, id);
  if (!existingPre) return c.json({ error: "Not found" }, 404);
  if (isInstanceJsonEncoding(existingPre.dataEncoding)) {
    return c.json({ error: "Edit this scoped instance in Instances.", code: "USE_DISPATCH_INSTANCE_EDITOR" }, 409);
  }
  if (await isFieldControlPlaneWrite(authority,
    existingPre.entityType,
    existingPre.data,
  )) {
    return rejectFieldControlPlaneWrite(c);
  }
  const rawData = (body as { data?: unknown })?.data;
  if (rawData === undefined) return c.json({ error: "data is required" }, 422);
  const data = await incomingEntityValue(accountId, c, existingPre.entityType, rawData, (body as { valueEncoding?: unknown }).valueEncoding);
  if (data instanceof Response) return data;
  const v = await validateBody<unknown>(authority, c, existingPre.entityType, data, false);
  if (v instanceof Response) return v;
  try {
    await invokeDataAction(authority, null, "dashboard:replaceEntityInstance", {
      id,
      data: v,
    });
  } catch (err) {
    // Phase 4.2 — structural validation-error check (drops the @fenel/db
    // EntityInstanceValidationError type import); a validation error carries an
    // `issues` array. Validation already happens up-front via validateBody, so
    // this arm is defensive.
    const issues = (err as { issues?: unknown })?.issues;
    if (Array.isArray(issues)) {
      return c.json({ error: "Validation failed", errors: issues }, 422);
    }
    if (err instanceof Error && /not found/i.test(err.message)) {
      return c.json({ error: "Not found" }, 404);
    }
    throw err;
  }
  const instance = await getInstanceById(authority, id);
  if (!instance) return c.json({ error: "Not found" }, 404);
  return c.json({ instance: await instanceValueResponse(instance) });
});

// Partial update — the state.update_instance IO handler ALREADY merges
// the patch into existing data (Nothing-as-clear semantics), so the
// legacy route-level read+merge has been dropped per the 12a-2 brief
// pre-flight Decision E1.
dashboardRoutes.patch("/entity-instances/:id", async (c) => {
  const accountId = getAccountId(c);
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const existingPre = await getInstanceById(authority, id);
  if (!existingPre) return c.json({ error: "Not found" }, 404);
  if (isInstanceJsonEncoding(existingPre.dataEncoding)) {
    return c.json({ error: "Edit this scoped instance in Instances.", code: "USE_DISPATCH_INSTANCE_EDITOR" }, 409);
  }
  if (await isFieldControlPlaneWrite(authority,
    existingPre.entityType,
    existingPre.data,
  )) {
    return rejectFieldControlPlaneWrite(c);
  }
  const rawData = (body as { data?: unknown })?.data;
  const data = await incomingEntityValue(accountId, c, existingPre.entityType, rawData, (body as { valueEncoding?: unknown }).valueEncoding);
  if (data instanceof Response) return data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return c.json({ error: "A record patch is required" }, 422);
  const registry = await getRuntimeAccountFieldRegistry(accountId);
  const declared = registry.getIdentifiedEntity(existingPre.entityType)?.type ?? registry.getEntity(existingPre.entityType)?.type;
  if (declared && !("$record" in declared)) return c.json({ error: "Use PUT to replace a nonrecord value" }, 422);
  const v = await validateBody(authority, c, existingPre.entityType, data, true);
  if (v instanceof Response) return v;
  try {
    await invokeDataAction(authority, null, "dashboard:patchEntityInstance", {
      id,
      patch: v,
    });
  } catch (err) {
    // Phase 4.2 — structural validation-error check (drops the @fenel/db
    // EntityInstanceValidationError type import); a validation error carries an
    // `issues` array. Validation already happens up-front via validateBody, so
    // this arm is defensive.
    const issues = (err as { issues?: unknown })?.issues;
    if (Array.isArray(issues)) {
      return c.json({ error: "Validation failed", errors: issues }, 422);
    }
    if (err instanceof Error && /not found/i.test(err.message)) {
      return c.json({ error: "Not found" }, 404);
    }
    throw err;
  }
  const instance = await getInstanceById(authority, id);
  if (!instance) return c.json({ error: "Not found" }, 404);
  return c.json({ instance: await instanceValueResponse(instance) });
});

dashboardRoutes.delete("/entity-instances/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const existing = await getInstanceById(authority, id);
  if (
    existing !== null
    && await isFieldControlPlaneWrite(authority, existing.entityType, existing.data)
  ) {
    return rejectFieldControlPlaneWrite(c);
  }
  await invokeDataAction(authority, null, "dashboard:deleteEntityInstance", { id });
  return c.json({ ok: true });
});

// ---- Integrations ----

dashboardRoutes.get("/integrations", async (c) => {
  const authority = authorityOf(c);
  // Phase 4.7 — re-pointed off the direct DB read to state:listIntegrations.
  const result = (await invokeIOActionAs(authority, null, "state:listIntegrations", {})) as Array<Record<string, unknown>>;
  // Mask secret fields — never send raw credentials to frontend (stays in shell).
  const masked = result.map((row) => ({
    ...row,
    credentials: maskCredentials(row.credentials as Record<string, unknown>),
  }));
  return c.json({ integrations: masked });
});

dashboardRoutes.post("/integrations", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "integration", body, true);
  if (v instanceof Response) return v;

  // Phase 4.7 — insert-or-update moved into state:upsertIntegration (keyed by
  // accountId+type); credential masking stays in the shell.
  const row = (await invokeIOActionAs(authority, null, "state:upsertIntegration", {
    data: {
      type: v.type,
      label: (v.label as string | null | undefined) ?? null,
      credentials: v.credentials,
      config: (v.config as Record<string, unknown> | undefined) ?? {},
    },
  })) as Record<string, unknown>;

  return c.json({ integration: { ...row, credentials: maskCredentials(row.credentials as Record<string, unknown>) } });
});

dashboardRoutes.put("/integrations/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const v = await validateBody(authority, c, "integration", body, true);
  if (v instanceof Response) return v;

  // rights R4a C1a §0.5 — ONE ARGUMENT PER MUTABLE COLUMN, honouring the leaf's
  // declared `Maybe` parameters. There is no longer a `patch` blob to whitelist:
  // `state:updateIntegration` declares `label`/`credentials`/`config`/`status`/
  // `enabled` and nothing else, so `accountId` is not a thing this route — or
  // any other caller — can name.
  const optional = (value: unknown) =>
    value === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: value };

  const rowM = (await invokeIOActionAs(authority, null, "state:updateIntegration", {
    id,
    label: optional(v.label),
    credentials: optional(v.credentials),
    config: optional(v.config),
    status: optional(v.status),
    enabled: optional(v.enabled),
  })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (rowM.$tag !== "Just") return c.json({ error: "Not found" }, 404);
  const row = rowM._0;
  return c.json({ integration: { ...row, credentials: maskCredentials(row.credentials as Record<string, unknown>) } });
});

dashboardRoutes.delete("/integrations/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  await invokeIOActionAs(authority, null, "state:deleteIntegration", { id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

dashboardRoutes.get("/pages", async (c) => {
  const authority = authorityOf(c);
  const rows = await invokeIOActionAs(authority, null, "state:listPages", {});
  return c.json({ pages: rows });
});

dashboardRoutes.get("/pages/:id", async (c) => {
  const authority = authorityOf(c);
  const pageM = (await invokeIOActionAs(authority, null, "state:getPageById", { id: c.req.param("id") })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (pageM.$tag !== "Just") return c.json({ error: "Page not found" }, 404);
  return c.json({ page: pageM._0 });
});

dashboardRoutes.post("/pages", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json<{
    slug: string;
    name: string;
    blocks: any[];
    config?: Record<string, unknown>;
    published?: boolean;
  }>();
  if (!body.slug || !body.name) return c.json({ error: "slug and name required" }, 400);
  const page = await invokeIOActionAs(authority, null, "state:createPage", { data: body });
  return c.json({ page }, 201);
});

dashboardRoutes.put("/pages/:id", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json<{
    slug?: string;
    name?: string;
    blocks?: any[];
    config?: Record<string, unknown>;
    published?: boolean;
  }>();
  const pageM = (await invokeIOActionAs(authority, null, "state:updatePage", { id: c.req.param("id"), data: body })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (pageM.$tag !== "Just") return c.json({ error: "Page not found" }, 404);
  return c.json({ page: pageM._0 });
});

dashboardRoutes.delete("/pages/:id", async (c) => {
  const authority = authorityOf(c);
  await invokeIOActionAs(authority, null, "state:deletePage", { id: c.req.param("id") });
  return c.json({ ok: true });
});

// ---- Saved Queries ----

// Helper for Maybe-wrapping optional values before passing to Fenel-bodied
// PATCH routes. undefined → Nothing (column unchanged); present → Just.
const toMaybe = (v: unknown): { $tag: "Just"; _0: unknown } | { $tag: "Nothing" } =>
  v === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: v };

function savedQueryRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

dashboardRoutes.get("/saved-queries", async (c) => {
  const authority = authorityOf(c);
  const categorySlug = c.req.query("category");
  const search = c.req.query("q");
  const result = (await invokeDataAction(authority, null, "dashboard:listSavedQueriesAggregated", {
    category: categorySlug ? { $tag: "Just", _0: categorySlug } : { $tag: "Nothing" },
    q: search ? { $tag: "Just", _0: search } : { $tag: "Nothing" },
  })) as { queries: unknown[]; categories: unknown[] };
  return nativeJsonResponse(c, result);
});

dashboardRoutes.get("/saved-queries/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const result = (await invokeDataAction(authority, null, "dashboard:getSavedQueryById", { id })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
  return nativeJsonResponse(c, { query: result._0 });
});

dashboardRoutes.post("/saved-queries", async (c) => {
  const authority = authorityOf(c);
  const body = await readNativeJson<Record<string, unknown>>(c);
  if (!savedQueryRecord(body) || !savedQueryRecord(body.query)) {
    return c.json({ error: "query must be an object" }, 422);
  }
  if (body.id !== undefined && (typeof body.id !== "string"
    || await invokeDataAction(authority, null, "std:isUuid", { text: body.id }) !== true)) {
    return c.json({ error: "id must be a UUID when supplied" }, 422);
  }
  // The current entity has a documented `{}` placeholder for this opaque
  // saved payload. Validate its metadata without coercing the query body.
  //
  // `name` / `description` are NOT fields of `SavedQuery` — a value's name is a
  // `Labelable` instance and its prose a `Describable` one. They ride here as
  // the values of the denormalised columns ORDER BY and ILIKE search read, so
  // they come off the RAW body: asking the validator for them would be asking
  // it about fields the type does not have, and it would (correctly) drop them.
  const { query, name, description, ...metadata } = body;
  const v = await validateBody(authority, c, "saved_query", metadata, true);
  if (v instanceof Response) return v;
  const row = await invokeDataAction(authority, null, "dashboard:createSavedQueryBody", {
    data: {
      ...(body.id === undefined ? {} : { id: body.id }),
      slug: v.slug,
      name: typeof name === "string" ? name : null,
      description: typeof description === "string" ? description : null,
      query,
    },
  });
  return nativeJsonResponse(c, { query: row }, 201);
});

dashboardRoutes.put("/saved-queries/:id", async (c) => {
  const authority = authorityOf(c);
  const body = await readNativeJson<Record<string, unknown>>(c);
  if (!savedQueryRecord(body) || (Object.hasOwn(body, "query") && !savedQueryRecord(body.query))) {
    return c.json({ error: "query must be an object when supplied" }, 422);
  }
  if (Object.hasOwn(body, "expectedQuery") && !savedQueryRecord(body.expectedQuery)) {
    return c.json({ error: "expectedQuery must be an object when supplied" }, 422);
  }
  // Same split as the create route: the mirror columns are not entity fields,
  // so they come off the raw body rather than the validated record.
  const { query, name, description, expectedQuery, ...metadata } = body;
  const v = await validateBody(authority, c, "saved_query", metadata, true);
  if (v instanceof Response) return v;
  const result = (await invokeDataAction(authority, null, "dashboard:updateSavedQueryBody", {
    id: c.req.param("id"),
    slug: toMaybe(v.slug),
    name: toMaybe(name),
    description: toMaybe(description),
    query: toMaybe(query),
    expectedQuery: toMaybe(expectedQuery),
  })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return expectedQuery === undefined
    ? c.json({ error: "Not found" }, 404)
    : c.json({ error: "Data changed since this draft was opened", diagnostic: { $tag: "PersistenceConflict" } }, 409);
  return nativeJsonResponse(c, { query: result._0 });
});

dashboardRoutes.delete("/saved-queries/:id", async (c) => {
  const authority = authorityOf(c);
  const body = c.req.raw.body === null ? {} : await readNativeJson<Record<string, unknown>>(c);
  if (!savedQueryRecord(body) || (Object.hasOwn(body, "expectedQuery") && !savedQueryRecord(body.expectedQuery))) {
    return c.json({ error: "expectedQuery must be an object when supplied" }, 422);
  }
  const ok = (await invokeDataAction(authority, null, "dashboard:deleteSavedQueryBody", {
    id: c.req.param("id"),
    expectedQuery: toMaybe(body.expectedQuery),
  })) as boolean;
  if (!ok) return body.expectedQuery === undefined
    ? c.json({ error: "Not found" }, 404)
    : c.json({ error: "Data changed since this draft was opened", diagnostic: { $tag: "PersistenceConflict" } }, 409);
  return c.json({ ok: true });
});

// ---- Home Views (the customizable OS-like home page) ----

dashboardRoutes.route("/", createWorkspaceBootstrapRoutes({
  reader: context => {
    const session = getSession(context);
    const token = getSessionToken(context);
    const accountId = getAuthenticatedUserAccountId(context);
    return session && token && accountId ? { accountId, token, role: session.role } : undefined;
  },
  readRoot: async context => {
    const root = await invokeDataAction(authorityOf(context), null, "dashboard:getLocusRootBody", {}) as WorkspaceBootstrapRoot;
    return { ...root, typeDescriptions: await rootTypeDescriptions(context, root) };
  },
  canEdit: (context, id) => permitsIOActionAs(authorityOf(context), "state:editLocusRoot", { id }),
  accounts: listAccounts,
  personalAccount: personalAccountForToken,
}));

// One typed account value, through explicitly named Fenel storage effects.
async function rootTypeDescriptions(c: Context, root: unknown) {
  // Reuse this request's captured execution registry and authenticated frame;
  // aliases project names only and never choose another reader or instance pool.
  const registry = await loadAccountExecutionRegistryForRequest(getAccountId(c));
  const frame = { ...registry.evaluateContext(), _authority: authorityOf(c) };
  const rootDescription = root as Parameters<typeof projectLocusTypeDescriptions>[0];
  const aliases = (handle: string) => [handle, registry.getUuid(handle), registry.getEntityNominalIdentity(handle),
    registry.getIdentifiedEntity(handle)?.id].filter((id): id is string => !!id);
  // Do not acquire optional account facets on the root's critical read path.
  // Already captured scoped methods may enrich a name; the normal parallel
  // reader-metadata projection remains the owner of later saved-facet reads.
  const methods = (handle: string, className: string) => {
    if (!frame._specRegistry) return undefined;
    for (const id of aliases(handle)) {
      const selected = resolveEffect(frame, frame._specRegistry, className, id);
      if (selected) return selected.methods;
    }
    return undefined;
  };
  const codeName = (handle: string) => {
    const name = methods(handle, "Codeable")?.codeName;
    return typeof name === "string" && name ? name : registry.getIdentifiedEntity(handle)?.id ?? handle;
  };
  return projectLocusTypeDescriptions(rootDescription, handle => {
    const label = methods(handle, "Labelable")?.label;
    return label ? canonical(label as Parameters<typeof canonical>[0]) || codeName(handle) : codeName(handle);
  }, codeName, handle => registry.getIdentifiedEntity(handle)?.type, frame);
}

async function locusRootResponse(c: Context, root: unknown) {
  if (!root || typeof root !== "object" || !("id" in root) || typeof root.id !== "string") {
    return c.json({ error: "The root data could not be decoded." }, 500);
  }
  // Ask the actual operation envelope. A role label is never authority. The
  // deliberately minimal argument also refuses command-restricted grants
  // rather than claiming they authorize the full editor.
  const canEdit = await permitsIOActionAs(authorityOf(c), "state:editLocusRoot", { id: root.id });
  return nativeJsonResponse(c, { root: { ...root, canEdit,
    typeDescriptions: await rootTypeDescriptions(c, root) } });
}
dashboardRoutes.get("/locus-root", async (c) => {
  try {
    const root = await invokeDataAction(authorityOf(c), null, "dashboard:getLocusRootBody", {});
    if (!root) return c.json({ error: "The root data could not be decoded." }, 500);
    return locusRootResponse(c, root);
  } catch (error) {
    if (error instanceof Error && (error.name === "LocusRootConflict" || error.message.includes("Both versions were preserved"))) return c.json({ error: error.message }, 409);
    throw error;
  }
});

dashboardRoutes.put("/locus-root", async (c) => {
  const body = await readNativeJson<Record<string, unknown>>(c);
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0
    || typeof body.id !== "string" || !body.command || typeof body.command !== "object") {
    return c.json({ error: "A root identity, revision, and value edit are required." }, 422);
  }
  try {
    const result = await invokeDataAction(authorityOf(c), null, "dashboard:editLocusRootBody", {
      id: body.id, expectedRevision: body.expectedRevision, command: body.command,
    }) as { $tag: "Just"; _0: unknown } | { $tag: "Nothing" };
    if (result.$tag === "Nothing") return c.json({ error: "The root data is no longer available." }, 404);
    return locusRootResponse(c, result._0);
  } catch (error) {
    if (error instanceof Error && (error.name === "LocusRootConflict" || error.message.includes("changed in another session"))) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

dashboardRoutes.get("/locus-views", async (c) => {
  const authority = authorityOf(c);
  const rows = (await invokeDataAction(authority, null, "dashboard:listLocusViewsAll", {})) as unknown[];
  return nativeJsonResponse(c, { locusViews: rows });
});

dashboardRoutes.get("/locus-views/active", async (c) => {
  const authority = authorityOf(c);
  const result = (await invokeDataAction(authority, null, "dashboard:getActiveLocusViewBody", {})) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  return nativeJsonResponse(c, { locusView: result.$tag === "Just" ? result._0 : null });
});

dashboardRoutes.post("/locus-views", async (c) => {
  const authority = authorityOf(c);
  const body = await readNativeJson<Record<string, unknown>>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "Name required" }, 422);
  const view = body.view ?? { kind: "canvas", items: [] };
  const row = await invokeDataAction(authority, null, "dashboard:createLocusViewBody", {
    name,
    view: view as Record<string, unknown>,
    active: body.active === true,
  });
  return nativeJsonResponse(c, { locusView: row }, 201);
});

dashboardRoutes.put("/locus-views/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const body = await readNativeJson<Record<string, unknown>>(c);
  const nameVal = typeof body.name === "string" ? body.name.trim() : undefined;
  try {
    const result = (await invokeDataAction(authority, null, "dashboard:updateLocusViewBody", {
      id,
      name: toMaybe(nameVal),
      view: toMaybe(body.view === undefined ? undefined : { kind: "locus-list-command", expectedRevision: body.expectedRootRevision, view: body.view }),
    })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
    if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
    return nativeJsonResponse(c, { locusView: result._0 });
  } catch (error) {
    if (error instanceof Error && (error.name === "LocusRootConflict" || error.message.includes("changed in another session"))) return c.json({ error: error.message }, 409);
    throw error;
  }
});

dashboardRoutes.post("/locus-views/:id/activate", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const result = (await invokeDataAction(authority, null, "dashboard:activateLocusViewBody", { id })) as
    | { $tag: "Just"; _0: Record<string, unknown> }
    | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
  return nativeJsonResponse(c, { locusView: result._0 });
});

dashboardRoutes.delete("/locus-views/:id", async (c) => {
  const authority = authorityOf(c);
  const id = c.req.param("id");
  const ok = (await invokeDataAction(authority, null, "dashboard:deleteLocusViewWithPromote", { id })) as boolean;
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---- Query Categories ----

dashboardRoutes.get("/query-categories", async (c) => {
  const authority = authorityOf(c);
  const rows = (await invokeIOActionAs(authority, null, "dashboard:listQueryCategoriesAggregated", {})) as unknown[];
  return c.json({ categories: rows });
});

dashboardRoutes.post("/query-categories", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "query_category", body, true);
  if (v instanceof Response) return v;
  // queryIds isn't part of the QueryCategory entity schema — it's a
  // sub-table relation (query_category_members). Pull off the raw body
  // since it wasn't part of the validation pass.
  const queryIds = (body as { queryIds?: unknown })?.queryIds;
  const queryIdsArr = Array.isArray(queryIds) ? (queryIds as string[]) : [];
  const cat = await invokeIOActionAs(authority, null, "dashboard:createQueryCategoryBody", {
    data: {
      slug: v.slug,
      name: v.name,
      description: v.description ?? null,
      parentId: v.parentId ?? null,
    },
    queryIds: queryIdsArr.length > 0
      ? { $tag: "Just", _0: queryIdsArr }
      : { $tag: "Nothing" },
  });
  return c.json({ category: cat }, 201);
});

dashboardRoutes.put("/query-categories/:id", async (c) => {
  const authority = authorityOf(c);
  const body = await c.req.json();
  const v = await validateBody(authority, c, "query_category", body, true);
  if (v instanceof Response) return v;
  const result = (await invokeIOActionAs(authority, null, "dashboard:updateQueryCategoryBody", {
    id: c.req.param("id"),
    slug: toMaybe(v.slug),
    name: toMaybe(v.name),
    description: toMaybe(v.description),
    parentId: toMaybe(v.parentId),
  })) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };
  if (result.$tag === "Nothing") return c.json({ error: "Not found" }, 404);
  return c.json({ category: result._0 });
});

dashboardRoutes.delete("/query-categories/:id", async (c) => {
  const authority = authorityOf(c);
  const ok = (await invokeIOActionAs(authority, null, "dashboard:deleteQueryCategoryBody", {
    id: c.req.param("id"),
  })) as boolean;
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

dashboardRoutes.post("/query-categories/:id/queries", async (c) => {
  const authority = authorityOf(c);
  const categoryId = c.req.param("id");
  const body = await c.req.json();
  const queryId = body.queryId;
  if (!queryId) return c.json({ error: "queryId required" }, 422);
  const result = (await invokeIOActionAs(authority, null, "dashboard:addQueryToCategoryBody", {
    categoryId,
    queryId,
  })) as { ok: boolean; error: { $tag: "Just"; _0: string } | { $tag: "Nothing" } };
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true }, 201);
});

dashboardRoutes.delete("/query-categories/:id/queries/:queryId", async (c) => {
  const authority = authorityOf(c);
  const categoryId = c.req.param("id");
  const queryId = c.req.param("queryId");
  const result = (await invokeIOActionAs(authority, null, "dashboard:removeQueryFromCategoryBody", {
    categoryId,
    queryId,
  })) as { ok: boolean; error: { $tag: "Just"; _0: string } | { $tag: "Nothing" } };
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Credential values never leave the server. Replace each entry with a
// presence indicator so the frontend can show "configured" without exposing
// any portion of the secret. Short PINs, non-string values, and nested
// objects all collapse to the same opaque marker.
function maskCredentials(creds: Record<string, unknown>): Record<string, "configured"> {
  const masked: Record<string, "configured"> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (v == null) continue;
    if (typeof v === "string" && v.length === 0) continue;
    masked[k] = "configured";
  }
  return masked;
}

export { dashboardRoutes };
