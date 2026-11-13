// ---------------------------------------------------------------------------
// Phase 11 of canonical-maybe — retire the deprecated `FieldMetadata.unit?:
// UnitExpr` slot.
//
// FieldMetadata becomes structurally `Record<string, never>` — the empty-
// object type. Units have lived on the type itself via `Q : UnitExpr ->
// Type` since field-meta-collapse Phase 3 (migration `0048`, 2026-05-26);
// Phase 5d (2026-05-26) dropped the editor / widget-hint / json-schema /
// entity-def-printer soft-fallback readers. The TS slot was kept around
// pending canonical-maybe; this phase is the structural cleanup.
//
// Closes the inner FieldMetadata arc. Phase 9 (commit `e753913a`) already
// closed the outer FieldDef arc by lifting `FieldDef.meta?: FieldMetadata`
// to `FieldDef.meta: FieldMetadata` with `{}` as the natural absence-marker;
// Phase 11 makes that absence-marker the ONLY admissible shape.
//
// Pins:
//
//   1. FieldMetadata accepts the empty literal `{}` (Phase 9 absence-marker
//      shape preserved).
//   2. fieldMeta(field) returns the canonical `{}` shape (Phase 9 accessor
//      unchanged; reading from any FieldDef now always returns an empty
//      object).
//   3. Phase 8 codec dispatch via `isErasableType({$ref: "FieldMetadata"})`
//      still returns true (the `fieldMetadataUndefinable` preview-instance
//      is independent of inner-shape; flipping FieldMetadata to
//      `Record<string, never>` doesn't alter the registry-lookup contract).
//   4. JSON Schema $record emit of a FieldMetadata-typed slot still excludes
//      it from `required[]` (Phase 8 invariant preserved end-to-end).
//   5. Migration `0066` walker: removes `unit` subkey from any FieldDef-
//      shape meta-object; preserves other subkeys verbatim; idempotent.
//   6. Migration `0066` walker: no-op on FieldDef whose meta-object has no
//      `unit` key (idempotency over already-migrated rows).
//   7. Migration `0066` walker: no-op on non-FieldDef objects (no
//      name+type co-presence, so the meta-walk never fires).
//   8. FieldDef-arc closure: all 6 FieldDef slots typed, meta is mandatory,
//      meta value is the canonical `{}` absence-marker.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelType } from "./types";
import type { FieldMetadata } from "./field-meta";
import { fieldMeta } from "./field-meta";
import { isErasableType } from "./set-algebra";
import { fenelTypeToJsonSchema } from "./json-schema";
import "./system-entities";

// -- TS-side mirror of the PL/pgSQL walker in migration 0066. ---------------

function retireFieldMetadataUnitWalk(j: unknown): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) return j.map((elem) => retireFieldMetadataUnitWalk(elem));
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = retireFieldMetadataUnitWalk(v);
  }
  const hasName = typeof result.name === "string";
  const isFieldDef = hasName && "type" in result;
  if (isFieldDef && "meta" in result) {
    const meta = result.meta;
    if (meta && typeof meta === "object" && !Array.isArray(meta) && "unit" in (meta as Record<string, unknown>)) {
      const { unit: _stripped, ...rest } = meta as Record<string, unknown>;
      void _stripped;
      result.meta = rest;
    }
  }
  return result;
}

