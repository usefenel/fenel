// LAUNCH-PLAN row 9 — `engine:functionGraphDomain` (signature.fenel): which
// declared arrows a function card samples, and over which x range. The
// decision is the Fenel body over the sound `subset`; this file only marshals
// (the same seam the reader worker uses) and pins the answers.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { dispatchEngineBodyWithDeciderCtx, marshalTraversalType } from "./engine-bodies-dispatch";

setDefaultTimeout(300_000);

const Num = { $ref: "Number" };
const Str = { $ref: "String" };
const arrow = (params: unknown[], returns: unknown) => ({
  $arrow: { params: params.map((type, index) => ({ name: `p${index}`, key: { $tag: "PositionalField", index }, type })), returns },
});
// The registered `SetExpr` carrier (types.ts `SetExpr`/`Interval`): a tagged
// `SeInterval` whose bounds are `Maybe Bound`. (A bare `$interval` with
// unwrapped bounds is not a recognized set; it marshals as an invalid unknown.)
const bound = (b?: [number, boolean]) => b ? { $tag: "Just", _0: { value: b[0], inclusive: b[1] } } : { $tag: "Nothing" };
const interval = (lo?: [number, boolean], hi?: [number, boolean]) =>
  ({ $refined: { base: Num, set: { $tag: "SeInterval", interval: { lo: bound(lo), hi: bound(hi) } } } });
const domain = (signature: unknown) =>
  dispatchEngineBodyWithDeciderCtx("engine:functionGraphDomain", [marshalTraversalType(signature), marshalTraversalType(Num)]);
const just = (lo: number, hi: number) => ({ $tag: "Just", _0: { lo, hi } });
const NOTHING = { $tag: "Nothing" };

describe("function graph domain", () => {
  test("Number -> Number samples -5..5", () => {
    expect(domain(arrow([Num], Num))).toEqual(just(-5, 5));
  });
  test("an interval refinement of Number samples its bounds, insetting an open end", () => {
    expect(domain(arrow([interval([16, true], [56, true])], Num))).toEqual(just(16, 56));
    expect(domain(arrow([interval([0, false], [10, true])], Num))).toEqual(just(0.1, 10));
    expect(domain(arrow([interval([0, true])], Num))).toEqual(just(0, 10));
  });
  test("a refined Number return is still numeric", () => {
    expect(domain(arrow([Num], interval([0, true], [1, true])))).toEqual(just(-5, 5));
  });
  test("other signatures are not sampled", () => {
    expect(domain(arrow([Str], Num))).toEqual(NOTHING);
    expect(domain(arrow([Num], Str))).toEqual(NOTHING);
    expect(domain(arrow([Num, Num], Num))).toEqual(NOTHING);
    expect(domain(arrow([Num], arrow([Num], Num)))).toEqual(NOTHING);
    expect(domain(arrow([], Num))).toEqual(NOTHING);
    expect(domain(Num)).toEqual(NOTHING);
  });
});
