import { expect, test } from "bun:test";
import { Hono } from "hono";
import { PublicFieldRegistryBundleError } from "../public-field-registry-bundle";

// Exercise the actual HTTP route with held host seams. Bounded public reads
// must not depend on copied durable function rows in the publishing account.
const source = await Bun.file(new URL("./pages.ts", import.meta.url)).text();
const start = source.indexOf("const pageRoutes = new Hono();");
if (start < 0) throw new Error("Public page route initialization changed");
const routeCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start))
  .replace(/export \{\s*pageRoutes\s*\};?/, "");

function fixture(options: { missingPage?: boolean; missingForm?: boolean; missingType?: boolean; missingTypeName?: boolean; changedType?: boolean } = {}) {
  const calls: Array<{ action: string; authority: unknown; execution?: unknown }> = [];
  const acquisition = { source: "acquisition" };
  const lane = { source: "published-page" };
  const publicType = { $record: { fields: [] } };
  const rootBinding = { origin: "repository", id: "Profile", name: "Profile" };
  const snapshot = { owners: [], fields: [], facets: [] };
  const publishedPage = {
    id: "page-id", accountId: "publisher", slug: "join", name: "Join",
    published: true, config: {}, blocks: options.missingForm ? [] : [{ type: "form", typeRef: "Profile", submitLabel: "Join" }],
  };
  const route = new Function("Hono", "invokeIOActionAs", "invokeIOActionEphemeral", "mintAcquisitionAuthorityFor", "mintLaneAuthorityFor", "loadPublicFieldRegistryBundle", "PublicFieldRegistryBundleError",
    `${routeCode}; return pageRoutes;`)(
    Hono,
    async (authority: unknown, profile: unknown, action: string, params: Record<string, unknown>, execution?: unknown) => {
      expect(authority).toBe(lane);
      expect(profile).toBeNull();
      calls.push({ action, authority, execution });
      if (action !== "pages:pageView") throw new Error(`Unexpected public read action: ${action}`);
      if (!execution || (execution as { persistence?: string }).persistence !== "ephemeral") {
        throw new Error("No copied active function row in this publisher account");
      }
      expect(params.typeRef).toBe("Profile");
      return options.missingType ? { $tag: "Nothing" } : { $tag: "Just", _0: {
        page: { slug: "join", name: "Join", config: {} },
        form: { typeName: options.missingTypeName ? undefined : "Profile", typeRef: "Profile", type: publicType, submitLabel: "Join", rootBinding },
      } };
    },
    async (authority: unknown, partition: string, profile: unknown, action: string, params: Record<string, unknown>) => {
      expect(authority).toBe(acquisition);
      expect(partition).toBe("");
      expect(profile).toBeNull();
      expect(action).toBe("state:getPageBySlug");
      expect(params).toEqual({ accountSlug: "mock-store", pageSlug: "join" });
      calls.push({ action, authority });
      return options.missingPage ? { $tag: "Nothing" } : { $tag: "Just", _0: publishedPage };
    },
    (partition: string) => { expect(partition).toBe(""); return acquisition; },
    async (accountId: string, kind: string) => { expect(accountId).toBe("publisher"); expect(kind).toBe("pages"); return lane; },
    async (accountId: string, name: string, type: unknown, binding: unknown) => {
      expect(accountId).toBe("publisher"); expect(name).toBe("Profile"); expect(type).toBe(publicType);
      expect(binding).toBe(rootBinding);
      calls.push({ action: "field-registry", authority: lane });
      if (options.changedType) throw new PublicFieldRegistryBundleError("RootTypeChanged", "internal changed-root detail");
      return { rootTypeName: name, snapshot };
    },
    PublicFieldRegistryBundleError,
  ) as Hono;
  return { app: new Hono().route("/p", route), calls, lane, snapshot };
}

test("published page GET runs under its unchanged lane authority without copied durable function rows", async () => {
  const f = fixture();
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.page.name).toBe("Join");
  expect(body.form.typeName).toBe("Profile");
  expect(body.fieldRegistry).toEqual({ rootTypeName: "Profile", snapshot: f.snapshot });
  expect(body.form).not.toHaveProperty("rootBinding");
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug", "pages:pageView", "field-registry"]);
  expect(f.calls[1]).toEqual({ action: "pages:pageView", authority: f.lane, execution: { persistence: "ephemeral" } });
});

test("missing published page performs no page-body or registry projection", async () => {
  const f = fixture({ missingPage: true });
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Page not found" });
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug"]);
});

