import { describe, expect, test } from "bun:test";
import { createCommittedAccountRegistryCache } from "./committed-account-registry-cache";
import type { FieldPersistenceSnapshot } from "./field-authoring";
import type { ModuleRegistry } from "./registry";

// Run the production acquisition/cache and both channel facades with only
// authorized storage reads and the expensive checked builder controlled.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const paths = [
  new URL("./committed-account-registry-cache.ts", import.meta.url),
  new URL("../../db/src/queries/account-value-registry.ts", import.meta.url),
  new URL("../../runtime/src/account-field-registry.ts", import.meta.url),
];
const code = (await Promise.all(paths.map(path => Bun.file(path).text())))
  .map(source => transpiler.transformSync(source).replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""))
  .join("\n");

function harness() {
  let dispatchVersion = 1;
  let graph = { currentOwners: [], currentFields: [], currentFacets: [], storageIssues: [] } as any;
  let sources: any[] = [];
  let failBuild = false;
  const builds: any[] = [];
  const reads = { db: 0, runtime: 0, dbSources: 0, runtimeSources: 0 };
  const repository = Object.freeze([{ name: "canonical-seed" }]);
  const scope = {
    modulesFor: (profile: string) => { expect(profile).toBe("seed"); return repository; },
    dispatchRegistry: { version: () => dispatchVersion },
    sourceModuleRowsFingerprint: (rows: any[]) => JSON.stringify(rows.map(({ registry }) => [
      registry.id, registry.contentHash, registry.version, registry.module,
    ])),
    prepareSourceModulesFromRows: (rows: any[]) => rows.map(({ registry }) => {
      if (registry.source !== registry.contentHash) throw new Error("Source content hash mismatch");
      return { module: { name: registry.id }, fields: [] };
    }),
    sourceModuleDispatchRegistry: () => ({ bindSourceMethods: (registry: any) => { registry.sourceBound = true; } }),
    projectAccountFieldRegistrySnapshot: (accountId: string, snapshot: unknown) => ({
      ownerModules: [{ accountId, snapshot }], externalFields: [], identityKinds: new Map(), fieldRepresentations: [],
    }),
    createAccountRegistry: (modules: any[], owners: any[], options: any) => {
      if (failBuild) throw new Error("Checked build refused");
      const registry = { modules, owners, options, ordinal: builds.length + 1 };
      builds.push(registry); return registry;
    },
    loadAccountFieldDefinitionGraph: async () => { reads.db++; return graph; },
    listAccountImports: async () => { reads.dbSources++; return sources; },
    loadAccountFieldDefinitionGraphState: async () => { reads.runtime++; return graph; },
    loadAccountSourceModulesState: async () => { reads.runtimeSources++; return sources; },
  };
  const api = new Function(...Object.keys(scope), `${code}; return { createCommittedAccountRegistryCache,
    getCommittedAccountRegistry, clearCommittedAccountRegistry, getDbAccountValueRegistry, clearDbAccountValueRegistry,
    getRuntimeAccountFieldRegistry, clearRuntimeAccountFieldRegistry };`)(...Object.values(scope)) as any;
  return { ...api, reads, builds,
    setGraph: (value: unknown) => { graph = value; }, graph: () => graph,
    setSources: (value: any[]) => { sources = value; },
    bumpDispatch: () => { dispatchVersion++; }, failBuild: (value: boolean) => { failBuild = value; } };
}

