// field-identity Phase 4 (D6) — stray top-level expression statements are a
// LOAD FAILURE, not silent wrong code.
//
// The hazard class (hit twice in the Phase-3 stabilization — validate.fenel's
// `validationNamedFactForMode` and json-schema-reverse.fenel's bare-`then`
// block): a trailing multi-line application argument that dedents to column 1
// parses as a NEW top-level statement. Pre-D6 the TS parser accepted the mixed
// program and `flattenProgram` silently dropped the stray item, leaving the
// callee a partial application (`__fenelPartial`) — silent wrong code on the
// production path. Post-D6 the parse itself rejects with the offending line.
//
// The Fenel grammar (decl-grammar.fenel `Decls`) never had a bare-expression
// arm, so it already rejected this shape structurally; this pins the ledgered
// TS perf branch to the same posture (with a readable span), and pins that
// expression-only sources (REPL / editor snippets) keep parsing.
import { describe, expect, test } from "bun:test";
import { parse } from "./fenel-parser";

const HAZARD_SRC = `f : Number -> Number
f x =
  if gt x 0
  then add x 1
  else add x
(2)
`;

describe("D6 — stray top-level expression rejection", () => {
  test("a mixed program (declarations + hoisted expression) rejects with the offending line", () => {
    let err: Error | null = null;
    try {
      parse(HAZARD_SRC);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(String(err)).toContain("stray top-level expression statement");
    // The stray `(2)` sits on line 6 of HAZARD_SRC.
    expect(String(err)).toContain("line 6");
  });

  test("the stray argument is no longer silently dropped into a partial (regression shape)", () => {
    // The exact stabilization shape: a two-argument application whose second,
    // parenthesized argument dedents to column 1. Pre-D6: `g` kept ONE arg
    // (a partial) and `(validationDescribeMode mode)`-style args vanished.
    const src = `h : Number -> Number
h x =
  if gt x 0
  then g x 1
  else g x
(k x)
`;
    expect(() => parse(src)).toThrow(/stray top-level expression statement/);
  });

  test("a pure single-expression source still parses (editor/REPL entry)", () => {
    const ast = parse("1 + 2") as unknown as Record<string, unknown>;
    expect(ast).toBeTruthy();
    expect("program" in ast).toBe(false);
  });

  test("a pure multi-expression source still parses to the REPL-like do block", () => {
    const ast = parse("1 + 2\n3 * 4") as unknown as Record<string, unknown>;
    expect(ast).toBeTruthy();
    expect("do" in ast).toBe(true);
  });

  test("a well-formed module (sig + def + type-def) still parses to a program", () => {
    const ast = parse(`f : Number -> Number
f x = x + 1

Color = Red | Green | Blue
`) as unknown as Record<string, unknown>;
    expect(ast).toBeTruthy();
    expect("program" in ast).toBe(true);
    expect((ast.program as unknown[]).length).toBe(3);
  });
});
