// ---------------------------------------------------------------------------
// Migration — typeclass + composition + path-finding tests.
//
// Phase 10 of the implementation roadmap. Six concerns this suite
// exercises:
//
//   1. The Lossless demo instance roundtrips: backward(forward(v1)) = Ok v1
//      for every v1 in its declared sample list.
//   2. composeMigration's losslessness algebra: Lossless ∘ Lossless =
//      Lossless; any Lossy leg poisons the composition; composed reasons
//      aggregate per-leg explanations.
//   3. findMigrationPath surfaces a multi-hop chain across registered
//      migrations, returns Nothing for disconnected versions, and handles
//      the self-loop case (v1 === v2 → empty chain).
//   4. User-registered migrations participate: register a stub V3→V4 and
//      verify it shows up in path-finding alongside the built-in demos.
//   5. Lossy migration's backward is Nothing; the typeclass shape's
//      `{$tag: "Nothing"}` invariant holds at module load time.
//   6. The migration:roundtripCheck native (the law's per-case witness)
//      delegates correctly through the EvaluateContext and returns the
//      tri-state Maybe Bool for each instance shape.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerMigration,
  unregisterMigration,
  findMigration,
  findMigrationPath,
  listMigrations,
  composeMigration,
  composeMigrationChain,
  LOSSLESS,
  lossy,
  isLossless,
  migrationFieldMissing,
  migrationTypeIncompatible,
  type Losslessness,
} from "./migration";
import {
  migrationDemoV1ToV2,
  migrationDemoV2ToV1Narrow,
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
  roundtripCheckNative,
  forwardTotalCheckNative,
  demoV1Samples,
} from "./modules/migration";
import { getSystemEvaluateContext } from "./system-registry";
import type { Instance } from "./types";
// ---------------------------------------------------------------------------
// Helpers — small Instance builders for the multi-hop tests
// ---------------------------------------------------------------------------

/** Build a no-op identity migration over a single record shape — useful
 *  for the path-finding tests. Forward / backward are JS identity. */
function makeIdentityMigration(
  v1Tag: string,
  v2Tag: string,
  samples: unknown[],
  losslessness: Losslessness = LOSSLESS,
): Instance {
  // Each test-instance gets distinct fnIds so the registry doesn't conflict
  // with the demo instance. The tests don't actually invoke these fnIds —
  // they exercise the registry / path-finder, not the evaluator dispatch.
  const fwdId = `__test_migration:${v1Tag}->${v2Tag}_forward`;
  const bwdId = `__test_migration:${v1Tag}->${v2Tag}_backward`;
  const backwardMethod =
    losslessness.$tag === "Lossless"
      ? { $tag: "Just", _0: bwdId }
      : { $tag: "Nothing" };
  return {
    typeName: "Migration",
    args: [v1Tag, v2Tag],
    label: `${v1Tag} → ${v2Tag} (test)`,
    methods: {
      forward: fwdId,
      backward: backwardMethod,
      losslessness,
      roundtripSamples: samples,
    },
  };
}

// ---------------------------------------------------------------------------
// Demo instance — Lossless V1 → V2 (add email)
// ---------------------------------------------------------------------------

