// ---------------------------------------------------------------------------
// notion-load.test.ts — conformance test for the notion module entity
// flip. The flip itself landed earlier (the file already sources its
// 54 entities from `fenel/modules/notion/types.fenel` via
// `loadFenelModule`); Phase 4e of the ts-elimination workstream closes
// the missing conformance gate so the post-flip invariants are locked
// the way 4a (license) / 4b (ai) / 4c (templates) lock theirs.
//
// Notion is the largest entity surface in any per-module flip — 54
// entities (12+ variants, 30+ records, 1 parametric `PaginatedList`).
// Lower per-entity granularity than 4a/4b/4c (entity-by-entity shape
// assertion is redundant with `fenel-syntax.test.ts` round-trip
// coverage), broader coverage: count + structural shape spot-checks +
// module registration + catalog surfacing + collision-avoidance.
//
// Each assertion covers one tier of the recipe:
//
//   1. 54-entity canonical-roster lock — count drift trips the gate.
//   2. Parent 4-case `$variant` spot-check — confirms positional `_0`
//      synthesis is not in play (every case has zero fields or named
//      fields), and that the variant survives stripEmpty unchanged.
//   3. PaginatedList parametric — single-ctor-matches-type collapses
//      to `$record`, type-var `a` threads through as `{$var: "a"}`
//      (the parser binds explicit declaration parameters; downstream `Maybe`
//      / `List` substitution at use time resolves them). First per-
//      module flip exercising parametric-record-with-type-var loading.
//   4. Filter self-ref preservation — AndFilter.filters parses as
//      `List({$ref: "Filter"})` unrolled, same load-order mechanism
//      as 4c's Markup self-refs.
//   5. `notionModule.entities` carries all 54 parsed entities — module
//      registration smoke.
//   6. Catalog surfacing post-`getSystemRegistry()` — Page / Database
//      / RichText / Filter reachable through the catalog. Phase 4e
//      added `notionModule` to the engine system registry alongside
//      the test (the runtime evaluator already included it; engine-
//      side was the gap).
//   7. Notion-prefix collision-avoidance audit — NotionUser /
//      NotionColor / NotionDate / NotionFile surface AND the bare
//      `User` / `File` (when present from another module like
//      telegram) resolve to distinct entries. The .fenel file
//      deliberately prefixes the shared-name shapes to avoid catalog
//      collision (type-catalog.ts:1056 silently keeps the first
//      registration on collision; the prefix is doing its job).
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import notionSrc from "../../../../../fenel/modules/notion/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, List, Nothing } from "../type-foundation";
import { notionModule } from "./notion";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const NOTION_MOD = loadFenelModule(notionSrc, "notion");

