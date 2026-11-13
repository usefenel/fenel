// module-migrate-system-entities.test.ts — the FM-retire-E1 Step 2 generate-then-
// lock oracle (mirrors module-migrate-std / dashboard / notion).
//
// Step 2 deletes the hand-written `defineSystemEntity({…})` for 55 system
// entities (Class S facets-only + Class F facets+fieldLabels + the extracted
// refined-String / enum atoms) and replaces them with `@label`/`@description`/
// `@icon`/`@fieldLabel`(+`@codeName`) directives on each `.fenel` `type_def`,
// which `loadFenelModule` lifts into identity-facet ClassInstances that the
// auto-register loop in `system-entities.ts` pushes into the live registry.
//
// The oracle began as the pre-flip lock. Field-identity Phase 2b intentionally
// refreshed its raw-definition half: inline field presentation is gone and
// parser-origin positional keys are explicit. UUID facets are asserted through
// the identified registry below, not folded back into this raw-shape oracle.
//
// Regenerate the oracle (`bun engine/scripts/gen-system-entities-oracle.ts`) +
// commit it only when a batch entity's shape/facets legitimately change.

import { describe, test, expect } from "bun:test";
import { captureEntity, captureStep3, captureStep5, captureStep6, captureStep7, STEP2_BATCH_IDS, STEP3_BATCH_IDS, STEP5_BATCH_IDS, STEP6_BATCH_IDS, STEP7_BATCH_IDS } from "../scripts/gen-system-entities-oracle";
import { systemEntities, dispatchRegistry } from "./system-entities";
import { getSystemRegistry } from "./system-registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import type { FenelType } from "./types";
import oracle from "./module-migrate-system-entities.oracle.json";
import { GLOBAL_ONLY } from "./dispatch-registry";

const ORACLE = (oracle as { entities: Record<string, unknown> }).entities;
const ORACLE3 = (oracle as { step3: Record<string, unknown> }).step3;
const ORACLE5 = (oracle as { step5: Record<string, unknown> }).step5;
const ORACLE6 = (oracle as { step6: Record<string, unknown> }).step6;
const ORACLE7 = (oracle as { step7: Record<string, unknown> }).step7;

describe("FM-retire-E1 Step 2 — system-entities .fenel port (generate-then-lock)", () => {
  // forms-collapse Phase 4 Stage 3 — FormScope removed (the `form` entity's scope
  // enum retired): 55 → 54.
  test("the batch covers 54 entities (no silent drop / add)", () => {
    expect(STEP2_BATCH_IDS.length).toBe(54);
    expect(Object.keys(ORACLE).length).toBe(54);
    expect(new Set(STEP2_BATCH_IDS).size).toBe(54); // no dup ids
  });

  test("every flipped entity's shape + facets match the pre-flip oracle (now loader-sourced)", () => {
    for (const id of STEP2_BATCH_IDS) {
      expect(captureEntity(id)).toEqual(ORACLE[id] as Record<string, unknown>);
    }
  });

  test("each batch entity is registered in systemEntities (auto-register loop ran)", () => {
    for (const id of STEP2_BATCH_IDS) {
      expect(systemEntities.find((e) => e.id === id)).toBeDefined();
    }
  });

  test("facets resolve from the registry — Codeable + Labelable present per entity", () => {
    const codeables = dispatchRegistry.listInstances("Codeable");
    const labelables = dispatchRegistry.listInstances("Labelable");
    for (const id of STEP2_BATCH_IDS) {
      expect(codeables.some((i) => i.args[0] === id)).toBe(true);
      expect(labelables.some((i) => i.args[0] === id)).toBe(true);
    }
  });

  test("NO duplicate identity instances — each batch entity has exactly one Codeable / Labelable", () => {
    const codeables = dispatchRegistry.listInstances("Codeable");
    const labelables = dispatchRegistry.listInstances("Labelable");
    for (const id of STEP2_BATCH_IDS) {
      expect(codeables.filter((i) => i.args[0] === id).length).toBe(1);
      expect(labelables.filter((i) => i.args[0] === id).length).toBe(1);
    }
  });

  test("the still-deferred inline-TS entities are NOT in any batch", () => {
    // `plan` / `function` moved to Step 5. `account` / `integration` /
    // `entity_definition` + the 4 PascalCase records moved to Step 6 (NEW
    // `.fenel` authoring). What REMAINS deferred: GeoLevel/GeoPath (Place
    // dependent-type substrate), the ~25 *_params, Class P, atoms, forms.
    const deferred = ["GeoLevel", "GeoPath"];
    for (const d of deferred) expect(STEP2_BATCH_IDS).not.toContain(d);
    for (const d of deferred) expect(STEP3_BATCH_IDS).not.toContain(d);
    for (const d of deferred) expect(STEP5_BATCH_IDS).not.toContain(d);
    for (const d of deferred) expect(STEP6_BATCH_IDS).not.toContain(d);
    // …yet they're still registered (their `defineSystemEntity` survives).
    for (const d of deferred) expect(systemEntities.find((e) => e.id === d)).toBeDefined();
  });
});

