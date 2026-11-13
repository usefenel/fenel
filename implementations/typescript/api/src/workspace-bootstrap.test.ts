import { describe, expect, test } from "bun:test";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { viewModule } from "../../engine/src/modules/view";
import { pictureModule } from "@fenel/engine/modules/picture";
import { invokeCallable } from "@fenel/engine/expressions";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import type { LocusRoot } from "@fenel/db";
import { projectWorkspaceBootstrap, projectWorkspaceAllDataRoot } from "./workspace-bootstrap";
import { projectAllDataRoot } from "../../../../distros/narthex/solid/src/lib/all-data-root";
import { workspaceProjectionModelFor } from "../../../../distros/narthex/solid/src/lib/workspace-projection-model";
import { createWorkspaceBootstrapRoutes, type WorkspaceBootstrapDependencies } from "./routes/workspace-bootstrap";
import { NATIVE_JSON_HEADER } from "./native-json";

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEFAULT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WORKSPACE_TYPE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TARGET_TYPE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const registry = createRegistry([stdModule, pictureModule, viewModule], {
  // Type rows are keyed by their owner (per-owner type identity).
  codeNameLock: new Map([["type/module/view/WorkspacePreferences", WORKSPACE_TYPE],
    ["type/module/view/WorkspacePresentationTarget", TARGET_TYPE]]),
});
const context = registry.evaluateContext();
const run = (name: string, ...args: unknown[]): any => {
  const fn = registry.getFunction(`view.${name}`);
  if (!fn) throw new Error(`Missing ${name}`);
  return invokeCallable({ $ref: fn.id }, args, context);
};
const workspace = () => run("defaultWorkspace", "saved-lens", { $tag: "AccountSource", accountId: OTHER });
const root = (items: LocusRoot["items"] = [], expressions: LocusRoot["expressions"] = {}): LocusRoot => ({
  id: PERSONAL, name: "Personal data", type: { $ref: "Anything" }, expr: { kind: "literal", value: [] },
  revision: 7, persisted: true, layout: { kind: "grid" }, items, lists: [], expressions, referenceId: `locus:${PERSONAL}`,
});
const saved = (value = workspace()) => ({ id: "preferences", valueType: { $ref: WORKSPACE_TYPE },
  source: { kind: "expr", expr: { kind: "literal", value } } });
const project = (data: Parameters<typeof projectWorkspaceBootstrap>[0], defaultAccount = DEFAULT, identity = "new-lens", width = 390) =>
  projectWorkspaceBootstrap(data, defaultAccount, identity, width, registry);

