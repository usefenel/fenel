// ---------------------------------------------------------------------------
// DecidableMembership — typeclass-dispatched set-algebra primitives
//
// Phase 3 of the implementation roadmap (Instance 1 of the meta-pattern from
// design/structural-introspection.md): collapse the closed SetExpr ADT
// constructors into a typeclass-dispatched form.
//
// A SetExpr is conceptually a Fenel function `a -> Bool` (membership test).
// Structural shapes (Interval, Enum, Pattern, Union, …) are functions WITH a
// `DecidableMembership` instance — the instance carries decision procedures
// for that specific shape (contains / decideSubset / decideDisjoint /
// decideEmpty).
//
// Phase 4: methods return `Maybe Boolean` instead of `Boolean`. `Just True` /
// `Just False` = decided; `Nothing` = "couldn't decide structurally". The
// previous conservative-false posture conflated refutation with undecidability;
// the tri-state distinguishes them honestly. Combinators ($union / $intersect /
// $complement / $diff) propagate `Nothing` upward — a leaf returning `Nothing`
// means the compound result is also `Nothing`, not `Just False`.
//
// `$where` carries an arbitrary JSON-Logic predicate, so its decideSubset /
// decideDisjoint / decideEmpty all return `Nothing` (the structural algebra
// can't reason inside the predicate). External-boundary callers collapse
// `Nothing → false` via the `*B` wrappers in set-algebra.ts.
//
// Method values are the per-shape procedures themselves: a `.fenel` instance
// writes `contains = set.setIntervalContains`, loaded as the reference
// `{$ref: "set.setIntervalContains"}` (modules-as-values Phase 2c). No
// production code invokes them: set-algebra.ts calls the Fenel deciders
// directly (through the engine-bodies-dispatch marshaller, which switches on
// the shape itself), and the laws below call the polymorphic `set:*`
// functions. The instances are the per-shape surface the laws, the editor and
// the registry show.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef, Interface } from "./types";
import { List } from "./type-foundation";

// ---------------------------------------------------------------------------
// DecidableMembership s — the decidability surface of a SetExpr structural
// shape: four decisions plus witness synthesis and finite enumeration.
//
// The single type parameter `s` is a tag: instances target the shape by its
// name (`SetInterval`, `SetEnum`, `SetPattern`, …), projected from the
// registered SetExpr constructor (`SeInterval` → `SetInterval`). It appears in
// no method argument, so every method stays at return position (selected by
// instance lookup, never by an argument's runtime type) and none joins
// bare-name routing: `contains` keeps routing to `Containable`. Each method is
// typed over its general input — any SetExpr, any value — and a shape-specific
// procedure given a set of another shape answers `Nothing` (Rom's 2026-09-25
// decision (a)).
//
// The element type is `Any` — different shapes admit different element types
// (Interval over numbers / strings; Enum over arbitrary values; Pattern over
// strings; …). The laws quantify over both via Phase 9.2 sample iteration.
//
// The method types are written out as data exactly as the `.fenel`
// declaration (`fenel/std/interfaces.fenel`) parses: positional parameters,
// and `Maybe …` inlined as the variant the parser emits (`List Any` through
// the type-foundation `List` builder, which has the parser's shape). Pinned
// against `seedFromType` of that declaration in
// `modules-as-values-decidable-membership.test.ts`.
// ---------------------------------------------------------------------------

const NO_LABEL = { $tag: "Nothing" } as const;
const SET_EXPR: FenelType = { $ref: "SetExpr" };
const ANY: FenelType = { $ref: "Any" };
const positionalArg = (index: number, type: FenelType): FieldDef => ({
  name: `_${index}`,
  key: { $tag: "PositionalField", index },
  label: NO_LABEL,
  type,
  ui: NO_LABEL,
  meta: {},
});
const maybeOf = (type: FenelType): FenelType => ({
  $variant: {
    cases: [
      { name: "Nothing", label: NO_LABEL },
      {
        name: "Just",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type, meta: {}, ui: NO_LABEL }],
      },
    ],
  },
});
const MAYBE_BOOLEAN = maybeOf({ $ref: "Boolean" });

