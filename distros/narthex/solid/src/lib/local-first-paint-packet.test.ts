// L4 first paint: the committed packet equals what the actual Local chain
// publishes for empty storage. Actual holder (local-locus-data.ts), actual
// client transport, actual worker message handler (authoring-catalog-worker-main.ts
// run, compiled with its imports bound), actual IndexedDB storage leaf and the
// real projected workspace model. Only the IndexedDB factory and the worker
// thread are controlled. Heavy (builds the projected registry): run through
// the host's heavy slot.
// As the worker entry: exact Proxy tracking before any engine module.
import "../../../../../implementations/typescript/engine/src/proxy-tracking-install";
import { describe, expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import "../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { assertProxyTrackingPrecededEngine } from "../../../../../implementations/typescript/engine/src/proxy-tracking";
import { clearEngineBodyMemoPartition } from "../../../../../implementations/typescript/engine/src/engine-body-memo";
import * as typeFoundation from "@fenel/engine/type-foundation";
import { beginBrowserDataStorageCommit, createBrowserDataStorage, type BrowserDataStorageOptions } from "./browser-data-storage";
import { assertLocalOrdinaryOperation, runLocalOrdinaryOperation } from "./local-ordinary-operations";
import { loadWorkspaceModel } from "./workspace-model-loader";
import { readLocalBootstrap } from "./local-bootstrap";
import generatedPacket from "./generated/local-bootstrap.json";
import { prepareAuthoringLocalOperation } from "./expression-runner/authoring-worker-local-ordinary";
import { createAuthoringWorkerBrowserStorage } from "./expression-runner/authoring-worker-browser-storage";
import { createAuthoringWorkerTransport } from "./expression-runner/authoring-worker-transport";
import type { LocalTabData, LocalTabSource } from "./local-locus-data";

const solid = await import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href) as typeof import("solid-js");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compiled = (text: string) => transpiler.transformSync(text).replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export\s*\{[^}]*\};?\r?\n/gm, "").replace(/^export /gm, "").replace(/\bimport\(("[^"]+")\)/g, "load($1)")
  .replace(/import\.meta/g, "workerMeta");
const holderText = await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text();
const holderCode = compiled(holderText.slice(holderText.indexOf("let tabKeeper:")));
const workerCode = compiled(await Bun.file(new URL("./expression-runner/authoring-catalog-worker-main.ts", import.meta.url)).text());
const sessionCode = compiled(await Bun.file(new URL("./browser-session.ts", import.meta.url)).text());
const syncText = await Bun.file(new URL("./locus-synchronization.tsx", import.meta.url)).text();
const syncCode = compiled(syncText.slice(syncText.indexOf("let retained:")));
const sourceId = "fenel-browser-local";

/** An IndexedDB with no database at all: every open upgrades, as a first visit. */
function emptyIndexedDB(): IDBFactory {
  const store = new Map<string, unknown>();
  return { open() {
    const request: Record<string, any> = {};
    setTimeout(() => {
      const database = {
        objectStoreNames: { contains: () => true }, createObjectStore: () => {}, close() {}, onversionchange: null,
        transaction() {
          const transaction: Record<string, any> = {};
          transaction.objectStore = () => ({
            get(key: string) {
              const read: Record<string, any> = {};
              setTimeout(() => { read.result = store.get(key); read.onsuccess?.(); setTimeout(() => transaction.oncomplete?.(), 0); }, 0);
              return read;
            },
            put(value: unknown, key: string) { store.set(key, structuredClone(value)); },
          });
          return transaction;
        },
      };
      request.result = database;
      request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  } } as unknown as IDBFactory;
}

function worker() {
  const indexedDB = emptyIndexedDB();
  const page = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage(message: unknown) { realm.post(message); }, terminate() {},
  };
  const host = { postMessage(message: unknown) { const data = structuredClone(message); setTimeout(() => page.onmessage?.({ data }), 0); } };
  const bindings = { globalThis: host, workerMeta: { env: { BASE_URL: "/" } },
    assertProxyTrackingPrecededEngine, clearEngineBodyMemoPartition, assertLocalOrdinaryOperation, runLocalOrdinaryOperation,
    loadWorkspaceModel, createBrowserDataStorage: (options: BrowserDataStorageOptions) => createBrowserDataStorage({ ...options, indexedDB }),
    coreValueSuggestions: () => { throw new Error("Unexpected typed choices"); },
  };
  const realm = new Function(...Object.keys(bindings), `${workerCode}; return { post: data => scope.onmessage({ data: structuredClone(data) }) };`)
    (...Object.values(bindings)) as { post(data: unknown): void };
  return createAuthoringWorkerTransport(page as unknown as Worker, 0);
}

function holder() {
  const session = new Function("createSignal", "flush", `${sessionCode}; return {
    sessionEpoch, assertCurrentSession, onBrowserSessionChange, expireBrowserSession };`)(solid.createSignal, solid.flush) as
    Pick<typeof import("./browser-session"), "sessionEpoch" | "assertCurrentSession" | "onBrowserSessionChange" | "expireBrowserSession">;
  const sync = new Function("createSignal", "untrack", "assertCurrentSession", "sessionEpoch",
    `${syncCode}; return locusSynchronizationForSession;`)(solid.createSignal, solid.untrack, session.assertCurrentSession, session.sessionEpoch);
  const transport = worker();
  const bindings = {
    captureRegistryTransportObservation, runLocalOrdinaryOperation, prepareAuthoringLocalOperation, createAuthoringWorkerBrowserStorage,
    beginBrowserDataStorageCommit, retryEarlyAuthoringRealm: () => undefined,
    ...session, createSignal: solid.createSignal, untrack: solid.untrack,
    LOCAL_BROWSER_SOURCE_ID: sourceId, createBrowserDataStorage: () => { throw new Error("The page opened storage"); },
    locusSynchronizationForSession: sync,
    bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => {}, discardEarlyAuthoringRealm: () => {},
    planLocalDefinitionBundle: () => { throw new Error("Unexpected definition plan"); },
    prepareLocalReaderSnapshot: () => { throw new Error("Unexpected reader preparation"); },
    load: async (name: string) => {
      // The chain under test: no first-paint packet is offered here.
      if (name === "./local-bootstrap") return { emptyLocalFirstPaint: async () => undefined };
      if (name === "@fenel/engine/type-foundation") return typeFoundation;
      if (name.endsWith("authoring-catalog-worker")) return { discardPreparedReaderWorker: () => {}, discardWarmAuthoringRealm: () => {},
        borrowLocalOrdinaryTransport: () => ({ transport, assertCurrent: () => {} }),
        beginPreparedReaderWorkerReplacement: () => () => {}, preparedReaderWorkerClosed: () => false };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  const owner = new Function(...Object.keys(bindings), `${holderCode}; return { localTabDataSource, keeper: () => tabKeeper };`)
    (...Object.values(bindings)) as { localTabDataSource(): LocalTabSource; keeper(): { state?: LocalTabData } };
  return { ...owner, close: () => session.expireBrowserSession(solid.untrack(session.sessionEpoch)) };
}

describe("the generated Local first paint", () => {
  test("equals the actual worker chain's first publication for empty storage", async () => {
    // One thread hosts both realms here: build the worker's model first, so
    // the page transport's deadline measures the chain and not this build.
    await loadWorkspaceModel({ projected: true, preparation: "inline" });
    const started = performance.now();
    const local = holder();
    try {
      const source = local.localTabDataSource();
      await source.readReady();
      console.log(`Actual Local chain published in ${Math.round(performance.now() - started)} ms`);
      const packet = readLocalBootstrap(generatedPacket, sourceId);
      const actual = { state: source.state(), root: source.root(), savedValues: source.savedValues(),
        metadataTargets: source.metadataTargets(), ordinarySnapshot: local.keeper().state };
      const expected = { state: packet.state, root: packet.root, savedValues: packet.savedValues,
        metadataTargets: packet.metadataTargets, ordinarySnapshot: packet.ordinarySnapshot };
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        if (!isDeepStrictEqual(actual[key], expected[key])) expect({ [key]: actual[key] }).toEqual({ [key]: expected[key] });
      }
      expect(isDeepStrictEqual(actual, expected)).toBe(true);
      expect(packet.representations).toEqual([]);
    } finally { local.close(); }
  }, 900_000);
});
