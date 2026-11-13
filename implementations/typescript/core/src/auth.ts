// ---------------------------------------------------------------------------
// Authentication — token issuance, hashing, and Subject construction.
//
// Phase 12c-core sub-step 3 — the orchestration lives in
// fenel/modules/auth/session.fenel as 6 async Fenel bodies (issueSession +
// resolveToken + revokeToken + setPassword + loginWithPassword +
// bootstrapAdmin), each composing the auth substrate (state:create_session
// + state:get_session_by_hash + state:touch_session +
// state:delete_session_by_hash + state:get_user_by_email +
// state:get_or_create_user_by_email + state:get_membership +
// state:create_membership + state:set_user_password_hash + crypto:sha256Hex
// + crypto:randomTokenHex + crypto:hashPassword + crypto:verifyPassword).
//
// ts-elimination-completion Phase 3 (2026-06-02) — the last TS residuals were
// retired: devLogin + parseCookieHeader are now Fenel bodies (auth:devLogin /
// auth:parseCookieHeader) and the 4 dead sync crypto leaves were deleted. With
// devLogin's @fenel/db import gone, core/auth.ts is drained from
// DIRECT_DB_LEAF_ALLOW. This file now holds ONLY thin boundary adapters:
//   - 9 async TS wrappers — invokeIOAction("auth:<name>") shims around the
//     Fenel orchestrator bodies (issueSession + resolveToken + revokeToken +
//     setPassword + loginWithPassword + bootstrapAdmin + devLogin +
//     listAccounts + switchAccount). Maybe-wrap
//     nullable inputs; unwrap Maybe/$tag-tagged returns to the pre-port shapes.
//   - 3 sync cookie shims (sessionCookieHeader / clearSessionCookieHeader /
//     parseCookieHeader) — in-process evaluate against the Fenel cookie bodies.
//
// Token model: opaque random hex strings, 64 chars (256 bits). The raw
// value is shown to the client once; the server stores `sha256(raw)` and
// looks up sessions by hash. There is no recoverable mapping from hash
// back to raw — losing a token means issuing a new one.
// ---------------------------------------------------------------------------

import { invokeIOActionPrivileged } from "@fenel/runtime";
import type { Maybe } from "@fenel/engine/type-foundation";

// rights R1 — the private privileged-auth door.
//
// These nine orchestrators are the only code in the repository permitted to
// reach the identity leaves (`state.create_session`, `state.set_user_password_hash`,
// `state.create_membership`, the session-by-hash family, the user-by-email
// reads that return password hashes into Fenel, and a user's membership list).
// The last two, `listAccounts` and `switchAccount` (2026-09-23), take the
// request's own session token, never a user id, so the door cannot be asked
// about another user. The leaves refuse any IO
// context whose realm is not `"privileged"`, and `invokeIOActionPrivileged` is
// the only minter of that bit.
//
// `persistence: "ephemeral"` is the OTHER half, and it closes defect C: the
// whole chain runs with no `function_instances` row and no `traces` span, so
// the raw bearer token and the plaintext password are never written anywhere
// `/io/last-result` or `/io/instances` can project them. Both values are
// spelled explicitly because the door requires it — a future
// privileged-but-durable auth service must say so rather than inherit this.
//
// It is deliberately NOT exported from this module. Adding a caller is a rights
// decision, not a refactor: read
// `workstreams/rights/briefs/r1-containment-ii.md` §4.3 and §4.4 first.
const invokePrivilegedAuthAction = (
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> =>
  invokeIOActionPrivileged("", null, action, params, {
    realm: "privileged",
    persistence: "ephemeral",
  });
import { userSubject, type Subject } from "./subject";

// ---------------------------------------------------------------------------
// (The 4 sync crypto leaves generateToken / hashToken / hashPassword /
// verifyPassword were deleted in ts-elimination-completion Phase 3 — they were
// dead, re-exported from @fenel/core/index but never called by any live
// consumer. The Fenel orchestrator bodies reach the crypto:* sync natives
// Fenel-side, NOT through this surface.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Async orchestrators — invokeIOAction shims around Fenel bodies.
// ---------------------------------------------------------------------------

/** Set or clear a user's password hash. Pass `null` to clear. */
export async function setPassword(
  userId: string,
  password: string | null,
): Promise<void> {
  await invokePrivilegedAuthAction("auth:setPassword", {
    userId,
    password:
      password === null
        ? { $tag: "Nothing" }
        : { $tag: "Just", _0: password },
  });
}

export type IssueSessionInput = {
  userId: string;
  accountId: string;
  /** Human-readable label (e.g. "MacBook", "CI token"). */
  label?: string | null;
  /** Optional expiry. Null/undefined → non-expiring (programmatic API token). */
  expiresAt?: Date | null;
};

export type IssuedSession = {
  /** The raw token. Show to the client once; never persisted in raw form. */
  token: string;
  /** The session row id (for revocation). */
  sessionId: string;
  /** The user the session is bound to. */
  userId: string;
};

export async function issueSession(input: IssueSessionInput): Promise<IssuedSession> {
  const result = (await invokePrivilegedAuthAction("auth:issueSession", {
    input: {
      userId: input.userId,
      accountId: input.accountId,
      label:
        input.label == null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: input.label },
      expiresAt:
        input.expiresAt == null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: input.expiresAt.toISOString() },
    },
  })) as { $tag?: string; token: string; sessionId: string; userId: string };
  return {
    token: result.token,
    sessionId: result.sessionId,
    userId: result.userId,
  };
}

