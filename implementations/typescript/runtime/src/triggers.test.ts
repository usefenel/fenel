import { describe, it, expect } from "vitest";
import { triggerMatches } from "./triggers";
import type { FunctionTrigger } from "./types";

const t = (spec: Record<string, unknown>): FunctionTrigger => spec as FunctionTrigger;

describe("triggerMatches — type matching", () => {
  it("returns true when trigger.type matches event type", () => {
    expect(triggerMatches(t({ type: "order_placed" }), "order_placed", {})).toBe(true);
  });

  it("returns false when trigger.type differs", () => {
    expect(triggerMatches(t({ type: "order_placed" }), "order_cancelled", {})).toBe(false);
  });
});

describe("triggerMatches — filter fields", () => {
  it("scalar filter requires exact match on the payload field", () => {
    const trigger = t({ type: "order_placed", country: "US" });
    expect(triggerMatches(trigger, "order_placed", { country: "US" })).toBe(true);
    expect(triggerMatches(trigger, "order_placed", { country: "FR" })).toBe(false);
    expect(triggerMatches(trigger, "order_placed", {})).toBe(false);
  });

  it("array filter requires the payload value to be in the array", () => {
    const trigger = t({ type: "purchase_made", plan: ["pro", "enterprise"] });
    expect(triggerMatches(trigger, "purchase_made", { plan: "pro" })).toBe(true);
    expect(triggerMatches(trigger, "purchase_made", { plan: "enterprise" })).toBe(true);
    expect(triggerMatches(trigger, "purchase_made", { plan: "free" })).toBe(false);
  });

  it("multiple filters must all match (AND semantics)", () => {
    const trigger = t({ type: "signup", country: "US", source: "web" });
    expect(
      triggerMatches(trigger, "signup", { country: "US", source: "web" }),
    ).toBe(true);
    expect(
      triggerMatches(trigger, "signup", { country: "US", source: "mobile" }),
    ).toBe(false);
    expect(
      triggerMatches(trigger, "signup", { country: "FR", source: "web" }),
    ).toBe(false);
  });

  it("once_per_profile is metadata, not a filter", () => {
    // once_per_profile must NOT be treated as a payload requirement.
    const trigger = t({ type: "signup", once_per_profile: true });
    expect(triggerMatches(trigger, "signup", {})).toBe(true);
    expect(triggerMatches(trigger, "signup", { once_per_profile: false })).toBe(true);
  });

  it("payload extras don't affect matching (subset semantics on filters)", () => {
    const trigger = t({ type: "signup", source: "web" });
    // Trigger only filters `source`; extra payload fields are ignored.
    expect(
      triggerMatches(trigger, "signup", { source: "web", country: "US", id: "x" }),
    ).toBe(true);
  });
});

describe("triggerMatches — edge cases", () => {
  it("trigger with no filters matches any payload of the right type", () => {
    expect(triggerMatches(t({ type: "tick" }), "tick", {})).toBe(true);
    expect(triggerMatches(t({ type: "tick" }), "tick", { foo: "bar" })).toBe(true);
  });

  it("scalar filter: undefined payload field fails the match", () => {
    expect(triggerMatches(t({ type: "x", k: "v" }), "x", {})).toBe(false);
  });

  it("array filter: undefined payload field fails (array.includes(undefined) is false)", () => {
    expect(triggerMatches(t({ type: "x", k: ["a", "b"] }), "x", {})).toBe(false);
  });

  it("array filter with empty list never matches", () => {
    expect(triggerMatches(t({ type: "x", k: [] }), "x", { k: "anything" })).toBe(false);
  });

  it("trigger type and event type must match exactly (no prefix / wildcard semantics)", () => {
    expect(triggerMatches(t({ type: "user.signup" }), "user_signup", {})).toBe(false);
    expect(triggerMatches(t({ type: "user" }), "user_signup", {})).toBe(false);
  });
});
