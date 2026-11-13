// ---------------------------------------------------------------------------
// module-migrate-animation.test.ts — module-substrate Phase 3g parity proof.
//
// animation is a CTX-ONLY composer: NO plain native (`animNatives = {}`), only
// the two ctx natives (sampleAnim / renderAnim). The `ffi/` leaf imports
// `renderNative` from picture-ffi leaf-to-leaf (a previously-migrated base, 3f).
// It also CONSOLIDATES the `frameSequence` Fenel-bodied helper from the retired
// `frame-sequence.fenel` sidecar into `types.fenel` (recipe N6).
//
// PARITY migration — the hand-assembled `engine/src/modules/animation.ts` (2
// native ctx specs + 1 `.fenel`-bodied frameSequence spec + inline native impls
// + the source-module merge) was replaced by `types.fenel` (declarative,
// `module animation where` header + 2 `@native` foreign decls + the folded-in
// frameSequence) + `ffi/animation-ffi.ts` (2 ctx native impls + empty plain
// map) + a thin seam, with NOTHING dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { animationModule } from "./modules/animation";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// The 2 CTX natives (bodyless foreign decls).
type Expected = { label: string; tags: string[]; description: string };
const NATIVES: Record<string, Expected> = {
  sampleAnim: {
    label: "Sample animation",
    tags: ["video", "animation", "primitive"],
    description:
      "Sample an Animation at a Time, returning the Picture at that instant. Bridge primitive — every higher-level Animation operation reduces to this.",
  },
  renderAnim: {
    label: "Render animation",
    tags: ["video", "animation", "primitive"],
    description: "Rasterise an Animation into a FrameSequence at the given fps and resolution over `duration` seconds.",
  },
};

// frameSequence is a Fenel-BODIED helper (NOT a native) with rich identity
// (video category, explicit label/description/tags) — folded in from the sidecar.
const FRAME_SEQUENCE = {
  label: "Frame sequence",
  tags: ["video", "animation", "constructor"],
  description:
    'Build a FrameSequence from fps and a list of pre-rendered Image frames. Returns the canonical typed `{$tag: "FrameSequence", fps, frames}` shape via the FrameSequence constructor.',
  category: "video",
};

// The 4 closure helpers — auto-derived identity, `animation` category default.
const CLOSURE_HELPERS = ["freeze", "overAnim", "delayAnim", "speedAnim"];

const NATIVE_NAMES = Object.keys(NATIVES); // both ctx
const BODIED_NAMES = ["frameSequence", ...CLOSURE_HELPERS];
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("animation migration — header-driven identity", () => {
  test("the `module animation where` header is authoritative", () => {
    expect(animationModule.name).toBe("animation");
  });

  test("all 7 functions registered under the legacy `animation:` id-prefix", () => {
    expect((animationModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `animation:${n}`).sort(),
    );
  });

  test("the 2 entities (Animation / FrameSequence) ride along from the `.fenel`", () => {
    expect((animationModule.entities ?? []).map((e) => e.id).sort()).toEqual(
      ["Animation", "FrameSequence"],
    );
  });
});

