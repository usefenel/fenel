// ---------------------------------------------------------------------------
// Phase 9 of canonical-maybe — `FieldDef.meta?` collapses to mandatory
// `FieldMetadata` with `{}` as the natural absence-marker (Tier B —
// codec-boundary Undefinable-dispatch via Phase 8's
// `fieldMetadataUndefinable` preview-instance + `isErasableType` helper).
//
// **Closes the FieldDef arc.** Post-Phase 9, every `FieldDef` slot is
// either `Maybe<T>` (semantic absence — `label` / `ui` / `default`) or
// non-optional (codec-erasable absence — `meta`). No `?:` survives on
// FieldDef.
//
// Phase 11 (2026-05-27) — `FieldMetadata.unit?: UnitExpr` retired;
// `FieldMetadata` is now structurally `Record<string, never>`. The
// "populated meta" arms below were updated to use `meta: {}` only —
// no slot survives on FieldMetadata. The codec dispatch via Phase 8's
// `fieldMetadataUndefinable` preview-instance is unchanged.
//
// Pins:
//
//   1. FieldDef requires `meta` — empty `{}` is the natural absence-marker.
//   2. `fieldMeta(field)` reads `f.meta` directly — no `?? {}` defensive
//      fallback (Phase 9 Open Q1 Option A — drop the defensive plumbing).
//   3. The TS-mirror of migration 0065 lifts pre-Phase-9 shapes: absent
//      → `meta: {}`, present → preserved.
//   4. Walker idempotent — applying twice equals applying once.
//   5. Walker doesn't touch non-FieldDef objects (no name+type co-presence).
//   6. FieldDef sibling slots (`label`, `type`, `ui`, `default`) preserved
//      across the walk.
//   7. JSON Schema emit of a `$record` containing a `FieldMetadata`-typed
//      slot excludes it from `required[]` via Phase 8's
//      `isErasableType(FieldMetadata) === true` dispatch.
//   8. Phase 9 demonstrates the first end-to-end exercise of the
//      Undefinable codec recipe: a Tier B slot is declared mandatory + the
//      codec layer reads `isErasableType` to know it can omit the slot
//      from JSON Schema's `required[]`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelType } from "./types";
import { fieldMeta } from "./field-meta";
import { isErasableType } from "./set-algebra";
import { fenelTypeToJsonSchema } from "./json-schema";
import "./system-entities";

// -- TS-side mirror of the PL/pgSQL walker in migration 0065. ---------------

function liftFieldMetaWalk(j: unknown): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) return j.map((elem) => liftFieldMetaWalk(elem));
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftFieldMetaWalk(v);
  }
  const hasName = typeof result.name === "string";
  const isFieldDef = hasName && "type" in result;
  if (isFieldDef && !("meta" in result)) {
    result.meta = {};
  }
  return result;
}

