// ---------------------------------------------------------------------------
// rights R2b commit 0 — the engine half of the R0.5 pass.
//
// R2a's completion note §6 says plainly that the neuter discipline was not run
// as a controlled protocol and that five acceptance items had no dedicated
// test. This file writes the engine one (P0.1, R2a brief §6.14 — the override
// guard); the other four are runtime-side.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED BEFORE IT WAS TRUSTED, one neuter at a
// time, with the red text recorded in the phase completion note. A pin whose
// red was never observed is not a pin.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { createDispatchRegistry } from "./dispatch-registry";
import { evaluate, withInstance, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { perform } from "./perform";
import { authorityTestKernel, mintTestAuthorityFor, testPerformTable } from "./authority-test-support";
import type { FenelFunction, Interface } from "./types";

const LONG = 200_000;

const EFFECT_CONSTRAINT = (className: string) => ({
  class: { $tag: "Id" as const, entityId: className },
  args: [{ $var: "scope" }],
});

function effectClass(name: string): Interface {
  return { name, params: [{ name: "scope" }], methods: [] };
}

/** One mediated native act (`probe:tick`, requires `HasProbe`) plus two
 *  override targets in the same table: one registered under the IO calling
 *  convention and one under the native one. The two differ by exactly the
 *  convention tag, which is what makes the negative and its control one input
 *  apart through the same path (`WORKFLOW.md` instrument law). */
function overrideFixture() {
  const kernel = authorityTestKernel();
  const dispatch = createDispatchRegistry();
  dispatch.defineClass(effectClass("HasProbe"));
  const spec: FenelFunction = {
    id: "probe:tick",
    params: [{ name: "beat", type: { $ref: "Int" } }] as never,
    returns: { $ref: "String" },
    requires: [EFFECT_CONSTRAINT("HasProbe")],
  };
  const table = testPerformTable(kernel);
  let ownHits = 0;
  table.register("probe:tick", (_frame, args) => { ownHits++; return `own:${String(args[0])}`; }, 1);
  // ⚠ THE IO WRAPPER IS THE OBSERVER. `perform`'s IO registration path reads
  // `args[0]` as ONE PARAMS RECORD; a native act hands it a positional list. So
  // the neuter's damage is visible as a `params` that is a NUMBER, which is
  // exactly the silent misread the guard exists to refuse.
  const ioCalls: unknown[] = [];
  table.register(
    "probe.ioLeaf",
    (_frame, args) => { ioCalls.push(args[0]); return "io-leaf"; },
    0,
    "io",
  );
  const nativeCalls: unknown[][] = [];
  table.register(
    "probe:nativeLeaf",
    (_frame, args) => { nativeCalls.push([...args]); return "native-leaf"; },
    1,
    "native",
  );
  const ctx: EvaluateContext = {
    _authority: mintTestAuthorityFor(
      ["probe:tick", "probe.ioLeaf", "probe:nativeLeaf"],
      kernel,
    ),
    getFunction: (name) => (name === "probe:tick" || name === "tick" ? spec : undefined),
    _nativePerformDescriptors: {
      context: Object.create(null) as Record<string, true>,
      plain: Object.assign(Object.create(null) as Record<string, true>, { "probe:tick": true }),
    },
    _specRegistry: dispatch,
    _performTable: table.handle,
    _activeScopeToken: "account",
    _codeNameFor: (id) => (id === "probe:tick" ? "tick" : undefined),
  };
  return {
    ctx,
    ioCalls,
    nativeCalls,
    ownHits: () => ownHits,
  };
}

describe("rights R2b P0.1 — the native-act override refuses an IO-convention target", () => {
  test("an override naming an IO descriptor throws and the IO implementation is never entered", () => {
    const fixture = overrideFixture();
    // Neuter: delete the `performConventionFor(ctx, descriptor) === "io"` branch
    // in `exerciseNativeActOverride` (`json-logic.ts`).
    // RED reads: `ioCalls` has length 1 and its entry is the NUMBER 7 — the IO
    // convention reading a positional native argument as its params record.
    //
    // ⚠ THE DAMAGE ASSERTION COMES FIRST, deliberately. Asserting the throw
    // first would redden with "did not throw", which says the guard is gone but
    // not what the guard was for. Asserting the ENTERED WRAPPER first makes the
    // red text the defect itself.
    let thrown: unknown;
    try {
      withInstance(
        fixture.ctx,
        { typeName: "HasProbe", args: ["account"], methods: { tick: "probe.ioLeaf" } },
        (inner) => evaluate({ call: ["probe:tick", 7] }, {}, inner),
      );
    } catch (error) {
      thrown = error;
    }
    expect(fixture.ioCalls).toHaveLength(0);
    expect(String(thrown)).toMatch(/names the IO descriptor "probe\.ioLeaf"/);
    // And the own leaf was not silently substituted either.
    expect(fixture.ownHits()).toBe(0);
  }, LONG);

  test("THE CONTROL: the same frame with a native-convention override performs it", () => {
    const fixture = overrideFixture();
    const result = withInstance(
      fixture.ctx,
      { typeName: "HasProbe", args: ["account"], methods: { tick: "probe:nativeLeaf" } },
      (inner) => evaluate({ call: ["probe:tick", 7] }, {}, inner),
    );
    expect(result).toBe("native-leaf");
    // POSITIONAL, which is the convention the guard protects.
    expect(fixture.nativeCalls).toEqual([[7]]);
    expect(fixture.ioCalls).toHaveLength(0);
    expect(fixture.ownHits()).toBe(0);
  }, LONG);

  test("THE SECOND CONTROL: with no override the act performs its OWN leaf", () => {
    const fixture = overrideFixture();
    expect(evaluate({ call: ["probe:tick", 7] }, {}, fixture.ctx)).toBe("own:7");
    expect(fixture.ownHits()).toBe(1);
    expect(fixture.ioCalls).toHaveLength(0);
  }, LONG);
});

// ---------------------------------------------------------------------------
// THE KERNEL FRAME CANNOT REACH A HOST NATIVE (R2a §6.6).
//
// R2a's test 4–5 carries the sentence "and the checker cannot perform", but the
// assertion under it is that an UNREADABLE verdict refuses — which stays green
// whether the kernel frame resolved the call or not, because a uuid string is
// no more `Just true` than a null is. The re-neuter pass found that by relaxing
// `authorityResolvableFunction` and watching nothing go red.
//
// So this pin observes the frame's restriction DIRECTLY: a stand-in checker
// whose body names a host native records ZERO calls on it.
// ---------------------------------------------------------------------------

describe("rights R2b — the authority kernel frame resolves nothing outside authority:/std:", () => {
  test("a checker body naming a host native never reaches it, and the act is refused", () => {
    let leakHits = 0;
    const standIn = {
      name: "authority",
      label: "Stand-in authority that tries to reach a host native",
      functions: [{
        id: "authority:permits",
        params: [
          { name: "envelope", type: { $ref: "Any" } },
          { name: "act", type: { $ref: "Any" } },
        ],
        returns: { $ref: "Any" },
        body: { call: ["probe:leak"] },
      }],
    };
    const probe = {
      name: "probe",
      label: "leak probe",
      functions: [{ id: "probe:leak", params: [], returns: { $ref: "Any" } }],
      nativeImpls: { "probe:leak": () => { leakHits += 1; return { $tag: "Just", _0: true }; } },
    };
    const registry = createRegistry([stdModule, standIn as never, probe as never]);
    const table = testPerformTable(registry);
    let leafHits = 0;
    table.register("probe:a", () => { leafHits += 1; return "a"; }, 0);
    // Neuter: relax `authorityResolvableFunction` to `effectiveFunction` and
    // `authorityKernelNatives` to the identity (`registry.ts`).
    // RED reads: `expect(received).toBe(expected) / Expected: 0 / Received: 1`
    // — the checker reached a host native.
    expect(() => perform(
      {
        _performTable: table.handle,
        // Minted over the REAL kernel: the stand-in registry has no envelope
        // constructors. The handle is a WeakMap key, not a registry-bound value.
        _authority: mintTestAuthorityFor(["probe:a"], authorityTestKernel()),
      },
      { descriptor: "probe:a", args: [] },
    )).toThrow(/authority refused "probe:a"/);
    expect(leakHits).toBe(0);
    expect(leafHits).toBe(0);
  }, LONG);
});
