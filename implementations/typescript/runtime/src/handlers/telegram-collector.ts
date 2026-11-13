// ---------------------------------------------------------------------------
// Telegram Collector — the "runTelegramCollector" IO handler.
//
// Registers a bot with a collector config (typeId entries + optional hooks)
// and wires /start to automatically begin type-driven conversations. On
// completion, the collected values are persisted as a new instance of the
// referenced type.
//
// Usage from Fenel:
//   runTelegramCollector(botToken, [
//     { typeId: "<uuid-of-Lead-type>", label: "Apply", startFn: "myWelcome" },
//     { typeId: "<uuid-of-Support-type>", label: "Support" }
//   ])
//
// Single entry → /start auto-begins the form.
// Multiple entries → /start shows an inline keyboard picker.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FieldDef } from "@fenel/engine/types";
import type { CollectorEntry } from "@fenel/engine/modules/telegram";
import { formDefinitionFields } from "@fenel/engine";
import { resolveEvaluator } from "@fenel/engine/evaluator-class";
import { getSystemEvaluateContext } from "@fenel/engine/system-registry";
import { callTelegram } from "./telegram-client";
import { deleteTelegramWebhook } from "./telegram-webhook-delete";
import { findAccountBot } from "./telegram-bot-scope";
import type { ConversationHooks } from "./telegram-form";
import { getRuntimeAccountFieldRegistry } from "../account-field-registry";
import type { AuthorityRef } from "@fenel/engine/authority";

/** Look up a bots row by id globally (account-agnostic — botIds are unique).
 *  Phase 3b drained the direct @fenel/db read: this now routes through the
 *  state-IO leaf (state:findBotByIdGlobal), which wraps the same
 *  findBotByIdGlobal query. Returns the full row (id/token/accountId/enabled/…)
 *  or null on miss. */
/** The bot fields the collector needs. ⚠ NAMED FOR ITS SHAPE, NOT ITS SCOPE
 *  (rights R4a C1a): it was `CollectorBotRow` back when the read was global. The
 *  read is the frame account's now, and a type still called "Global" is the next
 *  session's wrong premise. */
type CollectorBotRow = { id: string; token: string; accountId: string; enabled: boolean };
/** rights R4a C1a — THE COLLECTOR READS ITS OWN ACCOUNT'S BOT, AT THE LEAF.
 *
 *  What was here: a nested `invokeIOActionAs(authority, …, "state:findBotByIdGlobal")`.
 *  That descriptor returns the GLOBAL bot row — token and webhook secret
 *  included — and it sat in every role's general row, so `telegram.ack_callback_query`
 *  relayed with ANOTHER ACCOUNT'S BOT TOKEN with no ownership check at all
 *  (`telegram-collector.ts:247` before this change; the other three checked, two
 *  of them only after the global read had already returned the secret).
 *  `state:findBotByIdGlobal` is now in `authority:discoveryDescriptors` and is
 *  therefore in NO role's envelope, so this path would refuse outright.
 *
 *  ⚠ AND THE OBVIOUS REPAIR IS THE WRONG ONE. Giving this helper an ACQUISITION
 *  authority would make the global read succeed again, the foreign-bot operation
 *  would survive the fence, and the discovery pin would still be green — which
 *  is the single most important trap in R4a §4.3. Acquisition is for INGRESS
 *  discovery, where there is no account yet. Here there IS one: the frame's.
 *  So the read is partitioned AT THE LEAF, where no envelope can widen it.
 *
 *  ⚠ AND THE READ ITSELF LIVES IN `handlers/state.ts`, not here. That file is
 *  what `audit-effects.ts`'s `direct-db-outside-leaf` rule names as "the state-IO
 *  DB leaf (the ONLY storage boundary)"; THIS file was deliberately drained of
 *  direct database access by ts-elimination-completion Phases 2-7 and is not on
 *  the allowlist. Putting the read back inline would re-grandfather a file that
 *  arc emptied, and would take the gate from 0 findings to 1.
 *
 *  ⚠ THE NAME CHANGED TOO, and deliberately: this was `findBotGlobal`, and a
 *  helper still called that would be read as global by the next session to walk
 *  past it. It is not global; it is the frame account's. */
async function findFrameAccountBot(botId: string, accountId: string): Promise<CollectorBotRow | null> {
  const { findAccountBotRowStateLeaf } = await import("./state");
  return (await findAccountBotRowStateLeaf(accountId, botId)) as CollectorBotRow | null;
}

