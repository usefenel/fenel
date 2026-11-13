// ---------------------------------------------------------------------------
// rights R1 §4.4 / §8 — THE UNPERSISTED PRIVILEGED LOOP.
//
// WHAT THESE PINS ASSERT, AND WHY THE HARNESS IS SHAPED THIS WAY.
//
// Defect C: on every authenticated request the raw bearer token was written to
// `function_instances.variables` and to `traces.input`, and on every login the
// plaintext password was written to three child rows and the issued token to
// five. `/io/last-result` and `/io/instances` project those rows to ordinary
// account users. The repair is REMOVAL, not redaction — brief §4.4.
//
// THE OBSERVATION. `DATABASE_URL` is deleted before the evaluator is imported,
// so `getDb()` THROWS (`db/src/client.ts:12`). That is not a convenience: it
// makes the durable path STRUCTURALLY IMPOSSIBLE in this process, because
// `callUserFunction`'s first line is `dependencies.getDb()`. So "the whole auth
// chain completes here" is a stronger claim than "the token is absent from what
// was written" — nothing was written, and nothing COULD have been.
//
// It also means these pins can never touch staging. A `.env`-carrying dev host
// would otherwise have `bun test` insert real rows into the live database while
// asserting about them.
//
// The identity leaves still run: they reach `@fenel/db` through
// `await import(...)` and destructure at CALL time, so a `spyOn` on the module
// namespace is read by the handler. The stubs record every argument, which is
// what turns "it completed" into a value scan (§8.6) rather than a vacuous
// pass — the auth chain is proved to have executed AND the token is proved to
// have reached only `sha256Hex`, never a persistence boundary.
//
// WHY THROUGH `core/src/auth.ts` AND NOT A HAND-BUILT CALL. §8.5 requires the
// real door. A hand-built `invokeIOActionPrivileged` call would pin the loop
// while leaving the door free to drift back to `persistence: "durable"`, which
// is exactly the regression these pins exist to catch.
//
// COST. The first door call boots the EXECUTE-profile registry, which is the
// long pole (the R0.5 sentinel budgets 40 minutes for it in CI). `loadRegistry`
// memoises, so every later pin in this file is cheap — which is why the small
// hand-built-registry pins live in the same file rather than paying a second
// boot.
//
// SCOPE NOTE, declared rather than implied: §8.2's four ROUTE-level reach paths
// (`/io/invoke`, `call_function`, a trigger on a seeded row, a body naming
// `issueSession`) are not each constructed here. All four terminate at the same
// identity leaf, and `rights-r1-privileged-realm.test.ts` pins that leaf
// refusing every frame that lacks the realm. What this file adds is the BODY
// reach: a Fenel body that calls `createSession` by name from an unprivileged
// frame is refused before the database, and the same body under the privileged
// realm reaches it.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";

// Deleted BEFORE the evaluator or `@fenel/db` is imported — a static import is
// hoisted above ordinary statements, so every import in this file that could
// read the URL is dynamic. `execute-registry-boot.test.ts` carries the same
// preamble and the same `afterAll` restore, and for the same measured reason:
// `bun test` over a directory shares one process, and a sibling file chooses
// `describe` vs `describe.skip` on `DATABASE_URL` at module scope.
const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");

// ⚠ INSTALLED BEFORE THE EVALUATOR IS LOADED, and the ordering is the whole
// point. `evaluator.ts` builds its module-scope `runtimeDependencies` literal at
// load time, capturing `insertTraces` BY VALUE; a spy installed afterwards would
// never be the function the loop calls. `@fenel/core` pulls in `@fenel/runtime`,
// so this line must sit between the `@fenel/db` import and the `@fenel/core` one.
//
// WHY IT IS NEEDED AT ALL — the review finding that motivated it. The
// function_instances half of defect C is guarded for free, because
// `callUserFunction` opens with `dependencies.getDb()` and this process has no
// `DATABASE_URL`. The TRACES half is NOT: `persistTraces` wraps `insertTraces` in
// a try/catch that logs and swallows (`evaluator.ts:2990-2996`). So a future edit
// that collected spans and called `persistTraces` from the unpersisted loop would
// throw inside that swallow, print one line, and leave all of these pins GREEN
// while re-opening the leak this file exists to close.
const traceWrites: unknown[][] = [];
spyOn(dbModule, "insertTraces").mockImplementation((async (...args: unknown[]) => {
  traceWrites.push(args);
}) as never);
// Belt and braces, because a namespace spy's reach into a captured binding is a
// runtime detail: if `persistTraces` runs at all with a real `insertTraces`, it
// logs this exact string. Either observer catches the regression.
const consoleErrors: string[] = [];
const realConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map((a) => String(a)).join(" "));
  realConsoleError(...args);
};

