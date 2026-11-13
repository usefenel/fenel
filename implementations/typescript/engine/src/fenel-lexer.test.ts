// parser-substrate Phase 2 — conformance tests for the Fenel LEXER + LAYOUT
// pass (`fenel/modules/engine/lexer.fenel` + `layout.fenel`). brief:
// `workstreams/parser-substrate/briefs/phase-2-lexer-layout.md`.
//
// Three suites:
//   1. LEXER DIFFERENTIAL — `engine:lexAll` ≡ TS `tokenize` (the FROZEN oracle,
//      `fenel-parser.ts:70`, `export`ed for this test — decision 9a) on FULL
//      token records (t, v, ln, col): a per-corner synthetic suite covering
//      every token class + all hard corners (coverage VERIFIED below) PLUS a
//      curated in-budget corpus sample. Full-corpus parity is Phase 5's gate
//      (it rides the parse cache); this phase SAMPLES (decision 9).
//   2. LAYOUT PINS — ~hand-pinned expected virtual-token streams (decision 10).
//      There is NO TS layout pass to diff against (TS does layout inside
//      recursive descent), so corpus-level layout parity is UNPROVABLE until
//      Phase 3 consumes the virtuals — these pins fix THIS pass's contract.
//   3. THROUGHPUT — the interpreted chars/sec, the Phase-6 budget input.
//
// THE TEST-LOCAL MARSHAL (decision 11a): source strings explode to a char list
// inside the Fenel body (`chars`/`slice`); no runtime seam. Tokens are plain
// `{t,v,ln,col}` records — compared directly against the TS `Token` shape.

import { describe, it, expect } from "vitest";
import { tokenize } from "./fenel-parser";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { readFileSync } from "fs";
import { join } from "path";

type TokRec = { t: string; v: string; ln: number; col: number };
const lexAll = (s: string): TokRec[] => dispatchEngineBody("engine:lexAll", [s]) as TokRec[];
const layoutTokens = (t: unknown): TokRec[] => dispatchEngineBody("engine:layoutTokens", [t]) as TokRec[];
const norm = (t: TokRec) => ({ t: t.t, v: t.v, ln: t.ln, col: t.col });
const lexNorm = (s: string) => lexAll(s).map(norm);
const tsNorm = (s: string) => tokenize(s).map(norm);

// =========================================================================
// 1a. Lexer differential — per-corner synthetic suite.
// =========================================================================
const CORNERS: { name: string; src: string }[] = [
  { name: "simple def (ident / = / num)", src: "f x = 1" },
  { name: "compare + arith + exponent num", src: "a <= b + 1.5e3" },
  { name: "range `..` vs number dot", src: "[0..D7FF]" },
  { name: "leading / trailing / range dots", src: ".5 + 1. + 1..5" },
  { name: "radix literals 0x / 0o / 0b", src: "0xFF + 0o17 + 0b101" },
  { name: "float MAX_VALUE exponent", src: "Number.MAX_VALUE = 1.7976931348623157e308" },
  { name: "string escapes (decoded v)", src: 'x = "hi\\n\\t\\"q\\\\z"' },
  { name: "dotted-ident joining", src: "bot.token = profile.account.id" },
  { name: "backtick-infix (3 tokens)", src: "x `add` y" },
  { name: "plain template (no interp)", src: "`plain text`" },
  { name: "template with one hole", src: "`hi ${x} bye`" },
  { name: "template with two holes", src: "`a ${f x} b ${g} c`" },
  { name: "custom multi-char operators", src: "a <> b <$> c >>= d" },
  { name: "unicode set-theory operators", src: "Char = Nat | value ∈ [0..D7FF] ∪ [E000..FFFF]" },
  { name: "named singleton operators", src: "a | b & c $ d % e" },
  { name: "comparison operators", src: "a == b != c >= d <= e < f > g" },
  { name: "arithmetic operators", src: "a * b / c - d + e % f" },
  { name: "reserved-multi operators", src: "a -> b <- c |> d :: e" },
  { name: "line comment skip", src: "-- a comment line\nx = 1" },
  { name: "fixity keyword decl", src: "infixl 6 +" },
  { name: "type sig with parens + colon", src: "f : (Number -> Number)" },
  { name: "composition single dot", src: "k = g . h" },
  { name: "case / of / -> arms", src: "case x of\n  Just y -> y\n  Nothing -> 0" },
  { name: "do / let / where keywords", src: "m = do\n  let x = 1\n  pure x" },
  { name: "if / then / else", src: "if x then 1 else 2" },
  { name: "bool literals", src: "true and false or not true" },
  { name: "module header (contextual)", src: "module Foo.Bar where" },
  { name: "data decl (contextual)", src: "data Foo = Bar | Baz a" },
  { name: "let..in (inline)", src: "let x = 5 in x" },
  { name: "lambda", src: "f = \\x -> add x 1" },
  { name: "record literal", src: "{ a = 1, b = 2 }" },
  { name: "facet directive @", src: "@label x" },
  { name: "CRLF line endings", src: "a = 1\r\nb = 2" },
  { name: "pipe chain", src: "x |> f |> g" },
];

