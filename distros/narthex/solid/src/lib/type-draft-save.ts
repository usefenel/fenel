// ---------------------------------------------------------------------------
// type-draft-save — ONE draft and ONE save for a new type, whichever surface
// shows it.
//
// A new type can be authored in the small card that appears beside the card
// you clicked (lib/type-draft-card.tsx) or in Home's full "New type" modal.
// "More..." on the card opens the modal on the SAME draft, so the two are
// two lenses over one value, not two editors with two saves: the draft's
// state (name and other representations, the type's shape and generic
// metadata, field facets) and its save (the definition bundle, the
// representations in the same transaction, the reference added to the list)
// live here, once.
//
// The host owns the reader-specific pieces and passes them in: how a Local
// reader reconciles a shape in its worker, the in-process reconciliation,
// the definition save and the add to the list. This module never reaches into
// Home's contexts.
// ---------------------------------------------------------------------------

import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { FenelType, TypeConstructorParam, TypeScheme } from "@fenel/engine/types";
import type { FieldResurrectionSelection } from "~/lib/field-occurrence/context";
import { desiredFieldFacetValues, fieldFacetReplacementIds, forgetFieldFacetDrafts, type FieldFacetDraftMap } from "~/lib/field-occurrence/model";
import { cloneDraftValue } from "~/lib/native-draft";
import { caseCodeNameFromLabel, loadFieldNaming } from "~/lib/field-occurrence/model";
import type { ApiClient } from "~/lib/api";

export type TypeDraftRepresentations = Record<string, Record<string, unknown>>;

/** The definition bundle the save sends (the account API's own shape). */
export type TypeDraftBundle = Parameters<ApiClient["api"]["definitionBundleSave"]>[0];

/** A Local reader's worker-side shape reconciliation (Home's signature guard). */
export type TypeDraftSignatureGuard = {
  follow(job: { base: () => readonly unknown[]; state: () => readonly unknown[];
    edit: () => { kind: "scheme"; scheme: TypeScheme; nextBody: FenelType } | undefined;
    apply: (reconciled: { scheme: TypeScheme }) => void }): void;
  retry(): boolean;
  busy(): boolean;
  settled(): Promise<void>;
  issue(): string | undefined;
};

export type TypeDraftHost = {
  /** Present for a Local reader: the shape is reconciled in its worker. */
  localSignature?: (hooks: { closed: () => boolean; refuse: (message: string) => void }) => TypeDraftSignatureGuard | undefined;
  /** In-process reconciliation of a scheme with a new body. */
  reconcile: (scheme: TypeScheme, nextBody: FenelType) => { ok: true; scheme: TypeScheme } | { ok: false; message: string };
  assertAppearanceDrafts: (representations: TypeDraftRepresentations) => void;
  saveDefinition: (bundle: TypeDraftBundle, id: string, representations: TypeDraftRepresentations, canContinue: () => boolean) => Promise<unknown>;
  /** The saved types changed (refresh what lists them). */
  typesChanged: () => void;
  /** Add the saved type to the list the draft was opened in; false when it could not be added. */
  add: (typeId: string, label: string | undefined) => Promise<boolean>;
  /** The field-resurrection selection (field-occurrence's createFieldResurrectionSelection). */
  resurrections: () => FieldResurrectionSelection;
  /** Fresh identity for the draft (a UUID). */
  newId?: () => string;
};

export type TypeDraft = ReturnType<typeof createTypeDraft>;

/** Read one string out of a representation draft (a LocaleString's `en`, else
 *  its first non-empty locale). */
export function typeDraftRepString(drafts: TypeDraftRepresentations, typeName: string, methodName: string): string {
  const v = drafts[typeName]?.[methodName];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const en = (v as Record<string, unknown>)["en"];
    if (typeof en === "string" && en.trim() !== "") return en;
    const first = Object.values(v as Record<string, unknown>).find((s) => typeof s === "string" && s.trim() !== "");
    if (typeof first === "string") return first;
  }
  return "";
}

/** A type name a person types is the type's Labelable label; its Codeable
 *  name is derived from it ("Bank transaction" -> "BankTransaction", std's
 *  camelCase then capitalize) while the Codeable is empty or still equals the
 *  derivation of the previous label (it was not edited on its own). `write`
 *  writes one LocaleString method's visible text. */
