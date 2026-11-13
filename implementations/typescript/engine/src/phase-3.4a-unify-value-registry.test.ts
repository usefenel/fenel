// Phase 3.4a of typeclass-substrate-completion — conformance tests for the
// UNIFIED value registry: the loader no longer ROUTES a value-decl into
// "dispatch instance XOR function/constant"; dispatch is a by-type query over
// the ONE value set, and a value's TYPE (not a store it was sorted into)
// decides which queries match it + how the catalog presents it.
// (design/unified-dispatch.md §§ "An instance is a typed value — there is
// nothing special to recognize", "Resolution is a type-indexed query over the
// value registry".)
//
// What this phase landed (and what it pins):
//   (a) A constant value-decl (`x : SomeRecord = SomeRecord {…}`) and a
//       dispatch-instance value-decl are loaded/treated IDENTICALLY (no
//       routing): the constant stays by-name-reachable, the instance is
//       by-type-resolvable, and BOTH are by-type-indexed (the constant
//       harmlessly so). The only difference is the type-driven *presentation*
//       facet — a dispatch-class (`<X>Spec`) value gets no by-name function /
//       identity; any other value does.
//   (b) Dispatch resolves via the derived index OVER THE VALUE SET — the
//       loader's value-decls feed the same Map `addInstance`/`registerValue`
//       populate; there is no separate projected cache (retire-the-cache proof).
//   (c) `addInstance` / `registerValue` / `resolveMethod` resolve identically
//       (swap-invariance — re-pinned here; the untouched phase-3.5 / phase-4
//       oracles are the primary swap-invariance proof).
//   (d) The catalog places a value in a section by its TYPE (a registered
//       dispatch class → "spec"; a data record → "entity"), via the type
//       predicate `isDispatchClassEntity`, NOT by which store-array it lived in.
//   (e) `emptyKeyboardState` (the canonical sig-less data-record constant,
//       fenel/modules/inputs.fenel:129) becomes by-type-indexed under
//       `KeyboardState` AND stays by-name-callable with identity.
//
// Isolation: arms (a)/(b)/(c)/(e) use `loadFenelModule` + a FRESH
// `createDispatchRegistry()` — they never mutate the shared `dispatchRegistry`.
// Arm (d) only READS the boot catalog / entity arrays. So this file is
// audit / system-entity delta-neutral.

import { describe, it, expect } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { createDispatchRegistry } from "./dispatch-registry";
import { resolveMethod, methodDispatchPosition } from "./effect-dispatch";
import {
  isDispatchClassEntity,
  specEntities,
  systemEntities,
} from "./system-entities";
import { getCatalog } from "./type-catalog";
import { Nothing } from "./type-foundation";
import type { FenelType, FieldDef, Instance, Interface } from "./types";
import { GLOBAL_ONLY } from "./dispatch-registry";

// ---------------------------------------------------------------------------
// (a) No routing — a constant and a dispatch-instance are loaded identically.
//
// Phase 3.4b — the dispatch-instance vs constant distinction is no longer a
// per-value TYPE-NAME (suffix) decision; it is the caller's file-level
// `dispatchInstanceFile` marker (the non-suffix replacement). `deriveTypedValueDecl`
// runs the SAME recognition over both shapes; only the marker decides the
// by-name/identity facet. A data-record constant lives in a regular file (no
// marker); a dispatch instance lives in an instance file (marker = true).
// ---------------------------------------------------------------------------

// A data-record constant — a REGULAR file (no instance marker).
const CONST_SRC = `
Box = Box { contents: String }
boxConst : Box
boxConst = Box { contents = "hi" }
`;

// A dispatch-class instance — an INSTANCE file (the marker). Suffix-free name
// (Phase 3.4b): the type is just `Foo`, no `Spec` suffix.
const INSTANCE_SRC = `
Foo a = Foo { tag: String }
fooInstance : Foo Widget
fooInstance = Foo { tag = "w" }
`;

