// Import-free host transport shared by registry ingress and browser request capture.
// Existing own-data/native-slot admission; Fenel still owns every judgment.

/** Reuse the strict registry ingress copier for host metadata observations.
 * This public seam never permits executable transport leaves. Equality-bound
 * data keeps own-field order and refuses descriptors the copy would erase or
 * normalize from unreadable into readable; Fenel still owns every verdict.
 * A host data-property reader observes reactive overlays only after each
 * node's descriptors are admitted, without normalizing those carriers.
 * Value-read transport also retains exact native Date, ArrayBuffer and standard
 * binary-view leaves. It copies current data windows, not live shared memory. */
export function registryTransportSnapshot<T>(value: T, context: string, mode: "canonical" | "equality" | "value-read" = "canonical",
  readDataProperty?: (owner: object, key: string) => unknown): T {
  return cloneRegistryTransportValue(value, context, undefined, undefined, false,
    mode === "equality" || mode === "value-read", readDataProperty, mode === "value-read");
}

// B3 native-slot transport only. Capture host intrinsics once; instance methods
// and constructor/species projections must never participate in a data copy.
const registryValueReadDate = Date;
const registryValueReadDateValue = Date.prototype.getTime;
const registryValueReadArrayBuffer = ArrayBuffer;
const registryValueReadBufferSize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const registryValueReadBufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const registryValueReadBufferMaxSize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")?.get;
const registryValueReadBytes = Uint8Array;
const registryValueReadSetBytes = Uint8Array.prototype.set;
const registryValueReadTypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const registryValueReadViewBuffer = Object.getOwnPropertyDescriptor(registryValueReadTypedArrayPrototype, "buffer")!.get!;
const registryValueReadViewOffset = Object.getOwnPropertyDescriptor(registryValueReadTypedArrayPrototype, "byteOffset")!.get!;
const registryValueReadViewSize = Object.getOwnPropertyDescriptor(registryValueReadTypedArrayPrototype, "byteLength")!.get!;
const registryValueReadViewLength = Object.getOwnPropertyDescriptor(registryValueReadTypedArrayPrototype, "length")!.get!;
const registryValueReadViewKind = Object.getOwnPropertyDescriptor(registryValueReadTypedArrayPrototype, Symbol.toStringTag)!.get!;
const registryValueReadViewValues = Uint8Array.prototype.values;
const registryValueReadFloat16Array = typeof Float16Array === "function" ? Float16Array : undefined;
const registryValueReadTypedArrays = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
  ...(typeof registryValueReadFloat16Array === "function" ? [registryValueReadFloat16Array] : [])]
  .map(arrayType => ({ arrayType, prototype: arrayType.prototype, kind: arrayType.name }));
const registryValueReadDataView = DataView;
const registryValueReadDataBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer")!.get!;
const registryValueReadDataOffset = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset")!.get!;
const registryValueReadDataSize = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength")!.get!;
const registryValueReadSharedBuffer = typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : undefined;
const registryValueReadSharedSize = registryValueReadSharedBuffer
  ? Object.getOwnPropertyDescriptor(registryValueReadSharedBuffer.prototype, "byteLength")!.get! : undefined;

// Record construction defines own data through one captured intrinsic and one
// reused, fully specified, null-prototype descriptor: a definition never runs
// or consults an inherited setter (`__proto__` included), the descriptor reads
// no inherited `get`/`set`/`value` field, and no descriptor is allocated per
// property. Unlike `Object.create(null)` (or a later `setPrototypeOf`, whose
// maps V8 cannot share once frozen), an ordinary `{}` built this way stays in
// V8 fast mode, frozen or not, with one shared map per key sequence.
const registryTransportDefineOwnData = Object.defineProperty;
// Module-private and never exposed; `value` is set immediately before each
// definition (after the child copy has returned) and cleared after each record.
const registryTransportDataSlot = Object.setPrototypeOf({
  value: undefined as unknown, writable: true, enumerable: true, configurable: true,
}, null) as { value: unknown; writable: true; enumerable: true; configurable: true };

