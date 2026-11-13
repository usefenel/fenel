import type { ModuleRegistry } from "@fenel/engine/registry";
import type { EvaluateContext } from "@fenel/engine";
import { createVersionedRoutingTableReader } from "@fenel/engine/routing-copy";

// Preserve one getter/version copy cache per scope-module instance, shared by
// its otherwise distinct per-context routing wrappers.
const versionedRoutingTableRead = createVersionedRoutingTableReader();

export type DeclaringModuleResolution =
  | { readonly status: "resolved"; readonly moduleName: string }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly moduleNames: readonly string[] };

export type AuthoringSessionScope =
  | { readonly mode: "module"; readonly sourceModule: string }
  | { readonly mode: "detached" };

export type DetachedAuthoringEntry = {
  readonly id: string;
  readonly targetId?: string;
  readonly kind?: string;
  readonly notation?: string;
  readonly parentModule?: string;
  readonly codeName?: string;
};

export type DetachedAuthoringRoute = {
  readonly sourceName: string;
  readonly status: "resolved" | "fenced" | "missing" | "ambiguous";
  readonly entry?: DetachedAuthoringEntry;
};

function ownDataValue<T>(source: object, key: string, context: string): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`${context}: accessor property ${JSON.stringify(key)} is not allowed`);
  }
  return descriptor.value as T;
}

function frozenNullPrototypeFunctions<T extends (...args: never[]) => unknown>(
  context: string,
  ...sources: Array<Record<string, T> | undefined>
): Record<string, T> {
  const output = Object.create(null) as Record<string, T>;
  const implementations = new Map<string, T>();
  for (const source of sources) {
    if (source === undefined) continue;
    for (const key of Object.keys(source)) {
      const value = ownDataValue<unknown>(source, key, context);
      if (typeof value !== "function") {
        throw new TypeError(`${context}.${key}: native implementation must be a function`);
      }
      implementations.set(key, value as T);
    }
  }
  for (const [key, value] of implementations) {
    Object.defineProperty(output, key, {
      __proto__: null,
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }
  return Object.freeze(output);
}

function containsBrowserBytes(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return true;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, "value") && containsBrowserBytes(descriptor.value, seen)) return true;
  }
  return false;
}

/** `sourceFrozen` is cleared when any copied source node is not frozen. A
 * frozen object's own data slots can never change again, so a copy taken
 * from a graph whose every node was frozen stays faithful for the lifetime
 * of the source object. */
type BrowserAuthorityCopyState = { sourceFrozen: boolean };

function cloneFrozenBrowserAuthority<T>(
  value: T,
  copies = new WeakMap<object, unknown>(),
  state?: BrowserAuthorityCopyState,
): T {
  if (value === null || typeof value !== "object") return value;
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;
  if (state !== undefined && !Object.isFrozen(value)) state.sourceFrozen = false;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const bytes = new Uint8Array(value as unknown as Uint8Array);
    copies.set(value, bytes);
    return bytes as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("browser evaluator authority must be plain transport data");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("browser evaluator authority must not contain symbol properties");
  }
  const output = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype) as Record<string, unknown>;
  copies.set(value, output);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `browser evaluator authority: accessor property ${JSON.stringify(key)} is not allowed`,
      );
    }
    if (!descriptor.enumerable) continue;
    Object.defineProperty(output, key, {
      __proto__: null,
      value: cloneFrozenBrowserAuthority(descriptor.value, copies, state),
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }
  return Object.freeze(output) as T;
}

/** Snapshots of source graphs that were deep-frozen when copied, shared by
 * every browser context (perf 2026-10-30: the registry's routing table and
 * dispatch rows were re-cloned per merged context and per listing call).
 * Sound because a deep-frozen source cannot change after the copy, and the
 * snapshot is itself a deep-frozen plain copy: it exposes no source object
 * and no Proxy trap, whichever context reads it. A source with any unfrozen
 * node stays in its own context's cache, exactly as before. */
const deepFrozenSourceSnapshots = new WeakMap<object, unknown>();

