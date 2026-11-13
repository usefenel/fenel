import { Errored, Loading, Show, createMemo, createRoot, createSignal, onSettled, flush, untrack } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import WorkspaceSurface from "./workspace-surface";
import HomeSurface from "./home-surface";
import HomeEntry from "./home-entry";
import { loadWorkspacePreferences } from "./workspace-preferences";
import { LensPending } from "./loading-screen";
import { LocusBackground } from "./locus-background";
import { refreshSubject, subject, loading, subjectResolutionError, type WorkspaceBootstrap } from "./auth";
import { sessionEpoch } from "./browser-session";
import { WorkspaceChromeContext } from "./workspace-chrome";
import { IconByName, IconLogout } from "./icons";
import { createLocusNotificationCenter, LocusNotificationContext, LocusNotificationHost } from "./locus-notifications";
import { ConfirmModalHost } from "./confirm-modal";
import { PublicBootstrapMismatchError } from "./public-bootstrap";
import type { LocusRootData } from "./locus-root-data";
import type { ReadyWorkspaceBootstrap, WorkspaceBar, WorkspaceLens, WorkspacePreferences, WorkspaceCommand } from "./workspace-wire";
import type { LensShortcut, LensTypedSubject } from "./lens-shortcuts";
import type { WorkspacePane, WorkspaceLensOpenMode } from "./workspace-pane";
import type { DataInspectionSuggestions } from "./DataInspectionDialog";
import type { LocusLayoutChoice } from "./locus-layout-options";
import type { WorkspacePresentationTarget } from "./workspace-wire";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { projectAllDataRoot } from "./all-data-root";
import type { WorkspaceModel } from "./workspace-model-loader";
import { createLocalApiClient, type LocalTabSource } from "./local-locus-data";
import { LOCAL_BROWSER_SOURCE_ID } from "./browser-data-storage";
import { localTransfersPending } from "./data-transfer/queue";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";

// Server responses and dynamic-module acquisition are the only controlled
// boundaries. Surface, preference store, HTTP readers and HomeEntry are real.
const scenario = new URL(location.href).searchParams.get("scenario") ?? "saved-b";
const stackedChromeScenario = scenario.startsWith("stacked-chrome-");
const toolbarControlsScenario = scenario.startsWith("toolbar-controls-");
const readOnlyNewScenario = scenario.startsWith("logo-public-new-readonly");
let firstCreationReaderEpoch: number | undefined;
const surfaceMountScenario = scenario === "surface-mount";
const addressedRootPending = scenario === "addressed-root-pending";
const addressedRootProjected = scenario.startsWith("addressed-root-projected");
const startupScenario = scenario.startsWith("startup-");
const outerPortalScenario = scenario === "startup-root-local-navigation-portal";
const localAuthContinuation = scenario.startsWith("startup-root-local-auth");
const snapshotRace = scenario.startsWith("startup-snapshot-race");
const logoScenario = scenario.startsWith("logo-") || scenario === "home-address" || surfaceMountScenario || addressedRootPending || addressedRootProjected || scenario.startsWith("startup-root");
const ownerNavigation = scenario.startsWith("owner-navigation");
const dashboardScenario = logoScenario || stackedChromeScenario || toolbarControlsScenario || ["lens-controls", "public-toolbar-order", "slow-reader", "account-menu", "unnamed-data", "type-inspection", "type-transport"].includes(scenario);
let holdSubject = startupScenario && scenario !== "startup-recheck";
let releaseSubject: ((response: Response) => void) | undefined;
let authenticatedAccount = scenario === "personal-login" ? "personal" : "account-a";
const requests: Array<{ method: string; path: string; account: string | null; aborted: boolean }> = [];
const dynamicModules: string[] = [];
const errors: string[] = [];
const modelCalls: string[] = [];
const edits: unknown[] = [];
const editBatches: unknown[][] = [];
let bar: WorkspaceBar | undefined;
let notifications: ReturnType<typeof createLocusNotificationCenter> | undefined;
let homeOwner: symbol | undefined;
let registeredHome: (() => Promise<boolean>) | undefined;
let homeAttempts = 0;
const homeResults: boolean[] = [];
let bootstrapReleased = false;
let bootstrapFailures = 0;
let publicSnapshotReleased = !snapshotRace;
let releasePublicSnapshot!: () => void;
const publicSnapshotReady = new Promise<void>(resolve => { releasePublicSnapshot = () => { publicSnapshotReleased = true; resolve(); }; });
let modelReleased = false;
let modelPreparations = 0;
let publicPreparations = 0;
let localPreparations = 0;
let localRootReads = 0;
let localSource: LocalTabSource | undefined;
let retainedLocalRoot: LocusRootData | undefined;
const [localPublicationVersion, setLocalPublicationVersion] = createSignal(0);
const localPasteAttempts: Array<{ epoch: number; aborted: boolean }> = [];
const heldLocalPastes: Array<() => void> = [];
let localPastePublications = 0;
const [defaultShortcuts, setDefaultShortcuts] = createSignal<readonly LensShortcut[]>([]);
let dispose = () => {};
let resolveModel!: () => void;
let releaseBootstrap: (() => void) | undefined;
const modelReady = new Promise<void>(resolve => { resolveModel = resolve; });
const forever = new Promise<never>(() => {});
const [lateChildRequested, setLateChildRequested] = createSignal(false);
let releaseLateChild!: (value: string) => void;
let lateChildReads = 0;
const lateChildReady = new Promise<string>(resolve => { releaseLateChild = resolve; });
const heldReads: Array<() => void> = [];
const heldSaves: Array<() => void> = [];
const panes = new Map<string, WorkspacePane>();
const heldPaneFlushes: Array<() => void> = [];
const heldPreferences: Array<() => void> = [];
let holdingPaneFlushes = false;
const none = { $tag: "Nothing" } as const;
const inspectedType: LensTypedSubject = { $tag: "LensTypedSubject", dataType: { $type: true }, data: { $ref: "fixture-inspected-type" },
  originSource: { $tag: "AccountSource", accountId: "account-b" }, originFocus: { $tag: "ListFocus", listId: "saved-list-b" },
  producer: none, producerInput: none, producerBinding: none };
