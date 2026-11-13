import { describe, it, expect } from "vitest";
import { parse as parseRaw, ParseError } from "./fenel-parser";
import { print } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import { Maybe as _Maybe, List as _List, Just, Nothing } from "./type-foundation";
import type { FenelType } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// 7g-parser: the parser now emits a user-written type-name reference as `{$ref}`
// (was `{$ref}`). These round-trip tests assert the parser's STRUCTURAL output
// over a broad surface (layout / ADTs / refinements / operators) where the
// reference's value form is incidental to what each test checks. Fold
// `{$ref:H}`→`{$ref:H}` on the parse output so each test keeps asserting its
// actual subject — exactly the consumer-fold the engine itself applies
// (`fenel-printer.ts` `printType` folds `{$ref}` the same way, Phase 7e). The
// PRECISE producer tripwire (`{$ref}` pinned per producer site + scaffolding
// staying `{$ref}`) lives in `typed-ref-parser-producer.test.ts`, NOT here.
// 3b-2 Step 4 — the parser now emits SetExprs in the canonical `$tag` Se* form.
// Fold any `$tag` SetExpr back to the legacy `$`-key shape (setExprToDollarKey,
// deep) BEFORE the `$ref`→`$ref` fold, so these structural round-trip tests
// keep asserting their actual subject in the pre-flip `$`-key form. (A `$tag`
// SeRef then folds `$ref`→`$ref` like any other reference.) Same sanctioned
// mechanical re-pin as the `$ref`-fold above. The 5 pre-existing parser-layout
// fails are NOT SetExpr-form and stay failing.
function foldRefs(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(foldRefs);
  if (t && typeof t === "object") {
    const o = isSetExpr(t)
      ? (setExprToDollarKey(t) as Record<string, unknown>)
      : (t as Record<string, unknown>);
    if ("$ref" in o && typeof o.$ref === "string" && Object.keys(o).length === 1) {
      return { $ref: o.$ref };
    }
    // Signature-substrate Phase 2 adds authoritative `type_sig.scheme` and
    // `type_def.binding` sidecars. This broad legacy syntax suite predates that
    // contract and asserts unrelated parser/printer shapes, so normalize only
    // those two declaration sidecars here. Exact binding/kind/application
    // output is pinned in source-scheme-parser.test.ts.
    const sourceSignature = typeof o.name === "string" && "type" in o && "scheme" in o;
    const sourceTypeDefinition = typeof o.name === "string" && "binding" in o && (
      "constructors" in o || "refined" in o || "alias" in o || "kindSig" in o
    );
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if ((sourceSignature && k === "scheme") || (sourceTypeDefinition && k === "binding")) continue;
      out[k] = foldRefs(o[k]);
    }
    return out;
  }
  return t;
}
const parse = (src: string, locale?: string): ReturnType<typeof parseRaw> =>
  foldRefs(parseRaw(src, locale)) as ReturnType<typeof parseRaw>;

async function buildSyntaxStdContext() {
  const { createRegistry } = await import("./registry");
  const { stdModule } = await import("./modules/std");
  return createRegistry([stdModule], {
    fieldIdentity: {
      mode: "source-handles",
      defaultRealm: "repository-source",
      cacheKey: "fenel-syntax:immutable-std-fixture",
    },
  }).evaluateContext();
}

let syntaxStdContext: ReturnType<typeof buildSyntaxStdContext> | undefined;
function sharedSyntaxStdContext() {
  return syntaxStdContext ??= buildSyntaxStdContext();
}

// 7g-retire-2b: the TS `List`/`Maybe` helpers now emit `{$ref}` self-refs (producers
// flipped); fold their output to `{$ref}` so they match the (also-folded) `parse`
// output for the conformance assertions below.
const List = (a: FenelType) => foldRefs(_List(a)) as FenelType;
const Maybe = (a: FenelType) => foldRefs(_Maybe(a)) as FenelType;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parse — literals", () => {
  it("number", () => expect(parse("42")).toBe(42));
  it("float", () => expect(parse("3.14")).toBe(3.14));
  it("string", () => expect(parse('"hello"')).toBe("hello"));
  it("string escape", () => expect(parse('"a\\nb"')).toBe("a\nb"));
  it("true", () => expect(parse("true")).toBe(true));
  it("false", () => expect(parse("false")).toBe(false));
});

describe("parse — variables", () => {
  it("simple", () => expect(parse("x")).toEqual({ var: "x" }));
  it("dotted", () => expect(parse("a.b.c")).toEqual({ var: "a.b.c" }));
  it("underscore ident", () => expect(parse("my_var")).toEqual({ var: "my_var" }));
});

describe("parse — arithmetic", () => {
  it("add", () => expect(parse("1 + 2")).toEqual({ call: ["add",1, 2] }));
  it("sub", () => expect(parse("5 - 3")).toEqual({ call: ["sub", 5, 3] }));
  it("mul", () => expect(parse("2 * 3")).toEqual({ call: ["mul",2, 3] }));
  it("div", () => expect(parse("10 / 2")).toEqual({ call: ["div",10, 2] }));
  it("mod", () => expect(parse("7 % 3")).toEqual({ call: ["mod",7, 3] }));
  it("precedence: add vs mul", () =>
    expect(parse("1 + 2 * 3")).toEqual({ call: ["add",1, { call: ["mul",2, 3] }] }));
  it("left associative", () =>
    expect(parse("1 - 2 - 3")).toEqual({ call: ["sub", { call: ["sub", 1, 2] }, 3] }));
  it("parens override", () =>
    expect(parse("(1 + 2) * 3")).toEqual({ call: ["mul",{ call: ["add",1, 2] }, 3] }));
  it("unary minus", () =>
    expect(parse("-x")).toEqual({ call: ["negate", { var: "x" }] }));
});

describe("parse — comparison", () => {
  it("==", () => expect(parse("x == 1")).toEqual({ call: ["eq",{ var: "x" }, 1] }));
  it("!=", () => expect(parse("x != 1")).toEqual({ call: ["neq",{ var: "x" }, 1] }));
  it("<", () => expect(parse("x < 1")).toEqual({ call: ["lt",{ var: "x" }, 1] }));
  it("<=", () => expect(parse("x <= 1")).toEqual({ call: ["lte",{ var: "x" }, 1] }));
  it(">", () => expect(parse("x > 1")).toEqual({ call: ["gt",{ var: "x" }, 1] }));
  it(">=", () => expect(parse("x >= 1")).toEqual({ call: ["gte",{ var: "x" }, 1] }));
});

describe("parse — boolean", () => {
  it("and", () => expect(parse("a and b")).toEqual({ call: ["and", { var: "a" }, { var: "b" }] }));
  it("or", () => expect(parse("a or b")).toEqual({ call: ["or", { var: "a" }, { var: "b" }] }));
  it("not", () => expect(parse("not x")).toEqual({ call: ["not", { var: "x" }] }));
  it("precedence: and binds tighter than or", () =>
    expect(parse("a or b and c")).toEqual({
      call: ["or", { var: "a" }, { call: ["and", { var: "b" }, { var: "c" }] }],
    }));
  it("not binds tighter than and", () =>
    expect(parse("not a and b")).toEqual({
      call: ["and", { call: ["not", { var: "a" }] }, { var: "b" }],
    }));
});

// `and` / `or` / `not` are de-reserved word-operators — ordinary std functions
// dispatched by notation, NOT lexer keywords. These pin that they parse as
// functions, stay usable as plain identifiers, and don't over-capture other
// identifiers that merely share a notation spelling (`cat`).
describe("parse — word-operators (de-reserved, not keywords)", () => {
  it("`and` / `or` are usable as record field names", () =>
    expect(parse("{ and = 1, or = 2 }")).toEqual({ and: 1, or: 2 }));
  it("`not` is plain prefix application, not a keyword", () =>
    expect(parse("not (isNull y)")).toEqual({
      call: ["not", { call: ["isNull", { var: "y" }] }],
    }));
  it("`cat` (a fixity notation) is NOT captured as an operator in arg position", () =>
    expect(parse("mergeRecords cat other")).toEqual({
      call: ["mergeRecords", { var: "cat" }, { var: "other" }],
    }));
  it("localized `et` / `ou` / `non` canonicalize to the English notation", () => {
    // Localized spellings are the operators' Codeable localized codeNames,
    // projected from parser-fixities.fenel (NOT a hardcoded LOCALE_OP table).
    expect(parse("a et b", "fr")).toEqual({ call: ["and", { var: "a" }, { var: "b" }] });
    expect(parse("a ou b", "fr")).toEqual({ call: ["or", { var: "a" }, { var: "b" }] });
    expect(parse("non x", "fr")).toEqual({ call: ["not", { var: "x" }] });
    expect(parse("a y b", "es")).toEqual({ call: ["and", { var: "a" }, { var: "b" }] });
  });
  // Explicit timeout: this is the FIRST test in the file to call `print`, so it
  // pays the whole engine-harness boot (`dispatchEngineBody` → registry init) on
  // top of its own two assertions — measured ~6.1s on a contended box, over the
  // 5s default. The test itself is two calls; the budget is boot, not work. Same
  // reason the sibling parser suites carry an explicit `TO`.
  it("localized operator input retains its callable tree when printed (fr)", () => {
    for (const source of ["a et b", "x ou y"]) {
      const expression = parse(source, "fr");
      expect(parse(print(expression as any, "fr"), "fr")).toEqual(expression);
    }
  }, 120000);
  it("identifiers that collide with Object.prototype keys parse safely (no pollution)", () => {
    // The localized-operator lookup is indexed by source idents; a plain-object
    // map would resolve `constructor` / `toString` to inherited methods.
    expect(parse("constructor")).toEqual({ var: "constructor" });
    expect(parse("f toString x")).toEqual({ call: ["f", { var: "toString" }, { var: "x" }] });
    expect(parse("hasOwnProperty", "fr")).toEqual({ var: "hasOwnProperty" });
  });
});

describe("parse — let", () => {
  it("simple", () => expect(parse("let x = 5")).toEqual({ let: { x: 5 } }));
  it("with expression", () =>
    expect(parse("let y = 1 + 2")).toEqual({ let: { y: { call: ["add",1, 2] } } }));
  it("monadic bind", () =>
    expect(parse("x <- f()")).toEqual({ let: { x: { call: ["f"] } } }));
});

describe("parse — if", () => {
  it("if then", () => expect(parse("if true then 1")).toEqual({ if: [true, 1] }));
  it("if then else", () =>
    expect(parse("if true then 1 else 2")).toEqual({ if: [true, 1, 2] }));
  it("nested if in else", () =>
    expect(parse("if a then 1 else if b then 2 else 3")).toEqual({
      if: [{ var: "a" }, 1, { if: [{ var: "b" }, 2, 3] }],
    }));
  it("call form: if cond then else (3 args, no keyword)", () =>
    expect(parse("if true 1 2")).toEqual({ if: [true, 1, 2] }));
  it("call form: if cond then (2 args)", () =>
    expect(parse("if true 1")).toEqual({ if: [true, 1] }));
  it("call form with parens for complex cond", () =>
    expect(parse("if (x > 0) 1 (-1)")).toEqual({
      if: [{ call: ["gt", { var: "x" }, 0] }, 1, { call: ["negate", 1] }],
    }));
  it("keyword form with complex cond still works", () =>
    expect(parse("if x > 0 then 1 else 2")).toEqual({
      if: [{ call: ["gt", { var: "x" }, 0] }, 1, 2],
    }));
});

describe("parse — call (juxtaposition)", () => {
  it("no args", () => expect(parse("f ()")).toEqual({ call: ["f"] }));
  it("one arg", () => expect(parse("f 1")).toEqual({ call: ["f", 1] }));
  it("two args", () => expect(parse("f 1 2")).toEqual({ call: ["f", 1, 2] }));
  it("three args", () => expect(parse("f 1 2 3")).toEqual({ call: ["f", 1, 2, 3] }));
  it("record arg replaces named-args form", () =>
    expect(parse("f { x = 1, y = 2 }")).toEqual({ call: ["f", { x: 1, y: 2 }] }));
  it("record call syntax", () =>
    expect(parse("f { a = 1 }")).toEqual({ call: ["f", { a: 1 }] }));
  it("dotted call", () =>
    expect(parse("math.add 1 2")).toEqual({ call: ["math.add", 1, 2] }));
  it("expr arg needs parens", () =>
    expect(parse("f (1 + 2)")).toEqual({ call: ["f", { call: ["add",1, 2] }] }));
  it("juxtaposed application is left-associative", () =>
    expect(parse("f g x")).toEqual({ call: ["f", { var: "g" }, { var: "x" }] }));
  it("partial application by under-arity", () =>
    expect(parse("add 10")).toEqual({ call: ["add", 10] }));
  it("apply a partial", () =>
    expect(parse("(add 10) 5")).toEqual({ apply: [{ call: ["add", 10] }, 5] }));
});

describe("parse — lambda", () => {
  it("single param", () =>
    expect(parse("\\x -> x")).toEqual({ fn: ["x", { var: "x" }] }));
  it("multi param", () =>
    expect(parse("\\x y -> x + y")).toEqual({
      fn: ["x", "y", { call: ["add",{ var: "x" }, { var: "y" }] }],
    }));
});

describe("parse — do", () => {
  it("single expr returns unwrapped", () =>
    expect(parse("do\n  42\nend")).toBe(42));
  it("multi expr", () =>
    expect(parse("do\n  1\n  2\nend")).toEqual({ do: [1, 2] }));
  it("with let", () =>
    expect(parse("do\n  let x = 1\n  x\nend")).toEqual({
      do: [{ let: { x: 1 } }, { var: "x" }],
    }));
  it("multi expr without `end` (layout-terminated)", () =>
    expect(parse("do\n  1\n  2")).toEqual({ do: [1, 2] }));
});

