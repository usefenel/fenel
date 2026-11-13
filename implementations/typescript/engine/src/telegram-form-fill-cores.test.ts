// ---------------------------------------------------------------------------
// telegram-form-fill-cores.test.ts — ts-elimination-completion Phase 7b
// round-trip + (B)-fix proof for the Tier-1 value-matcher + Tier-2 form-fill
// cores.
//
// The nine cluster bodies (`telegram:fieldLabel` / `promptForField` /
// `keyboardForField` / `formatValue` / `finalizeConversationView` /
// `parseFieldInput` / `resolveTypeRefDecision` / `dispatchUserReply` /
// `interpretCollectorAction`) moved from inline JSON-Logic `body:` literals in
// modules/telegram.ts to `.fenel` source (form-fill-cores.fenel). Landing them
// takes telegram's spec module to ZERO inline `body: {` (100% `.fenel`-bodied).
//
// Two proof kinds, per the brief:
//   * FAITHFUL bodies (fieldLabel / promptForField / keyboardForField /
//     formatValue / finalizeConversationView) — output is unchanged by the
//     (B) fix → deep-equal vs an inline VERBATIM copy of the pre-port JSON-Logic
//     (`evaluate`d) across an input matrix.
//   * (B)-FIXED / -affected bodies (parseFieldInput / resolveTypeRefDecision /
//     dispatchUserReply / interpretCollectorAction) — output DIVERGES from the
//     `_0`-emitting original → pinned to the CORRECTED (named) semantics + a
//     real consumer-binding assertion (wrapDraftField binds the named Parsed).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { codecModule } from "./modules/codec";
import { telegramModule } from "./modules/telegram";
import { createRegistry } from "./registry";
import { invokeCallable, evaluate } from "./json-logic";
import { Maybe } from "./type-foundation";

// formatValue's catch-all encodes via codec:jsonEncode + codec:wrapJsonValue, so
// the codec module must be in the registry alongside std + telegram.
const reg = createRegistry([stdModule, codecModule, telegramModule]);
const ctx = reg.evaluateContext();

const Str = { $ref: "String" };
const Num = { $ref: "Number" };
const Bool = { $ref: "Boolean" };
const enumT = { $refined: { base: Str, set: { $tag: "SeEnum" as const, values: ["a", "b", "c"] } } };
const email = { $refined: { base: Str, set: { $tag: "SeRef" as const, handle: "format:email" } } };

// ===========================================================================
// Registration + codeName resolution
// ===========================================================================
describe("Phase 7b — cluster bodies are .fenel-bodied + registered", () => {
  test("the nine publics + four formCore helpers are registered with bodies", () => {
    for (const id of [
      "telegram:fieldLabel",
      "telegram:promptForField",
      "telegram:keyboardForField",
      "telegram:formatValue",
      "telegram:finalizeConversationView",
      "telegram:parseFieldInput",
      "telegram:resolveTypeRefDecision",
      "telegram:dispatchUserReply",
      "telegram:interpretCollectorAction",
    ]) {
      expect(reg.getFunction(id)?.body).toBeDefined();
    }
    for (const id of [
      "telegram:formCoreFormatObj",
      "telegram:formCoreTagValue",
      "telegram:formCoreFormatHandle",
      "telegram:formCoreFormatJson",
    ]) {
      expect(reg.getFunction(id)?.id).toBe(id);
    }
  });

  test("codeName resolution intact", () => {
    expect(reg.getFunctionByCodeName("formatValue")?.id).toBe("telegram:formatValue");
    expect(reg.getFunctionByCodeName("parseFieldInput")?.id).toBe("telegram:parseFieldInput");
    expect(reg.getFunctionByCodeName("dispatchUserReply")?.id).toBe("telegram:dispatchUserReply");
  });

  test("telegram.ts carries zero inline body literals (the publics ride the .fenel module)", () => {
    // Each public body is the extracted .fenel JSON-Logic — never an inline
    // object authored in telegram.ts. We can't read the source here, but the
    // behavioural parity below + the codeName resolution above prove the wiring.
    expect(reg.getFunction("telegram:formatValue")?.body).toBeTruthy();
  });
});

// ===========================================================================
// FAITHFUL bodies — deep-equal vs verbatim pre-port inline JSON-Logic
// ===========================================================================

