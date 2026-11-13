// C2: exercise the production browser holder and real Fenel transitions.
// Reader/worker acquisition and durable IO are deterministic host fixtures;
// admission, Clipboard bounds, storage generation and conflicts stay Fenel.
import { afterEach, describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, invokeCallable, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { Anything, List, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { Just, Nothing } from "@fenel/engine/maybe-value";
import { assertCurrentSession, expireBrowserSession, onBrowserSessionChange, sessionEpoch } from "./browser-session";
import type { LocusSynchronization, LocusSynchronizationParticipant } from "./locus-synchronization";
import type { ApiClient } from "./api";
import type { LocusRootData } from "./locus-root-data";
import type { LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { beginBrowserDataStorageCommit, type BrowserDataRecord, type BrowserDataStorage } from "./browser-data-storage";
import type { BrowserDataSourceOptions, BrowserReaderSnapshot, LocalIngestResult, LocalReaderSnapshot, LocalTabData, LocalTabSource } from "./local-locus-data";
import { ingestTransfer } from "./data-transfer";
import { captureRegistryTransportObservation, captureRegistryTransportRoundTrip } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";
import { TransferError } from "./data-transfer/types";

// Bun's node condition resolves plain solid-js to its inert server build.
// The holder, coordinator and memo assertions share this real browser graph.
const browserSolid = await import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href);
const { createMemo, createSignal, flush, untrack } = browserSolid as typeof import("solid-js");
const sourceId = "fenel-browser-local";
// Existing registry-free source-owner harness (webhook-branches/locus-address):
// exercise these exact transitions without acquiring unrelated typed readers.
// GLOBAL_ONLY: literal fixture data; this is not a scoped-admission claim.
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [
  ["view/types.fenel", "view"], ["view/local-data.fenel", "view"], ["view/dependencies.fenel", "view"],
  ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"], ["std/native/collection-native.fenel", "std"],
]) {
  const owner = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!,
    { bootstrapParser: "typescript" });
  for (const fn of owner.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = {
  getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] },
};
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted<T>(result: { $tag: string; _0: T | string }): T {
  if (result.$tag !== "Ok") throw new Error(String(result._0));
  return result._0 as T;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const initial = () => call<LocalTabData>("tabDataWithClipboard", call("defaultTabData", sourceId, { kind: "grid" }));
const clipboardIds = (state: LocalTabData) => call<Array<{ value: { id: string } }>>("tabClipboardEntries", state).map(entry => entry.value.id);
const setLayout = (kind: "grid" | "list") => [{ $tag: "TabSetLayout", layout: { kind } }];

describe("retained list lookup returns Maybe data", () => {
  function retainedList() {
    const before = initial();
    const item = { id: "retained-list", source: { kind: "expr", expr: call("browserDataListExpression", []) }, valueType: List(Anything) };
    const state = accepted<LocalTabData>(call("applyTabDataCommands", before, before.revision,
      [{ $tag: "TabEditRoot", command: { kind: "append", item } }]));
    const root = call("tabDataRoot", state, List(Anything));
    const row = { id: item.id, name: "Retained list", active: true, view: { kind: "list", items: [] },
      referenceId: "retained-list-ref", sourceReferenceId: "retained-list-ref", rootRevision: state.revision,
      valueType: List(Anything), derivedCanvas: false };
    return call<LocalTabData>("browserDataFromRoot", { ...root, lists: [row],
      expressions: { ...root.expressions, [row.referenceId]: item.source.expr } },
      call("tabDataValues", state), [], state.definitions);
  }

  test("populated lookup and active lookup return the retained list", () => {
    const state = retainedList();
    for (const found of [call("browserDataList", state, "retained-list"), call("browserDataActiveList", state)]) {
      expect(found).toMatchObject({ $tag: "Just", _0: { id: "retained-list", name: "Retained list",
        active: true, rootRevision: state.revision, view: { kind: "list", items: [] } } });
    }
  });

  test("an absent identity and a source without retained lists return Nothing", () => {
    expect(call<Maybe<unknown>>("browserDataList", retainedList(), "missing")).toEqual(Nothing);
    expect(call<Maybe<unknown>>("browserDataList", initial(), "retained-list")).toEqual(Nothing);
    expect(call<Maybe<unknown>>("browserDataActiveList", initial())).toEqual(Nothing);
  });

  test("a removed occurrence does not survive through its old root projection", () => {
    const state = retainedList();
    const removed = { ...state, entries: state.entries.filter(entry => entry.id !== "retained-list") };
    expect(call<Maybe<unknown>>("browserDataList", removed, "retained-list")).toEqual(Nothing);
    expect(call<Maybe<unknown>>("browserDataActiveList", removed)).toEqual(Nothing);
  });
});

// Same extracted-source convention as clipboard-history.test.ts. No browser
// workers or global import mocks are needed, and production methods are tested
// without replacing their synchronization or pure transition implementation.
const holderText = await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text();
const holderCode = new Bun.Transpiler({ loader: "ts" }).transformSync(holderText.slice(
  holderText.indexOf("export function createBrowserDataSource(")))
  .replace(/^export /gm, "").replace(/\bimport\(("[^"]+")\)/g, "load($1)");
const synchronizationText = await Bun.file(new URL("./locus-synchronization.tsx", import.meta.url)).text();
const synchronizationCode = new Bun.Transpiler({ loader: "ts" }).transformSync(synchronizationText.slice(
  synchronizationText.indexOf("export function createLocusSynchronization("))).replace(/^export /gm, "");
const createLocusSynchronization = new Function("createSignal", "assertCurrentSession", "sessionEpoch",
  `${synchronizationCode}; return createLocusSynchronization;`)(createSignal, assertCurrentSession, sessionEpoch) as
  (epoch?: number) => LocusSynchronization;
const bindings = {
  captureRegistryTransportObservation, runLocalOrdinaryOperation,
  beginBrowserDataStorageCommit,
  bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => {}, discardEarlyAuthoringRealm: () => {},
  createSignal, untrack, sessionEpoch, assertCurrentSession, onBrowserSessionChange,
  planLocalDefinitionBundle: () => { throw new Error("Unexpected definition plan"); },
  load: async (name: string) => {
    if (name === "@fenel/engine") return { invokeCallable: (ref: { $ref: string }, args: unknown[]) => call(ref.$ref.slice(5), ...args) };
    if (name === "@fenel/engine/type-foundation") return { List, Anything, Ref: ($ref: string) => ({ $ref }) };
    if (name === "./workspace-model-loader") return { loadWorkspaceModel: async () => ({ workspaceCall: call,
      sourceTypeReference: (_owner: string, name: string) => ({ $ref: name }),
      allDataRootDescriptions: (root: Pick<LocusRootData, "type">): LocusTypeDescription[] => [
        { type: root.type, phrase: "Fixture list", code: "List Anything", kind: "list", kindLabel: "List" },
      ],
    }) };
    if (name === "./data-transfer") return { ingestTransfer };
    if (name === "./reader-presentation") return {
      representationsFromReaderSnapshot: () => [], createReaderPresentation: () => ({ presentation: () => undefined }),
    };
    if (name.endsWith("authoring-catalog-worker")) return { discardPreparedAuthoringWorker: () => {}, discardWarmAuthoringRealm: () => {} };
    throw new Error(`Unexpected import ${name}`);
  },
};
function sourceFactories(hostBindings: Record<string, unknown> = bindings) {
  return new Function(...Object.keys(hostBindings), `${holderCode}; return { createBrowserDataSource, createLocalApiClient };`)
  (...Object.values(hostBindings)) as {
    createBrowserDataSource: (options: BrowserDataSourceOptions) => LocalTabSource;
    createLocalApiClient: (source: LocalTabSource) => ApiClient;
  };
}
const factories = sourceFactories();

function diskFixture(data?: LocalTabData, generation = 1) {
  let raw: unknown = data ? { schema: "fenel.local-data.v1", generation, data: structuredClone(data) } : undefined;
  let loadFailure: Error | undefined;
  let commitFailure: Error | undefined;
  let beforeLoad: (() => Promise<void>) | undefined;
  let beforeCommit: (() => Promise<void>) | undefined;
  let afterCommit: (() => Promise<void>) | undefined;
  const attempts: Array<{ data: LocalTabData; generation: number | undefined }> = [];
  let loads = 0;
  const storage: BrowserDataStorage = {
    async load() {
      loads++;
      await beforeLoad?.();
      if (loadFailure) throw loadFailure;
      const checked = accepted<any>(call("browserDataStoredState", sourceId, raw === undefined ? Nothing : Just(raw)));
      if (checked.$tag === "Nothing") return undefined;
      const envelope = raw as BrowserDataRecord;
      return { schema: envelope.schema, generation: envelope.generation, data: checked._0 };
    },
    async commit(data, expectedGeneration, signal) {
      attempts.push({ data: structuredClone(data), generation: expectedGeneration });
      await beforeCommit?.();
      signal?.throwIfAborted();
      if (commitFailure) throw commitFailure;
      const record = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId,
        raw === undefined ? Nothing : Just(raw), expectedGeneration === undefined ? Nothing : Just(expectedGeneration), data));
      raw = structuredClone(record);
      // A durable transaction can acknowledge after its checked reader closes.
      await afterCommit?.();
      return record;
    },
  };
  return {
    storage, attempts, loads: () => loads, record: () => raw as BrowserDataRecord | undefined,
    replaceRaw: (next: unknown) => { raw = structuredClone(next); },
    failLoad: (next?: Error) => { loadFailure = next; },
    failCommit: (next?: Error) => { commitFailure = next; },
    holdLoad: (gate?: () => Promise<void>) => { beforeLoad = gate; },
    holdBeforeCommit: (gate?: () => Promise<void>) => { beforeCommit = gate; },
    holdAcknowledgment: (gate?: () => Promise<void>) => { afterCommit = gate; },
  };
}
type Disk = ReturnType<typeof diskFixture>;
const sources = new Set<LocalTabSource>();
afterEach(() => { for (const source of sources) source.dispose(); sources.clear(); flush(); });

function holderFixture(disk: Disk, options: {
  initial?: LocalTabData;
  initialStorage?: BrowserDataSourceOptions["initialStorage"];
  prepare?: (count: number) => Promise<void>;
  progressiveRead?: boolean;
  observePublication?: boolean;
  workspaceCall?: typeof call;
  onStored?: (record: BrowserDataRecord | undefined, data: LocalTabData) => void;
  onStorageUncertainty?: (error: string | undefined) => void;
  onPublish?: (data: LocalTabData) => void;
  beforeOrdinary?: (operation: LocalOrdinaryOperation) => Promise<void> | void;
  afterOrdinary?: (operation: LocalOrdinaryOperation, result: unknown) => Promise<void> | void;
  released?: (operation: LocalOrdinaryOperation) => void;
  /** Replaces the default account-style snapshot (B4 unit E: a Local one). */
  snapshot?: (count: number) => LocalReaderSnapshot;
} = {}) {
  const synchronization = createLocusSynchronization();
  const participants = new Map<string, LocusSynchronizationParticipant>();
  const register = synchronization.register;
  synchronization.register = (key, participant) => {
    participants.set(key, participant);
    const retire = register(key, participant);
    return () => { retire(); if (participants.get(key) === participant) participants.delete(key); };
  };
  let preparations = 0;
  const publications: LocalTabData[] = [];
  const stored: Array<{ record?: BrowserDataRecord; data: LocalTabData }> = [];
  const retired: BrowserReaderSnapshot[] = [];
  const fixtureFactories = options.workspaceCall ? sourceFactories({ ...bindings, load: async (name: string) => {
    const loaded = await bindings.load(name);
    if (name !== "./workspace-model-loader") return loaded;
    const { loadWorkspaceModel } = loaded as { loadWorkspaceModel: () => Promise<Record<string, unknown>> };
    return { loadWorkspaceModel: async () => ({ ...await loadWorkspaceModel(), workspaceCall: options.workspaceCall }) };
  } }) : factories;
  const source = fixtureFactories.createBrowserDataSource({
    id: sourceId, clipboard: true, initial: options.initial, initialStorage: options.initialStorage, progressiveRead: options.progressiveRead ?? true,
    storage: disk.storage, synchronization,
    ordinary: async (operation, guard) => {
      guard.assertCurrent();
      const captured = captureRegistryTransportRoundTrip(operation, "holder fixture ordinary");
      if (captured.kind === "unsupported") return captured;
      try {
        await options.beforeOrdinary?.(operation);
        const model = (await bindings.load("./workspace-model-loader") as any);
        const loaded = await model.loadWorkspaceModel();
        const received = structuredClone(captured.wire);
        const value = runLocalOrdinaryOperation({ ...loaded, workspaceCall: options.workspaceCall ?? call }, received);
        const reply = structuredClone({ operation: received, value });
        await options.afterOrdinary?.(operation, reply.value);
        guard.assertCurrent(); captured.assertCurrent();
        const result = captured.reattach(reply.operation, reply.value);
        return { kind: "prepared", value: result, assertCurrent: () => { guard.assertCurrent(); captured.assertCurrent(); },
          release: () => { captured.release(); options.released?.(operation); } };
      } catch (error) { captured.release(); options.released?.(operation); throw error; }
    },
    onPublish: options.observePublication === false ? undefined : data => { options.onPublish?.(data); publications.push(data); },
    onStored: (record, data) => { options.onStored?.(record, data); stored.push({ record, data }); },
    onStorageUncertainty: options.onStorageUncertainty,
    retireSnapshot: snapshot => { retired.push(snapshot); },
    planDefinitions: async current => current,
    prepareSnapshot: async () => {
      preparations++;
      await options.prepare?.(preparations);
      if (options.snapshot) return options.snapshot(preparations);
      return { registry: {}, session: { evaluateContext: {}, catalog: { functions: [{ id: "alias", targetId: `call-${preparations}`, label: `Label ${preparations}` }] } }, functions: [], types: [], functionRows: [], catalog: [] } as unknown as LocalReaderSnapshot;
    },
  });
  sources.add(source);
  flush();
  const retain = (id: string, bytes = 100) => source.retainClipboard({
    id, value: id, typeName: "String", transfer: "encoded", bytes, copiedAt: 1, source: "fenel",
  });
  return { source, synchronization, retain, publications, stored, retired,
    preparations: () => preparations,
    participant: () => participants.get(`browser-data:${sourceId}`)!,
    client: () => factories.createLocalApiClient(source),
  };
}

describe("browser-local source synchronization", () => {
  test("reentrant retirement during Discard publication retains the restored baseline in the same task", async () => {
    const disk = diskFixture(); let retireOnPublish = false; let refuseRetention = false;
    const f = holderFixture(disk, {
      onPublish() { if (retireOnPublish) f.source.dispose(); },
      onStored() { if (refuseRetention) throw new Error("Controlled baseline retention failure"); },
    });
    await f.synchronization.setEnabled(false); await f.retain("saved");
    expect(await f.synchronization.saveAll()).toBe(true);
    await f.retain("committed-after-lost-baseline"); refuseRetention = true;
    expect(await f.synchronization.saveAll()).toBe(false);
    expect(disk.record()?.generation).toBe(2);
    await f.source.ready();
    refuseRetention = false; retireOnPublish = true;
    const discarded = await f.synchronization.discardAll();
    expect({ discarded, error: f.synchronization.error() }).toEqual({ discarded: true, error: undefined });
    const restored = f.stored.at(-1)!;
    expect(restored.record?.generation).toBe(2);
    const published = f.publications.at(-1);
    if (!published) throw new Error("Discard did not publish the restored data.");
    expect(restored.data).toBe(published);
    expect(restored.data.revision).toBeGreaterThan(disk.record()!.data.revision);
    expect(() => f.source.state()).toThrow();
    expect(disk.attempts).toHaveLength(2);
  });

  for (const uncertaintyObserverThrows of [false, true]) test(`a committed Save with failed baseline retention stays pending (uncertainty observer throws=${uncertaintyObserverThrows})`, async () => {
    const disk = diskFixture(); let refuseRetention = false; let refuseRecovery = false;
    const f = holderFixture(disk, {
      onStored() { if (refuseRetention) throw new Error("Controlled baseline retention failure"); },
      onStorageUncertainty(error) {
        if (error && uncertaintyObserverThrows) throw new Error("Controlled recovery retention failure");
        if (!error && refuseRecovery) throw new Error("Controlled recovery completion failure");
      },
    });
    await f.synchronization.setEnabled(false); await f.retain("saved");
    expect(await f.synchronization.saveAll()).toBe(true);
    await f.retain("committed-without-baseline");
    const baseline = f.stored.at(-1);
    refuseRetention = true;
    expect(await f.synchronization.saveAll()).toBe(false);
    expect(disk.record()?.generation).toBe(2);
    expect(f.stored.at(-1)).toBe(baseline);
    expect(f.synchronization.pending()).toBe(1);
    expect(f.synchronization.error()).toContain("could not be retained");
    refuseRetention = false;
    expect(await f.synchronization.saveAll()).toBe(false);
    expect(disk.attempts).toHaveLength(2);
    refuseRecovery = true;
    expect(await f.synchronization.discardAll()).toBe(false);
    expect(f.synchronization.pending()).toBe(1);
    expect(f.synchronization.error()).toBe("Controlled recovery completion failure");
    expect(await f.synchronization.saveAll()).toBe(false);
    expect(disk.attempts).toHaveLength(2);
    refuseRecovery = false;
    expect(await f.synchronization.discardAll()).toBe(true);
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.record()?.generation).toBe(2);
    await f.retain("after-recovery"); expect(await f.synchronization.saveAll()).toBe(true);
    expect(disk.attempts.map(attempt => attempt.generation)).toEqual([undefined, 1, 2]);
  });

  test("fresh Local defaults to List while an existing explicit Grid remains Grid", async () => {
    expect(call<LocalTabData>("defaultLocalTabData", sourceId).layout).toEqual({ kind: "list" });
    expect(call<LocalTabData>("defaultTabData", sourceId, { kind: "grid" }).layout).toEqual({ kind: "grid" });
    const fresh = holderFixture(diskFixture(), { progressiveRead: true });
    await fresh.source.readReady();
    expect(fresh.source.state().layout).toEqual({ kind: "list" });
    const existing = holderFixture(diskFixture(initial()), { progressiveRead: true });
    await existing.source.readReady();
    expect(existing.source.state().layout).toEqual({ kind: "grid" });
  });

  test("Local retention drops epoch projections while preserving clean and dirty baseline identity", async () => {
    const raw = initial();
    raw.rootProjection = call("tabDataRoot", raw, List(Anything));
    raw.expressionValueIds = ["epoch-owned-projection"];
    raw.expressionHeads = { placeAll: "epoch-owned-head" };
    const disk = diskFixture();
    const f = holderFixture(disk, { progressiveRead: true, initial: raw });
    await f.synchronization.setEnabled(false);
    await f.source.readReady();
    const clean = f.publications.at(-1)!;
    const cleanBaseline = f.stored.at(-1)!;
    expect(clean).toBe(cleanBaseline.data);
    expect(clean).not.toHaveProperty("rootProjection");
    expect(clean).not.toHaveProperty("expressionValueIds");
    expect(clean).not.toHaveProperty("expressionHeads");
    expect(clean.definitions).toBe(raw.definitions);
    expect(clean.values).toBe(raw.values);
    expect(f.synchronization.pending()).toBe(0);
    await f.source.transact(setLayout("list"));
    const dirty = f.publications.at(-1)!;
    expect(dirty).not.toBe(cleanBaseline.data);
    expect(dirty).not.toHaveProperty("rootProjection");
    expect(clipboardIds(dirty)).toEqual(clipboardIds(raw));
    expect(f.synchronization.pending()).toBe(1);
    f.source.dispose();
    const restored = holderFixture(disk, { progressiveRead: true, initial: dirty,
      initialStorage: { record: cleanBaseline.record, lastSynced: cleanBaseline.data } });
    await restored.synchronization.setEnabled(false);
    await restored.source.readReady();
    expect(restored.source.state().layout.kind).toBe("list");
    expect(restored.source.state()).not.toHaveProperty("rootProjection");
    expect(restored.synchronization.pending()).toBe(1);
    expect(await restored.synchronization.saveAll()).toBe(true);
    expect(restored.stored.at(-1)!.data).toBe(restored.publications.at(-1)!);
    expect(restored.synchronization.pending()).toBe(0);
  });

  test("Save snapshots ordinary data before cloning reader-only projections", async () => {
    for (const cloneHostileProjection of [false, true]) {
      const seed = initial();
      const projected = call<LocalTabData>("browserDataFromRoot", call("tabDataRoot", seed, List(Anything)),
        call("tabDataValues", seed), [], seed.definitions);
      const retained = call<LocalTabData>("browserDataWithExpressionHeads", projected, { placeAll: "reader-only-head" });
      const disk = diskFixture();
      const f = holderFixture(disk, { progressiveRead: true, initial: retained });
      await f.synchronization.setEnabled(false);
      await f.source.ready();
      await f.source.transact(setLayout("list"));
      if (cloneHostileProjection) Object.assign(f.source.state().rootProjection!, { readerOnly: () => "not authored data" });
      const captured = f.source.state();
      expect(captured).toHaveProperty("rootProjection");
      expect(captured).toHaveProperty("expressionHeads");
      expect(captured).toHaveProperty("expressionValueIds");
      const ordinary = call<LocalTabData>("browserDataStorageSnapshot", captured);
      expect(await f.participant().save()).toBe(true);
      expect(disk.attempts).toHaveLength(1);
      expect(disk.attempts[0]!.data).toEqual(ordinary);
      for (const key of ["rootProjection", "expressionHeads", "expressionValueIds"]) {
        expect(disk.attempts[0]!.data).not.toHaveProperty(key);
        expect(f.stored.at(-1)!.data).not.toHaveProperty(key);
      }
      expect(disk.record()?.generation).toBe(1);
      expect(f.source.state()).toBe(captured);
      expect(f.synchronization.pending()).toBe(0);
      f.source.dispose();
    }
  });

  test("Save still refuses an uncloneable authored literal without committing", async () => {
    const seed = initial();
    seed.values = [...seed.values, { id: "uncloneable-authored", value: { id: "uncloneable-authored", slug: "uncloneable-authored",
      query: { kind: "expression", expr: { kind: "literal", value: "authored literal" } } } }];
    const disk = diskFixture();
    const f = holderFixture(disk, { progressiveRead: true, initial: seed });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.transact(setLayout("list"));
    const authored = f.source.state().values.find(entry => entry.id === "uncloneable-authored")! as unknown as
      { value: { query: { expr: { value: unknown } } } };
    authored.value.query.expr.value = () => "authored literal";
    expect(await f.participant().save()).toBe(false);
    expect(disk.attempts).toEqual([]);
    expect(disk.record()).toBeUndefined();
    expect(f.stored.filter(entry => entry.record)).toEqual([]);
    expect(f.synchronization.pending()).toBe(1);
    expect(f.synchronization.error()).toBeDefined();
  });

  test("late Save acknowledgment retains its captured baseline without postcommit projection", async () => {
    const entered = deferred(), release = deferred();
    let committed = false, lateProjectionAttempts = 0;
    const disk = diskFixture();
    const f = holderFixture(disk, { progressiveRead: true, observePublication: false,
      workspaceCall: <T>(name: string, ...args: unknown[]): T => {
        if (name === "browserDataStorageSnapshot" && committed) {
          lateProjectionAttempts++;
          throw new Error("The retired reader's projection is unavailable");
        }
        return call<T>(name, ...args);
      } });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.transact(setLayout("list"));
    const captured = f.source.state();
    const ordinary = call<LocalTabData>("browserDataStorageSnapshot", captured);
    disk.holdAcknowledgment(async () => { committed = true; entered.resolve(); await release.promise; });
    const saving = f.participant().save();
    try {
      await entered.promise;
      f.source.dispose();
    } finally { release.resolve(); }
    expect(await saving).toBe(false);
    expect(disk.record()?.generation).toBe(1);
    expect(f.stored.filter(entry => entry.record)).toHaveLength(1);
    expect(f.stored.at(-1)!.record!.generation).toBe(1);
    expect(f.stored.at(-1)!.data).toEqual(ordinary);
    expect(f.stored.at(-1)!.data.entries).toBe(captured.entries);
    expect(lateProjectionAttempts).toBe(0);
    expect(f.publications).toEqual([]);
    expect(() => f.source.state()).toThrow();
  });

  test("a Local paste retired before commit resumes automatic storage on its fresh ordinary read", async () => {
    const disk = diskFixture();
    const entered = deferred(), release = deferred();
    disk.holdBeforeCommit(async () => { entered.resolve(); await release.promise; });
    const first = holderFixture(disk, { progressiveRead: true });
    await first.source.ingestExternal({ files: [], text: "keep through login", html: "", internal: "", uriList: "" });
    await entered.promise;
    const firstSave = first.participant().save();
    const retained = first.publications.at(-1)!;
    const baseline = first.stored.at(-1)!;
    first.source.dispose();
    release.resolve();
    expect(await firstSave).toBe(false);
    expect(disk.record()).toBeUndefined();
    const resumedEntered = deferred(), resumedRelease = deferred();
    disk.holdBeforeCommit(async () => { resumedEntered.resolve(); await resumedRelease.promise; });
    const resumed = holderFixture(disk, { progressiveRead: true, initial: retained,
      initialStorage: { record: baseline.record, lastSynced: baseline.data } });
    await resumed.source.readReady();
    await resumedEntered.promise;
    const resumedSave = resumed.participant().save();
    expect(resumed.preparations()).toBe(0);
    resumedRelease.resolve();
    expect(await resumedSave).toBe(true);
    expect(disk.record()!.generation).toBe(1);
    expect(disk.record()!.data.entries.at(-1)!.value).toMatchObject({ source: { expr: { value: "keep through login" } } });
    expect(resumed.synchronization.pending()).toBe(0);
  });

  test("ordinary Local reacquisition keeps paused drafts dirty and clean data causes no automatic write", async () => {
    const baseline = initial();
    const dirty = accepted<LocalTabData>(call("applyTabDataCommands", baseline, baseline.revision, setLayout("list")));
    const disk = diskFixture(baseline, 6);
    const paused = holderFixture(disk, { progressiveRead: true, initial: dirty,
      initialStorage: { record: disk.record(), lastSynced: baseline } });
    await paused.synchronization.setEnabled(false);
    await paused.source.readReady();
    const clean = holderFixture(disk, { progressiveRead: true });
    await clean.source.readReady();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(paused.synchronization.pending()).toBe(1);
    expect(clean.synchronization.pending()).toBe(0);
    expect(disk.attempts).toEqual([]);
    expect(paused.preparations()).toBe(0);
    expect(clean.preparations()).toBe(0);
  });

  test("automatic Local storage does not wait forever for a hidden document's paused animation frame", async () => {
    const originalFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
    const originalCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
    const cancelled: number[] = [];
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 17 });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => { cancelled.push(id); } });
    try {
      const entered = deferred();
      const disk = diskFixture();
      disk.holdBeforeCommit(async () => { entered.resolve(); });
      const f = holderFixture(disk, { progressiveRead: true });
      await f.source.ingestExternal({ files: [], text: "save while hidden", html: "", internal: "", uriList: "" });
      await entered.promise;
      await f.participant().save();
      expect(disk.attempts).toHaveLength(1);
      expect(cancelled).toEqual([17]);
      expect(f.preparations()).toBe(0);
      f.source.dispose();
    } finally {
      if (originalFrame) Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame);
      else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      if (originalCancel) Object.defineProperty(globalThis, "cancelAnimationFrame", originalCancel);
      else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    }
  });

  test("a previously committed old save produces a visible CAS conflict without replacing the newer Local draft", async () => {
    const baseline = initial();
    const disk = diskFixture(baseline, 8);
    const committed = deferred(), acknowledge = deferred();
    disk.holdAcknowledgment(async () => { committed.resolve(); await acknowledge.promise; });
    const first = holderFixture(disk, { progressiveRead: true });
    await first.source.ingestExternal({ files: [], text: "committed before login", html: "", internal: "", uriList: "" });
    await committed.promise;
    const oldSave = first.participant().save();
    const saved = first.publications.at(-1)!;
    const oldBaseline = first.stored.at(-1)!;
    const newer = accepted<LocalTabData>(call("applyTabDataCommands", saved, saved.revision, setLayout("list")));
    first.source.dispose();
    const attempted = deferred(), continueAttempt = deferred();
    disk.holdBeforeCommit(async () => { attempted.resolve(); await continueAttempt.promise; });
    const fresh = holderFixture(disk, { progressiveRead: true, initial: newer,
      initialStorage: { record: oldBaseline.record, lastSynced: oldBaseline.data } });
    await fresh.source.readReady();
    await attempted.promise;
    const conflict = fresh.participant().save();
    continueAttempt.resolve();
    expect(await conflict).toBe(false);
    expect(fresh.synchronization.error()).toContain("another tab");
    expect(fresh.synchronization.pending()).toBe(1);
    expect(fresh.preparations()).toBe(0);
    acknowledge.resolve();
    expect(await oldSave).toBe(false);
    expect(first.stored.at(-1)!.record!.generation).toBe(9);
    expect(fresh.source.state()).toBe(newer);
    expect(fresh.source.state().layout.kind).toBe("list");
    expect(disk.record()!.generation).toBe(9);
    expect(disk.record()!.data.revision).toBe(saved.revision);
    expect(disk.record()!.data.layout.kind).toBe("grid");
  });

  test("external native representations use exact source owners, independent of display hints", () => {
    expect(call<Maybe<Array<{ owner: string; name: string }>>>("tabExternalTransferTypes", [
      { source: "image", value: {}, typeName: "Number" },
      { source: "file", value: {}, typeName: "Image" },
      { source: "text", value: "hello", typeName: "Image" },
      { source: "json", value: 42, typeName: "String" },
      { source: "json", value: true, typeName: "Number" },
    ])).toEqual({ $tag: "Just", _0: [
      { owner: "std", name: "Image" }, { owner: "std", name: "File" },
      { owner: "system", name: "String" }, { owner: "system", name: "Number" },
      { owner: "system", name: "Boolean" },
    ] });
    expect(call<Maybe<Array<{ owner: string; name: string }>>>("tabExternalTransferTypes", [{ source: "text", value: "hello" }, { source: "json", value: [1, 2] }]))
      .toEqual({ $tag: "Nothing" });
  });

  test("root and nested import occurrence names retain only an internal copy's actual label", async () => {
    const items = [{ source: "image", label: "image.png" }, { source: "file", label: "report.pdf" },
      { source: "text", label: "String" }, { source: "json", label: "Number" },
      { source: "fenel", label: "My photo" }, { source: "fenel" }, { source: "fenel", label: "" }];
    expect(call<Array<Maybe<string>>>("tabExternalTransferCaptions", items)).toEqual([
      Nothing, Nothing, Nothing, Nothing, Just("My photo"), Nothing, Nothing,
    ]);
    const source = await Bun.file(new URL("./data-transfer/expressions.ts", import.meta.url)).text();
    const start = source.indexOf("export function transferCaptions(");
    const end = source.indexOf("/** Ask the same authoring kernel", start);
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
    const project = new Function("invokeCallable", "TransferError", "peelMaybeValue", `${code}; return transferCaptions;`)(
      invokeCallable, TransferError, peelMaybeValue);
    const registry = { getFunction: (name: string) => functions.get(name), getUuid: () => undefined };
    expect(project(items, { registry, evaluateContext: context }))
      .toEqual([undefined, undefined, undefined, undefined, "My photo", undefined, undefined]);
  });

  test("the complete transfer bridge assigns a real browser File its exact std.File declaration", async () => {
    const bridgeSource = await Bun.file(new URL("./data-transfer/expressions.ts", import.meta.url)).text();
    const start = bridgeSource.indexOf("export function transferredType(");
    const end = bridgeSource.indexOf("/** Ask the same authoring kernel", start);
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(bridgeSource.slice(start, end)).replace(/^export /gm, "");
    const typeRows = new Map((await Bun.file(new URL("../../../../../.fenel.lock", import.meta.url)).text()).split(/\r?\n/).flatMap(line => {
      const match = /^type\/module\/([^/]+)\/([^ ]+) ; ([a-f0-9-]+)$/.exec(line);
      return match ? [[`${match[1]}/${match[2]}`, match[3]] as const] : [];
    }));
    const capturedRegistry = { getFunction: (name: string) => functions.get(name), getUuid: () => undefined,
      getTypeUuid: (owner: string, name: string) => typeRows.get(`${owner}/${name}`) };
    const forbiddenFallback = () => { throw new Error("Native source declaration fell back to display hints"); };
    const project = new Function("invokeCallable", "TransferError", "classifyData", "isRecord", "expectedTypeForName",
      `${code}; return transferredType;`)(invokeCallable, TransferError, forbiddenFallback, forbiddenFallback, forbiddenFallback);
    const [file] = await ingestTransfer({ files: [new File([new Uint8Array([1, 2, 3])], "report.bin", { type: "application/octet-stream" })],
      text: "", html: "", internal: "", uriList: "" });
    const identity = capturedRegistry.getTypeUuid("std", "File");
    expect(identity).toBeDefined();
    expect(project(file, {}, { registry: capturedRegistry, evaluateContext: context })).toEqual({ $ref: identity });
    expect(identity).not.toBe(capturedRegistry.getTypeUuid("telegram", "File"));
    expect(() => project(file, {}, { registry: { ...capturedRegistry, getTypeUuid: () => undefined },
      evaluateContext: context })).toThrow("standard type is unavailable");
  });

  test("external scalar data publishes unnamed before editing tools or durable storage", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk, { progressiveRead: true,
      prepare: async () => { throw new Error("Editing tools must stay unopened"); } });
    const saved = deferred();
    disk.holdAcknowledgment(() => saved.promise);
    let receipt: LocalIngestResult | undefined;
    const client = f.client();
    const result = await client.ingestExternal!({ files: [], text: "42", html: "", internal: "", uriList: "" }, {
      onPublished: value => { receipt = value; expect(f.source.state().revision).toBe(1); },
    });
    expect(result).toBe(receipt);
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0]).toMatchObject({ source: { kind: "expr", expr: { kind: "literal", value: 42 } }, valueType: { $ref: "Number" } });
    expect(result!.items[0]).not.toHaveProperty("caption");
    expect(result!.items[0]).not.toHaveProperty("name");
    expect(f.preparations()).toBe(0);
    expect(f.source.root().items).toHaveLength(2);
    expect(f.source.savedValues()).toHaveLength(1);
    saved.resolve();
    client.dispose();
  });

  test("external browser Files keep real metadata while their occurrence stays unnamed", async () => {
    const f = holderFixture(diskFixture(), { progressiveRead: true });
    await f.synchronization.setEnabled(false);
    const result = await f.source.ingestExternal({ files: [new File(["hello"], "report.bin", { type: "application/octet-stream" })],
      text: "", html: "", internal: "", uriList: "" });
    expect(result!.items[0]).toMatchObject({ source: { kind: "expr", expr: { kind: "literal", value: {
      name: "report.bin", mimeType: "application/octet-stream", size: 5,
    } } }, valueType: { $ref: "File" } });
    expect(result!.items[0]).not.toHaveProperty("caption");
    expect(f.preparations()).toBe(0);
  });

  test("structured JSON and copied type claims stay with the existing checked importer", async () => {
    const f = holderFixture(diskFixture(), { progressiveRead: true });
    for (const change of [
      { text: '[1,2]' }, { text: '{"width":1,"height":1,"pixels":[]}' },
      { text: "null" }, { html: "<b>hello</b>", text: "hello" },
      { internal: "untrusted" }, { savedExprId: "saved" },
    ]) {
      const result = await f.source.ingestExternal({ files: [], text: "", html: "", internal: "", uriList: "", ...change });
      expect(result).toBeUndefined();
    }
    expect(f.preparations()).toBe(0);
    expect(f.source.state().revision).toBe(0);
  });

  test("publication acknowledges before its callback retires the Local reader", async () => {
    const f = holderFixture(diskFixture(), { progressiveRead: true });
    let acknowledgments = 0;
    const result = await f.source.ingestExternal({ files: [], text: "kept", html: "", internal: "", uriList: "" }, {
      onPublished: receipt => {
        acknowledgments++;
        expect(receipt.items[0]).toMatchObject({ source: { expr: { value: "kept" } } });
        f.source.dispose();
      },
    });
    expect(acknowledgments).toBe(1);
    expect(result!.items).toHaveLength(1);
    expect(f.publications.at(-1)!.entries).toHaveLength(2);
    expect(() => f.source.root()).toThrow();
    expect(f.preparations()).toBe(0);
  });

  test("validation-only transactions do not create a durable write", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.source.ready();
    const state = f.source.state();
    await f.source.transact([], state.revision); flush();
    expect(f.source.state()).toBe(state);
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.attempts).toEqual([]);
  });

  test("hydration prepares the saved reader without a storage write or pending draft", async () => {
    const saved = initial();
    saved.layout = { kind: "list" };
    const disk = diskFixture(saved, 8);
    const f = holderFixture(disk);
    await f.source.ready(); flush();
    expect(f.source.state().layout.kind).toBe("list");
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.loads()).toBe(1);
    expect(disk.attempts).toEqual([]);
  });

  test("recreated readers retain dirty drafts and their saved baseline, then retain a clean baseline", async () => {
    const disk = diskFixture(initial(), 12);
    const first = holderFixture(disk);
    await first.synchronization.setEnabled(false);
    await first.source.ready();
    await first.source.transact(setLayout("list"));
    const draft = first.source.state();
    const baseline = first.stored.at(-1)!;
    first.source.dispose();
    const second = holderFixture(disk, { initial: draft,
      initialStorage: { record: baseline.record, lastSynced: baseline.data } });
    await second.source.ready(); flush();
    expect(second.preparations()).toBe(1);
    expect(second.source.state().layout.kind).toBe("list");
    expect(second.synchronization.pending()).toBe(1);
    expect(disk.loads()).toBe(1);
    expect(disk.attempts).toEqual([]);
    expect(await second.synchronization.saveAll()).toBe(true); flush();
    expect(disk.attempts.map(attempt => attempt.generation)).toEqual([12]);
    expect(disk.record()?.generation).toBe(13);
    const clean = second.publications.at(-1)!;
    const saved = second.stored.at(-1)!;
    second.source.dispose();
    const third = holderFixture(disk, { initial: clean,
      initialStorage: { record: saved.record, lastSynced: saved.data } });
    await third.source.ready(); flush();
    expect(third.preparations()).toBe(1);
    expect(third.source.state().layout.kind).toBe("list");
    expect(third.synchronization.pending()).toBe(0);
    expect(disk.loads()).toBe(1);
    expect(disk.attempts).toHaveLength(1);
  });

  test("paused edits stay in memory and manual Save keeps the switch paused", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.transact(setLayout("list")); flush();
    expect(f.synchronization.pending()).toBe(1);
    expect(disk.record()).toBeUndefined();
    expect(await f.synchronization.saveAll()).toBe(true); flush();
    expect(f.synchronization.enabledNow()).toBe(false);
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.record()?.data.layout.kind).toBe("list");
  });

  test("closing one local API reader keeps its source registered for Save", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    const closed = f.client(), active = f.client();
    closed.dispose();
    await f.source.transact(setLayout("list"));
    expect(await f.synchronization.saveAll()).toBe(true);
    expect((await active.getLocusRoot()).root.layout.kind).toBe("list");
    expect(disk.attempts).toHaveLength(1);
    active.dispose();
  });

  test("copy before ready saves without preparing a reader, and opening remains clean", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.retain("early"); flush();
    expect(f.preparations()).toBe(0);
    expect(disk.attempts).toHaveLength(1);
    expect(f.synchronization.pending()).toBe(0);
    await f.source.ready(); flush();
    expect(clipboardIds(f.source.state())).toEqual(["early"]);
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.attempts).toHaveLength(1);
  });

  test("copy and reader preparation share one load and publish the racing copy", async () => {
    const loadEntered = deferred(), loadRelease = deferred();
    const readerEntered = deferred(), readerRelease = deferred();
    const disk = diskFixture(initial(), 4);
    disk.holdLoad(async () => { loadEntered.resolve(); await loadRelease.promise; });
    const f = holderFixture(disk, { prepare: async () => { readerEntered.resolve(); await readerRelease.promise; } });
    await f.synchronization.setEnabled(false);
    const ready = f.source.ready();
    await loadEntered.promise;
    const copied = f.retain("during-load");
    loadRelease.resolve();
    await readerEntered.promise;
    await copied;
    const draft = f.source.state();
    readerRelease.resolve(); await ready; flush();
    expect(disk.loads()).toBe(1);
    expect(f.source.state()).toBe(draft);
    expect(clipboardIds(draft)).toEqual(["during-load"]);
    expect(f.synchronization.pending()).toBe(1);
    expect(disk.attempts).toEqual([]);
  });

  test("automatic Save failure accepts the checked edit and retains its error", async () => {
    const disk = diskFixture();
    disk.failCommit(new Error("Storage quota exceeded"));
    const f = holderFixture(disk);
    await f.source.transact(setLayout("list")); flush();
    expect(f.source.state().layout.kind).toBe("list");
    expect(f.synchronization.pending()).toBe(1);
    expect(f.synchronization.error()).toBe("Storage quota exceeded");
    expect(disk.record()).toBeUndefined();
    disk.failCommit();
    expect(await f.synchronization.saveAll()).toBe(true); flush();
    expect(f.synchronization.pending()).toBe(0);
    expect(f.synchronization.error()).toBeUndefined();
  });

  test("an edit during a held source Save remains pending until the next source Save", async () => {
    const entered = deferred(), release = deferred();
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.transact(setLayout("list"));
    disk.holdAcknowledgment(async () => { entered.resolve(); await release.promise; });
    const firstSave = f.participant().save();
    await entered.promise;
    await f.source.transact(setLayout("grid"));
    release.resolve();
    expect(await firstSave).toBe(true); flush();
    expect(disk.record()?.data.layout.kind).toBe("list");
    expect(f.synchronization.pending()).toBe(1);
    disk.holdAcknowledgment();
    expect(await f.participant().save()).toBe(true); flush();
    expect(disk.record()?.data.layout.kind).toBe("grid");
    expect(disk.attempts.map(attempt => attempt.generation)).toEqual([undefined, 1]);
    expect(f.synchronization.pending()).toBe(0);
  });

  test("pausing while automatic Save waits for queued preparation protects newer paused edits", async () => {
    const entered = deferred(), release = deferred();
    const disk = diskFixture();
    const f = holderFixture(disk, { prepare: async count => { if (count === 2) { entered.resolve(); await release.promise; } } });
    await f.source.ready();
    const first = f.source.transact(setLayout("list"));
    const definitions = f.source.saveDefinitions({} as Parameters<LocalTabSource["saveDefinitions"]>[0]);
    await entered.promise;
    await f.synchronization.setEnabled(false);
    const pausedEdit = f.source.transact(setLayout("grid"));
    release.resolve();
    await Promise.all([first, definitions, pausedEdit]); flush();
    expect(f.source.state().layout.kind).toBe("grid");
    expect(f.synchronization.pending()).toBe(1);
    expect(disk.attempts).toEqual([]);
    expect(await f.synchronization.saveAll()).toBe(true);
    expect(disk.record()?.data.layout.kind).toBe("grid");
  });

  test("durable generation advances once per Save independently of edit revisions", async () => {
    const disk = diskFixture(initial(), 20);
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.transact(setLayout("list"));
    await f.source.transact(setLayout("grid"));
    await f.source.transact(setLayout("list"));
    expect(f.source.revision()).toBe(3);
    expect(await f.synchronization.saveAll()).toBe(true);
    expect(disk.record()?.generation).toBe(21);
    expect(disk.record()?.data.revision).toBe(3);
  });

  test("cross-tab conflict Discard restores latest data, invalidates stale edits and recovers Save", async () => {
    const disk = diskFixture(initial(), 1);
    const first = holderFixture(disk), second = holderFixture(disk);
    await first.synchronization.setEnabled(false);
    await second.synchronization.setEnabled(false);
    await Promise.all([first.source.ready(), second.source.ready()]);
    await first.source.transact(setLayout("list"));
    await second.source.transact(setLayout("grid"));
    const staleRevision = second.source.revision();
    expect(first.source.revision()).toBe(staleRevision);
    const layout = createMemo(() => second.source.state().layout.kind);
    expect(layout()).toBe("grid");
    expect(await first.synchronization.saveAll()).toBe(true);
    expect(await second.synchronization.saveAll()).toBe(false); flush();
    expect(second.synchronization.error()).toContain("another tab");
    expect(await second.synchronization.discardAll()).toBe(true); flush();
    expect(layout()).toBe("list");
    expect(second.source.revision()).toBe(staleRevision + 1);
    expect(second.synchronization.pending()).toBe(0);
    expect(disk.record()?.generation).toBe(2);
    await expect(second.source.transact(setLayout("grid"), staleRevision)).rejects.toThrow();
    await second.source.transact(setLayout("grid"));
    expect(await second.synchronization.setEnabled(true)).toBe(true); flush();
    expect(second.synchronization.pending()).toBe(0);
    expect(disk.record()?.generation).toBe(3);
    expect(disk.record()?.data.layout.kind).toBe("grid");
  });

  test("Discard of a layout-only edit restores saved data with the same checked reader", async () => {
    const disk = diskFixture(initial(), 1);
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    const reader = f.source.snapshot(), definitions = f.source.state().definitions;
    const representations = f.source.state().representations, prepared = f.preparations();
    await f.source.transact(setLayout("list")); flush();
    expect(f.synchronization.pending()).toBe(1);
    const revision = f.source.revision();
    expect(await f.synchronization.discardAll()).toBe(true); flush();
    expect(f.source.state().layout.kind).toBe("grid");
    expect(f.source.revision()).toBe(revision + 1);
    expect(f.source.state().definitions).toBe(definitions);
    expect(f.source.state().representations).toBe(representations);
    expect({ preparations: f.preparations(), sameReader: f.source.snapshot() === reader, retired: f.retired.length })
      .toEqual({ preparations: prepared, sameReader: true, retired: 0 });
    expect(f.synchronization.pending()).toBe(0);
    expect(f.synchronization.error()).toBeUndefined();
    // The kept reader still serves later edits and saves.
    await f.source.transact(setLayout("list"));
    expect(await f.synchronization.saveAll()).toBe(true);
    expect(disk.record()?.data.layout.kind).toBe("list");
  });

  test("Discard rebuilds the reader when saved definitions differ from the current ones", async () => {
    const disk = diskFixture(initial(), 1);
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    const reader = f.source.snapshot(), definitions = f.source.state().definitions, prepared = f.preparations();
    const saved = structuredClone(disk.record()!);
    const owner = { ownerKey: "function:local-double", kind: "function", storageName: "double",
      definition: { id: "local-double", params: [], returns: {} } } as unknown as LocalTabData["definitions"]["owners"][number];
    saved.data.definitions = { ...saved.data.definitions, owners: [owner] };
    disk.replaceRaw(saved);
    // Another tab saved new definitions; this tab has its own pending layout edit.
    await f.source.transact(setLayout("list"));
    expect(await f.synchronization.discardAll()).toBe(true); flush();
    expect(f.source.state().layout.kind).toBe("grid");
    expect(f.preparations()).toBe(prepared + 1);
    expect(f.source.snapshot()).not.toBe(reader);
    expect(f.source.state().definitions).not.toBe(definitions);
    expect(f.source.state().definitions.owners).toEqual([owner]);
    expect(f.synchronization.pending()).toBe(0);
  });

  test("restoration keeps only definitions and representations equal to the current ones", () => {
    const current = initial();
    const representation = { id: "rep-1", value: { id: "rep-1", typeName: "Number", args: [],
      instance: { typeName: "Number", args: [], methods: {} } } };
    const restore = (restored: LocalTabData) => accepted<LocalTabData>(call("browserDataRestoreSnapshot", current, restored));
    const equal = restore(structuredClone(current));
    expect(equal.definitions).toBe(current.definitions);
    expect(equal.representations).toBe(current.representations);
    expect(equal.revision).toBe(current.revision + 1);
    const otherDefinitions = structuredClone(current);
    otherDefinitions.definitions = { ...otherDefinitions.definitions, owners: [{ ownerKey: "function:local-double", kind: "function",
      storageName: "double", definition: { id: "local-double", params: [], returns: {} } }] } as unknown as typeof current.definitions;
    const changed = restore(otherDefinitions);
    expect(changed.definitions).not.toBe(current.definitions);
    expect(changed.definitions).toEqual(otherDefinitions.definitions);
    expect(changed.representations).toBe(current.representations);
    const otherRepresentations = structuredClone(current);
    otherRepresentations.representations = [representation] as typeof current.representations;
    const represented = restore(otherRepresentations);
    expect(represented.definitions).toBe(current.definitions);
    expect(represented.representations).not.toBe(current.representations);
    expect(represented.representations).toEqual([representation]);
  });

  test("equal-revision ordinary replacement invalidates reactive data consumers", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk, { initial: initial() });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    const layout = createMemo(() => f.source.state().layout.kind);
    expect(layout()).toBe("grid");
    const replacement = structuredClone(f.source.state());
    replacement.layout = { kind: "list" };
    await f.source.replace(replacement); flush();
    expect(f.source.revision()).toBe(0);
    expect(layout()).toBe("list");
  });

  test("Discard restores saved Clipboard exactly after draft eviction while ordinary replace refuses", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.retain("saved", 6 * 1024 * 1024);
    expect(await f.synchronization.saveAll()).toBe(true);
    const saved = structuredClone(disk.record()!.data);
    await f.retain("draft", 6 * 1024 * 1024);
    expect(clipboardIds(f.source.state())).toEqual(["draft"]);
    await expect(f.source.replace(saved)).rejects.toThrow("Clipboard");
    expect(await f.synchronization.discardAll()).toBe(true); flush();
    expect(clipboardIds(f.source.state())).toEqual(["saved"]);
    expect(f.synchronization.pending()).toBe(0);
    expect(disk.record()?.generation).toBe(1);
  });

  test("Discard recovers an unsavable current Clipboard draft without overwriting its saved copy", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    await f.synchronization.setEnabled(false);
    await f.retain("saved");
    expect(await f.synchronization.saveAll()).toBe(true);
    const saved = structuredClone(disk.record());
    // The existing copy transition admits these ordinary values; the stricter
    // durable admission refuses damaged byte accounting before any disk write.
    await f.retain("damaged-draft", -1);
    const draftRevision = f.source.revision();
    expect(clipboardIds(f.source.state())).toEqual(["saved", "damaged-draft"]);
    expect(await f.synchronization.saveAll()).toBe(false); flush();
    expect(f.synchronization.error()).toContain("damaged");
    expect(disk.record()).toEqual(saved);
    expect(await f.synchronization.discardAll()).toBe(true); flush();
    expect(clipboardIds(f.source.state())).toEqual(["saved"]);
    expect(f.source.revision()).toBe(draftRevision + 1);
    expect(f.synchronization.pending()).toBe(0);
    expect(f.synchronization.error()).toBeUndefined();
    expect(disk.record()).toEqual(saved);
  });

  test("failed or corrupt initial load never overwrites saved data with an empty source", async () => {
    for (const corrupt of [false, true]) {
      const disk = diskFixture(initial(), 7);
      if (corrupt) disk.replaceRaw({ schema: "fenel.local-data.v1", generation: 7, data: { tabId: sourceId } });
      else disk.failLoad(new Error("Storage read failed"));
      const before = structuredClone(disk.record());
      const f = holderFixture(disk);
      await expect(f.source.ready()).rejects.toThrow();
      expect(await f.participant().save()).toBe(false);
      await expect(f.retain("refused-copy")).rejects.toThrow();
      expect(disk.attempts).toEqual([]);
      expect(disk.record()).toEqual(before);
      expect(f.publications).toEqual([]);
    }
  });

  test("late durable acknowledgment retains its baseline after disposal or epoch change without reviving a reader", async () => {
    for (const changeEpoch of [false, true]) {
      const entered = deferred(), release = deferred();
      const disk = diskFixture();
      const f = holderFixture(disk);
      await f.synchronization.setEnabled(false);
      await f.source.transact(setLayout("list"));
      const publications = f.publications.length;
      disk.holdAcknowledgment(async () => { entered.resolve(); await release.promise; });
      const save = f.participant().save();
      await entered.promise;
      if (changeEpoch) expireBrowserSession(untrack(sessionEpoch));
      else f.source.dispose();
      release.resolve();
      expect(await save).toBe(false); flush();
      expect(disk.record()?.generation).toBe(1);
      expect(f.stored.filter(entry => entry.record).map(entry => entry.record!.generation)).toEqual([1]);
      expect(f.publications).toHaveLength(publications);
      expect(f.retired).toHaveLength(1);
      expect(() => f.source.state()).toThrow();
    }
  });
});

