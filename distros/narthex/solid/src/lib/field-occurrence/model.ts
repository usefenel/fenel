import type { FenelType, FieldDef } from "@fenel/engine/types";
import {
  createNewFieldOccurrenceDraft,
  fieldDefToOccurrenceDraft,
  fieldOccurrenceDraftToFieldDef,
  normalizeFieldOccurrenceDraft,
  planNamedFieldOccurrenceReconciliation,
  tryNormalizeFieldOccurrenceDraft,
  type DesiredFieldFacetValue,
  type DurableFieldEntity,
  type FieldAuthoringDiagnostic,
} from "@fenel/engine/field-authoring";
import type { FieldOwner } from "@fenel/engine/field-identity";
import type { InstanceDraft } from "~/lib/instances/instance-draft";
import { instanceKey, isEmptyMethods, representationPresetDraft } from "~/lib/instances/instance-draft";

export type { DesiredFieldFacetValue } from "@fenel/engine/field-authoring";

export type FieldFacetDraftMap = Record<string, Record<string, InstanceDraft>>;

/** Remove one hydrated/edited field from the client replacement contract.
 * This is intentionally different from retaining the key with `{}`, which
 * means "delete every optional facet" for a still-live account field. */
export function forgetFieldFacetDrafts(
  current: Readonly<FieldFacetDraftMap>,
  fieldId: string,
): FieldFacetDraftMap {
  if (!Object.prototype.hasOwnProperty.call(current, fieldId)) {
    return current as FieldFacetDraftMap;
  }
  const next = { ...current };
  delete next[fieldId];
  return next;
}

/** Restrict facet replacement authority to identities still present in an
 * authored definition. Removed occurrence IDs are tombstoned by the owner
 * planner and must not survive as independent facet replacement targets. */
export function fieldFacetDraftsForOccurrences(
  current: Readonly<FieldFacetDraftMap>,
  fields: readonly FieldDef[],
): FieldFacetDraftMap {
  const next: FieldFacetDraftMap = {};
  for (const field of fields) {
    const fieldId = namedFieldId(field);
    if (fieldId && Object.prototype.hasOwnProperty.call(current, fieldId)) {
      next[fieldId] = current[fieldId]!;
    }
  }
  return next;
}

/** Occurrence-draft normalization needs an owner before the surrounding type
 * or function has necessarily been named. Persistence replaces this UI-only
 * owner with the real definition root and reruns the same Fenel planner. */
export const TRANSIENT_SOLID_FIELD_OWNER: FieldOwner = {
  $tag: "FunctionFieldOwner",
  id: "solid:unpersisted-field-owner",
};

export function persistedRootFieldOwner(
  kind: "type" | "function",
  storageName: string,
): FieldOwner {
  return kind === "type"
    ? {
        $tag: "TypeFieldOwner",
        module: { $tag: "Nothing" },
        localId: storageName,
      }
    : { $tag: "FunctionFieldOwner", id: storageName };
}

/** Structural B3 carrier for a new named occurrence. Entropy is supplied by
 * the browser leaf below, never during a conversion or save retry. */
export function namedFieldOccurrence(
  fieldId: string,
  codeName: string,
  type: FenelType = { $ref: "String" },
  owner: FieldOwner = TRANSIENT_SOLID_FIELD_OWNER,
): FieldDef {
  const draft = createNewFieldOccurrenceDraft({
    draftId: fieldId,
    fieldId,
    owner,
    codeName,
    occurrenceType: type,
  });
  return fieldOccurrenceDraftToFieldDef(normalizeFieldOccurrenceDraft(draft, []));
}

/** The sole browser entropy leaf for field authoring. Call only from an
 * explicit add/new-draft event and retain the returned FieldDef across save
 * retries. */
export function createNewNamedFieldOccurrence(
  codeName: string,
  type: FenelType = { $ref: "String" },
  owner: FieldOwner = TRANSIENT_SOLID_FIELD_OWNER,
): FieldDef {
  const fieldId = crypto.randomUUID();
  return namedFieldOccurrence(fieldId, codeName, type, owner);
}

export function namedFieldId(field: FieldDef): string | null {
  return field.key?.$tag === "NamedField" ? field.key.ref.$ref : null;
}

export type ParsedNamedFieldOccurrence = {
  codeName: string;
  occurrenceType: FenelType;
};

/** Preserve explicit identities across a code-editor parse. Exact Codeable
 * matches are reserved first, so inserting a row cannot steal an existing
 * field's UUID through positional fallback. A same-position unmatched row is
 * treated as a rename; only genuinely unmatched rows mint. */
