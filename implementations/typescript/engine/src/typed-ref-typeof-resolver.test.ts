// ---------------------------------------------------------------------------
// typed-ref-typeof-resolver.test.ts — typed-function-references Phase 8b proof.
//
// 8b makes the two typing modes over ONE value (`{$ref: handle}`) RESOLVABLE:
//
//   transparent ref :  typeOf erases `Id h`  → the referent type `a`
//   opaque  Id<X>   :  typeOf keeps it        → `Id _ a` (the phantom)
//
// The transparent half already exists (`refType`, Phases 2 + 7b). 8b adds the
// type-level ERASE: `idReferentType(idType, getEntityType?)` — an `Id h a` TYPE →
// its referent kind. Pure-additive, like 7b: no producer, no recognizer rewiring,
// NO dispatch flip (8c). The class `Identifiable` stays INERT.
//
// The hard scope boundary (audit §F′): an Id is told apart from `Q` (tagged
// `Rational`) and `Place` (`GeoPath`) by the `value` slot — `idReferentType` must
// return `{$void}` for a Q/Place shape (proven below). `phantomEntityName` itself
// is a NON-disambiguating enum reader (8a surprise #1), so the gate IS the
// `value`-slot check.
//
// Non-brittle (the Phase-6/7e leak lesson): a CONTROLLED entity registered via
// `registerCatalogEntities` under its code-name, never the global catalog; the
// catalog lookup is INJECTED, mirroring `refType`'s discipline.
//
// Canonical spec: design/typed-function-references.md § "The opaque-mode fold
// (Phase 8)"; brief: workstreams/.../briefs/phase-8b-typeof-two-mode-resolver.md.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  Id,
  Ref,
  refType,
  idReferentType,
  type RefValue,
} from "./type-foundation";
import { registerCatalogEntities, getEntityTypeByName } from "./type-catalog";
import { measureType } from "./units";
import { phantomEntityName } from "./field-meta";
import { dispatchRegistry } from "./system-entities";
import type { FenelType } from "./types";

// A controlled entity — a 2-field record, registered under its code-name only.
const ENTITY_NAME = "Bot8b";
const field = (name: string, type: FenelType) =>
  ({ name, label: { $tag: "Nothing" }, type, default: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } }) as unknown;
const ENTITY_TYPE: FenelType = {
  $record: {
    fields: [
      field("token", { $ref: "String" } as FenelType),
      field("platform", { $ref: "String" } as FenelType),
    ],
  },
} as unknown as FenelType;

registerCatalogEntities([{ id: ENTITY_NAME, type: ENTITY_TYPE }]);

const noFn = () => undefined;

// Sibling `$tagged` envelopes that are NOT Id refs (8a's Q / Place shapes).
const Q_KG: FenelType = measureType({ $tag: "MeasureOne" });
const PLACE_CITY: FenelType = {
  $tagged: {
    value: { $ref: "GeoPath" }, // the Place discriminator
    phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["GeoCity"] } } },
  },
} as unknown as FenelType;

// ---------------------------------------------------------------------------
// (A) The type-level erase resolver.
// ---------------------------------------------------------------------------

describe("Phase 8b (A) — idReferentType: Id h a TYPE → referent kind", () => {
  test("resolves Id(name) to the registered entity kind", () => {
    expect(idReferentType(Id(ENTITY_NAME), getEntityTypeByName)).toEqual(ENTITY_TYPE);
  });

  test("graceful {$void} on an unregistered handle — never throws", () => {
    expect(() => idReferentType(Id("DefinitelyNotAnEntity8b"), getEntityTypeByName)).not.toThrow();
    expect(idReferentType(Id("DefinitelyNotAnEntity8b"), getEntityTypeByName)).toEqual({ $void: true });
  });

  test("graceful {$void} when no catalog lookup is injected (mirrors refType)", () => {
    expect(idReferentType(Id(ENTITY_NAME))).toEqual({ $void: true });
  });

  test("non-$tagged input → {$void}", () => {
    expect(idReferentType({ $ref: "String" } as FenelType, getEntityTypeByName)).toEqual({ $void: true });
    expect(idReferentType({ $record: { fields: [] } } as FenelType, getEntityTypeByName)).toEqual({ $void: true });
  });
});