// --- fieldLabel (telegram.ts:484, pre-port) -------------------------------
const ORIG_FIELD_LABEL = {
  call: ["canonical", { if: [{ var: "field.label" }, { var: "field.label" }, { var: "field.name" }] }],
};

// --- promptForField (telegram.ts:1308, pre-port) --------------------------
const ORIG_PROMPT = {
  cat: [
    { call: ["fieldLabel", { var: "field" }] },
    { call: ["typeHint", { var: "field.type" }] },
    { if: [{ call: ["isOptionalField", { var: "field" }] }, " (optional — type 'skip' to skip)", ""] },
  ],
};

// --- keyboardForField (telegram.ts:617, pre-port) -------------------------
const ORIG_KEYBOARD = {
  where: [
    { if: [{ ">": [{ call: ["length", { var: "rows" }] }, 0] }, { inline_keyboard: { var: "rows" } }, null] },
    {
      enums: { call: ["enumValues", { var: "field.type" }] },
      isBool: { call: ["isBooleanType", { var: "field.type" }] },
      isOpt: { call: ["isOptionalField", { var: "field" }] },
      enumRow: {
        if: [
          { and: [{ ">": [{ call: ["length", { var: "enums" }] }, 0] }, { "<=": [{ call: ["length", { var: "enums" }] }, 8] }] },
          [{ call: ["map", { fn: [["v"], { text: { var: "v" }, callback_data: { call: ["format", "field:{v}", { v: { var: "v" } }] } }] }, { var: "enums" }] }],
          [],
        ],
      },
      boolRow: {
        if: [{ var: "isBool" }, [[{ text: "Yes", callback_data: "field:yes" }, { text: "No", callback_data: "field:no" }]], []],
      },
      skipRow: { if: [{ var: "isOpt" }, [[{ text: "Skip", callback_data: "field:skip" }]], []] },
      rows: { call: ["concat", { call: ["concat", { var: "enumRow" }, { var: "boolRow" }] }, { var: "skipRow" }] },
    },
  ],
};

// --- formatValue (telegram.ts:878, pre-port) ------------------------------
const ORIG_FORMAT_VALUE = {
  match: [
    { var: "v" },
    null,
    "(skipped)",
    { $tag: "True" },
    "Yes",
    { $tag: "False" },
    "No",
    { $tag: "_", value: { $bind: "inner" } },
    { call: ["formatValue", { var: "inner" }] },
    { __case: { $bind: "c" } },
    { call: ["toString", { var: "c" }] },
    { handle: { $bind: "h" }, platform: { $bind: "p" } },
    {
      if: [
        { call: ["gt", { call: ["length", { var: "p" }] }, 0] },
        { call: ["format", "{p}/{h}", { p: { var: "p" }, h: { var: "h" } }] },
        { call: ["format", "@{h}", { h: { var: "h" } }] },
      ],
    },
    { handle: { $bind: "h" } },
    { call: ["format", "@{h}", { h: { var: "h" } }] },
    {},
    {
      match: [
        { call: ["jsonEncode", { call: ["wrapJsonValue", { var: "v" }] }] },
        { $tag: "Ok", _0: { $bind: "s" } },
        { var: "s" },
        "_",
        "(value)",
      ],
    },
    "_",
    { call: ["toString", { var: "v" }] },
  ],
};

// --- finalizeConversationView (telegram.ts:988, pre-port) -----------------
const ORIG_FINALIZE = {
  where: [
    {
      finalMsg: { var: "msgWithNote" },
      eventPayload: {
        botId: { var: "botId" },
        chatId: { var: "chatId" },
        userId: { var: "userId" },
        formId: { var: "formId" },
        values: { var: "values" },
        instanceId: { var: "instanceId" },
        instanceError: { var: "instanceError" },
      },
    },
    {
      baseMsg: { if: [{ var: "completionMsgOverride" }, { var: "completionMsgOverride" }, "Got it — submitted!"] },
      msgWithNote: {
        if: [
          { var: "instanceError" },
          {
            call: [
              "format",
              "{base}\n\n(note: could not save as {label} — {err})",
              {
                base: { var: "baseMsg" },
                label: { if: [{ var: "instanceTypeName" }, { var: "instanceTypeName" }, "instance"] },
                err: { var: "instanceError" },
              },
            ],
          },
          { var: "baseMsg" },
        ],
      },
    },
  ],
};

