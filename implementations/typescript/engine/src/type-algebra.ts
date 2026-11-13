// Identity-total type algebra.
//
// Recursive decisions live in fenel/modules/engine/type-algebra.fenel. This
// module is a narrow B3 surface over that body. FieldKey is the only identity;
// FieldDef.name remains the current readable/source/wire projection.

import { engineRequire } from "./engine-require";
import type {
  FenelType,
  FieldDef,
  FieldKey,
  IdentifiedFieldDef,
} from "./types";
import type { RefResolve } from "./set-algebra";
import {
  dispatchedFreezeTypeFields,
  dispatchedPickType,
  dispatchedOmitType,
  dispatchedExtendType,
  dispatchedMergeType,
  dispatchedRenameType,
  dispatchedResolveTypeFieldPaths,
  dispatchedTupleToRecord,
  dispatchedRecordToTuple,
  dispatchedUntaggedToVariant,
  dispatchedThawType,
  type ContainmentDispatchOptions,
} from "./engine-bodies-dispatch";

export type AlgebraField = IdentifiedFieldDef;
export type FieldKeyPath = readonly FieldKey[];

export type FieldWrite =
  | {
      readonly $tag: "PreserveField";
      readonly path: FieldKeyPath;
      readonly field: AlgebraField;
    }
  | {
      readonly $tag: "ReuseField";
      readonly path: FieldKeyPath;
      readonly field: AlgebraField;
    }
  | {
      readonly $tag: "MintField";
      readonly path: FieldKeyPath;
      readonly field: AlgebraField;
    }
  | {
      readonly $tag: "NeedsMint";
      readonly path: FieldKeyPath;
      readonly draft: FieldDef;
    };

export type FieldCreationIntent =
  | {
      readonly $tag: "ReuseField";
      readonly field: AlgebraField;
    }
  | {
      readonly $tag: "MintField";
      readonly field: AlgebraField;
    }
  | {
      readonly $tag: "NeedsMint";
      readonly draft: FieldDef;
    };

export type FieldWireProjection = {
  readonly key: FieldKey;
  readonly wireName: string;
};

export type UntaggedVariantCandidate = {
  readonly type: FenelType;
  readonly payload: FieldCreationIntent;
};

export function pickType(
  type: FenelType,
  paths: readonly FieldKeyPath[],
): FenelType {
  return dispatchedPickType(type, paths);
}

export function omitType(
  type: FenelType,
  paths: readonly FieldKeyPath[],
): FenelType {
  return dispatchedOmitType(type, paths);
}

/** Explicit readable boundary: resolve current names once to key paths. */
export function resolveTypeFieldPaths(
  type: FenelType,
  wirePaths: readonly string[],
): FieldKeyPath[] {
  return dispatchedResolveTypeFieldPaths(type, wirePaths);
}

export function pickTypeByWirePaths(
  type: FenelType,
  wirePaths: readonly string[],
): FenelType {
  return pickType(type, resolveTypeFieldPaths(type, wirePaths));
}

export function omitTypeByWirePaths(
  type: FenelType,
  wirePaths: readonly string[],
): FenelType {
  return omitType(type, resolveTypeFieldPaths(type, wirePaths));
}

/** Writes must state preserve, reuse, supplied mint, or NeedsMint explicitly. */
export function extendType(
  type: FenelType,
  writes: readonly FieldWrite[],
): FenelType {
  return dispatchedExtendType(type, writes);
}

export function mergeType(left: FenelType, right: FenelType): FenelType {
  return dispatchedMergeType(left, right);
}

/** Rename only the current projection; the selected FieldKey is preserved. */
export function renameType(
  type: FenelType,
  path: FieldKeyPath,
  wireName: string,
): FenelType {
  return dispatchedRenameType(type, path, wireName);
}

export function isDisjointType(
  a: FenelType,
  b: FenelType,
  options?: ContainmentDispatchOptions,
): boolean {
  const { dispatchedDisjointType } = engineRequire(
    "engine-bodies-dispatch",
  ) as typeof import("./engine-bodies-dispatch");
  const result = dispatchedDisjointType(a, b, options);
  return result.$tag === "Just" ? result._0 : false;
}

/**
 * Untagged-union sugar creates one payload occurrence per resulting case, so
 * each candidate supplies explicit reuse/mint intent and an identity-total
 * payload field. The body still owns disjointness and case-name selection.
 */
export function untaggedToVariant(
  candidates: readonly UntaggedVariantCandidate[],
  resolve?: RefResolve,
  options?: ContainmentDispatchOptions,
): { ok: FenelType } | { err: string } {
  return dispatchedUntaggedToVariant(candidates, resolve, options);
}

/** Snapshot an ordered identity-aware entry list into a record. */
export function freeze(entries: readonly AlgebraField[]): FenelType {
  return { $record: { fields: dispatchedFreezeTypeFields(entries) } };
}

/** Open a record as ordered identity-aware entries, never a name-keyed Map. */
export function thaw(type: FenelType): AlgebraField[] {
  return dispatchedThawType(type);
}

export function tupleToRecord(type: FenelType): FenelType {
  return dispatchedTupleToRecord(type);
}

export function recordToTuple(type: FenelType): FenelType {
  return dispatchedRecordToTuple(type);
}