/** HTTP transport of the Fenel-authored auth.UserProfile value. */
export type UserProfile = { $tag: "UserProfile"; email: string; name: Maybe<string> };

export type ResolvedSession = {
  subject: Subject;
  profile: UserProfile;
  session: {
    id: string;
    userId: string;
    accountId: string;
    /** rights R2b — the membership row's LIVE role and id. The request door maps
     *  the role to an envelope through `authority:roleEnvelope`; the id is the
     *  grant the minted authority is attributed to. Boundary marshalling only:
     *  no decision is taken here. */
    role: string;
    membershipId: string;
  };
};

export async function resolveToken(rawToken: string): Promise<ResolvedSession | null> {
  if (!rawToken || typeof rawToken !== "string") return null;
  const result = (await invokePrivilegedAuthAction("auth:resolveToken", {
    rawToken,
  })) as
    | { $tag: "Nothing" }
    | {
        $tag: "Just";
        _0: {
          $tag?: string;
          subject: Subject;
          profile: UserProfile;
          sessionId: string;
          userId: string;
          accountId: string;
          role: string;
          membershipId: string;
        };
      };
  if (!result || result.$tag === "Nothing") return null;
  const r = result._0;
  return {
    subject: r.subject,
    profile: r.profile,
    session: {
      id: r.sessionId,
      userId: r.userId,
      accountId: r.accountId,
      role: r.role,
      membershipId: r.membershipId,
    },
  };
}

/** Revoke a session by its raw token. */
export async function revokeToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await invokePrivilegedAuthAction("auth:revokeToken", { rawToken });
}

export type AccountChoice = { accountId: string; name: string; slug: string; role: string };
export type AccountChoices = { currentAccountId: string; accounts: AccountChoice[] };

/** The accounts the user of this session token belongs to (`auth:listAccounts`).
 *  Null when the token no longer names a live session. */
export async function listAccounts(rawToken: string): Promise<AccountChoices | null> {
  if (!rawToken) return null;
  const result = (await invokePrivilegedAuthAction("auth:listAccounts", { rawToken })) as
    | { $tag: "Nothing" }
    | { $tag: "Just"; _0: { currentAccountId: string; accounts: AccountChoice[] } };
  if (!result || result.$tag === "Nothing") return null;
  return {
    currentAccountId: result._0.currentAccountId,
    accounts: result._0.accounts.map(({ accountId, name, slug, role }) => ({ accountId, name, slug, role })),
  };
}

export type AccountSwitch =
  | { kind: "switched"; token: string; userId: string; accountId: string; maxAgeSeconds?: number }
  | { kind: "refused"; status: 400 | 401 | 403; message: string };

/** Replace this session token with one for `accountId` (`auth:switchAccount`).
 *  `nowMs` is the host clock read, the only input Fenel cannot compute. */
export async function switchAccount(rawToken: string, accountId: string, nowMs: number): Promise<AccountSwitch> {
  const result = (await invokePrivilegedAuthAction("auth:switchAccount", { rawToken, accountId, nowMs })) as
    | { $tag: "Switched"; token: string; userId: string; accountId: string;
        maxAgeSeconds: { $tag: "Nothing" } | { $tag: "Just"; _0: number } }
    | { $tag: "SwitchRefused"; status: 400 | 401 | 403; message: string };
  if (result.$tag === "SwitchRefused") return { kind: "refused", status: result.status, message: result.message };
  return {
    kind: "switched",
    token: result.token,
    userId: result.userId,
    accountId: result.accountId,
    ...(result.maxAgeSeconds.$tag === "Just" ? { maxAgeSeconds: result.maxAgeSeconds._0 } : {}),
  };
}

