// ---------------------------------------------------------------------------
// rights R3a §6 pin 22 — THE FLIP.
//
// `instanceVisible` used to end `return true`, so an unrecognised scope shape
// was VISIBLE: a row nobody could name was selected by everybody. The flip
// closes that and the retired bare `"account"` bucket, which had no account id
// in it and is written by nothing after R3a.
//
// ⚠ ABSENT STAYS GLOBAL, and that is the positive control. Absent is the BOOT
// spelling — `system-entities.ts`'s registrations, `registerValue`, the
// classifier stubs — and treating it as invisible would be a total dispatch
// outage dressed as a fence.
//
// Brief: `workstreams/rights/briefs/r3a-account-partitioned-dispatch.md` §6
// pin 22 and §4.4.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { GLOBAL_ONLY, createDispatchRegistry, instanceVisible, type InstanceVisibility } from "./dispatch-registry";
import { createRegistry } from "./registry";

const A = "r3a-flip-account-a";
const LONG = 200_000;

const frame = (account: string | null, tags: readonly string[] = []): InstanceVisibility =>
  ({ kind: "frame", account, tags });

const row = (scope: unknown) => ({ typeName: "R3aFlip", args: ["K"], methods: {}, scope }) as never;

describe("rights R3a — the flip", () => {
  test("pin 22 — three invisible shapes, and the boot spellings still visible", () => {
    const withTag = frame(A, ["account", "experiment"]);
    const plain = frame(A);

    // MUTANT 1 — an unrecognised object `kind`. Not a tag: a real tag is
    // `{kind:"tag", tag:"experiment"}`, which stays visible when active.
    expect(instanceVisible(row({ kind: "experiment" }), withTag)).toBe(false);
    expect(instanceVisible(row({ kind: "experiment" }), plain)).toBe(false);
    expect(instanceVisible(row({ kind: "experiment" }), GLOBAL_ONLY)).toBe(false);

    // MUTANT 2 — the legacy bare `"account"` bucket, WITH the `account` tag
    // active. This is the one a tag-based reading would let through.
    expect(instanceVisible(row("account"), withTag)).toBe(false);
    expect(instanceVisible(row("account"), plain)).toBe(false);

    // MUTANT 3 — an EXPLICIT null. ⚠ NOT the same fact as an absent key
    // (review round 6, Astra): `undefined` is "this row never said", which is
    // the boot spelling below; `null` is "this row says nothing", which is what
    // a JSON transport writes for a field that was emptied. It used to be
    // admitted as global, so a `{scope: null}` row at priority 100 beat a
    // global boot row and was selected by A, by B AND under `GLOBAL_ONLY`.
    expect(instanceVisible(row(null), plain)).toBe(false);
    expect(instanceVisible(row(null), withTag)).toBe(false);
    expect(instanceVisible(row(null), GLOBAL_ONLY)).toBe(false);

    // MUTANT 4 — an account case whose id is not a non-empty string.
    expect(instanceVisible(row({ kind: "account", accountId: null }), plain)).toBe(false);
    expect(instanceVisible(row({ kind: "account", accountId: "" }), plain)).toBe(false);
    expect(instanceVisible(row({ kind: "account", accountId: 7 }), plain)).toBe(false);

    // POSITIVE CONTROLS — the boot spellings, and the axes that are NOT flipped.
    expect(instanceVisible(row(undefined), plain)).toBe(true);
    expect(instanceVisible(row("global"), plain)).toBe(true);
    expect(instanceVisible(row({ kind: "global" }), plain)).toBe(true);
    expect(instanceVisible(row(undefined), GLOBAL_ONLY)).toBe(true);
    expect(instanceVisible(row("global"), GLOBAL_ONLY)).toBe(true);
    // a GENUINE tag still works when active, and is still gated when not
    expect(instanceVisible(row({ kind: "tag", tag: "experiment" }), withTag)).toBe(true);
    expect(instanceVisible(row({ kind: "tag", tag: "experiment" }), plain)).toBe(false);
    expect(instanceVisible(row({ kind: "tag", tag: "experiment" }), GLOBAL_ONLY)).toBe(false);
    // and the ownership axis still admits its owner
    expect(instanceVisible(row({ kind: "account", accountId: A }), plain)).toBe(true);
    expect(instanceVisible(row({ kind: "account", accountId: A }), frame("other"))).toBe(false);
  }, LONG);

  // §6 pin 22 (the PROJECTION half) / §4.6 — the routing table OMITS what the
  // predicate refuses. Projecting an unknown shape as global would make the
  // Fenel resolver select a row the TS resolver refuses, which is the one
  // divergence the twin-parity pin exists to catch (§12 trap 7).
  test("pin 22 — the routing projection omits every row the predicate refuses", () => {
    // ⚠ THE REGISTRY'S OWN DISPATCH POOL, not the context-egress facade — the
    // facade refuses `defineClass` by design, and the projection is built from
    // the pool the registry was constructed with.
    const spec = createDispatchRegistry();
    const reg = createRegistry([], { dispatchRegistry: spec } as never);
    spec.defineClass({
      name: "R3aFlipProjected",
      params: [{ name: "t" }],
      methods: [{ name: "m", params: [], returns: { $ref: "String" } }],
    });
    const add = (key: string, scope: unknown) =>
      spec.addInstance({ typeName: "R3aFlipProjected", args: [key], methods: { m: key }, scope } as never);

    add("boot-absent", undefined);
    add("boot-global-string", "global");
    add("boot-global-adt", { kind: "global" });
    add("owned", { kind: "account", accountId: A });
    add("tagged", { kind: "tag", tag: "experiment" });
    add("legacy-bucket", "account");
    add("unrecognised", { kind: "experiment" });
    add("bad-owner", { kind: "account", accountId: null });
    add("null-scope", null);

    const table = reg.routingTable();
    const idx = (table.instanceIdx as Record<string, Record<string, { scope: { $tag: string; _0?: string } }[]>>)
      ["R3aFlipProjected"] ?? {};
    const projected = Object.fromEntries(
      Object.entries(idx).map(([key, rows]) => [key, rows.map((r) => r.scope.$tag + (r.scope._0 === undefined ? "" : `:${r.scope._0}`))]),
    );
    expect(projected).toEqual({
      "boot-absent": ["RsvGlobalScope"],
      "boot-global-string": ["RsvGlobalScope"],
      "boot-global-adt": ["RsvGlobalScope"],
      "owned": [`RsvAccountScope:${A}`],
      "tagged": ["RsvTagScope:experiment"],
      // legacy-bucket, unrecognised, bad-owner and null-scope are ABSENT —
      // omitted, not downgraded to global. The projection has to refuse exactly
      // what the predicate refuses, or the Fenel twin selects a row the TS
      // resolver does not.
    });
  }, LONG);
});