describe("progressive Local ordinary reads", () => {
  test("root and saved reads share checked data without starting full reader preparation", async () => {
    const disk = diskFixture(initial(), 7);
    const f = holderFixture(disk, { progressiveRead: true });
    const client = f.client();
    try {
      const [root, saved, rootWire, savedWire] = await Promise.all([
        client.getLocusRoot(), client.getSavedQueries(),
        client.apiRead<{ root: { id: string } }>("/locus-root"), client.apiFetch<{ queries: unknown[] }>("/saved-queries"),
      ]);
      flush();
      expect(root.root.id).toBe(sourceId);
      expect(root.root.typeDescriptions).toEqual([{ type: root.root.type, phrase: "Fixture list", code: "List Anything", kind: "list", kindLabel: "List" }]);
      expect(rootWire.root.id).toBe(sourceId);
      expect(savedWire.queries).toEqual(saved.queries);
      expect(saved.queries).toEqual(call("tabDataValues", f.source.state()));
      expect(disk.loads()).toBe(1);
      expect(f.preparations()).toBe(0);
      expect(f.synchronization.pending()).toBe(0);
      expect(disk.attempts).toEqual([]);
      expect(() => f.source.snapshot()).toThrow("editing tools are not ready");
      expect(() => f.source.project("defaultTabData", sourceId, { kind: "grid" })).toThrow("editing tools are not ready");
    } finally { client.dispose(); }
  });

  test("full handoff retains ordinary data and saved baseline while checked tools are pending", async () => {
    const entered = deferred(), release = deferred();
    const disk = diskFixture(initial(), 4);
    const f = holderFixture(disk, { progressiveRead: true, prepare: async () => { entered.resolve(); await release.promise; } });
    const client = f.client();
    try {
      await f.source.readReady();
      const ordinary = f.source.state();
      const baseline = f.stored.at(-1);
      const tools = f.source.ready();
      await entered.promise;
      expect((await client.getLocusRoot()).root.id).toBe(sourceId);
      expect((await client.getSavedQueries()).queries).toEqual(call("tabDataValues", ordinary));
      let typesResolved = false;
      const types = client.getTypes().then(value => { typesResolved = true; return value; });
      await Promise.resolve();
      expect(typesResolved).toBe(false);
      expect(f.preparations()).toBe(1);
      release.resolve();
      await tools; await types; flush();
      expect(f.source.state()).toBe(ordinary);
      expect(f.stored.at(-1)).toBe(baseline);
      expect(f.synchronization.pending()).toBe(0);
      expect(f.source.snapshot()).toBeDefined();
      expect(disk.attempts).toEqual([]);
    } finally { release.resolve(); client.dispose(); }
  });

  test("Clipboard arriving during ordinary read and full handoff keeps its draft and exact save generation", async () => {
    const loading = deferred(), releaseLoad = deferred(), preparing = deferred(), releasePreparation = deferred();
    const disk = diskFixture(initial(), 8);
    disk.holdLoad(async () => { loading.resolve(); await releaseLoad.promise; });
    const f = holderFixture(disk, { progressiveRead: true,
      prepare: async () => { preparing.resolve(); await releasePreparation.promise; } });
    await f.synchronization.setEnabled(false);
    const ordinary = f.source.readReady();
    await loading.promise;
    const firstCopy = f.retain("copy-during-read");
    releaseLoad.resolve();
    await ordinary; await firstCopy;
    const tools = f.source.ready();
    await preparing.promise;
    await f.retain("copy-during-tools");
    const copied = f.source.state();
    releasePreparation.resolve();
    await tools; flush();
    expect(f.source.state()).toBe(copied);
    expect(clipboardIds(copied)).toEqual(["copy-during-read", "copy-during-tools"]);
    expect(f.synchronization.pending()).toBe(1);
    expect(disk.loads()).toBe(1);
    expect(disk.attempts).toEqual([]);
    expect(await f.participant().save()).toBe(true); flush();
    expect(disk.attempts.map(attempt => attempt.generation)).toEqual([8]);
    expect(disk.record()?.generation).toBe(9);
    expect(clipboardIds(disk.record()!.data)).toEqual(["copy-during-read", "copy-during-tools"]);
    expect(f.synchronization.pending()).toBe(0);
  });

  test("a retained unsaved draft is not relabeled saved by either admission stage", async () => {
    const baseline = initial();
    const draft = accepted<LocalTabData>(call("applyTabDataCommands", baseline, baseline.revision, setLayout("list")));
    const disk = diskFixture(baseline, 6);
    const f = holderFixture(disk, { progressiveRead: true, initial: draft,
      initialStorage: { record: disk.record(), lastSynced: baseline } });
    await f.source.readReady(); flush();
    expect(f.source.state().layout).toEqual({ kind: "list" });
    expect(f.synchronization.pending()).toBe(1);
    await f.source.ready(); flush();
    expect(f.synchronization.pending()).toBe(1);
    expect(f.stored).toEqual([]);
    expect(disk.loads()).toBe(0);
    expect(disk.record()?.data.layout).toEqual({ kind: "grid" });
  });

  test("failed storage or wrong source identity refuses ordinary admission before tools start", async () => {
    for (const wrongIdentity of [false, true]) {
      const disk = diskFixture(initial(), 3);
      if (!wrongIdentity) disk.failLoad(new Error("Storage read failed"));
      const f = holderFixture(disk, { progressiveRead: true,
        ...(wrongIdentity ? { initial: { ...initial(), tabId: "another-source" } } : {}) });
      await expect(f.source.readReady()).rejects.toThrow();
      expect(f.preparations()).toBe(0);
      expect(f.publications).toEqual([]);
      expect(disk.attempts).toEqual([]);
    }
  });

  test("closing or changing epoch during storage read never publishes ordinary data", async () => {
    for (const changeEpoch of [false, true]) {
      const entered = deferred(), release = deferred();
      const disk = diskFixture(initial());
      disk.holdLoad(async () => { entered.resolve(); await release.promise; });
      const f = holderFixture(disk, { progressiveRead: true });
      const pending = f.source.readReady();
      const refused = pending.then(() => undefined, error => error);
      await entered.promise;
      if (changeEpoch) expireBrowserSession(untrack(sessionEpoch));
      else f.source.dispose();
      release.resolve();
      expect(await refused).toBeInstanceOf(Error);
      expect(f.preparations()).toBe(0);
      expect(f.publications).toEqual([]);
      expect(f.stored).toEqual([]);
      expect(() => f.source.root()).toThrow();
    }
  });

  test("a full preparation refusal leaves admitted ordinary data readable and retries the full gate", async () => {
    const disk = diskFixture(initial());
    const f = holderFixture(disk, { progressiveRead: true, prepare: async count => {
      if (count === 1) throw new Error("Checked tools refused");
    } });
    await f.source.readReady();
    const ordinary = f.source.state();
    await expect(f.source.ready()).rejects.toThrow("Checked tools refused");
    await f.source.readReady();
    expect(f.source.root().id).toBe(sourceId);
    expect(f.source.state()).toBe(ordinary);
    expect(() => f.source.snapshot()).toThrow("editing tools are not ready");
    await f.source.ready();
    expect(f.preparations()).toBe(2);
    expect(f.source.state()).toBe(ordinary);
    expect(disk.loads()).toBe(1);
  });

  test("default and account-style sources retain full preparation and their custom root projection", async () => {
    const entered = deferred(), release = deferred();
    const accountRoot: LocusRootData = { id: "account-root", name: "Account data", type: { $ref: "account-root-type" },
      expr: { kind: "literal", value: { __list: [] } }, revision: 0, persisted: true, canEdit: true,
      layout: { kind: "grid" }, items: [], lists: [], expressions: {}, referenceId: "account-root" };
    const source = factories.createBrowserDataSource({ id: sourceId, initial: initial(),
      rootType: accountRoot.type, projectRoot: (_state, type) => ({ ...accountRoot, type }),
      prepareSnapshot: async () => {
        entered.resolve(); await release.promise;
        return { registry: {}, session: { evaluateContext: {} }, functions: [], types: [], functionRows: [], catalog: [] } as unknown as LocalReaderSnapshot;
      } });
    sources.add(source);
    const client = factories.createLocalApiClient(source);
    try {
      let resolved = false;
      const root = client.getLocusRoot().then(value => { resolved = true; return value; });
      await entered.promise;
      expect(resolved).toBe(false);
      release.resolve();
      expect((await root).root).toEqual({ ...accountRoot, type: { $ref: "account-root-type" } });
      expect(source.snapshot()).toBeDefined();
    } finally { release.resolve(); client.dispose(); }
  });
});


