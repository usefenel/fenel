// ---------------------------------------------------------------------------
// Decidable Membership module — SEAM (module-substrate Phase 3s, 2026-06-01).
//
// The DECLARATIVE half (the 48 `defineFunction` specs — the containsFn /
// subsetFn / disjointFn / emptyFn factories × 11 SetExpr shapes + the 4
// polymorphic orchestrators) moved to
// `fenel/modules/decidable-membership/decidable-membership.fenel`
// (`module set where` + 48 bodyless `@native` foreign declarations + facet
// directives). This file is now the thin seam: it loads that source for the
// function roster + facet instances, merges the `DecidableMembership` dispatch
// instances from the `instances.fenel` sidecar, and wires the natives.
//
// THE HEADER IS `module set where`, NOT `module decidable-membership where`.
// The fn ids have ALWAYS used the `set:` prefix (`set:contains` /
// `set:setIntervalContains` / …): the DecidableMembership instances' method
// values reference these functions (`set.setIntervalContains`), and `{call:
// ["set:contains", …]}` callers + the set-algebra laws name the ids; the hyphenated
// dir-name can't be a header ident anyway. Until modules-as-values
// (2026-09-24) the seam restored the old container name "decidable-membership"
// over them, so `set.contains` resolved nowhere and the container could not be
// written dotted (a hyphen cannot follow a dot). The container is now named
// `set`, like the header, so `set.contains` projects `set:contains` and no
// separate `functionNamespace` is declared. Export name
// `decidableMembershipModule` preserved → 0 boot-list edits (system-entities
// SYSTEM_MODULES, system-registry, runtime loadRegistry, index.ts barrel).
//
// THE NATIVES ARE NOT A PURE-LOGIC PORT (depth-read finding — Surprise #47).
// The 3r tier-reorder premise was "3s builds the Fenel contains / SetExpr-ADT
// surface; aggregable's natives ride on it." But that surface ALREADY EXISTS:
// the recursive decision procedures (setAlgebraContains / setAlgebraDecideEmpty
// / setAlgebraIsDisjoint / setAlgebraIsSubset + the interval / enum / bound
// algebra) are ALREADY Fenel-bodied in
// `fenel/modules/engine/set-algebra-deciders.fenel` (built by the SEPARATE
// engine-substrate workstream, Phase 7b/7c). The `set-algebra.ts` per-shape
// impls + top-level dispatchers imported below are now thin shims that
// `require("./engine-bodies-dispatch")` and call those dispatched Fenel bodies.
// So `dmNatives` are NOT pure-logic reimplementations to port — they are the
// registry-facing MARSHALLING-BOUNDARY adapters into those dispatchers (the
// engine-bodies-dispatch boundary marshals SetExpr → SetExprAdt and pre-computes
// the evaluator-dependent opaque arms — $where / $named / $pattern — which are
// carved out to stay TS forever). A marshalling boundary is neither an `ffi/`
// leaf (it's not host-IO) nor a Fenel body (the pure logic lives in
// set-algebra-deciders.fenel already) — it stays here as `nativeImpls`.
//
// See:
//   - design/structural-introspection.md (Instance 1)
//   - implementations/typescript/engine/src/decidable-membership.ts (typeclass)
//   - implementations/typescript/engine/src/set-algebra.ts (dispatchers/shims)
//   - fenel/modules/engine/set-algebra-deciders.fenel (the Fenel decision logic)
// ---------------------------------------------------------------------------

