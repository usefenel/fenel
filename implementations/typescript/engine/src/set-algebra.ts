// ---------------------------------------------------------------------------
// Set Algebra — the universal constraint engine
//
// Types ARE sets. Validation = set membership. Subtyping = set inclusion.
//
// Operations:
//   contains(set, value)   — is this value in the set? (validation)
//   isSubset(a, b)         — is every element of a also in b? (subtyping)
//   normalize(set)         — simplify a SetExpr
//   fromNumberConstraints  — legacy NumberConstraints → SetExpr
//   fromStringConstraints  — legacy StringConstraints → SetExpr
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import { noteEngineBodyMemoTaint } from "./engine-body-memo";
import type { ContainmentDispatchOptions } from "./engine-bodies-dispatch";
import type {
  SetExpr,
  Interval,
  Pattern,
  Expression,
  MaybeExpr,
  FenelType,
} from "./types";

// Legacy constraint shapes — inlined here for the bridge functions.
// These types no longer exist in types.ts; the bridges convert old
// schema data (e.g. from DB) into the new SetExpr system.
type NumberConstraints = {
  integer?: boolean;
  min?: MaybeExpr<number>;
  max?: MaybeExpr<number>;
  exclusiveMin?: MaybeExpr<number>;
  exclusiveMax?: MaybeExpr<number>;
  multipleOf?: number;
};
type StringConstraints = {
  minLength?: MaybeExpr<number>;
  maxLength?: MaybeExpr<number>;
  pattern?: string;
  format?: string;
  transform?: string[];
};
import { type EvaluateContext } from "./json-logic";
import {
  peelSetExpr,
  buildSetExpr,
  setExprToTag,
  isDegradedTypeProjection,
  normalizeSetPattern,
} from "./set-marker";
import { patternSubset, patternDisjoint, extractCaptures } from "./pattern";
// regex-derivative-to-fenel Phase 1a-cont — `patternToRegex` /
// `regexPatternSubset` / `regexPatternDisjoint` are no longer imported: the
// `$pattern ⊆ $pattern` / `$pattern ∩ $pattern` round-trip into the regex
// engine is dropped in favour of the Fenel structured-partition decider (see
// setPatternDecide{Subset,Disjoint}). `regexStringToPattern` stays (the
// regex-source → Pattern front-end is still a marshal leaf).
import { regexStringToPattern } from "./regex-shim";
// set-algebra-to-fenel Phase 3a-1 — the `isAggregable` import was used only by
// the retired TS `recognizeAggregableComposition`; the Fenel recogniser checks
// aggregable-membership against the fed `aggNames` table instead.
import {
  type MaybeBool,
  mNothing,
  mJust,
  mJustTrue,
  mJustFalse,
  mGet,
  mNot,
  isJustTrue,
  isJustFalse,
  isNothing,
} from "./maybe-bool";

// Re-export the tri-state primitive so callers don't double-import.
export type { MaybeBool };
export { mGet, mJust, mNothing, isJustTrue, isJustFalse, isNothing } from "./maybe-bool";

import { Just, Nothing, Ref, isRef, refHandle, type RefValue } from "./type-foundation";
import { GLOBAL_ONLY, instanceVisible } from "./dispatch-registry";

// ---------------------------------------------------------------------------
// `{$ref}` in type position — typed-function-references Phase 7f.
//
// The structural recognizers (`peel*` / `isSubtype`) learn to treat a `{$ref}`
// as the type it denotes. Per Hard fact 1 (the `type-catalog` ↔ `set-algebra`
// import cycle) the `getEntityType` half of resolution can NOT be imported here
// — the caller injects a `RefResolve` callback (built from `refType` +
// `evalCtx.getFunction` + `getEntityTypeByName`). Per Hard fact 2, resolution
// happens at the TS-wrapper ENTRY (resolve-then-recurse, the 7c pattern); the
// Fenel deciders stay purely structural.
//
// `{$ref}` is not (yet) a `FenelType`-union member (that broad change is 7g's
// producer flip), so recognizers recognize it via `isRef` at the boundary with
// a cast — exactly the 7c pattern.
// ---------------------------------------------------------------------------

/** A caller-injected resolver: a `{$ref}` → the referent's structural type
 *  (function → `$arrow`; type/entity → its registered `$record`/`$variant`
 *  kind). Built by the caller from `refType` so the `getEntityType` lookup is
 *  injected, never imported (Hard fact 1). Returns `{$void}` on an
 *  unresolvable handle (never throws). */
export type RefResolve = (ref: RefValue) => FenelType;

/** Resolve a `{$ref}` to the structural type it denotes; pass non-refs through
 *  untouched. An unresolvable ref (no resolver, or the resolver returns
 *  `{$void}`) yields `{$void}` — recognizers read that as "today's unknown
 *  type" and degrade gracefully (null / conservative-false).
 *
 *  Exported (Phase 7f-cont) so `type-algebra`'s `untaggedToVariant` reuses the
 *  one cycle-safe resolver helper rather than re-deriving it. */
export function refToStructural(t: FenelType, resolve?: RefResolve): FenelType {
  if (!isRef(t)) return t;
  return resolve?.(t as unknown as RefValue) ?? { $void: true };
}

/** Resolve a `{$ref}` to its structural type, OR — when unresolvable (no
 *  resolver, or the resolver `{$void}`s) — keep the `{$ref:H}` leaf unchanged
 *  (the type-transparent name-equality leaf; D3: the handle IS the code-name).
 *  A type-position `{$ref:H}` thus decides byte-identically to `{$named:H}`
 *  because the structural recognizers (`peel*` / `isSubtype`) read the
 *  name-handle via `refHandle` on EITHER form.
 *
 *  7g-retire-4a INVERTED this: it formerly rewrote `{$ref:H}` → `{$named:H}`
 *  and re-entered the `{$named}` arm; now it keeps `{$ref}` so the canonical
 *  internal form is the ref (the precondition for -4b removing `{$named}` from
 *  the union). Callers must NOT blind-recurse on the unchanged `{$ref}` (it is
 *  still `isRef` → would loop / hit the co-inductive memo); they resolve once,
 *  recurse on a genuinely-resolved structural type, and dispatch the
 *  still-`{$ref}` leaf to the marshaller (which reads the handle via `refHandle`).
 *
 *  Distinct from `refToStructural` (which `{$void}`s on failure): the SetExpr
 *  deciders keep using `refToStructural` (undecided → `{$void}` → Nothing), so
 *  this targeted helper does not change their semantics. */
export function refToStructuralOrNamed(t: FenelType, resolve?: RefResolve): FenelType {
  if (!isRef(t)) return t;
  const resolved = refToStructural(t, resolve);
  if (!("$void" in resolved)) return resolved;
  return t;
}

// ---------------------------------------------------------------------------
// Registered-reference resolution in SetExpr position.
//
// The host owns the injected catalog callback, but it does not own SetExpr's
// recursive semantics. Ask the existing Fenel `seRefHandles` walk for the
// handles, then apply each valid replacement through Fenel's capture-avoiding
// `substSet`. That body already walks all recursive formers and respects SeMu
// shadowing, so widening the registered ADT cannot create another partial TS
// recursion here.
// ---------------------------------------------------------------------------

/** Resolve the free SeRef leaves that an injected catalog knows about.
 * Unresolvable handles remain named-set leaves. A handle resolving to a
 * non-SetExpr structural type makes the surrounding set undecidable. */
function resolveSetExprAtEntry(set: SetExpr, resolve?: RefResolve): SetExpr | null {
  if (!resolve) return set;

  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const handles = dispatchEngineBody("engine:seRefHandles", [set, []]);
  if (!Array.isArray(handles)) return null;

  let resolvedSet = set;
  for (const handle of new Set(handles.filter((value): value is string => typeof value === "string"))) {
    const resolved = resolve(Ref(handle));
    if (resolved && typeof resolved === "object" && "$void" in resolved) continue;
    if (peelSetExpr(resolved) === null) return null;

    const next = dispatchEngineBody("engine:substSet", [
      handle,
      setExprToTag(resolved, { admitValidationRigid: true }),
      resolvedSet,
    ]);
    if (peelSetExpr(next) === null) return null;
    resolvedSet = setExprToTag(next, { admitValidationRigid: true });
  }
  return resolvedSet;
}

// ---------------------------------------------------------------------------
// Aggregate-shape recognition (Phase 9 — `Aggregable` typeclass)
//
// `$preimage(agg, set)` retired in Phase 3 (see design/structural-
// introspection.md Instance 1). The aggregate-style predicate shape now
// lives directly inside `$where` — e.g. `length(value) >= 5` is just
// `{$where: {">=": [{call: ["length", {var: "value"}]}, 5]}}`. The
// runtime evaluates this correctly via the explicit `length` call.
//
// Phase 9 restores the structural-subtype reasoning the retired
// `$preimage` constructor enabled, via the `Aggregable` typeclass +
// composition-shape recognition. The `recognizeAggregableComposition`
// helper inspects a `$where` predicate AST; when it finds the explicit
// composition `{op: [{call: [aggFnName, {var:"value"}]}, K]}` with
// `aggFnName` registered as `Aggregable`, it lifts to a SetExpr over the
// aggregator's *output* type. The setWhereDecideSubset /
// setWhereDecideDisjoint / setWhereDecideEmpty procedures use the
// recogniser to delegate to set-algebra reasoning in the output space
// when both sides share the same aggregator — restoring
// `preimage(agg, S1) ⊆ preimage(agg, S2) ⇐ S1 ⊆ S2` as a sound rule.
//
// User aggregators participate by registering an `Aggregable` instance
// via `aggregable.registerAggregable(name)` — no engine extension. The
// std aggregators (length / count / sum / avg / minimum / maximum /
// distinctCount) pre-register at the aggregable module's load time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Membership — "is this value in the set?"
//
// The per-shape membership procedures (`setAllContains`, `setEnumContains`,
// …) are thin shims over the Fenel deciders; the `decidable-membership`
// module exposes them as the `set:setXContains` natives, which the
// DecidableMembership instances reference. The top-level `contains` does not
// go through them or through any instance: it calls the Fenel `contains`
// decider, which switches on the shape itself.
// ---------------------------------------------------------------------------

// -- Per-shape contains impls. Each returns the membership decision for
// -- its specific shape. The shapes are exported so the decidable-membership
// -- module can wrap them as Fenel functions with DecidableMembership
// -- instances. ----------------------------------------------------------

export function setAllContains(_set: SetExpr, _value: unknown): MaybeBool {
  return mJustTrue;
}

export function setNoneContains(_set: SetExpr, _value: unknown): MaybeBool {
  return mJustFalse;
}

export function setEnumContains(set: Extract<SetExpr, { $tag: "SeEnum" }>, value: unknown): MaybeBool {
  // Phase 7b — body lives in fenel/modules/engine/set-algebra-deciders.fenel.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSetEnumContains } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedSetEnumContains(set.values, value) as MaybeBool;
}

export function setIntervalContains(set: Extract<SetExpr, { $tag: "SeInterval" }>, value: unknown): MaybeBool {
  return inInterval(set.interval, value);
}

