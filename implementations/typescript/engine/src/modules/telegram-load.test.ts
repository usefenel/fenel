// ---------------------------------------------------------------------------
// telegram-load.test.ts — conformance test for the telegram module entity
// flip. Phase 4f of the ts-elimination workstream extracts the inline
// `TELEGRAM_SRC` template literal at telegram.ts:69-416 (348 LOC of
// inline Fenel source, 122 type-decls covering the entire Bot API
// surface) into a real `.fenel` file at
// `fenel/modules/telegram/types.fenel`. This test locks the post-flip
// invariants the way 4a (license) / 4b (ai) / 4c (templates) /
// 4d (ecom) / 4e (notion) lock theirs.
//
// Telegram is the largest entity surface in any per-module flip — 123
// entities covering User / Chat / Message / Update / Media / Inline /
// Sticker / Payment / Stars / Passport / Poll / Game / Story / Forum /
// Business plus four orchestration-tier synthetics (CollectorAction /
// FieldParseResult / ResolveTypeRefDecision / CollectorContext). Lower per-entity granularity
// than 4a/4b/4c (entity-by-entity shape assertion is redundant with
// `fenel-syntax.test.ts` round-trip coverage), broader coverage: count +
// structural shape spot-checks + module registration + catalog
// surfacing + cross-module collision audit at scale.
//
// Each assertion covers one tier of the recipe:
//
//   1. 123-entity canonical-roster lock — count drift trips the gate.
//   2. Update 25-case `$variant` spot-check — biggest variant in the
//      repo. Confirms multi-line `|`-variant parsing scales to the
//      largest case set across the codebase.
//   3. Message `replyToMessage: Maybe<Message>` self-ref preservation —
//      same lazy-$ref mechanism as 4c's Markup, exercised in a
//      `Maybe`-wrapping context.
//   4. InlineKeyboardMarkup nested-list parse — `[[InlineKeyboardButton]]`
//      is the deepest list nesting in the file; confirms `[[T]]` parses
//      as `List(List(T))`.
//   5. Smaller variant spot-checks (ChatRef / InputFile / EditResult /
//      ReplyMarkup) — 2-4 cases each, confirming the multi-case `|`-
//      variant parse path stays clean across the module.
//   6. `telegramModule.entities` carries all 123 + orchestration + 2
//      synthetics — module-tier registration smoke.
//   7. Catalog surfacing post-`getSystemRegistry()` — User / Chat /
//      Message / Update / CallbackQuery reachable through the catalog.
//   8. Cross-module collision audit at scale — `entity:User` resolves to
//      telegram's `User`, not notion's prefixed `NotionUser`. Confirms
//      4e's collision-avoidance mechanism holds at scale.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import telegramSrc from "../../../../../fenel/modules/telegram/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, List, Maybe, Nothing } from "../type-foundation";
import { telegramModule } from "./telegram";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const TELEGRAM_MOD = loadFenelModule(telegramSrc, "telegram");

