// ---------------------------------------------------------------------------
// Notion — typed wrapper around the Notion REST API
// (https://developers.notion.com/reference), fully `.fenel`.
//
// module-substrate Phase 3u (2026-06-01) — the second-biggest module (83 fns)
// migrated to the `module notion where` cross-file header UNION
// (`loadFenelModuleUnion`) across 4 files:
//   - types.fenel       — the 54 Notion ADT entities (Page / Database / Block /
//                         RichText / Filter / PropertyValue / …). Pure type-defs.
//   - codecs.fenel      — the 66 JSON ↔ ADT decode/encode bodies (UNCHANGED;
//                         the migration only WOVE their `name : Type` sigs +
//                         @facet identity above each existing body).
//   - rich-text-span-text.fenel — the lone `richTextSpanText` helper.
//   - endpoints.fenel   — the 16 bodyless Notion REST IO leaves: each `@native`
//                         + `@ioAction "notion.<endpoint>"` (the runtime IO
//                         handlers in runtime/src/handlers/notion.ts, keyed by
//                         the @ioAction string, are UNCHANGED by this migration).
//
// The ~1860-LOC TS spec-wrapper (3 `loadFenelModule` calls + ~70 `*_BODY`
// const extractions + 83 `defineFunction` re-wraps + the PaginatedList helper)
// collapses to ONE `loadFenelModuleUnion` call. `requires` INFERRED (the codec
// bodies are pure → none); Categorizable read-time (3j — category "notion" ===
// the `notion:` id prefix).
//
// CLASSIFICATION (Surprise — confirms the 3t/3o read): notion is an
// ORCHESTRATION + light-IO module, NOT a 3k/3l capability module — ZERO
// capability / provider / seedFromType / credentialRequirements structure. It
// genuinely HAS 16 IOInvokable (@ioAction) facets — the Notion REST endpoints —
// unlike dashboard. NO TS natives survive (`nativeImpls` was already `{}`).
//
// SIG VOCAB (the richer-than-dashboard axis): the codec boundary the TS specs
// typed `anyType` ({$var:"a"}) is named `JsonValue` — the registered codec
// entity, referenced by name (decode inputs `JsonValue -> ADT`; encode outputs
// `ADT -> JsonValue`; the telegram JsonValue / MessageText precedent — same
// value, referenced by name). The 7 inline `PaginatedList<X>` returns reference
// the registered parametric entity `PaginatedList <Elem>` by name.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import TYPES_FENEL from "../../../../../fenel/modules/notion/types.fenel?raw";
import CODECS_FENEL from "../../../../../fenel/modules/notion/codecs.fenel?raw";
import RICH_TEXT_SPAN_TEXT_FENEL from "../../../../../fenel/modules/notion/rich-text-span-text.fenel?raw";
import ENDPOINTS_FENEL from "../../../../../fenel/modules/notion/endpoints.fenel?raw";

// The `notion` cross-file header UNION — all 4 files carry `module notion where`,
// so `loadFenelModuleUnion` GROUPS them into ONE `notion` module (OQ3 — the
// header is identity, not the `name` arg). A duplicate top-level name across two
// files of the group is a load-time error (Haskell semantics). The 54 ADT
// entities ride `entities` (types.fenel); the 66 codec bodies + 1 helper carry
// Fenel bodies; the 16 IO leaves are bodyless @native (@ioAction-dispatched).
const notionGroups = loadFenelModuleUnion([
  { src: TYPES_FENEL, name: "notion" },
  { src: CODECS_FENEL, name: "notion" },
  { src: RICH_TEXT_SPAN_TEXT_FENEL, name: "notion" },
  { src: ENDPOINTS_FENEL, name: "notion" },
]);
const notionUnionModule = notionGroups.find((m) => m.name === "notion");
if (!notionUnionModule) {
  throw new Error(
    "notion: loadFenelModuleUnion did not yield the `notion` group — every notion/*.fenel must carry `module notion where`",
  );
}

export const notionModule: FenelModule = {
  name: "notion",
  label: "Notion",
  functions: notionUnionModule.functions ?? [],
  instances: notionUnionModule.instances ?? [],
  entities: notionUnionModule.entities ?? [],
  // No TS natives survive — the codec bodies are Fenel, the IO leaves are
  // @ioAction-dispatched (runtime handlers, keyed by the @ioAction string).
  nativeImpls: {},
};

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/notion") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_notion from "./notion";
import { registerEngineModule as __reg_modules_notion } from "../engine-require";
__reg_modules_notion("modules/notion", __self_modules_notion);
