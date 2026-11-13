import { For, Show, createContext, createEffect, createMemo, createSignal, createUniqueId, onSettled, useContext, type Accessor } from "solid-js";
import { Portal } from "@solidjs/web";
import { IconAlertTriangle, IconBell, IconX } from "./icons";
import { browserAccountScope, onBrowserSessionChange } from "./browser-session";
import { openModalDialog, closeModalDialog } from "./confirm-modal";
import "./locus-notifications.css";
type LocusNoticeAction = { label: string; run: () => void };
export type LocusNotice = { id: string; tone: "error" | "info"; message: string; detail?: string;
  retry?: LocusNoticeAction; actions?: readonly LocusNoticeAction[] };

/** What a dismissal hides: one notice as it read. The same id raised again
 *  with another message is a different notice, and shows. */
export function locusNoticeKey(notice: LocusNotice): string {
  return JSON.stringify([notice.id, notice.tone, notice.message, notice.detail]);
}

type NoticeSource = { notices: LocusNotice[]; dismiss: (id: string) => void };
type NotificationCenter = {
  notices: Accessor<LocusNotice[]>;
  update: (key: symbol, source: NoticeSource) => void;
  remove: (key: symbol) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};
// null (a value) outside the application shell, where the readers below keep
// a local bell: Solid 2 throws on a read with no provider and no default.
export const LocusNotificationContext = createContext<NotificationCenter | null>(null);

export function createLocusNotificationCenter(): NotificationCenter {
  const sources = new Map<symbol, NoticeSource>();
  const retained = new Map<string, LocusNotice>();
  const dismissed = new Set<string>();
  const [notices, setNotices] = createSignal<LocusNotice[]>([]);
  function publish() {
    const entries = new Map<string, LocusNotice>();
    for (const source of sources.values()) for (const notice of source.notices) {
      const id = locusNoticeKey(notice);
      if (!dismissed.has(id)) {
        const existing = entries.get(id);
        entries.set(id, { ...notice, id, retry: notice.retry ?? existing?.retry, actions: notice.actions ?? existing?.actions });
      }
    }
    for (const [id, notice] of retained) if (!entries.has(id) && !dismissed.has(id)) entries.set(id, notice);
    setNotices([...entries.values()]);
  }
  return {
    notices,
    update: (key, source) => {
      sources.set(key, source);
      for (const notice of source.notices) if (notice.tone === "error") {
        const id = locusNoticeKey(notice);
        // Keep the report after a transient hover/boundary disappears, without
        // keeping callbacks that can act on its disposed reader or component.
        retained.set(id, { id, tone: notice.tone, message: notice.message, detail: notice.detail });
      }
      publish();
    },
    remove: (key) => { if (sources.delete(key)) publish(); },
    dismiss: (id) => {
      dismissed.add(id);
      retained.delete(id);
      for (const source of sources.values()) for (const notice of source.notices) {
        if (locusNoticeKey(notice) === id) source.dismiss(notice.id);
      }
      publish();
    },
    clear: () => { sources.clear(); retained.clear(); dismissed.clear(); publish(); },
  };
}

/** Every mounted surface contributes to the same bar. Outside the application
 * shell (for example a standalone fixture), keep the ordinary local bell. */
export function LocusNotifications(props: { notices: LocusNotice[]; onDismiss: (id: string) => void }) {
  const center = useContext(LocusNotificationContext);
  if (!center) return <NotificationBell {...props} />;
  const key = Symbol("notice-source");
  createEffect(() => ({ notices: props.notices, dismiss: props.onDismiss }), (source) => { center.update(key, source); });
  // A pane may be removed while its parent For is reconciling. Publishing
  // into the shared bar during that owned cleanup throws in Solid 2 and can
  // tear down the surviving panes. Retire this source at the host boundary.
  onSettled(() => () => queueMicrotask(() => center.remove(key)));
  return null;
}

