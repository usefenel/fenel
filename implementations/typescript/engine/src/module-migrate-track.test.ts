// ---------------------------------------------------------------------------
// module-migrate-track.test.ts — module-substrate Phase 3g parity proof.
//
// track is a CTX-ONLY composer (2 ctx natives, empty plain map) that ALSO
// consolidates its 2 Fenel-bodied record constructors (`track` / `trackEntry`)
// from the retired `track.fenel` / `track-entry.fenel` sidecars into
// `types.fenel` (recipe N6). Its `ffi/` leaf imports `sampleSoundNative` from
// sound-ffi leaf-to-leaf (a same-phase base, 3g).
//
// PARITY migration — the hand-assembled `engine/src/modules/track.ts` (2 native
// ctx specs + 2 `.fenel`-bodied constructor specs + inline native impls + the
// source-module merge) was replaced by `types.fenel` (declarative, `module
// track where` header + 2 `@native` foreign decls + the folded-in
// track/trackEntry) + `ffi/track-ffi.ts` (2 ctx native impls + empty plain map)
// + a thin seam, with NOTHING dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { trackModule } from "./modules/track";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

// The 2 CTX natives (bodyless foreign decls).
type Expected = { label: string; tags: string[]; description: string };
const NATIVES: Record<string, Expected> = {
  sampleTrackAt: {
    label: "Sample track at time",
    tags: ["audio", "track", "primitive"],
    description: "Sum the amplitudes of every Track entry at the given time (each shifted by its start time). Clamped to [-1, 1].",
  },
  mixDown: {
    label: "Mix down",
    tags: ["audio", "track"],
    description: "Collapse a Track into a single Sound by summing every entry's per-time amplitude.",
  },
};

// The 2 Fenel-BODIED record constructors (folded in from the sidecars) — rich
// identity, `audio` category.
const BODIED: Record<string, Expected> = {
  track: {
    label: "Track",
    tags: ["audio", "track", "constructor"],
    description:
      'Build a Track from a list of TrackEntry values. Returns the canonical typed `{$tag: "Track", entries: [...]}` shape via the Track constructor.',
  },
  trackEntry: {
    label: "Track entry",
    tags: ["audio", "track", "constructor"],
    description:
      'Build a TrackEntry from a start time (seconds) and a Sound. Returns the canonical typed `{$tag: "TrackEntry", start, sound}` shape via the TrackEntry constructor.',
  },
};

const NATIVE_NAMES = Object.keys(NATIVES);
const BODIED_NAMES = Object.keys(BODIED);
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("track migration — header-driven identity", () => {
  test("the `module track where` header is authoritative", () => {
    expect(trackModule.name).toBe("track");
  });

  test("all 4 functions registered under the legacy `track:` id-prefix", () => {
    expect((trackModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `track:${n}`).sort(),
    );
  });

  test("the 2 entities (TrackEntry / Track) ride along from the `.fenel`", () => {
    expect((trackModule.entities ?? []).map((e) => e.id).sort()).toEqual(["Track", "TrackEntry"]);
  });
});

describe("track migration — the `ffi/` split (CTX-ONLY: empty plain map)", () => {
  test("exactly the 2 ctx natives are BODYLESS foreign declarations", () => {
    const bodyless = (trackModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `track:${n}`).sort());
  });

  test("the 2 consolidated constructors carry their `.fenel` bodies", () => {
    for (const n of BODIED_NAMES) {
      const f = (trackModule.functions ?? []).find((f) => f.id === `track:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) is EMPTY — track has no plain native", () => {
    expect(Object.keys(trackModule.nativeImpls ?? {})).toEqual([]);
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sampleTrackAt / mixDown, id-keyed", () => {
    expect(trackModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(trackModule.nativeImplsCtx ?? {}).sort()).toEqual(
      NATIVE_NAMES.map((n) => `track:${n}`).sort(),
    );
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(trackModule.ioHandlers).toBeUndefined();
    expect(trackModule.credentialRequirements).toBeUndefined();
  });
});

describe("track migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = trackModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `track:${n}`)).toEqual({ codeName: n });
    }
  });

  test("Categorizable: every function categorized 'audio' (explicit @category)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `track:${n}`)).toEqual({ category: "audio" });
    }
  });

  test("Labelable / Describable / Taggable: byte-identical for natives + constructors", () => {
    const all = { ...NATIVES, ...BODIED };
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `track:${n}`)).toEqual({ label: all[n]!.label });
      expect(methodOf(insts, "Describable", `track:${n}`)).toEqual({ description: all[n]!.description });
      expect(methodOf(insts, "Taggable", `track:${n}`)).toEqual({ tags: all[n]!.tags });
    }
  });

  test("identity-facet counts: 4 Codeable/Labelable/Categorizable/Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(4);
    expect(counts.Labelable).toBe(4);
    expect(counts.Categorizable).toBe(4);
    expect(counts.Describable).toBe(4);
    expect(counts.Taggable).toBe(4);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });

  test("track carries NO own Sampleable/Renderable dispatch instances", () => {
    expect(insts.find((i) => i.typeName === "Sampleable")).toBeUndefined();
    expect(insts.find((i) => i.typeName === "Renderable")).toBeUndefined();
  });
});

describe("track migration — resolution + callability through createRegistry", () => {
  const reg = createRegistry([trackModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `track:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes ONLY the ctx native map (plain map empty)", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx.nativesCtx?.["track:sampleTrackAt"]).toBe("function");
    expect(typeof ctx.nativesCtx?.["track:mixDown"]).toBe("function");
    expect(ctx.natives?.["track:sampleTrackAt"]).toBeUndefined();
  });

  test("consolidated constructors build canonical tagged Track / TrackEntry records", () => {
    const ctx = reg.evaluateContext();
    expect(evaluate({ call: ["track", []] }, {}, ctx)).toEqual({ $tag: "Track", entries: [] });
    expect(evaluate({ call: ["trackEntry", 0, { $tag: "Wave" }] }, {}, ctx)).toEqual({
      $tag: "TrackEntry",
      start: 0,
      sound: { $tag: "Wave" },
    });
  });

  // The CTX-threading proof — sampleTrackAt sums each entry's Sound at the given
  // time, re-entering the evaluator via sampleSound (imported leaf-to-leaf from
  // sound-ffi). Self-contained: the entry Wave's closure returns a constant amp.
  test("ctx native dispatches end-to-end: sampleTrackAt sums entry Sounds via sound-ffi (leaf-to-leaf)", () => {
    const ctx = reg.evaluateContext();
    const wave = {
      $tag: "Wave",
      _0: { __fenelFn: true, params: ["t"], body: { var: "_a" }, closure: { _a: { l: 0.5, r: 0.5 } } },
    };
    const track = { entries: [{ start: 0, sound: wave }] };
    expect(ctx.nativesCtx!["track:sampleTrackAt"]!(ctx, track, { seconds: 0 })).toEqual({ l: 0.5, r: 0.5 });
  });

  test("ctx native `mixDown` collapses a Track into a Wave Sound", () => {
    const ctx = reg.evaluateContext();
    const track = { entries: [] };
    const sound = ctx.nativesCtx!["track:mixDown"]!(ctx, track) as { $tag: string };
    expect(sound.$tag).toBe("Wave");
  });
});
