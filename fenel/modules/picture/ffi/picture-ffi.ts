// ---------------------------------------------------------------------------
// Picture — FFI leaf (the irreducible host bridge: the CTX-threading
// `sample`/`render` natives that re-enter the evaluator, plus the
// representation-record constructor helpers).
//
// module-substrate Phase 3f — picture is the Phase-3e-designated REPRESENTATIVE
// CTX-NATIVE: the first `ffi/` leaf to host a `nativeImplsCtx` map. `time`
// (3b) + `codec` (3d) proved the plain `nativeImpls` split; neither exercised
// the ctx tier. picture forces BOTH maps out of one leaf:
//   - PLAIN natives (`point` / `color` / `alphaBlend`) — pure constructor
//     helpers, no ctx → `pictureNatives` → the module's `nativeImpls`;
//   - CTX natives (`sample` / `render`) — re-enter the evaluator via
//     `invokeCallable` to run a `Field`'s `Point -> RgbaPixel` closure → take the
//     `EvaluateContext` as their first arg → `pictureNativesCtx` → the module's
//     `nativeImplsCtx`. The runtime resolves a ctx-native via `ctx.nativesCtx`
//     and invokes it WITH `ctx` as the leading arg (`json-logic.ts` applyOp);
//     a plain native via `ctx.natives` with no ctx. Which map an impl lands in
//     is the ONLY thing that decides plain-vs-ctx — no `.fenel` marker needed
//     (the `@native` foreign decl is uniform; the seam routes).
//
// AXIS DECISION (brief axis #2) — this leaf imports `invokeCallable` +
// `EvaluateContext` + `RgbaPixelValue` / `ImageValue` from the engine internals,
// the FAITHFUL-TO-CURRENT-CODE option (the retired `engine/src/modules/
// picture.ts` typed `sampleNative(ctx: EvaluateContext, …): RgbaPixelValue`
// exactly so). This is the FIRST `fenel/ffi → engine` import edge — `time` /
// `codec` leaves were host-only (Buffer / atob / Date.*). The 3b `rootDir`→
// repo-root build-wiring already lets the engine tsconfig compile `fenel/`
// leaves, so the import resolves under `--noEmit`; at runtime the
// engine-seam → ffi-leaf → json-logic cycle is safe because `invokeCallable`
// is referenced at call time, not module-init time. The seam then casts the
// ctx map to FenelModule's dependency-free `(ctx: unknown, …)` shape.
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `sampleNative` / `renderNative` are genuine bridge leaves — they re-enter
// the evaluator to run user closures, which a `.fenel` body can't do. But the
// constructor / coercion helpers — `clampByte`, `asColor`, `asPoint`,
// `asImage`, `variantPayload`, `rasterSample`, `colorNative`, `pointNative`,
// — are PURE arithmetic / record-reshaping that compose from
// std fns (clamp / round / mul / add / variant payload extraction). They are
// parked here to preserve Phase-3f PARITY (byte-for-byte), NOT because they
// belong at an ffi leaf — same posture as codec's 5 pure helpers. They build
// the runtime REPRESENTATION records (`{r,g,b,a}` / `{x,y}` / pixel buffers)
// the opaque-repr layer uses; a Fenel re-port is a candidate for a later
// coordinated sweep (against the Fenel-first HARD RULE), but porting now would
// be a re-port the parity brief explicitly forbids.
// alphaBlend now has a Fenel body delegating std:imageSourceOverPixel; its
// explicitly approved performance entry calls that source algorithm's shared
// image mirror, rather than retaining a separate picture compositing formula.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder — this is the third such leaf
// (after `time/ffi/` + `codec/ffi/`), and the first that imports engine
// internals.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";
import type { RgbaPixelValue, ImageValue } from "../../../../implementations/typescript/engine/src/image-data";
import { imgSourceOverPixel } from "../../../../implementations/typescript/engine/src/image-ops";

// ---------------------------------------------------------------------------
// Native helpers (PURE — F-permanent FLAG above)
// ---------------------------------------------------------------------------

const TRANSPARENT: RgbaPixelValue = { r: 0, g: 0, b: 0, a: 0 };

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function asColor(v: unknown): RgbaPixelValue {
  if (!v || typeof v !== "object") return TRANSPARENT;
  const o = v as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
  return {
    r: clampByte(Number(o.r)),
    g: clampByte(Number(o.g)),
    b: clampByte(Number(o.b)),
    a: clampByte(Number(o.a)),
  };
}

function asPoint(v: unknown): { x: number; y: number } {
  if (!v || typeof v !== "object") return { x: 0, y: 0 };
  const o = v as { x?: unknown; y?: unknown };
  return { x: Number(o.x) || 0, y: Number(o.y) || 0 };
}

function asImage(v: unknown): ImageValue {
  if (!v || typeof v !== "object") return { width: 0, height: 0, pixels: [] };
  const o = v as { width?: unknown; height?: unknown; pixels?: unknown };
  if (typeof o.width !== "number" || typeof o.height !== "number" || !Array.isArray(o.pixels)) {
    return { width: 0, height: 0, pixels: [] };
  }
  return o as ImageValue;
}