describe("lexer differential vs TS tokenize — corner suite", () => {
  it("carriage-return escapes decode in strings and interpolated template segments", () => {
    for (const source of ['"a\\r\\nb"', '`a\\r\\nb`', '`a\\r${x}b\\r`']) {
      const expected = source.includes("${") ? ["a\r", "b\r"] : ["a\r\nb"];
      for (const lexer of [lexAll, tokenize]) {
        expect(lexer(source).filter((token) => token.t.startsWith("str")).map((token) => token.v))
          .toEqual(expected);
      }
      expect(lexNorm(source)).toEqual(tsNorm(source));
    }
  }, 300_000);

  for (const { name, src } of CORNERS) {
    it(name, () => {
      expect(lexNorm(src)).toEqual(tsNorm(src));
    });
  }

  it("coverage — every token class + hard corner is exercised", () => {
    // The union of every corner's lexed token-type set.
    const seen = new Set<string>();
    for (const { src } of CORNERS) for (const t of lexAll(src)) seen.add(t.t);
    // Every token class the lexer can emit (per the TT vocabulary) appears.
    const classes = [
      "num", "str", "str_begin", "str_mid", "str_end", "ident", "bool",
      "let", "if", "then", "else", "case", "of", "do", "where", "in",
      "infixl", "+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=",
      "=", "->", "<-", "|>", "::", "..", "\\", ".", ":", "|", "&", "$",
      "(", ")", "{", "}", "[", "]", ",", "`", "@", "op", "nl", "eof",
    ];
    const missing = classes.filter((c) => !seen.has(c));
    if (missing.length) console.log("MISSING CLASSES:", JSON.stringify(missing));
    expect(missing).toEqual([]);
    // The hard corners each have a trigger somewhere in the suite.
    const all = CORNERS.map((c) => c.src).join("\n");
    expect(all).toContain("`add`");        // backtick-infix
    expect(all).toContain("${");           // template interpolation
    expect(all).toContain("bot.token");    // dotted-ident
    expect(all).toContain("0x");           // radix
    expect(all).toContain("e3");           // exponent
    expect(all).toContain("∈");            // unicode set-op
    expect(all).toContain("1..5");         // range-vs-fractional dot
    expect(all).toContain("--");           // comment
    expect(all).toContain("\r\n");         // CRLF
  });
});

// =========================================================================
// 1b. Lexer differential — curated corpus sample (in-budget real files).
//   Full-corpus parity is Phase 5's gate; large files overflow the
//   interpreted recursion stack (the Phase-6 depth concern), so the sample
//   is deliberately small-to-medium.
// =========================================================================
const ROOT = join(__dirname, "../../../..");
const SAMPLE_FILES = [
  "fenel/std/foundation.fenel",
  "fenel/std/algebra-instances.fenel",
  "fenel/modules/control/control.fenel",
  "fenel/modules/std/native/string-native.fenel",
];

describe("lexer differential vs TS tokenize — corpus sample", () => {
  for (const f of SAMPLE_FILES) {
    it(f, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(lexNorm(src)).toEqual(tsNorm(src));
    });
  }
});

// =========================================================================
// 2. Layout pass — virtual-token pins (decision 10). The expected streams ARE
//    this pass's contract (no TS oracle; Phase-3 consumes them). Format:
//    virtuals as their bare type, real tokens as `type:value`.
// =========================================================================
const lay = (src: string): string =>
  layoutTokens(lexAll(src))
    .map((t) => (t.t.charAt(0) === "v" && (t.t === "vopen" || t.t === "vsemi" || t.t === "vclose") ? t.t : `${t.t}:${t.v}`))
    .join(" ");

