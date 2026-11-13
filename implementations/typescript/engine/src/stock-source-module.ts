import { carryCanonicalLoadedModuleOrigin } from "./owner-input-provenance";
// BOUNDARY-ADAPTER
import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
} from "./self-host-immutable-data";
import {
  getLoadedFunctionSignatureDeclaration,
  registerLoadedFunctionSignatureDeclaration,
} from "./signature-declaration-transport";
import type {
  FenelFunction,
  FenelModule,
  FunctionSignatureDeclaration,
} from "./types";

const nativeTableKeys = new Set<PropertyKey>([
  "nativeImpls", "nativeImplsCtx", "ioHandlers",
]);

type SourceData = {
  module: FenelModule;
  loadedDeclarations: Array<{
    fn: FenelFunction;
    declaration: FunctionSignatureDeclaration;
  }>;
};

type NativeTableProperty = {
  readonly key: PropertyKey;
  readonly enumerable: boolean;
  readonly value: object | undefined;
};

type CapturedSource =
  | {
      readonly status: "ok";
      readonly data: SourceData;
      readonly nativeTables: readonly NativeTableProperty[];
    }
  | { readonly status: "uncacheable"; readonly reason: string };

// Exact source-object provenance, captured before its rows enter the shared
// dispatch pool. A failed capture is permanent too: observing the same source
// object later must never turn a mutated global alias into a stock baseline.
const capturedSources = new WeakMap<FenelModule, CapturedSource>();

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const setBytes = Uint8Array.prototype.set;

/** Descriptor-only graph copy. The initial copy separates root native tables;
 * exactImmutableDataSnapshot then validates and freezes all remaining data.
 * Copying the trusted snapshot again gives registry normalization fresh mutable
 * objects while retaining non-enumerable data, aliases, cycles and prototypes. */
function copyOwnGraph<T>(
  value: T,
  copies = new Map<object, object>(),
  sourceModule?: FenelModule,
  immutable = false,
): T {
  if (typeof value === "function") throw new TypeError("source data contains a function");
  if (value === null || typeof value !== "object") return value;
  const sourceObject: object | undefined = sourceModule;
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  const bytes = prototype === Uint8Array.prototype
    && Reflect.apply(typedArrayTag, value, []) === "Uint8Array";
  if ((!array && !bytes && prototype !== Object.prototype && prototype !== null)
    || (array && prototype !== Array.prototype)) {
    throw new TypeError("source data has an exotic prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = bytes ? Reflect.apply(typedArrayLength, value, []) as number : undefined;
  const copy: object = bytes
    ? new Uint8Array(length!)
    : array
    ? new Array((Reflect.get(descriptors, "length") as PropertyDescriptor).value)
    : Object.create(prototype) as object;
  copies.set(value, copy);
  if (bytes) Reflect.apply(setBytes, copy, [value]);
  for (const key of Reflect.ownKeys(descriptors)) {
    if ((array && key === "length") || (value === sourceObject && nativeTableKeys.has(key))) continue;
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!("value" in descriptor)) throw new TypeError("source data contains an accessor");
    if (bytes && typeof key === "string" && String(Number(key)) === key
      && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < length!) continue;
    Object.defineProperty(copy, key, {
      value: copyOwnGraph(descriptor.value, copies, sourceModule, immutable),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true,
    });
  }
  // Non-empty typed arrays cannot be frozen. Their private buffers remain
  // unreachable: every module/class egress takes a fresh intrinsic byte copy.
  return (immutable && !bytes ? Object.freeze(copy) : copy) as T;
}

/** Private source-template snapshot. Ordinary compiler data retains the strict
 * shared snapshot contract; source-owned Uint8Array exemplars alone use this
 * boundary's intrinsic byte-copy mode. No private byte buffer is exposed. */
export function snapshotStockSourceData<T>(value: T): T {
  const snapshot = exactImmutableDataSnapshot(value);
  return snapshot.status === "ok" ? snapshot.value : copyOwnGraph(value, new Map(), undefined, true);
}

/** Fresh writable source data, including fresh byte buffers at every egress. */
export function cloneStockSourceData<T>(value: T): T {
  return copyOwnGraph(value);
}

function copyNativeTable(
  value: unknown,
  copies: Map<object, object>,
): object | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("native bindings must be own-data tables");
  }
  const prior = copies.get(value);
  if (prior !== undefined) return prior;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("native bindings have an exotic prototype");
  }
  const copy = Object.create(prototype) as object;
  copies.set(value, copy);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError("native bindings must contain own function data only");
    }
    Object.defineProperty(copy, key, {
      value: descriptor.value,
      enumerable: descriptor.enumerable,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(copy);
}

function sourceLoadedDeclarations(sourceDefinition: FenelModule): SourceData["loadedDeclarations"] {
  const declarations: SourceData["loadedDeclarations"] = [];
  const functions = Object.getOwnPropertyDescriptor(sourceDefinition, "functions");
  if (functions === undefined || !("value" in functions) || !Array.isArray(functions.value)) {
    return declarations;
  }
  const descriptors = Object.getOwnPropertyDescriptors(functions.value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") continue;
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!("value" in descriptor) || descriptor.value === null || typeof descriptor.value !== "object") continue;
    const fn = descriptor.value as FenelFunction;
    const declaration = getLoadedFunctionSignatureDeclaration(fn);
    if (declaration !== undefined) declarations.push({ fn, declaration });
  }
  return declarations;
}

