// type-substrate P1(a.18) — the host-evaluator window.
//
// Two independent mechanisms, pinned here because both live in the host
// evaluator and both are observationally silent when they work:
//
//   §A  the constructor-catalog walks are FOLDS, so their host-stack cost is
//       O(1) in the candidate count. Before the fold they were linear
//       self-recursions and the compiled-resolver render died at Fenel depth
//       3565 inside `compilerConstructorProjectionGroups`, which took both
//       compiled owners `STALE` and the identity chain with them.
//
//   §B  every evaluate context of ONE registry shares ONE private
//       routing-table clone per dispatch-registry version. The evaluator's
//       cache used to key on the CONTEXT OBJECT while the decider builds a
//       fresh context per call, `whereMember` per membership and the durable
//       evaluator per turn — so each of those deep-cloned the whole routing
//       graph (~0.6-0.8 s on a real registry).
//
// Both pins are RED-FIRST under a named defeater:
//   §A  revert the fold (`notes/p1a18/apply-fold.py --revert`) — the synthetic
//       20 000-candidate projection overflows.
//   §B  revert the key (`notes/p1a18/apply-key.py --revert`) — three contexts
//       of one registry are handed three distinct tables instead of one.
import { test, expect, describe } from "bun:test";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import {
  dispatchEngineBody,
  dispatchCompiledResolver,
  dispatchCompiledResolveDispatch,
} from "./engine-bodies-dispatch";
import {
  evaluate,
  installServedDispatcher,
  type EvaluateContext,
  type ServedBareNameResolver,
  type ServedDispatchResolver,
} from "./json-logic";

// ---------------------------------------------------------------------------
// §A — the catalog walks are folds
// ---------------------------------------------------------------------------

type Candidate = {
  name: string;
  ownerId: string;
  ownerModule: { $tag: "Nothing" } | { $tag: "Just"; _0: string };
  kind: string;
  fields: unknown[];
  markerFields: unknown[];
};

const candidate = (name: string, ownerId: string): Candidate => ({
  name,
  ownerId,
  ownerModule: { $tag: "Nothing" },
  kind: "record",
  fields: [],
  markerFields: [],
});

const NOTHING = { $tag: "Nothing" } as const;

function projection(
  candidates: readonly Candidate[],
  ownerIds: unknown = NOTHING,
  preferred: readonly string[] = [],
): Record<string, unknown> {
  return dispatchEngineBody("engine:compilerConstructorProjectionPlan", [
    [...candidates],
    ownerIds,
    [...preferred],
  ]) as Record<string, unknown>;
}