const { loginWithPassword, resolveToken } = await import("@fenel/core");
const { runUnpersistedCallForTest, resetRegistryCache, registerIOHandlers, registerFenelBodyDispatchers } = await import("./evaluator");
const { mintAuthority } = await import("@fenel/engine/authority");
const { createRegistry } = await import("@fenel/engine/registry");
const { stdModule } = await import("@fenel/engine/modules/std");
const { stateModule } = await import("@fenel/engine/modules/state");
const { Nothing } = await import("@fenel/engine/type-foundation");
const { registerStateHandlers } = await import("./handlers/state");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  // Restoring the variable is not enough: `loadRegistry` has memoised a
  // Memory-backed registry by now and returns it before re-reading the
  // environment, so a later DB integration file in the same process would see
  // the URL restored while every `state:*` call still went to Memory.
  resetRegistryCache();
  console.error = realConsoleError;
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PASSWORD = "r1-unpersisted-password-fixture";
const EMAIL = "r1-unpersisted@example.invalid";

/** The exact storage form `crypto:hashPassword` produces —
 *  `<saltHex>:<scryptHex>` with a 64-byte key — reproduced here rather than
 *  imported, because the native lives behind the registry's own natives map.
 *  If `verifyPasswordNative` ever changes shape this fixture goes red, which is
 *  the correct coupling. */
function scryptStorageForm(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}
const PASSWORD_HASH = scryptStorageForm(PASSWORD);

/** Every argument every identity leaf received, in order. This IS the value
 *  scan surface: the auth chain writes nowhere else in this process. */
type LeafCall = { leaf: string; args: unknown[] };
let leafCalls: LeafCall[] = [];
/** `true` when a membership row exists for (USER, ACCOUNT). Flipping it is the
 *  A pin (§8.8): the `issueAndWrap` guard `d1a03349` added, which nothing
 *  observed until now. */
let membershipExists = true;
/** `Just row` vs `Nothing` from `getSessionByHash`. */
let sessionExists = true;

function record<T>(leaf: string, value: T): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]) => {
    leafCalls.push({ leaf, args });
    return value;
  };
}

const sessionRow = {
  id: SESSION, userId: USER, accountId: ACCOUNT, tokenHash: "recorded-separately",
  label: null, expiresAt: null, createdAt: new Date(0), lastUsedAt: null,
  email: EMAIL, name: null,
};

// Installed ONCE for the file. `mockRestore` is deliberately not called between
// tests: these replace irreducible IO leaves, and every pin below asserts on
// `leafCalls`, which is reset per test.
spyOn(dbModule, "getUserByEmail").mockImplementation(
  record("getUserByEmail", { id: USER, email: EMAIL, name: null, passwordHash: PASSWORD_HASH }) as never,
);
spyOn(dbModule, "getMembership").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "getMembership", args });
  return membershipExists ? { id: "membership-1", userId: USER, accountId: ACCOUNT, role: "owner" } : null;
}) as never);
spyOn(dbModule, "createSession").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "createSession", args });
  return sessionRow;
}) as never);
spyOn(dbModule, "getSessionByHash").mockImplementation((async (...args: unknown[]) => {
  leafCalls.push({ leaf: "getSessionByHash", args });
  return sessionExists ? sessionRow : null;
}) as never);
spyOn(dbModule, "touchSession").mockImplementation(record("touchSession", undefined) as never);
spyOn(dbModule, "deleteSessionByHash").mockImplementation(record("deleteSessionByHash", undefined) as never);

beforeEach(() => {
  leafCalls = [];
  traceWrites.length = 0;
  consoleErrors.length = 0;
  membershipExists = true;
  sessionExists = true;
});

/** The traces half of defect C. See the spy's own comment above for why the
 *  function_instances half is guarded for free and this half is not.
 *
 *  ⚠ IN `afterEach`, not called per pin, and review round 2 is why. Three call
 *  sites all completed through the loop's `done` outcome, so a regression that
 *  persisted spans only on the EARLY-COMPLETION branch (`end_function`), the
 *  suspend refusal, or the error throw would have been run by the pins covering
 *  those branches and stayed green. Every exit of `runUnpersistedCall` is now
 *  covered. There is no false-red risk: nothing in this file legitimately reaches
 *  `insertTraces`, and the swallow's message exists at exactly one site
 *  (`evaluator.ts` `persistTraces`). */
