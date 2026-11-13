import { describe, it, expect } from "vitest";
import {
  structuralHead,
  structuralLength,
  structuralFold,
  structuralView,
  isVariantValue,
  caseTag,
} from "./structural";
// `structuralMap` + `isFoldable` were RETIRED in unified-static-analysis Phase
// 6c (superseded by the derived Functor/Foldable instances — see
// derive-functor.test.ts / derive-foldable.test.ts). Their describe blocks were
// removed here. The fold/head/length triad + structuralView stay (live
// engine-showcase consumer).
import { List, Maybe, Str, Nothing } from "./type-foundation";
import type { FenelType } from "./types";

// ---------------------------------------------------------------------------
// Type fixtures
// ---------------------------------------------------------------------------

/** Binary tree: Tree a = μX. Leaf | Node(value: a, left: X, right: X) */
function Tree(elem: FenelType): FenelType {
  return {
    $mu: {
      var: "X",
      body: {
        $variant: {
          cases: [
            { name: "Leaf", label: Nothing },
            {
              name: "Node",
              label: Nothing,
              fields: [
                { name: "value", label: Nothing, type: elem, meta: {}, ui: Nothing },
                { name: "left", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
                { name: "right", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
              ],
            },
          ],
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// structuralView — classify cases and fields
// ---------------------------------------------------------------------------

describe("structuralView", () => {
  it("classifies Tree<a> Node fields: value=elem, left/right=recursive", () => {
    const view = structuralView(Tree({ $ref: "Int" }));
    expect(view).not.toBeNull();
    const node = view!.cases.find((c) => c.name === "Node");
    expect(node).toBeDefined();
    expect(node!.fields.map((f) => ({ name: f.name, isRecursive: f.isRecursive })))
      .toEqual([
        { name: "value", isRecursive: false },
        { name: "left", isRecursive: true },
        { name: "right", isRecursive: true },
      ]);
  });

  it("classifies List<a> Cons fields: head=elem, tail=recursive", () => {
    const view = structuralView(List({ $ref: "Int" }));
    expect(view).not.toBeNull();
    const cons = view!.cases.find((c) => c.name === "Cons");
    expect(cons!.fields.map((f) => ({ name: f.name, isRecursive: f.isRecursive })))
      .toEqual([
        { name: "head", isRecursive: false },
        { name: "tail", isRecursive: true },
      ]);
  });

  it("classifies Maybe<a> as a non-recursive variant (no $mu)", () => {
    const view = structuralView(Maybe({ $ref: "Int" }));
    expect(view).not.toBeNull();
    expect(view!.cases.map((c) => c.name).sort()).toEqual(["Just", "Nothing"]);
    const just = view!.cases.find((c) => c.name === "Just");
    expect(just!.fields.every((f) => !f.isRecursive)).toBe(true);
  });

  it("sees through Str opaque to List(Char)", () => {
    const view = structuralView(Str);
    expect(view).not.toBeNull();
    expect(view!.cases.map((c) => c.name).sort()).toEqual(["Cons", "Nil"]);
  });

  it("returns null for non-variant types", () => {
    expect(structuralView({ $ref: "Int" })).toBeNull();
    expect(structuralView({ $record: { fields: [] } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// structuralHead — first element-typed value at the top constructor
// ---------------------------------------------------------------------------

describe("structuralHead", () => {
  const IntList = List({ $ref: "Int" });
  const IntTree = Tree({ $ref: "Int" });

  it("head of JS array (List fast path)", () => {
    expect(structuralHead(IntList, [1, 2, 3])).toBe(1);
  });

  it("head of JS string (String fast path, code-point aware)", () => {
    expect(structuralHead(Str, "👨abc")).toBe("👨");
    expect(structuralHead(Str, "")).toBeNull();
  });

  it("head of structural Cons cell", () => {
    const xs = { __case: "Cons", head: 42, tail: { __case: "Nil" } };
    expect(structuralHead(IntList, xs)).toBe(42);
  });

  // case-to-tag-discriminator Step 1: the structural readers process values
  // carrying the canonical `$tag` discriminator (from the `construct` op),
  // not just the legacy `__case`.
  it("head of a $tag-discriminated Cons cell (canonical)", () => {
    const xs = { $tag: "Cons", head: 42, tail: { $tag: "Nil" } };
    expect(structuralHead(IntList, xs)).toBe(42);
  });

  it("head of structural Nil is null", () => {
    expect(structuralHead(IntList, { __case: "Nil" })).toBeNull();
  });

  it("head of Tree.Node is the root value", () => {
    const t = {
      __case: "Node",
      value: "root",
      left: { __case: "Leaf" },
      right: { __case: "Leaf" },
    };
    expect(structuralHead(Tree({ $ref: "String" }), t)).toBe("root");
  });

  it("head of Tree.Leaf is null", () => {
    expect(structuralHead(IntTree, { __case: "Leaf" })).toBeNull();
  });

  it("head of Maybe.Just unwraps the value", () => {
    expect(structuralHead(Maybe({ $ref: "Int" }), { __case: "Just", _0: 7 })).toBe(7);
  });

  it("head of Maybe.Nothing is null", () => {
    expect(structuralHead(Maybe({ $ref: "Int" }), { __case: "Nothing" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// structuralLength — count of element-typed positions
// ---------------------------------------------------------------------------

describe("structuralLength", () => {
  const IntList = List({ $ref: "Int" });
  const IntTree = Tree({ $ref: "Int" });

  it("length of JS array", () => {
    expect(structuralLength(IntList, [1, 2, 3, 4])).toBe(4);
    expect(structuralLength(IntList, [])).toBe(0);
  });

  it("length of JS string (code-point count)", () => {
    expect(structuralLength(Str, "abc")).toBe(3);
    expect(structuralLength(Str, "👨ab")).toBe(3);
  });

  it("length of structural Cons-list = element count", () => {
    // Cons 1 (Cons 2 (Cons 3 Nil)) → length 3
    const xs = {
      __case: "Cons",
      head: 1,
      tail: { __case: "Cons", head: 2, tail: { __case: "Cons", head: 3, tail: { __case: "Nil" } } },
    };
    expect(structuralLength(IntList, xs)).toBe(3);
  });

  it("length of Tree = total node count (leaves contribute 0, nodes contribute 1)", () => {
    // Node(1, Leaf, Node(2, Leaf, Leaf)) → 2 nodes carrying values
    const t = {
      __case: "Node",
      value: 1,
      left: { __case: "Leaf" },
      right: {
        __case: "Node",
        value: 2,
        left: { __case: "Leaf" },
        right: { __case: "Leaf" },
      },
    };
    expect(structuralLength(IntTree, t)).toBe(2);
  });

  it("length of Maybe.Just is 1, Maybe.Nothing is 0", () => {
    const M = Maybe({ $ref: "Int" });
    expect(structuralLength(M, { __case: "Just", value: 5 })).toBe(1);
    expect(structuralLength(M, { __case: "Nothing" })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// structuralFold — accumulate over element-typed positions
// ---------------------------------------------------------------------------

describe("structuralFold", () => {
  const IntList = List({ $ref: "Int" });
  const IntTree = Tree({ $ref: "Int" });

  it("fold sum on JS array", () => {
    const sum = structuralFold(IntList, [1, 2, 3, 4], (acc, x) => (acc as number) + (x as number), 0);
    expect(sum).toBe(10);
  });

  it("fold concat on JS string", () => {
    const out = structuralFold(Str, "abc", (acc, c) => (acc as string) + (c as string), "");
    expect(out).toBe("abc");
  });

  it("fold sum on structural Cons-list", () => {
    const xs = {
      __case: "Cons",
      head: 1,
      tail: { __case: "Cons", head: 2, tail: { __case: "Cons", head: 3, tail: { __case: "Nil" } } },
    };
    const sum = structuralFold(IntList, xs, (acc, x) => (acc as number) + (x as number), 0);
    expect(sum).toBe(6);
  });

  it("fold sum on Tree visits every Node value", () => {
    // Node(10, Node(5, Leaf, Leaf), Node(20, Leaf, Leaf)) → sum 35
    const t = {
      __case: "Node",
      value: 10,
      left: { __case: "Node", value: 5, left: { __case: "Leaf" }, right: { __case: "Leaf" } },
      right: { __case: "Node", value: 20, left: { __case: "Leaf" }, right: { __case: "Leaf" } },
    };
    const sum = structuralFold(IntTree, t, (acc, x) => (acc as number) + (x as number), 0);
    expect(sum).toBe(35);
  });

  it("fold collect on Tree gives values in pre-order", () => {
    const t = {
      __case: "Node",
      value: 1,
      left: { __case: "Node", value: 2, left: { __case: "Leaf" }, right: { __case: "Leaf" } },
      right: { __case: "Node", value: 3, left: { __case: "Leaf" }, right: { __case: "Leaf" } },
    };
    const collected: number[] = [];
    structuralFold(IntTree, t, (acc, x) => { (acc as number[]).push(x as number); return acc; }, collected);
    expect(collected).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// isVariantValue — detection helper
// ---------------------------------------------------------------------------

describe("isVariantValue", () => {
  it("true for {__case, ...} objects", () => {
    expect(isVariantValue({ __case: "Cons", head: 1, tail: { __case: "Nil" } })).toBe(true);
    expect(isVariantValue({ __case: "Nil" })).toBe(true);
  });

  // case-to-tag-discriminator Step 1: the canonical `$tag` discriminator is
  // recognized alongside the legacy `__case` (dual-read tolerance).
  it("true for {$tag, ...} objects (canonical discriminator)", () => {
    expect(isVariantValue({ $tag: "Cons", head: 1, tail: { $tag: "Nil" } })).toBe(true);
    expect(isVariantValue({ $tag: "Nil" })).toBe(true);
  });

  it("false for arrays, strings, plain records, primitives", () => {
    expect(isVariantValue([1, 2, 3])).toBe(false);
    expect(isVariantValue("hello")).toBe(false);
    expect(isVariantValue(42)).toBe(false);
    expect(isVariantValue(null)).toBe(false);
    expect(isVariantValue({ x: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// caseTag — discriminator read helper (dual-read tolerance)
// ---------------------------------------------------------------------------

describe("caseTag", () => {
  it("prefers $tag, falls back to __case", () => {
    expect(caseTag({ $tag: "Just", value: 1 })).toBe("Just");
    expect(caseTag({ __case: "Just", value: 1 })).toBe("Just");
    // $tag wins when both present (canonical takes precedence)
    expect(caseTag({ $tag: "Ok", __case: "Legacy" })).toBe("Ok");
  });

  it("undefined when neither present or non-string", () => {
    expect(caseTag({ x: 1 } as never)).toBeUndefined();
    expect(caseTag({ $tag: 42 } as never)).toBeUndefined();
  });
});
