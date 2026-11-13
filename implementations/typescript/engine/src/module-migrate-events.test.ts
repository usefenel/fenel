// ---------------------------------------------------------------------------
// module-migrate-events.test.ts — module-substrate Phase 3i parity proof.
//
// events is a DISJOINT plain/ctx module (= picture's 3f shape): `_stepLookup`
// is a plain native (pure most-recent scan), the other 6 natives (`step` /
// `accum` / `_accumFold` / `sampleBehavior` / `behaviorToAnim` /
// `behaviorToSound`) are ctx natives (build Behavior closures + re-enter the
// evaluator), and `event` / `eventEntry` / `sampleEvent` / `constant` are
// Fenel-bodied. This is a PARITY migration — the ~494-LOC hand-assembled
// engine/src/modules/events.ts (10 defineFunction specs + inline native impls
// + the 3 sub-`.fenel` body merges) was replaced by types.fenel (declarative,
// `module events where` header + 3 entities + the 3 Fenel-bodied constructors
// CONSOLIDATED from the deleted sidecars + constant + 7 @native foreign decls)
// + ffi/events-ffi.ts (the 7 native impls split into plain + ctx maps) + a
// thin seam that re-adds the 2 Sampleable instances, with NOTHING dropped.
//
// module-substrate Phase 3p (2026-05-31) — the events module GREW by 2: the
// mixed-ingress dissolve MERGED `events:emitEvent` + `events:eventsInbound`
// (from ingress.fenel, now `module events where`) into this module via
// `loadFenelModuleUnion`. The roster is now 13 fns; the facet counts climb
// accordingly (Codeable 11→13, Labelable 10→12, Describable/Taggable 10→12).
// The merge proof itself lives in `module-migrate-mixed-ingress.test.ts`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { eventsModule } from "./modules/events";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `ctx: true` == the native lands in `nativeImplsCtx`; `ctx: false` == plain.
type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  _stepLookup: {
    label: "step lookup (internal)",
    tags: ["frp", "events", "internal"],
    description: "Internal helper: most-recent-event-payload-or-init lookup. Used by step.",
    ctx: false,
  },
  _accumFold: {
    label: "accum fold (internal)",
    tags: ["frp", "events", "internal"],
    description: "Internal helper: fold-events-up-to-t. Used by accum.",
    ctx: true,
  },
  step: {
    label: "Step",
    tags: ["frp", "events", "bridge"],
    description:
      "Hold the most recent event payload as a Behavior. step init evt at time t = payload of most recent event with timestamp <= t, or init before any.",
    ctx: true,
  },
  accum: {
    label: "Accumulate",
    tags: ["frp", "events", "bridge", "higher-order"],
    description:
      "Fold events into a state Behavior. accum init fn events at time t = fold fn init (events with timestamp <= t).",
    ctx: true,
  },
  sampleBehavior: {
    label: "Sample behavior",
    tags: ["frp", "primitive"],
    description: "Sample a Behavior at a Time, returning the value at that instant.",
    ctx: true,
  },
  behaviorToAnim: {
    label: "Behavior to Animation",
    tags: ["frp", "bridge"],
    description:
      "Bridge a Behavior Picture into an Animation. Just retags — both are time-indexed function wrappers.",
    ctx: true,
  },
  behaviorToSound: {
    label: "Behavior to Sound",
    tags: ["frp", "bridge"],
    description: "Bridge a Behavior Amplitude into a Sound.",
    ctx: true,
  },
};

// Fenel-bodied constructors — explicit @label/@description/@tags (category
// defaults to the `events` header).
type Bodied = { label: string; tags: string[]; description: string };
const BODIED: Record<string, Bodied> = {
  event: {
    label: "Event",
    tags: ["frp", "events", "constructor"],
    description:
      "Build an Event from a list of timestamped EventEntry values. Returns the canonical typed `{$tag: \"Event\", entries: [...]}` shape via the Event constructor.",
  },
  eventEntry: {
    label: "Event entry",
    tags: ["frp", "events", "constructor"],
    description:
      "Build an EventEntry from a timestamp (seconds) and a polymorphic payload. Returns the canonical typed `{$tag: \"EventEntry\", timestamp, payload}` shape via the EventEntry constructor.",
  },
  sampleEvent: {
    label: "Sample event",
    tags: ["frp", "events", "primitive"],
    description:
      "Sample an Event at a Time. Returns `Just payload` for an event firing exactly at that timestamp, or `Nothing` when no event matches. Conformant Maybe(aVar) return shape post-Phase 5b12 — previously the TS native returned non-conformant `null` for the unknown case; downstream callers using legacy `expect(...).toBe(null)` must update to `.toEqual({$tag: \"Nothing\"})`.",
  },
};

