// ---------------------------------------------------------------------------
// Compilable laws (Phase 8) — `compilable-semantic-equivalence` over
// `Compilable JsModule` (keyed `JsAst` until modules-as-values Phase 2b).
//
// Phase 5 declared the `Compilable target` typeclass + `Compilable JsModule`
// instance and demonstrated semantic equivalence by hand for a handful of
// `add` / `sub` / `mul` / … bodies. Phase 8 promotes that demo into a
// kernel-verified Forall: declare the law on the typeclass, sample-test
// per `(source, inputs)` case via `prover:compilableSemanticCheck`, and
// route the iteration outcome through the kernel SampleTestResult rule
// for a `SampleTested` epistemic status.
//
// What this exercises:
//   1. The `compilable-semantic-equivalence` law is declared on the
//      `Compilable` typeclass and surfaces 13+ inline `(source, inputs)`
//      cases.
//   2. `validateLaws(dispatchRegistry, compileJsInstance, …)` reports
//      `pass` with `samplesChecked` matching the case count.
//   3. The kernel attaches `SampleTested` epistemic status with the
//      verified sample count.
//   4. The per-case proposer (`compilableSemanticCheckNative`) returns
//      `Just true` on agreement, `Just false` on a structural divergence
//      (negative-path coverage via a hand-built broken case).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  dispatchRegistry,
  compilable,
} from "./index";
import { compilableSemanticCheckNative } from "./modules/prover";

// ---------------------------------------------------------------------------
// Happy path — Compilable JsModule satisfies the equivalence law on every
// declared sample
// ---------------------------------------------------------------------------

describe("Compilable laws — declared on the typeclass", () => {
  it("declares the compilable-semantic-equivalence law", () => {
    const tc = dispatchRegistry.getClass("Compilable");
    expect(tc).toBeDefined();
    const lawNames = (tc?.laws ?? []).map((l) => l.name);
    expect(lawNames).toContain("compilable-semantic-equivalence");
  });

  it("the law's forall surfaces a non-trivial case list", () => {
    const law = compilable.laws?.find((l) => l.name === "compilable-semantic-equivalence");
    expect(law).toBeDefined();
    const forall = law?.forall ?? [];
    const caseBinding = forall.find(
      (f): f is { name: string; samples: unknown[] } =>
        typeof f === "object" && f !== null && "name" in f && (f as { name: string }).name === "case",
    );
    expect(caseBinding).toBeDefined();
    expect(caseBinding?.samples.length ?? 0).toBeGreaterThanOrEqual(10);
  });
});

// Phase 10a-5b: sample-iteration validateLaws assertions retired alongside
// the Interface.laws walking pass. The per-case proposer + Prover instance
// registration tests below remain; semantic-equivalence sample iteration
// returns via spec-record migration of `CompilableSpec` (10a-5d/e arc).

// ---------------------------------------------------------------------------
// Per-case check — direct exercise of the proposer native
// ---------------------------------------------------------------------------

describe("compilableSemanticCheckNative — per-case proposer", () => {
  it("returns Just true when compile-and-execute matches direct evaluate", () => {
    const result = compilableSemanticCheckNative(
      {
        name: "add",
        paramNames: ["a", "b"],
        body: { add: [{ var: "a" }, { var: "b" }] },
        args: [3, 5],
      },
      "compile-js:compileFenelToJs",
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just true on string concat through $fenel.concat", () => {
    const result = compilableSemanticCheckNative(
      {
        name: "concat",
        paramNames: ["a", "b"],
        body: { call: ["concat", { var: "a" }, { var: "b" }] },
        args: ["foo", "bar"],
      },
      "compile-js:compileFenelToJs",
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just false when the compile target rejects the body", () => {
    // `reduce` is unsupported by the Phase 5 JS target — Err Unsupported
    // surfaces as a refutation of the equivalence law for this case.
    const result = compilableSemanticCheckNative(
      {
        name: "unsupported",
        paramNames: ["xs"],
        body: { reduce: [{ var: "xs" }, { "+": [{ var: "current" }, { var: "accumulator" }] }, 0] },
        args: [[1, 2, 3]],
      },
      "compile-js:compileFenelToJs",
    );
    expect(result).toEqual({ $tag: "Just", _0: false });
  });

  it("returns Nothing on a malformed case shape", () => {
    const result = compilableSemanticCheckNative({ malformed: true }, "compile-js:compileFenelToJs");
    expect(result).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// expr-substrate Phase 6b — the 8→2 Prover consolidation
//
// Pre-6b a dedicated `Prover CompilableSemanticEquivalence` instance pointed
// at the per-case check. The 8→2 collapse (ProofStrategy = Structural | Smt)
// removed every per-proposition-shape Prover instance — the per-case CHECK
// (`prover:compilableSemanticCheck`, a `(testCase) -> MaybeBool`, NOT a
// `proposition -> Result` proposer) is NOT routed by the Structural router;
// its law test calls the native directly (above). Lifting it to an honest
// Proposition shape handled by Structural is deferred to 6c.
// ---------------------------------------------------------------------------

describe("Compilable laws — Phase 6b Prover consolidation (per-shape instances retired)", () => {
  it("the only Prover instances are the two strategies (Structural / Smt)", () => {
    const argKeys = dispatchRegistry.listInstances("Prover").map((i) => i.args[0]).sort();
    expect(argKeys).toEqual(["Smt", "Structural"]);
  });

  it("CompilableSemanticEquivalence is no longer a Prover instance arg (it's a per-case check, 6c lifts it)", () => {
    const argKeys = dispatchRegistry.listInstances("Prover").map((i) => i.args[0]);
    expect(argKeys).not.toContain("CompilableSemanticEquivalence");
  });

  it("the per-case check function stays registered + directly callable (prover:compilableSemanticCheck)", () => {
    expect(typeof compilableSemanticCheckNative).toBe("function");
  });
});
