// ---------------------------------------------------------------------------
// Image operations — pure pixel-matrix transforms.
//
// Every op here takes the structural Image record (width, height, pixels:
// List<RgbaPixel>) and returns a new Image. No DOM, no canvas, no async, no
// IO. Inspired by the operation taxonomies of GIMP, ImageMagick, and
// FFmpeg's video filter chain — all of those processing pipelines decompose
// into the same primitives: per-pixel maps, convolutions, geometric
// re-indexing, channel mixing, blends, and generators.
//
// The categories below mirror that decomposition, with a small shared
// helper layer (mapPixels, convolve, rgbToHsl, hslToRgb, clampByte) so the
// operations themselves are all 5–20 lines and read like equations.
// Source-over and Gaussian/box blur are approved performance mirrors of the
// complete std bodies in fenel/modules/std/native/image-native.fenel. Keep
// their pixel policy/kernel/rounding paired with those source bodies and the
// source-versus-native controls in scripts/tests/image-source.test.ts.
// ---------------------------------------------------------------------------

import type { RgbaPixelValue, ImageValue } from "./image-data";
import { SAMPLE_IMAGES } from "./image-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY: ImageValue = { width: 0, height: 0, pixels: [] };

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function asImage(v: unknown): ImageValue {
  if (!v || typeof v !== "object") return EMPTY;
  const o = v as { width?: unknown; height?: unknown; pixels?: unknown };
  if (typeof o.width !== "number" || typeof o.height !== "number" || !Array.isArray(o.pixels)) {
    return EMPTY;
  }
  return o as ImageValue;
}

function getPixel(img: ImageValue, x: number, y: number): RgbaPixelValue {
  return img.pixels[y * img.width + x] ?? { r: 0, g: 0, b: 0, a: 255 };
}

/** Per-pixel transform. The callback can read x/y coordinates so spatial
 *  effects (vignette, gradients) compose with the same plumbing. */
function mapPixels(
  img: ImageValue,
  fn: (px: RgbaPixelValue, x: number, y: number) => RgbaPixelValue,
): ImageValue {
  const w = img.width;
  const h = img.height;
  const out: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = fn(getPixel(img, x, y), x, y);
    }
  }
  return { width: w, height: h, pixels: out };
}

/** Generic 2D convolution. Edges clamp (mirror would be nicer, but clamp
 *  is the standard and avoids reflection artifacts on tiny images). */
function convolve(
  img: ImageValue,
  kernel: number[],
  kw: number,
  kh: number,
  divisor: number = 1,
  offset: number = 0,
): ImageValue {
  const w = img.width;
  const h = img.height;
  const cx = Math.floor(kw / 2);
  const cy = Math.floor(kh / 2);
  const out: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = 0; ky < kh; ky++) {
        for (let kx = 0; kx < kw; kx++) {
          const sx = Math.min(w - 1, Math.max(0, x + kx - cx));
          const sy = Math.min(h - 1, Math.max(0, y + ky - cy));
          const px = getPixel(img, sx, sy);
          const k = kernel[ky * kw + kx] ?? 0;
          r += px.r * k;
          g += px.g * k;
          b += px.b * k;
        }
      }
      const a = getPixel(img, x, y).a;
      out[y * w + x] = {
        r: clampByte(r / divisor + offset),
        g: clampByte(g / divisor + offset),
        b: clampByte(b / divisor + offset),
        a,
      };
    }
  }
  return { width: w, height: h, pixels: out };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
    else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
    else h = ((r1 - g1) / d + 4) / 6;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  ];
}

function luminance(p: RgbaPixelValue): number {
  return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

// ---------------------------------------------------------------------------
// Color & tone
// ---------------------------------------------------------------------------

export function imgGrayscale(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => {
    const y = clampByte(luminance(p));
    return { r: y, g: y, b: y, a: p.a };
  });
}

export function imgInvert(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({
    r: 255 - p.r,
    g: 255 - p.g,
    b: 255 - p.b,
    a: p.a,
  }));
}

