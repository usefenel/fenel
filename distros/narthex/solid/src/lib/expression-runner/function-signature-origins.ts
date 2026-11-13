// Where each slot of a function's signature got its type: written in the
// source ("declared") or left to inference ("inferred"). The engine records
// this per slot on the function's signature declaration (types.ts,
// SlotDeclaration: Authored | Inferred | Absent); this only reads it. Whether
// the engine settled a type is the reader's type label's business: an
// unsettled slot shows no type at all, so "inferred" never stands alone.

import type { FunctionSignatureDeclaration, SlotDeclaration } from "@fenel/engine/types";

export type FunctionSlotOrigin = "declared" | "inferred";
export type FunctionSignatureOrigins = { readonly params: readonly (FunctionSlotOrigin | undefined)[]; readonly returns?: FunctionSlotOrigin };

function slotOrigin(slot: SlotDeclaration | undefined): FunctionSlotOrigin | undefined {
  if (!slot) return undefined;
  return slot.$tag === "Authored" ? "declared" : "inferred";
}

/** Undefined when the function carries no declaration (its origin is unknown). */
export function functionSignatureOrigins(declaration: Pick<FunctionSignatureDeclaration, "params" | "returns"> | undefined): FunctionSignatureOrigins | undefined {
  if (!declaration) return undefined;
  return { params: declaration.params.map(slotOrigin), returns: slotOrigin(declaration.returns) };
}
