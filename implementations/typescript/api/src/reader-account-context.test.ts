// C1: the real auth Fenel chain and authority mint; only DB IO is replaced.
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";

const previousDatabase = process.env.DATABASE_URL;
const previousDbFirst = process.env.FENEL_STORAGE_DB_FIRST;
delete process.env.DATABASE_URL;
delete process.env.FENEL_STORAGE_DB_FIRST;

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIVATE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const V = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const db = await import("@fenel/db");
let live = true;
let accesses: string[] = [];
const memberships = new Map<string, { id: string; userId: string; accountId: string; role: string }>();
const sessionRow = (userId: string) => ({ id: `session-${userId}`, userId, accountId: A,
  tokenHash: "stored-hash", label: null, expiresAt: null, createdAt: new Date(0), lastUsedAt: null,
  membershipId: "credential-grant", role: "viewer", email: "person@example.test", name: null });
spyOn(db, "getSessionByHash").mockImplementation((async (tokenHash: string) => {
  accesses.push(tokenHash);
  if (!live) return null;
  return tokenHash === hash(TOKEN) ? sessionRow(U) : tokenHash === hash(OTHER) ? sessionRow(V) : null;
}) as never);
spyOn(db, "touchSession").mockImplementation((async () => {}) as never);
spyOn(db, "getMembership").mockImplementation((async (userId: string, accountId: string) => memberships.get(`${userId}:${accountId}`) ?? null) as never);
spyOn(db, "listAccountImports").mockImplementation((async () => []) as never);
spyOn(db, "insertTraces").mockImplementation((async () => {}) as never);
const { resolveReaderAccount, personalAccountForToken } = await import("@fenel/core");
const { authMiddleware, getAuthority, getSession } = await import("./middleware/auth");
const { authenticateAuthority } = await import("@fenel/engine/authority");
const { Ref } = await import("@fenel/engine/type-foundation");
const { invokeCallable, pureEvaluateContext } = await import("@fenel/engine/expressions");
const { invokeIOActionAs, invokeIOActionPrivileged, permitsIOActionAs, loadRegistry, resetRegistryCache } = await import("../../runtime/src/evaluator");
const { mintRequestAuthority } = await import("../../runtime/src/authority-mint");

afterAll(() => {
  if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
  if (previousDbFirst === undefined) delete process.env.FENEL_STORAGE_DB_FIRST; else process.env.FENEL_STORAGE_DB_FIRST = previousDbFirst;
  resetRegistryCache();
});
beforeEach(() => {
  live = true; accesses = []; memberships.clear();
  for (const [accountId, role] of [[A, "viewer"], [B, "member"], [PRIVATE, "personal"]]) {
    memberships.set(`${U}:${accountId}`, { id: `grant-${accountId}`, userId: U, accountId: accountId!, role: role! });
  }
  memberships.set(`${V}:${B}`, { id: "other-grant", userId: V, accountId: B, role: "owner" });
});
const LONG = 1_200_000;

function app() {
  const result = new Hono();
  result.use("*", authMiddleware);
  result.get("/context", async (context) => {
    const authority = authenticateAuthority(await getAuthority(context));
    return context.json({ accountId: authority?.accountId, principal: authority?.principal,
      grant: authority?.grant, session: getSession(context) });
  });
  return result;
}

describe("independent reader accounts", () => {
  test("two requests keep separate live grants without issuing a cookie", async () => {
    const server = app();
    for (const accountId of [A, B]) {
      const response = await server.request("/context", { headers: { authorization: `Bearer ${TOKEN}`,
        "X-Fenel-Reader-Account": accountId, "X-Fenel-Account": "obsolete-tab-account" } });
      expect(response.status).toBe(200);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(await response.json()).toMatchObject({ accountId, grant: `grant-${accountId}`,
        principal: { $tag: "User", userId: U, accountId }, session: { userId: U, accountId } });
    }
    const legacy = await server.request("/context", { headers: { authorization: `Bearer ${TOKEN}`, "X-Fenel-Account": B } });
    expect(legacy.status).toBe(409);
  }, LONG);

  test("revocation and role changes are observed on the next reader request", async () => {
    expect(await resolveReaderAccount(TOKEN, B)).toMatchObject({ kind: "ready", resolved: { session: { role: "member" } } });
    memberships.get(`${U}:${B}`)!.role = "viewer";
    expect(await resolveReaderAccount(TOKEN, B)).toMatchObject({ kind: "ready", resolved: { session: { role: "viewer" } } });
    memberships.delete(`${U}:${B}`);
    expect(await resolveReaderAccount(TOKEN, B)).toMatchObject({ kind: "refused", status: 403 });
    expect(await resolveReaderAccount(TOKEN, "not-an-id")).toMatchObject({ kind: "refused", status: 400 });
    live = false;
    expect(await resolveReaderAccount(TOKEN, A)).toMatchObject({ kind: "refused", status: 401 });
  }, LONG);

  test("a valid bearer denied the target never falls through to an authorized cookie user", async () => {
    memberships.delete(`${U}:${B}`);
    const response = await app().request("/context", { headers: { authorization: `Bearer ${TOKEN}`,
      cookie: `fenel_session=${OTHER}`, "X-Fenel-Reader-Account": B } });
    expect(response.status).toBe(403);
    expect(accesses).not.toContain(hash(OTHER));
    expect((await app().request("/context", { headers: { "X-Fenel-Reader-Account": B } })).status).toBe(401);
  }, LONG);
});

