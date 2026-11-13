// The name a call node shows (Nov 12, Rom: "solve is a human readable label,
// not just a codable name"). A function shows its catalogue entry's label
// (`functionDisplayName`); a constructor shows its own Labelable, keyed by its
// bare tag, the same lookup its glyph and its read card use
// (`useItemPresentation().name`: a Local reader answers from its worker's
// thumbnail packet, any other reader from its own frame through
// `constructor-label.ts`). Without a label the code name is shown as written,
// in the code face. No per-type fact and no re-casing live here.
// Solid/browser renderer allowance — reader adapter, same kind as item-glyph.tsx.
import { codeName, pickDisplayName, type DisplayName } from "../display-name";
import { constructorShortName, displayCallableHandle, functionDisplayName, type CallableNameEntry } from "./callable-names";

export type CallNodeNameReader = { name: (value: unknown) => string | undefined };

// One bare value per tag: a Local reader keys its packets by object identity,
// so a fresh object per render would ask its worker again every time.
const bareConstructors = new Map<string, { readonly $tag: string }>();
function bareConstructor(tag: string): { readonly $tag: string } {
  let value = bareConstructors.get(tag);
  if (!value) bareConstructors.set(tag, value = Object.freeze({ $tag: tag }));
  return value;
}

/** A constructor's own label in this reader, or undefined without one. */
export function constructorCallLabel(entry: CallableNameEntry, reader: CallNodeNameReader | undefined): string | undefined {
  if (entry.kind !== "constructor" || !reader) return undefined;
  const tag = constructorShortName(entry);
  if (!tag) return undefined;
  let label: string | undefined;
  try { label = reader.name(bareConstructor(tag)); } catch { return undefined; }
  const shown = pickDisplayName(label, tag);
  return shown && !shown.code ? shown.text : undefined;
}

/** The call node's shown name: a label as text, a code name in the code face. */
export function callNodeDisplayName(entry: CallableNameEntry | undefined, fnId: string,
  reader: CallNodeNameReader | undefined, counts?: ReadonlyMap<string, number>): DisplayName {
  if (!entry) return codeName(displayCallableHandle(fnId));
  const label = constructorCallLabel(entry, reader);
  return label !== undefined ? { text: label, code: false } : functionDisplayName(entry, counts);
}
