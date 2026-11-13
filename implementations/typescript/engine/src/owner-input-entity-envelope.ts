/** B3 own-data projection framing. The requested fields come from the actual
 * Fenel policy body; this helper neither chooses fields nor grants eligibility.
 * Capture at the canonical loader return, before later freezing/copying can
 * change root descriptors. Full and cold producers use this SAME operation.
 */
import { exactOwnDataSnapshot } from "./own-data-snapshot";

type RootAttributes = Readonly<{ enumerable: boolean; configurable: boolean; writable: boolean }>;
export type CanonicalModuleDelivery = Readonly<{
  data: object; attributes: Readonly<Record<string, RootAttributes>>;
}>;

export function captureCanonicalModuleDelivery(sourceDefinition: object): CanonicalModuleDelivery {
  const snapshot = exactOwnDataSnapshot(sourceDefinition);
  if (snapshot.status !== "ok") throw new Error(`canonical module cannot be isolated: ${snapshot.reason}`);
  const attributes: Record<string, RootAttributes> = Object.create(null);
  for (const key of Reflect.ownKeys(sourceDefinition)) {
    if (typeof key !== "string") throw new Error("canonical module root has a symbol key");
    const slot = Object.getOwnPropertyDescriptor(sourceDefinition, key);
    if (slot === undefined || !("value" in slot)) throw new Error("canonical module root is accessor-backed");
    attributes[key] = Object.freeze({ enumerable: slot.enumerable === true,
      configurable: slot.configurable === true, writable: slot.writable === true });
  }
  return Object.freeze({ data: snapshot.value, attributes: Object.freeze(attributes) });
}

export function projectCanonicalModuleEnvelope(delivery: CanonicalModuleDelivery, fields: unknown): object {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Fenel field request is unreadable");
  const prototype = Object.getPrototypeOf(fields);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Fenel field request has an exotic prototype");
  const envelope: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string") throw new Error("Fenel field request has a symbol key");
    const requested = Object.getOwnPropertyDescriptor(fields, key);
    if (requested === undefined || !("value" in requested) || requested.value !== true) throw new Error("Fenel field request is not admitted own data");
    const slot = Object.getOwnPropertyDescriptor(delivery.data, key);
    if (slot === undefined) { envelope[key] = Object.freeze({ present: false }); continue; }
    if (!("value" in slot)) throw new Error("canonical delivery root is accessor-backed");
    const attributes = Object.getOwnPropertyDescriptor(delivery.attributes, key);
    if (attributes === undefined || !("value" in attributes)) throw new Error("canonical delivery lost root attributes");
    envelope[key] = Object.freeze({ present: true, value: slot.value, ...attributes.value });
  }
  const isolated = exactOwnDataSnapshot(envelope);
  if (isolated.status !== "ok") throw new Error(`canonical envelope cannot be isolated: ${isolated.reason}`);
  return isolated.value;
}
