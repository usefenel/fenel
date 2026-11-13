import { expect, test } from "bun:test";
import {
  assertFenelParseCacheParity,
  incrementalCacheArtifactIsReusable,
  incrementalCacheEntryIsReusable,
  parseCacheProgressLine,
} from "./generate-parse-cache";
import { PARSE_CACHE_AST_ABI_VERSION } from "../src/parse-cache";

test("incremental cache reuse JSON-normalizes the current parser shape", () => {
  const committed = { type_def: { name: "Age", fields: [{ name: "_0" }] } };
  const mirror = {
    type_def: {
      name: "Age",
      fields: [{ name: "_0", omittedAtJsonBoundary: undefined }],
    },
  };

  expect(incrementalCacheEntryIsReusable(committed, mirror)).toBe(true);
});

test("incremental cache reuse rejects parser-output drift for unchanged source", () => {
  const committed = { type_def: { name: "Age", fields: [{ name: "_0" }] } };
  const mirror = {
    type_def: {
      name: "Age",
      fields: [{
        name: "_0",
        key: { $tag: "PositionalField", index: 0 },
      }],
    },
  };

  expect(incrementalCacheEntryIsReusable(committed, mirror)).toBe(false);
});

test("incremental cache refreshes stale identified List fields for unchanged source", () => {
  const committed = {
    $opaque: {
      name: "List",
      pure: {
        $variant: {
          cases: [{
            name: "Cons",
            fields: [{
              name: "head",
              key: { $tag: "NamedField", ref: { $ref: "stale-physical-id" } },
            }],
          }],
        },
      },
    },
  };
  const mirror = {
    $opaque: {
      name: "List",
      pure: {
        $variant: {
          cases: [{ name: "Cons", fields: [{ name: "head" }] }],
        },
      },
    },
  };

  expect(incrementalCacheEntryIsReusable(committed, mirror)).toBe(false);
});

test("incremental cache refuses all reuse across an AST ABI epoch", () => {
  expect(incrementalCacheArtifactIsReusable(PARSE_CACHE_AST_ABI_VERSION)).toBe(true);
  expect(incrementalCacheArtifactIsReusable(PARSE_CACHE_AST_ABI_VERSION - 1)).toBe(false);

  const unchanged = { type_def: { name: "Age" } };
  expect(incrementalCacheEntryIsReusable(unchanged, unchanged)).toBe(true);
});

test("parse-cache progress identifies parser path and corpus position deterministically", () => {
  expect(
    parseCacheProgressLine(7, 330, "fenel/modules/engine/check.fenel", "probe"),
  ).toBe(
    "[parse-cache:progress] 007/330 probe fenel/modules/engine/check.fenel",
  );
  expect(
    parseCacheProgressLine(7, 330, "fenel/modules/engine/check.fenel", "ts-fence"),
  ).toBe(
    "[parse-cache:progress] 007/330 ts-fence fenel/modules/engine/check.fenel",
  );
  expect(
    parseCacheProgressLine(330, 330, "fenel/std/syntax.fenel", "fenel"),
  ).toBe(
    "[parse-cache:progress] 330/330 fenel fenel/std/syntax.fenel",
  );
});

test("fresh Fenel payload verification normalizes absent members without changing the payload", () => {
  const fenel = { def: { name: "example", body: 42 } };
  const oracle = { def: { name: "example", body: 42, absent: undefined } };
  expect(() => assertFenelParseCacheParity(fenel, oracle, "example.fenel")).not.toThrow();
  expect(fenel).toEqual({ def: { name: "example", body: 42 } });
});

test("fresh non-fence AST mismatch refuses rather than substituting the oracle", () => {
  const body = "private fixture content".repeat(1000);
  const fenel = { def: { name: "example", body } };
  const oracle = { def: { name: "example", body: 42 } };
  let message = "";
  try { assertFenelParseCacheParity(fenel, oracle, "example.fenel"); }
  catch (error) { message = (error as Error).message; }
  expect(message).toContain("non-fence Fenel AST differs");
  expect(message).toContain("example.fenel");
  expect(message).toContain("first differing JSON code unit");
  expect(message).toContain("no oracle payload was substituted");
  expect(message.length).toBeLessThan(350);
  expect(message).not.toContain("private fixture content");
  expect(fenel.def.body).toBe(body);
});