function rawEntity(id: string): FenelType {
  const entity = (NOTION_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`notion module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("notion/types.fenel parses to exactly 54 entities (canonical roster lock)", () => {
  // Count drift is intentional + loud: any future entity addition /
  // removal must bump the assertion and document the change. Same
  // pattern as system-entities-load's 91-entity roster lock.
  expect((NOTION_MOD.entities ?? []).length).toBe(54);
});

test("notion/types.fenel parses Parent to the expected 4-case $variant", () => {
  expect(rawEntity("Parent")).toEqual({
    $variant: {
      cases: [
        {
          name: "PageParent",
          label: Nothing,
          fields: [{ name: "pageId", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
        {
          name: "DatabaseParent",
          label: Nothing,
          fields: [{ name: "databaseId", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
        { name: "WorkspaceParent", label: Nothing },
        {
          name: "BlockParent",
          label: Nothing,
          fields: [{ name: "blockId", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
      ],
    },
  });
});

test("notion/types.fenel parses PaginatedList as a $record with parametric type-var", () => {
  // Single-ctor-matches-type collapses to $record (same sugar as
  // `Annotations = Annotations bold: …`). The type-var `a` parses as
  // `{$var: "a"}` (a declaration-bound source variable; downstream
  // `PaginatedList(a)` substitution at use
  // time resolves them in notion.ts's TS helper). Distinct from the
  // foundation-tier parametric atoms (List / Maybe / Result) which
  // emit through `substituteTypeVars` post-load.
  expect(rawEntity("PaginatedList")).toEqual({
    $record: {
      fields: [
        { name: "results", label: Nothing, type: List({ $var: "a" }), meta: {}, ui: Nothing },
        {
          name: "nextCursor",
          label: Nothing,
          type: {
            $variant: {
              cases: [
                { name: "Nothing", label: Nothing },
                {
                  name: "Just",
                  label: Nothing,
                  fields: [
                    {
                      name: "_0",
                      key: { $tag: "PositionalField", index: 0 },
                      label: Nothing,
                      type: { $ref: "String" },
                      meta: {},
                      ui: Nothing,
                    },
                  ],
                },
              ],
            },
          },
          meta: {},
          ui: Nothing,
        },
        { name: "hasMore", label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
      ],
    },
  });
});

test("Filter self-refs preserved unrolled as List({$ref: \"Filter\"})", () => {
  // Lazy-$ref resolution: the parser stores the self-ref as-is in
  // the case payload; the catalog walk does NOT unroll it through the
  // entity definition (would loop forever on the recursive case).
  // Same load-order mechanism as 4c's Markup self-refs — AndFilter
  // and OrFilter carry `filters: [Filter]` which parses to the
  // canonical `List({$ref: "Filter"})` shape.
  const filter = rawEntity("Filter") as {
    $variant: { cases: Array<{ name: string; fields?: Array<{ name: string; type: FenelType }> }> };
  };
  const andFilter = filter.$variant.cases.find((c) => c.name === "AndFilter")!;
  const orFilter = filter.$variant.cases.find((c) => c.name === "OrFilter")!;
  expect(andFilter.fields![0]!.type).toEqual(List({ $ref: "Filter" }));
  expect(orFilter.fields![0]!.type).toEqual(List({ $ref: "Filter" }));
});

test("notionModule.entities carries all 54 parsed entities", () => {
  // ids-via-toContain rather than strict-equality-by-index so the
  // test doesn't couple to author order in the .fenel file (matches
  // 4b/4c convention).
  const ids = (notionModule.entities ?? []).map((e) => e.id);
  expect(ids.length).toBe(54);
  for (const id of ["Page", "Database", "Block", "BlockContent", "RichText", "Filter", "PaginatedList", "NotionUser", "NotionColor", "Parent"]) {
    expect(ids).toContain(id);
  }
});

test("getSystemRegistry surfaces entity:Page / Database / RichText / Filter", () => {
  // Phase 4e added notionModule to system-registry.ts; pre-4e the
  // engine-side getSystemRegistry didn't include notion (only the
  // runtime evaluator did), so catalog lookups silently returned
  // undefined. Post-4e the engine-tier validation / dependent-type
  // path sees notion entities too.
  getSystemRegistry();
  for (const id of ["entity:Page", "entity:Database", "entity:RichText", "entity:Filter"]) {
    expect(getCatalogEntry(id)).toBeDefined();
  }
});

test("Notion-prefix collision-avoidance: NotionUser / NotionColor / NotionDate / NotionFile surface as distinct entries", () => {
  // The .fenel file deliberately prefixes shared-name shapes
  // (User / Color / Date / File) with `Notion*` to avoid catalog
  // collision with telegram (User / File) and other modules.
  // type-catalog.ts:1056 silently keeps the first registration on
  // collision; the prefix is doing its job — confirm the prefixed
  // entries surface AND any bare-name registrations from other
  // modules don't shadow them.
  getSystemRegistry();
  const notionUser = getCatalogEntry("entity:NotionUser");
  const notionColor = getCatalogEntry("entity:NotionColor");
  const notionDate = getCatalogEntry("entity:NotionDate");
  const notionFile = getCatalogEntry("entity:NotionFile");
  expect(notionUser).toBeDefined();
  expect(notionColor).toBeDefined();
  expect(notionDate).toBeDefined();
  expect(notionFile).toBeDefined();
  // Bare names may or may not surface (telegram registers User /
  // File; nothing currently registers bare Color / Date). When they
  // do, they must be distinct objects — the catalog silently keeps
  // the first registration, so identity inequality is the load-bearing
  // assertion (not which module owns the bare name).
  const bareUser = getCatalogEntry("entity:User");
  const bareFile = getCatalogEntry("entity:File");
  if (bareUser) expect(bareUser).not.toBe(notionUser);
  if (bareFile) expect(bareFile).not.toBe(notionFile);
});
