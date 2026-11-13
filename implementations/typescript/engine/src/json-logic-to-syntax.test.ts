// expr-substrate Phase 4a — conformance tests for the JSON-Logic source-format
// adapter `engine:jsonLogicToSyntax` / `engine:jsonLogicToExpr` (brief:
// `workstreams/expr-substrate/briefs/phase-4a-jsonlogic-to-syntax-adapter.md`).
//
// Two layers:
//   • Syntax-level — frames PRESERVED: `{if}` ⇒ SIf; `{let}` ⇒ SLet with
//     binding records; `{do: [a]}` ⇒ SDo singleton NOT unwrapped.
//   • Composition-level (`jsonLogicToExpr` = desugar ∘ jsonLogicToSyntax) —
//     tree-equality against the P2 encodings: if / multi-binding let
//     (right-nesting) / ≥3-expr do ("_" chain) / singleton do (bare) / var /
//     call / key-as-fnId / construct ±fields / record / array (appendItem
//     chain) / lambda / match (Pat* passthrough) / null literal / one Err arm.
//
// Inputs are RAW JSON Logic marshalled through the real `marshalJsonLogic`
// (via the dispatch wrappers) — never hand-built `Jl*` shapes (watch-out:
// hand-built marshaller shapes could drift). Expected trees are plain
// `{$tag, …}` JS objects; deep equality.
//
// NOTHING in the live pipeline calls the adapter until 4b; these pin the form
// map + validate the P2 encodings against the marshalled stored-body shapes.

import { describe, it, expect } from "vitest";
import {
  dispatchedJsonLogicToSyntax,
  dispatchedJsonLogicToExpr,
} from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";
import { positionalCompileFieldSlots, type CompileFieldSlot } from "./compile-field-slots";

// --- tiny Expr builders (plain $tag-tagged objects) ---------------------
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const EVar = (name: string) => ({ $tag: "EVar", name });
const SLit = (value: unknown) => ({ $tag: "SLit", value });
const SVar = (name: string) => ({ $tag: "SVar", name });

const toSyntax = (node: unknown) => dispatchedJsonLogicToSyntax(node);
const toExpr = (node: unknown) => dispatchedJsonLogicToExpr(node);
const okSyntax = (node: unknown) => (toSyntax(node) as { $tag: string; _0: unknown })._0;
const okExpr = (node: unknown) => (toExpr(node) as { $tag: string; _0: unknown })._0;

describe("tagged record field projection", () => {
  const slots: CompileFieldSlot[] = [
    { key: { $tag: "NamedField", ref: { $ref: "11111111-1111-4111-8111-111111111111" } }, wireName: "name" },
    { key: { $tag: "NamedField", ref: { $ref: "22222222-2222-4222-8222-222222222222" } }, wireName: "country" },
  ];

  it("matches tagged and explicit named construction by field identity in every object order", () => {
    const values = [
      { $tag: "Customer", name: "Ada", country: 7 },
      { country: 7, $tag: "Customer", name: "Ada" },
    ];
    for (const fields of [slots, [...slots].reverse()]) {
      const metadata = { Customer: fields };
      const expected = { $tag: "Ok", _0: {
        $tag: "SConstruct", ctor: "Customer", fields,
        args: fields.map((field) => SLit(field.wireName === "name" ? "Ada" : 7)),
      } };
      for (const value of values) {
        const original = structuredClone(value);
        expect(dispatchedJsonLogicToSyntax(value, metadata)).toEqual(expected);
        expect(dispatchedJsonLogicToSyntax({ construct: ["Customer", { country: 7, name: "Ada" }] }, metadata)).toEqual(expected);
        expect(value).toEqual(original);
      }
    }
  });

  it("preserves nested tagged payloads and exact field keys through desugaring", () => {
    const envelope = positionalCompileFieldSlots(["customer"]);
    const metadata = { Customer: slots, Envelope: envelope };
    expect(dispatchedJsonLogicToExpr({
      $tag: "Envelope", customer: { $tag: "Customer", country: 7, name: "Ada" },
    }, metadata)).toEqual({ $tag: "Ok", _0: {
      $tag: "EConstruct", ctor: "Envelope", fields: envelope,
      args: [{ $tag: "EConstruct", ctor: "Customer", fields: slots, args: [ELit("Ada"), ELit(7)] }],
    } });
  });

  it("retains unknown, empty and unexpected payload fallthroughs without dropping data", () => {
    const metadata = { Customer: slots };
    for (const value of [
      { $tag: "Unknown", country: 7, name: "Ada" },
      { $tag: "Customer", country: 7, name: "Ada", extra: true },
      { $tag: "Customer" },
    ]) {
      expect(dispatchedJsonLogicToSyntax(value, metadata)).toEqual({ $tag: "Ok", _0: {
        $tag: "SConstruct", ctor: value.$tag,
        args: Object.entries(value).filter(([key]) => key !== "$tag").map(([, value]) => SLit(value)),
      } });
    }
    expect(dispatchedJsonLogicToSyntax({ construct: ["Customer", "Ada", 7] }, metadata)).toEqual({
      $tag: "Ok", _0: { $tag: "SConstruct", ctor: "Customer", args: [SLit("Ada"), SLit(7)] },
    });
    const justSlots = positionalCompileFieldSlots(["_0"]);
    expect(dispatchedJsonLogicToSyntax({ $tag: "Just", _0: 7 }, { Just: justSlots })).toEqual({
      $tag: "Ok", _0: { $tag: "SConstruct", ctor: "Just", fields: justSlots, args: [SLit(7)] },
    });
  });
});

