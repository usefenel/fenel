import { Loading, Show, createSignal, onSettled } from "solid-js";
import { ValueCard, ValueCardCaption } from "./value-card";
import { holdPictureEvaluations } from "./picture-evaluation-gate";
import type { JSX } from "@solidjs/web";

// A frame admits one card across the visible lenses. Photo cards mount before
// picture renders. Each card still uses its existing renderer and reader.
// Disposed cards leave the queue. Cards that are merely off screen stay
// queued behind the visible ones, so the next row does not wait for a scroll.
const soon: (() => void)[] = [];
const later: (() => void)[] = [];
const ahead: (() => void)[] = [];
const rest: (() => void)[] = [];
let frame: number | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let soonWaiting = 0;
let settleFrame: number | undefined;
const pictureWaiters: (() => void)[] = [];

function pendingCount() {
  return soon.length + later.length + ahead.length + rest.length;
}

function releasePictures() {
  if (soonWaiting > 0 || settleFrame !== undefined) return;
  settleFrame = requestAnimationFrame(() => {
    settleFrame = undefined;
    if (soonWaiting > 0) return;
    const ready = pictureWaiters.splice(0);
    for (const resolve of ready) resolve();
  });
}

function afterSoonCards(): Promise<void> {
  if (soonWaiting === 0 && pictureWaiters.length === 0) return Promise.resolve();
  return new Promise(resolve => {
    pictureWaiters.push(resolve);
    releasePictures();
  });
}

holdPictureEvaluations(afterSoonCards);

function takeNext() {
  // What is on screen mounts first, photos before pictures. Then the cards
  // just out of sight, then the rest, without waiting for a scroll.
  return soon.shift() ?? later.shift() ?? ahead.shift() ?? rest.shift();
}

function schedule() {
  if (!pendingCount() || frame !== undefined || timer !== undefined) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    timer = setTimeout(() => {
      timer = undefined;
      const next = takeNext();
      next?.();
      if (!pendingCount()) {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
      }
      schedule();
      releasePictures();
    }, 0);
  });
}

type CardLane = "soon" | "later" | "ahead" | "rest";

function enqueue(mount: () => void, lane: CardLane) {
  const run = lane === "soon" ? () => { soonWaiting--; mount(); } : mount;
  if (lane === "soon") soonWaiting++;
  const queue = lane === "soon" ? soon : lane === "later" ? later : lane === "ahead" ? ahead : rest;
  queue.push(run);
  schedule();
  return () => {
    const index = queue.indexOf(run);
    if (index < 0) return;
    queue.splice(index, 1);
    if (lane === "soon") soonWaiting--;
    if (!pendingCount()) {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      frame = undefined;
      timer = undefined;
    }
    releasePictures();
  };
}

function scrollParent(element: HTMLElement): Element | undefined {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX)) return node;
    node = node.parentElement;
  }
  return undefined;
}

/** Mount what is on screen first, then keep going into the cards just outside
 * it and the ones further away. A scroll is not required to start the next
 * card. Once mounted, a card stays mounted, so scrolling never throws away an
 * edit. `later` cards (picture renders) wait until the visible photo cards
 * have mounted. */
export function DeferredCard(props: { label?: string; later?: boolean; render: () => JSX.Element }) {
  const [mounted, setMounted] = createSignal(false);
  let element: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  let cancel: (() => void) | undefined;
  let lane: CardLane | undefined;
  let active = true;
  let ready = false;
  let measuredFrame: number | undefined;
  function request(near: boolean) {
    if (!active || ready) return;
    const next: CardLane = props.later ? (near ? "later" : "rest") : (near ? "soon" : "ahead");
    if (cancel && lane === next) return;
    cancel?.();
    lane = next;
    cancel = enqueue(() => {
      cancel = undefined;
      if (!active || !element?.isConnected) return;
      ready = true;
      observer?.disconnect();
      const started = (globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings
        ? performance.now() : undefined;
      setMounted(true);
      if (started !== undefined) measuredFrame = requestAnimationFrame(() => {
        measuredFrame = undefined;
        if (active) performance.measure("fenel:card:mount", {
          start: started, end: performance.now(), detail: { label: props.label || "Data" },
        });
      });
    }, next);
  }
  onSettled(() => {
    if (element && typeof IntersectionObserver !== "undefined") {
      const root = scrollParent(element);
      // One extra screen in every direction counts as "already here", so the
      // next row starts before the scroll reaches it. Everything else still
      // joins the queue, behind what is on screen.
      observer = new IntersectionObserver(entries => request(entries.some(entry => entry.isIntersecting)), {
        root: root ?? undefined, rootMargin: "100% 0px 100% 0px", threshold: 0,
      });
      observer.observe(element);
    } else request(true);
    return () => {
      active = false; cancel?.(); observer?.disconnect();
      if (measuredFrame !== undefined) cancelAnimationFrame(measuredFrame);
    };
  });
  const placeholder = () => <ValueCard busy heading={<ValueCardCaption caption={props.label} />} />;
  return <div class="home-card-slot" ref={element} data-card-ready={mounted() ? "true" : "false"}
    tabindex={mounted() ? undefined : 0} aria-label={mounted() ? undefined : `Loading ${props.label || "data"}`}
    onFocusIn={() => request(true)} onPointerEnter={() => request(true)}>
    <Show when={mounted()} fallback={placeholder()}><Loading fallback={placeholder()}>{props.render()}</Loading></Show>
  </div>;
}
