// ---------------------------------------------------------------------------
// module-migrate-telegram.test.ts — module-substrate Phase 3o.1 parity + the
// FIRST telegram cross-file header UNION (`decoders.fenel` ∪ `conversation.fenel`
// → the `telegram` module).
//
// SCOPE (the brief's clean-union recipe, proven on auth, applied to telegram's
// CLEANLY-MIGRATABLE slice — see the roadmap completion notes for why the bulk
// stays as TS specs this sub-phase): the 9 typed-Update decoders +
// `flatPayloadForTriggers` migrate to the union as full members carrying their
// identity via @facet directives (their hand-wrapped `defineFunction` specs +
// the per-id `DECODE_*_BODY` extraction RETIRED), and the 11 generic Conversation
// helpers ride as Codeable-only members (superseding the `conversationModule`
// spread). The complex-param orchestrators, the inline-JSON-Logic helpers, the
// bodyless IO primitives, the two natives, and `notify:sendTgDm` STAY as TS
// `defineFunction` specs (their param types have no `.fenel` sig representation /
// their bodies are inline JSON-Logic — 3o.2–3o.4 / ts-elimination territory).
//
// Four blocks of assertions:
//   1. PARITY — the 10 migrated publics under the SAME telegram:* ids + codeNames;
//      identity facets byte-identical (NO Categorizable per 3j; NO IOInvokable —
//      decoders are pure); param/return types byte-identical to the retired specs.
//   2. THE UNION MECHANISM — loadFenelModuleUnion groups decoders + conversation
//      into ONE `telegram` module (23 members); dup-name within a group throws.
//   3. CODEABLE-ONLY HELPERS — the 2 flat*Inner + 11 Conversation helpers.
//   4. REGRESSION — the kept TS-spec surface + the 16 capabilities are UNTOUCHED
//      (telegramModule still 83 fns / 126 entities; runCollector / startTelegramForm
//      / sendMessageText / escapeMarkdownV2 / fieldLabel / parseCommand /
//      notify:sendTgDm all present with their facets + ioActions).
//   5. BODY DISPATCH — a union-sourced decoder dispatches by codeName end-to-end.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { telegramModule, telegramCapabilities } from "./modules/telegram";
import { stdModule } from "./modules/std";
import { codecModule, codecNatives } from "./modules/codec";
import { createRegistry } from "./registry";
import { loadFenelModuleUnion } from "./fenel-module";
import { evaluate } from "./json-logic";
import { Result as _Result, Maybe as _Maybe, List as _List, Nothing } from "./type-foundation";
import type { FenelType as _FT } from "./types";

// 7g-retire-2b: the TS `List`/`Maybe`/`Result` helpers now emit `{$ref}` self-refs,
// but the registered capability types carry the `{$ref}` twin (load-order
// divergence; {$ref}≡{$ref}). Fold the helper output so byte-faithfulness compares
// modulo the reference's value-form.
function _foldRefs(t: _FT): _FT {
  if (Array.isArray(t)) return t.map(_foldRefs) as unknown as _FT;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string" && Object.keys(o).length === 1) {
      return { $ref: o.$ref } as _FT;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = _foldRefs(o[k] as _FT);
    return out as _FT;
  }
  return t;
}
const List = (a: _FT) => _foldRefs(_List(a));
const Maybe = (a: _FT) => _foldRefs(_Maybe(a));
const Result = (e: _FT, a: _FT) => _foldRefs(_Result(e, a));
import type { Instance } from "./types";

import DECODERS_FENEL from "../../../../fenel/modules/telegram/decoders.fenel?raw";
import CONVERSATION_FENEL from "../../../../fenel/modules/telegram/conversation.fenel?raw";
import PARSE_COMMAND_FENEL from "../../../../fenel/modules/telegram/parse-command.fenel?raw";

// The 10 union publics that carry @facet identity (codeName === id-suffix —
// telegram has no @codeName divergence in this slice).
const DECODER_IDS = [
  "telegram:decodeChatType",
  "telegram:decodeChatRef",
  "telegram:decodeMessageEntityType",
  "telegram:decodeUser",
  "telegram:decodeChat",
  "telegram:decodeMessageEntity",
  "telegram:decodeMessage",
  "telegram:decodeCallbackQuery",
  "telegram:decodeUpdate",
  "telegram:flatPayloadForTriggers",
];
// Codeable-only union members (directive-free → the 3j default).
const INNER_HELPER_IDS = [
  "telegram:flatMessagePayloadInner",
  "telegram:flatCallbackQueryPayloadInner",
];
const CONVERSATION_HELPER_IDS = [
  "telegram:findActiveConversation",
  "telegram:findConfirmingConversation",
  "telegram:insertConversation",
  "telegram:markConversationCompleted",
  "telegram:markConversationCancelled",
  "telegram:markConversationConfirming",
  "telegram:markConversationActive",
  "telegram:updateConversationProgress",
  "telegram:stampPromptSentAt",
  "telegram:isStaleMessage",
  "telegram:wrapDraftField",
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

// 7g-parser: the parser emits a user-written type-name ref as `{$ref:H}` (was
// `{$ref:H}`). These capability/sig parity checks are byte-identical to the
// retired TS specs MODULO the reference's value form — fold `{$ref:H}`→
// `{$ref:H}` on the parsed side ({$ref}≡{$ref}; the producer tripwire lives
// in fenel-syntax.test.ts, not here).
function normRefs<T>(t: T): T {
  if (Array.isArray(t)) return t.map(normRefs) as unknown as T;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string") return { $ref: o.$ref } as unknown as T;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normRefs(o[k]);
    return out as unknown as T;
  }
  return t;
}

const insts = normRefs(telegramModule.instances ?? []);
const fns = normRefs(telegramModule.functions ?? []);
const caps = normRefs(telegramCapabilities);

// ===========================================================================
// 1. PARITY — the 10 migrated decoder/flatPayload publics
// ===========================================================================

