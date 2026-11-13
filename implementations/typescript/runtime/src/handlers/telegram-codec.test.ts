import { describe, it, expect } from "vitest";
import {
  camelToSnake,
  snakeToCamel,
  toTelegramWire,
  fromTelegramWire,
} from "./telegram-codec";

describe("camelToSnake / snakeToCamel — string-level", () => {
  it("converts camelCase identifiers to snake_case", () => {
    expect(camelToSnake("firstName")).toBe("first_name");
    expect(camelToSnake("messageThreadId")).toBe("message_thread_id");
    expect(camelToSnake("disableNotification")).toBe("disable_notification");
  });

  it("leaves single-word lowercase identifiers alone", () => {
    expect(camelToSnake("text")).toBe("text");
    expect(camelToSnake("ok")).toBe("ok");
  });

  it("snakeToCamel is the inverse for clean inputs", () => {
    expect(snakeToCamel("first_name")).toBe("firstName");
    expect(snakeToCamel("message_thread_id")).toBe("messageThreadId");
    expect(snakeToCamel("disable_notification")).toBe("disableNotification");
  });
});

describe("toTelegramWire — outbound", () => {
  it("rewrites top-level keys to snake_case", () => {
    expect(
      toTelegramWire({
        chatId: 1234,
        text: "hello",
        disableNotification: true,
      }),
    ).toEqual({
      chat_id: 1234,
      text: "hello",
      disable_notification: true,
    });
  });

  it("recurses into nested objects", () => {
    expect(
      toTelegramWire({
        replyParameters: {
          messageId: 99,
          allowSendingWithoutReply: false,
        },
      }),
    ).toEqual({
      reply_parameters: {
        message_id: 99,
        allow_sending_without_reply: false,
      },
    });
  });

  it("recurses into arrays", () => {
    expect(
      toTelegramWire({
        inlineKeyboard: [
          [{ text: "Yes", callbackData: "y" }],
          [{ text: "No", callbackData: "n" }],
        ],
      }),
    ).toEqual({
      inline_keyboard: [
        [{ text: "Yes", callback_data: "y" }],
        [{ text: "No", callback_data: "n" }],
      ],
    });
  });

  it("preserves the $tag discriminator on Fenel sums", () => {
    expect(
      toTelegramWire({
        replyMarkup: { $tag: "Inline", keyboard: { inlineKeyboard: [[{ text: "Go", callbackData: "go" }]] } },
      }),
    ).toEqual({
      reply_markup: {
        $tag: "Inline",
        keyboard: { inline_keyboard: [[{ text: "Go", callback_data: "go" }]] },
      },
    });
  });

  it("does not touch values inside strings", () => {
    expect(
      toTelegramWire({ text: "fooBarBaz with camelCase inside" }),
    ).toEqual({ text: "fooBarBaz with camelCase inside" });
  });
});

describe("fromTelegramWire — inbound", () => {
  it("rewrites top-level keys to camelCase", () => {
    expect(
      fromTelegramWire({
        message_id: 42,
        date: 1700000000,
        from: { id: 1, is_bot: false, first_name: "Rom" },
      }),
    ).toEqual({
      messageId: 42,
      date: 1700000000,
      from: { id: 1, isBot: false, firstName: "Rom" },
    });
  });

  it("round-trips through toTelegramWire (camel → snake → camel)", () => {
    const original = {
      chatId: 1234,
      messageId: 99,
      replyToMessage: {
        from: { id: 1, isBot: false, firstName: "Rom" },
        text: "hello",
      },
    };
    const back = fromTelegramWire(toTelegramWire(original));
    expect(back).toEqual(original);
  });
});
