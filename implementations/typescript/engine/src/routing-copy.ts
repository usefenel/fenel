import { getCompletedEngineModule } from "./engine-module-state";

// A2/B3 host-copy boundary: trusted realm initialization captures the owner's
// operations. Caller data is still observed through the original copy protocol.
const routingCopyApply = Reflect.apply;
const routingCopyReflectGet = Reflect.get;
const routingCopyArray = Array;
const routingCopyBytes = Uint8Array;
const routingCopyBytesPrototype = Uint8Array.prototype;
const routingCopyObjectPrototype = Object.prototype;
const routingCopyWeakMap = WeakMap;
const routingCopyWeakMapGet = WeakMap.prototype.get;
const routingCopyWeakMapSet = WeakMap.prototype.set;
const routingCopyWeakSet = WeakSet;
const routingCopyWeakSetHas = WeakSet.prototype.has;
const routingCopyWeakSetAdd = WeakSet.prototype.add;
const routingCopyWeakSetDelete = WeakSet.prototype.delete;
const routingCopyGetPrototypeOf = Object.getPrototypeOf;
const routingCopyGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const routingCopyGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const routingCopyGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const routingCopyHasOwn = Object.hasOwn;
const routingCopyKeys = Object.keys;
const routingCopyValues = Object.values;
const routingCopyEntries = Object.entries;
const routingCopyCreate = Object.create;
const routingCopyDefineProperty = Object.defineProperty;
const routingCopyFreeze = Object.freeze;
const routingCopyIsArray = Array.isArray;
const routingCopyIs = Object.is;
const routingCopyStringify = JSON.stringify;
const routingCopyTypeError = TypeError;

function copyMapGet<T>(map: WeakMap<object, T>, key: object): T | undefined {
  return routingCopyApply(routingCopyWeakMapGet, map, [key]) as T | undefined;
}

function copyMapSet<T>(map: WeakMap<object, T>, key: object, value: T): void {
  routingCopyApply(routingCopyWeakMapSet, map, [key, value]);
}

function copySetHas(set: WeakSet<object>, value: object): boolean {
  return routingCopyApply(routingCopyWeakSetHas, set, [value]) as boolean;
}

function copySetAdd(set: WeakSet<object>, value: object): void {
  routingCopyApply(routingCopyWeakSetAdd, set, [value]);
}

function copySetDelete(set: WeakSet<object>, value: object): void {
  routingCopyApply(routingCopyWeakSetDelete, set, [value]);
}

// IDENTITY-KEYED / PROCESS-GLOBAL: exact successful returned roots only. This
// attests owner construction, never a semantic answer or authority verdict.
const completedRoutingCopies = new routingCopyWeakSet<object>();

/** Internal read-only provenance. There is deliberately no public mint seam. */
export function isVersionedRoutingTableCopy(value: unknown): boolean {
  return value !== null && typeof value === "object" && copySetHas(completedRoutingCopies, value);
}

function completedProducer(
  getter: () => unknown,
  versionGetter: () => number,
  root: object,
): boolean {
  // This reads only an already-completed namespace in the existing trusted
  // engine graph; it neither force-loads the registry nor seals host preload.
  try {
    const registry = getCompletedEngineModule<typeof import("./registry")>("registry");
    if (registry === undefined) return false;
    const descriptor = routingCopyGetOwnPropertyDescriptor(registry, "isCompletedRegistryRoutingTableProducer");
    if (descriptor === undefined) return false;
    // Completed namespaces are trusted loader infrastructure; browser bundlers
    // implement their live exports as getters. This never admits a source-data
    // accessor or accepts a verifier supplied to the copy factory.
    const recognizer = routingCopyReflectGet(registry, "isCompletedRegistryRoutingTableProducer", registry);
    return typeof recognizer === "function"
      && routingCopyApply(recognizer, registry, [getter, versionGetter, root]) === true;
  } catch {
    // Optional provenance cannot turn a successful ordinary copy into refusal.
    // Its retained base stays unqualified until an ordinary miss rebuilds it.
    return false;
  }
}

/** The original browser authority copier, restricted to this versioned owner.
 * Preserve foreign-input reflection order, including the ordinary array length
 * read and native Uint8Array construction of caller-owned/exotic Bytes leaves. */
