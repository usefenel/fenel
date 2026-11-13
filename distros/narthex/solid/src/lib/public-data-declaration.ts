import type { FenelType, TypeScheme } from "@fenel/engine/types";

// Public source data (public-locus-data.ts) types each data field by its source
// declaration's raw `returns`. That raw type spells nested named types bare
// (`List Ingredients`) without the declaration's owner sidecars, and the
// existing result judgment refuses an owned result against such a requirement
// by design (creation-validation.test.ts, nested nominal returns). Record which
// declaration each exact type object came from, so a reader checks the data
// against that declaration's checked scheme instead. No type comparison here.

const declarations = new WeakMap<object, string | null>();

/** The exact `returns` object of a zero-argument source declaration, placed as
 * a public data field's type. One object claimed by two declarations is
 * ambiguous and answers nothing. */
export function recordPublicDataDeclaration(type: FenelType, functionId: string): void {
  const known = declarations.get(type);
  declarations.set(type, known === undefined || known === functionId ? functionId : null);
}

export type PublicDataDeclarationEntry = { readonly signatureOutcome?: { readonly $tag: string }; readonly scheme?: TypeScheme };

/** The checked result scheme of the declaration this exact type object came
 * from. Any other type, an equal copy included, an ambiguous record or an
 * unsolved signature answers undefined: the caller keeps its existing check. */
export function publicDataDeclaredScheme(type: FenelType | undefined,
  getFunctionEntry: ((id: string) => PublicDataDeclarationEntry | undefined) | undefined,
  projectReturns: (scheme: TypeScheme) => TypeScheme | undefined): TypeScheme | undefined {
  if (type === null || typeof type !== "object") return undefined;
  const id = declarations.get(type);
  if (!id) return undefined;
  const entry = getFunctionEntry?.(id);
  if (entry?.signatureOutcome?.$tag !== "Solved" || entry.scheme === undefined) return undefined;
  return projectReturns(entry.scheme);
}
