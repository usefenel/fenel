import { captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { describe, expect, test } from "bun:test";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";
import { beginBrowserDataStorageCommit } from "./browser-data-storage";

const source = (await Bun.file(process.env.FENEL_LIFETIME_HOLDER_SOURCE ?? new URL("./local-locus-data.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const preparer = "export async function prepareLocalReaderSnapshot(";
const preparationStart = source.indexOf(preparer);
const preparationEnd = source.indexOf("\nexport type LocalSavedValueRow", preparationStart);
if (preparationStart < 0 || preparationEnd <= preparationStart || source.split(preparer).length !== 2) {
  throw new Error("The local snapshot preparation dependency boundary changed.");
}
// Keep this consumer-lifetime fixture's original injected preparation boundary.
// The unchanged producer now lives beside its sole browser caller.
const consumerSource = source.slice(0, preparationStart) + source.slice(preparationEnd);
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(consumerSource.replace(/^import[\s\S]*?;\r?\n/gm, ""))
  .replace(/^export /gm, "")
  .replace(/\bimport\(("[^\"]+"|'[^']+')\)/g, "load($1)");

type Registry = { id: number };
type Snapshot = { registry: Registry; session: { evaluateContext: { _authority: object } } };
type State = { tabId: string; revision: number; entries: object[]; values: object[]; representations: object[]; definitions: object };
type TestedSource = {
  id: string;
  readReady(): Promise<void>;
  ready(): Promise<void>;
  retryTools(): Promise<void>;
  snapshot(): Snapshot;
  state(): State;
  revision(): number;
  root(): unknown;
  metadata(): unknown;
  transact(commands: object[], revision?: number, signal?: AbortSignal,
    publication?: { onPublished?: (root: unknown) => void }): Promise<unknown>;
  saveDefinitions(bundle: object, signal?: AbortSignal, mutation?: { expectedRevision: number; commands: readonly object[] }): Promise<unknown>;
  replace(next: State, revision?: number, signal?: AbortSignal): Promise<unknown>;
  dispose(): void;
};
type TestedClient = {
  dispose(): void;
  editLocusRoot(id: string, revision: number, command: object,
    publication?: { onPublished?: (root: unknown) => void }): Promise<unknown>;
  writeDispatchInstances(writes: readonly { existingId?: string; typeName: string; args: unknown[]; instance: Record<string, unknown> }[], revision: number, encodingRegistry?: Registry): Promise<void>;
  api: {
    savedQueryCreate(data: object): Promise<unknown>;
    savedQueryUpdate(id: string, patch: object): Promise<unknown>;
    dispatchInstanceCreate(data: object): Promise<unknown>;
    dispatchInstanceUpdate(id: string, data: object): Promise<unknown>;
  };
};

function fixture() {
  let epoch = 0;
  let afterPreparation: (() => void) | undefined;
  let afterCommit: (() => void) | undefined;
  let afterFoundationImport: (() => void) | undefined;
  let decodedMaybe: unknown;
  const maybeInputs: unknown[] = [];
  let validationFailure: false | "unreadable" | "missing" = false;
  let preparationFailure: Error | undefined;
  let dropTransportOnFailure = false, transportUnavailable = false, unavailableBorrows = 0;
  let earlyTicket: { closed: boolean } | undefined, initialRetries = 0, nextOrdinaryFailure: Error | undefined;
  const nextFailures: Error[] = [];
  let preparationGate: { only?: "worker"; gate: Promise<void> } | undefined;
  const events: string[] = [];
  let plannedDefinitions: object = { owners: [], fields: [], facets: [] };
  const listeners: Array<() => void> = [];
  const created: Snapshot[] = [];
  const discarded: Registry[] = [];
  const retiredWorkers: object[] = [];
  const realmRetirements: Array<{ worker: object; keepRealm: boolean }> = [];
  const lineages: unknown[] = [];
  const closedLineages: unknown[] = [];
  const preparedInputs: Array<{ definitions: object; representations?: object[]; registry?: Registry }> = [];
  const preparedValueIds: Array<readonly string[] | undefined> = [];
  const validationFrames: object[] = [];
  const invokeCallable = (reference: { $ref: string }, args: unknown[], frame: object) => {
    const name = reference.$ref;
    if (name === "view:defaultTabData" || name === "view:defaultLocalTabData") return { tabId: args[0], revision: 0, entries: [], values: [], representations: [], definitions: {} };
    if (name === "view:tabDataWithClipboard") return args[0];
    if (name === "view:tabClipboardPreserved") return true;
    if (name === "view:tabDataRootCommand") return { $tag: "TabEditRoot", command: args[0] };
    if (name === "view:browserDataStorageSnapshot") {
      const value = args[0] as State & { layout?: object };
      return { tabId: value.tabId, revision: value.revision, entries: value.entries, values: value.values,
        representations: value.representations, layout: value.layout, definitions: value.definitions };
    }
    if (name === "view:validateTabData") {
      validationFrames.push(frame);
      return validationFailure === "unreadable" ? { $tag: "Unreadable" }
        : validationFailure === "missing" ? { $tag: "Ok" } : { $tag: "Ok", _0: args[0] };
    }
    if (name === "view:tabDataRoot") {
      return { id: (args[0] as State).tabId, revision: (args[0] as State).revision };
    }
    if (name === "view:tabDataRepresentationRows") return (args[0] as State).representations.map(entry => (entry as { value: object }).value);
    if (name === "view:tabDataValues") return (args[0] as State).values;
    if (name === "view:tabDataMetadataTargets") return [];
    if (name === "view:dependencyMetadataRoster") return { expressions: [], occurrences: [], callableLabels: [] };
    if (name === "view:tabDataValue") return { $tag: "Just", _0: decodedMaybe };
    if (name === "view:tabDataCheckRoot") return (args[0] as State).tabId === args[1]
      ? { $tag: "Ok", _0: true } : { $tag: "Err", _0: "This data belongs to a different source." };
    if (name === "view:browserDataRestoreSnapshot") return { $tag: "Ok", _0: { ...(args[1] as State), revision: (args[0] as State).revision + 1 } };
    if (name === "view:applyTabDataCommands") {
      const state = args[0] as State;
      if (args[1] !== state.revision) return { $tag: "Err", _0: "This tab data changed before this edit." };
      const commands = args[2] as Array<{ $tag: string; definitions?: object; commands?: Array<{ $tag?: string; id?: string; entry: object }> }>;
      if (commands.length === 0) return { $tag: "Ok", _0: state };
      // One transaction applies every command in order and advances one revision.
      return { $tag: "Ok", _0: commands.reduce<State>((next, command) => ({ ...next,
        ...(command.$tag === "TabSetDefinitions" ? { definitions: command.definitions! }
          : command.$tag === "TabEditValues" ? { values: command.commands?.reduce<object[]>((values, edit) => edit.$tag === "LocusRemove"
            ? values.filter(value => (value as { id: string }).id !== edit.id) : [...values, edit.entry], next.values) ?? next.values }
          : command.$tag === "TabPatchValue" || command.$tag === "TabEditRoot" ? {}
          : { representations: command.commands?.map(edit => edit.entry) ?? [{ value: { instance: {} } }] }) }),
        { ...state, revision: state.revision + 1 }) };
    }
    throw new Error(`Unexpected fixture call: ${name}`);
  };
  const bindings = {
    captureRegistryTransportObservation, runLocalOrdinaryOperation,
    retryEarlyAuthoringRealm: (previous: object) => {
      if (previous !== earlyTicket || !earlyTicket.closed) return undefined;
      initialRetries++; transportUnavailable = false; earlyTicket = { closed: false }; return earlyTicket;
    },
    createAuthoringWorkerBrowserStorage: () => ({ load: async () => undefined,
      commit: async (data: State, generation?: number) => ({ schema: "fenel.local-data.v1", generation: (generation ?? 0) + 1, data }) }),
    prepareAuthoringLocalOperation: async (_transport: unknown, operation: LocalOrdinaryOperation, guard: { assertCurrent(): void }) => {
      guard.assertCurrent();
      if (nextOrdinaryFailure) {
        const failure = nextOrdinaryFailure; nextOrdinaryFailure = undefined;
        transportUnavailable = true;
        if (earlyTicket) earlyTicket.closed = true;
        throw failure;
      }
      const value = runLocalOrdinaryOperation({ workspaceCall: (name: string, ...args: unknown[]) => invokeCallable({ $ref: `view:${name}` }, args, { _authority: { epoch, kind: "anonymous-projection" } }), allDataRootDescriptions: () => [] } as any, operation);
      guard.assertCurrent();
      return { kind: "prepared", value, assertCurrent: guard.assertCurrent, release: () => {} };
    },
    beginBrowserDataStorageCommit,
    bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => earlyTicket ??= { closed: false }, discardEarlyAuthoringRealm: () => {},
    LOCAL_BROWSER_SOURCE_ID: "fenel-browser-local",
    createBrowserDataStorage: () => ({ load: async () => undefined,
      commit: async (data: State, generation?: number) => ({ schema: "fenel.local-data.v1", generation: (generation ?? 0) + 1, data }) }),
    locusSynchronizationForSession: () => undefined,
    createSignal: <T>(initial: T) => {
      let value = initial;
      return [() => value, (next: T | ((current: T) => T)) => { value = typeof next === "function" ? (next as (current: T) => T)(value) : next; }] as const;
    },
    untrack: <T>(read: () => T) => read(),
    sessionEpoch: () => epoch,
    assertCurrentSession: (expected: number) => { if (expected !== epoch) throw new Error("Reader session changed"); },
    onBrowserSessionChange: (callback: () => void) => { listeners.push(callback); return () => {}; },
    prepareLocalReaderSnapshot: async (_id: string, definitions: object, options: { representations?: object[]; localValueIds?: readonly string[]; restore?: { registry: Registry; owner: object }; lineage?: object }) => {
      const restored = options.restore?.registry;
      lineages.push(options.lineage);
      events.push(restored ? `prepare-worker:${restored.id}` : "prepare");
      preparedInputs.push({ definitions, representations: options.representations, ...(restored ? { registry: restored } : {}) });
      preparedValueIds.push(options.localValueIds);
      if (preparationGate && (!preparationGate.only || restored)) await preparationGate.gate;
      const failure = nextFailures.shift() ?? preparationFailure;
      if (failure) { if (dropTransportOnFailure) transportUnavailable = true; throw failure; }
      transportUnavailable = false;
      const registry = restored ?? { id: created.length + 1 };
      // Each preparation owns a new worker; a restoration keeps registry and owner.
      const candidate = { kind: "local", registry, owner: options.restore?.owner ?? {}, worker: { registry }, callableLabels: [],
        // B4 unit E: the worker's instance decoding (identity, as the page codec fixture was).
        // A released worker refuses, as the real transport does.
        convertInstances: async (method: string, instances: Array<{ instance: object }>) => {
          if (retiredWorkers.includes(candidate.worker)) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
          events.push(`${method}:${registry.id}`);
          return instances.map(item => item.instance);
        },
        session: { evaluateContext: { _authority: { epoch, kind: "anonymous" } } } };
      created.push(candidate);
      afterPreparation?.();
      return candidate;
    },
    planLocalDefinitionBundle: async () => plannedDefinitions,
    load: async (name: string) => {
      if (name === "@fenel/engine") return { invokeCallable, representationsForTarget: () => new Map() };
      if (name === "@fenel/engine/type-foundation") {
        afterFoundationImport?.();
        return { List: () => ({}), Anything: {}, Ref: ($ref: string) => ({ $ref }),
          peelMaybeValue: (value: unknown) => { maybeInputs.push(value); return decodedMaybe; } };
      }
      if (name.endsWith("authoring-catalog-worker")) return { preparedReaderWorkerClosed: () => false, borrowLocalOrdinaryTransport: () => {
        if (transportUnavailable) { unavailableBorrows++; throw new Error("No current Local ordinary transport"); }
        return { transport: {}, assertCurrent: () => {} };
      }, discardPreparedAuthoringWorker: (registry: Registry) => {
        events.push(`discard:${registry.id}`); discarded.push(registry);
      }, beginPreparedReaderWorkerReplacement: () => () => {}, discardPreparedReaderWorker: (worker: { registry: Registry }, options?: { keepRealm?: boolean }) => {
        events.push(`discard:${worker.registry.id}`); discarded.push(worker.registry); retiredWorkers.push(worker);
        realmRetirements.push({ worker, keepRealm: options?.keepRealm === true });
      }, discardWarmAuthoringRealm: (lineage: object) => { closedLineages.push(lineage); } };
      if (name === "./reader-presentation") return { representationsFromReaderSnapshot: () => [],
        createReaderPresentation: () => ({ presentation: () => undefined }) };
      if (name === "@fenel/engine/authoring/type") return { instanceFromJsonWire: (value: unknown) => value };
      if (name === "./reader-source-metadata") return { readerSourceMetadataPacket: () => undefined };
      if (name === "./workspace-model-loader") return { loadWorkspaceModel: async () => ({
        workspaceCall: (name: string, ...args: unknown[]) => invokeCallable({ $ref: `view:${name}` }, args,
          { _authority: { epoch, kind: "anonymous-projection" } }),
      }) };
      throw new Error(`Unexpected fixture import: ${name}`);
    },
  };
  const compiledModule = new Function(...Object.keys(bindings), `${code}; return { source: localTabDataSource, client: createLocalApiClient, create: createBrowserDataSource };`)(...Object.values(bindings)) as {
    source(): TestedSource; client(source: TestedSource, options?: { accountId?: string; readFallback?: unknown }): TestedClient;
    create(options: object): TestedSource;
  };
  const wrapped = new WeakSet<TestedSource>();
  const factory = () => {
    const value = compiledModule.source();
    if (!wrapped.has(value)) {
      wrapped.add(value);
      const transact = value.transact;
      value.transact = async (...args) => { const root = await transact(...args); afterCommit?.(); return root; };
    }
    return value;
  };
  return {
    source: factory(), nextSource: factory, client: compiledModule.client, create: compiledModule.create, created, discarded, retiredWorkers, preparedInputs, validationFrames, maybeInputs, events,
    realmRetirements, lineages, closedLineages, preparedValueIds,
    failNext: (failure: Error) => { nextFailures.push(failure); },
    dropTransportOnFailure: () => { dropTransportOnFailure = true; },
    unavailableBorrows: () => unavailableBorrows,
    failInitialOrdinary: (failure: Error) => { nextOrdinaryFailure = failure; },
    initialRetries: () => initialRetries,
    holdPreparation: (only?: "worker") => {
      let release!: () => void;
      preparationGate = { only, gate: new Promise<void>(resolve => { release = () => { preparationGate = undefined; resolve(); }; }) };
      return release;
    },
    validationFailure: (fail: false | "unreadable" | "missing") => { validationFailure = fail; },
    preparationFailure: (failure?: Error) => { preparationFailure = failure; },
    plannedDefinitions: (definitions: object) => { plannedDefinitions = definitions; },
    afterPreparation: (callback?: () => void) => { afterPreparation = callback; },
    afterCommit: (callback?: () => void) => { afterCommit = callback; },
    afterFoundationImport: (callback?: () => void) => { afterFoundationImport = callback; },
    decodedMaybe: (value: unknown) => { decodedMaybe = value; },
    changeSession: () => { epoch++; for (const listener of listeners) listener(); },
  };
}

describe("unpublished local catalogue worker lifetime", () => {
  const saved = (id: string) => ({ id, value: { id, query: { kind: "expression", expr: { kind: "literal", value: 42 } } } });
  test("saved identity evidence follows each exact admitted initial, transaction, definition, replacement and Discard candidate", async () => {
    const f = fixture();
    const initial = { tabId: "saved-evidence", revision: 0, entries: [], values: [saved("initial-number")],
      representations: [], definitions: { owners: [], fields: [], facets: [] } };
    const restored = { ...initial, revision: 5, values: [saved("stored-number")] };
    let discard!: () => Promise<boolean>;
    const source = f.create({ id: initial.tabId, initial, progressiveRead: true, storage: { load: async () => ({
      schema: "fenel.local-data.v1", generation: 1, data: restored,
    }) }, initialStorage: { lastSynced: initial }, synchronization: { enabledNow: () => false,
      register: (_key: string, participant: { discard: typeof discard }) => { discard = participant.discard; return () => {}; } } });
    await source.ready();
    expect(f.preparedValueIds.at(-1)).toEqual(["initial-number"]);
    const firstReader = source.snapshot();
    await source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("later-number") }] }]);
    expect(source.snapshot()).toBe(firstReader);
    expect(f.preparedValueIds).toHaveLength(1);
    // The transaction adds a saved ID and changes a row in the same candidate.
    await source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("transaction-number") }] }, { $tag: "TabEditRepresentations" }]);
    expect(f.preparedValueIds.at(-1)).toEqual(["initial-number", "later-number", "transaction-number"]);
    await source.saveDefinitions({}, undefined, { expectedRevision: source.revision(),
      commands: [{ $tag: "TabEditValues", commands: [{ entry: saved("definition-number") }] }] });
    expect(f.preparedValueIds.at(-1)).toEqual(["initial-number", "later-number", "transaction-number", "definition-number"]);
    await source.replace({ ...source.state(), values: [saved("replacement-number")] });
    expect(f.preparedValueIds.at(-1)).toEqual(["replacement-number"]);
    expect(await discard()).toBe(true);
    expect(f.preparedValueIds.at(-1)).toEqual(["stored-number"]);
    expect(source.state().values).toEqual(restored.values);
    source.dispose();
  });

  test("failed candidate saved identity evidence never leaks into published-snapshot restoration", async () => {
    const f = fixture();
    await f.source.ready();
    await f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("published-number") }] }]);
    const before = f.source.state();
    f.failNext(new Error("candidate refused"));
    await expect(f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("unpublished-number") }] },
      { $tag: "TabEditRepresentations" }])).rejects.toThrow("candidate refused");
    await f.source.ready();
    expect(f.preparedValueIds.slice(-2)).toEqual([["published-number", "unpublished-number"], ["published-number"]]);
    expect(f.source.state()).toBe(before);
  });

  test("saved data removal retains its prepared reader; a changed representation target captures fresh evidence", async () => {
    const f = fixture();
    const originalRepresentation = { id: "label", value: { instance: { typeName: "Labelable", args: ["original-number"], methods: {} } } };
    const initial = { tabId: "saved-reuse", revision: 0, entries: [], values: [saved("original-number")],
      representations: [originalRepresentation], definitions: { owners: [], fields: [], facets: [] } };
    const source = f.create({ id: initial.tabId, initial, progressiveRead: true });
    await source.ready();
    const reader = source.snapshot();
    expect(f.preparedValueIds.at(-1)).toEqual(["original-number"]);
    await source.transact([{ $tag: "TabEditValues", commands: [{ $tag: "LocusRemove", id: "original-number" }] }]);
    expect(source.state().values).toEqual([]);
    expect(source.snapshot()).toBe(reader);
    expect(f.preparedValueIds).toEqual([["original-number"]]);
    await source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("new-number") }] }]);
    expect(source.snapshot()).toBe(reader);
    await source.transact([{ $tag: "TabEditRepresentations", commands: [{ entry: { id: "new-label",
      value: { instance: { typeName: "Labelable", args: ["new-number"], methods: {} } } } }] }]);
    expect(source.snapshot()).not.toBe(reader);
    expect(f.preparedValueIds).toEqual([["original-number"], ["new-number"]]);
    source.dispose();
  });

  test("a new browser session captures its own saved identities without retaining the previous witness", async () => {
    const f = fixture();
    await f.source.ready();
    await f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: saved("session-number") }] }]);
    expect(f.preparedValueIds).toEqual([[]]);
    f.changeSession();
    const resumed = f.nextSource();
    await resumed.ready();
    expect(f.preparedValueIds.at(-1)).toEqual(["session-number"]);
    expect(resumed.state().values).toEqual([saved("session-number")]);
  });

  test("HTTP root writes never serialize or invoke a Local publication callback", async () => {
    const apiSource = await Bun.file(new URL("./api.ts", import.meta.url)).text();
    const start = apiSource.indexOf("function editLocusRoot(");
    const end = apiSource.indexOf("const getActiveLocusView", start);
    const method = new Bun.Transpiler({ loader: "ts" }).transformSync(apiSource.slice(start, end));
    const sent: unknown[] = [];
    let callbacks = 0;
    const write = new Function("apiFetch", "nativeJsonBody", `${method}; return editLocusRoot;`)(
      (path: string, init: unknown) => { sent.push({ path, init }); return Promise.resolve({}); },
      (value: unknown) => ({ body: value }),
    );
    const command = { kind: "append", item: { id: "ordinary" } };
    await write("account-root", 7, command, { onPublished: () => { callbacks++; } });
    expect(sent).toEqual([{ path: "/locus-root", init: { method: "PUT",
      body: { id: "account-root", expectedRevision: 7, command } } }]);
    expect(callbacks).toBe(0);
  });

  test("a checked root write acknowledges publication before its old-epoch response retires", async () => {
    const f = fixture();
    await f.source.ready();
    const client = f.client(f.source);
    const receipts: unknown[] = [];
    const pending = client.editLocusRoot(f.source.id, 0, { kind: "append", item: { id: "pasted" } }, {
      onPublished: root => { receipts.push(root); f.changeSession(); },
    });
    await expect(pending).rejects.toThrow("Reader session changed");
    expect(receipts).toEqual([{ id: f.source.id, revision: 1 }]);
    const resumed = f.nextSource();
    await resumed.ready();
    expect(resumed.revision()).toBe(1);
    client.dispose();
  });

  test("a refused source revision never acknowledges a checked root publication", async () => {
    const f = fixture();
    await f.source.ready();
    const client = f.client(f.source);
    let receipts = 0;
    await expect(client.editLocusRoot(f.source.id, 99, { kind: "append", item: { id: "pasted" } }, {
      onPublished: () => { receipts++; },
    })).rejects.toThrow("changed before this edit");
    expect(receipts).toBe(0);
    expect(f.source.revision()).toBe(0);
    client.dispose();
  });

  for (const axis of ["definitions", "representations", "ordinary"] as const)
    test(`initial reader preparation refuses in-place ${axis} mutation before snapshot publication`, async () => {
      const f = fixture();
      await f.source.readReady();
      const before = f.source.state(), root = f.source.root();
      f.afterPreparation(() => {
        if (axis === "definitions") Object.assign(before.definitions, { injectedDuringPreparation: true });
        else if (axis === "representations") before.representations.push({ value: { instance: {} } });
        else before.entries.push({ id: "injected" });
      });
      await expect(f.source.ready()).rejects.toThrow("transport");
      expect(() => f.source.snapshot()).toThrow("not ready");
      expect(f.source.root()).toBe(root);
      expect(f.source.state()).toBe(before);
      expect(f.created).toHaveLength(1);
      expect(f.discarded).toEqual([f.created[0]!.registry]);
    });

  test("explicit Retry rearms a closed initial ordinary incarnation without replaying its failed RPC", async () => {
    const f = fixture();
    f.failInitialOrdinary(new Error("Initial ordinary worker closed"));
    await expect(f.source.readReady()).rejects.toThrow("Initial ordinary worker closed");
    expect(f.created).toHaveLength(0);
    expect(f.initialRetries()).toBe(0);
    expect(() => f.source.root()).toThrow("not ready");
    await f.source.retryTools();
    expect(f.initialRetries()).toBe(1);
    expect(f.created).toHaveLength(1);
    expect(f.source.root()).toMatchObject({ revision: 0 });
    expect(f.unavailableBorrows()).toBe(0);
  });

  test("a representation batch prepares once, clamps scope and advances one revision", async () => {
    const f = fixture();
    await f.source.ready();
    const previous = f.source.snapshot();
    const client = f.client(f.source);
    const writes = ["Labelable", "Describable"].map(typeName => ({ typeName, args: ["data"],
      instance: { typeName, args: ["data"], methods: { text: typeName }, scope: { kind: "account", accountId: "foreign" } } }));
    await client.writeDispatchInstances(writes, 0);
    expect(f.created).toHaveLength(2);
    expect(f.source.revision()).toBe(1);
    expect(f.source.state().representations).toHaveLength(2);
    const retained = f.preparedInputs.at(-1)?.representations as Array<{ scope: object }>;
    expect(retained.map(instance => instance.scope)).toEqual(writes.map(() => ({ kind: "tag", tag: f.source.id })));
    expect(f.discarded).toEqual([previous.registry]);
    client.dispose();
  });

  test("a new definition and its representations publish from one preparation", async () => {
    const f = fixture();
    await f.source.ready();
    const previous = f.source.snapshot();
    const client = f.client(f.source) as TestedClient & { editDefinitionAndData(bundle: object, revision: number,
      mutation: { representations: object[]; encodingRegistry?: object }): Promise<unknown>; instanceEncoding(): object };
    const proposal = { owners: [{ ownerKey: "function:named", kind: "function", storageName: "named",
      definition: { id: "named", params: [], returns: { $ref: "String" }, body: "text" } }], fields: [], facets: [] };
    f.plannedDefinitions(proposal);
    const instance = { typeName: "Codeable", args: ["named"], methods: { codeName: "named" } };
    await client.editDefinitionAndData({ ownerMutations: [] }, 0,
      { representations: [{ typeName: "Codeable", args: ["named"], instance }], encodingRegistry: client.instanceEncoding() });
    // Initial reader plus exactly one rebuild, which already carries the name.
    expect(f.created).toHaveLength(2);
    const scoped = { ...instance, scope: { kind: "tag", tag: f.source.id } };
    expect(f.preparedInputs.at(-1)).toEqual({ definitions: proposal, representations: [scoped] });
    expect(f.source.state().definitions).toBe(proposal);
    expect(f.source.state().representations.map(entry => (entry as { value: { instance: object } }).value.instance)).toEqual([scoped]);
    expect(f.source.revision()).toBe(1);
    expect(f.discarded).toEqual([previous.registry]);
    client.dispose();
  });

  test("a combined definition write encoded by a replaced registry refuses before preparation", async () => {
    const f = fixture();
    await f.source.ready();
    const client = f.client(f.source) as TestedClient & { editDefinitionAndData(bundle: object, revision: number,
      mutation: { representations: object[]; encodingRegistry?: object }): Promise<unknown>; instanceEncoding(): object };
    // B4 unit E: a Local write is encoded by its snapshot's worker encoding.
    const prior = client.instanceEncoding();
    await f.source.transact([{ $tag: "TabSetDefinitions", definitions: { owners: [], fields: [], facets: [] } }], 0);
    const before = f.source.state();
    await expect(client.editDefinitionAndData({ ownerMutations: [] }, 1, { representations: [{ typeName: "Codeable",
      args: ["named"], instance: { typeName: "Codeable", args: ["named"], methods: {} } }], encodingRegistry: prior }))
      .rejects.toThrow("definitions changed");
    expect(f.created).toHaveLength(2);
    expect(f.source.state()).toBe(before);
    client.dispose();
  });

  test("a stale representation batch refuses before preparation or publication", async () => {
    const f = fixture();
    await f.source.ready();
    const before = f.source.state();
    const previous = f.source.snapshot();
    const client = f.client(f.source);
    await expect(client.writeDispatchInstances([{ typeName: "Labelable", args: ["data"],
      instance: { typeName: "Labelable", args: ["data"], methods: { label: "New" } } }], -1)).rejects.toThrow("changed");
    expect(f.created).toHaveLength(1);
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot()).toBe(previous);
    client.dispose();
  });

  test("failed representation preparation retains the complete prior batch and snapshot", async () => {
    const f = fixture();
    await f.source.ready();
    const before = f.source.state();
    const previous = f.source.snapshot();
    const client = f.client(f.source);
    f.preparationFailure(new Error("Batch refused"));
    await expect(client.writeDispatchInstances(["Labelable", "Describable"].map(typeName => ({ typeName, args: ["data"],
      instance: { typeName, args: ["data"], methods: {} } })), 0)).rejects.toThrow("Batch refused");
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot()).toBe(previous);
    expect(f.source.revision()).toBe(0);
    // The rebuild retired the published worker first; its restoration was
    // refused too, so the prior snapshot stays published without a worker.
    expect(f.discarded).toEqual([previous.registry]);
    client.dispose();
  });

  test("a new revision cannot admit a representation encoded by a replaced registry", async () => {
    const f = fixture();
    await f.source.ready();
    const prior = f.source.snapshot().registry;
    await f.source.transact([{ $tag: "TabSetDefinitions", definitions: { owners: [], fields: [], facets: [] } }], 0);
    const before = f.source.state();
    const current = f.source.snapshot();
    const client = f.client(f.source);
    await expect(client.writeDispatchInstances([{ typeName: "Labelable", args: ["data"],
      instance: { typeName: "Labelable", args: ["data"], methods: {} } }], 1, prior)).rejects.toThrow("definitions changed");
    expect(f.created).toHaveLength(2);
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot()).toBe(current);
    client.dispose();
  });

  test("saved-data egress delegates Maybe decoding after local readiness and retains the null wire", async () => {
    const f = fixture();
    await f.source.ready();
    const client = f.client(f.source);
    const row = { id: "data", query: { kind: "expression", expr: { kind: "literal", value: false } } };
    f.decodedMaybe(row);
    expect(await client.api.savedQueryUpdate("data", { name: "Data" })).toEqual({ query: row });
    expect(f.maybeInputs).toEqual([{ $tag: "Just", _0: row }]);
    f.decodedMaybe(undefined);
    expect(await client.api.savedQueryUpdate("data", { name: "Data" })).toEqual({ query: null });
    client.dispose();
  });

  test("closing a local reader during the lazy Maybe decoder load refuses its response", async () => {
    const f = fixture();
    await f.source.ready();
    const client = f.client(f.source);
    f.afterFoundationImport(() => client.dispose());
    await expect(client.api.savedQueryUpdate("data", { name: "Data" })).rejects.toThrow("closed");
    expect(f.maybeInputs).toEqual([]);
    expect(f.source.revision()).toBe(1);
  });

  test("failed final definition preparation preserves prior state, snapshot, revision and retained data", async () => {
    const f = fixture();
    await f.source.ready();
    const instance = { typeName: "Labelable", args: ["local-data"], methods: { label: "Existing label" } };
    await f.source.transact([{ $tag: "TabEditRepresentations", commands: [{ entry: { id: "label",
      value: { id: "label", instance } } }] }], 0);
    const before = f.source.state();
    const published = f.source.snapshot();
    const createdBefore = f.created.length;
    const proposal = { owners: [{ ownerKey: "function:planned", kind: "function", storageName: "planned",
      definition: { id: "planned", params: [], returns: { $ref: "String" }, body: "unpublished" } }], fields: [], facets: [] };
    f.plannedDefinitions(proposal);
    f.preparationFailure(new Error("Definition validation failed"));
    await expect(f.source.saveDefinitions({})).rejects.toThrow("Definition validation failed");
    expect(f.preparedInputs.find(input => input.definitions === proposal)).toEqual({ definitions: proposal, representations: [instance] });
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot()).toBe(published);
    expect(f.source.revision()).toBe(before.revision);
    expect(f.created).toHaveLength(createdBefore);
    // Retired at rebuild start; the refused restoration kept the prior snapshot.
    expect(f.discarded.at(-1)).toBe(published.registry);
    f.preparationFailure();
    f.changeSession();
    const resumed = f.nextSource();
    await resumed.ready();
    expect(resumed.state()).toEqual(before);
    expect(resumed.state().representations).toBe(before.representations);
    expect(f.preparedInputs.at(-1)?.definitions).toBe(before.definitions);
    expect(resumed.revision()).toBe(before.revision);
  });

  test("initial preparation that completes after session retirement releases its worker", async () => {
    const f = fixture();
    f.afterPreparation(f.changeSession);
    await expect(f.source.ready()).rejects.toThrow("Reader session changed");
    expect(f.discarded).toEqual([f.created[0]!.registry]);
    f.afterPreparation();
    const fresh = f.nextSource();
    expect(fresh.id).toBe(f.source.id);
    await fresh.ready();
    expect(fresh.state().revision).toBe(0);
    expect(fresh.state().values).toEqual([]);
    // readReady is the only ordinary admission; full preparation reuses it.
    expect(f.validationFrames).toEqual([
      { _authority: { epoch: 1, kind: "anonymous-projection" } },
    ]);
  });

  for (const operation of ["representations", "definitions"] as const) {
    test(`cancelled ${operation} preparation releases only its unpublished worker`, async () => {
      const f = fixture();
      await f.source.ready();
      const published = f.source.snapshot();
      const controller = new AbortController();
      f.afterPreparation(() => controller.abort(new Error("Cancelled edit")));
      const pending = operation === "representations"
        ? f.source.transact([{ $tag: "TabEditRepresentations" }], 0, controller.signal)
        : f.source.saveDefinitions({}, controller.signal);
      await expect(pending).rejects.toThrow("Cancelled edit");
      await f.source.ready();
      // The published registry stays; only its retired worker is restored.
      expect(f.source.snapshot().registry).toBe(published.registry);
      expect(f.source.state().revision).toBe(0);
      expect(f.discarded).toEqual([published.registry, f.created[1]!.registry]);
    });
  }

  test("successful replacement retires the old worker and keeps the published replacement", async () => {
    const f = fixture();
    await f.source.ready();
    await f.source.transact([{ $tag: "TabEditRepresentations" }], 0);
    expect(f.source.snapshot()).toBe(f.created[1]);
    expect(f.source.state().revision).toBe(1);
    expect(f.discarded).toEqual([f.created[0]!.registry]);
  });

  test("generic definition commands publish their checked snapshot together with the data", async () => {
    const f = fixture();
    await f.source.ready();
    const previous = f.source.snapshot();
    const identity = "00000000-0000-4000-8000-000000000001";
    const definitions = { owners: [{ ownerKey: `type:${identity}`, kind: "type", storageName: identity,
      definition: { id: identity, type: { $ref: "String" } } }], fields: [], facets: [] };
    await f.source.transact([{ $tag: "TabSetDefinitions", definitions }], 0);
    expect(f.source.state().definitions).toEqual(definitions);
    expect(f.preparedInputs.at(-1)?.definitions).toBe(f.source.state().definitions);
    expect(f.created).toHaveLength(2);
    expect(f.source.snapshot()).toBe(f.created[1]);
    expect(f.source.snapshot()).not.toBe(previous);
    expect(f.discarded).toEqual([previous.registry]);
  });

  test("a cancelled generic definition rebuild retains the old data and checked snapshot", async () => {
    const f = fixture();
    await f.source.ready();
    const before = f.source.state();
    const previous = f.source.snapshot();
    const controller = new AbortController();
    f.afterPreparation(() => controller.abort(new Error("Cancelled definition transaction")));
    await expect(f.source.transact([{ $tag: "TabSetDefinitions", definitions: { owners: [] } }], 0, controller.signal))
      .rejects.toThrow("Cancelled definition transaction");
    await f.source.ready();
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot().registry).toBe(previous.registry);
    expect(f.discarded).toEqual([previous.registry, f.created[1]!.registry]);
  });

  test("literal data and definition identities survive a session change while reader frames are rebuilt", async () => {
    const f = fixture();
    await f.source.ready();
    const value = { id: "number", value: { id: "number", query: {
      kind: "expression", expr: { kind: "literal", value: 42 }, valueType: { $ref: "Number" },
    } } };
    await f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: value }] }], 0);
    await f.source.saveDefinitions({});
    const instance = { typeName: "Labelable", args: ["number"], methods: { label: "Number" } };
    await f.source.transact([{ $tag: "TabEditRepresentations", commands: [{ entry: { id: "label", value: { id: "label", instance } } }] }], 2);
    const retained = f.source.state();
    const previous = f.source.snapshot();
    f.changeSession();
    expect(() => f.source.state()).toThrow("Reader session changed");
    expect(() => f.source.snapshot()).toThrow("Reader session changed");
    expect(() => f.source.root()).toThrow("Reader session changed");
    expect(() => f.source.metadata()).toThrow("Reader session changed");
    expect(() => f.source.ready()).toThrow("Reader session changed");
    const resumed = f.nextSource();
    expect(resumed.id).toBe(f.source.id);
    expect(resumed.revision()).toBe(3);
    await resumed.ready();
    expect(resumed.state()).toEqual(retained);
    expect(resumed.state().values).toBe(retained.values);
    expect(resumed.state().definitions).toBe(retained.definitions);
    expect(resumed.state().values).toEqual([value]);
    expect(resumed.state().revision).toBe(3);
    expect(resumed.snapshot().registry).not.toBe(previous.registry);
    expect(resumed.snapshot().session.evaluateContext._authority).not.toBe(previous.session.evaluateContext._authority);
    expect(resumed.snapshot().session.evaluateContext._authority).toEqual({ epoch: 1, kind: "anonymous" });
    expect(f.preparedInputs.at(-1)?.definitions).toBe(retained.definitions);
    expect(f.preparedInputs.at(-1)?.representations).toEqual([instance]);
    expect(f.validationFrames).toEqual([{ _authority: { epoch: 1, kind: "anonymous-projection" } }]);
    expect(f.discarded).toContain(previous.registry);
    expect(f.discarded).not.toContain(resumed.snapshot().registry);
  });

  for (const failure of ["unreadable", "missing"] as const) test(`${failure} retained-state validation refuses a reader and preserves its data for recovery`, async () => {
    const f = fixture();
    await f.source.ready();
    const value = { id: "document", value: { id: "document", query: { kind: "expression", expr: { kind: "literal", value: "Text" } } } };
    await f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: value }] }], 0);
    const retained = f.source.state();
    f.changeSession();
    f.validationFailure(failure);
    const refused = f.nextSource();
    await expect(refused.ready()).rejects.toThrow("retained data could not be checked");
    expect(f.discarded).toContain(f.created.at(-1)!.registry);
    f.changeSession();
    f.validationFailure(false);
    const recovered = f.nextSource();
    await recovered.ready();
    expect(recovered.state()).toEqual(retained);
    expect(recovered.state().values).toBe(retained.values);
    expect(recovered.state().values).toEqual([value]);
  });

  for (const operation of ["savedQueryCreate", "savedQueryUpdate", "dispatchInstanceCreate", "dispatchInstanceUpdate"] as const) {
    for (const boundary of ["dispose", "epoch"] as const) test(`${operation} refuses its old-reader response after committed ${boundary} change`, async () => {
      const f = fixture();
      await f.source.ready();
      const value = { id: "data", value: { id: "data", query: { kind: "expression", expr: { kind: "literal", value: 42 } } } };
      await f.source.transact([{ $tag: "TabEditValues", commands: [{ entry: value }] }], 0);
      const instance = { typeName: "Labelable", args: ["data"], methods: { label: "Data" } };
      await f.source.transact([{ $tag: "TabEditRepresentations", commands: [{ entry: { id: "representation",
        value: { id: "representation", typeName: "Labelable", args: ["data"], instance } } }] }], 1);
      const beforeRevision = f.source.revision();
      const client = f.client(f.source);
      f.afterCommit(boundary === "dispose" ? () => client.dispose() : f.changeSession);
      const pending = operation === "savedQueryCreate" ? client.api.savedQueryCreate({ slug: "new", query: { kind: "expression", expr: { kind: "literal", value: 43 } } })
        : operation === "savedQueryUpdate" ? client.api.savedQueryUpdate("data", { name: "Edited" })
        : operation === "dispatchInstanceCreate" ? client.api.dispatchInstanceCreate({ typeName: "Labelable", args: ["data"], instance })
        : client.api.dispatchInstanceUpdate("representation", instance);
      await expect(pending).rejects.toThrow(boundary === "dispose" ? "closed" : "Reader session changed");
      f.afterCommit();
      const current = f.nextSource();
      await current.ready();
      expect(current.id).toBe(f.source.id);
      expect(current.revision()).toBe(beforeRevision + 1);
      expect(current.state().values).toContainEqual(value);
      client.dispose();
    });
  }
});

