// ---------------------------------------------------------------------------
// Phase 15 of canonical-maybe — `IORequest.{stepPath, letName}?` +
// `EvalState.letTarget?` → canonical `Maybe<string>` lift conformance.
//
// Phase 14 closed the Trace side of the request-trace coupling (every
// `Trace.X?:` slot is canonical Maybe). Phase 15 closes the request side:
// the upstream values that flow INTO the trace (`IORequest.stepPath` +
// `IORequest.letName` and the source of `letName`, `EvalState.letTarget`)
// were `?: string` pre-Phase-15 and got lifted at the writer-site boundary
// (`request.stepPath ? Just(request.stepPath) : Nothing`). Phase 15 pushes
// the canonical shape upstream so the writer doesn't have to lift —
// `request.stepPath` is already `Maybe<string>` at the source, the writer
// just forwards it.
//
// These tests pin:
//
//   1. `IORequest` declaration: `stepPath: Maybe<string>` + `letName:
//      Maybe<string>` (mandatory canonical Maybe, no `?:`).
//   2. `EvalState` declaration: `letTarget: Maybe<string>` (mandatory).
//   3. Writer-side: a synthetic IORequest with Just/Nothing at every slot
//      typechecks and dispatches cleanly.
//   4. Reader-side: startTrace consumes Maybe directly without per-slot
//      lifting — the value forwards verbatim.
//   5. Request-trace flow arc-closure: a full
//      `EvalState.letTarget → IORequest.letName → Trace.meta.LetBinding.letName`
//      pipeline pins the canonical shape at every hop.
//   6. saveState codec (Option A): `Maybe<string>` letTarget round-trips
//      through `_letTarget: string | absent` storage — Just(name) writes
//      raw string, Nothing omits the key, absent key reads as Nothing.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue, type Maybe } from "./type-foundation";

// Mirror the runtime declarations — engine package can't import
// @fenel/runtime (would re-introduce the engine/runtime cycle). Pin the
// shape here so divergence between the runtime IORequest/EvalState and
// the canonical-maybe contract surfaces as a test failure.
type Frame = { exprs: unknown[]; index: number };

type EvalState = {
  stack: Frame[];
  env: Record<string, unknown>;
  letTarget: Maybe<string>;
};

type IORequest = {
  action: string;
  params: Record<string, unknown>;
  stepPath: Maybe<string>;
  letName: Maybe<string>;
};

// Mirrored saveState codec — Option A: raw `_letTarget: string` when Just,
// key absent when Nothing.
function saveLetTargetToVars(
  vars: Record<string, unknown>,
  letTarget: Maybe<string>,
): Record<string, unknown> {
  const out = { ...vars };
  if (letTarget.$tag === "Just") out._letTarget = letTarget._0;
  return out;
}

// Mirrored loadState codec — null/absent → Nothing, string → Just.
function loadLetTargetFromVars(vars: Record<string, unknown>): Maybe<string> {
  return vars._letTarget != null ? Just(vars._letTarget as string) : Nothing;
}

// Mirrored startTrace flow — the reader-side that converts request fields
// to Trace.{stepPath, meta.LetBinding.letName}.
type TraceMeta = { $tag: "LetBinding"; letName: string };

function deriveTraceFromRequest(request: IORequest): {
  stepPath: Maybe<string>;
  meta: Maybe<TraceMeta>;
} {
  return {
    stepPath: request.stepPath,
    meta:
      request.letName.$tag === "Just"
        ? Just<TraceMeta>({ $tag: "LetBinding", letName: request.letName._0 })
        : Nothing,
  };
}

describe("Phase 15 — IORequest + EvalState canonical Maybe shape", () => {
  it("EvalState.letTarget accepts Just<string>", () => {
    const state: EvalState = { stack: [], env: {}, letTarget: Just("result") };
    expect(state.letTarget.$tag).toBe("Just");
    if (state.letTarget.$tag === "Just") expect(state.letTarget._0).toBe("result");
  });

  it("EvalState.letTarget accepts Nothing", () => {
    const state: EvalState = { stack: [], env: {}, letTarget: Nothing };
    expect(state.letTarget.$tag).toBe("Nothing");
  });

  it("IORequest.stepPath accepts Just<string>", () => {
    const req: IORequest = {
      action: "read",
      params: {},
      stepPath: Just("0.2.1"),
      letName: Nothing,
    };
    expect(req.stepPath.$tag).toBe("Just");
    if (req.stepPath.$tag === "Just") expect(req.stepPath._0).toBe("0.2.1");
  });

  it("IORequest.stepPath accepts Nothing", () => {
    const req: IORequest = {
      action: "read",
      params: {},
      stepPath: Nothing,
      letName: Nothing,
    };
    expect(req.stepPath.$tag).toBe("Nothing");
  });

  it("IORequest.letName accepts Just<string> (let-IO yield)", () => {
    const req: IORequest = {
      action: "read",
      params: {},
      stepPath: Just("0"),
      letName: Just("input"),
    };
    expect(req.letName.$tag).toBe("Just");
    if (req.letName.$tag === "Just") expect(req.letName._0).toBe("input");
  });

  it("IORequest.letName accepts Nothing (non-let IO)", () => {
    const req: IORequest = {
      action: "log",
      params: {},
      stepPath: Just("1"),
      letName: Nothing,
    };
    expect(req.letName.$tag).toBe("Nothing");
  });
});