/** Lift a TS optional (string | undefined) to a Fenel Maybe<String>. */
function maybeString(s: string | undefined | null): unknown {
  return s != null ? { $tag: "Just", _0: s } : { $tag: "Nothing" };
}

/** Project a TS hooks record to the Fenel-side shape — every optional
 *  field becomes Maybe<T>. The startTelegramForm body only consults
 *  `startFn`; the rest are persisted on the Conversation row and consumed
 *  by the routing / finalize bodies. `asDraft` is plain Boolean (no Maybe
 *  wrap) — defaults to false. (Moved here from telegram-form.ts in Phase 3b
 *  when the standalone startTelegramForm export folded into its sole
 *  caller, startCollectorEntry.) */
function lowerHooks(hooks: ConversationHooks | undefined): Record<string, unknown> {
  return {
    startFn: maybeString(hooks?.startFn),
    completionFn: maybeString(hooks?.completionFn),
    onFieldFn: maybeString(hooks?.onFieldFn),
    instanceTypeName: maybeString(hooks?.instanceTypeName),
    asDraft: hooks?.asDraft === true,
  };
}

// rights R2b — no module-scope frame. See the header note in
// `telegram-form.ts`: a captured `getSystemEvaluateContext()` carries the
// registry bootstrap authority, and every helper here has a leaf `ctx` in
// scope, so the frame is built per call with the leaf's own handle.
function fenelFrame(authority: AuthorityRef) {
  return { ...getSystemEvaluateContext(), _authority: authority };
}

/** Resolve a typeId UUID to its (typeName, fields). The typeName is what
 *  entity_instances rows are keyed by; the fields drive the form prompts.
 *  Throws when the typeId doesn't resolve, when the type isn't a $record,
 *  or when no fields can be derived.
 *
 *  Phase 11c sub-step 1b — wrapper pre-resolves the type row, calls the
 *  Fenel body telegram:resolveTypeRefDecision for the structural decision,
 *  then pattern-matches the returned variant. The ResolvedFields arm runs
 *  formDefinitionFields wrapper-side since that helper has its own
 *  TS-classifier and routing through it from inside another Fenel body would
 *  skip the marshalling.
 *
 *  Phase 3b — the row read drained from a direct @fenel/db getTypeById to the
 *  state-IO leaf state:getTypeById (the by-UUID sister of state:getType). The
 *  formDefinitionFields classifier still runs here (no Fenel form yet), but it
 *  takes the `.type` off the leaf-returned row — no DB import remains. */
