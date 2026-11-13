// ---------------------------------------------------------------------------
// picture-load.test.ts — conformance test for the picture module entity +
// inline-function-body flip. Phase 4g of the ts-elimination workstream
// extracts the inline `PICTURE_SRC` template literal at
// engine/src/modules/picture.ts (62 LOC, 2 entities + 12 user-Fenel
// functions) into a real `.fenel` file at
// `fenel/modules/picture/types.fenel`.
//
// Picture has the second-most function-heavy extract in 4g — 12 inline
// closures (solid / circle / over / dist / rectangle / ellipse /
// linearGradient / radialGradient / checkerboard / inBox / lerpColor /
// clamp01) plus 5 TS natives. Several closures wrap their body across
// multiple lines (ellipse / checkerboard / lerpColor) — exercises the
// parser's continuation rules for paren-grouped expressions.
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity roster lock — Picture + Point.
//   2. Picture variant shape — Raster | Field cases.
//   3. Function-presence smoke — every inline closure surfaces with a
//      body. 12 functions verified, including the multi-line ones.
//   4. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (2 + 17 = 5 natives + 12 user-Fenel).
//   5. Catalog surfacing post-`getSystemRegistry()` — Picture + Point.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import pictureSrc from "../../../../../fenel/modules/picture/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields } from "../type-foundation";
import { pictureModule } from "./picture";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const PICTURE_MOD = loadFenelModule(pictureSrc, "picture");

function rawEntity(id: string): FenelType {
  const entity = (PICTURE_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`picture module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("picture/types.fenel parses to exactly 2 entities (canonical roster lock)", () => {
  expect((PICTURE_MOD.entities ?? []).length).toBe(2);
  const ids = (PICTURE_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Picture");
  expect(ids).toContain("Point");
});

test("picture/types.fenel parses Picture as Raster | Field variant", () => {
  const pic = rawEntity("Picture") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(pic.$variant.cases.map((c) => c.name)).toEqual(["Raster", "Field"]);
});

test("inline closures (12 user-Fenel functions) surface in pictureModule.functions", () => {
  // Picture's 12 inline closures include several multi-line bodies
  // (ellipse / checkerboard / lerpColor) that exercise the parser's
  // paren-grouped expression continuation rules. Every closure must
  // surface as a Fenel-bodied function post-flip.
  const fnIds = new Set((PICTURE_MOD.functions ?? []).map((f) => f.id));
  for (const codeName of [
    "solid", "circle", "over", "dist",
    "rectangle", "ellipse",
    "linearGradient", "radialGradient",
    "checkerboard", "inBox",
    "lerpColor", "clamp01",
  ]) {
    expect(fnIds).toContain(`picture:${codeName}`);
    const fn = (PICTURE_MOD.functions ?? []).find((f) => f.id === `picture:${codeName}`)!;
    expect(fn.body).toBeDefined();
  }
});

test("pictureModule carries 2 entities + 20 functions (3 bodyless native + 17 bodied — effect-visibility Phase 4 bodied sample/render + 3 helpers)", () => {
  expect((pictureModule.entities ?? []).length).toBe(2);
  expect((pictureModule.functions ?? []).length).toBe(20);
});

test("getSystemRegistry surfaces entity:Picture / entity:Point", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:Picture")).toBeDefined();
  expect(getCatalogEntry("entity:Point")).toBeDefined();
});
