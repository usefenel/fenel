// ---------------------------------------------------------------------------
// locus-scope — WHERE YOU ARE in your data.
//
// The locus is one value, and a view renders a value. So "go inside this item"
// is not a mechanism: it is the observation that the item is a value too, and
// the root view can render THAT one instead. `design/locus-as-value.md` §2.
//
// Three consequences this module exists to make literal:
//
//  1. There is ONE top-level value. The `locus_views` rows are not separate
//     universes you pick between with a dropdown — they are the ITEMS of that
//     top-level `List Anything`. So the root scope lists them, and you ENTER
//     one; you do not switch to one.
//
//  2. A value is always CONTAINED in a scope, so "back" is "up". The way back
//     is a property of how you arrived, not of the value: the same value is
//     reachable by several routes when it is shared by reference. That is why
//     a scope carries a PATH and not a parent pointer.
//
//  3. Nothing is hidden, so nothing needs pinning. The explorer shows what is
//     there. To see ten of a thousand images together you build a list holding
//     those ten — and the ten are REFERENCES, which is ordinary Fenel, not a
//     UX affordance. Sharing a value between two siblings therefore means
//     putting it in a scope that encloses both.
//
// Everything here is pure: data in, data out. The Solid wiring lives in
// `routes/app/home.tsx`, and the arrangement of a scope that has no row of its
// own lives in `locus-arrangement.ts`.
// ---------------------------------------------------------------------------

import { hasDataPreview } from "./data-transfer/data-preview-shape";
import { isLocusCatalogReference, type LocusCatalogReferenceValue } from "./locus-catalog-reference";

/** One step into a value: a list index or a record/variant field name. */
export type LocusPathStep = string | number;

/**
 * Where the locus currently is.
 *
 * `root`  — the top-level `List Anything`. Its items are the data sets.
 * `view`  — inside one data set: its items are what that set holds.
 * `value` — inside one item's VALUE, `path` steps deep. `path: []` is the
 *           item's whole value; `["a", 2]` is `value.a[2]`.
 */
export type LocusScope =
  | { readonly kind: "root" }
  | { readonly kind: "view"; readonly viewId: string }
  | {
      readonly kind: "value";
      readonly viewId: string;
      readonly itemId: string;
      readonly path: readonly LocusPathStep[];
      readonly rootItem?: boolean;
      /** Path depths that are not places of their own. Entering a card on a
       *  canvas steps through its `Placed` wrapper to the item in one step,
       *  so the way back up does not stop at the wrapper. */
      readonly passThrough?: readonly number[];
    };

export const ROOT_SCOPE: LocusScope = { kind: "root" };

/** Stable identity for memo/effect keys. Index `1` and field `"1"` are
 *  different places, so the encoding tags each step rather than joining. */
export function scopeKey(scope: LocusScope): string {
  if (scope.kind === "root") return "root";
  if (scope.kind === "view") return `view:${scope.viewId}`;
  return `value:${scope.viewId}:${scope.itemId}:${pathKey(scope.path)}`;
}

export function pathKey(path: readonly LocusPathStep[]): string {
  return path.map((step) => (typeof step === "number" ? `#${step}` : `.${step}`)).join("");
}

/** Every strictly-enclosing scope, outermost first. This IS the breadcrumb —
 *  derived from the current scope rather than kept as a second stack, because
 *  a stack and a position can disagree and then the way back is a lie. */
export function scopeAncestors(scope: LocusScope): LocusScope[] {
  if (scope.kind === "root") return [];
  if (scope.kind === "view") return [ROOT_SCOPE];
  const chain: LocusScope[] = scope.rootItem ? [ROOT_SCOPE] : [ROOT_SCOPE, { kind: "view", viewId: scope.viewId }];
  for (let depth = 0; depth < scope.path.length; depth++) {
    if (scope.passThrough?.includes(depth)) continue;
    const { passThrough: _passThrough, ...place } = scope;
    const kept = scope.passThrough?.filter((inner) => inner < depth);
    chain.push({ ...place, path: scope.path.slice(0, depth), ...(kept?.length ? { passThrough: kept } : {}) });
  }
  return chain;
}

