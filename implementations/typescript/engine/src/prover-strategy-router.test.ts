// ---------------------------------------------------------------------------
// expr-substrate Phase 6b — the 8→2 Prover consolidation's router equivalence.
//
// `ProofStrategy = Structural | Smt`. The `Prover Structural` instance's
// propose method is the Fenel-bodied `prover:structuralPropose` router, which
// pattern-matches the proposition $tag and delegates to the existing untrusted
// proposers. This suite proves propose-via-router ≡ propose-direct on one
// proposition per routed shape (the kernel re-checks both identically), plus
// the OutOfScope fallthrough and the `smtPropose` stub.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createRegistry } from "./registry";
import {
  proverModule,
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
  monotonicityProverNative,
} from "./modules/prover";
import { evaluate } from "./json-logic";
import type { SetExpr } from "./types";

const reg = createRegistry([proverModule]);
const ctx = reg.evaluateContext();
const structural = reg.getFunction("prover:structuralPropose")!;
const smt = reg.getFunction("prover:smtPropose")!;
const viaRouter = (fnBody: unknown, proposition: unknown) =>
  evaluate(fnBody, { proposition }, ctx);

describe("Phase 6b — structuralPropose routes each shape to its proposer (propose-via-router ≡ propose-direct)", () => {
  it("PropSubset / PropDisjoint / PropEmpty / PropInhabited ⇒ decidableSetProver", () => {
    const cases: Array<Record<string, unknown>> = [
      { $tag: "PropSubset", s: { $tag: "SeEnum", values: [1, 2] } as SetExpr, t: { $tag: "SeEnum", values: [1, 2, 3] } as SetExpr },
      { $tag: "PropDisjoint", s: { $tag: "SeEnum", values: [1] } as SetExpr, t: { $tag: "SeEnum", values: [9] } as SetExpr },
      { $tag: "PropEmpty", s: { $tag: "SeNone" } as SetExpr },
      { $tag: "PropInhabited", s: { $tag: "SeEnum", values: [1, 2] } as SetExpr },
    ];
    for (const prop of cases) {
      expect(viaRouter(structural.body, prop)).toEqual(decidableSetProposerNative(prop));
    }
  });

  it("JEmpty / JInhabited (the K3 judgment-native currency) ⇒ decidableSetProver", () => {
    // decide-substrate Phase 2 K3: the router routes the one lattice judgment;
    // the proposer's shared shape recognizer recovers subset/disjoint/empty/
    // nonempty from the composed set.
    const subsetClaim = {
      $tag: "JEmpty",
      _0: {
        $tag: "SeIntersect",
        branches: [
          { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } },
          { $tag: "SeEnum", values: [1, 2] },
        ],
      },
    };
    const inhabitedClaim = { $tag: "JInhabited", _0: { $tag: "SeEnum", values: [1, 2] } };
    for (const claim of [subsetClaim, inhabitedClaim]) {
      const routed = viaRouter(structural.body, claim) as { $tag: string };
      expect(routed).toEqual(decidableSetProposerNative(claim) as Record<string, unknown>);
      expect(routed.$tag).toBe("Ok");
    }
  });

  it("PropEq ⇒ reductionProver", () => {
    const prop = { $tag: "PropEq", type: { $ref: "Number" }, lhs: 5, rhs: 5 };
    expect(viaRouter(structural.body, prop)).toEqual(reductionProverNative(prop));
  });

  it("PropForall ⇒ sampleTestProver", () => {
    const prop = { $tag: "PropForall", bind: { name: "x", type: { $ref: "Number" } }, propertyId: "P.law", samples: [1, 2, 3] };
    expect(viaRouter(structural.body, prop)).toEqual(sampleTestProverNative(prop));
  });

  it("PropMonotonic ⇒ monotonicityProver", () => {
    const prop = { $tag: "PropMonotonic", agg: "sum" };
    expect(viaRouter(structural.body, prop)).toEqual(monotonicityProverNative(prop));
  });

  it("a non-routed shape (the Compilable per-case CHECK, not a Prop*) ⇒ Err OutOfScope", () => {
    const out = viaRouter(structural.body, { $tag: "CompilableSemanticEquivalence" });
    expect(out).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "Structural prover: no rule for this proposition shape" },
    });
  });
});

describe("Phase 6b — smtPropose is an honest OutOfScope stub", () => {
  it("returns Err OutOfScope for any proposition (the SMT bridge is post-workstream)", () => {
    expect(viaRouter(smt.body, { $tag: "PropSubset", s: { $enum: [1] }, t: { $enum: [1, 2] } })).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "Smt bridge not integrated (post-workstream arc)" },
    });
  });
});
