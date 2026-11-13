// IndexedDB host boundary for the ordinary browser-local data source.
// Fenel owns snapshot admission, storage version and generation conflicts.
import type { Maybe } from "@fenel/engine/type-foundation";
import type { LocalTabData } from "./local-locus-data";
import type { AuthoringStorageSettlement } from "./expression-runner/authoring-worker-transport";

export const LOCAL_BROWSER_SOURCE_ID = "fenel-browser-local";
/** The one IndexedDB location of Local data: the storage and its presence
 * probe both use exactly these. */
export const BROWSER_DATA_STORAGE = Object.freeze({ database: "fenel.local-data", version: 1, store: "sources", key: "local" });

export type BrowserDataRecord = {
  schema: string;
  generation: number;
  data: LocalTabData;
};

export type BrowserDataStorageSettlement = AuthoringStorageSettlement;
export type BrowserDataStorageCommit = {
  result: Promise<BrowserDataRecord>;
  settled: Promise<BrowserDataStorageSettlement>;
};

export type BrowserDataStorage = {
  load(signal?: AbortSignal): Promise<BrowserDataRecord | undefined>;
  commit(next: LocalTabData, expectedGeneration: number | undefined,
    signal?: AbortSignal): Promise<BrowserDataRecord>;
  beginCommit?(next: LocalTabData, expectedGeneration: number | undefined,
    notify: (outcome: BrowserDataStorageSettlement) => void, signal?: AbortSignal): BrowserDataStorageCommit;
};

/** A1/A2/B3 host acknowledgement: retain the durable outcome before releasing
 * its barrier, independently of a cancellable worker reader. Page storage's
 * transaction promise already reports definite completion or definite abort. */
