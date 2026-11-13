// ---------------------------------------------------------------------------
// type-traversal.ts — thin shim around the Fenel-bodied port.
//
// Phase 7a (ts-elimination) — the pure recursive helpers
// (typeReferences / fieldsReferencing / collectTypeNames /
// functionValueTypes / functionUsages) moved to a Fenel body at
// `fenel/modules/engine/type-traversal.fenel`. This file now exposes
// the original public API unchanged; the implementations dispatch
// through `dispatched…` wrappers in engine-bodies-dispatch.ts.
//
// `walkType` retains its higher-order host callback API, but the ordered node
// plan and all structural recursion are Fenel-owned. `entityUsages` retains
// only the TS-side systemEntities roster iteration.
//
// See the body file for the full per-function comment block + the
// design rationale (the descriptor-safe shared TraversalType ADT, including
// canonical SetExpr refinement views whose phantom semantics stay in Fenel).
// ---------------------------------------------------------------------------

import type { FenelType, FenelFunction } from "./types";
import { systemEntities } from "./system-entities";
import { engineRequire } from "./engine-require";
import {
  dispatchedCollectTypeNames,
  dispatchedTypeReferences,
  dispatchedFieldsReferencing,
  dispatchedWalkTypePlan,
  dispatchedFunctionValueTypes,
  dispatchedFunctionUsages,
  type DispatchedFieldUsageSlot,
} from "./engine-bodies-dispatch";

/** Identity-bearing field/parameter reflection result. `wireName` is the
 * current display/source projection; consumers retain `key` as identity. */
export type FieldUsageSlot = DispatchedFieldUsageSlot;

/** Explicit presentation adapter. It is intentionally named as a wire
 * projection so a bare string list cannot masquerade as semantic identity. */
export function fieldUsageWireNames(
  slots: readonly FieldUsageSlot[],
): string[] {
  return slots.map((slot) => slot.wireName);
}

/** Visit every FenelType node reachable from `t`. The visitor returns
 *  `true` to stop the traversal (e.g. once a hit is found).
 *
 *  Fenel owns the pre-order structural plan. This adapter performs only the
 *  irreducible host callback invocation and its early-stop projection. */
export function walkType(
  t: FenelType,
  visit: (node: FenelType) => boolean | void,
): boolean {
  for (const node of dispatchedWalkTypePlan(t)) {
    if (visit(node) === true) return true;
  }
  return false;
}

/** Does the type tree at `t` reference `targetName` — either as a `$named`
 *  atom or as the phantom of a `$tagged Id<targetName>`? */
export function typeReferences(t: FenelType, targetName: string): boolean {
  return dispatchedTypeReferences(t, targetName);
}

/** Field-level reference: returns identity-bearing matching field slots of an
 * entity-shaped record type. The input must already be identity-total. */
export function fieldsReferencing(type: FenelType, targetName: string): FieldUsageSlot[] {
  return dispatchedFieldsReferencing(type, targetName);
}

/** Collect every `$named` reference and `$tagged` phantom name reachable in
 *  the type tree. */
export function collectTypeNames(t: FenelType): string[] {
  return dispatchedCollectTypeNames(t);
}

/** Compute the value-types list for a function call: the union of names
 *  reachable from any param's type and from the return type. Returns an
 *  empty array if `fn` is undefined. */
export function functionValueTypes(fn: FenelFunction | undefined): string[] {
  return dispatchedFunctionValueTypes(fn);
}

// ---------------------------------------------------------------------------
// Higher-level: aggregate usage report
// ---------------------------------------------------------------------------

export type EntityUsage = { entity: string; fields: FieldUsageSlot[] };
export type FunctionUsageRole = "param" | "return";
export type FunctionUsage = {
  id: string;
  asParam: FieldUsageSlot[];
  asReturn: boolean;
  fn: FenelFunction;
  triggered?: boolean;
};

export type Usages = {
  entities: EntityUsage[];
  functions: FunctionUsage[];
};

/** Walk `systemEntities` to find entity types whose fields reference `targetName`.
 *  User-defined types must be added by the caller (they aren't in systemEntities).
 *
 *  Stays TS — iterates the TS-side roster, but reads every definition through
 *  the cached identified system registry. Per-field reference detection
 *  delegates to the Fenel-bodied `fieldsReferencing`. */
export function entityUsages(targetName: string): EntityUsage[] {
  // Lazy lookup avoids pulling the full repository registry into the browser
  // module-init path. Raw `systemEntities` definitions are roster data only:
  // reopening their types here would erase owner-qualified field keys.
  const { getSystemRegistry } = engineRequire("system-registry") as typeof import("./system-registry");
  const registry = getSystemRegistry();
  const out: EntityUsage[] = [];
  for (const ent of systemEntities) {
    if (ent.id === targetName) continue;
    if (!ent.type) continue;
    const identified = registry.getIdentifiedEntity(ent.id);
    if (identified?.type === undefined) {
      throw new Error(`entityUsages: missing identified system entity ${ent.id}`);
    }
    const matched = fieldsReferencing(identified.type, targetName);
    if (matched.length) out.push({ entity: ent.id, fields: matched });
  }
  return out;
}

/** Scan a list of functions for ones whose signature references `targetName`. */
export function functionUsages(
  fns: { fn: FenelFunction; triggered?: boolean }[],
  targetName: string,
): FunctionUsage[] {
  return dispatchedFunctionUsages(fns, targetName);
}

