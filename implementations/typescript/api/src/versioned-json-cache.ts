import { createHash, randomUUID } from "node:crypto";

type Entry = { body: string; etag?: string; bytes?: number };
type Read = {
  accountId: string;
  resource: string;
  ifNoneMatch?: string;
  revision: () => Promise<string>;
  load: () => Promise<unknown>;
};

function response(entry: Entry, notModified = false): Response {
  return new Response(notModified ? null : entry.body, {
    status: notModified ? 304 : 200,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": entry.etag ? "private, no-cache" : "no-store",
      "Vary": "Cookie, Authorization",
      ...(entry.etag ? { ETag: entry.etag } : {}),
    },
  });
}

function matchesTag(value: string | undefined, etag: string): boolean {
  return value?.split(",").some((tag) => [etag, `W/${etag}`, "*"].includes(tag.trim())) ?? false;
}

/** A freshly authorized immutable-source read can use its complete wire
 * content as the version. HTTP revalidation rechecks access on every reuse. */
export function privateVersionedJson(value: unknown, ifNoneMatch?: string): Response {
  const body = JSON.stringify(value);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  return response({ body, etag }, matchesTag(ifNoneMatch, etag));
}

/** Call only after authenticating the request. Every hit rechecks current
 * inputs; a process generation also invalidates results after code restarts.
 * Serialized bytes are retained, never mutable objects from another request. */
export function createVersionedJsonCache({ maxEntries = 24, maxBytes = 32 * 1024 * 1024, generation = randomUUID() }: {
  maxEntries?: number; maxBytes?: number; generation?: string;
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Cache limits must be positive integers");
  }
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  let retainedBytes = 0;
  return async (read: Read): Promise<Response> => {
    if (!read.accountId) throw new Error("Versioned private reads require an account");
    let before: string;
    try {
      before = await read.revision();
    } catch {
      return response({ body: JSON.stringify(await read.load()) });
    }
    const etag = `"${createHash("sha256").update(JSON.stringify([
      generation, read.accountId, read.resource, before,
    ])).digest("hex")}"`;
    if (matchesTag(read.ifNoneMatch, etag)) {
      return response({ body: "", etag }, true);
    }
    const prior = entries.get(etag);
    if (prior) {
      entries.delete(etag);
      entries.set(etag, prior);
      return response(prior);
    }
    let loading = pending.get(etag);
    if (!loading) {
      loading = (async (): Promise<Entry> => {
        const body = JSON.stringify(await read.load());
        let after: string;
        try { after = await read.revision(); }
        catch { return { body }; }
        // A write raced the read. Return its fresh result without attaching an
        // older revision or retaining it for later callers.
        if (before !== after) return { body };
        const entry = { body, etag, bytes: Buffer.byteLength(body) };
        if (entry.bytes <= maxBytes) {
          entries.set(etag, entry);
          retainedBytes += entry.bytes;
          while (entries.size > maxEntries || retainedBytes > maxBytes) {
            const oldest = entries.keys().next().value!;
            retainedBytes -= entries.get(oldest)!.bytes!;
            entries.delete(oldest);
          }
        }
        return entry;
      })();
      pending.set(etag, loading);
    }
    try { return response(await loading); }
    finally { if (pending.get(etag) === loading) pending.delete(etag); }
  };
}
