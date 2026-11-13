import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { runInRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { authorityRefusalOf } from "./authority-refusal.js";
import { routes } from "./routes/index.js";
import { redirectRoutes } from "./routes/redirect.js";
import { pageRoutes } from "./routes/pages.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { telegramWebhookRoutes } from "./routes/telegram-webhook.js";
import { mailgunWebhookRoutes } from "./routes/mailgun-webhook.js";
import { postmarkWebhookRoutes } from "./routes/postmark-webhook.js";
import { resendWebhookRoutes } from "./routes/resend-webhook.js";
import { sesWebhookRoutes } from "./routes/ses-webhook.js";
import { subscriptionIngressRoutes } from "./routes/subscription-ingress.js";
import { requestLimits } from "./middleware/rate-limit.js";

const app = new Hono();

/** THE refusal-to-status mapping, exported so a pin can mount it.
 *
 *  Always log the error so it shows up in launchd / docker stderr. Return the
 *  message + stack when NODE_ENV !== "production" so 500s are debuggable from
 *  the client (the dev tunnel runs in dev mode); collapse to a generic message
 *  in production.
 *
 *  ⚠ EXPORTED BY rights R2b, and the reason is the instrument law rather than
 *  tidiness. It used to be an inline closure on a module-private `app`, so the
 *  only way to pin "a refusal answers 403 end to end" was to write a SECOND
 *  handler of the same shape — a twin, which cannot catch this one drifting.
 *  A pin now mounts THIS function. */
export const authorityAwareErrorHandler: Parameters<Hono["onError"]>[0] = (err, c) => {
  // A deliberate HTTP answer thrown by Hono middleware (for example the 413 of
  // `hono/body-limit` on the SES webhook) is a response, not a failure: before
  // GP-25 it fell through to the 500 below.
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[api] Unhandled error:", err);
  // rights R2a — a refusal is 403 and names only the descriptor and the reason.
  // It is recognised by CLASS through the `cause` chain, never by message text.
  const refusal = authorityRefusalOf(err);
  if (refusal) {
    return c.json(
      { error: "authority refused", descriptor: refusal.descriptor, reason: refusal.reason },
      403,
    );
  }
  const debug = process.env["NODE_ENV"] !== "production";
  return c.json(
    debug
      ? { error: err.message, name: err.name, stack: err.stack?.split("\n") }
      : { error: "Internal Server Error" },
    500,
  );
};

app.onError(authorityAwareErrorHandler);

/** GP-25 — rate and payload limits, FIRST, so a flood is answered 429 before
 *  it reaches the session lookup or a registry load. The route classes live in
 *  `middleware/route-classes.ts`; `route-classes.test.ts` fails on a route
 *  without one. */
app.use("*", requestLimits());

/** ONE account-registry resolution per request.
 *
 *  `loadAccountExecutionRegistry` caches correctly but pays two database reads
 *  to decide a hit, and an ordinary authenticated request calls it three times
 *  (the R2a mint, `invokeIOActionAs`, and the durable evaluator's
 *  `makeContext`). This scope makes the second and third free.
 *
 *  ⚠ MOUNTED ON THE ROOT APP, BEFORE EVERY ROUTE, deliberately: mounting it
 *  beside the `/api` auth middleware would miss `/r`, `/p`, the separately
 *  mounted `/api/p`, and the unprefixed webhook routes. A request that never
 *  resolves an account registry pays nothing but the empty scope.
 *
 *  The consistency contract — and why a mutation disables the scope rather
 *  than clearing it — is documented on engine/src/registry-request-scope.ts. */
app.use("*", (_c, next) => runInRegistryRequestScope(() => next()));

app.route("/r", redirectRoutes);
app.route("/p", pageRoutes);
app.route("/api/p", pageRoutes);

// Public webhook endpoints — third parties POST here without the /api prefix.
// Each handler does its own verification (signature/secret), so the permissive
// authMiddleware on /api/* is not required.
app.route("/webhooks", webhookRoutes);
app.route("/webhooks/telegram", telegramWebhookRoutes);
app.route("/webhooks/mailgun", mailgunWebhookRoutes);
app.route("/webhooks/postmark", postmarkWebhookRoutes);
app.route("/webhooks/resend", resendWebhookRoutes);
app.route("/webhooks/ses", sesWebhookRoutes);
app.route("/webhooks/sub", subscriptionIngressRoutes);

app.route("/api", routes);

export { app };
