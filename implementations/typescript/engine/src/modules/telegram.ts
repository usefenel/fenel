// ---------------------------------------------------------------------------
// Telegram — the full Telegram Bot API surface modelled as Fenel types and
// functions, organised into sub-capabilities.
//
// Shape (mirrors `email.ts`):
//   - Data types (User / Chat / Message / Update / keyboards / …) live in
//     the `.fenel` source string. Types are pure data; constraints (text ≤
//     4096 chars, callback_data ≤ 64 bytes, …) are enforced at function-
//     signature level via `$refined` types where they matter most.
//   - Sub-capabilities (`TelegramLifecycle`, `TelegramWebhooks`,
//     `TelegramMessages`, `TelegramCallbacks`, …) are abstract bot
//     contracts. Each ships exactly one typeclass instance keyed by the
//     `bot` type — methods take `Id<bot>` as their first param so the
//     runtime can dispatch to the right registered bot. This is the
//     conventional "instances are on types, not values" shape; no
//     per-bot derivation runs at registration time.
//   - Bots themselves are persisted as `entity_instances` rows
//     (entity_type = "bot"), addressable by `Id<bot>`. The bot's
//     identity (label / icon / emoji / description) lives as
//     per-instance representation typeclass instances written when
//     `runTelegramCollector` succeeds.
//
// Stage 1 ships the P1 surface: enough to run a form-fill conversation
// (sendMessage / editMessageText / answerCallbackQuery / getUpdates /
// setWebhook). P2 (media, chat admin) and P3 (payments, business, gifts,
// stickers, inline mode, …) layer in subsequent passes.
// ---------------------------------------------------------------------------

import type {
  FenelFunction,
  FenelModule,
  FenelType,
  Interface,
  Instance,
  InterfaceMethod,
} from "../types";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import { seedFromType } from "../effect-dispatch";
import TELEGRAM_SRC from "../../../../../fenel/modules/telegram/types.fenel?raw";
import CAPABILITY_FENEL from "../../../../../fenel/modules/telegram/capability.fenel?raw";
import RUN_COLLECTOR_FENEL from "../../../../../fenel/modules/telegram/run-collector.fenel?raw";
import STOP_COLLECTOR_FENEL from "../../../../../fenel/modules/telegram/stop-collector.fenel?raw";
import LIST_COLLECTORS_FENEL from "../../../../../fenel/modules/telegram/list-collectors.fenel?raw";
import HANDLE_UPDATE_FENEL from "../../../../../fenel/modules/telegram/handle-update.fenel?raw";
import START_FORM_FENEL from "../../../../../fenel/modules/telegram/start-form.fenel?raw";
import FINALIZE_CONVERSATION_FENEL from "../../../../../fenel/modules/telegram/finalize-conversation.fenel?raw";
import ROUTE_CONFIRMATION_FENEL from "../../../../../fenel/modules/telegram/route-confirmation.fenel?raw";
import ROUTE_TELEGRAM_MESSAGE_FENEL from "../../../../../fenel/modules/telegram/route-telegram-message.fenel?raw";
import ROUTE_TELEGRAM_MESSAGE_WITH_HOOK_FENEL from "../../../../../fenel/modules/telegram/route-telegram-message-with-hook.fenel?raw";
import STEP_CONVERSATION_FENEL from "../../../../../fenel/modules/telegram/step-conversation.fenel?raw";
import PARSE_COMMAND_FENEL from "../../../../../fenel/modules/telegram/parse-command.fenel?raw";
import CONVERSATION_FENEL from "../../../../../fenel/modules/telegram/conversation.fenel?raw";
import DECODERS_FENEL from "../../../../../fenel/modules/telegram/decoders.fenel?raw";
import IO_FENEL from "../../../../../fenel/modules/telegram/io.fenel?raw";
import POLL_FENEL from "../../../../../fenel/modules/telegram/poll.fenel?raw";
import FORMAT_FENEL from "../../../../../fenel/modules/telegram/format.fenel?raw";
import WEBHOOK_WRAPPER_FENEL from "../../../../../fenel/modules/telegram/webhook-wrapper.fenel?raw";
// ts-elimination-completion Phase 7 — the Tier-0 raw-FenelType peelers
// (innerType / isOptionalField / typeHint / enumValues / isBooleanType) moved
// from inline JSON-Logic `body:` literals to `.fenel` source. The bodies read
// the `$`-keyed type fields via `std:lookup` (Step-0 decision C — see the
// header of the .fenel file + notes/phase-7-telegram-reflection-cluster.md).
import FORM_TYPE_REFLECTION_FENEL from "../../../../../fenel/modules/telegram/form-type-reflection.fenel?raw";
// ts-elimination-completion Phase 7b — the Tier-1 value-matcher (`formatValue`)
// + the Tier-2 form-fill decision/render cores. Moves the remaining 9 inline
// JSON-Logic `body:` literals to `.fenel` source. With these landed telegram's
// spec module is 100% `.fenel`-bodied (zero inline `body: {`). The 4 ADT-emitting
// cores construct NAMED (the (B) wire fix — see the .fenel header +
// notes/phase-7-telegram-reflection-cluster.md §6).
import FORM_FILL_CORES_FENEL from "../../../../../fenel/modules/telegram/form-fill-cores.fenel?raw";
import { Maybe, Nothing } from "../type-foundation";

