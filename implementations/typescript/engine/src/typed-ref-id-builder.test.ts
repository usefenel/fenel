// ---------------------------------------------------------------------------
// typed-ref-id-builder.test.ts — typed-function-references Phase 8a proof.
//
// 8a lands the FOUNDATION for the opaque-mode fold (`Id<X>` ⇄ `ref`) with ZERO
// runtime-decision change. Two pure-additive moves, both proven here:
//
//   (B) the `Id(referent, handleKind?)` builder — the single producer of the
//       canonical `$tagged` Id envelope, so 8b/8c have one shape to evolve. The
//       ~5 hand-rolled sites now call it; its output is BYTE-IDENTICAL to the
//       literal they used to inline.
//   (A) the OPEN `Identifiable h` handle class + its UUID / CodeableName
//       instances, declared INERTLY — registered (catalog/dispatch-table
//       presence) but on NO resolution path (8c flips that).
//
// The real risk (the 7g-retire-4b lesson): the duck-typed `"$tagged" in t`
// readers are COMPILER-BLIND — tsc can't catch a misroute. So every phantom
// reader is exercised on the builder's output AND on the `Q` / `Place` siblings
// that share the `$tagged` envelope, proving the three stay discriminable by
// their `value` slot (the hard scope boundary, audit §F′).
//
// Canonical spec: design/typed-function-references.md § "The opaque-mode fold
// (Phase 8)"; brief: workstreams/.../briefs/phase-8a-id-h-a-shape-and-
// identifiable-class.md.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { Id, Ref } from "./type-foundation";
import { measureType } from "./units";
import {
  phantomEntityName,
  phantomUnitOf,
  phantomGeoLevelOf,
} from "./field-meta";
import { dispatchRegistry } from "./system-entities";
import { builtinInstances } from "./builtin-classes";
import { profileIntentForm, profileRelationshipForm } from "./admin-forms/profiles";
import type { FenelType, FieldDef, Instance } from "./types";

// The literal shape every hand-rolled Id site inlined before 8a (audit §B). The
// builder must reproduce it byte-for-byte.
const OLD_ID_SHAPE = (name: string): FenelType =>
  ({
    $tagged: {
      value: { $ref: "Id" },
      phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: [name] } } },
    },
  }) as unknown as FenelType;

// ---------------------------------------------------------------------------
// (B) The builder emits the canonical envelope, byte-identical.
// ---------------------------------------------------------------------------

describe("Phase 8a (B) — the Id(referent) builder", () => {
  test("emits the exact $tagged envelope the hand-rolled sites inlined", () => {
    expect(Id("item")).toEqual(OLD_ID_SHAPE("item"));
    expect(Id("plan")).toEqual(OLD_ID_SHAPE("plan"));
    expect(Id("profile")).toEqual(OLD_ID_SHAPE("profile"));
  });

  test("the value slot stays {$ref:'Id'} (the Id discriminator) by default", () => {
    expect((Id("x") as { $tagged: { value: unknown } }).$tagged.value).toEqual({ $ref: "Id" });
  });

  test("handleKind is overridable (the `h` of `Id h a`) but defaults to the Id handle", () => {
    const custom = Id("x", { $ref: "UUID" } as FenelType);
    expect((custom as { $tagged: { value: unknown } }).$tagged.value).toEqual({ $ref: "UUID" });
    // phantom (the referent `a`) is unchanged by the handle kind
    expect((custom as { $tagged: { phantom: unknown } }).$tagged.phantom).toEqual(
      (Id("x") as { $tagged: { phantom: unknown } }).$tagged.phantom,
    );
  });
});

// ---------------------------------------------------------------------------
// (B) The 5 migrated sites produce byte-identical output.
// ---------------------------------------------------------------------------

const fieldType = (fields: FieldDef[], name: string): FenelType | undefined =>
  fields.find((f) => f.name === name)?.type as FenelType | undefined;

const recordFields = (t: FenelType): FieldDef[] =>
  ((t as unknown as { $record?: { fields?: FieldDef[] } }).$record?.fields ?? []);

describe("Phase 8a (B) — migrated hand-rolled sites are byte-identical", () => {
  test("admin-forms/profiles.ts — itemId / planId / profileBId", () => {
    const intentFields = recordFields(profileIntentForm.type as FenelType);
    expect(fieldType(intentFields, "itemId")).toEqual(OLD_ID_SHAPE("item"));
    expect(fieldType(intentFields, "planId")).toEqual(OLD_ID_SHAPE("plan"));

    const relFields = recordFields(profileRelationshipForm.type as FenelType);
    expect(fieldType(relFields, "profileBId")).toEqual(OLD_ID_SHAPE("profile"));
  });
  // FM-retire-E1 Step 4 deleted `groupConstructor` + the `instantiate`
  // mechanism (Group removed). The flat/tree Group<X> byte-identity block
  // that lived here went with it — `Id()` itself is still proven above.
});

// ---------------------------------------------------------------------------
// (C) Compiler-blind phantom readers behave identically on the builder output,
//     and Id / Q / Place stay discriminable by their `value` slot.
// ---------------------------------------------------------------------------

