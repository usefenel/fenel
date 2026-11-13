// ---------------------------------------------------------------------------
// tooltip — one custom tooltip layer for the whole app.
//
// The browser's `title` tooltip is not ours: the OS picks the delay, the font,
// the colour and the position, it cannot be styled, it does not appear on
// keyboard focus in every engine, it swallows newlines, and on a control whose
// real answer is a CLICK (the notification bell, the data-set gear) it answers
// a hover-shaped question instead. So `title` is retired as a presentation
// mechanism and `data-tooltip` replaces it.
//
// It is ONE document-level layer, not a wrapper component per call site:
//   * a call site only writes `data-tooltip="…"` — no import, no extra element,
//     no change to how the control is laid out or positioned,
//   * nothing is measured or mounted until a pointer actually rests somewhere,
//   * an element deep inside any component gets it for free.
//
// `aria-describedby` is attached to the target while the bubble is up, so the
// tooltip is announced rather than merely drawn.
//
// `data-tooltip-code="…"` marks the part of the text that is a code name
// (Codeable, shown because no human label exists): the layer renders that part
// in the shared code face of `display-name-text.tsx`, the same as on the surface.
//
// A checklist (`data-tooltip-marks`): each line of the text may start with a
// mark (`✓` met, `○` not yet, `✗` failed, `?` not checked, `·` being checked) and may carry a
// detail after ` — `; the layer draws the mark, the label and the detail as
// one row. The text stays the plain text other readers get (`aria-label`).
//
// A tooltip follows its control while it is up: when `data-tooltip` changes
// under an open bubble (a field's rules while it is typed), the bubble shows
// the new text in place. `data-tooltip-pending` dims it while the control says
// its answer is being recomputed.
//
// A control that explains a whole field can ask to be shown while the field
// has focus, without a pointer: it carries `data-tooltip-on-focus`, and the
// field's container carries `data-tooltip-focus-host`. Focus inside the host
// (on a control without a tooltip of its own) opens that tooltip and keeps it
// until focus leaves or Escape is pressed. `data-tooltip-anchor="<selector>"`
// places the bubble against the nearest matching ancestor instead of the small
// control, and `data-tooltip-beside` prefers the space beside that box, so the
// bubble does not cover the next field. Its value may name the surface the
// field sits on (a dialog box): the bubble then stands outside that surface,
// on its right, else on its left, level with the field; below the field when
// the viewport has room on neither side.
// ---------------------------------------------------------------------------

import { For, Show, createSignal, onSettled, untrack } from "solid-js";
import { Portal } from "@solidjs/web";
import { TextWithCodeName } from "./display-name-text";
import "./tooltip.css";

/** Long enough that sweeping the pointer across a toolbar shows nothing; short
 *  enough that resting on a control answers before you wonder. */
const OPEN_DELAY_MS = 450;
/** Once one tooltip is up, moving to the next control answers immediately —
 *  the user has already declared they are reading the bar. */
const WARM_DELAY_MS = 80;
/** How long the row stays warm after the last tooltip closed. */
const WARM_WINDOW_MS = 600;
const GAP = 8;
/** Beside a field the bubble stands a little further off than under a button. */
const BESIDE_GAP = 12;
const EDGE = 8;
const TOOLTIP_ID = "fenel-tooltip";
const FOCUS_HOST = "[data-tooltip-focus-host]";
const ON_FOCUS = "[data-tooltip][data-tooltip-on-focus]";
/** A control announces with this event that its focus tooltip now exists
 *  (it mounted after focus had already entered its field). */
export const TOOLTIP_AVAILABLE_EVENT = "fenel:tooltip-available";

type Placement = { left: number; top: number; below: boolean };

export type TooltipMark = "met" | "notyet" | "failed" | "unknown" | "waiting";
export type TooltipLine = { indent: number; mark?: TooltipMark; label: string; detail?: string };
const MARKS: Record<string, TooltipMark> = { "✓": "met", "○": "notyet", "✗": "failed", "?": "unknown", "·": "waiting" };

/** The rows of a checklist tooltip: leading pairs of spaces indent (one step
 *  is a mark and its gap wide, so an indented row starts under a label), a leading
 *  mark and a space name the row's state, ` — ` separates the detail. A line
 *  without a mark is a plain heading. */