// A fixed List Anything transport fixture, using the existing List helper's
// canonical opaque representation. Formatter facts are supplied by the server.
const listType: LocusRootData["type"] = { $opaque: { name: "List", pure: { $variant: { cases: [
  { name: "Nil", label: none },
  { name: "Cons", label: none, fields: [
    { name: "head", label: none, type: { $ref: "Anything" }, meta: {}, ui: none },
    { name: "tail", label: none, type: { $ref: "List" }, meta: {}, ui: none },
  ] },
] } } } };
const listDescription = { type: listType, phrase: "A list of anything", code: "List Anything", kind: "list" as const, kindLabel: "List" };
const dataLocationType = { $ref: "fixture-data-location-type" };
const allDataListType: LocusRootData["type"] = { $opaque: { name: "List", pure: { $variant: { cases: [
  { name: "Nil", label: none },
  { name: "Cons", label: none, fields: [
    { name: "head", label: none, type: dataLocationType, meta: {}, ui: none },
    { name: "tail", label: none, type: { $ref: "List" }, meta: {}, ui: none },
  ] },
] } } } };
// Supplied model answers for this exact admitted fixture roster. Fenel's
// production allDataRootTargets owns the filtering and location policy.
const allDataTargets = [
  { $tag: "PublicSource" }, { $tag: "ThisTabSource" },
  { $tag: "AccountSource", accountId: "account-a" },
  { $tag: "AccountSource", accountId: "account-b" },
  { $tag: "AccountSource", accountId: "account-c" },
].map(source => ({ $tag: "ValuePresentationTarget", source, focus: { $tag: "RootFocus" } }));
const allDataDescriptions = [
  { type: allDataListType, phrase: "A list of data locations", code: "List DataLocation", kind: "list" as const, kindLabel: "List" },
  { type: dataLocationType, phrase: "Data location", code: "DataLocation", kind: "named" as const, kindLabel: "Named" },
];
const singletonDescriptions = [
  ["Positive infinity", Infinity], ["Negative infinity", -Infinity], ["Not a number", NaN], ["Negative zero", -0], ["Zero", 0],
].map(([phrase, value]) => ({ type: { $refined: { base: { $ref: "Number" }, set: { $tag: "SeEnum" as const, values: [value] } } },
  phrase: String(phrase), code: String(phrase), kind: "refined" as const, kindLabel: "Refined" }));

const item = (id: string, caption: string, value: string) => ({ id, caption,
  source: { kind: "expr" as const, expr: { kind: "literal" as const, value } } });
function accountRoot(accountId: string): LocusRootData {
  const isB = accountId === "account-b";
  return {
    id: `root-${accountId}`, name: "All data", type: scenario === "type-transport"
      ? singletonDescriptions[Number(new URL(location.href).searchParams.get("atom") ?? "1")]!.type : listType,
    typeDescriptions: [scenario === "incomplete-type-description" ? { ...listDescription, phrase: "" } : listDescription,
      ...["Anything", "List", "String"].map(name => ({ type: { $ref: name }, phrase: name, code: name, kind: "named" as const, kindLabel: "Named" })),
      ...(scenario === "type-transport" ? singletonDescriptions : [])],
    expr: { kind: "literal", value: [] },
    revision: 4, persisted: true, canEdit: true, layout: { kind: "grid" },
    items: [{ ...item("root-only", scenario === "unnamed-data" ? "   " : "Root value", isB ? stackedChromeScenario || scenario === "account-menu" || scenario === "type-inspection" || scenario === "unnamed-data" || scenario === "logo-quick" || scenario === "logo-all-data-navigation" ? "Account B root data" : "B ROOT SHOULD NOT APPEAR" : "Account C data"),
      ...(scenario === "unnamed-data" ? { valueType: { $ref: "String" } } : {}) }],
    lists: isB ? [{ id: "saved-list-b", name: "Saved B list", active: false,
      view: { kind: "list", items: [item("saved-b-value", "Saved B item", "Saved B data")] },
      referenceId: "list-b", sourceReferenceId: "list-b", rootRevision: 4, valueType: listType, derivedCanvas: false }] : [],
    expressions: {}, referenceId: `ref-${accountId}`,
  } as LocusRootData;
}

