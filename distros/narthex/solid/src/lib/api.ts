import { query as routerQuery, revalidate as routerRevalidate } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import {
  assertCurrentSession,
  browserAccountScope,
  expireBrowserSession,
  inBootFrame,
  notifyApiMutation,
  onBrowserSessionChange,
  reportAccountChangedElsewhere,
  sessionEpoch,
  setBrowserAccountScope,
} from "./browser-session";
import type {
  DesiredFieldFacetValue,
  FieldOwnerMutation,
  FieldPersistenceSnapshot,
} from "@fenel/engine/field-authoring";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { ValueJsonEncoding, InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import type { ReaderPresentation } from "./reader-presentation";
/** A Local host receipt; this callback never enters the HTTP command wire. */
export type RootPublicationOptions = {
  onPublished?: (root: import("./locus-root-data").LocusRootData) => void;
};
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { createContext, createSignal, snapshot, useContext } from "solid-js";
import { ApiConnectionError, ApiResponseError, recoverApiRead } from "./api-read-recovery";
import type { ApiReadiness } from "./api-readiness";

import { bindCoreAuthoringOwner, discardEarlyAuthoringRealm, repositoryAuthoringRealmOwner } from "./expression-runner/authoring-catalog-early-realm";

const recoveringReads = new Map<AbortController, ApiReadiness>();
const [apiReadConnectionStatus, setApiReadConnectionStatus] = createSignal<"connecting" | "loading" | null>(null);
export { apiReadConnectionStatus };

function publishReadConnectionStatus() {
  const statuses = [...recoveringReads.values()];
  setApiReadConnectionStatus(statuses.includes("loading") ? "loading"
    : statuses.includes("connecting") ? "connecting" : null);
}

onBrowserSessionChange(() => {
  for (const controller of recoveringReads.keys()) controller.abort();
  recoveringReads.clear();
  publishReadConnectionStatus();
});

const API_BASE = "/api";
const NATIVE_JSON_HEADER = "X-Fenel-Value-Encoding";
function nativeJsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return { body: JSON.stringify(encodeCheckpointValue(value)), headers: { [NATIVE_JSON_HEADER]: CHECKPOINT_VALUE_ENCODING } };
}

// Auth/session requests must not initialize the authoring engine. Guard the
// account epoch across this potentially cold import before sending a write.
async function loadAuthoringJson() {
  const epoch = sessionEpoch();
  const codec = await import("./authoring-json");
  assertCurrentSession(epoch);
  return codec;
}

// Keep public query names for revalidate("name"), but include the current
// browser session in every argument key, including Back/Forward navigations.
function queryName(name: string, reader?: ApiReaderScope): string {
  return reader ? `reader:${reader.epoch}:${reader.accountId ?? "public"}:${name}` : name;
}
function createQuery<A extends unknown[], R>(fn: (...args: A) => R, name: string, reader?: ApiReaderScope) {
  const epoch = () => reader?.epoch ?? sessionEpoch();
  const cached = routerQuery((_epoch: number, args: A): R => fn(...args), queryName(name, reader));
  return Object.assign((...args: A): R => {
    assertCurrentSession(epoch());
    reader?.signal?.throwIfAborted();
    return cached(epoch(), args) as R;
  }, {
    key: cached.key,
    keyFor: (...args: A) => cached.keyFor(epoch(), args),
    uncached: (...args: A): R => { assertCurrentSession(epoch()); reader?.signal?.throwIfAborted(); return fn(...args); },
  });
}

onBrowserSessionChange(() => {
  // Vite serves a SPA, but module loading and tooling can also run in
  // a server context, where query.clear() requires an HTTP request owner.
  if (!isServer) routerQuery.clear();
  clearFieldAuthoringCaches();
});

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** The request header stating the tab's account, and the server's code for a
 *  request refused because the session now holds another account. */
const ACCOUNT_HEADER = "X-Fenel-Account";
const READER_ACCOUNT_HEADER = "X-Fenel-Reader-Account";
const ACCOUNT_CHANGED_CODE = "account-changed";

export class AccountChangedError extends Error {
  constructor() {
    super("Your account data changed in another tab. This tab is loading it now.");
    this.name = "AccountChangedError";
  }
}

function accountChangedResponse(body: string): boolean {
  try { return (JSON.parse(body) as { code?: unknown })?.code === ACCOUNT_CHANGED_CODE; }
  catch { return false; }
}

// Default per-request ceiling. Heavy MERGED-REGISTRY reads (`/types`,
// `/functions`) run a Fenel orchestration body whose pure helpers each execute
// as a separate DURABLE invocation (a `function_instances` row + several DB
// round-trips) — ~13 round-trips for `/types` even at 2 rows, amplified by the
// remote staging DB's per-query latency. Browser engine hydration also delays
// JavaScript delivery of completed responses (measured at 44s during startup),
// so every request gets a consistent bounded budget; callers may override it.
// STOPGAP: the performance fix is to stop round-tripping the DB for
// pure nested body calls (durable-evaluator perf; see TODO memo) — a co-located
// production DB also makes this far cheaper.
const DEFAULT_TIMEOUT_MS = 60_000;

export type AccountApiScope = {
  readonly accountId: string;
  readonly epoch: number;
  /** Refresh this reader's private registry after its definition transaction. */
  readonly onDefinitionsChanged?: () => Promise<void>;
  readonly onMetadataChanged?: () => Promise<void>;
};
type ApiReaderScope = (AccountApiScope | { readonly accountId?: undefined; readonly epoch: number;
  readonly onDefinitionsChanged?: undefined; readonly onMetadataChanged?: undefined }) & { readonly signal?: AbortSignal };

export type ReaderMetadataProjection = { entries: Array<{
  target: string;
  /** Exact identity alias from the captured reader, for inert declared-data lookup. */
  canonicalTarget?: string;
  representations: Array<{ typeName: string; methods: Record<string, unknown> }>;
  /** Inert data-row projection retaining exact selected-key provenance. */
  ownPresentation?: ReaderPresentation;
  ioInvokable?: Record<string, unknown>;
}> };

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return fetchApi<T>(path, init, timeoutMs);
}

