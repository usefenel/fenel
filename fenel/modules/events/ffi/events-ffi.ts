// ---------------------------------------------------------------------------
// Events — FFI leaf (the irreducible host bridges: the CTX-threading FRP
// natives that build Behavior closures + re-enter the evaluator, plus the
// pure plain `_stepLookup` lookup).
//
// module-substrate Phase 3i — events is a DISJOINT plain/ctx module (=
// picture's 3f shape). The split:
//   - PLAIN native (`_stepLookup`) — a pure most-recent-payload scan, no ctx
//     → `eventsNatives` → the module's `nativeImpls`;
//   - CTX natives (`step` / `accum` / `_accumFold` / `sampleBehavior` /
//     `behaviorToAnim` / `behaviorToSound`) — take the `EvaluateContext` as
//     their first arg (`accum`/`_accumFold`/`sampleBehavior` re-enter the
//     evaluator via `invokeCallable` to run the fold fn / Behavior closure;
//     `step`/`behaviorToAnim`/`behaviorToSound` build / retag closures and
//     take ctx only for the uniform ctx-native arity) → `eventsNativesCtx`
//     → the module's `nativeImplsCtx`. Which map an impl lands in is the ONLY
//     thing that decides plain-vs-ctx — no `.fenel` marker (the `@native`
//     foreign decl is uniform; the seam routes — axis #4 settled).
//
// AXIS DECISION (brief axis #2) — this leaf imports `invokeCallable` +
// `EvaluateContext` from the engine internals (the `fenel/ffi → engine` edge
// picture proved). The 3b rootDir→repo-root build-wiring makes it compile
// under `--noEmit`.
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `accumNative` / `accumFoldNative` / `sampleBehaviorNative` are genuine
// bridge leaves — they re-enter the evaluator (via `invokeCallable`) to run a
// fold closure or sample a Behavior, which a `.fenel` body can't do. But the
// body logic — `asEntries` / `timeSeconds` (record-reshaping), the WHOLE of
// `stepLookupNative` (a sort + most-recent scan), the BehaviorAt-closure
// construction in `stepNative`, and the retag-only `behaviorToAnimNative` /
// `behaviorToSoundNative` — is PURE arithmetic / record-reshaping that
// composes from std fns. They are parked here to preserve Phase-3i PARITY
// (byte-for-byte), NOT because they belong at an ffi leaf — same posture as
// picture's / codec's pure helpers. A Fenel re-port is a candidate for a
// later coordinated sweep; porting now would be a re-port the parity brief
// forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

type EventEntryValue = { timestamp: number; payload: unknown };

function asEntries(v: unknown): EventEntryValue[] {
  const entries = (v as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => ({
    timestamp: Number((e as { timestamp?: unknown })?.timestamp) || 0,
    payload: (e as { payload?: unknown })?.payload,
  }));
}

function timeSeconds(v: unknown): number {
  return Number((v as { seconds?: unknown })?.seconds) || 0;
}

// ---------------------------------------------------------------------------
// `_stepLookup` — PLAIN native: most-recent-event-payload-or-init lookup.
// ---------------------------------------------------------------------------

/** Behavior-side step lookup: the helper invoked from the closure body
 *  produced by `step`. Walks the entries in timestamp order, returning
 *  the most recent payload whose timestamp <= t (or `init` before any). */
function stepLookupNative(init: unknown, entries: unknown, time: unknown): unknown {
  if (!Array.isArray(entries)) return init;
  const arr = (entries as EventEntryValue[]).slice().sort((a, b) => a.timestamp - b.timestamp);
  const t = timeSeconds(time);
  let result = init;
  for (const e of arr) {
    if (e.timestamp > t) break;
    result = e.payload;
  }
  return result;
}

// ---------------------------------------------------------------------------
// CTX natives — step / accum / _accumFold / sampleBehavior / behaviorToAnim /
// behaviorToSound.
// ---------------------------------------------------------------------------

/** `step init events` — produce a Behavior that holds the most recent
 *  event's payload. Before the first event, the Behavior returns `init`. */
function stepNative(_ctx: EvaluateContext, init: unknown, event: unknown): unknown {
  const entries = asEntries(event);
  return {
    $tag: "BehaviorAt",
    _0: {
      __fenelFn: true,
      params: ["t"],
      body: { call: ["_stepLookup", { var: "_init" }, { var: "_entries" }, { var: "t" }] },
      closure: { _init: init, _entries: entries },
    },
  };
}

