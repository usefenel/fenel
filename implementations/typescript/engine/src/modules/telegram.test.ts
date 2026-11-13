import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { telegramModule } from "./telegram";
import { Maybe } from "../type-foundation";
const reg = createRegistry([stdModule, telegramModule]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("telegram module — entity registration", () => {
  it("registers ChatRef as a variant with two cases", () => {
    const ent = reg.getEntity("ChatRef");
    const variantCases = (ent!.type as any).$variant.cases;
    expect(Array.isArray(variantCases)).toBe(true);
    const cases = variantCases.map((c: any) => c.name);
    expect(cases).toEqual(["ById", "ByUsername"]);
  });

  it("registers ParseMode as a three-way enum", () => {
    const ent = reg.getEntity("ParseMode");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["MarkdownV2", "HTML", "LegacyMarkdown"]);
  });

  it("registers ChatType as a four-way enum", () => {
    const ent = reg.getEntity("ChatType");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["Private", "Group", "Supergroup", "Channel"]);
  });

  it("registers User with the expected fields", () => {
    const ent = reg.getEntity("User");
    const recordFields = (ent!.type as any).$record.fields;
    expect(Array.isArray(recordFields)).toBe(true);
    const fields = recordFields.map((f: any) => f.name);
    expect(fields).toContain("id");
    expect(fields).toContain("isBot");
    expect(fields).toContain("firstName");
    expect(fields).toContain("username");
  });

  it("registers Chat with id of type ChatRef", () => {
    const ent = reg.getEntity("Chat");
    const fields = (ent!.type as any).$record.fields;
    const idField = fields.find((f: any) => f.name === "id");
    expect(idField.type).toEqual({ $ref: "ChatRef" });
  });

  it("registers Message as a record with replyToMessage being recursive", () => {
    const ent = reg.getEntity("Message");
    const fields = (ent!.type as any).$record.fields;
    const replyField = fields.find((f: any) => f.name === "replyToMessage");
    expect(replyField.type).toEqual(Maybe({ $ref: "Message" }));
  });

  it("registers ReplyMarkup as a four-way variant", () => {
    const ent = reg.getEntity("ReplyMarkup");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["Inline", "Reply", "Remove", "Force"]);
  });

  it("registers InputFile with three variants", () => {
    const ent = reg.getEntity("InputFile");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["ByPath", "ByUrl", "ByFileId"]);
  });

  it("registers EditResult as a sum of Edited | InlineEdited", () => {
    const ent = reg.getEntity("EditResult");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["Edited", "InlineEdited"]);
  });

  it("registers Update with all 24 official variants plus an UnknownUpdate catchall", () => {
    const ent = reg.getEntity("Update");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases.length).toBe(25);
    expect(cases).toContain("MessageUpdate");
    expect(cases).toContain("CallbackQueryUpdate");
    expect(cases).toContain("BusinessConnectionUpdate");
    expect(cases).toContain("UnknownUpdate");
  });

  it("registers WebhookInfo as a record", () => {
    const ent = reg.getEntity("WebhookInfo");
    const fields = (ent!.type as any).$record.fields.map((f: any) => f.name);
    expect(fields).toContain("url");
    expect(fields).toContain("pendingUpdateCount");
    expect(fields).toContain("hasCustomCertificate");
  });
});

