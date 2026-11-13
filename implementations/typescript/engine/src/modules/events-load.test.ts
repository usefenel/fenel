// ---------------------------------------------------------------------------
// events-load.test.ts — conformance test for the events module entity +
// the consolidated function bodies.
//
// module-substrate Phase 3i migrated events to `module events where`: the 3
// former sidecars (`event.fenel` / `event-entry.fenel` / `sample-event.fenel`,
// the `event` / `eventEntry` / `sampleEvent` constructor bodies) were
// CONSOLIDATED into `fenel/modules/events/types.fenel` (3b/3g consolidation)
// and DELETED, so this test no longer loads them — each body is now read from
// the module file like every other bodied function (the path-load.test.ts
// precedent). The 3 parametric entities, the type-var threading, the
// `constant` helper, the post-flip module surface, and the body-shape /
// natives-absence assertions are still covered here; the deeper migration
// parity proof lives in module-migrate-events.test.ts.
//
// Events is the only module with parametric entities — `EventEntry<a>`,
// `Event<a>`, `Behavior<a>` carry a type-var `a` that parses as a
// declaration-bound `{$var: "a"}` inside the entity body.
//
// `fenel/modules/events/ingress.fenel` was absorbed when mixed-ingress retired.
// Its 2 functions are unioned into the public eventsModule; EVENTS_MOD below is
// intentionally the 11-function types.fenel slice.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import eventsSrc from "../../../../../fenel/modules/events/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { eventsModule } from "./events";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import { stdModule } from "./std";
import { soundModule } from "./sound";
const EVENTS_MOD = loadFenelModule(eventsSrc, "events");
const EXPECTED_EVENTS_FUNCTION_IDS = [
  "events:_accumFold",
  "events:_stepLookup",
  "events:accum",
  "events:behaviorToAnim",
  "events:behaviorToSound",
  "events:constant",
  "events:emitEvent",
  "events:event",
  "events:eventEntry",
  "events:eventsInbound",
  "events:sampleBehavior",
  "events:sampleEvent",
  "events:step",
];