describe("coordinated Local ordinary publication", () => {
  test("ordinary preferences-style borrowing does not admit storage or publish initial data", async () => {
    const disk = diskFixture();
    const f = holderFixture(disk);
    expect(await f.source.ordinary({ kind: "tabDataRootCommand", args: [{ kind: "remove", itemId: "inert" }] }))
      .toEqual({ $tag: "TabEditRoot", command: { kind: "remove", itemId: "inert" } });
    expect(disk.loads()).toBe(0);
    expect(f.preparations()).toBe(0);
    expect(f.publications).toEqual([]);
    expect(() => f.source.root()).toThrow("not ready");
    expect(() => f.source.metadataTargets()).toThrow("not ready");
  });

  test("root, saved values and metadata targets retain the exact synchronous publication cache", async () => {
    let requests = 0;
    const f = holderFixture(diskFixture(), { beforeOrdinary: () => { requests++; } });
    await f.source.ready();
    const root = f.source.root(), values = f.source.savedValues(), targets = f.source.metadataTargets();
    const count = requests;
    for (let index = 0; index < 3; index++) {
      expect(f.source.root()).toBe(root);
      expect(f.source.savedValues()).toBe(values);
      expect(f.source.metadataTargets()).toBe(targets);
    }
    expect(requests).toBe(count);
  });

  test("every reader replacement projects the candidate's exact callable identities and labels", async () => {
    const labels: unknown[] = [];
    const rosters: unknown[] = [];
    const f = holderFixture(diskFixture(), { afterOrdinary: (operation, result) => {
      if (operation.kind === "publication" && operation.args[2]?.callableLabels) {
        labels.push(operation.args[2].callableLabels);
        rosters.push((result as { dependencyRoster: unknown }).dependencyRoster);
      }
    } });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.saveDefinitions({ ownerMutations: [] });
    expect(labels).toEqual([[{ id: "call-1", label: "Label 1" }], [{ id: "call-2", label: "Label 2" }]]);
    expect(rosters.map(roster => (roster as any).callableLabels)).toEqual([
      [{ $tag: "DependencyNode", id: "call-1", label: "Label 1" }],
      [{ $tag: "DependencyNode", id: "call-2", label: "Label 2" }],
    ]);
  });

  test("a Local candidate's callable labels are its worker-published catalogue data, never its page session (B4 unit E)", async () => {
    const labels: unknown[] = [];
    const rosters: unknown[] = [];
    const page = (label: string) => new Proxy({}, { get: (_target, key) => { throw new Error(`page ${label} read: ${String(key)}`); } });
    const f = holderFixture(diskFixture(), {
      snapshot: count => ({ kind: "local", owner: Object.freeze({}), worker: Object.freeze({}), registry: page("registry"), session: page("session"),
        callableLabels: [{ id: `worker-${count}`, label: `Worker label ${count}` }], functions: [], types: [], functionRows: [], catalog: [] }) as unknown as LocalReaderSnapshot,
      afterOrdinary: (operation, result) => {
        if (operation.kind === "publication" && operation.args[2]?.callableLabels) {
          labels.push(operation.args[2].callableLabels);
          rosters.push((result as { dependencyRoster: unknown }).dependencyRoster);
        }
      } });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.saveDefinitions({ ownerMutations: [] });
    expect(labels).toEqual([[{ id: "worker-1", label: "Worker label 1" }], [{ id: "worker-2", label: "Worker label 2" }]]);
    expect(rosters.map(roster => (roster as any).callableLabels)).toEqual([
      [{ $tag: "DependencyNode", id: "worker-1", label: "Worker label 1" }],
      [{ $tag: "DependencyNode", id: "worker-2", label: "Worker label 2" }],
    ]);
  });

  test("a successful initial reader packet superseded by Clipboard is released and projected from the latest state", async () => {
    let f!: ReturnType<typeof holderFixture>;
    let copied = false, packets = 0, released = 0;
    f = holderFixture(diskFixture(), { afterOrdinary: async operation => {
      if (operation.kind !== "publication" || !operation.args[2]?.callableLabels) return;
      packets++;
      if (!copied) { copied = true; await f.retain("during-packet"); }
    }, released: operation => { if (operation.kind === "publication" && operation.args[2]?.callableLabels) released++; } });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    expect(packets).toBe(2);
    expect(released).toBe(2);
    expect(clipboardIds(f.source.state())).toEqual(["during-packet"]);
    expect(f.source.root().revision).toBe(f.source.state().revision);
    expect(f.synchronization.pending()).toBe(1);
  });

  test("a failed initial reader packet is refused once without recomputation", async () => {
    let packets = 0;
    const f = holderFixture(diskFixture(), { afterOrdinary: operation => {
      if (operation.kind === "publication" && operation.args[2]?.callableLabels) {
        packets++; throw new Error("posted packet failed");
      }
    } });
    await expect(f.source.ready()).rejects.toThrow("posted packet failed");
    expect(packets).toBe(1);
    expect(f.source.root().revision).toBe(0);
    expect(() => f.source.snapshot()).toThrow("not ready");
    expect(f.retired).toHaveLength(1);
  });

  test("transition graph guards survive awaited reader preparation and refuse deep input mutation", async () => {
    const entered = deferred(), release = deferred();
    const f = holderFixture(diskFixture(), { prepare: async count => {
      if (count === 2) { entered.resolve(); await release.promise; }
    } });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    const before = f.source.state(), previous = f.source.snapshot(), root = f.source.root();
    const pending = f.source.saveDefinitions({ ownerMutations: [] });
    void pending.catch(() => {});
    await entered.promise;
    before.layout.kind = "grid";
    release.resolve();
    await expect(pending).rejects.toThrow("transport");
    expect(f.source.state()).toBe(before);
    expect(f.source.snapshot()).toBe(previous);
    expect(f.source.root()).toBe(root);
    expect(f.source.revision()).toBe(0);
    expect(f.retired).toHaveLength(1);
  });

  test("an ordinary response cancelled while pending cannot publish or admit storage", async () => {
    const entered = deferred(), release = deferred();
    const f = holderFixture(diskFixture(), { beforeOrdinary: async () => { entered.resolve(); await release.promise; } });
    const controller = new AbortController();
    const pending = f.source.ordinary({ kind: "tabDataRootCommand", args: [{ kind: "remove", itemId: "inert" }] }, controller.signal);
    void pending.catch(() => {});
    await entered.promise;
    controller.abort(new Error("cancelled ordinary")); release.resolve();
    await expect(pending).rejects.toThrow("cancelled ordinary");
    expect(f.publications).toEqual([]);
    expect(f.preparations()).toBe(0);
  });
});


