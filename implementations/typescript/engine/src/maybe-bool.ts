// ---------------------------------------------------------------------------
// MaybeBool — the tri-state decidability lattice used by the typeclass-
// dispatched set-algebra (`DecidableMembership`) and the in-engine Prover
// kernel (Phase 4 of the implementation roadmap).
//
//   Just true  — proven true   (a witness or decision procedure ran cleanly)
//   Just false — proven false  (a counterexample or refuting structural rule)
//   Nothing    — couldn't decide
//
// The shape mirrors Fenel's `Maybe a = Nothing | Just { value: a }` from
// type-foundation.ts — so values flow into Fenel-side dispatch through
// `{call: ...}` without re-shaping, and the kernel's verifier reads the
// same wire form a registered Fenel function would produce.
//
// Three reasons the migration matters:
//
//   1. **Honest semantics.** Before, set-algebra's `decideSubset/Disjoint/
//      Empty` collapsed "I refute this" and "I can't decide" into a single
//      `false`. Callers that wanted the algebraic shortcut (e.g. "if
//      subset is false the validator can warn") couldn't tell the two
//      apart. Tri-state distinguishes them at the source.
//   2. **Combinator propagation.** $union / $intersect / $diff /
//      $complement now propagate `Nothing` upward — any leaf returning
//      `Nothing` means the compound result is also `Nothing`, not `Just
//      false`. This is correct: the negative claim wasn't established;
//      the absence of a positive proof isn't a refutation.
//   3. **Prover substrate.** `DecidableSetProver` (Phase 4) consumes the
//      tri-state directly to decide whether to emit a kernel-verifiable
//      proof term (`Just true` → DecidableSetResult{decided:true}; `Just
//      false` → counterexample-backed `Refuted`; `Nothing` →
//      `Unproved`).
//
// Boundary conversion: callers that need a binary surface (validation,
// pattern-pruning, structural subtype reasoning) convert via `mGet(_,
// false)` at the boundary — preserving today's conservative-false
// posture without forcing the algebra itself to lie.
// ---------------------------------------------------------------------------

/**
 * Tri-state result. JS-side representation matches Fenel's `Maybe a`:
 *   - `{ $tag: "Just", _0: true | false }` — decided
 *   - `{ $tag: "Nothing" }`                   — undecided
 *
 * The wire-compatible form lets values flow through Fenel function
 * dispatch (`{call: [...]}`) and the law validator's pattern matchers
 * (`{$tag: "Just" | "Nothing"}`) without an adapter layer.
 */
export type MaybeBool =
  | { readonly $tag: "Just"; readonly _0: boolean }
  | { readonly $tag: "Nothing" };

/** The `Nothing` singleton — exported so callers can short-circuit
 *  without allocating a fresh record per call. */
export const mNothing: MaybeBool = Object.freeze({ $tag: "Nothing" }) as MaybeBool;

/** The `Just true` singleton. */
export const mJustTrue: MaybeBool = Object.freeze({ $tag: "Just", _0: true }) as MaybeBool;

/** The `Just false` singleton. */
export const mJustFalse: MaybeBool = Object.freeze({ $tag: "Just", _0: false }) as MaybeBool;

/** Wrap a JS boolean as `Just`. The two singletons above are reused — no
 *  fresh allocation per call. */
export function mJust(b: boolean): MaybeBool {
  return b ? mJustTrue : mJustFalse;
}

/** Lift a `boolean | undefined` value. `undefined` becomes `Nothing`,
 *  `true`/`false` become the corresponding singletons. */
export function mFromOptional(b: boolean | undefined): MaybeBool {
  if (b === undefined) return mNothing;
  return mJust(b);
}

/** Default-extraction: convert tri-state to binary by collapsing
 *  `Nothing` to the supplied default. The brief-recommended boundary
 *  helper for callers that need a non-tri-state surface. */
export function mGet(mb: MaybeBool, defaultValue: boolean): boolean {
  return mb.$tag === "Just" ? mb._0 : defaultValue;
}

/** True only when `mb` is `Just true`. */
export function isJustTrue(mb: MaybeBool): boolean {
  return mb.$tag === "Just" && mb._0 === true;
}

/** True only when `mb` is `Just false`. */
export function isJustFalse(mb: MaybeBool): boolean {
  return mb.$tag === "Just" && mb._0 === false;
}

/** True when `mb` is `Nothing`. */
export function isNothing(mb: MaybeBool): boolean {
  return mb.$tag === "Nothing";
}

/** True when `mb` is `Just _` (decided either way). */
export function isJust(mb: MaybeBool): boolean {
  return mb.$tag === "Just";
}

/** Logical NOT lifted into the tri-state lattice. `Nothing` stays
 *  `Nothing` (we can't refute what we can't decide). */
export function mNot(mb: MaybeBool): MaybeBool {
  if (mb.$tag === "Nothing") return mNothing;
  return mJust(!mb._0);
}

/**
 * Conjunction over a list of `MaybeBool`s. Semantics:
 *
 *   - Any `Just false` → `Just false` (one refutation kills the AND)
 *   - All `Just true`  → `Just true`
 *   - Otherwise        → `Nothing`
 *
 * Short-circuits on the first `Just false` for performance — relevant
 * when the inputs come from expensive structural reasoning over deeply
 * nested compounds.
 */
export function mAll(mbs: MaybeBool[]): MaybeBool {
  let sawNothing = false;
  for (const mb of mbs) {
    if (isJustFalse(mb)) return mJustFalse;
    if (isNothing(mb)) sawNothing = true;
  }
  return sawNothing ? mNothing : mJustTrue;
}

/**
 * Disjunction over a list of `MaybeBool`s. Semantics:
 *
 *   - Any `Just true`  → `Just true` (one witness proves the OR)
 *   - All `Just false` → `Just false`
 *   - Otherwise        → `Nothing`
 *
 * Short-circuits on the first `Just true`.
 */
export function mAny(mbs: MaybeBool[]): MaybeBool {
  let sawNothing = false;
  for (const mb of mbs) {
    if (isJustTrue(mb)) return mJustTrue;
    if (isNothing(mb)) sawNothing = true;
  }
  return sawNothing ? mNothing : mJustFalse;
}

/** Short-circuit `mAll` over a lazy iterator. Stops as soon as a
 *  `Just false` shows up; useful when the inputs are expensive. */
export function mEvery<T>(items: readonly T[], f: (t: T) => MaybeBool): MaybeBool {
  let sawNothing = false;
  for (const t of items) {
    const mb = f(t);
    if (isJustFalse(mb)) return mJustFalse;
    if (isNothing(mb)) sawNothing = true;
  }
  return sawNothing ? mNothing : mJustTrue;
}

/** Short-circuit `mAny` over a lazy iterator. Stops as soon as a
 *  `Just true` shows up. */
export function mSome<T>(items: readonly T[], f: (t: T) => MaybeBool): MaybeBool {
  let sawNothing = false;
  for (const t of items) {
    const mb = f(t);
    if (isJustTrue(mb)) return mJustTrue;
    if (isNothing(mb)) sawNothing = true;
  }
  return sawNothing ? mNothing : mJustFalse;
}
