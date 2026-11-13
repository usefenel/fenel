// expr-substrate Phase 4b/4c — the CeExpr reconstitution corpus.
//
// 4b authored this as an OLD-cascade-vs-NEW-adapter byte-compare:
//
//   OLD  = makeClosuresExplicit ∘ makeEffectsExplicit ∘ lowerExpr(body)   (dead
//          recognition cascade → CoreExpr → the passes' Core* arms)
//   NEW  = makeClosuresExplicit ∘ makeEffectsExplicit ∘ normaliseToCore(body)
//          (delegated → jsonLogicToExpr → Expr → the passes' Expr arms +
//           CeIf/CeLet/CeDo reconstitution)
//
// 4c DELETES the dead cascade (`lowerExpr` + the ~33 target-producing helpers)
// and the passes' Core* arms — so there is no OLD path left to compare against.
// Per brief decision 7 the test DEGENERATES to a pinned-fixture self-
// consistency check: the NEW-path CeExpr trees for the 21 curated bodies were
// captured (while the dual-arm 4b HEAD still proved NEW≡OLD) into
// `closures-reconstitution.fixture.json`, and the test now asserts the live NEW
// path reproduces them byte-for-byte. A reconstitution regression (a wrong
// CeIf/CeLet/CeDo shape) trips here even when the self-host suites stay green.
//
// `newClosures` drives the LIVE front-end via `dispatchedNormaliseToCore`
// (which marshals the raw body internally) → makeEffectsExplicit →
// makeClosuresExplicit; the OLD-path `lowerExpr` driver + the local
// `marshalJsonLogic` / `marshalCtorDefs` copies are GONE with the cascade.

import { describe, it, expect } from "vitest";
import {
  dispatchedNormaliseToCore,
  dispatchedMakeEffectsExplicit,
  dispatchedMakeClosuresExplicit,
} from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";
import type { CompileFieldSlot } from "./compilable";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import FIXTURE from "./closures-reconstitution.fixture.json";

void engineModule; // ensure the engine module is registered before dispatch

type Ok<T> = { $tag: "Ok"; _0: T };
type CompileResult<T> = Ok<T> | { $tag: "Err"; _0: unknown };

const CTOR_DEFS: Record<string, ReadonlyArray<CompileFieldSlot>> = {
  Just: positionalCompileFieldSlots(["value"]),
  Nothing: [],
  Ok: positionalCompileFieldSlots(["value"]),
  Err: positionalCompileFieldSlots(["value"]),
  Cons: positionalCompileFieldSlots(["head", "tail"]),
  Nil: [],
};

type Body = { name: string; params: string[]; body: unknown };

/** NEW pipeline: delegated normaliseToCore (jsonLogicToExpr) → Expr arms. */
function newClosures(b: Body): unknown {
  const core = dispatchedNormaliseToCore({
    name: b.name,
    params: positionalCompileFieldSlots(b.params),
    body: b.body,
    requires: [],
    ctorDefs: CTOR_DEFS,
  }) as CompileResult<{ body: unknown }>;
  if (core.$tag !== "Ok") return { $err: core._0 };
  const eff = dispatchedMakeEffectsExplicit(core._0 as never) as CompileResult<{ body: unknown }>;
  if (eff.$tag !== "Ok") return { $err: eff._0 };
  const clo = dispatchedMakeClosuresExplicit(eff._0 as never) as CompileResult<{ body: unknown }>;
  if (clo.$tag !== "Ok") return { $err: clo._0 };
  return clo._0.body;
}