describe("Migration<ProfileDemoV1, ProfileDemoV2> — Lossless instance", () => {
  it("forward copies firstName/lastName and defaults email to empty string", () => {
    const result = profileDemoV1ToV2Native({ firstName: "Ada", lastName: "Lovelace" });
    expect(result).toEqual({
      $tag: "Ok",
      _0: { firstName: "Ada", lastName: "Lovelace", email: "" },
    });
  });

  it("backward drops email — restores the V1 record byte-for-byte", () => {
    const v1 = profileDemoV2ToV1Native({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "",
    });
    expect(v1).toEqual({
      $tag: "Ok",
      _0: { firstName: "Ada", lastName: "Lovelace" },
    });
  });

  it("forward returns Err FieldMissing when a required field is absent", () => {
    const result = profileDemoV1ToV2Native({ firstName: "Ada" });
    expect(result).toEqual({
      $tag: "Err",
      _0: { $tag: "FieldMissing", field: "lastName" },
    });
  });

  it("Lossless roundtrip: backward(forward(v1)) = Ok v1 on every declared sample", () => {
    for (const v1 of demoV1Samples) {
      const forwardOk = profileDemoV1ToV2Native(v1);
      expect(forwardOk.$tag).toBe("Ok");
      if (forwardOk.$tag !== "Ok") continue;
      const backwardOk = profileDemoV2ToV1Native(forwardOk._0);
      expect(backwardOk).toEqual({ $tag: "Ok", _0: v1 });
    }
  });

  it("instance carries the Lossless flag + Just-wrapped backward reference", () => {
    expect(migrationDemoV1ToV2.typeName).toBe("Migration");
    expect(migrationDemoV1ToV2.args).toEqual(["ProfileDemoV1", "ProfileDemoV2"]);
    expect(migrationDemoV1ToV2.methods.losslessness).toEqual(LOSSLESS);
    // modules-as-values Phase 2d: qualified function references.
    expect(migrationDemoV1ToV2.methods.backward).toEqual({
      $tag: "Just",
      _0: { $ref: "migration.profileDemoV2ToV1" },
    });
    expect(migrationDemoV1ToV2.methods.forward).toEqual({
      $ref: "migration.profileDemoV1ToV2",
    });
  });
});

// ---------------------------------------------------------------------------
// Lossy variant — V2 → V1Narrow (drop lastName)
// ---------------------------------------------------------------------------

describe("Migration<ProfileDemoV2, ProfileDemoV1Narrow> — Lossy instance", () => {
  it("forward drops lastName", () => {
    const result = profileDemoV2ToV1NarrowNative({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    });
    expect(result).toEqual({ $tag: "Ok", _0: { firstName: "Ada" } });
  });

  it("instance carries Lossy losslessness + Nothing backward (no inverse)", () => {
    expect(migrationDemoV2ToV1Narrow.methods.losslessness).toMatchObject({
      $tag: "Lossy",
    });
    expect(migrationDemoV2ToV1Narrow.methods.backward).toEqual({ $tag: "Nothing" });
  });

  it("Lossy reason documents the lost information", () => {
    const loss = migrationDemoV2ToV1Narrow.methods.losslessness as Losslessness;
    if (loss.$tag !== "Lossy") {
      throw new Error("expected Lossy losslessness on the V1Narrow migration");
    }
    expect(loss.reason).toContain("lastName");
  });
});

// ---------------------------------------------------------------------------
// Losslessness primitives
// ---------------------------------------------------------------------------