export function cloneRegistryTransportValue<T>(
  value: T,
  context: string,
  active = new WeakSet<object>(),
  copies = new WeakMap<object, unknown>(),
  allowExecutableLeaves = false,
  preserveEquality = false,
  readDataProperty?: (owner: object, key: string) => unknown,
  allowValueReadNativeLeaves = false,
): T {
  if (typeof value === "function") {
    if (allowExecutableLeaves) return value;
    throw new TypeError(`${context}: executable transport data is not allowed`);
  }
  if (typeof value === "symbol") {
    throw new TypeError(`${context}: symbol transport data is not allowed`);
  }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new TypeError(`${context}: cyclic transport data is not allowed`);
  const prior = copies.get(value);
  if (prior !== undefined) return prior as T;

  const prototype = Object.getPrototypeOf(value);
  if (allowValueReadNativeLeaves && (prototype === registryValueReadDate.prototype
    || prototype === registryValueReadArrayBuffer.prototype)) {
    if (Reflect.ownKeys(value).length !== 0) {
      throw new TypeError(`${context}: value-read native leaves cannot carry own properties`);
    }
    if (prototype === registryValueReadDate.prototype) {
      const out = new registryValueReadDate(registryValueReadDateValue.call(value));
      copies.set(value, out);
      return out as T;
    }
    const byteLength = registryValueReadBufferSize.call(value) as number;
    // Validate the native buffer's brand before constructing its view. A
    // detached buffer, including a zero-length one, must still refuse here.
    const source = new registryValueReadBytes(value as unknown as ArrayBuffer);
    const options = registryValueReadBufferResizable?.call(value) === true && registryValueReadBufferMaxSize
      ? { maxByteLength: registryValueReadBufferMaxSize.call(value) as number } : undefined;
    const out = new registryValueReadArrayBuffer(byteLength, options);
    registryValueReadSetBytes.call(new registryValueReadBytes(out), source);
    copies.set(value, out);
    return out as T;
  }
  const view = allowValueReadNativeLeaves
    ? registryValueReadTypedArrays.find(candidate => prototype === candidate.prototype) : undefined;
  const dataView = allowValueReadNativeLeaves && prototype === registryValueReadDataView.prototype;
  if (view || dataView) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(value)) {
      if (dataView || typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)
        || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) {
        throw new TypeError(`${context}: malformed value-read binary view`);
      }
    }
    if (view) {
      if (registryValueReadViewKind.call(value) !== view.kind) {
        throw new TypeError(`${context}: binary view kind does not match its native prototype`);
      }
      // Intrinsic iterator creation validates the live native window without
      // consulting an authored iterator or iterating numeric data. OOB views
      // must not normalize to the valid empty view their length getters expose.
      registryValueReadViewValues.call(value);
    }
    const buffer = (dataView ? registryValueReadDataBuffer : registryValueReadViewBuffer).call(value) as ArrayBufferLike;
    const byteOffset = (dataView ? registryValueReadDataOffset : registryValueReadViewOffset).call(value) as number;
    const byteLength = (dataView ? registryValueReadDataSize : registryValueReadViewSize).call(value) as number;
    const length = dataView ? byteLength : registryValueReadViewLength.call(value) as number;
    const backingPrototype = Object.getPrototypeOf(buffer);
    let backing: ArrayBuffer;
    let offset = byteOffset;
    if (backingPrototype === registryValueReadArrayBuffer.prototype) {
      backing = cloneRegistryTransportValue(buffer, `${context}.buffer`, active, copies,
        allowExecutableLeaves, preserveEquality, readDataProperty, allowValueReadNativeLeaves) as ArrayBuffer;
    } else if (registryValueReadSharedBuffer && backingPrototype === registryValueReadSharedBuffer.prototype) {
      registryValueReadSharedSize!.call(buffer);
      // Shared backing memory is not itself a transported value. The existing
      // binary read observes this window only; retain its native view type over
      // an independent fixed snapshot, without admitting a shared-buffer root.
      backing = new registryValueReadArrayBuffer(byteLength);
      registryValueReadSetBytes.call(new registryValueReadBytes(backing),
        new registryValueReadBytes(buffer, byteOffset, byteLength));
      offset = 0;
    } else throw new TypeError(`${context}: non-plain binary backing buffer is not allowed`);
    const out = dataView ? new registryValueReadDataView(backing, offset, byteLength)
      : new view!.arrayType(backing, offset, length);
    copies.set(value, out);
    return out as T;
  }
  if (prototype === Uint8Array.prototype) {
    if (preserveEquality && Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${context}: symbol properties are not allowed`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${context}: malformed Bytes transport leaf`);
      }
    }
    const out = new Uint8Array(value as unknown as Uint8Array);
    copies.set(value, out);
    return out as T;
  }
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    throw new TypeError(`${context}: non-plain transport object is not allowed`);
  }
  if (preserveEquality && Array.isArray(value) && prototype !== Array.prototype) {
    throw new TypeError(`${context}: non-plain array prototype is not allowed`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${context}: symbol properties are not allowed`);
  }

  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `${context}: accessor property ${JSON.stringify(key)} is not allowed`,
      );
    }
  }

  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, "value")
      || typeof lengthDescriptor.value !== "number"
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      throw new TypeError(`${context}: malformed array length`);
    }
    if (readDataProperty) {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "length") continue;
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          if (preserveEquality || descriptor.enumerable) {
            throw new TypeError(`${context}: non-index array property ${JSON.stringify(key)} is not allowed`);
          }
        } else if (preserveEquality && descriptor.enumerable !== true) {
          throw new TypeError(`${context}: non-enumerable array slot ${key} is not allowed`);
        }
      }
    }
    const length = readDataProperty ? readDataProperty(value, "length") : lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(`${context}: malformed array length`);
    }
    if (preserveEquality && Object.keys(descriptors).length !== length + 1) {
      throw new TypeError(`${context}: extra or missing array properties are not allowed`);
    }
    const out: unknown[] = new Array(length);
    // Build behind a null prototype so own data writes cannot invoke an
    // inherited setter (including a poisoned Array.prototype index). Restoring
    // the ordinary array prototype after the copy preserves the exact transport
    // shape without one defineProperty allocation for every element.
    Object.setPrototypeOf(out, null);
    copies.set(value, out);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.hasOwn(descriptors, String(index)) ? descriptors[String(index)] : undefined;
      if (descriptor === undefined) {
        throw new TypeError(`${context}: sparse array slot ${index} is not allowed`);
      }
      if (preserveEquality && descriptor.enumerable !== true) {
        throw new TypeError(`${context}: non-enumerable array slot ${index} is not allowed`);
      }
      out[index] = cloneRegistryTransportValue(
        readDataProperty ? readDataProperty(value, String(index)) : descriptor.value,
        `${context}[${index}]`,
        active,
        copies,
        allowExecutableLeaves,
        preserveEquality,
        readDataProperty,
        allowValueReadNativeLeaves,
      );
    }
    for (const key of Object.keys(descriptors)) {
      if (key === "length" || /^(0|[1-9][0-9]*)$/.test(key)) continue;
      if (descriptors[key]!.enumerable) {
        throw new TypeError(`${context}: non-index array property ${JSON.stringify(key)} is not allowed`);
      }
    }
    Object.setPrototypeOf(out, Array.prototype);
    active.delete(value);
    return out as T;
  }

  // Own definitions are safe even for __proto__/constructor or prototype
  // setters: a definition never consults inherited behavior (see
  // `registryTransportDefineOwnData`). A null-prototype source keeps a
  // null-prototype copy.
  const out = (prototype === null ? Object.create(null) : {}) as Record<string, unknown>;
  copies.set(value, out);
  const keys = Object.keys(descriptors);
  if (!preserveEquality) keys.sort();
  if (readDataProperty && preserveEquality) {
    for (const key of keys) {
      if (!descriptors[key]!.enumerable) {
        throw new TypeError(`${context}: non-enumerable property ${JSON.stringify(key)} is not allowed`);
      }
    }
  }
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable) {
      if (preserveEquality) throw new TypeError(`${context}: non-enumerable property ${JSON.stringify(key)} is not allowed`);
      continue;
    }
    const slot = cloneRegistryTransportValue(
      readDataProperty ? readDataProperty(value, key) : descriptor.value,
      `${context}.${key}`,
      active,
      copies,
      allowExecutableLeaves,
      preserveEquality,
      readDataProperty,
      allowValueReadNativeLeaves,
    );
    registryTransportDataSlot.value = slot;
    registryTransportDefineOwnData(out, key, registryTransportDataSlot);
  }
  registryTransportDataSlot.value = undefined;
  active.delete(value);
  return out as T;
}

/** Request-local host correspondence, never a Fenel value or authority. An
 * unsupported initial carrier keeps its caller's existing page operation.
 * An admitted request is single-use: stale/mutated/malformed replies refuse. */
export type RegistryTransportRoundTrip<T> =
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "captured"; readonly wire: T;
      reattach<R>(returnedInput: unknown, result: R): R; assertCurrent(): void; release(): void };

/** Exact original host graph observations for one asynchronous request. This
 * owns no public copy or wire correspondence; callers retain their own data. */
export type RegistryTransportObservation =
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "captured"; assertCurrent(): void; release(): void };

type RegistryRoundTripNode = {
  readonly original: object;
  readonly prototype: object | null;
  readonly extensible: boolean;
  readonly keys: readonly PropertyKey[];
  readonly slots: readonly PropertyDescriptor[];
  readonly native?:
    | { readonly kind: "date"; readonly time: number }
    | { readonly kind: "buffer"; readonly byteLength: number; readonly resizable: boolean;
        readonly maxByteLength: number; readonly bytes: Uint8Array }
    | { readonly kind: "view"; readonly buffer: object; readonly offset: number;
        readonly byteLength: number; readonly length: number; readonly dataView: boolean;
        readonly viewKind?: string };
};

/** Capture the whole host request once through the existing copier. Own slots
 * retain original child identities; native bytes have a separate owned snapshot.
 * No serialized equality key or semantic value comparison participates here.
 * The worker must return its actual received request and result together in ONE
 * native structured-clone message. Caller's lifetime fences precede reattach. */
export function captureRegistryTransportRoundTrip<T>(input: T, context: string): RegistryTransportRoundTrip<T> {
  return captureRegistryTransportGraph(input, context, "round-trip");
}

/** Reuse the same copier, node recorder and original-slot guard as round-trip
 * capture. Native Date observations require no serializer alias correspondence. */
export function captureRegistryTransportObservation<T>(input: T, context: string): RegistryTransportObservation {
  return captureRegistryTransportGraph(input, context, "observation");
}

function captureRegistryTransportGraph<T>(input: T, context: string, mode: "round-trip"): RegistryTransportRoundTrip<T>;
function captureRegistryTransportGraph<T>(input: T, context: string, mode: "observation"): RegistryTransportObservation;
function captureRegistryTransportGraph<T>(input: T, context: string,
  mode: "round-trip" | "observation"): RegistryTransportRoundTrip<T> | RegistryTransportObservation {
  const originals: object[] = [];
  const copies = new class extends WeakMap<object, unknown> {
    override set(original: object, copy: unknown): this {
      originals.push(original);
      return super.set(original, copy);
    }
  }();
  let wire: T;
  try {
    wire = cloneRegistryTransportValue(input, context, undefined, copies, false, true, undefined, true);
  } catch (error) {
    return { kind: "unsupported", reason: error instanceof Error ? error.message : `${context}: unsupported transport carrier` };
  }
  const nodes = new Map<object, RegistryRoundTripNode>();
  for (const original of originals) {
    const prototype = Object.getPrototypeOf(original);
    const keys = Reflect.ownKeys(original);
    const slots = keys.map(key => Object.getOwnPropertyDescriptor(original, key)!);
    let native: RegistryRoundTripNode["native"];
    if (prototype === registryValueReadDate.prototype) {
      // Some native serializers split Date aliases even within one message.
      // Without a surviving relation, equal timestamps cannot prove sharing.
      // Keep actual native Dates on the original page operation for this first
      // cut on every host; existing value-read/snapshot Date support is intact.
      if (mode === "round-trip") {
        return { kind: "unsupported", reason: `${context}: native Date round-trip alias fidelity is unproven` };
      }
      native = { kind: "date", time: registryValueReadDateValue.call(copies.get(original)) };
    } else if (prototype === registryValueReadArrayBuffer.prototype) {
      const owned = copies.get(original) as ArrayBuffer;
      const byteLength = registryValueReadBufferSize.call(owned) as number;
      const bytes = new registryValueReadBytes(byteLength);
      registryValueReadSetBytes.call(bytes, new registryValueReadBytes(owned));
      native = { kind: "buffer", byteLength, bytes,
        resizable: registryValueReadBufferResizable?.call(owned) === true,
        maxByteLength: registryValueReadBufferMaxSize?.call(owned) ?? byteLength };
    } else {
      const view = registryValueReadTypedArrays.find(candidate => prototype === candidate.prototype);
      const dataView = prototype === registryValueReadDataView.prototype;
      if (view || dataView) {
        const buffer = (dataView ? registryValueReadDataBuffer : registryValueReadViewBuffer).call(original) as object;
        // The value-read copier deliberately snapshots shared windows and may
        // change their offset/backing identity. That is not a bijective wire.
        // Keep this initial carrier on the original page operation instead.
        if (Object.getPrototypeOf(buffer) !== registryValueReadArrayBuffer.prototype) {
          return { kind: "unsupported", reason: `${context}: shared binary backing has no round-trip correspondence` };
        }
        native = { kind: "view", buffer, dataView,
          offset: (dataView ? registryValueReadDataOffset : registryValueReadViewOffset).call(original),
          byteLength: (dataView ? registryValueReadDataSize : registryValueReadViewSize).call(original),
          length: dataView ? registryValueReadDataSize.call(original) : registryValueReadViewLength.call(original),
          viewKind: view?.kind };
      }
    }
    nodes.set(original, { original, prototype, extensible: Object.isExtensible(original), keys, slots, native });
  }
  // The recorder method closes over this list. Do not let a surviving capture
  // closure retain a second strong route to originals after release().
  originals.length = 0;

  const refuse = (detail: string): never => { throw new TypeError(`${context}: ${detail}`); };
  const ownSlots = (node: RegistryRoundTripNode, value: object, normalization: "original" | "copy" | "returned",
    matchValue: (expected: unknown, actual: unknown) => void): void => {
    const prototype = Object.getPrototypeOf(value);
    const normalized = normalization !== "original";
    const expectedPrototype = normalization === "returned" && node.prototype === null ? Object.prototype : node.prototype;
    if (prototype !== expectedPrototype) refuse("transport prototype changed");
    if (Object.isExtensible(value) !== (normalized ? true : node.extensible)) refuse("transport extensibility changed");
    const keys = Reflect.ownKeys(value);
    if (keys.length !== node.keys.length) refuse("transport own slots changed");
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key !== node.keys[index]) refuse("transport own-slot order changed");
      const actual = Object.getOwnPropertyDescriptor(value, key);
      const expected = node.slots[index]!;
      if (!actual || !Object.hasOwn(actual, "value") || !Object.hasOwn(expected, "value"))
        refuse("transport own-data descriptor changed");
      // Native clone normalizes writable/configurable attributes; original
      // descriptors remain an exact mutation observation. Array length keeps
      // its native non-enumerable, non-configurable descriptor on the wire.
      const arrayLength = Array.isArray(value) && key === "length";
      if (actual!.enumerable !== expected.enumerable
        || actual!.configurable !== (normalized ? !arrayLength : expected.configurable)
        || actual!.writable !== (normalized ? true : expected.writable))
        refuse("transport own-data descriptor changed");
      matchValue(expected.value, actual!.value);
    }
  };
  const nativeSlots = (node: RegistryRoundTripNode, value: object,
    matchValue: (expected: unknown, actual: unknown) => void): void => {
    const native = node.native;
    if (!native) return;
    if (native.kind === "date") {
      if (!Object.is(registryValueReadDateValue.call(value), native.time)) refuse("transport Date time changed");
    } else if (native.kind === "buffer") {
      const byteLength = registryValueReadBufferSize.call(value) as number;
      const bytes = new registryValueReadBytes(value as ArrayBuffer);
      if (byteLength !== native.byteLength
        || (registryValueReadBufferResizable?.call(value) === true) !== native.resizable
        || (registryValueReadBufferMaxSize?.call(value) ?? byteLength) !== native.maxByteLength)
        refuse("transport buffer slots changed");
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== native.bytes[index]) refuse("transport buffer bytes changed");
      }
    } else {
      const dataView = native.dataView;
      if (!dataView) {
        if (registryValueReadViewKind.call(value) !== native.viewKind) refuse("transport binary view kind changed");
        registryValueReadViewValues.call(value);
      }
      if ((dataView ? registryValueReadDataOffset : registryValueReadViewOffset).call(value) !== native.offset
        || (dataView ? registryValueReadDataSize : registryValueReadViewSize).call(value) !== native.byteLength
        || (!dataView && registryValueReadViewLength.call(value) !== native.length))
        refuse("transport binary view slots changed");
      matchValue(native.buffer, (dataView ? registryValueReadDataBuffer : registryValueReadViewBuffer).call(value));
    }
  };
  const matchGraph = (root: unknown, returned: unknown, observations: Map<object, RegistryRoundTripNode>,
    normalization: "copy" | "returned"): WeakMap<object, unknown> => {
    const forward = new Map<object, object>();
    const reverse = new WeakMap<object, unknown>();
    const match = (expected: unknown, actual: unknown): void => {
      if (expected === null || typeof expected !== "object") {
        if (!Object.is(expected, actual)) refuse("transport primitive changed");
        return;
      }
      if (actual === null || typeof actual !== "object") refuse("transport node changed");
      const current = actual as object;
      if (forward.has(expected)) {
        if (forward.get(expected) !== current) refuse("transport alias split");
        return;
      }
      if (reverse.has(current)) refuse("transport distinct nodes collapsed");
      const node = observations.get(expected);
      if (!node) refuse("transport correspondence is incomplete");
      forward.set(expected, current);
      reverse.set(current, expected);
      ownSlots(node!, current, normalization, match);
      nativeSlots(node!, current, match);
    };
    match(root, returned);
    if (forward.size !== observations.size) refuse("transport correspondence is incomplete");
    return reverse;
  };
  // A mutation during synchronous admission cannot quietly change the request
  // whose original identities this capture records. Failure here is a refusal,
  // not the unsupported-carrier compatibility path.
  const assertOriginalsCurrent = (observations: Map<object, RegistryRoundTripNode>): void => {
    for (const node of observations.values()) {
      ownSlots(node, node.original, "original", (expected, actual) => {
        if (!Object.is(expected, actual)) refuse("original transport child or primitive changed");
      });
      nativeSlots(node, node.original, (expected, actual) => {
        if (expected !== actual) refuse("original transport backing identity changed");
      });
    }
  };
  matchGraph(input, wire, nodes, "copy");
  assertOriginalsCurrent(nodes);
  let retained: { root: unknown; nodes: Map<object, RegistryRoundTripNode> } | undefined = { root: input, nodes };
  let consumed = false;
  const release = (): void => { retained?.nodes.clear(); retained = undefined; };
  // A rebuild may await after reattachment, or carry an independent copied
  // request. Keep the same original graph observation until publication.
  const assertCurrent = (): void => {
    if (!retained) return refuse("transport capture was released");
    try { assertOriginalsCurrent(retained.nodes); }
    catch (error) { release(); throw error; }
  };
  if (mode === "observation") return { kind: "captured", assertCurrent, release };
  return {
    kind: "captured", wire,
    reattach<R>(returnedInput: unknown, result: R): R {
      const captured = retained;
      if (!captured || consumed) return refuse("transport capture was released or consumed");
      consumed = true;
      try {
        const returnedToOriginal = matchGraph(captured.root, returnedInput, captured.nodes, "returned");
        assertOriginalsCurrent(captured.nodes);
        // Existing copies map short-circuits genuine returned-input nodes to
        // original page objects. Only fresh result nodes are allocated/filled.
        // No write is made into an original or a returned request object.
        return cloneRegistryTransportValue(result, context, undefined, returnedToOriginal, false, true, undefined, true);
      } catch (error) { release(); throw error; }
    },
    assertCurrent,
    release,
  };
}

/** An injective text encoding of a transport value, or undefined when the
 * value holds anything other than plain data (a function, symbol, accessor,
 * typed array, Map, class instance or cycle). Strings are JSON-escaped, so
 * the U+0001 separator never occurs inside a part; numbers keep -0, NaN and
 * the infinities apart; undefined, holes and key order are explicit. */
export function exactTransportKey(value: unknown): string | undefined {
  return exactTransportKeyOfSnapshot(value, false);
}

/** Capture once before deriving a cache key: the queued request must consume
 * the bytes that were keyed, even if its caller mutates the original later.
 * Native slots are admitted only by the existing registry transport above. */
export function captureRegistryTransportKey<T>(value: T, context: string,
  mode: "canonical" | "equality" | "value-read" = "canonical",
  readDataProperty?: (owner: object, key: string) => unknown,
): { readonly key: string; readonly copy: T } {
  const copy = registryTransportSnapshot(value, context, mode, readDataProperty);
  const key = exactTransportKeyOfSnapshot(copy, true);
  if (key === undefined) throw new TypeError(`${context}: unsupported transport key`);
  return { key, copy };
}

function exactTransportKeyOfSnapshot(value: unknown, nativeSnapshot: boolean): string | undefined {
  const parts: string[] = [];
  const active = new Set<object>();
  // Signature-plan keys retain their existing grammar. Captured reader keys
  // additionally preserve sharing and every native carrier their wire admits.
  const seen = new Map<object, number>();
  const visit = (current: unknown): boolean => {
    switch (typeof current) {
      case "string": parts.push("s", JSON.stringify(current)); return true;
      case "number": parts.push("n", Object.is(current, -0) ? "-0" : String(current)); return true;
      case "boolean": parts.push(current ? "T" : "F"); return true;
      case "undefined": parts.push("u"); return true;
      case "bigint":
        if (!nativeSnapshot) return false;
        parts.push("bigint", String(current)); return true;
      case "object": {
        if (current === null) { parts.push("z"); return true; }
        if (active.has(current)) return false;
        const prototype = Object.getPrototypeOf(current);
        if (Object.getOwnPropertySymbols(current).length > 0) return false;
        if (nativeSnapshot) {
          const prior = seen.get(current);
          if (prior !== undefined) { parts.push("backref", String(prior)); return true; }
          seen.set(current, seen.size);
          parts.push("node", String(seen.size - 1));
          if (prototype === registryValueReadDate.prototype) {
            parts.push("date", String(registryValueReadDateValue.call(current))); return true;
          }
          if (prototype === registryValueReadArrayBuffer.prototype) {
            const bytes = new registryValueReadBytes(current as ArrayBuffer);
            let hex = "";
            for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
            parts.push("buffer", registryValueReadBufferResizable?.call(current) === true ? "resizable" : "fixed",
              String(registryValueReadBufferMaxSize?.call(current) ?? bytes.byteLength), hex);
            return true;
          }
          const view = registryValueReadTypedArrays.find(candidate => prototype === candidate.prototype);
          const dataView = prototype === registryValueReadDataView.prototype;
          if (view || dataView) {
            parts.push("view", dataView ? "DataView" : view!.kind,
              String((dataView ? registryValueReadDataOffset : registryValueReadViewOffset).call(current)),
              String((dataView ? registryValueReadDataSize : registryValueReadViewSize).call(current)));
            return visit((dataView ? registryValueReadDataBuffer : registryValueReadViewBuffer).call(current));
          }
        }
        active.add(current);
        if (Array.isArray(current)) {
          if (prototype !== Array.prototype) return false;
          parts.push("[", String(current.length));
          let present = 0;
          for (let index = 0; index < current.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
            if (descriptor === undefined) { parts.push("h"); continue; }
            if (!Object.hasOwn(descriptor, "value")) return false;
            present += 1;
            if (!visit(descriptor.value)) return false;
          }
          if (Object.getOwnPropertyNames(current).length !== present + 1) return false;
          parts.push("]");
        } else {
          if (prototype !== Object.prototype && prototype !== null) return false;
          parts.push("{", prototype === null ? "0" : "1");
          for (const name of Object.getOwnPropertyNames(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, name)!;
            if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return false;
            parts.push(JSON.stringify(name));
            if (!visit(descriptor.value)) return false;
          }
          parts.push("}");
        }
        active.delete(current);
        return true;
      }
      default: return false;
    }
  };
  return visit(value) ? parts.join("\u0001") : undefined;
}
