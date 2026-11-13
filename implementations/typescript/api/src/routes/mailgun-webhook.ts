// ---------------------------------------------------------------------------
// /webhooks/mailgun/:integrationId/{events,inbound} — Mailgun intake.
//
// Phase 12c-routes sub-step 1 — Fenel-bodied ingress. The TS wrapper does
// the provider-specific work (HMAC verify + JSON / multipart parse +
// provider→EmailEvent map + recipient extract); the Fenel body holds the
// cross-cut post-mapping tail (dedup gate + appendEvent + dispatch×2 +
// autoSuppress) via the composing primitive emailWebhooks:emitEmailEvent.
//
// Each Fenel account that connects Mailgun gets a unique webhook URL
// keyed by their integration row id. The integration ID alone resolves
// the owning account + the per-account `MAILGUN_WEBHOOK_SIGNING_KEY`
// used to verify the HMAC signature. Mismatched signature → 403 fast.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import {
  verifyMailgunSignature,
  mailgunEventToEmailEvent,
  mailgunInboundToEmail,
  type MailgunAddressValue as AddressValue,
} from "@fenel/runtime";

const mailgunWebhookRoutes = new Hono();

type IntegrationRow = {
  id: string;
  accountId: string;
  credentials: Record<string, unknown>;
  enabled: boolean;
};

async function loadIntegration(integrationId: string): Promise<IntegrationRow | null> {
  // accountId is read off the resolved integration row; the lookup itself
  // doesn't need an account scope (integration ids are globally unique).
  const result = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state.find_integration_by_id_and_type", {
    id: integrationId,
    type: "mailgun",
  })) as { $tag?: string; _0?: IntegrationRow };
  if (!result || result.$tag !== "Just" || !result._0) return null;
  return result._0;
}

/** Extract the `signature` envelope Mailgun puts on every event payload.
 *  The same shape ships on inbound (Routes-stored) requests too — but
 *  there it's flattened into top-level form fields instead of nested. */
function getEventSignature(
  body: Record<string, unknown>,
): { timestamp: string; token: string; signature: string } | null {
  const sig = body.signature as Record<string, unknown> | undefined;
  if (!sig) return null;
  return {
    timestamp: String(sig.timestamp ?? ""),
    token: String(sig.token ?? ""),
    signature: String(sig.signature ?? ""),
  };
}

function parseRecipient(raw: string): AddressValue | null {
  const at = raw.indexOf("@");
  if (at < 0) return null;
  return { local: raw.slice(0, at), domain: raw.slice(at + 1), displayName: null };
}

// ---------------------------------------------------------------------------
// /events — lifecycle webhooks (delivered, failed, complained, etc.)
// ---------------------------------------------------------------------------

mailgunWebhookRoutes.post("/:integrationId/events", async (c) => {
  const integrationId = c.req.param("integrationId");
  if (!integrationId) return c.json({ error: "integrationId required" }, 400);

  const integration = await loadIntegration(integrationId);
  if (!integration) return c.json({ error: "Unknown integration" }, 404);

  const signingKey = String(
    integration.credentials.MAILGUN_WEBHOOK_SIGNING_KEY ?? "",
  );
  if (!signingKey) {
    return c.json({ error: "Webhook signing key not configured" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const sig = getEventSignature(body);
  if (!sig) return c.json({ error: "Missing signature" }, 403);
  if (!verifyMailgunSignature(sig.timestamp, sig.token, sig.signature, signingKey)) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  // Parse the provider payload + map to typed EmailEvent + extract recipient.
  // The Fenel body handles dedup + emit-or-ignore from here.
  const eventData = (body["event-data"] as Record<string, unknown>) ?? {};
  const emailEvent = mailgunEventToEmailEvent(eventData);
  const recipientStr = String(eventData.recipient ?? "");
  const recipient = recipientStr ? parseRecipient(recipientStr) : null;

  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(integration.accountId, "webhook:mailgun"), null, "emailWebhooks:mailgunEvents", {
    dedupKey: `event:${sig.token}`,
    maybeEvent: emailEvent ? { $tag: "Just", _0: emailEvent } : { $tag: "Nothing" },
    recipient: recipient ? { $tag: "Just", _0: recipient } : { $tag: "Nothing" },
    ignoredLabel: String(eventData.event ?? "unknown"),
  })) as Record<string, unknown>;

  return c.json(result);
});

// ---------------------------------------------------------------------------
// /inbound — parsed inbound mail (Routes "store and notify")
// ---------------------------------------------------------------------------

mailgunWebhookRoutes.post("/:integrationId/inbound", async (c) => {
  const integrationId = c.req.param("integrationId");
  if (!integrationId) return c.json({ error: "integrationId required" }, 400);

  const integration = await loadIntegration(integrationId);
  if (!integration) return c.json({ error: "Unknown integration" }, 404);

  const signingKey = String(
    integration.credentials.MAILGUN_WEBHOOK_SIGNING_KEY ?? "",
  );
  if (!signingKey) {
    return c.json({ error: "Webhook signing key not configured" }, 403);
  }

  // Inbound webhooks come as multipart/form-data; the signature fields
  // are flattened on the top level (timestamp, token, signature).
  const form = await c.req.parseBody();
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === "string") fields[k] = v;
  }

  if (
    !verifyMailgunSignature(
      fields.timestamp ?? "",
      fields.token ?? "",
      fields.signature ?? "",
      signingKey,
    )
  ) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  const email = mailgunInboundToEmail(fields);
  const messageId = (fields["Message-Id"] ?? "").replace(/^<|>$/g, "");

  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(integration.accountId, "webhook:mailgun"), null, "emailWebhooks:mailgunInbound", {
    dedupKey: `inbound:${fields.token ?? ""}`,
    email,
    messageId,
  })) as Record<string, unknown>;

  return c.json(result);
});

export { mailgunWebhookRoutes };
