// R0.5 (2026-08-28) — THE PERSISTENCE-MARSHALLING BOUNDARY CONTRACT.
//
// WHY A SECOND FILE, when `evaluator.test.ts` already pins this contract.
// Because the two files answer different questions, and only this one answers
// the second.
//
//   * `evaluator.test.ts`'s block (R0) detects a PARTIAL regression: someone
//     changes `rtPlainOwnDataForPersistence` and its own assertions go red.
//   * A WHOLESALE REVERT of R0's two commits (`8ff85112`, `3acb0c36`) deletes
//     those assertions ALONG WITH the behaviour, and every gate stays green.
//     Naming R0's suites in CI is necessary and NOT sufficient.
//
// This file is the wholesale-revert detector, and the mechanism is its FIRST
// LINE: it imports `rtPlainOwnDataForPersistence` by name. That export was
// created by `8ff85112`; reverting it makes the import unresolvable and this
// file red at link time, before a single assertion runs. It is R0.5-OWNED —
// deliberately not an edit to R0's file — so that a revert of R0 cannot take
// its own detector with it.
//
// The assertions below re-state the contract in their own terms rather than
// copying R0's. ⚠ Do NOT read that as redundancy: the first draft of this file
// claimed independent phrasing would stop "a shared mistaken assumption in one
// phrasing" from silencing both, and that claim was FALSIFIED in review — both
// files asserted the hostile `__proto__` KEY survives without asserting its
// VALUE did, and a measured mutation (adapter emits own enumerable
// `__proto__: null`) left both green. Independence did not catch it; a reviewer
// did. The value assertion below is the repair, and it is the only thing that
// makes this file cover that case — R0's copy still does not.
//
// ⚠ WHAT THIS FILE DOES NOT CLAIM. It covers the boundary CONTRACT — the
// adapter's behaviour on the four shapes that matter — and NOT the three
// production PLACEMENTS (the `function_instances` INSERT in `callUserFunction`,
// the suspend `.set()`, the completion `.set()`). Delete a call site and every
// assertion here stays green. Verifying the placements needs a DB-touching or
// drizzle-builder integration test; that is B2's, per R0's R1-9 disposition
// (`workstreams/rights/notes/2026-08-28-r0-login-repair.md` §6.5).
//
// THE DEFECT THIS GUARDS. `rtEmptyDataRecord` mints NULL-PROTOTYPE dictionaries
// on purpose (own-data only). drizzle's `is(value, type)` evaluates
// `Object.getPrototypeOf(value).constructor` unconditionally for any truthy
// object, per column value, one level deep, in BOTH `insert().values()` and the
// `mapUpdateSet` behind `update().set()`, and it runs BEFORE the jsonb encoder.
// `1d7049ce` (field-identity Phase 4b, 2026-07-19) routed such a record into
// `function_instances.variables`; every durable call threw at that write for the
// next five and a half weeks, masked by later registry-boot throws.

import { describe, expect, it } from "bun:test";
import { is, SQL } from "drizzle-orm";

import { rtPlainOwnDataForPersistence } from "./evaluator";

/** A null-prototype record built the way the runtime builds one.
 *
 *  Takes PAIRS, not an object literal, and that is load-bearing: in an object
 *  literal `__proto__: v` is special-cased by the spec (B.3.1) and SETS the
 *  literal's [[Prototype]] instead of creating an own key — so a literal-based
 *  helper would silently make the hostile-key test below vacuous. */
function ownDataRecord(
  entries: ReadonlyArray<readonly [string, unknown]>,
): Record<string, unknown> {
  const record = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return record;
}

describe("persistence marshalling — the drizzle column-value boundary (R0.5)", () => {
  it("the defect reproduces: drizzle's `is()` throws on a null-prototype record", () => {
    const offending = ownDataRecord([["_profileId", "p1"]]);
    expect(Object.getPrototypeOf(offending)).toBeNull();
    // Not merely "throws": the exact shape drizzle's entity.js produces when it
    // reads `.constructor` off a null prototype.
    expect(() => is(offending, SQL)).toThrow(TypeError);
  });

  it("the adapted value carries Object.prototype, so `is()` answers false", () => {
    const source = ownDataRecord([["_profileId", "p1"], ["n", 0], ["s", ""], ["deep", { a: 1 }]]);
    const out = rtPlainOwnDataForPersistence(source);

    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(is(out, SQL)).toBe(false);

    // Every own key survives, with identical values and no additions.
    expect(Reflect.ownKeys(out)).toEqual(Reflect.ownKeys(source));
    for (const key of Object.keys(source)) expect(out[key]).toBe(source[key]);

    // The source is not mutated — this is a copy, not a reprototyping.
    expect(Object.getPrototypeOf(source)).toBeNull();
  });

  it("a hostile own `__proto__` survives as an OWN data key, VALUE included", () => {
    // The load-bearing distinction: spread and a define-copy use
    // CreateDataProperty, so an own `__proto__` remains ordinary data.
    // `Object.assign` uses [[Set]], which invokes `Object.prototype.__proto__`
    // — it would either re-create the very TypeError above (`{"__proto__":
    // null}`) or silently DROP the key from the persisted row.
    const payload = { polluted: true };
    const hostile = ownDataRecord([["__proto__", payload], ["keep", 1]]);
    const out = rtPlainOwnDataForPersistence(hostile);

    const descriptor = Object.getOwnPropertyDescriptor(out, "__proto__");
    expect(descriptor).toBeDefined();
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.set).toBeUndefined();
    expect(descriptor?.enumerable).toBe(true);

    // The VALUE, not just the key — and this is not a hypothetical gap. An
    // adapter that emitted an own enumerable `__proto__: null` while preserving
    // `keep` satisfies every OTHER assertion here (own key, data descriptor,
    // prototype unmoved, key present after `JSON.stringify`) and would silently
    // write `null` into the column where the payload belongs. R0's block in
    // `evaluator.test.ts` has the same omission; writing this file
    // independently did NOT catch it — a reviewer did. Identity, because the
    // copy is shallow.
    expect(descriptor?.value).toBe(payload);

    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();

    // And it reaches the column as DATA — key AND value — rather than
    // vanishing.
    const roundTripped = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    const landed = Object.getOwnPropertyDescriptor(roundTripped, "__proto__");
    expect(landed).toBeDefined();
    expect(landed?.value).toEqual({ polluted: true });
    expect(roundTripped["keep"]).toBe(1);
    expect(is(out, SQL)).toBe(false);
  });

  it("the copy is SHALLOW — a nested null-prototype value is left alone", () => {
    // Shallow is sufficient and is the contract: drizzle inspects ONE level,
    // and `JSON.stringify` is prototype-agnostic. Asserting the nested record
    // is untouched pins that no recursive normalisation crept in.
    const nested = ownDataRecord([["leaf", 7]]);
    const source = ownDataRecord([["nested", nested]]);
    const out = rtPlainOwnDataForPersistence(source);

    expect(out["nested"]).toBe(nested);
    expect(Object.getPrototypeOf(out["nested"] as object)).toBeNull();
    expect(is(out, SQL)).toBe(false);
    expect(JSON.parse(JSON.stringify(out))).toEqual({ nested: { leaf: 7 } });
  });
});
