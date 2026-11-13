// ---------------------------------------------------------------------------
// games-load.test.ts — conformance test for the games module entity flip.
// Phase 4g of the ts-elimination workstream extracts the inline
// `GAMES_SRC` template literal at engine/src/modules/games.ts (3 LOC,
// 1 entity, no inline functions) into a real `.fenel` file at
// `fenel/modules/games/types.fenel`.
//
// Games is the smallest module in 4g — declares only the `Game` record
// entity. All closure-construction helpers (`mkGame`, `gameToAnim`,
// `gameToMovie`, `runGame`, `gameStateAt`) live on the TS-native side
// because they touch representations records can't construct directly
// in source today. The conformance gate therefore drops the function-
// presence assertion and keeps roster + shape + module-tier total +
// catalog surfacing.
//
// Each assertion covers one tier of the recipe:
//
//   1. 1-entity roster lock — Game only.
//   2. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (1 + 6 = 6 natives + 0 user-Fenel).
//   3. Catalog surfacing post-`getSystemRegistry()` — Game reachable
//      through the catalog.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import gamesSrc from "../../../../../fenel/modules/games/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { gamesModule } from "./games";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";

const GAMES_MOD = loadFenelModule(gamesSrc, "games");

test("games/types.fenel parses to exactly 1 entity (canonical roster lock)", () => {
  expect((GAMES_MOD.entities ?? []).length).toBe(1);
  const ids = (GAMES_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Game");
});

test("gamesModule carries 1 entity + 6 functions (all native)", () => {
  expect((gamesModule.entities ?? []).length).toBe(1);
  expect((gamesModule.functions ?? []).length).toBe(6);
});

test("getSystemRegistry surfaces entity:Game", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:Game")).toBeDefined();
});
