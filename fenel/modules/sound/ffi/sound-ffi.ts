// ---------------------------------------------------------------------------
// Sound — FFI leaf (the irreducible host bridge: the CTX-threading
// `sampleSound`/`renderSound` natives that re-enter the evaluator, plus the
// stereo-Amplitude / Time / AudioBuffer representation-record constructor
// helpers).
//
// module-substrate Phase 3g — sound is the SECOND both-maps BASE (after
// picture, the 3f representative). Like picture it forces BOTH native maps out
// of one leaf:
//   - PLAIN natives (`time` / `amplitude` / `mono` / `ampL` / `ampR` /
//     `audioBuffer`) — pure constructor / accessor helpers, no ctx →
//     `soundNatives` → the module's `nativeImpls`;
//   - CTX natives (`sampleSound` / `renderSound`) — re-enter the evaluator via
//     `invokeCallable` to run a `Wave`'s `Time -> Amplitude` closure → take the
//     `EvaluateContext` as their first arg → `soundNativesCtx` → the module's
//     `nativeImplsCtx`. Which map an impl lands in is the ONLY thing that
//     decides plain-vs-ctx — no `.fenel` marker (axis #4, settled by picture).
//
// AXIS DECISION (Phase 3g cross-module ffi-leaf import) — this leaf is a BASE:
// it imports only `invokeCallable` + `EvaluateContext` from the engine
// internals (the same `fenel/ffi → engine` edge picture proved), nothing from a
// sibling media module. It also EXPORTS `sampleSoundNative` + the value types
// `AmplitudeValue` / `AudioBufferValue` / `TimeValue` so the composer leaves
// (`track`/`games`/`movie`) can import them LEAF-TO-LEAF
// (`../../sound/ffi/sound-ffi`) — a `fenel/ffi → fenel/ffi` edge keeping the
// irreducible-host layer self-contained under `fenel/`, never bouncing through
// the engine seam.
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `sampleSoundNative` / `renderSoundNative` are genuine bridge leaves — they
// re-enter the evaluator to run user closures, which a `.fenel` body can't do.
// But the constructor / coercion helpers — `clampUnit`, `asAmplitude`,
// `asTime`, `asAudioBuffer`, `variantPayload`, `bufferSample`, `timeNative`,
// `amplitudeNative`, `monoNative`, `ampLNative`, `ampRNative`,
// `audioBufferNative` — are PURE arithmetic / record-reshaping that compose
// from std fns (clamp / number coercion / record-field reads / variant payload
// extraction). They are parked here to preserve Phase-3g PARITY (byte-for-byte
// with the retired `engine/src/modules/sound.ts` natives), NOT because they
// belong at an ffi leaf — same posture as picture's `clampByte`/`asColor`/…
// and codec's 5 pure helpers. They build the runtime REPRESENTATION records
// (`{l,r}` / `{seconds}` / PCM buffers) the opaque-repr layer uses; a Fenel
// re-port is a candidate for a later coordinated sweep (against the Fenel-first
// HARD RULE), but porting now would be a re-port the parity brief forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is a media-cluster leaf.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";

// ---------------------------------------------------------------------------
// Value types (consumed by the composer leaves track/games/movie + the sound
// seam, which re-exports them to crossmodal/events at 0 consumer edits).
// ---------------------------------------------------------------------------

export type AmplitudeValue = { l: number; r: number };
export type TimeValue = { seconds: number };
export type AudioBufferValue = {
  sampleRate: number;
  channels: number;
  samples: AmplitudeValue[];
};

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const SILENT_AMPLITUDE: AmplitudeValue = { l: 0, r: 0 };

function asAmplitude(v: unknown): AmplitudeValue {
  if (!v || typeof v !== "object") return SILENT_AMPLITUDE;
  const o = v as { l?: unknown; r?: unknown };
  return {
    l: clampUnit(Number(o.l)),
    r: clampUnit(Number(o.r)),
  };
}

function asTime(v: unknown): TimeValue {
  if (!v || typeof v !== "object") return { seconds: 0 };
  const o = v as { seconds?: unknown };
  return { seconds: Number(o.seconds) || 0 };
}

function asAudioBuffer(v: unknown): AudioBufferValue {
  if (!v || typeof v !== "object") return { sampleRate: 0, channels: 0, samples: [] };
  const o = v as { sampleRate?: unknown; channels?: unknown; samples?: unknown };
  if (
    typeof o.sampleRate !== "number" ||
    typeof o.channels !== "number" ||
    !Array.isArray(o.samples)
  ) {
    return { sampleRate: 0, channels: 0, samples: [] };
  }
  return o as AudioBufferValue;
}

/** Clamp to [-1, 1]. Audio amplitudes outside this range produce clipping at
 *  output time anyway, but enforcing it here keeps Wave outputs well-formed. */
function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return 1;
  if (n < -1) return -1;
  return n;
}

/** Pull the single positional payload of a one-payload variant value. v1
 *  Sound cases (`Buffer AudioBuffer`, `Wave (Time -> Amplitude)`) each
 *  carry a single field; the first non-`$tag` key is the payload. */
function variantPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "$tag") return obj[key];
  }
  return undefined;
}

/** Read the buffer at the requested time. Nearest-neighbour for v1 — linear
 *  interpolation can land later when the renders justify it. */
