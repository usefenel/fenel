// C2 browser harness: the source, registry, worker, reader and universal Home
// editor are production code. Only HTML/auth/network and pane callbacks belong
// to this fixture. Full source selection/lens layout are checked in /app.
import { Errored, Loading, createSignal, flush, onSettled } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import HomePage from "../routes/app/home";
import { startLocalReaderRuntime, ReaderRuntimeProvider, type ReaderRuntime } from "./reader-runtime";
import { createBrowserDataSource, localTabDataSource } from "./local-locus-data";
import { createReaderDraftClient } from "./reader-draft-client";
import { createLocusSynchronization, LocusSynchronizationContext, type LocusSynchronization } from "./locus-synchronization";
import { createReaderPresentation } from "./reader-presentation";
import type { ApiClient } from "./api";
import { _setSubject, subject } from "./auth";
import { sessionEpoch, expireBrowserSession } from "./browser-session";
import { ConfirmModalHost } from "./confirm-modal";
import { createLocusNotificationCenter, LocusNotificationContext, LocusNotificationHost } from "./locus-notifications";
import { DataInspectionControls, type DataInspectionMode } from "./DataInspectionDialog";
import type { HomeAction } from "./home-action";
import type { LocusScope } from "./locus-scope";
import type { LocusLayoutChoice } from "./locus-layout-options";
import type { WorkspaceLensOpenMode, WorkspacePane } from "./workspace-pane";
import { addToLocus } from "./locus-view-model";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import "../global.css";
import "../routes/app.css";
import "./home-entry.css";
import "./workspace-surface.css";

type NetworkRequest = { method: string; path: string; allowed: boolean };
const networkRequests: NetworkRequest[] = [];
const failures: string[] = [];
const lensRequests: Array<{ scope: LocusScope; mode?: WorkspaceLensOpenMode }> = [];
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const allowed = method === "GET" && url.pathname === "/api/auth/me";
  networkRequests.push({ method, path: url.pathname, allowed });
  if (allowed) return Response.json({ subject: { $tag: "Anonymous" } });
  throw new Error(`Local source fixture refused unexpected API request: ${method} ${url.pathname}`);
}) as unknown as typeof globalThis.fetch;

let runtime: ReaderRuntime | undefined;
let rendering: (() => void) | undefined;
let readerAbort: AbortController | undefined;
let setFocus: ((scope: LocusScope) => void) | undefined;
let setMode: ((mode: DataInspectionMode) => void) | undefined;
let stage = "Not mounted";
let generation = 0;
let synchronization: LocusSynchronization | undefined;
let memoryRootRevision = 0;
const memoryWrites: Array<{ name: string; args: unknown[] }> = [];
let draftIds: { main: string; reference: string } | undefined;

async function addFixtureValue(client: ApiClient, expr: ExprNode, options: { name?: string; valueType?: FenelType } = {}) {
  const result = await client.api.savedQueryCreate({ slug: crypto.randomUUID(), name: options.name,
    query: { kind: "expression", expr, ...(options.valueType ? { valueType: options.valueType } : {}) } });
  const id = result.query?.id;
  if (typeof id !== "string") throw new Error("The actual local source did not return its saved identity.");
  if (!await addToLocus({ savedExprId: id, valueType: options.valueType }, options.name, undefined, client)) {
    throw new Error("The actual local value could not be pinned.");
  }
  return id;
}

/** C2 transport fixture only: the account-shaped reader keeps the already
 * checked anonymous frame. No account authority, HTTP or definitions are tested.
 * Saved-query writes and root CAS have separate server versions, unlike a tab's
 * single source revision. Every memory edit still uses the actual Fenel holder. */
