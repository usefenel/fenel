// ---------------------------------------------------------------------------
// rights R2a §6.15–20 — THE THREADING PINS.
//
// THE SHAPE RULE, LEARNED THE EXPENSIVE WAY (R1 note §2). A pin at the layer
// where the authority is an INPUT observes nothing about whether it SURVIVES
// the hop above. R1's first slice threaded a privileged bit into a leaf, pinned
// the leaf, went green, and shipped a TOTAL LOGIN OUTAGE — because
// `executeInstance` rebuilds its context from the persisted row one hop up and
// dropped the bit entirely. Every pin below therefore asserts at a layer the
// authority had to CROSS to get there:
//
//   · the explicit override in `performIODescriptor` (not an inheritance)
//   · the UNPERSISTED hop, through the real `core/src/auth.ts` door
//   · the PURE channel — a mediated native inside a body, which never touches
//     `performIODescriptor` at all
//   · the storage seam and `mintUuid`, whose frame used to be CACHED across
//     calls and registries
//
// THE OBSERVATION, inherited from `rights-r1-unpersisted-auth.test.ts`:
// `DATABASE_URL` is deleted before the evaluator is imported, so `getDb()`
// throws and the durable path is STRUCTURALLY IMPOSSIBLE in this process. That
// makes "the leaf was never reached" a stronger claim than "the spy recorded
// nothing" — nothing was written and nothing COULD have been.
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, test } from "bun:test";
import type { IOHandlerContext } from "@fenel/engine/types";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const { runUnpersistedCallForTest, resetRegistryCache, registerIOHandlers, loadRegistry } =
  await import("./evaluator");
const { mintInterimWorkerAuthority } = await import("./authority-mint");
const { createRegistry } = await import("@fenel/engine/registry");
const { stdModule } = await import("@fenel/engine/modules/std");
const { mintAuthority } = await import("@fenel/engine/authority");
const { registerStateHandlers } = await import("./handlers/state");
const { AuthorityRefused } = await import("@fenel/engine");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetRegistryCache();
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LONG = 600_000;

/** Leaf hits, keyed by descriptor. A pin that only asserts the THROW would stay
 *  green if the leaf ran first and threw afterwards. */
const hits = new Map<string, number>();
function hitCount(descriptor: string): number {
  return hits.get(descriptor) ?? 0;
}

let fixture: ReturnType<typeof createRegistry> | undefined;

/** `std` plus two IO leaves that record every call, and three bodies that reach
 *  them: one directly, one THROUGH A NESTED CALL, and one that yields both. */
function fixtureRegistry() {
  if (fixture !== undefined) return fixture;
  fixture = createRegistry([
    stdModule,
    {
      name: "probe",
      label: "rights R2a threading fixture",
      functions: [
        {
          id: "probe:readsOnly",
          params: [],
          returns: { $record: { fields: [] } },
          body: { call: ["probe:getLeaf"] },
        },
        {
          id: "probe:writes",
          params: [],
          returns: { $record: { fields: [] } },
          body: { call: ["probe:writeLeaf"] },
        },
        {
          // THE NESTED HOP, in its REAL shape. `probe:viaChild` yields an IO
          // leaf whose handler calls BACK into the evaluator through
          // `ctx.callFunction` — which is `evaluatorIOHandlerContext`'s
          // `callChild`, the seam that threads the context into the child. The
          // child then yields the write leaf. That is the hop R1's first slice
          // could not pin: the authority has to survive a leaf boundary AND a
          // fresh evaluation loop to be judged correctly one frame down.
          id: "probe:viaChild",
          params: [],
          returns: { $record: { fields: [] } },
          body: { call: ["probe:callChild"] },
        },
        {
          id: "probe:callChild",
          params: [],
          returns: { $record: { fields: [] } },
        },
        {
          id: "probe:getLeaf",
          params: [],
          returns: { $record: { fields: [] } },
        },
        {
          id: "probe:writeLeaf",
          params: [],
          returns: { $record: { fields: [] } },
        },
      ] as never,
      ioHandlers: {
        "probe:getLeaf": async () => {
          hits.set("probe:getLeaf", hitCount("probe:getLeaf") + 1);
          return { action: "continue" as const, value: "read" };
        },
        "probe:writeLeaf": async () => {
          hits.set("probe:writeLeaf", hitCount("probe:writeLeaf") + 1);
          return { action: "continue" as const, value: "written" };
        },
        // The callback seam. It performs NOTHING itself; its whole job is to
        // re-enter the evaluator for a child, carrying whatever context the
        // leaf was reached with.
        "probe:callChild": async (_params: Record<string, unknown>, ctx: IOHandlerContext) => {
          hits.set("probe:callChild", hitCount("probe:callChild") + 1);
          return { action: "continue" as const, value: await ctx.callFunction("probe:writes", {}) };
        },
      },
    } as never,
  ]);
  registerStateHandlers(fixture);
  registerIOHandlers(fixture);
  return fixture;
}