// Bot — declared as a Fenel system entity in `system-entities.ts` and
// persisted as an `entity_instances` row (entity_type = "bot"), keyed
// by a UUID that flows through Fenel as `Id<bot>`. Capability typeclass
// instances are type-level (one per capability, keyed by `args: ["bot"]`)
// — `botId` is a method param, not part of the instance args. Identity
// (label / icon / emoji / description) is registered as per-instance
// representation typeclass instances when `runTelegramCollector` succeeds.

// ---------------------------------------------------------------------------
// Source — Telegram primitives as ADTs.
//
// Records (single constructor, all named fields) may be compact or use
// indented field continuations. Variants use leading `|` for multiline peers.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Refined type aliases — used in function signatures where the Telegram
// constraint matters (URLs, handles, callback_data byte cap, etc.). Field-
// level refinement in `.fenel` source isn't supported yet, so these live at
// the TS level and are referenced from method signatures.
// ---------------------------------------------------------------------------

const stringType: FenelType = { $ref: "String" };

/** Host-authored concrete entities carry their monomorphic scheme at the
 * declaration site.  The registry may project this body, but must never infer
 * constructor authority from the compatibility `type` field. */
function groundEntity(
  id: string,
  type: FenelType,
): NonNullable<FenelModule["entities"]>[number] {
  return { id, type, typeScheme: { quantified: [], body: type } };
}

/** Refined String constrained to a well-formed URL via the existing
 *  `format:url` named format. */
const urlType: FenelType = {
  $refined: { base: stringType, set: { $tag: "SeRef", handle: "format:url" } },
};

/** Refined String matching Telegram's bot token format
 *  `<bot_id>:<35-char-secret>` via the `format:bot-token` named format — the
 *  same shape `urlType` above already uses.
 *
 *  decide-substrate Phase 4T Step W2 — this was previously a `SeWhere` whose
 *  predicate was `{match: [{var:"value"}, "^\\d+:[A-Za-z0-9_-]{35}$"]}`. That is
 *  NOT a regex test: JSON Logic's `match` op is pattern-MATCH (scrutinee, then
 *  pattern/result pairs), so the two-argument form has no pair and returns its
 *  trailing argument — the regex STRING — for every input. `truthy` on that
 *  string is `true`, so **every string validated as a BotToken**, `"not-a-token"
 *  included (measured). The W2 membership gate turns the non-Boolean into
 *  `Nothing`, which would flip the same predicate to rejecting every token, so
 *  the predicate is repaired in the same slice. The pattern itself is registered
 *  in `format-presets.ts` (see the note there for why it cannot be built inline
 *  here — importing the regex shim into a SYSTEM_MODULE spec file breaks the
 *  engine bootstrap's module eval order). */
const botTokenType: FenelType = {
  $opaque: {
    name: "BotToken",
    pure: {
      $refined: {
        base: stringType,
        set: { $tag: "SeRef", handle: "format:bot-token" },
      },
    },
  },
};

/** Refined String for Telegram's `callback_data` field — 1 to 64 bytes
 *  UTF-8. We approximate as 1-64 chars; runtime validation should check
 *  byte length when populating. */
const callbackDataType: FenelType = {
  $refined: {
    base: stringType,
    set: { $tag: "SeWhere", pred: {
        and: [
          { ">=": [{ length: { var: "value" } }, 1] },
          { "<=": [{ length: { var: "value" } }, 64] },
        ],
      } },
  },
};

/** Refined String for message text — up to 4096 chars. */
const messageTextType: FenelType = {
  $refined: {
    base: stringType,
    set: { $tag: "SeWhere", pred: { "<=": [{ length: { var: "value" } }, 4096] } },
  },
};

/** Refined String for an `answerCallbackQuery` notification/toast text — up to
 *  200 chars (Telegram's 0-200 limit). Phase 3o.3 registered it as the named
 *  `CallbackText` entity so the `TelegramCallbacks` capability sig references it
 *  by name instead of inlining the `$refined` (which the sig surface can't
 *  express) — the un-audited THIRD inline-refined param the brief's step-0
 *  audit missed (alongside MessageText / CallbackData). */
