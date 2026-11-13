import { revalidate, useLocation, useNavigate } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { Dynamic } from "@solidjs/web";
import { Errored, Loading, For, Show, createSignal, createMemo, createEffect, onSettled, untrack, lazy } from "solid-js";
import { accountSelectionPending, accountSwitchError, dismissAccountSwitchError, subject, userProfile, loading, subjectResolutionError, isAuthenticated, refreshSubject, logout, localReturnPath, listAccessibleAccounts } from "~/lib/auth";
import { ApiUnavailableError, waitForApiReady } from "~/lib/api-readiness";
import { IconLogout, IconUser, IconChevronDown } from "~/lib/icons";
import { ConfirmModalHost, ModalOverlay, confirmDialog } from "~/lib/confirm-modal";
import {
  IconLayoutDashboard,
  IconActivity,
  IconRoute,
  IconPlugConnected,
  IconSettings,
  IconBrandTelegram,
  IconStack,
  IconSearch,
  IconEye,
  IconList,
  IconVariable,
} from "~/lib/icons";
import "./app.css";
import "./login.css";
import { TooltipLayer } from "~/lib/tooltip";
import logoSrc from "~/assets/logo.png";
import { LoadingScreen } from "~/lib/loading-screen";
import { createLocusNotificationCenter, LocusLoadFailure, LocusNotificationContext, LocusNotificationHost,
  LocusNotifications, type LocusNotice } from "~/lib/locus-notifications";
import { WorkspaceReadinessContext } from "~/lib/workspace-readiness";
import { preloadWorkspaceModules, preloadWorkspaceSlice, WorkspaceLoadTimeoutError } from "~/lib/workspace-module-preload";
import { apiReadConnectionStatus, getTypes, setApiAccountScope } from "~/lib/api";
import { sessionEpoch } from "~/lib/browser-session";
import {
  ensureUserRegistriesLoaded,
  setUserRegistryAccountScope,
  userRegistriesLoadedFor,
  userFunctions,
  sourceModulesForAccount,
} from "~/lib/user-registries";
import {
  accountFieldRegistryState,
  clearAccountFieldRegistry,
  ensureAccountFieldRegistryLoaded,
  fetchCommittedAccountFieldSnapshot,
  StaleAccountFieldRegistryLoadError,
} from "~/lib/account-field-registry";
import { FieldPresentationRegistryProvider } from "~/lib/field-renderer/field-presentation-context";
import type { FenelType } from "@fenel/engine/types";
import { WorkspaceChromeContext } from "~/lib/workspace-chrome";
import { loadProjectedWorkspaceRegistry } from "~/lib/workspace-model-loader";
import type { WorkspaceBar } from "~/lib/workspace-model";

const WorkspaceAuthoringProvider = lazy(() => import("~/lib/workspace-authoring-provider"));
// Both forms read repository auth types only. The projected system model is
// already prepared for lenses, so they never wait for the complete seed session.
const UserProfileContent = lazy(async () => {
  const [registry, content] = await Promise.all([loadProjectedWorkspaceRegistry(), import("~/lib/user-profile")]);
  const Content = content.default;
  return { default: (props: { profile: import("~/lib/auth").UserProfile }) => <Content profile={props.profile} registry={registry} /> };
});
const LoginDialogContent = lazy(async () => {
  const [registry, content] = await Promise.all([loadProjectedWorkspaceRegistry(), import("~/lib/login-dialog")]);
  const Content = content.default;
  return { default: (props: { onSignedIn: () => void; onClose: () => void }) =>
    <Content onSignedIn={props.onSignedIn} onClose={props.onClose} registry={registry} /> };
});

// The sidebar lists the launch surfaces only. The Commerce and Surfaces
// pages, the developer pages and the old about page are NOT listed, but their
// routes stay reachable by URL: they are demo sources (GOPUBLIC.md, GP-31).
const navGroups = [
  {
    label: null as string | null,
    items: [
      { href: "/app", label: "Home", Icon: IconStack },
      { href: "/app/overview", label: "Overview", Icon: IconLayoutDashboard },
    ],
  },
  {
    label: "Core",
    items: [
      { href: "/app/data", label: "Data", Icon: IconSearch },
      { href: "/app/types", label: "Types", Icon: IconStack },
      { href: "/app/functions", label: "Functions", Icon: IconRoute },
      { href: "/app/modules", label: "Source modules", Icon: IconRoute },
      { href: "/app/values", label: "Data playground", Icon: IconVariable },
      { href: "/app/instances", label: "Instances", Icon: IconList },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/app/query", label: "Query Explorer", Icon: IconSearch },
      { href: "/app/events", label: "Events", Icon: IconActivity },
      { href: "/app/views", label: "Lenses", Icon: IconEye },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/app/integrations", label: "Integrations", Icon: IconPlugConnected },
      { href: "/app/account", label: "Account", Icon: IconSettings },
    ],
  },
];

