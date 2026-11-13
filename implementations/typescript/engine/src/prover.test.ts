// ---------------------------------------------------------------------------
// Prover + kernel — end-to-end tests for Phase 4
//
// Exercises:
//   1. The kernel's three rules (Refl, DecidableSetResult, SampleTestResult)
//      both on the happy path and on shape-mismatch / witness-rejected /
//      unknown-rule failure modes.
//   2. DecidableSet / Reduction proposer-to-kernel round-trips, and the
//      generic SampleTest producer's honest refusal until it evaluates
//      the property rather than merely counting supplied samples.
//
// Conceptual structure: the propose() / verify() pair models the
// proposer-untrusted, kernel-trusted dance. Tests assert both that the
// happy path yields a kernel-accepted theorem AND that the kernel
// rejects malformed terms — the negative tests are what guarantee the
// trust boundary actually catches mistakes.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  type Proposition,
  type EqProposition,
  type SubsetProposition,
  type DisjointProposition,
  type EmptyProposition,
  type InhabitedProposition,
  type ForallProposition,
  reflProof,
  decidableSetProof,
  sampleTestProof,
} from "./prover";
import { verify } from "./kernel";
import {
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
} from "./modules/prover";
import type { SetExpr } from "./types";
// ---------------------------------------------------------------------------
// Kernel — Rule 1: Refl
// ---------------------------------------------------------------------------

describe("kernel — Refl", () => {
  it("accepts Refl x for Eq T x x", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 42,
      rhs: 42,
    };
    const proof = reflProof(42);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("Proven");
    }
  });

  it("rejects Refl on Eq with different operands", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 2,
    };
    const proof = reflProof(1);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("rejects Refl with `value` that differs from the operands", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 7,
      rhs: 7,
    };
    const proof = reflProof(8); // wrong witness
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("rejects Refl applied to non-Eq propositions (shape mismatch)", () => {
    const prop: SubsetProposition = {
      $tag: "PropSubset",
      s: { $tag: "SeEnum", values: [1] } as SetExpr,
      t: { $tag: "SeEnum", values: [1, 2] } as SetExpr,
    };
    const result = verify(prop as Proposition, reflProof(1));
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("ShapeMismatch");
    }
  });

  it("Refl accepts arbitrary deepEqual values (objects / arrays)", () => {
    const obj = { name: "Ada", age: 30 };
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Any" },
      lhs: obj,
      rhs: { name: "Ada", age: 30 }, // separate object, deepEqual'd
    };
    const result = verify(prop, reflProof({ name: "Ada", age: 30 }));
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("Proven");
    }
  });
});

// ---------------------------------------------------------------------------
// Kernel — Rule 2: DecidableSetResult
// ---------------------------------------------------------------------------

describe("kernel — DecidableSetResult", () => {
  it("accepts subset proof when isSubset re-checks Just true", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    const proof = decidableSetProof("subset", { left: s, right: t });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SolverChecked");
    }
  });

  it("rejects subset proof when isSubset re-check refutes", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 5] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    // Proposer pretended to prove this, but the kernel re-runs isSubset
    // and it returns Just false (5 isn't in {1,2,3}).
    const proof = decidableSetProof("subset", { left: s, right: t });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("accepts disjoint proof when isDisjoint re-checks Just true", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const t: SetExpr = { $tag: "SeEnum", values: [10, 11, 12] };
    const prop: DisjointProposition = { $tag: "PropDisjoint", s, t };
    const proof = decidableSetProof("disjoint", { left: s, right: t });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SolverChecked");
    }
  });

  it("accepts empty proof for $none", () => {
    const s: SetExpr = { $tag: "SeNone" };
    const prop: EmptyProposition = { $tag: "PropEmpty", s };
    const proof = decidableSetProof("empty", { left: s });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SolverChecked");
    }
  });

  it("rejects DecidableSetResult.kind mismatched with proposition", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    // Proposer claims it's a disjoint proof, but the proposition is Subset.
    const proof = decidableSetProof("disjoint", { left: s, right: t });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("ShapeMismatch");
    }
  });

  it("rejects witness with swapped sides", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    // Proposer claims (t, s) but proposition is (s, t) — witness check refuses.
    const proof = decidableSetProof("subset", { left: t, right: s });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });
});

// ---------------------------------------------------------------------------
// Kernel + DecidableSetProver — PropInhabited (expr-substrate Phase 6b)
//
// The some-inversion absorption: `PropInhabited s` ("s ≠ ∅") is proved by a
// `DecidableSetResult kind "nonempty"` term — the kernel re-runs decideEmpty
// and accepts on Just false (the INVERTED dual of the PropEmpty rule).
// ---------------------------------------------------------------------------

