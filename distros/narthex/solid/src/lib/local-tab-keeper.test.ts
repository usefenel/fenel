import { captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
// C2: actual Local keeper/holder, session and synchronization owners. Only
// worker preparation and durable IO are controlled; Fenel owns data and CAS.
import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { Anything, List } from "@fenel/engine/type-foundation";
import { Just, Nothing } from "@fenel/engine/maybe-value";
import { beginBrowserDataStorageCommit, type BrowserDataRecord, type BrowserDataStorage,
  type BrowserDataStorageSettlement } from "./browser-data-storage";
import { runLocalOrdinaryOperation } from "./local-ordinary-operations";
import type { LocalTabData, LocalTabSource } from "./local-locus-data";
import type { LocusSynchronization } from "./locus-synchronization";
import { createAuthoringWorkerBrowserStorage } from "./expression-runner/authoring-worker-browser-storage";
import { closeAuthoringTransport, createAuthoringWorkerTransport } from "./expression-runner/authoring-worker-transport";
import type { AuthoringWorkerMessage, AuthoringWorkerRequest } from "./expression-runner/authoring-worker-protocol";

const solid = await import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href) as typeof import("solid-js");
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [["view/types.fenel", "view"], ["view/local-data.fenel", "view"], ["view/dependencies.fenel", "view"],
  ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"], ["std/native/collection-native.fenel", "std"]]) {
  const module = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!,
    { bootstrapParser: "typescript" });
  for (const fn of module.functions ?? []) {
    functions.set(fn.id, fn); functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
// GLOBAL_ONLY: literal test data and the existing pure source policies only.
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] } };
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted<T>(value: { $tag: string; _0: T | string }): T {
  if (value.$tag !== "Ok") throw new Error(String(value._0));
  return value._0 as T;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve(); solid.flush(); }
