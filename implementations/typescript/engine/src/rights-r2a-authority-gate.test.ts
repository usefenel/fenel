// ---------------------------------------------------------------------------
// rights R2a — the fail-closed perform gate, the Fenel checker, the admission
// grammar, and the outcome/alias/override seams.
//
// Brief: `workstreams/rights/briefs/r2a-authority-spine-i.md` §6 items 1–14.
//
// ⚠ EVERY PIN HERE WAS REDDENED BEFORE IT WAS TRUSTED, one neuter at a time.
// The observed red text per pin is recorded in the phase completion note. A pin
// whose red was never observed is not a pin.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { mintAuthority, authenticateAuthority } from "./authority";
import { perform, type PerformOutcome } from "./perform";
import { dispatchedContains } from "./engine-bodies-dispatch";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { FenelModule, SetExpr } from "./types";
import {
  authorityTestKernel,
  mintTestAuthority,
  mintTestAuthorityFor,
  mintTestAuthorityForNothing,
  testDescriptorEnvelope,
  testPerformTable,
} from "./authority-test-support";

const LONG = 200_000;

function enumSet(values: readonly unknown[]): unknown {
  return { $tag: "SeEnum", values: [...values] };
}
function interval(
  lo: { value: unknown; inclusive: boolean } | undefined,
  hi: { value: unknown; inclusive: boolean } | undefined,
): unknown {
  return {
    $tag: "SeInterval",
    interval: {
      lo: lo === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: lo },
      hi: hi === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: hi },
    },
  };
}
/** rights R2b — call an `authority:` body the way a FENEL CALLER would.
 *
 *  `evaluateAuthorityFunction` is the HOST POLICY SEAM and is now an allowlist
 *  (`AUTHORITY_SEAM_FUNCTION_IDS`): the entry points the mint and the gate use,
 *  and nothing else. `memberScalar` / `scalarSetOk` / `scalarSetShapeOk` are
 *  internal predicates — they answer a question about a SET, not about an act,
 *  and no product caller asks them. The ledger's cross-face pins still have to,
 *  so they reach them through ordinary evaluation, which is what the decider
 *  face (`dispatchedContains`) does too. Arguments ride as bound vars because a
 *  raw `$tag` object in a call position is not a literal. */
function callAuthorityBody(
  registry: ReturnType<typeof createRegistry>,
  id: string,
  args: readonly unknown[],
): unknown {
  const data: Record<string, unknown> = {};
  const call: unknown[] = [id];
  args.forEach((value, index) => {
    data[`a${index}`] = value;
    call.push({ var: `a${index}` });
  });
  return evaluate({ call } as never, data, registry.evaluateContext());
}

function rowEnvelope(rows: readonly unknown[]): unknown {
  return { $tag: "EvRows", rows: [...rows] };
}
function row(descriptors: unknown, args: readonly unknown[] = []): unknown {
  return { $tag: "ActRow", descriptors, args: [...args] };
}