export function tooltipLines(text: string): TooltipLine[] {
  return text.split("\n").map(raw => {
    const body = raw.trimStart(), indent = Math.floor((raw.length - body.length) / 2);
    const mark = body.charAt(1) === " " ? MARKS[body.charAt(0)] : undefined;
    const rest = mark ? body.slice(2) : body;
    const cut = mark ? rest.indexOf(" — ") : -1;
    return { indent, mark, label: cut < 0 ? rest : rest.slice(0, cut), detail: cut < 0 ? undefined : rest.slice(cut + 3) };
  });
}

/** The tooltip a focused control shows without a pointer: the marked control
 *  of its nearest host, else of an enclosing host (a record's own rule while
 *  one of its plain fields is typed). */
function focusTooltipFor(element: Element | null): HTMLElement | null {
  for (let host = element?.closest<HTMLElement>(FOCUS_HOST) ?? null; host;
    host = host.parentElement?.closest<HTMLElement>(FOCUS_HOST) ?? null) {
    for (const candidate of host.querySelectorAll<HTMLElement>(ON_FOCUS)) {
      if (candidate.closest(FOCUS_HOST) === host && candidate.getAttribute("data-tooltip")) return candidate;
    }
  }
  return null;
}

function MarkGlyph(props: { mark: TooltipMark }) {
  return (
    <svg class="fenel-tooltip__mark" viewBox="0 0 12 12" aria-hidden="true">
      {props.mark === "met" ? <path d="M2 6.4l2.6 2.6L10 3.2" />
        : props.mark === "failed" ? <path d="M2.8 2.8l6.4 6.4M9.2 2.8l-6.4 6.4" />
        : props.mark === "unknown" ? <path d="M4.2 4.4a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.4M6 9.6v.1" />
        : props.mark === "waiting" ? <path d="M2.6 6h.1M6 6h.1M9.4 6h.1" />
        : <circle cx="6" cy="6" r="3.4" />}
    </svg>
  );
}

