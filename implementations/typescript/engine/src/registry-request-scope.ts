/** A request-scoped memo for account-registry resolution.
 *
 *  ## Why this exists
 *
 *  `loadAccountExecutionRegistry` (runtime) caches correctly — repeated calls
 *  return the IDENTICAL `ModuleRegistry` — but its cache key is a fingerprint
 *  computed from freshly-read state, so *deciding* a hit costs two database
 *  reads: the account's source modules and its field-definition graph. Measured
 *  on staging, that pair is ~115 ms, and an ordinary authenticated request pays
 *  it THREE times: once for the rights R2a authority mint
 *  (`api/src/middleware/auth.ts`), once in `invokeIOActionAs`, and once in the
 *  durable evaluator's `makeContext`. This memo makes the second and third
 *  calls free, which is ~230 ms of a ~1.58 s request.
 *
 *  ## The consistency contract — read this before using it elsewhere
 *
 *  ⚠ THIS IS A SEMANTIC CHANGE, NOT PURE DEDUPLICATION. Without it, every
 *  loader call re-reads the inputs and therefore observes commits made by OTHER
 *  processes between two calls in one request. With it, a request resolves the
 *  account registry ONCE and reuses that answer for its remainder. The window
 *  is bounded by a single request and the next request sees the new state, and
 *  a request being internally consistent is arguably the better contract — but
 *  it IS a contract change, and nothing here (nor any process-local
 *  invalidation) restores cross-process visibility mid-request. Only database
 *  validation at each loader call could, which is why the cheap-validity-signal
 *  work is deliberately a separate, unimplemented lever.
 *
 *  ## Why the mechanism looks like this
 *
 *  - **`AsyncLocalStorage`, not a TTL.** A TTL is a guess at a staleness window;
 *    a request is the actual unit of consistency we want. Outside any scope
 *    (tests, scripts, the bot, CLI tooling) `memoInRegistryRequestScope` is a
 *    pass-through, so non-request callers are byte-identical to before.
 *  - **An explicit `active` flag, not scope teardown.** An ALS store does NOT
 *    expire when the response is written: asynchronous descendants keep it.
 *    This repo has real request tails — `with_timeout` and `race` leave the
 *    losing action running, and `parallel` can leave branches running after
 *    another rejects. Those descendants must not read a memo whose request has
 *    finished, and a late completion must not repopulate one. The flag is
 *    cleared in a `finally`, after which every lookup misses. (Note we never
 *    call the shared storage's `disable()`, which would affect other in-flight
 *    contexts.)
 *  - **The in-flight PROMISE is memoised, not just the resolved value.** Two
 *    concurrent misses in one request would otherwise both load, observe
 *    possibly different inputs, and let completion order decide which registry
 *    later callers get. Storing the promise before awaiting collapses that to
 *    one load with one answer.
 *  - **A caller-supplied `version` is revalidated on every hit.** The loader's
 *    own fingerprint includes `dispatchRegistry.version()`, and it must: a
 *    source-backed registry COPIES the global dispatch instances into a private
 *    registry rather than observing them live, so a concurrent request calling
 *    `state.register_representation` changes global dispatch state that a
 *    memoised registry would not reflect. Comparing the version is free, so a
 *    stale-by-dispatch entry is treated as a miss. This module stays generic
 *    over that number rather than importing the dispatch registry, because
 *    being import-free is what keeps it out of the engine's init cycles — the
 *    same reason `authority.ts` types its frame structurally.
 *  - **A mutation disables the scope for its remainder.** See
 *    `invalidateRegistryRequestScope`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type Entry = { readonly version: number; readonly value: Promise<unknown> };

type Scope = {
  /** Cleared when the request that opened this scope finishes. A surviving
   *  async descendant still sees the store, so the flag — not the store's
   *  presence — is what makes a lookup legal. */
  active: boolean;
  readonly entries: Map<string, Entry>;
};

const storage = new AsyncLocalStorage<Scope>();

/** The live scope, or `undefined` when there is none or it has finished. */
function currentScope(): Scope | undefined {
  const scope = storage.getStore();
  return scope !== undefined && scope.active ? scope : undefined;
}

/** Run `fn` inside a fresh request scope. Entries are dropped and the scope is
 *  marked finished when `fn` settles, so anything still running afterwards
 *  (a `race` loser, a `with_timeout` tail) loads fresh. */
export function runInRegistryRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  const scope: Scope = { active: true, entries: new Map() };
  return storage.run(scope, async () => {
    try {
      return await fn();
    } finally {
      scope.active = false;
      scope.entries.clear();
    }
  });
}

/** Stop memoising for the remainder of the current scope.
 *
 *  ⚠ CALL THIS BEFORE a mutation of the memoised inputs, not after. Disabling
 *  is deliberately stickier than clearing: a concurrent loader cannot then
 *  repopulate the memo from a read that raced an uncommitted transaction, a
 *  failed mutation leaves the request merely unoptimised rather than
 *  inconsistent, and there is no commit/rollback ordering to get right.
 *
 *  It is NOT transactional isolation: a caller already holding, or already
 *  awaiting, a previously memoised registry keeps it. This only governs which
 *  answer *subsequent* loads in this request receive.
 *
 *  A no-op outside a request scope, so the database layer can call it
 *  unconditionally. */
export function invalidateRegistryRequestScope(): void {
  const scope = storage.getStore();
  if (scope === undefined) return;
  scope.active = false;
  scope.entries.clear();
}

/** True when a live request scope is memoising. For assertions and tests. */
export function registryRequestScopeIsActive(): boolean {
  return currentScope() !== undefined;
}

/** Memoise `load()` under `key` for the current request scope.
 *
 *  Outside a scope, or once a mutation has disabled it, this simply calls
 *  `load()` — the pre-existing behaviour. `version` is revalidated on every
 *  hit; a mismatch is a miss.
 */
export function memoInRegistryRequestScope<T>(
  key: string,
  version: number,
  load: () => Promise<T>,
): Promise<T> {
  const scope = currentScope();
  if (scope === undefined) return load();
  const hit = scope.entries.get(key);
  if (hit !== undefined && hit.version === version) return hit.value as Promise<T>;
  // ⚠ `load()` runs BEFORE the entry is installed, so a SYNCHRONOUSLY reentrant
  // loader could double-load, and a synchronous `invalidate` inside `load()`
  // would insert into an already-disabled map (harmless — `active` is false, so
  // nothing reads it). Neither is reachable from the account-registry loader,
  // which hits an awaited state read immediately; revisit if a synchronous
  // loader is ever passed here.
  const value = load();
  const entry: Entry = { version, value };
  scope.entries.set(key, entry);
  // A rejected load must not be cached — but only retract OUR entry, never one
  // a later mutation or a newer load has already replaced it with.
  value.catch(() => {
    if (scope.entries.get(key) === entry) scope.entries.delete(key);
  });
  return value;
}
