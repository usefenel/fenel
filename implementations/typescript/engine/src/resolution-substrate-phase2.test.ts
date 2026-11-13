// resolution-substrate Phase 2 — the `Sequential` conformance test (KEPT).
//
// Phase 2 declares `Sequential f` (`take` / `drop` / `splitAt`) as a `.fenel`
// class (algebra.fenel) with List + Vec instances (algebra-instances.fenel),
// over the SHIPPED Phase-1 bare-name resolution substrate. This test pins the
// PAYOFF: one `Sequential` class, dispatched List-vs-Vec by the arg's reflected
// type — the true one-`take`-for-List+Vec subsumption.
//
// WHAT'S PROVEN HERE (Commits 1–4):
//   • the class registered with ZERO new TS (derived from the `.fenel` decl);
//   • take/drop/splitAt dispatch List → List + Vec → Vec via the QUALIFIED
//     `{method:["Sequential", …]}` form (the class-method path);
//   • BARE `take`/`drop` dispatch List → List + Vec → Vec (Commit 4 renamed the
//     Vec methods `takeAxis`→`take` / `dropAxis`→`drop`, forcing the codeName
//     collision so the Phase-1 classifier routes the now-multi-binding name
//     through `Sequential` — the true one-`take`-for-List+Vec subsumption);
//   • `splitAt` (whose generic body is now BARE `take`/`drop`) dispatches BOTH
//     internal cuts to the right instance;
//   • the laws hold on both instances;
//   • the §4 dispatch-arg partial re-dispatches per the sequence's type;
//   • the ~181-site no-REGRESSION: a bare `take`/`drop` on a List still lands on
//     the `std:take`/`std:drop` native (the List instance method) — pure dispatch
//     overhead, correctness byte-identical (the zero-cost fix is Phase 4).
//
// A Vec value is `{$tag:"Vec","0":…,"1":…}` (array-substrate Phase 1b); it
// reflects to the key "Vec" (`typeConstructorOf` reads the `$tag`), matching the
// `Sequential Vec` instance's `args[0]`. The ctx loads `deriveFunctorModule` so
// the derived structural Foldable folds a Vec (the Vec `drop` reads `foldableLength`).
import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { deriveFunctorModule } from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { resolveMethod } from "./effect-dispatch";
import { evaluate } from "./json-logic";
import type { EvaluateContext } from "./json-logic";

