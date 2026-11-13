// expr-substrate Phase 2 — conformance tests for `engine:desugar`, the
// `Syntax -> Expr` lowering pass (brief:
// `workstreams/expr-substrate/briefs/phase-2-desugar.md`).
//
// Pure tree-equality: hand-built Syntax trees (plain `{$tag, …}` JS objects —
// the `construct` op tags with `$tag`) → expected Expr trees. Nothing emits
// Syntax yet (parser swap = P4) and nothing evaluates desugar's output yet
// (P4/P8); these pin the canonical core encodings the workstream inherits.
//
// Invocation path (brief probe 4): `dispatchEngineBody("engine:desugar", […])`
// — the registry-backed harness sibling tests use (places-phantom.test.ts).
// No marshalling needed: inputs are already proper tagged Fenel values
// (decision 10 — no `dispatchEngineBody` marshal wrapper threaded).
//
// Coverage: each of the 11 Syntax cases; multi-binding SLet (right-nesting +
// name placement); ≥3-expr SDo (chain shape + "_" params + last-expr value);
// singleton + empty SDo; SOp binary / unary / dotted-qualified head;
// SConstruct with + without `fields`; SMatch with a PatConstruct-carrying arm
// (pattern byte-passthrough); a deep nesting (SIf in SLet in SDo).

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

