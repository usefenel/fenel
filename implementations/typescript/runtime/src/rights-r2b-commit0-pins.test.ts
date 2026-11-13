// ---------------------------------------------------------------------------
// rights R2b commit 0 — the runtime half of the R0.5 pass.
//
// R2a's completion note §6 states plainly that four of its acceptance items had
// no dedicated test: the login-chain CLASS assertion (R2a brief §6.17), the
// pure channel (§6.18), the interim-lane resume (§6.20) and the guard-vs-list
// equality (§6.23). This file writes them. The fifth (§6.14, the override
// guard) is engine-side, in `engine/src/rights-r2b-commit0-pins.test.ts`.
//
// THE SHAPE RULE (R1 note §2), which is why three of these four cost a whole
// harness each: a pin at the layer where the authority is an INPUT observes
// nothing about whether it SURVIVED the hop above. P0.2 enters through the real
// `core/src/auth.ts` door; P0.3 drives a body through `turn`, the channel that
// never touches `performIODescriptor` at all; P0.4 enters through
// `resumeWaitingInstance`, which rebuilds its frame from a persisted row.
//
// THE OBSERVATION, inherited from `rights-r1-unpersisted-auth.test.ts`:
// `DATABASE_URL` is deleted before the evaluator is imported, so `getDb()`
// throws and the real durable path is STRUCTURALLY IMPOSSIBLE in this process.
// "The leaf was never reached" is therefore stronger than "the spy recorded
// nothing" — nothing was written and nothing COULD have been.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED BEFORE IT WAS TRUSTED, one neuter at a
// time, with the red text recorded in the phase completion note.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");

// Installed BEFORE the evaluator loads, for the reason `rights-r1-unpersisted-auth`
// records: `evaluator.ts` captures `insertTraces` BY VALUE in a module-scope
// literal, so a spy installed afterwards is never the function the loop calls.
spyOn(dbModule, "insertTraces").mockImplementation((async () => {}) as never);

const { loginWithPassword } = await import("@fenel/core");
const {
  runUnpersistedCallForTest, resetRegistryCache, registerIOHandlers, resumeWaitingInstance,
  executeInstance, turn, loadRegistry, registerFenelBodyDispatchers,
} = await import("./evaluator");
type RuntimeDependencies = import("./evaluator").RuntimeDependencies;
const { mintAuthority, authenticateAuthority } = await import("@fenel/engine/authority");
const { createRegistry } = await import("@fenel/engine/registry");

const { stdModule } = await import("@fenel/engine/modules/std");
const { ioModule } = await import("@fenel/engine/modules/io");
const { stateModule } = await import("@fenel/engine/modules/state");
const { Just, Nothing } = await import("@fenel/engine/type-foundation");
const { registerStateHandlers, assertFencedLeavesMatch } = await import("./handlers/state");
const { AuthorityRefused, createDispatchRegistry } = await import("@fenel/engine");
const { mintInterimWorkerAuthority, mintAnonymousAuthority } = await import("./authority-mint");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetRegistryCache();
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PASSWORD = "r2b-commit0-password-fixture";
const EMAIL = "r2b-commit0@example.invalid";
const LONG = 2_400_000;

function scryptStorageForm(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}
const PASSWORD_HASH = scryptStorageForm(PASSWORD);

type LeafCall = { leaf: string; args: unknown[] };
let leafCalls: LeafCall[] = [];
const calls = (leaf: string) => leafCalls.filter((entry) => entry.leaf === leaf);

const sessionRow = {
  id: SESSION, userId: USER, accountId: ACCOUNT, tokenHash: "recorded-separately",
  label: null, expiresAt: null, createdAt: new Date(0), lastUsedAt: null,
};

spyOn(dbModule, "getUserByEmail").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "getUserByEmail", args });
  return { id: USER, email: EMAIL, name: null, passwordHash: PASSWORD_HASH };
}) as never);
spyOn(dbModule, "getMembership").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "getMembership", args });
  return { id: "membership-1", userId: USER, accountId: ACCOUNT, role: "owner" };
}) as never);
spyOn(dbModule, "createSession").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "createSession", args });
  return sessionRow;
}) as never);

