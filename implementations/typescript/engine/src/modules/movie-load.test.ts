// ---------------------------------------------------------------------------
// movie-load.test.ts — conformance test for the movie module entity +
// inline-function-body flip. Phase 4g of the ts-elimination workstream
// extracts the inline `MOVIE_SRC` template literal at
// engine/src/modules/movie.ts (21 LOC, 3 entities + 2 user-Fenel
// functions) into a real `.fenel` file at `fenel/modules/movie/types.fenel`.
//
// Movie is the only module in 4g with three entities, including the
// multi-line-declared `RecordedMovie` record (5 fields spread across
// indented lines). The two inline closures (withAudio / silentMovie)
// reference cross-module entities (`Animation` / `Sound` / `Amplitude`
// from sound + animation, which load before movie).
//
// Signature-substrate Phase 2 closes the old parser limitation: indented
// named fields now continue `RecordedMovie` instead of disappearing as stray
// signature-shaped lines. This suite locks both the historical single-line
// Scene control and the five-field multiline record.
//
// Each assertion covers one tier of the recipe:
//
//   1. 3-entity roster lock — Movie / Scene / RecordedMovie.
//   2. Movie variant shape — Recorded | MovieAt cases.
//   3. Scene single-line record parses with both fields — confirms
//      single-line record parsing (the canonical record shape).
//   4. RecordedMovie multiline record — all five ordered fields survive.
//   5. Function-presence smoke — withAudio / silentMovie surface as
//      user-Fenel functions.
//   6. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (3 + 5 = 3 natives + 2 user-Fenel).
//   7. Catalog surfacing post-`getSystemRegistry()` — Movie / Scene /
//      RecordedMovie.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import movieSrc from "../../../../../fenel/modules/movie/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields } from "../type-foundation";
import { movieModule } from "./movie";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const MOVIE_MOD = loadFenelModule(movieSrc, "movie");

function rawEntity(id: string): FenelType {
  const entity = (MOVIE_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`movie module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("movie/types.fenel parses to exactly 3 entities (canonical roster lock)", () => {
  expect((MOVIE_MOD.entities ?? []).length).toBe(3);
  const ids = (MOVIE_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Movie");
  expect(ids).toContain("Scene");
  expect(ids).toContain("RecordedMovie");
});

test("movie/types.fenel parses Movie as Recorded | MovieAt variant", () => {
  const movie = rawEntity("Movie") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(movie.$variant.cases.map((c) => c.name)).toEqual(["Recorded", "MovieAt"]);
});

test("Scene single-line record parses with visual + audio fields", () => {
  // Canonical single-line record form — both fields on the same line as the
  // constructor name. This remains the byte-stable control for the layout fix.
  const scene = rawEntity("Scene") as {
    $record: { fields: Array<{ name: string; type: { $ref: string } }> };
  };
  expect(scene.$record.fields.map((f) => f.name)).toEqual(["visual", "audio"]);
  expect(scene.$record.fields[0]!.type).toEqual({ $ref: "Picture" });
  expect(scene.$record.fields[1]!.type).toEqual({ $ref: "Amplitude" });
});

test("RecordedMovie multiline record preserves all five ordered fields", () => {
  const recorded = rawEntity("RecordedMovie") as {
    $record: { fields: Array<{ name: string }> };
  };
  expect(recorded.$record.fields.map((field) => field.name)).toEqual([
    "fps",
    "width",
    "height",
    "frames",
    "audio",
  ]);
});

test("inline closures (withAudio / silentMovie) surface as user-Fenel functions", () => {
  const fnIds = new Set((MOVIE_MOD.functions ?? []).map((f) => f.id));
  expect(fnIds).toContain("movie:withAudio");
  expect(fnIds).toContain("movie:silentMovie");
  for (const fnId of ["movie:withAudio", "movie:silentMovie"]) {
    const fn = (MOVIE_MOD.functions ?? []).find((f) => f.id === fnId)!;
    expect(fn.body).toBeDefined();
  }
});

test("movieModule carries 3 entities + 5 functions (3 native + 2 user-Fenel)", () => {
  expect((movieModule.entities ?? []).length).toBe(3);
  expect((movieModule.functions ?? []).length).toBe(5);
});

test("getSystemRegistry surfaces entity:Movie / entity:Scene / entity:RecordedMovie", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:Movie")).toBeDefined();
  expect(getCatalogEntry("entity:Scene")).toBeDefined();
  expect(getCatalogEntry("entity:RecordedMovie")).toBeDefined();
});
