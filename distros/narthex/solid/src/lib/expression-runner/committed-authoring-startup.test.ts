import { describe, expect, test } from "bun:test";

// Exercise the product acquisition/session boundaries without booting another
// engine beside the browser profile. The checked reader registry remains a
// held host boundary; source-aware semantic parity is covered separately.
const registrySource = await Bun.file(new URL("../account-field-registry.ts", import.meta.url)).text();
const sessionSource = await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const registryCode = transpiler.transformSync(registrySource)
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");
const prepareStart = sessionSource.indexOf("export async function prepareCommittedAuthoringSession(");
const prepareEnd = sessionSource.indexOf("/** A simultaneous reader", prepareStart);
const accountStart = sessionSource.indexOf("const accountSessions =");
const accountEnd = sessionSource.indexOf("/** Existing definitions", accountStart);
if ([prepareStart, prepareEnd, accountStart, accountEnd].some(index => index < 0)) throw new Error("Committed authoring boundaries changed");
const sessionCode = transpiler.transformSync(sessionSource.slice(prepareStart, prepareEnd) + sessionSource.slice(accountStart, accountEnd))
  .replace(/^export /gm, "");
const snapshot = { owners: [], fields: [], facets: [] };
const roster = (version: string) => Object.freeze([{ id: "installed", version, source: "module Installed where" }]);

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  let sources = roster("1");
  let account = "A";
  let holdRegistry = false, holdCatalog = false;
  let sourceReads = 0, localBuilds = 0, legacyBuilds = 0;
  let yields = 0, replaceOnYield = 0;
  const builds: Array<{ sources: unknown; accountId: string; flight: ReturnType<typeof deferred<object>>; registry: object }> = [];
  const catalogs: Array<{ sources: unknown; catalog: object; flight: ReturnType<typeof deferred<object>> }> = [];
  const attached: object[] = [], discarded: object[] = [];
  const sessions = new WeakMap<object, object>();
  let registryApi: any, sessionApi: any;
  const globals = {
    createSignal: (initial: unknown) => { let value = initial; return [() => value, (next: unknown) => { value = next; }]; },
    sourceModulesForAccount: (id: string) => { sourceReads++; return id === account ? sources : []; },
    loadModule: async (path: string) => {
      if (path === "./reader-registry") return { buildReaderFieldRegistry: async (accountId: string, value: unknown, sourceRoster: unknown) => {
        expect(value).toBe(snapshot);
        const flight = deferred<object>();
        const registry = { id: builds.length, accountId, sources: sourceRoster };
        builds.push({ sources: sourceRoster, accountId, flight, registry });
        if (!holdRegistry) flight.resolve(registry);
        return flight.promise;
      } };
      if (path === "./expression-runner/authoring-session") return sessionApi;
      if (path === "./expression-runner/authoring-catalog-worker") return {
        activatePreparedAuthoringWorker: () => {}, discardPreparedAuthoringWorker: (registry: object) => discarded.push(registry),
      };
      if (path === "@fenel/engine/account-field-registry") return { createAccountFieldRegistryAsync: async () => { localBuilds++; return { public: true }; } };
      if (path === "@fenel/engine/module-manifest") return { modulesFor: () => [] };
      if (path === "@fenel/engine/system-entities") return { dispatchRegistry: {} };
      throw new Error(`Unexpected import: ${path}`);
    },
  };
  registryApi = new Function(...Object.keys(globals), `${registryCode}; return { installCommittedAccountFieldSnapshot,
    ensureAccountFieldRegistryLoaded, reloadAccountFieldRegistry, accountFieldRegistryState, committedAccountSourceModules,
    buildLocalAccountFieldRegistry, StaleAccountFieldRegistryLoadError, clearAccountFieldRegistry };`)(...Object.values(globals));
  const sessionGlobals = {
    registrySessions: sessions,
    committedAccountSourceModules: registryApi.committedAccountSourceModules,
    sourceModulesForAccount: globals.sourceModulesForAccount,
    StaleAccountFieldRegistryLoadError: registryApi.StaleAccountFieldRegistryLoadError,
    prepareSourceModuleRegistry: async () => { legacyBuilds++; throw new Error("Source-only rebuild"); },
    prepareCatalogInWorker: async (_id: string, value: unknown, _entities: unknown, _functions: unknown, options: { sourceModules?: unknown }) => {
      expect(value).toBe(snapshot);
      const catalog = { sourceRoster: options.sourceModules };
      const flight = deferred<object>();
      catalogs.push({ sources: options.sourceModules, catalog, flight });
      if (!holdCatalog) flight.resolve(catalog);
      return flight.promise;
    },
    yieldToInput: async () => { if (++yields === replaceOnYield) sources = roster("2"); },
    environmentFor: (catalog: object) => ({ catalog }),
    createDetachedAuthoringEnvironment: (environment: object) => environment,
    browserEvaluateContext: (registry: object) => ({ registry }),
    attachPreparedAuthoringWorker: (registry: object) => attached.push(registry),
    discardPreparedAuthoringCatalog: (catalog: object) => discarded.push(catalog),
    accountFieldRegistryState: registryApi.accountFieldRegistryState,
    detachedSessionForRegistry: (registry: object) => sessions.get(registry) ?? { registry, evaluateContext: {}, environment: {} },
    materializedDetachedSession: () => { throw new Error("Detached repository rebuild"); },
    concreteAuthoringSession: (session: object) => session,
    createAccountAuthoringSession: (base: object) => ({ ...base }),
    prepareSourceModule: () => { legacyBuilds++; throw new Error("Source-only rebuild"); },
    preparedSourceRegistries: new WeakMap(),
  };
  sessionApi = new Function(...Object.keys(sessionGlobals), `${sessionCode}; return { prepareCommittedAuthoringSession, accountAuthoringSession };`)(...Object.values(sessionGlobals));
  return { ...registryApi, ...sessionApi, builds, catalogs, attached, discarded,
    sources: () => sources, setSources: (version: string) => { sources = roster(version); },
    changeAccount: () => { account = "B"; }, sourceReads: () => sourceReads,
    localBuilds: () => localBuilds, legacyBuilds: () => legacyBuilds,
    holdRegistry: () => { holdRegistry = true; }, holdCatalog: () => { holdCatalog = true; },
    replaceSourcesOnYield: (step: number) => { replaceOnYield = step; } };
}