function serverProjection(accountId: string): ReadyWorkspaceBootstrap {
  const publicSource = scenario.startsWith("public");
  const lens = {
    $tag: "WorkspaceLens" as const, id: accountId === "account-c" ? "lens-c" : "saved-lens-b", title: none,
    source: publicSource ? { $tag: "PublicSource" as const } : { $tag: "AccountSource" as const, accountId },
    focus: scenario === "unnamed-data" ? { $tag: "ValueFocus" as const, listId: `root-${accountId}`, itemId: "root-only", path: [], rootItem: true, passThrough: [] }
      : accountId === "account-b" && !publicSource && !stackedChromeScenario && scenario !== "account-menu" && scenario !== "type-inspection" && scenario !== "type-transport"
      ? { $tag: "ListFocus" as const, listId: "saved-list-b" } : { $tag: "RootFocus" as const },
    presentation: { $tag: "ListPresentation" as const },
    ...(scenario === "owner-navigation-held" ? { subject: { $tag: "Just" as const, _0: inspectedType } } : {}),
  };
  const value: WorkspacePreferences = { $tag: "WorkspacePreferences", lenses: [lens], activeLensId: lens.id,
    display: { $tag: "SingleLens" }, bar: { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } }, presentations: [] };
  if (toolbarControlsScenario) {
    const selected: WorkspaceLens = { ...lens, placement: scenario === "toolbar-controls-floating"
      ? { $tag: "FreePlacement", x: 160, y: 32, width: 550, height: 440 } : { $tag: "DockedPlacement" } };
    const sibling: WorkspaceLens = { ...lens, id: "toolbar-hidden-lens", source: { $tag: "AccountSource", accountId: "account-c" },
      focus: { $tag: "RootFocus" }, placement: { $tag: "DockedPlacement" } };
    const multiple = scenario === "toolbar-controls-multiple";
    value.lenses = scenario === "toolbar-controls-hidden" || multiple ? [selected, sibling] : [selected];
    if (multiple) value.display = { $tag: "TiledLenses" };
    const visible = multiple ? value.lenses : [selected];
    return { status: "ready", value, valueType: { $ref: "fixture-workspace-type" }, itemId: "workspace-item",
      activeLens: { $tag: "Just", _0: selected }, visibleLenses: visible,
      tilePlan: { columns: visible.length, rows: 1, lensIds: visible.map(entry => entry.id) },
      presentations: visible.map(entry => ({ lensId: entry.id, code: "list" })) };
  }
  if (stackedChromeScenario) {
    const behind = { ...lens, id: "stacked-behind" };
    const sibling = { ...lens, id: "stacked-sibling", source: { $tag: "AccountSource" as const, accountId: "account-c" } };
    const visible = scenario === "stacked-chrome-tiled" ? [lens, sibling] : [lens];
    value.lenses = [behind, ...visible];
    value.display = { $tag: "GroupedLenses", activeGroupId: "stacked-chrome",
      groups: [{ $tag: "LensGroup", id: "stacked-chrome", merged: scenario !== "stacked-chrome-separated",
        layers: [[behind.id], visible.map(entry => entry.id)] }] };
    return { status: "ready", value, valueType: { $ref: "fixture-workspace-type" }, itemId: "workspace-item",
      activeLens: { $tag: "Just", _0: lens }, visibleLenses: visible,
      tilePlan: { columns: visible.length, rows: 1, lensIds: visible.map(entry => entry.id) },
      presentations: visible.map(entry => ({ lensId: entry.id, code: "list" })) };
  }
  if (logoScenario) {
    const publicDocked = scenario === "logo-public-docked" || scenario === "logo-public-addressed" || surfaceMountScenario || addressedRootPending || addressedRootProjected || readOnlyNewScenario;
    const publicLens: WorkspaceLens = { ...lens, id: "saved-public", source: { $tag: "PublicSource" },
      presentation: publicDocked ? { $tag: "AutomaticPresentation" } : lens.presentation,
      focus: scenario === "logo-public-root" || publicDocked || scenario === "logo-race" ? { $tag: "RootFocus" }
        : { $tag: "ValueFocus", listId: "public-fenel", itemId: "demo", path: [], rootItem: true, passThrough: [] },
      placement: publicDocked ? { $tag: "DockedPlacement" }
        : { $tag: "FreePlacement", x: 180, y: 24, width: 550, height: 440 } };
    if (surfaceMountScenario || scenario === "logo-public-new-readonly-all") publicLens.source = { $tag: "AllDataSource" };
    const other = { ...lens, id: "other-saved", title: { $tag: "Just" as const, _0: "Keep this lens" },
      source: { $tag: "AccountSource" as const, accountId: "account-c" }, focus: { $tag: "RootFocus" as const } };
    value.lenses = scenario.startsWith("logo-public") || scenario === "logo-race" || surfaceMountScenario || addressedRootPending || addressedRootProjected ? [publicLens, other]
      : scenario === "logo-existing" ? [lens, { ...publicLens, id: "saved-all", source: { $tag: "AllDataSource" }, focus: { $tag: "RootFocus" } }, other]
      : [scenario.startsWith("logo-local") ? { ...lens, source: { $tag: "ThisTabSource" as const }, focus: { $tag: "RootFocus" as const } }
        : scenario === "logo-quick" ? { ...lens, focus: { $tag: "RootFocus" as const } } : lens, other];
    value.activeLensId = scenario.startsWith("logo-public") || scenario === "logo-race" || surfaceMountScenario || addressedRootPending || addressedRootProjected ? publicLens.id : lens.id;
    if (scenario === "logo-public-new-readonly-existing") value.lenses.push({ ...lens, id: "existing-local", source: { $tag: "ThisTabSource" }, focus: { $tag: "RootFocus" } });
    if (surfaceMountScenario) value.display = { $tag: "GroupedLenses", activeGroupId: "fixture-group",
      groups: [{ $tag: "LensGroup", id: "fixture-group", merged: true, layers: [[publicLens.id]] }] };
    if (scenario === "logo-race") value.display = { $tag: "TiledLenses" };
    const visible = scenario === "logo-race" ? value.lenses : [value.lenses[0]!];
    return { status: "ready", value, valueType: { $ref: "fixture-workspace-type" }, itemId: "workspace-item",
      activeLens: { $tag: "Just", _0: value.lenses[0]! }, visibleLenses: visible,
      tilePlan: { columns: visible.length, rows: 1, lensIds: visible.map(lens => lens.id) },
      presentations: value.lenses.map(lens => ({ lensId: lens.id, code: "list" })) };
  }
  if (scenario.startsWith("new-function")) {
    value.lenses.push({ ...lens, id: "own-account-root", source: { $tag: "AccountSource", accountId: authenticatedAccount },
      focus: { $tag: "RootFocus" } });
  }
  if (scenario === "portal-focus" || scenario === "close-first" || scenario === "lens-controls") {
    const first = { ...lens, id: "lens-first", source: { $tag: "AccountSource" as const, accountId: "account-c" },
      focus: { $tag: "RootFocus" as const } };
    value.lenses = [first, scenario === "lens-controls" ? { ...lens,
      placement: { $tag: "FreePlacement", x: 220, y: 0, width: 390, height: 350 } } : lens];
    value.activeLensId = scenario === "lens-controls" ? lens.id : first.id; value.display = { $tag: "TiledLenses" };
    return { status: "ready", value, valueType: { $ref: "fixture-workspace-type" }, itemId: "workspace-item",
      activeLens: { $tag: "Just", _0: scenario === "lens-controls" ? value.lenses[1]! : first }, visibleLenses: value.lenses,
      tilePlan: { columns: 2, rows: 1, lensIds: value.lenses.map(lens => lens.id) },
      presentations: value.lenses.map(lens => ({ lensId: lens.id, code: "list" })) };
  }
  return { status: "ready", value, valueType: { $ref: "fixture-workspace-type" }, itemId: "workspace-item",
    activeLens: { $tag: "Just", _0: lens }, visibleLenses: [lens], tilePlan: { columns: 1, rows: 1, lensIds: [lens.id] },
    presentations: [{ lensId: lens.id, code: "list" }] };
}
let projection = serverProjection("account-b");
let settingsRoot: LocusRootData;
function bootstrap(epoch: number): Promise<WorkspaceBootstrap> {
  projection = serverProjection(scenario.startsWith("stale-personal") || scenario === "personal-login" ? "personal"
    : authenticatedAccount === "account-c" ? "account-c" : "account-b");
  const root = { ...accountRoot("personal"), items: [{ id: "workspace-item", caption: "Workspace",
    source: { kind: "expr" as const, expr: { kind: "literal" as const, value: projection.value } }, valueType: projection.valueType }] };
  settingsRoot = root;
  const response: WorkspaceBootstrap = { accountId: authenticatedAccount, epoch, personalAccountId: "personal", root,
    accounts: [{ accountId: "account-a", name: "Account A", slug: "a", role: "owner" },
      { accountId: "account-b", name: "Account B", slug: "b", role: "owner" },
      { accountId: "account-c", name: "Account C", slug: "c", role: "owner" },
      { accountId: "personal", name: "Personal workspace", slug: "personal-fixture", role: "personal" }],
    workspace: scenario === "deferred" ? { status: "deferred" } : projection };
  if (addressedRootProjected || scenario.startsWith("startup-root") || scenario === "logo-public-new-readonly-all") response.allDataRoot = projectAllDataRoot(modelExports as unknown as WorkspaceModel,
    [{ id: "public", label: "Fenel", icon: "globe" }, { id: "local", label: "Local", icon: "monitor" },
      ...response.accounts.filter(account => account.accountId !== response.personalAccountId || account.accountId === response.accountId)
        .map(account => ({ id: account.accountId, label: account.name || account.slug }))]);
  if (scenario === "malformed") return Promise.reject(new Error("The saved workspace value is malformed. Correct it before continuing."));
  if (scenario === "startup-private-failure" && bootstrapFailures++ === 0) return Promise.reject(new Error("The saved lens request is temporarily unavailable."));
  if (scenario === "slow-bootstrap" || scenario === "new-function-slow" || localAuthContinuation || snapshotRace) return new Promise(resolve => { releaseBootstrap = () => { bootstrapReleased = true; resolve(response); }; });
  bootstrapReleased = true;
  return Promise.resolve(response);
}

