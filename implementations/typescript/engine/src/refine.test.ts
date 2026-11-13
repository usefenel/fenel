// expr-substrate Phase 7 — conformance tests for `refineType` (the ladder) +
// `dispatchedRefineType` (the full wrapper incl. the kernel-round-trip
// SOUNDNESS GATE). Brief:
// `workstreams/expr-substrate/briefs/phase-7-propose-refined-subtype.md`.
//
// THE FOUNDATIONAL CLAIM (design/solving-and-refinement.md): "prove should
// return a refined subtype of its input proposition, not a single proof term."
// `refine` ships it as a SIBLING of `Prover.propose` (the sums stay CLOSED).
//
// Three stages under test:
//   1. `engine:refineWherePred` — canonical SetExpr classification owned by
//      Fenel; the host consumes only its Maybe raw-predicate boundary result.
//   2. `engine:refineType` — the LADDER over `$`-free RefineInput markers
//      ⇒ RefineOutcome markers (RfEnum / RfInterval / RfNoProgress / RfOutOfScope).
//      Reuses P5's `predicateToSet "value"` + witIntersectFold / tighterLo|Hi.
//   3. `dispatchedRefineType` — extract the outer `$refined` host type,
//      canonicalize its set, ask Fenel to classify, lift JSON-Logic, dispatch
//      the ladder, and run the soundness gate.

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedRefineType,
} from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { dispatchModule } from "./modules/dispatch";
import { proverModule } from "./modules/prover";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

const refine = (input: unknown) =>
  dispatchEngineBody("engine:refineType", [input]) as { tag: string; [k: string]: unknown };

const refineWherePred = (set: unknown) =>
  dispatchEngineBody("engine:refineWherePred", [set]);

// ---------------------------------------------------------------------------
// Stage 0 — canonical SetExpr classification belongs to Fenel
// ---------------------------------------------------------------------------

