import { encodeCheckpointValue } from "../checkpoint-json";

/** Validate the ordinary JSON remainder after schema-directed carrier encoding.
 * This is a transport guard, not a type judgment or a data-shape rewriter. */
export function assertJsonAuthoringValue(value: unknown, seen = new Set<object>(), path = "value", rejectUndefinedFields = false): void {
  if (rejectUndefinedFields && value === undefined) throw new TypeError(`${path}: an undefined value cannot be saved; use the declared empty value or remove the field explicitly`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${path}: non-finite number requires a declared type/set transport slot`);
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") throw new TypeError(`${path}: unsupported ${typeof value} value`);
  if (value === null || typeof value !== "object") return;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) throw new TypeError(`${path}: binary data requires a declared Bytes slot`);
  if (seen.has(value)) throw new TypeError(`${path}: cyclic value cannot be saved`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${path}: unsupported host object`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const slot = Object.getOwnPropertyDescriptor(value, index);
      if (!slot || ("value" in slot && slot.value === undefined)) {
        throw new TypeError(`${path}.${index}: an absent list item cannot be saved as null`);
      }
    }
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of Reflect.ownKeys(descriptors)) {
    if (typeof name === "symbol") throw new TypeError(`${path}: symbol-keyed properties cannot be saved as JSON`);
    const descriptor = descriptors[name]!;
    if (Array.isArray(value) && name === "length") continue;
    if (!("value" in descriptor)) throw new TypeError(`${path}.${name}: accessor cannot be saved`);
    assertJsonAuthoringValue(descriptor.value, seen, `${path}.${name}`, rejectUndefinedFields);
  }
  seen.delete(value);
}

/** Descriptor-safe preflight before a typed projection reads payload slots.
 * The JSON guard still checks the complete remainder after projection. */
export function assertAcyclicAuthoringData(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== "object" || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  if (seen.has(value)) throw new TypeError("Cyclic values require an explicit source definition instead of JSON storage");
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, name) as PropertyDescriptor;
    if (!("value" in descriptor)) throw new TypeError("Accessor-bearing values cannot be saved");
    if (typeof name === "symbol") throw new TypeError("symbol-keyed properties cannot be saved as JSON");
    assertAcyclicAuthoringData(descriptor.value, seen);
  }
  seen.delete(value);
}

/** Raw value slots retain the stricter undefined policy while the explicit v2
 * carrier permits native atoms. The checkpoint codec remains the sole authority
 * for supported host values, descriptor safety, cycles, and marker escaping. */
export function assertNativeAuthoringValue(value: unknown, path = "value"): void {
  encodeCheckpointValue(value);
  const visit = (child: unknown, childPath: string): void => {
    if (child === undefined) throw new TypeError(`${childPath}: an undefined value cannot be saved; remove the field explicitly`);
    if (!child || typeof child !== "object" || child instanceof ArrayBuffer || ArrayBuffer.isView(child) || child instanceof Date) return;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(child))) {
      if (Array.isArray(child) && name === "length") continue;
      visit(descriptor.value, `${childPath}.${name}`);
    }
  };
  visit(value, path);
}