const callbackTextType: FenelType = {
  $refined: {
    base: stringType,
    set: { $tag: "SeWhere", pred: { "<=": [{ length: { var: "value" } }, 200] } },
  },
};

// The telegram `$named` param-type aliases (`chatRefType` / `messageType` / …)
// and `updateType` / `webhookInfoType` are RETIRED (Phase 3o.2 + 3o.3) — their
// only consumers were the hand-written capability rosters; every capability sig
// now references its param/return types by name from `capability.fenel`.

// ---------------------------------------------------------------------------
// Native helpers — RETIRED (module-substrate Phase 3o Wave D, 2026-05-31).
//
// `escapeMarkdownV2` + `deepLink` were the last two TS `@native` rides in
// telegram. Both are PURE string ops, so the Fenel-first HARD rule places them
// in `.fenel`: they now live in fenel/modules/telegram/format.fenel as full
// `telegram` UNION members. escapeMarkdownV2 composes std:replaceAll (the
// std:escapeHtml precedent); deepLink composes std string fns + the new
// std:urlEncode substrate leaf (encodeURIComponent — the one irreducible host
// primitive, the abs/round/regexSet bridge). `parseCommand` was retired
// earlier (parse-command.fenel). No TS natives survive in this module.
// ---------------------------------------------------------------------------
// `parseCommand` is now a `module telegram where` UNION member (see
// `telegramUnionModule` below) — its body rides parse-command.fenel directly,
// its identity @facet directives. The defineFunction re-wrap +
// PARSE_COMMAND_BODY extraction RETIRED (the inline-record return type round-
// trips now that the sig parser stamps `meta: {}` — Surprise #37 fix).
// ---------------------------------------------------------------------------

// `escapeMarkdownV2` + `deepLink` are now `module telegram where` UNION members
// (format.fenel) — Fenel-bodied, identity via @facet directives. Their
// `defineFunction` specs + the `_nativeDefined` array RETIRED (Wave D).

const sourceModule = loadFenelModule(TELEGRAM_SRC, "telegram");

// ---------------------------------------------------------------------------
// FM-retire-7 Step 1 (2026-06-06) — the form-cores re-home.
//
// The Tier-0 raw-FenelType peelers (form-type-reflection.fenel) + the Tier-1/2
// form-fill decision/render cores (form-fill-cores.fenel) are now FULL members
// of the `telegram` union (added to `telegramUnionGroups` below) — their @facet
// directives carry identity, their `formRefl…`/`formCore…` helpers ride
// Codeable-only by construction. The earlier Phase-7/7b extraction seams (a
// separate `loadFenelModule` per file + per-id `find*Body` body splices into 14
// `defineFunction` specs + the `*HelperIds`/`*Helpers`/`*HelperInstances`
// re-surfacing arrays) RETIRE — the union maps file→module so the 14 publics +
// their 11 helpers register at their `telegram:*` ids directly. Bodies UNCHANGED.
// ---------------------------------------------------------------------------