function bufferSample(buf: AudioBufferValue, t: TimeValue): AmplitudeValue {
  if (buf.samples.length === 0 || buf.sampleRate === 0) return SILENT_AMPLITUDE;
  const idx = Math.floor(t.seconds * buf.sampleRate);
  if (idx < 0 || idx >= buf.samples.length) return SILENT_AMPLITUDE;
  return buf.samples[idx] ?? SILENT_AMPLITUDE;
}

// ---------------------------------------------------------------------------
// CTX natives — `sampleSound` / `renderSound` re-enter the evaluator to invoke
// Wave closures, so they take the `EvaluateContext` as their first arg. The
// runtime resolves them via `ctx.nativesCtx[id]` and calls
// `impl(ctx, …evaluatedArgs)`.
// ---------------------------------------------------------------------------

/** Sample a Sound at a Time, returning a stereo Amplitude. The bridge
 *  primitive for audio. Variant dispatch on `$tag`: a Wave invokes the
 *  carried closure; a Buffer reads its PCM samples at the given time. */
function sampleSoundNative(
  ctx: EvaluateContext,
  sound: unknown,
  time: unknown,
): AmplitudeValue {
  if (!sound || typeof sound !== "object") return SILENT_AMPLITUDE;
  const obj = sound as Record<string, unknown>;
  const tag = obj.$tag as string | undefined;

  if (tag === "Wave") {
    const callable = variantPayload(obj);
    if (callable === undefined) return SILENT_AMPLITUDE;
    const result = invokeCallable(callable, [time], ctx);
    return asAmplitude(result);
  }

  if (tag === "Buffer") {
    return bufferSample(asAudioBuffer(variantPayload(obj)), asTime(time));
  }

  return SILENT_AMPLITUDE;
}

/** Render a Sound to an AudioBuffer of the given duration (seconds) and
 *  sample rate (Hz). Samples are taken at uniform sub-sample intervals. */
function renderSoundNative(
  ctx: EvaluateContext,
  sound: unknown,
  duration: unknown,
  sampleRate: unknown,
): AudioBufferValue {
  const dur = Math.max(0, Number(duration));
  const sr = Math.max(1, Math.floor(Number(sampleRate)));
  const total = Math.floor(dur * sr);
  const samples: AmplitudeValue[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const t: TimeValue = { seconds: i / sr };
    samples[i] = sampleSoundNative(ctx, sound, t);
  }
  return { sampleRate: sr, channels: 2, samples };
}

// ---------------------------------------------------------------------------
// PLAIN natives — pure constructor / accessor helpers, no ctx. Build the
// runtime representation records the opaque-repr layer stores.
// ---------------------------------------------------------------------------

/** Build a Time record from a number of seconds. */
function timeNative(seconds: unknown): TimeValue {
  return { seconds: Number(seconds) || 0 };
}

/** Build a stereo Amplitude from left and right channel values. */
function amplitudeNative(l: unknown, r: unknown): AmplitudeValue {
  return { l: clampUnit(Number(l)), r: clampUnit(Number(r)) };
}

/** Convenience: build a mono Amplitude (l == r). */
function monoNative(v: unknown): AmplitudeValue {
  const x = clampUnit(Number(v));
  return { l: x, r: x };
}

/** Extract the left channel of an Amplitude. */
function ampLNative(a: unknown): number {
  return Number((a as { l?: unknown })?.l) || 0;
}

/** Extract the right channel of an Amplitude. */
function ampRNative(a: unknown): number {
  return Number((a as { r?: unknown })?.r) || 0;
}

/** Build an AudioBuffer from sample rate, channel count, and PCM data. */
function audioBufferNative(
  sampleRate: unknown,
  channels: unknown,
  samples: unknown,
): AudioBufferValue {
  return {
    sampleRate: Math.max(1, Math.floor(Number(sampleRate))),
    channels: Math.max(1, Math.floor(Number(channels))),
    samples: Array.isArray(samples) ? (samples as AmplitudeValue[]) : [],
  };
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the `sound:`
// id-namespace via `rekeyNativesById` and attaches them to the FenelModule's
// `nativeImpls` (plain) + `nativeImplsCtx` (ctx). Only the FILE LOCATION moved
// (TS source-of-truth → `ffi/` leaf), not the runtime contract.
// ---------------------------------------------------------------------------

export const soundNatives: Record<string, (...args: unknown[]) => unknown> = {
  time: (seconds: unknown) => timeNative(seconds),
  amplitude: (l: unknown, r: unknown) => amplitudeNative(l, r),
  mono: (v: unknown) => monoNative(v),
  ampL: (a: unknown) => ampLNative(a),
  ampR: (a: unknown) => ampRNative(a),
  audioBuffer: (sampleRate: unknown, channels: unknown, samples: unknown) =>
    audioBufferNative(sampleRate, channels, samples),
};

export const soundNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sampleSound: (ctx: EvaluateContext, sound: unknown, time: unknown) =>
    sampleSoundNative(ctx, sound, time),
  renderSound: (ctx: EvaluateContext, sound: unknown, duration: unknown, sampleRate: unknown) =>
    renderSoundNative(ctx, sound, duration, sampleRate),
};

export {
  sampleSoundNative,
  renderSoundNative,
  timeNative,
  amplitudeNative,
  monoNative,
  ampLNative,
  ampRNative,
  audioBufferNative,
};
