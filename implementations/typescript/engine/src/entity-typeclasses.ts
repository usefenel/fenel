// ---------------------------------------------------------------------------
// Entity-derived typeclasses — the "data-grounded type system"
//
// Interface instances that are derived from runtime entity data.
// No new source code needed when entities evolve — the instances co-evolve.
//
//   PhoneFormat(country)   — phone validation rules derived from Country entity
//   AddressFormat(country) — address structure derived from Country entity
//   HandleFormat(platform) — social handle rules derived from Platform entity
//
// This is the novel category: types grounded in runtime data.
// ---------------------------------------------------------------------------

import type {
  Interface,
  Instance,
  SetExpr,
} from "./types";
import type { Currency } from "./reference-data";
import { regexStringToPattern, patternToRegex } from "./regex-shim";
import { List } from "./type-foundation";
import { peelSetExpr } from "./set-marker";

// Phase 3.3d — the derived format-family FACTORIES (PhoneFormat / HandleFormat /
// DateFormat instances + their rules tables) moved to Fenel-bodied factories in
// `fenel/modules/formats/factories.fenel` (TS surface in `modules/formats.ts`).
// What stays here: the ClassSeeds (the class declarations), the ExchangeRate +
// Spatial families, and `phoneSetExpr` — a pure SetExpr *reader* over a
// PhoneFormat instance kept TS (brief watch-out #3) because porting it would
// need a second regex leaf (`patternToRegex`); it has no consumers today.
function regexSet(re: string): SetExpr {
  const p = regexStringToPattern(re);
  if (!p) throw new Error(`entity-typeclasses: invalid regex /${re}/`);
  return { $tag: "SePattern", pattern: p };
}

// ---------------------------------------------------------------------------
// PhoneFormat — phone validation parameterized by country
//
//   typeclass PhoneFormat a where
//     dialCode    :: String          — international prefix ("+1", "+44")
//     pattern     :: SetExpr         — regex for local number
//     minDigits   :: Nat             — minimum digit count (excluding prefix)
//     maxDigits   :: Nat             — maximum digit count
//     exampleLocal :: String         — example for UI placeholder
//
//   instance PhoneFormat "US" where
//     dialCode = "+1"
//     pattern  = regexSet("^[2-9]\\d{9}$")  // algebraic Pattern under $pattern
//     minDigits = 10, maxDigits = 10
//     exampleLocal = "2025551234"
// ---------------------------------------------------------------------------

export const phoneFormat: Interface = {
  name: "PhoneFormat",
  description:
    "Phone number validation rules — derived from Country entity data",
  params: [{ name: "country" }],
  methods: [
    {
      name: "dialCode",
      description: "International dialing prefix (e.g. +1, +44)",
      params: [],
      returns: { $ref: "String" },
    },
    {
      name: "pattern",
      description: "SetExpr constraint on the local number portion",
      params: [],
      returns: { $ref: "SetExpr" },
    },
    {
      name: "minDigits",
      description: "Minimum digit count for local number",
      params: [],
      returns: { $ref: "Nat" },
    },
    {
      name: "maxDigits",
      description: "Maximum digit count for local number",
      params: [],
      returns: { $ref: "Nat" },
    },
    {
      name: "exampleLocal",
      description: "Example local number (for placeholder text)",
      params: [],
      returns: { $ref: "String" },
      body: "",
    },
  ],
};

// ---------------------------------------------------------------------------
// AddressFormat — address structure parameterized by country
//
//   typeclass AddressFormat a where
//     addressType :: FenelType    — the country's postal address as a TYPE
//
// Phase 3.3c (typeclass-substrate-completion) collapsed the prior 4 methods
// (`addressFields : List FieldDef` + `postalName`/`stateName`/`cityName` label
// strings) into this single type-valued method. Each country's address shape
// is a first-class named `$record` (UsAddress / CaAddress / GbAddress /
// DeAddress / FrAddress / JpAddress — `fenel/std/entities/addresses.fenel`) the
// universal FieldRenderer drives; per-field labels (ZIP code / Province / …)
// live on each record's FieldDefs. `addressType : FenelType` is the exact
// type-valued-method shape `Aggregable`'s `inputType`/`outputType` use, so the
// instances project via the loader's `typeValuedFields` option with no loader
// extension. The instances are Fenel-authored value-decls in
// `fenel/modules/formats/instances.fenel`, projected to
// `{ typeName:"AddressFormat", args:[code], methods:{ addressType:{$named:…} } }`.
// ---------------------------------------------------------------------------

