// ---------------------------------------------------------------------------
// Movie — module-substrate Phase 3g seam (the RICHEST COMPOSER).
//
// movie proves the cross-module ffi-leaf import in one shot: its `ffi/`
// leaf pulls `renderNative` from picture-ffi (a PREVIOUSLY-migrated base, 3f)
// AND the `Amplitude`/`AudioBuffer` value types from sound-ffi (a SAME-PHASE
// base, 3g) — a `fenel/ffi → fenel/ffi` leaf-to-leaf edge, not a bounce through
// the engine seam. Once sound→movie is green the cross-module wrinkle is banked.
//
// The ~280-LOC hand-assembled module (3 `defineFunction` specs + the inline
// native impls + the Sampleable/Renderable consts + the source-module merge)
// is RETIRED. The source of truth is now split:
//   - `fenel/modules/movie/types.fenel` — the `module movie where` header, the
//     3 entities (Movie / Scene / RecordedMovie), the 3 `@native` FOREIGN
//     DECLARATIONS (sig + @label/@description/@category/@tags), and the 2
//     Fenel-bodied helpers (withAudio / silentMovie — already `.fenel` since
//     ts-elim 4g);
//   - `fenel/modules/movie/ffi/movie-ffi.ts` — the 3 native impls split into
//     `movieNatives` (plain: scene) + `movieNativesCtx` (ctx: sampleMovie /
//     renderMovie), plus the individual `*Native` fns + the `Scene` /
//     `RecordedMovie` value types.
//
// This file is the thin SEAM: load the declarative `.fenel`, import the ffi
// leaf, route the two native maps to `nativeImpls` (plain) + `nativeImplsCtx`
// (ctx) via `rekeyNativesById`, append the 2 Sampleable/Renderable dispatch
// instances (small seam consts — picture/sound precedent), and re-export the
// `*Native` fns + value types so no consumer needs an edit.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  movieNatives,
  movieNativesCtx,
  sampleMovieNative,
  renderMovieNative,
  sceneNative,
  type SceneValue,
  type RecordedMovieValue,
} from "../../../../../fenel/modules/movie/ffi/movie-ffi";
import MOVIE_SRC from "../../../../../fenel/modules/movie/types.fenel?raw";
import MOVIE_INSTANCES_SRC from "../../../../../fenel/modules/movie/instances.fenel?raw";

// Declarative half — header + 3 entities + 3 `@native` foreign declarations +
// 2 Fenel bodies. `loaded.instances` already holds the per-function identity
// ClassInstances (Codeable / Labelable / Categorizable for all 5; the natives'
// video Categorizable + Describable / Taggable) lifted from the `@facet`
// directives + defaults.
const loaded = loadFenelModule(MOVIE_SRC, "movie", { label: "Movie" });

// Sampleable<Movie> / Renderable<Movie> — entries in the polymorphic
// sample/render dispatch tables, now authored as `.fenel` value-decls in the
// per-module instances sidecar (typed-function-references Phase 10c).
const movieInstances: Instance[] = [
  ...(loaded.instances ?? []),
  ...(loadFenelModule(MOVIE_INSTANCES_SRC, "movie", { dispatchInstanceFile: true }).instances ?? []),
];

export const movieModule: FenelModule = {
  ...loaded,
  instances: movieInstances,
  // Plain native (scene) → `nativeImpls`; ctx natives (sampleMovie / renderMovie,
  // which re-enter the evaluator to invoke MovieAt closures + picture render) →
  // `nativeImplsCtx`. Both rekeyed codeName → `movie:codeName`.
  nativeImpls: rekeyNativesById(movieNatives, "movie"),
  nativeImplsCtx: rekeyNativesById(movieNativesCtx, "movie") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls + value types byte-for-byte from the retired seam,
// so no consumer needs an edit.
export {
  sampleMovieNative,
  renderMovieNative,
  sceneNative,
};
export type { SceneValue, RecordedMovieValue };
