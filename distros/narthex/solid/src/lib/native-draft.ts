import { snapshot } from "solid-js";
import { checkpointDraftFingerprint } from "@fenel/engine/checkpoint-json";

/** Snapshot editor data without the numeric/binary coercions of JSON cloning. */
export function cloneDraftValue<T>(value: T): T {
  return structuredClone(snapshot(value));
}

// Read through store proxies before unwrapping so a fingerprint used by a
// reactive body projection still subscribes to nested edits. This only tracks
// structure; the engine codec owns native-value representation.
function trackDraft(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) trackDraft((value as Record<string, unknown>)[key], seen);
}

const ATOM = "$fenelCheckpoint";

/** Whether `JSON.stringify(value)` already is the checkpoint draft text of a
 * structured clone of `value`: null, booleans, strings, finite non-negative-
 * zero numbers, dense arrays of defined items and records with a plain
 * prototype and no checkpoint atom key. JSON and structured clone both skip
 * symbol and non-enumerable keys, and JSON drops undefined fields exactly as
 * the checkpoint encoder does. Anything else keeps the original path. */
function plainDraftData(value: unknown, ancestors: Set<object>): boolean {
  switch (typeof value) {
    case "string": case "boolean": return true;
    case "number": return Number.isFinite(value) && !Object.is(value, -0);
    case "object": break;
    default: return false;
  }
  if (value === null) return true;
  const object = value as object;
  if (ancestors.has(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      if (prototype !== Array.prototype) return false;
      const items = object as unknown[];
      if (Object.keys(items).length !== items.length) return false;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item === undefined || !plainDraftData(item, ancestors)) return false;
      }
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.prototype.hasOwnProperty.call(object, ATOM)) return false;
    const record = object as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const field = record[key];
      if (field !== undefined && !plainDraftData(field, ancestors)) return false;
    }
    return true;
  } finally { ancestors.delete(object); }
}

export function draftValueFingerprint(value: unknown): string {
  const raw = snapshot(value);
  // Solid keeps the identity of plain data that holds no store proxy or
  // written store node. Reading such data subscribes to nothing, so the
  // tracking walk only matters when the snapshot differs.
  if (raw !== value) trackDraft(value);
  if (plainDraftData(raw, new Set())) return JSON.stringify(raw);
  // Structured clone also omits Solid's non-enumerable bookkeeping symbols
  // attached to the unwrapped nodes; those are not authored data.
  return checkpointDraftFingerprint(structuredClone(raw));
}
