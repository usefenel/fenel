// ---------------------------------------------------------------------------
// animation-load.test.ts — conformance test for the animation module
// entity + inline-function-body flip. Phase 4g of the ts-elimination
// workstream extracts the inline `ANIMATION_SRC` template literal at
// engine/src/modules/animation.ts (22 LOC, 2 entities + 4 user-Fenel
// functions) into a real `.fenel` file at
// `fenel/modules/animation/types.fenel`. This test locks the post-flip
// invariants the way 4a–4f lock theirs, plus a new function-presence
// tier — 4a–4f extracted types only; 4g is the first phase extracting
// inline function bodies, so the conformance gate adds explicit
// assertions that the extracted lambdas surface as user-Fenel functions
// in `<module>.functions`.
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity roster lock + Animation variant shape — count drift
//      trips the gate; the variant carries the canonical Frames /
//      Animate cases.
//   2. Function-presence smoke — the four inline closures (freeze,
//      overAnim, delayAnim, speedAnim) surface as user-Fenel functions
//      with bodies in `animationModule.functions`. NEW conformance
//      tier introduced in 4g.
//   3. Module-tier totals — entities.length + functions.length match
//      expected post-flip surface (2 + 7 = 3 natives + 4 user-Fenel).
//   4. Catalog surfacing post-`getSystemRegistry()` — Animation and
//      FrameSequence reachable through the catalog.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import animationSrc from "../../../../../fenel/modules/animation/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields } from "../type-foundation";
import { animationModule } from "./animation";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import type { FenelType } from "../types";

const ANIMATION_MOD = loadFenelModule(animationSrc, "animation");

function rawEntity(id: string): FenelType {
  const entity = (ANIMATION_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`animation module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("animation/types.fenel parses to exactly 2 entities (canonical roster lock)", () => {
  expect((ANIMATION_MOD.entities ?? []).length).toBe(2);
  const ids = (ANIMATION_MOD.entities ?? []).map((e) => e.id);
  expect(ids).toContain("Animation");
  expect(ids).toContain("FrameSequence");
});

test("animation/types.fenel parses Animation as Frames | Animate variant", () => {
  const anim = rawEntity("Animation") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(anim.$variant.cases.map((c) => c.name)).toEqual(["Frames", "Animate"]);
});

test("inline closures (freeze / overAnim / delayAnim / speedAnim) surface as user-Fenel functions", () => {
  // First phase extracting inline function bodies (vs orchestration
  // bodies authored from scratch). The four closure-construction
  // helpers MUST appear as Fenel-bodied functions in the loaded
  // module — not as TS natives. Confirms the `\\t` → `\t` lambda
  // escape conversion produced parseable bodies.
  const fnIds = new Set((ANIMATION_MOD.functions ?? []).map((f) => f.id));
  expect(fnIds).toContain("animation:freeze");
  expect(fnIds).toContain("animation:overAnim");
  expect(fnIds).toContain("animation:delayAnim");
  expect(fnIds).toContain("animation:speedAnim");
  // Each carries a Fenel body, not a native impl.
  for (const fnId of ["animation:freeze", "animation:overAnim", "animation:delayAnim", "animation:speedAnim"]) {
    const fn = (ANIMATION_MOD.functions ?? []).find((f) => f.id === fnId)!;
    expect(fn.body).toBeDefined();
  }
});

test("animationModule carries 2 entities + 7 functions (3 native + 4 user-Fenel)", () => {
  expect((animationModule.entities ?? []).length).toBe(2);
  expect((animationModule.functions ?? []).length).toBe(7);
});

test("getSystemRegistry surfaces entity:Animation / entity:FrameSequence", () => {
  getSystemRegistry();
  expect(getCatalogEntry("entity:Animation")).toBeDefined();
  expect(getCatalogEntry("entity:FrameSequence")).toBeDefined();
});

// ---------------------------------------------------------------------------
// Phase 5b11 — frameSequence pure-constructor port assertions.
// module-substrate Phase 3g — frameSequence CONSOLIDATED from the retired
// `frame-sequence.fenel` sidecar into `types.fenel` (recipe N6). The body +
// dispatch contract are unchanged; only the source FILE moved.
// ---------------------------------------------------------------------------

test("3g: frameSequence is a single bodied function in types.fenel (post-consolidation)", () => {
  const fsFns = (ANIMATION_MOD.functions ?? []).filter((f) => f.id === "animation:frameSequence");
  expect(fsFns.length).toBe(1);
  expect(fsFns[0]!.body).toBeDefined();
});

test("3g: animation:frameSequence body LOADED FROM types.fenel (consolidated); not a native", () => {
  const fns = animationModule.functions ?? [];
  const fsFn = fns.find((f) => f.id === "animation:frameSequence")!;
  expect(fsFn.body).toBeDefined();
  // The consolidated body matches the canonical FrameSequence construction.
  expect(fsFn.body).toEqual({
    construct: [
      "FrameSequence",
      { fps: { var: "fps" }, frames: { var: "frames" } },
    ],
  });
  const natives = (animationModule.nativeImpls ?? {}) as Record<string, unknown>;
  expect(natives["animation:frameSequence"]).toBeUndefined();
  // The ctx natives (sampleAnim/renderAnim) live in nativeImplsCtx, not
  // nativeImpls — frameSequence is bodied, not a native at all.
});

test("5b11: semantic regression smoke — frameSequence dispatches through Fenel body (tagged shape)", () => {
  const reg = createRegistry([animationModule]);
  const ctx = reg.evaluateContext();
  expect(evaluate({ call: ["frameSequence", 30, []] }, {}, ctx)).toEqual({
    $tag: "FrameSequence",
    fps: 30,
    frames: [],
  });
  // Trust-the-typed-contract: pre-port Math.max(1, …) clamped to 1; post-
  // port the Fenel body propagates fps directly (the spec's `Number`
  // contract is the obligation now).
  expect(evaluate({ call: ["frameSequence", 0, []] }, {}, ctx)).toEqual({
    $tag: "FrameSequence",
    fps: 0,
    frames: [],
  });
});