describe("Phase 3.4a (a) — constant + dispatch-instance loaded identically (no routing)", () => {
  it("the constant stays by-name-reachable; the instance does NOT become a by-name function", () => {
    const constMod = loadFenelModule(CONST_SRC, "t");
    const instMod = loadFenelModule(INSTANCE_SRC, "t", { dispatchInstanceFile: true });
    // The data-record constant is a by-name callable value (a nullary function).
    expect((constMod.functions ?? []).map((f) => f.id)).toContain("t:boxConst");
    // The dispatch instance (instance file) is a pure dispatch target — NOT by-name.
    expect((instMod.functions ?? []).map((f) => f.id)).not.toContain("t:fooInstance");
  });

  it("BOTH value-decls are by-type-indexed — the constant harmlessly so", () => {
    const constInsts = loadFenelModule(CONST_SRC, "t").instances ?? [];
    const instInsts = loadFenelModule(INSTANCE_SRC, "t", { dispatchInstanceFile: true }).instances ?? [];
    // The constant: indexed under its data record's type-constructor `Box`.
    const box = constInsts.find((i) => i.typeName === "Box");
    expect(box).toBeDefined();
    expect(box!.args).toEqual([]);
    expect(box!.methods).toEqual({ contents: "hi" });
    // The instance: indexed under the dispatch class `Foo`, keyed by `Widget`.
    const foo = instInsts.find((i) => i.typeName === "Foo");
    expect(foo).toBeDefined();
    expect(foo!.args).toEqual(["Widget"]);
    expect(foo!.methods).toEqual({ tag: "w" });
  });

  it("the file marker drives the IDENTITY facet: the constant gets identity, the instance does not", () => {
    const constInsts = loadFenelModule(CONST_SRC, "t").instances ?? [];
    const instInsts = loadFenelModule(INSTANCE_SRC, "t", { dispatchInstanceFile: true }).instances ?? [];
    const idFacets = (insts: Instance[], id: string) =>
      insts
        .filter((i) => ["Codeable", "Labelable", "Categorizable"].includes(i.typeName) && i.args[0] === id)
        .map((i) => i.typeName)
        .sort();
    // boxConst (regular-file data constant, callable) — Codeable ONLY post-3j:
    // the loader no longer auto-stamps the humanized-codeName Labelable / module-
    // name Categorizable default (those derive at read time via displayLabel /
    // displayCategory). The Codeable dispatch key still distinguishes it from the
    // instance-file value below, which gets no by-name id at all.
    expect(idFacets(constInsts, "t:boxConst")).toEqual(["Codeable"]);
    // fooInstance (instance-file dispatch value) — no by-name id, no identity.
    expect(idFacets(instInsts, "t:fooInstance")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Dispatch resolves via the derived index OVER THE VALUE SET.
// ---------------------------------------------------------------------------

describe("Phase 3.4a (b) — dispatch resolves via the derived index over the value set", () => {
  it("the loader's value-decls feed the same index dispatch reads — no separate cache", () => {
    const constInsts = loadFenelModule(CONST_SRC, "t").instances ?? [];
    const instInsts = loadFenelModule(INSTANCE_SRC, "t", { dispatchInstanceFile: true }).instances ?? [];
    // Feed a FRESH registry from the loader's value-decls — exactly the path
    // system-entities.ts:buildRegistry uses (`for (const inst of …) addInstance`).
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "Foo",
      params: [{ name: "a" }],
      methods: [{ name: "tag", params: [], returns: { $ref: "String" } }],
    });
    for (const inst of [...constInsts, ...instInsts]) reg.addInstance(inst);

    // The dispatch-instance is by-type-resolvable from that index.
    expect(reg.satisfies("Widget", "Foo", GLOBAL_ONLY)).toBe(true);
    expect(reg.resolve("Widget", "Foo", GLOBAL_ONLY)).toEqual({ tag: "w" });

    // The data-record constant landed in the SAME index (one value set), keyed
    // by `Box` — nothing queries `Box`, so it is harmless, but it IS there.
    expect(reg.listInstances("Box")).toHaveLength(1);
    expect(reg.listInstances("Box")[0]!.methods).toEqual({ contents: "hi" });
  });
});

// ---------------------------------------------------------------------------
// (c) Swap-invariance — addInstance / registerValue / resolveMethod identical.
// ---------------------------------------------------------------------------

const fp = (name: string, type: FenelType): FieldDef => ({
  name,
  type,
  label: Nothing,
  ui: Nothing,
  meta: {},
});

const monoidSeed: Interface = {
  name: "TestMonoid",
  params: [{ name: "a" }],
  methods: [
    {
      name: "mappend",
      params: [fp("_0", { $var: "a" }), fp("_1", { $var: "a" })],
      returns: { $var: "a" },
    },
  ],
};

describe("Phase 3.4a (c) — addInstance / registerValue / resolveMethod resolve identically", () => {
  it("registerValue (type-derived key) and addInstance (pre-keyed) produce the same entry", () => {
    const viaValue = createDispatchRegistry();
    viaValue.defineClass(monoidSeed);
    viaValue.registerValue({ $el: { call: ["TestMonoid", { $ref: "String" }] } }, {
      mappend: "test:phase34aSwapMappend",
    });

    const viaInstance = createDispatchRegistry();
    viaInstance.defineClass(monoidSeed);
    viaInstance.addInstance({
      typeName: "TestMonoid",
      args: ["String"],
      methods: { mappend: "test:phase34aSwapMappend" },
    });

    const a = viaValue.listInstances("TestMonoid")[0]!;
    const b = viaInstance.listInstances("TestMonoid")[0]!;
    expect(a.typeName).toBe(b.typeName);
    expect(a.args).toEqual(b.args);
  });

  it("resolveMethod rides on the value-query index: reflect → query → project → Unique", () => {
    const reg = createDispatchRegistry();
    reg.defineClass(monoidSeed);
    reg.registerValue({ $el: { call: ["TestMonoid", { $ref: "String" }] } }, {
      mappend: "test:phase34aResolvedMappend",
    });
    expect(methodDispatchPosition(reg, "TestMonoid", "mappend")).toBe(0);
    const r = resolveMethod("TestMonoid", "mappend", ["hi", "there"], undefined, reg);
    expect(r.$tag).toBe("Unique");
    if (r.$tag === "Unique") {
      expect(r.key).toBe("String");
      expect(r.method).toBe("test:phase34aResolvedMappend");
    }
  });
});

// ---------------------------------------------------------------------------
// (d) The catalog places a value in a section by its TYPE.
// ---------------------------------------------------------------------------

describe("Phase 3.4a (d) — the catalog sections are computed by TYPE, not by store", () => {
  // Representative ids drawn from the live registry so the arm is robust to
  // corpus changes: a real dispatch class (a spec) + a real data entity.
  const aSpecId = specEntities.find((e) => e.type)!.id;
  const aDataEntityId = systemEntities.find(
    (e) => e.type && !e.params?.length && !isDispatchClassEntity(e.id),
  )!.id;

  it("the type predicate classifies a dispatch class vs a data entity", () => {
    expect(isDispatchClassEntity(aSpecId)).toBe(true);
    expect(isDispatchClassEntity(aDataEntityId)).toBe(false);
  });

  it("getCatalog routes by that type predicate; section ids stay stable", () => {
    const cat = getCatalog();
    const ids = cat.map((s) => s.id);
    // Section ids (frontend reads these). Phase 6b merged the old `typeclass`
    // + `spec` sections into one `interface` section (everything is a type).
    expect(ids).toEqual([
      "atom",
      "foundation",
      "format",
      "unit",
      "composite",
      "function",
      "entity",
      "interface",
      "constructor",
    ]);
    const sec = (id: string) => cat.find((s) => s.id === id)!;
    const specIds = sec("interface").entries.map((e) => e.id);
    const entityIds = sec("entity").entries.map((e) => e.id);
    // A dispatch-class value lands in "interface" (with the `spec:` origin
    // prefix), NOT "entity".
    expect(specIds).toContain(`spec:${aSpecId}`);
    expect(entityIds).not.toContain(`entity:${aSpecId}`);
    // A data-record value lands in "entity", NOT "interface".
    expect(entityIds).toContain(`entity:${aDataEntityId}`);
    expect(specIds).not.toContain(`spec:${aDataEntityId}`);
  });
});

// ---------------------------------------------------------------------------
// (e) emptyKeyboardState — the canonical sig-less data-record constant.
// ---------------------------------------------------------------------------

// Mirrors fenel/modules/inputs.fenel:129 in isolation (that file is aspirational
// design-Fenel, not wired into the engine boot, so the watch-out's scenario is
// only observable through the loader directly — which is exactly what this pins).
// The constant has NO type sig, so it is recognised via the body-only path (the
// single-constructor record's head IS its type).
const KEYBOARD_SRC = `
KeyboardState = KeyboardState { held: String }

emptyKeyboardState = KeyboardState { held = "" }
`;

describe("Phase 3.4a (e) — emptyKeyboardState: by-type-indexed AND by-name-callable", () => {
  it("the sig-less constant is by-type-indexed under KeyboardState", () => {
    const mod = loadFenelModule(KEYBOARD_SRC, "inputs");
    const ks = (mod.instances ?? []).find((i) => i.typeName === "KeyboardState");
    expect(ks).toBeDefined();
    expect(ks!.args).toEqual([]);
    expect(ks!.methods).toEqual({ held: "" });
  });

  it("and stays by-name-callable with identity (it is a constant, not a pure dispatch target)", () => {
    const mod = loadFenelModule(KEYBOARD_SRC, "inputs");
    expect((mod.functions ?? []).map((f) => f.id)).toContain("inputs:emptyKeyboardState");
    const codeable = (mod.instances ?? []).find(
      (i: Instance) => i.typeName === "Codeable" && i.args[0] === "inputs:emptyKeyboardState",
    );
    expect(codeable).toBeDefined();
  });
});
