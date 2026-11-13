// SUBSTRATE
// ---------------------------------------------------------------------------
// parser-fixities — lazy projection of the built-in `Infixable` / `Prefixable`
// instances that `fenel-parser.ts` and `fenel-printer.ts` consume to build
// their default fixity tables.
//
// typed-function-references Phase 12 (2026-06-05) retired the hand-written TS
// `Instance` consts that used to live here in favour of the Fenel-authored
// `fenel/std/parser-fixities.fenel`. An `Infixable` / `Prefixable` instance is a
// typed value like any other; it belongs in `.fenel`, not as a TS literal.
//
// THE BOOTSTRAP. The parser sources its default fixity from these instances to
// parse `.fenel` at all — which is why they used to be hand-written TS. The
// circularity dissolves because the fixity `.fenel` file is FIXITY-FREE to
// parse: every method value is a string / number literal, so the file uses no
// infix operators and parses correctly under an EMPTY fixity table. So:
//   - `getFixityInstances()` projects the file lazily, on first use, via the
//     same `loadFenelModule(..., { dispatchInstanceFile: true })` path Phases
//     3/10/11 used for the other instance files.
//   - A `_loading` sentinel breaks the re-entrancy: while the fixity file is
//     itself being parsed (which constructs a `Parser`, which reads the default
//     fixity), `getFixityInstances()` returns the empty projection, so the
//     parser falls back to its structural-operator-only table — and the
//     literals-only file never consults the Infixable lookup. The full table is
//     built + memoized once the projection completes (see `getDefaultFixity` in
//     fenel-parser.ts, which memoizes ONLY the non-empty result).
// The import of `loadFenelModule` here is a LAZY-USE-only dependency (called at
// first parse, never at module top-level), so the historical load-order cycle
// this file was once carved out to break does NOT return.
// ---------------------------------------------------------------------------

import type { Instance } from "./types";
import { loadFenelModule } from "./fenel-module";
import parserFixitiesSrc from "../../../../fenel/std/parser-fixities.fenel?raw";

/** Per-locale operator-name maps derived from the `Codeable` instances in the
 *  fixity `.fenel` file. `toCanonical` (spelling → English notation) drives the
 *  lexer's localized-operator canonicalization; `fromCanonical` (English →
 *  localized spelling) drives the printer's localized output. Replaces the
 *  former hardcoded TS `LOCALE_OP` table — the localized spelling of a word-
 *  operator is its `Codeable` localized codeName, a Fenel-authored fact. */
interface LocalizedOperators {
  toCanonical: Record<string, Record<string, string>>;
  fromCanonical: Record<string, Record<string, string>>;
}

let _cache:
  | { infixables: Instance[]; prefixables: Instance[]; localized: LocalizedOperators }
  | undefined;
let _loading = false;
const EMPTY_LOCALIZED: LocalizedOperators = { toCanonical: {}, fromCanonical: {} };

/** Derive the per-locale operator-name maps from the projected `Codeable`
 *  instances. Canonical = the `en` codeName (fallback: the member name of the
 *  function handle, its last `.`- or `:`-separated segment: `std.and` → `and`). */
function deriveLocalized(all: Instance[]): LocalizedOperators {
  // Null-prototype maps: the inner maps are indexed by arbitrary source idents
  // (in the lexer), so a normal-prototype object would resolve `constructor` /
  // `toString` / etc. to inherited methods. The lexer also guards with hasOwn.
  const toCanonical: Record<string, Record<string, string>> = Object.create(null);
  const fromCanonical: Record<string, Record<string, string>> = Object.create(null);
  for (const inst of all) {
    if (inst.typeName !== "Codeable") continue;
    const cn = (inst.methods as { codeName?: unknown })?.codeName;
    if (!cn || typeof cn !== "object") continue;
    const entries = Object.entries(cn as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string") as [string, string][];
    const canonical =
      (cn as Record<string, string>).en ?? String(inst.args[0]).split(/[.:]/).pop() ?? "";
    for (const [loc, spelling] of entries) {
      (toCanonical[loc] ??= Object.create(null))[spelling] = canonical;
      (fromCanonical[loc] ??= Object.create(null))[canonical] = spelling;
    }
  }
  return { toCanonical, fromCanonical };
}

/** Project `fenel/std/parser-fixities.fenel` into the built-in `Infixable` /
 *  `Prefixable` instance lists (+ the localized-operator maps), memoized after
 *  the first successful load. While the projection is in progress (the fixity
 *  file's own parse re-enters here via the `Parser` constructor's default-fixity
 *  read), returns the EMPTY split — the bootstrap fallback: the file is
 *  fixity-free, so structural fixity suffices to parse it. */
export function getFixityInstances(): {
  infixables: Instance[];
  prefixables: Instance[];
} {
  if (_cache) return _cache;
  if (_loading) return { infixables: [], prefixables: [] };
  _loading = true;
  try {
    const all =
      loadFenelModule(parserFixitiesSrc, "std", { dispatchInstanceFile: true })
        .instances ?? [];
    _cache = {
      infixables: all.filter((i) => i.typeName === "Infixable"),
      prefixables: all.filter((i) => i.typeName === "Prefixable"),
      localized: deriveLocalized(all),
    };
    return _cache;
  } finally {
    _loading = false;
  }
}

/** The per-locale word-operator name maps (lexer + printer i18n). Shares the
 *  fixity projection's cache + `_loading` bootstrap sentinel — returns empty
 *  while the fixity file is itself being parsed (that parse is locale-free, so
 *  no localized operator can occur). */
export function getLocalizedOperators(): LocalizedOperators {
  if (_cache) return _cache.localized;
  if (_loading) return EMPTY_LOCALIZED;
  getFixityInstances();
  return _cache ? (_cache as { localized: LocalizedOperators }).localized : EMPTY_LOCALIZED;
}

/** Pure parser sugar — `&&` / `||` desugar to the canonical `and` / `or`. Never
 *  printed, never surfaced to the introspection registry / operator picker. */
export const SYMBOLIC_ALIAS_NOTATIONS = new Set(["&&", "||"]);

/** Notations excluded from the PRINTER's fixity tables: the symbolic aliases
 *  PLUS the qualified-method operators (`>>=` → `Monad.bind`, `<>` →
 *  `Monoid.mappend`), which print in their canonical `Class.method` form. The
 *  parser still sources fixity from all of them; only the printed shape differs.
 *  Asymmetry is LOAD-BEARING — see the `.fenel` file header. */
export const PRINTER_EXCLUDED_NOTATIONS = new Set(["&&", "||", ">>=", "<>"]);
