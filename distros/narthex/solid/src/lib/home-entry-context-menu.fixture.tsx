import { Errored, Loading, Show, createEffect, createMemo, createRoot, createSignal, onSettled, untrack } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { createRouter, memoryHistory, query, revalidate as revalidateQuery } from "@solidjs/router";
import HomeEntry from "./home-entry";
import { WorkspaceReadinessContext } from "./workspace-readiness";
import { setBrowserAccountScope, sessionEpoch } from "./browser-session";
import { createAccountApiClient, createPublicApiClient, defaultApiClient, type ApiClient } from "./api";
import { LOCAL_BROWSER_SOURCE_ID } from "./browser-data-storage";
import type { TransferSnapshot } from "./data-transfer/types";
import { WorkspaceRootShelfContext, type WorkspaceRootShelf } from "./workspace-root-shelf";
import { workspaceSourceKey, type WorkspaceSource } from "./workspace-wire";
import type { WorkspacePane } from "./workspace-pane";
import type { LocusRootData } from "./locus-root-data";
import type { LocusScope } from "./locus-scope";
import type { LocusLayoutChoice } from "./locus-layout-options";
import type { ReaderRuntime } from "./reader-runtime";
import type { LocusAddressInputRequest } from "./locus-address-inputs";
import { queueWorkspaceTransfer, takeWorkspaceTransfers, workspaceTransferOwner } from "./data-transfer/queue";
import type { HomeAction, LocalCreationDraft } from "./home-action";
import { createLocusNotificationCenter, LocusLoadFailure, LocusNotificationContext, LocusNotificationHost } from "./locus-notifications";
import type { AuthoringWorkerRequest, AuthoringWorkerMessage } from "./expression-runner/authoring-worker-protocol";
import { inheritCoreAuthoringOwner } from "./expression-runner/authoring-catalog-early-realm";
type CoreValueSuggestionRequest = Extract<AuthoringWorkerRequest, { method: "core-value-suggestions" }>;
import type { ValueSuggestion } from "./home-search/value-suggestions";
import { CollectionPreviewStrip } from "./value-card";
import { DataInspectionControls, type DataInspectionMode } from "./DataInspectionDialog";
import { LensFrame, LoadingScreen } from "./loading-screen";
import { IconByName } from "./icons";

// The real lightweight entry, router, menu, picker and clipboard capture stay
// intact. Only IO and the eventual heavy-workspace handoff are controlled.
const home = { id: "empty-home", name: "Empty home", active: true, view: { kind: "canvas", items: [] } };
let readerRootRevision = 1;
let readerRootIdentity = "sibling-reader";
let readerRootWritable = true;
const readerPublications: Array<{ sameObject: boolean; beforeId: string; afterId: string; beforeRevision: number; afterRevision: number }> = [];
const scenario = new URL(location.href).searchParams.get("scenario");
const localPaste = scenario?.startsWith("local-paste") === true;
const portalHandoff = scenario?.startsWith("local-new-held-portal") === true;
const heldLocalCreation = scenario === "local-new-held-mount" || portalHandoff;
const lateCreationDraft = scenario === "local-new-late-draft";
const localCreation = scenario === "local-new-pending" || heldLocalCreation || lateCreationDraft || localPaste;
// The lens owner's retained creation draft (WorkspaceSurface keeps one per lens).
const [lensCreationDraft, setLensCreationDraft] = createSignal<LocalCreationDraft>();
let localRootWritable = true;
const localSourceIdentity = localPaste ? LOCAL_BROWSER_SOURCE_ID : "temporary-tab-fixture";
let localRootIdentity = localSourceIdentity;
let localRootItems: LocusRootData["items"] = [];
type ExternalReceipt = NonNullable<Awaited<ReturnType<NonNullable<ApiClient["ingestExternal"]>>>>;
type ExternalAttempt = {
  snapshot: TransferSnapshot;
  signal?: AbortSignal;
  onPublished?: (receipt: ExternalReceipt) => void;
  resolve: (receipt: ExternalReceipt | undefined) => void;
  reject: (error: Error) => void;
  settled: boolean;
};
const externalAttempts: ExternalAttempt[] = [];
const [localPaneSource, setLocalPaneSource] = createSignal<WorkspaceSource>({ $tag: "ThisTabSource" });
const addressReadiness = scenario === "address-handoff";
const graphReadiness = scenario?.startsWith("graph-readiness") === true;
const graphIcons = scenario === "reader-graph-icons";
const publicReader = scenario === "public-labels" || graphReadiness || addressReadiness;
const publicRoot = (globalThis as typeof globalThis & { fixturePublicRoot?: LocusRootData }).fixturePublicRoot;
const browseScenario = scenario?.startsWith("browse") === true;
const previewReader = scenario === "reader" || scenario === "reader-thumbnails" || scenario === "reader-more"
  || scenario === "reader-focus-wait" || scenario === "reader-responsive" || scenario === "reader-labels" || scenario === "reader-handoff-wait"
  || scenario === "reader-session-retirement";
