// ---------------------------------------------------------------------------
// /webhooks/resend/:integrationId/events — Resend (Svix) intake.
//
// Phase 12c-routes sub-step 1 — Fenel-bodied ingress. The TS wrapper does
// Svix HMAC verify + JSON parse + provider→EmailEvent map + recipient
// extract; the Fenel body holds the cross-cut dedup + emit tail.
//
// Resend uses Svix; payloads carry `svix-id` / `svix-timestamp` /
// `svix-signature` headers. We verify HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` against the per-account whsec.
//
// Resend doesn't currently offer parsed inbound, so this file only
// exposes the events endpoint.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import {
  verifyResendSignatureWithBody,
  resendEventToEmailEvent,
  resendEventRecipient,
} from "@fenel/runtime";

const resendWebhookRoutes = new Hono();

type IntegrationRow = {
  id: string;
  accountId: string;
  credentials: Record<string, unknown>;
  enabled: boolean;
};

async function loadIntegration(integrationId: string): Promise<IntegrationRow | null> {
  const result = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state.find_integration_by_id_and_type", {
    id: integrationId,
    type: "resend",
  })) as { $tag?: string; _0?: IntegrationRow };
  if (!result || result.$tag !== "Just" || !result._0) return null;
  return result._0;
}

resendWebhookRoutes.post("/:integrationId/events", async (c) => {
  const integrationId = c.req.param("integrationId");
  if (!integrationId) return c.json({ error: "integrationId required" }, 400);

  const integration = await loadIntegration(integrationId);
  if (!integration) return c.json({ error: "Unknown integration" }, 404);

  // The signing secret for webhooks is separate from the API key. We
  // store it on the integration credentials under
  // `RESEND_WEBHOOK_SIGNING_SECRET` (whsec_…). Without it we cannot
  // verify, so refuse.
  const signingSecret = String(
    integration.credentials.RESEND_WEBHOOK_SIGNING_SECRET ?? "",
  );
  if (!signingSecret) {
    return c.json({ error: "Webhook signing secret not configured" }, 403);
  }

  const svixId = c.req.header("svix-id") ?? "";
  const svixTs = c.req.header("svix-timestamp") ?? "";
  const svixSig = c.req.header("svix-signature") ?? "";

  const rawBody = await c.req.text();
  if (!verifyResendSignatureWithBody(svixId, svixTs, svixSig, signingSecret, rawBody)) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const emailEvent = resendEventToEmailEvent(body);
  const recipient = resendEventRecipient(body);

  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(integration.accountId, "webhook:resend"), null, "emailWebhooks:resendEvents", {
    dedupKey: `event:${svixId}`,
    maybeEvent: emailEvent ? { $tag: "Just", _0: emailEvent } : { $tag: "Nothing" },
    recipient: recipient ? { $tag: "Just", _0: recipient } : { $tag: "Nothing" },
    ignoredLabel: String(body.type ?? "unknown"),
  })) as Record<string, unknown>;

  return c.json(result);
});

export { resendWebhookRoutes };