export function setNamedContains(
  set: Extract<SetExpr, { $tag: "SeRef" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // named-membership-to-fenel Phase 1 — the decision is Fenel-decided via the
  // `dispatchedNamedContains` marshal wrapper (the `Membership` registry + the
  // `engine:namedContains` body); the un-ported `NAMED_SETS` names are reached
  // by its dual-registry fall-through (`containsNamedGlobal`). This mirrors the
  // `setWhereContains` shim. 7g-retire-4a INVERT: read the name-handle via
  // `refHandle` (`{$ref}`/`{$named}`).
  //
  // decide-substrate (named-leaf honesty tail) — TRI-STATE: a KNOWN name's
  // verdict is `Just b`; an UNKNOWN name is `Nothing` (was a hard `Just false`
  // — the closed-world read that falsely refuted e.g. `botValue ∈ ⟦Bot⟧` for
  // entity names the membership registry doesn't know).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedNamedContains } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const tri = dispatchedNamedContains(set.handle, value, requestAccount, ctx, evalCtx);
  return tri.$tag === "Just" ? mJust(tri._0) : mNothing;
}

export function setPatternContains(
  set: Extract<SetExpr, { $tag: "SePattern" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  if (typeof value !== "string") return mJustFalse;
  const pattern = normalizeSetPattern(set.pattern);
  if (pattern === null) return mNothing;
  const chars = [...value];
  // named-membership-to-fenel Phase 2 (Step 4) — the `{$pattern}` direct-path
  // membership SHAPE-MATCH decision now routes through the Fenel
  // `engine:memberPat` (`dispatchedPatternMember`), closing the `$pattern` arm
  // of the contains codec (the same decider the format named-sets use). The
  // WsWhere fence inside `dispatchedPatternMember` falls back to the TS
  // `patternMatch` leaf when the pattern carries a non-char-orderable predicate
  // (a `$where`/`$named`-nested match pred a `$pattern` value CAN carry) — so a
  // typed-group `$pattern` is byte-identical to HEAD. The typed-group captures
  // recursion below is unchanged (it already recurses through the Fenel
  // `contains`); groups are transparent to the shape match (`marshalPatternToPat`
  // flattens them, matching `patternMatch`).
  //
  // decide-substrate Phase 4T Step W2 — route through the TRI face. The boolean
  // `dispatchedPatternMember` cannot distinguish "this character REFUTES the
  // pred" from "this character's pred is UNDECIDED", because `pattern.ts:deriv`
  // maps both to the empty derivative. Re-lifting that `false` into `mJustFalse`
  // made an abstention into a refutation, which enum∩pattern disjointness then
  // read as PROOF of disjointness and `decideEmpty` accepted — a kernel-visible
  // false `Just`. `dispatchedPatternMemberTri` abstains whenever any collected
  // pred is outside the codepoint-total fragment; see its comment for why the
  // fence covers BOTH polarities (this seam drops `ctx`/`evalCtx` below, so a
  // `$where` pred inside a pattern is evaluated in the wrong environment).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPatternMemberTri } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const shape = dispatchedPatternMemberTri(pattern, value);
  if (shape.$tag === "Nothing") return mNothing;
  if (!shape._0) return mJustFalse;
  // Typed groups: any group with a `type` SetExpr requires its captured
  // substring to also satisfy that type. Lets one $pattern say "URL whose
  // path segment matches format:path" or "ID whose checksum digit is in [0-9]".
  const captures = extractCaptures(pattern as Pattern, chars);
  if (captures === null) return mJustFalse;
  for (const cap of captures) {
    if (!cap.type) continue;
    const captured = cap.values.join("");
    const sub = contains(cap.type, captured, requestAccount, ctx, evalCtx);
    if (isJustFalse(sub)) return mJustFalse;
    if (isNothing(sub)) return mNothing;
  }
  return mJustTrue;
}

/** Decide `value ∈ {$where: predicate}`.
 *
 *  set-algebra-to-fenel Phase 2b-contains-where — the predicate-evaluation
 *  now routes through the shipped Fenel `evaluateWith` (expr-substrate Phase 8)
 *  via `dispatchedWhereContains`, RETIRING the direct-TS `resolveEvaluator`
 *  re-entry this function used (the same retirement unified-static-analysis
 *  Phase 3b-5 did for the `$el` payload). The membership decision (truthy +
 *  the conservative-`Just false`-on-`Err` posture the lines below described) is
 *  the `.fenel` `engine:whereContainsEval` body; the value-binding context (the
 *  predicate's `{var:"value"}` / `{var:""}` / object-field spread) + the
 *  ctx-merge are threaded by the seam. This is now a thin shim — the marshal
 *  arm in engine-bodies-dispatch.ts calls `dispatchedWhereContains` directly;
 *  this entry stays for the `set:setWhereContains` native + external
 *  (`decidable-membership.ts`) callers, delegating to the SAME path so there is
 *  ONE evaluation path and `resolveEvaluator` no longer touches set-algebra.
 *
 *  decide-substrate Phase 4T Step W2 — the verdict rule is now: `Just b` iff the
 *  predicate terminated normally with a value that IS a host Boolean; a throw, a
 *  non-Boolean result, or an error/abstention value is `Nothing`. (The retired
 *  text here promised an `Err -> Just false` "conservative posture"; `Just false`
 *  is not conservative for membership — only `Nothing` is.) The gate reads the
 *  TOP-LEVEL result only and does NOT close the class: a failure an enclosing
 *  operator already laundered into a Boolean still decides. See the `whereMember`
 *  comment in engine-bodies-dispatch.ts and the `mem.where.prov` UNSOUND-KNOWN row in
 *  design/tcb-ledger.md. */
export function setWhereContains(
  set: Extract<SetExpr, { $tag: "SeWhere" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // set-algebra-to-fenel Phase 3b-3 Step 3 Stage A — the per-leaf
  // `dispatchedWhereContains` seam is RETIRED; the `$where` membership decision
  // rides the `setAlgebraContains` body's `SeWhere` arm (→ `whereContainsEval` →
  // `evaluateWith`). Route through `contains` so there is ONE evaluation path for
  // the `set:setWhereContains` native + the `decidable-membership.ts` caller.
  return contains(set, value, requestAccount, ctx, evalCtx);
}

export function setUnionContains(
  set: Extract<SetExpr, { $tag: "SeUnion" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. Thin shim delegates to the recursive contains
  // dispatcher (which switches on shape internally).
  return contains(set, value, requestAccount, ctx, evalCtx);
}

export function setIntersectContains(
  set: Extract<SetExpr, { $tag: "SeIntersect" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. Thin shim delegates to the recursive contains
  // dispatcher.
  return contains(set, value, requestAccount, ctx, evalCtx);
}

export function setDiffContains(
  set: Extract<SetExpr, { $tag: "SeDiff" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. Thin shim delegates to the recursive contains
  // dispatcher.
  return contains(set, value, requestAccount, ctx, evalCtx);
}

export function setComplementContains(
  set: Extract<SetExpr, { $tag: "SeComplement" }>,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. Thin shim delegates to the recursive contains
  // dispatcher.
  return contains(set, value, requestAccount, ctx, evalCtx);
}

// Phase 7b-recursive — the in-engine fast-path shape table is gone; the
// dispatch lives entirely in the Fenel body via the recursive SetExprAdt
// marshaller in engine-bodies-dispatch.ts. The per-shape `setXxxContains`
// functions above remain as thin TS shims that delegate to the top-level
// `contains` for the few external callers (decidable-membership.ts +
// tests).

/** Check if a value is a member of the set defined by a SetExpr.
 *
 * Calls the Fenel `contains` decider (set-algebra-deciders.fenel) through
 * the engine-bodies-dispatch marshaller; the decider switches on the shape
 * itself, and no DecidableMembership instance is consulted. A new shape is
 * an arm there (plus its DecidableMembership instance, for the laws and
 * the editor).
 *
 * Returns `MaybeBool` (Phase 4): `Just true` / `Just false` for decided,
 * `Nothing` for "couldn't decide structurally" (e.g. an undecided child
 * inside a compound). Callers needing a boolean surface use
 * `containsB(set, value, ctx, evalCtx)` — a thin wrapper that collapses
 * `Nothing` to `false` (conservative-false posture, matching pre-Phase 4
 * behaviour).
 *
 * `evalCtx` exposes a function registry to `$where` predicates so they can
 * call user/std functions via JSON Logic's `call` / `pipe` / `apply`
 * operators. Callers should pass a *purified* registry (see
 * `pureEvaluateContext`) — only functions resolvable to a body or native
 * impl are admissible inside a type. */
/** ⚠ rights R3a — `requestAccount` IS A REQUIRED ARGUMENT WITH NO DEFAULT, and
 *  that is the point (`mem.named.account` in `design/tcb-ledger.md`).
 *
 *  Named-set membership may be decided by an ACCOUNT-OWNED `SetExpr`. Which
 *  account is a fact about the authenticated REQUEST, and it used to be read
 *  out of the value under judgment: `validateValue` passed the VALUE as
 *  `formData`, `dispatchValidationBody` stored `formData` as the decider's
 *  request ctx, and `dispatchedNamedContains` read `ctx.accountId` off it. A
 *  record with an `accountId` field therefore chose whose named set decided its
 *  own validity.
 *
 *  A CONTEXT SLOT CANNOT FIX THAT. `pureEvaluateContext` is a fixed slot list,
 *  the decider door rebuilds `{...harness.ctx, …}`, the composite `+` recursion
 *  and the account arm re-enter through that same door, and `namedMember`
 *  forwards the ORIGINAL bootstrap evalCtx — so a slot is dropped at the first
 *  rebuild. And a dropped account does not fail closed: A's set is skipped and
 *  GLOBAL membership answers instead, which can decide the opposite way. The
 *  transport is therefore an ARGUMENT, threaded through every re-entry.
 *
 *  `null` means "no request account" — global named sets only. Callers that
 *  genuinely hold none (browser-side validation, bootstrap tooling, the engine
 *  callers outside validation) pass it EXPLICITLY, because an omission that
 *  compiled would be the silent wrong answer all over again (brief §8.1a). An
 *  empty string is treated as `null`: an empty id is not an account. */
export function contains(
  set: SetExpr,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
  resolve?: RefResolve,
): MaybeBool {
  if (isDegradedTypeProjection(set)) return mNothing;
  // Resolve catalog-backed SeRef leaves at the wrapper boundary. The recursive
  // walk and capture-avoiding substitution live in Fenel; a non-SetExpr
  // referent degrades to `Nothing`.
  {
    const resolved = resolveSetExprAtEntry(set, resolve);
    if (resolved === null) return mNothing;
    set = resolved;
  }
  if (isDegradedTypeProjection(set)) return mNothing;
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. The TS dispatcher pre-marshalls the SetExpr into the
  // recursive SetExprAdt; opaque arms ($where / $named / $pattern) pre-
  // compute their MaybeBool via the existing TS impls and embed as
  // SeOpaque. The Fenel body dispatches structurally without calling
  // back to TS mid-recursion.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedContains } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const result = dispatchedContains(set, value, requestAccount, ctx, evalCtx);
  // Coerce body's plain {$tag,_0} into the frozen MaybeBool singletons.
  if (result.$tag === "Nothing") return mNothing;
  return mJust(result._0);
}

/** Boolean-collapsed `contains` — `Nothing → false` at the boundary.
 *  Convenience wrapper for callers (validation, structural reasoning)
 *  that need a non-tri-state surface. New callers should consume the
 *  tri-state `contains()` directly. */
export function containsB(
  set: SetExpr,
  value: unknown,
  requestAccount: string | null,
  ctx?: Record<string, unknown>,
  evalCtx?: EvaluateContext,
  resolve?: RefResolve,
): boolean {
  return mGet(contains(set, value, requestAccount, ctx, evalCtx, resolve), false);
}

// ---------------------------------------------------------------------------
// decide-substrate Phase 1 Stage B — the widened DecidableMembership surface:
// witness synthesis (the constructive dual of decideEmpty) + finite-extension
// enumeration. Thin shims into the Fenel judgment cores (`engine:inhabit` /
// `engine:enumerateSet` — inhabit.fenel / enumerate.fenel) via the same
// lazy-require dispatch boundary every other decider shim rides; the
// `dispatched*` wrappers normalize `$`-key SetExprs through `setExprToTag`.
// These back the polymorphic `set:witness` / `set:enumerate` dmNatives; the
// DecidableMembership instances reference per-shape `engine` faces instead
// (decide-substrate Phase 3).
// ---------------------------------------------------------------------------

/** Witness synthesis: `Just w` exhibits a member of the set (constructive
 *  non-emptiness); `Nothing` = no canonical witness (empty, out-of-fragment,
 *  or no attained bound — the ℝ honesty fence). Returns the marshalled Maybe
 *  (`{$tag:"Just",_0:w}` / `{$tag:"Nothing"}`). */
export function witnessOf(set: SetExpr): unknown {
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedInhabit } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedInhabit(set);
}

/** Finite-extension enumeration: `Just xs` = the complete, exact, deduped
 *  extension (`Just []` = provably empty — the `Just [] ≠ Nothing` split);
 *  `Nothing` = not finitely enumerable. Returns the marshalled Maybe. */
export function enumerateOf(set: SetExpr): unknown {
  if (isDegradedTypeProjection(set)) return { $tag: "Nothing" };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEnumerateSet } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedEnumerateSet(set);
}

// ---------------------------------------------------------------------------
// Interval membership
//
// Phase 7b-continuation: ported to Fenel. inInterval is now a thin shim
// over dispatchedInInterval. The Fenel body lives in
// fenel/modules/engine/set-algebra-deciders.fenel. The resolveBound /
// boundValue / numericBound helpers (TS file-locals) are also ported and
// the TS versions deleted — all callers are inside the ported set and go
// through dispatched wrappers now.
// ---------------------------------------------------------------------------

function inInterval(iv: Interval, value: unknown): MaybeBool {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedInInterval } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedInInterval(iv, value);
}

// ---------------------------------------------------------------------------
// Named sets — built-in mathematical sets
// ---------------------------------------------------------------------------

// named-membership-to-fenel Phase 2 — `patternMember(src)` builds a `Pattern`
// from a regex source ONCE (lazily, on first validation), then decides
// membership via the Fenel `engine:memberPat` (`dispatchedPatternMember`) —
// reusing the regex-derivative-to-fenel front-end (`regexStringToPattern` =
// the Fenel `engine:regexToPatternMarker`) to build, and the Fenel
// Pattern-membership decider to decide. The Pattern build is DEFERRED to first
// call (not at this NAMED_SETS-definition load) because `regexStringToPattern`
// fires the engine harness, which would re-enter `createRegistry` mid-load (the
// DriveLetter-lazy load-cycle guard). Build failure ⇒ conservative `false`
// (does not occur for the ported sources — each verified to build + agree
// byte-identically across an adversarial sample set before porting).
function patternMember(src: string): (v: unknown) => boolean {
  let pat: import("./types").Pattern | null | undefined;
  return (v) => {
    if (typeof v !== "string") return false;
    if (pat === undefined) pat = regexStringToPattern(src);
    if (pat === null) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchedPatternMember } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    return dispatchedPatternMember(pat, v);
  };
}

// named-membership-to-fenel Phase 1+2 — the PORTABLE closures (numeric tower +
// aliases, String/NonEmpty/Boolean/Bool/Number, the `list:*` exact constraints,
// and the clean string-op `format:path:*` predicates) were PORTED to Fenel
// `Membership` instances (fenel/modules/engine/set-algebra-deciders.fenel) and
// DELETED here — dispatch-first means leaving the closure would silently shadow
// the Fenel decider. The prefix-parameterized families (multiple:N /
// list:maxdiff:N / list:span:N / format:path:max-{depth,length}:N / ext:NAME)
// likewise moved to the Fenel `prefixParamContains` body (their `startsWith`
// branches below are gone). Phase 2 ported the byte-identical-buildable regex
// `format:*` (email / handle / time) to Fenel Pattern-membership via
// `patternMember` (the DECISION is `engine:memberPat`; the name stays here in
// NAMED_SETS, reached via the dual-registry fall-through — Step-0 verdict B,
// the codepoint marshal boundary blocks the registry move). Phase 3 ported
// `format:url*` (all 12 names) + `format:date`/`datetime` to Fenel `Membership`
// instances (pure string-op bodies — `new URL()`/`new Date()` were NOT host
// leaves; URL/date validation is pure logic) and DELETED their closures here.
// Phase 3c ported the LAST six (the regex-resistant ones earlier phases KEPT):
// `format:phone` / `format:ip` / `format:postal-code` / `format:path:windows` /
// `:portable` / `:no-reserved` — all pure string-op `Membership` bodies now,
// byte-identical to the kept regexes.
//
// CAPSTONE CORRECTION (2026-06-23) — the table is NOT empty; two SANCTIONED
// resident classes remain (no `format:*` name is decided by *TS* here, but
// `format:*` names DO remain registered with Fenel-DECIDING closures):
//   • D-A2-blocked format presets — the 3 static `patternMember` entries below
//     (`format:email`/`handle`/`time`; `format:uuid` is a dead static regex,
//     overwritten at load by the `format-presets` preset) PLUS the ~24 runtime
//     `format-presets` registered via `registerNamedSet`. All DECIDE via Fenel
//     (`dispatchedPatternMember` over a TS-pre-built `Pattern` — the opaque-repr
//     perf branch), but CANNOT become `Membership` instances: the codepoint-
//     marshal boundary (no Fenel char→code-point native at the
//     `setAlgebraApplyMember member value` seam) blocks moving a raw-string value
//     into the Fenel decider. Sanctioned residual (D-A2, Phase 2).
//   • Cross-module host names — `string-classes.ts` str:* / `char-classes.ts` /
//     `markup.ts` register their names into THIS table via `registerNamedSet`.
//     Codepoint/Unicode-bound (a different workstream = the future Phase 3b).
// So `containsNamedGlobal` + this table STAY (sanctioned fall-through), and the
// table is the registration surface for those two global residual classes.
/** The ONE `format:email` definition (demo 10, 2026-11-08): the check below
 *  and the cursor hint in validation-hints.ts (which only adds named groups)
 *  compose these two parts, so the hint cannot accept a text the check
 *  refuses, or the reverse. */
export const EMAIL_LOCAL_REGEX = "[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+";
export const EMAIL_DOMAIN_REGEX = "[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+";
const NAMED_SETS: Record<string, (v: unknown) => boolean> = {
  // Format sets — string validation patterns (replaces StringFormat enum)
  // format:email / format:handle / format:time — ported to Fenel Pattern-
  // membership (Phase 2). Sources kept verbatim as the build input.
  "format:email": patternMember(`^${EMAIL_LOCAL_REGEX}@${EMAIL_DOMAIN_REGEX}$`),
  // format:phone — PORTED to a Fenel `Membership` instance (Phase 3c:
  // membershipFormatPhone; strip `[\s\-().]` then `^\+?[0-9]\d{6,14}$`). Closure
  // DELETED (dispatch-first).
  // format:url + the 11 format:url:* presets — PORTED to Fenel `Membership`
  // instances (Phase 3): a pure string-op `parseUrlParts` + the scheme / SSRF /
  // port predicates, ZERO new TS (`new URL()` is NOT a host leaf — URL parsing
  // is pure logic; the old "irreducible host leaf" framing was retracted). The
  // closures were DELETED here (dispatch-first: leaving them would silently
  // shadow the Fenel decider). Bodies: fenel/modules/engine/set-algebra-
  // deciders.fenel (membershipFormatUrl* + parseUrlParts); wiring:
  // MEMBERSHIP_PORTED in system-entities.ts. `+`-composition stays in the
  // wrapper (D-A), re-entering per component.
  "format:uuid": (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  // format:ip — PORTED to a Fenel `Membership` instance (Phase 3c:
  // membershipFormatIp; IPv4 octet-range + IPv6 full/loose-`::` shorthand, the
  // buggy `::` regex reproduced exactly — D-ipv6). Closure DELETED.
  // format:postal-code — PORTED to a Fenel `Membership` instance (Phase 3c:
  // membershipFormatPostalCode; ASCII case handled by the shared alnum helper). Closure
  // DELETED.
  // format:handle — ported to Fenel Pattern-membership (Phase 2).
  "format:handle": patternMember("^@?[a-zA-Z][a-zA-Z0-9._]{0,49}$"),
  // format:bot-token — decide-substrate Phase 4T Step W2. Telegram's
  // `<bot_id>:<35-char-secret>`. It replaces an inline `SeWhere` in
  // modules/telegram.ts whose predicate was `{match:[value, "^\\d+:…$"]}` — NOT
  // a regex test: JSON Logic's `match` is pattern-MATCH (scrutinee, then
  // pattern/result pairs), so the two-argument form has no pair and returned its
  // trailing argument, the regex STRING, for every input. `truthy` on that made
  // EVERY string a valid bot token (measured, including "not-a-token").
  //
  // It lives HERE, beside `format:handle`, and not in format-presets.ts: this
  // table is reachable on every import graph that can validate, whereas
  // format-presets registers only as a side effect of the root aggregator — so a
  // consumer importing `@fenel/engine/validation` or `/modules/telegram` alone
  // would find the name unregistered and reject every token. Same lazy
  // `patternMember` build as its siblings (the load-cycle guard).
  "format:bot-token": patternMember("^\\d+:[A-Za-z0-9_-]{35}$"),
  // format:date / format:datetime — PORTED to Fenel (Phase 3) as a DEFINED
  // clean acceptance set (ISO 8601 date / datetime + the month-name form), NOT
  // the host `new Date()` V8-leniency (Decisions #1 = A: cross-engine-stable,
  // zero new TS). Both names share one `membershipFormatDate` body
  // (set-algebra-deciders.fenel); the closures were DELETED here (dispatch-
  // first). The six existing oracle date cases stay byte-identical.
  // format:time — ported to Fenel Pattern-membership (Phase 2). Shape-only
  // (`25:99` ⇒ true; no range validation) — preserved byte-identically.
  "format:time": patternMember("^\\d{2}:\\d{2}(:\\d{2})?$"),

  // Filesystem path presets — composable via + syntax.
  // named-membership Phase 1 ported the clean string-op flavours (format:path,
  // :posix, :absolute, :relative, :no-{traversal,current,hidden,empty-segment,
  // trailing-sep,null-byte,alt-stream,trailing-space-or-dot}) to Fenel
  // `Membership` instances. Phase 3c ported the three regex-structural ones
  // too — pure string-op Membership bodies, byte-identical to the kept regexes
  // over the Step-0 adversarial differential:
  //   format:path:windows   → engine:membershipFormatPathWindows  (drive + UNC)
  //   format:path:portable  → engine:membershipFormatPathPortable (charset)
  //   format:path:no-reserved → engine:membershipFormatPathNoReserved (CON/…)
  // Their closures were DELETED here (dispatch-first). No `format:*` name is
  // decided by TS in this table — the only `format:*` residents are the 3
  // `patternMember` (Fenel-deciding) entries above + `format:uuid` (dead static
  // regex, overwritten by the runtime preset), all D-A2-blocked from becoming
  // `Membership` instances (see the header note above this object).
};
Object.setPrototypeOf(NAMED_SETS, null);

/** named-membership-to-fenel Phase 1 — the un-ported global named-set lookup
 *  (the dual-registry fall-through head). `dispatchedNamedContains`
 *  (engine-bodies-dispatch.ts) calls this when the Fenel `engine:namedContains`
 *  body returns `Nothing` — i.e. no `Membership` instance covers `name` and no
 *  prefix-parameterized family matched. The conservative-`false` posture on an
 *  unknown name is preserved (a `NAMED_SETS` miss is `false`).
 *
 *  The portable closures + the prefix branches are GONE (ported to Fenel
 *  `Membership` instances + the `prefixParamContains` body — leaving them would
 *  silently shadow the Fenel decider). `+`-composition + account precedence live
 *  in the wrapper (D-A / B2-B3). CAPSTONE VERDICT (2026-06-23): this fall-through
 *  is a SANCTIONED RESIDUAL, NOT a pending delete — it serves the two resident
 *  classes the NAMED_SETS header names (the D-A2-codepoint-blocked format presets,
 *  Fenel-DECIDING; the cross-module `string-classes`/`char-classes`/`markup` host
 *  names = the future Phase 3b). The membership DECISION is already Fenel for every
 *  ported name; deleting this would break the un-ported residents. It stays until
 *  those other arcs land. */
export function containsNamedGlobal(name: string, value: unknown): boolean {
  // S1 engine-body memo: NAMED_SETS is process-global (registerNamedSet).
  noteEngineBodyMemoTaint("process-global read (NAMED_SETS)");
  const check = NAMED_SETS[name];
  return check ? check(value) : false;
}

/** decide-substrate (named-leaf honesty tail) — is `name` a registered
 *  NAMED_SETS entry? Lets `dispatchedNamedContains` distinguish a KNOWN name's
 *  decided-false from an UNKNOWN name's honest `Nothing` (the tri-state
 *  upgrade). Plumbing over the same ledgered dual-registry residual — no new
 *  decision logic. */
export function hasNamedSetGlobal(name: string): boolean {
  noteEngineBodyMemoTaint("process-global read (NAMED_SETS)");
  return NAMED_SETS[name] !== undefined;
}

/**
 * Register a named set with a custom membership predicate.
 *
 * Idempotent overwrite. The name becomes usable via `{ $named: name }` in
 * any SetExpr. Used by format-presets to install Pattern-backed formats
 * (`format:date:us`, `format:hex-color`, ...) without circular-import grief
 * with `pattern.ts`.
 */
export function registerNamedSet(
  name: string,
  predicate: (v: unknown) => boolean,
): void {
  NAMED_SETS[name] = predicate;
}

// ---------------------------------------------------------------------------
// Per-account named-set scope — thin adapters over the unified `Membership`
// dispatch registry (named-membership-to-fenel Phase 4).
//
// Multi-tenant model: each account can register its own named-set definitions
// without polluting (or being polluted by) the global registry. The shape
// mirrors the typeclass-registry's `scope: "account"` pattern.
//
// `contains(set, value, ctx)` and friends consult per-account sets *first*,
// then fall back to the global registry — so an account can override a
// std name like `format:phone` for its own data without affecting other
// tenants. When `ctx.accountId` is unset, only global is consulted.
//
// HISTORY (Phase 4 — the dynamic arm → dispatch:*). The bespoke
// `ACCOUNT_NAMED_SETS` Map (a parallel registry next to `dispatchRegistry`) is
// RETIRED. Account named sets are now `Membership` instances in the ONE unified
// `dispatchRegistry` — the same registry the global `MEMBERSHIP_PORTED` instances +
// the `engine:namedContains` body's `dispatchLookupOne` use. The five functions
// below are thin adapters over `dispatchRegistry.addInstance` / `removeInstance` /
// `listInstances` / `resolve` (the substrate `dispatch:register` /
// `dispatch:unregister` write to).
//
// D-acct-key (the load-bearing Step-0 decision) = **(b) accountId-in-target**.
// The registry's `findInstance` matches purely by `(typeName, args)` + priority
// — it IGNORES `scope` and never receives `accountId` (true accountId-aware
// dispatch matching is the per-request-resolver follow-up account-registries.ts
// defers, NOT built at HEAD). So a generic `scope:"account"` tag would NOT
// isolate tenants: it would leak account A's override into account B AND into
// the no-ctx path (the two tenant-isolation bugs the brief flags). Instead each
// account instance is keyed under an account-QUALIFIED target —
// `account:<accountId>:<name>` — so isolation is STRUCTURAL (by key): a lookup
// only forms the qualified key when `ctx.accountId` is set, and the key embeds
// the accountId, so neither cross-tenant nor no-ctx leakage is possible. This
// sidesteps the deferred resolver entirely. `scope:"account"` is still stamped
// so `removeInstancesByScope("account")` (the bulk refresh wipe) can find them.
//
// The `member` is a data-only Fenel partial: `engine:setAlgebraContains` with
// the account SetExpr collected as its first argument. The account-precedence
// wrapper applies that value through the existing Fenel application helper;
// no host predicate is stored or invoked here. Moving account precedence into
// the namedContains body still belongs to the per-request-resolver follow-up.
//
// Accounts opt in by including `{ accountId: "<id>" }` in the ctx parameter
// of contains/isSubset/etc. (See applyAccountNamedSets in account-registries
// for the bulk-load surface.)
// ---------------------------------------------------------------------------

const ACCOUNT_MEMBERSHIP_CLASS = "Membership";

/** The account-qualified dispatch target for a per-account named set. Embeds
 *  the accountId so isolation is structural (by key) — the lookup only forms
 *  this key when `ctx.accountId` is set, and it can never collide with a global
 *  name (globals key on the bare name) nor with another account's sets. */
function accountNamedSetTarget(accountId: string, name: string): string {
  return `account:${accountId}:${name}`;
}

/** The shared `dispatchRegistry` singleton (lazy-required to avoid a top-level
 *  set-algebra ↔ system-entities cycle; these adapters only run at account-load
 *  / lookup time, long after module init — the established lazy-require seam). */
function accountSpecRegistry(): import("./dispatch-registry").DispatchRegistry {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
  return dispatchRegistry;
}

/** Register a named-set definition scoped to a single account, as a data-only
 *  `Membership` instance under the account-qualified target. Replaces any prior instance for
 *  the same (account, name) first — `addInstance` appends, but the Map this
 *  retired OVERWROTE on re-register, so we mirror that (remove-then-add). */
export function registerAccountNamedSet(
  accountId: string,
  name: string,
  set: SetExpr,
): void {
  const registry = accountSpecRegistry();
  const target = accountNamedSetTarget(accountId, name);
  registry.removeInstance(ACCOUNT_MEMBERSHIP_CLASS, target, accountId);
  registry.addInstance({
    typeName: ACCOUNT_MEMBERSHIP_CLASS,
    args: [target],
    methods: {
      member: {
        __fenelPartial: true,
        fn: Ref("engine:setAlgebraContains"),
        collected: [setExprToTag(set)],
        arity: 2,
      },
    },
    // rights R3a — the OWNERSHIP coordinate, not the retired bare bucket. The
    // key already embedded the account (`account:<id>:<name>`), so isolation
    // was structural at LOOKUP; the scope is what makes it structural at
    // SELECTION and DELETION too.
    scope: { kind: "account", accountId },
  });
}

/** Remove a single account-owned named set. */
export function unregisterAccountNamedSet(accountId: string, name: string): void {
  accountSpecRegistry().removeInstance(
    ACCOUNT_MEMBERSHIP_CLASS,
    accountNamedSetTarget(accountId, name),
    accountId,
  );
}

/** Drop *all* named sets owned by one account. Used by the per-account refresh
 *  path before re-applying the latest set from the DB. Removes every
 *  `Membership` instance under the `account:<accountId>:` prefix AND owned by
 *  that account — rights R3a made the second half load-bearing, so a prefix
 *  collision can no longer reach another owner's row. */
export function clearAccountNamedSets(accountId: string): void {
  const registry = accountSpecRegistry();
  const prefix = `account:${accountId}:`;
  for (const inst of registry.listInstances(ACCOUNT_MEMBERSHIP_CLASS)) {
    const target = inst.args[0];
    if (typeof target === "string" && target.startsWith(prefix)) {
      registry.removeInstance(ACCOUNT_MEMBERSHIP_CLASS, target, accountId);
    }
  }
}

/** List every named-set name currently registered to an account.
 *
 *  ⚠ rights R3a — OWNERSHIP, NOT JUST THE PREFIX (review round 2, Astra). The
 *  target string `account:<id>:<name>` is AUTHORED, so a row account B owns can
 *  spell account A's id in it — and this diagnostic then reported it as one of
 *  A's sets. `getAccountNamedSet` was already safe (it selects under A's own
 *  visibility, so B's row does not answer), which is exactly what made the
 *  divergence quiet: the list said a name existed that the lookup would never
 *  return. A diagnostic that disagrees with the selection it describes is worse
 *  than no diagnostic. */
export function listAccountNamedSets(accountId: string): string[] {
  const prefix = `account:${accountId}:`;
  const out: string[] = [];
  for (const inst of accountSpecRegistry().listInstances(ACCOUNT_MEMBERSHIP_CLASS)) {
    const target = inst.args[0];
    if (typeof target !== "string" || !target.startsWith(prefix)) continue;
    if (!instanceVisible(inst, { kind: "frame", account: accountId, tags: [] })) continue;
    out.push(target.slice(prefix.length));
  }
  return out;
}

/** Look up a per-account named-set member value, or undefined when absent.
 *  The resolved member is a data-only Fenel partial; the wrapper applies it
 *  through `setAlgebraApplyMember` under the live decider context. */
export function getAccountNamedSet(
  accountId: string,
  name: string,
): unknown | undefined {
  // rights R3a — the REQUESTING account is the visibility. `accountId` here is
  // not an ambient read: it arrives as an ARGUMENT threaded from an
  // authenticated IO context through every decider re-entry (§4.5's
  // `mem.named.account` row), and the row it selects must be owned by it. The
  // key already embedded the account; this makes the SELECTION say so too, so a
  // `Membership` row planted at that key by another owner cannot answer.
  const resolved = accountSpecRegistry().resolve(
    accountNamedSetTarget(accountId, name),
    ACCOUNT_MEMBERSHIP_CLASS,
    { kind: "frame", account: accountId, tags: [] },
  );
  return resolved?.member;
}

// ---------------------------------------------------------------------------
// Subset checking — "is A ⊆ B?"
//
// This is necessarily approximate for infinite/predicate sets.
// We handle the structural cases; $where predicates are opaque.
// ---------------------------------------------------------------------------

// set-algebra-to-fenel Phase 3a — the All / None / Enum / Interval / Named
// per-shape `setXxxDecideSubset` exports were Path-B-only duplicates
// (`isSubset`'s marshaller self-reasons these leaves; it only feeds the
// opaque Pattern leaf). Deleted; the
// `dmNatives` entries now delegate Path B to the top-level Fenel `isSubset`
// dispatcher. The raw Pattern/Pattern performance leaf below is a thin host
// shim into the Fenel pattern decider; all shape/tail policy is Fenel.

export function setPatternDecideSubset(
  a: Pattern,
  b: Pattern,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // Pattern subset. regex-derivative-to-fenel Phase 1a-cont — the
  // `patternToRegex → regexPatternSubset` round-trip is DROPPED. `patternSubset`
  // now dispatches to the Fenel `engine:decidePatternSubset` body, whose
  // STRUCTURED interval-endpoint partition reproduces the regex engine's
  // `distinctRanges` precision + linearity on the char fragment (no 2^N
  // blow-up / deep-`.*` stack overflow — the reason the regex fast path
  // existed) and falls back to the 2^N atom-enum only for opaque predicates.
  // The Fenel body is the sole decision path (no TS fallback).
  return mJust(patternSubset(a, b, evalCtx));
}

// set-algebra-to-fenel Phase 3a — `setWhereDecideSubset` / `setUnionDecideSubset`
// were Path-B-only duplicates (2b-where removed the Where arm's Path-A
// pre-compute; the Fenel `SisWhere` / `SisUnion` arms own both). Deleted;
// Path B delegates to the top-level `isSubset` dispatcher.

// set-algebra-to-fenel Phase 3a — `setDiffDecideSubset` / `setComplementDecideSubset`
// were Path-B-only duplicates (both deferred to the tail rules now owned by
// `setAlgebraSubsetTailRules`). Deleted; Path B delegates
// to the top-level `isSubset` dispatcher.

// Phase 7b-recursive — the in-engine fast-path shape table for isSubset
// is gone; dispatch lives in the engine-bodies-dispatch.ts marshaller
// (which inlines the per-shape dispatch for leaves and delegates
// compound recursion to the Fenel body). The per-shape
// `setXxxDecideSubset` functions above remain as the inlineable
// leaf-decider entry points the marshaller calls.

/** Conservative subset check: returns `Just true` only when provably A ⊆ B.
 *
 * Tri-state return (Phase 4): `Just true` = proven; `Just false` = a per-
 * shape impl returned a positive refutation; `Nothing` = couldn't decide.
 * Callers that need a boolean surface use `isSubsetB(a, b)` — a thin
 * wrapper that collapses `Nothing` to `false` (conservative-false posture,
 * matching pre-Phase 4 semantics).
 *
 * Calls the Fenel subset decider (set-algebra-deciders.fenel) through the
 * engine-bodies-dispatch marshaller, which switches on the shapes itself;
 * no DecidableMembership instance is consulted (the `set:set<Shape>DecideSubset`
 * natives the instances reference delegate back here).
 *
 * `evalCtx` is forwarded into `contains()` for the few branches that
 * need to evaluate predicates against concrete enum values (e.g.
 * `{x, y} ⊆ pattern`). Threaded for symmetry; in practice these branches
 * already exclude `$where` via structural extraction or `isValueOnlyPredicate`. */
export function isSubset(a: SetExpr, b: SetExpr, evalCtx?: EvaluateContext, resolve?: RefResolve): MaybeBool {
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) return mNothing;
  // Resolve catalog-backed SeRef leaves on both sides through the Fenel walk.
  {
    const ra = resolveSetExprAtEntry(a, resolve);
    const rb = resolveSetExprAtEntry(b, resolve);
    if (ra === null || rb === null) return mNothing;
    a = ra;
    b = rb;
  }
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) return mNothing;
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. The TS dispatcher pre-marshalls (a, b) into the
  // recursive SetExprIsSubsetAdt; per-shape leaf decisions pre-computed
  // at the marshaller via inline non-shim per-shape dispatch (avoids
  // the shim → dispatched → marshaller cycle). The Fenel body
  // dispatches structurally over a's Union / Intersect compounds with
  // pre-computed fallbackTail for the no-positive-proof case.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedIsSubset } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const result = dispatchedIsSubset(a, b, evalCtx);
  if (result.$tag === "Nothing") return mNothing;
  return mJust(result._0);
}

/** Boolean-collapsed `isSubset` — `Nothing → false` at the boundary.
 *  Use this where a non-tri-state surface is needed; new callers should
 *  consume the tri-state `isSubset()` directly so the kernel / Prover
 *  can reason about the witness vs the absence-of-disproof. */
export function isSubsetB(a: SetExpr, b: SetExpr, evalCtx?: EvaluateContext, resolve?: RefResolve): boolean {
  return mGet(isSubset(a, b, evalCtx, resolve), false);
}

// The last TS `whereToSetExpr` shim retired with `_subsetTailRules` in
// floor-kernel Phase 4. Extraction remains Fenel-owned and is exposed only by
// the mandatory JSON-Logic marshal adapter in engine-bodies-dispatch.ts.

// set-algebra-to-fenel Phase 3a-1 — `compToSet` shim DELETED (its only
// consumer was the retired TS `recognizeAggregableComposition`; the Fenel
// recogniser lifts comparisons via the `engine:compToSet` body directly, and
// the marshaller's other callers use `dispatchedCompToSet`).

// flipComp — the TS function-local shim is gone; its single caller
// (compToSet, also now a Fenel-bodied shim) inlines the flip via the
// Fenel body's `flipComp`. Body in fenel/modules/engine/set-algebra-
// deciders.fenel; dispatched via `dispatchedFlipComp` in
// engine-bodies-dispatch.ts.

// ---------------------------------------------------------------------------
// Aggregable composition-shape recognition (Phase 9)
//
// Recognises an explicit aggregator call inside a comparison predicate:
//
//   {op: [{call: [aggFnName, {var: "value"}]}, K]}      — agg on the left
//   {op: [K, {call: [aggFnName, {var: "value"}]}]}      — agg on the right
//   {in: [{call: [aggFnName, {var: "value"}]}, [...]]}  — set membership
//
// Returns a lifted output-space SetExpr (`compToSet(op, K)` or an `$enum`
// from the `in` case) and the aggregator name, *only* when the function
// is registered as `Aggregable` via the aggregable module. Recognition
// against unregistered functions returns `undefined` — the algebra falls
// through to the existing conservative answer.
//
// This is the load-bearing primitive for Phase 9's $where-decide
// procedures: when both sides of `decideSubset` / `decideDisjoint` /
// `decideEmpty` carry the same aggregator's composition, the per-side
// outputSets dispatch through Phase 8's polymorphic set-algebra to
// produce a sound (incomplete) decision.
// ---------------------------------------------------------------------------

export type AggregableComposition = {
  readonly aggFn: string;
  readonly outputSet: SetExpr;
};

// set-algebra-to-fenel Phase 3a-1 — the TS recogniser triad
// (`recognizeAggregableComposition` + `aggCallFn` + `isComparable`) was a
// transition duplicate of the Fenel `engine:recognizeAggregableComposition`
// body (set-algebra-deciders.fenel). DELETED; callers route through
// `dispatchedRecognizeAggregableComposition` (the `$`-key marshal boundary
// in engine-bodies-dispatch.ts). The `AggregableComposition` result type
// above stays — it's the wrapper's return shape (re-exported by index.ts for
// downstream Aggregable-instance builders + the aggregable oracle).

// Phase 7b-continuation — interval math ported to Fenel. The TS file-
// local helpers `resolveBound` / `boundValue` / `numericBound` are
// deleted; their callers (all interval ops below) are now thin shims
// over the dispatched wrappers, which carry their own Fenel-side
// helpers. Fenel bodies live in
// fenel/modules/engine/set-algebra-deciders.fenel.

// set-algebra-to-fenel Phase 2c — `intervalDiff` / `intervalMinusEnum` /
// `mergeIntervals` thin shims DELETED: the only consumer was the TS `normalize`
// body (now Fenel-bodied; its mid-recursion interval ops re-enter the
// dispatchers via the `set:norm*` natives).
//
// Phase 3a — `intersectIntervals` / `intervalIsValid` / `intervalSubset`
// shims DELETED too: their only remaining consumers were the per-shape
// Interval deciders (setIntervalDecide{Subset,Disjoint,Empty}), now retired
// as Path-B duplicates. The interval algebra they wrapped lives in the Fenel
// `engine:*` bodies the top-level dispatchers reach.

// containment-substrate Phase 3 Step 2 + Phase 4 — `NAMED_HIERARCHY` DELETED.
// The known named-set inclusions — numeric (ℕ⊂ℤ⊂ℚ⊂ℝ, Step 2) + the char:* / str:*
// codespace-inclusion hierarchy + Bool / String / NonEmpty (Phase 4) — were
// RETIRED from this TS const into `.fenel` instance-extensible `Subsumable`
// instances (fenel/std/dispatch-instances.fenel) — the
// [[feedback_no_language_concept_in_ts]] fix: a per-type Fenel fact (which named
// types subtype which) no longer lives trapped in a TS const. The
// `engine-bodies-dispatch.ts` accessor (`subsumableRows()`) reconstructs every row
// from the global `dispatchRegistry` (the SOLE source now — no const, no merge). The
// DECISION (`engine:namedSubset`) is UNCHANGED — only the DATA SOURCE flipped.
// Adding a named subtype now = add a `.fenel` `Subsumable` instance (the
// registration mechanism engine/DOCS.md §818 asked for). Deriving char-class
// inclusion STRUCTURALLY (from the regex/char-class predicates) is a
// regex-substrate / solver-extension thread — not done here.

// set-algebra-to-fenel Phase 3a — `namedDomain` shim DELETED: its only
// consumer was `setNamedDecideDisjoint` (Path-B duplicate, now retired). The
// `engine:namedDomain` body still backs the marshaller's `$named` disjoint
// leaf via `dispatchedNamedDomain` in engine-bodies-dispatch.ts.

// containment-substrate Phase 5 — the file-local `namedSubset` shim was DELETED
// with the `isSubtype` structural body (its sole caller). The named-hierarchy ⊆
// is now decided IN the Fenel `engine:subset` decider via the `namedSubsetCheck`
// ctx-native (which calls the same `dispatchedNamedSubset`). The `engine:`
// `namedSubset` body + `dispatchedNamedSubset` wrapper are unchanged.

// ---------------------------------------------------------------------------
// Normalization — simplify a SetExpr
// ---------------------------------------------------------------------------

/**
 * Provably disjoint: A ∩ B = ∅. Best-effort and conservative — returns
 * false for cases we can't decide structurally. Decidable cases:
 *
 *   $none on either side                          ⇒ true (∅ ∩ X = ∅)
 *   $enum vs $enum                                ⇒ list-intersection check
 *   $enum vs $interval / $pattern / $named        ⇒ test each value
 *   $interval vs $interval                        ⇒ intersection has gap
 *   $pattern vs $pattern                          ⇒ regex product walk
 *
 * Used by normalize() to detect impossible $intersect and to simplify
 * $diff when the subtrahend doesn't overlap the minuend.
 */
// -- Per-shape decideDisjoint impls. Symmetric to decideSubset — each
// -- handles "left is shape X" rules; the right side is inspected internally.
// -- Disjointness is *symmetric* (a ∩ b = b ∩ a), so when the LEFT shape's
// -- decision doesn't fire, the dispatch table tries the RIGHT shape too
// -- via `setSymmetricDisjoint` at the orchestration layer. ---------------

// set-algebra-to-fenel Phase 3a — the All / None / Enum / Interval / Named
// per-shape `setXxxDecideDisjoint` exports were Path-B-only duplicates
// (`isDisjoint`'s marshaller self-reasons these leaves + owns the symmetric
// swap; it only feeds the opaque Pattern leaf). Deleted; the `dmNatives`
// entries now delegate Path B to the top-level Fenel `isDisjoint` dispatcher.
// The raw Pattern/Pattern performance leaf below is a thin host shim into the
// Fenel pattern decider; the Fenel set-algebra body owns shape policy.

export function setPatternDecideDisjoint(
  a: Pattern,
  b: Pattern,
  evalCtx?: EvaluateContext,
): MaybeBool {
  // regex-derivative-to-fenel Phase 1a-cont — the regex round-trip is DROPPED
  // (mirror of setPatternDecideSubset); `patternDisjoint` dispatches to the
  // Fenel `engine:decidePatternDisjoint` body (structured partition + 2^N
  // fallback), the sole decision path.
  return mJust(patternDisjoint(a, b, evalCtx));
}

// set-algebra-to-fenel Phase 3a — `setWhereDecideDisjoint` /
// `setUnionDecideDisjoint` / `setIntersectDecideDisjoint` /
// `setDiffDecideDisjoint` / `setComplementDecideDisjoint` were Path-B-only
// duplicates (the Fenel `Sid*` arms own each, including the complement
// cross-query `isSubset` re-entry). Deleted; Path B delegates to the
// top-level `isDisjoint` dispatcher.

// Phase 7b-recursive — the in-engine fast-path shape table for isDisjoint
// is gone; dispatch lives in the engine-bodies-dispatch.ts marshaller
// (which inlines the per-shape dispatch for leaves and delegates
// compound recursion to the Fenel body). The per-shape
// `setXxxDecideDisjoint` functions above remain as the inlineable
// leaf-decider entry points the marshaller calls.

/** Provably disjoint: A ∩ B = ∅. Tri-state return (Phase 4): `Just true`
 * when the structural algebra proves disjointness; `Just false` when a
 * shared element is exhibited (or `$all`/`$none` rule fires); `Nothing`
 * when we couldn't decide.
 *
 * Disjointness is *symmetric*, so when the left shape's per-shape impl
 * doesn't return a positive proof we try the RIGHT shape's impl with the
 * args swapped. This preserves the existing behaviour where rules like
 * "$enum vs $pattern" fire whichever side carries the $enum. A `Just
 * false` from either side is authoritative — both sides agree on the
 * negative direction.
 *
 * Calls the Fenel disjointness decider through the engine-bodies-dispatch
 * marshaller, like `contains` / `isSubset`; no DecidableMembership instance
 * is consulted. Boundary callers use `isDisjointB` for a `Nothing → false`
 * collapse.
 */
export function isDisjoint(a: SetExpr, b: SetExpr, evalCtx?: EvaluateContext, resolve?: RefResolve): MaybeBool {
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) return mNothing;
  // Resolve refs (entry + nested, both sides) to their referent's structural
  // type before dispatch; ref-free input takes the identity path. Canonical
  // equal-handle non-disjointness is decided by the Fenel SeRef/SeRef arm.
  {
    const ra = resolveSetExprAtEntry(a, resolve);
    const rb = resolveSetExprAtEntry(b, resolve);
    if (ra === null || rb === null) return mNothing;
    a = ra;
    b = rb;
  }
  if (isDegradedTypeProjection(a) || isDegradedTypeProjection(b)) return mNothing;
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. The TS dispatcher pre-marshalls (a, b) into the
  // recursive SetExprIsDisjointAdt; per-shape leaf decisions pre-computed
  // at the marshaller via inline non-shim per-shape dispatch (avoids
  // the shim → dispatched → marshaller cycle that the top-level call
  // would otherwise trigger). The Fenel body dispatches structurally
  // over a's Union / Intersect compounds.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedIsDisjoint } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const result = dispatchedIsDisjoint(a, b, evalCtx);
  if (result.$tag === "Nothing") return mNothing;
  return mJust(result._0);
}