export type PasswordLoginInput = {
  email: string;
  password: string;
  accountId: string;
};

export async function loginWithPassword(
  input: PasswordLoginInput,
): Promise<IssuedSession | null> {
  const result = (await invokePrivilegedAuthAction("auth:loginWithPassword", {
    email: input.email,
    password: input.password,
    accountId: input.accountId,
  })) as
    | { $tag: "Nothing" }
    | {
        $tag: "Just";
        _0: {
          $tag?: string;
          token: string;
          sessionId: string;
          userId: string;
        };
      };
  if (!result || result.$tag === "Nothing") return null;
  const v = result._0;
  return { token: v.token, sessionId: v.sessionId, userId: v.userId };
}

export type BootstrapAdminInput = {
  email: string;
  password: string;
  accountId: string;
  name?: string | null;
  role?: string;
};

export async function bootstrapAdmin(input: BootstrapAdminInput): Promise<{
  userId: string;
  created: boolean;
}> {
  const result = (await invokePrivilegedAuthAction("auth:bootstrapAdmin", {
    input: {
      email: input.email,
      password: input.password,
      accountId: input.accountId,
      name:
        input.name == null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: input.name },
      role:
        input.role == null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: input.role },
    },
  })) as { userId: string; created: boolean };
  return { userId: result.userId, created: result.created };
}

// ---------------------------------------------------------------------------
// Dev-login — admin-only convenience. Get-or-create the user + membership if
// missing, then issue a session.
//
// ts-elimination-completion Phase 3 — PORTED to the Fenel body auth:devLogin
// (fenel/modules/auth/session.fenel), which reuses the bootstrapAdmin
// ensureMembership guard. This is now a thin invokeIOAction shim: marshal the
// nullable name to Maybe + default the role to "owner" then wrap as Just (the
// Fenel body threads role straight to ensureMembership → state:createMembership,
// which reads role as Maybe). Removing the prior @fenel/db import drained
// core/auth.ts from DIRECT_DB_LEAF_ALLOW.
// ---------------------------------------------------------------------------

export type DevLoginInput = {
  email: string;
  name?: string | null;
  accountId: string;
  /** Membership role for the user on this account (default: "owner"). */
  role?: string;
};

export async function devLogin(input: DevLoginInput): Promise<IssuedSession> {
  const result = (await invokePrivilegedAuthAction("auth:devLogin", {
    input: {
      email: input.email,
      name:
        input.name == null
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: input.name },
      accountId: input.accountId,
      role: { $tag: "Just", _0: input.role ?? "owner" },
    },
  })) as { $tag?: string; token: string; sessionId: string; userId: string };
  return {
    token: result.token,
    sessionId: result.sessionId,
    userId: result.userId,
  };
}

// ---------------------------------------------------------------------------
// Cookie helpers — sync TS wrappers around the Fenel bodies via in-process
// evaluate (Decision B + sub-step 2's Decision E pattern). isProd is
// threaded as a Bool arg (Decision C1) rather than via an env-read
// primitive. parseCookieHeader was PORTED to auth:parseCookieHeader in
// ts-elimination-completion Phase 3 (the Decision-a deferral is discharged —
// std:assocRecord shipped Phase 2b) and is now an evaluate-the-body shim too.
//
// Re-exported from @fenel/core so api/src/routes/auth.ts can import them
// (Decision N2 from 12c-routes-4 — the helpers were held for this
// sub-step's auth port).
//
// The SESSION_COOKIE name "fenel_session" is hard-coded in the Fenel body
// (matches the api/src/middleware/auth.ts constant).
// ---------------------------------------------------------------------------

import { evaluate } from "@fenel/engine";
import { getSystemRegistry } from "@fenel/engine/system-registry";

let cachedSessionCookieBody: unknown = null;
let cachedClearCookieBody: unknown = null;
let cachedParseCookieBody: unknown = null;

function getSessionCookieBody(): unknown {
  if (cachedSessionCookieBody) return cachedSessionCookieBody;
  const reg = getSystemRegistry();
  const fn = reg.getFunction("auth:sessionCookieHeader");
  if (!fn?.body) {
    throw new Error(
      "auth:sessionCookieHeader body not found in system registry — engine bootstrap failure",
    );
  }
  cachedSessionCookieBody = fn.body;
  return cachedSessionCookieBody;
}