describe("telegram 3o.1 — decoder/flatPayload publics migrated to the union", () => {
  test("all 10 register under telegram:* ids via the union", () => {
    for (const id of DECODER_IDS) {
      expect(fns.find((f) => f.id === id)?.id).toBe(id);
    }
  });

  test("each has a body sourced from the union (not a retired spec splice)", () => {
    for (const id of DECODER_IDS) {
      expect(fns.find((f) => f.id === id)?.body).toBeDefined();
    }
  });

  test("Codeable: codeName === id-suffix (no @codeName divergence in this slice)", () => {
    for (const id of DECODER_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.slice("telegram:".length) });
    }
  });

  test("Labelable / Describable / Taggable present on all 10 (byte-identical to the retired specs)", () => {
    expect(methodOf(insts, "Labelable", "telegram:decodeChatType")).toEqual({ label: "Decode ChatType" });
    expect(methodOf(insts, "Describable", "telegram:decodeChatType")).toEqual({
      description:
        "Decode a JsonValue into the typed ChatType ADT (Private | Group | Supergroup | Channel). Telegram wire emits lower-case strings; this matches camelCase or snake_case forms.",
    });
    expect(methodOf(insts, "Taggable", "telegram:decodeChatType")).toEqual({
      tags: ["telegram", "decode", "decodable", "pure"],
    });
    // The embedded-quote description round-trips through the @description lexer.
    expect((methodOf(insts, "Describable", "telegram:decodeUpdate") as { description: string }).description).toContain(
      'UnknownUpdate { kind = "unknown" }',
    );
    expect(methodOf(insts, "Labelable", "telegram:flatPayloadForTriggers")).toEqual({
      label: "Flatten Update → user-trigger payload",
    });
    expect(methodOf(insts, "Taggable", "telegram:flatPayloadForTriggers")).toEqual({
      tags: ["telegram", "decode", "trigger", "pure"],
    });
    for (const id of DECODER_IDS) {
      expect(methodOf(insts, "Labelable", id)).toBeDefined();
      expect(methodOf(insts, "Describable", id)).toBeDefined();
      expect(methodOf(insts, "Taggable", id)).toBeDefined();
    }
  });

  // Phase 3j: the migrated publics carry NO stored Categorizable (the `telegram`
  // category derives at read time from the `telegram:` id prefix). Decoders are
  // pure → NO IOInvokable.
  test("Categorizable + IOInvokable ABSENT on all 10 (3j read-time category; pure)", () => {
    for (const id of DECODER_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
      expect(methodOf(insts, "IOInvokable", id)).toBeUndefined();
    }
  });

  test("param/return types byte-identical to the retired specs (JsonValue → Result String NamedType)", () => {
    const dct = fns.find((f) => f.id === "telegram:decodeChatType");
    expect(dct?.params?.[0]?.type).toEqual({ $ref: "JsonValue" });
    expect(dct?.returns).toEqual(Result({ $ref: "String" }, { $ref: "ChatType" }));
    expect(fns.find((f) => f.id === "telegram:decodeUpdate")?.returns).toEqual(
      Result({ $ref: "String" }, { $ref: "Update" }),
    );
    // flatPayloadForTriggers : String -> Update -> {}
    const flat = fns.find((f) => f.id === "telegram:flatPayloadForTriggers");
    expect(flat?.params?.map((p) => p.type)).toEqual([{ $ref: "String" }, { $ref: "Update" }]);
    expect(flat?.returns).toEqual({ $record: { fields: [] } });
  });

  test("every migrated id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    for (const id of DECODER_IDS) {
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunction(id.slice("telegram:".length))?.id).toBe(id);
    }
  });

  test("the decoders are pure — NO inferred requires", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    for (const id of DECODER_IDS) {
      expect(reg.getFunction(id)?.requires).toBeUndefined();
    }
  });
});

// ===========================================================================
// 2. THE UNION MECHANISM
// ===========================================================================

describe("telegram 3o.1 — the cross-file header UNION (decoders ∪ conversation)", () => {
  const groups = loadFenelModuleUnion([
    { src: DECODERS_FENEL, name: "telegram-fallback-a" },
    { src: CONVERSATION_FENEL, name: "telegram-fallback-b" },
    { src: PARSE_COMMAND_FENEL, name: "telegram-fallback-c" },
  ]);

  test("three files group into ONE `telegram` module by header (NOT the name arg)", () => {
    expect(groups.map((m) => m.name)).toEqual(["telegram"]);
  });

  test("the union carries members from ALL THREE files (decoder + conversation + parseCommand)", () => {
    const tg = groups[0]!;
    const ids = (tg.functions ?? []).map((f) => f.id);
    expect(ids).toContain("telegram:decodeUpdate"); // decoders.fenel
    expect(ids).toContain("telegram:insertConversation"); // conversation.fenel
    expect(ids).toContain("telegram:parseCommand"); // parse-command.fenel
    // 10 decoder publics + 2 flat*Inner + 11 conversation helpers + parseCommand = 24.
    expect(ids.length).toBe(24);
    expect((tg.functions ?? []).every((f) => f.id.startsWith("telegram:"))).toBe(true);
  });

  test("dup-name across two same-header files throws a precise load-time error (OQ3)", () => {
    const a = "module telegram where\ndecodeUpdate jv = 1\n";
    const b = "module telegram where\ndecodeUpdate jv = 2\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]),
    ).toThrow('module telegram: duplicate definition "decodeUpdate" in a.fenel and b.fenel');
  });
});

// ===========================================================================
// 3. CODEABLE-ONLY HELPERS (the 3j directive-free default)
// ===========================================================================