/** Boolean-collapsed `isDisjoint` — `Nothing → false` at the boundary.
 *  Use for callers that need a non-tri-state surface. */
export function isDisjointB(a: SetExpr, b: SetExpr, evalCtx?: EvaluateContext, resolve?: RefResolve): boolean {
  return mGet(isDisjoint(a, b, evalCtx, resolve), false);
}

// set-algebra-to-fenel Phase 3a — `isValueOnlyPredicate` shim DELETED: its
// only consumer was `setEnumDecideDisjoint` (Path-B duplicate, now retired).
// The `engine:isValueOnlyPredicate` body still backs the marshaller's $enum
// disjoint leaf via `dispatchedIsValueOnlyPredicate` in engine-bodies-dispatch.ts.

/** Simplify a SetExpr (flatten nested unions/intersections, eliminate ∅/U).
 *
 * `evalCtx` is forwarded to internal `contains()` and `isDisjoint()` calls
 * for the rare value-only predicate paths. Most simplification is purely
 * structural and unaffected. */
export function normalize(set: SetExpr, evalCtx?: EvaluateContext): SetExpr {
  // Normalization is a projection, not a verdict. Preserve the flag so a later
  // judgment still sees that this SeAll came from an identity-incomplete type.
  if (isDegradedTypeProjection(set)) return set;
  // set-algebra-to-fenel Phase 2c — the structural SetExpr simplifier is now
  // Fenel-bodied (`setAlgebraNormalize`, fenel/modules/engine/
  // set-algebra-deciders.fenel). This export is a thin shim over
  // `dispatchedNormalize`, which passes the canonical SetExpr directly to the
  // Fenel body under the merged decider context. Its recursive
  // contains/isSubset/isDisjoint/isValueOnly and interval operations call the
  // sibling Fenel bodies directly. The old NormSetExpr mirror, re-entry
  // natives, and TS intersect-subset recursion are retired; this wrapper is
  // transport only and the Fenel body is the sole source of truth.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedNormalize } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedNormalize(set, evalCtx);
}

