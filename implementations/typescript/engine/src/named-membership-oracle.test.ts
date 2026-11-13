// ---------------------------------------------------------------------------
// Named-membership differential oracle — the regression net for the
// `named-membership-to-fenel` arc (Phase 0, S0-oracle).
//
// WHY THIS EXISTS. `setNamedContains` / `containsNamed` / `NAMED_SETS` decide
// `value ∈ {$ref: name}` for ~80+ runtime-registered names (set-algebra
// static literal, format-presets Pattern-backed, the prefix-parameterized
// families, per-account closures). There was NO corpus/differential oracle
// over this surface at HEAD — base `format:date`/`format:url*` had ZERO tests
// (notes/phase-3b-prereq-step0.md §3). Every later port (Phase 1 portable →
// Phase 2 Pattern-via-Fenel → Phase 3 host leaves → Phase 4 account →
// capstone) re-points the decider; without this net it would re-point BLIND.
//
// WHAT THIS IS. A CHARACTERIZATION test: it snapshots the CURRENT TS verdict
// (`mGet(setNamedContains({$ref: name}, value, ctx), false)`) for a corpus
// of (name, value) pairs — members, non-members, type-mismatches, and the
// `new Date()`/`new URL()`/shape-only leniency edge cases the Step-0 flagged.
// Later phases move the decision into Fenel; THIS FILE STAYS BYTE-IDENTICAL.
// A red here means a port changed an observable membership verdict — exactly
// what the arc must never do silently.
// The approved representation-substrate 4b change replaces the Rational/ℚ
// Number characterization with exact Ratio carriers and resource abstention.
//
// This is the one production-adjacent artifact Phase 0 lands. It is pure
// characterization of existing TS — no new logic (the mechanical-test-oracle
// exception); it adds no `.fenel` body, so no parse-cache / compiled-parser /
// self-host-matrix / codename-lock regen.
//
// COVERAGE NOTE (partition-aligned). This corpus covers the slices Phases 1,
// 2, and 4 port: the static literal (numeric / string / format-regex / list /
// path), the ~24 format-presets (asserted COMPLETE against listNamedPatterns()
// below), the prefix-parameterized families, the `+`-composition path, the
// account scope, and the conservative-`false` unknown-name posture. The
// host-Unicode registrars (`string-classes` str:*, `char-classes`, `markup`)
// are the Phase-3 substrate leaves; their names are NOT enumerated here (they
// load from other modules and stay host-backed) — a Phase-3 extension of this
// oracle pins them when those instances land. See
// notes/phase-0-feasibility-and-design.md §partition.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  setNamedContains,
  registerAccountNamedSet,
  unregisterAccountNamedSet,
} from "./set-algebra";
import { mGet } from "./maybe-bool";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
// Side-effect import: boots the ~24 Pattern-backed format presets into
// NAMED_SETS. `listNamedPatterns` drives the completeness guard below.
import { listNamedPatterns } from "./format-presets";

/** The boolean projection of the current TS verdict — the oracle's unit.
 *
 *  ⚠ rights R3a — the ACCOUNT IS THE THIRD ARGUMENT, not a `ctx` field. It used
 *  to arrive as `{accountId}` on the `$where` variable environment, which on the
 *  production write path IS the value being validated; it is a REQUEST datum
 *  now, threaded from an authenticated IO context. `undefined` here means "no
 *  request account": global named sets only. */
function c(name: string, value: unknown, account?: string): boolean {
  return mGet(
    setNamedContains({ $tag: "SeRef", handle: name }, value, account ?? null),
    false,
  );
}

