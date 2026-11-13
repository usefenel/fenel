// ---------------------------------------------------------------------------
// Auth middleware — resolves a request's `Subject` and stashes it on the
// Hono context.
//
// Resolution rules:
//
//   1. `Authorization: Bearer <token>`   → look up session, build a
//                                          `userSubject(accountId, userId)`
//   2. `fenel_session=<token>` cookie    → the same server-backed User/session
//   3. neither                           → `anonymousSubject()`
//
// The middleware is permissive — it does NOT reject unauthenticated
// requests. Authorization is the next layer's job (`requireSubject` /
// `requireAccount` helpers), since some routes (form submission, public
// reads) accept anonymous callers.
//
// Construction-site convenience: `getSubject(c)` returns the resolved
// Subject. Private user routes should use `getAuthenticatedUserAccountId(c)`
// so a partition selector or non-user Subject cannot confer authority.
// ---------------------------------------------------------------------------

import type { Context, MiddlewareHandler } from "hono";
import {
  resolveToken,
  resolveReaderAccount,
  anonymousSubject,
  type Subject,
  type UserProfile,
} from "@fenel/core";
import type { AuthorityRef } from "@fenel/engine/authority";
import {
  loadAccountExecutionRegistryForRequest,
  mintAnonymousAuthority,
  mintRequestAuthority,
} from "@fenel/runtime";
import { bearerTokenOf, SESSION_COOKIE, sessionCookieOf } from "./session-token";

/** The cookie name used by browser clients to carry the session token. The
 *  token reading lives in `./session-token`, shared with the rate limiter so
 *  the two can never disagree about which token a request carries. */
export { SESSION_COOKIE };

const SUBJECT_KEY = "subject" as const;
const SESSION_KEY = "session" as const;
const SESSION_TOKEN_KEY = "sessionToken" as const;
const AUTHORITY_KEY = "authority" as const;
const PROFILE_KEY = "userProfile" as const;

export type SessionInfo = {
  id: string;
  userId: string;
  accountId: string;
  /** rights R2b — the membership row's LIVE role and id, read through the join
   *  `getSessionByHash` already performs. `getAuthority` maps the role to an
   *  envelope; the id is the grant the minted authority is attributed to. */
  role: string;
  membershipId: string;
};

/** A browser tab states the account its surfaces were rendered for. */
export const EXPECTED_ACCOUNT_HEADER = "x-fenel-account";
/** Explicit per-request partition, rechecked against the token user's grant. */
export const READER_ACCOUNT_HEADER = "x-fenel-reader-account";

/** True when a request states an account its user session does not hold. A
 * request that states none, and a non-user subject, are not judged here. */
export function statesOtherAccount(subject: Subject, expected: string | undefined): boolean {
  return expected !== undefined && subject.$tag === "User" && subject.accountId !== expected;
}

/**
 * Explicit reader requests authenticate the session user and then recheck the
 * target membership. Legacy requests retain the expected-account guard, so a
 * cookie switch cannot retarget an old surface's next mutation. No branch
 * changes the cookie, restores a grant or falls back to another account.
 * Downstream handlers decide whether the resolved subject is acceptable.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  let subject = await resolveSubject(c);
  const reader = c.req.header(READER_ACCOUNT_HEADER);
  if (reader !== undefined) {
    // Resolve credentials first. Once a valid bearer won, a target-membership
    // refusal must not retry under a different cookie principal.
    const token = getSessionToken(c);
    if (subject.$tag !== "User" || !token) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Authentication required" }, 401);
    }
    const outcome = await resolveReaderAccount(token, reader);
    if (outcome.kind === "refused") {
      c.header("Cache-Control", "no-store");
      return c.json({ error: outcome.message, code: "reader-account-refused" }, outcome.status);
    }
    subject = outcome.resolved.subject;
    c.set(SESSION_KEY as never, outcome.resolved.session as never);
    c.set(PROFILE_KEY as never, outcome.resolved.profile as never);
  }
  c.set(SUBJECT_KEY as never, subject as never);
  if (reader === undefined && statesOtherAccount(subject, c.req.header(EXPECTED_ACCOUNT_HEADER))) {
    c.header("Cache-Control", "no-store");
    return c.json({ error: "Your account data changed in another tab.", code: "account-changed" }, 409);
  }
  await next();
};

async function resolveSubject(c: Context): Promise<Subject> {
  // 1. Bearer token (programmatic clients).
  const token = bearerTokenOf(c.req.header("authorization") ?? c.req.header("Authorization"));
  if (token) {
    const resolved = await resolveToken(token);
    if (resolved) {
      c.set(SESSION_KEY as never, resolved.session as never);
      c.set(PROFILE_KEY as never, resolved.profile as never);
      c.set(SESSION_TOKEN_KEY as never, token as never);
      return resolved.subject;
    }
  }

  // 2. Session cookie (browser clients). Same resolution as bearer.
  const cookieToken = sessionCookieOf(c.req.header("cookie"));
  if (cookieToken) {
    const resolved = await resolveToken(cookieToken);
    if (resolved) {
      c.set(SESSION_KEY as never, resolved.session as never);
      c.set(PROFILE_KEY as never, resolved.profile as never);
      c.set(SESSION_TOKEN_KEY as never, cookieToken as never);
      return resolved.subject;
    }
  }

  // 3. No authenticated signal — anonymous. An account selector is not an
  // actor credential: public embed endpoints may read X-Account-Id explicitly
  // for tenant routing, but it must never manufacture an authorized Subject.
  return anonymousSubject();
}

/** rights R2a — THE request mint.
 *
 *  ⚠ LAZY, ON PURPOSE. Minting in the middleware would make every authenticated
 *  request pay `loadAccountExecutionRegistry`, which reads the account's source
 *  modules and field graph BEFORE its own fingerprint cache check — a database
 *  round-trip per request, including for requests that never perform anything.
 *  The handle is minted on the first `getAuthority(c)` and memoised per request.
 *
 *  A request with no session gets the ANONYMOUS authority (∅): every perform is
 *  refused at the gate rather than at whichever leaf happened to check. */