describe("personal storage stays private and carries only data rights", () => {
  test("a teammate cannot resolve the personal account; its own owner gets the personal role", async () => {
    expect(await resolveReaderAccount(OTHER, PRIVATE)).toMatchObject({ kind: "refused", status: 403 });
    expect(await resolveReaderAccount(TOKEN, PRIVATE)).toMatchObject({ kind: "ready", resolved: { session: { role: "personal" } } });
    const reg = loadRegistry();
    const personal = mintRequestAuthority(reg, { accountId: PRIVATE, role: "personal", membershipId: "personal-grant" });
    const envelope = authenticateAuthority(personal)!.envelope;
    const named = envelope as { rows: Array<{ descriptors: { values: string[] } }> };
    const registered = new Set(reg.listPerformDescriptors());
    for (const row of named.rows) for (const descriptor of row.descriptors.values) {
      expect(registered.has(descriptor), `unregistered personal descriptor: ${descriptor}`).toBe(true);
    }
    const permits = (descriptor: string, args: unknown[]) => reg.evaluateAuthorityFunction("authority:permits", [envelope,
      { $tag: "Act", descriptor, args, fields: [] }]);
    for (const descriptor of ["storage:dbLoad", "storage:dbList", "storage:dbStore", "storage:dbUpdate", "storage:dbDelete"]) {
      expect(permits(descriptor, [PRIVATE, "fixture", {}, "id"])).toEqual({ $tag: "Just", _0: true });
      expect(permits(descriptor, [A, "fixture", {}, "id"])).toEqual({ $tag: "Just", _0: false });
    }
    for (const descriptor of ["state:createMembership", "state:setMembershipRole", "state:deleteMembership",
      "state:ensurePersonalAccount", "state:createSession", "telegram:sendMessageText", "io:http_request"]) {
      expect(permits(descriptor, [{ accountId: PRIVATE, userId: U, role: "owner" }])).toEqual({ $tag: "Just", _0: false });
    }
    expect(await permitsIOActionAs(personal, "state:editLocusRoot", { id: PRIVATE, expectedRevision: 0, command: {} })).toBe(true);
    expect(await permitsIOActionAs(personal, "state:editLocusRoot", { id: A, expectedRevision: 0, command: {} })).toBe(false);
    await expect(invokeIOActionAs(personal, null, "state:createMembership", { userId: V, accountId: PRIVATE, role: "member" })).rejects.toThrow();
  }, LONG);

  test("the authenticated-token action creates one narrow private grant and never restores damage", async () => {
    const snapshots: unknown[] = [];
    let linked: string | undefined;
    let stored: Array<{ id: string; userId: string; accountId: string; role: string }> = [];
    let creates = 0;
    const ensure = spyOn(db, "ensurePersonalAccount").mockImplementation((async (userId: string, plan: import("@fenel/db").PersonalAccountPlanner) => {
      expect(userId).toBe(U);
      const snapshot = { users: [{ id: U, personalAccountId: linked === undefined
        ? { $tag: "Nothing" as const } : { $tag: "Just" as const, _0: linked } }], members: stored };
      snapshots.push(snapshot);
      const decision = await plan(snapshot);
      if (decision.$tag === "Err") return decision;
      const operation = decision._0;
      if (operation.$tag === "CreatePersonalAccount") {
        creates++;
        linked = operation.account.id;
        stored = [operation.membership];
        expect(operation.membership).toMatchObject({ userId: U, accountId: linked, role: "personal" });
        return { $tag: "Ok", _0: linked };
      }
      return { $tag: "Ok", _0: operation.accountId };
    }) as never);
    try {
      const first = await personalAccountForToken(TOKEN);
      expect(first).toMatchObject({ kind: "ready", accountId: expect.any(String) });
      expect(await personalAccountForToken(TOKEN)).toEqual(first);
      expect(creates).toBe(1);
      stored = [];
      expect(await personalAccountForToken(TOKEN)).toMatchObject({ kind: "refused", status: 409 });
      expect(creates).toBe(1);
      expect(snapshots).toHaveLength(3);
    } finally { ensure.mockRestore(); }
  }, LONG);

  test("ordinary storage cannot list or overwrite another user's personal values", async () => {
    const reg = loadRegistry();
    const own = mintRequestAuthority(reg, { accountId: PRIVATE, role: "personal", membershipId: "personal-grant" });
    const teammate = mintRequestAuthority(reg, { accountId: A, role: "owner", membershipId: "teammate-grant" });
    const made = await invokeIOActionAs(own, null, "state:tryCreateInstanceByName", {
      typeId: "UserProfile", value: { $tag: "UserProfile", email: "private@example.test", name: { $tag: "Nothing" } },
    }) as { ok: boolean; value: string; error?: string };
    expect(made.ok, made.error).toBe(true);
    expect(typeof made.value).toBe("string");
    const ownRead = await invokeIOActionAs(own, null, "state:getInstanceById", { id: made.value });
    expect(ownRead).toMatchObject({ $tag: "Just" });
    expect(await invokeIOActionAs(teammate, null, "state:getInstanceById", { id: made.value })).toEqual({ $tag: "Nothing" });
    const otherList = await invokeIOActionAs(teammate, null, "state:listInstancesByName", { typeName: "UserProfile", envelope: true });
    expect(JSON.stringify(otherList)).not.toContain("private@example.test");
    await expect(invokeIOActionAs(teammate, null, "state:updateInstance", {
      instanceId: made.value, value: { email: "overwritten@example.test" },
    })).rejects.toThrow();
    expect(await invokeIOActionAs(own, null, "state:getInstanceById", { id: made.value })).toEqual(ownRead);
  }, LONG);

  test("repository rule protects membership even when an owner calls a state leaf directly", async () => {
    const registry = loadRegistry();
    const existing = { id: "personal-grant", userId: U, accountId: PRIVATE, role: "personal" };
    let writes = 0;
    const create = spyOn(db, "createMembership").mockImplementation((async (input: { userId: string; accountId: string; role: string }, guard: import("@fenel/db").PersonalMembershipGuard) => {
      const decision = await guard({ owners: [U], members: [existing], mutation: { $tag: "AddMembership", userId: input.userId, role: input.role } });
      if (decision.$tag === "Err") throw new Error(decision._0);
      writes++; return existing;
    }) as never);
    const role = spyOn(db, "setMembershipRole").mockImplementation((async (userId: string, _account: string, nextRole: string, guard: import("@fenel/db").PersonalMembershipGuard) => {
      const decision = await guard({ owners: [U], members: [existing], mutation: { $tag: "SetMembershipRole", userId, role: nextRole } });
      if (decision.$tag === "Err") throw new Error(decision._0);
      writes++; return existing;
    }) as never);
    const remove = spyOn(db, "deleteMembership").mockImplementation((async (userId: string, _account: string, guard: import("@fenel/db").PersonalMembershipGuard) => {
      const decision = await guard({ owners: [U], members: [existing], mutation: { $tag: "RemoveMembership", userId } });
      if (decision.$tag === "Err") throw new Error(decision._0);
      writes++;
    }) as never);
    const owner = mintRequestAuthority(registry, { accountId: PRIVATE, role: "owner", membershipId: "synthetic-adversarial-owner" });
    try {
      await expect(invokeIOActionAs(owner, null, "state:createMembership", { userId: V, accountId: PRIVATE, role: "member" })).rejects.toThrow("personal workspace");
      await expect(invokeIOActionAs(owner, null, "state:setMembershipRole", { userId: U, accountId: PRIVATE, role: "owner" })).rejects.toThrow("personal workspace");
      await expect(invokeIOActionAs(owner, null, "state:deleteMembership", { userId: U, accountId: PRIVATE })).rejects.toThrow("personal workspace");
      expect(writes).toBe(0);
      const decide = (members: unknown[]) => invokeCallable(Ref("auth:personalMembershipDecision"), [{ owners: [U], members,
        mutation: { $tag: "AddMembership", userId: U, role: "personal" } }], pureEvaluateContext(registry.evaluateContext()));
      expect(decide([])).toMatchObject({ $tag: "Err" });
      expect(decide([existing, { ...existing, id: "teammate", userId: V }])).toMatchObject({ $tag: "Err" });
    } finally { create.mockRestore(); role.mockRestore(); remove.mockRestore(); }
  }, LONG);
});

