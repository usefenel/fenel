// ---------------------------------------------------------------------------
// runtime-bodies-dispatch — runtime/src/ ↔ Fenel-bodied runtime pass
// indirection.
//
// Phase 11a establishes this file as the symmetric runtime-side twin of
// `engine/src/engine-bodies-dispatch.ts`. The engine package owns the
// dispatch harness (`createRegistry` + `EvaluateContext`); runtime
// imports `dispatchEngineBody` from there and provides runtime-specific
// classifiers + dispatched wrappers.
//
// Why a separate file rather than extending engine-bodies-dispatch.ts:
//   1. Engine vs runtime is a package boundary. Engine-side wrappers
//      operate on engine IR types (CoreProgram / CeExpr / WasmModule);
//      runtime-side wrappers operate on runtime types (FunctionTrigger /
//      FunctionDef / event payloads). Co-locating them muddles the
//      boundary.
//   2. Future runtime/src/ phases (11b codecs, 11c handler
//      orchestration, …) add more wrappers here; engine-bodies-
//      dispatch.ts would grow to 8000+ LOC if every runtime-side
//      dispatched wrapper landed there.
//   3. The harness lives in engine (correct package — engine owns the
//      registry + evaluator), the wrapper indirection lives in runtime
//      (correct package — runtime owns the runtime types it marshals
//      from).
//
// Subsequent runtime/src/ Fenel-body migrations follow this pattern:
//   - body lives at `fenel/modules/runtime/<topic>.fenel`
//   - defineFunction entries live in `engine/src/modules/runtime.ts`
//   - dispatched wrappers + classifiers live in this file
//   - TS source collapses to lazy-require shim
// ---------------------------------------------------------------------------

import type { FunctionTrigger } from "./types";
import type { AddressValue, BodyValue } from "./providers/mailgun";
import type { SuspendMeta } from "@fenel/engine/types";

// ---------------------------------------------------------------------------
// Phase 11a — `triggerMatches` dispatch with TmInput marshalling.
//
// The Fenel body operates on a pre-classified TmInput ADT
// (TmiTypeMismatch | TmiCheck { filters: List<TmFilter> }). The
// wrapper does the type-match check + per-filter classification
// TS-side; the body dispatches on the variant + ANDs filter results.
//
// Recipe matches Phase 10c sub-step 2's `dispatchedShortIdOf` —
// per-helper pre-classified ADT, classifier TS-side, body sees a flat
// pre-classified shape.
// ---------------------------------------------------------------------------

type TmFilterMarshalled =
  | { $tag: "TmfArray"; payloadValue: unknown; items: readonly unknown[] }
  | { $tag: "TmfScalar"; payloadValue: unknown; expectedValue: unknown };

type TmInputMarshalled =
  | { $tag: "TmiTypeMismatch" }
  | { $tag: "TmiCheck"; filters: readonly TmFilterMarshalled[] };

/** Classify (trigger, eventType, eventPayload) into TmInput. Skips the
 *  "type" and "once_per_profile" keys when walking trigger filters
 *  (mirrors the TS oracle's `if (key === "type" || key === "once_per_profile") continue`). */
function classifyTriggerMatchesInput(
  trigger: FunctionTrigger,
  eventType: string,
  eventPayload: Record<string, unknown>,
): TmInputMarshalled {
  if (trigger.type !== eventType) {
    return { $tag: "TmiTypeMismatch" };
  }
  const filters: TmFilterMarshalled[] = [];
  for (const [key, value] of Object.entries(trigger)) {
    if (key === "type" || key === "once_per_profile") continue;
    const payloadValue = eventPayload[key];
    if (Array.isArray(value)) {
      filters.push({ $tag: "TmfArray", payloadValue, items: value });
    } else {
      filters.push({ $tag: "TmfScalar", payloadValue, expectedValue: value });
    }
  }
  return { $tag: "TmiCheck", filters };
}

/** Dispatch the Fenel-bodied triggerMatches. The wrapper classifies
 *  (trigger, eventType, eventPayload) into TmInput; the body dispatches
 *  on the variant + ANDs per-filter results. */
export function dispatchedTriggerMatches(
  trigger: FunctionTrigger,
  eventType: string,
  eventPayload: Record<string, unknown>,
): boolean {
  const input = classifyTriggerMatchesInput(trigger, eventType, eventPayload);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("runtime:triggerMatches", [input]);
  return result === true;
}

// ---------------------------------------------------------------------------
// Phase 5b (ts-elimination-completion) — durable-router decision dispatch.
//
// Two pure folds replace the per-row decision loops of triggers.ts:
//   * selectWaitingToResume — the matchWaitingInstances filter-match loop
//     (incl. the `$`-interpolation, which lives in the Fenel body).
//   * selectDueInstances — the checkTimeouts / checkAllTimeouts wakeAt /
//     _timeoutAt comparison loop (one selection subsumes timer + event).
//
// Both go through the SYNCHRONOUS PURE PASS (dispatchEngineBody) — NOT
// callUserFunction — so the hot per-event router path pays no
// function_instances tax. The TS shell at ./triggers.ts keeps the irreducible
// IO (reads + the start/resume/handleTimeout durable drives) and calls these
// to get the action list. See notes/phase-5b-triggers-durable-router.md §2.
// ---------------------------------------------------------------------------

type EmFieldMarshalled = {
  $tag: "EmField";
  rawValue: unknown;
  payloadValue: unknown;
  payloadPresent: boolean;
};

type EmInputMarshalled =
  | { $tag: "EmiTypeMismatch" }
  | { $tag: "EmiCheck"; fields: EmFieldMarshalled[]; vars: Record<string, unknown> };

/** A waiting-instance row, narrowed to the fields the router reads. */
type WaitingInstanceRow = {
  id: string;
  variables: unknown;
  profileId: string | null;
};

/** Classify one waiting instance into EmInput. Mirrors the per-row head of
 *  triggers.ts:matchWaitingInstances — WaitEvent filter extraction, profile
 *  gate, and event-type gate (any failure → EmiTypeMismatch, so the body
 *  yields False). The per-field walk skips "event" and defers the
 *  `$`-interpolation to the body (the guard + slice + vars-lookup are Fenel,
 *  not pre-resolved here). `payloadPresent` carries `key in eventPayload` so
 *  the body can reproduce JS strict-`!==`-against-`undefined`. */
function classifyWaitingInstance(
  instance: WaitingInstanceRow,
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId: string | undefined,
): EmInputMarshalled {
  const vars = (instance.variables as Record<string, unknown>) ?? {};
  const sm = vars._suspendMeta as SuspendMeta | undefined;
  const filter = sm && sm.$tag === "WaitEvent" ? sm.filter : undefined;
  if (!filter) return { $tag: "EmiTypeMismatch" };
  if (profileId && instance.profileId !== profileId) {
    return { $tag: "EmiTypeMismatch" };
  }
  if (filter["event"] !== eventType) return { $tag: "EmiTypeMismatch" };
  const fields: EmFieldMarshalled[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === "event") continue;
    fields.push({
      $tag: "EmField",
      rawValue: value,
      // payloadValue is only consulted by the body when payloadPresent is
      // true; null is a safe placeholder for absent keys.
      payloadValue: Object.prototype.hasOwnProperty.call(eventPayload, key)
        ? eventPayload[key]
        : null,
      payloadPresent: Object.prototype.hasOwnProperty.call(eventPayload, key),
    });
  }
  return { $tag: "EmiCheck", fields, vars };
}

/** Dispatch the Fenel-bodied selectWaitingToResume. Classifies each waiting
 *  instance, then the body filters by `eventMatchesFilter` + maps to the
 *  matching instanceIds. Returns the ids the shell should resume. */
