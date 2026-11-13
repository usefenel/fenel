// ---------------------------------------------------------------------------
// typed-ref-instances.test.ts — typed-function-references Phase 3 proof.
//
// Phase 3 converts the representational-class INSTANCE values that stored a
// function as a bare codeName String onto the typed `{$ref:id}` reference value
// (the `Ref` substrate, built in Phase 2). The 14 function-ref instances
// (Renderable 8 + Sampleable 6, across templates / sound / picture / movie /
// animation / events) now hold `{$ref:id}`; the C3 dispatch-table build
// (`registry.ts` `_sampleByTag` / `_renderByTag`) extracts the id from the
// `{$ref}` (keeping the bare-string arm for back-compat).
//
// This suite pins:
//   • the 14 instance method values are typed `{$ref:<id>}` (the value-form
//     conversion — the core of this phase);
//   • the C3 table build reads a `{$ref}` instance into the right id (Option X:
//     the in-memory tables hold ids, not refs);
//   • end-to-end `sample`/`render` dispatch (the pollySample/pollyRender path)
//     still resolves for Picture + Sound through `_sampleByTag`/`_renderByTag`;
//   • a LEGACY bare-string-valued instance still builds the table (back-compat —
//     the string arm survives until the clean-break phase).
//
// The live module-migrate suites + dispatch.test.ts exercise the wider path and
// stay green. Canonical spec: design/typed-function-references.md.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { pictureModule } from "./modules/picture";
import { soundModule } from "./modules/sound";
import { movieModule } from "./modules/movie";
import { animationModule } from "./modules/animation";
import { eventsModule } from "./modules/events";
import { templateModule } from "./modules/templates";
import { dispatchModule } from "./modules/dispatch";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { isRef } from "./type-foundation";
import type { FenelModule, Instance } from "./types";

// The 14 function-ref instances, as (module, typeName, entity, methodKey,
// expected handle) rows — pinned against the source modules directly. The
// `handle` is whatever the instance's `{$ref}` carries: typed-function-references
// Phase 10c moved the 5 media modules (picture/sound/movie/animation/events)
// from TS seam consts to `.fenel` value-decls, so their point-free method ref
// (`sample = sampleAnim`) lowers to a CODENAME handle (`{$ref:"sampleAnim"}`),
// NOT the fnId handle (`{$ref:"animation:sampleAnim"}`) the const carried. The
// dispatch tables resolve the codeName id-or-codeName to the canonical fnId, so
// dispatch is byte-identical (see the `_sampleByTag`/`_renderByTag` checks
// below, which still assert the fnId). templates is still a TS const (its
// `max_length: null` field is a TS-null wrinkle), and its render handle was
// already the bare codeName `markup_to_*`.
const ROWS: Array<{ mod: FenelModule; cn: string; ent: string; key: string; handle: string }> = [
  { mod: templateModule, cn: "Renderable", ent: "email", key: "render", handle: "markup_to_html" },
  { mod: templateModule, cn: "Renderable", ent: "sms", key: "render", handle: "markup_to_plaintext" },
  { mod: templateModule, cn: "Renderable", ent: "telegram", key: "render", handle: "markup_to_telegram_md" },
  { mod: templateModule, cn: "Renderable", ent: "pdf", key: "render", handle: "markup_to_pdf" },
  { mod: soundModule, cn: "Sampleable", ent: "Sound", key: "sample", handle: "sampleSound" },
  { mod: soundModule, cn: "Renderable", ent: "Sound", key: "render", handle: "renderSound" },
  { mod: pictureModule, cn: "Sampleable", ent: "Picture", key: "sample", handle: "sample" },
  { mod: pictureModule, cn: "Renderable", ent: "Picture", key: "render", handle: "render" },
  { mod: movieModule, cn: "Sampleable", ent: "Movie", key: "sample", handle: "sampleMovie" },
  { mod: movieModule, cn: "Renderable", ent: "Movie", key: "render", handle: "renderMovie" },
  { mod: animationModule, cn: "Sampleable", ent: "Animation", key: "sample", handle: "sampleAnim" },
  { mod: animationModule, cn: "Renderable", ent: "Animation", key: "render", handle: "renderAnim" },
  { mod: eventsModule, cn: "Sampleable", ent: "Behavior", key: "sample", handle: "sampleBehavior" },
  { mod: eventsModule, cn: "Sampleable", ent: "Event", key: "sample", handle: "sampleEvent" },
];

function findInst(mod: FenelModule, cn: string, ent: string): Instance | undefined {
  return (mod.instances ?? []).find((i) => i.typeName === cn && i.args[0] === ent);
}

describe("Phase 3 — the 14 instance values are typed {$ref:<id>}", () => {
  test("every converted instance holds `{$ref:<id>}`, not a bare codeName string", () => {
    for (const r of ROWS) {
      const inst = findInst(r.mod, r.cn, r.ent);
      expect(inst, `${r.cn}<${r.ent}> must exist`).toBeDefined();
      const v = inst!.methods[r.key];
      expect(isRef(v), `${r.cn}<${r.ent}>.${r.key} must be a {$ref}`).toBe(true);
      expect(v).toEqual({ $ref: r.handle });
    }
  });

  test("exactly 14 function-ref instances are covered (8 Renderable + 6 Sampleable)", () => {
    expect(ROWS.filter((r) => r.cn === "Renderable").length).toBe(8);
    expect(ROWS.filter((r) => r.cn === "Sampleable").length).toBe(6);
  });
});