describe("evaluate — named-args reorder", () => {
  // The evaluator's `invokeFunction` reorders a single record arg into
  // positional form when the record's keys are all formal param names. These
  // tests exercise the runtime semantics — parser still produces the same
  // {call: [fn, {…record…}]} shape; the magic is in dispatch.
  function makeCtx() {
    const sub = (a: number, b: number) => a - b;
    const triple = (a: number, b: number, c: number) => `${a}-${b}-${c}`;
    return {
      getFunction: (name: string) => {
        if (name === "sub") return { id: "sub", params: [{ name: "a", label: Nothing, type: { $ref: "Number" }}, { name: "b", label: Nothing, type: { $ref: "Number" }}], returns: { $ref: "Number" } } as any;
        if (name === "triple") return { id: "triple", params: [{ name: "a", label: Nothing, type: { $ref: "Number" }}, { name: "b", label: Nothing, type: { $ref: "Number" }}, { name: "c", label: Nothing, type: { $ref: "Number" }}], returns: { $ref: "String" } } as any;
        if (name === "wrap") return { id: "wrap", params: [{ name: "r", label: Nothing, type: { $ref: "Number" }}], returns: { $ref: "Number" } } as any;
        return undefined;
      },
      natives: { sub, triple, wrap: (r: number) => r * 10 },
    } as any;
  }

  it("full named-args call reorders to positional", () => {
    const ctx = makeCtx();
    expect(evaluate({ call: ["sub", { b: 3, a: 10 }] }, {}, ctx)).toBe(7);
  });

  it("named-args field order doesn't matter", () => {
    const ctx = makeCtx();
    expect(evaluate({ call: ["triple", { c: 3, a: 1, b: 2 }] }, {}, ctx)).toBe("1-2-3");
  });

  it("trailing-missing named-arg yields a partial", () => {
    const ctx = makeCtx();
    const partial = evaluate({ call: ["sub", { a: 10 }] }, {}, ctx);
    expect(partial).toMatchObject({ __fenelPartial: true, arity: 2 });
    // Saturate the partial — should now compute 10 - 3 = 7.
    expect(evaluate({ apply: [partial, [3]] }, {}, ctx)).toBe(7);
  });

  it("non-trailing gap synthesizes a binding lambda", () => {
    const ctx = makeCtx();
    // triple takes (a, b, c). Provide a, c; b is the gap.
    const lambda = evaluate({ call: ["triple", { c: 3, a: 1 }] }, {}, ctx);
    expect(lambda).toMatchObject({ __fenelFn: true });
    // Saturate by providing the gap (b).
    expect(evaluate({ apply: [lambda, [2]] }, {}, ctx)).toBe("1-2-3");
  });

  it("non-matching keys stay a positional record literal", () => {
    const ctx = makeCtx();
    // wrap has one param `r` — record key `x` doesn't match, so it's a record
    // literal passed positionally. wrap's native multiplies its arg by 10;
    // here the arg is the record object itself, which JS coerces in `*` to
    // NaN. The point is just: the reorder did NOT happen.
    const result = evaluate({ call: ["wrap", { x: 5 }] }, {}, ctx);
    expect(Number.isNaN(result)).toBe(true);
  });

  it("a PARTIAL param-name overlap stays a positional record literal (field-identity Phase 4, D5 verdict)", () => {
    // The named-call boundary contract: a record arg is a NAMED CALL only when
    // EVERY key is a formal param name (the subset rule). A record that names
    // SOME params but carries other keys is inherently ambiguous at eval time
    // (it may be an ordinary record ARGUMENT whose keys coincide with formals
    // — the `f r = …` feature), so it stays a record literal; the brief's
    // "reject unknown arg spellings" diagnostic is type-directed work that
    // belongs to the Phase-5 typed codec (classify record-vs-named-call by the
    // arrow's declared domain), not to spelling heuristics here.
    const ctx = makeCtx();
    // sub takes (a, b): key `a` matches a formal, `typo` does not.
    const result = evaluate({ call: ["sub", { a: 10, typo: 3 }] }, {}, ctx);
    // No reorder: the record itself becomes the first positional arg. Since
    // `sub` has arity 2, the evaluator correctly returns a one-argument partial
    // before the native runs. Pinning the collected record itself proves that no
    // named-argument projection silently discarded the unknown key.
    expect(result).toMatchObject({
      __fenelPartial: true,
      arity: 2,
      collected: [{ a: 10, typo: 3 }],
    });
  });

  it("empty record arg stays positional", () => {
    const ctx = makeCtx();
    // sub takes (a, b). Empty record provided. Don't reorder (no keys).
    // Partial-app: 0 args, 2 expected.
    const partial = evaluate({ call: ["sub", {}] }, {}, ctx);
    expect(partial).toMatchObject({ __fenelPartial: true });
  });

  it("closure named-args reorder also works", () => {
    const fn = evaluate({ fn: ["a", "b", { call: ["sub", { var: "a" }, { var: "b" }] }] });
    const ctx = makeCtx();
    expect(evaluate({ apply: [fn, [{ b: 3, a: 10 }]] }, {}, ctx)).toBe(7);
  });
});

describe("parse — layout / implicit do", () => {
  it("single-expr function body stays unwrapped", () =>
    expect(parse("f x = x + 1")).toEqual({
      def: { name: "f", params: ["x"], body: { call: ["add", { var: "x" }, 1] } },
    }));

  it("multi-expr function body wraps in implicit do", () =>
    expect(parse("f x =\n  let y = x + 1\n  y * 2")).toEqual({
      def: {
        name: "f",
        params: ["x"],
        body: {
          do: [
            { let: { y: { call: ["add", { var: "x" }, 1] } } },
            { call: ["mul", { var: "y" }, 2] },
          ],
        },
      },
    }));

  it("explicit do/end inside function body still works", () =>
    expect(parse("f x =\n  do\n    let y = x + 1\n    y * 2\n  end")).toEqual({
      def: {
        name: "f",
        params: ["x"],
        body: {
          do: [
            { let: { y: { call: ["add", { var: "x" }, 1] } } },
            { call: ["mul", { var: "y" }, 2] },
          ],
        },
      },
    }));

  it("multi-line case arm body wraps in implicit do", () =>
    expect(parse(
      "case x of\n" +
      "  Nothing -> 0\n" +
      "  Just { value = b } ->\n" +
      "    foo b\n" +
      "    bar b"
    )).toEqual({
      match: [
        { var: "x" },
        { $tag: "Nothing" }, 0,
        { $tag: "Just", value: { $bind: "b" } },
        {
          do: [
            { call: ["foo", { var: "b" }] },
            { call: ["bar", { var: "b" }] },
          ],
        },
      ],
    }));

  it("case ends when next token drops below arm column", () =>
    expect(parse(
      "f x =\n" +
      "  case x of\n" +
      "    Foo -> 1\n" +
      "    Bar -> 2\n" +
      "  x"
    )).toEqual({
      def: {
        name: "f",
        params: ["x"],
        body: {
          do: [
            {
              match: [
                { var: "x" },
                { $tag: "Foo" }, 1,
                { $tag: "Bar" }, 2,
              ],
            },
            { var: "x" },
          ],
        },
      },
    }));

  it("multi-stmt if-then branch wraps in implicit do", () =>
    expect(parse(
      "f x =\n" +
      "  if x > 0 then\n" +
      "    let y = x * 2\n" +
      "    y + 1\n" +
      "  else 0"
    )).toEqual({
      def: {
        name: "f",
        params: ["x"],
        body: {
          if: [
            { call: ["gt", { var: "x" }, 0] },
            {
              do: [
                { let: { y: { call: ["mul", { var: "x" }, 2] } } },
                { call: ["add", { var: "y" }, 1] },
              ],
            },
            0,
          ],
        },
      },
    }));

  it("function body terminates at next top-level decl", () =>
    expect(parse(
      "f x =\n" +
      "  let y = 1\n" +
      "  y\n" +
      "g z = z"
    )).toEqual({
      program: [
        {
          def: {
            name: "f",
            params: ["x"],
            body: {
              do: [{ let: { y: 1 } }, { var: "y" }],
            },
          },
        },
        {
          def: {
            name: "g",
            params: ["z"],
            body: { var: "z" },
          },
        },
      ],
    }));
});

describe("parse — case/match", () => {
  it("value match with default", () =>
    expect(parse('case x of\n  1 -> "one"\n  2 -> "two"\n  _ -> "other"')).toEqual({
      match: [{ var: "x" }, 1, "one", 2, "two", "other"],
    }));
  it("string patterns", () =>
    expect(parse('case s of\n  "a" -> 1\n  "b" -> 2')).toEqual({
      match: [{ var: "s" }, "a", 1, "b", 2],
    }));
  it("bool pattern", () =>
    expect(parse("case b of\n  true -> 1\n  false -> 0")).toEqual({
      match: [{ var: "b" }, true, 1, false, 0],
    }));
  it("record pattern", () =>
    expect(parse('case r of\n  { ok = true } -> "yes"\n  _ -> "no"')).toEqual({
      match: [{ var: "r" }, { ok: true }, "yes", "no"],
    }));
  // fenel-surface-extensions Phase 1 Step 3 — positional patterns accept the `_`
  // wildcard AND literals in arg slots (`MyType _ _ 5` matches when the 3rd field
  // = 5). Already supported (no grammar add); the Fenel + TS parsers agree
  // byte-for-byte. Documented here as a round-trip pin.
  it("positional constructor pattern with `_` wildcards + a literal arg", () =>
    expect(
      parse("case x of\n  MyType _ _ 5 -> a\n  _ -> b"),
    ).toEqual({
      match: [
        { var: "x" },
        { $tag: "MyType", _0: "_", _1: "_", _2: 5 },
        { var: "a" },
        { var: "b" },
      ],
    }));
  // Regression: nested `case ... _ -> X end` inside a do block —
  // the default-arm break path didn't skip trailing newlines so
  // the closing `end` was left unconsumed and confused the outer
  // parser into "Unexpected end".
  it("default arm before `end` closes cleanly inside do", () =>
    expect(
      parse(
        "do\n  let r = case x of\n    Foo { v = a } -> a\n    _ -> 0\n  end\n  r\nend",
      ),
    ).toEqual({
      do: [
        {
          let: {
            r: {
              match: [
                { var: "x" },
                { $tag: "Foo", v: { $bind: "a" } },
                { var: "a" },
                0,
              ],
            },
          },
        },
        { var: "r" },
      ],
    }));
});

describe("evaluate — match strict-key-presence", () => {
  // Regression: matchPattern bound `$bind` patterns to `undefined` for
  // pattern keys missing from the scrutinee. That made
  // `case x of {$maybe: …} -> A | _ -> B` for `x = {$ref: "Bool"}`
  // take the `$maybe` arm (binding the absent field to undefined)
  // instead of the default. Now a pattern key that the scrutinee
  // doesn't carry fails the match outright.
  it("ADT discriminator: pattern with missing key fails the arm", () => {
    const result = evaluate({
      match: [
        { $ref: "Boolean" },
        { $maybe: { $bind: "inner" } }, "wrong-arm",
        { $refined: { base: { $bind: "b" } } }, "also-wrong",
        "_", "default-arm",
      ],
    });
    expect(result).toBe("default-arm");
  });
  it("matching tag-shaped scrutinees discriminates correctly", () => {
    const cases = [
      { scrutinee: { $tag: "Just", _0: 5 }, expected: 5 },
      { scrutinee: { $tag: "Nothing" }, expected: 0 },
    ];
    for (const { scrutinee, expected } of cases) {
      expect(
        evaluate({
          match: [
            scrutinee,
            { $tag: "Nothing" }, 0,
            { $tag: "Just", _0: { $bind: "v" } }, { var: "v" },
          ],
        }),
      ).toBe(expected);
    }
  });
});

describe("parse — pipe", () => {
  it("simple pipe", () =>
    expect(parse("x |> f")).toEqual({ "|>": [{ var: "x" }, { var: "f" }] }));
  it("chained pipe (left-assoc)", () =>
    expect(parse("x |> f |> g")).toEqual({
      "|>": [{ "|>": [{ var: "x" }, { var: "f" }] }, { var: "g" }],
    }));
});

describe("parse — record & list", () => {
  it("record", () =>
    expect(parse("{ a = 1, b = 2 }")).toEqual({ a: 1, b: 2 }));
  it("nested record", () =>
    expect(parse("{ a = { b = 1 } }")).toEqual({ a: { b: 1 } }));
  it("list", () => expect(parse("[1, 2, 3]")).toEqual([1, 2, 3]));
  it("empty list", () => expect(parse("[]")).toEqual([]));
  it("nested list", () => expect(parse("[[1], [2]]")).toEqual([[1], [2]]));
});

describe("parse — comments", () => {
  it("line comment", () => expect(parse("-- comment\n42")).toBe(42));
  it("inline comment before newline", () =>
    expect(parse("42 -- trailing")).toBe(42));
});

describe("parse — multiline program", () => {
  it("wraps in do", () =>
    expect(parse("let x = 1\nlet y = 2\nx + y")).toEqual({
      do: [
        { let: { x: 1 } },
        { let: { y: 2 } },
        { call: ["add",{ var: "x" }, { var: "y" }] },
      ],
    }));
});