export const addressFormat: Interface = {
  name: "AddressFormat",
  description:
    "Address structure as a Type — each country's postal address is a named $record the universal FieldRenderer drives",
  params: [{ name: "country" }],
  methods: [
    {
      name: "addressType",
      description: "The country's postal address shape, as a first-class Type",
      params: [],
      returns: { $ref: "FenelType" },
    },
  ],
};

// ---------------------------------------------------------------------------
// HandleFormat — social media handle rules parameterized by platform
// ---------------------------------------------------------------------------

export const handleFormat: Interface = {
  name: "HandleFormat",
  description:
    "Social media handle validation — rules differ per platform",
  params: [{ name: "platform" }],
  methods: [
    {
      name: "pattern",
      description: "SetExpr constraint on the handle string",
      params: [],
      returns: { $ref: "SetExpr" },
    },
    {
      name: "prefix",
      description: "Display prefix (e.g. '@' for Twitter/IG)",
      params: [],
      returns: { $ref: "String" },
      body: "@",
    },
    {
      name: "maxLength",
      description: "Maximum handle length",
      params: [],
      returns: { $ref: "Nat" },
    },
    {
      name: "urlTemplate",
      description: "URL template with {handle} placeholder",
      params: [],
      returns: { $ref: "String" },
    },
  ],
};

// ---------------------------------------------------------------------------
// PhoneFormat — the derived instances + the PHONE_RULES table are now
// Fenel-bodied (Phase 3.3d): `fenel/modules/formats/factories.fenel` +
// `modules/formats.ts:derivePhoneInstances`. Only `phoneSetExpr` (a pure SetExpr
// reader over a built PhoneFormat instance) stays here.
//
// `phoneSetExpr` builds a SetExpr that validates a full phone number for a
// given country, combining dialCode prefix + local pattern into one constraint.
// ---------------------------------------------------------------------------
export function phoneSetExpr(instance: Instance): SetExpr {
  const methods = instance.methods as {
    dialCode: string;
    pattern: SetExpr;
    minDigits: number;
    maxDigits: number;
  };

  const dial = methods.dialCode.replace("+", "\\+");

  // Full number: dialCode + local digits. Recover the local regex source from
  // the algebraic Pattern, then splice in the dial code, then re-parse.
  const patternView = peelSetExpr(methods.pattern);
  if (patternView?.kind === "SePattern") {
    const localRegex = patternToRegex(patternView.pattern);
    if (localRegex) {
      const inner = localRegex.replace(/^\^/, "").replace(/\$$/, "");
      return regexSet(`^${dial}${inner}$`);
    }
  }

  // Fallback: dial code + digit count range
  return { $tag: "SeIntersect", branches: [
      regexSet(`^\\+?${dial.replace("\\+", "")}`),
      methods.pattern,
    ] };
}

// AddressFormat instances are Fenel-authored value-decls in
// fenel/modules/formats/instances.fenel (Phase 3.3c — `addressType : Type`
// rebuild). The `addressFormat` Interface above stays; the instances + the old
// FieldDef-array helpers (westernAddress / japaneseAddress) retired with the
// 4→1 method collapse. The per-country named address types live in
// fenel/std/entities/addresses.fenel.

// HandleFormat instances are now Fenel-bodied (Phase 3.3d):
// `fenel/modules/formats/factories.fenel:deriveHandleInstances` +
// `modules/formats.ts`. The `handleFormat` Interface above stays.