const transpiler = new Bun.Transpiler({ loader: "ts" });
function compiled(text: string) {
  return transpiler.transformSync(text).replace(/^import .*;\r?\n/gm, "")
    .replace(/^export\s*\{[^}]*\};?\r?\n/gm, "").replace(/^export /gm, "")
    .replace(/\bimport\(("[^"]+")\)/g, "load($1)");
}
const holderPath = process.env.FENEL_KEEPER_HOLDER_SOURCE ?? new URL("./local-locus-data.ts", import.meta.url);
const holderText = await Bun.file(holderPath).text();
console.log("Local keeper source", String(holderPath), new Bun.CryptoHasher("sha256").update(holderText).digest("hex"));
const holderCode = compiled(holderText.slice(holderText.indexOf("let tabKeeper:"),
  holderText.indexOf("/** Local endpoint transport:")));
const sessionCode = compiled(await Bun.file(new URL("./browser-session.ts", import.meta.url)).text());
const syncText = await Bun.file(new URL("./locus-synchronization.tsx", import.meta.url)).text();
const syncCode = compiled(syncText.slice(syncText.indexOf("let retained:")));
const sourceId = "fenel-browser-local";

function fixture(storageOverride?: BrowserDataStorage) {
  const session = new Function("createSignal", "flush", `${sessionCode}; return {
    sessionEpoch, assertCurrentSession, onBrowserSessionChange, expireBrowserSession };`)(solid.createSignal, solid.flush) as
    Pick<typeof import("./browser-session"), "sessionEpoch" | "assertCurrentSession" | "onBrowserSessionChange" | "expireBrowserSession">;
  const sync = new Function("createSignal", "untrack", "assertCurrentSession", "sessionEpoch",
    `${syncCode}; return locusSynchronizationForSession;`)(solid.createSignal, solid.untrack, session.assertCurrentSession, session.sessionEpoch) as
    (epoch?: number) => LocusSynchronization;
  let raw: BrowserDataRecord | undefined;
  let beforeCommit: (() => Promise<void>) | undefined;
  let afterCommit: (() => Promise<void>) | undefined;
  let preparations = 0;
  let loadFailure: Error | undefined;
  let preparationFailure: Error | undefined;
  const attempts: Array<number | undefined> = [];
  const storage: BrowserDataStorage = storageOverride ?? {
    async load(signal) {
      signal?.throwIfAborted();
      if (loadFailure) throw loadFailure;
      const checked = accepted<any>(call("browserDataStoredState", sourceId, raw ? Just(raw) : Nothing));
      return checked.$tag === "Nothing" ? undefined : { ...raw!, data: checked._0 };
    },
    async commit(data, generation, signal) {
      attempts.push(generation);
      await beforeCommit?.(); signal?.throwIfAborted();
      const record = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId,
        raw ? Just(raw) : Nothing, generation === undefined ? Nothing : Just(generation), data));
      raw = structuredClone(record);
      await afterCommit?.();
      return record;
    },
  };
  const bindings = {
    captureRegistryTransportObservation, runLocalOrdinaryOperation,
    retryEarlyAuthoringRealm: () => undefined,
    createAuthoringWorkerBrowserStorage: () => storage,
    prepareAuthoringLocalOperation: async (_transport: unknown, operation: Parameters<typeof runLocalOrdinaryOperation>[1], guard: { assertCurrent(): void }) => {
      guard.assertCurrent();
      const value = runLocalOrdinaryOperation({ workspaceCall: call, allDataRootDescriptions: () => [] } as any, operation);
      guard.assertCurrent();
      return { kind: "prepared", value, assertCurrent: guard.assertCurrent, release: () => {} };
    },
    beginBrowserDataStorageCommit,
    ...session, createSignal: solid.createSignal, untrack: solid.untrack,
    LOCAL_BROWSER_SOURCE_ID: sourceId, createBrowserDataStorage: () => storage, locusSynchronizationForSession: sync,
    bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => {}, discardEarlyAuthoringRealm: () => {},
    planLocalDefinitionBundle: () => { throw new Error("Unexpected definition plan"); },
    prepareLocalReaderSnapshot: async () => {
      preparations++;
      if (preparationFailure) throw preparationFailure;
      return { kind: "local", worker: {}, owner: {}, registry: {}, session: { catalog: { functions: [] }, evaluateContext: {} },
        functions: [], types: [], functionRows: [], catalog: [] };
    },
    load: async (name: string) => {
      if (name === "./workspace-model-loader") return { loadWorkspaceModel: async () => ({ workspaceCall: call,
        allDataRootDescriptions: () => [] }) };
      if (name === "@fenel/engine") return { invokeCallable: (ref: { $ref: string }, args: unknown[]) => call(ref.$ref.slice(5), ...args) };
      if (name === "@fenel/engine/type-foundation") return { List, Anything, Ref: ($ref: string) => ({ $ref }) };
      if (name === "./reader-source-metadata") return { readerSourceMetadataPacket: () => { throw new Error("Unexpected metadata"); } };
      if (name.endsWith("authoring-catalog-worker")) return { discardPreparedReaderWorker: () => {}, discardWarmAuthoringRealm: () => {},
        borrowLocalOrdinaryTransport: () => ({ transport: {}, assertCurrent: () => {} }),
        beginPreparedReaderWorkerReplacement: () => () => {}, preparedReaderWorkerClosed: () => false };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  const holder = new Function(...Object.keys(bindings), `${holderCode}; return { localTabDataSource, keeper: () => tabKeeper };`)
    (...Object.values(bindings)) as { localTabDataSource(): LocalTabSource;
      keeper(): { state?: LocalTabData; storage?: { record?: BrowserDataRecord; lastSynced: LocalTabData };
        storageUncertainty?: string } };
  return {
    source: holder.localTabDataSource, keeper: holder.keeper, synchronization: () => sync(), attempts,
    record: () => raw, preparations: () => preparations,
    holdBeforeCommit: (hook?: () => Promise<void>) => { beforeCommit = hook; },
    holdAcknowledgment: (hook?: () => Promise<void>) => { afterCommit = hook; },
    failLoad: (error?: Error) => { loadFailure = error; },
    failPreparation: (error?: Error) => { preparationFailure = error; },
    ownCommit(outcome: "committed" | "not-committed" | "uncertain", write = outcome === "committed") {
      const controlled = { entered: gate(), release: gate(), outcome, write };
      storage.beginCommit = (data, generation, notify, signal) => {
        attempts.push(generation);
        let rejectReader!: (reason: unknown) => void;
        const result = new Promise<BrowserDataRecord>((_resolve, reject) => { rejectReader = reject; });
        const cancel = () => rejectReader(signal?.reason ?? new Error("Reader cancelled"));
        signal?.addEventListener("abort", cancel, { once: true });
        controlled.entered.resolve();
        const settled = controlled.release.promise.then((): BrowserDataStorageSettlement => {
          signal?.removeEventListener("abort", cancel);
          let record: BrowserDataRecord | undefined;
          if (controlled.write) {
            record = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId,
              raw ? Just(raw) : Nothing, generation === undefined ? Nothing : Just(generation), data));
            raw = structuredClone(record);
          }
          const outcome: BrowserDataStorageSettlement = controlled.outcome === "committed"
            ? { status: "committed", record: record! } : { status: controlled.outcome, error: "Controlled physical failure" };
          notify(outcome);
          rejectReader(new Error("Reader result unavailable"));
          return outcome;
        });
        return { result, settled };
      };
      return { entered: controlled.entered.promise, release: controlled.release.resolve,
        restore() { delete storage.beginCommit; } };
    },
    foreignDefinitions() {
      const data = structuredClone(raw!.data);
      data.definitions = { ...data.definitions, owners: [{ ownerKey: "function:local-double", kind: "function", storageName: "double",
        definition: { id: "local-double", params: [], returns: {} } }] } as unknown as typeof data.definitions;
      raw = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId, Just(raw), Just(raw!.generation), data));
    },
    foreignWrite() {
      raw = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId, raw ? Just(raw) : Nothing,
        raw ? Just(raw.generation) : Nothing, raw!.data));
    },
    advance() { session.expireBrowserSession(solid.untrack(session.sessionEpoch)); solid.flush(); },
    close() { session.expireBrowserSession(solid.untrack(session.sessionEpoch)); solid.flush(); },
    retain(source: LocalTabSource, id: string) { return source.retainClipboard({ id, value: id, typeName: "String",
      transfer: "encoded", bytes: 10, copiedAt: 1, source: "fixture" }); },
  };
}