// Phase 3p — the 2 ingress fns merged in from ingress.fenel. Both Fenel-bodied
// with full @label/@description/@tags facets (no @category — derives from the
// `events:` prefix at read time, 3j).
const INGRESS: Record<string, Bodied> = {
  emitEvent: {
    label: "Emit event",
    tags: ["events", "ingress", "phase-12c"],
    description:
      "Phase 12c-routes sub-step 2 — generic composing primitive. Wraps the 2-step ingress tail: appendEvent + dispatchEventTriggers. Sister of emailWebhooks:emitEmailEvent (which wraps the 4-step email-lifecycle tail). Used by events-inbound + calendly invitee.created + telegram-webhook umbrella.",
  },
  eventsInbound: {
    label: "Events inbound",
    tags: ["events", "ingress", "route", "phase-12c"],
    description:
      "POST /api/events/inbound body. The TS wrapper has already verified the x-fenel-inbound-token header + parsed the JSON body. Body composes emitEvent + returns {received: true}.",
  },
};

const NATIVE_NAMES = Object.keys(NATIVES); // 7
const BODIED_NAMES = Object.keys(BODIED); // 3
const INGRESS_NAMES = Object.keys(INGRESS); // 2 (Phase 3p merge)
const PLAIN_NATIVES = NATIVE_NAMES.filter((n) => !NATIVES[n]!.ctx); // _stepLookup
const CTX_NATIVES = NATIVE_NAMES.filter((n) => NATIVES[n]!.ctx); // 6
// All 13 functions = 7 natives + 3 bodied constructors + constant (auto-derived)
// + the 2 ingress fns MERGED in by Phase 3p (the mixed-ingress dissolve).
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES, "constant", ...INGRESS_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("events migration — header-driven identity", () => {
  test("the `module events where` header is authoritative (lowercase prefix preserved)", () => {
    expect(eventsModule.name).toBe("events");
  });

  test("all 13 functions registered under the legacy `events:` id-prefix (incl. the 2 Phase 3p ingress merges)", () => {
    expect((eventsModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `events:${n}`).sort(),
    );
  });

  test("the 3 entities ride along from the `.fenel` (EventEntry / Event / Behavior)", () => {
    expect((eventsModule.entities ?? []).map((e) => e.id).sort()).toEqual(
      ["Behavior", "Event", "EventEntry"],
    );
  });

  test("module label preserved", () => {
    expect(JSON.stringify(eventsModule.label)).toContain("Events");
  });
});

