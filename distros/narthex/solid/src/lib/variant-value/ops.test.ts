import { describe, expect, test } from "bun:test";
import { Bool, Int, Str, List, Maybe, Result, Nothing } from "@fenel/engine/type-foundation";
import { defaultValueFor, setCase } from "./ops";

describe("value editor defaults preserve runtime representations", () => {
  test("opaque primitives and collections have canonical native defaults", () => {
    expect(defaultValueFor(Bool)).toBe(false);
    expect(defaultValueFor(Int)).toBe(0);
    expect(defaultValueFor(Str)).toBe("");
    expect(defaultValueFor(List(Int))).toEqual([]);
    expect(defaultValueFor(Maybe(Int))).toEqual(Nothing);
    expect(defaultValueFor(Result(Str, Int))).toEqual({ $tag: "Ok", _0: 0 });
  });
  test("nested collections retain their own runtime representation", () => {
    expect(defaultValueFor({ $tuple: [Bool, List(Int), Maybe(Int)] })).toEqual([false, [], Nothing]);
  });
  test("case mutation resolves a nested ADT rather than the outer root", () => {
    const type = { $record: { fields: [{ name: "choice", type: { $variant: { cases: [{ name: "A", label: Nothing }, { name: "B", label: Nothing }] } }, label: Nothing, ui: Nothing, meta: {} }] } };
    expect(setCase({ choice: { $tag: "A" }, sibling: 5 }, type, ["choice"], "B")).toEqual({ choice: { $tag: "B" }, sibling: 5 });
  });
  test("custom discriminator keys survive defaults and case switches", () => {
    const type = { $variant: { discriminator: "kind", cases: [{ name: "Text", label: Nothing }, { name: "Number", label: Nothing }] } };
    expect(defaultValueFor(type)).toEqual({ kind: "Text" });
    expect(setCase({ kind: "Text" }, type, [], "Number")).toEqual({ kind: "Number" });
  });
});