test("events/types.fenel parses to exactly 3 entities (canonical roster lock)", () => {
  expect((EVENTS_MOD.entities ?? []).length).toBe(3);
  const ids = (EVENTS_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("EventEntry");
  expect(ids).toContain("Event");
  expect(ids).toContain("Behavior");
});

test("EventEntry's payload field carries {$var: \"a\"} type-var threading", () => {
  // Same mechanism as notion's `PaginatedList(a)` — the type-var `a`
  // parses as a declaration-bound `{$var: "a"}` inside the body.
  // Downstream substitution at use time resolves it.
  const eventEntry = (EVENTS_MOD.entities ?? []).find((e) => e.id === "EventEntry");
  expect(eventEntry).toBeDefined();
  const rec = eventEntry!.type as {
    $record: { fields: Array<{ name: string; type: { $var: string } }> };
  };
  const payload = rec.$record.fields.find((f) => f.name === "payload")!;
  expect(payload.type).toEqual({ $var: "a" });
});

test("inline closure (constant) surfaces as user-Fenel function", () => {
  const fnIds = new Set((EVENTS_MOD.functions ?? []).map((f) => f.id));
  expect(fnIds).toContain("events:constant");
  const fn = (EVENTS_MOD.functions ?? []).find((f) => f.id === "events:constant")!;
  expect(fn.body).toBeDefined();
});

test("eventsModule carries the exact 3-entity + 13-function union roster", () => {
  expect((eventsModule.entities ?? []).length).toBe(3);
  expect((eventsModule.functions ?? []).map(({ id }) => id).sort()).toEqual(
    EXPECTED_EVENTS_FUNCTION_IDS,
  );
});

test("getSystemRegistry surfaces entity:EventEntry / entity:Event / entity:Behavior", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:EventEntry")).toBeDefined();
  expect(getCatalogEntry("entity:Event")).toBeDefined();
  expect(getCatalogEntry("entity:Behavior")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Phase 3i — the 3 constructor bodies are now CONSOLIDATED into types.fenel
// (formerly the event.fenel / event-entry.fenel / sample-event.fenel sidecars).
// Each is read from the module file; the construct-shape + natives-absence
// assertions (5b10 / 5b12) are preserved.
// ---------------------------------------------------------------------------

test("3i: event / eventEntry / sampleEvent are Fenel-bodied in the consolidated module file", () => {
  for (const id of ["events:event", "events:eventEntry", "events:sampleEvent"]) {
    const fn = (EVENTS_MOD.functions ?? []).find((f) => f.id === id)!;
    expect(fn, id).toBeDefined();
    expect(fn.body, `${id} body`).toBeDefined();
  }
});

test("events:event + events:eventEntry construct-shape bodies; eventsNatives.event / .eventEntry absent", () => {
  const fns = eventsModule.functions ?? [];
  const eventFn = fns.find((f) => f.id === "events:event")!;
  const entryFn = fns.find((f) => f.id === "events:eventEntry")!;
  expect(eventFn.body).toBeDefined();
  expect(entryFn.body).toBeDefined();
  // Module body == consolidated-file body (same source the seam loads from).
  expect(eventFn.body).toEqual(EVENTS_MOD.functions?.find((f) => f.id === "events:event")?.body);
  expect(entryFn.body).toEqual(EVENTS_MOD.functions?.find((f) => f.id === "events:eventEntry")?.body);
  // Construct-shape check (byte-identical to the former event.fenel / event-entry.fenel).
  expect(eventFn.body).toEqual({
    construct: ["Event", { entries: { var: "entries" } }],
  });
  expect(entryFn.body).toEqual({
    construct: [
      "EventEntry",
      { timestamp: { var: "timestamp" }, payload: { var: "payload" } },
    ],
  });
  // event / eventEntry are NOT natives (Fenel-bodied).
  const natives = (eventsModule.nativeImpls ?? {}) as Record<string, unknown>;
  expect(natives["events:event"]).toBeUndefined();
  expect(natives["events:eventEntry"]).toBeUndefined();
  // sampleEvent is also Fenel-bodied (not a native).
  expect(natives["events:sampleEvent"]).toBeUndefined();
  // The one plain native rides nativeImpls; the 6 ctx natives ride nativeImplsCtx.
  expect(natives["events:_stepLookup"]).toBeDefined();
  const nativesCtx = (eventsModule.nativeImplsCtx ?? {}) as Record<string, unknown>;
  expect(nativesCtx["events:step"]).toBeDefined();
  expect(nativesCtx["events:accum"]).toBeDefined();
  expect(nativesCtx["events:sampleBehavior"]).toBeDefined();
});

test("semantic regression smoke — event + eventEntry dispatch through Fenel bodies (tagged shapes)", () => {
  const reg = createRegistry([eventsModule]);
  const ctx = reg.evaluateContext();
  // Empty list — tagged-shape post-flip
  expect(evaluate({ call: ["event", []] }, {}, ctx)).toEqual({
    $tag: "Event",
    entries: [],
  });
  // Cross-Fenel-body dispatch — event body calls into eventEntry body via list literal
  const e1 = evaluate({ call: ["eventEntry", 1, 100] }, {}, ctx);
  const e2 = evaluate({ call: ["eventEntry", 2, 200] }, {}, ctx);
  expect(evaluate({ call: ["event", [e1, e2]] }, {}, ctx)).toEqual({
    $tag: "Event",
    entries: [
      { $tag: "EventEntry", timestamp: 1, payload: 100 },
      { $tag: "EventEntry", timestamp: 2, payload: 200 },
    ],
  });
  // Polymorphic payload — String case
  expect(evaluate({ call: ["eventEntry", 0, "hello"] }, {}, ctx)).toEqual({
    $tag: "EventEntry",
    timestamp: 0,
    payload: "hello",
  });
});

test("events:sampleEvent body is the match-form (find + named-field Just); native absent; returns Maybe", () => {
  const fns = eventsModule.functions ?? [];
  const sampleFn = fns.find((f) => f.id === "events:sampleEvent")!;
  expect(sampleFn.body).toBeDefined();
  // Module body == consolidated-file body.
  expect(sampleFn.body).toEqual(EVENTS_MOD.functions?.find((f) => f.id === "events:sampleEvent")?.body);
  // Match-form shape check — find + eq calls + the positional `Just e`
  // pattern, which binds `_0` (AGENTS.md "Encodings": the named `value` form
  // is retired). Byte-identical to the former sample-event.fenel.
  expect(sampleFn.body).toEqual({
    match: [
      {
        call: [
          "find",
          { fn: ["e", { call: ["eq", { var: "e.timestamp" }, { var: "t.seconds" }] }] },
          { var: "event.entries" },
        ],
      },
      { $tag: "Nothing" },
      { construct: ["Nothing"] },
      { $tag: "Just", _0: { $bind: "e" } },
      { construct: ["Just", { var: "e.payload" }] },
    ],
  });
  // sampleEvent is Fenel-bodied, not a native.
  const natives = (eventsModule.nativeImpls ?? {}) as Record<string, unknown>;
  expect(natives["events:sampleEvent"]).toBeUndefined();
  // The `.fenel` sig `Maybe a` expands to the canonical `$variant` Maybe
  // encoding (Nothing | Just { _0: a }) — faithful to the retired spec's
  // `returns: Maybe(aVar)`. (Exact type-shape byte-equality is not required
  // for parity; the conformant Maybe shape flows from the body's construct ops,
  // proven by the dispatch smoke test below.)
  const ret = sampleFn.returns as { $variant?: { cases: Array<{ name: string }> } };
  expect(ret.$variant?.cases.map((c) => c.name)).toEqual(["Nothing", "Just"]);
});

test("semantic regression smoke — sampleEvent dispatch through Fenel body returns conformant Maybe shape", () => {
  const reg = createRegistry([stdModule, soundModule, eventsModule]);
  const ctx = reg.evaluateContext();
  const e1 = evaluate({ call: ["eventEntry", 1, 100] }, {}, ctx);
  const e2 = evaluate({ call: ["eventEntry", 2, 200] }, {}, ctx);
  const e3 = evaluate({ call: ["eventEntry", 3, 300] }, {}, ctx);
  const evt = evaluate({ call: ["event", [e1, e2, e3]] }, {}, ctx);
  // Hit at exact timestamp
  expect(evaluate({ call: ["sampleEvent", evt, { call: ["time", 2] }] }, {}, ctx)).toEqual({
    $tag: "Just",
    _0: 200,
  });
  // Miss between timestamps
  expect(evaluate({ call: ["sampleEvent", evt, { call: ["time", 2.5] }] }, {}, ctx)).toEqual({
    $tag: "Nothing",
  });
  // Empty entries list
  const empty = evaluate({ call: ["event", []] }, {}, ctx);
  expect(evaluate({ call: ["sampleEvent", empty, { call: ["time", 0] }] }, {}, ctx)).toEqual({
    $tag: "Nothing",
  });
});