describe("parse — type-definition surface (fenel-surface-extensions Phase 2, D-F)", () => {
  // Single-constructor SUGAR: a single-ctor type omits the repeated ctor head;
  // the ctor name DEFAULTS to the type name. The proof is byte-equivalence to
  // the de-sugared explicit form (NO new IR — buildCtor supplies the type name).
  it("single-ctor sugar (named fields) ≡ explicit", () =>
    expect(parse("MyType = x: String y: Number")).toEqual(
      parse("MyType = MyType x: String y: Number"),
    ));
  it("single-ctor sugar with type params ≡ explicit", () =>
    expect(parse("Functor f = map: String")).toEqual(
      parse("Functor f = Functor map: String"),
    ));
  // `:Type` anonymous positional field — leading `:` (no preceding ident) ⇒ an
  // auto-named `_<idx>` positional field (the newtype discriminant, D-F rule 1).
  it("`:Type` positional sugar ≡ bare positional (`Age = :Number`)", () =>
    expect(parse("Age = :Number")).toEqual(parse("Age = Age Number")));
  it("`:a :b` positional sugar ≡ explicit (`Pair a b = :a :b`)", () =>
    expect(parse("Pair a b = :a :b")).toEqual(parse("Pair a b = Pair a b")));
  // `:Type` positional fields also work inside an EXPLICIT ctor body.
  it("`:Type` field in an explicit ctor ≡ bare positional", () =>
    expect(parse("Box = Box :Number")).toEqual(parse("Box = Box Number")));
  it("positional origin carries the containing-list occurrence index", () => {
    const parsed = parse("Mixed = Mixed :Number named: String") as {
      type_def: { constructors: Array<{ fields: unknown[] }> };
    };
    expect(parsed.type_def.constructors[0]!.fields).toEqual([
      {
        name: "_0",
        key: { $tag: "PositionalField", index: 0 },
        label: Nothing,
        type: { $ref: "Number" },
      },
      { name: "named", label: Nothing, type: { $ref: "String" } },
    ]);
  });
  // The leading-`:` discriminant: a BARE `Age = Number` stays the alias/type-app
  // (a nullary ctor named `Number`), NOT a newtype — sub-rule 1, do NOT regress.
  it("bare `Age = Number` stays an alias (not a newtype)", () =>
    expect(parse("Age = Number")).toEqual({
      type_def: {
        name: "Age",
        constructors: [{ name: "Number", label: Nothing, fields: [] }],
      },
    }));
  // Explicit multi-ctor forms are UNCHANGED (the sugar arm is single-ctor only).
  it("explicit multi-ctor unchanged (`Color = Red | Blue`)", () =>
    expect(parse("Color = Red | Blue")).toEqual({
      type_def: {
        name: "Color",
        constructors: [
          { name: "Red", label: Nothing, fields: [] },
          { name: "Blue", label: Nothing, fields: [] },
        ],
      },
    }));
});

// modules-as-values Phase 2d (amending D-C): the annotation is `( Expr : Type )`
// — one colon, one parenthesised expression — and the type is always a
// FenelType (the legacy bare-string `::` form is gone; `::` is not syntax).
describe("parse — type annotation", () => {
  it("simple", () =>
    expect(parse("(x : String)")).toEqual({ ann: [{ var: "x" }, { $ref: "String" }] }));
  it("dotted type", () =>
    expect(parse("(x : Fenel.Type)")).toEqual({ ann: [{ var: "x" }, { $ref: "Fenel.Type" }] }));
  it("annotation on expression", () =>
    expect(parse("(1 + 2 : Number)")).toEqual({ ann: [{ call: ["add",1, 2] }, { $ref: "Number" }] }));
  it("`::` is rejected", () => {
    expect(() => parse("x :: String")).toThrow();
    expect(() => parse("(x :: String)")).toThrow();
  });
});

describe("parse — where clause", () => {
  it("single binding", () =>
    expect(parse("x + y where x = 1")).toEqual({
      where: [{ call: ["add",{ var: "x" }, { var: "y" }] }, { x: 1 }],
    }));
  it("multiple bindings (comma)", () =>
    expect(parse("x + y where x = 1, y = 2")).toEqual({
      where: [{ call: ["add",{ var: "x" }, { var: "y" }] }, { x: 1, y: 2 }],
    }));
  it("multiline bindings", () =>
    expect(parse("x + y where\n  x = 1\n  y = 2")).toEqual({
      where: [{ call: ["add",{ var: "x" }, { var: "y" }] }, { x: 1, y: 2 }],
    }));
  it("binding with expr", () =>
    expect(parse("total where total = a + b")).toEqual({
      where: [{ var: "total" }, { total: { call: ["add",{ var: "a" }, { var: "b" }] } }],
    }));
});

describe("parse — guards", () => {
  it("guarded arm", () =>
    expect(parse('case x of\n  n | n > 0 -> "pos"\n  _ -> "other"')).toEqual({
      match: [
        { var: "x" },
        { $guard: [{ $bind: "n" }, { call: ["gt",{ var: "n" }, 0] }] }, "pos",
        "other",
      ],
    }));
  it("guarded wildcard", () =>
    expect(parse('case x of\n  _ | x > 0 -> "pos"\n  _ -> "neg"')).toEqual({
      match: [
        { var: "x" },
        { $guard: ["_", { call: ["gt",{ var: "x" }, 0] }] }, "pos",
        "neg",
      ],
    }));
  it("mixed guarded and unguarded", () =>
    expect(parse('case s of\n  "vip" -> 100\n  n | n > 0 -> 50\n  _ -> 0')).toEqual({
      match: [
        { var: "s" },
        "vip", 100,
        { $guard: [{ $bind: "n" }, { call: ["gt",{ var: "n" }, 0] }] }, 50,
        0,
      ],
    }));
  it("pattern variable binding", () =>
    expect(parse('case x of\n  val -> val')).toEqual({
      match: [{ var: "x" }, { $bind: "val" }, { var: "val" }],
    }));
  it("structural binding", () =>
    expect(parse('case r of\n  { name = n } -> n')).toEqual({
      match: [{ var: "r" }, { name: { $bind: "n" } }, { var: "n" }],
    }));
});

describe("parse — localized keywords", () => {
  it("french keywords", () =>
    expect(parse("soit x = 5", "fr")).toEqual({ let: { x: 5 } }));
  it("french if/then/else", () =>
    expect(parse("si vrai alors 1 sinon 2", "fr")).toEqual({
      if: [{ var: "vrai" }, 1, 2],
    }));
  it("french boolean", () =>
    expect(parse("a et b ou c", "fr")).toEqual({
      call: ["or", { call: ["and", { var: "a" }, { var: "b" }] }, { var: "c" }],
    }));
  it("spanish keywords", () =>
    expect(parse("sea x = 10", "es")).toEqual({ let: { x: 10 } }));
  it("arabic keywords", () =>
    expect(parse("دع x = 7", "ar")).toEqual({ let: { x: 7 } }));
  it("mixed english in locale mode", () =>
    expect(parse("let x = 5", "fr")).toEqual({ let: { x: 5 } }));
  it("where in french", () =>
    expect(parse("x où x = 1", "fr")).toEqual({
      where: [{ var: "x" }, { x: 1 }],
    }));
});

describe("parse — string interpolation", () => {
  it("simple variable", () => {
    expect(parse("`hello ${name}`")).toEqual({ cat: ["hello ", { var: "name" }] });
  });
  it("multiple interpolations", () => {
    expect(parse("`${x} + ${y}`")).toEqual({ cat: [{ var: "x" }, " + ", { var: "y" }] });
  });
  it("expression interpolation", () => {
    expect(parse("`result: ${a + b}`")).toEqual({ cat: ["result: ", { call: ["add",{ var: "a" }, { var: "b" }] }] });
  });
  it("no interpolation → plain string", () => {
    expect(parse("`plain`")).toEqual("plain");
  });
  it("function call in interpolation", () => {
    expect(parse("`${greet(name)}`")).toEqual({ cat: [{ call: ["greet", { var: "name" }] }] });
  });
  it("escaped dollar sign", () => {
    expect(parse("`cost is \\${price}`")).toEqual("cost is ${price}");
  });
  it("record in interpolation", () => {
    expect(parse("`${f({ x = 1 })}`")).toEqual({ cat: [{ call: ["f", { x: 1 }] }] });
  });
});

describe("parse — errors", () => {
  it("unexpected char", () => expect(() => parse("@")).toThrow(ParseError));
  it("unexpected token", () => expect(() => parse(")")).toThrow(ParseError));
});

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

describe("print — literals", () => {
  it("number", () => expect(print(42 as any)).toBe("42"));
  it("string", () => expect(print("hello" as any)).toBe('"hello"'));
  it("bool", () => expect(print(true as any)).toBe("true"));
});

describe("print — variables", () => {
  it("simple", () => expect(print({ var: "x" } as any)).toBe("x"));
  it("dotted", () => expect(print({ var: "a.b" } as any)).toBe("a.b"));
});

describe("print — arithmetic", () => {
  it("add", () => expect(print({ call: ["add",1, 2] } as any)).toBe("1 + 2"));
  it("preserves precedence", () =>
    expect(print({ call: ["add",1, { call: ["mul",2, 3] }] } as any)).toBe("1 + 2 * 3"));
  it("adds parens when needed", () =>
    expect(print({ call: ["mul",{ call: ["add",1, 2] }, 3] } as any)).toBe("(1 + 2) * 3"));
  it("left assoc no redundant parens", () =>
    expect(print({ "-": [{ "-": [1, 2] }, 3] } as any)).toBe("1 - 2 - 3"));
  it("right-nested same op gets parens", () =>
    expect(print({ "-": [1, { "-": [2, 3] }] } as any)).toBe("1 - (2 - 3)"));
  it("unary minus", () =>
    expect(print({ "-": [{ var: "x" }] } as any)).toBe("-x"));
});

describe("print — boolean", () => {
  it("and", () =>
    expect(print({ call: ["and", { var: "a" }, { var: "b" }] } as any)).toBe("a and b"));
  it("or", () =>
    expect(print({ call: ["or", { var: "a" }, { var: "b" }] } as any)).toBe("a or b"));
  it("not", () =>
    expect(print({ "!": [{ var: "x" }] } as any)).toBe("not x"));
  it("precedence: or wraps and", () =>
    expect(print({ call: ["or", { var: "a" }, { call: ["and", { var: "b" }, { var: "c" }] }] } as any))
      .toBe("a or b and c"));
});

describe("print — let", () => {
  it("simple", () =>
    expect(print({ let: { x: 5 } } as any)).toBe("let x = 5"));
});

describe("print — if", () => {
  it("if then else", () =>
    expect(print({ if: [true, 1, 2] } as any)).toBe("if true then 1 else 2"));
  it("if then (no else)", () =>
    expect(print({ if: [true, 1] } as any)).toBe("if true then 1"));
});

describe("print — call (juxtaposition)", () => {
  it("no args", () =>
    expect(print({ call: ["f"] } as any)).toBe("f ()"));
  it("one arg", () =>
    expect(print({ call: ["f", 42] } as any)).toBe("f 42"));
  it("multi args", () =>
    expect(print({ call: ["f", 1, 2, 3] } as any)).toBe("f 1 2 3"));
  it("record-arg as named-fields shorthand", () =>
    expect(print({ call: ["f", { x: 1, y: 2 }] } as any)).toBe("f { x = 1, y = 2 }"));
  it("empty record arg", () =>
    expect(print({ call: ["f", {}] } as any)).toBe("f {}"));
});

describe("print — lambda", () => {
  it("single param", () =>
    expect(print({ fn: ["x", { var: "x" }] } as any)).toBe("\\x -> x"));
  it("multi param", () =>
    expect(print({ fn: ["x", "y", { call: ["add",{ var: "x" }, { var: "y" }] }] } as any))
      .toBe("\\x y -> x + y"));
});

describe("print — do", () => {
  it("multi expr", () =>
    expect(print({ do: [1, 2, 3] } as any)).toBe("do\n  1\n  2\n  3\nend"));
  it("empty", () =>
    expect(print({ do: [] } as any)).toBe("do\nend"));
});

describe("print — match", () => {
  it("with default", () =>
    expect(print({ match: [{ var: "x" }, 1, "one", "other"] } as any))
      .toBe('case x of\n  1 -> "one"\n  _ -> "other"'));
  it("no default", () =>
    expect(print({ match: [{ var: "x" }, "a", 1, "b", 2] } as any))
      .toBe('case x of\n  "a" -> 1\n  "b" -> 2'));
  it("wildcard pattern", () =>
    expect(print({ match: [{ var: "x" }, "_", "caught"] } as any))
      .toBe('case x of\n  _ -> "caught"'));
});

describe("print — record & list", () => {
  it("record", () =>
    expect(print({ a: 1, b: 2 } as any)).toBe("{ a = 1, b = 2 }"));
  it("list", () =>
    expect(print([1, 2, 3] as any)).toBe("[1, 2, 3]"));
  it("empty list", () =>
    expect(print([] as any)).toBe("[]"));
});

describe("print — type annotation", () => {
  it("simple", () =>
    expect(print({ ann: [{ var: "x" }, "String"] } as any)).toBe("(x : String)"));
  it("on expression", () =>
    expect(print({ ann: [{ call: ["add",1, 2] }, { $ref: "Number" }] } as any)).toBe("(1 + 2 : Number)"));
});

describe("print — where", () => {
  it("single binding", () =>
    expect(print({ where: [{ var: "x" }, { x: 1 }] } as any)).toBe("x where x = 1"));
  it("multiple bindings", () =>
    expect(print({ where: [{ call: ["add",{ var: "x" }, { var: "y" }] }, { x: 1, y: 2 }] } as any))
      .toBe("x + y where x = 1, y = 2"));
});

describe("print — guards", () => {
  it("guarded pattern", () =>
    expect(print({ match: [{ var: "x" }, { $guard: [{ $bind: "n" }, { call: ["gt",{ var: "n" }, 0] }] }, "pos", "other"] } as any))
      .toBe('case x of\n  n | n > 0 -> "pos"\n  _ -> "other"'));
  it("pattern variable", () =>
    expect(print({ match: [{ var: "x" }, { $bind: "val" }, { var: "val" }] } as any))
      .toBe('case x of\n  val -> val'));
});

