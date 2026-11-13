// ---------------------------------------------------------------------------
// Animation — FFI leaf (the irreducible host bridge: the CTX-threading
// `sampleAnim`/`renderAnim` natives that re-enter the evaluator).
//
// module-substrate Phase 3g — animation is a CTX-ONLY composer: it has NO plain
// native (`animNatives = {}`), only the two ctx natives. This is the simpler
// sub-case the picture both-maps proof already covers (an empty plain map +
// a populated ctx map). The two natives re-enter the evaluator via
// `invokeCallable` to run an `Animate`'s `Time -> Picture` closure → take the
// `EvaluateContext` as their first arg → `animNativesCtx` → the module's
// `nativeImplsCtx`.
//
// AXIS DECISION (Phase 3g cross-module ffi-leaf import) — this leaf imports a
// SIBLING MEDIA LEAF's native LEAF-TO-LEAF (a `fenel/ffi → fenel/ffi` edge):
// `renderNative` from `../../picture/ffi/picture-ffi` (a PREVIOUSLY-migrated
// base, 3f), to rasterise each frame's Picture. Never bounces through the
// engine seam.
//
// NOTE — `frameSequence` is NOT here: it is a PURE Fenel-bodied helper (record
// construction `FrameSequence { fps, frames }`), already `.fenel` since Phase
// 5b11 (ts-elimination). In the retired seam it rode as a `defineFunction` with
// a `.fenel` body sourced from `frame-sequence.fenel`; in this migration it
// consolidates into `types.fenel` as an ordinary bodied helper (recipe N6 —
// single-file consolidation, NOT the cross-file UNION frontier). It needs no
// native impl, so it does not appear in either map.
//
// F-PERMANENT-REVISIT FLAG: `sampleAnimNative` / `renderAnimNative` are genuine
// bridge leaves — they re-enter the evaluator to run user closures (and
// `renderAnim` re-enters picture's render). The pure coercion helpers
// (`variantPayload`, `asFrameSequence`) are parked here to preserve Phase-3g
// PARITY (byte-for-byte with the retired `engine/src/modules/animation.ts`
// natives), same posture as picture's / sound's pure helpers; a Fenel re-port
// is a later-sweep candidate the parity brief forbids porting now.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is a media-cluster leaf.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import type { ImageValue } from "../../../../implementations/typescript/engine/src/image-data";
import { renderNative as renderPicture } from "../../picture/ffi/picture-ffi";

// ---------------------------------------------------------------------------
// Value type (re-exported by the seam byte-for-byte).
// ---------------------------------------------------------------------------

export type FrameSequenceValue = {
  fps: number;
  frames: ImageValue[];
};

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const EMPTY_IMAGE: ImageValue = { width: 0, height: 0, pixels: [] };

function variantPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "$tag") return obj[key];
  }
  return undefined;
}

function asFrameSequence(v: unknown): FrameSequenceValue {
  if (!v || typeof v !== "object") return { fps: 0, frames: [] };
  const o = v as { fps?: unknown; frames?: unknown };
  if (typeof o.fps !== "number" || !Array.isArray(o.frames)) {
    return { fps: 0, frames: [] };
  }
  return o as FrameSequenceValue;
}

// ---------------------------------------------------------------------------
// CTX natives — `sampleAnim` / `renderAnim` re-enter the evaluator to invoke
// Animate closures (and `renderAnim` re-enters picture's render), so they take
// the `EvaluateContext` as their first arg.
// ---------------------------------------------------------------------------

/** Sample an Animation at a Time, returning the Picture for that instant.
 *  Animate cases invoke the carried closure; Frames reads the frame buffer
 *  at the index closest to t. Returns a transparent solid as the empty
 *  fallback so downstream sampling stays well-formed. */
function sampleAnimNative(
  ctx: EvaluateContext,
  animation: unknown,
  time: unknown,
): unknown {
  if (!animation || typeof animation !== "object") {
    return { $tag: "Field", _0: { __fenelFn: true, params: ["p"], body: { call: ["color", 0, 0, 0, 0] }, closure: {} } };
  }
  const obj = animation as Record<string, unknown>;
  const tag = obj.$tag as string | undefined;

  if (tag === "Animate") {
    const callable = variantPayload(obj);
    if (callable === undefined) return null;
    return invokeCallable(callable, [time], ctx);
  }

  if (tag === "Frames") {
    const seq = asFrameSequence(variantPayload(obj));
    if (seq.frames.length === 0 || seq.fps === 0) return null;
    const t = (time as { seconds?: unknown })?.seconds ?? 0;
    const idx = Math.floor(Number(t) * seq.fps);
    if (idx < 0 || idx >= seq.frames.length) return null;
    // Wrap the Image as a Raster Picture so consumers can call sample on it.
    return { $tag: "Raster", _0: seq.frames[idx] };
  }

  return null;
}

/** Render an Animation to a FrameSequence. Walks the timeline at fps frames
 *  per second over `duration` seconds, sampling the Animation at each
 *  frame time, then rasterising the resulting Picture at the given
 *  width × height via Picture's render. */
function renderAnimNative(
  ctx: EvaluateContext,
  animation: unknown,
  duration: unknown,
  fps: unknown,
  width: unknown,
  height: unknown,
): FrameSequenceValue {
  const dur = Math.max(0, Number(duration));
  const f = Math.max(1, Number(fps));
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  const total = Math.floor(dur * f);
  const frames: ImageValue[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const t = { seconds: i / f };
    const picture = sampleAnimNative(ctx, animation, t);
    frames[i] = picture
      ? renderPicture(ctx, picture, w, h)
      : EMPTY_IMAGE;
  }
  return { fps: f, frames };
}

// ---------------------------------------------------------------------------
// The native maps. `animNatives` is EMPTY (animation has no plain native — the
// simpler ctx-only sub-case); `animNativesCtx` holds the two ctx natives. The
// seam rekeys each to the `animation:` id-namespace and attaches them to
// `nativeImpls` (plain, empty) + `nativeImplsCtx` (ctx).
// ---------------------------------------------------------------------------

export const animNatives: Record<string, (...args: unknown[]) => unknown> = {};

export const animNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sampleAnim: (ctx: EvaluateContext, animation: unknown, time: unknown) =>
    sampleAnimNative(ctx, animation, time),
  renderAnim: (ctx: EvaluateContext, animation: unknown, duration: unknown, fps: unknown, width: unknown, height: unknown) =>
    renderAnimNative(ctx, animation, duration, fps, width, height),
};

export {
  sampleAnimNative,
  renderAnimNative,
};
