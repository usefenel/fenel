// ---------------------------------------------------------------------------
// Cross-modal — FFI leaf (the irreducible host bridge: the CTX-threading
// `sonify` / `visualize` natives that re-enter the evaluator / build Field
// closures, plus the pure per-pixel `_visualizeAt` lookup).
//
// module-substrate Phase 3i — crossmodal is the warm-up of the non-media
// ctx BULK and the smallest of the seven (3 fns, disjoint plain/ctx split,
// no entities, no own dispatch instances). It is a media-ADJACENT composer:
// the leaf imports a SIBLING media base's natives/types LEAF-TO-LEAF
// (`renderNative` from picture-ffi, `AudioBufferValue`/`AmplitudeValue` from
// sound-ffi) — the 3g banked edge (`fenel/ffi → fenel/ffi`), not via the
// base's engine seam — keeping the irreducible-host layer self-contained
// under `fenel/`. `EvaluateContext` + `RgbaPixelValue`/`ImageValue` come from the
// engine internals (the `fenel/ffi → engine` edge picture proved in 3f).
//
// The split (disjoint, picture's shape):
//   - PLAIN native (`_visualizeAt`) — a pure per-pixel colour lookup, no ctx
//     → `crossmodalNatives` → the module's `nativeImpls`;
//   - CTX natives (`sonify` / `visualize`) — take the `EvaluateContext` as
//     their first arg (`sonify` re-enters the evaluator via the picture
//     renderer; `visualize` builds a Field closure) → `crossmodalNativesCtx`
//     → the module's `nativeImplsCtx`. Which map an impl lands in is the ONLY
//     thing that decides plain-vs-ctx — no `.fenel` marker needed (the
//     `@native` foreign decl is uniform; the seam routes — axis #4 settled).
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `sonifyNative` is a genuine bridge leaf — it re-enters the evaluator (via
// `renderPictureNative`, which runs Field closures) to rasterise the picture.
// `visualizeNative` builds a Field closure value (it takes `ctx` only for the
// uniform ctx-native arity; it never uses it). But the body math —
// `clampUnit`, `luminance`, the luminance→amplitude scan loop, the waveform
// column pre-compute, and the WHOLE of `_visualizeAt` (per-pixel colour
// decision: cyan trace / dim centre / dark background) — is PURE arithmetic
// + record-reshaping that composes from std fns. They are parked here to
// preserve Phase-3i PARITY (byte-for-byte), NOT because they belong at an
// ffi leaf — same posture as picture's / codec's pure helpers. A Fenel
// re-port is a candidate for a later coordinated sweep (against the
// Fenel-first HARD RULE); porting now would be a re-port the parity brief
// explicitly forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

import { type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import type { ImageValue, RgbaPixelValue } from "../../../../implementations/typescript/engine/src/image-data";
import { renderNative as renderPictureNative } from "../../picture/ffi/picture-ffi";
import type { AudioBufferValue, AmplitudeValue } from "../../sound/ffi/sound-ffi";

// ---------------------------------------------------------------------------
// Helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return 1;
  if (n < -1) return -1;
  return n;
}

function luminance(p: RgbaPixelValue): number {
  return (0.299 * p.r + 0.587 * p.g + 0.114 * p.b) / 255;
}

// ---------------------------------------------------------------------------
// sonify — Picture → Sound (CTX native: re-enters the evaluator via the
// picture renderer to rasterise the picture, then scans the pixels).
// ---------------------------------------------------------------------------

/** Convert a Picture into a Sound by scanning the rendered image
 *  left-to-right, top-to-bottom and using each pixel's luminance as
 *  amplitude. Stereo: L from luminance(p), R from sin(2π·f·t) modulated
 *  by colour saturation, so two distinct images make two audibly
 *  distinct sounds. */
function sonifyNative(
  ctx: EvaluateContext,
  picture: unknown,
  duration: unknown,
  sampleRate: unknown,
): AudioBufferValue {
  const dur = Math.max(0.01, Number(duration));
  const sr = Math.max(1, Math.floor(Number(sampleRate)));
  // Render the Picture at a resolution that gives roughly one pixel per
  // audio sample — the sonification scans the image at audio rate.
  const totalSamples = Math.floor(dur * sr);
  const w = Math.min(256, Math.max(8, Math.floor(Math.sqrt(totalSamples))));
  const h = w;
  const img: ImageValue = renderPictureNative(ctx, picture, w, h);

  const samples: AmplitudeValue[] = new Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    // Map sample index to a pixel (left→right, top→bottom raster scan).
    const fracIdx = (i / totalSamples) * (w * h);
    const pixelIdx = Math.min(w * h - 1, Math.floor(fracIdx));
    const p = img.pixels[pixelIdx] ?? { r: 0, g: 0, b: 0, a: 0 };
    // Luminance maps to base amplitude (signed: bright = +, dark = -).
    const lum = luminance(p) * 2 - 1; // [-1, 1]
    // R/B difference adds a separate signal to the right channel so
    // colourful images sound different from greyscale ones.
    const colorContrast = ((p.r - p.b) / 255);
    samples[i] = {
      l: clampUnit(lum),
      r: clampUnit(colorContrast),
    };
  }
  return { sampleRate: sr, channels: 2, samples };
}

