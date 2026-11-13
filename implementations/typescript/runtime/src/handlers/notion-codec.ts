// ---------------------------------------------------------------------------
// Notion ↔ Fenel codec.
//
// Two transformations per type — `decodeX` (wire → Fenel) and `encodeX`
// (Fenel → wire). Decoders translate Notion's `type: "<x>", <x>: <payload>`
// sum encoding to Fenel's `{$tag, …flat fields…}`, wrap nullable fields
// in `Maybe`, and recurse into nested types. Encoders are the inverse —
// they produce wire-shaped JSON ready to send to api.notion.com.
//
// Every variant in `fenel/modules/notion/types.fenel` has a codec pair
// here. New variants need new entries on both sides (or pattern matching
// silently falls through with synthetic / unsupported tags).
//
// **Phase 11b sub-step 2a** (2026-05-23) — §1-§7 ported as Fenel bodies.
// **Phase 11b sub-step 2b** (2026-05-23) — §8-§11 ported as Fenel bodies
// (NotionUser / BotInfo / BotOwner — 3 fnIds; TemplateMention / Mention /
// RichText — 5 fnIds, encode/decode pairs for Mention & RichText;
// SelectOption / StatusGroup — 2 fnIds, decode-only; FileRef / FormulaResult
// / RollupResult / RelationRef — 5 fnIds, encode/decode pair for FileRef).
// **Phase 11b sub-step 2c** (2026-05-23) — §12-§14 ported as Fenel bodies
// (PropertyValue + decodePropertiesObject — 2 fnIds; PropertyWrite — 1
// fnId for encodePropertyWrite [encodePropertyWritesObject stays TS-only
// as it builds a JS object with dynamic keys]; Property + RelationKind +
// decodePropertySchemaObject — 3 fnIds).
// **Phase 11b sub-step 2d** (2026-05-23) — §15 ported as Fenel bodies
// (LinkTarget / BlockContent / Block — 5 fnIds; encodeBlock OMITTED).
// **Phase 11b sub-step 2e** (2026-05-23) — §16-§17 ported as Fenel bodies
// (Page / Database / Comment / PaginatedList / SearchResult — 5 fnIds,
// decode-only).
// **Phase 11b sub-step 2f** (2026-05-23) — §18-§19 ported as Fenel bodies
// (9 per-property condition encoders + 2 composite condition encoders +
// encodeFilter + encodeSort + encodeSearchObjectFilter + encodeSearchSort
// — 15 fnIds, encode-only). **CODEC ARC COMPLETE** — notion-codec.ts is
// now fully Fenel-bodied end-to-end.
//
// All bodies live at `fenel/modules/notion/codecs.fenel`; the §1 helpers
// (camelToSnake / snakeToCamel / toNotionWire / fromNotionWire) route
// through the Phase 11b sub-step 1 `runtime:camelToSnake` etc. The §2-§19
// public + module-internal helpers are lazy-require shims onto the
// `dispatched*` wrappers.
//
// Sub-step 2c resolves the 2b ArrayRollup cross-sub-step carve-out:
// `dispatchedDecodeRollupResult`'s ArrayRollup arm now calls
// `dispatchedDecodePropertyValue` directly (same Fenel body either way;
// wrapper-to-wrapper call removes the shim indirection).
//
// Dead-helper sweep history:
//   * 2b §8-§9 retired 5 internal Notion helpers (decodeBotOwner /
//     decodeBotInfo / decodeTemplateMention / decodeMention / encodeMention).
//   * 2c §10-§14 retired 7 internal Notion helpers + 1 marshalling helper
//     (asNumberOrNull).
//   * 2d §15 retired 4 internal Notion helpers + 1 marshalling helper
//     (unwrap).
//   * 2e §16-§17 retired 1 internal helper (decodePropertySchemaObject's
//     §14 internal use — sister-section sweep) + 3 marshalling helpers
//     (just / decodeList / asBool).
//   * 2f §18-§19 retired ALL TS bodies for the §18-§19 surface (encodeFilter
//     + encodeSort + encodeSearchObjectFilter + encodeSearchSort shimmed)
//     + 11 internal Notion helpers (encodeCondition + 9 op-map tables +
//     asConditionValue + 9 per-property internal condition encoders +
//     2 composite condition encoders) + 3 marshalling helpers (encodeList /
//     asString / getTag — all became dead after the §18-§19 collapse).
//     `isObj` survives as the only marshalling helper still used by
//     `encodePropertyWritesObject` (the JS-object-with-dynamic-keys
//     wrapper that stays TS-only).
// ---------------------------------------------------------------------------

// ============================================================================
// 1. Basic helpers
// ============================================================================

