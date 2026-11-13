// ---------------------------------------------------------------------------
// rights R4a C1a — THE ACQUISITION REALM. Pins P13, P17, P22, P24.
//
// Brief: `workstreams/rights/briefs/r4a-issuance-and-durable-reauthorization.md`
// §4.3 and §4.4.
//
// WHAT C1a CLOSES. `state:findIntegrationByIdAndType`, `state:findBotByIdGlobal`
// and `state:findSubscriptionBySlug` sat in the POSITIVE general row for EVERY
// role, and each returns authentication material — integration credentials, a
// bot token and webhook secret, a subscription secret — with NO requesting-account
// predicate. Measured before this change: `Just true` for both `member` and
// `viewer`, with FOREIGN resource ids, and the dashboard invoke route hands an
// ordinary request authority to any member of any account. One authenticated
// HTTP call.
//
// The repair is not an axis. An act that argues no account cannot be judged on
// one — which `authority.fenel` had already written down about
// `findSubscriptionBySlug` and then lost when R3 was split. So it is a FENCE:
// a third fenced family excluded from every role's general row, reachable only
// under the ACQUISITION realm an ingress door holds while it finds the row it is
// about to verify against.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED UNDER ITS NEUTER BEFORE IT WAS TRUSTED.
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import { join } from "node:path";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");

// The spies go on BEFORE the evaluator is imported. `runtimeDependencies` is a
// module-scope object built from these bindings at import time, so a spy
// installed afterwards intercepts nothing - the evaluator already holds the
// original references. P18's whole observation is the CALL COUNT of the first.
let instanceInserts = [];
let traceInserts = 0;
spyOn(dbModule, "createActiveFunctionInstance").mockImplementation((async (
  accountId, fn,
) => {
  instanceInserts.push({ accountId, slug: fn && fn.name });
  return { id: "instance-" + instanceInserts.length, accountId };
}) as never);
spyOn(dbModule, "insertTraces").mockImplementation((async (rows) => {
  traceInserts += Array.isArray(rows) ? rows.length : 1;
}) as never);

// ⚠ AND A CAPTURE DRIVER FOR `getDb`, ALSO BEFORE THE IMPORT. Without it the
// durable path throws at `dependencies.getDb()` — the FIRST line of
// `callUserFunction` — BEFORE it reaches `createActiveFunctionInstance`, so
// P18's neuter (flip the door to durable) would leave the spy at zero and the
// pin GREEN. Measured: that is exactly what happened on the first attempt. The
// driver answers every statement with no rows; nothing here asserts on SQL.
const captureDriver = drizzleProxy(async () => ({ rows: [] }));
spyOn(dbModule, "getDb").mockImplementation((() => captureDriver) as never);

const { loadRegistry, resetRegistryCache, invokeIOActionEphemeral } = await import("./evaluator");
const { mintAcquisitionAuthority, mintRequestAuthority } = await import("./authority-mint");
const { authenticateAuthority } = await import("@fenel/engine/authority");

// Building the production table takes ~50 s; bun's per-test timeout is 5 s.
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
const LONG = 180_000;

const JUST_TRUE = { $tag: "Just", _0: true };

function act(descriptor: string, args: unknown[] = [], fields: unknown[] = []) {
  return { $tag: "Act", descriptor, args, fields };
}

function permits(envelope: unknown, descriptor: string, args: unknown[] = []): unknown {
  return loadRegistry().evaluateAuthorityFunction("authority:permits", [envelope, act(descriptor, args)]);
}

function roleEnvelopeFor(role: string, accountId: string): unknown {
  const authority = mintRequestAuthority(loadRegistry(), {
    accountId, role, membershipId: `membership-${role}`,
    subject: { $tag: "User", accountId, userId: USER },
  });
  return authenticateAuthority(authority)!.envelope;
}

/** The PRODUCTION acquisition envelope, via the real mint — so the storage index
 *  it carries is the one `authority-mint.ts` computes, not one the test built. */
function acquisitionEnvelopeFor(partition: string): unknown {
  return authenticateAuthority(mintAcquisitionAuthority(loadRegistry(), partition))!.envelope;
}

// ---------------------------------------------------------------------------
// P13 — the admitted call set is a SOURCE LITERAL, compared to the Fenel list
// read through the seam, and no member of it is a storage WRITE.
// ---------------------------------------------------------------------------

/** ⚠ A SOURCE LITERAL (R0.5 instrument law). Re-deriving this from the Fenel
 *  module would make the pin assert that a list equals itself. */