// ---------------------------------------------------------------------------
// Legacy bridge — convert old constraints to SetExpr
// ---------------------------------------------------------------------------

/** Convert NumberConstraints → SetExpr */
export function fromNumberConstraints(c: NumberConstraints): SetExpr {
  const parts: SetExpr[] = [];

  if (c.integer) {
    parts.push(buildSetExpr.ref("ℤ"));
  }

  const iv: Interval = { lo: Nothing, hi: Nothing };
  if (c.min != null) {
    iv.lo = Just({ value: resolveExprValue(c.min), inclusive: true });
  }
  if (c.exclusiveMin != null) {
    iv.lo = Just({ value: resolveExprValue(c.exclusiveMin), inclusive: false });
  }
  if (c.max != null) {
    iv.hi = Just({ value: resolveExprValue(c.max), inclusive: true });
  }
  if (c.exclusiveMax != null) {
    iv.hi = Just({ value: resolveExprValue(c.exclusiveMax), inclusive: false });
  }
  if (iv.lo.$tag === "Just" || iv.hi.$tag === "Just") {
    parts.push(buildSetExpr.interval(iv));
  }

  if (c.multipleOf != null) {
    parts.push(
      buildSetExpr.where({ "===": [{ "%": [{ var: "value" }, c.multipleOf] }, 0] }),
    );
  }

  if (parts.length === 0) return buildSetExpr.all();
  if (parts.length === 1) return parts[0]!;
  return buildSetExpr.intersect(parts);
}