describe("named-membership oracle — numeric tower + aliases", () => {
  it("preserves Bool native/pure results and partial member abstention", () => {
    for (const [value, expected] of [[true, true], [false, false], [{ $tag: "True" }, true], [{ $tag: "False" }, false]] as const) {
      expect(dispatchEngineBody("engine:membershipVerdictValid", [value])).toBe(true);
      expect(dispatchEngineBody("engine:setAlgebraMemberVerdict", [value])).toEqual({ $tag: "Just", _0: expected });
      expect(dispatchEngineBody("engine:setAlgebraMemberVerdict", [{ $tag: "Just", _0: value }])).toEqual({ $tag: "Just", _0: expected });
    }
    expect(dispatchEngineBody("engine:setAlgebraMemberVerdict", [{ $tag: "Nothing" }])).toEqual({ $tag: "Nothing" });
    expect(dispatchEngineBody("engine:membershipVerdictValid", [{ $tag: "Just", _0: "false" }])).toBe(false);
    expect(dispatchEngineBody("engine:setAlgebraMemberVerdict", [{ $tag: "Just", _0: "false" }])).toEqual({ $tag: "Nothing" });
  });
  it("ℕ / Nat — non-negative integers", () => {
    for (const n of ["ℕ", "Nat"]) {
      expect(c(n, 3)).toBe(true);
      expect(c(n, 0)).toBe(true);
      expect(c(n, -1)).toBe(false);
      expect(c(n, 2.5)).toBe(false);
      expect(c(n, "3")).toBe(false);
    }
  });

  it("ℤ / Int — integers", () => {
    for (const n of ["ℤ", "Int"]) {
      expect(c(n, -1)).toBe(true);
      expect(c(n, 0)).toBe(true);
      expect(c(n, 2.5)).toBe(false);
      expect(c(n, "x")).toBe(false);
    }
  });

  it("ℝ / Real / Number — finite native numbers", () => {
    for (const n of ["ℝ", "Real", "Number"]) {
      expect(c(n, 2.5)).toBe(true);
      expect(c(n, -3)).toBe(true);
      expect(c(n, Infinity)).toBe(false); // Number.isFinite(Infinity) === false
      expect(c(n, NaN)).toBe(false);
      expect(c(n, "x")).toBe(false);
    }
  });
  it("ℚ / Rational — exact native ratios and honest bounded abstention", () => {
    for (const n of ["ℚ", "Rational"]) {
      expect(c(n, { $tag: "Rational", num: "5", den: "2" })).toBe(true);
      expect(c(n, { $tag: "Rational", num: "2", den: "4" })).toBe(true);
      expect(c(n, { $tag: "Rational", num: "1", den: "0" })).toBe(false);
      expect(c(n, 2.5)).toBe(false);
      expect(c(n, -3)).toBe(false);
      expect(setNamedContains({ $tag: "SeRef", handle: n }, { $tag: "Rational", num: "7".repeat(4097), den: "1" }, null)).toEqual({ $tag: "Nothing" });
    }
  });
});

describe("named-membership oracle — string / boolean sets", () => {
  it("String / NonEmpty / Boolean / Bool", () => {
    expect(c("String", "hi")).toBe(true);
    expect(c("String", "")).toBe(true);
    expect(c("String", 5)).toBe(false);

    expect(c("NonEmpty", "x")).toBe(true);
    expect(c("NonEmpty", "")).toBe(false);
    expect(c("NonEmpty", 5)).toBe(false);

    for (const n of ["Boolean", "Bool"]) {
      expect(c(n, true)).toBe(true);
      expect(c(n, false)).toBe(true);
      expect(c(n, 1)).toBe(false);
      expect(c(n, "true")).toBe(false);
    }
  });
});