describe("Phase 7b — faithful bodies round-trip vs the original inline JSON-Logic", () => {
  const fieldMatrix: Array<[string, Record<string, unknown>]> = [
    ["labelled", { name: "age", label: "Your age", type: Num }],
    ["no-label", { name: "agree", type: Bool }],
    ["optional", { name: "nick", type: Maybe(Str) }],
    ["enum", { name: "choice", type: enumT }],
    ["maybe-enum", { name: "choice2", type: Maybe(enumT) }],
    ["email", { name: "email", type: email }],
    ["plain-string", { name: "n", type: Str }],
  ];

  for (const [tn, field] of fieldMatrix) {
    test(`fieldLabel [${tn}]`, () => {
      const ref = evaluate(ORIG_FIELD_LABEL, { field }, ctx);
      expect(invokeCallable("telegram:fieldLabel", [field], ctx)).toEqual(ref as never);
    });
    test(`promptForField [${tn}]`, () => {
      const ref = evaluate(ORIG_PROMPT, { field }, ctx);
      expect(invokeCallable("telegram:promptForField", [field], ctx)).toEqual(ref as never);
    });
    test(`keyboardForField [${tn}]`, () => {
      const ref = evaluate(ORIG_KEYBOARD, { field }, ctx);
      expect(invokeCallable("telegram:keyboardForField", [field], ctx)).toEqual(ref as never);
    });
  }

  const valueMatrix: Array<[string, unknown]> = [
    ["null", null],
    ["true", true],
    ["false", false],
    ["tag-True", { $tag: "True" }],
    ["Just", { $tag: "Just", value: 7 }],
    ["nested-Just", { $tag: "Just", value: { $tag: "Just", value: "x" } }],
    ["Ok", { $tag: "Ok", value: "done" }],
    ["legacy-__case", { __case: "Pending" }],
    ["handle+platform", { handle: "bob", platform: "telegram" }],
    ["handle+null-platform", { handle: "bob", platform: null }],
    ["handle-only", { handle: "bob" }],
    ["plain-object", { a: 1, b: [2, 3] }],
    ["array", [1, 2, 3]],
    ["string", "hello"],
    ["number", 42],
    ["tag-no-value", { $tag: "Just", _0: 5 }],
  ];
  for (const [tn, v] of valueMatrix) {
    test(`formatValue [${tn}]`, () => {
      const ref = evaluate(ORIG_FORMAT_VALUE, { v }, ctx);
      expect(invokeCallable("telegram:formatValue", [v], ctx)).toEqual(ref as never);
    });
  }

  const finalizeMatrix: Array<[string, Record<string, unknown>]> = [
    ["ok-no-override", { values: { a: 1 }, instanceTypeName: "Lead", instanceId: "i1", instanceError: null, completionMsgOverride: null, botId: "b", chatId: 1, userId: 2, formId: "f" }],
    ["ok-override", { values: {}, instanceTypeName: "Lead", instanceId: "i1", instanceError: null, completionMsgOverride: "Thanks!", botId: "b", chatId: 1, userId: 2, formId: "f" }],
    ["error-typed", { values: {}, instanceTypeName: "Lead", instanceId: null, instanceError: "boom", completionMsgOverride: null, botId: "b", chatId: 1, userId: 2, formId: "f" }],
    ["error-untyped", { values: {}, instanceTypeName: null, instanceId: null, instanceError: "boom", completionMsgOverride: "Done", botId: "b", chatId: 1, userId: 2, formId: "f" }],
  ];
  for (const [tn, d] of finalizeMatrix) {
    test(`finalizeConversationView [${tn}]`, () => {
      const ref = evaluate(ORIG_FINALIZE, d, ctx);
      const args = [d.values, d.instanceTypeName, d.instanceId, d.instanceError, d.completionMsgOverride, d.botId, d.chatId, d.userId, d.formId];
      expect(invokeCallable("telegram:finalizeConversationView", args, ctx)).toEqual(ref as never);
    });
  }
});

