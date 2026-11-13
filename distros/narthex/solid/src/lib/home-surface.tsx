import { Errored, Loading, Show, createEffect, createMemo, createSignal, lazy, onSettled, untrack } from "solid-js";
import { sessionEpoch } from "./browser-session";
import { loadWorkspaceBootstrap, loading, subject } from "./auth";
import type { PreparedWorkspaceSurface } from "./workspace-surface";
import { PendingLensFrame } from "./loading-screen";
import { preloadWorkspaceSlice } from "./workspace-module-preload";
import { LocusLoadFailure, LocusNotifications } from "./locus-notifications";
import { localTransfersPending } from "./data-transfer/queue";
import "./home-entry.css";
import "./workspace-surface.css";

const WorkspaceSurface = lazy(async () => {
  return preloadWorkspaceSlice("your data", () => import("./workspace-surface"));
});

/** Account-owned panes retire with their session. The initial public lenses
 * stay visible while the first authenticated replacement is prepared. */
export default function HomeSurface() {
  // The checked repository snapshot needs no session or API response. Private
  // preferences still start only after the cookie resolves to an account.
  onSettled(() => { void WorkspaceSurface.preload().catch(() => {}); });
  let accountLifetimeStarted = false;
  const [handoffHold, setHandoffHold] = createSignal<(() => boolean)>();
  let handoffOwner: symbol | undefined;
  const reportHandoffHold = (hold: (() => boolean) | undefined, owner: symbol) => {
    if (hold) { handoffOwner = owner; setHandoffHold(() => hold); }
    else if (handoffOwner === owner) { handoffOwner = undefined; setHandoffHold(undefined); }
  };
  createEffect(() => subject()?.$tag === "User" || subject()?.$tag === "Bot", available => {
    if (available) accountLifetimeStarted = true;
  });
  const surfaceEpoch = createMemo(() => {
    const epoch = sessionEpoch();
    return accountLifetimeStarted ? epoch : 0;
  });
  return <Show when={surfaceEpoch() + 1} keyed>{(_epoch) =>
    <SessionWorkspace onAccountSurface={() => { accountLifetimeStarted = true; }} handoffHold={handoffHold()}
      onHandoffHold={reportHandoffHold} />}</Show>;
}

function SessionWorkspace(props: { onAccountSurface: () => void;
  handoffHold?: () => boolean; onHandoffHold: (hold: (() => boolean) | undefined, owner: symbol) => void }) {
  const [privateMounted, setPrivateMounted] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  createEffect(() => !loading() && subject()?.$tag === "User", ready => {
    if (ready) setPrivateMounted(true);
  });
  const accountId = createMemo(() => {
    const current = subject();
    return current?.$tag === "User" && (!loading() || privateMounted()) ? current.accountId : undefined;
  });
  const [prepared, setPrepared] = createSignal<PreparedWorkspaceSurface>();
  const [candidate, setCandidate] = createSignal<PreparedWorkspaceSurface>();
  const [bootstrapError, setBootstrapError] = createSignal<string>();
  createEffect(() => ({ account: accountId(), epoch: sessionEpoch(), attempt: attempt() }), ({ account, epoch }) => {
    if (!account) return;
    const controller = new AbortController();
    let active = true;
    let acquired: PreparedWorkspaceSurface | undefined;
    setBootstrapError(undefined);
    void untrack(() => loadWorkspaceBootstrap(account, { epoch, signal: controller.signal })).then(async bootstrap => {
      const surface = await preloadWorkspaceSlice("your data", () => import("./workspace-surface"));
      if (!active) throw new Error("These lenses were closed.");
      const ready = await surface.acquireWorkspaceSurface(bootstrap, { accountId: account, epoch, signal: controller.signal });
      acquired = ready;
      if (!active) { ready.dispose(); throw new Error("These lenses were closed."); }
      setCandidate(ready);
    }).catch(error => {
      if (active) setBootstrapError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; controller.abort(); acquired?.dispose(); };
  });
  createEffect(() => ({ ready: candidate(), held: localTransfersPending() || !!props.handoffHold?.(),
    epoch: sessionEpoch(), account: accountId() }), ({ ready, held, epoch, account }) => {
    if (!ready || held || ready.epoch !== epoch || ready.accountId !== account) return;
    props.onAccountSurface();
    setPrepared(ready);
  });
  return <>
    <LocusNotifications notices={bootstrapError() ? [{ id: "account-lenses", tone: "error",
      message: "Could not load your saved lenses.", detail: bootstrapError(),
      retry: { label: "Retry", run: () => setAttempt(value => value + 1) } }] : []}
      onDismiss={() => setBootstrapError(undefined)} />
    {/* Account acquisition updates this settled projection at the host
        boundary. It cannot suspend a lens that is already showing Local or
        public data, and every prepared reader still belongs to its new epoch. */}
    <ResolvedWorkspace readyWorkspace={prepared()} publicOnly={!prepared()}
      onHandoffHold={props.onHandoffHold} />
  </>;
}

function ResolvedWorkspace(props: { publicOnly?: boolean; readyWorkspace?: PreparedWorkspaceSurface;
  onHandoffHold?: (hold: (() => boolean) | undefined, owner: symbol) => void } = {}) {
  return <Errored fallback={(error, reset) => <LocusLoadFailure message="Could not load this data."
    detail={String((error() as Error)?.message ?? error())} retry={reset} />}>
    <Loading fallback={<PendingLensFrame />}>
      <WorkspaceSurface readyWorkspace={props.readyWorkspace} publicOnly={props.publicOnly} addressedHome
        onHandoffHold={props.onHandoffHold} />
    </Loading>
  </Errored>;
}