test("a published page without a form performs no page-body or registry projection", async () => {
  const f = fixture({ missingForm: true });
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Page has no form" });
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug"]);
});

test("unavailable resolved type remains 404 before registry projection", async () => {
  const f = fixture({ missingType: true });
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Type not found: Profile" });
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug", "pages:pageView"]);
});

test("a missing canonical type name remains an error before registry projection", async () => {
  const f = fixture({ missingTypeName: true });
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Resolved type name missing" });
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug", "pages:pageView"]);
});

test("a page root changed between reads returns the existing unavailable-type response without schema", async () => {
  const f = fixture({ changedType: true });
  const response = await f.app.request("/p/mock-store/join");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Type not found: Profile" });
  expect(f.calls.map(call => call.action)).toEqual(["state:getPageBySlug", "pages:pageView", "field-registry"]);
});

const formsSource = await Bun.file(new URL("./forms.ts", import.meta.url)).text();
const formsStart = formsSource.indexOf("const formRoutes = new Hono();");
if (formsStart < 0) throw new Error("Public form route initialization changed");
const formsCode = new Bun.Transpiler({ loader: "ts" }).transformSync(formsSource.slice(formsStart))
  .replace(/export \{\s*formRoutes\s*\};?/, "");

function formFixture(changedType = false) {
  const calls: string[] = [];
  const rootBinding = { origin: "account", id: "canonical-row", name: "CanonicalType" };
  const rowType = { $record: { fields: [] } };
  const route = new Function("Hono", "invokeIOActionAs", "invokeIOActionEphemeral", "mintAcquisitionAuthorityFor", "mintLaneAuthorityFor", "loadPublicFieldRegistryBundle", "PublicFieldRegistryBundleError",
    `${formsCode}; return formRoutes;`)(
    Hono,
    async (authority: string, profile: unknown, action: string, params: unknown) => {
      expect(authority).toBe("published-form"); expect(profile).toBeNull();
      expect(action).toBe("types:formView"); expect(params).toEqual({ typeId: "canonical-row" });
      calls.push(action);
      return { $tag: "Just", _0: { slug: "CanonicalType", typeName: "CanonicalType", type: rowType, config: {}, rootBinding } };
    },
    async (authority: string, accountId: string, profile: unknown, action: string, params: unknown) => {
      expect(authority).toBe("acquisition"); expect(accountId).toBe("publisher"); expect(profile).toBeNull();
      expect(action).toBe("types:embedResolve"); expect(params).toEqual({ slug: "public-alias" });
      calls.push(action);
      return { $tag: "Just", _0: { id: "canonical-row", name: "CanonicalType", type: rowType } };
    },
    (accountId: string) => { expect(accountId).toBe("publisher"); return "acquisition"; },
    async (accountId: string, kind: string) => { expect(accountId).toBe("publisher"); expect(kind).toBe("forms"); return "published-form"; },
    async (accountId: string, name: string, type: unknown, binding: unknown) => {
      expect(accountId).toBe("publisher"); expect(name).toBe("CanonicalType"); expect(type).toBe(rowType); expect(binding).toBe(rootBinding);
      calls.push("field-registry");
      if (changedType) throw new PublicFieldRegistryBundleError("RootTypeChanged", "internal changed-root detail");
      return { rootTypeName: name, snapshot: { owners: [], fields: [], facets: [] } };
    },
    PublicFieldRegistryBundleError,
  ) as Hono;
  return { app: new Hono().route("/embed/forms", route), calls };
}

test("published form GET carries its exact internal binding and strips it from the public response", async () => {
  const f = formFixture();
  const response = await f.app.request("/embed/forms/public-alias", { headers: { "X-Account-Id": "publisher" } });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.slug).toBe("public-alias");
  expect(body.typeName).toBe("CanonicalType");
  expect(body).not.toHaveProperty("rootBinding");
  expect(JSON.stringify(body)).not.toContain("canonical-row");
  expect(f.calls).toEqual(["types:embedResolve", "types:formView", "field-registry"]);
});

test("a published form changed between reads retains the indistinguishable 404 and serves no schema", async () => {
  const f = formFixture(true);
  const response = await f.app.request("/embed/forms/public-alias", { headers: { "X-Account-Id": "publisher" } });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Form not found" });
  expect(f.calls).toEqual(["types:embedResolve", "types:formView", "field-registry"]);
});