/** The scope one level out, or `undefined` at the root. */
export function parentScope(scope: LocusScope): LocusScope | undefined {
  const chain = scopeAncestors(scope);
  return chain[chain.length - 1];
}

/** The data set a scope lives in, when it is inside one. */
export function scopeViewId(scope: LocusScope): string | undefined {
  return scope.kind === "root" ? undefined : scope.viewId;
}

/** Descend from a value scope by one step. */
export function enterChild(scope: LocusScope, step: LocusPathStep): LocusScope {
  if (scope.kind !== "value") throw new Error("enterChild expects a value scope");
  return { ...scope, path: [...scope.path, step] };
}

// ---------------------------------------------------------------------------
// Walking a value
// ---------------------------------------------------------------------------

/** The value at `path`, or `undefined` when the path leaves the value. */
export function valueAt(root: unknown, path: readonly LocusPathStep[]): unknown {
  let at: unknown = root;
  for (const step of path) {
    if (at === null || typeof at !== "object") return undefined;
    if (!Object.hasOwn(at, step)) return undefined;
    at = (at as Record<string, unknown>)[String(step)];
  }
  return at;
}

/** `root` with `path` replaced by `next`, structurally shared above the path.
 *  Arrays stay arrays and a variant keeps its `$tag`; a step that does not fit
 *  the carrier it lands on is refused rather than coerced, because silently
 *  turning a record into an array is how an edit destroys a neighbour. */
export function setValueAt(root: unknown, path: readonly LocusPathStep[], next: unknown): unknown {
  if (path.length === 0) return next;
  const step = path[0]!;
  const rest = path.slice(1);
  if (Array.isArray(root)) {
    if (typeof step !== "number") throw new Error(`Cannot use the field "${step}" as a list index.`);
    if (!Number.isInteger(step) || step < 0 || step >= root.length) throw new Error(`This list has no item ${step + 1} any more.`);
    const copy = [...root];
    copy[step] = setValueAt(root[step], rest, next);
    return copy;
  }
  if (root !== null && typeof root === "object") {
    if (typeof step === "number") throw new Error(`Cannot use ${step} as a field name.`);
    if (!Object.hasOwn(root, step)) throw new Error("This value no longer has the field being edited.");
    const copy: Record<string, unknown> = { ...(root as Record<string, unknown>) };
    Object.defineProperty(copy, step, { value: setValueAt((root as Record<string, unknown>)[step], rest, next),
      enumerable: true, configurable: true, writable: true });
    return copy;
  }
  throw new Error("This value no longer has the contents that were being edited.");
}

/** `root` with the child at `path` REMOVED. A list closes the gap; a record
 *  drops the key. Removing the whole value (empty path) is not something a
 *  container can do to itself, so it is refused here and left to the caller
 *  that owns the container. */
export function removeValueAt(root: unknown, path: readonly LocusPathStep[]): unknown {
  if (path.length === 0) throw new Error("A value cannot remove itself. Remove it from what holds it.");
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1]!;
  const parent = valueAt(root, parentPath);
  if (Array.isArray(parent)) {
    if (typeof last !== "number") throw new Error(`Cannot use the field "${last}" as a list index.`);
    if (!Number.isInteger(last) || last < 0 || last >= parent.length) throw new Error("This list item is no longer here.");
    return setValueAt(root, parentPath, parent.filter((_, index) => index !== last));
  }
  if (parent !== null && typeof parent === "object") {
    const copy: Record<string, unknown> = { ...(parent as Record<string, unknown>) };
    delete copy[String(last)];
    return setValueAt(root, parentPath, copy);
  }
  throw new Error("This value no longer has the contents that were being edited.");
}

/** `root` with `next` appended to the container at `path`. A list grows by
 *  one; a record cannot grow without a field name, so it refuses. */
export function appendValueAt(root: unknown, path: readonly LocusPathStep[], next: unknown): unknown {
  const container = valueAt(root, path);
  if (!Array.isArray(container)) {
    throw new Error("Only a list grows by adding an item. Edit this value to add a field.");
  }
  return setValueAt(root, path, [...container, next]);
}

