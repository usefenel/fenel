// ---------------------------------------------------------------------------
// HasWasmBuilder substrate test — Phase 21.7 commit 2
//
// Validates the architectural decision (Option B from the Phase 21.7 brief):
// the per-compilation Wasm `ModuleBuilder` mutable state is exposed to a
// Fenel-bodied `lowerToWasmAst` via a typeclass capability whose methods
// are bound to TS-side state mutation. The Fenel body invokes the methods
// through `$effect:HasWasmBuilder:<method>` sentinels; the engine resolves
// these through `ctx.natives` populated by the dispatch wrapper before
// body evaluation (same pattern as the Phase 20 `effectfulCanary` /
// `HasStateIO@scratch` bootstrap in `compile-wasm-self-host.test.ts`).
//
// What this test verifies:
//
//   1. The `HasWasmBuilder` typeclass declaration in `builtin-classes.ts`
//      registers correctly via `SYSTEM_MODULES` → `getCapability` returns
//      the typeclass with the declared method set.
//   2. A per-call instance backed by per-test mutable state, packed as
//      `{"$effect:HasWasmBuilder:<method>": fn}` entries on `ctx.natives`,
//      makes the methods invocable from a `{call: [...]}` body — the
//      exact path the production dispatch wrapper will use.
//   3. `internString` deduplicates by value — same input returns the same
//      pool index — exercising the cross-boundary "TS-side state mutation
//      visible across multiple Fenel-side calls" property that's load-
//      bearing for the production wrapper.
//   4. `internImport` independently maintains its own dedup'd index space,
//      proving multiple state-bearing methods compose without interference.
//   5. Each ModuleBuilder instance is isolated — parallel compilations
//      can't see each other's state.
//
// The actual Fenel-body port of `lowerToWasmAst` (subsequent commits in
// Phase 21.7) builds on exactly this substrate. Any future divergence —
// e.g. the dispatch wrapper failing to bind methods correctly, the engine
// resolver failing to find $effect: entries in ctx.natives, the typeclass
// declaration drifting from the wrapper's method set — surfaces here as
// a focused failure before causing pipeline-wide damage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { evaluate, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { dispatchRegistry } from "./system-entities";

// Shared registry context — picks up `hasWasmBuilder` via
// SYSTEM_MODULES → builtinTypeclasses. The std module is the minimum
// needed to evaluate $effect calls (the engine's `Call` op resolves
// $effect: through the registry's typeclass dispatch path).
const harnessRegistry = createRegistry([stdModule]);
const baseCtx = harnessRegistry.evaluateContext();

// Mirrors the TS oracle's `ModuleBuilder` state — just enough fields to
// exercise `internString` + `internImport` dedup behaviour. The
// production wrapper at `engine-bodies-dispatch.ts` will own a richer
// version of this struct.
type TestBuilder = {
  stringPool: Map<string, number>;
  importedNames: Map<string, number>;
  imports: { module: string; name: string }[];
};

function newTestBuilder(): TestBuilder {
  return {
    stringPool: new Map(),
    importedNames: new Map(),
    imports: [],
  };
}

// Build the `$effect:HasWasmBuilder:<method>`-keyed natives map for a
// given builder. Same shape `buildEffectStubsForFn` produces; the
// production wrapper will share that helper rather than re-rolling its
// own. For the substrate test we inline the construction to keep the
// scope visible.
function effectNativesFor(
  b: TestBuilder,
): Record<string, (...args: unknown[]) => unknown> {
  return {
    "$effect:HasWasmBuilder:internString": (value: unknown): unknown => {
      const s = String(value);
      const existing = b.stringPool.get(s);
      if (existing !== undefined) return existing;
      const idx = b.stringPool.size;
      b.stringPool.set(s, idx);
      return idx;
    },
    "$effect:HasWasmBuilder:internImport": (name: unknown, _funcType: unknown): unknown => {
      const key = `$fenel.${String(name)}`;
      const existing = b.importedNames.get(key);
      if (existing !== undefined) return existing;
      const idx = b.imports.length;
      b.imports.push({ module: "$fenel", name: String(name) });
      b.importedNames.set(key, idx);
      return idx;
    },
  };
}

// Helper: evaluate a JSON-Logic body inside a HasWasmBuilder-augmented
// natives context. Mirrors the production dispatch wrapper's shape: it
// adds the effect-natives onto a fresh ctx for the single call, leaving
// the base ctx untouched.
function evalWithBuilder(
  body: unknown,
  b: TestBuilder,
  data: Record<string, unknown> = {},
): unknown {
  const innerCtx: EvaluateContext = {
    ...baseCtx,
    natives: {
      ...(baseCtx.natives ?? {}),
      ...effectNativesFor(b),
    },
  };
  return evaluate(body, data, innerCtx);
}

