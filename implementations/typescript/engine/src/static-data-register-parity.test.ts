// storage-as-effect Phase 3a/3d — static-data collapse parity oracle.
//
// The country / currency / language / platform reference rows are `.fenel`
// value-decls (reference-data.ts), registered into `dispatchRegistry` as pure
// by-type dispatch targets. This file pins the collapse end-to-end:
//   (a) `dispatchRegistry.listInstances(<RowType>)` returns every row for the
//       entity — the unified-register by-type query (design/unified-dispatch.md
//       §241) is the source of the rows.
//   (b) `referenceTypeByCodeName()` is the loader's codeName→type-name pairing
//       (a catalog projection, NOT a hardcoded table) — the codeName the frontend
//       holds ("country") resolves to the register's type-def name ("Country").
//       Phase 3d retired the `getStaticData` / `hasStaticData` /
//       `listStaticDataEntities` shim: the frontend reads the by-type query
//       directly (via the `~/lib/reference-data` adapter), resolving through this
//       pairing — so the oracle pins the pairing, not the shim.
//   (c) the row VALUES are byte-identical to the retired arrays — and the raw
//       register rows carry NO `_flag` (Phase 3c dropped the baked field; Phase 3d
//       moved its materialization to the frontend edge). `country._flag` is the
//       `std:countryFlag` projection (the source of truth — block (e)), never a
//       stored field.
//   (d) the typeclass-derivation inputs are intact: PhoneFormat / HandleFormat /
//       ExchangeRate derive one instance per row.
//   (e) the `std:countryFlag` projection (Phase 3c) derives the flag from the
//       2-letter code (US → 🇺🇸) — the source of truth the frontend materializes
//       `country._flag` from at the edge.

import { describe, it, expect } from "bun:test";
import {
  dispatchRegistry,
  ensureDerivedFormatInstancesRegistered,
} from "./system-entities";
import {
  countries,
  currencies,
  languages,
  platforms,
  referenceTypeByCodeName,
} from "./reference-data";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { invokeCallable } from "./json-logic";

// Row counts (the retired setStaticData map's counts, now the `.fenel` files').
const COUNTS = { country: 221, currency: 152, language: 183, platform: 12 } as const;
const CODE_TO_TYPE = {
  country: "Country",
  currency: "Currency",
  language: "Language",
  platform: "Platform",
} as const;

/** The universal by-type register query — what the frontend adapter reads. */
const rowsOf = (typeName: string): Record<string, unknown>[] =>
  dispatchRegistry.listInstances(typeName).map((i) => i.methods as Record<string, unknown>);

describe("Phase 3a (a) — rows are by-type instances in the unified register", () => {
  for (const [codeName, typeName] of Object.entries(CODE_TO_TYPE)) {
    it(`listInstances("${typeName}") returns ${COUNTS[codeName as keyof typeof COUNTS]} rows`, () => {
      expect(dispatchRegistry.listInstances(typeName)).toHaveLength(
        COUNTS[codeName as keyof typeof COUNTS],
      );
    });
  }
});

describe("Phase 3d (b) — referenceTypeByCodeName is the codeName→type pairing", () => {
  for (const [codeName, typeName] of Object.entries(CODE_TO_TYPE)) {
    it(`"${codeName}" resolves to "${typeName}"`, () => {
      expect(referenceTypeByCodeName().get(codeName)).toBe(typeName);
      expect(referenceTypeByCodeName().has(codeName)).toBe(true);
    });
  }

  it("reports nothing for a non-reference entity", () => {
    expect(referenceTypeByCodeName().has("profile")).toBe(false);
    expect(referenceTypeByCodeName().get("profile")).toBeUndefined();
  });

  it("the four reference codeNames are the pairing's keys", () => {
    expect([...referenceTypeByCodeName().keys()].sort()).toEqual(
      ["country", "currency", "language", "platform"],
    );
  });
});

describe("Phase 3a/3c (c) — row shapes are byte-identical; _flag is never stored", () => {
  it("currency USD row shape", () => {
    const usd = rowsOf("Currency").find((r) => r.code === "USD");
    expect(usd).toEqual({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2 });
  });

  it("language en row shape", () => {
    const en = rowsOf("Language").find((r) => r.code === "en");
    expect(en).toEqual({ code: "en", name: "English", nativeName: "English" });
  });

  it("country US raw register row carries NO baked _flag (projection-only)", () => {
    // Phase 3c dropped the baked field; Phase 3d moved its materialization to the
    // frontend edge — the engine's register rows are the pure `.fenel` values.
    const us = rowsOf("Country").find((r) => r.code === "US")!;
    expect(us).toEqual({
      code: "US",
      alpha3: "USA",
      name: "United States",
      dialCode: "+1",
      currency: "USD",
      language: "en",
    });
    expect("_flag" in us).toBe(false);
  });

  it("the typed `countries` array view STRIPS _flag (pre-3a export shape)", () => {
    const us = countries.find((c) => c.code === "US")!;
    expect(us).toEqual({
      code: "US",
      alpha3: "USA",
      name: "United States",
      dialCode: "+1",
      currency: "USD",
      language: "en",
    });
    expect("_flag" in us).toBe(false);
  });

  it("array views match the row counts", () => {
    expect(countries).toHaveLength(COUNTS.country);
    expect(currencies).toHaveLength(COUNTS.currency);
    expect(languages).toHaveLength(COUNTS.language);
    expect(platforms).toHaveLength(COUNTS.platform);
  });
});

describe("Phase 3a (d) — typeclass derivations read the reference rows intact", () => {
  it("ExchangeRate derives one instance per currency", () => {
    expect(dispatchRegistry.listInstances("ExchangeRate")).toHaveLength(COUNTS.currency);
  });
  it("PhoneFormat / HandleFormat derive one instance per country / platform", () => {
    ensureDerivedFormatInstancesRegistered();
    expect(dispatchRegistry.listInstances("PhoneFormat")).toHaveLength(COUNTS.country);
    expect(dispatchRegistry.listInstances("HandleFormat")).toHaveLength(COUNTS.platform);
  });
});

describe("Phase 3c (e) — std:countryFlag is the pure flag-from-code projection", () => {
  const ctx = createRegistry([stdModule]).evaluateContext();
  const flag = (code: string) => invokeCallable("std:countryFlag", [code], ctx);

  it("derives the flag emoji from the 2-letter code", () => {
    expect(flag("US")).toBe("🇺🇸");
    expect(flag("FR")).toBe("🇫🇷");
    expect(flag("DE")).toBe("🇩🇪");
    expect(flag("ZW")).toBe("🇿🇼");
  });

  it("the projection derives a flag for every country row code (edge-materialize source)", () => {
    // The frontend adapter materializes `country._flag` from this projection at
    // the edge. Assert it produces a flag for every register row — the
    // source-of-truth move, end-to-end (no stored _flag anywhere).
    for (const row of rowsOf("Country")) {
      const f = flag(row.code as string) as string;
      expect(typeof f).toBe("string");
      expect([...f].length).toBe(2); // two regional-indicator codepoints
    }
  });
});
