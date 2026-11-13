import { valueAt, type LocusPathStep } from "./locus-scope";
import { readLocusCatalogReference, type LocusCatalogReference } from "./locus-catalog-reference";

export type LocusReference = LocusCatalogReference;
export type LocusReferent = { readonly value: unknown; readonly kind?: string };

/** Resolve only along the chosen path. A reference keeps its incoming route:
 * going up returns to the list that contained it, not to an invented global
 * parent. Resolution is supplied by the caller's account-scoped registry. */
export function followLocusPath(
  root: unknown,
  path: readonly LocusPathStep[],
  resolve: (reference: LocusReference) => LocusReferent | undefined,
): { value: unknown; followed: boolean; references: readonly LocusReference[] } {
  let value = root;
  let callable = false;
  const references: LocusReference[] = [];
  const follow = () => {
    const seen = new Set<string>();
    for (let reference = readLocusCatalogReference(value); reference; reference = readLocusCatalogReference(value)) {
      // Both old and new syntax name the same handle. Alternating their
      // encodings cannot evade cycle detection.
      const key = reference.id;
      if (seen.has(key)) throw new Error("This reference leads back to itself.");
      seen.add(key);
      const target = resolve(reference);
      if (!target) throw new Error(`The referenced ${reference.kind ?? "value"} is not available in this account.`);
      references.push(reference);
      // A callable is expression data with bound parameters, not the record
      // the registry uses to store its body, identity and signature.
      if (target.kind === "function") { callable = true; break; }
      value = target.value;
    }
  };
  follow();
  for (const step of path) {
    if (callable) throw new Error("A function has no data fields. Open its expression to explore its body.");
    value = valueAt(value, [step]);
    follow();
  }
  return { value, followed: references.length > 0, references };
}