test("the personal reader's real HTTP wrappers load metadata and save ordinary values", async () => {
  // Fresh accounts have no copied functions rows or durable checkpoint DB.
  // HTTP uses the actual request execution path; only storage IO is simulated.
  const runtimeApi = await import("@fenel/runtime");
  const { dashboardRoutes } = await import("./routes/dashboard");
  const { sourceModuleRoutes } = await import("./routes/modules");
  const { fieldDefinitionBundleRoutes } = await import("./routes/field-definition-bundles");
  const { List, Anything, Nothing } = await import("@fenel/engine/type-foundation");
  const { dispatchRegistry } = await import("@fenel/engine/system-entities");
  const { refreshAccountInstances } = await import("@fenel/engine");
  const { decodeCheckpointValue } = await import("@fenel/engine/checkpoint-json");
  const { NATIVE_JSON_HEADER } = await import("./native-json");
  const restored: Array<{ mockRestore(): void }> = [];
  const { authorityRefusalOf } = await import("./authority-refusal");
  const rows = new Map<string, Record<string, unknown>>();
  const VALUE = "99999999-9999-4999-8999-999999999999";
  const METADATA_TARGET = "reader-http-fixture:target";
  const NOMINAL_TYPE = loadRegistry().getUuid("Number")!;
  const GLOBAL_TARGET = loadRegistry().getFunction("std:add")!.id;
  const previousPrivateMetadata = dispatchRegistry.listInstances().filter((instance) =>
    typeof instance.scope === "object" && instance.scope?.kind === "account" && instance.scope.accountId === PRIVATE);
  const personalMetadata = [
    { typeName: "Labelable", args: [NOMINAL_TYPE], methods: { label: "Private number" }, priority: 100 },
    { typeName: "Codeable", args: [NOMINAL_TYPE], methods: { codeName: "PrivateNumber" }, priority: 100 },
    { typeName: "Labelable", args: [METADATA_TARGET], methods: { label: "Personal label" }, priority: 100 },
    { typeName: "Taggable", args: [METADATA_TARGET], methods: { tags: ["personal-metadata"] }, priority: 100 },
    { typeName: "IOInvokable", args: [METADATA_TARGET], methods: { ioAction: "personal-fixture.action", stopAction: Nothing, listInstancesAction: Nothing }, priority: 100 },
  ];
  // Another account's higher-priority row is already loaded in the server.
  // The request must neither select it nor remove it during its own refresh.
  dispatchRegistry.addInstance({ typeName: "Labelable", args: [METADATA_TARGET],
    methods: { label: "sibling-label-must-not-leak" }, scope: { kind: "account", accountId: B }, priority: 10_000 });
  dispatchRegistry.addInstance({ typeName: "Labelable", args: [NOMINAL_TYPE],
    methods: { label: "sibling-type-label-must-not-leak" }, scope: { kind: "account", accountId: B }, priority: 10_000 });
  let root: Record<string, unknown> = { id: PRIVATE, name: "Personal workspace", type: List(Anything),
    expr: { kind: "literal", value: { __list: [] } }, revision: 0, persisted: true,
    layout: { kind: "grid" }, items: [{ id: "typed-list", valueType: List({ $ref: NOMINAL_TYPE }) }], lists: [], expressions: {}, referenceId: `locus:${PRIVATE}` };

  // Read bound SQL parameters from Drizzle's query objects. The real storage
  // handlers must state the private account even at this simulated IO boundary.
  function parameters(value: unknown): unknown[] {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(parameters);
    const node = value as { constructor?: { name?: string }; value?: unknown; queryChunks?: unknown[] };
    if (node.constructor?.name === "Param") return [node.value];
    return node.queryChunks?.flatMap(parameters) ?? [];
  }
  function select() {
    let table: unknown;
    let ids: unknown[] = [];
    const result = () => table === db.savedQueries ? [...rows.values()].filter((row) => !ids.includes(VALUE) || row.id === VALUE)
      : table === db.accounts ? [{ id: PRIVATE, name: "Personal workspace", slug: "personal-fixture", config: {} }]
      : table === db.queryCategories || table === db.queryCategoryMembers ? []
      : (() => { throw new Error("Unexpected direct metadata table"); })();
    const query = {
      from(next: unknown) { table = next; return query; },
      where(clause: unknown) { ids = parameters(clause); expect(ids).toContain(PRIVATE); return query; },
      orderBy(..._args: unknown[]) { return query; },
      limit(_limit: number) { return query; },
      then(resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve().then(result).then(resolve, reject);
      },
    };
    return query;
  }
  const database = {
    select,
    insert(table: unknown) { expect(table).toBe(db.savedQueries); return {
      values(value: Record<string, unknown>) { expect(value.accountId).toBe(PRIVATE); return {
        returning: async () => { const row = { id: VALUE, ...value }; rows.set(VALUE, row); return [row]; },
      }; },
    }; },
    update(table: unknown) { expect(table).toBe(db.savedQueries); return {
      set(patch: Record<string, unknown>) { return {
        where(clause: unknown) { const args = parameters(clause); expect(args).toContain(PRIVATE); expect(args).toContain(VALUE); return {
          returning: async () => { const row = { ...rows.get(VALUE), ...patch }; rows.set(VALUE, row); return [row]; },
        }; },
      }; },
    }; },
    delete(table: unknown) { expect(table).toBe(db.savedQueries); return {
      where(clause: unknown) { const args = parameters(clause); expect(args).toContain(PRIVATE); expect(args).toContain(VALUE); return {
        returning: async () => { const row = rows.get(VALUE); rows.delete(VALUE); return row ? [row] : []; },
      }; },
    }; },
  };
  restored.push(spyOn(db, "getDb").mockImplementation((() => database) as never));
  restored.push(spyOn(db, "listTypes").mockImplementation((async (accountId: string) => { expect(accountId).toBe(PRIVATE); return []; }) as never));
  restored.push(spyOn(db, "listFunctions").mockImplementation((async (accountId: string) => { expect(accountId).toBe(PRIVATE); return []; }) as never));
  restored.push(spyOn(db, "listViews").mockImplementation((async (accountId: string) => { expect(accountId).toBe(PRIVATE); return []; }) as never));
  const listedMetadata = spyOn(db, "listInstances").mockImplementation((async (accountId: string) => {
    expect(accountId).toBe(PRIVATE);
    return personalMetadata.map((instance, index) => ({ id: `metadata-${index}`, accountId, instance }));
  }) as never);
  restored.push(listedMetadata);
  restored.push(spyOn(db, "catalogReadRevision").mockImplementation((async (accountId: string) => { expect(accountId).toBe(PRIVATE); return "private-fixture-v1"; }) as never));
  restored.push(spyOn(db, "loadAccountFieldDefinitionGraph").mockImplementation((async (accountId: string) => {
    expect(accountId).toBe(PRIVATE); return { currentOwners: [], currentFields: [], currentFacets: [], storageIssues: [] };
  }) as never));
  restored.push(spyOn(db, "readLocusRoot").mockImplementation((async (accountId: string) => { expect(accountId).toBe(PRIVATE); return root; }) as never));
  restored.push(spyOn(db, "editLocusRoot").mockImplementation((async (accountId: string, revision: number, command: { layout: unknown }) => {
    expect(accountId).toBe(PRIVATE);
    if (revision !== root.revision) { const error = new Error("Your data changed in another session"); error.name = "LocusRootConflict"; throw error; }
    root = { ...root, revision: revision + 1, layout: command.layout };
    return root;
  }) as never));
  // Observe the real boundary without substituting its implementation.
  const invoked = spyOn(runtimeApi, "invokeIOActionAs");
  restored.push(invoked);
  const server = new Hono();
  server.onError((error, context) => context.json({ error: String(error) }, authorityRefusalOf(error) ? 403 : 500));
  server.use("*", authMiddleware);
  server.route("/modules", sourceModuleRoutes);
  server.route("/definition-bundles", fieldDefinitionBundleRoutes);
  server.route("/", dashboardRoutes);
  const request = (path: string, init: RequestInit = {}) => server.request(path, {
    ...init, headers: { authorization: `Bearer ${TOKEN}`, "X-Fenel-Reader-Account": PRIVATE,
      "content-type": "application/json", ...init.headers },
  });
  try {
    const catalogEtags = new Map<string, string>();
    for (const path of ["/types", "/functions", "/views", "/modules/installed", "/definition-bundles", "/account", "/saved-queries", "/locus-root"]) {
      const response = await request(path);
      const payload = await response.json() as { error?: string; root?: { id: string; canEdit: boolean;
        typeDescriptions?: Array<{ phrase: string; code: string }> } };
      expect(response.status, `${path}: ${payload.error ?? ""}`).toBe(200);
      if (path === "/types" || path === "/functions") {
        expect(response.headers.get("etag")).toBeTruthy();
        catalogEtags.set(path, response.headers.get("etag")!);
      }
      if (path === "/locus-root") {
        expect(payload.root).toMatchObject({ id: PRIVATE, canEdit: true });
        expect(payload.root!.typeDescriptions).toContainEqual(expect.objectContaining({ phrase: "A list of numbers", code: "List Number" }));
        expect(payload.root!.typeDescriptions!.some(description => description.phrase.includes("sibling-type"))).toBe(false);
        expect(payload.root!.typeDescriptions!.some(description => description.phrase.includes(NOMINAL_TYPE)
          || description.code.includes(NOMINAL_TYPE))).toBe(false);
        expect(listedMetadata).toHaveBeenCalledTimes(0);
      }
    }
    const metadataVersion = dispatchRegistry.version();
    const emptyMetadata = await request("/reader-metadata", { method: "POST", body: JSON.stringify({ targets: [] }) });
    expect(emptyMetadata.status).toBe(200);
    expect(emptyMetadata.headers.get("cache-control")).toBe("private, no-store");
    expect(decodeCheckpointValue(await emptyMetadata.json(), emptyMetadata.headers.get(NATIVE_JSON_HEADER))).toEqual({ entries: [] });
    expect(listedMetadata).toHaveBeenCalledTimes(0);
    expect(dispatchRegistry.version()).toBe(metadataVersion);
    const metadata = await request("/reader-metadata", { method: "POST",
      body: JSON.stringify({ targets: [GLOBAL_TARGET, METADATA_TARGET] }) });
    const metadataText = await metadata.text();
    expect(metadata.status, metadataText).toBe(200);
    expect(metadata.headers.get("cache-control")).toBe("private, no-store");
    expect(metadata.headers.has("set-cookie")).toBe(false);
    const projection = decodeCheckpointValue(JSON.parse(metadataText), metadata.headers.get(NATIVE_JSON_HEADER)) as {
      entries: Array<{ target: string; representations: Array<{ typeName: string; methods: Record<string, unknown> }>;
        ioInvokable?: { ioAction: string } }>;
    };
    expect(projection.entries).toHaveLength(2);
    const globalEntry = projection.entries.find((entry) => entry.target === GLOBAL_TARGET)!;
    expect(globalEntry.representations.find((entry) => entry.typeName === "Labelable")?.methods.label).toBe("Add");
    const privateEntry = projection.entries.find((entry) => entry.target === METADATA_TARGET)!;
    expect(privateEntry.representations.find((entry) => entry.typeName === "Labelable")?.methods.label).toBe("Personal label");
    expect(privateEntry.representations.find((entry) => entry.typeName === "Taggable")?.methods.tags).toEqual(["personal-metadata"]);
    expect(privateEntry.ioInvokable?.ioAction).toBe("personal-fixture.action");
    expect(JSON.stringify(projection)).not.toContain("sibling-label-must-not-leak");
    expect(dispatchRegistry.version()).toBe(metadataVersion);
    expect(dispatchRegistry.listInstances("Labelable").some((instance) =>
      typeof instance.scope === "object" && instance.scope?.kind === "account" && instance.scope.accountId === B
      && instance.args[0] === METADATA_TARGET)).toBe(true);
    personalMetadata.splice(0);
    const deletedMetadata = await request("/reader-metadata", { method: "POST", body: JSON.stringify({ targets: [METADATA_TARGET] }) });
    expect(deletedMetadata.status).toBe(200);
    const deletedProjection = decodeCheckpointValue(await deletedMetadata.json(), deletedMetadata.headers.get(NATIVE_JSON_HEADER)) as typeof projection;
    expect(deletedProjection.entries[0]!.ioInvokable).toBeUndefined();
    expect(deletedProjection.entries[0]!.representations.find(instance => instance.typeName === "Labelable")).toBeUndefined();
    expect(dispatchRegistry.version()).toBe(metadataVersion);
    for (const body of ["null", "{", JSON.stringify({ targets: null }),
      JSON.stringify({ targets: Array.from({ length: 129 }, () => GLOBAL_TARGET) })]) {
      expect((await request("/reader-metadata", { method: "POST", body })).status).toBe(400);
    }
    expect(listedMetadata).toHaveBeenCalledTimes(2);
    const edited = await request("/locus-root", { method: "PUT", body: JSON.stringify({ id: PRIVATE, expectedRevision: 0,
      command: { kind: "layout", layout: { kind: "list" } } }) });
    expect(edited.status, await edited.text()).toBe(200);
    expect((await request("/locus-root", { method: "PUT", body: JSON.stringify({ id: A, expectedRevision: 0,
      command: { kind: "layout", layout: { kind: "grid" } } }) })).status).toBe(403);
    expect((await request("/locus-root", { method: "PUT", body: JSON.stringify({ id: PRIVATE, expectedRevision: 0,
      command: { kind: "layout", layout: { kind: "grid" } } }) })).status).toBe(409);
    expect(invoked.mock.calls.some((args) => args[2] === "dashboard:getLocusRootBody" && args[4]?.persistence === "ephemeral")).toBe(true);
    expect(invoked.mock.calls.some((args) => args[2] === "dashboard:editLocusRootBody" && args[4]?.persistence === "ephemeral")).toBe(true);

    const created = await request("/saved-queries", { method: "POST", body: JSON.stringify({ slug: "private-value", name: "Personal value",
      query: { kind: "expression", expr: { kind: "literal", value: "before" } } }) });
    expect(created.status, await created.text()).toBe(201);
    const updated = await request(`/saved-queries/${VALUE}`, { method: "PUT", body: JSON.stringify({ query: { kind: "expression", expr: { kind: "literal", value: "after" } } }) });
    expect(updated.status, await updated.text()).toBe(200);
    const read = await request(`/saved-queries/${VALUE}`);
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("after");
    expect((await request(`/saved-queries/${VALUE}`, { method: "DELETE" })).status).toBe(200);
    expect(rows.size).toBe(0);

    const personal = mintRequestAuthority(loadRegistry(), { accountId: PRIVATE, role: "personal", membershipId: "personal-grant" });
    // Omitted execution mode still takes the existing durable path; this
    // process has no DB for copied function rows or checkpoints.
    await expect(invokeIOActionAs(personal, null, "dashboard:getLocusRootBody", {})).rejects.toThrow("DATABASE_URL");

    // A warmer account cache must not let an empty role skip authorization.
    memberships.get(`${U}:${PRIVATE}`)!.role = "unrecognized";
    for (const [path, etag] of catalogEtags) {
      expect((await request(path, { headers: { "If-None-Match": etag } })).status).toBe(403);
      expect((await request(path)).status).toBe(403);
    }
    expect((await request("/reader-metadata", { method: "POST",
      body: JSON.stringify({ targets: [GLOBAL_TARGET, METADATA_TARGET] }) })).status).toBe(403);
    expect((await request("/reader-metadata", { method: "POST", body: JSON.stringify({ targets: [] }) })).status).toBe(403);
    expect(listedMetadata).toHaveBeenCalledTimes(2);
    expect(dispatchRegistry.version()).toBe(metadataVersion);
  } finally {
    for (const restore of restored.reverse()) restore.mockRestore();
    refreshAccountInstances(dispatchRegistry, PRIVATE, previousPrivateMetadata);
    dispatchRegistry.removeInstance("Labelable", METADATA_TARGET, B);
    dispatchRegistry.removeInstance("Labelable", NOMINAL_TYPE, B);
  }
}, LONG);

