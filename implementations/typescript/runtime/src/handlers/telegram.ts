// ---------------------------------------------------------------------------
// Telegram runtime handlers — wires every `Telegram*.<method>` capability
// method to a Fenel-native HTTP call against api.telegram.org.
//
// Pattern: for each method declared on a `Telegram*` sub-capability in the
// engine, register an IO handler under `${cap.name}.${method.name}`. The
// handler reads `botId` from the call's params, resolves the bot token from
// the per-account `bots` table, makes the HTTP call, and returns the
// (camel-shaped) result.
//
// `EditResult` (Edited Message | InlineEdited Boolean) is post-processed —
// when the response is `true`/`false`, we wrap it as `InlineEdited`;
// otherwise we wrap the message as `Edited`.
//
// Rate-limit handling: when Telegram returns `parameters.retry_after`, the
// handler suspends as `waiting_timer` so the durable runtime resumes after
// the wait. Other non-ok responses throw — let the function decide how to
// recover.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import { Just } from "@fenel/engine/type-foundation";
import { findBotById } from "@fenel/db";
import { callTelegram } from "./telegram-client";
import { fromTelegramWire } from "./telegram-codec";
import { registerCollectorHandlers } from "./telegram-collector";

/** The set of method names whose responses should be wrapped as
 *  `EditResult` (i.e. `Message | Boolean` in the Telegram docs). */
const EDIT_RESULT_METHODS = new Set([
  "editMessageText",
  "editMessageCaption",
  "editMessageMedia",
  "editMessageReplyMarkup",
  "editMessageLiveLocation",
  "stopMessageLiveLocation",
  "editMessageChecklist",
  "setGameScore",
]);

/** Sub-capabilities owned by the telegram namespace. Used to scope which
 *  capability methods we wire. */
const TELEGRAM_CAPABILITIES = new Set([
  "TelegramLifecycle",
  "TelegramWebhooks",
  "TelegramMessages",
  "TelegramCallbacks",
  "TelegramMedia",
  "TelegramFiles",
  "TelegramChatAdmin",
  "TelegramBotConfig",
  "TelegramPayments",
  "TelegramInlineMode",
  "TelegramStickers",
  "TelegramPassport",
  "TelegramGames",
  "TelegramPolls",
  "TelegramForumTopics",
  "TelegramBusiness",
]);

/** Wrap a successful Telegram response into the right Fenel-typed value.
 *  For most methods this is just the camel-shaped result. For
 *  edit/setGameScore methods it's a tagged `EditResult`. */
function wrapResult(method: string, result: unknown): unknown {
  const camel = fromTelegramWire(result);
  if (EDIT_RESULT_METHODS.has(method)) {
    if (typeof camel === "boolean") {
      return { $tag: "InlineEdited", success: camel };
    }
    return { $tag: "Edited", message: camel };
  }
  return camel;
}

// `telegram_form.start` is auto-registered by `registerFenelBodyDispatchers`
// from the `telegram:startTelegramForm` Fenel function (whose body lives in
// `engine/src/modules/telegram-bodies/start-form.fenel`). No manual TS
// shim needed here.

/** Register an IO handler for every method on every `telegram_*`
 *  sub-capability in the registry. Idempotent — safe to call multiple
 *  times (the registry's `registerIOHandler` is last-write-wins). */
export function registerTelegramHandlers(reg: ModuleRegistry): void {
  registerCollectorHandlers(reg);
  for (const cap of reg.listCapabilities()) {
    if (!TELEGRAM_CAPABILITIES.has(cap.name)) continue;
    for (const method of cap.methods) {
      const qualName = `${cap.name}.${method.name}`;
      reg.registerIOHandler(qualName, async (params, ctx) => {
        const botId = params["botId"] as string | undefined;
        if (!botId) {
          throw new Error(
            `${qualName}: 'botId' param is required (which Telegram bot to call as)`,
          );
        }
        const bot = await findBotById(ctx.accountId, botId);
        if (!bot) {
          throw new Error(
            `${qualName}: no bot found for accountId=${ctx.accountId} botId=${botId}`,
          );
        }
        if (!bot.enabled) {
          throw new Error(`${qualName}: bot ${botId} is disabled`);
        }

        // Strip botId — it's a Fenel-side routing param, not part of the
        // Telegram API surface.
        const callParams: Record<string, unknown> = { ...params };
        delete callParams["botId"];

        const resp = await callTelegram(bot.token, method.name, callParams);
        if (resp.ok) {
          return { action: "continue", value: wrapResult(method.name, resp.result) };
        }

        // Honour rate limiting — suspend the durable function and let the
        // timer tick resume it after `retry_after` seconds.
        if (resp.error_code === 429 && resp.parameters?.retry_after) {
          const wakeAt = new Date(
            Date.now() + resp.parameters.retry_after * 1000,
          ).toISOString();
          return {
            action: "suspend",
            status: "waiting_timer",
            meta: Just({
              $tag: "WaitTimer",
              wakeAt,
              retryReason: Just({ $tag: "TelegramRetry", description: resp.description }),
            }),
          };
        }

        throw new Error(
          `Telegram ${method.name} failed (${resp.error_code}): ${resp.description}`,
        );
      });
    }
  }
}
