// ---------------------------------------------------------------------------
// type-normalize.ts — thin shim around the Fenel-bodied port.
//
// Phase 7a (ts-elimination) — the recursive walker that converts legacy
// `$maybe` / `$list` / `$result` shorthand to canonical `Maybe(T)` /
// `List(T)` / `Result(E, A)` shapes moved to a Fenel body at
// `fenel/modules/engine/type-normalize.fenel`. This file now exposes the
// public API unchanged; the implementation dispatches through
// `dispatchedNormalizeFenelTypeShorthand` which marshals raw JSON to the
// TypeNorm ADT, evaluates the Fenel body, and unmarshals rewrite markers
// via the canonical type-foundation helpers.
//
// See the body file for the full per-function comment block + the design
// rationale (rewrite-intent markers vs structural shape emission).
// ---------------------------------------------------------------------------

import {
  dispatchedNormalizeFenelTypeShorthand,
  type NormalizeReport,
} from "./engine-bodies-dispatch";

export type { NormalizeReport };

/** Walk `input` recursively; rewrite legacy `$maybe` / `$list` / `$result`
 *  shorthand to canonical helper output. Returns the new value plus a count
 *  of rewrites performed. Idempotent. */
export function normalizeFenelTypeShorthand(input: unknown): NormalizeReport {
  return dispatchedNormalizeFenelTypeShorthand(input);
}

// 7g-retire-final: `bridgeNamedToRef` (the `{$named}`→`{$ref}` read-seam bridge)
// is RETIRED — `{$named}` is fully eliminated (producers + on-disk migration
// 0086 + the read-tolerance drop). No bridge is needed.