/** Pages reachable by URL but kept out of the sidebar. Only their topbar
 *  titles are listed here. */
const unlistedPageTitles: Readonly<Record<string, string>> = {
  "/app/types/entity:profile": "Profiles",
  "/app/types/entity:item": "Items",
  "/app/types/entity:plan": "Plans",
  "/app/types/entity:purchase": "Purchases",
  "/app/types/entity:inventory": "Inventory",
  "/app/types/entity:email_template": "Email Templates",
  "/app/types/entity:page": "Pages",
  "/app/types/entity:proxy_link": "Proxy Links",
  "/app/services": "Services",
  "/app/tests": "Tests",
  "/app/ui-showcase": "UI Showcase",
  "/app/engine-showcase": "Engine Showcase",
  "/app/audit": "Audit",
  "/app/about": "About",
};

// Strip routing prefixes from a type/entity id and title-case the first
// letter — gives the topbar a presentable name without an engine lookup.
function prettifyId(raw: string): string {
  // After the fn: prefix removal, function ids are `<module>:<name>`.
  // Strip the module segment so the topbar shows just the codeName.
  const stripped = raw
    .replace(/^entity:/, "")
    .replace(/^format:/, "")
    .replace(/^[^:]+:/, "");
  return stripped.length > 0
    ? stripped[0]!.toUpperCase() + stripped.slice(1)
    : stripped;
}

function deriveTitleFromPath(path: string): string | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href === path) return item.label;
    }
  }
  const unlisted = unlistedPageTitles[path];
  if (unlisted) return unlisted;
  // Drill-in: type detail, with optional record id.
  const typeRecord = path.match(/^\/app\/types\/([^/]+)\/(.+)$/);
  if (typeRecord) {
    const kind = prettifyId(decodeURIComponent(typeRecord[1]!));
    const id = decodeURIComponent(typeRecord[2]!);
    const idShort = id.length > 8 ? `${id.slice(0, 8)}…` : id;
    return `${kind} · ${idShort}`;
  }
  const typeMatch = path.match(/^\/app\/types\/([^/]+)\/?$/);
  if (typeMatch) return prettifyId(decodeURIComponent(typeMatch[1]!));
  // Drill-in: function detail (and instance routes under it).
  const fnInst = path.match(/^\/app\/functions\/([^/]+)\/instances\/([^/]+)/);
  if (fnInst) {
    const id = decodeURIComponent(fnInst[2]!);
    return `${decodeURIComponent(fnInst[1]!)} · ${id.length > 8 ? `${id.slice(0, 8)}…` : id}`;
  }
  const fnMatch = path.match(/^\/app\/functions\/([^/]+)/);
  if (fnMatch) return decodeURIComponent(fnMatch[1]!);
  // Best effort: last path segment.
  const last = path.split("/").filter(Boolean).pop();
  return last ? prettifyId(last) : null;
}