function browserAuthorityEgress<T>(
  value: T,
  snapshots: WeakMap<object, unknown>,
): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  // Typed arrays cannot be frozen. Never cache their containing graph: each
  // read gets a fresh copy so a consumer can mutate only its own value.
  if (typeof value === "function") return value;
  const shared = deepFrozenSourceSnapshots.get(value);
  if (shared !== undefined) return shared as T;
  const prior = snapshots.get(value);
  if (prior !== undefined) return prior as T;
  if (containsBrowserBytes(value)) return cloneFrozenBrowserAuthority(value);
  const state: BrowserAuthorityCopyState = { sourceFrozen: true };
  const snapshot = cloneFrozenBrowserAuthority(value, new WeakMap(), state);
  (state.sourceFrozen ? deepFrozenSourceSnapshots : snapshots).set(value, snapshot);
  return snapshot;
}

/** One listing family's retained copies: a frozen copy per Bytes-free source
 * node, and each source node's Bytes verdict. */
type ListingCopies = {
  readonly persistent: WeakMap<object, unknown>;
  bytes: WeakMap<object, boolean>;
};

function listingCopies(): ListingCopies {
  return { persistent: new WeakMap(), bytes: new WeakMap() };
}

/** `containsBrowserBytes`, memoized per source node. A cycle back into a node
 * still being walked counts as Bytes, so a node is retained only when it
 * provably reaches no Bytes leaf. */
function sourceReachesBytes(
  value: object,
  memo: WeakMap<object, boolean>,
  visiting: WeakSet<object>,
): boolean {
  const known = memo.get(value);
  if (known !== undefined) return known;
  if (visiting.has(value)) return true;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    memo.set(value, true);
    return true;
  }
  visiting.add(value);
  let found = false;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, "value") && descriptor.value !== null && typeof descriptor.value === "object"
      && sourceReachesBytes(descriptor.value, memo, visiting)) found = true;
  }
  visiting.delete(value);
  memo.set(value, found);
  return found;
}

/** `cloneFrozenBrowserAuthority` for one listing call: the same admission and
 * output shape, and still exactly one output node per source node within the
 * call (so the aliasing the catalogue fingerprint's pool digest encodes is
 * unchanged). A Bytes-free source node reuses its retained copy from earlier
 * calls; its new copies are staged and retained only once the whole call has
 * succeeded, so a refused listing never leaves a partial copy behind.
 *
 * Premise (not checked here): a listed source row is never changed in place.
 * The registry adds and removes whole rows (a live bucket grows or shrinks,
 * which the per-call array reflects), but a retained copy is keyed by the
 * source node's identity, so an in-place edit of a row or of a node under it
 * would keep serving the old copy. The rows are not frozen, so retaining
 * only frozen sources would give up the reuse entirely. */
function cloneListingNode<T>(
  value: T,
  copies: ListingCopies,
  call: WeakMap<object, unknown>,
  staged: Array<readonly [object, unknown]>,
): T {
  if (value === null || typeof value !== "object") return value;
  const retained = copies.persistent.get(value);
  if (retained !== undefined) return retained as T;
  const prior = call.get(value);
  if (prior !== undefined) return prior as T;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) {
    const bytes = new Uint8Array(value as unknown as Uint8Array);
    call.set(value, bytes);
    return bytes as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("browser evaluator authority must be plain transport data");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("browser evaluator authority must not contain symbol properties");
  }
  const output = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype) as Record<string, unknown>;
  call.set(value, output);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `browser evaluator authority: accessor property ${JSON.stringify(key)} is not allowed`,
      );
    }
    if (!descriptor.enumerable) continue;
    Object.defineProperty(output, key, {
      __proto__: null,
      value: cloneListingNode(descriptor.value, copies, call, staged),
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }
  Object.freeze(output);
  if (!sourceReachesBytes(value, copies.bytes, new WeakSet())) staged.push([value, output]);
  return output as T;
}

/** Listing results (`listInstances`, `listClasses`, ...) are fresh arrays per
 * call, and `listInstances(typeName)` can even be the registry's own live
 * bucket, which `addInstance` grows in place. Caching the array by identity
 * therefore both missed on every call (a full deep clone of every row) and
 * could serve a stale bucket. The array is now copied afresh per call (it
 * reflects the source's current membership), while its Bytes-free rows and
 * their nodes keep their retained frozen copies (`cloneListingNode`). */
