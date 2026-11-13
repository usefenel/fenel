// ---------------------------------------------------------------------------
// Character-class named sets — char:* and str:* predicates.
//
// Char is conceptually an enum of codepoint constructors (see type-foundation
// `Char`). These named sets carve the codespace into useful subsets:
//
//   - Codespace slices (cheap intervals): ASCII, Latin-1, BMP, digit, …
//   - Unicode general categories (Lu, Ll, Lt, Nd, Nl, No, Pc, Pd, …)
//     surfaced as: char:letter, char:digit, char:punct, char:symbol, …
//   - Unicode scripts (Latn, Cyrl, Grek, Arab, Hebr, Hani, Hang, …)
//     surfaced as: char:script:cyrl, char:script:hang, …
//   - Common Unicode blocks (Latin-1 Supplement, Emoticons, …)
//     surfaced as: char:block:emoticons, …
//   - Emoji subgroups: char:emoji, char:emoji:smiley, char:emoji:flag, …
//
// For each char:X there's a paired str:X that holds for strings whose every
// element is a Char in X (so str:ascii ⇔ String of ASCII chars).
//
// Conventions:
//   - char predicates accept either a codepoint (number) or a one-char
//     string (the boundary form). Multi-codepoint inputs return false.
//   - str predicates accept a JS string and apply the underlying char
//     predicate to every codepoint via [...s] iteration.
// ---------------------------------------------------------------------------

import { registerNamedSet } from "./set-algebra";

// ---------------------------------------------------------------------------
// Codepoint extraction
// ---------------------------------------------------------------------------

/** Extract a single codepoint from value. Returns -1 if not a single char. */
function toCodepoint(value: unknown): number {
  if (typeof value === "number") return Number.isInteger(value) ? value : -1;
  if (typeof value !== "string") return -1;
  // Iterate to handle surrogate pairs correctly.
  let cp = -1;
  let count = 0;
  for (const ch of value) {
    if (++count > 1) return -1;
    cp = ch.codePointAt(0) ?? -1;
  }
  return count === 1 ? cp : -1;
}

/** Helper: register a char:X predicate from a codepoint test. The test takes
 *  a codepoint integer and returns boolean. */
function registerCharSet(name: string, test: (cp: number) => boolean): void {
  registerNamedSet(name, (value) => {
    const cp = toCodepoint(value);
    return cp >= 0 && test(cp);
  });
}

/** Helper: register a str:X predicate that holds when every codepoint in
 *  the string passes the underlying char test. Empty strings pass. */
function registerStrSet(name: string, test: (cp: number) => boolean): void {
  registerNamedSet(name, (value) => {
    if (typeof value !== "string") return false;
    for (const ch of value) {
      const cp = ch.codePointAt(0) ?? -1;
      if (cp < 0 || !test(cp)) return false;
    }
    return true;
  });
}

/** Register both char:X and str:X for the same predicate. Returns the
 *  underlying test so caller can reuse for unions/intersections. */
function registerCharAndStr(name: string, test: (cp: number) => boolean): (cp: number) => boolean {
  registerCharSet(`char:${name}`, test);
  registerStrSet(`str:${name}`, test);
  return test;
}

// ---------------------------------------------------------------------------
// Codespace slices — cheap interval predicates
// ---------------------------------------------------------------------------

const inRange = (lo: number, hi: number) => (cp: number) => cp >= lo && cp <= hi;

registerCharAndStr("ascii", inRange(0x00, 0x7f));
registerCharAndStr("ascii-printable", inRange(0x20, 0x7e));
registerCharAndStr("ascii-control", (cp) => (cp >= 0x00 && cp <= 0x1f) || cp === 0x7f);
registerCharAndStr("latin1", inRange(0x00, 0xff));
registerCharAndStr("bmp", (cp) => cp <= 0xffff && (cp < 0xd800 || cp > 0xdfff));

const isAsciiLower = registerCharAndStr("ascii-lower", inRange(0x61, 0x7a));
const isAsciiUpper = registerCharAndStr("ascii-upper", inRange(0x41, 0x5a));
const isAsciiLetter = registerCharAndStr(
  "ascii-letter",
  (cp) => isAsciiUpper(cp) || isAsciiLower(cp),
);
const isAsciiDigit = registerCharAndStr("ascii-digit", inRange(0x30, 0x39));
registerCharAndStr(
  "ascii-alnum",
  (cp) => isAsciiLetter(cp) || isAsciiDigit(cp),
);
registerCharAndStr(
  "ascii-punct",
  (cp) =>
    inRange(0x21, 0x2f)(cp) ||
    inRange(0x3a, 0x40)(cp) ||
    inRange(0x5b, 0x60)(cp) ||
    inRange(0x7b, 0x7e)(cp),
);
registerCharAndStr(
  "ascii-space",
  (cp) => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d,
);