const ACQUISITION_SET = [
  // Discovery — secret-bearing, argues no account.
  "state:findIntegrationByIdAndType",
  "state:findBotByIdGlobal",
  "state:findSubscriptionBySlug",
  "state:findAccountBySlug",
  // Public-surface reads — account-handle-argued BY SLUG.
  "state:getPageBySlug",
  "state:findProxyLinkByAccountSlugAndTag",
  // Published-form discovery.
  "types:embedResolve",
  "state:getType",
  "state:getTypeById",
  "state:listTypes",
  "state:listInstancesByName",
  "dispatch:listSystemEntities",
  // …and the resolver's OWN gated bodies. `registerFenelBodyDispatchers`
  // registers every bodied function as a perform descriptor, so each helper
  // `embedResolve` calls is judged on its own name — naming only the entry point
  // left discovery refused at the first hop. Two paths, measured separately
  // against real staging rows: a MISS takes the fallback chain, a HIT takes the
  // bind-and-publication chain, and the set is their union.
  "types:resolveType",
  "types:resolveTypeByCodeNameOrSystem",
  "types:resolveTypeByCodeName",
  "types:resolveTypeBySystemEntity",
  "types:embedBindById",
  "types:embedRefuseGrantStore",
  "types:embedRequirePublication",
  // Verification, the two SNS transports, and the pure formatters.
  "crypto:verifyTelegramSecret",
  "crypto:verifyStripeSignature",
  "crypto:verifyCalendlySignature",
  "crypto:sha256Hex",
  "std:escapeHtml",
  // The two OUTBOUND transports. They are a fenced family of their own
  // (`outboundFetchDescriptors`) as well as acquisition members, because they
  // fetch a URL the CALLER names with no format constraint — unlike
  // `http_request`, which enforces `web+secure+noprivate` on the first hop AND
  // the redirect target. See the P24 block.
  "emailWebhooks:snsFetchSigningCertificate",
  "emailWebhooks:snsConfirmSubscription",
];

/** The two storage acts the pin names explicitly: one read, one write. */
const STORAGE_READ = "storage:dbLoad";
const STORAGE_WRITE = "storage:dbStore";

describe("rights R4a P13 — the acquisition set is measured, and it contains no write", () => {
  test("the Fenel list equals the source literal", () => {
    // Neuter: add `storage:dbStore` to `acquisitionVerifyDescriptors`.
    // RED reads: the arrays differ by that one element.
    const fenel = loadRegistry().evaluateAuthorityFunction("authority:acquisitionDescriptors", [0]) as string[];
    expect([...fenel].sort()).toEqual([...ACQUISITION_SET].sort());
    // NOT VACUOUS: the Fenel list really is non-trivial.
    expect(fenel.length).toBeGreaterThan(20);
  });

  test("every member is a registered descriptor — the set names nothing imaginary", () => {
    const all = new Set(loadRegistry().listPerformDescriptors());
    for (const descriptor of ACQUISITION_SET) {
      expect(all.has(descriptor), `${descriptor} is not a registered perform descriptor`).toBe(true);
    }
  }, LONG);

  test("the envelope permits the read side and REFUSES the write side", () => {
    // Neuter (the second half of P13): add `storage:dbStore` to the Fenel list.
    // RED reads: `Just true` for the write.
    const envelope = acquisitionEnvelopeFor(A);
    // The storage READ row is argued positionally on the partition.
    expect(permits(envelope, STORAGE_READ, [A])).toEqual(JUST_TRUE);
    // …and only on the partition: a foreign account is refused by the axis.
    expect(permits(envelope, STORAGE_READ, [B])).not.toEqual(JUST_TRUE);
    // The WRITE is in no row at all.
    expect(permits(envelope, STORAGE_WRITE, [A])).not.toEqual(JUST_TRUE);
    expect(permits(envelope, STORAGE_WRITE, [B])).not.toEqual(JUST_TRUE);
    // And nothing outside the measured set is reachable, even a harmless read.
    expect(permits(envelope, "state:listPages")).not.toEqual(JUST_TRUE);
    expect(permits(envelope, "state:createSession")).not.toEqual(JUST_TRUE);
    expect(permits(envelope, "state:createMembership")).not.toEqual(JUST_TRUE);
  }, LONG);

  test("`\"\"` is not an account: a partition-less handle reads only `\"\"`", () => {
    // ⚠ THE PRECISE CLAIM, narrower than the obvious one (corrected by
    // adversarial review, which found three prose sites asserting the stronger
    // and false version while this assertion already asserted the true one).
    // A `""` door does NOT "refuse every storage read": an act performed under
    // it argues the leaf context's account, which is also `""`, and the `{""}`
    // axis ADMITS that. What contains it is that `""` selects no rows — it is
    // not an account id any database row carries. The checker's part is the
    // FIRST assertion: a real account is refused.
    const envelope = acquisitionEnvelopeFor("");
    expect(permits(envelope, STORAGE_READ, [A])).not.toEqual(JUST_TRUE);
    expect(permits(envelope, STORAGE_READ, [""])).toEqual(JUST_TRUE);
    // The no-axis row is unaffected — discovery still works with no partition,
    // which is what every webhook lane needs.
    expect(permits(envelope, "state:findBotByIdGlobal")).toEqual(JUST_TRUE);
  }, LONG);
});

// ---------------------------------------------------------------------------
// P17 — the adversarial cases come from an INDEPENDENT census, not from the
// Fenel list, so removing a descriptor from the family does not also remove its
// test case.
// ---------------------------------------------------------------------------