describe("telegram 3o.1 — helpers ride the union Codeable-only", () => {
  test("the 2 flat*Inner + 11 Conversation helpers are Codeable-ONLY", () => {
    for (const id of [...INNER_HELPER_IDS, ...CONVERSATION_HELPER_IDS]) {
      expect(fns.find((f) => f.id === id)?.body).toBeDefined();
      expect(methodOf(insts, "Codeable", id)).toBeDefined();
      expect(methodOf(insts, "Labelable", id)).toBeUndefined();
      expect(methodOf(insts, "Describable", id)).toBeUndefined();
      expect(methodOf(insts, "Taggable", id)).toBeUndefined();
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });
});

// ===========================================================================
// 4. REGRESSION — the kept TS-spec surface + the 16 capabilities UNTOUCHED
// ===========================================================================

describe("telegram 3o.1 — the kept surface is untouched (parity guard)", () => {
  test("telegramModule exports 93 functions + 134 entities", () => {
    // FN count held at 81 across the Phase 3o closing wave (the 10 orchestrator
    // specs + their 10 surfaced helpers + the 2 natives all moved spec→union,
    // net 0). Phase 3p (the mixed-ingress dissolve, Option C) adds ONE:
    // `telegram:telegramWebhookDispatch`, the webhook slice folded into the union
    // via webhook-wrapper.fenel → 81 + 1 = 82. (Entities unchanged — the slice
    // is a function, webhook-wrapper.fenel declares no type.)
    // ts-elimination-completion Phase 7 adds the 7 `formRefl…` Tier-0 peeler
    // HELPERS (Codeable-only, from form-type-reflection.fenel) → 82 + 7 = 89.
    // Phase 7b adds the 4 `formCore…` formatValue cascade HELPERS (Codeable-only,
    // from form-fill-cores.fenel) → 89 + 4 = 93.
    // FM-retire-7 Step 1 (2026-06-06) re-homes the 14 form-cores: both files
    // (form-type-reflection.fenel's 5 publics + form-fill-cores.fenel's 9 publics)
    // fold into the `telegram` UNION as full members carrying @facet identity,
    // RETIRING their `defineFunction` specs + the body-extraction seams. The 14
    // publics keep the SAME `telegram:*` ids (only their registration path moved
    // spec→union), and their 11 helpers already rode the union as Codeable-only,
    // so the count held at 93. (Entities unchanged — neither file declares a type.)
    // FM-retire-7 Step 2 SPINS OUT `notify:sendTgDm` (+ its 5 helpers) to its own
    // `notify` module — telegram.ts reaches 0 `defineFunction`. sendTgDm + the 5
    // `notify-bodies:*` helpers leave telegramModule.functions (the helpers rode
    // it as Codeable-only), so 93 − 6 = 87.
    expect(fns.length).toBe(87);
    // 131 → 134 (Phase 3o.3): + `MessageText` / `CallbackData` / `CallbackText` —
    // the inline-refined String param types the migrated capability sigs reference
    // by name (so the `.fenel` arrow sigs aren't String-relaxed). All law-neutral
    // (bare entity registration carries no identity instance). The 16 capability
    // TYPES themselves do NOT enter entities (capability.fenel loaded separately).
    expect((telegramModule.entities ?? []).length).toBe(134);
  });

  test("the 16 sub-capabilities are still seeded", () => {
    expect(caps.map((c) => c.name).sort()).toEqual(
      [
        "TelegramLifecycle", "TelegramWebhooks", "TelegramMessages", "TelegramCallbacks",
        "TelegramMedia", "TelegramFiles", "TelegramChatAdmin", "TelegramBotConfig",
        "TelegramPayments", "TelegramInlineMode", "TelegramStickers", "TelegramPassport",
        "TelegramGames", "TelegramPolls", "TelegramForumTopics", "TelegramBusiness",
      ].sort(),
    );
    // One bot-keyed Instance per capability, args ["Bot"], priority 50.
    for (const c of caps) {
      const inst = insts.find((i) => i.typeName === c.name);
      expect(inst?.args).toEqual(["Bot"]);
      expect(inst?.priority).toBe(50);
    }
  });

  test("orchestrators (now union members) keep their codeNames + ioActions", () => {
    // codeName ≠ id-suffix divergence preserved on the collector fns (now via the
    // union's @codeName directive rather than a TS spec — see block 6).
    expect(methodOf(insts, "Codeable", "telegram:runCollector")).toEqual({ codeName: "runTelegramCollector" });
    expect(methodOf(insts, "IOInvokable", "telegram:runCollector")).toMatchObject({ ioAction: "telegram_collector.run" });
    expect(methodOf(insts, "Codeable", "telegram:handleUpdate")).toEqual({ codeName: "handleTelegramUpdate" });
    expect(methodOf(insts, "IOInvokable", "telegram:startTelegramForm")).toEqual({ ioAction: "telegram_form.start" });
    // handleUpdate keeps its Iconable + Emojiable (one of the 5/5).
    expect(methodOf(insts, "Iconable", "telegram:handleUpdate")).toBeDefined();
    expect(methodOf(insts, "Emojiable", "telegram:handleUpdate")).toBeDefined();
  });

  test("kept inline-bodied + format-native fns still present (sendTgDm spun out to `notify`)", () => {
    expect(fns.find((f) => f.id === "telegram:fieldLabel")?.body).toBeDefined(); // .fenel-bodied union member (FM-retire-7 Step 1)
    expect(methodOf(insts, "Codeable", "telegram:escapeMarkdownV2")).toEqual({ codeName: "escapeMarkdownV2" }); // Fenel-bodied (Wave D)
    // FM-retire-7 Step 2 — `notify:sendTgDm` LEFT telegramModule (its own `notify`
    // module now; see module-migrate-notify.test.ts). It must NOT resolve here.
    expect(fns.find((f) => f.id === "notify:sendTgDm")).toBeUndefined();
    expect(methodOf(insts, "Codeable", "notify:sendTgDm")).toBeUndefined();
  });

  // Law-count parity (Surprise #11): the migrated orchestrators + natives re-emit
  // the SAME law-contributing instances (Codeable + Labelable) they had as specs.
  // Phase 3p adds ONE fn (telegram:telegramWebhookDispatch) carrying Codeable +
  // Labelable (+ Describable/Taggable), so Codeable 81→82, Labelable 53→54 — but
  // those instances are the SAME ones it emitted inside the bundle, so the 2450
  // audit total is unchanged (identity counted, not location). Categorizable
  // stays 15 + IOInvokable stays 23 (the slice carries neither — no @category,
  // no @ioAction).
  // ts-elimination-completion Phase 7 — the 7 `formRefl…` peeler helpers are
  // Codeable-ONLY (directive-free, the 3j default — like the flat*Inner /
  // Conversation helpers), so Codeable 82→89 (+7) but Labelable / Describable /
  // Taggable / Categorizable / IOInvokable all HOLD. The +7 Codeable is the only
  // law-count contribution (spec law violations 2774→2781, +1 per Codeable-only
  // helper — refines the "+2 × net-new labelled fn" rule: it's +1 × Codeable +
  // 1 × Labelable, and these helpers carry no Labelable).
  // ts-elimination-completion Phase 7b — the 4 `formCore…` formatValue cascade
  // helpers are likewise Codeable-ONLY, so Codeable 89→93 (+4), law 2781→2785;
  // Labelable / Categorizable / IOInvokable all HOLD (the nine cluster publics
  // keep their identity-carrying defineFunction specs unchanged).
  // FM-retire-7 Step 1 — the 14 form-cores moved spec→union (form-type-reflection
  // + form-fill-cores folded into telegramUnionGroups). The union members re-emit
  // the SAME identity instances the specs carried, so the counts HELD at 93/54/
  // 15/23 through Step 1.
  // FM-retire-7 Step 2 — `notify:sendTgDm` + its 5 `notify-bodies:*` helpers leave
  // telegramModule (spun out to the `notify` module). sendTgDm carried Codeable +
  // Labelable + Describable + Taggable + Categorizable + IOInvokable; each helper
  // carried Codeable only. So the asserted counts drop:
  //   Codeable     93 → 87  (sendTgDm + 5 helpers)
  //   Labelable    54 → 53  (sendTgDm)
  //   Categorizable 15 → 14 (sendTgDm's @category "notify")
  //   IOInvokable  23 → 22  (sendTgDm's @ioAction)
  test("law-contributing instance counts (Codeable 87 / Labelable 53 / Categorizable 14 / IOInvokable 22 after the notify spin-out)", () => {
    expect(insts.filter((i) => i.typeName === "Codeable").length).toBe(87);
    expect(insts.filter((i) => i.typeName === "Labelable").length).toBe(53);
    expect(insts.filter((i) => i.typeName === "Categorizable").length).toBe(14);
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(22);
  });
});

// ===========================================================================
// 6. PHASE 3o CLOSING WAVE — the 10 orchestrators + 2 natives migrated to union
// ===========================================================================

// The 10 orchestrator publics. codeName === id-suffix EXCEPT the 4 collector fns,
// which keep a divergent codeName via @codeName.
const ORCH_IDS = [
  "telegram:runCollector",
  "telegram:stopCollector",
  "telegram:listCollectors",
  "telegram:handleUpdate",
  "telegram:startTelegramForm",
  "telegram:finalizeConversation",
  "telegram:routeConfirmation",
  "telegram:routeTelegramMessage",
  "telegram:routeTelegramMessageWithHook",
  "telegram:stepConversation",
];
const CODENAME_DIVERGENCE: Record<string, string> = {
  "telegram:runCollector": "runTelegramCollector",
  "telegram:stopCollector": "stopTelegramCollector",
  "telegram:listCollectors": "listTelegramCollectors",
  "telegram:handleUpdate": "handleTelegramUpdate",
};
// 9 of the 10 carry an @ioAction (stepConversation has none).
const ORCH_IOACTION: Record<string, string> = {
  "telegram:runCollector": "telegram_collector.run",
  "telegram:stopCollector": "telegram_collector.stop",
  "telegram:listCollectors": "telegram_collector.list",
  "telegram:handleUpdate": "telegram_collector.handle_update",
  "telegram:startTelegramForm": "telegram_form.start",
  "telegram:finalizeConversation": "telegram_form.finalize",
  "telegram:routeConfirmation": "telegram_form.route_confirmation",
  "telegram:routeTelegramMessage": "telegram_form.route_message",
  "telegram:routeTelegramMessageWithHook": "telegram_form.route_message_with_hook",
};
// The 5 carrying @icon + @emoji.
const ORCH_ICONIC = [
  "telegram:runCollector",
  "telegram:stopCollector",
  "telegram:handleUpdate",
  "telegram:startTelegramForm",
  "telegram:finalizeConversation",
];

describe("telegram 3o (closing wave) — 10 orchestrators migrated to the union", () => {
  test("all 10 register under telegram:* ids with Fenel bodies sourced from the union", () => {
    for (const id of ORCH_IDS) {
      const f = fns.find((x) => x.id === id);
      expect(f?.id).toBe(id);
      expect(f?.body).toBeDefined();
    }
  });

  test("@codeName divergence preserved on the 4 collector fns; identity === id-suffix elsewhere", () => {
    for (const id of ORCH_IDS) {
      const expected = CODENAME_DIVERGENCE[id] ?? id.slice("telegram:".length);
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: expected });
    }
  });

  test("Labelable / Describable / Taggable present on all 10", () => {
    expect(methodOf(insts, "Labelable", "telegram:runCollector")).toEqual({ label: "Run Telegram Collector" });
    expect(methodOf(insts, "Taggable", "telegram:runCollector")).toEqual({
      tags: ["telegram", "collector", "io", "form"],
    });
    for (const id of ORCH_IDS) {
      expect(methodOf(insts, "Labelable", id)).toBeDefined();
      expect(methodOf(insts, "Describable", id)).toBeDefined();
      expect(methodOf(insts, "Taggable", id)).toBeDefined();
    }
  });

  test("IOInvokable present on the 9 ioAction-bearing fns, ABSENT on stepConversation", () => {
    for (const [id, io] of Object.entries(ORCH_IOACTION)) {
      expect(methodOf(insts, "IOInvokable", id)).toMatchObject({ ioAction: io });
    }
    expect(methodOf(insts, "IOInvokable", "telegram:stepConversation")).toBeUndefined();
  });

  test("runCollector's IOInvokable carries all 3 lifecycle action keys (run/stop/list)", () => {
    expect(methodOf(insts, "IOInvokable", "telegram:runCollector")).toMatchObject({
      ioAction: "telegram_collector.run",
      stopAction: "telegram_collector.stop",
      listInstancesAction: "telegram_collector.list",
    });
  });

  test("the 5 lifecycle fns carry @icon + @emoji", () => {
    for (const id of ORCH_ICONIC) {
      expect(methodOf(insts, "Iconable", id)).toBeDefined();
      expect(methodOf(insts, "Emojiable", id)).toBeDefined();
    }
  });

  test("Categorizable ABSENT on all 10 (3j read-time category)", () => {
    for (const id of ORCH_IDS) {
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
    }
  });

  test("the orchestrators carry INFERRED requires (non-empty; keeps the audit at 0 undeclared)", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    // The Fenel-bodied orchestrators infer their requires transitively from the
    // IO leaves they call (no hand-declared @requires). At minimum the
    // bot-touching fns infer HasTelegramBot; assert non-empty for those that hit IO.
    for (const id of [
      "telegram:runCollector",
      "telegram:stopCollector",
      "telegram:handleUpdate",
      "telegram:startTelegramForm",
    ]) {
      const req = reg.getFunction(id)?.requires;
      expect(Array.isArray(req) && req.length > 0).toBe(true);
    }
  });

  test("every orchestrator id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    for (const id of ORCH_IDS) {
      expect(reg.getFunction(id)?.id).toBe(id);
      const codeName = CODENAME_DIVERGENCE[id] ?? id.slice("telegram:".length);
      expect(reg.getFunction(codeName)?.id).toBe(id);
    }
  });
});

