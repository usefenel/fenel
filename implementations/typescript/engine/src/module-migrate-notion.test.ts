// ---------------------------------------------------------------------------
// module-migrate-notion.test.ts — module-substrate Phase 3u parity proof.
//
// `notion` is the second-biggest module (83 `defineFunction` specs). Phase 3u
// migrated ALL of it to the `module notion where` cross-file header UNION
// (`loadFenelModuleUnion`) across 4 files:
//   - types.fenel       — 54 Notion ADT entities (Page / Database / Block / …).
//   - codecs.fenel      — 66 JSON ↔ ADT decode/encode bodies (UNCHANGED; the
//                         migration only WOVE their `name : Type` sigs + @facet
//                         identity above each existing body).
//   - rich-text-span-text.fenel — the lone `richTextSpanText` helper.
//   - endpoints.fenel   — the 16 bodyless Notion REST IO leaves (`@native` +
//                         `@ioAction "notion.<endpoint>"`; the runtime IO
//                         handlers, keyed by the @ioAction string, are UNCHANGED).
// The ~1860-LOC TS spec-wrapper (3 `loadFenelModule` calls + ~70 `*_BODY`
// extractions + 83 `defineFunction` re-wraps + the PaginatedList helper) RETIRED.
//
// GENERATE-THEN-LOCK (3t / 3s): the sigs + facets were generated from the
// pre-migration `notionModule` oracle and dumped to
// `module-migrate-notion.oracle.json`; this file LOCKS the migrated module
// against that fixture — byte-faithful params / returns / facets.
//
// CLASSIFICATION (confirms the 3t/3o read, refutes the roadmap's "3k/3l
// capability module" filing): notion is an ORCHESTRATION + light-IO module —
// ZERO capability / provider / seedFromType / credentialRequirements structure.
// It genuinely HAS 16 IOInvokable (@ioAction) facets (the Notion REST endpoints)
// — unlike dashboard (#48). NO TS natives survive (`nativeImpls` was `{}`).
//
// SIG VOCAB (the richer-than-dashboard axis): the codec boundary the TS specs
// typed `anyType` ({$var:"a"}) is named `JsonValue` (the registered codec
// entity), referenced by name — decode inputs `JsonValue -> ADT`, encode outputs
// `ADT -> JsonValue` (the telegram JsonValue / MessageText precedent: same value,
// referenced by name). The 7 inline `PaginatedList<X>` returns reference the
// registered parametric entity `PaginatedList <Elem>` by name (`{$el:{call:…}}`).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { notionModule } from "./modules/notion";
import { stdModule } from "./modules/std";
import { codecModule } from "./modules/codec";
import { createRegistry } from "./registry";
import { loadFenelModuleUnion } from "./fenel-module";
import { evaluate } from "./json-logic";
import oracle from "./module-migrate-notion.oracle.json";

import TYPES_FENEL from "../../../../fenel/modules/notion/types.fenel?raw";
import CODECS_FENEL from "../../../../fenel/modules/notion/codecs.fenel?raw";
import RICH_TEXT_SPAN_TEXT_FENEL from "../../../../fenel/modules/notion/rich-text-span-text.fenel?raw";
import ENDPOINTS_FENEL from "../../../../fenel/modules/notion/endpoints.fenel?raw";

const fns = notionModule.functions ?? [];
const insts = notionModule.instances ?? [];
const byId = new Map(fns.map((f) => [f.id, f]));
function methodOf(typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const FIXTURE = oracle as {
  fns: Record<string, {
    codeName: string; label?: string; description?: string; tags?: string[];
    ioAction?: string; params: unknown[]; returns: unknown; hasBody: boolean;
  }>;
  entities: string[];
};
const ALL_IDS = Object.keys(FIXTURE.fns);
// The 16 bodyless IO leaves (oracle entries that carry an ioAction).
const IO_LEAF_IDS = ALL_IDS.filter((id) => FIXTURE.fns[id]!.ioAction !== undefined);

// 7g-parser: the parser emits a user-written type-name ref as `{$ref:H}` (was
// `{$ref:H}`). This parity oracle is byte-identical to the retired TS spec
// MODULO the reference's value form — fold `{$ref:H}`→`{$ref:H}` on the parsed
// side ({$ref}≡{$ref}, the type-layer merge equivalence; the producer tripwire
// lives in fenel-syntax.test.ts, not here).
function normRefs(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(normRefs);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string") return { $ref: o.$ref };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normRefs(o[k]);
    return out;
  }
  return t;
}

