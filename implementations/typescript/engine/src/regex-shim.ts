// ---------------------------------------------------------------------------
// Regex SHIM SURFACE — the dispatch boundary over the Fenel-bodied regex
// containment / hint / serialization passes (regex-derivative-to-fenel).
//
// Phase R (2026-06-27) renamed this file `regex-derivative.ts` → `regex-shim.ts`:
// slices A/B/C ported every regex ALGORITHM to
// `fenel/modules/engine/regex-{containment,parse,hint}.fenel`, leaving only the
// thin dispatch shims + the sanctioned `$`-key marshal-boundary codec
// (ts-exceptions-ledger B3). Phase R kept this a STANDALONE LIGHTWEIGHT module
// (option B over consolidating into `engine-bodies-dispatch.ts`):
// `type-foundation` / `set-algebra` / `set-syntax` import these shims EAGERLY,
// and `engine-bodies-dispatch.ts` value-imports `type-foundation` + `set-algebra`
// — folding the shims into `engine-bodies-dispatch.ts` would re-fire the
// `type-foundation` load cycle the lazy `require` + lazy-`DriveLetter` getter
// were built to avoid. The shims `require("./engine-bodies-dispatch")` lazily, so
// this file stays harness-free at import time. The "derivative" misnomer is gone;
// only the marshal boundary remains.
//
// This file is THIN SHIMS, not an implementation:
//
//   * `regexStringToPattern` (Slice B) — regex → generic `Pattern`. Dispatches
//     to `engine:regexToPatternMarker` (the threaded-position RD parser +
//     RxNode ADT + lowering live in `fenel/modules/engine/regex-parse.fenel`)
//     and AUTHORS the `$`-keys (the B3 authoring marshal arm below).
//   * `regexHint` / `describeRanges` / `isAnchored` (Slice C) — the cursor-aware
//     validation-hint surface. Dispatch to `engine:regexHint` /
//     `engine:rxhDescribeRanges` / `engine:rxhIsAnchored`; the hint engine
//     (deriv/firstSet/derivGroups + segment tracking + URL/host/query
//     enrichment) lives in `fenel/modules/engine/regex-hint.fenel`.
//   * `patternToRegex` (Slice C / C3) — generic `Pattern` → regex source.
//     READS the Pattern's SetExpr `$`-keys into a plain marker tree (the B3
//     reading marshal arm below) and dispatches to `engine:rxhPatternToRegex`,
//     which folds the marker into the regex string.
//
// The TS `parseRegex` + the RNode walk (`nullable`/`deriv`/`firstSet`/
// `derivGroups`/`mergeRanges`/`complementRanges`/`escapeTo*`) + the segment
// builders + the `patternToRegex` serializer chain were DELETED here (their
// only caller, `regexHint`, is now Fenel) — Slice C netted the large TS cut.
// The public data TYPES (`CharRange`/`Segment`/`FailedAt`/`RegexHint`) stay
// (consumed by
// validation-hints + the index.ts re-exports).
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { Pattern } from "./pattern";
import { match, seq, alt, rep, eps, empty } from "./pattern";
import type { SetExpr } from "./types";
import { peelSetExpr } from "./set-marker";
import type { Maybe } from "./type-foundation";
// Inlined to keep the marshal arm cycle-safe — `Just` is the trivial Maybe
// constructor; importing the VALUE back from type-foundation re-fires the
// load-order cycle (regex-shim is imported by type-foundation). The
// `Maybe` TYPE import is erased at runtime.
const Just = <T>(value: T): Maybe<T> => ({ $tag: "Just", _0: value });

// -- Public data types (consumed by validation-hints + index.ts re-exports) -

export type CharRange = { lo: number; hi: number };

export type Segment = {
  name: string;
  start: number;
  end: number;
  depth?: number;
};

export type FailedAt = {
  position: number;
  got: string;
  expected: string;
};

export type RegexHint = {
  canMatch: boolean;
  canEnd: boolean;
  validNext: CharRange[];
  validNextLabel: string;
  failedAt?: FailedAt;
  matchedCount: number;
  segments: Segment[];
  activeGroup?: string;
};

// ---------------------------------------------------------------------------
// regexHint / describeRanges / isAnchored — the Slice-C hint-surface shims.
//
// `regexHint`'s output is `$`-key-FREE plain data, so there is NO marshal arm:
// the shim tokenizes the pattern + consumed input into `{ ch, code }` pairs
// (code-POINT iteration, BMP-identical to the retired code-unit parser's
// established char-as-codepoint seam), passes `consumed` raw for
// `enrichSegments`' substring slicing,
// dispatches, and re-assembles the JS `RegexHint` (lifting `failedAt` +
// `activeGroup` out of the body's flat `hasFailed` / `hasActiveGroup` flag
// fields). The Fenel owner refuses group-close/tail errors before matching;
// a dispatch exception returns an explicit unavailable hint.
// ---------------------------------------------------------------------------