describe("telegram module — capability registration", () => {
  it("registers all eight sub-capabilities", () => {
    for (const name of [
      "TelegramLifecycle",
      "TelegramWebhooks",
      "TelegramMessages",
      "TelegramCallbacks",
      "TelegramMedia",
      "TelegramFiles",
      "TelegramChatAdmin",
      "TelegramBotConfig",
    ]) {
      expect(reg.getCapability(name), name).toBeTruthy();
    }
  });

  it("telegram_lifecycle exposes getMe / logOut / close", () => {
    const cap = reg.getCapability("TelegramLifecycle");
    expect(cap!.methods.map((m) => m.name)).toEqual(["getMe", "logOut", "close"]);
  });

  it("telegram_webhooks exposes the four polling/webhook methods", () => {
    const cap = reg.getCapability("TelegramWebhooks");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "getUpdates", "setWebhook", "deleteWebhook", "getWebhookInfo",
    ]);
  });

  it("telegram_messages exposes P1 + P2 message ops", () => {
    const cap = reg.getCapability("TelegramMessages");
    const names = cap!.methods.map((m) => m.name);
    // P1
    expect(names).toContain("sendMessage");
    expect(names).toContain("editMessageText");
    expect(names).toContain("deleteMessage");
    // P2 additions
    expect(names).toContain("forwardMessage");
    expect(names).toContain("copyMessage");
    expect(names).toContain("editMessageMedia");
    expect(names).toContain("setMessageReaction");
    expect(names).toContain("sendChatAction");
  });

  it("telegram_callbacks exposes answerCallbackQuery", () => {
    const cap = reg.getCapability("TelegramCallbacks");
    expect(cap!.methods.map((m) => m.name)).toEqual(["answerCallbackQuery"]);
  });

  it("telegram_media covers all 11 media-sending methods", () => {
    const cap = reg.getCapability("TelegramMedia");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "sendPhoto", "sendAudio", "sendDocument", "sendVideo", "sendAnimation",
      "sendVoice", "sendVideoNote", "sendMediaGroup",
      "sendLocation", "sendVenue", "sendContact",
    ]);
  });

  it("telegram_files exposes getFile and getUserProfilePhotos", () => {
    const cap = reg.getCapability("TelegramFiles");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "getFile", "getUserProfilePhotos",
    ]);
  });

  it("telegram_chat_admin exposes member ops + invite ops + chat info", () => {
    const cap = reg.getCapability("TelegramChatAdmin");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("banChatMember");
    expect(names).toContain("unbanChatMember");
    expect(names).toContain("promoteChatMember");
    expect(names).toContain("createChatInviteLink");
    expect(names).toContain("approveChatJoinRequest");
    expect(names).toContain("getChat");
    expect(names).toContain("getChatMember");
  });

  it("telegram_bot_config covers commands, name, descriptions, menu", () => {
    const cap = reg.getCapability("TelegramBotConfig");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("setMyCommands");
    expect(names).toContain("getMyCommands");
    expect(names).toContain("setMyName");
    expect(names).toContain("setMyDescription");
    expect(names).toContain("setMyShortDescription");
    expect(names).toContain("setChatMenuButton");
  });

  it("static instance registers `bot` as the only telegram_messages target", () => {
    // Phase 10a-5d-followup-2: providers and instances unified — the
    // module's `botCapabilityInstance("TelegramMessages", …)` registration
    // (single-shape, `args: ["Bot"]`, `botId` as a per-method param) now
    // surfaces through `listProviders` since the legacy provider/instance
    // distinction collapses through the dispatchRegistry. The pre-change
    // expectation (`expect(...).toEqual([])`) asserted the legacy
    // mod.providers-vs-mod.instances split; the new shape asserts the
    // exact instance the module ships.
    const provs = reg.listProviders("TelegramMessages");
    expect(provs.map((p) => p.args)).toEqual([["Bot"]]);
  });
});

