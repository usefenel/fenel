// Strict plain-data snapshot for inference results and authoring schemes.
// Moved verbatim from signature-inference.ts so that early browser code can
// snapshot a scheme without importing the engine (no other engine import).
import type { TypeScheme } from "./types";

/** Strictly snapshot the opaque data portions of a Fenel inference result.
 * Semantic decoders in signature-inference.ts rebuild kinds/types/schemes field-by-field, but map
 * key domains, refinement sets, derivations, and trust evidence can contain
 * nested data which is intentionally opaque to the type solver. They still
 * cross a persistence/publication boundary, so retain only canonical own data:
 * no accessors, prototypes, symbols, executable values, sparse arrays, or
 * cycles. Shared acyclic subgraphs remain shared in the frozen snapshot. */
export function snapshotInferenceTransportData(
  value: unknown,
  context: string,
  active = new WeakSet<object>(),
  copies = new WeakMap<object, unknown>(),
): unknown {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError(`${context}: non-data inference transport value is not allowed`);
  }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) {
    throw new TypeError(`${context}: cyclic inference transport data is not allowed`);
  }
  const prior = copies.get(value);
  if (prior !== undefined) return prior;

  let isArray: boolean;
  let prototype: object | null;
  let symbols: symbol[];
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${context}: inference transport data cannot be inspected safely`);
  }
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${context}: non-plain inference transport object is not allowed`);
  }
  if (symbols.length > 0) {
    throw new TypeError(`${context}: symbol properties are not allowed`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${context}: accessor property ${JSON.stringify(key)} is not allowed`);
    }
  }

  active.add(value);
  try {
    if (isArray) {
      const length = Object.hasOwn(descriptors, "length") ? descriptors.length : undefined;
      if (
        length === undefined
        || !Object.hasOwn(length, "value")
        || typeof length.value !== "number"
        || !Number.isSafeInteger(length.value)
        || length.value < 0
      ) {
        throw new TypeError(`${context}: malformed inference transport array length`);
      }
      const output: unknown[] = new Array(length.value);
      copies.set(value, output);
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.hasOwn(descriptors, String(index)) ? descriptors[String(index)] : undefined;
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
          throw new TypeError(`${context}: sparse/non-data inference transport slot ${index}`);
        }
        Object.defineProperty(output, String(index), { __proto__: null,
          value: snapshotInferenceTransportData(
            descriptor.value,
            `${context}[${index}]`,
            active,
            copies,
          ),
          enumerable: true,
          configurable: false,
          writable: false,
        } as PropertyDescriptor);
      }
      for (const key of Object.keys(descriptors)) {
        if (key === "length" || /^(0|[1-9][0-9]*)$/.test(key)) continue;
        throw new TypeError(
          `${context}: non-index inference transport array property ${JSON.stringify(key)}`,
        );
      }
      return Object.freeze(output);
    }

    const output = Object.create(
      prototype === null ? null : Object.prototype,
    ) as Record<string, unknown>;
    copies.set(value, output);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) {
        throw new TypeError(
          `${context}: non-enumerable inference transport property ${JSON.stringify(key)}`,
        );
      }
      Object.defineProperty(output, key, { __proto__: null,
        value: snapshotInferenceTransportData(
          descriptor.value,
          `${context}.${key}`,
          active,
          copies,
        ),
        enumerable: true,
        configurable: false,
        writable: false,
      } as PropertyDescriptor);
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

/** B3 authoring comparison transport through the existing strict inference
 * snapshot. No scheme is interpreted or classified at this host boundary. */
export function snapshotAuthoringSchemeTransport(scheme: TypeScheme): TypeScheme {
  return snapshotInferenceTransportData(scheme, "authoring scheme comparison") as TypeScheme;
}
