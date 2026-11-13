// Format-preset regression tests — every registered Pattern-form format
// gets a small matrix of accepted / rejected inputs and a check that its
// named groups are exposed through extractCaptures.

import { describe, it, expect } from "vitest";
import "./format-presets";
import { getNamedPattern, listNamedPatterns, registerFormatPattern } from "./format-presets";
import { patternMatch, extractCaptures, decomposeFlatPattern, parse, patternToType, match, group } from "./pattern";
import { peelList } from "./set-algebra";
import { peelListForAuthoring } from "./authoring/type-authoring";
import { patternPredsAreCharTotal, buildSetExpr } from "./set-marker";
import { validateWithHints } from "./validation-hints";

function captureMap(name: string, value: string): Record<string, string> | null {
  const p = getNamedPattern(name);
  if (!p) return null;
  const caps = extractCaptures(p, [...value]);
  if (!caps) return null;
  const out: Record<string, string> = {};
  for (const c of caps) out[c.name] = c.values.join("");
  return out;
}

function matches(name: string, value: string): boolean {
  const p = getNamedPattern(name);
  return p ? patternMatch(p, [...value]) : false;
}

describe("format presets — date / time", () => {
  it("cursor hints retain predicate-only fallbacks and omit unregistered formats", () => {
    // format:url and format:phone are registered Patterns since demo 10 (their
    // check and their hint are one Pattern); format:email keeps its
    // predicate-only cursor, built from its check's own regex parts.
    for (const [handle, value, registered] of [
      ["format:email", "name@example.com", false],
      ["format:url", "https://example.com", true],
      ["format:phone", "+33123456789", true],
    ] as const) {
      expect(getNamedPattern(handle) !== undefined).toBe(registered);
      const hints = validateWithHints(value, buildSetExpr.ref(handle!));
      expect(hints.cursor?.canMatch).toBe(true);
      expect(hints.cursor?.canEnd).toBe(true);
      expect(hints.cursor?.failedAt).toBeUndefined();
    }
    expect(validateWithHints("abc", buildSetExpr.ref("format:unregistered-cursor-fixture")).cursor).toBeUndefined();
  });

  it("EU-date cursor hints use the registered day/month/year mask", () => {
    const set = buildSetExpr.ref("format:date:eu");
    const partial = validateWithHints("25/1", set);
    expect(partial.valid).toBe(false);
    expect(partial.cursor?.canMatch).toBe(true);
    expect(partial.cursor?.canEnd).toBe(false);
    expect(partial.cursor?.failedAt).toBeUndefined();
    expect(partial.cursor?.activeGroup).toBe("month");
    expect(partial.cursor?.validNext).toBe("0-2");

    const complete = validateWithHints("25/12/2025", set);
    expect(complete.valid).toBe(true);
    expect(complete.cursor?.canEnd).toBe(true);
    expect(complete.cursor?.segments.map(segment => segment.name)).toEqual(["day", "month", "year"]);

    const invalid = validateWithHints("32/12/2025", set);
    expect(invalid.valid).toBe(false);
    expect(invalid.cursor?.canMatch).toBe(false);
    expect(invalid.cursor?.failedAt?.position).toBe(1);
  });

  it("format:date:eu accepts dd/MM/yyyy and captures day/month/year", () => {
    expect(matches("format:date:eu", "25/12/2025")).toBe(true);
    expect(matches("format:date:eu", "25/12/25")).toBe(false);
    expect(matches("format:date:eu", "32/12/2025")).toBe(false);
    expect(captureMap("format:date:eu", "25/12/2025")).toEqual({
      day: "25", month: "12", year: "2025",
    });
  });

  it("format:date:iso accepts yyyy-MM-dd", () => {
    expect(matches("format:date:iso", "2025-12-25")).toBe(true);
    expect(matches("format:date:iso", "2025-13-25")).toBe(false);
    expect(captureMap("format:date:iso", "2025-12-25")).toEqual({
      year: "2025", month: "12", day: "25",
    });
  });

  it("format:time:24h accepts HH:mm", () => {
    expect(matches("format:time:24h", "23:59")).toBe(true);
    expect(matches("format:time:24h", "24:00")).toBe(false);
    expect(matches("format:time:24h", "9:00")).toBe(false); // not zero-padded
  });

  it("format:time:12h accepts h:mm AM/PM", () => {
    expect(matches("format:time:12h", "9:30 AM")).toBe(true);
    expect(matches("format:time:12h", "12:00 PM")).toBe(true);
    expect(matches("format:time:12h", "13:00 AM")).toBe(false);
    expect(matches("format:time:12h", "9:30 am")).toBe(false); // case-sensitive
    expect(captureMap("format:time:12h", "9:30 AM")).toEqual({
      hour: "9", minute: "30", period: "AM",
    });
  });
});