describe("HasWasmBuilder — typeclass substrate (Phase 21.7 commit 2)", () => {
  it("typeclass is registered in the system catalog", () => {
    // The typeclass is declared in `builtin-classes.ts` and exported via
    // `builtinTypeclasses` → consumed by SYSTEM_MODULES at registry
    // construction. If a future refactor accidentally drops it from the
    // export array, this test fails before any Fenel-body call site
    // would surface the gap as an opaque dispatch error.
    const cls = dispatchRegistry.getClass("HasWasmBuilder");
    expect(cls).toBeDefined();
    expect(cls?.name).toBe("HasWasmBuilder");
    expect(cls?.methods.map((m) => m.name)).toEqual(
      expect.arrayContaining([
        "internString",
        "internImport",
        "internImportInModule",
        "internType",
        "allocLocal",
        "setLocalAlias",
        "lookupLocal",
        "snapshotLocals",
        "restoreLocals",
        "addPendingFunc",
        "addPendingExport",
        "nextClosureId",
        "getEntryName",
      ]),
    );
  });

  it("internString returns the same index for the same string (dedup)", () => {
    const b = newTestBuilder();
    const body = {
      call: ["$effect:HasWasmBuilder:internString", "hello"],
    };
    const first = evalWithBuilder(body, b);
    const second = evalWithBuilder(body, b);
    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(b.stringPool.size).toBe(1);
  });

  it("internString returns successive indices for distinct strings", () => {
    const b = newTestBuilder();
    const idxFoo = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "foo"] },
      b,
    );
    const idxBar = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "bar"] },
      b,
    );
    const idxFooAgain = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "foo"] },
      b,
    );
    expect(idxFoo).toBe(0);
    expect(idxBar).toBe(1);
    expect(idxFooAgain).toBe(0);
    expect(b.stringPool.size).toBe(2);
  });

  it("internImport maintains its own dedup'd index space", () => {
    const b = newTestBuilder();
    const idxA = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internImport", "boxNum", null] },
      b,
    );
    const idxB = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internImport", "concat", null] },
      b,
    );
    const idxAAgain = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internImport", "boxNum", null] },
      b,
    );
    expect(idxA).toBe(0);
    expect(idxB).toBe(1);
    expect(idxAAgain).toBe(0);
    expect(b.imports.length).toBe(2);
    expect(b.imports[0]?.name).toBe("boxNum");
    expect(b.imports[1]?.name).toBe("concat");
  });

  it("internString and internImport state stays independent", () => {
    // Load-bearing for the production wrapper: a single ModuleBuilder
    // hosts BOTH a stringPool and an imports list, and a single Fenel
    // body interleaves calls into both. The two index spaces must not
    // conflate.
    const b = newTestBuilder();
    const strIdx = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "litString"] },
      b,
    );
    const impIdx = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internImport", "litString", null] },
      b,
    );
    // Both are "first entry in their respective space".
    expect(strIdx).toBe(0);
    expect(impIdx).toBe(0);
    expect(b.stringPool.size).toBe(1);
    expect(b.imports.length).toBe(1);
  });

  it("per-call instance isolates parallel compilations", () => {
    // Two distinct ModuleBuilders + two distinct invocations: each call
    // sees its own builder; state doesn't leak across. This is the
    // property the production wrapper relies on when multiple Fenel-
    // target compiles run concurrently in a test suite (or in CI).
    const a = newTestBuilder();
    const c = newTestBuilder();
    const aIdx = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "shared"] },
      a,
    );
    const cIdx = evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "shared"] },
      c,
    );
    // Each builder sees its own first-entry index, not a shared global.
    expect(aIdx).toBe(0);
    expect(cIdx).toBe(0);
    expect(a.stringPool.size).toBe(1);
    expect(c.stringPool.size).toBe(1);
  });

  it("base ctx stays untouched by per-call effect-natives augmentation", () => {
    // The dispatch wrapper builds a fresh inner-ctx per compilation
    // (effect-natives spread on top of base ctx.natives), so the shared
    // harness ctx is never mutated. Re-evaluating against the base ctx
    // after a HasWasmBuilder call yields a no-handler outcome (null) —
    // confirms the augmentation didn't bleed.
    const b = newTestBuilder();
    evalWithBuilder(
      { call: ["$effect:HasWasmBuilder:internString", "isolated"] },
      b,
    );
    const baseAfter = evaluate(
      { call: ["$effect:HasWasmBuilder:internString", "isolated"] },
      {},
      baseCtx,
    );
    // No handler on the base ctx → invokeFunction falls through to null.
    expect(baseAfter).toBe(null);
  });
});