describe("rights R2a — the fail-closed authority gate", () => {
  test("1–3 — absent, forged, and consult-before-existence", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let leafHits = 0;
    table.register("probe:a", () => { leafHits++; return "a"; }, 0);

    // 1 — a frame with no authority refuses every perform, and the leaf is
    // never reached. Neuter: reintroduce a bootstrap fallback in `perform`.
    const noAuthority: EvaluateContext = { _performTable: table.handle };
    expect(() => perform(noAuthority, { descriptor: "probe:a", args: [] }))
      .toThrow(/authority refused "probe:a" \(absent\)/);
    expect(leafHits).toBe(0);

    // 2 — a fresh `{}` is not a minted handle. Neuter: skip authentication.
    const forged: EvaluateContext = {
      _performTable: table.handle,
      _authority: Object.freeze({}) as never,
    };
    expect(() => perform(forged, { descriptor: "probe:a", args: [] }))
      .toThrow(/authority refused "probe:a" \(unauthenticated\)/);
    expect(leafHits).toBe(0);

    // 3 — EXISTENCE IS REVEALED ONLY TO AN AUTHORISED ACT. An unregistered
    // descriptor under a refusing envelope is a refusal, not "no
    // implementation"; under a permitting one it is "no implementation".
    // Neuter: move the table lookup back above the consult.
    const refusing: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityForNothing(registry),
    };
    expect(() => perform(refusing, { descriptor: "secret:leaf", args: [] }))
      .toThrow(/authority refused "secret:leaf" \(refused\)/);
    const permitting: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["secret:leaf"], registry),
    };
    expect(() => perform(permitting, { descriptor: "secret:leaf", args: [] }))
      .toThrow(/no implementation for "secret:leaf"/);
    expect(leafHits).toBe(0);
  }, LONG);

  test("4–5 — an abstention refuses, a throwing checker refuses, and the checker cannot perform", () => {
    // A registry whose `authority` module is a STAND-IN lets the checker itself
    // be put under test. The prepend is skipped because a module named
    // `authority` is already present.
    const abstaining: FenelModule = {
      name: "authority",
      label: "Stand-in authority",
      functions: [{
        id: "authority:permits",
        params: [
          { name: "envelope", type: { $ref: "Any" } },
          { name: "act", type: { $ref: "Any" } },
        ] as never,
        returns: { $ref: "Any" },
        // `crypto:uuidV4` is requires-bearing in a full registry and is not
        // under `authority:` / `std:` — the kernel frame refuses to resolve it,
        // so the call evaluates to null and the verdict is unreadable.
        body: { call: ["crypto:uuidV4"] },
      } as never],
    };
    const abstainingRegistry = createRegistry([stdModule, abstaining]);
    const abstainingTable = testPerformTable(abstainingRegistry);
    let abstainHits = 0;
    abstainingTable.register("probe:a", () => { abstainHits++; return "a"; }, 0);
    expect(() => perform(
      {
        _performTable: abstainingTable.handle,
        _authority: mintTestAuthorityFor(["probe:a"]),
      },
      { descriptor: "probe:a", args: [] },
    )).toThrow(/authority refused "probe:a" \(undecided\)/);
    expect(abstainHits).toBe(0);

    // A checker that THROWS is a refusal, not a pass. Unbounded self-recursion
    // is the cheapest reliable throw. Neuter: catch-and-proceed in `perform`.
    const throwing: FenelModule = {
      name: "authority",
      label: "Throwing authority",
      functions: [{
        id: "authority:permits",
        params: [
          { name: "envelope", type: { $ref: "Any" } },
          { name: "act", type: { $ref: "Any" } },
        ] as never,
        returns: { $ref: "Any" },
        body: { call: ["authority:permits", { var: "envelope" }, { var: "act" }] },
      } as never],
    };
    const throwingRegistry = createRegistry([stdModule, throwing]);
    const throwingTable = testPerformTable(throwingRegistry);
    let throwHits = 0;
    throwingTable.register("probe:a", () => { throwHits++; return "a"; }, 0);
    expect(() => perform(
      {
        _performTable: throwingTable.handle,
        _authority: mintTestAuthorityFor(["probe:a"]),
      },
      { descriptor: "probe:a", args: [] },
    )).toThrow(/authority refused "probe:a" \(checker-failed\)/);
    expect(throwHits).toBe(0);

    // The seam admits only `authority:` names, so the checker cannot be used as
    // a general evaluation door into the registry.
    expect(() => authorityTestKernel().evaluateAuthorityFunction("std:add", [1, 2]))
      .toThrow(/is not an authority function/);
  }, LONG);

  test("6 — the descriptor axis permits exactly what it enumerates", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let aHits = 0;
    let bHits = 0;
    table.register("probe:a", () => { aHits++; return "a"; }, 0);
    table.register("probe:b", () => { bHits++; return "b"; }, 0);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthority(rowEnvelope([row(enumSet(["probe:a"]))]), registry),
    };
    expect(perform(frame, { descriptor: "probe:a", args: [] })).toBe("a");
    expect(() => perform(frame, { descriptor: "probe:b", args: [] }))
      .toThrow(/authority refused "probe:b" \(refused\)/);
    expect(aHits).toBe(1);
    expect(bHits).toBe(0);
  }, LONG);

  test("7 — an ArgField axis constrains one named entry of the params record", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let hits = 0;
    table.register("state.create_instance", (_f, args) => { hits++; return args[0]; }, 0);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthority(rowEnvelope([row(
        enumSet(["state.create_instance"]),
        [{ $tag: "ArgField", name: "typeId", set: enumSet(["Customer"]) }],
      )]), registry),
    };
    expect(perform(frame, { descriptor: "state.create_instance", args: [{ typeId: "Customer" }] }))
      .toEqual({ typeId: "Customer" });
    expect(() => perform(frame, { descriptor: "state.create_instance", args: [{ typeId: "User" }] }))
      .toThrow(/\(refused\)/);
    // An absent field is NOT satisfied by the act's silence.
    expect(() => perform(frame, { descriptor: "state.create_instance", args: [{ other: 1 }] }))
      .toThrow(/\(refused\)/);
    expect(hits).toBe(1);
  }, LONG);

  test("8 — an ArgValue interval axis constrains a positional argument", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let hits = 0;
    table.register("probe:ranged", (_f, args) => { hits++; return args[0]; }, 0);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthority(rowEnvelope([row(
        enumSet(["probe:ranged"]),
        [{
          $tag: "ArgValue",
          set: interval({ value: 0, inclusive: true }, { value: 10, inclusive: true }),
        }],
      )]), registry),
    };
    expect(perform(frame, { descriptor: "probe:ranged", args: [5] })).toBe(5);
    expect(() => perform(frame, { descriptor: "probe:ranged", args: [11] })).toThrow(/\(refused\)/);
    // ⚠ A KIND MISMATCH IS A DEFINITE `false`, NOT AN ABSTENTION. The brief
    // specified `Nothing` here; the shipped decider's interval arm is TOTAL
    // (`classifyIntervalValue` sends a non-number non-string to `IvOther` and
    // `inInterval` returns `false`), and the cross-face agreement pin below is
    // the stronger claim, so this rule follows the decider. Both refuse.
    expect(() => perform(frame, { descriptor: "probe:ranged", args: ["x"] })).toThrow(/\(refused\)/);
    // More axes than arguments refuses.
    expect(() => perform(frame, { descriptor: "probe:ranged", args: [] })).toThrow(/\(refused\)/);
    expect(hits).toBe(1);
  }, LONG);

  test("9 — memberScalar agrees with setAlgebraContains across the admitted fragment", () => {
    const registry = authorityTestKernel();
    const sets: unknown[] = [
      { $tag: "SeNone" },
      { $tag: "SeAll" },
      enumSet([]),
      enumSet(["a"]),
      enumSet(["a", "b", "c"]),
      enumSet([1, 2, 3]),
      enumSet([true, false]),
      enumSet(["a", 1, true]),
      interval({ value: 0, inclusive: true }, { value: 10, inclusive: true }),
      interval({ value: 0, inclusive: false }, { value: 10, inclusive: false }),
      interval({ value: 0, inclusive: true }, undefined),
      interval(undefined, { value: 10, inclusive: false }),
      interval({ value: "a", inclusive: true }, { value: "m", inclusive: true }),
      { $tag: "SeUnion", branches: [enumSet(["a"]), enumSet(["b"])] },
      { $tag: "SeUnion", branches: [] },
      { $tag: "SeIntersect", branches: [enumSet(["a", "b"]), enumSet(["b", "c"])] },
      { $tag: "SeIntersect", branches: [] },
      { $tag: "SeDiff", left: enumSet(["a", "b"]), right: enumSet(["b"]) },
      {
        $tag: "SeDiff",
        left: enumSet(["a", "b"]),
        right: { $tag: "SeComplement", inner: enumSet(["b"]) },
      },
      { $tag: "SeComplement", inner: enumSet(["a"]) },
      {
        $tag: "SeUnion",
        branches: [
          interval({ value: 0, inclusive: true }, { value: 5, inclusive: true }),
          enumSet(["x"]),
        ],
      },
    ];
    const values: unknown[] = [
      "a", "b", "c", "m", "x", "", 0, 1, 5, 10, 11, -1, true, false, 0.5,
    ];
    let compared = 0;
    const disagreements: string[] = [];
    for (const set of sets) {
      for (const value of values) {
        const mine = callAuthorityBody(registry, "authority:memberScalar", [set, value]);
        const theirs = dispatchedContains(set as SetExpr, value, null);
        compared++;
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          disagreements.push(
            `${JSON.stringify(set)} ∋ ${JSON.stringify(value)}: `
            + `authority=${JSON.stringify(mine)} decider=${JSON.stringify(theirs)}`,
          );
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(200);
    expect(disagreements).toEqual([]);
  }, LONG);

  test("10 — admission refuses every former outside the fragment, at mint AND at exercise", () => {
    const registry = authorityTestKernel();
    const excluded: Array<readonly [string, unknown]> = [
      ["SeAll", { $tag: "SeAll" }],
      ["bare SeComplement", { $tag: "SeComplement", inner: enumSet(["a"]) }],
      ["SeRef", { $tag: "SeRef", handle: "Bot" }],
      ["SeWhere", { $tag: "SeWhere", pred: { var: "x" } }],
      ["SePattern", { $tag: "SePattern", pattern: { $tag: "SpEps" } }],
      ["SeCtor", { $tag: "SeCtor", ctor: "Just", fields: [] }],
      ["SeMu", { $tag: "SeMu", var: "X", body: { $tag: "SeNone" } }],
      ["SeArrow", { $tag: "SeArrow", params: [], returns: { $tag: "SeNone" } }],
      ["SeRigid", { $tag: "SeRigid", scopeToken: "s", ordinal: 0, kind: {} }],
      // The two other spellings of the universe.
      ["empty SeIntersect", { $tag: "SeIntersect", branches: [] }],
      ["unbounded SeInterval", interval(undefined, undefined)],
      ["mixed-kind interval", interval({ value: 0, inclusive: true }, { value: "z", inclusive: true })],
      // A STRING `values` is DENOTATION-critical, not a resource bound: the
      // host `elem` does SUBSTRING search on a string haystack, so it permits
      // every descriptor that is a substring of it.
      // ⚠ BUILT RAW, NOT THROUGH `enumSet`, WHICH SPREADS. `[...someString]` is
      // an array of characters, which is a perfectly well-formed enum — the
      // fixture has to carry the STRING itself to be the case it names.
      ["string enum values", { $tag: "SeEnum", values: "state.list_instances_by_name" }],
      // rights R2b commit 0 — THE THIRD ADMISSION HOLE, previously unpinned.
      // R2a's review found it (`lo = Just ""` with no `hi` denotes EVERY
      // string) and fixed it by requiring BOTH bounds, but no fixture carried a
      // half-open interval, so the fix was unobserved. Neuter:
      // `authorityIntervalBoundedOk`'s `or` back to `and`.
      ["half-open string interval", interval({ value: "", inclusive: true }, undefined)],
      ["half-open numeric interval", interval(undefined, { value: 10, inclusive: true })],
    ];
    // ⚠ RESOURCE BOUNDS ARE MINT-ONLY, AND THE SPLIT IS THE POINT. None of
    // these can change what a set DENOTES — `elem` matches an object by
    // reference across a boundary no Fenel value crosses, and an over-long or
    // non-finite member is simply one more member the envelope's author put
    // there — so re-checking them per act bought nothing and cost 12 ms on
    // every IO act (ledger `au.wf.shape`). They are refused at the MINT.
    const mintOnly: Array<readonly [string, unknown]> = [
      ["non-scalar enum member", enumSet([{ a: 1 }])],
      ["oversized enum", enumSet(Array.from({ length: 65537 }, (_v, i) => `d${i}`))],
      ["oversized string", enumSet(["x".repeat(257)])],
      ["NaN in enum", enumSet([Number.NaN])],
      ["Infinity in enum", enumSet([Number.POSITIVE_INFINITY])],
      // rights R2b commit 0 — THE FIRST ADMISSION HOLE, previously unpinned.
      // `gte x -1.79e308` lowers to a SUBTRACTION in both parsers, so the lower
      // bound was dead code and `-Infinity` was admitted as a finite scalar.
      // R2a spelled it `sub 0 …`; nothing observed the difference, because the
      // only fixture was POSITIVE infinity, which the UPPER bound already
      // refuses. Neuter: `let lowest = 0 - 1.7976931348623157e308` written as
      // `-1.7976931348623157e308`.
      ["negative Infinity in enum", enumSet([Number.NEGATIVE_INFINITY])],
    ];
    for (const [name, set] of mintOnly) {
      expect(
        callAuthorityBody(registry, "authority:scalarSetOk", [set, 0]),
        `scalarSetOk admitted ${name}`,
      ).toBe(false);
      expect(
        () => mintTestAuthority(rowEnvelope([row(set)]), registry),
        `mint admitted ${name}`,
      ).toThrow(/authority mint refused/);
      // And each is DELIBERATELY admitted at exercise, answering a definite
      // rather than abstaining — which is only safe because none of them
      // widens membership.
      expect(
        callAuthorityBody(registry, "authority:scalarSetShapeOk", [set, 0]),
        `scalarSetShapeOk refused the resource-only ${name}`,
      ).toBe(true);
    }
    for (const [name, set] of excluded) {
      expect(
        callAuthorityBody(registry, "authority:scalarSetOk", [set, 0]),
        `scalarSetOk admitted ${name}`,
      ).toBe(false);
      expect(
        () => mintTestAuthority(rowEnvelope([row(set)]), registry),
        `mint admitted ${name}`,
      ).toThrow(/authority mint refused/);
    }
    // Depth: nine nested unions exceed the depth-8 budget.
    let deep: unknown = enumSet(["a"]);
    for (let i = 0; i < 9; i++) deep = { $tag: "SeUnion", branches: [deep] };
    expect(callAuthorityBody(registry, "authority:scalarSetOk", [deep, 0])).toBe(false);
    // 257 rows exceed the row cap.
    const tooManyRows = rowEnvelope(
      Array.from({ length: 257 }, (_v, i) => row(enumSet([`d${i}`]))),
    );
    expect(() => mintTestAuthority(tooManyRows, registry)).toThrow(/more than 256 rows/);

    // ⚠ EXERCISE-TIME RE-VALIDATION IS THE ONE THAT CANNOT BE BYPASSED. The
    // handle below is minted over an ADMITTED envelope and then judged against
    // an envelope value that was never admitted, which is what a future writer
    // of the private table could do by accident. Neuter: drop the `scalarSetOk`
    // call in `authorityAxisMember`.
    for (const [name, set] of excluded) {
      const verdict = registry.evaluateAuthorityFunction("authority:permits", [
        rowEnvelope([row(set)]),
        { $tag: "Act", descriptor: "probe:a", args: [], fields: [] },
      ]);
      expect(verdict, `exercise admitted ${name}`).toEqual({ $tag: "Nothing" });
    }
    // The string-enum case is the one that proves the split is not just
    // "exercise checks less": a substring match would answer `Just true` here.
    expect(registry.evaluateAuthorityFunction("authority:permits", [
      rowEnvelope([row({ $tag: "SeEnum", values: "state.list_instances_by_name" })]),
      { $tag: "Act", descriptor: "state.list_instances", args: [], fields: [] },
    ])).toEqual({ $tag: "Nothing" });
  }, LONG);

  test("11 — the universe is mintable only by the registry bootstrap", () => {
    const registry = authorityTestKernel();
    const top = registry.evaluateAuthorityFunction("authority:topEnvelope", [0]);
    for (const issuer of ["request-session", "identity-door", "interim-worker", "anonymous", "test"] as const) {
      expect(() => mintAuthority(registry, {
        envelope: top,
        issuer,
        accountId: null,
        principal: null,
        lane: null,
        grant: null,
        mintedAt: 0,
      }), issuer).toThrow(/registry-bootstrap/);
    }
    // The bootstrap authority itself IS Top, and it is what `evaluateContext`
    // carries. rights R4 retires it.
    const bootstrap = authenticateAuthority(registry.evaluateContext()._authority);
    expect(bootstrap?.issuer).toBe("registry-bootstrap");
    expect(bootstrap?.envelope).toEqual({ $tag: "EvTop" });
  }, LONG);

  test("12 — the outcome hook classifies settled and failed without altering the value", async () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    const seen: Array<{ descriptor: string; kind: string }> = [];
    const off = table.onOutcome((act, outcome: PerformOutcome) => {
      seen.push({ descriptor: act.descriptor, kind: outcome.kind });
    });
    table.register("probe:sync", () => "sync", 0);
    table.register("probe:throws", () => { throw new Error("boom"); }, 0);
    const resolved = Promise.resolve("async");
    table.register("probe:resolves", () => resolved, 0);
    table.register("probe:rejects", () => Promise.reject(new Error("nope")), 0);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(
        ["probe:sync", "probe:throws", "probe:resolves", "probe:rejects"],
        registry,
      ),
    };
    expect(perform(frame, { descriptor: "probe:sync", args: [] })).toBe("sync");
    // A throwing implementation propagates; the observer still sees it.
    expect(() => perform(frame, { descriptor: "probe:throws", args: [] })).toThrow(/boom/);
    // THE CALLER RECEIVES THE IMPLEMENTATION'S OWN PROMISE, not a derived one.
    const returned = perform(frame, { descriptor: "probe:resolves", args: [] });
    expect(returned).toBe(resolved);
    expect(await returned).toBe("async");
    const rejecting = perform(frame, { descriptor: "probe:rejects", args: [] }) as Promise<unknown>;
    await expect(rejecting).rejects.toThrow(/nope/);
    await Promise.resolve();
    expect(seen).toEqual([
      { descriptor: "probe:sync", kind: "settled" },
      { descriptor: "probe:throws", kind: "failed" },
      { descriptor: "probe:resolves", kind: "settled" },
      { descriptor: "probe:rejects", kind: "failed" },
    ]);
    off();
    perform(frame, { descriptor: "probe:sync", args: [] });
    expect(seen).toHaveLength(4);
  }, LONG);

  test("13 — an alias follows its target at call time", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    table.register("alias.target", () => "first", 0);
    expect(table.alias("alias.name", "alias.target")).toBe(true);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["alias.name", "alias.target"], registry),
    };
    expect(perform(frame, { descriptor: "alias.name", args: [] })).toBe("first");
    // RE-REGISTERING THE TARGET IS VISIBLE THROUGH THE ALIAS. Neuter: store the
    // target entry object at alias time instead of its name.
    table.register("alias.target", () => "second", 0);
    expect(perform(frame, { descriptor: "alias.target", args: [] })).toBe("second");
    expect(perform(frame, { descriptor: "alias.name", args: [] })).toBe("second");
    // ⚠ RETIRED AND REVERSED BY rights R2b, deliberately. R2a asserted here
    // that "an alias is still judged on its OWN descriptor, not its target's".
    // Canonical acts make the opposite the rule (ledger `au.gate.canonical`):
    // an act has ONE name, `perform` resolves the requested descriptor through
    // the alias BEFORE judging, and the envelope therefore names the TARGET.
    // The old reading is what forced every policy list to carry both spellings
    // of every act, which is how R2a's most serious defect shipped.
    const targetOnly: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["alias.target"], registry),
    };
    expect(perform(targetOnly, { descriptor: "alias.name", args: [] })).toBe("second");
    // And the reverse does NOT hold: naming the ALIAS spelling permits nothing,
    // because no act is ever judged under it.
    const aliasOnly: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthorityFor(["alias.name"], registry),
    };
    expect(() => perform(aliasOnly, { descriptor: "alias.name", args: [] }))
      .toThrow(/authority refused "alias.target" \(refused\)/);
    expect(() => perform(aliasOnly, { descriptor: "alias.target", args: [] }))
      .toThrow(/authority refused "alias.target" \(refused\)/);
  }, LONG);

  test("14 — listPerformDescriptors reveals names and no implementation", () => {
    const registry = authorityTestKernel();
    const before = registry.listPerformDescriptors();
    expect(Array.isArray(before)).toBe(true);
    expect([...before].sort()).toEqual(before);
    registry.registerIOHandler("probe.listed", async () => ({ action: "continue", value: 1 }));
    expect(registry.listPerformDescriptors()).toContain("probe.listed");
    for (const entry of registry.listPerformDescriptors()) {
      expect(typeof entry).toBe("string");
    }
  }, LONG);

  test("every role envelope excludes exactly the session leaves", () => {
    const registry = authorityTestKernel();
    const fenced = registry.evaluateAuthorityFunction(
      "authority:sessionLeafDescriptors", [0],
    ) as string[];
    // ⚠ ONE SPELLING (rights R2b). R2a carried both faces of every leaf here;
    // canonical acts retire the dual spelling, and the `descriptor-canonical`
    // audit rule refuses a dotted literal anywhere in the policy module.
    expect(fenced).toContain("state:createSession");
    expect(fenced).toContain("state:setUserPasswordHash");
    for (const leaf of fenced) expect(leaf, leaf).not.toMatch(/^[a-z][a-z0-9_]*\.[a-z_0-9]+$/);
    // Reading whether a membership exists is an authorization INPUT, not an
    // identity mutation, so it is not fenced. Neither is CREATING one any more
    // (rights R2b ruling 5): an account owner legitimately introduces a member,
    // and the owner envelope's argued axes are what fence it.
    expect(fenced).not.toContain("state:getMembership");
    expect(fenced).not.toContain("state:createMembership");

    const all = [...fenced, "state:getInstance", "state:createInstance"];
    // EVERY role, not just one: the session leaves are in no account envelope.
    for (const role of ["owner", "member", "viewer", "janitor"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, "acct", all, []],
      );
      const permitted = (descriptor: string) => registry.evaluateAuthorityFunction(
        "authority:permits",
        [envelope, { $tag: "Act", descriptor, args: [], fields: [] }],
      );
      // The control: a general descriptor IS reachable for every KNOWN role,
      // so the refusals below are not "this envelope permits nothing".
      expect(permitted("state:getInstance"), role).toEqual(
        { $tag: "Just", _0: role === "janitor" ? false : true },
      );
      for (const leaf of fenced) {
        expect(permitted(leaf), `${role}/${leaf}`).toEqual({ $tag: "Just", _0: false });
      }
    }
    // The identity realm is a POSITIVE enumeration that does include them.
    const realm = registry.evaluateAuthorityFunction("authority:identityRealmEnvelope", [registry.listPerformDescriptors()]);
    for (const leaf of fenced) {
      expect(
        registry.evaluateAuthorityFunction("authority:permits", [
          realm, { $tag: "Act", descriptor: leaf, args: [], fields: [] },
        ]),
        leaf,
      ).toEqual({ $tag: "Just", _0: true });
    }
    expect(
      registry.evaluateAuthorityFunction("authority:permits", [
        realm, { $tag: "Act", descriptor: "state:createInstance", args: [], fields: [] },
      ]),
    ).toEqual({ $tag: "Just", _0: false });
  }, LONG);

  test("the act projection reads own DATA only — never a getter, never a prototype", () => {
    const registry = authorityTestKernel();
    const table = testPerformTable(registry);
    let hits = 0;
    table.register("probe:fields", () => { hits++; return "ok"; }, 0);
    const frame: EvaluateContext = {
      _performTable: table.handle,
      _authority: mintTestAuthority(rowEnvelope([row(
        enumSet(["probe:fields"]),
        [{ $tag: "ArgField", name: "kind", set: enumSet(["allowed"]) }],
      )]), registry),
    };
    let getterReads = 0;
    const hostile = {
      get kind() { getterReads++; return "allowed"; },
    };
    expect(() => perform(frame, { descriptor: "probe:fields", args: [hostile] }))
      .toThrow(/\(refused\)/);
    expect(getterReads).toBe(0);
    expect(hits).toBe(0);
    const inherited = Object.create({ kind: "allowed" }) as Record<string, unknown>;
    expect(() => perform(frame, { descriptor: "probe:fields", args: [inherited] }))
      .toThrow(/\(refused\)/);
    expect(hits).toBe(0);
    expect(perform(frame, { descriptor: "probe:fields", args: [{ kind: "allowed" }] })).toBe("ok");
    expect(hits).toBe(1);
  }, LONG);

  test("a minted authority is opaque: the handle carries no envelope and cannot be forged", () => {
    const registry = authorityTestKernel();
    const handle = mintTestAuthorityFor(["probe:a"], registry);
    expect(Object.keys(handle as object)).toEqual([]);
    expect(JSON.stringify(handle)).toBe("{}");
    expect(Object.isFrozen(handle)).toBe(true);
    expect(authenticateAuthority(handle)?.issuer).toBe("test");
    expect(authenticateAuthority({ ...(handle as object) } as never)).toBeUndefined();
    expect(authenticateAuthority(undefined)).toBeUndefined();
    // The descriptor envelope is data, and the same value can back two handles.
    const envelope = testDescriptorEnvelope(["probe:a"], registry);
    expect(mintTestAuthority(envelope, registry))
      .not.toBe(mintTestAuthority(envelope, registry));
  }, LONG);
});
