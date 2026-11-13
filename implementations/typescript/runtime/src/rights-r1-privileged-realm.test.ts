import { describe, expect, test } from "bun:test";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { Nothing } from "@fenel/engine/type-foundation";
import { registerStateHandlers } from "./handlers/state";
import { handleIOForTest, type FunctionContext } from "./evaluator";
import { mintAuthority, type AuthorityRef } from "@fenel/engine/authority";

// ---------------------------------------------------------------------------
// rights R1 — the privileged-realm boundary at the identity leaves.
//
// WHY THESE PINS EXIST, AND WHY THEY ARE AT THIS LAYER.
//
// The 2026-09-07 audit framed the defect as "generic invocation includes
// privileged authentication functions", and the obvious repair — fence the
// `auth` module — is WRONG. `auth:issueSession` composes only `randomTokenHex`
// (a sync native), `sha256Hex` (an IO leaf) and `createSession`. NOTHING in it
// lives in the auth module. So an ordinary account body can write
//
//     createSession victimUserId victimAccountId (sha256Hex "mine") Nothing Nothing
//
// and hold a working session with no `auth:` name anywhere. Two further doors
// reach the same place: `executeInstance` runs the SEEDED `functions` row
// rather than the registry, and a member can attach a trigger to any seeded
// name. A name-layer fence closes none of them.
//
// Therefore the boundary is the LEAF, and these pins assert it at the leaf.
// A pin that asserts `/io/invoke` returns 404 would stay green with the
// mechanism broken, which is the R0.5 failure mode this workstream exists to
// end. See `workstreams/rights/briefs/r1-containment-ii.md` §4.2 and §8.
//
// DB-FREE BY CONSTRUCTION. The guard runs before each handler's dynamic
// `await import("@fenel/db")`, so the refusal path never reaches a database.
// The ADMITTED path is discriminated the same way: with the realm present, the
// handler proceeds to its OWN argument validation and fails with a DIFFERENT,
// asserted message. Two distinct errors, no database, and no stubbing of the
// thing under test.
// ---------------------------------------------------------------------------

const REFUSAL = "identity leaves require the privileged execution realm";

/** The leaves that mint an identity, mutate a credential, or read a password
 *  hash into Fenel — each with params that are INVALID for that leaf, so a call
 *  admitted by the realm guard fails at the leaf's own check rather than at the
 *  database. `ownCheck` is that check's message; leaves that answer `Nothing`
 *  for missing params instead of throwing carry `undefined`. */
const PRIVILEGED_LEAVES: ReadonlyArray<{
  readonly action: string;
  readonly ownCheck?: string;
}> = [
  { action: "state.create_session", ownCheck: "userId, accountId, tokenHash required" },
  { action: "state.get_session_by_hash" },
  { action: "state.touch_session" },
  { action: "state.delete_session_by_hash" },
  { action: "state.get_user_by_email" },
  { action: "state.get_or_create_user_by_email", ownCheck: "email required" },
  // ⚠ `state.create_membership` IS DELIBERATELY ABSENT (rights R2b, ruling 5).
  // Seven of R1's eight leaves mint sessions, read users by email, or write
  // password hashes: there is no product reason for any frame but the login
  // chain to reach them, so they keep the realm bit as defence in depth. The
  // eighth is what an account OWNER legitimately performs when inviting a
  // member — and the bit would refuse the owner. Its fence is now the GATE: the
  // owner envelope alone names it, argued on the account AND the role, which is
  // a boundary the owner can pass and a member cannot. See
  // `rights-r2b-partition.test.ts` pin 21 and the disjointness pin beside it.
  { action: "state.set_user_password_hash", ownCheck: "userId required" },
];

/** rights R2a — THE AUTHORITY HERE PERMITS EVERY LEAF UNDER TEST, ON PURPOSE.
 *  R2a's member envelope also excludes the identity leaves, so an ordinary
 *  authority would make the GATE refuse first and these pins would go green
 *  without ever reaching the realm guard they exist to observe. The two
 *  mechanisms are deliberately redundant (defence in depth until R6); a pin
 *  that cannot tell them apart is not a pin for either. */