describe("format presets — network / version / id", () => {
  it("UUID cursor hints accept the same uppercase hex as membership", () => {
    const set = buildSetExpr.ref("format:uuid");
    for (const value of ["550e8400-e29b-41d4-a716-446655440000", "550E8400-E29B-41D4-A716-446655440000"]) {
      const hints = validateWithHints(value, set);
      expect(hints.valid).toBe(true);
      expect(hints.cursor?.canMatch).toBe(true);
      expect(hints.cursor?.canEnd).toBe(true);
      expect(hints.cursor?.failedAt).toBeUndefined();
      expect(hints.cursor?.segments.map(segment => segment.name)).toEqual(["timeLow", "timeMid", "timeHiVer", "clockSeq", "node"]);
    }

    const prefix = validateWithHints("550E", set);
    expect(prefix.cursor?.canMatch).toBe(true);
    expect(prefix.cursor?.canEnd).toBe(false);
    expect(prefix.cursor?.failedAt).toBeUndefined();
    expect(prefix.cursor?.validNext).toBe("digit (0-9), A-F, a-f");

    const invalid = validateWithHints("550G", set);
    expect(invalid.valid).toBe(false);
    expect(invalid.cursor?.canMatch).toBe(false);
    expect(invalid.cursor?.failedAt?.position).toBe(3);
  });

  it("format:semver captures major/minor/patch", () => {
    expect(matches("format:semver", "1.2.3")).toBe(true);
    expect(matches("format:semver", "1.2")).toBe(false);
    expect(captureMap("format:semver", "10.20.30")).toEqual({
      major: "10", minor: "20", patch: "30",
    });
  });

  it("format:ipv4 enforces 0-255 per octet", () => {
    expect(matches("format:ipv4", "192.168.1.1")).toBe(true);
    expect(matches("format:ipv4", "0.0.0.0")).toBe(true);
    expect(matches("format:ipv4", "255.255.255.255")).toBe(true);
    expect(matches("format:ipv4", "256.0.0.1")).toBe(false);
    expect(matches("format:ipv4", "1.2.3.4.5")).toBe(false);
    expect(captureMap("format:ipv4", "10.20.30.40")).toEqual({
      o1: "10", o2: "20", o3: "30", o4: "40",
    });
  });

  it("format:ipv6:full requires all 8 groups (no :: shorthand)", () => {
    expect(matches("format:ipv6:full", "2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
    expect(matches("format:ipv6:full", "2001:db8:85a3:0:0:8a2e:370:7334")).toBe(true);
    expect(matches("format:ipv6:full", "::1")).toBe(false);
  });

  it("format:uuid requires 8-4-4-4-12 hex with hyphens", () => {
    expect(matches("format:uuid", "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(matches("format:uuid", "550e8400e29b41d4a716446655440000")).toBe(false);
    const caps = captureMap("format:uuid", "550e8400-e29b-41d4-a716-446655440000")!;
    expect(caps.timeLow).toBe("550e8400");
    expect(caps.node).toBe("446655440000");
  });

  it("format:mac accepts colon or hyphen separators, captures b1..b6", () => {
    expect(matches("format:mac", "aa:bb:cc:dd:ee:ff")).toBe(true);
    expect(matches("format:mac", "AA-BB-CC-DD-EE-FF")).toBe(true);
    expect(matches("format:mac", "aa:bb:cc:dd:ee")).toBe(false);
    const caps = captureMap("format:mac", "aa:bb:cc:dd:ee:ff")!;
    expect(caps.b1).toBe("aa");
    expect(caps.b6).toBe("ff");
  });

  it("format:credit-card accepts 16 digits with optional separators", () => {
    expect(matches("format:credit-card", "4111111111111111")).toBe(true);
    expect(matches("format:credit-card", "4111 1111 1111 1111")).toBe(true);
    expect(matches("format:credit-card", "4111-1111-1111-1111")).toBe(true);
    expect(matches("format:credit-card", "4111-1111-1111")).toBe(false);
    const caps = captureMap("format:credit-card", "4111 1111 1111 1111")!;
    expect(caps.g1).toBe("4111");
    expect(caps.g4).toBe("1111");
  });

  it("format:hex-color accepts # plus 3 or 6 hex chars", () => {
    expect(matches("format:hex-color", "#ABC")).toBe(true);
    expect(matches("format:hex-color", "#abcdef")).toBe(true);
    expect(matches("format:hex-color", "#GGG")).toBe(false);
    expect(matches("format:hex-color", "ABC")).toBe(false);
  });
});

describe("format presets — identity / contact", () => {
  it("format:url:structured captures scheme/host/port/path/query/fragment", () => {
    expect(matches("format:url:structured", "https://example.com")).toBe(true);
    expect(matches("format:url:structured", "https://api.example.com:8080/v1?q=1#x")).toBe(true);
    expect(matches("format:url:structured", "example.com")).toBe(false);
    const caps = captureMap("format:url:structured", "https://api.example.com:8080/v1?q=1#x")!;
    expect(caps.scheme).toBe("https");
    expect(caps.host).toBe("api.example.com");
    expect(caps.port).toBe("8080");
    expect(caps.path).toBe("/v1");
    expect(caps.fragment).toBe("#x");
  });

  it("format:phone:e164 requires + plus 5-17 digits", () => {
    expect(matches("format:phone:e164", "+33612345678")).toBe(true);
    expect(matches("format:phone:e164", "+1234567")).toBe(true);
    expect(matches("format:phone:e164", "33612345678")).toBe(false); // missing +
    expect(matches("format:phone:e164", "+0612345678")).toBe(false); // leading 0
    const caps = captureMap("format:phone:e164", "+33612345678")!;
    expect(caps.countryCode).toBeTruthy();
    expect(caps.subscriber).toBeTruthy();
  });

  it("format:postal:us accepts zip5 with optional zip4", () => {
    expect(matches("format:postal:us", "90210")).toBe(true);
    expect(matches("format:postal:us", "90210-1234")).toBe(true);
    expect(matches("format:postal:us", "9021")).toBe(false);
    expect(captureMap("format:postal:us", "90210")).toEqual({ zip5: "90210", zip4: "" });
    expect(captureMap("format:postal:us", "90210-1234")).toEqual({
      zip5: "90210", zip4: "1234",
    });
  });

  it("format:postal:ca accepts A1A 1A1 form", () => {
    expect(matches("format:postal:ca", "K1A 0B1")).toBe(true);
    expect(matches("format:postal:ca", "k1a 0b1")).toBe(false);
    expect(matches("format:postal:ca", "K1A0B1")).toBe(false);
    const caps = captureMap("format:postal:ca", "K1A 0B1")!;
    expect(caps.fsa).toBe("K1A");
    expect(caps.ldu).toBe("0B1");
  });

  it("format:ssn:us accepts 3-2-4 digits", () => {
    expect(matches("format:ssn:us", "123-45-6789")).toBe(true);
    expect(matches("format:ssn:us", "12-345-6789")).toBe(false);
    expect(matches("format:ssn:us", "123456789")).toBe(false);
    expect(captureMap("format:ssn:us", "123-45-6789")).toEqual({
      area: "123", group: "45", serial: "6789",
    });
  });
});

describe("format presets — segmentation", () => {
  it("flat formats decompose into segments for the segmented widget", () => {
    expect(decomposeFlatPattern(getNamedPattern("format:date:eu")!)?.length).toBe(5);
    expect(decomposeFlatPattern(getNamedPattern("format:postal:us")!)?.length).toBe(3);
    expect(decomposeFlatPattern(getNamedPattern("format:ipv4")!)?.length).toBe(7);
    expect(decomposeFlatPattern(getNamedPattern("format:ipv6:full")!)?.length).toBe(15);
    expect(decomposeFlatPattern(getNamedPattern("format:uuid")!)?.length).toBe(9);
    expect(decomposeFlatPattern(getNamedPattern("format:ssn:us")!)?.length).toBe(5);
    expect(decomposeFlatPattern(getNamedPattern("format:postal:ca")!)?.length).toBe(3);
    expect(decomposeFlatPattern(getNamedPattern("format:semver")!)?.length).toBe(5);
    expect(decomposeFlatPattern(getNamedPattern("format:phone:e164")!)?.length).toBe(3);
  });

  it("formats with top-level alts return null (segmentation falls back)", () => {
    // hex-color: alt between 6-char and 3-char forms
    expect(decomposeFlatPattern(getNamedPattern("format:hex-color")!)).toBeNull();
    // credit-card: optional alt separator between groups
    expect(decomposeFlatPattern(getNamedPattern("format:credit-card")!)).toBeNull();
    // mac: alt separator
    expect(decomposeFlatPattern(getNamedPattern("format:mac")!)).toBeNull();
  });
});

describe("format presets — typed parse via patternToType", () => {
  it("parses date:eu into {day, month, year}", () => {
    expect(parse(getNamedPattern("format:date:eu")!, "25/12/2025")).toEqual({
      day: "25", month: "12", year: "2025",
    });
  });

  it("parses semver into {major, minor, patch}", () => {
    expect(parse(getNamedPattern("format:semver")!, "1.2.3")).toEqual({
      major: "1", minor: "2", patch: "3",
    });
  });

  it("parses ipv4 into {o1, o2, o3, o4}", () => {
    expect(parse(getNamedPattern("format:ipv4")!, "192.168.1.1")).toEqual({
      o1: "192", o2: "168", o3: "1", o4: "1",
    });
  });

  it("parses postal:us with absent zip4 → empty string", () => {
    expect(parse(getNamedPattern("format:postal:us")!, "90210")).toEqual({
      zip5: "90210", zip4: "",
    });
    expect(parse(getNamedPattern("format:postal:us")!, "90210-1234")).toEqual({
      zip5: "90210", zip4: "1234",
    });
  });

  it("parses URL with multiple query params into a list of {key, value}", () => {
    const p = getNamedPattern("format:url:structured")!;
    const out = parse(p, "https://api.example.com:8080/v1/users?a=1&b=2&c=3#frag") as any;
    expect(out.scheme).toBe("https");
    expect(out.host).toBe("api.example.com");
    expect(out.port).toBe("8080");
    expect(out.path).toBe("/v1/users");
    expect(out.fragment).toBe("#frag");
    expect(out.query.kv).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
      { key: "c", value: "3" },
    ]);
  });

  it("parses URL with a single query param as a one-element list", () => {
    const p = getNamedPattern("format:url:structured")!;
    const out = parse(p, "https://x.com?id=42") as any;
    expect(out.query.kv).toEqual([{ key: "id", value: "42" }]);
  });

  it("parses URL with no query → kv is an empty list (matches List type)", () => {
    const p = getNamedPattern("format:url:structured")!;
    const out = parse(p, "https://x.com") as any;
    expect(out.query.kv).toEqual([]);
  });

  it("returns null for inputs that don't match", () => {
    expect(parse(getNamedPattern("format:ipv4")!, "256.0.0.1")).toBeNull();
    expect(parse(getNamedPattern("format:semver")!, "1.2")).toBeNull();
    expect(parse(getNamedPattern("format:url:structured")!, "not a url")).toBeNull();
  });

  it("patternToType for URL exposes the full record / list / nested-record structure", () => {
    const t = patternToType(getNamedPattern("format:url:structured")!) as any;
    expect(t.$record.fields.map((f: any) => f.name)).toEqual([
      "scheme", "host", "port", "path", "query", "fragment",
    ]);
    // query is a record with one field "kv"
    const queryType = t.$record.fields.find((f: any) => f.name === "query").type;
    expect(queryType.$record.fields[0].name).toBe("kv");
    // Pattern conversion produces a declaration; its named fields have not
    // passed registry identity normalization. Semantic peeling remains strict.
    const kvType = queryType.$record.fields[0].type;
    expect(() => peelList(kvType)).toThrow(/field-identity semantic boundary/);
    const kvList = peelListForAuthoring(kvType);
    expect(kvList).not.toBeNull();
    // and the list element is a record with key + value
    expect((kvList!.elem as any).$record.fields.map((f: any) => f.name)).toEqual(["key", "value"]);
  });
});

// ---------------------------------------------------------------------------
// decide-substrate Phase 4T Step W2 — the named-format decidability contract.
//
// `registerFormatPattern` registers a NAMED_SETS closure that answers through
// the BOOLEAN `dispatchedPatternMember`, so a `format:*` name reached via
// `{$tag:"SeRef", handle}` gets its verdict lifted straight into a `Just` by
// `namedMember`. That lift is only honest while every predicate in the pattern
// is decidable over single characters WITHOUT re-entering the evaluator —
// otherwise `pattern.ts:deriv` collapses an UNDECIDED predicate to the empty
// derivative and the `false` becomes a false `Just false` (the laundering W2
// fenced on the `SePattern` face via `dispatchedPatternMemberTri`).
//
// The `SeRef` face cannot carry that fence today: the NAMED_SETS closure
// signature is boolean, so there is nowhere for `Nothing` to go. Measured at
// the time of writing: all 23 registered formats are codepoint-total and zero
// carry a typed group, so the hazard is LATENT, not live. This test is what
// keeps it latent — it fails the moment someone registers a format whose
// predicate steps outside the fragment, instead of letting that name silently
// start minting definite verdicts it cannot justify. If you land here: either
// keep the pattern inside the fragment, or make the named-set face tri-state
// first (ledgered `mem.pattern.tri` in design/tcb-ledger.md).
// ---------------------------------------------------------------------------
describe("W2 — every registered format pattern stays in the codepoint-total fragment", () => {
  it("no registered format leaves the character-total fragment", () => {
    const offenders = listNamedPatterns().filter(
      (name) => !patternPredsAreCharTotal(getNamedPattern(name)),
    );
    expect(offenders).toEqual([]);
  });

  it("registerFormatPattern REFUSES a pattern outside the fragment", () => {
    // An undecidable predicate: an unknown name answers `Nothing`, which the
    // derivative would silently collapse to a refutation.
    expect(() =>
      registerFormatPattern("format:w2-should-not-register", match({
        $tag: "SeRef", handle: "definitely:not:a:registered:name",
      } as never)),
    ).toThrow(/character-total fragment/);
    expect(listNamedPatterns()).not.toContain("format:w2-should-not-register");
  });

  it("registerFormatPattern REFUSES a typed group", () => {
    expect(() =>
      registerFormatPattern("format:w2-typed-group", group("g", match(buildSetExpr.enum(["x"])), buildSetExpr.enum(["x"]))),
    ).toThrow(/character-total fragment/);
  });

  it("registerFormatPattern REFUSES a non-character enum member", () => {
    // The lowering maps the NUMBER 120 and the string "x" to the same code
    // point, so a complement over it decides opposite to direct membership.
    expect(() =>
      registerFormatPattern("format:w2-number-enum", match(buildSetExpr.enum([120] as never))),
    ).toThrow(/character-total fragment/);
  });

});
