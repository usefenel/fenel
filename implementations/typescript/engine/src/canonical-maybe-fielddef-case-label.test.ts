// ---------------------------------------------------------------------------
// Phase 7a of canonical-maybe — `FieldDef.label?` and `CaseDef.label?`
// collapse to canonical `Maybe<LocaleString>` (lockstep two-type cluster
// opening the FieldDef arc).
//
// Pins:
//
//   1. FieldDef accepts canonical Maybe<LocaleString> on `label` — both
//      Just(LocaleString) and Nothing compile.
//   2. CaseDef accepts canonical Maybe<LocaleString> on `label` (same
//      shape, lockstep with FieldDef).
//   3. The "humanize from name when absent" cascade reads via
//      `peelMaybeValue(field.label) ?? humanizeCodeName(field.name)`.
//   4. The TS-mirror of migration 0056 lifts pre-Phase-7a shapes:
//      absent → Nothing, present-raw → Just(raw), already-lifted → unchanged.
//   5. Walker idempotent — applying twice equals applying once.
//   6. Walker doesn't touch `{value, label}` SelectOption objects
//      (no `name:` sibling — they fail the FieldDef/CaseDef detection).
//   7. FieldDef sibling slots (`ui?`, `meta?`, `default?`, `type`)
//      preserved.
//   8. CaseDef sibling slots (`fields?`) preserved.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import type { FieldDef, CaseDef, FenelType, LocaleString } from "./types";
import { humanizeCodeName } from "./fenel-module";

// -- TS-side mirror of the PL/pgSQL walker in migration 0056. -----------------

function liftOneLabelSlot(v: unknown): unknown {
  if (v === undefined || v === null) {
    return { $tag: "Nothing" };
  }
  if (typeof v === "object" && v !== null && "$tag" in v) {
    return v;
  }
  return { $tag: "Just", _0: v };
}

function liftFieldCaseLabelWalk(j: unknown, parentKey: string | null): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) {
    return j.map((elem) => liftFieldCaseLabelWalk(elem, parentKey));
  }
  if (typeof j !== "object") return j;
  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftFieldCaseLabelWalk(v, k);
  }
  const hasName = typeof result.name === "string";
  const isFieldDef = hasName && "type" in result;
  const isCaseDef =
    hasName &&
    !isFieldDef &&
    ("fields" in result || "label" in result || parentKey === "cases");
  if (isFieldDef || isCaseDef) {
    result.label = liftOneLabelSlot(result.label);
  }
  return result;
}

const liftFieldCaseLabel = (j: unknown) => liftFieldCaseLabelWalk(j, null);

// -- Tests --------------------------------------------------------------------

