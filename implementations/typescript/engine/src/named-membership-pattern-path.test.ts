// ---------------------------------------------------------------------------
// named-membership-to-fenel Phase 2 (Step 4) — characterization for the
// `{$pattern}` direct-path membership now routed through the Fenel
// `engine:memberPat` (`dispatchedPatternMember`) instead of the TS
// `patternMatch`. The oracle is the TS `patternMatch` itself (the membership
// SHAPE-MATCH must stay byte-identical); the typed-group captured-value
// recursion is covered by `typed-groups.test.ts`.
//
// This is a CHARACTERIZATION test (the mechanical test-oracle exception — no new
// logic). It pins (a) the Fenel decider path over the preset Patterns and (b)
// the WsWhere FENCE: a `$pattern` carrying a non-char-orderable match predicate
// (here a `$ref` named-set node) must fall back to the TS `patternMatch` leaf,
// byte-identical.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { setPatternContains } from "./set-algebra";
import { patternMatch, match } from "./pattern";
import { getNamedPattern, listNamedPatterns } from "./format-presets";
import { mGet } from "./maybe-bool";

// The Step-4 change is to `setPatternContains` (the `{$pattern}` direct path):
// its membership SHAPE-MATCH now routes through the Fenel `engine:memberPat`
// (`dispatchedPatternMember`) instead of the TS `patternMatch`. The oracle is
// the TS `patternMatch` itself — for the preset Patterns (which carry no
// typed-group `type`, so `extractCaptures`'s type checks are skipped),
// `setPatternContains` == the bare shape match. The typed-group captured-value
// recursion is covered separately by `typed-groups.test.ts`.
const c = (pat: import("./types").Pattern, v: string): boolean =>
  mGet(setPatternContains({ $tag: "SePattern", pattern: pat }, v, null), false);

describe("named-membership pattern-path — preset $pattern via Fenel memberPat", () => {
  const samples = [
    "", "12/31/2020", "2020-01-01", "23:59", "#aabbcc", "1.2.3",
    "550e8400-e29b-41d4-a716-446655440000", "192.168.0.1", "256.0.0.1",
    "K1A 0B1", "+12345678", "1:30 AM", "not a match",
  ];
  it("setPatternContains agrees with TS patternMatch on every preset × sample", () => {
    for (const name of listNamedPatterns()) {
      const pat = getNamedPattern(name)!;
      for (const v of samples) {
        expect(c(pat, v), `${name} on ${JSON.stringify(v)}`).toBe(patternMatch(pat, [...v]));
      }
    }
  }, 60000);
});

describe("named-membership pattern-path — WsWhere fence falls back to patternMatch", () => {
  it("a $pattern with a non-char-orderable ($ref) match node is byte-identical", () => {
    // A match node whose predicate is a named-set $ref marshals to WsWhere ⇒ the
    // dispatch shim must fall back to the TS patternMatch leaf (not silently
    // return false at that node).
    const refPat = match({ $tag: "SeRef", handle: "Int" } as import("./types").SetExpr);
    for (const v of ["", "x", "5", "12"]) {
      expect(c(refPat, v), `refPat on ${JSON.stringify(v)}`).toBe(patternMatch(refPat, [...v]));
    }
  });
});
