// ---------------------------------------------------------------------------
// Phase 5b of field-meta-collapse — `meta.refFilter` → `ui.refFilter`
// channel-rename conformance.
//
// Pre-retirement: `FieldMetadata.refFilter?: Expression` was the home for a
// per-field UX hint (JSON-Logic Expression evaluated against
// `{_self, candidate}` to narrow the entity picker's candidate set).
//
// Post-retirement (this commit): the key is deleted from `FieldMetadata` and
// added to `EditDisplay` (the existing `FieldDef.ui` channel — the right home
// for per-field UX hints next to `widget` / `options` / `helpText`). Production
// writers flipped + reader flipped + migration `0051` lifts persisted rows.
// The FieldRenderer reader carries a soft-fallback to `(meta as any).refFilter`
// for the migration window.
//
// These tests pin four invariants:
//
//   1. A FieldDef written with `ui.refFilter` (the new shape) round-trips
//      through JSON serialization preserving the slot.
//   2. A FieldDef written with the legacy `meta.refFilter` (a row not yet
//      swept by 0051) can still be read — the soft-fallback in
//      FieldRenderer covers this; the test pins the structural invariant
//      that the same Expression value is reachable from either slot
//      via a uniform reader helper.
//   3. The migration lift rule (TS mirror of the PL/pgSQL walker) moves
//      `meta.refFilter` to `ui.refFilter`, drops the key from `meta`
//      (and drops `meta` entirely if now empty), and preserves any
//      pre-existing `ui` siblings (e.g. `ui.widget`).
//   4. The lift rule preserves an existing `ui.refFilter` on collision
//      (the user's newer-shaped intent wins over the incoming legacy
//      value).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FieldDef, Expression, EditDisplay } from "./types";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";

const REF_FILTER_EXPR: Expression = {
  "!=": [{ "var": "candidate.id" }, { "var": "_self.id" }],
};

/** TS mirror of the PL/pgSQL walker in migration 0051. Operates on a
 *  single FieldDef-shaped object; the recursive sweep over JSONB
 *  documents is the migration's job, not the test's. */
function liftFieldRefFilter(field: Record<string, unknown>): Record<string, unknown> {
  const meta = field["meta"];
  if (!meta || typeof meta !== "object" || !("refFilter" in (meta as object))) {
    return field;
  }
  const metaObj = meta as Record<string, unknown>;
  const refFilter = metaObj["refFilter"];

  const ui = field["ui"];
  let newUi: Record<string, unknown>;
  if (ui && typeof ui === "object") {
    const uiObj = ui as Record<string, unknown>;
    // Existing ui.refFilter wins on collision.
    newUi = "refFilter" in uiObj
      ? { ...uiObj }
      : { ...uiObj, refFilter };
  } else {
    newUi = { refFilter };
  }

  const { refFilter: _stripped, ...restMeta } = metaObj;
  void _stripped;

  const result: Record<string, unknown> = { ...field, ui: newUi };
  if (Object.keys(restMeta).length === 0) {
    delete result["meta"];
  } else {
    result["meta"] = restMeta;
  }
  return result;
}

describe("Phase 5b — meta.refFilter → ui.refFilter channel-rename", () => {
  it("round-trips a FieldDef with ui.refFilter through JSON", () => {
    const field: FieldDef = {
      name: "profileBId",
      label: Nothing,
      type: {
        $tagged: {
          value: { $ref: "Id" },
          phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["profile"] } } },
        },
      },
      meta: {},
      ui: Just({
        widget: Nothing,
        placeholder: Nothing,
        helpText: Nothing,
        options: Nothing,
        columns: Nothing,
        refFilter: Just(REF_FILTER_EXPR),
        prefix: Nothing,
        suffix: Nothing,
        format: Nothing,
      }),
    };

    const round: FieldDef = JSON.parse(JSON.stringify(field));
    expect(peelMaybeValue(round.ui)?.refFilter).toEqual(Just(REF_FILTER_EXPR));
    expect((round as { meta?: { refFilter?: Expression } }).meta?.refFilter).toBeUndefined();
  });

  it("reads the same Expression from either slot via the soft-fallback shape", () => {
    // The FieldRenderer reader reads:
    //   peelMaybeValue(props.ui?.refFilter) ?? (props.meta as any).refFilter
    // This test pins the symmetric reachability of the value regardless of slot.
    const newShape = {
      name: "profileBId",
      ui: {
        widget: Nothing,
        placeholder: Nothing,
        helpText: Nothing,
        options: Nothing,
        columns: Nothing,
        refFilter: Just(REF_FILTER_EXPR),
        prefix: Nothing,
        suffix: Nothing,
        format: Nothing,
      } as EditDisplay,
    };
    const legacyShape = {
      name: "profileBId",
      meta: { refFilter: REF_FILTER_EXPR },
    } as unknown as FieldDef;

    const readFrom = (f: { ui?: EditDisplay; meta?: Record<string, unknown> }): Expression | undefined => {
      if (f.ui?.refFilter.$tag === "Just") return f.ui.refFilter._0;
      return (f.meta as { refFilter?: Expression } | undefined)?.refFilter;
    };

    expect(readFrom(newShape as { ui?: EditDisplay; meta?: Record<string, unknown> })).toEqual(REF_FILTER_EXPR);
    expect(readFrom(legacyShape as unknown as { ui?: EditDisplay; meta?: Record<string, unknown> })).toEqual(REF_FILTER_EXPR);
  });

  it("migration lift moves meta.refFilter → ui.refFilter, drops meta, preserves ui siblings", () => {
    const legacyField = {
      name: "profileBId",
      label: Nothing,
      type: {
        $tagged: {
          value: { $ref: "Id" },
          phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["profile"] } } },
        },
      },
      meta: { refFilter: REF_FILTER_EXPR },
      ui: { widget: "ref-picker" },
    };

    const lifted = liftFieldRefFilter(legacyField);
    expect(lifted["meta"]).toBeUndefined(); // meta key dropped — was only refFilter
    expect(lifted["ui"]).toEqual({ widget: "ref-picker", refFilter: REF_FILTER_EXPR });
  });

  it("migration lift preserves an existing ui.refFilter on collision", () => {
    const otherFilter: Expression = { "==": [{ var: "candidate.status" }, "active"] };
    const legacyField = {
      name: "profileBId",
      meta: { refFilter: REF_FILTER_EXPR, multiple: true },
      ui: { refFilter: otherFilter },
    };

    const lifted = liftFieldRefFilter(legacyField);
    // ui.refFilter unchanged — newer-shaped intent wins.
    expect((lifted["ui"] as { refFilter: Expression }).refFilter).toEqual(otherFilter);
    // meta retains the `multiple` key (only refFilter stripped).
    expect(lifted["meta"]).toEqual({ multiple: true });
  });
});
