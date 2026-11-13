import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { telegramModule } from "@fenel/engine/modules/telegram";
import { registerTelegramHandlers } from "./telegram";

// Stub the bots query so the handlers can resolve a token without a DB.
vi.mock("@fenel/db", () => ({
  findBotById: vi.fn(async (_accountId: string, botId: string) => {
    if (botId === "missing") return null;
    if (botId === "disabled") {
      return { id: botId, accountId: "acct", token: "1:xxx", enabled: false };
    }
    return {
      id: botId,
      accountId: "acct",
      token: `${botId}:secret`,
      enabled: true,
      username: `${botId}_bot`,
    };
  }),
}));

const ctx = { accountId: "acct", profileId: "p", callFunction: vi.fn(), dispatchAction: vi.fn() };

describe("registerTelegramHandlers — registration shape", () => {
  it("registers a handler for every method on every telegram_* capability", () => {
    const reg = createRegistry([stdModule, telegramModule]);
    registerTelegramHandlers(reg);

    // Sanity-spot a handful of expected qualified names. These should
    // resolve to a registered handler.
    for (const qual of [
      "TelegramLifecycle.getMe",
      "TelegramMessages.sendMessage",
      "TelegramMessages.editMessageText",
      "TelegramCallbacks.answerCallbackQuery",
      "TelegramWebhooks.setWebhook",
      "TelegramPayments.sendInvoice",
      "TelegramBusiness.sendGift",
    ]) {
      expect(reg.getIOHandler(qual), qual).toBeTruthy();
    }
  });
});

describe("registerTelegramHandlers — runtime behavior", () => {
  let reg: ReturnType<typeof createRegistry>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reg = createRegistry([stdModule, telegramModule]);
    registerTelegramHandlers(reg);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("requires a botId param", async () => {
    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    await expect(
      handler({ chatId: 1, text: "hi" }, ctx as any),
    ).rejects.toThrow(/botId/);
  });

  it("rejects missing bots", async () => {
    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    await expect(
      handler({ botId: "missing", chatId: 1, text: "hi" }, ctx as any),
    ).rejects.toThrow(/no bot found/);
  });

  it("rejects disabled bots", async () => {
    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    await expect(
      handler({ botId: "disabled", chatId: 1, text: "hi" }, ctx as any),
    ).rejects.toThrow(/disabled/);
  });

  it("posts a JSON body to api.telegram.org and unwraps the result", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42, chat: { id: 1, type: "private" }, date: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    const result = await handler(
      { botId: "marketing", chatId: 1, text: "hello" },
      ctx as any,
    );

    expect(result).toEqual({
      action: "continue",
      value: { messageId: 42, chat: { id: 1, type: "private" }, date: 0 },
    });

    // Verify we posted to the right URL with the right token + snake_case body.
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botmarketing:secret/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chat_id: 1, text: "hello" });
    // botId should NOT have been forwarded to Telegram.
    expect(body.bot_id).toBeUndefined();
    expect(body.botId).toBeUndefined();
  });

  it("wraps editMessageText results into an EditResult sum", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const handler = reg.getIOHandler("TelegramMessages.editMessageText")!;
    const r = await handler(
      { botId: "marketing", text: "edited", inlineMessageId: "abc" },
      ctx as any,
    );
    expect(r).toEqual({
      action: "continue",
      value: { $tag: "InlineEdited", success: true },
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 99, chat: { id: 1, type: "private" }, date: 0 },
        }),
        { status: 200 },
      ),
    );
    const r2 = await handler(
      { botId: "marketing", chatId: 1, messageId: 99, text: "edited" },
      ctx as any,
    );
    expect(r2).toEqual({
      action: "continue",
      value: {
        $tag: "Edited",
        message: { messageId: 99, chat: { id: 1, type: "private" }, date: 0 },
      },
    });
  });

  it("suspends as waiting_timer when Telegram returns retry_after", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 5 },
        }),
        { status: 200 },
      ),
    );
    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    const r = await handler(
      { botId: "marketing", chatId: 1, text: "hi" },
      ctx as any,
    );
    expect(r).toMatchObject({
      action: "suspend",
      status: "waiting_timer",
    });
    // Phase 12 of canonical-maybe — meta is now `Just({$tag: "WaitTimer", wakeAt, retryReason})`.
    const m = (r as any).meta;
    expect(m.$tag).toBe("Just");
    expect(m._0.$tag).toBe("WaitTimer");
    expect(typeof m._0.wakeAt).toBe("string");
    expect(m._0.retryReason.$tag).toBe("Just");
    expect(m._0.retryReason._0.$tag).toBe("TelegramRetry");
  });

  it("throws on non-rate-limit Telegram errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: chat not found",
        }),
        { status: 200 },
      ),
    );
    const handler = reg.getIOHandler("TelegramMessages.sendMessage")!;
    await expect(
      handler({ botId: "marketing", chatId: 99999, text: "hi" }, ctx as any),
    ).rejects.toThrow(/chat not found/);
  });
});
