import type { ApiClient } from "./api";

type ReaderWrites = {
  enqueue: <T>(write: () => Promise<T>) => Promise<T>;
  pendingValues: Map<string, object>;
  valueRevisions: Map<string, number>;
};
const readers = new WeakMap<ApiClient, ReaderWrites>();

/** A reader's panes share the host write lane and in-flight value ownership.
 * Each pane still keeps its authored root revision: a sibling's edit is never
 * permission to overwrite its snapshot. The server remains the CAS authority. */
export function locusReaderWrites(client: ApiClient): ReaderWrites {
  let state = readers.get(client);
  if (!state) {
    let pending: Promise<unknown> = Promise.resolve();
    state = {
      enqueue<T>(write: () => Promise<T>) {
        const next = pending.then(write);
        pending = next.catch(() => {});
        return next;
      },
      pendingValues: new Map(), valueRevisions: new Map(),
    };
    readers.set(client, state);
  }
  return state;
}
