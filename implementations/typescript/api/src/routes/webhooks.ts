// ---------------------------------------------------------------------------
// Stripe + Calendly webhook intake.
//
// Phase 12d sub-step 5 — per-route disposition:
//
//   POST /stripe   — Fenel-bodied (LANDED Phase 12d sub-step 5). Body is
//                    webhooks:stripeWebhook. Wrapper handles raw body read
//                    + signature header read + sig-verify via
//                    crypto:verifyStripeSignature substrate (Stripe SDK
//                    F-permanent IO leaf — verifies + decodes in one
//                    constructEvent call). Per-event-type dispatch lives
//                    in the body (Decision E — string discriminator).
//   POST /calendly — Fenel-bodied (LANDED Phase 12c-routes sub-step 2);
//                    body is webhooks:calendlyWebhook. See per-route
//                    header below.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";

const webhookRoutes = new Hono();

// ---------------------------------------------------------------------------
// Stripe
//
// Phase 12d sub-step 5 — disposition: Fenel-bodied (was TS-shim through
// sub-step 4). Wrapper does the irreducible IO: read raw body + signature
// header, invoke crypto:verifyStripeSignature substrate (Stripe SDK
// rolling-secret verify + event decode in one call), 400-reject on Nothing.
// On Just<event>, pass the verified event Record to webhooks:stripeWebhook
// via invokeIOAction. Event-type case-arms live in the Fenel body —
// `checkout.session.completed` dispatches mark_payment_step_paid +
// grant_step_entitlements via dispatch:dispatchAction. Future event types
// (refunds, disputes, chargebacks) join as additional case-arms (Decision E
// — string discriminator until 3+ event types are handled, then lift to
// PaymentEventType ADT).
// ---------------------------------------------------------------------------

webhookRoutes.post("/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) {
    return c.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, 503);
  }

  const rawBody = await c.req.text();

  const accountId = process.env["DEFAULT_ACCOUNT_ID"] ?? "";

  const eventMaybe = (await invokeIOActionEphemeral(
    mintAcquisitionAuthorityFor(""),
    "",
    null,
    "crypto:verifyStripeSignature",
    { rawBody, signature, secret },
  )) as { $tag: "Just"; _0: Record<string, unknown> } | { $tag: "Nothing" };

  if (eventMaybe.$tag === "Nothing") {
    return c.json({ error: "Verification failed" }, 400);
  }

  const event = eventMaybe._0;
  const session = (event["data"] as { object?: Record<string, unknown> } | undefined)
    ?.object;
  const metadata =
    (session?.["metadata"] as Record<string, string> | undefined) ?? {};
  const evAccountId = metadata["accountId"] ?? accountId;

  try {
    const result = await invokeIOActionAs(
      await mintLaneAuthorityFor(evAccountId, "webhook:stripe"),
      null,
      "webhooks:stripeWebhook",
      { event },
    );
    return c.json(result as Record<string, unknown>);
  } catch (err) {
    console.error("[webhook] Error processing Stripe webhook:", err);
    return c.json({ received: true });
  }
});

// ---------------------------------------------------------------------------
// Calendly
//
// Phase 12c-routes sub-step 2 — wrapper handles HMAC-SHA256 verify (via
// crypto:verifyCalendlySignature), JSON parse, accountId resolution + the
// env-var-table mapping of Calendly URI/name → callType slug (Decision V —
// process.env iteration is irreducible IO). Body decides per-event-type
// emit via Fenel's webhooks:calendlyWebhook.
// ---------------------------------------------------------------------------

