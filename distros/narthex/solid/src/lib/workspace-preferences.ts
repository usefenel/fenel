import { createSignal, flush as flushSolid } from "solid-js";
import { createAccountApiClient, type ApiClient } from "./api";
import { assertCurrentSession, sessionEpoch } from "./browser-session";
import { loadWorkspaceBootstrap, type WorkspaceBootstrap } from "./auth";
import { loadWorkspaceModel } from "./workspace-model-loader";
import { preloadWorkspaceSlice } from "./workspace-module-preload";
import { workspaceExpression, type WorkspaceCommand, type WorkspacePreferences, type ReadyWorkspaceBootstrap } from "./workspace-wire";
import type { LocusRootData } from "./locus-root-data";
import { loadPublicBootstrap } from "./public-bootstrap";
import type { LocusSynchronization } from "./locus-synchronization";
import { draftValueFingerprint } from "./native-draft";
import { assertAllDataRootSources } from "./all-data-root";
import { captureRegistryTransportObservation, registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import type { LocalOrdinaryOperation, LocalOrdinaryResult, WorkspaceRenderPacket } from "./local-ordinary-operations";

export type WorkspaceOrdinaryOperate = <O extends LocalOrdinaryOperation>(operation: O,
  options?: { signal?: AbortSignal; assertCurrent?: () => void }) => Promise<LocalOrdinaryResult<O>>;
type WorkspaceOrdinarySource = { epoch: number; ordinary: <O extends LocalOrdinaryOperation>(operation: O,
  signal?: AbortSignal) => Promise<LocalOrdinaryResult<O>> };
type WorkspacePreferencesOptions = { ordinarySource?: (epoch: number) => Promise<WorkspaceOrdinarySource> };

/** Personal preferences keep their existing revision protocol. A server-checked
 * literal snapshot can paint before the complete browser evaluator is ready. */
export async function loadWorkspacePreferences(accountId: string | undefined, epoch = sessionEpoch(), bootstrap?: WorkspaceBootstrap,
  signal?: AbortSignal, options: WorkspacePreferencesOptions = {}) {
  assertCurrentSession(epoch);
  if (bootstrap && (bootstrap.accountId !== accountId || bootstrap.epoch !== epoch)) {
    throw new Error("The session changed while loading your data. Please retry.");
  }
  let client: ApiClient | undefined;
  let sharedClient: ApiClient | undefined;
  let root: LocusRootData | undefined;
  let allDataRoot: LocusRootData | undefined;
  let itemId: string | undefined;
  let initial!: WorkspacePreferences;
  let draft!: WorkspacePreferences;
  let initialProjection: ReadyWorkspaceBootstrap | undefined;
  let closed = false;
  let lifecycle = 0;
  const abort = new AbortController();
  const close = () => { closed = true; lifecycle++; abort.abort(); client?.dispose(); signal?.removeEventListener("abort", close); };
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  const assertActive = () => { abort.signal.throwIfAborted(); assertCurrentSession(epoch); };
  const [prepared, setPrepared] = createSignal(false);
  const [modelError, setModelError] = createSignal<string>();
  let isPrepared = false;
  let preparing: Promise<void> | undefined;
  let sourceFlight: Promise<WorkspaceOrdinarySource> | undefined;
  let width = typeof window === "undefined" ? 1024 : window.innerWidth;
  const assertLifetime = (expectedEpoch: number, expectedLifecycle: number) => {
    assertActive();
    if (closed || epoch !== expectedEpoch || lifecycle !== expectedLifecycle) throw new Error("These lenses changed while this request was in flight.");
  };
  const operate: WorkspaceOrdinaryOperate = async (operation, request = {}) => {
    const requestedEpoch = epoch, requestedLifecycle = lifecycle;
    const graph = captureRegistryTransportObservation(operation, "lens operation");
    if (graph.kind !== "captured") throw new Error(graph.reason);
    const assertCurrent = () => {
      assertLifetime(requestedEpoch, requestedLifecycle); request.signal?.throwIfAborted(); request.assertCurrent?.();
      graph.assertCurrent();
    };
    try {
    assertCurrent();
    if (!sourceFlight) {
      const flight = (async () => {
        if (options.ordinarySource) {
          assertCurrent();
          const source = await options.ordinarySource(requestedEpoch);
          assertCurrent();
          if (source.epoch !== requestedEpoch) throw new Error("The Local data source belongs to another session.");
          return source;
        }
        const local = await import("./local-locus-data");
        // A delayed import must not acquire a source for a retired display.
        assertCurrent();
        const source = local.localTabDataSource();
        assertCurrent();
        if (source.epoch !== requestedEpoch) throw new Error("The Local data source belongs to another session.");
        return { epoch: source.epoch, ordinary: source.ordinary.bind(source) };
      })();
      sourceFlight = flight;
      void flight.catch(() => { if (sourceFlight === flight) sourceFlight = undefined; });
    }
    const source = await sourceFlight;
    assertCurrent();
    if (source.epoch !== requestedEpoch) throw new Error("The Local data source belongs to another session.");
    const result = await source.ordinary(operation, request.signal ? AbortSignal.any([abort.signal, request.signal]) : abort.signal);
    assertCurrent();
    return result;
    } finally { graph.release(); }
  };
  async function select(data: LocusRootData) {
    await loadWorkspaceModel();
    assertActive();
    const evaluator = await preloadWorkspaceSlice("your saved lenses", () => import("./workspace-preferences-evaluation"));
    const selected = evaluator.selectWorkspacePreferences(data);
    assertActive();
    return selected;
  }
  try {
    assertActive();
    if (accountId) {
      bootstrap ??= await loadWorkspaceBootstrap(accountId, { epoch, signal: abort.signal });
      assertActive();
      client = createAccountApiClient(bootstrap.personalAccountId, { epoch });
      root = bootstrap.root;
      allDataRoot = bootstrap.allDataRoot;
      const personalAccountId = bootstrap.personalAccountId;
      if (allDataRoot) assertAllDataRootSources(allDataRoot, ["public", "local", ...bootstrap.accounts
        .filter(account => account.accountId !== personalAccountId || account.accountId === accountId)
        .map(account => account.accountId)]);
      let selected = bootstrap.workspace;
      if (selected?.status === "ready") {
        if (!selected.itemId) {
          const id = crypto.randomUUID();
          try {
            root = (await client.editLocusRoot(root.id, root.revision, { kind: "append", item: {
              id, caption: "Lens settings", source: { kind: "expr", expr: workspaceExpression(selected.value) }, valueType: selected.valueType,
            } })).root;
            selected = { ...selected, itemId: id };
          } catch (problem) {
            if (!(problem && typeof problem === "object" && "status" in problem && problem.status === 409)) throw problem;
            bootstrap = await loadWorkspaceBootstrap(accountId, { epoch, signal: abort.signal });
            root = bootstrap.root;
            selected = bootstrap.workspace;
            if (selected?.status === "ready" && !selected.itemId) throw new Error("Could not save your lens settings. Please retry.");
          }
        }
      }
      if (selected?.status === "ready") {
        initial = selected.value; itemId = selected.itemId; initialProjection = selected;
      } else {
        const ready = await loadWorkspaceModel();
        assertActive();
        let existing = await select(root);
        if (!existing) {
          const value = ready.defaultWorkspace(accountId);
          const id = crypto.randomUUID();
          try {
            root = (await client.editLocusRoot(root.id, root.revision, { kind: "append", item: {
              id, caption: "Lens settings", source: { kind: "expr", expr: workspaceExpression(value) }, valueType: ready.workspaceValueType(),
            } })).root;
          } catch (problem) {
            if (!(problem && typeof problem === "object" && "status" in problem && problem.status === 409)) throw problem;
            client.revalidate("locusRoot"); root = (await client.getLocusRoot.uncached()).root;
          }
          existing = await select(root);
          if (!existing) throw new Error("Could not save your lens settings. Please retry.");
        }
        initial = existing.value; itemId = existing.id;
      }
    } else {
      const publicData = await loadPublicBootstrap();
      initial = publicData.workspace.value;
      initialProjection = publicData.workspace;
      allDataRoot = publicData.allDataRoot;
    }
    assertActive();
  draft = initial;
  const initialPacket: WorkspaceRenderPacket = initialProjection ? {
    $tag: "WorkspaceBootstrapPlan", value: initial, itemId: itemId ? { $tag: "Just", _0: itemId } : { $tag: "Nothing" },
    visibleLenses: initialProjection.visibleLenses, activeLens: initialProjection.activeLens,
    tilePlan: initialProjection.tilePlan, presentations: initialProjection.presentations,
  } : await operate({ kind: "workspaceRenderPublication", args: [initial, itemId ? { $tag: "Just", _0: itemId } : { $tag: "Nothing" }, width] });
  const [publication, setPublication] = createSignal({ value: initial, packet: initialPacket });
  const value = () => publication().value;
  const projection = () => publication().packet;
  const [saving, setSaving] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let synchronization: LocusSynchronization | undefined;
  let savedValue = initial;
  let savedSource = root?.items.find(item => item.id === itemId)?.source;
  let stagedSource: typeof savedSource;
  let queued: WorkspaceCommand[] = [];
  let running: Promise<boolean> | undefined;
  let mutationTail: Promise<unknown> = Promise.resolve();
  let mutationBarrier: Promise<unknown> = mutationTail;
  let admitted = 0;
  const cancelled = {};
  const refreshPending = () => { setPending(!!client && (queued.length > 0 || admitted > 0)); flushSolid(); };
  const capture = <T,>(input: T) => {
    const graph = captureRegistryTransportObservation(input, "lens publication");
    if (graph.kind !== "captured") throw new Error(graph.reason);
    return graph;
  };
  const publish = (next: WorkspacePreferences, packet: WorkspaceRenderPacket, assertCurrent: () => void, ready = false) => {
    assertCurrent();
    if (packet.value !== next) throw new Error("The lens render packet lost its preference input pairing.");
    draft = next;
    setPublication({ value: next, packet });
    if (ready) { isPrepared = true; setPrepared(true); setModelError(undefined); }
    // Imperative callers acknowledge navigation after the typed publication.
    flushSolid();
  };
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const flight = mutationTail.then(work);
    mutationTail = flight.then(() => {}, () => {});
    return flight;
  };
  const packetFor = (next: WorkspacePreferences, assertCurrent: () => void) => operate({ kind: "workspaceRenderPublication",
    args: [next, itemId ? { $tag: "Just", _0: itemId } : { $tag: "Nothing" }, width] }, { assertCurrent });
  async function preparePublication(next: WorkspacePreferences, assertCurrent: () => void, selectedItemId = itemId): Promise<void> {
    const verdict = await operate({ kind: "validateWorkspacePreferences", args: [next] }, { assertCurrent });
    if (verdict.$tag !== "Ok") throw new Error(String(verdict._0));
    const packet = await operate({ kind: "workspaceRenderPublication",
      args: [next, selectedItemId ? { $tag: "Just", _0: selectedItemId } : { $tag: "Nothing" }, width] }, { assertCurrent });
    publish(next, packet, assertCurrent, true);
  }
  function prepare(): Promise<void> {
    assertActive();
    if (isPrepared) return Promise.resolve();
    if (preparing) return preparing;
    const requestedEpoch = epoch, requestedLifecycle = lifecycle;
    const flight = enqueue(async () => {
      const graph = capture(draft);
      const assertCurrent = () => { assertLifetime(requestedEpoch, requestedLifecycle); graph.assertCurrent(); };
      try {
        await preparePublication(draft, assertCurrent);
      } finally { graph.release(); }
    });
    preparing = flight;
    void flight.catch(problem => {
      if (!closed && lifecycle === requestedLifecycle) { setModelError(problem instanceof Error ? problem.message : String(problem)); flushSolid(); }
    }).finally(() => { if (preparing === flight) preparing = undefined; });
    return flight;
  }
  function planUpdate(planner: (current: WorkspacePreferences, invoke: WorkspaceOrdinaryOperate) =>
    readonly WorkspaceCommand[] | Promise<readonly WorkspaceCommand[]>, guard?: () => boolean): Promise<boolean> {
    return plan(planner, guard);
  }
  async function plan(planner: (current: WorkspacePreferences, invoke: WorkspaceOrdinaryOperate) =>
    readonly WorkspaceCommand[] | Promise<readonly WorkspaceCommand[]>, guard?: () => boolean,
    assertOwned?: () => void): Promise<boolean> {
    assertActive();
    const requestedEpoch = epoch, requestedLifecycle = lifecycle;
    admitted++;
    const flight = enqueue(async () => {
      const graphs: Array<ReturnType<typeof capture>> = [];
      // A caller's guard may throw its own retirement (an address opening
      // whose reader changed). That intent retired: nothing was published, and
      // the caller owns the exception. It is not a lens-settings failure.
      let guardRetired = false;
      const assertCurrent = () => {
        assertOwned?.();
        if (guard) {
          let current: boolean;
          try { current = guard(); } catch (problem) { guardRetired = true; throw problem; }
          if (!current) throw cancelled;
        }
        if (lifecycle !== requestedLifecycle) throw cancelled;
        assertLifetime(requestedEpoch, requestedLifecycle);
        for (const graph of graphs) graph.assertCurrent();
      };
      try {
        assertCurrent();
        const current = draft; graphs.push(capture(current));
        const invoke: WorkspaceOrdinaryOperate = (operation, request = {}) => operate(operation, { ...request,
          assertCurrent: () => { assertCurrent(); request.assertCurrent?.(); } });
        const commands = await planner(current, invoke);
        assertCurrent(); graphs.push(capture(commands));
        const verdict = await invoke({ kind: "applyWorkspaceCommands", args: [current, commands] });
        if (verdict.$tag !== "Ok") throw new Error(String(verdict._0));
        const next = verdict._0; graphs.push(capture(next));
        const packet = await packetFor(next, assertCurrent);
        assertCurrent(); graphs.push(capture(packet));
        publish(next, packet, assertCurrent, true);
        if (client) queued.push(...commands);
        setError(undefined); flushSolid();
        if (client) queueMicrotask(() => { if (!error() && synchronization?.enabledNow() !== false) void flush(false); });
        return true;
      } catch (problem) {
        if (problem === cancelled || lifecycle !== requestedLifecycle) return false;
        if (guardRetired) throw problem;
        setError(problem instanceof Error ? problem.message : String(problem)); flushSolid(); throw problem;
      } finally { for (const graph of graphs) graph.release(); admitted--; refreshPending(); }
    });
    mutationBarrier = flight;
    refreshPending();
    return flight;
  }
  async function update(commands: readonly WorkspaceCommand[], guard?: () => boolean): Promise<boolean> {
    // Capture commands at admission, before another queued edit can delay them.
    const graph = capture(commands);
    try {
      graph.assertCurrent();
      const owned = registryTransportSnapshot(commands, "lens commands", "value-read");
      graph.assertCurrent();
      return plan(() => owned, guard, () => graph.assertCurrent()).finally(() => graph.release());
    } catch (problem) { graph.release(); throw problem; }
  }

  async function flush(explicit = true): Promise<boolean> {
    if (closed) return false;
    const barrier = mutationBarrier, requestedLifecycle = lifecycle;
    try { await barrier; } catch { return false; }
    if (closed || lifecycle !== requestedLifecycle) return false;
    if (running) return explicit ? running.then(saved => saved && queued.length ? flush(true) : saved) : running;
    if (!client || queued.length === 0) return true;
    setSaving(true); flushSolid();
    const work = async () => {
      try {
        while (queued.length) {
          if (!explicit && synchronization?.enabledNow() === false) break;
          assertCurrentSession(epoch);
          const count = queued.length;
          const writtenValue = draft;
          const target = sharedClient ?? client!;
          target.signal.throwIfAborted();
          if (sharedClient) {
            const latest = (await target.getLocusRoot.uncached()).root;
            assertActive();
            const latestSource = latest.items.find(item => item.id === itemId)?.source;
            // The wrapper may advance over disjoint data changes. It cannot
            // adopt somebody else's changed lens occurrence as our baseline.
            if (latest.id !== root!.id || !latestSource
              || draftValueFingerprint(latestSource) !== draftValueFingerprint(savedSource)
                && (!stagedSource || draftValueFingerprint(latestSource) !== draftValueFingerprint(stagedSource))) {
              throw new Error("Your lens settings changed in another tab. Your changes are kept here. Reload the saved settings to resolve the difference.");
            }
            root = latest;
          }
          const existing = root!.items.find(item => item.id === itemId);
          if (!existing) throw new Error("Your saved lens settings were removed. Reload before continuing.");
          const submittedSource = { kind: "expr" as const, expr: workspaceExpression(writtenValue) };
          const valueType = initialProjection?.valueType ?? await operate({ kind: "workspaceValueType", args: [] });
          root = (await target.editLocusRoot(root!.id, root!.revision, { kind: "replace", itemId: itemId!, item: {
            ...existing, source: submittedSource, valueType,
          } })).root;
          stagedSource = submittedSource;
          while (target.drafts?.pending()) {
            if (!explicit && synchronization?.enabledNow() === false) break;
            if (!await target.drafts.save()) throw new Error(target.drafts.error() ?? "Your lens settings could not be saved.");
          }
          if (target.drafts?.pending()) break;
          if (sharedClient) root = (await target.getLocusRoot.uncached()).root;
          savedValue = writtenValue;
          savedSource = submittedSource; stagedSource = undefined;
          queued.splice(0, count);
          refreshPending();
        }
        setError(undefined); flushSolid();
        return true;
      } catch (problem) {
        setError(problem && typeof problem === "object" && "status" in problem && problem.status === 409
          ? "Your lens settings changed in another tab. Your changes are kept here. Reload the saved settings to resolve the difference."
          : problem instanceof Error ? problem.message : String(problem));
        flushSolid(); return false;
      } finally { running = undefined; setSaving(false); flushSolid(); }
    };
    running = Promise.resolve().then(work);
    return running;
  }

  return {
    value, saving, pending, error, prepared, modelError, prepare, projection, operate, update, planUpdate,
    isCurrentSession: (expectedEpoch: number) => !closed && !abort.signal.aborted && epoch === expectedEpoch && epoch === sessionEpoch(),
    allDataRoot, persistent: !!client, flush,
    rebindPublicSession(nextEpoch: number) {
      // The anonymous lens draft contains ordinary browser data. Its reader
      // clients are replaced separately; an account preference store can never
      // adopt another session through this display-only continuation.
      if (accountId) throw new Error("Account lens settings belong to their original session.");
      assertCurrentSession(nextEpoch);
      if (nextEpoch === epoch) return;
      lifecycle++; epoch = nextEpoch; sourceFlight = undefined; preparing = undefined;
      isPrepared = false; setPrepared(false); setModelError(undefined); flushSolid();
    },
    setSynchronization: (controller: LocusSynchronization) => { synchronization = controller; },
    setClient(next: ApiClient) {
      if (client && next.accountId === client.accountId && next.drafts) sharedClient = next;
    },
    async discard(): Promise<boolean> {
      if (closed || running) return false;
      assertActive();
      const requestedEpoch = epoch, requestedLifecycle = ++lifecycle;
      sourceFlight = undefined; preparing = undefined;
      const flight = enqueue(async () => {
        const next = savedValue, graph = capture(next);
        const assertCurrent = () => { assertLifetime(requestedEpoch, requestedLifecycle); graph.assertCurrent(); };
        try {
          await preparePublication(next, assertCurrent);
          queued = []; stagedSource = undefined; setError(undefined); refreshPending();
          return true;
        } finally { graph.release(); }
      });
      mutationBarrier = flight; return flight;
    },
    personalAccountId: bootstrap?.personalAccountId,
    dispose: close,
    resize(nextWidth: number): Promise<void> {
      width = nextWidth;
      const requestedEpoch = epoch, requestedLifecycle = lifecycle;
      return enqueue(async () => {
        const current = draft, graph = capture(current);
        const assertCurrent = () => { assertLifetime(requestedEpoch, requestedLifecycle); graph.assertCurrent(); };
        try { const packet = await packetFor(current, assertCurrent); publish(current, packet, assertCurrent); }
        finally { graph.release(); }
      });
    },
    async reload() {
      if (!client || running || closed) return;
      assertActive();
      const requestedEpoch = epoch, requestedLifecycle = ++lifecycle;
      sourceFlight = undefined; preparing = undefined;
      const flight = enqueue(async () => {
        const assertCurrent = () => assertLifetime(requestedEpoch, requestedLifecycle);
        client!.revalidate("locusRoot");
        const loaded = (await client!.getLocusRoot.uncached()).root;
        assertCurrent();
        const existing = await select(loaded);
        assertCurrent();
        if (!existing) throw new Error("Your saved lens settings are no longer available.");
        const graph = capture(existing.value);
        try {
          const check = () => { assertCurrent(); graph.assertCurrent(); };
          await preparePublication(existing.value, check, existing.id);
          root = loaded; itemId = existing.id; queued = []; savedValue = existing.value;
          savedSource = loaded.items.find(item => item.id === itemId)?.source; stagedSource = undefined;
          setError(undefined); refreshPending();
        } finally { graph.release(); }
      });
      mutationBarrier = flight; return flight;
    },
  };
  } catch (error) { close(); throw error; }
}

export type WorkspacePreferencesStore = Awaited<ReturnType<typeof loadWorkspacePreferences>>;
