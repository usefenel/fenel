// ---------------------------------------------------------------------------
// Template Pattern — placeholder/mask DSL as a Pattern front-end
//
// A second front-end into the generic Pattern engine, alongside
// regexStringToPattern. Where regex is dense and write-only, templates are
// the form people already speak: "mm/dd/yyyy", "0000-0000-0000-0000",
// "#XXXXXX". Each template is a string of literals interleaved with named
// tokens drawn from a registry; the parser scans longest-token-first and
// emits a Pattern over Char.
//
//   templateStringToPattern("mm/dd/yyyy", defaultTemplateTokens)
//     ⇒ Pattern that accepts "12/25/2025" but rejects "13/00/2025"
//
// The default registry covers date/time tokens (`yyyy yy mm dd HH hh MM ss`)
// plus single-char primitives (`0` digit, `X` upper-hex, `x` lower-hex,
// `A` letter, `a` lower-letter, `N` alphanumeric). Multi-char tokens win
// over single-char on overlap, so "mm" is the month token rather than two
// independent literal m's.
//
// The artifact is the same Pattern AST that regex front-ends produce, so it
// participates in everything: patternMatch, deriv (for input-mask
// auto-narrowing), patternSubset (so format:date:us ⊆ digits-and-slashes
// is decidable), and isSubset over the surrounding SetExpr.
// ---------------------------------------------------------------------------

import {
  type Pattern,
  match,
  seq,
  alt,
  rep,
  eps,
  group,
} from "./pattern";
import type { SetExpr } from "./types";
import { Just } from "./type-foundation";

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

export type TemplateToken = {
  /** The Pattern this token expands to when scanned in a template. */
  pattern: Pattern;
  /**
   * Optional semantic name. Future parser-style API will use this to extract
   * structured records from matched strings (e.g. {year, month, day}).
   */
  name?: string;
  /** Optional placeholder hint for UIs (e.g. "MM" for the month slot). */
  placeholder?: string;
};

export type TemplateTokenRegistry = Record<string, TemplateToken>;

// ---------------------------------------------------------------------------
// SetExpr helpers — keep call sites short
// ---------------------------------------------------------------------------

const charLit = (c: string): Pattern => match({ $tag: "SeEnum", values: [c] });

const charRange = (lo: string, hi: string): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: Just({ value: lo, inclusive: true }),
    hi: Just({ value: hi, inclusive: true }),
  } });

const charUnion = (...sets: SetExpr[]): SetExpr =>
  sets.length === 1 ? sets[0]! : { $tag: "SeUnion", branches: sets };

const digitSet: SetExpr = charRange("0", "9");
const hexUpperSet: SetExpr = charUnion(charRange("0", "9"), charRange("A", "F"));
const hexLowerSet: SetExpr = charUnion(charRange("0", "9"), charRange("a", "f"));
const hexAnySet: SetExpr = charUnion(
  charRange("0", "9"),
  charRange("A", "F"),
  charRange("a", "f"),
);
const alphaUpperSet: SetExpr = charRange("A", "Z");
const alphaLowerSet: SetExpr = charRange("a", "z");
const alphaSet: SetExpr = charUnion(alphaUpperSet, alphaLowerSet);
const alnumSet: SetExpr = charUnion(digitSet, alphaUpperSet, alphaLowerSet);

const digitChar = match(digitSet);
const repeatN = (p: Pattern, n: number): Pattern => rep(p, n, n);

// ---------------------------------------------------------------------------
// Bounded numeric tokens — month (01–12), day (01–31), hour (00–23 / 01–12),
// minute/second (00–59). Each is the union of the few prefix-classes that
// make the high-digit valid given the second.
// ---------------------------------------------------------------------------

/** Two-digit month, 01–12. */
const monthPaddedPattern: Pattern = alt(
  seq(charLit("0"), match(charRange("1", "9"))),
  seq(charLit("1"), match(charRange("0", "2"))),
);

/** Two-digit day-of-month, 01–31 (calendar-month-agnostic — Feb 30 still passes). */
const dayPaddedPattern: Pattern = alt(
  seq(charLit("0"), match(charRange("1", "9"))),
  seq(match(charRange("1", "2")), digitChar),
  seq(charLit("3"), match(charRange("0", "1"))),
);

/** Two-digit 24h hour, 00–23. */
const hour24Pattern: Pattern = alt(
  seq(match(charRange("0", "1")), digitChar),
  seq(charLit("2"), match(charRange("0", "3"))),
);

/** Two-digit 12h hour, 01–12. (Same shape as month.) */
const hour12Pattern: Pattern = monthPaddedPattern;