Object.assign(globalThis, { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  const request = { method, path, account: headers.get("X-Fenel-Reader-Account"), aborted: false };
  requests.push(request);
  const signal = init?.signal;
  signal?.addEventListener("abort", () => { request.aborted = true; }, { once: true });
  if (path === "/api/auth/me") {
    if (holdSubject) return new Promise<Response>((resolve, reject) => {
      releaseSubject = resolve;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return Response.json({ subject: { $tag: "User", accountId: authenticatedAccount, userId: "fixture-user" } });
  }
  if (startupScenario && path === "/api/auth/personal-account") return Response.json({ accountId: "personal" });
  if (startupScenario && path === "/api/workspace-bootstrap") return Response.json(await bootstrap(sessionEpoch()));
  if (method === "GET" && path === "/api/locus-root") {
    if (!request.account) throw new Error("A workspace data read lost its captured account.");
    if (scenario === "stale-personal-conflict" && request.account === "personal") return Response.json({ root: settingsRoot });
    const response = () => scenario === "type-transport"
      ? Response.json(encodeCheckpointValue({ root: accountRoot(request.account!) }), { headers: { "X-Fenel-Value-Encoding": CHECKPOINT_VALUE_ENCODING } })
      : Response.json({ root: accountRoot(request.account!) });
    if (scenario === "slow-reader" && request.account === "account-b") return new Promise<Response>((resolve, reject) => {
      heldReads.push(() => { if (!signal?.aborted) resolve(response()); });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return response();
  }
  if (method === "PUT" && path === "/api/locus-root" && (ownerNavigation || logoScenario || toolbarControlsScenario || scenario.startsWith("stale-personal") || scenario.startsWith("new-function") || scenario === "portal-focus" || scenario === "close-first" || scenario === "lens-controls" || scenario === "type-transport")) {
    if (request.account !== "personal") throw new Error("Lens correction must only save its own settings.");
    const write = decodeCheckpointValue(JSON.parse(String(init?.body)), headers.get("X-Fenel-Value-Encoding")) as { command: { kind: string; itemId: string; item: LocusRootData["items"][number] } };
    if (write.command.kind !== "replace" || write.command.itemId !== "workspace-item") throw new Error("Lens correction changed unrelated data.");
    if (scenario === "stale-personal-conflict" && requests.filter(request => request.method === "PUT").length === 1) {
      return Response.json({ error: "The saved settings changed in another tab." }, { status: 409 });
    }
    settingsRoot = { ...settingsRoot, revision: settingsRoot.revision + 1, items: [write.command.item] };
    if (scenario === "close-first") return new Promise<Response>((resolve, reject) => {
      heldSaves.push(() => { if (!signal?.aborted) resolve(Response.json({ root: settingsRoot })); });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return Response.json({ root: settingsRoot });
  }
  if (path === "/api/readiness") return Response.json({ status: "ready" });
  if (logoScenario && method === "GET" && path === "/api/saved-queries") return Response.json({ categories: [], queries: [] });
  throw new Error(`Unexpected workspace startup request: ${method} ${path}`);
} });

// Fixed answers from this fixture's supplied server projection exercise only
// handoff plumbing. They do not implement validation or preference policy.
const modelExports = {
  workspaceCall(name: string, ...args: unknown[]): unknown {
    modelCalls.push(name);
    if (name === "applyWorkspaceCommands") return { $tag: "Ok", _0: modelExports.applyWorkspace(args[0] as WorkspacePreferences, args[1] as WorkspaceCommand[]) };
    if (name === "workspaceBootstrapReady") return { $tag: "WorkspaceBootstrapPlan", value: args[0], itemId: args[1],
      visibleLenses: projection.visibleLenses, activeLens: projection.activeLens, tilePlan: projection.tilePlan,
      presentations: projection.visibleLenses.map(lens => ({ lensId: lens.id,
        code: modelExports.workspaceCall("workspacePresentationCode", modelExports.workspaceCall("workspacePresentationFor", args[0], lens, none)) })) };
    if (name === "workspacePresentationCode") return modelExports.workspaceLayout(args[0] as WorkspaceLens["presentation"]) ?? "auto";
    if (name === "workspacePresentationFromCode") return { $tag: "Ok", _0: modelExports.workspacePresentation(args[0] as string) };
    if (name === "workspaceValueType") return projection.valueType;
    if (name === "workspaceSourceEqual") return JSON.stringify(args[0]) === JSON.stringify(args[1]);
    if (ownerNavigation) {
      const lens = args[0] as WorkspaceLens;
      if (name === "workspaceLensWithFocus") return { ...lens, focus: args[1], presentation: { $tag: "AutomaticPresentation" }, subject: none };
      if (name === "workspaceLensWithPresentation") return { ...lens, presentation: args[1] };
      if (name === "workspaceLensWithPlacement") return { ...lens, placement: args[1] };
      if (name === "workspacePresentationFor") return (args[1] as WorkspaceLens).presentation;
      if (name === "workspaceFocusEqual") return JSON.stringify(args[0]) === JSON.stringify(args[1]);
      if (name === "workspaceGroupedDisplay") return { $tag: "GroupedLenses", activeGroupId: "fixture-group",
        groups: [{ $tag: "LensGroup", id: "fixture-group", layers: [[projection.value.activeLensId]], merged: true }] };
    }
    if ((logoScenario || ownerNavigation) && name === "defaultWorkspaceLens") return { $tag: "WorkspaceLens", id: args[0], title: none,
      source: args[1], focus: { $tag: "RootFocus" }, presentation: { $tag: "AutomaticPresentation" }, placement: { $tag: "DockedPlacement" } };
    if (logoScenario && name === "workspaceLensWithFocus") return { ...(args[0] as WorkspaceLens), focus: args[1],
      presentation: { $tag: "AutomaticPresentation" }, subject: none };
    if (logoScenario && name === "workspaceGroupedDisplay") return { $tag: "GroupedLenses", activeGroupId: "fixture-group",
      groups: [{ $tag: "LensGroup", id: "fixture-group", layers: [[projection.value.activeLensId]], merged: true }] };
    // Only shortcut queries observe this mock signal. The admitted root query
    // must not subscribe bootstrap acquisition to later shortcut delivery.
    if (name === "workspaceLensShortcuts" || name === "defaultLensShortcuts") return defaultShortcuts();
    const answers: Record<string, unknown> = {
      validateWorkspacePreferences: { $tag: "Ok", _0: projection.value },
      workspaceActiveLens: localAuthContinuation && name === "workspaceActiveLens"
        ? { $tag: "Just", _0: (args[0] as WorkspacePreferences).lenses.find(lens => lens.id === (args[0] as WorkspacePreferences).activeLensId) }
        : projection.activeLens,
      workspaceVisibleLenses: localAuthContinuation && name === "workspaceVisibleLenses"
        ? [(args[0] as WorkspacePreferences).lenses.find(lens => lens.id === (args[0] as WorkspacePreferences).activeLensId)!]
        : projection.visibleLenses.map(lens => ({ ...lens })),
      workspaceTilePlan: projection.tilePlan,
      workspacePresentationFor: projection.visibleLenses[0]!.presentation,
      ...(logoScenario ? { allDataRootTargets: scenario === "startup-root-local-navigation" || localAuthContinuation && untrack(subject)?.$tag !== "User"
        ? allDataTargets.slice(0, 2) : allDataTargets } : {}),
      ...(scenario === "type-transport" || logoScenario ? { workspaceFocusEqual: true, workspaceSourceEqual: true } : {}),
    };
    if (!(name in answers)) throw new Error(`Unexpected model call: ${name}`);
    return answers[name];
  },
  workspaceLayout: (presentation?: WorkspaceLens["presentation"]) => ownerNavigation
    ? presentation?.$tag === "TablePresentation" ? "table" : presentation?.$tag === "GridPresentation" ? "grid"
      : presentation?.$tag === "CodePresentation" ? "code" : presentation?.$tag === "ValuePresentation" ? "value" : "list"
    : logoScenario && presentation?.$tag === "AutomaticPresentation" ? undefined : "list",
  workspacePresentation: (kind?: string) => ownerNavigation ? ({ $tag: kind === "table" ? "TablePresentation"
    : kind === "grid" ? "GridPresentation" : kind === "code" ? "CodePresentation" : "ValuePresentation" }) : ({ $tag: "ListPresentation" }),
  workspaceValueType: () => projection.valueType,
  allDataRootTypes: () => ({ type: allDataListType, targetType: dataLocationType }),
  allDataRootDescriptions: () => allDataDescriptions,
  defaultWorkspace: () => { throw new Error("An existing saved workspace must not become a fresh default."); },
  applyWorkspace(_value: WorkspacePreferences, commands: WorkspaceCommand[]) {
    if (!logoScenario && !ownerNavigation && !toolbarControlsScenario && !scenario.startsWith("stale-personal") && !scenario.startsWith("new-function") && scenario !== "portal-focus" && scenario !== "close-first" && scenario !== "lens-controls" && scenario !== "type-transport") throw new Error("Startup must not edit saved preferences.");
    edits.push(...commands);
    editBatches.push(commands);
    if (logoScenario || ownerNavigation) {
      // Transport-only projection of supplied answers. The production surface
      // chooses commands, guards edits and owns the existing lens lifetime.
      let value = _value;
      for (const command of commands) {
        if (command.$tag === "AddWorkspaceLens") value = { ...value, lenses: [...value.lenses, command.lens as WorkspaceLens] };
        else if (command.$tag === "SelectWorkspaceLens") value = { ...value, activeLensId: command.id as string };
        else if (command.$tag === "SetWorkspaceDisplay") value = { ...value, display: command.display as WorkspacePreferences["display"] };
        else if (surfaceMountScenario && command.$tag === "SetLensGroupMerged") {
          if (command.id !== "fixture-group" || value.display.$tag !== "GroupedLenses"
            || typeof command.merged !== "boolean") throw new Error("The surface fixture only transports its supplied group's border switch.");
          value = { ...value, display: { ...value.display, groups: value.display.groups.map(group => group.id === command.id
            ? { ...group, merged: command.merged as boolean } : group) } };
        }
        else if (command.$tag === "EditWorkspaceLens") {
          const edit = command.command as WorkspaceCommand;
          value = { ...value, lenses: value.lenses.map(lens => lens.id !== command.id ? lens
            : edit.$tag === "SetLensFocus" ? { ...lens, focus: edit.focus as WorkspaceLens["focus"], presentation: { $tag: "AutomaticPresentation" as const }, subject: none }
            : edit.$tag === "SetLensSource" ? { ...lens, source: edit.source as WorkspaceLens["source"], focus: { $tag: "RootFocus" as const }, presentation: { $tag: "AutomaticPresentation" as const }, subject: none }
            : edit.$tag === "SetLensPlacement" ? { ...lens, placement: edit.placement as WorkspaceLens["placement"] }
            : edit.$tag === "SetLensPresentation" && ownerNavigation ? { ...lens, presentation: edit.presentation as WorkspaceLens["presentation"] }
            : edit.$tag === "SetLensSubject" ? { ...lens, subject: edit.subject as WorkspaceLens["subject"] }
            : (() => { throw new Error(`Unsupported logo lens command ${edit.$tag}`); })()) };
        } else if ((ownerNavigation || scenario === "addressed-root-projected" || scenario === "startup-root-local-navigation" || localAuthContinuation || readOnlyNewScenario)
          && (command.$tag === "OpenWorkspaceLens" || command.$tag === "SplitWorkspaceLens")) {
          // Fixed layout answers for the two-lens transport scenarios. The
          // navigation tests assert which real production command selected it.
          const existing = value.lenses[0]!.id;
          const opened = command.id as string;
          value = { ...value, activeLensId: opened, display: { $tag: "GroupedLenses", activeGroupId: "fixture-group",
            groups: [{ $tag: "LensGroup", id: "fixture-group", merged: true,
              layers: command.$tag === "OpenWorkspaceLens" ? [[existing], [opened]] : [[existing, opened]] }] } };
        } else throw new Error(`Unsupported logo command ${command.$tag}`);
      }
      const active = value.lenses.find(lens => lens.id === value.activeLensId)!;
      const visible = ownerNavigation && value.display.$tag === "GroupedLenses"
        ? value.display.groups[0]!.layers.at(-1)!.map(id => value.lenses.find(lens => lens.id === id)!)
        : value.display.$tag === "TiledLenses" ? value.lenses : [active];
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: active }, visibleLenses: visible,
        tilePlan: { columns: visible.length, rows: 1, lensIds: visible.map(lens => lens.id) } };
      return value;
    }
    if (scenario === "type-transport") {
      let value = _value;
      for (const raw of commands) {
        const command = raw as { $tag: string; id: string; command: { $tag: string; focus: WorkspacePreferences["lenses"][number]["focus"]; subject: WorkspacePreferences["lenses"][number]["subject"] } };
        if (command.$tag !== "EditWorkspaceLens" || command.id !== "saved-lens-b") throw new Error("Type inspection changed another lens.");
        value = { ...value, lenses: value.lenses.map(lens => lens.id !== command.id ? lens
          : command.command.$tag === "SetLensFocus" ? { ...lens, focus: command.command.focus }
          : command.command.$tag === "SetLensSubject" ? { ...lens, subject: command.command.subject }
          : (() => { throw new Error("Type inspection changed unrelated lens data."); })()) };
      }
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: value.lenses[0]! }, visibleLenses: value.lenses };
      return value;
    }
    if (scenario.startsWith("new-function")) {
      if (commands.length !== 1 || commands[0]?.$tag !== "OpenWorkspaceLens"
        || commands[0]?.id !== "own-account-root") throw new Error("New function must open only its own account's saved root.");
      const own = _value.lenses.find(lens => lens.id === "own-account-root")!;
      const value = { ..._value, activeLensId: own.id };
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: own }, visibleLenses: [own],
        tilePlan: { columns: 1, rows: 1, lensIds: [own.id] } };
      return value;
    }
    if (scenario === "lens-controls" || toolbarControlsScenario) {
      let value = _value;
      for (const raw of commands) {
        const command = raw as { $tag: string; id: string; command?: { $tag: string; placement: WorkspacePreferences["lenses"][number]["placement"] } };
        if (command.$tag === "SelectWorkspaceLens") value = { ...value, activeLensId: command.id };
        else if (command.$tag === "EditWorkspaceLens" && command.command?.$tag === "SetLensPlacement") {
          value = { ...value, lenses: value.lenses.map(lens => lens.id === command.id ? { ...lens, placement: command.command!.placement } : lens) };
        } else throw new Error(`Unsupported lens-controls command ${command.$tag}`);
      }
      const visible = value.display.$tag === "TiledLenses" ? value.lenses : [value.lenses.find(lens => lens.id === value.activeLensId)!];
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: value.lenses.find(lens => lens.id === value.activeLensId)! },
        visibleLenses: visible, tilePlan: { columns: visible.length, rows: 1, lensIds: visible.map(lens => lens.id) } };
      return value;
    }
    if (scenario === "close-first") {
      if (commands.length !== 1 || (commands[0] as { $tag?: string }).$tag !== "CloseWorkspaceLens"
        || (commands[0] as { id?: string }).id !== "lens-first") throw new Error("This fixture only closes its first lens.");
      const second = _value.lenses[1]!;
      const value = { ..._value, activeLensId: second.id, display: { $tag: "VisibleLenses" as const, ids: [second.id] } };
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: second }, visibleLenses: [second],
        tilePlan: { columns: 1, rows: 1, lensIds: [second.id] } };
      return value;
    }
    if (scenario === "portal-focus") {
      const second = { ..._value.lenses[1]!, focus: { $tag: "RootFocus" as const } };
      const value = { ..._value, activeLensId: second.id, lenses: [_value.lenses[0]!, second] };
      projection = { ...projection, value, activeLens: { $tag: "Just", _0: second }, visibleLenses: value.lenses };
      return value;
    }
    projection = serverProjection("account-a");
    return projection.value;
  },
};

