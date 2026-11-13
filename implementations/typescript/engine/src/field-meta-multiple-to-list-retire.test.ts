// ---------------------------------------------------------------------------
// Phase 5c of field-meta-collapse — `meta.multiple` → `$list T` promotion
// conformance.
//
// Pre-retirement: `FieldMetadata.multiple?: boolean` was a String-only
// sidecar key that turned a `$refined String $enum [...]` field into a
// multi-select. The Fenel body's `validateStringMultiCollect` helper
// walked an array of strings against the set, duplicating universal
// `$list T` validation.
//
// Post-retirement (this commit): the key is deleted from FieldMetadata,
// the writer promotes the field's type to `$list { elem: <original-type> }`,
// the readers (validate / widget-hint / json-schema / FieldRenderer) all
// resolve list-shape via `peelList`, the Fenel body's multi-arm + helper
// are gone, and migration `0052` lifts persisted rows. The FieldRenderer
// carried a soft-fallback (route legacy `meta.multiple===true` rows to
// ListEditor) during the migration window; Phase 5d (2026-05-26) removed
// it after staging confirmed zero rows.
//
// These tests pin five invariants:
//
//   1. A FieldDef written with `$list ($refined String $enum [...])` (the
//      new shape) round-trips + validates cleanly.
//   2. The same field type rejects a non-array value (the universal list
//      validator's job — proves the list branch is in play, not the
//      retired multi-arm).
//   3. The migration lift rule (TS mirror of the PL/pgSQL walker) wraps
//      `type` in `$list { elem: <original> }`, drops `meta.multiple`,
//      and drops `meta` entirely when empty.
//   4. The lift rule is idempotent on rows whose `type` is already
//      `$list`-shaped — drop the key, leave the type.
//   5. `engine:validateStringMultiCollect` is gone from the engine
//      module's function list — the helper retired.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FenelType, FieldDef } from "./types";
import { validate } from "./validate";
import { List, Nothing } from "./type-foundation";
import { peelList } from "./set-algebra";
import { normalizeFenelTypeShorthand } from "./type-normalize";
import { engineModule } from "./modules/engine";

const ENUM_TYPE: FenelType = {
  $refined: {
    base: { $ref: "String" },
    set: { $tag: "SeEnum", values: ["lead", "client", "competition"] },
  },
};

// Canonical FenelType form for the writer (List helper expands to
// `$opaque { repr: "array", pure: μX. Nil | Cons }`).
const LIST_TYPE: FenelType = List(ENUM_TYPE);

// Exact historical wire emitted by migration 0052. Unlike the supported
// `$list: T` shorthand, its extra `elem` wrapper is not a FenelType.
const LIST_SHORTHAND = { $list: { elem: ENUM_TYPE } } as const;

/** TS mirror of the PL/pgSQL walker in migration 0052. Operates on a
 *  single FieldDef-shaped object; the recursive sweep over JSONB
 *  documents is the migration's job, not the test's. */
function liftFieldMultiple(field: Record<string, unknown>): Record<string, unknown> {
  const meta = field["meta"];
  if (!meta || typeof meta !== "object" || (meta as Record<string, unknown>)["multiple"] !== true) {
    return field;
  }
  const metaObj = meta as Record<string, unknown>;
  const typeVal = field["type"];

  // Defensive idempotency — type already $list-shaped, just drop the key.
  const newType =
    typeVal && typeof typeVal === "object" && "$list" in (typeVal as object)
      ? typeVal
      : { $list: { elem: typeVal } };

  const { multiple: _stripped, ...restMeta } = metaObj;
  void _stripped;

  const result: Record<string, unknown> = { ...field, type: newType };
  if (Object.keys(restMeta).length === 0) {
    delete result["meta"];
  } else {
    result["meta"] = restMeta;
  }
  return result;
}

describe("Phase 5c — meta.multiple → $list T promotion", () => {
  it("round-trips a FieldDef with $list($refined String $enum) through JSON", () => {
    const field: FieldDef = {
      name: "tags",
      label: Nothing,
      type: LIST_TYPE,
      meta: {},
      ui: Nothing,
    };
    const round: FieldDef = JSON.parse(JSON.stringify(field));
    expect(round.type).toEqual(LIST_TYPE);
    expect((round as { meta?: { multiple?: boolean } }).meta?.multiple).toBeUndefined();
  });

  it("validates an array value via the universal list branch", () => {
    const result = validate(LIST_TYPE, ["lead", "client"], null);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a non-array value (proves list branch is in play, not multi-arm)", () => {
    const result = validate(LIST_TYPE, "lead", null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("migration lift wraps type in $list shorthand, drops meta.multiple, drops meta when empty", () => {
    const legacyField = {
      name: "tags",
      label: Nothing,
      type: ENUM_TYPE,
      ui: Nothing,
      meta: { multiple: true },
    };
    const lifted = liftFieldMultiple(legacyField);
    // Preserve the historical migration oracle instead of rewriting its wire
    // to the supported `$list: T` shorthand. Normalization keeps the extra
    // wrapper as the element; the strict semantic reader must refuse it.
    expect(lifted["type"]).toEqual(LIST_SHORTHAND);
    expect(lifted["meta"]).toBeUndefined();
    const normalized = normalizeFenelTypeShorthand(lifted["type"]);
    expect(normalized.value).toEqual(List({ elem: ENUM_TYPE } as unknown as FenelType));
    expect(normalized.rewrites).toBe(1);
    expect(() => peelList(normalized.value as FenelType)).toThrow("invalid own-data type boundary");
  });

  it("supported $list: T shorthand preserves the actual element type", () => {
    const normalized = normalizeFenelTypeShorthand({ $list: ENUM_TYPE });
    expect(normalized.value).toEqual(LIST_TYPE);
    expect(normalized.rewrites).toBe(1);
    expect(peelList(normalized.value as FenelType)).toEqual({ elem: ENUM_TYPE });
  });

  it("migration lift preserves sibling meta keys (drops only multiple)", () => {
    // Phase 11 retired the `unit:` key from FieldMetadata; the
    // walker test below uses a synthetic `legacyKey` sibling so the
    // "preserves siblings" semantic is still pinned independently of
    // the retired keys' lifecycle. Real legacy DB rows have any-shape
    // JSONB; the walker treats them as opaque dictionaries.
    const legacyField = {
      name: "tags",
      label: Nothing,
      type: ENUM_TYPE,
      ui: Nothing,
      meta: { multiple: true, legacyKey: "preserved-verbatim" },
    };
    const lifted = liftFieldMultiple(legacyField);
    expect(lifted["type"]).toEqual(LIST_SHORTHAND);
    expect(lifted["meta"]).toEqual({ legacyKey: "preserved-verbatim" });
  });

  it("migration lift is idempotent on already-$list-typed rows", () => {
    // Row whose type already lifted (e.g. migration ran twice, or writer
    // already on new shape but meta key not yet stripped).
    const partiallyMigrated = {
      name: "tags",
      label: Nothing,
      type: LIST_SHORTHAND,
      ui: Nothing,
      meta: { multiple: true },
    };
    const lifted = liftFieldMultiple(partiallyMigrated);
    expect(lifted["type"]).toEqual(LIST_SHORTHAND);
    expect(lifted["meta"]).toBeUndefined();
  });

  it("engine:validateStringMultiCollect is retired from the engine module", () => {
    const spec = engineModule.functions?.find((f) => f.id === "engine:validateStringMultiCollect");
    expect(spec).toBeUndefined();
  });
});