describe("workspace bootstrap model boundary", () => {
  test("all-data projection preserves Fenel targets, canonical types and the admitted account roster", () => {
    const accounts = { currentAccountId: DEFAULT, accounts: [
      { accountId: PERSONAL, name: "Private settings", slug: "personal", role: "personal" },
      { accountId: DEFAULT, name: "Default", slug: "default", role: "member" },
      { accountId: OTHER, name: "", slug: "other", role: "viewer" },
    ] };
    const projected = projectWorkspaceAllDataRoot(accounts, PERSONAL, registry);
    expect(projected).toMatchObject({ id: "all-data", persisted: false, canEdit: false,
      items: [{ id: "public", caption: "Fenel", representations: { Iconable: { icon: "globe" } } },
        { id: "local", caption: "Local", representations: { Iconable: { icon: "monitor" } } },
        { id: DEFAULT, caption: "Default" }, { id: OTHER, caption: "other" }] });
    expect(projected.items.map(item => item.valueType)).toEqual(projected.items.map(() => ({ $ref: TARGET_TYPE })));
    expect(projected.typeDescriptions?.length).toBeGreaterThan(0);
    expect(projected.expr).toEqual({ kind: "literal", value: run("allDataRootTargets", [
      { $tag: "PublicSource" }, { $tag: "ThisTabSource" },
      { $tag: "AccountSource", accountId: DEFAULT }, { $tag: "AccountSource", accountId: OTHER },
    ]) });
    const own = projectWorkspaceAllDataRoot({ ...accounts, currentAccountId: PERSONAL }, PERSONAL, registry);
    expect(own.items.map(item => item.id)).toContain(PERSONAL);
    expect(projected.items.find(item => item.id === DEFAULT)!.representations).not.toHaveProperty("Iconable");
    // The API and already-running browser use the same admitted occurrences.
    // A source-defined custom icon or an explicit empty icon must survive;
    // source captions and data types never invent an Iconable instance.
    const browser = projectAllDataRoot(workspaceProjectionModelFor(() => ({ registry, evaluateContext: context })), [
      { id: "public", label: "Fenel", icon: "globe" }, { id: "local", label: "Local", icon: "monitor" },
      { id: DEFAULT, label: "Default" }, { id: OTHER, label: "other" },
    ]);
    expect(browser.items).toEqual(projected.items);
    const overrides = projectAllDataRoot(workspaceProjectionModelFor(() => ({ registry, evaluateContext: context })), [
      { id: "local", label: "Renamed local data", icon: "star" }, { id: DEFAULT, label: "No icon" },
      { id: OTHER, label: "Cleared icon", icon: "" },
    ]);
    expect(overrides.items.map(item => item.representations.Iconable)).toEqual([{ icon: "star" }, undefined, { icon: "" }]);
  });

  test("marshals the actual nominal type and literal reference without changing source or focus", () => {
    const value = workspace();
    value.lenses[0].focus = { $tag: "ValueFocus", listId: "list", itemId: "value", rootItem: false,
      path: [{ $tag: "FieldStep", name: "details" }], passThrough: [0] };
    const data = root([{ id: "preferences", valueType: { $ref: WORKSPACE_TYPE },
      source: { kind: "ref", ref: { id: "stored" } } }], { stored: { kind: "literal", value } });
    const result = project(data);
    expect(result).toMatchObject({ $tag: "Ok", _0: { $tag: "Just", _0: {
      value, valueType: { $ref: WORKSPACE_TYPE }, itemId: Just("preferences"),
      visibleLenses: [value.lenses[0]], activeLens: Just(value.lenses[0]),
    } } });
    expect(data.items[0]!.source).toEqual({ kind: "ref", ref: { id: "stored" } });
  });

  test("never invokes unrelated expressions or declared computed preferences", () => {
    const expression = { kind: "call", fnId: "must-never-execute", args: [] };
    const unrelated = project(root([{ id: "unrelated", expr: expression }]));
    expect(unrelated).toMatchObject({ $tag: "Ok", _0: { $tag: "Just", _0: {
      itemId: Nothing, value: run("workspaceDefaultForAccount", "new-lens", Just(DEFAULT)),
    } } });
    for (const expr of [expression, { kind: "literal", value: { __apply: { target: expression, args: [] } } }]) {
      expect(project(root([{ id: "computed", valueType: { $ref: WORKSPACE_TYPE }, expr }]))).toEqual({ $tag: "Ok", _0: Nothing });
    }
  });

  test("keeps recognized malformed values and duplicate occurrences as Fenel errors", () => {
    expect(project(root([saved({ ...workspace(), activeLensId: "missing" })]))).toEqual({
      $tag: "Err", _0: "The selected lens is no longer in the workspace.",
    });
    expect(project(root([saved(), { ...saved(), id: "second" }])).$tag).toBe("Err");
  });

  test("unknown declared expression values defer while untyped literals use the existing recognizer", () => {
    expect(project(root([{ id: "typed", valueType: { $ref: WORKSPACE_TYPE }, expr: { kind: "literal", value: 42 } }]))).toEqual({ $tag: "Ok", _0: Nothing });
    expect(project(root([{ id: "untyped", expr: { kind: "literal", value: workspace() } }]))).toMatchObject({
      $tag: "Ok", _0: { $tag: "Just", _0: { itemId: Just("untyped") } },
    });
  });
});

function fixture(overrides: Partial<WorkspaceBootstrapDependencies> = {}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const data = root([saved()]);
  const dependencies: WorkspaceBootstrapDependencies = {
    reader: () => ({ accountId: PERSONAL, role: "personal", token: "authenticated-token" }),
    personalAccount: async token => { calls.push({ operation: "personal", value: token }); return { kind: "ready", accountId: PERSONAL }; },
    readRoot: async () => { calls.push({ operation: "read", value: PERSONAL }); return data; },
    canEdit: async (_context, id) => { calls.push({ operation: "permits", value: id }); return false; },
    accounts: async token => { calls.push({ operation: "accounts", value: token }); return {
      currentAccountId: DEFAULT, accounts: [{ accountId: DEFAULT, name: "Default", slug: "default", role: "member" }],
    }; },
    identity: () => "fresh",
    project: (value, account, identity, width) => { calls.push({ operation: "plan", value: { account, identity, width } }); return project(value, account, identity, width); },
    projectAllData: (accounts, personal) => {
      calls.push({ operation: "locations", value: { accounts, personal } });
      return projectWorkspaceAllDataRoot(accounts, personal, registry);
    },
    ...overrides,
  };
  return { app: createWorkspaceBootstrapRoutes(dependencies), calls, data };
}
const payload = async (response: Response): Promise<any> =>
  decodeCheckpointValue(await response.json(), response.headers.get(NATIVE_JSON_HEADER));

