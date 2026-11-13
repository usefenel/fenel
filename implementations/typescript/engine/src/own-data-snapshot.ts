// BOUNDARY-ADAPTER
/** Import-free B3 host-data core shared with the compiler snapshot wrapper.
 * Ordinary source provenance uses no compiler capability. The existing compiler
 * wrapper supplies its original private capability predicates in the same order.
 */
export type ExactOwnDataSnapshot<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "uncacheable"; readonly reason: string };
export type PreservedDataCapabilities = Readonly<{
  table(value: object): boolean;
  list(value: object): boolean;
}>;
// Approved A2/B3 host-data boundary: trusted native host operations at module initialization.
// Captured host operations cannot publish the invocation-private descriptor,
// path stack or clone map through later replacement of global intrinsics.
const snapshotObjectPrototype = Object.prototype;
const snapshotArrayPrototype = Array.prototype;
const SnapshotArray = Array;
const SnapshotMap = Map;
const SnapshotError = Error;
const snapshotIsArray = Array.isArray;
const snapshotGetPrototypeOf = Object.getPrototypeOf;
const snapshotGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const snapshotCreate = Object.create;
const snapshotDefineProperty = Object.defineProperty;
const snapshotFreeze = Object.freeze;
const snapshotHasOwn = Object.hasOwn;
const snapshotHasOwnProperty = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty) as
  (object: object, key: PropertyKey) => boolean;
const snapshotOwnKeys = Reflect.ownKeys;
const snapshotGet = Reflect.get;
const snapshotIsSafeInteger = Number.isSafeInteger;
const snapshotStringify = JSON.stringify;
const SnapshotString = String;
const snapshotMapGet = Map.prototype.get.call.bind(Map.prototype.get) as
  (map: Map<object, object>, key: object) => object | undefined;
const snapshotMapSet = Map.prototype.set.call.bind(Map.prototype.set) as
  (map: Map<object, object>, key: object, value: object) => Map<object, object>;
class UncacheableImmutableData extends Error {}

// One invocation owns this scratch and its clone map; no caller can observe them.
// The comparator below intentionally retains its original implementation.
type SnapshotScratch = {
  definition: PropertyDescriptor;
  path: Record<number, PropertyKey>;
};
function snapshotPath(scratch: SnapshotScratch, depth: number, tail?: PropertyKey): string {
  let result = "$input";
  const append = (key: PropertyKey) => { result += `[${typeof key === "symbol" ? SnapshotString(key) : snapshotStringify(key)}]`; };
  for (let index = 0; index < depth; index++) append(scratch.path[index]!);
  if (tail !== undefined) append(tail);
  return result;
}
function cloneImmutableData(value: unknown, clones: Map<object, object>, depth: number,
  capabilities: PreservedDataCapabilities | undefined, scratch: SnapshotScratch): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") throw new UncacheableImmutableData(`${snapshotPath(scratch, depth)} contains a function`);
    return value;
  }
  if (capabilities !== undefined && (capabilities.table(value) || capabilities.list(value))) return value;
  const prior = snapshotMapGet(clones, value);
  if (prior !== undefined) return prior;
  const isArray = snapshotIsArray(value);
  const prototype = snapshotGetPrototypeOf(value);
  if ((!isArray && prototype !== snapshotObjectPrototype && prototype !== null)
    || (isArray && prototype !== snapshotArrayPrototype)) throw new UncacheableImmutableData(`${snapshotPath(scratch, depth)} has an exotic prototype`);
  const descriptors = snapshotGetOwnPropertyDescriptors(value);
  let clone: object;
  if (isArray) {
    const lengthDescriptor = snapshotHasOwnProperty(descriptors, "length")
      ? snapshotGet(descriptors, "length") as PropertyDescriptor : undefined;
    const length = lengthDescriptor !== undefined && snapshotHasOwn(lengthDescriptor, "value") ? lengthDescriptor.value : undefined;
    if (!snapshotIsSafeInteger(length) || (length as number) < 0) throw new UncacheableImmutableData(`${snapshotPath(scratch, depth)} has no exact array length`);
    clone = new SnapshotArray(length as number);
  } else clone = snapshotCreate(prototype) as object;
  snapshotMapSet(clones, value, clone);
  // A numeric loop avoids a replaceable Array iterator receiving private data.
  const keys = snapshotOwnKeys(descriptors);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (isArray && key === "length") continue;
    const descriptor = snapshotGet(descriptors, key) as PropertyDescriptor;
    if (!snapshotHasOwn(descriptor, "value")) throw new UncacheableImmutableData(
      `${snapshotPath(scratch, depth, key)} is an accessor`);
    scratch.path[depth] = key;
    // Formatting reads only active ancestor depths; deeper slots are overwritten.
    const copied = cloneImmutableData(descriptor.value, clones, depth + 1, capabilities, scratch);
    const definition = scratch.definition;
    definition.value = copied;
    definition.enumerable = descriptor.enumerable;
    try { snapshotDefineProperty(clone, key, definition); }
    finally { definition.value = undefined; }
  }
  return snapshotFreeze(clone);
}

