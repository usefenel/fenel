// ---------------------------------------------------------------------------
// Image as proper structural Fenel data — not a URL string.
//
// RgbaPixel is an RGBA byte tuple. Image is { width, height, pixels } where
// pixels is a row-major List<RgbaPixel>. Image-processing std functions
// take the matrix in, transform it, and return a new matrix — pure data
// in, pure data out. The dashboard's storybook detects the record shape
// at render time and rasterises through a canvas widget.
//
// Sample images are programmatically generated so the catalog ships
// with concrete pixel data without us hand-writing 256+ pixel literals.
// ---------------------------------------------------------------------------

import landscape from "./sample-image-landscape.json";
import {
  EYE_WIDTH, EYE_HEIGHT, EYE_RGBA_B64,
  BOOK_WIDTH, BOOK_HEIGHT, BOOK_RGBA_B64,
  FENNEL_WIDTH, FENNEL_HEIGHT, FENNEL_RGBA_B64,
  PORTRAIT_WIDTH, PORTRAIT_HEIGHT, PORTRAIT_RGBA_B64,
  TOMATO_WIDTH, TOMATO_HEIGHT, TOMATO_RGBA_B64,
  STEAK_WIDTH, STEAK_HEIGHT, STEAK_RGBA_B64,
} from "./sample-images-extra";

export type RgbaPixelValue = { r: number; g: number; b: number; a: number };
export type ImageValue = { width: number; height: number; pixels: RgbaPixelValue[] };

// Fenel type authority lives in fenel/modules/std/media-types.fenel. This
// module contains runtime samples only; it must not redeclare anonymous field
// identities for the catalog or for function signatures.

// ---------------------------------------------------------------------------
// Sample image generators
// ---------------------------------------------------------------------------

const SIZE = 16;

const RED: RgbaPixelValue = { r: 239, g: 68, b: 68, a: 255 };
const GREEN: RgbaPixelValue = { r: 16, g: 185, b: 129, a: 255 };
const WHITE: RgbaPixelValue = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: RgbaPixelValue = { r: 0, g: 0, b: 0, a: 255 };
// Gradient endpoints chosen for *luminance contrast*, not just hue
// contrast — Tailwind's blue-500 and red-500 happen to share a ~120
// luminance, which collapses to a flat gray under the standard
// 0.299·R + 0.587·G + 0.114·B grayscale formula. Pure blue (~29) →
// yellow (~226) gives a clear dark-to-light gradient when desaturated.
const NAVY: RgbaPixelValue = { r: 30, g: 41, b: 99, a: 255 };
const YELLOW: RgbaPixelValue = { r: 250, g: 204, b: 21, a: 255 };

function fill(color: RgbaPixelValue, w: number = SIZE, h: number = SIZE): ImageValue {
  const pixels: RgbaPixelValue[] = [];
  for (let i = 0; i < w * h; i++) pixels.push({ ...color });
  return { width: w, height: h, pixels };
}

function gradient(left: RgbaPixelValue, right: RgbaPixelValue, w: number = SIZE, h: number = SIZE): ImageValue {
  const pixels: RgbaPixelValue[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = w === 1 ? 0 : x / (w - 1);
      pixels.push({
        r: Math.round(left.r + (right.r - left.r) * t),
        g: Math.round(left.g + (right.g - left.g) * t),
        b: Math.round(left.b + (right.b - left.b) * t),
        a: Math.round(left.a + (right.a - left.a) * t),
      });
    }
  }
  return { width: w, height: h, pixels };
}

function checkerboard(a: RgbaPixelValue, b: RgbaPixelValue, w: number = SIZE, h: number = SIZE): ImageValue {
  const pixels: RgbaPixelValue[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onA = ((x >> 1) + (y >> 1)) % 2 === 0;
      pixels.push({ ...(onA ? a : b) });
    }
  }
  return { width: w, height: h, pixels };
}

function plus(bg: RgbaPixelValue, fg: RgbaPixelValue, w: number = SIZE, h: number = SIZE): ImageValue {
  const pixels: RgbaPixelValue[] = [];
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const arm = Math.max(2, Math.floor(Math.min(w, h) / 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onPlus = (Math.abs(x - cx) <= arm && Math.abs(y - cy) <= 0) ||
        (Math.abs(y - cy) <= arm && Math.abs(x - cx) <= 0) ||
        (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= arm) ||
        (Math.abs(y - cy) <= 1 && Math.abs(x - cx) <= arm);
      pixels.push({ ...(onPlus ? fg : bg) });
    }
  }
  return { width: w, height: h, pixels };
}

/** Decode a base64-encoded RGBA pixel buffer into our ImageValue shape.
 *  Cross-platform: uses globalThis.atob when available (browser + modern
 *  Node/Bun), falls back to Buffer for older Node. The decoded byte
 *  count must match width × height × 4. */
function decodeRgbaBase64(width: number, height: number, b64: string): ImageValue {
  const bytes = base64ToBytes(b64);
  const expected = width * height * 4;
  const pixels: RgbaPixelValue[] = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    if (j + 3 >= expected) break;
    pixels[i] = {
      r: bytes[j] ?? 0,
      g: bytes[j + 1] ?? 0,
      b: bytes[j + 2] ?? 0,
      a: bytes[j + 3] ?? 255,
    };
  }
  return { width, height, pixels };
}

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string; Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (typeof g.atob === "function") {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (g.Buffer) {
    const buf = g.Buffer.from(b64, "base64");
    return new Uint8Array(buf);
  }
  return new Uint8Array(0);
}

/** Sample images shipped with the catalog. Used by `Exemplifiable<Image>`
 *  and as input rows for the image-processing function storybooks.
 *
 *  Indexes are stable — the `imageSample(index)` std function exposes
 *  them by position, so saved expressions referencing `imageSample(N)`
 *  keep working as long as we *append* (don't reorder) entries. */
export const SAMPLE_IMAGES: ImageValue[] = [
  // Original Fenel artwork, followed by the sample pictures (origins in sample-images-extra.ts).
  decodeRgbaBase64(landscape.width, landscape.height, landscape.rgbaBase64),   // 0 landscape
  decodeRgbaBase64(EYE_WIDTH, EYE_HEIGHT, EYE_RGBA_B64),                        // 1 eye
  decodeRgbaBase64(PORTRAIT_WIDTH, PORTRAIT_HEIGHT, PORTRAIT_RGBA_B64),         // 2 portrait
  decodeRgbaBase64(BOOK_WIDTH, BOOK_HEIGHT, BOOK_RGBA_B64),                     // 3 book
  decodeRgbaBase64(FENNEL_WIDTH, FENNEL_HEIGHT, FENNEL_RGBA_B64),               // 4 fennel
  decodeRgbaBase64(TOMATO_WIDTH, TOMATO_HEIGHT, TOMATO_RGBA_B64),               // 5 tomato
  decodeRgbaBase64(STEAK_WIDTH, STEAK_HEIGHT, STEAK_RGBA_B64),                  // 6 steak
  // Synthetic — geometrically-generated inputs for clean filter tests.
  gradient(NAVY, YELLOW),                                                       // 7 gradient
  checkerboard(BLACK, WHITE),                                                   // 8 checkerboard
  plus(WHITE, GREEN),                                                           // 9 plus
  fill(RED),                                                                    // 10 red-fill
];
