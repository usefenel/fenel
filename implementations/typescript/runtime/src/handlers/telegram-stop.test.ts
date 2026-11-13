import { expect, test } from "bun:test";
import { deleteTelegramWebhook } from "./telegram-webhook-delete";
import { findAccountBot } from "./telegram-bot-scope";

test("webhook deletion distinguishes provider acknowledgement, rejection and unavailable transport", async () => {
  const calls: unknown[][] = [];
  expect(await deleteTelegramWebhook("fake-token", async (...args) => {
    calls.push(args);
    return { ok: true, result: true };
  })).toEqual({ $tag: "Ok", _0: null });
  expect(calls).toEqual([["fake-token", "deleteWebhook", {}]]);
  expect(await deleteTelegramWebhook("fake-token", async () => ({
    ok: false, error_code: 429, description: "Try later",
  }))).toEqual({ $tag: "Err", _0: "deleteWebhook failed (429): Try later" });
  expect(await deleteTelegramWebhook("fake-token", async () => {
    throw new Error("request failed for https://api.telegram.org/botsecret-token/deleteWebhook");
  })).toEqual({ $tag: "Err", _0: "deleteWebhook request failed. Retry when the provider is reachable." });
  expect(await deleteTelegramWebhook(undefined, async () => {
    throw new Error("must not call provider");
  })).toEqual({ $tag: "Err", _0: "token required" });
});

test("authenticated bot lookup cannot expose another account's token or stop handle", async () => {
  const botId = "a8b4cd3e-9a53-47a0-8233-19bf957d1d7f";
  const bot = { id: botId, accountId: "account-a", token: "fake-secret", enabled: true };
  const reads: string[] = [];
  const find = async (id: string) => { reads.push(id); return bot; };
  expect(await findAccountBot("account-a", botId, find)).toBe(bot);
  expect(await findAccountBot("account-b", botId, find)).toBeNull();
  expect(await findAccountBot("account-a", "wrong-id", find)).toBeNull();
  const before = reads.length;
  expect(await findAccountBot(undefined, botId, find)).toBeNull();
  expect(await findAccountBot("", botId, find)).toBeNull();
  expect(await findAccountBot("account-a", undefined, find)).toBeNull();
  expect(reads).toHaveLength(before);
});
