// ---------------------------------------------------------------------------
// module-migrate-games.test.ts — module-substrate Phase 3g parity proof.
//
// games packages interactivity over the signal foundation. Its `ffi/` leaf
// imports `sampleSoundNative` from sound-ffi leaf-to-leaf (a same-phase base,
// 3g). It is the all-natives module (1 plain + 5 ctx, 0 Fenel bodies) with NO
// own Sampleable/Renderable dispatch instances.
//
// PARITY migration — the hand-assembled `engine/src/modules/games.ts` (6
// `defineFunction` specs + inline native impls + the source-module merge) was
// replaced by `types.fenel` (declarative, `module games where` header + 6
// `@native` foreign decls) + `ffi/games-ffi.ts` (the 6 native impls split into
// plain + ctx maps) + a thin seam, with NOTHING dropped.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { gamesModule } from "./modules/games";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  mkGame: {
    label: "Make game",
    tags: ["games", "interactive", "constructor"],
    description: "Build a Game from initial state, update function, view function, and an input Event stream.",
    ctx: false,
  },
  gameStateAt: {
    label: "Game state at time",
    tags: ["games", "primitive"],
    description: "Compute a Game's state at a given Time by folding all inputs ≤ t through the update function.",
    ctx: true,
  },
  _gameViewAt: {
    label: "Game view at time (internal)",
    tags: ["games", "internal"],
    description: "Internal: state at t → render via view fn. Used by gameToAnim/gameToMovie closures.",
    ctx: true,
  },
  gameToAnim: {
    label: "Game to Animation",
    tags: ["games", "bridge"],
    description:
      "Convert a Game into an Animation: at each instant, derive the current state from the input stream and render it via the Game's view function.",
    ctx: true,
  },
  gameToMovie: {
    label: "Game to Movie",
    tags: ["games", "bridge"],
    description: "Convert a Game + Sound into a Movie. Visuals derive from the game; audio plays in sync.",
    ctx: true,
  },
  runGame: {
    label: "Run game (live)",
    tags: ["games", "io", "interactive"],
    description:
      "IO bridge: hand a Game off to the live runtime. The frontend recognises the result and renders an interactive surface where DOM events (clicks, keys) feed into the Game's input stream in real time. Calling from headless contexts returns a marker that downstream consumers can treat as a deterministic Movie.",
    ctx: true,
  },
};

const ALL_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = ALL_NAMES.filter((n) => !NATIVES[n]!.ctx); // mkGame
const CTX_NATIVES = ALL_NAMES.filter((n) => NATIVES[n]!.ctx);

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("games migration — header-driven identity", () => {
  test("the `module games where` header is authoritative", () => {
    expect(gamesModule.name).toBe("games");
  });

  test("all 6 functions registered under the legacy `games:` id-prefix (incl. _gameViewAt)", () => {
    expect((gamesModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `games:${n}`).sort(),
    );
  });

  test("the 1 entity (Game) rides along from the `.fenel`", () => {
    expect((gamesModule.entities ?? []).map((e) => e.id).sort()).toEqual(["Game"]);
  });
});

describe("games migration — the `ffi/` split + the BOTH-MAPS seam", () => {
  test("all 6 native-backed functions are BODYLESS foreign declarations (0 Fenel bodies)", () => {
    const bodyless = (gamesModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(ALL_NAMES.map((n) => `games:${n}`).sort());
  });

  test("nativeImpls (PLAIN map) holds exactly mkGame, id-keyed", () => {
    expect(Object.keys(gamesModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `games:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly the 5 ctx natives, id-keyed", () => {
    expect(gamesModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(gamesModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `games:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint", () => {
    const plain = new Set(Object.keys(gamesModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(gamesModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(gamesModule.ioHandlers).toBeUndefined();
    expect(gamesModule.credentialRequirements).toBeUndefined();
  });
});

describe("games migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = gamesModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `games:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): games declares no @category, so NONE carry
  // a stored Categorizable — the `games` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — games declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `games:${n}`)).toBeUndefined();
    }
  });

  test("Labelable / Describable / Taggable: byte-identical for all 6 natives", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `games:${n}`)).toEqual({ label: NATIVES[n]!.label });
      expect(methodOf(insts, "Describable", `games:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `games:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  // Phase 3j: Categorizable drops 6→0 (no @category). Labelable stays 6.
  test("identity-facet counts: 6 Codeable/Labelable/Describable/Taggable, 0 Categorizable (none @category), 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(6);
    expect(counts.Labelable).toBe(6);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(6);
    expect(counts.Taggable).toBe(6);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });

  test("games carries NO own Sampleable/Renderable dispatch instances", () => {
    expect(insts.find((i) => i.typeName === "Sampleable")).toBeUndefined();
    expect(insts.find((i) => i.typeName === "Renderable")).toBeUndefined();
  });
});

describe("games migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([gamesModule]);

  test("getFunction resolves every function by id AND by codeName (incl. _gameViewAt)", () => {
    for (const n of ALL_NAMES) {
      const id = `games:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes BOTH native maps", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx.natives?.["games:mkGame"]).toBe("function");
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`games:${n}`], `ctx native present: games:${n}`).toBe("function");
    }
  });

  test("plain native `mkGame` bundles the four pieces into a Game record", () => {
    const ctx = reg.evaluateContext();
    const update = { __fenelFn: true, params: ["s", "i"], body: { var: "i" }, closure: {} };
    const view = { __fenelFn: true, params: ["s"], body: { var: "s" }, closure: {} };
    const inputs = { entries: [] };
    expect(ctx.natives!["games:mkGame"]!("init", update, view, inputs)).toEqual({
      initial: "init",
      update,
      view,
      inputs,
    });
  });

  // The CTX-threading proof — gameStateAt folds the input Event stream through
  // the Game's `update` closure (which here returns the payload, ignoring
  // state), re-entering the evaluator. Self-contained: no std needed.
  test("ctx native dispatches end-to-end: gameStateAt folds inputs ≤ t via the update closure", () => {
    const ctx = reg.evaluateContext();
    const update = { __fenelFn: true, params: ["s", "i"], body: { var: "i" }, closure: {} };
    const inputs = { entries: [
      { timestamp: 0, payload: "a" },
      { timestamp: 1, payload: "b" },
      { timestamp: 2, payload: "c" },
    ] };
    const game = { initial: "init", update, view: null, inputs };
    // inputs with timestamp ≤ 1: update("init","a")="a", update("a","b")="b" → "b"
    expect(ctx.nativesCtx!["games:gameStateAt"]!(ctx, game, { seconds: 1 })).toBe("b");
  });

  test("ctx native `gameToAnim` emits an Animate marker; `runGame` emits a LiveGame marker", () => {
    const ctx = reg.evaluateContext();
    const game = { initial: "x", update: null, view: null, inputs: { entries: [] } };
    const anim = ctx.nativesCtx!["games:gameToAnim"]!(ctx, game) as { $tag: string };
    expect(anim.$tag).toBe("Animate");
    const live = ctx.nativesCtx!["games:runGame"]!(ctx, game) as { $tag: string; _0: unknown };
    expect(live.$tag).toBe("LiveGame");
    expect(live._0).toBe(game);
  });
});
