import { createApiReadiness } from "./api-readiness";
import { apiListenHostname, enforcePublicDeploymentGuard } from "./public-deployment-guard";

// GP-25 — a public deployment (FENEL_PUBLIC_DEPLOYMENT=1) refuses to start in
// a non-production mode or with a secret that opens an unsafe surface. Checked
// before binding, so a refused boot never answers a request.
enforcePublicDeploymentGuard();

const readiness = createApiReadiness();
const port = Number(process.env["API_PORT"] ?? 3001);
const listenHostname = apiListenHostname();

/** GP-25 — the largest request body the server reads at all (Bun's default is
 *  128 MB). It is the cap for the few routes that carry whole files: inbound
 *  mail with base64 attachments (Postmark allows 35 MB messages) and contact
 *  imports. Every other route group has a tighter cap in
 *  `middleware/rate-limit.ts` (`DEFAULT_BODY_LIMITS`). */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;
function maxRequestBodyBytes(): number {
  const raw = process.env["FENEL_MAX_REQUEST_BODY_BYTES"];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_REQUEST_BODY_BYTES;
}

// Bind before importing the engine or touching the database, so the sign-in
// screen can distinguish a starting API from an unreachable one. The explicit
// id lets Bun reuse this listener when the dev command runs with `--hot`.
Bun.serve({
  id: "fenel-api",
  fetch: readiness.fetch,
  port,
  // GP-25 — loopback on a public deployment (`API_HOST` overrides).
  ...(listenHostname !== undefined ? { hostname: listenHostname } : {}),
  // Bun's default 10s idle deadline includes handlers still preparing a
  // response. Registry reads can exceed that on the remote staging DB;
  // leave room for the client's bounded request timeout to report failures.
  idleTimeout: 120,
  maxRequestBodySize: maxRequestBodyBytes(),
});
console.log(`[api] Loading on http://localhost:${port}`);