// ---------------------------------------------------------------------------
// visualize — Sound → Picture (CTX native for uniform arity; builds a Field
// closure value, does not use ctx).
// ---------------------------------------------------------------------------

/** Convert a Sound (rendered to a buffer) into a Picture: a horizontal
 *  waveform plot on a dark background. The Picture is a Field that
 *  computes its colour from the buffer at each (x, y). Inside the
 *  caller-provided width / height the plot fills from x=0 to x=w-1,
 *  with the waveform centred vertically. */
function visualizeNative(
  _ctx: EvaluateContext,
  sound: unknown,
  width: unknown,
  height: unknown,
): unknown {
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  // Pull the buffer out of a Buffer-tagged Sound; for Wave-shaped Sounds
  // we'd need to render first — caller is expected to do that and pass
  // a Buffer-tagged Sound.
  const obj = sound as Record<string, unknown> | null | undefined;
  let buf: AudioBufferValue | null = null;
  if (obj && typeof obj === "object" && obj.$tag === "Buffer") {
    buf = (obj as { _0?: AudioBufferValue })._0 ?? null;
  } else if (obj && typeof obj === "object" && Array.isArray((obj as any).samples)) {
    buf = obj as unknown as AudioBufferValue;
  }
  if (!buf || buf.samples.length === 0) {
    // Empty input → solid black picture.
    return {
      $tag: "Field",
      _0: {
        __fenelFn: true,
        params: ["p"],
        body: { call: ["color", 0, 0, 0, 255] },
        closure: {},
      },
    };
  }
  // Pre-compute one amplitude per output column so per-pixel sampling
  // is cheap. The Field closure looks up by floor(p.x).
  const cols: number[] = new Array(w);
  const samples = buf.samples;
  const step = Math.max(1, Math.floor(samples.length / w));
  for (let x = 0; x < w; x++) {
    const i = Math.min(samples.length - 1, x * step);
    cols[x] = samples[i]?.l ?? 0;
  }
  // Field closure body: at point p, look up cols[floor(p.x)] and decide
  // whether the waveform line passes through this y.
  return {
    $tag: "Field",
    _0: {
      __fenelFn: true,
      params: ["p"],
      body: {
        call: ["_visualizeAt", { var: "_cols" }, { var: "_w" }, { var: "_h" }, { var: "p" }],
      },
      closure: { _cols: cols, _w: w, _h: h },
    },
  };
}

// ---------------------------------------------------------------------------
// _visualizeAt — PLAIN native: per-pixel colour lookup for visualize's Field
// closure. Pure arithmetic, no ctx.
// ---------------------------------------------------------------------------

/** Helper invoked by the Field closure that visualize produces. */
function visualizeAtNative(
  cols: unknown,
  width: unknown,
  height: unknown,
  point: unknown,
): RgbaPixelValue {
  const w = Number(width);
  const h = Number(height);
  if (!Array.isArray(cols)) return { r: 0, g: 0, b: 0, a: 255 };
  const arr = cols as number[];
  const pt = point as { x?: unknown; y?: unknown };
  const x = Math.max(0, Math.min(w - 1, Math.floor(Number(pt?.x))));
  const y = Number(pt?.y);
  const a = arr[x] ?? 0;
  // The waveform y-position for this column.
  const waveY = h / 2 - (a * h) / 2;
  // Light up the pixel if y is within 1 unit of the wave line; dimmer
  // for the centre line; black otherwise.
  if (Math.abs(y - waveY) <= 1) return { r: 34, g: 211, b: 238, a: 255 };  // cyan trace
  if (Math.abs(y - h / 2) <= 0.5) return { r: 51, g: 65, b: 85, a: 255 };  // dim centre line
  return { r: 15, g: 23, b: 42, a: 255 }; // dark background
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the
// `crossmodal:` id-namespace via `rekeyNativesById` and attaches them to the
// FenelModule's `nativeImpls` (plain) + `nativeImplsCtx` (ctx). Same plain
// `Record<codeName, JsFn>` shape the spec file declared before the split;
// only the FILE LOCATION moved.
// ---------------------------------------------------------------------------

export const crossmodalNatives: Record<string, (...args: unknown[]) => unknown> = {
  _visualizeAt: (cols: unknown, w: unknown, h: unknown, p: unknown) =>
    visualizeAtNative(cols, w, h, p),
};

export const crossmodalNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sonify: (ctx: EvaluateContext, picture: unknown, duration: unknown, sampleRate: unknown) =>
    sonifyNative(ctx, picture, duration, sampleRate),
  visualize: (ctx: EvaluateContext, sound: unknown, width: unknown, height: unknown) =>
    visualizeNative(ctx, sound, width, height),
};

export { sonifyNative, visualizeNative, visualizeAtNative };
