// ---------------------------------------------------------------------------
// Path — FFI leaf (the irreducible host bridge: the CTX-threading
// `stroke` / `fill` natives that sample linker closures by re-entering the
// evaluator, plus the pure per-pixel `_pathHit` / `_pathInside` lookups).
//
// module-substrate Phase 3i — path is a DISJOINT plain/ctx module (=
// picture's 3f shape). The split:
//   - CTX natives (`stroke` / `fill`) — sample each segment's linker
//     closure via `invokeCallable` (re-enter the evaluator) → take the
//     `EvaluateContext` as their first arg → `pathNativesCtx` → the
//     module's `nativeImplsCtx`;
//   - PLAIN natives (`_pathHit` / `_pathInside`) — pure per-pixel colour
//     decisions, no ctx → `pathNatives` → the module's `nativeImpls`.
// Which map an impl lands in is the ONLY thing that decides plain-vs-ctx —
// no `.fenel` marker (the `@native` foreign decl is uniform; the seam
// routes — axis #4 settled).
//
// AXIS DECISION (brief axis #2) — this leaf imports `invokeCallable` +
// `EvaluateContext` from the engine internals (the `fenel/ffi → engine`
// edge picture proved). The 3b rootDir→repo-root build-wiring makes it
// compile under `--noEmit`.
//
// F-PERMANENT-REVISIT FLAG: not every export below is irreducible host IO.
// `strokeNative` / `fillNative` are genuine bridge leaves — they re-enter
// the evaluator (via `sampleSegment` → `invokeCallable`) to run linker
// closures, which a `.fenel` body can't do. But the geometry helpers —
// `asPointVal`, `asAnchors`, `asSegments`, `sampleSegment` (linear-interp
// fallback), `samplePath`, and the WHOLE of `pathHitNative` (distance test)
// + `pathInsideNative` (even-odd ray-cast) — are PURE arithmetic /
// record-reshaping that compose from std fns. They are parked here to
// preserve Phase-3i PARITY (byte-for-byte), NOT because they belong at an
// ffi leaf — same posture as picture's / codec's pure helpers. A Fenel
// re-port is a candidate for a later coordinated sweep; porting now would
// be a re-port the parity brief forbids.
//
// The content-gate (`ts-elimination-completion`) permits `.ts` under
// `fenel/modules/` ONLY inside an `ffi/` folder.
// ---------------------------------------------------------------------------

import { invokeCallable, type EvaluateContext } from "../../../../implementations/typescript/engine/src/json-logic";

// ---------------------------------------------------------------------------
// Native helpers — point-on-curve sampling and distance checks (PURE —
// F-permanent FLAG above).
// ---------------------------------------------------------------------------

type PointVal = { x: number; y: number };

function asPointVal(v: unknown): PointVal {
  if (!v || typeof v !== "object") return { x: 0, y: 0 };
  const o = v as { x?: unknown; y?: unknown };
  return { x: Number(o.x) || 0, y: Number(o.y) || 0 };
}

function asAnchors(path: unknown): PointVal[] {
  const anchors = (path as { anchors?: unknown })?.anchors;
  if (!Array.isArray(anchors)) return [];
  return anchors.map(asPointVal);
}

function asSegments(path: unknown): unknown[] {
  const segs = (path as { segments?: unknown })?.segments;
  return Array.isArray(segs) ? segs : [];
}

/** Sample a segment at finely-spaced t values and return all (x, y) points
 *  on the segment. Uses each linker function (or falls back to straight
 *  line interpolation if the segment is missing / invalid). */
function sampleSegment(
  ctx: EvaluateContext,
  linker: unknown,
  p1: PointVal,
  p2: PointVal,
  steps: number,
): PointVal[] {
  const out: PointVal[] = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (linker) {
      const r = invokeCallable(linker, [t, p1, p2], ctx);
      out[i] = asPointVal(r);
    } else {
      out[i] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    }
  }
  return out;
}

/** Sample every segment of the path, returning a flat list of points
 *  along the entire curve. Used for both stroke (distance check) and
 *  fill (ray-casting). */
function samplePath(ctx: EvaluateContext, path: unknown, stepsPerSegment: number): PointVal[] {
  const anchors = asAnchors(path);
  const segments = asSegments(path);
  if (anchors.length < 2) return [];
  const all: PointVal[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const linker = segments[i];
    const sampled = sampleSegment(ctx, linker, anchors[i]!, anchors[i + 1]!, stepsPerSegment);
    // Avoid duplicating endpoints between adjacent segments.
    const start = i === 0 ? 0 : 1;
    for (let j = start; j < sampled.length; j++) all.push(sampled[j]!);
  }
  return all;
}