function getClearCookieBody(): unknown {
  if (cachedClearCookieBody) return cachedClearCookieBody;
  const reg = getSystemRegistry();
  const fn = reg.getFunction("auth:clearSessionCookieHeader");
  if (!fn?.body) {
    throw new Error(
      "auth:clearSessionCookieHeader body not found in system registry — engine bootstrap failure",
    );
  }
  cachedClearCookieBody = fn.body;
  return cachedClearCookieBody;
}

function getParseCookieBody(): unknown {
  if (cachedParseCookieBody) return cachedParseCookieBody;
  const reg = getSystemRegistry();
  const fn = reg.getFunction("auth:parseCookieHeader");
  if (!fn?.body) {
    throw new Error(
      "auth:parseCookieHeader body not found in system registry — engine bootstrap failure",
    );
  }
  cachedParseCookieBody = fn.body;
  return cachedParseCookieBody;
}

/**
 * Build the `Set-Cookie` header value for the session cookie. HttpOnly
 * (so JS cannot read it), SameSite=Lax (lets top-level GETs work; blocks
 * most CSRF), Secure in production. Path=/ so every API + frontend
 * route receives it.
 */
export function sessionCookieHeader(
  token: string,
  maxAgeSeconds: number = 60 * 60 * 24 * 30,
): string {
  const isProd = process.env["NODE_ENV"] === "production";
  const ctx = getSystemRegistry().evaluateContext();
  return evaluate(
    getSessionCookieBody(),
    { token, maxAgeSeconds, isProd },
    ctx,
  ) as string;
}

/** Cookie that immediately clears the session. */
export function clearSessionCookieHeader(): string {
  const isProd = process.env["NODE_ENV"] === "production";
  const ctx = getSystemRegistry().evaluateContext();
  return evaluate(getClearCookieBody(), { isProd }, ctx) as string;
}

/**
 * Minimal cookie-header parser: `a=1; b=2` → `{ a: "1", b: "2" }`.
 *
 * ts-elimination-completion Phase 3 — PORTED to the Fenel body
 * auth:parseCookieHeader (fenel/modules/auth/cookies.fenel). The Decision-a
 * deferral ("pending std:assocRecord") is discharged: std:assocRecord shipped
 * Phase 2b, so the dynamic-key insert is expressible Fenel-side. This is now a
 * thin evaluate-the-body shim (the sessionCookieHeader pattern). The
 * `undefined`-header short-circuit stays TS (the Fenel body takes String).
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const ctx = getSystemRegistry().evaluateContext();
  return evaluate(getParseCookieBody(), { header }, ctx) as Record<string, string>;
}

// Re-export the helpers used by core consumers (resolveToken etc. callers
// already exist via this file's exports). userSubject is consumed by the
// pre-12c-3 TS resolveToken; the Fenel-bodied resolveToken constructs
// User directly Fenel-side, but the userSubject re-export keeps the
// existing api/middleware/auth.ts importer path stable.
export { userSubject };


export type ReaderAccountOutcome =
  | { kind: "ready"; resolved: ResolvedSession }
  | { kind: "refused"; status: 400 | 401 | 403; message: string };

/** No cookie mutation: the authenticated principal's live target membership. */
export async function resolveReaderAccount(rawToken: string, target: string): Promise<ReaderAccountOutcome> {
  const result = await invokePrivilegedAuthAction("auth:resolveReaderAccount", { rawToken, target }) as
    | { $tag: "ReaderAccountRefused"; status: 400 | 401 | 403; message: string }
    | { $tag: "ReaderAccountReady"; resolved: { subject: Subject; profile: UserProfile;
      sessionId: string; userId: string; accountId: string; role: string; membershipId: string } };
  if (result.$tag === "ReaderAccountRefused") return { kind: "refused", status: result.status, message: result.message };
  const row = result.resolved;
  return { kind: "ready", resolved: { subject: row.subject, profile: row.profile,
    session: { id: row.sessionId, userId: row.userId, accountId: row.accountId, role: row.role, membershipId: row.membershipId } } };
}

export type PersonalAccountOutcome =
  | { kind: "ready"; accountId: string }
  | { kind: "refused"; status: 401 | 409; message: string };

/** The endpoint accepts the request token only, never a supplied user id. */
export async function personalAccountForToken(rawToken: string): Promise<PersonalAccountOutcome> {
  const result = await invokePrivilegedAuthAction("auth:personalAccountForToken", { rawToken }) as
    | { $tag: "PersonalAccountReady"; accountId: string }
    | { $tag: "PersonalAccountRefused"; status: 401 | 409; message: string };
  return result.$tag === "PersonalAccountRefused"
    ? { kind: "refused", status: result.status, message: result.message }
    : { kind: "ready", accountId: result.accountId };
}
