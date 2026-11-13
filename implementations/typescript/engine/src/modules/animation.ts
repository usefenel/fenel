// ---------------------------------------------------------------------------
// Animation — module-substrate Phase 3g seam (a CTX-ONLY composer).
//
// animation has NO plain native — the `nativeImpls` map is EMPTY, only the two
// ctx natives (sampleAnim / renderAnim) populate `nativeImplsCtx`. This is the
// simpler sub-case picture's both-maps proof already covers (empty plain map +
// populated ctx map). The `ffi/` leaf imports `renderNative` from picture-ffi
// leaf-to-leaf (a previously-migrated base, 3f).
//
// The hand-assembled module (3 `defineFunction` specs — 2 native ctx +
// 1 `.fenel`-bodied `frameSequence` sourced from a sidecar — plus the inline
// native impls + the source-module merge) is RETIRED. The source of truth is
// now split:
//   - `fenel/modules/animation/types.fenel` — the `module animation where`
//     header, the 2 entities (Animation / FrameSequence), the 2 `@native`
//     FOREIGN DECLARATIONS, the CONSOLIDATED `frameSequence` bodied helper
//     (folded in from the retired `frame-sequence.fenel` — recipe N6), and the
//     4 closure helpers (freeze / overAnim / delayAnim / speedAnim);
//   - `fenel/modules/animation/ffi/animation-ffi.ts` — the 2 ctx native impls
//     (`animNativesCtx`) + the empty `animNatives` plain map + the individual
//     `*Native` fns + the `FrameSequence` value type.
//
// This file is the thin SEAM: load the declarative `.fenel`, import the ffi
// leaf, route the two native maps, append the 2 Sampleable/Renderable dispatch
// instances (small seam consts — picture/sound/movie precedent), and re-export
// the `*Native` fns so no consumer needs an edit.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  animNatives,
  animNativesCtx,
  sampleAnimNative,
  renderAnimNative,
  type FrameSequenceValue,
} from "../../../../../fenel/modules/animation/ffi/animation-ffi";
import ANIMATION_SRC from "../../../../../fenel/modules/animation/types.fenel?raw";
import ANIMATION_INSTANCES_SRC from "../../../../../fenel/modules/animation/instances.fenel?raw";

// Declarative half — header + 2 entities + 2 `@native` foreign declarations +
// 5 Fenel bodies (frameSequence + the 4 closure helpers). `loaded.instances`
// already holds the per-function identity ClassInstances (Codeable / Labelable /
// Categorizable for all 7; the natives' + frameSequence's video Categorizable +
// Describable / Taggable) lifted from the `@facet` directives + defaults.
const loaded = loadFenelModule(ANIMATION_SRC, "animation", { label: "Animation" });

// Sampleable<Animation> / Renderable<Animation> — entries in the polymorphic
// sample/render dispatch tables, now authored as `.fenel` value-decls in the
// per-module instances sidecar (typed-function-references Phase 10c — the loader
// flip lowers the point-free method ref to a dispatch-ready `{$ref}` codeName
// handle; the registry resolves it id-or-codeName to the canonical fnId).
const animationInstances: Instance[] = [
  ...(loaded.instances ?? []),
  ...(loadFenelModule(ANIMATION_INSTANCES_SRC, "animation", { dispatchInstanceFile: true }).instances ?? []),
];

export const animationModule: FenelModule = {
  ...loaded,
  instances: animationInstances,
  // No plain native (animNatives is empty); ctx natives (sampleAnim / renderAnim,
  // which re-enter the evaluator to invoke Animate closures + picture render) →
  // `nativeImplsCtx`. Both rekeyed codeName → `animation:codeName`.
  nativeImpls: rekeyNativesById(animNatives, "animation"),
  nativeImplsCtx: rekeyNativesById(animNativesCtx, "animation") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls + value type byte-for-byte from the retired seam,
// so no consumer needs an edit.
export {
  sampleAnimNative,
  renderAnimNative,
};
export type { FrameSequenceValue };