let ctx: EvaluateContext;
beforeAll(() => {
  const reg = createRegistry([stdModule, engineModule, algebraModule, deriveFunctorModule], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

const LIST4 = [10, 20, 30, 40];
const VEC4 = { $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 };
const ev = (logic: unknown): unknown => evaluate(logic as never, {}, ctx);

// ===========================================================================
// (1) The class + instances are registered (derived, zero new TS).
// ===========================================================================
describe("Sequential — the class + its List/Vec instances", () => {
  test("`Sequential` is a registered class; take/drop/splitAt dispatch on arg 1 (the `f<a>` sequence)", () => {
    const seed = dispatchRegistry.getClass("Sequential");
    expect(seed).toBeDefined();
    expect(seed?.params?.[0]?.name).toBe("f");
    // laws ERASED from the dispatch method set (Verified Boolean fields)
    expect(seed?.methods.map((m) => m.name).sort()).toEqual(["drop", "splitAt", "take"]);
  });

  test("both instances are registered, keyed on List + Vec", () => {
    const insts = dispatchRegistry.listInstances("Sequential");
    const list = insts.find((i) => i.args[0] === "List");
    const vec = insts.find((i) => i.args[0] === "Vec");
    // modules-as-values Phase 2b: qualified references to the same functions.
    expect(list?.methods).toEqual({
      take: { $ref: "std.take" },
      drop: { $ref: "std.drop" },
      splitAt: { $ref: "algebra.splitAt" },
    });
    expect(vec?.methods).toEqual({
      take: { $ref: "algebra.take" },
      drop: { $ref: "algebra.drop" },
      splitAt: { $ref: "algebra.splitAt" },
    });
  });

  test("`take` resolves most-specific by the dispatch arg's type (List native vs Vec axis transform)", () => {
    const onList = resolveMethod("Sequential", "take", [2, LIST4], ctx, dispatchRegistry);
    const onVec = resolveMethod("Sequential", "take", [2, VEC4], ctx, dispatchRegistry);
    expect(onList.$tag).toBe("Unique");
    expect(onVec.$tag).toBe("Unique");
    if (onList.$tag === "Unique") {
      expect(onList.method).toEqual({ $ref: "std.take" });
      expect(onList.key).toBe("List");
      expect(onList.dispatchPos).toBe(1);
    }
    if (onVec.$tag === "Unique") {
      expect(onVec.method).toEqual({ $ref: "algebra.take" });
      expect(onVec.key).toBe("Vec");
      expect(onVec.dispatchPos).toBe(1);
    }
  });
});

// ===========================================================================
// (2) The subsumption — take/drop/splitAt dispatch List + Vec by type.
// ===========================================================================
describe("Sequential dispatch — one class, List + Vec", () => {
  test("`take` — List → List slice; Vec → tag-preserving leading-axis prefix", () => {
    expect(ev({ method: ["Sequential", "take", 2, LIST4] })).toEqual([10, 20]);
    expect(ev({ method: ["Sequential", "take", 2, VEC4] })).toEqual({ $tag: "Vec", "0": 10, "1": 20 });
  });

  test("`drop` — List → List suffix; Vec → leading-axis suffix", () => {
    expect(ev({ method: ["Sequential", "drop", 2, LIST4] })).toEqual([30, 40]);
    expect(ev({ method: ["Sequential", "drop", 2, VEC4] })).toEqual({ $tag: "Vec", "0": 30, "1": 40 });
  });

  test("`splitAt` dispatches BOTH internal cuts (its body is qualified Sequential.take/.drop)", () => {
    expect(ev({ method: ["Sequential", "splitAt", 2, LIST4] })).toEqual([[10, 20], [30, 40]]);
    expect(ev({ method: ["Sequential", "splitAt", 2, VEC4] })).toEqual([
      { $tag: "Vec", "0": 10, "1": 20 },
      { $tag: "Vec", "0": 30, "1": 40 },
    ]);
  });

  test("BARE `splitAt` (direct → algebra:splitAt) type-dispatches via its bare take/drop internals", () => {
    expect(ev({ call: ["splitAt", 2, LIST4] })).toEqual([[10, 20], [30, 40]]);
    expect(ev({ call: ["splitAt", 2, VEC4] })).toEqual([
      { $tag: "Vec", "0": 10, "1": 20 },
      { $tag: "Vec", "0": 30, "1": 40 },
    ]);
  });
});

// ===========================================================================
// (3) The laws hold on both instances (D4).
// ===========================================================================
describe("Sequential — the laws", () => {
  test("take n xs ++ drop n xs == xs (List, via std:concat)", () => {
    const lhs = ev({ call: ["concat", { method: ["Sequential", "take", 2, LIST4] }, { method: ["Sequential", "drop", 2, LIST4] }] });
    expect(lhs).toEqual(LIST4);
  });

  test("splitAt n xs == [take n xs, drop n xs] (List + Vec, by construction)", () => {
    for (const xs of [LIST4, VEC4]) {
      const split = ev({ method: ["Sequential", "splitAt", 2, xs] });
      const pair = [ev({ method: ["Sequential", "take", 2, xs] }), ev({ method: ["Sequential", "drop", 2, xs] })];
      expect(split).toEqual(pair);
    }
  });

  test("take 0 xs == empty / drop 0 xs == xs (List)", () => {
    expect(ev({ method: ["Sequential", "take", 0, LIST4] })).toEqual([]);
    expect(ev({ method: ["Sequential", "drop", 0, LIST4] })).toEqual(LIST4);
  });

  test("foldableLength (take n xs) == min n (foldableLength xs) (List)", () => {
    expect(ev({ call: ["foldableLength", { method: ["Sequential", "take", 2, LIST4] }] })).toBe(2);
    expect(ev({ call: ["foldableLength", { method: ["Sequential", "take", 9, LIST4] }] })).toBe(4); // min 9 4
  });
});

// ===========================================================================
// (4) The §4 dispatch-arg partial — `(Sequential.take 2)` re-dispatches by the
// sequence's type when it finally arrives (the eta wrinkle, Phase-1 machinery).
// ===========================================================================
describe("Sequential — the dispatch-arg partial", () => {
  test("`(Sequential.take 2)` defers, then re-dispatches per the SECOND arg's type", () => {
    const partial = ev({ method: ["Sequential", "take", 2] });
    expect(evaluate({ apply: [{ var: "p" }, [LIST4]] } as never, { p: partial }, ctx)).toEqual([10, 20]);
    expect(evaluate({ apply: [{ var: "p" }, [VEC4]] } as never, { p: partial }, ctx)).toEqual({ $tag: "Vec", "0": 10, "1": 20 });
  });
});

// ===========================================================================
// (5) Commit 4 — bare take/drop are NOW multi-binding DISPATCH (the subsumption).
// The codeName collision (`std:take`+`algebra:take`) flips the Phase-1 classifier
// from `direct` → `dispatch Sequential`. A List arg still lands on the `std:take`
// native (no correctness regression; pure dispatch overhead); a Vec arg lands on
// `algebra:take`, the leading-axis transform.
// ===========================================================================
describe("Sequential — bare take/drop now dispatch (the Commit-4 collision)", () => {
  test("bare `take`/`drop` classify DISPATCH via Sequential (was direct — the rename forced the collision)", () => {
    const resolve = (ctx as unknown as { _resolveBareName?: (n: string) => { kind: string; typeName?: string } })._resolveBareName!;
    expect(resolve("take")).toEqual({ kind: "dispatch", typeName: "Sequential" });
    expect(resolve("drop")).toEqual({ kind: "dispatch", typeName: "Sequential" });
  });

  test("bare `take`/`drop` on a List still land on the `std:take`/`std:drop` native (byte-identical)", () => {
    expect(ev({ call: ["take", 2, LIST4] })).toEqual([10, 20]);
    expect(ev({ call: ["drop", 2, LIST4] })).toEqual([30, 40]);
  });

  test("bare `take`/`drop` on a Vec dispatch the `Sequential Vec` leading-axis transform", () => {
    expect(ev({ call: ["take", 2, VEC4] })).toEqual({ $tag: "Vec", "0": 10, "1": 20 });
    expect(ev({ call: ["drop", 2, VEC4] })).toEqual({ $tag: "Vec", "0": 30, "1": 40 });
  });

  test("bare `splitAt` (whose body is bare take/drop) dispatches BOTH cuts per the arg's type", () => {
    expect(ev({ call: ["splitAt", 2, LIST4] })).toEqual([[10, 20], [30, 40]]);
    expect(ev({ call: ["splitAt", 2, VEC4] })).toEqual([
      { $tag: "Vec", "0": 10, "1": 20 },
      { $tag: "Vec", "0": 30, "1": 40 },
    ]);
  });
});