// Wave D: escapeMarkdownV2 + deepLink ported from TS @native to Fenel-bodied
// union members; telegramModule.nativeImpls collapses to {}.
describe("telegram 3o Wave D — the 2 natives are Fenel-bodied union members", () => {
  test("escapeMarkdownV2 + deepLink have Fenel bodies (NOT bodyless natives)", () => {
    for (const id of ["telegram:escapeMarkdownV2", "telegram:deepLink"]) {
      const f = fns.find((x) => x.id === id);
      expect(f?.id).toBe(id);
      expect(f?.body).toBeDefined();
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.slice("telegram:".length) });
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined(); // 3j read-time
    }
  });

  test("telegramModule.nativeImpls is empty (no TS natives survive)", () => {
    expect(Object.keys(telegramModule.nativeImpls ?? {})).toEqual([]);
  });

  test("escapeMarkdownV2 + deepLink dispatch end-to-end through the registry", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    const ctx = reg.evaluateContext();
    expect(evaluate({ call: ["escapeMarkdownV2", "a_b.c!"] }, {}, ctx)).toBe("a\\_b\\.c\\!");
    expect(evaluate({ call: ["deepLink", "@bot", "bot_start", "hi there"] }, {}, ctx)).toBe(
      "https://t.me/bot?start=hi%20there",
    );
    expect(evaluate({ call: ["deepLink", "@user", "user", ""] }, {}, ctx)).toBe("https://t.me/user");
  });
});