describe("shared committed account registry acquisition", () => {
  test("the imported cache factory preserves exact acquisition inputs and isolates cache instances", () => {
    const snapshot = { owners: [], fields: [], facets: [] };
    let builds = 0;
    const dependencies = { dispatchVersion: () => 1, build: (accountId: string, value: FieldPersistenceSnapshot, rows: readonly unknown[]) => {
      expect(accountId).toBe("direct-import"); expect(value).toBe(snapshot); expect(rows).toEqual([]);
      return { ordinal: ++builds } as unknown as ModuleRegistry;
    } };
    const left = createCommittedAccountRegistryCache(dependencies), right = createCommittedAccountRegistryCache(dependencies);
    const registry = left.get("direct-import", snapshot, []);
    expect(left.get("direct-import", snapshot, [])).toBe(registry);
    expect(right.get("direct-import", snapshot, [])).not.toBe(registry);
    left.clear("direct-import");
    expect(left.get("direct-import", snapshot, [])).not.toBe(registry);
    expect(builds).toBe(3);
  });

  test("storage and runtime reuse one checked definition registry while repeating their own reads", async () => {
    const h = harness();
    const db = await h.getDbAccountValueRegistry("account-A");
    expect(await h.getRuntimeAccountFieldRegistry("account-A")).toBe(db);
    expect(await h.getDbAccountValueRegistry("account-A")).toBe(db);
    expect(h.builds).toHaveLength(1);
    expect(h.reads).toEqual({ db: 2, runtime: 1, dbSources: 2, runtimeSources: 1 });
    expect(db.options.bodySpellingPolicy).toBe("defer-legacy-db");
    expect(db.owners[0].accountId).toBe("account-A");
    expect(db).not.toHaveProperty("authority");
  });

  test("account, field, owner, facet, source identity/version and dispatch changes rebuild", async () => {
    const h = harness();
    let prior = await h.getDbAccountValueRegistry("account-A");
    expect(await h.getRuntimeAccountFieldRegistry("account-B")).not.toBe(prior);
    for (const field of ["currentOwners", "currentFields", "currentFacets"]) {
      h.setGraph({ ...h.graph(), [field]: [{ changed: field }] });
      const next = await h.getRuntimeAccountFieldRegistry("account-A");
      expect(next).not.toBe(prior); prior = next;
      expect(await h.getDbAccountValueRegistry("account-A")).toBe(prior);
    }
    for (const registry of [
      { id: "source", source: "body-1", contentHash: "body-1", version: "1" },
      { id: "source", source: "body-1", contentHash: "body-1", version: "2" },
      { id: "source", source: "body-1", contentHash: "body-1", version: "2", module: { sourceIdentity: "new-fields" } },
      { id: "source", source: "body-2", contentHash: "body-2", version: "2" },
    ]) {
      h.setSources([{ registry }]);
      const next = await h.getDbAccountValueRegistry("account-A");
      expect(next).not.toBe(prior); prior = next;
      expect(next.sourceBound).toBe(true);
      expect(await h.getRuntimeAccountFieldRegistry("account-A")).toBe(prior);
    }
    h.bumpDispatch();
    expect(await h.getRuntimeAccountFieldRegistry("account-A")).not.toBe(prior);
  });

  test("a fresh ambiguous graph refuses even when its definition registry was cached", async () => {
    const h = harness();
    await h.getDbAccountValueRegistry("account-A");
    h.setGraph({ ...h.graph(), storageIssues: [{ reason: "multiple-current" }] });
    await expect(h.getDbAccountValueRegistry("account-A")).rejects.toThrow("ambiguous");
    await expect(h.getRuntimeAccountFieldRegistry("account-A")).rejects.toThrow("ambiguous");
    expect(h.builds).toHaveLength(1);
    expect(h.reads.db).toBe(2); expect(h.reads.runtime).toBe(1);
  });

  test("changed source bytes cannot reuse a claimed content hash and failed builds are retryable", async () => {
    const h = harness();
    h.setSources([{ registry: { id: "source", source: "body", contentHash: "body", version: "1" } }]);
    const prior = await h.getDbAccountValueRegistry("account-A");
    h.setSources([{ registry: { id: "source", source: "tampered", contentHash: "body", version: "1" } }]);
    await expect(h.getRuntimeAccountFieldRegistry("account-A")).rejects.toThrow("content hash mismatch");
    expect(h.builds).toHaveLength(1);
    h.setSources([{ registry: { id: "source", source: "body", contentHash: "body", version: "1" } }]);
    expect(await h.getDbAccountValueRegistry("account-A")).toBe(prior);
    h.setGraph({ ...h.graph(), currentFields: [{ changed: true }] }); h.failBuild(true);
    await expect(h.getDbAccountValueRegistry("account-A")).rejects.toThrow("Checked build refused");
    h.failBuild(false);
    expect(await h.getRuntimeAccountFieldRegistry("account-A")).not.toBe(prior);
  });

  test("either channel clears shared acquisition and account-specific clearing preserves siblings", async () => {
    const h = harness();
    const left = await h.getDbAccountValueRegistry("left"), right = await h.getRuntimeAccountFieldRegistry("right");
    h.clearRuntimeAccountFieldRegistry("left");
    expect(await h.getDbAccountValueRegistry("left")).not.toBe(left);
    expect(await h.getDbAccountValueRegistry("right")).toBe(right);
    h.clearDbAccountValueRegistry();
    expect(await h.getRuntimeAccountFieldRegistry("right")).not.toBe(right);
  });

  test("the shared cache retains only 32 accounts and refreshes least-recent usage", async () => {
    const h = harness();
    const first = await h.getDbAccountValueRegistry("account-0");
    const second = await h.getDbAccountValueRegistry("account-1");
    for (let index = 2; index < 32; index++) await h.getDbAccountValueRegistry(`account-${index}`);
    expect(await h.getRuntimeAccountFieldRegistry("account-0")).toBe(first);
    await h.getDbAccountValueRegistry("account-32");
    expect(await h.getDbAccountValueRegistry("account-0")).toBe(first);
    expect(await h.getRuntimeAccountFieldRegistry("account-1")).not.toBe(second);
    expect(h.builds).toHaveLength(34);
  });

  test("custom runtime builders cannot consume or publish another dependency set's registry", async () => {
    const h = harness();
    let builds = 0;
    const makeDependencies = () => ({ load: async () => h.graph(), build: () => ({ custom: ++builds }) });
    const left = makeDependencies(), right = makeDependencies();
    const custom = await h.getRuntimeAccountFieldRegistry("account-A", left);
    expect(await h.getRuntimeAccountFieldRegistry("account-A", left)).toBe(custom);
    expect(await h.getRuntimeAccountFieldRegistry("account-A", right)).not.toBe(custom);
    const production = await h.getDbAccountValueRegistry("account-A");
    expect(production).not.toBe(custom);
    expect(await h.getRuntimeAccountFieldRegistry("account-A")).toBe(production);
    expect(h.builds).toHaveLength(1); expect(builds).toBe(2);
  });
});
