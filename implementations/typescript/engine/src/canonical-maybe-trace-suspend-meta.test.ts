// ---------------------------------------------------------------------------
// Phase 12 of canonical-maybe (trace-meta-classify arc) — typed-variant
// split of `Trace.meta?: Record<string, unknown>` +
// `IOHandlerResult` `action:"suspend"`.meta?: Record<string, unknown>`.
//
// Both slots lifted to canonical `Maybe<TypedVariant>`:
//   - `Trace.meta: Maybe<TraceMeta>` where
//     `TraceMeta = LetBinding {letName: string}`.
//   - `IOHandlerResult.suspend.meta: Maybe<SuspendMeta>` where
//     `SuspendMeta = WaitEvent {event, filter}
//                  | AwaitingChoice {schema}
//                  | WaitTimer {wakeAt, retryReason: Maybe<RetryReason>}`
//     and `RetryReason = TelegramRetry {description}
//                      | NotionRetry {description}`.
// In-lockstep with this lift, `IOHandlerResult.suspend.status: string` is
// tightened to `SuspendStatus =
//   "waiting_event" | "awaiting_choice" | "waiting_timer" | "completed"`
// (audit identified four actually-emitted values across the runtime
// evaluator + handlers; the `end_function` handler's `"completed"` status
// is in the set even though it carries `meta: Nothing`).
//
// Tier A (semantic-absence) lift — runtime values not codec-boundary slots.
// Per-writer audit: 11 writer sites flipped (evaluator.ts:351, :313, :541
// for Trace.meta; evaluator.ts:1199, :1201, :1207, :1215, :1219, :1225
// for SuspendAction.meta; handlers/telegram.ts:122 + handlers/notion.ts:72
// for retry-suspends). Per-reader audit: triggers.ts (3 sites) + home.tsx
// (1 site) + fenel/modules/dashboard/io.fenel (1 site).
//
// Pins:
//
//   1. `Trace.meta` typed as `Maybe<TraceMeta>` — accepts `Just(LetBinding)`
//      + `Nothing` literals at compile time; older `Record<string, unknown>`
//      bag is no longer admissible.
//   2. `IOHandlerResult.suspend.meta` typed as `Maybe<SuspendMeta>` — each
//      tagged variant typechecks; raw-record meta is no longer admissible.
//   3. `IOHandlerResult.suspend.status` typed as `SuspendStatus` — only
//      the closed set of suspend statuses typechecks.
//   4. `RetryReason` variant captures the previously-implicit
//      `_telegramRetryReason` / `_notionRetryReason` typing.
//   5. Migration 0067 walker (Trace.meta lift): NULL → Nothing; empty
//      `{}` → Nothing; `{letName:"X"}` → `Just(LetBinding {letName:"X"})`;
//      idempotent on already-tagged.
//   6. Migration 0068 walker (SuspendAction.meta lift): underscored-key
//      shapes lift to `_suspendMeta` with appropriate `$tag`; idempotent
//      on already-present `_suspendMeta`.
//   7. Both walkers preserve unrelated keys on rows they don't recognise.
//   8. Reader path (`peelMaybeValue(meta)` + `$tag` cascade) reads each
//      tagged variant correctly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue, type Maybe } from "./type-foundation";
import type {
  Trace,
  TraceMeta,
  IOHandlerResult,
  SuspendStatus,
  SuspendMeta,
  RetryReason,
} from "./types";

// -- TS-side mirror of the PL/pgSQL walker in migration 0067. ----------------

function liftTraceMetaWalk(meta: unknown): unknown {
  // Already canonical Maybe shape — idempotent
  if (meta !== null && typeof meta === "object" && "$tag" in (meta as object)) {
    return meta;
  }
  // NULL → Nothing
  if (meta === null || meta === undefined) {
    return { $tag: "Nothing" };
  }
  // Empty object → Nothing
  if (typeof meta === "object" && Object.keys(meta as object).length === 0) {
    return { $tag: "Nothing" };
  }
  // Has letName → Just(LetBinding)
  if (typeof meta === "object" && "letName" in (meta as object)) {
    return {
      $tag: "Just",
      _0: { $tag: "LetBinding", letName: (meta as { letName: string }).letName },
    };
  }
  // Unknown shape — leave verbatim
  return meta;
}

