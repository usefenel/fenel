// A5 host-module bookkeeping, shared with engine-require without importing the
// engine root. This leaf performs no load, host handoff or Proxy-order capture.
// Registration remains trusted engine-graph code, not an untrusted minting API.

const NativeMap = Map;
const NativeSet = Set;
const apply = Reflect.apply;
const mapGet = NativeMap.prototype.get;
const mapSet = NativeMap.prototype.set;
const mapHas = NativeMap.prototype.has;
const mapDelete = NativeMap.prototype.delete;
const setAdd = NativeSet.prototype.add;
const setHas = NativeSet.prototype.has;

// Capture every operation before creating the only namespace/completion state.
// Later host replacement cannot expose these receivers, including during writes.
const _registry = new NativeMap<string, unknown>();

// A namespace can be a host-require cycle partial. Only completion-ordered
// registration may add an id here; a loader cache write cannot establish it.
const _completed = new NativeSet<string>();

/** Internal loader lookup, including namespaces not registered as completed. */
export function getEngineModuleNamespace(id: string): unknown {
  return apply(mapGet, _registry, [id]);
}

/** Internal host-require cache write; deliberately does not mark completion. */
export function cacheEngineModuleNamespace(id: string, ns: unknown): void {
  apply(mapSet, _registry, [id, ns]);
}

/** Internal partial-namespace recovery; the completion signal is unchanged. */
export function deleteEngineModuleNamespace(id: string): void {
  apply(mapDelete, _registry, [id]);
}

/** Called only through engine-require's existing registration API. */
export function registerCompletedEngineModule(id: string, ns: unknown): void {
  apply(mapSet, _registry, [id, ns]);
  apply(setAdd, _completed, [id]);
}

export function engineModuleCompleted(id: string): boolean {
  return apply(setHas, _completed, [id]);
}

export function engineModuleRegistered(id: string): boolean {
  return apply(mapHas, _registry, [id]);
}

/** Read only: never force-loads or seals startup state, and never retains a miss.
 * Completion and current namespace presence preserve the loader's existing
 * meanings, including registration replacement after a latched host failure. */
export function getCompletedEngineModule<T = unknown>(id: string): T | undefined {
  return apply(setHas, _completed, [id])
    ? apply(mapGet, _registry, [id]) as T | undefined
    : undefined;
}
