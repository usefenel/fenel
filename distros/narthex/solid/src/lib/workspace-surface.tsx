import { createEffect, createMemo, createRoot, createSignal, Errored, For, getOwner, Loading, lazy, onCleanup, onSettled, runWithOwner, Show, snapshot, untrack } from "solid-js";
import { Portal } from "@solidjs/web";
import { useBeforeLeave, useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { guardLeave } from "./leave-guard";
import { Just, Nothing, peelMaybeValue } from "@fenel/engine/maybe-value";
import { subject, loading as authLoading, listAccessibleAccounts, type WorkspaceBootstrap } from "./auth";
import { assertCurrentSession, sessionEpoch } from "./browser-session";
import { loadWorkspacePreferences, type WorkspacePreferencesStore, type WorkspaceOrdinaryOperate } from "./workspace-preferences";
import { scopeFromWorkspace, scopeToWorkspace, layoutFromWorkspaceCode, workspaceSourceKey, workspaceSourceFromKey,
  type WorkspaceBar, type WorkspaceLens, type WorkspacePreferences, type WorkspacePresentation, type WorkspaceSource,
  type WorkspaceCommand, type WorkspaceFocus, type WorkspacePresentationTarget } from "./workspace-wire";
import { startAccountReaderRuntime, startLocalReaderRuntime, createPublicReaderRuntime, ReaderRuntimeProvider, type ReaderRuntime } from "./reader-runtime";
import type { AccountDataOption } from "./account-data-selector";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { LocusSelect } from "./locus-select";
import { LocusLoadFailure, LocusNotifications, locusNoticeKey, logSurfaceFailure, type LocusNotice } from "./locus-notifications";
import { confirmDialog, promptDialog } from "./confirm-modal";
import { IconPlus, IconSettings, IconByName } from "./icons";
import { useWorkspaceChrome } from "./workspace-chrome";
import type { WorkspaceLensOpenMode, WorkspaceNavigationIntent, WorkspacePane, WorkspacePendingNavigation } from "./workspace-pane";
import { LensDataSummary } from "./lens-data-summary";
import { displayNameText } from "./display-name";
import type { LocusLayoutChoice } from "./locus-layout-options";
import { createPublicApiClient, type ApiClient } from "./api";
import { loadPublicBootstrap, PublicBootstrapMismatchError, readPublicInitialAddress } from "./public-bootstrap";
import type { LocusRootData } from "./locus-root-data";
import { LensFrame, LensPending, LoadingScreen, PendingLensFrame, sharedStartupWait } from "./loading-screen";
import { CardLoadingIndicator } from "./value-card";
import { WorkspaceRootShelfContext, type RootShelfAction, type RootShelfHandler } from "./workspace-root-shelf";
import { WorkspaceLoadContext, type WorkspaceWait } from "./workspace-load";
import HomeEntry from "./home-entry";
import { PUBLIC_DATA_LOCATIONS, projectAllDataRootAsync } from "./all-data-root";
import { DataInspectionControls, type DataInspectionMode } from "./DataInspectionDialog";
import type { LensShortcut, LensTypedSubject } from "./lens-shortcuts";
import { LocusSynchronizationContext, locusSynchronizationForSession } from "./locus-synchronization";
import { installWorkspaceAddress, LENS_ADDRESS_NAVIGATION } from "./workspace-address";
import { shareSavedExpressionMap } from "./saved-expression-map";
import { createLocalApiClient, localTabDataSource } from "./local-locus-data";
import { cloneDraftValue } from "./native-draft";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { scopeKey } from "./locus-scope";
import { consumePublicDemoCopy, peekPublicDemoCopy, type LocalCreationDraft } from "./home-action";
import "./workspace-surface.css";

const HomePage = lazy(() => import("~/routes/app/home"));
const WorkspaceSettings = lazy(() => import("./workspace-settings"));
const DEFAULT_FLOATING_LENS = { x: 36, y: 36, width: 520, height: 420 };

type ReaderEntry = {
  key: string;
  epoch: number;
  abort: AbortController;
  client?: ApiClient;
  runtime: () => ReaderRuntime | undefined;
  stage: () => string;
  error: () => string | undefined;
  reloadRequired: () => boolean;
  preparing: () => boolean;
  publicRoot?: () => LocusRootData | undefined;
  navigationRoot?: () => LocusRootData | undefined;
  navigationReady?: () => Promise<LocusRootData>;
  request: () => void;
  requested: () => boolean;
  ready: () => Promise<ReaderRuntime>;
  dispose: () => void;
};

export type PreparedWorkspaceSurface = {
  store: WorkspacePreferencesStore;
  epoch: number;
  accountId?: string;
  accounts: AccountDataOption[];
  dispose: () => void;
};

export async function acquireWorkspaceSurface(bootstrap: WorkspaceBootstrap | undefined, options: {
  accountId?: string; epoch: number; signal: AbortSignal;
}): Promise<PreparedWorkspaceSurface> {
  let acquired: WorkspacePreferencesStore | undefined;
  let closed = false;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const dispose = () => {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener("abort", dispose);
    controller.abort();
    acquired?.dispose();
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  if (options.signal.aborted) dispose();
  try {
    const [store, accounts] = await Promise.all([
      loadWorkspacePreferences(options.accountId, options.epoch, bootstrap, signal).then(store => {
        acquired = store;
        if (closed) store.dispose();
        return store;
      }),
      bootstrap ? Promise.resolve(bootstrap.accounts) : options.accountId ? listAccessibleAccounts() : Promise.resolve([]),
    ]);
    if (closed) throw new Error("These lenses were closed.");
    assertCurrentSession(options.epoch);
    return { store, epoch: options.epoch, accountId: options.accountId, dispose, accounts: accounts
      .filter(account => account.accountId !== store.personalAccountId || account.accountId === options.accountId)
      .map(account => ({ id: account.accountId, label: account.name || account.slug, slug: account.slug })) };
  } catch (error) { dispose(); throw error; }
}

export default function WorkspaceSurface(props: {
  bootstrap?: Promise<WorkspaceBootstrap>;
  readyWorkspace?: PreparedWorkspaceSurface;
  /** Repository data can paint while the session is unresolved, including a
   * recheck that still holds the preceding User subject. */
  publicOnly?: boolean;
  /** Public data URLs share this same persisted-lens surface. */
  addressedHome?: boolean;
  onHandoffHold?: (hold: (() => boolean) | undefined, owner: symbol) => void;
}) {
  const [attempt, setAttempt] = createSignal(0);
  const [pendingSessionAttempt, setPendingSessionAttempt] = createSignal(0);
  let acquired = false;
  createEffect(() => ({ epoch: sessionEpoch(), publicOnly: props.publicOnly }), (current, previous) => {
    // No established frame exists yet. If the first cookie wins the race
    // against the public snapshot, restart only that pending acquisition.
    if (current.publicOnly && !acquired && previous && current.epoch !== previous.epoch) {
      setPendingSessionAttempt(value => value + 1);
    }
  });
  return <Show when={`${attempt()}:${pendingSessionAttempt()}`} keyed>{(_attempt) => <WorkspaceAttempt bootstrap={attempt() === 0 && !props.publicOnly ? props.bootstrap : undefined}
    readyWorkspace={attempt() === 0 ? props.readyWorkspace : undefined}
    publicOnly={props.publicOnly}
    addressedHome={props.addressedHome}
    onHandoffHold={props.onHandoffHold}
    onAcquired={() => { acquired = true; }}
    retry={() => { acquired = false; setAttempt(value => value + 1); }} />}</Show>;
}

function WorkspaceAttempt(props: { bootstrap?: Promise<WorkspaceBootstrap>; readyWorkspace?: PreparedWorkspaceSurface;
  publicOnly?: boolean; addressedHome?: boolean;
  onHandoffHold?: (hold: (() => boolean) | undefined, owner: symbol) => void;
  onAcquired: () => void; retry: () => void }) {
  const loaded = createMemo(() => {
    const ready = props.readyWorkspace;
    if (ready) {
      onCleanup(ready.dispose);
      props.onAcquired();
      return ready;
    }
    let active = true;
    let acquired: PreparedWorkspaceSurface | undefined;
    const controller = new AbortController();
    onCleanup(() => { active = false; controller.abort(); acquired?.dispose(); });
    const current = props.publicOnly ? undefined : untrack(subject);
    const epoch = untrack(sessionEpoch);
    const accountId = current?.$tag === "User" ? current.accountId : undefined;
    return Promise.resolve(props.bootstrap).then(bootstrap => {
      if (!active) throw new Error("These lenses were closed.");
      return acquireWorkspaceSurface(bootstrap, { accountId, epoch, signal: controller.signal });
    }).then(data => {
      acquired = data;
      if (!active) { data.dispose(); throw new Error("These lenses were closed."); }
      props.onAcquired();
      return data;
    }).catch(error => { controller.abort(); acquired?.dispose(); throw error; });
  });
  // A function call, not a conditional, in the prop: Solid compiles a
  // conditional prop into a getter that creates a memo on every read, and
  // LoadedWorkspace reads `epoch` from pane callbacks that run inside
  // owner-backed onSettled (the Local creation draft), where creating a
  // reactive primitive throws PRIMITIVE_IN_FORBIDDEN_SCOPE.
  const lensEpoch = (data: PreparedWorkspaceSurface) => props.publicOnly ? sessionEpoch() : data.epoch;
  return <Errored fallback={error => { logSurfaceFailure("The workspace surface", error()); return <LocusLoadFailure message="Could not load data."
    detail={String((error() as Error)?.message ?? error())}
    retry={props.retry} />; }}>
    {/* Lens code is already loaded here. Session-owned boundaries retain a
        frame fallback; the startup card belongs to the app's initial boot. */}
    <Loading fallback={<PendingLensFrame />}>
      <Show when={loaded()} keyed>{data => <LoadedWorkspace {...data}
        epoch={lensEpoch(data)}
        addressedHome={props.addressedHome} publicOnly={props.publicOnly}
        onHandoffHold={props.onHandoffHold} />}</Show>
    </Loading>
  </Errored>;
}

function LoadedWorkspace(props: { store: WorkspacePreferencesStore; epoch: number; accountId?: string; accounts: AccountDataOption[];
  addressedHome?: boolean; publicOnly?: boolean;
  onHandoffHold?: (hold: (() => boolean) | undefined, owner: symbol) => void }) {
  const routeLocation = useLocation();
  const routeNavigate = useNavigate();
  const synchronization = createMemo(() => locusSynchronizationForSession(props.epoch));
  createEffect(() => ({ epoch: props.epoch, publicOnly: props.publicOnly, store: props.store, controller: synchronization() }),
    ({ epoch, publicOnly, store, controller }) => {
      if (publicOnly) store.rebindPublicSession(epoch);
      store.setSynchronization(controller);
      return controller.register(`preferences:${store.personalAccountId ?? "public"}`, {
        pending: store.pending, saving: store.saving, error: store.error,
        save: automaticResume => store.flush(!automaticResume), discard: store.discard,
      });
    });
  const workspaceOwner = getOwner();
  const chrome = useWorkspaceChrome();
  const chromeOwner = Symbol("workspace-chrome");
  const value = () => props.store.value();
  const [width, setWidth] = createSignal(window.innerWidth);
  const [surfaceElement, setSurfaceElement] = createSignal<HTMLElement>();
  const [settings, setSettings] = createSignal(false);
  const initialHandoffHeld = () => settings() || hasLocalCreationDrafts() || hasPendingCreationPicker() || hasPendingRootCreation()
    || synchronization().pending() > 0 || synchronization().saving() || !!synchronization().error();
  onSettled(() => {
    if (!untrack(() => props.publicOnly)) return;
    props.onHandoffHold?.(initialHandoffHeld, chromeOwner);
    return () => queueMicrotask(() => props.onHandoffHold?.(undefined, chromeOwner));
  });
  const [message, setMessage] = createSignal<string>();
  const [modelPreparing, setModelPreparing] = createSignal(false);
  const [returningHome, setReturningHome] = createSignal(false);
  const [dismissed, setDismissed] = createSignal<readonly string[]>([]);
  type SubjectContext = { focus: WorkspaceFocus; source: WorkspaceSource; subject: WorkspaceLens["subject"];
    entry?: ReaderEntry; runtime?: ReaderRuntime; revision?: number; session?: ReturnType<ReaderRuntime["session"]>; epoch: number };
  type SubjectPresentation = SubjectContext & { label: string; typeRef?: string; kind: LocusLayoutChoice };
  const [subjects, setSubjects] = createSignal<Record<string, SubjectPresentation>>({});
  type PresentationPacket = { value: WorkspacePreferences; lens: WorkspaceLens; subject?: SubjectPresentation;
    context: SubjectContext; presentation: WorkspacePresentation; code: string };
  const [presentationPackets, setPresentationPackets] = createSignal<Record<string, PresentationPacket>>({});
  const [inspectionModes, setInspectionModes] = createSignal<Record<string, DataInspectionMode>>({});
  const [lensChromeModes, setLensChromeModes] = createSignal<Record<string, "expanded" | "compact" | "hidden">>({});
  const setLensChromeMode = (id: string, mode: "expanded" | "compact" | "hidden") =>
    setLensChromeModes(previous => ({ ...previous, [id]: mode }));
  const [browseStates, setBrowseStates] = createSignal<Record<string, { source: string; open: boolean; query: string }>>({});
  const localCreationDrafts = new Map<string, LocalCreationDraft>();
  const [localCreationDraftVersion, setLocalCreationDraftVersion] = createSignal(0);
  const hasLocalCreationDrafts = () => { localCreationDraftVersion(); return localCreationDrafts.size > 0; };
  const creationDraft = (id: string, source: WorkspaceSource, focus: import("./locus-scope").LocusScope) => {
    localCreationDraftVersion();
    const draft = localCreationDrafts.get(id);
    return source.$tag === "ThisTabSource" && draft && scopeKey(draft.focus) === scopeKey(focus) ? draft : undefined;
  };
  const retainCreationDraft = (id: string, source: WorkspaceSource, draft: LocalCreationDraft | undefined, owner: ApiClient) => {
    if (surfaceClosed || source.$tag !== "ThisTabSource" || owner.epoch !== props.epoch || owner.epoch !== sessionEpoch()
      || owner.signal.aborted || runtimes.get("local")?.client !== owner) return;
    // Publish the supplied next input now; an epoch may retire its editor
    // before Solid commits that editor's queued signal write.
    if (draft) localCreationDrafts.set(id, cloneDraftValue(draft));
    else localCreationDrafts.delete(id);
    setLocalCreationDraftVersion(version => version + 1);
  };
  const [shortcutRequests, setShortcutRequests] = createSignal<Record<string, { id: number; shortcut: LensShortcut }>>({});
  let nextShortcutRequest = 0;
  const [menu, setMenu] = createSignal<{ x: number; y: number }>();
  const [lensMenu, setLensMenu] = createSignal<{ x: number; y: number; opener: HTMLButtonElement }>();
  const [waits, setWaits] = createSignal<Record<string, WorkspaceWait>>({});
  const loadApi = {
    report: (id: string, wait: WorkspaceWait | undefined) => {
      setWaits(previous => {
        if (!wait) {
          if (!(id in previous)) return previous;
          const next = { ...previous };
          delete next[id];
          return next;
        }
        const current = previous[id];
        if (current && current.stage === wait.stage && current.detail === wait.detail) return previous;
        return { ...previous, [id]: wait };
      });
    },
  };
  const flushers = new Map<string, (reason?: "home-check" | "home") => Promise<boolean>>();
  // Each flusher's synchronous "nothing to flush" answer, when its pane gives one.
  const idleFlushers = new Map<(reason?: "home-check" | "home") => Promise<boolean>, () => boolean>();
  const focusRequests = new Map<string, number>();
  const presentationRequests = new Map<string, number>();
  // Navigate first, commit second: a lens shows the destination named by the
  // clicked card at once, while its reader and lens settings prepare. The
  // previous data stays mounted (hidden), so going up is instant and exact.
  const [pendingNavigations, setPendingNavigations] = createSignal<Record<string, { request: number; intent: WorkspaceNavigationIntent }>>({});
  // Writes only when something changes: these run from pane callbacks that a
  // reader can call inside its own reactive work.
  function holdNavigation(id: string, request: number, intent: WorkspaceNavigationIntent | undefined) {
    if (!intent && !(id in untrack(pendingNavigations))) return;
    setPendingNavigations(previous => {
      if (!intent && !(id in previous)) return previous;
      const next = { ...previous };
      if (intent) next[id] = { request, intent: { name: intent.name, icon: intent.icon, emoji: intent.emoji } };
      else delete next[id];
      return next;
    });
  }
  function releaseNavigation(id: string, request?: number) {
    const held = untrack(pendingNavigations)[id];
    if (!held || request !== undefined && held.request !== request) return;
    setPendingNavigations(previous => {
      if (!(id in previous) || request !== undefined && previous[id]!.request !== request) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  /** Going up while a destination prepares: retire that navigation. The
   * destination's reader keeps preparing, so a second visit costs less. */
  function cancelNavigation(id: string) {
    const held = untrack(pendingNavigations)[id];
    if (!held) return;
    if (focusRequests.get(id) === held.request) {
      focusRequests.set(id, held.request + 1);
      presentationRequests.set(id, (presentationRequests.get(id) ?? 0) + 1);
    }
    releaseNavigation(id, held.request);
  }
  // One object per held navigation: views key on it (a keyed Show), so another
  // lens's navigation does not remount this destination.
  const pendingViews = new WeakMap<object, WorkspacePendingNavigation>();
  const pendingNavigation = (id: string): WorkspacePendingNavigation | undefined => {
    const held = pendingNavigations()[id];
    if (!held) return undefined;
    let view = pendingViews.get(held);
    if (!view) pendingViews.set(held, view = { ...held.intent, cancel: () => cancelNavigation(id) });
    return view;
  };
  const runtimes = new Map<string, ReaderEntry>();
  const [readerEntries, setReaderEntries] = createSignal<ReaderEntry[]>([]);
  const [readerVersions, setReaderVersions] = createSignal<Record<string, number>>({});
  createEffect(() => props.epoch, epoch => {
    let retired = false;
    for (const [key, entry] of runtimes) if (entry.epoch !== epoch) {
      entry.dispose();
      runtimes.delete(key);
      retired = true;
    }
    if (retired) setReaderEntries([...runtimes.values()]);
  });
  const accounts = () => [...PUBLIC_DATA_LOCATIONS, ...props.accounts];
  const internalSource = (lens: WorkspaceLens) => !!props.accountId && props.store.personalAccountId !== props.accountId
    && lens.source.$tag === "AccountSource" && lens.source.accountId === props.store.personalAccountId;
  const sourceId = (lens: WorkspaceLens) => internalSource(lens) ? props.accountId!
    : workspaceSourceKey(lens.source);
  const active = createMemo(() => {
    const projected = peelMaybeValue(props.store.projection().activeLens);
    return projected && value().lenses.find(lens => lens.id === projected.id);
  });
  const visible = createMemo(() => props.store.projection().visibleLenses.map(projected => {
    const lens = value().lenses.find(lens => lens.id === projected.id);
    if (!lens) throw new Error("The displayed lens is absent from its settings packet.");
    return lens;
  }));
  const layerDepth = () => {
    const display = value().display;
    return display.$tag === "GroupedLenses" ? display.groups.find(group => group.id === display.activeGroupId)?.layers.length ?? 0 : visible().length ? 1 : 0;
  };
  const activeGroup = () => {
    const display = value().display;
    return display.$tag === "GroupedLenses" ? display.groups.find(group => group.id === display.activeGroupId) : undefined;
  };
  const bordersMerged = () => activeGroup() ? activeGroup()!.merged !== false : true;
  const [barCollapsed, setBarCollapsed] = createSignal(false);
  const topbarMount = createMemo(() => chrome?.mount()?.closest<HTMLElement>(".topbar") ?? undefined);
  let surfaceClosed = false;
  let modelPreparation: ReturnType<WorkspacePreferencesStore["prepare"]> | undefined;
  let modelPreparationInput: ReturnType<WorkspacePreferencesStore["prepare"]> | undefined;
  function prepareModel(): ReturnType<WorkspacePreferencesStore["prepare"]> {
    untrack(() => { if (props.publicOnly) props.store.rebindPublicSession(props.epoch); });
    const preparation = props.store.prepare();
    if (untrack(() => props.store.prepared())) return preparation;
    if (modelPreparationInput === preparation && modelPreparation) return modelPreparation;
    setModelPreparing(true);
    const flight = preparation.finally(() => {
      if (modelPreparation !== flight) return;
      modelPreparation = undefined;
      modelPreparationInput = undefined;
      if (!surfaceClosed && props.epoch === sessionEpoch()) setModelPreparing(false);
    });
    modelPreparationInput = preparation;
    modelPreparation = flight;
    return flight;
  }
  let layoutTransition: ViewTransition | undefined;
  function showFailure(error: unknown) {
    if (!surfaceClosed && props.epoch === sessionEpoch()) setMessage(error instanceof Error ? error.message : String(error));
  }
  function updatePreferences(commands: readonly WorkspaceCommand[], guard?: () => boolean) {
    void props.store.update(commands, guard).catch(showFailure);
  }
  async function presentationForKind(kind: LocusLayoutChoice, operate: WorkspaceOrdinaryOperate = props.store.operate) {
    const verdict = await operate({ kind: "workspacePresentationFromCode", args: [kind] });
    if (verdict.$tag !== "Ok") throw new Error(verdict._0);
    return verdict._0;
  }
  async function animateLayout<T>(change: () => T | Promise<T>): Promise<T | undefined> {
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
    layoutTransition?.skipTransition();
    let result: T | undefined;
    const transition = document.startViewTransition({ types: ["lens-layout"], update: async () => {
      if (surfaceClosed) return;
      result = await change();
    } });
    layoutTransition = transition;
    void transition.finished.catch(() => {}).finally(() => { if (layoutTransition === transition) layoutTransition = undefined; });
    await transition.updateCallbackDone;
    return result;
  }
  const rootHandlers = new Set<RootShelfHandler>();
  const [rootHandlerVersion, setRootHandlerVersion] = createSignal(0);
  function hasPendingCreationPicker(paneId?: string): boolean {
    rootHandlerVersion();
    return [...rootHandlers].some(handler => (!paneId || handler.paneId === paneId)
      && handler.pendingCreationPicker?.() === true && handler.isActive());
  }
  const [composerSearch, setComposerSearch] = useSearchParams();
  type RootIntent = { action: RootShelfAction; generation: number; epoch: number; source: string; paneId?: string;
    originId?: string; originSource?: string | null; originFocus?: string | null; arrived: boolean };
  const [pendingRoot, setPendingRoot] = createSignal<RootIntent>();
  let rootIntentGeneration = 0;
  let currentRootIntent: RootIntent | undefined;
  const matchesRootIntent = (handler: RootShelfHandler, action: RootShelfAction) => handler.isRoot()
    && (action !== "new:recipe-demo" && action !== "new:showcase-demo" || handler.sourceKey() === "local")
    && (action === "browse" || handler.canCreate() || (action === "new" || action === "new:expression") && handler.canChooseCreation?.() === true);
  function clearRootIntent(expected = currentRootIntent) {
    if (currentRootIntent !== expected) return;
    currentRootIntent = undefined;
    rootIntentGeneration += 1;
    setPendingRoot(undefined);
  }
  function rootIntentCurrent(intent: RootIntent) {
    return currentRootIntent === intent && intent.generation === rootIntentGeneration && !surfaceClosed
      && intent.epoch === sessionEpoch() && props.epoch === intent.epoch;
  }
  function hasPendingRootCreation() {
    const intent = pendingRoot();
    const action = typeof intent?.action === "string" ? intent.action : "";
    return !!intent && (action === "new" || action.startsWith("new:")) && rootIntentCurrent(intent);
  }
  function dispatchRootIntent(intent: RootIntent) {
    if (!rootIntentCurrent(intent) || !intent.arrived || !intent.paneId) return;
    const target = [...rootHandlers].find(handler => handler.paneId === intent.paneId
      && handler.sourceKey() === intent.source && handler.isActive() && handler.isRoot());
    if (target && intent.action !== "browse" && target.creationResolved() && !target.canCreate()) { clearRootIntent(intent); return; }
    const chosen = target && matchesRootIntent(target, intent.action) ? target : undefined;
    if (!chosen) return;
    queueMicrotask(() => {
      if (!rootIntentCurrent(intent) || !rootHandlers.has(chosen) || chosen.paneId !== intent.paneId
        || chosen.sourceKey() !== intent.source || !chosen.isActive() || !matchesRootIntent(chosen, intent.action)) return;
      clearRootIntent(intent);
      chosen.run(intent.action);
    });
  }
  const rootShelf = {
    request(action: RootShelfAction) {
      if ([...document.querySelectorAll('.modal-overlay, .confirm-modal__overlay, dialog[open], .locus-quick-value')]
        .some(element => !element.closest('[inert], [aria-hidden="true"], .modal-transition--leaving'))) return;
      clearRootIntent();
      const selected = active();
      const previewSource = address.initialLoading() ? address.initialRootSource() : undefined;
      const selectedSource = selected && workspaceSourceKey(selected.source);
      const handlerSource = previewSource ? workspaceSourceKey(previewSource) : selectedSource;
      const list = [...rootHandlers];
      const eligible = (handler: RootShelfHandler) => handler.sourceKey() === handlerSource && matchesRootIntent(handler, action);
      const chosen = list.find(handler => handler.isActive() && eligible(handler));
      const availableRoot = list.find(eligible);
      if (chosen) { chosen.run(action); return; }
      const source = availableRoot ? availableRoot.sourceKey() : action === "browse" ? "all" : "local";
      const intent: RootIntent = { action, source, generation: rootIntentGeneration, epoch: props.epoch, arrived: false,
        originId: selected?.id, originSource: selectedSource, originFocus: selected && JSON.stringify(selected.focus) };
      currentRootIntent = intent;
      setPendingRoot(intent);
      void exploreData(source, id => {
        const current = rootIntentCurrent(intent);
        const target = value().lenses.find(lens => lens.id === id);
        const sourceOk = !target || workspaceSourceKey(target.source) === source && target.focus.$tag === "RootFocus";
        if (!current || !sourceOk) return false;
        intent.paneId = id;
        return true;
      }, () => clearRootIntent(intent));
    },
    cancel(paneId?: string) {
      const waiting = currentRootIntent;
      if (!waiting || paneId && waiting.paneId !== paneId && waiting.originId !== paneId) return;
      clearRootIntent(waiting);
    },
    register(handler: RootShelfHandler) {
      rootHandlers.add(handler);
      setRootHandlerVersion(version => version + 1);
      const waiting = currentRootIntent;
      if (waiting) dispatchRootIntent(waiting);
      return () => {
        if (rootHandlers.delete(handler)) queueMicrotask(() => {
          if (!surfaceClosed) setRootHandlerVersion(version => version + 1);
        });
      };
    },
  };
  createEffect(() => {
    const intent = pendingRoot();
    const selected = active();
    rootHandlerVersion();
    const target = intent?.paneId && [...rootHandlers].find(handler => handler.paneId === intent.paneId
      && handler.sourceKey() === intent.source && handler.isActive() && handler.isRoot());
    return { intent, epoch: sessionEpoch(), selectedId: selected?.id,
      selectedSource: selected && workspaceSourceKey(selected.source), selectedFocus: selected && JSON.stringify(selected.focus),
      selectedRoot: selected?.focus.$tag === "RootFocus",
      // A Local root can register before its checked read resolves. Observe
      // that existing verdict so its pending New is delivered after the read.
      creation: target && { active: target.isActive(), root: target.isRoot(), resolved: target.creationResolved(),
        allowed: target.canCreate(), choosing: target.canChooseCreation?.() },
      targetPresent: !intent?.paneId || value().lenses.some(lens => lens.id === intent.paneId) };
  }, state => untrack(() => {
    const intent = state.intent;
    if (!intent || currentRootIntent !== intent) return;
    if (!rootIntentCurrent(intent)) { clearRootIntent(intent); return; }
    if (!state.targetPresent) { clearRootIntent(intent); return; }
    if (state.selectedId === intent.paneId) {
      if (state.selectedSource !== intent.source || !state.selectedRoot) { clearRootIntent(intent); return; }
      intent.arrived = true;
      dispatchRootIntent(intent);
    } else if (intent.arrived || state.selectedId !== intent.originId
      || state.selectedSource !== intent.originSource || state.selectedFocus !== intent.originFocus) clearRootIntent(intent);
  }));
  createEffect(() => composerSearch.new === "function"
    && (routeLocation.pathname === "/" || /^\/app\/?$/.test(routeLocation.pathname) || /^\/app\/home\/?$/.test(routeLocation.pathname))
    && active()?.focus.$tag === "RootFocus", (requested) => {
    if (!requested) return;
    rootShelf.request("new:function");
    setComposerSearch({ new: undefined }, { replace: true });
  });
  // Edit in Local leaves the public page. Run the copy only after this address
  // has a Local root that can write, and correct a landing on the public root.
  let demoCopyDispatched = false;
  let demoCopyFallbackCount = 0;
  createEffect(() => {
    const query = composerSearch.new;
    const lens = active();
    const path = routeLocation.pathname;
    const localRoot = !!lens && lens.source.$tag === "ThisTabSource" && lens.focus.$tag === "RootFocus";
    const pending = peekPublicDemoCopy();
    const armed = query === "recipe" || query === "showcase" || !!pending;
    rootHandlerVersion();
    const ready = localRoot && armed && !!lens && [...rootHandlers].some(handler => handler.paneId === lens.id
      && handler.sourceKey() === "local" && handler.isActive() && handler.isRoot()
      && handler.creationResolved() && handler.canCreate());
    return { localRoot, query, pending, ready, path };
  }, (state) => {
    const fromQuery = state.query === "recipe" ? "new:recipe-demo" as const
      : state.query === "showcase" ? "new:showcase-demo" as const : undefined;
    const branch = fromQuery ?? state.pending;
    if (!branch) { demoCopyDispatched = false; demoCopyFallbackCount = 0; return; }
    if (state.ready && !demoCopyDispatched) {
      demoCopyDispatched = true;
      consumePublicDemoCopy();
      if (fromQuery) setComposerSearch({ new: undefined }, { replace: true });
      rootShelf.request(branch);
      return;
    }
    if (state.localRoot || state.path === "/~" || state.path === "/~/") return;
    if (demoCopyFallbackCount >= 2) return;
    demoCopyFallbackCount += 1;
    routeNavigate(branch === "new:recipe-demo" ? "/~?new=recipe" : "/~?new=showcase", { replace: true });
  });
  createEffect(() => ({ element: surfaceElement(), merged: bordersMerged(), collapsed: barCollapsed() }), (state) => {
    const dashboard = state.element?.closest(".dashboard");
    if (!dashboard) return;
    if (state.merged) dashboard.setAttribute("data-borders", "merged");
    else dashboard.removeAttribute("data-borders");
    if (state.collapsed) dashboard.setAttribute("data-chrome-collapsed", "true");
    else dashboard.removeAttribute("data-chrome-collapsed");
  });
  const plan = createMemo(() => props.store.projection().tilePlan);
  const title = (lens: WorkspaceLens) => peelMaybeValue(lens.title)
    ?? (lens.focus.$tag === "RootFocus" ? sourceLabel(lens) : currentSubject(lens)?.label ?? "Lens");
  const sourceLabel = (lens: WorkspaceLens) => sourceId(lens) === "all" ? "All data" : sourceId(lens) === "public" ? "Fenel"
    : sourceId(lens) === "local" ? "Local"
    : props.accounts.find(account => account.id === sourceId(lens))?.label ?? "Account";
  const raisedNotices = createMemo<LocusNotice[]>(() => {
    const notices: LocusNotice[] = [];
    const shownSources = new Set(visible().map(lens => workspaceSourceKey(lens.source)));
    const shownReaders = readerEntries().filter(entry => entry.epoch === props.epoch
      && shownSources.has(entry.key) && !entry.abort.signal.aborted);
    if (modelPreparing() && !props.store.prepared()) notices.push({ id: "lens-preparation-loading", tone: "info",
      message: "Preparing lens controls…" });
    const preparing = shownReaders.filter(entry => entry.preparing() && !entry.runtime() && !entry.error());
    if (preparing.length) notices.push({ id: "editing-tools", tone: "info", message: "Loading editing tools…",
      detail: [...new Set(preparing.map(entry => preparing.length > 1
        ? `${accounts().find(option => option.id === entry.key)?.label ?? "Data source"}${entry.stage() === "Loading editing tools…" ? "" : `: ${entry.stage()}`}`
        : entry.stage() === "Loading editing tools…" ? undefined : entry.stage()).filter(Boolean))].join(" · ") || undefined });
    if (props.store.modelError() && !modelPreparing() && value().lenses.length) notices.push({ id: "lens-preparation", tone: "error",
      message: "Could not prepare your lenses.", detail: props.store.modelError(),
      retry: { label: "Retry", run: () => { void prepareModel().catch(() => {}); } } });
    if (props.store.error()) notices.push({ id: "lens-save", tone: "error", message: "Could not save your lens settings.",
      detail: props.store.error(), retry: { label: "Retry save", run: () => { void props.store.flush(); } },
      actions: [{ label: "Reload saved", run: () => { void confirmDialog({ message: "Reload your saved lens settings?",
        detail: "This discards the unsaved lens arrangement on this screen.", confirmLabel: "Reload" })
        .then(async confirmed => { if (confirmed && await flushLenses()) await props.store.reload(); })
        .catch(error => setMessage(error instanceof Error ? error.message : String(error))); } }] });
    if (synchronization().error() && synchronization().error() !== props.store.error()) notices.push({
      id: "synchronization-save", tone: "error", message: "Changes are unsaved.", detail: synchronization().error(),
      retry: { label: "Save", run: () => { void synchronization().saveAll(); } },
      actions: [{ label: "Discard", run: () => { void discardPendingChanges(); } }],
    });
    if (message()) notices.push({ id: "lens-message", tone: "error", message: message()! });
    return notices;
  });
  const notices = createMemo(() => raisedNotices().filter(notice => !dismissed().includes(locusNoticeKey(notice))));
  createEffect(() => raisedNotices().map(locusNoticeKey), current => {
    setDismissed(previous => previous.filter(key => current.includes(key)));
  });
  function dismissNotice(id: string) {
    const notice = raisedNotices().find(candidate => candidate.id === id);
    if (notice) setDismissed(previous => [...previous, locusNoticeKey(notice)]);
  }
  let correctedInternalSources = false;
  createEffect(() => ({ ready: props.store.prepared(), ids: value().lenses.filter(internalSource).map(lens => lens.id) }), ({ ready, ids }) => {
    if (!ids.length) { correctedInternalSources = false; return; }
    if (correctedInternalSources || props.epoch !== sessionEpoch()) return;
    if (!ready) { void prepareModel().catch(() => {}); return; }
    // Older selectors exposed the login's settings storage as another data
    // account. Recover only that identified source, using the existing typed
    // command; no data in either account is rewritten.
    correctedInternalSources = true;
    updatePreferences(ids.map(id => ({ $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensSource",
      source: { $tag: "AccountSource", accountId: props.accountId! } } })));
  });

  createEffect(() => value().bar, bar => { chrome?.setBar(bar, chromeOwner); });
  onSettled(() => { chrome?.setFoldBar?.(() => setBarCollapsed(true), chromeOwner); });
  createEffect(surfaceElement, element => {
    if (!element) return;
    const measure = () => { setWidth(element.clientWidth); void props.store.resize(element.clientWidth).catch(showFailure); };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  });
  onSettled(() => () => {
    surfaceClosed = true;
    layoutTransition?.skipTransition();
    chrome?.setBar(undefined, chromeOwner);
    chrome?.setFoldBar?.(undefined, chromeOwner);
    chrome?.setBeforeLeave(undefined, chromeOwner);
    chrome?.setHome?.(undefined, chromeOwner);
    props.store.dispose();
    for (const entry of runtimes.values()) entry.dispose();
    runtimes.clear();
  });
  onSettled(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!settings() && !synchronization().pending() && !synchronization().saving() && !synchronization().error()) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });

  async function flushLenses(ids = [...flushers.keys()], reason?: "home-check" | "home") {
    for (const id of ids) if (await flushers.get(id)?.(reason) === false) return false;
    return true;
  }
  async function prepareToLeave(reason?: "home-check") {
    if (settings()) { setMessage("Save or close lens settings before leaving."); return false; }
    if (!await flushLenses(undefined, reason)) return false;
    if (!synchronization().enabledNow()) {
      if (synchronization().pending() || synchronization().saving()) { setMessage("Save or discard pending changes before leaving."); return false; }
      return true;
    }
    return synchronization().saveAll();
  }
  /** Synchronous: `prepareToLeave` would answer true at once (no settings open,
   *  nothing to save, every pane says it has nothing to flush). */
  function leaveIdle() {
    const sync = synchronization();
    return !settings() && !sync.pending() && !sync.saving() && !sync.error()
      && [...flushers.values()].every(flush => idleFlushers.get(flush)?.() === true);
  }
  onSettled(() => { chrome?.setBeforeLeave(prepareToLeave, chromeOwner); });
  useBeforeLeave(event => {
    if ((event.options?.state as { type?: string } | undefined)?.type === LENS_ADDRESS_NAVIGATION) return;
    // A visitor with nothing pending goes through untouched (no undo, no retry);
    // otherwise the navigation is held, prepared and retried (leave-guard.ts).
    guardLeave(event, { idle: leaveIdle, prepare: () => prepareToLeave() });
  });

  let homeRequest = 0;
  function retireNavigation() {
    for (const current of value().lenses) {
      focusRequests.set(current.id, (focusRequests.get(current.id) ?? 0) + 1);
      presentationRequests.set(current.id, (presentationRequests.get(current.id) ?? 0) + 1);
    }
    if (Object.keys(untrack(pendingNavigations)).length) setPendingNavigations({});
  }
  function finishHome(id: string) {
    setInspectionModes(previous => ({ ...previous, [id]: "data" }));
    setBrowseStates(previous => { const next = { ...previous }; delete next[id]; return next; });
    setSubjects(previous => { const next = { ...previous }; delete next[id]; return next; });
    setShortcutRequests(previous => { const next = { ...previous }; delete next[id]; return next; });
    clearRootIntent(); setMenu(undefined); setLensMenu(undefined); setBarCollapsed(false); setMessage(undefined);
  }
  function displayedAllDataRoot() {
    const lens = value().lenses.find(lens => lens.id === value().activeLensId);
    return value().display.$tag === "SingleLens" && lens?.source.$tag === "AllDataSource" && lens.focus.$tag === "RootFocus"
      && lens.placement?.$tag !== "FreePlacement" && lens.subject?.$tag !== "Just"
      && lens.presentation.$tag === "AutomaticPresentation" ? lens : undefined;
  }
  async function returnHome(): Promise<boolean> {
    const request = ++homeRequest;
    setReturningHome(true);
    try {
      if (!await prepareToLeave("home-check")) return false;
      if (surfaceClosed || props.epoch !== sessionEpoch() || request !== homeRequest) return false;
      const displayed = displayedAllDataRoot();
      if (displayed) {
        // Checked initial data already names the destination. Retire read-only
        // inspection without waiting for a model that has no edit to apply.
        const ticket = focusRequests.get(displayed.id);
        if (await flushers.get(displayed.id)?.("home") === false) return false;
        if (surfaceClosed || props.epoch !== sessionEpoch() || request !== homeRequest) return false;
        if (displayedAllDataRoot()?.id === displayed.id && focusRequests.get(displayed.id) === ticket) {
          retireNavigation();
          finishHome(displayed.id);
          return true;
        }
      }
      await prepareModel();
      if (surfaceClosed || props.epoch !== sessionEpoch() || request !== homeRequest) return false;
      // Another pane may have started editing while its model loaded.
      if (!await prepareToLeave("home-check")) return false;
      if (surfaceClosed || props.epoch !== sessionEpoch() || request !== homeRequest) return false;
      const saved = value().lenses.find(lens => lens.source.$tag === "AllDataSource" && lens.focus.$tag === "RootFocus")
        ?? value().lenses.find(lens => lens.source.$tag === "AllDataSource");
      const id = saved?.id ?? crypto.randomUUID();
      // Retire delayed focus/subject/presentation handoffs before the same-root
      // reset. Reader runtimes and all other saved lenses remain held.
      const focusTicket = focusRequests.get(id);
      if (await flushers.get(id)?.("home") === false) return false;
      if (surfaceClosed || props.epoch !== sessionEpoch() || request !== homeRequest) return false;
      const current = value().lenses.find(lens => lens.id === id);
      if (saved && (!current || current.source.$tag !== "AllDataSource" || focusRequests.get(id) !== focusTicket)) return false;
      retireNavigation();
      const tickets = new Map(focusRequests);
      const isCurrent = () => !surfaceClosed && props.epoch === sessionEpoch() && request === homeRequest
        && [...tickets].every(([id, ticket]) => focusRequests.get(id) === ticket);
      let destinationId = id;
      if (!await props.store.planUpdate(async (current, operate) => {
        const existing = current.lenses.find(lens => lens.source.$tag === "AllDataSource" && lens.focus.$tag === "RootFocus")
          ?? current.lenses.find(lens => lens.source.$tag === "AllDataSource");
        destinationId = existing?.id ?? id;
        const lens = existing ?? await operate({ kind: "defaultWorkspaceLens", args: [destinationId, { $tag: "AllDataSource" }] });
        return [
          ...(existing ? [] : [{ $tag: "AddWorkspaceLens" as const, lens }]),
          { $tag: "EditWorkspaceLens", id: destinationId, command: { $tag: "SetLensFocus", focus: { $tag: "RootFocus" } } },
          { $tag: "EditWorkspaceLens", id: destinationId, command: { $tag: "SetLensPlacement", placement: { $tag: "DockedPlacement" } } },
          { $tag: "SetWorkspaceDisplay", display: { $tag: "SingleLens" } },
          { $tag: "SelectWorkspaceLens", id: destinationId },
        ];
      }, isCurrent)) return false;
      finishHome(destinationId);
      return true;
    } catch (error) {
      if (!surfaceClosed && props.epoch === sessionEpoch() && request === homeRequest)
        setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (!surfaceClosed && request === homeRequest) setReturningHome(false);
    }
  }
  const address = installWorkspaceAddress({
    enabled: untrack(() => !!props.addressedHome), active: () => active() ?? undefined,
    accounts: () => props.accounts,
    temporaryPublic: () => !!props.publicOnly && (authLoading() || subject()?.$tag === "User"),
    // Display only: the build's own answer for this exact public address, read from the same
    // bundled root the address is resolved on. It focuses no lens (workspace-address `initialFocus`).
    initialFocus: async (source, segments) => source.$tag === "PublicSource"
      ? readPublicInitialAddress((await loadPublicBootstrap()).root, segments) : undefined,
    prepare: source => {
      // Direct Local child addresses have no root preview to start this holder.
      // readReady primes its early realm synchronously, then awaits this same
      // projected model. Do not await it here; root() owns its eventual result.
      if (source?.$tag === "ThisTabSource") void localTabDataSource().readReady().catch(() => {});
      startPublicReader(source);
      return prepareModel();
    },
    operate: props.store.operate,
    root: async source => {
      if (source.$tag === "PublicSource") return (await loadPublicBootstrap()).root;
      if (source.$tag === "AllDataSource") {
        const entry = reader(source);
        return entry.navigationRoot?.() ?? await entry.navigationReady!();
      }
      const entry = reader(source);
      if (!entry.client) throw new Error("This data source is unavailable.");
      // An address holds this root until its position opens: resolve it on
      // the worker-confirmed Local data, never on the provisional first paint.
      if (source.$tag === "ThisTabSource") await localTabDataSource().readReady();
      return (await entry.client.getLocusRoot()).root;
    },
    values: async (source, root) => {
      if (source.$tag === "AllDataSource") return undefined;
      const key = workspaceSourceKey(source);
      const entry = reader(source);
      // The dependency codec stays with addressed-reader acquisition so the
      // initial data surface does not download its parser/inference imports.
      const [adapter, { expressionKey }, queries] = await Promise.all([
        import("./locus-address-reader"), import("./saved-expression-identity"), source.$tag === "PublicSource"
        ? Promise.resolve({ queries: [] }) : entry.client!.getSavedQueries()]);
      const assertCurrent = () => {
        assertCurrentSession(props.epoch);
        if (surfaceClosed || entry.abort.signal.aborted || runtimes.get(key) !== entry) throw new Error("This data reader was replaced. Open the current data again.");
      };
      assertCurrent();
      const saved = shareSavedExpressionMap(root.expressions, queries.queries);
      return adapter.locusAddressReader({ current: entry.runtime, ready: entry.ready,
        saved, assertCurrent,
        checkRoot: async node => {
          assertCurrent();
          const [current, currentQueries] = await Promise.all([
            source.$tag === "PublicSource" ? loadPublicBootstrap().then(data => data.root) : entry.client!.getLocusRoot.uncached().then(data => data.root),
            source.$tag === "PublicSource" ? Promise.resolve({ queries: [] }) : entry.client!.getSavedQueries.uncached(),
          ]);
          assertCurrent();
          if (current.id !== root.id || current.revision !== root.revision
            || expressionKey(node, saved) !== expressionKey(node, shareSavedExpressionMap(current.expressions, currentQueries.queries))) {
            throw new Error("This data changed while its position was opening. Open it again.");
          }
        },
      });
    },
    captureCurrent: (source, root) => {
      const epoch = props.epoch;
      const key = workspaceSourceKey(source);
      const entry = runtimes.get(key);
      const runtime = entry?.runtime(), revision = runtime?.revision(), session = runtime?.session();
      const drafts = entry?.client?.drafts;
      const draftSource = drafts?.source(), draftRevision = drafts?.revision(), draftSnapshot = drafts?.snapshot();
      const local = source.$tag === "ThisTabSource" && root ? localTabDataSource() : undefined;
      return () => {
        assertCurrentSession(epoch);
        if (surfaceClosed || props.epoch !== epoch || entry && (entry.abort.signal.aborted || runtimes.get(key) !== entry)
          || runtime && (entry?.runtime() !== runtime || runtime.revision() !== revision || runtime.session() !== session)
          || drafts && (entry?.client?.drafts !== drafts || drafts.source() !== draftSource || drafts.revision() !== draftRevision || drafts.snapshot() !== draftSnapshot)
          || local && local.root() !== root || source.$tag === "AllDataSource" && root
            && (runtimes.get(key)?.navigationRoot?.() ?? props.store.allDataRoot) !== root)
          throw new Error("This data reader changed while its position was opening. Open it again.");
      };
    },
    focus: async (source, focus, assertCurrent) => {
      assertCurrent?.();
      const lens = value().lenses.find(lens => lens.id === value().activeLensId) ?? value().lenses[0];
      if (!lens || !visible().some(shown => shown.id === lens.id)) await addLens(lens, focus, "stack", undefined, source, true, undefined, undefined, assertCurrent);
      else await focusLens(lens.id, focus, undefined, source, true, assertCurrent);
      const selected = value().lenses.find(lens => lens.id === value().activeLensId);
      if (!selected) return false;
      const [sameSource, sameFocus] = await Promise.all([
        props.store.operate({ kind: "workspaceSourceEqual", args: [selected.source, source] }),
        props.store.operate({ kind: "workspaceFocusEqual", args: [selected.focus, scopeToWorkspace(focus)] }),
      ]);
      return sameSource && sameFocus && !surfaceClosed && props.epoch === sessionEpoch()
        && value().lenses.find(lens => lens.id === value().activeLensId) === selected;
    },
    failed: setMessage,
  });
  onSettled(() => { chrome?.setHome?.(async () => {
    address.navigationStarted();
    const returned = await returnHome();
    if (returned) address.navigated();
    return returned;
  }, chromeOwner); });
  createEffect(() => composerSearch.home === "public", requested => {
    if (requested && !props.addressedHome) void returnHome();
  });

  /** Why a data of this source cannot open elsewhere, if it cannot. */
  function elsewhereUnavailable(source: WorkspaceSource): string | undefined {
    if (!props.addressedHome) return "This page has no data addresses to open elsewhere.";
    if (source.$tag === "ThisTabSource" && (synchronization().pending() > 0 || synchronization().saving()))
      return "Save your Local changes first: another tab opens the saved Local data.";
    return undefined;
  }
  /** Open a data by its address in a new tab or window. The window opens
   * within the click (popup blockers), then follows the resolved address. */
  function openElsewhere(source: WorkspaceSource, scope: Parameters<WorkspacePane["onFocus"]>[0], place: "tab" | "window") {
    if (elsewhereUnavailable(source)) return;
    const features = place === "window" ? "popup" : "";
    if (scope.kind === "root") {
      void address.addressFor(source, scope).then(url => { if (url) window.open(url, "_blank", `${features ? features + "," : ""}noopener`); });
      return;
    }
    const opened = window.open("about:blank", "_blank", features || undefined);
    if (opened) opened.opener = null;
    void address.addressFor(source, cloneDraftValue(scope)).then(url => {
      if (url && opened && !opened.closed) { opened.location.href = new URL(url, window.location.origin).href; return; }
      opened?.close();
      if (!url) setMessage("This data has no address to open elsewhere yet.");
    }, error => { opened?.close(); showFailure(error); });
  }
  /** Lane S (Nov 8): a public reader waits on no Local model (it has no
   * `prepareAfter`), so an address or navigation that will show public data
   * starts it before the model's first operation (measured 39-120 s), not
   * after. Idempotent: the destination pane adopts this same keyed entry. */
  function startPublicReader(target: WorkspaceSource | undefined) {
    if (target?.$tag !== "PublicSource" || surfaceClosed || props.epoch !== sessionEpoch()) return;
    reader(target).request();
  }
  function reader(source: WorkspaceSource): ReaderEntry {
    if (props.publicOnly) props.store.rebindPublicSession(props.epoch);
    const key = workspaceSourceKey(source);
    let entry = runtimes.get(key);
    if (entry && entry.epoch !== props.epoch) {
      entry.dispose();
      runtimes.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const readerEpoch = props.epoch;
      entry = runWithOwner(workspaceOwner, () => createRoot(dispose => {
        const abort = new AbortController();
        const [runtime, setRuntime] = createSignal<ReaderRuntime>();
        const [stage, setStage] = createSignal(source.$tag === "PublicSource" ? "Loading public data…" : "Loading data…");
        const [error, setError] = createSignal<string>();
        const [reloadRequired, setReloadRequired] = createSignal(false);
        const [preparing, setPreparing] = createSignal(source.$tag === "AccountSource" || source.$tag === "AllDataSource");
        const [publicRoot, setPublicRoot] = createSignal<LocusRootData>();
        const [navigationRoot, setNavigationRoot] = createSignal<LocusRootData>();
        const preparedSource = source.$tag === "AccountSource"
          ? startAccountReaderRuntime(source.accountId, { epoch: readerEpoch, signal: abort.signal, onStage: setStage, prepareAfter: prepareModel, synchronization: synchronization() })
          : undefined;
        const localSource = source.$tag === "ThisTabSource" ? localTabDataSource() : undefined;
        const allDataReady = source.$tag === "AllDataSource" ? Promise.resolve().then(async () => {
          // This captured bootstrap already used the ordinary source owner and
          // admitted roster. Older servers retain the checked-model fallback.
          const root = props.store.allDataRoot ?? await projectAllDataRootAsync(props.store.operate, accounts());
          abort.signal.throwIfAborted(); assertCurrentSession(readerEpoch);
          return root;
        }) : undefined;
        const client = preparedSource?.client ?? (localSource ? createLocalApiClient(localSource) : createPublicApiClient());
        if (source.$tag === "AccountSource" && source.accountId === props.store.personalAccountId) props.store.setClient(client);
        const failed = (problem: unknown) => {
          if (!abort.signal.aborted && readerEpoch === sessionEpoch()) {
            setError(problem instanceof Error ? problem.message : String(problem));
            setReloadRequired(problem instanceof PublicBootstrapMismatchError);
            setPreparing(false);
            // A refused source still leaves the user's layout controls
            // available after the model loads, so they can choose another.
            if (preparedSource) void prepareModel().catch(() => {});
          }
        };
        let started = !!preparedSource;
        let readyPromise: Promise<ReaderRuntime> | undefined;
        const observe = (pending: Promise<ReaderRuntime>) => {
          const observed = pending.then(loaded => {
            if (abort.signal.aborted || readerEpoch !== sessionEpoch()) {
              loaded.dispose(); throw new Error("This data reader was replaced.");
            }
            setRuntime(loaded); setPreparing(false); return loaded;
          }, problem => { failed(problem); throw problem; });
          readyPromise = observed;
          void observed.catch(() => {});
          return observed;
        };
        const request = () => {
          if (started || abort.signal.aborted || readerEpoch !== untrack(sessionEpoch)) return;
          started = true;
          setPreparing(true); setStage("Preparing data reader…");
          if (localSource) {
            void observe(startLocalReaderRuntime({ epoch: readerEpoch, signal: abort.signal, onStage: setStage,
              prepareAfter: prepareModel, synchronization: synchronization(), reader: { source: localSource, client } }).ready);
            return;
          }
          void observe(createPublicReaderRuntime({ epoch: readerEpoch, signal: abort.signal, onStage: setStage }).then(async loaded => {
            if (source.$tag !== "AllDataSource") return loaded;
            try {
              const root = await allDataReady;
              abort.signal.throwIfAborted(); assertCurrentSession(readerEpoch);
              if (!root || !loaded.publicData) throw new Error("The all-data root is unavailable.");
              return { ...loaded, publicData: { ...loaded.publicData, root, catalogPaths: new Map() } };
            } catch (error) { loaded.dispose(); throw error; }
          }));
        };
        if (preparedSource) void observe(preparedSource.ready);
        else if (allDataReady) void allDataReady.then(root => {
          if (abort.signal.aborted || readerEpoch !== sessionEpoch()) return;
          setNavigationRoot(root);
          if (!started) { setPreparing(false); setStage("All data is ready."); }
        }, failed);
        else if (!localSource) void loadPublicBootstrap().then(data => {
          if (!abort.signal.aborted && readerEpoch === sessionEpoch()) { setPublicRoot(data.root); setStage("Public data is ready."); }
        }, failed);
        return { key, epoch: readerEpoch, abort, client, runtime, stage, error, reloadRequired, preparing, request, requested: () => started,
          ready: () => {
            request();
            const held = untrack(runtime);
            return held ? Promise.resolve(held) : readyPromise ?? Promise.reject(new Error("This data reader could not prepare its tools."));
          },
          publicRoot: source.$tag === "PublicSource" ? publicRoot : undefined,
          navigationRoot: source.$tag === "AllDataSource" ? navigationRoot : undefined,
          navigationReady: allDataReady ? () => allDataReady : undefined,
          dispose: () => { abort.abort(); untrack(runtime)?.dispose(); if (!preparedSource) client.dispose(); dispose(); } };
      }));
      runtimes.set(key, entry);
      setReaderEntries([...runtimes.values()]);
    } else if (untrack(entry.runtime)) {
      // Reopening a prepared reader still needs a fresh authorized root read.
      // The progressive surface consumes that response before typed handoff.
      entry.client?.revalidate("locusRoot");
    }
    return entry;
  }
  let settingsReaderRequested = false;
  createEffect(() => ({ open: settings(), source: active()?.source }), state => {
    if (!state.open) { settingsReaderRequested = false; return; }
    if (!settingsReaderRequested && state.source) {
      settingsReaderRequested = true; reader(state.source.$tag === "AllDataSource" ? { $tag: "PublicSource" } : state.source).request();
    }
  });

  async function selectLens(id: string) {
    address.navigationStarted();
    if (!props.store.prepared() || id === value().activeLensId) return;
    try {
      if (value().display.$tag === "SingleLens" && !await flushLenses([value().activeLensId])) return;
      if (await props.store.update([{ $tag: "SelectWorkspaceLens", id }])) address.navigated();
    } catch (error) { showFailure(error); }
  }
  async function retryReader(key: string, current = runtimes.get(key)) {
    if (!current) return;
    try {
      const affected = value().lenses.filter(lens =>
        workspaceSourceKey(lens.source) === key).map(lens => lens.id);
      if (!await flushLenses(affected)) return;
      const drafts = current.client?.drafts ?? current.runtime()?.client.drafts;
      if (drafts?.pending() || drafts?.saving()) {
        setMessage("Save or discard pending changes before reloading this data source.");
        return;
      }
      if (props.epoch !== sessionEpoch() || runtimes.get(key) !== current || current.abort.signal.aborted) return;
      if (current.reloadRequired()) { window.location.reload(); return; }
      const requested = current.requested();
      const source = value().lenses.find(lens => affected.includes(lens.id))?.source;
      current.dispose();
      runtimes.delete(key);
      setReaderEntries([...runtimes.values()]);
      setReaderVersions(previous => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }));
      if (requested && source) reader(source).request();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function focusLens(id: string, focus: Parameters<WorkspacePane["onFocus"]>[0], presentation?: LocusLayoutChoice,
    targetSource?: WorkspaceSource, fromAddress = false, assertAddressCurrent?: () => void, intent?: WorkspaceNavigationIntent) {
    focus = cloneDraftValue(focus);
    targetSource = targetSource && cloneDraftValue(targetSource);
    // The address guard's retirement belongs to the address owner, which
    // retries a source publication or stays silent for a newer intent; only
    // this navigation's own failures are reported here.
    let addressRetirement: unknown;
    const addressCurrent = assertAddressCurrent && (() => {
      try { assertAddressCurrent(); } catch (error) { addressRetirement = error; throw error; }
    });
    const finishNavigation = !fromAddress ? address.navigationStarted({ retainInitial: true }) : undefined;
    const request = (focusRequests.get(id) ?? 0) + 1;
    focusRequests.set(id, request);
    const presentationRequest = (presentationRequests.get(id) ?? 0) + 1;
    presentationRequests.set(id, presentationRequest);
    // Any newer navigation of this lens replaces the destination it shows.
    if (!surfaceClosed && props.epoch === sessionEpoch()) holdNavigation(id, request, fromAddress ? undefined : intent);
    // Measured in the browser: click -> shown destination -> prepared -> committed.
    performance.mark("fenel:lens-navigation:start");
    try {
      if (surfaceClosed || props.epoch !== sessionEpoch()) return;
      const captured = value().lenses.find(lens => lens.id === id);
      const source = captured?.source;
      if (!source) return;
      let checked = captured;
      const isCurrent = () => {
        const lens = value().lenses.find(lens => lens.id === id);
        addressCurrent?.();
        return !surfaceClosed && props.epoch === sessionEpoch() && focusRequests.get(id) === request && lens === checked
          && (presentation === undefined || presentationRequests.get(id) === presentationRequest)
          && visible().some(candidate => candidate.id === id);
      };
      startPublicReader(targetSource ?? source);
      await props.store.prepare();
      performance.mark("fenel:lens-navigation:prepared");
      const current = value().lenses.find(lens => lens.id === id);
      if (!current) return;
      const [sameSource, sameFocus] = await Promise.all([
        props.store.operate({ kind: "workspaceSourceEqual", args: [current.source, source] }),
        props.store.operate({ kind: "workspaceFocusEqual", args: [current.focus, captured!.focus] }),
      ]);
      checked = current;
      if (!sameSource || targetSource && !sameFocus) return;
      if (!isCurrent()) return;
      if (!await address.permitsFocusAddress(targetSource ?? source, focus) || !isCurrent()) return;
      if (targetSource && !await flushLenses([id])) return;
      if (!isCurrent()) return;
      if (value().activeLensId !== id && value().display.$tag === "SingleLens"
        && !await flushLenses([value().activeLensId])) return;
      if (!isCurrent()) return;
      // A preview can live in a body portal, outside the pane's activation
      // events. Select its owning lens and focus the data in one transition.
      const nextPresentation = presentation === undefined ? undefined : await presentationForKind(presentation);
      const changesSource = targetSource && !await props.store.operate({ kind: "workspaceSourceEqual", args: [targetSource, source] });
      if (!isCurrent()) return;
      if (!await props.store.update([
        ...(value().activeLensId === id ? [] : [{ $tag: "SelectWorkspaceLens" as const, id }]),
        ...(changesSource
          ? [{ $tag: "EditWorkspaceLens" as const, id, command: { $tag: "SetLensSource", source: targetSource } }] : []),
        { $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensFocus", focus: scopeToWorkspace(focus) } },
        ...(nextPresentation === undefined ? [] : [{ $tag: "EditWorkspaceLens" as const, id,
          command: { $tag: "SetLensPresentation", presentation: nextPresentation } }]),
      ], isCurrent)) return;
      performance.mark("fenel:lens-navigation:committed");
      address.navigated();
    } catch (error) {
      if (addressRetirement !== undefined && error === addressRetirement) throw error;
      if (!surfaceClosed && props.epoch === sessionEpoch() && focusRequests.get(id) === request) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!surfaceClosed) releaseNavigation(id, request);
      finishNavigation?.();
    }
  }
  async function setSource(id: string, lensId = value().activeLensId) {
    address.navigationStarted();
    const request = (focusRequests.get(lensId) ?? 0) + 1;
    focusRequests.set(lensId, request);
    releaseNavigation(lensId);
    const lens = value().lenses.find(candidate => candidate.id === lensId);
    if (!lens || id === workspaceSourceKey(lens.source)) return;
    const sourceKey = workspaceSourceKey(lens.source);
    const isCurrent = () => {
      const current = value().lenses.find(candidate => candidate.id === lensId);
      return !surfaceClosed && props.epoch === sessionEpoch() && focusRequests.get(lensId) === request
        && !!current && current.source.$tag === lens.source.$tag && workspaceSourceKey(current.source) === sourceKey;
    };
    try {
      if (!await flushLenses([lens.id]) || !isCurrent()) return;
      await prepareModel();
      if (!isCurrent()) return;
      if (await props.store.update([{ $tag: "EditWorkspaceLens", id: lens.id, command: { $tag: "SetLensSource",
        source: workspaceSourceFromKey(id) } }], isCurrent)) address.navigated();
    } catch (error) { if (isCurrent()) throw error; }
  }
  async function navigateDataTarget(lensId: string, target: Extract<WorkspacePresentationTarget, { $tag: "ValuePresentationTarget" }>,
    mode?: WorkspaceLensOpenMode, presentation?: LocusLayoutChoice, intent?: WorkspaceNavigationIntent) {
    try {
      const lens = value().lenses.find(lens => lens.id === lensId);
      if (!lens || surfaceClosed || props.epoch !== sessionEpoch()) return;
      if (mode) {
        await addLens(lens, scopeFromWorkspace(target.focus), mode, presentation, target.source);
      } else await focusLens(lensId, scopeFromWorkspace(target.focus), presentation, target.source, false, undefined, intent);
    } catch (error) {
      if (!surfaceClosed && props.epoch === sessionEpoch()) setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  async function addLens(from?: WorkspaceLens, focus?: Parameters<WorkspacePane["onFocus"]>[0],
    mode: WorkspaceLensOpenMode = "stack", presentation?: LocusLayoutChoice, targetSource?: WorkspaceSource, fromAddress = false,
    acceptRootTarget?: (id: string) => boolean, onRootNavigationRefused?: () => void, assertAddressCurrent?: () => void) {
    focus = focus && cloneDraftValue(focus);
    targetSource = targetSource && cloneDraftValue(targetSource);
    // The address guard's retirement belongs to the address owner, which
    // retries a source publication or stays silent for a newer intent; only
    // this navigation's own failures are reported here.
    let addressRetirement: unknown;
    const addressCurrent = assertAddressCurrent && (() => {
      try { assertAddressCurrent(); } catch (error) { addressRetirement = error; throw error; }
    });
    const finishNavigation = !fromAddress ? address.navigationStarted({ retainInitial: true }) : undefined;
    let rootNavigationSettled = false;
    const settleRootNavigation = (published = false) => {
      if (rootNavigationSettled) return;
      rootNavigationSettled = true;
      if (!published) onRootNavigationRefused?.();
    };
    const source = from ?? active();
    const origin = source && value().lenses.find(lens => lens.id === source.id);
    const originVisible = origin && visible().some(lens => lens.id === origin.id);
    const request = origin ? (focusRequests.get(origin.id) ?? 0) + 1 : undefined;
    if (origin) focusRequests.set(origin.id, request!);
    const presentationRequest = origin ? (presentationRequests.get(origin.id) ?? 0) + 1 : undefined;
    if (origin) presentationRequests.set(origin.id, presentationRequest!);
    let checked = origin;
    const isCurrent = () => {
      addressCurrent?.();
      if (surfaceClosed || props.epoch !== sessionEpoch()) return false;
      if (!origin) return source === undefined;
      const current = value().lenses.find(lens => lens.id === origin.id);
      return current === checked && focusRequests.get(origin.id) === request
        && (presentation === undefined || presentationRequests.get(origin.id) === presentationRequest)
        && (!originVisible || visible().some(lens => lens.id === origin.id));
    };
    try {
      if (!isCurrent() || !await flushLenses() || !isCurrent()) return;
      startPublicReader(targetSource ?? origin?.source);
      await props.store.prepare();
      if (origin) {
        const current = value().lenses.find(lens => lens.id === origin.id);
        if (!current) return;
        const [sameFocus, sameSource] = await Promise.all([
          props.store.operate({ kind: "workspaceFocusEqual", args: [current.focus, origin.focus] }),
          props.store.operate({ kind: "workspaceSourceEqual", args: [current.source, origin.source] }),
        ]);
        checked = current;
        if (!sameFocus || !sameSource) return;
      }
      if (!isCurrent()) return;
      const id = crypto.randomUUID();
      const guard = () => isCurrent() && (!acceptRootTarget || acceptRootTarget(id));
      const publish = async () => {
        if (!guard()) return;
        const published = await props.store.planUpdate(async (current, operate) => {
          const copy = targetSource ? await operate({ kind: "defaultWorkspaceLens", args: [id, targetSource] })
            : source ? { ...(current.lenses.find(lens => lens.id === source.id) ?? source), id, title: Nothing }
            : await operate({ kind: "defaultWorkspaceLens", args: [id, props.accountId
              ? { $tag: "AccountSource", accountId: props.accountId } : { $tag: "PublicSource" }] });
          const preserveSubject = !targetSource && presentation !== undefined && focus
            && await operate({ kind: "workspaceFocusEqual", args: [copy.focus, scopeToWorkspace(focus)] });
          let lens = focus && !preserveSubject ? await operate({ kind: "workspaceLensWithFocus", args: [copy, scopeToWorkspace(focus)] }) : copy;
          if (presentation !== undefined) lens = await operate({ kind: "workspaceLensWithPresentation", args: [lens, await presentationForKind(presentation, operate)] });
          if (mode === "float" || mode === "split" || presentation !== undefined) {
            lens = await operate({ kind: "workspaceLensWithPlacement", args: [lens, mode === "float"
              ? { $tag: "FreePlacement", ...DEFAULT_FLOATING_LENS } : { $tag: "DockedPlacement" }] });
          }
          const grouped = await operate({ kind: "workspaceGroupedDisplay", args: [current] });
          return [{ $tag: "SetWorkspaceDisplay", display: grouped }, { $tag: "AddWorkspaceLens", lens },
            { $tag: mode === "split" || mode === "float" ? "SplitWorkspaceLens" : "OpenWorkspaceLens", id }];
        }, guard);
        if (published) { settleRootNavigation(true); address.navigated(); }
      };
      // An address is accepted only after this actual focus exists. A View
      // Transition schedules its callback later than the caller's await.
      if (fromAddress) await publish(); else await animateLayout(publish);
    } catch (error) {
      if (addressRetirement !== undefined && error === addressRetirement) throw error;
      if (!surfaceClosed && props.epoch === sessionEpoch() && (!origin || focusRequests.get(origin.id) === request)) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally { settleRootNavigation(); finishNavigation?.(); }
  }
  async function openSavedLens(id: string, mode: "stack" | "split" = "stack", acceptRootTarget?: (id: string) => boolean,
    onRootNavigationRefused?: () => void) {
    address.navigationStarted();
    let rootNavigationSettled = false;
    const settleRootNavigation = (published = false) => {
      if (rootNavigationSettled) return;
      rootNavigationSettled = true;
      if (!published) onRootNavigationRefused?.();
    };
    try {
      if (!await flushLenses()) return;
      await props.store.prepare();
      const guard = () => !surfaceClosed && props.epoch === sessionEpoch() && (!acceptRootTarget || acceptRootTarget(id));
      await animateLayout(async () => {
        if (await props.store.update([{ $tag: mode === "split" ? "SplitWorkspaceLens" : "OpenWorkspaceLens", id }], guard)) {
          settleRootNavigation(true); address.navigated();
        }
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { settleRootNavigation(); }
  }
  async function exploreData(requestedSource?: string, acceptRootTarget?: (id: string) => boolean,
    onRootNavigationRefused?: () => void) {
    const selected = value().lenses.find(lens => lens.id === value().activeLensId);
    const targetSource = requestedSource ?? "all";
    const root = value().lenses.find(lens => lens.focus.$tag === "RootFocus" && sourceId(lens) === targetSource);
    if (root) {
      if (acceptRootTarget && !acceptRootTarget(root.id)) { onRootNavigationRefused?.(); return; }
      await openSavedLens(root.id, "stack", acceptRootTarget, onRootNavigationRefused);
    }
    else if (requestedSource && (!selected || sourceId(selected) !== requestedSource)) {
      await addLens(selected, { kind: "root" }, "stack", undefined, workspaceSourceFromKey(requestedSource), false, acceptRootTarget, onRootNavigationRefused);
    } else await addLens(selected, { kind: "root" }, "stack", undefined, undefined, false, acceptRootTarget, onRootNavigationRefused);
  }
  async function setBordersMerged(merged: boolean) {
    try {
      if (!await flushLenses()) return;
      await props.store.planUpdate(async (current, operate) => {
        const display = current.display;
        const grouped = display.$tag === "GroupedLenses" ? display : await operate({ kind: "workspaceGroupedDisplay", args: [current] });
        if (grouped.$tag !== "GroupedLenses") return [];
        return [
          ...(display.$tag === "GroupedLenses" ? [] : [{ $tag: "SetWorkspaceDisplay" as const, display: grouped }]),
          { $tag: "SetLensGroupMerged", id: grouped.activeGroupId, merged },
        ];
      });
    } catch (error) { if (props.epoch === sessionEpoch()) setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function addGroup() {
    address.navigationStarted();
    try {
      if (!await flushLenses()) return;
      await props.store.prepare();
      if (await props.store.update([{ $tag: "AddLensGroup", id: crypto.randomUUID() }])) address.navigated();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function selectGroup(id: string) {
    address.navigationStarted();
    try {
      if (!await flushLenses()) return;
      await props.store.prepare();
      if (await props.store.update([{ $tag: "SelectLensGroup", id }])) address.navigated();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function closeLens(id: string) {
    address.navigationStarted();
    const request = (focusRequests.get(id) ?? 0) + 1;
    focusRequests.set(id, request);
    releaseNavigation(id);
    if (!await flushLenses([id])) return;
    const isCurrent = () => !surfaceClosed && props.epoch === sessionEpoch() && focusRequests.get(id) === request
      && value().lenses.some(lens => lens.id === id);
    if (!isCurrent()) return;
    try {
      await props.store.prepare();
      if (isCurrent()) await animateLayout(async () => {
        if (await props.store.update([{ $tag: "CloseWorkspaceLens", id }], isCurrent)) address.navigated();
      });
    }
    catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function subjectContext(lens: WorkspaceLens): SubjectContext {
    readerEntries();
    const entry = runtimes.get(workspaceSourceKey(lens.source));
    const runtime = entry?.runtime();
    return { focus: lens.focus, source: lens.source, subject: lens.subject, entry, runtime,
      revision: runtime?.revision(), session: runtime?.session(), epoch: props.epoch };
  }
  function subjectContextCurrent(id: string, context: SubjectContext) {
    const lens = value().lenses.find(lens => lens.id === id);
    return !surfaceClosed && props.epoch === context.epoch && context.epoch === sessionEpoch()
      && !!lens && lens.focus === context.focus && lens.source === context.source && lens.subject === context.subject
      && runtimes.get(workspaceSourceKey(context.source)) === context.entry
      && !context.entry?.abort.signal.aborted && context.entry?.runtime() === context.runtime
      && context.runtime?.revision() === context.revision && context.runtime?.session() === context.session;
  }
  function currentSubject(lens: WorkspaceLens) {
    const subject = subjects()[lens.id];
    return subject && subjectContextCurrent(lens.id, subject) ? subject : undefined;
  }
  function independentPresentationPacket(lens: WorkspaceLens) {
    if (!props.store.prepared() || surfaceClosed || props.epoch !== sessionEpoch()
      || !props.store.isCurrentSession(props.epoch)) return;
    const current = value();
    if (!current.lenses.some(candidate => candidate === lens)) return;
    const packet = props.store.projection();
    if (packet.value !== current) return;
    const ownData = (input: unknown, key: string): unknown => {
      if (!input || typeof input !== "object") return;
      try {
        if (Array.isArray(input)) return;
        const slot = Object.getOwnPropertyDescriptor(input, key);
        return slot && Object.hasOwn(slot, "value") ? slot.value : undefined;
      } catch { return; }
    };
    const row = packet.presentations.find(row => ownData(row, "lensId") === lens.id);
    const presentation = ownData(row, "presentation");
    return ownData(row, "dependsOnType") === false && typeof ownData(presentation, "$tag") === "string"
      && typeof ownData(row, "code") === "string" ? row : undefined;
  }
  function presentationPacket(lens: WorkspaceLens) {
    // Independent rows must return before subscribing to reader/subject state.
    const independent = independentPresentationPacket(lens);
    if (independent) return independent;
    const packet = presentationPackets()[lens.id];
    const context = subjectContext(lens);
    return packet && packet.value === value() && packet.lens === lens && packet.subject === currentSubject(lens)
      && packet.context.epoch === context.epoch && packet.context.entry === context.entry && packet.context.runtime === context.runtime
      && packet.context.revision === context.revision && packet.context.session === context.session ? packet : undefined;
  }
  createEffect(() => ({ prepared: props.store.prepared(), value: value(), lenses: visible()
    .filter(lens => !independentPresentationPacket(lens)).map(lens => ({ lens,
      context: subjectContext(lens), subject: currentSubject(lens) })) }), input => {
    if (!input.prepared) return;
    let cancelled = false;
    void Promise.all(input.lenses.map(async ({ lens, context, subject }) => {
      const result = await props.store.operate({ kind: "workspacePresentationProjection", args: [input.value, lens,
        subject?.typeRef ? Just(subject.typeRef) : Nothing] });
      return { context, value: input.value, lens, subject, ...result };
    })).then(packets => {
      if (cancelled || surfaceClosed || value() !== input.value || props.epoch !== sessionEpoch()
        || packets.some(packet => !subjectContextCurrent(packet.lens.id, packet.context) || currentSubject(packet.lens) !== packet.subject)) return;
      setPresentationPackets(Object.fromEntries(packets.map(packet => [packet.lens.id, packet])));
    }).catch(error => { if (!cancelled && value() === input.value) showFailure(error); });
    return () => { cancelled = true; };
  });
  function selectedPresentation(lens: WorkspaceLens) {
    return presentationPacket(lens)?.presentation;
  }
  function menuItems(): LocusMenuItem[] {
    const lens = active();
    if (!lens) return [{ id: "bar-settings", label: "Lens settings…", icon: "settings", onSelect: () => setSettings(true) }];
    const preferred = selectedPresentation(lens);
    const shown = currentSubject(lens)?.kind;
    const typeRef = currentSubject(lens)?.typeRef;
    const canRemember = !!preferred && (preferred.$tag !== "AutomaticPresentation" || !!shown && shown !== "derive-canvas");
    const remember = (target: WorkspacePresentationTarget) => {
      const context = subjectContext(lens);
      void (async () => {
        const presentation = preferred?.$tag === "AutomaticPresentation" && shown && shown !== "derive-canvas"
          ? await presentationForKind(shown) : preferred;
        if (presentation) await props.store.update([{ $tag: "SetWorkspacePresentation", target, presentation }], () => subjectContextCurrent(lens.id, context));
      })().catch(showFailure);
    };
    return [
      { id: "merge-borders", label: bordersMerged() ? "Separate the lens borders" : "Merge the lens borders",
        onSelect: () => { void setBordersMerged(!bordersMerged()); } },
      { id: "rename-lens", label: "Name this lens…", separatorBefore: true, onSelect: () => { void promptDialog({ message: "Lens name", defaultValue: peelMaybeValue(lens.title) ?? title(lens), confirmLabel: "Save" }).then(name => {
        if (typeof name === "string") updatePreferences([{ $tag: "EditWorkspaceLens", id: lens.id,
          command: { $tag: "SetLensTitle", title: name ? Just(name) : Nothing } }]);
      }).catch(showFailure); } },
      { id: "remember-value", label: "Use this lens by default for this data", disabled: !canRemember,
        onSelect: () => remember({ $tag: "ValuePresentationTarget", source: lens.source, focus: lens.focus }) },
      { id: "remember-type", label: "Use this lens by default for data of this type", disabled: !typeRef || !canRemember,
        onSelect: () => { if (typeRef) remember({ $tag: "InhabitantsPresentationTarget", typeRef }); } },
      { id: "automatic-view", label: "Use the preferred lens", onSelect: () => updatePreferences([{ $tag: "EditWorkspaceLens", id: lens.id,
        command: { $tag: "SetLensPresentation", presentation: { $tag: "AutomaticPresentation" } } }]) },
      { id: "clear-value-view", label: "Forget the preferred lens for this data", onSelect: () => updatePreferences([
        { $tag: "SetWorkspacePresentation", target: { $tag: "ValuePresentationTarget", source: lens.source, focus: lens.focus }, presentation: { $tag: "AutomaticPresentation" } },
        { $tag: "EditWorkspaceLens", id: lens.id, command: { $tag: "SetLensPresentation", presentation: { $tag: "AutomaticPresentation" } } },
      ]) },
      { id: "clear-type-view", label: "Forget the preferred lens for data of this type", disabled: !typeRef,
        onSelect: () => { if (typeRef) updatePreferences([{ $tag: "SetWorkspacePresentation", target: { $tag: "InhabitantsPresentationTarget", typeRef }, presentation: { $tag: "AutomaticPresentation" } }]); } },
      { id: "bar-settings", label: "Lens settings…", icon: "settings", separatorBefore: true, onSelect: () => setSettings(true) },
    ];
  }
  function groupMenuItems(): LocusMenuItem[] {
    const display = value().display;
    if (display.$tag !== "GroupedLenses") return [];
    return [
      ...display.groups.map((group, index) => ({
        id: `group-${group.id}`, label: `Lenses ${index + 1}`, checked: display.activeGroupId === group.id,
        icon: "panels-top-left", onSelect: () => { void selectGroup(group.id); },
      })),
      ...(display.groups.length > 1 ? display.groups.map((group, index) => ({
        id: `remove-group-${group.id}`, label: `Remove Lenses ${index + 1}`,
        onSelect: () => { void (async () => { if (await flushLenses()) await props.store.update([{ $tag: "RemoveLensGroup", id: group.id }]); })().catch(showFailure); },
      })) : []),
    ];
  }

  function openLensMenu(event: MouseEvent | KeyboardEvent) {
    if (event instanceof KeyboardEvent && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const opener = event.currentTarget as HTMLButtonElement;
    const rect = opener.getBoundingClientRect();
    setLensMenu({ x: rect.left, y: rect.bottom + 4, opener });
  }
  function Controls() {
    return <div class="workspace-controls" inert={returningHome()}>
      <Show when={visible().length !== 1 || !!lensFrame(visible()[0]!)}><div class="workspace-data-controls">
        <div class="home-toolbar">
          <button type="button" class="btn home-search-trigger home-action-button" aria-label="Browse"
            onClick={() => rootShelf.request("browse")}><IconByName name="search" size={16} /><span>Browse</span></button>
          <button type="button" class="btn home-action-button workspace-new-data" aria-label="New data"
            onClick={() => rootShelf.request("new:expression")}><IconPlus size={16} /><span>New</span></button>
        </div>
      </div></Show>
      <fieldset class="workspace-lens-controls" style="border: 0; padding: 0; margin: 0; min-width: 0">
        <span class="workspace-lens-group">
          <button type="button" class="workspace-lens-group__part workspace-lens-group__menu" aria-label="Lenses" aria-haspopup="menu" aria-expanded={lensMenu() ? "true" : "false"}
            data-tooltip={synchronization().error() ? "Lenses · Changes are unsaved" : synchronization().pending() > 0 ? "Lenses · Unsaved changes" : "Lenses"}
            onClick={openLensMenu} onKeyDown={openLensMenu}>
            <IconByName name="panels-top-left" size={16} />
            <span class="workspace-lens-group__label">Lenses</span>
            <Show when={synchronization().pending() > 0 || synchronization().error()}><span class="workspace-lens-menu__pending" aria-hidden="true" /></Show>
          </button>
          <button type="button" class="workspace-lens-group__part" aria-label="Add lens" disabled={!props.store.prepared()} onClick={() => { void addLens(); }}><IconPlus size={16} /></button>
          <button type="button" class="workspace-lens-group__part" aria-label="Lens settings" aria-haspopup="menu" disabled={!props.store.prepared()} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 });
          }}><IconSettings size={16} /></button>
        </span>
      </fieldset>
      <div class="workspace-sync-controls">
        <button type="button" class="workspace-sync" aria-label="Automatic synchronization"
          aria-pressed={synchronization().enabled() ? "true" : "false"}
          data-sync-status={synchronization().error() ? "error" : synchronization().saving() ? "syncing" : synchronization().enabled() ? "synced" : "paused"}
          data-tooltip={synchronization().enabled()
            ? "Synchronization is on. Local data saves on this device; account data saves to its server. Turn it off to keep changes unsaved until Save."
            : "Synchronization is off. Save keeps local data on this device and account data on its server. Unsaved changes are lost on reload or close."}
          disabled={synchronization().saving() && !synchronization().enabled()}
          onClick={() => { void synchronization().setEnabled(!synchronization().enabled()); }}>
          <IconByName name="repeat" size={17} />
          <Show when={!synchronization().enabled()}><span class="workspace-sync__paused" aria-hidden="true" /></Show>
          <Show when={synchronization().error()}><span class="workspace-sync__warning"><IconByName name="alert-triangle" size={10} /></span></Show>
        </button>
        <Show when={synchronization().pending() > 0}>
          <button type="button" class="workspace-sync-save" aria-label="Save pending changes"
            disabled={synchronization().saving()} onClick={() => { void synchronization().saveAll(); }}>Save</button>
          <button type="button" class="workspace-sync-discard" aria-label="Discard pending changes"
            disabled={synchronization().saving()} onClick={() => { void discardPendingChanges(); }}><IconByName name="x" size={14} /></button>
        </Show>
      </div>
    </div>;
  }

  async function discardPendingChanges() {
    if (synchronization().saving()) return;
    if (await confirmDialog({ message: "Discard pending changes?", detail: "This restores the last saved data and lens settings.",
      variant: "danger", confirmLabel: "Discard", cancelLabel: "Keep changes" })) await synchronization().discardAll();
  }

  function lensFrame(lens: WorkspaceLens) {
    const placement = lens.placement;
    if (placement?.$tag === "FreePlacement" && Number.isFinite(placement.width) && placement.width > 0
      && Number.isFinite(placement.height) && placement.height > 0) {
      return { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
    }
    return undefined;
  }
  function LensChromeControls(control: { id: string; restore?: boolean }) {
    const mode = () => lensChromeModes()[control.id] ?? "expanded";
    const setMode = (next: "expanded" | "compact" | "hidden") =>
      setLensChromeMode(control.id, next);
    return <Show when={control.restore} fallback={<>
      <Show when={mode() === "compact"}><button type="button" class="workspace-pane__fold"
        aria-label="Expand lens header" onClick={() => setMode("expanded")}>
        <IconByName name="chevron-down" size={15} /></button></Show>
      <button type="button" class="workspace-pane__fold workspace-pane__fold--collapse"
        aria-label={mode() === "expanded" ? "Compact lens header" : "Hide lens controls"}
        onClick={() => setMode(mode() === "expanded" ? "compact" : "hidden")}>
        <IconByName name="chevron-down" size={15} /></button>
    </>}><Show when={mode() === "hidden"}><button type="button" class="workspace-corner workspace-corner--lens"
      aria-label="Show lens controls" onClick={() => setMode("compact")}>
      <IconByName name="chevron-down" size={13} /></button></Show></Show>;
  }
  function LensPanel(panel: { lens: WorkspaceLens }) {
    const id = untrack(() => panel.lens.id);
    const initialPresentationCode = untrack(() => props.store.projection().presentations.find(row => row.lensId === id)?.code);
    const [headerMount, setHeaderMount] = createSignal<HTMLElement>();
    const [summaryMount, setSummaryMount] = createSignal<HTMLElement>();
    const [suggestions, setSuggestions] = createSignal<import("./DataInspectionDialog").DataInspectionSuggestions>();
    let suggestionsOwner: import("./DataInspectionDialog").DataInspectionSuggestions | undefined;
    let suggestionsGeneration = 0;
    const chromeMode = () => lensChromeModes()[id] ?? "expanded";
    const [draft, setDraft] = createSignal<{ x: number; y: number; width: number; height: number }>();
    let placementDraft: ReturnType<typeof draft>;
    let placementTicket = 0;
    let panelClosed = false;
    const [dragging, setDragging] = createSignal(false);
    let cancelGesture: ((clearDraft?: boolean) => void) | undefined;
    onSettled(() => () => { panelClosed = true; placementTicket++; cancelGesture?.(false); });
    const frame = () => draft() ?? lensFrame(panel.lens);
    function placeDraft(next: ReturnType<typeof draft>) { placementDraft = next; setDraft(next); }
    async function commit(next: { x: number; y: number; width: number; height: number }) {
      if (!props.store.prepared()) return;
      const ticket = ++placementTicket;
      const placement = { ...next, width: Math.max(220, next.width), height: Math.max(160, next.height) };
      placeDraft(placement);
      const isCurrent = () => !panelClosed && !surfaceClosed && props.epoch === sessionEpoch()
        && placementTicket === ticket && value().lenses.some(lens => lens.id === id);
      try {
        await props.store.update([{ $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensPlacement", placement: {
          $tag: "FreePlacement", ...placement,
        } } }], isCurrent);
      } catch (error) { if (isCurrent()) showFailure(error); }
      finally { if (isCurrent()) placeDraft(undefined); }
    }
    function moveWithinSurface(next: { x: number; y: number; width: number; height: number }, surface: HTMLElement | null) {
      if (!surface) return next;
      // Keep the grip and header reachable even when the window is wider or
      // taller than the current browser surface. These are DOM coordinates.
      return { ...next, x: Math.max(0, Math.min(next.x, surface.clientWidth - 48)),
        y: Math.max(0, Math.min(next.y, surface.clientHeight - 32)) };
    }
    function gesture(event: PointerEvent, mode: "move" | "resize") {
      if (!props.store.prepared() || event.button !== 0 || !event.isPrimary) return;
      if (mode === "move" && event.target instanceof Element && !event.target.closest(".workspace-pane__grip")
        && event.target.closest("button, a, input, textarea, select, .locus-select")) return;
      const start = placementDraft ?? frame() ?? DEFAULT_FLOATING_LENS;
      if (mode === "move" && !frame()) return;
      cancelGesture?.();
      placementTicket++;
      if (!pane.active()) void selectLens(id);
      event.preventDefault();
      event.stopPropagation();
      const origin = { px: event.clientX, py: event.clientY, ...start };
      const pointerId = event.pointerId;
      const surface = (event.currentTarget as HTMLElement).closest<HTMLElement>(".workspace-panes");
      setDragging(mode === "move");
      const position = (ev: PointerEvent) => {
        const dx = ev.clientX - origin.px;
        const dy = ev.clientY - origin.py;
        return mode === "move"
          ? moveWithinSurface({ x: origin.x + dx, y: origin.y + dy, width: origin.width, height: origin.height }, surface)
          : { x: origin.x, y: origin.y, width: Math.max(220, origin.width + dx), height: Math.max(160, origin.height + dy) };
      };
      const move = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) placeDraft(position(ev));
      };
      const cleanup = (clearDraft = true) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", blur);
        cancelGesture = undefined;
        if (clearDraft) { placementTicket++; placeDraft(undefined); setDragging(false); }
      };
      const blur = () => cleanup();
      const cancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) cleanup(); };
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const next = position(ev);
        cleanup(false); setDragging(false);
        void commit(next);
      };
      cancelGesture = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", blur);
    }
    const pane: WorkspacePane = {
      id, active: () => value().activeLensId === id,
      focus: () => scopeFromWorkspace(panel.lens.focus), presentation: () => {
        const projected = presentationPacket(panel.lens) ?? props.store.projection().presentations.find(row => row.lensId === id);
        // A packet can retire this panel before its owned Home effects dispose.
        // Keep that panel's checked presentation through the disposal boundary.
        const code = projected?.code ?? initialPresentationCode;
        if (code === undefined) throw new Error("The saved lens presentation is unavailable.");
        return layoutFromWorkspaceCode(code);
      },
      fields: () => peelMaybeValue(panel.lens.fields) ?? undefined,
      projectFields: identities => props.store.operate({ kind: "workspaceFieldProjection", args: [identities, panel.lens.fields ?? Nothing] }),
      onFields: async fields => {
        const captured = panel.lens;
        const isCurrent = () => !panelClosed && !surfaceClosed && props.epoch === sessionEpoch() && panel.lens === captured;
        await props.store.planUpdate(async () => [{ $tag: "EditWorkspaceLens", id,
          command: { $tag: "SetLensFields", fields: fields ? Just(fields) : Nothing } }], isCurrent);
      },
      toolbarMount: () => headerMount(),
      summaryMount: () => summaryMount(),
      inspectionMode: () => inspectionModes()[id] ?? "data",
      shortcuts: () => props.store.projection().shortcuts?.find(row => row.lensId === id)?.shortcuts
        ?? peelMaybeValue(panel.lens.shortcuts) ?? undefined,
      suggestions,
      registerSuggestions: owner => {
        const generation = ++suggestionsGeneration;
        suggestionsOwner?.close(); suggestionsOwner = owner; setSuggestions(owner);
        return () => {
          if (suggestionsGeneration !== generation || suggestionsOwner !== owner) return;
          owner.close(); suggestionsOwner = undefined;
          const retired = ++suggestionsGeneration;
          // Reader disposal can run under a reactive computation. Retire its
          // ownership now, then notify the surviving pane at the host boundary.
          queueMicrotask(() => {
            if (suggestionsGeneration === retired && !surfaceClosed && props.epoch === sessionEpoch()) setSuggestions(undefined);
          });
        };
      },
      addressInputs: () => pane.active() ? address.inputs() : undefined,
      onAddressInputsHandled: address.inputsHandled,
      onAddressInputsChanged: address.inputsChanged,
      subject: () => peelMaybeValue(panel.lens.subject) ?? undefined,
      onSubjectData: (subject, presentation, readerCurrent) => {
        subject = subject && registryTransportSnapshot(snapshot(subject), "lens subject", "value-read");
        const captured = value().lenses.find(lens => lens.id === id);
        if (!captured || readerCurrent?.() === false) return;
        const ticket = (focusRequests.get(id) ?? 0) + 1; focusRequests.set(id, ticket);
        releaseNavigation(id);
        let current: WorkspaceLens | undefined;
        const isCurrent = () => !surfaceClosed && props.epoch === sessionEpoch() && focusRequests.get(id) === ticket
          && readerCurrent?.() !== false && (!current || value().lenses.find(lens => lens.id === id) === current);
        void props.store.planUpdate(async (preferences, operate) => {
          current = preferences.lenses.find(lens => lens.id === id);
          if (!current) throw new Error("This lens was closed.");
          const sameFocus = await operate({ kind: "workspaceFocusEqual", args: [current.focus, captured.focus] });
          const sameSource = await operate({ kind: "workspaceSourceEqual", args: [current.source, captured.source] });
          if (!sameFocus || !sameSource) throw new Error("This lens data changed. Open it again.");
          if (subject && !await operate({ kind: "workspaceSourceEqual", args: [subject.originSource, current.source] }))
            throw new Error("This lens data belongs to another source.");
          const commands: WorkspaceCommand[] = subject
            ? [{ $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensFocus", focus: subject.originFocus } }] : [];
          commands.push({ $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensSubject", subject: subject ? Just(subject) : Nothing } });
          if (presentation !== undefined) commands.push({ $tag: "EditWorkspaceLens", id,
            command: { $tag: "SetLensPresentation", presentation: await presentationForKind(presentation, operate) } });
          return commands;
        }, isCurrent).catch(error => { if (props.epoch === sessionEpoch() && focusRequests.get(id) === ticket)
        setMessage(error instanceof Error ? error.message : String(error)); }); },
      shortcutRequest: () => shortcutRequests()[id],
      onShortcut: shortcut => {
        if (props.epoch !== sessionEpoch()) return;
        setShortcutRequests(previous => ({ ...previous, [id]: { id: ++nextShortcutRequest, shortcut } }));
        reader(panel.lens.source).request();
      },
      onShortcutHandled: requestId => setShortcutRequests(previous => {
        if (previous[id]?.id !== requestId) return previous;
        const next = { ...previous }; delete next[id]; return next;
      }),
      onInspectionMode: mode => {
        if (props.epoch !== sessionEpoch() || !value().lenses.some(lens => lens.id === id)) return;
        setInspectionModes(previous => previous[id] === mode ? previous : { ...previous, [id]: mode });
      },
      browseState: () => {
        const held = browseStates()[id];
        return held?.source === workspaceSourceKey(panel.lens.source) ? held : undefined;
      },
      onBrowseChange: state => {
        const source = untrack(() => workspaceSourceKey(panel.lens.source));
        setBrowseStates(previous => previous[id]?.source === source && previous[id]?.open === state.open && previous[id]?.query === state.query
          ? previous : { ...previous, [id]: { ...state, source } });
      },
      creationDraft: () => creationDraft(id, panel.lens.source, scopeFromWorkspace(panel.lens.focus)),
      onCreationDraft: (draft, owner) => retainCreationDraft(id, panel.lens.source, draft, owner),
      source: () => panel.lens.source, sourceLabel: () => sourceLabel(panel.lens), accounts,
      creationSource: sourceId => {
        if (surfaceClosed || props.epoch !== sessionEpoch()) throw new Error("These lenses were closed.");
        if (sourceId !== "local" && !props.accounts.some(account => account.id === sourceId)) {
          throw new Error("This creation scope is not available.");
        }
        const entry = reader(sourceId === "local" ? { $tag: "ThisTabSource" } : { $tag: "AccountSource", accountId: sourceId });
        if (!entry.client) throw new Error("This creation scope has no editable data source.");
        return { client: entry.client, ready: entry.ready };
      },
      onAllData: mode => {
        const target: WorkspacePresentationTarget = { $tag: "ValuePresentationTarget", source: { $tag: "AllDataSource" }, focus: { $tag: "RootFocus" } };
        void navigateDataTarget(id, target, mode, undefined, mode ? undefined : { name: "All data", icon: "list" });
      },
      onDataTarget: (target, mode, presentation, intent) => { void navigateDataTarget(id, target, mode, presentation, intent); },
      onFocus: (focus, presentation, intent) => { void focusLens(id, focus, presentation, undefined, false, undefined, intent); },
      navigationPending: () => pendingNavigation(id),
      openElsewhere: (scope, place, source) => openElsewhere(source ?? panel.lens.source, scope, place),
      openElsewhereUnavailable: source => elsewhereUnavailable(source ?? panel.lens.source),
      onOpenLens: (focus, mode, presentation) => { void addLens(panel.lens, focus, mode, presentation); },
      onClose: () => { void closeLens(id); },
      onPresentation: kind => {
        const context = subjectContext(panel.lens);
        const focusTicket = focusRequests.get(id);
        const presentationTicket = (presentationRequests.get(id) ?? 0) + 1;
        presentationRequests.set(id, presentationTicket);
        const isCurrent = () => subjectContextCurrent(id, context) && focusRequests.get(id) === focusTicket
          && presentationRequests.get(id) === presentationTicket;
        void props.store.planUpdate(async (_current, operate) => [{ $tag: "EditWorkspaceLens", id,
          command: { $tag: "SetLensPresentation", presentation: await presentationForKind(kind, operate) } }], isCurrent)
        .catch(error => { if (props.epoch === sessionEpoch() && presentationRequests.get(id) === presentationTicket)
        setMessage(error instanceof Error ? error.message : String(error)); }); },
      onSource: source => { void setSource(source, id).catch(error => {
        if (props.epoch === sessionEpoch()) setMessage(error instanceof Error ? error.message : String(error));
      }); },
      // LensReader supplies the callback bound to its exact focus and reader.
      onSubject: () => {},
      registerFlush: (flush, idle) => {
        const guarded = async (reason?: "home-check" | "home") => {
          const source = workspaceSourceKey(panel.lens.source);
          if (await flush(reason) === false) return false;
          if (reason === "home" && !surfaceClosed && props.epoch === sessionEpoch()
            && value().lenses.some(lens => lens.id === id && workspaceSourceKey(lens.source) === source)) setLensChromeMode(id, "expanded");
          return true;
        };
        flushers.set(id, guarded);
        if (idle) idleFlushers.set(guarded, idle);
        return () => { idleFlushers.delete(guarded); if (flushers.get(id) === guarded) flushers.delete(id); };
      },
    };
    const placed = () => frame();
    return <section class={['workspace-pane', { 'workspace-pane--active': pane.active(), 'workspace-pane--waiting': !!waits()[id], 'workspace-pane--free': !!placed(), 'workspace-pane--chrome-hidden': chromeMode() === "hidden" }]}
      data-workspace-lens={id}
      data-chrome-mode={chromeMode()}
      data-navigation-pending={pendingNavigation(id) ? "true" : undefined}
      data-lens-dragging={dragging() ? "true" : undefined}
      style={{ "view-transition-name": `lens-${CSS.escape(id)}`, ...(placed() ? { left: `${placed()!.x}px`, top: `${placed()!.y}px`, width: `${placed()!.width}px`, height: `${placed()!.height}px` } : {}) }}
      onPointerDown={() => { if (!pane.active()) void selectLens(id); }} onFocusIn={() => {
        // Pointer activation commits first; its following focus event must
        // not select the same pane twice before Solid's queued write lands.
        queueMicrotask(() => { if (!pane.active()) void selectLens(id); });
      }}>
      <header class="workspace-pane__header" inert={chromeMode() === "hidden"}
        aria-hidden={chromeMode() === "hidden" ? "true" : undefined}
        onPointerDown={event => { if (placed()) gesture(event, "move"); }}>
        <Show when={placed()}><button type="button" class="workspace-pane__grip" aria-label="Move lens"
          disabled={!props.store.prepared()}
          onPointerDown={event => gesture(event, "move")} onKeyDown={event => {
            const current = placementDraft ?? frame();
            if (!current || !props.store.prepared()) return;
            const step = event.shiftKey ? 40 : 10;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            event.stopPropagation();
            void commit(moveWithinSurface({ ...current, x: current.x + dx, y: current.y + dy },
              event.currentTarget.closest<HTMLElement>(".workspace-panes")));
          }}><span aria-hidden="true" /></button></Show>
        <div class="workspace-pane__toolbar-mount" ref={element => onSettled(() => { setHeaderMount(element); })} />
        <DataInspectionControls mode={pane.inspectionMode!()} onModeChange={mode => pane.onInspectionMode!(mode)}
          shortcuts={pane.shortcuts?.()} onShortcut={pane.onShortcut} suggestionOwner={pane.suggestions?.()} />
        <LensChromeControls id={id} />
        <button type="button" class="workspace-pane__float" disabled={!props.store.prepared()} aria-label={placed() ? "Dock lens" : "Float lens"}
          onClick={() => {
            void animateLayout(async () => {
              if (placed()) {
                const ticket = ++placementTicket;
                const isCurrent = () => !panelClosed && !surfaceClosed && props.epoch === sessionEpoch() && placementTicket === ticket;
                try { await props.store.update([{ $tag: "EditWorkspaceLens", id, command: { $tag: "SetLensPlacement", placement: { $tag: "DockedPlacement" } } }], isCurrent); }
                finally { if (isCurrent()) placeDraft(undefined); }
              } else await commit(DEFAULT_FLOATING_LENS);
            }).catch(showFailure);
          }}><IconByName name={placed() ? "panels-top-left" : "layout-grid"} size={15} /></button>
        <button type="button" class="workspace-pane__close" aria-label="Close lens"
          onClick={pane.onClose}><IconByName name="x" size={14} /></button>
      </header>
      <div class="workspace-pane__summary" aria-hidden={chromeMode() !== "expanded" ? "true" : undefined}
        inert={chromeMode() !== "expanded"}>
        <div class="workspace-pane__summary-mount" ref={element => onSettled(() => { setSummaryMount(element); })}>
          <div class="workspace-pane__summary-placeholder" aria-hidden="true">
            <span>{pane.sourceLabel()}</span><span class="workspace-pane__summary-skeleton" />
          </div>
        </div>
      </div>
      <LensChromeControls id={id} restore />
      {/* Keyed: the destination's summary memos must never read a released
          navigation (a non-keyed accessor throws "Stale read from <Show>"). */}
      <Show when={pendingNavigation(id)} keyed>{pending => <PendingDestination pending={pending} />}</Show>
      <Show when={placed()}><div class="workspace-pane__resize" aria-hidden="true" onPointerDown={event => gesture(event, "resize")} /></Show>
      <Show when={!internalSource(panel.lens)} fallback={<div class="workspace-pane__body"><LensPending id={id} stage={sharedStartupWait().stage} detail={sharedStartupWait().detail} /></div>}>
      <Show when={props.epoch + 1} keyed>{(_epoch) => <Show when={workspaceSourceKey(panel.lens.source)} keyed>{key =>
        <LensReader source={untrack(() => panel.lens.source)} sourceKey={key} pane={pane} />
      }</Show>}</Show>
      </Show>
    </section>;
  }

  /** The destination shown at once: the clicked card's name and mark, and a
   * loader for the rest. It covers the previous data, which stays mounted. */
  function PendingDestination(destination: { pending: WorkspacePendingNavigation }) {
    const label = () => `Opening ${displayNameText(destination.pending.name)?.trim() || "data"}…`;
    return <div class="workspace-pane__navigation" data-navigation-destination="true">
      <div class="workspace-pane__summary"><LensDataSummary name={destination.pending.name} icon={destination.pending.icon}
        emoji={destination.pending.emoji} unnamed={!displayNameText(destination.pending.name)?.trim()} /></div>
      <div class="workspace-pane__body"><div class="workspace-pane__wait" role="status" aria-label={label()}>
        <span class="home-new-button__spinner" aria-hidden="true" /></div></div>
    </div>;
  }
  function LensReader(panel: { source: WorkspaceSource; sourceKey: string; pane: WorkspacePane }) {
    const [entry, setEntry] = createSignal<ReaderEntry>();
    const generation = createMemo(() => readerVersions()[panel.sourceKey] ?? 0);
    createEffect(() => ({ source: panel.source, generation: generation() }), ({ source }) => { setEntry(untrack(() => reader(source))); });
    const boundPane = createMemo(() => {
      const pane = panel.pane;
      const lens = value().lenses.find(lens => lens.id === pane.id);
      const prepared = entry();
      const runtime = prepared?.runtime();
      const context: SubjectContext | undefined = lens && { focus: lens.focus, source: lens.source, subject: lens.subject,
        epoch: props.epoch, entry: prepared, runtime, revision: runtime?.revision(), session: runtime?.session() };
      return { ...pane,
        onSubject: (typeRef: string | undefined, label: string, kind: LocusLayoutChoice) => {
          if (!context || !subjectContextCurrent(pane.id, context)) return;
          setSubjects(previous => {
            const old = previous[pane.id];
            return old && old.typeRef === typeRef && old.label === label && old.kind === kind
              && old.focus === context.focus && old.source === context.source && old.subject === context.subject
              && old.entry === context.entry && old.runtime === context.runtime && old.epoch === context.epoch
              && old.revision === context.revision && old.session === context.session
              ? previous : { ...previous, [pane.id]: { ...context, typeRef, label, kind } };
          });
        },
        onSubjectData: (subject: LensTypedSubject | undefined, presentation?: LocusLayoutChoice) => {
          if (context && subjectContextCurrent(pane.id, context)) pane.onSubjectData?.(subject, presentation, () => subjectContextCurrent(pane.id, context));
        },
      };
    });
    async function retry() {
      await retryReader(panel.sourceKey, entry());
    }
    return <div class="workspace-pane__body"><Show when={entry()} keyed fallback={<LensPending id={panel.pane.id} {...sharedStartupWait()} />}>
    {prepared => <Errored fallback={error => { logSurfaceFailure("A lens", error()); return <LocusLoadFailure message="Could not load data."
      detail={String((error() as Error)?.message ?? error())} retry={retry} />; }}>
    <Loading on={panel.sourceKey} fallback={<LensPending id={panel.pane.id} {...sharedStartupWait()} />}>
      <Show when={prepared.client} fallback={
        <Show when={prepared.runtime()} fallback={
          <Show when={prepared.error()} fallback={<LensPending id={panel.pane.id} {...sharedStartupWait()} />}>
            <LoadingScreen inline error={prepared.error()} retry={retry} />
          </Show>
        }>
          {loaded => <ReaderRuntimeProvider runtime={loaded()}><HomePage publicData={loaded().publicData} pane={boundPane()} /></ReaderRuntimeProvider>}
        </Show>
      }>{client => <Show when={(!prepared.publicRoot || prepared.publicRoot()) && (!prepared.navigationRoot || prepared.navigationRoot())} fallback={
        <Show when={prepared.error()} fallback={<LensPending id={panel.pane.id} {...sharedStartupWait()} />}>
          <LoadingScreen inline error={prepared.error()} retry={retry} />
        </Show>
      }><HomeEntry client={client()} pane={boundPane()} publicRoot={prepared.publicRoot?.()} navigationRoot={prepared.navigationRoot?.()} readRuntime={prepared.runtime()} readiness={{
        request: prepared.request, ready: () => !!prepared.runtime(), loading: () => prepared.preparing(),
        stage: prepared.stage, error: () => prepared.error() ?? null, retry,
        retryLabel: () => prepared.reloadRequired() ? "Reload page" : "Retry",
      }} prepareWorkspace={() => HomePage.preload()} renderWorkspace={initialAction => <ReaderRuntimeProvider runtime={prepared.runtime()!}>
        <HomePage initialAction={initialAction} publicData={prepared.runtime()?.publicData} pane={boundPane()} />
      </ReaderRuntimeProvider>} /></Show>}</Show>
    </Loading></Errored>}</Show></div>;
  }

  const dockedLenses = () => visible().filter(lens => !lensFrame(lens));
  const floatingLenses = () => visible().filter(lens => !!lensFrame(lens));
  const gridPlan = () => {
    if (!floatingLenses().length) return plan();
    const count = Math.max(dockedLenses().length, 1);
    const columns = width() < 720 || dockedLenses().length <= 1 ? 1 : Math.max(1, Math.ceil(Math.sqrt(count)));
    return { columns, rows: Math.max(1, Math.ceil(dockedLenses().length / columns)) };
  };
  function InitialAddress() {
    // A public deep link the build already answered shows its own data from the snapshot (title,
    // breadcrumb, cards or plain value) while the worker resolves the address. The resolved lens
    // replaces this preview whatever it answers.
    const earlyFocus = createMemo(() => {
      const early = address.initialFocus?.();
      return early?.source.$tag === "PublicSource" ? early.focus : undefined;
    });
    const publicHome = createMemo(() => address.initialRootSource()?.$tag === "PublicSource" || !!earlyFocus());
    const allDataHome = createMemo(() => address.initialRootSource()?.$tag === "AllDataSource");
    const localHome = createMemo(() => address.initialRootSource()?.$tag === "ThisTabSource");
    const loadingLabel = () => allDataHome()
      ? "Opening All data…" : "Opening data address…";
    const snapshot = createMemo(() => {
      props.epoch;
      return publicHome() ? loadPublicBootstrap().then(data => data.root)
        : localHome() ? localTabDataSource().firstPaint().then(() => localTabDataSource().root())
        : allDataHome() ? props.store.allDataRoot : undefined;
    });
    const source = (): WorkspaceSource => allDataHome() ? { $tag: "AllDataSource" }
      : localHome() ? { $tag: "ThisTabSource" } : { $tag: "PublicSource" };
    const [previewEntry, setPreviewEntry] = createSignal<ReaderEntry>();
    const [headerMount, setHeaderMount] = createSignal<HTMLElement>();
    const [summaryMount, setSummaryMount] = createSignal<HTMLElement>();
    const selectedId = () => value().activeLensId;
    const chromeMode = () => lensChromeModes()[selectedId()] ?? "expanded";
    createEffect(() => ({ epoch: props.epoch, key: publicHome() ? "public" : localHome() ? "local"
      : allDataHome() && props.store.allDataRoot ? "all" : undefined }), ({ key }) => {
      if (key) setPreviewEntry(untrack(() => reader(source())));
    });
    const navigatePreview = (focus: Parameters<WorkspacePane["onFocus"]>[0], target: WorkspaceSource = source(), presentation?: LocusLayoutChoice,
      intent?: WorkspaceNavigationIntent) => {
      const selected = value().lenses.find(lens => lens.id === value().activeLensId);
      const epoch = props.epoch, rootSource = address.initialRootSource(), early = address.initialFocus?.(), entry = previewEntry();
      const assertCurrent = () => {
        if (surfaceClosed || props.epoch !== epoch || epoch !== sessionEpoch() || address.initialRootSource() !== rootSource
          || address.initialFocus?.() !== early
          || previewEntry() !== entry || entry?.abort.signal.aborted) throw new Error("This data preview changed. Open the current data again.");
      };
      if (selected) void focusLens(selected.id, focus, presentation, target, false, assertCurrent, intent);
    };
    const previewPane: WorkspacePane = {
      id: "initial-address-preview", active: () => true, focus: () => earlyFocus() ?? { kind: "root" }, presentation: () => undefined,
      source, sourceLabel: () => allDataHome() ? "All data" : localHome() ? "Local" : "Fenel", accounts,
      toolbarMount: headerMount, summaryMount,
      shortcuts: () => peelMaybeValue(active()?.shortcuts) ?? undefined,
      inspectionMode: () => inspectionModes()[selectedId()] ?? "data",
      onInspectionMode: mode => {
        const id = selectedId();
        setInspectionModes(previous => ({ ...previous, [id]: mode }));
      },
      browseState: () => {
        const held = browseStates()[selectedId()];
        return held?.source === workspaceSourceKey(source()) ? held : undefined;
      },
      onBrowseChange: state => {
        const held = untrack(() => ({ id: selectedId(), source: workspaceSourceKey(source()) }));
        setBrowseStates(previous => previous[held.id]?.source === held.source && previous[held.id]?.open === state.open && previous[held.id]?.query === state.query
          ? previous : { ...previous, [held.id]: { ...state, source: held.source } });
      },
      creationDraft: () => creationDraft(selectedId(), source(), { kind: "root" }),
      onCreationDraft: (draft, owner) => retainCreationDraft(selectedId(), source(), draft, owner),
      onFocus: (focus, presentation, intent) => navigatePreview(focus, source(), presentation, intent),
      onSource: key => navigatePreview({ kind: "root" }, workspaceSourceFromKey(key)),
      onAllData: () => navigatePreview({ kind: "root" }, { $tag: "AllDataSource" }, undefined, { name: "All data", icon: "list" }),
      onDataTarget: (target, mode, presentation, intent) => {
        const selected = value().lenses.find(lens => lens.id === value().activeLensId);
        if (selected) void navigateDataTarget(selected.id, target, mode, presentation, intent);
      },
      navigationPending: () => pendingNavigation(selectedId()),
      openElsewhere: (scope, place, target) => openElsewhere(target ?? source(), scope, place),
      openElsewhereUnavailable: target => elsewhereUnavailable(target ?? source()),
      onOpenLens: (focus, mode, presentation) => { void addLens(active() ?? undefined, focus, mode, presentation, source()); },
      onPresentation: () => {}, onClose: () => {}, onSubject: () => {}, registerFlush: () => () => {},
    };
    return <LensFrame id="initial-address-preview" merged={bordersMerged()} chromeMode={chromeMode()}
      navigating={!!pendingNavigation(selectedId())}
      navigation={<Show when={pendingNavigation(selectedId())} keyed>{pending => <PendingDestination pending={pending} />}</Show>}
      header={<><div class="workspace-pane__toolbar-mount"
        ref={element => onSettled(() => { setHeaderMount(element); })} />
        <DataInspectionControls mode={previewPane.inspectionMode!()} onModeChange={previewPane.onInspectionMode!}
          shortcuts={previewPane.shortcuts?.()} />
        <LensChromeControls id={selectedId()} />
      </>}
      summary={<div class="workspace-pane__summary-mount" ref={element => onSettled(() => { setSummaryMount(element); })}>
        {/* The same placeholder as a lens: its name and type have a place
            while the addressed data is read. */}
        <div class="workspace-pane__summary-placeholder" aria-hidden="true">
          <span>{previewPane.sourceLabel()}</span><span class="workspace-pane__summary-skeleton" />
        </div>
      </div>}
      corner={<LensChromeControls id={selectedId()} restore />}>
      <Loading fallback={<LensPending id="initial-address-preview" detail={loadingLabel()} />}>
      <Show when={snapshot()} fallback={<LensPending id="initial-address-preview" detail={loadingLabel()} />}>
      {data => <Show when={previewEntry()} keyed>{entry => <HomeEntry
        client={entry.client} publicRoot={publicHome() ? data() : undefined} navigationRoot={allDataHome() ? data() : undefined}
        pane={previewPane} readRuntime={entry.runtime()} readiness={{
          // This provisional owner can prepare/read and retain intent. The
          // resolved pane alone mounts prepared editors, including while its
          // incoming Loading transition still retains this preview.
          request: entry.request, ready: () => false, loading: entry.preparing, stage: entry.stage,
          error: () => entry.error() ?? null, retry: () => { void retryReader(entry.key, entry); },
        }} renderWorkspace={initialAction => <ReaderRuntimeProvider runtime={entry.runtime()!}>
          <HomePage initialAction={initialAction} publicData={entry.runtime()?.publicData} pane={previewPane} />
      </ReaderRuntimeProvider>} />}</Show>}</Show></Loading>
    </LensFrame>;
  }
  return <LocusSynchronizationContext value={synchronization}><WorkspaceRootShelfContext value={rootShelf}><WorkspaceLoadContext value={loadApi}><div class="workspace-surface" inert={returningHome()} ref={element => {
    setSurfaceElement(element);
  }}>
    <Show when={barCollapsed()}><button type="button" class="workspace-corner workspace-corner--bar" aria-label="Show the top bar"
      onClick={() => setBarCollapsed(false)}><IconByName name="chevron-down" size={13} /></button></Show>
    <Show when={!chrome?.setFoldBar}><Show when={topbarMount()} fallback={<button type="button" class="workspace-pane__fold workspace-topbar-fold" aria-label="Hide the top bar"
      onClick={() => setBarCollapsed(true)}><IconByName name="chevron-down" size={15} /></button>}>
      {mount => <Portal mount={mount()}><button type="button" class="workspace-pane__fold workspace-topbar-fold" aria-label="Hide the top bar"
        onClick={() => setBarCollapsed(true)}><IconByName name="chevron-down" size={15} /></button></Portal>}
    </Show></Show>
    <Show when={chrome?.mount()} fallback={<Controls />}>{mount => <Portal mount={mount()}><Controls /></Portal>}</Show>
    <LocusNotifications notices={notices()} onDismiss={dismissNotice} />
    <Show when={!address.initialLoading() && !address.initialFailure() && !hasPendingCreationPicker("initial-address-preview")} fallback={<Show when={address.initialFailure()} fallback={<InitialAddress />}>
      {failure => <LocusLoadFailure message="This data address is unavailable." detail={failure()} retry={address.retry} />}
    </Show>}>
    <div class={["workspace-panes", { "workspace-panes--layered": layerDepth() > 1, "workspace-panes--merged": bordersMerged() }]}
      data-layer-depth={layerDepth()} style={{ '--workspace-columns': gridPlan().columns, '--workspace-rows': gridPlan().rows }}>
      <For each={visible()} keyed={lens => lens.id}>{lens => <LensPanel lens={lens()} />}</For>
    </div>
    <Show when={visible().length === 0}><div class="workspace-empty">
      <p>No data is displayed.</p>
      <button class="btn" onClick={() => { void exploreData(); }}>Explore your data</button>
      <Show when={value().lenses.length > 0}><div class="workspace-empty__saved">
        <span>or open a saved lens</span>
        <LocusSelect value="" label="Open a saved lens" fallbackOption={{ value: "", label: "Choose a lens…" }}
          options={value().lenses.map(lens => ({ value: lens.id, label: title(lens), icon: "panels-top-left" }))}
          onChange={id => { void openSavedLens(id); }} />
      </div></Show>
    </div></Show>
    </Show>
    <Show when={lensMenu()} keyed>{at => <LocusContextMenu x={at.x} y={at.y} label="Lenses" opener={at.opener} onClose={() => setLensMenu(undefined)}
      items={[
        ...([
        ...groupMenuItems(),
        { id: "new-group", label: "New lens group", icon: "plus", separatorBefore: true, onSelect: () => { void addGroup(); } },
        ...value().lenses.map(lens => ({ id: lens.id, label: `${title(lens)} · ${visible().some(shown => shown.id === lens.id) ? "Displayed" : props.store.persistent ? "Saved" : "Closed"}`,
          icon: "panels-top-left", children: [
            { id: `only-${lens.id}`, label: "Show only this lens", onSelect: () => { void (async () => { if (await flushLenses()) await props.store.update([
              { $tag: "SetCurrentLensLayer", ids: [lens.id] },
            ]); })().catch(showFailure); } },
            visible().some(shown => shown.id === lens.id)
              ? { id: `close-${lens.id}`, label: "Close lens", onSelect: () => { void closeLens(lens.id); } }
              : { id: `open-${lens.id}`, label: "Open on top", onSelect: () => { void openSavedLens(lens.id); } },
            { id: `split-${lens.id}`, label: "Open alongside", onSelect: () => { void openSavedLens(lens.id, "split"); } },
          ] })),
        { id: "all-lenses", label: "Show all lenses", icon: "layout-grid", separatorBefore: true,
          onSelect: () => { void props.store.planUpdate(current => [{ $tag: "SetCurrentLensLayer", ids: current.lenses.map(lens => lens.id) }]).catch(showFailure); } },
        { id: "new-lens", label: "New lens", icon: "plus", onSelect: () => { void addLens(); } },
        ] as LocusMenuItem[]).map(item => ({ ...item, disabled: !props.store.prepared() || item.disabled })),
        { id: "lens-settings", label: "Lens settings", icon: "settings", separatorBefore: true,
          disabled: !props.store.prepared(), children: props.store.prepared() ? menuItems() : undefined },
        { id: "synchronization", label: "Automatic synchronization", icon: "repeat", separatorBefore: true,
          checked: synchronization().enabled(), disabled: synchronization().saving() && !synchronization().enabled(),
          onSelect: () => { void synchronization().setEnabled(!synchronization().enabled()); } },
        ...(synchronization().pending() > 0 ? [
          { id: "save-pending", label: "Save pending changes", disabled: synchronization().saving(),
            onSelect: () => { void synchronization().saveAll(); } },
          { id: "discard-pending", label: "Discard pending changes", icon: "x", disabled: synchronization().saving(),
            onSelect: () => { void discardPendingChanges(); } },
        ] : []),
        { id: "hide-topbar", label: "Hide the top bar", icon: "chevron-down", separatorBefore: true,
          onSelect: () => setBarCollapsed(true) },
      ]} />}</Show>
    <Show when={menu()} keyed>{at => <LocusContextMenu x={at.x} y={at.y} items={menuItems()} onClose={() => setMenu(undefined)} />}</Show>
    <Show when={settings()}><Loading fallback={<CardLoadingIndicator label="Opening settings…" />}><WorkspaceSettings value={value()} persistent={props.store.persistent}
      reader={active() ? reader(active()!.source.$tag === "AllDataSource" ? { $tag: "PublicSource" } : active()!.source).runtime() : undefined} onClose={() => setSettings(false)}
      onSave={async (bar, lens) => { if (!await flushLenses()) return;
        const commands: import("./workspace-wire").WorkspaceCommand[] = [{ $tag: "SetWorkspaceBar", bar }];
        if (lens) commands.push({ $tag: "EditWorkspaceLens", id: lens.id, command: { $tag: "SetLensShortcuts", shortcuts: lens.shortcuts } });
        try { if (await props.store.update(commands)) setSettings(false); }
        catch (error) { showFailure(error); }
      }} /></Loading></Show>
  </div></WorkspaceLoadContext></WorkspaceRootShelfContext></LocusSynchronizationContext>;
}
