// ---------------------------------------------------------------------------
// Phase 6 of canonical-maybe — `EditDisplay.{widget, placeholder, helpText,
// options, columns, refFilter}?` collapse to canonical `Maybe<...>`
// (6-slot FieldRenderer-heavy cluster lift).
//
// Pins:
//
//   1. EditDisplay accepts canonical Maybe<...> shape on all 6 lifted slots
//      and preserves the 3 out-of-scope `?:` slots (`prefix`, `suffix`,
//      `format`).
//   2. The TS-mirror of migration 0055 lifts pre-Phase-6 EditDisplay shapes
//      to canonical Maybe — absent slot → Nothing, present-raw → Just(raw),
//      already-lifted → unchanged.
//   3. The migration walker is idempotent — applying twice equals applying
//      once.
//   4. The walker only descends into `ui:` / `edit:` parents (parent-key
//      detection, not slot-name presence).
//   5. FieldRenderer-style widget dispatch reads Maybe via peelMaybeValue
//      with the falsy-Just guard intact.
//   6. LocaleString-typed reads (placeholder, helpText) cascade through
//      `$tag === "Just"` correctly.
//   7. `options.length > 0` dispatch collapses Nothing and `Just([])` to
//      "no usable options" (the `peelMaybeValue(opts) ?? []` idiom).
//   8. `refFilter: Maybe<Expression>` round-trips through the
//      `defaultFilterFor` / per-field-override resolution chain.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue, type Maybe } from "./type-foundation";
import type { EditDisplay, Expression, SelectOption, LocaleString } from "./types";

// -- TS-side mirror of the PL/pgSQL walker in migration 0055. -----------------

function liftOneEditDisplaySlot(v: unknown): unknown {
  if (v === undefined || v === null) {
    return { $tag: "Nothing" };
  }
  if (typeof v === "object" && v !== null && "$tag" in v) {
    return v;
  }
  return { $tag: "Just", _0: v };
}

const LIFTED_SLOTS = ["widget", "placeholder", "helpText", "options", "columns", "refFilter", "prefix", "suffix", "format"] as const;

function liftEditDisplayWalk(j: unknown, parentKey: string | null): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) {
    return j.map((elem) => liftEditDisplayWalk(elem, null));
  }
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftEditDisplayWalk(v, k);
  }
  const isEditDisplay = (parentKey === "ui" || parentKey === "edit");
  if (!isEditDisplay) return result;
  for (const slot of LIFTED_SLOTS) {
    result[slot] = liftOneEditDisplaySlot(result[slot]);
  }
  return result;
}

const liftEditDisplay = (j: unknown) => liftEditDisplayWalk(j, null);

// -- Tests --------------------------------------------------------------------