// module-substrate Phase 3o (closing wave, 2026-05-31) — the `telegram` cross-file
// header UNION. Every source below carries `module telegram where`, so
// `loadFenelModuleUnion` GROUPS them into ONE `telegram` module (OQ3 — header is
// identity).
//
// module-substrate Phase 3p (2026-05-31) — Option C MERGE. The retired
// `mixed-ingress` bundle's lone `telegram:` slice (`telegramWebhookDispatch`)
// semantically belongs to `telegram`, so its `webhook-wrapper.fenel` (now
// `module telegram where`) is added as ONE MORE source below — it folds into
// `telegramModule` like any other telegram body file. No standalone seam, no
// transient second module. The id `telegram:telegramWebhookDispatch` is
// collision-free (poll.fenel CALLS it but only webhook-wrapper.fenel DEFINES it);
// `HasStateIO` is INFERRED from its emitEvent call.
//
// The 10 orchestrators (run/stop/list-collector, handle-update, start-form,
// finalize-conversation, the 3 routers, step-conversation) joined this wave:
// their hand-wrapped `defineFunction` specs + the per-id `*_BODY` extraction +
// the per-file `loadFenelModule` calls + the `*HelperIds`/`*Helpers`/`*HelperInstances`
// arrays (which manually re-surfaced their co-located helpers) are all RETIRED —
// the union maps file→module so the helpers ride as Codeable-only members by
// construction and the publics carry their identity via @facet directives. The 4
// collector fns keep their divergent codeName via `@codeName` (runCollector →
// runTelegramCollector etc.). `requires` is INFERRED transitively (effect-inference
// propagates the IO leaves' declared requires up the call graph) — the hand-declared
// HasTelegramBot in the retired specs is dropped. format.fenel (Wave D) adds the two
// natives. Bodies UNCHANGED.
//
// What still rides a TS `defineFunction` spec (`_collectorDefined`): just
// `notify:sendTgDm` (cross-module notify source) — spun out to its own `notify`
// module in FM-retire-7 Step 2. The 14 form-cores (5 type-reflection peelers + 9
// form-fill decision/render cores) moved spec→union in Step 1 (they now ride
// `telegramUnionGroups` directly with @facet identity).
const telegramUnionGroups = loadFenelModuleUnion([
  { src: DECODERS_FENEL, name: "telegram" },
  { src: CONVERSATION_FENEL, name: "telegram" },
  { src: PARSE_COMMAND_FENEL, name: "telegram" },
  { src: IO_FENEL, name: "telegram" },
  { src: POLL_FENEL, name: "telegram" },
  { src: FORMAT_FENEL, name: "telegram" },
  { src: RUN_COLLECTOR_FENEL, name: "telegram" },
  { src: STOP_COLLECTOR_FENEL, name: "telegram" },
  { src: LIST_COLLECTORS_FENEL, name: "telegram" },
  { src: HANDLE_UPDATE_FENEL, name: "telegram" },
  { src: START_FORM_FENEL, name: "telegram" },
  { src: FINALIZE_CONVERSATION_FENEL, name: "telegram" },
  { src: ROUTE_CONFIRMATION_FENEL, name: "telegram" },
  { src: ROUTE_TELEGRAM_MESSAGE_FENEL, name: "telegram" },
  { src: ROUTE_TELEGRAM_MESSAGE_WITH_HOOK_FENEL, name: "telegram" },
  { src: STEP_CONVERSATION_FENEL, name: "telegram" },
  // Phase 3p — the mixed-ingress dissolve's `telegram:` slice (Option C merge).
  { src: WEBHOOK_WRAPPER_FENEL, name: "telegram" },
  // FM-retire-7 Step 1 — the form-cores re-home. The 5 Tier-0 raw-FenelType
  // peelers (form-type-reflection.fenel) + the 9 Tier-1/2 form-fill decision/
  // render cores (form-fill-cores.fenel) fold into the `telegram` union as full
  // members (their @facet directives carry identity; their co-located formRefl…/
  // formCore… helpers ride Codeable-only by construction). This RETIRES the 14
  // `defineFunction` specs + the `formReflModule`/`formCoreModule`
  // `loadFenelModule`+`find*Body` extraction seams + the `*HelperIds`/`*Helpers`/
  // `*HelperInstances` re-surfacing arrays. Bodies UNCHANGED.
  { src: FORM_TYPE_REFLECTION_FENEL, name: "telegram" },
  { src: FORM_FILL_CORES_FENEL, name: "telegram" },
]);
const telegramUnionModule = telegramUnionGroups.find((m) => m.name === "telegram");
if (!telegramUnionModule) {
  throw new Error(
    "telegram: loadFenelModuleUnion did not yield the `telegram` group — Fenel sources out of sync with the seam (every telegram/*.fenel must carry `module telegram where`)",
  );
}
// Phase 13c sub-step 1 — Fenel-bodied long-poll dispatch. Replaces the
// retired grammy library. Three top-level Fenel bodies:
//   - pollUpdatesOnce: one iteration of the long-poll loop (entry point)
//   - dispatchOnePollingUpdate: per-update fan-out (helper)
//   - computeNextPollingOffset: nextOffset = max(updateId) + 1 (helper fold)
// Phase 3o — pollUpdatesOnce + dispatchOnePollingUpdate + computeNextPollingOffset
// migrated to the `telegram` UNION (poll.fenel header'd `module telegram where`);
// their defineFunction specs + POLL_*_BODY extraction + the duplicate
// `telegram-bodies:*` helper surfacing RETIRE.
// FM-retire-7 Step 2 — `notify:sendTgDm` SPUN OUT. The Fenel-bodied tg_dm action
// body + its 5 helpers moved to their own `notify` module
// (engine/src/modules/notify.ts over `module notify where` tg-dm.fenel). The
// `tgDmModule` `loadFenelModule` + `SEND_TG_DM_BODY` extraction + the
// `tgDmHelper*` surfacing arrays + the `notify:sendTgDm` `defineFunction` spec
// RETIRE here → telegram.ts is now 0 `defineFunction`.
// Phase 3o closing wave — the orchestrators + their co-located helpers + the
// `InstanceOutcome` entity (from finalize-conversation.fenel) now ride
// `telegramUnionModule` directly: full members with @facet identity (the 10
// publics) / Codeable-only (their helpers — handleBackStep / defaultFieldHandling
// / routeStrictReply / routeDraftReply / the 6 stepConversation helpers). The
// per-file body-extraction consts, the `orchestrationEntities` array, and the
// `*HelperIds`/`*Helpers`/`*HelperInstances` re-surfacing arrays are all RETIRED —
// the union maps file→module so the helpers + their Codeables point at the correct
// `telegram:*` ids by construction (no `telegram-bodies:` prefix to filter against).
// The union's entities/functions/instances flow straight through allFunctions /
// allInstances / the module `entities` array below.