describe("named-membership oracle — static format-regex predicates", () => {
  it("format:email", () => {
    expect(c("format:email", "a@b.com")).toBe(true);
    expect(c("format:email", "not-an-email")).toBe(false);
    expect(c("format:email", "a@b")).toBe(false); // no TLD dot
    expect(c("format:email", "")).toBe(false);
    expect(c("format:email", 5)).toBe(false);
  });

  it("format:phone (digits-stripped)", () => {
    expect(c("format:phone", "+1234567")).toBe(true);
    expect(c("format:phone", "(123) 456-7890")).toBe(true);
    expect(c("format:phone", "12345")).toBe(false); // too short
  });

  it("format:url (new URL leniency)", () => {
    expect(c("format:url", "https://example.com")).toBe(true);
    expect(c("format:url", "example.com")).toBe(true); // schemeless retry
    expect(c("format:url", "javascript:alert(1)")).toBe(false); // scheme reject
    expect(c("format:url", "not a url")).toBe(false);
    expect(c("format:url", "")).toBe(false);
  });

  it("format:url presets", () => {
    expect(c("format:url:secure", "https://x.com")).toBe(true);
    expect(c("format:url:secure", "http://x.com")).toBe(false);
    expect(c("format:url:ws", "wss://x.com")).toBe(true);
    expect(c("format:url:noquery", "https://x.com")).toBe(true);
    expect(c("format:url:noquery", "https://x.com?a=1")).toBe(false);
    expect(c("format:url:nofragment", "https://x.com#a")).toBe(false);
    expect(c("format:url:noprivate", "https://example.com")).toBe(true);
    expect(c("format:url:noprivate", "http://10.0.0.1")).toBe(false);
    expect(c("format:url:noprivate", "http://169.254.169.254")).toBe(false);
    expect(c("format:url:noprivate", "http://localhost")).toBe(false);
  });

  it("format:ip", () => {
    expect(c("format:ip", "192.168.0.1")).toBe(true);
    expect(c("format:ip", "256.0.0.1")).toBe(false); // octet > 255
    expect(c("format:ip", "::1")).toBe(true);
    expect(c("format:ip", "not-ip")).toBe(false);
  });

  it("format:postal-code / format:handle", () => {
    expect(c("format:postal-code", "12345")).toBe(true);
    expect(c("format:postal-code", "1")).toBe(false);
    expect(c("format:handle", "@user")).toBe(true);
    expect(c("format:handle", "user_name")).toBe(true);
    expect(c("format:handle", "123")).toBe(false); // must start with a letter
  });

  it("format:date / format:datetime (new Date leniency — the fragile arm)", () => {
    expect(c("format:date", "2020-01-01")).toBe(true);
    expect(c("format:date", "Jan 1 2020")).toBe(true); // Date leniency
    expect(c("format:date", "not a date")).toBe(false);
    expect(c("format:date", "")).toBe(false);
    expect(c("format:datetime", "2020-01-01T00:00:00Z")).toBe(true);
    expect(c("format:datetime", "garbage")).toBe(false);
  });

  it("format:time (shape-only — does NOT range-validate)", () => {
    expect(c("format:time", "12:30")).toBe(true);
    expect(c("format:time", "12:30:45")).toBe(true);
    expect(c("format:time", "25:99")).toBe(true); // shape ok; range NOT checked
    expect(c("format:time", "1:30")).toBe(false); // needs 2-digit hour
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — the URL/date acceptance-set BOUNDARY. The Phase-3 port replaced
// `new URL()` / `new Date()` with pure Fenel deciders (`parseUrlParts` +
// the SSRF/scheme/port predicates; `membershipFormatDate`'s defined clean set).
// These cases LOCK that boundary. The URL cases were verified byte-identical to
// the original `new URL()` logic across a 32×12 differential before landing
// (including default-port elision + invalid-port throw); the date cases pin the
// defined clean set (ISO + month-name) — the deliberately-dropped V8 long-tail
// (slash dates, weekday prefix, bare/2-digit year, D-Mon-Y order) is asserted
// false, the shape-only leniency (matching format:time) asserted true.
// ---------------------------------------------------------------------------
describe("named-membership oracle — Phase 3 URL/date acceptance-set boundary", () => {
  it("format:url — schemeless / userinfo / protocol rejects", () => {
    expect(c("format:url", "HTTP://X.COM")).toBe(true);      // scheme (case-insensitive)
    expect(c("format:url", "user@host.com")).toBe(true);     // schemeless + userinfo, TLD ok
    expect(c("format:url", "ftp://files.example.com")).toBe(true);
    expect(c("format:url", "vbscript:foo")).toBe(false);     // scheme reject (sister of javascript:)
    expect(c("format:url", "mailto:a@b.com")).toBe(true);    // non-special scheme accepted
  });

  it("format:url:noprivate — IPv4 ranges + IPv6 + suffixes", () => {
    expect(c("format:url:noprivate", "http://8.8.8.8")).toBe(true);       // public
    expect(c("format:url:noprivate", "http://172.32.0.1")).toBe(true);    // outside 172.16-31
    expect(c("format:url:noprivate", "http://172.16.0.5")).toBe(false);   // 172.16.0.0/12
    expect(c("format:url:noprivate", "http://192.168.1.1")).toBe(false);  // 192.168.0.0/16
    expect(c("format:url:noprivate", "http://0.0.0.0")).toBe(false);      // 0.0.0.0/8
    expect(c("format:url:noprivate", "http://224.0.0.1")).toBe(false);    // multicast
    expect(c("format:url:noprivate", "http://[::1]")).toBe(false);        // IPv6 loopback
    expect(c("format:url:noprivate", "http://[fc00::1]")).toBe(false);    // IPv6 ULA
    expect(c("format:url:noprivate", "http://example.local")).toBe(false);// .local suffix
  });

  it("format:url:ws / ftp / strict / web / nolocalhost", () => {
    expect(c("format:url:ws", "ws://x.com")).toBe(true);
    expect(c("format:url:ws", "wss://x.com")).toBe(true);
    expect(c("format:url:ftp", "ftp://x.com")).toBe(true);
    expect(c("format:url:ftp", "ftps://x.com")).toBe(true);
    expect(c("format:url:strict", "https://x.com")).toBe(true);
    expect(c("format:url:strict", "x.com")).toBe(false);     // no scheme
    expect(c("format:url:web", "https://example.com")).toBe(true);
    expect(c("format:url:web", "http://localhost")).toBe(false);
    expect(c("format:url:nolocalhost", "http://localhost")).toBe(false);
    expect(c("format:url:nolocalhost", "https://example.com")).toBe(true);
  });

  it("format:url:nosubdomain / noport (apex + default-port elision)", () => {
    expect(c("format:url:nosubdomain", "https://example.com")).toBe(true);     // apex
    expect(c("format:url:nosubdomain", "https://sub.example.com")).toBe(false);// subdomain
    expect(c("format:url:noport", "https://example.com")).toBe(true);          // no port
    expect(c("format:url:noport", "https://example.com:443")).toBe(true);      // default port dropped
    expect(c("format:url:noport", "http://x.com:80")).toBe(true);              // default port dropped
    expect(c("format:url:noport", "https://x.com:8443")).toBe(false);          // explicit port
  });

  it("format:date — defined clean set (ISO + datetime + month-name)", () => {
    expect(c("format:date", "2020-12-31")).toBe(true);
    expect(c("format:date", "2020-01-01T12:00:00")).toBe(true);
    expect(c("format:date", "2020-01-01 12:00:00")).toBe(true);   // space separator
    expect(c("format:date", "2020-01-01T12:00:00.123Z")).toBe(true); // fractional + Z
    expect(c("format:date", "2020-01-01T12:00:00+05:30")).toBe(true); // offset
    expect(c("format:date", "December 25 2021")).toBe(true);      // full month name
    expect(c("format:date", "Jan 1, 2020")).toBe(true);          // trailing comma on day
    expect(c("format:datetime", "2020-01-01T12:00:00")).toBe(true); // datetime == date set
  });

  it("format:date — deliberately-dropped V8 long-tail (defined boundary)", () => {
    expect(c("format:date", "2020/01/01")).toBe(false);   // slash date → format:date:* presets
    expect(c("format:date", "01/31/2020")).toBe(false);
    expect(c("format:date", "31 Dec 2020")).toBe(false);  // D-Mon-Y order
    expect(c("format:date", "Mon Jan 01 2020")).toBe(false); // weekday prefix
    expect(c("format:date", "2020")).toBe(false);         // bare year
    expect(c("format:date", "Jan 1 20")).toBe(false);     // 2-digit year
    // Shape-only (no range validation) — accepted, matching format:time's convention.
    expect(c("format:date", "2020-13-01")).toBe(true);    // month 13: shape ok
    expect(c("format:date", "2020-01-01T25:99")).toBe(true); // hour 25: shape ok
  });
});

describe("named-membership oracle — list constraints", () => {
  it("list:distinct", () => {
    expect(c("list:distinct", [1, 2, 3])).toBe(true);
    expect(c("list:distinct", [1, 1])).toBe(false);
    expect(c("list:distinct", "x")).toBe(false); // not an array
  });

  it("list:ascending / descending / nondecreasing / nonincreasing", () => {
    expect(c("list:ascending", [1, 2, 3])).toBe(true);
    expect(c("list:ascending", [3, 2])).toBe(false);
    expect(c("list:ascending", [1])).toBe(true); // len < 2 vacuously true
    expect(c("list:descending", [3, 2, 1])).toBe(true);
    expect(c("list:nondecreasing", [1, 1, 2])).toBe(true);
    expect(c("list:nonincreasing", [2, 2, 1])).toBe(true);
  });
});

describe("named-membership oracle — filesystem path predicates", () => {
  it("format:path base + posix + windows", () => {
    expect(c("format:path", "a/b")).toBe(true);
    expect(c("format:path", "")).toBe(false);
    expect(c("format:path", "a\0b")).toBe(false); // NUL byte
    expect(c("format:path:posix", "/a/b")).toBe(true);
    expect(c("format:path:posix", "a\\b")).toBe(false); // backslash
    expect(c("format:path:posix", "C:\\x")).toBe(false); // drive
    expect(c("format:path:windows", "C:\\x")).toBe(true);
    expect(c("format:path:windows", "C:")).toBe(true); // bare drive
    expect(c("format:path:windows", "a<b")).toBe(false); // forbidden char
  });

  it("format:path absolute / relative / no-traversal / no-hidden", () => {
    expect(c("format:path:absolute", "/a")).toBe(true);
    expect(c("format:path:absolute", "a")).toBe(false);
    expect(c("format:path:absolute", "C:/x")).toBe(true);
    expect(c("format:path:relative", "a")).toBe(true);
    expect(c("format:path:relative", "/a")).toBe(false);
    expect(c("format:path:no-traversal", "a/b")).toBe(true);
    expect(c("format:path:no-traversal", "a/../b")).toBe(false);
    expect(c("format:path:no-hidden", "a/.git/b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 3c — the 6 regex-resistant format predicates ported to Fenel
// `Membership` bodies. These cases LOCK the fragile boundaries the port had to
// reproduce byte-identically (verified against the original TS via
// scripts/phase3c-probe.ts): the LOOSE IPv6 `::` regex (which rejects the
// canonical `fe80::1` / `2001:db8::1` — D-ipv6), the phone `\s`-class stripping,
// the postal `/i` + optional `[\s-]` separator, and the Windows UNC arm. The 4
// already-pinned names (phone/ip/postal/path:windows in the blocks above) stay
// UNCHANGED; this block ADDS path:portable / path:no-reserved (not previously
// oracled) + the boundary cases.
// ---------------------------------------------------------------------------
describe("named-membership oracle — Phase 3c regex-resistant format boundary", () => {
  it("format:phone — `\\s`-class + `[-.()]` stripping, 7-15 digit shape", () => {
    expect(c("format:phone", "1234567")).toBe(true);        // bare 7 digits
    expect(c("format:phone", "123456789012345")).toBe(true); // 15 digits (max)
    expect(c("format:phone", "1234567890123456")).toBe(false); // 16 digits (too long)
    expect(c("format:phone", "+123456")).toBe(false);       // 6 digits (too short)
    expect(c("format:phone", "1\t234567")).toBe(true);      // tab stripped
    expect(c("format:phone", "1\n234567")).toBe(true);      // LF stripped
    expect(c("format:phone", "1\v234567")).toBe(true);      // VT stripped (realistic \s)
    expect(c("format:phone", "12.34.56.78")).toBe(true);    // dots stripped → 8 digits
    expect(c("format:phone", "abc1234")).toBe(false);       // non-digit survives
  });

  it("format:ip — IPv4 octet range + IPv6 full + the LOOSE `::` shorthand", () => {
    expect(c("format:ip", "0.0.0.0")).toBe(true);
    expect(c("format:ip", "255.255.255.255")).toBe(true);
    expect(c("format:ip", "192.168.0.256")).toBe(false);    // octet > 255
    expect(c("format:ip", "1.2.3")).toBe(false);            // only 3 octets
    expect(c("format:ip", "1:2:3:4:5:6:7:8")).toBe(true);   // full 8-group
    expect(c("format:ip", "2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(c("format:ip", "FE80::1")).toBe(false);          // D-ipv6: loose regex REJECTS
    expect(c("format:ip", "fe80::1")).toBe(false);          // D-ipv6: REJECTS
    expect(c("format:ip", "2001:db8::1")).toBe(false);      // D-ipv6: REJECTS
    expect(c("format:ip", "::a")).toBe(true);               // `::`-prefixed accepted
    expect(c("format:ip", "::")).toBe(false);               // empty suffix rejected
    expect(c("format:ip", "a::")).toBe(false);              // non-empty prefix rejected
    expect(c("format:ip", "1::2::3")).toBe(false);          // two `::`
    expect(c("format:ip", "::ffff:1.2.3.4")).toBe(false);   // IPv4-in-v6 not matched
    expect(c("format:ip", "g::1")).toBe(false);             // non-hex
  });

  it("format:postal-code — `/i` + optional single `[\\s-]` separator", () => {
    expect(c("format:postal-code", "ab12")).toBe(true);     // lowercase (/i)
    expect(c("format:postal-code", "K1A 0B1")).toBe(true);  // space separator
    expect(c("format:postal-code", "K1A-0B1")).toBe(true);  // hyphen separator
    expect(c("format:postal-code", "K1A0B1")).toBe(true);   // no separator, 6 alnum
    expect(c("format:postal-code", "AB")).toBe(false);      // 2 alnum, < 4 min
    expect(c("format:postal-code", "A B")).toBe(false);     // left run length 1
    expect(c("format:postal-code", "12345678901")).toBe(false); // 11 alnum > 10
    expect(c("format:postal-code", "AB\tCD")).toBe(true);   // tab separator (realistic \s)
    expect(c("format:postal-code", "K100")).toBe(true);
    expect(c("format:postal-code", "k100")).toBe(true);
    expect(c("format:postal-code", "AB K1")).toBe(true);
    expect(c("format:postal-code", "K100")).toBe(false);
    expect(c("format:postal-code", "AB K1")).toBe(false);
    expect(c("format:postal-code", "AK1 2BC")).toBe(false);
    expect(c("format:postal-code", "AB ſ1")).toBe(false);
    expect(c("format:postal-code", "AB ﬀ1")).toBe(false);
  });

  it("format:path:windows — drive / UNC / forbidden-char (added boundary cases)", () => {
    expect(c("format:path:windows", "C:/x")).toBe(true);    // forward-slash drive
    expect(c("format:path:windows", "C:foo")).toBe(false);  // CWD-relative
    expect(c("format:path:windows", "1:\\x")).toBe(false);  // non-letter drive → `:` in body
    expect(c("format:path:windows", "\\\\srv\\share\\a")).toBe(true);  // UNC
    expect(c("format:path:windows", "\\\\srv")).toBe(false);          // UNC missing share
    expect(c("format:path:windows", "\\\\srv\\sh<re")).toBe(false);   // forbidden in share
    expect(c("format:path:windows", "\\\\srv\\share")).toBe(true);    // UNC no rest
    expect(c("format:path:windows", "\\\\srv\\share\\a<b")).toBe(false); // forbidden in body
    expect(c("format:path:windows", "a/b/c")).toBe(true);   // plain relative
  });

  it("format:path:portable — charset + trailing space/dot + backslash reject", () => {
    expect(c("format:path:portable", "a/b")).toBe(true);
    expect(c("format:path:portable", "a_b-c/d")).toBe(true);
    expect(c("format:path:portable", "A1._-/ z")).toBe(true);
    expect(c("format:path:portable", "")).toBe(false);       // empty
    expect(c("format:path:portable", "a\0b")).toBe(false);   // NUL
    expect(c("format:path:portable", "a\\b")).toBe(false);   // backslash
    expect(c("format:path:portable", "a<b")).toBe(false);    // forbidden char
    expect(c("format:path:portable", "a ")).toBe(false);     // trailing space
    expect(c("format:path:portable", "a.")).toBe(false);     // trailing dot
    expect(c("format:path:portable", "café")).toBe(false);   // non-ASCII
    expect(c("format:path:portable", "a\tb")).toBe(false);   // tab not in charset
  });

  it("format:path:no-reserved — CON/PRN/AUX/NUL/COM[1-9]/LPT[1-9] segments", () => {
    expect(c("format:path:no-reserved", "a/b")).toBe(true);
    expect(c("format:path:no-reserved", "CON")).toBe(false);
    expect(c("format:path:no-reserved", "con")).toBe(false);     // /i
    expect(c("format:path:no-reserved", "PRN.txt")).toBe(false); // base + ext
    expect(c("format:path:no-reserved", "a/NUL/b")).toBe(false); // mid-path segment
    expect(c("format:path:no-reserved", "COM1")).toBe(false);
    expect(c("format:path:no-reserved", "COM0")).toBe(true);     // 0 not in [1-9]
    expect(c("format:path:no-reserved", "LPT0")).toBe(true);
    expect(c("format:path:no-reserved", "console")).toBe(true);  // not exactly CON
    expect(c("format:path:no-reserved", "x\\CON\\y")).toBe(false); // backslash sep
    expect(c("format:path:no-reserved", "CON.")).toBe(false);    // CON + empty ext
    expect(c("format:path:no-reserved", "NULL")).toBe(true);     // not NUL
  });
});

describe("named-membership oracle — prefix-parameterized families", () => {
  it("multiple:N", () => {
    expect(c("multiple:7", 14)).toBe(true);
    expect(c("multiple:7", 15)).toBe(false);
    expect(c("multiple:7", 0)).toBe(true);
    expect(c("multiple:7", "14")).toBe(false); // not a number
    expect(c("multiple:3", 9)).toBe(true);
    expect(c("multiple:3", 10)).toBe(false);
  });

  it("list:maxdiff:N / list:span:N", () => {
    expect(c("list:maxdiff:5", [1, 3, 6])).toBe(true);
    expect(c("list:maxdiff:5", [1, 10])).toBe(false);
    expect(c("list:maxdiff:5", [1])).toBe(true); // len < 2 vacuously true
    expect(c("list:span:10", [1, 5, 9])).toBe(true);
    expect(c("list:span:10", [1, 20])).toBe(false);
    expect(c("list:span:10", [5])).toBe(true);
  });

  it("format:path:max-depth:N / max-length:N / ext:NAME", () => {
    expect(c("format:path:max-depth:2", "a/b")).toBe(true);
    expect(c("format:path:max-depth:2", "a/b/c")).toBe(false);
    expect(c("format:path:max-length:5", "abc")).toBe(true);
    expect(c("format:path:max-length:5", "abcdef")).toBe(false);
    expect(c("format:path:ext:png|jpg", "a/b.png")).toBe(true);
    expect(c("format:path:ext:png|jpg", "a/b.gif")).toBe(false);
    expect(c("format:path:ext:png|jpg", "a/b")).toBe(false);
  });
});

describe("named-membership oracle — `+` composition (base AND every base:preset)", () => {
  it("format:url:web+secure", () => {
    expect(c("format:url:web+secure", "https://example.com")).toBe(true);
    expect(c("format:url:web+secure", "http://example.com")).toBe(false); // fails :secure
  });
});

describe("named-membership oracle — Pattern-backed format presets (Phase-2 slice)", () => {
  it("date / time / datetime templates", () => {
    expect(c("format:date:us", "12/31/2020")).toBe(true);
    expect(c("format:date:us", "2020-01-01")).toBe(false);
    expect(c("format:date:eu", "31/12/2020")).toBe(true);
    expect(c("format:date:eu-dot", "31.12.2020")).toBe(true);
    expect(c("format:date:eu-dash", "31-12-2020")).toBe(true);
    expect(c("format:date:iso", "2020-01-31")).toBe(true);
    expect(c("format:date:iso", "01/31/2020")).toBe(false);
    expect(c("format:time:24h", "23:59")).toBe(true);
    expect(c("format:time:24h", "23:59:00")).toBe(false);
    expect(c("format:time:24h-sec", "23:59:59")).toBe(true);
    expect(c("format:datetime:iso", "2020-01-01 12:00:00")).toBe(true);
    expect(c("format:datetime:iso-t", "2020-01-01T12:00:00")).toBe(true);
  });

  it("hex-color / mac / semver / credit-card", () => {
    expect(c("format:hex-color", "#aabbcc")).toBe(true);
    expect(c("format:hex-color", "#abc")).toBe(true);
    expect(c("format:hex-color", "aabbcc")).toBe(false);
    expect(c("format:mac", "00:1A:2b:3C:4d:5E")).toBe(true);
    expect(c("format:mac", "00-1A-2B-3C-4D-5E")).toBe(true);
    expect(c("format:mac", "00:1A:2B")).toBe(false);
    expect(c("format:semver", "1.2.3")).toBe(true);
    expect(c("format:semver", "1.2")).toBe(false);
    expect(c("format:credit-card", "4111 1111 1111 1111")).toBe(true);
    expect(c("format:credit-card", "4111-1111-1111-1111")).toBe(true);
    expect(c("format:credit-card", "4111111111111111")).toBe(true);
    expect(c("format:credit-card", "411")).toBe(false);
  });

  it("url:structured / phone:e164 / postal:us / postal:ca / ssn:us", () => {
    expect(c("format:url:structured", "https://example.com")).toBe(true);
    expect(c("format:url:structured", "not a url")).toBe(false);
    expect(c("format:phone:e164", "+12345678")).toBe(true);
    expect(c("format:phone:e164", "12345678")).toBe(false); // no +
    expect(c("format:postal:us", "12345")).toBe(true);
    expect(c("format:postal:us", "12345-6789")).toBe(true);
    expect(c("format:postal:us", "1234")).toBe(false);
    expect(c("format:postal:ca", "K1A 0B1")).toBe(true);
    expect(c("format:postal:ca", "K1A0B1")).toBe(false); // needs space
    expect(c("format:ssn:us", "123-45-6789")).toBe(true);
    expect(c("format:ssn:us", "123456789")).toBe(false);
  });

  it("ipv4 / ipv6:full / uuid (preset override) / time:12h", () => {
    expect(c("format:ipv4", "192.168.0.1")).toBe(true);
    expect(c("format:ipv4", "256.0.0.1")).toBe(false);
    expect(c("format:ipv6:full", "2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(c("format:ipv6:full", "::1")).toBe(false); // shorthand not accepted
    expect(c("format:uuid", "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(c("format:uuid", "550e8400e29b41d4a716446655440000")).toBe(false); // no dashes
    expect(c("format:time:12h", "1:30 AM")).toBe(true);
    expect(c("format:time:12h", "12:45 PM")).toBe(true);
    expect(c("format:time:12h", "13:00 PM")).toBe(false); // hour 1-12
  });

  // decide-substrate Phase 4T Step W2 — `format:bot-token` is NEW. It replaces
  // Telegram's inline `SeWhere` predicate `{match:[value, "^\\d+:…$"]}`, which
  // was not a regex test at all: JSON Logic's two-argument `match` returns its
  // trailing argument, so the regex STRING came back for every input and
  // `truthy` made EVERY string a valid bot token.
  it("bot-token — the shape the retired SeWhere predicate accepted unconditionally", () => {
    expect(c("format:bot-token", "123456:AAHfiqksKZ8WmNcRACHDaTHF_wLZjnwhZ8Q")).toBe(true);
    expect(c("format:bot-token", "not-a-token")).toBe(false);
    expect(c("format:bot-token", "123456:short")).toBe(false);
    expect(c("format:bot-token", "abc:AAHfiqksKZ8WmNcRACHDaTHF_wLZjnwhZ8Q")).toBe(false); // id must be digits
    expect(c("format:bot-token", "1:" + "A".repeat(34))).toBe(false); // secret is exactly 35
    expect(c("format:bot-token", "1:" + "A".repeat(36))).toBe(false);
  });

  it("COMPLETENESS GUARD — every live preset name is in this corpus", () => {
    // If a new registerFormatPattern lands without a corpus entry here, this
    // fails — forcing the oracle to stay complete over the Phase-2 slice.
    const corpus = new Set([
      "format:date:us", "format:date:eu", "format:date:eu-dot", "format:date:eu-dash",
      "format:date:iso", "format:time:24h", "format:time:24h-sec", "format:datetime:iso",
      "format:datetime:iso-t", "format:hex-color", "format:mac", "format:semver",
      "format:credit-card", "format:url:structured", "format:phone:e164", "format:postal:us",
      "format:ipv4", "format:ipv6:full", "format:uuid", "format:ssn:us", "format:postal:ca",
      "format:time:12h", "format:bot-token",
      // Demo 10 (2026-11-08): registered Patterns now; their verdicts are pinned
      // above (static format predicates, Phase 3 URL and Phase 3c phone blocks).
      "format:url", "format:phone",
    ]);
    for (const name of listNamedPatterns()) {
      expect(corpus.has(name), `preset "${name}" missing from oracle corpus`).toBe(true);
    }
  });
});

describe("named-membership oracle — account scope + unknown-name posture", () => {
  it("per-account SetExpr definitions take precedence and are gated on the REQUEST ACCOUNT", () => {
    const acct = "oracle-test-account";
    registerAccountNamedSet(acct, "plan_ref", { $tag: "SeEnum", values: ["pro"] });
    try {
      expect(c("plan_ref", "pro", acct)).toBe(true);
      expect(c("plan_ref", "free", acct)).toBe(false);
      // No REQUEST ACCOUNT → account set invisible → unknown name → conservative false.
      expect(c("plan_ref", "pro")).toBe(false);
      // Account override of a global name (NonEmpty) wins under its own account.
      registerAccountNamedSet(acct, "NonEmpty", { $tag: "SeNone" });
      expect(c("NonEmpty", "x", acct)).toBe(false); // overridden
      expect(c("NonEmpty", "x")).toBe(true); // global, no request account
    } finally {
      unregisterAccountNamedSet(acct, "plan_ref");
      unregisterAccountNamedSet(acct, "NonEmpty");
    }
  });

  it("multi-tenant isolation — account A's set does NOT leak to account B (Phase 4)", () => {
    // The dispatch-registry move (named-membership Phase 4) keys each account's
    // sets under an account-qualified target (`account:<id>:<name>`), so two
    // accounts can register the SAME name with DIFFERENT sets and neither
    // sees the other's — the guarantee the bespoke `ACCOUNT_NAMED_SETS` Map gave
    // and the unified registry must preserve.
    const acctA = "oracle-tenant-A";
    const acctB = "oracle-tenant-B";
    registerAccountNamedSet(acctA, "tier", { $tag: "SeEnum", values: ["a-only"] });
    registerAccountNamedSet(acctB, "tier", { $tag: "SeEnum", values: ["b-only"] });
    try {
      // Each account sees ONLY its own set.
      expect(c("tier", "a-only", acctA)).toBe(true);
      expect(c("tier", "b-only", acctA)).toBe(false); // B's value invisible to A
      expect(c("tier", "b-only", acctB)).toBe(true);
      expect(c("tier", "a-only", acctB)).toBe(false); // A's value invisible to B
      // No REQUEST ACCOUNT → neither account's set is visible → unknown name → false.
      expect(c("tier", "a-only")).toBe(false);
      expect(c("tier", "b-only")).toBe(false);
      // Unregistering A leaves B untouched (per-key lifecycle).
      unregisterAccountNamedSet(acctA, "tier");
      expect(c("tier", "a-only", acctA)).toBe(false); // gone
      expect(c("tier", "b-only", acctB)).toBe(true); // still live
    } finally {
      unregisterAccountNamedSet(acctA, "tier");
      unregisterAccountNamedSet(acctB, "tier");
    }
  });

  it("unknown name → conservative `Just false` (the load-bearing posture)", () => {
    expect(c("no:such:set", "anything")).toBe(false);
    expect(c("no:such:set", 42)).toBe(false);
  });
});
