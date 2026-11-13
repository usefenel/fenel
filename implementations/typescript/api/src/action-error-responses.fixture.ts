import assert from "node:assert/strict";
import { mock } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { ValidationError } from "@fenel/core/errors";

let failure: unknown;
mock.module("@fenel/core", () => ({
  dispatch: async () => { throw failure; },
  listActions: () => [],
  getAction: () => ({ name: "test" }),
  subjectAccountId: () => "test-account",
  ValidationError,
}));
// rights R2a — there is no `System` subject to mock any more, and the route
// reads an AUTHORITY rather than a subject. The stub returns a branded object
// that is not in the mint table; that is fine here because `dispatch` itself is
// mocked to throw, so the authority is never exercised — what this fixture pins
// is the ERROR MAPPING, and mocking the mint would be mocking the thing under
// test in the sibling pins rather than in this one.
mock.module("./middleware/auth", () => ({
  getSubject: () => ({ $tag: "Anonymous" }),
  getAuthority: async () => ({}) as never,
}));
const { actionRoutes } = await import("./routes/actions");

async function responseFor(error: unknown) {
  failure = error;
  const response = await actionRoutes.request("http://local/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: {} }),
  });
  return { status: response.status, body: await response.json() };
}

const rawDatabaseError = Object.assign(new Error("secret-token violates accounts constraint"), { code: "23505" });
const queryError = new DrizzleQueryError("insert into accounts values ($1)", ["secret-token"], rawDatabaseError);
for (const error of [
  queryError,
  rawDatabaseError,
  new Error(`Action failed: ${queryError.message}`, { cause: queryError }),
  new Error(`Action failed: ${rawDatabaseError.message}`, { cause: rawDatabaseError }),
]) {
  assert.deepEqual(await responseFor(error), {
    status: 500,
    body: { success: false, error: "Database operation failed" },
  });
}

const issues = [{ path: "email", message: "A valid email is required" }];
assert.deepEqual(await responseFor(new ValidationError(issues)), {
  status: 422,
  body: { error: "Validation failed", errors: issues },
});

const domainError = new Error("Inventory is unavailable");
// An unusual cyclic cause must not hang error handling.
domainError.cause = domainError;
assert.deepEqual(await responseFor(domainError), {
  status: 422,
  body: { success: false, error: "Inventory is unavailable" },
});
assert.deepEqual(await responseFor(null), {
  status: 422,
  body: { success: false, error: "Unknown error" },
});