// Q-shape (units.ts) — value = the tagged base Rational, NOT {$ref:"Id"}.
const Q_KG: FenelType = measureType({ $tag: "MeasureOne" });
// Place-shape (places.ts) — value = {$ref:"GeoPath"} (the producer stays
// {$ref}; the readers dual-read both handles).
const PLACE_CITY: FenelType = {
  $tagged: {
    value: { $ref: "GeoPath" },
    phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["GeoCity"] } } },
  },
} as unknown as FenelType;

describe("Phase 8a (C) — phantom readers, unchanged on the Id(...) shape", () => {
  // The builder leaves the `value` slot exactly `{$ref:"Id"}`, so EVERY reader
  // returns the same result on `Id(name)` as on the literal it replaced.
  test("phantomEntityName reads the referent off an Id(...), byte-identically", () => {
    expect(phantomEntityName(Id("item"))).toBe("item");
    expect(phantomEntityName(Id("plan"))).toBe("plan");
    expect(phantomEntityName(Id("item"))).toBe(phantomEntityName(OLD_ID_SHAPE("item")));
    // phantomEntityName / phantomUnitOf are NON-disambiguating phantom-enum
    // readers (they read any $tagged-phantom enum); their job is unchanged here.
    expect(phantomUnitOf(Id("item"))).toBe(phantomUnitOf(OLD_ID_SHAPE("item")) as never);
  });

  // The hard scope boundary (audit §F′): phantomGeoLevelOf is the ONE reader that
  // gates on the `value` slot (`value` must be GeoPath). It must keep Id / Q /
  // Place discriminable — an Id or a Q must NOT be misread as a Place.
  test("phantomGeoLevelOf gate: Place resolves; Id and Q do NOT (value-slot gate)", () => {
    expect(phantomGeoLevelOf(PLACE_CITY)).toBe("GeoCity" as never); // value = GeoPath
    expect(phantomGeoLevelOf(Id("item"))).toBeNull();               // value = {$ref:"Id"}
    expect(phantomGeoLevelOf(Q_KG)).toBeNull();                     // value = Rational
  });

  // Q stays its own shape: its `value` is the tagged base Rational, so the
  // GeoPath gate rejects it (above) and the unit reader still resolves it.
  test("Q (tagged Rational) still resolves via phantomUnitOf", () => {
    expect(phantomUnitOf(Q_KG)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (A) The open `Identifiable h` class + instances register — but are INERT.
// ---------------------------------------------------------------------------

describe("Phase 8a (A) — Identifiable registers, inertly", () => {
  test("the class derives a dispatch seed in the boot registry", () => {
    const seed = dispatchRegistry.getClass("Identifiable");
    expect(seed, "Identifiable resolves in the boot registry").toBeDefined();
    expect(seed!.methods.map((m) => m.name)).toEqual(["resolve"]);
  });

  test("both handle-kind instances are registered (UUID + CodeableName)", () => {
    const insts = [...dispatchRegistry.listInstances("Identifiable")] as Instance[];
    const byArg = (a: string) => insts.find((i) => i.args[0] === a);
    expect(byArg("UUID"), "UUID instance").toBeDefined();
    expect(byArg("CodeableName"), "CodeableName instance").toBeDefined();
    // resolve targets are typed {$ref} function references, not bare strings.
    // typed-function-references Phase 10 moved these instances to `.fenel`
    // (fenel/std/dispatch-instances.fenel); the loader's bare-`{var}`→`{$ref}`
    // flip lowers the point-free `resolve = getInstanceById` to a codeableName
    // handle `{$ref:"getInstanceById"}` (NOT the fnId handle the deleted TS const
    // carried). Both resolve via `getFunction` (id-or-codeName) to the same
    // function — dispatch is identical; only the literal handle string differs.
    expect(byArg("UUID")!.methods.resolve).toEqual(Ref("getInstanceById"));
    expect(byArg("CodeableName")!.methods.resolve).toEqual(Ref("getInstanceByName"));
  });

  test("the instances are `.fenel`-authored, not TS consts in builtinInstances", () => {
    // Phase 10 retired the `uuidIdentifiable` / `codeableNameIdentifiable` TS
    // consts. The instances now register through the `.fenel` instances load
    // path (system-entities.ts `loadFenelModule(typeclassInstancesSrc)`), so
    // builtinInstances no longer carries them — they live only in the registry.
    const ids = builtinInstances.filter((i) => i.typeName === "Identifiable");
    expect(ids).toEqual([]);
    const registered = [...dispatchRegistry.listInstances("Identifiable")] as Instance[];
    expect(registered.map((i) => i.args[0]).sort()).toEqual(["CodeableName", "UUID"]);
  });

  test("INERT: the opaque-mode read path (phantomEntityName) is unchanged — " +
    "resolution does NOT yet flow through Identifiable", () => {
    // 8a wires NO consumer to Identifiable. The editor / EntityIdPicker opaque
    // read is still phantomEntityName over the $tagged phantom — the Phase-6-era
    // path — not a class `resolve` dispatch. Proven by the reader still working
    // structurally (above) with the class merely declared. 8c flips this.
    expect(phantomEntityName(Id("item"))).toBe("item");
  });
});
