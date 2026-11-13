// ---------------------------------------------------------------------------
// Prover — Curry-Howard substrate over Fenel
//
// Phase 4 of the implementation roadmap, Instance 3 of the meta-pattern
// from `design/structural-introspection.md`. The shape:
//
//   Proposition  = FenelType                    — a Type value
//   Proof p      = an inhabitant of type p      — a value of that type
//   Theorem      = (Proposition, Proof) pair    — proposition + witness
//   Law          = a Proposition declared as a typeclass requirement
//   Verification = (Proposition, Proof) -> Bool — the kernel
//
// All five are Fenel values. The kernel (engine/src/kernel.ts) is the
// trusted re-checker — small, audited, sound. Proposers (DecidableSetProver,
// ReductionProver, SampleTestProver in Phase 4; SmtArithmeticProver, Lean,
// LLM, ManualTactic in subsequent phases) are *untrusted*: they emit proof
// terms, and the kernel re-verifies every term from scratch. AI is just
// another proposer with no privileged status — same shape as a human
// writing a tactic. The substrate's honesty comes from the kernel.
//
// `Prover strategy` is the typeclass. Its two instances are keyed by strategy
// (`Structural`, `Smt`), not by proposition shape, and each holds its
// proposer: `propose : Any -> Result UnprovedReason Any`, a reference to the
// strategy's router function (modules-as-values Phase 2c), resolved through
// the registry like any function value.
//
// `EpistemicStatus` grades the *kind* of evidence: a `Proven` theorem has
// a kernel-verified proof term derived from logical reasoning; a
// `SolverChecked` theorem rode on a decidable algorithm sound by
// construction; `SampleTested` evidence is empirical (the law iterated
// over Exemplifiable samples and saw no counterexamples). Each Prover
// instance declares the status its proof terms carry, and the kernel
// attaches that status to the verified theorem.
//
// Phase 12 promotion: `Proposition` and `ProofTerm` are now first-class
// FenelType ADTs (registered as entities in `modules/prover.ts`). The
// TypeScript types below mirror those ADTs — they use `$tag` as the
// discriminator (canonical Fenel convention from the `construct` op),
// not the Phase 4 `$prop` field. Proposition values can now be
// constructed via `{construct: ["PropEq", T, x, y]}` from any Fenel body,
// pattern-matched in `case` arms, and stored as ordinary typed values.
// The kernel and proposers pattern-match the same `$tag`-tagged shape;
// the TS native impls are the performance branch backing the Fenel
// definitions (per AGENTS.md's opaque-rep convention).
// ---------------------------------------------------------------------------

import type { Interface, FenelType, FieldDef } from "./types";
import { Result } from "./type-foundation";

// ---------------------------------------------------------------------------
// EpistemicStatus — the lattice of evidence kinds
// ---------------------------------------------------------------------------

/**
 * EpistemicStatus categorises the strength + kind of evidence backing a
 * theorem. Each verified `(Proposition, Proof)` pair carries one of these
 * tags; CI gates / publication thresholds key off the category.
 *
 *   Proven         — kernel-verified proof term derived from a deductive
 *                    rule. The strongest guarantee.
 *   SolverChecked  — a decidable algorithm sound by construction ran to
 *                    completion. (E.g. set-algebra decision procedures.)
 *   SampleTested   — the property held for every Exemplifiable sample
 *                    iterated; empirical, not deductive. The right status
 *                    for laws over IO / external / floating-point /
 *                    "this code feels right" assertions.
 *   Assumed        — the user marked the proposition as an axiom; flagged
 *                    in CI so reviewers see assumption surface.
 *   Conjectured    — believed true; no checking attempted yet.
 *   Unknown        — no claim made.
 *   Refuted        — a counterexample exists. The opposite of `Proven`.
 *
 * `supported-by` / `consistent-with` / `inconsistent-with` (abductive
 * statuses) are reserved for a future `AbductiveProver` substrate (see
 * `design/structural-introspection.md`'s "Beyond proof" section). Phase 4
 * commits to the classical kinds.
 */
export type EpistemicStatus =
  | { readonly $tag: "Proven" }
  | { readonly $tag: "SolverChecked" }
  | { readonly $tag: "SampleTested"; readonly samplesChecked: number }
  | { readonly $tag: "Assumed" }
  | { readonly $tag: "Conjectured" }
  | { readonly $tag: "Unknown" }
  | { readonly $tag: "Refuted"; readonly counterexample?: unknown };