function draftRuntime(prepared: ReaderRuntime): ReaderRuntime {
  const source = localTabDataSource();
  const captured = source.snapshot();
  const original = prepared.client;
  memoryRootRevision = source.revision();
  memoryWrites.length = 0;
  synchronization = createLocusSynchronization();
  const sync = synchronization;
  const root = () => ({ ...source.root(), revision: memoryRootRevision, persisted: true, name: "Memory source" });
  const rootRead = Object.assign(async () => ({ root: root() }), original.getLocusRoot,
    { uncached: async () => ({ root: root() }) });
  const remoteApi = new Proxy(original.api, {
    get(target, name) {
      const operation = Reflect.get(target, name);
      if (typeof operation !== "function") return operation;
      if (!/Create|Update|Delete|Save|Patch|Write/.test(String(name))) return operation.bind(target);
      return async (...args: unknown[]) => {
        memoryWrites.push({ name: String(name), args: structuredClone(args) });
        if (name === "savedQueryCreate") {
          if ((args[0] as { id?: string }).id) throw new Error("This fixture edits existing saved data only.");
          return operation(...args);
        }
        if (name === "savedQueryUpdate") {
          const [id, submitted] = args as [string, Record<string, unknown>];
          const { expectedQuery, ...patch } = submitted;
          const current = source.state().values.find(row => row.id === id)?.value.query;
          // Bounded fixture oracle: String literal/ref expressions only. The
          // production account endpoint's native equality is tested separately.
          if (expectedQuery && JSON.stringify(expectedQuery) !== JSON.stringify(current)) {
            throw new Error("The memory server's saved-data baseline changed.");
          }
          return operation(id, patch);
        }
        throw new Error(`C2 existing-data fixture refused unsupported write: ${String(name)}`);
      };
    },
  });
  const remote: ApiClient = { ...original, accountId: source.id, api: remoteApi,
    getLocusRoot: rootRead,
    editLocusRoot: async (id, revision, command) => {
      memoryWrites.push({ name: "editLocusRoot", args: structuredClone([id, revision, command]) });
      if (revision !== memoryRootRevision) throw new Error("The memory server's root baseline changed.");
      const response = await original.editLocusRoot(id, source.revision(), command);
      memoryRootRevision++;
      return { ...response, root: { ...response.root, revision: memoryRootRevision, persisted: true, name: "Memory source" } };
    },
  };
  const client = createReaderDraftClient(remote, { synchronization: sync,
    createSource: async () => createBrowserDataSource({ id: source.id, epoch: source.epoch, signal: original.signal,
      initial: { ...structuredClone(source.state()), revision: memoryRootRevision }, rootType: source.root().type,
      prepareSnapshot: async (definitions, representations, signal) => {
        signal.throwIfAborted();
        if (representations.length || JSON.stringify(definitions) !== JSON.stringify(source.state().definitions)) {
          throw new Error("C2 existing-data fixture does not admit definition or representation changes.");
        }
        return captured;
      },
      retireSnapshot: () => {},
    }), onDefinitionsChanged: async () => { await source.ready(); },
  });
  const read = () => client.drafts.snapshot() ?? source.snapshot();
  return { ...prepared, kind: "account", accountId: source.id, client,
    registry: () => read().registry, session: () => read().session, functions: () => read().functions,
    types: () => read().types, functionRows: () => read().functionRows, catalog: () => read().catalog,
    revision: () => client.drafts.revision() ?? source.revision(),
    ...createReaderPresentation(read),
    dispose: () => { client.dispose(); prepared.dispose(); },
  };
}

function host(): HTMLElement {
  let element = document.getElementById("fixture");
  if (!element) { element = document.createElement("main"); element.id = "fixture"; document.body.append(element); }
  return element;
}

function unmount() {
  generation++;
  rendering?.(); rendering = undefined;
  readerAbort?.abort(new DOMException("The fixture reader was closed.", "AbortError")); readerAbort = undefined;
  runtime?.dispose(); runtime = undefined;
  setFocus = undefined; setMode = undefined;
  host().replaceChildren();
  stage = "Unmounted; tab source retained";
}