describe("Phase 11 — FieldMetadata.unit retired; FieldMetadata is Record<string, never>", () => {
  it("FieldMetadata accepts the empty literal {}", () => {
    const m: FieldMetadata = {};
    expect(m).toEqual({});
    expect(Object.keys(m)).toEqual([]);
  });

  it("fieldMeta(field) returns the canonical {} shape", () => {
    const f: FieldDef = {
      name: "slug",
      type: { $ref: "String" },
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    const got = fieldMeta(f);
    expect(got).toEqual({});
    expect(got).toBe(f.meta);
  });
});

describe("Phase 11 — Phase 8 codec dispatch preserved end-to-end", () => {
  it("isErasableType({$ref: 'FieldMetadata'}) === true (preview-instance dispatch unchanged)", () => {
    // The `fieldMetadataUndefinable` preview-instance keys off the
    // `$ref: "FieldMetadata"` registry lookup. Flipping the inner shape
    // of FieldMetadata from `{ unit?: UnitExpr }` to `Record<string,
    // never>` doesn't change the lookup contract — the registry sees the
    // name, not the inner shape.
    const fieldMetadataType: FenelType = { $ref: "FieldMetadata" };
    expect(isErasableType(fieldMetadataType)).toBe(true);
  });

  it("JSON Schema $record emit: FieldMetadata-typed slot still excluded from required[]", () => {
    // Phase 8 invariant: a $record containing a FieldMetadata-typed field
    // has that field omitted from `required[]` via the
    // `isErasableType(FieldMetadata) === true` dispatch.
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

describe("Phase 11 — migration 0066 walker", () => {
  it("removes `unit` subkey from FieldDef meta-object", () => {
    const raw = {
      name: "duration",
      type: { $ref: "Number" },
      meta: { unit: "ms" },
    };
    const walked = retireFieldMetadataUnitWalk(raw) as { meta: Record<string, unknown> };
    expect(walked.meta).toEqual({});
    expect("unit" in walked.meta).toBe(false);
  });

  it("preserves other subkeys verbatim", () => {
    const raw = {
      name: "duration",
      type: { $ref: "Number" },
      meta: { unit: "ms", legacyKey: "preserved-verbatim", anotherKey: 42 },
    };
    const walked = retireFieldMetadataUnitWalk(raw) as { meta: Record<string, unknown> };
    expect(walked.meta).toEqual({ legacyKey: "preserved-verbatim", anotherKey: 42 });
  });

  it("idempotent: no-op on FieldDef whose meta-object has no `unit` key", () => {
    const raw = {
      name: "slug",
      type: { $ref: "String" },
      meta: {},
    };
    const once = retireFieldMetadataUnitWalk(raw);
    const twice = retireFieldMetadataUnitWalk(once);
    expect(twice).toEqual(once);
    expect(once).toEqual(raw);
  });

  it("no-op on non-FieldDef objects (no name+type co-presence)", () => {
    const typeclassMethod = {
      name: "show",
      params: [],
      returns: { $ref: "String" },
      meta: { unit: "kg" }, // contrived; would never carry meta in practice
    };
    const walked = retireFieldMetadataUnitWalk(typeclassMethod) as Record<string, unknown>;
    // No `type` sibling → walker treats as non-FieldDef → meta untouched.
    expect((walked.meta as Record<string, unknown>).unit).toBe("kg");
  });

  it("recurses into nested FieldDef arrays (record.fields cluster)", () => {
    const raw = {
      $record: {
        fields: [
          { name: "a", type: { $ref: "String" }, meta: { unit: "ms" } },
          { name: "b", type: { $ref: "Number" }, meta: { unit: "kg", other: 1 } },
          { name: "c", type: { $ref: "Boolean" }, meta: {} },
        ],
      },
    };
    const walked = retireFieldMetadataUnitWalk(raw) as {
      $record: { fields: Array<{ meta: Record<string, unknown> }> };
    };
    expect(walked.$record.fields[0]!.meta).toEqual({});
    expect(walked.$record.fields[1]!.meta).toEqual({ other: 1 });
    expect(walked.$record.fields[2]!.meta).toEqual({});
  });
});

describe("Phase 11 — FieldDef-arc closure (post-Phase-9 + Phase-11)", () => {
  // FM-retire-Z — the `default` slot is retired; FieldDef now has 5 slots.
  it("FieldDef has 5 slots; meta is mandatory; meta value is canonical {}", () => {
    const f: FieldDef = {
      name: "x",
      type: { $ref: "String" },
      label: Nothing,
      ui: Nothing,
      meta: {},
    };
    expect(Object.keys(f).sort()).toEqual(
      ["label", "meta", "name", "type", "ui"].sort(),
    );
    expect(f.meta).toEqual({});
  });
});