describe("Local compatibility observation and private ingress", () => {
  function withDate() {
    const seed = initial();
    const payload = { at: new Date(1234), nested: { text: "unchanged" } };
    seed.values.push({ id: "date", value: { id: "date", slug: "date",
      query: { kind: "expression", expr: { kind: "literal", value: payload } } } });
    return { seed, payload };
  }

  test("an unchanged native Date keeps its exact page compatibility identity", async () => {
    const { seed, payload } = withDate();
    const f = holderFixture(diskFixture(), { initial: seed });
    await f.synchronization.setEnabled(false);
    await f.source.ready();
    await f.source.transact(setLayout("list"));
    const row = f.source.savedValues().find(row => row.id === "date")!;
    expect((row.query.expr as { value: unknown }).value).toBe(payload);
    expect((row.query.expr as { value: typeof payload }).value.at).toBe(payload.at);
    expect(payload.at.getTime()).toBe(1234);
  });

  for (const mutation of ["date-time", "equal-date", "equal-child"] as const)
    test(`native compatibility refuses ${mutation} changes during reader preparation`, async () => {
      const entered = deferred(), release = deferred();
      const { seed, payload } = withDate();
      const f = holderFixture(diskFixture(), { initial: seed, prepare: async count => {
        if (count === 2) { entered.resolve(); await release.promise; }
      } });
      await f.synchronization.setEnabled(false);
      await f.source.ready();
      const previous = f.source.snapshot(), root = f.source.root(), count = f.publications.length;
      const pending = f.source.saveDefinitions({ ownerMutations: [] });
      void pending.catch(() => {});
      await entered.promise;
      if (mutation === "date-time") payload.at.setTime(5678);
      else if (mutation === "equal-date") payload.at = new Date(payload.at.getTime());
      else payload.nested = { ...payload.nested };
      release.resolve();
      await expect(pending).rejects.toThrow("transport");
      expect(f.source.snapshot()).toBe(previous);
      expect(f.source.root()).toBe(root);
      expect(f.publications).toHaveLength(count);
      expect(f.source.revision()).toBe(seed.revision);
    });

  test("a compatibility graph is observed before its first asynchronous boundary", async () => {
    const { seed, payload } = withDate();
    const f = holderFixture(diskFixture());
    const pending = f.source.ordinary({ kind: "validateTabData", args: [seed] });
    payload.at.setTime(0);
    await expect(pending).rejects.toThrow("transport");
    expect(f.publications).toEqual([]);
    expect(f.preparations()).toBe(0);
  });

  test("an unobservable initial graph refuses before any ordinary request or publication", async () => {
    for (const value of [new Map([["key", 1]]), () => "host callable"]) {
      const seed = initial();
      seed.values.push({ id: "unsupported", value: { id: "unsupported", slug: "unsupported",
        query: { kind: "expression", expr: { kind: "literal", value } } } });
      let requests = 0;
      const disk = diskFixture();
      const f = holderFixture(disk, { initial: seed, beforeOrdinary: () => { requests++; } });
      await f.synchronization.setEnabled(false);
      await expect(f.source.readReady()).rejects.toThrow("transport");
      expect(requests).toBe(0);
      expect(f.publications).toEqual([]);
      expect(disk.attempts).toEqual([]);
      expect(f.preparations()).toBe(0);
    }
  });

  test("native File eligibility sends an inert roster while decoding the private submitted snapshot", async () => {
    const entered = deferred(), release = deferred();
    let roster: unknown;
    const f = holderFixture(diskFixture(), { beforeOrdinary: async operation => {
      if (operation.kind === "tabExternalTransferCandidate") {
        roster = operation.args[0]; entered.resolve(); await release.promise;
      }
    } });
    await f.synchronization.setEnabled(false);
    const submitted = { files: [new File(["hello"], "original.bin", { type: "application/octet-stream" })],
      text: "", html: "", internal: "", uriList: "" };
    const pending = f.source.ingestExternal(submitted);
    await entered.promise;
    submitted.files[0] = new File(["changed"], "later.bin", { type: "text/plain" });
    submitted.text = "later";
    release.resolve();
    const result = await pending;
    expect(roster).toEqual({ files: [0], internal: "", html: "", savedExprId: undefined });
    expect(result!.items[0]).toMatchObject({ source: { kind: "expr", expr: { kind: "literal", value: {
      name: "original.bin", mimeType: "application/octet-stream", size: 5,
    } } } });
    expect(f.preparations()).toBe(0);
  });

  for (const failure of ["cancel", "posted"] as const)
    test(`File eligibility ${failure} refusal never decodes, publishes or replays`, async () => {
      const entered = deferred(), release = deferred();
      let requests = 0;
      const f = holderFixture(diskFixture(), { beforeOrdinary: async operation => {
        if (operation.kind === "tabExternalTransferCandidate") {
          requests++; entered.resolve(); await release.promise;
          if (failure === "posted") throw new Error("eligibility failed");
        }
      } });
      const controller = new AbortController();
      // Invalid image bytes would make the real decoder throw if reached.
      const pending = f.source.ingestExternal({ files: [new File(["invalid-image"], "bad.png", { type: "image/png" })],
        text: "", html: "", internal: "", uriList: "" }, { signal: controller.signal });
      void pending.catch(() => {});
      await entered.promise;
      if (failure === "cancel") controller.abort(new Error("eligibility cancelled"));
      release.resolve();
      await expect(pending).rejects.toThrow(failure === "cancel" ? "eligibility cancelled" : "eligibility failed");
      expect(requests).toBe(1);
      expect(f.publications).toEqual([]);
      expect(f.preparations()).toBe(0);
    });
});