function expectNoTraceWrites(): void {
  expect(traceWrites).toHaveLength(0);
  expect(consoleErrors.filter((line) => line.includes("Failed to persist execution traces"))).toHaveLength(0);
}

afterEach(expectNoTraceWrites);

const calls = (leaf: string) => leafCalls.filter((entry) => entry.leaf === leaf);
/** Everything the identity leaves saw, as one searchable string. */
const scanSurface = () => JSON.stringify(leafCalls);

describe("rights R1 §8.5–8.7 — one login writes nothing", () => {
  test("loginWithPassword issues a session through the real door with NO durable persistence available", async () => {
    // The durable path cannot run in this process: `callUserFunction` opens with
    // `dependencies.getDb()` and `DATABASE_URL` is absent. So a completed login
    // is itself the proof that no `function_instances` row and no `traces` row
    // was written — a strictly stronger claim than "the token is not in them".
    expect(process.env["DATABASE_URL"]).toBeUndefined();

    const issued = await loginWithPassword({ email: EMAIL, password: PASSWORD, accountId: ACCOUNT });

    // NOT VACUOUS: the chain really ran, all four hops.
    expect(issued).not.toBeNull();
    expect(typeof issued!.token).toBe("string");
    expect(issued!.token.length).toBe(64);
    expect(issued!.sessionId).toBe(SESSION);
    expect(calls("getUserByEmail")).toHaveLength(1);
    expect(calls("getMembership")).toHaveLength(1);
    expect(calls("createSession")).toHaveLength(1);

    // §8.6 — A VALUE SCAN, NOT A KEY SCAN. The issued token and the plaintext
    // password must appear nowhere in anything that crossed a persistence
    // boundary. A `variables ? 'rawToken'` style key probe would miss both:
    // the token also lives nested inside `_lastResult`, and the password inside
    // the argument record of three child instances.
    const surface = scanSurface();
    expect(surface).not.toContain(issued!.token);
    expect(surface).not.toContain(PASSWORD);
    // What DID reach the persistence leaf is the HASH, which is the design.
    const created = calls("createSession")[0]!.args[0] as { tokenHash: string };
    expect(typeof created.tokenHash).toBe("string");
    expect(created.tokenHash).not.toBe(issued!.token);
    expect(created.tokenHash).toHaveLength(64);
  }, 2_400_000);

  test("§8.7 — one ordinary authenticated request writes nothing either", async () => {
    // This is the `resolveToken` path, the one that fires on EVERY request and
    // the one the brief measured as realising defect C most often. It reaches
    // `resolveFromRow`, which was a second child row on the durable path.
    const resolved = await resolveToken("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90");

    expect(resolved).not.toBeNull();
    expect(resolved!.session.id).toBe(SESSION);
    expect(resolved!.subject).toEqual({ $tag: "User", accountId: ACCOUNT, userId: USER });
    expect(resolved!.profile).toEqual({ $tag: "UserProfile", email: EMAIL, name: { $tag: "Nothing" } });
    expect(JSON.stringify(resolved!.profile)).not.toContain("passwordHash");
    // The nested `resolveFromRow` hop ran — that is the child that survived a
    // top-level-only ephemeral mode (§4.4.3).
    expect(calls("touchSession")).toHaveLength(1);
    // The raw token reached the hashing leaf and nothing else.
    const looked = calls("getSessionByHash")[0]!.args[0] as string;
    expect(looked).toHaveLength(64);
    expect(looked).not.toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(scanSurface()).not.toContain("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90");
  }, 600_000);

  test("an unknown token resolves to null without touching a session", async () => {
    sessionExists = false;
    expect(await resolveToken("f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f")).toBeNull();
    expect(calls("touchSession")).toHaveLength(0);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// THE REGRESSION THIS WINDOW FOUND, AND WHY IT HAS ITS OWN BLOCK.
//
// rights R1's FIRST slice (`e5482d8b`, 2026-09-10) shipped a TOTAL LOGIN
// OUTAGE. Measured here on 2026-09-11 by stashing this window's changes and
// driving a real login against staging at that commit:
//
//   LOGIN THREW: state.get_user_by_email: refused — identity leaves require
//   the privileged execution realm.
//
// The cause is one line the slice's own completion note DESCRIBED without
// drawing the consequence: `executeInstance` rebuilds its `FunctionContext`
// from the persisted row via `makeContext`, and that row carries no realm. The
// note read that as "a RESUMED durable instance is refused, which is the
// correct default". It applies to EVERY nested durable call, not only resumes —
// and `auth:loginWithPassword` is itself reached through a body dispatcher, so
// the drop happens before its first leaf.
//
// It shipped because that slice's acceptance item §8.4 — "the login route still
// returns 200 with a token" — was never run. Its 15 pins all asserted at the
// LEAF, where the realm is an input rather than something that had to survive a
// hop. The pins in this file are the repair for that too: the login and
// resolveToken pins above drive `core/src/auth.ts` end to end, so a realm that
// fails to survive any hop turns them red.
// ---------------------------------------------------------------------------

describe("rights R1 — the privileged+durable combination is refused at the door, not one leaf deeper", () => {
  test("invokeIOActionPrivileged refuses persistence: \"durable\" with an explanation naming R4", async () => {
    // Keeping the parameter while refusing the combination is deliberate. A
    // future privileged-but-durable service (a payment capture, a 2FA wait) must
    // meet this refusal at the door, with the reason, rather than discover it as
    // an unexplained identity-leaf refusal in a running app — which is exactly
    // how it presented on 2026-09-10. R4 deletes the guard when durable
    // authority exists.
    const { invokeIOActionPrivileged } = await import("./evaluator");
    await expect(
      invokeIOActionPrivileged("", null, "auth:resolveToken", { rawToken: "x" }, {
        realm: "privileged",
        persistence: "durable",
      }),
    ).rejects.toThrow("privileged + durable execution is not implemented");
  }, 300_000);
});

describe("rights R1 §8.8 — the account-membership guard on login, pinned at last", () => {
  test("loginWithPassword denies a correct password when the user has no membership on the account", async () => {
    // `d1a03349` added `case getMembership user.id accountId of Nothing ->
    // (Nothing)` to `issueAndWrap`, and until this pin NOTHING observed it: a
    // repo-wide grep for `getMembership` across `*.test.ts` returned zero files.
    // By the R0.5 standard — a gate whose red was never observed is not a gate —
    // the repair was deletable while staying green.
    //
    // The sibling half (a session whose membership is later deleted stops
    // resolving) is pinned on the QUERY side in
    // `db/src/db-audit-regressions.fixture.ts` — "session lookup joins both
    // membership axes" and "an absent membership/expired lookup result exposes
    // no session". That file is a `.fixture.ts`, which is why the brief's
    // `--include=*.test.ts` grep reported it missing.
    membershipExists = false;

    const issued = await loginWithPassword({ email: EMAIL, password: PASSWORD, accountId: ACCOUNT });

    expect(issued).toBeNull();
    // The password WAS correct — the denial is the membership check, not the
    // verify. Without this the pin would pass on any failure at all.
    expect(calls("getUserByEmail")).toHaveLength(1);
    expect(calls("getMembership")).toHaveLength(1);
    // §8.8's own assertion: zero session rows.
    expect(calls("createSession")).toHaveLength(0);
  }, 600_000);

  test("a wrong password denies before the membership check", async () => {
    const issued = await loginWithPassword({ email: EMAIL, password: "not-the-password", accountId: ACCOUNT });
    expect(issued).toBeNull();
    expect(calls("getMembership")).toHaveLength(0);
    expect(calls("createSession")).toHaveLength(0);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// The mechanism itself, on a hand-built registry. Cheap: the memoised boot
// above has already happened.
// ---------------------------------------------------------------------------

const CREATE_SESSION_ID = "state:createSession";
let fixtureRegistry: ReturnType<typeof createRegistry> | undefined;
/** A registry holding `std` plus ONLY the `createSession` leaf, and one
 *  hand-written fixture body that calls it by name. Hand-written JSON Logic is
 *  sanctioned for small test fixtures. */
function reachRegistry() {
  if (fixtureRegistry === undefined) {
    fixtureRegistry = createRegistry([
      stdModule,
      {
        name: "state",
        label: "Identity leaf under test",
        functions: stateModule.functions?.filter((fn) => fn.id === CREATE_SESSION_ID),
        // Names and IO action aliases are optional instance projections, not
        // facts the registry invents from a function id's suffix.
        instances: stateModule.instances?.filter((instance) => instance.args[0] === CREATE_SESSION_ID),
      },
      {
        name: "rightsFixture",
        label: "rights R1 reach fixture",
        functions: [
          {
            id: "rightsFixture:mintSession",
            params: [],
            returns: { $record: { fields: [] } },
            body: { call: ["createSession", "victim-user", "victim-account", "attacker-hash", { $tag: "Nothing" }, { $tag: "Nothing" }] },
          },
          {
            // `sleep` is a registered IO handler (`registerIOHandlers`) that
            // answers `{ action: "suspend", status: "waiting_timer" }` — the
            // shape the durable loop would checkpoint and the unpersisted loop
            // has no row to checkpoint into.
            id: "rightsFixture:waitsForever",
            params: [],
            returns: { $record: { fields: [] } },
            body: { call: ["sleep", "1h"] },
          },
          {
            // A body whose FIRST statement is `let x = <if>`. `turn` rewrites that
            // in place (`frame.exprs[frame.index] = { do: [...] }`, the structural-let
            // arm) UNCONDITIONALLY, with no IO analysis — which is what makes this the
            // discriminating fixture for the per-call program clone. `mintSession`
            // above is a single expression, so its stack frame is a FRESH `[program]`
            // array and it never exercises the freeze at all.
            id: "rightsFixture:rewritesItself",
            params: [],
            returns: { $record: { fields: [] } },
            body: {
              do: [
                { let: { picked: { if: [true, 1, 2] } } },
                { call: ["createSession", "victim-user", "victim-account", "attacker-hash", { $tag: "Nothing" }, { $tag: "Nothing" }] },
              ],
            },
          },
          {
            // `end_function` also answers `suspend`, with `status: "completed"`,
            // and the DURABLE loop reads that as completion rather than as a
            // wait. The unpersisted loop must agree, or a body ending in
            // `end_function` would throw here and return `_lastResult` there.
            id: "rightsFixture:endsEarly",
            params: [],
            returns: { $record: { fields: [] } },
            body: { do: [{ call: ["add", 1, 2] }, { call: ["end_function"] }] },
          },
          {
            id: "rightsFixture:namesNothing",
            params: [],
            returns: { $record: { fields: [] } },
            body: { call: ["rightsFixture:notInAnyRegistry"] },
          },
        ],
      },
    ]);
    registerStateHandlers(fixtureRegistry);
    registerIOHandlers(fixtureRegistry);
    registerFenelBodyDispatchers(fixtureRegistry);
  }
  return fixtureRegistry;
}

/** rights R2a — every `FunctionContext` now states its authority. These R1 pins
 *  are about the REALM bit, which R2a deliberately RETAINS: the member envelope
 *  and the realm guard refuse the same acts twice, and that redundancy is
 *  defence in depth until R6.
 *
 *  ⚠ THE AUTHORITY HERE PERMITS EVERY FIXTURE DESCRIPTOR, INCLUDING THE
 *  IDENTITY LEAF, ON PURPOSE. The member envelope EXCLUDES `state.create_session`,
 *  so minting one would make the GATE refuse first and these pins would go green
 *  for the wrong reason — they would stop observing the realm guard entirely,
 *  which is the one thing they exist to observe. */
function reachAuthority() {
  const reg = reachRegistry();
  return mintAuthority(reg, {
    envelope: reg.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [reg.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: ACCOUNT,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

const REFUSAL = "identity leaves require the privileged execution realm";

describe("rights R1 §8.2 — body reach: an ordinary frame cannot mint a session", () => {
  test("a body that calls createSession by name is refused, and no session row is written", async () => {
    // The reach test the four route paths all reduce to: a Fenel BODY naming
    // the leaf, evaluated from a frame with no realm. The refusal happens
    // before the handler's `await import("@fenel/db")`, so the stub is never
    // reached — which is the "zero sessions inserts" assertion in a process
    // that has no database at all.
    await expect(
      runUnpersistedCallForTest("rightsFixture:mintSession", {}, { accountId: ACCOUNT, profileId: "", authority: reachAuthority() }, reachRegistry()),
    ).rejects.toThrow(REFUSAL);
    expect(calls("createSession")).toHaveLength(0);
  }, 300_000);

  test("THE DISCRIMINATION: the same body under the privileged realm reaches the leaf", async () => {
    // Without this the pin above would stay green if `createSession` simply
    // stopped resolving — a refusal for the wrong reason.
    await runUnpersistedCallForTest(
      "rightsFixture:mintSession",
      {},
      { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
      reachRegistry(),
    );
    expect(calls("createSession")).toHaveLength(1);
  }, 300_000);
});

describe("rights R1 §8.12 — a privileged frame executes only registry-resident code", () => {
  test("an action with no registry IO handler is refused rather than resolved from the database", async () => {
    // `handleIO`'s fallbacks past `getIOHandler` leave the registry:
    // `resolveCapabilityMethod` enters the account dispatcher,
    // `tryCallUserFunction` SELECTs and evaluates the account's stored
    // `functions` row, and the last one hands the action to `dispatch` under
    // a manufactured system subject (rights R2a deleted that variant). None may
    // run with the identity leaves unlocked.
    await expect(
      runUnpersistedCallForTest(
        "rightsFixture:namesNothing",
        {},
        { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
        reachRegistry(),
      ),
    ).rejects.toThrow("resolves only registry IO handlers");
  }, 300_000);

  test("the refusal text carries no caller data — `api/src/index.ts` returns err.message to the client outside production", async () => {
    let message = "";
    try {
      await runUnpersistedCallForTest(
        "rightsFixture:mintSession",
        { secretParam: "must-not-appear" },
        { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
        // A registry WITHOUT the state leaf, so the privileged refusal fires.
        createRegistry([stdModule, {
          name: "rightsFixture", label: "no leaves",
          functions: [{ id: "rightsFixture:mintSession", params: [], returns: { $record: { fields: [] } }, body: { call: ["createSession", "u", "a", "h"] } }],
        }]),
      );
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("resolves only registry IO handlers");
    expect(message).not.toContain("must-not-appear");
  }, 300_000);
});

describe("rights R1 §4.4 — the unpersisted loop's own contract", () => {
  test("it refuses to suspend rather than silently dropping the continuation", async () => {
    // There is no row to resume from, so a suspension in this mode is
    // unrepresentable. The durable loop would have saved state and waited;
    // this one must say so loudly rather than return a half-run value.
    await expect(
      runUnpersistedCallForTest(
        "rightsFixture:waitsForever",
        {},
        { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
        reachRegistry(),
      ),
    ).rejects.toThrow("Unpersisted execution cannot suspend");
  }, 300_000);

  test("`end_function` completes rather than being read as a suspension", async () => {
    // The one `suspend` shape that is NOT a wait. The durable loop calls
    // `completeInstance` and returns `_lastResult`; a loop that treated every
    // `suspend` as an error would diverge from it on any body ending in
    // `end_function`.
    const result = await runUnpersistedCallForTest(
      "rightsFixture:endsEarly",
      {},
      { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
      reachRegistry(),
    );
    expect(result).toEqual({ action: "continue", value: 3 });
  }, 300_000);

  test("it does not mutate the registry's own function body", async () => {
    // `turn` rewrites `frame.exprs[i]` IN PLACE for every ANF hoist, let-struct,
    // if-condition and match-scrutinee lift, and `createRegistry` deep-freezes
    // each effective function. Evaluating the registry object directly throws
    // `TypeError: Attempted to assign to readonly property` at the first
    // rewrite — and if it did NOT throw it would corrupt the shared body for
    // every later caller. The durable path never met this because
    // `executeInstance` evaluates a row freshly read from the database.
    const reg = reachRegistry();
    const before = JSON.stringify(reg.getFunction("rightsFixture:rewritesItself")?.body);
    await runUnpersistedCallForTest(
      "rightsFixture:rewritesItself",
      {},
      { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
      reg,
    );
    expect(JSON.stringify(reg.getFunction("rightsFixture:rewritesItself")?.body)).toBe(before);
    // And a SECOND call still works — a mutated body would have drifted.
    await runUnpersistedCallForTest(
      "rightsFixture:rewritesItself",
      {},
      { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
      reg,
    );
    expect(calls("createSession")).toHaveLength(2);
  }, 300_000);

  test("it refuses a name with no registry body instead of falling back to the database", async () => {
    await expect(
      runUnpersistedCallForTest(
        "rightsFixture:doesNotExist",
        {},
        { accountId: ACCOUNT, profileId: "", authority: reachAuthority(), realm: "privileged", persistence: "ephemeral" },
        reachRegistry(),
      ),
    ).rejects.toThrow("Unpersisted execution requires a registry body");
  }, 300_000);
});

// Keeps `Nothing` referenced so the import stays honest about what this file
// exercises if a future edit drops its last use.
export const _unused = Nothing;
