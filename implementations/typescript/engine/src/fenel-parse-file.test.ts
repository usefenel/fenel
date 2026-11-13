// parser-substrate Phase 5b1 — the PER-DECLARATION split differential. brief:
// `workstreams/parser-substrate/briefs/phase-5b-per-decl-parsing-and-corpus-measurement.md`.
//
// THE 5b1 ORACLE: the per-decl orchestrator parses each top-level decl GROUP
// independently (the 6b2 budget fix — whole-file parseProgToks is super-linearly
// impractical; each decl is a short token run, the fast curve), then reassembles
// the `{frame, directives}` element list. It must be BYTE-IDENTICAL to the
// whole-file parse:
//   engine:parseFileFrames(layoutTokens(lexAll src))   // per-decl split + reassemble
//     ≡ engine:parseProgToks(layoutTokens(lexAll src)) // whole-file (the existing entry)
//
// The hard shapes (the brief's pin list): a @directive-prefixed decl (the
// directive chunk + its frame reassemble), a sig+def pair (two frames), a
// multi-line decl (internal `vsemi` NOT split), a `module … where` header +
// decls, a typedef with a multi-line `|`-variant body (internal `vsemi` before
// each `|` NOT split).
//
// TS ledger: this test file (tooling, cat. c) + the roster bump in
// module-migrate-engine.test.ts. NO new entities (the split result + groups are
// plain records / token lists). parseFileFrames is NOT a compiled entry (the
// artifact closure + `--check` stay unchanged; the 5b2 measurement drives the
// per-group loop over the COMPILED parseProgToks).

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchEngineBody, setParserInterpreted } from "./engine-bodies-dispatch";

const TO = 120000;
const TABLE = dispatchEngineBody("engine:defaultFixityTable", []);
const lexAll = (s: string): unknown => dispatchEngineBody("engine:lexAll", [s]);
const layoutTokens = (t: unknown): unknown =>
  dispatchEngineBody("engine:layoutTokens", [t]);
const parseProgToks = (toks: unknown): { $tag: string; _0?: unknown } =>
  dispatchEngineBody("engine:parseProgToks", [TABLE, null, toks]) as {
    $tag: string;
    _0?: unknown;
  };
const parseFileFrames = (toks: unknown): { $tag: string; _0?: unknown } =>
  dispatchEngineBody("engine:parseFileFrames", [TABLE, null, toks]) as {
    $tag: string;
    _0?: unknown;
  };
const splitTopLevelDecls = (toks: unknown): { headered: boolean; name: string; groups: unknown[] } =>
  dispatchEngineBody("engine:splitTopLevelDecls", [toks]) as {
    headered: boolean;
    name: string;
    groups: unknown[];
  };

const BS = String.fromCharCode(92);

// unwrap a Maybe element list ⇒ the list (or a sentinel for Nothing).
const els = (m: { $tag: string; _0?: unknown }): unknown =>
  m.$tag === "Just" ? m._0 : { $NOTHING: true };

// =========================================================================
// THE DIFFERENTIAL — parseFileFrames(src) ≡ parseProgToks(src), per-decl ≡ whole.
// =========================================================================
const CASES: { name: string; src: string; groups: number; headered?: boolean }[] = [
  { name: "single def", src: "f x = x", groups: 1 },
  { name: "@directive-prefixed decl", src: '@label "x"\nf x = x', groups: 1 },
  { name: "multi-directive prefix", src: '@label "L"\n@tags "a" "b"\nf : Number\nf x = x', groups: 2 },
  { name: "sig + def pair (two frames)", src: "f : Number\nf x = x", groups: 2 },
  { name: "two defs (two groups)", src: "f x = x\ng y = y", groups: 2 },
  { name: "mixed sig + def siblings", src: "f : Number\nf x = x\ng y = y", groups: 3 },
  { name: "multi-line decl (internal vsemi NOT split)", src: "f x =\n  let y = 1\n  add x y", groups: 1 },
  { name: "two-binding let (one group)", src: "f x =\n  let y = 1\n  let z = 2\n  add y z", groups: 1 },
  { name: "module header + decls", src: "module engine where\nf : Number\nf x = x", groups: 2, headered: true },
  { name: "module header only (no decls)", src: "module foo where", groups: 0, headered: true },
  { name: "module header + two defs", src: "module foo where\nf x = x\ng y = y", groups: 2, headered: true },
  { name: "typedef multi-line | variant (internal vsemi NOT split)", src: "Color =\n  Red\n  | Green\n  | Blue", groups: 1 },
  { name: "typedef + def mixed file", src: "Color = Red | Blue\nf x = x", groups: 2 },
  { name: "match body (internal arm vsemi NOT split)", src: "f x = case x of\n  Just y -> y\n  Nothing -> 0", groups: 1 },
  { name: "directive on a def (no sig)", src: '@label "x"\nf x = x', groups: 1 },
  { name: "lambda body", src: "f = " + BS + "x y -> add x y", groups: 1 },
];