/** An authority permitting exactly these descriptors and nothing else. */
function permitting(descriptors: readonly string[]) {
  const reg = fixtureRegistry();
  return mintAuthority(reg, {
    envelope: reg.evaluateAuthorityFunction("authority:descriptorEnvelope", [[...descriptors]]),
    issuer: "test",
    accountId: ACCOUNT,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

describe("rights R2a §6.15 — performIODescriptor OVERRIDES, it does not inherit", () => {
  test("a body yielding an excluded leaf is refused, and the leaf is not reached", async () => {
    const before = hitCount("probe:writeLeaf");
    await expect(runUnpersistedCallForTest(
      "probe:writes",
      {},
      { accountId: ACCOUNT, profileId: "", persistence: "ephemeral" as const, authority: permitting(["probe:getLeaf"]) },
      fixtureRegistry(),
    )).rejects.toThrow(/authority refused "probe:writeLeaf"/);
    expect(hitCount("probe:writeLeaf")).toBe(before);
  }, LONG);

  test("THE DISCRIMINATION: the same body under a permitting authority reaches the leaf", async () => {
    // Without this, the pin above would stay green if the leaf simply stopped
    // resolving — a refusal for the wrong reason.
    const before = hitCount("probe:writeLeaf");
    await runUnpersistedCallForTest(
      "probe:writes",
      {},
      { accountId: ACCOUNT, profileId: "", persistence: "ephemeral" as const, authority: permitting(["probe:writeLeaf"]) },
      fixtureRegistry(),
    );
    expect(hitCount("probe:writeLeaf")).toBe(before + 1);
  }, LONG);
});

describe("rights R2a §6.16 — the authority SURVIVES a nested call", () => {
  test("a leaf reached only through a child call is refused IN the child", async () => {
    // ⚠ THIS IS THE PIN R1's FIRST SLICE STRUCTURALLY COULD NOT WRITE. The
    // refusal has to happen one frame DOWN from the one that carries the
    // authority. If the nested hop rebuilt its context — which is exactly what
    // `executeInstance` does on the durable path — this body would run under
    // whatever the registry bootstrap carries, which is the universe.
    const before = hitCount("probe:writeLeaf");
    await expect(runUnpersistedCallForTest(
      "probe:viaChild",
      {},
      {
        accountId: ACCOUNT,
        profileId: "",
        persistence: "ephemeral" as const,
        // ⚠ THE CALLBACK LEAF IS PERMITTED AND THE WRITE LEAF IS NOT. Withhold
        // both and the refusal happens at the DOOR, which proves nothing about
        // the hop; the pin is that the refusal lands one frame DOWN.
        authority: permitting(["probe:getLeaf", "probe:callChild"]),
      },
      fixtureRegistry(),
    )).rejects.toThrow(/authority refused "probe:writeLeaf"/);
    expect(hitCount("probe:writeLeaf")).toBe(before);
  }, LONG);

  test("THE DISCRIMINATION: the nested hop reaches the leaf when permitted", async () => {
    const before = hitCount("probe:writeLeaf");
    await runUnpersistedCallForTest(
      "probe:viaChild",
      {},
      {
        accountId: ACCOUNT,
        profileId: "",
        persistence: "ephemeral" as const,
        authority: permitting(["probe:callChild", "probe:writeLeaf"]),
      },
      fixtureRegistry(),
    );
    expect(hitCount("probe:writeLeaf")).toBe(before + 1);
  }, LONG);
});

describe("rights R2a — a refusal is the AuthorityRefused class, not a message shape", () => {
  test("the thrown error carries the descriptor and the reason through the hop", async () => {
    let caught: unknown;
    try {
      await runUnpersistedCallForTest(
        "probe:viaChild",
        {},
        {
          accountId: ACCOUNT,
          profileId: "",
          persistence: "ephemeral" as const,
          authority: permitting(["probe:callChild"]),
        },
        fixtureRegistry(),
      );
    } catch (error) {
      caught = error;
    }
    // The unpersisted loop wraps a failure in its own Error, so the CLASS must
    // survive as a cause — which is what `api/src/authority-refusal.ts` walks.
    let found: unknown = caught;
    for (let depth = 0; depth < 8 && found !== undefined && found !== null; depth += 1) {
      if (found instanceof AuthorityRefused) break;
      found = (found as { cause?: unknown }).cause;
    }
    // ⚠ UNCONDITIONAL. Guarding this on `refusal !== undefined` would make the
    // pin green in exactly the case it exists to catch: a loop that rethrows a
    // bare string loses the class, and the 403 mapping is BY CLASS, so a lost
    // class is a 500 in production.
    expect(found).toBeInstanceOf(AuthorityRefused);
    const refusal = found as InstanceType<typeof AuthorityRefused>;
    expect(String(caught)).toMatch(/authority refused "probe:writeLeaf"/);
    expect(refusal.descriptor).toBe("probe:writeLeaf");
    expect(refusal.reason).toBe("refused");
  }, LONG);
});

describe("rights R2a — the mint refuses what it cannot judge", () => {
  test("an interim worker names its lane, and the lane is what R4 will census", () => {
    const reg = fixtureRegistry();
    const handle = mintInterimWorkerAuthority(reg, ACCOUNT, "timer-sweep");
    // The lane's envelope EXCLUDES the session leaves — the second, independent
    // refusal R1's defect B now meets before it reaches the leaf's own guard.
    // rights R2b: the lane holds the `member` ROLE envelope, partitioned to its
    // own account, and the list is one spelling per act.
    const fenced = reg.evaluateAuthorityFunction(
      "authority:sessionLeafDescriptors", [0],
    ) as string[];
    const laneEnvelope = reg.evaluateAuthorityFunction("authority:roleEnvelope", [
      "member", ACCOUNT, reg.listPerformDescriptors(), [],
    ]);
    for (const leaf of fenced) {
      expect(
        reg.evaluateAuthorityFunction("authority:permits", [
          laneEnvelope,
          { $tag: "Act", descriptor: leaf, args: [], fields: [] },
        ]),
        leaf,
      ).toEqual({ $tag: "Just", _0: false });
    }
    expect(handle).toBeDefined();
  }, LONG);

  test("the registry bootstrap authority is the ONLY Top, and it is not on a runtime frame", () => {
    const reg = fixtureRegistry();
    const top = reg.evaluateAuthorityFunction("authority:topEnvelope", [0]);
    expect(() => mintAuthority(reg, {
      envelope: top,
      issuer: "interim-worker",
      accountId: ACCOUNT,
      principal: null,
      lane: "timer-sweep",
      grant: null,
      mintedAt: 0,
    })).toThrow(/registry-bootstrap/);
    // And the base registry the sessionless lanes mint over is a real registry
    // whose checker runs — a registry that could not judge would refuse
    // everything, which is a boot failure worth catching here.
    expect(loadRegistry().listPerformDescriptors().length).toBeGreaterThan(0);
  }, LONG);
});
