// ---------------------------------------------------------------------------
// Phase 5 + Phase 14 of canonical-maybe — `Trace.{parentId, completedAt,
// durationMs, error, capability, provider, input, output, valueTypes,
// stepPath}?` → canonical `Maybe<...>` lift conformance (10-slot
// codec-boundary cluster demo).
//
// Pre-lift: ten `?:` slots on a single record type (`Trace`), persistence via
// typed DB columns (nullable text / timestamp / integer / jsonb columns in
// `function_traces`), codec at `db/queries/traces.ts` bridging null↔undefined.
//
// Post-lift: every Trace carries ten total Maybe<...> slots. The codec
// boundary bridges null (column) ↔ Just/Nothing (Maybe). The recipe-twist
// Phase 5 introduced is **Recipe D** — codec-boundary lift — a per-phase
// pattern documented for future codec-boundary lifts (FunctionInstance,
// AccountSettings, …). Phase 14 extends the same recipe to the remaining
// 4 `?:` slots on Trace (`input`, `output`, `valueTypes`, `stepPath`),
// closing the Trace arc.
//
// These tests pin:
//
//   1. Trace accepts canonical Maybe<...> shapes on all 10 slots (compile +
//      cascade discriminate read).
//   2. rowToTrace round-trips null↔Nothing/Just on each slot (mirrored
//      logic — engine package doesn't import db).
//   3. insertTraces flips Maybe to nullable column shape on each slot.
//   4. Trace tree builder respects Just(parentId) (mirrored logic).
//   5. Trace.completedAt round-trips through Date ↔ ISO-string at the codec.
//   6. startTrace emits canonical Nothing on absent slots, Just(...) on
//      resolved capability/provider (mirrored emit logic).
//   7. completeTrace flips completedAt and durationMs from Nothing to Just.
//   8. Phase 14 — `Trace.output: Just(null)` collapses to Nothing at codec
//      round-trip (Option A — documented lossy semantic).
//   9. Phase 14 — `Trace.valueTypes: Just([])` collapses to null at codec
//      write (empty-array indistinguishable from "no types").
//  10. Phase 14 — `Trace.input` round-trips Record<string, unknown> ↔ jsonb.
//  11. Phase 14 — `Trace.stepPath` round-trips dotted-string ↔ text column.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import type { Trace } from "./types";

// ---------------------------------------------------------------------------
// Mirrored codec helpers — engine package can't import @fenel/db, so we
// duplicate the rowToTrace / insertTraces value-shape logic here. The
// duplication is intentional — pinning the algorithm in a test that lives
// in the engine package guards against drift; if the real codec at
// db/queries/traces.ts diverges, this test should be updated in lockstep.
// ---------------------------------------------------------------------------

type FunctionTraceRow = {
  id: string;
  instanceId: string;
  parentId: string | null;
  name: string;
  kind: Trace["kind"];
  status: Trace["status"];
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  capability: string | null;
  provider: string | null;
  effects: unknown;
  meta: Record<string, unknown> | null;
  valueTypes: string[] | null;
  stepPath: string | null;
};

function rowToTraceMirror(row: FunctionTraceRow): Trace {
  return {
    id: row.id,
    instanceId: row.instanceId,
    parentId: row.parentId !== null ? Just(row.parentId) : Nothing,
    name: row.name,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt !== null ? Just(row.completedAt.toISOString()) : Nothing,
    durationMs: row.durationMs !== null ? Just(row.durationMs) : Nothing,
    input: row.input !== null ? Just(row.input as Record<string, unknown>) : Nothing,
    output: row.output !== null ? Just(row.output) : Nothing,
    error: row.error !== null ? Just(row.error) : Nothing,
    capability: row.capability !== null ? Just(row.capability) : Nothing,
    provider: row.provider !== null ? Just(row.provider) : Nothing,
    meta: (row.meta ?? Nothing) as Trace["meta"],
    valueTypes: row.valueTypes !== null ? Just(row.valueTypes) : Nothing,
    stepPath: row.stepPath !== null ? Just(row.stepPath) : Nothing,
  };
}

type InsertValues = {
  parentId: string | null;
  completedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  capability: string | null;
  provider: string | null;
  input: Record<string, unknown> | null;
  output: unknown | null;
  valueTypes: string[] | null;
  stepPath: string | null;
};