async function delayedSave(f: ReturnType<typeof fixture>, beforeCommit = false) {
  const source = f.source(); await f.synchronization().setEnabled(false);
  await f.retain(source, "committed");
  const entered = gate(), release = gate();
  const hold = async () => { entered.resolve(); await release.promise; };
  if (beforeCommit) f.holdBeforeCommit(hold); else f.holdAcknowledgment(hold);
  const saving = f.synchronization().saveAll(); await entered.promise;
  return { source, saving, release };
}

// Actual storage adapter and physical receipt owner; only Worker/DB execution
// is controlled. The existing Fenel policy still admits these fixture records.
function physicalStorageFixture() {
  let raw: BrowserDataRecord | undefined;
  let commit: Extract<AuthoringWorkerRequest, { method: "commit-local-storage" }> | undefined;
  let entered = gate();
  const attempts: Array<number | undefined> = [];
  const cancellations: number[] = [];
  const worker = {
    onmessage: undefined as ((event: MessageEvent<AuthoringWorkerMessage>) => void) | undefined,
    onerror: undefined as ((event: ErrorEvent) => void) | undefined,
    postMessage(message: AuthoringWorkerRequest) {
      if (message.method === "load-local-storage") queueMicrotask(() => reply({ id: message.id, ok: true,
        result: raw ? { storageRecord: structuredClone(raw) } : {} }));
      else if (message.method === "commit-local-storage") {
        commit = structuredClone(message); attempts.push(message.expectedGeneration); entered.resolve();
      } else if (message.method === "cancel") cancellations.push(message.id);
      else throw new Error(`Unexpected physical request ${message.method}`);
    },
    terminate() {},
  };
  const reply = (data: AuthoringWorkerMessage) => worker.onmessage?.({ data } as MessageEvent<AuthoringWorkerMessage>);
  let transport = createAuthoringWorkerTransport(worker as unknown as Worker, 0);
  let storage = createAuthoringWorkerBrowserStorage(transport);
  return {
    storage: {
      load: (signal?: AbortSignal) => storage.load(signal),
      commit: (data: LocalTabData, generation: number | undefined, signal?: AbortSignal) => storage.commit(data, generation, signal),
      beginCommit: (...args: Parameters<NonNullable<BrowserDataStorage["beginCommit"]>>) => storage.beginCommit!(...args),
    } satisfies BrowserDataStorage,
    attempts, cancellations,
    entered: () => entered.promise,
    acknowledge() {
      if (!commit) throw new Error("No physical commit");
      const record = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId, raw ? Just(raw) : Nothing,
        commit.expectedGeneration === undefined ? Nothing : Just(commit.expectedGeneration), commit.next));
      raw = structuredClone(record);
      reply({ id: commit.id, event: "storage-settled", outcome: { status: "committed", record } });
      commit = undefined; entered = gate();
    },
    crashAfterWrite() {
      if (!commit) throw new Error("No physical commit");
      raw = accepted<BrowserDataRecord>(call("browserDataStoragePlan", sourceId, raw ? Just(raw) : Nothing,
        commit.expectedGeneration === undefined ? Nothing : Just(commit.expectedGeneration), commit.next));
      closeAuthoringTransport(transport, "Controlled worker crash after PUT");
      commit = undefined; entered = gate();
      transport = createAuthoringWorkerTransport(worker as unknown as Worker, 0);
      storage = createAuthoringWorkerBrowserStorage(transport);
    },
    close() { closeAuthoringTransport(transport, "Fixture closed"); },
  };
}

