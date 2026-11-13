// ---------------------------------------------------------------------------
// Actions routes — thin wrapper over @fenel/core's dispatch surface.
//
// Phase 12c-routes sub-step 4 — disposition sweep, post-12c-core sub-step 2.
//
//   GET  /        — B-permanent. In-memory listActions() registry read.
//   POST /:name   — TS-shim. The route's call into @fenel/core's dispatch()
//                   (rights R2a deleted the permission check step it used to
//                   invokeIOAction; this wrapper handles auth + Zod-validate
//                   + try/catch around the dispatch surface. The action
//                   handler itself stays TS-only until the action arc
//                   ports (out-of-scope here).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { DrizzleQueryError } from "drizzle-orm";
import {
  dispatch,
  listActions,
  getAction,
  subjectAccountId,
  ValidationError,
} from "@fenel/core";
import type { ActionContext } from "@fenel/core";
import { getSubject, getAuthority } from "../middleware/auth";
import { authorityRefusalOf } from "../authority-refusal.js";

const actionRoutes = new Hono();

function hasDatabaseCause(error: unknown): boolean {
  const seen = new Set<object>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);
    if (error instanceof DrizzleQueryError) return true;
    // PostgreSQL can also raise a raw SQLSTATE error at transaction commit.
    if ("code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) {
      return true;
    }
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}

/**
 * GET /actions — list all registered actions with their schemas
 */
actionRoutes.get("/", (c) => {
  const actions = listActions().map((a) => ({
    name: a.name,
    description: a.description,
  }));
  return c.json({ actions });
});

/**
 * POST /actions/:name — dispatch an action
 * Body: { params: { ... } }
 * rights R2a — there is no account header. The account comes from the
 * authenticated session behind the request authority.
 */
actionRoutes.post("/:name", async (c) => {
  const name = c.req.param("name");
  const subject = getSubject(c);
  const accountId = subjectAccountId(subject);

  // rights R2a — AN ANONYMOUS CALLER IS NO LONGER TURNED AWAY HERE. It reaches
  // `dispatch`, and the first protected act it tries is refused at the gate
  // with 403 — because the pin that matters is "the anonymous authority permits
  // nothing", and a 401 in front of the gate would make that pin unobservable.
  // An action whose body performs nothing protected is, correctly, reachable.
  const authority = await getAuthority(c);

  const action = getAction(name);
  if (!action) {
    return c.json({ error: `Unknown action: ${name}` }, 404);
  }

  const body = await c.req.json<{ params?: Record<string, unknown> }>();
  const params = body.params ?? {};

  // Phase 13b sub-step 5 (2026-05-25, ARC CLOSE) — the front-door Zod
  // safeParse block retired. Every wrapper now validates against the
  // registered `<action_name>_params` system entity via
  // `validateActionParams` and surfaces structured errors via
  // ValidationError; the catch below maps those to the same 422 shape
  // the legacy safeParse used.

  const context: ActionContext = {
    authority,
    accountId: accountId ?? "",
    adapter: "api",
  };

  try {
    const result = await dispatch(name, params, context);
    return c.json(result);
  } catch (err) {
    // rights R2a — an authority refusal is 403, and it is recognised by CLASS
    // (directly or as a `cause`), never by matching message text. The catch-all
    // below maps everything to 422, so without this arm a refusal raised inside
    // `dispatch` would never reach the app-level `onError`.
    const refusal = authorityRefusalOf(err);
    if (refusal) {
      return c.json(
        { error: "authority refused", descriptor: refusal.descriptor, reason: refusal.reason },
        403,
      );
    }
    // Drizzle query errors include SQL and bound values in their message.
    if (hasDatabaseCause(err)) {
      return c.json({ success: false, error: "Database operation failed" }, 500);
    }
    if (err instanceof ValidationError) {
      return c.json({ error: "Validation failed", errors: err.errors }, 422);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 422);
  }
});

export { actionRoutes };
