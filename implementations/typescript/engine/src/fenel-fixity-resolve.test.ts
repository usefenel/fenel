// parser-substrate Phase 3, Step 1 — conformance tests for the Fenel FIXITY
// RESOLVER (`fenel/modules/engine/fixity-resolve.fenel`). brief:
// `workstreams/parser-substrate/briefs/phase-3-expression-grammar.md`.
//
// The resolver folds a FLAT operand/operator sequence `{ first, rest:[{
// notation, operand }] }` into the precedence-correct nested `SCall` Syntax
// tree (the OpSeq production's PRed reduction, decision 4). These are the Step-1
// unit cases — "a small TS-side table of expected nestings" — pinned against
// the SHIPPED `jsonLogicToSyntax(parse(src))` oracle (the same Syntax the
// expression differential will target): every nesting below was cross-checked
// by running `parse` + the adapter on the corresponding source (Step 0.2 recon).
//
// No grammar / no token matching here — the resolver is pure precedence
// climbing over already-built operand Syntax, so it is perf-independent and
// fully verifiable on its own (the expression grammar that FEEDS it is the rest
// of Phase 3).

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

// --- Syntax builders (the marshalled `{$tag, …}` shape) -------------------
const SLit = (value: unknown) => ({ $tag: "SLit", value });
const SVar = (name: string) => ({ $tag: "SVar", name });
const SCall = (fnId: string, args: unknown[]) => ({ $tag: "SCall", fnId, args });

// --- flat-sequence builders ----------------------------------------------
type OpItem = { notation: string; operand: unknown };
const seq = (first: unknown, rest: OpItem[]) => ({ first, rest });
const item = (notation: string, operand: unknown): OpItem => ({ notation, operand });

const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const resolve = (s: unknown): unknown =>
  dispatchEngineBody("engine:resolveOpSeq", [TABLE, s]);
const fixityOf = (n: string): unknown =>
  dispatchEngineBody("engine:fixityOf", [TABLE, n]);

describe("fixityOf — the table lookup + custom-op default", () => {
  it("`+` ⇒ add / prec 6 / left", () => {
    expect(fixityOf("+")).toEqual({ fnId: "add", prec: 6, assoc: "l" });
  });
  it("`*` ⇒ mul / prec 7 / left", () => {
    expect(fixityOf("*")).toEqual({ fnId: "mul", prec: 7, assoc: "l" });
  });
  it("`$` ⇒ literal `$` / prec 0 / right (structural)", () => {
    expect(fixityOf("$")).toEqual({ fnId: "$", prec: 0, assoc: "r" });
  });
  it("`and` ⇒ and / prec 3 / right", () => {
    expect(fixityOf("and")).toEqual({ fnId: "and", prec: 3, assoc: "r" });
  });
  it("`==` ⇒ eq / prec 4 / none", () => {
    expect(fixityOf("==")).toEqual({ fnId: "eq", prec: 4, assoc: "n" });
  });
  it("a custom operator defaults to key-as-fnId / prec 9 / left (TS `?? {assoc:l,prec:9}`)", () => {
    expect(fixityOf("++")).toEqual({ fnId: "++", prec: 9, assoc: "l" });
    expect(fixityOf("<?>")).toEqual({ fnId: "<?>", prec: 9, assoc: "l" });
  });
});