export function imgBrightness(v: unknown, delta: unknown): ImageValue {
  const d = Number(delta);
  return mapPixels(asImage(v), (p) => ({
    r: clampByte(p.r + d),
    g: clampByte(p.g + d),
    b: clampByte(p.b + d),
    a: p.a,
  }));
}

export function imgContrast(v: unknown, factor: unknown): ImageValue {
  const f = Number(factor);
  return mapPixels(asImage(v), (p) => ({
    r: clampByte((p.r - 128) * f + 128),
    g: clampByte((p.g - 128) * f + 128),
    b: clampByte((p.b - 128) * f + 128),
    a: p.a,
  }));
}

export function imgSaturate(v: unknown, factor: unknown): ImageValue {
  const f = Number(factor);
  return mapPixels(asImage(v), (p) => {
    const [h, s, l] = rgbToHsl(p.r, p.g, p.b);
    const ns = Math.max(0, Math.min(1, s * f));
    const [r, g, b] = hslToRgb(h, ns, l);
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: p.a };
  });
}

export function imgHueRotate(v: unknown, degrees: unknown): ImageValue {
  const shift = ((Number(degrees) % 360) + 360) % 360 / 360;
  return mapPixels(asImage(v), (p) => {
    const [h, s, l] = rgbToHsl(p.r, p.g, p.b);
    let nh = (h + shift) % 1;
    if (nh < 0) nh += 1;
    const [r, g, b] = hslToRgb(nh, s, l);
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: p.a };
  });
}

export function imgSepia(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({
    r: clampByte(p.r * 0.393 + p.g * 0.769 + p.b * 0.189),
    g: clampByte(p.r * 0.349 + p.g * 0.686 + p.b * 0.168),
    b: clampByte(p.r * 0.272 + p.g * 0.534 + p.b * 0.131),
    a: p.a,
  }));
}

export function imgThreshold(v: unknown, level: unknown): ImageValue {
  const t = Number(level);
  return mapPixels(asImage(v), (p) => {
    const w = luminance(p) >= t ? 255 : 0;
    return { r: w, g: w, b: w, a: p.a };
  });
}

export function imgPosterize(v: unknown, levels: unknown): ImageValue {
  const n = Math.max(2, Math.floor(Number(levels)));
  const step = 255 / (n - 1);
  return mapPixels(asImage(v), (p) => ({
    r: clampByte(Math.round(p.r / step) * step),
    g: clampByte(Math.round(p.g / step) * step),
    b: clampByte(Math.round(p.b / step) * step),
    a: p.a,
  }));
}

export function imgGamma(v: unknown, gamma: unknown): ImageValue {
  const inv = 1 / Math.max(0.001, Number(gamma));
  return mapPixels(asImage(v), (p) => ({
    r: clampByte(255 * Math.pow(p.r / 255, inv)),
    g: clampByte(255 * Math.pow(p.g / 255, inv)),
    b: clampByte(255 * Math.pow(p.b / 255, inv)),
    a: p.a,
  }));
}

export function imgOpacity(v: unknown, alpha: unknown): ImageValue {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return mapPixels(asImage(v), (p) => ({
    r: p.r,
    g: p.g,
    b: p.b,
    a: clampByte(p.a * a),
  }));
}

// ---------------------------------------------------------------------------
// Geometric
// ---------------------------------------------------------------------------

export function imgCrop(
  v: unknown,
  x: unknown,
  y: unknown,
  w: unknown,
  h: unknown,
): ImageValue {
  const img = asImage(v);
  const x0 = Math.max(0, Math.floor(Number(x)));
  const y0 = Math.max(0, Math.floor(Number(y)));
  const w1 = Math.min(img.width - x0, Math.max(0, Math.floor(Number(w))));
  const h1 = Math.min(img.height - y0, Math.max(0, Math.floor(Number(h))));
  if (w1 === 0 || h1 === 0) return EMPTY;
  const pixels: RgbaPixelValue[] = new Array(w1 * h1);
  for (let yy = 0; yy < h1; yy++) {
    for (let xx = 0; xx < w1; xx++) {
      pixels[yy * w1 + xx] = { ...getPixel(img, x0 + xx, y0 + yy) };
    }
  }
  return { width: w1, height: h1, pixels };
}