function browserAuthorityRowsEgress<T>(
  value: T,
  snapshots: WeakMap<object, unknown>,
  copies: ListingCopies,
): T {
  if (!Array.isArray(value)) return browserAuthorityEgress(value, snapshots);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("browser evaluator authority must not contain symbol properties");
  }
  const call = new WeakMap<object, unknown>();
  const staged: Array<readonly [object, unknown]> = [];
  const output = new Array(value.length);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  try {
    for (const key of Object.keys(descriptors)) {
      if (key === "length") continue;
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError(
          `browser evaluator authority: accessor property ${JSON.stringify(key)} is not allowed`,
        );
      }
      if (!descriptor.enumerable) continue;
      Object.defineProperty(output, key, {
        __proto__: null,
        value: cloneListingNode(descriptor.value, copies, call, staged),
        enumerable: true,
        configurable: false,
        writable: false,
      } as PropertyDescriptor);
    }
  } catch (error) {
    // Bytes verdicts from refused rows are speculative too. Keep successful
    // frozen snapshots, but re-inspect Bytes if the refused data is repaired.
    copies.bytes = new WeakMap();
    throw error;
  }
  for (const [source, copy] of staged) copies.persistent.set(source, copy);
  return Object.freeze(output) as T;
}

type BrowserDispatchRegistry = NonNullable<EvaluateContext["_specRegistry"]>;

function readonlyDispatchRegistry(source: BrowserDispatchRegistry): BrowserDispatchRegistry {
  const snapshots = new WeakMap<object, unknown>();
  const egress = <T>(value: T): T => browserAuthorityEgress(value, snapshots);
  // Separate families, as separate calls never shared copies before: a pool
  // digest over `listClasses()` beside `listInstances()` must not gain
  // aliasing between a class and a row.
  const instanceCopies = listingCopies();
  const classCopies = listingCopies();
  const egressInstances = <T>(value: T): T => browserAuthorityRowsEgress(value, snapshots, instanceCopies);
  const egressClasses = <T>(value: T): T => browserAuthorityRowsEgress(value, snapshots, classCopies);
  const deny = (): never => {
    throw new TypeError("browser evaluator dispatch registry is read-only");
  };
  // ⚠ rights R3a — THE THIRD ARGUMENT IS NOW A VISIBILITY, NOT A FILTER, and
  // this facade is the one place in the tree that already passed a third
  // argument (§12 trap 31). The old `wrapFilter` existed to egress-wrap the
  // instance handed to a caller-supplied PREDICATE; a visibility is plain data,
  // so there is nothing to wrap — it is FORWARDED verbatim. Handing the old
  // filter in the visibility slot would have been the silent version of this
  // change, which is why the trap names it.
  return Object.freeze({
    defineClass: deny,
    addInstance: deny,
    registerValue: deny,
    removeInstancesOwnedBy: deny,
    removeInstance: deny,
    getClass: (name: string) => egress(source.getClass(name)),
    satisfies: (...args: Parameters<BrowserDispatchRegistry["satisfies"]>) =>
      source.satisfies(...args),
    resolve: (type, typeName, visibility) =>
      egress(source.resolve(type, typeName, visibility)),
    listMatchingInstances: (type, typeName, visibility) =>
      egressInstances(source.listMatchingInstances(type, typeName, visibility)),
    listClasses: () => egressClasses(source.listClasses()),
    listInstances: (typeName?: string) => egressInstances(source.listInstances(typeName)),
    implementedBy: (...args: Parameters<BrowserDispatchRegistry["implementedBy"]>) =>
      egressClasses(source.implementedBy(...args)),
    version: () => source.version(),
  }) as BrowserDispatchRegistry;
}