describe("Phase 3 — C3 reads {$ref} into the dispatch tables (Option X: tables hold ids)", () => {
  const reg = createRegistry([stdModule, pictureModule, soundModule, dispatchModule]);
  const ctx = reg.evaluateContext();

  test("_sampleByTag extracts the id from a {$ref} Sampleable instance", () => {
    // Picture cases (Field/Raster) and Sound cases (Wave/Buffer) — the tag→id
    // table built from the now-{$ref} instances. The VALUE in the table is a
    // bare id string (Option X), NOT a {$ref}.
    expect(ctx._sampleByTag!["Field"]).toBe("picture:sample");
    expect(ctx._sampleByTag!["Raster"]).toBe("picture:sample");
    expect(ctx._sampleByTag!["Wave"]).toBe("sound:sampleSound");
    expect(typeof ctx._sampleByTag!["Field"]).toBe("string");
  });

  test("_renderByTag extracts the id from a {$ref} Renderable instance", () => {
    expect(ctx._renderByTag!["Field"]).toBe("picture:render");
    expect(ctx._renderByTag!["Raster"]).toBe("picture:render");
    expect(ctx._renderByTag!["Wave"]).toBe("sound:renderSound");
    expect(typeof ctx._renderByTag!["Wave"]).toBe("string");
  });
});

describe("Phase 3 — end-to-end sample/render dispatch survives the value conversion", () => {
  const reg = createRegistry([stdModule, pictureModule, soundModule, dispatchModule]);
  const ctx = reg.evaluateContext();
  const call = (name: string, ...args: unknown[]) => evaluate({ call: [name, ...args] }, {}, ctx);
  const RED = { r: 255, g: 0, b: 0, a: 255 };

  test("polymorphic `sample` dispatches to picture's sample (pollySample path)", () => {
    const pic = call("solid", RED);
    const pt = call("point", 5, 5);
    expect(call("sample", pic, pt)).toEqual(RED);
  });

  test("polymorphic `sample` dispatches to sound's sample (pollySample path)", () => {
    const snd = call("sine", 1);
    const t = call("time", 0.25);
    const a = call("sample", snd, t) as { l: number; r: number };
    expect(a.l).toBeCloseTo(1, 5);
    expect(a.r).toBeCloseTo(1, 5);
  });

  test("polymorphic `render` dispatches to picture's render (pollyRender path)", () => {
    const raster = { $tag: "Raster", _0: { width: 2, height: 2, pixels: [RED, RED, RED, RED] } };
    const img = call("render", raster, 2, 2) as { width: number; height: number; pixels: unknown[] };
    expect(img.width).toBe(2);
    expect(img.pixels).toHaveLength(4);
  });
});

describe("Phase 3 — back-compat: a legacy bare-string instance still builds the table", () => {
  // The string arm is load-bearing until the clean-break phase. A stray
  // un-converted instance (method value = bare codeName string) must still
  // populate the dispatch table.
  const legacyModule: FenelModule = {
    name: "legacymod",
    entities: [{ id: "LegacyThing", type: { $variant: { cases: [{ name: "LegacyA" }] } } }],
    functions: [],
    instances: [
      { typeName: "Sampleable", args: ["LegacyThing"], methods: { sample: "legacy:sampleThing" } },
    ],
  } as unknown as FenelModule;

  test("a string-valued Sampleable instance lands in _sampleByTag (string arm)", () => {
    const reg = createRegistry([legacyModule]);
    const ctx = reg.evaluateContext();
    expect(ctx._sampleByTag!["LegacyA"]).toBe("legacy:sampleThing");
  });
});

describe("Phase 10 — a CODENAME {$ref} handle resolves to the canonical fnId in the table", () => {
  // The Phase-10 loader flip makes a `.fenel`-authored reference method a
  // codeName handle (`{$ref:"doSample"}`, not the fnId `{$ref:"cn:doSample"}` —
  // you can't author a `:`-qualified id point-free). The dispatch-table builder
  // resolves the handle id-or-codeName (like `getFunction` at call time), so the
  // table holds the CANONICAL fnId regardless of handle form — this is what lets
  // such instances dispatch correctly without the table storing a bare codeName.
  const cnModule: FenelModule = {
    name: "cn",
    entities: [{ id: "CnThing", type: { $variant: { cases: [{ name: "CnA" }] } } }],
    functions: [{ id: "cn:doSample", params: [], returns: { $ref: "Unit" } }],
    instances: [
      { typeName: "Codeable", args: ["cn:doSample"], methods: { codeName: "doSample" } },
      // The codeName handle the Phase-10 loader would emit for `sample = doSample`:
      { typeName: "Sampleable", args: ["CnThing"], methods: { sample: { $ref: "doSample" } } },
    ],
  } as unknown as FenelModule;

  test("_sampleByTag holds the fnId, not the codeName, for a codeName-handle instance", () => {
    const reg = createRegistry([cnModule]);
    const ctx = reg.evaluateContext();
    expect(ctx._sampleByTag!["CnA"]).toBe("cn:doSample");
  });
});
