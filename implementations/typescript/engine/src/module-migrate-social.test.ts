// ---------------------------------------------------------------------------
// module-migrate-social.test.ts — typed-function-references FenelModule-retirement
// Phase FM-retire-3 parity proof.
//
// `social` moved off its ~262-LOC TS wrapper (2 `defineFunction` specs + 3
// hand-written `Interface`s + 4 hand-written `Instance` consts) onto three
// `module social where` `.fenel` files (`social.fenel` / `typeclasses.fenel` /
// `instances.fenel`) + a thin `loadFenelModule` + `seedFromType` seam. Importing
// `socialModule` / `socialTypeclasses` runs the loaders at module-eval time, so a
// parse error in any `.fenel` fails this file.
//
// Pins the FIRST module-local capability HIERARCHY authored super-as-field
// outside `fenel/std/typeclass-specs.fenel`: the 3 classes derive their methods +
// `seed.supers` byte-identically to the deleted hand-written seeds, ordered
// Social-before-subclasses. Plus: crosspost's empty-record placeholder → the
// named `CrosspostResult`; engagement_score body preserved + `@category` dropped;
// the 4 dispatch instances project with their (inert) dangling handles; the
// `_constraints`/`_engagement` non-method metadata is dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { socialModule, socialTypeclasses } from "./modules/social";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

const FN_IDS = ["social:crosspost", "social:engagement_score"];

const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "social:crosspost": {
    label: "Crosspost",
    description:
      "Post content to multiple platforms. FenelCheck narrows body constraints per target — 500-char body to Twitter is a type error.",
    tags: ["social", "crosspost"],
  },
  "social:engagement_score": {
    label: "Engagement Score",
    description:
      "Compute engagement score from metrics. Works on any platform — uses row polymorphism (only needs likes + comments/replies).",
    tags: ["social", "pure", "analytics"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("social migration — header-driven identity + roster", () => {
  test("the `module social where` header is authoritative", () => {
    expect(socialModule.name).toBe("social");
  });

  test("both functions registered under the `social:` id-prefix", () => {
    expect((socialModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, socialModule]);
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)).toBeTruthy();
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });
});

describe("social migration — crosspost no-corner-cut return (Decision 2)", () => {
  test("CrosspostResult + SocialTarget entities ride along", () => {
    const ids = (socialModule.entities ?? []).map((e) => e.id);
    expect(ids).toContain("CrosspostResult");
    expect(ids).toContain("SocialTarget");
  });

  test("crosspost return is { results: [CrosspostResult] } — NOT the empty-record placeholder", () => {
    const f = (socialModule.functions ?? []).find((x) => x.id === "social:crosspost");
    const ret = f?.returns as { $record?: { fields: { name: string; type: unknown }[] } };
    expect(ret.$record).toBeDefined();
    const results = ret.$record!.fields.find((fl) => fl.name === "results");
    expect(results).toBeDefined();
    // the inner List element is the declared CrosspostResult, not `{$record:{fields:[]}}`.
    const body = JSON.stringify(results!.type);
    expect(body).toContain('"$ref":"CrosspostResult"');
    expect(body).not.toContain('"fields":[]');
  });

  test("crosspost is bodyless @native; engagement_score has a BODY", () => {
    const byId = new Map((socialModule.functions ?? []).map((f) => [f.id, f]));
    expect(byId.get("social:crosspost")?.body).toBeUndefined();
    expect(byId.get("social:engagement_score")?.body).toBeDefined();
  });
});

describe("social migration — the capability HIERARCHY (super-as-field)", () => {
  test("3 classes derive Social-first, methods byte-match the retired seeds", () => {
    expect(socialTypeclasses.map((c) => c.name)).toEqual(["Social", "Conversational", "Discoverable"]);
    const byName = new Map(socialTypeclasses.map((c) => [c.name, c]));
    expect(byName.get("Social")!.methods.map((m) => m.name)).toEqual([
      "read_post",
      "create_post",
      "get_metrics",
      "list_recent",
    ]);
    expect(byName.get("Conversational")!.methods.map((m) => m.name)).toEqual(["post_reply", "get_thread"]);
    expect(byName.get("Discoverable")!.methods.map((m) => m.name)).toEqual(["search", "trending"]);
  });

  test("Conversational + Discoverable carry the Social super (the `social:` field erased)", () => {
    const byName = new Map(socialTypeclasses.map((c) => [c.name, c]));
    expect(byName.get("Social")!.supers).toBeUndefined();
    const expectedSuper = [{ class: { $tag: "Id", entityId: "Social" }, args: [{ $var: "platform" }] }];
    expect(byName.get("Conversational")!.supers).toEqual(expectedSuper as never);
    expect(byName.get("Discoverable")!.supers).toEqual(expectedSuper as never);
  });
});

describe("social migration — the 4 dispatch instances (inert handles; metadata dropped)", () => {
  const insts = socialModule.instances ?? [];

  test("all 4 platform instances project (twitter Social+Conversational, telegram, instagram)", () => {
    expect(methodOf(insts, "Social", "twitter")).toBeDefined();
    expect(methodOf(insts, "Conversational", "twitter")).toBeDefined();
    expect(methodOf(insts, "Social", "telegram")).toBeDefined();
    expect(methodOf(insts, "Social", "instagram")).toBeDefined();
  });

  test("method handles are the (inert) dangling {$ref} codeName refs", () => {
    const m = methodOf(insts, "Social", "twitter")!;
    expect(m.read_post).toEqual({ $ref: "twitter_get_metrics" });
    expect(m.list_recent).toEqual({ $ref: "twitter_get_recent" });
  });

  test("the dropped _constraints / _engagement metadata is GONE from every instance", () => {
    for (const i of insts.filter((x) => ["Social", "Conversational"].includes(x.typeName))) {
      expect(i.methods).not.toHaveProperty("_constraints");
      expect(i.methods).not.toHaveProperty("_engagement");
    }
  });
});

describe("social migration — facet parity + dropped surface", () => {
  const insts = socialModule.instances ?? [];

  test("Labelable + Describable + Taggable byte-identical for both fns", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  // Phase 3j (identity-as-fallback): social declares no @category (the former
  // `@category "social"` on engagement_score dropped) → none carry a stored
  // Categorizable; the `social` category derives at read time from the id-prefix.
  test("NO stored Categorizable on either fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});
