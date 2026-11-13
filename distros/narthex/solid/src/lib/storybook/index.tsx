// ---------------------------------------------------------------------------
// Storybook — concrete-value lens for types and functions.
//
// For a TYPE: pull `Exemplifiable` instance values and render each through
// the value-level Viewable surface. The reader sees what concrete values
// of that type look like; if the type is `Image` (refined string with the
// `format:image` constraint) the values render as <img>, if it's `Number`
// they render as numerals, etc. — all dispatched, not hardcoded.
//
// For a FUNCTION: each `example` is an (args → output) row. Inputs use
// the storybook of each parameter type; outputs are either pre-computed
// in the function spec or evaluated live for pure functions whose native
// impl is bundled with the std registry. Same value rendering on both
// sides — `Image -> Image` shows in/out images, `Number -> Number`
// shows numerals.
// ---------------------------------------------------------------------------

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled, snapshot } from "solid-js";
import {
  evaluate as evaluateExpr,
  evaluateWithTrace,
  invokeCallable,
  getExamples,
  getStoryboard,
  peelList,
  type EvaluateContext,
  type FenelFunction,
  type FenelType,
  type FunctionExample,
  type TraceStep,
} from "@fenel/engine";
import { AddToLocusButton } from "~/lib/add-to-locus";
import { MediaTimeline } from "~/lib/media-timeline";
import { audioBufferToWavBlob, downloadBlob, imageToPngBlob } from "./export";
import type { ExprNode } from "~/lib/expression-runner";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { isImageLike } from "~/lib/data-transfer/data-preview-shape";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";

/** Capture the component's reader once. Deferred game ticks and example
 * evaluation use that reader's current checked snapshot, with no ambient
 * account fallback and no context lookup after asynchronous work. */
