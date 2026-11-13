// ---------------------------------------------------------------------------
// Confirm + prompt modals — async replacements for window.confirm() and
// window.prompt().
//
// Usage:
//   import { confirmDialog, promptDialog } from "~/lib/confirm-modal";
//
//   if (!(await confirmDialog("Delete this thing?"))) return;
//
//   const name = await promptDialog({
//     message: "Name this view:",
//     defaultValue: "Untitled",
//   });
//   if (name == null) return; // user cancelled
//
// promptDialog renders the input via the shared FieldRenderer keyed off
// a String FieldDef so the value's widget matches the rest of the
// dashboard (no bespoke text input). Pass a richer field via `field` to
// reuse format-validated widgets (e.g. format:url, format:email).
//
// One <ConfirmModalHost /> mounts at the app shell — every dialog call
// routes through the same singleton state signal so the modal is
// always rendered consistently and never doubles up.
// ---------------------------------------------------------------------------

import { createSignal, onSettled, Show, Loading, Errored, lazy } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FieldDef } from "@fenel/engine/types";
import "./confirm-modal.css";
// Confirmations must work before the typed workspace is ready.
const PromptBody = lazy(() => import("./prompt-body"));

export type ConfirmVariant = "default" | "danger";

export type ConfirmOptions = {
  message: string;
  /** Optional extra-context paragraph rendered below the main message. */
  detail?: string;
  /** "danger" colours the confirm button red — use for destructive ops. */
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmPending = ConfirmOptions & {
  kind: "confirm";
  resolve: (ok: boolean) => void;
};

export type PromptOptions = {
  /** The prompt text shown above the input. */
  message: string;
  /** Optional FieldDef driving the FieldRenderer. Defaults to a
   *  required String field labelled by `message`. Pass a richer field
   *  to reuse format-validated widgets (format:url, format:email, …)
   *  or to plug in any FenelType the FieldRenderer can render. */
  field?: FieldDef;
  /** Initial value seeded into the field. */
  defaultValue?: unknown;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type PromptPending = PromptOptions & {
  kind: "prompt";
  resolve: (value: unknown | null) => void;
};

type Pending = ConfirmPending | PromptPending;

const [pending, setPending] = createSignal<Pending | null>(null);
type NativeModalPaint = { rect: DOMRect; opacity: string; background: string; backdropFilter: string };
const nativeModalPaint = new WeakMap<HTMLDialogElement, { paint: NativeModalPaint; dispose: () => void }>();
type PositionedOverlayPaint = { rect: DOMRect; padding: string; color: string; zIndex: string };

/** Preserve only the closing paint: the real dialog and its requests dispose
 * immediately, and the inert copy cannot receive input or hold focus. */
function fadeOutModal(element: HTMLElement, positioned?: PositionedOverlayPaint) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const native = element instanceof HTMLDialogElement;
  const saved = native ? nativeModalPaint.get(element)?.paint : undefined;
  if ((!element.isConnected && !saved && !positioned) || (native && !element.open && !saved)) return;
  const rect = element.isConnected ? element.getBoundingClientRect() : (saved ?? positioned)!.rect;
  const leaving = element.cloneNode(true) as HTMLElement;
  leaving.setAttribute("aria-hidden", "true");
  leaving.inert = true;
  leaving.classList.add("modal-transition--leaving");
  leaving.style.setProperty("--modal-exit-opacity", element.isConnected ? getComputedStyle(element).opacity : saved?.opacity ?? "1");
  for (const node of [leaving, ...leaving.querySelectorAll("[id], [data-tooltip], [aria-describedby]")]) {
    node.removeAttribute("id"); node.removeAttribute("data-tooltip"); node.removeAttribute("aria-describedby");
  }
  if (positioned) {
    // Loading fallbacks may be detached before Solid's cleanup. Retain only
    // their geometry; the exiting copy has no handlers, owner or requests.
    Object.assign(leaving.style, { position: "fixed", inset: "auto", margin: "0", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, minHeight: "0", maxWidth: "none", maxHeight: "none",
      padding: positioned.padding, color: positioned.color, zIndex: positioned.zIndex === "auto" ? "5" : positioned.zIndex,
      boxSizing: "border-box", transform: "none" });
    for (const node of [leaving, ...leaving.querySelectorAll("[aria-live], [role]")]) {
      node.removeAttribute("aria-live"); node.removeAttribute("role");
    }
  }
  const canvases = leaving.querySelectorAll("canvas");
  element.querySelectorAll("canvas").forEach((canvas, index) => {
    if (canvas.width && canvas.height) canvases[index]?.getContext("2d")?.drawImage(canvas, 0, 0);
  });
  let paint: HTMLElement = leaving;
  if (native) {
    paint = document.createElement("div");
    paint.className = "modal-transition-backdrop modal-transition--leaving";
    paint.setAttribute("aria-hidden", "true"); paint.inert = true;
    const backdrop = element.isConnected ? getComputedStyle(element, "::backdrop") : undefined;
    paint.style.background = backdrop?.backgroundColor ?? saved!.background;
    paint.style.backdropFilter = backdrop?.backdropFilter ?? saved!.backdropFilter;
    Object.assign(leaving.style, { position: "fixed", margin: "0", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, maxWidth: "none", maxHeight: "none", boxSizing: "border-box", transform: "none" });
    paint.append(leaving);
  }
  document.body.append(paint);
  const timer = window.setTimeout(() => paint.remove(), 180);
  paint.addEventListener("animationend", (event) => {
    if (event.target !== paint) return;
    window.clearTimeout(timer); paint.remove();
  });
}

/** Browser lifecycle for an existing overlay; compose this with another ref
 * through Solid's ref array when the caller also needs the element. */
export function createModalTransition(options?: { positionedPaint?: boolean }): (element: HTMLElement) => void {
  let element: HTMLElement | undefined;
  onSettled(() => {
    let positioned: PositionedOverlayPaint | undefined;
    const capture = () => {
      if (!element?.isConnected) return;
      const style = getComputedStyle(element);
      positioned = { rect: element.getBoundingClientRect(), padding: style.padding, color: style.color, zIndex: style.zIndex };
    };
    const observer = options?.positionedPaint ? new ResizeObserver(capture) : undefined;
    if (observer && element) { capture(); observer.observe(element); }
    return () => {
      observer?.disconnect();
      if (element) fadeOutModal(element, positioned);
    };
  });
  return (next) => { element = next; next.setAttribute("data-modal-transition", ""); };
}

export function ModalOverlay(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref">) {
  const transition = createModalTransition();
  return <div {...props} ref={transition}>{props.children}</div>;
}

/** Native dialogs need their paint captured before close removes ::backdrop. */
export function openModalDialog(dialog: HTMLDialogElement) {
  nativeModalPaint.get(dialog)?.dispose();
  dialog.setAttribute("data-modal-transition", "");
  dialog.showModal();
  const readPaint = (): NativeModalPaint => {
    const backdrop = getComputedStyle(dialog, "::backdrop");
    return { rect: dialog.getBoundingClientRect(), opacity: getComputedStyle(dialog).opacity,
      background: backdrop.backgroundColor, backdropFilter: backdrop.backdropFilter };
  };
  const current = { paint: readPaint(), dispose: () => {} };
  const capture = () => { if (dialog.isConnected && dialog.open) current.paint = readPaint(); };
  // Solid may detach a native dialog before its owned cleanup. Retain geometry
  // at the browser boundary so the dim backdrop and window can still leave.
  const observer = new ResizeObserver(capture);
  observer.observe(dialog);
  dialog.addEventListener("pointerdown", capture, true);
  dialog.addEventListener("keydown", capture, true);
  window.addEventListener("resize", capture);
  const settled = window.setTimeout(capture, 180);
  current.dispose = () => {
    observer.disconnect(); window.clearTimeout(settled);
    dialog.removeEventListener("pointerdown", capture, true);
    dialog.removeEventListener("keydown", capture, true);
    window.removeEventListener("resize", capture);
  };
  nativeModalPaint.set(dialog, current);
}

export function closeModalDialog(dialog: HTMLDialogElement) {
  fadeOutModal(dialog);
  nativeModalPaint.get(dialog)?.dispose();
  nativeModalPaint.delete(dialog);
  dialog.close();
}

/** Imperatively show the confirm modal. Resolves to `true` when the
 *  user clicks the confirm button, `false` for cancel / dismiss. */
export function confirmDialog(
  arg: string | ConfirmOptions,
): Promise<boolean> {
  const opts: ConfirmOptions =
    typeof arg === "string" ? { message: arg } : arg;
  return new Promise<boolean>((resolve) => {
    setPending({ kind: "confirm", ...opts, resolve });
  });
}

/** Imperatively show the prompt modal. Resolves to the entered value
 *  on confirm, `null` on cancel / dismiss. */
export function promptDialog(
  arg: string | PromptOptions,
): Promise<unknown | null> {
  const opts: PromptOptions =
    typeof arg === "string" ? { message: arg } : arg;
  return new Promise<unknown | null>((resolve) => {
    setPending({ kind: "prompt", ...opts, resolve });
  });
}

function close(ok: boolean, value?: unknown) {
  const p = pending();
  if (!p) return;
  setPending(null);
  if (p.kind === "confirm") {
    p.resolve(ok);
  } else {
    p.resolve(ok ? value : null);
  }
}

/** Mount once at the app shell. Picks up every confirmDialog +
 *  promptDialog call. */
export function ConfirmModalHost() {
  return (
    <Show when={pending()}>
      {(p) => (
        <Show when={p().kind === "prompt"} fallback={<ConfirmBody p={p() as ConfirmPending} />}>
          <Errored fallback={() => <PromptPreparation failed />}>
            <Loading fallback={<PromptPreparation />}>
              <PromptBody p={p() as PromptPending} close={close} />
            </Loading>
          </Errored>
        </Show>
      )}
    </Show>
  );
}

function PromptPreparation(props: { failed?: boolean }) {
  return <ModalOverlay class="confirm-modal__overlay"
    onClick={(event) => { if (event.target === event.currentTarget) close(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") close(false); }}>
    <div class="confirm-modal__box" role="dialog" aria-modal="true" aria-label="Opening editor">
      <p role={props.failed ? "alert" : "status"}>{props.failed
        ? "Could not load the editor. Close this dialog and reload the page."
        : "Loading editor…"}</p>
      <div class="confirm-modal__actions">
        <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel"
          onClick={() => close(false)} ref={(el) => requestAnimationFrame(() => el.focus())}>Cancel</button>
      </div>
    </div>
  </ModalOverlay>;
}

function ConfirmBody(props: { p: ConfirmPending }) {
  const p = () => props.p;
  return (
    <ModalOverlay
      class="confirm-modal__overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close(false);
      }}
    >
      <div class="confirm-modal__box" role="dialog" aria-modal="true" aria-label={p().message}>
        <div class="confirm-modal__message">{p().message}</div>
        <Show when={p().detail}>
          <div class="confirm-modal__detail">{p().detail}</div>
        </Show>
        <div class="confirm-modal__actions">
          <button
            type="button"
            class="confirm-modal__btn confirm-modal__btn--cancel"
            onClick={() => close(false)}
          >
            {p().cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            class={
              p().variant === "danger"
                ? "confirm-modal__btn confirm-modal__btn--danger"
                : "confirm-modal__btn confirm-modal__btn--primary"
            }
            onClick={() => close(true)}
            ref={(el) => {
              if (el) requestAnimationFrame(() => el.focus());
            }}
          >
            {p().confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