export function dispatchedSelectWaitingToResume(
  waiting: WaitingInstanceRow[],
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId: string | undefined,
): string[] {
  const cands = waiting.map((inst) => ({
    instanceId: inst.id,
    emInput: classifyWaitingInstance(inst, eventType, eventPayload, profileId),
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("runtime:selectWaitingToResume", [cands]);
  return Array.isArray(result) ? (result as string[]) : [];
}

/** A timeout-sweep candidate: an instance id + its parsed wake/timeout
 *  epoch-ms (undefined when the timestamp is absent → not due). The Date
 *  parse stays the shell's IO leaf. */
type DueCandidate = { instanceId: string; ms: number | undefined };

/** Dispatch the Fenel-bodied selectDueInstances. Marshals each candidate's
 *  `ms` to a Fenel Maybe<Number>; the body filters by `instantDue` (inclusive
 *  `<=` against nowMs) + maps to the due instanceIds. Used for BOTH the timer
 *  sweep and the event-timeout sweep. */
export function dispatchedSelectDueInstances(
  candidates: DueCandidate[],
  nowMs: number,
): string[] {
  const input = {
    candidates: candidates.map((c) => ({
      instanceId: c.instanceId,
      maybeMs:
        c.ms === undefined
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: c.ms },
    })),
    nowMs,
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("runtime:selectDueInstances", [input]);
  return Array.isArray(result) ? (result as string[]) : [];
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 1 — telegram-codec (camelCase ↔ snake_case wire codec)
// dispatch with CodecValue marshalling.
//
// The Fenel body operates on a pre-marshalled CodecValue ADT (one
// of CvNull / CvBool / CvNumber / CvString / CvArray / CvObject). The
// wrapper walks the input JS value at the boundary and emits one
// CodecValue; the body recursively rewrites object keys via
// camelToSnake / snakeToCamel; the wrapper unmarshals the result back
// to a plain JS shape.
//
// Same Phase 21.5 marshal-once recipe as engine-bodies-dispatch.ts's
// `normaliseToCore`. The marshalling tax is acceptable for Telegram
// payloads (small, typically <10KB) — documented for future codec
// ports (notion-codec.ts is heavier, may want a nativeImplsCtx fast
// path).
//
// `$tag` keys are preserved verbatim by the body (per the
// rewritePair `if eq p.key "$tag" then p.key else …` arm); the
// marshaller does NOT strip `$tag` from inner records so they
// round-trip with the discriminator intact.
// ---------------------------------------------------------------------------

type CodecPairMarshalled = {
  $tag: "CodecPair";
  key: string;
  value: CodecValueMarshalled;
};

type CodecValueMarshalled =
  | { $tag: "CvNull" }
  | { $tag: "CvBool"; value: boolean }
  | { $tag: "CvNumber"; value: number }
  | { $tag: "CvString"; value: string }
  | { $tag: "CvArray"; items: readonly CodecValueMarshalled[] }
  | { $tag: "CvObject"; pairs: readonly CodecPairMarshalled[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Recursively marshal an arbitrary JS value into the CodecValue ADT
 *  shape. Mirrors the union of cases the TS oracle's `rewriteKeys`
 *  walks. Non-plain-object values (functions, symbols, class
 *  instances) collapse to CvNull — matches the TS oracle's "pass
 *  through unchanged" except those won't appear in Telegram payloads
 *  in practice. */
function marshalCodecValue(node: unknown): CodecValueMarshalled {
  if (node === null || node === undefined) return { $tag: "CvNull" };
  if (typeof node === "boolean") return { $tag: "CvBool", value: node };
  if (typeof node === "number") return { $tag: "CvNumber", value: node };
  if (typeof node === "string") return { $tag: "CvString", value: node };
  if (Array.isArray(node)) {
    return { $tag: "CvArray", items: node.map(marshalCodecValue) };
  }
  if (isPlainObject(node)) {
    const pairs: CodecPairMarshalled[] = [];
    for (const [k, v] of Object.entries(node)) {
      pairs.push({ $tag: "CodecPair", key: k, value: marshalCodecValue(v) });
    }
    return { $tag: "CvObject", pairs };
  }
  // Non-plain object (function, symbol, class instance). Fall through
  // as CvNull — the TS oracle's `rewriteKeys` passes such values
  // unchanged via the `if (!isPlainObject(value)) return value` line,
  // but those are out-of-domain for Telegram codec inputs in practice.
  return { $tag: "CvNull" };
}

/** Inverse of marshalCodecValue. Walks the CodecValue ADT tree and
 *  reconstructs plain JS values. `$tag`-bearing inner records (Fenel
 *  variants nested inside payload values) ride through CvObject's
 *  pairs intact because marshalCodecValue treats `$tag` as a plain
 *  key. */
function unmarshalCodecValue(node: CodecValueMarshalled): unknown {
  switch (node.$tag) {
    case "CvNull":
      return null;
    case "CvBool":
      return node.value;
    case "CvNumber":
      return node.value;
    case "CvString":
      return node.value;
    case "CvArray":
      return node.items.map(unmarshalCodecValue);
    case "CvObject": {
      const out: Record<string, unknown> = {};
      for (const p of node.pairs) {
        out[p.key] = unmarshalCodecValue(p.value);
      }
      return out;
    }
  }
}

/** Dispatch the Fenel-bodied toTelegramWire (outbound: camelCase →
 *  snake_case keys). */
export function dispatchedToTelegramWire(value: unknown): unknown {
  const input = marshalCodecValue(value);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("runtime:toTelegramWire", [input]);
  return unmarshalCodecValue(result as CodecValueMarshalled);
}

/** Dispatch the Fenel-bodied fromTelegramWire (inbound: snake_case →
 *  camelCase keys). */
export function dispatchedFromTelegramWire(value: unknown): unknown {
  const input = marshalCodecValue(value);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("runtime:fromTelegramWire", [input]);
  return unmarshalCodecValue(result as CodecValueMarshalled);
}

/** Dispatch the Fenel-bodied camelToSnake (pure string transform).
 *  No marshalling needed — String passes through the engine call
 *  boundary directly. */
export function dispatchedCamelToSnake(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:camelToSnake", [s]) as string;
}

/** Dispatch the Fenel-bodied snakeToCamel (pure string transform). */
export function dispatchedSnakeToCamel(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:snakeToCamel", [s]) as string;
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 3 — mime.ts pure helpers dispatch.
//
// The body operates on a List<QpStep> for quotedPrintable. The TS-side
// classifier walks the input string's UTF-8 bytes (via TextEncoder),
// handles the CRLF / LF look-ahead (which is awkward inside a std:fold
// that sees one byte at a time), and emits a pre-classified
// List<QpStep>. The Fenel body std:fold over the steps with a
// state record `{ lines: List<String>, current: String }`.
//
// formatAddress / bodyText / bodyHtml dispatch through the EXISTING
// email module's Fenel bodies (`email:formatAddress` /
// `email:bodyText` / `email:bodyHtml` from Phase 5b1). The wrapper
// marshals the TS-side `string | null` displayName to Fenel-side
// `Maybe<String>` at the boundary.
//
// joinAddrs / guessContentType / wrapBase64 dispatch through the
// new `runtime:*` bodies. wrapBase64 doesn't need marshalling
// (String passes through unchanged); joinAddrs marshals a list of
// AddressValue → list of Fenel Address records before dispatch;
// guessContentType is String → String with no marshalling.
// ---------------------------------------------------------------------------

type QpStepMarshalled =
  | { $tag: "QpHardBreak" }
  | { $tag: "QpEncodedByte"; b: number }
  | { $tag: "QpVerbatimByte"; b: number };

/** Pre-classify the input string's UTF-8 bytes into a List<QpStep>.
 *  Mirrors the TS oracle's per-byte loop at runtime/src/providers/
 *  mime.ts:79-104 — handles CRLF / LF look-ahead, classifies each
 *  remaining byte as encoded (= 0x3D, control bytes other than 0x09,
 *  bytes > 126) or verbatim (printable ASCII). */
function classifyQuotedPrintable(input: string): QpStepMarshalled[] {
  const bytes = new TextEncoder().encode(input);
  const steps: QpStepMarshalled[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    // Native CRLF — keep as a hard line break (consume 2 bytes).
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      steps.push({ $tag: "QpHardBreak" });
      i++;
      continue;
    }
    // Bare LF — also a hard line break (consume 1 byte).
    if (b === 0x0a) {
      steps.push({ $tag: "QpHardBreak" });
      continue;
    }
    // Encodable: bytes outside printable-ascii, plus `=`. Space (0x20)
    // and tab (0x09) pass through (RFC 2045 allows them mid-line).
    const isControl = b < 32 && b !== 0x09;
    if (b === 0x3d || isControl || b > 126) {
      steps.push({ $tag: "QpEncodedByte", b });
    } else {
      steps.push({ $tag: "QpVerbatimByte", b });
    }
  }
  return steps;
}

/** Dispatch the Fenel-bodied quotedPrintable. The wrapper pre-
 *  classifies the input bytes into List<QpStep>; the body
 *  std:fold over the steps with a state record. */
export function dispatchedQuotedPrintable(input: string): string {
  const steps = classifyQuotedPrintable(input);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:quotedPrintable", [steps]) as string;
}

type FenelMaybeString =
  | { $tag: "Just"; _0: string }
  | { $tag: "Nothing" };

type FenelAddress = {
  $tag: "Address";
  local: string;
  domain: string;
  displayName: FenelMaybeString;
};

/** Marshal a TS-side AddressValue (with `string | null` displayName)
 *  into the Fenel-side Address shape (with `Maybe<String>`
 *  displayName). Returns null for a null/undefined input — the
 *  caller short-circuits to "" without dispatching. */
function marshalAddressToFenel(
  a: AddressValue | null | undefined,
): FenelAddress | null {
  if (!a) return null;
  return {
    $tag: "Address",
    local: a.local || "",
    domain: a.domain || "",
    displayName:
      a.displayName != null && a.displayName !== ""
        ? { $tag: "Just", _0: a.displayName }
        : { $tag: "Nothing" },
  };
}

/** Dispatch the Fenel-bodied email:formatAddress. The TS oracle's
 *  defensive `if (!a)` short-circuit happens in the wrapper (the
 *  Fenel body assumes a non-null Address — same contract as
 *  email:formatAddress's other callers). */
export function dispatchedFormatAddress(
  a: AddressValue | null | undefined,
): string {
  const marshalled = marshalAddressToFenel(a);
  if (!marshalled) return "";
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("email:formatAddress", [marshalled]) as string;
}

/** Dispatch the Fenel-bodied runtime:joinAddrs. Each AddressValue is
 *  marshalled to the Fenel-side Address shape (with Maybe<String>
 *  displayName); the body's map calls email:formatAddress via the
 *  registry, filters empty strings via inline lambda, joins with ", ". */
export function dispatchedJoinAddrs(list: AddressValue[]): string {
  const marshalled: FenelAddress[] = [];
  for (const a of list) {
    const m = marshalAddressToFenel(a);
    if (m) marshalled.push(m);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:joinAddrs", [marshalled]) as string;
}

/** Dispatch the Fenel-bodied email:bodyText. BodyValue's wire shape
 *  matches Fenel's Body ADT verbatim (Text { _0 } / Html { _0 } /
 *  Multipart { text, html }) — no marshalling needed. The body
 *  returns Maybe<String>; the wrapper unmarshals to `string | null`. */
export function dispatchedBodyText(b: BodyValue): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("email:bodyText", [b]) as FenelMaybeString;
  return result.$tag === "Just" ? result._0 : null;
}

/** Dispatch the Fenel-bodied email:bodyHtml. Same marshalling
 *  contract as dispatchedBodyText. */
export function dispatchedBodyHtml(b: BodyValue): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  const result = dispatchEngineBody("email:bodyHtml", [b]) as FenelMaybeString;
  return result.$tag === "Just" ? result._0 : null;
}

/** Dispatch the Fenel-bodied runtime:guessContentType. Pure String →
 *  String transform; no marshalling needed. */
export function dispatchedGuessContentType(filename: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:guessContentType", [filename]) as string;
}

/** Dispatch the Fenel-bodied runtime:wrapBase64. Pure String →
 *  String transform; no marshalling needed. */
export function dispatchedWrapBase64(b64: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody("runtime:wrapBase64", [b64]) as string;
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2a — notion-codec dispatch.
//
// Per-type encode/decode wrappers for §2-§7 of notion-codec.ts
// (NotionColor / SortDirection / TimestampField / Annotations /
// NotionDate / Parent / CommentParent / NotionFile / Icon / Cover).
// §1 helpers (camelToSnake / snakeToCamel / toNotionWire /
// fromNotionWire) reuse the Phase 11b sub-step 1 runtime:* fnIds —
// the notion-codec.ts shim layer routes through dispatchedCamelToSnake
// / dispatchedSnakeToCamel / dispatchedToTelegramWire /
// dispatchedFromTelegramWire directly (semantic-identical transforms;
// no need for notion:-namespaced duplicates).
//
// Boundary recipe per pair:
//   * Decoders: the wrapper pre-coerces the wire JS value into a
//     clean Fenel-shape record (asString / asBool / Maybe-wrap
//     optionals; pre-resolve nested wire shapes + fallback chains).
//     Body sees a flat record + reads fields directly via `.`-access.
//     Body returns the typed Fenel value ({$tag, ...}).
//   * Encoders: the wrapper passes the Fenel value through directly.
//     Body's case-of destructures + emits a wire-shape record (with
//     snake_case keys where applicable — valid Fenel identifiers).
//     Wrapper post-processes Maybe<X> fields (omit-when-Nothing).
//
// All wrappers go through `dispatchEngineBody("notion:<fnId>", ...)`
// which uses the harness's createRegistry list (notionModule was
// added in Phase 11b sub-step 2a to make these fnIds resolvable).
// ---------------------------------------------------------------------------

type NotionMaybeString =
  | { $tag: "Just"; _0: string }
  | { $tag: "Nothing" };

function isPlainObj(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asBoolVal(v: unknown): boolean {
  return v === true;
}

/** Wrap a raw JS value as a Fenel Maybe<String>. Non-string / null /
 *  undefined → Nothing; string → Just. Mirrors notion-codec.ts's
 *  `just(v)` but tightened to String for the codec's optional fields
 *  (which are all Maybe<String> in §2-§7). */
function maybeStr(v: unknown): NotionMaybeString {
  if (typeof v !== "string") return { $tag: "Nothing" };
  return { $tag: "Just", _0: v };
}

/** Unwrap a Fenel Maybe<String> to `string | undefined`. Mirrors
 *  notion-codec.ts's `unwrap<string>(v)`. */
function unwrapMaybeStr(v: unknown): string | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const tag = (v as { $tag?: unknown }).$tag;
  if (tag === "Just") return (v as { _0: string })._0;
  return undefined;
}

function getEngineBody(): typeof import("@fenel/engine/engine-bodies-dispatch").dispatchEngineBody {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = require("@fenel/engine/engine-bodies-dispatch") as typeof import("@fenel/engine/engine-bodies-dispatch");
  return dispatchEngineBody;
}

/** Dispatch the Fenel-bodied notion:decodeColor. String → NotionColor. */
export function dispatchedDecodeColor(v: unknown): unknown {
  return getEngineBody()("notion:decodeColor", [asStr(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeColor. NotionColor → String. */
export function dispatchedEncodeColor(v: unknown): string {
  return getEngineBody()("notion:encodeColor", [v]) as string;
}

/** Dispatch the Fenel-bodied notion:decodeSortDirection. */
export function dispatchedDecodeSortDirection(v: unknown): unknown {
  return getEngineBody()("notion:decodeSortDirection", [asStr(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeSortDirection. */
export function dispatchedEncodeSortDirection(v: unknown): string {
  return getEngineBody()("notion:encodeSortDirection", [v]) as string;
}

/** Dispatch the Fenel-bodied notion:decodeTimestampField. */
export function dispatchedDecodeTimestampField(v: unknown): unknown {
  return getEngineBody()("notion:decodeTimestampField", [asStr(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeTimestampField. */
export function dispatchedEncodeTimestampField(v: unknown): string {
  return getEngineBody()("notion:encodeTimestampField", [v]) as string;
}

/** Dispatch the Fenel-bodied notion:decodeAnnotations. The wrapper
 *  pre-coerces the 5 booleans + the color string TS-side; the body
 *  constructs the Annotations record + recursively calls decodeColor. */
export function dispatchedDecodeAnnotations(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const input = {
    bold: asBoolVal(w.bold),
    italic: asBoolVal(w.italic),
    strikethrough: asBoolVal(w.strikethrough),
    underline: asBoolVal(w.underline),
    code: asBoolVal(w.code),
    color: asStr(w.color),
  };
  return getEngineBody()("notion:decodeAnnotations", [input]);
}

/** Dispatch the Fenel-bodied notion:encodeAnnotations. Body returns
 *  a record with 5 booleans + the encoded-color string. */
export function dispatchedEncodeAnnotations(v: unknown): unknown {
  return getEngineBody()("notion:encodeAnnotations", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeNotionDate. The wrapper
 *  Maybe-wraps the 2 optional fields (end / time_zone) TS-side. */
export function dispatchedDecodeNotionDate(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const input = {
    start: asStr(w.start),
    end: maybeStr(w.end),
    time_zone: maybeStr(w.time_zone),
  };
  return getEngineBody()("notion:decodeNotionDate", [input]);
}

/** Dispatch the Fenel-bodied notion:encodeNotionDate. Body returns
 *  { start, end: Maybe<String>, time_zone: Maybe<String> }; the
 *  wrapper post-processes to omit Maybe-Nothing optionals + emit
 *  the JS wire-shape record. */
export function dispatchedEncodeNotionDate(v: unknown): unknown {
  const result = getEngineBody()("notion:encodeNotionDate", [v]) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = { start: asStr(result.start) };
  const end = unwrapMaybeStr(result.end);
  if (end !== undefined) out.end = end;
  const tz = unwrapMaybeStr(result.time_zone);
  if (tz !== undefined) out.time_zone = tz;
  return out;
}

/** Dispatch the Fenel-bodied notion:decodeParent. The wrapper pre-
 *  extracts all 3 id-named fields TS-side (empty string when absent);
 *  the body dispatches on `w.type` + reads the relevant id field. */
export function dispatchedDecodeParent(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const input = {
    type: asStr(w.type),
    page_id: asStr(w.page_id),
    database_id: asStr(w.database_id),
    block_id: asStr(w.block_id),
  };
  return getEngineBody()("notion:decodeParent", [input]);
}

/** Dispatch the Fenel-bodied notion:encodeParent. */
export function dispatchedEncodeParent(v: unknown): unknown {
  return getEngineBody()("notion:encodeParent", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeCommentParent. The wrapper
 *  pre-computes `has_discussion: Bool` TS-side from field presence
 *  of `discussion_id` as a string; the body dispatches on the flag. */
export function dispatchedDecodeCommentParent(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const input = {
    has_discussion: typeof w.discussion_id === "string",
    discussion_id: asStr(w.discussion_id),
    page_id: asStr(w.page_id),
  };
  return getEngineBody()("notion:decodeCommentParent", [input]);
}

/** Dispatch the Fenel-bodied notion:encodeCommentParent. */
export function dispatchedEncodeCommentParent(v: unknown): unknown {
  return getEngineBody()("notion:encodeCommentParent", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeNotionFile. The wrapper
 *  pre-resolves the wire's nested url + the `inner.expiry_time ??
 *  v.expiry_time` fallback chain TS-side; the body sees a flat
 *  record { type, url, expiry_time: Maybe<String> }. */
export function dispatchedDecodeNotionFile(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const isExternal = w.type === "external";
  if (isExternal) {
    const ext = isPlainObj(w.external) ? w.external : {};
    const input = {
      type: "external",
      url: asStr(ext.url),
      expiry_time: maybeStr(w.expiry_time),
    };
    return getEngineBody()("notion:decodeNotionFile", [input]);
  }
  // "file" or "file_upload" — both map to UploadedFile
  const inner = isPlainObj(w.file)
    ? w.file
    : isPlainObj(w.file_upload)
      ? w.file_upload
      : {};
  const rawExpiry =
    typeof inner.expiry_time === "string"
      ? inner.expiry_time
      : typeof w.expiry_time === "string"
        ? w.expiry_time
        : undefined;
  const input = {
    type: "uploaded",
    url: asStr(inner.url),
    expiry_time:
      rawExpiry === undefined
        ? ({ $tag: "Nothing" } as NotionMaybeString)
        : ({ $tag: "Just", _0: rawExpiry } as NotionMaybeString),
  };
  return getEngineBody()("notion:decodeNotionFile", [input]);
}

/** Dispatch the Fenel-bodied notion:encodeNotionFile. */
export function dispatchedEncodeNotionFile(v: unknown): unknown {
  return getEngineBody()("notion:encodeNotionFile", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeIcon. */
export function dispatchedDecodeIcon(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  if (t === "emoji") {
    return getEngineBody()("notion:decodeIcon", [
      {
        type: "emoji",
        emoji: asStr(w.emoji),
        url: "",
        expiry_time: { $tag: "Nothing" } as NotionMaybeString,
      },
    ]);
  }
  if (t === "external") {
    const ext = isPlainObj(w.external) ? w.external : {};
    return getEngineBody()("notion:decodeIcon", [
      {
        type: "external",
        emoji: "",
        url: asStr(ext.url),
        expiry_time: { $tag: "Nothing" } as NotionMaybeString,
      },
    ]);
  }
  // "file" or default → UploadedIcon
  const inner = isPlainObj(w.file) ? w.file : {};
  return getEngineBody()("notion:decodeIcon", [
    {
      type: "file",
      emoji: "",
      url: asStr(inner.url),
      expiry_time: maybeStr(inner.expiry_time),
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:encodeIcon. */
export function dispatchedEncodeIcon(v: unknown): unknown {
  return getEngineBody()("notion:encodeIcon", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeCover. */
export function dispatchedDecodeCover(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const isExternal = w.type === "external";
  if (isExternal) {
    const ext = isPlainObj(w.external) ? w.external : {};
    return getEngineBody()("notion:decodeCover", [
      {
        type: "external",
        url: asStr(ext.url),
        expiry_time: { $tag: "Nothing" } as NotionMaybeString,
      },
    ]);
  }
  const inner = isPlainObj(w.file) ? w.file : {};
  return getEngineBody()("notion:decodeCover", [
    {
      type: "file",
      url: asStr(inner.url),
      expiry_time: maybeStr(inner.expiry_time),
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:encodeCover. */
export function dispatchedEncodeCover(v: unknown): unknown {
  return getEngineBody()("notion:encodeCover", [v]);
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2b — notion-codec §8-§11 dispatch.
//
// Mid-complexity codecs covering NotionUser (+BotInfo +BotOwner), RichText
// (+Mention +TemplateMention), SelectOption + StatusGroup, FileRef +
// FormulaResult + RollupResult + RelationRef.
//
// Architecture extends 2a:
//   * Pre-shape helpers (`preShape*Input`) factor out the JS→Fenel input
//     transformations so cross-codec body-to-body bare-ident calls work.
//     The outer dispatched wrapper recursively pre-shapes the entire
//     input tree; each inner body sees a ready-to-use record.
//   * Finalize helpers (`finalize*Wire`) handle the post-dispatch
//     translation of Fenel Maybe<X> values back to wire-shape (omit-
//     when-Nothing for end / time_zone / href; JS null for absent
//     link). Each encode wrapper composes these helpers as needed.
//   * Cross-sub-step carve-out: dispatchedDecodeRollupResult's
//     ArrayRollup arm pre-decodes List<PropertyValue> elements TS-side
//     using the still-TS decodePropertyValue shim from notion-codec.ts.
//     When sub-step 2c lands notion:decodePropertyValue, the carve-out
//     can be removed (the body could then call decodePropertyValue via
//     bare-ident, or the wrapper can call dispatchedDecodePropertyValue).
//
// asNum is added as a sibling of asStr / asBoolVal for the Number /
// Boolean primitives that show up in FormulaResult / RollupResult.
// ---------------------------------------------------------------------------

/** Wrap a JS Number-or-null as Maybe<Number>. */
function maybeNum(v: unknown): unknown {
  if (typeof v !== "number") return { $tag: "Nothing" };
  return { $tag: "Just", _0: v };
}

/** Wrap a JS Boolean-or-null as Maybe<Boolean>. */
function maybeBool(v: unknown): unknown {
  if (typeof v !== "boolean") return { $tag: "Nothing" };
  return { $tag: "Just", _0: v };
}

/** Wrap a Fenel-decoded value (e.g. a typed NotionDate) as Maybe<X>.
 *  Returns Nothing for null/undefined input + Just for any other
 *  non-null value (caller has already done the decode). */
function maybeVal(v: unknown): unknown {
  if (v == null) return { $tag: "Nothing" };
  return { $tag: "Just", _0: v };
}

// Pre-shape helpers — factor out JS→Fenel input transforms so cross-
// codec bare-ident calls resolve. Each helper takes a raw wire JS
// value + returns the input record shape that the corresponding
// Fenel body expects.

function preShapeAnnotationsInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    bold: asBoolVal(w.bold),
    italic: asBoolVal(w.italic),
    strikethrough: asBoolVal(w.strikethrough),
    underline: asBoolVal(w.underline),
    code: asBoolVal(w.code),
    color: asStr(w.color),
  };
}

function preShapeNotionDateInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    start: asStr(w.start),
    end: maybeStr(w.end),
    time_zone: maybeStr(w.time_zone),
  };
}

function preShapeNotionFileInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const isExternal = w.type === "external";
  if (isExternal) {
    const ext = isPlainObj(w.external) ? w.external : {};
    return {
      type: "external",
      url: asStr(ext.url),
      expiry_time: maybeStr(w.expiry_time),
    };
  }
  const inner = isPlainObj(w.file)
    ? w.file
    : isPlainObj(w.file_upload)
      ? w.file_upload
      : {};
  const rawExpiry =
    typeof inner.expiry_time === "string"
      ? inner.expiry_time
      : typeof w.expiry_time === "string"
        ? w.expiry_time
        : undefined;
  return {
    type: "uploaded",
    url: asStr(inner.url),
    expiry_time:
      rawExpiry === undefined
        ? ({ $tag: "Nothing" } as NotionMaybeString)
        : ({ $tag: "Just", _0: rawExpiry } as NotionMaybeString),
  };
}

function preShapeBotOwnerInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const u = isPlainObj(w.user) ? w.user : {};
  return {
    type: asStr(w.type),
    user_id: asStr(u.id),
  };
}

function preShapeBotInfoInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    has_owner: w.owner !== undefined,
    owner_input: preShapeBotOwnerInput(w.owner),
    workspace_name: maybeStr(w.workspace_name),
  };
}

function preShapeNotionUserInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const p = isPlainObj(w.person) ? w.person : {};
  return {
    type: asStr(w.type),
    meta: {},
    id: asStr(w.id),
    name: maybeStr(w.name),
    avatar_url: maybeStr(w.avatar_url),
    email: maybeStr(p.email),
    bot_input: preShapeBotInfoInput(w.bot),
  };
}

function preShapeTemplateMentionInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    type: asStr(w.type),
    template_mention_user: asStr(w.template_mention_user),
    template_mention_date: asStr(w.template_mention_date),
  };
}

function preShapeMentionInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  const pageObj = isPlainObj(w.page) ? w.page : {};
  const dbObj = isPlainObj(w.database) ? w.database : {};
  const lpObj = isPlainObj(w.link_preview) ? w.link_preview : {};
  const lmObj = isPlainObj(w.link_mention) ? w.link_mention : {};
  // For "link_mention" (or default fall-through), the TS oracle reads
  // `lm.href ?? v.href ?? ""`. Mirror that resolution here.
  const linkUrl =
    typeof lmObj.href === "string"
      ? lmObj.href
      : typeof w.href === "string"
        ? w.href
        : "";
  return {
    type: t,
    user_input: preShapeNotionUserInput(w.user),
    page_id: asStr(pageObj.id),
    database_id: asStr(dbObj.id),
    date_input: preShapeNotionDateInput(w.date),
    template_input: preShapeTemplateMentionInput(w.template_mention),
    link_preview_url: asStr(lpObj.url),
    link_url: linkUrl,
  };
}

function preShapeRichTextInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  const textObj = isPlainObj(w.text) ? w.text : {};
  const linkObj = isPlainObj(textObj.link) ? textObj.link : null;
  const eqObj = isPlainObj(w.equation) ? w.equation : {};
  // Per TS oracle (handlers/notion-codec.ts:399): `link = isObj(t.link)
  // ? asString(t.link.url) : null` — link is the inner url string or
  // null. Wrap as Maybe<String>.
  const linkMaybe: NotionMaybeString = linkObj
    ? { $tag: "Just", _0: asStr(linkObj.url) }
    : { $tag: "Nothing" };
  return {
    type: t,
    content: asStr(textObj.content),
    link: linkMaybe,
    expression: asStr(eqObj.expression),
    mention_input: preShapeMentionInput(w.mention),
    annotations_input: preShapeAnnotationsInput(w.annotations),
    plain_text: asStr(w.plain_text),
    href: maybeStr(w.href),
  };
}

// ---------------------------------------------------------------------------
// Finalize helpers — post-dispatch translation of Fenel Maybe<X> back
// to wire shape. Shared between dispatchedEncode* wrappers for
// recursive finalization of embedded sub-records.
// ---------------------------------------------------------------------------

function finalizeNotionDateWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return raw;
  const out: Record<string, unknown> = { start: asStr(raw.start) };
  const end = unwrapMaybeStr(raw.end);
  if (end !== undefined) out.end = end;
  const tz = unwrapMaybeStr(raw.time_zone);
  if (tz !== undefined) out.time_zone = tz;
  return out;
}

function finalizeMentionWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return raw;
  // PageMention / DatabaseMention emit flat _pageId / _databaseId markers
  // because `{ id = X }` single-field record literals in the body would
  // be evaluated as a call to `std:id` (codeName clash). Wrapper assembles
  // the nested `{ page: { id } }` / `{ database: { id } }` wire shape.
  if (raw.type === "page" && "_pageId" in raw) {
    return { type: "page", page: { id: asStr((raw as { _pageId: unknown })._pageId) } };
  }
  if (raw.type === "database" && "_databaseId" in raw) {
    return { type: "database", database: { id: asStr((raw as { _databaseId: unknown })._databaseId) } };
  }
  // DateMention's `date` sub-record has Maybe<String> end / time_zone
  // fields emitted by encodeNotionDate's body; finalize them.
  if (raw.type === "date" && isPlainObj(raw.date)) {
    return { ...raw, date: finalizeNotionDateWire(raw.date) };
  }
  return raw;
}

function finalizeRichTextWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  // Finalize top-level href: omit-when-Nothing.
  const href = unwrapMaybeStr(raw.href);
  if (href === undefined) {
    delete out.href;
  } else {
    out.href = href;
  }
  // Type-specific finalization.
  if (raw.type === "text" && isPlainObj(raw.text)) {
    const text: Record<string, unknown> = { ...raw.text };
    const link = unwrapMaybeStr(text.link);
    text.link = link === undefined ? null : { url: link };
    out.text = text;
  }
  if (raw.type === "mention" && raw.mention !== undefined) {
    out.mention = finalizeMentionWire(raw.mention);
  }
  // RichTextEquation: no extra finalization beyond href.
  return out;
}

// ---------------------------------------------------------------------------
// Dispatched wrappers — §8 NotionUser
// ---------------------------------------------------------------------------

/** Dispatch the Fenel-bodied notion:decodeBotOwner. The wrapper
 *  extracts type + nested user.id; the body dispatches on type. */
export function dispatchedDecodeBotOwner(v: unknown): unknown {
  return getEngineBody()("notion:decodeBotOwner", [preShapeBotOwnerInput(v)]);
}

/** Dispatch the Fenel-bodied notion:decodeBotInfo. The wrapper
 *  pre-classifies has_owner from field presence + pre-shapes the
 *  owner_input record + Maybe-wraps workspace_name. */
export function dispatchedDecodeBotInfo(v: unknown): unknown {
  return getEngineBody()("notion:decodeBotInfo", [preShapeBotInfoInput(v)]);
}

/** Dispatch the Fenel-bodied notion:decodeNotionUser. The wrapper
 *  recursively pre-shapes the entire input tree (including bot_input
 *  for the BotUser arm) so the body's bare-ident decodeBotInfo call
 *  resolves with a ready-to-use input record. */
export function dispatchedDecodeNotionUser(v: unknown): unknown {
  return getEngineBody()("notion:decodeNotionUser", [preShapeNotionUserInput(v)]);
}

// ---------------------------------------------------------------------------
// Dispatched wrappers — §9 RichText + Mention + TemplateMention
// ---------------------------------------------------------------------------

/** Dispatch the Fenel-bodied notion:decodeTemplateMention. */
export function dispatchedDecodeTemplateMention(v: unknown): unknown {
  return getEngineBody()("notion:decodeTemplateMention", [preShapeTemplateMentionInput(v)]);
}

/** Dispatch the Fenel-bodied notion:decodeMention. Wrapper recursively
 *  pre-shapes user_input / date_input / template_input for the bare-
 *  ident cross-codec calls in the body. */
export function dispatchedDecodeMention(v: unknown): unknown {
  return getEngineBody()("notion:decodeMention", [preShapeMentionInput(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeMention. Body emits the
 *  wire shape with Maybe-typed sub-fields (DateMention's date sub-
 *  record); wrapper finalizes via finalizeMentionWire. */
export function dispatchedEncodeMention(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeMention", [v]);
  return finalizeMentionWire(raw);
}

/** Dispatch the Fenel-bodied notion:decodeRichText. Wrapper pre-
 *  shapes nested annotations_input + mention_input + the link/href
 *  Maybe<String> fields. Body's bare-ident decodeAnnotations /
 *  decodeMention calls resolve. */
export function dispatchedDecodeRichText(v: unknown): unknown {
  return getEngineBody()("notion:decodeRichText", [preShapeRichTextInput(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeRichText. Body emits
 *  Maybe<String> for href + (RichTextText only) text.link + may
 *  embed Maybe-laden Mention sub-records (DateMention's date).
 *  Wrapper finalizes all of these. */
export function dispatchedEncodeRichText(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeRichText", [v]);
  return finalizeRichTextWire(raw);
}

// ---------------------------------------------------------------------------
// Dispatched wrappers — §10 SelectOption + StatusGroup
// ---------------------------------------------------------------------------

/** Dispatch the Fenel-bodied notion:decodeSelectOption. */
export function dispatchedDecodeSelectOption(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodeSelectOption", [
    {
      id: asStr(w.id),
      name: asStr(w.name),
      color: asStr(w.color),
      description: maybeStr(w.description),
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:decodeStatusGroup. Wrapper pre-
 *  decodes option_ids as List<String>. */
export function dispatchedDecodeStatusGroup(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const optionIds = Array.isArray(w.option_ids)
    ? w.option_ids.map(asStr)
    : [];
  return getEngineBody()("notion:decodeStatusGroup", [
    {
      id: asStr(w.id),
      name: asStr(w.name),
      color: asStr(w.color),
      option_ids: optionIds,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Dispatched wrappers — §11 FileRef + FormulaResult + RollupResult + RelationRef
// ---------------------------------------------------------------------------

/** Dispatch the Fenel-bodied notion:decodeFileRef. Wrapper pre-shapes
 *  file_input via preShapeNotionFileInput; body calls decodeNotionFile
 *  via bare-ident. */
export function dispatchedDecodeFileRef(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodeFileRef", [
    {
      name: asStr(w.name),
      file_input: preShapeNotionFileInput(w),
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:encodeFileRef. Body uses nested
 *  named-field destructuring (`FileRef { name = n, file = ExternalFile
 *  { url = u } }`) to emit the merged wire shape directly. */
export function dispatchedEncodeFileRef(v: unknown): unknown {
  return getEngineBody()("notion:encodeFileRef", [v]);
}

/** Dispatch the Fenel-bodied notion:decodeFormulaResult. Wrapper
 *  pre-decodes the date variant TS-side + Maybe-wraps all primitive
 *  values. */
export function dispatchedDecodeFormulaResult(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  // String / Number / Boolean values use `just(<raw>)` semantics — Nothing
  // when the wire value is null/missing, Just<value> otherwise.
  const stringValue = typeof w.string === "string"
    ? { $tag: "Just", _0: w.string }
    : { $tag: "Nothing" };
  const numberValue = maybeNum(w.number);
  const booleanValue = maybeBool(w.boolean);
  let dateValue: unknown = { $tag: "Nothing" };
  if (w.date != null) {
    dateValue = maybeVal(dispatchedDecodeNotionDate(w.date));
  }
  return getEngineBody()("notion:decodeFormulaResult", [
    {
      type: t,
      string_value: stringValue,
      number_value: numberValue,
      boolean_value: booleanValue,
      date_value: dateValue,
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:decodeRollupResult. Wrapper pre-
 *  decodes NumberRollup / DateRollup Maybe<X> values + the ArrayRollup
 *  array (cross-sub-step carve-out: still uses TS-side decodePropertyValue
 *  from notion-codec.ts until sub-step 2c registers
 *  notion:decodePropertyValue). */
export function dispatchedDecodeRollupResult(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  const numberValue = maybeNum(w.number);
  let dateValue: unknown = { $tag: "Nothing" };
  if (w.date != null) {
    dateValue = maybeVal(dispatchedDecodeNotionDate(w.date));
  }
  // Sub-step 2c resolves the cross-sub-step carve-out: ArrayRollup arm
  // pre-decodes its [PropertyValue] elements via dispatchedDecodePropertyValue
  // directly (Fenel-bodied via notion:decodePropertyValue). Previously this
  // routed through the TS-side decodePropertyValue lazy-require shim from
  // ./handlers/notion-codec — same Fenel body either way, but the wrapper-
  // to-wrapper call removes the shim indirection.
  let valuesInput: unknown[] = [];
  if (Array.isArray(w.array)) {
    valuesInput = w.array.map((el) => dispatchedDecodePropertyValue(el));
  }
  return getEngineBody()("notion:decodeRollupResult", [
    {
      type: t,
      number_value: numberValue,
      date_value: dateValue,
      values_input: valuesInput,
    },
  ]);
}

/** Dispatch the Fenel-bodied notion:decodeRelationRef. */
export function dispatchedDecodeRelationRef(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodeRelationRef", [{ id: asStr(w.id) }]);
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2c — notion-codec §12-§14 dispatch.
//
// PropertyValue + PropertyWrite + Property schema codecs. The largest single
// arc in the codec series: decodePropertyValue + decodeProperty each have 24
// arms; encodePropertyWrite has 14.
//
// Architecture extends 2a + 2b:
//   * dispatchedDecodePropertyValue: recursively pre-decodes every nested
//     value TS-side via the 2a/2b dispatched* wrappers (decodeRichText,
//     decodeSelectOption, decodeNotionDate, decodeNotionUser, decodeFileRef,
//     decodeFormulaResult, decodeRollupResult, decodeRelationRef) + passes
//     a flat record with Maybe-wrapped optionals to the body. The body
//     dispatches on `type` + reads pre-decoded fields directly.
//   * dispatchedEncodePropertyWrite: dispatches body, then switches on the
//     `_wkind` marker field + applies per-arm wire-shape transformations
//     TS-side (list-element encoding, Maybe → null|value finalization,
//     [String] → [{name}] / [{id}] / [{object, id}] wrappers).
//   * dispatchedDecodeProperty: similar pre-decoding pattern to
//     PropertyValue but for the schema side.
//   * dispatchedDecodePropertiesObject / dispatchedDecodePropertySchemaObject:
//     wrapper walks JS object via Object.entries TS-side + pre-decodes each
//     value via dispatchedDecodePropertyValue / dispatchedDecodeProperty;
//     body just wraps each entry in PropertyEntry / PropertySchemaEntry via
//     std:map + lambda.
//   * dispatchedDecodeRelationKind: small dispatch helper for the relation
//     property's `kind` sub-record.
//
// Resolves the 2b ArrayRollup cross-sub-step carve-out: the
// dispatchedDecodeRollupResult ArrayRollup arm switches from the still-TS
// `decodePropertyValue` shim (lazy-require from ./handlers/notion-codec)
// to direct `dispatchedDecodePropertyValue` calls — same Fenel body either
// way, but the wrapper-to-wrapper call removes the shim indirection +
// satisfies the 2b carve-out's "drop the TS-side pre-decoding" follow-up.
// ---------------------------------------------------------------------------

/** Map an array to typed Fenel `Maybe<X>` by pre-decoding via the inner
 *  decoder. Returns Just<decoded> for non-null inputs, Nothing for null. */
function maybeDecode(v: unknown, decoder: (x: unknown) => unknown): unknown {
  if (v == null) return { $tag: "Nothing" };
  return { $tag: "Just", _0: decoder(v) };
}

/** Maybe-wrap a JS string-or-null value (Notion API often emits string
 *  values + null for absence). */
function maybeStrOrNull(v: unknown): unknown {
  if (typeof v !== "string") return { $tag: "Nothing" };
  return { $tag: "Just", _0: v };
}

function asListOf<T>(v: unknown, decode: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) return [];
  return v.map(decode);
}

/** Pre-shape a Notion PropertyValue wire record into the flat input the
 *  Fenel body expects. Pre-decodes every nested value via the 2a/2b
 *  dispatched* wrappers; Maybe-wraps all optional fields. */
function preShapePropertyValueInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const t = asStr(w.type);
  const id = asStr(w.id);

  // Pre-decode lists of typed values
  const titleRichText = asListOf(w.title, dispatchedDecodeRichText);
  const richTextRichText = asListOf(w.rich_text, dispatchedDecodeRichText);
  const multiSelectOptions = asListOf(w.multi_select, dispatchedDecodeSelectOption);
  const peopleList = asListOf(w.people, dispatchedDecodeNotionUser);
  const filesList = asListOf(w.files, dispatchedDecodeFileRef);
  const relationList = asListOf(w.relation, dispatchedDecodeRelationRef);

  // Maybe<X> single-typed-value optionals
  const selectOption = maybeDecode(w.select, dispatchedDecodeSelectOption);
  const statusOption = maybeDecode(w.status, dispatchedDecodeSelectOption);
  const dateValue = maybeDecode(w.date, dispatchedDecodeNotionDate);

  // Maybe<Primitive> optionals
  const numberValue = maybeNum(w.number);
  const urlValue = maybeStrOrNull(w.url);
  const emailValue = maybeStrOrNull(w.email);
  const phoneNumberValue = maybeStrOrNull(w.phone_number);

  // Always-decoded sub-records (no Maybe wrapping)
  // `formula` and `rollup` are always present when the arm matches; the
  // dispatched* decoders accept null gracefully but the wrappers expect
  // a valid input record, so default to {} for the missing case.
  const formulaValue = dispatchedDecodeFormulaResult(w.formula);
  const rollupValue = dispatchedDecodeRollupResult(w.rollup);
  const createdByUser = dispatchedDecodeNotionUser(w.created_by);
  const lastEditedByUser = dispatchedDecodeNotionUser(w.last_edited_by);

  // unique_id has a 2-field nested wire shape
  const uid = isPlainObj(w.unique_id) ? w.unique_id : {};
  const uidNumber = maybeNum(uid.number);
  const uidPrefix = maybeStrOrNull(uid.prefix);

  // verification has 3-field nested wire shape
  const ver = isPlainObj(w.verification) ? w.verification : {};
  const verState = asStr(ver.state);
  const verVerifiedBy = maybeDecode(ver.verified_by, dispatchedDecodeNotionUser);
  const verDate = maybeDecode(ver.date, dispatchedDecodeNotionDate);

  return {
    type: t,
    id,
    title_richtext: titleRichText,
    rich_text_richtext: richTextRichText,
    number_value: numberValue,
    select_option: selectOption,
    multi_select_options: multiSelectOptions,
    status_option: statusOption,
    date_value: dateValue,
    people_list: peopleList,
    files_list: filesList,
    checkbox_value: asBoolVal(w.checkbox),
    url_value: urlValue,
    email_value: emailValue,
    phone_number_value: phoneNumberValue,
    formula_value: formulaValue,
    relation_list: relationList,
    has_more: asBoolVal(w.has_more),
    rollup_value: rollupValue,
    created_time: asStr(w.created_time),
    created_by_user: createdByUser,
    last_edited_time: asStr(w.last_edited_time),
    last_edited_by_user: lastEditedByUser,
    uid_number: uidNumber,
    uid_prefix: uidPrefix,
    ver_state: verState,
    ver_verified_by: verVerifiedBy,
    ver_date: verDate,
  };
}

/** Dispatch the Fenel-bodied notion:decodePropertyValue. The wrapper
 *  recursively pre-decodes every nested value (lists via dispatchedDecode*
 *  wrappers, Maybe-wrapped sub-records via maybeDecode) so the body's 24
 *  arms read flat fields without further dispatch. */
export function dispatchedDecodePropertyValue(v: unknown): unknown {
  return getEngineBody()("notion:decodePropertyValue", [preShapePropertyValueInput(v)]);
}

/** Dispatch the Fenel-bodied notion:decodePropertiesObject. The wrapper
 *  walks JS object via Object.entries + pre-decodes each value via
 *  dispatchedDecodePropertyValue. The body uses std:map + lambda to wrap
 *  each pre-shaped entry into PropertyEntry. */
export function dispatchedDecodePropertiesObject(v: unknown): unknown {
  if (!isPlainObj(v)) return [];
  const entries: Array<{ name: string; value: unknown }> = [];
  for (const [name, value] of Object.entries(v)) {
    entries.push({ name, value: dispatchedDecodePropertyValue(value) });
  }
  return getEngineBody()("notion:decodePropertiesObject", [entries]);
}

/** Finalize the body's marker record output into the Notion wire-shape
 *  for PropertyWrite. Switches on the body's `_wkind` field to apply the
 *  per-arm wire transformation. */
function finalizePropertyWriteWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return {};
  const wkind = asStr(raw._wkind);
  switch (wkind) {
    case "TitleWrite":
      return {
        title: asListOf(raw.richText, dispatchedEncodeRichText),
      };
    case "RichTextWrite":
      return {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
      };
    case "NumberWrite": {
      const n = unwrapMaybeAny(raw.number);
      return { number: n === undefined ? null : n };
    }
    case "SelectWrite": {
      const name = unwrapMaybeStr(raw.optionName);
      return { select: name === undefined ? null : { name } };
    }
    case "MultiSelectWrite": {
      const names = asListOf(raw.optionNames, asStr);
      return { multi_select: names.map((name) => ({ name })) };
    }
    case "StatusWrite": {
      const name = unwrapMaybeStr(raw.optionName);
      return { status: name === undefined ? null : { name } };
    }
    case "DateWrite": {
      const d = unwrapMaybeAny(raw.date);
      return { date: d === undefined ? null : dispatchedEncodeNotionDate(d) };
    }
    case "PeopleWrite": {
      const ids = asListOf(raw.userIds, asStr);
      return { people: ids.map((id) => ({ object: "user", id })) };
    }
    case "FilesWrite":
      return {
        files: asListOf(raw.files, dispatchedEncodeFileRef),
      };
    case "CheckboxWrite":
      return { checkbox: asBoolVal(raw.checkbox) };
    case "UrlWrite": {
      const u = unwrapMaybeStr(raw.url);
      return { url: u === undefined ? null : u };
    }
    case "EmailWrite": {
      const e = unwrapMaybeStr(raw.email);
      return { email: e === undefined ? null : e };
    }
    case "PhoneNumberWrite": {
      const p = unwrapMaybeStr(raw.phoneNumber);
      return { phone_number: p === undefined ? null : p };
    }
    case "RelationWrite": {
      const ids = asListOf(raw.pageIds, asStr);
      return { relation: ids.map((id) => ({ id })) };
    }
    default:
      return {};
  }
}

/** Unwrap a Fenel Maybe<any> to `any | undefined`. Returns the inner
 *  value for Just<v>, undefined for Nothing. Tolerant of bare JS values
 *  too (passes through). */
function unwrapMaybeAny(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object") return v;
  const tag = (v as { $tag?: unknown }).$tag;
  if (tag === "Just") return (v as { _0: unknown })._0;
  if (tag === "Nothing") return undefined;
  return v;
}

/** Dispatch the Fenel-bodied notion:encodePropertyWrite. The body emits a
 *  marker record `{ _wkind = "<Variant>", ...raw_fields }`; the wrapper
 *  finalizes to the Notion wire shape (per-arm list encoding, Maybe →
 *  null|value, [String] → [{name}]/[{id}]/[{object, id}] etc.). */
export function dispatchedEncodePropertyWrite(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodePropertyWrite", [v]);
  return finalizePropertyWriteWire(raw);
}

/** Pre-shape a Notion RelationKind sub-record for the body. The TS oracle
 *  reads the synced-property strings from `v.dual_property.*`, so flatten
 *  them at the wrapper boundary. */
function preShapeRelationKindInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const dp = isPlainObj(w.dual_property) ? w.dual_property : {};
  return {
    type: asStr(w.type),
    synced_property_name: asStr(dp.synced_property_name),
    synced_property_id: asStr(dp.synced_property_id),
  };
}

/** Dispatch the Fenel-bodied notion:decodeRelationKind. */
export function dispatchedDecodeRelationKind(v: unknown): unknown {
  return getEngineBody()("notion:decodeRelationKind", [preShapeRelationKindInput(v)]);
}

/** Pre-shape a Notion Property wire record for the body. Pre-decodes
 *  nested lists (select options, status groups) + computes RelationKind
 *  for the relation arm. */
function preShapePropertyInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  const id = asStr(w.id);
  const name = asStr(w.name);
  const t = asStr(w.type);

  // number_format from v.number.format
  const numberInner = isPlainObj(w.number) ? w.number : {};
  const numberFormat = asStr(numberInner.format);

  // select_options + multi_select_options + status_options/groups from
  // their respective nested wire records
  const selectInner = isPlainObj(w.select) ? w.select : {};
  const selectOptions = asListOf(selectInner.options, dispatchedDecodeSelectOption);
  const multiSelectInner = isPlainObj(w.multi_select) ? w.multi_select : {};
  const multiSelectOptions = asListOf(multiSelectInner.options, dispatchedDecodeSelectOption);
  const statusInner = isPlainObj(w.status) ? w.status : {};
  const statusOptions = asListOf(statusInner.options, dispatchedDecodeSelectOption);
  const statusGroups = asListOf(statusInner.groups, dispatchedDecodeStatusGroup);

  // formula expression from v.formula.expression
  const formulaInner = isPlainObj(w.formula) ? w.formula : {};
  const formulaExpression = asStr(formulaInner.expression);

  // relation from v.relation.{database_id, type, dual_property: {...}}
  const relationInner = isPlainObj(w.relation) ? w.relation : {};
  const relationDbId = asStr(relationInner.database_id);
  // The TS oracle's decodeRelationKind reads v.relation directly (v.type
  // is the inner type discriminator, v.dual_property is the inner record).
  // So pass the relationInner directly to dispatchedDecodeRelationKind.
  const dualPropertyInner = isPlainObj(relationInner.dual_property)
    ? relationInner.dual_property
    : {};
  const relationKindRaw = {
    type: asStr(relationInner.type),
    synced_property_name: asStr(dualPropertyInner.synced_property_name),
    synced_property_id: asStr(dualPropertyInner.synced_property_id),
  };
  const relationKind = getEngineBody()("notion:decodeRelationKind", [relationKindRaw]);

  // rollup's 5 strings from v.rollup
  const rollupInner = isPlainObj(w.rollup) ? w.rollup : {};
  const rollupRpn = asStr(rollupInner.relation_property_name);
  const rollupRpnm = asStr(rollupInner.rollup_property_name);
  const rollupRpi = asStr(rollupInner.relation_property_id);
  const rollupRpid = asStr(rollupInner.rollup_property_id);
  const rollupFn = asStr(rollupInner.function);

  // unique_id prefix
  const uniqueIdInner = isPlainObj(w.unique_id) ? w.unique_id : {};
  const uidPrefix = maybeStrOrNull(uniqueIdInner.prefix);

  return {
    type: t,
    id,
    name,
    number_format: numberFormat,
    select_options: selectOptions,
    multi_select_options: multiSelectOptions,
    status_options: statusOptions,
    status_groups: statusGroups,
    formula_expression: formulaExpression,
    relation_db_id: relationDbId,
    relation_kind: relationKind,
    rollup_rpn: rollupRpn,
    rollup_rpnm: rollupRpnm,
    rollup_rpi: rollupRpi,
    rollup_rpid: rollupRpid,
    rollup_fn: rollupFn,
    uid_prefix: uidPrefix,
  };
}

/** Dispatch the Fenel-bodied notion:decodeProperty. */
export function dispatchedDecodeProperty(v: unknown): unknown {
  return getEngineBody()("notion:decodeProperty", [preShapePropertyInput(v)]);
}

/** Dispatch the Fenel-bodied notion:decodePropertySchemaObject. The
 *  wrapper walks JS object via Object.entries + pre-decodes each
 *  property via dispatchedDecodeProperty. */
export function dispatchedDecodePropertySchemaObject(v: unknown): unknown {
  if (!isPlainObj(v)) return [];
  const entries: Array<{ name: string; property: unknown }> = [];
  for (const [name, property] of Object.entries(v)) {
    entries.push({ name, property: dispatchedDecodeProperty(property) });
  }
  return getEngineBody()("notion:decodePropertySchemaObject", [entries]);
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2d — notion-codec §15 dispatch.
//
// LinkTarget + BlockContent + Block codecs. The biggest single arc in the
// codec series: BlockContent has 33 arms covering paragraph / 3 headings /
// 2 list items / to_do / toggle / code / callout / quote / equation /
// divider / table_of_contents / breadcrumb / 2 child kinds / embed /
// bookmark / link_preview / link_to_page / 5 media arms / table /
// table_row / 2 column kinds / synced_block / template / unsupported
// fallback.
//
// Architecture extends 2c with **mutually recursive body-to-body** calls
// via wrapper-side TS recursion:
//   * dispatchedDecodeBlock recursively calls dispatchedDecodeBlockContent
//     for its `content` field.
//   * dispatchedDecodeBlockContent recursively calls dispatchedDecodeBlock
//     for each child in `children`.
//   * dispatchedEncodeBlockContent recursively calls itself for children
//     in nested container arms (paragraph / heading_X / toggle / etc.).
//
// Wrapper-side TS recursion is the safe choice (Notion API limits nesting
// depth — practical worst case is ~5-10 levels for toggle-inside-toggle,
// no stack risk).
//
// The encoder follows 2c's `_wkind`-marker pattern (renamed to `_kind`
// here for §15-specific naming): body emits a FLAT marker
// `{ _kind = "<wire_type>", ...camelCase_payload }`; wrapper finalize
// switches on `_kind` + assembles the Notion wire shape
//   `{ object: "block", type: <wire_type>, <wire_type>: { ...wire payload } }`
// with per-arm transformations.
//
// Media payload helpers (encodeMediaPayloadWire / decodeMediaPayload) stay
// TS-only inline-utilities — 5 arms each duplicate the file+caption
// pattern (the brief considered factoring as separate fnIds but inlining
// matches 2a-2c's decision to keep small helpers inlined).
// ---------------------------------------------------------------------------

/** Pre-shape a Notion LinkTarget wire record into the flat input the
 *  Fenel body expects. Used by LinkToPageContent (the wire's `link_to_page`
 *  payload). */
function preShapeLinkTargetInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    type: asStr(w.type),
    database_id: asStr(w.database_id),
    page_id: asStr(w.page_id),
  };
}

/** Dispatch the Fenel-bodied notion:decodeLinkTarget. */
export function dispatchedDecodeLinkTarget(v: unknown): unknown {
  return getEngineBody()("notion:decodeLinkTarget", [preShapeLinkTargetInput(v)]);
}

/** Dispatch the Fenel-bodied notion:encodeLinkTarget. Body emits the
 *  snake_case wire shape directly; wrapper passes through unchanged. */
export function dispatchedEncodeLinkTarget(v: unknown): unknown {
  return getEngineBody()("notion:encodeLinkTarget", [v]);
}

/** Pre-shape a Notion BlockContent wire record into the flat input the
 *  Fenel body expects. The TS oracle's decodeBlockContent extracts
 *  `payload = v[v.type]` (dynamic bracket access — not natural Fenel),
 *  then reads payload.rich_text / payload.color / payload.children / etc.
 *  We do that extraction TS-side + pre-decode every nested value via the
 *  2a/2b dispatched* wrappers (including RECURSIVE dispatchedDecodeBlock
 *  for the `children: [Block]` field — mutual recursion through the
 *  dispatch boundary).
 *
 *  This wrapper is called by dispatchedDecodeBlockContent below; the
 *  wrapper-side recursion enters dispatchedDecodeBlock which in turn
 *  re-enters dispatchedDecodeBlockContent for the inner content. Notion
 *  API limits nesting depth (~5-10 levels in practice), so no stack risk. */
function preShapeBlockContentInput(v: unknown): Record<string, unknown> {
  if (!isPlainObj(v)) return { type: "" };
  const t = asStr(v.type);
  const payload = isPlainObj((v as Record<string, unknown>)[t])
    ? ((v as Record<string, unknown>)[t] as Record<string, unknown>)
    : {};

  // Lists
  const richText = asListOf(payload.rich_text, dispatchedDecodeRichText);
  const caption = asListOf(payload.caption, dispatchedDecodeRichText);
  const children = asListOf(payload.children, dispatchedDecodeBlock);

  // Atomic primitives
  const isToggleable = asBoolVal(payload.is_toggleable);
  const checked = asBoolVal(payload.checked);
  const language = asStr(payload.language);
  const expression = asStr(payload.expression);
  const title = asStr(payload.title);
  const url = asStr(payload.url);
  const name = asStr(payload.name);
  const tableWidth = typeof payload.table_width === "number" ? payload.table_width : 0;
  const hasColumnHeader = asBoolVal(payload.has_column_header);
  const hasRowHeader = asBoolVal(payload.has_row_header);

  // Pre-decoded variants
  const color = dispatchedDecodeColor(payload.color);
  const icon = maybeDecode(payload.icon, dispatchedDecodeIcon);

  // LinkToPageContent: target is built from the payload itself (the payload
  // has `type: "database_id"|"page_id"` + corresponding id field — same
  // wire shape as a LinkTarget).
  const target = dispatchedDecodeLinkTarget(payload);

  // Media file: the payload itself carries the NotionFile wire shape
  // (type/external/file with url + expiry_time fields). Pre-decode it.
  const file = dispatchedDecodeNotionFile(payload);

  // TableRowContent.cells: [[RichText]] (nested list-of-lists). Each cell
  // is a [RichText]; the wrapper recursively pre-maps both levels.
  const cellsRaw = Array.isArray(payload.cells) ? payload.cells : [];
  const cells = cellsRaw.map((cell) => asListOf(cell, dispatchedDecodeRichText));

  // SyncedBlockContent.syncedFromBlockId: extract from
  // payload.synced_from?.block_id; wrap as Maybe<String>.
  const syncedFrom = isPlainObj(payload.synced_from) ? payload.synced_from : null;
  const syncedFromBlockId = syncedFrom && typeof syncedFrom.block_id === "string"
    ? ({ $tag: "Just", _0: syncedFrom.block_id } as const)
    : ({ $tag: "Nothing" } as const);

  return {
    type: t,
    rich_text: richText,
    color,
    children,
    caption,
    is_toggleable: isToggleable,
    checked,
    language,
    icon,
    expression,
    title,
    url,
    target,
    file,
    name,
    table_width: tableWidth,
    has_column_header: hasColumnHeader,
    has_row_header: hasRowHeader,
    cells,
    synced_from_block_id: syncedFromBlockId,
  };
}

/** Dispatch the Fenel-bodied notion:decodeBlockContent. */
export function dispatchedDecodeBlockContent(v: unknown): unknown {
  return getEngineBody()("notion:decodeBlockContent", [preShapeBlockContentInput(v)]);
}

/** Encode the media payload (file + caption + optional name) to Notion's
 *  wire shape. Inlines NotionFile's wire fields at the top level (matches
 *  the TS oracle's encodeMediaPayload at notion-codec.ts:437).
 *
 *  Used by 5 arms of encodeBlockContent's finalize (image / video / audio /
 *  file / pdf). The brief considered factoring as separate fnIds but
 *  inlining matches 2a-2c's decision to keep small helpers inlined. */
function encodeMediaPayloadWire(
  file: unknown,
  caption: unknown,
  name?: string,
): unknown {
  const wireFile = dispatchedEncodeNotionFile(file);
  const out: Record<string, unknown> = {
    ...(isPlainObj(wireFile) ? wireFile : {}),
    caption: asListOf(caption, dispatchedEncodeRichText),
  };
  if (name !== undefined) out.name = name;
  return out;
}

/** Encode children (a List of typed BlockContent values) by recursively
 *  calling dispatchedEncodeBlockContent on each. The body emits children
 *  as a list of typed BlockContent values; the wrapper maps to wire shape
 *  recursively. */
function encodeChildrenWire(children: unknown): unknown[] {
  return asListOf(children, dispatchedEncodeBlockContent);
}

/** Finalize the body's marker record output into the Notion wire-shape
 *  for BlockContent. Switches on the body's `_kind` field to apply the
 *  per-arm wire transformation. */
function finalizeBlockContentWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return {};
  const kind = asStr(raw._kind);
  const block = (innerKey: string, payload: unknown): unknown => ({
    object: "block",
    type: innerKey,
    [innerKey]: payload,
  });
  switch (kind) {
    case "paragraph":
      return block("paragraph", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "heading_1":
      return block("heading_1", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        is_toggleable: asBoolVal(raw.isToggleable),
        children: encodeChildrenWire(raw.children),
      });
    case "heading_2":
      return block("heading_2", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        is_toggleable: asBoolVal(raw.isToggleable),
        children: encodeChildrenWire(raw.children),
      });
    case "heading_3":
      return block("heading_3", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        is_toggleable: asBoolVal(raw.isToggleable),
        children: encodeChildrenWire(raw.children),
      });
    case "bulleted_list_item":
      return block("bulleted_list_item", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "numbered_list_item":
      return block("numbered_list_item", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "to_do":
      return block("to_do", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        checked: asBoolVal(raw.checked),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "toggle":
      return block("toggle", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "code":
      return block("code", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        caption: asListOf(raw.caption, dispatchedEncodeRichText),
        language: asStr(raw.language),
      });
    case "callout": {
      const ic = unwrapMaybeAny(raw.icon);
      return block("callout", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        icon: ic === undefined ? null : dispatchedEncodeIcon(ic),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    }
    case "quote":
      return block("quote", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        color: dispatchedEncodeColor(raw.color),
        children: encodeChildrenWire(raw.children),
      });
    case "equation":
      return block("equation", { expression: asStr(raw.expression) });
    case "divider":
      return block("divider", {});
    case "table_of_contents":
      return block("table_of_contents", { color: dispatchedEncodeColor(raw.color) });
    case "breadcrumb":
      return block("breadcrumb", {});
    case "child_page":
      return block("child_page", { title: asStr(raw.title) });
    case "child_database":
      return block("child_database", { title: asStr(raw.title) });
    case "embed":
      return block("embed", {
        url: asStr(raw.url),
        caption: asListOf(raw.caption, dispatchedEncodeRichText),
      });
    case "bookmark":
      return block("bookmark", {
        url: asStr(raw.url),
        caption: asListOf(raw.caption, dispatchedEncodeRichText),
      });
    case "link_preview":
      return block("link_preview", { url: asStr(raw.url) });
    case "link_to_page":
      return block("link_to_page", dispatchedEncodeLinkTarget(raw.target));
    case "image":
      return block("image", encodeMediaPayloadWire(raw.file, raw.caption));
    case "video":
      return block("video", encodeMediaPayloadWire(raw.file, raw.caption));
    case "audio":
      return block("audio", encodeMediaPayloadWire(raw.file, raw.caption));
    case "file":
      return block("file", encodeMediaPayloadWire(raw.file, raw.caption, asStr(raw.name)));
    case "pdf":
      return block("pdf", encodeMediaPayloadWire(raw.file, raw.caption));
    case "table":
      return block("table", {
        table_width: typeof raw.tableWidth === "number" ? raw.tableWidth : 0,
        has_column_header: asBoolVal(raw.hasColumnHeader),
        has_row_header: asBoolVal(raw.hasRowHeader),
        children: encodeChildrenWire(raw.children),
      });
    case "table_row": {
      const cellsRaw = Array.isArray(raw.cells) ? raw.cells : [];
      return block("table_row", {
        cells: cellsRaw.map((cell) => asListOf(cell, dispatchedEncodeRichText)),
      });
    }
    case "column_list":
      return block("column_list", { children: encodeChildrenWire(raw.children) });
    case "column":
      return block("column", { children: encodeChildrenWire(raw.children) });
    case "synced_block": {
      const sf = unwrapMaybeStr(raw.syncedFromBlockId);
      return block("synced_block", {
        synced_from: sf === undefined ? null : { type: "block_id", block_id: sf },
        children: encodeChildrenWire(raw.children),
      });
    }
    case "template":
      return block("template", {
        rich_text: asListOf(raw.richText, dispatchedEncodeRichText),
        children: encodeChildrenWire(raw.children),
      });
    default:
      return block("unsupported", {});
  }
}

/** Dispatch the Fenel-bodied notion:encodeBlockContent. The body emits a
 *  flat marker `{ _kind = "<wire_type>", ...camelCase_payload }`; the
 *  wrapper finalizes to the Notion wire shape with per-arm transformations
 *  (rich_text mapping, color encoding, recursive children encoding, icon
 *  Maybe finalization, media payload assembly, target encoding, synced_from
 *  Maybe finalization, nested cells mapping). */
export function dispatchedEncodeBlockContent(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeBlockContent", [v]);
  return finalizeBlockContentWire(raw);
}

/** Pre-shape a Notion Block wire record into the flat input the Fenel
 *  body expects. The wrapper pre-decodes:
 *    * parent: Parent via dispatchedDecodeParent
 *    * created_by_user / last_edited_by_user: NotionUser via
 *      dispatchedDecodeNotionUser
 *    * content: BlockContent via dispatchedDecodeBlockContent (RECURSIVE
 *      into the mutually-recursive blocks/content tree)
 *
 *  Per the TS oracle: decodeBlock passes the ENTIRE wire object `v` to
 *  decodeBlockContent (not just the content sub-record — decodeBlockContent
 *  reads `v.type` to dispatch the variant). */
function preShapeBlockInput(v: unknown): Record<string, unknown> {
  const w = isPlainObj(v) ? v : {};
  return {
    id: asStr(w.id),
    parent: dispatchedDecodeParent(w.parent),
    created_time: asStr(w.created_time),
    last_edited_time: asStr(w.last_edited_time),
    // Per the TS oracle: reads v.created_by / v.last_edited_by (the wire
    // field names — Notion's REST API uses these directly, no `_user`
    // suffix). Body's input field names are snake_case-with-_user for
    // identifier readability + to disambiguate from the Parent's BlockParent
    // type (no semantic difference vs the wire name).
    created_by_user: dispatchedDecodeNotionUser(w.created_by),
    last_edited_by_user: dispatchedDecodeNotionUser(w.last_edited_by),
    has_children: asBoolVal(w.has_children),
    archived: asBoolVal(w.archived),
    in_trash: asBoolVal(w.in_trash),
    // Pass the ENTIRE wire object (not a sub-record) — decodeBlockContent
    // reads `v.type` then `v[v.type]` to dispatch the variant.
    content: dispatchedDecodeBlockContent(w),
  };
}

/** Dispatch the Fenel-bodied notion:decodeBlock. */
export function dispatchedDecodeBlock(v: unknown): unknown {
  return getEngineBody()("notion:decodeBlock", [preShapeBlockInput(v)]);
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2e — notion-codec §16-§17 dispatch.
//
// Page + Database + Comment + PaginatedList<a> + SearchResult. The smallest
// remaining slice in the codec arc: flat-record decoders that compose
// already-Fenel-bodied helpers from 2a-2d via the wrapper's pre-decoding
// pass.
//
// Recipe matches 2c/2d's wrapper-pre-decode pattern:
//   * Each wrapper pre-decodes ALL nested fields TS-side via the existing
//     dispatched* wrappers (Parent / NotionUser / Icon / Cover / RichText /
//     PropertiesObject / PropertySchemaObject) + Maybe-wraps optional fields
//     via maybeDecode / maybeStrOrNull / asListOf.
//   * The body shuttles snake_case wire fields → camelCase Fenel fields via
//     the typed constructor.
//
// §17a (PaginatedList<a>) is parametric over the element type: the wrapper
// takes a JS callback `decodeItem: (x: unknown) => unknown` + pre-decodes
// the results list TS-side via the callback. The body sees a concrete
// pre-decoded list + constructs PaginatedList. This matches the wrapper-
// pre-decoding pattern from 2c (Object.entries walk) + 2d (recursive blocks
// tree).
//
// §17b (SearchResult) is a 2-arm dispatch on wire `object`. The wrapper
// CONDITIONALLY pre-decodes only the matching variant (Database vs Page)
// to avoid wasted work. For non-object inputs, the wrapper pre-decodes an
// empty Page in `w.page` — the body's default arm then constructs a
// PageResult from it (matches TS oracle fallback).
// ---------------------------------------------------------------------------

/** Dispatch the Fenel-bodied notion:decodePage. The wrapper pre-decodes
 *  4 sub-records (parent / 2 NotionUsers / properties) + 2 Maybe-wrapped
 *  variant fields (icon / cover) + 1 Maybe-wrapped string (publicUrl). */
export function dispatchedDecodePage(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodePage", [{
    id: asStr(w.id),
    parent: dispatchedDecodeParent(w.parent),
    created_time: asStr(w.created_time),
    last_edited_time: asStr(w.last_edited_time),
    created_by_user: dispatchedDecodeNotionUser(w.created_by),
    last_edited_by_user: dispatchedDecodeNotionUser(w.last_edited_by),
    archived: asBoolVal(w.archived),
    in_trash: asBoolVal(w.in_trash),
    icon: maybeDecode(w.icon, dispatchedDecodeIcon),
    cover: maybeDecode(w.cover, dispatchedDecodeCover),
    properties: dispatchedDecodePropertiesObject(w.properties),
    url: asStr(w.url),
    public_url: maybeStrOrNull(w.public_url),
  }]);
}

/** Dispatch the Fenel-bodied notion:decodeDatabase. Same shape as
 *  dispatchedDecodePage + title + description (as [RichText]) + property
 *  schema + isInline. */
export function dispatchedDecodeDatabase(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodeDatabase", [{
    id: asStr(w.id),
    parent: dispatchedDecodeParent(w.parent),
    created_time: asStr(w.created_time),
    last_edited_time: asStr(w.last_edited_time),
    created_by_user: dispatchedDecodeNotionUser(w.created_by),
    last_edited_by_user: dispatchedDecodeNotionUser(w.last_edited_by),
    archived: asBoolVal(w.archived),
    in_trash: asBoolVal(w.in_trash),
    is_inline: asBoolVal(w.is_inline),
    title: asListOf(w.title, dispatchedDecodeRichText),
    description: asListOf(w.description, dispatchedDecodeRichText),
    icon: maybeDecode(w.icon, dispatchedDecodeIcon),
    cover: maybeDecode(w.cover, dispatchedDecodeCover),
    properties: dispatchedDecodePropertySchemaObject(w.properties),
    url: asStr(w.url),
    public_url: maybeStrOrNull(w.public_url),
  }]);
}

/** Dispatch the Fenel-bodied notion:decodeComment. The wrapper pre-decodes
 *  parent (via dispatchedDecodeParent — NOT dispatchedDecodeCommentParent;
 *  per types.fenel:390 Comment.parent is `Parent`) + createdBy (via
 *  dispatchedDecodeNotionUser) + richText (via asListOf + dispatchedDecodeRichText). */
export function dispatchedDecodeComment(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodeComment", [{
    id: asStr(w.id),
    parent: dispatchedDecodeParent(w.parent),
    discussion_id: asStr(w.discussion_id),
    created_time: asStr(w.created_time),
    last_edited_time: asStr(w.last_edited_time),
    created_by_user: dispatchedDecodeNotionUser(w.created_by),
    rich_text: asListOf(w.rich_text, dispatchedDecodeRichText),
  }]);
}

/** Dispatch the Fenel-bodied notion:decodePaginatedList. Parametric over
 *  the element type via a JS callback. The wrapper pre-decodes the results
 *  list TS-side via the callback + Maybe-wraps nextCursor (string-or-null).
 *  The body sees a concrete pre-decoded list + constructs PaginatedList.
 *
 *  Function-marshalling (passing the element decoder as a Fenel function
 *  reference) is a more elegant alternative but not yet validated in the
 *  codec arc — wrapper-side approach matches the 2c Object.entries pattern. */
export function dispatchedDecodePaginatedList(
  v: unknown,
  decodeItem: (x: unknown) => unknown,
): unknown {
  const w = isPlainObj(v) ? v : {};
  return getEngineBody()("notion:decodePaginatedList", [{
    results: asListOf(w.results, decodeItem),
    next_cursor: maybeStrOrNull(w.next_cursor),
    has_more: asBoolVal(w.has_more),
  }]);
}

/** Dispatch the Fenel-bodied notion:decodeSearchResult. The wrapper
 *  conditionally pre-decodes ONLY the matching variant (Database vs Page)
 *  to avoid wasted work. For non-object inputs, pre-decodes an empty
 *  Page in `w.page` so the body's default arm can construct PageResult
 *  (matches the TS oracle's `PageResult { page: decodePage({}) }` fallback). */
export function dispatchedDecodeSearchResult(v: unknown): unknown {
  const w = isPlainObj(v) ? v : {};
  const isDb = w.object === "database";
  return getEngineBody()("notion:decodeSearchResult", [{
    object: asStr(w.object),
    database: isDb ? dispatchedDecodeDatabase(w) : null,
    // For PageResult path: always pre-decode a Page (uses {} for non-object
    // input, matching the TS oracle's `decodePage({})` fallback).
    page: isDb ? null : dispatchedDecodePage(w),
  }]);
}

// ---------------------------------------------------------------------------
// Phase 11b sub-step 2f — notion-codec §18-§19 dispatch.
//
// Filter + Sort + Search + per-property condition encoders. 15 dispatched
// wrappers covering:
//   * 9 per-property condition encoders (Text / Number / Checkbox / Select /
//     MultiSelect / Date / People / Files / Relation) — all share the
//     `finalizeConditionWire` helper that converts the body's marker
//     `{ _op = "<wire_op>", value = X }` to the dynamic-key wire shape
//     `{ [op]: value }` or `{ [op]: true }` for no-arg variants.
//   * 2 composite condition encoders (FormulaCondition / RollupCondition) —
//     each switches on body-emitted `_kind` + dispatches to the inner
//     condition encoder (text / checkbox / number / date for Formula;
//     filter / number / date for Rollup — RollupCondition's any/every/none
//     arms RECURSIVELY call dispatchedEncodeFilter via the wrapper).
//   * 1 Filter encoder (dispatchedEncodeFilter) — the largest; switches on
//     `_kind` (and / or / prop / timestamp) + for prop, dispatches on
//     wireKind via encodeConditionForWireKind (13 cases mapping to the 9
//     per-property + 2 composite encoders). And/Or arms recursively map
//     children via dispatchedEncodeFilter (wrapper-side TS recursion same
//     pattern as 2d's encodeBlockContent).
//   * 1 Sort encoder (dispatchedEncodeSort) — 2-arm switch on `_kind`.
//   * 2 Search helpers (dispatchedEncodeSearchObjectFilter — Maybe-flavored
//     return via the body's `{ _kind = "" }` sentinel for the
//     SearchAllObjects fallback that maps to undefined wire-side;
//     dispatchedEncodeSearchSort — degenerate single variant with hardcoded
//     timestamp).
//
// Mutual recursion (RollupCondition → Filter → can contain RollupFilter →
// RollupCondition again) handled by TypeScript's function hoisting +
// wrapper-side TS recursion. Safe at Notion's practical nesting depth.
//
// The marker convention is REQUIRED — pre-flight grep confirmed
// `contains` / `none` / `and` / `or` / `filter` / `sort` ARE std codeNames
// in engine/src/modules/std.ts. Direct single-field record literals
// would hit the json-logic.ts:441 single-key dispatch path. The
// marker pattern emits multi-field `{ _op = "...", value = X }` or
// safe single-field `{ _op = "is_empty" }` (since `_op` isn't a codeName).
// ---------------------------------------------------------------------------

/** Shared finalize helper for the 9 per-property condition encoders.
 *  Converts the body's marker `{ _op = "<wire_op>", value = X }` to the
 *  Notion wire shape `{ [op]: value }` or `{ [op]: true }` for no-arg
 *  variants (where the marker lacks a `value` field). The catch-all
 *  empty-string `_op` sentinel finalizes to `{}` — matches the TS oracle's
 *  `if (!wireOp) return {};` fall-through for unknown variant tags. */
function finalizeConditionWire(raw: unknown): unknown {
  if (!isPlainObj(raw)) return {};
  const op = asStr(raw._op);
  if (op === "") return {};
  if (raw.value === undefined) return { [op]: true };
  return { [op]: raw.value };
}

/** Dispatch the Fenel-bodied notion:encodeTextCondition. */
export function dispatchedEncodeTextCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeTextCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeNumberCondition. */
export function dispatchedEncodeNumberCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeNumberCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeCheckboxCondition. The body's
 *  `value` field is a JS boolean (the construct op coerces True/False
 *  constructors to JS booleans for opaque-wrapped Bool). */
export function dispatchedEncodeCheckboxCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeCheckboxCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeSelectCondition. Reused for
 *  StatusFilter (wire-side both Status + Select are `{ status|select:
 *  { equals: "value" } }`). */
export function dispatchedEncodeSelectCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeSelectCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeMultiSelectCondition. */
export function dispatchedEncodeMultiSelectCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeMultiSelectCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeDateCondition. Reused for
 *  CreatedTimeFilter / LastEditedTimeFilter / TimestampFilter via the
 *  wrapper's wireKind dispatch — all 3 take a DateCondition. */
export function dispatchedEncodeDateCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeDateCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodePeopleCondition. The body
 *  translates `userId` to `value` so the shared finalize helper handles
 *  the contains / does_not_contain arms identically to other condition
 *  encoders. Reused by CreatedByFilter / LastEditedByFilter. */
export function dispatchedEncodePeopleCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodePeopleCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeFilesCondition. Both variants
 *  are no-arg (FilesIsEmpty / FilesIsNotEmpty), so the wrapper always
 *  emits `{ [op]: true }`. */
export function dispatchedEncodeFilesCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeFilesCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeRelationCondition. The body
 *  translates `pageId` to `value` (same pattern as PeopleCondition's
 *  `userId` translation). */
export function dispatchedEncodeRelationCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeRelationCondition", [v]);
  return finalizeConditionWire(raw);
}

/** Dispatch the Fenel-bodied notion:encodeFormulaCondition. The body
 *  emits a `{ _kind = "<outer_key>", inner = c }` marker; the wrapper
 *  dispatches to the matching inner condition encoder. */
export function dispatchedEncodeFormulaCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeFormulaCondition", [v]);
  if (!isPlainObj(raw)) return {};
  const kind = asStr(raw._kind);
  if (kind === "") return {};
  const inner = raw.inner;
  switch (kind) {
    case "string":
      return { string: dispatchedEncodeTextCondition(inner) };
    case "checkbox":
      return { checkbox: dispatchedEncodeCheckboxCondition(inner) };
    case "number":
      return { number: dispatchedEncodeNumberCondition(inner) };
    case "date":
      return { date: dispatchedEncodeDateCondition(inner) };
    default:
      return {};
  }
}

/** Dispatch the Fenel-bodied notion:encodeRollupCondition. 5-arm switch:
 *  3 compound arms (any / every / none) recursively call
 *  dispatchedEncodeFilter (the only place in the codec arc where the
 *  recursion crosses TWO dispatched* wrappers); 2 scalar arms (number /
 *  date) dispatch to the matching inner condition encoder. */
export function dispatchedEncodeRollupCondition(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeRollupCondition", [v]);
  if (!isPlainObj(raw)) return {};
  const kind = asStr(raw._kind);
  if (kind === "") return {};
  switch (kind) {
    case "any":
      return { any: dispatchedEncodeFilter(raw.filter) };
    case "every":
      return { every: dispatchedEncodeFilter(raw.filter) };
    case "none":
      return { none: dispatchedEncodeFilter(raw.filter) };
    case "number":
      return { number: dispatchedEncodeNumberCondition(raw.inner) };
    case "date":
      return { date: dispatchedEncodeDateCondition(raw.inner) };
    default:
      return {};
  }
}

/** Pick the right per-property condition encoder for a Filter's wireKind.
 *  The 13-entry dispatch table mirroring the TS oracle's `case` arms in
 *  encodeFilter (notion-codec.ts:662-687). */
function encodeConditionForWireKind(wireKind: string, condition: unknown): unknown {
  switch (wireKind) {
    case "title":
    case "rich_text":
    case "url":
    case "email":
    case "phone_number":
      return dispatchedEncodeTextCondition(condition);
    case "number":
    case "unique_id":
      return dispatchedEncodeNumberCondition(condition);
    case "checkbox":
      return dispatchedEncodeCheckboxCondition(condition);
    case "select":
    case "status":
      return dispatchedEncodeSelectCondition(condition);
    case "multi_select":
      return dispatchedEncodeMultiSelectCondition(condition);
    case "date":
    case "created_time":
    case "last_edited_time":
      return dispatchedEncodeDateCondition(condition);
    case "people":
    case "created_by":
    case "last_edited_by":
      return dispatchedEncodePeopleCondition(condition);
    case "files":
      return dispatchedEncodeFilesCondition(condition);
    case "relation":
      return dispatchedEncodeRelationCondition(condition);
    case "formula":
      return dispatchedEncodeFormulaCondition(condition);
    case "rollup":
      return dispatchedEncodeRollupCondition(condition);
    default:
      return {};
  }
}

/** Dispatch the Fenel-bodied notion:encodeFilter. Recursive: AndFilter /
 *  OrFilter contain `[Filter]` whose elements are encoded recursively via
 *  this same function (wrapper-side TS recursion, same pattern as 2d's
 *  encodeBlockContent for nested children).
 *
 *  The body emits one of three marker shapes:
 *    * `{ _kind = "and"|"or", filters = fs }` — wrapper recursively maps
 *      each filter
 *    * `{ _kind = "prop", property = p, wireKind = "<key>", condition = c }`
 *      — wrapper picks the right inner encoder via encodeConditionForWireKind
 *    * `{ _kind = "timestamp", timestamp = t, condition = c }` — wrapper
 *      encodes t TS-side + uses the encoded string as BOTH the `timestamp`
 *      value AND the dynamic key for the encoded DateCondition. */
export function dispatchedEncodeFilter(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeFilter", [v]);
  if (!isPlainObj(raw)) return {};
  const kind = asStr(raw._kind);
  if (kind === "") return {};
  if (kind === "and") {
    const filters = Array.isArray(raw.filters)
      ? raw.filters.map(dispatchedEncodeFilter)
      : [];
    return { and: filters };
  }
  if (kind === "or") {
    const filters = Array.isArray(raw.filters)
      ? raw.filters.map(dispatchedEncodeFilter)
      : [];
    return { or: filters };
  }
  if (kind === "prop") {
    const wireKind = asStr(raw.wireKind);
    const property = asStr(raw.property);
    const encoded = encodeConditionForWireKind(wireKind, raw.condition);
    return { property, [wireKind]: encoded };
  }
  if (kind === "timestamp") {
    const ts = dispatchedEncodeTimestampField(raw.timestamp);
    const encodedCondition = dispatchedEncodeDateCondition(raw.condition);
    return { timestamp: ts, [ts]: encodedCondition };
  }
  return {};
}

/** Dispatch the Fenel-bodied notion:encodeSort. 2-arm switch:
 *  TimestampSort → `{ timestamp: <encoded>, direction: <encoded> }`;
 *  PropertySort → `{ property: <p>, direction: <encoded> }`. */
export function dispatchedEncodeSort(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeSort", [v]);
  if (!isPlainObj(raw)) return {};
  const kind = asStr(raw._kind);
  if (kind === "") return {};
  if (kind === "timestamp") {
    return {
      timestamp: dispatchedEncodeTimestampField(raw.timestamp),
      direction: dispatchedEncodeSortDirection(raw.direction),
    };
  }
  if (kind === "property") {
    return {
      property: asStr(raw.property),
      direction: dispatchedEncodeSortDirection(raw.direction),
    };
  }
  return {};
}

/** Dispatch the Fenel-bodied notion:encodeSearchObjectFilter. Returns
 *  JS undefined for SearchAllObjects (the search handler omits the
 *  `filter` field entirely when this value is absent) OR
 *  `{ value: "page"|"database", property: "object" }` for the present
 *  cases. The body emits `{ _kind = "page"|"database"|"" }`; the wrapper
 *  converts to the wire shape OR undefined. */
export function dispatchedEncodeSearchObjectFilter(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeSearchObjectFilter", [v]);
  if (!isPlainObj(raw)) return undefined;
  const kind = asStr(raw._kind);
  if (kind === "") return undefined;
  return { value: kind, property: "object" };
}

/** Dispatch the Fenel-bodied notion:encodeSearchSort. The wrapper
 *  hardcodes `timestamp: "last_edited_time"` (matching the TS oracle)
 *  + encodes the direction via dispatchedEncodeSortDirection. */
export function dispatchedEncodeSearchSort(v: unknown): unknown {
  const raw = getEngineBody()("notion:encodeSearchSort", [v]);
  if (!isPlainObj(raw)) return { timestamp: "last_edited_time", direction: "ascending" };
  return {
    timestamp: "last_edited_time",
    direction: dispatchedEncodeSortDirection(raw.direction),
  };
}