// ---------------------------------------------------------------------------
// Collector — type-driven Telegram form-fill ("read(T) at telegram").
//
// `runTelegramCollector` is the user-facing IO function. It takes a bot
// token and an array of collector entries (one per type to collect). Each
// entry optionally takes hook function slugs for welcome / completion /
// per-field interception. With zero hooks and a single entry the bot
// auto-starts the form on /start. With multiple entries it shows an inline
// keyboard picker.
//
// The hooks are Fenel function slugs resolved at runtime — not arrow types
// embedded in the config. This keeps the collector config serialisable as
// plain JSON (stored on the bot row) while letting hooks call other IO
// functions (send extra messages, write DB, etc.).
// ---------------------------------------------------------------------------

const collectorActionType: FenelType = { $ref: "CollectorAction" };
const fieldParseResultType: FenelType = { $ref: "FieldParseResult" };
const collectorContextType: FenelType = { $ref: "CollectorContext" };

/** TS shape of a single collector entry — one registered type to collect
 *  via bot. The type is referenced by its UUID so the handler can resolve
 *  it from the `types` table at runtime and persist instances against the
 *  same registered name. */
export type CollectorEntry = {
  /** UUID of a registered type (row in the `types` table). The bot
   *  collector refuses inline types — persistence requires a nominal
   *  identity. */
  typeId: string;
  /** Label shown in the picker when the bot has multiple entries. */
  label: string;
  /** IO Fenel function called with `CollectorContext → String` — produces the
   *  message text sent when the user starts the conversation. If absent, a
   *  default greeting is sent. Stored as a function codeName slug. */
  startFn?: string;
  /** IO Fenel function called with `(CollectorContext, collectedValue) → String`
   *  — produces the completion message. If absent, a default "Submitted!"
   *  message is sent. Stored as a function codeName slug. */
  completionFn?: string;
  /** IO Fenel function called with
   *  `(fieldName, rawInput, FieldParseResult, partialValues) → CollectorAction`
   *  — runs after each user message to decide whether to retry, abort, skip,
   *  or continue. If absent, the default behaviour (continue on success,
   *  re-prompt on failure) is used. Stored as a function codeName slug. */
  onFieldFn?: string;
  /** Capture-first mode. When true, the bot wraps each field's value as
   *  `Either<String, T_field>` (Left for parse failures, Right for
   *  validated values) and materialises the conversation as a
   *  `Draft<typeId>` entity instead of `typeId`. Invalid input never
   *  reprompts — it's preserved as a Left for later reconciliation in
   *  the review UX. Lead-capture flows on low-friction surfaces
   *  (Telegram) opt in to this; admin / data-entry flows leave it off
   *  to keep field-entry validation strict. */
  asDraft?: boolean;
};

/** TS shape of the full collector config stored on a bot. Mirrors the
 *  Fenel type on `Bot.collectorConfig` — `Maybe(List(CollectorEntry))` —
 *  so a configured bot's stored value is a plain `CollectorEntry[]`. */
export type CollectorConfig = CollectorEntry[];

/** Phantom-tagged Id<entity_definition> referring to a row in the `types`
 *  table. The collector resolves it at runtime to derive form fields and
 *  the instance type used on completion. */
const typeRefIdType: FenelType = {
  $tagged: {
    value: { $ref: "Id" },
    phantom: {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["entity_definition"] },
      },
    },
  },
};

/** Arrow signature for the welcome/start hook — receives CollectorContext,
 *  returns the message text. */
const startFnArrowType: FenelType = {
  $arrow: {
    params: [{ name: "ctx", label: Nothing, type: collectorContextType, meta: {}, ui: Nothing }],
    returns: stringType,
  },
};

/** Arrow signature for the completion hook. The `value` is the collected
 *  record; with the typeId-driven design we type it as a generic record
 *  here — the handler validates it against the resolved type before
 *  invoking the hook. */
const completionFnArrowType: FenelType = {
  $arrow: {
    params: [
      { name: "ctx", label: Nothing, type: collectorContextType, meta: {}, ui: Nothing },
      { name: "value", label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing },
    ],
    returns: stringType,
  },
};

