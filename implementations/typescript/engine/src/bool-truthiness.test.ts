// bool-truthiness.test.ts — the Fenel Bool value `{$tag:"False"}` (the pure
// ADT representation of `Bool = True | False`) must read as FALSE wherever a
// condition or a predicate result is consumed, exactly like the JS-boolean
// carrier `false`. Before the 2026-10-17 repair every such site used JS object
// truthiness, so `{$tag:"False"}` took the TRUE branch.
//
// Each caller keeps its OWN non-Bool fallback (they deliberately differ):
//   - evaluator `truthy` (if / and / or / match guard / filter / all / some /
//     none ops): null, undefined, false, 0, "", "0" and [] are falsy;
//   - std natives (`truthy`, `and`, `or`, `filter`, `find`, `findIndex`,
//     `all`, `some`, `none`, `partition`, `takeWhile`, `dropWhile`) and the
//     `!` / `!!` operator natives: plain JS truthiness ("0" and [] are truthy).

import { describe, expect, test } from "bun:test";
import { evaluate, truthy } from "./json-logic";
import { boolValueOf } from "./maybe-value";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";

const T = { $tag: "True" };
const F = { $tag: "False" };

describe("boolValueOf — the shared Bool recognizer", () => {
  test("recognizes both representations", () => {
    expect(boolValueOf(true)).toBe(true);
    expect(boolValueOf(false)).toBe(false);
    expect(boolValueOf(T)).toBe(true);
    expect(boolValueOf(F)).toBe(false);
  });
  test("answers undefined for every non-Bool", () => {
    for (const v of [null, undefined, 0, 1, "", "0", "False", [], {}, { $tag: "Nothing" }, [F]]) {
      expect(boolValueOf(v)).toBeUndefined();
    }
  });
  test("an inherited or accessor $tag is not a Bool", () => {
    expect(boolValueOf(Object.create(F))).toBeUndefined();
    expect(boolValueOf(Object.defineProperty({}, "$tag", { get: () => "False", enumerable: true }))).toBeUndefined();
  });
  for (const inherited of ["True", "False"]) test(`an inherited descriptor ${inherited} cannot admit an accessor Bool`, () => {
    let getterReads = 0;
    const accessor = Object.defineProperty({}, "$tag", {
      enumerable: true, get() { getterReads++; return "not-a-Bool"; },
    });
    const reason = new Error("descriptor trap refused");
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw reason; } });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const pollution = Object.assign(Object.create(null), { value: inherited, configurable: true, writable: true });
    let recognized: boolean | undefined, fallback: boolean | undefined, thrown: unknown;
    Object.defineProperty(Object.prototype, "value", pollution);
    try {
      recognized = boolValueOf(accessor);
      fallback = truthy(accessor);
      try { boolValueOf(proxy); } catch (error) { thrown = error; }
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
    }
    expect(getterReads).toBe(0);
    expect(recognized).toBeUndefined();
    expect(fallback).toBe(true);
    expect(thrown).toBe(reason);
  });
});

describe("evaluator truthiness", () => {
  test("truthy reads {$tag:False} as false and {$tag:True} as true", () => {
    expect(truthy(F)).toBe(false);
    expect(truthy(T)).toBe(true);
  });
  test("if takes the else branch on {$tag:False}", () => {
    expect(evaluate({ if: [{ var: "b" }, "then", "else"] }, { b: F })).toBe("else");
    expect(evaluate({ if: [{ var: "b" }, "then", "else"] }, { b: T })).toBe("then");
  });
  test("and / or short-circuit on {$tag:False}", () => {
    expect(evaluate({ and: [{ var: "b" }, "rhs"] }, { b: F })).toEqual(F);
    expect(evaluate({ or: [{ var: "b" }, "rhs"] }, { b: F })).toBe("rhs");
    expect(evaluate({ and: [{ var: "b" }, "rhs"] }, { b: T })).toBe("rhs");
    expect(evaluate({ or: [{ var: "b" }, "rhs"] }, { b: T })).toEqual(T);
  });
  test("filter / all / some / none ops read a {$tag:False} predicate result as false", () => {
    const data = { xs: [1, 2], b: F };
    expect(evaluate({ filter: [{ var: "xs" }, { var: "b" }] }, data)).toEqual([]);
    expect(evaluate({ all: [{ var: "xs" }, { var: "b" }] }, data)).toBe(false);
    expect(evaluate({ some: [{ var: "xs" }, { var: "b" }] }, data)).toBe(false);
    expect(evaluate({ none: [{ var: "xs" }, { var: "b" }] }, data)).toBe(true);
  });
  test("non-Bool fallback unchanged: \"0\", [], null, 0, \"\" falsy; other values truthy", () => {
    for (const v of ["0", [], null, undefined, 0, ""]) {
      expect(truthy(v)).toBe(false);
      expect(evaluate({ if: [{ var: "b" }, "then", "else"] }, { b: v })).toBe("else");
    }
    for (const v of ["a", 1, -1, [0], {}, { $tag: "Nothing" }]) {
      expect(truthy(v)).toBe(true);
      expect(evaluate({ if: [{ var: "b" }, "then", "else"] }, { b: v })).toBe("then");
    }
  });
});

