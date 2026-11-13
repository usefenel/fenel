import { describe, expect, test } from "bun:test";
import { createSourceModuleRoutes } from "./routes/modules";
import source from "../../engine/src/authoring/source-module.fixture.fenel?raw";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { publishSourceRegistryVersion, installSourceRegistryVersion, uninstallSourceRegistryVersion, type SourceRegistryTransactions, registries, registryImports } from "@fenel/db";

function harness(account: string | null = "account-a") {
  const rows: any[] = [];
  const installs: any[] = [];
  const writes: any[] = [];
  const physical: any[] = [];
  const validations: any[] = [];
  let validationFailure: string | undefined;
  let locked = false;
  let queue = Promise.resolve();
  const dialect = new PgDialect();
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const match = (condition: SQL, entry: any): boolean => {
    const query = dialect.sqlToQuery(condition);
    const equalities = [...query.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
    for (const token of query.sql.matchAll(/\$(\d+)/g)) if (!equalities.some((eq) => eq[3] === token[1])) throw new Error(`Unsupported transaction fixture predicate ${query.sql}`);
    return equalities.every(([, table, column, parameter]) => {
      const row = table === "registries" ? entry.registry ?? entry : table === "registry_imports" ? entry.import ?? entry : entry;
      const value = row[camel(column!)];
      return value === query.params[Number(parameter) - 1] || (column === "owner_account_id" && value === null && query.sql.includes(" is null or "));
    });
  };
  const tableRows = (table: unknown) => table === registries ? rows : table === registryImports ? installs : physical;
  const tx: any = {
    select: () => ({ from: (table: unknown) => {
      let joined = false;
      let condition: SQL | undefined;
      const run = () => tableRows(table).map((entry) => table === registryImports && !joined ? entry.import : entry).filter((entry) => !condition || match(condition, entry));
      const query: any = {
        innerJoin: () => { joined = true; return query; },
        where: (next: SQL) => { condition = next; return query; },
        orderBy: () => query,
        limit: async (count: number) => run().slice(0, count),
        then: (ok: any, fail: any) => Promise.resolve().then(run).then(ok, fail),
      };
      return query;
    } }),
    insert: (table: unknown) => ({ values: (input: any) => {
      const run = () => {
        if (!locked) throw new Error("Write outside account lock");
        const row = { id: `${getTableName(table as never)}-${tableRows(table).length}`, dependencies: [], publishedAt: new Date(0), ...input };
        if (table === registryImports) installs.push({ import: row, registry: rows.find((entry) => entry.id === row.registryId) });
        else { tableRows(table).push(row); writes.push(row); }
        return [row];
      };
      return { returning: async () => run(), then: (ok: any, fail: any) => Promise.resolve().then(run).then(ok, fail) };
    } }),
    update: (table: unknown) => ({ set: (change: any) => ({ where: async (condition: SQL) => { for (const row of tableRows(table)) if (match(condition, row)) Object.assign(row, change); } }) }),
    delete: (table: unknown) => ({ where: async (condition: SQL) => { const target = tableRows(table); for (let index = target.length - 1; index >= 0; index--) if (match(condition, table === registryImports ? target[index].import : target[index])) target.splice(index, 1); } }),
  };
  const host: SourceRegistryTransactions = {
    transaction: (async (_accountId: string, action: (tx: any) => Promise<unknown>) => {
      const result = queue.then(async () => { locked = true; try { return await action(tx); } finally { locked = false; } });
      queue = result.then(() => undefined, () => undefined);
      return result;
    }) as SourceRegistryTransactions["transaction"],
    readGraph: async () => ({ currentOwners: [], currentFields: [], currentFacets: [], storageIssues: [] } as any),
  };
  const app = createSourceModuleRoutes({
    account: () => account,
    read: async (id) => rows.find((row) => row.id === id) ?? null,
    list: async (id) => rows.filter((row) => row.ownerAccountId === id || row.ownerAccountId === null),
    installed: async (id) => installs.filter((row) => row.import.accountId === id),
    publishVersion: (id, input, prepare) => publishSourceRegistryVersion(id, input, (history) => { expect(locked).toBe(true); return prepare(history); }, host),
    installVersion: (id, version, validate) => installSourceRegistryVersion(id, version, validate, host),
    uninstallVersion: (id, version, validate) => uninstallSourceRegistryVersion(id, version, validate, host),
    validateInstallation: async (...args) => { expect(locked).toBe(true); validations.push(args); if (validationFailure) throw new Error(validationFailure); return [{ id: `${args[3]}:run`, params: [], returns: { $ref: "Number" }, body: 1 }]; },
  });
  const post = (path: string, data?: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data ?? {}) });
  return { app, post, rows, installs, writes, physical, validations, failValidation: (message: string) => { validationFailure = message; } };
}

