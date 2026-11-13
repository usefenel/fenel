// ---------------------------------------------------------------------------
// Telegram bot — Fenel-driver long-poll deployment.
//
// Phase 13c sub-step 1 of the ts-elimination workstream retired grammY
// entirely. Phase 14a sub-step 2 retired the NotifyTransport singleton —
// the bot process now has zero responsibility for outbound notifications.
// Outbound delivery is owned by the Fenel-bodied tg_dm action body
// (notify:sendTgDm) which dispatches telegram:sendNotification directly
// from whichever process the action runs in.
//
// The polling and webhook deployments feed the SAME Fenel-bodied dispatch
// chain — `telegramWebhookDispatch` + `handleTelegramUpdate`. The per-update
// logic lives in `fenel/modules/telegram/*.fenel`.
//
// Boot sequence:
//   1. read env (BOT_TOKEN unused — token is resolved from the Bot entity row;
//      ACCOUNT_ID required to disambiguate which Bot to start polling for)
//   2. resolve botId via state:findBotIdForAccount (fail fast on Nothing)
//   3. enter the long-poll loop until SIGINT / SIGTERM
// ---------------------------------------------------------------------------

import { invokeIOActionAs, mintLaneAuthorityFor } from "@fenel/runtime";
import { reportRepositoryFieldCatalogIdentityDeficit } from "@fenel/engine/repository-field-catalog-server";

reportRepositoryFieldCatalogIdentityDeficit();

const accountId = process.env["ACCOUNT_ID"];

if (!accountId) {
  console.error("ACCOUNT_ID environment variable is required");
  process.exit(1);
}

// Resolve botId from the registered Bot entity in this account.
const botMaybe = (await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "bot"), null, "state:findBotIdForAccount", {
  accountId,
})) as { $tag: "Just"; _0: string } | { $tag: "Nothing" };
if (botMaybe.$tag === "Nothing") {
  console.error(
    `No Bot entity registered for account ${accountId}. Register a Bot via the dashboard before starting the polling deployment.`,
  );
  process.exit(1);
}
const botId = botMaybe._0;

// Long-poll loop. Each iteration invokes the Fenel-bodied
// `telegram:pollUpdatesOnce` which long-polls getUpdates (blocks up to
// 30s on the Telegram side) and dispatches each Update through the same
// chain the webhook ingress uses.
let offset = 0;
let running = true;
process.on("SIGINT", () => {
  console.log("[bot-polling] received SIGINT, shutting down");
  running = false;
});
process.on("SIGTERM", () => {
  console.log("[bot-polling] received SIGTERM, shutting down");
  running = false;
});

console.log(`[bot-polling] starting long-poll loop for bot ${botId}`);
while (running) {
  try {
    const result = (await invokeIOActionAs(await mintLaneAuthorityFor(accountId, "bot"), null, "telegram:pollUpdatesOnce", {
      botId,
      accountId,
      offset,
    })) as { nextOffset: number };
    offset = result.nextOffset;
  } catch (e) {
    console.error("[bot-polling] iteration failed", e);
    // Brief backoff so a transient failure doesn't spin the CPU.
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log("[bot-polling] shutdown complete");
