import { expect, test } from "bun:test";
import { matchReviewedEntityProjectionAnchor, type ReviewedEntityProjectionAnchor } from "./compiled-artifact-projection-anchor";

test("a full baseline does not promote a changed consumer surface into the old category", () => {
  const anchor: ReviewedEntityProjectionAnchor = { schema: "fenel.owner-input-projection-anchor.v1",
    category: "canonical-standalone-entity-envelope.v1", policyDigest: "a".repeat(64),
    consumerSurfaceDigest: "b".repeat(64), finiteConsumerPlanDigest: "c".repeat(64) };
  const current = { policyDigest: anchor.policyDigest, consumerSurfaceDigest: anchor.consumerSurfaceDigest,
    finiteConsumerPlanDigest: anchor.finiteConsumerPlanDigest };
  expect(matchReviewedEntityProjectionAnchor(anchor, current)).toBe("REVIEWED");
  // For example: a new conditional function read is dormant on today's source
  // but becomes live after the next source-data edit. MATCH is insufficient.
  const changedConsumerAfterFullMatch = { ...current,
    consumerSurfaceDigest: "d".repeat(64), fullRenderMatched: true };
  expect(matchReviewedEntityProjectionAnchor(anchor, changedConsumerAfterFullMatch)).toBe("UNREVIEWED");
  expect(matchReviewedEntityProjectionAnchor(undefined, current)).toBe("UNREVIEWED");
  expect(matchReviewedEntityProjectionAnchor(anchor, { ...current, policyDigest: "changed-selector" })).toBe("UNREVIEWED");
  expect(matchReviewedEntityProjectionAnchor({ schema: anchor.schema, category: anchor.category } as ReviewedEntityProjectionAnchor,
    {} as typeof current)).toBe("UNREVIEWED");
  let getterReads = 0;
  const accessorAnchor = { ...anchor };
  Object.defineProperty(accessorAnchor, "policyDigest", { get() { getterReads++; return anchor.policyDigest; } });
  expect(matchReviewedEntityProjectionAnchor(accessorAnchor, current)).toBe("UNREVIEWED");
  expect(getterReads).toBe(0);
});