try {
  await import("../../engine/src/engine-body-host-install");
  const { app } = await import("./index.js");
  const { bootstrapAdmin } = await import("@fenel/core");
  const { checkAllTimeouts } = await import("@fenel/runtime");
  await import("./google-places");
  const { dispatchRegistry, applyAccountSpecInstances } = await import("@fenel/engine");
  const { listInstances } = await import("@fenel/db");
  const { loadBootUserRegistries } = await import("./boot-user-registries");
  const { seedSystemFunctions } = await import("./seed-system-functions");
  const { reportLoginSelfCheck } = await import("./boot-login-sentinel");
  const { reportRepositoryFieldCatalogIdentityDeficit } =
    await import("@fenel/engine/repository-field-catalog-server");

  reportRepositoryFieldCatalogIdentityDeficit();

  // The typed `send_email` action (email:sendEmail) is registered from
  // @fenel/core's actions/index alongside every other action — no boot wiring
  // here (action-subsumption Phase N retired the runtime registerEmailActions).

  // Load the default account's typeclass instances from the typed-registry
  // tables into the engine's dispatch registry (`boot-user-registries.ts`
  // carries the readiness contract: complete read, bounded retry, else refuse).
  //
  // rights R3a — the instances are stamped with the OWNING account, so they are
  // selected only under a frame whose authenticated authority derives it. The
  // comment that used to sit here said multi-account scoping was "a separate
  // refactor"; this is that refactor.
  async function loadUserRegistries(): Promise<void> {
    const accountId = process.env["DEFAULT_ACCOUNT_ID"];
    if (!accountId) {
      console.warn("[api] DEFAULT_ACCOUNT_ID unset — skipping user registry load");
      return;
    }
    await loadBootUserRegistries(accountId, {
      listInstances,
      apply: (owner, instances) => applyAccountSpecInstances(dispatchRegistry, owner, instances as never),
      log: (line) => console.log(line),
      error: (line, err) => console.error(line, err),
      sleep: (ms) => Bun.sleep(ms),
    });
  }

  await loadUserRegistries();

  // Seed every engine-module function into the functions table for the
  // dev-tunnel account. Idempotent — keeps std + telegram + state +
  // every other module addressable through the same DB read path as
  // user-defined functions, so the dashboard's Edit / Call surfaces
  // don't need a separate "module fn" code path.
  async function seedSystemFunctionsForDefaultAccount(): Promise<void> {
    const accountId = process.env["DEFAULT_ACCOUNT_ID"];
    if (!accountId) return;
    try {
      const n = await seedSystemFunctions(accountId);
      console.log(`[api] Seeded ${n} system functions into DB`);
    } catch (err) {
      console.error("[api] seedSystemFunctions failed:", err);
    }
  }

  await seedSystemFunctionsForDefaultAccount();

  // rights Phase C2 (2026-08-07) — the boot-time default-policy seed was REMOVED;
  // rights R2a (2026-09) deleted the engine it seeded.
  //
  // C2 found `bootstrapAccountPolicies(DEFAULT_ACCOUNT_ID)` running on every boot
  // behind an "idempotent" comment that was false — the dedup key was absent from
  // the rows it compared against, so staging held 22 copies of each default, one
  // of them granting every subject (unauthenticated included) a `SeAll` resource
  // set. R2a deleted `core/src/permissions/`, the `permission_policies` table and
  // the dispatch check step outright: authorization is decided at EXERCISE by
  // `perform`, against the opaque envelope on the frame, so there is no policy
  // store for a boot hook to seed.

  // Bootstrap an admin user from ADMIN_EMAIL + ADMIN_PASSWORD if both are
  // set. Idempotent: re-runs every boot, syncing the password to the env
  // value (so changing the env is the canonical way to reset the admin
  // password). Skipped silently when the env is unset.
  async function ensureAdminUser(): Promise<void> {
    const email = process.env["ADMIN_EMAIL"];
    const password = process.env["ADMIN_PASSWORD"];
    const accountId = process.env["DEFAULT_ACCOUNT_ID"];
    if (!email || !password || !accountId) return;
    try {
      const result = await bootstrapAdmin({
        email,
        password,
        accountId,
        name: process.env["ADMIN_NAME"] ?? null,
      });
      console.log(
        result.created
          ? `[api] Bootstrapped admin user ${email} (id=${result.userId})`
          : `[api] Synced admin password for ${email}`,
      );
    } catch (err) {
      console.error("[api] Failed to bootstrap admin user:", err);
    }
  }

  await ensureAdminUser();

  // rights R1 §7 — THE LOGIN SENTINEL, immediately before the readiness line.
  //
  // Placement is the whole point. Above, `ensureAdminUser` catches its own
  // failure, logs it, and falls through; below, this file announces
  // `Fenel API running`. That exact shape is what R0 watched during a
  // five-and-a-half-week total login outage under six green CI jobs: an error
  // line scrolled past, and then a readiness claim that was false.
  //
  // So the readiness line is now GATED. Unconfigured (no ADMIN_EMAIL /
  // ADMIN_PASSWORD / DEFAULT_ACCOUNT_ID) SKIPS loudly and still boots, because
  // the check has nothing to assert and saying so is honest. Configured and
  // broken THROWS, so nothing announces readiness. There is deliberately no
  // third "log it and serve anyway" branch — that is the state the outage sat
  // in — and deliberately no env escape hatch, because a mutable gate is a
  // muted gate. `boot-login-sentinel.ts` carries the full rationale.
  // Startup errors reach the catch below, which wakes
  // readiness waiters with `failed` and then exits 1, including under `bun --hot`.
  if (!await reportLoginSelfCheck()) {
    throw new Error(
      "[api] refusing to announce readiness: the boot login self-check failed. " +
      "Login is broken; fix it, or unset ADMIN_EMAIL/ADMIN_PASSWORD to boot without the guarantee.",
    );
  }

  readiness.ready(app.fetch);

  console.log(`Fenel API running on http://localhost:${port}`);

  // Timer tick — check for expired waits every 60 seconds
  const TICK_INTERVAL = 60_000;
  const STALE_CONV_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  let tickInFlight = false;
  setInterval(async () => {
    // Retain this host callback's ownership through both asynchronous tasks.
    // A slow sweep skips later ticks instead of accumulating another sweep.
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      try {
        await checkAllTimeouts();
      } catch (err) {
        console.error("[tick] checkAllTimeouts failed:", err);
      }
      try {
        const { cancelStaleConversations } = await import("@fenel/db");
        await cancelStaleConversations(STALE_CONV_AGE_MS);
      } catch (err) {
        console.error("[tick] cancelStaleConversations failed:", err);
      }
    } finally {
      tickInFlight = false;
    }
  }, TICK_INTERVAL);
  console.log(`[tick] Timer tick started (${TICK_INTERVAL / 1000}s interval)`);
} catch (error) {
  readiness.fail();
  console.error("[api] API startup failed:", error);
  // Let pending status requests receive the failure before exiting. A failed
  // boot must still stop the process so PID-based supervisors detect it.
  setTimeout(() => process.exit(1), 250);
}