function traceToInsertValuesMirror(s: Trace): InsertValues {
  return {
    parentId: s.parentId.$tag === "Just" ? s.parentId._0 : null,
    completedAt: s.completedAt.$tag === "Just" ? new Date(s.completedAt._0) : null,
    durationMs: s.durationMs.$tag === "Just" ? s.durationMs._0 : null,
    error: s.error.$tag === "Just" ? s.error._0 : null,
    capability: s.capability.$tag === "Just" ? s.capability._0 : null,
    provider: s.provider.$tag === "Just" ? s.provider._0 : null,
    // Phase 14: Option A codec — Just(null) collapses to JSONB null; empty
    // valueTypes array collapses to null (no semantic difference from Nothing).
    input: s.input.$tag === "Just" ? s.input._0 : null,
    output: s.output.$tag === "Just" ? s.output._0 : null,
    valueTypes: s.valueTypes.$tag === "Just" && s.valueTypes._0.length ? s.valueTypes._0 : null,
    stepPath: s.stepPath.$tag === "Just" ? s.stepPath._0 : null,
  };
}

// Tree-builder mirror — pins the `Just(parentId)`-gated lookup logic.
type TraceNode = Trace & { children: TraceNode[] };

function buildTraceTreeMirror(traces: Trace[]): TraceNode[] {
  const map = new Map<string, TraceNode>();
  const roots: TraceNode[] = [];
  for (const t of traces) map.set(t.id, { ...t, children: [] });
  for (const node of map.values()) {
    if (node.parentId.$tag === "Just" && map.has(node.parentId._0)) {
      map.get(node.parentId._0)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// startTrace emit-site mirror (without the IORequest + ModuleRegistry deps —
// just the Trace literal shape).
function startTraceMirror(opts: {
  id: string;
  instanceId: string;
  action: string;
  resolved: { provider: string } | null;
  params?: Record<string, unknown>;
  stepPath?: string;
  valueTypes?: string[];
}): Trace {
  return {
    id: opts.id,
    instanceId: opts.instanceId,
    parentId: Nothing,
    name: opts.action,
    kind: "io",
    startedAt: new Date().toISOString(),
    completedAt: Nothing,
    durationMs: Nothing,
    status: "running",
    // Phase 14 — input/output/valueTypes/stepPath now mandatory Maybe.
    input: opts.params ? Just(opts.params) : Nothing,
    output: Nothing,
    error: Nothing,
    capability: opts.resolved ? Just(opts.action.split(".")[0]!) : Nothing,
    provider: opts.resolved ? Just(opts.resolved.provider) : Nothing,
    valueTypes: opts.valueTypes && opts.valueTypes.length ? Just(opts.valueTypes) : Nothing,
    stepPath: opts.stepPath ? Just(opts.stepPath) : Nothing,
    meta: Nothing,
  };
}

function completeTraceMirror(span: Trace, status: Trace["status"], output?: unknown, error?: string): void {
  const ts = new Date().toISOString();
  span.completedAt = Just(ts);
  span.durationMs = Just(new Date(ts).getTime() - new Date(span.startedAt).getTime());
  span.status = status;
  // Phase 14 — output now mandatory Maybe; conditional set wraps in Just.
  if (output !== undefined) span.output = Just(output);
  if (error) span.error = Just(error);
}

// ---------------------------------------------------------------------------
// Helpers for building fixtures.
// ---------------------------------------------------------------------------

function baseTrace(over: Partial<Trace> = {}): Trace {
  return {
    id: "t1",
    instanceId: "i1",
    parentId: Nothing,
    name: "fn",
    kind: "call",
    startedAt: "2026-05-26T12:00:00.000Z",
    completedAt: Nothing,
    durationMs: Nothing,
    status: "completed",
    input: Nothing,
    output: Nothing,
    error: Nothing,
    capability: Nothing,
    provider: Nothing,
    meta: Nothing,
    valueTypes: Nothing,
    stepPath: Nothing,
    ...over,
  };
}

function baseRow(over: Partial<FunctionTraceRow> = {}): FunctionTraceRow {
  return {
    id: "t1",
    instanceId: "i1",
    parentId: null,
    name: "fn",
    kind: "call",
    status: "completed",
    startedAt: new Date("2026-05-26T12:00:00.000Z"),
    completedAt: null,
    durationMs: null,
    input: null,
    output: null,
    error: null,
    capability: null,
    provider: null,
    effects: null,
    meta: null,
    valueTypes: null,
    stepPath: null,
    ...over,
  };
}

describe("Phase 5 + 14 canonical-maybe — Trace cluster (10-slot codec-boundary lift)", () => {
  it("Trace accepts canonical Maybe<...> shape on all 10 slots", () => {
    const allJust: Trace = baseTrace({
      parentId: Just("p1"),
      completedAt: Just("2026-05-26T12:00:01.000Z"),
      durationMs: Just(1000),
      error: Just("oops"),
      capability: Just("telegram"),
      provider: Just("default"),
      input: Just({ token: "xyz" }),
      output: Just({ ok: true }),
      valueTypes: Just(["Bot", "ChatId"]),
      stepPath: Just("0.2.1"),
    });
    const allNothing: Trace = baseTrace();

    // Cascade discriminate per slot — each Maybe narrows via $tag guard.
    if (allJust.parentId.$tag !== "Just") throw new Error("expected Just parentId");
    expect(allJust.parentId._0).toBe("p1");
    if (allJust.completedAt.$tag !== "Just") throw new Error("expected Just completedAt");
    expect(allJust.completedAt._0).toBe("2026-05-26T12:00:01.000Z");
    if (allJust.durationMs.$tag !== "Just") throw new Error("expected Just durationMs");
    expect(allJust.durationMs._0).toBe(1000);
    if (allJust.error.$tag !== "Just") throw new Error("expected Just error");
    expect(allJust.error._0).toBe("oops");
    if (allJust.capability.$tag !== "Just") throw new Error("expected Just capability");
    expect(allJust.capability._0).toBe("telegram");
    if (allJust.provider.$tag !== "Just") throw new Error("expected Just provider");
    expect(allJust.provider._0).toBe("default");
    if (allJust.input.$tag !== "Just") throw new Error("expected Just input");
    expect(allJust.input._0).toEqual({ token: "xyz" });
    if (allJust.output.$tag !== "Just") throw new Error("expected Just output");
    expect(allJust.output._0).toEqual({ ok: true });
    if (allJust.valueTypes.$tag !== "Just") throw new Error("expected Just valueTypes");
    expect(allJust.valueTypes._0).toEqual(["Bot", "ChatId"]);
    if (allJust.stepPath.$tag !== "Just") throw new Error("expected Just stepPath");
    expect(allJust.stepPath._0).toBe("0.2.1");

    expect(allNothing.parentId.$tag).toBe("Nothing");
    expect(allNothing.completedAt.$tag).toBe("Nothing");
    expect(allNothing.durationMs.$tag).toBe("Nothing");
    expect(allNothing.error.$tag).toBe("Nothing");
    expect(allNothing.capability.$tag).toBe("Nothing");
    expect(allNothing.provider.$tag).toBe("Nothing");
    expect(allNothing.input.$tag).toBe("Nothing");
    expect(allNothing.output.$tag).toBe("Nothing");
    expect(allNothing.valueTypes.$tag).toBe("Nothing");
    expect(allNothing.stepPath.$tag).toBe("Nothing");
  });

  it("rowToTrace round-trips null → Nothing on each slot", () => {
    const trace = rowToTraceMirror(baseRow());
    expect(trace.parentId.$tag).toBe("Nothing");
    expect(trace.completedAt.$tag).toBe("Nothing");
    expect(trace.durationMs.$tag).toBe("Nothing");
    expect(trace.error.$tag).toBe("Nothing");
    expect(trace.capability.$tag).toBe("Nothing");
    expect(trace.provider.$tag).toBe("Nothing");
    expect(trace.input.$tag).toBe("Nothing");
    expect(trace.output.$tag).toBe("Nothing");
    expect(trace.valueTypes.$tag).toBe("Nothing");
    expect(trace.stepPath.$tag).toBe("Nothing");
  });

  it("rowToTrace round-trips column value → Just on each slot", () => {
    const completedAtDate = new Date("2026-05-26T12:00:01.000Z");
    const trace = rowToTraceMirror(baseRow({
      parentId: "p1",
      completedAt: completedAtDate,
      durationMs: 1234,
      error: "boom",
      capability: "telegram",
      provider: "default",
      input: { arg0: "hello" },
      output: { ok: true },
      valueTypes: ["Bot"],
      stepPath: "0.1",
    }));
    expect(trace.parentId).toEqual(Just("p1"));
    // completedAt's Just-arm carries the ISO string projection of the Date.
    expect(trace.completedAt).toEqual(Just("2026-05-26T12:00:01.000Z"));
    expect(trace.durationMs).toEqual(Just(1234));
    expect(trace.error).toEqual(Just("boom"));
    expect(trace.capability).toEqual(Just("telegram"));
    expect(trace.provider).toEqual(Just("default"));
    expect(trace.input).toEqual(Just({ arg0: "hello" }));
    expect(trace.output).toEqual(Just({ ok: true }));
    expect(trace.valueTypes).toEqual(Just(["Bot"]));
    expect(trace.stepPath).toEqual(Just("0.1"));
  });

  it("insertTraces values mirror flips Maybe to nullable column shape per slot", () => {
    const allJust = traceToInsertValuesMirror(baseTrace({
      parentId: Just("p1"),
      completedAt: Just("2026-05-26T12:00:01.000Z"),
      durationMs: Just(1234),
      error: Just("boom"),
      capability: Just("telegram"),
      provider: Just("default"),
      input: Just({ arg0: "hello" }),
      output: Just({ ok: true }),
      valueTypes: Just(["Bot"]),
      stepPath: Just("0.1"),
    }));
    expect(allJust.parentId).toBe("p1");
    expect(allJust.completedAt).toEqual(new Date("2026-05-26T12:00:01.000Z"));
    expect(allJust.durationMs).toBe(1234);
    expect(allJust.error).toBe("boom");
    expect(allJust.capability).toBe("telegram");
    expect(allJust.provider).toBe("default");
    expect(allJust.input).toEqual({ arg0: "hello" });
    expect(allJust.output).toEqual({ ok: true });
    expect(allJust.valueTypes).toEqual(["Bot"]);
    expect(allJust.stepPath).toBe("0.1");

    const allNothing = traceToInsertValuesMirror(baseTrace());
    expect(allNothing.parentId).toBeNull();
    expect(allNothing.completedAt).toBeNull();
    expect(allNothing.durationMs).toBeNull();
    expect(allNothing.error).toBeNull();
    expect(allNothing.capability).toBeNull();
    expect(allNothing.provider).toBeNull();
    expect(allNothing.input).toBeNull();
    expect(allNothing.output).toBeNull();
    expect(allNothing.valueTypes).toBeNull();
    expect(allNothing.stepPath).toBeNull();
  });

  it("trace tree builder respects Just(parentId) gating", () => {
    const traces: Trace[] = [
      baseTrace({ id: "root" }),
      baseTrace({ id: "child1", parentId: Just("root") }),
      baseTrace({ id: "child2", parentId: Just("root") }),
      baseTrace({ id: "grandchild", parentId: Just("child1") }),
      baseTrace({ id: "orphan" }), // Nothing parentId → root
    ];
    const roots = buildTraceTreeMirror(traces);
    const rootIds = roots.map((r) => r.id).sort();
    expect(rootIds).toEqual(["orphan", "root"]);
    const root = roots.find((r) => r.id === "root")!;
    expect(root.children.length).toBe(2);
    const child1 = root.children.find((c) => c.id === "child1")!;
    expect(child1.children.map((c) => c.id)).toEqual(["grandchild"]);
  });

  it("trace tree builder treats Just(<missing-parent>) as a root", () => {
    // A trace whose parentId points at an id not in the map — pre-lift this
    // false-positively passed the truthy gate but the .get returned undefined
    // (silent breakage); post-lift the explicit `map.has(value)` gate sends
    // the orphan to the roots array as expected.
    const traces: Trace[] = [baseTrace({ id: "lonely", parentId: Just("missing") })];
    const roots = buildTraceTreeMirror(traces);
    expect(roots.length).toBe(1);
    expect(roots[0]!.id).toBe("lonely");
  });

  it("Trace.completedAt round-trips through Date↔ISO-string at the codec", () => {
    const iso = "2026-05-26T12:00:01.000Z";
    const trace = baseTrace({ completedAt: Just(iso) });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.completedAt).toBeInstanceOf(Date);
    expect((insertVals.completedAt as Date).toISOString()).toBe(iso);

    // And back the other way: a Date column reads as a Just<string> ISO form.
    const roundTripped = rowToTraceMirror(baseRow({ completedAt: insertVals.completedAt }));
    expect(roundTripped.completedAt).toEqual(Just(iso));
  });

  it("startTrace emits canonical Nothing on absent slots, Just on resolved capability/provider", () => {
    const unresolved = startTraceMirror({ id: "s1", instanceId: "i1", action: "state.read", resolved: null });
    expect(unresolved.parentId.$tag).toBe("Nothing");
    expect(unresolved.completedAt.$tag).toBe("Nothing");
    expect(unresolved.durationMs.$tag).toBe("Nothing");
    expect(unresolved.error.$tag).toBe("Nothing");
    expect(unresolved.capability.$tag).toBe("Nothing");
    expect(unresolved.provider.$tag).toBe("Nothing");
    // Phase 14 — these are Nothing when opts.params/stepPath/valueTypes absent.
    expect(unresolved.input.$tag).toBe("Nothing");
    expect(unresolved.output.$tag).toBe("Nothing");
    expect(unresolved.valueTypes.$tag).toBe("Nothing");
    expect(unresolved.stepPath.$tag).toBe("Nothing");
    expect(unresolved.status).toBe("running");

    const resolved = startTraceMirror({
      id: "s2",
      instanceId: "i1",
      action: "telegram.sendMessage",
      resolved: { provider: "default" },
      params: { chatId: 42, text: "hi" },
      stepPath: "0.0",
      valueTypes: ["Bot", "ChatId"],
    });
    expect(resolved.capability).toEqual(Just("telegram"));
    expect(resolved.provider).toEqual(Just("default"));
    // Phase 14 — input/stepPath/valueTypes light up when opts populate them.
    expect(resolved.input).toEqual(Just({ chatId: 42, text: "hi" }));
    expect(resolved.stepPath).toEqual(Just("0.0"));
    expect(resolved.valueTypes).toEqual(Just(["Bot", "ChatId"]));
    // output stays Nothing — only set by completeTrace.
    expect(resolved.output.$tag).toBe("Nothing");
    expect(resolved.parentId.$tag).toBe("Nothing");
    expect(resolved.completedAt.$tag).toBe("Nothing");
    expect(resolved.durationMs.$tag).toBe("Nothing");
    expect(resolved.error.$tag).toBe("Nothing");
  });

  it("completeTrace flips completedAt and durationMs from Nothing to Just", () => {
    const span = startTraceMirror({ id: "s1", instanceId: "i1", action: "state.read", resolved: null });
    expect(span.completedAt.$tag).toBe("Nothing");
    expect(span.durationMs.$tag).toBe("Nothing");

    completeTraceMirror(span, "completed");
    expect(span.completedAt.$tag).toBe("Just");
    expect(span.durationMs.$tag).toBe("Just");
    expect(span.status).toBe("completed");
    expect(span.error.$tag).toBe("Nothing"); // success path leaves error Nothing
    // Phase 14 — no output passed → stays Nothing.
    expect(span.output.$tag).toBe("Nothing");
  });

  it("completeTrace flips output to Just on success with value (Phase 14)", () => {
    const span = startTraceMirror({ id: "s1", instanceId: "i1", action: "state.read", resolved: null });
    completeTraceMirror(span, "completed", { rows: [{ id: 1 }] });
    expect(span.output).toEqual(Just({ rows: [{ id: 1 }] }));
    expect(span.status).toBe("completed");
  });

  it("completeTrace flips error to Just on failure", () => {
    const span = startTraceMirror({ id: "s1", instanceId: "i1", action: "state.read", resolved: null });
    completeTraceMirror(span, "failed", undefined, "boom");
    expect(span.error).toEqual(Just("boom"));
    expect(span.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // Phase 14 — new arms covering the Option A codec semantics + watch-outs.
  // -------------------------------------------------------------------------

  it("Phase 14 — Trace.output: Just(null) collapses to Nothing on codec round-trip (Option A lossy)", () => {
    // Writer emits Just(null) — TS-level distinct from Nothing.
    const trace = baseTrace({ output: Just(null) });
    const insertVals = traceToInsertValuesMirror(trace);
    // At the column: null (indistinguishable from Nothing).
    expect(insertVals.output).toBeNull();
    // Read back: comes through as Nothing — the Just(null) distinction is lost.
    const roundTripped = rowToTraceMirror(baseRow({ output: insertVals.output as Record<string, unknown> | null }));
    expect(roundTripped.output.$tag).toBe("Nothing");
  });

  it("Phase 14 — Trace.output: Just(non-null) round-trips through codec preserving Just", () => {
    const trace = baseTrace({ output: Just("hello") });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.output).toBe("hello");
    const roundTripped = rowToTraceMirror(baseRow({ output: insertVals.output as Record<string, unknown> | null }));
    expect(roundTripped.output).toEqual(Just("hello"));
  });

  it("Phase 14 — Trace.valueTypes: Just([]) collapses to null at codec write (empty-array sentinel)", () => {
    // Writer emits Just([]) — the codec treats empty arrays as "no types".
    const trace = baseTrace({ valueTypes: Just([]) });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.valueTypes).toBeNull();
    // Read back: comes through as Nothing.
    const roundTripped = rowToTraceMirror(baseRow({ valueTypes: insertVals.valueTypes }));
    expect(roundTripped.valueTypes.$tag).toBe("Nothing");
  });

  it("Phase 14 — Trace.input: Record round-trips through jsonb column preserving shape", () => {
    const payload = { token: "xyz", count: 7, nested: { a: 1 } };
    const trace = baseTrace({ input: Just(payload) });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.input).toEqual(payload);
    const roundTripped = rowToTraceMirror(baseRow({ input: insertVals.input }));
    expect(roundTripped.input).toEqual(Just(payload));
  });

  it("Phase 14 — Trace.stepPath: dotted-string round-trips through text column", () => {
    const trace = baseTrace({ stepPath: Just("0.2.1") });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.stepPath).toBe("0.2.1");
    const roundTripped = rowToTraceMirror(baseRow({ stepPath: insertVals.stepPath }));
    expect(roundTripped.stepPath).toEqual(Just("0.2.1"));
  });

  it("Phase 14 — Trace.valueTypes: non-empty array round-trips through jsonb column", () => {
    const trace = baseTrace({ valueTypes: Just(["Bot", "ChatId", "Profile"]) });
    const insertVals = traceToInsertValuesMirror(trace);
    expect(insertVals.valueTypes).toEqual(["Bot", "ChatId", "Profile"]);
    const roundTripped = rowToTraceMirror(baseRow({ valueTypes: insertVals.valueTypes }));
    expect(roundTripped.valueTypes).toEqual(Just(["Bot", "ChatId", "Profile"]));
  });

  it("Phase 14 — Trace closes the arc: zero `?:` slots, every slot Maybe<T> or non-optional", () => {
    // Type-shape pin: a fully-populated baseTrace has all 10 Maybe slots + the
    // 5 mandatory non-optional slots (id, instanceId, name, kind, startedAt,
    // status). If Trace re-introduces a `?:` slot, this literal stops typing.
    const t: Trace = {
      id: "t",
      instanceId: "i",
      parentId: Just("p"),
      name: "n",
      kind: "io",
      startedAt: "2026-05-27T00:00:00.000Z",
      completedAt: Just("2026-05-27T00:00:01.000Z"),
      durationMs: Just(1000),
      status: "completed",
      input: Just({ a: 1 }),
      output: Just(2),
      error: Nothing,
      capability: Just("state"),
      provider: Just("default"),
      meta: Nothing,
      valueTypes: Just(["X"]),
      stepPath: Just("0"),
    };
    // All Maybe-typed slots support $tag discrimination uniformly.
    expect(t.parentId.$tag).toBe("Just");
    expect(t.completedAt.$tag).toBe("Just");
    expect(t.durationMs.$tag).toBe("Just");
    expect(t.input.$tag).toBe("Just");
    expect(t.output.$tag).toBe("Just");
    expect(t.error.$tag).toBe("Nothing");
    expect(t.capability.$tag).toBe("Just");
    expect(t.provider.$tag).toBe("Just");
    expect(t.meta.$tag).toBe("Nothing");
    expect(t.valueTypes.$tag).toBe("Just");
    expect(t.stepPath.$tag).toBe("Just");
  });

  it("peelMaybeValue extracts the value or null on each slot type", () => {
    expect(peelMaybeValue<string>(Just("p1"))).toBe("p1");
    expect(peelMaybeValue<number>(Just(1000))).toBe(1000);
    expect(peelMaybeValue<string>(Nothing)).toBeNull();
    // Falsy-Just distinction (mirroring Phase 2 + 3 invariants on Just(0) /
    // Just("")) — peel returns the value, not null, even if falsy.
    expect(peelMaybeValue<number>(Just(0))).toBe(0);
    expect(peelMaybeValue<string>(Just(""))).toBe("");
  });
});
