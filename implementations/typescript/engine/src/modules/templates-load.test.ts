// ---------------------------------------------------------------------------
// templates-load.test.ts — conformance test for the templates module
// entity pilot. Phase 4c of the ts-elimination workstream flipped the
// `markupType` inline `FenelType` `$variant` literal (10 cases, 7
// self-referential payloads) to a `.fenel`-sourced module file loaded
// via `loadFenelModule(TYPES_FENEL, "templates")`. First per-module flip
// exercising self-reference at the entity tier — Bold / Italic / Link /
// Heading carry `child: Markup`, Paragraph / List / Fragment carry
// `children: List Markup`.
//
// Each assertion covers one tier of the recipe:
//
//   1. Raw `$variant` parse shape — 10 cases (Text / Bold / Italic /
//      Link / Image / Heading / Paragraph / List / Fragment / Expr).
//      Self-refs preserved unrolled as `{$ref: "Markup"}` (not
//      expanded through the catalog); the list-payload cases carry the
//      full `$opaque List` μ-shape (same shape `List({$ref: "Markup"})`
//      emits at the TS site).
//   2. HeadingLevel atom registers as a refined-Number with the
//      `{1, 2, 3, 4, 5, 6}` enum set — canonical SetExpr `$enum` form
//      over a Number base. Combines 4a's Rate (interval over Number)
//      and 3d's PaymentStepStatus (enum over String).
//   3. `templateModule.entities` carries both parsed entities so
//      `createRegistry`'s catalog walk surfaces them as `entity:Markup`
//      / `entity:HeadingLevel`. Gap-close — pre-flip the slot was
//      absent on `templateModule`, post-flip the catalog walk surfaces
//      both entities for the first time.
//   4. Catalog surfacing post-`getSystemRegistry()` smoke — confirms
//      `entity:Markup` is reachable through the catalog after registry
//      construction.
//   5. Self-ref preservation — confirms the recursive payload references
//      stay as `{$ref: "Markup"}` after the catalog walk; the parser
//      stores them as-is and resolution fires lazily at validate / display
//      time. Same load-order mechanism as 4b's Result(AIError, AIResponse)
//      return-type ref.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import templatesSrc from "../../../../../fenel/modules/templates/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, List, Nothing } from "../type-foundation";
import { templateModule } from "./templates";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";
import { isSetExpr } from "../types";
import { setExprToDollarKey } from "../set-marker";

const TEMPLATES_MOD = loadFenelModule(templatesSrc, "templates");

// set-algebra-to-fenel Phase 3b-2 Step 4 — the parser now emits SetExprs in the
// canonical `$tag` Se* form, so the `HeadingLevel` atom's `$enum` set comes back
// as `{$tag:"SeEnum", values:[…]}`. `cf` deeply lowers ANY-form SetExpr back to
// the legacy `$`-key shape so the shape assertion below stays a STRUCTURE/VALUE
// check (setExprToDollarKey rewrites ONLY the SetExpr discriminator — it cannot
// mask a structure/value regression). Same sanctioned mechanical re-pin as the
// foundation-load / fenel-syntax `foldRefs` SetExpr fold.
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

function rawEntity(id: string): FenelType {
  const entity = (TEMPLATES_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`templates module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("templates/types.fenel parses Markup to the expected 10-case $variant", () => {
  expect(rawEntity("Markup")).toEqual({
    $variant: {
      cases: [
        {
          name: "Text",
          label: Nothing,
          fields: [{ name: "content", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
        },
        {
          name: "Bold",
          label: Nothing,
          fields: [{ name: "child", label: Nothing, type: { $ref: "Markup" }, meta: {}, ui: Nothing }],
        },
        {
          name: "Italic",
          label: Nothing,
          fields: [{ name: "child", label: Nothing, type: { $ref: "Markup" }, meta: {}, ui: Nothing }],
        },
        {
          name: "Link",
          label: Nothing,
          fields: [
            { name: "url", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
            { name: "child", label: Nothing, type: { $ref: "Markup" }, meta: {}, ui: Nothing },
          ],
        },
        {
          name: "Image",
          label: Nothing,
          fields: [
            { name: "src", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
            { name: "alt", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          ],
        },
        {
          name: "Heading",
          label: Nothing,
          fields: [
            { name: "level", label: Nothing, type: { $ref: "HeadingLevel" }, meta: {}, ui: Nothing },
            { name: "child", label: Nothing, type: { $ref: "Markup" }, meta: {}, ui: Nothing },
          ],
        },
        {
          name: "Paragraph",
          label: Nothing,
          fields: [{ name: "children", label: Nothing, type: List({ $ref: "Markup" }), meta: {}, ui: Nothing }],
        },
        {
          name: "List",
          label: Nothing,
          fields: [
            { name: "ordered", label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing },
            { name: "items", label: Nothing, type: List({ $ref: "Markup" }), meta: {}, ui: Nothing },
          ],
        },
        {
          name: "Fragment",
          label: Nothing,
          fields: [{ name: "children", label: Nothing, type: List({ $ref: "Markup" }), meta: {}, ui: Nothing }],
        },
        {
          name: "Expr",
          label: Nothing,
          fields: [{ name: "expression", label: Nothing, type: { $ref: "Expression" }, meta: {}, ui: Nothing }],
        },
      ],
    },
  });
});

test("templates/types.fenel HeadingLevel atom is refined Number in {1, 2, 3, 4, 5, 6}", () => {
  expect(cf(rawEntity("HeadingLevel"))).toEqual({
    $refined: {
      base: { $ref: "Number" },
      set: { $enum: [1, 2, 3, 4, 5, 6] },
    },
  });
});

test("templateModule.entities carries the parsed Markup and HeadingLevel entities", () => {
  const ids = (templateModule.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Markup");
  expect(ids).toContain("HeadingLevel");
});

test("getSystemRegistry surfaces entity:Markup (gap-close)", () => {
  // Force catalog construction by reading the registry, then probe the
  // entry. Pre-4c `templateModule` had no `entities:` slot, so the
  // catalog walk skipped it; post-4c the slot is populated and Markup
  // surfaces for the first time.
  getSystemRegistry();
  const markup = getCatalogEntry("entity:Markup");
  expect(markup).toBeDefined();
});

test("Markup self-refs preserved unrolled as {$ref: \"Markup\"}", () => {
  // Lazy-$ref resolution: the parser stores the self-ref as-is in the
  // case payload; the catalog walk does NOT unroll it through the
  // entity definition (would loop forever on the recursive case). Same
  // mechanism as 4b's Result(AIError, AIResponse) return-type ref —
  // resolution fires at validate / display time, not at parse / module-
  // load time.
  const markup = (TEMPLATES_MOD.entities ?? []).find((e) => e.id === "Markup");
  const cases = (markup!.type as { $variant: { cases: Array<{ name: string; fields?: Array<{ name: string; type: FenelType }> }> } }).$variant.cases;
  const bold = cases.find((c) => c.name === "Bold")!;
  expect(bold.fields![0]!.type).toEqual({ $ref: "Markup" });
  const heading = cases.find((c) => c.name === "Heading")!;
  expect(heading.fields![1]!.type).toEqual({ $ref: "Markup" });
});
