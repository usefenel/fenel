// ---------------------------------------------------------------------------
// Ref cache — resolve { entityType, id } → display label, lazily.
//
// The first time a ref to an entity type is rendered, kick off a fetch of
// /api/entity-instances/<entityType> and populate a local map. While
// loading, callers see `undefined`; once populated, the map is the source
// of truth for subsequent renders. A signal drives Solid's reactivity so
// pending renders flush when the map updates.
//
// Heuristic for the label field: the engine's `inferDisplayField` order —
// name → label → title → slug → email → first non-empty string field.
// ---------------------------------------------------------------------------

import { createSignal } from "solid-js";
import { defaultApiClient, type ApiClient } from "./api";
import { onApiMutation, onBrowserSessionChange, sessionEpoch } from "./browser-session";

type RefMap = Map<string, string>;

type RefTypeCache = {
  invalidation: number;
  labels?: RefMap;
  expiresAt?: number;
  request?: Promise<void>;
};
type RefClientCache = { epoch: number; types: Map<string, RefTypeCache> };

let caches = new WeakMap<ApiClient, RefClientCache>();
const entityInvalidations = new Map<string, number>();
const CACHE_TTL_MS = 60_000;

/** Also revokes outstanding loads; their completion cannot restore old labels. */
export function invalidateRefLabels(entityType?: string): void {
  if (entityType === undefined) {
    caches = new WeakMap();
    entityInvalidations.clear();
  } else {
    entityInvalidations.set(entityType, (entityInvalidations.get(entityType) ?? 0) + 1);
  }
  setVersion((v) => v + 1);
}

onBrowserSessionChange(() => invalidateRefLabels());
// All API writes include the older entity-specific CRUD endpoints, so labels
// stay correct regardless of which typed view performed the write.
onApiMutation(() => invalidateRefLabels());

/** Reactive version-counter — bumped each time a fetch finishes so consumers
 *  re-render. Kept opaque (a number) since Solid only cares that it changed. */
const [version, setVersion] = createSignal(0);

const LABEL_FIELDS = ["name", "label", "title", "slug", "email", "tag"];

function pickLabel(data: Record<string, unknown>): string | undefined {
  for (const k of LABEL_FIELDS) {
    const v = data[k];
    if (typeof v === "string" && v) return v;
  }
  // Last resort: first string value
  for (const v of Object.values(data)) {
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

async function loadRefs(client: ApiClient, entityType: string, state: RefTypeCache, isCurrent: () => boolean): Promise<void> {
  try {
    const result = await client.apiFetch<{ instances: Array<{ id: string; data: Record<string, unknown> }> }>(
      `/entity-instances/${encodeURIComponent(entityType)}`,
    );
    if (!isCurrent()) return;
    const map: RefMap = new Map();
    for (const inst of result.instances ?? []) {
      const label = pickLabel(inst.data ?? {});
      if (label) map.set(inst.id, label);
    }
    state.labels = map;
    state.expiresAt = Date.now() + CACHE_TTL_MS;
    setVersion((v) => v + 1);
  } catch {
    // Fall back to UUID, but do not cache transient failures. A later read can
    // retry. Avoid signalling here, which would create an immediate retry loop.
  } finally {
    if (isCurrent()) state.request = undefined;
  }
}

/** Resolve a ref to a display label.
 *
 * Returns the label if cached, otherwise undefined. On first call for an
 * entityType, kicks off a background fetch — Solid will re-evaluate the
 * caller when the cache populates (because of the `version()` read).
 */
export function refLabel(entityType: string, id: string, client: ApiClient = defaultApiClient): string | undefined {
  // Touch the version signal so callers re-run when any ref-type loads.
  void version();

  const epoch = client.epoch ?? sessionEpoch();
  if (epoch !== sessionEpoch()) return undefined;
  let scoped = caches.get(client);
  if (!scoped || scoped.epoch !== epoch) {
    scoped = { epoch, types: new Map() };
    caches.set(client, scoped);
  }
  const invalidation = entityInvalidations.get(entityType) ?? 0;
  let state = scoped.types.get(entityType);
  if (!state || state.invalidation !== invalidation) {
    state = { invalidation };
    scoped.types.set(entityType, state);
  }
  if (state.labels && (state.expiresAt ?? 0) > Date.now()) return state.labels.get(id);

  // Kick off the fetch if not already in flight.
  if (!state.request) {
    const capturedCache = scoped;
    const capturedType = state;
    const request = loadRefs(client, entityType, capturedType, () =>
      epoch === sessionEpoch()
      && caches.get(client) === capturedCache
      && capturedCache.types.get(entityType) === capturedType
      && (entityInvalidations.get(entityType) ?? 0) === invalidation
      && capturedType.request === request);
    capturedType.request = request;
  }
  return undefined;
}
