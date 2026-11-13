// ---------------------------------------------------------------------------
// partial-evaluator-substrate — the CONSERVATIVE repair (Rom 2026-10-16).
//
// Plan: workstreams/partial-evaluator-substrate/notes/
// 2026-10-16-callback-fold-admission-plan.md § "Conservative repair", with the
// Astra round-3 amendments. The PE output is the input program with only safe
// constant folds filled in:
//   * folds only the 13 first-order std natives of `peSafeFoldIds`, on
//     concrete scalar/array arguments, and only with no caller frame or the
//     EXACT harness frame (no folds at all under extraFns);
//   * substitutes only scalar knowns (number / string / boolean) and binds the
//     rest of their uses with an outermost `let` wrapper (roots compared);
//   * prunes `if` on a concrete condition only; `and` / `or` stay residual;
//   * keeps `let` frames, `$dyn` heads, matches, constructors, records and
//     lambdas as written;
//   * `peEval` runs in its own where-proof frame.
// Every soundness row compares against ORDINARY evaluation in the same frame.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  dispatchedExprToJsonLogic,
  dispatchedPartialEvalDetailed,
  dispatchedPartialEvalInCtx,
  dispatchedDataExpressionValue,
  harnessForTests,
} from "./engine-bodies-dispatch";
import {
  beginWhereProofFrame,
  endWhereProofFrame,
  evaluate,
  readerSourceMetadataEvaluateContext,
  type EvaluateContext,
} from "./json-logic";
import { eagerEvalNative, jitEvalNative } from "./modules/evaluator-strategies";
import { peEvalNative } from "../../../../fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi";
import type { FenelFunction } from "./types";
import { Nothing } from "./type-foundation";

const h = harnessForTests().ctx;

type PE = { $tag: "Concrete"; value: unknown } | { $tag: "Residual"; expr: unknown };

/** Residual JSON-Logic of a detailed (oracle-surface) result. */
function detailedJl(r: PE): unknown {
  if (r.$tag === "Concrete") return undefined;
  const e = r.expr as { $tag?: unknown } | null;
  return e !== null && typeof e === "object" && typeof e.$tag === "string" && String(e.$tag).startsWith("E")
    ? dispatchedExprToJsonLogic(e)
    : e;
}

/** Value of a PE result re-evaluated under `data` in `frame` (a concrete result is its value). */
function reevaluate(r: PE, data: Record<string, unknown>, frame: EvaluateContext, inCtx: boolean): unknown {
  if (r.$tag === "Concrete") return r.value;
  return evaluate(inCtx ? r.expr : detailedJl(r), data, frame);
}

function inProof<T>(f: () => T): { tripped: boolean; value?: T; threw: boolean } {
  const frame = beginWhereProofFrame();
  try {
    const value = f();
    return { tripped: frame.tripped, value, threw: false };
  } catch {
    return { tripped: frame.tripped, threw: true };
  } finally {
    endWhereProofFrame(frame);
  }
}

const override = (): number => 1000;
const callerAdd: EvaluateContext = {
  ...h,
  natives: Object.assign(Object.create(null), h.natives, { add: override, "std:add": override }),
};
const callerAbs: EvaluateContext = {
  ...h,
  natives: Object.assign(Object.create(null), h.natives, { abs: override, "std:abs": override }),
};