export const epistemicProven: EpistemicStatus = { $tag: "Proven" };
export const epistemicSolverChecked: EpistemicStatus = { $tag: "SolverChecked" };
export const epistemicAssumed: EpistemicStatus = { $tag: "Assumed" };
export const epistemicConjectured: EpistemicStatus = { $tag: "Conjectured" };
export const epistemicUnknown: EpistemicStatus = { $tag: "Unknown" };

export function epistemicSampleTested(samplesChecked: number): EpistemicStatus {
  return { $tag: "SampleTested", samplesChecked };
}

export function epistemicRefuted(counterexample?: unknown): EpistemicStatus {
  return counterexample === undefined
    ? { $tag: "Refuted" }
    : { $tag: "Refuted", counterexample };
}

// ---------------------------------------------------------------------------
// UnprovedReason — why a proposer declined to propose
// ---------------------------------------------------------------------------

/**
 * `UnprovedReason` is the structured `Err` payload a proposer returns when
 * it can't produce a proof term. Distinct from `Refuted`: an unproved
 * proposition might still be true — the proposer just didn't find evidence.
 * `Refuted` means a counterexample exists.
 *
 *   `OutOfScope`    — the proposer doesn't handle this proposition shape
 *                     (e.g. `DecidableSetProver` given an `Eq a b`).
 *   `Undecided`     — the proposer ran but couldn't conclude.
 *   `BudgetExceeded`— the proposer hit a sample / iteration cap. Useful
 *                     for sample-tested propers (signals "raise the cap").
 *   `WitnessError`  — the proposer found a refuting witness; carries it.
 *                     A `WitnessError` typically lifts to `Refuted` at the
 *                     law-validator boundary, not stays as `Unproved`.
 *
 * Stored as a `$variant`-shaped record so Fenel-side pattern matching
 * works uniformly.
 */
export type UnprovedReason =
  | { readonly $tag: "OutOfScope"; readonly note?: string }
  | { readonly $tag: "Undecided"; readonly note?: string }
  | { readonly $tag: "BudgetExceeded"; readonly note?: string }
  | { readonly $tag: "WitnessError"; readonly counterexample: unknown };

export function unprovedOutOfScope(note?: string): UnprovedReason {
  return note === undefined ? { $tag: "OutOfScope" } : { $tag: "OutOfScope", note };
}

export function unprovedUndecided(note?: string): UnprovedReason {
  return note === undefined ? { $tag: "Undecided" } : { $tag: "Undecided", note };
}

export function unprovedBudgetExceeded(note?: string): UnprovedReason {
  return note === undefined ? { $tag: "BudgetExceeded" } : { $tag: "BudgetExceeded", note };
}

export function unprovedWitnessError(counterexample: unknown): UnprovedReason {
  return { $tag: "WitnessError", counterexample };
}

// ---------------------------------------------------------------------------
// ProofTerm — the closed ADT the kernel re-checks
//
// Phase 4 ships a minimal proof-term language; every kernel rule expands
// the TCB (trusted computing base), so we keep it small.
//
//   `Refl x`                             — reflexivity. A proof of `Eq x x`
//                                          for any `x`. Discharged by the
//                                          kernel via `deepEqual` of the
//                                          recorded `value`.
//   `DecidableSetResult { kind, witness }`
//                                        — wraps a per-shape decidable-
//                                          membership outcome. `kind` is
//                                          one of "subset" | "disjoint" |
//                                          "empty"; `witness` carries the
//                                          SetExpr arguments. The kernel
//                                          re-runs the shape table to
//                                          confirm `Just true`.
//   `SampleTestResult { propertyId, samples, allPassed }`
//                                        — Phase 9.2 sample-iteration
//                                          claim. The kernel doesn't re-run
//                                          the iteration (that's the
//                                          proposer's job); it verifies the
//                                          *shape* of the claim and records
//                                          `EpistemicStatus.SampleTested`.
//
// The proof term is a typed value. New proposers extending the kernel
// either map onto an existing rule or propose adding a new ADT case +
// kernel rule — the second is the explicit way to grow the TCB.
//
// Phase 12: these ProofTerm shapes are now registered as a `$variant` FenelType
// (the `ProofTerm` entity in `modules/prover.ts`). The tag names already
// matched Fenel's `$tag` convention since Phase 4 — only the kernel and
// proposers' *propositions* needed migration from `$prop` → `$tag`. ProofTerm
// is unchanged on the wire.
// ---------------------------------------------------------------------------