export function typeDraftWithTypedName(drafts: TypeDraftRepresentations, text: string,
  write: (drafts: TypeDraftRepresentations, typeName: string, methodName: string, text: string) => TypeDraftRepresentations): TypeDraftRepresentations {
  const previousLabel = typeDraftRepString(drafts, "Labelable", "label");
  const code = typeDraftRepString(drafts, "Codeable", "codeName");
  const follows = code === "" || (previousLabel !== "" && code === caseCodeNameFromLabel(previousLabel));
  const labelled = write(drafts, "Labelable", "label", text);
  const derived = follows ? caseCodeNameFromLabel(text) : undefined;
  return derived !== undefined ? write(labelled, "Codeable", "codeName", derived) : labelled;
}

/** The bundle that saves one new type definition. */
export function typeDraftBundle(input: { id: string; shape: FenelType; params: TypeConstructorParam[]; scheme: TypeScheme;
  facets: FieldFacetDraftMap; resurrect: readonly string[] }): TypeDraftBundle {
  return cloneDraftValue({
    ownerMutations: [{
      kind: "upsert" as const,
      owner: { ownerKey: `type:${input.id}`, kind: "type" as const, storageName: input.id,
        definition: { id: input.id, type: input.shape, params: input.params, typeScheme: input.scheme } },
    }],
    desiredFacets: desiredFieldFacetValues(input.facets),
    replaceFacetFieldIds: fieldFacetReplacementIds(input.facets),
    resurrectFieldIds: input.resurrect.length > 0 ? [...input.resurrect] : undefined,
  });
}

/** Create the draft. Call inside a reactive owner (a component); call
 *  `dispose()` when the last surface showing it closes. */