/** The independent instrument: which registered IO handlers reach a table that
 *  carries authentication material, and carry NO account coordinate?
 *
 *  ⚠ IT DOES NOT READ `authority.fenel`. That is the whole point — the first
 *  draft of a census like this one enumerated its own answer, so deleting a name
 *  made it check less and stay green. This one starts from the SCHEMA (which
 *  columns hold a secret), walks the db query layer (which exported query
 *  touches such a table), and then walks the handler bodies. */
function independentDiscoveryCensus(): { name: string; carriers: string[] }[] {
  const strip = (s: string) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const word = (needle: string) => new RegExp("\\b" + needle + "\\b");
  const tsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...tsFiles(p));
      else if (e.name.endsWith(".ts") && !/\.(test|fixture)\./.test(e.name)) out.push(p);
    }
    return out;
  };
  const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const SCHEMA = join(here, "..", "..", "db", "src", "schema");
  const QUERIES = join(here, "..", "..", "db", "src", "queries");
  const HANDLERS = join(here, "handlers");

  const SECRET_COL = /credentials|webhookSecret|passwordHash|tokenHash|secret|token|apiKey/i;
  const carriers = new Map<string, string>();
  for (const f of tsFiles(SCHEMA)) {
    const src = readFileSync(f, "utf8");
    const pattern = /export const (\w+) = pgTable\(\s*"([^"]+)"/g;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      let depth = 0, cursor = src.indexOf("(", m.index), seen = false;
      for (; cursor < src.length; cursor += 1) {
        if (src[cursor] === "(") { depth += 1; seen = true; }
        else if (src[cursor] === ")") { depth -= 1; if (seen && depth === 0) break; }
      }
      const body = strip(src.slice(m.index, cursor + 1));
      const cols = [...body.matchAll(/^\s*(\w+):\s*\w+\(/gm)].map((c) => c[1]!).filter((c) => SECRET_COL.test(c));
      if (cols.length > 0) carriers.set(m[1]!, m[2]!);
    }
  }
  // A bot lives in `entity_instances`, and its token and webhook secret are
  // inside the `data` jsonb — which no column scan can see. Named explicitly.
  carriers.set("entityInstances", "entity_instances");

  const reaching = new Set<string>();
  for (const f of tsFiles(QUERIES)) {
    const src = readFileSync(f, "utf8");
    const pattern = /export (?:async )?function (\w+)/g;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      let depth = 0, cursor = src.indexOf("{", m.index), seen = false;
      for (; cursor < src.length; cursor += 1) {
        if (src[cursor] === "{") { depth += 1; seen = true; }
        else if (src[cursor] === "}") { depth -= 1; if (seen && depth === 0) break; }
      }
      const body = strip(src.slice(m.index, cursor + 1));
      if ([...carriers.keys()].some((t) => word(t).test(body))) reaching.add(m[1]!);
    }
  }

  const found: { name: string; carriers: string[] }[] = [];
  for (const f of tsFiles(HANDLERS)) {
    const src = readFileSync(f, "utf8");
    const pattern = /reg\.registerIOHandler\(\s*"([^"]+)"/g;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      const open = src.indexOf("{", src.indexOf("=>", m.index + m[0].length));
      if (open < 0) continue;
      let depth = 0, cursor = open;
      for (; cursor < src.length; cursor += 1) {
        if (src[cursor] === "{") depth += 1;
        else if (src[cursor] === "}") { depth -= 1; if (depth === 0) break; }
      }
      const code = strip(src.slice(open, cursor + 1));
      if (/ctx\.accountId/.test(code)) continue;
      if (/params\[\s*"account/i.test(code)) continue;
      const direct = [...carriers.entries()].filter(([t]) => word(t).test(code)).map(([, table]) => table);
      const via = [...reaching].filter((q) => word(q).test(code));
      if (direct.length === 0 && via.length === 0) continue;
      found.push({ name: m[1]!, carriers: [...new Set([...direct, ...via])] });
    }
  }
  return found;
}

/** Handlers the independent census reports that are NOT discovery, with the
 *  reason each is claimed. A censused handler claimed by nothing is RED. */
const CENSUS_CLAIMED_ELSEWHERE: Record<string, string> = {
  // The identity leaves — fenced by `sessionLeafDescriptors` and additionally
  // carrying R1's privileged-realm bit.
  "state.get_session_by_hash": "identity leaf",
  "state.touch_session": "identity leaf",
  "state.delete_session_by_hash": "identity leaf",
  "state.get_user_by_email": "identity leaf",
  "state.set_user_password_hash": "identity leaf",
  // Instrument over-reporting, each stated rather than filtered away:
  // `entity_instances` carries every entity kind, so "reaches it" is far wider
  // than "reaches a bot secret"; and two handler families merely mention the
  // WORDS the column scan looks for.
  "dispatch.lookup_all": "entity_instances is a shared carrier — dispatch rows, not bot secrets",
  "notion.retrieveUser": "a Notion API path segment, not this repository's `users` table",
  "notion.listUsers": "a Notion API path segment, not this repository's `users` table",
  "notion.retrieveMe": "a Notion API path segment, not this repository's `users` table",
  "payments.create_stripe_checkout_session": "a Stripe checkout SESSION, not this repository's `sessions` table",
};