export function renderFixtureReader(prepared: ReaderRuntime, initialAction?: HomeAction, draftMode = false, sync: LocusSynchronization | undefined = synchronization) {
  const target = host();
  const Router = createRouter({ history: memoryHistory("/"), routes: [{ path: "/", component: () => {
    const [focus, publishFocus] = createSignal<LocusScope>({ kind: "root" });
    const [mode, publishMode] = createSignal<DataInspectionMode>("data");
    const [presentation, publishPresentation] = createSignal<LocusLayoutChoice>();
    const [toolbar, publishToolbar] = createSignal<HTMLElement>();
    let flushPane: (() => Promise<boolean>) | undefined;
    setFocus = publishFocus; setMode = publishMode;
    const pane: WorkspacePane = {
      id: "actual-local-fixture-lens", active: () => true, focus, presentation,
      inspectionMode: mode, onInspectionMode: publishMode, toolbarMount: toolbar,
      sourceLabel: () => draftMode ? "Memory source · fixture" : "Local",
      source: () => draftMode ? { $tag: "AccountSource", accountId: prepared.accountId! } : { $tag: "ThisTabSource" },
      accounts: () => [{ id: draftMode ? prepared.accountId! : "local", label: draftMode ? "Memory source · fixture" : "Local" }],
      onFocus: publishFocus, onPresentation: publishPresentation,
      // The production /app layout owns opening additional lenses. Here the
      // callback is observable, never a substitute pane/layout implementation.
      onOpenLens: (scope, mode) => { lensRequests.push(structuredClone({ scope, mode })); },
      onClose: () => { void (async () => { if (!flushPane || await flushPane()) unmount(); })(); },
      onSource: id => { if (id !== "local") throw new Error("Source selection is tested through /app, not this local-reader fixture."); },
      onSubject: () => {},
      registerFlush: next => { flushPane = next; return () => { if (flushPane === next) flushPane = undefined; }; },
    };
    return <LocusSynchronizationContext value={sync ?? null}><ReaderRuntimeProvider runtime={prepared}>
      <div class="dashboard dashboard--home" data-workspace="true" data-bar-mode="DockedBar" data-bar-position="BarTop">
        <main class="main-content main-content--home">
          <div class="workspace-surface">
            <div class="workspace-panes" style="--workspace-columns: 1; --workspace-rows: 1;">
              <section class="workspace-pane workspace-pane--active" data-local-source-fixture="true">
                <header class="workspace-pane__header">
                  <div class="workspace-pane__toolbar-mount" ref={element => onSettled(() => { publishToolbar(element); })} />
                  <DataInspectionControls mode={mode()} onModeChange={publishMode} />
                </header>
                <div class="workspace-pane__body"><HomePage pane={pane} initialAction={initialAction} /></div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </ReaderRuntimeProvider></LocusSynchronizationContext>;
  } }] });
  rendering = render(() => {
    const notifications = createLocusNotificationCenter();
    return <Errored fallback={error => {
      const message = String(error()); failures.push(message);
      return <pre data-fixture-error>{message}</pre>;
    }}><LocusNotificationContext value={notifications}>
      <div class="app-notification-host"><LocusNotificationHost /></div>
      <ConfirmModalHost />
      <Loading fallback={<p>Loading the shared Home renderer…</p>}><Router /></Loading>
    </LocusNotificationContext></Errored>;
  }, target);

  flush();
  return () => { rendering?.(); rendering = undefined; };
}