const fixture = {
  usePublicProjection: (ready: ReadyWorkspaceBootstrap) => { projection = ready; },
  localSource: () => {
    if (localSource?.epoch === untrack(sessionEpoch)) return localSource;
    const id = localAuthContinuation ? LOCAL_BROWSER_SOURCE_ID : "fixture-local", clipboardId = `${id}:clipboard`;
    const clipboardExpression = { kind: "literal" as const, value: { __list: [] } };
    // Exact structural Clipboard wire from tabDataWithClipboard/tabDataRoot:
    // it is an ordinary saved reference, and root.lists is intentionally empty.
    const items = [{ id: clipboardId, caption: "Clipboard", representations: { Codeable: { codeName: "clipboard" } },
      source: { kind: "ref" as const, ref: { kind: "savedExpr" as const, id: clipboardId } } },
      ...(scenario === "logo-local-persisted" || localAuthContinuation || outerPortalScenario ? [item("local-saved", "Saved local item", "Saved local text")] : [])];
    const root: LocusRootData = retainedLocalRoot ??= { id, name: "Local", type: listType,
      expr: { kind: "literal", value: { __list: items.map(entry => entry.source.kind === "ref"
        ? { kind: "ref", savedExprId: entry.source.ref.id } : entry.source.expr) } },
      revision: 0, persisted: false, canEdit: true, layout: { kind: "grid" }, items, lists: [],
      expressions: { [clipboardId]: clipboardExpression }, referenceId: id };
    const saved = [{ id: clipboardId, slug: "clipboard", name: "Clipboard",
      query: { kind: "expression", expr: clipboardExpression } }];
    const epoch = untrack(sessionEpoch);
    firstCreationReaderEpoch ??= epoch;
    const ingestExternal: LocalTabSource["ingestExternal"] = async (_snapshot, options = {}) => {
      if (!localAuthContinuation) throw new Error("This fixture does not supply an external ingress response.");
      const attempt = { epoch, aborted: false }; localPasteAttempts.push(attempt);
      return new Promise((resolve, reject) => {
        const abort = () => { attempt.aborted = true; reject(options.signal?.reason ?? new Error("The source was retired.")); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) { abort(); return; }
        heldLocalPastes.push(() => {
          if (options.signal?.aborted) return;
          options.signal?.removeEventListener("abort", abort);
          const added = item("local-pasted", "Pasted data", "Pasted before sign-in");
          retainedLocalRoot = { ...retainedLocalRoot!, revision: retainedLocalRoot!.revision + 1,
            items: [...retainedLocalRoot!.items, added] };
          setLocalPublicationVersion(version => version + 1);
          localPastePublications++;
          const result = { root: retainedLocalRoot, items: [added], notes: [] };
          options.onPublished?.(result);
          resolve(result);
        });
      });
    };
    let ordinaryModel: Promise<WorkspaceModel> | undefined;
    const ordinary = async (operation: LocalOrdinaryOperation) => {
      ordinaryModel ??= import("./workspace-model-loader").then(module => module.loadWorkspaceModel()).catch(error => { ordinaryModel = undefined; throw error; });
      const model = await ordinaryModel;
      return runLocalOrdinaryOperation(model, operation);
    };
    localSource = { id, epoch, ordinary, revision: () => { localPublicationVersion(); return retainedLocalRoot?.revision ?? 0; },
      firstPaint: async () => {}, readReady: async () => {}, ready: () => { localPreparations++; return forever; },
      root: () => {
        localRootReads++;
        const current = retainedLocalRoot ?? root;
        return epoch !== firstCreationReaderEpoch && scenario.endsWith("-draft-readonly") ? { ...current, canEdit: false }
          : epoch !== firstCreationReaderEpoch && scenario.endsWith("-draft-changed-root") ? { ...current, id: "changed-local-root" } : current;
      }, savedValues: () => saved, ingestExternal,
    } as unknown as LocalTabSource;
    return localSource;
  },
  localClient: (source: LocalTabSource) => createLocalApiClient(source),
  state: () => ({ requests: [...requests], dynamicModules: [...dynamicModules], errors: [...errors], modelCalls: [...modelCalls],
    bootstrapReleased, publicSnapshotReleased, modelReleased, epoch: untrack(sessionEpoch), bar, lateChildReads,
    subject: untrack(subject), authLoading: untrack(loading), authError: untrack(subjectResolutionError),
    notices: notifications ? untrack(notifications.notices) : [], edits, editBatches, localPasteAttempts: [...localPasteAttempts], localPastePublications,
    localSourceId: localSource?.id, localSourceEpoch: localSource?.epoch, localRootId: retainedLocalRoot?.id,
    localTransfersPending: untrack(localTransfersPending),
    preferences: projection.value, modelPreparations, publicPreparations, localPreparations, localRootReads, homeRegistered: !!registeredHome, homeAttempts, homeResults: [...homeResults],
    paneIds: [...panes.keys()], heldPaneFlushes: heldPaneFlushes.length, heldPreferences: heldPreferences.length }),
  retainLocalNotice: () => notifications?.update(Symbol("local-operation"), {
    notices: [{ id: "local-paste", tone: "info", message: "Adding the data you pasted…", detail: "Opening local data…" }],
    dismiss: () => {},
  }),
  registerPane: (pane: WorkspacePane) => {
    panes.set(pane.id, pane);
    const stopFlush = pane.registerFlush(() => holdingPaneFlushes
      ? new Promise<boolean>(resolve => heldPaneFlushes.push(() => resolve(true))) : Promise.resolve(true));
    return () => { stopFlush(); if (panes.get(pane.id) === pane) panes.delete(pane.id); };
  },
  suggestionRegistrationLifetime: async (id: string) => {
    const pane = panes.get(id);
    if (!pane?.registerSuggestions) throw new Error("The real pane registration is unavailable.");
    let closes = 0;
    const owner: DataInspectionSuggestions = { items: () => [], open() {}, close() { closes++; },
      invalidate() {}, hold: () => () => {}, warm() {}, pending: () => false,
      issue: () => undefined, read: () => undefined, select() {} };
    const host = document.createElement("div"); document.body.append(host);
    let hide = () => {};
    const caught: string[] = [];
    function Registration() { onSettled(() => pane!.registerSuggestions!(owner)); return null; }
    const stop = render(() => {
      const [visible, setVisible] = createSignal(true); hide = () => setVisible(false);
      return <Errored fallback={error => { caught.push((error() as Error).stack ?? String(error())); return null; }}>
        <Show when={visible()}><Registration /></Show>
      </Errored>;
    }, host);
    flush(); await Promise.resolve();
    const mounted = untrack(pane.suggestions!) === owner;
    hide(); flush(); await Promise.resolve(); flush();
    const cleared = untrack(pane.suggestions!) === undefined;
    stop(); host.remove();
    if (caught.length) return { mounted, cleared, caught, closes };
    const ownedRelease = pane.registerSuggestions(owner);
    createRoot(stopOwned => {
      try { createMemo(() => { ownedRelease(); return true; })(); }
      catch (error) { caught.push((error as Error).stack ?? String(error)); }
      finally { stopOwned(); }
    });
    await Promise.resolve(); flush();
    if (caught.length) return { mounted, cleared, caught, closes };
    const oldRelease = pane.registerSuggestions(owner);
    const currentRelease = pane.registerSuggestions(owner);
    oldRelease(); flush();
    const sameOwnerRetained = untrack(pane.suggestions!) === owner;
    currentRelease();
    const replacement = { ...owner };
    const replacementRelease = pane.registerSuggestions(replacement);
    await Promise.resolve(); flush();
    const replacementRetained = untrack(pane.suggestions!) === replacement;
    replacementRelease(); await Promise.resolve(); flush();
    return { mounted, cleared, caught, closes, sameOwnerRetained, replacementRetained,
      finalCleared: untrack(pane.suggestions!) === undefined };
  },
  navigate: (id: string, target: Extract<WorkspacePresentationTarget, { $tag: "ValuePresentationTarget" }>, mode?: WorkspaceLensOpenMode, presentation?: LocusLayoutChoice,
    intent?: { name?: string; icon?: string }) =>
    (panes.get(id)?.onDataTarget as ((...args: unknown[]) => void) | undefined)?.(target, mode, presentation, intent),
  cancelNavigation: (id: string) => (panes.get(id) as { navigationPending?: () => { cancel: () => void } | undefined } | undefined)
    ?.navigationPending?.()?.cancel(),
  openLens: (id: string, mode: WorkspaceLensOpenMode, presentation: LocusLayoutChoice) => {
    const pane = panes.get(id);
    pane?.onOpenLens(pane.focus(), mode, presentation);
  },
  source: (id: string, source: string) => panes.get(id)?.onSource(source),
  holdPaneFlushes: () => { holdingPaneFlushes = true; },
  releasePaneFlushes: () => { holdingPaneFlushes = false; for (const release of heldPaneFlushes.splice(0)) release(); },
  prepareDetached: () => {
    modelPreparations++;
    if ((scenario === "stale-personal-prepare-failure" || scenario === "public-model-prepare-failure") && modelPreparations === 1) throw new Error("The lens model was temporarily unavailable.");
  },
  selectSaved: (data: LocusRootData) => {
    const saved = data.items.find(item => item.id === "workspace-item");
    if (!saved || saved.source?.kind !== "expr" || saved.source.expr.kind !== "literal") throw new Error("The fixture settings are unavailable.");
    // Addressed navigation has already supplied its current projection through
    // applyWorkspace. Acknowledging that same saved draft must not restore the
    // fixture's original public source over the accepted Local destination.
    if (!logoScenario && !ownerNavigation && !toolbarControlsScenario) projection = serverProjection("personal");
    return { id: saved.id, value: saved.source.expr.value };
  },
  moduleStarted: (name: string) => { dynamicModules.push(name); },
  throwPublicMismatch: () => { throw new PublicBootstrapMismatchError(); },
  attemptPublicPreparation: () => {
    publicPreparations++;
    if (publicPreparations === 1) throw new Error("The data tools were temporarily unavailable.");
    return forever;
  },
  waitForModel: () => modelReady,
  waitForever: () => forever,
  releaseModel: () => { modelReleased = true; resolveModel(); },
  releaseBootstrap: () => releaseBootstrap?.(),
  releaseLocalPaste: () => { for (const release of heldLocalPastes.splice(0)) release(); },
  waitForPublicSnapshot: () => publicSnapshotReady,
  releasePublicSnapshot: () => releasePublicSnapshot(),
  releaseSubject: (kind: "anonymous" | "user" | "failed") => {
    holdSubject = false;
    releaseSubject?.(kind === "failed" ? new Response("Unavailable", { status: 503 })
      : Response.json({ subject: kind === "user"
        ? { $tag: "User", accountId: authenticatedAccount, userId: "fixture-user" }
        : { $tag: "Anonymous" } }));
  },
  retrySubject: () => refreshSubject().catch(() => undefined),
  beginSubjectRecheck: () => { holdSubject = true; void refreshSubject().catch(() => undefined); },
  lateChildRequested,
  waitForLateChild: () => { lateChildReads++; return lateChildReady; },
  openLateChild: () => { setLateChildRequested(true); flush(); },
  releaseLateChild: () => releaseLateChild("Descendant ready"),
  renderLoadingReader: (props: Parameters<typeof HomeEntry>[0]) => FixtureLoadingReader(props),
  loadPreferences: async (...args: Parameters<typeof loadWorkspacePreferences>) => {
    const ready = await loadWorkspacePreferences(...args);
    if (!args[0] || !scenario.startsWith("startup-private-preparation")) return ready;
    return new Promise<typeof ready>(resolve => { heldPreferences.push(() => resolve(ready)); });
  },
  releasePreferences: () => { for (const release of heldPreferences.splice(0)) release(); },
  releaseReads: () => { for (const release of heldReads.splice(0)) release(); },
  releaseSaves: () => { for (const release of heldSaves.splice(0)) release(); },
  switchAccount: async () => { authenticatedAccount = "account-c"; await refreshSubject(); flush(); },
  modelExports,
  setDefaultShortcuts: (shortcuts: LensShortcut[]) => { setDefaultShortcuts(shortcuts); flush(); },
  dispose: () => dispose(),
};
declare global { var workspaceStartupFixture: typeof fixture; }
globalThis.workspaceStartupFixture = fixture;