describe("canonical source module HTTP boundary", () => {
  test("authentication and owner scope precede access", async () => {
    const anonymous = harness(null);
    expect((await anonymous.app.request("/")).status).toBe(401);
    const scoped = harness();
    scoped.rows.push({ id: "foreign", ownerAccountId: "account-b", source, module: {} });
    expect((await scoped.app.request("/foreign")).status).toBe(404);
    expect((await scoped.post("/foreign/install")).status).toBe(404);
    expect(scoped.installs).toEqual([]);
    expect((await anonymous.app.request("/installed", { headers: { "If-None-Match": "*" } })).status).toBe(401);
    expect((await scoped.app.request("/foreign", { headers: { "If-None-Match": "*" } })).status).toBe(404);
  });

  test("source caches revalidate exact content and the current installation list", async () => {
    const scope = harness();
    const first = { id: "version-1", slug: "account-a/demo", version: "1", ownerAccountId: "account-a", source: "value = 1", contentHash: "hash-1", module: {} };
    const next = { ...first, id: "version-2", version: "2", source: "value = 2", contentHash: "hash-2" };
    scope.rows.push(first, next);
    scope.installs.push({ import: { accountId: "account-a", registryId: first.id }, registry: first });
    const read = await scope.app.request("/version-1");
    const tag = read.headers.get("etag")!;
    expect(read.headers.get("cache-control")).toBe("private, no-cache");
    expect((await scope.app.request("/version-1", { headers: { "If-None-Match": tag } })).status).toBe(304);
    expect((await scope.app.request("/version-2", { headers: { "If-None-Match": tag } })).status).toBe(200);
    const installed = await scope.app.request("/installed");
    const installedTag = installed.headers.get("etag")!;
    expect((await scope.app.request("/installed", { headers: { "If-None-Match": installedTag } })).status).toBe(304);
    scope.installs.splice(0, 1, { import: { accountId: "account-a", registryId: next.id }, registry: next });
    const changed = await scope.app.request("/installed", { headers: { "If-None-Match": installedTag } });
    expect(changed.status).toBe(200);
    expect((await changed.json() as { modules: { version: string }[] }).modules.map((row) => row.version)).toEqual(["2"]);
  });

  test("source is reparsed and only a server-minted field lock accompanies immutable source", async () => {
    const scope = harness();
    const response = await scope.post("/", { name: "demo", version: "1", source, module: { functions: [{ signature: "trusted" }] }, ownerAccountId: "other" });
    expect(response.status).toBe(201);
    const saved = (await response.json() as any).module;
    expect(saved.slug).toBe("account-a/demo");
    expect(saved.source).toBe(source);
    expect(saved.module).toBeUndefined();
    expect(saved.identity.version).toBe(1);
    expect(saved.identity.fields.length).toBeGreaterThan(0);
    expect(Object.keys(scope.writes[0].module)).toEqual(["sourceIdentity", "sourceNamespace"]);
    expect(scope.writes[0].ownerAccountId).toBe("account-a");
    const priorLock = saved.identity;
    const next = await scope.post("/", { name: "demo", version: "2", source });
    expect((await next.json() as any).module.identity).toEqual(priorLock);
  }, 300_000);

  test("unknown directives cannot be published as a cached JSON override", async () => {
    const scope = harness();
    const response = await scope.post("/", { name: "demo", version: "1", source: '@unknown "x"\nvalue = 1', module: {} });
    expect(response.status).toBe(422);
    expect(scope.writes).toEqual([]);
  });

  test("installation respects pinned dependency versions and is account-local", async () => {
    const scope = harness();
    scope.rows.push({ id: "dependent", ownerAccountId: "account-a", source, slug: "account-a/dependent", version: "1", dependencies: [{ registry: "account-a/base", version: "2" }] });
    expect((await scope.post("/dependent/install")).status).toBe(409);
    expect(scope.installs).toEqual([]);
    scope.rows.push({ id: "base", ownerAccountId: "account-a", source, slug: "account-a/base", version: "2", dependencies: [] });
    expect((await scope.post("/base/install")).status).toBe(200);
    expect((await scope.post("/dependent/install")).status).toBe(200);
    expect(scope.installs.map((row) => row.import.accountId)).toEqual(["account-a", "account-a"]);
    expect((await scope.app.request("/base/install", { method: "DELETE" })).status).toBe(409);
    expect((await scope.app.request("/dependent/install", { method: "DELETE" })).status).toBe(200);
    expect(scope.physical.find((row) => row.sourceRegistryId === "dependent")?.active).toBe(false);
    expect(scope.physical.find((row) => row.sourceRegistryId === "dependent")?.id).toBeDefined();
  });

  test("concurrent versions share newly minted fields through locked historical reconciliation", async () => {
    const scope = harness();
    const source = "identity : (value: a) -> a\nidentity value = value";
    const responses = await Promise.all([scope.post("/", { name: "  Headerless  ", version: "1", source }), scope.post("/", { name: "Headerless", version: "2", source })]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map(async (response) => (await response.json() as any).module));
    expect(first.identity).toEqual(second.identity);
    expect(first.namespace).toBe("Headerless");
    expect(second.slug).toBe("account-a/Headerless");
  });

  test("a rejected complete candidate writes neither an import nor physical functions", async () => {
    const scope = harness();
    scope.rows.push({ id: "bad", slug: "account-a/bad", source, version: "1", ownerAccountId: "account-a", dependencies: [] });
    scope.failValidation("Account type collides with installed source type");
    expect((await scope.post("/bad/install")).status).toBe(422);
    expect(scope.validations).toHaveLength(1);
    expect(scope.installs).toEqual([]);
    expect(scope.physical).toEqual([]);
  });
});
