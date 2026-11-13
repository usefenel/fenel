import { describe, it, expect } from "vitest";
import { stdNatives, stdModule } from "./std";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
const { head, tail, last, init, length, at } = stdNatives;

// map / filter / fold / find dispatch a Fenel callable per element, so they
// can't be invoked as plain JS functions — exercise them through the
// evaluator with `fn` lambdas (the same path real call sites use).
const _registry = createRegistry([stdModule]);
const _ctx = _registry.evaluateContext();
const evalCall = (op: string, ...args: unknown[]) =>
  evaluate({ call: [op, ...args] }, {}, _ctx);

// ---------------------------------------------------------------------------
// Array baseline — regression coverage for existing behavior
// ---------------------------------------------------------------------------

// head/tail/last/init are all declared `returns: Maybe a` — Fenel has no
// null, so absence is `{$tag: "Nothing"}` and a present value is wrapped
// in `{$tag: "Just", _0: x}`. Asserting against bare values / JS null
// would be a category error (testing JS shapes against Fenel return types).
describe("head/tail/last/init on arrays", () => {
  it("head non-empty", () => expect(head!([1, 2, 3])).toEqual({ $tag: "Just", _0: 1 }));
  it("head empty", () => expect(head!([])).toEqual({ $tag: "Nothing" }));
  it("tail non-empty", () =>
    expect(tail!([1, 2, 3])).toEqual({ $tag: "Just", _0: [2, 3] }));
  it("tail singleton", () =>
    expect(tail!([1])).toEqual({ $tag: "Just", _0: [] }));
  it("tail empty", () => expect(tail!([])).toEqual({ $tag: "Nothing" }));
  it("last non-empty", () => expect(last!([1, 2, 3])).toEqual({ $tag: "Just", _0: 3 }));
  it("last empty", () => expect(last!([])).toEqual({ $tag: "Nothing" }));
  it("init non-empty", () =>
    expect(init!([1, 2, 3])).toEqual({ $tag: "Just", _0: [1, 2] }));
  it("init singleton", () =>
    expect(init!([1])).toEqual({ $tag: "Just", _0: [] }));
  it("init empty", () => expect(init!([])).toEqual({ $tag: "Nothing" }));
});

describe("length on arrays", () => {
  it("[1,2,3]", () => expect(length!([1, 2, 3])).toBe(3));
  it("[]", () => expect(length!([])).toBe(0));
});

describe("at on arrays uses the raw partial ABI", () => {
  it("returns the raw element for an in-range index", () => {
    expect(at!([{ value: 1 }, { value: 2 }], 1)).toEqual({ value: 2 });
  });

  it("counts negative indices from the end", () => {
    expect(at!(["first", "last"], -1)).toBe("last");
  });

  it("returns the runtime null sentinel when out of range", () => {
    expect(at!([1, 2], 2)).toBeNull();
    expect(at!([1, 2], -3)).toBeNull();
  });
});

describe("map/filter/fold on arrays (via evaluator, fn-first)", () => {
  it("map doubles", () =>
    expect(
      evalCall("map", { fn: [["x"], { "*": [{ var: "x" }, 2] }] }, [1, 2, 3]),
    ).toEqual([2, 4, 6]));
  it("filter evens", () =>
    expect(
      evalCall("filter", { fn: [["x"], { "==": [{ "%": [{ var: "x" }, 2] }, 0] }] }, [1, 2, 3, 4]),
    ).toEqual([2, 4]));
  it("fold sum", () =>
    expect(
      evalCall("fold", { fn: [["a", "x"], { "+": [{ var: "a" }, { var: "x" }] }] }, 0, [1, 2, 3]),
    ).toBe(6));
});

// ---------------------------------------------------------------------------
// String as List<Char> — Phase 4 generalization
// ---------------------------------------------------------------------------

