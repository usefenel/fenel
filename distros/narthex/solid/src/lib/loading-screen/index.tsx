// ---------------------------------------------------------------------------
// LoadingScreen — shared startup status and route fallback.
//
// One component used wherever the dashboard waits on data: route-level
// Loading fallback, auth bootstrap, dashboard inner-route navigation. Startup
// styles live beside this component; the logo fallback uses src/global.css.
// ---------------------------------------------------------------------------

import logoSrc from "~/assets/logo.png";
import { createEffect, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { IconByName } from "../icons";
import { apiReadConnectionStatus } from "../api";
import { LocusLoadFailure } from "../locus-notifications";
import { createModalTransition } from "../confirm-modal";
import { useWorkspaceLoad } from "../workspace-load";
import "./loading-screen.css";

const startupSteps = ["Connecting to the server…", "Checking your sign-in…", "Loading data…"] as const;
const startupMarks = [
  { label: "Server", icon: "plug-connected" },
  { label: "Sign-in", icon: "user-check" },
  { label: "Data", icon: "list-check" },
] as const;

/** The shared wait every lens is sitting on: the server, the sign-in, then the data. */
export function sharedStartupWait(): { stage: 0 | 1 | 2; detail: string } {
  const status = apiReadConnectionStatus();
  if (status === "loading") return { stage: 0, detail: "Waiting for the server to start…" };
  if (status === "connecting") return { stage: 0, detail: "Connecting to the server…" };
  return { stage: 2, detail: "Loading data…" };
}

/** Keep the three marks on the same step as the sentence. A missing mark used to look finished. */
export function startupFromDetail(detail: string | undefined): { stage: 0 | 1 | 2; detail: string } {
  const text = detail || "Connecting to the server…";
  const stage = /sign-in/i.test(text) ? 1
    : /connect|starting|waiting for the server/i.test(text) ? 0
    : 2;
  return { stage, detail: text };
}

/** The loading branch retires immediately; only inert paint can fade out. */
function LoadingPaint(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref">) {
  const transition = createModalTransition({ positionedPaint: true });
  return <div {...props} ref={transition}>{props.children}</div>;
}

export function LoadingScreen(props: {
  inline?: boolean;
  page?: boolean;
  reserveTopbar?: boolean;
  stage?: 0 | 1 | 2;
  detail?: string;
  error?: string;
  errorCard?: boolean;
  retry?: () => void;
  title?: string;
  actions?: JSX.Element;
}) {
  const stage = () => props.stage ?? (props.detail ? startupFromDetail(props.detail).stage : 2);
  return (
    <Show when={!props.error || props.errorCard} fallback={<LocusLoadFailure message="Could not load data."
      detail={props.error} retry={props.retry} />}><Show when={props.inline || props.errorCard} fallback={<LoadingPaint class="fenel-loading">
      <img src={logoSrc} alt="Fenel" class="fenel-loading__logo" />
      <div class="fenel-loading__bar" role="progressbar" aria-label="Loading">
        <div class="fenel-loading__bar-inner" />
      </div>
    </LoadingPaint>}>
      <div class={["workspace-startup", { "workspace-startup--page": !!props.page, "workspace-startup--with-topbar": !!props.reserveTopbar }]}>
        <div class="workspace-startup__card" role={props.error ? "alert" : "status"} aria-live={props.error ? "assertive" : "polite"}
          aria-label={props.error ? props.title || "Could not load data." : props.detail || startupSteps[stage()]}>
          <div class="workspace-startup__title">
            <span>{props.title || (props.error ? "Could not load data." : "Loading...")}</span>
          </div>
          <Show when={!props.error}><ol class="workspace-startup__steps" aria-label="Loading steps">
            <For each={startupMarks}>{(mark, index) => <li class="workspace-startup__step"
              data-state={index() < stage() ? "complete" : index() === stage() ? "current" : "waiting"}
              aria-current={index() === stage() ? "step" : undefined}
              aria-label={`${mark.label}: ${index() < stage() ? "ready" : index() === stage() ? "loading" : "waiting"}`}
              data-tooltip={index() < stage() ? `${mark.label} ready` : index() === stage() ? props.detail || startupSteps[index()] : startupSteps[index()]}>
              <span class="workspace-startup__mark" aria-hidden="true"><Show when={index() === stage()}
                fallback={<IconByName name={index() < stage() ? "check" : mark.icon} size={12} />}>
                <span class="home-new-button__spinner" />
              </Show></span>
            </li>}</For>
          </ol></Show>
          <p class="workspace-startup__detail">{props.detail || (props.error ? "Please try again." : startupSteps[stage()])}</p>
          <Show when={props.error}><details class="workspace-startup__error">
            <summary>Error details</summary><pre>{props.error}</pre>
          </details></Show>
          <Show when={props.actions || (props.error && props.retry)}><div class="workspace-startup__actions">
            {props.actions || <button type="button" onClick={() => props.retry?.()}>Try again</button>}
          </div></Show>
        </div>
      </div>
    </Show></Show>
  );
}

/** A lens that cannot be used yet: a spinner, and no sentence of its own. */
export function LensSpinner() {
  return <div class="workspace-pane__wait" role="status" aria-label="Loading">
    <span class="home-new-button__spinner" aria-hidden="true" />
  </div>;
}

/** The same lens frame holds early address reads and later session waits. Its
 * empty slots retain presentation only; no preceding reader data is kept. */
export function LensFrame(props: {
  id: string;
  chromeMode?: "expanded" | "compact" | "hidden";
  merged?: boolean;
  waiting?: boolean;
  header?: JSX.Element;
  summary?: JSX.Element;
  corner?: JSX.Element;
  /** A destination shown at once over the retained, hidden previous data. */
  navigating?: boolean;
  navigation?: JSX.Element;
  children?: JSX.Element;
}) {
  const mode = () => props.chromeMode ?? "expanded";
  return <div class={["workspace-panes", { "workspace-panes--merged": !!props.merged }]}>
    <section class={["workspace-pane", "workspace-pane--active", {
      "workspace-pane--chrome-hidden": mode() === "hidden", "workspace-pane--waiting": !!props.waiting,
    }]} data-workspace-lens={props.id} data-chrome-mode={mode()} data-navigation-pending={props.navigating ? "true" : undefined}>
      <header class="workspace-pane__header" inert={mode() === "hidden"}
        aria-hidden={mode() === "hidden" ? "true" : undefined}>{props.header}</header>
      <div class="workspace-pane__summary" aria-hidden={mode() !== "expanded" ? "true" : undefined}
        inert={mode() !== "expanded"}>{props.summary}</div>
      {props.corner}
      {props.navigation}
      <div class="workspace-pane__body">{props.children}</div>
    </section>
  </div>;
}

export function PendingLensFrame() {
  return <div class="workspace-surface"><LensFrame id="pending-session" merged waiting
    header={<div class="workspace-pane__toolbar-mount" />}
    summary={<div class="workspace-pane__summary-mount"><div class="workspace-pane__summary-placeholder" aria-hidden="true">
      <span class="workspace-pane__summary-skeleton" /></div></div>}><LensSpinner /></LensFrame></div>;
}

/** Same spinner, and a note to keep its lens frame in the waiting state. */
export function LensPending(props: { id: string; stage?: 0 | 1 | 2; detail?: string }) {
  const load = useWorkspaceLoad();
  // Clearing during an owned cleanup throws in Solid 2. A later report for the
  // same lens wins; only the latest wait is allowed to retire itself.
  let generation = 0;
  createEffect(() => ({
    id: props.id,
    stage: props.stage ?? 2,
    detail: props.detail || startupSteps[2],
  }), (wait) => {
    const mine = ++generation;
    load?.report(wait.id, { stage: wait.stage, detail: wait.detail });
    return () => {
      queueMicrotask(() => { if (mine === generation) load?.report(wait.id, undefined); });
    };
  });
  return <LensSpinner />;
}
