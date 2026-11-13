// ---------------------------------------------------------------------------
// Email-webhooks — module-substrate seam (typed-function-references Phase
// FM-retire-5 Step 5a, 2026-06-06).
//
// FULLY Fenel-authored. The ~479-LOC hand-assembled module (20 `defineFunction`
// specs over the body-only `ingress.fenel`) is RETIRED. Source of truth is now
// `fenel/modules/email-webhooks/ingress.fenel` — a `module emailWebhooks where`
// file carrying each fn's signature + identity facets (@label/@description/
// @tags/@category) + the `@requires "HasStateIO"` constraint on the 11
// emit/handle fns + the SesIngressDecision ADT + the bodies.
//
// HEADER NAME = `emailWebhooks` (NOT `email-webhooks`): the loader ties the
// module name AND the function-id prefix to the header name, and the api routes
// (`api/src/routes/{mailgun,postmark,resend,ses}-webhook.ts`) dispatch the
// bodies by their `emailWebhooks:<fn>` id via `invokeIOAction`. Keeping that id
// byte-identical (0 consumer edits) requires the header to be `emailWebhooks`.
// The human-facing module LABEL is overridden back to "Email-webhook ingress".
//
// The seam re-exports `emailWebhooksModule` by name → 0 consumer edits
// (system-entities.ts imports it directly). 0 `defineFunction`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import INGRESS_FENEL from "../../../../../fenel/modules/email-webhooks/ingress.fenel?raw";

export const emailWebhooksModule: FenelModule = loadFenelModule(
  INGRESS_FENEL,
  "emailWebhooks",
  { label: "Email-webhook ingress" },
);