describe("P1(a.18) §A — the constructor-catalog walks cost O(1) host stack", () => {
  // The number is deliberately far above ANY measured Fenel-level ceiling on
  // this host (the registry-free instrument in `notes/p1a18/probe-stack-ceiling.ts`
  // measures 6.5k-8.2k levels for a two-to-four-parameter tail recursion), so the
  // pin cannot pass by accident on a machine with a larger stack.
  const N = 20_000;

  test("a 20 000-candidate projection plan completes", () => {
    const candidates = Array.from({ length: N }, (_, i) =>
      candidate(`P1a18Ctor${String(i).padStart(6, "0")}`, `P1a18Owner${i}`));
    const plan = projection(candidates);
    expect(plan["$tag"]).toBe("CcpReady");
    expect((plan["entries"] as unknown[]).length).toBe(N);
    expect((plan["conflicts"] as unknown[]).length).toBe(0);
  }, 900_000);

  test("a 20 000-row catalog plan completes", () => {
    const rows = Array.from({ length: N }, (_, i) => ({
      ownerId: `P1a18Row${i}`,
      ownerModule: NOTHING,
      type: { $tag: "TtRecord", fields: [] },
    }));
    const plan = dispatchEngineBody("engine:compilerConstructorCatalogPlan", [rows]) as
      Record<string, unknown>;
    expect(plan["$tag"]).toBe("CccReady");
    expect((plan["candidates"] as unknown[]).length).toBe(N);
    expect((plan["baseEntries"] as unknown[]).length).toBe(N);
  }, 900_000);

  // ---- equivalence: every arm the recursion had, at the group BOUNDARY -----
  // The fold's one textual departure from the recursion is the boundary arm:
  // the recursion re-entered itself with the SAME candidate after a flush and
  // could only take the `not hasCurrent` branch; the step opens the group
  // directly. These cases drive a boundary in each of the four flush outcomes.

  test("adjacent same-name candidates are ONE group; a boundary opens the next", () => {
    const plan = projection([
      candidate("Alpha", "OwnerA"),
      candidate("Beta", "OwnerB"),
      candidate("Gamma", "OwnerC"),
    ]);
    expect(plan["$tag"]).toBe("CcpReady");
    expect((plan["entries"] as { name: string }[]).map((e) => e.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(plan["conflicts"]).toEqual([]);
  }, 120_000);

  test("a boundary after a CONFLICT group keeps the conflict and opens the next", () => {
    const plan = projection([
      candidate("Dup", "OwnerA"),
      candidate("Dup", "OwnerB"),
      candidate("Last", "OwnerC"),
    ]);
    expect(plan["$tag"]).toBe("CcpReady");
    expect(plan["conflicts"]).toEqual(["Dup"]);
    expect((plan["entries"] as { name: string }[]).map((e) => e.name)).toEqual(["Last"]);
  }, 120_000);

  test("a boundary after a SKIP group (scoped out) opens the next", () => {
    const plan = projection(
      [candidate("Outside", "OwnerA"), candidate("Inside", "OwnerB")],
      { $tag: "Just", _0: ["OwnerB"] },
    );
    expect(plan["$tag"]).toBe("CcpReady");
    expect((plan["entries"] as { name: string }[]).map((e) => e.name)).toEqual(["Inside"]);
    expect(plan["conflicts"]).toEqual([]);
  }, 120_000);

  test("an INVALID group short-circuits and the plan is CcpInvalid", () => {
    // Same owner, same name, under explicit scope ⇒ same-owner drift ⇒ the
    // flush writes `error`, which the recursion returned immediately and the
    // fold turns into an identity step for every remaining candidate.
    const plan = projection(
      [candidate("Drift", "OwnerA"), candidate("Drift", "OwnerA"), candidate("After", "OwnerA")],
      { $tag: "Just", _0: ["OwnerA"] },
    );
    expect(plan["$tag"]).toBe("CcpInvalid");
    expect(String(plan["message"])).toContain("Drift");
  }, 120_000);

  test("a preferred owner resolves a would-be conflict, across a boundary", () => {
    const plan = projection(
      [candidate("Pick", "OwnerA"), candidate("Pick", "OwnerB"), candidate("Tail", "OwnerC")],
      NOTHING,
      ["OwnerB"],
    );
    expect(plan["$tag"]).toBe("CcpReady");
    expect((plan["entries"] as { name: string }[]).map((e) => e.name)).toEqual(["Pick", "Tail"]);
    expect(plan["conflicts"]).toEqual([]);
  }, 120_000);

  // ---- equivalence: the ROWS walk's error short-circuit --------------------
  // The other arm the fold changed from an early RETURN into a guarded identity
  // step. Every pre-existing invalid-slot test in the repo places the bad row
  // FIRST in a single-entity registry (`compiler-field-identity.test.ts:352`,
  // `:762`), so a dropped `CcbInvalid` guard in
  // `compilerConstructorCatalogRowsStep` would go unseen: on `[good, bad, good]`
  // the third step would fall through a wildcard-less `case` to host null and
  // the TS boundary would throw "Fenel returned a non-record boundary value"
  // instead of returning `CccInvalid{message}`. These drive the bad row at each
  // position and pin the MESSAGE, so the first error is still the one that wins.
  //
  // ⚠ THEIR DEFEATER IS NOT `apply-fold.py --revert`. These are EQUIVALENCE
  // pins: they assert the fold agrees with the recursion, and the recursion
  // satisfies them too, so they are green under the fold revert BY DESIGN. The
  // defeater that matters is a BROKEN fold — delete the `CcbInvalid` arm from
  // `compilerConstructorCatalogRowsStep`. OBSERVED under exactly that mutation:
  // `first` and `middle` go RED and the "FIRST invalid row wins" case goes RED,
  // while `last` stays green — because a bad row at the END has no subsequent
  // step to swallow its error, which is precisely why the pre-existing
  // bad-row-first tests could not see this arm.
  const goodRow = (owner: string): Record<string, unknown> => ({
    ownerId: owner,
    ownerModule: NOTHING,
    type: { $tag: "TtRecord", fields: [] },
  });
  // A variant case whose field carries a NEGATIVE positional slot —
  // `fieldKeyValidForBoundary` requires `index >= 0`, so
  // `traversalSemanticSlotsErrorWithSourceHandles` refuses it and names the
  // CASE in the message. Naming the case is what makes "the first error wins"
  // checkable: a malformed shape yields an empty message and would discriminate
  // nothing.
  const NUM = { $tag: "TtNamed", name: "Number" };
  const badRow = (owner: string, ctor: string): Record<string, unknown> => ({
    ownerId: owner,
    ownerModule: NOTHING,
    type: {
      $tag: "TtVariant",
      cases: [{
        name: ctor,
        fields: [{
          semanticKey: { $tag: "PositionalField", index: -1 },
          wireName: "a",
          raw: NUM,
          type: NUM,
        }],
      }],
    },
  });
  const catalog = (rows: readonly Record<string, unknown>[]): Record<string, unknown> =>
    dispatchEngineBody("engine:compilerConstructorCatalogPlan", [[...rows]]) as Record<string, unknown>;

  for (const [label, rows] of [
    ["first", [badRow("B", "BadA"), goodRow("G1"), goodRow("G2")]],
    ["middle", [goodRow("G1"), badRow("B", "BadA"), goodRow("G2")]],
    ["last", [goodRow("G1"), goodRow("G2"), badRow("B", "BadA")]],
  ] as const) {
    test(`an invalid row at position ${label} makes the catalog plan CccInvalid`, () => {
      const plan = catalog(rows as readonly Record<string, unknown>[]);
      expect(plan["$tag"]).toBe("CccInvalid");
      expect(String(plan["message"])).toContain("invalid semantic slots");
      expect(String(plan["message"])).toContain("BadA");
    }, 120_000);
  }

  test("the FIRST invalid row is the one whose message survives", () => {
    const first = catalog([goodRow("G1"), badRow("B1", "AlphaBad"), badRow("B2", "BetaBad")]);
    const second = catalog([goodRow("G1"), badRow("B2", "BetaBad"), badRow("B1", "AlphaBad")]);
    expect(first["$tag"]).toBe("CccInvalid");
    expect(second["$tag"]).toBe("CccInvalid");
    // Order-sensitive: the fold visits every remaining row as an identity step,
    // so a guard that returned the LAST error instead of the first would swap
    // these two messages.
    expect(String(first["message"])).toContain("AlphaBad");
    expect(String(second["message"])).toContain("BetaBad");
    // ... and NOT the later one. Without these two lines a mutated guard that
    // evaluates the row anyway and APPENDS its message keeps every assertion
    // above green, while doing exactly the row work after an error that the
    // equivalence argument says never happens.
    expect(String(first["message"])).not.toContain("BetaBad");
    expect(String(second["message"])).not.toContain("AlphaBad");
    expect(first["message"]).not.toEqual(second["message"]);
  }, 120_000);

  test("the empty candidate list still flushes nothing", () => {
    const plan = projection([]);
    expect(plan["$tag"]).toBe("CcpReady");
    expect(plan["entries"]).toEqual([]);
    expect(plan["conflicts"]).toEqual([]);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// §B — one private routing-table clone per registry per dispatch version
// ---------------------------------------------------------------------------

/** Record the identity of the table object handed to the SERVED resolver.
 *  Counting getter calls would not work: under the new key a wrapper around
 *  `_routingTable` IS a different key, so the instrument would defeat the
 *  mechanism it measures. `installServedDispatcher` is a module-level singleton
 *  with no getter and both installed functions are exported, so the spy
 *  delegates to exactly what the live install uses, and restores it after. */
function tablesHandedTo(run: (record: () => void) => void): unknown[] {
  const seen: unknown[] = [];
  let armed = false;
  const spy: ServedBareNameResolver = (table, name, args, frames, tags, account) => {
    if (armed) seen.push(table);
    return (dispatchCompiledResolver as ServedBareNameResolver)(
      table, name, args, frames, tags, account,
    );
  };
  const live = {
    resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
    resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
  };
  installServedDispatcher({ resolveBareName: spy, resolveDispatch: live.resolveDispatch });
  try {
    run(() => { armed = true; });
  } finally {
    installServedDispatcher(live);
  }
  return seen;
}

const BARE_CALL = { call: ["add", 1, 2] };

describe("P1(a.18) §B — one routing-table clone per registry per dispatch version", () => {
  test("three contexts of ONE real registry are served ONE table object", () => {
    const reg = createRegistry([...(SYSTEM_REGISTRY_MODULES as never[])]);
    const seen = tablesHandedTo((arm) => {
      const a = reg.evaluateContext() as EvaluateContext;
      const b = reg.evaluateContext() as EvaluateContext;
      const spread = { ...b } as EvaluateContext;
      arm();
      for (const ctx of [a, b, spread]) expect(evaluate(BARE_CALL, {}, ctx)).toBe(3);
    });
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(1);
  }, 300_000);

  // The next two are OVER-SHARING guards, not defeater-sensitive pins: they
  // assert DISTINCTNESS, which held before the key change too and must keep
  // holding after it. The mechanism's own pin is the one above.
  test("a dispatch-registry version bump invalidates the retained table", () => {
    const dispatchRegistry = createDispatchRegistry();
    const reg = createRegistry([...(SYSTEM_REGISTRY_MODULES as never[])], { dispatchRegistry });
    const seen = tablesHandedTo((arm) => {
      const ctx = reg.evaluateContext() as EvaluateContext;
      arm();
      expect(evaluate(BARE_CALL, {}, ctx)).toBe(3);
      dispatchRegistry.addInstance({
        typeName: "P1a18Probe",
        args: ["P1a18Target"],
        methods: {},
      } as never);
      expect(evaluate(BARE_CALL, {}, ctx)).toBe(3);
    });
    expect(seen.length).toBe(2);
    expect(new Set(seen).size).toBe(2);
  }, 300_000);

  test("two registries do not share one table", () => {
    const regA = createRegistry([...(SYSTEM_REGISTRY_MODULES as never[])], {
      dispatchRegistry: createDispatchRegistry(),
    });
    const regB = createRegistry([...(SYSTEM_REGISTRY_MODULES as never[])], {
      dispatchRegistry: createDispatchRegistry(),
    });
    const seen = tablesHandedTo((arm) => {
      const a = regA.evaluateContext() as EvaluateContext;
      const b = regB.evaluateContext() as EvaluateContext;
      arm();
      expect(evaluate(BARE_CALL, {}, a)).toBe(3);
      expect(evaluate(BARE_CALL, {}, b)).toBe(3);
    });
    expect(seen.length).toBe(2);
    expect(new Set(seen).size).toBe(2);
  }, 300_000);

  test("the two getters are the SAME objects across context builds", () => {
    const reg = createRegistry([]);
    const a = reg.evaluateContext() as EvaluateContext;
    const b = reg.evaluateContext() as EvaluateContext;
    expect(a._routingTable).toBe(b._routingTable!);
    expect(a._routingTableVersion).toBe(b._routingTableVersion!);
    // ... and DIFFERENT objects across registries, which is what keeps two
    // registries at the same dispatch version from sharing one cache entry.
    const other = createRegistry([]);
    expect(other.evaluateContext()._routingTable).not.toBe(a._routingTable!);
  }, 120_000);
});