const readerScenario = previewReader || scenario === "browse-reader" || publicReader || graphIcons || localCreation;
const coreRequests: Array<CoreValueSuggestionRequest & { worker: number }> = [];
const coreWorkers: ControlledCoreWorker[] = [];
class ControlledCoreWorker {
  onmessage: ((event: MessageEvent<AuthoringWorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly id = coreWorkers.length;
  terminated = false;
  constructor() { coreWorkers.push(this); }
  postMessage(request: AuthoringWorkerRequest) {
    if (request.method === "core-value-suggestions") {
      coreRequests.push({ ...request, worker: this.id });
      queueMicrotask(() => this.onmessage?.({ data: { id: request.id, event: "started",
        startedAt: performance.timeOrigin + performance.now() } } as MessageEvent<AuthoringWorkerMessage>));
    } else if (request.method === "cancel") {
      queueMicrotask(() => this.onmessage?.({ data: { id: request.id, event: "finished" } } as MessageEvent<AuthoringWorkerMessage>));
    }
  }
  terminate() { this.terminated = true; }
}
// Only the worker's IO is controlled. Its actual checker is exercised separately
// and the screenshot fixture can opt into the real neutral worker.
if (new URL(location.href).searchParams.get("core-real") !== "1") {
  Object.assign(globalThis, { Worker: ControlledCoreWorker });
}
let serviceStarting = scenario === "starting";
const readinessWaiters: Array<(value: Response) => void> = [];
const requests: string[] = [];
const readerHeaders: Array<string | null> = [];
const accountHeaders: Array<string | null> = [];
const browseWaiters: Array<{ path: string; account: string | null; resolve: (value: Response) => void }> = [];
const errors: string[] = [];
const imports: string[] = [];
const actions: Array<HomeAction | undefined> = [];
const handoffFactories: Array<HomeAction | undefined> = [];
const clipboardReads: boolean[] = [];
const clipboardWaiters: Array<(value: ClipboardItem[]) => void> = [];
const writeWaiters: Array<(value: Response) => void> = [];
const metadataWaiters: Array<{ targets: string[]; resolve: (value: Response) => void }> = [];
const receivedTransfers: string[] = [];
const preparedBodyPastes: string[] = [];
let preparedBodyMounts = 0;
let preparedBodyDisposals = 0;
const rootReadWaiters: Array<() => void> = [];
const rootIntents: Array<string | undefined> = [];
let paneFlush: (() => Promise<boolean>) | undefined;
let requested = 0;
let noticeRetries = 0;
let browseRevision = 0;
const [ready, setReady] = createSignal(false);
const [readRuntime, setReadRuntime] = createSignal<ReaderRuntime>();
let readerReleases = 0;
const [preparationError, setPreparationError] = createSignal<string | null>(null);
const openedLenses: Array<{ scope: LocusScope; mode: string }> = [];
const openedElsewhere: Array<{ scope: LocusScope; place: string }> = [];
let elsewhereUnavailable: string | undefined;
const addressFocus: LocusScope = { kind: "value", viewId: publicRoot?.id ?? "public-fenel", itemId: "std", path: ["upper"], rootItem: true };
const [addressInputs, setAddressInputs] = createSignal<LocusAddressInputRequest | undefined>(addressReadiness ? {
  id: 1, source: "public", focus: addressFocus, inputs: [{ name: "s", text: "prefill without running" }],
} : undefined);
const [focus, setFocus] = createSignal<LocusScope>(addressReadiness ? addressFocus : { kind: "root" });
const [inspectionMode, setInspectionMode] = createSignal<DataInspectionMode>("data");
const [loadingStage, setLoadingStage] = createSignal<0 | 1 | 2>(0);
const [portalFrameGeneration, setPortalFrameGeneration] = createSignal(0);
const [portalToolbarMount, setPortalToolbarMount] = createSignal<HTMLElement>();
const [portalSummaryMount, setPortalSummaryMount] = createSignal<HTMLElement>();
let releaseHandoff!: () => void;
const handoffReady = createMemo(() => new Promise<boolean>(resolve => { releaseHandoff = () => resolve(true); }), { lazy: true });
function PendingHandoff(props: { onReady?: () => void; children?: JSX.Element } = {}) {
  return <Show when={handoffReady()}>{(_ready) => {
    props.onReady?.();
    return <div data-workspace-handoff="true" data-portal-owner={portalHandoff ? "prepared" : undefined}>{props.children ?? "Reader ready"}</div>;
  }}</Show>;
}
let heldFocus: LocusScope | undefined;
const [presentation, setPresentation] = createSignal<LocusLayoutChoice>();
const notificationCenter = createLocusNotificationCenter();
const fixtureNotice = Symbol("fixture-notice");
const fixtureNoticeTwin = Symbol("fixture-notice-twin");
const fixtureProgress = Symbol("fixture-progress");
const [transientFailure, setTransientFailure] = createSignal(false);

function browseResponse(path: string, account: string | null): Response {
  const secondAccount = account === "other-account";
  if (path === "/api/saved-queries") return Response.json({ categories: [], queries: secondAccount ? [
    { id: "other-saved", name: "Account two notebook", description: "Only the second account", query: { kind: "expression", expr: { kind: "literal", value: "second" } } },
  ] : [
    { id: "launch-checklist", name: "Launch checklist", description: "Prepare the September release", query: { kind: "expression", expr: { kind: "literal", value: "ready" } } },
    { id: "revenue-report", name: "Revenue report", description: "Monthly totals", query: { kind: "data-search", expr: { kind: "literal", value: 120 } } },
    { id: "not-an-expression", name: "Excluded view", query: { kind: "view", expr: { kind: "literal", value: "hidden" } } },
    { id: "missing-expression", name: "Excluded empty data", query: { kind: "expression" } },
  ] });
  if (path === "/api/types") return Response.json({ types: secondAccount ? [
    { name: "OtherAccountType", label: "Account two type", description: "Only the second account", type: { $ref: "String" } },
  ] : [
    { name: "SalesOrderCode", label: browseRevision ? "Updated customer orders" : "Customer orders", description: "Purchases awaiting dispatch", type: { $ref: "String" } },
    { name: "InternalFixtureType", label: "Excluded system type", type: { $ref: "String" }, isSystem: true },
    { name: "NoDefinition", label: "Excluded incomplete type" },
  ] });
  return Response.json({ functions: secondAccount ? [
    { name: "otherAccountFunction", description: "Only the second account", function: { id: "otherAccountFunction", params: [], returns: { $ref: "String" } } },
  ] : [
    { name: "calculateProfit", description: browseRevision ? "Updated margin description" : "Subtract cost from monthly receipts", function: { id: "calculateProfit", params: [], returns: { $ref: "Number" } } },
    { name: "internalFixtureFunction", description: "Excluded system function", function: { id: "internalFixtureFunction", params: [] }, isSystem: true },
    { name: "missingFunction", description: "Excluded incomplete function" },
  ] });
}

Object.assign(globalThis, { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const path = url.pathname;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  requests.push(`${method} ${path}`);
  const headers = new Headers(init?.headers);
  readerHeaders.push(headers.get("X-Fenel-Reader-Account"));
  accountHeaders.push(headers.get("X-Fenel-Account"));
  if (method === "GET" && ["/api/saved-queries", "/api/types", "/api/functions"].includes(path)) {
    if (browseScenario) return new Promise<Response>(resolve => browseWaiters.push({
      path, account: headers.get("X-Fenel-Reader-Account") ?? headers.get("X-Fenel-Account"), resolve,
    }));
    return path === "/api/saved-queries" ? Response.json({ queries: [], categories: [] }) : browseResponse(path, null);
  }
  if (path === "/api/readiness") {
    if (serviceStarting && url.search) return new Promise<Response>((resolve) => readinessWaiters.push(resolve));
    return Response.json({ status: serviceStarting ? "loading" : "ready" });
  }
  if (method === "GET" && path === "/api/locus-root") {
    if (serviceStarting) throw new TypeError("Failed to fetch");
    if (scenario === "denied") return new Response("Denied", { status: 403 });
    if (graphIcons && publicRoot) return Response.json({ root: publicRoot });
    const response = Response.json({ root: { id: localCreation ? "temporary-tab-fixture" : readerScenario ? readerRootIdentity : home.id, name: "All data", type: { $ref: "List", args: [{ $ref: "Any" }] },
      expr: { kind: "list", items: [] }, revision: readerRootRevision, persisted: true, canEdit: readerRootWritable, layout: { kind: "grid" },
      items: previewReader ? [
        { id: "literal", caption: "A received value", source: { kind: "expr", expr: { kind: "literal", value: "Already available" } } },
        { id: "computed", caption: "A computed value", source: { kind: "expr", expr: { kind: "call", fn: "unavailable-until-prepared", args: [] } } },
        { id: "image", caption: "A received image", source: { kind: "expr", expr: { kind: "literal", value: {
          width: 96, height: 64, pixels: Array.from({ length: 96 * 64 }, (_, index) => ({
            r: 90 + Math.floor(index / 96), g: 165, b: 210 - index % 96, a: 255,
          })),
        } } } },
        { id: "known-list", caption: "A received list", source: { kind: "ref", ref: { kind: "savedExpr", id: "list-reference" } } },
        { id: "empty-list", caption: "An empty list", source: { kind: "ref", ref: { kind: "savedExpr", id: "empty-reference" } } },
        ...(scenario === "reader-more" || scenario === "reader-focus-wait" || scenario === "reader-responsive" ? [{ id: "more-record", caption: "A received record", source: { kind: "expr", expr: {
          kind: "literal", value: { __record: { fields: ["one", "two", "three", "four"].map(name => ({ name, value: { kind: "literal", value: name } })) } },
        } } }] : []),
      ] : [], lists: previewReader ? [
        { id: "known-list", name: "A received list", view: { kind: "list", items: scenario === "reader-labels" ? [
          { id: "first", caption: "avg", valueType: { $ref: "PreviewCallable" },
            source: { kind: "expr", expr: { kind: "literal", value: { $ref: "0fc2267f-d018-4d3b-aeb4-f2d6ad286835" } } } },
          { id: "second", caption: "bitXor", representations: { Labelable: { label: { en: "My XOR" } }, Iconable: { icon: "bot" } },
            valueType: { $ref: "PreviewCallable" }, source: { kind: "expr", expr: { kind: "literal", value: { $ref: "a87f1ed4-b0ea-42a2-9bb7-8f8e9b24dc16" } } } },
          { id: "third", caption: "missing", source: { kind: "expr", expr: { kind: "literal", value: { $ref: "44444444-4444-4444-8444-444444444444" } } } },
        ] : scenario === "reader-thumbnails" ? [
          { id: "first", caption: "Message", valueType: { $ref: "PreviewString" }, source: { kind: "expr", expr: { kind: "literal", value: "First item" } } },
          { id: "second", representations: { Iconable: { icon: "bot" } }, valueType: { $ref: "PreviewString" },
            source: { kind: "expr", expr: { kind: "literal", value: { $ref: "22222222-2222-4222-8222-222222222222" } } } },
          { id: "third", representations: { Iconable: { icon: "bot" } }, source: { kind: "expr", expr: { kind: "literal",
            value: { width: 2, height: 2, pixels: [{ r: 100, g: 160, b: 220, a: 255 }, { r: 30, g: 80, b: 140, a: 255 }, { r: 120, g: 150, b: 50, a: 255 }, { r: 50, g: 100, b: 30, a: 255 }] } } } },
        ] : scenario === "reader-responsive" ? ["first", "second", "third", "fourth", "fifth"].map((id, index) => ({ id,
          valueType: { $ref: index === 4 ? "FarPreviewString" : "PreviewString" },
          source: { kind: "expr", expr: { kind: "literal", value: index === 3
            ? { $ref: "33333333-3333-4333-8333-333333333333" } : id } } }))
          : scenario === "reader-more" ? ["first", "second", "third", "fourth"].map(id => ({ id,
          source: { kind: "expr", expr: { kind: "literal", value: id } } }))
          : [{ id: "first", source: { kind: "expr", expr: { kind: "literal", value: "First item" } } }] },
          referenceId: "list-reference", sourceReferenceId: "list-reference", rootRevision: 1,
          valueType: { $ref: "11111111-1111-4111-8111-111111111111" }, derivedCanvas: false },
        { id: "empty-list", name: "An empty list", view: { kind: "list", items: [] },
          referenceId: "empty-reference", sourceReferenceId: "empty-reference", rootRevision: 1,
          valueType: { $ref: "11111111-1111-4111-8111-111111111111" }, derivedCanvas: false },
      ] : [], expressions: {}, referenceId: "fixture-root" } });
    if (localCreation) return new Promise<Response>(resolve => rootReadWaiters.push(() => resolve(response)));
    return response;
  }
  if (method === "POST" && path === "/api/reader-metadata") {
    const body = JSON.parse(String(init?.body)) as { targets: string[] };
    return new Promise<Response>(resolve => metadataWaiters.push({ targets: body.targets, resolve }));
  }
  if (method === "PUT" && path === "/api/locus-root" && scenario === "reader") {
    return new Promise<Response>(resolve => writeWaiters.push(resolve));
  }
  if (method === "GET" && path === "/api/locus-views") return Response.json({ locusViews: [home] });
  if (method === "GET" && path === "/api/locus-views/active") return Response.json({ locusView: home });
  throw new Error(`Unexpected lightweight Home request: ${method} ${path}`);
} });

// Exercise async clipboard capture without reading or changing the host OS's
// clipboard. A held read also checks the visible pending state and ownership.
document.execCommand = () => false;
Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
  read: () => {
    clipboardReads.push(navigator.userActivation.isActive);
    return new Promise<ClipboardItem[]>((resolve) => clipboardWaiters.push(resolve));
  },
} });