function HeldChild(props: { id: string }) {
  const result = createMemo(() => fixture.waitForLateChild());
  return <Loading fallback={<LensPending id={props.id} detail="Preparing expression…" />}>
    <div data-fixture-late-result>{result()}</div>
  </Loading>;
}

export function FixtureLoadingReader(props: Parameters<typeof HomeEntry>[0]) {
  // Preserve the reader's lazy property getters. Spreading them would read its
  // optional full runtime early and make lightweight data await editor tools.
  const reader = HomeEntry(props);
  return <>{reader}<Show when={fixture.lateChildRequested()}><HeldChild id={props?.pane?.id ?? "lens"} /></Show></>;
}

if (startupScenario && scenario !== "startup-recheck") void refreshSubject().catch(() => undefined);
else {
  await refreshSubject();
  if (scenario === "startup-recheck") { holdSubject = true; void refreshSubject().catch(() => undefined); }
}
const FixtureRoute = () =>
  <Errored fallback={error => {
    const failure = error();
    errors.push(failure instanceof Error ? failure.stack ?? failure.message : String(failure));
    return <pre data-fixture-route-error>{String(failure)}</pre>;
  }}><Show when={startupScenario} fallback={
    <Show when={sessionEpoch()} keyed>{epoch => <WorkspaceSurface bootstrap={bootstrap(epoch)} addressedHome={surfaceMountScenario || scenario === "logo-public-addressed" || addressedRootPending || addressedRootProjected} />}</Show>
  }><HomeSurface /></Show></Errored>;
