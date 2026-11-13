// SUBSTRATE
// ---------------------------------------------------------------------------
// parser-keywords — keyword / locale-keyword tables for the Fenel tokenizer
//
// Pulled out of `fenel-parser.ts` so it can be imported earlier in the
// parser's import block than the (cyclic) `type-foundation` import. The
// cycle `type-foundation → fenel-module → fenel-parser → type-foundation`
// means that during type-foundation's top-level eval, `Str = ... List(Char)`
// can fire a lazy `loadFenelModule` call back into the parser. The parser's
// `tokenize` walks the keyword tables; if those tables lived on
// fenel-parser's own top-level (`const KW = …`) they'd be in TDZ at that
// point — fenel-parser's body hadn't run past the import that triggered
// type-foundation's load.
//
// Keeping the tables in a leaf module (no imports of type-foundation, no
// imports of anything in the cycle) means fenel-parser's import of THIS
// module fully resolves before the cycle-triggering import — so KW /
// LOCALE_KW / buildKwMap are guaranteed initialised by the time any
// re-entrant tokenize call lands.
// ---------------------------------------------------------------------------

// `data` is contextual — only special at the start of a top-level decl
// (Idris-style data declaration). Treated as an ordinary ident in any
// other position so existing modules can still use it as a field name
// (e.g. `Message = Message data: String`).
export const KW = new Set([
  "let", "if", "then", "else", "case", "of", "do", "end",
  "where", "in",
  "infixl", "infixr", "infix",
]);

// Word-operators are NOT reserved keywords. `and` / `or` are infix operators
// spelled as words, and `not` is a prefix operator spelled as a word; all three
// are ordinary std functions (`std:and` / `std:or` / `std:not`) with Infixable /
// Prefixable instances, dispatched by notation exactly like `+` (subsumption —
// operators are functions, not syntax). So they lex as plain IDENT tokens and
// can be used as field / variable names. The parser recognizes `and` / `or` in
// infix position via WORD_INFIX (their fixity comes from the Infixable
// instances); `not` needs no special handling — `not x` IS function application.
//
// WORD_INFIX stays CURATED rather than "every alphabetic notation": alphabetic
// operators inherently collide with identifiers (the `cat` concat-notation
// collides with `cat` used as a `category` variable in real code), so only the
// genuine, collision-free word operators `and` / `or` opt in.
export const WORD_INFIX = new Set(["and", "or"]);

export const LOCALE_KW: Record<string, Record<string, string>> = {
  fr: { soit: "let", si: "if", alors: "then", sinon: "else", selon: "case", de: "of", faire: "do", fin: "end", où: "where" },
  es: { sea: "let", si: "if", entonces: "then", sino: "else", caso: "case", de: "of", hacer: "do", fin: "end", donde: "where" },
  ar: { دع: "let", إذا: "if", فإن: "then", وإلا: "else", حسب: "case", من: "of", افعل: "do", نهاية: "end", حيث: "where" },
};

// NOTE: localized spellings of the WORD-OPERATORS (`et`/`ou`/`non`, …) are NOT a
// keyword table — they are the operators' `Codeable` localized codeNames,
// authored in `fenel/std/parser-fixities.fenel` and projected by
// `parser-fixities.ts` (`getLocalizedOperators`). The lexer/printer read them
// from there. Only the structural keywords above (genuine syntax, no Codeable
// instance) localize via LOCALE_KW.

export function buildKwMap(locale?: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const kw of KW) map.set(kw, kw);
  if (locale && LOCALE_KW[locale]) {
    for (const [local, en] of Object.entries(LOCALE_KW[locale]!)) map.set(local, en);
  }
  return map;
}

// Single-char operator-symbol set used for custom operators like `.` `&` `$`
// `<>` etc. The reserved multi-char tokens (`->`, `==`, `|>`, `::`, …) are
// recognized first; anything else built from these chars becomes an `op`.
//
// Unicode set-theory operators (∈, ∪, ∩, ¬, ∅, \) are admitted so the
// SetExpr-bearing refinement syntax (`Char = Nat | value ∈ [0..D7FF] ∪ …`)
// tokenises cleanly — see `parseSetForm` in `fenel-parser.ts` and the DSL
// in `set-syntax.ts:parseSetExpr` for how they reconstruct into a SetExpr.
// `∞` is added (Phase 2.7) so half-open intervals like `[1..∞)` can
// round-trip through the printer; the canonical input surface is `[1..)`
// (missing-hi), but the formatter emits `∞` and the parser accepts both.
export const OP_CHAR = new Set("!#$%&*+./<=>?@\\^|-~:∈∪∩¬∅∞".split(""));
export const RESERVED_MULTI = new Set([
  "==", "!=", "<=", ">=", "->", "<-", "|>", "::", "..",
]);