describe("conservative PE — no fold under a caller frame other than the harness", () => {
  test("a caller native override of add is not folded (direct call)", () => {
    const prog = { call: ["add", 1, 2] };
    expect(evaluate(prog, {}, callerAdd)).toBe(1000);
    const r = dispatchedPartialEvalInCtx(prog, {}, 8, callerAdd);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, {}, callerAdd, true)).toBe(1000);
  }, 60_000);

  test("a caller native override of add is not folded inside a map callback", () => {
    const prog = { call: ["map", { fn: ["x", { call: ["add", { var: "x" }, 1] }] }, [1]] };
    expect(evaluate(prog, {}, callerAdd)).toEqual([1000]);
    const r = dispatchedPartialEvalInCtx(prog, {}, 8, callerAdd);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, {}, callerAdd, true)).toEqual([1000]);
  }, 60_000);

  test("a callback name computed through concat/slice is not folded", () => {
    const computed = { call: ["slice", { call: ["concat", "ab", "s!"] }, 0, 3] };
    const prog = { call: ["map", { fn: ["x", { call: ["map", computed, [{ var: "x" }]] }] }, [-1]] };
    const ordinary = evaluate(prog, {}, callerAbs);
    const r = dispatchedPartialEvalInCtx(prog, {}, 8, callerAbs);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, {}, callerAbs, true)).toEqual(ordinary);
  }, 60_000);

  test("evalApply on known code data is never folded (string route)", () => {
    const prog = { call: ["evalApply", "eagerEval", { var: "e" }] };
    const known = { e: { call: ["add", 1, 2] } };
    const ordinary = evaluate(prog, known, callerAdd);
    const r = dispatchedPartialEvalInCtx(prog, known, 8, callerAdd);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, known, callerAdd, true)).toEqual(ordinary);
  }, 60_000);

  test("a reader packet frame derived from the harness gets no folds (exact identity only)", () => {
    const packet = Object.freeze({ $tag: "ReaderSourceMetadata", generation: "A" });
    const packetFrame = readerSourceMetadataEvaluateContext(h, packet);
    expect(packetFrame).not.toBe(h);
    const r = dispatchedPartialEvalInCtx({ call: ["add", 1, 2] }, {}, 8, packetFrame);
    expect(r).toEqual({ $tag: "Residual", expr: { call: ["add", 1, 2] } });
    const overridden = readerSourceMetadataEvaluateContext(callerAdd, packet);
    const o = dispatchedPartialEvalInCtx({ call: ["add", 1, 2] }, {}, 8, overridden);
    expect(evaluate({ call: ["add", 1, 2] }, {}, overridden)).toBe(1000);
    expect(reevaluate(o, {}, overridden, true)).toBe(1000);
  }, 60_000);

  test("zero caller-native executions during PE for a callback and a direct call", () => {
    let effects = 0;
    const eff = { id: "probe:eff", params: [{ name: "u" }], requires: [{ class: "Log" }] };
    const frame: EvaluateContext = {
      ...h,
      nativesCtx: Object.assign(Object.create(null), h.nativesCtx, {
        "probe:eff": (_c: unknown, u: unknown) => { effects++; return u; },
      }),
      getFunction: (n: string) => (n === "probe:eff" ? eff : h.getFunction?.(n)) as never,
    };
    for (const prog of [
      { call: ["map", { fn: ["x", { call: ["probe:eff", { var: "x" }] }] }, [1]] },
      { call: ["probe:eff", 1] },
    ]) {
      const ordinary = evaluate(prog, {}, frame);
      const before = effects;
      const r = dispatchedPartialEvalInCtx(prog, {}, 8, frame);
      expect(effects - before).toBe(0);
      expect(reevaluate(r, {}, frame, true)).toEqual(ordinary);
    }
  }, 60_000);
});

describe("conservative PE — extraFns disable folding (alternate entry)", () => {
  test("extraFns supplied ⇒ no fold, even of a safe-list call", () => {
    const f: FenelFunction = {
      id: "t:f",
      params: [{ name: "x", label: Nothing, type: { $ref: "Any" }, meta: {}, ui: Nothing }],
      returns: { $ref: "Any" },
      body: { "+": [{ var: "x" }, 1] },
    };
    const r = dispatchedPartialEvalDetailed({ call: ["add", 1, 2] }, {}, 8, [f]);
    expect(r.$tag).toBe("Residual");
    const ctx = { ...h, getFunction: (n: string) => (n === "t:f" ? f : h.getFunction?.(n)) as never };
    expect(reevaluate(r, {}, ctx, false)).toBe(3);
    const call = dispatchedPartialEvalDetailed({ call: ["t:f", 10] }, {}, 8, [f]);
    expect(call.$tag).toBe("Residual");
    expect(reevaluate(call, {}, ctx, false)).toBe(11);
  }, 60_000);
});