beforeEach(() => { leafCalls = []; });

// ---------------------------------------------------------------------------
// P0.2 — THE LOGIN CHAIN, BY CLASS (R2a brief §6.17).
//
// R2a's note says pin 17 was "covered transitively". Transitive coverage of a
// POSITIVE is not coverage of the NEGATIVE, and the negative is the one that
// matters: the chain must be refused for an ordinary account authority by the
// GATE — an `AuthorityRefused`, which the 403 mapping reads by CLASS — and not
// merely by R1's realm guard, which throws a plain `Error` the route maps to a
// 500.
// ---------------------------------------------------------------------------

describe("rights R2b P0.2 — the identity chain is gate-refused for a member, by class", () => {
  test("the real door completes the login, and a member authority is refused with AuthorityRefused", async () => {
    expect(process.env["DATABASE_URL"]).toBeUndefined();

    // THE POSITIVE CONTROL, through the real `core/src/auth.ts` door, which
    // mints the identity-realm authority internally.
    const issued = await loginWithPassword({ email: EMAIL, password: PASSWORD, accountId: ACCOUNT });
    expect(issued).not.toBeNull();
    expect(issued!.sessionId).toBe(SESSION);
    expect(calls("createSession")).toHaveLength(1);

    // THE NEGATIVE, one input apart: the same chain, the same registry, the
    // same execution loop — entered under an ordinary account member authority.
    //
    // ⚠ DECLARED DEVIATION from the brief's `invokeIOActionAs` spelling, with
    // the reason. `invokeIOActionAs` takes the DURABLE path, whose first line
    // is `dependencies.getDb()`; this process has no `DATABASE_URL` precisely
    // so that nothing here can write, so that call fails on the database before
    // it reaches the gate and would observe nothing about authority.
    // `runUnpersistedCallForTest` IS the loop `invokeIOActionPrivileged` runs
    // (`runUnpersistedCall`), so the positive above and this negative differ by
    // the AUTHORITY ALONE rather than by the authority and the loop — which is
    // the stronger discrimination, not a weaker one.
    //
    // Neuter: make `authority:roleEnvelope`'s general row stop excluding the
    // session leaves (`authorityGeneralDescriptors` returns `names` unfiltered).
    // RED reads: the thrown error is a plain Error from the realm guard
    // (`state.create_session: refused — identity leaves require the privileged
    // execution realm.`), NOT an AuthorityRefused — the leaf's own bit stops it
    // and the GATE does not, so the route answers 500 rather than 403.
    const registry = loadRegistry();
    const member = mintInterimWorkerAuthority(registry, ACCOUNT, "trigger");
    const beforeCreate = calls("createSession").length;
    const beforeRead = calls("getUserByEmail").length;
    let caught: unknown;
    try {
      await runUnpersistedCallForTest(
        "auth:loginWithPassword",
        { email: EMAIL, password: PASSWORD, accountId: ACCOUNT },
        { accountId: ACCOUNT, profileId: "", persistence: "ephemeral" as const, authority: member },
        registry,
      );
    } catch (error) {
      caught = error;
    }
    let found: unknown = caught;
    for (let depth = 0; depth < 8 && found !== undefined && found !== null; depth += 1) {
      if (found instanceof AuthorityRefused) break;
      found = (found as { cause?: unknown }).cause;
    }
    // The MESSAGE first, so the neuter's red text names the defect: with the
    // exclusion gone, what surfaces is R1's realm guard one layer later.
    expect(String(caught)).toMatch(/authority refused/);
    // ⚠ THEN UNCONDITIONALLY, BY CLASS. A message assertion alone would stay
    // green for a refusal raised as a plain Error, and the 403 mapping is by
    // class.
    expect(found).toBeInstanceOf(AuthorityRefused);
    // ⚠ REFUSED AT THE FIRST IDENTITY LEAF, not the last: the chain opens with
    // `state:getUserByEmail`, which the member envelope also excludes. Neither
    // leaf was reached.
    expect((found as InstanceType<typeof AuthorityRefused>).descriptor).toMatch(/get_user_by_email|getUserByEmail/);
    expect(calls("getUserByEmail")).toHaveLength(beforeRead);
    expect(calls("createSession")).toHaveLength(beforeCreate);
  }, LONG);
});

