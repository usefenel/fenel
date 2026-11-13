// ---------------------------------------------------------------------------
// Telegram form-fill conversation engine.
//
// Walks a `FieldDef[]` schedule one field per round-trip. Each conversation
// row in `conversations` carries the current cursor and the partial value
// being assembled. When the user replies, the routing layer matches by
// `(bot_id, chat_id, user_id, status='active')`, parses the input through
// `parseInput` (the unified type-driven parser shared with web/API), and
// either advances or re-prompts on validation failure.
//
// On completion the engine emits `telegram.form.completed` with the form's
// id and the final values, so user-defined Fenel function triggers can fan
// out per-form (e.g. lead capture → CRM write, support ticket → Slack ping).
//
// Phase 3b (ts-elimination-completion, 2026-06-02) — the orchestration
// exports (`startTelegramForm` / `routeTelegramMessage` / `routeConfirmation`)
// were retired. The live form-fill + reply-routing path is the Fenel bodies
// (`telegram:startTelegramForm` / `telegram:routeTelegramMessage` /
// `telegram:routeConfirmation`), reached from the `stepConversation` body by
// codeName. `routeTelegramMessage` / `routeConfirmation` were DEAD TS shadows
// (no caller); `startTelegramForm` folded into its sole caller
// `startCollectorEntry` (handlers/telegram-collector.ts).
//
// What remains here is the pure prompt/parse renderer shims (`_internals`):
// each is a thin dispatcher over the matching Fenel body — exposed for the
// collector's send-prompt / send-confirmation-summary IO leaves + the tests.
// ---------------------------------------------------------------------------

import type { FieldDef, FenelType } from "@fenel/engine/types";
import { fieldType } from "@fenel/engine";
import { resolveEvaluator } from "@fenel/engine/evaluator-class";
import { getSystemEvaluateContext } from "@fenel/engine/system-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import type { AuthorityRef } from "@fenel/engine/authority";

// rights R2b — THE MODULE-SCOPE FRAME IS GONE.
//
// This file used to capture `getSystemEvaluateContext()` at module load and
// evaluate Fenel bodies under it at request time. That frame is stamped with
// the registry BOOTSTRAP authority — the universe — so a body reached through
// one of these helpers that ever performed a requires-bearing native would run
// under ⊤ regardless of what the leaf that called it held. No escalation was
// LIVE (every body reached here is pure), which is why R2a recorded it as R4's
// input rather than a defect; R2b retires it because it is regen-free and it
// closes the shape.
//
// Every helper now takes the leaf's authority and builds the frame per call,
// the same explicit-override shape `performIODescriptor` uses. The base context
// is still the system one: it is the registry these renderers dispatch against.
function fenelFrame(authority: AuthorityRef) {
  return { ...getSystemEvaluateContext(), _authority: authority };
}

/** Invoke a Fenel function by codeName and stringify its result. Thin
 *  sync wrapper around `resolveEvaluator` — used by fieldLabel /
 *  promptForField below. The Fenel body is now the sole execution path
 *  (no TS fallback); a thrown error propagates as a real bug rather
 *  than being silently swallowed. */
function callFenelString(authority: AuthorityRef, codeName: string, ...args: unknown[]): string {
  const ctx = fenelFrame(authority);
  const result = resolveEvaluator(ctx)(
    { call: [codeName, ...args] },
    {},
    ctx,
  );
  return result == null ? "" : String(result);
}

/** Invoke a Fenel function and return the raw result. Used by helpers
 *  whose return shape isn't a plain string (e.g. parseFieldInput's
 *  Parsed/ParseFailed variant, tryParseBoolean's Maybe<Boolean>). */
