// ---------------------------------------------------------------------------
// API route barrel + diagnostic endpoints.
//
// Phase 12c-routes sub-step 4 — disposition sweep.
//
//   GET /health  — B-permanent. Trivial liveness check.
//   GET /version — B-permanent. Returns env+startup metadata (GIT_SHA +
//                  STARTED_AT). The git rev-parse fallback is an
//                  irreducible filesystem leaf.
//
// The barrel itself (the route.route(...) chain) is A-trivially a
// re-export shim; not a port target.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { actionRoutes } from "./actions";
import { webhookRoutes } from "./webhooks";
import { telegramWebhookRoutes } from "./telegram-webhook";
import { mailgunWebhookRoutes } from "./mailgun-webhook";
import { postmarkWebhookRoutes } from "./postmark-webhook";
import { resendWebhookRoutes } from "./resend-webhook";
import { sesWebhookRoutes } from "./ses-webhook";
import { eventRoutes } from "./events";
import { formRoutes } from "./forms";
import { dashboardRoutes } from "./dashboard";
import { importRoutes } from "./imports";
import { receiptRoutes } from "./receipt";
import { queryRoutes } from "./query";
import { inputRoutes } from "./input";
import { authRoutes } from "./auth";
import { fieldDefinitionBundleRoutes } from "./field-definition-bundles";
import { sourceModuleRoutes } from "./modules";
import { accountMemberRoutes } from "./account-members";
import { authMiddleware } from "../middleware/auth";

const routes = new Hono();

// Resolve every request's Subject up-front. Permissive — anonymous is a
// valid resolution. Downstream routes decide whether the resolved
// subject is acceptable for their handler.
routes.use("*", authMiddleware);

// Resolved once at module load. Prefers GIT_SHA env (set by build/CI),
// falls back to `git rev-parse HEAD` against the working tree.
const GIT_SHA: string = (() => {
  const fromEnv = process.env["GIT_SHA"];
  if (fromEnv) return fromEnv;
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
    return new TextDecoder().decode(proc.stdout).trim() || "unknown";
  } catch {
    return "unknown";
  }
})();
const STARTED_AT = new Date().toISOString();

routes.get("/health", (c) => c.json({ status: "ok" }));
routes.get("/version", (c) =>
  c.json({ sha: GIT_SHA, startedAt: STARTED_AT }),
);
routes.route("/auth", authRoutes);
routes.route("/actions", actionRoutes);
routes.route("/webhooks", webhookRoutes);
routes.route("/webhooks/telegram", telegramWebhookRoutes);
routes.route("/webhooks/mailgun", mailgunWebhookRoutes);
routes.route("/webhooks/postmark", postmarkWebhookRoutes);
routes.route("/webhooks/resend", resendWebhookRoutes);
routes.route("/webhooks/ses", sesWebhookRoutes);
// Public form-serving endpoint — separate from the dashboard /forms admin
// CRUD because it accepts unauthenticated reads/submits via slug.
routes.route("/embed/forms", formRoutes);
// Public inbound event intake — token-authenticated.
routes.route("/intake/events", eventRoutes);
routes.route("/imports", importRoutes);
routes.route("/query", queryRoutes);
routes.route("/input", inputRoutes);
routes.route("/definition-bundles", fieldDefinitionBundleRoutes);
routes.route("/modules", sourceModuleRoutes);
// rights R2b — the first grant's product surface. Owner-only writes, gated by
// the authority envelope rather than by a check in the route.
routes.route("/account/members", accountMemberRoutes);
// Mount dashboard CRUD/data routes at the api root (no /dashboard prefix).
// Listed AFTER the dedicated public groups so /forms (list) doesn't shadow
// /embed/forms/:slug if both ever resolve identical patterns.
routes.route("/", dashboardRoutes);
routes.route("/", receiptRoutes);

export { routes };