describe("jsonLogicToSyntax — surface frames PRESERVED", () => {
  it("{if} ⇒ SIf (NOT pre-lowered to a call)", () => {
    expect(okSyntax({ if: [{ var: "c" }, 1, 2] })).toEqual({
      $tag: "SIf",
      cond: SVar("c"),
      then: SLit(1),
      else: SLit(2),
    });
  });

  it("{let} ⇒ SLet with {name, value} binding records + implicit body = last SVar", () => {
    expect(okSyntax({ let: { x: 1, y: 2 } })).toEqual({
      $tag: "SLet",
      bindings: [
        { name: "x", value: SLit(1) },
        { name: "y", value: SLit(2) },
      ],
      body: SVar("y"),
    });
  });

  it("{where: [body, {x,y}]} ⇒ SWhere with {name, value} binding records (jlsWhere lift)", () => {
    // fenel-surface-extensions Phase 4. The bindings-object → list reuses
    // jlsLetBindings (same `{name, value}` shape as SLet); the body is lowered.
    expect(
      okSyntax({ where: [{ call: ["add", { var: "x" }, { var: "y" }] }, { x: 1, y: 2 }] }),
    ).toEqual({
      $tag: "SWhere",
      body: { $tag: "SCall", fnId: "add", args: [SVar("x"), SVar("y")] },
      bindings: [
        { name: "x", value: SLit(1) },
        { name: "y", value: SLit(2) },
      ],
    });
  });

  it("{method: [cls, method, …args]} ⇒ SMethod (jlsMethod lift)", () => {
    // fenel-surface-extensions Phase 6. cls + method are the first two JlString
    // args (raw strings, not lowered); the rest lower via jlsExprList.
    expect(
      okSyntax({ method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }] }),
    ).toEqual({
      $tag: "SMethod",
      cls: "Foldable",
      method: "foldr",
      args: [SVar("f"), SLit(0), SVar("xs")],
    });
  });

  it("{method: [cls, method]} bare ref ⇒ SMethod with empty args", () => {
    expect(okSyntax({ method: ["Foldable", "foldr"] })).toEqual({
      $tag: "SMethod",
      cls: "Foldable",
      method: "foldr",
      args: [],
    });
  });

  it("{do: [a]} ⇒ SDo singleton NOT unwrapped (frame preserved verbatim)", () => {
    expect(okSyntax({ do: [{ var: "x" }] })).toEqual({
      $tag: "SDo",
      exprs: [SVar("x")],
    });
  });

  it("do-embedded leading {let} re-nests as SLet scoping over the rest (4a erratum fix)", () => {
    // JSON Logic's do-frame is the FLAT statement encoding: the let's
    // bindings scope FORWARD. The adapter re-nests (source-format
    // structure); the inner SDo singleton is NOT unwrapped (desugar's job).
    expect(okSyntax({ do: [{ let: { x: 1 } }, { var: "x" }] })).toEqual({
      $tag: "SLet",
      bindings: [{ name: "x", value: SLit(1) }],
      body: { $tag: "SDo", exprs: [SVar("x")] },
    });
  });

  it("mid-stream {let} nests recursively (remaining statements inside its scope)", () => {
    expect(
      okSyntax({ do: [{ var: "a" }, { let: { x: 1 } }, { var: "x" }] }),
    ).toEqual({
      $tag: "SDo",
      exprs: [
        SVar("a"),
        {
          $tag: "SLet",
          bindings: [{ name: "x", value: SLit(1) }],
          body: { $tag: "SDo", exprs: [SVar("x")] },
        },
      ],
    });
  });

  it("only-lets do ⇒ SLet with implicit body = last binding's SVar", () => {
    expect(okSyntax({ do: [{ let: { x: 1, y: 2 } }] })).toEqual({
      $tag: "SLet",
      bindings: [
        { name: "x", value: SLit(1) },
        { name: "y", value: SLit(2) },
      ],
      body: SVar("y"),
    });
  });

  it("empty do ⇒ Err (mirrors lowerDoSequence)", () => {
    const r = toSyntax({ do: [] }) as { $tag: string; _0: { reason: string } };
    expect(r.$tag).toBe("Err");
    expect(r._0.reason).toBe("do with no expressions");
  });

  it("operators / and-or ⇒ SCall, NEVER SOp", () => {
    expect(okSyntax({ "+": [1, 2] })).toEqual({
      $tag: "SCall",
      fnId: "add",
      args: [SLit(1), SLit(2)],
    });
    expect(okSyntax({ and: [true, false] })).toEqual({
      $tag: "SCall",
      fnId: "and",
      args: [SLit(true), SLit(false)],
    });
  });
});