describe("kernel — PropInhabited (nonempty rule)", () => {
  it("accepts a nonempty proof when decideEmpty re-checks Just false", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: InhabitedProposition = { $tag: "PropInhabited", s };
    const proof = decidableSetProof("nonempty", { left: s });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  });

  it("rejects a nonempty proof when the set is actually empty ($none ⇒ decideEmpty Just true)", () => {
    const s: SetExpr = { $tag: "SeNone" };
    const prop: InhabitedProposition = { $tag: "PropInhabited", s };
    const proof = decidableSetProof("nonempty", { left: s });
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") expect(result._0.$tag).toBe("WitnessRejected");
  });

  it("rejects a nonempty proof whose kind mismatches the proposition (PropEmpty)", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1] };
    const prop: EmptyProposition = { $tag: "PropEmpty", s };
    const proof = decidableSetProof("nonempty", { left: s });
    const result = verify(prop as Proposition, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") expect(result._0.$tag).toBe("ShapeMismatch");
  });
});

describe("DecidableSetProver — PropInhabited propose() + verify() round-trip", () => {
  it("Inhabited (non-empty set): emits a nonempty proof term the kernel accepts", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const prop: InhabitedProposition = { $tag: "PropInhabited", s };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("Inhabited (empty set): proposer surfaces WitnessError (inhabited-refuted)", () => {
    const s: SetExpr = { $tag: "SeNone" };
    const prop: InhabitedProposition = { $tag: "PropInhabited", s };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") expect(out._0.$tag).toBe("WitnessError");
  });
});

// ---------------------------------------------------------------------------
// Kernel — Rule 3: SampleTestResult
// ---------------------------------------------------------------------------

describe("kernel — SampleTestResult", () => {
  it("accepts SampleTestResult on Forall when allPassed and propertyId match", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "MyClass.identity",
      samples: [1, 2, 3, 4, 5],
    };
    const proof = sampleTestProof("MyClass.identity", 5, true);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SampleTested");
      if (result._0.$tag === "SampleTested") {
        expect(result._0.samplesChecked).toBe(5);
      }
    }
  });

  it("rejects SampleTestResult with allPassed = false", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "MyClass.identity",
    };
    const proof = sampleTestProof("MyClass.identity", 3, false);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("rejects SampleTestResult with mismatched propertyId", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "MyClass.identity",
    };
    const proof = sampleTestProof("OtherClass.otherLaw", 5, true);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("rejects SampleTestResult with zero samples", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "MyClass.law",
    };
    const proof = sampleTestProof("MyClass.law", 0, true);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("WitnessRejected");
    }
  });

  it("rejects SampleTestResult applied to non-Forall propositions", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 1,
    };
    const proof = sampleTestProof("Anything", 5, true);
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("ShapeMismatch");
    }
  });
});

// ---------------------------------------------------------------------------
// External proof sources bypass the Prover layer (expr-substrate Phase 6b)
//
// LLM / human / external attestations are NOT Provers — they are ProofTerm
// SOURCES that call the kernel directly. The kernel re-checks every term from
// scratch, so an external source earns kernel-grade evidence (Proven /
// SolverChecked) exactly when its term survives re-checking — no Prover
// instance, no dispatch involved. (An external attestation the kernel CANNOT
// re-check rides the `Evidence External` provenance value instead — graded
// Assumed; see law-validation.)
// ---------------------------------------------------------------------------

describe("external proof source — kernel.verify directly, no Prover instance", () => {
  it("a hand-built Refl term (an 'external source') verifies through the kernel as Proven", () => {
    // No proposer dispatch — the term is constructed by hand, as an external
    // source (an LLM / human) would, and handed straight to the trust gate.
    const prop: EqProposition = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 99, rhs: 99 };
    const externalTerm = reflProof(99);
    const result = verify(prop, externalTerm);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("Proven");
  });

  it("the kernel still rejects an external source's bogus term (the trust gate holds)", () => {
    const prop: EqProposition = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 1, rhs: 2 };
    const result = verify(prop, reflProof(1));
    expect(result.$tag).toBe("Err"); // claim doesn't survive re-checking
  });
});

// ---------------------------------------------------------------------------
// Kernel — unknown rule (TCB guard)
// ---------------------------------------------------------------------------

describe("kernel — unknown proof-term rule", () => {
  it("rejects proof terms with an unrecognised $tag", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 1,
    };
    // A proof term shape the kernel hasn't been taught about — TCB guard.
    const bogusProof = { $tag: "Imagination", payload: "trust me" } as unknown as Parameters<typeof verify>[1];
    const result = verify(prop, bogusProof);
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("UnknownRule");
    }
  });
});

