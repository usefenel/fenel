// Phase 4 of field-meta-collapse — conformance tests for the `Place`
// constructor + `phantomGeoLevelOf` accessor that encode geo-located
// values via $tagged-phantom dependent typing.
//
// Coverage:
//   - `Place(level)` produces the expected $tagged shape for each of
//     the 6 GeoLevel constructors.
//   - `phantomGeoLevelOf(Place(level))` round-trips for all 6 levels.
//   - `phantomGeoLevelOf` returns null for non-Place shapes (plain
//     Id<Country>, Q-wrapped Number, plain record, undefined).
//   - `compareGeoLevel` produces correct ordering across all 36
//     (level × level) pairs via the std-fn dispatcher.
//   - The boundary helpers `taggedLevelFromDraftString` and
//     `draftStringFromTaggedLevel` round-trip every level.

import { describe, it, expect } from "vitest";
import {
  Place,
  Country,
  Region,
  City,
  PostalCode,
  Street,
  Address,
  geoLevelOrder,
  geoLevelDepth,
  taggedLevelFromDraftString,
  draftStringFromTaggedLevel,
  type GeoLevel,
} from "./places";
import { phantomGeoLevelOf } from "./field-meta";
import { measureType } from "./units";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { evaluate } from "./json-logic";

describe("Place constructor — $tagged-phantom encoding", () => {
  it("Place(City) produces canonical $tagged shape", () => {
    expect(Place(City)).toEqual({
      $tagged: {
        value: { $ref: "GeoPath" },
        phantom: {
          $refined: {
            base: { $ref: "GeoLevel" },
            set: { $tag: "SeEnum", values: [{ $tag: "GeoCity" }] },
          },
        },
      },
    });
  });

  it("Place(Country) and Place(Address) produce distinguishable types", () => {
    expect(Place(Country)).not.toEqual(Place(Address));
    const country = Place(Country) as {
      $tagged: { phantom: { $refined: { set: { $tag: "SeEnum"; values: GeoLevel[] } } } };
    };
    expect(country.$tagged.phantom.$refined.set.values[0]?.$tag).toBe("GeoCountry");
  });

  it("every GeoLevel constructor produces a valid Place type", () => {
    for (const lvl of geoLevelOrder) {
      const t = Place(lvl) as {
        $tagged: {
          value: { $ref: string };
          phantom: { $refined: { set: { $tag: "SeEnum"; values: GeoLevel[] } } };
        };
      };
      expect(t.$tagged.value.$ref).toBe("GeoPath");
      expect(t.$tagged.phantom.$refined.set.values[0]).toEqual(lvl);
    }
  });
});

describe("phantomGeoLevelOf — extract GeoLevel from Place-shape", () => {
  it("round-trips every GeoLevel through Place", () => {
    for (const lvl of geoLevelOrder) {
      expect(phantomGeoLevelOf(Place(lvl))).toEqual(lvl);
    }
  });

  it("returns null for a plain Id<Country> (non-Place $tagged shape)", () => {
    const idCountry = {
      $tagged: {
        value: { $ref: "Id" } as const,
        phantom: {
          $refined: {
            base: { $ref: "String" } as const,
            set: { $tag: "SeEnum" as const, values: ["country"] as unknown[] },
          },
        },
      },
    };
    expect(phantomGeoLevelOf(idCountry)).toBe(null);
  });

  it("returns null for a Q-wrapped Number (Phase 3 shape)", () => {
    expect(phantomGeoLevelOf(measureType({ $tag: "MeasureOne" }))).toBe(null);
  });

  it("returns null for a plain $ref atom", () => {
    expect(phantomGeoLevelOf({ $ref: "Number" })).toBe(null);
  });

  it("returns null for a plain $record", () => {
    expect(phantomGeoLevelOf({ $record: { fields: [] } })).toBe(null);
  });

  it("returns null for undefined", () => {
    expect(phantomGeoLevelOf(undefined)).toBe(null);
  });
});

describe("compareGeoLevel (std fn) — depth ordering", () => {
  // Build a registry once + evaluate compareGeoLevel calls through it.
  // Bypasses the registry-as-typeclass-dispatch path (we only need the
  // std-fn body to fire); same shape as Phase 3's units-phantom tests.
  const reg = createRegistry([stdModule]);
  const ctx = reg.evaluateContext();
  const call = (a: GeoLevel, b: GeoLevel): number =>
    evaluate({ call: ["compareGeoLevel", a, b] }, {}, ctx) as number;

  it("equal levels → 0", () => {
    for (const lvl of geoLevelOrder) {
      expect(call(lvl, lvl)).toBe(0);
    }
  });

  it("Country < City → -1", () => {
    expect(call(Country, City)).toBe(-1);
  });

  it("Address > Country → 1", () => {
    expect(call(Address, Country)).toBe(1);
  });

  it("all 36 (level × level) pairs match canonical depth ordering", () => {
    for (const a of geoLevelOrder) {
      for (const b of geoLevelOrder) {
        const da = geoLevelDepth(a);
        const db = geoLevelDepth(b);
        const expected = da < db ? -1 : da > db ? 1 : 0;
        expect(call(a, b)).toBe(expected);
      }
    }
  });

  // Sanity-check the dispatchEngineBody harness too — geoLevelDepth
  // alone, no compareGeoLevel composition.
  it("geoLevelDepth produces 0–5 for every GeoLevel constructor", () => {
    expect(geoLevelDepth(Country)).toBe(0);
    expect(geoLevelDepth(Region)).toBe(1);
    expect(geoLevelDepth(City)).toBe(2);
    expect(geoLevelDepth(PostalCode)).toBe(3);
    expect(geoLevelDepth(Street)).toBe(4);
    expect(geoLevelDepth(Address)).toBe(5);
  });

  it("std:geoLevelDepth dispatched body matches TS-side helper", () => {
    for (const lvl of geoLevelOrder) {
      const got = dispatchEngineBody("std:geoLevelDepth", [lvl]);
      expect(got).toBe(geoLevelDepth(lvl));
    }
  });
});

describe("boundary helpers — draft-string ↔ tagged GeoLevel", () => {
  it("round-trips every level through draft-string form", () => {
    for (const lvl of geoLevelOrder) {
      const s = draftStringFromTaggedLevel(lvl);
      const back = taggedLevelFromDraftString(s);
      expect(back).toEqual(lvl);
    }
  });

  it("returns null for unknown draft strings", () => {
    expect(taggedLevelFromDraftString("zip")).toBe(null);
    expect(taggedLevelFromDraftString("")).toBe(null);
  });
});