// Wave B (3o): the 12 bodyless Bot-API IO leaves migrated to io.fenel as @native
// + @ioAction + @requires union members (declaration in .fenel; the runtime IO
// handlers, keyed by @ioAction, are UNCHANGED).
describe("telegram 3o — bodyless IO leaves migrated to io.fenel (@native + @requires)", () => {
  const HAS_TG_BOT = [{ class: { $tag: "Id" as const, entityId: "HasTelegramBot" }, args: [{ $var: "scope" }] }];
  const HAS_STATE_IO = [{ class: { $tag: "Id" as const, entityId: "HasStateIO" }, args: [{ $var: "scope" }] }];
  const EXPECTED = {
    "telegram:findBotById": { io: "telegram.find_bot_by_id", req: HAS_TG_BOT },
    "telegram:sendMessageText": { io: "telegram.send_message_text", req: HAS_TG_BOT },
    "telegram:sendFieldPrompt": { io: "telegram.send_field_prompt", req: HAS_TG_BOT },
    "telegram:sendConfirmationSummary": { io: "telegram.send_confirmation_summary", req: HAS_TG_BOT },
    "telegram:validateBotToken": { io: "telegram.validate_bot_token", req: HAS_TG_BOT },
    "telegram:setWebhookByToken": { io: "telegram.set_webhook_by_token", req: HAS_TG_BOT },
    "telegram:startCollectorEntry": { io: "telegram.start_collector_entry", req: HAS_TG_BOT },
    "telegram:sendCollectorPicker": { io: "telegram.send_collector_picker", req: HAS_TG_BOT },
    "telegram:ackCallbackQuery": { io: "telegram.ack_callback_query", req: HAS_TG_BOT },
    "telegram:deleteWebhookByToken": { io: "telegram.delete_webhook_by_token", req: HAS_TG_BOT },
    "telegram:getUpdatesPoll": { io: "TelegramWebhooks.getUpdates", req: HAS_STATE_IO },
    "telegram:sendNotification": { io: "telegram.send_notification", req: HAS_STATE_IO },
  } as const;

  test("all 12 are BODYLESS @native fns with their @ioAction + @requires preserved", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    for (const [id, { io, req }] of Object.entries(EXPECTED)) {
      const f = fns.find((x) => x.id === id);
      expect(f?.id).toBe(id); // present
      expect(f?.body).toBeUndefined(); // bodyless (IO handler keyed by @ioAction)
      expect(methodOf(insts, "IOInvokable", id)).toEqual({ ioAction: io });
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.slice("telegram:".length) });
      expect(methodOf(insts, "Labelable", id)).toBeDefined();
      expect(methodOf(insts, "Categorizable", id)).toBeUndefined(); // 3j read-time
      // @requires preserved (a bodyless leaf can't infer — it declares).
      expect(reg.getFunction(id)?.requires).toEqual(req);
    }
  });

  test("param types reference the registered named types (BotToken / BotId)", () => {
    expect(fns.find((f) => f.id === "telegram:sendMessageText")?.params?.[0]?.type).toEqual({ $ref: "BotToken" });
    expect(fns.find((f) => f.id === "telegram:getUpdatesPoll")?.params?.[0]?.type).toEqual({ $ref: "BotId" });
    // BotToken / BotId / Url / Handle registered as named entities.
    const ents = (telegramModule.entities ?? []).map((e) => e.id);
    expect(ents).toContain("BotToken");
    expect(ents).toContain("BotId");
  });
});