describe("jsonLogicToExpr — composition tree-equality (the P2 encodings)", () => {
  it("if ⇒ ECall \"if\" [c, t, e]", () => {
    expect(okExpr({ if: [{ var: "c" }, 1, 2] })).toEqual({
      $tag: "ECall",
      fnId: "if",
      args: [EVar("c"), ELit(1), ELit(2)],
    });
  });

  it("2-arg if ⇒ implicit else (SLit null ⇒ ELit null)", () => {
    expect(okExpr({ if: [{ var: "c" }, 1] })).toEqual({
      $tag: "ECall",
      fnId: "if",
      args: [EVar("c"), ELit(1), ELit(null)],
    });
  });

  it("multi-binding let ⇒ right-nested applied ELambdas via \"$\" (binding 2 sees binding 1)", () => {
    expect(okExpr({ let: { x: 1, y: { var: "x" } } })).toEqual({
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
              EVar("x"),
            ],
          },
        },
        ELit(1),
      ],
    });
  });

  it("{where} ⇒ the SAME Expr as the equivalent let (desugar SWhere → let — D2 compile path)", () => {
    // fenel-surface-extensions Phase 4 D2: `where` is scoped-let, so the COMPILE
    // path is SUPPORTED for free — `jsonLogicToExpr {where:[body, {y:1}]}` lowers
    // (via desugar's SWhere arm, reusing desugarLetChain) to the SAME applied-
    // ELambda as `{let: {y: 1}}` over the body. Contrast with guards (compile-
    // FENCED). The two MUST be byte-identical.
    const whereExpr = okExpr({
      where: [{ call: ["add", { var: "x" }, { var: "y" }] }, { y: 1 }],
    });
    expect(whereExpr).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [
        {
          $tag: "ELambda",
          params: ["y"],
          body: { $tag: "ECall", fnId: "add", args: [EVar("x"), EVar("y")] },
        },
        ELit(1),
      ],
    });
  });

  it("{method} ⇒ a dotted-fnId ECall (desugar SMethod → ECall cls.method — D2 compile stance)", () => {
    // fenel-surface-extensions Phase 6 D2: SMethod desugars to the dotted-fnId
    // core form `ECall (cls ++ "." ++ method) args` (the desugar.fenel header's
    // documented stance — locked Expr has no EMethod). The PRODUCTION (interpreted)
    // path never enters desugar (the runtime evaluates {method} reflectively); the
    // COMPILE path is a ledgered fence-for-now (the dotted fnId's resolution is
    // P4/P8's — zero corpus files compile a {method} body). This pins the shape.
    expect(
      okExpr({ method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }] }),
    ).toEqual({
      $tag: "ECall",
      fnId: "Foldable.foldr",
      args: [EVar("f"), ELit(0), EVar("xs")],
    });
  });

  it("≥3-expr do ⇒ right-nested applied ELambdas with \"_\" params, last expr is the value", () => {
    expect(okExpr({ do: [1, 2, 3] })).toEqual({
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

  it("singleton do ⇒ desugar the one expr bare (unwrapped exactly once, in desugar)", () => {
    expect(okExpr({ do: [{ var: "x" }] })).toEqual(EVar("x"));
  });

  it("do-embedded let composes to the SCOPED applied-ELambda (x bound over the rest)", () => {
    // The 4a-erratum acceptance test: {do: [{let:{x:1}}, {var:"x"}]} must
    // compose so the trailing statement sits INSIDE x's lambda — byte-equal
    // to what SLet [{x,1}] (body) desugars to.
    expect(okExpr({ do: [{ let: { x: 1 } }, { var: "x" }] })).toEqual({
      $tag: "ECall",
      fnId: "$",
      args: [{ $tag: "ELambda", params: ["x"], body: EVar("x") }, ELit(1)],
    });
  });

  it("var ⇒ EVar", () => {
    expect(okExpr({ var: "foo" })).toEqual(EVar("foo"));
  });

  it("call ⇒ ECall with args recursed", () => {
    expect(okExpr({ call: ["add", 1, { var: "y" }] })).toEqual({
      $tag: "ECall",
      fnId: "add",
      args: [ELit(1), EVar("y")],
    });
  });

  it("key-as-fnId ⇒ ECall", () => {
    expect(okExpr({ myFn: [1, 2] })).toEqual({
      $tag: "ECall",
      fnId: "myFn",
      args: [ELit(1), ELit(2)],
    });
  });

  it("construct positional ⇒ EConstruct (no fields key — positional fallback)", () => {
    expect(okExpr({ construct: ["Just", 5] })).toEqual({
      $tag: "EConstruct",
      ctor: "Just",
      args: [ELit(5)],
    });
  });

  it("construct named-record (ctorDef-matched) ⇒ EConstruct WITH fields", () => {
    // ctorDefs threaded: Pair has fields [a, b]; the single object arg's keys
    // all match ⇒ named-record literal in ctorDef order.
    const pairSlots = positionalCompileFieldSlots(["a", "b"]);
    const result = dispatchedJsonLogicToExpr(
      { construct: ["Pair", { a: 1, b: 2 }] },
      { Pair: pairSlots },
    ) as { $tag: string; _0: unknown };
    expect(result._0).toEqual({
      $tag: "EConstruct",
      ctor: "Pair",
      args: [ELit(1), ELit(2)],
      fields: pairSlots,
    });
  });

  it("multi-key record literal ⇒ ERecord, field values recursed", () => {
    expect(okExpr({ x: 1, y: { var: "z" } })).toEqual({
      $tag: "ERecord",
      fields: [
        { name: "x", value: ELit(1) },
        { name: "y", value: EVar("z") },
      ],
    });
  });

  it("empty object ⇒ ERecord []", () => {
    expect(okExpr({})).toEqual({ $tag: "ERecord", fields: [] });
  });

  it("array literal ⇒ left-folded appendItem chain over an ELit [] base", () => {
    // Each synthetic call keeps the list-literal mark (`lit: true`) through
    // desugar (2026-10-03), so analyses tell a literal from a genuine
    // `appendItem` call.
    expect(okExpr([1, 2])).toEqual({
      $tag: "ECall",
      fnId: "appendItem",
      args: [
        ELit(2),
        {
          $tag: "ECall",
          fnId: "appendItem",
          args: [ELit(1), ELit([])],
          lit: true,
        },
      ],
      lit: true,
    });
  });

  it("lambda (paren-list shape) ⇒ ELambda, params passthrough, body recursed", () => {
    expect(okExpr({ fn: [["a", "b"], { var: "a" }] })).toEqual({
      $tag: "ELambda",
      params: ["a", "b"],
      body: EVar("a"),
    });
  });

  it("match with a constructor pattern ⇒ EMatch, Pat* passthrough shape", () => {
    // {match: [scrut, {$tag: "Just", value: {var: "x"}}, {var: "x"}]}
    const result = okExpr({
      match: [
        { var: "v" },
        { $tag: "Just", value: { var: "x" } },
        { var: "x" },
      ],
    });
    expect(result).toEqual({
      $tag: "EMatch",
      scrutinee: EVar("v"),
      arms: [
        {
          pattern: {
            $tag: "PatConstruct",
            ctor: "Just",
            args: [{ $tag: "PatVar", name: "x" }],
          },
          body: EVar("x"),
        },
      ],
    });
  });

  it("match with a trailing `_`-dropped default ⇒ EMatch + catch-all arm (PatLit \"_\")", () => {
    // fenel-surface-extensions Phase 1 Step 2. The TS parser drops a bare
    // `_ -> body` arm to an UNPAIRED trailing element:
    // {match: [scrut, p1, b1, defaultBody]} (odd args after scrut). The adapter
    // synthesises the canonical `_` pattern `PatLit "_"` (jlsPattern/buildConPat
    // shape) for the catch-all — previously this Err'd "match arm is missing a body".
    const result = okExpr({
      match: [
        { var: "v" },
        { $tag: "Just", value: { var: "x" } },
        { var: "x" },
        { var: "fallback" },
      ],
    });
    expect(result).toEqual({
      $tag: "EMatch",
      scrutinee: EVar("v"),
      arms: [
        {
          pattern: {
            $tag: "PatConstruct",
            ctor: "Just",
            args: [{ $tag: "PatVar", name: "x" }],
          },
          body: EVar("x"),
        },
        { pattern: { $tag: "PatLit", value: "_" }, body: EVar("fallback") },
      ],
    });
  });

  it("match with ONLY a `_`-dropped default ⇒ EMatch with a single catch-all arm", () => {
    expect(okExpr({ match: [{ var: "v" }, { var: "fallback" }] })).toEqual({
      $tag: "EMatch",
      scrutinee: EVar("v"),
      arms: [
        { pattern: { $tag: "PatLit", value: "_" }, body: EVar("fallback") },
      ],
    });
  });

  it("match with a GUARDED arm ⇒ Syntax arm gains a `guard` field (jlsGuardParts lift)", () => {
    // fenel-surface-extensions Phase 3. `{$guard:[pat,cond]}` in the pattern
    // position ⇒ the arm `{pattern, guard, body}` (D1 option A); the wildcard
    // trailing `_ -> "other"` rides the existing `_`-dropped catch-all path.
    expect(
      okSyntax({
        match: [
          { var: "x" },
          { $guard: [{ $bind: "n" }, { call: ["gt", { var: "n" }, 0] }] },
          "pos",
          "other",
        ],
      }),
    ).toEqual({
      $tag: "SMatch",
      scrutinee: SVar("x"),
      arms: [
        {
          pattern: { $tag: "PatVar", name: "n" },
          guard: { $tag: "SCall", fnId: "gt", args: [SVar("n"), SLit(0)] },
          body: SLit("pos"),
        },
        { pattern: { $tag: "PatLit", value: "_" }, body: SLit("other") },
      ],
    });
  });

  it("guarded WILDCARD arm (`{$guard:[\"_\", cond]}`) ⇒ PatLit \"_\" + guard", () => {
    expect(
      okExpr({
        match: [
          { var: "x" },
          { $guard: ["_", { call: ["gt", { var: "x" }, 0] }] },
          "pos",
          "neg",
        ],
      }),
    ).toEqual({
      $tag: "EMatch",
      scrutinee: EVar("x"),
      arms: [
        {
          pattern: { $tag: "PatLit", value: "_" },
          guard: { $tag: "ECall", fnId: "gt", args: [EVar("x"), ELit(0)] },
          body: ELit("pos"),
        },
        { pattern: { $tag: "PatLit", value: "_" }, body: ELit("neg") },
      ],
    });
  });

  it("null literal ⇒ ELit null (nullValue threading)", () => {
    expect(okExpr(null)).toEqual(ELit(null));
  });

  it("malformed form ⇒ Err (one Err arm)", () => {
    const result = toSyntax({ var: [] }) as { $tag: string; _0: { $tag: string; reason: string } };
    expect(result.$tag).toBe("Err");
    expect(result._0.$tag).toBe("Unsupported");
    expect(result._0.reason).toBe("var requires a string name argument");
  });
});

describe("jsonLogicToExpr — corpus smoke (real-world coverage probe, feeds 4b)", () => {
  it("lifts every registered engine-module fn body through the adapter; pins Ok/Err counts", () => {
    const fns = engineModule.functions ?? [];
    let ok = 0;
    let err = 0;
    const errReasons = new Map<string, number>();
    for (const f of fns) {
      const body = (f as { body?: unknown }).body;
      if (body === undefined || body === null) continue;
      const res = dispatchedJsonLogicToExpr(body) as {
        $tag: string;
        _0?: { reason?: string };
      };
      if (res.$tag === "Ok") ok++;
      else {
        err++;
        const reason = res._0?.reason ?? "(none)";
        // Bucket by the leading clause so the histogram is legible.
        const key = reason.split("'")[0]?.trim() ?? reason;
        errReasons.set(key, (errReasons.get(key) ?? 0) + 1);
      }
    }
    // Free real-world coverage probe — the numbers are pinned in the roadmap
    // completion notes (the Err buckets feed 4b's brief). No hard assertion on
    // the exact split (HEAD-drift would churn it); just that the corpus ran and
    // SOME bodies lift cleanly.
    // eslint-disable-next-line no-console
    console.log(
      `[4a corpus smoke] bodies: ${ok + err}  Ok: ${ok}  Err: ${err}  buckets:`,
      Object.fromEntries([...errReasons.entries()].sort((a, b) => b[1] - a[1])),
    );
    expect(ok + err).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
  });
});