describe("FM-retire-E1 Step 6 — inline-TS domain-record authoring port (generate-then-lock)", () => {
  test("the batch covers 7 entities (no silent drop / add)", () => {
    expect(STEP6_BATCH_IDS.length).toBe(7);
    expect(Object.keys(ORACLE6).length).toBe(7);
    expect(new Set(STEP6_BATCH_IDS)).toEqual(
      new Set(["account", "integration", "entity_definition",
        "ButtonPayload", "PlanGrant", "PlanStep", "ProfileHandleInput"]),
    );
  });

  test("each flipped entity is auto-registered (its defineSystemEntity is gone)", () => {
    for (const id of STEP6_BATCH_IDS) {
      expect(systemEntities.find((e) => e.id === id)).toBeDefined();
    }
  });

  test("shape + facets match the pre-flip oracle (now .fenel-loader-sourced)", () => {
    // The oracle was captured PRE-flip (the inline `defineSystemEntity` still
    // the source — the .fenel file loaded but the auto-loop dedups against the
    // already-registered id). `captureStep6` re-derives the SAME snapshot from
    // the post-flip registry; byte-equality proves the new `.fenel` file
    // reproduces the deleted inline literal exactly.
    for (const id of STEP6_BATCH_IDS) {
      expect(captureStep6(id)).toEqual(ORACLE6[id] as Record<string, unknown>);
    }
  });

  test("each batch entity has exactly one Codeable", () => {
    const codeables = dispatchRegistry.listInstances("Codeable");
    for (const id of STEP6_BATCH_IDS) {
      expect(codeables.filter((i) => i.args[0] === id).length).toBe(1);
    }
  });

  test("the 3 labeled records have a Labelable; the 4 label-less records have NONE", () => {
    const labelables = dispatchRegistry.listInstances("Labelable");
    const has = (id: string) => labelables.some((i) => i.args[0] === id);
    for (const id of ["account", "integration", "entity_definition"]) expect(has(id)).toBe(true);
    for (const id of ["ButtonPayload", "PlanGrant", "PlanStep", "ProfileHandleInput"]) expect(has(id)).toBe(false);
  });
});

