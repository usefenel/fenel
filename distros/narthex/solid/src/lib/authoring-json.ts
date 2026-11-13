import type { FieldOwnerMutation, FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { assertJsonAuthoringValue } from "@fenel/engine/set-marker";
import { functionDefinitionToJsonWire, typeDefinitionToJsonWire, fieldDefinitionSnapshotToJsonWire } from "@fenel/engine/authoring/expression";
import { functionDefinitionFromJsonWire, viewDefinitionFromJsonWire } from "@fenel/engine/authoring/expression";
import type { FenelFunction, TypeView } from "@fenel/engine/types";
export { functionDefinitionToJsonWire, typeDefinitionToJsonWire };
export { fieldDefinitionSnapshotFromJsonWire, ownerDefinitionFromJsonWire, typeDefinitionFromJsonWire, viewDefinitionToJsonWire } from "@fenel/engine/authoring/expression";
export { fenelTypeToJsonWire } from "@fenel/engine/set-marker";

/** Source-owned rows are display metadata; executable source is hydrated from
 * its immutable module document. Ordinary API function rows carry JSON AST. */
export function functionRowFromJsonWire<T extends { function?: FenelFunction; sourceRegistryId?: string | null }>(row: T): T {
  return !row || row.sourceRegistryId || !row.function ? row : { ...row, function: functionDefinitionFromJsonWire(row.function) };
}

export function viewRowFromJsonWire<T extends { view?: TypeView }>(row: T): T {
  return !row?.view ? row : { ...row, view: viewDefinitionFromJsonWire(row.view) };
}

export function definitionBundleToJsonWire<T extends { ownerMutations: FieldOwnerMutation[]; expectedSnapshot?: FieldPersistenceSnapshot }>(request: T): unknown {
  return { ...request, ...(request.expectedSnapshot === undefined ? {} : { expectedSnapshot: fieldDefinitionSnapshotToJsonWire(request.expectedSnapshot) }),
    ownerMutations: request.ownerMutations.map((mutation) => mutation.kind === "delete" ? mutation : {
    ...mutation,
    owner: { ...mutation.owner, definition: mutation.owner.kind === "type"
      ? typeDefinitionToJsonWire(mutation.owner.definition)
      : functionDefinitionToJsonWire(mutation.owner.definition) },
  }) };
}

/** A missed typed seam must fail visibly, never turn Infinity/NaN into null. */
export function stringifyAuthoringJson(value: unknown): string {
  if (value === undefined) throw new TypeError("Cannot save an absent value.");
  assertJsonAuthoringValue(value);
  return JSON.stringify(value);
}
