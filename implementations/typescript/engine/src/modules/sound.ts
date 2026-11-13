// ---------------------------------------------------------------------------
// Sound — module-substrate Phase 3g seam (the SECOND both-maps BASE).
//
// sound is the second base after picture (the 3f representative ctx-native):
// the first migration that EXPORTS its ffi leaf for sibling composers to
// import. picture proved one base; sound confirms the recipe generalises to a
// second + establishes the `sound/ffi/sound-ffi.ts` leaf that `track` / `games`
// / `movie` import leaf-to-leaf.
//
// The ~386-LOC hand-assembled module (8 `defineFunction` specs + the inline
// native impls + the Sampleable/Renderable consts + the source-module merge)
// is RETIRED. The source of truth is now split:
//   - `fenel/modules/sound/types.fenel` — the `module sound where` header, the
//     2 entities (Sound / Time), the 8 `@native` FOREIGN DECLARATIONS
//     (sig + @label/@description/@category/@tags), and the 16 Fenel-bodied
//     helpers (sine / sawtooth / gain / mix / … — already `.fenel` since
//     ts-elim 4g);
//   - `fenel/modules/sound/ffi/sound-ffi.ts` — the 8 native impls split into
//     `soundNatives` (plain: time/amplitude/mono/ampL/ampR/audioBuffer) +
//     `soundNativesCtx` (ctx: sampleSound/renderSound), plus the individual
//     `*Native` fns + the `Amplitude`/`Time`/`AudioBuffer` value types the
//     self-host classifiers + track/games/movie/crossmodal import.
//
// This file is the thin SEAM: load the declarative `.fenel`, import the ffi
// leaf, route the two native maps to `nativeImpls` (plain) + `nativeImplsCtx`
// (ctx) via `rekeyNativesById`, append the 2 Sampleable/Renderable dispatch
// instances (small seam consts — picture/codec precedent), and re-export the
// `*Native` fns + value types so no consumer needs an edit.
//
// AXIS DECISIONS (Phase 3g):
//   cross-module ffi-leaf import — sound is a BASE, so its leaf imports only
//     engine internals (`invokeCallable` + `EvaluateContext`); the value types
//     + `sampleSoundNative` it exports are consumed LEAF-TO-LEAF by the
//     composer leaves (`fenel/ffi → fenel/ffi`), never via this seam. This seam
//     still re-exports them for the NOT-YET-migrated consumers (crossmodal /
//     events import the types from `./sound`) + the self-host classifiers
//     (import the 6 plain `*Native` fns) — 0 consumer edits.
//   both-maps seam — `nativeImpls` + `nativeImplsCtx` both assembled here.
//   no new loader/parser convention — plain-vs-ctx is decided ENTIRELY by which
//     seam map an impl lands in; the `@native` foreign decl is uniform.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  soundNatives,
  soundNativesCtx,
  sampleSoundNative,
  renderSoundNative,
  timeNative,
  amplitudeNative,
  monoNative,
  ampLNative,
  ampRNative,
  audioBufferNative,
  type AmplitudeValue,
  type TimeValue,
  type AudioBufferValue,
} from "../../../../../fenel/modules/sound/ffi/sound-ffi";
import SOUND_SRC from "../../../../../fenel/modules/sound/types.fenel?raw";
import SOUND_INSTANCES_SRC from "../../../../../fenel/modules/sound/instances.fenel?raw";

// Declarative half — header + 2 entities + 8 `@native` foreign declarations +
// 16 Fenel bodies. `loaded.instances` already holds the per-function identity
// ClassInstances (Codeable / Labelable / Categorizable for all 24; the natives'
// audio Categorizable + Describable / Taggable) lifted from the `@facet`
// directives + defaults.
const loaded = loadFenelModule(SOUND_SRC, "sound", { label: "Sound" });

// Sampleable<Sound> / Renderable<Sound> — entries in the polymorphic
// sample/render dispatch tables, now authored as `.fenel` value-decls in the
// per-module instances sidecar (typed-function-references Phase 10c — the loader
// flip lowers the point-free method ref to a dispatch-ready `{$ref}` codeName
// handle; the registry resolves it id-or-codeName to the canonical fnId). Loaded
// with `dispatchInstanceFile: true` so the value-decls project to pure dispatch
// instances, not by-name functions.
const soundInstances: Instance[] = [
  ...(loaded.instances ?? []),
  ...(loadFenelModule(SOUND_INSTANCES_SRC, "sound", { dispatchInstanceFile: true }).instances ?? []),
];

export const soundModule: FenelModule = {
  ...loaded,
  instances: soundInstances,
  // Plain natives (time / amplitude / mono / ampL / ampR / audioBuffer) →
  // `nativeImpls`; ctx natives (sampleSound / renderSound, which re-enter the
  // evaluator to invoke Wave closures) → `nativeImplsCtx`. Both rekeyed
  // codeName → `sound:codeName`.
  nativeImpls: rekeyNativesById(soundNatives, "sound"),
  nativeImplsCtx: rekeyNativesById(soundNativesCtx, "sound") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls + value types for direct use by the self-host
// classifiers (compile-js / compile-wasm import time/amplitude/mono/ampL/ampR/
// audioBuffer natives) + the media composers (track / games import
// `sampleSoundNative` + `AmplitudeValue`; movie / crossmodal import the value
// types). The export surface is preserved byte-for-byte from the retired seam,
// so no consumer needs an edit.
export {
  sampleSoundNative,
  renderSoundNative,
  timeNative,
  amplitudeNative,
  monoNative,
  ampLNative,
  ampRNative,
  audioBufferNative,
};
export type { AmplitudeValue, TimeValue, AudioBufferValue };
