// ---------------------------------------------------------------------------
// Phase 5a of field-meta-collapse — `meta.defaultLocale` retirement conformance.
//
// Pre-retirement: validate.ts:429 routed `meta.defaultLocale` into the
// dispatched LocaleString validator's `_defaultLocale` param (underscored,
// never read). The Fenel body never accepted a locale slot.
//
// Post-retirement (this commit): the key is deleted from FieldMetadata, the
// plumbing call-sites + the dispatch param are gone. These tests pin three
// invariants:
//
//   1. A $map-LocaleString-shaped type validates plain-string and
//      locale-map values without referencing any defaultLocale slot.
//   2. Legacy FieldDef rows carrying stale `meta.defaultLocale` continue
//      to load + validate (the key is silently ignored at the read path
//      since validate.ts no longer reads it).
//   3. Plain-string vs locale-map vs legacy-row paths produce identical
//      results — the deletion is a no-op for execution.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FenelType, FieldDef } from "./types";
import { validate, validateFormFieldShim } from "./validate";
import { Nothing } from "./type-foundation";
const LocaleStringType: FenelType = {
  $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } },
};

describe("Phase 5a — meta.defaultLocale retirement", () => {
  it("validates a plain-string LocaleString value without reading any defaultLocale slot", () => {
    const result = validate(LocaleStringType, "hello", null);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates a locale-map LocaleString value", () => {
    const result = validate(LocaleStringType, { en: "hello", fr: "bonjour" }, null);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("ignores a stale meta.defaultLocale on a legacy FieldDef row", () => {
    // Legacy row shape — FieldMetadata no longer carries defaultLocale, but
    // a row written before Phase 5a may still have it. The validator must
    // not throw, and the result must match the same FieldDef without the key.
    const cleanField: FieldDef = {
      key: { $tag: "NamedField", ref: { $ref: "66666666-6666-4666-8666-666666666666" } },
      name: "title",
      label: Nothing,
      type: LocaleStringType,
      meta: {},
      ui: Nothing,
    };
    const legacyField = {
      key: { $tag: "NamedField", ref: { $ref: "66666666-6666-4666-8666-666666666666" } },
      name: "title",
      label: Nothing,
      type: LocaleStringType,
      ui: Nothing,
      meta: { defaultLocale: "en-US" },
    } as unknown as FieldDef;

    const cleanResult = validateFormFieldShim(
      cleanField,
      { en: "hello" },
      "title",
      {},
      {}, null,
    );
    const legacyResult = validateFormFieldShim(
      legacyField,
      { en: "hello" },
      "title",
      {},
      {}, null,
    );

    expect(cleanResult.errors).toEqual([]);
    expect(legacyResult.errors).toEqual([]);
    expect(legacyResult).toEqual(cleanResult);
  });
});
