// ---------------------------------------------------------------------------
// parse-cache — the parser-substrate Phase 5c warm-boot sidecar reader.
//
// THE seam wrapper around `parse(src)`. `loadFenelModule` (fenel-module.ts:195)
// calls `parsedViaCache(src, locale)` instead of `parse(src, locale)`: a hit on
// the checked-in cache (src+locale → pre-parsed program JSON) skips the parse;
// a miss falls through to the live parser. The payload is the parser-AGNOSTIC
// `parse(src)` AST — identical bytes whether the TS parser (today) or the Fenel
// parser (5d) produced it.
//
// This is the ONE genuinely-new runtime-TS surface for 5c (the loader-plumbing
// addition the TS ledger flags): read + hash-compare + select, ZERO
// parsing/validation logic. The cache table is a committed DATA artifact
// (`generated/parse-cache.generated.ts`); regeneration is build-time tooling
// (`scripts/generate-parse-cache.ts`), never a boot-time write — mirroring the
// codeName-lock + compiled-parser discipline (regenerate-by-tooling, check-in-CI).
//
// 5d note: the `parse(src)` fallback below is the SINGLE line the parser flip
// swaps (`parse` → the Fenel-parser entry); the cache wrapper is untouched.
// ---------------------------------------------------------------------------

import { parse } from "./fenel-parser";
import type { Expression } from "./types";
import {
  PARSE_CACHE_JSON,
  PARSE_CACHE_VERSION,
} from "./generated/parse-cache.generated";
import {
  PARSER_BOOTSTRAP_JSON,
  PARSER_BOOTSTRAP_VERSION,
} from "./generated/parser-bootstrap.generated";
import {
  parseViaFenelParser,
  PARSE_VIA_FENEL_FAIL,
  harnessUnavailableReason,
} from "./engine-bodies-dispatch";
import { recordBootParseDeficit, currentFenelModuleLoad } from "./engine-require";
import { parseCacheKey } from "./parse-cache-key";
import {
  PARSE_CACHE_AST_ABI_VERSION,
  PARSER_BOOTSTRAP_AST_ABI_VERSION,
} from "./parse-cache-abi";

export { parseCacheKey } from "./parse-cache-key";
export {
  PARSE_CACHE_AST_ABI_VERSION,
  PARSER_BOOTSTRAP_AST_ABI_VERSION,
} from "./parse-cache-abi";

function parseArtifactAstAbiCompatible(
  version: unknown,
  expectedVersion: number,
): boolean {
  return version === expectedVersion;
}

/** Decode only an exact-ABI artifact. Incompatible bytes are never parsed. */
function parseArtifactJsonForAstAbi<T>(
  version: unknown,
  expectedVersion: number,
  json: string,
): T | null {
  if (!parseArtifactAstAbiCompatible(version, expectedVersion)) return null;
  return JSON.parse(json) as T;
}

export function decodeParseCacheArtifact<T>(
  version: unknown,
  json: string,
): T | null {
  return parseArtifactJsonForAstAbi(version, PARSE_CACHE_AST_ABI_VERSION, json);
}

export function decodeParserBootstrapArtifact<T>(
  version: unknown,
  json: string,
): T | null {
  return parseArtifactJsonForAstAbi(
    version,
    PARSER_BOOTSTRAP_AST_ABI_VERSION,
    json,
  );
}

// The committed table is a single JSON blob (a string literal in the generated
// `.ts` — keeps tsc cheap: no deep object-literal inference) parsed once, lazily.
// `undefined` means unread; `null` means the artifact's AST ABI was refused.
let _table: Record<string, unknown> | null | undefined;
function table(): Record<string, unknown> | null {
  if (_table === undefined) {
    _table = decodeParseCacheArtifact<Record<string, unknown>>(
      PARSE_CACHE_VERSION,
      PARSE_CACHE_JSON,
    );
  }
  return _table;
}

// The BOOTSTRAP table — the cold-cache boot safety net (decide-substrate P2
// K0-repair-3; the 5c artifact, now actually wired in). Content-keyed off each
// entry's `srcHash` (the same `parseCacheKey` primitive, so lookups agree by
// construction). Consulted AFTER the main table, BEFORE the live parsers, but
// only when its embedded AST ABI is exact:
// the TS parser's regex-set-form arm dispatches through the engine harness, so
// TS-parsing a regex-carrying file DURING std/engine module init re-enters the
// mid-boot harness (require-cycle TDZ) — a cold main cache without this net is
// an un-bootable registry (the 2026-07-02 CI crash). Deliberately NOT gated on
// `_enabled`: it is boot integrity, not cache policy.
let _bootTable: Map<string, unknown> | null | undefined;
function bootTable(): Map<string, unknown> | null {
  if (_bootTable === undefined) {
    const entries = decodeParserBootstrapArtifact<Record<
      string,
      { srcHash: string; ast: unknown }
    >>(
      PARSER_BOOTSTRAP_VERSION,
      PARSER_BOOTSTRAP_JSON,
    );
    _bootTable = entries === null
      ? null
      : new Map(Object.values(entries).map((e) => [e.srcHash, e.ast]));
  }
  return _bootTable;
}

// Default-on (the primary boot mechanism, P0 §3). `FENEL_PARSE_CACHE=0` forces
// the live parser for the whole process; `setParseCacheEnabled` toggles it at
// call time (the boot-equivalence test flips it between two loads).
let _enabled = (typeof process !== "undefined" ? process.env["FENEL_PARSE_CACHE"] : undefined) !== "0";
export function setParseCacheEnabled(on: boolean): void { _enabled = on; }
export function parseCacheEnabled(): boolean { return _enabled; }

