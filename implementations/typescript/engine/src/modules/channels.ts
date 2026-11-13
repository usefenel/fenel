// ---------------------------------------------------------------------------
// Channels — ts-elimination-completion Phase 2b generic-loader seam.
//
// NEW module (channels had no `.fenel` source before this phase). The source
// of truth is `fenel/modules/channels/channels.fenel`, which carries the
// `module channels where` header, the per-function `name : Type` sigs, and the
// `@label` / `@description` / `@tags` / `@ioAction` facet directives the loader
// lifts into the SAME Codeable / Labelable / Describable / Categorizable /
// Taggable / IOInvokable `Instance`s a `defineFunction` spec would emit.
//
// This file is the thin SEAM (mirror of `items.ts`): it loads that `.fenel`
// into a `FenelModule` and is registered at the same boot surfaces — engine
// `SYSTEM_MODULES` (system-entities.ts), `type-catalog.ts`, runtime
// `loadRegistry` (evaluator.ts), engine `package.json` `exports`, and the
// self-host matrix generator.
//
// The `module channels where` header keeps the LEGACY lowercase `channels:`
// id-prefix + `channels` category byte-identical (no fnId rename — the
// lowercase→PascalCase canonicalisation is a deferred coordinated sweep). The
// `requires: [HasStateIO]` is supplied by `createRegistry`'s
// `attachInferredRequires` pass (transitive from the `state:*` calls).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import CHANNELS_FENEL from "../../../../../fenel/modules/channels/channels.fenel?raw";

// The `"channels"` arg is a fallback only — the `module channels where` header
// in the `.fenel` is authoritative (overrides it). `label` preserves the
// display label ("Channels").
export const channelsModule: FenelModule = loadFenelModule(CHANNELS_FENEL, "channels", {
  label: "Channels",
});