describe("head/tail/last/init on strings (String = List<Char>)", () => {
  it("head('abc')", () => expect(head!("abc")).toEqual({ $tag: "Just", _0: "a" }));
  it("head('')", () => expect(head!("")).toEqual({ $tag: "Nothing" }));
  it("tail('abc')", () => expect(tail!("abc")).toEqual({ $tag: "Just", _0: "bc" }));
  it("tail('a')", () => expect(tail!("a")).toEqual({ $tag: "Just", _0: "" }));
  it("tail('')", () => expect(tail!("")).toEqual({ $tag: "Nothing" }));
  it("last('abc')", () => expect(last!("abc")).toEqual({ $tag: "Just", _0: "c" }));
  it("last('')", () => expect(last!("")).toEqual({ $tag: "Nothing" }));
  it("init('abc')", () => expect(init!("abc")).toEqual({ $tag: "Just", _0: "ab" }));
  it("init('a')", () => expect(init!("a")).toEqual({ $tag: "Just", _0: "" }));
  it("init('')", () => expect(init!("")).toEqual({ $tag: "Nothing" }));
});

describe("length on strings (counts code points)", () => {
  it("'abc'", () => expect(length!("abc")).toBe(3));
  it("''", () => expect(length!("")).toBe(0));
});

describe("map/filter/fold on strings preserve string-ness", () => {
  it("map uppercase", () =>
    expect(evalCall("map", "upper", "abc")).toBe("ABC"));

  it("filter remove vowels", () =>
    expect(
      evalCall(
        "filter",
        { fn: [["c"], { "!": [{ in: [{ var: "c" }, ["a", "e", "i", "o", "u"]] }] }] },
        "hello world",
      ),
    ).toBe("hll wrld"));

  it("fold concat", () =>
    expect(
      evalCall("fold", { fn: [["a", "c"], { cat: [{ var: "a" }, { var: "c" }] }] }, "", "abc"),
    ).toBe("abc"));

  it("fold count chars", () =>
    expect(
      evalCall("fold", { fn: [["a", "_c"], { "+": [{ var: "a" }, 1] }] }, 0, "hello"),
    ).toBe(5));
});

// ---------------------------------------------------------------------------
// Unicode correctness — code points, not UTF-16 units
// ---------------------------------------------------------------------------

describe("Unicode (code-point) handling", () => {
  it("head('👨abc') is the full emoji", () => {
    expect(head!("👨abc")).toEqual({ $tag: "Just", _0: "👨" });
  });

  it("tail('👨abc') skips the whole code point", () => {
    expect(tail!("👨abc")).toEqual({ $tag: "Just", _0: "abc" });
  });

  it("last('abc👨') is the emoji", () => {
    expect(last!("abc👨")).toEqual({ $tag: "Just", _0: "👨" });
  });

  it("init('abc👨') drops the emoji", () => {
    expect(init!("abc👨")).toEqual({ $tag: "Just", _0: "abc" });
  });

  it("length('👨abc') counts emoji as 1", () => {
    expect(length!("👨abc")).toBe(4);
  });

  it("map preserves multi-byte code points", () => {
    expect(evalCall("map", "id", "👨abc")).toBe("👨abc");
  });

  it("fold sees emoji as a single element", () => {
    // Fold concatenates each code point — order preserved, multi-byte intact.
    expect(
      evalCall("fold", { fn: [["a", "c"], { cat: [{ var: "a" }, { var: "c" }] }] }, "", "👨ab"),
    ).toBe("👨ab");
  });
});

// ---------------------------------------------------------------------------
// find — Maybe-returning, fn-first
// ---------------------------------------------------------------------------

describe("find returns Maybe", () => {
  it("found", () =>
    expect(
      evalCall("find", { fn: [["x"], { ">": [{ var: "x" }, 1] }] }, [1, 2, 3]),
    ).toEqual({ $tag: "Just", _0: 2 }));
  it("not found", () =>
    expect(
      evalCall("find", { fn: [["x"], { ">": [{ var: "x" }, 99] }] }, [1, 2, 3]),
    ).toEqual({ $tag: "Nothing" }));
});