// module-substrate M1 — parse PROVENANCE counters. Both parsers emit identical
// ASTs over the corpus, so a test CANNOT tell which one ran by comparing output.
// Without these, a regression that made `parsedViaCache` always take the
// TypeScript branch would be invisible to every assertion. Counted at the exact
// points the selector commits, so the canary can assert provenance through the
// PRODUCTION path rather than by calling `parseViaFenelParser` directly.
let _servedByFenel = 0;
let _servedByTs = 0;
export function parseProvenanceCounts(): { readonly fenel: number; readonly ts: number } {
  return { fenel: _servedByFenel, ts: _servedByTs };
}

// parser-substrate Phase 5d — `FENEL_PARSER_LEGACY=1` forces the TS parser
// corpus-wide on cache MISSES (emergency rollback of the loader flip — the
// `FENEL_LEGACY_DISPATCH` precedent). Default OFF: the Fenel-bodied parser drives
// misses, with the TS parser as the per-form fallback (the enumerated fences) +
// the non-`en` locale escape. `setFenelParserLegacy` toggles it at call time.
let _legacyParser = (typeof process !== "undefined" ? process.env["FENEL_PARSER_LEGACY"] : undefined) === "1";
export function setFenelParserLegacy(on: boolean): void { _legacyParser = on; }
export function fenelParserLegacy(): boolean { return _legacyParser; }

/** Whether a (src, locale) is present in the committed cache. (Test/tooling
 *  introspection — proves a corpus file is actually served warm.) */
export function parseCacheHas(src: string, locale?: string): boolean {
  const t = table();
  return t !== null
    && Object.prototype.hasOwnProperty.call(t, parseCacheKey(src, locale));
}

/**
 * Parse `src` via the warm cache when enabled + present, else the live parser.
 * The ONE boot-plumbing call site: `loadFenelModule`. Returns the SAME shape
 * `parse(src, locale)` returns (the cached value is the JSON round-trip of a
 * prior parse — access-identical; see the S0 audit on page.fenel's one
 * undefined-valued key).
 */
export function parsedViaCache(src: string, locale?: string): Expression {
  const key = parseCacheKey(src, locale);
  if (_enabled) {
    const t = table();
    if (t !== null && Object.prototype.hasOwnProperty.call(t, key)) {
      return t[key] as Expression;
    }
  }
  // Bootstrap net (K0-repair-3): the pre-parsed init-cycle + regex-set-form
  // entries, served on a main-table miss so a COLD cache still boots (see
  // `bootTable`). en-only, like the boot corpus itself.
  if (locale === undefined || locale === "en") {
    const boot = bootTable()?.get(key);
    if (boot !== undefined) return boot as Expression;
  }
  // Cache MISS — parser-substrate Phase 5d (THE flip): the Fenel-bodied parser
  // drives, with the TS parser as the fallback for forms it doesn't yet cover
  // (it returns the `PARSE_VIA_FENEL_FAIL` sentinel) + the emergency-rollback
  // (`FENEL_PARSER_LEGACY`) and non-`en`-locale escapes.
  //
  // CORRECTED by module-substrate M1 (2026-08-09). This used to claim "Boot
  // NEVER reaches here (every boot file is a cache HIT)". That is the design
  // INTENT, not an invariant: the moment a `.fenel` source is edited it misses
  // the content-addressed cache, and if a module-scope `loadFenelModule` loads
  // it, boot reaches exactly here. Believing the old claim is what let the
  // re-entry below go unnoticed — and HEAD shipped in that state. The result is the SAME shape `parse(src, locale)` returns (the
  // parseProgram bare/`{program}` contract — `parseViaFenelParser` replicates it).
  if (_legacyParser || (locale !== undefined && locale !== "en")) { _servedByTs++; return parse(src, locale); }
  // module-substrate M1 — the readiness boundary. The interpreted Fenel parser
  // needs the harness, the harness needs the completed engine module graph, and
  // a module-scope miss happens INSIDE that graph. Asking anyway used to
  // host-require an in-flight module, leave it half-evaluated, and crash an
  // unrelated consumer later (the whole point of this phase). Decide here,
  // before `parseViaFenelParser` can touch a require, and serve the miss from
  // the TypeScript parser — the same branch the broad catch reached anyway,
  // minus the graph corruption. The deficit is recorded + logged, and the audit
  // fails on it until the cache is regenerated, so parity coverage for the
  // changed source is owed rather than silently skipped.
  const unavailable = harnessUnavailableReason();
  if (unavailable !== null) {
    // `cacheDisabled` is load-bearing for the audit, not decoration. When the
    // cache is deliberately switched off, EVERY source misses, and a miss then
    // says nothing about whether the COMMITTED cache is stale. Counting those
    // would make `FENEL_PARSE_CACHE=0 audit --ci` report hundreds of phantom
    // deficits that regenerating cannot clear.
    recordBootParseDeficit(currentFenelModuleLoad() ?? "<unknown>", key, !_enabled);
    _servedByTs++;
    return parse(src, locale);
  }
  const fen = parseViaFenelParser(src);
  if (fen === PARSE_VIA_FENEL_FAIL) { _servedByTs++; return parse(src, locale); }
  _servedByFenel++;
  return fen as Expression;
}
