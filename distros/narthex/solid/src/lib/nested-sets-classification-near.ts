// Which marks of a classification ask for their picture, and in what order.
// Pictures are decoded one at a time by the reader (glyph-picture.tsx asks the
// reader worker, which answers in the order it was asked), and a mark asks as
// soon as it is drawn: in document order, the Tree of life's Fungi and Animals
// (on the first screen, top right) waited behind the whole Plants box below
// the fold (Nov 12: Fungi was the 71st of 94 pictures asked for). Here a mark
// asks when it comes near the screen: the marks on screen first, the ones
// within a screen a frame later, the others when a scroll brings them near.
// Solid/browser renderer allowance — the same kind as deferred-card.tsx.

import { createContext, useContext } from "solid-js";

/** What the gate reads of an IntersectionObserver entry. */
export type NearEntry = { target: object; isIntersecting: boolean; boundingClientRect: { top: number; bottom: number } };
type NearObserver = { observe(target: object): void; unobserve(target: object): void; disconnect?(): void };

export type NearScreen = {
  /** `near` runs once, when `target` comes near the screen; the returned stop forgets it. */
  watch(target: object, near: () => void): () => void;
  close(): void;
};

// The Boxes drawing provides its gate; a mark outside it (the Tree and Graph
// cards draw the same link marks) asks for its picture at once. The default is
// null, a value: Solid 2 reads an undefined default as "no default" and throws
// outside a provider, and the typed reader's Errored boundary then painted the
// generic record for good (the Tree of life's "Tree" button, Nov 13).
export const NearScreenContext = createContext<NearScreen | null>(null);

/** The gate of the Boxes drawing this mark sits in, if any. */
export function useNearScreen(): NearScreen | undefined {
  return useContext(NearScreenContext) ?? undefined;
}

function browserObserver(run: (entries: NearEntry[]) => void): NearObserver | undefined {
  if (typeof IntersectionObserver === "undefined") return undefined;
  // One extra screen above and below counts as near, as for the deferred cards.
  const observer = new IntersectionObserver(entries => run(entries), { rootMargin: "100% 0px 100% 0px", threshold: 0 });
  return { observe: target => observer.observe(target as Element), unobserve: target => observer.unobserve(target as Element),
    disconnect: () => observer.disconnect() };
}

function windowBounds(): { top: number; bottom: number } {
  return { top: 0, bottom: typeof window === "undefined" ? 0 : window.innerHeight };
}

function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => run());
  else setTimeout(run, 0);
}

export function createNearScreen(options: {
  observer?: (run: (entries: NearEntry[]) => void) => NearObserver | undefined;
  visibleBounds?: () => { top: number; bottom: number };
  later?: (run: () => void) => void;
} = {}): NearScreen {
  const create = options.observer ?? browserObserver;
  const visibleBounds = options.visibleBounds ?? windowBounds;
  const later = options.later ?? nextFrame;
  const waiting = new Map<object, () => void>();
  let observer: NearObserver | undefined;
  let created = false;
  let closed = false;
  const release = (target: object) => {
    const near = waiting.get(target);
    if (!near || closed) return;
    waiting.delete(target);
    observer?.unobserve(target);
    near();
  };
  const seen = (entries: NearEntry[]) => {
    if (closed) return;
    const bounds = visibleBounds();
    const soon: object[] = [];
    // A worker answers in the order it is asked: the marks on screen ask in
    // this callback, the ones just outside it on the next frame.
    for (const entry of entries) {
      if (!entry.isIntersecting || !waiting.has(entry.target)) continue;
      const shown = entry.boundingClientRect.bottom > bounds.top && entry.boundingClientRect.top < bounds.bottom;
      if (shown) release(entry.target);
      else soon.push(entry.target);
    }
    if (soon.length > 0) later(() => { for (const target of soon) release(target); });
  };
  return {
    watch(target, near) {
      if (closed) return () => {};
      if (!created) { created = true; observer = create(seen); }
      if (!observer) { near(); return () => {}; }
      waiting.set(target, near);
      observer.observe(target);
      return () => { if (waiting.delete(target)) observer?.unobserve(target); };
    },
    close() {
      closed = true;
      waiting.clear();
      observer?.disconnect?.();
    },
  };
}
