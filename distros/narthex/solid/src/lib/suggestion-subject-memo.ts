// imgsuggest (Nov 13): one subject, one whole-data check per reader frame.
// Every worker request carries a fresh transported copy of its input: the
// Suggestions list, each previewed row and the click on a row arrived as new
// objects, so the per-input verdict memo restarted for each request and a
// pasted picture's membership in Image (a containment check over every pixel,
// the costly part of a check) was paid again for every previewed row and for
// the click. Here the first request's subject is kept as a private copy for its
// reader frame; later requests with the exact same bytes check that copy, and
// its values share their verdicts. Exact transport bytes only (no semantic
// key); another frame or its owners start afresh; a few recent subjects stay.

import { exactTransportKey } from "../../../../../implementations/typescript/engine/src/registry-transport";

type Held<M> = { key: string; owners: readonly object[]; expression: unknown; values: WeakSet<object>; membership: M };

export type SubjectMemo<M> = {
  /** This frame's private copy of an expression with these exact bytes (made
   * on first sight), or the expression itself when it is not plain data. */
  subject<E>(frame: object, owners: readonly object[], expression: E, make: () => M): E;
  /** The shared verdicts for a value that belongs to a held subject. */
  membershipFor(frame: object, owners: readonly object[], value: unknown): M | undefined;
};

function collect(value: unknown, into: WeakSet<object>): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || into.has(current)) continue;
    into.add(current);
    for (const child of Array.isArray(current) ? current : Object.values(current)) stack.push(child);
  }
}

export function createSubjectMemo<M>(limit = 4): SubjectMemo<M> {
  const frames = new WeakMap<object, Held<M>[]>();
  const sameOwners = (left: readonly object[], right: readonly object[]) =>
    left.length === right.length && left.every((owner, index) => owner === right[index]);
  return {
    subject(frame, owners, expression, make) {
      let key: string | undefined;
      try { key = exactTransportKey(expression); } catch { key = undefined; }
      if (key === undefined) return expression;
      const held = (frames.get(frame) ?? []).filter(entry => sameOwners(entry.owners, owners));
      const index = held.findIndex(entry => entry.key === key);
      if (index >= 0) {
        const [entry] = held.splice(index, 1);
        held.push(entry!);
        frames.set(frame, held);
        return entry!.expression as typeof expression;
      }
      let copy: typeof expression;
      try { copy = structuredClone(expression); } catch { return expression; }
      const values = new WeakSet<object>();
      collect(copy, values);
      held.push({ key, owners: [...owners], expression: copy, values, membership: make() });
      while (held.length > limit) held.shift();
      frames.set(frame, held);
      return copy;
    },
    membershipFor(frame, owners, value) {
      if (value === null || typeof value !== "object") return undefined;
      return frames.get(frame)?.find(entry => sameOwners(entry.owners, owners) && entry.values.has(value))?.membership;
    },
  };
}