export type ProofTerm =
  | {
      readonly $tag: "Refl";
      /** The value `x` such that this proves `Eq x x`. */
      readonly value: unknown;
    }
  | {
      readonly $tag: "DecidableSetResult";
      readonly kind: "subset" | "disjoint" | "empty" | "nonempty" | "witness" | "mu-induction";
      /** Subset/disjoint carry two SetExpr witnesses (left/right); empty +
       *  nonempty carry one. The `nonempty` kind (expr-substrate Phase 6b)
       *  proves `PropInhabited s` — re-run `decideEmpty`, accept on Just false.
       *  The `witness` kind (decide-substrate Phase 2 K3) proves a
       *  `JInhabited s` JUDGMENT claim from an ELEMENT: `left` carries the
       *  witness VALUE w, re-checked by the kernel's `{w} ⊆ s` singleton face
       *  (`verifyWitnessMembership`) — the same judgment specialised to a
       *  singleton, no new evidence KIND. The `mu-induction` kind
       *  (decide-substrate Phase 8μ.2) proves a subset-shaped JEmpty claim
       *  `μX.F ⊆ T` by the kernel's Park (Knaster-Tarski) rule
       *  (`verifyMuInduction`) — the kernel RE-DERIVES the premise `F[X:=T]`
       *  from the claim's (s, t), so `left`/`right` are a convenience the
       *  kernel need not trust. */
      readonly witness: { readonly left: unknown; readonly right?: unknown };
    }
  | {
      readonly $tag: "SampleTestResult";
      /** Stable identifier for the property being claimed. The Phase 4
       *  law-validator uses `<typeName>.<lawName>` here; future call sites
       *  can pick any stable id (a Proposition's content-hash would also work). */
      readonly propertyId: string;
      readonly samplesChecked: number;
      readonly allPassed: boolean;
    };

export function reflProof(value: unknown): ProofTerm {
  return { $tag: "Refl", value };
}

export function decidableSetProof(
  kind: "subset" | "disjoint" | "empty" | "nonempty" | "witness" | "mu-induction",
  witness: { left: unknown; right?: unknown },
): ProofTerm {
  return { $tag: "DecidableSetResult", kind, witness };
}

export function sampleTestProof(
  propertyId: string,
  samplesChecked: number,
  allPassed: boolean,
): ProofTerm {
  return { $tag: "SampleTestResult", propertyId, samplesChecked, allPassed };
}

// ---------------------------------------------------------------------------
// Proposition — the Prop* MARKER vocabulary (the closed ADT is RETIRED)
//
// decide-substrate Phase 2 K4: the closed `Proposition` ENTITY (the 6-case
// registered sum Phase 12 introduced) is GONE — the claim currency is the one
// lattice `Judgment` (JEmpty / JInhabited, `fenel/modules/engine/
// judgment.fenel`, built via the `propSubset`/`propDisjoint`/`propEmpty`/
// `propInhabited` Fenel builder faces). What SURVIVES here is the Prop*
// `$tag` MARKER vocabulary:
//
//   • `PropEq` / `PropForall` — the Refl / Sample PRESENTATIONS of the
//     judgment (singleton-equality; unmaterialised-⟦P⟧ empirical ⊆). The
//     kernel's presentation rules key on these tags STRUCTURALLY; the TS
//     `propEq` / `propForall` builders below are the `$`-key authoring
//     boundary (a `.fenel` body cannot author `$tag` shapes).
//   • `PropSubset` / `PropDisjoint` / `PropEmpty` / `PropInhabited` — the
//     COMPAT marker shapes for TS callers + tests; the proposer/kernel accept
//     them alongside judgments (the shared `engine:recheckPlan` recognizer
//     plans both identically). New code should build JUDGMENTS (the Fenel
//     builder faces, or `{$tag:"JEmpty"/"JInhabited", _0: set}` TS-side).
//
// Pattern matching on these tags (structuralPropose's arms, the kernel
// ladders) is structural — no registry entity is needed.
// ---------------------------------------------------------------------------