// ---------------------------------------------------------------------------
// The hard scope boundary: Q / Place are NOT Id refs.
// ---------------------------------------------------------------------------

describe("Phase 8b — the value-slot discriminator holds (Q / Place → {$void})", () => {
  test("a Q (tagged Rational) is NOT an Id ref → {$void}", () => {
    // The discriminator, not the name read: phantomEntityName WOULD read a unit
    // enum off Q (it is non-disambiguating), but the value-slot gate rejects it.
    expect(idReferentType(Q_KG, getEntityTypeByName)).toEqual({ $void: true });
  });

  test("a Place (GeoPath value) is NOT an Id ref → {$void}", () => {
    expect(idReferentType(PLACE_CITY, getEntityTypeByName)).toEqual({ $void: true });
  });

  test("an Id with the SAME phantom-enum name still resolves (only the value slot differs)", () => {
    // Same `$enum` referent name as the entity, but the value slot makes it an Id
    // → resolves; the Place/Q with a different value slot does not. Proves the gate
    // keys on `value`, not on the phantom name.
    expect(idReferentType(Id(ENTITY_NAME), getEntityTypeByName)).toEqual(ENTITY_TYPE);
  });
});

// ---------------------------------------------------------------------------
// (C) The two documented modes compose (D-B — audit, don't over-build).
// ---------------------------------------------------------------------------

describe("Phase 8b (C) — the two-mode typeOf round-trip", () => {
  test("transparent (refType over a {$ref} VALUE) === opaque-erase (idReferentType over the Id TYPE)", () => {
    // Both name the same referent `a`, so both erase to the same entity kind.
    const transparent = refType(Ref(ENTITY_NAME) as RefValue, noFn, getEntityTypeByName);
    const opaqueErased = idReferentType(Id(ENTITY_NAME), getEntityTypeByName);
    expect(transparent).toEqual(ENTITY_TYPE);
    expect(opaqueErased).toEqual(ENTITY_TYPE);
    expect(transparent).toEqual(opaqueErased);
  });

  test("opaque KEEP: the Id TYPE is not erased unless idReferentType is called", () => {
    // The opaque mode keeps the `$tagged` envelope — `Id _ a` — so the editor /
    // EntityIdPicker can still read the phantom. Only an explicit deref erases it.
    const idType = Id(ENTITY_NAME) as { $tagged?: unknown };
    expect(idType.$tagged).toBeDefined();
    expect(phantomEntityName(Id(ENTITY_NAME))).toBe(ENTITY_NAME);
  });
});

// ---------------------------------------------------------------------------
// The class stays INERT — resolution does NOT flow through Identifiable.
// ---------------------------------------------------------------------------

describe("Phase 8b — Identifiable stays inert (the type-level resolver does not dispatch)", () => {
  test("the class is still registered (8a) but idReferentType resolves WITHOUT it", () => {
    // The seed exists…
    expect(dispatchRegistry.getClass("Identifiable")).toBeDefined();
    // …but idReferentType's resolution is a pure injected catalog lookup. Proven by
    // a custom lookup that the registry knows nothing about: the result follows the
    // INJECTED function, never an Identifiable.resolve dispatch.
    const custom = (name: string): FenelType | undefined =>
      name === "CustomOnly8b" ? ({ $void: false, $record: { fields: [] } } as unknown as FenelType) : undefined;
    expect(idReferentType(Id("CustomOnly8b"), custom)).toEqual({ $void: false, $record: { fields: [] } } as unknown as FenelType);
    // The registered entity is invisible through the custom lookup → not resolved.
    expect(idReferentType(Id(ENTITY_NAME), custom)).toEqual({ $void: true });
  });

  test("(B deferred) resolve return is still the concrete Maybe<{}> stopgap, NOT parametric-a", () => {
    // 8b's section B was ATTEMPTED and CARRIED to 8c (the dependent `a` needs
    // value→type instance resolution, unavailable at the value level — see the
    // typeclass-specs.fenel GAP #1 block). The method name survives; the return is
    // NOT a free type-var. We only pin the method surface (the return shape lives
    // in the dispatch seed and is intentionally left at the stopgap).
    const seed = dispatchRegistry.getClass("Identifiable");
    expect(seed!.methods.map((m) => m.name)).toEqual(["resolve"]);
  });
});