describe("telegram module — P2 entity registration", () => {
  it("registers PhotoSize / Animation / Audio / Document / Video / Voice / VideoNote", () => {
    for (const name of ["PhotoSize", "Animation", "Audio", "Document", "Video", "Voice", "VideoNote"]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers ChatMember as a six-way variant", () => {
    const ent = reg.getEntity("ChatMember");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "MemberCreator", "MemberAdministrator", "MemberRegular",
      "MemberRestricted", "MemberLeft", "MemberBanned",
    ]);
  });

  it("registers BotCommandScope as a seven-way variant", () => {
    const ent = reg.getEntity("BotCommandScope");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "ScopeDefault", "ScopeAllPrivateChats", "ScopeAllGroupChats",
      "ScopeAllChatAdministrators", "ScopeChat", "ScopeChatAdministrators",
      "ScopeChatMember",
    ]);
  });

  it("registers MenuButton as a three-way variant", () => {
    const ent = reg.getEntity("MenuButton");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["MenuButtonCommands", "MenuButtonWebApp", "MenuButtonDefault"]);
  });

  it("registers ReactionType as Emoji | CustomEmoji", () => {
    const ent = reg.getEntity("ReactionType");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["ReactionEmoji", "ReactionCustomEmoji"]);
  });

  it("registers InputMedia as a five-way variant", () => {
    const ent = reg.getEntity("InputMedia");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "MediaPhoto", "MediaVideo", "MediaAnimation", "MediaAudio", "MediaDocument",
    ]);
  });

  it("registers ChatAction with all 11 action variants", () => {
    const ent = reg.getEntity("ChatAction");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "Typing", "UploadPhoto", "RecordVideo", "UploadVideo",
      "RecordVoice", "UploadVoice", "UploadDocument", "ChooseSticker",
      "FindLocation", "RecordVideoNote", "UploadVideoNote",
    ]);
  });

  it("registers ChatPermissions / ChatAdministratorRights / ChatInviteLink", () => {
    expect(reg.getEntity("ChatPermissions")).toBeTruthy();
    expect(reg.getEntity("ChatAdministratorRights")).toBeTruthy();
    expect(reg.getEntity("ChatInviteLink")).toBeTruthy();
  });

  it("registers ChatFullInfo as a record extending Chat with additional fields", () => {
    const ent = reg.getEntity("ChatFullInfo");
    const fields = (ent!.type as any).$record.fields.map((f: any) => f.name);
    expect(fields).toContain("photo");
    expect(fields).toContain("description");
    expect(fields).toContain("permissions");
    expect(fields).toContain("pinnedMessage");
  });
});

describe("telegram module — P3 entity registration", () => {
  it("registers payment objects (LabeledPrice, Invoice, ShippingAddress, OrderInfo, ShippingOption)", () => {
    for (const name of [
      "LabeledPrice", "Invoice", "ShippingAddress", "OrderInfo", "ShippingOption",
      "SuccessfulPayment", "RefundedPayment",
    ]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers Stars-related types (StarAmount, StarTransaction, StarTransactions, TransactionPartner)", () => {
    for (const name of ["StarAmount", "StarTransaction", "StarTransactions", "TransactionPartner"]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers TransactionPartner as a 7-way variant", () => {
    const ent = reg.getEntity("TransactionPartner");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "PartnerUser", "PartnerChatBoost", "PartnerAffiliateProgram",
      "PartnerFragment", "PartnerTelegramAds", "PartnerTelegramApi", "PartnerOther",
    ]);
  });

  it("registers InlineQueryResult as a 20-way variant covering every inline result type", () => {
    const ent = reg.getEntity("InlineQueryResult");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases.length).toBe(20);
    expect(cases).toContain("ResultArticle");
    expect(cases).toContain("ResultPhoto");
    expect(cases).toContain("ResultGame");
    expect(cases).toContain("ResultCachedSticker");
    expect(cases).toContain("ResultCachedVoice");
  });

  it("registers InputMessageContent as a 5-way variant", () => {
    const ent = reg.getEntity("InputMessageContent");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "ContentText", "ContentLocation", "ContentVenue", "ContentContact", "ContentInvoice",
    ]);
  });

  it("registers PassportElementError with all 9 error variants", () => {
    const ent = reg.getEntity("PassportElementError");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases.length).toBe(9);
    expect(cases).toContain("PassportErrorData");
    expect(cases).toContain("PassportErrorFiles");
    expect(cases).toContain("PassportErrorTranslationFile");
    expect(cases).toContain("PassportErrorUnspecified");
  });

  it("registers Sticker / StickerSet / MaskPosition / InputSticker", () => {
    for (const name of ["Sticker", "StickerSet", "MaskPosition", "InputSticker"]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers Poll, PollOption, InputPollOption, PollAnswer, Dice, Checklist, InputChecklist, ChecklistTask", () => {
    for (const name of [
      "Poll", "PollOption", "InputPollOption", "PollAnswer", "Dice",
      "Checklist", "InputChecklist", "ChecklistTask", "InputChecklistTask",
    ]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers Game and GameHighScore", () => {
    expect(reg.getEntity("Game")).toBeTruthy();
    expect(reg.getEntity("GameHighScore")).toBeTruthy();
  });

  it("registers business + gifts + stories types", () => {
    for (const name of [
      "BusinessConnection", "BusinessMessagesDeleted", "Birthdate",
      "Gift", "Gifts", "AcceptedGiftTypes", "UniqueGift", "UniqueGiftModel", "UniqueGiftColors",
      "Story", "StoryArea", "StoryAreaPosition", "StoryAreaType", "InputStoryContent",
    ]) {
      expect(reg.getEntity(name), name).toBeTruthy();
    }
  });

  it("registers StoryAreaType as a 5-way variant", () => {
    const ent = reg.getEntity("StoryAreaType");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "AreaLocation", "AreaSuggestedReaction", "AreaLink", "AreaWeather", "AreaUniqueGift",
    ]);
  });

  it("registers ForumTopic", () => {
    expect(reg.getEntity("ForumTopic")).toBeTruthy();
  });

  it("registers RevenueWithdrawalState as a 3-way variant", () => {
    const ent = reg.getEntity("RevenueWithdrawalState");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["WithdrawalPending", "WithdrawalSucceeded", "WithdrawalFailed"]);
  });
});

