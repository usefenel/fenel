// ---------------------------------------------------------------------------
// expr-substrate Phase 6b0 — port-parity pins for the prover-substrate
// Fenel port (kernel / law-validation / proposer logic / discharge grade).
//
// The pre-existing suites (prover.test.ts / law-discharge.test.ts /
// typeclass-collapse-complete.test.ts) pin the consumer SHAPES ($tags,
// statuses) but not the MESSAGE STRINGS — which 6b0 moved into `.fenel`
// bodies. These tests pin the full byte shapes (reason strings included)
// so a drifted `.fenel` message can never slip through silently.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { verify } from "./kernel";
import {
  validateVerified,
  evidenceAxiom,
  evidenceSolverChecked,
  evidenceSampleTested,
  evidenceKernelProven,
  evidenceExternal,
  type Evidence,
} from "./law-validation";
import {
  decidableSetProposerNative,
  sampleTestProverNative,
  monotonicityProverNative,
} from "./modules/prover";
import { reflProof, decidableSetProof, sampleTestProof } from "./prover";
import type { Proposition, ProofTerm, EqProposition, SubsetProposition, ForallProposition } from "./prover";
import type { SetExpr } from "./types";

const asProp = (x: unknown) => x as Proposition;
const asProof = (x: unknown) => x as ProofTerm;

describe("6b0 kernel port — full VerifyResult byte shapes (messages pinned)", () => {
  it("UnknownRule carries the verbatim TCB-guard message", () => {
    const prop: EqProposition = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 1, rhs: 1 };
    expect(verify(prop, asProof({ $tag: "Imagination" }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "UnknownRule",
        reason:
          "kernel: no rule for proof term 'Imagination' (Phase 4 supports Refl / DecidableSetResult / SampleTestResult only)",
      },
    });
  });

  it("Refl shape-mismatch carries proposition/proof tags + the verbatim reason", () => {
    const prop: SubsetProposition = {
      $tag: "PropSubset",
      s: { $tag: "SeEnum", values: [1] } as SetExpr,
      t: { $tag: "SeEnum", values: [1, 2] } as SetExpr,
    };
    expect(verify(asProp(prop), reflProof(1))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "ShapeMismatch",
        reason: "Refl is a proof of PropEq, not PropSubset",
        propositionTag: "PropSubset",
        proofTag: "Refl",
      },
    });
  });

  it("Refl operand divergence + witness divergence carry the verbatim reasons", () => {
    const neq: EqProposition = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 1, rhs: 2 };
    expect(verify(neq, reflProof(1))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "Refl requires lhs ≡ rhs (structural equality), but the operands differ",
      },
    });
    const eq7: EqProposition = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 7, rhs: 7 };
    expect(verify(eq7, reflProof(8))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "Refl carries a `value` that must equal both PropEq operands",
      },
    });
  });

  it("DecidableSet kind-guard mismatch + witness mismatch + re-check refusal pin verbatim", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    expect(verify(asProp(prop), decidableSetProof("disjoint", { left: s, right: t }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "ShapeMismatch",
        reason: "DecidableSetResult{kind:disjoint} requires a PropDisjoint proposition",
        propositionTag: "PropSubset",
        proofTag: "DecidableSetResult",
      },
    });
    expect(verify(asProp(prop), decidableSetProof("subset", { left: t, right: s }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "DecidableSetResult{kind:subset} witness must match the proposition's (s, t)",
      },
    });
    const bad: SubsetProposition = { $tag: "PropSubset", s: { $tag: "SeEnum", values: [9] } as SetExpr, t };
    expect(
      verify(asProp(bad), decidableSetProof("subset", { left: bad.s, right: t })),
    ).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "isSubset re-check did not return `Just true` for the witnessed pair",
      },
    });
  });

  it("PropInhabited (Phase 6b) nonempty kind-guard + witness + inverted re-check refusal pin verbatim", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    // kind-guard mismatch: a nonempty proof against a non-PropInhabited proposition.
    expect(verify(asProp({ $tag: "PropEmpty", s }), decidableSetProof("nonempty", { left: s }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "ShapeMismatch",
        reason: "DecidableSetResult{kind:nonempty} requires a PropInhabited proposition",
        propositionTag: "PropEmpty",
        proofTag: "DecidableSetResult",
      },
    });
    // witness mismatch.
    expect(verify(asProp({ $tag: "PropInhabited", s }), decidableSetProof("nonempty", { left: { $enum: [9] } }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "DecidableSetResult{kind:nonempty} witness must match the proposition's s",
      },
    });
    // re-check refusal: an empty set fails the INVERTED accept (needs Just false).
    expect(verify(asProp({ $tag: "PropInhabited", s: { $none: true } }), decidableSetProof("nonempty", { left: { $none: true } }))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason: "decideEmpty re-check did not return `Just false` (set is empty / undecided) for the witnessed set",
      },
    });
    // happy path: a non-empty set accepts as SolverChecked.
    expect(verify(asProp({ $tag: "PropInhabited", s }), decidableSetProof("nonempty", { left: s }))).toEqual({
      $tag: "Ok",
      _0: { $tag: "SolverChecked" },
    });
  });

  it("SampleTest propertyId mismatch pins the interpolated message", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "MyClass.identity",
    };
    expect(verify(prop, sampleTestProof("Other.law", 5, true))).toEqual({
      $tag: "Err",
      _0: {
        $tag: "WitnessRejected",
        reason:
          "SampleTestResult propertyId 'Other.law' does not match the proposition's 'MyClass.identity'",
      },
    });
  });

  it("SampleTested success carries the sample count in the epistemic status", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "P.law",
      samples: [1, 2, 3],
    };
    expect(verify(prop, sampleTestProof("P.law", 3, true))).toEqual({
      $tag: "Ok",
      _0: { $tag: "SampleTested", samplesChecked: 3 },
    });
  });
});