// -- TS-side mirror of the PL/pgSQL walker in migration 0068. ----------------

function liftSuspendMetaWalk(variables: Record<string, unknown>): Record<string, unknown> {
  // Already migrated — idempotent
  if ("_suspendMeta" in variables) return variables;

  const result = { ...variables };

  if ("_wakeAt" in result && "_telegramRetryReason" in result) {
    const wakeAt = result._wakeAt;
    const desc = result._telegramRetryReason;
    delete result._wakeAt;
    delete result._telegramRetryReason;
    result._suspendMeta = {
      $tag: "WaitTimer",
      wakeAt,
      retryReason: {
        $tag: "Just",
        _0: { $tag: "TelegramRetry", description: desc },
      },
    };
    return result;
  }

  if ("_wakeAt" in result && "_notionRetryReason" in result) {
    const wakeAt = result._wakeAt;
    const desc = result._notionRetryReason;
    delete result._wakeAt;
    delete result._notionRetryReason;
    result._suspendMeta = {
      $tag: "WaitTimer",
      wakeAt,
      retryReason: {
        $tag: "Just",
        _0: { $tag: "NotionRetry", description: desc },
      },
    };
    return result;
  }

  if ("_wakeAt" in result) {
    const wakeAt = result._wakeAt;
    delete result._wakeAt;
    result._suspendMeta = {
      $tag: "WaitTimer",
      wakeAt,
      retryReason: { $tag: "Nothing" },
    };
    return result;
  }

  if ("_waitFilter" in result) {
    const filter = result._waitFilter as { event?: unknown };
    delete result._waitFilter;
    result._suspendMeta = {
      $tag: "WaitEvent",
      event: filter.event ?? "",
      filter,
    };
    return result;
  }

  if ("_readSchema" in result) {
    const schema = result._readSchema;
    delete result._readSchema;
    result._suspendMeta = {
      $tag: "AwaitingChoice",
      schema,
    };
    return result;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 12 — Trace.meta lifted to Maybe<TraceMeta>", () => {
  it("accepts Just(LetBinding) + Nothing literals", () => {
    const m1: Maybe<TraceMeta> = Just({ $tag: "LetBinding", letName: "x" });
    const m2: Maybe<TraceMeta> = Nothing;
    expect(m1.$tag).toBe("Just");
    expect(m2.$tag).toBe("Nothing");
    if (m1.$tag === "Just") {
      expect(m1._0.$tag).toBe("LetBinding");
      expect(m1._0.letName).toBe("x");
    }
  });

  it("Trace requires meta as Maybe<TraceMeta> — type-shape pin", () => {
    // This test pins the type-shape; if Trace.meta drifts back to optional
    // or to `Record<string, unknown>`, the literal below stops typechecking
    // (and the whole engine-tsc baseline shifts — surfacing the drift).
    const t: Trace = {
      id: "t",
      instanceId: "i",
      parentId: Nothing,
      name: "fn",
      kind: "let",
      startedAt: "2026-05-27T00:00:00.000Z",
      completedAt: Nothing,
      durationMs: Nothing,
      status: "completed",
      error: Nothing,
      capability: Nothing,
      provider: Nothing,
      meta: Just({ $tag: "LetBinding", letName: "letNameVar" }),
      input: Nothing,
      output: Nothing,
      valueTypes: Nothing,
      stepPath: Nothing,
    };
    expect(peelMaybeValue(t.meta)?.$tag).toBe("LetBinding");
  });
});