// ---------------------------------------------------------------------------
// P0.5 — THE GUARD ↔ LIST EQUALITY (R2a brief §6.23), bidirectional and at
// REGISTRATION time.
// ---------------------------------------------------------------------------

describe("rights R2b P0.5 — the realm fence and the Fenel list name the same set", () => {
  test("the production pair is EQUAL, read from the real registry", () => {
    // ⚠ THE REAL REGISTRY, not a copy of the list. `registerStateHandlers`
    // already asserted this at boot; re-asserting here is what turns "it did
    // not throw during an unrelated import" into an observation.
    const registry = loadRegistry();
    const fenced = registry.evaluateAuthorityFunction(
      "authority:sessionLeafDescriptors", [0],
    ) as string[];
    expect(() => registerStateHandlers(registry)).not.toThrow();
    expect(fenced.length).toBeGreaterThan(0);
  }, LONG);

  test("a pair differing by one name in EACH direction throws, naming the difference", () => {
    // Neuter: make `assertFencedLeavesMatch` one-directional (drop the
    // `notFenced` computation and its clause).
    // RED reads: the extra-in-list case does not throw —
    //   `expect(received).toThrow(expected) / Received function did not throw`.
    expect(() => assertFencedLeavesMatch(["a", "b"], ["a"], "list:X"))
      .toThrow(/fenced here but absent from the list: b/);
    expect(() => assertFencedLeavesMatch(["a"], ["a", "b"], "list:X"))
      .toThrow(/in the list but not fenced here: b/);
    expect(() => assertFencedLeavesMatch(["a", "b"], ["a", "c"], "list:X"))
      .toThrow(/absent from the list: b — in the list but not fenced here: c/);
    // THE CONTROL, one input apart.
    expect(() => assertFencedLeavesMatch(["a", "b"], ["b", "a"], "list:X")).not.toThrow();
  }, LONG);
});

// ---------------------------------------------------------------------------
// THE ANONYMOUS MINT (R2a §6.19) — previously unpinned anywhere.
//
// The re-neuter pass found this the same way it found the 403 mapping: by
// trying to redden it and discovering there was nothing to redden.
// ---------------------------------------------------------------------------

describe("rights R2b — an anonymous caller holds the EMPTY envelope", () => {
  test("every descriptor the registry exposes is refused, including the most ordinary one", () => {
    const registry = loadRegistry();
    // Neuter: `mintAnonymousAuthority` calls `roleEnvelope(registry, "", "member")`
    // instead of `authority:emptyEnvelope`.
    // RED reads: `Expected: {"$tag":"Just","_0":false} / Received:
    // {"$tag":"Just","_0":true}` for `state:getInstance` — an unauthenticated
    // caller holding a member's reach.
    const handle = mintAnonymousAuthority(registry);
    const record = authenticateAuthority(handle)!;
    expect(record.issuer).toBe("anonymous");
    expect(record.accountId).toBeNull();
    expect(record.envelope).toEqual({ $tag: "EvRows", rows: [] });
    for (const descriptor of ["state:getInstance", "state.get_instance", "http:fetch", "probe:nothing"]) {
      expect(
        registry.evaluateAuthorityFunction("authority:permits", [
          record.envelope,
          { $tag: "Act", descriptor, args: [], fields: [] },
        ]),
        descriptor,
      ).toEqual({ $tag: "Just", _0: false });
    }
    // THE CONTROL, one input apart: the same judgment under the member envelope
    // permits the ordinary descriptor. Without it the pin would stay green if
    // `permits` simply stopped answering `Just true` for anything.
    const member = authenticateAuthority(mintInterimWorkerAuthority(registry, ACCOUNT, "trigger"))!;
    expect(
      registry.evaluateAuthorityFunction("authority:permits", [
        member.envelope,
        { $tag: "Act", descriptor: "state:getInstance", args: [], fields: [] },
      ]),
    ).toEqual({ $tag: "Just", _0: true });
  }, LONG);
});