function useStorybookContext(): () => EvaluateContext {
  const reader = useReaderRuntime();
  const session = useAuthoringSession();
  return () => reader ? reader.session().evaluateContext : session.evaluateContext;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Storybook for a type — renders each Exemplifiable value through the
 *  type's Viewable surface. */
export function TypeStorybook(props: { typeName: string }) {
  const reader = useReaderRuntime();
  const examples = createMemo(() => {
    if (!reader) return getExamples(props.typeName) ?? [];
    const values = reader.representation("Exemplifiable", props.typeName)?.examples;
    return Array.isArray(values) ? values : [];
  });
  return (
    <Show when={examples().length > 0}>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Storybook</h3>
        <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          Concrete values of <code class="mono">{props.typeName}</code> rendered through the type's view surface.
        </p>
        <div class="storybook-grid">
          <For each={examples()}>
            {(value) => (
              <div class="storybook-cell">
                <ValueDisplay value={value} typeName={props.typeName} />
                <div class="storybook-cell__caption mono">{shortCaption(value)}</div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/** Storybook for a function — for each example row, evaluate the body
 *  with a trace and render the chain of intermediate values. Functions
 *  with a JSON-Logic body (compositions) show every step; functions
 *  with only a native impl show input → output as a single step. */
export function FunctionStorybook(props: { fn: FenelFunction }) {
  const reader = useReaderRuntime();
  const context = useStorybookContext();
  const examplesForType = (typeName: string): unknown[] => {
    if (!reader) return getExamples(typeName) ?? [];
    const values = reader.representation("Exemplifiable", typeName)?.examples;
    return Array.isArray(values) ? values : [];
  };
  const rows = createMemo<FunctionExample[]>(() => {
    const value = reader ? reader.representation("Storyboardable", props.fn.id)?.storyboard : getStoryboard(props.fn.id);
    const explicit = Array.isArray(value) ? value as FunctionExample[] : [];
    if (explicit.length > 0) return explicit;
    return synthesizeExamples(props.fn, examplesForType);
  });

  const evaluated = createMemo(() =>
    rows().map((row) => {
      const evaluated = evaluateExample(props.fn, row.args, context());
      return {
        ...row,
        // Pre-computed output in the spec wins; otherwise the live result.
        output: row.output !== undefined ? row.output : evaluated.result,
        trace: evaluated.trace,
      };
    }),
  );

  const returnTypeName = createMemo(() => typeNameOf(props.fn.returns));

  return (
    <Show when={evaluated().length > 0}>
      <div class="type-detail__section">
        <h3 class="type-detail__section-title">Storybook</h3>
        <p class="text-muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          Representative inputs evaluated through the function. When the body is a composition, every intermediate stage is shown — input, each pipe step, and the final output.
        </p>
        <div class="storybook-fn">
          <For each={evaluated()}>
            {(row) => (
              <div class="storybook-trace">
                {/* Inputs as the first row of the chain */}
                <div class="storybook-trace__inputs">
                  <For each={props.fn.params}>
                    {(p, i) => (
                      <div class="storybook-trace__cell">
                        <div class="storybook-trace__cell-label mono">{p.name}</div>
                        <ValueDisplay
                          value={row.args[i()]}
                          typeName={typeNameOf(p.type)}
                        />
                      </div>
                    )}
                  </For>
                </div>

                {/* Each call/pipe step the trace recorded */}
                <For each={row.trace}>
                  {(step) => (
                    <>
                      <div class="storybook-trace__arrow">↓</div>
                      <div class="storybook-trace__step">
                        <div class="storybook-trace__step-head">
                          <span class="storybook-trace__step-name mono">{step.fnName}</span>
                          <Show when={step.args.length > 1}>
                            <span class="storybook-trace__step-extras mono">
                              {step.args.slice(1).map(formatArg).join(", ")}
                            </span>
                          </Show>
                          <span class="storybook-trace__step-op">{step.op}</span>
                        </div>
                        <div class="storybook-trace__cell">
                          <ValueDisplay
                            value={step.result}
                            typeName={returnTypeName()}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </For>

                {/* Final result row — only shown when there were no inner
                    steps OR when the spec carries an explicit output that
                    might differ from the live trace (rare). */}
                <Show when={row.trace.length === 0}>
                  <div class="storybook-trace__arrow">↓</div>
                  <div class="storybook-trace__step storybook-trace__step--final">
                    <div class="storybook-trace__step-head">
                      <span class="storybook-trace__step-name mono">{shortFnName(props.fn.id)}</span>
                      <span class="storybook-trace__step-op">native</span>
                    </div>
                    <div class="storybook-trace__cell">
                      <Show
                        when={row.output !== undefined}
                        fallback={<span class="text-muted">(no impl available)</span>}
                      >
                        <ValueDisplay
                          value={row.output}
                          typeName={returnTypeName()}
                        />
                      </Show>
                    </div>
                  </div>
                </Show>

                <Show when={row.description}>
                  <div class="storybook-trace__caption">{row.description}</div>
                </Show>

                {/* Pin this example to home — turns it into an inline
                    expression that re-evaluates on every render. */}
                <div style="display: flex; justify-content: center; margin-top: 0.4rem">
                  <AddToLocusButton
                    compact
                    getExpr={() => exampleAsExpr(props.fn, row.args)}
                    getCaption={() => shortFnName(props.fn.id)}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/** Build an ExprNode calling `fn` with the given arg literals — pin uses
 *  this to make a snapshot of an example into a live home item. */
function exampleAsExpr(fn: FenelFunction, args: unknown[]): ExprNode {
  return {
    kind: "call",
    fnId: fn.id,
    args: args.map((v): ExprNode => ({ kind: "literal", value: v })),
  };
}

// ---------------------------------------------------------------------------
// ValueDisplay — type-aware rendering of a concrete value.
//
// Dispatch is pragmatic: structural Image records (raster matrices) draw
// to a canvas, image data-URLs render as <img>, scalars get widget-y
// rendering, anything else falls back to JSON. Once a value-level
// `Widget` typeclass is introduced this collapses to a single typeclass
// call — but the surface here stays the same.
// ---------------------------------------------------------------------------

export function ValueDisplay(props: { value: unknown; typeName?: string; occurrence?: DataOccurrenceSource }) {
  const context = useStorybookContext();
  const v = () => props.value;
  const unavailable: DataOccurrenceSource = { state: "unavailable", issue: "This example has no live source expression here." };
  return (
    <DataOccurrenceBoundary value={props.value} occurrence={props.occurrence ?? unavailable}>
    <Show when={isImageRecord(v())} fallback={
      <Show when={isSoundValue(v()) || isAudioBufferValue(v())} fallback={
        <Show when={isAnimationValue(v()) || isFrameSequenceValue(v())} fallback={
          <Show when={isMovieValue(v()) || isRecordedMovieValue(v())} fallback={
            <Show when={isTrackValue(v())} fallback={
              <Show when={isLiveGameValue(v())} fallback={
                <Show when={isGameValue(v())} fallback={
                  <Show when={isEventValue(v())} fallback={
                    <Show when={isImageLike(v())} fallback={<RenderScalar value={v()} />}>
                      <img src={String(v())} alt="" class="storybook-img" />
                    </Show>
                  }>
                    <EventListView value={v() as EventRecord} />
                  </Show>
                }>
                  <GameView value={v() as GameRecord} getContext={context} />
                </Show>
              }>
                <LiveGame value={(v() as { _0: GameRecord })._0} getContext={context} />
              </Show>
            }>
              <TrackTimelineView value={v() as TrackRecord} />
            </Show>
          }>
            <MovieView value={v() as any} />
          </Show>
        }>
          <AnimationFrameStripView value={v() as any} />
        </Show>
      }>
        <SoundWaveformView value={v() as any} />
      </Show>
    }>
      <ImageMatrixView value={v() as ImageRecord} />
    </Show>
    </DataOccurrenceBoundary>
  );
}

// ---------------------------------------------------------------------------
// ImageMatrixView — paints a structural Image record into a <canvas>
// using putImageData. Crisp pixel-art scaling via CSS `image-rendering:
// pixelated`. Tiny images (16×16) are CSS-scaled up so they're visible
// without being huge in the DOM.
// ---------------------------------------------------------------------------

type RgbaPixelRecord = { r: number; g: number; b: number; a: number };
type ImageRecord = { width: number; height: number; pixels: RgbaPixelRecord[] };

function ImageMatrixView(props: { value: ImageRecord }) {
  let canvasRef: HTMLCanvasElement | undefined;

  const paint = () => {
    const c = canvasRef;
    if (!c) return;
    const img = props.value;
    const w = img.width | 0;
    const h = img.height | 0;
    if (w <= 0 || h <= 0) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const data = ctx.createImageData(w, h);
    const expected = w * h;
    for (let i = 0; i < expected; i++) {
      const p = img.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    ctx.putImageData(data, 0, 0);
  };

  onSettled(paint);
  // Repaint whenever the value changes (storybook live-eval rerunning).
  createEffect(
    () => props.value,
    () => paint(),
  );

  async function downloadPng() {
    const blob = await imageToPngBlob(props.value);
    if (blob) downloadBlob(blob, `image-${props.value.width}x${props.value.height}.png`);
  }

  // CSS scales small images up to be visible; image-rendering: pixelated
  // keeps the pixel grid crisp instead of bilinear-smearing.
  return (
    <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
      <canvas
        ref={canvasRef}
        class="storybook-img-canvas"
        data-tooltip={`${props.value.width}×${props.value.height}`}
        style="image-rendering: pixelated; image-rendering: crisp-edges; max-width: 96px; max-height: 96px; width: 96px; height: 96px; border-radius: 6px; background: #f5f5f7"
      />
      <DownloadButton label="PNG" onClick={downloadPng} />
    </div>
  );
}

/** A small download button shown on exportable values. The label varies
 *  by format ("PNG", "WAV"). On click, triggers a browser download. */
function DownloadButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-tooltip={`Download as ${props.label}`}
      style={`
        font-size: 0.7rem;
        padding: 2px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        background: #fff;
        color: #333;
        cursor: pointer;
        font-family: ui-monospace, monospace;
      `}
    >
      ⬇ {props.label}
    </button>
  );
}

function isImageRecord(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.width === "number"
    && typeof o.height === "number"
    && Array.isArray(o.pixels);
}

// ---------------------------------------------------------------------------
// Sound / Animation / Movie / Track / Event detection + visualisation
//
// All five types live as runtime variants or records produced by the audio /
// video / events modules. The catalog ships pre-rendered samples (Buffer
// for Sound, Frames for Animation, Recorded for Movie, plain records for
// Track / Event) so these widgets read pure data — no engine round-trip.
// ---------------------------------------------------------------------------

type AmplitudeRec = { l: number; r: number };
type AudioBufRec = { sampleRate: number; channels: number; samples: AmplitudeRec[] };
type SoundRecord = { $tag: "Buffer" | "Wave"; _0: unknown };
type FrameSequenceRec = { fps: number; frames: ImageRecord[] };
type AnimationRecord = { $tag: "Frames" | "Animate"; _0: unknown };
type RecordedMovieRec = { fps: number; width: number; height: number; frames: ImageRecord[]; audio: AudioBufRec };
type MovieRecord = { $tag: "Recorded" | "MovieAt"; _0: unknown };
type TrackEntryRec = { start: number; sound: SoundRecord };
type TrackRecord = { entries: TrackEntryRec[] };
type EventEntryRec = { timestamp: number; payload: unknown };
type EventRecord = { entries: EventEntryRec[] };
type GameRecord = { initial: unknown; update: unknown; view: unknown; inputs: EventRecord };

function isSoundValue(v: unknown): v is SoundRecord {
  return !!v && typeof v === "object"
    && ((v as any).$tag === "Buffer" || (v as any).$tag === "Wave");
}
/** A raw AudioBuffer produced by `renderSound` directly: { sampleRate,
 *  channels, samples }. Visualised the same way as a Buffer-tagged Sound. */
function isAudioBufferValue(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.$tag !== undefined && o.$tag !== "AudioBuffer") return false;
  return typeof o.sampleRate === "number"
    && typeof o.channels === "number"
    && Array.isArray(o.samples)
    && o.samples.length > 0
    && typeof o.samples[0]?.l === "number";
}
function isAnimationValue(v: unknown): v is AnimationRecord {
  return !!v && typeof v === "object"
    && ((v as any).$tag === "Frames" || (v as any).$tag === "Animate");
}
/** A raw FrameSequence from `renderAnim`: { fps, frames: [Image] }. */
function isFrameSequenceValue(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.$tag !== undefined && o.$tag !== "FrameSequence") return false;
  return typeof o.fps === "number"
    && Array.isArray(o.frames)
    && o.frames.length > 0
    && typeof o.frames[0]?.width === "number"
    && Array.isArray(o.frames[0]?.pixels);
}
function isMovieValue(v: unknown): v is MovieRecord {
  return !!v && typeof v === "object"
    && ((v as any).$tag === "Recorded" || (v as any).$tag === "MovieAt");
}
/** A raw RecordedMovie from `renderMovie`: { fps, width, height, frames, audio }. */
function isRecordedMovieValue(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if (o.$tag !== undefined && o.$tag !== "RecordedMovie") return false;
  return typeof o.fps === "number"
    && Array.isArray(o.frames)
    && o.audio !== undefined
    && Array.isArray(o.audio?.samples);
}
function isTrackValue(v: unknown): v is TrackRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if ((o.$tag !== undefined) && o.$tag !== "Track") return false;
  return Array.isArray(o.entries)
    && o.entries.every((e: any) => e && typeof e.start === "number" && e.sound !== undefined);
}
function isEventValue(v: unknown): v is EventRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  if ((o.$tag !== undefined) && o.$tag !== "Event") return false;
  return Array.isArray(o.entries)
    && o.entries.length > 0
    && o.entries.every((e: any) => e && typeof e.timestamp === "number" && "payload" in e);
}
function isGameValue(v: unknown): v is GameRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as any;
  return o.initial !== undefined
    && typeof o.update === "object" && (o.update as any)?.__fenelFn === true
    && typeof o.view === "object" && (o.view as any)?.__fenelFn === true
    && o.inputs !== undefined;
}

/** A LiveGame is what `runGame` produces — a marker wrapping a Game.
 *  When detected, the storybook surfaces the live interactive view by
 *  default (no Strip-mode toggle). */
function isLiveGameValue(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as any).$tag === "LiveGame";
}

// ---------------------------------------------------------------------------
// SoundWaveformView — plot left-channel amplitude over time as a polyline
// in an SVG. Only renders for Buffer-shaped Sounds (which is what the
// catalog ships); Wave-shaped Sounds carry a closure and would need an
// engine round-trip to materialise — they show a placeholder instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audio playback — convert our AudioBuffer record to a Web Audio AudioBuffer
// and play it. Lazily creates a shared AudioContext (browsers require a
// user gesture before the first sound), reuses it across all clicks.
// ---------------------------------------------------------------------------

let SHARED_AUDIO_CTX: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (SHARED_AUDIO_CTX) return SHARED_AUDIO_CTX;
  try {
    SHARED_AUDIO_CTX = new (window.AudioContext || (window as any).webkitAudioContext)();
    return SHARED_AUDIO_CTX;
  } catch {
    return null;
  }
}

/** Copy our `{sampleRate, channels, samples: [{l, r}]}` into a Web Audio
 *  buffer and start playback. Returns a cleanup function that stops the
 *  source so the caller can interrupt. Returns null if Web Audio is
 *  unavailable (e.g. SSR). */
function playAudioBuffer(buf: AudioBufRec): (() => void) | null {
  const ctx = getAudioContext();
  if (!ctx || buf.samples.length === 0) return null;
  // The shared context may be in a "suspended" state until user gesture —
  // resuming inside a click handler is allowed.
  if (ctx.state === "suspended") void ctx.resume();
  const channels = Math.max(1, Math.min(2, buf.channels || 2));
  const audio = ctx.createBuffer(channels, buf.samples.length, buf.sampleRate);
  const left = audio.getChannelData(0);
  const right = channels > 1 ? audio.getChannelData(1) : left;
  for (let i = 0; i < buf.samples.length; i++) {
    const s = buf.samples[i] ?? { l: 0, r: 0 };
    left[i] = Math.max(-1, Math.min(1, s.l));
    if (channels > 1) right[i] = Math.max(-1, Math.min(1, s.r));
  }
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(ctx.destination);
  source.start();
  return () => {
    try { source.stop(); } catch { /* already stopped */ }
  };
}

function SoundWaveformView(props: { value: SoundRecord | AudioBufRec }) {
  const buf = createMemo<AudioBufRec | null>(() => {
    const v = props.value as any;
    if (v?.$tag === "Buffer") return v._0 as AudioBufRec;
    if (typeof v?.sampleRate === "number" && Array.isArray(v?.samples)) return v as AudioBufRec;
    return null;
  });

  const w = 240;
  const h = 64;
  const duration = () => (buf() ? buf()!.samples.length / buf()!.sampleRate : 0);

  const path = createMemo(() => {
    const b = buf();
    if (!b || b.samples.length === 0) return "";
    const n = b.samples.length;
    const step = Math.max(1, Math.floor(n / w));
    let d = "";
    for (let x = 0; x < w; x++) {
      const i = Math.min(n - 1, x * step);
      const a = b.samples[i]?.l ?? 0;
      const y = h / 2 - (a * h) / 2;
      d += (x === 0 ? "M" : "L") + x + "," + y.toFixed(1) + " ";
    }
    return d;
  });

  const [playing, setPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  let stopFn: (() => void) | null = null;
  let playStartMs = 0;
  let seekOffset = 0;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(() => {
      const now = (Date.now() - playStartMs) / 1000 + seekOffset;
      if (now >= duration()) {
        setCurrentTime(duration());
        stopPlayback();
        return;
      }
      setCurrentTime(now);
    }, 33);
  }
  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function startPlayback(fromOffset: number) {
    const b = buf();
    if (!b) return;
    seekOffset = fromOffset;
    stopFn = playAudioBufferFromOffset(b, fromOffset);
    if (!stopFn) return;
    playStartMs = Date.now();
    setPlaying(true);
    startProgressTimer();
  }
  function stopPlayback() {
    stopFn?.();
    stopFn = null;
    stopProgressTimer();
    setPlaying(false);
  }

  function togglePlay() {
    if (playing()) {
      stopPlayback();
      return;
    }
    // If we're at the end, restart from the beginning.
    const from = currentTime() >= duration() ? 0 : currentTime();
    if (from === 0) setCurrentTime(0);
    startPlayback(from);
  }

  function handleSeek(t: number) {
    setCurrentTime(t);
    if (playing()) {
      // Restart playback from the seek point.
      stopFn?.();
      stopFn = null;
      stopProgressTimer();
      startPlayback(t);
    }
  }

  onCleanup(() => {
    stopFn?.();
    stopProgressTimer();
  });

  return (
    <div class="storybook-sound" style="width: 260px;">
      <Show when={buf()} fallback={
        <div style="height: 64px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.75rem; background: #f5f5f7; border-radius: 6px;">
          Wave (math expression)
        </div>
      }>
        <div style="position: relative;">
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style="background: #0f172a; border-radius: 6px; display: block;">
            <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#334155" stroke-width="1" />
            <path d={path()} stroke="#22d3ee" stroke-width="1.2" fill="none" />
            {/* Playhead in the waveform that moves during playback */}
            <Show when={duration() > 0}>
              <line
                x1={(currentTime() / duration()) * w}
                y1="0"
                x2={(currentTime() / duration()) * w}
                y2={h}
                stroke="#ef4444"
                stroke-width="1.5"
              />
            </Show>
          </svg>
        </div>
        <MediaTimeline
          duration={duration()}
          currentTime={currentTime()}
          onSeek={handleSeek}
          isPlaying={playing()}
          onPlayPause={togglePlay}
          axisHeight={28}
          tickCount={6}
        />
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 2px;">
          <span class="text-muted mono" style="font-size: 0.7rem;">
            {buf()?.samples.length} samples · {buf()?.sampleRate} Hz
          </span>
          <DownloadButton
            label="WAV"
            onClick={() => {
              const b = buf();
              if (!b) return;
              const blob = audioBufferToWavBlob(b);
              downloadBlob(blob, `sound-${b.sampleRate}hz.wav`);
            }}
          />
        </div>
      </Show>
    </div>
  );
}

/** Like `playAudioBuffer` but starts at a given offset in seconds. Used by
 *  SoundWaveformView when the user scrubs to a position before playing. */
function playAudioBufferFromOffset(buf: AudioBufRec, offsetSec: number): (() => void) | null {
  const ctx = getAudioContext();
  if (!ctx || buf.samples.length === 0) return null;
  if (ctx.state === "suspended") void ctx.resume();
  const channels = Math.max(1, Math.min(2, buf.channels || 2));
  const audio = ctx.createBuffer(channels, buf.samples.length, buf.sampleRate);
  const left = audio.getChannelData(0);
  const right = channels > 1 ? audio.getChannelData(1) : left;
  for (let i = 0; i < buf.samples.length; i++) {
    const s = buf.samples[i] ?? { l: 0, r: 0 };
    left[i] = Math.max(-1, Math.min(1, s.l));
    if (channels > 1) right[i] = Math.max(-1, Math.min(1, s.r));
  }
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(ctx.destination);
  source.start(0, Math.max(0, Math.min(buf.samples.length / buf.sampleRate, offsetSec)));
  return () => { try { source.stop(); } catch { /* already stopped */ } };
}

// ---------------------------------------------------------------------------
// AnimationFrameStripView — render each frame of a Frames-shaped
// Animation as a small canvas tile in a horizontal strip. Animate-shaped
// Animations would need an engine round-trip; placeholder here.
// ---------------------------------------------------------------------------

export function AnimationFrameStripView(props: { value: AnimationRecord | FrameSequenceRec }) {
  const seq = createMemo<FrameSequenceRec | null>(() => {
    const v = props.value as any;
    if (v?.$tag === "Frames") return v._0 as FrameSequenceRec;
    if (typeof v?.fps === "number" && Array.isArray(v?.frames)) return v as FrameSequenceRec;
    return null;
  });

  const [mode, setMode] = createSignal<"strip" | "play">("strip");

  return (
    <div class="storybook-animation" style="width: 220px;">
      <Show when={seq()} fallback={
        <div style="height: 64px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.75rem; background: #f5f5f7; border-radius: 6px;">
          Animate (math expression)
        </div>
      }>
        <div style="display: flex; gap: 4px; margin-bottom: 4px;">
          <button type="button" onClick={() => setMode("strip")} style={tabBtn(mode() === "strip")}>Strip</button>
          <button type="button" onClick={() => setMode("play")} style={tabBtn(mode() === "play")}>▶ Play</button>
        </div>
        <Show when={mode() === "strip"} fallback={<FramePlayer seq={seq()!} />}>
          <div style="display: flex; gap: 2px; overflow-x: auto; padding: 2px; background: #0f172a; border-radius: 6px;">
            <For each={seq()!.frames}>
              {(frame) => <FrameTile frame={frame} />}
            </For>
          </div>
        </Show>
        <div class="text-muted mono" style="font-size: 0.7rem; margin-top: 2px;">
          {seq()?.frames.length} frames · {seq()?.fps} fps
        </div>
      </Show>
    </div>
  );
}

function tabBtn(active: boolean): string {
  return `
    font-size: 0.7rem;
    padding: 2px 8px;
    border: 1px solid ${active ? "#22d3ee" : "#ccc"};
    border-radius: 3px;
    background: ${active ? "#22d3ee" : "#fff"};
    color: ${active ? "#0f172a" : "#333"};
    cursor: pointer;
  `;
}

/** Plays a FrameSequence on a canvas at its declared fps; loops. Toggle
 *  pause via the overlay button. The MediaTimeline below the canvas
 *  shows progress and lets the reader scrub by clicking/dragging. */
function FramePlayer(props: { seq: FrameSequenceRec }) {
  const [playing, setPlaying] = createSignal(true);
  const [frameIdx, setFrameIdx] = createSignal(0);

  const fps = () => Math.max(1, props.seq.fps);
  const totalFrames = () => Math.max(1, props.seq.frames.length);
  const duration = () => totalFrames() / fps();
  const currentTime = () => frameIdx() / fps();

  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      setFrameIdx((i) => (i + 1) % totalFrames());
    }, 1000 / fps());
  };
  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  let previousSequence: FrameSequenceRec | undefined;
  let previousFps: number | undefined;
  let previousTotalFrames: number | undefined;
  createEffect(
    () => ({ sequence: props.seq, fps: fps(), totalFrames: totalFrames(), playing: playing() }),
    (state) => {
      stop();
      if (state.sequence !== previousSequence || state.fps !== previousFps || state.totalFrames !== previousTotalFrames) {
        setFrameIdx(0);
        previousSequence = state.sequence;
        previousFps = state.fps;
        previousTotalFrames = state.totalFrames;
      }
      if (state.playing) start();
      return stop;
    },
  );

  function handleSeek(t: number) {
    const idx = Math.max(0, Math.min(totalFrames() - 1, Math.floor(t * fps())));
    setFrameIdx(idx);
  }

  let canvasRef: HTMLCanvasElement | undefined;
  const frame = () => props.seq.frames[frameIdx()] ?? props.seq.frames[0];
  const paint = (f: ImageRecord | undefined) => {
    const c = canvasRef;
    if (!c) return;
    if (!f) return;
    c.width = f.width;
    c.height = f.height;
    const cx = c.getContext("2d");
    if (!cx) return;
    const data = cx.createImageData(f.width, f.height);
    for (let i = 0; i < f.width * f.height; i++) {
      const p = f.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    cx.putImageData(data, 0, 0);
  };
  onSettled(() => paint(frame()));
  createEffect(frame, paint);

  return (
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="position: relative; background: #0f172a; border-radius: 6px; padding: 4px;">
        <canvas
          ref={canvasRef}
          style={`image-rendering: pixelated; image-rendering: crisp-edges; width: 100%; aspect-ratio: ${frame()?.width ?? 1} / ${frame()?.height ?? 1}; display: block;`}
        />
        <div style="position: absolute; right: 8px; bottom: 8px; color: rgba(255,255,255,0.7); font-size: 0.65rem; font-family: ui-monospace, monospace;">
          {frameIdx() + 1}/{totalFrames()}
        </div>
      </div>
      <MediaTimeline
        duration={duration()}
        currentTime={currentTime()}
        onSeek={handleSeek}
        fps={fps()}
        isPlaying={playing()}
        onPlayPause={() => setPlaying((p) => !p)}
        axisHeight={28}
        tickCount={6}
      />
    </div>
  );
}

function FrameTile(props: { frame: ImageRecord }) {
  let canvasRef: HTMLCanvasElement | undefined;
  const paint = () => {
    const c = canvasRef;
    if (!c) return;
    const f = props.frame;
    const w = f.width | 0;
    const h = f.height | 0;
    if (w <= 0 || h <= 0) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const data = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const p = f.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    ctx.putImageData(data, 0, 0);
  };
  onSettled(paint);
  createEffect(
    () => props.frame,
    () => paint(),
  );
  return (
    <canvas
      ref={canvasRef}
      style="image-rendering: pixelated; image-rendering: crisp-edges; width: 32px; height: 32px; border-radius: 3px; flex-shrink: 0;"
    />
  );
}

// ---------------------------------------------------------------------------
// MovieView — frame strip + waveform stacked, shared timeline.
// ---------------------------------------------------------------------------

function MovieView(props: { value: MovieRecord | RecordedMovieRec }) {
  const rec = createMemo<RecordedMovieRec | null>(() => {
    const v = props.value as any;
    if (v?.$tag === "Recorded") return v._0 as RecordedMovieRec;
    if (typeof v?.fps === "number" && Array.isArray(v?.frames) && v?.audio?.samples) return v as RecordedMovieRec;
    return null;
  });

  const [mode, setMode] = createSignal<"strip" | "play">("strip");

  return (
    <div class="storybook-movie" style="width: 240px;">
      <Show when={rec()} fallback={
        <div style="height: 96px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.75rem; background: #f5f5f7; border-radius: 6px;">
          MovieAt (math expression)
        </div>
      }>
        <div style="display: flex; gap: 4px; margin-bottom: 4px;">
          <button type="button" onClick={() => setMode("strip")} style={tabBtn(mode() === "strip")}>Strip</button>
          <button type="button" onClick={() => setMode("play")} style={tabBtn(mode() === "play")}>▶ Play</button>
        </div>
        <Show when={mode() === "strip"} fallback={<MoviePlayer rec={rec()!} />}>
          <div style="display: flex; flex-direction: column; gap: 4px; padding: 4px; background: #0f172a; border-radius: 6px;">
            <div style="display: flex; gap: 1px; overflow-x: auto;">
              <For each={rec()!.frames}>
                {(frame) => <FrameTile frame={frame} />}
              </For>
            </div>
            <SoundWaveformInline buf={rec()!.audio} />
          </div>
        </Show>
        <div class="text-muted mono" style="font-size: 0.7rem; margin-top: 2px;">
          {rec()?.frames.length} frames · {rec()?.fps} fps · {(rec()!.audio.samples.length / rec()!.audio.sampleRate).toFixed(2)}s audio
        </div>
      </Show>
    </div>
  );
}

/** Synchronised playback: frames swap at fps, audio plays from the audio
 *  buffer's start, pause halts both. The MediaTimeline shows progress
 *  and supports scrubbing — dragging the playhead seeks the visual; the
 *  audio is restarted on play with whatever offset the user picked. */
function MoviePlayer(props: { rec: RecordedMovieRec }) {
  const [playing, setPlaying] = createSignal(false);
  const [frameIdx, setFrameIdx] = createSignal(0);

  const fps = () => Math.max(1, props.rec.fps);
  const totalFrames = () => Math.max(1, props.rec.frames.length);
  const duration = () => totalFrames() / fps();
  const currentTime = () => frameIdx() / fps();

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopAudio: (() => void) | null = null;

  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      setFrameIdx((i) => (i + 1) % totalFrames());
    }, 1000 / fps());
    stopAudio = playAudioBuffer(props.rec.audio);
  };
  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    stopAudio?.();
    stopAudio = null;
  };

  createEffect(
    () => playing(),
    (isPlaying) => {
      if (isPlaying) start();
      else stop();
    },
  );

  onCleanup(stop);

  function handleSeek(t: number) {
    const idx = Math.max(0, Math.min(totalFrames() - 1, Math.floor(t * fps())));
    setFrameIdx(idx);
  }

  let canvasRef: HTMLCanvasElement | undefined;
  const frame = () => props.rec.frames[frameIdx()] ?? props.rec.frames[0];
  const paint = (f: ImageRecord | undefined) => {
    const c = canvasRef;
    if (!c) return;
    if (!f) return;
    c.width = f.width;
    c.height = f.height;
    const cx = c.getContext("2d");
    if (!cx) return;
    const data = cx.createImageData(f.width, f.height);
    for (let i = 0; i < f.width * f.height; i++) {
      const p = f.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    cx.putImageData(data, 0, 0);
  };
  onSettled(() => paint(frame()));
  createEffect(frame, paint);

  return (
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="position: relative; background: #0f172a; border-radius: 6px; padding: 4px;">
        <canvas
          ref={canvasRef}
          style="image-rendering: pixelated; image-rendering: crisp-edges; width: 100%; aspect-ratio: 1 / 1; display: block;"
        />
        <div style="position: absolute; right: 8px; bottom: 8px; color: rgba(255,255,255,0.7); font-size: 0.65rem; font-family: ui-monospace, monospace;">
          {frameIdx() + 1}/{totalFrames()}
        </div>
      </div>
      <MediaTimeline
        duration={duration()}
        currentTime={currentTime()}
        onSeek={handleSeek}
        fps={fps()}
        isPlaying={playing()}
        onPlayPause={() => setPlaying((p) => !p)}
        axisHeight={28}
        tickCount={6}
      />
    </div>
  );
}

