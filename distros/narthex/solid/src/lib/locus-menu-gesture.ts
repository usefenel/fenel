/** The touch half of the context gesture.
 *
 *  A finger has no second button, so on a touch or pen surface the workspace
 *  offers two presses in its place: a TAP on the view's own background, and a
 *  LONG PRESS on a card. Anything else — a control, a link, a short tap inside
 *  a card — means what that target means; stealing it would make the workspace
 *  unusable with a finger, which is the opposite of the point. A mouse keeps
 *  its own gesture and never opens the menu either of these ways.
 *
 *  Kept to one import — the leaf the right-click half already shares — so the
 *  browser-only menu can use it without pulling the workspace in behind it. */
import { hasTextSelection } from "./data-transfer/events";

/** Targets whose own activation owns the press. `ownsLocusContextMenu` is the
 *  right-click half and is deliberately more permissive: right-clicking a
 *  button is not how a button is pressed — tapping one is. */
const CLAIMED_BY_TARGET = [
  "a[href]", "button", "input", "textarea", "select", "label", "summary", "video", "audio",
  '[role="button"]', '[role="checkbox"]', '[role="link"]', '[role="menu"]', '[role="menuitem"]',
  '[role="option"]', '[role="radio"]', '[role="switch"]', '[role="tab"]', '[role="textbox"]',
  '[contenteditable]:not([contenteditable="false"])',
  ".modal-overlay",
].join(", ");

/** The card. Its own item actions are what a long press over it reaches. */
const CARD = "[data-locus-item]";

/** A finger that moved was a pan, not a press. Android's own touch slop. */
const SLOP_PX = 10;
/** The platform long-press dwell, so holding here feels like holding anywhere. */
const HOLD_MS = 500;
/** A backstop only: the watch below normally ends on the click or the next
 *  press, and neither is something a live surface goes without for long. */
const GHOST_CLICK_MS = 1000;

function claimed(target: Element): boolean { return !!target.closest(CLAIMED_BY_TARGET); }

export function locusTapTargetIsBackground(target: EventTarget | null): boolean {
  return target instanceof Element && !claimed(target) && !target.closest(CARD);
}

export function locusPressTargetIsCard(target: EventTarget | null): boolean {
  return target instanceof Element && !claimed(target) && !!target.closest(CARD);
}

let dismissal: Event | undefined;

/** An open menu closes on an outside pointerdown. It records THAT event here so
 *  the same tap cannot reopen a menu at the new point: tapping away has to mean
 *  dismiss, and on a touch surface there is no Escape key to fall back on. */
export function noteLocusMenuDismissal(event: Event): void { dismissal = event; }

/** One gesture, one answer — reading it also releases the reference. */
function dismissedBy(event: Event): boolean {
  const matched = dismissal === event;
  dismissal = undefined;
  return matched;
}

/** A long press opens the menu with the finger still down, so the click the
 *  browser makes of the release lands on the menu that just appeared. Eat
 *  exactly that one.
 *
 *  The watch ends on the NEXT PRESS rather than on a clock, because the click
 *  being eaten is the one with no press in front of it — every click the user
 *  actually means has one, and it clears the watch on the way through. A clock
 *  would have to guess how late the browser may be, and guess long. */
function swallowGhostClick(): void {
  const eat = (event: Event) => { event.preventDefault(); event.stopPropagation(); stop(); };
  const stop = () => {
    document.removeEventListener("click", eat, true);
    document.removeEventListener("pointerdown", stop, true);
    clearTimeout(timer);
  };
  document.addEventListener("click", eat, true);
  document.addEventListener("pointerdown", stop, true);
  const timer = setTimeout(stop, GHOST_CLICK_MS);
}

export type LocusTapMenu = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: () => void;
  onClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
};

/** Handlers for the surface that owns the context menu. Wire all six — the
 *  contextmenu one REPLACES the surface's direct handler, because a native
 *  long press and this one must not both answer the same hold. */
export function createLocusTapMenu(open: (event: MouseEvent) => void): LocusTapMenu {
  let press: { id: number; x: number; y: number; target: Element; card: boolean } | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Our own long press already answered this hold. */
  let held = false;
  let tapped: { x: number; y: number } | undefined;

  function endPress() {
    clearTimeout(holdTimer);
    holdTimer = undefined;
    press = undefined;
  }
  function forget() { endPress(); tapped = undefined; held = false; }

  function hold() {
    const start = press;
    holdTimer = undefined;
    if (!start?.card || !start.target.isConnected) return;
    // A long press IS a right-click, so it says so in the DOM's own words. The
    // surface's contextmenu handler then reads a real event: its target, its
    // point and its currentTarget are the ones a mouse would have produced,
    // which a hand-built stand-in for the finished pointerdown cannot give.
    start.target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: start.x, clientY: start.y, button: 2,
    }));
    held = true;
  }

  return {
    onPointerDown(event) {
      const dismissed = dismissedBy(event);
      forget();
      if (dismissed || event.pointerType === "mouse" || !event.isPrimary) return;
      // The selection is read HERE because the press is about to clear it, and
      // a press that dismisses a selection has already meant something. The
      // right-click half declines on the same ground.
      if (hasTextSelection() || !(event.target instanceof Element)) return;
      const card = locusPressTargetIsCard(event.target);
      if (!card && !locusTapTargetIsBackground(event.target)) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target, card };
      if (card) holdTimer = setTimeout(hold, HOLD_MS);
    },
    // The hold decides while the finger is still down, so drift has to be
    // caught as it happens rather than compared at the release.
    onPointerMove(event) {
      const start = press;
      if (!start || start.id !== event.pointerId) return;
      if (Math.abs(event.clientX - start.x) > SLOP_PX || Math.abs(event.clientY - start.y) > SLOP_PX) endPress();
    },
    onPointerUp(event) {
      const start = press;
      const opened = held;
      forget();
      // The hold already opened the menu; the release only has to not undo it.
      if (opened) return swallowGhostClick();
      tapped = start && !start.card && start.id === event.pointerId
        && Math.abs(event.clientX - start.x) <= SLOP_PX
        && Math.abs(event.clientY - start.y) <= SLOP_PX
        && locusTapTargetIsBackground(event.target)
        ? { x: event.clientX, y: event.clientY } : undefined;
    },
    // A scroll or a system gesture took the press over; it was never a press.
    onPointerCancel: forget,
    onClick(event) {
      const tap = tapped;
      forget();
      // The click the browser synthesises from the tap is what opens the menu.
      // Opening at pointerup would put the fresh menu under the finger in time
      // for that very click to activate its first item. Matching the point
      // keeps a click the tap did not produce — a keyboard Enter on the focused
      // surface — from spending a stale arm.
      if (!tap || Math.abs(event.clientX - tap.x) > SLOP_PX || Math.abs(event.clientY - tap.y) > SLOP_PX) return;
      open(event);
    },
    onContextMenu(event) {
      // Android raises its own contextmenu from a long press. Whichever of the
      // two arrives first is the one that opens the menu; the other is spent.
      if (held) { event.preventDefault(); return; }
      endPress();
      open(event);
    },
  };
}