describe("print — string interpolation", () => {
  it("simple cat", () => {
    expect(print({ cat: ["hello ", { var: "name" }] } as any)).toBe("`hello ${name}`");
  });
  it("multiple segments", () => {
    expect(print({ cat: [{ var: "x" }, " + ", { var: "y" }] } as any)).toBe("`${x} + ${y}`");
  });
  it("expression in cat", () => {
    expect(print({ cat: ["sum: ", { call: ["add",{ var: "a" }, { var: "b" }] }] } as any)).toBe("`sum: ${a + b}`");
  });
  it("escapes backtick in segment", () => {
    expect(print({ cat: ["a`b", { var: "x" }] } as any)).toBe("`a\\`b${x}`");
  });
  it("escapes dollar-brace in segment", () => {
    expect(print({ cat: ["a${b", { var: "x" }] } as any)).toBe("`a\\${b${x}`");
  });
});

describe("print — localized", () => {
  it("french keywords", () =>
    expect(print({ let: { x: 5 } } as any, "fr")).toBe("soit x = 5"));
  it("french if", () =>
    expect(print({ if: [true, 1, 2] } as any, "fr")).toBe("si true alors 1 sinon 2"));
  it("structural conjunction gaps are explicit in french too", () =>
    expect(print({ and: [{ var: "a" }, { var: "b" }] } as any, "fr"))
      .toBe("<no surface syntax: structural conjunctions outside flat refinement predicates>"));
  it("structural disjunction gaps are explicit in french too", () =>
    expect(print({ or: [{ var: "a" }, { var: "b" }] } as any, "fr"))
      .toBe("<no surface syntax: structural disjunctions>"));
  it("french where", () =>
    expect(print({ where: [{ var: "x" }, { x: 1 }] } as any, "fr")).toBe("x où x = 1"));
});

// ---------------------------------------------------------------------------
// Round-trip: parse(print(parse(src))) ≡ parse(src)
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("preserves carriage returns in quoted strings and template segments", () => {
    for (const value of ["a\rb\r\nc", { cat: ["a\r", { var: "x" }, "b\r\nc"] }]) {
      expect(parse(print(value))).toEqual(value);
    }
  }, 300_000);

  const cases = [
    "42",
    "3.14",
    '"hello"',
    '"escape\\n"',
    "true",
    "false",
    "x",
    "a.b.c",
    "1 + 2",
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "1 - 2 - 3",
    "x == 1",
    "x != y",
    "a and b",
    "a or b",
    "not x",
    "a or b and c",
    "f ()",
    "f 1",
    "f 1 2",
    "f { x = 1, y = 2 }",
    "\\x -> x",
    "\\x y -> x + y",
    "if true then 1 else 2",
    "if x then 1",
    "[1, 2, 3]",
    "[]",
    "{ a = 1, b = 2 }",
    "-x",
    "let x = 5",
    "(x : String)",
    "x + y where x = 1, y = 2",
    "`hello ${name}`",
    "`${x} + ${y}`",
    "`result: ${a + b}`",
  ];

  for (const src of cases) {
    it(`"${src}"`, () => {
      const ast = parse(src);
      const printed = print(ast);
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});

// ---------------------------------------------------------------------------
// ADT: Type definitions, constructors, patterns
// ---------------------------------------------------------------------------
describe("ADT — parse", () => {
  it("type def with no fields (no `type` keyword)", () => {
    expect(parse("Color = Red | Green | Blue")).toEqual({
      type_def: { name: "Color", constructors: [
        { name: "Red", label: Nothing, fields: [] },
        { name: "Green", label: Nothing, fields: [] },
        { name: "Blue", label: Nothing, fields: [] },
      ] },
    });
  });

  it("type def with named fields (no braces)", () => {
    expect(parse("Shape = Circle radius: Number | Rect width: Number height: Number")).toEqual({
      type_def: { name: "Shape", constructors: [
        { name: "Circle", label: Nothing, fields: [{ name: "radius", label: Nothing, type: { $ref: "Number" }}] },
        { name: "Rect", label: Nothing, fields: [{ name: "width", label: Nothing, type: { $ref: "Number" }}, { name: "height", label: Nothing, type: { $ref: "Number" }}] },
      ] },
    });
  });

  it("type def with positional payload", () => {
    expect(parse("Maybe<T> = Nothing | Some T")).toEqual({
      type_def: {
        name: "Maybe",
        params: ["T"],
        constructors: [
          { name: "Nothing", label: Nothing, fields: [] },
          { name: "Some", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "T" }}] },
        ],
      },
    });
  });

  it("type def Haskell-style with type params", () => {
    expect(parse("Either a b = Left a | Right b")).toEqual({
      type_def: {
        name: "Either",
        params: ["a", "b"],
        constructors: [
          { name: "Left", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "a" }}] },
          { name: "Right", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "b" }}] },
        ],
      },
    });
  });

  it("type def Haskell-style multi-arg constructor", () => {
    expect(parse("Pair a b = MkPair a b")).toEqual({
      type_def: {
        name: "Pair",
        params: ["a", "b"],
        constructors: [
          { name: "MkPair", label: Nothing, fields: [
            { name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "a" }},
            { name: "_1", key: { $tag: "PositionalField", index: 1 }, label: Nothing, type: { $var: "b" }},
          ] },
        ],
      },
    });
  });

  it("constructor expression no args", () => {
    expect(parse("Red")).toEqual({ construct: ["Red"] });
  });

  it("constructor expression with positional args (juxtaposition)", () => {
    expect(parse("Circle 5")).toEqual({ construct: ["Circle", 5] });
  });

  it("constructor expression with named-fields record", () => {
    expect(parse("Rect { width = 10, height = 20 }")).toEqual({
      construct: ["Rect", { width: 10, height: 20 }],
    });
  });

  it("constructor pattern in case", () => {
    const ast = parse("case s of\n  Circle { radius = r } -> r\n  _ -> 0");
    expect(ast).toEqual({
      match: [
        { var: "s" },
        { $tag: "Circle", radius: { $bind: "r" } }, { var: "r" },
        0,
      ],
    });
  });

  it("constructor pattern no fields", () => {
    const ast = parse("case c of\n  Red -> 1\n  _ -> 0");
    expect(ast).toEqual({
      match: [
        { var: "c" },
        { $tag: "Red" }, 1,
        0,
      ],
    });
  });

  it("positional constructor pattern (single arg)", () => {
    expect(parse("case x of\n  Just bot -> bot\n  _ -> 0")).toEqual({
      match: [
        { var: "x" },
        { $tag: "Just", _0: { $bind: "bot" } }, { var: "bot" },
        0,
      ],
    });
  });

  it("positional constructor pattern (multiple args)", () => {
    expect(parse("case xs of\n  Cons h t -> h\n  _ -> 0")).toEqual({
      match: [
        { var: "xs" },
        { $tag: "Cons", _0: { $bind: "h" }, _1: { $bind: "t" } }, { var: "h" },
        0,
      ],
    });
  });

  it("positional pattern with literal arg", () => {
    expect(parse("case x of\n  Just 5 -> 1\n  _ -> 0")).toEqual({
      match: [
        { var: "x" },
        { $tag: "Just", _0: 5 }, 1,
        0,
      ],
    });
  });

  it("positional pattern with parenthesized nested ctor", () => {
    expect(parse("case xs of\n  Cons (Just x) t -> x\n  _ -> 0")).toEqual({
      match: [
        { var: "xs" },
        { $tag: "Cons", _0: { $tag: "Just", _0: { $bind: "x" } }, _1: { $bind: "t" } },
        { var: "x" },
        0,
      ],
    });
  });

  it("named-field pattern still works (reorder/skip)", () => {
    expect(parse("case x of\n  Just { _0 = bot } -> bot\n  _ -> 0")).toEqual({
      match: [
        { var: "x" },
        { $tag: "Just", _0: { $bind: "bot" } }, { var: "bot" },
        0,
      ],
    });
  });
});

describe("ADT — print", () => {
  it("type def (no `type` keyword)", () => {
    expect(print({ type_def: { name: "Shape", constructors: [
      { name: "Circle", label: Nothing, fields: [{ name: "radius", label: Nothing, type: { $ref: "Number" }}] },
      { name: "Rect", label: Nothing, fields: [
        { name: "width", label: Nothing, type: { $ref: "Number" }},
        { name: "height", label: Nothing, type: { $ref: "Number" }},
      ] },
    ] } } as any)).toBe("Shape = Circle radius: Number | Rect width: Number height: Number");
  });

  it("constructor no args", () => {
    expect(print({ construct: ["Red"] } as any)).toBe("Red");
  });

  it("constructor named fields", () => {
    expect(print({ construct: ["Circle", { radius: 5 }] } as any)).toBe("Circle { radius = 5 }");
  });

  it("constructor positional args (juxtaposition)", () => {
    expect(print({ construct: ["Circle", 5] } as any)).toBe("Circle 5");
  });

  it("$tag pattern no fields", () => {
    expect(print({
      match: [{ var: "c" }, { $tag: "Red" }, 1, 0],
    })).toContain("Red -> 1");
  });

  it("$tag pattern with fields", () => {
    expect(print({
      match: [{ var: "s" }, { $tag: "Circle", radius: { $bind: "r" } }, { $bind: "r" }, 0],
    })).toContain("Circle { radius = r }");
  });
});

// ---------------------------------------------------------------------------
// Opaque-wrapped atoms: `opaque "<repr>" Name [params] = body`
//
// Atoms in Fenel are not primitive — they are constructor-built ADTs given a
// runtime-representation hint via the $opaque wrapper. The pure side is the
// language-conceptual definition (mathematical / type-theoretic); the repr
// is the runtime-native fast path. The parser keeps the AST-level type-def
// shape and annotates it with `opaque: { repr }`; the wrap to $opaque
// happens in `fenel-module.ts` when the type-def is materialized.
// ---------------------------------------------------------------------------

describe("opaque atom — parse", () => {
  it("non-parametric variant (Bool)", () => {
    expect(parse('opaque "boolean" Bool = True | False')).toEqual({
      type_def: {
        name: "Bool",
        constructors: [
          { name: "True", label: Nothing, fields: [] },
          { name: "False", label: Nothing, fields: [] },
        ],
        opaque: { repr: "boolean" },
      },
    });
  });

  it("non-parametric recursive variant (Nat)", () => {
    expect(parse('opaque "number" Nat = Zero | Succ pred: Nat')).toEqual({
      type_def: {
        name: "Nat",
        constructors: [
          { name: "Zero", label: Nothing, fields: [] },
          { name: "Succ", label: Nothing, fields: [{ name: "pred", label: Nothing, type: { $ref: "Nat" }}] },
        ],
        opaque: { repr: "number" },
      },
    });
  });

  it("non-parametric single-case variant (Int)", () => {
    expect(parse('opaque "number" Int = Int magnitude: Nat negative: Bool')).toEqual({
      type_def: {
        name: "Int",
        constructors: [
          { name: "Int", label: Nothing, fields: [
            { name: "magnitude", label: Nothing, type: { $ref: "Nat" }},
            { name: "negative", label: Nothing, type: { $ref: "Bool" }},
          ] },
        ],
        opaque: { repr: "number" },
      },
    });
  });

  it("parametric recursive (List a) — tail is a $ref self-reference", () => {
    // Phase 2.5: when the head ident matches the currently-parsing type-def
    // name, the parser emits `{$ref: "List"}` instead of lifting to the
    // inlined builtin shape. Lets `foundation.fenel`'s List declaration round-
    // trip against the canonical TS literal via substitute-then-compare.
    expect(parse('opaque "array" List a = Nil | Cons head: a tail: List a')).toEqual({
      type_def: {
        name: "List",
        params: ["a"],
        opaque: { repr: "array" },
        constructors: [
          { name: "Nil", label: Nothing, fields: [] },
          {
            name: "Cons",
            label: Nothing,
            fields: [
              { name: "head", label: Nothing, type: { $var: "a" }},
              { name: "tail", label: Nothing, type: { $ref: "List" }},
            ],
          },
        ],
      },
    });
  });

  it("non-self `List a` inside an unrelated type-def still lifts to the builtin", () => {
    // Negative regression for the Phase 2.5 self-ref fix. The selfName
    // tracking is per-type-def: inside `Foo a = ...`, `selfName === "Foo"`,
    // so `List a` in a field position still resolves through the existing
    // builtin lift and emits the full $opaque/$mu shape.
    const ast = parse('Foo a = Bar (List a) | Baz a') as {
      type_def: {
        constructors: Array<{ name: string; fields: Array<{ name: string; type: unknown }> }>;
      };
    };
    const barInnerType = ast.type_def.constructors[0]!.fields[0]!.type as {
      $opaque?: { name?: string; pure?: unknown };
    };
    expect(barInnerType.$opaque).toBeDefined();
    expect(barInnerType.$opaque!.name).toBe("List");
    // representation-substrate Phase 5a — `repr` retired; the lifted List is
    // identified by `name` + its cons-spine `pure`, not the decorative string.
    expect(barInnerType.$opaque!.pure).toBeDefined();
  });

  it("`opaque` as a regular ident still parses", () => {
    // Contextual keyword: `opaque "..." Uppercase` triggers the new path;
    // anywhere else `opaque` stays an ordinary ident. A def whose name
    // happens to be `opaque` must still work.
    expect(parse("opaque = 5")).toEqual({
      def: { name: "opaque", params: [], body: 5 },
    });
  });
});