describe("conservative PE — values that could execute, and sharing", () => {
  test("a known {call:…} record is never written into code", () => {
    const known = { e: { call: ["add", 1, 2] } };
    const prog = [{ var: "e" }, { var: "y" }];
    const ordinary = evaluate(prog, { ...known, y: 5 }, h);
    expect(ordinary).toEqual([{ call: ["add", 1, 2] }, 5]);
    const r = dispatchedPartialEvalDetailed(prog, known);
    expect(reevaluate(r, { ...known, y: 5 }, h, false)).toEqual(ordinary);
  }, 60_000);

  test("known arrays are not substituted: identity seen by includes is preserved", () => {
    const arr = [1];
    const known = { x: arr, xs: [arr] };
    const prog = { call: ["includes", { var: "xs" }, { var: "x" }] };
    const ordinary = evaluate(prog, known, h);
    expect(ordinary).toBe(true);
    const r = dispatchedPartialEvalDetailed(prog, known);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, known, h, false)).toBe(true);
  }, 60_000);
});

describe("conservative PE — known scalars: substitution and the root-keyed wrapper", () => {
  test("known s = \"abc\": the dotted read s.length is bound by the wrapper (ctx2 only)", () => {
    const prog = { "+": [{ var: "s.length" }, { var: "y" }] };
    const ordinary = evaluate(prog, { s: "abc", y: 1 }, h);
    expect(ordinary).toBe(4);
    const r = dispatchedPartialEvalDetailed(prog, { s: "abc" });
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, { y: 1 }, h, false)).toBe(4);
  }, 60_000);

  test("known s = \"abc\": a lone s.length re-evaluates to 3", () => {
    const r = dispatchedPartialEvalDetailed({ var: "s.length" }, { s: "abc" });
    expect(reevaluate(r, {}, h, false)).toBe(3);
  }, 60_000);

  test("known f = \"add\": a $dyn call is bound by the wrapper (ctx2 only)", () => {
    const prog = { call: [{ var: "f" }, 1, 2] };
    expect(evaluate(prog, { f: "add" }, h)).toBe(3);
    const r = dispatchedPartialEvalDetailed(prog, { f: "add" });
    expect(reevaluate(r, {}, h, false)).toBe(3);
    const withY = { call: [{ var: "f" }, { var: "y" }, 2] };
    const ry = dispatchedPartialEvalDetailed(withY, { f: "add" });
    expect(reevaluate(ry, { y: 5 }, h, false)).toBe(7);
  }, 60_000);

  test("a known captured by a lambda is bound by the wrapper (ctx2 only), budgets 0 and 8", () => {
    const prog = { call: ["map", { fn: ["x", { "+": [{ var: "x" }, { var: "k" }] }] }, { var: "arr" }] };
    for (const budget of [0, 8]) {
      const r = dispatchedPartialEvalDetailed(prog, { k: 5 }, budget);
      expect(reevaluate(r, { arr: [1] }, h, false)).toEqual([6]);
    }
  }, 60_000);

  test("wrapper shadowing: inner binders of the known name keep their own value", () => {
    const prog = [
      { call: ["map", { fn: ["x", { var: "x" }] }, [7]] },
      { call: ["$", { fn: ["x", { "+": [{ var: "x" }, 1] }] }, 41] },
      { var: "x" },
      { var: "y" },
    ];
    const ordinary = evaluate(prog, { x: 1, y: 2 }, h);
    const r = dispatchedPartialEvalDetailed(prog, { x: 1 });
    expect(reevaluate(r, { y: 2 }, h, false)).toEqual(ordinary);
  }, 60_000);

  test("two knowns: wrapper order is irrelevant and both are bound", () => {
    const prog = { call: ["map", { fn: ["x", { "+": [{ var: "a" }, { var: "b" }] }] }, { var: "arr" }] };
    const r = dispatchedPartialEvalDetailed(prog, { a: 1, b: 10 });
    expect(reevaluate(r, { arr: [0, 0] }, h, false)).toEqual([11, 11]);
  }, 60_000);

  test("a non-quotable known record stays a read (needs ctx1 ∪ ctx2)", () => {
    const prog = { "+": [{ var: "user.age" }, { var: "y" }] };
    const known = { user: { age: 29 } };
    const r = dispatchedPartialEvalDetailed(prog, known);
    expect(r.$tag).toBe("Residual");
    expect(reevaluate(r, { ...known, y: 1 }, h, false)).toBe(30);
  }, 60_000);
});