export function LocusNotificationHost() {
  const center = useContext(LocusNotificationContext);
  if (!center) return null;
  // Before the first account resolves, every live report belongs to public or
  // Local data. Keep those operations visible when the cookie arrives. Once an
  // account has existed, its reports still retire on logout/session replacement.
  onSettled(() => {
    let accountOwned = browserAccountScope() !== undefined;
    return onBrowserSessionChange(() => {
      if (accountOwned) center.clear();
      accountOwned = browserAccountScope() !== undefined;
    });
  });
  return <NotificationBell notices={center.notices()} onDismiss={center.dismiss} />;
}

/** An error boundary's caught error, with its stack, for the console: the
 * card shows one word, and a swallowed error cannot be diagnosed. */
export function logSurfaceFailure(surface: string, error: unknown): void {
  console.error(`[fenel] ${surface} failed`, error instanceof Error ? error.stack ?? error.message : error);
}

/** A failed surface keeps one compact recovery affordance in place. Details
 * and its retry belong to that surface's lifetime, not a retained notice. */
export function LocusLoadFailure(props: { message: string; detail?: string; retry?: () => void; retryLabel?: string }) {
  const [open, setOpen] = createSignal(false);
  // The card says only "Error": the cause must at least reach the console,
  // or a failed surface cannot be diagnosed from a report or a capture.
  onSettled(() => { console.error(`[fenel] ${props.message}`, props.detail ?? "(no detail was given to this surface)"); });
  return <div class="locus-load-failure" role="alert">
    <button type="button" class="locus-load-failure__card" aria-haspopup="dialog"
      aria-expanded={open() ? "true" : "false"} aria-label={`Error. ${props.message} Open details.`}
      data-tooltip="Open error details" onClick={() => setOpen(true)}>
      <span class="locus-load-failure__icon" aria-hidden="true"><IconAlertTriangle size={20} /></span>
      <span>Error</span>
    </button>
    <Show when={open()}><Portal><LoadFailureDetails {...props} onClose={() => setOpen(false)} /></Portal></Show>
  </div>;
}

function LoadFailureDetails(props: { message: string; detail?: string; retry?: () => void; retryLabel?: string; onClose: () => void }) {
  const titleId = createUniqueId();
  let dialog: HTMLDialogElement | undefined;
  onSettled(() => {
    if (!dialog) return;
    const element = dialog;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    openModalDialog(element);
    element.querySelector<HTMLButtonElement>("[autofocus]")?.focus();
    return () => {
      closeModalDialog(element);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  });
  return <dialog class="locus-load-failure__dialog" ref={element => { dialog = element; }} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) props.onClose();
    }}>
    <header class="locus-load-failure__heading">
      <span class="locus-load-failure__icon" aria-hidden="true"><IconAlertTriangle size={20} /></span>
      <h2 id={titleId}>{props.message}</h2>
      <button type="button" class="locus-load-failure__close" aria-label="Close error details" autofocus
        onClick={props.onClose}><IconX size={18} /></button>
    </header>
    <Show when={props.detail && props.detail !== props.message}><p class="locus-load-failure__detail">{props.detail}</p></Show>
    <Show when={props.retry}><footer class="locus-load-failure__actions">
      <button type="button" class="btn" onClick={() => {
        props.onClose(); props.retry?.();
      }}>{props.retryLabel ?? "Retry"}</button>
    </footer></Show>
  </dialog>;
}

/** Save reports and other notices stay in the shared bar. A failed renderer
 * supplies its own in-place LocusLoadFailure instead of duplicating a notice. */