/** Convert StringConstraints → SetExpr */
export function fromStringConstraints(c: StringConstraints): SetExpr {
  const parts: SetExpr[] = [];

  if (c.minLength != null || c.maxLength != null) {
    const iv: Interval = { lo: Nothing, hi: Nothing };
    if (c.minLength != null) {
      iv.lo = Just({ value: resolveExprValue(c.minLength), inclusive: true });
    }
    if (c.maxLength != null) {
      iv.hi = Just({ value: resolveExprValue(c.maxLength), inclusive: true });
    }
    // Length constraint as a predicate on string length
    parts.push(buildSetExpr.where(buildLengthCheck(iv)));
  }

  if (c.pattern) {
    const p = regexStringToPattern(c.pattern);
    if (p) parts.push(buildSetExpr.pattern(p));
  }

  if (c.format) {
    parts.push(buildSetExpr.ref(`format:${c.format}`));
  }

  if (parts.length === 0) return buildSetExpr.all();
  if (parts.length === 1) return parts[0]!;
  return buildSetExpr.intersect(parts);
}

function resolveExprValue(v: number | string | { $expr: Expression }): number | string | { $expr: Expression } {
  if (typeof v === "object" && "$expr" in v) return v;
  return v as number | string;
}

function buildLengthCheck(iv: Interval): Expression {
  const checks: Expression[] = [];
  if (iv.lo.$tag === "Just") {
    const op = iv.lo._0.inclusive ? ">=" : ">";
    checks.push({ [op]: [{ var: "value.length" }, iv.lo._0.value] } as Expression);
  }
  if (iv.hi.$tag === "Just") {
    const op = iv.hi._0.inclusive ? "<=" : "<";
    checks.push({ [op]: [{ var: "value.length" }, iv.hi._0.value] } as Expression);
  }
  if (checks.length === 1) return checks[0]!;
  return { and: checks };
}