describe("telegram module — P3 capabilities", () => {
  it("telegram_payments covers invoice, shipping, pre-checkout, stars", () => {
    const cap = reg.getCapability("TelegramPayments");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("sendInvoice");
    expect(names).toContain("createInvoiceLink");
    expect(names).toContain("answerShippingQuery");
    expect(names).toContain("answerPreCheckoutQuery");
    expect(names).toContain("getMyStarBalance");
    expect(names).toContain("getStarTransactions");
    expect(names).toContain("refundStarPayment");
  });

  it("telegram_inline_mode covers answerInlineQuery + savePreparedInlineMessage", () => {
    const cap = reg.getCapability("TelegramInlineMode");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "answerInlineQuery", "answerWebAppQuery", "savePreparedInlineMessage",
    ]);
  });

  it("telegram_stickers covers all 16 sticker management ops", () => {
    const cap = reg.getCapability("TelegramStickers");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("sendSticker");
    expect(names).toContain("getStickerSet");
    expect(names).toContain("createNewStickerSet");
    expect(names).toContain("addStickerToSet");
    expect(names).toContain("replaceStickerInSet");
    expect(names).toContain("setStickerEmojiList");
    expect(names).toContain("setStickerKeywords");
    expect(names).toContain("deleteStickerSet");
    expect(names.length).toBeGreaterThanOrEqual(16);
  });

  it("telegram_passport exposes setPassportDataErrors", () => {
    const cap = reg.getCapability("TelegramPassport");
    expect(cap!.methods.map((m) => m.name)).toEqual(["setPassportDataErrors"]);
  });

  it("telegram_games covers sendGame / setGameScore / getGameHighScores", () => {
    const cap = reg.getCapability("TelegramGames");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "sendGame", "setGameScore", "getGameHighScores",
    ]);
  });

  it("telegram_polls covers sendPoll, stopPoll, sendDice, sendChecklist, editMessageChecklist", () => {
    const cap = reg.getCapability("TelegramPolls");
    expect(cap!.methods.map((m) => m.name)).toEqual([
      "sendPoll", "stopPoll", "sendDice", "sendChecklist", "editMessageChecklist",
    ]);
  });

  it("telegram_forum_topics covers create / edit / close / reopen / delete + general-topic ops", () => {
    const cap = reg.getCapability("TelegramForumTopics");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("createForumTopic");
    expect(names).toContain("editForumTopic");
    expect(names).toContain("closeForumTopic");
    expect(names).toContain("reopenForumTopic");
    expect(names).toContain("deleteForumTopic");
    expect(names).toContain("editGeneralForumTopic");
    expect(names).toContain("hideGeneralForumTopic");
  });

  it("telegram_business covers business account, gifts, stories, verification", () => {
    const cap = reg.getCapability("TelegramBusiness");
    const names = cap!.methods.map((m) => m.name);
    expect(names).toContain("getBusinessConnection");
    expect(names).toContain("setBusinessAccountName");
    expect(names).toContain("getAvailableGifts");
    expect(names).toContain("sendGift");
    expect(names).toContain("verifyUser");
    expect(names).toContain("verifyChat");
    expect(names).toContain("postStory");
    expect(names).toContain("editStory");
    expect(names).toContain("deleteStory");
  });
});

