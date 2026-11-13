// Browser transport/lifetime boundary (A2/B3/Solid): the existing Fenel source
// admits edits. This journal replays only their ordinary authoring endpoints.
import { createSignal } from "solid-js";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import type { ApiClient } from "./api";
import type { LocusRootCommand, LocusRootData } from "./locus-root-data";
import { createLocalApiClient, type BrowserReaderSnapshot, type LocalTabSource } from "./local-locus-data";
import type { LocusSynchronization } from "./locus-synchronization";

export type ReaderDraftController = {
  pending(): number;
  dirty(id?: string): boolean;
  saving(): boolean;
  error(): string | undefined;
  save(): Promise<boolean>;
  discard(): Promise<boolean>;
  source(): LocalTabSource | undefined;
  snapshot(): BrowserReaderSnapshot | undefined;
  revision(): number | undefined;
  /** Exact browser source of an admitted local receipt, even after Save clears
   * that source before the awaiting editor receives its result. */
  resultSource(result: unknown): LocalTabSource | undefined;
  /** Last server root acknowledgement emitted by this exact local receipt. */
  resultRootRevision(result: unknown): number | undefined;
};

export type ReaderDraftClientOptions = {
  createSource(): Promise<LocalTabSource>;
  synchronization?: LocusSynchronization;
  enabled?: () => boolean;
  enabledNow?: () => boolean;
  onChanged?: () => void;
  /** Reload the committed reader using its raw client, outside this overlay. */
  onDefinitionsChanged?: () => Promise<void>;
  modules?: () => readonly SourceModuleDocument[];
  /** A qualified account frame must exist before admitting dispatch rules. */
  canStageRepresentations?: () => boolean;
};

type JournalEntry = { ids: readonly string[]; writtenRootRevision?: number; replay(): Promise<void> };
type DraftClient = ApiClient & { readonly drafts: ReaderDraftController };
type Bundle = Parameters<ApiClient["api"]["definitionBundleSave"]>[0];
type SavedPatch = Parameters<ApiClient["api"]["savedQueryUpdate"]>[1];
type InstanceCreate = Parameters<ApiClient["api"]["dispatchInstanceCreate"]>[0];
type RepresentationReceipt = { id: string; instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding };

/** One stable captured account client, shared by all of that reader's lenses.
 * Server revisions advance only from acknowledged writes, independently of the
 * browser source's edit revision. A failed write retains the unsent suffix. */