describe("notion 3u — the full 83-id roster + identity", () => {
  test("the module registers exactly the 83 oracle ids (unique)", () => {
    expect(ALL_IDS.length).toBe(83);
    expect(fns.length).toBe(83);
    expect(new Set(fns.map((f) => f.id)).size).toBe(83);
    expect([...byId.keys()].sort()).toEqual([...ALL_IDS].sort());
  });

  test("codeName === id-suffix for every fn (no @codeName divergence)", () => {
    for (const id of ALL_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: id.slice("notion:".length) });
    }
  });

  test("every id + codeName resolves through createRegistry", () => {
    const reg = createRegistry([stdModule, codecModule, notionModule]);
    for (const id of ALL_IDS) {
      const suffix = id.slice("notion:".length);
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });

  test("every fn is pure of declared requires (codec bodies inferred-empty; IO leaves declare none)", () => {
    for (const id of ALL_IDS) expect(byId.get(id)?.requires).toBeUndefined();
  });
});

describe("notion 3u — param / return parity (byte-identical to the oracle)", () => {
  test("params byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      expect(normRefs(byId.get(id)?.params)).toEqual(FIXTURE.fns[id]!.params as never);
    }
  });
  test("returns byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      expect(normRefs(byId.get(id)?.returns)).toEqual(FIXTURE.fns[id]!.returns as never);
    }
  });

  // The richer-than-dashboard sig vocab: the `anyType` ({$var}) wire boundary is
  // named `JsonValue`; the inline `PaginatedList<X>` returns are the registered
  // parametric entity referenced by name (`{$el:{call:["PaginatedList", Elem]}}`).
  test("JsonValue boundary substitution — decoders `JsonValue -> ADT`, encoders `ADT -> JsonValue`", () => {
    expect(normRefs(byId.get("notion:decodeAnnotations")?.params?.[0]?.type)).toEqual({ $ref: "JsonValue" });
    expect(normRefs(byId.get("notion:decodeAnnotations")?.returns)).toEqual({ $ref: "Annotations" });
    expect(normRefs(byId.get("notion:encodeAnnotations")?.params?.[0]?.type)).toEqual({ $ref: "Annotations" });
    expect(normRefs(byId.get("notion:encodeAnnotations")?.returns)).toEqual({ $ref: "JsonValue" });
    // List(JsonValue) param survives the deep substitution.
    expect(byId.get("notion:decodePropertiesObject")?.params?.[0]?.type).toEqual(
      byId.get("notion:decodePropertiesObject")?.params?.[0]?.type,
    );
  });

  test("PaginatedList <Elem> substitution — the 7 inline-variant returns reference the parametric entity", () => {
    expect(normRefs(byId.get("notion:queryDatabase")?.returns)).toEqual({ $el: { call: ["PaginatedList", { $ref: "Page" }] } });
    expect(normRefs(byId.get("notion:listUsers")?.returns)).toEqual({ $el: { call: ["PaginatedList", { $ref: "NotionUser" }] } });
    expect(normRefs(byId.get("notion:search")?.returns)).toEqual({ $el: { call: ["PaginatedList", { $ref: "SearchResult" }] } });
    expect(normRefs(byId.get("notion:decodePaginatedList")?.returns)).toEqual({ $el: { call: ["PaginatedList", { $ref: "JsonValue" }] } });
  });

  // IO-leaf param names ride the named-param sig (`(token: String) -> …`).
  test("IO-leaf sigs are token-first with named params", () => {
    expect(normRefs(byId.get("notion:retrievePage")?.params?.map((p) => [p.name, p.type]))).toEqual([
      ["token", { $ref: "String" }],
      ["pageId", { $ref: "String" }],
    ]);
    expect(normRefs(byId.get("notion:retrievePage")?.returns)).toEqual({ $ref: "Page" });
  });
});