function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function NotificationBell(props: { notices: LocusNotice[]; onDismiss: (id: string) => void }) {
  const noticedAt = new Map<string, number>();
  function noticeTime(notice: LocusNotice): number {
    const key = locusNoticeKey(notice);
    const known = noticedAt.get(key);
    if (known !== undefined) return known;
    const at = Date.now();
    noticedAt.set(key, at);
    return at;
  }
  const [at, setAt] = createSignal<{ edge: "top" | "bottom"; offset: number; right: number }>();
  createEffect(() => props.notices, (notices) => {
    const live = new Set(notices.map(locusNoticeKey));
    for (const key of noticedAt.keys()) if (!live.has(key)) noticedAt.delete(key);
  });
  const open = () => !!at();
  const count = createMemo(() => props.notices.length);
  let bell: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  // The panel is portaled out of the bar: its backdrop-filter would otherwise
  // make even a fixed descendant use the bar as its containing block.
  function toggle() {
    if (open()) { setAt(undefined); return; }
    const rect = bell?.getBoundingClientRect();
    const above = (rect?.top ?? 50) > window.innerHeight / 2;
    setAt({
      edge: above ? "bottom" : "top",
      offset: Math.max(8, above ? window.innerHeight - rect!.top + 6 : (rect?.bottom ?? 50) + 6),
      right: Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth - 12)),
    });
  }
  // Nothing to say, nothing to show: an always-present empty bell is the same
  // visual pollution as the banner it replaces. A bell that empties while its
  // panel is open must also take the panel with it.
  createEffect(count, (total, previous) => {
    if (total === 0) setAt(undefined);
    else if (previous !== undefined && total > previous && bell && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bell.animate([{ boxShadow: "0 0 0 0 rgb(100 116 139 / 28%)" },
        { boxShadow: "0 0 0 9px rgb(100 116 139 / 0%)" }], { duration: 560, easing: "ease-out" });
    }
  });
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && (bell?.contains(target) || panel?.contains(target))) return;
      setAt(undefined);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setAt(undefined); };
    const reposition = () => setAt(undefined);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", reposition);
    };
  });
  return (
    <Show when={count() > 0}>
      <div class="locus-notifications">
        <button type="button" ref={(element) => { bell = element; }}
          class="locus-notifications__bell"
          aria-haspopup="dialog" aria-expanded={open() ? "true" : "false"}
          aria-label={`${count()} notification${count() === 1 ? "" : "s"}`}
          onClick={toggle}>
          {/* No `title`. The browser's own tooltip answered a click-shaped
              question with a hover-shaped answer, and a joined-by-pipes dump of
              every message is not a notification list. The panel below is. */}
          <IconBell size={18} />
          <For each={[count()]}>{total => <span class="locus-notifications__count">{total}</span>}</For>
        </button>
        <Show when={at()}>{(position) => <Portal>
          <div ref={(element) => { panel = element; }} class="locus-notifications__panel" role="dialog"
            aria-label="Notifications"
            style={{
              top: position().edge === "top" ? `${position().offset}px` : undefined,
              bottom: position().edge === "bottom" ? `${position().offset}px` : undefined,
              right: `clamp(0.5rem, ${position().right}px, max(0.5rem, calc(100% - 28rem - 0.5rem)))`,
              "max-height": `calc(100dvh - ${position().offset}px - 0.5rem)`,
            }}>
            <For each={props.notices}>{(notice) => {
              const at = noticeTime(notice);
              const shortDetail = notice.detail && notice.detail.length <= 160 && !notice.detail.includes("\n") ? notice.detail : undefined;
              return (
              <div class={`locus-notifications__item locus-notifications__item--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
                <div class="locus-notifications__text">
                  <div class="locus-notifications__headline">
                    <p>{notice.message}</p>
                    <time datetime={new Date(at).toISOString()}>{clockLabel(at)}</time>
                  </div>
                  <Show when={shortDetail}>
                    <p class="locus-notifications__extra">{shortDetail}</p>
                  </Show>
                  <Show when={notice.detail && !shortDetail}>
                    <details class="locus-notifications__detail">
                      <summary>Details</summary>
                      <p>{notice.detail}</p>
                    </details>
                  </Show>
                </div>
                <Show when={notice.retry || notice.actions?.length}>
                  <div class="locus-notifications__actions">
                    <Show when={notice.retry}>{(retry) => (
                      <button type="button" class="btn locus-notifications__retry" onClick={() => retry().run()}>{retry().label}</button>
                    )}</Show>
                    <For each={notice.actions}>{action => <button type="button" class="btn locus-notifications__retry"
                      onClick={() => action.run()}>{action.label}</button>}</For>
                  </div>
                </Show>
                <button type="button" class="locus-notifications__dismiss" aria-label="Dismiss"
                  data-tooltip="Dismiss" onClick={() => props.onDismiss(notice.id)}>×</button>
              </div>
            ); }}</For>
          </div>
        </Portal>}</Show>
      </div>
    </Show>
  );
}
