// B4 F2 (Central reader worker transport, host plumbing): a Local reader's
// identified parameter names, answered by its worker
// (`project-reader-field-names`) and cached per worker snapshot. Reads are
// reactive: the first read of an id queues it (one request per microtask, at
// guidance class); until the answer, and after a failed one, the caller shows
// the field's own name. The cache is the capture's: a replaced worker or a new
// reader revision starts a new one (a failed name is asked again).
import { createSignal, untrack, type Accessor } from "solid-js";
import type { ReaderRuntime } from "../reader-runtime";
import type { AuthoringSession } from "./account-authoring-session";
import { authoringWorkerSnapshot, preparedReaderWorkerForSession, runPreparedReaderWorker } from "./authoring-catalog-worker";
import type { ReaderFieldName } from "./authoring-worker-reader-extensions";
import { READER_FIELD_NAMES_LIMIT } from "./live-guidance-limits";
import type { FieldDef } from "@fenel/engine/types";
import { Nothing } from "@fenel/engine/type-foundation";
import { parameterDisplayName } from "./call-display";
import { codeName, humanName, type DisplayName } from "../display-name";

export type LocalFieldName = { label?: string; codeName?: string };
type Cache = {
  revision: number | undefined;
  names: Map<string, LocalFieldName | "pending" | "failed">;
  queued: Set<string>;
  version: Accessor<number>;
  bump: () => void;
};
const caches = new WeakMap<object, Cache>();

function cacheFor(snapshot: object, revision: number | undefined): Cache {
  let cache = caches.get(snapshot);
  if (!cache || cache.revision !== revision) {
    const [version, setVersion] = createSignal(0);
    cache = { revision, names: new Map(), queued: new Set(), version, bump: () => setVersion(value => value + 1) };
    caches.set(snapshot, cache);
  }
  return cache;
}

function readable(answer: unknown): answer is ReaderFieldName {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
  const row = answer as Record<string, unknown>;
  if (row.unavailable === true) return Object.keys(row).length === 1;
  return Object.keys(row).every(key => (key === "label" || key === "codeName") && typeof row[key] === "string");
}

function flush(cache: Cache, session: AuthoringSession) {
  const ids = [...cache.queued].slice(0, READER_FIELD_NAMES_LIMIT);
  for (const id of ids) cache.queued.delete(id);
  if (cache.queued.size) queueMicrotask(() => flush(cache, session));
  if (!ids.length) return;
  let job: Promise<unknown> | undefined;
  try {
    const handle = untrack(() => preparedReaderWorkerForSession(session));
    job = handle ? runPreparedReaderWorker(handle, { method: "project-reader-field-names", fieldIds: ids, priority: "guidance" }) : undefined;
  } catch { job = undefined; }
  const settle = (answers: readonly unknown[] | undefined) => {
    ids.forEach((id, index) => {
      const answer = answers?.[index];
      cache.names.set(id, answers && readable(answer) && !("unavailable" in answer) ? answer : "failed");
    });
    cache.bump();
  };
  if (!job) { settle(undefined); return; }
  job.then(reply => {
    const names = reply && typeof reply === "object" && !Array.isArray(reply) ? (reply as { fieldNames?: unknown }).fieldNames : undefined;
    settle(Array.isArray(names) && names.length === ids.length && names.every(readable) ? names : undefined);
  }, () => settle(undefined));
}

/** The worker's name for `fieldId`, or `undefined` while it is not known (not
 * a Local reader, no prepared worker, pending, failed or unavailable). */
export function localFieldName(reader: Pick<ReaderRuntime, "kind" | "revision"> | undefined, session: AuthoringSession,
  fieldId: string): LocalFieldName | undefined {
  if (reader?.kind !== "local") return undefined;
  let snapshot: object | undefined, revision: number | undefined;
  try { snapshot = authoringWorkerSnapshot(session); revision = reader.revision(); } catch { snapshot = undefined; }
  if (!snapshot) return undefined;
  const cache = cacheFor(snapshot, revision);
  cache.version();
  const known = cache.names.get(fieldId);
  if (known === undefined) {
    cache.names.set(fieldId, "pending");
    if (!cache.queued.size) queueMicrotask(() => flush(cache, session));
    cache.queued.add(fieldId);
    return undefined;
  }
  return typeof known === "object" ? known : undefined;
}

/** `parameterDisplayName` for a Local reader: the worker's registry answer
 * for an identified field (`published`), composed exactly as the page composes
 * its own registry's; unanswered, the field's own label or name, as with no
 * registry. A known answer with neither fact shows the field's name. */
export function localParameterName(field: FieldDef | undefined, ordinal: number, published: LocalFieldName | undefined): DisplayName {
  if (published?.label) return humanName(published.label);
  if (published?.codeName) return codeName(published.codeName);
  return parameterDisplayName(field?.key?.$tag === "NamedField" && published ? { ...field, label: Nothing } : field, ordinal);
}
