// ---------------------------------------------------------------------------
// Path — module-substrate Phase 3i seam (DISJOINT plain/ctx).
//
// path layers parametric vector curves on top of Picture: a CurvePath is
// anchors + linker functions; `stroke` / `fill` bridge CurvePath → Picture.
// It is a DISJOINT plain/ctx module (= picture's 3f shape): `stroke` / `fill`
// are ctx natives (they sample linker closures by re-entering the evaluator),
// `_pathHit` / `_pathInside` are plain natives (pure per-pixel lookups), and
// `path` / `line` are Fenel-bodied.
//
// The ~395-LOC hand-assembled module (5 `defineFunction` specs + inline native
// impls + helpers + the two source-`.fenel` merges) is RETIRED. The source of
// truth is now:
//   - `fenel/modules/path/types.fenel` — the `module path where` header, the
//     CurvePath entity, the `path` + `line` Fenel bodies (path CONSOLIDATED
//     from the former path/path.fenel sidecar), and the 4 `@native` foreign
//     declarations;
//   - `fenel/modules/path/ffi/path-ffi.ts` — the 4 native impls split into
//     `pathNatives` (plain: _pathHit / _pathInside) + `pathNativesCtx`
//     (ctx: stroke / fill).
//
// Thin seam: load the declarative `.fenel`, import the ffi leaf, route both
// native maps via `rekeyNativesById`, re-export the `*Native` fns. No
// `@nativeCtx` marker (seam-routing suffices — axis #4).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  pathNatives,
  pathNativesCtx,
  strokeNative,
  fillNative,
  pathHitNative,
  pathInsideNative,
} from "../../../../../fenel/modules/path/ffi/path-ffi";
import PATH_SRC from "../../../../../fenel/modules/path/types.fenel?raw";

// Declarative half — header + CurvePath entity + path / line bodies + the 4
// `@native` foreign declarations. `loaded.instances` holds the per-function
// identity ClassInstances (Codeable / Labelable / Categorizable for all 6;
// Describable / Taggable for the 5 explicitly-faceted fns).
const loaded = loadFenelModule(PATH_SRC, "path", { label: "Path" });

export const pathModule: FenelModule = {
  ...loaded,
  // Plain natives (_pathHit / _pathInside) → `nativeImpls`; ctx natives
  // (stroke / fill) → `nativeImplsCtx`. Both rekeyed codeName → `path:codeName`.
  nativeImpls: rekeyNativesById(pathNatives, "path"),
  nativeImplsCtx: rekeyNativesById(pathNativesCtx, "path") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls — preserved byte-for-byte from the retired seam.
export { strokeNative, fillNative, pathHitNative, pathInsideNative };