function immutableSetSnapshot<T>(source: ReadonlySet<T>): ReadonlySet<T> {
  const data = new Set(source);
  let view: ReadonlySet<T>;
  view = Object.freeze({
    size: data.size,
    has: (value: T) => data.has(value),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: T, key: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) => data.forEach((value) => callback.call(thisArg, value, value, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlySet<T>;
  return view;
}

function immutableMapSnapshot<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const data = new Map(source);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    size: data.size,
    has: (key: K) => data.has(key),
    get: (key: K) => data.get(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) => data.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlyMap<K, V>;
  return view;
}

export function detachedAuthoringIdentities(
  functions: readonly DetachedAuthoringEntry[],
  patternConstructors: readonly DetachedAuthoringEntry[] = [],
  functionRoutes: readonly DetachedAuthoringRoute[] = [],
): {
  readonly functions: ReadonlySet<string>;
  readonly constructors: ReadonlySet<string>;
  readonly operatorAliases: ReadonlySet<string>;
} {
  const exactFunctions = new Set<string>();
  const exactConstructors = new Set<string>();
  const operatorAliases = new Set<string>();
  const admittedFunctionIds = new Set(functions.filter((entry) => entry.kind === "function").map((entry) => entry.id));
  for (const entry of functions) {
    const target = entry.targetId ?? entry.id;
    if (entry.kind === "constructor") {
      exactConstructors.add(target);
      if (entry.parentModule !== undefined) {
        const member = entry.codeName ?? (entry.targetId === undefined ? entry.id : undefined);
        if (member !== undefined) exactConstructors.add(`${entry.parentModule}.${member}`);
      }
    } else {
      exactFunctions.add(target);
      if (entry.parentModule !== undefined && entry.codeName !== undefined) {
        exactFunctions.add(`${entry.parentModule}.${entry.codeName}`);
      }
    }
    if (entry.notation !== undefined) operatorAliases.add(entry.id);
  }
  for (const entry of patternConstructors) {
    exactConstructors.add(entry.targetId ?? entry.id);
    if (entry.parentModule !== undefined) {
      const member = entry.codeName ?? entry.id;
      exactConstructors.add(`${entry.parentModule}.${member}`);
    }
  }
  for (const route of functionRoutes) {
    if (route.status === "resolved"
      && route.entry?.kind === "function"
      && admittedFunctionIds.has(route.entry.id)
      && route.sourceName === route.entry.targetId
      // B3: decode the physical UUID carrier of a registry-proven identity
      // projection; source spellings remain subject to the scoped route below.
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.sourceName)) {
      exactFunctions.add(route.sourceName);
    }
    const parentModule = route.entry?.parentModule;
    if (
      parentModule !== undefined
      && (route.status === "resolved" || route.status === "fenced")
      && route.sourceName.startsWith(`${parentModule}.`)
    ) {
      exactFunctions.add(route.sourceName);
    }
  }
  return {
    functions: exactFunctions,
    constructors: exactConstructors,
    operatorAliases,
  };
}

export function mergeBrowserEvaluateContext(
  registryContext: EvaluateContext,
  nativeOverrides: NonNullable<EvaluateContext["natives"]>,
  nativeContextOverrides: NonNullable<EvaluateContext["nativesCtx"]>,
): EvaluateContext {
  const output = Object.create(null) as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(registryContext);
  const staticRecords = new Set([
    "_constructors",
    "_constructorWireNames",
    "_ctorFieldKeys",
    // type-substrate P1(a.20) — the registry's field UUID → current-wire index.
    // It MUST be in this set rather than passed through by reference: a
    // pass-through would enter the browser context unfrozen, and an authority
    // a reader cannot prove immutable is not an authority it may certify
    // against.
    "_fieldCurrentWire",
    "_sampleByTag",
    "_renderByTag",
    "_caseOwner",
    "_dictStack",
    "_activeTags",
    "_localData",
    "_importStack",
  ]);
  for (const key of Object.keys(descriptors)) {
    if (
      key === "natives"
      || key === "nativesCtx"
      || key === "_patternPlans"
      || key === "_moduleNames"
      || key === "_uuidBySlug"
      || key === "_routingTable"
      || key === "_specRegistry"
      || key === "getFunction"
      || key === "getFunctionSignatureInfo"
      || key === "_resolveBareName"
    ) continue;
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `browser evaluator context: accessor property ${JSON.stringify(key)} is not allowed`,
      );
    }
    const value = staticRecords.has(key)
      ? cloneFrozenBrowserAuthority(descriptor.value)
      : descriptor.value;
    Object.defineProperty(output, key, {
      __proto__: null,
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    } as PropertyDescriptor);
  }

  const baseNatives = ownDataValue<EvaluateContext["natives"]>(
    registryContext,
    "natives",
    "browser evaluator context",
  );
  const baseNativesCtx = ownDataValue<EvaluateContext["nativesCtx"]>(
    registryContext,
    "nativesCtx",
    "browser evaluator context",
  );
  output.natives = frozenNullPrototypeFunctions(
    "browser evaluator natives",
    baseNatives,
    nativeOverrides,
  );
  output.nativesCtx = frozenNullPrototypeFunctions(
    "browser evaluator context natives",
    baseNativesCtx,
    nativeContextOverrides,
  );

  const resultSnapshots = new WeakMap<object, unknown>();
  const getFunction = ownDataValue<EvaluateContext["getFunction"]>(
    registryContext,
    "getFunction",
    "browser evaluator context",
  );
  if (getFunction !== undefined) {
    output.getFunction = (name: string) =>
      browserAuthorityEgress(getFunction(name), resultSnapshots);
  }
  const getFunctionSignatureInfo = ownDataValue<EvaluateContext["getFunctionSignatureInfo"]>(
    registryContext,
    "getFunctionSignatureInfo",
    "browser evaluator context",
  );
  if (getFunctionSignatureInfo !== undefined) {
    output.getFunctionSignatureInfo = (name: string) =>
      browserAuthorityEgress(getFunctionSignatureInfo(name), resultSnapshots);
  }
  const resolveBareName = ownDataValue<EvaluateContext["_resolveBareName"]>(
    registryContext,
    "_resolveBareName",
    "browser evaluator context",
  );
  if (resolveBareName !== undefined) {
    output._resolveBareName = (name: string) =>
      browserAuthorityEgress(resolveBareName(name), resultSnapshots);
  }
  const specRegistry = ownDataValue<EvaluateContext["_specRegistry"]>(
    registryContext,
    "_specRegistry",
    "browser evaluator context",
  );
  if (specRegistry !== undefined) output._specRegistry = readonlyDispatchRegistry(specRegistry);

  const moduleNames = ownDataValue<ReadonlySet<string>>(
    registryContext,
    "_moduleNames",
    "browser evaluator context",
  );
  if (moduleNames !== undefined) output._moduleNames = immutableSetSnapshot(moduleNames);
  const uuidBySlug = ownDataValue<ReadonlyMap<string, string>>(
    registryContext,
    "_uuidBySlug",
    "browser evaluator context",
  );
  if (uuidBySlug !== undefined) output._uuidBySlug = immutableMapSnapshot(uuidBySlug);

  const routingTable = ownDataValue<EvaluateContext["_routingTable"]>(
    registryContext,
    "_routingTable",
    "browser evaluator context",
  );
  if (routingTable !== undefined) {
    const snapshots = new WeakMap<object, unknown>();
    const routingTableVersion = ownDataValue<EvaluateContext["_routingTableVersion"]>(
      registryContext,
      "_routingTableVersion",
      "browser evaluator context",
    );
    output._routingTable = typeof routingTableVersion === "function"
      ? () => versionedRoutingTableRead(routingTable, routingTableVersion)
      // Without a version, every read asks the source: a deep-frozen table is
      // copied once for every context (`deepFrozenSourceSnapshots`), an
      // unfrozen one once per context, and a Bytes-bearing one per read.
      : () => browserAuthorityEgress(routingTable(), snapshots);
  }
  return Object.freeze(output) as EvaluateContext;
}

/** Resolve source ownership from frozen registry membership. Function ids are
 * opaque identities: in particular, a colon in an id never licenses ownership
 * inference by string splitting. */
export function declaringModuleForFunction(
  registry: Pick<ModuleRegistry, "modules">,
  functionId: string,
): DeclaringModuleResolution {
  const matches = registry.modules
    .filter((module) => (module.functions ?? []).some((fn) => fn.id === functionId))
    .map((module) => module.name);
  if (matches.length === 1) {
    const moduleName = matches[0]!;
    const containersWithName = registry.modules.filter((module) => module.name === moduleName);
    if (containersWithName.length === 1) return { status: "resolved", moduleName };
    return {
      status: "ambiguous",
      moduleNames: Object.freeze(containersWithName.map((module) => module.name)),
    };
  }
  if (matches.length === 0) return { status: "missing" };
  return { status: "ambiguous", moduleNames: Object.freeze([...matches]) };
}

export function authoringSessionScopeForFunction(
  registry: Pick<ModuleRegistry, "modules">,
  functionId: string,
): AuthoringSessionScope {
  const owner = declaringModuleForFunction(registry, functionId);
  return owner.status === "resolved"
    ? { mode: "module", sourceModule: owner.moduleName }
    : { mode: "detached" };
}