async function reach(predicate: () => boolean) {
  for (let step = 0; step < 30 && !predicate(); step++) await Promise.resolve();
  expect(predicate()).toBe(true);
}

describe("one committed account/source authoring registry", () => {
  test("the account session retains the checked registry and its exact worker roster", async () => {
    const h = harness();
    const registry = await h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    const documents = h.sources();
    await h.prepareCommittedAuthoringSession(registry, "A", snapshot, []);
    const session = h.accountAuthoringSession({ accountId: "A", functions: [] });
    expect(session.registry).toBe(registry);
    expect(session.evaluateContext.registry).toBe(registry);
    expect(h.committedAccountSourceModules(registry)).toBe(documents);
    expect(h.builds[0]!.sources).toBe(documents);
    expect(h.catalogs[0]!.sources).toBe(documents);
    expect(h.builds).toHaveLength(1);
    expect(h.catalogs).toHaveLength(1);
    expect(h.legacyBuilds()).toBe(0);
    expect(await h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot })).toBe(registry);
    await h.prepareCommittedAuthoringSession(registry, "A", snapshot, []);
    expect(h.catalogs).toHaveLength(1);
  });

  test("a source version replacement starts a fresh build and refuses the held old one", async () => {
    const h = harness(); h.holdRegistry();
    const old = h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    void old.catch(() => {});
    await reach(() => h.builds.length === 1);
    h.setSources("2");
    const fresh = h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    await reach(() => h.builds.length === 2);
    h.builds[1]!.flight.resolve(h.builds[1]!.registry);
    expect(await fresh).toBe(h.builds[1]!.registry);
    h.builds[0]!.flight.resolve(h.builds[0]!.registry);
    await expect(old).rejects.toBeInstanceOf(h.StaleAccountFieldRegistryLoadError);
    expect(h.accountFieldRegistryState().registry).toBe(h.builds[1]!.registry);
  });

  test("changing account during a held source build cannot publish the old reader", async () => {
    const h = harness(); h.holdRegistry();
    const old = h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    void old.catch(() => {});
    await reach(() => h.builds.length === 1);
    h.changeAccount(); h.clearAccountFieldRegistry();
    h.builds[0]!.flight.resolve(h.builds[0]!.registry);
    await expect(old).rejects.toBeInstanceOf(h.StaleAccountFieldRegistryLoadError);
    expect(h.accountFieldRegistryState()).toBeUndefined();
  });

  test("a superseded catalog is discarded without attachment or stale session publication", async () => {
    const h = harness(); h.holdCatalog();
    const registry = await h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    const pending = h.prepareCommittedAuthoringSession(registry, "A", snapshot, []);
    void pending.catch(() => {});
    await reach(() => h.catalogs.length === 1);
    h.setSources("2"); h.catalogs[0]!.flight.resolve(h.catalogs[0]!.catalog);
    await expect(pending).rejects.toBeInstanceOf(h.StaleAccountFieldRegistryLoadError);
    expect(h.attached).toEqual([]);
    expect(h.discarded).toEqual([h.catalogs[0]!.catalog]);
    expect(() => h.accountAuthoringSession({ accountId: "A", functions: [] })).toThrow("stale account");
  });

  test("a failed catalog can retry against the same committed source registry", async () => {
    const h = harness(); h.holdCatalog();
    const registry = await h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    const first = h.prepareCommittedAuthoringSession(registry, "A", snapshot, []);
    void first.catch(() => {});
    await reach(() => h.catalogs.length === 1);
    h.catalogs[0]!.flight.reject(new Error("Catalog failed"));
    await expect(first).rejects.toThrow("Catalog failed");
    const retry = h.prepareCommittedAuthoringSession(registry, "A", snapshot, []);
    await reach(() => h.catalogs.length === 2);
    h.catalogs[1]!.flight.resolve(h.catalogs[1]!.catalog);
    await retry;
    expect(h.accountAuthoringSession({ accountId: "A", functions: [] }).registry).toBe(registry);
    expect(h.builds).toHaveLength(1);
    expect(h.attached).toEqual([registry]);
  });

  test("a source change at the final input yield cannot activate the stale catalog", async () => {
    const h = harness(); h.replaceSourcesOnYield(2);
    const registry = await h.ensureAccountFieldRegistryLoaded("A", { load: async () => snapshot });
    await expect(h.prepareCommittedAuthoringSession(registry, "A", snapshot, [])).rejects.toBeInstanceOf(h.StaleAccountFieldRegistryLoadError);
    expect(h.attached).toEqual([]);
    expect(h.discarded).toEqual([h.catalogs[0]!.catalog]);
  });

  test("the public/local builder never reads or includes the private source roster", async () => {
    const h = harness();
    const registry = await h.buildLocalAccountFieldRegistry("A", snapshot);
    expect(registry).toEqual({ public: true });
    expect(h.sourceReads()).toBe(0);
    expect(h.builds).toEqual([]);
    expect(h.localBuilds()).toBe(1);
    expect(h.committedAccountSourceModules(registry)).toBeUndefined();
  });
});
