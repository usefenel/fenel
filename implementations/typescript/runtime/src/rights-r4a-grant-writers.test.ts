// ---------------------------------------------------------------------------
// rights R4a §0 — INGRESS CONTAINMENT. Pin P21: A GRANT ROW'S OWNER IS NOT
// PATCHABLE BY AN ORDINARY PRODUCT MUTATION.
//
// Brief: `workstreams/rights/briefs/r4a-issuance-and-durable-reauthorization.md`
// §0.3 and §0.5.
//
// WHAT WAS LIVE. `state.update_integration` built its update as
// `.set({ ...patch, updatedAt: new Date() } as never)` — a raw spread of the
// caller's record. The `where` clause constrains the row that is FOUND; the
// `set` decides what is WRITTEN. So a member or a viewer holding an integration
// in account A performed
//     state:updateIntegration { id: ownIntegration, patch: { accountId: B } }
// and the real Drizzle builder emitted
//     UPDATE integrations SET account_id = B WHERE id = … AND account_id = A
// — an ordinary product edit moving a grant row, and its known secret, into
// another account. That is a defect today and it is a FORGED AUTHORITY SOURCE
// the moment R4a mints from rows: create an integration with a known secret in
// A, move it into B, then authenticate B's ingress against a genuine row whose
// ownership changed without B's authorization.
//
// ⚠ A REAL DRIZZLE BUILDER OVER A CAPTURE DRIVER, not a chain stub. The lesson
// is R2b review round 9's, recorded in `rights-r2b-partition.test.ts`: a stub
// that ignores what it is handed cannot pin what is handed to it. This emits the
// real SQL and READS THE `SET` CLAUSE. No database.
//
// ⚠ AND THE ALLOWLIST IS AN INTERIM. The root cause is a Fenel-first violation —
// the native is declared `(id: String) -> (patch: { }) -> Maybe ({ })`, and a
// declared-empty record is what `CLAUDE.md` names outright as a lie. C1a gives
// the native explicit parameters so `accountId` is not a thing a caller can
// mention, and deletes the TypeScript allowlist in the same commit. This pin
// survives that change: it asserts the OBSERVABLE (no `account_id` in the SET),
// which is true of both the filter and the declaration.
//
// ⚠ EVERY CASE HERE WAS OBSERVED RED UNDER ITS NEUTER BEFORE IT WAS TRUSTED.
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");
spyOn(dbModule, "insertTraces").mockImplementation((async () => {}) as never);

const { loadRegistry, resetRegistryCache } = await import("./evaluator");
const { mintRequestAuthority } = await import("./authority-mint");

// ⚠ WARM THE PRODUCTION TABLE AT IMPORT, not inside the first test. Building it
// takes ~50 s on this host, and bun's default per-test timeout is 5 s — so the
// first `loadRegistry()` inside a test fails on the clock rather than on the
// assertion, and a red that is not the assertion's red is not its evidence.
loadRegistry();

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
const INTEGRATION = "11111111-1111-4111-8111-111111111111";

function roleAuthority(role: string, accountId: string) {
  return mintRequestAuthority(loadRegistry(), {
    accountId,
    role,
    membershipId: `membership-${role}`,
    subject: { $tag: "User", accountId, userId: USER },
  });
}

function ioContextFor(accountId: string, role: string) {
  return {
    accountId,
    profileId: "",
    authority: roleAuthority(role, accountId),
    callFunction: async () => null,
    dispatchAction: async () => null,
  } as never;
}

/** The `SET` list of an `UPDATE`, lowercased — everything between `set` and the
 *  `where`. Reading the whole statement would match the `WHERE` clause's own
 *  `"account_id" = $n` and pass a raw spread. */
function setClauseOf(sql: string): string {
  const lower = sql.toLowerCase();
  const start = lower.indexOf(" set ");
  const end = lower.indexOf(" where ", start);
  if (start < 0) return "";
  return lower.slice(start + 5, end < 0 ? undefined : end);
}

