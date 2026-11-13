// ---------------------------------------------------------------------------
// Time — module-substrate Phase 3b generic-loader seam + the `ffi/` split.
//
// FIRST native-carrying `FenelModule` → `module … where` migration. The 7
// `defineFunction` specs (signatures + identity) and the 8 source-level helper
// functions that used to be assembled here are RETIRED — the source of truth
// is now `fenel/modules/time/time.fenel`, which carries the `module time where`
// header, the per-function `name : Type` sigs, the `@label`/`@description`/
// `@tags` facet directives, the 2 entities (Timestamp / Duration), the Fenel
// bodies (timestamp / duration / parseIsoTimestamp + the 8 span helpers), and
// the 4 `@native` FOREIGN DECLARATIONS (now / hostDateParse / formatIsoTimestamp
// / nowIso).
//
// The FOREIGN-IO half — the irreducible host-time `Date.*` calls — moved to
// `fenel/modules/time/ffi/time-ffi.ts` (the FIRST per-module `ffi/` leaf and
// the FIRST `.ts` under `fenel/`). This file is the thin SEAM: it loads the
// `.fenel` (declarative half, via `loadFenelModule`), imports the ffi leaf (the
// native map — a REAL `.ts` import, NOT `?raw`), and reassembles the
// `FenelModule = { ...loaded, nativeImpls }`. `rekeyNativesById` rekeys the
// codeName-keyed native map to the id-keyed shape the registry merges
// (`time:now`, …), so the runtime contract is unchanged — only the FILE
// LOCATION of the natives moved.
//
// Build-wiring (Phase 3b DECISION 3): the engine `tsconfig.json` `rootDir` was
// broadened to the repo root so the real `.ts` ffi import satisfies the
// rootDir-containment check (TS6059); `include: ["src"]` still bounds the
// program roots. Both boot lists (engine `SYSTEM_MODULES` + runtime
// `loadRegistry`) reference `timeModule` by name, so the seam is transparent.
// The `hostDateParseNative` / `nowNative` / `formatIsoTimestampNative`
// re-exports (consumed by the self-host classifiers) are preserved from the
// ffi leaf. See `workstreams/module-substrate/notes/migration-recipe.md`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { timeNatives } from "../../../../../fenel/modules/time/ffi/time-ffi";
import TIME_FENEL from "../../../../../fenel/modules/time/time.fenel?raw";

const loaded = loadFenelModule(TIME_FENEL, "time", { label: "Time" });

export const timeModule: FenelModule = {
  ...loaded,
  nativeImpls: rekeyNativesById(timeNatives, "time"),
};

// Re-export the irreducible host-time leaves + their value types from the ffi
// module. `hostDateParseNative` is consumed by the compile-{js,wasm} self-host
// classifiers (which bind `hostDateParse` for running compiled samples); the
// rest preserve the pre-migration export surface of this module.
export {
  nowNative,
  formatIsoTimestampNative,
  hostDateParseNative,
  type TimestampValue,
  type DurationValue,
} from "../../../../../fenel/modules/time/ffi/time-ffi";