// ---------------------------------------------------------------------------
// Type-level subtyping — isSubtype(FenelType, FenelType)
//
// Structural rules over $mu/$variant/$record/$tuple/$refined/$opaque etc.
// Co-inductive cycle detection: when proving A ⊆ B requires re-proving the
// same goal (after unfolding through $mu), accept by co-induction. Sound for
// equirecursive subtyping over polynomial functors.
// ---------------------------------------------------------------------------

type MuType = { $mu: { var: string; body: FenelType } };

// ---------------------------------------------------------------------------
// containment-substrate Phase 6 — `unfold` / `substituteVar` are a ledgered
// PERFORMANCE BRANCH (design/ts-exceptions-ledger.md). The SOURCE OF TRUTH is
// the `.fenel` `engine:substituteVar` body (type-algebra.fenel), dispatched via
// `dispatchedUnfold` / `dispatchedSubstituteVar` (engine-bodies-dispatch.ts) and
// gated byte-equal by `phase-6-unfold-parity.test.ts`. These TS bodies stay LIVE
// because the sole consumer — `structural.ts:unfold` (→ structuralView →
// derive-functor/foldable/traversable + live frontend) — is a hot path, and the
// interpreted-Fenel body measured ~68× slower (the `fenel-parser.ts` precedent:
// a pure-logic walk kept in TS for speed, the `.fenel` form the source of truth).
// Keep the two in lockstep — any edit here OR to the `.fenel` body must keep the
// parity oracle green.
// ---------------------------------------------------------------------------

/** One-step μ unfolding: substitute the bound variable with the original $mu.
 *  Ledgered performance branch; source of truth = `engine:substituteVar`.
 *  Unchanged subtrees retain their raw identity; types are read-only data. */
export function unfold(mu: MuType): FenelType {
  return substituteVar(mu.$mu.body, mu.$mu.var, mu);
}

