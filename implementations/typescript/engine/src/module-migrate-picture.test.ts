// ---------------------------------------------------------------------------
// module-migrate-picture.test.ts — module-substrate Phase 3f parity proof.
//
// picture is the Phase-3e-designated REPRESENTATIVE CTX-NATIVE: the first
// module migrated to `module … where` whose `ffi/` leaf hosts a
// `nativeImplsCtx` map. `time` (3b) + `codec` (3d) proved the plain
// `nativeImpls` split but never exercised the ctx tier — how a native that
// re-enters the evaluator rides the leaf + receives the `EvaluateContext`.
//
// This is a PARITY migration — the ~338-LOC hand-assembled
// `engine/src/modules/picture.ts` (5 `defineFunction` specs + inline native
// impls + the source-module merge) was replaced by `types.fenel` (declarative,
// now with a `module picture where` header + 5 `@native` foreign decls) +
// `ffi/picture-ffi.ts` (the 5 native impls split into plain + ctx maps) + a
// thin seam, with NOTHING dropped. The structural proof below asserts:
//   - all 17 functions resolve by id under the legacy `picture:` prefix;
//   - the 5 native-backed functions are bodyless foreign declarations, the 12
//     Fenel-bodied helpers keep their bodies;
//   - the 3 PLAIN natives (point / color / alphaBlend) land in `nativeImpls`;
//   - the 2 CTX natives (sample / render) land in `nativeImplsCtx` — PRESENT +
//     id-keyed (the INVERSE of codec's `nativeImplsCtx === undefined` assertion;
//     the headline of this phase);
//   - identity-facet parity (the 5 natives' rich Labelable/Describable/Taggable);
//   - the Sampleable / Renderable dispatch instances ride the seam;
//   - the ctx native dispatches end-to-end through `createRegistry`, re-entering
//     the evaluator to run a `Field` closure.
// The render/sample round-trip + the closure math are covered more broadly by
// picture.test.ts (kept green by this migration).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { pictureModule } from "./modules/picture";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// The 5 natives carried rich `defineFunction` identity (codeName + label +
// description + category="picture" + tags). The `module picture where` header
// supplies the `picture` category default; @label/@description/@tags reproduce
// the rest. `ctx: true` == the native lands in `nativeImplsCtx` (re-enters the
// evaluator); `ctx: false` == plain `nativeImpls`.
type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  sample: {
    label: "Sample",
    tags: ["picture", "primitive"],
    description:
      "Sample a Picture at a Point, returning the color the Picture has at that point. The bridge primitive — every higher-level Picture operation reduces to this.",
    ctx: true,
  },
  render: {
    label: "Render",
    tags: ["picture", "primitive"],
    description: "Rasterise a Picture into a width × height Image by sampling at each pixel.",
    ctx: true,
  },
  point: {
    label: "Point",
    tags: ["picture", "constructor"],
    description: "Build a Point record from x and y coordinates.",
    ctx: false,
  },
  color: {
    label: "Color",
    tags: ["picture", "constructor"],
    description: "Build a Color record from r, g, b, a byte components (0–255, clamped).",
    ctx: false,
  },
  alphaBlend: {
    label: "Alpha blend",
    tags: ["picture", "compositing"],
    description: "Source-over compositing of straight RGBA pixels using both alpha channels. Shared raster math retains translucent coverage; a fully transparent result is transparent black.",
    ctx: false,
  },
};

// The 12 Fenel-bodied helpers (already `.fenel` since ts-elimination 4g) — no
// explicit @label/@description/@tags; identity is auto-derived (humanized
// Labelable + module Categorizable + Codeable).
const BODIED_NAMES = [
  "solid", "circle", "over", "dist",
  "rectangle", "ellipse",
  "linearGradient", "radialGradient",
  "checkerboard", "inBox",
  "lerpColor", "clamp01",
];

