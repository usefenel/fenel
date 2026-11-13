// Demo 10 (Rom, 2026-11-08): `format:url` and `format:phone` are ONE definition
// each — a registered Pattern that is both the membership check and the live
// hint. Rule C differential: the previous Fenel Membership bodies
// (`engine:membershipFormatUrl` / `engine:membershipFormatPhone`, kept as the
// comparison oracle) against the Pattern, over the existing tests' strings and
// edge cases. Every disagreement is listed below, with which reading wins.
// Extends ledgered C1: executes the shipped bodies and the shipped Pattern.
import { describe, expect, test } from "bun:test";
import "./modules/engine";
import "./format-presets";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { contains } from "./set-algebra";
import { getNamedPattern } from "./format-presets";
import { buildSetExpr } from "./set-marker";
import { membershipHints } from "./validation-hints";

const pattern = (name: string, value: string): boolean => {
  const verdict = contains(buildSetExpr.ref(name), value, null);
  if (verdict.$tag !== "Just") throw new Error(`${name} must decide ${JSON.stringify(value)}`);
  return verdict._0;
};
const previous = (body: string, value: string): boolean => dispatchEngineBody(body, [value]) as boolean;

const URLS = [
  "https://example.com", "http://example.com", "example.com", "javascript:alert(1)", "not a url", "",
  "HTTP://X.COM", "user@host.com", "ftp://files.example.com", "vbscript:foo", "mailto:a@b.com", "JavaScript:x",
  "javascripts:x", "javascrip:x", "j:x", "v:x", "vb:x", "https://exa mple.com", "https://usefenel", "a:", "a",
  "localhost", "localhost:3000", "http://localhost", "http://[::1]", "[::1]", "x.co", "x.c", "x.c0m", "1x.com",
  "1x.com:80", "1x.com:80/path?q=1#f", "1x.com:8o", "www.example.com/a b", "example.com#frag", "example.com?q",
  "a@b@c.com", "user:pass@example.com", "1u:p@x.com", "://x.com", "1http://x.com", "javascript:@x.com",
  "https://example.com:443/a?b=c&d=e#f", "tel:+33123456789", "data:text/plain,hi", "x-y.z:1", "-x.com",
  " example.com", "example.com ", "exa mple.com", "ex\tample.com", "example.c-m", "a.b.c.de",
];
const PHONES = [
  "+1234567", "(123) 456-7890", "12345", "1234567", "123456789012345", "1234567890123456", "+123456",
  "1\t234567", "1\n234567", "1\v234567", "12.34.56.78", "abc1234", "+33 1 23 45 67 89", "++1234567",
  "1234567+", "+-1234567", "-+1234567", " +1234567 ", "", "+", "(((1234567)))", "1 2 3 4 5 6 7",
  "123-456-7890 x12", "+1 (555) 010-9999", "1\r234567", "1\f234567", "0000000", "+0000000",
];

// Disagreements found by this differential, and the reading kept (Rom: the
// Pattern's answer wins when it is the standard reading). Each is an input no
// standard URL reader accepts as written.
const URL_DISAGREEMENTS: Record<string, { previous: boolean; pattern: boolean; why: string }> = {
  "1u:p@x.com": { previous: true, pattern: false,
    why: "userinfo with a colon but no scheme: the previous body read it as schemeless; no URL reader accepts it as written" },
  "://x.com": { previous: true, pattern: false, why: "an empty scheme before ://" },
  "1http://x.com": { previous: true, pattern: false, why: "a scheme cannot start with a digit; the previous body skipped to the text after ://" },
};
const PHONE_DISAGREEMENTS: Record<string, { previous: boolean; pattern: boolean; why: string }> = {};

describe("format:url and format:phone: one Pattern is the check and the hint", () => {
  test("both names are registered Patterns", () => {
    expect(getNamedPattern("format:url")).toBeDefined();
    expect(getNamedPattern("format:phone")).toBeDefined();
  });
  test.each(URLS)("url %p: the Pattern agrees with the previous body (or a listed disagreement)", (value) => {
    const listed = URL_DISAGREEMENTS[value];
    const old = previous("engine:membershipFormatUrl", value), now = pattern("format:url", value);
    if (listed) expect({ previous: old, pattern: now }).toEqual({ previous: listed.previous, pattern: listed.pattern });
    else expect(now).toBe(old);
  });
  test.each(PHONES)("phone %p: the Pattern agrees with the previous body (or a listed disagreement)", (value) => {
    const listed = PHONE_DISAGREEMENTS[value];
    const old = previous("engine:membershipFormatPhone", value), now = pattern("format:phone", value);
    if (listed) expect({ previous: old, pattern: now }).toEqual({ previous: listed.previous, pattern: listed.pattern });
    else expect(now).toBe(old);
  });
  test("the hint reads the same Pattern: incomplete is not yet, impossible is blocked", () => {
    const url = buildSetExpr.ref("format:url");
    expect(membershipHints("javascript", url).state.$tag).toBe("HintNotYet");
    expect(membershipHints("javascript:", url).state.$tag).toBe("HintBlocked");
    expect(membershipHints("example.c", url).state.$tag).toBe("HintNotYet");
    expect(membershipHints("example.com", url).state.$tag).toBe("HintPass");
    const phone = buildSetExpr.ref("format:phone");
    expect(membershipHints("+33 1 23", phone).state.$tag).toBe("HintNotYet");
    expect(membershipHints("+33 1 2a", phone).state.$tag).toBe("HintBlocked");
    expect(membershipHints("+33 1 23 45 67 89", phone).state.$tag).toBe("HintPass");
  });
});