describe("opaque atom — print", () => {
  it("non-parametric variant (Bool)", () => {
    expect(print({
      type_def: {
        name: "Bool",
        constructors: [
          { name: "True", label: Nothing, fields: [] },
          { name: "False", label: Nothing, fields: [] },
        ],
        opaque: { repr: "boolean" },
      },
    } as any)).toBe('opaque "boolean" Bool = True | False');
  });

  it("non-parametric recursive (Nat)", () => {
    expect(print({
      type_def: {
        name: "Nat",
        constructors: [
          { name: "Zero", label: Nothing, fields: [] },
          { name: "Succ", label: Nothing, fields: [{ name: "pred", label: Nothing, type: { $ref: "Nat" }}] },
        ],
        opaque: { repr: "number" },
      },
    } as any)).toBe('opaque "number" Nat = Zero | Succ pred: Nat');
  });

  it("non-parametric single-case (Int)", () => {
    expect(print({
      type_def: {
        name: "Int",
        constructors: [
          { name: "Int", label: Nothing, fields: [
            { name: "magnitude", label: Nothing, type: { $ref: "Nat" }},
            { name: "negative", label: Nothing, type: { $ref: "Bool" }},
          ] },
        ],
        opaque: { repr: "number" },
      },
    } as any)).toBe('opaque "number" Int = Int magnitude: Nat negative: Bool');
  });
});

describe("opaque atom — round-trip", () => {
  const cases = [
    'opaque "boolean" Bool = True | False',
    'opaque "number" Nat = Zero | Succ pred: Nat',
    'opaque "number" Int = Int magnitude: Nat negative: Bool',
  ];
  for (const src of cases) {
    it(`"${src}"`, () => {
      const ast = parse(src);
      const printed = print(ast);
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});

// ---------------------------------------------------------------------------
// read(T) expressions
// ---------------------------------------------------------------------------
describe("read(T) — parse", () => {
  it("read(String)", () => {
    expect(parse("read(String)")).toEqual({
      call: ["read", { schema: { type: "string" } }],
    });
  });

  it("read(Number)", () => {
    expect(parse("read(Number)")).toEqual({
      call: ["read", { schema: { type: "number" } }],
    });
  });

  it("read(String{email})", () => {
    expect(parse("read(String{email})")).toEqual({
      call: ["read", { schema: { type: "string", set: { $ref: "format:email" } } }],
    });
  });

  it("read(Number[0..100])", () => {
    expect(parse("read(Number[0..100])")).toEqual({
      call: ["read", { schema: { type: "number", set: { $interval: [0, 100] } } }],
    });
  });

  it("read(String at \"form\")", () => {
    expect(parse('read(String at "form")')).toEqual({
      call: ["read", { schema: { type: "string" }, source: "form" }],
    });
  });

  it("read({ name: String, age: Number })", () => {
    expect(parse("read({ name: String, age: Number })")).toEqual({
      call: ["read", { schema: { type: "record", fields: [
        { name: "name", schema: { type: "string" } },
        { name: "age", schema: { type: "number" } },
      ] } }],
    });
  });
});

describe("read(T) — print", () => {
  it("read(String)", () => {
    expect(print({ call: ["read", { schema: { type: "string" } }] })).toBe("read(String)");
  });

  it("read(String{email})", () => {
    expect(print({ call: ["read", { schema: { type: "string", set: { $ref: "format:email" } } }] })).toBe("read(String{email})");
  });

  it("read(Number[0..100])", () => {
    expect(print({ call: ["read", { schema: { type: "number", set: { $interval: [0, 100] } } }] })).toBe("read(Number[0..100])");
  });

  it("read(String at \"form\")", () => {
    expect(print({ call: ["read", { schema: { type: "string" }, source: "form" }] })).toBe('read(String at "form")');
  });

  it("read({ name: String, age: Number })", () => {
    expect(print({ call: ["read", { schema: { type: "record", fields: [
      { name: "name", schema: { type: "string" } },
      { name: "age", schema: { type: "number" } },
    ] } }] })).toBe("read({ name: String, age: Number })");
  });
});

describe("read(T) — round-trip", () => {
  const cases = [
    "read(String)",
    "read(Number)",
    'read(String at "form")',
    "read(String{email})",
    "read(Number[0..100])",
    "read({ name: String, age: Number })",
  ];
  for (const src of cases) {
    it(`"${src}"`, () => {
      const ast = parse(src);
      const printed = print(ast);
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});

describe("ADT — evaluate", () => {

  it("construct creates tagged value", () => {
    expect(evaluate({ construct: ["Red"] })).toEqual({ $tag: "Red" });
  });

  it("construct with named fields", () => {
    expect(evaluate({ construct: ["Circle", { radius: 5 }] })).toEqual({ $tag: "Circle", radius: 5 });
  });

  it("construct evaluates field expressions", () => {
    expect(evaluate({ construct: ["Circle", { radius: { call: ["add",2, 3] } }] })).toEqual({ $tag: "Circle", radius: 5 });
  });

  it("type_def registers constructors, positional construct uses _N keys (Phase 10a-6)", () => {
    const ctx = { _constructors: {} } as any;
    evaluate({ type_def: { name: "Shape", constructors: [
      { name: "Circle", label: Nothing, fields: [{ name: "radius", label: Nothing, type: "Number"}] },
    ] } }, {}, ctx);
    expect(evaluate({ construct: ["Circle", 5] }, {}, ctx)).toEqual({ $tag: "Circle", _0: 5 });
  });

  it("match on tagged values", () => {
    const result = evaluate(
      { match: [{ var: "s" }, { $tag: "Circle", radius: { $bind: "r" } }, { var: "r" }, 0] },
      { s: { $tag: "Circle", radius: 42 } },
    );
    expect(result).toBe(42);
  });

  it("match tag mismatch falls through", () => {
    const result = evaluate(
      { match: [{ var: "s" }, { $tag: "Circle", radius: { $bind: "r" } }, { var: "r" }, -1] },
      { s: { $tag: "Rect", width: 10, height: 20 } },
    );
    expect(result).toBe(-1);
  });

  it("tagged values are self-evaluating", () => {
    expect(evaluate({ $tag: "Red" })).toEqual({ $tag: "Red" });
    expect(evaluate({ $tag: "Circle", radius: 5 })).toEqual({ $tag: "Circle", radius: 5 });
  });
});

// ---------------------------------------------------------------------------
// New syntax: type expressions, top-level defs, fixity, op-as-function
// ---------------------------------------------------------------------------

describe("type expressions — parse", () => {
  it("named atom", () =>
    expect((parse("(x : Number)") as any).ann[1]).toEqual({ $ref: "Number" }));

  it("arrow", () =>
    expect((parse("f : Number -> Number") as any).type_sig.type)
      .toEqual({ $arrow: { params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, ui: Nothing, meta: {} }], returns: { $ref: "Number" } } }));

  it("multi-param arrow with names", () =>
    expect((parse("f : (x: Number, y: Number) -> Number") as any).type_sig.type)
      .toEqual({
        $arrow: {
          params: [
            { name: "x", label: Nothing, type: { $ref: "Number" }, ui: Nothing },
            { name: "y", label: Nothing, type: { $ref: "Number" }, ui: Nothing },
          ],
          returns: { $ref: "Number" },
        },
      }));

  it("list sugar", () =>
    expect((parse("xs : [Number]") as any).type_sig.type)
      .toEqual(List({ $ref: "Number" })));

  it("Maybe<T>", () =>
    expect((parse("m : Maybe<String>") as any).type_sig.type)
      .toEqual(Maybe({ $ref: "String" })));

  it("List<T>", () =>
    expect((parse("xs : List<Number>") as any).type_sig.type)
      .toEqual(List({ $ref: "Number" })));

  it("record type", () =>
    // `meta: {}` is the canonical empty FieldMetadata absence-marker every other
    // FieldDef carries — the inline-record-type sig parser now emits it too
    // (module-substrate 3o.1 Surprise #37 fix; previously omitted, which blocked
    // migrating inline-record-returning fns like `telegram:parseCommand`).
    expect((parse("p : { x: Number, y: Number }") as any).type_sig.type)
      .toEqual({
        $record: {
          fields: [
            { name: "x", label: Nothing, type: { $ref: "Number" }, ui: Nothing, meta: {} },
            { name: "y", label: Nothing, type: { $ref: "Number" }, ui: Nothing, meta: {} },
          ],
        },
      }));

  it("refinement", () =>
    expect((parse("n : Number where value > 0") as any).type_sig.type)
      .toEqual({
        $refined: {
          base: { $ref: "Number" },
          set: { $where: { call: ["gt",{ var: "value" }, 0] } },
        },
      }));

  it("Tagged<T, P>", () =>
    expect((parse('id : Tagged<UUID, "user">') as any).type_sig.type)
      .toEqual({
        $tagged: {
          value: { $ref: "UUID" },
          phantom: { $literal: "user" },
        },
      }));

  it("higher-order arrow", () =>
    expect((parse("m : (Number -> Bool) -> [Number] -> [Number]") as any).type_sig.type)
      .toEqual({
        $arrow: {
          params: [{
            name: "_0",
            key: { $tag: "PositionalField", index: 0 },
            label: Nothing,
            type: {
              $arrow: {
                params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, ui: Nothing, meta: {} }],
                returns: { $ref: "Bool" },
              },
            },
            ui: Nothing,
            meta: {},
          }],
          returns: {
            $arrow: {
              params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: List({ $ref: "Number" }), ui: Nothing, meta: {} }],
              returns: List({ $ref: "Number" }),
            },
          },
        },
      }));
});

describe("top-level — parse", () => {
  it("function def", () =>
    expect(parse("addOne x = x + 1")).toEqual({
      def: { name: "addOne", params: ["x"], body: { call: ["add",{ var: "x" }, 1] } },
    }));

  it("multi-param function def", () =>
    expect(parse("add x y = x + y")).toEqual({
      def: { name: "add", params: ["x", "y"], body: { call: ["add",{ var: "x" }, { var: "y" }] } },
    }));

  it("type sig", () =>
    expect(parse("addOne : Number -> Number")).toEqual({
      type_sig: {
        name: "addOne",
        type: { $arrow: { params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }], returns: { $ref: "Number" } } },
      },
    }));

  it("type sig + def together emit a program", () =>
    expect(parse("addOne : Number -> Number\naddOne x = x + 1")).toEqual({
      program: [
        {
          type_sig: {
            name: "addOne",
            type: { $arrow: { params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }], returns: { $ref: "Number" } } },
          },
        },
        { def: { name: "addOne", params: ["x"], body: { call: ["add",{ var: "x" }, 1] } } },
      ],
    }));

  it("fixity declaration", () =>
    expect(parse("infixl 6 +")).toEqual({
      fixity: { op: "+", assoc: "l", prec: 6 },
    }));
});

describe("operators as functions — parse", () => {
  it("(+) prefix form is a lambda", () =>
    expect(parse("(+)")).toEqual({
      fn: ["a", "b", { call: ["add",{ var: "a" }, { var: "b" }] }],
    }));

  it("(+) applied as a function", () =>
    expect(parse("(+) 2 3")).toEqual({
      apply: [
        { fn: ["a", "b", { call: ["add",{ var: "a" }, { var: "b" }] }] },
        2,
        3,
      ],
    }));
});

describe("custom operator definitions — parse", () => {
  it("(.) defining function composition", () =>
    expect(parse("(.) f g = \\x -> f (g x)")).toEqual({
      def: {
        name: ".",
        params: ["f", "g"],
        body: { fn: ["x", { call: ["f", { call: ["g", { var: "x" }] }] }] },
      },
    }));

  it("(.) type signature", () =>
    expect(parse("(.) : (b -> c) -> (a -> b) -> (a -> c)")).toEqual({
      type_sig: {
        name: ".",
        type: {
          $arrow: {
            params: [{
              name: "_0",
              key: { $tag: "PositionalField", index: 0 },
              label: Nothing,
              meta: {},
              ui: Nothing,
              type: {
                $arrow: {
                  params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "b" }, meta: {}, ui: Nothing }],
                  returns: { $var: "c" },
                },
              },
            }],
            returns: {
              $arrow: {
                params: [{
                  name: "_0",
                  key: { $tag: "PositionalField", index: 0 },
                  label: Nothing,
                  meta: {},
                  ui: Nothing,
                  type: {
                    $arrow: {
                      params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "a" }, meta: {}, ui: Nothing }],
                      returns: { $var: "b" },
                    },
                  },
                }],
                returns: {
                  $arrow: {
                    params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "a" }, meta: {}, ui: Nothing }],
                    returns: { $var: "c" },
                  },
                },
              },
            },
          },
        },
      },
    }));
});

describe(". composition vs dotted-ident", () => {
  it("a.b.c (no spaces) is a single dotted ident", () =>
    expect(parse("a.b.c")).toEqual({ var: "a.b.c" }));

  it("a . b (with spaces) is composition", () =>
    expect(parse("addOne . double")).toEqual({
      call: [".", { var: "addOne" }, { var: "double" }],
    }));

  it("mixed: a.b . c.d (record access then composition)", () =>
    expect(parse("a.b . c.d")).toEqual({
      call: [".", { var: "a.b" }, { var: "c.d" }],
    }));
});

describe("var → function-reference fallthrough", () => {
  it("bare ident referring to a registered fn resolves to its canonical Ref value", async () => {
    const ctx = await sharedSyntaxStdContext();
    // Typed-function-references retired the old bare-name string fallback.
    expect(evaluate({ var: "abs" }, {}, ctx)).toEqual({ $ref: "std:abs" });
  }, 60_000);

  it("non-registered idents still return null", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(evaluate({ var: "nonexistent_xyz" }, {}, ctx)).toBe(null);
  });

  it("data-context shadows the registry", async () => {
    const ctx = await sharedSyntaxStdContext();
    // local `abs` is 99; registry has `abs` too — local wins
    expect(evaluate({ var: "abs" }, { abs: 99 }, ctx)).toBe(99);
  });
});