describe("resolveOpSeq — precedence climbing ⇒ nested SCall (oracle-pinned)", () => {
  it("a single operand (no ops) returns `first` unchanged", () => {
    expect(resolve(seq(SLit(5), []))).toEqual(SLit(5));
  });

  it("`1 + 2` ⇒ SCall add [1, 2]", () => {
    expect(resolve(seq(SLit(1), [item("+", SLit(2))]))).toEqual(
      SCall("add", [SLit(1), SLit(2)]),
    );
  });

  it("`1 + 2 * 3` ⇒ add [1, mul [2, 3]] (mul binds tighter)", () => {
    expect(
      resolve(seq(SLit(1), [item("+", SLit(2)), item("*", SLit(3))])),
    ).toEqual(SCall("add", [SLit(1), SCall("mul", [SLit(2), SLit(3)])]));
  });

  it("`1 * 2 + 3` ⇒ add [mul [1, 2], 3] (mul-first stays left)", () => {
    expect(
      resolve(seq(SLit(1), [item("*", SLit(2)), item("+", SLit(3))])),
    ).toEqual(SCall("add", [SCall("mul", [SLit(1), SLit(2)]), SLit(3)]));
  });

  it("`1 - 2 - 3` ⇒ sub [sub [1, 2], 3] (left-assoc)", () => {
    expect(
      resolve(seq(SLit(1), [item("-", SLit(2)), item("-", SLit(3))])),
    ).toEqual(SCall("sub", [SCall("sub", [SLit(1), SLit(2)]), SLit(3)]));
  });

  it("`a and b and c` ⇒ and [a, and [b, c]] (right-assoc)", () => {
    expect(
      resolve(seq(SVar("a"), [item("and", SVar("b")), item("and", SVar("c"))])),
    ).toEqual(SCall("and", [SVar("a"), SCall("and", [SVar("b"), SVar("c")])]));
  });

  it("`f $ g $ x` ⇒ $ [f, $ [g, x]] (right-assoc, prec 0)", () => {
    expect(
      resolve(seq(SVar("f"), [item("$", SVar("g")), item("$", SVar("x"))])),
    ).toEqual(SCall("$", [SVar("f"), SCall("$", [SVar("g"), SVar("x")])]));
  });

  it("mixed `a or b and c` ⇒ or [a, and [b, c]] (and prec 3 > or prec 2)", () => {
    expect(
      resolve(seq(SVar("a"), [item("or", SVar("b")), item("and", SVar("c"))])),
    ).toEqual(SCall("or", [SVar("a"), SCall("and", [SVar("b"), SVar("c")])]));
  });

  it("mixed `a and b or c` ⇒ or [and [a, b], c] (and binds first, then or)", () => {
    expect(
      resolve(seq(SVar("a"), [item("and", SVar("b")), item("or", SVar("c"))])),
    ).toEqual(SCall("or", [SCall("and", [SVar("a"), SVar("b")]), SVar("c")]));
  });

  it("`a < b` non-assoc single op ⇒ lt [a, b]", () => {
    expect(resolve(seq(SVar("a"), [item("<", SVar("b"))]))).toEqual(
      SCall("lt", [SVar("a"), SVar("b")]),
    );
  });

  it("a custom operator `a ++ b` ⇒ SCall `++` [a, b] (default infixl 9, key-as-fnId)", () => {
    expect(resolve(seq(SVar("a"), [item("++", SVar("b"))]))).toEqual(
      SCall("++", [SVar("a"), SVar("b")]),
    );
  });

  it("`1 + 2 + 3 * 4` ⇒ add [add [1,2], mul [3,4]]", () => {
    expect(
      resolve(
        seq(SLit(1), [item("+", SLit(2)), item("+", SLit(3)), item("*", SLit(4))]),
      ),
    ).toEqual(
      SCall("add", [
        SCall("add", [SLit(1), SLit(2)]),
        SCall("mul", [SLit(3), SLit(4)]),
      ]),
    );
  });
});

// --- backtick items (P3b T2) — the bt-arm: prec-bypass + rhs re-enters at 0,
// notation IS the fnName (no table lookup). Oracle-pinned against
// jsonLogicToSyntax(parse(src)) for the corresponding backtick sources.
const bt = (notation: string, operand: unknown) => ({ notation, operand, bt: true });

describe("resolveOpSeq — backtick items (bt = true, the parseInfix:1548 separate-loop parity)", () => {
  it("`x \\`add\\` y` ⇒ add [x, y] (simple)", () => {
    expect(resolve(seq(SVar("x"), [bt("add", SVar("y"))]))).toEqual(
      SCall("add", [SVar("x"), SVar("y")]),
    );
  });

  it("`1 + x \\`add\\` y` ⇒ add [1, add [x, y]] (bt fires INSIDE the + climb — prec bypass)", () => {
    expect(
      resolve(seq(SLit(1), [item("+", SVar("x")), bt("add", SVar("y"))])),
    ).toEqual(SCall("add", [SLit(1), SCall("add", [SVar("x"), SVar("y")])]));
  });

  it("`x \\`add\\` y + 1` ⇒ add [x, add [y, 1]] (bt rhs re-enters at 0 — swallows the rest)", () => {
    expect(
      resolve(seq(SVar("x"), [bt("add", SVar("y")), item("+", SLit(1))])),
    ).toEqual(SCall("add", [SVar("x"), SCall("add", [SVar("y"), SLit(1)])]));
  });
});