async function settle() { for (let tick = 0; tick < 20; tick++) await new Promise(resolve => setTimeout(resolve, 0)); }

describe("Local rebuild retires the published catalogue worker first", () => {
  const definitionsFor = (name: string) => ({ owners: [{ ownerKey: `function:${name}`, kind: "function", storageName: name,
    definition: { id: name, params: [], returns: { $ref: "String" }, body: name } }], fields: [], facets: [] });
  const rebuilds = {
    saveDefinitions: (f: ReturnType<typeof fixture>) => { f.plannedDefinitions(definitionsFor("created")); return f.source.saveDefinitions({}); },
    transact: (f: ReturnType<typeof fixture>) => f.source.transact([{ $tag: "TabSetDefinitions", definitions: definitionsFor("transacted") }], 0),
    replace: (f: ReturnType<typeof fixture>) => f.source.replace({ ...f.source.state(), definitions: definitionsFor("replaced") }, 0),
  } as const;

  for (const [operation, run] of Object.entries(rebuilds)) {
    test(`${operation} terminates the old worker before requesting the replacement and publishes the new one`, async () => {
      const f = fixture();
      await f.source.ready();
      const published = f.source.snapshot();
      f.events.length = 0;
      await run(f);
      expect(f.events).toEqual([`discard:${published.registry.id}`, "prepare"]);
      expect(f.source.snapshot()).toBe(f.created.at(-1)!);
      expect(f.source.snapshot().registry).not.toBe(published.registry);
      // Publication does not retire the already-retired worker a second time.
      expect(f.discarded).toEqual([published.registry]);
    });
  }

  test("W1: a rebuild releases the published snapshot's realm for this holder's next preparations only", async () => {
    const f = fixture();
    await f.source.ready();
    const published = f.source.snapshot() as Snapshot & { worker: object };
    f.failNext(new Error("Definition validation failed"));
    await expect(f.source.transact([{ $tag: "TabSetDefinitions", definitions: definitionsFor("refused") }], 0)).rejects.toThrow("Definition validation failed");
    await f.source.ready();
    // Only the rebuild keeps the realm; the holder's lineage reaches every
    // preparation (initial, rebuild and restoration) and nothing else.
    expect(f.realmRetirements).toEqual([{ worker: published.worker, keepRealm: true }]);
    expect(f.lineages).toHaveLength(3);
    expect(f.lineages[0]).toBeDefined();
    expect(new Set(f.lineages).size).toBe(1);
    f.changeSession();
    // Closing a holder (here by session change) ends its unclaimed warm
    // realm; its published worker is
    // retired without keeping a realm.
    expect(f.closedLineages).toEqual([f.lineages[0]]);
    expect(f.realmRetirements).toHaveLength(2);
    // A later holder of the same source id has its own lineage.
    const next = f.nextSource();
    await next.ready();
    expect(f.lineages).toHaveLength(4);
    expect(f.lineages[3]).toBeDefined();
    expect(f.lineages[3]).not.toBe(f.lineages[0]);
    expect(f.realmRetirements.slice(1).every(entry => !entry.keepRealm)).toBe(true);
  });

  test("during the rebuild the old checked registry stays published without its worker", async () => {
    const f = fixture();
    await f.source.ready();
    const published = f.source.snapshot();
    const before = f.source.state();
    const release = f.holdPreparation();
    f.plannedDefinitions(definitionsFor("held"));
    const saving = f.source.saveDefinitions({});
    await settle();
    expect(f.discarded).toEqual([published.registry]);
    expect(f.source.snapshot()).toBe(published);
    expect(f.source.state()).toBe(before);
    release();
    await saving;
    expect(f.source.snapshot()).toBe(f.created.at(-1)!);
    expect(f.discarded).toEqual([published.registry]);
  });

  test("a representation edit sent during another edit's rebuild waits and decodes with the new worker (B4 unit E)", async () => {
    const f = fixture();
    await f.source.ready();
    const instance = { typeName: "Labelable", args: ["data"], methods: { label: "Data" } };
    await f.source.transact([{ $tag: "TabEditRepresentations", commands: [{ entry: { id: "representation",
      value: { id: "representation", typeName: "Labelable", args: ["data"], instance } } }] }], 0);
    const client = f.client(f.source);
    const release = f.holdPreparation();
    f.plannedDefinitions(definitionsFor("other"));
    const saving = f.source.saveDefinitions({});
    await settle();
    const renamed = { ...instance, methods: { label: "Renamed" } };
    let answered = false;
    const updating = client.api.dispatchInstanceUpdate("representation", renamed).then(value => { answered = true; return value; });
    await settle();
    expect(answered).toBe(false);
    expect(f.events.filter(event => event.startsWith("decode-reader-instances"))).toEqual([]);
    release();
    await saving;
    await updating;
    const rebuilt = f.created.at(-2)!.registry.id;
    expect(f.events.filter(event => event.startsWith("decode-reader-instances"))).toEqual([`decode-reader-instances:${rebuilt}`]);
    const stored = f.source.state().representations.find(entry => (entry as { id: string }).id === "representation") as
      { value: { instance: { methods: object } } };
    expect(stored.value.instance.methods).toEqual({ label: "Renamed" });
    client.dispose();
  });

  test("a failed rebuild restores a worker for the unchanged snapshot on the same registry", async () => {
    const f = fixture();
    await f.source.ready();
    const published = f.source.snapshot();
    const before = f.source.state();
    f.plannedDefinitions(definitionsFor("refused"));
    f.failNext(new Error("Definition validation failed"));
    await expect(f.source.saveDefinitions({})).rejects.toThrow("Definition validation failed");
    await f.source.ready();
    expect(f.events.slice(-2)).toEqual(["prepare", `prepare-worker:${published.registry.id}`]);
    expect(f.preparedInputs.at(-1)).toEqual({ definitions: before.definitions, representations: [], registry: published.registry });
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot().registry).toBe(published.registry);
    expect(f.source.snapshot()).not.toBe(published);
    expect(f.source.snapshot()).toBe(f.created.at(-1)!);
    expect(f.discarded).toEqual([published.registry]);
  });

  for (const next of ["ready", "mutation"] as const)
    test(`a failed rebuild with no surviving physical transport restores before ${next}`, async () => {
      const f = fixture();
      await f.source.ready();
      const published = f.source.snapshot(), before = f.source.state();
      f.dropTransportOnFailure();
      f.failNext(new Error("Replacement worker closed"));
      await expect(f.source.saveDefinitions({})).rejects.toThrow("Replacement worker closed");
      if (next === "ready") await f.source.ready();
      else await f.source.transact([{ $tag: "TabEditRoot", command: { kind: "remove", itemId: "inert" } }], 0);
      expect(f.unavailableBorrows()).toBe(0);
      expect(f.preparedInputs.at(-1)).toEqual({ definitions: before.definitions, representations: [], registry: published.registry });
      expect(f.source.snapshot().registry).toBe(published.registry);
      expect(f.source.snapshot()).not.toBe(published);
      expect(f.source.revision()).toBe(next === "ready" ? 0 : 1);
    });

  test("a failed worker restoration is retried by ready()", async () => {
    const f = fixture();
    await f.source.ready();
    const published = f.source.snapshot();
    f.preparationFailure(new Error("Out of memory"));
    await expect(f.source.transact([{ $tag: "TabSetDefinitions", definitions: definitionsFor("refused") }], 0)).rejects.toThrow("Out of memory");
    await expect(f.source.ready()).rejects.toThrow("Out of memory");
    expect(f.source.snapshot()).toBe(published);
    f.preparationFailure();
    await f.source.ready();
    expect(f.source.snapshot().registry).toBe(published.registry);
    expect(f.source.snapshot()).not.toBe(published);
    expect(f.source.state().revision).toBe(0);
  });

  test("a restoration overtaken by a newer published rebuild is never published", async () => {
    const f = fixture();
    await f.source.ready();
    const published = f.source.snapshot();
    f.failNext(new Error("Definition validation failed"));
    // The automatic restoration after this failure waits at its preparation
    // while a newer rebuild is queued, prepared and published first.
    const restoring = f.holdPreparation("worker");
    const failing = f.source.transact([{ $tag: "TabSetDefinitions", definitions: definitionsFor("refused") }], 0).catch((error: Error) => error);
    expect(((await failing) as Error).message).toBe("Definition validation failed");
    await settle();
    expect(f.events.at(-1)).toBe(`prepare-worker:${published.registry.id}`);
    const winning = f.source.transact([{ $tag: "TabSetDefinitions", definitions: definitionsFor("winner") }], 0);
    await settle();
    restoring();
    await winning;
    await settle();
    const winner = f.source.snapshot();
    expect(winner.registry).not.toBe(published.registry);
    expect(f.source.state().definitions).toEqual(definitionsFor("winner"));
    await f.source.ready();
    expect(f.source.snapshot()).toBe(winner);
    expect(f.discarded.filter(registry => registry === winner.registry)).toEqual([]);
    // The overtaken restoration's own worker is retired; it shares only the registry.
    const restoration = f.created.find(candidate => candidate.registry === published.registry && candidate !== published);
    expect(restoration).toBeDefined();
    expect(f.retiredWorkers).toContainEqual((restoration as Snapshot & { worker: object }).worker);
    expect(f.retiredWorkers.filter(worker => worker === (restoration as Snapshot & { worker: object }).worker)).toHaveLength(1);
  });

  // A candidate can share the published registry (a restored worker does) while
  // owning its own worker. Retirement follows the worker, never the registry.
  // Production builds such candidates only by restoration (covered above); these
  // pin the holder's rule for any preparation that reuses its registry.
  const sharedRegistrySource = (f: ReturnType<typeof fixture>, cancel?: AbortController) => {
    const registry = { id: 70 };
    const workers: object[] = [];
    const source = f.create({ id: "shared-registry", rootType: {},
      prepareSnapshot: async () => {
        const worker = { registry, build: workers.length + 1 };
        workers.push(worker);
        if (workers.length === 2) cancel?.abort(new Error("Cancelled edit"));
        return { kind: "local", registry, worker, callableLabels: [], session: { evaluateContext: { _authority: {} } } };
      },
      projectRoot: (state: State) => ({ id: state.tabId, revision: state.revision }) });
    return { source, workers };
  };

  test("an unpublished candidate sharing the published registry retires its own worker", async () => {
    const f = fixture();
    const cancel = new AbortController();
    const { source, workers } = sharedRegistrySource(f, cancel);
    await source.ready();
    const published = source.snapshot();
    await expect(source.transact([{ $tag: "TabEditRepresentations" }], 0, cancel.signal)).rejects.toThrow("Cancelled edit");
    expect(source.snapshot()).toBe(published);
    expect(f.retiredWorkers).toEqual([workers[1]!]);
    source.dispose();
  });

  test("publishing a candidate on the same registry retires the prior snapshot's worker", async () => {
    const f = fixture();
    const { source, workers } = sharedRegistrySource(f);
    await source.ready();
    await source.transact([{ $tag: "TabEditRepresentations" }], 0);
    expect((source.snapshot() as Snapshot & { worker: object }).worker).toBe(workers[1]!);
    expect(f.retiredWorkers).toEqual([workers[0]!]);
    source.dispose();
  });
});

