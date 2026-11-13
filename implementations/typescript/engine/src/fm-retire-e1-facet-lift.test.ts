// FM-retire-E1 (Ext-1) — substrate conformance: the loader lifts entity-level
// `@label` / `@description` / `@icon` facet directives off a `type_def` into
// identity-facet ClassInstances (Codeable / Labelable / Describable / Iconable),
// Phase 2b changes the field half deliberately: per-field directives remain
// typed source selectors on the raw module until the completed identity roster
// resolves them to UUID-keyed facets. The loader emits neither `<id>.<path>`
// runtime instances nor an inline `field.label` overlay.
//
// This is the `.fenel` analogue of a `defineSystemEntity` identity record — the
// prerequisite the system-entities bulk port rides on. Pre-E1 the loader's entity
// path emitted NO instances (the audit probe showed `instances: []`).
//
// Inertness invariant (also pinned here): a type_def carrying ONLY a
// `@discriminator` directive — NOT an identity facet — emits no Codeable / identity
// instance, so the existing `@discriminator`-only module type_defs (prover, page)
// are byte-unaffected.

import { describe, it, expect } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import type { Instance } from "./types";

function instOf(insts: Instance[], typeName: string, arg0: string): Instance | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === arg0);
}

describe("FM-retire-E1 Ext-1 — entity facet lifting", () => {
  const src = `
@label "Widget"
@description "A small thing"
@icon "box"
@fieldLabel "kind" "Widget Kind"
Widget = Widget kind: String qty: Number
`;
  const mod = loadFenelModule(src, "std");
  const insts = mod.instances ?? [];

  it("registers the entity shape", () => {
    const e = (mod.entities ?? []).find((x) => x.id === "Widget");
    expect(e).toBeDefined();
  });

  it("lifts Codeable / Labelable / Describable / Iconable from entity directives", () => {
    expect(instOf(insts, "Codeable", "Widget")?.methods.codeName).toBe("Widget");
    expect(instOf(insts, "Labelable", "Widget")?.methods.label).toBe("Widget");
    expect(instOf(insts, "Describable", "Widget")?.methods.description).toBe("A small thing");
    expect(instOf(insts, "Iconable", "Widget")?.methods.icon).toBe("box");
  });

  it("retains @fieldLabel as a typed source selector, not a dotted runtime target", () => {
    expect(mod.fieldFacetDirectives).toEqual([{
      owner: { module: "std", entityId: "Widget" },
      selector: "kind",
      source: { kind: "label", label: "Widget Kind" },
      provenance: { module: "std", declaration: "Widget", selector: "kind" },
    }]);
    expect(instOf(insts, "Labelable", "Widget.kind")).toBeUndefined();
  });

  it("keeps the raw declaration presentation-empty until identified view construction", () => {
    const e = (mod.entities ?? []).find((x) => x.id === "Widget")!;
    const rec = (e.type as { $record?: { fields: Array<{ name: string; label?: unknown }> } }).$record;
    const kind = rec?.fields.find((f) => f.name === "kind");
    expect(kind?.label).toEqual({ $tag: "Nothing" });
  });

  it("lifts identity facets off a refined-String atom type-decl too", () => {
    const atomSrc = `
@label "URL"
@description "An absolute URL"
UrlStr = String | isAbsoluteUrl
`;
    const am = loadFenelModule(atomSrc, "std");
    const ai = am.instances ?? [];
    expect(instOf(ai, "Codeable", "UrlStr")?.methods.codeName).toBe("UrlStr");
    expect(instOf(ai, "Labelable", "UrlStr")?.methods.label).toBe("URL");
    expect(instOf(ai, "Describable", "UrlStr")?.methods.description).toBe("An absolute URL");
  });

  it("is INERT for a @discriminator-only type_def (no identity facets → no Codeable)", () => {
    const discSrc = `
@discriminator "type"
Shape = Circle type: String | Square type: String
`;
    const dm = loadFenelModule(discSrc, "std");
    const di = dm.instances ?? [];
    expect(instOf(di, "Codeable", "Shape")).toBeUndefined();
    expect(di.length).toBe(0);
  });
});