function substituteVar(t: FenelType, name: string, replacement: FenelType): FenelType {
  // 7g-retire-4a INVERT: a name-leaf (`{$ref}` OR `{$named}`) carries no $var.
  if ("$void" in t || "$unit" in t || refHandle(t) !== undefined) return t;
  if ("$var" in t) return t.$var === name ? replacement : t;
  if ("$record" in t) {
    const fields = t.$record.fields.map(f => {
      const type = substituteVar(f.type, name, replacement);
      return type === f.type ? f : { ...f, type };
    });
    return fields.every((field, index) => field === t.$record.fields[index]) ? t : { $record: { fields } };
  }
  if ("$variant" in t) {
    const cases = t.$variant.cases.map(c => {
      if (!c.fields) return c;
      const fields = c.fields.map(f => {
        const type = substituteVar(f.type, name, replacement);
        return type === f.type ? f : { ...f, type };
      });
      return fields.every((field, index) => field === c.fields![index]) ? c : { ...c, fields };
    });
    return cases.every((entry, index) => entry === t.$variant.cases[index]) ? t : { $variant: { ...t.$variant, cases } };
  }
  if ("$tuple" in t) {
    const items = t.$tuple.map(x => substituteVar(x, name, replacement));
    return items.every((item, index) => item === t.$tuple[index]) ? t : { $tuple: items };
  }
  if ("$map" in t) {
    const values = substituteVar(t.$map.values, name, replacement);
    if (values === t.$map.values) return t;
    return {
      $map: {
        keys: t.$map.keys,
        values,
      },
    };
  }
  if ("$refined" in t) {
    const base = substituteVar(t.$refined.base, name, replacement);
    if (base === t.$refined.base) return t;
    return {
      $refined: {
        base,
        set: t.$refined.set,
      },
    };
  }
  if ("$mu" in t) {
    if (t.$mu.var === name) return t;
    const body = substituteVar(t.$mu.body, name, replacement);
    if (body === t.$mu.body) return t;
    return {
      $mu: {
        var: t.$mu.var,
        body,
      },
    };
  }
  if ("$tagged" in t) {
    const value = substituteVar(t.$tagged.value, name, replacement);
    const phantom = substituteVar(t.$tagged.phantom, name, replacement);
    if (value === t.$tagged.value && phantom === t.$tagged.phantom) return t;
    return {
      $tagged: {
        value,
        phantom,
      },
    };
  }
  if ("$opaque" in t) {
    const pure = t.$opaque.pure ? substituteVar(t.$opaque.pure, name, replacement) : undefined;
    if (pure === t.$opaque.pure) return t;
    return {
      $opaque: {
        ...t.$opaque,
        ...(pure ? { pure } : {}),
      },
    };
  }
  // $el carries an Expression whose substructure is opaque from the type
  // walker's perspective — substitution doesn't reach into expressions.
  // This is consistent with how legacy `$depend`/`$dep`/`$apply` were
  // handled: their inner expressions were never substituted either.
  //
  // Phase 1 of typeclass-substrate-completion: the `{$el: {call: [con, ...args]}}`
  // shape (parser-emitted as the deferred type-app fallback, replacing the
  // retired `$app` substrate) DOES need substitution into its args — same
  // observable semantic the legacy `$app.args` walk carried. Other `$el`
  // payload shapes (`$el { var: ... }`, `$el { if: ... }`, etc.) stay
  // opaque per the legacy contract.
  if ("$el" in t) {
    const e = (t as { $el: unknown }).$el;
    if (e && typeof e === "object" && !Array.isArray(e) && "call" in e) {
      const call = (e as { call: unknown }).call;
      if (Array.isArray(call) && call.length >= 1 && typeof call[0] === "string") {
        const head = call[0];
        const rest = call.slice(1);
        const substituted = rest.map((x) =>
          x !== null && typeof x === "object" && !Array.isArray(x)
            ? substituteVar(x as FenelType, name, replacement)
            : x,
        );
        if (substituted.every((argument, index) => Object.is(argument, rest[index]))) return t;
        return { $el: { call: [head, ...substituted] } } as FenelType;
      }
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Peel helpers — recognise Maybe / List / Result by their canonical case shape.
//
// `Maybe(T)`, `List(T)`, `Result(E, A)` from `type-foundation.ts` emit:
//   Maybe  = $variant { Nothing | Just { value: T } }
//   List   = $opaque { repr: "array", pure: μX. Nil | Cons { head: T, tail: X } }
//   Result = $variant { Err { value: E } | Ok { value: A } }
// These helpers undo that wrapping and return the inner type(s). The legacy
// `{$maybe: T}` / `{$list: T}` / `{$result: {err, ok}}` structural shorthands
// have been migrated out of both the source and persisted data — see
// `scripts/migrate-type-shorthand.ts`. If you need to support shorthand
// again (e.g. for an external API), reach for `normalizeFenelTypeShorthand`
// in `type-normalize.ts` at the boundary instead of adding branches here.
//
// Usage:
//   const m = peelMaybe(t); if (m) { use m.value }
//   const l = peelList(t);  if (l) { use l.elem  }
//   const r = peelResult(t); if (r) { use r.err / r.ok }
// ---------------------------------------------------------------------------

/**
 * Generic structural recognizer — peel a type to its `$variant` cases,
 * walking through outer `$refined` and `$opaque.pure` wrappers. The
 * primitive that `peelMaybe`/`peelResult` are sugar over; anything that
 * wants to recognise a specific named-case pattern (`Nothing | Just`,
 * `Err | Ok`, …) should use this and match the cases by name instead of
 * relying on a per-ADT helper.
 *
 * Distinct from `peelList`: List wraps `$opaque { repr: "array" }` whose
 * inner `pure` is `μX. Nil | Cons`. `peelToVariant` walks any opaque to
 * its `pure`, but `peelList`'s additional structural check (matching
 * the μ-Cons pattern + extracting `head`) doesn't simplify to "find a
 * variant case", so it stays specialised.
 */
export function peelToVariant(
  t: FenelType,
  resolve?: RefResolve,
): { cases: { name: string; fields?: { name: string; type: FenelType }[] }[]; discriminator?: string } | null {
  // Phase 7c — body lives in fenel/modules/engine/set-algebra-deciders.fenel.
  if (!t || typeof t !== "object") return null;
  // Phase 7f — `{$ref}` resolve-at-entry: resolve to the structural type, then
  // recurse through the same recognizer; an unresolvable ref reads as today's
  // unknown (null), never throws.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPeelToVariant } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  if (isRef(t)) {
    // 7g-retire-4a INVERT: resolve, else keep `{$ref}`. A genuinely-resolved
    // structural type recurses; an unresolvable `{$ref}` leaf is dispatched to
    // the marshaller, which reads its name-handle via `refHandle` (the
    // name-equality leaf is now `{$ref}`, not the old rewrite-to-`{$named}`).
    const r = refToStructuralOrNamed(t, resolve);
    return isRef(r) ? dispatchedPeelToVariant(r) : peelToVariant(r, resolve);
  }
  return dispatchedPeelToVariant(t);
}

/**
 * If `t` is a Maybe-shaped type — a `$variant` whose cases are exactly
 * `Nothing` (nullary) and `Just { value: T }` — return `{ value: T }`.
 * Peels through outer `$refined`. Else null.
 */
export function peelMaybe(t: FenelType, resolve?: RefResolve): { value: FenelType } | null {
  // Phase 7c — body lives in fenel/modules/engine/set-algebra-deciders.fenel.
  if (!t || typeof t !== "object") return null;
  // Phase 7f — `{$ref}` resolve-at-entry (resolve-then-recurse).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPeelMaybe } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  if (isRef(t)) {
    // 7g-retire-4a INVERT (see peelToVariant): resolve, else keep `{$ref}` and
    // dispatch the leaf to the marshaller (name-handle read via `refHandle`).
    const r = refToStructuralOrNamed(t, resolve);
    return isRef(r) ? dispatchedPeelMaybe(r) : peelMaybe(r, resolve);
  }
  return dispatchedPeelMaybe(t);
}

/**
 * Phase 8 of canonical-maybe — dispatch through the `Undefinable` typeclass
 * to determine whether a Fenel type has a representation that legitimately
 * admits absence in non-Fenel serialised forms (JSON Schema
 * `required: false`, SQL NULL, missing JSON key).
 *
 * Replaces hardcoded `peelMaybe(field.type)`-as-erasable-predicate at codec
 * boundaries (JSON Schema `required[]` emit + structural subtype's
 * Maybe-absorbs-absence rule). `peelMaybe` stays as the value-shape
 * recognizer (extract inner T from Maybe<T>); `isErasableType` is the
 * complementary behavioral predicate (does this slot admit absence?).
 *
 * Lookup order:
 *   1. `peelMaybe(t)` — direct Maybe<T> + `$refined` Maybe<T>. Covers the
 *      default `maybeUndefinable` instance (registered in builtin-classes).
 *   2. `peelToVariant(t)` whose cases are exactly `Nothing | Just` —
 *      transitive: $tagged / $opaque around Maybe.
 *   3. Registry dispatch on `$named` OR `$el.call` shapes —
 *      `dispatchRegistry.satisfies(t, "Undefinable")`. Pre-Phase-13 only
 *      `$named` reached the registry; Phase 13 widened the matcher to
 *      `FenelType` so explicit `{$el: {call: [con, ...args]}}` LHSs now
 *      hit parametric instances (e.g. `maybeUndefinable` keyed on
 *      `{$el: {call: ["Maybe", ...]}}` — was `$app` pre-Phase-1 of
 *      typeclass-substrate-completion). Lazy `require` avoids the
 *      dispatch-registry ↔ system-entities init cycle.
 *   4. Default: not erasable.
 *
 * Dispatch surface (Phase 8 ADR): Option A — pure-type predicate bound to
 * the default `dispatchRegistry` via lazy require. Chosen because (a) the four
 * call sites are sync + want a bare `boolean`, (b) lazy require breaks any
 * module-init cycle without forcing every caller to thread a registry, and
 * (c) mirrors how `peelMaybe` itself lazy-requires its bodied dispatcher.
 */
export function isErasableType(t: FenelType): boolean {
  // (1) Direct Maybe + $refined Maybe.
  if (peelMaybe(t) !== null) return true;
  // (2) Transitive: $tagged / $opaque around a Maybe-shaped $variant.
  const v = peelToVariant(t);
  if (v && hasNothingJustCases(v.cases)) return true;
  // (3) Registry dispatch — covers both concrete-named instances ($named)
  //     and parametric instances ($el.call shape, post-Phase-1 of
  //     typeclass-substrate-completion). The matcher decides which
  //     instance pattern matches the type's shape.
  // 7g-retire-4a INVERT: recognize a name-ref (`{$ref}` OR `{$named}`).
  if (typeof t === "object" && t !== null && (refHandle(t) !== undefined || isElCallShape(t))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchRegistry } = engineRequire("system-entities") as typeof import("./system-entities");
    // rights R3a — GLOBAL_ONLY, and an honest fence rather than a withdrawal.
    // `Undefinable` is a CODEC-BOUNDARY class declared by the repository
    // (`fenel/std/*`): "does absence at a serialised boundary erase for this
    // type" is a property of the type language, not an account overlay, and
    // this predicate is called from four sync sites that hold no frame. An
    // account-registered `Undefinable` instance changing another account's
    // erasability was the leak; it changing its OWN account's is not a feature
    // any surface offers.
    return dispatchRegistry.satisfies(t, "Undefinable", GLOBAL_ONLY);
  }
  return false;
}

/** Recognize the `{$el: {call: [con-string, ...args]}}` deferred-type-app
 *  shape that replaces the retired `$app` substrate (Phase 1 of
 *  typeclass-substrate-completion). Other `$el` payloads (`$el.var`,
 *  `$el.if`, ...) are NOT included — they are genuinely-deferred type
 *  computations whose head is not a known constructor. */
function isElCallShape(t: FenelType): boolean {
  if (typeof t !== "object" || t === null || !("$el" in t)) return false;
  const e = (t as { $el: unknown }).$el;
  if (!e || typeof e !== "object" || Array.isArray(e) || !("call" in e)) return false;
  const call = (e as { call: unknown }).call;
  return Array.isArray(call) && call.length >= 1 && typeof call[0] === "string";
}

function hasNothingJustCases(
  cases: { name: string }[],
): boolean {
  if (cases.length !== 2) return false;
  const names = cases.map((c) => c.name);
  return names.includes("Nothing") && names.includes("Just");
}

/**
 * If `t` is a List-shaped type — an `$opaque` with `repr === "array"` whose
 * `pure` is either:
 *   - `μX. Nil | Cons { head: T, tail: X }` (legacy `$mu`-`$variant` shape), or
 *   - `Nil | Cons { head: T, tail: List }` (Phase 2.5 `$variant`-with-
 *     `{$named: "List"}` self-reference shape) —
 * return `{ elem: T }`. Peels through outer `$refined`. Else null.
 */