/** Drives one mediated leaf with a capture driver in place of the database. */
async function captureUpdate(
  action: string,
  params: Record<string, unknown>,
  role: string,
  accountId: string,
): Promise<{ statements: { sql: string; params: readonly unknown[] }[]; value: unknown }> {
  const registry = loadRegistry();
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const captured = drizzleProxy(async (sql: string, params: unknown[]) => {
    statements.push({ sql, params });
    // The row the UPDATE "returns", so the handler's Just/Nothing path is
    // exercised rather than short-circuiting on an empty result.
    return /^update/i.test(sql.trim())
      ? { rows: [[INTEGRATION, accountId, "stripe", "label", {}, {}, "active", true, null, null]] }
      : { rows: [] };
  });
  const spy = spyOn(dbModule, "getDb").mockImplementation((() => captured) as never);
  try {
    // ⚠ A REAL FRAME, because `getIOHandler` returns the MEDIATED wrapper: with
    // no authority the gate answers `authority refused … (absent)`, which is the
    // gate doing its job and not what this pin is about.
    const leaf = registry.getIOHandler(action) as (
      p: Record<string, unknown>,
      c: never,
    ) => Promise<{ value: unknown }>;
    const outcome = await leaf(params, ioContextFor(accountId, role));
    return { statements, value: outcome.value };
  } finally {
    spy.mockRestore();
  }
}

const just = (value: unknown) => ({ $tag: "Just", _0: value });
const nothing = { $tag: "Nothing" };

