// ---------------------------------------------------------------------------
// Phase 8 of canonical-maybe — codec-boundary `Undefinable<T>` wiring.
//
// Lifts the four hardcoded `peelMaybe(field.type)`-as-erasable-predicate
// sites (json-schema emit × 2, set-algebra record-subtype × 2) to dispatch
// through `isErasableType`, the behavioral predicate sister to peelMaybe's
// value-shape recognizer.
//
// Conformance covers:
//   1. Direct + nested + $refined Maybe → erasable.
//   2. Concrete named type with a registered Undefinable instance
//      (FieldMetadata preview-instance from builtin-classes) → erasable.
//   3. Plain atomic / non-Undefinable types → not erasable.
//   4. JSON Schema emit: $record + $variant cases respect isErasableType
//      in the emitted `required[]`.
//   5. Set-algebra: record subtyping uses isErasableType for the
//      "field may be absent in b" rule (regression-equivalent to the
//      previous peelMaybe-only behaviour for the default instance).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { isErasableType, isSubtype } from "./set-algebra";
import { Maybe, Nothing } from "./type-foundation";
import { fenelTypeToJsonSchema } from "./json-schema";
import type { FenelType, FieldDef } from "./types";

// Trigger system-entities init (registers maybeUndefinable + fieldMetadataUndefinable).
import "./system-entities";

function field(name: string, type: FenelType): FieldDef {
  return { name, type, label: Nothing, ui: Nothing, meta: {} };
}

describe("Phase 8 — isErasableType predicate", () => {
  it("Maybe<String> is erasable (via maybeUndefinable)", () => {
    expect(isErasableType(Maybe({ $ref: "String" }))).toBe(true);
  });

  it("String is NOT erasable (no instance)", () => {
    expect(isErasableType({ $ref: "String" })).toBe(false);
  });

  it("Number is NOT erasable", () => {
    expect(isErasableType({ $ref: "Number" })).toBe(false);
  });

  it("Maybe<Maybe<String>> is erasable (outer Maybe peels first)", () => {
    expect(isErasableType(Maybe(Maybe({ $ref: "String" })))).toBe(true);
  });

  it("$refined Maybe<String> is erasable (peelMaybe peels $refined)", () => {
    const refined: FenelType = {
      $refined: { base: Maybe({ $ref: "String" }), set: { $tag: "SeAll" } },
    };
    expect(isErasableType(refined)).toBe(true);
  });

  it("$ref 'FieldMetadata' is erasable (Phase 8 preview-instance)", () => {
    expect(isErasableType({ $ref: "FieldMetadata" })).toBe(true);
  });

  it("$ref 'UnregisteredType' is NOT erasable", () => {
    expect(isErasableType({ $ref: "UnregisteredType" })).toBe(false);
  });
});

describe("Phase 8 — JSON Schema emit honors isErasableType", () => {
  it("$record with Maybe field excludes it from required[]", () => {
    const t: FenelType = {
      $record: {
        fields: [
          field("name", { $ref: "String" }),
          field("nick", Maybe({ $ref: "String" })),
        ],
      },
    };
    const schema = fenelTypeToJsonSchema(t);
    expect(schema.required).toEqual(["name"]);
  });

  it("$record with FieldMetadata-typed field excludes it from required[]", () => {
    const t: FenelType = {
      $record: {
        fields: [
          field("name", { $ref: "String" }),
          field("meta", { $ref: "FieldMetadata" }),
        ],
      },
    };
    const schema = fenelTypeToJsonSchema(t);
    expect(schema.required).toEqual(["name"]);
  });

  it("$record with no erasable fields has required = [...all fields]", () => {
    const t: FenelType = {
      $record: {
        fields: [
          field("a", { $ref: "String" }),
          field("b", { $ref: "Number" }),
        ],
      },
    };
    const schema = fenelTypeToJsonSchema(t);
    expect(schema.required).toEqual(["a", "b"]);
  });

  it("$variant case with Maybe field excludes it from required[]", () => {
    const t: FenelType = {
      $variant: {
        discriminator: "$tag",
        cases: [
          {
            name: "Pair",
            label: Nothing,
            fields: [
              field("left", { $ref: "String" }),
              field("right", Maybe({ $ref: "String" })),
            ],
          },
        ],
      },
    };
    const schema = fenelTypeToJsonSchema(t);
    const oneOf = schema.oneOf;
    expect(Array.isArray(oneOf)).toBe(true);
    const pairSchema = oneOf![0]!;
    expect(pairSchema.required).toEqual(["$tag", "left"]);
  });
});

describe("Phase 8 — set-algebra record subtype honors isErasableType", () => {
  it("b's Maybe slot allows a to omit the field", () => {
    const a: FenelType = {
      $record: { fields: [field("name", { $ref: "String" })] },
    };
    const b: FenelType = {
      $record: {
        fields: [
          field("name", { $ref: "String" }),
          field("nick", Maybe({ $ref: "String" })),
        ],
      },
    };
    expect(isSubtype(a, b)).toBe(true);
  });

  it("a's Maybe slot for a field b requires non-Maybe-typed fails", () => {
    const a: FenelType = {
      $record: {
        fields: [field("name", Maybe({ $ref: "String" }))],
      },
    };
    const b: FenelType = {
      $record: { fields: [field("name", { $ref: "String" })] },
    };
    expect(isSubtype(a, b)).toBe(false);
  });

  it("b's FieldMetadata slot allows a to omit the field (preview-instance)", () => {
    const a: FenelType = {
      $record: { fields: [field("name", { $ref: "String" })] },
    };
    const b: FenelType = {
      $record: {
        fields: [
          field("name", { $ref: "String" }),
          field("meta", { $ref: "FieldMetadata" }),
        ],
      },
    };
    expect(isSubtype(a, b)).toBe(true);
  });

  it("non-erasable mismatch (a missing required b field) still fails", () => {
    const a: FenelType = {
      $record: { fields: [field("name", { $ref: "String" })] },
    };
    const b: FenelType = {
      $record: {
        fields: [
          field("name", { $ref: "String" }),
          field("age", { $ref: "Number" }),
        ],
      },
    };
    expect(isSubtype(a, b)).toBe(false);
  });
});