webhookRoutes.post("/calendly", async (c) => {
  const rawBody = await c.req.text();

  // rights R4a C0 — VERIFICATION IS UNCONDITIONAL, IN EVERY ENVIRONMENT.
  //
  // What was here: `if (secret) { …verify… } else if (NODE_ENV === "production")
  // { 503 }`. The dev tunnel leaves both unset, so an UNSIGNED request passed
  // the authentication stage entirely — measured by posting malformed JSON with
  // no signature and receiving 400 "Invalid JSON", which proves the request
  // reached the parser. The account was then taken from `tracking.utm_source`,
  // a field chosen by whoever books the call, so any caller could mint any
  // account's authority and emit `calendly_call_scheduled` into it.
  //
  // Stripe and the intake route are unchanged: both already 503 when
  // unconfigured, independently of `NODE_ENV`. No third webhook route shares
  // Calendly's conditional-verification shape.
  //
  // ⚠ DO NOT CONFIGURE `CALENDLY_WEBHOOK_SECRET` UNTIL R4a C1b LANDS. The
  // verifier it calls computes `HMAC(secret, rawBody)`; Calendly signs
  // `HMAC(secret, timestamp + "." + rawBody)`. Configuring the secret today
  // converts this hole into an outage — every legitimate callback is rejected.
  const secret = process.env["CALENDLY_WEBHOOK_SECRET"];
  if (!secret) {
    return c.json({ error: "Webhook secret not configured" }, 503);
  }
  const signature = c.req.header("calendly-webhook-signature");
  if (!signature) {
    return c.json({ error: "Missing calendly-webhook-signature" }, 400);
  }
  const ok = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "crypto:verifyCalendlySignature", {
    signature,
    rawBody,
    secret,
  })) as boolean;
  if (!ok) {
    console.warn("[calendly] Signature mismatch — rejecting");
    return c.json({ error: "Invalid signature" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventType = (payload["event"] as string | undefined) ?? "";

  // Calendly event types we care about:
  // - invitee.created → call scheduled
  // - invitee.canceled → call canceled (not used yet)
  if (eventType === "invitee.created") {
    const invitee = (payload["payload"] as Record<string, unknown>) ?? {};
    const email = invitee["email"] as string | undefined;
    const scheduledEvent = invitee["scheduled_event"] as Record<string, unknown> | undefined;
    const scheduledAt = scheduledEvent?.["start_time"] as string | undefined;
    const eventTypeUri = scheduledEvent?.["event_type"] as string | undefined;
    const eventTypeName = scheduledEvent?.["name"] as string | undefined;
    const callType = mapCalendlyEventType(eventTypeUri, eventTypeName);

    // rights R4a C0 — `utm_source` SELECTS NOTHING. It is a tracking field on
    // the booking form, filled in by whoever books the call, and it was the
    // account coordinate: a caller wrote an account id into it and the route
    // minted that account's authority. The deployment default stands until C2
    // replaces it with the per-integration path (§8 decision 4), which is an
    // environment fact rather than a caller-chosen one.
    const accountId = process.env["DEFAULT_ACCOUNT_ID"] ?? "";

    if (accountId) {
      const emitPayload = {
        email,
        scheduledAt,
        callType,
        eventTypeUri,
        eventTypeName,
        calendlyInviteeUri: invitee["uri"],
      };
      const result = await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "webhook:calendly"), null, "webhooks:calendlyWebhook", {
        eventType,
        payload: emitPayload,
      });
      console.log(`[calendly] Call scheduled: ${email} for ${callType} at ${scheduledAt}`);
      return c.json(result as Record<string, unknown>);
    }
  }

  if (eventType === "invitee.canceled") {
    const invitee = (payload["payload"] as Record<string, unknown> | undefined) ?? {};
    console.log("[calendly] Call canceled:", invitee["email"]);
  }

  // Calendly does not natively emit a "meeting ended" webhook. Downstream
  // sources (Zapier, manual triggers) post to the generic event endpoint at
  // POST /api/events/inbound with type="call_completed" instead.

  return c.json({ received: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map Calendly event type URI/name to our call type slug.
 * Calendly URIs look like: https://api.calendly.com/event_types/XXXXXX
 * Mapping is by name or configurable via env vars.
 *
 * STAYS IN TS per Decision V — process.env iteration is irreducible IO; the
 * Fenel body sees the resolved callType.
 */
function mapCalendlyEventType(
  uri?: string,
  name?: string,
): string {
  // Check env-based mapping first: CALENDLY_MAP_cf_intro=https://api.calendly.com/event_types/...
  if (uri) {
    for (const [key, val] of Object.entries(process.env)) {
      if (key.startsWith("CALENDLY_MAP_") && val === uri) {
        return key.slice("CALENDLY_MAP_".length);
      }
    }
  }

  // Fallback: name-based heuristic
  const lower = (name ?? "").toLowerCase();
  if (lower.includes("cf") && lower.includes("call")) return "cf_intro";
  if (lower.includes("sauce") && lower.includes("intro")) return "sauce_intro_30min";
  if (lower.includes("sauce") && lower.includes("texting")) return "sauce_texting_review_60min";

  return name ?? "unknown";
}

export { webhookRoutes };
