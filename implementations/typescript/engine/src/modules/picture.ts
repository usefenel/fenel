// ---------------------------------------------------------------------------
// Picture — module-substrate Phase 3f seam (the REPRESENTATIVE CTX-NATIVE).
//
// picture was the Phase-3e-designated representative ctx-native: the first
// module migrated to `module … where` whose `ffi/` leaf hosts a
// `nativeImplsCtx` map. `time` (3b) + `codec` (3d) proved the plain
// `nativeImpls` split; neither exercised the ctx tier (how a native that
// re-enters the evaluator rides the `ffi/` leaf + receives the
// `EvaluateContext`). picture forces BOTH maps out of one leaf — `point` /
// `color` / `alphaBlend` are plain, `sample` / `render` are ctx.
//
// The ~338-LOC hand-assembled module (5 `defineFunction` specs + the inline
// native impls + the Sampleable/Renderable consts + the source-module merge)
// is RETIRED. The source of truth is now split:
//   - `fenel/modules/picture/types.fenel` — the `module picture where` header,
//     the 2 entities (Picture / Point), the 5 `@native` FOREIGN DECLARATIONS
//     (sig + @label/@description/@tags), and the 12 Fenel-bodied helpers
//     (solid / circle / over / dist / … — already `.fenel` since ts-elim 4g);
//   - `fenel/modules/picture/ffi/picture-ffi.ts` — the 5 native impls split
//     into `pictureNatives` (plain: point/color/alphaBlend) +
//     `pictureNativesCtx` (ctx: sample/render), plus the individual `*Native`
//     fns the self-host classifiers + animation/movie/crossmodal import.
//
// This file is the thin SEAM: load the declarative `.fenel`, import the ffi
// leaf, route the two native maps to `nativeImpls` (plain) + `nativeImplsCtx`
// (ctx) via `rekeyNativesById`, append the 2 Sampleable/Renderable dispatch
// instances (small seam consts — codec's Exemplifiable precedent; byte-cleaner
// than a 2-entry instances.fenel sidecar for fnId-string-method instances), and
// re-export the `*Native` fns so no consumer needs an edit.
//
// AXIS DECISIONS (brief):
//   #2 ffi-leaf typing — the leaf imports the REAL `EvaluateContext` +
//      `invokeCallable` + `RgbaPixelValue`/`ImageValue` from engine internals (the
//      faithful-to-current-code option: the retired specs typed
//      `sampleNative(ctx: EvaluateContext, …)` exactly so). It is the FIRST
//      `fenel/ffi → engine` import edge; the 3b rootDir→repo-root build-wiring
//      already makes it compile. The seam casts the ctx map to FenelModule's
//      dependency-free `(ctx: unknown, …)` shape at the boundary.
//   #3 both-maps seam — `nativeImpls` + `nativeImplsCtx` both assembled here.
//   #4 NO new loader/parser convention — plain-vs-ctx is decided ENTIRELY by
//      which seam map an impl lands in; the `@native` foreign decl is uniform.
//      Seam-routing suffices; no `@nativeCtx` marker needed.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  pictureNatives,
  pictureNativesCtx,
  sampleNative,
  renderNative,
  pointNative,
  colorNative,
  alphaBlendNative,
} from "../../../../../fenel/modules/picture/ffi/picture-ffi";
import PICTURE_SRC from "../../../../../fenel/modules/picture/types.fenel?raw";
import PICTURE_INSTANCES_SRC from "../../../../../fenel/modules/picture/instances.fenel?raw";

// Declarative half — header + 2 entities + 5 `@native` foreign declarations +
// 12 Fenel bodies. `loaded.instances` already holds the per-function identity
// ClassInstances (Codeable / Labelable / Categorizable for all 17; Describable /
// Taggable for the 5 natives) lifted from the `@facet` directives + defaults.
const loaded = loadFenelModule(PICTURE_SRC, "picture", { label: "Picture" });

// Sampleable<Picture> / Renderable<Picture> — entries in the polymorphic
// sample/render dispatch tables, now authored as `.fenel` value-decls in the
// per-module instances sidecar (typed-function-references Phase 10c — the loader
// flip lowers the point-free method ref to a dispatch-ready `{$ref}` codeName
// handle; the registry resolves it id-or-codeName to the canonical fnId). Loaded
// with `dispatchInstanceFile: true` so the value-decls project to pure dispatch
// instances, not by-name functions.
const pictureInstances: Instance[] = [
  ...(loaded.instances ?? []),
  ...(loadFenelModule(PICTURE_INSTANCES_SRC, "picture", { dispatchInstanceFile: true }).instances ?? []),
];

export const pictureModule: FenelModule = {
  ...loaded,
  instances: pictureInstances,
  // Plain natives (point / color / alphaBlend) → `nativeImpls`; ctx natives
  // (sample / render, which re-enter the evaluator to invoke Field closures)
  // → `nativeImplsCtx`. Both rekeyed codeName → `picture:codeName`.
  nativeImpls: rekeyNativesById(pictureNatives, "picture"),
  nativeImplsCtx: rekeyNativesById(pictureNativesCtx, "picture") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls for direct use by the self-host classifiers
// (compile-js / compile-wasm import point / color / alphaBlend) + the temporal
// media modules (animation / movie / crossmodal import `renderNative` and call
// it with the EvaluateContext). The export surface is preserved byte-for-byte
// from the retired seam, so no consumer needs an edit.
export {
  sampleNative,
  renderNative,
  pointNative,
  colorNative,
  alphaBlendNative,
};
