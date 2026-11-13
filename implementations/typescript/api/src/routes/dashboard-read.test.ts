import { expect, test } from "bun:test";
import { Hono } from "hono";

// Keep the actual bounded read wrappers and execution-mode helper while
// controlling only the host invocation. No repository bootstrap or database
// function copies are needed for these one-response analytics calls.
const source = await Bun.file(new URL("./dashboard.ts", import.meta.url)).text();
const helperStart = source.indexOf("function invokeDataAction(");
const helperEnd = source.indexOf("\n}", helperStart) + 2;
const readStart = source.indexOf('dashboardRoutes.get("/stats",');
const readEnd = source.indexOf("// ---- Types", readStart);
if (helperStart < 0 || helperEnd < 2 || readStart < 0 || readEnd < 0) throw new Error("Analytics route boundaries changed");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(helperStart, helperEnd) + "\n" + source.slice(readStart, readEnd));

const fixtures = [
  { path: "/stats", action: "dashboard:dashboardStats", value: { profiles: { total: 3 } } },
  { path: "/analytics/summary", action: "dashboard:analyticsSummary", value: { revenue: { totalCents: 1250 } } },
  { path: "/analytics/timeseries?days=7&type=page_view", action: "dashboard:analyticsTimeseriesBody",
    value: { timeseries: [{ day: new Date("2026-09-29T00:00:00.000Z"), type: "page_view", total: 2 }] } },
] as const;

for (const input of fixtures) {
  test(`${input.path} preserves its reader authority and returns without a durable checkpoint`, async () => {
    const authority = { reader: "current-account" };
    const calls: Array<{ authority: unknown; profile: unknown; action: string; args: Record<string, unknown>; execution: unknown }> = [];
    const routes = new Hono();
    new Function("dashboardRoutes", "authorityOf", "invokeIOActionAs", code)(
      routes,
      () => authority,
      async (actualAuthority: unknown, profile: unknown, action: string, args: Record<string, unknown>, execution: unknown) => {
        calls.push({ authority: actualAuthority, profile, action, args, execution });
        if (!execution || (execution as { persistence?: string }).persistence !== "ephemeral") {
          throw new Error("This read cannot depend on a durable function copy/checkpoint");
        }
        return input.value;
      },
    );
    const response = await routes.request(input.path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(input.value)));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.authority).toBe(authority);
    expect(calls[0]!.profile).toBeNull();
    expect(calls[0]!.action).toBe(input.action);
    expect(calls[0]!.execution).toEqual({ persistence: "ephemeral" });
    if (input.action === "dashboard:analyticsTimeseriesBody") {
      expect(calls[0]!.args.days).toBe(7);
      expect(calls[0]!.args.eventType).toEqual({ $tag: "Just", _0: "page_view" });
      expect(typeof calls[0]!.args.since).toBe("string");
    }
  });
}