describe("workspace bootstrap HTTP and reader boundary", () => {
  test("requires an authenticated personal reader before reaching any data operation", async () => {
    for (const reader of [() => undefined, () => ({ accountId: OTHER, role: "owner", token: "token" })]) {
      const f = fixture({ reader });
      expect((await f.app.request("/workspace-bootstrap?accountId=spoofed&userId=spoofed")).status).toBe(reader() ? 403 : 401);
      expect(f.calls).toEqual([]);
    }
  });

  test("checks the token user's actual personal identity before reading the requested root", async () => {
    const f = fixture({ personalAccount: async token => {
      expect(token).toBe("authenticated-token"); return { kind: "ready", accountId: OTHER };
    } });
    expect((await f.app.request("/workspace-bootstrap?personalAccountId=" + PERSONAL)).status).toBe(403);
    expect(f.calls).toEqual([]);
  });

  test("returns the original personal root and exact saved plan without reading a referenced account", async () => {
    const f = fixture();
    const response = await f.app.request("/workspace-bootstrap?width=390&accountId=spoofed");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    const body = await payload(response);
    expect(body).toMatchObject({ accountId: DEFAULT, personalAccountId: PERSONAL,
      root: { id: PERSONAL, revision: 7, canEdit: false },
      workspace: { status: "ready", itemId: "preferences", valueType: { $ref: WORKSPACE_TYPE },
        visibleLenses: [{ source: { $tag: "AccountSource", accountId: OTHER } }] },
      allDataRoot: { id: "all-data", canEdit: false, items: [{ id: "public" }, { id: "local" }, { id: DEFAULT }] },
    });
    expect(f.calls.filter(call => call.operation === "read")).toEqual([{ operation: "read", value: PERSONAL }]);
    expect(f.calls.find(call => call.operation === "plan")!.value).toEqual({ account: DEFAULT, identity: "fresh", width: 390 });
  });

  test("a default is explicitly unsaved and uses the authenticated account list", async () => {
    const f = fixture({ readRoot: async () => root() });
    const body = await payload(await f.app.request("/workspace-bootstrap?defaultAccountId=spoofed"));
    expect(body.workspace.status).toBe("ready");
    expect(body.workspace).not.toHaveProperty("itemId");
    expect(body.workspace.value.lenses[0].source).toEqual({ $tag: "AllDataSource" });
    expect(body.root.revision).toBe(7);
  });

  test("the fast path defers computed preferences and exposes validation failures without a replacement", async () => {
    const deferred = fixture({ readRoot: async () => root([{ id: "computed", valueType: { $ref: WORKSPACE_TYPE },
      expr: { kind: "call", fnId: "must-never-execute", args: [] } }]) });
    expect((await payload(await deferred.app.request("/workspace-bootstrap"))).workspace).toEqual({ status: "deferred" });
    const invalid = fixture({ readRoot: async () => root([saved({ ...workspace(), activeLensId: "missing" })]) });
    const response = await invalid.app.request("/workspace-bootstrap");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "The selected lens is no longer in the workspace." });
    expect(invalid.calls.some(call => call.operation === "permits")).toBe(false);
  });

  test("expired authentication, personal-link refusal, and invalid widths never produce a plan", async () => {
    const expired = fixture({ accounts: async () => null });
    expect((await expired.app.request("/workspace-bootstrap")).status).toBe(401);
    expect(expired.calls.some(call => call.operation === "plan")).toBe(false);
    const refused = fixture({ personalAccount: async () => ({ kind: "refused", status: 409, message: "Personal link is unavailable" }) });
    expect((await refused.app.request("/workspace-bootstrap")).status).toBe(409);
    expect(refused.calls).toEqual([]);
    for (const width of ["0", "-1", "NaN", "Infinity", "text"]) {
      const f = fixture();
      expect((await f.app.request(`/workspace-bootstrap?width=${width}`)).status).toBe(400);
      expect(f.calls).toEqual([]);
    }
  });

  test("root read refusal and conflict are never substituted with a default workspace", async () => {
    const conflict = fixture({ readRoot: async () => { const error = new Error("Both versions were preserved"); error.name = "LocusRootConflict"; throw error; } });
    expect((await conflict.app.request("/workspace-bootstrap")).status).toBe(409);
    expect(conflict.calls.some(call => call.operation === "plan")).toBe(false);
    const denied = fixture({ readRoot: async () => { throw new Error("Read refused"); } });
    denied.app.onError((_error, context) => context.json({ error: "Read refused" }, 403));
    expect((await denied.app.request("/workspace-bootstrap")).status).toBe(403);
    expect(denied.calls.some(call => call.operation === "plan")).toBe(false);
  });

  test("an abandoned request cannot project a late personal-root response", async () => {
    let release!: (value: LocusRoot) => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const f = fixture({ readRoot: () => { started(); return new Promise(resolve => { release = resolve; }); } });
    f.app.onError(() => new Response("aborted", { status: 499 }));
    const controller = new AbortController();
    const response = f.app.request(new Request("http://fixture/workspace-bootstrap", { signal: controller.signal }));
    await reading;
    controller.abort();
    release(root());
    expect((await response).status).toBe(499);
    expect(f.calls.some(call => call.operation === "plan")).toBe(false);
    expect(f.calls.some(call => call.operation === "permits")).toBe(false);
    expect(f.calls.some(call => call.operation === "locations")).toBe(false);
  });
});