if (!localPaste) setBrowserAccountScope("home-entry-context-fixture", true);
let finishLocalRoot!: (value: { root: LocusRootData }) => void;
const heldLocalRoot = new Promise<{ root: LocusRootData }>(resolve => { finishLocalRoot = resolve; });
const localRootSnapshot = (): LocusRootData => ({ id: localRootIdentity, name: "Local",
  type: { $el: { call: ["List", { $ref: "Any" }] } }, expr: { kind: "literal", value: [] }, revision: localRootItems.length, persisted: false,
  canEdit: localRootWritable, layout: { kind: "list" }, items: [...localRootItems], lists: [], expressions: {}, referenceId: localSourceIdentity });
const localRootRead = query(() => {
  if (localPaste) return Promise.resolve({ root: localRootSnapshot() });
  if (!rootReadWaiters.length) rootReadWaiters.push(() => finishLocalRoot({ root: { id: localRootIdentity, name: "Local",
    type: { $el: { call: ["List", { $ref: "Any" }] } }, expr: { kind: "literal", value: [] }, revision: 0, persisted: false,
    canEdit: localRootWritable, layout: { kind: "grid" }, items: localRootItems, lists: [], expressions: {}, referenceId: "temporary-tab-fixture" } }));
  return heldLocalRoot;
}, "fixture-local-locusRoot");
const localSavedRead = query(async (_category?: string, _q?: string) => ({ queries: [], categories: [] }), "fixture-local-savedQueries");
function localPasteClient(): ApiClient {
  const client = createPublicApiClient();
  const copied: ApiClient = { ...client, rootId: LOCAL_BROWSER_SOURCE_ID,
    getLocusRoot: Object.assign(localRootRead, { uncached: localRootRead }),
    getSavedQueries: Object.assign(localSavedRead, { uncached: localSavedRead }),
    revalidate: () => { revalidateQuery(localRootRead.key); },
    ingestExternal: (snapshot, ingress = {}) => new Promise((resolve, reject) => {
      const attempt: ExternalAttempt = { snapshot, ...ingress, resolve, reject, settled: false };
      externalAttempts.push(attempt);
      const abort = () => {
        if (attempt.settled) return;
        if (scenario === "local-paste-delayed-abort") return;
        attempt.settled = true;
        reject(new DOMException("Paste cancelled", "AbortError"));
      };
      ingress.signal?.addEventListener("abort", abort, { once: true });
      client.signal.addEventListener("abort", abort, { once: true });
      if (ingress.signal?.aborted || client.signal.aborted) abort();
    }),
  };
  inheritCoreAuthoringOwner(copied, client, copied.signal);
  return copied;
}
const [pasteClient, setPasteClient] = createSignal<ApiClient | undefined>(localPaste ? untrack(localPasteClient) : undefined);
const fixtureBaseClient = createPublicApiClient();
const readerClient = localCreation ? { ...fixtureBaseClient, rootId: localSourceIdentity,
  getLocusRoot: Object.assign(localRootRead, { uncached: localRootRead }), getSavedQueries: Object.assign(localSavedRead, { uncached: localSavedRead }) }
  : readerScenario ? createAccountApiClient("sibling-reader") : undefined;