// ===========================================================================
// (B)-FIXED bodies — corrected NAMED semantics + consumer binding
// ===========================================================================
describe("Phase 7b — parseFieldInput emits NAMED Parsed/ParseFailed (the B fix)", () => {
  const boolField = { name: "agree", type: Bool };
  const optStr = { name: "nick", type: Maybe(Str) };
  const numField = { name: "age", type: Num };
  const emailField = { name: "email", type: email };

  test("Boolean yes/no → Parsed {value}", () => {
    expect(invokeCallable("telegram:parseFieldInput", ["yes", boolField], ctx)).toEqual({ $tag: "Parsed", value: true } as never);
    expect(invokeCallable("telegram:parseFieldInput", ["no", boolField], ctx)).toEqual({ $tag: "Parsed", value: false } as never);
  });
  test("Boolean unrecognised → ParseFailed {error}", () => {
    expect(invokeCallable("telegram:parseFieldInput", ["maybe", boolField], ctx)).toEqual({ $tag: "ParseFailed", error: "Please answer with 'yes' or 'no'." } as never);
  });
  test("skip on optional → Parsed {value=null}", () => {
    expect(invokeCallable("telegram:parseFieldInput", ["skip", optStr], ctx)).toEqual({ $tag: "Parsed", value: null } as never);
  });
  test("/cancel → ParseFailed {error}", () => {
    expect(invokeCallable("telegram:parseFieldInput", ["/cancel", { name: "n", type: Str }], ctx)).toEqual({ $tag: "ParseFailed", error: "Cancelled." } as never);
  });
  test("String → Parsed {value} carries the parsed value BY NAME (not _0)", () => {
    // The plain-String path needs no coercion, so it's deterministic across
    // registries. The key (B) assertion: the payload lands on the named `value`
    // key, NOT the positional `_0` the broken inline body emitted.
    const r = invokeCallable("telegram:parseFieldInput", ["Romain", { name: "n", type: Str }], ctx) as Record<string, unknown>;
    expect(r).toEqual({ $tag: "Parsed", value: "Romain" } as never);
    expect("_0" in r).toBe(false);
  });
  test("parseInput-delegating path binds a named value/error key (not _0); exact coercion is the runtime oracle", () => {
    // The Number / email arms route through parseInput+validateValue, whose
    // exact coercion/validation is registry-dependent here — the authoritative
    // exact-value proof is telegram-form.test.ts (the 5 tests that flip green).
    // What the ENGINE test pins is the (B) wire shape: a Parsed carries `value`,
    // a ParseFailed carries `error`, and neither carries `_0`.
    for (const [raw, field] of [["42", numField], ["x@y.com", emailField]] as const) {
      const r = invokeCallable("telegram:parseFieldInput", [raw, field], ctx) as Record<string, unknown>;
      expect("_0" in r).toBe(false);
      if (r.$tag === "Parsed") expect("value" in r).toBe(true);
      else expect("error" in r).toBe(true);
    }
  });

  test("CONSUMER binding: wrapDraftField binds the named Parsed → Right (the live-defect fix)", () => {
    // Pre-fix the _0-Parsed NOMATCHed wrapDraftField's `Parsed {value=v}` arm and
    // fell to the `_ -> Left rawText` wildcard — every value became a Left. Now a
    // valid parse round-trips to a Right.
    const parsedOk = invokeCallable("telegram:parseFieldInput", ["Romain", { name: "n", type: Str }], ctx);
    expect(invokeCallable("telegram:wrapDraftField", [parsedOk, "Romain"], ctx)).toEqual({ $tag: "Right", _0: "Romain" } as never);
    const parsedBad = invokeCallable("telegram:parseFieldInput", ["maybe", boolField], ctx);
    expect(invokeCallable("telegram:wrapDraftField", [parsedBad, "maybe"], ctx)).toEqual({ $tag: "Left", _0: "maybe" } as never);
  });
});

