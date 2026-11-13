// Identity-total field algebra.
//
// All recursive semantics are implemented by engine:typeAlgebraOperate in
// fenel/modules/engine/type-algebra.fenel. These functions only marshal public
// plans to that body. Names are readable/current-wire projections, never keys.

import type { FieldKey, SetExpr } from "./types";
import type {
  AlgebraField,
  FieldCreationIntent,
  FieldKeyPath,
  FieldWireProjection,
  FieldWrite,
} from "./type-algebra";
import {
  dispatchedFieldAlgebraConstrain,
  dispatchedFieldAlgebraFieldPaths,
  dispatchedFieldAlgebraFlatten,
  dispatchedFieldAlgebraGetField,
  dispatchedFieldAlgebraMerge,
  dispatchedFieldAlgebraNest,
  dispatchedFieldAlgebraOmit,
  dispatchedFieldAlgebraPartial,
  dispatchedFieldAlgebraPick,
  dispatchedFieldAlgebraRename,
  dispatchedFieldAlgebraReorder,
  dispatchedFieldAlgebraRequired,
  dispatchedFieldAlgebraWrite,
  dispatchedResolveTypeFieldPaths,
} from "./engine-bodies-dispatch";

export type {
  AlgebraField,
  FieldCreationIntent,
  FieldKeyPath,
  FieldWireProjection,
  FieldWrite,
} from "./type-algebra";

export function resolveFieldPaths(
  fields: readonly AlgebraField[],
  wirePaths: readonly string[],
): FieldKeyPath[] {
  return dispatchedResolveTypeFieldPaths(
    { $record: { fields: [...fields] } },
    wirePaths,
  );
}

export function pick(
  fields: readonly AlgebraField[],
  paths: readonly FieldKeyPath[],
  opts?: { readonly flatten?: boolean },
): AlgebraField[] {
  return dispatchedFieldAlgebraPick(fields, paths, opts?.flatten === true);
}

export function pickByWirePaths(
  fields: readonly AlgebraField[],
  wirePaths: readonly string[],
  opts?: { readonly flatten?: boolean },
): AlgebraField[] {
  return pick(fields, resolveFieldPaths(fields, wirePaths), opts);
}

export function omit(
  fields: readonly AlgebraField[],
  paths: readonly FieldKeyPath[],
): AlgebraField[] {
  return dispatchedFieldAlgebraOmit(fields, paths);
}

export function omitByWirePaths(
  fields: readonly AlgebraField[],
  wirePaths: readonly string[],
): AlgebraField[] {
  return omit(fields, resolveFieldPaths(fields, wirePaths));
}

export function partial(
  fields: readonly AlgebraField[],
): AlgebraField[] {
  return dispatchedFieldAlgebraPartial(fields);
}

export function required(
  fields: readonly AlgebraField[],
): AlgebraField[] {
  return dispatchedFieldAlgebraRequired(fields);
}

export function flatten(
  fields: readonly AlgebraField[],
  recordFieldKey: FieldKey,
): AlgebraField[] {
  return dispatchedFieldAlgebraFlatten(fields, recordFieldKey, []);
}

/**
 * Flatten with an explicit authoring-approved wire projection plan. The old
 * separator/name concatenation API is intentionally retired: it renamed
 * semantic occurrences without being able to state field-authoring intent.
 */
export function flattenPrefixed(
  fields: readonly AlgebraField[],
  recordFieldKey: FieldKey,
  projections: readonly FieldWireProjection[],
): AlgebraField[] {
  return dispatchedFieldAlgebraFlatten(
    fields,
    recordFieldKey,
    projections,
  );
}

/**
 * Nest selected semantic axes under an explicitly supplied reuse/mint parent.
 * NeedsMint is a first-class refusal; pure algebra never creates UUID entropy.
 */
export function nest(
  fields: readonly AlgebraField[],
  fieldKeys: readonly FieldKey[],
  parent: FieldCreationIntent,
): AlgebraField[] {
  return dispatchedFieldAlgebraNest(fields, fieldKeys, parent);
}

export function merge(
  left: readonly AlgebraField[],
  right: readonly AlgebraField[],
): AlgebraField[] {
  return dispatchedFieldAlgebraMerge(left, right);
}

/** Rename the current projection selected by a key path; key is preserved. */
export function rename(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
  wireName: string,
): AlgebraField[] {
  return dispatchedFieldAlgebraRename(fields, path, wireName);
}

/**
 * Named keys move intact. Positional fields are reassigned to the result list
 * ordinal and receive its canonical _n projection by the Fenel body.
 */
export function reorder(
  fields: readonly AlgebraField[],
  order: readonly FieldKey[],
): AlgebraField[] {
  return dispatchedFieldAlgebraReorder(fields, order);
}

export function constrain(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
  set: SetExpr,
): AlgebraField[] {
  return dispatchedFieldAlgebraConstrain(fields, path, set);
}

/**
 * Explicit replacement/write plan. This replaces the callback-based legacy
 * map operation, whose recursive TS callback could not state identity intent.
 */
export function mapFields(
  fields: readonly AlgebraField[],
  writes: readonly FieldWrite[],
): AlgebraField[] {
  return dispatchedFieldAlgebraWrite(fields, writes);
}

/** Key-path filter; predicates over names are intentionally not semantic APIs. */
export function filterFields(
  fields: readonly AlgebraField[],
  paths: readonly FieldKeyPath[],
): AlgebraField[] {
  return dispatchedFieldAlgebraPick(fields, paths, false);
}

export function getField(
  fields: readonly AlgebraField[],
  path: FieldKeyPath,
): AlgebraField | undefined {
  return dispatchedFieldAlgebraGetField(fields, path);
}

export function getFieldByWirePath(
  fields: readonly AlgebraField[],
  wirePath: string,
): AlgebraField | undefined {
  const [path] = resolveFieldPaths(fields, [wirePath]);
  return path === undefined ? undefined : getField(fields, path);
}

/** Return semantic identity paths, replacing the legacy dotted name list. */
export function fieldIds(
  fields: readonly AlgebraField[],
  opts?: { readonly deep?: boolean },
): FieldKeyPath[] {
  return dispatchedFieldAlgebraFieldPaths(fields, opts?.deep === true);
}
