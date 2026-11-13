// ---------------------------------------------------------------------------
// time-load.test.ts — conformance test for the time module entity +
// inline-function flip + Phase 5b2 pure-helper port (timestamp /
// duration to Fenel bodies).
//
// Phase 5a extracted the inline `TIME_SRC` template literal at
// engine/src/modules/time.ts (~30 LOC, 2 entities + 8 user-Fenel
// functions) into a real `.fenel` file at `fenel/modules/time/types.fenel`.
// The pre-existing `parse-iso-timestamp.fenel` body file (separate
// function-body file loaded as its own module by time.ts) was unaffected
// by 5a.
//
// Phase 5b2 ports the 2 remaining pure record-constructor TS natives
// (`timestampNative` / `durationNative`) to dedicated `.fenel` bodies
// (timestamp.fenel / duration.fenel) and drops the natives. `now` /
// `hostDateParse` / `formatIsoTimestamp` stay TS-native — each is an
// IO leaf or host-class dependency.
//
// Time is the densest function-per-entity module in the 5a sweep — 8
// inline functions over 2 entities cover the canonical timestamp/duration
// arithmetic (addDuration / diffTimestamps / before / after) and the
// duration constructors (seconds / minutes / hours / days).
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity roster lock — Timestamp + Duration.
//   2. Timestamp + Duration record shapes — both single-field records
//      (epochMs: Number / ms: Number).
//   3. 8-inline-function presence smoke — addDuration / diffTimestamps /
//      before / after / seconds / minutes / hours / days surface as
//      user-Fenel functions in timeModule.functions with bodies.
//   4. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (2 entities + 14 functions = 6
//      defineFunction specs + 8 user-Fenel; the defineFunction specs
//      include parseIsoTimestamp / timestamp / duration whose bodies
//      live in separate `.fenel` files).
//   5. Catalog surfacing post-`getSystemRegistry()` — entity:Timestamp +
//      entity:Duration reachable through the catalog. timeModule is in
//      SYSTEM_MODULES (system-registry.ts:58), so catalog lookups
//      resolve.
//   6. Phase 5b2 — `time:timestamp` + `time:duration` carry Fenel
//      bodies post-flip (replacing the TS natives); `time:now` /
//      `time:hostDateParse` / `time:formatIsoTimestamp` stay TS-
//      native (IO-leaf exclusion lock).
//   7. Phase 5b2 — semantic regression smoke covering the brief's
//      3 fixtures: timestamp(1717000000000), duration(86400000),
//      and the cross-Fenel-body round-trip
//      `addDuration(timestamp(0), duration(1000))`.
// ---------------------------------------------------------------------------

// module-substrate Phase 3b (2026-05-30) — the four pre-migration `.fenel`
// files (types / timestamp / duration / parse-iso-timestamp) consolidated into
// `fenel/modules/time/time.fenel` (one `module time where` file). This test now
// loads that file; `TIME_MOD` additionally carries the 4 `@native` foreign
// declarations (now / hostDateParse / formatIsoTimestamp / nowIso) it didn't
// see when this loaded only `types.fenel` — its assertions below (2 entities,
// the 8 inline helpers, the 15-function module total) are unaffected. The
// full FFI-split + identity parity proof lives in `module-migrate-time.test.ts`.
import { test, expect } from "bun:test";
import timeSrc from "../../../../../fenel/modules/time/time.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { timeModule } from "./time";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";
import { Nothing } from "../type-foundation";
const TIME_MOD = loadFenelModule(timeSrc, "time");