if (localCreation && readerClient) inheritCoreAuthoringOwner(readerClient, fixtureBaseClient, readerClient.signal);
// Default-shell scenarios follow the tab's current account; source-reader
// scenarios below keep their explicitly bound account client.
const defaultReaderClient = !readerScenario ? defaultApiClient : undefined;
// The legacy default transport does not mint a reader lineage. Supply its
// controlled checker owner without changing its session-following HTTP API.
if (defaultReaderClient) {
  const checkerOwner = createAccountApiClient("home-entry-context-fixture");
  inheritCoreAuthoringOwner(defaultReaderClient, checkerOwner, checkerOwner.signal);
}
const shelfLens = { id: "fixture-reader", source: { $tag: "ThisTabSource" as const }, focus: { $tag: "RootFocus" as const } };
// The browser build injects the exact production shelf service; only its
// navigation IO is held here, beside the existing held reader response.
const rootShelfFixture = localCreation ? createRoot(() => (globalThis as typeof globalThis & {
  fixtureRootShelfFactory: (props: { epoch: number }, exploreData: (source?: string) => void,
    frame: { active: () => typeof shelfLens; value: () => { lenses: Array<typeof shelfLens> } }) => {
    shelf: WorkspaceRootShelf; canCreate: () => boolean[];
  };
}).fixtureRootShelfFactory({ epoch: untrack(sessionEpoch) }, source => { rootIntents.push(source); },
  { active: () => shelfLens, value: () => ({ lenses: [shelfLens] }) })) : undefined;