describe("Phase 12 — IOHandlerResult suspend lifted to Maybe<SuspendMeta>", () => {
  it("accepts each SuspendMeta variant + Nothing", () => {
    const e: SuspendMeta = { $tag: "WaitEvent", event: "X", filter: { event: "X" } };
    const c: SuspendMeta = { $tag: "AwaitingChoice", schema: { prompt: "?" } };
    const t1: SuspendMeta = { $tag: "WaitTimer", wakeAt: "2026-01-01", retryReason: Nothing };
    const tr: RetryReason = { $tag: "TelegramRetry", description: "rate-limit" };
    const nr: RetryReason = { $tag: "NotionRetry", description: "rate-limit" };
    const t2: SuspendMeta = { $tag: "WaitTimer", wakeAt: "2026-01-01", retryReason: Just(tr) };
    const t3: SuspendMeta = { $tag: "WaitTimer", wakeAt: "2026-01-01", retryReason: Just(nr) };
    expect(e.$tag).toBe("WaitEvent");
    expect(c.$tag).toBe("AwaitingChoice");
    expect(t1.$tag).toBe("WaitTimer");
    expect(t2.$tag).toBe("WaitTimer");
    expect(t3.$tag).toBe("WaitTimer");
  });

  it("IOHandlerResult.suspend.status typed as SuspendStatus — closed union pin", () => {
    const r1: IOHandlerResult = { action: "suspend", status: "waiting_event", meta: Nothing };
    const r2: IOHandlerResult = { action: "suspend", status: "awaiting_choice", meta: Nothing };
    const r3: IOHandlerResult = { action: "suspend", status: "waiting_timer", meta: Nothing };
    const r4: IOHandlerResult = { action: "suspend", status: "completed", meta: Nothing };
    expect([r1, r2, r3, r4].every((r) => r.action === "suspend")).toBe(true);

    const allowed: SuspendStatus[] = ["waiting_event", "awaiting_choice", "waiting_timer", "completed"];
    expect(allowed.length).toBe(4);
  });
});

describe("Phase 12 — Migration 0067 (Trace.meta lift) walker", () => {
  it("NULL → Nothing", () => {
    expect(liftTraceMetaWalk(null)).toEqual({ $tag: "Nothing" });
  });
  it("empty {} → Nothing", () => {
    expect(liftTraceMetaWalk({})).toEqual({ $tag: "Nothing" });
  });
  it("{letName} → Just(LetBinding)", () => {
    expect(liftTraceMetaWalk({ letName: "X" })).toEqual({
      $tag: "Just",
      _0: { $tag: "LetBinding", letName: "X" },
    });
  });
  it("idempotent on already-tagged Just shape", () => {
    const already = { $tag: "Just", _0: { $tag: "LetBinding", letName: "Y" } };
    expect(liftTraceMetaWalk(already)).toBe(already);
  });
  it("idempotent on already-tagged Nothing", () => {
    const already = { $tag: "Nothing" };
    expect(liftTraceMetaWalk(already)).toBe(already);
  });
  it("preserves unknown shapes verbatim (defensive)", () => {
    const unknown = { someOtherKey: 1, anotherKey: "hi" };
    expect(liftTraceMetaWalk(unknown)).toBe(unknown);
  });
});

