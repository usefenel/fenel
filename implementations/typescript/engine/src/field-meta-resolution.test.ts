// Phase 2 of field-meta-collapse — conformance tests for the retired
// `meta.numberResolution` / `meta.dateResolution` sidecar keys, now
// expressed as `$refined { set: $where … }` wrappers that call the
// `isMultipleOf` / `validateDateResolution` std functions.
//
// Coverage:
//   - The two std functions are registered + dispatch correctly.
//   - The validator accepts / rejects values against the predicate-style
//     refinement.
//   - The `$intersect` composition (preset + resolution) holds.
//
// Note: the field-editor's round-trip (schemaFieldToDraft /
// draftToSchemaField) is covered by an inline smoke test in the commit's
// Phase 2 brief notes — there is no Solid-side vitest harness yet to
// host it here. When a `distros/narthex/solid/...test.ts` setup
// lands, port the round-trip cases over.

import { describe, it, expect } from "vitest";
import { validate } from "./validate";
import { stdModule } from "./modules/std";
import { evaluate } from "./json-logic";
import { getSystemEvaluateContext } from "./system-registry";
import type { FenelType } from "./types";

describe("isMultipleOf / validateDateResolution — Fenel-bodied std fns", () => {
  it("isMultipleOf body dispatches through registry", () => {
    const spec = stdModule.functions?.find((f) => f.id === "std:isMultipleOf");
    expect(spec).toBeDefined();
    expect(spec!.body).toBeDefined();
    const ctx = getSystemEvaluateContext();
    const call = (v: number, n: number, d: number) =>
      evaluate({ call: ["isMultipleOf", v, n, d] }, {}, ctx);
    expect(call(1.01, 1, 100)).toBe(true);
    expect(call(1.005, 1, 100)).toBe(false);
    expect(call(7, 1, 1)).toBe(true);
  });
  it("validateDateResolution body dispatches through registry", () => {
    const spec = stdModule.functions?.find((f) => f.id === "std:validateDateResolution");
    expect(spec).toBeDefined();
    expect(spec!.body).toBeDefined();
    const ctx = getSystemEvaluateContext();
    const call = (v: string, l: string) =>
      evaluate({ call: ["validateDateResolution", v, l] }, {}, ctx);
    expect(call("2026", "year")).toBe(true);
    expect(call("2026-04-12", "year")).toBe(false);
    expect(call("2026-04-12", "day")).toBe(true);
  });
});

describe("$refined number-resolution — validator accepts/rejects via $where", () => {
  // The shape the field-editor now emits for `{ type: "number", resolution: [1, 100] }`.
  const cents: FenelType = {
    $refined: {
      base: { $ref: "Number" },
      set: { $tag: "SeWhere", pred: { call: ["isMultipleOf", { var: "value" }, 1, 100] } },
    },
  };

  it("accepts 1.01 (multiple of 0.01)", () => {
    expect(validate(cents, 1.01, null).valid).toBe(true);
  });
  it("rejects 1.005 (not a multiple of 0.01)", () => {
    expect(validate(cents, 1.005, null).valid).toBe(false);
  });
  it("accepts integer value 7", () => {
    expect(validate(cents, 7, null).valid).toBe(true);
  });
});

describe("$refined date-resolution — validator accepts/rejects via $where", () => {
  const yearOnly: FenelType = {
    $refined: {
      base: { $ref: "Date" },
      set: { $tag: "SeWhere", pred: { call: ["validateDateResolution", { var: "value" }, "year"] } },
    },
  };

  it("accepts year-only string 2026", () => {
    expect(validate(yearOnly, "2026", null).valid).toBe(true);
  });
  it("rejects day-precision string 2026-04-12 against year level", () => {
    expect(validate(yearOnly, "2026-04-12", null).valid).toBe(false);
  });
});

describe("$intersect — preset composes with resolution-$where", () => {
  // Integer preset ∩ multiples-of-1: covers the editor's `number:integer +
  // resolution [1, 1]` case. The two refinements stack — both must hold.
  const intMultOfOne: FenelType = {
    $refined: {
      base: { $ref: "Number" },
      set: { $tag: "SeIntersect", branches: [
          { $tag: "SeRef", handle: "ℤ" },
          { $tag: "SeWhere", pred: { call: ["isMultipleOf", { var: "value" }, 1, 1] } },
        ] },
    },
  };

  it("accepts integer 7", () => {
    expect(validate(intMultOfOne, 7, null).valid).toBe(true);
  });
  it("rejects non-integer 7.5", () => {
    expect(validate(intMultOfOne, 7.5, null).valid).toBe(false);
  });
});