// ---------------------------------------------------------------------------
// Unicode general categories — JS Unicode property escapes do the work.
//
// Notation: `\p{L}` matches any letter (Lu | Ll | Lt | Lm | Lo). The named
// sets below surface the most useful coarse and fine-grained categories.
// ---------------------------------------------------------------------------

/** Build a codepoint test from a Unicode property regex. */
function unicodeProp(re: string): (cp: number) => boolean {
  const r = new RegExp(re, "u");
  return (cp) => r.test(String.fromCodePoint(cp));
}

// Coarse categories
const isLetter = registerCharAndStr("letter", unicodeProp("^\\p{L}$"));
const isDigit = registerCharAndStr("digit", unicodeProp("^\\p{N}$"));
const isPunct = registerCharAndStr("punct", unicodeProp("^\\p{P}$"));
const isSymbol = registerCharAndStr("symbol", unicodeProp("^\\p{S}$"));
registerCharAndStr("mark", unicodeProp("^\\p{M}$"));
registerCharAndStr("separator", unicodeProp("^\\p{Z}$"));
registerCharAndStr("control", unicodeProp("^\\p{C}$"));

// Fine-grained letter categories
registerCharAndStr("uppercase", unicodeProp("^\\p{Lu}$"));
registerCharAndStr("lowercase", unicodeProp("^\\p{Ll}$"));
registerCharAndStr("titlecase", unicodeProp("^\\p{Lt}$"));
registerCharAndStr("modifier-letter", unicodeProp("^\\p{Lm}$"));
registerCharAndStr("other-letter", unicodeProp("^\\p{Lo}$"));

// Fine-grained number categories
registerCharAndStr("decimal-digit", unicodeProp("^\\p{Nd}$"));
registerCharAndStr("letter-number", unicodeProp("^\\p{Nl}$"));
registerCharAndStr("other-number", unicodeProp("^\\p{No}$"));

// Symbol categories
registerCharAndStr("currency", unicodeProp("^\\p{Sc}$"));
registerCharAndStr("math", unicodeProp("^\\p{Sm}$"));
registerCharAndStr("modifier-symbol", unicodeProp("^\\p{Sk}$"));
registerCharAndStr("other-symbol", unicodeProp("^\\p{So}$"));

// Letter ∪ Number — common base for "word character" definitions
registerCharAndStr("alnum", (cp) => isLetter(cp) || isDigit(cp));
// Alnum ∪ underscore — the "word character" of identifier-style tokens
registerCharAndStr("word", (cp) => isLetter(cp) || isDigit(cp) || cp === 0x5f);
// Punct ∪ Symbol — printable non-letter, non-digit
registerCharAndStr("punct-or-symbol", (cp) => isPunct(cp) || isSymbol(cp));
// Whitespace — Unicode \s (matches more than ASCII space)
registerCharAndStr("whitespace", unicodeProp("^\\s$"));

// ---------------------------------------------------------------------------
// Unicode scripts — char:script:<iso15924-lower>
// ---------------------------------------------------------------------------

const SCRIPTS: { code: string; alias: string }[] = [
  { code: "Latin", alias: "latn" },
  { code: "Cyrillic", alias: "cyrl" },
  { code: "Greek", alias: "grek" },
  { code: "Arabic", alias: "arab" },
  { code: "Hebrew", alias: "hebr" },
  { code: "Han", alias: "hani" },
  { code: "Hiragana", alias: "hira" },
  { code: "Katakana", alias: "kana" },
  { code: "Hangul", alias: "hang" },
  { code: "Devanagari", alias: "deva" },
  { code: "Bengali", alias: "beng" },
  { code: "Tamil", alias: "taml" },
  { code: "Thai", alias: "thai" },
  { code: "Tibetan", alias: "tibt" },
  { code: "Armenian", alias: "armn" },
  { code: "Georgian", alias: "geor" },
  { code: "Ethiopic", alias: "ethi" },
];

for (const { code, alias } of SCRIPTS) {
  const test = unicodeProp(`^\\p{Script=${code}}$`);
  registerCharSet(`char:script:${alias}`, test);
  registerStrSet(`str:script:${alias}`, test);
}

// ---------------------------------------------------------------------------
// Common Unicode blocks — char:block:<lower-hyphen-name>
// ---------------------------------------------------------------------------

