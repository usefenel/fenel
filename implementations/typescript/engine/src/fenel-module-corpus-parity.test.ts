// parser-substrate Phase 5d — THE corpus-parity GATE (the loader flip's contract).
// brief: `workstreams/parser-substrate/briefs/phase-5d-loader-flip-corpus-parity.md`.
//
// The flip swaps `parsedViaCache`'s cache-MISS fallback from the TS parser to the
// Fenel-bodied parser (`parseViaFenelParser`). This gate proves the two parsers
// agree over the WHOLE corpus modulo an EXPLICIT, ENUMERATED fence set:
//
//   1. The live Fenel-vs-TS divergence set EQUALS `FENCE_FALLBACK` (both
//      directions — a NEW divergence (regression) AND a CLOSED fence (a file that
//      now parses identically but is still listed) BOTH fail). This is the same
//      constant the cache generator uses to keep the committed cache byte-
//      identical, so the gate and the cache cannot drift apart.
//   2. `loadFenelModule` is FenelModule-deep-equal Fenel-driven vs TS-driven over
//      a sample of EQUAL files — the end-to-end demonstration through the flipped
//      seam (AST parity ⇒ FenelModule parity, since loadFenelModule is a pure
//      function of the parse AST; the sample makes it concrete).
//
// SLOW gate (Fenel-drives ~113 corpus files via the compiled per-group path) —
// run offline; the long timeouts are intentional. The TS parser stays as the
// parity ORACLE (Phase 7 deletes it).
import { describe, test, expect } from "bun:test";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./fenel-parser";
import { loadFenelModule } from "./fenel-module";
import { setParseCacheEnabled, setFenelParserLegacy } from "./parse-cache";
import { parseViaFenelParser, PARSE_VIA_FENEL_FAIL } from "./engine-bodies-dispatch";
import { FENCE_FALLBACK } from "../scripts/generate-parse-cache";
import { isSetExpr } from "./types";
import type { SetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const files = globSync("fenel/**/*.fenel", { cwd: ROOT }).sort();
const srcs = files.map((f) => ({ f: f.split("\\").join("/"), src: readFileSync(join(ROOT, f), "utf8") }));

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of SetExprs. The Fenel parser path goes through the flipped
// producer while the TS-parser ORACLE still emits `$`-key, so a handful of
// entity files (refined / `Id<X>` types) diverge on FORM only. `cf` deeply
// lowers ANY-form SetExpr back to `$`-key (the oracle-composition fold) so the
// divergence check below stays a STRUCTURE/VALUE comparison — a real
// structural/value divergence still counts (setExprToDollarKey rewrites only the
// discriminator). Applied to BOTH parser outputs before the byte-diff.
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

// Round-trip both sides through JSON exactly as the cache generator does, so the
// divergence check === the cache byte-diff (the gate's central invariant). The
// `cf` fold makes the comparison SetExpr-form-agnostic (3b-2 producer flip).
const rt = (x: unknown): string => JSON.stringify(JSON.parse(JSON.stringify(cf(x))));

describe("5d corpus parity — the Fenel-vs-TS divergence set EQUALS FENCE_FALLBACK", () => {
  test("every divergent/failing file is enumerated, and every enumerated file actually diverges", () => {
    const liveDiverge = new Set<string>();
    for (const { f, src } of srcs) {
      let ts: unknown;
      try {
        ts = parse(src, "en");
      } catch {
        continue; // non-boot (modules/inputs) — not cached, not compared.
      }
      const fen = parseViaFenelParser(src);
      const diverges = fen === PARSE_VIA_FENEL_FAIL || rt(fen) !== rt(ts);
      if (diverges) liveDiverge.add(f);
    }
    // both directions — extra = a NEW divergence not yet fenced (a regression);
    // missing = a CLOSED fence still in the list (shrink it).
    const extra = [...liveDiverge].filter((f) => !FENCE_FALLBACK.has(f)).sort();
    const missing = [...FENCE_FALLBACK].filter((f) => !liveDiverge.has(f)).sort();
    expect({ extra, missing }).toEqual({ extra: [], missing: [] });
  }, 1_800_000);
});

describe("5d corpus parity — loadFenelModule FenelModule-deep-equal (Fenel-driven ≡ TS-driven)", () => {
  // A sample of known-EQUAL files spanning entity defs / capability typeclasses /
  // module function bodies — loaded through the live parser path (cache OFF) with
  // the Fenel driver vs the TS legacy parser; the resulting FenelModule must be
  // deep-equal. AST parity (test above) implies this for the whole corpus; the
  // sample demonstrates it end-to-end through the flipped seam.
  const SAMPLE = [
    "fenel/modules/ai/capability.fenel",
    "fenel/modules/email/capability.fenel",
    "fenel/std/entities/Bot.fenel",
    "fenel/std/entities/account.fenel",
    "fenel/std/entities/plan.fenel",
  ];
  test("the sample loads byte-identically with the Fenel parser vs the TS parser", () => {
    setParseCacheEnabled(false); // force the live parser path (skip the warm cache)
    try {
      for (const rel of SAMPLE) {
        const src = readFileSync(join(ROOT, rel), "utf8");
        setFenelParserLegacy(true);
        const tsMod = JSON.stringify(loadFenelModule(src, "parity"));
        setFenelParserLegacy(false);
        const fenMod = JSON.stringify(loadFenelModule(src, "parity"));
        expect({ rel, mod: fenMod }).toEqual({ rel, mod: tsMod });
      }
    } finally {
      setFenelParserLegacy(false);
      setParseCacheEnabled(true);
    }
  }, 600_000);
});
