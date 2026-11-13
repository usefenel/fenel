// ---------------------------------------------------------------------------
// module-migrate-templates.test.ts — typed-function-references FenelModule-
// retirement Phase FM-retire-1 parity proof (the warm-up port).
//
// `templates` moved off its 4 `defineFunction` specs onto
// `fenel/modules/templates/templates.fenel` (`module templates where` + 4 fn
// decls + the `RenderFormat` named atom) + a thin seam that keeps the existing
// `types.fenel` (Markup / HeadingLevel) + `instances.fenel` (4 Renderable
// instances) sidecars loaded exactly as before.
//
// This file LOCKS the migrated roster, the DROPPED Categorizable (3j), the kept
// Renderable instances + entities, and the two INTENDED type improvements:
//   1. the 3 `markup` params: `{$record:{fields:[]}}` empty-record placeholder
//      → the declared `Markup` type (no-corner-cut fix; chips 3 off the 97).
//   2. `render_template`'s `format`: the inline `$refined String $enum` (which
//      does not parse at param position) → the `RenderFormat` named atom (the
//      HeadingLevel path-(b) workaround), holding the byte-identical refined
//      shape. `context` stays `{}` (genuinely dynamic — held, not faked).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { templateModule } from "./modules/templates";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import type { Instance } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 Step 4 — the parser now emits SetExprs in the
// canonical `$tag` Se* form, so the `RenderFormat` atom's inline `$enum` set
// (parsed from templates.fenel) comes back as `{$tag:"SeEnum", values:[…]}`. `cf`
// deeply lowers ANY-form SetExpr back to the legacy `$`-key shape so the
// byte-identical shape check below stays a STRUCTURE/VALUE comparison
// (setExprToDollarKey rewrites ONLY the SetExpr discriminator — it cannot mask a
// structure/value regression). Same sanctioned mechanical re-pin as the
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

const FN_IDS = [
  "templates:render_template",
  "templates:markup_to_html",
  "templates:markup_to_plaintext",
  "templates:markup_to_telegram_md",
];

const RICH: Record<string, { label: string; description: string; tags: string[] }> = {
  "templates:render_template": {
    label: "Render Template",
    description: "Evaluate a template function with given context, produce Markup, then render to target format via Renderable typeclass.",
    tags: ["template", "render"],
  },
  "templates:markup_to_html": {
    label: "Markup to HTML",
    description: "Convert Markup AST to HTML string. Used by Renderable Email instance.",
    tags: ["template", "render", "pure"],
  },
  "templates:markup_to_plaintext": {
    label: "Markup to Plaintext",
    description: "Convert Markup AST to plain text. Strips formatting, truncates for SMS.",
    tags: ["template", "render", "pure"],
  },
  "templates:markup_to_telegram_md": {
    label: "Markup to Telegram Markdown",
    description: "Convert Markup AST to Telegram-flavored Markdown.",
    tags: ["template", "render", "pure"],
  },
};

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}
const hasNoDefault = (d: unknown): boolean =>
  d == null || (d as { $tag?: string }).$tag === "Nothing";
const refName = (t: unknown): string | undefined => {
  const o = t as { $ref?: string };
  return o?.$ref;
};

const byId = new Map((templateModule.functions ?? []).map((f) => [f.id, f]));
const insts = templateModule.instances ?? [];

describe("templates migration — roster + identity", () => {
  test("the `module templates where` header is authoritative", () => {
    expect(templateModule.name).toBe("templates");
  });

  test("all 4 functions registered under the legacy `templates:` id-prefix", () => {
    expect((templateModule.functions ?? []).map((f) => f.id).sort()).toEqual([...FN_IDS].sort());
  });

  test("codeName === id-suffix for every fn (no @codeName)", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Codeable", id)).toEqual({ codeName: id.split(":")[1] });
    }
  });

  test("every fn resolves by id + codeName through createRegistry", () => {
    const reg = createRegistry([stdModule, templateModule]);
    for (const id of FN_IDS) {
      const suffix = id.split(":")[1]!;
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(suffix)?.id).toBe(id);
    }
  });
});

