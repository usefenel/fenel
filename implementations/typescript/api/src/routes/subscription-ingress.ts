// ---------------------------------------------------------------------------
// Unified webhook ingress — POST /webhooks/sub/:slug
//
// PR-S-4 from design/subscription-unification.md. Resolves a subscription
// by its globally-unique slug, verifies the optional shared secret in
// the `X-Webhook-Secret` header, then dispatches:
//
//   - metadata.kind = "telegram_collector": delegate to the existing
//     `telegram_collector.handle_update` IO action with the inbound body.
//
//   - handlerFunctionId set: look up the functions row and invoke its
//     codeName via the IO action of the same name.
//
//   - else: 422 — the subscription is misconfigured.
//
// Phase 12c-routes sub-step 2 — wrapper handles subscription lookup (via
// state:findSubscriptionBySlug), header / body parsing (irreducible IO),
// optional secret verify; the body returns SubscriptionDispatch (3-arm
// ADT) and the wrapper switches on $tag and invokes with TS-held params.
// Mirrors 12a-5's InvokeDecision pattern (Decision T).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getDb, functions } from "@fenel/db";
import { eq } from "drizzle-orm";
import { invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";

const subscriptionIngressRoutes = new Hono();

type SubscriptionRow = {
  id: string;
  accountId: string;
  slug: string;
  source: string;
  enabled: boolean;
  secret: string | null;
  metadata: string | null;
  handlerFunctionId: string | null;
};

type SubscriptionDispatch =
  | { $tag: "TelegramCollectorDispatch"; botId: string }
  | { $tag: "UserHandlerDispatch"; fnName: string }
  | { $tag: "NoHandlerConfigured"; reason: string };

subscriptionIngressRoutes.post("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug) return c.json({ error: "slug required" }, 400);

  const subResult = (await invokeIOActionEphemeral(mintAcquisitionAuthorityFor(""), "", null, "state:findSubscriptionBySlug", {
    slug,
  })) as { $tag: "Just"; _0: SubscriptionRow } | { $tag: "Nothing" };
  if (subResult.$tag === "Nothing") return c.json({ error: "Subscription not found" }, 404);
  const sub = subResult._0;
  if (!sub.enabled) return c.json({ error: "Subscription disabled" }, 403);
  if (sub.source !== "http_webhook") {
    return c.json({ error: "Subscription does not accept HTTP webhooks" }, 400);
  }

  // Optional secret check.
  if (sub.secret) {
    const sent = c.req.header("x-webhook-secret");
    if (sent !== sub.secret) {
      return c.json({ error: "Invalid secret" }, 403);
    }
  }

  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    body = await c.req.text().catch(() => null);
  }

  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let metadata: Record<string, unknown> = {};
  if (sub.metadata) {
    try {
      const parsed = JSON.parse(sub.metadata);
      if (parsed && typeof parsed === "object") {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore — metadata is best-effort
    }
  }

  const metadataKind = typeof metadata["kind"] === "string"
    ? { $tag: "Just", _0: metadata["kind"] }
    : { $tag: "Nothing" };
  const metadataBotId = typeof metadata["botId"] === "string"
    ? { $tag: "Just", _0: metadata["botId"] }
    : { $tag: "Nothing" };

  // Resolve the user-handler function name from sub.handlerFunctionId (a row
  // id). The Fenel body reads sub.handlerFunctionName (string), so the
  // wrapper translates id → codeName here. handlerFunctionId is the
  // canonical reference; the codeName is the IO action name.
  let handlerFunctionName: { $tag: "Just"; _0: string } | { $tag: "Nothing" } = {
    $tag: "Nothing",
  };
  if (sub.handlerFunctionId) {
    const db = getDb();
    const [fnRow] = await db
      .select({ id: functions.id, name: functions.name })
      .from(functions)
      .where(eq(functions.id, sub.handlerFunctionId))
      .limit(1);
    if (fnRow) {
      handlerFunctionName = { $tag: "Just", _0: fnRow.name };
    }
  }

  const subWithHandler = {
    ...sub,
    handlerFunctionName,
  };

  const dispatch = (await invokeIOActionAs(await mintLaneAuthorityFor(sub.accountId, "subscription"), null, "subscriptions:subscriptionDispatchDecide", {
    sub: subWithHandler,
    metadataKind,
    metadataBotId,
  })) as SubscriptionDispatch;

  switch (dispatch.$tag) {
    case "TelegramCollectorDispatch":
      try {
        await invokeIOActionAs(await mintLaneAuthorityFor(sub.accountId, "subscription"), null, "telegram_collector.handle_update", {
          botId: dispatch.botId,
          update: body ?? {},
        });
        return c.json({ ok: true });
      } catch (e) {
        console.error("[subscription-ingress] telegram dispatch failed", e);
        return c.json({ error: "Dispatch failed" }, 500);
      }
    case "UserHandlerDispatch":
      try {
        const value = await invokeIOActionAs(await mintLaneAuthorityFor(sub.accountId, "subscription"), null, dispatch.fnName, {
          slug,
          body,
          headers,
        });
        return c.json({ ok: true, value });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[subscription-ingress] handler invocation failed", msg);
        return c.json({ error: msg }, 500);
      }
    case "NoHandlerConfigured":
      return c.json({ error: dispatch.reason }, 422);
    default: {
      const tag = (dispatch as { $tag: string }).$tag;
      return c.json({ error: `Unknown SubscriptionDispatch tag: ${tag}` }, 500);
    }
  }
});

export { subscriptionIngressRoutes };
