// ---------------------------------------------------------------------------
// Telegram decode tests — Phase 11c sub-step 2c of ts-elimination.
//
// Exercises the typed-Update decoder pipeline end-to-end:
//   1. fromTelegramWire (snake_case → camelCase) — pre-pass on the raw
//      Telegram wire JSON.
//   2. codec:wrapJsonValue — raw JS → JsonValue ADT.
//   3. telegram:decodeUpdate (composed via codec:decodeRecordField /
//      decodeRecordRequiredField / decodeRecordListField / bindResult).
//   4. telegram:updateToFlatPayload — interim shim that bridges typed
//      Update → the legacy flat-record contract dispatchCollectorEvent
//      consumes (11c-3 removes the shim).
//
// Fixtures live in `./telegram-decode-fixtures/*.json` and represent the
// raw inbound Telegram wire shape (snake_case) for each major Update
// variant. The fixture set covers the 3 live variants (Message / Edited
// / CallbackQuery) plus one of each exotic variant for shape coverage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { codecModule, codecNatives } from "./codec";
import { telegramModule } from "./telegram";
import { fromTelegramWire } from "../../../runtime/src/handlers/telegram-codec";
const reg = createRegistry([stdModule, codecModule, telegramModule]);
const ctx = reg.evaluateContext();

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, "telegram-decode-fixtures", name), "utf8"),
  );
}

function decode(rawWire: unknown): unknown {
  const camel = fromTelegramWire(rawWire);
  const wrapped = codecNatives.wrapJsonValue!(camel);
  return evaluate({ call: ["decodeUpdate", wrapped] }, {}, ctx);
}

function asOk<T = unknown>(result: unknown): T {
  expect(result).toMatchObject({ $tag: "Ok" });
  return (result as { _0: T })._0;
}

describe("telegram decode — primitive helpers", () => {
  it("decodeChatType — private/group/supergroup/channel", () => {
    const cases: Array<[string, string]> = [
      ["private", "Private"],
      ["group", "Group"],
      ["supergroup", "Supergroup"],
      ["channel", "Channel"],
    ];
    for (const [wire, tag] of cases) {
      const r = evaluate(
        { call: ["decodeChatType", codecNatives.wrapJsonValue!(wire)] },
        {},
        ctx,
      ) as { $tag: string; _0: { $tag: string } };
      expect(r.$tag).toBe("Ok");
      expect(r._0.$tag).toBe(tag);
    }
  });

  it("decodeChatType — unknown chat-type → Err", () => {
    const r = evaluate(
      { call: ["decodeChatType", codecNatives.wrapJsonValue!("unknown")] },
      {},
      ctx,
    ) as { $tag: string };
    expect(r.$tag).toBe("Err");
  });

  it("decodeChatRef — JsonNumber → ById; JsonString → ByUsername", () => {
    const r1 = evaluate(
      { call: ["decodeChatRef", codecNatives.wrapJsonValue!(555)] },
      {},
      ctx,
    ) as { $tag: string; _0: { $tag: string; _0: number } };
    expect(r1).toEqual({ $tag: "Ok", _0: { $tag: "ById", _0: 555 } });

    const r2 = evaluate(
      { call: ["decodeChatRef", codecNatives.wrapJsonValue!("@my_channel")] },
      {},
      ctx,
    ) as { $tag: string; _0: { $tag: string; _0: string } };
    expect(r2).toEqual({
      $tag: "Ok",
      _0: { $tag: "ByUsername", _0: "@my_channel" },
    });
  });

  it("decodeMessageEntityType — accepts both camelCase and snake_case wires", () => {
    for (const wire of ["bot_command", "botCommand"]) {
      const r = evaluate(
        {
          call: ["decodeMessageEntityType", codecNatives.wrapJsonValue!(wire)],
        },
        {},
        ctx,
      ) as { $tag: string; _0: { $tag: string } };
      expect(r.$tag).toBe("Ok");
      expect(r._0.$tag).toBe("BotCommand");
    }
  });
});