const readerOwner = workspaceTransferOwner("sibling-reader", "fixture-reader");
const otherOwner = workspaceTransferOwner("other-account", "fixture-reader");
const [readerSource, setReaderSource] = createSignal<WorkspaceSource>();
const pane: WorkspacePane = {
  id: "fixture-reader", active: () => true, focus, presentation,
  toolbarMount: portalHandoff ? portalToolbarMount : () => undefined,
  summaryMount: portalHandoff ? portalSummaryMount : undefined,
  onAllData: portalHandoff ? () => {} : undefined,
  source: () => readerSource() ?? (localCreation ? localPaneSource() : publicReader ? { $tag: "PublicSource" } : { $tag: "AccountSource", accountId: "sibling-reader" }), accounts: () => [],
  sourceLabel: () => localCreation ? "Local" : "Reader account", onOpenLens: (scope, mode = "stack") => { openedLenses.push({ scope, mode }); }, onClose: () => {},
  openElsewhere: (scope, place) => { openedElsewhere.push({ scope, place }); }, openElsewhereUnavailable: () => elsewhereUnavailable,
  inspectionMode, onInspectionMode: setInspectionMode,
  addressInputs,
  onAddressInputsHandled: id => setAddressInputs(previous => previous?.id === id ? undefined : previous),
  onFocus: next => { if (scenario === "reader-focus-wait") heldFocus = next; else setFocus(next); },
  onPresentation: setPresentation, onSource: () => {}, onSubject: () => {},
  registerFlush: flush => { paneFlush = flush; return () => { if (paneFlush === flush) paneFlush = undefined; }; },
  ...(lateCreationDraft ? {
    creationDraft: () => lensCreationDraft(),
    onCreationDraft: (draft: LocalCreationDraft | undefined) => setLensCreationDraft(draft),
  } : {}),
};
function PreparedPasteOwner() {
  const mount = ++preparedBodyMounts;
  onSettled(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      preparedBodyPastes.push(event.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("paste", paste);
    return () => { preparedBodyDisposals++; document.removeEventListener("paste", paste); };
  });
  return <div data-workspace-handoff="true" data-prepared-owner={mount}>Reader ready</div>;
}
function ReaderHome(props: { client?: ApiClient } = {}) {
  return <HomeEntry client={props.client ?? readerClient} pane={pane} publicRoot={publicReader ? publicRoot : undefined} readRuntime={readRuntime()} renderWorkspace={action => {
    if (heldLocalCreation) {
      handoffFactories.push(action);
      return <PendingHandoff onReady={() => { actions.push(action); }}>
        {portalHandoff ? <PortalSuccessor /> : undefined}
      </PendingHandoff>;
    }
    actions.push(action);
    if (addressReadiness) {
      const received = addressInputs();
      queueMicrotask(() => { if (received) pane.onAddressInputsHandled?.(received.id); });
    }
    receivedTransfers.push(...takeWorkspaceTransfers(localPaste
      ? workspaceTransferOwner(undefined, pane.id, sessionEpoch(), LOCAL_BROWSER_SOURCE_ID) : readerOwner).map(entry => entry.snapshot.text));
    void (props.client ?? readerClient)!.getLocusRoot();
    if (scenario === "local-paste-prepared-owner") return <PreparedPasteOwner />;
    return scenario === "reader-handoff-wait" ? <PendingHandoff /> : <div data-workspace-handoff="true">Reader ready</div>;
  }} />;
}
/** The successor uses the same real lightweight controls, with its heavy tools
 * deliberately held. This tests DOM ownership at the handoff, not full Home. */
