import { describe, expect, test } from "bun:test";

// Keep the host scheduling seam cheap; the real checked constructors own all
// normalization/signature semantics and retain their existing parity suites.
const source = await Bun.file(new URL("./reader-registry.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const code = transpiler.transformSync(source).replace(/^export /gm, "")
  .replace(/\bimport\(/g, "loadModule(");
const snapshot = { owners: [], fields: [], facets: [] };
const sourceField = { id: "installed-field" };
const prepared = {
  module: { name: "Installed", functions: [{ id: "installed-function" }], entities: [{ id: "installed-type" }] },
  fields: [sourceField],
};
const identity = { version: "1", fields: [] };
const documents = [{ source: "module Installed where\n", namespace: "installed", slug: "reader/installed", identity }];

function harness() {
  const seed = [{ name: "seed" }];
  const repositoryDispatch = { name: "repository-dispatch" };
  const sourceDispatch = { name: "installed-dispatch", bindSourceMethods: (registry: unknown) => bound.push(registry) };
  const owner = { name: "account-owner" };
  const projection = {
    ownerModules: [owner], externalFields: [{ id: "account-field" }],
    identityKinds: new Map([["account-field", "field"]]), fieldRepresentations: [{ id: "account-label" }],
  };
  const calls: Array<{ schedule: string; kind: string; args: any[]; registry: object }> = [];
  const acquired: any[][] = [], namespaceChecks: any[][] = [], bound: unknown[] = [];
  let namespaceBuilds = 0;
  let checkedNamespaces: ReadonlySet<string> | undefined;
  let checkedNamespaceReads = 0;
  let failure: Error | undefined, namespaceFailure: Error | undefined, projectionFailure: Error | undefined;
  const construct = (schedule: string, kind: string, ...args: any[]) => {
    const registry = { schedule, kind };
    calls.push({ schedule, kind, args, registry });
    if (failure) throw failure;
    return schedule === "async" ? Promise.resolve(registry) : registry;
  };
  const imports = {
    "@fenel/engine/account-field-registry": {
      createAccountFieldRegistry: (...args: any[]) => construct("inline", "account", ...args),
      createAccountFieldRegistryAsync: (...args: any[]) => construct("async", "account", ...args),
      projectAccountFieldRegistrySnapshot: (accountId: string, committed: unknown) => {
        expect(accountId).toBe("reader"); expect(committed).toBe(snapshot);
        if (projectionFailure) throw projectionFailure;
        return projection;
      },
    },
    "@fenel/engine/authoring/source-module": {
      prepareSourceModule: (...args: any[]) => { acquired.push(args); return prepared; },
      sourceModuleFallbackName: (slug: string) => `fallback:${slug}`,
      assertSourceModuleNamespaces: (...args: any[]) => {
        namespaceChecks.push(args);
        if (namespaceFailure) throw namespaceFailure;
      },
      reservedSourceModuleNamespaces: () => { namespaceBuilds++; return ["std", "authority"]; },
      sourceModuleDispatchRegistry: (modules: unknown) => { expect(modules).toEqual([prepared]); return sourceDispatch; },
    },
    "@fenel/engine/repository-registry": {
      createAccountRegistry: (...args: any[]) => construct("inline", "source", ...args),
      createAccountRegistryAsync: (...args: any[]) => construct("async", "source", ...args),
    },
    "@fenel/engine/module-manifest": { modulesFor: (profile: string) => { expect(profile).toBe("seed"); return seed; } },
    "@fenel/engine/system-entities": { dispatchRegistry: repositoryDispatch },
    "./repository-namespaces": { checkedRepositoryNamespaces: () => {
      checkedNamespaceReads++; return checkedNamespaces === undefined ? undefined : new Set(checkedNamespaces);
    } },
  };
  const loadModule = async (path: keyof typeof imports) => imports[path];
  const api = new Function("loadModule", `${code}; return { buildReaderFieldRegistry, readerSourceDeclarations };`)(loadModule) as {
    buildReaderFieldRegistry: (...args: unknown[]) => Promise<object>;
    readerSourceDeclarations: (registry: object) => unknown;
  };
  return { ...api, seed, repositoryDispatch, sourceDispatch, projection, calls, acquired, namespaceChecks, bound,
    namespaceBuilds: () => namespaceBuilds,
    checkedNamespaceReads: () => checkedNamespaceReads,
    retainCheckedNamespaces: (names: ReadonlySet<string>) => { checkedNamespaces = new Set(names); },
    failBuild: () => { failure = new Error("Checked registry refused invalid identities"); },
    failNamespace: () => { namespaceFailure = new Error("Reserved source namespace"); },
    failProjection: () => { projectionFailure = new Error("Invalid committed graph"); } };
}

describe("reader registry host preparation scheduling", () => {
  test("a standalone rebuild reuses successful worker repository data while freshly checking installed sources", async () => {
    const h = harness();
    const names = new Set(["std", "authority"]);
    h.retainCheckedNamespaces(names);
    names.clear(); names.add("private-source");
    const first = await h.buildReaderFieldRegistry("reader", snapshot, documents);
    expect(h.namespaceBuilds()).toBe(0);
    expect(h.checkedNamespaceReads()).toBe(1);
    expect([...h.namespaceChecks[0]![1]]).toEqual(["std", "authority"]);
    h.namespaceChecks[0]![1].clear();
    const replacement = { ...documents[0]!, source: "module Installed where\nupdated = 1\n" };
    const second = await h.buildReaderFieldRegistry("reader", snapshot, [replacement]);
    expect(h.namespaceBuilds()).toBe(0);
    expect(h.acquired.map(args => args[0])).toEqual([documents[0]!.source, replacement.source]);
    expect([...h.namespaceChecks[1]![1]]).toEqual(["std", "authority"]);
    expect(h.bound).toEqual([first, second]);
    h.failNamespace();
    await expect(h.buildReaderFieldRegistry("reader", snapshot, [replacement])).rejects.toThrow("Reserved source namespace");
    expect(h.calls).toHaveLength(2);
  });

  test("an explicit request projection wins and inline workers never acquire the browser memo", async () => {
    const h = harness();
    h.retainCheckedNamespaces(new Set(["std", "authority"]));
    const requestNames = new Set(["request-std", "request-authority"]);
    await h.buildReaderFieldRegistry("reader", snapshot, documents, { repositoryNamespaces: requestNames });
    expect(h.namespaceChecks[0]![1]).toBe(requestNames);
    expect(h.checkedNamespaceReads()).toBe(0);
    await h.buildReaderFieldRegistry("reader", snapshot, documents, { preparation: "inline" });
    expect(h.checkedNamespaceReads()).toBe(0);
    expect(h.namespaceBuilds()).toBe(1);
  });

  test("a preparation worker's exact checked namespace set skips only the redundant namespace registry", async () => {
    const original = harness();
    await original.buildReaderFieldRegistry("reader", snapshot, documents);
    expect(original.namespaceBuilds()).toBe(1);
    const staged = harness();
    const repositoryNamespaces = new Set(["std", "authority"]);
    await staged.buildReaderFieldRegistry("reader", snapshot, documents, { repositoryNamespaces });
    expect(staged.namespaceBuilds()).toBe(0);
    expect(staged.namespaceChecks).toEqual([[[prepared], repositoryNamespaces]]);
    expect(staged.namespaceChecks[0]![1]).toBe(repositoryNamespaces);
    expect(staged.calls[0]!.args.slice(0, 2)).toEqual(original.calls[0]!.args.slice(0, 2));
    const { dispatchRegistry: originalDispatch, ...originalOptions } = original.calls[0]!.args[2];
    const { dispatchRegistry: stagedDispatch, ...stagedOptions } = staged.calls[0]!.args[2];
    expect(stagedOptions).toEqual(originalOptions);
    expect(originalDispatch).toBe(original.sourceDispatch);
    expect(stagedDispatch).toBe(staged.sourceDispatch);
    expect(staged.bound).toHaveLength(1);
    staged.failNamespace();
    await expect(staged.buildReaderFieldRegistry("reader", snapshot, documents, { repositoryNamespaces }))
      .rejects.toThrow("Reserved source namespace");
    expect(staged.calls).toHaveLength(1);
  });
  test("main-thread readers default to the checked async account constructor", async () => {
    const h = harness();
    const registry = await h.buildReaderFieldRegistry("reader", snapshot, []);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.schedule).toBe("async");
    expect(h.calls[0]!.args).toEqual([h.seed, "reader", snapshot, { dispatchRegistry: h.repositoryDispatch }]);
    expect(h.calls[0]!.args[2]).toBe(snapshot);
    expect(registry).toBe(h.calls[0]!.registry);
    expect(h.readerSourceDeclarations(registry)).toBeUndefined();
  });

  test("worker preparation uses the checked sync constructor with the same empty-source inputs", async () => {
    const h = harness();
    const registry = await h.buildReaderFieldRegistry("reader", snapshot, [], { preparation: "inline" });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.schedule).toBe("inline");
    expect(h.calls[0]!.args).toEqual([h.seed, "reader", snapshot, { dispatchRegistry: h.repositoryDispatch }]);
    expect(registry).toBe(h.calls[0]!.registry);
  });

  test("both schedules preserve exact installed source identities, checked fields and dispatch binding", async () => {
    const h = harness();
    const main = await h.buildReaderFieldRegistry("reader", snapshot, documents);
    const worker = await h.buildReaderFieldRegistry("reader", snapshot, documents, { preparation: "inline" });
    expect(h.calls.map((call) => call.schedule)).toEqual(["async", "inline"]);
    expect(h.calls[0]!.args).toEqual(h.calls[1]!.args);
    for (const { args } of h.calls) {
      expect(args[0]).toBe(h.seed);
      expect(args[1]).toEqual([...h.projection.ownerModules, prepared.module]);
      expect(args[2]).toEqual({
        externalFields: [...h.projection.externalFields, sourceField],
        identityKinds: new Map([["account-field", "field"], [sourceField.id, "field"]]),
        fieldRepresentations: h.projection.fieldRepresentations,
        dispatchRegistry: h.sourceDispatch, bodySpellingPolicy: "defer-legacy-db",
      });
      expect(args[2].dispatchRegistry).toBe(h.sourceDispatch);
      expect(args[2].fieldRepresentations).toBe(h.projection.fieldRepresentations);
    }
    expect(h.acquired).toEqual(documents.flatMap((document) => [
      [document.source, document.namespace, document.identity], [document.source, document.namespace, document.identity],
    ]));
    expect(h.acquired[0]![2]).toBe(identity);
    expect(h.namespaceChecks).toEqual([[[prepared], ["std", "authority"]], [[prepared], ["std", "authority"]]]);
    expect(h.bound).toEqual([main, worker]);
    expect(h.readerSourceDeclarations(main)).toEqual(h.readerSourceDeclarations(worker));
    expect(h.readerSourceDeclarations(worker)).toEqual({
      functions: ["installed-function"], entities: [{ id: "installed-type", module: "Installed" }],
    });
    expect(Object.isFrozen(h.readerSourceDeclarations(worker))).toBe(true);
  });

  test("a new source body is freshly prepared even when its claimed identity is unchanged", async () => {
    const h = harness();
    await h.buildReaderFieldRegistry("reader", snapshot, documents, { preparation: "inline" });
    const replacement = { ...documents[0]!, source: "module Installed where\nupdated = 1\n" };
    await h.buildReaderFieldRegistry("reader", snapshot, [replacement], { preparation: "inline" });
    expect(h.acquired.map((args) => args[0])).toEqual([documents[0]!.source, replacement.source]);
    expect(h.acquired[1]![2]).toBe(identity);
    expect(h.calls).toHaveLength(2);
  });

  test("inline construction preserves refusal without retrying through another schedule", async () => {
    for (const roster of [[], documents]) {
      const h = harness(); h.failBuild();
      await expect(h.buildReaderFieldRegistry("reader", snapshot, roster, { preparation: "inline" }))
        .rejects.toThrow("Checked registry refused invalid identities");
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]!.schedule).toBe("inline");
      expect(h.bound).toEqual([]);
      expect(h.readerSourceDeclarations(h.calls[0]!.registry)).toBeUndefined();
    }
  });

  test("invalid source namespaces and committed graphs fail before either constructor", async () => {
    for (const preparation of ["worker", "inline"]) {
      const names = harness(); names.failNamespace();
      await expect(names.buildReaderFieldRegistry("reader", snapshot, documents, { preparation }))
        .rejects.toThrow("Reserved source namespace");
      expect(names.calls).toEqual([]);
      const graph = harness(); graph.failProjection();
      await expect(graph.buildReaderFieldRegistry("reader", snapshot, documents, { preparation }))
        .rejects.toThrow("Invalid committed graph");
      expect(graph.calls).toEqual([]);
    }
  });

  test("the actual catalog initialization selects inline checked preparation", async () => {
    const workerSource = await Bun.file(new URL("./expression-runner/authoring-catalog-worker-main.ts", import.meta.url)).text();
    const start = workerSource.indexOf('if (data.method === "initialize") {');
    const end = workerSource.indexOf('if (!base)', start);
    if (start < 0 || end < 0) throw new Error("Catalog initialization boundary changed");
    const initialize = transpiler.transformSync(`async function initialize(data: any) { ${workerSource.slice(start, end)} }`);
    const calls: unknown[][] = [], sent: any[] = [];
    const registry = {}, catalog = { functions: [], types: [] };
    const globals = {
      registerCatalogEntities: () => {},
      // W1: the realm's previous snapshot is released before every build.
      releaseSnapshotState: () => {},
      buildReaderFieldRegistry: async (...args: unknown[]) => { calls.push(args); return registry; },
      createAccountFieldRegistry: () => { throw new Error("Unexpected no-source compatibility branch"); },
      buildSessionCatalog: (value: unknown) => { expect(value).toBe(registry); return catalog; },
      createDetachedAuthoringEnvironment: (value: unknown) => value,
      environmentForCatalog: (value: unknown) => ({ catalog: value }),
      evaluateContextForCatalog: (value: unknown) => { expect(value).toBe(registry); return {}; },
      getCatalog: (value: unknown) => { expect(value).toBe(registry); return []; },
      scope: { postMessage: (message: unknown) => sent.push(message) },
    };
    const run = new Function(...Object.keys(globals), `let base, physicalPreviewPartition, readerPresentationSource, localFieldSource, localPreparationInitialization;
      let nextPhysicalPreviewSnapshot = 0; ${initialize}; return initialize;`)(...Object.values(globals));
    for (const sourceModules of [[], documents]) await run({ id: 1, method: "initialize", accountId: "reader", snapshot,
      entities: [], sourceModules });
    expect(calls).toEqual([
      ["reader", snapshot, [], { preparation: "inline" }],
      ["reader", snapshot, documents, { preparation: "inline" }],
    ]);
    expect(sent).toHaveLength(2);
    expect(sent.every(message => message.ok && message.result.catalog === catalog)).toBe(true);
  });
});
