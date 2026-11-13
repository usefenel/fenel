/** B3: observe one host descriptor layer for the Fenel representation policy.
 * Children retain their identity; accessors and unreadable proxies abstain. */
export function representationValueSnapshot(value: unknown): unknown {
  if (typeof value === "number") return { $tag: "SnapshotNumber", _0: value };
  if (typeof value === "string") return { $tag: "SnapshotString", _0: value };
  if (typeof value === "boolean") return { $tag: "SnapshotBoolean", _0: value };
  if (value === null || typeof value !== "object") return { $tag: "SnapshotOther" };
  try {
    if (Array.isArray(value)) return { $tag: "SnapshotArray", _0: value };
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { $tag: "SnapshotUnreadable" };
    const fields: { $tag: string; name: string; value: unknown }[] = [];
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return { $tag: "SnapshotUnreadable" };
      fields.push({ $tag: "RepresentationOwnField", name, value: descriptor.value });
    }
    return { $tag: "SnapshotRecord", _0: fields };
  } catch {
    return { $tag: "SnapshotUnreadable" };
  }
}
