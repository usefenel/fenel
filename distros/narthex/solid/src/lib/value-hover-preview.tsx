import { Errored, Loading, Show, createContext, createEffect, createSignal, onSettled, useContext, type Accessor } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import { DataUnavailable, ValueCard, ValueCardCaption } from "./value-card";
import { ownsDataOpenEvent } from "./data-transfer/events";
import { displayNameText, type DisplayNameInput } from "./display-name";

/** A presentation hint only: the same card and typed renderer keep their data. */
export const ValueCardInlineContext = createContext<Accessor<boolean>>(() => false);
export function useValueCardInline(): Accessor<boolean> { return useContext(ValueCardInlineContext); }
export type ValueCardCompactLayout = "one-line" | "two-line";
export const ValueCardCompactLayoutContext = createContext<Accessor<ValueCardCompactLayout>>(() => "one-line");
export function useValueCardCompactLayout(): Accessor<ValueCardCompactLayout> { return useContext(ValueCardCompactLayoutContext); }
/** A portaled preview reads its data but owns no mounted graph placement. */
export const ValueHoverCardContext = createContext<Accessor<boolean>>(() => false);
export function useValueHoverCard(): Accessor<boolean> { return useContext(ValueHoverCardContext); }
/** The value IS the page's focused value (ValueCard's "body" presentation, no
 * card chrome around it): a record there draws its own data card. Every card
 * inside it resets this, so only the focused value itself reads it as true. */
export const ValueCardFocusedContext = createContext<Accessor<boolean>>(() => false);
export function useValueCardFocused(): Accessor<boolean> { return useContext(ValueCardFocusedContext); }

/** Browser-only hover/focus behavior. The caller supplies the same card it
 * renders in a lens; moving the pointer only moves its portal, never mounts
 * another renderer or evaluates the value again. */
export function ValueHoverPreview(props: {
  label: DisplayNameInput;
  class?: string;
  /** A caller can inspect the same complete card instead of its inline lens. */
  fullPreview?: boolean;
  preview: () => JSX.Element;
  onOpen?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [point, setPoint] = createSignal({ x: 0, y: 0 });
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let popup: HTMLDivElement | undefined;
  let source: HTMLDivElement | undefined;
  let cursor = { x: 0, y: 0 };

  const cancelClose = () => { clearTimeout(closing); closing = undefined; };
  function close() {
    clearTimeout(opening);
    opening = undefined;
    cancelClose();
    setOpen(false);
  }
  function position(x: number, y: number) {
    cursor = { x, y };
    const width = popup?.offsetWidth ?? Math.min(props.fullPreview ? 360 : 352, window.innerWidth - 24);
    const height = popup?.offsetHeight ?? 52;
    setPoint({
      x: Math.max(12, Math.min(x + 16, window.innerWidth - width - 12)),
      y: Math.max(12, Math.min(y + 16, window.innerHeight - height - 12)),
    });
  }
  function owns(event: Event) {
    return event.target instanceof Element && event.target.closest("[data-value-preview]") === source;
  }
  function show(x: number, y: number, immediate = false) {
    cancelClose();
    position(x, y);
    if (open() || opening) return;
    if (immediate) setOpen(true);
    else opening = setTimeout(() => { opening = undefined; setOpen(true); }, 180);
  }
  function leave() {
    clearTimeout(opening);
    opening = undefined;
    cancelClose();
    closing = setTimeout(close, 160);
  }
  function enter() { close(); props.onOpen?.(); }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    else if (props.onOpen && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); event.stopPropagation(); enter();
    }
  }
  createEffect(open, (visible) => {
    if (!visible) return;
    let observer: ResizeObserver | undefined;
    const frame = requestAnimationFrame(() => {
      position(cursor.x, cursor.y);
      if (props.fullPreview && popup) {
        observer = new ResizeObserver(() => position(cursor.x, cursor.y));
        observer.observe(popup);
      }
    });
    const hide = (event: Event) => {
      // Child media can emit a scroll event inside the naturally sized card.
      // Page scrolling still dismisses it through the capture listener.
      if (props.fullPreview && event.target instanceof Node && popup?.contains(event.target)) return;
      close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", escape);
    };
  });
  onSettled(() => () => { clearTimeout(opening); clearTimeout(closing); });

  return <>
    <div ref={source} class={["value-hover-preview", props.class]} data-value-preview
      role={props.onOpen ? "button" : "group"} tabindex="0" aria-label={`${props.onOpen ? "Open this data" : "Data preview"}: ${displayNameText(props.label)}`}
      onPointerOver={(event) => {
        if (event.pointerType !== "touch" && owns(event)) show(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!owns(event)) { close(); return; }
        if (event.pointerType !== "touch") show(event.clientX, event.clientY);
      }}
      onPointerLeave={leave}
      onFocus={(event) => {
        if (event.target !== source) return;
        const rect = event.currentTarget.getBoundingClientRect();
        show(rect.left, rect.bottom, true);
      }}
      onBlur={leave}
      onContextMenu={event => props.onContextMenu?.(event)}
      onKeyDown={(event) => { if (event.target === source) key(event); }}
      onClick={(event) => {
        if (!props.onOpen || !owns(event) || !ownsDataOpenEvent(event, source!)) return;
        event.stopPropagation(); enter();
      }}>
      {props.children}
    </div>
    <Show when={open()}><Portal>
      <div ref={popup} class={["value-hover-preview__card", { "value-hover-preview__card--full": !!props.fullPreview }]} data-value-preview-popup
        role={props.onOpen ? "button" : "group"} tabindex="0" aria-label={`${props.onOpen ? "Open this data" : "Data preview"}: ${displayNameText(props.label)}`}
        style={{ left: `${point().x}px`, top: `${point().y}px` }}
        onPointerEnter={cancelClose} onPointerLeave={leave}
        onFocus={cancelClose} onBlur={leave} onKeyDown={key}
        onClick={(event) => { if (props.onOpen) { event.stopPropagation(); enter(); } }}>
        <ValueHoverCardContext value={() => true}><ValueCardInlineContext value={() => !props.fullPreview}><ValueCardCompactLayoutContext value={() => "two-line"}><div inert>
          <Errored fallback={() => <ValueCard heading={<ValueCardCaption caption={props.label} />}>
            <DataUnavailable label="This data could not be previewed." />
          </ValueCard>}>
            <Loading fallback={<ValueCard heading={<ValueCardCaption caption={props.label} />} busy />}>
              {props.preview()}
            </Loading>
          </Errored>
        </div></ValueCardCompactLayoutContext></ValueCardInlineContext></ValueHoverCardContext>
      </div>
    </Portal></Show>
  </>;
}