// Curated corpus: every reconstitution shape (brief decision 6 — hand-picked
// bodies covering if / let / do / match / named-construct, expanded to cover
// the run-splitting cases: pure-let, multi-let sequential scope, pure-do,
// leading-let do, leading-let + multi-tail, mid-stream let, if-chain, lambda +
// nested let, effect site under do).
const CORPUS: Body[] = [
  { name: "plainCall", params: ["a", "b"], body: { call: ["add", { var: "a" }, { var: "b" }] } },
  { name: "opForm", params: ["a"], body: { "+": [{ var: "a" }, 1] } },
  { name: "letOne", params: [], body: { let: { x: 1 } } },
  { name: "letSeq", params: [], body: { let: { x: 1, y: { "+": [{ var: "x" }, 1] } } } },
  { name: "doPure", params: ["a"], body: { do: [1, { var: "a" }] } },
  { name: "doTriple", params: ["a"], body: { do: [1, 2, { var: "a" }] } },
  { name: "doLeadLet", params: [], body: { do: [{ let: { x: 1 } }, { "+": [{ var: "x" }, 2] }] } },
  {
    name: "doLeadLetMulti",
    params: [],
    body: { do: [{ let: { x: 1 } }, { var: "x" }, { "+": [{ var: "x" }, 1] }] },
  },
  {
    name: "doMidLet",
    params: ["a"],
    body: { do: [{ var: "a" }, { let: { x: 1 } }, { var: "x" }] },
  },
  { name: "if3", params: ["c"], body: { if: [{ var: "c" }, 1, 2] } },
  { name: "if2", params: ["c"], body: { if: [{ var: "c" }, 1] } },
  { name: "ifChain", params: ["c1", "c2"], body: { if: [{ var: "c1" }, 1, { var: "c2" }, 2, 3] } },
  { name: "matchW", params: ["x"], body: { match: [{ var: "x" }, "_", 0] } },
  {
    name: "matchCtor",
    params: ["x"],
    body: { match: [{ var: "x" }, { $tag: "Just", value: { var: "v" } }, { var: "v" }, "_", 0] },
  },
  { name: "consNamed", params: [], body: { construct: ["Just", { value: 5 }] } },
  { name: "consPos", params: [], body: { construct: ["Just", 5] } },
  { name: "lambda", params: [], body: { fn: [["x"], { "+": [{ var: "x" }, 1] }] } },
  {
    name: "lambdaLet",
    params: [],
    body: { fn: [["x"], { do: [{ let: { y: { var: "x" } } }, { "+": [{ var: "y" }, 1] }] }] },
  },
  {
    name: "effectUnderDo",
    params: ["a"],
    body: { do: [{ call: ["$effect:HasStateIO:set", "k", { var: "a" }] }, { var: "a" }] },
  },
];

const PINNED = FIXTURE as Record<string, unknown>;

describe("expr-substrate 4c — CeExpr reconstitution corpus (live path ≡ pinned fixtures)", () => {
  for (const b of CORPUS) {
    it(`${b.name}: reconstituted CeExpr matches the pinned tree`, () => {
      const newB = newClosures(b);
      expect(newB).not.toHaveProperty("$err");
      expect(newB).toEqual(PINNED[b.name]);
    });
  }

  // Probe 5 — genuine inline applied single-param lambda via `$`. The retired
  // OLD cascade left it a `CeCall "$"`; the live path CANONICALISES it to CeLet
  // (semantically identical under strict eval — brief decision 4 bullet 2). The
  // pinned tree records the CeLet shape.
  it("genuine applied-$ inline lambda canonicalises to CeLet (pinned)", () => {
    const newB = newClosures({
      name: "genuineDollar",
      params: [],
      body: { call: ["$", { fn: [["x"], { var: "x" }] }, 5] },
    }) as { $tag: string };
    expect(newB.$tag).toBe("CeLet");
    expect(newB).toEqual(PINNED["genuineDollar"]);
  });

  // Real `f $ x` (var in fn-position) does NOT peel — stays a CeCall.
  it("real `f $ x` (var fn-position) stays CeCall (pinned)", () => {
    const newB = newClosures({
      name: "realDollar",
      params: ["f", "x"],
      body: { call: ["$", { var: "f" }, { var: "x" }] },
    }) as { $tag: string };
    expect(newB.$tag).toBe("CeCall");
    expect(newB).toEqual(PINNED["realDollar"]);
  });
});