// ---------------------------------------------------------------------------
// CTX natives — stroke & fill. Both produce Field-shaped Pictures whose
// closure body invokes a plain helper native that reads the pre-sampled
// curve from the closure's captured data.
// ---------------------------------------------------------------------------

/** `stroke` — produce a Picture that's `col` within `thickness/2` of any
 *  point on the path's sampled curve. */
function strokeNative(
  ctx: EvaluateContext,
  path: unknown,
  thickness: unknown,
  col: unknown,
): unknown {
  const points = samplePath(ctx, path, 32);
  const half = Math.max(0.5, Number(thickness) / 2);
  return {
    $tag: "Field",
    _0: {
      __fenelFn: true,
      params: ["p"],
      body: {
        call: ["_pathHit", { var: "_pts" }, { var: "_half" }, { var: "_col" }, { var: "p" }],
      },
      closure: { _pts: points, _half: half, _col: col },
    },
  };
}

/** `fill` — produce a Picture that's `col` inside the closed path
 *  (treating last anchor → first as the closing edge). Even-odd rule via
 *  horizontal ray-cast counts how many edges a horizontal ray from `p`
 *  crosses; odd = inside. */
function fillNative(
  ctx: EvaluateContext,
  path: unknown,
  col: unknown,
): unknown {
  // Close the path by appending the first anchor as the last.
  const anchors = asAnchors(path);
  const segments = asSegments(path);
  const closed = anchors.length > 0 ? [...anchors, anchors[0]!] : [];
  const allPts: PointVal[] = [];
  for (let i = 0; i < closed.length - 1; i++) {
    const linker = i < segments.length ? segments[i] : null; // last (closing) edge: straight line
    const sampled = sampleSegment(ctx, linker, closed[i]!, closed[i + 1]!, 32);
    const start = i === 0 ? 0 : 1;
    for (let j = start; j < sampled.length; j++) allPts.push(sampled[j]!);
  }
  return {
    $tag: "Field",
    _0: {
      __fenelFn: true,
      params: ["p"],
      body: {
        call: ["_pathInside", { var: "_pts" }, { var: "_col" }, { var: "p" }],
      },
      closure: { _pts: allPts, _col: col },
    },
  };
}

// ---------------------------------------------------------------------------
// PLAIN natives — pure per-pixel colour decisions, no ctx.
// ---------------------------------------------------------------------------

/** Helper: is `p` within `half` units of any point in `pts`? */
function pathHitNative(
  pts: unknown,
  half: unknown,
  col: unknown,
  point: unknown,
): unknown {
  if (!Array.isArray(pts)) return { r: 0, g: 0, b: 0, a: 0 };
  const arr = pts as PointVal[];
  const h = Number(half);
  const p = asPointVal(point);
  for (const c of arr) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx * dx + dy * dy <= h * h) return col;
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

/** Helper: is `p` inside the closed polyline `pts` (even-odd rule)? */
function pathInsideNative(
  pts: unknown,
  col: unknown,
  point: unknown,
): unknown {
  if (!Array.isArray(pts)) return { r: 0, g: 0, b: 0, a: 0 };
  const arr = pts as PointVal[];
  if (arr.length < 3) return { r: 0, g: 0, b: 0, a: 0 };
  const p = asPointVal(point);
  let inside = false;
  for (let i = 0, j = arr.length - 1; i < arr.length; j = i++) {
    const xi = arr[i]!.x, yi = arr[i]!.y;
    const xj = arr[j]!.x, yj = arr[j]!.y;
    const intersects =
      (yi > p.y) !== (yj > p.y)
      && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside ? col : { r: 0, g: 0, b: 0, a: 0 };
}

// ---------------------------------------------------------------------------
// The two native maps — codeName → impl. The seam rekeys each to the
// `path:` id-namespace via `rekeyNativesById`.
// ---------------------------------------------------------------------------

export const pathNatives: Record<string, (...args: unknown[]) => unknown> = {
  _pathHit: (pts: unknown, half: unknown, col: unknown, p: unknown) =>
    pathHitNative(pts, half, col, p),
  _pathInside: (pts: unknown, col: unknown, p: unknown) => pathInsideNative(pts, col, p),
};

export const pathNativesCtx: Record<string, (ctx: EvaluateContext, ...args: unknown[]) => unknown> = {
  stroke: (ctx: EvaluateContext, path: unknown, thickness: unknown, col: unknown) =>
    strokeNative(ctx, path, thickness, col),
  fill: (ctx: EvaluateContext, path: unknown, col: unknown) => fillNative(ctx, path, col),
};

export { strokeNative, fillNative, pathHitNative, pathInsideNative };
