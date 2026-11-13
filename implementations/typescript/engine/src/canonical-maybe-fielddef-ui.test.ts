// ---------------------------------------------------------------------------
// Phase 7b of canonical-maybe — `FieldDef.ui?` collapses to canonical
// `Maybe<EditDisplay>` (thin outer lift over Phase 6's canonical-Maybe
// inner EditDisplay).
//
// Pins:
//
//   1. FieldDef accepts canonical Maybe<EditDisplay> on `ui` — both
//      Just(EditDisplay) and Nothing compile.
//   2. The peel-and-cascade idiom reads correctly through Just(...) and
//      Nothing: `peelMaybeValue(field.ui)?.<slot>.$tag` resolves both arms.
//   3. The typed-extract idiom is also supported:
//      `field.ui.$tag === "Just" && field.ui.value.<slot>`.
//   4. The TS-mirror of migration 0057 lifts pre-Phase-7b shapes:
//      absent → Nothing, present-raw → Just(raw), already-lifted → unchanged.
//   5. Walker idempotent — applying twice equals applying once.
//   6. Walker doesn't touch non-FieldDef objects (no name+type co-presence).
//   7. FieldDef sibling slots (`label`, `type`, `meta?`, `default?`)
//      preserved across the walk.
//   8. Existing FieldDef-with-ui shapes (`{name, label, type, ui: {…}}`)
//      round-trip through the walker correctly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import type { FieldDef, EditDisplay } from "./types";

// -- TS-side mirror of the PL/pgSQL walker in migration 0057. -----------------

function liftOneUiSlot(v: unknown): unknown {
  if (v === undefined || v === null) {
    return { $tag: "Nothing" };
  }
  if (typeof v === "object" && v !== null && "$tag" in v) {
    return v;
  }
  return { $tag: "Just", _0: v };
}

function liftFieldUiWalk(j: unknown): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) {
    return j.map((elem) => liftFieldUiWalk(elem));
  }
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftFieldUiWalk(v);
  }
  const hasName = typeof result.name === "string";
  const isFieldDef = hasName && "type" in result;
  if (isFieldDef) {
    result.ui = liftOneUiSlot(result.ui);
  }
  return result;
}

// -- A representative EditDisplay (post-Phase-6 canonical shape). -------------
const sampleEdit: EditDisplay = {
  widget: Just("textarea"),
  placeholder: Just("Type here"),
  helpText: Nothing,
  options: Nothing,
  columns: Nothing,
  refFilter: Nothing,
  prefix: Nothing,
  suffix: Nothing,
  format: Nothing,
};

describe("Phase 7b — FieldDef.ui collapses to Maybe<EditDisplay>", () => {
  it("FieldDef accepts ui: Just(EditDisplay)", () => {
    const f: FieldDef = {
      name: "bio",
      label: Just("Bio"),
      type: { $ref: "String" },
      meta: {},
      ui: Just(sampleEdit),
    };
    expect(f.ui.$tag).toBe("Just");
    if (f.ui.$tag === "Just") {
      expect(f.ui._0.widget.$tag).toBe("Just");
    }
  });

  it("FieldDef accepts ui: Nothing", () => {
    const f: FieldDef = {
      name: "createdAt",
      label: Nothing,
      type: { $ref: "Date" },
      meta: {},
      ui: Nothing,
    };
    expect(f.ui.$tag).toBe("Nothing");
  });

  it("peel-and-cascade reads through Just(ui).widget", () => {
    const f: FieldDef = {
      name: "bio",
      label: Just("Bio"),
      type: { $ref: "String" },
      meta: {},
      ui: Just(sampleEdit),
    };
    const ui = peelMaybeValue(f.ui);
    expect(ui).toBeDefined();
    expect(ui?.widget.$tag).toBe("Just");
    if (ui?.widget.$tag === "Just") {
      expect(ui.widget._0).toBe("textarea");
    }
  });

  it("peel-and-cascade returns null for Nothing — typecheck-safe", () => {
    const f: FieldDef = {
      name: "createdAt",
      label: Nothing,
      type: { $ref: "Date" },
      meta: {},
      ui: Nothing,
    };
    const ui = peelMaybeValue(f.ui);
    expect(ui).toBeNull();
    expect(ui?.widget).toBeUndefined();
  });

  it("typed-extract idiom: field.ui.$tag === 'Just' && field.ui.value.widget", () => {
    const f: FieldDef = {
      name: "bio",
      label: Just("Bio"),
      type: { $ref: "String" },
      meta: {},
      ui: Just(sampleEdit),
    };
    expect(f.ui.$tag === "Just" && f.ui._0.widget.$tag === "Just").toBe(true);
  });
});