describe("telegram decode — Update fixtures", () => {
  it("decodes a Message update with /start command", () => {
    const fixture = loadFixture("message-update.json");
    const ok = asOk<{
      $tag: string;
      updateId: number;
      message: { $tag: string; id: number; text: { $tag: string; value: string } };
    }>(decode(fixture));
    expect(ok.$tag).toBe("MessageUpdate");
    expect(ok.updateId).toBe(123456789);
    expect(ok.message.id).toBe(42);
    expect(ok.message.text).toEqual({ $tag: "Just", _0: "/start" });
  });

  it("decodes a Message update with bot_command entity", () => {
    const fixture = loadFixture("message-update-with-entities.json");
    const ok = asOk<{
      $tag: string;
      message: {
        entities: Array<{
          $tag: string;
          type: { $tag: string };
          offset: number;
          length: number;
        }>;
      };
    }>(decode(fixture));
    expect(ok.$tag).toBe("MessageUpdate");
    expect(ok.message.entities).toHaveLength(1);
    expect(ok.message.entities[0]!.$tag).toBe("MessageEntity");
    expect(ok.message.entities[0]!.type.$tag).toBe("BotCommand");
    expect(ok.message.entities[0]!.offset).toBe(0);
    expect(ok.message.entities[0]!.length).toBe(6);
  });

  it("decodes a CallbackQuery update", () => {
    const fixture = loadFixture("callback-query-update.json");
    const ok = asOk<{
      $tag: string;
      callbackQuery: {
        $tag: string;
        id: string;
        from: { $tag: string; id: number };
        data: { $tag: string; value: string };
        message: { $tag: string };
      };
    }>(decode(fixture));
    expect(ok.$tag).toBe("CallbackQueryUpdate");
    expect(ok.callbackQuery.id).toBe("1234567890123456789");
    expect(ok.callbackQuery.data).toEqual({
      $tag: "Just",
      _0: "confirm:yes",
    });
    expect(ok.callbackQuery.message.$tag).toBe("Just");
  });

  it("decodes an EditedMessage update", () => {
    const fixture = loadFixture("edited-message-update.json");
    const ok = asOk<{
      $tag: string;
      message: { editDate: { $tag: string; value: number } };
    }>(decode(fixture));
    expect(ok.$tag).toBe("EditedMessageUpdate");
    expect(ok.message.editDate).toEqual({
      $tag: "Just",
      _0: 1735000050,
    });
  });

  it("decodes a ChannelPost update with @username chat", () => {
    const fixture = loadFixture("channel-post-update.json");
    const ok = asOk<{
      $tag: string;
      message: { chat: { type: { $tag: string }; id: { $tag: string; id: number } } };
    }>(decode(fixture));
    expect(ok.$tag).toBe("ChannelPostUpdate");
    expect(ok.message.chat.type.$tag).toBe("Channel");
    expect(ok.message.chat.id.$tag).toBe("ById");
  });
});

describe("telegram decode — flatPayloadForTriggers (user-trigger payload helper)", () => {
  it("flattens a MessageUpdate to the legacy collector payload", () => {
    const update = decode(loadFixture("message-update.json")) as {
      _0: unknown;
    };
    const flat = evaluate(
      { call: ["flatPayloadForTriggers", "bot1", update._0] },
      {},
      ctx,
    ) as {
      eventType: string;
      payload: {
        botId: string;
        chatId: number;
        userId: number;
        text: string;
        callbackData: string;
        messageDate: { $tag: string; value?: number };
        _eventType: string;
      };
    };
    expect(flat.eventType).toBe("telegram.message");
    expect(flat.payload.botId).toBe("bot1");
    expect(flat.payload.chatId).toBe(1000001);
    expect(flat.payload.userId).toBe(1000001);
    expect(flat.payload.text).toBe("/start");
    expect(flat.payload.callbackData).toBe("");
    expect(flat.payload.messageDate).toEqual({
      $tag: "Just",
      _0: 1735000000 * 1000,
    });
    expect(flat.payload._eventType).toBe("telegram.message");
  });

  it("flattens a CallbackQueryUpdate to the legacy collector payload", () => {
    const update = decode(loadFixture("callback-query-update.json")) as {
      value: unknown;
    };
    const flat = evaluate(
      { call: ["flatPayloadForTriggers", "bot1", update.value] },
      {},
      ctx,
    ) as {
      eventType: string;
      payload: {
        botId: string;
        chatId: number;
        userId: number;
        callbackData: string;
        messageDate: { $tag: string };
        _eventType: string;
      };
    };
    expect(flat.eventType).toBe("telegram.callbackQuery");
    expect(flat.payload.chatId).toBe(1000001);
    expect(flat.payload.userId).toBe(1000001);
    expect(flat.payload.callbackData).toBe("confirm:yes");
    expect(flat.payload.messageDate.$tag).toBe("Nothing");
    expect(flat.payload._eventType).toBe("telegram.callbackQuery");
  });
});