/** Arrow signature for the per-field hook — runs after each message to
 *  decide whether to continue, retry, skip, or abort. */
const onFieldFnArrowType: FenelType = {
  $arrow: {
    params: [
      { name: "fieldName", label: Nothing, type: stringType, meta: {}, ui: Nothing },
      { name: "rawInput", label: Nothing, type: stringType, meta: {}, ui: Nothing },
      { name: "parseResult", label: Nothing, type: fieldParseResultType, meta: {}, ui: Nothing },
      { name: "partialValues", label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing },
    ],
    returns: collectorActionType,
  },
};

/** The collector entry type as a Fenel $record — what gets stored as config. */
const collectorEntryType: FenelType = {
  $record: {
    fields: [
      { name: "typeId", label: Nothing, type: typeRefIdType, meta: {}, ui: Nothing },
      { name: "label", label: Nothing, type: stringType, meta: {}, ui: Nothing },
      { name: "startFn", label: Nothing, type: Maybe(startFnArrowType), meta: {}, ui: Nothing },
      { name: "completionFn", label: Nothing, type: Maybe(completionFnArrowType), meta: {}, ui: Nothing },
      { name: "onFieldFn", label: Nothing, type: Maybe(onFieldFnArrowType), meta: {}, ui: Nothing },
      // Opt-in capture-first mode — see `CollectorEntry.asDraft`
      // TypeScript doc. Omitted = false = strict field-entry validation.
      { name: "asDraft", label: Nothing, type: Maybe({ $ref: "Boolean" }), meta: {}, ui: Nothing },
    ],
  },
};

// FM-retire-7 Step 2 — `_collectorDefined` / `collectFunctions` / the
// `collectorFns`+`collectorInstances` destructure RETIRED. The last TS
// `defineFunction` spec (`notify:sendTgDm`) was spun out to the `notify` module;
// telegram.ts now defines its surface ENTIRELY through the `.fenel` unions
// (`telegramUnionModule` + `sourceModule`) — 0 `defineFunction`.

const allFunctions: FenelFunction[] = [
  // Phase 3o (closing wave) — the `telegram` UNION carries EVERYTHING migrated
  // off TS specs: the 9 decoders + flatPayloadForTriggers + parseCommand, the
  // 12 bodyless IO leaves, the 3 poll fns, the 2 format natives, the 10
  // orchestrators (full members w/ @facet identity), plus all their co-located
  // helpers + the 11 generic Conversation helpers (Codeable-only).
  // FM-retire-7 Step 1 — the form-cores (5 type-reflection peelers + 9 form-fill
  // cores) + their 11 `formRefl…`/`formCore…` Codeable-only helpers also ride the
  // union directly (form-type-reflection.fenel + form-fill-cores.fenel folded
  // into `telegramUnionGroups`).
  ...(telegramUnionModule.functions ?? []),
  ...(sourceModule.functions ?? []),
];

const allInstances: Instance[] = [
  // Phase 3o (closing wave) — the `telegram` UNION instances: Codeable + the
  // identity facets (Labelable / Describable / Taggable / Iconable / Emojiable /
  // IOInvokable) for every migrated public; NO stored Categorizable (3j read-time).
  ...(telegramUnionModule.instances ?? []),
  ...(sourceModule.instances ?? []),
  // FM-retire-7 Step 1 — the form-cores' identity + Codeable-only-helper
  // instances ride the union directly (see `allFunctions`); the separate
  // `formReflHelperInstances`/`formCoreHelperInstances` spreads RETIRED.
];

// ---------------------------------------------------------------------------
// Sub-capabilities — abstract bot contracts.
//
// Each sub-capability groups Bot API methods that are commonly consumed
// together. The capabilities are *type-level*: there's one typeclass
// instance per capability, keyed by `args: ["bot"]`. Methods take an
// `Id<bot>` as their first parameter so the runtime can dispatch to
// the right bot. This replaces the older per-bot derivation (one
// instance per bot × capability) — same behaviour, fewer rows, and
// the typeclass conventions follow Haskell's "instances are on types,
// not values" — capabilities don't vary per-bot, only the target bot
// id varies, which is what the param expresses.
// ---------------------------------------------------------------------------

/** `Id<bot>` — the type used as the first parameter of every capability
 *  method, identifying which registered bot the call targets. */
const idOfBot: FenelType = {
  $tagged: {
    value: { $ref: "Id" },
    phantom: {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["Bot"] },
      },
    },
  },
};