/** Dotted action -> canonical descriptor, for the three discovery members the
 *  census is expected to find. Source literals. */
const CENSUS_DISCOVERY: Record<string, string> = {
  "state.find_integration_by_id_and_type": "state:findIntegrationByIdAndType",
  "state.find_bot_by_id_global": "state:findBotByIdGlobal",
  "state.find_subscription_by_slug": "state:findSubscriptionBySlug",
};

describe("rights R4a P17 — the discovery family, re-derived independently", () => {
  // ⚠ THE CLAIM IS SCOPED TO WHAT THE INSTRUMENT SCANS, and that scope is
  // narrower than "no fifth credential reader exists anywhere" (corrected by
  // adversarial review). It walks `runtime/src/handlers` only, and it SKIPS any
  // handler body that mentions the frame account ANYWHERE — so a handler that
  // reads globally by id and compares the account AFTERWARDS is invisible to it
  // (`state.get_subscription` is exactly that shape, and is safe because the
  // comparison is there). Nothing is missed today: `providers.ts` filters
  // integrations by account and no `ffi/` leaf reads a secret-bearing table.
  test("the census finds exactly the expected discovery handlers, and nothing unclaimed", () => {
    const censused = independentDiscoveryCensus();
    // NOT VACUOUS.
    expect(censused.length).toBeGreaterThan(5);
    const unclaimed = censused
      .map((row) => row.name)
      .filter((name) => !(name in CENSUS_CLAIMED_ELSEWHERE) && !(name in CENSUS_DISCOVERY))
      .sort();
    // A new account-free handler reaching a secret-bearing carrier is RED here
    // whether or not anyone remembered to fence it.
    expect(unclaimed).toEqual([]);
    for (const dotted of Object.keys(CENSUS_DISCOVERY)) {
      expect(censused.some((row) => row.name === dotted), `${dotted} missing from the census`).toBe(true);
    }
    // ⚠ `LONG`, because the census walks three source trees and measured 23.6 s
    // on a cold filesystem — past bun's 5 s default. It FAILED that way once, and
    // a red that is the clock is not the assertion's evidence.
  }, LONG);

  test("member and viewer are REFUSED on each censused discovery act, with a foreign id", () => {
    // Neuter: remove one descriptor from `discoveryDescriptors`.
    // RED reads: `Just true` for the member on that descriptor — AND the census
    // above still lists it, which is what makes the two halves independent.
    for (const role of ["owner", "member", "viewer"]) {
      const envelope = roleEnvelopeFor(role, A);
      for (const descriptor of Object.values(CENSUS_DISCOVERY)) {
        // A FOREIGN id in the arguments, because that is the attack: the
        // descriptor argues no account, so the id is the only coordinate.
        expect(permits(envelope, descriptor, [B, "stripe"]), `${role} / ${descriptor}`).not.toEqual(JUST_TRUE);
        expect(permits(envelope, descriptor, []), `${role} / ${descriptor} (no args)`).not.toEqual(JUST_TRUE);
      }
      // THE POSITIVE CONTROL: the same role, the same envelope, an ordinary
      // general-row act — still permitted. The refusals above are the fence.
      expect(permits(envelope, "state:listPages"), `${role} control`).toEqual(JUST_TRUE);
    }
  }, LONG);

  test("`state:findAccountBySlug` is fenced too, on its own stated ground", () => {
    // It is in the family because it returns a foreign account's arbitrary
    // private configuration — NOT because a current config value was measured to
    // hold a credential, which this repository does not claim.
    for (const role of ["owner", "member", "viewer"]) {
      expect(permits(roleEnvelopeFor(role, A), "state:findAccountBySlug", ["other-account"]), role)
        .not.toEqual(JUST_TRUE);
    }
    expect(permits(acquisitionEnvelopeFor(""), "state:findAccountBySlug", ["other-account"]))
      .toEqual(JUST_TRUE);
  }, LONG);
});

// ---------------------------------------------------------------------------
// P22 — the collector relay reads its OWN account's bot, and a foreign bot id
// produces ZERO provider calls through every product wrapper.
//
// ⚠ THE TRAP THIS PIN EXISTS FOR. Giving the collector's helper an ACQUISITION
// authority instead of partitioning it at the leaf would make the global read
// succeed again: the foreign-bot operation would survive the fence and P17 would
// STILL BE GREEN. Acquisition is for ingress discovery, where there is no
// account yet. Here there is one — the frame's.
// ---------------------------------------------------------------------------