async function resolveTypeRef(
  accountId: string,
  typeId: string,
  authority: AuthorityRef,
): Promise<{ typeName: string; fields: FieldDef[] }> {
  const { invokeIOActionAs } = await import("../evaluator");
  void accountId;
  const maybeRow = (await invokeIOActionAs(authority, null, "state:getTypeById", {
    typeId,
  })) as { $tag: "Just"; _0: { name?: string; type?: unknown } } | { $tag: "Nothing" };
  const frame = fenelFrame(authority);
  const decision = resolveEvaluator(frame)(
    { call: ["resolveTypeRefDecision", typeId, maybeRow] },
    {},
    frame,
  ) as { $tag: string; typeId?: string; typeName?: string };
  switch (decision.$tag) {
    case "TypeNotFound":
      throw new Error(`Type not found: ${decision.typeId}`);
    case "NotRecordType":
      throw new Error(
        `Type "${decision.typeName}" is not a record type — cannot derive form fields`,
      );
    case "ResolvedFields": {
      const typeRow = maybeRow.$tag === "Just" ? maybeRow._0 : null;
      const fields = formDefinitionFields({ type: typeRow!.type as never });
      return { typeName: decision.typeName as string, fields };
    }
    default:
      throw new Error(
        `resolveTypeRef: unexpected decision shape: ${decision.$tag}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Start a single collector entry conversation.
//
// Phase 11c sub-step 3 — `handleCollectorStart` + `handleCollectorPick` (the
// 11c retroactive-audit B2 anti-pattern handlers that owned the dispatch
// decisions TS-side) were retired here. The dispatch logic (pending-
// Confirming check, deep-link match, single-vs-multi-entry, callback index
// parse) now lives in fenel/modules/telegram/step-conversation.fenel; this
// file just exposes the irreducible IO leaves (telegram.start_collector_entry,
// telegram.send_collector_picker, telegram.ack_callback_query).
// ---------------------------------------------------------------------------

export async function startCollectorEntry(
  accountId: string,
  bot: { id: string; token: string },
  chatId: number,
  userId: number,
  entry: CollectorEntry,
  authority: AuthorityRef,
): Promise<boolean> {
  const { typeName, fields } = await resolveTypeRef(accountId, entry.typeId, authority);
  if (fields.length === 0) return false;

  const hooks: ConversationHooks = {};
  if (entry.startFn) hooks.startFn = entry.startFn;
  if (entry.completionFn) hooks.completionFn = entry.completionFn;
  if (entry.onFieldFn) hooks.onFieldFn = entry.onFieldFn;
  // Tell finalizeConversation which type to materialise the result as.
  hooks.instanceTypeName = typeName;
  // Opt-in capture-first mode — the routing + finalize bodies branch
  // on this hook to wrap field values as Either<String, T_field> and
  // materialise the conversation as Draft<typeName>.
  if (entry.asDraft) hooks.asDraft = true;

  // Kick off the form-fill conversation via the Fenel
  // `telegram:startTelegramForm` body (Phase 3b — the standalone TS
  // startTelegramForm export was retired; this is its only caller, so
  // the identical `callUserFunction` invocation lives here now). The
  // body inserts the Conversation row + sends the first prompt and
  // returns `Result String String` (Ok conversationId | Err message).
  const { callUserFunction } = await import("../evaluator");
  const result = await callUserFunction(
    "telegram:startTelegramForm",
    {
      botId: bot.id,
      chatId,
      userId,
      formId: `collector:${typeName}`,
      fields: fields as unknown[],
      intro: { $tag: "Nothing" },
      completionPayload: {},
      hooks: lowerHooks(hooks),
    },
    { accountId, profileId: "", authority },
  );
  const value = result.action === "continue" ? result.value : null;
  return (
    !!value &&
    typeof value === "object" &&
    (value as { $tag?: unknown }).$tag === "Ok"
  );
}

// ---------------------------------------------------------------------------
// IO handler registration
// ---------------------------------------------------------------------------

export function registerCollectorHandlers(reg: ModuleRegistry): void {
  // Raw-token primitives — used by Fenel orchestration before a bot
  // row exists. These don't require a botId; they take the token
  // directly and call the Telegram API.
  reg.registerIOHandler("telegram.validate_bot_token", async (params) => {
    const token = params["token"] as string | undefined;
    if (!token) {
      return {
        action: "continue",
        value: { $tag: "Err", _0: "token required" },
      };
    }
    const resp = await callTelegram(token, "getMe", {});
    if (resp.ok) {
      // Camelize the wire-shape User; Telegram returns snake_case.
      const { fromTelegramWire } = await import("./telegram-codec");
      const user = fromTelegramWire(resp.result);
      return {
        action: "continue",
        value: { $tag: "Ok", _0: user },
      };
    }
    return {
      action: "continue",
      value: {
        $tag: "Err",
        _0: `getMe failed (${resp.error_code}): ${resp.description}`,
      },
    };
  });

  // Phase 11c sub-step 3 retired `telegram.handle_collector_start_command`
  // + `telegram.handle_collector_pick_callback` handlers. Their TS-side
  // decision logic (pending-Confirming check, deep-link match, single-
  // vs-multi-entry dispatch, callback index parse) was the C2 anti-
  // pattern flagged in the Phase 11c retroactive audit; the Fenel body
  // stepConversation (fenel/modules/telegram/step-conversation.fenel)
  // now owns those decisions and dispatches to the leaf IO primitives
  // (telegram.start_collector_entry, telegram.send_collector_picker,
  // telegram.ack_callback_query) below.

  reg.registerIOHandler("telegram.ack_callback_query", async (params, ctx) => {
    // Phase 11c sub-step 4 — direct-args only. The legacy `payload`
    // record form (transitional shim added in 11c-3 during the
    // dispatch-collector-event.fenel retirement) was retired here:
    // the sole caller post-11c-3 is the Fenel `stepConversation` body,
    // which picks `botId` + `callbackQueryId` off the typed
    // CallbackQuery and passes them as direct params.
    const botId = params["botId"] as string | undefined;
    const callbackQueryId = params["callbackQueryId"] as string | undefined;
    if (!botId || !callbackQueryId) {
      return { action: "continue", value: null };
    }
    const bot = await findFrameAccountBot(botId, ctx.accountId);
    if (!bot) return { action: "continue", value: null };
    await callTelegram(bot.token, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
    }).catch(() => undefined);
    return { action: "continue", value: null };
  });

  // Phase 11c sub-step 3 — new IO leaf for the collector entry-picker
  // (multi-entry /start). The Fenel body passes the raw CollectorEntry
  // list; this leaf renders the inline_keyboard wire shape (each entry
  // becomes a row with its label as the button text + `collector:<idx>`
  // as the callback_data). Kept focused on the IO side rather than
  // splitting label/idx pairing into the body (which would need a
  // substrate `std:mapIndexed`) — Decision GG defer-provisional: full
  // typed InlineKeyboardMarkup construction in the body is queued for
  // 11c-4. The picker text "What would you like to do?" matches the
  // pre-3 TS handler verbatim.
  reg.registerIOHandler("telegram.send_collector_picker", async (params) => {
    const botToken = params["botToken"] as string | undefined;
    const chatId = params["chatId"] as number | undefined;
    const rawEntries = params["entries"];
    if (!botToken || chatId == null || !Array.isArray(rawEntries)) {
      throw new Error(
        "telegram.send_collector_picker: botToken/chatId/entries required",
      );
    }
    const buttons = (rawEntries as Array<Record<string, unknown>>).map(
      (entry, i) => [
        {
          text: String(entry["label"] ?? ""),
          callback_data: `collector:${i}`,
        },
      ],
    );
    const resp = await callTelegram(botToken, "sendMessage", {
      chat_id: chatId,
      text: "What would you like to do?",
      reply_markup: { inline_keyboard: buttons },
    });
    if (!resp.ok) {
      throw new Error(
        `sendMessage failed (${resp.error_code}): ${resp.description}`,
      );
    }
    return { action: "continue", value: null };
  });

  // Phase 11c sub-step 3 — new IO leaf wrapping the pre-existing
  // `startCollectorEntry` TS function (which itself wraps the
  // startTelegramForm form-fill orchestration leaf). The Fenel body
  // resolves the bot + entry (CollectorEntry record) + chat/user
  // ids and calls this; the leaf is irreducible IO (typeId →
  // typeName resolution + Conversation row insert + first-prompt
  // send). The pre-3 TS handler retains its name + signature for
  // shared use across the dispatch path.
  reg.registerIOHandler("telegram.start_collector_entry", async (params, ctx) => {
    const botId = params["botId"] as string | undefined;
    const chatId = params["chatId"] as number | undefined;
    const userId = params["userId"] as number | undefined;
    const entry = params["entry"] as CollectorEntry | undefined;
    if (!botId || chatId == null || userId == null || !entry) {
      throw new Error(
        "telegram.start_collector_entry: botId/chatId/userId/entry required",
      );
    }
    // rights R2a — the collector lane runs under the CALLER's authority: this
    // handler is itself reached through `perform`, so an act it performs on the
    // way is judged under the same envelope that admitted it.
    const bot = await findFrameAccountBot(botId, ctx.accountId);
    if (!bot || !bot.enabled) return { action: "continue", value: null };
    await startCollectorEntry(ctx.accountId, bot, chatId, userId, entry, ctx.authority);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("telegram.delete_webhook_by_token", async (params) => {
    return { action: "continue", value: await deleteTelegramWebhook(params["token"]) };
  });

  reg.registerIOHandler("telegram.set_webhook_by_token", async (params) => {
    const token = params["token"] as string | undefined;
    const url = params["url"] as string | undefined;
    // Secret is Maybe<String> on the Fenel side; arrives as either the
    // unwrapped string, `{ $tag: "Just", _0 }`, `{ $tag: "Nothing" }`,
    // or null/undefined depending on caller. Normalise.
    const rawSecret = params["secret"];
    let secret: string | undefined;
    if (typeof rawSecret === "string") secret = rawSecret;
    else if (
      rawSecret &&
      typeof rawSecret === "object" &&
      (rawSecret as { $tag?: unknown }).$tag === "Just"
    ) {
      secret = (rawSecret as { _0?: unknown })._0 as string | undefined;
    }
    if (!token || !url) {
      return {
        action: "continue",
        value: { $tag: "Err", _0: "token and url required" },
      };
    }
    const wireParams: Record<string, unknown> = {
      url,
      allowed_updates: ["message", "callback_query"],
    };
    if (secret) wireParams["secret_token"] = secret;
    const resp = await callTelegram(token, "setWebhook", wireParams);
    if (resp.ok) {
      return { action: "continue", value: { $tag: "Ok", _0: true } };
    }
    return {
      action: "continue",
      value: {
        $tag: "Err",
        _0: `setWebhook failed (${resp.error_code}): ${resp.description}`,
      },
    };
  });

  // Telegram primitives used by the routeTelegramMessage Fenel body.
  reg.registerIOHandler("telegram.find_bot_by_id", async (params, ctx) => {
    // Returns Maybe<Record> — the declared signature on the Fenel
    // function is `Maybe<Record>`, so the runtime wraps misses as
    // Nothing and hits as Just<value>.
    const row = await findAccountBot(ctx.accountId, params["botId"], (botId) => findFrameAccountBot(botId, ctx.accountId));
    return {
      action: "continue",
      value: row ? { $tag: "Just", _0: row } : { $tag: "Nothing" },
    };
  });
  reg.registerIOHandler("telegram.send_message_text", async (params) => {
    const botToken = params["botToken"] as string | undefined;
    const chatId = params["chatId"] as number | undefined;
    const text = params["text"] as string | undefined;
    if (!botToken || chatId == null || typeof text !== "string") {
      throw new Error("telegram.send_message_text: botToken/chatId/text required");
    }
    const resp = await callTelegram(botToken, "sendMessage", { chat_id: chatId, text });
    if (!resp.ok) {
      throw new Error(`sendMessage failed (${resp.error_code}): ${resp.description}`);
    }
    return { action: "continue", value: null };
  });
  reg.registerIOHandler("telegram.send_field_prompt", async (params, ctx) => {
    const botToken = params["botToken"] as string | undefined;
    const chatId = params["chatId"] as number | undefined;
    const field = params["field"] as Record<string, unknown> | undefined;
    if (!botToken || chatId == null || !field) {
      throw new Error("telegram.send_field_prompt: botToken/chatId/field required");
    }
    // Delegate to the existing TS prompt builder (which handles
    // enum keyboards / skip buttons). Replacing this with a fully-
    // Fenel sendFieldPrompt body is the next refinement.
    const { _internals } = await import("./telegram-form");
    const fieldRegistry = await getRuntimeAccountFieldRegistry(ctx.accountId);
    const text = _internals.promptForField(ctx.authority, field as never, fieldRegistry);
    const resp = await callTelegram(botToken, "sendMessage", { chat_id: chatId, text });
    if (!resp.ok) {
      throw new Error(`sendMessage failed (${resp.error_code}): ${resp.description}`);
    }
    return { action: "continue", value: null };
  });
  reg.registerIOHandler("telegram.send_confirmation_summary", async (params, ctx) => {
    const botToken = params["botToken"] as string | undefined;
    const chatId = params["chatId"] as number | undefined;
    const fields = params["fields"] as Array<Record<string, unknown>> | undefined;
    const values = (params["values"] as Record<string, unknown> | undefined) ?? {};
    if (!botToken || chatId == null || !Array.isArray(fields)) {
      throw new Error(
        "telegram.send_confirmation_summary: botToken/chatId/fields required",
      );
    }
    const { _internals } = await import("./telegram-form");
    const fieldRegistry = await getRuntimeAccountFieldRegistry(ctx.accountId);
    const lines = fields.map((f) => {
      const fieldName = (f as { name?: unknown }).name as string | undefined;
      const value = fieldName != null ? values[fieldName] : undefined;
      return `• ${_internals.fieldLabel(ctx.authority, f as never, fieldRegistry)}: ${_internals.formatValue(ctx.authority, value)}`;
    });
    const text = `Please confirm your answers:\n\n${lines.join("\n")}`;
    const resp = await callTelegram(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✓ Confirm", callback_data: "confirm:yes" },
            { text: "✗ Cancel", callback_data: "confirm:cancel" },
          ],
        ],
      },
    });
    if (!resp.ok) {
      throw new Error(
        `sendMessage failed (${resp.error_code}): ${resp.description}`,
      );
    }
    return { action: "continue", value: null };
  });

  // Phase 13c sub-step 1 — outbound notification IO leaf. Used by the
  // bot's NotifyTransport adapter (bot/src/transport.ts) so notify /
  // tg_dm actions deliver via the Fenel substrate rather than a grammy
  // singleton. Parses target (tg_group:N / tg_user:N / numeric / @handle
  // / raw), builds the InlineKeyboardMarkup from the NotificationButton
  // list (webapp: prefix becomes a Url button; otherwise callback_data
  // carries JSON-encoded {action, params}), and sends via callTelegram
  // sendMessage with HTML parse mode. Sister of the legacy bot/src/
  // {client,transport}.ts shape but routed through the Fenel substrate.
  reg.registerIOHandler("telegram.send_notification", async (params, ctx) => {
    const botId = params["botId"] as string | undefined;
    const target = params["target"] as string | undefined;
    const message = params["message"] as string | undefined;
    const buttons = (params["buttons"] as Array<{
      label: string;
      action: string;
      params?: Record<string, unknown>;
    }> | undefined) ?? [];
    if (!botId || !target || typeof message !== "string") {
      throw new Error(
        "telegram.send_notification: botId/target/message required",
      );
    }
    const bot = await findFrameAccountBot(botId, ctx.accountId);
    if (!bot) throw new Error(`telegram.send_notification: bot ${botId} not found`);
    if (!bot.enabled) throw new Error(`telegram.send_notification: bot ${botId} disabled`);
    if (bot.accountId !== ctx.accountId) {
      throw new Error(
        `telegram.send_notification: bot ${botId} belongs to a different account`,
      );
    }

    // Parse target — tg_group:N / tg_user:N strip prefix; numeric →
    // number (Telegram chat ids are bigints in practice, but the
    // current schema treats them as JS numbers); otherwise pass through
    // as a string (e.g. @username).
    let chatId: string | number;
    const stripped = target.startsWith("tg_group:")
      ? target.slice("tg_group:".length)
      : target.startsWith("tg_user:")
        ? target.slice("tg_user:".length)
        : target;
    const numeric = Number(stripped);
    chatId = Number.isNaN(numeric) ? stripped : numeric;

    // Build reply_markup from the NotificationButton list. One button
    // per row (matches the grammy-era shape verbatim). webapp: prefix
    // becomes a Url button; otherwise the callback_data carries the
    // JSON-encoded {action, params} payload.
    let replyMarkup: unknown = undefined;
    if (buttons.length > 0) {
      const inline_keyboard = buttons.map((btn) => {
        if (btn.action.startsWith("webapp:")) {
          return [{ text: btn.label, url: btn.action.slice("webapp:".length) }];
        }
        return [
          {
            text: btn.label,
            callback_data: JSON.stringify({
              action: btn.action,
              params: btn.params ?? {},
            }),
          },
        ];
      });
      replyMarkup = { inline_keyboard };
    }

    const callParams: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    };
    if (replyMarkup !== undefined) callParams["reply_markup"] = replyMarkup;

    const resp = await callTelegram(bot.token, "sendMessage", callParams);
    if (!resp.ok) {
      throw new Error(
        `telegram.send_notification: sendMessage failed (${resp.error_code}): ${resp.description}`,
      );
    }
    return { action: "continue", value: null };
  });

  // No `telegram_collector.handle_update` handler — the
  // handleTelegramUpdate function has a Fenel body
  // (`telegram-bodies/handle-update.fenel`) that:
  //   1. derives eventType from the update record
  //   2. dispatches to the collector engine via dispatchCollectorEvent
  //   3. dispatches to user-defined triggers via dispatchEventTriggers
  // Both #2 and #3 are themselves Fenel function calls (with TS
  // primitives at the bottom). `registerFenelBodyDispatchers`
  // auto-registers the dispatch shim.

  // No `telegram_collector.list` handler — the listTelegramCollectors
  // function has a Fenel body (`telegram-bodies/list-collectors.fenel`)
  // and `registerFenelBodyDispatchers` auto-registers the dispatch.

  // No `telegram_collector.stop` handler — the stopTelegramCollector
  // function has a Fenel body (`telegram-bodies/stop-collector.fenel`),
  // and `registerFenelBodyDispatchers` auto-registers the dispatch.

  // No `telegram_collector.run` handler here — the runTelegramCollector
  // function has a Fenel body in
  // `fenel/modules/telegram/run-collector.fenel`,
  // and `registerFenelBodyDispatchers` (in evaluator.ts) auto-registers
  // a delegating handler at this action name. Token validation,
  // typeId checking, persistence, representation registration, and
  // webhook setup all live in the body — no TS orchestration.
}

// Collector dispatch is driven by the Fenel
// `telegram:stepConversation` body
// (`fenel/modules/telegram/step-conversation.fenel`).
// The body owns the routing precedence (confirming conversation
// first, then active form-fill, then /start) and the callback-data
// prefix dispatch (confirm:/field:/collector:). Leaf TS work
// (collector picker UI, typeId resolution, callback ack, form-fill
// start) lives in the IO primitives registered above:
//   telegram.start_collector_entry
//   telegram.send_collector_picker
//   telegram.ack_callback_query