const BLOCKS: { name: string; alias: string; lo: number; hi: number }[] = [
  { name: "Basic Latin",                         alias: "basic-latin",                lo: 0x0000, hi: 0x007f },
  { name: "Latin-1 Supplement",                  alias: "latin1-supplement",          lo: 0x0080, hi: 0x00ff },
  { name: "Latin Extended-A",                    alias: "latin-ext-a",                lo: 0x0100, hi: 0x017f },
  { name: "Latin Extended-B",                    alias: "latin-ext-b",                lo: 0x0180, hi: 0x024f },
  { name: "Greek and Coptic",                    alias: "greek-coptic",               lo: 0x0370, hi: 0x03ff },
  { name: "Cyrillic",                            alias: "cyrillic",                   lo: 0x0400, hi: 0x04ff },
  { name: "Hebrew",                              alias: "hebrew",                     lo: 0x0590, hi: 0x05ff },
  { name: "Arabic",                              alias: "arabic",                     lo: 0x0600, hi: 0x06ff },
  { name: "Devanagari",                          alias: "devanagari",                 lo: 0x0900, hi: 0x097f },
  { name: "Thai",                                alias: "thai",                       lo: 0x0e00, hi: 0x0e7f },
  { name: "General Punctuation",                 alias: "general-punctuation",        lo: 0x2000, hi: 0x206f },
  { name: "Currency Symbols",                    alias: "currency-symbols",           lo: 0x20a0, hi: 0x20cf },
  { name: "Letterlike Symbols",                  alias: "letterlike-symbols",         lo: 0x2100, hi: 0x214f },
  { name: "Arrows",                              alias: "arrows",                     lo: 0x2190, hi: 0x21ff },
  { name: "Mathematical Operators",              alias: "math-operators",             lo: 0x2200, hi: 0x22ff },
  { name: "Miscellaneous Technical",             alias: "misc-technical",             lo: 0x2300, hi: 0x23ff },
  { name: "Box Drawing",                         alias: "box-drawing",                lo: 0x2500, hi: 0x257f },
  { name: "Geometric Shapes",                    alias: "geometric-shapes",           lo: 0x25a0, hi: 0x25ff },
  { name: "Miscellaneous Symbols",               alias: "misc-symbols",               lo: 0x2600, hi: 0x26ff },
  { name: "Dingbats",                            alias: "dingbats",                   lo: 0x2700, hi: 0x27bf },
  { name: "CJK Symbols and Punctuation",         alias: "cjk-punctuation",            lo: 0x3000, hi: 0x303f },
  { name: "Hiragana",                            alias: "hiragana",                   lo: 0x3040, hi: 0x309f },
  { name: "Katakana",                            alias: "katakana",                   lo: 0x30a0, hi: 0x30ff },
  { name: "CJK Unified Ideographs",              alias: "cjk-unified",                lo: 0x4e00, hi: 0x9fff },
  { name: "Hangul Syllables",                    alias: "hangul-syllables",           lo: 0xac00, hi: 0xd7af },
  { name: "Emoticons",                           alias: "emoticons",                  lo: 0x1f600, hi: 0x1f64f },
  { name: "Misc Symbols and Pictographs",        alias: "misc-pictographs",           lo: 0x1f300, hi: 0x1f5ff },
  { name: "Transport and Map Symbols",           alias: "transport",                  lo: 0x1f680, hi: 0x1f6ff },
  { name: "Supplemental Symbols and Pictographs",alias: "supplemental-pictographs",   lo: 0x1f900, hi: 0x1f9ff },
  { name: "Symbols and Pictographs Extended-A",  alias: "symbols-pictographs-ext-a",  lo: 0x1fa70, hi: 0x1faff },
];

for (const { alias, lo, hi } of BLOCKS) {
  const test = inRange(lo, hi);
  registerCharSet(`char:block:${alias}`, test);
  registerStrSet(`str:block:${alias}`, test);
}

// ---------------------------------------------------------------------------
// Emoji — Unicode `Emoji` property + curated subgroups
//
// `\p{Emoji}` is broad — it includes digits, letters, and symbols that have
// emoji presentation. `\p{Emoji_Presentation}` is the narrower "renders as
// emoji by default" set.
// ---------------------------------------------------------------------------

const isEmoji = unicodeProp("^\\p{Emoji_Presentation}$");
registerCharSet("char:emoji", isEmoji);
registerStrSet("str:emoji", isEmoji);