type RegexHintMarker = {
  canMatch: boolean;
  canEnd: boolean;
  validNext: CharRange[];
  validNextLabel: string;
  hasFailed: boolean;
  failPosition: number;
  failGot: string;
  failExpected: string;
  matchedCount: number;
  segments: Segment[];
  hasActiveGroup: boolean;
  activeGroup: string;
};

export function regexHint(pattern: string, consumed: string): RegexHint {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    const patToks = Array.from(pattern, (ch) => ({ ch, code: ch.codePointAt(0) ?? 0 }));
    const consumedToks = Array.from(consumed, (ch) => ({ ch, code: ch.codePointAt(0) ?? 0 }));
    const m = dispatchEngineBody("engine:regexHint", [patToks, consumedToks, consumed]) as RegexHintMarker;
    return {
      canMatch: m.canMatch,
      canEnd: m.canEnd,
      validNext: m.validNext,
      validNextLabel: m.validNextLabel,
      failedAt: m.hasFailed
        ? { position: m.failPosition, got: m.failGot, expected: m.failExpected }
        : undefined,
      matchedCount: m.matchedCount,
      segments: m.segments,
      activeGroup: m.hasActiveGroup ? m.activeGroup : undefined,
    };
  } catch {
    return {
      canMatch: false,
      canEnd: false,
      validNext: [],
      validNextLabel: "Regex hint unavailable",
      failedAt: { position: 0, got: "", expected: "Regex hint unavailable" },
      matchedCount: 0,
      segments: [],
    };
  }
}