function callFenel(authority: AuthorityRef, codeName: string, ...args: unknown[]): unknown {
  const ctx = fenelFrame(authority);
  return resolveEvaluator(ctx)(
    { call: [codeName, ...args] },
    {},
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Hook execution — call a Fenel function by slug and return its result.
// Used by the collector hooks (welcome, completion, onField).
//
// This creates a short-lived function instance, runs it to completion, and
// returns the last result. Hooks that suspend (waiting for events) are
// NOT supported — they will return null.
// ---------------------------------------------------------------------------

async function callHookFunction(
  accountId: string,
  fnSlug: string,
  params: Record<string, unknown>,
  authority: AuthorityRef,
): Promise<unknown> {
  try {
    const { runEphemeralFunction } = await import("../hook-runner");
    // rights R2a — the CALLER's authority; see `hook-runner.ts`.
    return await runEphemeralFunction(accountId, fnSlug, params, authority);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt rendering — turn a FieldDef into a user-facing question. Every
// helper here is a thin TS shim over the matching Fenel body in
// engine/src/modules/telegram.ts (telegram:fieldLabel /
// telegram:promptForField / telegram:innerType / telegram:typeHint /
// telegram:parseFieldInput) or std (std:tryParseBoolean). Phase 11c
// sub-step 1 deleted the TS-side duplicates + per-dispatcher fallbacks.
// ---------------------------------------------------------------------------

function fieldWithResolvedPresentation(
  field: FieldDef,
  registry?: ModuleRegistry,
): FieldDef {
  const label = registry === undefined || field.key?.$tag === "PositionalField"
    ? field.name
    : resolveIdentifiedFieldView(registry, field).presentation.label;
  return {
    ...field,
    // The Fenel telegram renderer accepts a structural transport record and
    // canonicalizes this slot directly; wrapping it as FieldDef's declaration
    // Maybe would render the constructor name ("Just") instead of the label.
    label: label as never,
    ui: { $tag: "Nothing" },
  };
}

function fieldLabel(
  authority: AuthorityRef,
  field: FieldDef,
  registry?: ModuleRegistry,
): string {
  return callFenelString(authority, "fieldLabel", fieldWithResolvedPresentation(field, registry));
}

/** Inner type — peel `Maybe` / `$refined` / `$opaque` to the underlying
 *  primitive. TS wrapper around `telegram:innerType` (Fenel body); kept
 *  as `_internals.innerType` for the test file + any future TS-side
 *  caller. */
function innerType(authority: AuthorityRef, t: FenelType): FenelType {
  return callFenel(authority, "innerType", t) as FenelType;
}

/** Type-driven hint suffix, e.g. "(yes/no)" or "(date — YYYY-MM-DD)". */
function typeHint(authority: AuthorityRef, t: FenelType): string {
  return callFenelString(authority, "typeHint", t);
}

function promptForField(
  authority: AuthorityRef,
  field: FieldDef,
  registry?: ModuleRegistry,
): string {
  return callFenelString(authority, "promptForField", fieldWithResolvedPresentation(field, registry));
}

// ---------------------------------------------------------------------------
// Boolean parsing — "yes/no/y/n/true/false" common variants. Routes to
// std:tryParseBoolean (Fenel body) which returns Maybe<Boolean>; the TS
// surface keeps the historical `boolean | null` shape for the existing
// test + any direct TS callers.
// ---------------------------------------------------------------------------

function tryParseBoolean(authority: AuthorityRef, text: string): boolean | null {
  const result = callFenel(authority, "tryParseBoolean", text) as
    | { $tag: "Just"; _0: boolean }
    | { $tag: "Nothing" }
    | null;
  if (result && typeof result === "object" && result.$tag === "Just") {
    return result._0;
  }
  return null;
}

function parseFieldInput(
  authority: AuthorityRef,
  raw: string,
  field: FieldDef,
): { ok: true; value: unknown } | { ok: false; error: string } {
  // Fenel-side parseFieldInput returns a $tag-wrapped variant
  // ({Parsed value} | {ParseFailed error}). Convert back to the
  // ok/error shape the caller wants. The Fenel body is the sole path —
  // an evaluator throw propagates (no TS fallback as of Phase 11c
  // sub-step 1; the deletion was gated on a 31-case byte-equivalence
  // smoke covering Boolean / Number / String / refined-email /
  // refined-handle / refined-url / Date / optional / /cancel arms).
  const result = callFenel(authority, "parseFieldInput", raw, field) as Record<string, unknown> | null;
  if (result && typeof result === "object") {
    const tag = result["$tag"];
    if (tag === "Parsed") return { ok: true, value: result["value"] };
    if (tag === "ParseFailed") {
      const err = result["error"];
      return {
        ok: false,
        error: typeof err === "string" ? err : "Parse failed",
      };
    }
  }
  return { ok: false, error: "parseFieldInput: unexpected result shape" };
}

// `sendText`, `sendFieldPrompt`, and `sendConfirmationSummary` no
// longer have TS callers in this file — the Fenel routing bodies
// invoke the corresponding IO actions
// (`telegram.send_message_text`, `telegram.send_field_prompt`,
// `telegram.send_confirmation_summary`) directly. The TS handler
// impls live in handlers/telegram-collector.ts.

// ---------------------------------------------------------------------------
// ConversationHooks — collector behaviour config carried on a Conversation
// row + passed to the form-fill start body. Exported for the collector leaf
// (handlers/telegram-collector.ts) which assembles it from a CollectorEntry.
// ---------------------------------------------------------------------------

export type ConversationHooks = {
  startFn?: string;
  completionFn?: string;
  onFieldFn?: string;
  /** When set, finalizeConversation persists the collected values as an
   *  instance of this registered type (entityType/typeName slug). */
  instanceTypeName?: string;
  /** Capture-first mode. See `CollectorEntry.asDraft` — the routing
   *  layer wraps each field as Either<String, T_field> on advance, the
   *  finalize step materialises as `Draft<instanceTypeName>`. */
  asDraft?: boolean;
};

// ---------------------------------------------------------------------------
// Confirmation step — summary rendering
// ---------------------------------------------------------------------------

function formatValue(authority: AuthorityRef, v: unknown): string {
  // Normalize undefined → null so the Fenel body's `null` arm catches
  // both cases (matchPattern's `pattern === scrutinee` distinguishes
  // them; the TS impl treated them identically).
  return callFenelString(authority, "formatValue", v === undefined ? null : v);
}

// Confirmation summary now sent via the Fenel
// `telegram.send_confirmation_summary` IO action — the renderer
// (formatValue + fieldLabel) is exposed via `_internals` for the
// handler to consume.

// The user's confirm/cancel reply is routed by the Fenel
// `telegram:routeConfirmation` body (reached from `stepConversation` by
// codeName); there is no TS wrapper — Phase 3b retired the dead shadow.
//
// `finalizeConversation` lives entirely in Fenel now
// (`telegram:finalizeConversation` body in
// `engine/src/modules/telegram-bodies/finalize-conversation.fenel`),
// invoked from the `routeConfirmation` body via the standard call
// graph. No TS TS shim — callers go through routeConfirmation, which
// itself is a Fenel body called via the `telegram:routeConfirmation`
// auto-dispatcher.

// ---------------------------------------------------------------------------
// Pure helpers exposed for testing and reuse
// ---------------------------------------------------------------------------

export const _internals = {
  fieldLabel,
  promptForField,
  parseFieldInput,
  innerType,
  typeHint,
  tryParseBoolean,
  callHookFunction,
  formatValue,
};

// Suppress unused-import warning when only the runtime engine paths use
// fieldType (re-exported here for callers building bespoke flows).
export { fieldType };
