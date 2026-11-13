// ---------------------------------------------------------------------------
// Purchases — module-substrate Phase 3c generic-loader seam.
//
// Tier-1 pure Shape-B migration (WITH entities — proven by `time`'s
// Timestamp/Duration). The 35 `defineFunction` specs (signatures + identity
// facets) that used to live here are RETIRED — the source of truth is now
// `fenel/modules/purchases/purchases.fenel`, which carries the `module
// purchases where` header, the per-function `name : Type` sigs, the
// `@label` / `@description` / `@tags` / `@ioAction` facet directives, AND the
// two FSM ADT declarations (`PurchaseState` / `PaymentStepState`). The loader
// lifts the directives into the SAME Codeable / Labelable / Describable /
// Categorizable / Taggable / IOInvokable `Instance`s the old specs
// emitted, and surfaces the ADTs on `loaded.entities` automatically (so the
// catalog / constructor picker / matrix see them as first-class).
//
// This file is the thin SEAM: it loads that `.fenel` into a `FenelModule`
// and feeds the SAME boot surfaces the hand-written bundle did — engine
// `SYSTEM_MODULES` + runtime `loadRegistry` (both reference `purchasesModule`
// by name, so the seam is transparent: no list edits). The `requires` the
// specs declared are now supplied by `createRegistry`'s
// `attachInferredRequires`. The `module purchases where` header keeps the
// LEGACY lowercase `purchases:` id-prefix + `purchases` category
// byte-identical. Parity proven by `engine/src/module-migrate-purchases.test.ts`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import PURCHASES_FENEL from "../../../../../fenel/modules/purchases/purchases.fenel?raw";

// The `"purchases"` arg is a fallback only — the `module purchases where`
// header in the `.fenel` is authoritative (overrides it). `label` preserves
// the bundle's display label ("Purchases").
export const purchasesModule: FenelModule = loadFenelModule(PURCHASES_FENEL, "purchases", {
  label: "Purchases",
});
