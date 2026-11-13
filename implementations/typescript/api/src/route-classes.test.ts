// GP-25 — THE ROUTE CENSUS. Walks every route the Hono app registers and fails
// when one has no rate-limit class, so a new route cannot ship unclassified.
// It imports the real app (and so the runtime), but serves no request that
// reaches a database.

import { describe, expect, it } from "bun:test";
import { classifyRoute } from "./middleware/route-classes";
import { RATE_LIMIT_SESSION_COOKIE } from "./middleware/rate-limit";

describe("route census (GP-25)", () => {
  it("gives every registered route a class", async () => {
    const { app } = await import("./index");
    const unclassified: string[] = [];
    let seen = 0;
    for (const route of app.routes) {
      // `app.use("*")` and friends register as ALL on a wildcard path: they
      // are middleware, not routes.
      if (route.method === "ALL" && route.path.endsWith("*")) continue;
      seen++;
      if (classifyRoute(route.method, route.path) === undefined) {
        unclassified.push(`${route.method} ${route.path}`);
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(unclassified).toEqual([]);
  });

  it("keeps the limiter's session cookie name in step with the auth middleware", async () => {
    const { SESSION_COOKIE } = await import("./middleware/auth");
    expect(RATE_LIMIT_SESSION_COOKIE).toBe(SESSION_COOKIE);
  });

  it("answers 413, not 500, when the SES webhook body is over its cap", async () => {
    const { app } = await import("./index");
    const res = await app.request("/webhooks/ses/some-integration/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "192.0.2.99",
      },
      body: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });
});