describe("templates migration — all 4 bodyless, defaults drop, facet parity", () => {
  test("no function carries a body (render_template + 3 markup_to_* dispatch stubs)", () => {
    for (const f of templateModule.functions ?? []) expect(f.body).toBeUndefined();
  });

  test("NO param default survives on ANY function", () => {
    for (const f of templateModule.functions ?? []) {
      for (const p of f.params ?? []) expect(hasNoDefault((p as Record<string, unknown>).default)).toBe(true);
    }
  });

  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of FN_IDS) {
      expect(methodOf(insts, "Labelable", id)).toEqual({ label: RICH[id]!.label });
      expect(methodOf(insts, "Describable", id)).toEqual({ description: RICH[id]!.description });
      expect(methodOf(insts, "Taggable", id)).toEqual({ tags: RICH[id]!.tags });
    }
  });

  test("NO stored Categorizable on any fn (3j read-time, derives from `templates:`)", () => {
    for (const id of FN_IDS) expect(methodOf(insts, "Categorizable", id)).toBeUndefined();
  });

  test("ZERO IOInvokable across the module (no ioAction in templates)", () => {
    expect(insts.filter((i) => i.typeName === "IOInvokable").length).toBe(0);
  });
});

describe("templates migration — the no-corner-cut type fixes", () => {
  test("the 3 markup params are now the declared `Markup` type (was empty-record placeholder)", () => {
    for (const id of ["templates:markup_to_html", "templates:markup_to_plaintext", "templates:markup_to_telegram_md"]) {
      const markup = byId.get(id)!.params.find((p) => p.name === "markup")!;
      expect(refName(markup.type)).toBe("Markup");
    }
  });

  test("render_template: format -> RenderFormat (named atom), context held `{}`", () => {
    const rt = byId.get("templates:render_template")!;
    expect(refName(rt.params.find((p) => p.name === "format")!.type)).toBe("RenderFormat");
    expect(rt.params.find((p) => p.name === "context")!.type).toEqual({ $record: { fields: [] } });
  });

  test("RenderFormat entity holds the byte-identical inline refined-enum shape", () => {
    const rf = (templateModule.entities ?? []).find((e) => e.id === "RenderFormat");
    expect(rf).toBeDefined();
    expect(cf(rf!.type)).toEqual({
      $refined: { base: { $ref: "String" }, set: { $enum: ["email", "sms", "telegram", "pdf"] } },
    });
  });
});

describe("templates migration — entities + Renderable instances preserved", () => {
  test("entities carry Markup + HeadingLevel (types.fenel) + RenderFormat (templates.fenel)", () => {
    const ids = (templateModule.entities ?? []).map((e) => e.id);
    expect(ids).toContain("Markup");
    expect(ids).toContain("HeadingLevel");
    expect(ids).toContain("RenderFormat");
  });

  test("the 4 Renderable instances (email / sms / telegram / pdf) register", () => {
    const renderable = insts.filter((i) => i.typeName === "Renderable");
    const entArgs = renderable.map((i) => i.args[0]).sort();
    expect(entArgs).toEqual(["email", "pdf", "sms", "telegram"]);
  });

  test("each Renderable instance's render handle lowers to the {$ref} codeName handle", () => {
    const handle = (ent: string) =>
      (insts.find((i) => i.typeName === "Renderable" && i.args[0] === ent)?.methods as { render?: { $ref?: string } } | undefined)?.render?.$ref;
    expect(handle("email")).toBe("markup_to_html");
    expect(handle("sms")).toBe("markup_to_plaintext");
    expect(handle("telegram")).toBe("markup_to_telegram_md");
    expect(handle("pdf")).toBe("markup_to_pdf");
  });
});