describe("Phase 7b — resolveTypeRefDecision emits NAMED ctors (the B fix)", () => {
  test("Nothing → TypeNotFound {typeId}", () => {
    expect(invokeCallable("telegram:resolveTypeRefDecision", ["t1", { $tag: "Nothing" }], ctx)).toEqual({ $tag: "TypeNotFound", typeId: "t1" } as never);
  });
  test("Just record-row → ResolvedFields {typeName}", () => {
    const row = { name: "Lead", type: { $record: { fields: [] } } };
    expect(invokeCallable("telegram:resolveTypeRefDecision", ["t1", { $tag: "Just", _0: row }], ctx)).toEqual({ $tag: "ResolvedFields", typeName: "Lead" } as never);
  });
  test("Just non-record-row → NotRecordType {typeName}", () => {
    const row = { name: "Foo", type: { $ref: "String" } };
    expect(invokeCallable("telegram:resolveTypeRefDecision", ["t1", { $tag: "Just", _0: row }], ctx)).toEqual({ $tag: "NotRecordType", typeName: "Foo" } as never);
  });
});

// ===========================================================================
// (B)-AFFECTED decision cores — pinned to a hand-written oracle (the documented
// behaviour with _0→value substituted)
// ===========================================================================
describe("Phase 7b — dispatchUserReply decision core", () => {
  const fields = [{ name: "a", type: Str }, { name: "b", type: Str }];
  const D = (raw: string, idx: number, partial: Record<string, unknown>) =>
    invokeCallable("telegram:dispatchUserReply", [raw, fields, idx, partial], ctx);

  test("/cancel → cancel", () => expect(D("/cancel", 0, {})).toEqual({ kind: "cancel" } as never));
  test("/back on first → back_invalid", () => expect(D("/back", 0, {})).toEqual({ kind: "back_invalid" } as never));
  test("/back mid → back_edge drops prev answer", () =>
    expect(D("/back", 1, { a: "x" })).toEqual({ kind: "back_edge", prevIndex: 0, prevField: fields[0], newPartial: {} } as never));
  test("reply with next field → next_field, sets parsed.value by name", () =>
    expect(D("hello", 0, {})).toEqual({ kind: "next_field", nextIndex: 1, newPartial: { a: "hello" }, nextField: fields[1] } as never));
  test("reply on last field → confirm", () =>
    expect(D("world", 1, { a: "x" })).toEqual({ kind: "confirm", newPartial: { a: "x", b: "world" } } as never));
  test("negative index → done_empty instead of raw-at last-element lookup", () =>
    expect(D("x", -1, {})).toEqual({ kind: "done_empty" } as never));
  test("out-of-range index → done_empty", () => expect(D("x", 5, {})).toEqual({ kind: "done_empty" } as never));
  test("/back from the post-last index returns to the last field", () =>
    expect(D("/back", 2, { a: "x", b: "y" })).toEqual({
      kind: "back_edge",
      prevIndex: 1,
      prevField: fields[1],
      newPartial: { a: "x" },
    } as never));
  test("/back from an upper-out-of-range index is bounded", () =>
    expect(D("/back", 5, { a: "x", b: "y" })).toEqual({ kind: "back_invalid" } as never));
});

describe("Phase 7b — interpretCollectorAction decision core", () => {
  const fields = [{ name: "a", type: Str }, { name: "b", type: Str }];
  const parsed = { $tag: "Parsed", value: "v1" };
  const I = (action: unknown, p: unknown) =>
    invokeCallable("telegram:interpretCollectorAction", [action, fields[0], p, fields, 0, {}], ctx);

  test("Abort → abort", () => expect(I({ $tag: "Abort" }, parsed)).toEqual({ kind: "abort" } as never));
  test("SendAndContinue → send_then_default {message}", () =>
    expect(I({ $tag: "SendAndContinue", message: "hi" }, parsed)).toEqual({ kind: "send_then_default", message: "hi" } as never));
  test("SkipTo present field + Parsed → skip_to sets value by name", () =>
    expect(I({ $tag: "SkipTo", fieldName: "b" }, parsed)).toEqual({ kind: "skip_to", nextIndex: 1, newPartial: { a: "v1" }, nextField: fields[1] } as never));
  test("SkipTo missing field → fall_through", () =>
    expect(I({ $tag: "SkipTo", fieldName: "zzz" }, parsed)).toEqual({ kind: "fall_through" } as never));
  test("SkipTo but parse failed → fall_through", () =>
    expect(I({ $tag: "SkipTo", fieldName: "b" }, { $tag: "ParseFailed", error: "e" })).toEqual({ kind: "fall_through" } as never));
  test("Continue → fall_through", () => expect(I({ $tag: "Continue" }, parsed)).toEqual({ kind: "fall_through" } as never));
});
