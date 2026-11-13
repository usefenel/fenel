// ---------------------------------------------------------------------------
// Dependent types — the unified `$el` substrate.
//
// Phase 1 collapse (see `design/structural-introspection.md` Instance 4):
// the four overlapping primitives `$el` / `$dep` / `$apply` / `$depend`
// reduce to one — `$el` over a Fenel function returning a Type value.
//
//   $apply { type: Vec, args: { n: 3 } }
//     ≡  $el { call: ["Vec", 3] }            where Vec : Nat -> Type
//
//   $dep { params: [{ name: "n", type: Nat }], body }
//     ≡  Fenel function:   λn. body          (a function returning a Type)
//
//   $depend { guards: [{when, type}], default }
//     ≡  $el { match: [...] }                (or ifElse fold)
//
// This module provides:
//
//   - TS-side type constructors (Vec, LengthBoundedString, Sigma) that
//     produce concrete refined / record types directly. No special
//     dependent-type wrapper is needed when `n` is statically known.
//
//   - Late-binding constructors (vecOfLength, lengthBoundedStringOf,
//     SigmaOn) that produce `$el { call: [...] }` shapes for cases where
//     the parameter is sourced from a sibling record field at runtime.
//
//   - `resolveEl` / `peelEl` / `containsType` — the runtime helpers that
//     evaluate `$el` against context and validate values against the
//     resolved type.
//
// unified-static-analysis Phase 3b-5 — `resolveEl` / `peelEl` / `containsType`
// are now the `$`-key MARSHAL SEAM (category B), NOT pure logic. The 7a scope-out
// left them in TS solely because the evaluator re-entry had no Fenel-callable
// entry; Phase 8's `evaluateWith` closed that hole, so `resolveEl`'s evaluation
// now routes through the Fenel `engine:resolveElPayload` body (eager strategy).
// What remains TS here is irreducibly the `$`-key barrier: the `"$el" in t`
// recognition, the `isFenelType` gate on the `$`-keyed resolved value, the fuel
// loop, and the `contains`∘`typeToSetExpr` collapse — every one inspects or
// marshals `$`-keyed FenelTypes a `.fenel` body cannot author/walk. The pure
// logic they compose is ALREADY Fenel (`engine:typeToSetExpr` + `engine:contains`
// + `engine:isFenelType` + the `evaluateWith` re-entry). The FenelType FACTORIES
// (Vec / LengthBoundedString / Sigma / SigmaGuards / …) below stay TS as the
// `$`-key-AUTHORING residual (the marshal barrier) — fenced to a follow-up 3b-5b.
// ---------------------------------------------------------------------------

import type { FenelType, SetExpr, Expression } from "./types";
import { dispatchedIsFenelType, dispatchedResolveElPayload } from "./engine-bodies-dispatch";
import { engineRequire } from "./engine-require";

// ---------------------------------------------------------------------------
// Vec — list of length n
// ---------------------------------------------------------------------------

/**
 * `Vec(elemType, n)` — THE canonical fixed-length vector `Vec n a = $map (Fin n)
 * a` (array-substrate Phase 1a.5). When `n` is a concrete number the result is
 * the fully-resolved `$map` form directly; when `n` is an Expression (typically
 * `{var: "..."}` referencing a sibling field), the result is wrapped in `$el` so
 * the validator resolves the length at runtime (the `vecOfLength` late-bound path
 * — now itself emitting the `$map` form).
 *
 *   Vec({ $ref: "Number" }, 3)
 *     → $map { keys: Fin 3 ([0,3)), values: Number }        (total indexing)
 *
 *   Vec({ $ref: "Number" }, { var: "len" })
 *     → $el { call: ["vecOfLength", Number, { var: "len" }] }
 *
 * RETIRED-BY-SUBSUMPTION: the former `$refined List (length==n)` encoding only
 * tracked length (you still got `List`'s partial `Maybe` indexing). The `$map
 * (Fin n)` form proves indexing is TOTAL and inherits the Phase-1a `(Map k)`
 * algebra. Migrate, don't delete — every old `Vec(...)` call site now yields the
 * stronger canonical form.
 */
export function Vec(elemType: FenelType, n: number | Expression): FenelType {
  if (typeof n === "number") {
    return VecMap(elemType, n);
  }
  return { $el: { call: ["vecOfLength", elemType, n] } };
}

function lengthEqualsExpr(nExpr: Expression): SetExpr {
  return { $tag: "SeWhere", pred: {
      "==": [{ call: ["length", { var: "value" }] }, nExpr],
    } as Expression };
}