describe("layout pass — virtual-token pins (corpus parity deferred to Phase 3)", () => {
  it("function body block", () => {
    expect(lay("f x =\n  add x 1")).toBe(
      "vopen ident:f ident:x =:= vopen ident:add ident:x num:1 vclose vclose eof:");
  });
  it("multi-statement body (let-rhs `=` wart closes cleanly + vsemi sibling)", () => {
    expect(lay("f x =\n  let y = 1\n  add y x")).toBe(
      "vopen ident:f ident:x =:= vopen let:let ident:y =:= vopen num:1 vclose vsemi ident:add ident:y ident:x vclose vclose eof:");
  });
  it("case arms (of opens, -> opens arm bodies, dedent cascades)", () => {
    expect(lay("g x =\n  case x of\n    Just y -> y\n    Nothing -> 0")).toBe(
      "vopen ident:g ident:x =:= vopen case:case ident:x of:of vopen ident:Just ident:y ->:-> vopen ident:y vclose vsemi ident:Nothing ->:-> vopen num:0 vclose vclose vclose vclose eof:");
  });
  it("case with same-line scrutinee", () => {
    expect(lay("g x = case x of\n  A -> 1\n  B -> 2")).toBe(
      "vopen ident:g ident:x =:= vopen case:case ident:x of:of vopen ident:A ->:-> vopen num:1 vclose vsemi ident:B ->:-> vopen num:2 vclose vclose vclose vclose eof:");
  });
  it("if / then / else (same-line branches)", () => {
    expect(lay("h x =\n  if x then 1 else 2")).toBe(
      "vopen ident:h ident:x =:= vopen if:if ident:x then:then vopen num:1 else:else vopen num:2 vclose vclose vclose vclose eof:");
  });
  it("else-if chain (multi-line)", () => {
    expect(lay("h x =\n  if a then 1\n  else if b then 2\n  else 3")).toBe(
      "vopen ident:h ident:x =:= vopen if:if ident:a then:then vopen num:1 vclose vsemi else:else vopen if:if ident:b then:then vopen num:2 vclose vclose vsemi else:else vopen num:3 vclose vclose vclose eof:");
  });
  it("do block (layout) — siblings get vsemi", () => {
    expect(lay("m =\n  do\n    x\n    y")).toBe(
      "vopen ident:m =:= vopen do:do vopen ident:x vsemi ident:y vclose vclose vclose eof:");
  });
  it("explicit do…end (end rides as a token alongside vclose)", () => {
    expect(lay("m =\n  do\n    x\n  end")).toBe(
      "vopen ident:m =:= vopen do:do vopen ident:x vclose vsemi end:end vclose vclose eof:");
  });
  it("where bindings", () => {
    expect(lay("f x = y\n  where y = add x 1")).toBe(
      "vopen ident:f ident:x =:= vopen ident:y vclose where:where vopen ident:y =:= vopen ident:add ident:x num:1 vclose vclose vclose eof:");
  });
  it("brackets suspend layout (multi-line inside parens, no virtuals)", () => {
    expect(lay("f =\n  g (a\n     b) c")).toBe(
      "vopen ident:f =:= vopen ident:g (:( ident:a ident:b ):) ident:c vclose vclose eof:");
  });
  it("nested dedent closes multiple blocks at once", () => {
    expect(lay("f x =\n  case x of\n    A ->\n      let z = 1\n      z\n    B -> 2")).toBe(
      "vopen ident:f ident:x =:= vopen case:case ident:x of:of vopen ident:A ->:-> vopen let:let ident:z =:= vopen num:1 vclose vsemi ident:z vclose vsemi ident:B ->:-> vopen num:2 vclose vclose vclose vclose eof:");
  });
  it("greater-column continuation (no virtual)", () => {
    expect(lay("f =\n  add\n    1")).toBe(
      "vopen ident:f =:= vopen ident:add num:1 vclose vclose eof:");
  });
  it("top-level decls are siblings (vsemi between)", () => {
    expect(lay("a = 1\nb = 2")).toBe(
      "vopen ident:a =:= vopen num:1 vclose vsemi ident:b =:= vopen num:2 vclose vclose eof:");
  });
  it("record literal (braces suspend the inner `=`)", () => {
    expect(lay("r =\n  { a = 1\n  , b = 2 }")).toBe(
      "vopen ident:r =:= vopen {:{ ident:a =:= num:1 ,:, ident:b =:= num:2 }:} vclose vclose eof:");
  });
});

// =========================================================================
// 3. Throughput — the Phase-6 budget input (interpreted chars/sec).
// =========================================================================
describe("throughput (Phase-6 budget input)", () => {
  it("measures interpreted lexer chars/sec on a warm sample", () => {
    const src = readFileSync(join(ROOT, "fenel/modules/std/native/string-native.fenel"), "utf8");
    lexAll(src); // warm up (JIT + registry)
    const t0 = performance.now();
    const toks = lexAll(src);
    const ms = performance.now() - t0;
    const cps = Math.round((src.length / ms) * 1000);
    console.log(`[throughput] ${src.length} chars / ${toks.length} toks in ${ms.toFixed(1)}ms ⇒ ~${cps} chars/sec (interpreted)`);
    expect(toks.length).toBeGreaterThan(0);
  });
});
