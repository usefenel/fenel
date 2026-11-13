// A lens's focus, kept by value. Every workspace publication (a window resize
// re-lays the lenses out: workspace-surface.tsx's ResizeObserver calls the
// store's resize) hands each pane a new lens object, and the pane's focus is
// read from it as a new scope object. Home keys its focused card on that
// object (focusedPreview builds the card's item from it; `<For>` keys rows by
// reference), so an unchanged focus remounted the card: the typed reader, its
// evaluation and its worker read started again from nothing, and the
// snapshot's plain record was painted meanwhile (the Tree of life went back to
// its generic record for minutes after any resize). A focus equal by value is
// the same focus.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { createMemo, type Accessor } from "solid-js";
import type { LocusScope } from "./locus-scope";

/** The same place in the same data: kind, list, item, path, and how it was entered. */
export function sameScope(left: LocusScope, right: LocusScope): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "root") return true;
  if (left.kind === "view") return left.viewId === (right as typeof left).viewId;
  const other = right as typeof left;
  return left.viewId === other.viewId && left.itemId === other.itemId
    && left.path.length === other.path.length && left.path.every((step, index) => step === other.path[index])
    && !!left.rootItem === !!other.rootItem
    && (left.passThrough?.length ?? 0) === (other.passThrough?.length ?? 0)
    && (left.passThrough ?? []).every((depth, index) => depth === other.passThrough?.[index]);
}

/** A focus memo that keeps its previous scope object while the focus is the same by value. */
export function createScopeMemo(compute: () => LocusScope): Accessor<LocusScope> {
  return createMemo(compute, { equals: sameScope });
}