// ---------------------------------------------------------------------------
// LengthBoundedString — string of n codepoints
// ---------------------------------------------------------------------------

/**
 * `LengthBoundedString(n)` — a String of exactly `n` codepoints. Since `String =
 * List Char`, a length-`n` string IS `Vec n Char` (array-substrate Phase 1a.5 —
 * the normalization law generalises one insight to two former special-cases). So
 * the concrete-`n` form is `Vec n Char = $map (Fin n) Char`; the Expression form
 * stays the `$el { call: ["lengthBoundedStringOf", n] }` late-bound path (now
 * itself emitting the `$map` form).
 */
export function LengthBoundedString(n: number | Expression): FenelType {
  if (typeof n === "number") {
    return VecMap({ $ref: "Char" }, n);
  }
  return { $el: { call: ["lengthBoundedStringOf", n] } };
}

// ---------------------------------------------------------------------------
// Sigma — dependent pair { fst, snd } where snd's type may depend on fst
// ---------------------------------------------------------------------------

/**
 * `Sigma(fstType, sndType)` — dependent pair as a record { fst, snd }.
 *
 * `sndType` may be `$el` whose expression references `{ var: "fst" }` for
 * dependent dispatch. Validation context (formData) carries `fst`'s
 * resolved value while validating `snd`.
 */
export function Sigma(fstType: FenelType, sndType: FenelType): FenelType {
  return {
    $record: {
      fields: [
        { name: "fst", label: Just("fst"), type: fstType, meta: {}, ui: Nothing },
        { name: "snd", label: Just("snd"), type: sndType, meta: {}, ui: Nothing },
      ],
    },
  };
}

/**
 * `SigmaGuards(fstType, guards, default)` — Sigma where snd's type is
 * selected by guard predicates over fst's value. Equivalent to using
 * `Sigma(fstType, { $el: { match: [...flattenedGuards, default] } })`.
 *
 * Each guard's `when` is a JSON Logic predicate that evaluates against
 * the record being typed (so `{ var: "fst" }` resolves at runtime). The
 * first matching guard's type wins; if no guard matches, `default` is used.
 *
 * Internally this builds an `if-else` chain over the guards so the type
 * dispatch falls out of the standard `$el` resolution path.
 */
export function SigmaGuards(
  fstType: FenelType,
  guards: { when: Expression; type: FenelType }[],
  defaultType: FenelType,
): FenelType {
  const sndType: FenelType = { $el: guardsToIfChain(guards, defaultType) };
  return Sigma(fstType, sndType);
}

/** Build a nested if-else chain from a guards list, terminated by `default`.
 *  Type values (`{$named: "Number"}`, `{$record: ...}`, `{$el: ...}`) are
 *  single-key objects whose key is not a known JSON-Logic operator, so the
 *  evaluator returns them as-is — no special quoting needed. */
