// Phase 3.3b — factory-family data porting (typeclass-substrate-completion).
//
// The entity-grounded typeclass-instance families that lived as TypeScript
// consts/factories in `entity-typeclasses.ts` move off TS, Fenel-first. This
// phase (partial) ports the **Spatial curated family** to a `.fenel`
// value-decl projected via the `dispatchInstanceFile` loader. The test pins
// PARITY: the Fenel-authored instance is byte-identical (same typeName / args /
// methods) to the old TS `countrySpatial` const it replaces.
//
// Phase 3.3c extends this file: the **AddressFormat curated family** is rebuilt
// (not ported) as a single `addressType : Type` method. Each country's address
// shape is a first-class named `$record` (UsAddress / … in
// `fenel/std/entities/addresses.fenel`); the instance carries
// `addressType = <CcAddress>`, projected (via `typeValuedFields`) to the TYPE
// reference `{$ref:"<CcAddress>"}`. The tests pin the projected instance
// triple, the type-valued-vs-runtime-value disambiguation, and that the named
// types carry the right fields + postal `$refined`+`$pattern`.
//
// Remaining: Phone/Handle/Date eager Fenel-bodied factories (3.3d);
// ExchangeRate deferred per design/reactivity.md.

import { describe, it, expect } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import type { FenelType, FieldDef, SetExpr } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";
import FORMATS_INSTANCES_FENEL from "../../../../fenel/modules/formats/instances.fenel?raw";
import ADDRESSES_FENEL from "../../../../fenel/std/entities/addresses.fenel?raw";
import {
  derivePhoneInstances,
  deriveHandleInstances,
  deriveDateFormatInstances,
  dateFormatFor,
  dateSetExpr,
} from "./modules/formats";
import { phoneSetExpr } from "./entity-typeclasses";
import { ensureDerivedFormatInstancesRegistered, dispatchRegistry } from "./system-entities";
import { regexStringToPattern, patternToRegex } from "./regex-shim";
import { countries, platforms } from "./reference-data";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { evaluate } from "./json-logic";
import { GLOBAL_ONLY } from "./dispatch-registry";

// set-algebra-to-fenel Phase 3b-2 Step 4 — the parser now emits SetExprs in the
// canonical `$tag` Se* form. The `UsPostalCode` atom parsed from
// `addresses.fenel` is `String` refined over a `$pattern` SetExpr, which now
// lowers to `{$tag:"SePattern", …}`. `cf` deeply lowers ANY-form SetExpr back to
// the legacy `$`-key shape so the `"$pattern" in set` shape-probe below stays a
// structure check (setExprToDollarKey rewrites ONLY the SetExpr discriminator —
// it cannot mask a structure/value regression). Same sanctioned mechanical
// re-pin as the foundation-load / fenel-syntax `foldRefs` SetExpr fold.
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

