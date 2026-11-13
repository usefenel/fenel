// ---------------------------------------------------------------------------
// PartialEvaluator soundness law (Phase 8) — `partial-evaluator-soundness`
// on the Evaluator typeclass scoped to PartialStrategy.
//
// Phase 7 sample-tested PE soundness via the round-trip pattern in
// `partial-evaluator.test.ts` (every residual re-evaluates to the same
// value as the original under combined inputs). Phase 8 promotes that
// pattern into a typeclass-declared Forall law: per-case checks dispatch
// through `prover:partialEvaluatorSoundnessCheck`, the law-validator
// iterates the inline samples, and the kernel re-checks the
// SampleTestResult to grant `SampleTested` epistemic status.
//
// What this exercises:
//   1. The `partial-evaluator-soundness` law is declared on the `Evaluator`
//      typeclass with a non-trivial `(expr, ctx1, ctx2)` case list.
//   2. `validateLaws(dispatchRegistry, partialEvaluatorInstance, …)`
//      reports `pass` and the kernel attaches `SampleTested`.
//   3. The same law is meant to be *vacuously* satisfied for
//      non-PartialStrategy instances (Eager / Lazy / Jit) — the property
//      guards on the instance's `eval` method. Measured on the law path (the
//      last section below): the guard does not evaluate there, so the checker
//      runs for every instance, and no spelling of the partial evaluator's
//      `eval` skips the law.
//   4. The per-case proposer (`partialEvaluatorSoundnessCheckNative`)
//      returns `Just true` on agreement, `Just false` on a forced
//      disagreement.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  dispatchRegistry,
  evaluator,
} from "./index";
import { partialEvaluatorSoundnessCheckNative } from "./modules/prover";
import { resolveEvaluator } from "./evaluator-class";
import { getSystemRegistry } from "./system-registry";

// ---------------------------------------------------------------------------
// Law declaration + sample population
// ---------------------------------------------------------------------------

