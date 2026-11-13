// ---------------------------------------------------------------------------
// Place — tree-hierarchical type via $tagged-phantom dependent typing.
//
// Phase 4 of field-meta-collapse — retires the `meta.refGeoResolution`
// sidecar by lifting the precision level into the field's type. Mirrors
// The same tagged-phantom construction used by typed unit scalars.
//
// `Place : GeoLevel -> Type` encodes a geo-located value at a specific
// precision level. The phantom carries the GeoLevel constructor (depth-
// as-type-level fact); the value-side `GeoPath` record carries the
// runtime path (path-as-value). Lattice ops (compareLevel / validateGeoPath
// / truncateToLevel) live on the `Resolvable` typeclass keyed by the
// phantom level. See `design/tree-hierarchical-types.md` for the
// encoding rationale + the 5-criteria evaluation matrix that picked
// `$tagged`-phantom over variant-per-level / record-with-invariant /
// `$tree` first-class constructor.
//
// The recipe generalizes verbatim to any tree-hierarchical type
// (taxonomy, org chart, Dewey decimal, biological classification):
// register a level ADT + a path record + a `Resolvable` instance set.
// ---------------------------------------------------------------------------

import type { FenelType } from "./types";
// 3b-2 — route SetExpr producer through buildSetExpr
import { buildSetExpr } from "./set-marker";

// ---------------------------------------------------------------------------
// GeoLevel ADT — the level discriminator carried in the phantom.
//
// Six canonical levels mirroring the editor's `GEO_RESOLUTION_LEVELS`
// constant (`field-editor/index.tsx:16`). The TS-side type is the
// disjoint union of `{$tag: "Country"}` … `{$tag: "Address"}`; the
// PascalCase tags match the GeoLevel ADT registered as a system
// entity in `system-entities.ts`. User-defined extensions (county,
// prefecture, canton, oblast) are an open question deferred to a
// Phase 4 follow-up — the recipe ships with the 6 canonical levels.
// ---------------------------------------------------------------------------

export type GeoLevel =
  | { $tag: "GeoCountry" }
  | { $tag: "GeoRegion" }
  | { $tag: "GeoCity" }
  | { $tag: "GeoPostalCode" }
  | { $tag: "GeoStreet" }
  | { $tag: "GeoAddress" };

/** GeoLevel constructor — typed tag value as Fenel sees it. The TS
 *  `$tag` is prefixed `Geo*` to avoid collision with other system
 *  constructors that share unprefixed names (e.g. email's `Address`
 *  record). User-facing display labels strip the `Geo` prefix — see
 *  `system-entities.ts:GeoLevel`'s `label:` overrides. */
export const Country: GeoLevel = { $tag: "GeoCountry" };
export const Region: GeoLevel = { $tag: "GeoRegion" };
export const City: GeoLevel = { $tag: "GeoCity" };
export const PostalCode: GeoLevel = { $tag: "GeoPostalCode" };
export const Street: GeoLevel = { $tag: "GeoStreet" };
export const Address: GeoLevel = { $tag: "GeoAddress" };

/** Canonical ordered list of GeoLevel constructors, coarse → fine.
 *  Source of truth for depth ordering — `Resolvable` instance bodies
 *  + the editor's level dropdown both consult this. */
export const geoLevelOrder: GeoLevel[] = [
  Country,
  Region,
  City,
  PostalCode,
  Street,
  Address,
];

/** Depth index of a GeoLevel constructor in the canonical order.
 *  Returns -1 if the tag isn't a recognized GeoLevel. Used by the
 *  Resolvable typeclass's compareLevel + truncateToLevel methods +
 *  the editor's read/write path. */
export function geoLevelDepth(lvl: GeoLevel): number {
  return geoLevelOrder.findIndex((l) => l.$tag === lvl.$tag);
}

/** Display label for a GeoLevel constructor — strips the `Geo` prefix
 *  used internally for namespace isolation. Country / Region / City /
 *  PostalCode → "Postal Code" / Street / Address. */
export function geoLevelLabel(lvl: GeoLevel): string {
  switch (lvl.$tag) {
    case "GeoCountry": return "Country";
    case "GeoRegion": return "Region";
    case "GeoCity": return "City";
    case "GeoPostalCode": return "Postal Code";
    case "GeoStreet": return "Street";
    case "GeoAddress": return "Address";
  }
}

/** Canonical mapping of editor-string-cased levels (`"city"`,
 *  `"postal_code"`) to typed GeoLevel constructors. Boundary helper
 *  for migrating the editor's `f.geoResolution` draft strings into
 *  the typed ADT carried in the phantom. */
export function taggedLevelFromDraftString(s: string): GeoLevel | null {
  switch (s) {
    case "country": return Country;
    case "region": return Region;
    case "city": return City;
    case "postal_code": return PostalCode;
    case "street": return Street;
    case "address": return Address;
    default: return null;
  }
}

/** Inverse of `taggedLevelFromDraftString` — typed GeoLevel constructor
 *  to editor's draft-string form. */
export function draftStringFromTaggedLevel(lvl: GeoLevel): string {
  switch (lvl.$tag) {
    case "GeoCountry": return "country";
    case "GeoRegion": return "region";
    case "GeoCity": return "city";
    case "GeoPostalCode": return "postal_code";
    case "GeoStreet": return "street";
    case "GeoAddress": return "address";
  }
}

// ---------------------------------------------------------------------------
// Place : GeoLevel -> Type — dependent constructor encoding a geo-located
// value at a specific precision level.
//
// Same $tagged-phantom shape as `measureType : MeasureExpr -> Type`,
// with two swaps:
//   - value: $named "Number" → $named "GeoPath"
//   - phantom domain: MeasureExpr → GeoLevel
//
// `Place Country ≢ Place City` at the type level — the phantom holds
// the GeoLevel constructor literally (`{$tag: "City"}`), and `$enum`'s
// `unknown[]` typing (types.ts:125) accepts the typed tag value
// directly (same substrate permissiveness Phase 3 exploited for
// typed MeasureExpr values).
//
// Disambiguator triplet (post-Phase-4) for `$tagged.value.$named`:
//   "Id"      → entity reference (Id<EntityType>)
//   "Number"  → unit-tagged number (Phase 3 — Q)
//   "GeoPath" → tree-hierarchical place (this phase)
//
// Every `$tagged` consumer (widget-hint / json-schema /
// entity-def-printer / field-editor / field-renderer) reads the
// inner `.value.$named` and dispatches accordingly.
//
// Example:
//   Place(City)        ≡ a value precise to city level
//   Place(Country)     ≡ country-only precision (effectively a country picker)
//   Place(Address)     ≡ full-street-address precision
// ---------------------------------------------------------------------------

export function Place(level: GeoLevel): FenelType {
  return {
    $tagged: {
      value: { $ref: "GeoPath" },
      phantom: {
        $refined: {
          base: { $ref: "GeoLevel" },
          set: buildSetExpr.enum([level as unknown]),
        },
      },
    },
  };
}
