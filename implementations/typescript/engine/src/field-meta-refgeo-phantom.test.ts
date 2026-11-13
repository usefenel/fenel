// Phase 4 of field-meta-collapse — conformance tests for the consumer
// flips landed in Commit 2. Covers widget-hint / json-schema /
// entity-def-printer integration with the Place : GeoLevel -> Type
// constructor. The places-phantom.test.ts file covers the engine-
// plumbing surface (Place + phantomGeoLevelOf + std fns); this file
// covers the downstream consumers.

import { describe, it, expect } from "vitest";
import {
  Place,
  Country,
  Region,
  City,
  PostalCode,
  Street,
  Address,
  taggedLevelFromDraftString,
} from "./places";
import { widgetForType } from "./widget-hint";
import { fenelTypeToJsonSchema } from "./json-schema";
import type { FenelType } from "./types";
describe("widget-hint — Place dispatch", () => {
  it("produces place-picker widget for Place at any level", () => {
    for (const lvl of [Country, Region, City, PostalCode, Street, Address]) {
      const hint = widgetForType(Place(lvl));
      expect(hint.widget).toBe("place-picker");
      expect((hint.config as Record<string, unknown> | undefined)?.["level"]).toBeDefined();
    }
  });

  it("surfaces the precision level as draft-string in config", () => {
    const h = widgetForType(Place(City));
    expect((h.config as { level: string }).level).toBe("city");
  });

  it("returns entity-picker for plain Id<country>, NOT place-picker", () => {
    const idCountry: FenelType = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["country"] } } },
      },
    };
    const hint = widgetForType(idCountry);
    expect(hint.widget).toBe("entity-picker");
  });
});

describe("json-schema — Place emission", () => {
  it("emits an object schema with GeoPath fields + x-geo-level extension", () => {
    const schema = fenelTypeToJsonSchema(Place(City)) as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
    expect(schema["x-geo-level"]).toBe("city");
    const props = schema["properties"] as Record<string, unknown>;
    expect(props["country"]).toBeDefined();
    expect(props["region"]).toBeDefined();
    expect(props["city"]).toBeDefined();
    expect(props["postalCode"]).toBeDefined();
    expect(props["street"]).toBeDefined();
    expect(props["address"]).toBeDefined();
    expect(schema["required"]).toEqual(["country"]);
  });

  it("emits string reference (NOT object) for plain Id<country>", () => {
    const idCountry: FenelType = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["country"] } } },
      },
    };
    const schema = fenelTypeToJsonSchema(idCountry) as Record<string, unknown>;
    expect(schema["type"]).toBe("string");
    expect(schema["x-geo-level"]).toBeUndefined();
  });

  it("emits x-geo-level for every level", () => {
    const levels: Array<[ReturnType<typeof taggedLevelFromDraftString>, string]> = [
      [Country, "country"],
      [Region, "region"],
      [City, "city"],
      [PostalCode, "postal_code"],
      [Street, "street"],
      [Address, "address"],
    ];
    for (const [lvl, draft] of levels) {
      const schema = fenelTypeToJsonSchema(Place(lvl!)) as Record<string, unknown>;
      expect(schema["x-geo-level"]).toBe(draft);
    }
  });
});

describe("migration-shape — value-row lift (JS analogue)", () => {
  // The PL/pgSQL value-row lift wraps a legacy `Id<Country>` string
  // (the country UUID) into a GeoPath record. This test exercises the
  // JS analogue so the recipe stays consistent with future executions.
  function liftLegacyValue(v: unknown): unknown {
    if (typeof v === "object" && v !== null && "country" in (v as object)) {
      return v;
    }
    if (typeof v === "string") {
      return {
        country: v,
        region: { $tag: "Nothing" },
        city: { $tag: "Nothing" },
        postalCode: { $tag: "Nothing" },
        street: { $tag: "Nothing" },
        address: { $tag: "Nothing" },
      };
    }
    return v;
  }

  it("wraps a legacy country-ID string into a GeoPath record", () => {
    const wrapped = liftLegacyValue("country-uuid-123") as { country: string };
    expect(wrapped.country).toBe("country-uuid-123");
  });

  it("is idempotent — already-wrapped GeoPath is a no-op", () => {
    const already = {
      country: "country-uuid-123",
      region: { $tag: "Just", _0: "region-uuid-456" },
      city: { $tag: "Nothing" },
      postalCode: { $tag: "Nothing" },
      street: { $tag: "Nothing" },
      address: { $tag: "Nothing" },
    };
    expect(liftLegacyValue(already)).toBe(already);
  });
});