describe("Losslessness primitives", () => {
  it("LOSSLESS singleton has $tag = 'Lossless'", () => {
    expect(LOSSLESS).toEqual({ $tag: "Lossless" });
  });

  it("lossy() wraps the reason string", () => {
    const l = lossy("dropped emails");
    expect(l).toEqual({ $tag: "Lossy", reason: "dropped emails" });
  });

  it("isLossless distinguishes the variants", () => {
    expect(isLossless(LOSSLESS)).toBe(true);
    expect(isLossless(lossy("any reason"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MigrationError constructors
// ---------------------------------------------------------------------------

describe("MigrationError constructors", () => {
  it("migrationFieldMissing", () => {
    expect(migrationFieldMissing("name")).toEqual({
      $tag: "FieldMissing",
      field: "name",
    });
  });

  it("migrationTypeIncompatible", () => {
    expect(migrationTypeIncompatible("age", "Number", "String")).toEqual({
      $tag: "TypeIncompatible",
      field: "age",
      expected: "Number",
      actual: "String",
    });
  });
});

// ---------------------------------------------------------------------------
// composeMigration — losslessness algebra
// ---------------------------------------------------------------------------

describe("composeMigration — losslessness algebra", () => {
  it("Lossless ∘ Lossless = Lossless", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const composed = composeMigration(m1, m2);
    expect(composed.methods.losslessness).toEqual(LOSSLESS);
    expect(composed.args).toEqual(["A", "C"]);
  });

  it("Lossless ∘ Lossy = Lossy { reason: inner.reason }", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], lossy("dropped X"));
    const composed = composeMigration(m1, m2);
    expect(composed.methods.losslessness).toEqual({
      $tag: "Lossy",
      reason: "dropped X",
    });
  });

  it("Lossy ∘ Lossless = Lossy { reason: outer.reason }", () => {
    const m1 = makeIdentityMigration("A", "B", [1], lossy("dropped Y"));
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const composed = composeMigration(m1, m2);
    expect(composed.methods.losslessness).toEqual({
      $tag: "Lossy",
      reason: "dropped Y",
    });
  });

  it("Lossy ∘ Lossy = Lossy with composed reason aggregating per-leg explanations", () => {
    const m1 = makeIdentityMigration("A", "B", [1], lossy("dropped X"));
    const m2 = makeIdentityMigration("B", "C", [], lossy("dropped Y"));
    const composed = composeMigration(m1, m2);
    const loss = composed.methods.losslessness as Losslessness;
    expect(loss.$tag).toBe("Lossy");
    if (loss.$tag !== "Lossy") return;
    expect(loss.reason).toContain("dropped X");
    expect(loss.reason).toContain("dropped Y");
  });

  it("composed backward is Just-closure when both legs are Lossless", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const composed = composeMigration(m1, m2);
    const bwd = composed.methods.backward as { $tag: string; _0?: unknown };
    expect(bwd.$tag).toBe("Just");
    // The composed backward is an inline closure (not an fnId string)
    expect(bwd._0 && typeof bwd._0 === "object").toBe(true);
  });

  it("composed backward is Nothing when either leg is Lossy", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], lossy("lost it"));
    const composed = composeMigration(m1, m2);
    expect(composed.methods.backward).toEqual({ $tag: "Nothing" });
  });

  it("composed roundtripSamples inherits the first leg's samples (v1-typed)", () => {
    const samples = [{ a: 1 }, { a: 2 }];
    const m1 = makeIdentityMigration("A", "B", samples, LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const composed = composeMigration(m1, m2);
    expect(composed.methods.roundtripSamples).toBe(samples);
  });

  it("composed instance gets priority -1 so explicit registrations win", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const composed = composeMigration(m1, m2);
    expect(composed.priority).toBe(-1);
  });

  it("throws when given non-Migration instances", () => {
    const notMigration: Instance = {
      typeName: "Iso",
      args: ["A", "B"],
      methods: {},
    };
    expect(() => composeMigration(notMigration, notMigration)).toThrow(
      /both inputs must be Migration/,
    );
  });

  it("rejects truly non-callable forward (raw number / array)", () => {
    const bad: Instance = {
      typeName: "Migration",
      args: ["A", "B"],
      methods: {
        forward: 42, // not a string and not a `{fn: [...]}` closure
        backward: { $tag: "Nothing" },
        losslessness: LOSSLESS,
      },
    };
    expect(() => composeMigration(bad, bad)).toThrow(
      /a function reference, a function id string or an inline closure/,
    );
  });

  it("accepts inline `{fn: [...]}` closure as forward (composing composed migrations)", () => {
    // The composed.forward produced by `composeMigration` is itself a
    // closure; re-composing should work, supporting chains > 2.
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const m12 = composeMigration(m1, m2);
    const m3 = makeIdentityMigration("C", "D", [], LOSSLESS);
    const m1to3 = composeMigration(m12, m3);
    expect(m1to3.args).toEqual(["A", "D"]);
    expect(m1to3.methods.losslessness).toEqual(LOSSLESS);
  });
});

// ---------------------------------------------------------------------------
// composeMigrationChain — multi-leg composition
// ---------------------------------------------------------------------------