// effect-visibility Phase 4 — sample/render gained Fenel BODIES (the hof-body
// floor: every ctx-native is the perf branch of a Fenel body; the Phase-3 std
// pattern). Their ctx-native impls REMAIN in nativeImplsCtx (the seam maps are
// unchanged); only their bodyless-ness flipped. +3 recursion helpers
// (rasterAt / renderRows / renderRow), each with explicit @label/@description/
// @tags like the natives.
const P4_BODIED_NATIVES = ["sample", "render"];
const SOURCE_BACKED_PLAIN_NATIVES = ["alphaBlend"];
const P4_HELPERS = ["rasterAt", "renderRows", "renderRow"];
const SAMPLE_NAMES = [
  "sampleLandscape", "sampleLandscapeBackground", "sampleLandscapeGround",
  "sampleLandscapeHouse", "sampleLandscapeWindows", "sampleLandscapeTree",
];
const CODE_NAMES: Record<string, string> = { sample: "pictureSample", render: "pictureRender" };

const NATIVE_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = NATIVE_NAMES.filter((n) => !NATIVES[n]!.ctx); // point / color / alphaBlend
const BODYLESS_PLAIN_NATIVES = PLAIN_NATIVES.filter((n) => !SOURCE_BACKED_PLAIN_NATIVES.includes(n));
const CTX_NATIVES = NATIVE_NAMES.filter((n) => NATIVES[n]!.ctx); // sample / render
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES, ...P4_HELPERS, ...SAMPLE_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("picture migration — header-driven identity", () => {
  test("the `module picture where` header is authoritative (lowercase prefix preserved)", () => {
    expect(pictureModule.name).toBe("picture");
  });

  test("all 26 functions registered under the legacy `picture:` id-prefix", () => {
    expect((pictureModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `picture:${n}`).sort(),
    );
  });

  test("the 2 entities (Picture / Point) ride along from the `.fenel`", () => {
    expect((pictureModule.entities ?? []).map((e) => e.id).sort()).toEqual(["Picture", "Point"]);
  });

  test("module label preserved", () => {
    // loadFenelModule wraps the label in Just(...)
    expect(JSON.stringify(pictureModule.label)).toContain("Picture");
  });
});