describe("Phase 7b — migration 0057 walker", () => {
  it("lifts absent ui to Nothing on FieldDef shapes", () => {
    const input = {
      $record: {
        fields: [
          { name: "slug", label: Just("Slug"), type: { $ref: "String" }, meta: {} },
        ],
      },
    };
    const out = liftFieldUiWalk(input) as typeof input;
    const lifted = (out.$record.fields as unknown as { ui: unknown }[])[0]!;
    expect(lifted.ui).toEqual({ $tag: "Nothing" });
  });

  it("lifts present-raw ui to Just(raw) on FieldDef shapes", () => {
    const input = {
      $record: {
        fields: [
          {
            name: "bio",
            label: Just("Bio"),
            type: { $ref: "String" },
            meta: {},
            ui: sampleEdit,
          },
        ],
      },
    };
    const out = liftFieldUiWalk(input) as typeof input;
    const lifted = (out.$record.fields as unknown as { ui: { $tag: string; _0: unknown } }[])[0]!;
    expect(lifted.ui.$tag).toBe("Just");
    expect(lifted.ui._0).toEqual(sampleEdit);
  });

  it("idempotent — applying twice equals applying once", () => {
    const input = {
      $record: {
        fields: [
          { name: "slug", label: Just("Slug"), type: { $ref: "String" }, meta: {} },
          { name: "bio", label: Just("Bio"), type: { $ref: "String" }, meta: {}, ui: sampleEdit },
        ],
      },
    };
    const once = liftFieldUiWalk(input);
    const twice = liftFieldUiWalk(once);
    expect(twice).toEqual(once);
  });

  it("skips non-FieldDef objects (no name+type co-presence)", () => {
    // SelectOption: {value, label} — no `name`, no `type`.
    const opt = { value: "x", label: "X" };
    expect(liftFieldUiWalk(opt)).toEqual(opt);

    // TypeView: {name, layout} — has `name` but no `type`.
    const view = { name: "MainView", layout: { sections: [] } };
    expect(liftFieldUiWalk(view)).toEqual(view);

    // CaseDef: {name, label, fields} — has `name` but no `type` sibling.
    const caseDef = { name: "Active", label: Just("Active"), fields: [] };
    expect(liftFieldUiWalk(caseDef)).toEqual(caseDef);
  });

  // FM-retire-Z — `default` slot retired; the walker preserves the remaining
  // sibling slots (label, type, meta).
  it("preserves sibling slots (label, type, meta)", () => {
    const input = {
      $record: {
        fields: [
          {
            name: "slug",
            label: Just("Slug"),
            type: { $ref: "String" },
            meta: { transforms: { trim: true } },
          },
        ],
      },
    };
    const out = liftFieldUiWalk(input) as typeof input;
    const lifted = (out.$record.fields as unknown as Array<{
      name: string;
      label: unknown;
      type: unknown;
      meta: unknown;
      ui: unknown;
    }>)[0]!;
    expect(lifted.name).toBe("slug");
    expect(lifted.label).toEqual(Just("Slug"));
    expect(lifted.type).toEqual({ $ref: "String" });
    expect(lifted.meta).toEqual({ transforms: { trim: true } });
    expect(lifted.ui).toEqual({ $tag: "Nothing" });
  });

  it("round-trips post-Phase-7b shapes unchanged (the inner EditDisplay was canonical-Maybe from Phase 6)", () => {
    const post7b = {
      $record: {
        fields: [
          {
            name: "bio",
            label: Just("Bio"),
            type: { $ref: "String" },
            meta: {},
            ui: Just(sampleEdit),
          },
        ],
      },
    };
    expect(liftFieldUiWalk(post7b)).toEqual(post7b);
  });

  it("recurses into nested $record.fields and $variant.cases", () => {
    const input = {
      $variant: {
        cases: [
          { name: "Active", label: Just("Active") },
          {
            name: "Pending",
            label: Just("Pending"),
            fields: [
              { name: "reason", label: Just("Reason"), type: { $ref: "String" }, meta: {} },
            ],
          },
        ],
      },
    };
    const out = liftFieldUiWalk(input) as typeof input;
    // CaseDef untouched (no `type` sibling).
    expect((out.$variant.cases[0] as { ui?: unknown }).ui).toBeUndefined();
    // FieldDef inside CaseDef.fields gets the ui slot lifted.
    const innerField = (out.$variant.cases[1] as unknown as { fields: Array<{ ui: { $tag: string } }> })
      .fields[0]!;
    expect(innerField.ui).toEqual({ $tag: "Nothing" });
  });
});
