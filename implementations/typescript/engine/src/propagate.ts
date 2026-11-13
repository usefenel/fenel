// ---------------------------------------------------------------------------
// propagate.ts — forward type propagation (abstract interpretation): the thin
// marshal seam over the Fenel `engine:propagate` body.
//
// unified-static-analysis Phase 3b-1 (brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-1-propagate-and-setmarker-roundtrip.md`).
//
// Phase 2's latency verdict came back Fenel-fast-enough, green-lighting the
// Fenel-first port of the inference hot path. `propagate` is the LEAF —
// `propagate(op, ...inputs: SetExpr) → SetExpr`, pure forward abstract
// interpretation over the SetExpr lattice — that `inferExprType` / `invert`
// compose on. The ~459 LOC of transfer-function decision logic that used to
// live here is now the Fenel body `propagate.fenel` (the `assignable.fenel` /
// `refine.fenel` precedent). This file keeps only the canonical boundary
// normalization and the final `normalize` post-step.
//
// floor-kernel Phase 4: `engine:propagate` consumes and authors the registered
// fourteen-case `SetExpr` ADT directly. `setExprToTag` accepts any ledgered
// historical boundary value, immediately canonicalizes it, and is idempotent
// on normal internal input. The former SetExpr↔SetMarker round-trip is retired;
// the body result is canonicalized defensively and normalized once. The
// intermediate normalizations the legacy code interleaved are subsumed by that
// final pass (the parity suite pins the equivalence).
//
// `±Infinity` is gone from the Fenel side: the interval-bound representation
// maps an
// unbounded (Nothing) or non-numeric bound to a Fenel `Nothing`, and the body
// branches on `Just` / `Nothing` (an unbounded operand bound ⇒ unbounded
// result bound, an excluded multiplication corner, or ∓∞ in the comparison
// extremes). This matches the legacy `numLo` / `numHi` ±Infinity reads on the
// supported fragment (the object-valued `{$expr}` bound → unbounded parity
// included).
// ---------------------------------------------------------------------------

import type { SetExpr } from "./types";
import { normalize } from "./set-algebra";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { setExprToTag } from "./set-marker";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Propagate types forward through an operator (abstract interpretation).
 *  decide-substrate Phase 1 Stage E: the Fenel `engine:propagate` body reads /
 *  builds the canonical `$tag` `Se*` SetExpr directly (the `Sm*` SetMarker
 *  round-trip is RETIRED). Normalize each input to `$tag` form (`setExprToTag`,
 *  the dual-read boundary), dispatch, then `normalize` the result. */
export function propagate(op: string, ...inputs: SetExpr[]): SetExpr {
  const tagged = inputs.map((child) => setExprToTag(child));
  const result = setExprToTag(dispatchEngineBody("engine:propagate", [op, tagged]));
  return normalize(result);
}

/** Algebraic closure: what named set does `a op b` produce? The type-level
 *  number-tower (ℕ⊂ℤ⊂ℚ⊂ℝ) widening — now the Fenel body's `propNamedArith`
 *  arm, reached via two `$ref` operands (a non-tower name ⇒ `$all`, exactly as
 *  before). Kept as a named export for `index.ts`'s public surface. */
export function namedArith(op: string, a: string, b: string): SetExpr {
  return propagate(op, { $tag: "SeRef", handle: a }, { $tag: "SeRef", handle: b });
}
