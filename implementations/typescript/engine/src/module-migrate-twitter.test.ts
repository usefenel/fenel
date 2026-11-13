// ---------------------------------------------------------------------------
// module-migrate-twitter.test.ts — module-substrate Phase 3q parity proof.
//
// `twitter` (one half of the Surprise #30 "signature-only pair") moved off its
// ~98-LOC TS `defineFunction` spec wrapper onto `fenel/modules/twitter/
// twitter.fenel` (`module twitter where` + the `TweetMetrics` entity + 3
// bodyless `@native` foreign decls + the PURE Fenel-bodied
// `twitter_check_viral`) + a thin `loadFenelModule` seam. Importing
// `twitterModule` runs `loadFenelModule` at module-eval time, so a parse error
// in the `.fenel` (incl. the `twitter_check_viral` body) fails this file.
//
// Three blessed surface improvements verified here: the anon 5-field return →
// named `TweetMetrics`; `twitter_check_viral` → a Fenel body honouring the
// declared `Boolean` sig (the native's debug record is gone); param labels +
// (n/a) defaults dropped. Facets are byte-identical; NO stored Categorizable.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { twitterModule } from "./modules/twitter";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

const FN_IDS = [
  "twitter:twitter_get_metrics",
  "twitter:twitter_get_recent",
  "twitter:twitter_post_reply",
  "twitter:twitter_check_viral",
];

// The retired defineFunction identity (label / description / tags), preserved
// byte-identically by the @label/@description/@tags directives. The
// check_viral description preserves the stale `+ quotes*5` term VERBATIM for
// facet parity (the native never computed quotes; see the .fenel divergence).
const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "twitter:twitter_get_metrics": {
    label: "Get Tweet Metrics",
    description:
      "Fetch engagement metrics for a tweet. Uses fxtwitter syndication for public data, or account cookies for private.",
    tags: ["social", "twitter", "metrics"],
  },
  "twitter:twitter_get_recent": {
    label: "Get Recent Tweets",
    description: "Fetch recent tweets from an account. Requires Twitter cookies (ct0 + auth_token).",
    tags: ["social", "twitter"],
  },
  "twitter:twitter_post_reply": {
    label: "Post Reply",
    description: "Post a reply to a tweet. Requires Twitter cookies.",
    tags: ["social", "twitter", "post"],
  },
  "twitter:twitter_check_viral": {
    label: "Check Viral",
    description:
      "Pure function — check if tweet metrics exceed a virality threshold. score = (likes + retweets*3 + quotes*5) / hours_since_post.",
    tags: ["social", "twitter", "formula", "pure"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";

describe("twitter migration — header-driven identity + roster", () => {
  test("the `module twitter where` header is authoritative (lowercase prefix preserved)", () => {
    expect(twitterModule.name).toBe("twitter");
  });

  test("all 4 functions registered under the legacy `twitter:` id-prefix", () => {
    expect((twitterModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("codeName === id-suffix for every fn (no @codeName)", () => {
    const insts = twitterModule.instances ?? [];
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1];
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: suffix });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, twitterModule]);
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)).toBeTruthy();
      expect(reg.getFunctionByCodeName(suffix)).toBeTruthy();
    }
  });
});

describe("twitter migration — TweetMetrics named return (improvement #1)", () => {
  test("TweetMetrics entity rides along with its 5 fields", () => {
    const ent = (twitterModule.entities ?? []).find((e) => e.id === "TweetMetrics");
    expect(ent).toBeDefined();
    const rec = (ent!.type as { $record?: { fields: { name: string }[] } }).$record;
    expect(rec).toBeDefined();
    expect(rec!.fields.map((f) => f.name)).toEqual(["likes", "retweets", "replies", "views", "text"]);
  });

  test("twitter_get_metrics returns the named TweetMetrics type", () => {
    const f = (twitterModule.functions ?? []).find((f) => f.id === "twitter:twitter_get_metrics");
    // 7g-parser: a user-written type-name return parses to {$ref} (was {$ref}).
    expect(f?.returns).toEqual({ $ref: "TweetMetrics" } as never);
  });
});

describe("twitter migration — natives bodyless, check_viral Fenel-bodied (#2)", () => {
  test("the 3 IO fns are bodyless @native; twitter_check_viral has a BODY", () => {
    const byId = new Map((twitterModule.functions ?? []).map((f) => [f.id, f]));
    expect(byId.get("twitter:twitter_get_metrics")?.body).toBeUndefined();
    expect(byId.get("twitter:twitter_get_recent")?.body).toBeUndefined();
    expect(byId.get("twitter:twitter_post_reply")?.body).toBeUndefined();
    expect(byId.get("twitter:twitter_check_viral")?.body).toBeDefined();
  });

  test("the check_viral body composes the documented score operators + the Maybe-threshold case", () => {
    const f = (twitterModule.functions ?? []).find((f) => f.id === "twitter:twitter_check_viral");
    const body = JSON.stringify(f!.body);
    // operators serialize via their Infixable fnId (add/mul/div/gte/gt).
    expect(body).toContain("add"); // likes + retweets*3
    expect(body).toContain("mul"); // retweets * 3
    expect(body).toContain("div"); // / max(hours_old, 0.1)
    expect(body).toContain("gte"); // score >= threshold
    expect(body).toContain("gt"); //  hours_old > 0.1 guard
    // the Nothing→50 / Just→m threshold branch.
    expect(body).toContain("50");
  });

  test("returns Boolean (the declared sig is honoured; the native's debug record is gone)", () => {
    const f = (twitterModule.functions ?? []).find((f) => f.id === "twitter:twitter_check_viral");
    // 7g-parser: a user-written type-name return parses to {$ref} (was {$ref}).
    expect(f?.returns).toEqual({ $ref: "Boolean" } as never);
  });
});

describe("twitter migration — facet parity + dropped surface (#3)", () => {
  const insts = twitterModule.instances ?? [];

  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Phase 3j (identity-as-fallback): twitter declares no @category → none
  // carry a stored Categorizable; the `twitter` category derives at read time.
  test("NO stored Categorizable on any fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });

  test("no param defaults survive (labels dropped, defaults n/a)", () => {
    for (const f of twitterModule.functions ?? []) {
      for (const p of f.params ?? []) {
        expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
      }
    }
  });
});