// ---------------------------------------------------------------------------
// ExchangeRate — currency conversion via typeclass, not hardcoded factors
//
//   typeclass ExchangeRate a where
//     rate     :: ℝ          — value of 1 unit in base currency (USD)
//     decimals :: ℕ          — decimal precision for this currency
//
//   instance ExchangeRate "EUR" where
//     rate     = 1.08        (snapshot — refreshed from external feed)
//     decimals = 2
//
// Cross-conversion is pure arithmetic on instance data:
//   convert(amount, from, to) = amount * rate(from) / rate(to)
//
// Expressible as JSON Logic — no special convert() function needed:
//   { "*": [amount, { "/": [{ "var": "ExchangeRate.EUR.rate" },
//                            { "var": "ExchangeRate.JPY.rate" }] }] }
// ---------------------------------------------------------------------------

export const exchangeRate: Interface = {
  name: "ExchangeRate",
  description:
    "Currency exchange rate — derived from Currency entity data, refreshed from external feeds",
  params: [{ name: "currency" }],
  methods: [
    {
      name: "rate",
      description: "Value of 1 unit in base currency (USD)",
      params: [],
      returns: { $ref: "ℝ" },
    },
    {
      name: "decimals",
      description: "Decimal precision for rounding after conversion",
      params: [],
      returns: { $ref: "ℕ" },
    },
  ],
};

/**
 * Snapshot exchange rates (to USD). These are default/fallback values.
 * In production, instances are re-derived when rates are refreshed
 * from an external feed — same entity-update flow as any other data.
 */
const SNAPSHOT_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CNY: 0.14,
  CHF: 1.13,
  CAD: 0.74,
  AUD: 0.66,
  KRW: 0.00075,
  INR: 0.012,
  BRL: 0.20,
  RUB: 0.011,
  MXN: 0.058,
  SGD: 0.75,
  HKD: 0.13,
  SEK: 0.096,
  NOK: 0.094,
  NZD: 0.61,
  TRY: 0.031,
  ZAR: 0.055,
  SAR: 0.27,
  AED: 0.27,
  PLN: 0.25,
  THB: 0.028,
  TWD: 0.031,
  ILS: 0.27,
  PHP: 0.018,
  CZK: 0.044,
  CLP: 0.0011,
  EGP: 0.021,
};

/**
 * Derive ExchangeRate instances from Currency entity data.
 *
 * Same pattern as derivePhoneInstances: entity data IS the typeclass instance.
 * Add a currency → get exchange rate resolution.
 *
 * Currencies with known snapshot rates get those values.
 * All others get rate = 0 (unknown — must be populated from feed).
 */
export function deriveExchangeRateInstances(
  currencyList: Currency[],
  rates?: Record<string, number>,
): Instance[] {
  const rateMap = rates ?? SNAPSHOT_RATES;

  return currencyList.map((c) => ({
    typeName: "ExchangeRate",
    args: [c.code],
    methods: {
      rate: rateMap[c.code] ?? 0,
      decimals: c.decimals,
    },
  }));
}

// ---------------------------------------------------------------------------
// Spatial — entities with geographic geometry
//
// Geometry is NOT a primitive type — it's a record of numbers with angle units.
//   Coordinate = { lat: number (deg), lon: number (deg) }
//   Ring       = list<Coordinate>
//   Polygon    = list<Ring>       (first ring = exterior, rest = holes)
//   Geometry   = list<Polygon>    (MultiPolygon in GeoJSON terms)
//
// The typeclass declares which field holds the geometry and what kind it is.
// The field itself is a normal schema field (record/list of numbers).
// The geometry data is typically supplied via a FieldProvider binding, not
// baked into staticData (too large for countries, astronomical for cities).
//
//   typeclass Spatial a where
//     geometryField :: FieldRef      — stable identity of geometry field
//     geometryType  :: String        — "point" | "polygon" | "multipolygon"
//     centroidField :: FieldRef      — stable identity of center field
//
//   instance Spatial "country" where
//     geometryField = "<stable geometry FieldRef UUID>"
//     geometryType  = "multipolygon"
//     centroidField = "<stable centroid FieldRef UUID>"
// ---------------------------------------------------------------------------

