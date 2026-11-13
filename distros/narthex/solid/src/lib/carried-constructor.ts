// The constructor a tagged value carries, read off its declared type. The
// typed reader (layout-renderer/TypedReadValue.tsx) knew the fields of a record
// and of a type with ONE constructor (locus-table-columns.ts,
// singleConstructorFields); a value of a type with several constructors that
// holds fields (`SetExpr`'s `SeEnum values: List Any`) had none, so it fell to
// the untyped preview, which prints raw tags (Nov 12: "SeEnum", "CocosNucifera"
// on "Living things by the food they give"). Its own case has declared fields.
// Solid/browser renderer allowance — reader adapter, same kind as locus-table-columns.ts.

import type { FenelType, FieldDef } from "@fenel/engine/types";
import { peelToVariantType, type AuthoringTypeResolver } from "@fenel/engine/authoring/expression";

/** The case the value's own `$tag` names in its type, with that case's
 * declared fields. Undefined for a case without fields, a case the type does
 * not have, or a value that is not a tagged record. */
export function carriedConstructor(type: FenelType | undefined, value: unknown,
  resolver: AuthoringTypeResolver): { tag: string; fields: FieldDef[] } | undefined {
  if (!type || !value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$tag");
  const tag = descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
  if (!tag) return undefined;
  const fields = peelToVariantType(type, resolver)?.cases.find(row => row.name === tag)?.fields;
  return fields && fields.length > 0 ? { tag, fields } : undefined;
}