export function beginBrowserDataStorageCommit(storage: BrowserDataStorage, next: LocalTabData,
  expectedGeneration: number | undefined, notify: (outcome: BrowserDataStorageSettlement) => void,
  signal?: AbortSignal): BrowserDataStorageCommit {
  if (storage.beginCommit) {
    const flight = storage.beginCommit(next, expectedGeneration, notify, signal);
    void flight.result.catch(() => {});
    return flight;
  }
  let resolve!: (outcome: BrowserDataStorageSettlement) => void;
  const settled = new Promise<BrowserDataStorageSettlement>(done => { resolve = done; });
  const acknowledge = (outcome: BrowserDataStorageSettlement) => {
    try { notify(outcome); }
    finally { resolve(outcome); }
  };
  let pending: Promise<BrowserDataRecord>;
  try { pending = storage.commit(next, expectedGeneration, signal); }
  catch (error) { pending = Promise.reject(error); }
  // Separate branches keep observer faults out of the noncommit classifier.
  const result = pending.then(record => {
    acknowledge({ status: "committed", record });
    return record;
  }, error => {
    acknowledge({ status: "not-committed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  });
  void result.catch(() => {});
  return { result, settled };
}

export type BrowserDataStorageOptions = {
  indexedDB?: IDBFactory;
  databaseName?: string;
  /** A worker already owns its execution thread; do not spawn a nested worker. */
  preparation?: "inline";
};

type StorageResult<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };

/** L4 first paint (TS exceptions ledger, "Local bootstrap in the generator"):
 * one read-only presence probe of the page's IndexedDB, before the worker reads
 * it. It neither creates the database nor its store (an absent database aborts
 * its version-change transaction) and never decodes a record. "empty" only
 * when the source key is certainly absent; any doubt answers "unknown". The
 * worker's checked load still decides what this tab's data is. */
export function browserDataPresence(options: Pick<BrowserDataStorageOptions, "indexedDB" | "databaseName"> = {}):
  Promise<"empty" | "present" | "unknown"> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) return Promise.resolve("unknown");
  return new Promise(resolve => {
    let absent = false;
    let request: IDBOpenDBRequest;
    try { request = factory.open(options.databaseName ?? BROWSER_DATA_STORAGE.database, BROWSER_DATA_STORAGE.version); }
    catch { resolve("unknown"); return; }
    request.onupgradeneeded = () => {
      // Only a database that does not exist yet (or an older version) upgrades.
      absent = true;
      try { request.transaction?.abort(); } catch { /* The open still fails. */ }
    };
    request.onblocked = () => resolve("unknown");
    request.onerror = () => resolve(absent ? "empty" : "unknown");
    request.onsuccess = () => {
      const database = request.result;
      try {
        if (absent) { resolve("unknown"); return; }
        if (!database.objectStoreNames.contains(BROWSER_DATA_STORAGE.store)) { resolve("unknown"); return; }
        const count = database.transaction(BROWSER_DATA_STORAGE.store, "readonly").objectStore(BROWSER_DATA_STORAGE.store)
          .count(BROWSER_DATA_STORAGE.key);
        count.onsuccess = () => resolve(count.result === 0 ? "empty" : "present");
        count.onerror = () => resolve("unknown");
      } catch { resolve("unknown"); }
      finally { database.close(); }
    };
  });
}

/** Construction has no browser IO. Each operation closes its own connection;
 * the browser transaction serializes the checked read and replacement write. */
export function createBrowserDataStorage(options: BrowserDataStorageOptions = {}): BrowserDataStorage {
  const open = (signal?: AbortSignal): Promise<IDBDatabase> => {
    signal?.throwIfAborted();
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error("Browser data storage is unavailable."));
    return new Promise((resolve, reject) => {
      const request = factory.open(options.databaseName ?? BROWSER_DATA_STORAGE.database, BROWSER_DATA_STORAGE.version);
      let settled = false;
      const refuse = (reason: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        reject(reason);
      };
      const cancel = () => refuse(signal?.reason ?? new DOMException("Browser data storage was cancelled.", "AbortError"));
      signal?.addEventListener("abort", cancel, { once: true });
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(BROWSER_DATA_STORAGE.store)) request.result.createObjectStore(BROWSER_DATA_STORAGE.store);
      };
      request.onerror = () => refuse(request.error ?? new Error("Could not open browser data storage."));
      request.onblocked = () => refuse(new Error("Browser data storage is blocked by another tab. Close that tab and retry."));
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        signal?.removeEventListener("abort", cancel);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  };

  const transact = async <T>(mode: IDBTransactionMode,
    admit: (stored: unknown, store: IDBObjectStore) => T, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
    const database = await open(signal);
    try {
      signal?.throwIfAborted();
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(BROWSER_DATA_STORAGE.store, mode);
        const store = transaction.objectStore(BROWSER_DATA_STORAGE.store);
        let value: T;
        let failure: unknown;
        const cleanup = () => signal?.removeEventListener("abort", cancel);
        const cancel = () => {
          failure = signal?.reason ?? new DOMException("Browser data storage was cancelled.", "AbortError");
          // A completed transaction may have its completion event still queued.
          // Its committed result must win over cancellation after that boundary.
          try { transaction.abort(); } catch { /* Completion owns the result. */ }
        };
        signal?.addEventListener("abort", cancel, { once: true });
        transaction.oncomplete = () => { cleanup(); resolve(value); };
        transaction.onabort = () => {
          cleanup();
          reject(failure ?? transaction.error ?? new Error("Browser data storage was not committed."));
        };
        transaction.onerror = () => { failure ??= transaction.error; };
        const read = store.get(BROWSER_DATA_STORAGE.key);
        read.onerror = () => { failure ??= read.error; };
        read.onsuccess = () => {
          try {
            signal?.throwIfAborted();
            // The prepared Fenel policy is synchronous: there is no await
            // between this GET and the replacement PUT in a readwrite transaction.
            value = admit(read.result, store);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
      });
    } finally {
      database.close();
    }
  };

  return {
    async load(signal) {
      signal?.throwIfAborted();
      const [{ loadWorkspaceModel }, { Just, Nothing }] = await Promise.all([
        import("./workspace-model-loader"), import("@fenel/engine/maybe-value"),
      ]);
      const model = await loadWorkspaceModel({ projected: true, preparation: options.preparation });
      signal?.throwIfAborted();
      return transact("readonly", stored => {
        const record = stored === undefined ? Nothing : Just(stored);
        const checked = model.workspaceCall<StorageResult<Maybe<LocalTabData>>>(
          "browserDataStoredState", LOCAL_BROWSER_SOURCE_ID, record);
        if (checked.$tag !== "Ok") throw new Error(checked._0);
        if (checked._0.$tag === "Nothing") return undefined;
        const envelope = stored as BrowserDataRecord;
        return { schema: envelope.schema, generation: envelope.generation, data: checked._0._0 };
      }, signal);
    },
    async commit(next, expectedGeneration, signal) {
      signal?.throwIfAborted();
      const [{ loadWorkspaceModel }, { Just, Nothing }] = await Promise.all([
        import("./workspace-model-loader"), import("@fenel/engine/maybe-value"),
      ]);
      const model = await loadWorkspaceModel({ projected: true, preparation: options.preparation });
      signal?.throwIfAborted();
      return transact("readwrite", (stored, store) => {
        const record = stored === undefined ? Nothing : Just(stored);
        const expected = expectedGeneration === undefined ? Nothing : Just(expectedGeneration);
        const checked = model.workspaceCall<StorageResult<BrowserDataRecord>>(
          "browserDataStoragePlan", LOCAL_BROWSER_SOURCE_ID, record, expected, next);
        if (checked.$tag !== "Ok") throw new Error(checked._0);
        store.put(checked._0, BROWSER_DATA_STORAGE.key);
        return checked._0;
      }, signal);
    },
  };
}