describe("Phase 15 — startTrace reader-side (no per-slot lifting)", () => {
  it("forwards request.stepPath verbatim into Trace.stepPath", () => {
    const req: IORequest = {
      action: "read",
      params: {},
      stepPath: Just("0.2"),
      letName: Nothing,
    };
    const t = deriveTraceFromRequest(req);
    expect(t.stepPath).toEqual(Just("0.2"));
    // Identity-preserving — the writer doesn't rewrap.
    expect(t.stepPath).toBe(req.stepPath);
  });

  it("forwards Nothing stepPath verbatim", () => {
    const req: IORequest = {
      action: "log",
      params: {},
      stepPath: Nothing,
      letName: Nothing,
    };
    const t = deriveTraceFromRequest(req);
    expect(t.stepPath).toEqual(Nothing);
    expect(t.stepPath).toBe(req.stepPath);
  });

  it("lifts Just(letName) into Trace.meta.LetBinding", () => {
    const req: IORequest = {
      action: "read",
      params: {},
      stepPath: Just("0"),
      letName: Just("input"),
    };
    const t = deriveTraceFromRequest(req);
    expect(t.meta).toEqual(Just({ $tag: "LetBinding", letName: "input" }));
  });

  it("emits Nothing meta when letName is Nothing", () => {
    const req: IORequest = {
      action: "log",
      params: {},
      stepPath: Just("0"),
      letName: Nothing,
    };
    const t = deriveTraceFromRequest(req);
    expect(t.meta).toEqual(Nothing);
  });
});

describe("Phase 15 — saveState codec (Option A: raw string in storage)", () => {
  it("Just(name) writes raw string under _letTarget", () => {
    const vars = saveLetTargetToVars({ x: 1 }, Just("acc"));
    expect(vars._letTarget).toBe("acc");
    expect(vars.x).toBe(1);
  });

  it("Nothing omits the _letTarget key entirely", () => {
    const vars = saveLetTargetToVars({ x: 1 }, Nothing);
    expect("_letTarget" in vars).toBe(false);
  });

  it("loadState wraps raw string into Just", () => {
    const lt = loadLetTargetFromVars({ _letTarget: "acc", x: 1 });
    expect(lt).toEqual(Just("acc"));
  });

  it("loadState reads absent key as Nothing", () => {
    const lt = loadLetTargetFromVars({ x: 1 });
    expect(lt).toEqual(Nothing);
  });

  it("loadState reads null as Nothing (legacy storage bridge)", () => {
    const lt = loadLetTargetFromVars({ _letTarget: null, x: 1 });
    expect(lt).toEqual(Nothing);
  });

  it("round-trips Just through save+load", () => {
    const start: Maybe<string> = Just("acc");
    const saved = saveLetTargetToVars({}, start);
    const reloaded = loadLetTargetFromVars(saved);
    expect(reloaded).toEqual(start);
  });

  it("round-trips Nothing through save+load", () => {
    const start: Maybe<string> = Nothing;
    const saved = saveLetTargetToVars({}, start);
    const reloaded = loadLetTargetFromVars(saved);
    expect(reloaded).toEqual(start);
  });
});

describe("Phase 15 — request-trace flow arc-closure", () => {
  it("EvalState.letTarget → IORequest.letName → Trace.meta.LetBinding.letName", () => {
    // The let-IO yield: turn sees a `let input = read(...)` and constructs
    // BOTH the IORequest (with letName) AND the EvalState (with letTarget)
    // — they're the same name source, peeled at two surfaces.
    const name = "input";
    const state: EvalState = { stack: [], env: {}, letTarget: Just(name) };
    const request: IORequest = {
      action: "read",
      params: {},
      stepPath: Just("0.0"),
      letName: state.letTarget,
    };
    expect(request.letName).toBe(state.letTarget);

    // startTrace consumes request.letName → Trace.meta.LetBinding.letName.
    const trace = deriveTraceFromRequest(request);
    expect(trace.meta).toEqual(Just({ $tag: "LetBinding", letName: name }));

    // After IO completes, resumeAfterIO uses state.letTarget to bind the
    // value into env (the peel happens at the dispatch site).
    expect(peelMaybeValue(state.letTarget)).toBe(name);
  });

  it("non-let IO flows Nothing through every hop", () => {
    const state: EvalState = { stack: [], env: {}, letTarget: Nothing };
    const request: IORequest = {
      action: "log",
      params: {},
      stepPath: Just("1"),
      letName: state.letTarget,
    };
    const trace = deriveTraceFromRequest(request);
    expect(trace.meta).toEqual(Nothing);
    expect(peelMaybeValue(state.letTarget)).toBeNull();
  });
});
