// parser-substrate Phase 6b2 — the permanent depth-fence pin (lever B).
//
// Lever B (self-TAIL-call → while-loop emission in the JS compile pipeline)
// kills the COMPILED lexer's recursion-depth fence. Before 6b2 the compiled
// `lexAll` stack-overflowed at ~31k chars; 18 of 256 corpus files exceed that,
// the largest being `lower-to-wasm-ast.fenel` at ~210k. This file is the
// permanent regression pin replacing the throwaway B0 probe (`_b0_probe.ts`):
//
//   1. DEPTH — compiled `lexAll` over the LARGEST corpus file byte-equals the
//      frozen TS `tokenize` oracle. Interpreted lexAll CANNOT do this (its cap
//      is ~22.7k), so success is itself proof the compiled (loop-form) path ran.
//   2. DUAL-PATH — a mid-size real file (< the interpreted cap) lexes
//      byte-identically on BOTH the interpreted and compiled paths, each ≡ the
//      TS oracle. Confirms the loop transform changed only the JS text, not the
//      token stream.
//
// The INTERPRETED cap remains (no consumer: the differentials use tiny inputs;
// boot + P5 run compiled) and is recorded as a fence, not fixed here.

import { describe, it, expect, afterAll } from "vitest";
import { tokenize } from "./fenel-parser";
import { dispatchEngineBody, setParserInterpreted } from "./engine-bodies-dispatch";
import { readFileSync } from "fs";
import { join } from "path";

type TokRec = { t: string; v: string; ln: number; col: number };
const lexAll = (s: string): TokRec[] => dispatchEngineBody("engine:lexAll", [s]) as TokRec[];
const norm = (t: TokRec) => ({ t: t.t, v: t.v, ln: t.ln, col: t.col });
const lexNorm = (s: string) => lexAll(s).map(norm);
const tsNorm = (s: string) => tokenize(s).map(norm);

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

// The largest module in the corpus — ~210k chars, ~6.7× the old compiled
// depth cap. A pure depth stress on the per-char/per-token lexer recursion.
const BIGGEST = "fenel/modules/engine/lower-to-wasm-ast.fenel";
// A mid-size real file comfortably under the ~22.7k interpreted cap, so BOTH
// paths can lex it for the dual-path equality.
const MIDSIZE = "fenel/modules/telegram/form-fill-cores.fenel";

afterAll(() => setParserInterpreted(null));

describe("Phase 6b2 — compiled lexer depth fence is gone (corpus-wide)", () => {
  it("compiled lexAll over the 210k largest corpus file byte-equals TS tokenize", () => {
    const src = read(BIGGEST);
    expect(src.length).toBeGreaterThan(120000); // sanity: this really is huge
    setParserInterpreted(false); // serve the compiled (loop-form) artifact
    const compiled = lexNorm(src); // interpreted would RangeError here
    expect(compiled).toEqual(tsNorm(src));
    expect(compiled.length).toBeGreaterThan(10000);
  });

  it("dual-path — mid-size file lexes identically interpreted, compiled, and TS oracle", () => {
    const src = read(MIDSIZE);
    expect(src.length).toBeLessThan(22000); // under the interpreted depth cap
    const ts = tsNorm(src);

    setParserInterpreted(true);
    const interp = lexNorm(src);
    expect(interp).toEqual(ts);

    setParserInterpreted(false);
    const compiled = lexNorm(src);
    expect(compiled).toEqual(ts);
  });
});
