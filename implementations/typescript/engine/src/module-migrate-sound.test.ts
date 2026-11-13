// ---------------------------------------------------------------------------
// module-migrate-sound.test.ts — module-substrate Phase 3g parity proof.
//
// sound is the SECOND both-maps BASE (after picture, the 3f representative
// ctx-native). It confirms the ctx-native recipe generalises to a second base
// AND establishes the `sound/ffi/sound-ffi.ts` leaf the media composers
// (track / games / movie) import leaf-to-leaf.
//
// This is a PARITY migration — the ~386-LOC hand-assembled
// `engine/src/modules/sound.ts` (8 `defineFunction` specs + inline native
// impls + the source-module merge) was replaced by `types.fenel` (declarative,
// now with a `module sound where` header + 8 `@native` foreign decls) +
// `ffi/sound-ffi.ts` (the 8 native impls split into plain + ctx maps) + a thin
// seam, with NOTHING dropped. The structural proof below asserts:
//   - all 24 functions resolve by id under the legacy `sound:` prefix;
//   - the 8 native-backed functions are bodyless foreign declarations, the 16
//     Fenel-bodied helpers keep their bodies;
//   - the 6 PLAIN natives land in `nativeImpls`;
//   - the 2 CTX natives (sampleSound / renderSound) land in `nativeImplsCtx` —
//     PRESENT + id-keyed;
//   - identity-facet parity (the 8 natives' rich Labelable/Describable/Taggable,
//     the `audio` category vs. the bodied helpers' `sound` category default);
//   - the Sampleable / Renderable dispatch instances ride the seam;
//   - the ctx native dispatches end-to-end through `createRegistry`, re-entering
//     the evaluator to run a `Wave` closure.
// The sample/render round-trip + the closure math are covered more broadly by
// sound.test.ts (kept green by this migration).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { soundModule } from "./modules/sound";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `ctx: true` == the native lands in `nativeImplsCtx` (re-enters the
// evaluator); `ctx: false` == plain `nativeImpls`. Every native carries the
// `audio` category.
type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  sampleSound: {
    label: "Sample sound",
    tags: ["audio", "primitive"],
    description:
      "Sample a Sound at a Time, returning a stereo Amplitude. The bridge primitive — every higher-level Sound operation reduces to this.",
    ctx: true,
  },
  renderSound: {
    label: "Render sound",
    tags: ["audio", "primitive"],
    description: "Rasterise a Sound into an AudioBuffer over `duration` seconds at `sampleRate` Hz.",
    ctx: true,
  },
  time: {
    label: "Time",
    tags: ["audio", "constructor"],
    description: "Build a Time record from a number of seconds.",
    ctx: false,
  },
  amplitude: {
    label: "Amplitude",
    tags: ["audio", "constructor"],
    description: "Build a stereo Amplitude from left and right channel values (clamped to [-1, 1]).",
    ctx: false,
  },
  mono: {
    label: "Mono",
    tags: ["audio", "constructor"],
    description: "Build a mono Amplitude (left == right).",
    ctx: false,
  },
  ampL: {
    label: "Left channel",
    tags: ["audio", "accessor"],
    description: "Extract the left channel of an Amplitude.",
    ctx: false,
  },
  ampR: {
    label: "Right channel",
    tags: ["audio", "accessor"],
    description: "Extract the right channel of an Amplitude.",
    ctx: false,
  },
  audioBuffer: {
    label: "Audio buffer",
    tags: ["audio", "constructor"],
    description: "Build an AudioBuffer from sample rate, channel count, and PCM samples.",
    ctx: false,
  },
};

// The 16 Fenel-bodied helpers (already `.fenel` since ts-elimination 4g) — no
// explicit @label/@description/@tags; identity is auto-derived (humanized
// Labelable + module Categorizable ("sound") + Codeable).
const BODIED_NAMES = [
  "sineAt", "sawAt", "squareAt",
  "sine", "sawtooth", "square",
  "scaleAmp", "addAmp",
  "gain", "mix", "delay", "pitch",
  "midiToFreq", "note", "bound", "plucked",
];

const NATIVE_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = NATIVE_NAMES.filter((n) => !NATIVES[n]!.ctx);
const CTX_NATIVES = NATIVE_NAMES.filter((n) => NATIVES[n]!.ctx);
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("sound migration — header-driven identity", () => {
  test("the `module sound where` header is authoritative (lowercase prefix preserved)", () => {
    expect(soundModule.name).toBe("sound");
  });

  test("all 24 functions registered under the legacy `sound:` id-prefix", () => {
    expect((soundModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `sound:${n}`).sort(),
    );
  });

  test("the 2 entities (Sound / Time) ride along from the `.fenel`", () => {
    expect((soundModule.entities ?? []).map((e) => e.id).sort()).toEqual(["Sound", "Time"]);
  });

  test("module label preserved", () => {
    expect(JSON.stringify(soundModule.label)).toContain("Sound");
  });
});