// ---------------------------------------------------------------------------
// The 16 sub-capabilities — `.fenel`-sourced (module-substrate Phase 3o.3 closed
// the tier that 3o.2 opened with TelegramWebhooks).
//
// Each capability is a record-of-methods type in
// `fenel/modules/telegram/capability.fenel`; the seam reads each type and
// `seedFromType`s it into a dispatch `Interface` (the email/ai precedent — the
// seed carries only method NAMES + sigs, no class label/description, so it is
// law-neutral). The bot-keyed instance ("Bot implements <Cap>", `args: ["Bot"]`,
// priority 50, method dict keyed `<Cap>.<method>`) is derived from each seed by
// `instanceFromCapabilitySeed` (WRINKLE 2 — telegram's instance is a type-level
// assertion, not a provider value, so it stays seam-built). The hand-written
// `InterfaceMethod[]` rosters + the `telegramCapabilities` object-literal + the
// `withBotIdParam` / `botCapabilityInstance` helpers (~1400 LOC) are RETIRED; the
// `.fenel` file is the source of truth.
//
// The `${cap.name}.${method.name}` runtime handler keys
// (`registerTelegramHandlers` → `reg.listCapabilities()`) regenerate
// byte-identical because the `.fenel` method field names are plain idents
// (WRINKLE 3 / the parity LOCK; the getUpdatesPoll end-to-end lock proves it).
// ---------------------------------------------------------------------------

/** WRINKLE 2 — derive the bot-keyed capability instance from a `.fenel`-sourced
 *  seed: `args: ["Bot"]`, priority 50, one method-dict entry per declared method
 *  whose value's `name` is the qualified `<Cap>.<method>` dispatch key. The
 *  seed's methods already carry `botId` (the registered `BotId` named type) as
 *  their first param — authored botId-first in capability.fenel — so this does
 *  NOT re-prepend (the retired `botCapabilityInstance` did, from base methods). */
function instanceFromCapabilitySeed(seed: Interface): Instance {
  const methods: Record<string, InterfaceMethod> = {};
  for (const m of seed.methods) {
    methods[m.name] = { ...m, name: `${seed.name}.${m.name}` };
  }
  return { typeName: seed.name, args: ["Bot"], priority: 50, methods };
}

// The 16 capability NAMES in source order. Each is a record-of-methods type in
// capability.fenel; `seedFromType` derives its dispatch seed. Order is cosmetic
// (the seed is a set) but kept stable for the parity test + readability.
const CAP_NAMES = [
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
] as const;

// Exported for the spec-entity routing in system-entities.ts (signature-
// substrate P4-prep D0b): the deleted fenel/std/interfaces.fenel Telegram*
// copies re-source their spec-entity faces from this module-local owner.
export const telegramCapabilitySource = loadFenelModule(CAPABILITY_FENEL, "telegram");
const capabilitySource = telegramCapabilitySource;

/** Phase 10a-5d-followup-2: exported for direct registration into the shared
 *  `dispatchRegistry` from system-entities.ts. All 16 are `.fenel`-sourced (3o.3). */
export const telegramCapabilities: Interface[] = CAP_NAMES.map((name) => {
  const entity = capabilitySource.entities?.find((e) => e.id === name);
  if (!entity?.type || !entity.typeScheme) {
    throw new Error(`telegram: capability.fenel is missing the ${name} type`);
  }
  return seedFromType(name, entity.type, "a", {
    typeScheme: entity.typeScheme,
    sourceModule: capabilitySource,
  });
});

// ---------------------------------------------------------------------------
// Capability instances — one per capability, keyed by the type `Bot`.
//
// All registered Telegram bots share the same Bot API surface, so each
// capability has exactly one typeclass instance over `args: ["Bot"]`. The
// `botId` method param identifies *which* bot the call targets; the runtime IO
// handler resolves the bot row and dispatches to Telegram with the right token.
// No per-bot fan-out, no derive step at registration time.
// ---------------------------------------------------------------------------

const botCapabilityInstances: Instance[] = telegramCapabilities.map(instanceFromCapabilitySeed);


// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

// `parseCommand` is a Fenel body in fenel/modules/telegram/parse-command.fenel
// — no TS native registered here (the body dispatches through the engine
// evaluator). `escapeMarkdownV2` and `deepLink` remain TS for now.
// `telegramNatives` RETIRED (Phase 3o Wave D) — escapeMarkdownV2 + deepLink are
// Fenel-bodied union members now (format.fenel); no TS natives survive in this
// module, so `nativeImpls` collapses to `{}`.