/** Convert a camelCase identifier to snake_case. */
export function camelToSnake(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedCamelToSnake } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedCamelToSnake(s);
}

/** Convert a snake_case identifier to camelCase. */
export function snakeToCamel(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSnakeToCamel } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedSnakeToCamel(s);
}

function isObj(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Outbound generic rewriter (camelCase keys → snake_case). Routes through
 *  the Phase 11b sub-step 1 runtime:toTelegramWire fnId (semantic-identical
 *  transform — both walk plain objects + arrays, rewrite keys via
 *  camelToSnake, preserve `$tag` verbatim). Documenting cross-module
 *  reuse rather than duplicating the fnId. */
export function toNotionWire(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedToTelegramWire } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedToTelegramWire(value);
}

/** Inbound generic rewriter (snake_case keys → camelCase). Routes through
 *  the Phase 11b sub-step 1 runtime:fromTelegramWire fnId. */
export function fromNotionWire(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedFromTelegramWire } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedFromTelegramWire(value);
}

// ============================================================================
// 2. NotionColor (bare string ↔ tag)
// ============================================================================

export function decodeColor(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeColor } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeColor(v);
}

export function encodeColor(v: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeColor } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeColor(v);
}

// ============================================================================
// 3. SortDirection + TimestampField (string ↔ tag)
// ============================================================================

export function decodeSortDirection(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeSortDirection } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeSortDirection(v);
}

export function encodeSortDirection(v: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeSortDirection } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeSortDirection(v);
}

export function decodeTimestampField(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeTimestampField } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeTimestampField(v);
}

export function encodeTimestampField(v: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeTimestampField } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeTimestampField(v);
}

// ============================================================================
// 4. Annotations + NotionDate (records)
// ============================================================================

export function decodeAnnotations(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeAnnotations } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeAnnotations(v);
}

export function encodeAnnotations(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeAnnotations } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeAnnotations(v);
}

export function decodeNotionDate(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeNotionDate } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeNotionDate(v);
}

export function encodeNotionDate(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeNotionDate } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeNotionDate(v);
}

// ============================================================================
// 5. Parent + CommentParent
// ============================================================================

export function decodeParent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeParent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeParent(v);
}

export function encodeParent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeParent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeParent(v);
}

/** CommentParent is wire-encoded by FIELD PRESENCE, not by `type` — Notion's
 *  /comments endpoint reads `parent.page_id` or `parent.discussion_id`. */
export function decodeCommentParent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeCommentParent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeCommentParent(v);
}

export function encodeCommentParent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeCommentParent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeCommentParent(v);
}

// ============================================================================
// 6. NotionFile (External | Uploaded)
// ============================================================================

export function decodeNotionFile(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeNotionFile } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeNotionFile(v);
}

export function encodeNotionFile(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeNotionFile } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeNotionFile(v);
}

// ============================================================================
// 7. Icon + Cover
// ============================================================================

export function decodeIcon(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeIcon } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeIcon(v);
}

export function encodeIcon(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeIcon } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeIcon(v);
}

export function decodeCover(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeCover } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeCover(v);
}

export function encodeCover(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeCover } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeCover(v);
}

// ============================================================================
// 8. NotionUser (+ BotInfo + BotOwner)
// ============================================================================
//
// Phase 11b sub-step 2b — `decodeNotionUser` is the only function in this
// section called from §12+ code (PropertyValue's CreatedBy / LastEditedBy /
// People / Verification arms). The TS-internal `decodeBotOwner` /
// `decodeBotInfo` helpers were only called by `decodeNotionUser`'s old TS
// body — now that body is Fenel-side, the helpers are dead. Same story for
// `decodeTemplateMention` / `decodeMention` / `encodeMention` in §9 (only
// callers were `decodeRichText` / `encodeRichText`, now Fenel-side). Each
// of those 5 internal helpers is still Fenel-bodied + exposed as its own
// dispatched wrapper (`dispatchedDecodeBotOwner` etc.) — accessible from
// other modules or future TS callsites via `runtime-bodies-dispatch.ts`,
// but not re-shimmed here because no TS caller exists.

export function decodeNotionUser(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeNotionUser } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeNotionUser(v);
}

// ============================================================================
// 9. RichText (Text | Mention | Equation) + Mention (sub-variant)
// ============================================================================

export function decodeRichText(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeRichText } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeRichText(v);
}

export function encodeRichText(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeRichText } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeRichText(v);
}

// ============================================================================
// 10. SelectOption + StatusGroup — internal helpers deleted in 2c
// ============================================================================
//
// `decodeSelectOption` / `decodeStatusGroup` were called only by §14's
// `decodeProperty`. With §14 collapsed to a Fenel-bodied shim in 2c, the
// TS helpers have no remaining callers in this file. Same pattern as 2b's
// §8-§9 dead-helper sweep — each is still Fenel-bodied + accessible via
// its own `dispatched*` wrapper from runtime-bodies-dispatch.ts.