// parseCommand: the Surprise #37 follow-up — the sig-parser `meta: {}` fix lets
// its inline-record return type round-trip, so it migrates to the union too.
describe("telegram 3o.1+ — parseCommand migrated (inline-record sig now round-trips)", () => {
  test("parseCommand is a union member: facets present, Categorizable/IOInvokable absent", () => {
    expect(fns.find((f) => f.id === "telegram:parseCommand")?.body).toBeDefined();
    expect(methodOf(insts, "Codeable", "telegram:parseCommand")).toEqual({ codeName: "parseCommand" });
    expect(methodOf(insts, "Labelable", "telegram:parseCommand")).toEqual({ label: "Parse command" });
    expect(methodOf(insts, "Taggable", "telegram:parseCommand")).toEqual({ tags: ["telegram", "parser", "pure"] });
    expect(methodOf(insts, "Categorizable", "telegram:parseCommand")).toBeUndefined();
    expect(methodOf(insts, "IOInvokable", "telegram:parseCommand")).toBeUndefined();
  });

  test("the inline-record return type round-trips byte-identically (meta:{} present)", () => {
    expect(fns.find((f) => f.id === "telegram:parseCommand")?.returns).toEqual(
      Maybe({
        $record: {
          fields: [
            { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
            { name: "args", label: Nothing, type: List({ $ref: "String" }), meta: {}, ui: Nothing },
          ],
        },
      }),
    );
  });
});

// ===========================================================================
// 5. BODY DISPATCH — a union-sourced decoder dispatches end-to-end
// ===========================================================================

describe("telegram 3o.1 — union-sourced decoder dispatches by codeName", () => {
  const reg = createRegistry([stdModule, codecModule, telegramModule]);
  const ctx = reg.evaluateContext();
  const wrapJsonValue = codecNatives.wrapJsonValue!;

  test("decodeChatType resolves the JsonString → Ok ChatType through the registry", () => {
    const r = evaluate(
      { call: ["decodeChatType", wrapJsonValue("private")] },
      {},
      ctx,
    ) as { $tag: string; _0: { $tag: string } };
    expect(r.$tag).toBe("Ok");
    expect(r._0.$tag).toBe("Private");
  });

  test("decodeChatType on an unknown string → Err (body unchanged from the retired spec)", () => {
    const r = evaluate(
      { call: ["decodeChatType", wrapJsonValue("nope")] },
      {},
      ctx,
    ) as { $tag: string };
    expect(r.$tag).toBe("Err");
  });
});

// ===========================================================================
// 7. PHASE 3o.2 — the FIRST capability half migrated to `.fenel`:
//    `TelegramWebhooks` (seed via `seedFromType(capability.fenel)`; bot-keyed
//    instance seam-built FROM the seed). The 3 wrinkles + the end-to-end lock.
// ===========================================================================

describe("telegram 3o.2 — TelegramWebhooks capability migrated to `.fenel`", () => {
  const WEBHOOK_METHODS = ["getUpdates", "setWebhook", "deleteWebhook", "getWebhookInfo"];

  test("the seed is `.fenel`-sourced (no const label/description; methods via seedFromType)", () => {
    const seed = caps.find((c) => c.name === "TelegramWebhooks");
    expect(seed).toBeDefined();
    // The retired TS const carried label + description; the `.fenel` seed
    // (seedFromType) carries only method names + sigs (law-neutral, email/ai
    // precedent). Their ABSENCE proves the seed is no longer the hand-written const.
    expect("label" in seed!).toBe(false);
    expect("description" in seed!).toBe(false);
    expect(seed!.params).toEqual([{ name: "a" }]);
    expect(seed!.methods.map((m) => m.name)).toEqual(WEBHOOK_METHODS);
  });

  // WRINKLE 1 — every method is authored botId-first in capability.fenel, so the
  // seed's methods carry `Id<Bot>` (the registered BotId named type) as param 0.
  test("WRINKLE 1 — seed methods are botId-first (param 0 === BotId)", () => {
    const seed = caps.find((c) => c.name === "TelegramWebhooks")!;
    for (const m of seed.methods) {
      expect(m.params?.[0]?.type).toEqual({ $ref: "BotId" });
    }
    // returns preserved: getWebhookInfo → WebhookInfo; getUpdates → List Update.
    expect(seed.methods.find((m) => m.name === "getWebhookInfo")?.returns).toEqual({ $ref: "WebhookInfo" });
    expect(seed.methods.find((m) => m.name === "setWebhook")?.returns).toEqual({ $ref: "Boolean" });
  });

  // WRINKLE 2 — the bot-keyed instance (the type-level "Bot implements
  // TelegramWebhooks" assertion) stays seam-built FROM the seed: args ["Bot"],
  // priority 50, method dict keyed by plain name with `TelegramWebhooks.<m>` ids.
  test("WRINKLE 2 — bot-keyed instance: args [Bot] priority 50 + the 4 dispatch keys", () => {
    const inst = insts.find((i) => i.typeName === "TelegramWebhooks");
    expect(inst).toBeDefined();
    expect(inst!.args).toEqual(["Bot"]);
    expect(inst!.priority).toBe(50);
    expect(Object.keys(inst!.methods).sort()).toEqual([...WEBHOOK_METHODS].sort());
    for (const name of WEBHOOK_METHODS) {
      // dict keyed by the plain method name; the value's `name` is the qualified
      // dispatch key `TelegramWebhooks.<method>` + carries botId-first params.
      const m = (inst!.methods as Record<string, { name: string; params: { type: unknown }[] }>)[name]!;
      expect(m.name).toBe(`TelegramWebhooks.${name}`);
      expect(m.params[0]?.type).toEqual({ $ref: "BotId" });
    }
  });

  // WRINKLE 3 / the parity LOCK — the runtime keys handlers
  // `${cap.name}.${method.name}` from the seed (`registerTelegramHandlers` →
  // `reg.listCapabilities()`); `io.fenel`'s getUpdatesPoll reuses
  // `TelegramWebhooks.getUpdates`. Prove the key survived the `.fenel` round-trip.
  test("WRINKLE 3 — the ClassName.methodName handler key survives end-to-end", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    // the seed (as the runtime sees it) regenerates the byte-identical key.
    const cap = reg.listCapabilities().find((c) => c.name === "TelegramWebhooks");
    expect(cap?.methods.map((m) => `${cap.name}.${m.name}`)).toContain("TelegramWebhooks.getUpdates");
    // getUpdatesPoll still carries the @ioAction that targets that key + resolves.
    expect(methodOf(insts, "IOInvokable", "telegram:getUpdatesPoll")).toEqual({
      ioAction: "TelegramWebhooks.getUpdates",
    });
    expect(reg.getFunction("telegram:getUpdatesPoll")?.id).toBe("telegram:getUpdatesPoll");
    expect(reg.getFunction("getUpdatesPoll")?.id).toBe("telegram:getUpdatesPoll");
  });

  // The `TelegramWebhooks` capability TYPE must NOT leak into the entity roster
  // (capability.fenel is loaded SEPARATELY, never merged) — the entity count
  // holds at 131 and getClass-routing for the data types is untouched.
  test("the capability type does not enter telegramModule.entities (count holds at 134)", () => {
    expect((telegramModule.entities ?? []).some((e) => e.id === "TelegramWebhooks")).toBe(false);
    expect((telegramModule.entities ?? []).length).toBe(134);
  });
});

