// ---------------------------------------------------------------------------
// Cross-modal — module-substrate Phase 3i seam (the WARM-UP of the non-media
// ctx BULK).
//
// crossmodal turns Pictures into Sounds (`sonify`) and Sounds into Pictures
// (`visualize`), plus the internal per-pixel lookup (`_visualizeAt`) the
// visualize Field closure calls. It is the smallest of the seven 3i modules:
// 3 functions, a DISJOINT plain/ctx split (= picture's shape), NO entities,
// NO own dispatch instances.
//
// The ~275-LOC hand-assembled module (3 `defineFunction` specs + the inline
// native impls + the two native maps) is RETIRED. The source of truth is now
// split:
//   - `fenel/modules/crossmodal/types.fenel` — the `module crossmodal where`
//     header + the 3 `@native` FOREIGN DECLARATIONS (sig + @label/@description/
//     @tags);
//   - `fenel/modules/crossmodal/ffi/crossmodal-ffi.ts` — the 3 native impls
//     split into `crossmodalNatives` (plain: _visualizeAt) +
//     `crossmodalNativesCtx` (ctx: sonify / visualize), importing the sibling
//     media bases leaf-to-leaf (picture-ffi `renderNative`, sound-ffi value
//     types — the 3g banked `fenel/ffi → fenel/ffi` edge).
//
// This file is the thin SEAM: load the declarative `.fenel`, import the ffi
// leaf, route the two native maps to `nativeImpls` (plain) + `nativeImplsCtx`
// (ctx) via `rekeyNativesById`, and re-export the `*Native` fns so no consumer
// needs an edit. Same axis decisions as picture (3f): both-maps seam, no
// `@nativeCtx` marker — seam-routing suffices.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  crossmodalNatives,
  crossmodalNativesCtx,
  sonifyNative,
  visualizeNative,
  visualizeAtNative,
} from "../../../../../fenel/modules/crossmodal/ffi/crossmodal-ffi";
import CROSSMODAL_SRC from "../../../../../fenel/modules/crossmodal/types.fenel?raw";

// Declarative half — header + 3 `@native` foreign declarations. `loaded.instances`
// already holds the per-function identity ClassInstances (Codeable / Labelable /
// Categorizable for all 3; Describable / Taggable for all 3 — each carries
// explicit @label/@description/@tags) lifted from the directives + defaults.
const loaded = loadFenelModule(CROSSMODAL_SRC, "crossmodal", { label: "Cross-modal" });

export const crossmodalModule: FenelModule = {
  ...loaded,
  // Plain native (_visualizeAt) → `nativeImpls`; ctx natives (sonify / visualize)
  // → `nativeImplsCtx`. Both rekeyed codeName → `crossmodal:codeName`.
  nativeImpls: rekeyNativesById(crossmodalNatives, "crossmodal"),
  nativeImplsCtx: rekeyNativesById(crossmodalNativesCtx, "crossmodal") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls — preserved byte-for-byte from the retired seam,
// so no consumer needs an edit.
export { sonifyNative, visualizeNative, visualizeAtNative };
