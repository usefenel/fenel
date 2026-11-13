// parser-substrate Phase 5c — the load-bearing ADDITIVE proof: the parse-cache
// + bootstrap artifact change boot behaviour by NOTHING. Three guarantees:
//   1. boot-equivalence — loadFenelModule(src) is byte-identical with the cache
//      ON vs OFF, over the whole corpus (the cached AST reproduces the live
//      parse exactly, incl. page.fenel's one undefined-valued key).
//   2. coverage — every boot corpus file is an actual cache HIT (the cache is
//      populated + used, not silently always-missing).
//   3. bootstrap fidelity — each bootstrap entry's pre-parsed AST === parse(src)
//      today, and the source-hash gate is fresh.
import { describe, test, expect } from "bun:test";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import {
  PARSE_CACHE_AST_ABI_VERSION,
  PARSER_BOOTSTRAP_AST_ABI_VERSION,
  decodeParseCacheArtifact,
  decodeParserBootstrapArtifact,
  parseCacheKey,
  parseCacheHas,
  setParseCacheEnabled,
  setFenelParserLegacy,
} from "./parse-cache";
import { FENCE_FALLBACK } from "../scripts/generate-parse-cache";
import {
  PARSER_BOOTSTRAP_JSON,
  PARSER_BOOTSTRAP_SOURCE_HASH,
  PARSER_BOOTSTRAP_COUNT,
  PARSER_BOOTSTRAP_VERSION,
} from "./generated/parser-bootstrap.generated";
import { PARSE_CACHE_VERSION } from "./generated/parse-cache.generated";
import { isSetExpr } from "./types";
import type { SetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of SetExprs. The live FENEL parser (cache-OFF fallback)
// goes through the flipped producer while the committed cache is TS-faithful
// (`$`-key), so a handful of entity files (refined / `Id<X>` types) differ on
// FORM only. `cf` deeply lowers ANY-form SetExpr back to `$`-key (the
// oracle-composition fold) so the Fenel-vs-cache equivalence check stays a
// STRUCTURE/VALUE comparison (setExprToDollarKey rewrites only the
// discriminator). Applied to BOTH the cache-ON and cache-OFF loads.
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
const cfStr = (x: unknown): string => JSON.stringify(cf(x));

describe("parse artifacts — exact AST ABI gate", () => {
  test("the runtime refuses a mismatched main cache without decoding it", () => {
    expect(decodeParseCacheArtifact(
      PARSE_CACHE_AST_ABI_VERSION - 1,
      "not valid JSON because mismatched artifacts must stay unread",
    )).toBeNull();
  });

  test("the runtime refuses a mismatched always-on bootstrap without decoding it", () => {
    expect(decodeParserBootstrapArtifact(
      PARSER_BOOTSTRAP_AST_ABI_VERSION + 1,
      "not valid JSON because mismatched artifacts must stay unread",
    )).toBeNull();
  });

  test("both committed artifacts carry the current AST ABI", () => {
    expect(PARSE_CACHE_VERSION).toBe(PARSE_CACHE_AST_ABI_VERSION);
    expect(PARSER_BOOTSTRAP_VERSION).toBe(PARSER_BOOTSTRAP_AST_ABI_VERSION);
  });
});

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const files = globSync("fenel/**/*.fenel", { cwd: ROOT }).sort();
const srcs = files.map((f) => ({ f: f.split("\\").join("/"), src: readFileSync(join(ROOT, f), "utf8") }));

// The set of files that parse standalone (every boot file does; the 2 that don't
// — examples/demo + modules/inputs — are imported nowhere, S0 audit §1).
const bootSrcs = srcs.filter(({ src }) => {
  try { parse(src); return true; } catch { return false; }
});

describe("parse-cache — boot-equivalence (cache ON ≡ the TS oracle it memoizes)", () => {
  // The committed cache is TS-faithful (Fenel-driven for the non-fence corpus,
  // which is byte-identical to TS, + TS-driven for the FENCE_FALLBACK set — the
  // 5d byte-identity gate). So boot output is byte-identical to HEAD. With the 5d
  // flip, cache-OFF now uses the FENEL parser, so the OFF measurement forces
  // LEGACY (the TS oracle) — proving the cache faithfully memoizes the TS parser
  // (the additive guarantee: the cache changes boot by NOTHING).
  test("cache-ON is byte-identical to the TS-parser load, over the whole corpus", () => {
    let mismatches = 0;
    const sample: string[] = [];
    for (const { f, src } of bootSrcs) {
      setParseCacheEnabled(false);
      setFenelParserLegacy(true);
      const off = JSON.stringify(loadFenelModule(src, "probe"));
      setFenelParserLegacy(false);
      setParseCacheEnabled(true);
      const on = JSON.stringify(loadFenelModule(src, "probe"));
      if (off !== on) { mismatches++; if (sample.length < 5) sample.push(f); }
    }
    setParseCacheEnabled(true);
    expect({ mismatches, sample }).toEqual({ mismatches: 0, sample: [] });
  }, 1_800_000);
});

describe("parse-cache — the 5d flip is dormant for non-fence boot files (Fenel ≡ cache)", () => {
  // The NEW 5d assertion: for every boot file NOT in the enumerated fence set, the
  // live FENEL parser (cache-OFF, the flipped fallback) loads byte-identically to
  // the committed cache (cache-ON, TS-faithful). This is the "loadFenelModule
  // byte-identical Fenel-driven vs TS-driven" proof, scoped to where it holds —
  // the fence files are TS-fallback by construction (and proven divergent by
  // fenel-module-corpus-parity.test.ts).
  test("cache-OFF Fenel-driven ≡ cache-ON for every non-fence boot file", () => {
    let mismatches = 0;
    const sample: string[] = [];
    for (const { f, src } of bootSrcs) {
      if (FENCE_FALLBACK.has(f)) continue;
      setParseCacheEnabled(true);
      const on = cfStr(loadFenelModule(src, "probe"));
      setParseCacheEnabled(false); // cache OFF ⇒ the flipped Fenel-driven fallback
      const off = cfStr(loadFenelModule(src, "probe"));
      setParseCacheEnabled(true);
      if (off !== on) { mismatches++; if (sample.length < 5) sample.push(f); }
    }
    setParseCacheEnabled(true);
    expect({ mismatches, sample }).toEqual({ mismatches: 0, sample: [] });
  }, 1_800_000);
});

describe("parse-cache — coverage (every boot file is a warm hit)", () => {
  test("every standalone-parsing corpus file is present in the committed cache", () => {
    const misses = bootSrcs.filter(({ src }) => !parseCacheHas(src)).map((x) => x.f);
    expect(misses).toEqual([]);
    expect(bootSrcs.length).toBeGreaterThan(200); // sanity: the corpus is loaded
  });
});

describe("parser-bootstrap — fidelity + freshness", () => {
  const boot = JSON.parse(PARSER_BOOTSTRAP_JSON) as Record<string, { srcHash: string; ast: unknown }>;

  test("the artifact carries the expected count", () => {
    expect(Object.keys(boot).length).toBe(PARSER_BOOTSTRAP_COUNT);
  });

  test("each bootstrap entry's pre-parsed AST === parse(src) today, and srcHash is fresh", () => {
    const stale: string[] = [];
    for (const [rel, entry] of Object.entries(boot)) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      if (parseCacheKey(src) !== entry.srcHash) { stale.push(`${rel} (srcHash)`); continue; }
      if (JSON.stringify(parse(src)) !== JSON.stringify(entry.ast)) stale.push(`${rel} (ast)`);
    }
    expect(stale).toEqual([]);
  });

  test("the source-hash gate matches the committed entries", () => {
    const pairs = Object.entries(boot)
      .map(([rel, e]) => `${rel}:${e.srcHash}`)
      .sort();
    expect(parseCacheKey(pairs.join("\n"))).toBe(PARSER_BOOTSTRAP_SOURCE_HASH);
  });
});