describe("6b0 law-validation port — full LawValidationResult byte shapes", () => {
  it("all four Evidence variants reproduce the exact result records", () => {
    expect(validateVerified(true, evidenceAxiom, "lawA")).toEqual({
      law: "lawA",
      status: "pass",
      epistemicStatus: { $tag: "Assumed" },
    });
    expect(validateVerified(true, evidenceSolverChecked, "lawB")).toEqual({
      law: "lawB",
      status: "pass",
      epistemicStatus: { $tag: "SolverChecked" },
    });
    expect(validateVerified(true, evidenceSampleTested(50), "lawC")).toEqual({
      law: "lawC",
      status: "pass",
      samplesChecked: 50,
      epistemicStatus: { $tag: "SampleTested", samplesChecked: 50 },
    });
    expect(validateVerified(true, evidenceKernelProven("proofFn"), "lawD")).toEqual({
      law: "lawD",
      status: "uncheckable",
      reason:
        "KernelProven evidence reserved — today's kernel doesn't reduction-check proof expressions (see design/laws-and-proofs.md Stage 10+).",
      epistemicStatus: { $tag: "Unknown" },
    });
  });

  it("External evidence (Phase 6b Q1 arm A) grades pass / Assumed (A-minimal)", () => {
    expect(validateVerified(true, evidenceExternal("gpt-4o-2026"), "lawExt")).toEqual({
      law: "lawExt",
      status: "pass",
      epistemicStatus: { $tag: "Assumed" },
    });
    // The provenance lives in the evidence VALUE (the LawValidationResult does
    // not repeat it under A-minimal); the constructor preserves the source.
    expect(evidenceExternal("gpt-4o-2026")).toEqual({ $tag: "External", source: "gpt-4o-2026" });
  });

  it("an unknown Evidence variant falls to the verbatim uncheckable arm", () => {
    expect(validateVerified(true, { $tag: "Vibes" } as unknown as Evidence, "lawE")).toEqual({
      law: "lawE",
      status: "uncheckable",
      reason: "Unknown Evidence variant",
      epistemicStatus: { $tag: "Unknown" },
    });
  });

  it("the default law name is '(verified)'", () => {
    expect(validateVerified(true, evidenceAxiom)).toEqual({
      law: "(verified)",
      status: "pass",
      epistemicStatus: { $tag: "Assumed" },
    });
  });
});

