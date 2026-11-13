// ---------------------------------------------------------------------------
// Seed expressions for /dashboard/values — the demo gallery.
//
// Each entry is a creative composition pulling on the image-processing
// library. Sample images are referenced by index via `imageSample(N)`
// (instead of embedding pixel literals) so the saved JSON stays small
// and self-documenting.
//
// Index map (stable):
//   0 landscape · 1 eye · 2 portrait · 3 book · 4 fennel
//   5 tomato · 6 steak · 7 gradient · 8 checker · 9 plus · 10 red-fill
//
// On first visit to /dashboard/values the page seeds these as
// savedQueries with kind="expression". Idempotent — never re-seeds.
// ---------------------------------------------------------------------------

import { toLogic, type ExprNode } from "./index";
import { For } from "solid-js";

const lit = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `std:${fnId}`, args });
const img = (n: number): ExprNode => call("imageSample", lit(n));

// Helpers for the media modules (fnId prefix differs per module).
const callPic = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `picture:${name}`, args });
const callSnd = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `sound:${name}`, args });
const callAnim = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `animation:${name}`, args });
const callMov = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `movie:${name}`, args });
const callTrk = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `track:${name}`, args });
const callEvt = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `events:${name}`, args });
const callGame = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `games:${name}`, args });
const callXm = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `crossmodal:${name}`, args });
const callPth = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId: `path:${name}`, args });

// Color literals as record-shaped values. The picture functions accept
// these directly because the engine's evaluator treats multi-key plain
// objects as data (not ops). Stable reference to keep diffs small.
const COLOR_RED = lit({ r: 239, g: 68, b: 68, a: 255 });
const COLOR_BLUE = lit({ r: 59, g: 130, b: 246, a: 255 });
const COLOR_GREEN = lit({ r: 16, g: 185, b: 129, a: 255 });
const COLOR_AMBER = lit({ r: 251, g: 191, b: 36, a: 255 });

/** A list literal: pre-converts each item to JSON Logic shape so the
 *  evaluator iterates and evaluates each at runtime. ExprNode has no
 *  list constructor, so the result is `{kind: "literal", value: [...]}`
 *  with the value already in evaluator-ready form. */
const list = (...items: ExprNode[]): ExprNode => ({
  kind: "literal",
  value: items.map((it) => toLogic(it)),
});

// JSON-Logic primitive helpers (used inside closure bodies for Field /
// Animate / MovieAt constructors). `$var`, `$call`, etc. produce raw
// JSON-Logic op shapes which the engine evaluates at runtime.
const $var = (path: string) => ({ var: path });
const px = $var("p.x");
const py = $var("p.y");
const ts = $var("t.seconds");
const TWO_PI = 6.283185307179586;
const $call = (name: string, ...args: unknown[]) => ({ call: [name, ...args] });
const $add = (...args: unknown[]) => ({ call: ["add", ...args] });
const $sub = (a: unknown, b: unknown) => ({ "-": [a, b] });
const $mul = (...args: unknown[]) => ({ "*": args });
const $div = (a: unknown, b: unknown) => ({ "/": [a, b] });
const $if = (cond: unknown, t: unknown, f: unknown) => ({ if: [cond, t, f] });
const $lt = (a: unknown, b: unknown) => ({ "<": [a, b] });
const $lte = (a: unknown, b: unknown) => ({ "<=": [a, b] });
const $gt = (a: unknown, b: unknown) => ({ ">": [a, b] });
const $gte = (a: unknown, b: unknown) => ({ ">=": [a, b] });

// Color literal helper: r/g/b/a are JSON-Logic numbers (literals or expressions).
const $color = (r: unknown, g: unknown, b: unknown, a: unknown = 255) =>
  $call("color", r, g, b, a);

/** Construct a Field-shaped Picture from a closure body that uses `p`
 *  (a Point with `.x` and `.y`). The body is a raw JSON-Logic expression
 *  built with the helpers above. */
const field = (body: unknown): ExprNode => ({
  kind: "literal",
  value: { construct: ["Field", { fn: [["p"], body] }] },
});

/** Construct an Animate-shaped Animation from a closure body that uses
 *  `t` (a Time with `.seconds`). At each frame the closure produces a
 *  Picture — motion as a function of time. */
const animate = (body: unknown): ExprNode => ({
  kind: "literal",
  value: { construct: ["Animate", { fn: [["t"], body] }] },
});

/** Construct a MovieAt-shaped Movie from a closure body that uses `t`.
 *  At each instant the closure produces a Scene — visual + audio derived
 *  from one time function. */
const movieAt = (body: unknown): ExprNode => ({
  kind: "literal",
  value: { construct: ["MovieAt", { fn: [["t"], body] }] },
});

/** Plot the math function `y = buildY(x)` as a Picture. The Field's
 *  closure maps pixel coordinates to math coordinates over [xMin, xMax]
 *  × [yMin, yMax], computes the curve's pixel y at each x, and lights
 *  pixels within ~1.5 of the curve. Axes (x=0, y=0 lines) are drawn in
 *  a darker grey when they fall inside the visible range. The math
 *  expression `buildY(mathX)` is plain JSON-Logic — use $mul, $sin etc.
 *  helpers above. The variable `mathX` is the JSON-Logic stand-in for
 *  the input x at the current pixel column. */
function plot(
  buildY: (mathX: unknown) => unknown,
  opts: {
    xMin?: number; xMax?: number;
    yMin?: number; yMax?: number;
    w?: number; h?: number;
  } = {},
): ExprNode {
  const xMin = opts.xMin ?? -2 * Math.PI;
  const xMax = opts.xMax ?? 2 * Math.PI;
  const yMin = opts.yMin ?? -2;
  const yMax = opts.yMax ?? 2;
  const w = opts.w ?? 96;
  const h = opts.h ?? 96;
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;

  // Pre-compute axis pixel positions where math x = 0 / math y = 0.
  // Out-of-range axes simply land off-canvas and never get drawn.
  const axisXpixel = ((0 - xMin) / xRange) * w;
  const axisYpixel = h - ((0 - yMin) / yRange) * h;

  const lineColor = { r: 34, g: 211, b: 238, a: 255 };  // cyan
  const bgColor = { r: 15, g: 23, b: 42, a: 255 };      // dark slate
  const axisColor = { r: 71, g: 85, b: 105, a: 255 };   // mid slate

  // mathX = xMin + (p.x / w) * xRange — bound once via `where`.
  const mathXBinding = $add(xMin, $mul($div(px, w), xRange));
  const mathXVar = $var("mathX");
  const yVal = buildY(mathXVar);
  // curveY pixel: flip y axis so math up = visual up.
  const curveY = $sub(h, $mul($div($sub(yVal, yMin), yRange), h));

  const body = {
    where: [
      $if(
        $lt($call("abs", $sub(py, axisYpixel)), 0.5),
        axisColor,
        $if(
          $lt($call("abs", $sub(px, axisXpixel)), 0.5),
          axisColor,
          $if(
            $lt($call("abs", $sub(py, curveY)), 1.5),
            lineColor,
            bgColor,
          ),
        ),
      ),
      { mathX: mathXBinding },
    ],
  };

  return field(body);
}

const $sin = (x: unknown) => $call("sin", x);
const $cos = (x: unknown) => $call("cos", x);
const $tan = (x: unknown) => $call("tan", x);
const $exp = (x: unknown) => $call("exp", x);
const $log = (x: unknown) => $call("log", x);
const $sqrt = (x: unknown) => $call("sqrt", x);
const $abs = (x: unknown) => $call("abs", x);
const $floor = (x: unknown) => $call("floor", x);
const $pow = (b: unknown, e: unknown) => $call("pow", b, e);
const $mod = (a: unknown, b: unknown) => $call("mod", a, b);
const $and = (...args: unknown[]) => ({ and: args });
const $or = (...args: unknown[]) => ({ or: args });

/** Wrap an Image expression as a Raster-tagged Picture so it can be
 *  composed with other Pictures via `over`, `clip`, etc. The image
 *  expression is evaluated at runtime via the `construct` op. */
const rasterPic = (imgExpr: ExprNode): ExprNode => ({
  kind: "literal",
  value: { construct: ["Raster", toLogic(imgExpr)] },
});

type ChartOpts = {
  xMin?: number; xMax?: number;
  yMin?: number; yMax?: number;
  w?: number; h?: number;
  lineColor?: { r: number; g: number; b: number; a: number };
  bgColor?: { r: number; g: number; b: number; a: number };
  axisColor?: { r: number; g: number; b: number; a: number };
};

function chartFrame(opts: ChartOpts) {
  const xMin = opts.xMin ?? -2 * Math.PI;
  const xMax = opts.xMax ?? 2 * Math.PI;
  const yMin = opts.yMin ?? -2;
  const yMax = opts.yMax ?? 2;
  const w = opts.w ?? 96;
  const h = opts.h ?? 96;
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const axisXpixel = ((0 - xMin) / xRange) * w;
  const axisYpixel = h - ((0 - yMin) / yRange) * h;
  const lineColor = opts.lineColor ?? { r: 34, g: 211, b: 238, a: 255 };
  const bgColor = opts.bgColor ?? { r: 15, g: 23, b: 42, a: 255 };
  const axisColor = opts.axisColor ?? { r: 71, g: 85, b: 105, a: 255 };
  const mathXBinding = $add(xMin, $mul($div(px, w), xRange));
  return {
    xMin, xMax, yMin, yMax, w, h, xRange, yRange,
    axisXpixel, axisYpixel,
    lineColor, bgColor, axisColor,
    mathXBinding,
    mathXVar: $var("mathX"),
  };
}

/** Plot a function with a filled area below (or above) the curve. The
 *  fill colour can vary with py — a vertical gradient — so the area
 *  has a visible shading. */
function plotArea(
  buildY: (mathX: unknown) => unknown,
  side: "below" | "above",
  opts: ChartOpts & {
    fillColor?: (py: unknown) => unknown;
  } = {},
): ExprNode {
  const f = chartFrame(opts);
  const yVal = buildY(f.mathXVar);
  const curveY = $sub(f.h, $mul($div($sub(yVal, f.yMin), f.yRange), f.h));
  const fillColor = opts.fillColor ?? ((pyExpr) =>
    $color(
      $mul(255, $div($sub(f.h, pyExpr), f.h)),
      $mul(80, $div(pyExpr, f.h)),
      $mul(220, $div($sub(f.h, pyExpr), f.h)),
      200,
    )
  );
  const sideTest = side === "below"
    ? $gte(py, curveY)   // below curve in pixel space (larger py = lower visually)
    : $lte(py, curveY);
  const body = {
    where: [
      $if(
        $lt($call("abs", $sub(py, f.axisYpixel)), 0.5),
        f.axisColor,
        $if(
          $lt($call("abs", $sub(px, f.axisXpixel)), 0.5),
          f.axisColor,
          $if(
            $lt($call("abs", $sub(py, curveY)), 1.5),
            f.lineColor,
            $if(sideTest, fillColor(py), f.bgColor),
          ),
        ),
      ),
      { mathX: f.mathXBinding },
    ],
  };
  return field(body);
}

/** Plot a function with a thicker stroke. `thickness` is the half-width
 *  of the stroke in pixels — `thickness=3` produces a ~6-pixel-wide line. */
function plotThick(
  buildY: (mathX: unknown) => unknown,
  thickness: number,
  opts: ChartOpts = {},
): ExprNode {
  const f = chartFrame(opts);
  const yVal = buildY(f.mathXVar);
  const curveY = $sub(f.h, $mul($div($sub(yVal, f.yMin), f.yRange), f.h));
  const body = {
    where: [
      $if(
        $lt($call("abs", $sub(py, f.axisYpixel)), 0.5),
        f.axisColor,
        $if(
          $lt($call("abs", $sub(px, f.axisXpixel)), 0.5),
          f.axisColor,
          $if(
            $lt($call("abs", $sub(py, curveY)), thickness),
            f.lineColor,
            f.bgColor,
          ),
        ),
      ),
      { mathX: f.mathXBinding },
    ],
  };
  return field(body);
}