export function reconcileNamedFieldOccurrences(
  prior: readonly FieldDef[],
  parsed: readonly ParsedNamedFieldOccurrence[],
): FieldDef[] {
  const namedPrior = prior.flatMap((field, priorIndex) => {
    const fieldId = namedFieldId(field);
    return fieldId === null ? [] : [{ priorIndex, fieldId, codeName: field.name }];
  });
  const actions = planNamedFieldOccurrenceReconciliation(namedPrior, parsed);
  return actions.map((action) => {
    const next = parsed[action.parsedIndex]!;
    if (action.kind === "mint") {
      // The Fenel kernel is the sole authority that asks for entropy. Once
      // returned, this explicit FieldDef becomes prior state on every later
      // edit/retry and therefore never remints.
      return createNewNamedFieldOccurrence(next.codeName, next.occurrenceType);
    }
    const retainedField = prior[action.priorIndex]!;
    return {
      ...retainedField,
      name: next.codeName,
      type: next.occurrenceType,
    };
  });
}

export type ReusableFieldIdentity = {
  fieldId: string;
  codeName: string;
};

/** Reuse normalization stays in the Fenel control plane. The catalog query is
 * already account/realm/visibility-filtered; this browser projection supplies
 * the live candidate selected from that authorized result. */
export function tryReuseNamedFieldOccurrence(
  occurrence: FieldDef,
  selected: ReusableFieldIdentity,
  owner: FieldOwner = TRANSIENT_SOLID_FIELD_OWNER,
): { ok: true; value: FieldDef } | { ok: false; error: FieldAuthoringDiagnostic } {
  const selectedOccurrence: FieldDef = {
    ...occurrence,
    name: selected.codeName,
    key: { $tag: "NamedField", ref: { $ref: selected.fieldId } },
  };
  const draft = fieldDefToOccurrenceDraft(selectedOccurrence, {
    owner,
    action: "reuse",
  });
  const durable: DurableFieldEntity = {
    id: selected.fieldId,
    currentCodeName: selected.codeName,
    status: "live",
    realm: "repository",
    reuseVisibility: "repository",
  };
  const normalized = tryNormalizeFieldOccurrenceDraft(draft, [durable]);
  return normalized.ok
    ? { ok: true, value: fieldOccurrenceDraftToFieldDef(normalized.value) }
    : normalized;
}

/** Explicitly restore one owner-local tombstone. This is intentionally not a
 * reuse fallback: the Fenel draft kernel receives ResurrectField plus the
 * retained owner origin and rejects any owner/name mismatch. */
export function tryResurrectNamedFieldOccurrence(
  occurrence: FieldDef,
  selected: ReusableFieldIdentity,
  owner: FieldOwner,
): { ok: true; value: FieldDef } | { ok: false; error: FieldAuthoringDiagnostic } {
  const selectedOccurrence: FieldDef = {
    ...occurrence,
    name: selected.codeName,
    key: { $tag: "NamedField", ref: { $ref: selected.fieldId } },
  };
  const draft = fieldDefToOccurrenceDraft(selectedOccurrence, {
    owner,
    action: "resurrect",
  });
  const durable: DurableFieldEntity = {
    id: selected.fieldId,
    currentCodeName: selected.codeName,
    status: "tombstoned",
    realm: "account",
    reuseVisibility: "account",
    origin: { owner, path: [] },
  };
  const normalized = tryNormalizeFieldOccurrenceDraft(draft, [durable]);
  return normalized.ok
    ? { ok: true, value: fieldOccurrenceDraftToFieldDef(normalized.value) }
    : normalized;
}

/** Structural request marshalling only; the Fenel planner validates family,
 * target, scope, uniqueness, liveness, and stale-facet deletion. */
export function desiredFieldFacetValues(
  draftsByFieldId: Readonly<FieldFacetDraftMap>,
): DesiredFieldFacetValue[] | undefined {
  // No field key means the editor has neither loaded nor changed facet state;
  // omission preserves optional facets. A present field key with an empty map
  // intentionally marshals to [] and replaces/deletes affected-field facets.
  if (Object.keys(draftsByFieldId).length === 0) return undefined;
  const desired: DesiredFieldFacetValue[] = [];
  for (const [fieldId, drafts] of Object.entries(draftsByFieldId)) {
    for (const draft of Object.values(drafts)) {
      if (draft.typeName === "Codeable" || isEmptyMethods(draft.methods)) continue;
      desired.push({
        fieldId,
        typeName: draft.typeName as DesiredFieldFacetValue["typeName"],
        methods: { ...draft.methods },
      });
    }
  }
  return desired;
}

/** Explicit per-field replacement authority paired with desired facets. A
 * loaded empty draft map intentionally returns the field ID so deleting every
 * optional facet is distinguishable from an editor that never hydrated. */
export function fieldFacetReplacementIds(
  draftsByFieldId: Readonly<FieldFacetDraftMap>,
): string[] | undefined {
  const ids = Object.keys(draftsByFieldId);
  return ids.length === 0 ? undefined : ids;
}