/** Two-digit minute or second, 00–59. */
const sixtyPattern: Pattern = seq(match(charRange("0", "5")), digitChar);

// ---------------------------------------------------------------------------
// Default registry
// ---------------------------------------------------------------------------

/**
 * Default tokens for date/time and common alphabets.
 *
 * Date tokens follow Unicode CLDR / LDML convention:
 *   `MM` = month (uppercase)
 *   `mm` = minute (lowercase)
 *   `dd` = day, `yyyy` = year, `HH` = hour 24h, `hh` = hour 12h, `ss` = second
 * Same convention used by Java SimpleDateFormat, ICU, moment.js, dayjs.
 */
export const defaultTemplateTokens: TemplateTokenRegistry = {
  // Year
  yyyy: { name: "year", placeholder: "YYYY", pattern: repeatN(digitChar, 4) },
  yy:   { name: "year2", placeholder: "YY",  pattern: repeatN(digitChar, 2) },

  // Month / day — padded; uppercase MM follows LDML
  MM: { name: "month", placeholder: "MM", pattern: monthPaddedPattern },
  dd: { name: "day",   placeholder: "DD", pattern: dayPaddedPattern },

  // Time — lowercase mm = minute (LDML)
  HH: { name: "hour",   placeholder: "HH", pattern: hour24Pattern },
  hh: { name: "hour12", placeholder: "hh", pattern: hour12Pattern },
  mm: { name: "minute", placeholder: "mm", pattern: sixtyPattern },
  ss: { name: "second", placeholder: "ss", pattern: sixtyPattern },

  // Single-char primitives — pulled in for non-date masks (HEX, MAC, ...).
  // Bare characters in templates that don't match a registered token become
  // literals, so writing "1" still emits a literal "1" — these single-char
  // tokens only fire where the template uses them as placeholder slots.
  // No `name` field — these are alphabet primitives, not semantic segments,
  // so the compiler should not emit a capture group for each occurrence
  // (a credit-card mask "0000-0000-0000-0000" would otherwise produce 16
  // collapsed "digit" captures rather than the four 4-digit groups a
  // segmented widget actually wants).
  "0": { placeholder: "0", pattern: digitChar },
  X:   { placeholder: "X", pattern: match(hexUpperSet) },
  x:   { placeholder: "x", pattern: match(hexLowerSet) },
  H:   { placeholder: "H", pattern: match(hexAnySet) },
  A:   { placeholder: "A", pattern: match(alphaSet) },
  a:   { placeholder: "a", pattern: match(alphaLowerSet) },
  N:   { placeholder: "N", pattern: match(alnumSet) },
};

// ---------------------------------------------------------------------------
// Compile a template string to a Pattern
// ---------------------------------------------------------------------------

/**
 * Convert a template string to a Pattern over Char.
 *
 * Algorithm: at each position, find the longest registered token that the
 * template starts with there; emit its Pattern and advance by the token's
 * length. Otherwise, emit a literal-char Pattern for the single character.
 * Backslash escapes the next character so it stays a literal even if it
 * matches a token name (`"\\X"` → literal `X`).
 *
 *   templateStringToPattern("mm/dd/yyyy")     // US date
 *   templateStringToPattern("dd/mm/yyyy")     // EU date
 *   templateStringToPattern("yyyy-mm-dd")     // ISO date
 *   templateStringToPattern("#XXXXXX")        // hex color (uppercase)
 *   templateStringToPattern("0000-0000-0000-0000")  // 4×4 digit groups
 *
 * To extend the alphabet, pass a custom registry — typically `{ ...defaultTemplateTokens, myToken: {...} }`.
 */
export function templateStringToPattern(
  template: string,
  registry: TemplateTokenRegistry = defaultTemplateTokens,
): Pattern {
  const tokens = Object.keys(registry).sort((a, b) => b.length - a.length);
  const parts: Pattern[] = [];
  let i = 0;
  while (i < template.length) {
    if (template[i] === "\\" && i + 1 < template.length) {
      parts.push(charLit(template[i + 1]!));
      i += 2;
      continue;
    }
    let matched: string | null = null;
    for (const tok of tokens) {
      if (template.startsWith(tok, i)) {
        matched = tok;
        break;
      }
    }
    if (matched !== null) {
      const tok = registry[matched]!;
      parts.push(tok.name ? group(tok.name, tok.pattern) : tok.pattern);
      i += matched.length;
    } else {
      parts.push(charLit(template[i]!));
      i++;
    }
  }
  return parts.length === 0 ? eps : seq(...parts);
}