describe("std operator functions — runtime", () => {
  it("(.) composes two callables", async () => {
    const ctx = await sharedSyntaxStdContext();
    // (add 1 . mul 2) 5 = add(1, mul(2, 5)) = add(1, 10) = 11
    expect(evaluate(parse("(add 1 . mul 2) 5"), {}, ctx)).toBe(11);
  });

  it("($) is reverse function application", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(evaluate(parse("abs $ -5"), {}, ctx)).toBe(5);
  });

  it("(.) chains with . right-associativity", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(evaluate(parse("((add 1) . (mul 2) . abs) (-3)"), {}, ctx)).toBe(7);
  });

  it("(.) interoperates with |> and map", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(evaluate(parse("[1, 2, 3] |> map (add 1 . mul 2)"), {}, ctx)).toEqual([3, 5, 7]);
  });
});

// Regression: positional construction of foundation-type variants
// (Result / Maybe). These constructors live in `systemEntities`, not in
// any module; before this fix, `createRegistry` only walked `mod.entities`
// so `_constructors["Err"]` was undefined and `Err err` fell into the
// legacy "spread args[1] as named record" path, producing
// `{$tag: "Err", var: "err"}` instead of `{$tag: "Err", _0: <err>}`.
describe("foundation-type constructors are positionally applicable", () => {
  it("Err <varref> evaluates the var and wraps as { $tag: 'Err', value }", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(
      evaluate({ construct: ["Err", { var: "msg" }] }, { msg: "boom" }, ctx),
    ).toEqual({ $tag: "Err", _0: "boom" });
  });

  it("Ok <varref> evaluates the var and wraps as { $tag: 'Ok', value }", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(
      evaluate({ construct: ["Ok", { var: "id" }] }, { id: "abc-123" }, ctx),
    ).toEqual({ $tag: "Ok", _0: "abc-123" });
  });

  it("Just <varref> evaluates the var and wraps as { $tag: 'Just', value }", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(
      evaluate({ construct: ["Just", { var: "x" }] }, { x: 42 }, ctx),
    ).toEqual({ $tag: "Just", _0: 42 });
  });

  it("Nothing constructs with no payload", async () => {
    const ctx = await sharedSyntaxStdContext();
    expect(evaluate({ construct: ["Nothing"] }, {}, ctx)).toEqual({ $tag: "Nothing" });
  });

  it("Err <dotted-path varref> evaluates field access correctly", async () => {
    // Mirrors the runTelegramCollector failure mode: `Err create.error`
    // where `create` is a bound record with an `error` field.
    const ctx = await sharedSyntaxStdContext();
    expect(
      evaluate(
        { construct: ["Err", { var: "create.error" }] },
        { create: { ok: false, error: "validation failed" } },
        ctx,
      ),
    ).toEqual({ $tag: "Err", _0: "validation failed" });
  });
});

describe("`in` operator — parse", () => {
  it("value in list", () =>
    expect(parse("x in [1, 2, 3]")).toEqual({
      in: [{ var: "x" }, [1, 2, 3]],
    }));

  it("evaluates correctly", () => {
    expect(evaluate({ in: [2, [1, 2, 3]] })).toBe(true);
    expect(evaluate({ in: [9, [1, 2, 3]] })).toBe(false);
  });
});

describe("backtick infix — parse", () => {
  it("named function used infix", () =>
    expect(parse("x `add` y")).toEqual({
      call: ["add", { var: "x" }, { var: "y" }],
    }));

  it("backtick after expression closer", () =>
    expect(parse("(1 + 2) `mul` 3")).toEqual({
      call: ["mul", { call: ["add",1, 2] }, 3],
    }));

  it("template string still works in primary position", () =>
    expect(parse("`hello ${name}`"))
      .toEqual({ cat: ["hello ", { var: "name" }] }));

  it("template string with no interpolation in primary position", () =>
    expect(parse("`plain`")).toEqual("plain"));
});

describe("pipe — parse (general RHS)", () => {
  it("pipe to bare ident", () =>
    expect(parse("x |> f")).toEqual({ "|>": [{ var: "x" }, { var: "f" }] }));

  it("pipe to a partial-application", () =>
    expect(parse("xs |> filter (gt 0)")).toEqual({
      "|>": [{ var: "xs" }, { call: ["filter", { call: ["gt", 0] }] }],
    }));

  it("chained pipe with partials", () =>
    expect(parse("xs |> map double |> filter pos")).toEqual({
      "|>": [
        { "|>": [{ var: "xs" }, { call: ["map", { var: "double" }] }] },
        { call: ["filter", { var: "pos" }] },
      ],
    }));

  it("evaluates: x |> f === f(x)", () => {
    const result = evaluate(
      { "|>": [5, { fn: [["x"], { call: ["add",{ var: "x" }, 1] }] }] },
    );
    expect(result).toBe(6);
  });
});

describe("type expressions — print", () => {
  describe("refined field and parameter grouping", () => {
    // C1: pin the source printer against independently parsed source trees.
    // A refinement must end before the comma introducing its neighbour.
    const cases = [
      ["record field before another field",
        "sample : { count: (Number where value > 0), label: String }",
        "sample : { count: (Number where value > 0), label: String }"],
      ["nested record field",
        "sample : { nested: { count: (Number where value > 0), label: String }, enabled: Boolean }",
        "sample : { nested: { count: (Number where value > 0), label: String }, enabled: Boolean }"],
      ["record field with multiple predicates",
        "sample : { count: (Number where value > 0 and value < 10), label: String }",
        "sample : { count: (Number where value > 0 and value < 10), label: String }"],
      ["named arrow parameter before another parameter",
        "sample : (count: (Number where value > 0), label: String) -> Boolean",
        "sample : (count: (Number where value > 0), label: String) -> Boolean"],
      ["named arrow parameter with multiple predicates",
        "sample : (count: (Number where value > 0 and value < 10), label: String) -> Boolean",
        "sample : (count: (Number where value > 0 and value < 10), label: String) -> Boolean"],
      ["record containing a named arrow with a refined parameter",
        "sample : { check: ((count: (Number where value > 0), label: String) -> Boolean), enabled: Boolean }",
        "sample : { check: ((count: (Number where value > 0), label: String) -> Boolean), enabled: Boolean }"],
      ["refined tuple item before another item",
        "sample : ((Number where value > 0), String)",
        "sample : ((Number where value > 0), String)"],
      ["tuple item with multiple predicates",
        "sample : ((Number where value > 0 and value < 10), String)",
        "sample : ((Number where value > 0 and value < 10), String)"],
    ] as const;
    for (const [label, source, expected] of cases) {
      it(label, () => {
        const original = parseRaw(source);
        const printed = print(original);
        expect(printed).toBe(expected);
        const reparsed = parseRaw(printed);
        expect(reparsed).toEqual(original);
        expect(print(reparsed)).toBe(printed);
      }, 60_000);
    }
  });

  it("arrow", () =>
    expect(print({
      type_sig: {
        name: "addOne",
        label: Nothing,
        type: { $arrow: { params: [{ name: "_0", label: Nothing, type: { $ref: "Number" }}], returns: { $ref: "Number" } } },
      },
    } as any)).toBe("addOne : Number -> Number"));

  it("named param arrow", () =>
    expect(print({
      type_sig: {
        name: "add",
        label: Nothing,
        type: {
          $arrow: {
            params: [
              { name: "x", label: Nothing, type: { $ref: "Number" }},
              { name: "y", label: Nothing, type: { $ref: "Number" }},
            ],
            returns: { $ref: "Number" },
          },
        },
      },
    } as any)).toBe("add : (x: Number, y: Number) -> Number"));

  // `peelList` / `peelMaybe` see through `$opaque` / `$variant` wrappers and
  // recover the surface syntax (`[T]`, `Maybe T` — juxtaposition since
  // modules-as-values Phase 2d, so nested generics never print `>>`).
  it("list", () =>
    expect(print({
      type_sig: { name: "xs", label: Nothing, type: List({ $ref: "Number" })},
    } as any)).toBe("xs : [Number]"));

  it("Maybe T", () =>
    expect(print({
      type_sig: { name: "m", label: Nothing, type: Maybe({ $ref: "String" })},
    } as any)).toBe("m : Maybe String"));

  it("refinement", () =>
    expect(print({
      type_sig: {
        name: "n",
        label: Nothing,
        type: {
          $refined: {
            base: { $ref: "Number" },
            set: { $where: { call: ["gt",{ var: "value" }, 0] } },
          },
        },
      },
    } as any)).toBe("n : Number where value > 0"));

  describe("exact structural-sugar probe routing", () => {
    const sourceArrow = {
      $arrow: {
        params: [{ name: "value", label: Nothing, type: { $ref: "String" } }],
        returns: { $ref: "String" },
      },
    };

    it("prints a tagged source arrow through the direct Tagged arm", () => {
      expect(print({
        $tagged: {
          value: sourceArrow,
          phantom: { $ref: "Marker" },
        },
      } as any)).toBe("Tagged ((value: String) -> String) Marker");
    });

    it("prints a refined source arrow through the direct Refined arm", () => {
      expect(print({
        $refined: {
          base: sourceArrow,
          set: { $tag: "SeAll" },
        },
      } as any)).toBe("(value: String) -> String where true");
    });

    it("does not observe a hostile opaque pure slot when printing its direct name", () => {
      const opaque: Record<string, unknown> = { name: "OpaqueDirect" };
      Object.defineProperty(opaque, "pure", {
        enumerable: true,
        get() {
          throw new Error("opaque pure must stay unobserved");
        },
      });
      expect(print({ $opaque: opaque } as any)).toBe("OpaqueDirect");
    });

    it("does not mistake a source-named Nothing/Just variant for canonical Maybe", () => {
      const ordinaryVariant = {
        $variant: {
          cases: [
            { name: "Nothing", label: Nothing },
            {
              name: "Just",
              label: Nothing,
              fields: [{ name: "value", label: Nothing, type: { $ref: "String" } }],
            },
          ],
        },
      };
      expect(print(ordinaryVariant as any)).toBe(JSON.stringify(ordinaryVariant));
    });

    it("keeps identity-total rejection for a genuine Maybe candidate", () => {
      const invalidNestedCandidate = {
        $variant: {
          cases: [
            { name: "Nothing", label: Nothing },
            {
              name: "Just",
              label: Nothing,
              fields: [{
                name: "_0",
                key: { $tag: "PositionalField", index: 0 },
                label: Nothing,
                type: sourceArrow,
              }],
            },
          ],
        },
      };
      expect(() => print(invalidNestedCandidate as any)).toThrow(
        "field-identity semantic boundary",
      );
    });
  });
});

describe("top-level — print", () => {
  it("function def", () =>
    expect(print({
      def: { name: "addOne", params: ["x"], body: { call: ["add",{ var: "x" }, 1] } },
    } as any)).toBe("addOne x = x + 1"));

  it("type def (no `type` keyword)", () =>
    expect(print({
      type_def: {
        name: "Maybe",
        params: ["T"],
        constructors: [
          { name: "Nothing", label: Nothing, fields: [] },
          { name: "Some", label: Nothing, fields: [{ name: "_0", label: Nothing, type: { $ref: "T" }}] },
        ],
      },
    } as any)).toBe("Maybe T = Nothing | Some T"));

  it("fixity decl", () =>
    expect(print({ fixity: { op: "+", assoc: "l", prec: 6 } } as any)).toBe("infixl 6 +"));

  it("program with multiple decls", () =>
    expect(print({
      program: [
        {
          type_sig: {
            name: "addOne",
            label: Nothing,
            type: { $arrow: { params: [{ name: "_0", label: Nothing, type: { $ref: "Number" }}], returns: { $ref: "Number" } } },
          },
        },
        { def: { name: "addOne", params: ["x"], body: { call: ["add",{ var: "x" }, 1] } } },
      ],
    } as any)).toBe("addOne : Number -> Number\n\naddOne x = x + 1"));
});

