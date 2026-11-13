// ---------------------------------------------------------------------------
// Track — module-substrate Phase 3g seam (a CTX-ONLY composer).
//
// A Track is a list of TrackEntry (start time + Sound); `mixDown` collapses it
// into a single Sound. track has NO plain native — the `nativeImpls` map is
// EMPTY, only the two ctx natives (sampleTrackAt / mixDown) populate
// `nativeImplsCtx`. The `ffi/` leaf imports `sampleSoundNative` from sound-ffi
// leaf-to-leaf (a same-phase base, 3g).
//
// The hand-assembled module (2 native ctx specs + 2 `.fenel`-bodied
// `track`/`trackEntry` specs sourced from sidecars + inline native impls + the
// source-module merge) is RETIRED. The source of truth is now split:
//   - `fenel/modules/track/types.fenel` — the `module track where` header, the
//     2 entities (TrackEntry / Track), the 2 `@native` FOREIGN DECLARATIONS,
//     and the CONSOLIDATED `track` / `trackEntry` bodied constructors (folded
//     in from the retired `track.fenel` / `track-entry.fenel` — recipe N6);
//   - `fenel/modules/track/ffi/track-ffi.ts` — the 2 ctx native impls
//     (`trackNativesCtx`) + the empty `trackNatives` plain map + the individual
//     `*Native` fns.
//
// track has NO own dispatch instances (a Track is mixed down to a Sound, not
// itself sampled/rendered as a distinct dispatch target), so this seam adds
// nothing beyond the loaded per-function identity facets + the two native maps.
// It re-exports the `*Native` fns byte-for-byte so no consumer needs an edit.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import {
  trackNatives,
  trackNativesCtx,
  sampleTrackAtNative,
  mixDownNative,
} from "../../../../../fenel/modules/track/ffi/track-ffi";
import TRACK_SRC from "../../../../../fenel/modules/track/types.fenel?raw";

// Declarative half — header + 2 entities + 2 `@native` foreign declarations +
// 2 Fenel bodies (track / trackEntry). `loaded.instances` already holds the
// per-function identity ClassInstances (Codeable / Labelable / Categorizable +
// Describable / Taggable for all 4) lifted from the `@facet` directives.
const loaded = loadFenelModule(TRACK_SRC, "track", { label: "Track" });

export const trackModule: FenelModule = {
  ...loaded,
  // No plain native (trackNatives is empty); ctx natives (sampleTrackAt /
  // mixDown, which re-enter the evaluator) → `nativeImplsCtx`. Both rekeyed
  // codeName → `track:codeName`.
  nativeImpls: rekeyNativesById(trackNatives, "track"),
  nativeImplsCtx: rekeyNativesById(trackNativesCtx, "track") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls byte-for-byte from the retired seam, so no
// consumer needs an edit.
export {
  sampleTrackAtNative,
  mixDownNative,
};