describe("sound migration — the `ffi/` split + the BOTH-MAPS seam", () => {
  test("exactly the 8 native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (soundModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `sound:${n}`).sort());
  });

  test("every Fenel-bodied helper carries its `.fenel` body (16 helpers)", () => {
    for (const n of BODIED_NAMES) {
      const f = (soundModule.functions ?? []).find((f) => f.id === `sound:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) holds exactly the 6 plain natives, id-keyed", () => {
    expect(Object.keys(soundModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `sound:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sampleSound / renderSound, id-keyed", () => {
    expect(soundModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(soundModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `sound:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (no native in both — seam routes, no marker)", () => {
    const plain = new Set(Object.keys(soundModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(soundModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements (sound is nativeImpls + nativeImplsCtx only)", () => {
    expect(soundModule.ioHandlers).toBeUndefined();
    expect(soundModule.credentialRequirements).toBeUndefined();
  });
});

describe("sound migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = soundModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `sound:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): the 8 natives keep their explicit @category
  // 'audio'; the 16 bodied helpers had only the header-default 'sound' (no
  // @category), so they now carry NO stored Categorizable — the `sound` category
  // derives at read time (displayCategory → module-prefix).
  test("Categorizable: natives 'audio' (explicit); bodied helpers carry NONE (no @category)", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Categorizable", `sound:${n}`)).toEqual({ category: "audio" });
    }
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Categorizable", `sound:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for the 8 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `sound:${n}`)).toEqual({ label: NATIVES[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for the 8 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Describable", `sound:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `sound:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("the 16 bodied helpers carry NO Describable / Taggable (auto-derived identity only)", () => {
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Describable", `sound:${n}`)).toBeUndefined();
      expect(methodOf(insts, "Taggable", `sound:${n}`)).toBeUndefined();
    }
  });

  // Phase 3j: Labelable + Categorizable both drop 24→8 (only the 8 natives carry
  // explicit @label/@category; the 16 bodied helpers relied on the auto-defaults,
  // now read-time).
  test("identity-facet counts: 24 Codeable, 8 Labelable/Categorizable (the 8 natives), 8 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(24);
    expect(counts.Labelable).toBe(8);
    expect(counts.Categorizable).toBe(8);
    expect(counts.Describable).toBe(8);
    expect(counts.Taggable).toBe(8);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("sound migration — Sampleable / Renderable dispatch instances ride the seam", () => {
  const insts = soundModule.instances ?? [];

  test("Sampleable<Sound> → sound:sampleSound, Renderable<Sound> → sound:renderSound", () => {
    const find = (cn: string) => insts.find((i) => i.typeName === cn && i.args[0] === "Sound");
    // typed-function-references Phase 10c — `.fenel`-authored
    // (fenel/modules/sound/instances.fenel): the point-free method ref lowers to a
    // CODENAME handle, which the sample/render table resolves id-or-codeName to
    // the canonical `sound:sampleSound` / `sound:renderSound` (dispatch unchanged).
    expect(find("Sampleable")?.methods).toEqual({ sample: { $ref: "sampleSound" } });
    expect(find("Renderable")?.methods).toEqual({ render: { $ref: "renderSound" } });
  });
});

describe("sound migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([soundModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `sound:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("listModuleMembers sees sound as a Module (view over the id namespace)", () => {
    expect(reg.listModuleMembers("sound").sort()).toEqual([...ALL_NAMES].sort());
  });

  test("the registry context exposes BOTH native maps — plain via `natives`, ctx via `nativesCtx`", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`sound:${n}`], `plain native present: sound:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`sound:${n}`], `ctx native present: sound:${n}`).toBe("function");
    }
  });

  test("plain natives are directly callable + build the runtime representation records", () => {
    const ctx = reg.evaluateContext();
    expect(ctx.natives!["sound:amplitude"]!(0.5, -0.5)).toEqual({ l: 0.5, r: -0.5 });
    expect(ctx.natives!["sound:time"]!(2)).toEqual({ seconds: 2 });
    expect(ctx.natives!["sound:mono"]!(0.25)).toEqual({ l: 0.25, r: 0.25 });
  });

  // The CTX-threading proof — the sampleSound ctx-native re-enters the evaluator
  // to run a Wave closure (whose body calls the plain `amplitude` native),
  // returning the constant amplitude. Uses ONLY soundModule, so the dispatch
  // path — `evaluate` → ctx-native via `nativesCtx` → `invokeCallable` → the
  // closure → plain native — is exercised end-to-end through createRegistry.
  test("ctx native dispatches end-to-end: sampleSound of a Wave re-enters the evaluator", () => {
    const reg2 = createRegistry([soundModule]);
    const ctx = reg2.evaluateContext();
    const wave = {
      $tag: "Wave",
      _0: { __fenelFn: true, params: ["t"], body: { call: ["amplitude", 0.5, 0.5] }, closure: {} },
    };
    const t = evaluate({ call: ["time", 1] }, {}, ctx);
    expect(evaluate({ call: ["sampleSound", wave, t] }, {}, ctx)).toEqual({ l: 0.5, r: 0.5 });
  });

  // renderSound is the other ctx-native — prove it's callable with the ctx
  // threaded (Buffer path needs no closure, so it isolates the ctx-arg contract).
  test("ctx native `renderSound` materialises a Buffer Sound (ctx threaded as the leading arg)", () => {
    const ctx = reg.evaluateContext();
    const buf = {
      $tag: "Buffer",
      _0: { sampleRate: 2, channels: 2, samples: [{ l: 1, r: 1 }, { l: 0, r: 0 }] },
    };
    const out = ctx.nativesCtx!["sound:renderSound"]!(ctx, buf, 1, 2) as {
      sampleRate: number;
      channels: number;
      samples: unknown[];
    };
    expect(out.sampleRate).toBe(2);
    expect(out.channels).toBe(2);
    expect(out.samples).toEqual([{ l: 1, r: 1 }, { l: 0, r: 0 }]);
  });
});