describe("animation migration — the `ffi/` split (CTX-ONLY: empty plain map)", () => {
  test("exactly the 2 ctx natives are BODYLESS foreign declarations", () => {
    const bodyless = (animationModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `animation:${n}`).sort());
  });

  test("every Fenel-bodied helper carries its `.fenel` body (frameSequence + 4 closure helpers)", () => {
    for (const n of BODIED_NAMES) {
      const f = (animationModule.functions ?? []).find((f) => f.id === `animation:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) is EMPTY — animation has no plain native", () => {
    expect(Object.keys(animationModule.nativeImpls ?? {})).toEqual([]);
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sampleAnim / renderAnim, id-keyed", () => {
    expect(animationModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(animationModule.nativeImplsCtx ?? {}).sort()).toEqual(
      NATIVE_NAMES.map((n) => `animation:${n}`).sort(),
    );
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(animationModule.ioHandlers).toBeUndefined();
    expect(animationModule.credentialRequirements).toBeUndefined();
  });
});

describe("animation migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = animationModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `animation:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): natives + frameSequence keep their explicit
  // @category 'video'; the 4 closure helpers had only the header-default
  // 'animation' (no @category), so they now carry NO stored Categorizable — the
  // `animation` category derives at read time (displayCategory → module-prefix).
  test("Categorizable: natives + frameSequence 'video' (explicit); closure helpers carry NONE (no @category)", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Categorizable", `animation:${n}`)).toEqual({ category: "video" });
    }
    expect(methodOf(insts, "Categorizable", "animation:frameSequence")).toEqual({ category: "video" });
    for (const n of CLOSURE_HELPERS) {
      expect(methodOf(insts, "Categorizable", `animation:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for the 2 natives + frameSequence", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `animation:${n}`)).toEqual({ label: NATIVES[n]!.label });
    }
    expect(methodOf(insts, "Labelable", "animation:frameSequence")).toEqual({ label: FRAME_SEQUENCE.label });
  });

  test("Describable + Taggable: present & byte-identical for the 2 natives + frameSequence", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Describable", `animation:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `animation:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
    expect(methodOf(insts, "Describable", "animation:frameSequence")).toEqual({ description: FRAME_SEQUENCE.description });
    expect(methodOf(insts, "Taggable", "animation:frameSequence")).toEqual({ tags: FRAME_SEQUENCE.tags });
  });

  test("the 4 closure helpers carry NO Describable / Taggable", () => {
    for (const n of CLOSURE_HELPERS) {
      expect(methodOf(insts, "Describable", `animation:${n}`)).toBeUndefined();
      expect(methodOf(insts, "Taggable", `animation:${n}`)).toBeUndefined();
    }
  });

  // Phase 3j: Labelable + Categorizable both drop 7→3 (only the 2 natives +
  // frameSequence carry explicit @label/@category; the 4 closure helpers relied
  // on the auto-defaults, now read-time).
  test("identity-facet counts: 7 Codeable, 3 Labelable/Categorizable (natives + frameSequence), 3 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(7);
    expect(counts.Labelable).toBe(3);
    expect(counts.Categorizable).toBe(3);
    expect(counts.Describable).toBe(3);
    expect(counts.Taggable).toBe(3);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("animation migration — Sampleable / Renderable dispatch instances ride the seam", () => {
  const insts = animationModule.instances ?? [];

  test("Sampleable<Animation> → animation:sampleAnim, Renderable<Animation> → animation:renderAnim", () => {
    const find = (cn: string) => insts.find((i) => i.typeName === cn && i.args[0] === "Animation");
    // typed-function-references Phase 10c — these instances are now `.fenel`-
    // authored (fenel/modules/animation/instances.fenel), so the point-free method
    // ref lowers to a CODENAME handle `{$ref:"sampleAnim"}` (not the fnId handle
    // the TS const carried). The registry's sample/render table resolves it
    // id-or-codeName to the canonical `animation:sampleAnim` — dispatch unchanged.
    expect(find("Sampleable")?.methods).toEqual({ sample: { $ref: "sampleAnim" } });
    expect(find("Renderable")?.methods).toEqual({ render: { $ref: "renderAnim" } });
  });
});

describe("animation migration — resolution + callability through createRegistry", () => {
  const reg = createRegistry([animationModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `animation:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes ONLY the ctx native map (plain map empty)", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx.nativesCtx?.["animation:sampleAnim"]).toBe("function");
    expect(typeof ctx.nativesCtx?.["animation:renderAnim"]).toBe("function");
    expect(ctx.natives?.["animation:sampleAnim"]).toBeUndefined();
  });

  test("frameSequence bodied helper builds the canonical tagged FrameSequence record", () => {
    const ctx = reg.evaluateContext();
    expect(evaluate({ call: ["frameSequence", 24, []] }, {}, ctx)).toEqual({
      $tag: "FrameSequence",
      fps: 24,
      frames: [],
    });
  });

  // The CTX-threading proof — the sampleAnim ctx-native re-enters the evaluator
  // to run an Animate closure returning the carried Picture.
  test("ctx native dispatches end-to-end: sampleAnim of an Animate re-enters the evaluator", () => {
    const reg2 = createRegistry([animationModule]);
    const ctx = reg2.evaluateContext();
    const PIC = { $tag: "Raster", _0: { width: 1, height: 1, pixels: [] } };
    const anim = {
      $tag: "Animate",
      _0: { __fenelFn: true, params: ["t"], body: { var: "_pic" }, closure: { _pic: PIC } },
    };
    expect(evaluate({ call: ["sampleAnim", anim, { seconds: 0 }] }, {}, ctx)).toEqual(PIC);
  });

  // renderAnim re-enters picture-ffi's renderNative (imported leaf-to-leaf) to
  // rasterise each frame's Picture.
  test("ctx native `renderAnim` rasterises a Frames Animation via picture-ffi's render (leaf-to-leaf)", () => {
    const ctx = reg.evaluateContext();
    const frame = { width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] };
    const frames = { $tag: "Frames", _0: { fps: 1, frames: [frame] } };
    const out = ctx.nativesCtx!["animation:renderAnim"]!(ctx, frames, 1, 1, 1, 1) as {
      fps: number;
      frames: unknown[];
    };
    expect(out.fps).toBe(1);
    expect(out.frames).toHaveLength(1);
  });
});