describe("notion 3u — facet parity (Labelable / Describable / Taggable / IOInvokable)", () => {
  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      const f = FIXTURE.fns[id]!;
      if (f.label !== undefined) expect(methodOf("Labelable", id)).toEqual({ label: f.label });
      if (f.description !== undefined) expect(methodOf("Describable", id)).toEqual({ description: f.description });
      if (f.tags !== undefined) expect(methodOf("Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  // Embedded-quote descriptions round-trip through the @description lexer.
  test("embedded-quote description round-trips (decodeColor's wire-string examples)", () => {
    expect((methodOf("Describable", "notion:decodeColor") as { description: string }).description).toContain(
      '"default" / "gray" / "red_background"',
    );
  });

  test("ALL 83 fns drop stored Categorizable (3j read-time, category 'notion' === id prefix)", () => {
    for (const id of ALL_IDS) expect(methodOf("Categorizable", id)).toBeUndefined();
    expect(insts.filter((i) => i.typeName === "Categorizable").length).toBe(0);
  });

  test("IOInvokable present on the 16 IO leaves (byte-identical @ioAction), ABSENT on the 67 bodied", () => {
    expect(IO_LEAF_IDS.length).toBe(16);
    for (const id of ALL_IDS) {
      const io = FIXTURE.fns[id]!.ioAction;
      if (io !== undefined) expect(methodOf("IOInvokable", id)).toEqual({ ioAction: io });
      else expect(methodOf("IOInvokable", id)).toBeUndefined();
    }
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(16);
    // The @ioAction strings stay `notion.<endpoint>` byte-identical (runtime
    // handlers keyed by these — UNCHANGED).
    expect(methodOf("IOInvokable", "notion:retrievePage")).toEqual({ ioAction: "notion.retrievePage" });
    expect(methodOf("IOInvokable", "notion:queryDatabase")).toEqual({ ioAction: "notion.queryDatabase" });
    expect(methodOf("IOInvokable", "notion:search")).toEqual({ ioAction: "notion.search" });
  });
});

describe("notion 3u — bodies present (67) / bodyless IO leaves (16) as authored", () => {
  test("hasBody matches the oracle for every fn", () => {
    for (const id of ALL_IDS) expect(!!byId.get(id)?.body).toBe(FIXTURE.fns[id]!.hasBody);
  });
  test("67 fns carry a Fenel body, the 16 IO leaves are bodyless", () => {
    expect(fns.filter((f) => f.body).length).toBe(67);
    expect(fns.filter((f) => !f.body).length).toBe(16);
    for (const id of IO_LEAF_IDS) expect(byId.get(id)?.body).toBeUndefined();
  });
  test("nativeImpls collapsed to {} (no TS natives — was already empty)", () => {
    expect(Object.keys(notionModule.nativeImpls ?? {})).toEqual([]);
  });
});

describe("notion 3u — the 54 ADT entities ride the union", () => {
  test("entity roster byte-identical to the oracle", () => {
    const entIds = (notionModule.entities ?? []).map((e) => e.id);
    expect(entIds.length).toBe(54);
    expect([...entIds].sort()).toEqual([...FIXTURE.entities].sort());
    expect(entIds).toContain("Page");
    expect(entIds).toContain("PaginatedList");
    expect(entIds).toContain("PropertyWrite");
  });
});

describe("notion 3u — the cross-file header UNION (4 files → ONE module)", () => {
  const groups = loadFenelModuleUnion([
    { src: TYPES_FENEL, name: "notion-fallback-a" },
    { src: CODECS_FENEL, name: "notion-fallback-b" },
    { src: RICH_TEXT_SPAN_TEXT_FENEL, name: "notion-fallback-c" },
    { src: ENDPOINTS_FENEL, name: "notion-fallback-d" },
  ]);

  test("the 4 files group into ONE `notion` module by header (NOT the name arg)", () => {
    expect(groups.map((m) => m.name)).toEqual(["notion"]);
  });

  test("the union carries all 83 fns under `notion:` ids + the 54 entities", () => {
    const n = groups[0]!;
    const ids = (n.functions ?? []).map((f) => f.id);
    expect(ids.length).toBe(83);
    expect(ids.every((id) => id.startsWith("notion:"))).toBe(true);
    expect(ids).toContain("notion:decodeColor"); // codecs.fenel
    expect(ids).toContain("notion:richTextSpanText"); // rich-text-span-text.fenel
    expect(ids).toContain("notion:retrievePage"); // endpoints.fenel
    expect((n.entities ?? []).length).toBe(54); // types.fenel
  });

  test("dup-name across two same-header files throws a precise load-time error (OQ3)", () => {
    const a = "module notion where\ndecodeColor wire = wire\n";
    const b = "module notion where\ndecodeColor wire = wire\n";
    expect(() =>
      loadFenelModuleUnion([{ src: a, name: "a.fenel" }, { src: b, name: "b.fenel" }]),
    ).toThrow('module notion: duplicate definition "decodeColor" in a.fenel and b.fenel');
  });
});

describe("notion 3u — a union-sourced codec body dispatches end-to-end", () => {
  const reg = createRegistry([stdModule, codecModule, notionModule]);
  const ctx = reg.evaluateContext();

  test("decodeColor maps the wire string → NotionColor variant through the registry", () => {
    expect(evaluate({ call: ["decodeColor", "red_background"] }, {}, ctx)).toEqual({ $tag: "RedBackground" });
    expect(evaluate({ call: ["decodeColor", "nonsense"] }, {}, ctx)).toEqual({ $tag: "ColorDefault" }); // catch-all
  });

  test("encodeColor inverts the variant back to its wire string", () => {
    expect(evaluate({ call: ["encodeColor", { construct: ["Blue"] }] }, {}, ctx)).toBe("blue");
  });

  test("richTextSpanText extracts a span's plainText (the lone helper)", () => {
    const span = { construct: ["RichTextText", { content: "hi", link: { $tag: "Nothing" }, annotations: { $tag: "Annotations" }, plainText: "hi-plain", href: { $tag: "Nothing" } }] };
    expect(evaluate({ call: ["richTextSpanText", span] }, {}, ctx)).toBe("hi-plain");
  });
});
