// ---------------------------------------------------------------------------
// rights R2b — canonical acts on the PRODUCTION table, the argued partition,
// the role policy, and member management.
//
// Brief: `workstreams/rights/briefs/r2b-authority-spine-ii.md` §6.
//
// ⚠ THE PRODUCTION TABLE, NOT A KERNEL. Several pins here read `loadRegistry()`
// deliberately: the same assertions against `authorityTestKernel()` (std only)
// would pass while the real table carried 221 alias pairs, which is exactly the
// defect canonical acts exist to make unrepresentable.
//
// THE OBSERVATION: `DATABASE_URL` is deleted before the evaluator is imported,
// so `getDb()` throws and every storage act resolves to the Memory backend.
// "The leaf was never reached" is therefore stronger than "the spy recorded
// nothing" — nothing was written and nothing COULD have been.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED BEFORE IT WAS TRUSTED, one neuter at a
// time, with the red text recorded in the phase completion note.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import { GLOBAL_ONLY } from "@fenel/engine";

/** ⚠ THE CALLBACK BODY, brace-balanced — not "everything up to the next
 *  registration" (rights R2b review round 7). The naive split attributes the
 *  trailing comment and any helper that follows a handler to that handler, which
 *  moved `dispatch.dispatch_action` and `state.append_event` between classes and
 *  made the published split wrong by six. Both source-scanning pins below read
 *  through this. */
function handlerBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const pattern = /reg\.registerIOHandler\(\s*"([^"]+)"/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const open = source.indexOf("{", source.indexOf("=>", match.index + match[0].length));
    if (open < 0) continue;
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.set(match[1]!, source.slice(open, cursor + 1));
  }
  return bodies;
}

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");
spyOn(dbModule, "insertTraces").mockImplementation((async () => {}) as never);

const {
  loadRegistry, resetRegistryCache, registerIOHandlers, registerFenelBodyDispatchers,
  invokeIOActionAs, runUnpersistedCallForTest,
} = await import("./evaluator");
const { performStorageMethod, withStorageBackend } = await import("./handlers/storage-backends");
const { registerStateHandlers, assertFencedLeavesMatch } = await import("./handlers/state");
const { reservedSourceModuleNamespaces } = await import("@fenel/engine/authoring/source-module");
const { mintInterimWorkerAuthority, mintRequestAuthority, storageIndex } = await import("./authority-mint");
const { mintAuthority, authenticateAuthority } = await import("@fenel/engine/authority");
const { AuthorityRefused, getIOAction, dispatchRegistry } = await import("@fenel/engine");
const { createRegistry } = await import("@fenel/engine/registry");
const { stdModule } = await import("@fenel/engine/modules/std");

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
const DOTTED = /^[a-z][a-z0-9_]*\.[a-z_0-9]+$/;
/** See pin 5: requires-free, therefore never mediated, therefore in no table. */
const INERT_REALM_ENTRIES = new Set(["crypto:hashPassword", "crypto:verifyPassword"]);

function maybeAction(id: string): string | undefined {
  const value = getIOAction(id) as unknown;
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && (value as { $tag?: string }).$tag === "Just") {
    const payload = (value as { _0?: unknown })._0;
    return typeof payload === "string" ? payload : undefined;
  }
  return undefined;
}

/** modules-as-values Phase 2c — the act a `StorageHandler` method value names,
 *  spelled as its function id: an id string as it stands, or a function
 *  reference (an own `$ref`) spelled `storage.member` or `storage:member`.
 *  Test-local on purpose: the mirror pins share no code with the readers they
 *  check. */
function storageActIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return undefined;
  const ref = Object.getOwnPropertyDescriptor(value, "$ref");
  if (ref === undefined || !("value" in ref) || typeof ref.value !== "string") return undefined;
  const handle: string = ref.value;
  return handle.startsWith("storage.") ? `storage:${handle.slice("storage.".length)}` : handle;
}

/** rights R2b — an authority over a role's real envelope, on the production
 *  registry, built through the same Fenel policy the request door uses. */
function roleAuthority(role: string, accountId: string) {
  const registry = loadRegistry();
  return mintRequestAuthority(registry, {
    accountId,
    role,
    membershipId: `membership-${role}`,
    subject: { $tag: "User", accountId, userId: USER },
  });
}

function ioContextFor(accountId: string, authority: ReturnType<typeof roleAuthority>) {
  return {
    accountId,
    profileId: "",
    authority,
    callFunction: async () => null,
    dispatchAction: async () => null,
  } as never;
}

// ---------------------------------------------------------------------------
// §6.1 / §6.4 / §6.5 / §6.6 — ONE NAME PER ACT, on the real table.
// ---------------------------------------------------------------------------

