// ---------------------------------------------------------------------------
// rights R3a — the RUNTIME side: storage selection, the durable IO arm, the
// enumerating handlers, and the σ-binding wipe.
//
// Brief: `workstreams/rights/briefs/r3a-account-partitioned-dispatch.md` §6
// pins 5, 6, 7, 9.
//
// THE OBSERVATION, as in the R2b suite: `DATABASE_URL` is deleted before the
// evaluator is imported, so `getDb()` throws and every storage act resolves to
// the Memory backend. "The leaf was never reached" is therefore stronger than
// "the spy recorded nothing" — nothing was written and nothing COULD have been.
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, spyOn, test } from "bun:test";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");
spyOn(dbModule, "insertTraces").mockImplementation((async () => {}) as never);

const { loadRegistry, resetRegistryCache } = await import("./evaluator");
const { performStorageMethod } = await import("./handlers/storage-backends");
const { mintRequestAuthority } = await import("./authority-mint");
const {
  dispatchRegistry, applyAccountSpecInstances, refreshAccountInstances,
  frameVisibility, instanceVisible, GLOBAL_ONLY, resolveEffect,
} = await import("@fenel/engine");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetRegistryCache();
});

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LONG = 1_200_000;

function authorityFor(accountId: string) {
  return mintRequestAuthority(loadRegistry(), {
    accountId,
    role: "owner",
    membershipId: `membership-${accountId}`,
    subject: { $tag: "User", accountId, userId: USER },
  });
}

function ioContextFor(accountId: string) {
  return {
    accountId,
    profileId: "",
    authority: authorityFor(accountId),
    callFunction: async () => null,
    dispatchAction: async () => null,
  } as never;
}

