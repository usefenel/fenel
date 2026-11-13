// regex-derivative-to-fenel Phase 3 (Slice C) — differential coverage for the
// Fenel-bodied hint + serialization surface (regexHint / describeRanges /
// isAnchored / patternToRegex), which was THIN on direct tests before the port.
// Expected values are computed by hand from regex-derivative.ts's pre-port TS
// algorithm (the faithful-port oracle the brief mandates).

import { test, expect, describe } from "bun:test";
import {
  regexHint,
  describeRanges,
  isAnchored,
  patternToRegex,
  regexStringToPattern,
  type RegexCharRange,
} from "./index";

describe("isAnchored", () => {
  test("^ or $ anchored", () => {
    expect(isAnchored("^abc$")).toBe(true);
    expect(isAnchored("^abc")).toBe(true);
    expect(isAnchored("abc$")).toBe(true);
    expect(isAnchored("abc")).toBe(false);
    expect(isAnchored("")).toBe(false);
  });
});

describe("describeRanges", () => {
  test("empty / classes / singletons / named / huge", () => {
    expect(describeRanges([])).toBe("end of input");
    expect(describeRanges([{ lo: 48, hi: 57 }])).toBe("digit (0-9)");
    expect(describeRanges([{ lo: 65, hi: 90 }])).toBe("uppercase letter (A-Z)");
    expect(describeRanges([{ lo: 97, hi: 122 }])).toBe("lowercase letter (a-z)");
    // single alnum char → the char itself (no CHAR_NAMES entry)
    expect(describeRanges([{ lo: 97, hi: 97 }])).toBe("a");
    // single named char → "ch (name)" when the name differs from the char
    expect(describeRanges([{ lo: 46, hi: 46 }])).toBe(". (dot)");
    expect(describeRanges([{ lo: 95, hi: 95 }])).toBe("_ (underscore)");
    // multi-range, sorted by lo
    expect(describeRanges([{ lo: 97, hi: 122 }, { lo: 48, hi: 57 }])).toBe(
      "digit (0-9), lowercase letter (a-z)",
    );
    // spanning > 0xfff0 code points → "any character"
    expect(describeRanges([{ lo: 0, hi: 9 }, { lo: 11, hi: 0xffff }])).toBe("any character");
  });
});

describe("regexHint", () => {
  test("mid-match: valid-next + can-end over [a-z]+", () => {
    const h = regexHint("^[a-z]+$", "ab");
    expect(h.canMatch).toBe(true);
    expect(h.canEnd).toBe(true);
    expect(h.matchedCount).toBe(2);
    expect(h.validNext).toEqual([{ lo: 97, hi: 122 }] as RegexCharRange[]);
    expect(h.validNextLabel).toBe("lowercase letter (a-z)");
    expect(h.failedAt).toBeUndefined();
    expect(h.segments).toEqual([]);
  });

  test("dead end: failedAt reports position + expected", () => {
    const h = regexHint("^[a-z]+$", "a1");
    expect(h.canMatch).toBe(false);
    expect(h.canEnd).toBe(false);
    expect(h.matchedCount).toBe(1);
    expect(h.failedAt).toEqual({ position: 1, got: "1", expected: "lowercase letter (a-z)" });
  });

  test("cannot end before the required char: [a-z]{3} after one char", () => {
    const h = regexHint("^[a-z]{3}$", "a");
    expect(h.canMatch).toBe(true);
    expect(h.canEnd).toBe(false);
    expect(h.validNextLabel).toBe("lowercase letter (a-z)");
  });

  test("named-group segments + URL enrichment", () => {
    // The url FORMAT_HINT_PATTERN exercises scheme→protocol/secure +
    // host→domain/tld enrichment.
    const url =
      "^(?<scheme>[a-zA-Z][a-zA-Z0-9+.\\-]*)://(?<host>[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?)*\\.(?<tld>[a-zA-Z]{2,}))$";
    const h = regexHint(url, "https://example.com");
    const names = h.segments.map((s) => s.name);
    // scheme split into protocol + secure (https → http + s)
    expect(names).toContain("scheme");
    expect(names).toContain("protocol");
    expect(names).toContain("secure");
    // host split into domain + tld (example.com → example + com)
    expect(names).toContain("domain");
    expect(names).toContain("tld");
    // every enriched segment carries a depth
    for (const s of h.segments) expect(typeof s.depth).toBe("number");
    // the secure marker covers exactly the trailing "s" of "https"
    const secure = h.segments.find((s) => s.name === "secure")!;
    expect(secure.end - secure.start).toBe(1);
    expect("https://example.com".slice(secure.start, secure.end)).toBe("s");
  });
});

describe("patternToRegex (round-trip with regexStringToPattern)", () => {
  // For clean anchored char-class patterns, regexStringToPattern → patternToRegex
  // is the identity (the brief's self-checking differential) — modulo the
  // range sort+merge `mergeRanges` applies inside a class (so `[A-Za-z0-9]`
  // canonicalizes to `[0-9A-Za-z]`, the faithful pre-port behavior).
  const cases: Array<[string, string]> = [
    ["^[a-z]+$", "^[a-z]+$"],
    ["^[0-9]{3}$", "^[0-9]{3}$"],
    ["^[a-z]{2,4}$", "^[a-z]{2,4}$"],
    ["^abc$", "^abc$"],
    ["^[A-Za-z0-9]*$", "^[0-9A-Za-z]*$"],
    ["^a|b$", "^a|b$"],
  ];
  for (const [re, expected] of cases) {
    test(`round-trips ${re}`, () => {
      const pat = regexStringToPattern(re);
      expect(pat).not.toBeNull();
      expect(patternToRegex(pat!)).toBe(expected);
    });
  }

  test("non-char predicate has no clean regex form → null", () => {
    // A $where pattern can't be a regex.
    const pat = regexStringToPattern("^[a-z]$");
    expect(pat).not.toBeNull();
    // Inject a non-char predicate to force the null channel.
    const wherePat = { t: "match", pred: { $tag: "SeWhere", pred: { ">": [{ var: "value.length" }, 3] } } } as never;
    expect(patternToRegex(wherePat)).toBeNull();
  });
});
