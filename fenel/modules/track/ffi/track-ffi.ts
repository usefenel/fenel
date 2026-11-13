// ---------------------------------------------------------------------------
// Track — FFI leaf (the irreducible host bridge: the CTX-threading
// `sampleTrackAt`/`mixDown` natives that re-enter the evaluator to mix every
// entry's Sound at a given time).
//
// module-substrate Phase 3g — track is a CTX-ONLY composer: it has NO plain
// native (`trackNatives = {}`), only the two ctx natives. (The two pure record
// constructors `track` / `trackEntry` are Fenel-bodied helpers, NOT natives —
// they consolidate into `types.fenel`.) The natives re-enter the evaluator via
// `sampleSoundNative` (and the `mixDown` closure re-calls `sampleTrackAt` by
// codeName) → take the `EvaluateContext` as their first arg → `trackNativesCtx`
// → the module's `nativeImplsCtx`.
//
// AXIS DECISION (Phase 3g cross-module ffi-leaf import) — this leaf imports a
// SIBLING MEDIA LEAF's native LEAF-TO-LEAF (a `fenel/ffi → fenel/ffi` edge):
// `sampleSoundNative` + the `AmplitudeValue` type from `../../sound/ffi/
// sound-ffi` (a SAME-PHASE base, 3g), to sample each entry's Sound. Never
// bounces through the engine seam.
//
// F-PERMANENT-REVISIT FLAG: `sampleTrackAtNative` / `mixDownNative` are genuine
// bridge leaves — they re-enter the evaluator (via sampleSound / a closure
// re-calling sampleTrackAt). The pure helper `clampUnit` (amplitude clamp) is
// parked here to preserve Phase-3g PARITY (byte-for-byte with the retired
// `engine/src/modules/track.ts` native), same posture as sound's `clampUnit`;
// a Fenel re-port is a later-sweep candidate the parity brief forbids porting
// now.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is a media-cluster leaf.
// ---------------------------------------------------------------------------

import { type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import { sampleSoundNative, type AmplitudeValue } from "../../sound/ffi/sound-ffi";

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const SILENT_AMP: AmplitudeValue = { l: 0, r: 0 };

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return 1;
  if (n < -1) return -1;
  return n;
}

// ---------------------------------------------------------------------------
// CTX natives — re-enter the evaluator to mix entry Sounds.
// ---------------------------------------------------------------------------

/** Sample every entry of a Track at the given time and return the
 *  channel-wise sum (clamped to [-1, 1]). Used internally by the closure
 *  that `mixDown` returns; also exported as a function so users can mix at
 *  a specific time without rendering. */
function sampleTrackAtNative(
  ctx: EvaluateContext,
  track: unknown,
  time: unknown,
): AmplitudeValue {
  const entries = ((track as { entries?: unknown })?.entries ?? []) as Array<{
    start?: unknown;
    sound?: unknown;
  }>;
  if (entries.length === 0) return SILENT_AMP;
  const tSeconds = Number((time as { seconds?: unknown })?.seconds ?? 0);
  let l = 0;
  let r = 0;
  for (const e of entries) {
    const start = Number(e.start) || 0;
    if (tSeconds < start) continue; // entry hasn't started yet
    const localT = { seconds: tSeconds - start };
    const amp = sampleSoundNative(ctx, e.sound, localT);
    l += amp.l;
    r += amp.r;
  }
  return { l: clampUnit(l), r: clampUnit(r) };
}

/** Collapse a Track into a Sound. The returned Sound is a Wave whose
 *  per-time amplitude is the sum of every entry's contribution at that
 *  moment — the standard mixing model. */
function mixDownNative(_ctx: EvaluateContext, track: unknown): unknown {
  return {
    $tag: "Wave",
    _0: {
      __fenelFn: true,
      params: ["t"],
      body: { call: ["sampleTrackAt", { var: "_track" }, { var: "t" }] },
      closure: { _track: track },
    },
  };
}

// ---------------------------------------------------------------------------
// The native maps. `trackNatives` is EMPTY (track has no plain native — the
// `track` / `trackEntry` constructors are Fenel-bodied, not natives);
// `trackNativesCtx` holds the two ctx natives. The seam rekeys each to the
// `track:` id-namespace and attaches them to `nativeImpls` (plain, empty) +
// `nativeImplsCtx` (ctx).
// ---------------------------------------------------------------------------

export const trackNatives: Record<string, (...args: unknown[]) => unknown> = {};

export const trackNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sampleTrackAt: (ctx: EvaluateContext, track: unknown, time: unknown) =>
    sampleTrackAtNative(ctx, track, time),
  mixDown: (ctx: EvaluateContext, track: unknown) => mixDownNative(ctx, track),
};

export {
  sampleTrackAtNative,
  mixDownNative,
};
