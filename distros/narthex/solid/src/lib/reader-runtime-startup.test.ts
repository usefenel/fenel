import { describe, expect, test } from "bun:test";
import type { ReaderSourceMetadata } from "./reader-source-metadata";

// Execute the production preparation boundary with its host imports/HTTP held.
// The semantic registry/session builders stay behind these controlled imports;
// this test owns request order, failure cleanup and the session publication fence.
const source = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
// The extracted function harness uses TS; validate the actual JSX-bearing file
// as TSX too so generic arrows cannot silently break the browser import.
new Bun.Transpiler({ loader: "tsx" }).transformSync(source);
const start = source.indexOf("export type AccountReaderPreparation");
if (start < 0) throw new Error("Reader preparation boundary changed");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start))
  .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const root = deferred<{ root: { id: string } }>();
  const importsStarted = deferred<void>();
  const authoringImport = deferred<unknown>();
  const events: string[] = [];
  let epoch = 3;
  let disposed = 0;
  let holdAuthoring = false;
  let metadataError: Error | undefined;
  let metadataTargets: string[] = [];
  let definitionSnapshot: object = {};
  const typeRows: unknown[] = [];
  const dispatchRows: unknown[] = [];
  const metadataBatches: string[][] = [];
  let refreshMetadata!: () => Promise<void>;
  let refreshDefinitions!: () => Promise<void>;
  let readSnapshot!: () => { metadata: Map<string, Map<string, Record<string, unknown>>>;
    ownPresentations: Map<string, { label?: string; icon?: string }> };
  let built = 0;
  let holdRegistry = false;
  let sourceModules: unknown[] = [];
  let holdingNamespaces = false;
  let holdingCatalog = false;
  const namespaces = deferred<ReadonlySet<string>>();
  const namespacesStarted = deferred<void>();
  const catalogFlight = deferred<object>();
  const repositoryNamespaces = new Set(["std", "authority", "subject"]);
  const registryOptions: unknown[] = [];
  const workerInputs: unknown[][] = [], registryInputs: unknown[][] = [];
  const registryFlight = deferred<unknown>();
  const registryStarted = deferred<void>();
  const workerSignals: AbortSignal[] = [];
  const discardedRegistries: unknown[] = [];
  let draftSnapshot: unknown;
  let selectedDraftSource: unknown;
  let draftChanged!: () => void;
  let draftSource!: () => Promise<any>;
  let draftOptions: { synchronization?: unknown; canStageRepresentations?: () => boolean };
  let accountSourceOptions: any;
  let distinctRegistries = false;
  let frameAccount: string | null = "reader-A";
  const reloadStarted = deferred<void>();
  const registry = { owner: "reader-A", getUuid: () => undefined };
  const authority = { captured: "reader-A" };
  const session = { registry, evaluateContext: { _authority: authority,
    _specRegistry: { listClasses: () => [], listInstances: () => [] } } };
  const authoring = {
    mergeBrowserEvaluateContext: (frame: any) => ({ ...frame, _specRegistry: Object.freeze({
      listClasses: () => frame._specRegistry.listClasses(),
      listInstances: () => frame._specRegistry.listInstances(),
      addInstance: () => { throw new Error("browser evaluator dispatch registry is read-only"); },
    }) }),
    readerDraftAuthoringSession: (base: unknown, scope: { accountId: string }) => {
      expect(scope.accountId).toBe("reader-A"); return base;
    },
    prepareReaderAuthoringSession: async (value: unknown, id: string, _snapshot: unknown, _entities: unknown,
      _functions: unknown, _modules: unknown, preparedCatalog: Promise<unknown>) => {
      expect((value as { owner: string }).owner).toBe("reader-A"); expect(id).toBe("reader-A");
      events.push("prepare-catalog"); await preparedCatalog; return { ...session, registry: value };
    },
  };
  const workers = { preparedAuthoringDisplayCatalog: () => [], discardPreparedAuthoringWorker: (value: unknown) => { discardedRegistries.push(value); },
    prepareCatalogInWorker: async (_id: string, _snapshot: unknown, _entities: unknown, _functions: unknown,
      options: { signal?: AbortSignal; onRepositoryNamespaces?: (names: ReadonlySet<string>) => void }) => {
      events.push("catalog-worker");
      workerInputs.push([_snapshot, _entities, _functions]);
      if (workerInputs.length > 1) reloadStarted.resolve();
      if (options.signal) workerSignals.push(options.signal);
      if (options.onRepositoryNamespaces) {
        events.push("namespace-preflight"); namespacesStarted.resolve();
        const names = await (holdingNamespaces ? namespaces.promise : repositoryNamespaces);
        options.signal?.throwIfAborted();
        options.onRepositoryNamespaces(names);
        events.push("namespace-projected");
      }
      return holdingCatalog ? catalogFlight.promise : {};
    } };
  const query = (name: string, result: unknown) => ({ uncached: async () => { events.push(name); return result; } });
  const client = {
    accountId: "reader-A", epoch: 3, signal: new AbortController().signal,
    getLocusRoot: Object.assign(() => {
      if (disposed) throw new Error("This reader was closed.");
      events.push("root"); return root.promise;
    }, { uncached: () => { events.push("raw-root"); return root.promise; } }),
    getSavedQueries: query("saved-queries", { queries: [] }),
    getTypes: query("types", { types: typeRows }), getFunctions: query("functions", { functions: [] }),
    getViews: query("views", { views: [] }), getDispatchInstances: { uncached: async () => {
      events.push("raw-dispatch"); return { dispatchInstances: dispatchRows };
    } },
    apiRead: async (path: string) => {
      events.push(path);
      if (path === "/reader-metadata/targets") {
        if (metadataError) throw metadataError;
        return { targets: metadataTargets };
      }
      return path === "/modules/installed" ? { modules: sourceModules } : { snapshot: definitionSnapshot };
    },
    api: { readerMetadata: async (targets: string[]) => {
      metadataBatches.push(targets);
      return { entries: targets.map(target => ({ target, representations: metadataTargets.includes(target)
        ? [{ typeName: "Labelable", methods: { label: `Reader A: ${target}` } }, { typeName: "Iconable", methods: { icon: "star" } }] : [],
        ownPresentation: metadataTargets.includes(target) ? { label: `Reader A: ${target}`, icon: "star" } : {} })) };
    } }, revalidate: () => {},
    dispose: () => { disposed++; },
  };
  const wrapped = { ...client, drafts: { snapshot: () => draftSnapshot, source: () => selectedDraftSource } };
  const scope = {
    authoringRealmOwnerFor: () => Object.freeze({}), bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    sessionEpoch: () => epoch,
    untrack: (read: () => unknown) => read(),
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Stale reader session"); },
    createAccountApiClient: (accountId: string, options: { epoch: number; onMetadataChanged(): Promise<void>; onDefinitionsChanged(): Promise<void> }) => {
      expect(accountId).toBe("reader-A"); expect(options.epoch).toBe(3);
      refreshMetadata = options.onMetadataChanged; refreshDefinitions = options.onDefinitionsChanged; return client;
    },
    createReaderDraftClient: (remote: unknown, options: { synchronization?: unknown; createSource(): Promise<any>; onChanged(): void }) => {
      expect(remote).toBe(client); draftChanged = options.onChanged; draftSource = options.createSource; draftOptions = options;
      return wrapped;
    },
    createSignal: (initial: unknown) => {
      let value = initial;
      return [() => value, (next: unknown) => { value = typeof next === "function" ? next(value) : next; }];
    },
    onBrowserSessionChange: () => () => {},
    buildLocalAccountFieldRegistry: async (id: string, _snapshot: unknown, build: (id: string, snapshot: unknown) => Promise<unknown>) => build(id, _snapshot),
    buildReaderFieldRegistry: async (id: string, _snapshot: unknown, _modules: unknown, options: unknown) => {
      expect(id).toBe("reader-A"); built++; registryStarted.resolve();
      registryOptions.push(options);
      registryInputs.push([_snapshot, _modules]);
      return holdRegistry ? registryFlight.promise : distinctRegistries ? { ...registry, revision: built } : registry;
    },
    accountFunctionRows: () => [], repositoryFunctionIdsForAuthoring: async () => new Set(),
    loadModule: async (path: string) => {
      events.push(`import:${path}`);
      importsStarted.resolve();
      if (path === "./expression-runner/authoring-session") return holdAuthoring ? authoringImport.promise : authoring;
      if (path === "./expression-runner/authoring-catalog-worker") return workers;
      if (path === "./web-template-registry") return { createReaderTemplateRegistry: () => ({}) };
      if (path === "./reader-presentation") return { createReaderPresentation: (read: typeof readSnapshot) => { readSnapshot = read; return {}; },
        representationsFromReaderSnapshot: () => [] };
      if (path === "./authoring-json") return { fieldDefinitionSnapshotFromJsonWire: (value: unknown) => value };
      if (path === "@fenel/engine/type-foundation") return { Ref: (id: string) => ({ $ref: id }) };
      if (path === "@fenel/engine/authority") return { frameAccount: () => frameAccount };
      if (path === "@fenel/engine") return {
        invokeCallable: (ref: { $ref: string }, args: any[]) => {
          events.push(ref.$ref);
          if (ref.$ref === "view:browserDataFromRoot") return { tabId: args[0].id, revision: args[0].revision,
            definitions: args[3], representations: args[2].map((row: any) => ({ id: row.id, value: row })),
            entries: [], values: [], layout: args[0].layout, rootProjection: args[0] };
          if (ref.$ref === "view:browserDataRoot") return { ...args[0].rootProjection, revision: args[0].revision };
          throw new Error(`Unexpected call: ${ref.$ref}`);
        },
        createDispatchRegistry: () => {
          const rows: any[] = [];
          return { defineClass: () => {}, listClasses: () => [], listInstances: () => rows,
            addInstance: (row: unknown) => { rows.push(row); } };
        },
        refreshAccountInstances: (dispatch: any, id: string, rows: unknown[]) => {
          expect(id).toBe("reader-A");
          for (const row of rows) dispatch.addInstance({ ...(row as object), scope: { kind: "account", accountId: id } });
        },
      };
      if (path === "./instances/instance-draft") return { apiRowToDraft: (row: any) => row.instance };
      if (path === "@fenel/engine/authoring/type") return {
        isInstanceJsonEncoding: (encoding: unknown) => encoding === "native-json",
        instanceFromJsonWire: (instance: unknown) => instance,
      };
      if (path === "@fenel/engine/field-authoring") return {
        fieldPersistenceSnapshotMatches: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        planFieldPersistence: (input: unknown) => { throw new Error(`Test did not authorize planning: ${input}`); },
      };
      if (path === "@fenel/engine/repository-field-catalog") return { REPOSITORY_REUSABLE_DURABLE_FIELDS: [] };
      if (path === "@fenel/engine/repository-identity-manifest") return { repositoryIdentityKinds: () => new Map() };
      if (path === "./local-locus-data") return { createBrowserDataSource: (options: any) => {
        accountSourceOptions = options;
        let current: any;
        return {
          ready: async () => { current ??= await options.prepareSnapshot(options.initial.definitions,
            options.initial.representations.map((row: any) => row.value.instance), new AbortController().signal); },
          snapshot: () => current, state: () => options.initial,
          root: () => options.projectRoot(options.initial, options.rootType),
          dispose: () => { if (current) { options.retireSnapshot(current); current = undefined; } },
        };
      } };
      throw new Error(`Unexpected module: ${path}`);
    },
  };
  const production = new Function(...Object.keys(scope), `${code}; return { startAccountReaderRuntime, createAccountReaderRuntime };`)(...Object.values(scope)) as
    Pick<typeof import("./reader-runtime"), "startAccountReaderRuntime" | "createAccountReaderRuntime">;
  return { ...production, root, client, wrapped, events, importsStarted, authority,
    openDraftSource: () => draftSource(), sourceOptions: () => accountSourceOptions,
    wrapperOptions: () => draftOptions, useDistinctRegistries: () => { distinctRegistries = true; },
    useBootstrapFrame: () => { frameAccount = null; },
    selectDraftSnapshot: (snapshot: unknown) => { draftSnapshot = snapshot; draftChanged(); },
    selectDraftSource: (source: unknown) => { selectedDraftSource = source; },
    metadataBatches, setMetadataTargets: (targets: string[]) => { metadataTargets = targets; },
    refreshMetadata: () => refreshMetadata(), metadata: () => readSnapshot().metadata,
    ownPresentations: () => readSnapshot().ownPresentations,
    refreshDefinitions: () => refreshDefinitions(), reloadStarted: reloadStarted.promise, discardedRegistries,
    setDefinitionSnapshot: (value: object) => { definitionSnapshot = value; },
    addTypeRow: (row: unknown) => { typeRows.push(row); },
    addDispatchRow: (row: unknown) => { dispatchRows.push(row); },
    disposed: () => disposed, built: () => built, advanceSession: () => { epoch++; },
    workerSignals, registryStarted: registryStarted.promise,
    sourceModules: (modules: unknown[]) => { sourceModules = modules; }, repositoryNamespaces, registryOptions, workerInputs, registryInputs,
    namespacesStarted: namespacesStarted.promise, holdNamespaces: () => { holdingNamespaces = true; },
    releaseNamespaces: () => namespaces.resolve(repositoryNamespaces),
    failNamespaces: () => namespaces.reject(new Error("Namespace preparation failed")),
    holdCatalog: () => { holdingCatalog = true; }, releaseCatalog: () => catalogFlight.resolve({}),
    holdRegistry: () => { holdRegistry = true; }, releaseRegistry: () => registryFlight.resolve(registry),
    failRegistry: () => registryFlight.reject(new Error("Registry failed")),
    failMetadata: () => { metadataError = new Error("API timeout: /reader-metadata/targets did not respond within 60s"); },
    holdAuthoring: () => { holdAuthoring = true; }, releaseAuthoring: () => authoringImport.resolve(authoring) };
}