// ---------------------------------------------------------------------------
// rights R3a §6 pin 20 — THE TWINS AGREE ON OWNERSHIP, through the PRODUCTION
// projection.
//
// ⚠ THIS EXISTS BECAUSE THE INHERITED PARITY ORACLE DOES NOT COVER IT (review
// round 2, Astra). `resolution-substrate-phase5.test.ts` compares the TS and
// Fenel resolvers over the projected table, but every one of its fixtures
// passes `Nothing` for the account — so replacing the Fenel account arm with
// `false` leaves the whole oracle green while an authenticated account silently
// resolves the repository row instead of its own. The phase's declared
// deviation D3 leaned on that oracle for the ownership half; it does not carry
// it, and this pin is what does.
// ---------------------------------------------------------------------------

describe("rights R3a — the twins agree on ownership", () => {
  test("pin 20 — TS and Fenel select the SAME row for A, for B, and for an anonymous frame", async () => {
    const { createRegistry } = await import("./registry");
    const { createDispatchRegistry, instanceVisible } = await import("./dispatch-registry");

    const OWNER_A = "r3a-twin-a";
    const OWNER_B = "r3a-twin-b";
    const spec = createDispatchRegistry();
    const reg = createRegistry([], { dispatchRegistry: spec } as never);
    spec.defineClass({
      name: "R3aTwin",
      params: [{ name: "t" }],
      methods: [{ name: "m", params: [], returns: { $ref: "String" }, position: 0 }],
    } as never);
    // A boot row at priority 0, and an OWNED row per account at priority 100 —
    // so ownership, not priority, is what separates the three answers.
    spec.addInstance({ typeName: "R3aTwin", args: ["String"], methods: { m: "boot" }, scope: { kind: "global" } } as never);
    spec.addInstance({
      typeName: "R3aTwin", args: ["String"], methods: { m: "a-owned" },
      scope: { kind: "account", accountId: OWNER_A }, priority: 100,
    } as never);
    spec.addInstance({
      typeName: "R3aTwin", args: ["String"], methods: { m: "b-owned" },
      scope: { kind: "account", accountId: OWNER_B }, priority: 100,
    } as never);

    const table = reg.routingTable();
    const idx = (table.instanceIdx as Record<string, Record<string, Array<{ methods: Record<string, unknown>; scope: { $tag: string; _0?: string } }>>>)
      ["R3aTwin"]?.["String"] ?? [];
    // The PROJECTION carries all three, each with its own coordinate — the
    // Fenel side cannot be right if the projection already lost the ownership.
    expect(idx.map((r) => `${r.methods["m"]}:${r.scope.$tag}${r.scope._0 === undefined ? "" : ":" + r.scope._0}`).sort())
      .toEqual([
        "a-owned:RsvAccountScope:" + OWNER_A,
        "b-owned:RsvAccountScope:" + OWNER_B,
        "boot:RsvGlobalScope",
      ]);

    // THE TS SIDE — the production predicate over the production rows.
    const tsPick = (account: string | null): unknown => {
      const visible = spec.listInstances("R3aTwin")
        .filter((i) => instanceVisible(i, { kind: "frame", account, tags: [] }))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      return visible[0]?.methods["m"];
    };

    // THE FENEL SIDE — `dispatch:rsvInstVisible`, the TWIN of the TS predicate,
    // evaluated over the SAME projected rows the resolver reads.
    //
    // ⚠ THE PREDICATE, NOT THE WHOLE RESOLVER. Routing a fixture class through
    // `rsvResolveBareName` answers `Direct` (no registered bare route) and
    // through `rsvResolveDispatch` answers `NoInstance` (no `posIdx` entry for
    // a fixture method) — in both cases BEFORE any selection happens, so
    // neither can see the account arm at all. The claim under test is that the
    // two visibility predicates agree row for row; this asks them both.
    const { dispatchEngineBody } = await import("./engine-bodies-dispatch");
    const fenelVisible = (row: unknown, account: string | null): unknown =>
      dispatchEngineBody("dispatch:rsvInstVisible", [
        row, [], account === null ? { $tag: "Nothing" } : { $tag: "Just", _0: account },
      ]);

    const cases: Array<[string | null, string]> = [
      [OWNER_A, "a-owned"], [OWNER_B, "b-owned"], [null, "boot"],
    ];
    for (const [account, expected] of cases) {
      expect(tsPick(account)).toBe(expected);

      // ⚠ THE TWIN, ROW FOR ROW. Replacing the Fenel account arm with an
      // unconditional `false` (or an unconditional `true`) moves this and
      // leaves the inherited parity oracle untouched, which is the whole reason
      // this pin exists.
      for (const row of idx) {
        const who = row.methods["m"];
        const tsSays = instanceVisible(
          { scope: row.scope.$tag === "RsvGlobalScope"
            ? { kind: "global" }
            : { kind: "account", accountId: row.scope._0! } } as never,
          { kind: "frame", account, tags: [] },
        );
        const fenelSays = fenelVisible(row, account);
        expect({ who, account, fenel: fenelSays }).toEqual({ who, account, fenel: tsSays });
      }
    }
  }, LONG);
});
