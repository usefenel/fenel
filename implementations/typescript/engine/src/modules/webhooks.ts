// ---------------------------------------------------------------------------
// Webhooks — module-substrate Phase 3p seam (a 2-file header UNION).
//
// `webhooks` is one of the three semantic modules that fall out of dissolving
// the retired `mixed-ingress.ts` junk-drawer BUNDLE (Phase 3p — the close of
// the aggregation frontier). The bundle loaded 6 `.fenel` files under throwaway
// internal names, hand-extracted every body by id, and re-wrapped all 14
// functions in `defineFunction` specs stamping the public prefixes. It is
// DISSOLVED: each prefix lands in a SEMANTIC home.
//
// THIS module is the `webhooks:` prefix's home — formed by UNIONing the two
// provider files `webhooks/calendly.fenel` + `webhooks/stripe.fenel` (BOTH carry
// `module webhooks where`) via `loadFenelModuleUnion` (the 3m cross-file-header
// union mechanism). The 6 fns are disjoint across the two files (calendly: 2,
// stripe: 4); a dup-name across the union would throw a precise load-time error.
// Identity facets ride @directives in the `.fenel` files; `recordOrEmptyForWebhook`
// is the lone PURE fn, the other 5 infer `HasStateIO` transitively at registry
// build (the 3a precedent). No stored @category — the `webhooks` category derives
// at read time from the `webhooks:` id prefix (Phase 3j).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import CALENDLY_FENEL from "../../../../../fenel/modules/webhooks/calendly.fenel?raw";
import STRIPE_FENEL from "../../../../../fenel/modules/webhooks/stripe.fenel?raw";

// Parse each provider file independently (never string-concat); both carry
// `module webhooks where`, so they UNION into one `webhooks` group. The `name`
// args are header-overridden fallbacks.
const groups = loadFenelModuleUnion(
  [
    { src: CALENDLY_FENEL, name: "webhooks" },
    { src: STRIPE_FENEL, name: "webhooks" },
  ],
  { labels: { webhooks: "Webhooks" } },
);

const webhooksGroup = groups.find((m) => m.name === "webhooks");
if (!webhooksGroup) {
  throw new Error(
    "webhooks: loadFenelModuleUnion did not yield the `webhooks` group — Fenel sources out of sync with the seam (both webhooks/*.fenel must carry `module webhooks where`)",
  );
}

export const webhooksModule: FenelModule = webhooksGroup;