function PortalSuccessor() {
  return <HomeEntry client={readerClient} pane={pane} readiness={{
    ready: () => false, loading: () => false, stage: () => null, error: () => null,
    request() {}, retry() {},
  }} />;
}
function PortalReaderFrame() {
  return <div class="workspace-surface" style="height: 100vh" data-portal-fixture>
    <LensFrame id="fixture-reader" header={<>
      <Show when={portalFrameGeneration() + 1} keyed>{(_frame) => <div class="workspace-pane__toolbar-mount"
        ref={element => onSettled(() => { setPortalToolbarMount(element); })} />}</Show>
      <DataInspectionControls mode={inspectionMode()} onModeChange={setInspectionMode} />
    </>} summary={
      <Show when={portalFrameGeneration() + 1} keyed>{(_frame) => <div class="workspace-pane__summary-mount"
        ref={element => onSettled(() => { setPortalSummaryMount(element); })}>
        <div class="workspace-pane__summary-placeholder" aria-hidden="true"><span>Local</span><span class="workspace-pane__summary-skeleton" /></div>
      </div>}</Show>
    }><ReaderHome /></LensFrame>
  </div>;
}
const Router = createRouter({ history: memoryHistory("/"), routes: [{ path: "/", component: () => scenario === "loading-card"
  ? <div class="home-canvas" data-isolated-loading><LoadingScreen inline stage={loadingStage()} /></div> : readerScenario
  ? portalHandoff ? <PortalReaderFrame /> : localPaste ? <Show when={pasteClient()} keyed>{client => <ReaderHome client={client} />}</Show>
    : scenario === "reader-session-retirement" ? <Show when={sessionEpoch() === readerClient!.epoch}><ReaderHome /></Show>
    : <ReaderHome /> : <HomeEntry client={defaultReaderClient} /> }] });