export function describeRanges(ranges: CharRange[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchEngineBody("engine:rxhDescribeRanges", [ranges]) as string;
}

export function isAnchored(pattern: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchEngineBody("engine:rxhIsAnchored", [pattern]) as boolean;
}

// ---------------------------------------------------------------------------
// Regex → generic Pattern conversion (Slice B).
//
// The regex→`Pattern` front-end is Fenel-bodied
// (`fenel/modules/engine/regex-parse.fenel`, `engine:regexToPatternMarker`).
// `regexStringToPattern` below is the dispatch SHIM.
//
// THE B3 HOST-AUTHORING MARSHAL ARM (ts-exceptions-ledger B3, authoring mode).
// The Fenel body emits a plain transport marker so this host leaf can perform
// code-point conversion and construct canonical recursive SetExpr values.
// emits a plain-record MARKER tree (`{ tag: "RPMatch", pred: { tag: "RSEnum",
// chars: […] } }`); `authorPred` builds the registered SeEnum/SeNone/
// SeInterval/SeUnion/SeComplement/SeDiff values, lifted
// through pattern.ts's smart constructors (match/seq/alt/rep/eps/empty) via
// `authorPat`. This is the INVERSE of the C3 reading arm below + of 1a-cont's
// `setExprToWs` *reading* arm. Char-class interval bounds arrive as code
// POINTS (numbers — a `.fenel` body can't `charCodeAt`); `authorPred`
// `String.fromCodePoint`s them. Literal char enums arrive as `ch` strings.
// ---------------------------------------------------------------------------

type RegexPredMarker =
  | { tag: "RSEnum"; chars: string[] }
  | { tag: "RSNone" }
  | { tag: "RSInterval"; lo: number; hi: number }
  | { tag: "RSUnion"; parts: RegexPredMarker[] }
  | { tag: "RSComplement"; inner: RegexPredMarker }
  | { tag: "RSDot" };

type RegexPatMarker =
  | { tag: "RPEmpty" }
  | { tag: "RPEps" }
  | { tag: "RPMatch"; pred: RegexPredMarker }
  | { tag: "RPSeq"; a: RegexPatMarker; b: RegexPatMarker }
  | { tag: "RPAlt"; a: RegexPatMarker; b: RegexPatMarker }
  | { tag: "RPRep"; child: RegexPatMarker; min: number; max: number };

/** Author a Fenel pred-marker into a canonical SetExpr (mirrors the retired
 *  `rangesToSetExpr` + the `rNodeToPattern` predicate cases). */
function authorPred(m: RegexPredMarker): SetExpr {
  switch (m.tag) {
    case "RSEnum":
      return { $tag: "SeEnum", values: m.chars };
    case "RSNone":
      return { $tag: "SeNone" };
    case "RSInterval":
      return { $tag: "SeInterval", interval: {
          lo: Just({ value: String.fromCodePoint(m.lo), inclusive: true }),
          hi: Just({ value: String.fromCodePoint(m.hi), inclusive: true }),
        } };
    case "RSUnion":
      return { $tag: "SeUnion", branches: m.parts.map(authorPred) };
    case "RSComplement":
      return { $tag: "SeComplement", inner: authorPred(m.inner) };
    case "RSDot":
      // Any character except newline
      return { $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeEnum", values: ["\n"] } };
  }
}

/** Author a Fenel pattern-marker into a real `Pattern`, applying pattern.ts's
 *  smart constructors exactly where the retired `rNodeToPattern` did (the -1
 *  rep-max sentinel becomes Infinity). */
function authorPat(m: RegexPatMarker): Pattern {
  switch (m.tag) {
    case "RPEmpty":
      return empty;
    case "RPEps":
      return eps;
    case "RPMatch":
      return match(authorPred(m.pred));
    case "RPSeq":
      return seq(authorPat(m.a), authorPat(m.b));
    case "RPAlt":
      return alt(authorPat(m.a), authorPat(m.b));
    case "RPRep":
      return rep(authorPat(m.child), m.min, m.max === -1 ? Infinity : m.max);
  }
}

/**
 * Convert a regex string to a generic Pattern over List<Char>.
 * Anchors are honored: unanchored patterns get .* wrapping (matches JS
 * RegExp.test() semantics).
 *
 *   regexStringToPattern("^[a-z]+$")   exact-match lowercase strings
 *   regexStringToPattern("foo")        strings containing "foo"
 *
 * Slice-B SHIM: tokenizes the regex char→{ch, code} (code-POINT iteration,
 * BMP-identical to the retired parser's code-unit charAt — astral chars, which
 * the corpus never uses, are handled by code point not surrogate pair),
 * dispatches to the Fenel body, and authors canonical SetExpr values. Returns null on
 * parse error. The dispatchEngineBody import is a lazy `require` so loading
 * regex-shim (during type-foundation load) does NOT eagerly pull the
 * engine harness (the load-cycle guard — DriveLetter's NAMED_SET is also lazy).
 */
export function regexStringToPattern(regex: string): Pattern | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
    const toks = Array.from(regex, (ch) => ({ ch, code: ch.codePointAt(0) ?? 0 }));
    // B3: admit only the owner's own-data Ok envelope before authoring keys.
    const result = dispatchEngineBody("engine:regexToPatternMarker", [toks]);
    if (result === null || typeof result !== "object") return null;
    const tag = Object.getOwnPropertyDescriptor(result, "$tag");
    const payload = Object.getOwnPropertyDescriptor(result, "_0");
    if (!tag || !("value" in tag) || tag.value !== "Ok"
      || !payload || !("value" in payload)) return null;
    return authorPat(payload.value as RegexPatMarker) ?? null;
  } catch (e) {
    // module-substrate M1 — do NOT flatten a harness-unavailability into `null`.
    // `null` reaches `set-syntax.ts`'s `Failed to parse set expression … Invalid
    // regex …`, which names the regex and hides the real cause. A regex set-form
    // needs the Fenel-bodied `engine:regexToPatternMarker`, so a source carrying
    // one CANNOT be parsed while the engine module graph is still initializing —
    // by either parser, since the TypeScript branch routes here too. That is a
    // real fence (see `design/ts-exceptions-ledger.md` section B1 amendment), and
    // it predates M1; what M1 owes it is an accurate message.
    if ((e as { name?: string } | null)?.name === "HarnessUnavailableError") throw e;
    if (typeof process !== "undefined" && process.env?.FENEL_REGEX_SHIM_DEBUG) console.error("[regex-shim DEBUG]", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pattern → regex source (Slice C / C3) — best-effort inverse for
// serialization (SQL `~`, JSON Schema `pattern`, text-syntax `/.../`
// formatting). Returns null when the Pattern carries predicates that have no
// clean regex form (typed $where over records, $named sets that aren't pure
// char classes, etc.).
//
// The serializer (predToCharClass / predToRegex / repToSuffix /
// patternToRegexInner + escaping) is Fenel-bodied
// (`fenel/modules/engine/regex-hint.fenel`, `engine:rxhPatternToRegex`). This
// shim is the B3 structural-reading marshal arm — the INVERSE of `authorPat`/
// `authorPred` above: it walks the Pattern into a plain marker tree (`Pt…`
// nodes + `Pr…` preds), reading canonical SetExpr through `peelSetExpr`, and lets the body emit
// the regex string. A pred that has no clean char-class form lowers to a
// `PrOther` marker (the body's `null` channel). The Infinity rep-max maps to
// the `-1` sentinel the body uses.
// ---------------------------------------------------------------------------

type RegexPredReadMarker =
  | { tag: "PrAll" }
  | { tag: "PrEnum"; chars: string[] }
  | { tag: "PrInterval"; lo: string; loInc: boolean; hi: string; hiInc: boolean }
  | { tag: "PrUnion"; parts: RegexPredReadMarker[] }
  | { tag: "PrComplement"; inner: RegexPredReadMarker }
  | { tag: "PrDiffAll"; inner: RegexPredReadMarker }
  | { tag: "PrOther" };

type RegexPatReadMarker =
  | { tag: "PtEmpty" }
  | { tag: "PtEps" }
  | { tag: "PtMatch"; pred: RegexPredReadMarker }
  | { tag: "PtSeq"; a: RegexPatReadMarker; b: RegexPatReadMarker }
  | { tag: "PtAlt"; a: RegexPatReadMarker; b: RegexPatReadMarker }
  | { tag: "PtRep"; child: RegexPatReadMarker; min: number; max: number }
  | { tag: "PtGroup"; name: string; child: RegexPatReadMarker };

/** Read a SetExpr predicate into a plain pred marker. Anything that
 *  is not one of the char-class-expressible shapes lowers to `PrOther` (the
 *  body's `null` channel) — mirrors where the retired `predToCharClass` /
 *  `predToRegex` returned null. */
function readPred(pred: SetExpr): RegexPredReadMarker {
  // 3b-0: route through the canonical dual-read recognizer (`$`-key OR `$tag`).
  const v = peelSetExpr(pred);
  switch (v?.kind) {
    case "SeAll": return { tag: "PrAll" };
    case "SeEnum": {
      // Non-string values lower to "" (length 0) so the body's single-char check
      // rejects them — matching the retired `typeof v !== "string"` → null.
      const chars = v.values.map((x) => (typeof x === "string" ? x : ""));
      return { tag: "PrEnum", chars };
    }
    case "SeInterval": {
      const lo = v.interval.lo as { $tag?: string; _0?: { value?: unknown; inclusive?: boolean } };
      const hi = v.interval.hi as { $tag?: string; _0?: { value?: unknown; inclusive?: boolean } };
      if (
        lo.$tag === "Just" &&
        hi.$tag === "Just" &&
        typeof lo._0?.value === "string" &&
        typeof hi._0?.value === "string"
      ) {
        return {
          tag: "PrInterval",
          lo: lo._0.value,
          loInc: !!lo._0.inclusive,
          hi: hi._0.value,
          hiInc: !!hi._0.inclusive,
        };
      }
      return { tag: "PrOther" };
    }
    case "SeUnion": return { tag: "PrUnion", parts: v.branches.map(readPred) };
    case "SeComplement": return { tag: "PrComplement", inner: readPred(v.inner) };
    case "SeDiff": {
      if (peelSetExpr(v.left)?.kind === "SeAll") return { tag: "PrDiffAll", inner: readPred(v.right) };
      return { tag: "PrOther" };
    }
    default: return { tag: "PrOther" };
  }
}

/** Read a Pattern AST into a plain marker tree (the C3 reading marshal). */
function readPat(p: Pattern): RegexPatReadMarker {
  switch (p.t) {
    case "empty":
      return { tag: "PtEmpty" };
    case "eps":
      return { tag: "PtEps" };
    case "match":
      return { tag: "PtMatch", pred: readPred(p.pred) };
    case "seq":
      return { tag: "PtSeq", a: readPat(p.a), b: readPat(p.b) };
    case "alt":
      return { tag: "PtAlt", a: readPat(p.a), b: readPat(p.b) };
    case "rep":
      return { tag: "PtRep", child: readPat(p.child), min: p.min, max: p.max === Infinity ? -1 : p.max };
    case "group":
      return { tag: "PtGroup", name: p.name, child: readPat(p.child) };
  }
}

/**
 * Best-effort inverse of regexStringToPattern. Returns a regex source string
 * (without surrounding `/.../`) anchored with `^...$` for exact-match
 * semantics. Returns null when the Pattern carries predicates that cannot be
 * expressed as a regex (typed $where, $named non-char predicates, etc.).
 *
 * Slice-C SHIM: reads the Pattern into a marker tree + dispatches to the Fenel
 * serializer body (`engine:rxhPatternToRegex`), which returns `{ ok, value }`;
 * `ok === false` is the `null` channel.
 */
export function patternToRegex(p: Pattern): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  const marker = readPat(p);
  const r = dispatchEngineBody("engine:rxhPatternToRegex", [marker]) as { ok: boolean; value: string };
  return r.ok ? r.value : null;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("regex-shim") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_regex_shim from "./regex-shim";
import { registerEngineModule as __reg_regex_shim } from "./engine-require";
__reg_regex_shim("regex-shim", __self_regex_shim);