// ===========================================================================
// 8. PHASE 3o.3 — the capability half CLOSED: the other 15 capabilities → `.fenel`
//    (the 127 remaining methods transcribed off their TS rosters; the
//    `telegramCapabilities` object-literal + `withBotIdParam` /
//    `botCapabilityInstance` helpers + ~1400 LOC RETIRED; all 16 now seam-derived
//    from capability.fenel via `seedFromType` + `instanceFromCapabilitySeed`).
// ===========================================================================

// The retired rosters' method names, in declared order (the `.fenel` field order
// is preserved by seedFromType). The data-driven loop asserts (b) names match.
const CAP_METHODS: Record<string, string[]> = {
  TelegramLifecycle: ["getMe", "logOut", "close"],
  TelegramWebhooks: ["getUpdates", "setWebhook", "deleteWebhook", "getWebhookInfo"],
  TelegramMessages: [
    "sendMessage", "editMessageText", "editMessageReplyMarkup", "deleteMessage", "deleteMessages",
    "forwardMessage", "forwardMessages", "copyMessage", "copyMessages", "editMessageCaption",
    "editMessageMedia", "sendChatAction", "setMessageReaction",
  ],
  TelegramCallbacks: ["answerCallbackQuery"],
  TelegramMedia: [
    "sendPhoto", "sendAudio", "sendDocument", "sendVideo", "sendAnimation", "sendVoice",
    "sendVideoNote", "sendMediaGroup", "sendLocation", "sendVenue", "sendContact",
  ],
  TelegramFiles: ["getFile", "getUserProfilePhotos"],
  TelegramChatAdmin: [
    "banChatMember", "unbanChatMember", "restrictChatMember", "promoteChatMember", "setChatPermissions",
    "exportChatInviteLink", "createChatInviteLink", "editChatInviteLink", "revokeChatInviteLink",
    "approveChatJoinRequest", "declineChatJoinRequest", "pinChatMessage", "unpinChatMessage",
    "unpinAllChatMessages", "leaveChat", "getChat", "getChatAdministrators", "getChatMemberCount",
    "getChatMember",
  ],
  TelegramBotConfig: [
    "setMyCommands", "deleteMyCommands", "getMyCommands", "setMyName", "getMyName", "setMyDescription",
    "getMyDescription", "setMyShortDescription", "getMyShortDescription", "setChatMenuButton",
    "getChatMenuButton",
  ],
  TelegramPayments: [
    "sendInvoice", "createInvoiceLink", "answerShippingQuery", "answerPreCheckoutQuery",
    "getMyStarBalance", "getStarTransactions", "refundStarPayment", "editUserStarSubscription",
  ],
  TelegramInlineMode: ["answerInlineQuery", "answerWebAppQuery", "savePreparedInlineMessage"],
  TelegramStickers: [
    "sendSticker", "getStickerSet", "getCustomEmojiStickers", "uploadStickerFile", "createNewStickerSet",
    "addStickerToSet", "setStickerPositionInSet", "deleteStickerFromSet", "replaceStickerInSet",
    "setStickerEmojiList", "setStickerKeywords", "setStickerMaskPosition", "setStickerSetTitle",
    "setStickerSetThumbnail", "setCustomEmojiStickerSetThumbnail", "deleteStickerSet",
  ],
  TelegramPassport: ["setPassportDataErrors"],
  TelegramGames: ["sendGame", "setGameScore", "getGameHighScores"],
  TelegramPolls: ["sendPoll", "stopPoll", "sendDice", "sendChecklist", "editMessageChecklist"],
  TelegramForumTopics: [
    "getForumTopicIconStickers", "createForumTopic", "editForumTopic", "closeForumTopic",
    "reopenForumTopic", "deleteForumTopic", "unpinAllForumTopicMessages", "editGeneralForumTopic",
    "closeGeneralForumTopic", "reopenGeneralForumTopic", "hideGeneralForumTopic", "unhideGeneralForumTopic",
  ],
  TelegramBusiness: [
    "getBusinessConnection", "readBusinessMessage", "deleteBusinessMessages", "setBusinessAccountName",
    "setBusinessAccountUsername", "setBusinessAccountBio", "setBusinessAccountGiftSettings",
    "getBusinessAccountStarBalance", "transferBusinessAccountStars", "getAvailableGifts", "sendGift",
    "giftPremiumSubscription", "verifyUser", "verifyChat", "removeUserVerification",
    "removeChatVerification", "postStory", "editStory", "deleteStory",
  ],
};