// ---------------------------------------------------------------------------
// DecidableSetProver — end-to-end
// ---------------------------------------------------------------------------

describe("DecidableSetProver — propose() + verify() round-trip", () => {
  it("Subset: emits a proof term the kernel accepts", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("Subset (refuted): proposer surfaces WitnessError", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 5] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop: SubsetProposition = { $tag: "PropSubset", s, t };
    // isSubset({$enum:[1,5]}, {$enum:[1,2,3]}) ⇒ Just false (5 ∉ {1,2,3}).
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("WitnessError");
    }
  });

  it("Disjoint: emits a proof term the kernel accepts", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [10, 11] };
    const prop: DisjointProposition = { $tag: "PropDisjoint", s, t };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("Empty($none): emits a proof term the kernel accepts", () => {
    const s: SetExpr = { $tag: "SeNone" };
    const prop: EmptyProposition = { $tag: "PropEmpty", s };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("returns OutOfScope for an Eq proposition", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 1,
    };
    const out = decidableSetProposerNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("OutOfScope");
    }
  });
});

// ---------------------------------------------------------------------------
// ReductionProver — end-to-end
// ---------------------------------------------------------------------------

describe("ReductionProver — propose() + verify() round-trip", () => {
  it("Eq on identical plain values: emits Refl, kernel accepts", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 42,
      rhs: 42,
    };
    const out = reductionProverNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("Eq on different values: surfaces WitnessError", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 2,
    };
    const out = reductionProverNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("WitnessError");
    }
  });

  it("Eq on identical objects (deep-equal): emits Refl, kernel accepts", () => {
    const a = { name: "Ada", age: 30 };
    const b = { name: "Ada", age: 30 };
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Any" },
      lhs: a,
      rhs: b,
    };
    const out = reductionProverNative(prop) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      const verifyResult = verify(prop, out._0 as Parameters<typeof verify>[1]);
      expect(verifyResult.$tag).toBe("Ok");
    }
  });

  it("returns OutOfScope for a Subset proposition", () => {
    const prop: SubsetProposition = {
      $tag: "PropSubset",
      s: { $tag: "SeEnum", values: [1] } as SetExpr,
      t: { $tag: "SeEnum", values: [1, 2] } as SetExpr,
    };
    const out = reductionProverNative(prop as Proposition) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("OutOfScope");
    }
  });
});

// ---------------------------------------------------------------------------
// SampleTestProver — end-to-end
// ---------------------------------------------------------------------------

describe("SampleTestProver — unevaluated property fence", () => {
  it("Forall with inline samples declines because no property was evaluated", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Identity.refl",
      samples: [0, 1, 2, 3, 4],
    };
    expect(sampleTestProverNative(prop)).toEqual({
      $tag: "Err",
      _0: {
        $tag: "Undecided",
        note: "SampleTestProver has not evaluated the property on its samples; a sample count is not SampleTested evidence",
      },
    });
  });

  it("an unevaluated false predicate cannot become SampleTested evidence", () => {
    const prop = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Regression.alwaysFalse",
      samples: [0, 1, 2],
      // The generic producer accepts unknown input, but has no predicate
      // evaluation path. Supplying a false body cannot manufacture a result.
      property: false,
    };
    expect(prop.samples.every(() => prop.property)).toBe(false);
    const out = sampleTestProverNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    expect(out._0.$tag).toBe("Undecided");
  });

  it("a true predicate is equally unevaluated, rather than reported as refuted", () => {
    const out = sampleTestProverNative({
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Regression.alwaysTrue",
      samples: [0, 1, 2],
      property: true,
    }) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    expect(out._0.$tag).toBe("Undecided");
  });

  it("the exact sample budget boundary still declines instead of claiming tests", () => {
    const out = sampleTestProverNative({
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Regression.budgetBoundary",
      samples: Array.from({ length: 200 }, (_, i) => i),
    }) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    expect(out._0.$tag).toBe("Undecided");
  });

  it("Forall without samples: surfaces Undecided", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Identity.refl",
      // no samples provided
    };
    const out = sampleTestProverNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("Undecided");
    }
  });

  it("Forall with too many samples: surfaces BudgetExceeded", () => {
    const prop: ForallProposition = {
      $tag: "PropForall",
      bind: { name: "x", type: { $ref: "Number" } },
      propertyId: "Identity.refl",
      samples: Array.from({ length: 1000 }, (_, i) => i),
    };
    const out = sampleTestProverNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("BudgetExceeded");
    }
  });

  it("returns OutOfScope for non-Forall propositions", () => {
    const prop: EqProposition = {
      $tag: "PropEq",
      type: { $ref: "Number" },
      lhs: 1,
      rhs: 1,
    };
    const out = sampleTestProverNative(prop) as { $tag: string; _0: { $tag: string } };
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("OutOfScope");
    }
  });
});