describe("picture migration — the `ffi/` split + the BOTH-MAPS seam (axis #3)", () => {
  test("point/color remain bodyless; sample/render/alphaBlend have source bodies", () => {
    const bodyless = (pictureModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(BODYLESS_PLAIN_NATIVES.map((n) => `picture:${n}`).sort());
  });

  test("every Fenel-bodied helper and sample carries its `.fenel` body", () => {
    for (const n of [...BODIED_NAMES, ...P4_BODIED_NATIVES, ...SOURCE_BACKED_PLAIN_NATIVES, ...P4_HELPERS, ...SAMPLE_NAMES]) {
      const f = (pictureModule.functions ?? []).find((f) => f.id === `picture:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) holds exactly point / color / alphaBlend, id-keyed", () => {
    expect(Object.keys(pictureModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `picture:${n}`).sort(),
    );
  });

  // THE HEADLINE — the inverse of codec's `nativeImplsCtx === undefined`.
  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sample / render, id-keyed", () => {
    expect(pictureModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(pictureModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `picture:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (no native in both — axis #4: seam routes, no marker)", () => {
    const plain = new Set(Object.keys(pictureModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(pictureModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements (picture is nativeImpls + nativeImplsCtx only)", () => {
    expect(pictureModule.ioHandlers).toBeUndefined();
    expect(pictureModule.credentialRequirements).toBeUndefined();
  });
});

describe("picture migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = pictureModule.instances ?? [];

  test("Codeable: picture sampling/rendering have distinct global names", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `picture:${n}`)).toEqual({ codeName: CODE_NAMES[n] ?? n });
    }
  });

  // Phase 3j (identity-as-fallback): picture declares no @category, so NONE carry
  // a stored Categorizable — the `picture` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — picture declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `picture:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for the 5 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `picture:${n}`)).toEqual({ label: NATIVES[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for the 5 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Describable", `picture:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `picture:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("the 12 bodied helpers carry NO Describable / Taggable (auto-derived identity only)", () => {
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Describable", `picture:${n}`)).toBeUndefined();
      expect(methodOf(insts, "Taggable", `picture:${n}`)).toBeUndefined();
    }
  });

  // Phase 3j: Labelable drops to the explicitly-@label'd set (the 12 original
  // bodied helpers rely on the auto-default). effect-visibility Phase 4:
  // sample/render kept their facets when they gained bodies, + the 3 new
  // helpers and the original landscape carry explicit facets.
  test("identity-facet counts: 26 Codeable, 9 Labelable, 0 Categorizable (none @category), 9 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(26);
    expect(counts.Labelable).toBe(9);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(9);
    expect(counts.Taggable).toBe(9);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("picture migration — Sampleable / Renderable dispatch instances ride the seam", () => {
  const insts = pictureModule.instances ?? [];

  test("Sampleable<Picture> → picture:sample, Renderable<Picture> → picture:render", () => {
    const find = (cn: string) => insts.find((i) => i.typeName === cn && i.args[0] === "Picture");
    // typed-function-references Phase 10c — `.fenel`-authored
    // (fenel/modules/picture/instances.fenel): the point-free method ref lowers
    // to a CODENAME handle, which the sample/render table resolves id-or-codeName
    // to the canonical `picture:sample` / `picture:render` (dispatch unchanged).
    expect(find("Sampleable")?.methods).toEqual({ sample: { $ref: "sample" } });
    expect(find("Renderable")?.methods).toEqual({ render: { $ref: "render" } });
  });
});

describe("picture migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([pictureModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `picture:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(CODE_NAMES[n] ?? n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees picture as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("picture").sort()).toEqual([...ALL_NAMES].sort());
    expect(reg.getFunction("picture.sample")?.id).toBe("picture:sample");
    expect(reg.getFunction("picture.render")?.id).toBe("picture:render");
  });

  test("the registry context exposes BOTH native maps — plain via `natives`, ctx via `nativesCtx`", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`picture:${n}`], `plain native present: picture:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`picture:${n}`], `ctx native present: picture:${n}`).toBe("function");
    }
  });

  test("plain natives are directly callable + build the runtime representation records", () => {
    const ctx = reg.evaluateContext();
    expect(ctx.natives!["picture:color"]!(10, 20, 30, 40)).toEqual({ r: 10, g: 20, b: 30, a: 40 });
    expect(ctx.natives!["picture:point"]!(3, 4)).toEqual({ x: 3, y: 4 });
  });

  // The CTX-threading proof — the sample ctx-native re-enters the evaluator to
  // run the Field closure `solid` built, returning the constant color. Uses
  // ONLY pictureModule (solid's body `Field (\p -> c)` needs no std), so the
  // dispatch path — `evaluate` → ctx-native via `nativesCtx` → `invokeCallable`
  // → the closure — is exercised end-to-end through createRegistry.
  test("ctx native dispatches end-to-end: sample of a solid Picture re-enters the evaluator", () => {
    const reg2 = createRegistry([pictureModule]);
    const ctx = reg2.evaluateContext();
    const RED = { r: 255, g: 0, b: 0, a: 255 };
    const pic = evaluate({ call: ["solid", RED] }, {}, ctx);
    const pt = evaluate({ call: ["point", 5, 5] }, {}, ctx);
    expect(evaluate({ call: ["picture:sample", pic, pt] }, {}, ctx)).toEqual(RED);
    expect(evaluate({ call: ["picture.sample", pic, pt] }, {}, ctx)).toEqual(RED);
  });

  // render is the other ctx-native — prove it's callable with the ctx threaded
  // (Raster path needs no closure, so it isolates the ctx-arg contract).
  test("ctx native `render` rasterises a Raster Picture (ctx threaded as the leading arg)", () => {
    const ctx = reg.evaluateContext();
    const RED = { r: 255, g: 0, b: 0, a: 255 };
    const raster = { $tag: "Raster", _0: { width: 2, height: 2, pixels: [RED, RED, RED, RED] } };
    const img = ctx.nativesCtx!["picture:render"]!(ctx, raster, 2, 2) as {
      width: number;
      height: number;
      pixels: unknown[];
    };
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.pixels).toHaveLength(4);
    for (const px of img.pixels) expect(px).toEqual(RED);
  });
});