export function imgResize(v: unknown, w: unknown, h: unknown): ImageValue {
  const img = asImage(v);
  const nw = Math.max(1, Math.floor(Number(w)));
  const nh = Math.max(1, Math.floor(Number(h)));
  if (img.width === 0 || img.height === 0) return EMPTY;
  const pixels: RgbaPixelValue[] = new Array(nw * nh);
  for (let yy = 0; yy < nh; yy++) {
    for (let xx = 0; xx < nw; xx++) {
      // Bilinear sample
      const fx = (xx + 0.5) * (img.width / nw) - 0.5;
      const fy = (yy + 0.5) * (img.height / nh) - 0.5;
      const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const y1 = Math.min(img.height - 1, y0 + 1);
      const dx = Math.max(0, Math.min(1, fx - x0));
      const dy = Math.max(0, Math.min(1, fy - y0));
      const p00 = getPixel(img, x0, y0);
      const p10 = getPixel(img, x1, y0);
      const p01 = getPixel(img, x0, y1);
      const p11 = getPixel(img, x1, y1);
      const blend = (a: number, b: number, c: number, d: number) =>
        a * (1 - dx) * (1 - dy) +
        b * dx * (1 - dy) +
        c * (1 - dx) * dy +
        d * dx * dy;
      pixels[yy * nw + xx] = {
        r: clampByte(blend(p00.r, p10.r, p01.r, p11.r)),
        g: clampByte(blend(p00.g, p10.g, p01.g, p11.g)),
        b: clampByte(blend(p00.b, p10.b, p01.b, p11.b)),
        a: clampByte(blend(p00.a, p10.a, p01.a, p11.a)),
      };
    }
  }
  return { width: nw, height: nh, pixels };
}

export function imgFlipHorizontal(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels[y * w + x] = { ...getPixel(img, w - 1 - x, y) };
    }
  }
  return { width: w, height: h, pixels };
}

export function imgFlipVertical(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels[y * w + x] = { ...getPixel(img, x, h - 1 - y) };
    }
  }
  return { width: w, height: h, pixels };
}

export function imgRotate90(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = h - 1 - y;
      const ny = x;
      pixels[ny * h + nx] = { ...getPixel(img, x, y) };
    }
  }
  return { width: h, height: w, pixels };
}

export function imgRotate180(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const src = img.pixels[w * h - 1 - i];
    pixels[i] = src ? { ...src } : { r: 0, g: 0, b: 0, a: 0 };
  }
  return { width: w, height: h, pixels };
}

export function imgRotate270(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = y;
      const ny = w - 1 - x;
      pixels[ny * h + nx] = { ...getPixel(img, x, y) };
    }
  }
  return { width: h, height: w, pixels };
}

export function imgTranspose(v: unknown): ImageValue {
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels[x * h + y] = { ...getPixel(img, x, y) };
    }
  }
  return { width: h, height: w, pixels };
}

// ---------------------------------------------------------------------------
// Filters & convolution
// ---------------------------------------------------------------------------

export function imgPixelate(v: unknown, factor: unknown): ImageValue {
  const img = asImage(v);
  const f = Math.max(1, Math.floor(Number(factor)));
  if (f === 1) return img;
  const w = img.width;
  const h = img.height;
  const out: RgbaPixelValue[] = new Array(w * h);
  for (let by = 0; by < h; by += f) {
    for (let bx = 0; bx < w; bx += f) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = by; y < Math.min(by + f, h); y++) {
        for (let x = bx; x < Math.min(bx + f, w); x++) {
          const p = getPixel(img, x, y);
          r += p.r;
          g += p.g;
          b += p.b;
          a += p.a;
          n++;
        }
      }
      if (n === 0) continue;
      const avg: RgbaPixelValue = {
        r: clampByte(r / n),
        g: clampByte(g / n),
        b: clampByte(b / n),
        a: clampByte(a / n),
      };
      for (let y = by; y < Math.min(by + f, h); y++) {
        for (let x = bx; x < Math.min(bx + f, w); x++) {
          out[y * w + x] = { ...avg };
        }
      }
    }
  }
  return { width: w, height: h, pixels: out };
}