import type { FenelModule, Instance, SetExpr } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { isDegradedTypeProjection, peelSetExpr, setExprToTag } from "../set-marker";
import DM_INSTANCES_FENEL from "../../../../../fenel/modules/decidable-membership/instances.fenel?raw";
import DM_FENEL from "../../../../../fenel/modules/decidable-membership/decidable-membership.fenel?raw";
import {
  // top-level polymorphic dispatchers — surfaced as the Fenel functions
  // `set:contains` / `set:decideSubset` / `set:decideDisjoint` /
  // `set:decideEmpty` so callers can dispatch on a SetExpr of unknown
  // shape without pre-computing the discriminator. Each is a thin shim that
  // marshals + dispatches into the Fenel set-algebra-deciders bodies.
  contains as containsDispatch,
  isSubset as isSubsetDispatch,
  isDisjoint as isDisjointDispatch,
  decideEmpty as decideEmptyDispatch,
  // decide-substrate Phase 1 Stage B — the widened family surface: witness
  // synthesis + finite enumeration (shims into the Fenel `engine:inhabit` /
  // `engine:enumerateSet` judgment cores), the natives of the polymorphic
  // `set:witness` / `set:enumerate`. The instances name per-shape `engine`
  // faces instead (decide-substrate Phase 3).
  witnessOf as witnessDispatch,
  enumerateOf as enumerateDispatch,
  // per-shape impls — the core decision procedures (also shims now)
  setAllContains,
  setNoneContains,
  setEnumContains,
  setIntervalContains,
  setNamedContains,
  setPatternContains,
  setWhereContains,
  setUnionContains,
  setIntersectContains,
  setDiffContains,
  setComplementContains,
  // set-algebra-to-fenel Phase 3a — the 30 Path-B-only per-shape
  // `setXxxDecide{Subset,Disjoint,Empty}` deciders were deleted from
  // set-algebra.ts; their `dmNatives` entries below now delegate straight
  // to the top-level Fenel dispatchers (`isSubsetDispatch` /
  // `isDisjointDispatch` / `decideEmptyDispatch`) — behaviour-identical,
  // since each dispatcher's marshaller self-reasons every structural leaf.
  // Raw Pattern performance leaves remain private to the main decider ctx;
  // typeclass calls always enter the top-level Fenel dispatchers.
} from "../set-algebra";

// ---------------------------------------------------------------------------
// Native impls table — keyed by codeName. Each entry is a thin adapter:
// the per-shape contains shims in `set-algebra.ts` take the canonical typed
// SetExpr case (e.g. `SeInterval`) plus value / ctx /
// evalCtx; the registry-facing wrapper accepts the generic SetExpr
// shape and forwards. The impls themselves are shims that dispatch into the
// Fenel set-algebra-deciders bodies (engine-bodies-dispatch marshaller) — so
// these adapters are the registry↔dispatch boundary, not the logic.
//
// Two-arg contracts (`contains(set, value)`) and three-arg contracts
// (`decideSubset(a, b)`) are exposed as plain positional functions —
// `EvaluateContext` and per-account ctx are threaded by the evaluator
// when the runtime invokes these via `{call: [...]}`.
// ---------------------------------------------------------------------------

const undecided = { $tag: "Nothing" } as const;

// modules-as-values Phase 2c (Rom's 2026-09-25 decision (a)): a method is typed
// over its general input (`contains : (SetExpr, Any) -> Maybe Boolean`), so a
// per-shape procedure can be handed any value. A set of another shape, or a
// top-level value that is not a SetExpr, canonicalizes to null here, which the
// callers below answer `Nothing` (`undecided`): no throw and no verdict. This
// extends the ledgered B3 marshalling seam (design/ts-exceptions-ledger.md).
// Malformed NESTED content (a non-SetExpr child of a union, a bare interval
// bound) still throws inside `setExprToTag`'s recursion or the interval
// marshaller: a recorded follow-up, deliberately not a catch-all here.

function canonicalCase<Tag extends SetExpr["$tag"]>(
  value: unknown,
  tag: Tag,
): Extract<SetExpr, { $tag: Tag }> | null {
  if (isDegradedTypeProjection(value) || peelSetExpr(value) === null) return null;
  const set = setExprToTag(value, { admitValidationRigid: true });
  if (isDegradedTypeProjection(set)) return null;
  if (set.$tag !== tag) return null;
  return set as Extract<SetExpr, { $tag: Tag }>;
}

// The canonicalizer of the polymorphic and the per-shape decision natives.
function canonicalSet(value: unknown): SetExpr | null {
  if (isDegradedTypeProjection(value) || peelSetExpr(value) === null) return null;
  const set = setExprToTag(value, { admitValidationRigid: true });
  return isDegradedTypeProjection(set) ? null : set;
}

/** ⚠ rights R3a — these per-shape deciders are registered as PLAIN natives
 *  (`dmNatives`), which take no `EvaluateContext`, so there is no frame here and
 *  no request account to derive. They pass `null`: account named sets are not
 *  consulted through the registered `set:*` names (brief §8.1a). The
 *  `ambient-read-census` already classifies this family's context handling; what
 *  R3a changes is that the account is now absent EXPLICITLY rather than being
 *  read out of whatever record happened to be the value. */
function dispatchCanonicalContains<Tag extends SetExpr["$tag"]>(
  value: unknown,
  member: unknown,
  tag: Tag,
  decide: (
    set: Extract<SetExpr, { $tag: Tag }>,
    member: unknown,
    requestAccount: string | null,
  ) => unknown,
): unknown {
  const set = canonicalCase(value, tag);
  return set === null ? undecided : decide(set, member, null);
}

