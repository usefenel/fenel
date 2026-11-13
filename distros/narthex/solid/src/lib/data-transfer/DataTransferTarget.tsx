import { Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { captureDataTransfer, copyTransferItem, writeTransferData, retainCopiedTransfer,
  type TransferItem, type TransferSnapshot } from "./index";
import { hasTextSelection, isDataTransfer, ownsTransferEvent } from "./events";
import { onBrowserSessionChange, sessionEpoch } from "../browser-session";
import { registerTransferCommands } from "./commands";
import { IconCopy } from "../icons";
import "./data-transfer.css";

/** One event boundary for every depth of a value, including an empty slot. */
export function DataTransferTarget(props: {
  label: string;
  /** Omitted for a copy-only read surface. */
  onTransfer?: (snapshot: TransferSnapshot, signal: AbortSignal) => Promise<void> | void;
  copyValue?: () => TransferItem | undefined;
  /** B4 wave 4 lane E: the user may be about to copy or drag (pointer over,
   * focus or a context menu on this target): a Local reader prefetches the
   * item in its worker here, so Copy stays synchronous in its own gesture. */
  onCopyIntent?: () => void;
  /** The top-level card surface carries its own Copy in the card's BAR, next
   *  to Duplicate. Inside the body the same control would be a second copy of
   *  one action, so the surface that owns a bar asks this one to stand down. */
  hideCopy?: boolean;
  disabled?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  const [busy, setBusy] = createSignal(false);
  const [over, setOver] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  /** A confirmation is not a status: it says a thing HAPPENED and then it is
   *  over. Leaving "Copied." parked under the value turns one keystroke of
   *  feedback into permanent furniture, so it expires on its own. */
  const [flash, setFlash] = createSignal<string>();
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function confirm(text: string) {
    clearTimeout(flashTimer);
    setFlash(text);
    flashTimer = setTimeout(() => { if (alive) setFlash(undefined); }, 1200);
  }
  let alive = true;
  let pending: AbortController | undefined;
  let target!: HTMLDivElement;
  const unsubscribe = onBrowserSessionChange(() => {
    pending?.abort();
    pending = undefined;
    setBusy(false);
    setOver(false);
    setMessage(undefined);
    clearTimeout(flashTimer);
    setFlash(undefined);
  });
  onCleanup(() => { alive = false; pending?.abort(); unsubscribe(); clearTimeout(flashTimer); });

  createEffect(() => !props.disabled && !!props.onTransfer, (accepts) => {
    if (accepts) return;
    pending?.abort();
    pending = undefined;
    setBusy(false);
    setOver(false);
    setMessage(undefined);
  });

  async function receive(snapshot: TransferSnapshot) {
    if (!alive || props.disabled || !props.onTransfer) return;
    if (busy()) { setMessage("An import is already in progress here. Try again when it finishes."); return; }
    const epoch = sessionEpoch();
    const controller = new AbortController();
    pending = controller;
    setBusy(true);
    setMessage(undefined);
    try {
      await props.onTransfer(snapshot, controller.signal);
    } catch (error) {
      if (alive && epoch === sessionEpoch() && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (pending === controller) {
        pending = undefined;
        if (alive && epoch === sessionEpoch()) setBusy(false);
      }
    }
  }

  async function copy() {
    if (!alive || props.disabled) return;
    try {
      const value = props.copyValue?.();
      if (!value) return;
      const notice = await copyTransferItem(value);
      if (alive) { if (notice) setMessage(notice); else confirm("Copied"); }
    } catch (error) {
      if (alive) setMessage(error instanceof Error ? error.message : "Could not copy this value.");
    }
  }

  onSettled(() => registerTransferCommands(target, {
    canCopy: () => alive && !props.disabled && !!props.copyValue,
    canPaste: () => alive && !props.disabled && !!props.onTransfer && !busy(),
    copy,
    paste: receive,
  }));

  return <div ref={target} data-fenel-transfer-target="value"
    class={`fenel-transfer-target ${props.class ?? ""} ${over() ? "fenel-transfer-target--over" : ""}`}
    tabindex={props.disabled ? undefined : 0}
    aria-label={props.label}
    aria-busy={busy() ? "true" : "false"}
    onPointerEnter={() => { if (!props.disabled && props.copyValue) props.onCopyIntent?.(); }}
    onFocusIn={() => { if (!props.disabled && props.copyValue) props.onCopyIntent?.(); }}
    onContextMenu={() => { if (!props.disabled && props.copyValue) props.onCopyIntent?.(); }}
    onPaste={(event) => {
      if (props.disabled || !ownsTransferEvent(event, target) || !isDataTransfer(event.clipboardData, true)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!props.onTransfer) return;
      const captured = captureDataTransfer(event.clipboardData!);
      void receive(captured);
    }}
    onDragOver={(event) => {
      if (props.disabled || !ownsTransferEvent(event, target) || !isDataTransfer(event.dataTransfer, true)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!props.onTransfer) { event.dataTransfer!.dropEffect = "none"; return; }
      event.dataTransfer!.dropEffect = "copy";
      setOver(true);
    }}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget)) setOver(false);
    }}
    onDrop={(event) => {
      setOver(false);
      if (props.disabled || !ownsTransferEvent(event, target) || !isDataTransfer(event.dataTransfer, true)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!props.onTransfer) return;
      const captured = captureDataTransfer(event.dataTransfer!);
      void receive(captured);
    }}
    onCopy={(event) => {
      if (props.disabled || hasTextSelection() || !ownsTransferEvent(event, target) || !event.clipboardData) return;
      try {
        const value = props.copyValue?.();
        if (!value) return;
        const encoded = writeTransferData(event.clipboardData, value);
        event.preventDefault();
        event.stopPropagation();
        const epoch = sessionEpoch();
        void retainCopiedTransfer(encoded, value.source).then(notice => {
          if (alive && epoch === sessionEpoch()) { if (notice) setMessage(notice); else confirm("Copied"); }
        });
      } catch (error) { setMessage(error instanceof Error ? error.message : "Could not copy this value."); }
    }}>
    <Show when={!props.disabled && !props.hideCopy && props.copyValue}>
      <div class="fenel-transfer-actions">
        {/* No "Paste or drop" on hover. Hovering a value is not an intent to
            replace it, and advertising the offer on every pass of the pointer
            reads as a warning about something the user never asked for. The
            offer is made WHILE a drag is over the target instead — see the
            overlay below, which is the only moment it is true. */}
        <button type="button" class="fenel-transfer-copy" draggable="true"
          aria-label="Copy data" data-tooltip="Copy data, or drag it to other data or a lens"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); void copy(); }}
          onDragStart={(event) => {
            event.stopPropagation();
            try {
              const value = props.copyValue?.();
              if (!value || !event.dataTransfer) { event.preventDefault(); return; }
              writeTransferData(event.dataTransfer, value);
              event.dataTransfer.effectAllowed = "copy";
            } catch (error) {
              event.preventDefault();
              setMessage(error instanceof Error ? error.message : "Could not copy this value.");
            }
          }}><IconCopy size={14} /></button>
      </div>
    </Show>
    <Show when={over() && !props.disabled && props.onTransfer}>
      <div class="fenel-transfer-drop" aria-hidden="true">
        <span class="fenel-transfer-drop__label">Drop to add</span>
      </div>
    </Show>
    {props.children}
    <Show when={busy()}><span class="fenel-transfer-status" role="status">Importing…</span></Show>
    <Show when={message()}>{(text) => <span class="fenel-transfer-status" role="status">{text()}</span>}</Show>
    <Show when={flash()}>{(text) => <span class="fenel-transfer-flash" role="status">{text()}</span>}</Show>
  </div>;
}