// ---------------------------------------------------------------------------
// What a value CONTAINS
// ---------------------------------------------------------------------------

export type LocusChild = {
  readonly key: LocusPathStep;
  /** What to call this child on its card. */
  readonly label: string;
  readonly value: unknown;
};

/**
 * The children a scope would show if you entered this value — or `undefined`
 * when the value is a leaf and entering it would show nothing.
 *
 * A leaf is anything without an open structure to walk: scalars, and the
 * values that carry their OWN presentation (a file, an image, markup). Those
 * last have object shape, but their fields are a carrier rather than contents,
 * so offering to enter them would promise a room that is not there. It is the
 * same boundary `DataValueSurface` draws with `hasDataPreview`.
 */
export function childrenOf(value: unknown): LocusChild[] | undefined {
  if (Array.isArray(value)) {
    return value.map((child, index) => ({ key: index, label: `Item ${index + 1}`, value: child }));
  }
  if (value === null || typeof value !== "object") return undefined;
  if (hasDataPreview(value)) return undefined;
  if (isReferenceValue(value) || isLocusSetRef(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return Object.keys(value)
    .filter((key) => key !== "$tag")
    .map((key) => ({ key, label: key, value: (value as Record<string, unknown>)[key] }));
}

/** Can the user go INTO this value? */
export function isEnterable(value: unknown): boolean {
  return childrenOf(value) !== undefined;
}

/** A reference carried as a value: Fenel's `{$ref}`, or a legacy `{$pin}`.
 *
 *  Its transport fields are not children. `followLocusPath` resolves the
 *  referent through the caller's committed registry before entering it. */
export function isReferenceValue(value: unknown): value is LocusCatalogReferenceValue {
  return isLocusCatalogReference(value);
}

/** How a container describes itself on a card when it is NOT entered: what it
 *  is, and how much of it there is. A list's compact representation is its
 *  size, exactly as a folder's is. */
export function containerSummary(value: unknown): string | undefined {
  const children = childrenOf(value);
  if (!children) return undefined;
  if (Array.isArray(value)) {
    return children.length === 1 ? "1 item" : `${children.length} items`;
  }
  const tag = (value as { $tag?: unknown }).$tag;
  const name = typeof tag === "string" ? tag : "Record";
  return children.length === 1 ? `${name} — 1 field` : `${name} — ${children.length} fields`;
}

// ---------------------------------------------------------------------------
// The root scope's items
// ---------------------------------------------------------------------------

/** A data set seen from the root: one item of the top-level `List Anything`.
 *  It is a REFERENCE value — `$locus` names which row it points at — so it
 *  renders as a card like any other reference does, and entering it follows
 *  the reference. */
export type LocusSetRef = { readonly $locus: string; readonly name: string; readonly count: number };

export function isLocusSetRef(value: unknown): value is LocusSetRef {
  return !!value && typeof value === "object"
    && typeof (value as { $locus?: unknown }).$locus === "string";
}

export function locusSetRef(row: { id: string; name: string }, count: number): LocusSetRef {
  return { $locus: row.id, name: row.name, count };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** What a breadcrumb segment reads as. The caller supplies the names it knows
 *  (a data set's name, an item's caption); this decides the rest. */
export function scopeLabel(
  scope: LocusScope,
  names: {
    viewName?: (id: string) => string | undefined;
    itemName?: (viewId: string, itemId: string) => string | undefined;
  } = {},
): string {
  if (scope.kind === "root") return "All data";
  if (scope.kind === "view") return names.viewName?.(scope.viewId) ?? "Data";
  if (scope.path.length === 0) return names.itemName?.(scope.viewId, scope.itemId) ?? "Value";
  // A step taken through a pass-through is named by the step that entered it.
  const last = scope.passThrough?.includes(scope.path.length - 1) && scope.path.length > 1
    ? scope.path[scope.path.length - 2]! : scope.path[scope.path.length - 1]!;
  return typeof last === "number" ? `Item ${last + 1}` : last;
}