/** Pull the single positional payload out of a one-payload variant value.
 *  v1 Picture cases (`Raster Image`, `Field (Point -> RgbaPixel)`) each carry a
 *  single positional field, so the first non-`$tag` key is the payload —
 *  whether the runtime stored it under `_0` (parser-derived field name) or
 *  `"0"` (numeric fallback when `_constructors` isn't pre-populated). */
function variantPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "$tag") return obj[key];
  }
  return undefined;
}

/** Read the image at an integer (or near-integer) point. v1 uses
 *  nearest-neighbour to avoid bilinear edge logic; the same hook can land
 *  bilinear when the rendered output benefits from it. */
function rasterSample(img: ImageValue, pt: { x: number; y: number }): RgbaPixelValue {
  const w = img.width;
  const h = img.height;
  if (w === 0 || h === 0) return TRANSPARENT;
  const x = Math.max(0, Math.min(w - 1, Math.floor(pt.x)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(pt.y)));
  return img.pixels[y * w + x] ?? TRANSPARENT;
}

// ---------------------------------------------------------------------------
// CTX natives — `sample` / `render` re-enter the evaluator to invoke Field
// closures, so they take the `EvaluateContext` as their first arg. The runtime
// resolves them via `ctx.nativesCtx[id]` and calls `impl(ctx, …evaluatedArgs)`.
// ---------------------------------------------------------------------------

/** Sample a Picture at a Point, returning a RgbaPixel. Variant dispatch on
 *  `$tag`: a Field invokes its carried closure; a Raster reads the pixel
 *  buffer. Unknown / malformed shapes return transparent. */
function sampleNative(
  ctx: EvaluateContext,
  picture: unknown,
  pt: unknown,
): RgbaPixelValue {
  if (!picture || typeof picture !== "object") return TRANSPARENT;
  const obj = picture as Record<string, unknown>;
  const tag = obj.$tag as string | undefined;

  if (tag === "Field") {
    const callable = variantPayload(obj);
    if (callable === undefined) return TRANSPARENT;
    const result = invokeCallable(callable, [pt], ctx);
    return asColor(result);
  }

  if (tag === "Raster") {
    return rasterSample(asImage(variantPayload(obj)), asPoint(pt));
  }

  return TRANSPARENT;
}

/** Rasterise a Picture into a width × height Image by sampling at each
 *  integer pixel. Constructs a Point record for each (x, y) so the Field
 *  closures see the same shape they'd see from user-level callers. */
function renderNative(
  ctx: EvaluateContext,
  picture: unknown,
  w: unknown,
  h: unknown,
): ImageValue {
  const W = Math.max(1, Math.floor(Number(w)));
  const H = Math.max(1, Math.floor(Number(h)));
  const pixels: RgbaPixelValue[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      pixels[y * W + x] = sampleNative(ctx, picture, { x, y });
    }
  }
  return { width: W, height: H, pixels };
}

// ---------------------------------------------------------------------------
// PLAIN natives — pure constructor helpers, no ctx. Build the runtime
// representation records the opaque-repr layer stores.
// ---------------------------------------------------------------------------

/** Build a RgbaPixel record from r, g, b, a byte components (clamped 0–255). */
function colorNative(r: unknown, g: unknown, b: unknown, a: unknown): RgbaPixelValue {
  return {
    r: clampByte(Number(r)),
    g: clampByte(Number(g)),
    b: clampByte(Number(b)),
    a: clampByte(Number(a)),
  };
}

/** Build a Point record from x, y. Real-valued — no rounding. */
function pointNative(x: unknown, y: unknown): { x: number; y: number } {
  return { x: Number(x) || 0, y: Number(y) || 0 };
}

/** Source-backed performance branch of picture:alphaBlend. Its shared pixel
 *  routine mirrors std:imageSourceOverPixel and is also used by Image overlay. */
function alphaBlendNative(top: unknown, bot: unknown): RgbaPixelValue {
  return imgSourceOverPixel(asColor(top), asColor(bot));
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the
// `picture:` id-namespace via `rekeyNativesById` and attaches them to the
// FenelModule's `nativeImpls` (plain) + `nativeImplsCtx` (ctx). The shapes are
// the SAME plain `Record<codeName, JsFn>` the spec file declared before the
// split; only the FILE LOCATION moved (TS source-of-truth → `ffi/` leaf), not
// the runtime contract. `picture.test.ts` exercises the impls through the
// registry rather than via direct map calls, so the maps need not stay
// codeName-keyed at the export — but the individual `*Native` fns ARE
// re-exported (the self-host classifiers + animation / movie / crossmodal
// import them directly).
// ---------------------------------------------------------------------------

export const pictureNatives: Record<string, (...args: unknown[]) => unknown> = {
  point: (x: unknown, y: unknown) => pointNative(x, y),
  color: (r: unknown, g: unknown, b: unknown, a: unknown) => colorNative(r, g, b, a),
  alphaBlend: (top: unknown, bot: unknown) => alphaBlendNative(top, bot),
};

export const pictureNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  sample: (ctx: EvaluateContext, picture: unknown, pt: unknown) => sampleNative(ctx, picture, pt),
  render: (ctx: EvaluateContext, picture: unknown, w: unknown, h: unknown) =>
    renderNative(ctx, picture, w, h),
};

export {
  sampleNative,
  renderNative,
  pointNative,
  colorNative,
  alphaBlendNative,
};
