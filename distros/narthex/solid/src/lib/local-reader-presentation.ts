// B3 page-side presentation cache for a Local reader (ledgered worker-transport
// kind, design/ts-exceptions-ledger.md "B3 Local reader presentation
// transport"). Host scheduling only: every answer comes from the snapshot's
// worker (project-reader-metadata, project-reader-references,
// project-reader-type-presentations), evaluated in its own frame. Nothing here
// selects an instance, reflects a constructor or reads a page registry. A
// pending entry is reported as pending, never as a guessed name.
import { createSignal, untrack } from "solid-js";
import type { CatalogEntry, CatalogSection } from "@fenel/engine";
import type { FenelType } from "@fenel/engine/types";
import type { ReaderMetadataProjection } from "./api";
import type { ReaderPresentation, SourceReaderValueReadInput, SourceReaderValueReadPacket } from "./reader-presentation";
import type { TypeView } from "@fenel/engine";
import type { PreparedReaderWorker } from "./expression-runner/authoring-catalog-worker";
import type { AuthoringWorkerPayload, AuthoringWorkerResult, ReaderCatalogReference } from "./expression-runner/authoring-worker-protocol";
import type { FunctionCardType } from "./function-card-body";
import type { LocusCatalogLookups } from "./locus-catalog-reference";
import { captureRegistryTransportKey } from "../../../../../implementations/typescript/engine/src/registry-transport";

type Run = (handle: PreparedReaderWorker, payload: AuthoringWorkerPayload, signal?: AbortSignal) => Promise<AuthoringWorkerResult>;
type MetadataEntry = Omit<ReaderMetadataProjection["entries"][number], "target">;
type Entry<T> = { state: "pending" } | { state: "known"; value: T } | { state: "failed"; error: string };
export type LocalPresentationState<T> =
  | { kind: "known"; value: T }
  /** A retired incarnation's answer: display only, never a decision input. */
  | { kind: "stale"; value: T }
  | { kind: "pending" }
  | { kind: "failed"; error: string };

type Store = {
  handle: PreparedReaderWorker;
  metadata: Map<string, Entry<MetadataEntry>>;
  references: Map<string, Entry<ReaderCatalogReference | undefined>>;
  types: Map<string, Entry<FunctionCardType<FenelType>>>;
  /** Value packets: objects by identity, primitives by a typed key. */
  values: WeakMap<object, Map<string, Entry<SourceReaderValueReadPacket>>>;
  primitiveValues: Map<string, Entry<SourceReaderValueReadPacket>>;
  /** Failed value packets (objects live in a WeakMap): Retry forgets them. */
  failedValues: Set<{ slot: Map<string, Entry<SourceReaderValueReadPacket>>; key: string }>;
  queued: { metadata: Set<string>; references: Set<string>; types: Map<string, FenelType>;
    values: Array<{ value: unknown; type?: FenelType; thumbnail: boolean; slot: Map<string, Entry<SourceReaderValueReadPacket>>; key: string }>;
    reads: ValueRead[] };
  /** Keyed display reads (`readValue`): answered packets, most recently used last. */
  packets: Map<string, { packet: SourceReaderValueReadPacket; weight: number }>;
  packetWeight: number;
  /** Keyed display reads still asked: every consumer of one key shares its read. */
  reads: Map<string, ValueRead>;
  waiting: Array<() => void>;
  scheduled: boolean;
  controller: AbortController;
};

/** One keyed display read asked of the worker. `input` holds the captured
 * bytes that were keyed; `sent` cancels the worker request it travels in. */
type ValueRead = {
  key: string; weight: number; input: SourceReaderValueReadInput; consumers: number;
  settled: Promise<SourceReaderValueReadPacket>;
  resolve: (packet: SourceReaderValueReadPacket) => void;
  reject: (error: unknown) => void;
  sent?: { controller: AbortController; reads: readonly ValueRead[] };
};

/** Requests per message; a render pass larger than this splits in order. */
const BATCH = 200;
/** Keyed display reads per message. Smaller than `BATCH`: one message is one
 * worker job that cannot be interrupted, and an ordinary operation (a
 * navigation, a caption) must not wait behind two hundred projections. */
const READ_BATCH = 16;
/** A value whose key would exceed this many characters is not keyed (its
 * consumer asks the worker directly, as before): pictures and other large
 * binary data would spend more time being keyed than their read costs. */