export function peelList(t: FenelType, resolve?: RefResolve): { elem: FenelType } | null {
  // Phase 7c — body lives in fenel/modules/engine/set-algebra-deciders.fenel.
  if (!t || typeof t !== "object") return null;
  // Phase 7f — `{$ref}` resolve-at-entry (resolve-then-recurse).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPeelList } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  if (isRef(t)) {
    // 7g-retire-4a INVERT (see peelToVariant): resolve, else keep `{$ref}` and
    // dispatch the leaf to the marshaller. Lets the parser's `{$ref:"List"}`
    // self-ref + `{$ref:"Char"}` element re-match the canonical
    // `{$named}`/opaque-named List/Char shapes via the marshaller's name-handle.
    const r = refToStructuralOrNamed(t, resolve);
    return isRef(r) ? dispatchedPeelList(r) : peelList(r, resolve);
  }
  return dispatchedPeelList(t);
}

/**
 * If `t` is a Result-shaped type — a `$variant` with cases `Err { _0: E }`
 * and `Ok { _0: A }` (the canonical positional encoding) — return
 * `{ err: E, ok: A }`. Peels through outer `$refined`. Else null.
 */
export function peelResult(t: FenelType, resolve?: RefResolve): { err: FenelType; ok: FenelType } | null {
  // Phase 7c — body lives in fenel/modules/engine/set-algebra-deciders.fenel.
  if (!t || typeof t !== "object") return null;
  // Phase 7f — `{$ref}` resolve-at-entry (resolve-then-recurse).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPeelResult } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  if (isRef(t)) {
    // 7g-retire-4a INVERT (see peelToVariant): resolve, else keep `{$ref}` and
    // dispatch the leaf to the marshaller (name-handle read via `refHandle`).
    const r = refToStructuralOrNamed(t, resolve);
    return isRef(r) ? dispatchedPeelResult(r) : peelResult(r, resolve);
  }
  return dispatchedPeelResult(t);
}

/**
 * Structural subtype check — `subtype = subset`.
 *
 * containment-substrate Phase 5 — a thin marshal SHIM over the Fenel
 * `engine:subset` decider (containment.fenel). The WHOLE structural algorithm —
 * every arm (void / unit / var / named-hierarchy + the `$named↔$opaque` bridge /
 * opaque-peel / refined-forget + refined-leaf via `set:decideSubset` / variant /
 * record + Undefinable optionality / tuple / map keys+values / arrow variance /
 * `$el.call` / mu + bottom / the tier-2 union·intersect·complement formers) PLUS
 * ref-resolution (the global-registry `resolveRef` ctx-native) PLUS co-induction
 * (the `seen` memo) — lives in the `.fenel` body. The ~240-line TS structural
 * twin was DELETED here (the no-TS "kill 2 birds": the largest remaining legacy
 * structural decider retired onto the Fenel containment substrate). Parity:
 * `phase-5-issubtype-parity.test.ts` + `set-algebra.test.ts` (the isSubtype
 * oracle) pin `isSubtype(a,b) === isJustTrue(dispatchedSubset(a,b))`.
 *
 * `assumed` / `resolve` are VESTIGIAL (kept for the external signature + the
 * `index.ts` re-export): the Fenel body owns co-induction (its own threaded
 * memo) AND resolution (the one universal registry, read via `resolveRef` —
 * D2 north-star). Production passed no resolver (`validate.ts`); the typed-ref
 * test fixtures are globally registered, so `dispatchedSubset` resolves them.
 * `options.registry` is additive and supplies only the exact caller-owned field
 * presentation scope used by keyed-product containment fences.
 */
export function isSubtype(
  a: FenelType,
  b: FenelType,
  _assumed?: Set<string>,
  _resolve?: RefResolve,
  options?: ContainmentDispatchOptions,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSubset } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return isJustTrue(dispatchedSubset(a, b, options) as unknown as MaybeBool);
}

// ---------------------------------------------------------------------------
// Emptiness — is this set provably empty / satisfiable?
//
// A constraint is empty when no value can satisfy it. normalize() detects
// many such cases (disjoint intervals, disjoint enums, enum-vs-pattern
// mismatch, complement-of-universe, etc.) and returns {$none: true}. This
// helper is the public surface for that check.
//
// Conservative: returns false (uncertain) for cases normalize can't decide
// — e.g. $where predicates, two patterns whose languages happen to be
// disjoint but aren't structurally caught.
// ---------------------------------------------------------------------------

// -- Per-shape decideEmpty impls. Each returns the *structural* emptiness
// -- decision for its shape (without re-running normalize). Compound shapes
// -- recurse into children. Conservative — shapes whose emptiness depends
// -- on an unevaluated predicate return false (treat as non-empty). The
// -- top-level `isEmpty` orchestrates by pre-normalising (which surfaces
// -- many algebraic emptinesses as `$none`) before dispatching. --

// set-algebra-to-fenel Phase 3a — the 11 per-shape `setXxxDecideEmpty`
// exports were Path-B-only duplicates (reached solely via the
// DecidableMembership `dmNatives` table; `decideEmpty`'s marshaller never
// fed them). Deleted: the `dmNatives` entries now delegate Path B straight
// to the top-level Fenel `decideEmpty` dispatcher (which marshals + self-
// reasons every shape, including the lifted-emptiness $where arm via the
// Fenel `engine:setEnumDecideEmpty` body). Behaviour-identical; net TS
// deletion. KEEP-set note: no Empty decider is marshaller-fed, so none survive.

// Phase 7b-recursive — the in-engine fast-path shape table for decideEmpty
// is gone; dispatch lives entirely in the Fenel body via the recursive
// SetExprDecideEmptyAdt marshaller in engine-bodies-dispatch.ts. The
// per-shape `setXxxDecideEmpty` functions above remain as thin TS shims
// that delegate to the top-level `decideEmpty` for the few external
// callers (decidable-membership.ts + tests).

/** Structural-emptiness decision by the Fenel emptiness decider.
 *
 * Tri-state return (Phase 4): `Just true` when provably empty; `Just
 * false` when provably non-empty; `Nothing` when the shape doesn't admit
 * structural emptiness reasoning (e.g. opaque $where predicate).
 *
 * Dispatches directly without pre-normalising; intended as the building
 * block that `isEmpty` (which DOES normalise) composes over. The decider
 * switches on the shape itself; no DecidableMembership instance is
 * consulted.
 */
export function decideEmpty(set: SetExpr): MaybeBool {
  if (isDegradedTypeProjection(set)) return mNothing;
  // Phase 7b-recursive — body lives in fenel/modules/engine/set-algebra-
  // deciders.fenel. The TS dispatcher pre-marshalls the SetExpr into the
  // recursive SetExprDecideEmptyAdt; leaves + opaque arms + cross-query
  // auxiliaries (Diff aSubsetB, Intersect anyPairDisjoint) pre-computed at
  // the marshaller. The Fenel body dispatches structurally over compound
  // arms (Union / Intersect / Diff / Complement) without calling back to
  // TS mid-recursion.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecideEmpty } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const result = dispatchedDecideEmpty(set);
  if (result.$tag === "Nothing") return mNothing;
  return mJust(result._0);
}

/** Boolean-collapsed `decideEmpty` — `Nothing → false`. */
export function decideEmptyB(set: SetExpr): boolean {
  return mGet(decideEmpty(set), false);
}

/** Provably empty (tri-state). Pre-normalises so algebraic simplifications
 * (disjoint intervals in an intersect, empty unions, etc.) get a chance to
 * reduce to `$none` before the shape-table emptiness check.
 */
export function isEmpty(set: SetExpr): MaybeBool {
  return decideEmpty(normalize(set));
}

/** Boolean-collapsed `isEmpty` — `Nothing → false`. */
export function isEmptyB(set: SetExpr): boolean {
  return mGet(isEmpty(set), false);
}

/** Provably satisfiable — i.e. provably non-empty. The dual of `isEmpty`:
 * `Just true` iff `isEmpty` is `Just false`, and vice versa. `Nothing`
 * propagates through. */
export function isSatisfiable(set: SetExpr): MaybeBool {
  return mNot(isEmpty(set));
}

/** Boolean-collapsed `isSatisfiable` — pre-Phase-4 behaviour was `!isEmpty(set)`
 * which mapped `Nothing` (couldn't decide emptiness) to `!false = true`
 * (treat as satisfiable). Preserve that: collapse `isEmpty(set)` with
 * default `false`, then negate. */
export function isSatisfiableB(set: SetExpr): boolean {
  return !mGet(isEmpty(set), false);
}

// ---------------------------------------------------------------------------
// SetExpr constructors — concise builders for common patterns
//
// Instead of writing { $interval: { lo: { value: 0, inclusive: true } } },
// write: sets.gte(0)
// ---------------------------------------------------------------------------

// set-algebra-to-fenel Phase 3b-2 — every `sets.*` constructor routes through
// `buildSetExpr` (the ONE flip point). Today (Step 2) `buildSetExpr` emits
// `$`-key, so this is net-neutral; the Step-3 flip to `$tag` is a one-function
// change in `set-marker.ts`.
export const sets = {
  get all(): SetExpr { return buildSetExpr.all(); },
  get none(): SetExpr { return buildSetExpr.none(); },
  one: (...values: unknown[]): SetExpr => buildSetExpr.enum(values),
  /** Build a `$pattern` SetExpr from a regex source string. Returns `$none`
   *  if the regex doesn't parse — invariant: the in-memory form is always
   *  the algebraic Pattern, never a regex string. */
  pattern: (re: string): SetExpr => {
    const p = regexStringToPattern(re);
    return p ? buildSetExpr.pattern(p) : buildSetExpr.none();
  },
  named: (name: string): SetExpr => buildSetExpr.ref(name),
  gte: (n: number): SetExpr => buildSetExpr.interval({ lo: Just({ value: n, inclusive: true }), hi: Nothing }),
  gt: (n: number): SetExpr => buildSetExpr.interval({ lo: Just({ value: n, inclusive: false }), hi: Nothing }),
  lte: (n: number): SetExpr => buildSetExpr.interval({ lo: Nothing, hi: Just({ value: n, inclusive: true }) }),
  lt: (n: number): SetExpr => buildSetExpr.interval({ lo: Nothing, hi: Just({ value: n, inclusive: false }) }),
  between: (lo: number, hi: number): SetExpr => buildSetExpr.interval({
    lo: Just({ value: lo, inclusive: true }),
    hi: Just({ value: hi, inclusive: true }),
  }),
  union: (...parts: SetExpr[]): SetExpr => buildSetExpr.union(parts),
  intersect: (...parts: SetExpr[]): SetExpr => buildSetExpr.intersect(parts),
  // Format shorthands
  get email(): SetExpr { return buildSetExpr.ref("format:email"); },
  get phone(): SetExpr { return buildSetExpr.ref("format:phone"); },
  get url(): SetExpr { return buildSetExpr.ref("format:url"); },
  get uuid(): SetExpr { return buildSetExpr.ref("format:uuid"); },
  get integer(): SetExpr { return buildSetExpr.ref("ℤ"); },
  get natural(): SetExpr { return buildSetExpr.ref("ℕ"); },
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("set-algebra") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_set_algebra from "./set-algebra";
import { registerEngineModule as __reg_set_algebra } from "./engine-require";
__reg_set_algebra("set-algebra", __self_set_algebra);
