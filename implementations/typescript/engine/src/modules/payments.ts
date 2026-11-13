// ---------------------------------------------------------------------------
// Payments — module-substrate Phase 3c generic-loader seam.
//
// Tier-1 (mostly-)pure Shape-B migration. The 26 `defineFunction` specs
// (signatures + identity facets) that used to live here are RETIRED — the
// source of truth is now `fenel/modules/payments/payments.fenel`, which
// carries the `module payments where` header, the per-function `name : Type`
// sigs, and the `@label` / `@description` / `@tags` / `@ioAction` / `@codeName`
// facet directives. The loader lifts those into the SAME Codeable / Labelable /
// Describable / Categorizable / Taggable / IOInvokable `Instance`s the old
// defineFunction specs emitted.
//
// TWO non-default axes (both proven recipe mechanics):
//   1. `payments:createStripeCheckoutSession` is a BODYLESS substrate primitive
//      (the F-permanent Stripe SDK IO leaf, backed by a runtime IO handler at
//      `payments.create_stripe_checkout_session` — NOT a `nativeImpls` map on
//      this module). It is authored as a `@native` FOREIGN DECLARATION in the
//      `.fenel`; the loader emits a bodyless `FenelFunction`, exactly as the old
//      body-less `defineFunction` spec did. The runtime handler stays as-is —
//      different surface (`ts-elimination-completion`'s concern), so this seam
//      adds NO `nativeImpls`.
//   2. `listOrEmpty` / `hasSteps` / `maybeOr` carry a `@codeName` whose value is
//      suffixed `…Payments` (their global codeName must disambiguate from
//      `purchases`' same-named helpers, while the fnId keeps the short name).
//      `@codeName` is the Phase-3c loader addition.
//
// This file is the thin SEAM: it loads that `.fenel` into a `FenelModule` and
// feeds the SAME boot surfaces the hand-written bundle did — engine
// `SYSTEM_MODULES` + runtime `loadRegistry` (both reference `paymentsModule` by
// name, so the seam is transparent: no list edits). The `requires` the specs
// declared are now supplied by `createRegistry`'s `attachInferredRequires`.
// Parity proven by `engine/src/module-migrate-payments.test.ts`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import PAYMENTS_FENEL from "../../../../../fenel/modules/payments/payments.fenel?raw";

// The `"payments"` arg is a fallback only — the `module payments where` header
// in the `.fenel` is authoritative (overrides it). `label` preserves the
// bundle's display label ("Payments").
export const paymentsModule: FenelModule = loadFenelModule(PAYMENTS_FENEL, "payments", {
  label: "Payments",
});