export function imgBoxBlur(v: unknown, radius: unknown): ImageValue {
  const img = asImage(v);
  if (Number(radius) === 0) return img;
  const r = Math.max(1, Math.floor(Number(radius)));
  const size = 2 * r + 1;
  const kernel = new Array(size * size).fill(1);
  return convolve(img, kernel, size, size, kernel.length, 0);
}

export function imgGaussianBlur(v: unknown, radius: unknown): ImageValue {
  const img = asImage(v);
  if (Number(radius) === 0) return img;
  const r = Math.max(1, Math.floor(Number(radius)));
  const size = 2 * r + 1;
  const sigma = Math.max(0.5, r / 2);
  const kernel: number[] = new Array(size * size);
  let sum = 0;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const k = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      kernel[(y + r) * size + (x + r)] = k;
      sum += k;
    }
  }
  return convolve(img, kernel, size, size, sum, 0);
}

export function imgSharpen(v: unknown): ImageValue {
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  return convolve(asImage(v), k, 3, 3, 1, 0);
}

export function imgEmboss(v: unknown): ImageValue {
  const k = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
  return convolve(asImage(v), k, 3, 3, 1, 128);
}

export function imgEdgeDetect(v: unknown): ImageValue {
  // Sobel — runs on the grayscale projection, returns a magnitude image.
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const gray = imgGrayscale(img);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const out: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0;
      let sy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.min(w - 1, Math.max(0, x + kx));
          const ny = Math.min(h - 1, Math.max(0, y + ky));
          const px = getPixel(gray, nx, ny).r;
          sx += px * gx[(ky + 1) * 3 + (kx + 1)]!;
          sy += px * gy[(ky + 1) * 3 + (kx + 1)]!;
        }
      }
      const m = clampByte(Math.sqrt(sx * sx + sy * sy));
      out[y * w + x] = { r: m, g: m, b: m, a: 255 };
    }
  }
  return { width: w, height: h, pixels: out };
}

export function imgMedian(v: unknown, radius: unknown): ImageValue {
  const img = asImage(v);
  const r = Math.max(1, Math.floor(Number(radius)));
  const w = img.width;
  const h = img.height;
  const out: RgbaPixelValue[] = new Array(w * h);
  const size = (2 * r + 1) * (2 * r + 1);
  const reds = new Array<number>(size);
  const greens = new Array<number>(size);
  const blues = new Array<number>(size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.min(w - 1, Math.max(0, x + dx));
          const ny = Math.min(h - 1, Math.max(0, y + dy));
          const p = getPixel(img, nx, ny);
          reds[n] = p.r;
          greens[n] = p.g;
          blues[n] = p.b;
          n++;
        }
      }
      const slice = (a: number[]) => a.slice(0, n).sort((p, q) => p - q);
      const mid = Math.floor(n / 2);
      const a = getPixel(img, x, y).a;
      out[y * w + x] = {
        r: slice(reds)[mid] ?? 0,
        g: slice(greens)[mid] ?? 0,
        b: slice(blues)[mid] ?? 0,
        a,
      };
    }
  }
  return { width: w, height: h, pixels: out };
}

// ---------------------------------------------------------------------------
// Channel ops
// ---------------------------------------------------------------------------

export function imgRedChannel(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({ r: p.r, g: 0, b: 0, a: p.a }));
}

export function imgGreenChannel(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({ r: 0, g: p.g, b: 0, a: p.a }));
}

export function imgBlueChannel(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({ r: 0, g: 0, b: p.b, a: p.a }));
}

export function imgSwapRedBlue(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({ r: p.b, g: p.g, b: p.r, a: p.a }));
}

export function imgSwapRedGreen(v: unknown): ImageValue {
  return mapPixels(asImage(v), (p) => ({ r: p.g, g: p.r, b: p.b, a: p.a }));
}

// ---------------------------------------------------------------------------
// Compositing — two-image blends. Output dims = the second (background) image.
// ---------------------------------------------------------------------------

