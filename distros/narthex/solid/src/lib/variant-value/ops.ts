// ---------------------------------------------------------------------------
// Mutation ops — pure functions over recursive ADT values, addressed by path
//
// Used by VariantValueEditor (the generic UI) and by any specialized editor
// (e.g. MarkupEditor) that wants to expose a different surface UI but share
// the underlying mutations. Same value, same operations, two views.
//
// A Path is a sequence of field-name strings and list-index numbers,
// interpreted against the runtime variant-value convention:
//   { $tag: "Name", field1: ..., field2: [...] }
//
// Example: path ["children", 2, "tag"] addresses the `tag` field of the 3rd
// child in the current variant value.
// ---------------------------------------------------------------------------

import { structuralView, caseTag, type StructuralView } from "@fenel/engine/structural";
import { unfold } from "@fenel/engine/set-algebra";
import type { FenelType } from "@fenel/engine/types";
import { peelMaybeForAuthoring as peelMaybe, peelListForAuthoring as peelList, peelResultForAuthoring as peelResult } from "@fenel/engine/authoring/type";
import { defaultValueForAuthoring as defaultValueFor, resolveValueType, variantValueDiscriminator } from "@fenel/engine/authoring/type";
import { For } from "solid-js";
export { defaultValueForAuthoring as defaultValueFor, nativeValueTypeName, resolveValueType } from "@fenel/engine/authoring/type";

export type Path = ReadonlyArray<string | number>;

// ---------------------------------------------------------------------------
// Path navigation — pure get / set
// ---------------------------------------------------------------------------

export function getAtPath(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || cur === null) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export function setAtPath<T>(root: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  return updateAt(root, path, 0, next) as T;
}

function updateAt(node: unknown, path: Path, depth: number, next: unknown): unknown {
  if (depth === path.length) return next;
  const seg = path[depth]!;
  if (typeof seg === "number") {
    const arr = Array.isArray(node) ? node.slice() : [];
    arr[seg] = updateAt(arr[seg], path, depth + 1, next);
    return arr;
  }
  const obj = (typeof node === "object" && node !== null)
    ? { ...(node as Record<string, unknown>) }
    : {};
  obj[seg] = updateAt(obj[seg], path, depth + 1, next);
  return obj;
}

// ---------------------------------------------------------------------------
// List ops — when the path addresses a list-typed value
// ---------------------------------------------------------------------------

export function insertAtIndex<T>(root: T, listPath: Path, item: unknown, index?: number): T {
  const list = getAtPath(root, listPath);
  const arr = Array.isArray(list) ? list.slice() : [];
  const at = index === undefined || index > arr.length ? arr.length : Math.max(0, index);
  arr.splice(at, 0, item);
  return setAtPath(root, listPath, arr);
}

export function removeAtIndex<T>(root: T, listPath: Path, index: number): T {
  const list = getAtPath(root, listPath);
  if (!Array.isArray(list)) return root;
  const arr = list.slice();
  arr.splice(index, 1);
  return setAtPath(root, listPath, arr);
}

export function moveItem<T>(root: T, listPath: Path, from: number, to: number): T {
  const list = getAtPath(root, listPath);
  if (!Array.isArray(list)) return root;
  const arr = list.slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return root;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return setAtPath(root, listPath, arr);
}

// ---------------------------------------------------------------------------
// Variant ops — change constructor, creating defaults for new fields
// ---------------------------------------------------------------------------

/**
 * Switch the variant case at `path`, generating default field values for the
 * new case from the surrounding type. Preserves field values whose name and
 * shape match between old and new cases (e.g. switching between two Element-
 * shaped cases that share an `attrs` field).
 */
export function setCase<T>(root: T, type: FenelType, path: Path, caseName: string): T {
  const view = resolveViewAt(type, root, path);
  if (!view) return root;
  const target = view.cases.find((c) => c.name === caseName);
  if (!target) return root;

  const cur = getAtPath(root, path) as Record<string, unknown> | null | undefined;
  const next: Record<string, unknown> = { [view.discriminator]: caseName };
  for (const f of target.fields) {
    const carryOver = cur && typeof cur === "object" && f.name in cur
      ? (cur as Record<string, unknown>)[f.name]
      : undefined;
    next[f.name] = carryOver !== undefined
      ? carryOver
      : (f.isRecursive ? defaultValueFor(view.selfRef) : defaultValueFor(f.type));
  }
  return setAtPath(root, path, next);
}

/**
 * Resolve the structural view that applies at `path`. For a top-level variant
 * type, this is just structuralView(type) — but if the path drills through
 * recursive fields, the view stays the same μ. For paths into non-variant
 * positions (e.g. inside a record) returns null.
 */
function resolveViewAt(type: FenelType, root: unknown, path: Path): (StructuralView & { discriminator: string }) | null {
  let currentType = type;
  let currentValue = root;
  for (const segment of path) {
    let current = resolveValueType(currentType);
    const list = peelList(current);
    let child: FenelType | undefined;
    if (list && typeof segment === "number") child = list.elem;
    else {
      const view = structuralView(current);
      if (view) {
        const tag = currentValue && typeof currentValue === "object" ? (currentValue as Record<string, unknown>)[variantValueDiscriminator(current)] ?? caseTag(currentValue as Record<string, unknown>) : undefined;
        const field = view.cases.find((entry) => entry.name === tag)?.fields.find((field) => field.name === segment);
        if (field) child = field.isRecursive ? current : field.type;
      } else {
        if ("$opaque" in current && current.$opaque.pure) current = current.$opaque.pure;
        if ("$mu" in current) current = unfold(current);
        if ("$record" in current) child = current.$record.fields.find((field) => field.name === segment)?.type;
        if ("$tuple" in current && typeof segment === "number") child = current.$tuple[segment];
        if ("$map" in current && typeof segment === "string") child = current.$map.values;
      }
    }
    if (!child) return null;
    currentType = child;
    currentValue = getAtPath(currentValue, [segment]);
  }
  const view = structuralView(resolveValueType(currentType));
  return view ? { ...view, discriminator: variantValueDiscriminator(currentType) } : null;
}
