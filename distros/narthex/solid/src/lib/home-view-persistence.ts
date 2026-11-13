import { untrack } from "solid-js";
/** Browser write queue. Each identity owns its optimistic snapshot and its PUTs. */
export function createViewPersistence<V>(options: {
  write: (id: string, view: V, baseVersion?: number) => Promise<unknown>;
  version?: (id: string) => number | undefined;
  /** Browser-source identity, independently of its numeric edit revision. */
  origin?: () => unknown;
  writtenVersion?: (result: unknown) => number | undefined;
  refresh: () => Promise<unknown>;
  changed: () => void;
  delay?: number;
}) {
  type Draft = { view: V; revision: number; saved: number; baseVersion?: number; origin?: unknown; writtenResult?: unknown; error?: string; blocked?: boolean;
    timer?: ReturnType<typeof setTimeout>; pending?: Promise<boolean> };
  const drafts = new Map<string, Draft>();

  function flush(id: string): Promise<boolean> {
    const draft = drafts.get(id);
    if (!draft) return Promise.resolve(true);
    if (draft.timer !== undefined) clearTimeout(draft.timer);
    draft.timer = undefined;
    if (draft.pending) return draft.pending;
    if (draft.blocked) return Promise.resolve(false);
    draft.error = undefined;
    const work = async () => {
      try {
        while (true) {
          while (draft.saved < draft.revision) {
            if (options.origin && draft.origin !== options.origin()) {
              try {
                const successor = draft.writtenResult === undefined ? undefined : options.writtenVersion?.(draft.writtenResult);
                if (successor === undefined) throw new Error("The data source changed before saving. Discard these changes and reload the latest data.");
                draft.baseVersion = successor;
                draft.origin = options.origin();
              } catch (error) { draft.blocked = true; throw error; }
            }
            const revision = draft.revision;
            const result = await options.write(id, draft.view, draft.baseVersion);
            // Advance only from the acknowledgement of THIS write. Refreshing
            // unrelated data cannot turn a stale whole-list edit into consent
            // to overwrite another session's changes.
            let nextVersion: number | undefined;
            try { nextVersion = options.writtenVersion?.(result); }
            catch (error) {
              // The write returned in a retired source coordinate without an
              // exact acknowledged successor. Its old numeric base cannot be
              // retried in the new source, even if those numbers coincide.
              draft.blocked = true;
              throw error;
            }
            if (nextVersion !== undefined) draft.baseVersion = nextVersion;
            draft.writtenResult = result;
            if (options.origin && draft.origin !== options.origin()) {
              if (nextVersion === undefined) {
                draft.blocked = true;
                throw new Error("The saved data has no acknowledged revision in its new source. Discard these changes and reload the latest data.");
              }
              // writtenVersion admits only this operation's exact successor.
              draft.origin = options.origin();
            }
            draft.saved = revision;
          }
          await options.refresh();
          // An edit can arrive during refresh, too. Keep it queued.
          if (draft.saved === draft.revision) break;
        }
        drafts.delete(id);
        return true;
      } catch (error) {
        if (options.origin && draft.origin !== options.origin()) draft.blocked = true;
        draft.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        if (draft.timer !== undefined) clearTimeout(draft.timer);
        draft.timer = undefined;
        draft.pending = undefined;
        options.changed();
      }
    };
    // Install the in-flight marker before a host callback can throw.
    draft.pending = Promise.resolve().then(work);
    options.changed();
    return draft.pending;
  }

  return {
    read(id: string, server: V): V { return drafts.get(id)?.view ?? server; },
    update(id: string, view: V) {
      let draft = drafts.get(id);
      if (!draft) {
        draft = { view, revision: 0, saved: 0, baseVersion: untrack(() => options.version?.(id)),
          origin: untrack(() => options.origin?.()) };
        drafts.set(id, draft);
      }
      draft.view = view;
      draft.revision++;
      if (!draft.blocked) draft.error = undefined;
      if (draft.timer !== undefined) clearTimeout(draft.timer);
      if (!draft.blocked) draft.timer = setTimeout(() => void flush(id), options.delay ?? 250);
      options.changed();
    },
    status() {
      return [...drafts].map(([id, draft]) => ({ id, error: draft.error, blocked: !!draft.blocked,
        saving: draft.pending !== undefined }));
    },
    discard(id: string): boolean {
      const draft = drafts.get(id);
      if (!draft) return true;
      if (draft.pending) return false;
      if (draft.timer !== undefined) clearTimeout(draft.timer);
      drafts.delete(id);
      options.changed();
      return true;
    },
    flush,
    async flushAll() { return (await Promise.all([...drafts.keys()].map(flush))).every(Boolean); },
  };
}