export default function DashboardLayout(props: RouteSectionProps & { publicHome?: boolean }) {
  const notifications = createLocusNotificationCenter();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [profileOpen, setProfileOpen] = createSignal(false);
  const [loginOpen, setLoginOpen] = createSignal(false);
  const [loginNext, setLoginNext] = createSignal<string>();
  const [workspaceBar, setWorkspaceBar] = createSignal<WorkspaceBar>();
  const [workspaceMount, setWorkspaceMount] = createSignal<HTMLElement>();
  const [topbarElement, setTopbarElement] = createSignal<HTMLElement>();
  const [foldWorkspaceBar, setFoldWorkspaceBar] = createSignal<(() => void)>();
  const [sessionAttempt, setSessionAttempt] = createSignal(0);
  const [sessionStage, setSessionStage] = createSignal("Connecting to the server…");
  const [sessionProgress, setSessionProgress] = createSignal<0 | 1>(0);
  const [startupSessionError, setSessionError] = createSignal<string>();
  const sessionError = () => startupSessionError() ?? subjectResolutionError();
  let prepareWorkspaceLeave: (() => Promise<boolean>) | undefined;
  let returnWorkspaceHome: (() => Promise<boolean>) | undefined;
  let workspaceBarOwner: symbol | undefined;
  let workspaceFoldOwner: symbol | undefined;
  let workspaceLeaveOwner: symbol | undefined;
  let workspaceHomeOwner: symbol | undefined;
  let profileButton: HTMLButtonElement | undefined;
  let loginButton: HTMLButtonElement | undefined;
  const [sessionControl, setSessionControl] = createSignal<HTMLSpanElement>();
  function closeLogin() {
    setLoginOpen(false);
    loginButton?.focus();
  }
  function signedIn() {
    const next = loginNext();
    closeLogin();
    if (next && next !== location.pathname + location.search) navigate(next, { replace: true });
  }
  function closeProfile() {
    setProfileOpen(false);
    profileButton?.focus();
  }
  const [registryLoadError, setRegistryLoadError] = createSignal<string | null>(null);
  // A passed deadline says what failed and what to do in its own words, so the
  // notice leads with it instead of hiding it in the detail.
  const [registryLoadTimedOut, setRegistryLoadTimedOut] = createSignal(false);
  const [workspaceStage, setWorkspaceStage] = createSignal<string | null>(null);
  const [readyAccount, setReadyAccount] = createSignal<{ accountId: string; epoch: number }>();
  const [startupAttempt, setStartupAttempt] = createSignal(0);
  const [workspaceRequest, setWorkspaceRequest] = createSignal<{ accountId: string; epoch: number }>();
  const [dismissedStartupNotices, setDismissedStartupNotices] = createSignal<readonly string[]>([]);
  let startupScope: { accountId: string | undefined; epoch: number } | undefined;

  const isFunctionEditor = createMemo(() =>
    /^\/app\/functions\/.+/.test(location.pathname),
  );
  const isHomeSurface = createMemo(() =>
    props.publicHome === true || location.pathname === "/app" || location.pathname === "/app/",
  );
  const isLocusSurface = createMemo(() => isHomeSurface() || location.pathname === "/app/home");

  // The browser owns intrinsic text geometry. Keep one mounted action while
  // its labels crossfade, and animate the measured frame rather than auto width.
  createEffect(() => {
    if (isHomeSurface() && !foldWorkspaceBar()) return;
    if (isAuthenticated() && subject()?.$tag !== "User") return;
    return sessionControl();
  }, frame => {
    const content = frame?.firstElementChild;
    if (!frame?.isConnected || !(content instanceof HTMLElement)) return;
    const measure = () => { frame.style.width = `${content.getBoundingClientRect().width + 2}px`; };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  });

  const pageTitle = createMemo(() => deriveTitleFromPath(location.pathname));
  const [profileAccount, setProfileAccount] = createSignal<{ id: string; name: string }>();
  // An optional header label must not join the sign-in transition's async
  // dependencies. The data surface can start while this metadata arrives.
  createEffect(() => {
    const current = subject();
    return current?.$tag === "User" ? { id: current.accountId, epoch: sessionEpoch() } : undefined;
  }, scope => {
    setProfileAccount(undefined);
    if (!scope) return;
    let active = true;
    void listAccessibleAccounts().then(accounts => {
      if (!active || scope.epoch !== sessionEpoch()) return;
      const account = accounts.find(account => account.accountId === scope.id);
      if (account) setProfileAccount({ id: scope.id, name: account.name || account.slug });
    }).catch(() => {});
    return () => { active = false; };
  });
  const profileLabel = createMemo(() => {
    const profile = userProfile();
    const current = subject();
    const account = current?.$tag === "User" && profileAccount()?.id === current.accountId ? profileAccount() : undefined;
    const name = profile?.name.$tag === "Just" && profile.name._0.trim() || profile?.email.split("@")[0];
    const accountName = account?.name;
    return accountName ? name && name !== accountName ? `${name} · ${accountName}` : accountName : name || "Your account";
  });
  const [signInToast, setSignInToast] = createSignal(false);
  createEffect(() => {
    const current = subject();
    return current?.$tag === "User" ? current.userId : null;
  }, (userId, previous) => {
    const arrived = userId !== null && previous !== undefined && userId !== previous;
    setSignInToast(arrived);
    if (!arrived) return;
    const timer = window.setTimeout(() => setSignInToast(false), 5000);
    return () => window.clearTimeout(timer);
  });

  // Resolve the current session before offering sign-in. Protected links ask
  // Home to open its dialog and preserve the original destination.
  createEffect(sessionAttempt, () => {
    if (untrack(subject) !== null || !untrack(isHomeSurface)) return;
    const check = new AbortController();
    setSessionError(undefined);
    setSessionProgress(0);
    void waitForApiReady({ signal: check.signal, onStatus: status => {
      setSessionProgress(status === "ready" ? 1 : 0);
      setSessionStage(status === "loading" ? "Waiting for the server to start…"
        : status === "ready" ? "Checking your sign-in…" : "Connecting to the server…");
    } })
      .then(() => refreshSubject({ signal: check.signal }))
      .catch((error: unknown) => {
        if (check.signal.aborted) return;
        setSessionError(error instanceof Error ? error.message : String(error));
      });
    return () => check.abort();
  });
  createEffect(topbarElement, element => {
    if (!element) return;
    const measure = () => element.parentElement?.style.setProperty("--workspace-bar-height", `${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  });
  createEffect(
    () => ({
      loading: loading(),
      resolved: subject() !== null,
      authenticated: isAuthenticated(),
      publicHome: isHomeSurface(),
      target: location.pathname + location.search,
    }),
    ({ loading: isLoading, resolved, authenticated, publicHome, target }) => {
      if (!publicHome && (!resolved || !isLoading && !authenticated)) {
        navigate("/", { replace: true, state: { signIn: true, next: target } });
      }
    },
  );
  createEffect(
    () => ({ request: location.state as { signIn?: boolean; next?: unknown } | undefined,
      pending: loading() || subject() === null, authenticated: isAuthenticated(),
      target: location.pathname + location.search }),
    ({ request, pending, authenticated, target }) => {
      if (!request?.signIn || pending) return;
      const next = localReturnPath(request.next ?? "/");
      if (authenticated) {
        navigate(next, { replace: true, state: {} });
      } else {
        navigate(target, { replace: true, state: {} });
        setLoginNext(next);
        setLoginOpen(true);
      }
    },
  );

  const authenticatedAccountId = createMemo(() => {
    const current = subject();
    return current?.$tag === "User" || current?.$tag === "Bot"
      ? current.accountId
      : undefined;
  });
  const readyFieldRegistry = createMemo(() => {
    const accountId = authenticatedAccountId();
    const ready = readyAccount();
    if (ready?.accountId !== accountId || ready?.epoch !== sessionEpoch()) return undefined;
    const current = accountFieldRegistryState();
    return accountId && current?.accountId === accountId ? current.registry : undefined;
  });

  const needsWorkspace = createMemo(() => {
    const requested = workspaceRequest();
    return !isHomeSurface() || (requested?.accountId === authenticatedAccountId()
      && requested?.epoch === sessionEpoch());
  });

  function requestWorkspace() {
    const accountId = authenticatedAccountId();
    const epoch = sessionEpoch();
    const current = workspaceRequest();
    if (accountId && (current?.accountId !== accountId || current.epoch !== epoch)) setWorkspaceRequest({ accountId, epoch });
  }

  // Finish the account roster, type catalog and committed snapshot reads before starting the
  // synchronous registry build. Building while those requests are in flight
  // can block delivery of their completed responses until their deadlines.
  // Mount account-bound routes only after all startup phases have completed.
  createEffect(
    () => ({ accountId: authenticatedAccountId(), epoch: sessionEpoch(), attempt: startupAttempt(), requested: needsWorkspace(),
      sources: sourceModulesForAccount(authenticatedAccountId() ?? "") }),
    ({ accountId, epoch, requested }) => untrack(() => {
      setApiAccountScope(accountId);
      // Revoke immediately, including a new session for the same account.
      // Delaying revocation until the build would let an older in-flight
      // snapshot publish while this session is fetching its initial roster.
      // A retry within the same session can reuse a successfully loaded phase.
      const sessionChanged = startupScope !== undefined
        && (startupScope.accountId !== accountId || startupScope.epoch !== epoch);
      const currentRegistry = accountFieldRegistryState();
      if (!accountId || sessionChanged || (currentRegistry && currentRegistry.accountId !== accountId)) {
        clearAccountFieldRegistry();
      }
      if (sessionChanged) setUserRegistryAccountScope(undefined);
      setUserRegistryAccountScope(accountId);
      startupScope = { accountId, epoch };
      setReadyAccount(undefined);
      setRegistryLoadError(null);
      setRegistryLoadTimedOut(false);
      setWorkspaceStage(null);
      if (!accountId || !requested) return;

      let active = true;
      const isCurrent = () => active
        && authenticatedAccountId() === accountId
        && sessionEpoch() === epoch;

      void (async () => {
        try {
          setWorkspaceStage("Loading editing tools…");
          await preloadWorkspaceModules(isCurrent);
          if (!isCurrent()) return;
          // Load editor code before issuing its reads: module initialization
          // can otherwise hold completed responses past their deadlines.
          const { registerCatalogEntities } = await preloadWorkspaceSlice("barrel", () => import("@fenel/engine"));
          if (!isCurrent()) return;
          await preloadWorkspaceSlice("dashboard cards", () => import("~/lib/dashboard-cards"));
          if (!isCurrent()) return;
          if (isHomeSurface()) await preloadWorkspaceSlice("Home", () => import("./app/home"));
          if (!isCurrent()) return;
          await preloadWorkspaceSlice("authoring provider", () => import("~/lib/workspace-authoring-provider"));
          if (!isCurrent()) return;
          // The reads below decode through this codec (getTypes imports
          // ~/lib/authoring-json, which re-exports the engine's); loading both
          // here keeps their own imports cache hits, so every wait in this
          // chain is bounded: code chunks by the preload limit, API reads by
          // apiRead's readiness deadlines. A passed deadline lands in
          // registryLoadError (with Retry).
          await preloadWorkspaceSlice("definition codec", () => Promise.all([
            import("@fenel/engine/authoring/expression"),
            import("~/lib/authoring-json"),
          ]));
          if (!isCurrent()) return;
          setWorkspaceStage("Loading data…");
          const [, resp, snapshot] = await Promise.all([
            ensureUserRegistriesLoaded(accountId),
            getTypes() as Promise<{
              types?: Array<{ name: string; type?: FenelType; module?: string }>;
            }>,
            fetchCommittedAccountFieldSnapshot(accountId),
          ]);
          if (!isCurrent()) return;
          if (!userRegistriesLoadedFor(accountId)) {
            throw new Error("Could not load all your types, functions, and source modules. Please retry.");
          }
          // Include API-defined module ADTs in the editor catalog. Preserve
          // module qualification so equal bare names remain distinguishable.
          const entities = (resp.types ?? [])
            .filter((t) => t.type !== undefined)
            .map((t) => ({ id: t.name, type: t.type as FenelType, module: t.module }));
          if (entities.length > 0) registerCatalogEntities(entities);
          setWorkspaceStage("Preparing your data and editing tools…");
          // The account registry builder imports these on first use; load them
          // bounded here so its own imports are cache hits.
          await preloadWorkspaceSlice("account registry builder", () => Promise.all([
            import("@fenel/engine/account-field-registry"),
            import("@fenel/engine/module-manifest"),
            import("@fenel/engine/system-entities"),
          ]));
          if (!isCurrent()) return;
          const registry = await ensureAccountFieldRegistryLoaded(accountId, { load: async () => snapshot });
          if (!isCurrent()) return;
          setWorkspaceStage("Preparing function suggestions…");
          const { accountAuthoringSession, prepareCommittedAuthoringSession } = await preloadWorkspaceSlice(
            "function suggestions", () => import("~/lib/expression-runner/authoring-session"));
          await prepareCommittedAuthoringSession(registry, accountId, snapshot, entities);
          if (!isCurrent()) return;
          accountAuthoringSession({ accountId, functions: userFunctions() });
          if (isCurrent()) { setReadyAccount({ accountId, epoch }); setWorkspaceStage(null); }
        } catch (error) {
          if (error instanceof StaleAccountFieldRegistryLoadError || !isCurrent()) return;
          setRegistryLoadError(error instanceof Error ? error.message : String(error));
          setRegistryLoadTimedOut(error instanceof ApiUnavailableError || error instanceof WorkspaceLoadTimeoutError);
          setWorkspaceStage(null);
        }
      })();
      return () => { active = false; };
    }),
  );

  function retryWorkspaceLoad() {
    revalidate(getTypes.keyFor());
    setDismissedStartupNotices([]);
    setStartupAttempt((attempt) => attempt + 1);
  }

  const startupNotices = createMemo<LocusNotice[]>(() => {
    const notices: LocusNotice[] = [];
    if (accountSwitchError()) notices.push({ id: "account-switch", tone: "error", message: accountSwitchError()! });
    if (accountSelectionPending()) notices.push({ id: "account-selection", tone: "info",
      message: loading() ? "Changing account data…" : "Saving before changing accounts…" });
    const connection = apiReadConnectionStatus();
    if (connection) notices.push({ id: "connection", tone: "info",
      message: connection === "loading" ? "The server is starting…" : "Connecting to the server…" });
    else if (registryLoadError()) notices.push({ id: "editing-load", tone: "error",
      message: registryLoadTimedOut() ? `Could not load the editing tools. ${registryLoadError()!}` : "Could not load the editing tools.",
      detail: registryLoadTimedOut() ? undefined : registryLoadError()!, retry: { label: "Retry", run: retryWorkspaceLoad } });
    return notices.filter((notice) => !dismissedStartupNotices().includes(notice.id));
  });
  createEffect(() => ({ epoch: sessionEpoch(), error: registryLoadError(), connection: apiReadConnectionStatus(), accountSelection: accountSelectionPending() }),
    () => { setDismissedStartupNotices([]); });

  async function handleLogout() {
    if (!await confirmDialog({ message: "Log out?", detail: "You can continue browsing public Fenel data after logging out.", confirmLabel: "Log out" })) return;
    if (prepareWorkspaceLeave && !await prepareWorkspaceLeave()) return;
    await logout();
    navigate("/", { replace: true });
  }

  function handleHome(event: MouseEvent) {
    setSidebarOpen(false);
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (returnWorkspaceHome && isHomeSurface()) {
      event.preventDefault();
      void returnWorkspaceHome();
    }
  }

  return (
    <WorkspaceChromeContext value={{ mount: workspaceMount, setBar: (bar, owner) => {
      if (bar !== undefined) {
        workspaceBarOwner = owner;
        setWorkspaceBar(bar);
        return;
      }
      // Teardown runs while Solid reconciles an owned subtree. Retire its
      // projection at the host boundary, without clearing a replacement's bar.
      queueMicrotask(() => {
        if (workspaceBarOwner !== owner) return;
        workspaceBarOwner = undefined;
        setWorkspaceBar(undefined);
      });
    }, setFoldBar: (fold, owner) => {
      if (fold) {
        workspaceFoldOwner = owner;
        setFoldWorkspaceBar(() => fold);
      } else {
        queueMicrotask(() => {
          if (workspaceFoldOwner !== owner) return;
          workspaceFoldOwner = undefined;
          setFoldWorkspaceBar(undefined);
        });
      }
    }, setBeforeLeave: (prepare, owner) => {
      if (prepare !== undefined) {
        workspaceLeaveOwner = owner;
        prepareWorkspaceLeave = prepare;
      } else if (workspaceLeaveOwner === owner) {
        workspaceLeaveOwner = undefined;
        prepareWorkspaceLeave = undefined;
      }
    }, home: () => returnWorkspaceHome?.(), setHome: (home, owner) => {
      if (home !== undefined) {
        workspaceHomeOwner = owner;
        returnWorkspaceHome = home;
      } else if (workspaceHomeOwner === owner) {
        workspaceHomeOwner = undefined;
        returnWorkspaceHome = undefined;
      }
    } }}>
    <LocusNotificationContext value={notifications}>
      <LocusNotifications notices={startupNotices()}
        onDismiss={(id) => {
          if (id === "account-switch") dismissAccountSwitchError();
          else setDismissedStartupNotices((prior) => [...prior, id]);
        }} />
      <Title>Fenel</Title>
      {/* The app's own tooltip, in place of the browser's. One layer for every
          `data-tooltip` on the page — see `lib/tooltip.tsx`. */}
      <TooltipLayer />
      <div class="locus-session-toast" role="status" aria-live="polite" aria-atomic="true">
        <Show when={signInToast()}><span class="locus-session-toast__message">Logged in as {profileLabel()}</span></Show>
      </div>
      <Show
        when={isHomeSurface() || !loading() && isAuthenticated()}
        fallback={<LoadingScreen inline stage={sessionProgress()} detail={sessionStage()} />}
      >
      <div class={["dashboard", "fenel-page-enter", { "dashboard--collapsed": isFunctionEditor(), "dashboard--home": isLocusSurface() }]}
        data-workspace={isHomeSurface() ? "true" : undefined}
        data-bar-mode={workspaceBar()?.mode.$tag ?? "DockedBar"}
        data-bar-position={workspaceBar()?.position.$tag ?? "BarTop"}>
        <header class="topbar" ref={element => { setTopbarElement(element); }}>
          <a href="/" class="topbar__brand" aria-label="Fenel home" data-home-navigation="true" onClick={handleHome}>
            <img src={logoSrc} alt="Fenel" class="topbar__logo" width="160" height="54" />
          </a>
          <Show when={pageTitle()}>
            <span class="topbar__title">{pageTitle()}</span>
          </Show>
          <Show when={isHomeSurface()}><div class="topbar__workspace" ref={element => onSettled(() => { setWorkspaceMount(element); })} /></Show>
          <Show when={!isHomeSurface() || foldWorkspaceBar()}><div class="topbar__actions">
          <LocusNotificationHost />
          <Show when={!isAuthenticated() || subject()?.$tag === "User"} fallback={
            <button type="button" class="locus-session-action locus-session-action--logout" aria-label="Log out"
              onClick={handleLogout}><IconLogout size={15} /></button>
          }>
            <span class="locus-session-control" ref={element => { setSessionControl(element); }}
              data-authenticated={isAuthenticated() ? "true" : "false"}>
              <span class="locus-session-group">
                <button type="button" class={["locus-session-action locus-session-action--profile", { "locus-login": !isAuthenticated() }]}
                  ref={element => { loginButton = element; profileButton = element; }}
                  aria-label={isAuthenticated() ? `Account: ${profileLabel()}` : "Log in"}
                  disabled={!isAuthenticated() && (loading() || subject() === null)} aria-haspopup="dialog"
                  aria-expanded={(isAuthenticated() ? profileOpen() : loginOpen()) ? "true" : "false"}
                  data-tooltip={isAuthenticated() ? userProfile()?.email ?? "Your profile" : loading() ? "Log in\nLoading sign-in status…" : subject() === null
                    ? sessionError() ? "Log in\nCould not check your sign-in. Retry the sign-in check." : "Log in\nWaiting to check your sign-in…"
                    : undefined}
                  onClick={() => {
                    if (isAuthenticated()) setProfileOpen(true);
                    else { setLoginNext(undefined); setLoginOpen(true); }
                  }}>
                  <IconUser size={15} />
                  <span class="locus-session-action__labels">
                    <span class="locus-session-action__login" aria-hidden={isAuthenticated() ? "true" : "false"}>Log in</span>
                    <span class="locus-session-action__name" aria-hidden={isAuthenticated() ? "false" : "true"}>{profileLabel()}</span>
                  </span>
                </button>
                <Show when={isAuthenticated()}>
                  <button type="button" class="locus-session-action locus-session-action--logout" aria-label="Log out"
                    onClick={handleLogout}><IconLogout size={15} /></button>
                </Show>
              </span>
            </span>
          </Show>
          </div></Show>
          <Show when={isHomeSurface() && foldWorkspaceBar()}><button type="button" class="workspace-pane__fold workspace-topbar-fold"
            aria-label="Hide the top bar" disabled={!foldWorkspaceBar()}
            onClick={() => foldWorkspaceBar()?.()}><IconChevronDown size={15} /></button></Show>
        </header>

        {/* Backdrop */}
        <Show when={sidebarOpen() && isAuthenticated()}>
          <div class="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        </Show>

        <Show when={isAuthenticated()}><aside
          class={`sidebar ${
            sidebarOpen()
              ? "sidebar--overlay"
              : isFunctionEditor() || isLocusSurface()
                ? "sidebar--hidden"
                : ""
          }`}
        >
          <a href="/" class="sidebar-logo" aria-label="Fenel home" data-home-navigation="true" onClick={handleHome}>
            <img src={logoSrc} alt="Fenel" width="160" height="54" />
          </a>
          <nav class="sidebar-nav">
            <For each={navGroups}>
              {(group) => (
                <>
                  <Show when={group.label}>
                    <div class="sidebar-group-label">{group.label}</div>
                  </Show>
                  <For each={group.items}>
                    {(item) => (
                      <a
                        href={item.href}
                        class="sidebar-link"
                        aria-current={location.pathname === item.href ? "page" : undefined}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Dynamic component={item.Icon} size={18} />
                        <span>{item.label}</span>
                      </a>
                    )}
                  </For>
                </>
              )}
            </For>
          </nav>
          <div class="sidebar-footer">
            <a
              href="https://t.me/fenelbot"
              target="_blank"
              rel="noopener"
              class="sidebar-link sidebar-bot-link"
            >
              <IconBrandTelegram size={18} />
              <span>Telegram Bot</span>
            </a>
            <button
              type="button"
              class="sidebar-link sidebar-logout-btn"
              onClick={handleLogout}
            >
              <IconLogout size={18} />
              <span>Sign out</span>
            </button>
          </div>
        </aside></Show>
        <main inert={accountSelectionPending()} class={`main-content ${isFunctionEditor() ? "main-content--full" : ""} ${isLocusSurface() ? "main-content--home" : ""}`}>
          <Errored
            fallback={(err) => (
              <LocusLoadFailure
                message="Could not load this data."
                detail={(err() as Error | undefined)?.message ?? String(err())}
                retry={() => window.location.reload()}
                retryLabel="Reload page"
              />
            )}
          >
            <Loading fallback={<LoadingScreen inline={isLocusSurface()} />}>
              <WorkspaceReadinessContext value={{
                request: requestWorkspace,
                ready: () => readyFieldRegistry() !== undefined,
                loading: () => workspaceStage() !== null,
                stage: workspaceStage,
                error: registryLoadError,
                retry: retryWorkspaceLoad,
                startup: { stage: sessionStage, error: sessionError,
                  retry: () => setSessionAttempt(value => value + 1) },
              }}>
              <FieldPresentationRegistryProvider registry={readyFieldRegistry()}>
              <Show
                when={isHomeSurface() || readyFieldRegistry()}
                fallback={
                  <Show when={!registryLoadError()}><LoadingScreen /></Show>
                }
              >
                <Show when={!isHomeSurface()} fallback={props.children}>
                  <Loading fallback={null}><WorkspaceAuthoringProvider>{props.children}</WorkspaceAuthoringProvider></Loading>
                </Show>
              </Show>
              </FieldPresentationRegistryProvider>
              </WorkspaceReadinessContext>
            </Loading>
          </Errored>
        </main>
      </div>
      </Show>
      <Show when={loginOpen()}>
        <ModalOverlay class="confirm-modal__overlay" onClick={event => { if (event.target === event.currentTarget) closeLogin(); }}
          onKeyDown={event => { if (event.key === "Escape") closeLogin(); }}>
            <Errored fallback={() => <div class="confirm-modal__box login-card" role="dialog" aria-modal="true" aria-label="Sign in to Fenel">
              <p role="alert">Could not display the sign-in form. Close it and try again.</p>
              <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel" onClick={closeLogin}>Close</button></div>}>
              <Loading fallback={<div class="login-preparation" role="dialog" aria-modal="true" aria-label="Sign in to Fenel">
                <LoadingScreen inline stage={1} title="Sign in to Fenel" detail="Loading sign-in form…"
                  actions={<button type="button" class="confirm-modal__btn confirm-modal__btn--cancel"
                    onClick={closeLogin} ref={element => requestAnimationFrame(() => element.focus())}>Cancel</button>} />
              </div>}>
                <div class="confirm-modal__box login-card" role="dialog" aria-modal="true" aria-label="Sign in to Fenel">
                  <h2 class="confirm-modal__message">Sign in to Fenel</h2>
                <LoginDialogContent onSignedIn={signedIn} onClose={closeLogin} />
                </div>
              </Loading>
            </Errored>
        </ModalOverlay>
      </Show>
      <Show when={profileOpen() && isAuthenticated()}>
        <ModalOverlay class="confirm-modal__overlay" onClick={(event) => { if (event.target === event.currentTarget) closeProfile(); }}
          onKeyDown={(event) => { if (event.key === "Escape") closeProfile(); }}>
          <div class="confirm-modal__box" role="dialog" aria-modal="true" aria-label="Your profile">
            <h2 class="confirm-modal__message">Your profile</h2>
            <Errored fallback={() => <p role="alert">Could not display your profile. Close it and try again.</p>}>
              <Loading fallback={<p role="status">Loading your profile…</p>}>
                <Show when={userProfile()} fallback={<p>Your profile is unavailable. Please sign in again.</p>}>
                  {(profile) => <UserProfileContent profile={profile()} />}
                </Show>
              </Loading>
            </Errored>
            <div class="confirm-modal__actions">
              <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel" onClick={() => { closeProfile(); void handleLogout(); }}>Log out</button>
              <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel" onClick={closeProfile}
                ref={(el) => requestAnimationFrame(() => el.focus())}>Close</button>
            </div>
          </div>
        </ModalOverlay>
      </Show>
      <ConfirmModalHost />
    </LocusNotificationContext>
    </WorkspaceChromeContext>
  );
}