// Curated emoji subgroups — by codepoint range. These don't follow Unicode
// block boundaries cleanly; the ranges reflect the most common usages.
const EMOJI_SUBGROUPS: { name: string; ranges: [number, number][] }[] = [
  {
    name: "smiley",
    ranges: [
      [0x1f600, 0x1f64f], // Emoticons
      [0x1f970, 0x1f97a], // Smiling/loving faces extended
    ],
  },
  {
    name: "animal",
    ranges: [
      [0x1f400, 0x1f4ff], // Animal & nature subset of Misc Pictographs
      [0x1f980, 0x1f9af], // Mammals/birds/insects extended
    ],
  },
  {
    name: "food",
    ranges: [
      [0x1f32d, 0x1f37f], // Food (subset of Misc Pictographs)
      [0x1f950, 0x1f97f], // Food extended
    ],
  },
  {
    name: "transport",
    ranges: [
      [0x1f680, 0x1f6ff], // Transport and Map Symbols
    ],
  },
  {
    name: "object",
    ranges: [
      [0x1f4a0, 0x1f4ff], // Symbols & objects subset
      [0x1f9f0, 0x1f9ff], // Household objects extended
    ],
  },
  {
    name: "symbol",
    ranges: [
      [0x2600, 0x26ff], // Misc Symbols
      [0x2700, 0x27bf], // Dingbats
    ],
  },
  {
    name: "flag",
    ranges: [
      [0x1f1e6, 0x1f1ff], // Regional Indicators (flags compose from pairs)
    ],
  },
];

for (const { name, ranges } of EMOJI_SUBGROUPS) {
  const test = (cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  registerCharSet(`char:emoji:${name}`, test);
  registerStrSet(`str:emoji:${name}`, test);
}

// ---------------------------------------------------------------------------
// Orthography — language-specific accepted character sets.
//
// `char:lang:X` is the set of letters used by language X (a-z + accents +
// special letters). `str:lang:X` is the same applied per-codepoint.
//
// Two layers per language:
//   char:lang:X       — letters only (the orthographic alphabet)
//   char:writable:X   — letters ∪ digits ∪ ambient punctuation (.,;:!?-…)
//                       — useful for "what users typically type in this
//                       language" rather than purely the alphabet
//
// Built from a string of allowed extra characters per language; ASCII
// letters a-z/A-Z and base digits/punctuation are included automatically.
// ---------------------------------------------------------------------------

/** Build a Set<number> of codepoints from a string. */
function codepointsOf(s: string): Set<number> {
  const out = new Set<number>();
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) out.add(cp);
  }
  return out;
}

const ASCII_LETTERS = codepointsOf(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);

const AMBIENT_PUNCTUATION = codepointsOf(' .,;:!?\'\"()-—–…');

/** Per-language extra letters beyond ASCII a-z/A-Z. */
const LANGUAGE_ALPHABETS: Record<string, string> = {
  fr: "àâäçéèêëîïôöùûüÿæœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸÆŒ",
  de: "äöüßÄÖÜẞ",
  es: "áéíñóúüÁÉÍÑÓÚÜ¿¡",
  it: "àèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ",
  pt: "áàâãçéêíóôõúÁÀÂÃÇÉÊÍÓÔÕÚ",
  pl: "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
  cs: "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
  sv: "åäöÅÄÖ",
  no: "æøåÆØÅ",
  da: "æøåÆØÅ",
  fi: "äöÄÖ",
  is: "áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ",
  tr: "çğıöşüÇĞİÖŞÜ",
  hu: "áéíóöőúüűÁÉÍÓÖŐÚÜŰ",
  ro: "ăâîșțĂÂÎȘȚ",
  nl: "ëïüáéíóúÉ",
  ca: "àçèéíïòóúüÀÇÈÉÍÏÒÓÚÜ·",
  // Languages whose script is entirely non-Latin: defer to script:X tests.
  // Russian (use char:script:cyrl), Greek (char:script:grek), etc.
};

for (const [lang, extras] of Object.entries(LANGUAGE_ALPHABETS)) {
  const extraCps = codepointsOf(extras);
  const letterTest = (cp: number) => ASCII_LETTERS.has(cp) || extraCps.has(cp);
  registerCharSet(`char:lang:${lang}`, letterTest);
  registerStrSet(`str:lang:${lang}`, letterTest);

  // "Writable" = letters ∪ digits ∪ ambient punctuation. Useful for
  // free-form text fields that should accept the language's normal
  // typed input (not just letters in isolation).
  const writableTest = (cp: number) =>
    letterTest(cp) ||
    isAsciiDigit(cp) ||
    AMBIENT_PUNCTUATION.has(cp);
  registerCharSet(`char:writable:${lang}`, writableTest);
  registerStrSet(`str:writable:${lang}`, writableTest);
}