describe("telegram module — type-level capability instances", () => {
  const capabilityClassNames = [
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
  ];

  const moduleInstances = telegramModule.instances ?? [];

  it("ships exactly one instance per capability, all keyed on the type 'Bot'", () => {
    for (const typeName of capabilityClassNames) {
      const matches = moduleInstances.filter((i) => i.typeName === typeName);
      expect(matches.length).toBe(1);
      expect(matches[0]!.args).toEqual(["Bot"]);
    }
  });

  it("each method takes botId as its first parameter (Id<Bot>)", () => {
    const messagesInstance = moduleInstances.find(
      (i) => i.typeName === "TelegramMessages",
    );
    const sendSpec = messagesInstance!.methods.sendMessage as {
      name: string;
      params: { name: string; type: unknown }[];
    };
    expect(sendSpec.name).toBe("TelegramMessages.sendMessage");
    // Phase 3o.3 — TelegramMessages is now `.fenel`-sourced (seedFromType), so
    // its param NAMES re-index to `_0,_1,…` (param names are not runtime-load-
    // bearing — Surprise #40; dispatch reads names from the io-leaf sigs). The
    // botId-FIRST order + its type are what's load-bearing: param 0 is the
    // registered `BotId` named type (= Id<Bot>), authored botId-first in
    // capability.fenel — referenced by name, not the inline `$tagged` shape.
    expect(sendSpec.params[0]!.name).toBe("_0");
    expect(sendSpec.params[0]!.type).toEqual({ $ref: "BotId" });
  });

  it("dispatch route is <typeName>.<method> — matches auto-registered handlers", () => {
    const lifecycle = moduleInstances.find(
      (i) => i.typeName === "TelegramLifecycle",
    );
    const getMe = lifecycle!.methods.getMe as { name: string };
    expect(getMe.name).toBe("TelegramLifecycle.getMe");
  });
});

describe("telegram module — natives", () => {
  it("escapeMarkdownV2 backslash-escapes the reserved characters", () => {
    expect(call("escapeMarkdownV2", "Hello *world*!")).toBe(
      "Hello \\*world\\*\\!",
    );
  });

  it("escapeMarkdownV2 escapes all 18 reserved characters", () => {
    const reserved = "_*[]()~`>#+-=|{}.!";
    const escaped = call("escapeMarkdownV2", reserved) as string;
    // Each char gets a backslash prefix → length doubles.
    expect(escaped.length).toBe(reserved.length * 2);
  });

  it("escapeMarkdownV2 leaves plain text alone", () => {
    expect(call("escapeMarkdownV2", "Just words 123 abc")).toBe(
      "Just words 123 abc",
    );
  });

  // parseCommand is declared `returns: Maybe { name, args }` — the
  // Fenel-callable view wraps in Just/Nothing.
  it("parseCommand recognises /cmd args", () => {
    expect(call("parseCommand", "/start hello world")).toEqual({
      $tag: "Just",
      _0: { name: "start", args: ["hello", "world"] },
    });
  });

  it("parseCommand handles /cmd@botname forms", () => {
    expect(call("parseCommand", "/help@FenelBot")).toEqual({
      $tag: "Just",
      _0: { name: "help", args: [] },
    });
  });

  it("parseCommand is Nothing for non-command text", () => {
    expect(call("parseCommand", "just a message")).toEqual({ $tag: "Nothing" });
  });

  it("parseCommand is Nothing for empty input", () => {
    expect(call("parseCommand", "")).toEqual({ $tag: "Nothing" });
  });

  it("deepLink builds a t.me/<handle> URL by default", () => {
    expect(call("deepLink", "FenelBot", "user", "")).toBe("https://t.me/FenelBot");
  });

  it("deepLink strips a leading @ from the handle", () => {
    expect(call("deepLink", "@FenelBot", "user", "")).toBe("https://t.me/FenelBot");
  });

  it("deepLink with kind=bot_start appends ?start=<payload>", () => {
    expect(call("deepLink", "FenelBot", "bot_start", "abc123")).toBe(
      "https://t.me/FenelBot?start=abc123",
    );
  });

  it("deepLink URL-encodes the start payload", () => {
    expect(call("deepLink", "FenelBot", "bot_start", "a b/c")).toBe(
      "https://t.me/FenelBot?start=a%20b%2Fc",
    );
  });

  it("deepLink with kind=bot_start but empty payload skips the query", () => {
    expect(call("deepLink", "FenelBot", "bot_start", "")).toBe("https://t.me/FenelBot");
  });
});