describe("FM-retire-E1 Step 5 — per-field UI-hint (@widget/@helpText) facet flip", () => {
  test("the batch covers 2 entities (plan/function)", () => {
    expect(STEP5_BATCH_IDS.length).toBe(2);
    expect(Object.keys(ORACLE5).length).toBe(2);
    expect(new Set(STEP5_BATCH_IDS)).toEqual(new Set(["plan", "function"]));
  });

  test("each flipped entity is auto-registered (its defineSystemEntity is gone)", () => {
    for (const id of STEP5_BATCH_IDS) {
      expect(systemEntities.find((e) => e.id === id)).toBeDefined();
    }
  });

  test("raw shape/facets match the Phase 2b presentation-empty oracle", () => {
    // UUID presentation is tested through getSystemRegistry below. The raw
    // entity lock must contain no reconstructed field UI/label overlay.
    for (const id of STEP5_BATCH_IDS) {
      expect(captureStep5(id)).toEqual(ORACLE5[id] as Record<string, unknown>);
    }
  });

  test("each flipped field has one UUID-keyed Displayable and no dotted runtime target", () => {
    const registry = getSystemRegistry();
    const identifiedField = (entityId: string, name: string) => {
      const type = registry.getIdentifiedEntity(entityId)?.type as FenelType | undefined;
      if (!type || !("$record" in type)) throw new Error(`missing record ${entityId}`);
      const field = type.$record.fields.find((candidate) => candidate.name === name);
      if (!field) throw new Error(`missing field ${entityId}.${name}`);
      return resolveIdentifiedFieldView(registry, field);
    };
    const planTerms = identifiedField("plan", "terms");
    const functionSpec = identifiedField("function", "function");
    expect(planTerms.fieldId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(functionSpec.fieldId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(registry.getFieldRepresentation("Displayable", planTerms.fieldId)?.methods.hint).toMatchObject({
      widget: { $tag: "Just", _0: "expression" },
    });
    expect(registry.getFieldRepresentation("Displayable", functionSpec.fieldId)?.methods.hint).toMatchObject({
      widget: { $tag: "Just", _0: "function-editor" },
    });
    expect(registry.getFieldRepresentation("Displayable", "plan.terms")).toBeUndefined();
    expect(registry.getFieldRepresentation("Displayable", "function.function")).toBeUndefined();
  // A cold exact repository registry performs the full identity/signature
  // projection. Closeout runs currently take ~129–179 s on this corpus, so
  // the former 60 s budget rejected a completed, correct build.
  }, 300_000);

  test("function's runtime-dead active/version fieldDefaults are DROPPED (no field.default slot)", () => {
    // FM-retire-Z — the `FieldDef.default` slot is retired; the runtime-dead
    // active/version fieldDefaults are gone with it. The fields exist, carrying
    // no default slot at all.
    const fn = systemEntities.find((e) => e.id === "function")!.type as {
      $record: { fields: Array<{ name: string }> };
    };
    for (const name of ["active", "version"]) {
      const f = fn.$record.fields.find((x) => x.name === name)!;
      expect(f).toBeDefined();
      expect("default" in f).toBe(false);
    }
  });
});

describe("FM-retire-E1 Step 3 — pure-enum deferred-entity flip (generate-then-lock)", () => {
  // forms-collapse Phase 4 Stage 3 — "form" removed (the `form` entity retired).
  test("the batch covers 4 entities (profile/item/inventory/purchase)", () => {
    expect(STEP3_BATCH_IDS.length).toBe(4);
    expect(Object.keys(ORACLE3).length).toBe(4);
    expect(new Set(STEP3_BATCH_IDS)).toEqual(
      new Set(["profile", "item", "inventory", "purchase"]),
    );
  });

  test("each flipped entity is auto-registered (its defineSystemEntity is gone)", () => {
    for (const id of STEP3_BATCH_IDS) {
      expect(systemEntities.find((e) => e.id === id)).toBeDefined();
    }
  });

  test("shape + facets + resolved default + derived select options match the pre-flip oracle", () => {
    // The oracle was captured PRE-flip (fieldUi.options + fieldDefaults overlay
    // still `defineSystemEntity`-sourced). `captureStep3` now re-derives the
    // default from the type-level `HasDefault` and the select labels from the
    // `$enum` + per-value `@valueLabel` Labelables (`enumOptionLabel`); byte-
    // equality proves the dissolved overlays reproduce the deleted arrays.
    for (const id of STEP3_BATCH_IDS) {
      expect(captureStep3(id)).toEqual(ORACLE3[id] as Record<string, unknown>);
    }
  });

  test("fieldDefaults dissolved → HasDefault on the enum atom resolves the same value", () => {
    const expected: Record<string, [string, unknown]> = {
      ProfileType: ["default", "person"],
      InventoryEnforce: ["default", "soft"],
      PurchaseStatus: ["default", "pending"],
    };
    for (const [atom, [k, v]] of Object.entries(expected)) {
      const m = dispatchRegistry.resolve(atom, "HasDefault", GLOBAL_ONLY);
      expect(m?.[k]).toBe(v);
    }
  });

  test("per-value labels resolve as Labelable `<atom>.<value>` only for the irregulars", () => {
    const labelables = dispatchRegistry.listInstances("Labelable");
    const has = (key: string) => labelables.some((i) => i.args[0] === key);
    // irregular (authored @valueLabel)
    for (const k of ["ProfileType.group", "ProfileType.ai_agent", "ItemType.telegram_group_dynamic",
      "InventoryEnforce.soft", "InventoryEnforce.hard"]) {
      expect(has(k)).toBe(true);
    }
    // humanize-derivable values carry NO authored Labelable (derived for free)
    for (const k of ["ProfileType.person", "PurchaseStatus.pending", "ProfileGender.male"]) {
      expect(has(k)).toBe(false);
    }
  });
});

describe("FM-retire-E1 Step 7 — residual parametric / core entities flip (generate-then-lock)", () => {
  test("the batch covers 5 entities (Maybe/Result/Either/LookupResult/Module)", () => {
    expect(STEP7_BATCH_IDS.length).toBe(5);
    expect(Object.keys(ORACLE7).length).toBe(5);
    expect(new Set(STEP7_BATCH_IDS)).toEqual(
      new Set(["Maybe", "Result", "Either", "LookupResult", "Module"]),
    );
  });

  test("each flipped entity is auto-registered exactly once (its defineSystemEntity is gone)", () => {
    for (const id of STEP7_BATCH_IDS) {
      expect(systemEntities.filter((e) => e.id === id).length).toBe(1);
    }
  });

  test("shape + params + facets match the locked oracle", () => {
    for (const id of STEP7_BATCH_IDS) {
      expect(captureStep7(id)).toEqual(ORACLE7[id] as Record<string, unknown>);
    }
  });

  test("structural invariants — params and kinded schemes flow from source binding", () => {
    const byId = (id: string) => systemEntities.find((e) => e.id === id)!;
    // head params reach the registered entity (the loader's Step-7 threading)
    expect(byId("Maybe").params?.map((p) => p.name)).toEqual(["a"]);
    expect(byId("Result").params?.map((p) => p.name)).toEqual(["e", "a"]);
    expect(byId("Either").params?.map((p) => p.name)).toEqual(["a", "b"]);
    expect(byId("LookupResult").params?.map((p) => p.name)).toEqual(["a"]);
    expect(byId("Module").params).toBeUndefined();
    // The bound head-param remains the source binder's authoritative `$var`.
    const just = (byId("Maybe").type as { $variant: { cases: Array<{ name: string; fields?: Array<{ type: unknown }> }> } })
      .$variant.cases.find((c) => c.name === "Just")!;
    expect(just.fields![0]!.type).toEqual({ $var: "a" });

    const maybe = byId("Maybe");
    expect(maybe.typeScheme?.body).toEqual(maybe.type);
    expect(maybe.typeScheme?.quantified).toEqual([
      { id: "q0", sourceName: "a", kind: { $tag: "KType" } },
    ]);
    // The actual registry seed must retain the same sidecar, not just the
    // intermediate `systemEntities` projection.
    expect(getSystemRegistry().getEntity("Maybe")?.typeScheme).toEqual(maybe.typeScheme);
  }, 300_000);

  test("Codeable + Labelable resolve per flipped entity (facets loader-sourced)", () => {
    const codeables = dispatchRegistry.listInstances("Codeable");
    const labelables = dispatchRegistry.listInstances("Labelable");
    for (const id of STEP7_BATCH_IDS) {
      expect(codeables.filter((i) => i.args[0] === id).length).toBe(1);
      expect(labelables.filter((i) => i.args[0] === id).length).toBe(1);
    }
  });

  test("the documented justified residuals stay inline-registered (NOT flipped)", () => {
    // Boolean ($opaque.name surface), field_ui_hint (parser gap on open-record
    // type-args), Ref/LocaleString (D1 alias surface), GeoLevel/GeoPath (D2
    // Id-literal surface), Draft (no type slot). Each keeps its surviving
    // `defineSystemEntity` and is NOT in any flip batch.
    const residuals = ["Boolean", "field_ui_hint", "Ref", "LocaleString", "GeoLevel", "GeoPath", "Draft"];
    for (const id of residuals) {
      for (const batch of [STEP2_BATCH_IDS, STEP3_BATCH_IDS, STEP5_BATCH_IDS, STEP6_BATCH_IDS, STEP7_BATCH_IDS]) {
        expect(batch).not.toContain(id);
      }
      expect(systemEntities.find((e) => e.id === id)).toBeDefined();
    }
  });
});