function SoundWaveformInline(props: { buf: AudioBufRec }) {
  const w = 220;
  const h = 32;
  const path = createMemo(() => {
    const b = props.buf;
    if (!b || b.samples.length === 0) return "";
    const step = Math.max(1, Math.floor(b.samples.length / w));
    let d = "";
    for (let x = 0; x < w; x++) {
      const i = Math.min(b.samples.length - 1, x * step);
      const a = b.samples[i]?.l ?? 0;
      const y = h / 2 - (a * h) / 2;
      d += (x === 0 ? "M" : "L") + x + "," + y.toFixed(1) + " ";
    }
    return d;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style="display: block;">
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#334155" stroke-width="1" />
      <path d={path()} stroke="#22d3ee" stroke-width="1" fill="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TrackTimelineView — entries on a horizontal time axis. Each entry is a
// dot at its start time, sized by the carried sound's duration where
// known (Buffer entries report length / sampleRate).
// ---------------------------------------------------------------------------

function TrackTimelineView(props: { value: TrackRecord }) {
  const totalDuration = createMemo(() => {
    let max = 0;
    for (const e of props.value.entries) {
      const dur = soundDuration(e.sound);
      if (e.start + dur > max) max = e.start + dur;
    }
    return Math.max(0.5, max);
  });

  return (
    <div class="storybook-track" style="width: 220px;">
      <div style="position: relative; height: 56px; background: #0f172a; border-radius: 6px; padding: 4px 6px;">
        <For each={props.value.entries}>
          {(entry, i) => {
            const dur = soundDuration(entry.sound);
            const left = (entry.start / totalDuration()) * 100;
            const width = Math.max(2, (dur / totalDuration()) * 100);
            const top = (i() % 3) * 16 + 4;
            return (
              <div
                data-tooltip={`start ${entry.start.toFixed(2)}s · ${dur.toFixed(2)}s`}
                style={`
                  position: absolute;
                  left: ${left.toFixed(2)}%;
                  top: ${top}px;
                  width: ${width.toFixed(2)}%;
                  height: 12px;
                  background: linear-gradient(to right, #22d3ee, #6366f1);
                  border-radius: 6px;
                `}
              />
            );
          }}
        </For>
      </div>
      <div class="text-muted mono" style="font-size: 0.7rem; margin-top: 2px;">
        {props.value.entries.length} entries · {totalDuration().toFixed(2)}s
      </div>
    </div>
  );
}

function soundDuration(s: SoundRecord): number {
  if (s.$tag === "Buffer") {
    const b = s._0 as AudioBufRec;
    if (b && b.sampleRate > 0) return b.samples.length / b.sampleRate;
  }
  return 0.5;
}

// ---------------------------------------------------------------------------
// GameView — render a Game by deriving its animation through the engine
// and showing the resulting frames as a strip + a small "tick scrubber"
// that lets the reader move through time. Calls the engine's gameToAnim
// + sampleAnim + Picture render via the lazy storybook context.
// ---------------------------------------------------------------------------

function GameView(props: { value: GameRecord; getContext: () => EvaluateContext }) {
  const [mode, setMode] = createSignal<"strip" | "play">("strip");
  return (
    <div class="storybook-game" style="width: 240px;">
      <div style="display: flex; gap: 4px; margin-bottom: 4px;">
        <button
          type="button"
          onClick={() => setMode("strip")}
          style={`
            font-size: 0.7rem;
            padding: 2px 8px;
            border: 1px solid ${mode() === "strip" ? "#22d3ee" : "#ccc"};
            border-radius: 3px;
            background: ${mode() === "strip" ? "#22d3ee" : "#fff"};
            color: ${mode() === "strip" ? "#0f172a" : "#333"};
            cursor: pointer;
          `}
        >Strip</button>
        <button
          type="button"
          onClick={() => setMode("play")}
          style={`
            font-size: 0.7rem;
            padding: 2px 8px;
            border: 1px solid ${mode() === "play" ? "#22d3ee" : "#ccc"};
            border-radius: 3px;
            background: ${mode() === "play" ? "#22d3ee" : "#fff"};
            color: ${mode() === "play" ? "#0f172a" : "#333"};
            cursor: pointer;
          `}
        >▶ Play</button>
      </div>
      <Show when={mode() === "strip"} fallback={<LiveGame value={props.value} getContext={props.getContext} />}>
        <GameStripView value={props.value} getContext={props.getContext} />
      </Show>
    </div>
  );
}

/** Deterministic sequence of frames spanning the pre-recorded event range
 *  — what the game produces if you replay the example's input stream. */
function GameStripView(props: { value: GameRecord; getContext: () => EvaluateContext }) {
  const animation = createMemo(() => {
    try {
      return evaluateExpr(
        { call: ["gameToAnim", { var: "_g" }] },
        { _g: props.value },
        props.getContext(),
      );
    } catch {
      return null;
    }
  });

  const FRAME_COUNT = 8;
  const W = 16;
  const H = 16;

  const totalDuration = createMemo(() => {
    const stamps = props.value.inputs.entries.map((e) => e.timestamp);
    if (stamps.length === 0) return 1;
    return Math.max(...stamps) + 0.3;
  });

  const frames = createMemo<ImageRecord[]>(() => {
    const anim = animation();
    if (!anim) return [];
    const out: ImageRecord[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = (i / (FRAME_COUNT - 1)) * totalDuration();
      try {
        const pic = evaluateExpr(
          { call: ["sample", { var: "_a" }, { call: ["time", t] }] },
          { _a: anim },
          props.getContext(),
        );
        const img = evaluateExpr(
          { call: ["render", { var: "_p" }, W, H] },
          { _p: pic },
          props.getContext(),
        ) as ImageRecord;
        out.push(img);
      } catch {
        out.push({ width: W, height: H, pixels: new Array(W * H).fill({ r: 0, g: 0, b: 0, a: 0 }) });
      }
    }
    return out;
  });

  const inputCount = createMemo(() => props.value.inputs.entries.length);

  return (
    <>
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 4px; background: #0f172a; border-radius: 6px;">
        <div style="display: flex; gap: 1px; overflow-x: auto;">
          <For each={frames()}>{(frame) => <FrameTile frame={frame} />}</For>
        </div>
      </div>
      <div class="text-muted mono" style="font-size: 0.7rem; margin-top: 2px;">
        {inputCount()} pre-recorded inputs · {totalDuration().toFixed(2)}s
      </div>
    </>
  );
}

/** Live interactive play: clicks (and key presses where wired) become
 *  Event entries with the live wall-clock timestamp; the game's derived
 *  Animation is sampled at "now" each tick and rendered to a canvas.
 *  The Game is treated as a TEMPLATE — the actual running instance has
 *  its `inputs.entries` extended by the user's inputs in real time. */
function LiveGame(props: { value: GameRecord; getContext: () => EvaluateContext }) {
  const W = 64; // larger canvas than the strip view for legibility
  const H = 64;
  const startMs = Date.now();
  const [tick, setTick] = createSignal(0);
  const [extraInputs, setExtraInputs] = createSignal<EventEntryRec[]>([]);

  // 30 fps render tick — drives the "sample at now" loop.
  onSettled(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  });

  const liveGame = createMemo<GameRecord>(() => ({
    ...props.value,
    inputs: {
      entries: [...props.value.inputs.entries, ...extraInputs()],
    },
  }));

  const animation = createMemo(() => {
    try {
      return evaluateExpr(
        { call: ["gameToAnim", { var: "_g" }] },
        { _g: liveGame() },
        props.getContext(),
      );
    } catch {
      return null;
    }
  });

  const currentFrame = createMemo<ImageRecord | null>(() => {
    void tick(); // re-run on tick
    const anim = animation();
    if (!anim) return null;
    const now = (Date.now() - startMs) / 1000;
    try {
      const pic = evaluateExpr(
        { call: ["sample", { var: "_a" }, { call: ["time", now] }] },
        { _a: anim },
        props.getContext(),
      );
      return evaluateExpr(
        { call: ["render", { var: "_p" }, W, H] },
        { _p: pic },
        props.getContext(),
      ) as ImageRecord;
    } catch {
      return null;
    }
  });

  function pushClick(payload: unknown) {
    const t = (Date.now() - startMs) / 1000;
    setExtraInputs((es) => [...es, { timestamp: t, payload }]);
  }

  function onCanvasClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    // Two payload conventions: a number for paddle (x-coord) and a
    // sentinel string for counter-style clicks. The game's update fn
    // decides what to do with whatever payload arrives.
    pushClick(Math.round(x));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") pushClick(-1);
    else if (e.key === "ArrowRight") pushClick(1);
    else pushClick(e.key);
  }

  let canvasRef: HTMLCanvasElement | undefined;
  const paint = () => {
    const c = canvasRef;
    if (!c) return;
    const f = currentFrame();
    if (!f) return;
    c.width = f.width;
    c.height = f.height;
    const cx = c.getContext("2d");
    if (!cx) return;
    const data = cx.createImageData(f.width, f.height);
    for (let i = 0; i < f.width * f.height; i++) {
      const p = f.pixels[i] ?? { r: 0, g: 0, b: 0, a: 0 };
      data.data[i * 4 + 0] = clampByte(p.r);
      data.data[i * 4 + 1] = clampByte(p.g);
      data.data[i * 4 + 2] = clampByte(p.b);
      data.data[i * 4 + 3] = clampByte(p.a);
    }
    cx.putImageData(data, 0, 0);
  };
  onSettled(paint);
  createEffect(
    () => currentFrame(),
    () => paint(),
  );

  return (
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <canvas
        ref={canvasRef}
        tabindex="0"
        onClick={onCanvasClick}
        onKeyDown={onKey}
        style="image-rendering: pixelated; image-rendering: crisp-edges; width: 100%; aspect-ratio: 1 / 1; background: #0f172a; border-radius: 6px; cursor: crosshair; outline: none;"
        data-tooltip="Click anywhere to send an input event. Focus + arrow keys for ±1 inputs."
      />
      <div class="text-muted mono" style="font-size: 0.7rem;">
        {extraInputs().length} live inputs · {((Date.now() - startMs) / 1000).toFixed(1)}s elapsed · click / arrow keys
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventListView — vertical list of timestamped payloads.
// ---------------------------------------------------------------------------

function EventListView(props: { value: EventRecord }) {
  return (
    <div class="storybook-events" style="width: 220px; max-height: 120px; overflow-y: auto; background: #0f172a; border-radius: 6px; padding: 6px; font-family: ui-monospace, monospace; font-size: 0.7rem; color: #e2e8f0;">
      <For each={props.value.entries}>
        {(entry) => (
          <div style="display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px dashed #334155;">
            <span style="color: #94a3b8; min-width: 36px; text-align: right;">
              {entry.timestamp.toFixed(2)}s
            </span>
            <span style="color: #fbbf24; flex: 1;">
              {typeof entry.payload === "string" ? `"${entry.payload}"` : JSON.stringify(entry.payload)}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function clampByte(n: unknown): number {
  const x = typeof n === "number" ? n : 0;
  if (x < 0) return 0;
  if (x > 255) return 255;
  return Math.round(x);
}

function RenderScalar(props: { value: unknown }) {
  const v = () => props.value;
  return (
    <Show
      when={v() !== undefined && v() !== null}
      fallback={<span class="text-muted">(none)</span>}
    >
      <Show
        when={typeof v() === "boolean"}
        fallback={
          <Show
            when={typeof v() === "number"}
            fallback={
              <Show
                when={typeof v() === "string"}
                fallback={<pre class="storybook-json">{JSON.stringify(v(), null, 2)}</pre>}
              >
                <span class="storybook-string">{String(v())}</span>
              </Show>
            }
          >
            <span class="storybook-number mono">{String(v())}</span>
          </Show>
        }
      >
        <span class={`storybook-bool ${v() ? "storybook-bool--t" : "storybook-bool--f"}`}>
          {v() ? "✓" : "✗"}
        </span>
      </Show>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortCaption(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (isImageRecord(v)) {
    const o = v as ImageRecord;
    return `${o.width}×${o.height} px`;
  }
  if (typeof v === "string") {
    if (isImageLike(v)) return "image";
    if (v.length === 0) return '""';
    if (v.length > 24) return JSON.stringify(v.slice(0, 22) + "…");
    return JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Get a usable display name from a FenelType. Used to thread the right
 *  typeName to ValueDisplay — same logic as the dashboard's typeShort
 *  helpers, kept local because the typeName is purely advisory here. */
function typeNameOf(t: FenelType): string | undefined {
  const o = t as Record<string, unknown>;
  if ("$ref" in o) return String(o.$ref);
  if ("$refined" in o) return typeNameOf((o.$refined as { base: FenelType }).base);
  if ("$tagged" in o) return typeNameOf((o.$tagged as { value: FenelType }).value);
  const list = peelList(t);
  if (list) {
    const inner = typeNameOf(list.elem);
    return inner ? `List(${inner})` : undefined;
  }
  return undefined;
}

/** Synthesize example input rows by zipping per-param Exemplifiable lists.
 *  Stops at the shortest list. Fine as a fallback for pure std functions
 *  that don't carry their own curated examples. */
function synthesizeExamples(fn: FenelFunction, examplesForType: (typeName: string) => unknown[]): FunctionExample[] {
  const perParam: unknown[][] = [];
  for (const p of fn.params) {
    const tn = typeNameOf(p.type);
    if (!tn) return [];
    const ex = examplesForType(tn);
    if (!ex || ex.length === 0) return [];
    perParam.push(ex);
  }
  const len = perParam.reduce((a, arr) => Math.min(a, arr.length), Infinity);
  if (!isFinite(len) || len === 0) return [];
  const out: FunctionExample[] = [];
  for (let i = 0; i < Math.min(len, 4); i++) {
    out.push({ args: perParam.map((arr) => arr[i]) });
  }
  return out;
}

/** Evaluate a function example, returning the result and the trace of
 *  intermediate steps. For functions with a body, the body is evaluated
 *  through the traced evaluator — each call/pipe step inside emits a
 *  TraceStep. For native-only functions there's no body to walk; the captured
 *  evaluator invokes the reference and returns an empty inner trace. */
function evaluateExample(
  fn: FenelFunction,
  args: unknown[],
  context: EvaluateContext,
): { result: unknown; trace: TraceStep[] } {
  // Build the param data context.
  const data: Record<string, unknown> = {};
  for (let i = 0; i < fn.params.length; i++) {
    data[fn.params[i]!.name] = args[i];
  }

  if (fn.body !== undefined) {
    try {
      return evaluateWithTrace(fn.body, data, context);
    } catch {
      return { result: undefined, trace: [] };
    }
  }

  // No body: the captured evaluator resolves the callable and mediates its
  // effects. A same-named native in another registry is never a fallback.
  try {
    return { result: invokeCallable({ $ref: fn.id }, args, context), trace: [] };
  } catch {
    return { result: undefined, trace: [] };
  }
}

/** Display label for a function id — `std:imageGrayscale` →
 *  `std.imageGrayscale`. Function ids are `<module>:<name>` since
 *  the fn: prefix removal. */
function shortFnName(id: string): string {
  const parts = id.split(":");
  return parts.length === 2 ? `${parts[0]}.${parts[1]}` : id;
}

/** Compact rendering of a non-leading argument in a trace step header.
 *  The leading argument is the piped value — already displayed as the
 *  step's input — so we only need to surface the "extras." */
function formatArg(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    return v.length > 16 ? JSON.stringify(v.slice(0, 14) + "…") : JSON.stringify(v);
  }
  return "…";
}