/**
 * `PropEq T a b` claims that `a` and `b` are equal at type `T`.
 * The kernel uses Fenel value equality (the enum-singleton relation) for Refl.
 */
export type EqProposition = {
  readonly $tag: "PropEq";
  readonly type: FenelType;
  readonly lhs: unknown;
  readonly rhs: unknown;
};

/** `PropSubset s t` — `s` is a subset of `t` in the set-algebra. */
export type SubsetProposition = {
  readonly $tag: "PropSubset";
  readonly s: unknown;
  readonly t: unknown;
};

/** `PropDisjoint s t` — `s ∩ t = ∅`. */
export type DisjointProposition = {
  readonly $tag: "PropDisjoint";
  readonly s: unknown;
  readonly t: unknown;
};

/** `PropEmpty s` — `s = ∅`. */
export type EmptyProposition = {
  readonly $tag: "PropEmpty";
  readonly s: unknown;
};

/** `PropInhabited s` — `s ≠ ∅` (s has at least one inhabitant). The dual of
 *  `PropEmpty`; the kernel re-runs `decideEmpty` and accepts on `Just false`
 *  (the `DecidableSetResult kind "nonempty"` rule, expr-substrate Phase 6b).
 *  Absorbs P5's some-inversion wart — `engine:some` emits this directly. */
export type InhabitedProposition = {
  readonly $tag: "PropInhabited";
  readonly s: unknown;
};

/**
 * `PropForall x:T. P(x)` — the universal claim that property `P` holds
 * for every value of type `T`. `T` is the FenelType of the bound
 * variable; `propertyId` names the property (the same id appears on the
 * resulting SampleTestResult proof term for the kernel to cross-check).
 * `samples` is the inline sample list the proposer iterated; left
 * undefined when the proposer pulled from `Exemplifiable<T>`.
 */
export type ForallProposition = {
  readonly $tag: "PropForall";
  readonly bind: { readonly name: string; readonly type: FenelType };
  readonly propertyId: string;
  readonly samples?: readonly unknown[];
};

export type Proposition =
  | EqProposition
  | SubsetProposition
  | DisjointProposition
  | EmptyProposition
  | InhabitedProposition
  | ForallProposition;

/** Helper constructors — convenience for TS callers. Each produces the
 *  canonical `{$tag: "Prop*", ...}` shape that the kernel and proposers
 *  pattern-match on. Equivalent in shape to what `{construct: ["PropEq",
 *  T, x, y]}` would yield from a Fenel body — these helpers are the TS
 *  fast-path. */
export function propEq(type: FenelType, lhs: unknown, rhs: unknown): EqProposition {
  return { $tag: "PropEq", type, lhs, rhs };
}

export function propSubset(s: unknown, t: unknown): SubsetProposition {
  return { $tag: "PropSubset", s, t };
}

export function propDisjoint(s: unknown, t: unknown): DisjointProposition {
  return { $tag: "PropDisjoint", s, t };
}

export function propEmpty(s: unknown): EmptyProposition {
  return { $tag: "PropEmpty", s };
}

export function propInhabited(s: unknown): InhabitedProposition {
  return { $tag: "PropInhabited", s };
}

export function propForall(
  bind: { name: string; type: FenelType },
  propertyId: string,
  samples?: readonly unknown[],
): ForallProposition {
  const base = { $tag: "PropForall" as const, bind, propertyId };
  return samples === undefined ? base : { ...base, samples };
}

/** The recognised Prop* MARKER tags (decide-substrate Phase 2 K4: the closed
 *  ADT is retired — this is the marker-vocabulary roster, kept for the
 *  reduction guard + TS callers; the 4 decidable tags are COMPAT shapes the
 *  shared recognizer plans alongside judgments). Adding a new presentation
 *  tag means extending this list and a kernel rule that re-checks it (the
 *  TCB grows by intent, not by accident). */
export const KNOWN_PROPOSITION_TAGS: ReadonlyArray<Proposition["$tag"]> = [
  "PropEq",
  "PropSubset",
  "PropDisjoint",
  "PropEmpty",
  "PropInhabited",
  "PropForall",
];