describe("rights R4a P22 — the collector cannot relay with a foreign bot's token", () => {
  test("a foreign bot id produces no provider call, and the read carries the FRAME's account", async () => {
    // ⚠ THE NEUTER HAD TO BE CHOSEN CAREFULLY. "Restore the nested
    // `invokeIOActionAs(…, state:findBotByIdGlobal)`" does NOT redden this on
    // its own: that descriptor is fenced now, so the read refuses and the relay
    // makes no call either way — a green that proves nothing. The neuter that
    // reproduces the defect is the one a future session would actually write:
    // the leaf reaching the GLOBAL db helper directly, which is "just a query in
    // an IO leaf" and bypasses the descriptor fence entirely.
    //
    // Neuter: `findBotGlobal` calls `findBotByIdGlobal(botId)` instead of
    // `findBotById(accountId, botId)`.
    // RED reads: a `fetch` to `https://api.telegram.org/bot<FOREIGN TOKEN>/answerCallbackQuery`.
    const registry = loadRegistry();
    const FOREIGN_BOT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const FOREIGN_TOKEN = "111:FOREIGN-BOT-TOKEN";
    const scopedReads: [string, string][] = [];
    // The two db queries, with their REAL semantics: the global one finds the
    // foreign bot and hands back its token; the account-scoped one does not,
    // because the row belongs to another account.
    const globalSpy = spyOn(dbModule, "findBotByIdGlobal").mockImplementation((async (id: string) => (
      id === FOREIGN_BOT
        ? { id, accountId: B, token: FOREIGN_TOKEN, enabled: true, webhookSecret: null }
        : null
    )) as never);
    const scopedSpy = spyOn(dbModule, "findBotById").mockImplementation((async (accountId: string, id: string) => {
      scopedReads.push([accountId, id]);
      return accountId === B && id === FOREIGN_BOT
        ? { id, accountId: B, token: FOREIGN_TOKEN, enabled: true, webhookSecret: null }
        : null;
    }) as never);
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const authority = mintRequestAuthority(registry, {
        accountId: A, role: "member", membershipId: "m",
        subject: { $tag: "User", accountId: A, userId: USER },
      });
      const ctx = {
        accountId: A, profileId: "", authority,
        callFunction: async () => null, dispatchAction: async () => null,
      } as never;
      const leaf = registry.getIOHandler("telegram.ack_callback_query") as (
        p: Record<string, unknown>, c: never,
      ) => Promise<{ value: unknown }>;
      await leaf({ botId: FOREIGN_BOT, callbackQueryId: "q1" }, ctx).catch(() => undefined);

      // NO provider call at all, and in particular none carrying the token.
      expect(calls.filter((u) => u.includes("api.telegram.org"))).toEqual([]);
      expect(calls.some((u) => u.includes(FOREIGN_TOKEN))).toBe(false);
      // THE POSITIVE EVIDENCE: the read happened, and it carried the FRAME's
      // account rather than no account — so the relay was partitioned rather
      // than merely broken.
      expect(scopedReads).toEqual([[A, FOREIGN_BOT]]);
      // …and the global helper was never reached.
      expect(globalSpy).not.toHaveBeenCalled();

      // AND THE SAME-ACCOUNT CONTROL: the identical call for a bot the frame's
      // account owns DOES reach the provider, so the refusal above is the
      // partition and not a dead code path.
      calls.length = 0;
      scopedReads.length = 0;
      const ownCtx = {
        accountId: B, profileId: "",
        authority: mintRequestAuthority(registry, {
          accountId: B, role: "member", membershipId: "m",
          subject: { $tag: "User", accountId: B, userId: USER },
        }),
        callFunction: async () => null, dispatchAction: async () => null,
      } as never;
      await leaf({ botId: FOREIGN_BOT, callbackQueryId: "q1" }, ownCtx).catch(() => undefined);
      expect(scopedReads).toEqual([[B, FOREIGN_BOT]]);
      expect(calls.filter((u) => u.includes("api.telegram.org"))).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
      globalSpy.mockRestore();
      scopedSpy.mockRestore();
    }
  }, LONG);

  test("the collector reads its bot ACCOUNT-SCOPED — the global descriptor is gone from its source", () => {
    // A source fact rather than a claim in a note: the four sites named by the
    // brief must not reach the global read at all.
    const source = readFileSync(new URL("./handlers/telegram-collector.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toContain("state:findBotByIdGlobal");
    expect(code).not.toContain("state.find_bot_by_id_global");
    // …and it reaches the account-scoped read instead. NOT VACUOUS.
    expect(code).toContain("findAccountBotRowStateLeaf");
    // ⚠ AND IT DOES NOT REACH THE DATABASE DIRECTLY. `telegram-collector.ts` was
    // drained of direct database access by ts-elimination-completion Phases 2-7
    // and `audit-effects.ts`'s `direct-db-outside-leaf` rule does not allowlist
    // it; putting the read back inline would re-grandfather a file that arc
    // emptied, and the audit gate would go from 0 findings to 1.
    expect(code).not.toContain("@fenel/db");
  });
});

// ---------------------------------------------------------------------------
// P24 — both SNS outbound sites are mediated acts.
// ---------------------------------------------------------------------------

describe("rights R4a P24 — the two SNS outbound sites perform through the gate", () => {
  test("both are registered perform descriptors and both are in the acquisition set", () => {
    const registry = loadRegistry();
    const all = new Set(registry.listPerformDescriptors());
    for (const descriptor of [
      "emailWebhooks:snsFetchSigningCertificate",
      "emailWebhooks:snsConfirmSubscription",
    ]) {
      expect(all.has(descriptor), `${descriptor} is not mediated`).toBe(true);
      expect(permits(acquisitionEnvelopeFor(""), descriptor), descriptor).toEqual(JUST_TRUE);
      // …and in NO role's envelope. ⚠ THIS ASSERTION IS THE REPAIR OF A HOLE
      // C1a ITSELF OPENED, found by adversarial review: bringing the two SNS
      // transports under `perform` made them DESCRIPTORS, and a new descriptor
      // lands in the POSITIVE general row for every role by construction — so
      // owner, member AND viewer each gained an unconstrained URL fetch. A
      // `viewer` could post `emailWebhooks:snsFetchSigningCertificate` with
      // `http://169.254.169.254/…` to the dashboard invoke route and read the
      // response body. `authority:outboundFetchDescriptors` is the fourth fenced
      // family that closes it.
      //
      // Neuter: drop `outboundFetchDescriptors` from `authorityFencedDescriptors`.
      // RED reads: `Just true` for the viewer on both leaves.
      for (const role of ["owner", "member", "viewer"]) {
        expect(permits(roleEnvelopeFor(role, A), descriptor), `${role} / ${descriptor}`)
          .not.toEqual(JUST_TRUE);
      }
    }
  }, LONG);

  test("the api route reaches the transport through the gate, never `fetch` directly", () => {
    // Neuter: restore `verifySnsEnvelope` / `confirmSnsSubscription` as the
    // route's defaults. RED reads: the source no longer mentions the mediated
    // descriptors, and a bare default verifier is back.
    const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const source = readFileSync(join(here, "..", "..", "api", "src", "routes", "ses-webhook.ts"), "utf8");
    const code = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).toContain("emailWebhooks:snsFetchSigningCertificate");
    expect(code).toContain("emailWebhooks:snsConfirmSubscription");
    expect(code).toContain("invokeIOActionEphemeral");
    // The two un-mediated defaults are no longer the route's fallbacks.
    expect(code).not.toContain("dependencies.verify ?? verifySnsEnvelope");
    expect(code).not.toContain("dependencies.confirm ?? confirmSnsSubscription");
  });

  test("the leaves refuse under an ordinary anonymous envelope", async () => {
    // A mediated act is judged; an empty envelope permits nothing.
    const registry = loadRegistry();
    const empty = registry.evaluateAuthorityFunction("authority:emptyEnvelope", [0]);
    for (const descriptor of [
      "emailWebhooks:snsFetchSigningCertificate",
      "emailWebhooks:snsConfirmSubscription",
    ]) {
      expect(permits(empty, descriptor), descriptor).not.toEqual(JUST_TRUE);
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// The DOOR itself: it accepts only an acquisition authority, and there is no
// fallback from a refusal to a product mint.
// ---------------------------------------------------------------------------

describe("rights R4a — the acquisition door", () => {
  test("it refuses any authority that is not an acquisition handle", async () => {
    const request = mintRequestAuthority(loadRegistry(), {
      accountId: A, role: "owner", membershipId: "m",
      subject: { $tag: "User", accountId: A, userId: USER },
    });
    await expect(
      invokeIOActionEphemeral(request, A, null, "state:findBotByIdGlobal", { botId: "x" }),
    ).rejects.toThrow(/accepts only an acquisition authority/);
  }, LONG);

  test("the acquisition handle's SELECTION account is null, not the partition", () => {
    // ⚠ The trap §4.4 names: conflating the lookup coordinate with the
    // selection coordinate would let a URL segment choose which account's
    // installed source modules an unauthenticated request executes against.
    // Neuter: pass `accountId: partition` in `mintAcquisitionAuthority`.
    // RED reads: `Expected: null / Received: "aaaaaaaa-…"`.
    const record = authenticateAuthority(mintAcquisitionAuthority(loadRegistry(), A))!;
    expect(record.accountId).toBeNull();
    expect(record.issuer).toBe("acquisition");
    expect(record.grant).toBeNull();
    expect(record.principal).toBeNull();
  }, LONG);
});

// ---------------------------------------------------------------------------
// P18 — THE BODIED WITNESS. Discovery is not read-only: `types:embedResolve` is
// a Fenel BODY, and under the durable path a body inserts a `function_instances`
// row and traces. Those writes live in the EVALUATOR and are not `storage:dbStore`
// acts, so a descriptor-only fence stays green while discovery creates instances
// under a principal the request has not yet acquired.
// ---------------------------------------------------------------------------

describe("rights R4a P18 — the acquisition door persists nothing", () => {
  test("the bodied witness creates zero instance rows and zero trace rows", async () => {
    // Neuter: set `persistence: "durable"` on the door's `childCtx`, keeping the
    // partition. RED reads: `instanceInserts` is non-empty — a row for
    // `types:embedResolve` under the caller-supplied partition.
    instanceInserts = [];
    traceInserts = 0;
    const acquire = mintAcquisitionAuthority(loadRegistry(), A);
    // A slug that resolves to nothing: the body still RUNS — that is the point.
    // What must not happen is a persisted trace of it.
    await invokeIOActionEphemeral(acquire, A, null, "types:embedResolve", {
      slug: "no-such-published-type",
    }).catch(() => undefined);
    expect(instanceInserts).toEqual([]);
    expect(traceInserts).toBe(0);
  }, LONG);

  test("THE PARTITION REACHES THE LEAF, and the envelope is still the authority's", async () => {
    // The two coordinates, separated. The door's `partition` argument becomes
    // the leaf context's `accountId`; the ENVELOPE comes from the authority. So
    // a handle minted for A, driven with partition B, must be REFUSED at the
    // storage read — the read is argued on B and the axis names A. That is a
    // direct observation that the door did not derive both from one place, which
    // is exactly what `invokeIOActionAs` does and what this door must not.
    //
    // Neuter: take the leaf context's `accountId` from `record.accountId`
    // instead of from `partition` (i.e. do what `invokeIOActionAs` does).
    //
    // ⚠ AND THE RED COMES FROM THE SECOND ASSERTION, NOT THE FIRST — an earlier
    // draft of this comment said the opposite and adversarial review corrected
    // it. Under that neuter the leaf account is `record.accountId ?? ""`, which
    // is `""` for every acquisition handle, so the FOREIGN-partition drive is
    // still refused by the `{A}` axis and its assertion stays green. What breaks
    // is the OWN-partition control: it also argues `""`, is also refused, and
    // fails `not.toMatch`. Observed:
    //   Expected substring or pattern: not /authority refused/i
    //   Received: "perform: authority refused \"storage:memoryLoadTypeByName\" (refused)"
    const acquireA = mintAcquisitionAuthority(loadRegistry(), A);
    const messageOf = async (partition: string) => {
      try {
        await invokeIOActionEphemeral(acquireA, partition, null, "types:embedResolve", {
          slug: "anything",
        });
        return "";
      } catch (error) { return String((error as Error)?.message ?? error); }
    };
    // A handle minted for A, driven with partition B: REFUSED at the storage
    // read, because the read is argued on B and the axis names A.
    expect(await messageOf(B)).toMatch(/authority refused/i);
    // …and the SAME handle with its OWN partition is NOT refused. It cannot be
    // asserted to RESOLVE here — CI has no database and `state:listTypes` needs
    // one — so the assertion is the one that is actually about the envelope:
    // whatever goes wrong, it is not a refusal. A missing `DATABASE_URL` is not.
    expect(await messageOf(A)).not.toMatch(/authority refused/i);
  }, LONG);
});

// ---------------------------------------------------------------------------
// P23 — PUBLISHED-FORM DISCOVERY, and why a missing descriptor is INVISIBLE.
//
// THE DEFECT SHAPE THIS PIN EXISTS FOR. `bindPublishedType` in
// `api/src/routes/forms.ts` wraps the resolve in `try { … } catch { return null }`
// and every null renders as one indistinguishable 404 — which is CORRECT (the
// alternative is an existence oracle for an account's private schema roster) and
// is exactly what makes a missing acquisition descriptor silent: the refusal
// arrives as "Form not found". So the guard cannot be a live 404 check. It is
// that every descriptor the resolver transitively reaches IS in the admitted
// set, derived from the RESOLVER's OWN SOURCE rather than from the Fenel list.
// ---------------------------------------------------------------------------

describe("rights R4a P23 — every act published-form discovery reaches is admitted", () => {
  // ⚠ WHY THIS IS NOT A LIVE 404 CHECK. `bindPublishedType` in
  // `api/src/routes/forms.ts` wraps the resolve in `try { … } catch { return null }`
  // and renders every null as one indistinguishable 404 — which is CORRECT (the
  // alternative is an existence oracle for an account's private schema roster)
  // and is exactly what makes a missing acquisition descriptor SILENT: the
  // refusal arrives as "Form not found". So the guard has to catch the refusal
  // itself, and separately catch a helper being ADDED to the chain.
  //
  // ⚠ AND THE SET IS BIGGER THAN LEAVES. `registerFenelBodyDispatchers` registers
  // EVERY bodied function as a perform descriptor, so each helper `embedResolve`
  // calls is judged on its own name. Naming only the entry point left discovery
  // refused at the FIRST hop — measured:
  //   perform: authority refused "types:resolveType" (refused)

  /** The resolver's PURE helpers: reachable from `embedResolve`, never gated,
   *  because they yield no IO (a `find`/`filter`/`map` over values already in
   *  hand). If one of these ever reaches a leaf it must move into the Fenel
   *  closure list, and the equality below is what forces that decision. */
  //
  // ⚠ `selectResolvedTypeCodeableStep` IS IN THIS LIST BECAUSE THIS PIN PUT IT
  // THERE. The runtime measurement never demanded it — it is the fold step of
  // `selectResolvedTypeCodeables`, a pure `if`/`case` over values already in hand
  // — but the static walk reaches it, and the disagreement is exactly the
  // decision the equality is meant to force. A helper that later grows an IO call
  // makes the runtime half red; a helper that is merely ADDED makes this half red.
  const PURE_HELPERS = [
    "resolveTypeCodeableRow",
    "selectResolvedTypeCodeables",
    "selectResolvedTypeCodeableStep",
  ];

  /** Every identifier in a Fenel body, as a set. */
  function identifiersIn(body: string): Set<string> {
    return new Set(body.split(/[^A-Za-z0-9]+/));
  }

  function resolverSource(): string {
    const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    return readFileSync(
      join(here, "..", "..", "..", "..", "fenel", "modules", "types", "resolve.fenel"), "utf8",
    );
  }

  test("the Fenel closure list is exactly the chain's gated members", () => {
    // Neuter: drop any name from `acquisitionFormsClosureDescriptors`.
    // RED reads: the two sorted arrays differ by that name.
    const source = resolverSource();
    const code = source.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

    // Every function this FILE declares, by its `name :` signature line.
    const declared = new Set(
      [...code.matchAll(/^([a-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]!),
    );
    // Its bodies, keyed by name, so reachability is over real call sites.
    const bodies = new Map<string, string>();
    for (const m of code.matchAll(/^([a-z][A-Za-z0-9]*)((?:\s+[a-z_][A-Za-z0-9_]*)*)\s*=\s*/gm)) {
      const name = m[1]!;
      const from = m.index! + m[0].length;
      const nextDecl = code.slice(from).search(/\n[a-z][A-Za-z0-9]*\s*[:=]/);
      bodies.set(name, code.slice(from, nextDecl < 0 ? undefined : from + nextDecl));
    }
    // NOT VACUOUS.
    expect(declared.has("embedResolve")).toBe(true);
    expect(bodies.size).toBeGreaterThan(8);

    // The transitive closure from the entry point, over this file's own names.
    const reachable = new Set<string>();
    const queue = ["embedResolve"];
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      for (const candidate of declared) {
        if (candidate === name || reachable.has(candidate)) continue;
        // Tokenised, not regexed: a word-boundary escape inside a string literal
        // is one backslash away from a BACKSPACE, and that mistake reads as
        // "nothing is reachable" — a green that proves nothing.
        if (identifiersIn(bodies.get(name) ?? "").has(candidate)) queue.push(candidate);
      }
    }
    reachable.delete("embedResolve");
    for (const pure of PURE_HELPERS) reachable.delete(pure);

    const fenelClosure = loadRegistry().evaluateAuthorityFunction(
      "authority:acquisitionFormsClosureDescriptors", [0],
    ) as string[];
    expect([...fenelClosure].sort())
      .toEqual([...reachable].map((n) => `types:${n}`).sort());
  }, LONG);

  test("driving the real chain raises no AUTHORITY refusal", async () => {
    // The runtime half. It cannot assert a successful resolve — CI has no
    // database and `listSystemInstances` needs one — so it asserts the thing
    // that IS the subject: whatever goes wrong, it is not the ENVELOPE. A
    // missing descriptor produces `AuthorityRefused`, which this catches; a
    // missing `DATABASE_URL` does not.
    //
    // Neuter: drop `types:resolveType` from `acquisitionFormsClosureDescriptors`.
    // RED reads:
    //   expect(received).not.toMatch(expected) — Received:
    //   'perform: authority refused "types:resolveType" (refused)'
    const acquire = mintAcquisitionAuthority(loadRegistry(), A);
    let message = "";
    try {
      await invokeIOActionEphemeral(acquire, A, null, "types:embedResolve", { slug: "CFApplication" });
    } catch (error) {
      message = String((error as Error)?.message ?? error);
    }
    expect(message).not.toMatch(/authority refused/i);
  }, LONG);

  test("THE KEY IS `slug`, and the route passes it", () => {
    // The live defect this phase found. `embedResolve` now DECLARES its
    // parameter, so the contract is stated rather than inferred from a binder —
    // and the route has to agree with it. Measured against staging before the
    // repair: `{"slug":"CFApplication"}` resolved, `{"name":"CFApplication"}` did
    // not, and every `/forms/:slug` request 404'd.
    expect(resolverSource()).toContain("embedResolve : (slug: String)");
    const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const route = readFileSync(join(here, "..", "..", "api", "src", "routes", "forms.ts"), "utf8");
    const call = route.slice(route.indexOf('"types:embedResolve"'));
    expect(call.slice(0, 120)).toContain("slug,");
    expect(call.slice(0, 120)).not.toContain("name: slug");
  });

  test("a refusal from the door is a THROW, so only the route's catch hides it", async () => {
    const acquire = mintAcquisitionAuthority(loadRegistry(), A);
    await expect(
      invokeIOActionEphemeral(acquire, A, null, "state:createSession", { x: 1 }),
    ).rejects.toThrow();
  }, LONG);
});