describe("conservative PE — and / or are never reduced", () => {
  test("or returns the operand value, not a Boolean", () => {
    const prog = { or: [{ var: "x" }, true] };
    const r = dispatchedPartialEvalDetailed(prog);
    expect(reevaluate(r, { x: "hello" }, h, false)).toBe("hello");
  }, 60_000);

  test("and [5, 6] is 6 and or [false, 0] is 0", () => {
    expect(reevaluate(dispatchedPartialEvalDetailed({ and: [5, 6] }), {}, h, false)).toBe(6);
    expect(reevaluate(dispatchedPartialEvalDetailed({ or: [false, 0] }), {}, h, false)).toBe(0);
  }, 60_000);

  test("or missing true keeps the read an enclosing proof sees", () => {
    const prog = { or: [{ var: "missing" }, true] };
    const ordinary = inProof(() => evaluate(prog, {}, h));
    expect(ordinary.tripped).toBe(true);
    const r = dispatchedPartialEvalDetailed(prog);
    const after = inProof(() => reevaluate(r, {}, h, false));
    expect(after.tripped).toBe(ordinary.tripped);
  }, 60_000);
});

describe("conservative PE — reads and effects are kept", () => {
  test("let unused = missing in true keeps the read (proof frame)", () => {
    const prog = { call: ["$", { fn: ["unused", true] }, { var: "missing" }] };
    const ordinary = inProof(() => evaluate(prog, {}, h));
    expect(ordinary.tripped).toBe(true);
    const r = dispatchedPartialEvalDetailed(prog);
    expect(r.$tag).toBe("Residual");
    const after = inProof(() => reevaluate(r, {}, h, false));
    expect(after.tripped).toBe(true);
  }, 60_000);

  test("a let value with an effect runs exactly once, used 0, 1 or 2 times", () => {
    let count = 0;
    const next = { id: "probe:next", params: [{ name: "u" }], requires: [{ class: "Log" }] };
    const frame: EvaluateContext = {
      ...h,
      nativesCtx: Object.assign(Object.create(null), h.nativesCtx, {
        "probe:next": () => { count++; return count; },
      }),
      getFunction: (n: string) => (n === "probe:next" ? next : h.getFunction?.(n)) as never,
    };
    const bodies = [5, { var: "v" }, [{ var: "v" }, { var: "v" }]];
    for (const body of bodies) {
      const prog = { call: ["$", { fn: ["v", body] }, { call: ["probe:next", 0] }] };
      count = 0;
      evaluate(prog, {}, frame);
      const ordinaryCount = count;
      expect(ordinaryCount).toBe(1);
      const r = dispatchedPartialEvalInCtx(prog, {}, 8, frame);
      count = 0;
      reevaluate(r, {}, frame, true);
      expect(count).toBe(ordinaryCount);
    }
  }, 60_000);

  test("peEval runs in its own proof frame: a failing fold never trips an enclosing proof", () => {
    const outer = inProof(() => peEvalNative(h, { var: "missing" }) as { $tag: string });
    expect(outer.threw).toBe(false);
    expect((outer.value as { $tag: string }).$tag).toBe("Err");
    expect(outer.tripped).toBe(false);
  }, 60_000);

  test("budgets 0, 1 and 8 give identical outputs", () => {
    const progs = [
      { call: ["$", { fn: ["v", { "+": [{ var: "v" }, 1] }] }, { var: "y" }] },
      { if: [{ var: "p" }, { "+": [1, 2] }, { var: "q" }] },
      { call: ["map", { fn: ["x", { "*": [{ var: "x" }, 2] }] }, [1, 2]] },
    ];
    for (const prog of progs) {
      const outs = [0, 1, 8].map((b) => JSON.stringify(dispatchedPartialEvalDetailed(prog, {}, b)));
      expect(outs[1]).toBe(outs[0]);
      expect(outs[2]).toBe(outs[0]);
    }
  }, 60_000);
});

