// ---------------------------------------------------------------------------
// /webhooks/telegram/:botId — inbound Telegram update intake.
//
// Configured per-bot via setWebhook with a secret_token. Telegram echoes
// that token in `X-Telegram-Bot-Api-Secret-Token` on every POST; we verify
// it before doing anything else.
//
// Phase 11c sub-step 3 — the route is a verify → fromTelegramWire →
// invoke Fenel shim. The Fenel-side handleTelegramUpdate body decodes the
// JsonValue payload via codec:decodeUpdate then dispatches to
// stepConversation (typed Update dispatch) + dispatchEventTriggers.
//
// Phase 12c-routes sub-step 2 — the umbrella `telegram.update` event
// emission moves into Fenel via telegram:telegramWebhookDispatch (which
// composes events:emitEvent). The bot/subscription lookups + secret
// verify now route through Fenel substrate primitives
// (state:findBotByIdGlobal + state:findSubscriptionBySlug +
// crypto:verifyTelegramSecret).
//
// The route immediately returns `{ ok: true }` to Telegram — slow
// processing must not block the webhook acknowledgement. Decode failures
// inside the Fenel body are logged + the update is silently dropped.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { fromTelegramWire, invokeIOActionAs, invokeIOActionEphemeral, mintAcquisitionAuthorityFor, mintLaneAuthorityFor } from "@fenel/runtime";

const telegramWebhookRoutes = new Hono();

type BotRow = {
  id: string;
  accountId: string;
  enabled: boolean;
  webhookSecret: string | null;
};

type SubscriptionRow = {
  secret: string | null;
};

telegramWebhookRoutes.post("/:botId", async (c) => {
  const botId = c.req.param("botId");
  if (!botId) return c.json({ error: "botId required" }, 400);

  const acquire = mintAcquisitionAuthorityFor("");
  const botMaybe = (await invokeIOActionEphemeral(acquire, "", null, "state:findBotByIdGlobal", {
    botId,
  })) as { $tag: "Just"; _0: BotRow } | { $tag: "Nothing" };
  if (botMaybe.$tag === "Nothing") return c.json({ error: "Unknown or disabled bot" }, 404);
  const bot = botMaybe._0;
  if (!bot.enabled) return c.json({ error: "Unknown or disabled bot" }, 404);

  // Telegram echoes the configured secret in this header. Verify it
  // against the bot's subscription row (`tg-bot-<botId>`) — falling back
  // to the legacy `bots.webhook_secret` column during the migration
  // window.
  const subMaybe = (await invokeIOActionEphemeral(acquire, "", null, "state:findSubscriptionBySlug", {
    slug: `tg-bot-${bot.id}`,
  })) as { $tag: "Just"; _0: SubscriptionRow } | { $tag: "Nothing" };
  const expectedSecret =
    (subMaybe.$tag === "Just" ? subMaybe._0.secret : null) ?? bot.webhookSecret;
  if (!expectedSecret) {
    return c.json({ error: "Bot not configured for webhook" }, 403);
  }
  const sentSecret = c.req.header("x-telegram-bot-api-secret-token");
  if (!sentSecret) return c.json({ error: "Invalid secret" }, 403);
  const ok = (await invokeIOActionEphemeral(acquire, "", null, "crypto:verifyTelegramSecret", {
    sentToken: sentSecret,
    expectedToken: expectedSecret,
  })) as boolean;
  if (!ok) return c.json({ error: "Invalid secret" }, 403);

  let raw: Record<string, unknown>;
  try {
    raw = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const update = fromTelegramWire(raw) as Record<string, unknown>;

  // Umbrella event — `telegram.update` — every Telegram POST fires this
  // via the Fenel body which composes events:emitEvent.
  await invokeIOActionAs(await mintLaneAuthorityFor(bot.accountId, "webhook:telegram"), null, "telegram:telegramWebhookDispatch", {
    botId: bot.id,
    update,
  });

  try {
    await invokeIOActionAs(await mintLaneAuthorityFor(bot.accountId, "webhook:telegram"), null, "telegram_collector.handle_update", {
      botId: bot.id,
      updateJson: update,
      accountId: bot.accountId,
    });
  } catch (e) {
    console.error("[telegram-webhook] handle_update failed", e);
  }

  return c.json({ ok: true });
});

export { telegramWebhookRoutes };
