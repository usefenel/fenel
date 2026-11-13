// ---------------------------------------------------------------------------
// module-migrate-movie.test.ts — module-substrate Phase 3g parity proof.
//
// movie is the RICHEST COMPOSER: its `ffi/` leaf imports `renderNative` from
// picture-ffi (a previously-migrated base, 3f) AND the `Amplitude`/`AudioBuffer`
// value types from sound-ffi (a same-phase base, 3g) — leaf-to-leaf. This test
// banks the cross-module ffi-leaf import wrinkle.
//
// PARITY migration — the hand-assembled `engine/src/modules/movie.ts` (3
// `defineFunction` specs + inline native impls + the source-module merge) was
// replaced by `types.fenel` (declarative, `module movie where` header + 3
// `@native` foreign decls) + `ffi/movie-ffi.ts` (the 3 native impls split into
// plain + ctx maps) + a thin seam, with NOTHING dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { movieModule } from "./modules/movie";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  sampleMovie: {
    label: "Sample movie",
    tags: ["video", "audio", "primitive"],
    description: "Sample a Movie at a Time, returning the Scene (Picture + Amplitude) at that instant.",
    ctx: true,
  },
  renderMovie: {
    label: "Render movie",
    tags: ["video", "audio", "primitive"],
    description:
      "Rasterise a Movie into synchronised video frames + audio. Walks the timeline at fps for video and sampleRate for audio over `duration` seconds.",
    ctx: true,
  },
  scene: {
    label: "Scene",
    tags: ["video", "audio", "constructor"],
    description: "Build a Scene record from a Picture and an Amplitude.",
    ctx: false,
  },
};

// The 2 Fenel-bodied helpers (already `.fenel` since ts-elimination 4g).
const BODIED_NAMES = ["withAudio", "silentMovie"];

const NATIVE_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = NATIVE_NAMES.filter((n) => !NATIVES[n]!.ctx); // scene
const CTX_NATIVES = NATIVE_NAMES.filter((n) => NATIVES[n]!.ctx); // sampleMovie / renderMovie
const ALL_NAMES = [...NATIVE_NAMES, ...BODIED_NAMES];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("movie migration — header-driven identity", () => {
  test("the `module movie where` header is authoritative (lowercase prefix preserved)", () => {
    expect(movieModule.name).toBe("movie");
  });

  test("all 5 functions registered under the legacy `movie:` id-prefix", () => {
    expect((movieModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `movie:${n}`).sort(),
    );
  });

  test("the 3 entities (Movie / Scene / RecordedMovie) ride along from the `.fenel`", () => {
    expect((movieModule.entities ?? []).map((e) => e.id).sort()).toEqual(
      ["Movie", "RecordedMovie", "Scene"],
    );
  });

  test("module label preserved", () => {
    expect(JSON.stringify(movieModule.label)).toContain("Movie");
  });
});