describe("phase-3.3b-factory-families", () => {
  const instances =
    loadFenelModule(FORMATS_INSTANCES_FENEL, "formats", {
      dispatchInstanceFile: true,
      typeValuedFields: { AddressFormat: ["addressType"] },
    }).instances ?? [];

  it("Spatial country is Fenel-authored, byte-identical to the retired TS const", () => {
    const spatial = instances.find((i) => i.typeName === "Spatial");
    expect(spatial).toEqual({
      typeName: "Spatial",
      args: ["country"],
      methods: {
        geometryField: {
          $tag: "FieldRef",
          handle: "77f0169a-1bbb-46f3-8051-a8e46dade04a",
        },
        geometryType: "multipolygon",
        centroidField: {
          $tag: "FieldRef",
          handle: "cd52c958-3207-482e-80dc-b4f313fc1059",
        },
      },
    });
  });

  it("the curated Spatial instance carries a valid geometryType (law: geometry-type-valid)", () => {
    const spatial = instances.find((i) => i.typeName === "Spatial");
    const geometryType = (spatial?.methods as { geometryType?: string })
      .geometryType;
    expect(
      ["point", "polygon", "multipolygon"].includes(geometryType ?? ""),
    ).toBe(true);
  });

  // ---- Phase 3.3c — AddressFormat as `addressType : Type` -----------------

  // The 6 countries the curated family covers, paired with their named type.
  const ADDRESS_CASES: ReadonlyArray<[string, string]> = [
    ["US", "UsAddress"],
    ["CA", "CaAddress"],
    ["GB", "GbAddress"],
    ["DE", "DeAddress"],
    ["FR", "FrAddress"],
    ["JP", "JpAddress"],
  ];

  it.each(ADDRESS_CASES)(
    "AddressFormat %s projects { typeName, args:[code], methods:{ addressType:{$ref} } }",
    (code, typeName) => {
      const inst = instances.find(
        (i) => i.typeName === "AddressFormat" && i.args[0] === code,
      );
      expect(inst).toEqual({
        typeName: "AddressFormat",
        args: [code],
        methods: { addressType: { $ref: typeName } },
      });
    },
  );

  it("covers exactly the 6 curated countries", () => {
    const af = instances
      .filter((i) => i.typeName === "AddressFormat")
      .map((i) => i.args[0])
      .sort();
    expect(af).toEqual(["CA", "DE", "FR", "GB", "JP", "US"]);
  });

  it("WITHOUT typeValuedFields the ident lowers to the runtime VALUE {$tag}, not a type (the bug the option prevents)", () => {
    // Pin the disambiguation: the same `addressType = UsAddress` source lowers
    // to `{$tag:"UsAddress"}` (a nullary-constructor runtime value) when the
    // field is NOT declared type-valued — exactly the mis-projection
    // `typeValuedFields` exists to avoid.
    const naive =
      loadFenelModule(FORMATS_INSTANCES_FENEL, "formats", {
        dispatchInstanceFile: true,
      }).instances ?? [];
    const us = naive.find(
      (i) => i.typeName === "AddressFormat" && i.args[0] === "US",
    );
    expect(us?.methods).toEqual({ addressType: { $tag: "UsAddress" } });
  });

  // ---- The named address types themselves ---------------------------------

  const addressTypes = (() => {
    const map = new Map<string, FenelType>();
    for (const e of loadFenelModule(ADDRESSES_FENEL, "std").entities ?? []) {
      map.set(e.id, e.type);
    }
    return map;
  })();

  const fieldNames = (t: FenelType | undefined): string[] => {
    const rec = (t as { $record?: { fields: FieldDef[] } } | undefined)?.$record;
    return (rec?.fields ?? []).map((f) => f.name);
  };

  it("UsAddress is a $record with line1/line2/city/state/postalCode", () => {
    const t = addressTypes.get("UsAddress");
    expect(t && "$record" in t).toBe(true);
    expect(fieldNames(t)).toEqual([
      "line1",
      "line2",
      "city",
      "state",
      "postalCode",
    ]);
  });

  it("UsAddress.postalCode references the UsPostalCode atom, which is $refined+$pattern", () => {
    const us = addressTypes.get("UsAddress") as { $record: { fields: FieldDef[] } };
    const postal = us.$record.fields.find((f) => f.name === "postalCode");
    // The field references the postal-code atom (regex in TYPE position). 7g-parser:
    // a user-written type-name ref parses to `{$ref}` (was `{$ref}`).
    expect(postal?.type).toEqual({ $ref: "UsPostalCode" } as never);
    // And the atom itself is a refined String over a $pattern SetExpr.
    const atom = addressTypes.get("UsPostalCode") as
      | { $refined?: { base: FenelType; set: { $pattern?: unknown } } }
      | undefined;
    // 7g-parser: the refinement base `String` parses to `{$ref}` (was `{$ref}`).
    expect(atom?.$refined?.base).toEqual({ $ref: "String" } as never);
    const postalSet = atom?.$refined?.set ? (cf(atom.$refined.set) as object) : undefined;
    expect(postalSet != null && "$pattern" in postalSet).toBe(true);
  });

  it("GB/DE/FR addresses omit the state field; US/CA require it", () => {
    expect(fieldNames(addressTypes.get("GbAddress"))).not.toContain("state");
    expect(fieldNames(addressTypes.get("DeAddress"))).not.toContain("state");
    expect(fieldNames(addressTypes.get("FrAddress"))).not.toContain("state");
    expect(fieldNames(addressTypes.get("UsAddress"))).toContain("state");
    expect(fieldNames(addressTypes.get("CaAddress"))).toContain("state");
  });

  it("JpAddress has the Japan-specific postal-first shape", () => {
    expect(fieldNames(addressTypes.get("JpAddress"))).toEqual([
      "postalCode",
      "prefecture",
      "city",
      "ward",
      "building",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3.3d — the DERIVED format families (Phone / Handle / Date) are
// Fenel-bodied factories. Parity: the Fenel-built instances byte-equal what the
// retired TS factories produced (recomputed here from the same known rule data
// via `regexStringToPattern`), the new `regexSet` / `namedSet` substrate leaves
// round-trip, `phoneSetExpr` still combines dialCode+pattern, and the post-boot
// stage registers Phone+Handle into the dispatch registry.
// ---------------------------------------------------------------------------

describe("phase-3.3d-derived-format-families", () => {
  const reg = createRegistry([stdModule]);
  const ctx = reg.evaluateContext();
  // regexStringToPattern is total over real input; `!` reflects that here.
  const regexSet = (re: string): SetExpr => ({ $tag: "SePattern", pattern: regexStringToPattern(re)! });

  // -- The substrate leaves -------------------------------------------------

  it("std:regexSet round-trips a regex to {$pattern}, byte-equal to regexStringToPattern", () => {
    const re = "^[2-9]\\d{9}$";
    const r = evaluate({ call: ["regexSet", re] }, {}, ctx) as SetExpr;
    expect(r).toEqual({ $tag: "SePattern", pattern: regexStringToPattern(re)! });
    // (regexStringToPattern is total over real input, so regexSet is total — it
    // throws only on the unreachable null, mirroring the retired TS regexSet.)
  });

  it("std:namedSet builds a canonical SeRef SetExpr value", () => {
    const r = evaluate({ call: ["namedSet", "format:date:iso"] }, {}, ctx);
    expect(r).toEqual({ $tag: "SeRef", handle: "format:date:iso" });
  });

  // -- HandleFormat (the pilot) — read off Platform entity data -------------

  it("HandleFormat(instagram) is byte-identical to the retired TS factory", () => {
    const ig = platforms.find((p) => p.code === "instagram")!;
    const inst = deriveHandleInstances(platforms).find((i) => i.args[0] === "instagram");
    expect(inst).toEqual({
      typeName: "HandleFormat",
      args: ["instagram"],
      methods: {
        pattern: regexSet(ig.handlePattern),
        prefix: ig.handlePrefix,
        maxLength: ig.handleMaxLength,
        urlTemplate: ig.urlTemplate,
      },
    });
  });

  it("HandleFormat covers every platform", () => {
    expect(deriveHandleInstances(platforms).length).toBe(platforms.length);
  });

  // -- PhoneFormat — curated rule + permissive default ----------------------

  it("PhoneFormat(US) uses the curated rule, byte-identical to the TS factory", () => {
    const us = countries.find((c) => c.code === "US")!;
    const inst = derivePhoneInstances(countries).find((i) => i.args[0] === "US");
    expect(inst).toEqual({
      typeName: "PhoneFormat",
      args: ["US"],
      methods: {
        dialCode: us.dialCode,
        pattern: regexSet("^[2-9]\\d{9}$"),
        minDigits: 10,
        maxDigits: 10,
        exampleLocal: "2025551234",
      },
    });
  });

  it("PhoneFormat for a non-curated country uses the permissive default", () => {
    // Afghanistan ("AF") is not in the curated PHONE_RULES → default rule.
    const af = countries.find((c) => c.code === "AF")!;
    const inst = derivePhoneInstances(countries).find((i) => i.args[0] === "AF");
    expect(inst).toEqual({
      typeName: "PhoneFormat",
      args: ["AF"],
      methods: {
        dialCode: af.dialCode,
        pattern: regexSet("^[0-9]{4,15}$"),
        minDigits: 4,
        maxDigits: 15,
        exampleLocal: "",
      },
    });
  });

  it("PhoneFormat covers every country", () => {
    expect(derivePhoneInstances(countries).length).toBe(countries.length);
  });

  // -- DateFormat — fixed locale table, named-set patterns, NO regex --------

  it("DateFormat(en-US) is byte-identical to the retired TS factory", () => {
    const inst = deriveDateFormatInstances().find((i) => i.args[0] === "en-US");
    expect(inst).toEqual({
      typeName: "DateFormat",
      args: ["en-US"],
      methods: {
        pattern: { $tag: "SeRef", handle: "format:date:us" },
        template: "MM/dd/yyyy",
        order: ["month", "day", "year"],
        separator: "/",
        example: "12/25/2025",
      },
    });
  });

  it("DateFormat covers the 13 curated locales (iso fallback included)", () => {
    const locales = deriveDateFormatInstances().map((i) => i.args[0]).sort();
    expect(locales).toEqual(
      ["de", "en-GB", "en-US", "es", "fr", "iso", "it", "ja", "ko", "pl", "ru", "sv", "zh"],
    );
  });

  it("dateFormatFor falls back base-language then iso ('pt-BR' → iso, 'fr-CA' → fr)", () => {
    expect((dateFormatFor("pt-BR") as { pattern: SetExpr }).pattern).toEqual({ $tag: "SeRef", handle: "format:date:iso" });
    expect((dateFormatFor("fr-CA") as { template: string }).template).toBe("dd/MM/yyyy");
    expect((dateFormatFor("en-US") as { template: string }).template).toBe("MM/dd/yyyy");
  });

  it("dateSetExpr pulls the pattern SetExpr out of a DateFormat instance", () => {
    const iso = deriveDateFormatInstances().find((i) => i.args[0] === "iso")!;
    expect(dateSetExpr(iso)).toEqual({ $tag: "SeRef", handle: "format:date:iso" });
  });

  // -- phoneSetExpr — the live consumer still combines dialCode + pattern ---

  it("phoneSetExpr splices the dial code into the local pattern (US: +1)", () => {
    const inst = derivePhoneInstances(countries).find((i) => i.args[0] === "US")!;
    const combined = phoneSetExpr(inst);
    // The retired-factory contract: recover the local regex, prefix the escaped
    // dial code, re-parse. For US (+1, local ^[2-9]\d{9}$) → ^\+1[2-9]\d{9}$.
    expect(combined).toEqual(regexSet("^\\+1[2-9]\\d{9}$"));
    // And it must equal what patternToRegex round-trip implies (the serializer
    // canonicalises the `\d` digit class to the `[0-9]` interval form).
    const pattern = inst.methods.pattern as SetExpr;
    const local = pattern.$tag === "SePattern" ? patternToRegex(pattern.pattern) : null;
    expect(local).toBe("^[2-9][0-9]{9}$");
  });

  // -- Post-boot registration ----------------------------------------------

  it("ensureDerivedFormatInstancesRegistered adds Phone + Handle to the dispatch registry", () => {
    ensureDerivedFormatInstancesRegistered();
    expect(dispatchRegistry.resolve("US", "PhoneFormat", GLOBAL_ONLY)).toBeDefined();
    expect(dispatchRegistry.resolve("instagram", "HandleFormat", GLOBAL_ONLY)).toBeDefined();
  });
});
