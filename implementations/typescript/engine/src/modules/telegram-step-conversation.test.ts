// ---------------------------------------------------------------------------
// stepConversation registration + tryParseInt tests — Phase 11c sub-step 3.
//
// Verifies that:
//   1. The stepConversation function + its helpers are registered with
//      bodies + resolvable by codeName (the dispatch surface that
//      handleTelegramUpdate uses).
//   2. The new std:tryParseInt substrate primitive parses integers + rejects
//      empty / fractional / non-numeric strings (used by stepConversation's
//      `collector:N` callback-data index parsing).
//
// Full IO-dispatch tests for stepConversation aren't included here — they
// would require a runtime-tier registry with IO handler mocks for every
// downstream action (state.list_instances / telegram.find_bot_by_id /
// telegram.send_message_text / telegram.ack_callback_query /
// telegram.start_collector_entry / telegram.send_collector_picker /
// state.dispatch_event_triggers). That scaffolding is queued for a future
// sub-step; for 11c-3 the IO-dispatch surface is verified via the live
// staging acceptance (Step 9 of the brief — real Telegram interaction).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { codecModule } from "./codec";
import { telegramModule } from "./telegram";
const reg = createRegistry([stdModule, codecModule, telegramModule]);
const ctx = reg.evaluateContext();

describe("stepConversation — registration", () => {
  it("stepConversation is registered with a body", () => {
    const fn = ctx.getFunction!("stepConversation");
    expect(fn).toBeDefined();
    expect(fn!.id).toBe("telegram:stepConversation");
    expect(fn!.body).toBeDefined();
  });

  it("handleMessageStep helper is registered", () => {
    const fn = ctx.getFunction!("handleMessageStep");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("handleCallbackStep helper is registered", () => {
    const fn = ctx.getFunction!("handleCallbackStep");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("handleCollectorStartFromMessage helper is registered", () => {
    const fn = ctx.getFunction!("handleCollectorStartFromMessage");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("handleCollectorPickFromCallback helper is registered", () => {
    const fn = ctx.getFunction!("handleCollectorPickFromCallback");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("parseDeepLink helper is registered", () => {
    const fn = ctx.getFunction!("parseDeepLink");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("findEntryByTypeIdOrLabel helper is registered", () => {
    const fn = ctx.getFunction!("findEntryByTypeIdOrLabel");
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  });

  it("flatPayloadForTriggers is registered (Decision EE — minimal user-trigger payload helper)", () => {
    const fn = ctx.getFunction!("flatPayloadForTriggers");
    expect(fn).toBeDefined();
    expect(fn!.id).toBe("telegram:flatPayloadForTriggers");
  });

  it("startCollectorEntry IO leaf is registered (telegram.start_collector_entry)", () => {
    const fn = ctx.getFunction!("startCollectorEntry");
    expect(fn).toBeDefined();
    expect(fn!.id).toBe("telegram:startCollectorEntry");
  });

  it("sendCollectorPicker IO leaf is registered (telegram.send_collector_picker)", () => {
    const fn = ctx.getFunction!("sendCollectorPicker");
    expect(fn).toBeDefined();
    expect(fn!.id).toBe("telegram:sendCollectorPicker");
  });

  it("ackCallbackQuery — direct-arg form (botId + callbackQueryId)", () => {
    const fn = ctx.getFunction!("ackCallbackQuery");
    expect(fn).toBeDefined();
    expect(fn!.params?.map((p) => p.name)).toEqual(["botId", "callbackQueryId"]);
  });
});

describe("parseDeepLink — extract deep-link payload from /start message", () => {
  it("returns Nothing for bare /start", () => {
    const r = evaluate({ call: ["parseDeepLink", "/start"] }, {}, ctx);
    expect(r).toEqual({ $tag: "Nothing" });
  });

  it("returns Just payload for /start with deep link", () => {
    const r = evaluate({ call: ["parseDeepLink", "/start type-uuid-123"] }, {}, ctx);
    expect(r).toEqual({ $tag: "Just", _0: "type-uuid-123" });
  });

  it("returns Nothing for non-/start messages", () => {
    expect(evaluate({ call: ["parseDeepLink", "hello world"] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
    expect(evaluate({ call: ["parseDeepLink", "/help"] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
  });

  it("handles extra whitespace + case-insensitive", () => {
    expect(evaluate({ call: ["parseDeepLink", "/Start  apply  "] }, {}, ctx)).toEqual({
      $tag: "Just",
      _0: "apply",
    });
  });
});

describe("findEntryByTypeIdOrLabel — match collector entry by typeId or label", () => {
  const config = [
    { typeId: "t1", label: "Apply" },
    { typeId: "t2", label: "Support" },
  ];

  it("matches by typeId", () => {
    const r = evaluate(
      { call: ["findEntryByTypeIdOrLabel", config, "t2"] },
      {},
      ctx,
    );
    expect(r).toMatchObject({ $tag: "Just" });
    expect((r as { _0: { label: string } })._0.label).toBe("Support");
  });

  it("matches by label", () => {
    const r = evaluate(
      { call: ["findEntryByTypeIdOrLabel", config, "Apply"] },
      {},
      ctx,
    );
    expect(r).toMatchObject({ $tag: "Just" });
    expect((r as { _0: { typeId: string } })._0.typeId).toBe("t1");
  });

  it("returns Nothing for no match", () => {
    expect(
      evaluate(
        { call: ["findEntryByTypeIdOrLabel", config, "missing"] },
        {},
        ctx,
      ),
    ).toEqual({ $tag: "Nothing" });
  });
});

describe("std:tryParseInt — substrate primitive added in 11c-3", () => {
  it("parses integer strings", () => {
    expect(evaluate({ call: ["tryParseInt", "42"] }, {}, ctx)).toEqual({
      $tag: "Just",
      _0: 42,
    });
    expect(evaluate({ call: ["tryParseInt", "-7"] }, {}, ctx)).toEqual({
      $tag: "Just",
      _0: -7,
    });
    expect(evaluate({ call: ["tryParseInt", "0"] }, {}, ctx)).toEqual({
      $tag: "Just",
      _0: 0,
    });
  });

  it("trims whitespace", () => {
    expect(evaluate({ call: ["tryParseInt", "  42  "] }, {}, ctx)).toEqual({
      $tag: "Just",
      _0: 42,
    });
  });

  it("rejects empty / non-integer / non-numeric strings", () => {
    expect(evaluate({ call: ["tryParseInt", ""] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
    expect(evaluate({ call: ["tryParseInt", "   "] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
    expect(evaluate({ call: ["tryParseInt", "3.14"] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
    expect(evaluate({ call: ["tryParseInt", "abc"] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
    expect(evaluate({ call: ["tryParseInt", "42x"] }, {}, ctx)).toEqual({
      $tag: "Nothing",
    });
  });
});
