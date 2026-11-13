// ---------------------------------------------------------------------------
// Subscriptions — module-substrate Phase 3p seam (single-file + ADT).
//
// One of the three semantic modules that fall out of dissolving the retired
// `mixed-ingress.ts` junk-drawer BUNDLE (Phase 3p — the close of the aggregation
// frontier). The `subscriptions:` prefix's home: `subscriptions/ingress.fenel`
// (`module subscriptions where`) carries the 4 PURE dispatch fns + the
// `SubscriptionDispatch` ADT (the loader surfaces the type-def as an entity
// automatically — it rode `mixedIngressModule.entities` before).
//
// The ~349-LOC bundle hand-merge (load-under-throwaway-name + body-extract-by-id
// + re-wrap-in-`defineFunction`) is GONE for this slice. Source of truth is the
// `.fenel` file: header + 4 sigs + their @label/@description/@tags facets. All 4
// fns are PURE (no inferred requires). No stored @category — the `subscriptions`
// category derives at read time from the `subscriptions:` id prefix (Phase 3j).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import SUBSCRIPTIONS_FENEL from "../../../../../fenel/modules/subscriptions/ingress.fenel?raw";

export const subscriptionsModule: FenelModule = loadFenelModule(
  SUBSCRIPTIONS_FENEL,
  "subscriptions",
  { label: "Subscriptions" },
);
