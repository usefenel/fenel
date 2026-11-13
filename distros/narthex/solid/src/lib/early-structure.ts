// A28 (Nov 12): before a reader is prepared, the early page shows a value with
// the plain structural reader (DataPreview -> StructuralReadValue). That reader
// shows text, numbers, lists and media well; for a constructor's record it
// prints the constructor tag and every field name as code (`LifeClassification`,
// `crossSets`, `SeEnum`), which is not what the typed view will show a minute
// later. This says, by SHAPE only, whether the plain reader would print such a
// record: then the early page shows a quiet waiting state until the typed view
// arrives. No type or value name is consulted.
// Solid/browser renderer allowance — presentation adapter, same kind as collection-chips.ts.
import { hasDataPreview } from "./data-transfer/data-preview-shape";
import { isIdentityText } from "./readable-ids";

/** True when the plain structural reader would print `value` as a constructor
 * tag in the code face over code-named field rows. */
export function plainReaderPrintsConstructorTag(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (hasDataPreview(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$tag");
  const tag = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof tag !== "string" || tag === "" || isIdentityText(tag) || tag === "Just" || tag === "Nothing") return false;
  return Object.keys(value).some(key => !key.startsWith("$"));
}