describe("movie migration — the `ffi/` split + the BOTH-MAPS seam", () => {
  test("exactly the 3 native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (movieModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `movie:${n}`).sort());
  });

  test("every Fenel-bodied helper carries its `.fenel` body (2 helpers)", () => {
    for (const n of BODIED_NAMES) {
      const f = (movieModule.functions ?? []).find((f) => f.id === `movie:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (PLAIN map) holds exactly scene, id-keyed", () => {
    expect(Object.keys(movieModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `movie:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly sampleMovie / renderMovie, id-keyed", () => {
    expect(movieModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(movieModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `movie:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (seam routes, no marker)", () => {
    const plain = new Set(Object.keys(movieModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(movieModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(movieModule.ioHandlers).toBeUndefined();
    expect(movieModule.credentialRequirements).toBeUndefined();
  });
});

describe("movie migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = movieModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `movie:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): the 3 natives keep their explicit @category
  // 'video'; the 2 bodied helpers had only the header-default 'movie' (no
  // @category), so they now carry NO stored Categorizable — the `movie` category
  // derives at read time (displayCategory → module-prefix).
  test("Categorizable: natives 'video' (explicit); bodied helpers carry NONE (no @category)", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Categorizable", `movie:${n}`)).toEqual({ category: "video" });
    }
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Categorizable", `movie:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for the 3 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Labelable", `movie:${n}`)).toEqual({ label: NATIVES[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for the 3 natives", () => {
    for (const n of NATIVE_NAMES) {
      expect(methodOf(insts, "Describable", `movie:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `movie:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  test("the 2 bodied helpers carry NO Describable / Taggable", () => {
    for (const n of BODIED_NAMES) {
      expect(methodOf(insts, "Describable", `movie:${n}`)).toBeUndefined();
      expect(methodOf(insts, "Taggable", `movie:${n}`)).toBeUndefined();
    }
  });

  // Phase 3j: Labelable + Categorizable both drop 5→3 (only the 3 natives carry
  // explicit @label/@category; the 2 bodied helpers relied on the auto-defaults,
  // now read-time).
  test("identity-facet counts: 5 Codeable, 3 Labelable/Categorizable (the 3 natives), 3 Describable/Taggable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(5);
    expect(counts.Labelable).toBe(3);
    expect(counts.Categorizable).toBe(3);
    expect(counts.Describable).toBe(3);
    expect(counts.Taggable).toBe(3);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("movie migration — Sampleable / Renderable dispatch instances ride the seam", () => {
  const insts = movieModule.instances ?? [];

  test("Sampleable<Movie> → movie:sampleMovie, Renderable<Movie> → movie:renderMovie", () => {
    const find = (cn: string) => insts.find((i) => i.typeName === cn && i.args[0] === "Movie");
    // typed-function-references Phase 10c — `.fenel`-authored
    // (fenel/modules/movie/instances.fenel): the point-free method ref lowers to a
    // CODENAME handle, which the sample/render table resolves id-or-codeName to
    // the canonical `movie:sampleMovie` / `movie:renderMovie` (dispatch unchanged).
    expect(find("Sampleable")?.methods).toEqual({ sample: { $ref: "sampleMovie" } });
    expect(find("Renderable")?.methods).toEqual({ render: { $ref: "renderMovie" } });
  });
});

describe("movie migration — resolution + cross-module-ffi callability through createRegistry", () => {
  const reg = createRegistry([movieModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `movie:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes BOTH native maps", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx.natives?.["movie:scene"]).toBe("function");
    expect(typeof ctx.nativesCtx?.["movie:sampleMovie"]).toBe("function");
    expect(typeof ctx.nativesCtx?.["movie:renderMovie"]).toBe("function");
  });

  test("plain native `scene` builds the Scene representation record", () => {
    const ctx = reg.evaluateContext();
    const aud = { l: 0.5, r: 0.5 };
    const vis = { $tag: "Raster", _0: { width: 1, height: 1, pixels: [] } };
    expect(ctx.natives!["movie:scene"]!(vis, aud)).toEqual({ visual: vis, audio: aud });
  });

  // The CTX-threading proof — the sampleMovie ctx-native re-enters the evaluator
  // to run a MovieAt closure (whose body calls the plain `scene` native).
  test("ctx native dispatches end-to-end: sampleMovie of a MovieAt re-enters the evaluator", () => {
    const reg2 = createRegistry([movieModule]);
    const ctx = reg2.evaluateContext();
    const AUD = { l: 0.5, r: 0.5 };
    const VIS = { $tag: "Raster", _0: { width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] } };
    const movieAt = {
      $tag: "MovieAt",
      _0: {
        __fenelFn: true,
        params: ["t"],
        body: { call: ["scene", { var: "_vis" }, { var: "_aud" }] },
        closure: { _vis: VIS, _aud: AUD },
      },
    };
    const result = evaluate({ call: ["sampleMovie", movieAt, { seconds: 0 }] }, {}, ctx) as {
      visual: unknown;
      audio: unknown;
    };
    expect(result.audio).toEqual(AUD);
    expect(result.visual).toEqual(VIS);
  });

  // renderMovie is the cross-module-ffi proof — it re-enters picture-ffi's
  // renderNative (imported leaf-to-leaf) to rasterise each Scene's visual.
  test("ctx native `renderMovie` rasterises a Recorded Movie via picture-ffi's render (leaf-to-leaf)", () => {
    const ctx = reg.evaluateContext();
    const AUD = { l: 0.5, r: 0.5 };
    const frame = { width: 1, height: 1, pixels: [{ r: 255, g: 0, b: 0, a: 255 }] };
    const recorded = {
      $tag: "Recorded",
      _0: {
        fps: 1,
        width: 1,
        height: 1,
        frames: [frame],
        audio: { sampleRate: 1, channels: 2, samples: [AUD] },
      },
    };
    const out = ctx.nativesCtx!["movie:renderMovie"]!(ctx, recorded, 1, 1, 1, 1, 1) as {
      fps: number;
      width: number;
      height: number;
      frames: unknown[];
      audio: { samples: unknown[] };
    };
    expect(out.fps).toBe(1);
    expect(out.frames).toHaveLength(1);
    expect(out.audio.samples).toEqual([AUD]);
  });
});