/** Record original source data before shared-pool publication. Capturing an
 * unsupported source records a refusal without disrupting ordinary boot. */
export function rememberStockModuleSource(sourceDefinition: FenelModule): void {
  if (capturedSources.has(sourceDefinition)) return;
  try {
    const nativeTables: NativeTableProperty[] = [];
    const copies = new Map<object, object>();
    for (const key of nativeTableKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(sourceDefinition, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) throw new TypeError("native binding table is an accessor");
      nativeTables.push(Object.freeze({
        key,
        enumerable: descriptor.enumerable === true,
        value: copyNativeTable(descriptor.value, copies),
      }));
    }
    const input: SourceData = {
      module: sourceDefinition,
      loadedDeclarations: sourceLoadedDeclarations(sourceDefinition),
    };
    const data = snapshotStockSourceData(copyOwnGraph(input, new Map(), sourceDefinition));
    capturedSources.set(sourceDefinition, {
      status: "ok", data, nativeTables: Object.freeze(nativeTables),
    });
  } catch (error) {
    capturedSources.set(sourceDefinition, {
      status: "uncacheable",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function isolatedSourceData(sourceDefinition: FenelModule): {
  data: SourceData;
  nativeTables: readonly NativeTableProperty[];
} {
  // The fixed harness roster contains two kinds of source: shared-pool owners
  // remembered before publication, and source-only definitions never published
  // there. Only the latter reach this first-use capture. This API is private to
  // that roster; it does not certify arbitrary exported JavaScript mutations.
  if (!capturedSources.has(sourceDefinition)) rememberStockModuleSource(sourceDefinition);
  const captured = capturedSources.get(sourceDefinition)!;
  if (captured.status !== "ok") {
    throw new TypeError(`stock source module cannot be isolated: ${captured.reason}`);
  }
  const data = cloneStockSourceData(captured.data);
  for (const entry of data.loadedDeclarations) {
    registerLoadedFunctionSignatureDeclaration(entry.fn, entry.declaration);
  }
  return { data, nativeTables: captured.nativeTables };
}

/** Fresh isolated source data, without host binding tables. Materialize loader
 * declarations as source data here so another graph snapshot (class provenance)
 * retains them after exact function-object associations have been copied away. */
export function stockSourceModuleData(sourceDefinition: FenelModule): FenelModule {
  const { data } = isolatedSourceData(sourceDefinition);
  const slot = Object.getOwnPropertyDescriptor(data.module, "functionSignatureDeclarations");
  const observed = slot !== undefined && "value" in slot ? slot.value : undefined;
  if (observed !== undefined && !Array.isArray(observed)) {
    throw new TypeError("stock source module has no declaration data roster");
  }
  const declarations: FunctionSignatureDeclaration[] = observed ?? [];
  const byId = new Map<string, FunctionSignatureDeclaration>();
  const include = (declaration: FunctionSignatureDeclaration, append: boolean): void => {
    const id = Object.getOwnPropertyDescriptor(declaration, "functionId");
    if (id === undefined || !("value" in id) || typeof id.value !== "string" || id.value.length === 0) {
      throw new TypeError("stock source declaration has no exact function id");
    }
    const prior = byId.get(id.value);
    if (prior !== undefined && !exactImmutableDataEqual(prior, declaration)) {
      throw new TypeError(`stock source declaration contradicts ${id.value}`);
    }
    if (prior === undefined) {
      byId.set(id.value, declaration);
      if (append) declarations.push(declaration);
    }
  };
  for (const declaration of declarations) include(declaration, false);
  for (const entry of data.loadedDeclarations) include(entry.declaration, true);
  Object.defineProperty(data.module, "functionSignatureDeclarations", {
    value: declarations,
    enumerable: slot?.enumerable ?? true,
    configurable: true,
    writable: true,
  });
  carryCanonicalLoadedModuleOrigin(sourceDefinition, data.module);
  return data.module;
}

/** Fresh isolated source data and own frozen native-pointer tables for the
 * fixed harness roster. Known failed pre-publication captures always refuse. */
export function stockSourceModule(sourceDefinition: FenelModule): FenelModule {
  const { data, nativeTables } = isolatedSourceData(sourceDefinition);
  const copies = new Map<object, object>();
  for (const property of nativeTables) {
    Object.defineProperty(data.module, property.key, {
      value: copyNativeTable(property.value, copies),
      enumerable: property.enumerable,
      configurable: true,
      writable: true,
    });
  }
  carryCanonicalLoadedModuleOrigin(sourceDefinition, data.module);
  return data.module;
}
