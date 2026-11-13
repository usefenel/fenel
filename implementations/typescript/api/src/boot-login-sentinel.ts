// ---------------------------------------------------------------------------
// rights R1 §7 — THE LOGIN SENTINEL.
//
// WHY IT EXISTS. `POST /api/auth/login` returned 500 from 2026-07-19 to
// 2026-08-28 — five and a half weeks — with every CI job green throughout, and
// `api/src/server.ts` announcing `Fenel API running` on every restart. The
// readiness line was the lie: it is what humans and tooling key on, and it was
// printed by a process whose login was totally broken. R0 repaired the app and
// established why nobody saw it; this is the gate that makes the same silence
// impossible.
//
// WHY IT IS A BOOT CHECK AND NOT A SCHEDULED NIGHTLY. The dev tunnel is only
// live while a contributor's machine is up, so a nightly reds every quiet
// night — and an intermittently-red gate gets muted, which is the precise
// failure mode this workstream exists to end. A boot check runs exactly when
// there is something to check and exactly where the false claim was made.
//
// WHY IT DRIVES THE ROUTE RATHER THAN `loginWithPassword`. What was observed
// failing was the HTTP route: the core function sits below the middleware, the
// JSON parse, and `sessionCookieHeader` (a pure `evaluate` of a Fenel body
// that only the route exercises). `app.fetch` runs the whole stack in-process
// before anything listens, so the sentinel covers what actually broke.
//
// THREE HAZARDS, each handled deliberately:
//
//   1. Every successful password login issues a session with
//      `expiresAt = Nothing`. A check that merely asserts would insert a
//      PERMANENTLY ACTIVE session on every restart and discard the only
//      convenient credential for revoking it. So the round-trip revokes in a
//      `finally`, on the success AND the failure path. Readiness also needs
//      the logout route to confirm revocation; an attempt is not enough.
//   2. The response body carries a live, non-expiring bearer token. It is
//      never logged, never returned from this module, and never written
//      anywhere. R0.5 leaked one to an unignored path and had to revoke the
//      session at the database.
//   3. `ensureAdminUser()` returns silently when its env is unset. Silence is
//      the option the brief forbids, because it makes the readiness guarantee
//      false exactly where it will be trusted. So: SKIP LOUDLY when
//      unconfigured, FAIL when configured and broken. There is deliberately no
//      third "degraded" branch and no env escape hatch — a gate with a mute
//      button is the thing that failed here before.
// ---------------------------------------------------------------------------

import { app } from "./index.js";

export type LoginSelfCheckOutcome =
  | { status: "skipped"; reason: string }
  | { status: "ok"; userId: string; sessionId: string }
  | { status: "failed"; detail: string; sessionId?: string };

/** The env the check needs, read once so the skip reason can name what is
 *  missing rather than say "unconfigured". */
function credentials(): { email: string; password: string; accountId: string } | string {
  const email = process.env["ADMIN_EMAIL"];
  const password = process.env["ADMIN_PASSWORD"];
  const accountId = process.env["DEFAULT_ACCOUNT_ID"];
  const missing = [
    email ? null : "ADMIN_EMAIL",
    password ? null : "ADMIN_PASSWORD",
    accountId ? null : "DEFAULT_ACCOUNT_ID",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) return missing.join(", ");
  return { email: email!, password: password!, accountId: accountId! };
}

/**
 * One in-process login round-trip through the real HTTP surface.
 *
 * Three requests: `POST /api/auth/login` (issue), `GET /api/auth/me` with the
 * bearer (resolve — the path that runs on EVERY authenticated request, and the
 * one defect C lived on), and `POST /api/auth/logout` (revoke, in a `finally`).
 *
 * Never throws for a login failure — it reports one. The caller decides
 * whether a failure is fatal; `server.ts` decides that it is.
 */