export const telegramModule: FenelModule = {
  name: "telegram",
  label: "Telegram",
  functions: allFunctions,
  // Capability instances target the type `bot` with `botId` as a method
  // param — see `botCapabilityInstances`. They ship statically with the
  // module; no per-bot derivation step.
  instances: [...allInstances, ...botCapabilityInstances],
  // Merge entities from the typeclass-source module (Telegram type
  // ADTs from `TELEGRAM_SRC` — Chat, Message, Update, …) and the
  // orchestration bodies (form-completed event payload, etc.). Also
  // register two synthetics inline:
  //   - `CollectorEntry`: the type of one entry in a bot's
  //     `collectorConfig` list. Referenced by name in Bot's field
  //     type (`Maybe<List<CollectorEntry>>`).
  //   - `TelegramFormCompletedPayload`: the typed event payload for
  //     `telegram.form.completed`. The `.fenel` orchestration body
  //     constructs values of this type via the named constructor so
  //     the event payload isn't an anonymous record.
  entities: [
    ...(sourceModule.entities ?? []),
    // Phase 3o closing wave — `orchestrationEntities` RETIRED; the union supplies
    // every orchestrator-file entity directly (incl. `InstanceOutcome` from
    // finalize-conversation.fenel).
    ...(telegramUnionModule.entities ?? []),
    // Phase 3o — register the telegram-specific param types as named entities so
    // `.fenel` sigs can reference them (`botToken : BotToken`, `botId : BotId`,
    // `kind : TgLinkKind`) instead of inlining the opaque/regex / tagged-phantom /
    // refined-enum shapes (which have no sig surface). `BotToken` = the bot-token
    // format; `BotId` = Id<Bot> (the typed reference — the phantom drives the
    // editor entity-picker; the runtime value is the bot's UUID string).
    groundEntity("BotToken", botTokenType),
    groundEntity("BotId", idOfBot),
    // Refined-String format type reused by the IO-leaf + format-native sigs
    // (setWebhookByToken's url, deepLink's return) — registered so a sig can
    // say `Url` instead of inlining the `$refined format:*` shape. deepLink's
    // `handle : Handle` is the system `Handle` (fenel/std/entities/
    // profile_handle.fenel), the same `format:handle` refinement: a copy here
    // made one set two type identities (modules-as-values Phase 5 per-owner
    // type identity, S1).
    groundEntity("Url", urlType),
    // Phase 3o.3 — the inline-refined String param types the capability sigs
    // reference by name (so the `.fenel` arrow sigs aren't String-relaxed). All
    // law-neutral (bare entity registration carries no identity instance).
    //   MessageText (≤4096) — TelegramMessages.sendMessage / editMessageText.
    //   CallbackData (1-64) — the callback_data button-payload format (the
    //     keyboard-markup source entities; no roster param references it today,
    //     registered per the step-0 brief direction).
    //   CallbackText (≤200) — TelegramCallbacks.answerCallbackQuery's toast text
    //     (the un-audited third inline type — see `callbackTextType`).
    groundEntity("MessageText", messageTextType),
    groundEntity("CallbackData", callbackDataType),
    groundEntity("CallbackText", callbackTextType),
    // deepLink's `kind` — the "user" | "bot_start" refined enum, named so
    // format.fenel's sig can say `kind : TgLinkKind` (preserves the enum picker;
    // NOT String-relaxed).
    groundEntity("TgLinkKind", {
      $refined: {
        base: stringType,
        set: { $tag: "SeEnum", values: ["user", "bot_start"] },
      },
    }),
    groundEntity("CollectorEntry", collectorEntryType),
    groundEntity(
      "TelegramFormCompletedPayload",
      {
        $record: {
          fields: [
            {
              name: "botId",
              label: Nothing,
              type: {
                $tagged: {
                  value: { $ref: "Id" },
                  phantom: {
                    $refined: {
                      base: { $ref: "String" },
                      set: { $tag: "SeEnum", values: ["Bot"] },
                    },
                  },
                },
              },
              meta: {},
              ui: Nothing,
            },
            { name: "chatId", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
            { name: "userId", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
            { name: "formId", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
            // Values are dynamic per form schema — typing this fully
            // needs dependent typing over the form's instanceTypeName
            // (`$el {schemaOf instanceTypeName}`). Stays a structural
            // record placeholder for now; flagged for follow-up.
            { name: "values", label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing },
            { name: "instanceId", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
            { name: "instanceError", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
          ],
        },
      } as FenelType,
    ),
  ],
  // Phase 3o Wave D — no TS natives survive; the two former natives
  // (escapeMarkdownV2 / deepLink) are Fenel-bodied union members.
  nativeImpls: {},
};

// Keep refined types accessible to consumers that want to construct
// signatures over the Telegram surface (e.g. user code generating
// telegram-typed flows).
export {
  urlType,
  botTokenType,
  callbackDataType,
  messageTextType,
  collectorActionType,
  collectorContextType,
  collectorEntryType,
  fieldParseResultType,
};