/** Approved performance mirror of std:imageSourceOverPixel. Its byte-coverage
 * numerator stays unrounded until RGB has been unassociated, matching source.
 * Picture and Image use this one pixel routine rather than separate formulas. */
export function imgSourceOverPixel(top: RgbaPixelValue, bottom: RgbaPixelValue): RgbaPixelValue {
  const topAlpha = clampByte(top.a);
  const bottomAlpha = clampByte(bottom.a);
  const retained = bottomAlpha * (255 - topAlpha);
  const coverage = topAlpha * 255 + retained;
  if (coverage === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: clampByte((clampByte(top.r) * topAlpha * 255 + clampByte(bottom.r) * retained) / coverage),
    g: clampByte((clampByte(top.g) * topAlpha * 255 + clampByte(bottom.g) * retained) / coverage),
    b: clampByte((clampByte(top.b) * topAlpha * 255 + clampByte(bottom.b) * retained) / coverage),
    a: clampByte(coverage / 255),
  };
}

export function imgOverlay(top: unknown, bottom: unknown): ImageValue {
  const t = asImage(top);
  const b = asImage(bottom);
  const w = b.width;
  const h = b.height;
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bp = getPixel(b, x, y);
      if (x >= t.width || y >= t.height) {
        pixels[y * w + x] = { ...bp };
        continue;
      }
      const tp = getPixel(t, x, y);
      pixels[y * w + x] = imgSourceOverPixel(tp, bp);
    }
  }
  return { width: w, height: h, pixels };
}

export function imgMultiply(a: unknown, b: unknown): ImageValue {
  const ia = asImage(a);
  const ib = asImage(b);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = getPixel(ia, x, y);
      const pb = getPixel(ib, x, y);
      pixels[y * w + x] = {
        r: clampByte((pa.r * pb.r) / 255),
        g: clampByte((pa.g * pb.g) / 255),
        b: clampByte((pa.b * pb.b) / 255),
        a: pa.a,
      };
    }
  }
  return { width: w, height: h, pixels };
}

export function imgScreen(a: unknown, b: unknown): ImageValue {
  const ia = asImage(a);
  const ib = asImage(b);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = getPixel(ia, x, y);
      const pb = getPixel(ib, x, y);
      pixels[y * w + x] = {
        r: clampByte(255 - ((255 - pa.r) * (255 - pb.r)) / 255),
        g: clampByte(255 - ((255 - pa.g) * (255 - pb.g)) / 255),
        b: clampByte(255 - ((255 - pa.b) * (255 - pb.b)) / 255),
        a: pa.a,
      };
    }
  }
  return { width: w, height: h, pixels };
}

export function imgDifference(a: unknown, b: unknown): ImageValue {
  const ia = asImage(a);
  const ib = asImage(b);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = getPixel(ia, x, y);
      const pb = getPixel(ib, x, y);
      pixels[y * w + x] = {
        r: Math.abs(pa.r - pb.r),
        g: Math.abs(pa.g - pb.g),
        b: Math.abs(pa.b - pb.b),
        a: pa.a,
      };
    }
  }
  return { width: w, height: h, pixels };
}

// ---------------------------------------------------------------------------
// Generative — produce a fresh image from parameters, no input image.
// ---------------------------------------------------------------------------

export function imgSolid(
  width: unknown,
  height: unknown,
  r: unknown,
  g: unknown,
  b: unknown,
  a: unknown,
): ImageValue {
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  const px: RgbaPixelValue = {
    r: clampByte(Number(r)),
    g: clampByte(Number(g)),
    b: clampByte(Number(b)),
    a: clampByte(Number(a)),
  };
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) pixels[i] = { ...px };
  return { width: w, height: h, pixels };
}