export const decidableMembership: Interface = {
  name: "DecidableMembership",
  description:
    "Structural set shapes whose membership / subset / disjointness / emptiness are decidable — and (decide-substrate Phase 1) whose witness SYNTHESIS + finite ENUMERATION are part of the same theory surface: `witness` is the constructive dual of `decideEmpty` (a Just w proves non-emptiness by exhibition), `enumerate` the complete-finite-extension reader (`Just [] ≠ Nothing`). Each shape (Interval, Enum, Pattern, Union, …) is a DecidableMembership instance keyed by its shape tag `s`, and its fields hold the per-shape procedures themselves (`contains = set.setIntervalContains`). Every procedure takes any SetExpr; a shape-specific one given a set of another shape answers `Nothing`. `s` appears in no argument, so the methods are selected by instance lookup, not by an argument's type. The set algebra (set-algebra.ts) calls the Fenel deciders directly, not these instances.",
  params: [{ name: "s" }],
  methods: [
    {
      name: "contains",
      description:
        "The membership procedure, `(SetExpr, Any) -> Maybe Boolean`: `Just true` / `Just false` when this shape decides whether the value is in the set, `Nothing` when it cannot decide (an opaque predicate, an undecided child) or the set is of another shape.",
      params: [positionalArg(0, SET_EXPR), positionalArg(1, ANY)],
      returns: MAYBE_BOOLEAN,
    },
    {
      name: "decideSubset",
      description:
        "The subset decision, `(SetExpr, SetExpr) -> Maybe Boolean`: decides `a ⊆ b` for an arbitrary right-hand SetExpr. `Just true` = proven, `Just false` = refuted, `Nothing` = the algebra cannot decide structurally.",
      params: [positionalArg(0, SET_EXPR), positionalArg(1, SET_EXPR)],
      returns: MAYBE_BOOLEAN,
    },
    {
      name: "decideDisjoint",
      description:
        "The disjointness decision, `(SetExpr, SetExpr) -> Maybe Boolean`: decides `a ∩ b = ∅` for an arbitrary right-hand SetExpr. `Just true` = proven disjoint, `Just false` = a shared member exists, `Nothing` = the algebra cannot decide structurally.",
      params: [positionalArg(0, SET_EXPR), positionalArg(1, SET_EXPR)],
      returns: MAYBE_BOOLEAN,
    },
    {
      name: "decideEmpty",
      description:
        "The emptiness decision, `SetExpr -> Maybe Boolean`: `Just true` = provably empty, `Just false` = provably non-empty, `Nothing` for sets whose emptiness depends on a predicate the algebra cannot evaluate structurally.",
      params: [positionalArg(0, SET_EXPR)],
      returns: MAYBE_BOOLEAN,
    },
    // decide-substrate Phase 1 Stage B widened the family with witness
    // synthesis and finite enumeration; since decide-substrate Phase 3 each
    // instance names its shape's own face (`engine.seWitnessInterval`,
    // `engine.seEnumOpaque`, …), which re-matches its shape and answers
    // `Nothing` on a mismatch.
    {
      name: "witness",
      description:
        "The witness synthesis, `SetExpr -> Maybe Any` — the constructive dual of decideEmpty. `Just w` exhibits a member (proving non-emptiness constructively); `Nothing` = no canonical witness (empty, out-of-fragment, no attained bound — the ℝ honesty fence — or a set of another shape).",
      params: [positionalArg(0, SET_EXPR)],
      returns: maybeOf(ANY),
    },
    {
      name: "enumerate",
      description:
        "The finite-extension enumeration, `SetExpr -> Maybe (List Any)`. `Just xs` = the COMPLETE, exact, deduped finite extension; `Just []` = provably empty (the load-bearing `Just [] ≠ Nothing` split); `Nothing` = not finitely enumerable, or a set of another shape.",
      params: [positionalArg(0, SET_EXPR)],
      returns: maybeOf(List(ANY)),
    },
  ],
  laws: [
    {
      name: "decidable-membership-subset-soundness",
      description:
        "Subset soundness: if `decideSubset(s, t)` returns `Just True`, then every value in `s` is also in `t`. Sample-tested over inline SetExpr samples: `contains(s, x) = Just True ∧ decideSubset(s, t) = Just True ⇒ contains(t, x) = Just True`. The `Just True` matches are explicit because the methods now return `Maybe Boolean` — a `Nothing` outcome on either side vacuously satisfies the law (we made no claim).",
      // Inline-sample form so the law is checkable today without depending
      // on a full Exemplifiable<SetExpr> instance per shape. The samples
      // are intentionally narrow — the law is a soundness sanity check,
      // not adversarial fuzzing.
      // Interval samples use the canonical `Maybe<Bound>` lo/hi shape
      // (migration 0054 lifted `Interval.{lo,hi}`; these inert law samples
      // were missed by that sweep and fixed in expr-substrate Phase 6c —
      // the bare-bound form crashes `marshalMaybeBound` at evaluation time).
      forall: [
        {
          name: "s",
          samples: [
            { $tag: "SeEnum", values: [1, 2, 3] },
            { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Just", _0: { value: 10, inclusive: true } } } },
          ],
        },
        {
          name: "t",
          samples: [
            { $tag: "SeEnum", values: [1, 2, 3, 4, 5] },
            { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: -5, inclusive: true } }, hi: { $tag: "Just", _0: { value: 20, inclusive: true } } } },
            { $tag: "SeAll" },
          ],
        },
        { name: "x", samples: [1, 2, 3, 5, 11, 0] },
      ],
      // The methods return `Maybe Boolean`. To reason about the soundness
      // claim we pattern-match: `Just True` means proven, `Just False`
      // means refuted, `Nothing` means undecided. Soundness is about the
      // *proven* (Just True) branch — if we proved (s,x) ∈ contains AND
      // proved s ⊆ t, then we must also have proven x ∈ t.
      property: {
        match: [
          {
            // Pair of (contains(s,x), decideSubset(s,t)) as a tagged record
            and: [
              { deepEq: [{ call: ["set:contains", { var: "s" }, { var: "x" }] }, { $tag: "Just", _0: true }] },
              { deepEq: [{ call: ["set:decideSubset", { var: "s" }, { var: "t" }] }, { $tag: "Just", _0: true }] },
            ],
          },
          true,
          { deepEq: [{ call: ["set:contains", { var: "t" }, { var: "x" }] }, { $tag: "Just", _0: true }] },
          false,
          true,
        ],
      },
    },
    {
      name: "decidable-membership-disjoint-soundness",
      description:
        "Disjointness soundness: if `decideDisjoint(s, t) = Just True`, then no value is in both sets. Sample-tested: a positive disjointness proof rules out shared members. `Nothing` / `Just False` outcomes vacuously satisfy.",
      // Canonical Maybe<Bound> interval samples — see the subset law's note.
      forall: [
        {
          name: "s",
          samples: [
            { $tag: "SeEnum", values: [1, 2, 3] },
            { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Just", _0: { value: 10, inclusive: true } } } },
          ],
        },
        {
          name: "t",
          samples: [
            { $tag: "SeEnum", values: [10, 11, 12] },
            { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 100, inclusive: true } }, hi: { $tag: "Just", _0: { value: 200, inclusive: true } } } },
            { $tag: "SeNone" },
          ],
        },
        { name: "x", samples: [1, 2, 5, 10, 11, 100] },
      ],
      property: {
        if: [
          { deepEq: [{ call: ["set:decideDisjoint", { var: "s" }, { var: "t" }] }, { $tag: "Just", _0: true }] },
          {
            "!": [
              {
                and: [
                  { deepEq: [{ call: ["set:contains", { var: "s" }, { var: "x" }] }, { $tag: "Just", _0: true }] },
                  { deepEq: [{ call: ["set:contains", { var: "t" }, { var: "x" }] }, { $tag: "Just", _0: true }] },
                ],
              },
            ],
          },
          true,
        ],
      },
    },
    {
      name: "decidable-membership-empty-soundness",
      description:
        "Emptiness soundness: if `decideEmpty(s) = Just True`, no value is in `s`. Sample-tested: a positive emptiness proof refutes membership.",
      // Canonical Maybe<Bound> interval samples — see the subset law's note.
      forall: [
        {
          name: "s",
          samples: [
            { $tag: "SeNone" },
            { $tag: "SeEnum", values: [] },
            { $tag: "SeEnum", values: [1, 2, 3] },
            { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 5, inclusive: true } }, hi: { $tag: "Just", _0: { value: 0, inclusive: true } } } },
            { $tag: "SeAll" },
          ],
        },
        { name: "x", samples: [1, 2, 5, -1, 100, "abc"] },
      ],
      property: {
        if: [
          { deepEq: [{ call: ["set:decideEmpty", { var: "s" }] }, { $tag: "Just", _0: true }] },
          { "!": [{ deepEq: [{ call: ["set:contains", { var: "s" }, { var: "x" }] }, { $tag: "Just", _0: true }] }] },
          true,
        ],
      },
    },
    {
      name: "decidable-membership-witness-soundness",
      description:
        "Witness soundness (decide-substrate Phase 1 Stage B): if `witness(s) = Just w`, then w is a member — `decideSubset({w}, s) ≠ Just False` (membership phrased through the kernel's singleton-subset face `{v} ⊆ t`; bare `contains` is Containable's dispatch-method name, so the subset face is also the collision-free spelling). A Nothing witness (no canonical inhabitant) vacuously satisfies; an undecided subset (Nothing) is not a refutation. The property is ONE call to the Fenel-bodied `set:witnessSound` harness (decidable-membership.fenel) — the Maybe-unwrap match lives there, keeping the law logic Fenel-first (the trusted-law-harness pattern the 3h totality-gate notes for this family).",
      // Samples span the witnessing shapes (enum-first / inclusive-bound /
      // intersect-fold / union-first-child) AND the honest-Nothing fences
      // (empty enum / $none / $all / exclusive-unbounded), so a regression in
      // EITHER direction (a non-member witness, or a witness invented for an
      // empty set) refutes. Interval samples use the canonical Maybe<Bound>
      // lo/hi shape (see the subset law's note).
      forall: [
        {
          name: "s",
          samples: [
             { $tag: "SeEnum", values: [1, 2, 3] },
             { $tag: "SeEnum", values: [] },
             { $tag: "SeNone" },
             { $tag: "SeAll" },
             { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Just", _0: { value: 10, inclusive: true } } } },
             { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 3, inclusive: false } }, hi: { $tag: "Nothing" } } },
             { $tag: "SeUnion", branches: [{ $tag: "SeNone" }, { $tag: "SeEnum", values: [7] }] },
             {
               $tag: "SeIntersect",
               branches: [
                 { $tag: "SeInterval", interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Nothing" } } },
                 { $tag: "SeInterval", interval: { lo: { $tag: "Nothing" }, hi: { $tag: "Just", _0: { value: 5, inclusive: true } } } },
               ],
             },
          ],
        },
      ],
      property: { call: ["set:witnessSound", { var: "s" }] },
    },
  ],
};

// ---------------------------------------------------------------------------
// Aggregator export — consumed by builtin-classes.ts to merge the
// DecidableMembership typeclass into the global `builtinTypeclasses`
// array. Instance registration happens via the decidable-membership module
// (modules/decidable-membership.ts) — its per-shape instances ride along
// through the SYSTEM_MODULES loop in system-entities.ts.
// ---------------------------------------------------------------------------

export const decidableMembershipTypeclasses: Interface[] = [decidableMembership];