describe("rights R4a P21 — an ordinary integration edit cannot move the row's owner", () => {
  // ⚠ RE-AIMED BY C1a (§0.5). C0b shipped a TypeScript allowlist over an
  // undeclared `patch` blob; C1a declares the five mutable columns as native
  // PARAMETERS and deletes the allowlist, so the forgery is unrepresentable
  // rather than filtered. The observable is unchanged and both neuters produce
  // it, which is exactly why the pin survives the supersession.
  //
  // Neuter A (C0b's): restore `.set({ ...patch, updatedAt: new Date() } as never)`.
  // Neuter B (C1a's): re-declare `patch: {  }` and spread it.
  // RED for both reads:
  //   expect(received).not.toContain(expected) — Expected to not contain:
  //   "account_id" / Received: "\"account_id\" = $1, \"label\" = $2, \"updated_at\" = $3"
  // — the measured forgery, reproduced by the pin.
  for (const role of ["owner", "member", "viewer"] as const) {
    test(`a ${role} naming accountId writes no account_id`, async () => {
      const { statements } = await captureUpdate(
        "state.update_integration",
        {
          id: INTEGRATION,
          label: just("renamed"),
          // ⚠ THE FORGERY, SPELLED THE ONLY WAY IT STILL CAN BE. The native
          // declares no `accountId` parameter, so this is an extra key in the
          // marshalled record that nothing reads — which is the property under
          // test. Under either neuter it reaches the SET.
          accountId: B,
          patch: { accountId: B, label: "renamed" },
        },
        role,
        A,
      );
      const update = statements.find((s) => /^\s*update\s+"integrations"/i.test(s.sql));
      expect(update, `${role}: the UPDATE was not emitted`).toBeDefined();
      const set = setClauseOf(update!.sql);
      // THE FENCE: the owner column is not in the SET at all.
      expect(set).not.toContain("account_id");
      // …and the foreign account is not a bound parameter of the statement.
      expect(update!.params).not.toContain(B);
      // POSITIVE CONTROL: a legitimate column DID reach the SET, so the pin is
      // not bought by a handler that writes nothing.
      expect(set).toContain("label");
      expect(update!.params).toContain("renamed");
      // …and the row that is FOUND is still constrained to the caller's account.
      expect(update!.sql.toLowerCase()).toMatch(/where[\s\S]*"account_id"/);
      expect(update!.params).toContain(A);
    });
  }

  test("all five declared columns are accepted; nothing undeclared reaches the SET", async () => {
    const { statements } = await captureUpdate(
      "state.update_integration",
      {
        id: INTEGRATION,
        label: just("L"),
        credentials: just({ k: "v" }),
        config: just({ c: 1 }),
        status: just("error"),
        enabled: just(false),
        // Everything a forger would reach for, as undeclared extra keys.
        accountId: B, type: "telegram", account_id: B,
        createdAt: "1970-01-01T00:00:00.000Z", created_at: "1970-01-01T00:00:00.000Z",
        patch: { accountId: B, id: "other-id", type: "telegram" },
      },
      "owner",
      A,
    );
    const update = statements.find((s) => /^\s*update\s+"integrations"/i.test(s.sql))!;
    const set = setClauseOf(update.sql);
    for (const accepted of ["label", "credentials", "config", "status", "enabled", "updated_at"]) {
      expect(set, `declared column ${accepted} missing from SET`).toContain(`"${accepted}"`);
    }
    for (const refused of ["account_id", "created_at"]) {
      expect(set, `immutable column ${refused} reached the SET`).not.toContain(refused);
    }
    // `"id"` and `"type"` appear only as the WHERE predicate's columns, never in
    // the SET — which is what `setClauseOf` isolates.
    expect(set).not.toContain('"id"');
    expect(set).not.toContain('"type"');
    expect(update.params).not.toContain(B);
    expect(update.params).not.toContain("other-id");
    expect(update.params).not.toContain("telegram");
    expect(update.params).not.toContain("1970-01-01T00:00:00.000Z");
  });

  test("`Nothing` leaves a column alone; only `Just` writes", async () => {
    const { statements, value } = await captureUpdate(
      "state.update_integration",
      { id: INTEGRATION, label: just("L"), credentials: nothing, config: nothing,
        status: nothing, enabled: nothing },
      "owner",
      A,
    );
    const update = statements.find((s) => /^\s*update\s+"integrations"/i.test(s.sql))!;
    const set = setClauseOf(update.sql);
    expect(set).toContain('"label"');
    for (const untouched of ["credentials", "config", "status", "enabled"]) {
      expect(set, `${untouched} was written despite Nothing`).not.toContain(`"${untouched}"`);
    }
    expect((value as { $tag?: string })?.$tag).toBe("Just");
  });

  test("a malformed argument THROWS rather than being read as absence", async () => {
    // Silently treating a mis-marshalled value as "unchanged" turns a
    // marshalling bug into a dropped write — the silent-null family this repo
    // keeps rediscovering. It must be loud.
    await expect(captureUpdate(
      "state.update_integration",
      { id: INTEGRATION, label: "a bare string, not a Maybe" },
      "owner",
      A,
    )).rejects.toThrow(/expected Just\/Nothing/);
  });
});

// ---------------------------------------------------------------------------
// THE WRITER CENSUS, as a source fact rather than as a claim in a note.
//
// §0.3 says the census by grant kind found integrations to be the only hole:
// memberships set `role` only, subscriptions use an allowlist, and pages, bots,
// proxy links and publications patch the `data` jsonb and never the account
// column. This is the cheap standing form of that — a raw spread into a `.set()`
// anywhere in the runtime's state leaves is the SHAPE of the defect, so it is
// the shape the gate watches for, not one spelling of one handler.
// ---------------------------------------------------------------------------
describe("rights R4a P21 — no state leaf spreads a caller record into an UPDATE", () => {
  test("`.set({ ...` appears in no handler body", () => {
    const source = readFileSync(
      new URL("./handlers/state.ts", import.meta.url),
      "utf8",
    );
    // Comments are excluded: this file's own `// What was here:` line quotes the
    // defect, and a scan that matched it would be red on the fix.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // Neuter: restore the raw spread. RED reads: the match array is non-empty.
    const spreads = [...code.matchAll(/\.set\(\s*\{\s*\.\.\./g)];
    expect(spreads.map((m) => m[0])).toEqual([]);
    // NOT VACUOUS: the file really does contain `.set(` calls to find.
    expect(code).toContain(".set(");
  });
});