describe("PartialEvaluator soundness — declared on Evaluator typeclass", () => {
  it("declares the partial-evaluator-soundness law", () => {
    const tc = dispatchRegistry.getClass("Evaluator");
    expect(tc).toBeDefined();
    const lawNames = (tc?.laws ?? []).map((l) => l.name);
    expect(lawNames).toContain("partial-evaluator-soundness");
  });

  it("the law's forall surfaces a non-trivial (expr, ctx1, ctx2) case list", () => {
    const law = evaluator.laws?.find((l) => l.name === "partial-evaluator-soundness");
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

// ---------------------------------------------------------------------------
// Phase 10a-5b — sample-iteration validateLaws assertions for the
// PartialEvaluator + Eager/Lazy/Jit happy-path / vacuous-coverage cases
// retired alongside the Interface.laws walking pass. Spec-record
// migration of `EvaluatorSpec` reinstates them (10a-5d/e arc). The
// per-case proposer + Prover instance registration tests below remain.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-case check — direct exercise of the proposer native
// ---------------------------------------------------------------------------

describe("partialEvaluatorSoundnessCheckNative — per-case proposer", () => {
  it("returns Just true on a fully-known-via-ctx1 case", () => {
    const result = partialEvaluatorSoundnessCheckNative({
      expr: { "+": [{ var: "x" }, 1] },
      ctx1: { x: 5 },
      ctx2: {},
    });
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just true on a partly-known case (residual completed by ctx2)", () => {
    const result = partialEvaluatorSoundnessCheckNative({
      expr: { "+": [{ var: "x" }, { var: "y" }] },
      ctx1: { x: 5 },
      ctx2: { y: 3 },
    });
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just true on a constant fold", () => {
    const result = partialEvaluatorSoundnessCheckNative({
      expr: { mul: [3, 4] },
      ctx1: {},
      ctx2: {},
    });
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just true on dead-branch pruning under ctx1", () => {
    const result = partialEvaluatorSoundnessCheckNative({
      expr: { if: [{ var: "flag" }, "yes", "no"] },
      ctx1: { flag: true },
      ctx2: {},
    });
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Just true on dead-branch pruning under ctx2", () => {
    const result = partialEvaluatorSoundnessCheckNative({
      expr: { if: [{ var: "flag" }, "yes", "no"] },
      ctx1: {},
      ctx2: { flag: false },
    });
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Nothing on a malformed case shape", () => {
    expect(partialEvaluatorSoundnessCheckNative({})).toEqual({ $tag: "Nothing" });
    expect(partialEvaluatorSoundnessCheckNative(null)).toEqual({ $tag: "Nothing" });
    expect(partialEvaluatorSoundnessCheckNative("not a case")).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// expr-substrate Phase 6b — the 8→2 Prover consolidation
//
// Pre-6b a dedicated `Prover PartialEvaluatorSoundness` instance pointed at
// the per-case check. The 8→2 collapse (ProofStrategy = Structural | Smt)
// removed every per-proposition-shape Prover instance — the per-case CHECK
// (`prover:partialEvaluatorSoundnessCheck`, a `(testCase) -> MaybeBool`, NOT
// a `proposition -> Result` proposer) is NOT routed by the Structural router;
// its law test calls the native directly (above). Lifting it to an honest
// Proposition shape handled by Structural is deferred to 6c.
// ---------------------------------------------------------------------------

describe("PartialEvaluator soundness — Phase 6b Prover consolidation (per-shape instances retired)", () => {
  it("the only Prover instances are the two strategies (Structural / Smt)", () => {
    const argKeys = dispatchRegistry.listInstances("Prover").map((i) => i.args[0]).sort();
    expect(argKeys).toEqual(["Smt", "Structural"]);
  });

  it("PartialEvaluatorSoundness is no longer a Prover instance arg (it's a per-case check, 6c lifts it)", () => {
    const argKeys = dispatchRegistry.listInstances("Prover").map((i) => i.args[0]);
    expect(argKeys).not.toContain("PartialEvaluatorSoundness");
  });

  it("the per-case check function stays registered + directly callable (prover:partialEvaluatorSoundnessCheck)", () => {
    expect(typeof partialEvaluatorSoundnessCheckNative).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// modules-as-values — the instance guard, measured on the live law path.
//
// `law-discharge.ts:dischargeSampleLaw` evaluates `law.property` through
// `resolveEvaluator(ctx)` (no Evaluator frame, so the json-logic `evaluate`)
// over the instance's methods plus the forall bindings, with the system
// registry's evaluate context; `runLaw` is that step. A canary case the checker
// cannot read (it answers `Nothing`) makes the property `false` exactly when
// the guard lets the checker run.
//
// An Evaluator `eval` method may be a function reference, and no spelling of
// the partial evaluator's `eval` may skip the law. Measured: the guard's
// `{"===": …}` node names no function and no json-logic op, so it evaluates to
// a record literal, which is truthy. The checker therefore runs for EVERY
// `eval` value, the eager / lazy / jit ones included; making those vacuous
// needs a guard that compares resolved function identities.
// ---------------------------------------------------------------------------

describe("partial-evaluator-soundness — no spelling of partialEval skips the law", () => {
  const PARTIAL_ID = "evaluator-strategies:partialEval";
  const law = evaluator.laws?.find((l) => l.name === "partial-evaluator-soundness");
  const ctx = getSystemRegistry().evaluateContext();
  const runLaw = (evalMethod: unknown, testCase: unknown): unknown =>
    resolveEvaluator(ctx)(
      law!.property as Record<string, unknown>,
      { eval: evalMethod, case: testCase },
      ctx,
    );
  const CANARY = "not a case";

  it("every spelling runs the checker: the canary fails the law, a declared sample passes it", () => {
    const binding = (law?.forall ?? []).find(
      (f): f is { name: string; samples: unknown[] } =>
        typeof f === "object" && f !== null && "samples" in f && (f as { name: string }).name === "case",
    );
    const sample = binding?.samples[0];
    expect(sample).toBeDefined();
    const uuid = ctx._uuidBySlug?.get(PARTIAL_ID);
    expect(typeof uuid).toBe("string");

    const spellings: unknown[] = [
      PARTIAL_ID,
      { $ref: PARTIAL_ID },
      { $ref: "evaluatorStrategies.partialEval" },
      { $ref: "partialEval" },
      { $ref: uuid },
    ];
    for (const spelling of spellings) {
      // Each spelling names the partial evaluator...
      const handle = typeof spelling === "string" ? spelling : (spelling as { $ref: string }).$ref;
      expect(ctx.getFunction?.(handle)?.id).toBe(PARTIAL_ID);
      // ...and each one runs the checker.
      expect(runLaw(spelling, CANARY)).toBe(false);
      expect(runLaw(spelling, sample)).toBe(true);
    }
  });
});
