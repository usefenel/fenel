// ---------------------------------------------------------------------------
// Games — module-substrate Phase 3g seam.
//
// games packages interactivity (initial state / update fn / view fn / input
// Event stream) over the signal foundation. Its `ffi/` leaf imports
// `sampleSoundNative` from sound-ffi leaf-to-leaf (a same-phase base, 3g) for
// the `gameAudioAt` helper.
//
// The ~339-LOC hand-assembled module (6 `defineFunction` specs + the inline
// native impls + the source-module merge) is RETIRED. The source of truth is
// now split:
//   - `fenel/modules/games/types.fenel` — the `module games where` header, the
//     1 entity (Game), and the 6 `@native` FOREIGN DECLARATIONS (sig +
//     @label/@description/@tags; the `games` category rides the module default);
//   - `fenel/modules/games/ffi/games-ffi.ts` — the 6 native impls split into
//     `gamesNatives` (plain: mkGame) + `gamesNativesCtx` (ctx: gameStateAt /
//     _gameViewAt / gameToAnim / gameToMovie / runGame), plus the individual
//     `*Native` fns (including the standalone `gameAudioAtNative` helper).
//
// games has NO own dispatch instances (no Sampleable/Renderable — it produces
// Animation/Movie via bridge fns, it is not itself sampled), so this seam adds
// nothing beyond the loaded per-function identity facets + the two native maps.
// It re-exports the `*Native` fns byte-for-byte so no consumer needs an edit.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  gamesNatives,
  gamesNativesCtx,
  mkGameNative,
  gameStateAtNative,
  gameToAnimNative,
  gameToMovieNative,
  gameAudioAtNative,
  runGameNative,
} from "../../../../../fenel/modules/games/ffi/games-ffi";
import GAMES_SRC from "../../../../../fenel/modules/games/types.fenel?raw";

// Declarative half — header + 1 entity + 6 `@native` foreign declarations.
// `loaded.instances` already holds the per-function identity ClassInstances
// (Codeable / Labelable / Categorizable + Describable / Taggable for all 6)
// lifted from the `@facet` directives + the `games` category default.
const loaded = loadFenelModule(GAMES_SRC, "games", { label: "Games" });

export const gamesModule: FenelModule = {
  ...loaded,
  // Plain native (mkGame) → `nativeImpls`; ctx natives (gameStateAt /
  // _gameViewAt / gameToAnim / gameToMovie / runGame, which re-enter the
  // evaluator) → `nativeImplsCtx`. Both rekeyed codeName → `games:codeName`.
  nativeImpls: rekeyNativesById(gamesNatives, "games"),
  nativeImplsCtx: rekeyNativesById(gamesNativesCtx, "games") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls byte-for-byte from the retired seam, so no
// consumer needs an edit.
export {
  mkGameNative,
  gameStateAtNative,
  gameToAnimNative,
  gameToMovieNative,
  gameAudioAtNative,
  runGameNative,
};