export const spatial: Interface = {
  name: "Spatial",
  description:
    "Entity has geographic geometry — coordinates are numbers in angle/deg units. " +
    "Geometry data is typically virtual (supplied by a FieldProvider binding).",
  params: [{ name: "a" }],
  methods: [
    {
      name: "geometryField",
      description: "Stable FieldRef that identifies the geometry data",
      params: [],
      returns: { $ref: "FieldRef" },
    },
    {
      name: "geometryType",
      description: "Geometry kind: point, polygon, or multipolygon",
      params: [],
      returns: { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["point", "polygon", "multipolygon"] } } },
      body: "multipolygon",
    },
    {
      name: "centroidField",
      description: "Stable FieldRef for the center point (for quick map positioning)",
      params: [],
      returns: { $ref: "FieldRef" },
    },
  ],
  laws: [
    {
      name: "geometry-type-valid",
      description: "geometryType must be one of the known geometry kinds",
      forall: ["a"],
      property: {
        in: [{ var: "geometryType" }, ["point", "polygon", "multipolygon"]],
      },
    },
  ],
};

// Spatial instances are now Fenel-authored value-decls in
// fenel/modules/formats/instances.fenel (Phase 3.3b — curated family port).
// The `spatial` Interface above stays; only the instance moved to .fenel.

// ---------------------------------------------------------------------------
// DateFormat — date-string format parameterized by locale
//
//   typeclass DateFormat locale where
//     pattern   :: SetExpr   — the parser/validator (a $named to format:date:*)
//     template  :: String    — placeholder text, e.g. "mm/dd/yyyy"
//     order     :: [String]  — segment order: "year"|"month"|"day"
//     separator :: String    — "/", "-", "."
//     example   :: String    — sample value for UI placeholder/help text
//
// Locale is the resolution key. Most callers pass an IETF tag
// ("en-US", "fr", "de"); a synthetic "iso" instance is provided for the
// machine-readable fallback (yyyy-mm-dd).
//
// This is the typeclass-dictionary form: same date value, same record shape
// {year, month, day} — only the surface rendering differs by instance.
// ---------------------------------------------------------------------------

export const dateFormat: Interface = {
  name: "DateFormat",
  description:
    "Date string format — placeholder, separator, and segment order vary by locale",
  params: [{ name: "locale" }],
  methods: [
    {
      name: "pattern",
      description: "SetExpr that matches the date string for this locale",
      params: [],
      returns: { $ref: "SetExpr" },
    },
    {
      name: "template",
      description: "Placeholder template (mm/dd/yyyy, dd/mm/yyyy, ...)",
      params: [],
      returns: { $ref: "String" },
    },
    {
      name: "order",
      description: "Segment order: a 3-element list of \"year\"|\"month\"|\"day\"",
      params: [],
      returns: List({ $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["year", "month", "day"] } } }),
    },
    {
      name: "separator",
      description: "Separator character between segments",
      params: [],
      returns: { $ref: "String" },
    },
    {
      name: "example",
      description: "Sample value (e.g. \"12/25/2025\")",
      params: [],
      returns: { $ref: "String" },
      body: "",
    },
  ],
};

// DateFormat instances + the DATE_RULES table are now Fenel-bodied (Phase 3.3d):
// `fenel/modules/formats/factories.fenel:deriveDateFormatInstances` +
// `modules/formats.ts` (which also carries the `dateFormatFor` locale-fallback
// reader + the `dateSetExpr` pattern reader). The `dateFormat` Interface above
// stays. Date is NOT boot-registered — catalog/preset-only surface, unchanged.

// ---------------------------------------------------------------------------
// Aggregated exports
// ---------------------------------------------------------------------------

export const entityTypeclasses: Interface[] = [
  phoneFormat,
  addressFormat,
  handleFormat,
  exchangeRate,
  spatial,
  dateFormat,
];
