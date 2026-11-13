// decide-substrate Phase 6, Step 1 — the equality/order ground-truth regression
// rows. brief: `workstreams/decide-substrate/briefs/phase-6-equality-ground-truth-nelson-oppen.md`.
//
// The pre-Phase-6 `std:eq` was JS-loose (`a == b`): `eq("1",1)=true`,
// `eq(" ",false)=true`; not transitive (`""==0`, `0=="0"`, `""!="0"`); not a
// congruence (`eq("1",1)` yet `isString` distinguishes them). No congruence-
// closure theory can model loose-`eq` atoms, so the shipped EUF decider arm
// returned a WRONG `Just true` on the runtime-INHABITED `{v | v=="1" ∧ v==1}`.
// This file pins the type-honest replacement END-TO-END: `eq`/`neq` are
// type-discriminated STRUCTURAL (deepEqValue semantics; objects flip
// reference→structural), `lt/lte/gt/gte` are same-type (cross-type ⇒ false).

import { describe, it, expect } from "vitest";
import { evaluate, structuralEq } from "./json-logic";
import { dispatchEngineBodyWithDeciderCtx } from "./engine-bodies-dispatch";

const ev = (op: string, ...args: unknown[]) => evaluate({ [op]: args } as never, {});

const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const SeWhere = (pred: unknown) => ({ $tag: "SeWhere", pred });
const JUST_TRUE = { $tag: "Just", _0: true };

describe("Step 1 — eq is type-discriminated STRUCTURAL (not JS-loose)", () => {
  it('eq("1", 1) = false (cross-type scalar — the peTruthy bug class)', () => {
    expect(structuralEq("1", 1)).toBe(false);
    expect(ev("eq", "1", 1)).toBe(false);
    expect(ev("neq", "1", 1)).toBe(true);
  });

  it('eq(" ", false) = false (string vs boolean — loose `" " == false` was true)', () => {
    expect(structuralEq(" ", false)).toBe(false);
    expect(ev("eq", " ", false)).toBe(false);
  });

  it("eq({a:1}, {a:1}) = true (objects flip JS reference-eq → STRUCTURAL)", () => {
    expect(structuralEq({ a: 1 }, { a: 1 })).toBe(true);
    expect(ev("eq", { a: 1 }, { a: 1 })).toBe(true);
    expect(structuralEq({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("eq is a congruence on scalars: same-type equal ⇒ true, distinct ⇒ false", () => {
    expect(ev("eq", 1, 1)).toBe(true);
    expect(ev("eq", "x", "x")).toBe(true);
    expect(ev("eq", true, true)).toBe(true);
    expect(ev("eq", 1, 2)).toBe(false);
    expect(ev("eq", true, 1)).toBe(false); // bool vs number — distinct
  });

  it("arrays compare element-wise; nested records recurse", () => {
    expect(structuralEq([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(structuralEq([1, 2], [1, 2, 3])).toBe(false);
    expect(structuralEq({ $tag: "Just", _0: { a: [1] } }, { $tag: "Just", _0: { a: [1] } })).toBe(true);
    expect(structuralEq({ $tag: "Just", _0: 1 }, { $tag: "Nothing" })).toBe(false);
  });

  it("NaN keeps `===` (eq(NaN,NaN) = false) — no invented NaN semantics", () => {
    expect(structuralEq(NaN, NaN)).toBe(false);
  });

  it("null and undefined are both absence (eq(null, undefined) = true)", () => {
    expect(structuralEq(null, undefined)).toBe(true);
    expect(structuralEq(null, 0)).toBe(false);
  });
});

describe("Step 1 — the order family is SAME-TYPE (cross-type ⇒ false)", () => {
  it('lte("5", 5) = false (the coercion that broke antisymmetry / blocked equality derivation)', () => {
    expect(ev("lte", "5", 5)).toBe(false);
    expect(ev("gte", "5", 5)).toBe(false);
    expect(ev("lt", "5", 5)).toBe(false);
    expect(ev("gt", "5", 5)).toBe(false);
  });

  it("both-numbers ⇒ numeric (unchanged)", () => {
    expect(ev("lt", 2, 3)).toBe(true);
    expect(ev("lte", 5, 5)).toBe(true);
    expect(ev("gt", 5, 3)).toBe(true);
    expect(ev("gte", 3, 5)).toBe(false);
  });

  it("both-strings ⇒ lexical (unchanged — the B4 repr shortcut)", () => {
    expect(ev("lt", "a", "b")).toBe(true);
    expect(ev("gt", "b", "a")).toBe(true);
    expect(ev("lte", "abc", "abc")).toBe(true);
  });

  it("booleans / objects have no order ⇒ false", () => {
    expect(ev("lt", true, 1)).toBe(false);
    expect(ev("lt", false, true)).toBe(false);
    expect(ev("lt", { a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("Step 1 — the §0 headline, pinned END-TO-END", () => {
  it("`{v | v==\"1\" ∧ v==1}` is GENUINELY empty ⇒ decideEmpty = Just true (now CORRECT)", () => {
    const pred = ECall("and", [
      ECall("eq", [EVar("v"), ELit("1")]),
      ECall("eq", [EVar("v"), ELit(1)]),
    ]);
    expect(dispatchEngineBodyWithDeciderCtx("engine:setAlgebraDecideEmpty", [SeWhere(pred)])).toEqual(JUST_TRUE);
  });

  it("whereMember(v:=1) = false — the verdict and the runtime AGREE (strict eq ⇒ no such v)", () => {
    // 1 == "1" ∧ 1 == 1  →  false ∧ true  →  false
    expect(evaluate({ and: [{ eq: [1, "1"] }, { eq: [1, 1] }] } as never, {})).toBe(false);
  });

  it('`if x == "1"` agrees with `case x of "1"` — both strict (x = 1 ⇒ no match)', () => {
    // pattern-literal match is `pattern === scrutinee` (json-logic.ts:1514);
    // eq(1, "1") is now also strict-false ⇒ the language no longer self-disagrees.
    expect(evaluate({ eq: [1, "1"] } as never, {})).toBe(false);
    // `match` op form: flat [scrutinee, pat1, body1, …, elseBody]; "_" is wildcard.
    expect(evaluate({ match: [1, "1", "matched", "_", "no"] } as never, {})).toBe("no");
    expect(evaluate({ match: ["1", "1", "matched", "_", "no"] } as never, {})).toBe("matched");
  });
});