test("workspace bootstrap uses the real personal-reader grant and never reads a saved source account", async () => {
  const { dashboardRoutes } = await import("./routes/dashboard");
  const { getSystemRegistry } = await import("@fenel/engine/system-registry");
  const { decodeCheckpointValue } = await import("@fenel/engine/checkpoint-json");
  const { NATIVE_JSON_HEADER } = await import("./native-json");
  const { authorityRefusalOf } = await import("./authority-refusal");
  const registry = getSystemRegistry();
  const fn = registry.getFunction("view.workspaceDefaultForAccount")!;
  const workspace = invokeCallable(Ref(registry.getUuid(fn.id) ?? fn.id),
    ["saved-lens", { $tag: "Just", _0: B }], registry.evaluateContext());
  let identityCalls = 0;
  let rootReads = 0;
  let linked = PRIVATE;
  const ensure = spyOn(db, "ensurePersonalAccount").mockImplementation((async (userId: string, plan: import("@fenel/db").PersonalAccountPlanner) => {
    expect(userId).toBe(U); identityCalls++;
    if (linked !== PRIVATE) return { $tag: "Ok", _0: linked };
    const decision = await plan({ users: [{ id: U, personalAccountId: { $tag: "Just", _0: PRIVATE } }],
      members: [memberships.get(`${U}:${PRIVATE}`)!] });
    expect(decision.$tag).toBe("Ok");
    return { $tag: "Ok", _0: PRIVATE };
  }) as never);
  const choices = spyOn(db, "listUserAccountRoots").mockImplementation((async (userId: string) => {
    expect(userId).toBe(U); return [{ accountId: A, name: "Default", slug: "default", role: "viewer" },
      { accountId: PRIVATE, name: "Personal", slug: "personal", role: "personal" },
      { accountId: B, name: "Other", slug: "other", role: "member" }];
  }) as never);
  const read = spyOn(db, "readLocusRoot").mockImplementation((async (accountId: string) => {
    expect(accountId).toBe(PRIVATE); rootReads++;
    return { id: PRIVATE, name: "Personal", revision: 1, persisted: true, layout: { kind: "grid" },
      type: { $ref: "Anything" }, expr: { kind: "literal", value: [] }, lists: [], expressions: {}, referenceId: `locus:${PRIVATE}`,
      items: [{ id: "preferences", valueType: { $ref: registry.getUuid("WorkspacePreferences") },
        source: { kind: "expr", expr: { kind: "literal", value: workspace } } }],
    };
  }) as never);
  const server = new Hono();
  server.onError((error, context) => context.json({ error: String(error) }, authorityRefusalOf(error) ? 403 : 500));
  server.use("*", authMiddleware);
  server.route("/", dashboardRoutes);
  const request = (headers: Record<string, string> = {}) => server.request("/workspace-bootstrap?width=390&userId=spoofed", {
    headers: { authorization: `Bearer ${TOKEN}`, "X-Fenel-Reader-Account": PRIVATE, ...headers },
  });
  try {
    const response = await request();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = decodeCheckpointValue(await response.json(), response.headers.get(NATIVE_JSON_HEADER));
    expect(body).toMatchObject({ accountId: A, personalAccountId: PRIVATE, root: { id: PRIVATE, canEdit: true },
      workspace: { status: "ready", itemId: "preferences", value: workspace,
        visibleLenses: [{ source: { $tag: "AccountSource", accountId: B } }] } });
    expect(rootReads).toBe(1);
    expect(identityCalls).toBe(1);
    linked = B;
    expect((await request()).status).toBe(403);
    expect(rootReads).toBe(1);
    linked = PRIVATE;
    expect((await request({ authorization: `Bearer ${OTHER}` })).status).toBe(403);
    expect((await request({ "X-Fenel-Reader-Account": B })).status).toBe(403);
    memberships.get(`${U}:${PRIVATE}`)!.role = "unrecognized";
    expect((await request()).status).toBe(403);
    expect(rootReads).toBe(1);
    live = false;
    expect((await request()).status).toBe(401);
    expect(rootReads).toBe(1);
  } finally { read.mockRestore(); choices.mockRestore(); ensure.mockRestore(); }
}, LONG);

test("existing auth user leaves do not emit the nullable private identity link", async () => {
  let link: string | null = null;
  const user = () => ({ id: U, email: "person@example.test", name: "Person", passwordHash: null,
    personalAccountId: link, createdAt: new Date(0) });
  const lookup = spyOn(db, "getUserByEmail").mockImplementation((async () => user()) as never);
  const ensure = spyOn(db, "getOrCreateUserByEmail").mockImplementation((async () => user()) as never);
  try {
    for (const privateLink of [null, PRIVATE]) {
      link = privateLink;
      const found = await invokeIOActionPrivileged("", null, "state:getUserByEmail", { email: "person@example.test" },
        { realm: "privileged", persistence: "ephemeral" }) as { $tag: string; _0: Record<string, unknown> };
      expect(found.$tag).toBe("Just");
      expect(found._0).not.toHaveProperty("personalAccountId");
      const created = await invokeIOActionPrivileged("", null, "state:getOrCreateUserByEmail", {
        email: "person@example.test", name: { $tag: "Just", _0: "Person" },
      }, { realm: "privileged", persistence: "ephemeral" });
      expect(created).not.toHaveProperty("personalAccountId");
    }
  } finally { lookup.mockRestore(); ensure.mockRestore(); }
}, LONG);