test("time/time.fenel parses to exactly 2 entities (Timestamp + Duration)", () => {
  expect((TIME_MOD.entities ?? []).length).toBe(2);
  const ids = (TIME_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toEqual(["Timestamp", "Duration"]);
});

test("Timestamp + Duration parse as single-field records", () => {
  const timestamp = (TIME_MOD.entities ?? []).find((e) => e.id === "Timestamp");
  const duration = (TIME_MOD.entities ?? []).find((e) => e.id === "Duration");
  expect(timestamp).toBeDefined();
  expect(duration).toBeDefined();
  expect(timestamp!.type).toEqual({
    $record: { fields: [{ name: "epochMs", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
  } as FenelType);
  expect(duration!.type).toEqual({
    $record: { fields: [{ name: "ms", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
  } as FenelType);
});

test("8 inline functions surface as user-Fenel functions with bodies", () => {
  // All 8 declared in the SRC body — pure arithmetic over the two
  // entities. Bodies parse to JSON Logic via the layout-based block
  // syntax (single-statement bodies all fit on one line).
  const fnIds = new Set((TIME_MOD.functions ?? []).map((f) => f.id));
  for (const id of [
    "time:addDuration", "time:diffTimestamps", "time:before", "time:after",
    "time:seconds", "time:minutes", "time:hours", "time:days",
  ]) {
    expect(fnIds).toContain(id);
    const fn = (TIME_MOD.functions ?? []).find((f) => f.id === id)!;
    expect(fn.body).toBeDefined();
  }
});

test("timeModule carries 2 entities + 15 functions (7 defineFunction + 8 user-Fenel)", () => {
  expect((timeModule.entities ?? []).length).toBe(2);
  // defineFunction specs: now / timestamp / duration / hostDateParse /
  // parseIsoTimestamp / formatIsoTimestamp / nowIso = 7 (3 carry Fenel
  // bodies post-5b2 — parseIsoTimestamp from 5a, timestamp + duration
  // from 5b2; the other 4 stay TS-native, with nowIso added in Phase 12d
  // sub-step 3 for the inventory reserve/release timestamp lifts). User-
  // Fenel SRC: 8. Total: 15.
  expect((timeModule.functions ?? []).length).toBe(15);
});

test("getSystemRegistry surfaces entity:Timestamp / entity:Duration", () => {
  // timeModule is in SYSTEM_MODULES (system-registry.ts:58); catalog
  // lookups resolve both entities post-flip.
  getSystemRegistry();
  expect(getCatalogEntry("entity:Timestamp")).toBeDefined();
  expect(getCatalogEntry("entity:Duration")).toBeDefined();
});

test("Phase 5b2 — time:timestamp + time:duration carry Fenel bodies; now / hostDateParse / formatIsoTimestamp stay TS-native", () => {
  // Phase 5b2 replaces the TS natives `timestampNative` /
  // `durationNative` with Fenel bodies in dedicated `.fenel` files
  // (timestamp.fenel / duration.fenel). The body-slot wiring on the
  // `defineFunction` specs picks the loaded body up so the spec is
  // executable through the engine evaluator. `time:now` /
  // `time:hostDateParse` / `time:formatIsoTimestamp` remain TS-
  // native — each is an IO leaf or host-class dependency — so this
  // test explicitly excludes them via body=undefined assertions.
  const ts = (timeModule.functions ?? []).find((f) => f.id === "time:timestamp");
  const dur = (timeModule.functions ?? []).find((f) => f.id === "time:duration");
  const now = (timeModule.functions ?? []).find((f) => f.id === "time:now");
  const hostDate = (timeModule.functions ?? []).find((f) => f.id === "time:hostDateParse");
  const fmt = (timeModule.functions ?? []).find((f) => f.id === "time:formatIsoTimestamp");
  expect(ts).toBeDefined();
  expect(dur).toBeDefined();
  expect(now).toBeDefined();
  expect(hostDate).toBeDefined();
  expect(fmt).toBeDefined();
  expect(ts!.body).toBeDefined();
  expect(dur!.body).toBeDefined();
  // IO leaves / host-class deps stay TS-native — no Fenel body.
  expect(now!.body).toBeUndefined();
  expect(hostDate!.body).toBeUndefined();
  expect(fmt!.body).toBeUndefined();
});

test("Phase 5b2 — timestamp + duration + addDuration semantic regression smoke", () => {
  // Invokes the 2 ported Fenel bodies + the addDuration cross-Fenel-
  // body round-trip through the engine evaluator with a registry
  // containing stdModule (for `add` / arithmetic dispatch) +
  // timeModule (for the `Timestamp` / `Duration` `construct` ops'
  // field-name mapping via `_constructors`).
  //
  // The round-trip is the load-bearing assertion: `addDuration t d
  // = timestamp (t.epochMs + d.ms)` (from types.fenel) calls
  // `timestamp` recursively — pre-5b2 the dispatch was Fenel → TS-
  // native; post-5b2 it's Fenel → Fenel. If the cross-Fenel-body
  // dispatch is broken, this test fails.
  //
  // Note: timestamp / duration now emit tagged `{$tag: "Timestamp",
  // …}` / `{$tag: "Duration", …}` records (the `Timestamp { … }` /
  // `Duration { … }` construct ops add the tag). Pre-5b2 the TS
  // natives returned untagged `{ epochMs: … }` / `{ ms: … }` — this
  // is a deliberate behavioural shift since the typed-constructor
  // form is the canonical Fenel convention. `time:now` still emits
  // untagged (TS native unchanged); migrating the whole module to
  // tagged constructors is a separate cleanup.
  const registry = createRegistry([stdModule, timeModule]);
  const ctx = registry.evaluateContext();

  const tsFn = (timeModule.functions ?? []).find((f) => f.id === "time:timestamp")!;
  const durFn = (timeModule.functions ?? []).find((f) => f.id === "time:duration")!;
  const addFn = (timeModule.functions ?? []).find((f) => f.id === "time:addDuration")!;

  // timestamp(1717000000000) — typed Timestamp record.
  expect(evaluate(tsFn.body, { epochMs: 1717000000000 }, ctx)).toEqual({
    $tag: "Timestamp",
    epochMs: 1717000000000,
  });

  // duration(86400000) — typed Duration record.
  expect(evaluate(durFn.body, { ms: 86400000 }, ctx)).toEqual({
    $tag: "Duration",
    ms: 86400000,
  });

  // Round-trip: addDuration(timestamp(0), duration(1000)) exercises
  // the cross-Fenel-body call path.
  const t0 = evaluate(tsFn.body, { epochMs: 0 }, ctx);
  const d1k = evaluate(durFn.body, { ms: 1000 }, ctx);
  expect(evaluate(addFn.body, { t: t0, d: d1k }, ctx)).toEqual({
    $tag: "Timestamp",
    epochMs: 1000,
  });
});
