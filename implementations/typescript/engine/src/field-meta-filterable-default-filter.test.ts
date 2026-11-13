// ---------------------------------------------------------------------------
// Phase 5b.2 of field-meta-collapse — `Filterable<X>.defaultFilter`
// typeclass instance for per-entity ref-picker filters.
//
// Pre-5b.2: two production writers expressed the same
// `{ "!=": [{ var: "candidate.id" }, { var: "_self.id" }] }` Expression
// inline as `ui.refFilter` on entity-ref FieldDefs that were self-referential
// (`profileRelationshipForm.profileBId`, `Group<X>.parentId`). The default
// belonged at the entity-type level, not per-field — every `profile` field
// referencing `profile` should exclude self by default.
//
// Post-5b.2: the default lives on the `Filterable` typeclass keyed on the
// candidate entity's name. `defaultFilterFor(entityName, registry)` resolves
// the per-entity `Filterable<X>.defaultFilter` Expression. The
// FieldRenderer's resolution precedence:
//
//   props.ui?.refFilter                                       (override; wins)
//   ?? defaultFilterFor(phantomEntityName(type), registry)    (per-entity)
//   ?? (meta as { refFilter? }).refFilter                     (legacy fallback)
//
// These tests pin the typeclass + helper invariants:
//
//   1. `Filterable<profile>.defaultFilter` resolves to the canonical
//      self-exclude Expression via `defaultFilterFor`.
//   2. Entities without a Filterable instance resolve to `undefined`
//      (callers fall through).
//   3. The `profileRelationshipForm.profileBId` field carries no inline
//      `ui.refFilter` after 5b.2 — the typeclass instance is the sole
//      source of the default filter.
//   4. Field-level `ui.refFilter` wins on collision (the precedence
//      mirror of the FieldRenderer chain).
//   5. The `filterableClass` typeclass declaration is registered alongside
//      its `profileFilterable` instance and surfaces from `listInstances`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { dispatchRegistry } from "./system-entities";
import { defaultFilterFor } from "./field-meta";
import { profileRelationshipForm } from "./admin-forms/profiles";
import type { Expression, FieldDef } from "./types";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";

// typed-function-references Phase 10c — `profileFilterable` moved off the
// `builtin-classes.ts` TS const to `.fenel` (fenel/std/dispatch-instances.fenel).
// The `.fenel` `candidate.id != _self.id` parses to the canonical call-form
// `{call:["neq",…]}`, not the legacy operator-form `{"!=":[…]}` the const stored.
// Both evaluate identically via `defaultFilterFor` → the FieldRenderer eval.
const SELF_EXCLUDE_FILTER: Expression = {
  call: ["neq", { var: "candidate.id" }, { var: "_self.id" }],
} as unknown as Expression;

describe("Phase 5b.2 — Filterable<X>.defaultFilter typeclass", () => {
  it("resolves the canonical self-exclude filter for `profile`", () => {
    const filter = defaultFilterFor("profile", dispatchRegistry);
    expect(filter).toEqual(SELF_EXCLUDE_FILTER);
  });

  it("returns undefined for entities without a Filterable instance", () => {
    // `country` has no Filterable instance registered — the helper falls
    // through so the caller's legacy `meta.refFilter` fallback can fire.
    const filter = defaultFilterFor("country", dispatchRegistry);
    expect(filter).toBeUndefined();
    // Defensive: nullish inputs short-circuit.
    expect(defaultFilterFor(null, dispatchRegistry)).toBeUndefined();
    expect(defaultFilterFor(undefined, dispatchRegistry)).toBeUndefined();
    // Without a registry, no resolution is possible.
    expect(defaultFilterFor("profile", undefined)).toBeUndefined();
  });

  it("profileRelationshipForm.profileBId carries no inline ui.refFilter post-5b.2", () => {
    const fields = (
      profileRelationshipForm.type as { $record: { fields: FieldDef[] } }
    ).$record.fields;
    const profileB = fields.find((f) => f.name === "profileBId");
    expect(profileB).toBeDefined();
    // The field-level override slot is empty — the typeclass default
    // provides the filter via `defaultFilterFor("profile", …)`.
    // Post canonical-maybe Phase 6: ui.refFilter is Maybe<Expression> —
    // absence shows as Nothing (or as `ui` itself being undefined on this field).
    expect(peelMaybeValue(profileB?.ui)?.refFilter ?? Nothing).toEqual(Nothing);
    // Verify the same Expression is reachable via the typeclass path.
    expect(defaultFilterFor("profile", dispatchRegistry)).toEqual(
      SELF_EXCLUDE_FILTER,
    );
  });

  it("field-level ui.refFilter wins on collision (precedence mirror)", () => {
    // The FieldRenderer chain is `ui.refFilter ?? defaultFilterFor(…) ?? meta.refFilter`.
    // This test pins the precedence contract via the symmetric reader shape.
    const otherFilter: Expression = {
      "==": [{ var: "candidate.status" }, "active"],
    };
    const fieldWithOverride: FieldDef = {
      name: "profileBId",
      label: Nothing,
      type: {
        $tagged: {
          value: { $ref: "Id" },
          phantom: {
            $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["profile"] } },
          },
        },
      },
      meta: {},
      ui: Just({
        widget: Nothing,
        placeholder: Nothing,
        helpText: Nothing,
        options: Nothing,
        columns: Nothing,
        refFilter: Just(otherFilter),
        prefix: Nothing,
        suffix: Nothing,
        format: Nothing,
      }),
    };

    const resolved =
      peelMaybeValue(peelMaybeValue(fieldWithOverride.ui)?.refFilter ?? Nothing)
      ?? defaultFilterFor("profile", dispatchRegistry);
    expect(resolved).toEqual(otherFilter);
    // The typeclass default still resolves underneath — the field-level
    // value is only winning the precedence battle, not erasing the default.
    expect(defaultFilterFor("profile", dispatchRegistry)).toEqual(
      SELF_EXCLUDE_FILTER,
    );
  });

  it("filterableClass + profileFilterable register in the typeclass registry", () => {
    const cls = dispatchRegistry.getClass("Filterable");
    expect(cls).toBeDefined();
    expect(cls?.name).toBe("Filterable");
    expect(cls?.methods.map((m) => m.name)).toContain("defaultFilter");

    const instances = dispatchRegistry.listInstances("Filterable");
    const profileInst = instances.find((i) => i.args[0] === "profile");
    expect(profileInst).toBeDefined();
    expect(profileInst?.methods["defaultFilter"]).toEqual(SELF_EXCLUDE_FILTER);
  });
});
