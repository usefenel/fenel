// ---------------------------------------------------------------------------
// Time — FFI leaf (the irreducible host-time IO).
//
// module-substrate Phase 3b — the FIRST per-module `ffi/` leaf and the FIRST
// `.ts` under `fenel/`. The `module … where` migration split `FenelModule`'s
// two fused halves: the DECLARATIVE half (signatures + identity facets +
// entities + Fenel bodies) is now authored in `fenel/modules/time/time.fenel`;
// the FOREIGN-IO half — the `nativeImpls` map of irreducible host calls — lives
// HERE. The seam (`engine/src/modules/time.ts`) imports both and reassembles
// the `FenelModule`.
//
// Everything in this file is a genuine host-IO leaf — a single `Date.*` call
// each, with no orchestration, branching, or composable pure logic (that would
// be a `.fenel` body, per the Fenel-first HARD RULE). These are the textbook
// `ffi/` content: wall-clock and host date parsing/formatting the JS runtime
// forces on us. The content-gate (`ts-elimination-completion`) permits `.ts`
// under `fenel/modules/` ONLY inside an `ffi/` folder — this is the first.
// ---------------------------------------------------------------------------

export type TimestampValue = { $tag: "Timestamp"; epochMs: number };
export type DurationValue = { ms: number };

/** Current wall-clock time. The only effectful primitive in this module —
 *  successive calls return different values. Sync because `Date.now()` is
 *  instantaneous; no IO suspend needed. */
export function nowNative(): TimestampValue {
  return { $tag: "Timestamp", epochMs: Date.now() };
}

/**
 * Irreducible host primitive: ask the JS runtime to parse an ISO 8601
 * string into epoch milliseconds. Returns `Maybe Number` directly —
 * Fenel-callable consumers can pattern-match Just/Nothing without a
 * boundary wrapper. The Fenel body for `parseIsoTimestamp` calls this
 * and wraps the value in a `Timestamp` record.
 */
export function hostDateParseNative(
  iso: unknown,
): { $tag: "Just"; _0: number } | { $tag: "Nothing" } {
  const ms = Date.parse(String(iso));
  if (Number.isNaN(ms)) return { $tag: "Nothing" };
  return { $tag: "Just", _0: ms };
}

/** Format a Timestamp as an ISO 8601 string in UTC. */
export function formatIsoTimestampNative(t: unknown): string {
  const ms = Number((t as { epochMs?: unknown })?.epochMs);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

/** Current wall-clock as an ISO 8601 string in UTC, in one call. Sister of
 *  `now` (which returns a Timestamp record); this fuses now+formatIso for the
 *  common "reservedAt timestamp" case in action handler bodies. Sync because
 *  `Date.prototype.toISOString` on a fresh `new Date()` is instant. */
export function nowIsoNative(): string {
  return new Date(Date.now()).toISOString();
}

// ---------------------------------------------------------------------------
// The native map — codeName → impl. The seam rekeys this to id-keyed
// (`time:now`, …) via `rekeyNativesById` and attaches it to the FenelModule's
// `nativeImpls`. The shape is the SAME plain `Record<codeName, JsFn>` the spec
// file declared before the split; only the FILE LOCATION moved (TS
// source-of-truth → `ffi/` leaf), not the runtime contract.
// ---------------------------------------------------------------------------

export const timeNatives = {
  now: nowNative,
  hostDateParse: hostDateParseNative,
  formatIsoTimestamp: formatIsoTimestampNative,
  nowIso: nowIsoNative,
};
