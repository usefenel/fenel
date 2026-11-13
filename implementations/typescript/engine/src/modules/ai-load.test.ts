// ---------------------------------------------------------------------------
// ai-load.test.ts — conformance test for the AI module entity pilot.
// Phase 4b of the ts-elimination workstream flipped the `aiResponseType`
// and `aiErrorType` inline `FenelType` `$variant` literals to a single
// `.fenel`-sourced module file loaded via `loadFenelModule(TYPES_FENEL,
// "ai")`. First multi-entity per-module flip — same recipe shape as
// `license-load.test.ts` (Phase 4a), parallelised across the two paired
// ADTs.
//
// Each assertion covers one tier of the recipe:
//
//   1. Raw `$variant` parse shape per entity — AIResponse (2-case:
//      Parsed value: {} placeholder, Raw text: String) and AIError
//      (4-case: NetworkError / RateLimit / AuthError / TokenLimit, the
//      last carrying two named Number fields).
//   2. `aiModule.entities` carries both parsed entities so
//      `createRegistry`'s catalog walk surfaces them as
//      `entity:AIResponse` / `entity:AIError`.
//   3. Catalog surfacing post-`getSystemRegistry()` smoke — pre/post-flip
//      identity preserved bit-for-bit (the slot was already populated
//      pre-flip; the catalog walk fired both times).
//   4. `ai:callLLM`'s `Result(AIError, AIResponse)` return type still
//      resolves through the catalog — smoke test that the `$ref` refs
//      resolve lazily at validate time, even though defineFunction fires
//      at module-load time before the module's own catalog walk.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
// Phase 3l (module-substrate) reframe — `types.fenel` was CONSOLIDATED into
// `ai.fenel` (the `module ai where` header + 2 data decls + the `callLLM`
// @native foreign decl). The raw-parse assertions read the same 2 entities
// out of the consolidated module file; the email-load reframe precedent.
import aiSrc from "../../../../../fenel/modules/ai/ai.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, Nothing } from "../type-foundation";
import { aiModule } from "./ai";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const AI_MOD = loadFenelModule(aiSrc, "ai");

function rawEntity(id: string): FenelType {
  const entity = (AI_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`ai module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("ai/types.fenel parses AIResponse to the expected 2-case $variant", () => {
  expect(rawEntity("AIResponse")).toEqual({
    $variant: {
      cases: [
        {
          name: "Parsed",
          label: Nothing,
          fields: [{ name: "value", label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing }],
        },
        {
          name: "Raw",
          label: Nothing,
          fields: [{ name: "text", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
      ],
    },
  });
});

test("ai/types.fenel parses AIError to the expected 4-case $variant", () => {
  // Phase 3 of canonical-maybe lifted `RateLimit.retryAfter: Number` to
  // `RateLimit.retryAfter: Maybe Number`. The Fenel-side application of
  // `Maybe Number` parses to the canonical inline $variant form (Nothing |
  // Just { value: Number }) — matching the foundation.fenel declaration
  // and recognised by `peelMaybe(t)` downstream.
  expect(rawEntity("AIError")).toEqual({
    $variant: {
      cases: [
        {
          name: "NetworkError",
          label: Nothing,
          fields: [{ name: "message", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
        {
          name: "RateLimit",
          label: Nothing,
          fields: [
            {
              name: "retryAfter",
              label: Nothing,
              type: {
                $variant: {
                  cases: [
                    { name: "Nothing", label: Nothing },
                    { name: "Just", label: Nothing, fields: [{ name: "_0", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
                  ],
                },
              },
              meta: {},
              ui: Nothing,
            },
          ],
        },
        {
          name: "AuthError",
          label: Nothing,
          fields: [{ name: "message", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
        {
          name: "TokenLimit",
          label: Nothing,
          fields: [
            { name: "used", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
            { name: "max", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
          ],
        },
      ],
    },
  });
});

test("aiModule.entities carries both parsed entities", () => {
  // ids-via-includes rather than strict-equality-by-index so the test
  // doesn't couple to author order in the .fenel file (Watch-out §9).
  const ids = (aiModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("AIResponse");
  expect(ids).toContain("AIError");
});

test("getSystemRegistry surfaces entity:AIResponse and entity:AIError", () => {
  // Force catalog construction by reading the registry, then probe the
  // two entries. Pre-flip these already surfaced (the slot was populated
  // by the inline TS literals); Phase 4b preserves the identity bit-for-
  // bit through the .fenel-sourced replacement.
  getSystemRegistry();
  const aiResponse = getCatalogEntry("entity:AIResponse");
  const aiError = getCatalogEntry("entity:AIError");
  expect(aiResponse).toBeDefined();
  expect(aiError).toBeDefined();
});

test("ai:callLLM's Result(AIError, AIResponse) return resolves through $ref refs", () => {
  // Smoke: the function spec carries `returns: Result({$ref:"AIError"},
  // {$ref:"AIResponse"})` evaluated at defineFunction-call-time —
  // before the module's own catalog walk fires. The $ref refs resolve
  // lazily at validate / display time, so the parsed `returns` type
  // round-trips through the function registration unchanged.
  const callLLM = (aiModule.functions ?? []).find((f) => f.id === "ai:callLLM");
  expect(callLLM).toBeDefined();
  const returns = callLLM!.returns as { $variant: { cases: Array<{ name: string; fields: Array<{ name: string; type: FenelType }> }> } };
  expect(returns.$variant).toBeDefined();
  const caseNames = returns.$variant.cases.map((c) => c.name);
  expect(caseNames).toEqual(["Err", "Ok"]);
  const errValue = returns.$variant.cases[0]!.fields[0]!.type;
  const okValue = returns.$variant.cases[1]!.fields[0]!.type;
  expect(errValue).toEqual({ $ref: "AIError" });
  expect(okValue).toEqual({ $ref: "AIResponse" });
});