describe("rights R2b — the production perform table names each act ONCE", () => {
  test("1 — every declared @ioAction is listed under its function id and NOT its dotted name", () => {
    const registry = loadRegistry();
    const listed = new Set(registry.listPerformDescriptors());
    const pairs: Array<[string, string]> = [];
    for (const fn of registry.listFunctions()) {
      const action = maybeAction(fn.id);
      if (action === undefined || action === fn.id) continue;
      pairs.push([fn.id, action]);
    }
    // NOT VACUOUS: the repository really does declare hundreds of them.
    expect(pairs.length).toBeGreaterThan(150);
    // Neuter: `listDescriptors` returns every key. RED reads: hundreds of
    // dotted names present.
    // ⚠ THE `ownsItsNative` CARVE-OUT IS EXCLUDED BY NAME, not by a wildcard.
    // The five `dispatch:*` ids are reserved by ctx-natives, so the body
    // dispatcher cannot alias them and BOTH names carry an implementation —
    // two different implementations, not two names for one act. The brief names
    // them; this list is what stops the exclusion from quietly widening.
    const CARVE_OUT = new Set([
      "dispatch.lookup", "dispatch.lookup_all", "dispatch.lookup_one",
      "dispatch.register", "dispatch.unregister",
    ]);
    const dottedStillListed = pairs
      .filter(([, action]) => listed.has(action) && !CARVE_OUT.has(action));
    const idsMissing = pairs.filter(([id]) => !listed.has(id));
    expect({ dottedStillListed: dottedStillListed.map(([, a]) => a), idsMissing }).toEqual({
      dottedStillListed: [], idsMissing: [],
    });
    // ⚠ THE DOTTED RESIDUE IS ENUMERATED, NOT ASSUMED EMPTY, because it is not.
    // SEVEN dotted names remain implementation-bearing, in two groups, and both
    // are correct under `au.gate.canonical` (an act has one name; these names ARE
    // their own canonical form):
    //
    //   · the five `dispatch.*` — the `ownsItsNative` CARVE-OUT the brief names.
    //     Their colon ids are reserved by ctx-natives, so the body dispatcher
    //     cannot alias them and both names carry an implementation. Nothing
    //     canonicalises them and nothing should: they are two DIFFERENT
    //     implementations, not two names for one.
    //   · two with NO colon twin at all (`notion.search`,
    //     `state.validate_function_args`) — handler-only registrations with no
    //     Fenel declaration carrying that `@ioAction`, so there is nothing to
    //     canonicalise TO.
    //
    // The four `fs.*` acts were in the second group until GP-21's stopgap
    // stopped registering them in the API process at all; the GP-21 block below
    // pins their absence.
    //
    // The property that matters is the one asserted above: no act has TWO
    // published names. This list is the residue, pinned so it cannot grow
    // silently.
    expect(registry.listPerformDescriptors().filter((d) => DOTTED.test(d)).sort()).toEqual([
      "dispatch.lookup", "dispatch.lookup_all", "dispatch.lookup_one",
      "dispatch.register", "dispatch.unregister",
      "notion.search", "state.validate_function_args",
    ]);
  }, LONG);

  test("1 — both spellings still REACH the same implementation", () => {
    const registry = loadRegistry();
    const id = "state:getInstance";
    const action = maybeAction(id);
    expect(typeof action).toBe("string");
    // The alias resolves: `getIOHandler` answers for both names, which is what
    // the 162 `invokeIOActionAs` call sites and every durable body depend on.
    expect(registry.getIOHandler(id)).toBeDefined();
    expect(registry.getIOHandler(action!)).toBeDefined();
  }, LONG);

  test("4 — a BODIED @ioAction function registers ONE implementation, not two", () => {
    // ⚠ ON THE PRODUCTION TABLE, and deliberately not on a hand-built fixture:
    // `runtimeIOAction` reads `getIOAction(fn.id)` from the PROCESS-GLOBAL
    // dispatch registry, so a fixture module's own `IOInvokable` instance is
    // invisible to the body dispatcher and the fixture would measure nothing.
    const registry = loadRegistry();
    const listed = new Set(registry.listPerformDescriptors());
    // `auth:issueSession` is a BODIED function with a declared `@ioAction`; it
    // is on the login chain, so a regression here is a login regression.
    const id = "auth:issueSession";
    const action = maybeAction(id);
    expect(action).toBe("auth.issue_session");
    // Neuter: the bodied branch registers BOTH names. RED reads: both present.
    expect(listed.has(id)).toBe(true);
    expect(listed.has(action!)).toBe(false);
    // The public name still resolves through the alias — 162 `invokeIOActionAs`
    // call sites and every durable body depend on exactly this.
    expect(registry.getIOHandler(action!)).toBeDefined();
    void registerFenelBodyDispatchers;
    void createRegistry;
    void stdModule;
  }, LONG);

  test("5 — every policy list is CANONICAL and every entry is an implementation", () => {
    const registry = loadRegistry();
    const listed = new Set(registry.listPerformDescriptors());
    const lists = [
      "authority:sessionLeafDescriptors",
      "authority:membershipLeafDescriptors",
      "authority:membershipReadDescriptors",
      "authority:identityRealmDescriptors",
    ];
    for (const id of lists) {
      const names = registry.evaluateAuthorityFunction(id, [0]) as string[];
      expect(names.length, id).toBeGreaterThan(0);
      for (const name of names) {
        // Neuter: put `state.create_session` in a list. RED reads: the dotted
        // regex matches.
        expect(name, `${id}/${name}`).not.toMatch(DOTTED);
        // ⚠ TWO DECLARED INERT ENTRIES. `crypto:hashPassword` and
        // `crypto:verifyPassword` (codenames `scryptHash` / `scryptVerify`) are
        // requires-FREE, so they are not mediated acts and appear in no perform
        // table. They have been in the identity-realm enumeration since R2a as
        // defence in depth: an extra name in a POSITIVE list grants nothing, and
        // if either ever becomes requires-bearing the login chain keeps working
        // instead of meeting R1's outage shape at the first leaf. Naming them
        // here is the difference between a declared exception and an unnoticed
        // dead entry.
        if (INERT_REALM_ENTRIES.has(name)) continue;
        expect(listed.has(name), `${id}/${name} is not an implementation-bearing descriptor`)
          .toBe(true);
      }
    }
  }, LONG);

  test("6 — the general row is exactly D minus the four families minus storage", () => {
    const registry = loadRegistry();
    const all = registry.listPerformDescriptors();
    const read = (id: string) => registry.evaluateAuthorityFunction(id, [0]) as string[];
    const excluded = new Set([
      ...read("authority:sessionLeafDescriptors"),
      ...read("authority:membershipLeafDescriptors"),
      ...read("authority:membershipReadDescriptors"),
    ]);
    const storage = all.filter((d) => d.startsWith("storage:") && !d.startsWith("storage:json"));
    for (const d of storage) excluded.add(d);

    const member = authenticateAuthority(roleAuthority("member", A))!;
    const permits = (descriptor: string) => registry.evaluateAuthorityFunction(
      "authority:permits",
      [member.envelope, { $tag: "Act", descriptor, args: [], fields: [] }],
    );
    // Every excluded name is refused with NO arguments (the storage rows need
    // an account argument, and this act carries none).
    // Neuter: drop one exclusion from `authorityFencedDescriptors`. RED reads:
    // that name answering `Just true`.
    const leaked = [...excluded].filter(
      (d) => JSON.stringify(permits(d)) === JSON.stringify({ $tag: "Just", _0: true }),
    );
    expect(leaked).toEqual([]);
    // And a representative sample of the general row IS permitted, so the pin
    // is not "this envelope permits nothing".
    const general = all.filter((d) => !excluded.has(d));
    expect(general.length).toBeGreaterThan(1000);
    for (const d of general.slice(0, 50)) {
      expect(permits(d), d).toEqual({ $tag: "Just", _0: true });
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.10 – §6.14 — THE ARGUED PARTITION AND THE ROLES.
// ---------------------------------------------------------------------------

describe("rights R2b — the partition is an ARGUED axis, judged at the gate", () => {
  let storeHits = 0;
  let loadHits = 0;

  beforeEach(() => {
    storeHits = 0;
    loadHits = 0;
  });

  /** The Memory backend's own leaves, spied at the descriptor the policy names.
   *  Registered on the production registry so the act really is the one the
   *  storage row judges. */
  function spyStorage() {
    const registry = loadRegistry();
    const methods = dispatchRegistry.resolve("Memory", "StorageHandler", GLOBAL_ONLY) as Record<string, string>;
    return { registry, methods };
  }

  test("the storage index is the INSTANCE FILE's data, complete and unforged", () => {
    // ⚠ THE POLICY'S ONLY STORAGE INPUT. The rows select BY METHOD from this
    // projection, so its completeness is what makes "every storage descriptor is
    // partitioned" true: the general row is `D` minus every descriptor here, and
    // a missing entry would land that descriptor in the general row with NO
    // partition axis. The projection now throws on an incomplete instance; this
    // pin is the positive half — it is the data `fenel/modules/storage/instances.fenel`
    // declares, for all three backends and all eight methods.
    //
    // ⚠ IT IS A MIRROR, AND IT IS MEANT TO BE (review round 3). It reads
    // `dispatchRegistry.resolve` — the source round 2 REMOVED from the policy —
    // and that independence is load-bearing: the second half below is the only
    // thing that catches a storage leaf losing its `@requires "HasStateIO"`
    // directive and falling into the general row, and it catches it precisely
    // because `seen` does not come from the same `declared` filter the policy
    // uses. Deriving `seen` from `module.functions` would make a dropped
    // `requires` disappear from BOTH sides and turn this pin green on the
    // round-1 escalation. Do not "fix" the duplication.
    const backends = ["Db", "Memory", "Bundle"] as const;
    const methods = [
      "store", "load", "update", "delete", "list", "appendEvent", "loadType", "loadTypeByName",
    ] as const;
    const seen: string[] = [];
    for (const backend of backends) {
      const instance = dispatchRegistry.resolve(backend, "StorageHandler", GLOBAL_ONLY) as Record<string, unknown>;
      expect(instance, backend).toBeDefined();
      for (const method of methods) {
        // The declared act, byte for byte. modules-as-values Phase 2c: the file
        // may spell it as the id string or as a reference (`storage.dbStore`).
        const descriptor = storageActIdOf(instance[method]);
        expect(descriptor, `${backend}.${method}`).toBe(
          `storage:${backend.toLowerCase()}${method[0]!.toUpperCase()}${method.slice(1)}`,
        );
        seen.push(descriptor!);
      }
    }
    expect(seen).toHaveLength(24);
    expect(new Set(seen).size).toBe(24);
    // And every one of them is an implementation-bearing descriptor of the real
    // table, so the policy is naming acts that exist.
    const registry = loadRegistry();
    const listed = new Set(registry.listPerformDescriptors());
    expect(seen.filter((d) => !listed.has(d))).toEqual([]);

    // ⚠ AND THE PROJECTION THE POLICY ACTUALLY RECEIVED IS COMPLETE — observed
    // through the ENVELOPE, not through the instances, because that is where an
    // incomplete projection does its damage. The general row is `D` minus every
    // descriptor in the index, so a storage descriptor MISSING from the index
    // lands in the general row and is reachable with NO partition axis at all.
    //
    // Neuter: make `storageIndex` drop the `appendEvent` rows before returning
    // (`rows.filter((row) => row.method !== "appendEvent")`). RED reads: the
    // three `*AppendEvent` descriptors answer `Just true` for an argument-free
    // act under every role — i.e. they are in the general row.
    // (The original neuter named `STORAGE_METHODS`, a constant round 1 deleted;
    // corrected in round 3 so the RED is reproducible as written.)
    const roles = ["owner", "member", "viewer"];
    for (const role of roles) {
      const record = authenticateAuthority(roleAuthority(role, A))!;
      const leaked = seen.filter((descriptor) => JSON.stringify(
        registry.evaluateAuthorityFunction("authority:permits", [
          record.envelope, { $tag: "Act", descriptor, args: [], fields: [] },
        ]),
      ) === JSON.stringify({ $tag: "Just", _0: true }));
      expect(leaked, `${role} reaches storage descriptors with NO argument`).toEqual([]);
    }
  }, LONG);

  test("an UNBOUND storage act is in NO row — refused, never unpartitioned", () => {
    // ⚠ THE BLOCKING FINDING'S REGRESSION GUARD, at the POLICY level.
    //
    // The general row is `D` minus every descriptor in the storage index, so a
    // storage act MISSING from the index lands in the general row with no
    // partition axis at all. The projection therefore emits one row per
    // DECLARED act — the closed, repo-owned set — and leaves `method` EMPTY for
    // an act no live `StorageHandler` instance names. This pin is that an empty
    // method selects NO row: excluded from general (it is still a storage act)
    // and matched by neither `storageReadMethods` nor
    // `storagePositionalMethods` nor `"appendEvent"`.
    //
    // Neuter: build the index from the INSTANCES and `continue` past a backend
    // that does not resolve (the pre-review spelling). RED reads: `viewer`
    // answers `Just true` for `storage:dbStore` on ANOTHER account.
    const registry = loadRegistry();
    const index = [
      { $tag: "StorageDescriptor", backend: "Db", method: "load", descriptor: "storage:dbLoad" },
      { $tag: "StorageDescriptor", backend: "Db", method: "store", descriptor: "storage:dbStore" },
      // Declared, but no live instance names it.
      { $tag: "StorageDescriptor", backend: "", method: "", descriptor: "storage:dbDelete" },
    ];
    const names = ["state:getInstance", "storage:dbLoad", "storage:dbStore", "storage:dbDelete"];
    for (const role of ["owner", "member", "viewer"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, A, names, index],
      );
      const permits = (descriptor: string, args: unknown[]) =>
        registry.evaluateAuthorityFunction("authority:permits", [
          envelope, { $tag: "Act", descriptor, args, fields: [] },
        ]);
      // The unbound act is refused with NO argument (not in the general row)…
      expect(permits("storage:dbDelete", []), role).toEqual({ $tag: "Just", _0: false });
      // …and refused WITH its own account too (in no storage row either).
      expect(permits("storage:dbDelete", [A, "id"]), role).toEqual({ $tag: "Just", _0: false });
      // THE CONTROLS: a bound read is reachable for every role, a bound write
      // only above viewer, and both stay partitioned.
      expect(permits("storage:dbLoad", [A, "id"]), role).toEqual({ $tag: "Just", _0: true });
      expect(permits("storage:dbLoad", [B, "id"]), role).toEqual({ $tag: "Just", _0: false });
      expect(permits("storage:dbStore", [A, "T", {}, "id"]), role)
        .toEqual({ $tag: "Just", _0: role === "viewer" ? false : true });
      expect(permits("state:getInstance", []), role).toEqual({ $tag: "Just", _0: true });
    }
  }, LONG);

  test("10 — a cross-account storage act is refused AT THE GATE, before the backend", async () => {
    const { registry } = spyStorage();
    const authority = roleAuthority("member", A);
    // Permitted on its own account.
    const own = await performStorageMethod(
      registry, ioContextFor(A, authority), "list", [A, "Probe", undefined, undefined],
    );
    expect(Array.isArray(own)).toBe(true);
    loadHits += 1;
    // Neuter: the storage-positional row emits `ArgAny`. RED reads: the B call
    // succeeds and returns an array.
    await expect(performStorageMethod(
      registry, ioContextFor(B, authority), "list", [B, "Probe", undefined, undefined],
    )).rejects.toThrow(/authority refused "storage:memoryList" \(refused\)/);
    expect(loadHits).toBe(1);
  }, LONG);

  test("11 — the event family is judged on `event.accountId`", async () => {
    const { registry } = spyStorage();
    const authority = roleAuthority("member", A);
    const event = (accountId: string) => ({ accountId, type: "probe" });
    await performStorageMethod(registry, ioContextFor(A, authority), "appendEvent", [event(A)]);
    // Neuter: drop the storage-event row's `ArgRecord`. RED reads: the B append
    // succeeds.
    await expect(performStorageMethod(
      registry, ioContextFor(B, authority), "appendEvent", [event(B)],
    )).rejects.toThrow(/authority refused "storage:memoryAppendEvent" \(refused\)/);
  }, LONG);

  test("12 — it is the ARGUED axis, not the ambient one", async () => {
    const { registry } = spyStorage();
    const authority = roleAuthority("member", A);
    // The IO context claims account A while the ACT argues B. The gate judges
    // the act. Neuter: as 10. RED reads: the call succeeds.
    await expect(performStorageMethod(
      registry, ioContextFor(A, authority), "list", [B, "Probe", undefined, undefined],
    )).rejects.toThrow(/authority refused "storage:memoryList" \(refused\)/);
    // And the converse: an ambient B with an act arguing A is PERMITTED, which
    // is what makes "the argued axis" the operative phrase rather than "both".
    await performStorageMethod(
      registry, ioContextFor(B, authority), "list", [A, "Probe", undefined, undefined],
    );
  }, LONG);

  test("13 — an unknown role mints successfully and denotes ∅", () => {
    const registry = loadRegistry();
    // Neuter: `authorityViewerOrUnknownEnvelope`'s wildcard arm returns the
    // member rows. RED reads: `state:getInstance` permitted.
    const handle = roleAuthority("janitor", A);
    const record = authenticateAuthority(handle)!;
    expect(record.envelope).toEqual({ $tag: "EvRows", rows: [] });
    expect(record.grant).toBe("membership-janitor");
    for (const descriptor of ["state:getInstance", "storage:memoryList", "http:fetch"]) {
      expect(
        registry.evaluateAuthorityFunction("authority:permits", [
          record.envelope, { $tag: "Act", descriptor, args: [], fields: [] },
        ]),
        descriptor,
      ).toEqual({ $tag: "Just", _0: false });
    }
  }, LONG);

  test("14 — a VIEWER cannot persist, and is refused at the storage leaf", async () => {
    const { registry } = spyStorage();
    const viewer = roleAuthority("viewer", A);
    // Reads reach the backend.
    await performStorageMethod(
      registry, ioContextFor(A, viewer), "list", [A, "Probe", undefined, undefined],
    );
    // Writes are refused at the gate, on the viewer's OWN account — this is a
    // ROLE restriction, not a partition one. Neuter: `viewer` gets the full
    // storage rows. RED reads: the store succeeds and returns an id.
    await expect(performStorageMethod(
      registry, ioContextFor(A, viewer), "store", [A, "Probe", { x: 1 }, "id-1"],
    )).rejects.toThrow(/authority refused "storage:memoryStore" \(refused\)/);
    await expect(performStorageMethod(
      registry, ioContextFor(A, viewer), "appendEvent", [{ accountId: A, type: "probe" }],
    )).rejects.toThrow(/authority refused "storage:memoryAppendEvent" \(refused\)/);
    // THE CONTROL, one input apart: the same act under `member` reaches it.
    const member = roleAuthority("member", A);
    await performStorageMethod(
      registry, ioContextFor(A, member), "store", [A, "Probe", { x: 1 }, "id-2"],
    );
    void storeHits;
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.21 / §6.23 / §6.24 / §6.25 — MEMBER MANAGEMENT.
// ---------------------------------------------------------------------------

describe("rights R2b — introducing authority is owner-only and ARGUED", () => {
  type Membership = { id: string; userId: string; accountId: string; role: string };
  let members: Membership[] = [];
  let created: unknown[] = [];
  const listedAccounts: string[] = [];
  let deleted: unknown[] = [];
  let reroled: unknown[] = [];

  spyOn(dbModule, "listAccountMembers").mockImplementation((async (accountId: string) => {
    listedAccounts.push(accountId);
    return members.filter((m) => m.accountId === accountId);
  }) as never);
  spyOn(dbModule, "createMembership").mockImplementation((async (input: unknown) => {
    created.push(input);
    const row = { id: "m-new", ...(input as Membership) };
    members.push(row as Membership);
    return row;
  }) as never);
  spyOn(dbModule, "deleteMembership").mockImplementation((async (...args: unknown[]) => {
    deleted.push(args);
    return undefined;
  }) as never);
  spyOn(dbModule, "setMembershipRole").mockImplementation((async (...args: unknown[]) => {
    reroled.push(args);
    return { id: "m-1", userId: args[0], accountId: args[1], role: args[2] };
  }) as never);

  beforeEach(() => {
    members = [
      { id: "m-owner", userId: USER, accountId: A, role: "owner" },
      { id: "m-second", userId: "second-user", accountId: A, role: "member" },
    ];
    created = [];
    deleted = [];
    reroled = [];
  });

  async function invite(role: string, params: Record<string, unknown>) {
    return runUnpersistedCallForTest(
      "auth:inviteMember",
      { input: params },
      {
        accountId: A, profileId: "", persistence: "ephemeral" as const,
        authority: roleAuthority(role, A),
      },
      loadRegistry(),
    );
  }

  test("21 — an OWNER invites; a MEMBER is refused at the gate, one hop down", async () => {
    const ok = await invite("owner", { accountId: A, userId: "new-user", role: "member" });
    expect((ok as { value?: unknown }).value).toBeDefined();
    expect(created).toHaveLength(1);

    // Neuter: drop the membership-writes row from the owner rows. RED reads:
    // the member's invite succeeds and `created` has length 2.
    created = [];
    let caught: unknown;
    try {
      await invite("member", { accountId: A, userId: "new-user", role: "member" });
    } catch (error) { caught = error; }
    let found: unknown = caught;
    for (let depth = 0; depth < 8 && found !== undefined && found !== null; depth += 1) {
      if (found instanceof AuthorityRefused) break;
      found = (found as { cause?: unknown }).cause;
    }
    expect(created).toHaveLength(0);
    expect(found).toBeInstanceOf(AuthorityRefused);
    expect((found as InstanceType<typeof AuthorityRefused>).descriptor).toBe("state:createMembership");
  }, LONG);

  test("21 — the ARGUED axes: another account and an unknown role are both refused", async () => {
    // Neuter: drop the membership-writes row's `ArgRecord`. RED reads: both
    // succeed and `created` has length 2.
    await expect(invite("owner", { accountId: B, userId: "new-user", role: "member" }))
      .rejects.toThrow(/authority refused "state:createMembership"/);
    await expect(invite("owner", { accountId: A, userId: "new-user", role: "janitor" }))
      .rejects.toThrow(/authority refused "state:createMembership"/);
    expect(created).toHaveLength(0);
  }, LONG);

  test("21 — the two membership WRITE rows are DISJOINT and their union is the family", () => {
    // ⚠ THE ANTI-OR PIN. Rows are a Kleene ∨, so a descriptor appearing in BOTH
    // write rows would take the UNION of their restrictions — and the delete
    // row carries no `role` axis, so the role constraint on create/set would be
    // silently bypassed. Disjointness is what makes the split safe.
    // Neuter: define `membershipDeleteDescriptors` as the whole family.
    // RED reads: the intersection is non-empty, and `create` with
    // `role = "janitor"` answers `Just true` under an owner.
    const registry = loadRegistry();
    const read = (id: string) => registry.evaluateAuthorityFunction(id, [0]) as string[];
    const roleArgued = read("authority:membershipRoleArguedDescriptors");
    const deletes = read("authority:membershipDeleteDescriptors");
    const family = read("authority:membershipLeafDescriptors");
    expect(roleArgued.filter((d) => deletes.includes(d))).toEqual([]);
    expect([...roleArgued, ...deletes].sort()).toEqual([...family].sort());
    // And the union IS what the general row excludes, so nothing in the family
    // can reach the general row.
    const owner = authenticateAuthority(roleAuthority("owner", A))!;
    for (const descriptor of family) {
      expect(
        registry.evaluateAuthorityFunction("authority:permits", [
          owner.envelope, { $tag: "Act", descriptor, args: [], fields: [] },
        ]),
        descriptor,
      ).toEqual({ $tag: "Just", _0: false });
    }
    // The positive half: with the right axes, the OWNER reaches each of them.
    const permits = (descriptor: string, fields: Record<string, unknown>) =>
      registry.evaluateAuthorityFunction("authority:permits", [
        owner.envelope,
        {
          $tag: "Act", descriptor, args: [fields],
          fields: Object.entries(fields).map(([name, value]) => ({ $tag: "ActField", name, value })),
        },
      ]);
    expect(permits("state:createMembership", { accountId: A, role: "member" }))
      .toEqual({ $tag: "Just", _0: true });
    expect(permits("state:setMembershipRole", { accountId: A, role: "viewer" }))
      .toEqual({ $tag: "Just", _0: true });
    // The delete row constrains the ACCOUNT and nothing else — no role needed.
    expect(permits("state:deleteMembership", { accountId: A }))
      .toEqual({ $tag: "Just", _0: true });
    expect(permits("state:deleteMembership", { accountId: B }))
      .toEqual({ $tag: "Just", _0: false });
    // And the role axis is NOT bypassable through the delete row.
    expect(permits("state:createMembership", { accountId: A, role: "janitor" }))
      .toEqual({ $tag: "Just", _0: false });
  }, LONG);

  test("the membership writes reach the query with the ARGUED account, not just a length", async () => {
    // ⚠ EVERY ASSERTION ON THESE SPIES WAS A LENGTH (review round 12).
    // `reroled` / `deleted` / `created` capture the arguments and nothing read
    // them, so the handler→query hop was unobserved: a handler that passed
    // `ctx.accountId` instead of the argued one would make the partition axis
    // decoration and every pin would stay green. This reads the captured
    // arguments.
    //
    // The SQL conjunct on the other side of that hop is pinned behaviourally in
    // `db/src/account-isolation.fixture.ts`; this is the hop itself.
    //
    // Neuter: pass `ctx.accountId` instead of `input.accountId` in
    // `state.set_membership_role`. RED reads: the captured account is B.
    members = [
      { id: "m-owner", userId: USER, accountId: A, role: "owner" },
      { id: "m-second", userId: "second-user", accountId: A, role: "member" },
    ];
    reroled = [];
    deleted = [];
    const authority = roleAuthority("owner", A);
    await runUnpersistedCallForTest(
      "auth:changeMemberRole",
      { input: { accountId: A, userId: "second-user", role: "viewer" } },
      { accountId: B, profileId: "", persistence: "ephemeral" as const, authority },
      loadRegistry(),
    );
    expect(reroled).toHaveLength(1);
    // (userId, accountId, role) — the ARGUED account, not the ambient B.
    expect(reroled[0]![1], "the re-role must carry the argued account").toBe(A);
    expect(reroled[0]![0]).toBe("second-user");
    expect(reroled[0]![2]).toBe("viewer");

    await runUnpersistedCallForTest(
      "auth:removeMember",
      { input: { accountId: A, userId: "second-user" } },
      { accountId: B, profileId: "", persistence: "ephemeral" as const, authority },
      loadRegistry(),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]![1], "the removal must carry the argued account").toBe(A);
    expect(deleted[0]![0]).toBe("second-user");
  }, LONG);

  test("the JUDGED entry is the entry the handler USES, for the membership family", async () => {
    // ⚠ THE DRIFT THIS CATCHES. `au.policy.partition` is entitled only while the
    // field the gate judges is the field the leaf reads. A handler that switched
    // to `ctx.accountId` would make the partition axis decoration, and every
    // other pin would stay green. The reverse drift (a rename) is fail-closed —
    // an absent field refuses — so only this direction needs observing.
    const registry = loadRegistry();
    const owner = roleAuthority("owner", A);
    // The ACT argues A; the ambient IO context says B.
    const leaf = registry.getIOHandler("state:listAccountMembers")!;
    members = [{ id: "m-1", userId: USER, accountId: A, role: "owner" }];
    // ⚠ READS THE DESCRIBE-SCOPE SPY'S OWN LOG rather than installing a second
    // one. A nested `spyOn(...).mockRestore()` would restore the REAL
    // `@fenel/db` binding for every later test in this file, and the real one
    // opens a database this process deliberately does not have — which is how
    // pin 23 failed in the full run and passed in isolation.
    listedAccounts.length = 0;
    await leaf({ accountId: A }, ioContextFor(B, owner));
    expect(listedAccounts).toEqual([A]);
  }, LONG);

  test("23 — the LAST OWNER cannot be demoted or removed", async () => {
    const call = async (fn: string, params: Record<string, unknown>) =>
      runUnpersistedCallForTest(
        fn, { input: params },
        {
          accountId: A, profileId: "", persistence: "ephemeral" as const,
          authority: roleAuthority("owner", A),
        },
        loadRegistry(),
      );
    // Neuter: delete the `authSoleOwnerIs` guard. RED reads: the leaf spy
    // records a call and the result is `Ok`.
    const demote = await call("auth:changeMemberRole", { accountId: A, userId: USER, role: "member" });
    expect((demote as { value?: { $tag?: string } }).value?.$tag).toBe("Err");
    expect(reroled).toHaveLength(0);
    const remove = await call("auth:removeMember", { accountId: A, userId: USER });
    expect((remove as { value?: { $tag?: string } }).value?.$tag).toBe("Err");
    expect(deleted).toHaveLength(0);

    // THE CONTROL: with a SECOND owner, both reach the leaf.
    members.push({ id: "m-2", userId: "second-owner", accountId: A, role: "owner" });
    const ok = await call("auth:changeMemberRole", { accountId: A, userId: USER, role: "member" });
    expect((ok as { value?: { $tag?: string } }).value?.$tag).toBe("Ok");
    expect(reroled).toHaveLength(1);
    const gone = await call("auth:removeMember", { accountId: A, userId: USER });
    expect((gone as { value?: { $tag?: string } }).value?.$tag).toBe("Ok");
    expect(deleted).toHaveLength(1);
  }, LONG);

  test("24 — the session leaves refuse at BOTH layers, independently", async () => {
    const registry = loadRegistry();
    // Layer 1 — the GATE. An owner is refused `state:createSession` because no
    // account envelope names it.
    await expect(runUnpersistedCallForTest(
      "auth:issueSession",
      { input: { userId: USER, accountId: A, label: { $tag: "Nothing" }, expiresAt: { $tag: "Nothing" } } },
      {
        accountId: A, profileId: "", persistence: "ephemeral" as const,
        authority: roleAuthority("owner", A),
      },
      registry,
    )).rejects.toThrow(/authority refused/);

    // Layer 2 — the LEAF's realm bit, reached by a `test`-issuer envelope that
    // DOES name it. Two mechanisms, two neuters.
    //
    // ⚠ THROUGH `getIOHandler`, NOT `invokeIOActionAs`. The latter takes the
    // DURABLE path, whose first line is `dependencies.getDb()`, and this process
    // has no `DATABASE_URL` precisely so nothing here can write — it would fail
    // on the database before reaching either layer. `getIOHandler` synthesises
    // the compatibility wrapper that re-enters the SAME gate with the caller's
    // authority, so the gate is genuinely crossed and the leaf genuinely runs.
    const naming = mintAuthority(registry, {
      envelope: registry.evaluateAuthorityFunction(
        "authority:descriptorEnvelope", [registry.listPerformDescriptors()],
      ),
      issuer: "test", accountId: A, principal: null, lane: null, grant: null, mintedAt: 0,
    });
    const leaf = registry.getIOHandler("state:createSession")!;
    expect(leaf).toBeDefined();
    await expect(leaf(
      { userId: USER, accountId: A, tokenHash: "x" },
      ioContextFor(A, naming as never),
    )).rejects.toThrow(/identity leaves require the privileged execution realm/);
    void invokeIOActionAs;
  }, LONG);

  test("25 — the fence and the list still name the same set after the split", () => {
    const registry = loadRegistry();
    const fenced = registry.evaluateAuthorityFunction(
      "authority:sessionLeafDescriptors", [0],
    ) as string[];
    // 8 since 2026-09-23: `state:listUserMemberships` (account selection) is an
    // identity leaf, fenced like the session family.
    expect(fenced).toHaveLength(8);
    expect(fenced).not.toContain("state:createMembership");
    // The production pair is equal — `registerStateHandlers` asserts it at
    // registration, and re-asserting here is what makes that an observation.
    expect(() => registerStateHandlers(registry)).not.toThrow();
    expect(() => assertFencedLeavesMatch([...fenced], [...fenced])).not.toThrow();
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.27 — THE UNMEDIATED-NATIVE CENSUS, as a DISCRIMINATING pin.
// ---------------------------------------------------------------------------

describe("rights R2b — no requires-bearing native escapes mediation", () => {
  function unmediated(registry: ReturnType<typeof loadRegistry>): string[] {
    const dispatch = registry.evaluateContext()._specRegistry as
      | { getClass(id: string): unknown }
      | undefined;
    if (dispatch === undefined) return ["<no dispatch registry>"];
    const found: string[] = [];
    for (const fn of registry.listFunctions()) {
      const requires = (fn as { requires?: Array<{ class?: { entityId?: string } }> }).requires;
      if (requires === undefined || requires.length === 0) continue;
      if (!registry.hasNativeDescriptor(fn.id)) continue;
      const registered = requires.some(
        (c) => c.class?.entityId !== undefined && dispatch.getClass(c.class.entityId) !== undefined,
      );
      if (!registered) found.push(fn.id);
    }
    return found;
  }

  test("27 — zero in production, and the same check REPORTS a planted one", () => {
    expect(unmediated(loadRegistry())).toEqual([]);
    // THE DISCRIMINATION. Without it, "zero" would be indistinguishable from a
    // check that reports nothing at all.
    const planted = createRegistry([
      stdModule,
      {
        name: "probe",
        label: "unmediated-native probe",
        functions: [{
          id: "probe:escapes",
          params: [],
          returns: { $ref: "String" },
          requires: [{ class: { $tag: "Id", entityId: "NoSuchClass" }, args: [] }],
        }],
        nativeImpls: { "probe:escapes": () => "escaped" },
      } as never,
    ]);
    expect(unmediated(planted)).toEqual(["probe:escapes"]);
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.26 — THE TWO MODULE-SCOPE `EvTop` CAPTURES ARE GONE.
//
// ⚠ THIS PIN IS STRUCTURAL, AND IT SAYS SO. R2a's note §8 records both captures
// with the honest qualifier that "no escalation is LIVE — the bodies reached
// through those two calls are pure and perform nothing". That is still true, and
// it is exactly why a BEHAVIOURAL pin is not available: there is no body
// reachable through these helpers that performs, so no authority can be observed
// to matter. What the change guarantees is that the frame is built PER CALL from
// the leaf's own handle rather than captured once at module load, and that is
// what is asserted — plus a control that the pure helpers still answer, so the
// retirement is proved behaviour-preserving rather than assumed to be.
//
// A behavioural pin becomes possible the moment one of these bodies performs;
// whoever makes that true owns writing it.
// ---------------------------------------------------------------------------

describe("rights R2b — the Telegram helpers build their frame per call", () => {
  test("26 — no module-scope evaluate context survives, and the helpers take the authority", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "implementations/typescript/runtime/src/handlers/telegram-form.ts",
      "implementations/typescript/runtime/src/handlers/telegram-collector.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Neuter: restore `const _FENEL_CTX = getSystemEvaluateContext();`.
      // RED reads: the module-scope capture matches.
      expect(source, file).not.toMatch(/^const _FENEL_CTX = getSystemEvaluateContext\(\);$/m);
      // And the per-call builder IS the explicit-override shape.
      expect(source, file).toMatch(
        /function fenelFrame\(authority: AuthorityRef\)[\s\S]{0,80}_authority: authority/,
      );
    }
    // THE CONTROL: the pure helpers still answer, under a REFUSING authority —
    // the retirement changed the frame, not the result.
    const { _internals } = await import("./handlers/telegram-form");
    const refusing = mintAuthority(loadRegistry(), {
      envelope: loadRegistry().evaluateAuthorityFunction("authority:emptyEnvelope", [0]),
      issuer: "test", accountId: A, principal: null, lane: null, grant: null, mintedAt: 0,
    });
    expect(_internals.formatValue(refusing, "hello")).toBe("hello");
    expect(_internals.tryParseBoolean(refusing, "yes")).toBe(true);
    expect(_internals.tryParseBoolean(refusing, "no")).toBe(false);
  }, LONG);
});

// ---------------------------------------------------------------------------
// THE STORAGE POLICY INPUT IS REPO-OWNED, AND NO ACCOUNT CAN MOVE IT.
//
// Two adversarial-review rounds found three ways an account could reach into
// this projection, and each was a live escalation. The property these pins hold
// is the one that makes `au.policy.partition` entitled: BOTH halves of the
// index — which descriptors are storage acts, and which (backend, method) each
// is — come from the `storage` MODULE OBJECT the registry loaded, and nothing an
// account can install or register is on that path.
// ---------------------------------------------------------------------------

describe("rights R2b — the storage index is unreachable from an account", () => {
  test("an account module SHADOWING a leaf's bare name changes nothing", async () => {
    // ⚠ THE SHADOW IS REAL, and the pin asserts that first — otherwise it would
    // pass by not reproducing the attack. `getFunction("dbStore")` really does
    // return the account's function: the codeName map is last-wins and account
    // modules merge AFTER the repository ones.
    //
    // Neuter: resolve the declarations with `registry.getFunction(member)`
    // instead of reading `module.functions` by identity.
    // RED reads: 23 declared instead of 24, and `viewer` answers `Just true`
    // for `storage:dbStore` on ANY account.
    const { randomUUID } = await import("node:crypto");
    const { prepareSourceModule, sourceModuleRegistry } =
      await import("@fenel/engine/authoring/source-module");
    const source = [
      "module probe where",
      "",
      "dbStore : (accountId: String) -> (entityType: String) -> (data: Map String Any) -> (id: String) -> { id: String }",
      "dbStore accountId entityType data id = { id = id }",
      "",
    ].join("\n");
    const prepared = prepareSourceModule(source, "probe", { version: 1, fields: [] }, randomUUID);
    const shadowed = sourceModuleRegistry([prepared]);
    expect(shadowed.getFunction("dbStore")?.id).toBe("probe:dbStore");
    expect(shadowed.getFunction("storage:dbStore")?.id).toBe("storage:dbStore");

    const permits = (role: string, descriptor: string, args: unknown[]) => {
      const record = authenticateAuthority(mintRequestAuthority(shadowed, {
        accountId: A, role, membershipId: "m", subject: null,
      }))!;
      return shadowed.evaluateAuthorityFunction("authority:permits", [
        record.envelope, { $tag: "Act", descriptor, args, fields: [] },
      ]);
    };
    expect(permits("viewer", "storage:dbStore", [A, "T", {}, "id"])).toEqual({ $tag: "Just", _0: false });
    expect(permits("viewer", "storage:dbStore", [B, "T", {}, "id"])).toEqual({ $tag: "Just", _0: false });
    expect(permits("member", "storage:dbStore", [B, "T", {}, "id"])).toEqual({ $tag: "Just", _0: false });
    // THE CONTROLS: the leaf is still reachable for the roles and accounts that
    // should reach it, so the pin is not "everything is refused".
    expect(permits("member", "storage:dbStore", [A, "T", {}, "id"])).toEqual({ $tag: "Just", _0: true });
    expect(permits("viewer", "storage:dbLoad", [A, "id"])).toEqual({ $tag: "Just", _0: true });
  }, LONG);

  test("a HOSTILE StorageHandler instance cannot re-classify a write as a read", async () => {
    // ⚠ WHICH ROW AN ACT LANDS IN IS DECIDED BY ITS `method`, so whoever
    // controls the binding controls read-versus-write. `dispatch:register` is in
    // the general row for EVERY role, so a `viewer` can register a fresh tag
    // whose `load` names `storage:dbStore`.
    //
    // Neuter: take the binding from `dispatchRegistry.listInstances` instead of
    // from the `storage` module's own declared instances.
    // RED reads: the index throws "bound to both Memory.store and R2bEvil.store"
    // (its one-descriptor-one-binding check sees the hostile row, measured
    // 2026-09-25); with that check gone too, `viewer` answers `Just true` for
    // `storage:dbStore` on its own account — the one restriction R2b claims it
    // can defend, gone.
    const { sourceModuleRegistry } = await import("@fenel/engine/authoring/source-module");
    const hostile = {
      typeName: "StorageHandler",
      args: ["R2bEvil"],
      methods: {
        store: "storage:memoryStore", load: "storage:dbStore", update: "storage:memoryUpdate",
        delete: "storage:memoryDelete", list: "storage:memoryList",
        appendEvent: "storage:memoryAppendEvent", loadType: "storage:memoryLoadType",
        loadTypeByName: "storage:memoryLoadTypeByName", scope: "global",
      },
      // ⚠ rights R3a — THE FIXTURE ROW IS OWNED, and the change narrows this
      // test's own threat model in the right direction. R2b planted it GLOBAL,
      // which after R3a no account can write at all (the register natives ask
      // one Fenel disposition and a frame with no account REFUSES) and no
      // caller can remove (deletion names an owner, and nobody owns a global
      // row — so the old cleanup silently left it behind). The hostile shape an
      // account CAN still produce is an ACCOUNT-OWNED row, which is what this
      // now plants. The claim under test is unchanged: the storage policy index
      // does not read `listInstances` at all, so no registered handler
      // re-classifies a write as a read.
      scope: { kind: "account", accountId: A },
    };
    const ownerVisibility = { kind: "frame", account: A, tags: [] } as never;
    dispatchRegistry.addInstance(hostile as never);
    try {
      expect(dispatchRegistry.resolve("R2bEvil", "StorageHandler", ownerVisibility)).toBeDefined();
      // and it is invisible to the honest fence, which is the R3a half
      expect(dispatchRegistry.resolve("R2bEvil", "StorageHandler", GLOBAL_ONLY)).toBeUndefined();
      // A FRESH registry object, so the index is rebuilt with the hostile
      // instance present — the production shape after an account-registry
      // rebuild or a process restart.
      const fresh = sourceModuleRegistry([]);
      const permits = (role: string, descriptor: string, args: unknown[]) => {
        const record = authenticateAuthority(mintRequestAuthority(fresh, {
          accountId: A, role, membershipId: "m", subject: null,
        }))!;
        return fresh.evaluateAuthorityFunction("authority:permits", [
          record.envelope, { $tag: "Act", descriptor, args, fields: [] },
        ]);
      };
      expect(permits("viewer", "storage:dbStore", [A, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: false });
      expect(permits("member", "storage:dbStore", [A, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: true });
      expect(permits("member", "storage:dbStore", [B, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: false });
      expect(permits("viewer", "storage:dbLoad", [A, "id"]))
        .toEqual({ $tag: "Just", _0: true });
    } finally {
      dispatchRegistry.removeInstance("StorageHandler", "R2bEvil", A);
    }
    expect(dispatchRegistry.resolve("R2bEvil", "StorageHandler", ownerVisibility)).toBeUndefined();
  }, LONG);

  // -------------------------------------------------------------------------
  // modules-as-values Phase 2c — a `StorageHandler` method value may be a
  // function REFERENCE (`{$ref: "storage.dbStore"}`) instead of the id string.
  // Both readers (`storageIndex` here, `storageDescriptor` in the storage seam)
  // map a reference ONLY through the storage module's own `HasStateIO`
  // declarations (`storageActsByHandle`): the act's id or `storage.<member>`.
  // Nothing is resolved through a registry, so a handle the registry WOULD
  // resolve (a bare member, a UUID) binds nothing here.
  // -------------------------------------------------------------------------

  type StorageRow = { $tag: string; backend: string; method: string; descriptor: string };
  type RegistryUnderTest = ReturnType<typeof loadRegistry>;
  type ModuleView = RegistryUnderTest["modules"][number];

  function storageModuleView(registry: RegistryUnderTest): ModuleView {
    const found = registry.modules.filter((module) => module.name === "storage");
    expect(found).toHaveLength(1);
    return found[0]!;
  }

  /** The index `storageIndex` builds when the registry's module set is just
   *  `module`. Every other registry method is the real one, so a reader that
   *  asked `getFunction` or `getUuid` would get the real answers. */
  function indexOver(registry: RegistryUnderTest, module: unknown): StorageRow[] {
    return storageIndex(
      Object.create(registry, { modules: { value: [module] } }) as RegistryUnderTest,
    ) as StorageRow[];
  }

  /** `module` with each StorageHandler method value replaced by
   *  `rewrite(id, backend)`, where `id` is the act the value names in whichever
   *  spelling the instance file uses. A synthetic copy: the file is untouched. */
  function withStorageMethods(
    module: ModuleView,
    rewrite: (id: string, backend: string) => unknown,
  ): ModuleView {
    return {
      ...module,
      instances: (module.instances ?? []).map((instance) => {
        if (instance.typeName !== "StorageHandler") return instance;
        const backend = String(instance.args[0]);
        const methods: Record<string, unknown> = {};
        for (const [method, value] of Object.entries(instance.methods)) {
          const id = storageActIdOf(value);
          methods[method] = id === undefined ? value : rewrite(id, backend);
        }
        return { ...instance, methods };
      }),
    };
  }

  const qualifiedHandle = (id: string) => `storage.${id.slice("storage:".length)}`;

  test("a HOSTILE StorageHandler instance holding a REFERENCE cannot re-classify a write as a read", async () => {
    // The pin above with the method written as a reference: `load` is
    // `{$ref: "storage.dbStore"}`. The index reads references only from the
    // storage module's own instances, so a registered row changes nothing.
    //
    // Neuter: take the bindings from `dispatchRegistry.listInstances("StorageHandler")`
    // instead of the module's own instances. RED reads: `authority:
    // "storage:memoryStore" is bound to both Memory.store and R2bEvilRef.store` —
    // the hostile reference and the boot string are one act to the conflict
    // check. (The string pin above goes RED the same way, naming `R2bEvil.store`.)
    const { sourceModuleRegistry } = await import("@fenel/engine/authoring/source-module");
    const hostile = {
      typeName: "StorageHandler",
      args: ["R2bEvilRef"],
      methods: {
        store: { $ref: "storage.memoryStore" }, load: { $ref: "storage.dbStore" },
        update: { $ref: "storage.memoryUpdate" }, delete: { $ref: "storage.memoryDelete" },
        list: { $ref: "storage.memoryList" }, appendEvent: { $ref: "storage.memoryAppendEvent" },
        loadType: { $ref: "storage.memoryLoadType" },
        loadTypeByName: { $ref: "storage.memoryLoadTypeByName" },
      },
      scope: { kind: "account", accountId: A },
    };
    const ownerVisibility = { kind: "frame", account: A, tags: [] } as never;
    dispatchRegistry.addInstance(hostile as never);
    try {
      expect(dispatchRegistry.resolve("R2bEvilRef", "StorageHandler", ownerVisibility)).toBeDefined();
      const fresh = sourceModuleRegistry([]);
      const permits = (role: string, descriptor: string, args: unknown[]) => {
        const record = authenticateAuthority(mintRequestAuthority(fresh, {
          accountId: A, role, membershipId: "m", subject: null,
        }))!;
        return fresh.evaluateAuthorityFunction("authority:permits", [
          record.envelope, { $tag: "Act", descriptor, args, fields: [] },
        ]);
      };
      expect(permits("viewer", "storage:dbStore", [A, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: false });
      expect(permits("member", "storage:dbStore", [A, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: true });
      expect(permits("member", "storage:dbStore", [B, "T", {}, "id"]))
        .toEqual({ $tag: "Just", _0: false });
      expect(permits("viewer", "storage:dbLoad", [A, "id"]))
        .toEqual({ $tag: "Just", _0: true });
    } finally {
      dispatchRegistry.removeInstance("StorageHandler", "R2bEvilRef", A);
    }
    expect(dispatchRegistry.resolve("R2bEvilRef", "StorageHandler", ownerVisibility)).toBeUndefined();
  }, LONG);

  test("storage instances holding REFERENCES yield exactly the index their id strings do", () => {
    // Neuter: the strings-only reader (skip every non-string method value).
    // RED reads: all 24 rows unbound (`- Expected - 48 / + Received + 48`, every
    // `backend` and `method` empty), i.e. every storage act refused for every role.
    const registry = loadRegistry();
    const real = storageModuleView(registry);
    const strings = indexOver(registry, withStorageMethods(real, (id) => id));
    // The copy spelled with id strings reproduces the policy's own index,
    // whichever spelling the instance file uses…
    expect(strings).toEqual(storageIndex(registry) as StorageRow[]);
    expect(strings).toHaveLength(24);
    expect(strings.filter((row) => row.method === "")).toEqual([]);
    // …and so do the reference-holding copies: qualified, colon, and mixed.
    expect(indexOver(registry, withStorageMethods(real, (id) => ({ $ref: qualifiedHandle(id) }))))
      .toEqual(strings);
    expect(indexOver(registry, withStorageMethods(real, (id) => ({ $ref: id }))))
      .toEqual(strings);
    expect(indexOver(registry, withStorageMethods(real, (id, backend) =>
      backend === "Db" ? { $ref: qualifiedHandle(id) } : backend === "Memory" ? id : { $ref: id },
    ))).toEqual(strings);
    // A reference and a string naming one act are ONE binding to the conflict
    // check: `Db.store` as a reference, `Memory.load` as the id string.
    const conflicting = withStorageMethods(real, (id, backend) => {
      if (id === "storage:dbStore") return { $ref: "storage.dbStore" };
      if (backend === "Memory" && id === "storage:memoryLoad") return "storage:dbStore";
      return id;
    });
    expect(() => indexOver(registry, conflicting))
      .toThrow(/"storage:dbStore" is bound to both Db\.store and Memory\.load/);
    // The policy reads the reference-built index as it reads the string one.
    const index = indexOver(registry, withStorageMethods(real, (id) => ({ $ref: qualifiedHandle(id) })));
    for (const role of ["owner", "member", "viewer"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, A, ["storage:dbStore", "storage:dbLoad"], index],
      );
      const permits = (descriptor: string, args: unknown[]) =>
        registry.evaluateAuthorityFunction("authority:permits", [
          envelope, { $tag: "Act", descriptor, args, fields: [] },
        ]);
      expect(permits("storage:dbStore", [A, "T", {}, "id"]), role)
        .toEqual({ $tag: "Just", _0: role !== "viewer" });
      expect(permits("storage:dbStore", [B, "T", {}, "id"]), role).toEqual({ $tag: "Just", _0: false });
      expect(permits("storage:dbLoad", [A, "id"]), role).toEqual({ $tag: "Just", _0: true });
      expect(permits("storage:dbLoad", [B, "id"]), role).toEqual({ $tag: "Just", _0: false });
    }
  }, LONG);

  test("the index binds a reference ONLY through the storage module's own declarations", () => {
    // Neuter: resolve a reference with `registry.getFunction(handle)?.id`, as
    // the other method-value readers do. RED reads: at `bare member`,
    // `storage:dbStore` bound to `Db.store` instead of left unbound.
    const registry = loadRegistry();
    const real = storageModuleView(registry);
    const strings = indexOver(registry, withStorageMethods(real, (id) => id));
    // The REGISTRY resolves these handles, which is why the index must not ask it.
    const uuid = registry.getUuid("storage:dbStore");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(registry.getFunction(uuid!)?.id).toBe("storage:dbStore");
    expect(registry.getFunction("dbStore")?.id).toBe("storage:dbStore");
    expect(registry.getFunction("storage.jsonContains")?.id).toBe("storage:jsonContains");
    let getterRan = false;
    const accessor = Object.defineProperty({}, "$ref", {
      get: () => {
        getterRan = true;
        return "storage.dbStore";
      },
      enumerable: true,
    });
    const hostile: Array<[string, unknown]> = [
      ["bare member", { $ref: "dbStore" }],
      ["uuid", { $ref: uuid }],
      ["foreign member", { $ref: "evil.dbStore" }],
      ["another module's id", { $ref: "probe:dbStore" }],
      ["a storage query, not an act", { $ref: "storage.jsonContains" }],
      ["accessor $ref", accessor],
      ["inherited $ref", Object.create({ $ref: "storage.dbStore" })],
    ];
    const unbound = { $tag: "StorageDescriptor", backend: "", method: "", descriptor: "storage:dbStore" };
    for (const [label, value] of hostile) {
      const index = indexOver(
        registry, withStorageMethods(real, (id) => (id === "storage:dbStore" ? value : id)),
      );
      // The act is left UNBOUND; every other row is unchanged.
      expect(index, label).toEqual(
        strings.map((row) => (row.descriptor === "storage:dbStore" ? unbound : row)),
      );
    }
    expect(getterRan).toBe(false);
    // An unbound act is in no row: refused for every role, with or without its
    // own account (the `an UNBOUND storage act` pin's claim, on this index).
    const index = indexOver(
      registry, withStorageMethods(real, (id) => (id === "storage:dbStore" ? { $ref: "dbStore" } : id)),
    );
    for (const role of ["owner", "member", "viewer"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, A, ["storage:dbStore", "storage:dbLoad"], index],
      );
      const permits = (descriptor: string, args: unknown[]) =>
        registry.evaluateAuthorityFunction("authority:permits", [
          envelope, { $tag: "Act", descriptor, args, fields: [] },
        ]);
      expect(permits("storage:dbStore", [A, "T", {}, "id"]), role).toEqual({ $tag: "Just", _0: false });
      expect(permits("storage:dbStore", []), role).toEqual({ $tag: "Just", _0: false });
      expect(permits("storage:dbLoad", [A, "id"]), role).toEqual({ $tag: "Just", _0: true });
    }
  }, LONG);

  test("the storage seam performs a reference as its id and refuses every other handle", async () => {
    // Neuters: (1) take any handle as the descriptor (`storageActs.get(handle)
    // ?? handle`). RED reads: `perform: authority refused "memoryList"
    // (refused)` where the seam's own refusal was expected. (2) The
    // strings-only reader. RED reads: `StorageHandler R2bRefSeam.list is not a
    // data descriptor` at the first reference.
    const registry = loadRegistry();
    const authority = roleAuthority("member", A);
    const TAG = "R2bRefSeam";
    const TYPE = "R2bRefSeamType";
    /** Performs `list` for the argued account through a row A OWNS, whose
     *  `list` is `value`. */
    const listThrough = async (value: unknown, argued = A, afterRegister?: () => void) => {
      dispatchRegistry.addInstance({
        typeName: "StorageHandler",
        args: [TAG],
        methods: { list: value },
        scope: { kind: "account", accountId: A },
      } as never);
      try {
        afterRegister?.();
        return await withStorageBackend(TAG, () => performStorageMethod(
          registry, ioContextFor(A, authority), "list", [argued, TYPE, undefined, undefined],
        ));
      } finally {
        dispatchRegistry.removeInstance("StorageHandler", TAG, A);
      }
    };
    // The reference performs the act its id string performs…
    expect(await listThrough("storage:memoryList")).toEqual([]);
    expect(await listThrough({ $ref: "storage.memoryList" })).toEqual([]);
    expect(await listThrough({ $ref: "storage:memoryList" })).toEqual([]);
    // …and that act is judged at the gate on its own name and argued account.
    await expect(listThrough({ $ref: "storage.memoryList" }, B))
      .rejects.toThrow(/authority refused "storage:memoryList" \(refused\)/);
    // Every other handle is refused by the seam, before anything is performed.
    const uuid = registry.getUuid("storage:memoryList");
    expect(uuid).toBeDefined();
    for (const handle of ["memoryList", uuid!, "evil.memoryList", "probe:memoryList", "storage.jsonContains"]) {
      await expect(listThrough({ $ref: handle }), handle).rejects.toThrow(
        `StorageHandler ${TAG}.list references ${JSON.stringify(handle)}, `
        + "which is not one of the storage module's own acts",
      );
    }
    const notData = `StorageHandler ${TAG}.list is not a data descriptor`;
    await expect(listThrough(Object.create({ $ref: "storage.memoryList" }))).rejects.toThrow(notData);
    // An accessor cannot be registered, and one added afterwards is never run.
    let getterRan = false;
    const later: Record<string, unknown> = {};
    await expect(listThrough(later, A, () => {
      Object.defineProperty(later, "$ref", {
        get: () => {
          getterRan = true;
          return "storage.memoryList";
        },
        enumerable: true,
      });
    })).rejects.toThrow(notData);
    expect(getterRan).toBe(false);
    expect(dispatchRegistry.resolve(TAG, "StorageHandler", { kind: "frame", account: A, tags: [] } as never))
      .toBeUndefined();
  }, LONG);
});

// ---------------------------------------------------------------------------
// REVIEW ROUND 3 — three guards over what the phase PUBLISHES and what the
// realm GRANTS. Each closes a way the policy could be written against a name
// that is in no row, which reads as "fenced" and is not.
// ---------------------------------------------------------------------------

describe("rights R2b — the published-name census, the state partition, and the realm's live grant", () => {
  // ⚠ A REGISTRY BUILT BY THE PRODUCTION PATH, REBUILT PER TEST. An earlier pin
  // in this file calls `registerStateHandlers(registry)` a second time on the
  // live registry to observe its fence assertion — and a second handler pass
  // RE-REGISTERS the 146 dotted `state.*` names as implementation-bearing,
  // undoing the canonicalisation that ran before it. That is not a production
  // shape (`buildExecutionRegistry` registers handlers once and canonicalises
  // last) but it is a real property worth knowing: canonicalisation is not
  // idempotent under a repeated registration pass.
  //
  // Rebuilt ONCE for this block, not before each of its ten pins (which cost
  // ~140 s a run): the pollution above comes from an EARLIER block, and no pin
  // here re-registers anything. The check after each pin keeps that true: a
  // pin that changes the live registry's published descriptors fails here,
  // naming itself, instead of silently feeding the next one.
  let published = "";
  beforeAll(() => {
    resetRegistryCache();
    published = JSON.stringify([...loadRegistry().listPerformDescriptors()].sort());
  });
  afterEach(() => {
    expect(JSON.stringify([...loadRegistry().listPerformDescriptors()].sort()), "a pin changed the live registry").toBe(published);
  });

  test("every published descriptor is a colon function id, except an ENUMERATED carve-out", () => {
    // ⚠ THE PHASE'S CENTRAL CLAIM IS "ONE NAME PER ACT, AND IT IS THE FUNCTION
    // ID" — and it is FALSE for 22 acts, so the honest form is an enumerated
    // carve-out that cannot grow silently. Three different reasons, measured:
    //
    //  · `dispatch.*` (5) — the deliberate `ownsItsNative` carve-out. Both
    //    spellings are implementation-bearing and they are DIFFERENT acts.
    //  · `state.validate_function_args` (1) — a handler-only registration with
    //    no Fenel declaration at all, so there is no function id to
    //    canonicalise TO. (The four `fs.*` acts were here, 26 in all, until
    //    GP-21's stopgap stopped registering them; see the GP-21 block.)
    //  · `notion.*` (16) — these DO have Fenel declarations carrying
    //    `@ioAction "notion.X"` (`fenel/modules/notion/endpoints.fenel`), but the
    //    directive never reaches `runtimeIOAction`, so `registerFenelBodyDispatchers`
    //    hits `if (!nativeAction) continue` and never canonicalises. The colon id
    //    `notion:createPage` is NOT published.
    //
    // WHY THAT MATTERS, and why this is a pin rather than a note: every fenced
    // family in `authority.fenel` is written in colon ids. A future phase
    // fencing `notion:createPage` would produce a descriptor that is in NO row —
    // which the checker answers `Just false` for, so the obvious regression test
    // ("assert the colon id is refused") passes — while `notion.createPage`, the
    // name the runtime actually performs, stays in the general row. That is R2a's
    // two-spelling defect on the exact class this phase claims made it
    // unrepresentable.
    //
    // Neuter: drop `"notion.search"` from the expected list. RED reads: the
    // measured set carries a name the carve-out does not admit.
    const registry = loadRegistry();
    const published = registry.listPerformDescriptors();
    const dotted = published
      .filter((d) => d.includes(".") && !d.includes(":") && /^[a-z]/.test(d))
      .sort();
    expect(dotted).toEqual([
      "dispatch.lookup", "dispatch.lookup_all", "dispatch.lookup_one",
      "dispatch.register", "dispatch.unregister",
      "notion.appendBlockChildren", "notion.createComment", "notion.createPage",
      "notion.deleteBlock", "notion.listUsers", "notion.queryDatabase",
      "notion.retrieveBlock", "notion.retrieveBlockChildren", "notion.retrieveComments",
      "notion.retrieveDatabase", "notion.retrieveMe", "notion.retrievePage",
      "notion.retrieveUser", "notion.search", "notion.updateBlock", "notion.updatePage",
      "state.validate_function_args",
    ]);
    // And the trap, stated as an assertion rather than as prose: for the notion
    // family the colon id is NOT a published act, so a fence written against it
    // fences nothing.
    for (const id of ["notion:createPage", "notion:search", "notion:retrieveMe"]) {
      expect(published.includes(id), id).toBe(false);
    }
    // The CONTROL: the ordinary case really is the colon id.
    expect(published.includes("state:createInstance")).toBe(true);
    expect(published.includes("state.create_instance")).toBe(false);
  }, LONG);

  test("the account-argued state leaves are the MEASURED set, and they are partitioned", () => {
    // ⚠ THE AUTHORED LIST, PINNED TO A MEASUREMENT. `accountArguedStateDescriptors`
    // is hand-written (unlike the storage index, which is derived), so this walks
    // every module and selects the shape: a BODILESS HasStateIO native, outside
    // `storage`, whose first declared parameter is named `accountId`. Those are
    // exactly the acts that reach the database with a caller-supplied account and
    // never pass through a `storage:` leaf.
    //
    // Neuter: drop one name from `accountArguedStateDescriptors`. RED reads: the
    // measured set carries a name the list does not.
    const registry = loadRegistry();
    const measured: string[] = [];
    for (const module of (registry as unknown as { modules: readonly {
      name: string;
      functions?: readonly { id: string; body?: unknown; params?: readonly unknown[];
        requires?: readonly { class?: { entityId?: string } }[] }[];
    }[] }).modules) {
      if (module.name === "storage") continue;
      for (const fn of module.functions ?? []) {
        if (fn.body !== undefined && fn.body !== null) continue;
        if (!(fn.requires ?? []).some((c) => c.class?.entityId === "HasStateIO")) continue;
        const first = (fn.params ?? [])[0] as { name?: string } | string | undefined;
        const name = typeof first === "string" ? first : first?.name;
        if (name === "accountId") measured.push(fn.id);
      }
    }
    const declared = registry.evaluateAuthorityFunction(
      "authority:accountArguedStateDescriptors", [0],
    ) as string[];
    // `state:listAccountMembers` is of the same shape and is partitioned by the
    // MEMBERSHIP-READ row instead, so it is measured here and excluded there.
    const membershipRead = registry.evaluateAuthorityFunction(
      "authority:membershipReadDescriptors", [0],
    ) as string[];
    expect(measured.filter((id) => !membershipRead.includes(id)).sort())
      .toEqual([...declared].sort());
    expect(declared.length).toBeGreaterThan(0);

    // ⚠ AND THE AXIS KIND IS PINNED TO WHAT DECIDES IT — the CALLING CONVENTION,
    // which is the one thing the row's comment asserts and nothing measured
    // (review round 4). A record axis reads `act.fields`, and `fields` is the
    // own-data projection of `args[0]` — which only exists when the act is
    // performed with a params RECORD in slot 0. A leaf added to this list whose
    // implementation is a PLAIN NATIVE is performed POSITIONALLY
    // (`mediateNativeAct` → `{args: [accountIdString, …]}`), so `fields` is
    // empty, the `FieldAxis` finds no entry, and `au.mem.axis.field` refuses —
    // for the leaf's OWN account, for every role. A silent total outage of that
    // read path with every other assertion here green.
    //
    // ⚠ THE PREDICATE IS "AN IO HANDLER IS REGISTERED AT THIS DESCRIPTOR", not
    // "an `@ioAction` is declared" (review round 5). Measured over all 1574
    // published descriptors, the declaration predicate has FIVE false positives
    // — `dispatch:lookup` / `lookupAll` / `lookupOne` / `register` / `unregister`,
    // which declare an `@ioAction` and are still `native`, because
    // `registerFenelBodyDispatchers` short-circuits on `ownsItsNative(fn.id)`
    // BEFORE canonicalising while the declaration stays. `getIOHandler` has
    // ZERO. The weaker predicate would have passed for a state leaf that later
    // gained a ctx-native — the exact shape of the outage above.
    //
    // Neuter: assert `maybeAction` instead of `getIOHandler` and give one of the
    // four a ctx-native. RED reads: the handler is absent while the declaration
    // is not.
    for (const id of declared) {
      expect(registry.getIOHandler(id), `io handler for ${id}`).toBeDefined();
      // The declaration too, as the weaker second line — it is what the
      // canonicalisation reads, so losing it is also a way to lose the handler.
      // ⚠ `maybeAction`, not `getIOAction` directly: the raw reader can answer a
      // Fenel `Maybe`, and `expect(Nothing).toBeDefined()` passes.
      expect(maybeAction(id), `ioAction for ${id}`).toBeDefined();
    }
    // THE CONTRAST, from the family that IS positional — and read off the
    // INSTANCES rather than a hand-written 3×8 grid (review round 5), so a ninth
    // `StorageHandler` method is covered the moment it is declared. A method
    // that arrived carrying an `@ioAction` would be selected into a POSITIONAL
    // row while being performed with a params record in slot 0, and
    // `ArgValue(accountId)` would then compare a record to a uuid — `Just false`
    // for its own account, every role.
    let storageMethodsSeen = 0;
    for (const backend of ["Db", "Memory", "Bundle"]) {
      const instance = dispatchRegistry.resolve(backend, "StorageHandler", GLOBAL_ONLY) as Record<string, unknown>;
      expect(instance, backend).toBeDefined();
      for (const value of Object.values(instance)) {
        // An id string or a reference to it (modules-as-values Phase 2c).
        const descriptor = storageActIdOf(value);
        if (descriptor === undefined || !descriptor.startsWith("storage:")) continue;
        expect(maybeAction(descriptor), descriptor).toBeUndefined();
        expect(registry.getIOHandler(descriptor), descriptor).toBeUndefined();
        storageMethodsSeen += 1;
      }
    }
    expect(storageMethodsSeen).toBe(24);

    // And the partition is real: the escalation round 3 measured was a `viewer`
    // of A answering `Just true` for all four arguing account B.
    //
    // Neuter: drop `accountArguedStateDescriptors` from `authorityFencedDescriptors`.
    // RED reads: `Just true` for account B, because the general row takes them back.
    const all = registry.listPerformDescriptors();
    for (const role of ["viewer", "member", "owner"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, A, all, []],
      );
      const permits = (descriptor: string, fields: Record<string, unknown>) =>
        registry.evaluateAuthorityFunction("authority:permits", [
          envelope, {
            $tag: "Act", descriptor, args: [fields],
            fields: Object.entries(fields).map(([name, value]) => ({ $tag: "ActField", name, value })),
          },
        ]);
      for (const id of declared) {
        expect(permits(id, { accountId: A }), `${role} ${id} own`)
          .toEqual({ $tag: "Just", _0: true });
        expect(permits(id, { accountId: B }), `${role} ${id} other`)
          .toEqual({ $tag: "Just", _0: false });
        // An act that argues NO account is refused too — an absent `ArgRecord`
        // entry is `Just false`, which is the axis doing its job. These leaves
        // tolerate a missing `accountId` at the handler (they answer empty), so
        // before the axis the silent call was an ordinary permitted act.
        expect(permits(id, {}), `${role} ${id} silent`)
          .toEqual({ $tag: "Just", _0: false });
      }
      // ⚠ THE DECLARED RESIDUE IS THREE ACTS, NOT ONE (review round 4). Each
      // argues an account by SLUG, which an axis over account UUIDs cannot
      // express — the mint holds the uuid and nothing else — so all three stay
      // in the general row, reachable by any role for any account. Measured
      // under a `viewer` of A against a foreign slug: all three `Just true`.
      //
      // The argued shape below is the PRODUCTION one (`accountSlug` / `slug`),
      // not a uuid the callers never pass. ⚠ AND IT IS `Just true` ON PURPOSE:
      // when a later phase closes this gap the assertion goes RED, which is the
      // only mechanism that forces the declaration to be updated with it.
      //
      // ⚠ AND THAT MECHANISM HAS NOW FIRED ONCE — rights R4a C1a closed the gap
      // for `state:findAccountBySlug` and ONLY for it. It returns the whole
      // `accounts` row including the free-form `config`, so it joined
      // `authority:discoveryDescriptors`: fenced out of every role's general row
      // and reachable only under the acquisition realm an ingress door holds.
      // The other two return data already served anonymously — a published page,
      // a public redirect target — so they stay in the general row AND are also
      // acquisition members. The list is therefore SPLIT, and each half carries
      // its own expectation rather than one weakened assertion covering both.
      const residueStillOpen: Array<[string, Record<string, unknown>]> = [
        ["state:findProxyLinkByAccountSlugAndTag", { accountSlug: "other-slug", tag: "t" }],
        ["state:getPageBySlug", { accountSlug: "other-slug", pageSlug: "p" }],
      ];
      for (const [id, args] of residueStillOpen) {
        expect(permits(id, args), `${role} ${id}`).toEqual({ $tag: "Just", _0: true });
      }
      // Neuter: drop `discoveryDescriptors` from `authorityFencedDescriptors`.
      // RED reads: `Just true` for the viewer on `state:findAccountBySlug`.
      expect(permits("state:findAccountBySlug", { slug: "other-slug" }), `${role} findAccountBySlug`)
        .not.toEqual({ $tag: "Just", _0: true });
    }
  }, LONG);

  test("the SLUG-first state leaves are an enumerated family, classified", () => {
    // ⚠ THE PREDICATE ABOVE IS BLIND TO THE SHAPE THAT GOT AWAY (review round 4).
    // It selects on `accountId` as the first parameter NAME, so an account handle
    // spelled `accountSlug` — or, in `findAccountBySlug`'s case, plain `slug` —
    // is invisible to it. That is the stale-authored-list failure the measured
    // walk exists to prevent, one spelling over: a fourth account-slug-argued
    // leaf would land in the general row with every other pin green.
    //
    // So the slug-first family is enumerated and CLASSIFIED. Three classes, and
    // only the first is a partition gap:
    //
    //  · ACCOUNT-HANDLE-ARGUED (3) — the caller-supplied handle selects the
    //    account. Unpartitionable today and declared above.
    //  · AMBIENT-SCOPED (7) — the account appears in the SQL PREDICATE, so the
    //    FRAME decides it and there is nothing to argue.
    //  · GLOBAL BY SLUG (1) — no account predicate at all.
    //  · NOT AN ACCOUNT HANDLE AT A LATER POSITION (3) — surfaced when round 6
    //    widened the walk past `params[0]`. The slug names an inventory or an
    //    item, and the account is an earlier argument.
    //    (7 and 1, not 6 and 2: `state:deleteSubscription` moved into the ambient
    //    group when round 5 scoped it, and round 6 caught the arithmetic.)
    //
    // ⚠ THE AMBIENT CRITERION IS "THE ACCOUNT IS IN THE SQL PREDICATE", NOT "the
    // handler reads `ctx.accountId`" (review round 5). The weaker criterion had
    // a live counterexample inside this very family: `state:upsertSubscription`
    // passed `accountId: ctx.accountId` and its db helper then resolved the row
    // by GLOBALLY-unique slug and updated by id, writing across accounts. Both
    // `findItemBySlug` and `findPlanBySlug` were re-checked to the predicate
    // (`and(eq(entityInstances.accountId, accountId), …)`) and hold.
    //
    // ⚠ AND FOUR WERE MISLABELED. An earlier spelling put
    // `callHookFunctionString` / `callHookFunctionRecord` /
    // `listSavedQueriesByCategory` / `upsertSubscription` under "not an account
    // handle" when all four are ambient-scoped, and left
    // `state:deleteSubscription` there too — a global unscoped DELETE, which is
    // not a classification but a bug. Both subscription leaves are now
    // account-scoped in `@fenel/db` (review round 5); the two remaining GLOBAL
    // entries are reads whose account concept does not exist.
    //
    // Neuter: add a `@native @requires "HasStateIO"` leaf to the `state` module
    // taking `(accountSlug: String)`. RED reads: the measured family carries a
    // name the classification does not.
    const registry = loadRegistry();
    const measured: string[] = [];
    for (const module of (registry as unknown as { modules: readonly {
      name: string;
      functions?: readonly { id: string; body?: unknown; params?: readonly unknown[];
        requires?: readonly { class?: { entityId?: string } }[] }[];
    }[] }).modules) {
      if (module.name === "storage") continue;
      for (const fn of module.functions ?? []) {
        if (fn.body !== undefined && fn.body !== null) continue;
        if (!(fn.requires ?? []).some((c) => c.class?.entityId === "HasStateIO")) continue;
        // ⚠ ANY POSITION, not just the first (review round 6). The earlier
        // spelling read `params[0]`, so `(widgetId, slug)` — where `slug` is the
        // ACCOUNT slug — was invisible to this walk AND to the any-position walk
        // below, which matches `^account(Id|Slug)$` and not a bare `slug`. No
        // live leaf has that shape; the gap was in the guard.
        const names = (fn.params ?? []).map((param) =>
          typeof param === "string" ? param : (param as { name?: string }).name);
        const name = names.find((candidate) =>
          typeof candidate === "string" && /slug/i.test(candidate));
        if (typeof name === "string") measured.push(`${fn.id}|${name}`);
      }
    }
    expect(measured.sort()).toEqual([
      // ACCOUNT-HANDLE-ARGUED — the declared residue.
      "state:findAccountBySlug|slug",
      "state:findProxyLinkByAccountSlugAndTag|accountSlug",
      "state:getPageBySlug|accountSlug",
      // AMBIENT-SCOPED — the account is in the SQL predicate.
      "state:callHookFunctionRecord|fnSlug",
      "state:callHookFunctionString|fnSlug",
      "state:deleteSubscription|slug",
      "state:findItemBySlug|slug",
      "state:findPlanBySlug|slug",
      "state:listSavedQueriesByCategory|categorySlug",
      "state:upsertSubscription|slug",
      // GLOBAL BY SLUG — a read with no account concept. R3's.
      "state:findSubscriptionBySlug|slug",
      // NOT AN ACCOUNT HANDLE, at a LATER position — surfaced only when round 6
      // widened this walk past `params[0]`. All three take the account itself as
      // an earlier argument (the first two are in `accountArguedStateDescriptors`
      // and partitioned on it); the slug here names an inventory or an item.
      "state:checkProfileAccess|itemSlug",
      "state:findInventoryBySlug|slug",
      "state:getInventoryStatus|slug",
    ].sort());
  }, LONG);

  test("the state partition is judged at the REAL gate, on the entry the handler reads", async () => {
    // ⚠ THE ENTITLEMENT CHECK, not a second copy of the policy check. The two
    // pins above ask the CHECKER; this one drives the act through `perform` on
    // the production table, because a policy that names the right field while
    // the act carries a different shape is `au.policy.partition`'s exact failure
    // mode — the judged entry must be the entry the handler reads.
    //
    // These leaves carry an `@ioAction`, so the params RECORD is argument slot 0
    // and the fields are its own-data projection. If that were wrong the axis
    // would refuse the OWN account too, which is what the positive half catches.
    //
    // Neuter: drop `accountArguedStateDescriptors` from
    // `authorityFencedDescriptors`. RED reads: the cross-account call RESOLVES,
    // and `queried` records account B.
    // ⚠ THROUGH A BODY, because the leaf is bodiless. `inventory:getInventoryStatusAction`
    // is one hop: it calls `getInventoryStatus accountId slug` and nothing else,
    // so a refusal can only have come from the leaf's own gate consult.
    const registry = loadRegistry();
    const queried: string[] = [];
    const spy = spyOn(dbModule, "getInventoryStatus").mockImplementation((async (accountId: string) => {
      queried.push(accountId);
      return undefined;
    }) as never);
    try {
      const call = (role: string, accountId: string) => runUnpersistedCallForTest(
        "inventory:getInventoryStatusAction",
        { accountId, inventorySlug: "probe-slug" },
        {
          accountId: A, profileId: "", persistence: "ephemeral" as const,
          authority: roleAuthority(role, A),
        },
        registry,
      );
      // THE POSITIVE: the own account reaches the leaf, for every role.
      for (const role of ["viewer", "member", "owner"]) {
        await call(role, A);
      }
      expect(queried).toEqual([A, A, A]);
      // THE NEGATIVE: another account is refused AT THE GATE, before the query.
      queried.length = 0;
      for (const role of ["viewer", "member", "owner"]) {
        await expect(call(role, B)).rejects
          .toThrow(/authority refused "state:getInventoryStatus"/);
      }
      expect(queried).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  }, LONG);

  test("the authoring surface reserves exactly what the installer reserves", () => {
    // ⚠ THE MIRROR'S PIN. `reservedSourceModuleNamespaces()` is built by the
    // ENGINE from the execute profile and cannot see that the RUNTIME prepends
    // `representationBridgeModule`, so it carries a one-name mirror. This is
    // what makes the mirror safe: any module the runtime prepends in future,
    // or any name that leaves the profile, is RED here rather than a name the
    // authoring page offers and the installer then refuses.
    //
    // Neuter: drop `RUNTIME_PREPENDED_MODULE_NAMES` from `reservedModuleNames`.
    // RED reads: the live set carries `representation-bridge` and the authoring
    // set does not — 49 versus 48.
    const authoring = [...reservedSourceModuleNamespaces()].sort();
    const installer = [...loadRegistry().listReservedNamespaces()].sort();
    expect(authoring).toEqual(installer);
    expect(installer).toContain("representation-bridge");
    // The names this phase widened the reservation to cover, still covered.
    for (const name of ["authority", "subject", "kernel", "set", "storage"]) {
      expect(installer, name).toContain(name);
    }
  }, LONG);

  test("every account-handle-shaped leaf is accounted for, at ANY argument position", () => {
    // ⚠ BOTH EARLIER WALKS READ `params[0]` ONLY (review round 5). One selected
    // on the first parameter being named `accountId`, the other on the first
    // parameter matching `/slug/i` — so an account handle at position 1, or at
    // any later position, was invisible to both. Five live leaves are exactly
    // that shape (`accountId` at index 1) and all five happen to be fenced by
    // the session and membership rows, so there is no hole today; the guard is
    // what was missing.
    //
    // This is the completeness pin: every bodiless `HasStateIO` leaf outside
    // `storage` carrying an account-handle-shaped parameter ANYWHERE must be
    // accounted for by a named class. A new one forces a decision instead of
    // landing in the general row with every other pin green.
    //
    // ⚠ IT IS NOT TOTAL, and the residue is named rather than implied: a handle
    // spelled something else entirely (`state:findAccountBySlug` takes plain
    // `slug`) is covered by the slug-family pin above, and a leaf with NO account
    // handle at all cannot be judged on one. Between them the two pins cover the
    // spellings that exist; neither can see a spelling nobody has used yet.
    //
    // Neuter: drop `state:createSession` from the SESSION-FENCED list below.
    // RED reads: the measured family carries a name no class claims.
    const registry = loadRegistry();
    const measured: string[] = [];
    for (const module of (registry as unknown as { modules: readonly {
      name: string;
      functions?: readonly { id: string; body?: unknown; params?: readonly unknown[];
        requires?: readonly { class?: { entityId?: string } }[] }[];
    }[] }).modules) {
      if (module.name === "storage") continue;
      for (const fn of module.functions ?? []) {
        if (fn.body !== undefined && fn.body !== null) continue;
        if (!(fn.requires ?? []).some((c) => c.class?.entityId === "HasStateIO")) continue;
        const names = (fn.params ?? []).map((param) =>
          typeof param === "string" ? param : (param as { name?: string }).name);
        if (names.some((name) => typeof name === "string" && /^account(Id|Slug)$/.test(name))) {
          measured.push(fn.id);
        }
      }
    }
    const read = (id: string) => registry.evaluateAuthorityFunction(id, [0]) as string[];
    const classes = {
      partitioned: read("authority:accountArguedStateDescriptors"),
      membershipRead: read("authority:membershipReadDescriptors"),
      membershipWrite: read("authority:membershipLeafDescriptors"),
      sessionFenced: read("authority:sessionLeafDescriptors"),
      declaredResidue: ["state:findProxyLinkByAccountSlugAndTag", "state:getPageBySlug"],
    };
    const claimed = new Set(Object.values(classes).flat());
    expect(measured.filter((id) => !claimed.has(id)).sort()).toEqual([]);
    // And the classes are DISJOINT — a leaf in two of them would take the union
    // of their restrictions, which is how a row split silently widens (the same
    // property `authorityMembershipWriteRows` is pinned for).
    const counted = Object.values(classes).flat().filter((id) => measured.includes(id));
    expect(counted.length).toBe(new Set(counted).size);
    expect(measured.length).toBeGreaterThanOrEqual(12);
  }, LONG);

  test("the viewer restriction's SCOPE is the storage seam — measured, not asserted", () => {
    // ⚠ THE BOUNDARY THIS PHASE ACTUALLY SHIPS, as a measurement rather than a
    // sentence (review round 5). The `viewer` envelope withholds the storage
    // WRITE methods, so a viewer is refused at the `storage:` seam — and that is
    // a restriction on exactly the state leaves whose handler ROUTES through
    // `performStorageMethod`. Every other state leaf opens `@fenel/db` directly
    // and carries no role restriction at all: measured, `state:updateAccount`,
    // `state:deletePage` and `state:deleteFunctionById` are `Just true` for a
    // `viewer` on the production envelope.
    //
    // The note said "a viewer restricts PERSISTENCE and membership, and nothing
    // else". `authority.fenel` said it correctly — "PERSISTENCE - the storage
    // write methods -" — and the note dropped the scoping clause. This pin makes
    // the scope a drift-gated fact so the sentence cannot widen again.
    //
    // ⚠ WHAT IT IS NOT: a fence. Closing the gap needs a read/write
    // classification of the state leaves, and nothing in the registry carries one
    // (measured: of the 153 bodiless `HasStateIO` natives outside `storage`, 152
    // declare that single effect class and ONE — `dispatch:refreshAccountInstances`
    // — adds `HasRegistry`, which is not a read/write axis either; and `returns`
    // does not separate them).
    // Authoring that list here would be this phase's own defect shape one level
    // up — a claim true of the enumerated cases, generalised. It is R9's, and it
    // needs the role vocabulary Rom owns first (note §11 item 1).
    //
    // ⚠ IT COUNTS THE DIRECT CALL AND NOTHING ELSE (review round 6). Two further
    // handlers — `state.schema_of` and `state.validate_entity_instance` — reach
    // `performStorageMethod` INDIRECTLY, through the module-level helper
    // `findEntityTypeByName`, and a textual scan of their own block cannot see
    // it. Both reach it for `loadTypeByName`, a READ every role holds, so the
    // conclusion is unaffected; the number below is "routes through it
    // DIRECTLY", not "touches the seam". A refactor that moved a WRITE behind a
    // shared helper of that shape would be invisible here — a known limit of the
    // instrument, not of the claim it supports.
    //
    // Neuter: route one handler off `performStorageMethod` onto a direct
    // `@fenel/db` read. RED reads: the seam set is short by that name.
    const source = readFileSync(
      new URL("./handlers/state.ts", import.meta.url), "utf8",
    );
    const blocks = handlerBodies(source);
    const seam: string[] = [];
    let directDb = 0;
    let neither = 0;
    for (const [name, body] of blocks) {
      const viaSeam = body.includes("performStorageMethod");
      const viaDb = body.includes("@fenel/db") || body.includes("getDb()");
      if (viaSeam) seam.push(name);
      else if (viaDb) directDb += 1;
      else neither += 1;
    }
    expect(seam.sort()).toEqual([
      "state.append_event",
      "state.create_instance",
      "state.delete_instance",
      "state.get_instance",
      "state.get_instance_by_id",
      "state.get_type",
      "state.get_type_by_id",
      "state.list_instances",
      "state.list_instances_by_name",
      "state.load_type",
      "state.try_create_instance",
      "state.try_create_instance_by_name",
      "state.update_instance",
    ]);
    // THE WHOLE SPLIT, so the ratio is in the record and not in a sentence — and
    // so a handler moving between classes is RED rather than a prose edit.
    // ⚠ NOT A CONSTANT — a SNAPSHOT, and it moves whenever a state handler is
    // added. It read 147 at rights R2b; it reads 149 after the locus lane added
    // `state.read_locus_root` and `state.edit_locus_root`. rights R4a added NO
    // handler (its additions to this file are two non-handler helpers,
    // `findAccountBotRowStateLeaf` and `maybeArgument`), so this number is not
    // R4a's to own — but leaving it stale would make the ratio below a lie.
    // It reads 150 since account selection added `state.list_user_memberships`
    // (2026-09-23), an identity leaf that opens the database directly.
    expect(blocks.size).toBe(150);
    // Same snapshot, same owner: the two new locus handlers both open the
    // database directly, so the direct-db count moves with the handler count.
    expect(directDb).toBe(125);
    expect(neither).toBe(12);
    expect(seam.length + directDb + neither).toBe(blocks.size);

    // And the consequence, measured on the PRODUCTION envelope rather than a
    // test-local one: three direct-DB writes a `viewer` is permitted.
    const registry = loadRegistry();
    const viewer = authenticateAuthority(roleAuthority("viewer", A))!;
    for (const descriptor of ["state:updateAccount", "state:deletePage", "state:deleteFunctionById"]) {
      expect(registry.evaluateAuthorityFunction("authority:permits", [
        viewer.envelope, { $tag: "Act", descriptor, args: [], fields: [] },
      ]), descriptor).toEqual({ $tag: "Just", _0: true });
    }
    // THE CONTRAST: the seam itself does restrict the viewer.
    expect(registry.evaluateAuthorityFunction("authority:permits", [
      viewer.envelope,
      { $tag: "Act", descriptor: "storage:dbStore", args: [A, "T", {}, "id"], fields: [] },
    ])).toEqual({ $tag: "Just", _0: false });
  }, LONG);

  test("every act that argues NO account handle is scoped by the FRAME, in its handler", () => {
    // ⚠ THE CLASS THE GATE CANNOT REACH, guarded where it can be. An act that
    // argues no account handle cannot be judged on one — no axis applies, so it
    // sits in every role's general row and `permits` answers `Just true` for
    // every role and every account. That is correct of the JUDGMENT and says
    // nothing about the ACT: if its handler then resolves a row by a global
    // identifier, the frame's account never enters the query and the act crosses
    // the partition the phase exists to enforce.
    //
    // Seven were found that way. Two in round 5 (`state:deleteSubscription`
    // deleted by a globally-unique slug; `state:upsertSubscription` resolved by
    // one and updated by id), five in round 6 — measured as `Just true` for a
    // `viewer` of A naming an object in B:
    //
    //   · state:cancelAllConversations    matched `data->>'botId'` alone
    //   · state:listTracesByInstance      matched `instance_id` alone, and trace
    //                                     rows carry every step's input/output
    //   · state:addQueryToCategory        `query_category_members` has no account
    //   · state:removeQueryFromCategory   column at all
    //   · state:createQueryCategoryMembers
    //
    // Each is now scoped by `ctx.accountId` — a predicate where the table carries
    // the column, an ownership pre-check where it does not. THE FENEL SIGNATURES
    // ARE UNCHANGED: the account comes from the frame, never from an argument,
    // which is the whole point — an act that could argue its account would be
    // judged on it instead.
    //
    // ⚠ IT SCANS BOTH ENDS, because either alone is too weak (review round 7).
    // The handler passing `ctx.accountId` proves nothing if the query it calls
    // ignores the argument — a reviewer removed `AND account_id = ${accountId}`
    // from `cancelInFlightConversationsByBot`, left the handler untouched, and a
    // handler-only pin stayed GREEN while the emitted SQL matched on the bot id
    // alone. So: every frame-scoped HANDLER must reference `ctx.accountId`, and
    // every account-scoped QUERY must reference its `accountId` parameter inside
    // its own body.
    //
    // ⚠ Still a source scan, and that is its honest limit: it observes that the
    // name appears, not that the predicate is semantically right. What it does
    // close is the mutation that was demonstrated.
    //
    // Neuter: drop `ctx.accountId` from `state.cancel_all_conversations`'s call.
    // RED reads: that handler is missing from the scoped set.
    // Second neuter: drop `AND account_id = ${accountId}` from
    // `cancelInFlightConversationsByBot`. RED reads: that query does not scope.
    const source = readFileSync(
      new URL("./handlers/state.ts", import.meta.url), "utf8",
    );
    const blocks = handlerBodies(source);
    const frameScoped = [
      "state.list_query_category_members",
      "state.cancel_all_conversations",
      "state.list_traces_by_instance",
      "state.add_query_to_category",
      "state.remove_query_from_category",
      "state.create_query_category_members",
      "state.delete_subscription",
      "state.upsert_subscription",
    ];
    for (const name of frameScoped) {
      const body = blocks.get(name);
      expect(body, name).toBeDefined();
      expect(body!.includes("ctx.accountId"), `${name} must scope by the frame`).toBe(true);
    }

    // THE QUERY END. Each of these carries the account into `@fenel/db`, and the
    // function there must USE it. `addQueryToCategory` and friends do their own
    // work in the handler, so they are covered above and are not here.
    const queries: Array<[string, string]> = [
      ["entity-instances.ts", "cancelInFlightConversationsByBot"],
      ["traces.ts", "getTracesByInstance"],
      ["subscriptions.ts", "deleteSubscription"],
      ["subscriptions.ts", "upsertSubscription"],
    ];
    for (const [file, fnName] of queries) {
      const querySource = readFileSync(
        new URL(`../../db/src/queries/${file}`, import.meta.url), "utf8",
      );
      const at = querySource.indexOf(`export async function ${fnName}(`);
      expect(at, `${file}:${fnName}`).toBeGreaterThan(-1);
      const open = querySource.indexOf("{", querySource.indexOf(")", at));
      let depth = 0;
      let cursor = open;
      for (; cursor < querySource.length; cursor += 1) {
        if (querySource[cursor] === "{") depth += 1;
        else if (querySource[cursor] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = querySource.slice(open, cursor + 1);
      expect(
        body.includes("accountId"),
        `${file}:${fnName} must use its account argument`,
      ).toBe(true);
    }
    // And the judgment really does permit them — stated as an assertion so the
    // reason the handler carries the scoping is not lost. If a later phase gives
    // one of these an account argument, THIS goes red and the act should move
    // into `accountArguedStateDescriptors` instead.
    const registry = loadRegistry();
    const all = registry.listPerformDescriptors();
    const envelope = registry.evaluateAuthorityFunction(
      "authority:roleEnvelope", ["viewer", A, all, []],
    );
    for (const descriptor of [
      "state:cancelAllConversations", "state:listTracesByInstance",
      "state:addQueryToCategory", "state:removeQueryFromCategory",
      "state:createQueryCategoryMembers", "state:deleteSubscription",
      "state:upsertSubscription",
    ]) {
      expect(registry.evaluateAuthorityFunction("authority:permits", [
        envelope, { $tag: "Act", descriptor, args: [], fields: [] },
      ]), descriptor).toEqual({ $tag: "Just", _0: true });
    }
  }, LONG);

  test("the GLOBAL-BY-DESIGN reads are enumerated, and they are the ones that hand out secrets", () => {
    // ⚠ A RESIDUE CLASS THAT EXISTED IN NO LIST (review round 9). The phase
    // declares one member of it — "GLOBAL BY SLUG — a read with no account
    // concept. R3's." — and that declaration was reached through the slug walk,
    // so it enumerates only the leaves whose parameter matches `/slug/i`. Two
    // more are the same shape with id-shaped parameters and were in no class at
    // all:
    //
    //   · state:findIntegrationByIdAndType  (id, type)  → the row's `credentials`
    //   · state:findBotByIdGlobal           (botId)     → the flattened Bot row,
    //                                                     including its `token`
    //
    // ⚠ AMENDED BY rights R4a C1a — THE CLASSIFICATION R2b OWED IS NOW A FENCE.
    // R2b recorded these three as "global by design and they must stay that way",
    // because ingress has no frame account to scope by and scoping them would
    // break inbound webhooks. Both halves of that were right; what R2b could not
    // yet say is that GLOBAL is not the same as UNRESTRICTED. R4a keeps them
    // unscoped AND removes them from every role's envelope: they are
    // `authority:discoveryDescriptors`, reachable only under the ACQUISITION
    // realm an ingress door holds while it finds the row it is about to verify
    // against. So the assertions below are INVERTED from R2b's — a viewer (and a
    // member, and an owner) is now REFUSED — and the third-to-last paragraph of
    // R2b's own note, "the credentials reach the Fenel caller verbatim; that is
    // the fact R3 needs", is what R4a acted on.
    //
    // The measurement is unchanged, deliberately: this pin remains the census
    // that no unscoped handler escapes a named class.
    //
    // The declared return type is `Maybe ({ })` and it does NOT project: the
    // credentials reach the Fenel caller verbatim. That is the fact R3 needs.
    //
    // ⚠ AND THE LIST IS TIED TO A MEASUREMENT, because an authored list with no
    // measurement behind it is not a guard — the first version of this pin only
    // iterated its own names, so deleting one made it check less and stay GREEN.
    // The measurement is the COMPLEMENT of the frame-scoped set: every
    // `state.*` handler that reaches the database, reads `params[…]`, and never
    // mentions `ctx.accountId`. There are 23, and every one must be claimed by a
    // named class. A new unscoped handler of any shape is RED.
    //
    // Neuter: drop `state:findBotByIdGlobal` from GLOBAL_BY_DESIGN below. RED
    // reads: a measured handler that no class claims.
    const registry = loadRegistry();
    const source = readFileSync(
      new URL("./handlers/state.ts", import.meta.url), "utf8",
    );
    const unscoped: string[] = [];
    for (const [name, body] of handlerBodies(source)) {
      const touchesDb = body.includes("@fenel/db") || body.includes("getDb()");
      if (!touchesDb) continue;
      if (body.includes("ctx.accountId")) continue;
      if (!body.includes("params[")) continue;
      unscoped.push(name);
    }
    // IDENTITY AND MEMBERSHIP — keyed by a secret hash, by a global user, or
    // arguing the account explicitly at position 1. All fenced by
    // `sessionLeafDescriptors` / the membership rows.
    const IDENTITY = [
      "state.create_membership", "state.create_session", "state.delete_membership",
      "state.delete_session_by_hash", "state.get_membership",
      "state.get_or_create_user_by_email", "state.get_session_by_hash",
      "state.get_user_by_email", "state.list_account_members",
      // 2026-09-23 — keyed by a global user; fenced by `sessionLeafDescriptors`
      // and kept to the privileged realm.
      "state.list_user_memberships",
      "state:ensurePersonalAccount",
      "state.set_membership_role", "state.set_user_password_hash",
      "state.touch_session",
    ];
    // ACCOUNT-ARGUED — partitioned by `accountArguedStateDescriptors`.
    const ACCOUNT_ARGUED = [
      "state.find_bot_id_for_account", "state.find_inventory_by_slug",
      "state.get_inventory_status", "state.get_profile_handles",
    ];
    // ACCOUNT-SLUG-ARGUED — the declared unpartitionable residue.
    const SLUG_ARGUED = [
      "state.find_account_by_slug", "state.find_proxy_link_by_account_slug_and_tag",
      "state.get_page_by_slug",
    ];
    // GLOBAL BY DESIGN — no account concept to scope by.
    const GLOBAL_BY_DESIGN = [
      "state.find_bot_by_id_global", "state.find_integration_by_id_and_type",
      "state.find_subscription_by_slug",
    ];
    expect(unscoped.sort()).toEqual(
      [...IDENTITY, ...ACCOUNT_ARGUED, ...SLUG_ARGUED, ...GLOBAL_BY_DESIGN].sort(),
    );

    const globalByDesign = [
      "state:findBotByIdGlobal",
      "state:findIntegrationByIdAndType",
      "state:findSubscriptionBySlug",
    ];
    const all = registry.listPerformDescriptors();
    for (const id of globalByDesign) expect(all, id).toContain(id);

    // rights R4a — REFUSED IN EVERY ROLE, and permitted under acquisition.
    // Neuter: drop `discoveryDescriptors` from `authorityFencedDescriptors`.
    // RED reads: `Just true` for the viewer on all three.
    for (const role of ["owner", "member", "viewer"]) {
      const envelope = registry.evaluateAuthorityFunction(
        "authority:roleEnvelope", [role, A, all, []],
      );
      for (const descriptor of globalByDesign) {
        expect(registry.evaluateAuthorityFunction("authority:permits", [
          envelope, { $tag: "Act", descriptor, args: [], fields: [] },
        ]), `${role} / ${descriptor}`).not.toEqual({ $tag: "Just", _0: true });
      }
      // THE POSITIVE CONTROL: an ordinary general-row act is still permitted for
      // the same role and the same envelope, so the refusals above are the fence
      // rather than a broken envelope.
      expect(registry.evaluateAuthorityFunction("authority:permits", [
        envelope, { $tag: "Act", descriptor: "state:listPages", args: [], fields: [] },
      ]), `${role} control`).toEqual({ $tag: "Just", _0: true });
    }
    // …and the acquisition envelope DOES permit them, so the fence relocated the
    // capability rather than deleting it.
    const acquisition = registry.evaluateAuthorityFunction(
      "authority:acquisitionEnvelope", ["", []],
    );
    for (const descriptor of globalByDesign) {
      expect(registry.evaluateAuthorityFunction("authority:permits", [
        acquisition, { $tag: "Act", descriptor, args: [], fields: [] },
      ]), `acquisition / ${descriptor}`).toEqual({ $tag: "Just", _0: true });
    }

    // And they really do take no account — which the classification above already
    // establishes, stated once more here so a later phase that DOES scope one has
    // to come back and move it between classes rather than silently widening the
    // frame-scoped set.
    const blocks = handlerBodies(source);
    for (const action of GLOBAL_BY_DESIGN) {
      const body = blocks.get(action);
      expect(body, action).toBeDefined();
      expect(body!.includes("ctx.accountId"), `${action} is global by design`).toBe(false);
    }
  }, LONG);

  test("the query-category ownership check REFUSES a foreign category, and writes nothing", async () => {
    // ⚠ THE ONE FRAME-SCOPED FENCE THE SOURCE SCAN CANNOT REACH (review round 8).
    // The other four live in `@fenel/db` and are covered behaviourally by
    // `db/src/account-isolation.fixture.ts`, which drives the real Drizzle
    // builders against a capture driver. `ownsQueryCategory` lives HERE, in the
    // handler file, and the round-7 scan only checked that its callers mention
    // `ctx.accountId` — deleting the account predicate from the helper itself
    // left every pin green while all three membership acts wrote to a foreign
    // category.
    //
    // So this drives the real handlers with a captured `getDb`: the ownership
    // SELECT is observed, its result is chosen, and what the handler does next is
    // measured. No database.
    //
    // Neuter: drop `eq(queryCategories.accountId, accountId)` from
    // `ownsQueryCategory`. RED reads: the foreign category is accepted and the
    // INSERT runs.
    // ⚠ A REAL DRIZZLE BUILDER OVER A CAPTURE DRIVER, not a hand-rolled chain
    // stub. The first attempt at this pin stubbed `.where()` as a no-op that
    // returned the next link regardless of its argument — so deleting the account
    // predicate from `ownsQueryCategory` changed nothing the stub could see and
    // the neuter came back GREEN. A stub that ignores the predicate cannot pin
    // the predicate. This emits the real SQL and reads it.
    const registry = loadRegistry();
    const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
    let ownershipRows: unknown[][] = [];
    const captured = drizzleProxy(async (sql: string, params: unknown[]) => {
      statements.push({ sql, params });
      return { rows: /from "query_categories"/i.test(sql) ? ownershipRows : [] };
    });
    const spy = spyOn(dbModule, "getDb").mockImplementation((() => captured) as never);
    try {
      // ⚠ A REAL FRAME, because `getIOHandler` returns the MEDIATED wrapper:
      // called with a context carrying no authority it answers
      // `authority refused "state.add_query_to_category" (absent)` — which is the
      // gate doing its job and not what this pin is about. An `owner` envelope
      // permits the act, so what is measured here is the handler's own check.
      const ctx = ioContextFor(A, roleAuthority("owner", A));
      const call = (action: string, params: Record<string, unknown>) =>
        (registry.getIOHandler(action) as (
          p: Record<string, unknown>, c: never,
        ) => Promise<{ value: unknown }>)(params, ctx);

      // THE FOREIGN CATEGORY: the ownership lookup is account-scoped, so it finds
      // nothing, and the handler writes nothing.
      for (const [action, params] of [
        ["state.add_query_to_category", { categoryId: "cat-in-B", queryId: "q" }],
        ["state.remove_query_from_category", { categoryId: "cat-in-B", queryId: "q" }],
        ["state.create_query_category_members", { categoryId: "cat-in-B", queryIds: ["q"] }],
      ] as const) {
        statements.length = 0;
        ownershipRows = [];
        const outcome = await call(action, params as Record<string, unknown>);
        expect(outcome.value, action).toBe(false);
        expect(statements.length, action).toBe(1);
        // ⚠ THE ASSERTION THAT DEFENDS THE FENCE: the lookup must filter on the
        // account, and the account must be a BOUND PARAMETER of it. Removing
        // `eq(queryCategories.accountId, accountId)` fails here.
        expect(statements[0]!.sql, action).toMatch(/from "query_categories"/i);
        expect(statements[0]!.sql, action).toMatch(/"account_id"\s*=/i);
        expect(statements[0]!.params, action).toContain(A);
        // ⚠ AND IT MUST NARROW (review round 9). A predicate that is present and
        // bound still lets `and` → `or` through: the account appears, the
        // parameter binds, and the statement matches every row with that category
        // id OR every row of the caller's own account. The capture driver does
        // not evaluate the WHERE clause, so the conjunction is asserted directly.
        expect(statements[0]!.sql, `${action} must conjoin, not disjoin`)
          .not.toMatch(/\sor\s/i);
        // ⚠ AND BOTH HALVES (review round 11). Asserting only the account leaves
        // `eq(queryCategories.id, categoryId)` guarded by nothing: without it the
        // lookup answers "does this caller own ANY category", so `ownsQueryCategory`
        // returns true for every id and all three writes land in a FOREIGN
        // category — round 6's bug restored, needing only that the attacker owns
        // one category of their own.
        expect(statements[0]!.params, `${action} must bind the category id`)
          .toContain("cat-in-B");
      }

      // THE OWN CATEGORY: the lookup finds it, and the write proceeds.
      statements.length = 0;
      ownershipRows = [["cat-in-A"]];
      const ok = await call("state.add_query_to_category", { categoryId: "cat-in-A", queryId: "q" });
      expect(ok.value).toBe(true);
      expect(statements.length).toBe(2);
      expect(statements[1]!.sql).toMatch(/^insert into "query_category_members"/i);

      // ⚠ AND THE READ, WHICH THE THREE WRITES ABOVE DO NOT COVER (review round
      // 10). `state.list_query_category_members` narrows a caller-supplied id LIST
      // to the owned ones and then reads with THAT list — and the pin for it was a
      // source scan, so changing `ownedIds` back to `ids` in the second query left
      // the whole suite at 34/0 while a `viewer` of A asking for
      // `[cat-in-A, cat-in-B]` received B's members. The MIXED input is the case
      // that matters: a foreign-only input is already caught by the empty-result
      // early return, so a pin that only tests foreign-only proves nothing about
      // the narrowing.
      //
      // Neuter: in the handler, read with `ids` instead of `ownedIds`. RED reads:
      // the members SELECT binds the foreign category id.
      statements.length = 0;
      ownershipRows = [["cat-in-A"]]; // of the two asked for, only A is owned
      const mixed = await call("state.list_query_category_members", {
        categoryIds: ["cat-in-A", "cat-in-B"],
      });
      expect(statements.length).toBe(2);
      expect(statements[0]!.sql).toMatch(/from "query_categories"/i);
      expect(statements[0]!.params).toContain(A);
      // ⚠ THE SAME TWO RULES ON THE LOOKUP THIS BLOCK ADDS (review round 11).
      // `and` -> `or` here returns every category in the caller's list OR every
      // category of their account, so `cat-in-B` reaches `ownedIds` and the read
      // hands over B's members; dropping `inArray(queryCategories.id, ids)`
      // returns every category of the caller's own account, so the read answers
      // with members of categories nobody asked for. Both survive the narrowing
      // assertion below, because that one only checks what the SECOND query binds.
      expect(statements[0]!.sql, "the ownership lookup must conjoin")
        .not.toMatch(/\sor\s/i);
      expect(statements[0]!.params, "the lookup binds both asked-for ids and the account")
        .toEqual(["cat-in-A", "cat-in-B", A]);
      expect(statements[1]!.sql).toMatch(/from "query_category_members"/i);
      expect(statements[1]!.params, "the read must bind ONLY the owned id")
        .toEqual(["cat-in-A"]);
      // ⚠ VACUOUS AND KEPT AS DOCUMENTATION, not as a fence (review round 11):
      // the capture driver answers `{rows: []}` for anything that is not the
      // ownership lookup, so this decodes to `[]` whatever the read bound. The
      // load-bearing assertion is the `toEqual(["cat-in-A"])` two lines up.
      expect(mixed.value).toEqual([]);

      // THE FOREIGN-ONLY INPUT: nothing is owned, so the read is never issued.
      statements.length = 0;
      ownershipRows = [];
      const foreign = await call("state.list_query_category_members", {
        categoryIds: ["cat-in-B"],
      });
      expect(foreign.value).toEqual([]);
      expect(statements.length, "the members SELECT must never be issued").toBe(1);
    } finally {
      spy.mockRestore();
    }
  }, LONG);

  test("the identity realm grants an ENUMERATED chain, and nothing else in the auth module", () => {
    // ⚠ THE CROSS-FILE GUARD. The `auth` module is a union over several files, so
    // a pin that reads `membership.fenel` cannot see a fifth orchestrator added
    // in a NEW file carrying `module auth where` — it would be selected by the
    // prefix rule and land in a realm envelope that has NO axes at all.
    //
    // This enumerates what the LIVE realm actually grants. Any new `auth:`
    // descriptor, in any file, makes it RED until someone decides whether it is
    // on the authentication chain.
    //
    // Neuter: narrow `membershipModuleDescriptors` back to the four
    // `@ioAction`-bearing doors. RED reads: five extra names, led by
    // `auth:authChangeMemberRoleNow` — the orchestrator minus its last-owner guard.
    const registry = loadRegistry();
    const all = registry.listPerformDescriptors();
    const realm = registry.evaluateAuthorityFunction("authority:identityRealmEnvelope", [all]);
    const granted = all.filter((d) => d.startsWith("auth:")
      && JSON.stringify(registry.evaluateAuthorityFunction("authority:permits", [
        realm, { $tag: "Act", descriptor: d, args: [], fields: [] },
      ])) === JSON.stringify({ $tag: "Just", _0: true })).sort();
    // 2026-09-23 — DECIDED ON THE CHAIN: accounts.fenel's eight functions
    // (`auth:listAccounts`, `auth:switchAccount` and their helpers). Both doors
    // take the request's own session token, never a user id, and run through
    // `core/src/auth.ts` like login.
    expect(granted).toEqual([
      "auth:addCookiePart", "auth:authAccountChoice", "auth:authSecondsLeft",
      "auth:authSecondsUntil", "auth:authSwitchFromSession", "auth:authSwitchIfMember",
      "auth:authSwitchIssue", "auth:bootstrapAdmin", "auth:checkAndIssue",
      "auth:clearSessionCookieHeader", "auth:createMembershipForRole",
      "auth:createMembershipWithRole", "auth:createNewUser", "auth:devLogin",
      "auth:ensureMembership", "auth:ensureUser", "auth:insertCookie",
      "auth:issueAndWrap", "auth:issueSession", "auth:listAccounts", "auth:loginWithPassword",
      "auth:parseCookieHeader", "auth:resolveFromRow", "auth:resolveToken",
      "auth:revokeToken", "auth:sessionCookieHeader", "auth:setHashJust",
      "auth:setPassword", "auth:switchAccount", "auth:verifyAndIssue", "auth:withCookieKey",
      "auth:withCookieTail",
    ]);
    // The member-management surface is OUT, all nine of it.
    const excluded = registry.evaluateAuthorityFunction(
      "authority:membershipModuleDescriptors", [0],
    ) as string[];
    for (const id of excluded) expect(granted.includes(id), id).toBe(false);
    // And the two acts that would make the private helpers dangerous are not in
    // the realm either — the second fence, stated so a change to EITHER is RED.
    for (const id of ["state:setMembershipRole", "state:deleteMembership"]) {
      expect(registry.evaluateAuthorityFunction("authority:permits", [
        realm, { $tag: "Act", descriptor: id, args: [], fields: [] },
      ]), id).toEqual({ $tag: "Just", _0: false });
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// GP-21 stopgap (rights) — the file-system acts do not exist in the API process.
//
// `fs.read_file` took any host path and sat in every member's general row (the
// R4a design review, item 8): any signed-in member could read `.env`. The four
// `fs.*` handlers have no Fenel declaration, so the Fenel policy cannot fence
// them by name yet. The stopgap removes them from the perform table instead:
// `buildExecutionRegistry` no longer calls `registerFilesystemHandlers`, so no
// envelope can reach them, because there is nothing to reach. The handler
// module and its own-registry unit test (`handlers/filesystem.test.ts`) stay
// for the fence, which re-admits them as declared, fenced colon ids.
//
// Neuter: put `registerFilesystemHandlers(reg)` back in
// `buildExecutionRegistry`. RED reads: all three pins below (observed before
// the stopgap: the four acts published and implementation-bearing, the member
// envelope answering `Just true`, and the door call resolving `Ok` bytes).
//
// ⚠ This block proves only that the fs.* acts are gone. It does NOT prove that
// no account can read host files: Telegram's `InputFile.ByPath` was a second
// read of a caller-named host path. That one is refused at the Telegram leaf;
// see the next block. A per-account file root (R5/R8) remains open.
// ---------------------------------------------------------------------------

describe("GP-21 stopgap — the fs.* acts do not exist in any account's runtime", () => {
  const FS_ACTS = ["fs.file_exists", "fs.list_dir", "fs.read_file", "fs.write_file"];
  const JUST_TRUE = { $tag: "Just", _0: true };

  test("the four fs.* acts are neither published nor implementation-bearing", () => {
    resetRegistryCache();
    const registry = loadRegistry();
    const published = new Set(registry.listPerformDescriptors());
    const present = FS_ACTS.filter((act) => published.has(act) || registry.getIOHandler(act) !== undefined);
    expect(present).toEqual([]);
    // CONTROL: the same registry still carries a sibling handler-only family,
    // so "absent" is not "the registry published nothing".
    expect(published.has("dispatch.lookup")).toBe(true);
    expect(registry.getIOHandler("dispatch.lookup")).toBeDefined();
  }, LONG);

  test("a member's real envelope does not admit them; state:listPages is the control", () => {
    const registry = loadRegistry();
    const record = authenticateAuthority(roleAuthority("member", A))!;
    const permits = (descriptor: string, args: unknown[]) =>
      registry.evaluateAuthorityFunction("authority:permits", [
        record.envelope, { $tag: "Act", descriptor, args, fields: [] },
      ]);
    for (const act of FS_ACTS) {
      expect(permits(act, [{ path: ".env" }]), act).not.toEqual(JUST_TRUE);
      expect(permits(act, []), act).not.toEqual(JUST_TRUE);
    }
    expect(permits("state:listPages", [])).toEqual(JUST_TRUE);
  }, LONG);

  test("a member-authority door call to fs.read_file {path: \".env\"} fails and returns no bytes", async () => {
    // The `/io/invoke` door is `invokeIOActionAs`. It reads the account's
    // installed source modules first; this process has no database, so that
    // one read answers "none" and the call runs on the base registry, which is
    // what an account without source modules gets in production.
    const imports = spyOn(dbModule, "listAccountImports").mockImplementation((async () => []) as never);
    try {
      // ⚠ The outcome is reduced to a shape BEFORE it is asserted, so a RED run
      // reports a tag and a byte count, never the file's contents.
      const outcome = await invokeIOActionAs(
        roleAuthority("member", A), null, "fs.read_file", { path: ".env" },
      ).then(
        (value) => {
          const v = value as { $tag?: unknown; _0?: { byteLength?: unknown } } | null;
          return { resolved: true, tag: v?.$tag, byteLength: v?._0?.byteLength };
        },
        (error: unknown) => ({ resolved: false, message: (error as Error).message }),
      );
      expect(outcome).toEqual({
        resolved: false, message: "No IO handler registered for action: fs.read_file",
      });
    } finally {
      imports.mockRestore();
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// GP-21 (rights) — Telegram's `InputFile.ByPath` does not read host files.
//
// Every Telegram* capability method is a registered IO handler, and no Telegram
// family is in `authorityFencedDescriptors`, so all of them sit in every role's
// general row. `callTelegram` used to turn a `ByPath path` into
// `Bun.file(path)` plus a multipart upload, so a member with a bot could call
// `TelegramMedia.sendDocument {document: ByPath ".env"}` and receive the host
// `.env` in their own chat. The leaf (`handlers/telegram-client.ts`,
// `refuseHostPathUploads`) now refuses any `ByPath` before any file read or
// network call.
//
// Neuter: delete the `refuseHostPathUploads(method, paramsCamel)` call in
// `callTelegram`. RED reads: the ByPath pin (the call reaches `Bun.file` and
// `fetch`). The ByFileId control stays green either way: it proves the member
// reaches the leaf, so the refusal is the leaf's, not the gate's.
// ---------------------------------------------------------------------------

describe("GP-21 — a Telegram ByPath upload cannot read a host file", () => {
  const BOT = { id: "bot-a", accountId: A, token: "1:test-token", enabled: true, username: "a_bot" };

  async function sendDocumentAsMember(document: unknown) {
    const imports = spyOn(dbModule, "listAccountImports").mockImplementation((async () => []) as never);
    const findBot = spyOn(dbModule, "findBotById").mockImplementation((async () => BOT) as never);
    const fileRead = spyOn(Bun, "file");
    const network = spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(JSON.stringify({ ok: true, result: { messageId: 1 } }), {
        headers: { "Content-Type": "application/json" },
      })) as never);
    try {
      const outcome = await invokeIOActionAs(
        roleAuthority("member", A), null, "TelegramMedia.sendDocument",
        { botId: BOT.id, chatId: 42, document },
      ).then(
        () => ({ resolved: true }),
        (error: unknown) => ({ resolved: false, message: (error as Error).message }),
      );
      return {
        outcome,
        botLookups: findBot.mock.calls.length,
        fileReads: fileRead.mock.calls.length,
        networkCalls: network.mock.calls.length,
      };
    } finally {
      network.mockRestore();
      fileRead.mockRestore();
      findBot.mockRestore();
      imports.mockRestore();
    }
  }

  test("a member's sendDocument with ByPath \".env\" is refused before any file read or network call", async () => {
    const run = await sendDocumentAsMember({ $tag: "ByPath", path: ".env" });
    expect(run).toEqual({
      outcome: {
        resolved: false,
        message: "Telegram sendDocument: InputFile ByPath is refused (it would read a host file); send ByUrl or ByFileId",
      },
      botLookups: 1,
      fileReads: 0,
      networkCalls: 0,
    });
  }, LONG);

  test("CONTROL: the same member's sendDocument with ByFileId reaches Telegram", async () => {
    const run = await sendDocumentAsMember({ $tag: "ByFileId", fileId: "file-1" });
    expect(run).toEqual({ outcome: { resolved: true }, botLookups: 1, fileReads: 0, networkCalls: 1 });
  }, LONG);
});