// The reader-metadata service also returns each target's data-row projection
// (`ownPresentation`), which names and marks the data itself. Mirror it here
// from the same scoped representations the response carries.
function withOwnPresentation(entry: { target: string; representations: Array<{ typeName: string; methods: Record<string, unknown> }> }) {
  const method = (typeName: string, name: string) => entry.representations.find(instance => instance.typeName === typeName)?.methods[name];
  const own = Object.fromEntries(Object.entries({ label: method("Labelable", "label"), codeName: method("Codeable", "codeName"),
    icon: method("Iconable", "icon"), emoji: method("Emojiable", "emoji") }).filter(([, value]) => value !== undefined));
  return Object.keys(own).length ? { ...entry, ownPresentation: own } : entry;
}
const fixture = {
  portalState: () => ({ frame: portalFrameGeneration(), toolbarConnected: !!portalToolbarMount()?.isConnected,
    summaryConnected: !!portalSummaryMount()?.isConnected }),
  replacePortalFrame: () => setPortalFrameGeneration(value => value + 1),
  preparedPasteState: () => ({ mounts: preparedBodyMounts, disposals: preparedBodyDisposals, received: [...preparedBodyPastes] }),
  externalState: () => ({ attempts: externalAttempts.map(attempt => ({ text: attempt.snapshot.text, files: attempt.snapshot.files.length,
    settled: attempt.settled, aborted: !!attempt.signal?.aborted })), items: localRootItems.map(item => item.id) }),
  publishExternal: (index: number, label = "Pasted data", notes: string[] = []) => {
    const attempt = externalAttempts[index];
    if (!attempt || attempt.settled) throw new Error("No active external paste.");
    attempt.signal?.throwIfAborted();
    attempt.settled = true;
    const value = attempt.snapshot.files.length ? { width: 48, height: 32, pixels: Array.from({ length: 48 * 32 }, (_, offset) => ({
      r: offset % 48 * 5, g: Math.floor(offset / 48) * 7, b: 190, a: 255,
    })) } : label;
    const item: LocusRootData["items"][number] = { id: `pasted-${index}`, source: { kind: "expr", expr: { kind: "literal", value } } };
    localRootItems = [...localRootItems, item];
    const receipt: ExternalReceipt = { root: localRootSnapshot(), items: [item], notes };
    attempt.onPublished?.(receipt);
    attempt.resolve(receipt);
  },
  rejectExternal: (index: number, unsupported = false) => {
    const attempt = externalAttempts[index];
    if (!attempt || attempt.settled) throw new Error("No active external paste.");
    attempt.settled = true;
    if (unsupported) attempt.resolve(undefined);
    else attempt.reject(new Error("Could not add this paste. Try again."));
  },
  pasteSession: (account?: string) => {
    setBrowserAccountScope(account, true);
    setPasteClient(localPasteClient());
  },
  state: () => ({ ready: ready(), readerReleases, readerPublications: [...readerPublications], rootReadsPending: rootReadWaiters.length, rootIntents: [...rootIntents], createVerdicts: rootShelfFixture?.canCreate(), addressInputs: addressInputs(), focus: focus(), inspectionMode: inspectionMode(), presentation: presentation(), openedLenses: [...openedLenses], openedElsewhere: [...openedElsewhere], requested, noticeRetries, requests: [...requests], readerHeaders: [...readerHeaders], accountHeaders: [...accountHeaders], browseReads: browseWaiters.map(({ path, account }) => ({ path, account })), metadataTargets: metadataWaiters.map(waiter => waiter.targets), errors: [...errors], imports: [...imports], actions: [...actions], handoffFactories: [...handoffFactories], clipboardReads: [...clipboardReads], receivedTransfers: [...receivedTransfers], coreRequests: [...coreRequests], coreWorkers: coreWorkers.map(worker => ({ terminated: worker.terminated })) }),
  rootNew: () => rootShelfFixture?.shelf.request("new"),
  releaseRoot: (writable = true, identity = "temporary-tab-fixture", items: LocusRootData["items"] = []) => { localRootWritable = writable; localRootIdentity = identity; localRootItems = items; for (const release of rootReadWaiters.splice(0)) release(); },
  localSource: setLocalPaneSource,
  readerSource: setReaderSource,
  addressInputs: (id: number) => setAddressInputs(previous => ({ id, source: "public", focus: addressFocus,
    inputs: previous?.inputs ?? [{ name: "s", text: "prefill without running" }] })),
  mode: setInspectionMode,
  loadingStage: setLoadingStage,
  releaseFocus: () => { if (heldFocus) { setFocus(heldFocus); heldFocus = undefined; } },
  releaseCore: (index: number, suggestions: ValueSuggestion[]) => {
    const request = coreRequests[index];
    if (!request) throw new Error("No such core suggestion request.");
    coreWorkers[request.worker]!.onmessage?.({ data: { id: request.id, ok: true,
      result: { coreValueSuggestion: { input: request.input, suggestions } } } } as MessageEvent<AuthoringWorkerMessage>);
  },
  releaseBrowse: (path?: string, account?: string) => {
    for (let index = browseWaiters.length - 1; index >= 0; index--) {
      const waiter = browseWaiters[index]!;
      if ((path === undefined || waiter.path === path) && (account === undefined || waiter.account === account)) {
        browseWaiters.splice(index, 1);
        waiter.resolve(browseResponse(waiter.path, waiter.account));
      }
    }
  },
  session: (account: string) => setBrowserAccountScope(account, true),
  refreshCatalog: () => {
    if (!readerClient) throw new Error("This scenario needs a bound reader.");
    browseRevision++;
    readerClient.revalidate(["types", "functions"]);
  },
  closeReader: () => readerClient?.dispose(),
  elsewhereUnavailable: (reason?: string) => { elsewhereUnavailable = reason; },
  reviseRoot: () => { readerRootRevision++; readerClient?.revalidate(["locusRoot"]); },
  republishReaderRoot: async (change: "same" | "identity" | "readonly" = "same", readyAfter = false) => {
    if (!readerClient) throw new Error("This scenario needs its bound reader.");
    const before = (await readerClient.getLocusRoot()).root;
    if (change === "identity") readerRootIdentity = "replacement-reader-root";
    else if (change === "readonly") readerRootWritable = false;
    readerClient.revalidate(["locusRoot"]);
    await Promise.resolve();
    const after = (await readerClient.getLocusRoot()).root;
    readerPublications.push({ sameObject: before === after, beforeId: before.id, afterId: after.id,
      beforeRevision: before.revision, afterRevision: after.revision });
    if (readyAfter) setReady(true);
  },
  probeReader: async () => {
    if (!readerClient) throw new Error("This scenario needs a bound reader.");
    const reads = await Promise.allSettled([
      Promise.resolve().then(() => readerClient.getBrowseTypes()),
      Promise.resolve().then(() => readerClient.getBrowseFunctions()),
    ]);
    return reads.map(result => result.status);
  },
  focus: setFocus,
  failPreparation: () => setPreparationError("Data tools are temporarily unavailable."),
  flushPane: () => paneFlush?.() ?? Promise.resolve(true),
  releaseWrites: () => { for (const resolve of writeWaiters.splice(0)) resolve(Response.json({ root: { id: "sibling-reader", revision: 2 } })); },
  releaseMetadata: () => { for (const waiter of metadataWaiters.splice(0)) waiter.resolve(Response.json({ entries: waiter.targets.map(target => withOwnPresentation({
    target, representations: graphIcons ? [{ typeName: "Iconable", methods: { icon: target === "std:join" ? "link"
      : target === "std:words" ? "list" : "repeat" } }, { typeName: "Codeable", methods: { codeName: target.split(":").at(-1) } }]
      : scenario === "reader-labels" ? target === "0fc2267f-d018-4d3b-aeb4-f2d6ad286835"
      ? [{ typeName: "Labelable", methods: { label: { en: "Average" } } }, { typeName: "Iconable", methods: { icon: "user" } }]
      : target === "a87f1ed4-b0ea-42a2-9bb7-8f8e9b24dc16" ? [{ typeName: "Labelable", methods: { label: "Bitwise XOR" } }]
      : target === "PreviewCallable" ? [{ typeName: "Labelable", methods: { label: "Function" } },
        { typeName: "Iconable", methods: { icon: "function" } }] : []
      : [{ typeName: "Iconable", methods: { icon: target === "PreviewString" ? "type"
      : target === "FarPreviewString" ? "user" : target === "33333333-3333-4333-8333-333333333333" ? "bot" : "star" } }],
  })) })); },
  extendGraphExpression: async () => {
    if (!readerClient) throw new Error("This scenario needs a reader client.");
    const root = (await readerClient.getLocusRoot())?.root;
    const demo = root?.items.find(item => item.id === "demo")?.source;
    if (demo?.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected the existing demo record.");
    const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: import("@fenel/engine/authoring/expression").ExprNode }> } }).__record.fields;
    const field = fields.find(field => field.name === "Reversed words")!;
    const expression = field.value;
    if (expression.kind !== "call") throw new Error("Expected the held join call.");
    field.value = { ...expression, args: [{ kind: "call", fnId: "std:upper", args: [expression.args[0]!] }, ...expression.args.slice(1)] };
    setFocus({ ...focus() });
  },
  takeReaderTransfers: () => takeWorkspaceTransfers(readerOwner),
  takeOtherTransfers: () => takeWorkspaceTransfers(otherOwner),
  queueOtherTransfer: () => queueWorkspaceTransfer({ text: "Other reader data", files: [], html: "", internal: "", uriList: "" }, undefined, undefined, otherOwner),
  notify: (detail: string) => notificationCenter.update(fixtureNotice, {
    notices: [{ id: "fixture", tone: "error", message: "Could not load this data.", detail,
      retry: { label: "Reload page", run: () => { noticeRetries++; } } }],
    dismiss: () => notificationCenter.remove(fixtureNotice),
  }),
  notifyTwin: (detail: string) => notificationCenter.update(fixtureNoticeTwin, {
    notices: [{ id: "fixture", tone: "error", message: "Could not load this data.", detail }],
    dismiss: () => notificationCenter.remove(fixtureNoticeTwin),
  }),
  clearNotice: () => notificationCenter.remove(fixtureNotice),
  transientFailure: setTransientFailure,
  progress: (active: boolean) => active ? notificationCenter.update(fixtureProgress, {
    notices: [{ id: "fixture-progress", tone: "info", message: "Preparing data…" }],
    dismiss: () => notificationCenter.remove(fixtureProgress),
  }) : notificationCenter.remove(fixtureProgress),
  ready: () => setReady(true),
  /** Another owner of this lens (the replaced address preview) retains a creation. */
  retainCreationDraft: (draft: LocalCreationDraft | undefined) => setLensCreationDraft(draft),
  creationDraft: () => lensCreationDraft(),
  releaseHandoff: () => releaseHandoff(),
  releaseGraphReader: () => {
    if (!readerClient) throw new Error("This scenario needs a reader client.");
    readerReleases++;
    // The real LensReader publishes readiness and its exact runtime together.
    // Its session is an opaque sentinel here: this boundary must never execute it.
    const session = {} as ReturnType<ReaderRuntime["session"]>;
    setReadRuntime({ kind: "public", epoch: sessionEpoch(), client: readerClient, session: () => session,
      representation: () => undefined } as unknown as ReaderRuntime);
    setReady(true);
  },
  desktop: () => setPresentation("desktop"),
  serverReady: () => {
    serviceStarting = false;
    for (const resolve of readinessWaiters.splice(0)) resolve(Response.json({ status: "ready" }));
  },
  loaded: (name: string) => { imports.push(name); },
  handoff: (action: HomeAction | undefined) => { actions.push(action); },
  releaseClipboard: () => {
    const value = new ClipboardItem({
      "text/plain": new Blob(["Captured while loading"], { type: "text/plain" }),
      "text/html": new Blob(["<b>Captured while loading</b>"], { type: "text/html" }),
    });
    for (const resolve of clipboardWaiters.splice(0)) resolve([value]);
  },
  takeTransfers: takeWorkspaceTransfers,
  dispose: () => {},
};
declare global { var homeEntryContextFixture: typeof fixture; }
globalThis.homeEntryContextFixture = fixture;

