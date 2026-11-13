// ---------------------------------------------------------------------------
// Auth routes — session lifecycle.
//
// Endpoints:
//
//   POST /auth/login       — email + password
//   POST /auth/dev-login   — admin-only convenience: takes (email, accountId,
//                            optional name + role), returns a token. Guarded
//                            by `ADMIN_TOKEN` env var so it is unusable in
//                            unattended deployments without the admin
//                            opting in.
//   POST /auth/logout      — revokes the bearer token in the request
//   GET  /auth/me          — returns the resolved Subject for the current
//                            request (useful for client introspection)
//   GET  /auth/accounts    — the signed-in user's accounts (auth:listAccounts)
//   POST /auth/switch-account — replace the session with one for another of
//                            those accounts (auth:switchAccount); both live in
//                            ./account-sessions and are Fenel-bodied
//
// Real login flows (password, magic link, OAuth) sit on top of these
// primitives — they call `issueSession` once they've authenticated the
// user some other way.
//
// Phase 12c-core sub-step 3 — disposition sweep.
//
//   /login   — TS-shim. Delegates to @fenel/core's loginWithPassword
//              (Fenel-bodied via auth:loginWithPassword) + sets cookie
//              via the Fenel-bodied sessionCookieHeader helper. The
//              route body is a thin parse + invokeIOAction + set-cookie
//              shim around the Fenel orchestration.
//   /dev-login — F (out of scope). Admin-only convenience guarded by
//              ADMIN_TOKEN env; low-priority + small. Stays TS.
//   /logout  — TS-shim. Reads cookie via parseCookieHeader (stays TS per
//              Decision a — dynamic-key record insertion blocked on
//              std:assocRecord substrate), revokes via the Fenel-bodied
//              revokeToken, clears cookie via the Fenel-bodied
//              clearSessionCookieHeader helper.
//   /me      — B-permanent. Returns getSubject(c) (resolved by
//              middleware). Trivial registry read; no port target.
//
// The 3 cookie helpers below (sessionCookieHeader / clearSessionCookieHeader /
// parseCookieHeader) are now imported from @fenel/core — sessionCookieHeader
// + clearSessionCookieHeader are Fenel-bodied in fenel/modules/auth/
// cookies.fenel; parseCookieHeader stays TS in @fenel/core/auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
  devLogin,
  revokeToken,
  loginWithPassword,
  sessionCookieHeader,
  clearSessionCookieHeader,
  parseCookieHeader,
  listAccounts,
  personalAccountForToken,
  switchAccount,
} from "@fenel/core";
import { getSubject, getSessionToken, getUserProfile, getAuthenticatedUserAccountId, SESSION_COOKIE } from "../middleware/auth";
import { createAccountSessionRoutes } from "./account-sessions";
import { sameSecret } from "../constant-time";

const authRoutes = new Hono();

authRoutes.route("/", createAccountSessionRoutes({
  sessionToken: (context) => getAuthenticatedUserAccountId(context) ? getSessionToken(context) : undefined,
  listAccounts,
  personalAccount: personalAccountForToken,
  switchAccount,
  cookie: sessionCookieHeader,
}));

// ---------------------------------------------------------------------------
// POST /auth/login — email + password.
//
// Body: `{ email, password, accountId? }`. When `accountId` is omitted,
// the server falls back to `DEFAULT_ACCOUNT_ID` (single-tenant dev
// tunnel). Multi-account UX should always send accountId explicitly.
//
// Response: `{ token, userId, accountId }` and a Set-Cookie that the
// browser will use for subsequent requests. Programmatic clients can
// ignore the cookie and pass the token in `Authorization: Bearer`.
// ---------------------------------------------------------------------------

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    accountId?: string;
  }>();

  if (!body.email || !body.password) {
    return c.json({ error: "email and password required" }, 400);
  }

  const accountId = body.accountId ?? process.env["DEFAULT_ACCOUNT_ID"];
  if (!accountId) {
    return c.json({ error: "accountId required (no DEFAULT_ACCOUNT_ID configured)" }, 400);
  }

  const issued = await loginWithPassword({
    email: body.email,
    password: body.password,
    accountId,
  });

  if (!issued) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  c.header("Set-Cookie", sessionCookieHeader(issued.token));
  return c.json({
    token: issued.token,
    sessionId: issued.sessionId,
    userId: issued.userId,
    accountId,
  });
});

/**
 * POST /auth/dev-login
 *
 * Body: `{ email, accountId, name?, role? }`
 * Header: `X-Admin-Token: <ADMIN_TOKEN env value>`
 *
 * Creates the user + membership if missing, issues a session, returns
 * the raw token.
 */
authRoutes.post("/dev-login", async (c) => {
  const adminToken = process.env["ADMIN_TOKEN"];
  if (!adminToken) {
    return c.json({ error: "Dev-login disabled (ADMIN_TOKEN unset)" }, 503);
  }
  const provided = c.req.header("x-admin-token");
  if (provided === undefined || !sameSecret(provided, adminToken)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json<{
    email?: string;
    accountId?: string;
    name?: string | null;
    role?: string;
  }>();

  if (!body.email || !body.accountId) {
    return c.json({ error: "email and accountId required" }, 400);
  }

  const issued = await devLogin({
    email: body.email,
    name: body.name ?? null,
    accountId: body.accountId,
    role: body.role,
  });

  return c.json({
    token: issued.token,
    sessionId: issued.sessionId,
    userId: issued.userId,
    accountId: body.accountId,
  });
});

/**
 * POST /auth/logout — revokes the session token from the request.
 *
 * Reads the token from cookie OR Authorization header (whichever the
 * client is using), revokes it, and clears the cookie.
 */
authRoutes.post("/logout", async (c) => {
  const cookie = parseCookieHeader(c.req.header("cookie"));
  const cookieToken = cookie[SESSION_COOKIE];
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  const headerToken =
    auth && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = cookieToken || headerToken;
  if (!token) {
    c.header("Set-Cookie", clearSessionCookieHeader());
    return c.json({ revoked: false });
  }
  await revokeToken(token);
  c.header("Set-Cookie", clearSessionCookieHeader());
  return c.json({ revoked: true });
});

/** GET /auth/me — current resolved Subject. */
authRoutes.get("/me", (c) => {
  const subject = getSubject(c);
  c.header("Cache-Control", "no-store");
  return c.json({ subject, profile: getUserProfile(c) });
});

export { authRoutes };