describe("round-trip — new syntax", () => {
  const cases = [
    "addOne x = x + 1",
    "add x y = x + y",
    "addOne : Number -> Number",
    "add : (x: Number, y: Number) -> Number",
    "xs : [Number]",
    "m : Maybe<String>",
    "n : Number where value > 0",
    "Color = Red | Green | Blue",
    "Maybe<T> = Nothing | Some T",
    "Either a b = Left a | Right b",
    "Pair a b = MkPair a b",
    "infixl 6 +",
    "f 1 2",
    "f ()",
    "x |> f",
    "x |> f |> g",
    "addOne . double",
    "x in [1, 2, 3]",
    "a.b.c",
    "x `add` y",
  ];
  for (const src of cases) {
    it(`"${src}"`, () => {
      const ast = parse(src);
      const printed = print(ast);
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 1: Idris-style data declarations + type-app juxtaposition + `|`
// refinements. The new syntax parses to the unified `$el { call: ... }`
// substrate for both value-level args (`Vec 3 String`) and pure
// type-level applications (`Vec n a`). The `$app` constructor was retired
// in Phase 1 of typeclass-substrate-completion.
// ---------------------------------------------------------------------------

describe("Phase 1 — `|` refinement at the top level", () => {
  it("Email = String | isValidEmail (bare-ident shorthand)", () => {
    expect(parse("Email = String | isValidEmail")).toEqual({
      type_def: {
        name: "Email",
        refined: {
          $refined: {
            base: { $ref: "String" },
            set: { $where: { call: ["isValidEmail", { var: "value" }] } },
          },
        },
      },
    });
  });

  it("Port = Number | value > 0 (explicit value)", () => {
    expect(parse("Port = Number | value > 0")).toEqual({
      type_def: {
        name: "Port",
        refined: {
          $refined: {
            base: { $ref: "Number" },
            set: { $where: { call: ["gt", { var: "value" }, 0] } },
          },
        },
      },
    });
  });

  it("ADT alternation still wins over refinement (uppercase RHS)", () => {
    // Color = Red | Green is an ADT, not a refinement, because Green is uppercase.
    expect(parse("Color = Red | Green")).toEqual({
      type_def: {
        name: "Color",
        constructors: [
          { name: "Red", label: Nothing, fields: [] },
          { name: "Green", label: Nothing, fields: [] },
        ],
      },
    });
  });

  it("refinement def with type params: NonEmpty a = List a | length value > 0", () => {
    const ast = parse("NonEmpty a = List a | length value > 0") as {
      type_def: { name: string; params?: string[]; refined?: unknown };
    };
    expect(ast.type_def.name).toBe("NonEmpty");
    expect(ast.type_def.params).toEqual(["a"]);
    expect(ast.type_def.refined).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 2.6 — SetExpr-bearing refinement syntax
//
// `<base> | value ∈ <set-expr>` (Unicode ∈) or `<base> | value in <set-expr>`
// (ASCII `in`) lowers directly to `{$refined: {base, set: <SetExpr>}}` — no
// `$where` wrap — so set-algebra can decide subset/disjoint structurally
// without evaluating a predicate value-by-value. The legacy predicate form
// (`String | isValidEmail` etc.) still lowers to `$where` unchanged.
// ---------------------------------------------------------------------------

describe("Phase 2.6 — SetExpr-bearing refinement", () => {
  it("UnicodeNat = Nat | value ∈ [0..55295] (Unicode ∈ + single interval)", () => {
    expect(parse("UnicodeNat = Nat | value ∈ [0..55295]")).toEqual({
      type_def: {
        name: "UnicodeNat",
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("UnicodeNat = Nat | value in [0..55295] (ASCII `in` accepted)", () => {
    expect(parse("UnicodeNat = Nat | value in [0..55295]")).toEqual({
      type_def: {
        name: "UnicodeNat",
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("union of intervals via ∪", () => {
    const ast = parse("CharRange = Nat | value ∈ [0..55295] ∪ [57344..1114111]") as {
      type_def: { name: string; refined: { $refined: { base: unknown; set: { $union: unknown[] } } } };
    };
    expect(ast.type_def.refined.$refined.set.$union).toHaveLength(2);
  });

  it("opaque-wrapped SetExpr refinement: opaque \"codepoint\" Char = …", () => {
    expect(parse('opaque "codepoint" Char = Nat | value ∈ [0..55295] ∪ [57344..1114111]')).toEqual({
      type_def: {
        name: "Char",
        opaque: { repr: "codepoint" },
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: {
              $union: [
                { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
                { $interval: { lo: Just({ value: 57344, inclusive: true }), hi: Just({ value: 1114111, inclusive: true }) } },
              ],
            },
          },
        },
      },
    });
  });

  it("predicate form still lowers to $where (regression)", () => {
    expect(parse("Email = String | isValidEmail")).toEqual({
      type_def: {
        name: "Email",
        refined: {
          $refined: {
            base: { $ref: "String" },
            set: { $where: { call: ["isValidEmail", { var: "value" }] } },
          },
        },
      },
    });
  });

  it("round-trips via the printer", () => {
    const srcs = [
      "UnicodeNat = Nat | value ∈ [0..55295]",
      "CharRange = Nat | value ∈ [0..55295] ∪ [57344..1114111]",
      'opaque "codepoint" Char = Nat | value ∈ [0..55295] ∪ [57344..1114111]',
    ];
    for (const src of srcs) {
      const ast = parse(src);
      const reparsed = parse(print(ast));
      expect(reparsed).toEqual(ast);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2.7 — Rational + refined-numeric atoms + hex literals
//
// Three new shapes:
//
//   1. Half-open intervals (`[1..)` / `[0..)`) in refinement decls. The
//      parser admits `[lo..)` (missing-hi); the printer emits the
//      explicit `[lo..∞)` form, which the parser also accepts (round-
//      trip through the printer preserves the AST).
//   2. Hex / oct / bin literals inside SetExpr bounds — extends the
//      Fenel lexer's `num` token so `0xD7FF` lexes as a single
//      `num`, and `parseSetExpr` (set-syntax.ts) decodes the radix.
//   3. Compound opaque-wrapped record referencing a named refinement
//      in field position — exercises the parser's field-position type
//      slot against a refinement-aliased atom.
// ---------------------------------------------------------------------------

describe("Phase 2.7 — Rational + refined-numeric atoms", () => {
  it("PositiveNat = Nat | value ∈ [1..) (half-open interval)", () => {
    expect(parse("PositiveNat = Nat | value ∈ [1..)")).toEqual({
      type_def: {
        name: "PositiveNat",
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: { $interval: { lo: Just({ value: 1, inclusive: true }), hi: Nothing } },
          },
        },
      },
    });
  });

  it("NonNegInt = Int | value ∈ [0..) (half-open interval)", () => {
    expect(parse("NonNegInt = Int | value ∈ [0..)")).toEqual({
      type_def: {
        name: "NonNegInt",
        refined: {
          $refined: {
            base: { $ref: "Int" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } },
          },
        },
      },
    });
  });

  it("explicit ∞ upper bound parses identically to missing-hi", () => {
    const open = parse("PositiveNat = Nat | value ∈ [1..)");
    const inf = parse("PositiveNat = Nat | value ∈ [1..∞)");
    expect(inf).toEqual(open);
  });

  it("hex literal in SetExpr bound: Byte = Nat | value ∈ [0..0xFF]", () => {
    expect(parse("Byte = Nat | value ∈ [0..0xFF]")).toEqual({
      type_def: {
        name: "Byte",
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 255, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("hex literals in opaque codepoint decl (Char with 0xD7FF / 0x10FFFF)", () => {
    expect(parse('opaque "codepoint" Char = Nat | value ∈ [0..0xD7FF] ∪ [0xE000..0x10FFFF]')).toEqual({
      type_def: {
        name: "Char",
        opaque: { repr: "codepoint" },
        refined: {
          $refined: {
            base: { $ref: "Nat" },
            set: {
              $union: [
                { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
                { $interval: { lo: Just({ value: 57344, inclusive: true }), hi: Just({ value: 1114111, inclusive: true }) } },
              ],
            },
          },
        },
      },
    });
  });

  it('opaque "rational" Rational with named-refinement field type', () => {
    expect(parse('opaque "rational" Rational = Rational num: Int den: PositiveNat')).toEqual({
      type_def: {
        name: "Rational",
        opaque: { repr: "rational" },
        constructors: [
          {
            name: "Rational",
            label: Nothing,
            fields: [
              { name: "num", label: Nothing, type: { $ref: "Int" }},
              { name: "den", label: Nothing, type: { $ref: "PositiveNat" }},
            ],
          },
        ],
      },
    });
  });

  it("round-trips Phase 2.7 shapes via the printer", () => {
    const srcs = [
      "PositiveNat = Nat | value ∈ [1..)",
      "NonNegInt = Int | value ∈ [0..)",
      "Byte = Nat | value ∈ [0..0xFF]",
      'opaque "codepoint" Char = Nat | value ∈ [0..0xD7FF] ∪ [0xE000..0x10FFFF]',
      'opaque "rational" Rational = Rational num: Int den: PositiveNat',
    ];
    for (const src of srcs) {
      const ast = parse(src);
      const reparsed = parse(print(ast));
      expect(reparsed).toEqual(ast);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2.8 — scientific-notation literals in SetExpr bounds
//
// `parseSetExpr` already accepted `e[+-]?\d+`-suffixed numbers (pre-existing);
// the Fenel lexer (`fenel-parser.ts:tokenize`) needed the matching extension
// so float-type bounds like `1.7976931348623157e308` lex as a single `num`
// token. With both sides aligned, `lang-numbers.fenel` decls (F32, F64, …)
// round-trip through parser → printer → parser cleanly.
// ---------------------------------------------------------------------------

describe("Phase 2.8 — scientific-notation literals", () => {
  it("parses positive exponent in SetExpr bound: F = Rational | value ∈ [0..3.4e38]", () => {
    expect(parse("F = Rational | value ∈ [0..3.4e38]")).toEqual({
      type_def: {
        name: "F",
        refined: {
          $refined: {
            base: { $ref: "Rational" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 3.4e38, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("parses signed exponent: G = Rational | value ∈ [0..1e-10]", () => {
    expect(parse("G = Rational | value ∈ [0..1e-10]")).toEqual({
      type_def: {
        name: "G",
        refined: {
          $refined: {
            base: { $ref: "Rational" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1e-10, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("parses signed-positive exponent: H = Rational | value ∈ [0..1e+10]", () => {
    expect(parse("H = Rational | value ∈ [0..1e+10]")).toEqual({
      type_def: {
        name: "H",
        refined: {
          $refined: {
            base: { $ref: "Rational" },
            set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1e10, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("parses negative + sci-notation bound: F32 = Rational | value ∈ [-3.4e38..3.4e38]", () => {
    expect(parse("F32 = Rational | value ∈ [-3.4e38..3.4e38]")).toEqual({
      type_def: {
        name: "F32",
        refined: {
          $refined: {
            base: { $ref: "Rational" },
            set: { $interval: { lo: Just({ value: -3.4e38, inclusive: true }), hi: Just({ value: 3.4e38, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("parses IEEE-754 binary64 max literal (1.7976931348623157e308)", () => {
    const ast = parse("F64 = Rational | value ∈ [-1.7976931348623157e308..1.7976931348623157e308]") as any;
    const iv = ast.type_def.refined.$refined.set.$interval;
    expect(iv.lo._0.value).toBe(-1.7976931348623157e308);
    expect(iv.hi._0.value).toBe(1.7976931348623157e308);
  });

  it("mixes hex lo + sci hi: M = Rational | value ∈ [-0xFF..3.4e38]", () => {
    expect(parse("M = Rational | value ∈ [-0xFF..3.4e38]")).toEqual({
      type_def: {
        name: "M",
        refined: {
          $refined: {
            base: { $ref: "Rational" },
            set: { $interval: { lo: Just({ value: -255, inclusive: true }), hi: Just({ value: 3.4e38, inclusive: true }) } },
          },
        },
      },
    });
  });

  it("round-trips Phase 2.8 sci-notation shapes via the printer", () => {
    const srcs = [
      "F = Rational | value ∈ [0..3.4e38]",
      "G = Rational | value ∈ [0..1e-10]",
      "H = Rational | value ∈ [0..1e+10]",
      "F32 = Rational | value ∈ [-3.4e38..3.4e38]",
      "JsBigInt = Int | value ∈ ℤ",
    ];
    for (const src of srcs) {
      const ast = parse(src);
      const reparsed = parse(print(ast));
      expect(reparsed).toEqual(ast);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2.10 — SetExpr-body source-slice reassembly
//
// `parseSetForm` used to rejoin tokens with `parts.join(" ")`, which
// inserted stray whitespace into the SetExpr body. That broke any grammar
// slot the SetExpr parser tokenises differently from the Fenel lexer:
//   - `str:emoji` (3 Fenel tokens: ident `str`, op `:`, ident `emoji`)
//     became `"str : emoji"` and tripped `parseName`'s ident regex.
//   - `/^[A-Za-z]$/` (Fenel lexer splits the regex chars as ops) became a
//     space-separated soup that `parsePattern` couldn't reassemble.
//
// Phase 2.10 threads the original source string into `Parser` and
// `parseSetForm` slices `src` verbatim between the `∈`-after position and
// the SetExpr terminator. The hand-written-input grammar in `parseSetExpr`
// then sees the body byte-for-byte.
// ---------------------------------------------------------------------------

describe("Phase 2.10 — SetExpr-body source-slice (`:`-in-name, `/regex/`, mixed)", () => {
  it("value ∈ str:emoji parses to {$ref: \"str:emoji\"}", () => {
    expect(parse("X = String | value ∈ str:emoji")).toEqual({
      type_def: {
        name: "X",
        refined: {
          $refined: {
            base: { $ref: "String" },
            set: { $ref: "str:emoji" },
          },
        },
      },
    });
  });

  it("value ∈ format:path parses to {$ref: \"format:path\"}", () => {
    expect(parse("X = String | value ∈ format:path")).toEqual({
      type_def: {
        name: "X",
        refined: {
          $refined: {
            base: { $ref: "String" },
            set: { $ref: "format:path" },
          },
        },
      },
    });
  });

  it("value ∈ /^[A-Za-z]$/ parses to a $pattern with [A-Z] ∪ [a-z]", () => {
    const ast = parse("X = String | value ∈ /^[A-Za-z]$/") as {
      type_def: { refined: { $refined: { set: { $pattern: { t: string; pred: unknown } } } } };
    };
    const pat = ast.type_def.refined.$refined.set.$pattern;
    expect(pat.t).toBe("match");
    expect(pat.pred).toEqual({
      $union: [
        { $interval: { lo: Just({ value: "A", inclusive: true }), hi: Just({ value: "Z", inclusive: true }) } },
        { $interval: { lo: Just({ value: "a", inclusive: true }), hi: Just({ value: "z", inclusive: true }) } },
      ],
    });
  });

  it("mixed interval + regex: value ∈ [1..5] ∪ /xyz/ parses to $union", () => {
    const ast = parse("X = Number | value ∈ [1..5] ∪ /xyz/") as {
      type_def: { refined: { $refined: { set: { $union: Array<Record<string, unknown>> } } } };
    };
    const u = ast.type_def.refined.$refined.set.$union;
    expect(u).toHaveLength(2);
    expect(u[0]).toEqual({
      $interval: { lo: Just({ value: 1, inclusive: true }), hi: Just({ value: 5, inclusive: true }) },
    });
    expect(u[1]).toHaveProperty("$pattern");
  });

  it("round-trips EmojiString = String | value ∈ str:emoji via the printer", () => {
    const srcs = [
      "EmojiString = String | value ∈ str:emoji",
      "PathStr = String | value ∈ format:path",
      "DriveLetter = String | value ∈ /^[A-Za-z]$/",
    ];
    for (const src of srcs) {
      const ast = parse(src);
      const reparsed = parse(print(ast));
      expect(reparsed).toEqual(ast);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2.11 — opaque-decl type-expr RHS
//
// Adds a third arm to the opaque-decl grammar: `opaque "<repr>" Name
// [params] = <type-expr>`. Disambiguation: at depth 0 from `=`, presence
// of `|` selects variant; presence of `<ident>:` selects single-ctor /
// record; absence of both selects type-expr. Unblocks the migration of
// `Str` (whose pure side is `List Char`, a parametric type-application
// rather than a constructor list).
// ---------------------------------------------------------------------------

describe("Phase 2.11 — opaque-decl type-expr RHS", () => {
  it("opaque \"string\" String = List Char parses to alias-form type_def", () => {
    const ast = parse(`opaque "string" String = List Char`) as {
      type_def: {
        name: string;
        alias?: unknown;
        constructors?: unknown;
        opaque?: { repr: string };
      };
    };
    expect(ast.type_def.name).toBe("String");
    expect(ast.type_def.opaque).toEqual({ repr: "string" });
    expect(ast.type_def.constructors).toBeUndefined();
    expect(ast.type_def.alias).toEqual({
      $opaque: {
        name: "List",
        pure: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  { name: "head", label: Nothing, type: { $ref: "Char" }, ui: Nothing, meta: {} },
                  { name: "tail", label: Nothing, type: { $ref: "List" }, ui: Nothing, meta: {} },
                ],
              },
            ],
          },
        },
      },
    });
  });

  it("round-trips opaque \"string\" String = List Char via the printer", () => {
    const src = `opaque "string" String = List Char`;
    const ast = parse(src);
    const reparsed = parse(print(ast));
    expect(reparsed).toEqual(ast);
  });

  it("parametric alias: opaque \"byte-array\" Bytes = List Int parses to alias form", () => {
    const ast = parse(`opaque "byte-array" Bytes = List Int`) as {
      type_def: { name: string; alias?: unknown; opaque?: { repr: string } };
    };
    expect(ast.type_def.name).toBe("Bytes");
    expect(ast.type_def.opaque).toEqual({ repr: "byte-array" });
    expect(ast.type_def.alias).toBeDefined();
  });

  it("regression — opaque \"boolean\" Bool = True | False still parses as constructors", () => {
    const ast = parse(`opaque "boolean" Bool = True | False`) as {
      type_def: {
        name: string;
        alias?: unknown;
        constructors?: Array<{ name: string }>;
        opaque?: { repr: string };
      };
    };
    expect(ast.type_def.name).toBe("Bool");
    expect(ast.type_def.opaque).toEqual({ repr: "boolean" });
    expect(ast.type_def.alias).toBeUndefined();
    expect(ast.type_def.constructors?.map((c) => c.name)).toEqual(["True", "False"]);
  });

  it("regression — opaque \"number\" Int = Int magnitude: Nat negative: Bool still parses as single-ctor record", () => {
    const ast = parse(
      `opaque "number" Int = Int magnitude: Nat negative: Bool`,
    ) as {
      type_def: {
        name: string;
        alias?: unknown;
        constructors?: Array<{ name: string; fields: Array<{ name: string }> }>;
      };
    };
    expect(ast.type_def.alias).toBeUndefined();
    expect(ast.type_def.constructors).toHaveLength(1);
    expect(ast.type_def.constructors?.[0]!.name).toBe("Int");
    expect(ast.type_def.constructors?.[0]!.fields.map((f) => f.name)).toEqual([
      "magnitude",
      "negative",
    ]);
  });

  it("mixed file — type-expr alias decl + variant decl + record decl all parse correctly", () => {
    const src = [
      `opaque "boolean" Bool = True | False`,
      `opaque "string" String = List Char`,
      `opaque "number" Int = Int magnitude: Nat negative: Bool`,
    ].join("\n\n");
    const out = parse(src) as {
      program: Array<{
        type_def: {
          name: string;
          alias?: unknown;
          constructors?: unknown;
          opaque?: { repr: string };
        };
      }>;
    };
    const decls = out.program;
    expect(decls).toHaveLength(3);
    expect(decls[0]!.type_def.constructors).toBeDefined();
    expect(decls[0]!.type_def.alias).toBeUndefined();
    expect(decls[1]!.type_def.alias).toBeDefined();
    expect(decls[1]!.type_def.constructors).toBeUndefined();
    expect(decls[2]!.type_def.constructors).toBeDefined();
    expect(decls[2]!.type_def.alias).toBeUndefined();
  });
});

describe("Phase 3c — EntityRef<\"<name>\"> shorthand", () => {
  // The canonical shape for a typed entity-id reference. Both authoring
  // forms (`<>` generic-app and juxtaposition) expand to the same
  // `$tagged → phantom → $refined → $enum` literal that `phantomEntityName`
  // and every downstream `$tagged` consumer already recognises.
  const canonical = {
    $tagged: {
      value: { $ref: "Id" },
      phantom: {
        $refined: {
          base: { $ref: "String" },
          set: { $enum: ["profile"] },
        },
      },
    },
  };

  it("EntityRef<\"profile\"> parses to the canonical $tagged shape", () => {
    expect((parse('x : EntityRef<"profile">') as any).type_sig.type).toEqual(canonical);
  });

  it("EntityRef \"profile\" juxtaposition parses to the same canonical shape", () => {
    expect((parse('x : EntityRef "profile"') as any).type_sig.type).toEqual(canonical);
  });

  it("EntityRef<\"<name>\"> round-trips via the printer (parse → print → parse)", () => {
    const src = 'x : EntityRef<"profile">';
    const ast = parse(src);
    const printed = print(ast);
    expect(printed).toBe(src);
    expect(parse(printed)).toEqual(ast);
  });
});

describe("Phase 1 — Type-app juxtaposition", () => {
  it("type-level type-vars: Vec n a → bound scheme application", () => {
    const ast = parse("length : Vec n a -> Number") as {
      type_sig: { name: string; type: { $arrow: { params: Array<{ type: unknown }> } } };
    };
    const argType = ast.type_sig.type.$arrow.params[0]!.type;
    // Signature-substrate Phase 2 binds both declaration-local variables.
    // `$el` remains the compatibility spelling; type_sig.scheme.applications
    // authoritatively classifies Vec as the nominal constructor head.
    expect(argType).toEqual({ $el: { call: ["Vec", { $var: "n" }, { $var: "a" }] } });
  });

  it("value-level args: Vec 3 String → $el { call }", () => {
    const ast = parse("test : Vec 3 String") as { type_sig: { type: unknown } };
    expect(ast.type_sig.type).toEqual({
      $el: { call: ["Vec", 3, { $ref: "String" }] },
    });
  });

  it("Maybe a still lifts to canonical Maybe via juxtaposition", () => {
    // Round-trip-friendly: parsed `Maybe a` should equal what `Maybe<a>` parses to.
    const jux = parse("x : Maybe a") as { type_sig: { type: unknown } };
    const generic = parse("x : Maybe<a>") as { type_sig: { type: unknown } };
    expect(jux.type_sig.type).toEqual(generic.type_sig.type);
  });

  it("Verified Boolean lifts to canonical Verified (parser-side container, Phase 1)", () => {
    // Phase 1 of typeclass-substrate-completion: `Verified` joins the
    // canonical-container set (alongside `Maybe` / `List` / `Result` /
    // `Map` / `Tagged`). The parser unfolds `Verified Boolean` to its
    // `$variant` shape directly — same template used by every other
    // canonical container.
    const ast = parse("x : Verified Boolean") as { type_sig: { type: unknown } };
    expect(ast.type_sig.type).toEqual({
      $variant: {
        cases: [
          {
            name: "Verified",
            label: { $tag: "Nothing" },
            fields: [
              { name: "predicate", label: { $tag: "Nothing" }, type: { $ref: "Boolean" }, meta: {}, ui: { $tag: "Nothing" } },
              { name: "evidence", label: { $tag: "Nothing" }, type: { $ref: "Evidence" }, meta: {}, ui: { $tag: "Nothing" } },
            ],
          },
        ],
      },
    });
  });

  it("non-canonical type-app falls back to $el.call (correctness-insurance fallback)", () => {
    // In production today, no constructor reaches this fallback — every
    // type constructor with a known shape is canonicalised. The fallback
    // is correctness insurance for genuinely-deferred type-level
    // applications (e.g. user-defined parametric ADTs not yet in the
    // canonical set).
    const ast = parse("x : Foo a b") as { type_sig: { type: unknown } };
    expect(ast.type_sig.type).toEqual({
      $el: { call: ["Foo", { $var: "a" }, { $var: "b" }] },
    });
  });
});

describe("Phase 1 — Idris-style `data` declaration", () => {
  it("simple data decl with kind sig and where-block", () => {
    const ast = parse(`data Vec : Type -> Number -> Type where
  Nil : Vec a 0
  Cons : a -> Vec a n -> Vec a (n + 1)`);
    const td = (ast as { type_def: { name: string; kindSig: unknown; constructors: Array<{ name: string; type: unknown }> } }).type_def;
    expect(td.name).toBe("Vec");
    expect(td.kindSig).toBeDefined();
    expect(td.constructors).toHaveLength(2);
    expect(td.constructors[0]!.name).toBe("Nil");
    expect(td.constructors[1]!.name).toBe("Cons");
    // The Cons return type uses an $el call with a value-level `(n + 1)` arg.
    const consType = td.constructors[1]!.type as { $arrow: { returns: { $arrow: { returns: unknown } } } };
    const consReturn = consType.$arrow.returns.$arrow.returns;
    expect(consReturn).toMatchObject({
      $el: { call: ["Vec", { $ref: "a" }, { call: ["add", { var: "n" }, 1] }] },
    });
  });

  it("`data` is contextual — still usable as a record field name", () => {
    // Regression: existing modules use `data:` as a field name.
    expect(parse("Msg = Msg data: String")).toEqual({
      type_def: {
        name: "Msg",
        constructors: [
          { name: "Msg", label: Nothing, fields: [{ name: "data", label: Nothing, type: { $ref: "String" }}] },
        ],
      },
    });
  });

  it("`data` is contextual — still usable as a bare expression", () => {
    expect(parse("data")).toEqual({ var: "data" });
  });
});

describe("Phase 3e — @discriminator directive", () => {
  it("`@discriminator \"type\"` before a variant decl attaches the slot to the AST", () => {
    const ast = parse(`@discriminator "type"
Block = Form typeRef: String submitLabel: String`) as {
      type_def: {
        name: string;
        discriminator?: string;
        constructors?: Array<{ name: string; fields: Array<{ name: string }> }>;
      };
    };
    expect(ast.type_def.name).toBe("Block");
    expect(ast.type_def.discriminator).toBe("type");
    expect(ast.type_def.constructors).toHaveLength(1);
    expect(ast.type_def.constructors?.[0]!.name).toBe("Form");
    expect(ast.type_def.constructors?.[0]!.fields.map((f) => f.name)).toEqual([
      "typeRef",
      "submitLabel",
    ]);
  });

  it("round-trips `@discriminator \"type\"` via the printer (parse → print → parse)", () => {
    const src = `@discriminator "type"
Block = Form typeRef: String submitLabel: String`;
    const ast = parse(src);
    const reparsed = parse(print(ast));
    expect(reparsed).toEqual(ast);
  });

  it("GRAMMAR admits any directive name; the LOADER gate rejects unknown ones", () => {
    // Two different layers, deliberately. The GRAMMAR stacks any `@ident`
    // (this assertion) — directive names are not lexer keywords, and the
    // directive-list loop must not break on a name it does not consume.
    //
    // Fail-closedness lives one layer up: as of declaration-annotations
    // Phase 1 (A.2) an unknown name is a module-LOAD error, validated against
    // `directive-policy.fenel` before any load-stage consumer runs. So `@deprecated`
    // parses here and is REJECTED by `loadFenelModule` — see the unknown-name
    // pin in `fenel-directive-policy.test.ts`. This test previously described
    // `@deprecated` as "reserved", which is what fail-open looked like from
    // the inside: silently dropped, never diagnosed.
    const ast = parse(`@discriminator "type"
@deprecated "use Page2"
Block = Form typeRef: String`) as { type_def: { discriminator?: string } };
    expect(ast.type_def.discriminator).toBe("type");
  });

  it("throws when @discriminator decorates a refined decl", () => {
    expect(() => parse(`@discriminator "type"
Email = String | isValidEmail`)).toThrow();
  });

  it("forces single-ctor-with-named-fields to stay a `$variant` (no record collapse)", () => {
    // Phase 3e brief Watch-out §6 — without the directive a single-ctor
    // decl with all-named fields collapses to `$record`; the directive
    // overrides that so the discriminator slot is meaningful.
    const ast = parse(`@discriminator "type"
Block = Form typeRef: String submitLabel: String`);
    // The pure FenelType lowering happens in fenel-module.ts — here we
    // just assert the AST carries the discriminator and the constructors
    // list (the loader's `typeDefToFenelType` keeps it as variant when
    // discriminator is set).
    const td = (ast as { type_def: { discriminator?: string; constructors?: unknown } }).type_def;
    expect(td.discriminator).toBe("type");
    expect(td.constructors).toBeDefined();
  });
});

describe("Phase 1 — round-trip", () => {
  const cases = [
    "Email = String | isValidEmail",
    "Port = Number | value > 0",
    "test : Vec 3 String",
    "length : Vec n a -> Number",
  ];
  for (const src of cases) {
    it(`"${src}"`, () => {
      const ast = parse(src);
      const printed = print(ast);
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});