describe("Phase 12 — Migration 0068 (SuspendAction.meta lift) walker", () => {
  it("_wakeAt + _telegramRetryReason → WaitTimer with TelegramRetry", () => {
    const result = liftSuspendMetaWalk({
      _wakeAt: "2026-01-01",
      _telegramRetryReason: "rate-limit",
      otherKey: "preserve me",
    });
    expect(result._suspendMeta).toEqual({
      $tag: "WaitTimer",
      wakeAt: "2026-01-01",
      retryReason: {
        $tag: "Just",
        _0: { $tag: "TelegramRetry", description: "rate-limit" },
      },
    });
    expect(result.otherKey).toBe("preserve me");
    expect("_wakeAt" in result).toBe(false);
    expect("_telegramRetryReason" in result).toBe(false);
  });

  it("_wakeAt + _notionRetryReason → WaitTimer with NotionRetry", () => {
    const result = liftSuspendMetaWalk({
      _wakeAt: "2026-01-02",
      _notionRetryReason: "rate-limit-notion",
    });
    expect(result._suspendMeta).toEqual({
      $tag: "WaitTimer",
      wakeAt: "2026-01-02",
      retryReason: {
        $tag: "Just",
        _0: { $tag: "NotionRetry", description: "rate-limit-notion" },
      },
    });
  });

  it("_wakeAt only → WaitTimer with retryReason Nothing", () => {
    const result = liftSuspendMetaWalk({ _wakeAt: "2026-01-03" });
    expect(result._suspendMeta).toEqual({
      $tag: "WaitTimer",
      wakeAt: "2026-01-03",
      retryReason: { $tag: "Nothing" },
    });
  });

  it("_waitFilter → WaitEvent", () => {
    const result = liftSuspendMetaWalk({
      _waitFilter: { event: "user_clicked", foo: "bar" },
    });
    expect(result._suspendMeta).toEqual({
      $tag: "WaitEvent",
      event: "user_clicked",
      filter: { event: "user_clicked", foo: "bar" },
    });
  });

  it("_readSchema → AwaitingChoice", () => {
    const result = liftSuspendMetaWalk({
      _readSchema: { prompt: "Pick one", source: "event:X" },
    });
    expect(result._suspendMeta).toEqual({
      $tag: "AwaitingChoice",
      schema: { prompt: "Pick one", source: "event:X" },
    });
  });

  it("idempotent when _suspendMeta already present", () => {
    const already = {
      _suspendMeta: { $tag: "WaitTimer", wakeAt: "2026-01-04", retryReason: { $tag: "Nothing" } },
      otherKey: "x",
    };
    expect(liftSuspendMetaWalk(already)).toBe(already);
  });

  it("no-op when no recognized underscored key", () => {
    const noKeys = { _evalStack: [], _letTarget: "x", regularVar: 5 };
    const result = liftSuspendMetaWalk(noKeys);
    expect("_suspendMeta" in result).toBe(false);
    expect(result._evalStack).toEqual([]);
    expect(result._letTarget).toBe("x");
    expect(result.regularVar).toBe(5);
  });

  it("preserves runtime state keys (_evalStack / _letTarget) during lift", () => {
    const withRuntime = {
      _wakeAt: "2026-01-05",
      _evalStack: [{ stepId: "0.1" }],
      _letTarget: "myBinding",
    };
    const result = liftSuspendMetaWalk(withRuntime);
    expect(result._evalStack).toEqual([{ stepId: "0.1" }]);
    expect(result._letTarget).toBe("myBinding");
    expect((result._suspendMeta as { $tag: string }).$tag).toBe("WaitTimer");
  });
});

describe("Phase 12 — Reader dispatch path", () => {
  it("LetBinding read via peelMaybeValue + $tag cascade", () => {
    const meta: Maybe<TraceMeta> = Just({ $tag: "LetBinding", letName: "x" });
    const peeled = peelMaybeValue(meta);
    expect(peeled?.$tag).toBe("LetBinding");
    expect(peeled?.$tag === "LetBinding" ? peeled.letName : undefined).toBe("x");
  });

  it("WaitTimer.retryReason nested Maybe dispatch", () => {
    const sm: SuspendMeta = {
      $tag: "WaitTimer",
      wakeAt: "2026-01-06",
      retryReason: Just({ $tag: "TelegramRetry", description: "rate-limit" }),
    };
    if (sm.$tag === "WaitTimer") {
      const rr = peelMaybeValue(sm.retryReason);
      expect(rr?.$tag).toBe("TelegramRetry");
      expect(rr?.$tag === "TelegramRetry" ? rr.description : undefined).toBe("rate-limit");
    }
  });

  it("WaitEvent filter preserves the event + arbitrary extra keys", () => {
    const sm: SuspendMeta = {
      $tag: "WaitEvent",
      event: "user_signed_up",
      filter: { event: "user_signed_up", referrer: "$source" },
    };
    if (sm.$tag === "WaitEvent") {
      expect(sm.event).toBe("user_signed_up");
      expect(sm.filter.referrer).toBe("$source");
    }
  });
});