function dispatchCanonicalPair(
  a: unknown,
  b: unknown,
  decide: (left: SetExpr, right: SetExpr) => unknown,
): unknown {
  const left = canonicalSet(a);
  const right = canonicalSet(b);
  return left === null || right === null ? undecided : decide(left, right);
}

function dispatchCanonicalSingle(
  value: unknown,
  decide: (set: SetExpr) => unknown,
): unknown {
  const set = canonicalSet(value);
  return set === null ? undecided : decide(set);
}

const dmNatives: Record<string, (...args: unknown[]) => unknown> = {
  // Polymorphic orchestrators — call the same per-shape table the typeclass-
  // instance dispatch resolves to. The set-algebra dispatchers do the
  // shape-lookup + impl-invoke internally.
  contains: (s, v) => {
    const set = canonicalSet(s);
    // rights R3a — an EXPLICIT `null`; see `dispatchCanonicalContains`.
    return set === null ? undecided : containsDispatch(set, v, null);
  },
  decideSubset: (a, b) => {
    const left = canonicalSet(a);
    const right = canonicalSet(b);
    return left === null || right === null ? undecided : isSubsetDispatch(left, right);
  },
  decideDisjoint: (a, b) => {
    const left = canonicalSet(a);
    const right = canonicalSet(b);
    return left === null || right === null ? undecided : isDisjointDispatch(left, right);
  },
  decideEmpty: (s) => {
    const set = canonicalSet(s);
    return set === null ? undecided : decideEmptyDispatch(set);
  },
  witness: (s) => {
    const set = canonicalSet(s);
    return set === null ? undecided : witnessDispatch(set);
  },
  enumerate: (s) => {
    const set = canonicalSet(s);
    return set === null ? undecided : enumerateDispatch(set);
  },
  // Contains
  setAllContains: (s, v) => dispatchCanonicalContains(s, v, "SeAll", setAllContains),
  setNoneContains: (s, v) => dispatchCanonicalContains(s, v, "SeNone", setNoneContains),
  setEnumContains: (s, v) => dispatchCanonicalContains(s, v, "SeEnum", setEnumContains),
  setIntervalContains: (s, v) => dispatchCanonicalContains(s, v, "SeInterval", setIntervalContains),
  setNamedContains: (s, v) => dispatchCanonicalContains(s, v, "SeRef", setNamedContains),
  setPatternContains: (s, v) => dispatchCanonicalContains(s, v, "SePattern", setPatternContains),
  setWhereContains: (s, v) => dispatchCanonicalContains(s, v, "SeWhere", setWhereContains),
  setUnionContains: (s, v) => dispatchCanonicalContains(s, v, "SeUnion", setUnionContains),
  setIntersectContains: (s, v) => dispatchCanonicalContains(s, v, "SeIntersect", setIntersectContains),
  setDiffContains: (s, v) => dispatchCanonicalContains(s, v, "SeDiff", setDiffContains),
  setComplementContains: (s, v) => dispatchCanonicalContains(s, v, "SeComplement", setComplementContains),
  // Decide subset — every typeclass shape delegates to the top-level Fenel
  // dispatcher. Its body owns structural classification, compound recursion,
  // and tail rules; these adapters only canonicalize the boundary values.
  setAllDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setNoneDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setEnumDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setIntervalDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setNamedDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setPatternDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setWhereDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setUnionDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setIntersectDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setDiffDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  setComplementDecideSubset: (a, b) => dispatchCanonicalPair(a, b, isSubsetDispatch),
  // Decide disjoint — every shape delegates to the Fenel dispatcher, which
  // owns the symmetric swap and every shape rule.
  setAllDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setNoneDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setEnumDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setIntervalDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setNamedDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setPatternDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setWhereDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setUnionDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setIntersectDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setDiffDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  setComplementDecideDisjoint: (a, b) => dispatchCanonicalPair(a, b, isDisjointDispatch),
  // Decide empty — every shape delegates to the Fenel `decideEmpty`
  // dispatcher (no Empty decider is marshaller-fed; nothing to KEEP).
  setAllDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setNoneDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setEnumDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setIntervalDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setNamedDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setPatternDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setWhereDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setUnionDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setIntersectDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setDiffDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
  setComplementDecideEmpty: (s) => dispatchCanonicalSingle(s, decideEmptyDispatch),
};

