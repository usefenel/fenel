// ---------------------------------------------------------------------------
// module-entity.test.ts — module-substrate Phase 1 conformance.
//
// `Module` + `Ref` are registered as first-class Fenel foundation entity types
// (source of truth: `fenel/modules/core/module.fenel`). This phase is ADDITIVE
// — it proves the `Name → Ref` view (`Module.members : Map String Ref`)
// constructs and round-trips, with no parser / resolver / migration change.
//
// Three blocks (mirroring the Phase-1 brief's test plan):
//   (i)   both types are registered + catalog-visible + carry identity.
//   (ii)  a Module value with ≥2 `members` entries constructs and round-trips.
//   (iii) the registered Module type is a `$record` whose `members` field is a
//         `$map` with String-ish keys + Ref values; Ref ≡ {$ref: "Id"}.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { systemEntities } from "./system-entities";
import { getCatalogEntry } from "./type-catalog";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { FenelType } from "./types";

const entityById = (id: string) => systemEntities.find((e) => e.id === id);

/** The Module entity's `$record` field list (throws if the shape regressed —
 *  the round-trip test below derives its constructor field-table from this, so
 *  the construct path stays tied to the registered type). */
function moduleFields(): Array<{ name: string; type: FenelType }> {
  const t = entityById("Module")?.type;
  if (!t || !("$record" in t)) {
    throw new Error("Module entity is not a $record");
  }
  return (t as { $record: { fields: Array<{ name: string; type: FenelType }> } }).$record.fields;
}

// (i) — registration + catalog surfacing + identity ------------------------

test("Module + Ref are registered as system entities", () => {
  expect(entityById("Module")).toBeDefined();
  expect(entityById("Ref")).toBeDefined();
});

test("Module + Ref surface in the type catalog with identity", () => {
  const moduleEntry = getCatalogEntry("entity:Module");
  const refEntry = getCatalogEntry("entity:Ref");
  expect(moduleEntry).toBeDefined();
  expect(refEntry).toBeDefined();
  // `name` comes from the Labelable instance defineSystemEntity registered
  // (falls back to id only when no label) — proves identity rode on the
  // instance registry, not a struct field.
  expect(moduleEntry!.name).toBe("Module");
  expect(refEntry!.name).toBe("Ref");
  expect(moduleEntry!.category).toBe("entity");
});

// (iii) — registered type shape --------------------------------------------

test("Module is a $record whose `members` field is a Map String Ref", () => {
  const t = entityById("Module")!.type!;
  expect("$record" in t).toBe(true);

  const fields = moduleFields();
  // Identity is nominal (Codeable/Labelable keyed by id), so `members` is the
  // ONLY struct field — no name/label/description/parent fields (the design
  // explicitly rejects structure-as-identity).
  expect(fields.map((f) => f.name)).toEqual(["members"]);

  const members = fields[0]!;
  expect("$map" in members.type).toBe(true);
  const map = (members.type as Extract<FenelType, { $map: unknown }>).$map;
  // Map keys are SetExpr values: the parser lifts `Map String Ref` to the
  // canonical `SeRef("String")` key constraint (`Str` retired → `String`).
  expect(map.keys).toEqual({ $tag: "SeRef", handle: "String" });
  // Values are Ref (the Name → Ref view) — `{$ref:"Ref"}`.
  expect(map.values).toEqual({ $ref: "Ref" } as never);
});

test("Ref ≡ {$ref: \"Id\"} (nominal token, no phantom)", () => {
  // Path (b): the parser has no non-opaque type-alias surface, so Ref's
  // structural type is the bare Id reference. A Ref spans all definition kinds
  // → deliberately NOT a $tagged Id<X> phantom (that's typed-function-references).
  expect(entityById("Ref")!.type).toEqual({ $ref: "Id" });
});

// (ii) — construct + round-trip --------------------------------------------

test("a Module value with 2 members constructs and round-trips", () => {
  // Drive the canonical `construct` op, deriving the constructor field-table
  // from the REGISTERED Module type (so the round-trip is tied to the
  // registration, not a hand-typed field name). Refs are codeName-string ids
  // — the OQ2 "ids are codeName strings" model — pointing at two std fns.
  const fieldNames = moduleFields().map((f) => f.name); // ["members"]
  const ctx: EvaluateContext = { _constructors: { Module: fieldNames } };

  const built = evaluate(
    { construct: ["Module", { members: { sort: "std:sort", filter: "std:filter" } }] },
    {},
    ctx,
  ) as { $tag: string; members: Record<string, string> };

  // Tagged with its type identity (the construct op stamps $tag).
  expect(built.$tag).toBe("Module");
  // The Name → Ref view round-trips: each name reads its Ref back.
  expect(Object.keys(built.members).sort()).toEqual(["filter", "sort"]);
  expect(built.members.sort).toBe("std:sort");
  expect(built.members.filter).toBe("std:filter");
});