const fixture = {
  async mount(initialAction?: HomeAction, draftMode = false) {
    unmount();
    const thisMount = generation;
    // An anonymous subject is the only auth fixture. No account or authority
    // string is invented; startLocalReaderRuntime owns the actual frame.
    if (subject()?.$tag !== "Anonymous") _setSubject({ $tag: "Anonymous" });
    failures.length = 0;
    readerAbort = new AbortController();
    const opening = startLocalReaderRuntime({ epoch: sessionEpoch(), signal: readerAbort.signal,
      onStage: detail => { stage = detail; } });
    const target = host();
    target.textContent = "Preparing the actual local reader…";
    const localPrepared = await opening.ready;
    if (draftMode) {
      // This lane edits existing data. Seed it before the controlled server
      // facade, using the fixture's unchanged admitted local creation path.
      const main = await addFixtureValue(localPrepared.client, { kind: "literal", value: "Account B root data" }, { name: "Root value" });
      const reference = await addFixtureValue(localPrepared.client, { kind: "ref", savedExprId: main }, { name: "Live reference" });
      draftIds = { main, reference };
    } else draftIds = undefined;
    const prepared = draftMode ? draftRuntime(localPrepared) : localPrepared;
    if (!draftMode) synchronization = undefined;
    if (thisMount !== generation) { prepared.dispose(); throw new Error("The fixture mount was replaced while preparing."); }
    runtime = prepared;
    target.replaceChildren();
    renderFixtureReader(prepared, initialAction, draftMode);
    stage = "Actual local reader ready";
    flush();
    return fixture.snapshot();
  },
  mountDrafts: () => fixture.mount(undefined, true),
  draftIds: () => structuredClone(draftIds),
  draftStatus: () => structuredClone({ enabled: synchronization?.enabledNow(), pending: runtime?.client.drafts?.pending(),
    error: runtime?.client.drafts?.error(), memoryRootRevision, writes: memoryWrites,
    staged: runtime?.client.drafts?.source()?.state(), committed: localTabDataSource().state() }),
  synchronization: () => synchronization,
  retainedRuntime: () => runtime,
  disposeUi: () => { rendering?.(); rendering = undefined; host().replaceChildren(); },
  clearMemoryWrites: () => { memoryWrites.length = 0; },
  unmount,
  status: () => ({ stage, mounted: !!runtime, epoch: sessionEpoch(), errors: [...failures],
    requests: structuredClone(networkRequests), openedLensRequests: structuredClone(lensRequests) }),
  sourceState: () => structuredClone(localTabDataSource().state()),
  root: () => structuredClone(localTabDataSource().root()),
  snapshot: () => {
    const source = localTabDataSource();
    const checked = source.snapshot();
    return structuredClone({ sourceId: source.id, epoch: source.epoch, revision: source.revision(),
      readerKind: runtime?.kind, clientAccountId: runtime?.client.accountId,
      types: checked.types, functions: checked.functions, functionRows: checked.functionRows,
      definitions: source.state().definitions });
  },
  /** C2: retained ordinary state is compared across the real session door.
   * Authority/worker references are used only for local identity comparisons. */
  async verifyEpochRetention() {
    if (!runtime) throw new Error("Mount the actual local reader first.");
    const oldRuntime = runtime;
    const oldSession = oldRuntime.session();
    const oldAuthority = oldSession.evaluateContext._authority;
    const oldSource = localTabDataSource();
    const before = { sourceId: oldSource.id, epoch: sessionEpoch(), revision: oldSource.revision(),
      data: structuredClone(oldSource.state()) };
    const { authoringWorkerSnapshot } = await import("./expression-runner/authoring-catalog-worker");
    if (runtime !== oldRuntime || sessionEpoch() !== before.epoch) throw new Error("The fixture reader changed before the retention check.");
    const oldWorkerWasReady = !!authoringWorkerSnapshot(oldSession);
    expireBrowserSession(before.epoch);
    flush();
    let oldClientRefused = false;
    try { await oldRuntime.client.getLocusRoot.uncached(); } catch { oldClientRefused = true; }
    const oldReaderGettersRefused = ["registry", "session", "functions", "types", "functionRows", "catalog", "revision"]
      .every(name => { try { oldRuntime[name as "registry"](); return false; } catch { return true; } });
    let oldWorkerRetired = false;
    try { oldWorkerRetired = !authoringWorkerSnapshot(oldSession); } catch { oldWorkerRetired = true; }
    await fixture.mount();
    if (!runtime) throw new Error("The fresh fixture reader was not mounted.");
    const current = localTabDataSource();
    const currentSession = runtime.session();
    const after = { sourceId: current.id, epoch: sessionEpoch(), revision: current.revision(),
      data: structuredClone(current.state()) };
    const checks = { sameSourceId: before.sourceId === after.sourceId,
      sameRevision: before.revision === after.revision,
      sameOrdinaryData: JSON.stringify(before.data) === JSON.stringify(after.data),
      changedEpoch: before.epoch !== after.epoch, oldClientRefused, oldReaderGettersRefused,
      oldWorkerWasReady, oldWorkerRetired, newWorkerReady: !!authoringWorkerSnapshot(currentSession),
      newAuthorityReference: oldAuthority !== undefined && currentSession.evaluateContext._authority !== undefined
        && oldAuthority !== currentSession.evaluateContext._authority };
    if (Object.values(checks).some(ok => !ok)) throw new Error(`The actual local epoch-retention check failed: ${JSON.stringify(checks)}`);
    return { before, after, checks };
  },
  typeDiagnostics(identity: string) {
    if (!runtime) throw new Error("Mount the actual local reader first.");
    const registry = runtime.registry();
    return structuredClone({ entity: registry.getIdentifiedEntity(identity),
      constructors: registry.listConstructorSignatures().filter(row => row.ownerName === identity) });
  },
  focus(scope: LocusScope) { if (!setFocus) throw new Error("Mount the actual local reader first."); setFocus(scope); flush(); },
  inspection(mode: DataInspectionMode) { if (!setMode) throw new Error("Mount the actual local reader first."); setMode(mode); flush(); },
  // Setup convenience uses the same admitted client/Fenel command and actual
  // pin path. Main acceptance creates through the UI instead.
  async addValue(expr: ExprNode, options: { name?: string; valueType?: FenelType } = {}) {
    if (!runtime) throw new Error("Mount the actual local reader first.");
    const id = await addFixtureValue(runtime.client, expr, options);
    return { id, root: fixture.root() };
  },
};

declare global { var localDataFixture: typeof fixture; }
globalThis.localDataFixture = fixture;
