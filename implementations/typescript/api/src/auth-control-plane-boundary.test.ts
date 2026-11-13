import { describe, expect, test, spyOn } from "bun:test";
import * as runtimeApi from "@fenel/runtime";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { Hono } from "hono";
import {
  anonymousSubject,
  botSubject,
  userSubject,
  type Subject,
} from "@fenel/core";
import type { FenelType } from "@fenel/engine/types";
import {
  authMiddleware,
  getAuthenticatedUserAccountId,
  getSubject,
  type SessionInfo,
} from "./middleware/auth";
import {
  dashboardRoutes,
  typeOwnerDefinitionFromValidated,
} from "./routes/dashboard";
import { fieldDefinitionBundleRoutes } from "./routes/field-definition-bundles";
import { queryRoutes } from "./routes/query";

const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000003";

const matchingSession: SessionInfo = {
  id: "40000000-0000-4000-8000-000000000004",
  accountId,
  userId,
  role: "owner",
  membershipId: "50000000-0000-4000-8000-000000000005",
};

function authenticatedApp(route: Hono): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("subject" as never, userSubject(accountId, userId) as never);
    c.set("session" as never, matchingSession as never);
    await next();
  });
  app.route("/", route);
  return app;
}

async function resolvedAccount(
  subject: Subject,
  session?: SessionInfo,
): Promise<unknown> {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("subject" as never, subject as never);
    if (session !== undefined) c.set("session" as never, session as never);
    await next();
  });
  app.get("/", (c) => c.json({ accountId: getAuthenticatedUserAccountId(c) ?? null }));
  const response = await app.request("http://local/");
  return (await response.json() as { accountId: unknown }).accountId;
}

describe("authenticated account and Field control-plane boundaries", () => {
  test("X-Account-Id remains a tenant selector and never creates an actor", async () => {
    const app = new Hono();
    app.use("*", authMiddleware);
    app.get("/", (c) => c.json({
      tag: getSubject(c).$tag,
      accountId: getAuthenticatedUserAccountId(c) ?? null,
    }));

    const response = await app.request("http://local/", {
      headers: { "X-Account-Id": accountId },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tag: "Anonymous", accountId: null });
  });

  test("only a User whose identity matches the resolved session yields an account", async () => {
    expect(await resolvedAccount(userSubject(accountId, userId), matchingSession)).toBe(accountId);
    expect(await resolvedAccount(
      userSubject(accountId, userId),
      { ...matchingSession, accountId: otherAccountId },
    )).toBeNull();
    expect(await resolvedAccount(userSubject(accountId, "other-user"), matchingSession)).toBeNull();
    expect(await resolvedAccount(userSubject(accountId, userId))).toBeNull();
    expect(await resolvedAccount(botSubject(accountId, "api"), matchingSession)).toBeNull();
    expect(await resolvedAccount(anonymousSubject(), matchingSession)).toBeNull();
  });

  test("spoofed account headers cannot enter definition, dashboard, or query routes", async () => {
    const app = new Hono();
    app.use("*", authMiddleware);
    app.route("/definitions", fieldDefinitionBundleRoutes);
    app.route("/dashboard", dashboardRoutes);
    app.route("/query", queryRoutes);
    const init = { headers: { "X-Account-Id": accountId, "If-None-Match": "*" } };

    const [definitions, dashboard, query, functions] = await Promise.all([
      app.request("http://local/definitions", init),
      app.request("http://local/dashboard/types", init),
      app.request("http://local/query/schema", init),
      app.request("http://local/dashboard/functions", init),
    ]);

    expect(definitions.status).toBe(401);
    expect(dashboard.status).toBe(401);
    expect(query.status).toBe(401);
    expect(functions.status).toBe(401);
    expect(dashboard.headers.has("etag")).toBe(false);
    expect(functions.headers.has("etag")).toBe(false);
  });

  test("generic entity and facet routes cannot mutate Field control-plane rows", async () => {
    // The fixture account has no private definitions. Route decoding now reads
    // its registry before reaching the write guard; keep that read DB-less.
    const registryRead = spyOn(runtimeApi, "getRuntimeAccountFieldRegistry").mockResolvedValue(getSystemRegistry());
    try {
    const app = authenticatedApp(dashboardRoutes);
    const jsonHeaders = { "content-type": "application/json" };

    const [field, genericFacet, dispatchFacet, specFacet] = await Promise.all([
      app.request("http://local/entity-instances/Field", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ data: {} }),
      }),
      app.request("http://local/entity-instances/Labelable", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          data: {
            type: "Labelable",
            args: [crypto.randomUUID()],
            targetEntityType: "Field",
            methods: { label: "bypass" },
          },
        }),
      }),
      app.request("http://local/dispatch-instances", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          typeName: "Labelable",
          args: [crypto.randomUUID()],
          targetEntityType: "Field",
          instance: { methods: { label: "bypass" } },
        }),
      }),
      app.request("http://local/spec-instances", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          typeName: "Codeable",
          args: [crypto.randomUUID()],
          targetEntityType: "Field",
          instance: { methods: { codeName: "bypass" } },
        }),
      }),
    ]);

    expect(field.status).toBe(409);
    expect(genericFacet.status).toBe(409);
    expect(dispatchFacet.status).toBe(409);
    expect(specFacet.status).toBe(409);
    } finally {
      registryRead.mockRestore();
    }
    // rights R2a — the dashboard middleware mints the request authority, which
    // warms the account execution registry. In production that build is paid by
    // the first dashboard request of a process and memoised; here it lands on a
    // request that is REJECTED before any IO, which is the one case where the
    // mint adds work that used not to happen.
  }, 300_000);

  test("the type authoring API carries validated render-template metadata", () => {
    const type: FenelType = { $record: { fields: [] } };
    expect(typeOwnerDefinitionFromValidated("contact", {
      type,
      defaultTemplate: "contact-card",
      defaultTemplateInline: "contact-inline",
    })).toEqual({
      id: "contact",
      type,
      defaultTemplate: "contact-card",
      defaultTemplateInline: "contact-inline",
    });
    expect(typeOwnerDefinitionFromValidated("contact", { type })).toEqual({
      id: "contact",
      type,
    });
  });
});