/** Dashed line: line is lit only where (pixel x) mod (2 · dashLen) <
 *  dashLen, producing on/off segments along x. */
function plotDashed(
  buildY: (mathX: unknown) => unknown,
  dashLen: number,
  opts: ChartOpts = {},
): ExprNode {
  const f = chartFrame(opts);
  const yVal = buildY(f.mathXVar);
  const curveY = $sub(f.h, $mul($div($sub(yVal, f.yMin), f.yRange), f.h));
  // Lit when (px mod (2*dashLen)) < dashLen
  const dashOn = $lt($mod(px, 2 * dashLen), dashLen);
  const body = {
    where: [
      $if(
        $lt($call("abs", $sub(py, f.axisYpixel)), 0.5),
        f.axisColor,
        $if(
          $lt($call("abs", $sub(px, f.axisXpixel)), 0.5),
          f.axisColor,
          $if(
            $and(dashOn, $lt($call("abs", $sub(py, curveY)), 1.5)),
            f.lineColor,
            f.bgColor,
          ),
        ),
      ),
      { mathX: f.mathXBinding },
    ],
  };
  return field(body);
}

/** Plot the curve plus marker dots at each math x in `markerXs`. Each
 *  marker is a small filled circle of radius 2.5 pixels centered on the
 *  curve at that x. */
function plotMarkers(
  buildY: (mathX: unknown) => unknown,
  markerXs: number[],
  opts: ChartOpts & { markerColor?: { r: number; g: number; b: number; a: number } } = {},
): ExprNode {
  const f = chartFrame(opts);
  const yVal = buildY(f.mathXVar);
  const curveY = $sub(f.h, $mul($div($sub(yVal, f.yMin), f.yRange), f.h));
  const mc = opts.markerColor ?? { r: 251, g: 191, b: 36, a: 255 };
  // Compute marker pixel positions at TS-time.
  // To know curveY at marker x we need to evaluate the function — but
  // buildY is JSON-Logic, not callable here. Workaround: only the px
  // position is known; the marker hit test uses (curveY) at the
  // marker's column too. Approximate: marker is a vertical disk on the
  // curve at the column. The fill condition: |px - markerCol| ≤ 2.5
  // AND |py - curveY(at this px)| ≤ 2.5.
  const markerCols = markerXs.map(
    (mx) => Math.round(((mx - f.xMin) / f.xRange) * f.w),
  );
  // Build "px is near any marker column" via OR.
  const nearMarker = $or(
    ...markerCols.map((c) =>
      $lt($call("abs", $sub(px, c)), 2.5),
    ),
  );
  const body = {
    where: [
      $if(
        $and(
          nearMarker,
          $lt($call("abs", $sub(py, curveY)), 2.5),
        ),
        mc,
        $if(
          $lt($call("abs", $sub(py, f.axisYpixel)), 0.5),
          f.axisColor,
          $if(
            $lt($call("abs", $sub(px, f.axisXpixel)), 0.5),
            f.axisColor,
            $if(
              $lt($call("abs", $sub(py, curveY)), 1.5),
              f.lineColor,
              f.bgColor,
            ),
          ),
        ),
      ),
      { mathX: f.mathXBinding },
    ],
  };
  return field(body);
}

/** Build a small filled-triangle Field at (cx, cy) pointing in direction
 *  (dx, dy) (normalised). Used to overlay arrow markers along a curve. */
function arrowField(
  cx: number, cy: number,
  dx: number, dy: number,
  size: number,
  color: { r: number; g: number; b: number; a: number },
): ExprNode {
  // Normalise (dx, dy).
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Tip is `size` along (ux, uy); base is `size/2` perpendicular.
  const tipX = cx + size * ux;
  const tipY = cy + size * uy;
  const perpX = -uy;
  const perpY = ux;
  const base1X = cx - (size / 2) * ux + (size / 2) * perpX;
  const base1Y = cy - (size / 2) * uy + (size / 2) * perpY;
  const base2X = cx - (size / 2) * ux - (size / 2) * perpX;
  const base2Y = cy - (size / 2) * uy - (size / 2) * perpY;
  // Cross-product sign tests for "p inside triangle".
  const cross = (ax: number, ay: number, bx: number, by: number) =>
    $sub(
      $mul(bx - ax, $sub(py, ay)),
      $mul(by - ay, $sub(px, ax)),
    );
  const s1 = cross(base1X, base1Y, tipX, tipY);
  const s2 = cross(tipX, tipY, base2X, base2Y);
  const s3 = cross(base2X, base2Y, base1X, base1Y);
  // Inside if all three cross products share a sign.
  return field({
    if: [
      $or(
        $and($gte(s1, 0), $gte(s2, 0), $gte(s3, 0)),
        $and($lte(s1, 0), $lte(s2, 0), $lte(s3, 0)),
      ),
      color,
      { r: 0, g: 0, b: 0, a: 0 },
    ],
  });
}

/** Fold a list of Pictures into a single Picture by chaining `over` from
 *  right to left: top of stack goes first. */
function picsOver(layers: ExprNode[]): ExprNode {
  if (layers.length === 0) {
    // Empty stack — fall back to a transparent solid.
    return callPic("solid", lit({ r: 0, g: 0, b: 0, a: 0 }));
  }
  return layers.reduce((bot, top) => callPic("over", top, bot));
}

export type SeedValue = {
  name: string;
  previousName?: string;
  description: string;
  expr: ExprNode;
};