// --- tiny Syntax/Expr builders (plain $tag-tagged objects) --------------
const SLit = (value: unknown) => ({ $tag: "SLit", value });
const SVar = (name: string) => ({ $tag: "SVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const EVar = (name: string) => ({ $tag: "EVar", name });

const desugar = (node: unknown) => dispatchEngineBody("engine:desugar", [node]);

describe("desugar — the 7 structural mirrors", () => {
  it("SLit ⇒ ELit", () => {
    expect(desugar(SLit(42))).toEqual(ELit(42));
  });

  it("SVar ⇒ EVar", () => {
    expect(desugar(SVar("x"))).toEqual(EVar("x"));
  });

  it("SCall ⇒ ECall with args recursed", () => {
    expect(
      desugar({ $tag: "SCall", fnId: "add", args: [SLit(1), SVar("y")] }),
    ).toEqual({ $tag: "ECall", fnId: "add", args: [ELit(1), EVar("y")] });
  });

  it("SLambda ⇒ ELambda, params passed through, body recursed", () => {
    expect(
      desugar({ $tag: "SLambda", params: ["a", "b"], body: SVar("a") }),
    ).toEqual({ $tag: "ELambda", params: ["a", "b"], body: EVar("a") });
  });

  it("SRecord ⇒ ERecord, field values recursed, names preserved", () => {
    expect(
      desugar({
        $tag: "SRecord",
        fields: [
          { name: "x", value: SLit(1) },
          { name: "y", value: SVar("z") },
        ],
      }),
    ).toEqual({
      $tag: "ERecord",
      fields: [
        { name: "x", value: ELit(1) },
        { name: "y", value: EVar("z") },
      ],
    });
  });

  it("SConstruct WITH fields ⇒ EConstruct carrying fields (args recursed, fields passthrough)", () => {
    expect(
      desugar({
        $tag: "SConstruct",
        ctor: "Foo",
        args: [SLit(1)],
        fields: ["a"],
      }),
    ).toEqual({
      $tag: "EConstruct",
      ctor: "Foo",
      args: [ELit(1)],
      fields: ["a"],
    });
  });

  it("SConstruct WITHOUT fields ⇒ EConstruct omitting the fields key", () => {
    expect(
      desugar({ $tag: "SConstruct", ctor: "Bar", args: [SLit(1)] }),
    ).toEqual({ $tag: "EConstruct", ctor: "Bar", args: [ELit(1)] });
  });

  it("SMatch ⇒ EMatch, scrutinee recursed, pattern byte-passthrough, body recursed", () => {
    const pattern = {
      $tag: "PatConstruct",
      ctor: "Just",
      args: [{ $tag: "PatVar", name: "x" }],
      fields: [],
    };
    expect(
      desugar({
        $tag: "SMatch",
        scrutinee: SVar("v"),
        arms: [{ pattern, body: SVar("x") }],
      }),
    ).toEqual({
      $tag: "EMatch",
      scrutinee: EVar("v"),
      // pattern is passed through UNTOUCHED (same object shape)
      arms: [{ pattern, body: EVar("x") }],
    });
  });
});

describe("desugar — the 4 surface sugars", () => {
  it("SIf ⇒ ECall \"if\" [cond, then, else]", () => {
    expect(
      desugar({
        $tag: "SIf",
        cond: SVar("c"),
        then: SLit(1),
        else: SLit(2),
      }),
    ).toEqual({
      $tag: "ECall",
      fnId: "if",
      args: [EVar("c"), ELit(1), ELit(2)],
    });
  });

  it("SOp binary ⇒ ECall of the resolved head (add)", () => {
    expect(
      desugar({ $tag: "SOp", op: "add", operands: [SLit(1), SLit(2)] }),
    ).toEqual({ $tag: "ECall", fnId: "add", args: [ELit(1), ELit(2)] });
  });

  it("SOp unary ⇒ ECall, one operand (negate)", () => {
    expect(
      desugar({ $tag: "SOp", op: "negate", operands: [SLit(5)] }),
    ).toEqual({ $tag: "ECall", fnId: "negate", args: [ELit(5)] });
  });

  it("SOp dotted qualified head rides as a dotted fnId string (Monad.bind) — tree only, no resolution claim", () => {
    expect(
      desugar({
        $tag: "SOp",
        op: "Monad.bind",
        operands: [SVar("m"), SVar("f")],
      }),
    ).toEqual({
      $tag: "ECall",
      fnId: "Monad.bind",
      args: [EVar("m"), EVar("f")],
    });
  });

  it("SLet single binding ⇒ applied ELambda via \"$\"", () => {
    expect(
      desugar({
        $tag: "SLet",
        bindings: [{ name: "x", value: SLit(1) }],
        body: SVar("x"),
      }),
    ).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [{ $tag: "ELambda", params: ["x"], body: EVar("x") }, ELit(1)],
    });
  });

  it("SLet multi-binding ⇒ right-nested applied ELambdas (binding 2's value sits INSIDE lambda 1, sees x)", () => {
    expect(
      desugar({
        $tag: "SLet",
        bindings: [
          { name: "x", value: SLit(1) },
          { name: "y", value: SVar("x") },
        ],
        body: SVar("y"),
      }),
    ).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [
        {
          $tag: "ELambda",
          params: ["x"],
          body: {
            $tag: "ECall",
            fnId: "$",
            args: [
              { $tag: "ELambda", params: ["y"], body: EVar("y") },
              EVar("x"), // y's value — nested inside lambda 1, so x is in scope
            ],
          },
        },
        ELit(1),
      ],
    });
  });

  it("SDo ≥3 exprs ⇒ right-nested applied ELambdas with \"_\" params, last expr is the value", () => {
    expect(
      desugar({
        $tag: "SDo",
        exprs: [SLit(1), SLit(2), SLit(3)],
      }),
    ).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [
        {
          $tag: "ELambda",
          params: ["_"],
          body: {
            $tag: "ECall",
            fnId: "$",
            args: [
              { $tag: "ELambda", params: ["_"], body: ELit(3) },
              ELit(2),
            ],
          },
        },
        ELit(1),
      ],
    });
  });

  it("SDo singleton ⇒ desugar the one expr bare (no wrap)", () => {
    expect(desugar({ $tag: "SDo", exprs: [SLit(9)] })).toEqual(ELit(9));
  });

  it("SDo empty ⇒ the unit ERecord []", () => {
    expect(desugar({ $tag: "SDo", exprs: [] })).toEqual({
      $tag: "ERecord",
      fields: [],
    });
  });
});

describe("desugar — composed / deep nesting", () => {
  it("SIf inside SLet inside SDo pins the composed encoding", () => {
    const tree = {
      $tag: "SDo",
      exprs: [
        SLit(0),
        {
          $tag: "SLet",
          bindings: [{ name: "c", value: SLit(true) }],
          body: {
            $tag: "SIf",
            cond: SVar("c"),
            then: SLit(1),
            else: SLit(2),
          },
        },
      ],
    };
    expect(desugar(tree)).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [
        {
          $tag: "ELambda",
          params: ["_"],
          // SDo's tail = the singleton [SLet …] ⇒ desugar it bare
          body: {
            $tag: "ECall",
            fnId: "$",
            args: [
              {
                $tag: "ELambda",
                params: ["c"],
                body: {
                  $tag: "ECall",
                  fnId: "if",
                  args: [EVar("c"), ELit(1), ELit(2)],
                },
              },
              ELit(true),
            ],
          },
        },
        ELit(0),
      ],
    });
  });
});
