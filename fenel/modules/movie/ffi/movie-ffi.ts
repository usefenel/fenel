// ---------------------------------------------------------------------------
// Movie — FFI leaf (the irreducible host bridge: the CTX-threading
// `sampleMovie`/`renderMovie` natives that re-enter the evaluator, plus the
// `scene` representation-record constructor).
//
// module-substrate Phase 3g — movie is the RICHEST COMPOSER: it imports from
// TWO sibling media leaves at once. Like picture / sound it forces BOTH native
// maps out of one leaf:
//   - PLAIN native (`scene`) — pure constructor helper, no ctx → `movieNatives`
//     → the module's `nativeImpls`;
//   - CTX natives (`sampleMovie` / `renderMovie`) — re-enter the evaluator via
//     `invokeCallable` to run a `MovieAt`'s `Time -> Scene` closure → take the
//     `EvaluateContext` as their first arg → `movieNativesCtx` → the module's
//     `nativeImplsCtx`. Which map an impl lands in is the ONLY thing that
//     decides plain-vs-ctx — no `.fenel` marker (axis #4).
//
// AXIS DECISION (Phase 3g cross-module ffi-leaf import) — this leaf imports a
// SIBLING MEDIA LEAF's native + types LEAF-TO-LEAF (a `fenel/ffi → fenel/ffi`
// edge), NOT via the engine seam:
//   - `renderNative` from `../../picture/ffi/picture-ffi` (a PREVIOUSLY-migrated
//     base — 3f), to rasterise each Scene's visual Picture;
//   - the value types `AmplitudeValue` / `AudioBufferValue` from
//     `../../sound/ffi/sound-ffi` (a SAME-PHASE base — 3g), for the Scene audio
//     + RecordedMovie buffer shapes.
// This keeps the irreducible-host layer self-contained under `fenel/`, never
// bouncing fenel→engine-seam→fenel. (The retired seam imported `renderNative`
// from `./picture` and the types from `./sound` — the engine seams; the
// leaf-to-leaf edge is the cleaner cohesion the 3g axis settled.)
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `sampleMovieNative` / `renderMovieNative` are genuine bridge leaves — they
// re-enter the evaluator to run user closures (and `renderMovie` re-enters
// picture's render). But the constructor / coercion helpers — `variantPayload`,
// `asScene`, `asRecorded`, `sceneNative` — are PURE record-reshaping that
// compose from std fns (variant payload extraction / record-field reads). They
// are parked here to preserve Phase-3g PARITY (byte-for-byte with the retired
// `engine/src/modules/movie.ts` natives), NOT because they belong at an ffi
// leaf — same posture as picture's / sound's pure helpers. A Fenel re-port is a
// candidate for a later coordinated sweep, but porting now would be a re-port
// the parity brief forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is a media-cluster leaf.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import type { ImageValue } from "../../../../implementations/typescript/engine/src/image-data";
import { renderNative as renderPicture } from "../../picture/ffi/picture-ffi";
import type { AmplitudeValue, AudioBufferValue } from "../../sound/ffi/sound-ffi";

// ---------------------------------------------------------------------------
// Value types (consumed by the movie seam, which re-exports them to
// crossmodal / events at 0 consumer edits).
// ---------------------------------------------------------------------------

export type SceneValue = { visual: unknown; audio: AmplitudeValue };
export type RecordedMovieValue = {
  fps: number;
  width: number;
  height: number;
  frames: ImageValue[];
  audio: AudioBufferValue;
};

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const EMPTY_AMP: AmplitudeValue = { l: 0, r: 0 };
const EMPTY_IMAGE: ImageValue = { width: 0, height: 0, pixels: [] };

function variantPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "$tag") return obj[key];
  }
  return undefined;
}

function asScene(v: unknown): SceneValue {
  if (!v || typeof v !== "object") return { visual: null, audio: EMPTY_AMP };
  const o = v as { visual?: unknown; audio?: unknown };
  return {
    visual: o.visual,
    audio: (o.audio && typeof o.audio === "object")
      ? (o.audio as AmplitudeValue)
      : EMPTY_AMP,
  };
}

function asRecorded(v: unknown): RecordedMovieValue {
  if (!v || typeof v !== "object") {
    return { fps: 0, width: 0, height: 0, frames: [], audio: { sampleRate: 0, channels: 0, samples: [] } };
  }
  const o = v as RecordedMovieValue;
  return o;
}

