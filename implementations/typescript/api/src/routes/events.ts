// ---------------------------------------------------------------------------
// /api/events — generic inbound event ingestion
//
// POST /api/events/inbound
//   Headers: x-fenel-inbound-token: <secret>
//   Body: { accountId, type, payload, profileId? }
//
// One endpoint that any external source (Zapier, custom integrations, future
// webhook adapters) can post to. Replaces the per-provider /webhooks/*/completed
// shape. Trigger matching and waiting-instance wakeups go through the same
// `processEvent` pipeline as in-app events.
//
// Phase 12c-routes sub-step 2 — the wrapper handles env-token gate + body
// parse (irreducible IO per Decision W), then delegates to Fenel's
// events:eventsInbound body which composes events:emitEvent (appendEvent +
// dispatchEventTriggers).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs, mintLaneAuthorityFor } from "@fenel/runtime";
import { sameSecret } from "../constant-time";

const eventRoutes = new Hono();

eventRoutes.post("/inbound", async (c) => {
  const token = c.req.header("x-fenel-inbound-token");
  const expected = process.env["INBOUND_EVENT_TOKEN"];
  if (!expected) {
    return c.json({ error: "Inbound events not configured" }, 503);
  }
  if (token === undefined || !sameSecret(token, expected)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json<{
    accountId?: string;
    type?: string;
    payload?: Record<string, unknown>;
    profileId?: string;
  }>();

  if (!body.accountId) return c.json({ error: "accountId required" }, 400);
  if (!body.type) return c.json({ error: "type required" }, 400);

  const payload = body.payload ?? {};

  const result = await invokeIOActionAs(
    await mintLaneAuthorityFor(body.accountId, "events"),
    body.profileId ?? null,
    "events:eventsInbound",
    {
      eventType: body.type,
      payload,
      profileId: body.profileId ? { $tag: "Just", _0: body.profileId } : { $tag: "Nothing" },
    },
  );

  return c.json(result as Record<string, unknown>);
});

export { eventRoutes };
