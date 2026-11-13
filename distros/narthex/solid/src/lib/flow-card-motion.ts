import { createEffect, createMemo, onSettled, untrack } from "solid-js";

type Row<T> = { key: number; item: T };

/** Browser row identity and geometry only. The caller still writes through its
 * existing source transition. A positional list's explicit move permutation
 * follows its mounted cards after the source renumbers the editing slots. */
export function createFlowCardMotion<T extends { id: string }>(
  items: () => readonly T[],
  sourceKey: (item: T) => string,
  positional: (item: T) => boolean,
) {
  let nextKey = 0;
  let previous: Row<T>[] = [];
  let container: HTMLElement | undefined;
  let frame: number | undefined;
  let alive = true;
  const animations = new Set<Animation>();
  type Move = { rows: Row<T>[]; expected: string[]; original: string[]; positional: boolean; before: Map<number, DOMRect> };
  let pending: Move | undefined;
  let ready: Map<number, DOMRect> | undefined;

  const rows = createMemo(() => {
    const current = items();
    const byId = new Map(previous.map(row => [row.item.id, row]));
    let retained = byId;
    if (pending && current.length === pending.rows.length) {
      const matches = pending.positional
        ? current.every((item, index) => sourceKey(item) === pending!.expected[index])
        : current.every((item, index) => item.id === pending!.rows[index]!.item.id);
      if (matches) {
        retained = new Map(current.map((item, index) => [item.id, pending!.rows[index]!]));
        ready = pending.before;
        pending = undefined;
      } else if (pending.positional && !current.every((item, index) => sourceKey(item) === pending!.original[index])) {
        // A concurrent data change is not an acknowledgement of this move.
        pending = undefined;
      }
    } else if (pending) pending = undefined;
    previous = current.map(item => ({ key: retained.get(item.id)?.key ?? nextKey++, item }));
    return previous;
  });

  function elements() {
    return new Map(Array.from(container?.querySelectorAll<HTMLElement>(":scope > [data-flow-card-key]") ?? [])
      .map(element => [Number(element.dataset.flowCardKey), element]));
  }
  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  createEffect(rows, () => {
    if (!ready) return;
    const before = ready;
    ready = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!alive || !container?.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (const [key, element] of elements()) {
        const from = before.get(key);
        if (!from) continue;
        const to = element.getBoundingClientRect();
        const x = from.left - to.left, y = from.top - to.top;
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
        const animation = element.animate([
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
      }
    });
  });
  onSettled(() => () => { alive = false; pending = undefined; ready = undefined; stop(); });

  return {
    rows,
    attach: (element: HTMLElement) => { container = element; },
    prepare(next: readonly T[]) {
      const current = untrack(rows);
      const byId = new Map(current.map(row => [row.item.id, row]));
      const reordered = next.map(item => byId.get(item.id));
      if (reordered.some(row => !row) || next.length !== current.length) return;
      const before = new Map([...elements()].map(([key, element]) => [key, element.getBoundingClientRect()]));
      stop();
      const isPositional = current.every(row => positional(row.item));
      pending = { rows: reordered as Row<T>[], before, positional: isPositional,
        expected: isPositional ? next.map(sourceKey) : [],
        original: isPositional ? current.map(row => sourceKey(row.item)) : [] };
    },
  };
}