describe("telegram 3o.3 — all 16 capabilities are `.fenel`-sourced + seam-derived", () => {
  test("(a) every seed is `.fenel`-sourced — NO const label/description (seedFromType)", () => {
    for (const name of Object.keys(CAP_METHODS)) {
      const seed = caps.find((c) => c.name === name);
      expect(seed, name).toBeDefined();
      // The retired TS consts carried label + description; the `.fenel` seeds
      // carry only method names + sigs (law-neutral, email/ai precedent).
      expect("label" in seed!, `${name} label absent`).toBe(false);
      expect("description" in seed!, `${name} description absent`).toBe(false);
      expect(seed!.params).toEqual([{ name: "a" }]);
    }
  });

  test("(b) method names + order match the retired rosters (127 + 4 = 131 methods)", () => {
    let total = 0;
    for (const [name, methods] of Object.entries(CAP_METHODS)) {
      const seed = caps.find((c) => c.name === name)!;
      expect(seed.methods.map((m) => m.name), name).toEqual(methods);
      total += methods.length;
    }
    expect(total).toBe(131);
  });

  test("(c) every method across all 16 is botId-first (param 0 === BotId)", () => {
    for (const name of Object.keys(CAP_METHODS)) {
      const seed = caps.find((c) => c.name === name)!;
      for (const m of seed.methods) {
        expect(m.params?.[0]?.type, `${name}.${m.name}`).toEqual({ $ref: "BotId" });
      }
    }
  });

  test("(d) each bot-keyed instance: args [Bot] priority 50, dispatch keys `<Cap>.<method>`", () => {
    for (const [name, methods] of Object.entries(CAP_METHODS)) {
      const inst = insts.find((i) => i.typeName === name);
      expect(inst, name).toBeDefined();
      expect(inst!.args).toEqual(["Bot"]);
      expect(inst!.priority).toBe(50);
      expect(Object.keys(inst!.methods).sort()).toEqual([...methods].sort());
      for (const mn of methods) {
        const m = (inst!.methods as Record<string, { name: string; params: { type: unknown }[] }>)[mn]!;
        expect(m.name).toBe(`${name}.${mn}`);
        expect(m.params[0]?.type).toEqual({ $ref: "BotId" });
      }
    }
  });

  // Spot-check param-heavy sigs byte-faithful to the retired rosters — the
  // fidelity guarantee (the bulk's only real risk). The `$ref` substitutions
  // (BotId / MessageText / CallbackText / Url) are the intended Wave-A change.
  test("spot-check: sendMessage's 11 params (+ botId) are byte-faithful", () => {
    const m = caps
      .find((c) => c.name === "TelegramMessages")!
      .methods.find((x) => x.name === "sendMessage")!;
    expect(m.params?.map((p) => p.type)).toEqual([
      { $ref: "BotId" },
      { $ref: "ChatRef" },
      { $ref: "MessageText" },
      Maybe({ $ref: "ParseMode" }),
      List({ $ref: "MessageEntity" }),
      Maybe({ $ref: "LinkPreviewOptions" }),
      Maybe({ $ref: "Boolean" }),
      Maybe({ $ref: "Boolean" }),
      Maybe({ $ref: "ReplyParameters" }),
      Maybe({ $ref: "ReplyMarkup" }),
      Maybe({ $ref: "String" }),
      Maybe({ $ref: "Int" }),
    ]);
    expect(m.returns).toEqual({ $ref: "Message" });
  });

  test("spot-check: promoteChatMember's ChatAdministratorRights param survives by name", () => {
    const m = caps
      .find((c) => c.name === "TelegramChatAdmin")!
      .methods.find((x) => x.name === "promoteChatMember")!;
    expect(m.params?.map((p) => p.type)).toEqual([
      { $ref: "BotId" },
      { $ref: "ChatRef" },
      { $ref: "Int" },
      { $ref: "ChatAdministratorRights" },
    ]);
    expect(m.returns).toEqual({ $ref: "Boolean" });
  });

  test("spot-check: answerCallbackQuery references CallbackText (≤200 toast) + Url by name", () => {
    const m = caps
      .find((c) => c.name === "TelegramCallbacks")!
      .methods.find((x) => x.name === "answerCallbackQuery")!;
    expect(m.params?.map((p) => p.type)).toEqual([
      { $ref: "BotId" },
      { $ref: "String" },
      Maybe({ $ref: "CallbackText" }),
      Maybe({ $ref: "Boolean" }),
      Maybe({ $ref: "Url" }),
      Maybe({ $ref: "Int" }),
    ]);
    expect(m.returns).toEqual({ $ref: "Boolean" });
  });

  // The 3 inline-refined param types registered as named entities (step 0).
  // `withBotIdParam` / `botCapabilityInstance` are RETIRED — proven by the seam
  // compiling without them (this file imports only `telegramCapabilities`).
  test("MessageText / CallbackData / CallbackText registered as named entities", () => {
    const ents = (telegramModule.entities ?? []).map((e) => e.id);
    expect(ents).toContain("MessageText");
    expect(ents).toContain("CallbackData");
    expect(ents).toContain("CallbackText");
  });

  // WRINKLE 3 — the runtime keys handlers `${cap.name}.${method.name}` from the
  // seeds; prove a param-heavy capability's keys regenerate through the registry.
  test("WRINKLE 3 — ChatAdmin dispatch keys regenerate through the registry", () => {
    const reg = createRegistry([stdModule, codecModule, telegramModule]);
    const cap = reg.listCapabilities().find((c) => c.name === "TelegramChatAdmin");
    const keys = cap?.methods.map((m) => `${cap.name}.${m.name}`) ?? [];
    expect(keys).toContain("TelegramChatAdmin.banChatMember");
    expect(keys).toContain("TelegramChatAdmin.getChatMember");
    expect(keys.length).toBe(19);
  });
});
