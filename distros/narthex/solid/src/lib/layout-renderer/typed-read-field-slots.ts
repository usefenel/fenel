// A typed read's record field slots (B4 F1): the stored wire key and the shown
// name of each declared field, from its Codeable and Labelable field
// representations. Shared by the page renderer (Account and public readers)
// and the Local reader's worker packet (`projectReaderValueReadInSession`), so
// a Local reader shows the worker's answer of this same code.
import type { FieldDef } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { codeName, displayNameItemFields, humanName, pickDisplayName, valueCardLabel, type DisplayName } from "../display-name";

/** A field's shown name. A Labelable label wins (as human text, even when it
 * equals the code name). The Codeable name is shown as code only when that
 * label is absent. A missing facet keeps the
 * declaration's wire name, which is the same string the value is stored under. */
function fieldMethod(field: FieldDef, registry: ModuleRegistry | undefined, className: string, method: string): unknown {
  const id = field.key?.$tag === "NamedField" ? field.key.ref.$ref : undefined;
  const methods = id && registry ? registry.getFieldRepresentation(className, id)?.methods : undefined;
  return methods && typeof methods === "object" ? (methods as Record<string, unknown>)[method] : undefined;
}

export function fieldWireKey(field: FieldDef, registry: ModuleRegistry | undefined): string {
  const code = fieldMethod(field, registry, "Codeable", "codeName");
  return typeof code === "string" && code.length > 0 ? code : field.name;
}

export function fieldSlotName(field: FieldDef, registry: ModuleRegistry | undefined): DisplayName {
  // An authored Labelable facet is a label even when its text equals the code
  // name: a person who typed "amount" as a field's name gave a label, and the
  // code name was derived from it (pickDisplayName's equality rule is for
  // projections that already fell back to the code name).
  const facet = valueCardLabel(fieldMethod(field, registry, "Labelable", "label"));
  if (facet?.trim()) return humanName(facet);
  const declared = field.label?.$tag === "Just" ? field.label._0 : undefined;
  return pickDisplayName(valueCardLabel(declared), fieldWireKey(field, registry))
    ?? codeName(field.name);
}

/** The name fields of a focused record's child card. A child stored under a
 * declared field's wire key takes that field's slot name from the same read
 * packet the inline record rows use (`root.fieldSlots`), so both surfaces show
 * the same authored label, or the same code name in the code face. A saved
 * value's authored name still wins; list items and undeclared keys keep their
 * existing caption. */
export function recordChildNameFields(slots: ReadonlyArray<{ wire: string; name: DisplayName }> | undefined,
  key: string | number, caption: string, authored?: string): ReturnType<typeof displayNameItemFields> {
  if (authored) return { caption: authored };
  const slot = typeof key === "string" ? slots?.find(entry => entry.wire === key) : undefined;
  return slot ? displayNameItemFields(slot.name) : { caption };
}