// ---------------------------------------------------------------------------
// THE DB DOUBLE for P0.3 / P0.4 — the `durable-runtime-regressions` shape,
// reduced to what these two pins need (select / insert / update over
// `function_instances`, with the bound WHERE parameters interpreted).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A dispatch registry carrying ONE effect class, so a `requires`-bearing
 *  native in the fixture registry is classified as a mediated ACT rather than
 *  an ordinary computation. Without a REGISTERED class the resolver returns
 *  `Computation` and the native runs unmediated — which is exactly the latent
 *  hole R2a §7 item 2 records, and exactly why this pin registers one. */
function probeDispatch() {
  const dispatch = createDispatchRegistry();
  dispatch.defineClass({ name: "HasProbeIO", params: [{ name: "scope" }], methods: [] } as never);
  return dispatch;
}

let probeHits = 0;

function probeRegistry() {
  return createRegistry([
    stdModule,
    ioModule,
    {
      name: "state",
      label: "identity leaf under test",
      functions: stateModule.functions?.filter((fn) => fn.id === "state:createSession"),
    },
    {
      name: "probe",
      label: "rights R2b commit-0 mediated-native fixture",
      functions: [
        {
          id: "probe:mediated",
          params: [],
          returns: { $ref: "String" },
          requires: [{ class: { $tag: "Id", entityId: "HasProbeIO" }, args: [{ $var: "scope" }] }],
        },
      ] as never,
      nativeImpls: {
        "probe:mediated": () => { probeHits += 1; return "probe-ran"; },
      },
    } as never,
  ], { dispatchRegistry: probeDispatch() });
}

function dbDouble(registry: ReturnType<typeof createRegistry>) {
  const instances = new Map<string, Row>();
  const definitions = new Map<string, Row>();
  const dialect = new PgDialect();
  let sequence = 0;
  const matches = (condition: SQL | undefined): ((row: Row) => boolean) => {
    if (!condition) return () => true;
    const query = dialect.sqlToQuery(condition);
    const columns = [...query.sql.matchAll(/"(?:function_instances|functions)"\."([a-z_]+)" = \$(\d+)/g)];
    const tokens = [...query.sql.matchAll(/"function_instances"\."variables"->>'_suspensionId' = \$(\d+)/g)];
    const fieldName = (name: string) => name.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
    return (row: Row): boolean => {
      for (const match of columns) {
        const field = fieldName(match[1]!);
        const parameter = query.params[Number(match[2]) - 1];
        if (field === "variables") {
          if (JSON.stringify(row[field]) !== (typeof parameter === "string" ? parameter : JSON.stringify(parameter))) return false;
        } else if (row[field] !== parameter) return false;
      }
      for (const match of tokens) {
        if ((row["variables"] as Row | undefined)?.["_suspensionId"] !== query.params[Number(match[1]) - 1]) return false;
      }
      for (const match of query.sql.matchAll(/"(?:function_instances|functions)"\."([a-z_]+)" is null/g)) {
        if (row[fieldName(match[1]!)] != null) return false;
      }
      return true;
    };
  };
  const queryBuilder = (run: () => Row[]) => ({
    limit: async (limit: number) => clone(run().slice(0, limit)),
    returning: async () => clone(run()),
    then: (yes: (rows: Row[]) => unknown, no: (error: unknown) => unknown) =>
      Promise.resolve().then(() => clone(run())).then(yes, no),
  });
  const rowsFor = (table: unknown) => (table === dbModule.functions ? definitions : instances);
  const db = {
    async transaction<T>(operation: (transaction: unknown) => Promise<T>): Promise<T> {
      return operation({ ...db, execute: async () => [] });
    },
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => queryBuilder(() => [...rowsFor(table).values()].filter(matches(condition))) }) }),
    insert: (table: unknown) => ({ values: (input: Row) => ({ returning: async () => {
      const row = clone({ id: `instance-${++sequence}`, parentInstanceId: null, ...input });
      rowsFor(table).set(row["id"] as string, row);
      return [clone(row)];
    } }) }),
    update: (table: unknown) => ({ set: (change: Row) => ({ where: (condition: SQL) => queryBuilder(() => {
      const found = [...rowsFor(table).values()].filter(matches(condition));
      for (const row of found) Object.assign(row, clone(change));
      return found;
    }) }) }),
  };
  registerStateHandlers(registry);
  registerIOHandlers(registry, { getInputRegistry: async () => registry });
  registerFenelBodyDispatchers(registry);
  const dependencies: RuntimeDependencies = {
    getDb: () => db as unknown as ReturnType<RuntimeDependencies["getDb"]>,
    loadRegistry: () => registry,
    getInputRegistry: async () => registry,
    insertTraces: async () => {},
  };
  const start = (name: string, body: unknown, variables: Row = {}) => {
    const fn = { id: `fn-${name}`, name, accountId: ACCOUNT, active: true, sourceRegistryId: null, function: { body } };
    definitions.set(fn.id, fn);
    const row = {
      id: `instance-${++sequence}`, accountId: ACCOUNT, profileId: "profile",
      parentInstanceId: null, functionId: fn.id, status: "running", variables,
    };
    instances.set(row.id, row);
    return row.id;
  };
  return { instances, dependencies, start };
}