describe("Phase 7a canonical-maybe — FieldDef.label + CaseDef.label lift", () => {
  it("FieldDef accepts canonical Maybe<LocaleString> on label — Nothing", () => {
    const fd: FieldDef = {
      name: "slug",
      type: { $ref: "String" },
      meta: {},
      ui: Nothing,
      label: Nothing,
    };
    expect(fd.label.$tag).toBe("Nothing");
  });

  it("FieldDef accepts canonical Maybe<LocaleString> on label — Just(string)", () => {
    const fd: FieldDef = {
      name: "slug",
      type: { $ref: "String" },
      meta: {},
      ui: Nothing,
      label: Just("Slug"),
    };
    expect(peelMaybeValue(fd.label)).toBe("Slug");
  });

  it("FieldDef accepts canonical Maybe<LocaleString> on label — Just(locale record)", () => {
    const localized: LocaleString = { en: "Slug", fr: "Identifiant" };
    const fd: FieldDef = {
      name: "slug",
      type: { $ref: "String" },
      meta: {},
      ui: Nothing,
      label: Just(localized),
    };
    const peeled = peelMaybeValue(fd.label);
    expect(peeled).toEqual(localized);
  });

  it("CaseDef accepts canonical Maybe<LocaleString> on label — nullary", () => {
    const cd: CaseDef = { name: "Active", label: Nothing };
    expect(cd.label.$tag).toBe("Nothing");
  });

  it("CaseDef accepts canonical Maybe<LocaleString> on label — with payload", () => {
    const cd: CaseDef = {
      name: "WithPayload",
      label: Just("With Payload"),
      fields: [{ name: "value", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
    };
    expect(peelMaybeValue(cd.label)).toBe("With Payload");
    expect(cd.fields?.[0]?.name).toBe("value");
  });

  it("humanize-from-name cascade reads via peelMaybeValue(label) ?? humanize(name)", () => {
    const fdWithLabel: FieldDef = {
      name: "fullName",
      type: { $ref: "String" },
      meta: {},
      ui: Nothing,
      label: Just("Full Name"),
    };
    const fdWithoutLabel: FieldDef = {
      name: "fullName",
      type: { $ref: "String" },
      meta: {},
      ui: Nothing,
      label: Nothing,
    };
    const labelOf = (f: FieldDef): string => {
      const peeled = peelMaybeValue(f.label);
      return typeof peeled === "string" ? peeled : humanizeCodeName(f.name);
    };
    expect(labelOf(fdWithLabel)).toBe("Full Name");
    expect(labelOf(fdWithoutLabel)).toBe("Full Name");
  });

  it("migration 0056 walker lifts absent FieldDef.label to Nothing", () => {
    const pre = { $record: { fields: [{ name: "slug", type: { $ref: "String" }, meta: {}, ui: Nothing }] } };
    const post = liftFieldCaseLabel(pre) as {
      $record: { fields: Array<{ name: string; label: { $tag: string }; type: FenelType }> };
    };
    expect(post.$record.fields[0]?.label).toEqual({ $tag: "Nothing" });
  });

  it("migration 0056 walker lifts present FieldDef.label to Just(raw)", () => {
    const pre = {
      $record: {
        fields: [{ name: "slug", label: "Slug", type: { $ref: "String" }, meta: {}, ui: Nothing }],
      },
    };
    const post = liftFieldCaseLabel(pre) as {
      $record: { fields: Array<{ name: string; label: { $tag: string; value?: unknown } }> };
    };
    expect(post.$record.fields[0]?.label).toEqual({ $tag: "Just", _0: "Slug" });
  });

  it("migration 0056 walker lifts CaseDef.label inside $variant cases", () => {
    const pre = {
      $variant: {
        cases: [{ name: "Active" }, { name: "Pending", label: "Pending" }],
      },
    };
    const post = liftFieldCaseLabel(pre) as {
      $variant: { cases: Array<{ name: string; label: { $tag: string; value?: unknown } }> };
    };
    expect(post.$variant.cases[0]?.label).toEqual({ $tag: "Nothing" });
    expect(post.$variant.cases[1]?.label).toEqual({ $tag: "Just", _0: "Pending" });
  });

  it("migration 0056 is idempotent", () => {
    const pre = {
      $record: {
        fields: [
          { name: "a", label: "A", type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "b", type: { $ref: "Number" }, meta: {}, ui: Nothing },
        ],
      },
    };
    const once = liftFieldCaseLabel(pre);
    const twice = liftFieldCaseLabel(once);
    expect(twice).toEqual(once);
  });

  it("walker does NOT touch SelectOption-shaped {value, label} objects", () => {
    // SelectOption arrays live under EditDisplay.options.value, not
    // under `cases`. The walker's `name`-co-presence rule skips them.
    const pre = {
      $record: {
        fields: [
          {
            name: "status",
            type: { $ref: "String" },
            meta: {},
            ui: Just({
              options: { $tag: "Just", _0: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
              prefix: Nothing,
              suffix: Nothing,
              format: Nothing,
            }),
          },
        ],
      },
    };
    const post = liftFieldCaseLabel(pre) as {
      $record: { fields: Array<{ ui: { $tag: string; _0: { options: { $tag: string; _0: Array<{ value: string; label: string }> } } } }> };
    };
    const options = post.$record.fields[0]?.ui._0.options._0;
    expect(options).toEqual([
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
  });

  // FM-retire-Z — `default` slot retired; the walker preserves the remaining
  // sibling slots (ui, meta).
  it("walker preserves FieldDef sibling slots (ui, meta)", () => {
    const pre = {
      $record: {
        fields: [
          {
            name: "x",
            label: "X",
            type: { $ref: "String" },
            ui: Just({ widget: { $tag: "Just", _0: "textarea" }, prefix: Nothing, suffix: Nothing, format: Nothing }),
            meta: {},
          },
        ],
      },
    };
    const post = liftFieldCaseLabel(pre) as {
      $record: { fields: Array<{ label: unknown; ui: unknown }> };
    };
    expect(post.$record.fields[0]?.label).toEqual({ $tag: "Just", _0: "X" });
    expect(post.$record.fields[0]?.ui).toEqual({ $tag: "Just", _0: { widget: { $tag: "Just", _0: "textarea" }, prefix: Nothing, suffix: Nothing, format: Nothing } });
  });

  it("walker preserves CaseDef.fields and recurses into them", () => {
    const pre = {
      $variant: {
        cases: [
          {
            name: "WithPayload",
            fields: [{ name: "value", type: { $ref: "String" }, meta: {}, ui: Nothing }],
          },
        ],
      },
    };
    const post = liftFieldCaseLabel(pre) as {
      $variant: {
        cases: Array<{
          name: string;
          label: { $tag: string };
          fields: Array<{ name: string; label: { $tag: string }; type: FenelType }>;
        }>;
      };
    };
    expect(post.$variant.cases[0]?.label).toEqual({ $tag: "Nothing" });
    expect(post.$variant.cases[0]?.fields[0]?.label).toEqual({ $tag: "Nothing" });
  });

  it("walker does NOT lift TypeParam-shaped { name } objects (no type, no fields, not in cases array)", () => {
    // Heuristic test: bare { name: "a" } outside `cases:` and without
    // `type:` shouldn't get a label. This mirrors how Interface.params
    // (e.g. `params: [{ name: "a" }]`) avoid false-positives.
    const pre = { name: "MyClass", params: [{ name: "a" }, { name: "b" }] };
    const post = liftFieldCaseLabel(pre) as {
      params: Array<{ name: string; label?: unknown }>;
    };
    expect(post.params[0]).toEqual({ name: "a" });
    expect(post.params[1]).toEqual({ name: "b" });
  });

  it("walker lifts nullary CaseDef inside cases: [] (variant context)", () => {
    const pre = { $variant: { cases: [{ name: "A" }, { name: "B" }] } };
    const post = liftFieldCaseLabel(pre) as {
      $variant: { cases: Array<{ name: string; label: { $tag: string } }> };
    };
    expect(post.$variant.cases[0]?.label).toEqual({ $tag: "Nothing" });
    expect(post.$variant.cases[1]?.label).toEqual({ $tag: "Nothing" });
  });
});