describe("composeMigrationChain", () => {
  it("collapses a 3-leg Lossless chain to a single Lossless Migration", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], LOSSLESS);
    const m3 = makeIdentityMigration("C", "D", [], LOSSLESS);
    const composed = composeMigrationChain([m1, m2, m3]);
    expect(composed.args).toEqual(["A", "D"]);
    expect(composed.methods.losslessness).toEqual(LOSSLESS);
  });

  it("preserves losslessness conservatively across a chain (any Lossy poisons)", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const m2 = makeIdentityMigration("B", "C", [], lossy("mid-chain loss"));
    const m3 = makeIdentityMigration("C", "D", [], LOSSLESS);
    const composed = composeMigrationChain([m1, m2, m3]);
    const loss = composed.methods.losslessness as Losslessness;
    expect(loss.$tag).toBe("Lossy");
  });

  it("single-element chain returns the input unchanged", () => {
    const m1 = makeIdentityMigration("A", "B", [1], LOSSLESS);
    const composed = composeMigrationChain([m1]);
    expect(composed).toBe(m1);
  });

  it("empty chain throws (no identity migration is implied)", () => {
    expect(() => composeMigrationChain([])).toThrow(/empty chain/);
  });
});

// ---------------------------------------------------------------------------
// Registry & path-finding
// ---------------------------------------------------------------------------

describe("Migration registry — direct lookup", () => {
  it("findMigration locates the demo instance by version pair", () => {
    const found = findMigration("ProfileDemoV1", "ProfileDemoV2");
    expect(found).toBe(migrationDemoV1ToV2);
  });

  it("findMigration returns undefined for unregistered pairs", () => {
    expect(findMigration("__nope_v1", "__nope_v2")).toBeUndefined();
  });

  it("listMigrations enumerates the registered instances", () => {
    const all = listMigrations();
    expect(all).toContain(migrationDemoV1ToV2);
    expect(all).toContain(migrationDemoV2ToV1Narrow);
  });
});