// ---------------------------------------------------------------------------
// decide-substrate Phase 2 K3 — the kernel accepts JUDGMENT claims + THE
// WITNESS-MEMBERSHIP RULE (the phase's title capability, K1-landed, K3-wired).
//
// The claim currency is the one lattice judgment (JEmpty / JInhabited over a
// SetExpr; payload rides the positional `_0`). The proposer + kernel both
// route through the shared Fenel shape recognizer (`engine:recheckPlan`):
// a subset-shaped JEmpty re-decides via isSubset, an inhabited claim via the
// inverted decideEmpty — tri-precision preserved. `DecidableSetResult{kind:
// "witness", witness: {left: w}}` proves `JInhabited s` by the kernel's
// `{w} ⊆ s` singleton-subset re-check (`verifyWitnessMembership`) — the SAME
// judgment specialised to a singleton, no new evidence kind.
// ---------------------------------------------------------------------------

describe("K3 — judgment claims flow natively through proposer + kernel", () => {
  const SeEnumOf = (vs: unknown[]) => ({ $tag: "SeEnum", values: vs }) as unknown as SetExpr;
  const jInhabited = (s: unknown) => ({ $tag: "JInhabited", _0: s }) as never;
  const subsetJudgment = (s: unknown, t: unknown) =>
    ({
      $tag: "JEmpty",
      _0: { $tag: "SeIntersect", branches: [{ $tag: "SeComplement", inner: t }, s] },
    }) as never;

  it("a subset-shaped JEmpty claim round-trips Ok (SolverChecked)", () => {
    const claim = subsetJudgment(SeEnumOf([1, 2]), SeEnumOf([1, 2, 3]));
    const proposed = decidableSetProposerNative(claim) as { $tag: string; _0: unknown };
    expect(proposed.$tag).toBe("Ok");
    const vr = verify(claim, proposed._0 as Parameters<typeof verify>[1]);
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  it("a JInhabited claim round-trips Ok via the inverted decideEmpty (kind nonempty)", () => {
    const claim = jInhabited(SeEnumOf([1, 2, 3]));
    const proposed = decidableSetProposerNative(claim) as {
      $tag: string;
      _0: { $tag: string; kind?: string };
    };
    expect(proposed.$tag).toBe("Ok");
    expect(proposed._0.kind).toBe("nonempty");
    const vr = verify(claim, proposed._0 as unknown as Parameters<typeof verify>[1]);
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  it("witness rule: a member witness proves JInhabited (SolverChecked)", () => {
    const claim = jInhabited(SeEnumOf([1, 2, 3]));
    const vr = verify(claim, decidableSetProof("witness", { left: 2 }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  it("witness rule: a non-member witness is REJECTED ({w} ⊆ s re-check Just false)", () => {
    const claim = jInhabited(SeEnumOf([1, 2, 3]));
    const vr = verify(claim, decidableSetProof("witness", { left: 99 }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("WitnessRejected");
  });

  it("witness rule: a witness proof on an emptiness (JEmpty) claim is a ShapeMismatch", () => {
    const claim = subsetJudgment(SeEnumOf([2]), SeEnumOf([1, 2, 3]));
    const vr = verify(claim, decidableSetProof("witness", { left: 2 }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("ShapeMismatch");
  });

  it("kind↔shape agreement: a subset proof on a JInhabited claim is a ShapeMismatch", () => {
    const claim = jInhabited(SeEnumOf([1, 2]));
    const vr = verify(
      claim,
      decidableSetProof("subset", { left: SeEnumOf([1, 2]), right: SeEnumOf([1, 2, 3]) }),
    );
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("ShapeMismatch");
  });

  it("witness anti-repurpose holds on judgment claims: a repurposed witness set is rejected", () => {
    // Proof claims (s, t) that do NOT match the judgment's recognized (s, t).
    const claim = subsetJudgment(SeEnumOf([1, 2]), SeEnumOf([1, 2, 3]));
    const vr = verify(
      claim,
      decidableSetProof("subset", { left: SeEnumOf([9]), right: SeEnumOf([9, 10]) }),
    );
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("WitnessRejected");
  });
});