const Router = createRouter({ history: memoryHistory(scenario === "addressed-root-projected-public-argument" ? "/?foo=x&home=public"
  : scenario === "addressed-root-projected-public-control" ? "/?home=public&foo=x"
  // Start at the existing Local address so New is usable in the actual
  // InitialAddress owner while the model is held. Clicking Local from All
  // data intentionally retains All data until that model answers.
  : outerPortalScenario ? "/~"
  : scenario === "logo-public-addressed" ? "/@fenel" : scenario.startsWith("startup-root") ? "/" : startupScenario ? "/app/home" : scenario === "home-address" ? "/?home=public"
  : scenario.startsWith("new-function") ? "/?new=function" : "/"), routes: [
  { path: "*data", component: FixtureRoute }, { path: "/app/home", component: FixtureRoute },
] });
function FixtureShell() {
  const center = createLocusNotificationCenter();
  const [chromeMount, setChromeMount] = createSignal<HTMLElement>();
  const [foldBar, setFoldBar] = createSignal<() => void>();
  const [accountOpen, setAccountOpen] = createSignal(false);
  let foldOwner: symbol | undefined;
  notifications = center;
  return <Errored fallback={error => {
    errors.push(String(error()));
    return <pre data-fixture-error>{String(error())}</pre>;
  }}>
    <WorkspaceChromeContext value={{ mount: chromeMount, setBar: value => { bar = value; }, setBeforeLeave: () => {},
      setFoldBar: (fold, owner) => {
        if (fold) { foldOwner = owner; setFoldBar(() => fold); }
        else queueMicrotask(() => { if (foldOwner === owner) { foldOwner = undefined; setFoldBar(undefined); } });
      },
      home: () => registeredHome?.(), setHome: (home, owner) => {
        if (home) { homeOwner = owner; registeredHome = home; }
        else if (homeOwner === owner) { homeOwner = undefined; registeredHome = undefined; }
      } }}>
      <LocusNotificationContext value={center}>
        <Show when={dashboardScenario}><LocusBackground /></Show>
        <Show when={!dashboardScenario}><div class="app-notification-host"><LocusNotificationHost /></div></Show>
        <ConfirmModalHost />
        <Show when={dashboardScenario} fallback={<Loading fallback={<p>Loading fixture…</p>}><Router /></Loading>}>
          <div class="dashboard dashboard--home" data-workspace="true" data-bar-mode="DockedBar" data-bar-position="BarTop">
            <header class="topbar">
              <a href="/" class="topbar__brand" aria-label="Fenel home" data-home-navigation="true" onClick={event => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !registeredHome) return;
                event.preventDefault(); homeAttempts++; void registeredHome().then(result => { homeResults.push(result); });
              }}><img src="/fixture/logo.png" alt="Fenel" class="topbar__logo" width="160" height="54" /></a><div class="topbar__workspace" ref={element => onSettled(() => { setChromeMount(element); })} />
              <Show when={foldBar()}><div class="topbar__actions"><LocusNotificationHost />
                <Show when={scenario === "stacked-chrome-compact"}><span class="locus-session-group">
                  <button type="button" class="locus-session-action locus-session-action--profile" aria-label="Account: Rom" aria-haspopup="dialog"
                    onClick={() => setAccountOpen(true)}><IconByName name="user" size={15} /><span class="locus-session-action__name">Rom</span></button>
                  <button type="button" class="locus-session-action locus-session-action--logout" aria-label="Log out"><IconLogout size={15} /></button>
                </span></Show>
              </div></Show>
              <Show when={foldBar()}><button type="button" class="workspace-pane__fold workspace-topbar-fold"
                aria-label="Hide the top bar" onClick={() => foldBar()?.()}><IconByName name="chevron-down" size={15} /></button></Show>
            </header>
            <main class="main-content--home"><Loading fallback={<p>Loading fixture…</p>}><Router /></Loading></main>
            <Show when={accountOpen()}><div role="dialog" aria-label="Account fixture"><button onClick={() => setAccountOpen(false)}>Close</button></div></Show>
          </div>
        </Show>
      </LocusNotificationContext>
    </WorkspaceChromeContext>
  </Errored>;
}
dispose = render(() => <FixtureShell />, document.body);