describe("rights R3a — storage selection runs under the caller's authority", () => {
  // §6 pin 5 — THE STEER PIN, and what makes "R3a completes R2b's storage
  // partition" a true sentence.
  //
  // R2b made every storage act JUDGED on the account it argues. This selection
  // happened BEFORE the authority frame was built and saw every row, so a
  // correctly-account-B-scoped `StorageHandler` row at a higher priority was
  // SELECTED for account A's `state.create_instance` and then judged, faithfully,
  // under A's authority. An argued axis cannot see a selection bypass.
  //
  // Neuters: (a) replace `storageDescriptor`'s frame visibility with an
  // admit-all predicate; (b) the native ignores the Fenel disposition and writes
  // `{kind:"global"}`. RED: A performs B's descriptor.
  test("pin 5 — a B-owned StorageHandler at a higher priority is not selected for A", async () => {
    const registry = loadRegistry();
    const BOOT = dispatchRegistry.listInstances("StorageHandler").length;
    expect(BOOT).toBeGreaterThan(0);

    // B registers a handler whose `store` names a PROBE descriptor, at a
    // priority far above the boot rows — the shape a compromised or merely
    // over-eager account row has.
    applyAccountSpecInstances(dispatchRegistry, B, [{
      typeName: "StorageHandler",
      args: ["Memory"],
      methods: {
        store: "r3a:probeStore", load: "r3a:probeStore", list: "r3a:probeStore",
        remove: "r3a:probeStore", loadType: "r3a:probeStore", appendEvent: "r3a:probeStore",
      },
      priority: 9_999_999,
    }] as never);

    try {
      // A's storage act selects the BOOT descriptor, not B's probe. The probe
      // descriptor does not exist in any perform table, so selecting it would
      // fail loudly rather than silently — but the point is that it is not
      // selected at all.
      // ⚠ POSITIONAL ARGS — `descriptorStorageArgs` destructures them. And the
      // ACT SUCCEEDING is the observation: `r3a:probeStore` is in no perform
      // table, so had B's row been selected the call would have refused at the
      // gate rather than returning the Memory backend's empty list.
      const result = await performStorageMethod(
        registry, ioContextFor(A), "list",
        [A, "R3aNoSuchType"] as never,
      );
      expect(result).toEqual([]);

      // …and B's OWN frame does see its row, so the fence is about ownership
      // and not about the row being malformed.
      const bVisible = dispatchRegistry.listInstances("StorageHandler")
        .filter((i) => instanceVisible(i, frameVisibility({ _authority: authorityFor(B) })));
      expect(bVisible.some((i) => i.methods["store"] === "r3a:probeStore")).toBe(true);
      const aVisible = dispatchRegistry.listInstances("StorageHandler")
        .filter((i) => instanceVisible(i, frameVisibility({ _authority: authorityFor(A) })));
      expect(aVisible.some((i) => i.methods["store"] === "r3a:probeStore")).toBe(false);
      // and the honest fence sees none of it
      expect(dispatchRegistry.listInstances("StorageHandler")
        .filter((i) => instanceVisible(i, GLOBAL_ONLY))
        .some((i) => i.methods["store"] === "r3a:probeStore")).toBe(false);
    } finally {
      refreshAccountInstances(dispatchRegistry, B, []);
    }
    expect(dispatchRegistry.listInstances("StorageHandler")).toHaveLength(BOOT);
  }, LONG);

  // §6 pin 9 — THE WIPE. `refreshAccountInstances` used to call
  // `removeInstancesByScope("account")`, which had no id in it: refreshing ONE
  // account dropped EVERY account's rows from the process, including any boot
  // row that had landed in the bucket. This is σ-binding's "swaps the shared
  // pool under running turns", at the pool.
  //
  // Neuter: a whole-bucket wipe. RED: A's row is gone after B's refresh.
  test("pin 9 — refreshing one account leaves every other account's rows standing", async () => {
    const BOOT = dispatchRegistry.listInstances("StorageHandler").length;
    const row = (who: string) => ({
      typeName: "StorageHandler", args: ["Memory"],
      methods: {
        store: `r3a:${who}`, load: `r3a:${who}`, list: `r3a:${who}`,
        remove: `r3a:${who}`, loadType: `r3a:${who}`, appendEvent: `r3a:${who}`,
      },
    });
    applyAccountSpecInstances(dispatchRegistry, A, [row("a")] as never);
    applyAccountSpecInstances(dispatchRegistry, B, [row("b")] as never);
    try {
      refreshAccountInstances(dispatchRegistry, B, []);
      const left = dispatchRegistry.listInstances("StorageHandler");
      expect(left).toHaveLength(BOOT + 1);
      expect(left.some((i) => i.methods["store"] === "r3a:a")).toBe(true);
      expect(left.some((i) => i.methods["store"] === "r3a:b")).toBe(false);
      // the BOOT rows are untouched — the retired bucket took them too.
      expect(left.filter((i) => instanceVisible(i, GLOBAL_ONLY))).toHaveLength(BOOT);
    } finally {
      refreshAccountInstances(dispatchRegistry, A, []);
    }
    expect(dispatchRegistry.listInstances("StorageHandler")).toHaveLength(BOOT);
  }, LONG);

  // §6 pin 6 — THE DURABLE IO ARM selects only what the caller may see. The
  // `ACTION_TO_TYPECLASS` branch used to call `dispatchRegistry.resolve("account",
  // typeName)` UNFILTERED, so an account-owned override of any of the ~30 mapped
  // actions was selected for every account.
  //
  // ⚠ `"account"` here is the dispatch TARGET KEY, not a scope. The seven boot
  // dictionaries are registered under it and are `{kind:"global"}` rows after the
  // retag; the ownership question is the SCOPE.
  //
  // Neuter: drop the filter at the arm. RED: A resolves B's override.
  test("pin 6 — the durable IO arm resolves the boot dictionary, not another account's override", async () => {
    const before = dispatchRegistry.listInstances("HasStateIO").length;
    applyAccountSpecInstances(dispatchRegistry, B, [{
      typeName: "HasStateIO",
      args: ["account"],
      methods: { createInstance: "r3a.b_override" },
      priority: 9_999_999,
    }] as never);
    try {
      const underA = dispatchRegistry.resolve(
        "account", "HasStateIO", frameVisibility({ _authority: authorityFor(A) }),
      );
      expect(underA?.["createInstance"]).toBe("state.create_instance");

      const underB = dispatchRegistry.resolve(
        "account", "HasStateIO", frameVisibility({ _authority: authorityFor(B) }),
      );
      expect(underB?.["createInstance"]).toBe("r3a.b_override");

      // and the shape the arm uses for an unauthenticated frame
      const anonymous = dispatchRegistry.resolve(
        "account", "HasStateIO", frameVisibility({ _authority: undefined }),
      );
      expect(anonymous?.["createInstance"]).toBe("state.create_instance");

      // ⚠ AND THE PRODUCTION ARM REALLY PASSES THAT VISIBILITY (review round 1,
      // Fable). The assertions above exercise the registry, not `handleIO`'s
      // `ACTION_TO_TYPECLASS` branch, so a permissive replacement at the arm
      // itself would leave them green. Reaching that branch needs a durable
      // request with a suspended instance — R4's fixture shape — so the arm's
      // own read is pinned MECHANICALLY, and said to be mechanical.
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const arm = readFileSync(join(import.meta.dir, "evaluator.ts"), "utf8");
      expect(arm).toContain(
        '"account", typeName, frameVisibility({ _authority: ctx.authority }),',
      );
      expect(arm).not.toMatch(/dispatchRegistry\.resolve\("account",\s*typeName\)/);
    } finally {
      refreshAccountInstances(dispatchRegistry, B, []);
    }
    expect(dispatchRegistry.listInstances("HasStateIO")).toHaveLength(before);
  }, LONG);

  // §6 pin 7 — ENUMERATION IS OWNED. `lookup` / `lookup_one` / `lookup_all`
  // return EXECUTABLE DICTIONARIES, so enumerating them is selecting them.
  //
  // Neuter: drop the filter in any one of the three. RED: A's enumeration
  // contains B's dictionary.
  test("pin 7 — the lookup handlers enumerate only the caller's own rows", async () => {
    const registry = loadRegistry();
    const CLASS = "R3aRuntimeEnumerated";
    dispatchRegistry.addInstance({
      typeName: CLASS, args: ["K"], methods: { m: "boot" }, scope: { kind: "global" },
    });
    applyAccountSpecInstances(dispatchRegistry, B, [
      { typeName: CLASS, args: ["K"], methods: { m: "b-only" }, priority: 5 },
    ] as never);
    try {
      // ⚠ THROUGH THE REGISTERED HANDLER, not a re-implementation of it (review
      // round 1, Fable). The first cut of this pin rebuilt the enumeration
      // inline with `listInstances(...).filter(instanceVisible)`, so dropping
      // the filter in `runtime/src/handlers/dispatch.ts` left it GREEN — it was
      // testing its own two lines. `getIOHandler` synthesises the wrapper that
      // re-enters the SAME gate with the caller's authority, so the production
      // handler body genuinely runs.
      const lookupAll = registry.getIOHandler("dispatch.lookup_all")!;
      expect(lookupAll).toBeDefined();
      const seen = async (account: string): Promise<unknown[]> => {
        const out = await lookupAll(
          { specTypeId: CLASS, target: "K" },
          ioContextFor(account),
        ) as { action: string; value: Array<Record<string, unknown>> };
        return out.value.map((methods) => methods["m"]);
      };
      // A sees the boot row and NOT B's.
      expect(await seen(A)).toEqual(["boot"]);
      // B sees its own AND the boot row — the fence is ownership, not silence.
      expect((await seen(B)).sort()).toEqual(["b-only", "boot"]);

      // `lookup` and `lookup_one`, the single-pick siblings, agree.
      const lookupOne = registry.getIOHandler("dispatch.lookup_one")!;
      const one = async (account: string) => (await lookupOne(
        { specTypeId: CLASS, target: "K" }, ioContextFor(account),
      ) as { value: { $tag: string; _0?: Record<string, unknown> } }).value;
      expect(one(A).then((v) => v._0?.["m"])).resolves.toBe("boot");
      expect(one(B).then((v) => v._0?.["m"])).resolves.toBe("b-only");

      // …and the in-process resolver agrees with the handlers.
      const picked = resolveEffect(
        { _authority: authorityFor(A) } as never, dispatchRegistry, CLASS, "K",
      );
      if (picked?.source.kind !== "instance") throw new Error("expected an instance");
      expect(picked.source.instance.methods["m"]).toBe("boot");
      void frameVisibility; void instanceVisible;
    } finally {
      refreshAccountInstances(dispatchRegistry, B, []);
    }
  }, LONG);
});