export function TooltipLayer() {
  const [text, setText] = createSignal<string>();
  const [code, setCode] = createSignal<string>();
  const [marks, setMarks] = createSignal(false);
  const [dim, setDim] = createSignal(false);
  // A text that changes under an open bubble replaces it without the opening animation.
  const [steady, setSteady] = createSignal(false);
  const [at, setAt] = createSignal<Placement>({ left: 0, top: 0, below: true });
  let bubble: HTMLDivElement | undefined;
  let target: HTMLElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let warmUntil = 0;
  let cursor: { x: number; y: number } | undefined;
  let generation = 0;
  let alive = true;
  // The open bubble belongs to the focused field (opened without a pointer).
  let byFocus = false;
  let observer: MutationObserver | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  // Escape closes a focus tooltip until focus moves again.
  let dismissed: Element | null = null;

  /** The open focus tooltip still belongs to the control that has focus. */
  const focusHeld = () => byFocus && !!target && target.isConnected && focusTooltipFor(document.activeElement) === target;

  function hide() {
    const mine = ++generation;
    clearTimeout(openTimer);
    openTimer = undefined;
    observer?.disconnect();
    observer = undefined;
    clearInterval(watch);
    watch = undefined;
    byFocus = false;
    // An imperative check from the pointer and key listeners: whether a bubble
    // is up right now, not a value to follow.
    if (untrack(text) !== undefined) warmUntil = Date.now() + WARM_WINDOW_MS;
    if (target?.getAttribute("aria-describedby") === TOOLTIP_ID) target.removeAttribute("aria-describedby");
    target = undefined;
    // Focus restoration can dispatch focusout while Solid disposes an owned
    // computation. Retire the target now; publish outside that computation.
    queueMicrotask(() => {
      if (alive && generation === mine && target === undefined) setText(undefined);
    });
  }

  /** Below the control by default, flipped above when the viewport has no room,
   *  and clamped so a tooltip on the last button in a bar stays on screen. */
  function place() {
    const element = target;
    if (!alive || !element || !bubble) return;
    const own = element.getBoundingClientRect();
    const selector = element.getAttribute("data-tooltip-anchor");
    const anchor = (selector ? element.closest(selector) : null)?.getBoundingClientRect() ?? own;
    const size = bubble.getBoundingClientRect();
    const beside = element.getAttribute("data-tooltip-beside");
    if (beside !== null) {
      const surface = (beside ? element.closest(beside) : null)?.getBoundingClientRect() ?? anchor;
      const top = Math.max(EDGE, Math.min(anchor.top, window.innerHeight - size.height - EDGE));
      if (surface.right + BESIDE_GAP + size.width <= window.innerWidth - EDGE) {
        setAt({ left: surface.right + BESIDE_GAP, top, below: true });
        return;
      }
      if (surface.left - BESIDE_GAP - size.width >= EDGE) {
        setAt({ left: surface.left - BESIDE_GAP - size.width, top, below: true });
        return;
      }
    }
    if (element.hasAttribute("data-tooltip-follow-cursor") && cursor) {
      const below = cursor.y + 16 + size.height <= window.innerHeight - EDGE;
      setAt({
        left: Math.max(EDGE, Math.min(cursor.x + 12, window.innerWidth - size.width - EDGE)),
        top: Math.max(EDGE, below ? cursor.y + 16 : cursor.y - GAP - size.height),
        below,
      });
      return;
    }
    const below = anchor.bottom + GAP + size.height <= window.innerHeight - EDGE
      || anchor.top - GAP - size.height < EDGE;
    const left = Math.max(EDGE, Math.min(
      own.left + own.width / 2 - size.width / 2,
      window.innerWidth - size.width - EDGE,
    ));
    setAt({ left, top: below ? anchor.bottom + GAP : anchor.top - GAP - size.height, below });
  }

  function show(element: HTMLElement, label: string, viaFocus = false) {
    if (!alive) return;
    const mine = ++generation;
    target = element;
    byFocus = viaFocus;
    element.setAttribute("aria-describedby", TOOLTIP_ID);
    setCode(element.getAttribute("data-tooltip-code") ?? undefined);
    setMarks(element.hasAttribute("data-tooltip-marks"));
    setDim(element.hasAttribute("data-tooltip-pending"));
    setSteady(false);
    setText(label);
    // The bubble follows its control's text while it is up.
    observer?.disconnect();
    observer = new MutationObserver(() => follow(element));
    observer.observe(element, { attributes: true, attributeFilter: ["data-tooltip", "data-tooltip-pending"] });
    // A focus tooltip has no pointer event to close it when its control goes away.
    clearInterval(watch);
    watch = viaFocus ? setInterval(() => { if (target === element && !element.isConnected) hide(); }, 400) : undefined;
    // The bubble has to exist before it can be measured; one frame is enough,
    // and it is invisible until `place` has run.
    requestAnimationFrame(() => {
      if (alive && generation === mine && target === element) place();
    });
  }

  function follow(element: HTMLElement) {
    if (!alive || target !== element) return;
    const label = element.getAttribute("data-tooltip");
    if (!label || !element.isConnected) { hide(); return; }
    setDim(element.hasAttribute("data-tooltip-pending"));
    if (label === untrack(text)) return;
    setSteady(true);
    setText(label);
    requestAnimationFrame(() => { if (alive && target === element) place(); });
  }

  /** Open the focused field's own tooltip when nothing else is up. */
  function syncFocus() {
    if (!alive || target) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === dismissed || active.closest("[data-tooltip]")) return;
    const found = focusTooltipFor(active);
    const label = found?.getAttribute("data-tooltip");
    if (found && label) show(found, label, true);
  }

  onSettled(() => {
    const enter = (event: Event) => {
      if (event instanceof PointerEvent) cursor = { x: event.clientX, y: event.clientY };
      else if (event.type === "focusin") cursor = undefined;
      const found = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-tooltip]")
        : null;
      if (!found) {
        if (event.type === "focusin") {
          // Focus entered a control without a tooltip of its own: its field's
          // marked control, when there is one, explains it while it is typed.
          dismissed = null;
          const proxy = event.target instanceof Element ? focusTooltipFor(event.target) : null;
          if (proxy && proxy === target && byFocus) return;
          hide();
          const label = proxy?.getAttribute("data-tooltip");
          if (proxy && label) show(proxy, label, true);
          return;
        }
        // Leaving a tooltipped control for bare page space closes it; moving
        // between two of them is handled by the branch below. A focus tooltip
        // stays while its field keeps focus.
        if (target && event.type === "pointerover" && !focusHeld()) hide();
        return;
      }
      if (found === target) return;
      const label = found.getAttribute("data-tooltip");
      if (!label) { hide(); return; }
      // `data-tooltip-when-cut`: the text repeats the control's own text, so it
      // answers only while that text is cut (an ellipsis, a narrow column).
      if (found.hasAttribute("data-tooltip-when-cut") && found.scrollWidth <= found.clientWidth) { hide(); return; }
      // A disabled control still explains itself — that is often the only place
      // the reason lives — but a hidden one does not.
      hide();
      const delay = Date.now() < warmUntil ? WARM_DELAY_MS : OPEN_DELAY_MS;
      const mine = generation;
      openTimer = setTimeout(() => {
        if (alive && generation === mine) show(found, label);
      }, event.type === "focusin" ? 0 : delay);
    };
    const leave = (event: Event) => {
      const related = (event as PointerEvent | FocusEvent & { relatedTarget: EventTarget | null }).relatedTarget;
      if (related instanceof Node && target?.contains(related)) return;
      const pointer = event.type === "pointerout";
      // The pointer wandering elsewhere does not close the focused field's tooltip.
      if (pointer && focusHeld()) return;
      hide();
      // The pointer left another control's tooltip: the focused field's returns.
      if (pointer) setTimeout(syncFocus, 0);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (target) dismissed = document.activeElement;
      hide();
    };
    const press = () => { if (!focusHeld()) hide(); };
    const shift = () => { if (focusHeld()) place(); else hide(); };
    const available = () => syncFocus();
    const move = (event: PointerEvent) => {
      cursor = { x: event.clientX, y: event.clientY };
      if (target?.hasAttribute("data-tooltip-follow-cursor")) place();
    };
    // A click is an answer; the hint that led to it is finished. Scrolling or
    // resizing moves the anchor out from under the bubble, so it closes rather
    // than floating somewhere meaningless.
    document.addEventListener("pointerover", enter, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("focusin", enter, true);
    document.addEventListener("pointerout", leave, true);
    document.addEventListener("focusout", leave, true);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener(TOOLTIP_AVAILABLE_EVENT, available, true);
    window.addEventListener("scroll", shift, true);
    window.addEventListener("resize", shift);
    window.addEventListener("blur", hide);
    return () => {
      alive = false;
      hide();
      document.removeEventListener("pointerover", enter, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("focusin", enter, true);
      document.removeEventListener("pointerout", leave, true);
      document.removeEventListener("focusout", leave, true);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener(TOOLTIP_AVAILABLE_EVENT, available, true);
      window.removeEventListener("scroll", shift, true);
      window.removeEventListener("resize", shift);
      window.removeEventListener("blur", hide);
    };
  });

  return (
    // A tooltip owns only readonly content. Snapshot its label so the nested
    // text renderer cannot read a narrowed accessor while this branch closes.
    <Show when={text()} keyed>{(label) => (
      <Portal>
        <div
          ref={(element) => { bubble = element; }}
          id={TOOLTIP_ID}
          role="tooltip"
          class={`fenel-tooltip fenel-tooltip--${at().below ? "below" : "above"}${marks() ? " fenel-tooltip--marks" : ""}${
            steady() ? " fenel-tooltip--steady" : ""}${dim() ? " fenel-tooltip--pending" : ""}`}
          style={{ left: `${at().left}px`, top: `${at().top}px` }}
        ><Show when={marks()} fallback={<TextWithCodeName text={label} code={code()} />}>
          <For each={tooltipLines(label)}>{(line) => (
            <div class={`fenel-tooltip__line${line.mark ? ` fenel-tooltip__line--${line.mark}` : ""}`}
              style={{ "padding-inline-start": `${line.indent * 1.17}rem` }}>
              <Show when={line.mark}>{(mark) => <MarkGlyph mark={mark()} />}</Show>
              <span class="fenel-tooltip__label">{line.label}</span>
              <Show when={line.detail}>{(detail) => <span class="fenel-tooltip__detail">{detail()}</span>}</Show>
            </div>
          )}</For>
        </Show></div>
      </Portal>
    )}</Show>
  );
}