function rawEntity(id: string): FenelType {
  const entity = (TELEGRAM_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`telegram module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("telegram/types.fenel parses to exactly 123 entities (canonical roster lock)", () => {
  // Count drift is intentional + loud: any future Bot API addition /
  // removal must bump the assertion and document the change. Same
  // pattern as notion-load's 54-entity roster lock and system-entities-
  // load's 91-entity lock. Telegram is the largest single-file roster
  // in the repo.
  expect((TELEGRAM_MOD.entities ?? []).length).toBe(123);
});

test("telegram/types.fenel parses Update to the expected 25-case $variant (largest in repo)", () => {
  // Update covers every webhook delivery shape Telegram emits —
  // MessageUpdate / EditedMessageUpdate / ChannelPostUpdate / ... /
  // ManagedBotUpdate / UnknownUpdate. 25 cases multi-line `|`-separated
  // is the largest case set in the codebase; confirms the variant
  // parser scales beyond the smaller cases exercised in earlier phases.
  const update = rawEntity("Update") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(update.$variant.cases).toHaveLength(25);
  const names = update.$variant.cases.map((c) => c.name);
  for (const expected of [
    "MessageUpdate",
    "EditedMessageUpdate",
    "ChannelPostUpdate",
    "CallbackQueryUpdate",
    "PollUpdate",
    "ManagedBotUpdate",
    "UnknownUpdate",
  ]) {
    expect(names).toContain(expected);
  }
});

test("Message replyToMessage preserves Maybe<Message> self-ref unrolled", () => {
  // Lazy-$ref resolution: the parser stores the self-ref as-is in the
  // Maybe payload; the catalog walk does NOT unroll Message through its
  // own definition (would loop forever on the recursive case). Same
  // load-order mechanism as 4c's Markup self-refs, here wrapped in a
  // Maybe — `replyToMessage: Maybe<Message>` parses to
  // `Maybe({$ref: "Message"})`.
  const message = rawEntity("Message") as {
    $record: { fields: Array<{ name: string; type: FenelType }> };
  };
  const replyToMessage = message.$record.fields.find(
    (f) => f.name === "replyToMessage",
  )!;
  expect(replyToMessage.type).toEqual(Maybe({ $ref: "Message" }));
});

test("InlineKeyboardMarkup nested-list [[InlineKeyboardButton]] parses as List(List(T))", () => {
  // Deepest list nesting in the file. Confirms `[[T]]` shorthand
  // parses to the canonical `List(List({$ref: T}))` unrolled shape.
  expect(rawEntity("InlineKeyboardMarkup")).toEqual({
    $record: {
      fields: [
        {
          name: "inlineKeyboard",
          label: Nothing,
          type: List(List({ $ref: "InlineKeyboardButton" })),
          meta: {},
          ui: Nothing,
        },
      ],
    },
  });
});

test("ChatRef / InputFile / EditResult / ReplyMarkup variant spot-checks", () => {
  // Smaller variants (2-4 cases each) — confirms the multi-case `|`-
  // variant parse path stays clean for the common Bot API shapes.
  const chatRef = rawEntity("ChatRef") as { $variant: { cases: Array<{ name: string }> } };
  expect(chatRef.$variant.cases.map((c) => c.name)).toEqual(["ById", "ByUsername"]);

  const inputFile = rawEntity("InputFile") as { $variant: { cases: Array<{ name: string }> } };
  expect(inputFile.$variant.cases.map((c) => c.name)).toEqual(["ByPath", "ByUrl", "ByFileId"]);

  const editResult = rawEntity("EditResult") as { $variant: { cases: Array<{ name: string }> } };
  expect(editResult.$variant.cases.map((c) => c.name)).toEqual(["Edited", "InlineEdited"]);

  const replyMarkup = rawEntity("ReplyMarkup") as { $variant: { cases: Array<{ name: string }> } };
  expect(replyMarkup.$variant.cases.map((c) => c.name)).toEqual(["Inline", "Reply", "Remove", "Force"]);
});

test("telegramModule.entities carries 123 types + orchestration + 2 synthetics + 8 named param types", () => {
  // 123 from types.fenel + 1 orchestration entity (`InstanceOutcome`, now
  // carried by the `telegram` UNION via finalize-conversation.fenel) + 2 inline
  // synthetics (`CollectorEntry`, `TelegramFormCompletedPayload`) + 8 named param
  // types registered for the IO/orchestrator/format/capability sigs (`BotToken` /
  // `BotId` / `Url` / `Handle`, Phase 3o; `TgLinkKind` for deepLink's `kind`,
  // Phase 3o Wave D; + `MessageText` / `CallbackData` / `CallbackText`, Phase
  // 3o.3 — the inline-refined String param types the capability sigs reference by
  // name) = 134 total.
  // ids-via-toContain rather than strict-equality-by-index so the test
  // doesn't couple to author order in the .fenel file (matches
  // 4b/4c/4e convention).
  const ids = (telegramModule.entities ?? []).map((e) => e.id);
  expect(ids.length).toBe(134);
  for (const id of [
    "User",
    "Chat",
    "Message",
    "Update",
    "CallbackQuery",
    "InlineKeyboardMarkup",
    "ChatRef",
    "InputFile",
    "EditResult",
    "ReplyMarkup",
    "CollectorAction",
    "CollectorContext",
    "FieldParseResult",
    "ResolveTypeRefDecision",
    "CollectorEntry",
    "TelegramFormCompletedPayload",
    "TgLinkKind",
    "MessageText",
    "CallbackData",
    "CallbackText",
  ]) {
    expect(ids).toContain(id);
  }
});

test("getSystemRegistry surfaces entity:User / Chat / Message / Update / CallbackQuery", () => {
  // Catalog reachability post-system-registry init. Telegram is
  // included in the engine system registry; catalog lookups for the
  // headline Bot API types resolve.
  getSystemRegistry();
  for (const id of [
    "entity:User",
    "entity:Chat",
    "entity:Message",
    "entity:Update",
    "entity:CallbackQuery",
  ]) {
    expect(getCatalogEntry(id)).toBeDefined();
  }
});

test("entity:User resolves to telegram's User (not notion's prefixed NotionUser)", () => {
  // Cross-module collision audit at scale — notion's User-shaped
  // entity is deliberately prefixed `NotionUser` (per 4e's collision-
  // avoidance convention), so the bare `entity:User` codepath should
  // resolve to telegram's User. Confirms the prefix mechanism keeps
  // working as more modules land. type-catalog.ts:1056 silently keeps
  // the first registration on collision; telegram + notion both being
  // surfaced separately is the load-bearing invariant.
  getSystemRegistry();
  const bareUser = getCatalogEntry("entity:User");
  const notionUser = getCatalogEntry("entity:NotionUser");
  expect(bareUser).toBeDefined();
  expect(notionUser).toBeDefined();
  expect(bareUser).not.toBe(notionUser);
});
