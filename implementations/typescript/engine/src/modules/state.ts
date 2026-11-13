// ---------------------------------------------------------------------------
// State module — the persistence-leaf IO surface.
//
// typed-function-references Phase FM-retire-8 (2026-06-07) lifted the 142
// portable `state:*` bodyless IO leaves to `fenel/modules/state/io-leaves.fenel`
// (`module state where` — the telegram/io.fenel mechanic), merged in below via
// `loadFenelModule`.
//
// FM-retire-10 (2026-06-07) closed the floor: the last 4 dependent-typing fns
// (schemaOf / typeclassMethodsSchema / tryCreateInstanceByName /
// registerRepresentation) gained a `.fenel` sig surface via two parser
// extensions — Ext1 = the `Type` type-atom (`{$type:true}` in sig position),
// Ext2 = the lowercase-headed `$el` dependent param (`value : schemaOf typeId`).
// They now ride the same io-leaves.fenel volume as every other leaf, so this
// seam hosts ZERO `defineFunction` specs — state.ts is a pure loader.
//
// The 7 `crypto:*` fns spun out to their own `crypto` module (Step 2) — natives
// now in fenel/modules/crypto/ffi/crypto-ffi.ts; the lone `dispatch:dispatchAction`
// folded into the EXISTING `dispatch` module (Step 3, fenel/modules/dispatch/
// types.fenel). state.ts therefore registers NO natives.
//
// The runtime IO handlers (keyed by `@ioAction`, in runtime/handlers/state.ts
// via registerStateHandlers) are UNCHANGED by this metadata move.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import IO_LEAVES_FENEL from "../../../../../fenel/modules/state/io-leaves.fenel?raw";

// ---------------------------------------------------------------------------
// The 146 `state:*` leaves — `.fenel`-authored, loaded here as the whole module.
// `loadFenelModule` reproduces each leaf's params / returns / requires
// (HasStateIO) + identity facets (Codeable / Labelable / Describable / Taggable +
// pinToView's Iconable+Emojiable) byte-faithfully; no stored Categorizable
// (Phase-3j read-time derives it from the `state:` prefix). The 4 dependent-typing
// fns (FM-retire-10) ride the tail of the same file via the Ext1/Ext2 sig surface.
// ---------------------------------------------------------------------------
const ioLeaves = loadFenelModule(IO_LEAVES_FENEL, "state");

export const stateModule: FenelModule = {
  name: "state",
  label: "State IO",
  functions: ioLeaves.functions ?? [],
  instances: ioLeaves.instances ?? [],
  entities: ioLeaves.entities ?? [],
};