// ---------------------------------------------------------------------------
// CTX natives — `sampleMovie` / `renderMovie` re-enter the evaluator to invoke
// MovieAt closures (and `renderMovie` re-enters picture's render), so they take
// the `EvaluateContext` as their first arg. The runtime resolves them via
// `ctx.nativesCtx[id]` and calls `impl(ctx, …evaluatedArgs)`.
// ---------------------------------------------------------------------------

/** Sample a Movie at a Time, returning the Scene at that instant. The
 *  bridge primitive — every higher-level Movie operation reduces to this. */
function sampleMovieNative(
  ctx: EvaluateContext,
  movie: unknown,
  time: unknown,
): SceneValue {
  if (!movie || typeof movie !== "object") return { visual: null, audio: EMPTY_AMP };
  const obj = movie as Record<string, unknown>;
  const tag = obj.$tag as string | undefined;

  if (tag === "MovieAt") {
    const callable = variantPayload(obj);
    if (callable === undefined) return { visual: null, audio: EMPTY_AMP };
    return asScene(invokeCallable(callable, [time], ctx));
  }

  if (tag === "Recorded") {
    const rec = asRecorded(variantPayload(obj));
    const t = (time as { seconds?: unknown })?.seconds ?? 0;
    const frameIdx = Math.floor(Number(t) * rec.fps);
    const frame = rec.frames[frameIdx] ?? EMPTY_IMAGE;
    const audioIdx = Math.floor(Number(t) * rec.audio.sampleRate);
    const amp = rec.audio.samples[audioIdx] ?? EMPTY_AMP;
    return { visual: { $tag: "Raster", _0: frame }, audio: amp };
  }

  return { visual: null, audio: EMPTY_AMP };
}

/** Render a Movie to a fully-resolved RecordedMovie. Walks the timeline
 *  twice: video frames at fps over duration, audio samples at sampleRate.
 *  Both streams come from the same `sampleMovie` calls — no separate
 *  audio/visual sampling, since the Movie is one signal. */
function renderMovieNative(
  ctx: EvaluateContext,
  movie: unknown,
  duration: unknown,
  fps: unknown,
  sampleRate: unknown,
  width: unknown,
  height: unknown,
): RecordedMovieValue {
  const dur = Math.max(0, Number(duration));
  const f = Math.max(1, Number(fps));
  const sr = Math.max(1, Math.floor(Number(sampleRate)));
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));

  const totalFrames = Math.floor(dur * f);
  const totalAudio = Math.floor(dur * sr);

  const frames: ImageValue[] = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const t = { seconds: i / f };
    const scene = sampleMovieNative(ctx, movie, t);
    frames[i] = scene.visual
      ? renderPicture(ctx, scene.visual, w, h)
      : EMPTY_IMAGE;
  }

  const samples: AmplitudeValue[] = new Array(totalAudio);
  for (let i = 0; i < totalAudio; i++) {
    const t = { seconds: i / sr };
    const scene = sampleMovieNative(ctx, movie, t);
    samples[i] = scene.audio;
  }

  return {
    fps: f,
    width: w,
    height: h,
    frames,
    audio: { sampleRate: sr, channels: 2, samples },
  };
}

// ---------------------------------------------------------------------------
// PLAIN native — `scene`, a pure constructor helper, no ctx.
// ---------------------------------------------------------------------------

/** Build a Scene record from a Picture and an Amplitude. */
function sceneNative(visual: unknown, audio: unknown): SceneValue {
  return {
    visual,
    audio: (audio && typeof audio === "object")
      ? (audio as AmplitudeValue)
      : EMPTY_AMP,
  };
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the `movie:`
// id-namespace via `rekeyNativesById` and attaches them to the FenelModule's
// `nativeImpls` (plain) + `nativeImplsCtx` (ctx). Only the FILE LOCATION moved
// (TS source-of-truth → `ffi/` leaf), not the runtime contract.
// ---------------------------------------------------------------------------

export const movieNatives: Record<string, (...args: unknown[]) => unknown> = {
  scene: (visual: unknown, audio: unknown) => sceneNative(visual, audio),
};

export const movieNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sampleMovie: (ctx: EvaluateContext, movie: unknown, time: unknown) =>
    sampleMovieNative(ctx, movie, time),
  renderMovie: (
    ctx: EvaluateContext,
    movie: unknown,
    duration: unknown,
    fps: unknown,
    sampleRate: unknown,
    width: unknown,
    height: unknown,
  ) => renderMovieNative(ctx, movie, duration, fps, sampleRate, width, height),
};

export {
  sampleMovieNative,
  renderMovieNative,
  sceneNative,
};