/** Behavior-side accum lookup: fold from `init` over all entries whose
 *  timestamp <= t, applying `fn` (state, payload) -> state at each step. */
function accumFoldNative(
  ctx: EvaluateContext,
  init: unknown,
  fn: unknown,
  entries: unknown,
  time: unknown,
): unknown {
  if (!Array.isArray(entries)) return init;
  const arr = (entries as EventEntryValue[]).slice().sort((a, b) => a.timestamp - b.timestamp);
  const t = timeSeconds(time);
  let state = init;
  for (const e of arr) {
    if (e.timestamp > t) break;
    state = invokeCallable(fn, [state, e.payload], ctx);
  }
  return state;
}

/** `accum init fn events` — produce a Behavior whose value at time t is
 *  the result of folding `fn` over every event with timestamp <= t,
 *  starting from `init`. The standard "derive state from event stream"
 *  bridge — game state, scoreboards, accumulators all use this. */
function accumNative(
  _ctx: EvaluateContext,
  init: unknown,
  fn: unknown,
  event: unknown,
): unknown {
  const entries = asEntries(event);
  return {
    $tag: "BehaviorAt",
    _0: {
      __fenelFn: true,
      params: ["t"],
      body: {
        call: ["_accumFold", { var: "_init" }, { var: "_fn" }, { var: "_entries" }, { var: "t" }],
      },
      closure: { _init: init, _fn: fn, _entries: entries },
    },
  };
}

/** Sample a Behavior at a Time. Variant dispatch: invoke the carried
 *  closure with the time. */
function sampleBehaviorNative(
  ctx: EvaluateContext,
  behavior: unknown,
  time: unknown,
): unknown {
  if (!behavior || typeof behavior !== "object") return null;
  const obj = behavior as Record<string, unknown>;
  if (obj.$tag !== "BehaviorAt") return null;
  for (const key of Object.keys(obj)) {
    if (key === "$tag") continue;
    const callable = obj[key];
    return invokeCallable(callable, [time], ctx);
  }
  return null;
}

/** `behaviorToAnim` — bridge a `Behavior Picture` to an `Animation`. Both
 *  are time-indexed function wrappers; this just retags the value. The
 *  caller owes us a Behavior whose codomain is actually a Picture; the
 *  type system would catch a mismatch later, render-time would clearly
 *  fail with a non-Picture being sampled. */
function behaviorToAnimNative(_ctx: EvaluateContext, behavior: unknown): unknown {
  if (!behavior || typeof behavior !== "object") return null;
  const obj = behavior as Record<string, unknown>;
  if (obj.$tag !== "BehaviorAt") return null;
  for (const key of Object.keys(obj)) {
    if (key === "$tag") continue;
    return { $tag: "Animate", _0: obj[key] };
  }
  return null;
}

/** `behaviorToSound` — bridge a `Behavior Amplitude` to a `Sound`. Same
 *  retag-only operation. */
function behaviorToSoundNative(_ctx: EvaluateContext, behavior: unknown): unknown {
  if (!behavior || typeof behavior !== "object") return null;
  const obj = behavior as Record<string, unknown>;
  if (obj.$tag !== "BehaviorAt") return null;
  for (const key of Object.keys(obj)) {
    if (key === "$tag") continue;
    return { $tag: "Wave", _0: obj[key] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the
// `events:` id-namespace via `rekeyNativesById` and attaches them to the
// FenelModule's `nativeImpls` (plain) + `nativeImplsCtx` (ctx). Same plain
// `Record<codeName, JsFn>` shape the spec file declared before the split;
// only the FILE LOCATION moved.
// ---------------------------------------------------------------------------

export const eventsNatives: Record<string, (...args: unknown[]) => unknown> = {
  _stepLookup: stepLookupNative,
};

export const eventsNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  step: stepNative,
  accum: accumNative,
  _accumFold: accumFoldNative,
  sampleBehavior: sampleBehaviorNative,
  behaviorToAnim: behaviorToAnimNative,
  behaviorToSound: behaviorToSoundNative,
};

export {
  stepNative,
  accumNative,
  accumFoldNative,
  stepLookupNative,
  sampleBehaviorNative,
  behaviorToAnimNative,
  behaviorToSoundNative,
};
