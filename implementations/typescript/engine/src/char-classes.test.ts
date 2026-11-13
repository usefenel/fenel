import { describe, it, expect } from "vitest";
import { containsB as contains, isSubsetB as isSubset } from "./set-algebra";
// Side-effect import: registers char:* / str:* / lang:* named sets.
import "./char-classes";

const namedSet = (name: string) => ({ $tag: "SeRef", handle: name } as const);

// ---------------------------------------------------------------------------
// Codespace slices
// ---------------------------------------------------------------------------

describe("char-classes — codespace slices", () => {
  it("char:ascii matches ASCII codepoints + 1-char strings", () => {
    expect(contains(namedSet("char:ascii"), 0x41, null)).toBe(true);   // A
    expect(contains(namedSet("char:ascii"), "A", null)).toBe(true);
    expect(contains(namedSet("char:ascii"), 0x80, null)).toBe(false);
    expect(contains(namedSet("char:ascii"), "é", null)).toBe(false);
  });

  it("char:ascii-printable excludes control chars", () => {
    expect(contains(namedSet("char:ascii-printable"), " ", null)).toBe(true);  // 0x20
    expect(contains(namedSet("char:ascii-printable"), "~", null)).toBe(true);  // 0x7E
    expect(contains(namedSet("char:ascii-printable"), "\t", null)).toBe(false);
    expect(contains(namedSet("char:ascii-printable"), "\x7f", null)).toBe(false);
  });

  it("char:latin1 covers full Latin-1 supplement", () => {
    expect(contains(namedSet("char:latin1"), "ÿ", null)).toBe(true);   // 0xFF
    expect(contains(namedSet("char:latin1"), "Ā", null)).toBe(false);  // 0x100
  });

  it("char:bmp excludes surrogates and supplementary planes", () => {
    expect(contains(namedSet("char:bmp"), "あ", null)).toBe(true);     // 0x3042
    // Emoji is in supplementary plane
    expect(contains(namedSet("char:bmp"), "😀", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ASCII letter / digit / case
// ---------------------------------------------------------------------------

describe("char-classes — ASCII letter and case", () => {
  it("char:ascii-letter matches a-zA-Z", () => {
    expect(contains(namedSet("char:ascii-letter"), "a", null)).toBe(true);
    expect(contains(namedSet("char:ascii-letter"), "Z", null)).toBe(true);
    expect(contains(namedSet("char:ascii-letter"), "0", null)).toBe(false);
    expect(contains(namedSet("char:ascii-letter"), "_", null)).toBe(false);
  });

  it("char:ascii-lower vs char:ascii-upper", () => {
    expect(contains(namedSet("char:ascii-lower"), "a", null)).toBe(true);
    expect(contains(namedSet("char:ascii-lower"), "A", null)).toBe(false);
    expect(contains(namedSet("char:ascii-upper"), "A", null)).toBe(true);
    expect(contains(namedSet("char:ascii-upper"), "a", null)).toBe(false);
  });

  it("char:ascii-digit matches 0-9 only", () => {
    expect(contains(namedSet("char:ascii-digit"), "5", null)).toBe(true);
    expect(contains(namedSet("char:ascii-digit"), "९", null)).toBe(false); // Devanagari 9
  });
});

// ---------------------------------------------------------------------------
// Unicode general categories
// ---------------------------------------------------------------------------

describe("char-classes — Unicode general categories", () => {
  it("char:letter is broader than ASCII letter", () => {
    expect(contains(namedSet("char:letter"), "é", null)).toBe(true);
    expect(contains(namedSet("char:letter"), "中", null)).toBe(true);
    expect(contains(namedSet("char:letter"), "1", null)).toBe(false);
  });

  it("char:digit covers Unicode number category", () => {
    expect(contains(namedSet("char:digit"), "5", null)).toBe(true);
    expect(contains(namedSet("char:digit"), "९", null)).toBe(true);  // Devanagari 9
    expect(contains(namedSet("char:digit"), "Ⅴ", null)).toBe(true);  // Roman numeral 5
    expect(contains(namedSet("char:digit"), "a", null)).toBe(false);
  });

  it("char:lowercase / char:uppercase via Unicode property", () => {
    expect(contains(namedSet("char:lowercase"), "é", null)).toBe(true);
    expect(contains(namedSet("char:lowercase"), "É", null)).toBe(false);
    expect(contains(namedSet("char:uppercase"), "É", null)).toBe(true);
    expect(contains(namedSet("char:uppercase"), "Σ", null)).toBe(true);
  });

  it("char:currency matches currency symbols", () => {
    expect(contains(namedSet("char:currency"), "$", null)).toBe(true);
    expect(contains(namedSet("char:currency"), "€", null)).toBe(true);
    expect(contains(namedSet("char:currency"), "¥", null)).toBe(true);
    expect(contains(namedSet("char:currency"), "1", null)).toBe(false);
  });

  it("char:math matches math symbols", () => {
    expect(contains(namedSet("char:math"), "+", null)).toBe(true);
    expect(contains(namedSet("char:math"), "÷", null)).toBe(true);
    expect(contains(namedSet("char:math"), "∑", null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

describe("char-classes — scripts", () => {
  it("char:script:cyrl matches Cyrillic letters", () => {
    expect(contains(namedSet("char:script:cyrl"), "Я", null)).toBe(true);
    expect(contains(namedSet("char:script:cyrl"), "α", null)).toBe(false);
  });

  it("char:script:hang matches Hangul syllables", () => {
    expect(contains(namedSet("char:script:hang"), "한", null)).toBe(true);
  });

  it("char:script:hani matches Han ideographs", () => {
    expect(contains(namedSet("char:script:hani"), "中", null)).toBe(true);
    expect(contains(namedSet("char:script:hani"), "国", null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

describe("char-classes — emoji", () => {
  it("char:emoji matches emoji presentation", () => {
    expect(contains(namedSet("char:emoji"), "😀", null)).toBe(true);
    expect(contains(namedSet("char:emoji"), "🚀", null)).toBe(true);
    expect(contains(namedSet("char:emoji"), "a", null)).toBe(false);
  });

  it("char:emoji:smiley narrows to smileys", () => {
    expect(contains(namedSet("char:emoji:smiley"), "😀", null)).toBe(true);
    expect(contains(namedSet("char:emoji:smiley"), "🚀", null)).toBe(false);
  });

  it("char:emoji:transport matches transport emoji", () => {
    expect(contains(namedSet("char:emoji:transport"), "🚀", null)).toBe(true);
    expect(contains(namedSet("char:emoji:transport"), "😀", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orthography (per-language)
// ---------------------------------------------------------------------------

describe("char-classes — orthography", () => {
  it("char:lang:fr accepts ASCII letters + French accents", () => {
    expect(contains(namedSet("char:lang:fr"), "é", null)).toBe(true);
    expect(contains(namedSet("char:lang:fr"), "ç", null)).toBe(true);
    expect(contains(namedSet("char:lang:fr"), "œ", null)).toBe(true);
    expect(contains(namedSet("char:lang:fr"), "a", null)).toBe(true);
    expect(contains(namedSet("char:lang:fr"), "ñ", null)).toBe(false);  // Spanish, not French
  });

  it("char:lang:de accepts umlauts and ß", () => {
    expect(contains(namedSet("char:lang:de"), "ä", null)).toBe(true);
    expect(contains(namedSet("char:lang:de"), "ß", null)).toBe(true);
    expect(contains(namedSet("char:lang:de"), "é", null)).toBe(false);
  });

  it("char:lang:es accepts ñ and inverted punctuation", () => {
    expect(contains(namedSet("char:lang:es"), "ñ", null)).toBe(true);
    expect(contains(namedSet("char:lang:es"), "¿", null)).toBe(true);
    expect(contains(namedSet("char:lang:es"), "¡", null)).toBe(true);
  });

  it("str:lang:fr matches French strings", () => {
    expect(contains(namedSet("str:lang:fr"), "français", null)).toBe(true);
    expect(contains(namedSet("str:lang:fr"), "café", null)).toBe(true);
    expect(contains(namedSet("str:lang:fr"), "español", null)).toBe(false); // ñ not French
  });
});

// ---------------------------------------------------------------------------
// String mirrors
// ---------------------------------------------------------------------------

describe("char-classes — string mirrors", () => {
  it("str:ascii matches ASCII-only strings", () => {
    expect(contains(namedSet("str:ascii"), "Hello", null)).toBe(true);
    expect(contains(namedSet("str:ascii"), "", null)).toBe(true); // empty passes vacuously
    expect(contains(namedSet("str:ascii"), "café", null)).toBe(false);
  });

  it("str:digit matches all-digit strings", () => {
    expect(contains(namedSet("str:digit"), "12345", null)).toBe(true);
    expect(contains(namedSet("str:digit"), "12 34", null)).toBe(false);
  });

  it("str:lowercase matches all-lowercase strings (Unicode-wide)", () => {
    expect(contains(namedSet("str:lowercase"), "hello", null)).toBe(true);
    expect(contains(namedSet("str:lowercase"), "héllo", null)).toBe(true);
    expect(contains(namedSet("str:lowercase"), "Hello", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hierarchy via NAMED_HIERARCHY (set-algebra subtype reasoning)
// ---------------------------------------------------------------------------

describe("char-classes — hierarchy", () => {
  it("char:ascii ⊂ char:latin1 ⊂ char:bmp", () => {
    expect(isSubset(namedSet("char:ascii"), namedSet("char:latin1"))).toBe(true);
    expect(isSubset(namedSet("char:latin1"), namedSet("char:bmp"))).toBe(true);
    expect(isSubset(namedSet("char:bmp"), namedSet("char:ascii"))).toBe(false);
  });

  it("char:ascii-letter ⊂ char:letter", () => {
    expect(isSubset(namedSet("char:ascii-letter"), namedSet("char:letter"))).toBe(true);
  });

  it("str:ascii ⊂ String", () => {
    expect(isSubset(namedSet("str:ascii"), namedSet("String"))).toBe(true);
  });
});