// ============================================================================
// 11. FileRef, FormulaResult, RollupResult, RelationRef — internal helpers
//     deleted in 2c
// ============================================================================
//
// Same story: `decodeFileRef` / `encodeFileRef` / `decodeFormulaResult` /
// `decodeRollupResult` / `decodeRelationRef` were called only by §12 /
// §13's bodies (`decodePropertyValue` / `encodePropertyWrite`). With §12
// + §13 collapsed in 2c, no remaining callers. Each is still Fenel-bodied
// + accessible via `dispatched*` from runtime-bodies-dispatch.ts.

// ============================================================================
// 12. PropertyValue (read side)
// ============================================================================
//
// Phase 11b sub-step 2c — `decodePropertyValue` (the most-used Notion
// type, 24 arms) + `decodePropertiesObject` ported as Fenel bodies. The
// public exports shim onto `dispatchedDecodePropertyValue` /
// `dispatchedDecodePropertiesObject`. Internal helpers from §10/§11
// (decodeSelectOption, decodeStatusGroup, decodeFileRef,
// decodeFormulaResult, decodeRollupResult, decodeRelationRef) become
// dead code (their only callers were the now-shimmed §12-§14 bodies)
// and are removed entirely — same pattern as 2b's §8-§9 cleanup.

export function decodePropertyValue(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodePropertyValue } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodePropertyValue(v);
}

// ============================================================================
// 13. PropertyWrite (write side — used by create/updatePage)
// ============================================================================

export function encodePropertyWrite(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodePropertyWrite } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodePropertyWrite(v);
}

/** Encode a list of `PropertyWriteEntry { name, value }` to Notion's
 *  `{ <propName>: <wireValue> }` object form. STAYS TS-side: building a
 *  JS object with dynamic keys isn't natural Fenel (record literals
 *  require static keys). Loop calls `encodePropertyWrite` per entry,
 *  which routes through the Fenel-bodied dispatch wrapper. */
export function encodePropertyWritesObject(
  entries: unknown,
): Record<string, unknown> {
  if (!Array.isArray(entries)) return {};
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!isObj(entry)) continue;
    const name = entry.name;
    if (typeof name !== "string") continue;
    out[name] = encodePropertyWrite(entry.value);
  }
  return out;
}

/** Decode Notion's `{ <propName>: <propValue> }` object form to a list of
 *  `PropertyEntry { name, value }`. */
export function decodePropertiesObject(v: unknown): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodePropertiesObject } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodePropertiesObject(v) as unknown[];
}

// ============================================================================
// 14. Property (database schema, read side)
// ============================================================================

export function decodeProperty(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeProperty } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeProperty(v);
}

// Note: decodePropertySchemaObject was the only TS-side internal helper for
// §14 used by decodeDatabase. Sub-step 2e's decodeDatabase shim routes
// directly through the dispatched wrapper, so this helper has no remaining
// TS callers — deleted as dead code (same pattern as 2b §8-§9, 2c §10-§14,
// 2d §15 dead-helper sweeps). Still Fenel-bodied + accessible via
// dispatchedDecodePropertySchemaObject from runtime-bodies-dispatch.ts.

// ============================================================================
// 15. LinkTarget + BlockContent + Block
// ============================================================================
//
// Phase 11b sub-step 2d — §15 ported as Fenel bodies. 5 new fnIds:
// notion:decodeLinkTarget + notion:encodeLinkTarget +
// notion:decodeBlockContent + notion:encodeBlockContent + notion:decodeBlock.
// encodeBlock is intentionally OMITTED — Notion's write API never accepts
// a full Block on write (writes use BlockContent directly). The biggest
// single arc in the codec series: BlockContent has 33 arms.
//
// Mutually recursive decodeBlock ↔ decodeBlockContent is handled via
// WRAPPER-SIDE TS recursion (dispatchedDecodeBlock recursively calls
// dispatchedDecodeBlockContent for its `content` field;
// dispatchedDecodeBlockContent recursively calls dispatchedDecodeBlock
// for each child in `children`). Same for encodeBlockContent's children
// arms (recursive into itself). Safe because Notion API limits nesting
// depth (~5-10 levels in practice).
//
// Encoder uses the `_kind`-marker-record pattern from 2c: body emits
// `{ _kind = "<wire_type>", ...camelCase_payload }`, wrapper finalize
// switches on `_kind` + assembles `{ object: "block", type: <wire>, <wire>:
// { ... } }` with per-arm transformations.
//
// TS-internal helpers decodeLinkTarget / encodeLinkTarget /
// decodeMediaPayload / encodeMediaPayload were only called by the now-
// shimmed §15 bodies. All gone (dead-helper sweep, same pattern as 2b §8-§9
// + 2c §10-§14). LinkTarget is now Fenel-bodied + accessible via
// dispatched*; media payload helpers moved TS-side into the dispatched
// encodeBlockContent wrapper as encodeMediaPayloadWire.