function guardsToIfChain(
  guards: { when: Expression; type: FenelType }[],
  defaultType: FenelType,
): Expression {
  let acc: Expression = defaultType as unknown as Expression;
  for (let i = guards.length - 1; i >= 0; i--) {
    const g = guards[i]!;
    acc = { if: [g.when, g.type, acc] } as unknown as Expression;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// $type / $el — type-as-value bridge
// ---------------------------------------------------------------------------

import { contains, mGet } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import { type EvaluateContext } from "./json-logic";
import { Just, Nothing, Vec as VecMap } from "./type-foundation";

/** Best-effort runtime check: is this value a FenelType? Used for validating
 *  membership in `$type` (the universe). Recognises any object with a single
 *  `$`-prefixed key drawn from the FenelType constructor set.
 *
 *  Phase 7a — implementation dispatches through `dispatchedIsFenelType`
 *  in engine-bodies-dispatch.ts; the membership check runs in the Fenel
 *  body at `fenel/modules/engine/dependent-types.fenel`. The null /
 *  non-object / array / empty-object short-circuits stay TS-side. */
export function isFenelType(v: unknown): v is FenelType {
  return dispatchedIsFenelType(v);
}

/** Resolve an `$el { e }` type to the concrete FenelType it denotes by
 *  evaluating the wrapped Expression against the given context. Returns
 *  `undefined` when evaluation fails or the result isn't a FenelType —
 *  callers should treat that as an unresolved/open type and fall back to
 *  whatever rendering / validation behaviour they prefer.
 *
 *  unified-static-analysis Phase 3b-5 — the evaluator re-entry now rides the
 *  shipped Fenel `engine:resolveElPayload` body (which evaluates the OPAQUE
 *  payload under the eager strategy via `evaluateWith` → the `evalApply`
 *  re-entry leaf), retiring the direct TS `resolveEvaluator` call the 7a arc
 *  scoped out. This thin wrapper is the `$`-key MARSHAL SEAM (category B): the
 *  `"$el" in type` short-circuit + the `isFenelType` gate on the `$`-keyed
 *  resolved value (which a `.fenel` body cannot key-introspect — the `$`-barrier)
 *  stay TS, delegating to the already-Fenel `engine:isFenelType`. The Fenel body
 *  collapses an evaluator `Err` to `Nothing` ⇒ `undefined`; the try/catch retains
 *  the legacy throw-on-failure ⇒ `undefined` posture for any host-side throw the
 *  eager native doesn't itself trap. */
export function resolveEl(
  type: FenelType,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): FenelType | undefined {
  if (!("$el" in type)) return type;
  try {
    if (evalCtx?._typeFamilyOwner !== undefined) {
      const { expandCallableTypeFamily } = engineRequire("callable-type-families") as typeof import("./callable-type-families");
      const family = expandCallableTypeFamily(type, evalCtx);
      if (family.handled) return family.type;
    }
    const result = dispatchedResolveElPayload(type.$el, ctx, evalCtx);
    if (isFenelType(result)) return result;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Peel `$el` layers to a concrete underlying type, given a context.
 *  Recursive — an `$el` whose value is itself an `$el` is fully unwrapped.
 *  Returns `undefined` if any `$el` along the chain fails to resolve.
 *
 *  Phase 3b-5 — the fuel-bounded loop stays the `$`-key marshal seam: each
 *  iteration's `"$el" in cur` recognition inspects a `$`-keyed FenelType the body
 *  cannot key-walk; the resolution step delegates to the Fenel re-entry via
 *  `resolveEl`. (32-deep guard preserved verbatim — the TS cycle bound.) */
export function peelEl(
  type: FenelType,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): FenelType | undefined {
  return peelElBoundary(type, ctx, evalCtx, 32);
}

/** The outer refinement is a dollar-key codec envelope, not another evaluator.
 * Keep its predicate while the existing resolver evaluates a dependent base. */
function peelElBoundary(
  type: FenelType,
  ctx: Record<string, unknown> | undefined,
  evalCtx: EvaluateContext | undefined,
  remaining: number,
): FenelType | undefined {
  let cur: FenelType | undefined = type;
  while (cur && "$el" in cur) {
    if (remaining-- <= 0) return undefined;
    cur = resolveEl(cur, ctx, evalCtx);
  }
  if (cur && "$refined" in cur) {
    if (remaining <= 0) return undefined;
    const base = peelElBoundary(cur.$refined.base, ctx, evalCtx, remaining - 1);
    return base === undefined ? undefined : { ...cur, $refined: { ...cur.$refined, base } };
  }
  return cur;
}

/**
 * `containsType(type, value, ctx?, evalCtx?)` — boolean membership check
 * that resolves `$el` against the supplied context first.
 *
 *   const Vec3 = Vec({ $named: "Number" }, 3);
 *   containsType(Vec3, [1, 2, 3]);   // true
 *   containsType(Vec3, [1, 2]);      // false
 *
 *   // late-bound: n comes from a sibling field
 *   const VecN = Vec({ $named: "Number" }, { var: "n" });
 *   containsType(VecN, [1, 2, 3], { n: 3 });   // true
 */
export function containsType(
  type: FenelType,
  value: unknown,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): boolean {
  const resolved = peelEl(type, ctx, evalCtx) ?? type;
  // `contains` returns MaybeBool (Phase 4). At this boundary we collapse
  // `Nothing` to `false` — `containsType` is a binary membership predicate
  // surfaced to validation / type-checks; preserving the conservative-false
  // posture keeps unrelated tests stable. New call sites that want the
  // tri-state value should call `contains` directly.
  return mGet(contains(typeToSetExpr(resolved), value, null, ctx, evalCtx), false);
}

// ---------------------------------------------------------------------------
// Type-level Fenel functions registered for `$el { call: [...] }`
// ---------------------------------------------------------------------------
//
// The runtime dispatchers for `$el { call: ["vecOfLength", ...] }` and
// `$el { call: ["lengthBoundedStringOf", ...] }` live in `modules/std.ts`
// (see _typeDefined and stdNatives.vecOfLength / .lengthBoundedStringOf).
// They are inlined there to break a `system-entities → std → dependent-types`
// initialization cycle. The shape they emit matches the eager forms above —
// pure, side-effect-free, semantically identical.

// Re-export for tests that want to construct `$el`-late-bound types via
// expression-builders rather than the convenience constructors above.
export { lengthEqualsExpr };
