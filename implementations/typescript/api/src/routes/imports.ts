// ---------------------------------------------------------------------------
// Imports routes — thin wrapper over @fenel/core's dispatch surface.
//
// Phase 12c-routes sub-step 4 — disposition sweep, post-12c-core sub-step 2.
//
//   POST /profiles — TS-shim. dispatch("import_profiles") now resolves to
//                    (rights R2a deleted the permission check step);
//                    the actual import handler at core/actions/imports.ts
//                    is 197 LOC of ETL still F-blocked on Phase 12d (the
//                    largest single port in that arc). Wrapper is auth +
//                    delegate.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { dispatch, subjectAccountId } from "@fenel/core";
import { getSubject, getAuthority } from "../middleware/auth";

const importRoutes = new Hono();

/**
 * POST /imports/profiles
 * Body: { format: "csv"|"json", data: string, mapping?: {...}, tags?: string[], merge?: boolean }
 */
importRoutes.post("/profiles", async (c) => {
  const subject = getSubject(c);
  const accountId = subjectAccountId(subject);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  const body = await c.req.json();

  const result = await dispatch("import_profiles", body, {
    authority: await getAuthority(c),
    accountId,
    adapter: "api",
  });

  if (!result.success) {
    return c.json({ error: "Import failed", details: result.data }, 400);
  }

  return c.json(result.data);
});

export { importRoutes };
