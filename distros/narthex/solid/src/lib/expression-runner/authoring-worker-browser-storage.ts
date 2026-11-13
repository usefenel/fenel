// Existing A1/A2/B3 storage transport. The caller owns this physical worker;
// this adapter owns no realm, registry, policy or reader lifetime.
import type { BrowserDataRecord, BrowserDataStorage, BrowserDataStorageCommit } from "../browser-data-storage";
import { isAuthoringStorageRecord, requestAuthoringStorageCommit, requestAuthoringTransport, type AuthoringWorkerTransport } from "./authoring-worker-transport";

/** Read only the closed host envelope. Fenel admission remains in the worker's
 * existing IndexedDB leaf, before it reports these ordinary record bytes. */
function readStorageRecord(result: unknown): BrowserDataRecord | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)
    || Reflect.ownKeys(result).some(key => key !== "storageRecord"))
    throw new Error("The browser data storage response could not be read.");
  if (!Object.hasOwn(result, "storageRecord")) return undefined;
  const record = (result as { storageRecord: BrowserDataRecord }).storageRecord;
  if (record === undefined) return undefined;
  if (!isAuthoringStorageRecord(record))
    throw new Error("The browser data storage record could not be read.");
  return record;
}

export function createAuthoringWorkerBrowserStorage(transport: AuthoringWorkerTransport): BrowserDataStorage {
  const beginCommit: NonNullable<BrowserDataStorage["beginCommit"]> = (next, expectedGeneration, notify, signal) => {
    const flight = requestAuthoringStorageCommit(transport, { method: "commit-local-storage", next, expectedGeneration }, notify, signal);
    const result = flight.result.then(reply => {
      const record = readStorageRecord(reply);
      if (!record) throw new Error("The browser data storage commit has no record.");
      return record;
    });
    void result.catch(() => {});
    return { result, settled: flight.settled } satisfies BrowserDataStorageCommit;
  };
  return {
    async load(signal) {
      return readStorageRecord(await requestAuthoringTransport(transport, { method: "load-local-storage" }, signal));
    },
    beginCommit,
    async commit(next, expectedGeneration, signal) {
      const flight = beginCommit(next, expectedGeneration, () => {}, signal);
      // The compatibility promise represents durable completion. Reader
      // cancellation alone cannot report a completed transaction as aborted.
      const outcome = await flight.settled;
      if (outcome.status !== "committed") throw new Error(outcome.error);
      return outcome.record;
    },
  };
}
