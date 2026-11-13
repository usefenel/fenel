// ---------------------------------------------------------------------------
// sound-load.test.ts — conformance test for the sound module entity +
// inline-function-body flip. Phase 4g of the ts-elimination workstream
// extracts the inline `SOUND_SRC` template literal at
// engine/src/modules/sound.ts (75 LOC, 2 entities + 16 user-Fenel
// functions) into a real `.fenel` file at `fenel/modules/sound/types.fenel`.
//
// Sound is the most function-heavy module in 4g — 16 inline closures
// (sineAt / sawAt / squareAt / sine / sawtooth / square / scaleAmp /
// addAmp / gain / mix / delay / pitch / midiToFreq / note / bound /
// plucked) plus 8 TS natives. Sound also declares the canonical `Time`
// entity that animation / movie / events / games / track all
// $ref-reference; sound MUST load before those modules in
// SYSTEM_MODULES order (verified by registry test against catalog).
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity roster lock — Sound + Time.
//   2. Sound variant shape — Buffer | Wave cases.
//   3. Function-presence smoke — every inline closure surfaces with a
//      body, NOT as a native. 16 functions verified.
//   4. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (2 + 24 = 8 natives + 16 user-Fenel).
//   5. Catalog surfacing post-`getSystemRegistry()` — Sound + Time
//      reachable through the catalog.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import soundSrc from "../../../../../fenel/modules/sound/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields } from "../type-foundation";
import { soundModule } from "./sound";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const SOUND_MOD = loadFenelModule(soundSrc, "sound");

function rawEntity(id: string): FenelType {
  const entity = (SOUND_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`sound module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("sound/types.fenel parses to exactly 2 entities (canonical roster lock)", () => {
  expect((SOUND_MOD.entities ?? []).length).toBe(2);
  const ids = (SOUND_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Sound");
  expect(ids).toContain("Time");
});

test("sound/types.fenel parses Sound as Buffer | Wave variant", () => {
  const snd = rawEntity("Sound") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(snd.$variant.cases.map((c) => c.name)).toEqual(["Buffer", "Wave"]);
});

test("inline closures (16 user-Fenel functions) surface in soundModule.functions", () => {
  // The largest function extract in 4g — 16 inline closures move from
  // a JS template literal into a `.fenel` file. Each must surface as
  // a Fenel-bodied function (not a TS native) after the `\\t` → `\t`
  // lambda escape conversion.
  const fnIds = new Set((SOUND_MOD.functions ?? []).map((f) => f.id));
  for (const codeName of [
    "sineAt", "sawAt", "squareAt",
    "sine", "sawtooth", "square",
    "scaleAmp", "addAmp",
    "gain", "mix", "delay", "pitch",
    "midiToFreq", "note", "bound", "plucked",
  ]) {
    expect(fnIds).toContain(`sound:${codeName}`);
    const fn = (SOUND_MOD.functions ?? []).find((f) => f.id === `sound:${codeName}`)!;
    expect(fn.body).toBeDefined();
  }
});

test("soundModule carries 2 entities + 24 functions (8 native + 16 user-Fenel)", () => {
  expect((soundModule.entities ?? []).length).toBe(2);
  expect((soundModule.functions ?? []).length).toBe(24);
});

test("getSystemRegistry surfaces entity:Sound / entity:Time", () => {
  // Sound's `Time` entity is the canonical declaration used by
  // animation / movie / events / games / track — confirm catalog
  // surfacing so cross-module $ref refs resolve.
  getSystemRegistry();
  expect(getCatalogEntry("entity:Sound")).toBeDefined();
  expect(getCatalogEntry("entity:Time")).toBeDefined();
});