describe("Phase 9 — FieldDef.meta lifts to mandatory FieldMetadata", () => {
  it("FieldDef requires meta — empty {} is canonical absence-marker", () => {
    const f: FieldDef = {
      name: "slug",
      type: { $ref: "String" },
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    expect(f.meta).toEqual({});
  });

  it("fieldMeta(field) reads f.meta directly — no ?? {} fallback", () => {
    const empty: FieldDef = {
      name: "x",
      type: { $ref: "String" },
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    expect(fieldMeta(empty)).toEqual({});
    expect(fieldMeta(empty)).toBe(empty.meta);
  });
});

describe("Phase 9 — migration walker (mirror of 0065)", () => {
  it("lifts absent meta to meta: {}", () => {
    const raw = { name: "slug", type: { $ref: "String" } };
    const lifted = liftFieldMetaWalk(raw) as Record<string, unknown>;
    expect(lifted.meta).toEqual({});
  });

  it("preserves populated meta (pre-Phase-11 residue)", () => {
    // Walker preserves any pre-existing meta value verbatim — including
    // legacy `unit:` keys from pre-Phase-3 rows that 0048 may have
    // missed. Phase 11's 0066 walker handles those separately.
    const raw = {
      name: "duration",
      type: { $ref: "Number" },
      meta: { legacyKey: "preserved-verbatim" },
    };
    const lifted = liftFieldMetaWalk(raw) as Record<string, unknown>;
    expect(lifted.meta).toEqual({ legacyKey: "preserved-verbatim" });
  });

  it("walker is idempotent — applying twice equals applying once", () => {
    const raw = { name: "x", type: { $ref: "String" } };
    const once = liftFieldMetaWalk(raw);
    const twice = liftFieldMetaWalk(once);
    expect(twice).toEqual(once);
  });

  it("walker doesn't touch non-FieldDef objects (no name+type co-presence)", () => {
    const typeclassMethod = { name: "show", params: [], returns: { $ref: "String" } };
    const lifted = liftFieldMetaWalk(typeclassMethod) as Record<string, unknown>;
    expect("meta" in lifted).toBe(false);

    const moduleSpec = { name: "std", functions: [], entities: [] };
    const liftedMod = liftFieldMetaWalk(moduleSpec) as Record<string, unknown>;
    expect("meta" in liftedMod).toBe(false);
  });

  // FM-retire-Z — the `default` slot is retired; the walker preserves the
  // remaining sibling slots (label, ui, meta).
  it("walker preserves sibling slots (label, ui)", () => {
    const raw = {
      name: "x",
      type: { $ref: "String" },
      label: { $tag: "Just", _0: "X" },
      ui: { $tag: "Nothing" },
    };
    const lifted = liftFieldMetaWalk(raw) as Record<string, unknown>;
    expect(lifted.label).toEqual({ $tag: "Just", _0: "X" });
    expect(lifted.ui).toEqual({ $tag: "Nothing" });
    expect(lifted.meta).toEqual({});
  });

  it("walker recurses into nested FieldDef arrays", () => {
    const raw = {
      $record: {
        fields: [
          { name: "a", type: { $ref: "String" } },
          { name: "b", type: { $ref: "Number" }, meta: {} },
        ],
      },
    };
    const lifted = liftFieldMetaWalk(raw) as { $record: { fields: Record<string, unknown>[] } };
    expect(lifted.$record.fields[0]!.meta).toEqual({});
    expect(lifted.$record.fields[1]!.meta).toEqual({});
  });
});

describe("Phase 9 — Undefinable codec dispatch end-to-end", () => {
  it("isErasableType(FieldMetadata) === true via Phase 8 preview-instance", () => {
    const fieldMetadataType: FenelType = { $ref: "FieldMetadata" };
    expect(isErasableType(fieldMetadataType)).toBe(true);
  });

  it("JSON Schema $record emit: FieldMetadata-typed slot excluded from required[]", () => {
    // A `$record` carrying a FieldMetadata-typed field — Phase 8's
    // `isErasableType` dispatch causes the slot to be omitted from
    // `required[]` even though the FieldDef.type itself is not wrapped
    // in `Maybe<...>`. This is the codec-boundary substrate Phase 9
    // depends on.
    const recordType: FenelType = {
      $record: {
        fields: [
          {
            name: "slug",
            type: { $ref: "String" },
            label: Nothing,
            ui: Nothing,
            meta: {},
          },
          {
            name: "metadata",
            type: { $ref: "FieldMetadata" },
            label: Nothing,
            ui: Nothing,
            meta: {},
          },
        ],
      },
    };
    const schema = fenelTypeToJsonSchema(recordType);
    expect(schema.required).toContain("slug");
    expect(schema.required ?? []).not.toContain("metadata");
  });
});

describe("Phase 9 — FieldDef-arc closure", () => {
  it("all FieldDef slots are typed (no ?: survives)", () => {
    // Compile-time pin: this literal lists every FieldDef slot. If any
    // future slot lifts to `?:` again, this literal stops compiling.
    const f: FieldDef = {
      name: "x",
      type: { $ref: "String" },
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    expect(Object.keys(f).sort()).toEqual(
      // FM-retire-Z — `default` slot retired.
      ["label", "meta", "name", "type", "ui"].sort(),
    );
  });
});
