import assert from "node:assert/strict";
import { mock } from "bun:test";

const accountId = "routing-test-account";
let authenticated = true;
const calls: { accountId: string; action: string; params: Record<string, unknown> }[] = [];
const unexpected = () => { throw new Error("Unexpected mutation or registry load"); };
mock.module("@fenel/runtime", () => ({
  mintLaneAuthorityFor: async () => ({}) as never,
  mintInterimWorkerAuthority: () => ({}) as never,
  AUTHORITY_REFUSED_ERROR_KIND: "authority-refused",
  startFunctionInstance: unexpected,
  startFunctionInstanceByName: unexpected,
  FunctionStartUnavailable: class extends Error {},
  getRuntimeAccountFieldRegistry: unexpected,
  // rights R2a — the routes call `invokeIOActionAs(authority, …)`. The first
  // argument is now an opaque handle, so the recorded account comes from the
  // fixture rather than from the call.
  invokeIOActionAs: async (_authority: unknown, _profile: string | null, action: string, params: Record<string, unknown>) => {
    calls.push({ accountId, action, params });
    if (action === "dashboard:functionLiveCountsBody") return { example: { running: 2, waiting: 1 } };
    if (action === "dashboard:getFunctionDetail") return { $tag: "Just", _0: { name: params.name } };
    throw new Error(`Unexpected action: ${action}`);
  },
}));
mock.module("./middleware/auth", () => ({
  getAuthenticatedUserAccountId: () => authenticated ? accountId : undefined,
  // rights R2a — the dashboard middleware mints here. The routes under test
  // stub every IO leaf, so an opaque handle is all they need.
  getAuthority: async () => ({}) as never,
}));
mock.module("./field-definition-command", () => ({ executeFieldDefinitionCommand: unexpected }));
const { dashboardRoutes } = await import("./routes/dashboard");

const counts = await dashboardRoutes.request("http://local/functions/live-counts");
assert.equal(counts.status, 200);
assert.deepEqual(await counts.json(), { counts: { example: { running: 2, waiting: 1 } } });
assert.deepEqual(calls, [{ accountId, action: "dashboard:functionLiveCountsBody", params: {} }]);

const detail = await dashboardRoutes.request("http://local/functions/example");
assert.equal(detail.status, 200);
assert.deepEqual(await detail.json(), { definition: { name: "example" } });
assert.deepEqual(calls[1], { accountId, action: "dashboard:getFunctionDetail", params: { accountId, name: "example" } });

authenticated = false;
const denied = await dashboardRoutes.request("http://local/functions/live-counts");
assert.equal(denied.status, 401);
assert.equal(calls.length, 2, "unauthenticated counts must not call the runtime");
console.log("PASS live counts, function details and authentication routing");