export function exactOwnDataSnapshot<T>(value: T,
  capabilities?: PreservedDataCapabilities): ExactOwnDataSnapshot<T> {
  try {
    const definition = snapshotCreate(null) as PropertyDescriptor;
    definition.value = undefined;
    definition.enumerable = true;
    definition.configurable = true;
    definition.writable = true;
    const scratch: SnapshotScratch = { definition, path: snapshotCreate(null) as Record<number, PropertyKey> };
    return { status: "ok", value: cloneImmutableData(value, new SnapshotMap(), 0, capabilities, scratch) as T };
  }
  catch (error) {
    if (error instanceof UncacheableImmutableData) return { status: "uncacheable", reason: error.message };
    return { status: "uncacheable", reason: error instanceof SnapshotError ? error.message : SnapshotString(error) };
  }
}

function ownKeysEqual(left: readonly PropertyKey[], right: readonly PropertyKey[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (!Object.is(left[index], right[index])) return false;
  return true;
}

export function exactOwnDataEqual(left: unknown, right: unknown,
  capabilities?: PreservedDataCapabilities): boolean {
  if (Object.is(left, right)) return true;
  const leftToRight = new Map<object, object>();
  const rightToLeft = new Map<object, object>();
  const equal = (a: unknown, b: unknown): boolean => {
    const identical = Object.is(a, b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return identical;
    if (capabilities !== undefined && (capabilities.table(a) || capabilities.table(b)
      || capabilities.list(a) || capabilities.list(b))) return identical;
    const priorRight = leftToRight.get(a);
    if (priorRight !== undefined) return priorRight === b;
    const priorLeft = rightToLeft.get(b);
    if (priorLeft !== undefined) return priorLeft === a;
    if (!identical) {
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    }
    leftToRight.set(a, b);
    rightToLeft.set(b, a);
    // Shared ordinary subtrees still constrain the complete graph bijection.
    // Inspect their own data descendants once; only root identity skips observation.
    const aDescriptors = Object.getOwnPropertyDescriptors(a);
    const bDescriptors = identical ? aDescriptors : Object.getOwnPropertyDescriptors(b);
    const aKeys = Reflect.ownKeys(aDescriptors);
    const bKeys = identical ? aKeys : Reflect.ownKeys(bDescriptors);
    if (!ownKeysEqual(aKeys, bKeys)) return false;
    for (const key of aKeys) {
      const aDescriptor = Reflect.get(aDescriptors, key) as PropertyDescriptor;
      const bDescriptor = Reflect.get(bDescriptors, key) as PropertyDescriptor;
      if (!Object.hasOwn(aDescriptor, "value") || !Object.hasOwn(bDescriptor, "value")) {
        if (identical) continue;
        return false;
      }
      if (aDescriptor.enumerable !== bDescriptor.enumerable || !equal(aDescriptor.value, bDescriptor.value)) return false;
    }
    return true;
  };
  return equal(left, right);
}