function permissiveAuthority(): AuthorityRef {
  const reg = statefulRegistry();
  return mintAuthority(reg, {
    envelope: reg.evaluateAuthorityFunction(
      "authority:descriptorEnvelope",
      [reg.listPerformDescriptors()],
    ),
    issuer: "test",
    accountId: "rights-r1-account-a",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

const ordinaryContext = (): FunctionContext => ({
  accountId: "rights-r1-account-a",
  profileId: "",
  authority: permissiveAuthority(),
});
const privilegedContext = (): FunctionContext => ({
  accountId: "rights-r1-account-a",
  profileId: "",
  authority: permissiveAuthority(),
  realm: "privileged",
});

// Built ONCE. Registry construction dominates this file's wall time, and the
// guard under test is a per-call read of the IO context — it holds no
// registry state — so rebuilding per test would buy nothing and cost minutes.
let sharedRegistry: ReturnType<typeof createRegistry> | undefined;
function statefulRegistry() {
  if (sharedRegistry === undefined) {
    sharedRegistry = createRegistry([stdModule]);
    registerStateHandlers(sharedRegistry);
  }
  return sharedRegistry;
}

/** Runs a leaf and returns the thrown message, or `null` when it did not
 *  throw. Explicit rather than `.rejects.toThrow`, because these pins must
 *  distinguish WHICH error was raised, not merely that one was. */
async function leafError(
  action: string,
  params: Record<string, unknown>,
  ctx: FunctionContext,
): Promise<string | null> {
  const reg = statefulRegistry();
  try {
    await handleIOForTest(
      { action, params, stepPath: Nothing, letName: Nothing },
      ctx,
      reg,
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("rights R1 — identity leaves refuse the ordinary execution realm", () => {
  for (const leaf of PRIVILEGED_LEAVES) {
    test(`${leaf.action} refuses a frame with no realm`, async () => {
      const message = await leafError(leaf.action, {}, ordinaryContext());
      expect(message).toContain(REFUSAL);
    }, 180_000);
  }

  test("get_membership is deliberately NOT fenced — reading a membership is an authorization input, not an identity mutation", async () => {
    // It may still fail for its own reasons (no database in this process);
    // what is pinned is that the failure is not the realm guard.
    const message = await leafError("state.get_membership", {}, ordinaryContext());
    if (message !== null) expect(message).not.toContain(REFUSAL);
  }, 180_000);
});

describe("rights R1 — the privileged realm admits, and only the door mints it", () => {
  for (const leaf of PRIVILEGED_LEAVES) {
    if (leaf.ownCheck === undefined) continue;
    test(`${leaf.action} passes the realm guard and reaches its own validation`, async () => {
      // THE DISCRIMINATION: same call, same params, different realm ⇒
      // different error. If this ever reports the refusal text the realm
      // stopped propagating; if it reports a database error the leaf's own
      // validation was removed and this pin no longer discriminates.
      const message = await leafError(leaf.action, {}, privilegedContext());
      expect(message).toContain(leaf.ownCheck!);
      expect(message).not.toContain(REFUSAL);
    }, 180_000);
  }

  test("an ordinary frame that merely names no account does not acquire the realm", async () => {
    // The bit is not derived from the account, the profile, or any request
    // field — it is minted only by `invokeIOActionPrivileged`. A frame shaped
    // like the auth door's but lacking the bit is refused.
    const message = await leafError(
      "state.create_session",
      {},
      { accountId: "", profileId: "", authority: permissiveAuthority() },
    );
    expect(message).toContain(REFUSAL);
  }, 180_000);

  test("the realm is not forgeable through the params record", async () => {
    // Caller-supplied data must never be read as authority. `params` is
    // request data; the guard reads the frame.
    const message = await leafError(
      "state.create_session",
      { realm: "privileged", userId: "u", accountId: "a", tokenHash: "h" },
      ordinaryContext(),
    );
    expect(message).toContain(REFUSAL);
  }, 180_000);
});
