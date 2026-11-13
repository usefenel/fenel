// ---------------------------------------------------------------------------
// module-migrate-crossmodal.test.ts — module-substrate Phase 3i parity proof.
//
// crossmodal is the WARM-UP of the non-media ctx BULK: 3 fns, a DISJOINT
// plain/ctx split (= picture's 3f shape), NO entities, NO own dispatch
// instances. This is a PARITY migration — the ~275-LOC hand-assembled
// `engine/src/modules/crossmodal.ts` (3 `defineFunction` specs + inline native
// impls + the two native maps) was replaced by `types.fenel` (declarative, now
// a `module crossmodal where` header + 3 `@native` foreign decls) +
// `ffi/crossmodal-ffi.ts` (the 3 native impls split into plain + ctx maps,
// importing the sibling media bases leaf-to-leaf) + a thin seam, with NOTHING
// dropped. The structural proof below asserts:
//   - all 3 functions resolve by id under the legacy `crossmodal:` prefix;
//   - all 3 native-backed functions are bodyless foreign declarations;
//   - the PLAIN native (_visualizeAt) lands in `nativeImpls`;
//   - the CTX natives (sonify / visualize) land in `nativeImplsCtx` — PRESENT +
//     id-keyed; the two maps DISJOINT (axis #4: seam routes, no marker);
//   - identity-facet parity (the 3 natives' rich Labelable/Describable/Taggable);
//   - the ctx native dispatches end-to-end through `createRegistry`.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { crossmodalModule } from "./modules/crossmodal";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `ctx: true` == the native lands in `nativeImplsCtx`; `ctx: false` == plain.
type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  sonify: {
    label: "Sonify",
    tags: ["crossmodal", "audio", "visual"],
    description:
      "Convert a Picture into a Sound by rasterising the picture and scanning its pixels at audio rate. Each pixel's luminance becomes an amplitude. Different images sound different — the result is the sonic image of the picture.",
    ctx: true,
  },
  visualize: {
    label: "Visualize",
    tags: ["crossmodal", "visual", "audio"],
    description:
      "Convert a Sound (a Buffer) into a Picture rendering its waveform. The result is a Field that lights up the cyan trace where the waveform passes through each (x, y) — a classic oscilloscope view.",
    ctx: true,
  },
  _visualizeAt: {
    label: "Visualize-at (internal)",
    tags: ["internal"],
    description: "Internal: per-pixel colour lookup for visualize's Field closure.",
    ctx: false,
  },
};

const ALL_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = ALL_NAMES.filter((n) => !NATIVES[n]!.ctx); // _visualizeAt
const CTX_NATIVES = ALL_NAMES.filter((n) => NATIVES[n]!.ctx); // sonify / visualize

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("crossmodal migration — header-driven identity", () => {
  test("the `module crossmodal where` header is authoritative (lowercase prefix preserved)", () => {
    expect(crossmodalModule.name).toBe("crossmodal");
  });

  test("all 3 functions registered under the legacy `crossmodal:` id-prefix", () => {
    expect((crossmodalModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `crossmodal:${n}`).sort(),
    );
  });

  test("crossmodal contributes NO entities (composer over the media types)", () => {
    expect((crossmodalModule.entities ?? []).length).toBe(0);
  });

  test("module label preserved", () => {
    expect(JSON.stringify(crossmodalModule.label)).toContain("Cross-modal");
  });
});

describe("crossmodal migration — the `ffi/` split + the BOTH-MAPS seam (axis #3)", () => {
  test("all 3 native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (crossmodalModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(ALL_NAMES.map((n) => `crossmodal:${n}`).sort());
  });

  test("nativeImpls (PLAIN map) holds exactly _visualizeAt, id-keyed", () => {
    expect(Object.keys(crossmodalModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `crossmodal:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sonify / visualize, id-keyed", () => {
    expect(crossmodalModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(crossmodalModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `crossmodal:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (no native in both — axis #4)", () => {
    const plain = new Set(Object.keys(crossmodalModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(crossmodalModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements (nativeImpls + nativeImplsCtx only)", () => {
    expect(crossmodalModule.ioHandlers).toBeUndefined();
    expect(crossmodalModule.credentialRequirements).toBeUndefined();
  });
});

describe("crossmodal migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = crossmodalModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `crossmodal:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): crossmodal declares no @category, so NONE
  // carry a stored Categorizable — the `crossmodal` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — crossmodal declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `crossmodal:${n}`)).toBeUndefined();
    }
  });

  test("Labelable + Describable + Taggable: present & byte-identical for the 3 natives", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `crossmodal:${n}`)).toEqual({ label: NATIVES[n]!.label });
      expect(methodOf(insts, "Describable", `crossmodal:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `crossmodal:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  // Phase 3j: Categorizable drops 3→0 (no @category). Labelable stays 3.
  test("identity-facet counts: 3 Codeable/Labelable/Describable/Taggable, 0 Categorizable (none @category), 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(3);
    expect(counts.Labelable).toBe(3);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(3);
    expect(counts.Taggable).toBe(3);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("crossmodal migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([crossmodalModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `crossmodal:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees crossmodal as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("crossmodal").sort()).toEqual([...ALL_NAMES].sort());
  });

  test("the registry context exposes BOTH native maps — plain via `natives`, ctx via `nativesCtx`", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`crossmodal:${n}`], `plain native present: crossmodal:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`crossmodal:${n}`], `ctx native present: crossmodal:${n}`).toBe("function");
    }
  });

  test("plain native _visualizeAt is directly callable (pure per-pixel lookup)", () => {
    const ctx = reg.evaluateContext();
    // cols=[0], w=4, h=4, p={x:0,y:2} → y == waveY (h/2 - 0) == 2 → cyan trace
    const out = ctx.natives!["crossmodal:_visualizeAt"]!([0], 4, 4, { x: 0, y: 2 });
    expect(out).toEqual({ r: 34, g: 211, b: 238, a: 255 });
  });

  // The CTX-threading proof — sonify re-enters the evaluator (via the picture
  // renderer) to rasterise the picture, then scans the pixels into an audio
  // buffer. A Raster picture needs no closure, so it isolates the ctx-arg
  // contract using ONLY crossmodalModule (the picture renderer is imported
  // directly by the leaf, not resolved through the registry).
  test("ctx native `sonify` dispatches end-to-end: a Raster picture → an AudioBuffer", () => {
    const reg2 = createRegistry([crossmodalModule]);
    const ctx = reg2.evaluateContext();
    const RED = { r: 255, g: 0, b: 0, a: 255 };
    const raster = { $tag: "Raster", _0: { width: 4, height: 4, pixels: new Array(16).fill(RED) } };
    const buf = evaluate({ call: ["sonify", raster, 0.01, 800] }, {}, ctx) as {
      sampleRate: number;
      channels: number;
      samples: unknown[];
    };
    expect(buf.sampleRate).toBe(800);
    expect(buf.channels).toBe(2);
    expect(Array.isArray(buf.samples)).toBe(true);
    expect(buf.samples.length).toBeGreaterThan(0);
  });

  // visualize is the other ctx-native — an empty-sample Sound yields a black
  // Field (no closure invocation needed), isolating the ctx-arg contract.
  test("ctx native `visualize` of an empty Sound returns a Field Picture", () => {
    const ctx = reg.evaluateContext();
    const emptySound = { $tag: "Buffer", _0: { sampleRate: 8000, channels: 1, samples: [] } };
    const pic = evaluate({ call: ["visualize", emptySound, 8, 8] }, {}, ctx) as { $tag?: string };
    expect(pic.$tag).toBe("Field");
  });
});
