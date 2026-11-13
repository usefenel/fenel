// ---------------------------------------------------------------------------
// Back-ref discovery — the only relation primitive after 9b-P.
//
// Relations are not a special concept. Each "1:N relation" is a separate
// entity type with a `$tagged Id<parent>` field pointing back at the parent.
// This module just walks the systemEntities catalog and returns the
// references for a given parent name.
//
// (File name kept as `relations-registry.ts` for the index re-exports;
// the registry concept itself is gone.)
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef } from "./types";
import { systemEntities } from "./system-entities";
import { phantomEntityName } from "./field-meta";
import { peelMaybe } from "./set-algebra";

/** A discovered back-reference: another entity type that points at the
 *  parent via a `$tagged Id<parent>` field. */
export type BackRef = {
  /** The referencing entity's name (e.g. "profile_handle"). */
  entityType: string;
  /** Field on that entity whose value is the parent id. */
  refField: string;
  /** Full relation row type (the referencing entity's $record). */
  type: FenelType;
};

/** Scan the system entity catalog for entities that reference `parentName`. */
export function discoverBackRefs(parentName: string): BackRef[] {
  const out: BackRef[] = [];
  for (const ent of systemEntities) {
    if (ent.id === parentName) continue;
    // Skip parametric entries — back-refs are a concrete-record concept.
    if (!ent.type) continue;
    const fields = recordFields(ent.type);
    for (const f of fields) {
      const refTo = backRefTarget(f);
      if (refTo === parentName) {
        out.push({ entityType: ent.id, refField: f.name, type: ent.type });
      }
    }
  }
  return out;
}

function recordFields(type: FenelType): FieldDef[] {
  if (typeof type !== "object" || type === null) return [];
  if ("$record" in type) return type.$record.fields;
  if ("$refined" in type) return recordFields(type.$refined.base);
  const maybe = peelMaybe(type);
  if (maybe) return recordFields(maybe.value);
  return [];
}

function backRefTarget(field: FieldDef): string | null {
  let t: FenelType | undefined = field.type;
  while (t) {
    if ("$tagged" in t) return phantomEntityName(t);
    const maybe = peelMaybe(t);
    if (maybe) { t = maybe.value; continue; }
    if ("$refined" in t) { t = t.$refined.base; continue; }
    return null;
  }
  return null;
}