export function imgGradient(
  width: unknown,
  height: unknown,
  r1: unknown,
  g1: unknown,
  b1: unknown,
  r2: unknown,
  g2: unknown,
  b2: unknown,
): ImageValue {
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  const a1 = { r: Number(r1), g: Number(g1), b: Number(b1) };
  const a2 = { r: Number(r2), g: Number(g2), b: Number(b2) };
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = w === 1 ? 0 : x / (w - 1);
      pixels[y * w + x] = {
        r: clampByte(a1.r + (a2.r - a1.r) * t),
        g: clampByte(a1.g + (a2.g - a1.g) * t),
        b: clampByte(a1.b + (a2.b - a1.b) * t),
        a: 255,
      };
    }
  }
  return { width: w, height: h, pixels };
}

export function imgNoise(width: unknown, height: unknown, seed: unknown): ImageValue {
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  // Mulberry32 — deterministic given the seed.
  let state = (Number(seed) | 0) >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(rng() * 256);
    pixels[i] = { r: v, g: v, b: v, a: 255 };
  }
  return { width: w, height: h, pixels };
}

export function imgCheckerboard(
  width: unknown,
  height: unknown,
  tile: unknown,
): ImageValue {
  const w = Math.max(1, Math.floor(Number(width)));
  const h = Math.max(1, Math.floor(Number(height)));
  const t = Math.max(1, Math.floor(Number(tile)));
  const A: RgbaPixelValue = { r: 0, g: 0, b: 0, a: 255 };
  const B: RgbaPixelValue = { r: 255, g: 255, b: 255, a: 255 };
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels[y * w + x] = ((Math.floor(x / t) + Math.floor(y / t)) % 2 === 0)
        ? { ...A }
        : { ...B };
    }
  }
  return { width: w, height: h, pixels };
}

// ---------------------------------------------------------------------------
// Artistic
// ---------------------------------------------------------------------------

export function imgVignette(v: unknown, strength: unknown): ImageValue {
  const img = asImage(v);
  const cx = img.width / 2;
  const cy = img.height / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  const s = Math.max(0, Math.min(1, Number(strength)));
  return mapPixels(img, (p, x, y) => {
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    const factor = 1 - s * (d / maxD);
    return {
      r: clampByte(p.r * factor),
      g: clampByte(p.g * factor),
      b: clampByte(p.b * factor),
      a: p.a,
    };
  });
}

export function imgDither(v: unknown): ImageValue {
  // Floyd-Steinberg error diffusion to monochrome.
  const img = asImage(v);
  const w = img.width;
  const h = img.height;
  const buf: number[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    buf[i] = luminance(img.pixels[i] ?? { r: 0, g: 0, b: 0, a: 255 });
  }
  const pixels: RgbaPixelValue[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i] ?? 0;
      const out = old < 128 ? 0 : 255;
      pixels[i] = { r: out, g: out, b: out, a: 255 };
      const err = old - out;
      if (x + 1 < w) buf[i + 1] = (buf[i + 1] ?? 0) + (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] = (buf[i + w - 1] ?? 0) + (err * 3) / 16;
        buf[i + w] = (buf[i + w] ?? 0) + (err * 5) / 16;
        if (x + 1 < w) buf[i + w + 1] = (buf[i + w + 1] ?? 0) + (err * 1) / 16;
      }
    }
  }
  return { width: w, height: h, pixels };
}

export function imgQuantize(v: unknown, levelsPerChannel: unknown): ImageValue {
  // Like posterize but keeps each channel's bit-depth distinct from the
  // rest. Useful for retro looks where you want different levels for R/G/B.
  return imgPosterize(v, levelsPerChannel);
}

// ---------------------------------------------------------------------------
// Sample lookup — exposes the bundled SAMPLE_IMAGES by index, so saved
// expressions don't have to embed pixel literals. `imageSample(0)` is the
// original Fenel landscape, `imageSample(1)` is the eye, etc.
// ---------------------------------------------------------------------------

export function imgSample(index: unknown): ImageValue {
  if (SAMPLE_IMAGES.length === 0) return EMPTY;
  let i = Math.floor(Number(index));
  if (!Number.isFinite(i)) i = 0;
  if (i < 0) i = 0;
  if (i >= SAMPLE_IMAGES.length) i = SAMPLE_IMAGES.length - 1;
  return SAMPLE_IMAGES[i] ?? EMPTY;
}