describe("parse-file 5b1 — per-decl split ≡ whole-file parseProgToks", () => {
  for (const { name, src } of CASES)
    it(name, () => {
      const toks = layoutTokens(lexAll(src));
      expect(els(parseFileFrames(toks))).toEqual(els(parseProgToks(toks)));
    }, TO);
});

// =========================================================================
// THE SPLIT SHAPE — the depth-0 partition + directive grouping, pinned directly.
// =========================================================================
describe("parse-file 5b1 — splitTopLevelDecls shape (group count + headered/name)", () => {
  for (const { name, src, groups, headered } of CASES)
    it(name, () => {
      const s = splitTopLevelDecls(layoutTokens(lexAll(src)));
      expect(s.groups.length).toBe(groups);
      expect(s.headered).toBe(headered ?? false);
      if (headered) expect(s.name.length).toBeGreaterThan(0);
    }, TO);
});

// =========================================================================
// Phase 7d — the pre-parse pipeline (splice + split) is OVERFLOW-FREE on the
// COMPILED path. brief: `workstreams/parser-substrate/briefs/phase-7d-perf-budget-tail.md`.
//
// Before 7d the split + splice ran INTERPRETED inside `parseViaFenelParser`:
// the non-tail `takeN` (now accumulator-tail-recursive) overflowed the host
// stack in the split, and the self-tail-but-interpreted (no-TCO) `spliceGo`
// overflowed in the splice — so big files never even PARTITIONED. Both are now
// COMPILED parser entries; lever-B's self-tail-call → `while`-loop conversion
// runs their closures in constant stack. The interpreted path STILL overflows
// the giants (no interpreter TCO) — that is the documented fence; production
// runs the compiled path, which is what these pins exercise.
//
// Mirrors `fenel-lexer-depth.test.ts` (the 6b2 lever-B depth pin): (1) DEPTH —
// the 210k largest corpus file PARTITIONS compiled (interpreted RangeErrors at
// this size, so success proves the loop-form ran); (2) DUAL-PATH — a mid-size
// file partitions identically interpreted ≡ compiled (the loop transform
// changed only the JS text, not the split).
// =========================================================================
const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const spliceSetBodies = (src: string, toks: unknown): unknown =>
  dispatchEngineBody("engine:spliceSetBodies", [src, toks]);
// The whole pre-parse pipeline as parseViaFenelParser runs it: lex → splice →
// layout → split.
const preParse = (src: string): { headered: boolean; name: string; groups: unknown[] } => {
  const lexed = lexAll(src);
  const spliced = spliceSetBodies(src, lexed);
  const toks = layoutTokens(spliced);
  return splitTopLevelDecls(toks);
};

// ~210k chars / tens of thousands of tokens — far past any interpreted recursion
// cap, so a compiled success is itself proof the loop-form (lever-B) path ran.
const BIGGEST = "fenel/modules/engine/lower-to-wasm-ast.fenel";
// A mid-size real file comfortably under the interpreted depth cap even after
// the preceding corpus differential has exercised the interpreter heavily, so
// BOTH paths run for the dual-path equality. `form-fill-cores.fenel` outgrew
// that full-suite stack budget despite still passing in isolation.
const MIDSIZE = "fenel/modules/types/submit.fenel";

describe("parse-file 7d — pre-parse pipeline overflow-free on the compiled path", () => {
  afterAll(() => setParserInterpreted(null));

  it("compiled splice+split PARTITION the 210k largest corpus file", () => {
    const src = read(BIGGEST);
    expect(src.length).toBeGreaterThan(120000); // sanity: this really is huge
    setParserInterpreted(false); // serve the compiled (loop-form) artifact
    const s = preParse(src); // interpreted would RangeError here (no TCO)
    expect(s.groups.length).toBeGreaterThan(20); // it really partitioned
    // every group is a non-empty token run (a real decl partition, not garbage)
    for (const g of s.groups) expect((g as unknown[]).length).toBeGreaterThan(0);
  }, TO);

  it("dual-path — a mid-size file partitions identically interpreted ≡ compiled", () => {
    const src = read(MIDSIZE);
    expect(src.length).toBeGreaterThan(5000); // still a real multi-decl module
    expect(src.length).toBeLessThan(12000); // under the full-suite interpreted cap

    setParserInterpreted(true);
    const interp = preParse(src);

    setParserInterpreted(false);
    const compiled = preParse(src);

    expect(compiled.headered).toBe(interp.headered);
    expect(compiled.name).toBe(interp.name);
    // the FULL partition is identical token-run-for-token-run (the loop transform
    // is execution-only) — a deep equality, not just the per-group lengths.
    expect(compiled.groups).toEqual(interp.groups);
  }, TO);
});