async function fetchApi<T>(path: string, init: RequestInit | undefined, timeoutMs: number,
  reader?: ApiReaderScope,
): Promise<T> {
  const requestEpoch = reader?.epoch ?? sessionEpoch();
  assertCurrentSession(requestEpoch);
  reader?.signal?.throwIfAborted();
  if (reader && reader.accountId === undefined) throw new Error("Public values use the bundled repository; account data needs an account reader.");
  const account = reader?.accountId ?? browserAccountScope();
  // Before the session is first resolved, send no cookie: the response is then
  // anonymous by transport, so it remains valid if the session is confirmed
  // anonymous, and an account cookie cannot answer into the anonymous frame.
  const anonymousTransport = !reader && account === undefined && inBootFrame();
  const controller = new AbortController();
  const abort = () => controller.abort(init?.signal?.reason ?? reader?.signal?.reason);
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  reader?.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      headers.delete(ACCOUNT_HEADER);
      headers.delete(READER_ACCOUNT_HEADER);
      if (account !== undefined) headers.set(reader ? READER_ACCOUNT_HEADER : ACCOUNT_HEADER, account);
      res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      // `credentials: "include"` sends the `fenel_session` cookie set by
      // /api/auth/login, so authenticated routes resolve the Subject.
      credentials: anonymousTransport ? "omit" : "include",
      // A reader names a requested realm; only the server's authenticated
      // membership frame can admit it. The legacy header remains a guard.
      headers,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ApiConnectionError("Could not reach the server.", { cause: error });
      throw error;
    }
    assertCurrentSession(requestEpoch);
    reader?.signal?.throwIfAborted();
    if (res.status === 401) {
      // A request without a cookie says nothing about the session's cookie.
      if (!anonymousTransport) expireBrowserSession(requestEpoch);
      throw new UnauthenticatedError();
    }
    if (!res.ok) {
      const body = await res.text();
      assertCurrentSession(requestEpoch);
      reader?.signal?.throwIfAborted();
      if (!reader && res.status === 409 && accountChangedResponse(body)) {
        // Another tab switched the shared session to a different account.
        reportAccountChangedElsewhere(requestEpoch);
        throw new AccountChangedError();
      }
      throw new ApiResponseError(res.status, `API ${res.status}: ${body}`);
    }
    const payload = await res.json();
    assertCurrentSession(requestEpoch);
    reader?.signal?.throwIfAborted();
    const result = decodeCheckpointValue(payload, res.headers.get(NATIVE_JSON_HEADER));
    assertCurrentSession(requestEpoch);
    if (init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
      notifyApiMutation();
    }
    return result as T;
  } catch (e: any) {
    if (e.name === "AbortError") {
      if (init?.signal?.aborted) throw init.signal.reason ?? e;
      if (reader?.signal?.aborted) throw reader.signal.reason ?? e;
      throw new ApiConnectionError(path === "/views"
        ? `Loading data presentation tools took longer than ${Math.round(timeoutMs / 1000)}s. Please retry.`
        : `API timeout: ${path} did not respond within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abort);
    reader?.signal?.removeEventListener("abort", abort);
  }
}

/** Opt-in recovery for GETs used to load account data. Writes continue through
 * apiFetch and are never replayed after an uncertain response. */
export async function apiRead<T>(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return readApi<T>(path, timeoutMs);
}

async function readApi<T>(path: string, timeoutMs: number, reader?: ApiReaderScope): Promise<T> {
  const epoch = reader?.epoch ?? sessionEpoch();
  assertCurrentSession(epoch);
  reader?.signal?.throwIfAborted();
  const controller = new AbortController();
  // A disposed lens cancels the whole recovery wait, including readiness
  // probes, while the controller remains owned by session-wide cleanup.
  const signal = reader?.signal ? AbortSignal.any([controller.signal, reader.signal]) : controller.signal;
  recoveringReads.set(controller, "ready");
  try {
    return await recoverApiRead(() => {
      assertCurrentSession(epoch);
      return fetchApi<T>(path, { signal }, timeoutMs, reader);
    }, {
      signal,
      onStatus: (status) => {
        signal.throwIfAborted();
        assertCurrentSession(epoch);
        recoveringReads.set(controller, status);
        publishReadConnectionStatus();
      },
    });
  } finally {
    recoveringReads.delete(controller);
    publishReadConnectionStatus();
  }
}

export type FieldAuthoringCatalogRow = {
  fieldId: string;
  codeName: string;
  label?: string;
  owners: string[];
  occurrenceTypes: string[];
  realm: "account" | "repository" | "local";
  reuseVisibility: "owner" | "account" | "repository" | "local";
  /** Positive provenance from the retained tab source, never an account id. */
  sourceId?: string;
};

export type FieldAuthoringCatalogPage = {
  fields: FieldAuthoringCatalogRow[];
  facetInterfaceNames: string[];
  nextCursor?: string;
};

export type FieldResurrectionOwnerTarget = {
  ownerKey: string;
  ownerKind: "type" | "function";
  storageName: string;
};

/** One endpoint inventory; each reader owns its transport, query keys and authoring cache. */
function createEndpointClient(scope?: ApiReaderScope) {
  const lifecycle = new AbortController();
  const reader = scope ? { ...scope, signal: lifecycle.signal } : undefined;
  // Successful refresh receipts belong to this exact HTTP reader, never its
  // account name alone or another pane's definition response. A failed later
  // metadata refresh revokes them so the save's final refresh can retry.
  let refreshedDefinitions = new WeakSet<object>();
  const releaseSession = reader ? onBrowserSessionChange(() => lifecycle.abort(new Error("The reader's login session changed."))) : undefined;
  const apiFetch = <T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) => fetchApi<T>(path, init, timeoutMs, reader);
  const apiRead = <T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS) => readApi<T>(path, timeoutMs, reader);
  const query = <A extends unknown[], R>(fn: (...args: A) => R, name: string) => createQuery(fn, name, reader);
// Route data queries (cached, deduplicated)
const getStats = query(() => apiFetch<any>("/stats"), "stats");
const getProfiles = query((tag?: string) => apiFetch<any>(`/profiles${tag ? `?tag=${tag}` : ""}`), "profiles");
const getProfile = query((id: string) => apiFetch<any>(`/profiles/${id}`), "profile");
const getEvents = query((limit: number) => apiFetch<any>(`/events?limit=${limit}`), "events");
const getPurchases = query(() => apiFetch<any>("/purchases"), "purchases");
const getInventory = query(() => apiFetch<any>("/inventory"), "inventory");
// Function instances — running invocations of a function (only durable
// trigger-bearing functions produce instances; library functions don't).
const getFunctionInstances = query(
  (status?: string) =>
    apiFetch<any>(`/function-instances${status ? `?status=${status}` : ""}`),
  "functionInstances",
);
// Per-function instances + stats (uses functionId, not name)
const getFunctionInstancesById = query(
  (fnId: string, status?: string) =>
    apiFetch<{ instances: any[] }>(
      `/functions/${fnId}/instances${status ? `?status=${status}` : ""}`,
    ),
  "functionInstancesById",
);
const getFunctionStatsById = query(
  (fnId: string) => apiFetch<any>(`/functions/${fnId}/stats`),
  "functionStatsById",
);
// Bulk live counts (running / waiting) keyed by function id
const getFunctionLiveCounts = query(
  () =>
    apiFetch<{ counts: Record<string, { running: number; waiting: number }> }>(
      `/functions/live-counts`,
    ),
  "functionLiveCounts",
);
// Instance drill-in: merged event + trace timeline for one instance
const getInstanceTimeline = query(
  (fnId: string, instId: string) =>
    apiFetch<{
      instance: any;
      traces: any[];
      events: any[];
    }>(`/functions/${fnId}/instances/${instId}/timeline`),
  "instanceTimeline",
);
// Type page: recent traces touching values of a given type
const getTypeActivity = query(
  (typeName: string, limit?: number) =>
    apiFetch<{ traces: any[] }>(
      `/types/${encodeURIComponent(typeName)}/activity${limit ? `?limit=${limit}` : ""}`,
    ),
  "typeActivity",
);
const getItems = query(() => apiFetch<any>("/items"), "items");
const getItem = query((id: string) => apiFetch<any>(`/items/${id}`), "item");
const getPlans = query(() => apiFetch<any>("/plans"), "plans");
const getPlan = query((id: string) => apiFetch<any>(`/plans/${id}`), "plan");
// forms-collapse Phase 4 — getForms/getForm RETIRED (the legacy /forms list +
// detail routes are gone; funnels are registered types, surfaced via getTypes).
const getChannels = query(() => apiFetch<any>("/channels"), "channels");
const getProxyLinks = query(() => apiFetch<any>("/proxy-links"), "proxyLinks");
const getProxyLinkStats = query(() => apiFetch<any>("/proxy-links/stats"), "proxyLinkStats");
const getEmailTemplates = query(() => apiFetch<any>("/email-templates"), "emailTemplates");
const getAccount = query(() => apiFetch<any>("/account"), "account");

const getAnalyticsTimeseries = query(
  (days?: number, type?: string) =>
    apiFetch<any>(`/analytics/timeseries?days=${days ?? 30}${type ? `&type=${type}` : ""}`),
  "analyticsTimeseries",
);
const getAnalyticsSummary = query(() => apiFetch<any>("/analytics/summary"), "analyticsSummary");

const getIntegrations = query(() => apiFetch<any>("/integrations"), "integrations");
const getPages = query(() => apiFetch<any>("/pages"), "pages");
const getSavedQueries = query(
  async (category?: string, q?: string) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    const qs = params.toString();
    return apiRead<{ queries: any[]; categories: any[] }>(`/saved-queries${qs ? `?${qs}` : ""}`);
  },
  "savedQueries",
);
const getLocusViews = query(
  () => apiRead<{ locusViews: any[] }>("/locus-views"),
  "locusViews",
);
const getLocusRoot = query(
  () => apiRead<{ root: import("./locus-root-data").LocusRootData }>("/locus-root"),
  "locusRoot",
);
function editLocusRoot(id: string, expectedRevision: number, command: import("./locus-root-data").LocusRootCommand,
  _publication?: RootPublicationOptions) {
  return apiFetch<{ root: import("./locus-root-data").LocusRootData }>("/locus-root", {
    method: "PUT", ...nativeJsonBody({ id, expectedRevision, command }),
  });
}
const getActiveLocusView = query(
  () => apiRead<{ locusView: any | null }>("/locus-views/active"),
  "activeLocusView",
);
const getPageDetail = query((id: string) => apiFetch<any>(`/pages/${id}`), "page");
// `/types` merges DB + system + module type rows and enriches EACH via Fenel
// helper bodies (durable, DB-round-tripping). The shared request budget
// includes this remote-DB overhead (see apiFetch note).
const getTypes = query(async () => {
  const { typeDefinitionFromJsonWire } = await loadAuthoringJson();
  const response = await apiRead<any>("/types");
  return { ...response, types: response.types?.map(typeDefinitionFromJsonWire) };
}, "types");
// Browse needs labels and exact targets, not executable type definitions.
// Keep these reader-scoped summaries independent of the authoring codec.
const getBrowseTypes = query(async () => {
  const response = await apiRead<{ types?: Array<{
    name: string; label?: string; description?: string; isSystem?: boolean; type?: unknown;
  }> }>("/types");
  return { types: (response.types ?? []).map(row => ({
    name: row.name, label: row.label, description: row.description,
    isSystem: row.isSystem, hasDefinition: !!row.type,
  })) };
}, "types:browse");
const getTypeByName = query(async (name: string) => {
  const { typeDefinitionFromJsonWire } = await loadAuthoringJson();
  const response = await apiFetch<any>(`/types/${name}`);
  return { ...response, definition: typeDefinitionFromJsonWire(response.definition) };
}, "definition");
const fieldAuthoringCatalogRequests = new Map<string, Promise<FieldAuthoringCatalogPage>>();
function clearFieldAuthoringCaches(): void {
  fieldAuthoringCatalogRequests.clear();
}

function getFieldAuthoringCatalog(q = "", cursor?: string): Promise<FieldAuthoringCatalogPage> {
  assertCurrentSession(reader?.epoch ?? sessionEpoch());
  reader?.signal?.throwIfAborted();
  const search = new URLSearchParams();
  if (q.trim()) search.set("q", q.trim());
  if (cursor) search.set("cursor", cursor);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const path = `/definition-bundles/catalog${suffix}`;
  const cacheKey = `${reader?.epoch ?? sessionEpoch()}:${reader?.accountId ?? browserAccountScope() ?? "anonymous"}:${path}`;
  const prior = fieldAuthoringCatalogRequests.get(cacheKey);
  if (prior) return prior;
  const request = apiFetch<FieldAuthoringCatalogPage>(path).catch((error) => {
    if (fieldAuthoringCatalogRequests.get(cacheKey) === request) {
      fieldAuthoringCatalogRequests.delete(cacheKey);
    }
    throw error;
  });
  fieldAuthoringCatalogRequests.set(cacheKey, request);
  return request;
}
function getFieldAuthoringIdentity(fieldId: string): Promise<{
  field: FieldAuthoringCatalogRow | null;
}> {
  return apiFetch(`/definition-bundles/catalog/${encodeURIComponent(fieldId)}`);
}
function getFieldResurrectionCatalog(target: FieldResurrectionOwnerTarget): Promise<{
  fields: Array<{ fieldId: string; codeName: string }>;
}> {
  const search = new URLSearchParams({
    ownerKey: target.ownerKey,
    ownerKind: target.ownerKind,
    storageName: target.storageName,
  });
  return apiFetch(`/definition-bundles/resurrections?${search.toString()}`);
}
const getViews = query(async () => {
  const { viewRowFromJsonWire } = await loadAuthoringJson();
  const response = await apiRead<any>("/views");
  return { ...response, views: response.views?.map(viewRowFromJsonWire) };
}, "views");
const getView = query(async (name: string) => {
  const { viewRowFromJsonWire } = await loadAuthoringJson();
  const response = await apiFetch<any>(`/views/${name}`);
  return { ...response, definition: viewRowFromJsonWire(response.definition) };
}, "view");
// Functions — unified per-account FenelFunction storage. One concept,
// one URL surface. Keyed by `name`. A function with one or more triggers
// (separate `function_triggers` table) is durable and produces instances;
// one without is just a callable invoked explicitly.
// Same merged-registry shape as `/types` (DB + module functions enriched via
// durable helper bodies) — covered by the shared budget (see apiFetch note).
const getFunctions = query(async () => {
  const { functionRowFromJsonWire } = await loadAuthoringJson();
  const response = await apiRead<any>("/functions");
  return { ...response, functions: response.functions?.map(functionRowFromJsonWire) };
}, "functions");
const getBrowseFunctions = query(async () => {
  const response = await apiRead<{ functions?: Array<{
    name: string; description?: string; isSystem?: boolean; function?: unknown;
  }> }>("/functions");
  return { functions: (response.functions ?? []).map(row => ({
    name: row.name, description: row.description,
    isSystem: row.isSystem, hasDefinition: !!row.function,
  })) };
}, "functions:browse");
const getFunctionByName = query(async (name: string) => {
  const { functionRowFromJsonWire } = await loadAuthoringJson();
  const response = await apiFetch<any>(`/functions/${name}`);
  return { ...response, definition: functionRowFromJsonWire(response.definition) };
}, "functionByName");
/** Triggers attached to a specific function (when-to-call bindings). */
const getFunctionTriggers = query(
  (name: string) => apiFetch<any>(`/functions/${name}/triggers`),
  "functionTriggers",
);
const getDispatchInstances = query(
  (typeName?: string) => apiRead<any>(`/dispatch-instances${typeName ? `?typeName=${encodeURIComponent(typeName)}` : ""}`),
  "dispatchInstances",
);
/** Uncached complete facet read for authoring hydration. Route-data query
 * caches are intentionally unsuitable here: account switches and post-save
 * reloads must observe the current session's committed snapshot. */
function getFieldFacetInstances(): Promise<any> {
  return apiRead<any>("/dispatch-instances");
}
const getEntityInstances = query((entityType: string) => apiFetch<any>(`/entity-instances/${entityType}`), "entityInstances");
const queryEntities = query(
  (entity: string, limit?: number) =>
    apiFetch<any>("/query", { method: "POST", ...nativeJsonBody({ entity, limit: limit ?? 50, includeTotal: true }) }),
  "queryEntities",
);
const getQuerySchema = query(() => apiFetch<{ entities: Record<string, { fields: { name: string; type: FenelType }[]; relations?: Record<string, string[]> }> }>("/query/schema"), "querySchema");

// Mutations (not cached)
const api = {
  readerMetadata: (targets: readonly string[]) => apiFetch<ReaderMetadataProjection>("/reader-metadata", {
    method: "POST", body: JSON.stringify({ targets }),
  }),
  // Profiles
  profileCreate: (data: {
    type?: string;
    gender?: string;
    email?: string;
    phone?: string;
    dob?: string | null;
    avatar?: string | null;
    notes?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    nicknames?: string[] | null;
    handles?: { platform: string; handle: string; suspected?: boolean; validFrom?: string | null; validTo?: string | null }[];
    phones?: { number: string; label: string }[];
    tags?: { tag: string; context?: string; importance?: number | null }[];
  }) =>
    apiFetch<any>("/profiles", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  profileUpdate: (
    id: string,
    data: {
      type?: string;
      gender?: string | null;
      email?: string;
      phone?: string;
      dob?: string | null;
      avatar?: string | null;
      notes?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      handles?: { platform: string; handle: string; suspected?: boolean; validFrom?: string | null; validTo?: string | null }[];
      phones?: { number: string; label?: string }[];
    },
  ) =>
    apiFetch<any>(`/profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Profile relations (handles, phones, tags, intents, relationships)
  // are first-class entities now — managed via the generic
  // entityInstanceCreate / entityInstancePatch / entityInstanceDelete
  // helpers below. Bespoke per-relation endpoints retired in 9b-P.


  // Actions dispatch (generic)
  action: (name: string, params?: Record<string, unknown>) =>
    apiFetch<any>(`/actions/${name}`, {
      method: "POST",
      body: JSON.stringify({ params: params ?? {} }),
    }),

  // Account
  accountUpdate: (data: {
    name?: string;
    slug?: string;
    config?: Record<string, unknown>;
  }) =>
    apiFetch<any>("/account", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Proxy Links
  proxyLinkCreate: (data: { tag: string; url: string; title?: string; description?: string; image?: string }) =>
    apiFetch<any>("/proxy-links", { method: "POST", body: JSON.stringify(data) }),
  proxyLinkUpdate: (id: string, data: { tag?: string; url?: string; title?: string; description?: string; image?: string }) =>
    apiFetch<any>(`/proxy-links/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  proxyLinkDelete: (id: string) =>
    apiFetch<any>(`/proxy-links/${id}`, { method: "DELETE" }),

  // Email Templates
  emailTemplateCreate: (data: { slug: string; subject: string; body: string }) =>
    apiFetch<any>("/email-templates", { method: "POST", body: JSON.stringify(data) }),
  emailTemplateUpdate: (id: string, data: { slug?: string; subject?: string; body?: string }) =>
    apiFetch<any>(`/email-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  emailTemplateDelete: (id: string) =>
    apiFetch<any>(`/email-templates/${id}`, { method: "DELETE" }),

  // Types (was entityDefinitions pre-9.I)
  typeSeed: async () => {
    const { typeDefinitionFromJsonWire } = await loadAuthoringJson();
    const response = await apiFetch<any>("/types/seed", { method: "POST" });
    return { ...response, types: response.types?.map(typeDefinitionFromJsonWire) };
  },
  typeCreate: async (data: { name: string; label: string; description?: string; type?: Record<string, unknown>; defaultTemplate?: string; defaultTemplateInline?: string }) => {
    const { stringifyAuthoringJson, typeDefinitionToJsonWire, typeDefinitionFromJsonWire, ownerDefinitionFromJsonWire } = await loadAuthoringJson();
    const response = await apiFetch<any>("/types", { method: "POST", body: stringifyAuthoringJson(typeDefinitionToJsonWire(data)) });
    return { ...response, definition: response.definition?.kind === "type" ? ownerDefinitionFromJsonWire(response.definition) : typeDefinitionFromJsonWire(response.definition) };
  },
  typeUpdate: async (name: string, data: { label?: string; description?: string; type?: Record<string, unknown>; defaultTemplate?: string; defaultTemplateInline?: string }) => {
    const { stringifyAuthoringJson, typeDefinitionToJsonWire, typeDefinitionFromJsonWire, ownerDefinitionFromJsonWire } = await loadAuthoringJson();
    const response = await apiFetch<any>(`/types/${name}`, { method: "PUT", body: stringifyAuthoringJson(typeDefinitionToJsonWire(data)) });
    return { ...response, definition: response.definition?.kind === "type" ? ownerDefinitionFromJsonWire(response.definition) : typeDefinitionFromJsonWire(response.definition) };
  },
  typeDelete: (name: string) =>
    apiFetch<any>(`/types/${name}`, { method: "DELETE" }),

  // One account-scoped transaction for type/function owner definitions and
  // their stable Field identities/facets. The server runs the Fenel planner;
  // the browser sends desired state and only refreshes registries after this
  // request returns its committed snapshot.
  definitionBundleSave: async (input: {
    ownerMutations: FieldOwnerMutation[];
    desiredFacets?: DesiredFieldFacetValue[];
    replaceFacetFieldIds?: string[];
    resurrectFieldIds?: string[];
    expectedSnapshot?: FieldPersistenceSnapshot;
  }) => {
    const requestEpoch = reader?.epoch ?? sessionEpoch();
    assertCurrentSession(requestEpoch);
    const { stringifyAuthoringJson, definitionBundleToJsonWire, fieldDefinitionSnapshotFromJsonWire } = await loadAuthoringJson();
    // Bind the client-side lifecycle update to the account that initiated the
    // request. The server derives the same scope from the session; reading the
    // subject only after the response would let an A→B account switch label
    // account A's committed snapshot as B.
    assertCurrentSession(requestEpoch);
    const initiatingAccountId = reader?.accountId ?? browserAccountScope();
    const response = await apiFetch<{ snapshot: FieldPersistenceSnapshot }>("/definition-bundles", {
      method: "POST",
      body: stringifyAuthoringJson(definitionBundleToJsonWire(input)),
    });
    if (reader) {
      let refreshed = false;
      try {
        if (reader.onDefinitionsChanged) {
          await reader.onDefinitionsChanged();
          refreshed = true;
        }
      }
      catch (error) { console.error("Definition bundle committed, but this reader could not refresh:", error); }
      assertCurrentSession(requestEpoch);
      lifecycle.signal.throwIfAborted();
      clearFieldAuthoringCaches();
      const committed = { ...response, snapshot: fieldDefinitionSnapshotFromJsonWire(response.snapshot) };
      if (refreshed) refreshedDefinitions.add(committed);
      return committed;
    }
    // The network transaction has committed. Refetch the current graph instead
    // of publishing this response snapshot directly: two serialized commits
    // may have responses arrive out of order, while the GET always observes
    // the latest committed account state. A refresh failure must not turn an
    // already-committed mutation into a reported save failure.
    const {
      reloadAccountFieldRegistry,
      StaleAccountFieldRegistryLoadError,
    } = await import("./account-field-registry");
    const currentAccountId = browserAccountScope();
    if (initiatingAccountId !== undefined && currentAccountId === initiatingAccountId) {
      try {
        await reloadAccountFieldRegistry(initiatingAccountId);
      } catch (error) {
        if (!(error instanceof StaleAccountFieldRegistryLoadError)) {
          console.error(
            "Definition bundle committed, but the account field registry could not refresh:",
            error,
          );
        }
      }
    }
    clearFieldAuthoringCaches();
    return { ...response, snapshot: fieldDefinitionSnapshotFromJsonWire(response.snapshot) };
  },

  // Views (per-account TypeView records, 9.I.2)
  viewUpsert: async (name: string, view: Record<string, unknown>) => {
    const { stringifyAuthoringJson, viewDefinitionToJsonWire, viewRowFromJsonWire } = await loadAuthoringJson();
    const response = await apiFetch<any>(`/views/${name}`, { method: "PUT", body: stringifyAuthoringJson({ view: viewDefinitionToJsonWire(view) }) });
    return { ...response, definition: viewRowFromJsonWire(response.definition) };
  },
  viewDelete: (name: string) =>
    apiFetch<any>(`/views/${name}`, { method: "DELETE" }),

  // Functions — unified per-account FenelFunction CRUD. Keyed by name.
  // The `function` payload is a full FenelFunction record (name, params,
  // returns, body, optional trigger, optional cancelWhen). A function with
  // a `trigger` field is durable; one without is just a callable.
  functionUpsert: async (name: string, fn: Record<string, unknown>) => {
    const { stringifyAuthoringJson, functionDefinitionToJsonWire, functionRowFromJsonWire, ownerDefinitionFromJsonWire } = await loadAuthoringJson();
    const response = await apiFetch<any>(`/functions/${name}`, { method: "PUT", body: stringifyAuthoringJson({ function: functionDefinitionToJsonWire(fn as unknown as FenelFunction) }) });
    return { ...response, definition: response.definition?.kind === "function"
      ? ownerDefinitionFromJsonWire(response.definition) : functionRowFromJsonWire(response.definition) };
  },
  functionSetActive: (id: string, active: boolean) =>
    apiFetch<{ id: string; active: boolean }>(`/functions/${encodeURIComponent(id)}/active`, {
      method: "PATCH", body: JSON.stringify({ active }),
    }),
  functionDelete: (name: string) =>
    apiFetch<any>(`/functions/${name}`, { method: "DELETE" }),
  functionRun: (name: string, profileId: string, payload?: Record<string, unknown>) =>
    apiFetch<any>(`/functions/${name}/run`, {
      method: "POST",
      ...nativeJsonBody({ profileId, payload }),
    }),

  // Function triggers — when-to-call bindings, separate from the function
  // spec. A function can have zero or many triggers.
  triggerCreate: (functionName: string, data: {
    trigger: Record<string, unknown>;
    cancelWhen?: Record<string, unknown>;
    args?: Record<string, unknown>;
    active?: boolean;
  }) =>
    apiFetch<any>(`/functions/${functionName}/triggers`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  triggerUpdate: (id: string, data: {
    trigger?: Record<string, unknown>;
    cancelWhen?: Record<string, unknown> | null;
    args?: Record<string, unknown> | null;
    active?: boolean;
  }) =>
    apiFetch<any>(`/triggers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  triggerDelete: (id: string) =>
    apiFetch<any>(`/triggers/${id}`, { method: "DELETE" }),

  // Dispatch instances (per-account interface overrides). The POST body is the
  // canonical Instance surface: `{ typeName, args, instance }`.
  dispatchInstanceCreate: async (data: { id?: string; typeName: string; args: unknown[]; instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding }) => {
    const { stringifyAuthoringJson, fenelTypeToJsonWire } = await loadAuthoringJson();
    const result = await apiFetch<any>("/dispatch-instances", { method: "POST", body: stringifyAuthoringJson({
      ...data, args: data.args.map((arg) => fenelTypeToJsonWire(arg as FenelType)),
    }) });
    try { await reader?.onMetadataChanged?.(); }
    catch (error) {
      refreshedDefinitions = new WeakSet<object>();
      console.error("Instance committed, but this reader's metadata could not refresh:", error);
    }
    return result;
  },
  dispatchInstanceUpdate: async (id: string, instance: Record<string, unknown>, valueEncoding?: InstanceJsonEncoding, expectedInstance?: Record<string, unknown>) => {
    const { stringifyAuthoringJson, fenelTypeToJsonWire } = await loadAuthoringJson();
    const result = await apiFetch<any>(`/dispatch-instances/${id}`, { method: "PUT", body: stringifyAuthoringJson({ valueEncoding, ...(expectedInstance === undefined ? {} : { expectedInstance }), instance: {
      ...instance, ...(Array.isArray(instance.args) ? { args: instance.args.map((arg) => fenelTypeToJsonWire(arg as FenelType)) } : {}),
    } }) });
    try { await reader?.onMetadataChanged?.(); }
    catch (error) {
      refreshedDefinitions = new WeakSet<object>();
      console.error("Instance committed, but this reader's metadata could not refresh:", error);
    }
    return result;
  },
  dispatchInstanceDelete: async (id: string, expectedInstance?: Record<string, unknown>) => {
    const result = await apiFetch<any>(`/dispatch-instances/${id}`, { method: "DELETE",
      ...(expectedInstance === undefined ? {} : nativeJsonBody({ expectedInstance })) });
    try { await reader?.onMetadataChanged?.(); }
    catch (error) {
      refreshedDefinitions = new WeakSet<object>();
      console.error("Instance deleted, but this reader's metadata could not refresh:", error);
    }
    return result;
  },

  // Entity instance deletion (built-in types)
  profileDelete: (id: string) =>
    apiFetch<any>(`/profiles/${id}`, { method: "DELETE" }),
  itemDelete: (id: string) =>
    apiFetch<any>(`/items/${id}`, { method: "DELETE" }),
  planDelete: (id: string) =>
    apiFetch<any>(`/plans/${id}`, { method: "DELETE" }),
  functionInstanceDelete: (id: string) =>
    apiFetch<any>(`/function-instances/${id}`, { method: "DELETE" }),

  // Generic entity instances (user-defined types)
  entityInstanceList: (entityType: string) =>
    apiFetch<any>(`/entity-instances/${entityType}`),
  entityInstanceCreate: async (entityType: string, data: unknown, valueEncoding?: ValueJsonEncoding) => {
    const { stringifyAuthoringJson } = await loadAuthoringJson();
    return apiFetch<any>(`/entity-instances/${entityType}`, { method: "POST", body: stringifyAuthoringJson({ data, valueEncoding }) });
  },
  entityInstanceUpdate: async (id: string, data: unknown, valueEncoding?: ValueJsonEncoding) => {
    const { stringifyAuthoringJson } = await loadAuthoringJson();
    return apiFetch<any>(`/entity-instances/${id}`, { method: "PUT", body: stringifyAuthoringJson({ data, valueEncoding }) });
  },
  entityInstancePatch: async (id: string, data: Record<string, unknown>, valueEncoding?: ValueJsonEncoding) => {
    const { stringifyAuthoringJson } = await loadAuthoringJson();
    return apiFetch<any>(`/entity-instances/${id}`, { method: "PATCH", body: stringifyAuthoringJson({ data, valueEncoding }) });
  },
  entityInstanceDelete: (id: string) =>
    apiFetch<any>(`/entity-instances/${id}`, { method: "DELETE" }),

  // Integrations
  integrationUpsert: (data: { type: string; label?: string; credentials: Record<string, unknown>; config?: Record<string, unknown> }) =>
    apiFetch<any>("/integrations", { method: "POST", body: JSON.stringify(data) }),
  integrationUpdate: (id: string, data: { label?: string; credentials?: Record<string, unknown>; config?: Record<string, unknown>; enabled?: boolean }) =>
    apiFetch<any>(`/integrations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  integrationDelete: (id: string) =>
    apiFetch<any>(`/integrations/${id}`, { method: "DELETE" }),

  // Record queries — entity rows / aggregates / funnels. Used by both the
  // Query Explorer (rich builder) and the Data page (inline `entity:X`).
  runRecordQuery: (body: Record<string, unknown>) =>
    apiFetch<{ rows: Record<string, unknown>[]; total?: number; meta?: { entity?: string } }>(
      "/query",
      { method: "POST", ...nativeJsonBody(body) },
    ),
  runCompareQuery: (body: Record<string, unknown>) => apiFetch<any>("/query/compare", { method: "POST", ...nativeJsonBody(body) }),
  runFunnelQuery: (body: Record<string, unknown>) => apiFetch<any>("/query/funnel", { method: "POST", ...nativeJsonBody(body) }),

  // Home views — the customizable OS-like home page.
  locusViewCreate: (data: { name: string; view?: Record<string, unknown>; active?: boolean }) =>
    apiFetch<any>("/locus-views", { method: "POST", ...nativeJsonBody(data) }),
  locusViewUpdate: (id: string, data: { name?: string; view?: Record<string, unknown>; expectedRootRevision?: number }) =>
    apiFetch<any>(`/locus-views/${id}`, { method: "PUT", ...nativeJsonBody(data) }),
  locusViewActivate: (id: string) =>
    apiFetch<any>(`/locus-views/${id}/activate`, { method: "POST" }),
  locusViewDelete: (id: string) =>
    apiFetch<any>(`/locus-views/${id}`, { method: "DELETE" }),
  invokeIOAction: (fnId: string, args: unknown[], mode: "run" | "stop" = "run") =>
    apiFetch<{
      ok: boolean;
      stopped?: boolean;
      value?: unknown;
      error?: string;
      suspended?: boolean;
      instanceId?: string;
      status?: string;
      suspensionId?: string | null;
    }>(`/io/invoke`, {
      method: "POST",
      ...nativeJsonBody({ fnId, args, mode }),
    }),
  listAwaitingPrompts: () =>
    apiFetch<{
      awaiting: Array<{
        instanceId: string;
        suspensionId: string | null;
        functionId: string;
        functionName: string;
        status: string;
        prompt: string | null;
        source: string | null;
        schema: unknown;
        createdAt: string;
      }>;
    }>(`/io/awaiting`),
  resolveAwaitingPrompt: (instanceId: string, value: unknown, suspensionId: string | null) =>
    apiFetch<{
      ok: boolean;
      value?: unknown;
      suspended?: boolean;
      status?: string;
      suspensionId?: string | null;
      error?: string;
    }>(`/io/awaiting/${encodeURIComponent(instanceId)}/resolve`, {
      method: "POST",
      ...nativeJsonBody({ value, suspensionId }),
    }),
  getIOInstances: (fnId: string, args: unknown[] = []) =>
    apiFetch<{
      ok: boolean;
      supported: boolean;
      /** Universal — every function-with-a-body produces these. One row
       *  per invocation: \`{id, label, status, startedAt, completedAt,
       *  lastResult}\`. */
      runs: Array<{
        id: string;
        label: string;
        status: string;
        startedAt: unknown;
        completedAt: unknown;
        lastResult: string | null;
      }>;
      /** Specialized — present iff the function declared
       *  listInstancesAction (registered external entities like bots).
       *  null when no specialized listing exists; [] when the listing
       *  exists but returned no rows. */
      deployments: unknown[] | null;
      deploymentsError?: string | null;
      error?: string;
    }>(
      `/io/instances`,
      { method: "POST", ...nativeJsonBody({ fnId, args }) },
    ),
  /** Most recent completed function_instance for a given fn — used by
   *  dashboard pin cards to rehydrate their "IO result" panel on page
   *  load. Returns `instance: null` when the fn has never been run on
   *  this account. */
  getIOLastResult: (fnId: string) =>
    apiFetch<{
      ok: boolean;
      instance: {
        id: string;
        value: unknown;
        startedAt: string;
        completedAt: string | null;
      } | null;
      error?: string;
    }>(`/io/last-result?fnId=${encodeURIComponent(fnId)}`),

  // Saved Queries
  // `name` is optional: it mirrors a `Labelable` instance, and a value may
  // simply not have one.
  savedQueryCreate: (data: { id?: string; slug: string; name?: string; description?: string; query: Record<string, unknown> }) =>
    apiFetch<any>("/saved-queries", { method: "POST", ...nativeJsonBody(data) }),
  savedQueryUpdate: (id: string, data: { slug?: string; name?: string; description?: string; query?: Record<string, unknown>; expectedQuery?: Record<string, unknown> }) =>
    apiFetch<any>(`/saved-queries/${id}`, { method: "PUT", ...nativeJsonBody(data) }),
  savedQueryDelete: (id: string, expectedQuery?: Record<string, unknown>) =>
    apiFetch<any>(`/saved-queries/${id}`, { method: "DELETE",
      ...(expectedQuery === undefined ? {} : nativeJsonBody({ expectedQuery })) }),

  // Query Categories
  queryCategoryCreate: (data: { slug: string; name: string; description?: string; parentId?: string; queryIds?: string[] }) =>
    apiFetch<any>("/query-categories", { method: "POST", body: JSON.stringify(data) }),
  queryCategoryUpdate: (id: string, data: { slug?: string; name?: string; description?: string; parentId?: string | null }) =>
    apiFetch<any>(`/query-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  queryCategoryDelete: (id: string) =>
    apiFetch<any>(`/query-categories/${id}`, { method: "DELETE" }),
  queryCategoryAddQuery: (categoryId: string, queryId: string) =>
    apiFetch<any>(`/query-categories/${categoryId}/queries`, { method: "POST", body: JSON.stringify({ queryId }) }),
  queryCategoryRemoveQuery: (categoryId: string, queryId: string) =>
    apiFetch<any>(`/query-categories/${categoryId}/queries/${queryId}`, { method: "DELETE" }),

  // Pages
  pageCreate: (data: { slug: string; name: string; blocks: any[]; config?: Record<string, unknown>; published?: boolean }) =>
    apiFetch<any>("/pages", { method: "POST", body: JSON.stringify(data) }),
  pageUpdate: (id: string, data: { slug?: string; name?: string; blocks?: any[]; config?: Record<string, unknown>; published?: boolean }) =>
    apiFetch<any>(`/pages/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  pageDelete: (id: string) =>
    apiFetch<any>(`/pages/${id}`, { method: "DELETE" }),
};

  return {
    accountId: reader?.accountId,
    epoch: reader?.epoch,
    // The same reader lifetime also bounds local browser workers and drafts.
    get signal(): AbortSignal { return lifecycle.signal; },
    apiFetch, apiRead,
    didRefreshDefinitions: (result: unknown): boolean => {
      assertCurrentSession(reader?.epoch ?? sessionEpoch());
      lifecycle.signal.throwIfAborted();
      return typeof result === "object" && result !== null && refreshedDefinitions.has(result);
    },
    dispose: () => {
      releaseSession?.();
      if (lifecycle.signal.aborted) return;
      lifecycle.abort(new DOMException("This reader was closed.", "AbortError"));
      clearFieldAuthoringCaches();
    },
    revalidate: (name: string | string[]) => routerRevalidate(Array.isArray(name)
      ? name.map((key) => queryName(key, reader)) : queryName(name, reader)),
    getStats, getProfiles, getProfile, getEvents, getPurchases,
    getInventory, getFunctionInstances, getFunctionInstancesById, getFunctionStatsById, getFunctionLiveCounts,
    getInstanceTimeline, getTypeActivity, getItems, getItem, getPlans,
    getPlan, getChannels, getProxyLinks, getProxyLinkStats, getEmailTemplates,
    getAccount, getAnalyticsTimeseries, getAnalyticsSummary, getIntegrations, getPages,
    getSavedQueries, getLocusViews, getLocusRoot, editLocusRoot, getActiveLocusView,
    getPageDetail, getTypes, getBrowseTypes, getBrowseFunctions, getTypeByName, clearFieldAuthoringCaches, getFieldAuthoringCatalog,
    getFieldAuthoringIdentity, getFieldResurrectionCatalog, getViews, getView, getFunctions,
    getFunctionByName, getFunctionTriggers, getDispatchInstances, getFieldFacetInstances, getEntityInstances,
    queryEntities, getQuerySchema, api
  };
}

/** B4 unit E: a Local reader encodes instance wire data in its own worker.
 * The object is also the encoding's identity: a write encoded under one
 * snapshot's definitions refuses after they change. */
export type ReaderInstanceEncoding = {
  readonly encodeInstances: (instances: readonly Record<string, unknown>[], encoding: InstanceJsonEncoding) => Promise<Record<string, unknown>[]>;
  /** Decode wire instances encoded under this same encoding's definitions. */
  readonly decodeInstances: (instances: readonly { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding }[]) =>
    Promise<Record<string, unknown>[]>;
};
/** What a representation write was encoded against: a page registry, or a
 * Local reader's worker encoding. */
export type RepresentationEncoding = ModuleRegistry | ReaderInstanceEncoding;
export function isReaderInstanceEncoding(encoding: RepresentationEncoding | undefined): encoding is ReaderInstanceEncoding {
  return encoding !== undefined && Object.hasOwn(encoding, "encodeInstances");
}
export type ApiClient = ReturnType<typeof createEndpointClient> & {
  /** Shared source drafts; accepting a browser edit is separate from saving it. */
  readonly drafts?: import("./reader-draft-client").ReaderDraftController;
  /** Captured source-root identity, independently of any account authority. */
  readonly rootId?: string;
  /** Browser-decoded Local literals can publish before complete editing tools. */
  ingestExternal?: import("./local-locus-data").LocalTabSource["ingestExternal"];
  /** Local dispatch-row writes share one checked source revision and publish. */
  writeDispatchInstances?: (writes: readonly {
    existingId?: string;
    typeName: string;
    args: unknown[];
    instance: Record<string, unknown>;
    valueEncoding?: InstanceJsonEncoding;
  }[], expectedRevision: number, encodingRegistry?: RepresentationEncoding) => Promise<void>;
  /** Local only (B4 unit E): the current snapshot's worker instance encoding. */
  instanceEncoding?: () => ReaderInstanceEncoding;
  /** A source with one revision can edit a referenced value and its occurrence
   * atomically. Account HTTP keeps its existing separate storage contract. */
  editSavedValue?: (id: string, query: Record<string, unknown>, expectedRevision: number,
    occurrence?: import("./locus-root-data").LocusRootCommand, expectedQuery?: Record<string, unknown>) => Promise<{ root: import("./locus-root-data").LocusRootData }>;
  /** One local source transaction for a checked definition and its authored
   * data mutation; unsupported sources retain their existing write endpoints. */
  editDefinitionAndData?: (bundle: Parameters<ReturnType<typeof createEndpointClient>["api"]["definitionBundleSave"]>[0],
    expectedRevision: number, mutation?: {
      occurrence?: import("./locus-root-data").LocusRootCommand;
      savedValue?: { id: string; query: Record<string, unknown>; expectedQuery?: Record<string, unknown> };
      /** Representation writes (as for `writeDispatchInstances`) committed in
       * the same transaction, encoded against `encodingRegistry`. */
      representations?: Parameters<NonNullable<ApiClient["writeDispatchInstances"]>>[0];
      encodingRegistry?: RepresentationEncoding;
    }) => Promise<{ root: import("./locus-root-data").LocusRootData; snapshot: FieldPersistenceSnapshot }>;
};
export const defaultApiClient = createEndpointClient();
export const {
  getStats, getProfiles, getProfile, getEvents, getPurchases,
  getInventory, getFunctionInstances, getFunctionInstancesById, getFunctionStatsById, getFunctionLiveCounts,
  getInstanceTimeline, getTypeActivity, getItems, getItem, getPlans,
  getPlan, getChannels, getProxyLinks, getProxyLinkStats, getEmailTemplates,
  getAccount, getAnalyticsTimeseries, getAnalyticsSummary, getIntegrations, getPages,
  getSavedQueries, getLocusViews, getLocusRoot, editLocusRoot, getActiveLocusView,
  getPageDetail, getTypes, getBrowseTypes, getBrowseFunctions, getTypeByName, clearFieldAuthoringCaches, getFieldAuthoringCatalog,
  getFieldAuthoringIdentity, getFieldResurrectionCatalog, getViews, getView, getFunctions,
  getFunctionByName, getFunctionTriggers, getDispatchInstances, getFieldFacetInstances, getEntityInstances,
  queryEntities, getQuerySchema, api
} = defaultApiClient;

/** Capture this at pane creation, never change the browser's active account. */
export function createAccountApiClient(accountId: string, options: {
  epoch?: number;
  onDefinitionsChanged?: () => Promise<void>;
  onMetadataChanged?: () => Promise<void>;
} = {}): ApiClient {
  if (!accountId) throw new TypeError("A reader client needs an account id.");
  const epoch = options.epoch ?? sessionEpoch();
  assertCurrentSession(epoch);
  const client = createEndpointClient({ accountId, epoch, onDefinitionsChanged: options.onDefinitionsChanged,
    onMetadataChanged: options.onMetadataChanged });
  const realmOwner = Object.freeze({});
  bindCoreAuthoringOwner(client, realmOwner, epoch, client.signal);
  client.signal.addEventListener("abort", () => discardEarlyAuthoringRealm(realmOwner), { once: true });
  return client;
}

/** Public panes have no fallback to the signed-in account's HTTP client. */
export function createPublicApiClient(): ApiClient {
  const epoch = sessionEpoch();
  const client = createEndpointClient({ epoch });
  bindCoreAuthoringOwner(client, repositoryAuthoringRealmOwner(), epoch, client.signal);
  return client;
}

export const ApiClientContext = createContext<ApiClient>(defaultApiClient);
/** Capture once during component setup; handlers keep the same reader client. */
export function useApiClient(): ApiClient {
  return useContext(ApiClientContext);
}

/** The legacy single-account shell still owns this transition. Bound readers never call it. */
export function setApiAccountScope(accountId: string | undefined): void {
  setBrowserAccountScope(accountId);
  defaultApiClient.clearFieldAuthoringCaches();
}