describe("telegram module — module shape", () => {
  it("exports name and label", () => {
    expect(telegramModule.name).toBe("telegram");
    expect(telegramModule.label).toBe("Telegram");
  });

  it("declares no static provider rows beyond per-bot instances", () => {
    // Phase 10a-5d-followup-2: legacy `mod.providers` slot retired —
    // providers are SpecInstances registered into `dispatchRegistry`
    // (see `botCapabilityInstances` for the per-capability shapes).
    // The module's instances slot carries them now; no separate
    // providers slot. The "lifecycle/webhooks/messages/…" capability
    // assertions live on the registry surface below.
    expect(reg.getCapability("TelegramLifecycle")).toBeTruthy();
  });

  it("registers sixteen capabilities", () => {
    // Phase 10a-5d-followup-2: capability registration moved from the
    // module's `capabilities` slot into per-module exported consts
    // (see `telegramCapabilities` in modules/telegram.ts) that
    // system-entities.ts dispatches into the shared dispatchRegistry.
    // The assertion now reads the registry surface directly.
    for (const name of [
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
    ]) {
      expect(reg.getCapability(name), name).toBeTruthy();
    }
  });

  it("native function ids are prefixed fn:telegram:", () => {
    const ids = (telegramModule.functions ?? []).map((f) => f.id);
    expect(ids).toContain("telegram:escapeMarkdownV2");
    expect(ids).toContain("telegram:parseCommand");
    expect(ids).toContain("telegram:deepLink");
  });
});

// ---------------------------------------------------------------------------
// Type introspection — Maybe peeling
//
// `innerType` / `isOptionalField` / `enumValues` operate on FenelType
// objects at runtime. The canonical Maybe shape is
// `$variant { Nothing | Just { value: T } }`.
// ---------------------------------------------------------------------------

describe("telegram type introspection — Maybe", () => {
  const T = { $ref: "String" } as const;

  it("innerType peels Maybe", () => {
    expect(call("innerType", Maybe(T))).toEqual(T);
  });
  it("innerType returns a non-Maybe type unchanged", () => {
    expect(call("innerType", T)).toEqual(T);
  });

  it("isOptionalField is true for Maybe-typed fields", () => {
    expect(call("isOptionalField", { type: Maybe(T) })).toBe(true);
  });
  it("isOptionalField is false for plain named types", () => {
    expect(call("isOptionalField", { type: T })).toBe(false);
  });

  const refinedEnum = { $refined: { base: T, set: { $tag: "SeEnum" as const, values: ["a", "b", "c"] } } };
  it("enumValues sees through a Maybe wrapper", () => {
    expect(call("enumValues", Maybe(refinedEnum))).toEqual(["a", "b", "c"]);
  });
});