export function decodeBlockContent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeBlockContent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeBlockContent(v);
}

export function encodeBlockContent(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeBlockContent } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeBlockContent(v);
}

export function decodeBlock(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeBlock } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeBlock(v);
}

// ============================================================================
// 16. Page, Database, Comment
// ============================================================================
//
// Phase 11b sub-step 2e — `decodePage` / `decodeDatabase` / `decodeComment`
// ported as Fenel bodies. The public exports shim onto the dispatched*
// wrappers. No internal helpers existed for §16 — these were all top-level
// exports composing already-shimmed 2a-2c functions.

export function decodePage(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodePage } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodePage(v);
}

export function decodeDatabase(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeDatabase } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeDatabase(v);
}

export function decodeComment(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeComment } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeComment(v);
}

// ============================================================================
// 17. PaginatedList + SearchResult
// ============================================================================
//
// Phase 11b sub-step 2e — `decodePaginatedList` / `decodeSearchResult`
// ported as Fenel bodies. `decodePaginatedList` preserves its 2-arg
// signature `(v, decodeItem)` — the dispatched wrapper takes the same
// shape + pre-decodes the results list TS-side via the callback.

export function decodePaginatedList<T>(
  v: unknown,
  decodeItem: (x: unknown) => T,
): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodePaginatedList } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodePaginatedList(v, decodeItem as (x: unknown) => unknown);
}

export function decodeSearchResult(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedDecodeSearchResult } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedDecodeSearchResult(v);
}

// ============================================================================
// 18. Filter + Sort (write-side — used in queryDatabase)
// ============================================================================
//
// Phase 11b sub-step 2f — `encodeFilter` (22-arm dispatch + recursive
// And/Or) + `encodeSort` (2-arm dispatch) ported as Fenel bodies. The
// public exports shim onto `dispatchedEncodeFilter` / `dispatchedEncodeSort`.
//
// The 9 per-property condition encoders (encodeTextCondition /
// encodeNumberCondition / encodeCheckboxCondition / encodeSelectCondition /
// encodeMultiSelectCondition / encodeDateCondition / encodePeopleCondition /
// encodeFilesCondition / encodeRelationCondition) + 2 composite condition
// encoders (encodeFormulaCondition / encodeRollupCondition) all became
// Fenel-bodied too — accessible via `dispatchedEncode*` wrappers from
// runtime-bodies-dispatch.ts. The 9 op-map tables (TEXT_OPS / NUMBER_OPS /
// etc.) + the `encodeCondition` shared helper + the `asConditionValue`
// helper are all DEAD CODE in TS now and have been removed (same dead-
// helper sweep as 2b §8-§9, 2c §10-§14, 2d §15, 2e §17b).
//
// Marker convention REQUIRED (not optional): pre-flight grep confirmed
// `contains` / `none` / `and` / `or` / `filter` / `sort` ARE std codeNames
// in engine/src/modules/std.ts. Direct single-field record literals like
// `{ contains = x }` from a Fenel body would hit the json-logic.ts:441
// single-key dispatch path and be interpreted as a CALL to std:contains.
// Bodies emit multi-field marker records `{ _op = "<wire_op>", value = X }`
// + the wrapper's `finalizeConditionWire` post-processor converts to the
// dynamic-key wire shape `{ [op]: value }`.

export function encodeFilter(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeFilter } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeFilter(v);
}

export function encodeSort(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeSort } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeSort(v);
}

// ============================================================================
// 19. Search (object filter + sort)
// ============================================================================
//
// Phase 11b sub-step 2f — both ported as Fenel bodies.
//
// `encodeSearchObjectFilter` returns `undefined` for the SearchAllObjects
// variant (the search handler at handlers/notion.ts:349 omits the `filter`
// field entirely when this value is absent); the wrapper's
// `if (kind === "") return undefined;` finalize handles the mapping.
// `encodeSearchSort` hardcodes `timestamp: "last_edited_time"` — the
// Fenel ADT has only the SearchSortByLastEdited variant.

export function encodeSearchObjectFilter(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeSearchObjectFilter } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeSearchObjectFilter(v);
}

export function encodeSearchSort(v: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEncodeSearchSort } = require("../runtime-bodies-dispatch") as typeof import("../runtime-bodies-dispatch");
  return dispatchedEncodeSearchSort(v);
}