describe("progressive reader startup", () => {
  test("source metadata requires the selected owner's exact session and retires on source replacement", async () => {
    const h = harness();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    expect(runtime.captureSourceMetadata?.()).toBeUndefined();
    const packet = Object.freeze({ $tag: "ReaderSourceMetadata", source: { $tag: "AccountSource", accountId: "reader-A" },
      rootId: "reader-A", generation: "reader-A-generation", expressions: [], occurrences: [], callableLabels: [],
    } satisfies ReaderSourceMetadata);
    const generationToken = Object.freeze({});
    const ownerSession = runtime.session();
    let capturedSession = {};
    const source = { captureSourceMetadata: () => ({ session: capturedSession, packet, generationToken, current: () => true }) };
    h.selectDraftSource(source);
    expect(runtime.captureSourceMetadata?.()).toBeUndefined();
    capturedSession = ownerSession;
    const capture = runtime.captureSourceMetadata!()!;
    expect(capture.session).toBe(ownerSession);
    expect(capture.packet).toBe(packet);
    expect(capture.generationToken).toBe(generationToken);
    expect(capture.current()).toBe(true);
    h.selectDraftSource({ ...source });
    expect(capture.current()).toBe(false);
    h.selectDraftSource(source);
    h.selectDraftSnapshot({ session: {} });
    expect(capture.current()).toBe(false);
    h.selectDraftSnapshot(undefined);
    const beforeClose = runtime.captureSourceMetadata!()!;
    runtime.dispose();
    expect(beforeClose.current()).toBe(false);
  });

  test("stored rows use canonical account ownership and the existing browser egress", async () => {
    const h = harness(); h.useBootstrapFrame();
    h.setDefinitionSnapshot({ owners: [], fields: [], facets: [] });
    h.addDispatchRow({ id: "account-label", instance: { typeName: "Labelable", args: ["private-data"], methods: { label: "Account label" } } });
    h.addDispatchRow({ id: "account-icon", instance: { typeName: "Iconable", args: ["private-data"], methods: { icon: "star" }, scope: "global" } });
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const source = await h.openDraftSource();
    expect(h.sourceOptions().metadataSource).toEqual({ $tag: "AccountSource", accountId: "reader-A" });
    const pool = source.snapshot().session.evaluateContext._specRegistry;
    expect(pool.listInstances().map((row: any) => row.scope)).toEqual([
      { kind: "account", accountId: "reader-A" }, { kind: "account", accountId: "reader-A" },
    ]);
    expect(() => pool.addInstance({})).toThrow("read-only");
    expect(h.wrapperOptions().canStageRepresentations?.()).toBe(false);
    source.dispose(); runtime.dispose();
  });

  test("unknown representation encodings refuse source ingress before decoding", async () => {
    const h = harness();
    h.setDefinitionSnapshot({ owners: [], fields: [], facets: [] });
    h.addDispatchRow({ id: "account-label", valueEncoding: "unknown-encoding",
      instance: { typeName: "Labelable", args: ["private-data"], methods: { label: "Account label" } } });
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    await expect(h.openDraftSource()).rejects.toThrow("unsupported value encoding");
    expect(h.sourceOptions()).toBeUndefined();
    runtime.dispose();
  });

  test("a source preserving the bootstrap frame retains authorized server metadata", async () => {
    const h = harness(); h.useBootstrapFrame();
    h.setDefinitionSnapshot({ owners: [], fields: [], facets: [] });
    h.setMetadataTargets(["named-account-data"]);
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const source = await h.openDraftSource();
    h.selectDraftSnapshot(source.snapshot());
    expect(h.metadata().get("named-account-data")?.get("Labelable")?.label).toBe("Reader A: named-account-data");
    source.dispose(); runtime.dispose();
  });

  test("a changed server definition cannot become the baseline for an older open editor", async () => {
    const h = harness();
    h.setDefinitionSnapshot({ owners: [], fields: [], facets: [] });
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const committed = runtime.registry();
    h.setDefinitionSnapshot({ owners: [], fields: [{ id: "new-server-field" }], facets: [] });
    await expect(h.openDraftSource()).rejects.toThrow("Definitions changed since this reader was opened");
    expect(h.sourceOptions()).toBeUndefined();
    expect(h.built()).toBe(1);
    expect(runtime.registry()).toBe(committed);
    expect(h.discardedRegistries).toHaveLength(0);
    runtime.dispose();
  });

  test("draft type edits retain their storage identity and remove the prior row", async () => {
    const h = harness(); h.useDistinctRegistries();
    const prior = { kind: "type", ownerKey: "type:Person", storageName: "Person", storageId: "stored-person",
      definition: { id: "Person", type: { $unit: true } } };
    const definitions = { owners: [prior], fields: [], facets: [] };
    h.setDefinitionSnapshot(definitions);
    h.addTypeRow({ id: "stored-person", name: "Person", type: { $unit: true }, isSystem: false });
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const source = await h.openDraftSource();
    const edited = { ...definitions, owners: [{ ...prior, definition: { id: "Person", type: { $void: true } } }] };
    const candidate = await h.sourceOptions().prepareSnapshot(edited, [], new AbortController().signal);
    expect(candidate.types).toEqual([{ id: "stored-person", name: "Person", type: { $void: true }, isSystem: false }]);
    h.sourceOptions().retireSnapshot(candidate);
    const deleted = await h.sourceOptions().prepareSnapshot({ ...definitions, owners: [] }, [], new AbortController().signal);
    expect(deleted.types).toEqual([]);
    h.sourceOptions().retireSnapshot(deleted);
    source.dispose(); runtime.dispose();
  });

  test("the immediate wrapped reader acquires its account source only after a paused edit", async () => {
    const h = harness();
    const definitions = { owners: [], fields: [], facets: [] };
    h.setDefinitionSnapshot(definitions);
    const synchronization = { enabledNow: () => false };
    const preparation = h.startAccountReaderRuntime("reader-A", { synchronization: synchronization as never });
    expect(preparation.client).toBe(h.wrapped as never);
    expect(h.wrapperOptions().synchronization).toBe(synchronization);
    h.root.resolve({ root: { id: "reader-A", revision: 17, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const committedRegistry = runtime.registry();
    expect(h.events.includes("raw-dispatch")).toBe(false);
    const source = await h.openDraftSource();
    expect(source.snapshot().registry).toBe(committedRegistry);
    expect(source.snapshot().session.evaluateContext._authority).toBe(h.authority);
    expect(h.sourceOptions().id).toBe("reader-A");
    expect(h.sourceOptions().initial.revision).toBe(17);
    expect(h.sourceOptions().initial.definitions).toBe(definitions);
    expect(h.events.filter(event => event === "raw-dispatch")).toHaveLength(1);
    expect(h.events.filter(event => event === "saved-queries")).toHaveLength(1);
    expect(h.built()).toBe(1);
    source.dispose();
    expect(h.discardedRegistries).toHaveLength(0);
    runtime.dispose();
    expect(h.discardedRegistries).toEqual([committedRegistry]);
  });

  test("draft definitions reuse account preparation and preserve installed source and authority", async () => {
    const h = harness(); h.useDistinctRegistries();
    const definitions = { owners: [], fields: [], facets: [] };
    h.setDefinitionSnapshot(definitions);
    const installed = [{ source: "module Installed where" }];
    h.sourceModules(installed);
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const source = await h.openDraftSource();
    const next = { ...definitions, owners: [{ kind: "type", ownerKey: "Person", storageName: "Person",
      definition: { id: "type-person", type: { $unit: true } } }] };
    const candidate = await h.sourceOptions().prepareSnapshot(next, [], new AbortController().signal);
    expect(h.built()).toBe(2);
    expect(candidate.registry).not.toBe(runtime.registry());
    expect(h.registryInputs[1]?.[1]).toEqual(installed);
    expect(candidate.types).toContainEqual({ id: "type-person", name: "Person", type: { $unit: true }, isSystem: false });
    expect(candidate.session.evaluateContext._authority).toBe(h.authority);
    expect(candidate.modules).toEqual(installed);
    h.sourceOptions().retireSnapshot(candidate);
    expect(h.discardedRegistries).toEqual([candidate.registry]);
    source.dispose(); runtime.dispose();
  });

  test("a committed reload keeps a borrowed draft registry alive until that source releases it", async () => {
    const h = harness(); h.useDistinctRegistries();
    h.setDefinitionSnapshot({ owners: [], fields: [], facets: [] });
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A", revision: 2, type: { $unit: true }, layout: { kind: "grid" } } } as never);
    const runtime = await preparation.ready;
    const committedRegistry = runtime.registry();
    const source = await h.openDraftSource();
    h.selectDraftSnapshot(source.snapshot());
    await runtime.reload();
    expect(runtime.registry()).toBe(committedRegistry);
    expect(runtime.session()).toBe(source.snapshot().session);
    expect(h.discardedRegistries).toHaveLength(0);
    h.selectDraftSnapshot(undefined);
    expect(runtime.registry()).not.toBe(committedRegistry);
    source.dispose();
    expect(h.discardedRegistries).toEqual([committedRegistry]);
    runtime.dispose();
    expect(h.discardedRegistries).toHaveLength(2);
  });

  test("a later committed definition makes an overlapping refresh reread before acknowledgement", async () => {
    const h = harness();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    h.setDefinitionSnapshot({ version: 1 }); h.holdCatalog();
    let acknowledged = false;
    const first = h.refreshDefinitions().then(() => { acknowledged = true; });
    await h.reloadStarted;
    h.setDefinitionSnapshot({ version: 2 });
    const second = h.refreshDefinitions();
    expect(acknowledged).toBe(false);
    h.releaseCatalog();
    await Promise.all([first, second]);
    expect(h.registryInputs.map(input => input[0])).toEqual([{}, { version: 1 }, { version: 2 }]);
    expect(h.built()).toBe(3);
    expect(runtime.revision()).toBe(1);
    expect(h.discardedRegistries).toHaveLength(2);
    runtime.dispose();
  });

  test("a pre-ready reader cannot report an empty definition refresh as successful", async () => {
    const h = harness();
    const preparation = h.startAccountReaderRuntime("reader-A");
    await expect(h.refreshDefinitions()).rejects.toThrow("editing tools are not ready");
    expect(h.built()).toBe(0);
    h.root.resolve({ root: { id: "reader-A" } });
    (await preparation.ready).dispose();
  });

  test("closing while a replacement prepares cannot acknowledge or publish it", async () => {
    const h = harness();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    h.holdCatalog();
    const pending = h.refreshDefinitions();
    await h.reloadStarted;
    runtime.dispose(); h.releaseCatalog();
    await expect(pending).rejects.toThrow("reader was closed");
    expect(h.workerSignals[1]!.aborted).toBe(true);
  });

  test("installed-source main preparation waits for exact namespaces but overlaps the unfinished catalog", async () => {
    const h = harness();
    const sources = [{ source: "module Installed where" }];
    h.sourceModules(sources); h.holdNamespaces(); h.holdCatalog();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    await h.namespacesStarted;
    expect(h.built()).toBe(0);
    sources[0]!.source = "module ChangedWhileWaiting where";
    h.releaseNamespaces();
    await h.registryStarted;
    expect(h.registryOptions).toEqual([{ repositoryNamespaces: h.repositoryNamespaces }]);
    expect((h.registryOptions[0] as { repositoryNamespaces: unknown }).repositoryNamespaces).toBe(h.repositoryNamespaces);
    expect(h.registryInputs[0]![1]).toEqual([{ source: "module Installed where" }]);
    expect(h.registryInputs[0]![0]).toBe(h.workerInputs[0]![0]);
    h.releaseCatalog();
    const runtime = await preparation.ready;
    expect(h.built()).toBe(1);
    expect(h.events.indexOf("namespace-projected")).toBeLessThan(h.events.indexOf("prepare-catalog"));
    runtime.dispose();
  });

  test("failed namespace preparation cannot fall back to a main-thread reservation build", async () => {
    const h = harness(); h.sourceModules([{ source: "module Installed where" }]); h.holdNamespaces();
    const preparation = h.startAccountReaderRuntime("reader-A");
    void preparation.ready.catch(() => {});
    h.root.resolve({ root: { id: "reader-A" } });
    await h.namespacesStarted; h.failNamespaces();
    await expect(preparation.ready).rejects.toThrow("Namespace preparation failed");
    expect(h.built()).toBe(0);
    expect(h.workerSignals[0]!.aborted).toBe(true);
    expect((await preparation.client.getLocusRoot()).root.id).toBe("reader-A");
  });

  test("closed and replaced readers reject a late namespace projection before their main registry", async () => {
    for (const closed of [true, false]) {
      const h = harness(); h.sourceModules([{ source: "module Installed where" }]); h.holdNamespaces();
      const abort = new AbortController();
      const preparation = h.startAccountReaderRuntime("reader-A", { signal: abort.signal });
      void preparation.ready.catch(() => {});
      h.root.resolve({ root: { id: "reader-A" } });
      await h.namespacesStarted;
      if (closed) abort.abort(new Error("Reader closed")); else h.advanceSession();
      h.releaseNamespaces();
      await expect(preparation.ready).rejects.toThrow(closed ? "Reader closed" : "Stale reader session");
      expect(h.built()).toBe(0);
      expect(h.workerSignals[0]!.aborted).toBe(true);
    }
  });
  test("the scoped root arrives before authoring imports and the complete reader uses that client", async () => {
    const h = harness();
    const stages: string[] = [];
    const preparation = h.startAccountReaderRuntime("reader-A", { onStage: stage => stages.push(stage) });
    expect(preparation.client).toBe(h.wrapped as never);
    await Promise.resolve();
    expect(h.events).toEqual(["root"]);
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    expect(runtime.client).toBe(preparation.client);
    expect(runtime.accountId).toBe("reader-A");
    expect(h.events.filter(value => value === "root")).toHaveLength(1);
    expect(h.events.includes("raw-dispatch")).toBe(false);
    expect(h.events.includes("saved-queries")).toBe(false);
    expect(h.built()).toBe(1);
    expect(h.events.filter(value => value === "/reader-metadata/targets")).toHaveLength(1);
    expect(stages).toEqual(["Loading editing tools…", "Loading data…", "Preparing data…", "Preparing editing tools…"]);
    runtime.dispose();
    expect(h.disposed()).toBe(1);
  });

  test("a denied first root never starts an authoring build", async () => {
    const h = harness();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.reject(new Error("Access denied"));
    await expect(preparation.ready).rejects.toThrow("Access denied");
    expect(h.events).toEqual(["root"]);
    expect(h.built()).toBe(0);
    expect(h.disposed()).toBe(1);
  });

  test("closing during the main build stops its catalog worker before a registry exists", async () => {
    const h = harness(); h.holdRegistry();
    const abort = new AbortController();
    const preparation = h.startAccountReaderRuntime("reader-A", { signal: abort.signal });
    void preparation.ready.catch(() => {});
    h.root.resolve({ root: { id: "reader-A" } });
    await h.registryStarted;
    expect(h.workerSignals).toHaveLength(1);
    expect(h.workerSignals[0]!.aborted).toBe(false);
    abort.abort(new Error("Reader closed"));
    expect(h.workerSignals[0]!.aborted).toBe(true);
    h.releaseRegistry();
    await expect(preparation.ready).rejects.toThrow("Reader closed");
    expect(h.events.includes("prepare-catalog")).toBe(false);
  });

  test("a failed main build stops its independent catalog worker and keeps root data readable", async () => {
    const h = harness(); h.holdRegistry();
    const preparation = h.startAccountReaderRuntime("reader-A");
    void preparation.ready.catch(() => {});
    h.root.resolve({ root: { id: "reader-A" } });
    await h.registryStarted;
    h.failRegistry();
    await expect(preparation.ready).rejects.toThrow("Registry failed");
    expect(h.workerSignals).toHaveLength(1);
    expect(h.workerSignals[0]!.aborted).toBe(true);
    expect(h.disposed()).toBe(0);
    expect((await preparation.client.getLocusRoot()).root.id).toBe("reader-A");
  });

  test("closing a pending reader prevents late data from starting preparation", async () => {
    const h = harness();
    const abort = new AbortController();
    const preparation = h.startAccountReaderRuntime("reader-A", { signal: abort.signal });
    abort.abort(new Error("Reader closed"));
    h.root.resolve({ root: { id: "reader-A" } });
    await expect(preparation.ready).rejects.toThrow("Reader closed");
    expect(h.events).toEqual(["root"]);
    expect(h.built()).toBe(0);
  });

  test("an editor metadata failure preserves visible data until its owner closes the reader", async () => {
    const h = harness();
    const abort = new AbortController();
    h.failMetadata();
    const preparation = h.startAccountReaderRuntime("reader-A", { signal: abort.signal });
    h.root.resolve({ root: { id: "reader-A" } });
    await expect(preparation.ready).rejects.toThrow("API timeout: /reader-metadata/targets");
    expect(h.disposed()).toBe(0);
    expect((await preparation.client.getLocusRoot()).root.id).toBe("reader-A");
    abort.abort();
    expect(h.disposed()).toBe(1);
    expect(() => preparation.client.getLocusRoot()).toThrow("This reader was closed.");
  });

  test("a failed complete-reader request closes the client that was never handed to its caller", async () => {
    const h = harness();
    h.failMetadata();
    const pending = h.createAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    await expect(pending).rejects.toThrow("API timeout: /reader-metadata/targets");
    expect(h.disposed()).toBe(1);
  });

  test("a login change while code arrives cannot publish the previous account registry", async () => {
    const h = harness();
    h.holdAuthoring();
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    await h.importsStarted.promise;
    h.advanceSession();
    h.releaseAuthoring();
    await expect(preparation.ready).rejects.toThrow("Stale reader session");
    expect(h.built()).toBe(0);
    expect(h.events.includes("types")).toBe(false);
  });

  test("only target ids are acquired before bounded reader metadata batches", async () => {
    const h = harness();
    const targets = Array.from({ length: 260 }, (_, index) => `target-${index}`);
    h.setMetadataTargets(targets);
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    expect(h.metadataBatches.map(batch => batch.length)).toEqual([128, 128, 4]);
    expect(h.metadataBatches.flat()).toEqual(targets);
    expect(h.metadata().get("target-259")?.get("Labelable")?.label).toBe("Reader A: target-259");
    runtime.dispose();
  });

  test("metadata refresh still resolves deleted override targets and does not rebuild the registry", async () => {
    const h = harness();
    h.setMetadataTargets(["removed", "kept"]);
    const preparation = h.startAccountReaderRuntime("reader-A");
    h.root.resolve({ root: { id: "reader-A" } });
    const runtime = await preparation.ready;
    expect(h.metadata().get("removed")?.get("Labelable")?.label).toBe("Reader A: removed");
    expect(h.ownPresentations().get("removed")).toEqual({ label: "Reader A: removed", icon: "star" });
    h.setMetadataTargets(["kept", "new"]);
    await h.refreshMetadata();
    expect(h.metadataBatches).toEqual([["removed", "kept"], ["removed", "kept", "new"]]);
    expect(h.metadata().get("removed")?.size).toBe(0);
    expect(h.ownPresentations().get("removed")).toEqual({});
    expect(h.ownPresentations().get("new")).toEqual({ label: "Reader A: new", icon: "star" });
    expect(h.metadata().get("new")?.get("Labelable")?.label).toBe("Reader A: new");
    expect(h.built()).toBe(1);
    runtime.dispose();
  });
});