export async function getAuthority(c: Context): Promise<AuthorityRef> {
  const existing = c.get(AUTHORITY_KEY) as AuthorityRef | undefined;
  if (existing !== undefined) return existing;
  const session = getSession(c);
  const accountId = getAuthenticatedUserAccountId(c);
  const registry = await loadAccountExecutionRegistryForRequest(
    session !== undefined && accountId !== undefined ? accountId : "",
  );
  // rights R2b — THE ROLE COMES FROM THE MEMBERSHIP ROW, never from the request.
  // A header, a body field or a Subject claiming a role confers nothing: the
  // only reader is the session join, inside the identity realm, on every
  // request. An unknown role denotes ∅ in the Fenel policy, so the mint still
  // succeeds and every act is refused with a 403 naming the descriptor.
  const minted = session !== undefined && accountId !== undefined
    ? mintRequestAuthority(registry, {
        accountId,
        role: session.role,
        membershipId: session.membershipId,
        subject: getSubject(c),
      })
    : mintAnonymousAuthority(registry);
  c.set(AUTHORITY_KEY as never, minted as never);
  return minted;
}

/** Read the resolved subject from the Hono context. */
export function getSubject(c: Context): Subject {
  return c.get(SUBJECT_KEY) as Subject;
}

/** The raw token this request authenticated with (bearer or cookie, in the
 *  order the middleware tried them). The account-selection actions take it,
 *  so they act on exactly the session that authenticated the request. */
export function getSessionToken(c: Context): string | undefined {
  return c.get(SESSION_TOKEN_KEY) as string | undefined;
}

/** Request authentication/grant projection. With an explicit reader, id and
 * userId name the credential while accountId/role/membershipId name the selected
 * live grant; the underlying credential's stored account is unchanged. */
export function getSession(c: Context): SessionInfo | undefined {
  return c.get(SESSION_KEY) as SessionInfo | undefined;
}

/** Only the profile returned by this request's authenticated session. */
export function getUserProfile(c: Context): UserProfile | undefined {
  return getAuthenticatedUserAccountId(c) ? c.get(PROFILE_KEY) as UserProfile | undefined : undefined;
}

/** Return the authenticated user's account only when the resolved Subject and
 * server-side session agree exactly. This deliberately rejects Bot subjects
 * and account-selector headers: dashboard/authoring authority comes from a
 * bearer or HttpOnly session token, never from a caller-asserted partition. */
export function getAuthenticatedUserAccountId(c: Context): string | undefined {
  const resolved = c.get(SUBJECT_KEY) as Subject | undefined;
  const session = getSession(c);
  if (resolved?.$tag !== "User" || session === undefined) return undefined;
  if (
    resolved.accountId !== session.accountId
    || resolved.userId !== session.userId
  ) {
    return undefined;
  }
  return resolved.accountId;
}