describe("conservative PE — positive controls", () => {
  test("add 10 20 folds to 30 with no caller and under the exact harness frame", () => {
    expect(dispatchedPartialEvalDetailed({ add: [10, 20] })).toEqual({ $tag: "Concrete", value: 30 });
    expect(dispatchedPartialEvalInCtx({ add: [10, 20] }, {}, 8, h)).toEqual({ $tag: "Concrete", value: 30 });
    expect(dispatchedPartialEvalInCtx({ add: [10, 20] }, {}, 8, undefined)).toEqual({ $tag: "Concrete", value: 30 });
  }, 60_000);

  test("nested arithmetic, concat and a known scalar fold", () => {
    expect(dispatchedPartialEvalDetailed({ "*": [{ "+": [1, 2] }, 4] })).toEqual({ $tag: "Concrete", value: 12 });
    expect(dispatchedPartialEvalDetailed({ cat: ["a", "b"] })).toEqual({ $tag: "Concrete", value: "ab" });
    expect(dispatchedPartialEvalDetailed({ "+": [{ var: "x" }, 1] }, { x: 5 })).toEqual({ $tag: "Concrete", value: 6 });
  }, 60_000);

  test("written-constant if pruning", () => {
    const r = dispatchedPartialEvalDetailed({ if: [true, { var: "a" }, { var: "b" }] });
    expect(detailedJl(r)).toEqual({ var: "a" });
    const f = dispatchedPartialEvalDetailed({ if: [false, { var: "a" }, { var: "b" }] });
    expect(detailedJl(f)).toEqual({ var: "b" });
  }, 60_000);

  test("-0, NaN and ±Infinity survive folding and residual egress", () => {
    const negZero = dispatchedPartialEvalDetailed({ "*": [-1, 0] });
    expect(negZero.$tag).toBe("Concrete");
    expect(Object.is((negZero as { value: unknown }).value, -0)).toBe(true);
    const nan = dispatchedPartialEvalDetailed({ "-": [Infinity, Infinity] });
    expect(Number.isNaN((nan as { value: number }).value)).toBe(true);
    const inf = dispatchedPartialEvalDetailed({ "*": [-1, Infinity] });
    expect((inf as { value: number }).value).toBe(-Infinity);
    const residual = dispatchedPartialEvalDetailed([{ "*": [-1, 0] }, { "-": [Infinity, Infinity] }, Infinity, { var: "y" }]);
    expect(residual.$tag).toBe("Residual");
    const back = reevaluate(residual, { y: 1 }, h, false) as unknown[];
    expect(Object.is(back[0], -0)).toBe(true);
    expect(Number.isNaN(back[1] as number)).toBe(true);
    expect(back[2]).toBe(Infinity);
  }, 60_000);
});