describe("rights R3a — the ASYNC write path, driven", () => {
  // §6 pins 16/17, the half the engine suite cannot reach.
  //
  // ⚠ THE ENGINE SUITE ASSERTS ON THIS HANDLER'S SOURCE, and that is not
  // enough (review round 4, Astra): wrapping `registrationOwner(…)` in a
  // try/catch that falls back to a poison account preserves every source
  // assertion — `registrationOwner(` still appears, `scope: { kind: "account",
  // accountId }` still appears, `params["scope"]` still does not — while a
  // frame with no account registers a row instead of refusing. Only running it
  // can tell.
  const CLASS = "R3aAsyncWritten";

  test("pins 16/17 (async) — an account frame OWNS its row and the argued scope is ignored", async () => {
    const registry = loadRegistry();
    const handler = registry.getIOHandler("dispatch.register")!;
    expect(handler).toBeDefined();
    const before = dispatchRegistry.listInstances(CLASS).length;
    try {
      await handler(
        {
          specTypeId: CLASS,
          key: { $tag: "ByType", target: "async-a" },
          methods: { m: "A" },
          // ⚠ THE CALLER ARGUES `global`. It is ignored.
          scope: { $tag: "Just", _0: "global" },
        },
        ioContextFor(A),
      );
      const rows = dispatchRegistry.listInstances(CLASS).filter((i) => i.args[0] === "async-a");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scope).toEqual({ kind: "account", accountId: A });
      // …and B does not see it.
      expect(dispatchRegistry.resolve("async-a", CLASS, frameVisibility({ _authority: authorityFor(B) })))
        .toBeUndefined();
    } finally {
      refreshAccountInstances(dispatchRegistry, A, []);
    }
    expect(dispatchRegistry.listInstances(CLASS)).toHaveLength(before);
  }, LONG);

  test("pin 17 (async) — a frame with NO account cannot write, and the registry is untouched", async () => {
    const registry = loadRegistry();
    const handler = registry.getIOHandler("dispatch.register")!;
    const before = dispatchRegistry.listInstances(CLASS).length;
    // The registry-bootstrap authority names no account — the harness shape.
    const noAccountCtx = {
      accountId: A,
      profileId: "",
      authority: registry.evaluateContext()._authority,
      callFunction: async () => null,
      dispatchAction: async () => null,
    } as never;
    await expect(handler(
      {
        specTypeId: CLASS,
        key: { $tag: "ByType", target: "async-refused" },
        methods: { m: "?" },
        scope: { $tag: "Nothing" },
      },
      noAccountCtx,
    )).rejects.toThrow(/account frame/);
    expect(dispatchRegistry.listInstances(CLASS)).toHaveLength(before);

    // and UNREGISTER refuses the same way
    const unregister = registry.getIOHandler("dispatch.unregister")!;
    await expect(unregister(
      { specTypeId: CLASS, target: "async-refused" }, noAccountCtx,
    )).rejects.toThrow(/account frame/);
  }, LONG);
});