describe("operator natives ! and !!", () => {
  test("Bool values", () => {
    expect(evaluate({ "!": [{ var: "b" }] }, { b: F })).toBe(true);
    expect(evaluate({ "!": [{ var: "b" }] }, { b: T })).toBe(false);
    expect(evaluate({ "!!": [{ var: "b" }] }, { b: F })).toBe(false);
    expect(evaluate({ "!!": [{ var: "b" }] }, { b: T })).toBe(true);
  });
  test("non-Bool fallback stays JS truthiness", () => {
    expect(evaluate({ "!!": [{ var: "b" }] }, { b: "0" })).toBe(true);
    expect(evaluate({ "!!": [{ var: "b" }] }, { b: [] })).toBe(true);
    expect(evaluate({ "!": [{ var: "b" }] }, { b: null })).toBe(true);
    expect(evaluate({ "!": [{ var: "b" }] }, { b: 0 })).toBe(true);
  });
});

describe("std natives", () => {
  // `\x -> x`: the predicate's result is the element itself.
  const id = evaluate({ fn: ["x", { var: "x" }] });
  const ctx = {};
  const call = (name: string, ...args: unknown[]) => stdNativesCtx[name]!(ctx, ...args);

  test("truthy / and / or recognize Bool values", () => {
    expect(stdNatives.truthy!(F)).toBe(false);
    expect(stdNatives.truthy!(T)).toBe(true);
    expect(stdNatives.and!(T, F)).toBe(false);
    expect(stdNatives.and!(F, T)).toBe(false);
    expect(stdNatives.and!(T, T)).toBe(true);
    expect(stdNatives.or!(F, F)).toBe(false);
    expect(stdNatives.or!(F, T)).toBe(true);
  });
  test("truthy / and / or keep JS truthiness for non-Bool values", () => {
    expect(stdNatives.truthy!("0")).toBe(true);
    expect(stdNatives.truthy!([])).toBe(true);
    expect(stdNatives.truthy!(null)).toBe(false);
    expect(stdNatives.truthy!(0)).toBe(false);
    expect(stdNatives.and!("0", [])).toBe(true);
    expect(stdNatives.or!(0, null)).toBe(false);
  });

  test("predicate HOFs read a False callback result as false", () => {
    const xs = [T, F, T];
    expect(call("filter", id, xs)).toEqual([T, T]);
    expect(call("find", id, [F, T])).toEqual({ $tag: "Just", _0: T });
    expect(call("find", id, [F])).toEqual({ $tag: "Nothing" });
    expect(call("findIndex", id, [F, T])).toBe(1);
    expect(call("all", xs, id)).toBe(false);
    expect(call("some", [F, F], id)).toBe(false);
    expect(call("none", [F, F], id)).toBe(true);
    expect(call("partition", id, xs)).toEqual([[T, T], [F]]);
    expect(call("takeWhile", id, [T, F, T])).toEqual([T]);
    expect(call("dropWhile", id, [T, F, T])).toEqual([F, T]);
  });

  test("predicate HOFs keep JS truthiness for non-Bool callback results", () => {
    const xs = ["0", [], null, 0, 1, ""];
    expect(call("filter", id, xs)).toEqual(["0", [], 1]);
    expect(call("find", id, [null, 0, "0"])).toEqual({ $tag: "Just", _0: "0" });
    expect(call("findIndex", id, [null, []])).toBe(1);
    expect(call("all", ["0", []], id)).toBe(true);
    expect(call("some", [null, 0, ""], id)).toBe(false);
    expect(call("none", [null, 0, ""], id)).toBe(true);
    expect(call("partition", id, ["0", 0])).toEqual([["0"], [0]]);
    expect(call("takeWhile", id, ["0", [], 0, 1])).toEqual(["0", []]);
    expect(call("dropWhile", id, ["0", 0, 1])).toEqual([0, 1]);
  });
});