describe("source-neutral browser holder", () => {
  const initialState = (): State => ({ tabId: "account-data", revision: 7, entries: [], values: [],
    representations: [{ id: "label", value: { id: "label", instance: { typeName: "Labelable", args: ["item"],
      methods: { label: "Saved" }, scope: { kind: "account", accountId: "account-data" } } } }],
    definitions: { owners: [], fields: [], facets: [] } });

  test("account preparation preserves the supplied frame and representation scopes", async () => {
    const f = fixture();
    const initial = initialState();
    const authority = { account: "account-data" };
    const prepared: Array<{ definitions: object; representations: object[] }> = [];
    const retired: Snapshot[] = [];
    const published: State[] = [];
    const source = f.create({ id: initial.tabId, initial, rootType: {},
      prepareSnapshot: async (definitions: object, representations: object[]) => {
        prepared.push({ definitions, representations });
        return { registry: { id: prepared.length }, session: { evaluateContext: { _authority: authority } } };
      },
      projectRoot: (state: State) => ({ id: state.tabId, referenceId: "locus:account-data", revision: state.revision, canEdit: true }),
      onPublish: (state: State) => { published.push(state); }, retireSnapshot: (snapshot: Snapshot) => { retired.push(snapshot); } });
    await source.ready();
    expect(source.snapshot().session.evaluateContext._authority).toBe(authority);
    expect(f.validationFrames).toEqual([source.snapshot().session.evaluateContext]);
    expect(prepared[0]!.representations).toEqual(initial.representations.map(entry => (entry as { value: { instance: object } }).value.instance));
    expect(f.created).toEqual([]);
    expect(source.root()).toEqual({ id: initial.tabId, referenceId: "locus:account-data", revision: 7, canEdit: true });
    const prior = source.snapshot();
    await source.transact([{ $tag: "TabSetDefinitions", definitions: { owners: ["changed"], fields: [], facets: [] } }], 7);
    expect(published).toHaveLength(2);
    expect(retired).toEqual([prior]);
    const current = source.snapshot();
    source.dispose();
    expect(retired).toEqual([prior, current]);
    expect(() => source.state()).toThrow("closed");
  });

  test("account transport stages representations without local retagging and delegates only explicit reads", async () => {
    const f = fixture();
    const initial = initialState();
    const prepared: object[][] = [];
    const source = f.create({ id: initial.tabId, initial, rootType: {},
      prepareSnapshot: async (_definitions: object, representations: object[]) => {
        prepared.push(representations);
        return { registry: { id: prepared.length }, session: { evaluateContext: { _authority: {} } } };
      }, projectRoot: (state: State) => ({ id: state.tabId, revision: state.revision }), retireSnapshot: () => {} });
    await source.ready();
    let moduleReads = 0;
    const readFallback = { apiRead: async () => { moduleReads++; return { modules: ["installed"] }; },
      getViews: async () => ({ views: ["account-view"] }), getItems: async () => ({ items: ["account-item"] }) };
    const client = f.client(source, { accountId: initial.tabId, readFallback });
    const instance = { typeName: "Labelable", args: ["item"], methods: { label: "Changed" },
      scope: { kind: "account", accountId: initial.tabId } };
    await client.api.dispatchInstanceUpdate("label", instance);
    expect(prepared.at(-1)).toEqual([instance]);
    expect((client as TestedClient & { accountId: string }).accountId).toBe(initial.tabId);
    expect(await (client as TestedClient & { apiRead(path: string): Promise<unknown> }).apiRead("/modules/installed"))
      .toEqual({ modules: ["installed"] });
    expect(moduleReads).toBe(1);
    const reader = client as TestedClient & { getViews(): Promise<unknown>; getItems(): Promise<unknown> };
    expect(await reader.getViews()).toEqual({ views: ["account-view"] });
    expect(await reader.getItems()).toEqual({ items: ["account-item"] });
    expect(() => Reflect.get(client.api, "invokeIOAction")("send", [])).toThrow("unavailable");
    client.dispose();
    expect(() => reader.getViews()).toThrow();
    expect(() => reader.getItems()).toThrow();
    source.dispose();
  });

  test("cancelled replacement retires only the candidate and preserves the previous complete snapshot", async () => {
    const f = fixture();
    const initial = initialState();
    let release!: () => void;
    let entered!: () => void;
    const preparing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const retired: Snapshot[] = [];
    let builds = 0;
    const source = f.create({ id: initial.tabId, initial, rootType: {},
      prepareSnapshot: async () => {
        const candidate = { registry: { id: ++builds }, session: { evaluateContext: { _authority: {} } } };
        if (builds === 2) { entered(); await gate; }
        return candidate;
      }, projectRoot: (state: State) => ({ id: state.tabId, revision: state.revision }),
      retireSnapshot: (snapshot: Snapshot) => { retired.push(snapshot); } });
    await source.ready();
    const before = source.state();
    const previous = source.snapshot();
    const cancellation = new AbortController();
    const replacing = source.replace({ ...initial, revision: 8, values: [{ id: "new" }] }, 7, cancellation.signal);
    await preparing;
    cancellation.abort(Error("Replacement cancelled")); release();
    await expect(replacing).rejects.toThrow("Replacement cancelled");
    expect(source.state()).toBe(before);
    expect(source.snapshot()).toBe(previous);
    expect(retired).toHaveLength(1);
    expect(retired[0]!.registry.id).toBe(2);
    source.dispose();
  });

  test("stale or different-source replacements refuse before rebuilding", async () => {
    const f = fixture();
    const initial = initialState();
    let builds = 0;
    const source = f.create({ id: initial.tabId, initial, rootType: {},
      prepareSnapshot: async () => ({ registry: { id: ++builds }, session: { evaluateContext: { _authority: {} } } }),
      projectRoot: (state: State) => ({ id: state.tabId, revision: state.revision }), retireSnapshot: () => {} });
    await source.ready();
    const before = source.state();
    await expect(source.replace(initial, 6)).rejects.toThrow("changed");
    await expect(source.replace({ ...initial, tabId: "another-account" }, 7)).rejects.toThrow("different source");
    expect(builds).toBe(1);
    expect(source.state()).toBe(before);
    source.dispose();
  });
});