describe("refineWherePred — canonical SetExpr ⇒ Maybe raw predicate", () => {
  it("extracts only SeWhere and rejects structural/deep SetExpr cases", () => {
    const pred = { "==": [{ var: "value" }, 5] };
    expect(refineWherePred({ $tag: "SeWhere", pred })).toEqual({
      $tag: "Just",
      _0: pred,
    });
    expect(refineWherePred({ $tag: "SeEnum", values: [5] })).toEqual({
      $tag: "Nothing",
    });
    expect(refineWherePred({
      $tag: "SeCtor",
      ctor: "Box",
      fields: [],
    })).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// Stage 1 — the ladder (engine:refineType over RefineInput markers)
// ---------------------------------------------------------------------------

describe("refineType ladder — RefineInput marker ⇒ RefineOutcome", () => {
  it("eq ⇒ RfEnum [5] (the exact singleton)", () => {
    const r = refine({ tag: "RiWhere", expr: ECall("eq", [EVar("value"), ELit(5)]) });
    expect(r).toEqual({ tag: "RfEnum", values: [5] });
  });

  it("numeric gte retains its native comparison carrier fence", () => {
    const r = refine({ tag: "RiWhere", expr: ECall("gte", [EVar("value"), ELit(3)]) });
    expect(r).toEqual({ tag: "RfNoProgress" });
  });

  it("numeric lt retains its native comparison carrier fence", () => {
    const r = refine({ tag: "RiWhere", expr: ECall("lt", [EVar("value"), ELit(7)]) });
    expect(r).toEqual({ tag: "RfNoProgress" });
  });

  it("and of numeric comparisons keeps the unsupported predicate", () => {
    const r = refine({
      tag: "RiWhere",
      expr: ECall("and", [
        ECall("gte", [EVar("value"), ELit(3)]),
        ECall("lt", [EVar("value"), ELit(7)]),
      ]),
    });
    expect(r).toEqual({ tag: "RfNoProgress" });
  });

  it("or of eqs ⇒ RfEnum [1, 2] (union-of-singletons / multi-enum)", () => {
    const r = refine({
      tag: "RiWhere",
      expr: ECall("or", [
        ECall("eq", [EVar("value"), ELit(1)]),
        ECall("eq", [EVar("value"), ELit(2)]),
      ]),
    });
    expect(r).toEqual({ tag: "RfEnum", values: [1, 2] });
  });

  it("or with a non-enum branch ⇒ RfNoProgress (the v1 union fence)", () => {
    const r = refine({
      tag: "RiWhere",
      expr: ECall("or", [
        ECall("eq", [EVar("value"), ELit(1)]),
        ECall("gte", [EVar("value"), ELit(9)]),
      ]),
    });
    expect(r).toEqual({ tag: "RfNoProgress" });
  });

  it("out-of-fragment predicate (call head) ⇒ RfNoProgress (never errs)", () => {
    expect(refine({ tag: "RiWhere", expr: ECall("foo", [EVar("value")]) })).toEqual({
      tag: "RfNoProgress",
    });
    // a comparison NOT over `value` ⇒ WsWhere ⇒ RfNoProgress
    expect(refine({ tag: "RiWhere", expr: ECall("eq", [EVar("y"), ELit(5)]) })).toEqual({
      tag: "RfNoProgress",
    });
  });

  it("RiStructural / RiNotRefined ⇒ RfNoProgress; RiNotType ⇒ RfOutOfScope", () => {
    expect(refine({ tag: "RiStructural" })).toEqual({ tag: "RfNoProgress" });
    expect(refine({ tag: "RiNotRefined" })).toEqual({ tag: "RfNoProgress" });
    expect(refine({ tag: "RiNotType" })).toEqual({ tag: "RfOutOfScope" });
  });

  it("P12 inheritance: an AFFINE `value`-predicate ⇒ RfEnum [0.5] (refine rides the widened predicateToSet fragment)", () => {
    // refineType reuses `predicateToSet "value"`, so the Phase 12 affine
    // widening flows in for free: `2*value + 5 == 6` ⇒ WsEnum [0.5] ⇒ RfEnum.
    const expr = ECall("eq", [ECall("add", [ECall("mul", [ELit(2), EVar("value")]), ELit(5)]), ELit(6)]);
    expect(refine({ tag: "RiWhere", expr })).toEqual({ tag: "RfEnum", values: [0.5] });
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — dispatchedRefineType: classify + unmarshal + the soundness gate
// ---------------------------------------------------------------------------

describe("dispatchedRefineType — the full wrapper + the kernel soundness gate", () => {
  const refinedWhere = (predicate: unknown) => ({
    $refined: { base: { $ref: "Int" }, set: { $tag: "SeWhere", pred: predicate } },
  });

  it("THE HEADLINE e2e: refine {Int | value==5} ⇒ Ok {Int | $enum [5]}", () => {
    const input = refinedWhere({ "==": [{ var: "value" }, 5] });
    expect(dispatchedRefineType(input)).toEqual({
      $tag: "Ok",
      _0: { $refined: { base: { $ref: "Int" }, set: { $tag: "SeEnum", values: [5] } } },
    });
  });

  it("refine {Int | native value>=3} refuses an interval that also admits record carriers", () => {
    const input = refinedWhere({ ">=": [{ var: "value" }, 3] });
    expect((dispatchedRefineType(input) as { $tag: string }).$tag).toBe("Err");
  });

  it("refine {Int | value==1 or value==2} ⇒ Ok {Int | SeEnum [1,2]}", () => {
    // The canonical SetExpr boundary lets the set-algebra prove the multi-enum
    // candidate is a subset of the source disjunction, so the kernel accepts.
    const input = refinedWhere({ or: [{ "==": [{ var: "value" }, 1] }, { "==": [{ var: "value" }, 2] }] });
    expect(dispatchedRefineType(input)).toEqual({
      $tag: "Ok",
      _0: {
        $refined: {
          base: { $ref: "Int" },
          set: { $tag: "SeEnum", values: [1, 2] },
        },
      },
    });
  });

  it("retains the legacy `$where` input only at the host boundary", () => {
    const input = {
      $refined: {
        base: { $ref: "Int" },
        set: { $where: { "==": [{ var: "value" }, 5] } },
      },
    };
    expect(dispatchedRefineType(input)).toEqual({
      $tag: "Ok",
      _0: {
        $refined: {
          base: { $ref: "Int" },
          set: { $tag: "SeEnum", values: [5] },
        },
      },
    });
  });

  it("P12 GATE-ACCEPT (decide-substrate P1 Stage A): refine {Int | 2*value + 5 == 6} ⇒ Ok {Int | $enum [0.5]}", () => {
    // The recognizer convergence LANDED (engine:comprehend — decide-substrate
    // Phase 1 Stage A): the soundness gate's `$where` extraction now routes
    // through the ONE recognizer, which inherits the P12 affine inversion —
    // `{$where: 2*value+5==6}` extracts to `{$enum:[0.5]}`, the kernel verifies
    // {0.5} ⊆ {0.5} (SolverChecked), and refine returns the genuinely refined
    // type. This test previously pinned the HONEST DISCARD (Ok input-unchanged)
    // and its comment named this exact convergence as what flips it to
    // gate-accept — the pinned limitation is REMOVED, not regressed.
    const input = refinedWhere({ "==": [{ "+": [{ "*": [2, { var: "value" }] }, 5] }, 6] });
    expect(dispatchedRefineType(input)).toEqual({
      $tag: "Ok",
      _0: { $refined: { base: { $ref: "Int" }, set: { $tag: "SeEnum", values: [0.5] } } },
    });
  });

  it("already-structural set ⇒ Ok unchanged (no-progress by construction)", () => {
    const input = { $refined: { base: { $ref: "Int" }, set: { $tag: "SeEnum", values: [1, 2] } } };
    expect(dispatchedRefineType(input)).toEqual({ $tag: "Ok", _0: input });
  });

  it("a non-refined type ⇒ Ok unchanged (no-progress)", () => {
    const input = { $ref: "Int" };
    expect(dispatchedRefineType(input)).toEqual({ $tag: "Ok", _0: input });
  });

  it("a non-type ⇒ Err OutOfScope (the only Err arm)", () => {
    expect(dispatchedRefineType(5)).toEqual({
      $tag: "Err",
      _0: { $tag: "OutOfScope", note: "refine: input is not a type" },
    });
    expect((dispatchedRefineType({ a: 1 }) as { $tag: string }).$tag).toBe("Err");
  });
});

// ---------------------------------------------------------------------------
// Registration — refineType resolves in one registry alongside the prover/kernel
// ---------------------------------------------------------------------------

describe("registration — refine classifier/type + the gate's prover/kernel coexist", () => {
  it("one registry resolves engine:refineWherePred / refineType / refineLadder / prover + kernel", () => {
    const reg = createRegistry([stdModule, engineModule, localeModule, dispatchModule, proverModule]);
    expect(reg.getFunction("engine:refineWherePred")).toBeDefined();
    expect(reg.getFunction("engine:refineType")).toBeDefined();
    expect(reg.getFunction("engine:refineLadder")).toBeDefined();
    expect(reg.getFunction("prover:decidableSetProver")).toBeDefined();
    expect(reg.getFunction("kernel:verify")).toBeDefined();
  });
});