// ---------------------------------------------------------------------------
// DecidableMembership instances — one per SetExpr structural shape. Fenel-
// authored typed values in fenel/modules/decidable-membership/instances.fenel
// (Phase 3.1 of typeclass-substrate-completion). The exported consts are thin
// projection lookups (the engine barrel re-exports them; the phase-3.1 +
// decidable-membership tests import some). Each method value is a reference
// to the per-shape procedure (`{$ref: "set.setIntervalContains"}`,
// `{$ref: "engine.seWitnessInterval"}`; modules-as-values Phase 2c).
// ---------------------------------------------------------------------------

const dmFenelInstances =
  loadFenelModule(DM_INSTANCES_FENEL, "decidable-membership", { dispatchInstanceFile: true }).instances ?? [];
function dmInstance(shape: string): Instance {
  const key = JSON.stringify([`Set${shape}`]);
  const found = dmFenelInstances.find(
    (i) => i.typeName === "DecidableMembership" && JSON.stringify(i.args) === key,
  );
  if (!found) throw new Error(`decidable-membership: missing Fenel instance DecidableMembership Set${shape}`);
  return found;
}

export const dmInstanceAll = dmInstance("All");
export const dmInstanceNone = dmInstance("None");
export const dmInstanceEnum = dmInstance("Enum");
export const dmInstanceInterval = dmInstance("Interval");
export const dmInstanceNamed = dmInstance("Named");
export const dmInstancePattern = dmInstance("Pattern");
export const dmInstanceWhere = dmInstance("Where");
export const dmInstanceUnion = dmInstance("Union");
export const dmInstanceIntersect = dmInstance("Intersect");
export const dmInstanceDiff = dmInstance("Diff");
export const dmInstanceComplement = dmInstance("Complement");
// decide-substrate Phase 8μ.1a/1b/8λ.1 — the datatype / fixpoint / exponential
// SET-former shapes join the family (the carried §6 bundle + SetArrow). Their
// four decision methods point at the POLYMORPHIC dispatchers (the recursive
// decider cascades already ship the SeCtor / SeMu / SeArrow arms); witness names
// each theory's own per-shape face, enumerate the shared honest non-enumerable
// face. Mechanical seam projection (the 11-shape precedent above).
export const dmInstanceCtor = dmInstance("Ctor");
export const dmInstanceMu = dmInstance("Mu");
export const dmInstanceArrow = dmInstance("Arrow");
// signature-substrate Phase 4 slice 3a — the VALIDATION-ONLY rigid atom joins
// the family so no registered SetExpr shape is missing a row. Every method is
// an abstention face by construction: the four decisions ride the polymorphic
// dispatchers (whose deciders now carry explicit `SeRigid` arms answering
// Nothing for membership / emptiness / disjointness, and Just true ONLY for
// `κ ⊆ κ`, `∅ ⊆ κ`, `κ ⊆ ⊤`), `witness` is the honest no-witness face, and
// `enumerate` is the honest non-enumerable one — deliberately NOT
// `seEnumNone`'s `Just []`, which would claim a complete empty extension and
// re-open the vacuity trap.
export const dmInstanceRigid = dmInstance("Rigid");

const dmDispatchInstances: Instance[] = [
  dmInstanceAll,
  dmInstanceNone,
  dmInstanceEnum,
  dmInstanceInterval,
  dmInstanceNamed,
  dmInstancePattern,
  dmInstanceWhere,
  dmInstanceUnion,
  dmInstanceIntersect,
  dmInstanceDiff,
  dmInstanceComplement,
  dmInstanceCtor,
  dmInstanceMu,
  dmInstanceArrow,
  dmInstanceRigid,
];

// ---------------------------------------------------------------------------
// Module export — declarative half from `decidable-membership.fenel` (48
// bodyless `@native` foreign decls + facets; `module set where` → `set:` ids
// AND the container name `set`), the DecidableMembership dispatch instances
// merged in, natives wired. Picked up by SYSTEM_MODULES in system-entities.ts +
// system-registry.ts + runtime loadRegistry; re-exported by index.ts.
// ---------------------------------------------------------------------------

const loaded = loadFenelModule(DM_FENEL, "set", { label: "Decidable Membership" });

export const decidableMembershipModule: FenelModule = {
  ...loaded,
  instances: [...(loaded.instances ?? []), ...dmDispatchInstances],
  nativeImpls: rekeyNativesById(dmNatives, "set"),
};

// Re-export the natives for direct use in tests (avoids constructing a
// full module registry just to exercise the underlying decision procedures).
export { dmNatives };

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/decidable-membership") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_decidable_membership from "./decidable-membership";
import { registerEngineModule as __reg_modules_decidable_membership } from "../engine-require";
__reg_modules_decidable_membership("modules/decidable-membership", __self_modules_decidable_membership);
