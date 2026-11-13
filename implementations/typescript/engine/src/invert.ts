// ---------------------------------------------------------------------------
// invert.ts — backward constraint propagation (abstract interpretation): the
// thin marshal seam over the Fenel `engine:invert` body.
//
// unified-static-analysis Phase 3b-2 (brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-2-invert-backward-transfer.md`).
//
// `invert` is the BACKWARD dual of `propagate`'s forward transfer (slice 1):
// given `output = inputs[0] <op> inputs[1]` with all but `inputs[unknownIdx]`
// known, solve the unknown input's constraint over the SetExpr lattice —
// equation solving. The ~342 LOC of backward-transfer decision logic that used
// to live here is now the Fenel body `invert.fenel` (the `propagate.fenel`
// precedent), which reuses propagate.fenel's interval/enum helpers directly
// (the D-3b-1 shared-helper north-star). This file keeps only the canonical
// boundary normalization and the final `normalize` post-step.
//
// floor-kernel Phase 4: `engine:invert` consumes and authors the registered
// fourteen-case `SetExpr` ADT directly. `setExprToTag` accepts a ledgered
// historical boundary value, immediately canonicalizes it, and is idempotent
// on internal input. The former SetExpr↔SetMarker round-trip is retired; the
// body result is canonicalized defensively and normalized once (the parity
// suite pins equivalence with the legacy intermediate-normalization path).
// ---------------------------------------------------------------------------

import type { SetExpr } from "./types";
import { normalize } from "./set-algebra";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { setExprToTag } from "./set-marker";

/**
 * Backward propagation: given `output = inputs[0] <op> inputs[1]`,
 * where all inputs except `inputs[unknownIdx]` are known,
 * compute the constraint on the unknown input.
 *
 * Returns SeAll if the operation is not invertible. Canonicalizes `output` and
 * the inputs, dispatches the Fenel `engine:invert` body, then normalizes the
 * canonical result.
 */
export function invert(
  op: string,
  output: SetExpr,
  inputs: SetExpr[],
  unknownIdx: number,
): SetExpr {
  // decide-substrate Phase 1 Stage E: the Fenel `engine:invert` body reads /
  // builds the canonical `$tag` `Se*` SetExpr directly (the `Sm*` round-trip is
  // RETIRED). Normalize `output` + the inputs to `$tag` form, dispatch, normalize.
  const taggedOutput = setExprToTag(output);
  const taggedInputs = inputs.map((child) => setExprToTag(child));
  const result = setExprToTag(dispatchEngineBody("engine:invert", [
    op,
    taggedOutput,
    taggedInputs,
    unknownIdx,
  ]));
  return normalize(result);
}

/**
 * Confidence level for backward propagation.
 * "exact" = invertible op, result is precise
 * "approximate" = sound but may be wider than necessary
 * "unavailable" = returned $all
 *
 * Pure classification — the Fenel `engine:invertConfidence` body (Phase 3b-2
 * D-3b-2-3). This seam only canonicalizes the SetExpr inputs.
 */
export function invertConfidence(
  op: string,
  inputs: SetExpr[],
  unknownIdx: number,
): "exact" | "approximate" | "unavailable" {
  const taggedInputs = inputs.map((child) => setExprToTag(child));
  return dispatchEngineBody("engine:invertConfidence", [
    op,
    taggedInputs,
    unknownIdx,
  ]) as "exact" | "approximate" | "unavailable";
}