export function createReaderDraftClient(remote: ApiClient, options: ReaderDraftClientOptions): DraftClient {
  const [status, setStatus] = createSignal(0, { ownedWrite: true });
  let active = true;
  let source: LocalTabSource | undefined;
  let local: ApiClient | undefined;
  let preparation: Promise<LocalTabSource> | undefined;
  let staging: Promise<unknown> = Promise.resolve();
  let flight: Promise<boolean> | undefined;
  let failure: string | undefined;
  let committedRoot: LocusRootData | undefined;
  let committedDefinitions: FieldPersistenceSnapshot | undefined;
  const committedValues = new Map<string, Record<string, unknown>>();
  const committedInstances = new Map<string, { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding; registry?: ModuleRegistry }>();
  const authoredInstances = new Map<string, RepresentationReceipt>();
  const touchedInstances = new Set<string>();
  const localResultSources = new WeakMap<object, LocalTabSource>();
  const localResultEntries = new WeakMap<object, readonly JournalEntry[]>();
  const journal: JournalEntry[] = [];
  const enabled = () => options.enabledNow?.() ?? options.synchronization?.enabledNow()
    ?? options.enabled?.() ?? true;
  const assertActive = () => {
    remote.signal.throwIfAborted();
    if (!active) throw new Error("This reader was closed.");
  };
  const changed = () => {
    if (!active || remote.signal.aborted) return;
    setStatus(value => value + 1); options.onChanged?.();
  };
  const ensureSource = (): Promise<LocalTabSource> => {
    assertActive();
    if (source) return Promise.resolve(source);
    preparation ??= options.createSource().then(async candidate => {
      try {
        await candidate.ready(); assertActive();
        source = candidate;
        local = createLocalApiClient(candidate, { accountId: remote.accountId, readFallback: remote });
        committedRoot = structuredClone(candidate.root());
        committedDefinitions = structuredClone(candidate.state().definitions);
        committedValues.clear();
        for (const entry of candidate.state().values) committedValues.set(entry.id, structuredClone(entry.value.query));
        committedInstances.clear();
        for (const entry of candidate.state().representations) committedInstances.set(entry.id, {
          instance: structuredClone(entry.value.instance), valueEncoding: entry.value.valueEncoding, registry: candidate.snapshot().registry,
        });
        return candidate;
      } catch (error) { candidate.dispose(); throw error; }
    }).catch(error => { preparation = undefined; throw error; });
    return preparation;
  };
  const overlay = () => { status(); return !!source; };
  const shouldStage = () => !enabled() || overlay();
  const refused = (name: string): never => {
    assertActive();
    throw new Error(`${name} cannot be edited with synchronization paused. Save or discard the pending changes first.`);
  };
  const assertRepresentationStaging = () => {
    assertActive();
    if (options.canStageRepresentations?.() !== true) {
      throw new Error("Save or discard the pending data and turn synchronization on before changing representation rules.");
    }
  };
  const enqueueLocal = <T>(work: (client: ApiClient, current: LocalTabSource) => Promise<T>,
    entries: (result: T, current: LocalTabSource) => readonly JournalEntry[]): Promise<T> => {
    assertActive();
    const next = staging.then(async () => {
      const current = await ensureSource(); assertActive();
      const revision = current.revision();
      let result: T;
      try { result = await work(local!, current); assertActive(); }
      catch (error) {
        if (!journal.length && source === current && current.revision() === revision) resetSource(false);
        throw error;
      }
      const admittedEntries = entries(result, current);
      if (typeof result === "object" && result !== null) {
        localResultSources.set(result, current);
        localResultEntries.set(result, admittedEntries);
      }
      // Append only after checked data AND its prepared reader were published.
      journal.push(...admittedEntries);
      changed();
      return result;
    });
    staging = next.catch(() => {});
    return next.then(async result => {
      if (enabled()) {
        const saved = await save();
        // A concurrent edit is outside the first save's captured prefix.
        if (saved && enabled() && journal.length) await save();
      }
      // Browser admission already succeeded. Persistence failures remain owned
      // by this source's pending journal/error so a caller cannot reapply the
      // accepted mutation while attempting to retry its network save.
      return result;
    });
  };
  const rootEntry = (command: LocusRootCommand): JournalEntry => ({
    ids: [committedRoot!.id, ...("referenceId" in committedRoot! ? [committedRoot!.referenceId] : []),
      ...(command.kind === "batch" ? command.commands : [command]).flatMap(change => [
        ...("itemId" in change ? [change.itemId] : []),
        ...(change.kind === "append" || change.kind === "replace" ? [change.item.id] : []),
        ...(change.kind === "reorder" ? change.itemIds : []),
      ])],
    async replay(this: JournalEntry) {
      const response = await remote.editLocusRoot(committedRoot!.id, committedRoot!.revision, command);
      assertActive(); committedRoot = structuredClone(response.root);
      this.writtenRootRevision = response.root.revision;
    },
  });
  const savedEntry = (id: string, patch: SavedPatch): JournalEntry => ({ ids: [id], async replay() {
    const expectedQuery = patch.expectedQuery ?? committedValues.get(id);
    if (!expectedQuery) throw new Error("The saved data baseline is unavailable. Reload before saving it.");
    const response = await remote.api.savedQueryUpdate(id, { ...patch, expectedQuery });
    assertActive();
    committedValues.set(id, structuredClone(response.query?.query ?? patch.query ?? expectedQuery));
  } });
  const definitionEntry = (bundle: Bundle): JournalEntry => ({
    ids: [...bundle.ownerMutations.flatMap(mutation => mutation.kind === "upsert"
      ? [mutation.owner.definition.id, mutation.owner.ownerKey, mutation.owner.storageName, ...(mutation.owner.storageId ? [mutation.owner.storageId] : [])]
      : [mutation.ownerKey, mutation.storageName, ...(committedDefinitions?.owners.filter(owner => owner.ownerKey === mutation.ownerKey)
        .flatMap(owner => owner.storageId ? [owner.storageId] : []) ?? [])]), ...(bundle.desiredFacets ?? []).map(facet => facet.fieldId),
      ...(bundle.replaceFacetFieldIds ?? []), ...(bundle.resurrectFieldIds ?? [])],
    async replay() {
      const response = await remote.api.definitionBundleSave({ ...bundle, expectedSnapshot: committedDefinitions });
      assertActive(); committedDefinitions = structuredClone(response.snapshot);
    },
  });
  const instanceEntry = (id: string, instance: Record<string, unknown>, valueEncoding?: InstanceJsonEncoding,
    authoredExpectedInstance?: Record<string, unknown>): JournalEntry => {
    const originallyRead = !touchedInstances.has(id) ? authoredInstances.get(id) : undefined;
    touchedInstances.add(id);
    return {
    ids: [id, ...(Array.isArray(instance.args) ? instance.args.filter((arg): arg is string => typeof arg === "string") : [])],
    async replay() {
      const baseline = committedInstances.get(id);
      if (!baseline) throw new Error("The representation baseline is unavailable. Reload before saving it.");
      const { instanceToJsonWire, instanceFromJsonWire } = await import("@fenel/engine/authoring/type");
      const originallyAuthored = originallyRead && instanceFromJsonWire(originallyRead.instance, baseline.registry, undefined, originallyRead.valueEncoding);
      const expectedInstance = authoredExpectedInstance ?? instanceToJsonWire(originallyAuthored ?? baseline.instance, baseline.registry, undefined, valueEncoding);
      const response = await remote.api.dispatchInstanceUpdate(id, instance, valueEncoding, expectedInstance);
      assertActive();
      const receipt = response.definition;
      const encoding = receipt?.valueEncoding ?? valueEncoding;
      committedInstances.set(id, { instance: instanceFromJsonWire(receipt?.instance ?? instance,
        source?.snapshot().registry, undefined, encoding), valueEncoding: encoding, registry: source?.snapshot().registry });
    },
    };
  };
  const createdInstanceEntry = (id: string, submitted: InstanceCreate): JournalEntry => {
    touchedInstances.add(id);
    return { ids: [id,
    ...submitted.args.filter((arg): arg is string => typeof arg === "string")], async replay() {
    const response = await remote.api.dispatchInstanceCreate({ ...submitted, id }); assertActive();
    const receipt = response.definition;
    if (receipt?.id !== id) throw new Error("The server did not retain the draft representation identity.");
    const { instanceFromJsonWire } = await import("@fenel/engine/authoring/type");
    const encoding = receipt.valueEncoding ?? submitted.valueEncoding;
    committedInstances.set(id, { instance: instanceFromJsonWire(receipt.instance,
      source?.snapshot().registry, undefined, encoding), valueEncoding: encoding, registry: source?.snapshot().registry });
  } };
  };
  const resetSource = (clearAuthored = true) => {
    local?.dispose(); source?.dispose();
    source = undefined; local = undefined; preparation = undefined;
    committedRoot = undefined; committedDefinitions = undefined; committedValues.clear(); committedInstances.clear();
    touchedInstances.clear();
    if (clearAuthored) authoredInstances.clear();
    changed();
  };
  function save(): Promise<boolean> {
    try { assertActive(); } catch { return Promise.resolve(false); }
    if (flight) return flight;
    // Explicit Save while paused processes its captured prefix. Automatic
    // synchronization stops between acknowledgements when the switch turns off.
    const explicitWhilePaused = !enabled();
    const next = Promise.resolve().then(async () => {
      const capturedStaging = staging;
      await capturedStaging; assertActive();
      failure = undefined; changed();
      const prefix = journal.slice();
      try {
        for (const entry of prefix) {
          assertActive();
          if (!explicitWhilePaused && !enabled()) break;
          await entry.replay();
          assertActive();
          // Later edits remain in the same journal while this request awaits IO.
          if (journal[0] !== entry) throw new Error("The pending data changed during its save.");
          journal.shift(); changed();
        }
        if (!journal.length && source) {
          const captured = source;
          const revision = captured.revision();
          await options.onDefinitionsChanged?.(); assertActive();
          if (!journal.length && source === captured && captured.revision() === revision && staging === capturedStaging) resetSource();
        }
        return true;
      } catch (problem) {
        if (active && !remote.signal.aborted) {
          failure = problem instanceof Error ? problem.message : String(problem); changed();
        }
        return false;
      }
    });
    flight = next;
    changed();
    return next.finally(() => { if (flight === next) { flight = undefined; changed(); } });
  }
  async function discard(): Promise<boolean> {
    try {
      assertActive();
      if (flight) throw new Error("Wait for the current save before discarding these changes.");
      const capturedStaging = staging;
      await capturedStaging; assertActive();
      const captured = source, revision = source?.revision();
      await options.onDefinitionsChanged?.(); assertActive();
      if (source !== captured || source?.revision() !== revision || staging !== capturedStaging) throw new Error("New edits were made while these changes were being discarded. Try again.");
      journal.length = 0; failure = undefined; resetSource(); return true;
    } catch (problem) {
      if (active && !remote.signal.aborted) { failure = problem instanceof Error ? problem.message : String(problem); changed(); }
      return false;
    }
  }
  const drafts: ReaderDraftController = {
    pending: () => { status(); return journal.length || (source && failure ? 1 : 0); },
    dirty: (id?: string) => { status(); return id === undefined ? journal.length > 0
      : journal.some(entry => entry.ids.includes(id)); },
    saving: () => { status(); return !!flight; },
    error: () => { status(); return failure; }, save, discard,
    source: () => { status(); return source; },
    snapshot: () => { status(); return source?.snapshot(); },
    revision: () => { status(); return source?.revision(); },
    resultSource: (result: unknown) => typeof result === "object" && result !== null
      ? localResultSources.get(result) : undefined,
    resultRootRevision: (result: unknown) => {
      const entries = typeof result === "object" && result !== null ? localResultEntries.get(result) : undefined;
      if (!entries) return undefined;
      for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index]!.writtenRootRevision !== undefined) return entries[index]!.writtenRootRevision;
      }
      return undefined;
    },
  };
  const unregister = options.synchronization?.register(`account:${remote.epoch}:${remote.accountId}`, {
    pending: () => drafts.pending() > 0, saving: drafts.saving, error: drafts.error,
    save, discard,
  });
  const mutationApi = {
    savedQueryCreate: (data: Parameters<ApiClient["api"]["savedQueryCreate"]>[0]) => {
      const submitted = structuredClone(data);
      if (!shouldStage()) return remote.api.savedQueryCreate(submitted);
      return enqueueLocal(client => client.api.savedQueryCreate(submitted), result => [{ ids: [result.query.id], async replay() {
        const response = await remote.api.savedQueryCreate({ ...submitted, id: result.query.id });
        assertActive();
        if (response.query?.id !== result.query.id) throw new Error("The server did not retain the draft data identity.");
        committedValues.set(result.query.id, structuredClone(response.query.query));
      } }]);
    },
    savedQueryUpdate: (id: string, patch: SavedPatch) => {
      const submitted = structuredClone(patch);
      const { expectedQuery: _precondition, ...authoredPatch } = submitted;
      return shouldStage() ? enqueueLocal(client => client.api.savedQueryUpdate(id, authoredPatch), () => [savedEntry(id, submitted)])
        : remote.api.savedQueryUpdate(id, submitted);
    },
    savedQueryDelete: (id: string, authoredQuery?: Record<string, unknown>) => {
      const authored = authoredQuery && structuredClone(authoredQuery);
      return shouldStage() ? enqueueLocal(client => client.api.savedQueryDelete(id), () => [{ ids: [id], async replay() {
      const expectedQuery = authored ?? committedValues.get(id);
      if (!expectedQuery) throw new Error("The saved data baseline is unavailable. Reload before deleting it.");
      await remote.api.savedQueryDelete(id, expectedQuery); assertActive(); committedValues.delete(id);
    } }]) : remote.api.savedQueryDelete(id, authored);
    },
    definitionBundleSave: (bundle: Bundle) => {
      const submitted = structuredClone(bundle);
      return shouldStage() ? enqueueLocal(client => client.api.definitionBundleSave(submitted), () => [definitionEntry(submitted)])
        : remote.api.definitionBundleSave(submitted);
    },
    locusViewUpdate: (id: string, patch: Parameters<ApiClient["api"]["locusViewUpdate"]>[1]) => {
      const submitted = structuredClone(patch);
      let changedIds: string[] = [];
      return shouldStage() ? enqueueLocal((client, current) => {
        // The existing list endpoint checks its root CAS when a view is
        // supplied. Carry the exact retained view for a name-only edit too.
        submitted.view ??= structuredClone(current.root().lists.find(list => list.id === id)?.view);
        changedIds = current.project<string[]>("browserDataListDirtyIds", current.state(), id, submitted);
        return client.api.locusViewUpdate(id, submitted);
      }, () => [{ ids: [id, ...changedIds], async replay(this: JournalEntry) {
        const response = await remote.api.locusViewUpdate(id, { ...submitted, expectedRootRevision: committedRoot!.revision });
        assertActive();
        // Only a write's own acknowledgement can advance the root CAS baseline.
        const revision = response.root?.revision ?? response.locusView?.rootRevision;
        if (typeof revision !== "number") throw new Error("The server did not acknowledge the saved list revision.");
        committedRoot = { ...committedRoot!, revision };
        this.writtenRootRevision = revision;
      } }]) : remote.api.locusViewUpdate(id, submitted);
    },
    dispatchInstanceCreate: (input: InstanceCreate) => {
      const submitted = structuredClone(input);
      if (!shouldStage()) return remote.api.dispatchInstanceCreate(submitted).then(result => {
        if (result.definition?.id) authoredInstances.set(result.definition.id, structuredClone(result.definition));
        return result;
      });
      assertRepresentationStaging();
      return enqueueLocal(client => client.api.dispatchInstanceCreate(submitted), result => [createdInstanceEntry(result.dispatchInstance.id, submitted)]);
    },
    dispatchInstanceUpdate: (id: string, instance: Record<string, unknown>, valueEncoding?: InstanceJsonEncoding,
      expectedInstance?: Record<string, unknown>) => {
      const submitted = structuredClone(instance), authored = expectedInstance && structuredClone(expectedInstance);
      if (shouldStage()) assertRepresentationStaging();
      return shouldStage() ? enqueueLocal(client => client.api.dispatchInstanceUpdate(id, submitted, valueEncoding), () => [instanceEntry(id, submitted, valueEncoding, authored)])
        : remote.api.dispatchInstanceUpdate(id, submitted, valueEncoding, authored).then(result => {
          if (result.definition?.id) authoredInstances.set(result.definition.id, structuredClone(result.definition));
          return result;
        });
    },
    dispatchInstanceDelete: (id: string, expectedInstance?: Record<string, unknown>) => {
      const authored = expectedInstance && structuredClone(expectedInstance);
      if (shouldStage()) assertRepresentationStaging();
      return shouldStage() ? enqueueLocal(client => client.api.dispatchInstanceDelete(id), () => {
        const originallyRead = !touchedInstances.has(id) ? authoredInstances.get(id) : undefined;
        touchedInstances.add(id);
        return [{ ids: [id], async replay() {
      const baseline = committedInstances.get(id);
      if (!baseline) throw new Error("The representation baseline is unavailable. Reload before deleting it.");
      const { instanceFromJsonWire } = await import("@fenel/engine/authoring/type");
      const original = originallyRead && instanceFromJsonWire(originallyRead.instance, baseline.registry, undefined, originallyRead.valueEncoding);
      await remote.api.dispatchInstanceDelete(id, authored ?? original ?? baseline.instance); assertActive(); committedInstances.delete(id);
    } }];
      }) : remote.api.dispatchInstanceDelete(id, authored).then(result => { authoredInstances.delete(id); return result; });
    },
  };
  const liveOperations = new Set(["invokeIOAction", "resolveAwaitingPrompt", "runRecordQuery", "runCompareQuery", "runFunnelQuery"]);
  const readOperations = new Set(["entityInstanceList", "listAwaitingPrompts", "getIOInstances", "getIOLastResult", "readerMetadata"]);
  const api = new Proxy(remote.api, { get(target, name) {
    if (typeof name !== "string" || name === "then") return Reflect.get(target, name);
    if (name in mutationApi) return Reflect.get(mutationApi, name);
    const method = Reflect.get(target, name);
    if (typeof method !== "function") return method;
    if (name === "readerMetadata") return (...args: unknown[]) => overlay()
      ? Reflect.apply(Reflect.get(local!.api, name), local!.api, args) : Reflect.apply(method, target, args);
    if (liveOperations.has(name) || readOperations.has(name)) return (...args: unknown[]) => { assertActive(); return Reflect.apply(method, target, args); };
    return (...args: unknown[]) => { assertActive(); return shouldStage() ? refused(name) : Reflect.apply(method, target, args); };
  } });
  const endpointReads = new Set(["getLocusRoot", "getSavedQueries", "getLocusViews", "getTypes", "getFunctions", "getBrowseTypes",
    "getBrowseFunctions", "getTypeByName", "getFunctionByName", "getDispatchInstances", "getFieldFacetInstances",
    "getFieldAuthoringCatalog", "getFieldAuthoringIdentity", "getFieldResurrectionCatalog"]);
  const queryMethods = new Map<string, Function>();
  const rememberReadInstances = <T>(response: T): T => {
    const payload = response as { dispatchInstances?: RepresentationReceipt[]; specInstances?: RepresentationReceipt[] };
    for (const row of payload.dispatchInstances ?? payload.specInstances ?? []) {
      if (row.id && row.instance && !authoredInstances.has(row.id)) authoredInstances.set(row.id, structuredClone(row));
    }
    return response;
  };
  const client = new Proxy(remote, { get(target, name) {
    if (name === "drafts") return drafts;
    if (name === "api") return api;
    if (name === "dispose") return () => {
      if (!active) return;
      active = false; unregister?.(); local?.dispose(); source?.dispose(); remote.dispose();
    };
    if (name === "editLocusRoot") return (id: string, revision: number, command: LocusRootCommand) => {
      const submitted = structuredClone(command);
      return shouldStage() ? enqueueLocal(current => current.editLocusRoot(id, revision, submitted), () => [rootEntry(submitted)])
        : remote.editLocusRoot(id, revision, submitted);
    };
    if (name === "editSavedValue") return (id: string, query: Record<string, unknown>, revision: number, occurrence?: LocusRootCommand,
      expectedQuery?: Record<string, unknown>) => {
      const submitted = structuredClone(query), item = occurrence && structuredClone(occurrence), baseline = expectedQuery && structuredClone(expectedQuery);
      return enqueueLocal(current => current.editSavedValue!(id, submitted, revision, item), () => [savedEntry(id, { query: submitted, expectedQuery: baseline }),
        ...(item ? [rootEntry(item)] : [])]);
    };
    if (name === "editDefinitionAndData") return (bundle: Bundle, revision: number,
      mutation: { occurrence?: LocusRootCommand; savedValue?: { id: string; query: Record<string, unknown>; expectedQuery?: Record<string, unknown> } } = {}) => {
      // Staged drafts journal no representation entry: refuse instead of dropping one.
      if ((mutation as { representations?: unknown[] }).representations?.length) {
        return Promise.reject(new Error("Save this definition before changing its representations."));
      }
      const submitted = structuredClone(bundle), data = structuredClone(mutation);
      return enqueueLocal(current => current.editDefinitionAndData!(submitted, revision, data), () => [definitionEntry(submitted),
        ...(data.savedValue ? [savedEntry(data.savedValue.id, { query: data.savedValue.query, expectedQuery: data.savedValue.expectedQuery })] : []),
        ...(data.occurrence ? [rootEntry(data.occurrence)] : [])]);
    };
    if (name === "writeDispatchInstances") return (writes: Parameters<NonNullable<ApiClient["writeDispatchInstances"]>>[0],
      revision: number, registry?: ModuleRegistry) => {
      const submitted = structuredClone(writes);
      if (!shouldStage()) return (async () => {
        for (const write of submitted) {
          assertActive();
          if (write.existingId === undefined) await mutationApi.dispatchInstanceCreate(write);
          else await mutationApi.dispatchInstanceUpdate(write.existingId, write.instance, write.valueEncoding);
        }
      })();
      assertRepresentationStaging();
      let created: string[] = [];
      return enqueueLocal(async (current, currentSource) => {
        const prior = new Set(currentSource.state().representations.map(entry => entry.id));
        await current.writeDispatchInstances!(submitted, revision, registry);
        created = currentSource.state().representations.filter(entry => !prior.has(entry.id)).map(entry => entry.id);
      }, () => {
        let index = 0;
        return submitted.map(write => write.existingId === undefined
          ? createdInstanceEntry(created[index++]!, write)
          : instanceEntry(write.existingId, write.instance, write.valueEncoding));
      });
    };
    if (name === "apiRead" || name === "apiFetch") return (path: string, init?: RequestInit) => {
      assertActive();
      if (name === "apiFetch" && init?.method && init.method !== "GET") return shouldStage()
        ? refused(path) : remote.apiFetch(path, init);
      const endpoint = new URL(path, "https://reader.invalid").pathname;
      const stagedRead = endpoint === "/locus-root" || endpoint === "/saved-queries" || endpoint === "/dispatch-instances"
        || endpoint.startsWith("/definition-bundles") || endpoint === "/types" || endpoint === "/functions"
        || endpoint === "/reader-metadata/targets";
      if (overlay() && stagedRead) return local!.apiRead(path);
      const response = remote.apiRead(path);
      return endpoint === "/dispatch-instances" ? response.then(rememberReadInstances) : response;
    };
    if (typeof name === "string" && endpointReads.has(name)) {
      if (queryMethods.has(name)) return queryMethods.get(name);
      const original = Reflect.get(target, name);
      const invoke = (...args: unknown[]) => {
        assertActive(); const staged = overlay();
        const response = Reflect.get(staged ? local! : target, name)(...args);
        return !staged && name === "getDispatchInstances" ? Promise.resolve(response).then(rememberReadInstances) : response;
      };
      const fn = Object.assign(invoke, { key: original.key, keyFor: (...args: unknown[]) => original.keyFor?.(...args) ?? [name, args],
        uncached: (...args: unknown[]) => {
          assertActive(); const staged = overlay(), selected = Reflect.get(staged ? local! : target, name);
          const response = (selected.uncached ?? selected)(...args);
          return !staged && name === "getDispatchInstances" ? Promise.resolve(response).then(rememberReadInstances) : response;
        } });
      queryMethods.set(name, fn); return fn;
    }
    return Reflect.get(target, name);
  } }) as DraftClient;
  return client;
}