function cloneRoutingNode<T>(value: T, copies: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== "object") return value;
  const prior = copyMapGet(copies, value);
  if (prior !== undefined) return prior as T;
  if (routingCopyGetPrototypeOf(value) === routingCopyBytesPrototype) {
    const bytes = new routingCopyBytes(value as unknown as Uint8Array);
    copyMapSet(copies, value, bytes);
    return bytes as T;
  }
  const prototype = routingCopyGetPrototypeOf(value);
  if (!routingCopyIsArray(value) && prototype !== routingCopyObjectPrototype && prototype !== null) {
    throw new routingCopyTypeError("browser evaluator authority must be plain transport data");
  }
  if (routingCopyGetOwnPropertySymbols(value).length > 0) {
    throw new routingCopyTypeError("browser evaluator authority must not contain symbol properties");
  }
  const output = routingCopyIsArray(value)
    ? new routingCopyArray((value as unknown[]).length)
    : routingCopyCreate(prototype) as Record<string, unknown>;
  copyMapSet(copies, value, output);
  const descriptors = routingCopyGetOwnPropertyDescriptors(value);
  const keys = routingCopyKeys(descriptors);
  // These key arrays are native-created private data, so indexed iteration
  // changes no caller iterator observation.
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (routingCopyIsArray(value) && key === "length") continue;
    const descriptor = descriptors[key]!;
    if (!routingCopyHasOwn(descriptor, "value")) {
      throw new routingCopyTypeError(
        `browser evaluator authority: accessor property ${routingCopyStringify(key)} is not allowed`,
      );
    }
    if (!descriptor.enumerable) continue;
    routingCopyDefineProperty(output, key, {
      __proto__: null,
      value: cloneRoutingNode(descriptor.value, copies),
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }
  return routingCopyFreeze(output) as T;
}

function markBytesBearing(
  value: unknown,
  bearing: WeakSet<object>,
  visiting: WeakSet<object>,
  done: WeakSet<object>,
): boolean {
  if (value === null || typeof value !== "object") return false;
  if (copySetHas(bearing, value)) return true;
  if (copySetHas(done, value)) return false;
  // Preserve the original conservative classification of cycles.
  if (copySetHas(visiting, value)) return true;
  if (routingCopyGetPrototypeOf(value) === routingCopyBytesPrototype) {
    copySetAdd(bearing, value);
    return true;
  }
  copySetAdd(visiting, value);
  let found = false;
  const children = routingCopyValues(value);
  for (let index = 0; index < children.length; index++) {
    if (markBytesBearing(children[index], bearing, visiting, done)) found = true;
  }
  copySetDelete(visiting, value);
  if (found) copySetAdd(bearing, value);
  else copySetAdd(done, value);
  return found;
}

function freshBytesSpine<T>(value: T, bearing: WeakSet<object>, copies: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== "object" || !copySetHas(bearing, value)) return value;
  const prior = copyMapGet(copies, value);
  if (prior !== undefined) return prior as T;
  if (routingCopyGetPrototypeOf(value) === routingCopyBytesPrototype) {
    const bytes = new routingCopyBytes(value as unknown as Uint8Array);
    copyMapSet(copies, value, bytes);
    return bytes as T;
  }
  const output = routingCopyIsArray(value)
    ? new routingCopyArray((value as unknown[]).length)
    : routingCopyCreate(routingCopyGetPrototypeOf(value)) as Record<string, unknown>;
  copyMapSet(copies, value, output);
  const entries = routingCopyEntries(value);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    routingCopyDefineProperty(output, entry[0], {
      __proto__: null,
      value: freshBytesSpine(entry[1], bearing, copies),
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }
  return routingCopyFreeze(output) as T;
}

type VersionedRoutingCopy = {
  readonly version: unknown;
  readonly copy: unknown;
  readonly bytesBearing: WeakSet<object>;
  readonly qualified: boolean;
};

/** Create once per browser scope-module instance. The getter remains the sole
 * cache key; the exact producer pair qualifies only a newly constructed base. */
export function createVersionedRoutingTableReader(): (
  routingTable: () => unknown,
  routingTableVersion: () => number,
) => unknown {
  // IDENTITY-KEYED: this relocates the existing scope-module-lifetime cache.
  const versionedRoutingCopies = new routingCopyWeakMap<object, VersionedRoutingCopy>();
  return (routingTable, routingTableVersion) => {
    const version = routingTableVersion();
    let entry = copyMapGet(versionedRoutingCopies, routingTable);
    if (entry === undefined || !routingCopyIs(entry.version, version)) {
      const current = routingTable();
      if (current === null || typeof current !== "object") return current;
      const copy = cloneRoutingNode(current, new routingCopyWeakMap());
      const bytesBearing = new routingCopyWeakSet<object>();
      markBytesBearing(copy, bytesBearing, new routingCopyWeakSet(), new routingCopyWeakSet());
      entry = { version, copy, bytesBearing, qualified: completedProducer(routingTable, routingTableVersion, current) };
      copyMapSet(versionedRoutingCopies, routingTable, entry);
    }
    const output = freshBytesSpine(entry.copy, entry.bytesBearing, new routingCopyWeakMap());
    if (entry.qualified && output !== null && typeof output === "object") copySetAdd(completedRoutingCopies, output);
    return output;
  };
}