/** Type guard. Accepts any value whose `$tag` field begins with `"Prop"`
 *  — extension-friendly so user-registered proposition shapes (per the
 *  Phase 12 worked example, e.g. `PropMonotonic`) are recognised by the
 *  Prover dispatch surface even when the kernel doesn't have a built-in
 *  rule for them yet. The kernel still rejects unknown shapes at verify
 *  time; this guard's job is only "structurally a proposition?". */
export function isProposition(x: unknown): x is Proposition {
  if (typeof x !== "object" || x === null) return false;
  const tag = (x as Record<string, unknown>).$tag;
  return typeof tag === "string" && tag.startsWith("Prop");
}

// ---------------------------------------------------------------------------
// Prover typeclass — dispatch surface for proposers
//
// `Prover strategy` has one method `propose : Any -> Result UnprovedReason
// Any`. The class parameter is a strategy tag (`ProofStrategy = Structural |
// Smt`), not the proposition's shape: the two instances (`Prover Structural`,
// `Prover Smt`) take any claim, so the parameter appears in no argument and
// `propose` stays at return position (never `proposition -> …`, which would
// dispatch on the proposition). The field holds the proposer function itself:
// a `.fenel` instance writes `propose = prover.structuralPropose`, loaded as
// the reference `{$ref: "prover.structuralPropose"}` (modules-as-values
// Phase 2c).
//
// The method's type is written out as data exactly as the `.fenel`
// declaration (`fenel/std/interfaces.fenel`) parses: one positional `Any`
// parameter, and `Result UnprovedReason Any` inlined as the variant the parser
// emits. Pinned against `seedFromType` of that declaration in
// `modules-as-values-prover.test.ts`.
// ---------------------------------------------------------------------------

const NO_LABEL = { $tag: "Nothing" } as const;
const PROPOSITION_ARG: FieldDef = {
  name: "_0",
  key: { $tag: "PositionalField", index: 0 },
  label: NO_LABEL,
  type: { $ref: "Any" },
  ui: NO_LABEL,
  meta: {},
};
const RESULT_UNPROVED_REASON_ANY: FenelType = {
  $variant: {
    cases: [
      {
        name: "Err",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $ref: "UnprovedReason" }, meta: {}, ui: NO_LABEL }],
      },
      {
        name: "Ok",
        label: NO_LABEL,
        fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: NO_LABEL, type: { $ref: "Any" }, meta: {}, ui: NO_LABEL }],
      },
    ],
  },
};

export const prover: Interface = {
  name: "Prover",
  description:
    "Proof strategies. Each instance is one strategy (`Structural`, `Smt`) and holds its proposer, `propose : Any -> Result UnprovedReason Any`. Proposers are untrusted: the kernel (engine/src/kernel.ts) re-checks every term they produce from scratch. The proof-term shape is what earns kernel acceptance, not the proposer's identity — AI, SMT, manual tactics all sit behind the same Prover dispatch surface. See `design/structural-introspection.md` Instance 3.",
  params: [{ name: "strategy" }],
  methods: [
    {
      name: "propose",
      description:
        "The proposer function, `Any -> Result UnprovedReason Any`, over any claim (a `Judgment` or a Prop* marker). A successful proposal returns `Ok proofTerm`; the kernel re-verifies the term before promoting it to a theorem. `Err UnprovedReason` reports either a structured non-result (out-of-scope / undecided / budget exceeded) or a counterexample (which the law-validator lifts to a `Refuted` epistemic status).",
      params: [PROPOSITION_ARG],
      returns: RESULT_UNPROVED_REASON_ANY,
    },
  ],
  // Phase 4: no machine-checked laws on the Prover typeclass itself.
  // The class's "law" is that the kernel re-verifies every proof term,
  // which is structural — every Prover instance ends up gated by the
  // kernel at the law-validator boundary regardless of how it was
  // registered. Adding a quantified law here would require an
  // Exemplifiable<Proposition> instance for the proposition shape's
  // generator, which is a Phase 5+ concern.
};

export const proverTypeclasses: Interface[] = [prover];

// The seed writes `Result UnprovedReason Any` out as the parser-shaped
// variant, so the type-foundation `Result` helper is unused here; kept for
// parity with codec.ts.
void Result;