describe("conservative PE — JIT never answers a wrong Ok", () => {
  test("div / mod by zero and structural eq answer an honest Err, never a wrong Ok", () => {
    for (const prog of [{ "/": [1, 0] }, { "%": [1, 0] }, { "==": [[1], [1]] }, { "!=": [[1], [1]] }]) {
      const jit = jitEvalNative(prog);
      const eager = eagerEvalNative(prog);
      expect(eager.$tag).toBe("Ok");
      expect(jit.$tag).toBe("Err");
    }
    // Exact cases still run: a nonzero literal divisor, number comparisons.
    expect(jitEvalNative({ "/": [6, 3] })).toEqual({ $tag: "Ok", _0: 2 });
    expect(jitEvalNative({ "==": [2, 2] })).toEqual({ $tag: "Ok", _0: true });
  }, 60_000);

  // Round 5: a caller-supplied knowns record is a caller frame, so the JIT
  // refuses it (see "round 5" below); frame-free arithmetic still runs.
  test("JIT still runs frame-free arithmetic", () => {
    expect(jitEvalNative({ "+": [2, 3] })).toEqual({ $tag: "Ok", _0: 5 });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Astra round 4 (2026-10-16) — fix-round witnesses.
// ---------------------------------------------------------------------------

describe("round 4 — a missing-else if keeps its no-value exit (JSON ingress)", () => {
  for (const prog of [{ if: [false, 1] }, { or: [{ if: [false, 1] }, true] }, { "?:": [{ var: "p" }, 1] }]) {
    test(`${JSON.stringify(prog)}: same proof trip and value as ordinary`, () => {
      const data = { p: false };
      const ordinary = inProof(() => evaluate(prog, data, h));
      expect(ordinary.tripped).toBe(true);
      for (const r of [dispatchedPartialEvalDetailed(prog), dispatchedPartialEvalInCtx(prog, {}, 8, h)]) {
        // detailedJl passes raw JSON-Logic through, so `false` serves both entries.
        const after = inProof(() => reevaluate(r, data, h, false));
        expect(after.tripped).toBe(true);
        expect(reevaluate(r, data, h, false)).toEqual(evaluate(prog, data, h));
      }
    }, 60_000);
  }
});

describe("round 4 — the JIT refuses literals JSON cannot carry", () => {
  test("±Infinity and NaN literals answer Err, never a wrong Ok", () => {
    for (const prog of [
      { "+": [Infinity, 1] },
      { "-": [Infinity, Infinity] },
      { "*": [-Infinity, 2] },
      { a: Infinity, b: { "+": [1, 2] } },
    ]) {
      expect(eagerEvalNative(prog).$tag).toBe("Ok");
      expect(jitEvalNative(prog).$tag).toBe("Err");
    }
  }, 60_000);

  test("signed zero: a -0 literal is refused; a -0 result computed from faithful literals is exact", () => {
    expect(jitEvalNative({ "+": [-0, 0] }).$tag).toBe("Err");
    const product = jitEvalNative({ "*": [-1, 0] });
    expect(product.$tag).toBe("Ok");
    expect(Object.is((product as { _0: unknown })._0, -0)).toBe(true);
    const eager = eagerEvalNative({ "*": [-1, 0] }) as { _0: unknown };
    expect(Object.is(eager._0, -0)).toBe(true);
  }, 60_000);
});

describe("round 4 — the JIT admits concat only at its exact arity and operand kind", () => {
  test("concat with 1 or 3 args answers Err; two string literals run", () => {
    const one = { call: ["concat", "a"] };
    const three = { call: ["concat", "a", "b", "c"] };
    expect(typeof evaluate(one, {}, h)).not.toBe("string");
    expect(jitEvalNative(one).$tag).toBe("Err");
    expect(evaluate(three, {}, h)).toBe("ab");
    expect(jitEvalNative(three).$tag).toBe("Err");
    expect(jitEvalNative({ call: ["concat", [1], [2]] }).$tag).toBe("Err");
    expect(jitEvalNative({ call: ["concat", "a", "b"] })).toEqual({ $tag: "Ok", _0: "ab" });
  }, 60_000);
});

describe("round 4 — the JIT refuses a caller frame whose operators may differ", () => {
  test("a caller native add override: ordinary 1000, JIT Err (never Ok 3)", () => {
    expect(evaluate({ call: ["add", 1, 2] }, {}, callerAdd)).toBe(1000);
    expect(jitEvalNative({ call: ["add", 1, 2] }, callerAdd).$tag).toBe("Err");
    // The frame-free JIT (no caller, or only known inputs and a budget) still runs.
    expect(jitEvalNative({ "+": [1, 2] })).toEqual({ $tag: "Ok", _0: 3 });
    expect(jitEvalNative({ "+": [1, 2] }, h)).toEqual({ $tag: "Ok", _0: 3 });
  }, 60_000);
});

describe("round 4 — guards, data projection and ordered effects", () => {
  test("a scalar known read in a match guard is bound by the wrapper (ctx2 only)", () => {
    const prog = { match: [{ var: "m" }, { $guard: [{ $bind: "v" }, { ">": [{ var: "v" }, { var: "k" }] }] }, "big", "small"] };
    for (const m of [7, 3]) {
      const ordinary = evaluate(prog, { m, k: 5 }, h);
      const r = dispatchedPartialEvalDetailed(prog, { k: 5 });
      expect(r.$tag).toBe("Residual");
      expect(reevaluate(r, { m }, h, false)).toEqual(ordinary);
    }
  }, 60_000);

  test("partialEvaluateData projects data and refuses anything that computes", () => {
    expect(dispatchedDataExpressionValue({ first: [1, 2], second: "x" }, h))
      .toEqual({ $tag: "Concrete", value: { first: [1, 2], second: "x" } });
    for (const prog of [{ first: { "+": [1, 2] }, second: 1 }, { var: "x" }, { call: ["add", 1, 2] }, { first: [{ var: "x" }], second: 2 }]) {
      expect(dispatchedDataExpressionValue(prog, h)).toEqual({ $tag: "Residual", expr: prog });
    }
  }, 60_000);

  test("effects: same returned values AND the same ordered trace as ordinary", () => {
    const trace: unknown[] = [];
    const log = { id: "probe:log", params: [{ name: "u" }], requires: [{ class: "Log" }] };
    const frame: EvaluateContext = {
      ...h,
      nativesCtx: Object.assign(Object.create(null), h.nativesCtx, {
        "probe:log": (_c: unknown, u: unknown) => { trace.push(u); return trace.length; },
      }),
      getFunction: (n: string) => (n === "probe:log" ? log : h.getFunction?.(n)) as never,
    };
    const prog = [
      { call: ["probe:log", "a"] },
      { call: ["$", { fn: ["v", [{ var: "v" }, { call: ["probe:log", "b"] }, { var: "v" }]] }, { call: ["probe:log", "c"] }] },
      { if: [true, { call: ["probe:log", "d"] }, { call: ["probe:log", "e"] }] },
    ];
    trace.length = 0;
    const ordinary = evaluate(prog, {}, frame);
    const ordinaryTrace = [...trace];
    expect(ordinaryTrace).toEqual(["a", "c", "b", "d"]);
    for (const r of [dispatchedPartialEvalInCtx(prog, {}, 8, frame), dispatchedPartialEvalInCtx(prog, {}, 8, h)]) {
      trace.length = 0;
      expect(reevaluate(r, {}, frame, true)).toEqual(ordinary);
      expect(trace).toEqual(ordinaryTrace);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Astra round 5 (2026-10-17) — fix-round witnesses.
// ---------------------------------------------------------------------------

describe("round 5 — the JIT runs only with no caller frame or the exact harness", () => {
  test("a Proxy over {} supplying a natives override: ordinary 1000, JIT Err", () => {
    const natives = Object.assign(Object.create(null), h.natives, { add: override, "std:add": override });
    const proxy = new Proxy({}, { get: (_t, k) => (k === "natives" ? natives : undefined) }) as EvaluateContext;
    expect(Reflect.ownKeys(proxy)).toEqual([]);
    expect(evaluate({ call: ["add", 1, 2] }, {}, proxy)).toBe(1000);
    expect(jitEvalNative({ call: ["add", 1, 2] }, proxy).$tag).toBe("Err");
  }, 60_000);

  test("a caller-supplied knowns record is refused; no caller and the harness still run", () => {
    expect(jitEvalNative({ "+": [{ var: "x" }, 1] }, { _known: { x: 10 } } as EvaluateContext).$tag).toBe("Err");
    expect(jitEvalNative({ "+": [1, 2] }, {} as EvaluateContext).$tag).toBe("Err");
    expect(jitEvalNative({ "+": [1, 2] })).toEqual({ $tag: "Ok", _0: 3 });
    expect(jitEvalNative({ "+": [1, 2] }, h)).toEqual({ $tag: "Ok", _0: 3 });
  }, 60_000);
});

describe("round 5 — a list literal with a folded prefix keeps source order", () => {
  test("[1, log a, log b]: same values and the same ordered trace as ordinary", () => {
    const trace: unknown[] = [];
    const log = { id: "probe:log", params: [{ name: "u" }], requires: [{ class: "Log" }] };
    const frame: EvaluateContext = {
      ...h,
      nativesCtx: Object.assign(Object.create(null), h.nativesCtx, {
        "probe:log": (_c: unknown, u: unknown) => { trace.push(u); return trace.length; },
      }),
      getFunction: (n: string) => (n === "probe:log" ? log : h.getFunction?.(n)) as never,
    };
    for (const prog of [
      [1, { call: ["probe:log", "a"] }, { call: ["probe:log", "b"] }],
      [1, [2, 3], { call: ["probe:log", "a"] }, 4, { call: ["probe:log", "b"] }],
    ]) {
      trace.length = 0;
      const ordinary = evaluate(prog, {}, frame);
      const ordinaryTrace = [...trace];
      for (const r of [dispatchedPartialEvalInCtx(prog, {}, 8, frame), dispatchedPartialEvalInCtx(prog, {}, 8, h)]) {
        trace.length = 0;
        expect(reevaluate(r, {}, frame, true)).toEqual(ordinary);
        expect(trace).toEqual(ordinaryTrace);
      }
    }
  }, 60_000);
});

describe("round 5 — the identity valve keeps scalar knowns", () => {
  test("if p then x (no else), known x = 5: ctx2-only re-evaluation gives 5", () => {
    const prog = { if: [{ var: "p" }, { var: "x" }] };
    expect(evaluate(prog, { p: true, x: 5 }, h)).toBe(5);
    expect(reevaluate(dispatchedPartialEvalDetailed(prog, { x: 5 }), { p: true }, h, false)).toBe(5);
    expect(reevaluate(dispatchedPartialEvalInCtx(prog, { x: 5 }, 8, h), { p: true }, h, true)).toBe(5);
    const proof = inProof(() => reevaluate(dispatchedPartialEvalDetailed(prog, { x: 5 }), { p: false }, h, false));
    expect(proof.tripped).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Astra round 6 (2026-10-17) — identity-valve known wrapper.
// ---------------------------------------------------------------------------

describe("round 6 — the identity-valve known wrapper", () => {
  // A missing-else `if` forces the identity valve (original program + wrapper).
  const valve = (body: unknown) => ({ if: [{ var: "p" }, body] });

  test("an inner binder of a known name keeps its own value", () => {
    const prog = valve({ call: ["$", { fn: ["x", { var: "x" }] }, 9] });
    expect(evaluate(prog, { p: true, x: 5 }, h)).toBe(9);
    expect(reevaluate(dispatchedPartialEvalDetailed(prog, { x: 5 }), { p: true }, h, false)).toBe(9);
  }, 60_000);

  test("two knowns are both bound", () => {
    const prog = valve({ "+": [{ var: "a" }, { var: "b" }] });
    expect(reevaluate(dispatchedPartialEvalDetailed(prog, { a: 1, b: 10 }), { p: true }, h, false)).toBe(11);
  }, 60_000);

  test("reserved-looking known names (call, fn, var, if) are bound as data", () => {
    const prog = valve([{ var: "call" }, { var: "fn" }, { var: "var" }, { var: "if" }]);
    const known = { call: "c", fn: 2, var: true, if: "i" };
    const ordinary = evaluate(prog, { p: true, ...known }, h);
    expect(ordinary).toEqual(["c", 2, true, "i"]);
    expect(reevaluate(dispatchedPartialEvalDetailed(prog, known), { p: true }, h, false)).toEqual(ordinary);
  }, 60_000);

  test("DOCUMENTED LIMIT (pe.residual.known-context): a non-enumerable runtime binding is not seen through the wrapper", () => {
    const prog = { var: ["x", -1] };
    const data = Object.defineProperty({ k: 1 }, "x", { value: 7, enumerable: false });
    expect(evaluate(prog, data, h)).toBe(7);
    const r = dispatchedPartialEvalDetailed(prog, { k: 1 });
    const ctx2 = Object.defineProperty({}, "x", { value: 7, enumerable: false });
    // The wrapper's closure copies the data context by enumerable keys, so the
    // non-enumerable `x` is dropped and the fallback answers. Pinned, not fixed.
    expect(reevaluate(r, ctx2, h, false)).toBe(-1);
  }, 60_000);
});
