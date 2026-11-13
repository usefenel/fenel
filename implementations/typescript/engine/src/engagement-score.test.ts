// ---------------------------------------------------------------------------
// engagement-score.test.ts — ts-elimination-completion Phase 6 round-trip proof.
//
// `social:engagement_score` moved from an inline JSON-Logic `body:` literal in
// modules/social.ts to `.fenel` source (fenel/modules/social/engagement-
// score.fenel). This test runs the new `.fenel` body IN-PROCESS via
// invokeCallable against a registry built from [std, social] and asserts
// DEEP-EQUALITY vs an inline copy of the EXACT original JSON-Logic
// (`{ if: [ {">":[views,0]}, … ] }`).
//
// The crux: `views` is Maybe<Number>; the TS oracle reads `views > 0`
// directly, so Nothing / absent / 0 all take the else-branch. The cases
// below pin views>0 / views=0 / views absent / zero-comments — proving the
// `gt views 0` port reproduces the oracle's falsy-branch semantics.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { socialModule } from "./modules/social";
import { createRegistry } from "./registry";
import { invokeCallable, evaluate } from "./json-logic";

const reg = createRegistry([stdModule, socialModule]);
const ctx = reg.evaluateContext();

// --- TS reference: inline copy of the pre-port original JSON-Logic ----------
// (social.ts:218-224, verbatim.)
const ORIGINAL_BODY = {
  if: [
    { ">": [{ var: "views" }, 0] },
    { "/": [{ "+": [{ var: "likes" }, { "*": [{ var: "comments" }, 3] }] }, { var: "views" }] },
    { "+": [{ var: "likes" }, { "*": [{ var: "comments" }, 3] }] },
  ],
};

const fenel = (likes: unknown, comments: unknown, views: unknown) =>
  invokeCallable("social:engagement_score", [likes, comments, views], ctx);
const oracle = (likes: unknown, comments: unknown, views: unknown) =>
  evaluate(ORIGINAL_BODY, { likes, comments, views }, ctx);

// Assert both: Fenel === oracle, AND oracle === expected (so the reference
// itself is pinned, not just mutually-consistent with a wrong Fenel body).
function assertScore(likes: unknown, comments: unknown, views: unknown, expected: unknown) {
  const ref = oracle(likes, comments, views);
  expect(ref).toEqual(expected as never);
  expect(fenel(likes, comments, views)).toEqual(ref as never);
}

describe("Phase 6 — social:engagement_score is .fenel-bodied and registered", () => {
  test("registered with the ported .fenel body (no inline literal)", () => {
    const fn = reg.getFunction("social:engagement_score");
    expect(fn?.id).toBe("social:engagement_score");
    expect(fn?.body).toBeDefined();
    expect(reg.getFunctionByCodeName("engagement_score")?.id).toBe("social:engagement_score");
  });
});

describe("Phase 6 — engagement_score round-trips vs the original JSON-Logic", () => {
  test("views > 0 — uses the division branch", () => {
    // (10 + 5*3) / 5 = 25 / 5 = 5
    assertScore(10, 5, 5, 5);
  });

  test("views > 0, zero comments — division branch with comments=0", () => {
    // (8 + 0*3) / 4 = 2
    assertScore(8, 0, 4, 2);
  });

  test("views = 0 — falls to the else-branch (likes + comments*3)", () => {
    // 10 + 5*3 = 25
    assertScore(10, 5, 0, 25);
  });

  test("views absent (undefined) — else-branch (Nothing is falsy via > 0)", () => {
    assertScore(7, 2, undefined, 13);
  });

  test("views as canonical Nothing — else-branch", () => {
    assertScore(7, 2, { $tag: "Nothing" }, 13);
  });

  test("zero comments and zero views — else-branch is just likes", () => {
    assertScore(9, 0, 0, 9);
  });
});