describe("6b0 proposer port — Err payload byte shapes (notes pinned)", () => {
  it("DecidableSetProver notes pin verbatim (out-of-scope / unhandled)", () => {
    expect(decidableSetProposerNative(42)).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "DecidableSetProver expects a structured Proposition" },
    });
    expect(
      decidableSetProposerNative({ $tag: "PropEq", type: { $ref: "Number" }, lhs: 1, rhs: 1 }),
    ).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "DecidableSetProver doesn't handle PropEq" },
    });
  });

  it("DecidableSetProver Ok terms carry the (left, right) / (left) witnesses byte-identically", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    expect(decidableSetProposerNative({ $tag: "PropSubset", s, t })).toEqual({
      $tag: "Ok",
      _0: { $tag: "DecidableSetResult", kind: "subset", witness: { left: s, right: t } },
    });
    const empty: SetExpr = { $tag: "SeNone" };
    expect(decidableSetProposerNative({ $tag: "PropEmpty", s: empty })).toEqual({
      $tag: "Ok",
      _0: { $tag: "DecidableSetResult", kind: "empty", witness: { left: empty } },
    });
  });

  it("DecidableSetProver refutation counterexamples carry the per-kind key sets", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 5] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    expect(decidableSetProposerNative({ $tag: "PropSubset", s, t })).toEqual({
      $tag: "Err",
      _0: { $tag: "WitnessError", counterexample: { kind: "subset-refuted", left: s, right: t } },
    });
    const nonempty: SetExpr = { $tag: "SeEnum", values: [1] };
    expect(decidableSetProposerNative({ $tag: "PropEmpty", s: nonempty })).toEqual({
      $tag: "Err",
      _0: { $tag: "WitnessError", counterexample: { kind: "empty-refuted", set: nonempty } },
    });
  });

  it("PropInhabited (Phase 6b) Ok nonempty witness + empty-set refutation pin byte-identically", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    expect(decidableSetProposerNative({ $tag: "PropInhabited", s })).toEqual({
      $tag: "Ok",
      _0: { $tag: "DecidableSetResult", kind: "nonempty", witness: { left: s } },
    });
    const empty: SetExpr = { $tag: "SeNone" };
    expect(decidableSetProposerNative({ $tag: "PropInhabited", s: empty })).toEqual({
      $tag: "Err",
      _0: { $tag: "WitnessError", counterexample: { kind: "inhabited-refuted", set: empty } },
    });
  });

  it("SampleTestProver notes pin verbatim (no samples / unevaluated samples / budget)", () => {
    const base = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "P.law",
    };
    expect(sampleTestProverNative(base)).toEqual({
      $tag: "Err",
      _0: {
        $tag: "Undecided",
        note: "SampleTestProver needs an inline `samples` array; future versions will pull from Exemplifiable instances",
      },
    });
    expect(sampleTestProverNative({ ...base, samples: [0, 1, 2] })).toEqual({
      $tag: "Err",
      _0: {
        $tag: "Undecided",
        note: "SampleTestProver has not evaluated the property on its samples; a sample count is not SampleTested evidence",
      },
    });
    expect(
      sampleTestProverNative({ ...base, samples: Array.from({ length: 1000 }, (_, i) => i) }),
    ).toEqual({
      $tag: "Err",
      _0: {
        $tag: "BudgetExceeded",
        note: "SampleTestProver: sample list (1000) exceeds budget (200); pass a smaller list or raise the budget",
      },
    });
  });

  it("MonotonicityProver notes pin verbatim for the unregistered-aggregable arm", () => {
    expect(monotonicityProverNative({ $tag: "PropMonotonic", agg: "noSuchAgg" })).toEqual({
      $tag: "Err",
      _0: {
        $tag: "Undecided",
        note: "MonotonicityProver: 'noSuchAgg' is not a registered Aggregable instance",
      },
    });
    expect(monotonicityProverNative({ $tag: "PropEq" })).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "MonotonicityProver expects PropMonotonic" },
    });
  });
});
