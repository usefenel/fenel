import type { FenelType } from "../types";
import { typeCode, typePhrase } from "./expression-authoring";
import { detectTypeKind, TYPE_KIND_LABELS, typeFieldOccurrences } from "./type-authoring";
import { pureValueType, resolveValueType } from "./value-authoring";
import { dispatchedTypeDataPreviewDetails } from "../engine-bodies-dispatch";
import type { EvaluateContext } from "../json-logic";

export type LocusTypeDescription = {
  type: FenelType;
  phrase: string;
  code: string;
  kind: ReturnType<typeof detectTypeKind>;
  kindLabel: string;
  /** Declaration facts from this exact reader, separate from the named type. */
  previewShape?: FenelType;
  previewDetails?: ReturnType<typeof dispatchedTypeDataPreviewDetails>;
};

/** B3 read transport: carry the existing formatter's inert results beside
 * the exact authorized type descriptions. No value is evaluated here and
 * the early browser needs no second type recognizer or formatting algorithm. */
export function projectLocusTypeDescriptions(root: {
  type?: FenelType;
  items?: readonly { valueType?: FenelType }[];
  lists?: readonly { valueType?: FenelType; view: { items: readonly { valueType?: FenelType }[] } }[];
}, resolveName?: (handle: string) => string, resolveCode: ((handle: string) => string) | undefined = resolveName,
resolveType: (handle: string) => FenelType | undefined = () => undefined, caller?: EvaluateContext): LocusTypeDescription[] {
  const descriptions = new Map<string, LocusTypeDescription>();
  const describe = (type: FenelType): LocusTypeDescription => {
    const kind = detectTypeKind(type);
    const declared = "$ref" in type ? resolveType(type.$ref) ?? type : type;
    const resolved = resolveValueType(type, resolveType);
    const previewShape = pureValueType(resolved, resolveType) ?? resolved;
    const structure = dispatchedTypeDataPreviewDetails(previewShape, caller);
    const declaration = dispatchedTypeDataPreviewDetails(declared, caller);
    return { type, phrase: typePhrase(type, resolveName), code: typeCode(type, resolveCode),
      kind, kindLabel: kind ? TYPE_KIND_LABELS[kind] : "", previewShape,
      previewDetails: { ...structure, dependent: declaration.dependent } };
  };
  const add = (type: FenelType | undefined) => {
    if (!type || descriptions.has(JSON.stringify(type))) return;
    descriptions.set(JSON.stringify(type), describe(type));
    for (const field of typeFieldOccurrences(type)) {
      if (!descriptions.has(JSON.stringify(field.type))) {
        descriptions.set(JSON.stringify(field.type), describe(field.type));
      }
    }
  };
  add(root.type);
  for (const item of root.items ?? []) add(item.valueType);
  for (const list of root.lists ?? []) {
    add(list.valueType);
    for (const item of list.view.items) add(item.valueType);
  }
  return [...descriptions.values()];
}
