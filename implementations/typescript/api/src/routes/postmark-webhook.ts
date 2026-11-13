// ---------------------------------------------------------------------------
// /webhooks/postmark/:integrationId/{events,inbound} — Postmark intake.
//
// Phase 12c-routes sub-step 1 — Fenel-bodied ingress. The TS wrapper
// resolves the integration + parses the body + maps to typed EmailEvent /
// Email; the Fenel body holds the cross-cut dedup + emit tail.
//
// Auth: Postmark doesn't sign payloads by default. The integration-id
// path segment (a UUID) is the unguessable per-account secret. Optional
// hardening (HTTP Basic auth in the URL, or X-Postmark-Signature
// validation) can be layered on later — Postmark supports both but
// neither is required for the v1 surface.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";
import {
  postmarkEventToEmailEvent,
  postmarkEventRecipient,
  postmarkEventDedupeKey,
  postmarkInboundToEmail,
} from "@fenel/runtime";

const postmarkWebhookRoutes = new Hono();

type IntegrationRow = {
  id: string;
  accountId: string;
  enabled: boolean;
};

async function loadIntegration(integrationId: string): Promise<IntegrationRow | null> {
  const result = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state.find_integration_by_id_and_type", {
    id: integrationId,
    type: "postmark",
  })) as { $tag?: string; _0?: IntegrationRow };
  if (!result || result.$tag !== "Just" || !result._0) return null;
  return result._0;
}

postmarkWebhookRoutes.post("/:integrationId/events", async (c) => {
  const integrationId = c.req.param("integrationId");
  if (!integrationId) return c.json({ error: "integrationId required" }, 400);

  const integration = await loadIntegration(integrationId);
  if (!integration) return c.json({ error: "Unknown integration" }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const dedupeKey = postmarkEventDedupeKey(body);
  const emailEvent = postmarkEventToEmailEvent(body);
  const recipient = postmarkEventRecipient(body);

  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(integration.accountId, "webhook:postmark"), null, "emailWebhooks:postmarkEvents", {
    dedupKey: `event:${dedupeKey}`,
    maybeEvent: emailEvent ? { $tag: "Just", _0: emailEvent } : { $tag: "Nothing" },
    recipient: recipient ? { $tag: "Just", _0: recipient } : { $tag: "Nothing" },
    ignoredLabel: String(body.RecordType ?? "unknown"),
  })) as Record<string, unknown>;

  return c.json(result);
});

postmarkWebhookRoutes.post("/:integrationId/inbound", async (c) => {
  const integrationId = c.req.param("integrationId");
  if (!integrationId) return c.json({ error: "integrationId required" }, 400);

  const integration = await loadIntegration(integrationId);
  if (!integration) return c.json({ error: "Unknown integration" }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const messageId = String(body.MessageID ?? "");
  const email = postmarkInboundToEmail(body);

  const result = (await invokeIOActionAs(await mintLaneAuthorityFor(integration.accountId, "webhook:postmark"), null, "emailWebhooks:postmarkInbound", {
    dedupKey: `inbound:${messageId}`,
    email,
    messageId,
  })) as Record<string, unknown>;

  return c.json(result);
});

export { postmarkWebhookRoutes };