describe("events migration — the `ffi/` split + the DISJOINT plain/ctx seam (axis #3)", () => {
  test("exactly the 7 native-backed functions are BODYLESS; event/eventEntry/sampleEvent/constant keep bodies", () => {
    const bodyless = (eventsModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `events:${n}`).sort());
    for (const n of [...BODIED_NAMES, "constant", ...INGRESS_NAMES]) {
      expect((eventsModule.functions ?? []).find((f) => f.id === `events:${n}`)?.body, `${n} body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) holds exactly _stepLookup, id-keyed", () => {
    expect(Object.keys(eventsModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `events:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly the 6 ctx natives, id-keyed", () => {
    expect(eventsModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(eventsModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `events:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (axis #4: seam routes, no marker)", () => {
    const plain = new Set(Object.keys(eventsModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(eventsModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(eventsModule.ioHandlers).toBeUndefined();
    expect(eventsModule.credentialRequirements).toBeUndefined();
  });
});

describe("events migration — Sampleable seam consts ride", () => {
  const insts = eventsModule.instances ?? [];
  test("Sampleable Behavior → events:sampleBehavior, Event → events:sampleEvent", () => {
    const behavior = insts.find((i) => i.typeName === "Sampleable" && i.args[0] === "Behavior");
    const event = insts.find((i) => i.typeName === "Sampleable" && i.args[0] === "Event");
    // typed-function-references Phase 10c — `.fenel`-authored
    // (fenel/modules/events/instances.fenel): the point-free method ref lowers to
    // a CODENAME handle, which the sample table resolves id-or-codeName to the
    // canonical `events:sampleBehavior` / `events:sampleEvent` (dispatch unchanged).
    expect(behavior?.methods).toEqual({ sample: { $ref: "sampleBehavior" } });
    expect(event?.methods).toEqual({ sample: { $ref: "sampleEvent" } });
  });
  test("exactly 2 Sampleable instances", () => {
    expect(insts.filter((i) => i.typeName === "Sampleable").length).toBe(2);
  });
});

describe("events migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = eventsModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `events:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): the loader no longer auto-stamps the
  // header-default category. events declares NO @category on any function, so
  // NONE carry a stored Categorizable — the `events` category now derives at
  // READ time via `displayCategory` (the id's module-prefix). Proven against the
  // dispatch path in phase-3j-display-fallback.test.ts.
  test("Categorizable: NONE stored — events declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `events:${n}`)).toBeUndefined();
    }
  });

  test("Labelable + Describable + Taggable: byte-identical for the 7 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `events:${n}`)).toEqual({ label: NATIVES[n]!.label });
      expect(methodOf(insts, "Describable", `events:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `events:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("Labelable + Describable + Taggable: byte-identical for the 3 bodied constructors", () => {
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Labelable", `events:${n}`)).toEqual({ label: BODIED[n]!.label });
      expect(methodOf(insts, "Describable", `events:${n}`)).toEqual({ description: BODIED[n]!.description });
      expect(methodOf(insts, "Taggable", `events:${n}`)).toEqual({ tags: BODIED[n]!.tags });
    }
  });

  // Phase 3p — the 2 merged ingress fns carry their full facets (lifted from the
  // retired mixed-ingress defineFunction specs).
  test("Labelable + Describable + Taggable: byte-identical for the 2 Phase 3p ingress merges", () => {
    for (const n of INGRESS_NAMES) {
      expect(methodOf(insts, "Labelable", `events:${n}`)).toEqual({ label: INGRESS[n]!.label });
      expect(methodOf(insts, "Describable", `events:${n}`)).toEqual({ description: INGRESS[n]!.description });
      expect(methodOf(insts, "Taggable", `events:${n}`)).toEqual({ tags: INGRESS[n]!.tags });
    }
  });

  // Phase 3j: `constant` declares no facet directives at all, so post-3j it
  // carries Codeable ONLY (the undecorated default) — no Labelable, Categorizable,
  // Describable or Taggable. Its display label ("Constant") + category ("events")
  // come from the read-time fallback, not a stored instance.
  test("`constant` carries Codeable ONLY (the post-3j undecorated default)", () => {
    expect(methodOf(insts, "Codeable", "events:constant")).toEqual({ codeName: "constant" });
    expect(methodOf(insts, "Labelable", "events:constant")).toBeUndefined();
    expect(methodOf(insts, "Categorizable", "events:constant")).toBeUndefined();
    expect(methodOf(insts, "Describable", "events:constant")).toBeUndefined();
    expect(methodOf(insts, "Taggable", "events:constant")).toBeUndefined();
  });

  // Phase 3j: Labelable is 10 of the original 11 (constant has no @label);
  // Categorizable is 0 (events declares no @category — header-default gone).
  // Phase 3p: the 2 ingress merges each carry full facets, so Codeable 11→13,
  // Labelable 10→12, Describable/Taggable 10→12. Categorizable + IOInvokable
  // stay 0 (ingress fns carry neither). The 2450-law parity holds — the
  // ingress fns re-emit the SAME instances they did inside the bundle.
  test("identity-facet counts: 13 Codeable, 12 Labelable (constant undecorated), 0 Categorizable (none @category), 12 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(13);
    expect(counts.Labelable).toBe(12);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(12);
    expect(counts.Taggable).toBe(12);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("events migration — resolution + dispatch through createRegistry", () => {
  const reg = createRegistry([eventsModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `events:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes BOTH native maps", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`events:${n}`], `plain native: events:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`events:${n}`], `ctx native: events:${n}`).toBe("function");
    }
  });

  // End-to-end: event / eventEntry (Fenel bodies) → step (ctx native builds a
  // Behavior closure) → sampleBehavior (ctx native re-enters the evaluator to
  // run the closure, which calls the plain _stepLookup native). Exercises the
  // whole disjoint plain/ctx loop using ONLY eventsModule.
  test("step + sampleBehavior dispatch end-to-end (ctx threaded → plain native)", () => {
    const reg2 = createRegistry([eventsModule]);
    const ctx = reg2.evaluateContext();
    const e1 = evaluate({ call: ["eventEntry", 1, "a"] }, {}, ctx);
    const e2 = evaluate({ call: ["eventEntry", 3, "b"] }, {}, ctx);
    const evt = evaluate({ call: ["event", [e1, e2]] }, {}, ctx);
    const beh = evaluate({ call: ["step", "init", evt] }, {}, ctx);
    // A Time value is `{ $tag: "Time", seconds }` — built as a tagged literal
    // (evaluate passes tagged values through verbatim) so this proof needs
    // ONLY eventsModule (no time/sound module dependency).
    // Before any event → init.
    expect(evaluate({ call: ["sampleBehavior", beh, { $tag: "Time", seconds: 0.5 }] }, {}, ctx)).toBe("init");
    // After both events → "b".
    expect(evaluate({ call: ["sampleBehavior", beh, { $tag: "Time", seconds: 100 }] }, {}, ctx)).toBe("b");
  });

  test("plain native _stepLookup is directly callable (most-recent scan)", () => {
    const ctx = reg.evaluateContext();
    const entries = [
      { timestamp: 1, payload: "a" },
      { timestamp: 3, payload: "b" },
    ];
    const out = ctx.natives!["events:_stepLookup"]!("init", entries, { seconds: 2 });
    expect(out).toBe("a");
  });
});