const READ_KEY_LIMIT = 262_144;
/** Total key characters retained per worker incarnation before the least
 * recently used packets are dropped (a dropped packet is simply asked again). */
const READ_CACHE_LIMIT = 8_388_608;

/** A cheap upper estimate of a captured value's key length, abandoned as soon
 * as it passes `READ_KEY_LIMIT` (no byte of a large buffer is visited). */
function withinReadKeyLimit(root: unknown): boolean {
  let total = 0;
  const seen = new Set<object>();
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") total += value.length + 4;
    else if (value === null || typeof value !== "object") total += 24;
    else if (!seen.has(value)) {
      seen.add(value);
      if (value instanceof ArrayBuffer) total += value.byteLength * 2 + 32;
      else if (ArrayBuffer.isView(value)) total += value.byteLength * 2 + 48;
      else if (value instanceof Date) total += 32;
      else {
        total += 8;
        for (const key of Object.keys(value)) { total += key.length + 4; pending.push((value as Record<string, unknown>)[key]); }
      }
    }
    if (total > READ_KEY_LIMIT) return false;
  }
  return true;
}
// Transport shape only; language facts remain the worker's responsibility.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export type LocalReaderPresentation = ReturnType<typeof createLocalReaderPresentation>;

export function createLocalReaderPresentation(options: {
  /** The current snapshot's worker handle (tracked: a new incarnation re-keys). */
  worker: () => PreparedReaderWorker;
  /** The worker-published display catalogue (inert data). */
  catalog: () => readonly CatalogSection[];
  run: Run;
  knownIcons: () => readonly string[];
  /** Template roster the value packets select views from. */
  views?: () => { views: readonly TypeView[]; componentNames: readonly string[] } | undefined;
}) {
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  const bump = () => setVersion(value => value + 1);
  const stores = new WeakMap<PreparedReaderWorker, Store>();
  let current: Store | undefined;
  // Last answers of a retired incarnation: display only, while the new one pends.
  const staleMetadata = new Map<string, MetadataEntry>();
  const staleReferences = new Map<string, ReaderCatalogReference | undefined>();
  const staleTypes = new Map<string, FunctionCardType<FenelType>>();
  // Records pending (and failed) reads inside observePending().
  let probe: { pending: boolean; failed: boolean } | undefined;

  const storeFor = (handle: PreparedReaderWorker): Store => {
    let store = stores.get(handle);
    if (!store) {
      if (current && current.handle !== handle) {
        current.controller.abort(new Error("This reader's snapshot was replaced."));
        for (const [id, entry] of current.metadata) if (entry.state === "known") staleMetadata.set(id, entry.value);
        for (const [id, entry] of current.references) if (entry.state === "known") staleReferences.set(id, entry.value);
        for (const [key, entry] of current.types) if (entry.state === "known") staleTypes.set(key, entry.value);
        // A retired incarnation's packets answer no read of its replacement.
        const replaced = current;
        for (const read of [...replaced.reads.values()]) dropRead(replaced, read, replaced.controller.signal.reason);
        replaced.queued.reads.length = 0; replaced.packets.clear(); replaced.packetWeight = 0;
      }
      store = { handle, metadata: new Map(), references: new Map(), types: new Map(),
        values: new WeakMap(), primitiveValues: new Map(), failedValues: new Set(),
        queued: { metadata: new Set(), references: new Set(), types: new Map(), values: [], reads: [] },
        packets: new Map(), packetWeight: 0, reads: new Map(), waiting: [], scheduled: false,
        controller: new AbortController() };
      stores.set(handle, store);
    }
    current = store;
    return store;
  };

  const settle = <T>(store: Store, map: Map<string, Entry<T>>, keys: readonly string[],
    values: ReadonlyMap<string, T>, failure?: { error: unknown }) => {
    if (!failure && (values.size !== keys.length || keys.some(key => !values.has(key))))
      throw new Error("This reader's reply did not include every requested value.");
    for (const key of keys) {
      if (failure) {
        const { error } = failure;
        // A replaced snapshot keeps its entries pending for the next incarnation.
        if (store.controller.signal.aborted) map.delete(key);
        else map.set(key, { state: "failed", error: error instanceof Error ? error.message : String(error) });
      } else map.set(key, { state: "known", value: values.get(key) as T });
    }
  };

  const flush = (store: Store) => {
    store.scheduled = false;
    const metadata = [...store.queued.metadata], references = [...store.queued.references];
    const types = [...store.queued.types];
    const values = store.queued.values.splice(0);
    store.queued.metadata.clear(); store.queued.references.clear(); store.queued.types.clear();
    const jobs: Promise<unknown>[] = [];
    const signal = store.controller.signal;
    for (let start = 0; start < metadata.length; start += BATCH) {
      const targets = metadata.slice(start, start + BATCH);
      jobs.push(options.run(store.handle, { method: "project-reader-metadata", targets }, signal).then((result: unknown) => {
        if (!isRecord(result) || !Array.isArray(result.entries) || result.entries.length !== targets.length
          || result.entries.some((entry: unknown) => !isRecord(entry) || typeof entry.target !== "string"
            || !Array.isArray(entry.representations) || entry.representations.some((row: unknown) =>
              !isRecord(row) || typeof row.typeName !== "string" || !isRecord(row.methods))
            || entry.ownPresentation !== undefined && !isRecord(entry.ownPresentation)))
          throw new Error("This reader's metadata could not be read.");
        const values = new Map<string, MetadataEntry>();
        for (const { target, ...entry } of (result as ReaderMetadataProjection).entries) values.set(target, entry);
        settle(store, store.metadata, targets, values);
      }).catch(error => settle(store, store.metadata, targets, new Map(), { error })));
    }
    for (let start = 0; start < references.length; start += BATCH) {
      const targets = references.slice(start, start + BATCH);
      jobs.push(options.run(store.handle, { method: "project-reader-references", targets }, signal).then(result => {
        if (!isRecord(result) || !("references" in result) || !Array.isArray(result.references)
          || result.references.length !== targets.length || result.references.some(entry =>
            !isRecord(entry) || typeof entry.target !== "string"
            || entry.reference !== undefined && (!isRecord(entry.reference)
              || entry.reference.fn !== undefined && (!isRecord(entry.reference.fn) || typeof entry.reference.fn.id !== "string")
              || entry.reference.handle !== undefined && typeof entry.reference.handle !== "string"
              || entry.reference.identifiedHandle !== undefined && typeof entry.reference.identifiedHandle !== "string"
              || entry.reference.typeFamilyOwner !== undefined && !isRecord(entry.reference.typeFamilyOwner)
              || entry.reference.entityType !== undefined && !isRecord(entry.reference.entityType)
              || entry.reference.entityOwner !== undefined && (!isRecord(entry.reference.entityOwner) || typeof entry.reference.entityOwner.id !== "string"
                || entry.reference.entityOwner.nominalIdentity !== undefined && typeof entry.reference.entityOwner.nominalIdentity !== "string"))))
          throw new Error("This reader's references could not be read.");
        settle(store, store.references, targets, new Map(result.references.map(entry => [entry.target, entry.reference])));
      }).catch(error => settle(store, store.references, targets, new Map(), { error })));
    }
    for (let start = 0; start < types.length; start += BATCH) {
      const slice = types.slice(start, start + BATCH);
      const keys = slice.map(([key]) => key);
      jobs.push(options.run(store.handle, { method: "project-reader-type-presentations",
        types: slice.map(([, type]) => type), knownIcons: options.knownIcons() }, signal).then(result => {
        if (!isRecord(result) || !("typePresentations" in result) || !Array.isArray(result.typePresentations)
          || result.typePresentations.length !== keys.length)
          throw new Error("This reader's type captions could not be read.");
        const presentations = result.typePresentations;
        // Visit requested indexes: a sparse reply must not turn into known undefined.
        if (keys.some((_key, index) => {
          const entry = presentations[index];
          return !isRecord(entry) || !isRecord(entry.type) || typeof entry.label !== "string"
            || [entry.icon, entry.ownIcon, entry.ownEmoji, entry.term].some(text => text !== undefined && typeof text !== "string");
        })) throw new Error("This reader's type captions could not be read.");
        settle(store, store.types, keys, new Map(keys.map((key, index) => [key, presentations[index]!])));
      }).catch(error => settle(store, store.types, keys, new Map(), { error })));
    }
    const roster = values.length ? options.views?.() : undefined;
    for (let start = 0; start < values.length; start += BATCH) {
      const slice = values.slice(start, start + BATCH);
      const fail = (error: unknown) => {
        for (const item of slice) {
          if (store.controller.signal.aborted) item.slot.delete(item.key);
          else {
            item.slot.set(item.key, { state: "failed", error: error instanceof Error ? error.message : String(error) });
            store.failedValues.add({ slot: item.slot, key: item.key });
          }
        }
      };
      if (!roster) { fail(new Error("This reader's display tools are not ready.")); continue; }
      jobs.push(options.run(store.handle, { method: "project-reader-values", knownIcons: options.knownIcons(),
        inputs: slice.map(item => ({ value: item.value, type: item.type, compact: true, thumbnail: item.thumbnail, typeLookup: "session" as const,
          views: roster.views, componentNames: roster.componentNames })) }, signal).then(result => {
        if (!isRecord(result) || !("valueReads" in result) || !Array.isArray(result.valueReads)
          || result.valueReads.length !== slice.length)
          throw new Error("This data's display is unavailable.");
        const packets = result.valueReads;
        if (slice.some((_item, index) => {
          const packet = packets[index];
          return !isRecord(packet) || !isRecord(packet.root) || !isRecord(packet.root.glyph) || !Array.isArray(packet.children);
        })) throw new Error("This data's display is unavailable.");
        slice.forEach((item, index) => { item.slot.set(item.key, { state: "known", value: packets[index]! }); });
      }).catch(fail));
    }
    // Keyed display reads share this flush; their consumers hold promises, so
    // they neither join `jobs` nor bump the cache version.
    const reads: ValueRead[] = [];
    for (const read of store.queued.reads.splice(0)) {
      // Every consumer already left: never sent.
      if (read.consumers > 0) reads.push(read);
      else dropRead(store, read, new DOMException("Cancelled", "AbortError"));
    }
    for (let start = 0; start < reads.length; start += READ_BATCH) sendReads(store, reads.slice(start, start + READ_BATCH));
    const waiting = store.waiting.splice(0);
    void Promise.allSettled(jobs).then(() => { bump(); for (const resolve of waiting) resolve(); });
  };
  const schedule = (store: Store) => {
    if (store.scheduled) return;
    store.scheduled = true;
    queueMicrotask(() => flush(store));
  };

  // ---- Keyed display reads (typed read surfaces), 2026-11-11 ----
  // One `project-reader-values` answer per (worker incarnation, template
  // roster, captured wire). The worker computes a packet from its prepared
  // snapshot and the request alone, so a publication that changes none of the
  // three asks nothing; a restoration or a rebuild is a new incarnation (a new
  // store) and a changed value is a new key.
  const rosterIds = new Map<string, number>();
  let roster: { views: readonly TypeView[]; componentNames: readonly string[]; id: number } | undefined;
  /** The roster in force and its small id. Recaptured only when a view object
   * or a component name changed (views are compared by identity). */
  const currentRoster = () => {
    const next = options.views?.();
    if (!next) return undefined;
    if (roster && roster.views.length === next.views.length && roster.componentNames.length === next.componentNames.length
      && roster.views.every((view, index) => view === next.views[index])
      && roster.componentNames.every((name, index) => name === next.componentNames[index])) return roster;
    const { key } = captureRegistryTransportKey({ views: next.views, componentNames: next.componentNames },
      "typed reader value roster", "value-read", Reflect.get);
    let id = rosterIds.get(key);
    if (id === undefined) { id = rosterIds.size + 1; rosterIds.set(key, id); }
    roster = { views: [...next.views], componentNames: [...next.componentNames], id };
    return roster;
  };
  const dropRead = (store: Store, read: ValueRead, error: unknown) => {
    if (store.reads.get(read.key) === read) store.reads.delete(read.key);
    read.reject(error);
  };
  const readPacket = (value: unknown): value is SourceReaderValueReadPacket =>
    isRecord(value) && isRecord(value.root) && Array.isArray(value.children);
  const sendReads = (store: Store, reads: readonly ValueRead[]) => {
    const sent = { controller: new AbortController(), reads };
    for (const read of reads) read.sent = sent;
    const replaced = () => sent.controller.abort(store.controller.signal.reason);
    if (store.controller.signal.aborted) replaced();
    else store.controller.signal.addEventListener("abort", replaced, { once: true });
    void options.run(store.handle, { method: "project-reader-values", knownIcons: options.knownIcons(),
      inputs: reads.map(read => read.input) }, sent.controller.signal).then(result => {
      const packets = isRecord(result) && "valueReads" in result && Array.isArray(result.valueReads) ? result.valueReads : undefined;
      if (!packets || packets.length !== reads.length || reads.some((_read, index) => !readPacket(packets[index])))
        throw new Error("This data's display is unavailable.");
      if (sent.controller.signal.aborted) throw sent.controller.signal.reason;
      reads.forEach((read, index) => {
        if (store.reads.get(read.key) === read) store.reads.delete(read.key);
        store.packets.set(read.key, { packet: packets[index]!, weight: read.weight });
        store.packetWeight += read.weight;
        read.resolve(packets[index]!);
      });
      // Least recently used first; the newest answer always stays.
      for (const [key, entry] of store.packets) {
        if (store.packetWeight <= READ_CACHE_LIMIT || store.packets.size <= 1) break;
        store.packets.delete(key); store.packetWeight -= entry.weight;
      }
    }).catch(error => {
      if (sent.controller.signal.aborted || reads.length === 1) { for (const read of reads) dropRead(store, read, error); return; }
      // One refused value must not fail its neighbours: each is asked alone.
      for (const read of reads) {
        if (read.consumers > 0) sendReads(store, [read]);
        else dropRead(store, read, error);
      }
    }).finally(() => store.controller.signal.removeEventListener("abort", replaced));
  };
  /** The last consumer left: a read not yet sent is forgotten; a sent message
   * is cancelled once none of its reads has a consumer. */
  const abandonRead = (store: Store, read: ValueRead) => {
    if (read.consumers > 0 || store.reads.get(read.key) !== read) return;
    const cancelled = new DOMException("Cancelled", "AbortError");
    if (!read.sent) {
      const index = store.queued.reads.indexOf(read);
      if (index >= 0) store.queued.reads.splice(index, 1);
      dropRead(store, read, cancelled);
    } else if (read.sent.reads.every(other => other.consumers === 0)) {
      // Forget them first: a consumer arriving now starts a fresh read
      // instead of joining a request that is being cancelled.
      for (const other of read.sent.reads) if (store.reads.get(other.key) === other) store.reads.delete(other.key);
      read.sent.controller.abort(cancelled);
    }
  };
  /** One shared read for a typed read surface. Consumers of one key share its
   * request (and its answer afterwards); the request is cancelled only when
   * the last consumer has left. `undefined`: this cache does not serve the read
   * (another worker context, no roster yet, a value too large or not plain
   * enough to key) and the caller asks the worker directly, as before. */
  const readValue = (handle: PreparedReaderWorker, wire: SourceReaderValueReadInput,
    signal?: AbortSignal): Promise<{ valueReads: SourceReaderValueReadPacket[] }> | undefined => {
    let own: PreparedReaderWorker | undefined;
    try { own = untrack(() => options.worker()); } catch { return undefined; }
    if (own !== handle) return undefined;
    let captured: { readonly key: string; readonly copy: Omit<SourceReaderValueReadInput, "views" | "componentNames"> };
    let selected: NonNullable<ReturnType<typeof currentRoster>>;
    try {
      const next = currentRoster();
      if (!next) return undefined;
      selected = next;
      const { views: _views, componentNames: _componentNames, ...value } = wire;
      if (!withinReadKeyLimit(value)) return undefined;
      captured = captureRegistryTransportKey(value, "typed reader value request", "value-read", Reflect.get);
    } catch { return undefined; }
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const store = storeFor(handle);
    const key = `${selected.id}\u0002${captured.key}`;
    const known = store.packets.get(key);
    if (known) {
      store.packets.delete(key); store.packets.set(key, known);
      return Promise.resolve({ valueReads: [known.packet] });
    }
    let read = store.reads.get(key);
    if (!read) {
      let resolve!: ValueRead["resolve"], reject!: ValueRead["reject"];
      const settled = new Promise<SourceReaderValueReadPacket>((yes, no) => { resolve = yes; reject = no; });
      settled.catch(() => undefined);
      read = { key, weight: captured.key.length, consumers: 0, settled, resolve, reject,
        input: { ...captured.copy, views: selected.views, componentNames: selected.componentNames } };
      store.reads.set(key, read);
      store.queued.reads.push(read);
      schedule(store);
    }
    const shared = read;
    shared.consumers += 1;
    return new Promise((resolve, reject) => {
      let left = false;
      const leave = () => {
        left = true;
        signal?.removeEventListener("abort", aborted);
        shared.consumers -= 1;
      };
      const aborted = () => {
        if (left) return;
        leave();
        // A consumer that asks the same key again in this turn keeps the request.
        queueMicrotask(() => abandonRead(store, shared));
        reject(signal!.reason ?? new DOMException("Cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", aborted, { once: true });
      shared.settled.then(packet => { if (!left) { leave(); resolve({ valueReads: [packet] }); } },
        error => { if (!left) { leave(); reject(error); } });
    });
  };

  function read<T>(map: (store: Store) => Map<string, Entry<T>>, queue: (store: Store, key: string) => void,
    stale: Map<string, T>, key: string): LocalPresentationState<T> {
    version();
    const store = storeFor(options.worker());
    const entries = map(store);
    const entry = entries.get(key);
    if (!entry) {
      entries.set(key, { state: "pending" });
      queue(store, key);
      schedule(store);
    }
    const settled = entries.get(key)!;
    if (settled.state === "known") return { kind: "known", value: settled.value };
    // Stale, failed and pending answers are all "not current": decisions wait.
    if (probe) probe.pending = true;
    if (settled.state === "failed" && probe) probe.failed = true;
    if (stale.has(key)) return { kind: "stale", value: stale.get(key) as T };
    if (settled.state === "failed") return { kind: "failed", error: settled.error };
    return { kind: "pending" };
  }
  const metadataState = (id: string) => read(store => store.metadata, (store, key) => store.queued.metadata.add(key), staleMetadata, id);
  const referenceState = (id: string) => read(store => store.references, (store, key) => store.queued.references.add(key), staleReferences, id);
  const failedTypeRead = (error: unknown): LocalPresentationState<never> => {
    version();
    if (probe) { probe.pending = true; probe.failed = true; }
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  };
  const typeState = (type: FenelType) => {
    try {
      const captured = captureRegistryTransportKey(type, "reader type caption", "canonical", Reflect.get);
      return read(store => store.types, (store, queued) => store.queued.types.set(queued, captured.copy), staleTypes, captured.key);
    } catch (error) { return failedTypeRead(error); }
  };
  /** The worker's read packet for one value (reflection, view, type caption). */
  const valueState = (value: unknown, type?: FenelType, read: { thumbnail?: boolean } = {}): LocalPresentationState<SourceReaderValueReadPacket> => {
    version();
    const store = storeFor(options.worker());
    const thumbnail = !!read.thumbnail;
    let capturedType: { readonly key: string; readonly copy: FenelType } | undefined;
    try {
      if (type !== undefined) capturedType = captureRegistryTransportKey(type, "reader value type", "value-read", Reflect.get);
    } catch (error) { return failedTypeRead(error); }
    const typeKey = `${thumbnail ? "t" : "c"}|${capturedType?.key ?? ""}`;
    let slot: Map<string, Entry<SourceReaderValueReadPacket>>;
    let key: string;
    if (value !== null && typeof value === "object") {
      slot = store.values.get(value) ?? new Map();
      store.values.set(value, slot);
      key = typeKey;
    } else {
      slot = store.primitiveValues;
      key = `${typeof value}:${Object.is(value, -0) ? "-0" : String(value)}|${typeKey}`;
    }
    const entry = slot.get(key);
    if (!entry) {
      slot.set(key, { state: "pending" });
      store.queued.values.push({ value, type: capturedType?.copy, thumbnail, slot, key });
      schedule(store);
      // No eviction: a bound below the number of mounted cards re-requests
      // them in a loop (each completion re-renders every subscriber). The map
      // lives for one worker incarnation and is released with it.
    }
    const settled = slot.get(key)!;
    if (settled.state === "known") return { kind: "known", value: settled.value };
    if (probe) { probe.pending = true; if (settled.state === "failed") probe.failed = true; }
    return settled.state === "failed" ? { kind: "failed", error: settled.error } : { kind: "pending" };
  };
  /** Current answers only: catalogue references, handles, decisions. */
  const known = <T>(state: LocalPresentationState<T>): T | undefined => state.kind === "known" ? state.value : undefined;
  /** What may be painted: a current answer, else a retired one (display only). */
  const shown = <T>(state: LocalPresentationState<T>): T | undefined =>
    state.kind === "known" || state.kind === "stale" ? state.value : undefined;

  const catalogEntry = (id: string): CatalogEntry | undefined => {
    const entries = options.catalog().flatMap(section => section.entries);
    const direct = entries.find(entry => entry.id === id)
      ?? entries.find(entry => entry.fn?.id === id || entry.entity?.id === id);
    if (direct) return direct;
    // A UUID handle names the same definition as its catalogue wire id.
    const fn = known(referenceState(id))?.fn;
    return fn ? entries.find(entry => entry.id === fn.id || entry.fn?.id === fn.id) : undefined;
  };
  const presentation = (id: string): ReaderPresentation | undefined => {
    const state = metadataState(id), own = shown(state)?.ownPresentation;
    // Text/glyph stale display remains available, but a retired picture plan
    // must not initiate a new read in the replacement worker/frame.
    return state.kind === "known" || !own ? own : { ...own, picture: undefined };
  };
  const representation = (typeName: string, id: string): Record<string, unknown> | undefined => {
    const state = metadataState(id);
    return (typeName === "Picturable" ? known(state) : shown(state))?.representations.find(row => row.typeName === typeName)?.methods;
  };
  const catalogLookups: LocusCatalogLookups = {
    fn: id => known(referenceState(id))?.fn,
    typeFamilyOwner: id => known(referenceState(id))?.typeFamilyOwner,
    entityType: id => known(referenceState(id))?.entityType,
    entityOwner: id => known(referenceState(id))?.entityOwner,
    entry: catalogEntry,
  };

  return {
    metadataState, referenceState, typeState, valueState, readValue,
    presentation,
    /** True until the CURRENT incarnation answered: a stale name is display only. */
    presentationPending: (id: string) => metadataState(id).kind !== "known",
    ownIcon: (id: string) => presentation(id)?.icon,
    representation,
    catalogEntry,
    catalogLookups,
    referencePending: (id: string) => referenceState(id).kind !== "known",
    typePresentation: (type: FenelType) => shown(typeState(type)),
    typePresentationPending: (type: FenelType) => typeState(type).kind !== "known",
    /** Run `compute` and report whether it read any entry that is not current
     * (`pending`), and whether one of those failed (`failed`: offer Retry). */
    observePending<T>(compute: () => T): { value: T; pending: boolean; failed: boolean } {
      const outer = probe;
      const local = { pending: false, failed: false };
      probe = local;
      try { return { value: compute(), pending: local.pending, failed: local.failed }; }
      finally {
        probe = outer;
        if (outer && local.pending) outer.pending = true;
        if (outer && local.failed) outer.failed = true;
      }
    },
    /** Request these ids now and wait for their answers (preparation prefill). */
    prefill(targets: readonly string[]): Promise<void> {
      const store = storeFor(options.worker());
      let queued = false;
      for (const id of new Set(targets)) {
        if (!store.metadata.has(id)) { store.metadata.set(id, { state: "pending" }); store.queued.metadata.add(id); queued = true; }
        if (!store.references.has(id)) { store.references.set(id, { state: "pending" }); store.queued.references.add(id); queued = true; }
      }
      if (!queued) return Promise.resolve();
      const done = new Promise<void>(resolve => store.waiting.push(resolve));
      schedule(store);
      return done;
    },
    /** Forget failed answers of the current incarnation so they are asked again. */
    retry(): void {
      const store = current;
      if (!store) return;
      for (const map of [store.metadata, store.references, store.types] as Map<string, Entry<unknown>>[])
        for (const [key, entry] of map) if (entry.state === "failed") map.delete(key);
      for (const failed of store.failedValues) if (failed.slot.get(failed.key)?.state === "failed") failed.slot.delete(failed.key);
      store.failedValues.clear();
      // A keyed read is never retained failed; Retry also asks a packet its
      // surface refused (it validates the packet itself) once more.
      store.packets.clear(); store.packetWeight = 0;
      bump();
    },
  };
}