describe("Local keeper settlement across reader epochs", () => {
  test("an uncertain first Save with absent disk recovers only through explicit Discard", async () => {
    const f = fixture(); const first = f.source();
    await f.synchronization().setEnabled(false); await f.retain(first, "never-saved");
    const baseline = f.keeper().storage;
    const commit = f.ownCommit("uncertain", false);
    const saving = f.synchronization().saveAll(); await commit.entered;
    try {
      commit.release(); expect(await saving).toBe(false);
      expect(f.record()).toBeUndefined(); expect(f.keeper().storage).toBe(baseline);
      f.advance(); const next = f.source(); await next.readReady();
      expect(await f.synchronization().saveAll()).toBe(false);
      expect(f.attempts).toEqual([undefined]);
      expect(call<any[]>("tabClipboardEntries", next.state()).map(row => row.value.id)).toEqual(["never-saved"]);
      expect(await f.synchronization().discardAll()).toBe(true);
      expect(f.record()).toBeUndefined(); expect(f.keeper().storage?.record).toBeUndefined();
      expect(f.keeper().storageUncertainty).toBeUndefined();
      expect(f.synchronization().pending()).toBe(0);
      expect(call<any[]>("tabClipboardEntries", next.state())).toEqual([]);
      commit.restore(); await f.retain(next, "after-discard");
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, undefined]); expect(f.record()?.generation).toBe(1);
    } finally { commit.release(); f.close(); }
  });

  test("the actual adapter retains a cancelled reader's late receipt before keeper acquisition", async () => {
    const physical = physicalStorageFixture(); const f = fixture(physical.storage);
    try {
      const first = f.source(); await f.synchronization().setEnabled(false); await f.retain(first, "captured");
      const saving = f.synchronization().saveAll(); await physical.entered();
      f.advance(); const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(physical.cancellations).toHaveLength(1); expect(admitted).toBe(false);
      physical.acknowledge();
      expect(f.keeper().storage?.record?.generation).toBe(1);
      expect(await saving).toBe(false); await reading;
      expect(f.synchronization().pending()).toBe(0);
      expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      expect(physical.attempts).toEqual([undefined]);
    } finally { physical.close(); f.close(); }
  });

  test("actual physical uncertainty survives epochs and explicit Discard recovers through the adapter", async () => {
    const physical = physicalStorageFixture(); const f = fixture(physical.storage);
    try {
      const first = f.source(); await f.synchronization().setEnabled(false); await f.retain(first, "uncertain");
      const saving = f.synchronization().saveAll(); await physical.entered();
      physical.crashAfterWrite(); expect(f.keeper().storageUncertainty).toBeDefined();
      expect(await saving).toBe(false);
      f.advance(); f.source(); f.advance(); const next = f.source(); await next.readReady();
      expect(await f.synchronization().saveAll()).toBe(false); expect(physical.attempts).toEqual([undefined]);
      const discarded = await f.synchronization().discardAll();
      expect({ discarded, error: f.synchronization().error() }).toEqual({ discarded: true, error: undefined });
      expect(f.keeper().storageUncertainty).toBeUndefined(); expect(f.keeper().storage?.record?.generation).toBe(1);
      await f.retain(next, "recovered");
      const recovered = f.synchronization().saveAll(); await physical.entered(); physical.acknowledge();
      expect(await recovered).toBe(true); expect(physical.attempts).toEqual([undefined, 1]);
    } finally { physical.close(); f.close(); }
  });
  test("a cancelled reader's late durable ACK retains the baseline before successor admission", async () => {
    const f = fixture(); const first = f.source();
    await f.synchronization().setEnabled(false); await f.retain(first, "captured");
    const commit = f.ownCommit("committed");
    const saving = f.synchronization().saveAll(); await commit.entered;
    try {
      await f.retain(first, "newer"); f.advance();
      const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false);
      expect(f.keeper().storage?.record).toBeUndefined();
      commit.release(); expect(await saving).toBe(false); await reading;
      expect(f.keeper().storage?.record?.generation).toBe(1);
      expect(f.keeper().state).not.toBe(f.keeper().storage?.lastSynced);
      commit.restore(); expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, 1]);
      expect(call<any[]>("tabClipboardEntries", f.record()!.data).map(row => row.value.id)).toEqual(["captured", "newer"]);
    } finally { commit.release(); f.close(); }
  });

  for (const write of [false, true]) test(`uncertainty with disk write=${write} survives unread epochs until explicit Discard`, async () => {
    const f = fixture(); const first = f.source();
    await f.synchronization().setEnabled(false); await f.retain(first, "saved");
    expect(await f.synchronization().saveAll()).toBe(true);
    await f.retain(first, "uncertain-draft");
    const baseline = f.keeper().storage;
    const commit = f.ownCommit("uncertain", write);
    const saving = f.synchronization().saveAll(); await commit.entered;
    try {
      f.advance(); const intermediate = f.source(); f.advance();
      expect(() => intermediate.state()).toThrow();
      const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false);
      commit.release(); expect(await saving).toBe(false); await reading;
      expect(f.keeper().storage).toBe(baseline);
      expect(f.keeper().storageUncertainty).toContain("could not be confirmed");
      expect(f.synchronization().pending()).toBe(1);
      await f.retain(next, "retained-after-uncertainty");
      const retained = next.state();
      expect(f.keeper().storageUncertainty).toBeDefined();
      expect(await f.synchronization().saveAll()).toBe(false);
      expect(await f.synchronization().setEnabled(true)).toBe(false);
      expect(f.attempts).toEqual([undefined, 1]);
      // A foreign generation, even with equal contents, cannot acknowledge ours.
      f.foreignWrite(); expect(await f.synchronization().saveAll()).toBe(false);
      expect(next.state()).toBe(retained); expect(f.keeper().storage).toBe(baseline);
      f.failLoad(new Error("Controlled load failure"));
      expect(await f.synchronization().discardAll()).toBe(false);
      expect(f.synchronization().error()).toBe("Controlled load failure");
      expect(f.keeper().storageUncertainty).toBeDefined(); expect(next.state()).toBe(retained);
      // Another tab saved different definitions, so restoring them needs a new
      // reader; unchanged definitions would keep the checked reader instead.
      f.foreignDefinitions();
      f.failLoad(); f.failPreparation(new Error("Controlled preparation failure"));
      expect(await f.synchronization().discardAll()).toBe(false);
      expect(f.synchronization().error()).toBe("Controlled preparation failure");
      expect(f.keeper().storageUncertainty).toBeDefined(); expect(next.state()).toBe(retained);
      f.failPreparation(); commit.restore();
      expect(await f.synchronization().discardAll()).toBe(true);
      expect(f.keeper().storageUncertainty).toBeUndefined(); expect(f.synchronization().pending()).toBe(0);
      const generation = f.record()!.generation;
      await f.retain(next, "after-discard"); expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, 1, generation]);
    } finally { commit.release(); f.close(); }
  });

  test("Discard refuses active storage and a cancelled reader's noncommit permits retry", async () => {
    const f = fixture(); const first = f.source();
    await f.synchronization().setEnabled(false); await f.retain(first, "draft");
    const commit = f.ownCommit("not-committed");
    const saving = f.synchronization().saveAll(); await commit.entered;
    try {
      expect(await f.synchronization().discardAll()).toBe(false);
      f.advance(); const next = f.source(); const reading = next.readReady();
      await tick(); expect(f.attempts).toEqual([undefined]);
      commit.release(); expect(await saving).toBe(false); await reading;
      expect(f.keeper().storageUncertainty).toBeUndefined();
      commit.restore(); expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, undefined]);
    } finally { commit.release(); f.close(); }
  });

  test("late own ACK updates the successor baseline before its next save", async () => {
    const f = fixture(); const old = await delayedSave(f);
    try {
      await f.retain(old.source, "newer-draft"); f.advance();
      const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false);
      old.release.resolve(); expect(await old.saving).toBe(false); await reading;
      expect(f.keeper().storage?.record?.generation).toBe(1);
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, 1]); expect(f.record()?.generation).toBe(2);
      expect(call<any[]>("tabClipboardEntries", f.record()!.data).map(row => row.value.id)).toEqual(["committed", "newer-draft"]);
    } finally { old.release.resolve(); f.close(); }
  });

  test("a true foreign commit still conflicts without replacing the retained draft", async () => {
    const f = fixture(); const old = await delayedSave(f);
    try {
      await f.retain(old.source, "retained-draft"); f.foreignWrite(); f.advance();
      const next = f.source(); const reading = next.readReady();
      old.release.resolve(); await old.saving; await reading;
      const draft = next.state(); expect(await f.synchronization().saveAll()).toBe(false);
      expect(f.synchronization().error()).toContain("another tab");
      expect(next.state()).toBe(draft); expect(f.record()?.generation).toBe(2);
      expect(f.attempts).toEqual([undefined, 1]);
    } finally { old.release.resolve(); f.close(); }
  });

  test("a successor opened before its own old ACK can save without a false CAS conflict", async () => {
    const f = fixture(); const old = await delayedSave(f);
    try {
      await f.retain(old.source, "still-dirty"); f.advance();
      const next = f.source(); const reading = next.readReady();
      await tick(); old.release.resolve(); await old.saving; await reading;
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.synchronization().error()).toBeUndefined();
      expect(f.attempts).toEqual([undefined, 1]); expect(f.record()?.generation).toBe(2);
    } finally { old.release.resolve(); f.close(); }
  });

  test("an unread intermediate epoch cannot drop its predecessor settlement", async () => {
    const f = fixture(); const old = await delayedSave(f);
    try {
      await f.retain(old.source, "newer-draft"); f.advance(); const intermediate = f.source();
      f.advance(); expect(() => intermediate.state()).toThrow();
      const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false);
      old.release.resolve(); await old.saving; await reading;
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, 1]); expect(f.record()?.generation).toBe(2);
    } finally { old.release.resolve(); f.close(); }
  });

  test("abort before commit retains an unsaved baseline and performs one later write", async () => {
    const f = fixture(); const old = await delayedSave(f, true);
    try {
      f.advance(); const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false); expect(f.record()).toBeUndefined();
      old.release.resolve(); expect(await old.saving).toBe(false); await reading;
      expect(f.record()).toBeUndefined(); expect(f.keeper().storage?.record).toBeUndefined();
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, undefined]); expect(f.record()?.generation).toBe(1);
    } finally { old.release.resolve(); f.close(); }
  });

  test("retiring a saving successor before acquisition settles without waiting on itself", async () => {
    const f = fixture(); const old = await delayedSave(f, true);
    try {
      f.advance(); const intermediate = f.source();
      let intermediateSettled = false;
      const intermediateSave = f.synchronization().saveAll().then(saved => { intermediateSettled = true; return saved; });
      await tick(); expect(intermediateSettled).toBe(false);
      expect(intermediate.state()).toBeUndefined(); expect(f.attempts).toEqual([undefined]);
      f.advance(); const next = f.source(); let admitted = false;
      const reading = next.readReady().then(() => { admitted = true; });
      await tick(); expect(admitted).toBe(false);
      old.release.resolve();
      expect(await old.saving).toBe(false); expect(await intermediateSave).toBe(false); await reading;
      expect(f.record()).toBeUndefined();
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.attempts).toEqual([undefined, undefined]); expect(f.record()?.generation).toBe(1);
      expect(call<any[]>("tabClipboardEntries", f.record()!.data).map(row => row.value.id)).toEqual(["committed"]);
    } finally { old.release.resolve(); f.close(); }
  }, 5000);

  test("clean and dirty keeper baselines preserve their reference relationship", async () => {
    const f = fixture();
    try {
      const first = f.source(); await f.synchronization().setEnabled(false); await f.retain(first, "saved");
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      f.advance(); const clean = f.source(); await clean.readReady();
      expect(f.synchronization().pending()).toBe(0); expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      await f.retain(clean, "dirty"); const retained = f.keeper().state;
      if (!retained) throw new Error("The dirty source did not retain its admitted data.");
      expect(retained).not.toBe(f.keeper().storage?.lastSynced);
      f.advance(); const dirty = f.source(); await dirty.readReady();
      expect(dirty.state()).toBe(retained); expect(f.synchronization().pending()).toBe(1);
      expect(f.record()?.generation).toBe(1);
    } finally { f.close(); }
  });

  test("initial reader completion keeps the clean keeper's exact ordinary baseline", async () => {
    const f = fixture();
    try {
      const first = f.source();
      await f.synchronization().setEnabled(false);
      await first.readReady();
      const retained = f.keeper().state;
      expect(retained).toBe(f.keeper().storage?.lastSynced);
      await first.ready();
      expect(f.keeper().state).toBe(retained);
      expect(f.keeper().state).toBe(f.keeper().storage?.lastSynced);
      f.advance();
      const second = f.source();
      await second.readReady();
      expect(f.synchronization().pending()).toBe(0);
      expect(f.attempts).toEqual([]);
    } finally { f.close(); }
  });

  test("a lazy successor can save inherited dirty data before any readReady call", async () => {
    const f = fixture();
    try {
      const first = f.source(); await f.synchronization().setEnabled(false); await f.retain(first, "unsaved");
      const retained = f.keeper().state!;
      f.advance(); const next = f.source();
      expect(next.state()).toBeUndefined(); expect(f.preparations()).toBe(0);
      expect(next.revision()).toBe(retained.revision);
      expect(await f.synchronization().saveAll()).toBe(true);
      expect(f.record()?.generation).toBe(1); expect(f.synchronization().pending()).toBe(0);
      expect(call<any[]>("tabClipboardEntries", f.record()!.data).map(row => row.value.id)).toEqual(["unsaved"]);
    } finally { f.close(); }
  });
});