describe("Phase 6 canonical-maybe — EditDisplay 6-slot cluster lift", () => {
  it("accepts canonical Maybe<...> on all 6 lifted slots — all-Nothing", () => {
    const ed: EditDisplay = {
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
    expect(ed.widget.$tag).toBe("Nothing");
    expect(ed.placeholder.$tag).toBe("Nothing");
    expect(ed.helpText.$tag).toBe("Nothing");
    expect(ed.options.$tag).toBe("Nothing");
    expect(ed.columns.$tag).toBe("Nothing");
    expect(ed.refFilter.$tag).toBe("Nothing");
  });

  it("accepts canonical Maybe<...> on all 6 lifted slots — mixed", () => {
    const placeholder: LocaleString = { en: "type here" };
    const filter: Expression = { "==": [{ var: "x" }, 1] };
    const ed: EditDisplay = {
      widget: Just("textarea"),
      placeholder: Just(placeholder),
      helpText: Nothing,
      options: Just([{ value: "a", label: "A" }]),
      columns: Just(2),
      refFilter: Just(filter),
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
    expect(peelMaybeValue(ed.widget)).toBe("textarea");
    expect(peelMaybeValue(ed.placeholder)).toEqual(placeholder);
    expect(peelMaybeValue(ed.helpText)).toBeNull();
    expect(peelMaybeValue(ed.options)).toEqual([{ value: "a", label: "A" }]);
    expect(peelMaybeValue(ed.columns)).toBe(2);
    expect(peelMaybeValue(ed.refFilter)).toEqual(filter);
  });

  it("Phase 6.5 lifted the prefix / suffix / format trio to Maybe", () => {
    const ed: EditDisplay = {
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Just({ en: "$" }),
      suffix: Just({ en: "/mo" }),
      format: Just("currency"),
    };
    expect(peelMaybeValue(ed.prefix)).toEqual({ en: "$" });
    expect(peelMaybeValue(ed.suffix)).toEqual({ en: "/mo" });
    expect(peelMaybeValue(ed.format)).toBe("currency");

    const ed2: EditDisplay = {
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
    expect(peelMaybeValue(ed2.prefix)).toBeNull();
    expect(peelMaybeValue(ed2.suffix)).toBeNull();
    expect(peelMaybeValue(ed2.format)).toBeNull();
  });

  it("migration 0055 lifts absent slots to Nothing under `ui:` parent", () => {
    const pre = { ui: { widget: "textarea" } };
    const post = liftEditDisplay(pre);
    expect(post).toEqual({
      ui: {
        widget: { $tag: "Just", _0: "textarea" },
        placeholder: { $tag: "Nothing" },
        helpText: { $tag: "Nothing" },
        options: { $tag: "Nothing" },
        columns: { $tag: "Nothing" },
        refFilter: { $tag: "Nothing" },
        prefix: { $tag: "Nothing" },
        suffix: { $tag: "Nothing" },
        format: { $tag: "Nothing" },
      },
    });
  });

  it("migration 0059 lifts absent slots under `edit:` parent (TypeView shape, trio included)", () => {
    const pre = { display: { edit: { format: "datetime" } } };
    const post = liftEditDisplay(pre);
    expect(post).toEqual({
      display: {
        edit: {
          format: { $tag: "Just", _0: "datetime" },
          widget: { $tag: "Nothing" },
          placeholder: { $tag: "Nothing" },
          helpText: { $tag: "Nothing" },
          options: { $tag: "Nothing" },
          columns: { $tag: "Nothing" },
          refFilter: { $tag: "Nothing" },
          prefix: { $tag: "Nothing" },
          suffix: { $tag: "Nothing" },
        },
      },
    });
  });

  it("migration 0059 lifts the trio (prefix/suffix/format) inside `ui:` carriers", () => {
    const pre = {
      ui: {
        widget: "select",
        prefix: { en: "$" },
        suffix: { en: "%" },
        format: "currency",
      },
    };
    const post = liftEditDisplay(pre) as any;
    expect(post.ui.prefix).toEqual({ $tag: "Just", _0: { en: "$" } });
    expect(post.ui.suffix).toEqual({ $tag: "Just", _0: { en: "%" } });
    expect(post.ui.format).toEqual({ $tag: "Just", _0: "currency" });
    expect(post.ui.widget).toEqual({ $tag: "Just", _0: "select" });
  });

  it("migration 0055 wraps options array under Just", () => {
    const pre = {
      ui: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    };
    const post = liftEditDisplay(pre);
    expect((post as any).ui.options).toEqual({
      $tag: "Just",
      _0: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
  });

  it("migration 0055 is idempotent — second pass = first pass", () => {
    const pre = { ui: { widget: "textarea", placeholder: { en: "type here" } } };
    const once = liftEditDisplay(pre);
    const twice = liftEditDisplay(once);
    expect(twice).toEqual(once);
  });

  it("migration 0055 only descends into `ui` / `edit` carriers (parent-key gating)", () => {
    // A `widget` key NOT under a `ui`/`edit` parent stays raw.
    const pre = { otherField: { widget: "textarea" } };
    const post = liftEditDisplay(pre);
    expect(post).toEqual({ otherField: { widget: "textarea" } }); // unchanged — no parent-key match
  });

  it("migration 0055 recurses into nested `$record.fields[].ui` shapes", () => {
    const pre = {
      $record: {
        fields: [
          { name: "a", ui: { widget: "textarea" } },
          { name: "b", ui: { options: [{ value: "x", label: "X" }] } },
        ],
      },
    };
    const post = liftEditDisplay(pre) as any;
    expect(post.$record.fields[0].ui.widget).toEqual({ $tag: "Just", _0: "textarea" });
    expect(post.$record.fields[0].ui.placeholder.$tag).toBe("Nothing");
    expect(post.$record.fields[1].ui.options).toEqual({
      $tag: "Just",
      _0: [{ value: "x", label: "X" }],
    });
    expect(post.$record.fields[1].ui.widget.$tag).toBe("Nothing");
  });

  it("FieldRenderer-style widget dispatch reads Maybe via peelMaybeValue", () => {
    const dispatch = (ui: EditDisplay | undefined, widget: string): boolean =>
      peelMaybeValue(ui?.widget ?? Nothing) === widget;

    const ed: EditDisplay = {
      widget: Just("textarea"),
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
    expect(dispatch(ed, "textarea")).toBe(true);
    expect(dispatch(ed, "expression")).toBe(false);

    // Nothing-arm falls through (peel returns null, !== "textarea").
    const ed2: EditDisplay = {
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    };
    expect(dispatch(ed2, "textarea")).toBe(false);
  });

  it("placeholder LocaleString reads cascade through $tag === Just", () => {
    const renderPlaceholder = (ui: EditDisplay | undefined): LocaleString | undefined =>
      ui?.placeholder.$tag === "Just" ? ui.placeholder._0 : undefined;

    const ph: LocaleString = { en: "hello", fr: "bonjour" };
    expect(renderPlaceholder({
      widget: Nothing,
      placeholder: Just(ph),
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    })).toEqual(ph);
    expect(renderPlaceholder({
      widget: Nothing,
      placeholder: Nothing,
      helpText: Nothing,
      options: Nothing,
      columns: Nothing,
      refFilter: Nothing,
      prefix: Nothing,
      suffix: Nothing,
      format: Nothing,
    })).toBeUndefined();
  });

  it("options.length > 0 dispatch collapses Nothing and Just([]) to empty", () => {
    const effectiveOptions = (m: Maybe<SelectOption[]>): SelectOption[] => peelMaybeValue(m) ?? [];

    expect(effectiveOptions(Nothing).length).toBe(0);
    expect(effectiveOptions(Just([])).length).toBe(0);
    expect(effectiveOptions(Just([{ value: "a", label: "A" }])).length).toBe(1);

    // Pin the asymmetry: Nothing vs Just([]) are distinguishable for callers
    // that DO care about the explicit-empty signal.
    expect(Nothing.$tag).toBe("Nothing");
    expect((Just([]) as { $tag: string }).$tag).toBe("Just");
  });

  it("refFilter Maybe<Expression> round-trips via the override resolution chain", () => {
    const SELF_EXCLUDE: Expression = {
      "!=": [{ var: "candidate.id" }, { var: "_self.id" }],
    };
    const OVERRIDE: Expression = {
      "==": [{ var: "candidate.status" }, "active"],
    };

    // The FieldRenderer resolves as: ui.refFilter ?? defaultFilterFor(entity) ?? meta.refFilter
    const resolve = (ui: EditDisplay | undefined, defaultFromTypeclass: Expression | undefined): Expression | undefined =>
      peelMaybeValue(ui?.refFilter ?? Nothing) ?? defaultFromTypeclass;

    // Override wins.
    expect(resolve(
      {
        widget: Nothing,
        placeholder: Nothing,
        helpText: Nothing,
        options: Nothing,
        columns: Nothing,
        refFilter: Just(OVERRIDE),
        prefix: Nothing,
        suffix: Nothing,
        format: Nothing,
      },
      SELF_EXCLUDE,
    )).toEqual(OVERRIDE);

    // Nothing → typeclass default surfaces.
    expect(resolve(
      {
        widget: Nothing,
        placeholder: Nothing,
        helpText: Nothing,
        options: Nothing,
        columns: Nothing,
        refFilter: Nothing,
        prefix: Nothing,
        suffix: Nothing,
        format: Nothing,
      },
      SELF_EXCLUDE,
    )).toEqual(SELF_EXCLUDE);

    // No ui, no default → undefined fallthrough.
    expect(resolve(undefined, undefined)).toBeUndefined();
  });

  it("peelMaybeValue distinguishes Nothing from Just(falsy) on every slot type", () => {
    // String: Nothing vs Just("") — both falsy at JS level but distinguishable.
    expect(peelMaybeValue<string>(Nothing)).toBeNull();
    expect(peelMaybeValue<string>(Just(""))).toBe("");

    // Number: Nothing vs Just(0).
    expect(peelMaybeValue<number>(Nothing)).toBeNull();
    expect(peelMaybeValue<number>(Just(0))).toBe(0);

    // Array: Nothing vs Just([]).
    expect(peelMaybeValue<SelectOption[]>(Nothing)).toBeNull();
    expect(peelMaybeValue<SelectOption[]>(Just([]))).toEqual([]);

    // LocaleString: Nothing vs Just({}).
    expect(peelMaybeValue<LocaleString>(Nothing)).toBeNull();
    expect(peelMaybeValue<LocaleString>(Just({} as LocaleString))).toEqual({});
  });
});