export async function runLoginSelfCheck(): Promise<LoginSelfCheckOutcome> {
  const env = credentials();
  if (typeof env === "string") return { status: "skipped", reason: env };

  let token = "";
  let sessionId = "";
  let cleanupFailure = "";
  // Only bounded, non-secret diagnostic IDs may leave this module. This
  // frames diagnostic data; it does not validate identity or authority.
  const diagnosticId = (id: unknown): string =>
    typeof id === "string" && id.length === 36 &&
    id !== token && id !== env.password && id !== env.email &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id : "";
  const roundTrip = async (): Promise<LoginSelfCheckOutcome> => {
    try {
      const login = await app.fetch(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: env.email,
            password: env.password,
            accountId: env.accountId,
          }),
        }),
      );
      if (login.status !== 200) {
        // A failed route may echo credentials or an issued token in its body.
        // Keep only the route/status diagnostic at this boundary.
        return { status: "failed", detail: `POST /api/auth/login -> ${login.status}` };
      }
      const issued = (await login.json()) as { token?: unknown; sessionId?: unknown; userId?: unknown };
      if (typeof issued.token !== "string" || issued.token === "") {
        return { status: "failed", detail: "POST /api/auth/login -> 200 with no token" };
      }
      token = issued.token;
      sessionId = diagnosticId(issued.sessionId);

      const me = await app.fetch(
        new Request("http://localhost/api/auth/me", {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      if (me.status !== 200) {
        return { status: "failed", detail: `GET /api/auth/me -> ${me.status}`, sessionId };
      }
      const resolved = (await me.json()) as { subject?: { $tag?: unknown; userId?: unknown } };
      if (resolved.subject?.$tag !== "User") {
        // Anonymous here means the bearer did not resolve: the token was issued
        // but `auth:resolveToken` did not recognise it, which is a total outage
        // for every authenticated route even though login answered 200.
        return {
          status: "failed",
          detail: "GET /api/auth/me did not resolve a 'User' subject",
          sessionId,
        };
      }
      return {
        status: "ok",
        userId: diagnosticId(resolved.subject.userId),
        sessionId,
      };
    } finally {
      // HAZARD 1. Revoke on both paths and retain any primary failure. Neither
      // an HTTP error nor an unconfirmed/throwing cleanup can permit readiness.
      if (token !== "") {
        try {
          const logout = await app.fetch(
            new Request("http://localhost/api/auth/logout", {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
            }),
          );
          if (logout.status !== 200) {
            cleanupFailure = `POST /api/auth/logout -> ${logout.status}; session revocation not confirmed`;
          } else {
            const revoked = (await logout.json()) as { revoked?: unknown };
            if (revoked?.revoked !== true) {
              cleanupFailure = "POST /api/auth/logout -> 200 without revoked: true; session revocation not confirmed";
            }
          }
        } catch {
          // Exceptions can include the request's bearer or credentials.
          cleanupFailure = "POST /api/auth/logout failed; session revocation not confirmed";
        }
      }
    }
  };

  let outcome: LoginSelfCheckOutcome;
  try {
    outcome = await roundTrip();
  } catch {
    // The response/parser/transport may include secrets in its exception.
    outcome = { status: "failed", detail: "Login self-check request failed", ...(sessionId ? { sessionId } : {}) };
  }
  if (cleanupFailure !== "") {
    return {
      status: "failed",
      detail: outcome.status === "failed" ? `${outcome.detail}; ${cleanupFailure}` : cleanupFailure,
      sessionId,
    };
  }
  return outcome;
}

/** Run the check and report it next to the readiness line.
 *
 *  Returns `true` when the boot may proceed. A `false` return is the
 *  "configured and broken" case and the caller must NOT announce readiness. */
export async function reportLoginSelfCheck(): Promise<boolean> {
  let outcome: LoginSelfCheckOutcome;
  try {
    outcome = await runLoginSelfCheck();
  } catch {
    outcome = { status: "failed", detail: "Login self-check could not complete" };
  }
  if (outcome.status === "skipped") {
    // LOUD, not silent: this states plainly that the readiness line below
    // carries no login guarantee, and names exactly what would restore it.
    console.warn(
      `[api] LOGIN SELF-CHECK SKIPPED — ${outcome.reason} unset. ` +
      "Readiness below does NOT assert that login works.",
    );
    return true;
  }
  if (outcome.status === "failed") {
    console.error(`[api] LOGIN SELF-CHECK FAILED — ${outcome.detail} (self-check session: ${outcome.sessionId || "unavailable"})`);
    return false;
  }
  console.log(`[api] Login self-check OK (user ${outcome.userId || "unavailable"}, session revoked)`);
  return true;
}