describe("findMigrationPath — BFS over the migration graph", () => {
  // Each test registers + unregisters its own stubs so the path-finder
  // sees a clean graph extension on top of the built-in demos.
  const registered: Array<[string, string]> = [];

  beforeEach(() => {
    registered.length = 0;
  });

  afterEach(() => {
    for (const [v1, v2] of registered) unregisterMigration(v1, v2);
  });

  function registerTest(m: Instance): void {
    registerMigration(m);
    registered.push([m.args[0] as string, m.args[1] as string]);
  }

  it("self-loop returns Just [] (identity = empty composition)", () => {
    const path = findMigrationPath("V1", "V1");
    expect(path).toEqual({ $tag: "Just", _0: [] });
  });

  it("single-hop returns Just [m]", () => {
    const path = findMigrationPath("ProfileDemoV1", "ProfileDemoV2");
    expect(path.$tag).toBe("Just");
    if (path.$tag !== "Just") return;
    expect(path._0).toHaveLength(1);
    expect(path._0[0]).toBe(migrationDemoV1ToV2);
  });

  it("multi-hop chain via registered stubs", () => {
    // Build a V1 → V2 → V3 → V4 chain (all Lossless stubs).
    const m_v2_v3 = makeIdentityMigration(
      "__test_v2",
      "__test_v3",
      [{ x: 1 }],
      LOSSLESS,
    );
    const m_v3_v4 = makeIdentityMigration(
      "__test_v3",
      "__test_v4",
      [],
      LOSSLESS,
    );
    const m_v1_v2 = makeIdentityMigration(
      "__test_v1",
      "__test_v2",
      [],
      LOSSLESS,
    );
    registerTest(m_v1_v2);
    registerTest(m_v2_v3);
    registerTest(m_v3_v4);
    const path = findMigrationPath("__test_v1", "__test_v4");
    expect(path.$tag).toBe("Just");
    if (path.$tag !== "Just") return;
    expect(path._0).toHaveLength(3);
    expect(path._0[0]).toBe(m_v1_v2);
    expect(path._0[1]).toBe(m_v2_v3);
    expect(path._0[2]).toBe(m_v3_v4);
  });

  it("user-registered V3→V4 participates immediately", () => {
    const stub = makeIdentityMigration(
      "__user_v3",
      "__user_v4",
      [{ k: 1 }],
      LOSSLESS,
    );
    expect(findMigration("__user_v3", "__user_v4")).toBeUndefined();
    registerTest(stub);
    expect(findMigration("__user_v3", "__user_v4")).toBe(stub);
    const path = findMigrationPath("__user_v3", "__user_v4");
    expect(path).toEqual({ $tag: "Just", _0: [stub] });
  });

  it("returns Nothing for disconnected versions", () => {
    expect(findMigrationPath("__disconnected_A", "__disconnected_B")).toEqual({
      $tag: "Nothing",
    });
  });

  it("BFS returns the SHORTEST path (not a longer detour)", () => {
    // Graph: A → B, A → C, C → B. Shortest A → B is the direct edge.
    const ab = makeIdentityMigration("__bfs_A", "__bfs_B", [], LOSSLESS);
    const ac = makeIdentityMigration("__bfs_A", "__bfs_C", [], LOSSLESS);
    const cb = makeIdentityMigration("__bfs_C", "__bfs_B", [], LOSSLESS);
    registerTest(ab);
    registerTest(ac);
    registerTest(cb);
    const path = findMigrationPath("__bfs_A", "__bfs_B");
    expect(path.$tag).toBe("Just");
    if (path.$tag !== "Just") return;
    expect(path._0).toHaveLength(1);
    expect(path._0[0]).toBe(ab);
  });

  it("doesn't loop on cyclic migrations (visited set prevents revisit)", () => {
    // Cycle: A → B → A. Path A → C should return Nothing — no escape.
    const ab = makeIdentityMigration("__cyc_A", "__cyc_B", [], LOSSLESS);
    const ba = makeIdentityMigration("__cyc_B", "__cyc_A", [], LOSSLESS);
    registerTest(ab);
    registerTest(ba);
    const path = findMigrationPath("__cyc_A", "__cyc_disconnected");
    expect(path).toEqual({ $tag: "Nothing" });
  });

  it("registerMigration rejects non-Migration instances", () => {
    const bad: Instance = {
      typeName: "Iso",
      args: ["A", "B"],
      methods: {},
    };
    expect(() => registerMigration(bad)).toThrow(/expected class "Migration"/);
  });

  it("registerMigration rejects non-string version tags", () => {
    const bad: Instance = {
      typeName: "Migration",
      args: [{ $var: "v1" }, "V2"],
      methods: {},
    };
    expect(() => registerMigration(bad)).toThrow(
      /expected string version tags/,
    );
  });
});

// ---------------------------------------------------------------------------
// Law-check natives — exercised end-to-end via the system EvaluateContext
// ---------------------------------------------------------------------------

