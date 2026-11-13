// ---------------------------------------------------------------------------
// Type Creator — define a new FenelType with schema fields and constraints
// ---------------------------------------------------------------------------

import { Show, createSignal } from "solid-js";
import { useNavigate, revalidate } from "@solidjs/router";
import { api } from "~/lib/api";
import { persistRepresentation } from "~/lib/representations/persist";
import type { FenelType } from "@fenel/engine/types";
import { typeFieldOccurrences } from "@fenel/engine/authoring/type";
import { TypeBuilder } from "~/lib/type-builder";
import {
  FieldAuthoringProvider,
  createFieldResurrectionSelection,
  createNewNamedFieldOccurrence,
  desiredFieldFacetValues,
  fieldFacetDraftsForOccurrences,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  persistedRootFieldOwner,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CreateTypePage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [type, setType] = createSignal<FenelType>({ $record: { fields: [createNewNamedFieldOccurrence("field1")] } });
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const fieldResurrections = createFieldResurrectionSelection();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  const [typeId] = createSignal(crypto.randomUUID());

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    const label = displayName().trim();
    if (!label) { setError("Name is required"); return; }

    const name = typeId();

    setSaving(true);
    try {
      const definition = { id: name, type: type() };
      const liveFacets = fieldFacetDraftsForOccurrences(fieldFacets(), typeFieldOccurrences(type()));
      await api.definitionBundleSave({
        ownerMutations: [{
          kind: "upsert",
          owner: {
            ownerKey: `type:${name}`,
            kind: "type",
            storageName: name,
            definition,
          },
        }],
        desiredFacets: desiredFieldFacetValues(liveFacets),
        replaceFacetFieldIds: fieldFacetReplacementIds(liveFacets),
        resurrectFieldIds: fieldResurrections.fieldIds().length > 0
          ? [...fieldResurrections.fieldIds()]
          : undefined,
      });
      await Promise.all([
        persistRepresentation("Codeable", name, { codeName: name }),
        persistRepresentation("Labelable", name, { label }),
        ...(description().trim()
          ? [persistRepresentation("Describable", name, { description: description().trim() })]
          : []),
      ]);
      revalidate("types");
      navigate(`/app/types/entity:${name}`);
    } catch (err: any) {
      setError(err.message || "Failed to create type");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="type-creator">
      <a href="/app/types" class="type-detail__back">&larr; Types</a>
      <h1 class="page-title">Create New Type</h1>

      <form class="card tc-form" onSubmit={handleSubmit}>
        <Show when={error()}>
          <div class="admin-form-errors">
            <div class="admin-form-error">{error()}</div>
          </div>
        </Show>

        {/* Basic info */}
        <div class="tc-section">
          <div class="tc-row">
            <div class="tc-col">
              <label class="tc-label">Name <span class="fr-req">*</span></label>
              <input
                class="tc-input"
                type="text"
                value={displayName()}
                placeholder="e.g. Invoice, Application Form"
                onInput={(e) => setDisplayName(e.currentTarget.value)}
              />
            </div>
          </div>
          <div class="tc-row">
            <div class="tc-col">
              <label class="tc-label">Description</label>
              <input
                class="tc-input"
                type="text"
                value={description()}
                placeholder="A brief description of this type"
                onInput={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>

        {/* Schema fields */}
        <div class="tc-section">
          <h3 class="tc-section-title">Type Definition</h3>
          <FieldAuthoringProvider
            facetsByFieldId={fieldFacets()}
            onFieldFacetsChange={(fieldId, next) => setFieldFacets((current) => ({ ...current, [fieldId]: next }))}
            onFieldFacetsForget={(fieldId) => setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId))}
            ownerKey={`type:${typeId()}`}
            owner={persistedRootFieldOwner("type", typeId())}
            resurrectFieldIds={fieldResurrections.fieldIds()}
            onFieldResurrectionChange={fieldResurrections.onChange}
          >
            <TypeBuilder value={type()} onChange={setType} />
          </FieldAuthoringProvider>
        </div>

        {/* Submit */}
        <div class="tc-actions">
          <button class="btn btn-primary" type="submit" disabled={saving()}>
            {saving() ? "Creating..." : "Create Type"}
          </button>
          <a href="/app/types" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  );
}