// ---------------------------------------------------------------------------
// What a person types as a field's name is a human LABEL (Labelable), not a
// code name. The label is the field's Labelable UUID facet (the canonical slot:
// the Fenel planner refuses a declaration-level FieldDef.label); the Codeable
// name is derived from it with std's own `camelCase` (its host op, the
// `stdNatives` leaf std.camelCase declares) while the field is new and
// its code name was never edited on its own. A field that already exists keeps
// its code name (and its UUID): relabelling it changes only the facet.
// ---------------------------------------------------------------------------

// std stays its own lazily loaded root (workspace-module-preload.ts), never
// loaded at this module's import (that would reorder the engine's startup):
// an editor that lets a person type names asks for it when it mounts, and by
// then the engine's prepared body dispatch has loaded std (the same chunk).
// Until it resolves no code name is derived; the typed text is still the label.
type StdNatives = Record<string, (...args: unknown[]) => unknown>;
let std: StdNatives | undefined;
let stdLoad: Promise<void> | undefined;
/** Load std's natives for the name derivations below (idempotent). */
export function loadFieldNaming(): Promise<void> {
  return stdLoad ??= import("@fenel/engine/modules/std")
    .then((module) => { std = module.stdNatives as StdNatives; }, () => { stdLoad = undefined; });
}

function stdString(name: string, value: string): string | undefined {
  if (!std) void loadFieldNaming();
  const out = std?.[name]?.(value);
  return typeof out === "string" ? out : undefined;
}

/** std.camelCase, the code name of a field labelled `label` ("Amount paid" -> "amountPaid"). */
export function fieldCodeNameFromLabel(label: string): string | undefined {
  return stdString("camelCase", label);
}

/** A case (constructor) code name: std.capitalize of std.camelCase ("Paid in cash" -> "PaidInCash"). */
export function caseCodeNameFromLabel(label: string): string | undefined {
  const camel = fieldCodeNameFromLabel(label);
  return camel === undefined ? undefined : stdString("capitalize", camel);
}

const labelableFacetKey = (fieldId: string) => instanceKey({ typeName: "Labelable", args: [fieldId], methods: {} });

/** The field's Labelable facet text in a facet draft map, if any. */
export function fieldLabelFacetText(facets: Readonly<Record<string, InstanceDraft>> | undefined, fieldId: string): string | undefined {
  const draft = facets?.[labelableFacetKey(fieldId)];
  const label = draft?.methods["label"];
  if (typeof label === "string") return label;
  if (label && typeof label === "object") {
    const record = label as Record<string, unknown>;
    const text = typeof record["en"] === "string" ? record["en"] : Object.values(record).find((v) => typeof v === "string");
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

/** The facet map with the field's Labelable set to `text` (removed when blank). */
export function withFieldLabelFacet(facets: Readonly<Record<string, InstanceDraft>>, fieldId: string, text: string): Record<string, InstanceDraft> {
  const next = { ...facets };
  const key = labelableFacetKey(fieldId);
  if (text.trim() === "") delete next[key];
  else next[key] = representationPresetDraft("Labelable", fieldId, { label: text });
  return next;
}

/** A field relabelled to `text`: the Labelable facet always follows; the code
 * name follows only when `codeFollows` (a new field whose code name was never
 * edited on its own). A blank derivation keeps an empty name, which the save
 * refuses with its own message, as an empty typed name always did. */
export function relabelFieldOccurrence(
  field: FieldDef,
  facets: Readonly<Record<string, InstanceDraft>>,
  text: string,
  codeFollows: boolean,
): { field: FieldDef; facets: Record<string, InstanceDraft> } {
  const fieldId = namedFieldId(field);
  if (!fieldId) return { field: { ...field, name: text }, facets: { ...facets } };
  return {
    field: codeFollows && fieldCodeNameFromLabel(text) !== undefined ? { ...field, name: fieldCodeNameFromLabel(text)! } : field,
    facets: withFieldLabelFacet(facets, fieldId, text),
  };
}

/** What a field's label input shows (lane D, 2026-11-08): its label; for a new
 * field nobody named yet (no label, code name never edited) nothing, so the
 * placeholder speaks and typing starts the name: typing "name" yields the
 * label "name" and the code name "name", never "field1name". */
export function fieldLabelInputValue(field: FieldDef, label: string | undefined, unnamedNew: boolean): string {
  return label ?? (unnamedNew ? "" : field.name);
}

/** Whether a new field's code name still follows its label: it equals the
 * derivation of the previous label, or no label was typed yet. */
export function fieldCodeFollowsLabel(field: FieldDef, previousLabel: string | undefined): boolean {
  return !previousLabel?.trim() || field.name === fieldCodeNameFromLabel(previousLabel);
}