function PendingThumbnail() {
  const pending = createMemo(() => new Promise<never>(() => {}));
  return <span>{pending()}</span>;
}
function ErrorThumbnail(): never { throw new Error("Unavailable thumbnail projection"); }
function ThumbnailBoundaries() {
  return <div data-thumbnail-boundaries style="position: fixed; left: 20px; top: 180px; width: 180px; z-index: 20">
    <CollectionPreviewStrip items={["Pending thumbnail", "Failed thumbnail"]} label="Thumbnail boundary cases"
      itemLabel={item => item} onOpenItem={() => {}} onEnterCollection={() => {}}
      render={item => item === "Pending thumbnail" ? <PendingThumbnail /> : <ErrorThumbnail />}
      preview={item => item === "Pending thumbnail" ? <PendingThumbnail /> : <ErrorThumbnail />} />
  </div>;
}

fixture.dispose = render(() => (
  <Errored fallback={(error) => {
    errors.push(String(error()));
    return <pre data-fixture-error>{String(error())}</pre>;
  }}>
    <Loading fallback={<p>Loading Home fixture…</p>}>
      <WorkspaceReadinessContext value={{ ready, loading: () => !ready(), stage: () => "Preparing fixture workspace…", error: preparationError,
        request() { requested++; }, retry() { requested++; } }}>
        <LocusNotificationContext value={notificationCenter}>
        <div class="app-notification-host"><LocusNotificationHost /></div>
        <Show when={transientFailure()}><LocusLoadFailure message="Could not preview this data."
          detail="The preview reader reported a problem." retry={() => { noticeRetries++; }} /></Show>
        {scenario === "thumbnail-boundaries" ? <ThumbnailBoundaries /> : null}
        {graphIcons ? <div hidden data-graph-reference-icons>{["link", "list", "repeat"].map(name => <span data-icon={name}><IconByName name={name} /></span>)}</div> : null}
        {readerScenario && !portalHandoff ? <div class="fixture-lens-toolbar"><DataInspectionControls mode={inspectionMode()} onModeChange={setInspectionMode} /></div> : null}
        <Show when={rootShelfFixture} fallback={<Router />}>{shelf => <WorkspaceRootShelfContext value={shelf().shelf}><Router /></WorkspaceRootShelfContext>}</Show>
        </LocusNotificationContext>
      </WorkspaceReadinessContext>
    </Loading>
  </Errored>
), document.body);