export const SEED_VALUES: SeedValue[] = [
  // -------------------------------------------------------------------
  // Single-step warm-ups
  // -------------------------------------------------------------------
  {
    name: "Eye · grayscale",
    description: "Standard luminance conversion of the iris closeup.",
    expr: call("imageGrayscale", img(1)),
  },
  {
    name: "Steak · sepia",
    description: "Old-photograph tint applied to a fresh ribeye.",
    expr: call("imageSepia", img(6)),
  },
  {
    name: "Book · invert",
    description: "Color inversion on the book cover — flesh becomes sky.",
    expr: call("imageInvert", img(3)),
  },
  {
    name: "Portrait · mirror",
    description: "Horizontal flip.",
    expr: call("imageFlipHorizontal", img(2)),
  },
  {
    name: "Tomato · rotate 90°",
    previousName: "Aged meat · rotate 90°",
    description: "Quarter turn clockwise.",
    expr: call("imageRotate90", img(5)),
  },

  // -------------------------------------------------------------------
  // Two-step combinations
  // -------------------------------------------------------------------
  {
    name: "Eye · psychedelic",
    description: "Hue-rotated 180° and oversaturated — alien iris.",
    expr: call("imageSaturate", call("imageHueRotate", img(1), lit(180)), lit(2)),
  },
  {
    name: "Fennel · woodcut",
    previousName: "Newsletter · woodcut",
    description: "Edge detection followed by Floyd-Steinberg dither — high-contrast print.",
    expr: call("imageDither", call("imageEdgeDetect", img(4))),
  },
  {
    name: "Steak · moody",
    description: "Gamma push for richer mids, gentle vignette around the plate.",
    expr: call("imageVignette", call("imageGamma", img(6), lit(1.4)), lit(0.5)),
  },
  {
    name: "Jojo · retro",
    description: "Composed function — grayscale → pixelate(4). Watch both intermediate stages in the trace.",
    expr: call("imageRetro", img(0), lit(4)),
  },
  {
    name: "Tomato · ghost",
    previousName: "Aged meat · ghost",
    description: "Inverted then rotated 180° — a cyan tomato hanging upside down.",
    expr: call("imageRotate180", call("imageInvert", img(5))),
  },

  // -------------------------------------------------------------------
  // Channel mixology
  // -------------------------------------------------------------------
  {
    name: "Eye · red iris",
    description: "Keep only the red channel — bloodshot.",
    expr: call("imageRedChannel", img(1)),
  },
  {
    name: "Steak · BGR swap",
    description: "Swap red ↔ blue. Meat as ocean creature.",
    expr: call("imageSwapRedBlue", img(6)),
  },
  {
    name: "Eye · channel collage",
    description: "Red channel composited with blue channel — split spectrum.",
    expr: call("imageOverlay", call("imageRedChannel", img(1)), call("imageBlueChannel", img(1))),
  },
  {
    name: "Portrait · poison swap",
    description: "Swap red and green — cyanotic skin.",
    expr: call("imageSwapRedGreen", img(2)),
  },

  // -------------------------------------------------------------------
  // Filter pipelines
  // -------------------------------------------------------------------
  {
    name: "Book · dreamy",
    description: "Gaussian blur + heavy vignette. Romance novel cover.",
    expr: call("imageVignette", call("imageGaussianBlur", img(3), lit(2)), lit(0.7)),
  },
  {
    name: "Eye · high-pass",
    description: "Subtract a blurred copy from the original — accentuates fine detail.",
    expr: call("imageDifference", img(1), call("imageGaussianBlur", img(1), lit(3))),
  },
  {
    name: "Steak · vivid butcher",
    description: "Brightness boost, contrast crank, sharpen — supermarket flyer.",
    expr: call("imageSharpen", call("imageContrast", call("imageBrightness", img(6), lit(30)), lit(1.5))),
  },
  {
    name: "Tomato · soft relief",
    previousName: "Aged meat · soft relief",
    description: "Pre-blur then emboss — bas-relief sculpture.",
    expr: call("imageEmboss", call("imageGaussianBlur", img(5), lit(2))),
  },
  {
    name: "Eye · denoise + posterize",
    description: "Median filter to clean up, then quantize to 4 levels — illustrated look.",
    expr: call("imagePosterize", call("imageMedian", img(1), lit(1)), lit(4)),
  },

  // -------------------------------------------------------------------
  // Geometric play
  // -------------------------------------------------------------------
  {
    name: "Book · diagonal flip",
    description: "Vertical flip then transpose — main-anti-diagonal mirror.",
    expr: call("imageTranspose", call("imageFlipVertical", img(3))),
  },
  {
    name: "Jojo · rotational symmetry",
    description: "90° rotation alpha-composited over the original.",
    expr: call("imageOverlay",
      call("imageOpacity", call("imageRotate90", img(0)), lit(0.5)),
      img(0),
    ),
  },
  {
    name: "Portrait · cropped detail",
    description: "Centered 32×32 crop, then bilinear upscale to 96×96.",
    expr: call("imageResize",
      call("imageCrop", img(2), lit(32), lit(20), lit(48), lit(48)),
      lit(96), lit(96),
    ),
  },

  // -------------------------------------------------------------------
  // Generative + photo
  // -------------------------------------------------------------------
  {
    name: "Portrait · TV static",
    description: "Screen-blend mono noise over the portrait — analog reception.",
    expr: call("imageScreen", call("imageNoise", lit(96), lit(116), lit(7)), img(2)),
  },
  {
    name: "Fennel · film grain",
    previousName: "Newsletter · film grain",
    description: "Faint mono noise overlay on a soft-blurred fennel bulb.",
    expr: call("imageOverlay",
      call("imageOpacity", call("imageNoise", lit(96), lit(136), lit(13)), lit(0.18)),
      call("imageGaussianBlur", img(4), lit(2)),
    ),
  },
  {
    name: "Jojo · checkered",
    description: "Faint checkerboard alpha-laid over the source.",
    expr: call("imageOverlay",
      call("imageOpacity", call("imageCheckerboard", lit(96), lit(56), lit(8)), lit(0.35)),
      img(0),
    ),
  },
  {
    name: "Fennel · horizontal vignette",
    previousName: "Newsletter · horizontal vignette",
    description: "Multiply with a black→white horizontal gradient — fades from dark to bright.",
    expr: call("imageMultiply",
      call("imageGradient", lit(96), lit(136), lit(0), lit(0), lit(0), lit(255), lit(255), lit(255)),
      img(4),
    ),
  },

  // -------------------------------------------------------------------
  // Wild compositions
  // -------------------------------------------------------------------
  {
    name: "Eye · triple hue blend",
    description: "Multiply with a 90°-rotated copy, screen with a 180°-rotated copy. Stained-glass eye.",
    expr: call("imageScreen",
      call("imageMultiply", img(1), call("imageHueRotate", img(1), lit(90))),
      call("imageHueRotate", img(1), lit(180)),
    ),
  },
  {
    name: "Book · luminous",
    description: "Screen-blend the inverted cover over the original — embossed self-illumination.",
    expr: call("imageScreen", call("imageInvert", img(3)), img(3)),
  },
  {
    name: "Steak · pop art",
    description: "Hue-rotate, oversaturate, posterize to 4 levels — Warhol diptych energy.",
    expr: call("imagePosterize",
      call("imageSaturate", call("imageHueRotate", img(6), lit(90)), lit(2)),
      lit(4),
    ),
  },
  {
    name: "Portrait · cinemagic",
    description: "Posterize, sepia, vignette — looks like a poster from 1972.",
    expr: call("imageVignette", call("imageSepia", call("imagePosterize", img(2), lit(5))), lit(0.6)),
  },
  {
    name: "Eye · over-detail",
    description: "Edge map alpha-blended over a slightly-blurred eye — every wrinkle exposed.",
    expr: call("imageOverlay",
      call("imageOpacity", call("imageEdgeDetect", img(1)), lit(0.55)),
      call("imageGaussianBlur", img(1), lit(1)),
    ),
  },
  {
    name: "Jojo · glitch",
    description: "Red channel of a 180°-rotated copy laid over the blue channel of the original.",
    expr: call("imageOverlay",
      call("imageOpacity",
        call("imageRedChannel", call("imageRotate180", img(0))),
        lit(0.55),
      ),
      call("imageBlueChannel", img(0)),
    ),
  },
  {
    name: "Tomato · cinemagraph",
    previousName: "Aged meat · cinemagraph",
    description: "Posterize, sepia, then a strong vignette. Smithsonian display case.",
    expr: call("imageVignette",
      call("imageSepia", call("imagePosterize", img(5), lit(5))),
      lit(0.7),
    ),
  },
  {
    name: "Fennel · newspaper print",
    previousName: "Newsletter · newspaper print",
    description: "Contrast crank then Floyd-Steinberg dither — black-and-white newsprint.",
    expr: call("imageDither", call("imageContrast", img(4), lit(1.4))),
  },
  {
    name: "Eye · woodcut",
    description: "Gaussian blur to soften noise, edge detect to find lines, dither to monochrome.",
    expr: call("imageDither",
      call("imageEdgeDetect", call("imageGaussianBlur", img(1), lit(1))),
    ),
  },
  {
    name: "Book · cyanotype",
    description: "Grayscale then hue-rotate the result toward blue, finally vignette. Old photo print.",
    expr: call("imageVignette",
      call("imageHueRotate", call("imageGrayscale", img(3)), lit(220)),
      lit(0.4),
    ),
  },
  {
    name: "Steak · cross-process",
    description: "Saturation x1.6, blue-channel boost via swap, posterize to 6 levels. Lomo film.",
    expr: call("imagePosterize",
      call("imageSwapRedBlue", call("imageSaturate", img(6), lit(1.6))),
      lit(6),
    ),
  },

  // ===================================================================
  // STRING SHOWCASE
  //
  // Each example pulls on a different facet of the string library —
  // case transforms, splitters, padding, slugs, formatters, mosaics.
  // Designed to read top-to-bottom from "warm-ups" to "wild" so a
  // visitor scrolling sees the toolbox expand naturally.
  // ===================================================================

  // --- Single-step warm-ups ---
  {
    name: "Uppercase",
    previousName: "String · uppercase",
    description: "Standard uppercase transform.",
    expr: call("upper", lit("hello world")),
  },
  {
    name: "Trim",
    previousName: "String · trim",
    description: "Strip leading/trailing whitespace.",
    expr: call("trim", lit("    breathing room    ")),
  },
  {
    name: "Reverse",
    previousName: "String · reverse",
    description: "Reverse by Unicode code point — emoji stay intact.",
    expr: call("join", call("reverse", call("chars", lit("Fenel 🦊"))), lit("")),
  },
  {
    name: "Repeat",
    previousName: "String · repeat",
    description: "Repeat a substring N times.",
    expr: call("repeat", lit("ha"), lit(7)),
  },
  {
    name: "Slugify",
    previousName: "String · slugify",
    description: "URL-safe slug — accents stripped, non-alphanum collapsed to hyphens.",
    expr: call("slugify", lit("  Étoile  du nord — Volume One!  ")),
  },

  // --- Case transforms ---
  {
    name: "TitleCase",
    previousName: "String · titleCase",
    description: "Title case a sentence.",
    expr: call("titleCase", lit("the quick brown fox jumps over the lazy dog")),
  },
  {
    name: "CamelCase from spaces",
    previousName: "String · camelCase from spaces",
    description: "Space-separated words → camelCase identifier.",
    expr: call("camelCase", lit("my favourite function name")),
  },
  {
    name: "Kebab from camelCase",
    previousName: "String · kebab from camelCase",
    description: "camelCase → kebab-case.",
    expr: call("kebabCase", lit("getUserProfileById")),
  },
  {
    name: "Snake from Title Case",
    previousName: "String · snake from Title Case",
    description: "Title Case → snake_case.",
    expr: call("snakeCase", lit("My Variable Name")),
  },
  {
    name: "Case round-trip",
    previousName: "String · case round-trip",
    description: "kebab → camel → snake — three case transforms in series.",
    expr: call("snakeCase", call("camelCase", call("kebabCase", lit("Fenel Standard Library Showcase")))),
  },

  // --- Cleanup pipelines ---
  {
    name: "Normalize",
    previousName: "String · normalize",
    description: "trim + lower — common cleanup before comparison.",
    expr: call("lower", call("trim", lit("   HELLO WORLD   "))),
  },
  {
    name: "De-shout",
    previousName: "String · de-shout",
    description: "Take a SHOUTING string, lowercase it, then sentence-case.",
    expr: call("capitalize", call("lower", lit("STOP YELLING AT ME"))),
  },
  {
    name: "Pirate filter",
    previousName: "String · pirate filter",
    description: "Chained replaceAll: e→3, o→0, l→1 — leetspeak.",
    expr: call("replaceAll",
      call("replaceAll",
        call("replaceAll", lit("hello world"), lit("e"), lit("3")),
        lit("o"), lit("0")),
      lit("l"), lit("1")),
  },
  {
    name: "Censor",
    previousName: "String · censor",
    description: "Replace a profanity placeholder with asterisks.",
    expr: call("replaceAll", lit("This is a darn problem and a darn shame"), lit("darn"), lit("****")),
  },
  {
    name: "Path normalize",
    previousName: "String · path normalize",
    description: "Collapse `\\\\` Windows separators to `/` and lowercase the result.",
    expr: call("lower", call("replaceAll", lit("Users\\\\Admin\\\\Documents\\\\Files"), lit("\\\\"), lit("/"))),
  },

  // --- Padding & banners ---
  {
    name: "Zero-padded id",
    previousName: "String · zero-padded id",
    description: "Pad a numeric string to 6 digits with leading zeros.",
    expr: call("padStart", lit("42"), lit(6), lit("0")),
  },
  {
    name: "Centered banner",
    previousName: "String · centered banner",
    description: "Pad both ends so the title sits in a 40-char dashed banner.",
    expr: call("padEnd",
      call("padStart", lit(" Fenel "), lit(24), lit("=")),
      lit(40), lit("=")),
  },
  {
    name: "Marquee",
    previousName: "String · marquee",
    description: "Build a 60-char ASCII frame around a phrase.",
    expr: call("concat",
      call("concat",
        call("repeat", lit("─"), lit(20)),
        lit(" hello, fenel ")),
      call("repeat", lit("─"), lit(20))),
  },

  // --- Splitting & indexing ---
  {
    name: "Word count",
    previousName: "String · word count",
    description: "Count words by splitting on whitespace then taking the length.",
    expr: call("length", call("words", lit("the quick brown fox jumps"))),
  },
  {
    name: "Line count",
    previousName: "String · line count",
    description: "Count lines in a multi-line string.",
    expr: call("length", call("lines", lit("alpha\nbeta\ngamma\ndelta"))),
  },
  {
    name: "Char count",
    previousName: "String · char count",
    description: "Count Unicode characters (handles emoji correctly).",
    expr: call("length", call("chars", lit("Hello 🦊 world"))),
  },
  {
    name: "Email domain",
    previousName: "String · email domain",
    description: "split('@')[1] — extract the domain from an email.",
    expr: call("at", call("split", lit("rom@usefenel.com"), lit("@")), lit(1)),
  },
  {
    name: "Email user",
    previousName: "String · email user",
    description: "split('@')[0] — extract the local part.",
    expr: call("at", call("split", lit("rom@usefenel.com"), lit("@")), lit(0)),
  },
  {
    name: "Url path",
    previousName: "String · url path",
    description: "Pull the second segment from a URL path.",
    expr: call("at", call("split", lit("https://usefenel.com/dashboard/values"), lit("/")), lit(4)),
  },
  {
    name: "File extension",
    previousName: "String · file extension",
    description: "split('.')[-1] — last segment after the final dot.",
    expr: call("at", call("split", lit("archive.tar.gz"), lit(".")), lit(-1)),
  },

  // --- Truncation & formatting ---
  {
    name: "Ellipsize",
    previousName: "String · ellipsize",
    description: "Slice the first 24 chars then append a `…`.",
    expr: call("concat", call("slice", lit("Long descriptive title for a card"), lit(0), lit(24)), lit("…")),
  },
  {
    name: "Username badge",
    previousName: "String · username badge",
    description: "Format `@` + lowercased trimmed name.",
    expr: call("concat", lit("@"), call("lower", call("trim", lit("  RomLeclercq  ")))),
  },
  {
    name: "Greet",
    previousName: "String · greet",
    description: "Hello, + capitalised first name.",
    expr: call("concat", lit("Hello, "), call("capitalize", call("lower", lit("ROMAIN")))),
  },
  {
    name: "Masked email",
    previousName: "String · masked email",
    description: "Replace user part with `***`, keep domain.",
    expr: call("concat",
      lit("***@"),
      call("at", call("split", lit("rom@usefenel.com"), lit("@")), lit(1))),
  },

  // --- Wild compositions ---
  {
    name: "Headline → slug",
    previousName: "String · headline → slug",
    description: "Real-world: turn a headline into a URL slug then wrap in /blog/…",
    expr: call("concat",
      lit("/blog/"),
      call("slugify", lit("Why I Replaced 50 Lines of CSS with 5 Lines of Fenel"))),
  },
  {
    name: "ID generator",
    previousName: "String · ID generator",
    description: "kebab the title, prepend 'id-', uppercase the result, pad-end with zeros.",
    expr: call("padEnd",
      call("upper",
        call("concat", lit("id-"), call("kebabCase", lit("My New Type")))),
      lit(20), lit("0")),
  },
  {
    name: "Word-by-word title",
    previousName: "String · word-by-word title",
    description: "split → titleCase each piece → join with hyphen.",
    expr: call("titleCase", call("replaceAll", lit("welcome to fenel"), lit(" "), lit("-"))),
  },
  {
    name: "Path → display name",
    previousName: "String · path → display name",
    description: "Take the last `/`-segment, replace `_` with spaces, title-case.",
    expr: call("titleCase",
      call("replaceAll",
        call("at", call("split", lit("/types/entity_type/email_template"), lit("/")), lit(-1)),
        lit("_"), lit(" "))),
  },
  {
    name: "Domain word list",
    previousName: "String · domain word list",
    description: "Take a domain, split on '.', title-case each part.",
    expr: call("titleCase", call("replaceAll", lit("blog.usefenel.com"), lit("."), lit(" "))),
  },
  {
    name: "Scream slug",
    previousName: "String · scream slug",
    description: "Slugify, then UPPERCASE, then pad with `*` on both sides.",
    expr: call("padEnd",
      call("padStart",
        call("upper", call("slugify", lit("Important: Read This!"))),
        lit(35), lit("*")),
      lit(50), lit("*")),
  },
  {
    name: "Reversed shouting",
    previousName: "String · reversed shouting",
    description: "Reverse, upper, then exclamation mark — dramatic.",
    expr: call("join", lit({ __list: [
      call("upper", call("join", call("reverse", call("chars", lit("Fenel"))), lit(""))),
      lit("!!!"),
    ] }), lit("")),
  },
  {
    name: "Snake → spoken",
    previousName: "String · snake → spoken",
    description: "Replace underscores with spaces, then title case. snake_case → 'Snake Case'.",
    expr: call("titleCase", call("replaceAll", lit("hello_world_from_fenel"), lit("_"), lit(" "))),
  },
  {
    name: "Prefix with count",
    previousName: "String · prefix with count",
    description: "Word count + ' words: ' + the trimmed text.",
    expr: call("concat",
      call("concat",
        call("toString", call("length", call("words", lit("the quick brown fox jumps over the lazy dog")))),
        lit(" words: ")),
      lit("the quick brown fox jumps over the lazy dog")),
  },
  {
    name: "CSV-ish format",
    previousName: "String · CSV-ish format",
    description: "Wrap each word with quotes by joining around them.",
    expr: call("concat",
      call("concat", lit("\""),
        call("join", call("words", lit("alpha beta gamma delta")), lit("\", \""))),
      lit("\"")),
  },

  // ===================================================================
  // NUMBER & LIST SHOWCASE — quick demos for the other types
  // ===================================================================

  {
    name: "Age",
    previousName: "Number · age",
    description: "Subtract birth year from current year.",
    expr: call("sub", lit(2026), lit(1990)),
  },
  {
    name: "Clamp",
    previousName: "Number · clamp",
    description: "Clamp a value into [0, 100]. Demo of three-arg call.",
    expr: call("clamp", lit(150), lit(0), lit(100)),
  },
  {
    name: "Compound interest",
    previousName: "Number · compound interest",
    description: "Principal · (1 + r)^n. 1000·1.05^10 ≈ 1628.89.",
    expr: call("mul", call("pow", lit(1.05), lit(10)), lit(1000)),
  },
  {
    name: "Pythagorean",
    previousName: "Number · pythagorean",
    description: "√(3² + 4²) = 5.",
    expr: call("sqrt", call("add", call("pow", lit(3), lit(2)), call("pow", lit(4), lit(2)))),
  },
  {
    name: "Floor of mean",
    previousName: "Number · floor of mean",
    description: "Floor the average of two numbers.",
    expr: call("floor", call("div", call("add", lit(7), lit(2)), lit(2))),
  },

  {
    name: "Sum of repeated",
    previousName: "List · sum of repeated",
    description: "Build a list by repeating, then sum its lengths.",
    expr: call("length", call("words", call("repeat", lit("a b c "), lit(5)))),
  },
  {
    name: "Unique words",
    previousName: "List · unique words",
    description: "Get unique words from a phrase.",
    expr: call("unique", call("words", lit("to be or not to be that is the question"))),
  },
  {
    name: "Sorted words",
    previousName: "List · sorted words",
    description: "Sort words alphabetically.",
    expr: call("sort", call("words", lit("delta alpha gamma beta"))),
  },
  {
    name: "Reversed words",
    previousName: "List · reversed words",
    description: "Reverse the word order of a sentence (then re-join).",
    expr: call("join", call("reverse", call("words", lit("the quick brown fox"))), lit(" ")),
  },
  // --- Data instead of files (the public demo of that name, Nov 12) ---
  // Small existing std calls; the demo shows each beside other kinds of data.
  {
    name: "An iris",
    description: "The iris photograph from the sample pictures.",
    // Typed Anything until imageSample's declared parameter matches its native
    // (pending FENEL-BATCH-4: `index: Nat` -> `index: Number`); numberToNat is
    // no way out: it builds a Peano Nat that the native reads as 0 (the landscape).
    expr: img(1),
  },
  {
    name: "Double 21",
    description: "A number computed by a function: double 21.",
    expr: call("double", lit(21)),
  },
  {
    name: "A sentence",
    description: "A text.",
    // A call, like every other member: the demo stays a section of things to open.
    // join is the text one (concat is generic and does not check as a String).
    expr: call("join", lit({ __list: [lit("Anything is data, "), lit("including code.")] }), lit("")),
  },
  {
    name: "Sorted then reversed",
    description: "Three numbers, sorted, then reversed. Open it to see the steps as a graph and as code.",
    expr: call("reverse", call("sortAscending", lit({ __list: [lit(3), lit(1), lit(2)] }))),
  },
  {
    name: "Count distinct chars",
    previousName: "List · count distinct chars",
    description: "Count how many distinct characters a phrase contains.",
    expr: call("length", call("unique", call("chars", lit("mississippi")))),
  },

  // ===================================================================
  // PICTURE / VECTOR GRAPHICS — Picture is Raster | Field. Generators
  // (circle, rectangle, gradient) build Field-shaped Pictures whose math
  // is the function body. `render` rasterises to a 16×16 (or larger)
  // Image that the storybook canvas paints.
  // ===================================================================

  {
    name: "Solid red",
    previousName: "Picture · solid red",
    description: "Constant-color Picture rendered to a 16×16 image. The simplest possible Field.",
    expr: callPic("render", callPic("solid", COLOR_RED), lit(16), lit(16)),
  },
  {
    name: "Centred circle",
    previousName: "Picture · centred circle",
    description: "Red circle radius 5 at (8, 8), rendered at 16×16. The math: Field(\\p -> if dist p c <= r then col else transparent).",
    expr: callPic(
      "render",
      callPic("circle", callPic("point", lit(8), lit(8)), lit(5), COLOR_RED),
      lit(16),
      lit(16),
    ),
  },
  {
    name: "Circle on blue",
    previousName: "Picture · circle on blue",
    description: "Composition: red circle layered over a solid blue background using `over`.",
    expr: callPic(
      "render",
      callPic("over",
        callPic("circle", callPic("point", lit(10), lit(10)), lit(4), COLOR_RED),
        callPic("solid", COLOR_BLUE),
      ),
      lit(20), lit(20),
    ),
  },

  // -----------------------------------------------------------------------
  // Math-driven raster Pictures — Field is a function (Point → RgbaPixel), so any
  // mathematical formula over `p.x` / `p.y` becomes a Picture. These seeds
  // build the Field's closure directly so the math IS the Picture's
  // definition. Render rasterises by sampling at every integer pixel.
  // -----------------------------------------------------------------------

  {
    name: "Sinusoidal stripes",
    previousName: "Picture · sinusoidal stripes",
    description: "Vertical bands: red where sin(0.5·x) > 0, blue otherwise. The math: \\p -> if sin(0.5·p.x) > 0 then red else blue.",
    expr: callPic("render",
      field($if($gt($call("sin", $mul(0.5, px)), 0), { r: 239, g: 68, b: 68, a: 255 }, { r: 59, g: 130, b: 246, a: 255 })),
      lit(32), lit(32),
    ),
  },
  {
    name: "Diagonal gradient",
    previousName: "Picture · diagonal gradient",
    description: "Pure math: r = 8·x, g = 8·y, b = 4·(x+y). Color emerges from coordinates — no shape primitives.",
    expr: callPic("render",
      field($color($mul(8, px), $mul(8, py), $mul(4, $add(px, py)))),
      lit(32), lit(32),
    ),
  },
  {
    name: "Checkerboard",
    previousName: "Picture · checkerboard",
    description: "Classic interference pattern: floor(x/4) + floor(y/4) mod 2 picks alternating colors.",
    expr: callPic("render",
      field($if(
        $lt($call("mod", $add($call("floor", $div(px, 4)), $call("floor", $div(py, 4))), 2), 1),
        { r: 17, g: 24, b: 39, a: 255 },  // near-black
        { r: 248, g: 250, b: 252, a: 255 }, // near-white
      )),
      lit(32), lit(32),
    ),
  },
  {
    name: "Radial sine rings",
    previousName: "Picture · radial sine rings",
    description: "Concentric rings from sin(distance·1.2). The whole image emerges from one math expression — no nested shapes, just radial math.",
    expr: callPic("render",
      field((() => {
        // d = sqrt((x-16)^2 + (y-16)^2)
        const dx = $sub(px, 16);
        const dy = $sub(py, 16);
        const d = $call("sqrt", $add($mul(dx, dx), $mul(dy, dy)));
        // intensity = (sin(d * 1.2) + 1) * 127  — maps [-1, 1] → [0, 255]
        const intensity = $mul($add($call("sin", $mul(d, 1.2)), 1), 127);
        return $color(intensity, $mul(0.3, intensity), $mul(0.6, intensity));
      })()),
      lit(32), lit(32),
    ),
  },
  {
    name: "Radial gradient",
    previousName: "Picture · radial gradient",
    description: "Color smoothly interpolated by distance: closer to center = brighter red. \\p -> color(255 · max(0, 1 - d/16), 0, 0, 255).",
    expr: callPic("render",
      field((() => {
        const dx = $sub(px, 16);
        const dy = $sub(py, 16);
        const d = $call("sqrt", $add($mul(dx, dx), $mul(dy, dy)));
        // intensity = 255 * max(0, 1 - d/16)
        const fade = $call("max", 0, $sub(1, $div(d, 16)));
        return $color($mul(255, fade), 0, 0);
      })()),
      lit(32), lit(32),
    ),
  },
  {
    name: "Interference (sine grid)",
    previousName: "Picture · interference (sine grid)",
    description: "Two sines crossed: sin(x·0.5) · sin(y·0.5). Where both peak the result is bright; where they cancel it goes dark.",
    expr: callPic("render",
      field((() => {
        const a = $call("sin", $mul(0.5, px));
        const b = $call("sin", $mul(0.5, py));
        const intensity = $mul($add($mul(a, b), 1), 127); // [-1,1] → [0,255]
        return $color(intensity, intensity, $mul(0.5, intensity));
      })()),
      lit(32), lit(32),
    ),
  },
  {
    name: "Diagonal stripes (modulo)",
    previousName: "Picture · diagonal stripes (modulo)",
    description: "(floor(x+y) mod 6 < 3) selects color A, else B. Generates ~45° stripes.",
    expr: callPic("render",
      field($if(
        $lt($call("mod", $call("floor", $add(px, py)), 6), 3),
        { r: 16, g: 185, b: 129, a: 255 },
        { r: 251, g: 191, b: 36, a: 255 },
      )),
      lit(32), lit(32),
    ),
  },
  {
    name: "Concentric circles",
    previousName: "Picture · concentric circles",
    description: "if floor(d) mod 4 < 2 then ink else paper. Pure ring pattern from distance.",
    expr: callPic("render",
      field((() => {
        const dx = $sub(px, 16);
        const dy = $sub(py, 16);
        const d = $call("sqrt", $add($mul(dx, dx), $mul(dy, dy)));
        return $if(
          $lt($call("mod", $call("floor", d), 4), 2),
          { r: 17, g: 24, b: 39, a: 255 },
          { r: 248, g: 250, b: 252, a: 255 },
        );
      })()),
      lit(32), lit(32),
    ),
  },
  {
    name: "Color from angle",
    previousName: "Picture · color from angle",
    description: "Hue varies with the angle from center: r·cos·θ, g·sin·θ, plus radial fade. atan2(y, x) gives the angle.",
    expr: callPic("render",
      field((() => {
        const dx = $sub(px, 16);
        const dy = $sub(py, 16);
        // No atan2 in std; approximate with cos(dy/dx)? Cleaner: just use dx and dy directly modulated.
        const d = $call("sqrt", $add($mul(dx, dx), $mul(dy, dy)));
        const fade = $call("max", 0, $sub(1, $div(d, 18)));
        // Use sin/cos of angle approximated by dx, dy normalised by d
        const r = $mul($add($mul($div(dx, $call("max", d, 1)), 127), 128), fade);
        const g = $mul($add($mul($div(dy, $call("max", d, 1)), 127), 128), fade);
        return $color(r, g, $mul(255, fade));
      })()),
      lit(32), lit(32),
    ),
  },
  {
    name: "Circle composed over math gradient",
    previousName: "Picture · circle composed over math gradient",
    description: "A red circle from `circle()` overlaid on a Field that fades cyan→magenta diagonally. Mixes high-level shape with low-level math.",
    expr: callPic("render",
      callPic("over",
        callPic("circle", callPic("point", lit(16), lit(16)), lit(7), COLOR_AMBER),
        field($color($mul(8, px), $mul(4, $add(px, py)), $mul(8, py))),
      ),
      lit(32), lit(32),
    ),
  },

  // -----------------------------------------------------------------------
  // FUNCTION PLOTS — y = f(x) charts. Each Picture is a Field whose body
  // maps pixel coords to math coords, evaluates f at the current column's
  // math x, and lights pixels close to the curve. Axes (x=0, y=0) drawn
  // in a darker grey where they fall in range.
  // -----------------------------------------------------------------------

  {
    name: "Y = x  (linear)",
    previousName: "Plot · y = x  (linear)",
    description: "The simplest function: y = x. Diagonal line from bottom-left to top-right.",
    expr: callPic("render",
      plot((x) => x, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = x²  (parabola)",
    previousName: "Plot · y = x²  (parabola)",
    description: "A parabola, rising symmetrically from the origin. y = x²",
    expr: callPic("render",
      plot((x) => $mul(x, x), { xMin: -5, xMax: 5, yMin: -2, yMax: 25 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = x³  (cubic)",
    previousName: "Plot · y = x³  (cubic)",
    description: "Cubic — rising through the origin with an inflection point. y = x³",
    expr: callPic("render",
      plot((x) => $mul(x, $mul(x, x)), { xMin: -3, xMax: 3, yMin: -27, yMax: 27 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = sin(x)",
    previousName: "Plot · y = sin(x)",
    description: "The canonical wave. Period 2π. y = sin(x)",
    expr: callPic("render",
      plot((x) => $sin(x), { xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = sin(x) + cos(2x)  (interference)",
    previousName: "Plot · y = sin(x) + cos(2x)  (interference)",
    description: "Sum of two sinusoids at different frequencies — the result has a richer shape than either alone.",
    expr: callPic("render",
      plot((x) => $add($sin(x), $cos($mul(2, x))), {
        xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -2.2, yMax: 2.2,
      }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = e^(-x²/2)  (Gaussian)",
    previousName: "Plot · y = e^(-x²/2)  (Gaussian)",
    description: "Bell curve. Peaks at x=0 with y=1, falls off symmetrically. y = exp(-x²/2)",
    expr: callPic("render",
      plot(
        (x) => $exp($mul(-0.5, $mul(x, x))),
        { xMin: -3, xMax: 3, yMin: -0.1, yMax: 1.2 },
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = sin(x) / x  (sinc)",
    previousName: "Plot · y = sin(x) / x  (sinc)",
    description: "Sinc function. Limit at x=0 is 1; oscillates with decaying amplitude. Tiny gap at x=0 (NaN from 0/0).",
    expr: callPic("render",
      plot(
        (x) => $div($sin(x), x),
        { xMin: -3 * Math.PI, xMax: 3 * Math.PI, yMin: -0.4, yMax: 1.2 },
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = sin(x²)  (chirp)",
    previousName: "Plot · y = sin(x²)  (chirp)",
    description: "Sine of x squared — frequency increases with x. Visually accelerating wave.",
    expr: callPic("render",
      plot(
        (x) => $sin($mul(x, x)),
        { xMin: 0, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3 },
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = |sin(x)|  (rectified)",
    previousName: "Plot · y = |sin(x)|  (rectified)",
    description: "Absolute value of sine — positive humps only. Common in signal processing.",
    expr: callPic("render",
      plot(
        (x) => $abs($sin(x)),
        { xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -0.1, yMax: 1.2 },
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = sqrt(x)  (square root)",
    previousName: "Plot · y = sqrt(x)  (square root)",
    description: "Square root — defined for x ≥ 0. Slow growth, characteristic shape. Negative x produces NaN and the curve simply doesn't draw there.",
    expr: callPic("render",
      plot((x) => $sqrt(x), { xMin: -1, xMax: 16, yMin: -0.5, yMax: 4.5 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = log(x)  (natural log)",
    previousName: "Plot · y = log(x)  (natural log)",
    description: "Natural logarithm. Defined for x > 0; rises slowly, crosses 0 at x=1.",
    expr: callPic("render",
      plot((x) => $log(x), { xMin: 0.05, xMax: 10, yMin: -3.5, yMax: 2.5 }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Y = floor(x)  (step function)",
    previousName: "Plot · y = floor(x)  (step function)",
    description: "Floor — discontinuous step function. Not a continuous curve, but each row of the chart shows the constant value across an integer interval.",
    expr: callPic("render",
      plot((x) => $floor(x), { xMin: -5, xMax: 5, yMin: -5.5, yMax: 5.5 }),
      lit(96), lit(96),
    ),
  },

  // -----------------------------------------------------------------------
  // CHART VARIATIONS — fills, thick strokes, dashes, markers, arrows along
  // the curve. Each is built directly as a Field whose body extends the
  // basic plot with extra math (gradient under the curve, dash test on x,
  // marker disks at chosen x positions, etc.).
  // -----------------------------------------------------------------------

  {
    name: "Sin(x) with gradient area below",
    previousName: "Plot · sin(x) with gradient area below",
    description: "Like a stock chart: area under the curve filled with a vertical gradient (cyan at top fading to dark). Above the curve is the dark background.",
    expr: callPic("render",
      plotArea((x) => $sin(x), "below", {
        xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3,
      }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Parabola with stripes above",
    previousName: "Plot · parabola with stripes above",
    description: "Above the parabola y=x², horizontal stripes alternate (every 4 pixels). Below is plain background. Demonstrates pattern-fill.",
    expr: callPic("render",
      plotArea((x) => $mul(x, x), "above", {
        xMin: -5, xMax: 5, yMin: -2, yMax: 25,
        fillColor: (pyExpr) => $if(
          $lt($mod($floor(pyExpr), 8), 4),
          { r: 251, g: 191, b: 36, a: 255 },  // amber stripe
          { r: 245, g: 158, b: 11, a: 255 },  // darker amber stripe
        ),
      }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Cos(x) thick stroke",
    previousName: "Plot · cos(x) thick stroke",
    description: "y = cos(x) drawn at thickness 3 (≈6-pixel-wide line). Useful when the chart is small and a thin line is hard to read.",
    expr: callPic("render",
      plotThick((x) => $cos(x), 3, {
        xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3,
      }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Sin(x) dashed",
    previousName: "Plot · sin(x) dashed",
    description: "y = sin(x) drawn as a dashed line — 4 pixels on, 4 pixels off, repeating along x.",
    expr: callPic("render",
      plotDashed((x) => $sin(x), 4, {
        xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3,
      }),
      lit(96), lit(96),
    ),
  },
  {
    name: "Sin(x) with markers at integer multiples of π/2",
    previousName: "Plot · sin(x) with markers at integer multiples of π/2",
    description: "Curve plus amber circular markers at x = -2π, -3π/2, -π, -π/2, 0, π/2, π, 3π/2, 2π. Useful for highlighting key sample points.",
    expr: callPic("render",
      plotMarkers((x) => $sin(x),
        Array.from({ length: 9 }, (_, i) => -2 * Math.PI + i * (Math.PI / 2)),
        { xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -1.3, yMax: 1.3 },
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Sin(x) with arrows along the curve",
    previousName: "Plot · sin(x) with arrows along the curve",
    description: "Arrow markers placed at x = -π, -π/2, 0, π/2, π, each rotated to match the local tangent direction (slope = cos(x)). Visualises 'where the curve is going' at each sample.",
    expr: callPic("render",
      // Build the curve plus 5 arrow overlays. Arrow at math x has tangent
      // slope cos(x); direction vector (1, slope) in math coords. Convert
      // to pixel coords by accounting for the y-axis flip and scale.
      (() => {
        const xMin = -2 * Math.PI, xMax = 2 * Math.PI;
        const yMin = -1.3, yMax = 1.3;
        const w = 96, h = 96;
        const xRange = xMax - xMin, yRange = yMax - yMin;
        const xs = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI];
        const arrows: ExprNode[] = xs.map((mx) => {
          const my = Math.sin(mx);
          const slope = Math.cos(mx); // tangent slope
          // Direction in pixel coords: (Δpx/Δmx, Δpy/Δmx)
          // Δpx/Δmx = w/xRange; Δpy/Δmx = -slope · h / yRange (flip y).
          const dx = w / xRange;
          const dy = -slope * (h / yRange);
          const cx = ((mx - xMin) / xRange) * w;
          const cy = h - ((my - yMin) / yRange) * h;
          return arrowField(cx, cy, dx, dy, 6, { r: 251, g: 191, b: 36, a: 255 });
        });
        return picsOver([
          plot((x) => $sin(x), { xMin, xMax, yMin, yMax, w, h }),
          ...arrows,
        ]);
      })(),
      lit(96), lit(96),
    ),
  },
  {
    name: "Parabola with arrows pointing up the slope",
    previousName: "Plot · parabola with arrows pointing up the slope",
    description: "y = x². Arrows at x = -2, -1, 0, 1, 2 each rotated to the tangent direction (slope = 2x). At x=0 the tangent is horizontal; further out the arrows tilt steeper.",
    expr: callPic("render",
      (() => {
        const xMin = -3, xMax = 3, yMin = -1, yMax = 9;
        const w = 96, h = 96;
        const xRange = xMax - xMin, yRange = yMax - yMin;
        const xs = [-2, -1, 0, 1, 2];
        const arrows: ExprNode[] = xs.map((mx) => {
          const my = mx * mx;
          const slope = 2 * mx;
          const dx = w / xRange;
          const dy = -slope * (h / yRange);
          const cx = ((mx - xMin) / xRange) * w;
          const cy = h - ((my - yMin) / yRange) * h;
          return arrowField(cx, cy, dx, dy, 7, { r: 16, g: 185, b: 129, a: 255 });
        });
        return picsOver([
          plot((x) => $mul(x, x), { xMin, xMax, yMin, yMax, w, h }),
          ...arrows,
        ]);
      })(),
      lit(96), lit(96),
    ),
  },

  // -----------------------------------------------------------------------
  // COMPOSITE — raster image with overlaid vector shapes. Wraps a sample
  // photo as a Raster Picture, then `over`-composites circles, hearts,
  // rectangles, or function plots on top.
  // -----------------------------------------------------------------------

  {
    name: "Steak with overlaid circles",
    previousName: "Composite · steak with overlaid circles",
    description: "Sample photo (steak) with three colored circles overlaid. Demonstrates raster + vector composition: `over(circle, over(circle, over(circle, raster(image))))`.",
    expr: callPic("render",
      picsOver([
        rasterPic(call("imageSample", lit(6))),  // steak
        callPic("circle", callPic("point", lit(20), lit(20)), lit(10),
          lit({ r: 239, g: 68, b: 68, a: 200 })),  // semi-transparent red
        callPic("circle", callPic("point", lit(60), lit(40)), lit(12),
          lit({ r: 59, g: 130, b: 246, a: 200 })),
        callPic("circle", callPic("point", lit(40), lit(70)), lit(15),
          lit({ r: 251, g: 191, b: 36, a: 200 })),
      ]),
      lit(96), lit(96),
    ),
  },
  {
    name: "Eye photo with heart overlay",
    previousName: "Composite · eye photo with heart overlay",
    description: "Eye photo with a red heart shape positioned over the iris. Heart math: (x² + y² - 1)³ - x²·y³ ≤ 0 — a real implicit curve, drawn as a Field.",
    expr: callPic("render",
      callPic("over",
        // Heart at (48, 48), size 18 — bumps on top, point on bottom.
        // nx = (px - cx) / r;  ny = (cy - py) / r  (flip y so heart points down)
        // inside = (nx² + ny² - 1)³ - nx²·ny³ ≤ 0
        (() => {
          const cx = 48, cy = 48, r = 18;
          const nx = $div($sub(px, cx), r);
          const ny = $div($sub(cy, py), r);
          const v1 = $sub($add($mul(nx, nx), $mul(ny, ny)), 1);
          const heartCondition = $lte(
            $sub($pow(v1, 3), $mul($mul(nx, nx), $mul(ny, $mul(ny, ny)))),
            0,
          );
          return field($if(
            heartCondition,
            { r: 239, g: 68, b: 68, a: 200 },
            { r: 0, g: 0, b: 0, a: 0 },
          ));
        })(),
        rasterPic(call("imageSample", lit(1))),  // eye
      ),
      lit(96), lit(96),
    ),
  },
  {
    name: "Book cover with framed rectangles",
    previousName: "Composite · book cover with framed rectangles",
    description: "Book cover with three concentric rectangle outlines — a stylised picture frame. Each rectangle is drawn as the difference between an outer filled rectangle and an inner transparent area (achieved by clipping).",
    expr: callPic("render",
      picsOver([
        rasterPic(call("imageSample", lit(3))),  // book
        // Outer rectangle outline: amber
        (() => {
          const inOuter = $and(
            $gte(px, 6), $lte(px, 90),
            $gte(py, 6), $lte(py, 90),
          );
          const inInner = $and(
            $gte(px, 9), $lte(px, 87),
            $gte(py, 9), $lte(py, 87),
          );
          return field($if(
            $and(inOuter, { "!": [inInner] }),
            { r: 251, g: 191, b: 36, a: 255 },
            { r: 0, g: 0, b: 0, a: 0 },
          ));
        })(),
        // Inner rectangle outline: cyan
        (() => {
          const inOuter = $and(
            $gte(px, 18), $lte(px, 78),
            $gte(py, 18), $lte(py, 78),
          );
          const inInner = $and(
            $gte(px, 21), $lte(px, 75),
            $gte(py, 21), $lte(py, 75),
          );
          return field($if(
            $and(inOuter, { "!": [inInner] }),
            { r: 34, g: 211, b: 238, a: 255 },
            { r: 0, g: 0, b: 0, a: 0 },
          ));
        })(),
      ]),
      lit(96), lit(96),
    ),
  },
  {
    name: "Fenel landscape with sine wave overlay",
    previousName: "Composite · Fenel landscape with sine wave overlay",
    description: "Sample photo with a translucent y=sin(x) curve drawn over it. The Field is transparent except on the curve, so the photo shows through everywhere else.",
    expr: callPic("render",
      callPic("over",
        // Translucent sine curve as a Picture (Field that's only opaque on the line).
        (() => {
          const xMin = -2 * Math.PI, xMax = 2 * Math.PI;
          const yMin = -1.3, yMax = 1.3;
          const w = 96, h = 96;
          const xRange = xMax - xMin, yRange = yMax - yMin;
          const mathXBinding = $add(xMin, $mul($div(px, w), xRange));
          const mathXVar = $var("mathX");
          const yVal = $sin(mathXVar);
          const curveY = $sub(h, $mul($div($sub(yVal, yMin), yRange), h));
          return field({
            where: [
              $if(
                $lt($call("abs", $sub(py, curveY)), 2),
                { r: 251, g: 191, b: 36, a: 220 },  // amber translucent
                { r: 0, g: 0, b: 0, a: 0 },
              ),
              { mathX: mathXBinding },
            ],
          });
        })(),
        rasterPic(call("imageSample", lit(0))),  // landscape
      ),
      lit(96), lit(96),
    ),
  },

  // ===================================================================
  // SOUND / AUDIO — Sound is Buffer | Wave. Generators (sine, sawtooth,
  // square) produce Wave-shaped Sounds whose closure is the math.
  // `renderSound` materialises a Buffer the storybook plots as waveform.
  // ===================================================================

  // All audio seeds render at 22050 Hz / 1 s (or longer for tracks). At
  // 4 kHz the audio sounds muddled and many tones perceptually merge —
  // 22050 Hz is exactly half of CD rate and resamples cleanly to 44100.
  {
    name: "A4 sine (440 Hz)",
    previousName: "Sound · A4 sine (440 Hz)",
    description: "Concert-A sine. The math: Wave(\\t -> sin(2π·440·t)). Reference pitch.",
    expr: callSnd("renderSound", callSnd("sine", lit(440)), lit(1), lit(22050)),
  },
  {
    name: "Low bass sine (110 Hz)",
    previousName: "Sound · low bass sine (110 Hz)",
    description: "A2 — two octaves below concert A. Deep low rumble.",
    expr: callSnd("renderSound", callSnd("sine", lit(110)), lit(1), lit(22050)),
  },
  {
    name: "High treble sine (1760 Hz)",
    previousName: "Sound · high treble sine (1760 Hz)",
    description: "A6 — two octaves above concert A. Piercing high pitch.",
    expr: callSnd("renderSound", callSnd("sine", lit(1760)), lit(1), lit(22050)),
  },
  {
    name: "Sawtooth (220 Hz)",
    previousName: "Sound · sawtooth (220 Hz)",
    description: "A3 sawtooth — gritty, harmonic-rich timbre. Classic synth sound.",
    expr: callSnd("renderSound", callSnd("sawtooth", lit(220)), lit(1), lit(22050)),
  },
  {
    name: "Square (220 Hz)",
    previousName: "Sound · square (220 Hz)",
    description: "A3 square wave — chiptune / 8-bit game console timbre.",
    expr: callSnd("renderSound", callSnd("square", lit(220)), lit(1), lit(22050)),
  },
  {
    name: "C major chord",
    previousName: "Sound · C major chord",
    description: "Three sines mixed: C4 (261.63), E4 (329.63), G4 (392.0). Triad — sounds harmonious.",
    expr: callSnd("renderSound",
      callSnd("mix",
        callSnd("mix",
          callSnd("gain", lit(0.3), callSnd("sine", lit(261.63))),
          callSnd("gain", lit(0.3), callSnd("sine", lit(329.63))),
        ),
        callSnd("gain", lit(0.3), callSnd("sine", lit(392.0))),
      ),
      lit(1), lit(22050),
    ),
  },
  {
    name: "Dissonant cluster",
    previousName: "Sound · dissonant cluster",
    description: "Three sines a semitone apart (C4, C#4, D4) — beating + clash. Jarring.",
    expr: callSnd("renderSound",
      callSnd("mix",
        callSnd("mix",
          callSnd("gain", lit(0.33), callSnd("sine", lit(261.63))),
          callSnd("gain", lit(0.33), callSnd("sine", lit(277.18))),
        ),
        callSnd("gain", lit(0.33), callSnd("sine", lit(293.66))),
      ),
      lit(1), lit(22050),
    ),
  },
  {
    name: "Gain · half volume",
    previousName: "Sound · gain · half volume",
    description: "gain(0.5, sine(440)) — same A4 pitch, half amplitude. Intentional 'quieter same note' demo.",
    expr: callSnd("renderSound",
      callSnd("gain", lit(0.5), callSnd("sine", lit(440))),
      lit(1), lit(22050),
    ),
  },
  {
    name: "MIDI note 69 (A4)",
    previousName: "Sound · MIDI note 69 (A4)",
    description: "note 69 = sine(midiToFreq 69) = sine(440). Same A4, but built via the MIDI pitch helper.",
    expr: callSnd("renderSound", callSnd("note", lit(69)), lit(1), lit(22050)),
  },
  {
    name: "MIDI note 60 (middle C)",
    previousName: "Sound · MIDI note 60 (middle C)",
    description: "note 60 = sine(midiToFreq 60) ≈ sine(261.63). Middle C — centre of the keyboard.",
    expr: callSnd("renderSound", callSnd("note", lit(60)), lit(1), lit(22050)),
  },
  {
    name: "Pitch shift up an octave",
    previousName: "Sound · pitch shift up an octave",
    description: "pitch(2, sine 220) — same source, played 2× faster, effectively 440 Hz. Listen to the octave jump.",
    expr: callSnd("renderSound",
      callSnd("pitch", lit(2), callSnd("sine", lit(220))),
      lit(1), lit(22050),
    ),
  },
  {
    name: "Delayed echo",
    previousName: "Sound · delayed echo",
    description: "Mix the original sine with a delayed (and gain-reduced) copy — synthetic single-tap echo.",
    expr: callSnd("renderSound",
      callSnd("mix",
        callSnd("sine", lit(330)),
        callSnd("gain", lit(0.5), callSnd("delay", lit(0.2), callSnd("sine", lit(330)))),
      ),
      lit(1.5), lit(22050),
    ),
  },

  // ===================================================================
  // ANIMATION — Animation is Frames | Animate. The `animate` helper
  // builds Animate-shaped Animations whose Picture varies with time.
  // Each entry below produces real motion when played. Pictures are
  // 32×32 at 12 fps × 2 s = 24 frames per animation.
  // ===================================================================

  {
    name: "Bouncing ball",
    previousName: "Animation · bouncing ball",
    description: "Red circle whose x-position oscillates: x = 16 + 12·sin(2π·t). Visible motion frame-to-frame.",
    expr: callAnim("renderAnim",
      animate(
        $call("circle",
          $call("point",
            $add(16, $mul(12, $call("sin", $mul(TWO_PI, ts)))),
            16,
          ),
          4,
          { r: 239, g: 68, b: 68, a: 255 },
        ),
      ),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },
  {
    name: "Orbiting dot",
    previousName: "Animation · orbiting dot",
    description: "Green dot orbits around centre: position = (16 + 10·cos(2π·t), 16 + 10·sin(2π·t)). Circular motion as math.",
    expr: callAnim("renderAnim",
      animate(
        $call("circle",
          $call("point",
            $add(16, $mul(10, $call("cos", $mul(TWO_PI, ts)))),
            $add(16, $mul(10, $call("sin", $mul(TWO_PI, ts)))),
          ),
          3,
          { r: 16, g: 185, b: 129, a: 255 },
        ),
      ),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },
  {
    name: "Color pulse",
    previousName: "Animation · color pulse",
    description: "Solid colour cycling through the spectrum: r = 128+127·sin(t), g shifted, b shifted. Pure colour motion, no shape.",
    expr: callAnim("renderAnim",
      animate(
        $call("solid",
          $color(
            $add(128, $mul(127, $call("sin", $mul(TWO_PI, ts)))),
            $add(128, $mul(127, $call("sin", $add($mul(TWO_PI, ts), 2.094)))),
            $add(128, $mul(127, $call("sin", $add($mul(TWO_PI, ts), 4.188)))),
          ),
        ),
      ),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },
  {
    name: "Expanding circle",
    previousName: "Animation · expanding circle",
    description: "Radius grows then shrinks: r = 4 + 8·|sin(π·t)|. Pulse-like breathing.",
    expr: callAnim("renderAnim",
      animate(
        $call("circle",
          $call("point", 16, 16),
          $add(4, $mul(8, $call("abs", $call("sin", $mul(3.14159, ts))))),
          { r: 251, g: 191, b: 36, a: 255 },
        ),
      ),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },
  {
    name: "Two-circle orbit",
    previousName: "Animation · two-circle orbit",
    description: "Two circles rotating in opposite phases — composed via overAnim. Each is its own time function.",
    expr: callAnim("renderAnim",
      callAnim("overAnim",
        animate($call("circle",
          $call("point",
            $add(16, $mul(9, $call("cos", $mul(TWO_PI, ts)))),
            $add(16, $mul(9, $call("sin", $mul(TWO_PI, ts)))),
          ),
          3, { r: 239, g: 68, b: 68, a: 255 },
        )),
        animate($call("circle",
          $call("point",
            $add(16, $mul(9, $call("cos", $add($mul(TWO_PI, ts), 3.14159)))),
            $add(16, $mul(9, $call("sin", $add($mul(TWO_PI, ts), 3.14159)))),
          ),
          3, { r: 59, g: 130, b: 246, a: 255 },
        )),
      ),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },
  {
    name: "Rolling stripes",
    previousName: "Animation · rolling stripes",
    description: "A Field whose body uses both p and t — sin((x + 8·t)·0.5). The pattern slides horizontally over time.",
    expr: callAnim("renderAnim",
      animate({
        construct: ["Field", { fn: [["p"], $if(
          $gt($call("sin", $mul(0.5, $add($var("p.x"), $mul(8, ts)))), 0),
          { r: 16, g: 185, b: 129, a: 255 },
          { r: 30, g: 41, b: 99, a: 255 },
        )] }],
      }),
      lit(2), lit(12), lit(32), lit(32),
    ),
  },

  // ===================================================================
  // MOVIE — Animation paired with Sound. `withAudio` is the simple
  // bridge; `movieAt` builds a Movie from a closure that produces a
  // Scene at every t (visual + audio together).
  // ===================================================================

  {
    name: "Bouncing ball + sine",
    previousName: "Movie · bouncing ball + sine",
    description: "withAudio: red ball oscillates x=16+12·sin(2π·t) while a 440 Hz sine plays. Watch the position align with the audio cycle.",
    expr: callMov("renderMovie",
      callMov("withAudio",
        animate(
          $call("circle",
            $call("point",
              $add(16, $mul(12, $call("sin", $mul(TWO_PI, ts)))),
              16,
            ),
            4,
            { r: 239, g: 68, b: 68, a: 255 },
          ),
        ),
        callSnd("sine", lit(440)),
      ),
      lit(2), lit(12), lit(22050), lit(32), lit(32),
    ),
  },
  {
    name: "Colour pulse + chord",
    previousName: "Movie · colour pulse + chord",
    description: "Solid colour cycling through the spectrum as a C-major triad sustains. Pure colour + harmony.",
    expr: callMov("renderMovie",
      callMov("withAudio",
        animate(
          $call("solid",
            $color(
              $add(128, $mul(127, $call("sin", $mul(TWO_PI, ts)))),
              $add(128, $mul(127, $call("sin", $add($mul(TWO_PI, ts), 2.094)))),
              $add(128, $mul(127, $call("sin", $add($mul(TWO_PI, ts), 4.188)))),
            ),
          ),
        ),
        callSnd("mix",
          callSnd("mix",
            callSnd("gain", lit(0.3), callSnd("sine", lit(261.63))),
            callSnd("gain", lit(0.3), callSnd("sine", lit(329.63))),
          ),
          callSnd("gain", lit(0.3), callSnd("sine", lit(392.0))),
        ),
      ),
      lit(2), lit(12), lit(22050), lit(32), lit(32),
    ),
  },
  {
    name: "Orbiting dot + low bass",
    previousName: "Movie · orbiting dot + low bass",
    description: "Green dot orbits the centre while a 110 Hz bass sine drones. Visual angular motion + sustained low pitch.",
    expr: callMov("renderMovie",
      callMov("withAudio",
        animate(
          $call("circle",
            $call("point",
              $add(16, $mul(10, $call("cos", $mul(TWO_PI, ts)))),
              $add(16, $mul(10, $call("sin", $mul(TWO_PI, ts)))),
            ),
            3,
            { r: 16, g: 185, b: 129, a: 255 },
          ),
        ),
        callSnd("sine", lit(110)),
      ),
      lit(2), lit(12), lit(22050), lit(32), lit(32),
    ),
  },

  // ===================================================================
  // TRACK — sequenced sounds. mixDown collapses a Track into a Sound.
  // Each Sound entry has a natural ~1s duration (sine plays continuously
  // until the buffer cuts off), so notes overlap when starts < 1s apart.
  // For melody-style tracks we space notes by 0.4-0.5s so each rings
  // briefly before the next overrides the audible foreground.
  // ===================================================================

  {
    name: "C major scale",
    previousName: "Track · C major scale",
    description: "Eight notes ascending: C D E F G A B C5. Each note bounded to 0.28 s so they don't pile up.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track",
          list(
            callTrk("trackEntry", lit(0.0), callSnd("plucked", lit(60), lit(0.28))),  // C4
            callTrk("trackEntry", lit(0.3), callSnd("plucked", lit(62), lit(0.28))),  // D4
            callTrk("trackEntry", lit(0.6), callSnd("plucked", lit(64), lit(0.28))),  // E4
            callTrk("trackEntry", lit(0.9), callSnd("plucked", lit(65), lit(0.28))),  // F4
            callTrk("trackEntry", lit(1.2), callSnd("plucked", lit(67), lit(0.28))),  // G4
            callTrk("trackEntry", lit(1.5), callSnd("plucked", lit(69), lit(0.28))),  // A4
            callTrk("trackEntry", lit(1.8), callSnd("plucked", lit(71), lit(0.28))),  // B4
            callTrk("trackEntry", lit(2.1), callSnd("plucked", lit(72), lit(0.6))),   // C5 (longer)
          ),
        ),
      ),
      lit(3), lit(22050),
    ),
  },
  {
    name: "Arpeggiated triad",
    previousName: "Track · arpeggiated triad",
    description: "C major broken chord: C E G C E G C — rolling upward 7 notes. Each plucked for 0.18 s.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track",
          list(
            callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.5), callSnd("plucked", lit(60), lit(0.18)))),  // C4
            callTrk("trackEntry", lit(0.2), callSnd("gain", lit(0.5), callSnd("plucked", lit(64), lit(0.18)))),  // E4
            callTrk("trackEntry", lit(0.4), callSnd("gain", lit(0.5), callSnd("plucked", lit(67), lit(0.18)))),  // G4
            callTrk("trackEntry", lit(0.6), callSnd("gain", lit(0.5), callSnd("plucked", lit(72), lit(0.18)))),  // C5
            callTrk("trackEntry", lit(0.8), callSnd("gain", lit(0.5), callSnd("plucked", lit(76), lit(0.18)))),  // E5
            callTrk("trackEntry", lit(1.0), callSnd("gain", lit(0.5), callSnd("plucked", lit(79), lit(0.18)))),  // G5
            callTrk("trackEntry", lit(1.2), callSnd("gain", lit(0.5), callSnd("plucked", lit(84), lit(0.6)))),   // C6 (longer)
          ),
        ),
      ),
      lit(2), lit(22050),
    ),
  },
  {
    name: "Twinkle Twinkle (full first phrase)",
    previousName: "Track · Twinkle Twinkle (full first phrase)",
    description: "Twinkle Twinkle Little Star · How I wonder what you are. C C G G A A G — F F E E D D C. Each note plucked.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track", list(
          // Twinkle, twinkle (C C G G A A G)
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))),  // C
          callTrk("trackEntry", lit(0.4), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))),  // C
          callTrk("trackEntry", lit(0.8), callSnd("gain", lit(0.4), callSnd("plucked", lit(67), lit(0.35)))),  // G
          callTrk("trackEntry", lit(1.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(67), lit(0.35)))),  // G
          callTrk("trackEntry", lit(1.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(69), lit(0.35)))),  // A
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(69), lit(0.35)))),  // A
          callTrk("trackEntry", lit(2.4), callSnd("gain", lit(0.4), callSnd("plucked", lit(67), lit(0.7)))),   // G (held)
          // How I wonder (F F E E D D C)
          callTrk("trackEntry", lit(3.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(65), lit(0.35)))),  // F
          callTrk("trackEntry", lit(3.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(65), lit(0.35)))),  // F
          callTrk("trackEntry", lit(4.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))),  // E
          callTrk("trackEntry", lit(4.4), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))),  // E
          callTrk("trackEntry", lit(4.8), callSnd("gain", lit(0.4), callSnd("plucked", lit(62), lit(0.35)))),  // D
          callTrk("trackEntry", lit(5.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(62), lit(0.35)))),  // D
          callTrk("trackEntry", lit(5.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.8)))),   // C (held)
        )),
      ),
      lit(6.5), lit(22050),
    ),
  },
  {
    name: "Frère Jacques",
    previousName: "Track · Frère Jacques",
    description: "Frère Jacques first two phrases: C D E C, C D E C, E F G, E F G. The classic round in C major.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track", list(
          // Frère Jacques (C D E C)
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))), // C
          callTrk("trackEntry", lit(0.4), callSnd("gain", lit(0.4), callSnd("plucked", lit(62), lit(0.35)))), // D
          callTrk("trackEntry", lit(0.8), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))), // E
          callTrk("trackEntry", lit(1.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))), // C
          // (repeat)
          callTrk("trackEntry", lit(1.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))), // C
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(62), lit(0.35)))), // D
          callTrk("trackEntry", lit(2.4), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))), // E
          callTrk("trackEntry", lit(2.8), callSnd("gain", lit(0.4), callSnd("plucked", lit(60), lit(0.35)))), // C
          // Dormez-vous (E F G)
          callTrk("trackEntry", lit(3.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))), // E
          callTrk("trackEntry", lit(3.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(65), lit(0.35)))), // F
          callTrk("trackEntry", lit(4.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(67), lit(0.7)))),  // G (held)
          // (repeat)
          callTrk("trackEntry", lit(4.8), callSnd("gain", lit(0.4), callSnd("plucked", lit(64), lit(0.35)))), // E
          callTrk("trackEntry", lit(5.2), callSnd("gain", lit(0.4), callSnd("plucked", lit(65), lit(0.35)))), // F
          callTrk("trackEntry", lit(5.6), callSnd("gain", lit(0.4), callSnd("plucked", lit(67), lit(0.7)))),  // G (held)
        )),
      ),
      lit(6.5), lit(22050),
    ),
  },
  {
    name: "Drone + melody",
    previousName: "Track · drone + melody",
    description: "Sustained C bass underneath a five-note treble pattern. Two layers — true polyphony.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track", list(
          // Bass drone — bounded to the full track length so it sustains.
          callTrk("trackEntry", lit(0), callSnd("bound", lit(2.7), callSnd("gain", lit(0.25), callSnd("sine", lit(130.81))))),
          // Melody on top — each pluck 0.45 s
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(72), lit(0.45)))),  // C5
          callTrk("trackEntry", lit(0.5), callSnd("gain", lit(0.4), callSnd("plucked", lit(76), lit(0.45)))),  // E5
          callTrk("trackEntry", lit(1.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(79), lit(0.45)))),  // G5
          callTrk("trackEntry", lit(1.5), callSnd("gain", lit(0.4), callSnd("plucked", lit(76), lit(0.45)))),  // E5
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.4), callSnd("plucked", lit(72), lit(0.7)))),   // C5 (held)
        )),
      ),
      lit(3), lit(22050),
    ),
  },
  {
    name: "I-IV-V-I chord progression",
    previousName: "Track · I-IV-V-I chord progression",
    description: "C major → F major → G major → C major. Each chord is a 3-note triad held for 1 s. Backbone of pop/folk harmony.",
    expr: callSnd("renderSound",
      callTrk("mixDown",
        callTrk("track", list(
          // C major (C-E-G)
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(60), lit(0.95)))),
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(64), lit(0.95)))),
          callTrk("trackEntry", lit(0.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(67), lit(0.95)))),
          // F major (F-A-C)
          callTrk("trackEntry", lit(1.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(65), lit(0.95)))),
          callTrk("trackEntry", lit(1.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(69), lit(0.95)))),
          callTrk("trackEntry", lit(1.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(72), lit(0.95)))),
          // G major (G-B-D)
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(67), lit(0.95)))),
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(71), lit(0.95)))),
          callTrk("trackEntry", lit(2.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(74), lit(0.95)))),
          // C major resolve
          callTrk("trackEntry", lit(3.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(60), lit(1.5)))),
          callTrk("trackEntry", lit(3.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(64), lit(1.5)))),
          callTrk("trackEntry", lit(3.0), callSnd("gain", lit(0.25), callSnd("plucked", lit(67), lit(1.5)))),
        )),
      ),
      lit(4.5), lit(22050),
    ),
  },

  // ===================================================================
  // EVENTS / FRP — Event is a sparse signal of timestamped payloads;
  // accum folds them into a state Behavior. Bridged to media via
  // behaviorToAnim (Behavior Picture → Animation).
  // ===================================================================

  {
    name: "Click stream",
    previousName: "Event · click stream",
    description: "An Event with five clicks at increasing timestamps. Visualised as a list.",
    expr: callEvt("event",
      list(
        callEvt("eventEntry", lit(0.3), lit("click")),
        callEvt("eventEntry", lit(0.55), lit("click")),
        callEvt("eventEntry", lit(1.1), lit("click")),
        callEvt("eventEntry", lit(1.4), lit("click")),
        callEvt("eventEntry", lit(2.2), lit("click")),
      ),
    ),
  },
  {
    name: "Accumulated count",
    previousName: "Behavior · accumulated count",
    description: "accum(0, add, clicks) — a Behavior whose value at time t is the count of events ≤ t. Sampled at t=2 to read the running total.",
    expr: callEvt("sampleBehavior",
      callEvt("accum", lit(0), lit("add"),
        callEvt("event",
          list(
            callEvt("eventEntry", lit(0.3), lit(1)),
            callEvt("eventEntry", lit(0.55), lit(1)),
            callEvt("eventEntry", lit(1.1), lit(1)),
            callEvt("eventEntry", lit(1.4), lit(1)),
            callEvt("eventEntry", lit(2.2), lit(1)),
          ),
        ),
      ),
      callSnd("time", lit(2)),
    ),
  },

  // ===================================================================
  // GAMES — interactive programs as data. `mkGame` packages init/update/
  // view/inputs; `gameToAnim` derives the visual stream. With the live
  // play view in the storybook these become click-and-key playable demos.
  // ===================================================================

  {
    name: "Click counter",
    previousName: "Game · click counter",
    description: "Each input event increments the state. View renders a red circle whose radius is the count. Click ▶ Play to interact.",
    expr: callGame("mkGame",
      lit(1),
      // update: state, input -> state + 1
      { kind: "literal", value: { __fenelFn: true, params: ["s", "i"], body: { call: ["add", { var: "s" }, 1] }, closure: {} } } as ExprNode,
      // view: state -> circle (point 8 8) state RED
      { kind: "literal", value: {
        __fenelFn: true,
        params: ["s"],
        body: { call: ["circle", { call: ["point", 8, 8] }, { var: "s" }, { r: 239, g: 68, b: 68, a: 255 }] },
        closure: {},
      } } as ExprNode,
      callEvt("event",
        list(
          callEvt("eventEntry", lit(0.5), lit("click")),
          callEvt("eventEntry", lit(1.0), lit("click")),
          callEvt("eventEntry", lit(1.5), lit("click")),
        ),
      ),
    ),
  },

  // ===================================================================
  // CROSS-MODAL — turn Pictures into Sounds and vice-versa. Same
  // signal-shape under the hood, just different (domain, codomain).
  // ===================================================================

  {
    name: "Sonify a circle",
    previousName: "Cross · sonify a circle",
    description: "Render a circle Picture, scan its pixels, and play them as audio. Each pixel's luminance becomes a sample.",
    expr: callXm("sonify",
      callPic("over",
        callPic("circle", callPic("point", lit(16), lit(16)), lit(10), COLOR_RED),
        callPic("solid", { kind: "literal", value: { r: 30, g: 41, b: 99, a: 255 } } as ExprNode),
      ),
      lit(1.5), lit(22050),
    ),
  },
  {
    name: "Sonify a checkerboard",
    previousName: "Cross · sonify a checkerboard",
    description: "8-pixel-tile checkerboard sonified at audio rate. Alternation between dark/light cells produces a pulse train.",
    expr: callXm("sonify",
      callPic("checkerboard", lit(8), COLOR_RED, COLOR_BLUE),
      lit(1.5), lit(22050),
    ),
  },
  {
    name: "Visualize a sine",
    previousName: "Cross · visualize a sine",
    description: "Render a 440 Hz sine to a buffer, then plot its waveform as a Picture. Oscilloscope-style.",
    expr: callPic("render",
      callXm("visualize",
        callSnd("renderSound", callSnd("sine", lit(440)), lit(0.05), lit(22050)),
        lit(120), lit(60),
      ),
      lit(120), lit(60),
    ),
  },
  {
    name: "Visualize the C-major chord",
    previousName: "Cross · visualize the C-major chord",
    description: "Render the chord, then plot the resulting waveform — visible interference between the three sines.",
    expr: callPic("render",
      callXm("visualize",
        callSnd("renderSound",
          callSnd("mix",
            callSnd("mix",
              callSnd("gain", lit(0.3), callSnd("sine", lit(261.63))),
              callSnd("gain", lit(0.3), callSnd("sine", lit(329.63))),
            ),
            callSnd("gain", lit(0.3), callSnd("sine", lit(392.0))),
          ),
          lit(0.05), lit(22050),
        ),
        lit(160), lit(64),
      ),
      lit(160), lit(64),
    ),
  },

  // ===================================================================
  // PATH — vector curves built from anchors + linker functions. line is
  // the simplest linker; users can supply any (Number, Point, Point) ->
  // Point. Stroke renders the curve as a Picture; fill renders the
  // closed interior.
  // ===================================================================

  {
    name: "Triangle stroked",
    previousName: "Path · triangle stroked",
    description: "Three anchors connected by line segments, stroked at thickness 2.",
    expr: callPic("render",
      callPth("stroke",
        callPth("path",
          list(
            callPic("point", lit(8), lit(4)),
            callPic("point", lit(28), lit(28)),
            callPic("point", lit(4), lit(28)),
          ),
          list(
            { kind: "literal", value: "path:line" } as ExprNode,
            { kind: "literal", value: "path:line" } as ExprNode,
          ),
        ),
        lit(2),
        COLOR_RED,
      ),
      lit(32), lit(32),
    ),
  },
  {
    name: "Triangle filled",
    previousName: "Path · triangle filled",
    description: "Same triangle, filled instead of stroked. Even-odd ray-cast determines interior.",
    expr: callPic("render",
      callPth("fill",
        callPth("path",
          list(
            callPic("point", lit(16), lit(4)),
            callPic("point", lit(28), lit(24)),
            callPic("point", lit(4), lit(24)),
          ),
          list(
            { kind: "literal", value: "path:line" } as ExprNode,
            { kind: "literal", value: "path:line" } as ExprNode,
          ),
        ),
        COLOR_BLUE,
      ),
      lit(32), lit(32),
    ),
  },
  {
    name: "Zig-zag stroked",
    previousName: "Path · zig-zag stroked",
    description: "Five anchors connected by line segments — a zig-zag stroke.",
    expr: callPic("render",
      callPth("stroke",
        callPth("path",
          list(
            callPic("point", lit(2), lit(16)),
            callPic("point", lit(8), lit(8)),
            callPic("point", lit(14), lit(20)),
            callPic("point", lit(20), lit(8)),
            callPic("point", lit(28), lit(20)),
          ),
          list(
            { kind: "literal", value: "path:line" } as ExprNode,
            { kind: "literal", value: "path:line" } as ExprNode,
            { kind: "literal", value: "path:line" } as ExprNode,
            { kind: "literal", value: "path:line" } as ExprNode,
          ),
        ),
        lit(2),
        COLOR_GREEN,
      ),
      lit(32), lit(32),
    ),
  },

  // ===================================================================
  // MORE GAMES — every game is just a Game record. The sample list
  // demonstrates the variety; each is playable via the live mode.
  // ===================================================================

  {
    name: "Paddle (track input x)",
    previousName: "Game · paddle (track input x)",
    description: "State = paddle x. Each input replaces state with the input's x-coord. Click anywhere on the canvas in Play mode to move the paddle.",
    expr: callGame("mkGame",
      lit(8),
      { kind: "literal", value: { __fenelFn: true, params: ["s", "i"], body: { var: "i" }, closure: {} } } as ExprNode,
      { kind: "literal", value: {
        __fenelFn: true,
        params: ["s"],
        body: { call: ["rectangle",
          { call: ["point", { "-": [{ var: "s" }, 3] }, 14] },
          { call: ["point", { call: ["add", { var: "s" }, 3] }, 16] },
          { r: 251, g: 191, b: 36, a: 255 },
        ]},
        closure: {},
      } } as ExprNode,
      callEvt("event", list(
        callEvt("eventEntry", lit(0.5), lit(4)),
        callEvt("eventEntry", lit(1.0), lit(12)),
        callEvt("eventEntry", lit(1.5), lit(20)),
        callEvt("eventEntry", lit(2.0), lit(28)),
      )),
    ),
  },
  {
    name: "Score (number of clicks)",
    previousName: "Game · score (number of clicks)",
    description: "State = click count. View renders a circle whose radius is the count. Click ▶ Play and tap to grow the circle.",
    expr: callGame("mkGame",
      lit(0),
      { kind: "literal", value: { __fenelFn: true, params: ["s", "i"], body: { call: ["add", { var: "s" }, 1] }, closure: {} } } as ExprNode,
      { kind: "literal", value: {
        __fenelFn: true,
        params: ["s"],
        body: { call: ["circle", { call: ["point", 16, 16] }, { var: "s" }, { r: 239, g: 68, b: 68, a: 255 }] },
        closure: {},
      } } as ExprNode,
      callEvt("event", list(
        callEvt("eventEntry", lit(0.3), lit("click")),
        callEvt("eventEntry", lit(0.6), lit("click")),
        callEvt("eventEntry", lit(0.9), lit("click")),
        callEvt("eventEntry", lit(1.2), lit("click")),
        callEvt("eventEntry", lit(1.5), lit("click")),
      )),
    ),
  },
  {
    name: "RunGame · interactive paddle",
    previousName: "Game · runGame · interactive paddle",
    description: "Wraps a Game with `runGame` — the IO bridge that surfaces the live interactive surface. The frontend recognises the LiveGame marker and renders an interactive canvas where clicks/keys feed real input events. Click anywhere to move the paddle.",
    expr: callGame("runGame",
      callGame("mkGame",
        lit(8),
        { kind: "literal", value: { __fenelFn: true, params: ["s", "i"], body: { var: "i" }, closure: {} } } as ExprNode,
        { kind: "literal", value: {
          __fenelFn: true,
          params: ["s"],
          body: { call: ["rectangle",
            { call: ["point", { "-": [{ var: "s" }, 4] }, 28] },
            { call: ["point", { call: ["add", { var: "s" }, 4] }, 30] },
            { r: 251, g: 191, b: 36, a: 255 },
          ]},
          closure: {},
        } } as ExprNode,
        callEvt("event", list()),
      ),
    ),
  },
  {
    name: "Pong-ish (ball bounces in box)",
    previousName: "Game · pong-ish (ball bounces in box)",
    description: "State = ball x position. Each input adds delta to position; ball wraps inside [0, 32]. Use ◀ ▶ arrow keys in Play mode.",
    expr: callGame("mkGame",
      lit(16),
      { kind: "literal", value: {
        __fenelFn: true,
        params: ["s", "i"],
        // (s + i) mod 32 — wraps within [0, 32]
        body: { call: ["mod", { call: ["add", { var: "s" }, { var: "i" }] }, 32] },
        closure: {},
      } } as ExprNode,
      { kind: "literal", value: {
        __fenelFn: true,
        params: ["s"],
        body: { call: ["circle", { call: ["point", { var: "s" }, 16] }, 3, { r: 16, g: 185, b: 129, a: 255 }] },
        closure: {},
      } } as ExprNode,
      callEvt("event", list(
        callEvt("eventEntry", lit(0.2), lit(2)),
        callEvt("eventEntry", lit(0.4), lit(2)),
        callEvt("eventEntry", lit(0.6), lit(2)),
        callEvt("eventEntry", lit(0.8), lit(-3)),
        callEvt("eventEntry", lit(1.0), lit(-3)),
        callEvt("eventEntry", lit(1.2), lit(4)),
      )),
    ),
  },
];