/** A `test`-issuer authority naming exactly these descriptors. */
function permitting(registry: ReturnType<typeof createRegistry>, descriptors: readonly string[]) {
  return mintAuthority(registry, {
    envelope: registry.evaluateAuthorityFunction("authority:descriptorEnvelope", [[...descriptors]]),
    issuer: "test",
    accountId: ACCOUNT,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

// ---------------------------------------------------------------------------
// P0.3 — THE PURE CHANNEL (R2a brief §6.18).
//
// A mediated native inside a body reaches the gate through `mediateNativeAct`
// in the EVALUATOR, not through `performIODescriptor`. So the authority has to
// ride the frame `turn` builds, and `turn` builds it from
// `reg.evaluateContext()` — which carries the registry BOOTSTRAP authority,
// i.e. the universe. One spread-and-override line is the whole mechanism, and
// nothing observed it.
// ---------------------------------------------------------------------------

describe("rights R2b P0.3 — a mediated native inside a body is judged under the caller's authority", () => {
  test("an excluding authority refuses it in the pure channel; a naming one runs it", () => {
    const registry = probeRegistry();
    probeHits = 0;
    const body = { call: ["probe:mediated"] };
    // Neuter: `turn` builds its frame from `reg.evaluateContext()` alone (drop
    // `_authority: authority`).
    // RED reads: probe hit 1 under the EXCLUDING authority — the bootstrap
    // universe permitted it — and no throw at all.
    //
    // ⚠ THE DAMAGE ASSERTION COMES FIRST. Asserting the throw first would
    // redden with "did not throw", which says the gate is gone but not what it
    // was guarding; asserting the HIT COUNT first makes the red text the defect.
    let thrown: unknown;
    try {
      turn(
        { stack: [{ exprs: [body], index: 0 }], env: {}, letTarget: Nothing },
        registry,
        permitting(registry, ["probe:somethingElse"]),
      );
    } catch (error) {
      thrown = error;
    }
    expect(probeHits).toBe(0);
    expect(String(thrown)).toMatch(/authority refused "probe:mediated"/);

    // THE CONTROL, one input apart.
    const result = turn(
      { stack: [{ exprs: [body], index: 0 }], env: {}, letTarget: Nothing },
      registry,
      permitting(registry, ["probe:mediated"]),
    );
    expect(probeHits).toBe(1);
    expect(result.outcome).toBe("done");
  }, LONG);
});

// ---------------------------------------------------------------------------
// P0.4 — THE INTERIM-LANE RESUME (R2a brief §6.20).
//
// `resumeWaitingInstance` rebuilds its frame from the persisted row via
// `makeContext`, which produces NO authority — that is the invariant R2a
// shipped. The wake's own handle is threaded as a parameter. This pin is the
// executable statement of that: a resumed continuation that yields an identity
// leaf is refused BY THE GATE, before R1's realm bit.
// ---------------------------------------------------------------------------

describe("rights R2b P0.4 — a resumed continuation is judged under the wake's authority", () => {
  test("an interim lane resuming a body that yields an identity leaf is refused by the gate", async () => {
    const registry = probeRegistry();
    const f = dbDouble(registry);
    const before = calls("createSession").length;
    const paused = f.start("resume-identity-leaf", {
      do: [
        { call: ["read", { $record: { fields: [] } }, Just("event:go"), Nothing, Nothing] },
        { call: ["state:createSession", USER, ACCOUNT, "x", Nothing, Nothing] },
      ],
    });
    const lane = mintInterimWorkerAuthority(registry, ACCOUNT, "timer-sweep");
    // Park the instance on the read.
    await executeInstance(paused, undefined, lane, f.dependencies);
    expect(f.instances.get(paused)?.["status"]).toBe("waiting_event");

    // Neuter: the lane mints the bootstrap authority
    // (`registry.evaluateContext()._authority`) instead of the member envelope.
    // RED reads: no AuthorityRefused — the realm guard's plain Error
    // (`state.create_session: refused — identity leaves require the privileged
    // execution realm.`) surfaces instead, one layer too late.
    let caught: unknown;
    try {
      await resumeWaitingInstance(
        paused,
        { accepted: true },
        { issuer: "timer-sweep", authority: lane, accountId: ACCOUNT },
        f.dependencies,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthorityRefused);
    expect((caught as InstanceType<typeof AuthorityRefused>).descriptor)
      .toMatch(/create_session|createSession/);
    expect((caught as InstanceType<typeof AuthorityRefused>).reason).toBe("refused");
    expect(calls("createSession")).toHaveLength(before);

    // THE DISCRIMINATION, and it is also the two-layer statement: an authority
    // that DOES name the leaf gets past the gate and is then stopped by R1's
    // realm bit — a PLAIN Error, one layer later. So the refusal above really
    // was the gate's, and the leaf really is reachable when the envelope allows
    // it.
    const permissive = f.start("resume-identity-leaf-permitted", {
      do: [
        { call: ["read", { $record: { fields: [] } }, Just("event:go"), Nothing, Nothing] },
        { call: ["state:createSession", USER, ACCOUNT, "x", Nothing, Nothing] },
      ],
    });
    const naming = permitting(registry, ["read", "state.create_session", "state:createSession"]);
    await executeInstance(permissive, undefined, naming, f.dependencies);
    let second: unknown;
    try {
      await resumeWaitingInstance(
        permissive,
        { accepted: true },
        { issuer: "timer-sweep", authority: naming, accountId: ACCOUNT },
        f.dependencies,
      );
    } catch (error) {
      second = error;
    }
    expect(second).not.toBeInstanceOf(AuthorityRefused);
    expect(String(second)).toMatch(/identity leaves require the privileged execution realm/);
    expect(calls("createSession")).toHaveLength(before);
  }, LONG);
});

afterEach(() => { /* leafCalls is reset in beforeEach; nothing else is global. */ });

// ---------------------------------------------------------------------------
// rights R2b §6.28 — THE ALL-ACCOUNTS TICK RE-MINTS BEFORE IT PERFORMS.
//
// It lives here rather than in `rights-r2b-partition.test.ts` because it needs
// this file's DB double and resume harness, and duplicating those would give
// the two pins two different fixtures for one mechanism.
//
// ⚠ WHY THIS IS NOT A CONTRADICTION OF THE PARTITION. `triggers.ts` mints the
// sweep's authority with `accountId = null`, so under R2b it holds a `member`
// envelope PARTITIONED TO `""` — an account that matches nothing. That is
// correct rather than broken: `resumeWaitingInstance` reads the row directly
// (not through a perform) and RE-MINTS over the row's own account BEFORE the
// continuation runs, so the `""` envelope never judges a real act. A partition
// axis that refused the tick BEFORE the re-mint would not be a finding; a
// resumed body refused AFTER it would be.
// ---------------------------------------------------------------------------

describe("rights R2b 28 — the all-accounts tick re-mints over the row's account", () => {
  test("a continuation resumed by the `null`-account sweep performs for the ROW's account", async () => {
    const registry = probeRegistry();
    const f = dbDouble(registry);
    const paused = f.start("tick-storage", {
      do: [
        { call: ["read", { $record: { fields: [] } }, Just("event:go"), Nothing, Nothing] },
        { call: ["probe:mediated"] },
      ],
    });
    probeHits = 0;
    const lane = mintInterimWorkerAuthority(registry, ACCOUNT, "timer-sweep");
    await executeInstance(paused, undefined, lane, f.dependencies);
    expect(f.instances.get(paused)?.["status"]).toBe("waiting_event");

    // The `""`-account envelope on its own permits NOTHING for this account:
    // the general row is there, but a storage act would be refused. The probe
    // native is in the general row, so what this pin observes is the RE-MINT's
    // record, not a storage verdict.
    const swept = mintInterimWorkerAuthority(registry, null, "timer-sweep");
    expect(authenticateAuthority(swept)!.accountId).toBeNull();

    // Neuter: `resumeWaitingInstance` uses `authority.authority` unconditionally
    // instead of re-minting when `accountId === null`.
    // RED reads: the resumed body is judged under the `""` envelope.
    await resumeWaitingInstance(
      paused,
      { accepted: true },
      { issuer: "timer-sweep", authority: swept, accountId: null },
      f.dependencies,
    );
    expect(f.instances.get(paused)?.["status"]).toBe("completed");
    expect(probeHits).toBe(1);
  }, LONG);
});

// ---------------------------------------------------------------------------
// rights R2b §6.8 (the runtime half) — the RUNTIME's reserved set also carries
// the checker's namespace.
//
// `buildExecutionRegistry` passes `loadRegistry().listReservedNamespaces()` while
// the engine's authoring entry points pass an execute-profile repository
// registry's. The two sets are not identical — the runtime swaps the storage
// module and prepends the representation bridge — so the property must hold of
// BOTH.
//
// ⚠ AND IT IS THE UNION, NOT THE MODULE NAMES. Measured: the runtime registry
// carries 46 module names and 44 function NAMESPACES, and exactly three of the
// second are not in the first — `subject`, `kernel`, `set`. Their functions ride
// inside another module through `functionNamespaceOverrides`, so no module is
// literally named after them, and a module-name-only reservation would have left
// `module subject where` installable. The brief's ruling 4 says the reservation
// closes `authority` AND `subject`; the module-name set alone closes only the
// first.
// ---------------------------------------------------------------------------

describe("rights R2b 8 — the runtime reserved set refuses the checker's namespace", () => {
  test("`authority` and `subject` are in the runtime registry's own module names", async () => {
    const { assertSourceModuleNamespaces } = await import("@fenel/engine/authoring/source-module");
    const reserved = new Set(loadRegistry().listReservedNamespaces());
    // Neuter: derive the reserved set from the manifests again.
    // RED reads: `authority` absent, and the assertion below not throwing.
    expect(reserved).toContain("authority");
    expect(reserved).toContain("subject");
    for (const name of ["authority", "subject", "state", "std"]) {
      expect(
        () => assertSourceModuleNamespaces([{ module: { name } } as never], reserved),
        name,
      ).toThrow(/reserved/);
    }
    expect(() => assertSourceModuleNamespaces(
      [{ module: { name: "r2b-fresh-runtime-name" } } as never],
      reserved,
    )).not.toThrow();
  }, LONG);
});