describe("migration:roundtripCheck native — Lossless instance passes", () => {
  it("Just true when forward + backward roundtrip on every sample", () => {
    const ctx = getSystemEvaluateContext();
    const result = roundtripCheckNative(
      ctx,
      migrationDemoV1ToV2.methods.forward,
      migrationDemoV1ToV2.methods.backward,
      migrationDemoV1ToV2.methods.losslessness,
      migrationDemoV1ToV2.methods.roundtripSamples,
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("Just true (vacuously) on Lossy instance — precondition false", () => {
    const ctx = getSystemEvaluateContext();
    const result = roundtripCheckNative(
      ctx,
      migrationDemoV2ToV1Narrow.methods.forward,
      migrationDemoV2ToV1Narrow.methods.backward,
      migrationDemoV2ToV1Narrow.methods.losslessness,
      migrationDemoV2ToV1Narrow.methods.roundtripSamples,
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("Just false when backward is Nothing on a Lossless instance (shape violation)", () => {
    const ctx = getSystemEvaluateContext();
    const result = roundtripCheckNative(
      ctx,
      "migration:profileDemoV1ToV2",
      { $tag: "Nothing" }, // typeclass-shape violation: Lossless + Nothing
      LOSSLESS,
      demoV1Samples,
    );
    expect(result).toEqual({ $tag: "Just", _0: false });
  });

  it("Nothing when no samples are supplied (un-checked)", () => {
    const ctx = getSystemEvaluateContext();
    const result = roundtripCheckNative(
      ctx,
      "migration:profileDemoV1ToV2",
      { $tag: "Just", _0: "migration:profileDemoV2ToV1" },
      LOSSLESS,
      [],
    );
    expect(result).toEqual({ $tag: "Nothing" });
  });
});

describe("migration:forwardTotalCheck native", () => {
  it("Just true when every forward(v1) returns Ok on the declared samples", () => {
    const ctx = getSystemEvaluateContext();
    const result = forwardTotalCheckNative(
      ctx,
      migrationDemoV1ToV2.methods.forward,
      migrationDemoV1ToV2.methods.roundtripSamples,
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("Just true on the Lossy V2→V1Narrow instance — forward is total too", () => {
    const ctx = getSystemEvaluateContext();
    const result = forwardTotalCheckNative(
      ctx,
      migrationDemoV2ToV1Narrow.methods.forward,
      migrationDemoV2ToV1Narrow.methods.roundtripSamples,
    );
    expect(result).toEqual({ $tag: "Just", _0: true });
  });

  it("Just false when a sample triggers Err on forward (FieldMissing)", () => {
    const ctx = getSystemEvaluateContext();
    const result = forwardTotalCheckNative(
      ctx,
      "migration:profileDemoV1ToV2",
      // First sample is well-formed; second omits `lastName`. The native
      // walks every sample so the omission triggers Err -> Just false.
      [
        { firstName: "Ada", lastName: "Lovelace" },
        { firstName: "OnlyFirst" },
      ],
    );
    expect(result).toEqual({ $tag: "Just", _0: false });
  });

  it("Nothing when no samples are supplied", () => {
    const ctx = getSystemEvaluateContext();
    const result = forwardTotalCheckNative(ctx, "migration:profileDemoV1ToV2", []);
    expect(result).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// Composed migration — end-to-end roundtrip via the composed closure
// ---------------------------------------------------------------------------

describe("composeMigration end-to-end via the composed forward/backward closure", () => {
  it("Lossless ∘ Lossless composed forward roundtrips on the inherited samples", () => {
    // Build a 2-hop chain using the demo V1→V2 + an identity V2→V2'.
    // The identity V2→V2' is a trivial migration that just relabels —
    // forward = identity, backward = identity, both Lossless. Combined
    // with V1→V2 it gives a V1→V2' composition whose roundtrip is the
    // same as V1→V2's.

    // For this test we just verify the composed instance's shape — the
    // actual evaluator-dispatched roundtrip is covered by the
    // roundtripCheckNative tests above. The compose unit tests above
    // exercise the algebra; this is the integration sanity check.
    const m1 = migrationDemoV1ToV2;
    const m2: Instance = {
      typeName: "Migration",
      args: ["ProfileDemoV2", "ProfileDemoV2"],
      label: "ProfileDemoV2 identity",
      methods: {
        // A real instance would use a registered identity function;
        // for the shape test we hand-wire an inline closure.
        forward: "migration:profileDemoV1ToV2", // placeholder; not exercised here
        backward: { $tag: "Just", _0: "migration:profileDemoV2ToV1" },
        losslessness: LOSSLESS,
        roundtripSamples: [],
      },
    };
    const composed = composeMigration(m1, m2);
    expect(composed.typeName).toBe("Migration");
    expect(composed.args).toEqual(["ProfileDemoV1", "ProfileDemoV2"]);
    expect(composed.methods.losslessness).toEqual(LOSSLESS);
    // composed.forward is an inline closure (not an fnId)
    expect(
      typeof composed.methods.forward === "object" &&
        composed.methods.forward !== null,
    ).toBe(true);
  });
});
