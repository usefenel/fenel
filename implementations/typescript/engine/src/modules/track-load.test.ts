// ---------------------------------------------------------------------------
// track-load.test.ts — conformance test for the track module entity flip.
// Phase 4g of the ts-elimination workstream extracts the inline
// `TRACK_SRC` template literal at engine/src/modules/track.ts (5 LOC,
// 2 entities, no inline functions) into a real `.fenel` file at
// `fenel/modules/track/types.fenel`.
//
// Track has no inline user-Fenel functions — all helpers (`sampleTrackAt`,
// `mixDown`, `track`, `trackEntry`) are TS natives. The conformance
// gate drops the function-presence assertion (same as games-load) and
// keeps roster + shape + module-tier total + catalog surfacing.
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity roster lock — TrackEntry / Track.
//   2. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (2 + 4 = 4 natives + 0 user-Fenel).
//   3. Catalog surfacing post-`getSystemRegistry()` — TrackEntry and
//      Track reachable through the catalog.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import trackSrc from "../../../../../fenel/modules/track/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { trackModule } from "./track";
import { soundModule } from "./sound";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";

const TRACK_MOD = loadFenelModule(trackSrc, "track");

test("track/types.fenel parses to exactly 2 entities (canonical roster lock)", () => {
  expect((TRACK_MOD.entities ?? []).length).toBe(2);
  const ids = (TRACK_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("TrackEntry");
  expect(ids).toContain("Track");
});

test("trackModule carries 2 entities + 4 functions (all native)", () => {
  expect((trackModule.entities ?? []).length).toBe(2);
  expect((trackModule.functions ?? []).length).toBe(4);
});

test("getSystemRegistry surfaces entity:TrackEntry / entity:Track", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:TrackEntry")).toBeDefined();
  expect(getCatalogEntry("entity:Track")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Phase 5b11 — track + trackEntry pure-constructor port assertions.
// module-substrate Phase 3g — track / trackEntry CONSOLIDATED from the retired
// `track.fenel` / `track-entry.fenel` sidecars into `types.fenel` (recipe N6).
// The bodies + dispatch contract are unchanged; only the source FILE moved.
// ---------------------------------------------------------------------------

test("3g: track / trackEntry are single bodied functions in types.fenel (post-consolidation)", () => {
  const trackFns = (TRACK_MOD.functions ?? []).filter((f) => f.id === "track:track");
  const entryFns = (TRACK_MOD.functions ?? []).filter((f) => f.id === "track:trackEntry");
  expect(trackFns.length).toBe(1);
  expect(entryFns.length).toBe(1);
  expect(trackFns[0]!.body).toBeDefined();
  expect(entryFns[0]!.body).toBeDefined();
});

test("3g: track:track + track:trackEntry bodies LOADED FROM types.fenel (consolidated); not natives", () => {
  const fns = trackModule.functions ?? [];
  const trackFn = fns.find((f) => f.id === "track:track")!;
  const entryFn = fns.find((f) => f.id === "track:trackEntry")!;
  expect(trackFn.body).toBeDefined();
  expect(entryFn.body).toBeDefined();
  expect(trackFn.body).toEqual({
    construct: ["Track", { entries: { var: "entries" } }],
  });
  expect(entryFn.body).toEqual({
    construct: [
      "TrackEntry",
      { start: { var: "start" }, sound: { var: "sound" } },
    ],
  });
  const natives = (trackModule.nativeImpls ?? {}) as Record<string, unknown>;
  expect(natives["track:track"]).toBeUndefined();
  expect(natives["track:trackEntry"]).toBeUndefined();
});

test("5b11: semantic regression smoke — track + trackEntry dispatch through Fenel bodies (tagged shapes)", () => {
  const reg = createRegistry([soundModule, trackModule]);
  const ctx = reg.evaluateContext();
  expect(evaluate({ call: ["track", []] }, {}, ctx)).toEqual({
    $tag: "Track",
    entries: [],
  });
  const e1 = evaluate({ call: ["trackEntry", 0, { $tag: "Wave" }] }, {}, ctx);
  const e2 = evaluate({ call: ["trackEntry", 1, { $tag: "Wave" }] }, {}, ctx);
  expect(evaluate({ call: ["track", [e1, e2]] }, {}, ctx)).toEqual({
    $tag: "Track",
    entries: [
      { $tag: "TrackEntry", start: 0, sound: { $tag: "Wave" } },
      { $tag: "TrackEntry", start: 1, sound: { $tag: "Wave" } },
    ],
  });
});