export function createTypeDraft(host: TypeDraftHost, initial?: { shape?: FenelType }) {
  void loadFieldNaming();
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const [authoredFacetRevision, setAuthoredFacetRevision] = createSignal(0);
  const fieldResurrections = host.resurrections();
  const [reps, setReps] = createSignal<TypeDraftRepresentations>({});
  // Most user-defined types are record schemas; the full editor can switch kind.
  const [typeShape, setTypeShape] = createSignal<FenelType>(initial?.shape ?? { $record: { fields: [] } });
  const [typeParams, setTypeParams] = createSignal<TypeConstructorParam[]>([]);
  const [typeMetadata, setTypeMetadata] = createSignal<Omit<TypeScheme, "body">>({ quantified: [] });
  const [genericIssue, setGenericIssue] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  // Generated up-front so cancelling leaves no dangling rows; persisted only on save.
  const typeId = (host.newId ?? (() => crypto.randomUUID()))();
  let dismissed = false;
  let saveInFlight = false;

  const typeScheme = createMemo<TypeScheme>(() => ({ ...typeMetadata(), body: typeShape() }));
  function installTypeScheme(next: TypeScheme) {
    const { body, ...metadata } = next;
    setTypeMetadata(metadata);
    setTypeShape(body);
  }
  let approvedTypeScheme: TypeScheme | undefined;
  // B4 wave 4 lane H: a Local reader reconciles the type shape in its worker,
  // in the reader's frame; the edit shows at once (text typed into a type is
  // never held) and the scheme's reconciliation follows; Save waits for it.
  const localTypeSignature = host.localSignature?.({ closed: () => dismissed, refuse: message => setSaveError(message) });
  let reconciledTypeScheme: TypeScheme | undefined;
  function guardTypeShape(next: FenelType) {
    if (localTypeSignature) {
      reconciledTypeScheme ??= typeScheme();
      approvedTypeScheme = { ...typeMetadata(), body: next };
      localTypeSignature.follow({ base: () => [], state: () => [typeShape(), typeMetadata()],
        edit: () => reconciledTypeScheme ? { kind: "scheme", scheme: reconciledTypeScheme, nextBody: typeShape() } : undefined,
        apply: reconciled => { reconciledTypeScheme = undefined; installTypeScheme(reconciled.scheme); } });
      setSaveError(null);
      return true;
    }
    const result = host.reconcile(typeScheme(), next);
    if (!result.ok) { setSaveError(result.message); return false; }
    approvedTypeScheme = result.scheme;
    setSaveError(null);
    return true;
  }
  function changeTypeShape(next: FenelType) {
    const approved = approvedTypeScheme;
    approvedTypeScheme = undefined;
    if (approved) installTypeScheme(approved);
    else if (guardTypeShape(next)) {
      const checked = approvedTypeScheme!;
      approvedTypeScheme = undefined;
      installTypeScheme(checked);
    }
  }

  const authoredSubmission = createMemo(() => ({ shape: typeShape(), params: typeParams(), metadata: typeMetadata(), genericIssue: genericIssue(),
    representations: reps(), facetRevision: authoredFacetRevision(), resurrectFieldIds: fieldResurrections.fieldIds() }));
  createEffect(authoredSubmission, () => { setSaveError(null); }, { defer: true });

  /** Save the type and add it to the list. Resolves true once both happened. */
  async function save(): Promise<boolean> {
    if (dismissed || saveInFlight) return false;
    if (genericIssue()) { setSaveError(genericIssue()!); return false; }
    saveInFlight = true;
    setSaving(true);
    setSaveError(null);
    // A shape still being reconciled is not this draft yet. Save waits for its
    // check (the editor is inert meanwhile), then saves the reconciled draft or
    // shows the check's refusal.
    if (localTypeSignature && (localTypeSignature.retry() || localTypeSignature.busy())) {
      setChecking(true);
      try { await localTypeSignature.settled(); } finally { setChecking(false); }
      if (dismissed) return false;
    }
    const checkIssue = localTypeSignature?.issue();
    if (checkIssue) { saveInFlight = false; setSaving(false); setSaveError(checkIssue); return false; }
    const submitted = authoredSubmission();
    const lbl = typeDraftRepString(reps(), "Labelable", "label").trim();
    try {
      host.assertAppearanceDrafts(reps());
      const representationDrafts = cloneDraftValue(reps());
      const bundle = typeDraftBundle({ id: typeId, shape: typeShape(), params: typeParams(), scheme: typeScheme(),
        facets: fieldFacets(), resurrect: fieldResurrections.fieldIds() });
      await host.saveDefinition(bundle, typeId, representationDrafts, () => !dismissed);
      if (dismissed) return false;
      host.typesChanged();
      // The saved type's own name is the handle Fenel resolves it by.
      const added = await host.add(typeId, lbl || undefined);
      if (dismissed) return false;
      if (!added) throw new Error("The type was saved, but could not be added here. Retry to add the same type.");
      return true;
    } catch (e: any) {
      if (!dismissed && authoredSubmission() === submitted) setSaveError(e?.message ?? String(e));
      return false;
    } finally {
      saveInFlight = false;
      if (!dismissed) setSaving(false);
    }
  }

  return {
    typeId: typeId as string,
    reps: reps as Accessor<TypeDraftRepresentations>, setReps,
    codeName: () => typeDraftRepString(reps(), "Codeable", "codeName"),
    /** The type's label, else its code name (what the name input shows). */
    labelName: () => typeDraftRepString(reps(), "Labelable", "label"),
    icon: () => typeDraftRepString(reps(), "Iconable", "icon"),
    typeShape, typeParams, setTypeParams, typeMetadata, typeScheme, installTypeScheme,
    /** Raw writers, unchecked: editors go through guardTypeShape/changeTypeShape
     *  and changeFieldFacet; these exist for hosts that install a known draft. */
    setTypeShape, setFieldFacets,
    genericIssue, setGenericIssue, guardTypeShape, changeTypeShape,
    fieldFacets,
    changeFieldFacet(fieldId: string, next: FieldFacetDraftMap[string]) {
      setFieldFacets((current) => ({ ...current, [fieldId]: next }));
      setAuthoredFacetRevision((current) => current + 1);
    },
    hydrateFieldFacet(fieldId: string, next: FieldFacetDraftMap[string]) {
      setFieldFacets((current) => Object.prototype.hasOwnProperty.call(current, fieldId) ? current : { ...current, [fieldId]: next });
    },
    forgetFieldFacet(fieldId: string) { setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId)); },
    fieldResurrections,
    saving, checking, saveError, setSaveError,
    save,
    /** No surface shows the draft any more: late answers are dropped. */
    dispose() { dismissed = true; },
    dismissed: () => dismissed,
  };
}
