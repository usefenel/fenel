import { For, Show, createEffect, createMemo, createSignal, Loading } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import type { JSX } from "@solidjs/web";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { InstanceEditor, type InstanceDraft } from "~/lib/instances";
import { LocusSelect } from "~/lib/locus-select";
import { apiRowToDraft, instanceKey, type InstanceApiRow } from "~/lib/instances/instance-draft";
import {
  fieldCodeFollowsLabel,
  fieldLabelFacetText,
  fieldLabelInputValue,
  loadFieldNaming,
  namedFieldId,
  relabelFieldOccurrence,
  tryResurrectNamedFieldOccurrence,
  tryReuseNamedFieldOccurrence,
} from "./model";
import { useFieldAuthoringContext } from "./context";
import {
  useApiClient,
  type FieldResurrectionOwnerTarget,
} from "~/lib/api";

export type FieldFacetDrafts = Record<string, InstanceDraft>;

/** Picker rows are already realm/visibility-filtered by the engine catalog. */
export type ReusableFieldCandidate = {
  fieldId: string;
  codeName: string;
  label?: string;
  owners?: readonly string[];
  occurrenceTypes?: readonly string[];
  realm?: "account" | "repository" | "local";
  reuseVisibility?: "owner" | "account" | "repository" | "local";
  sourceId?: string;
};

export type FieldOccurrenceEditorBaseProps = {
  field: FieldDef;
  onChange: (next: FieldDef) => void;
  onRemove?: () => void;
  beforeChange?: (next: FieldDef) => boolean;
  beforeRemove?: () => boolean;
  /** Called once per occurrence editor. `value` is a live getter: read it
   * inside the returned JSX (a prop), never while building the editor, so a
   * replaced field object updates the mounted editor instead of remounting it
   * (and closing its open picker). */
  renderTypeEditor: (props: {
    readonly value: FenelType;
    beforeChange: (next: FenelType) => boolean;
    onChange: (next: FenelType) => void;
    /** The row's one options control is open (simple rows): the type's own
     *  options show with the field's, under the same control. */
    readonly optionsOpen?: boolean;
  }) => JSX.Element;
  facets?: FieldFacetDrafts;
  onFacetsChange?: (next: FieldFacetDrafts) => void;
  onFacetsForget?: () => void;
  facetInterfaceNames?: readonly string[];
  reuseCandidates?: readonly ReusableFieldCandidate[];
  errors?: readonly string[];
  compact?: boolean;
  /** Compact presentation of the same occurrence and identity controls. */
  simple?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

export function FieldOccurrenceEditorBase(props: FieldOccurrenceEditorBaseProps) {
  const client = useApiClient();
  const authoring = useFieldAuthoringContext();
  const positional = () => props.field.key?.$tag === "PositionalField";
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [identityOpen, setIdentityOpen] = createSignal(false);
  const [reuseOpen, setReuseOpen] = createSignal(false);
  const [reuseQuery, setReuseQuery] = createSignal("");
  const [selectedReuseId, setSelectedReuseId] = createSignal("");
  const [resurrectionOpen, setResurrectionOpen] = createSignal(false);
  const [selectedResurrectionId, setSelectedResurrectionId] = createSignal("");
  const [localResurrectionId, setLocalResurrectionId] = createSignal<string | undefined>();
  const [reusedIdentityLocked, setReusedIdentityLocked] = createSignal(false);
  const [localFacets, setLocalFacets] = createSignal<FieldFacetDrafts>({});
  const [extraReuseRows, setExtraReuseRows] = createSignal<ReusableFieldCandidate[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | undefined>();
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [normalizationError, setNormalizationError] = createSignal("");
  const [facetDirty, setFacetDirty] = createSignal(false);
  const [facetLoadApplied, setFacetLoadApplied] = createSignal(false);
  const catalog = createAsyncValue(
    () => positional() ? false : ({ query: reuseQuery() }),
    ({ query }) => client.getFieldAuthoringCatalog(query),
  );
  const fieldId = createMemo(() => namedFieldId(props.field));
  const currentIdentity = createAsyncValue(fieldId, async (id) => ({
    fieldId: id,
    ...(await client.getFieldAuthoringIdentity(id)),
  }));
  const currentCatalogField = createMemo(() => {
    const id = fieldId();
    const result = currentIdentity();
    return id !== null && result?.fieldId === id ? result.field ?? undefined : undefined;
  });
  const currentIdentityRealm = () => {
    // Realm is deliberately positive provenance for authored-field facets.
    // Local identities must belong to this captured client's retained source.
    // A server account cannot acquire local provenance from its response.
    // A settled `{ field: null }` is a decided absence: it exposes
    // no facets, while the lock predicate below separately distinguishes it
    // from an undecided loading/error state so local draft naming still works.
    if (currentIdentity.loading || currentIdentity.error) return undefined;
    const field = currentCatalogField();
    if (field?.realm === "local" && (client.accountId !== undefined || field.sourceId !== client.rootId)) return undefined;
    return field?.realm;
  };
  const resurrectionTarget = createMemo((): FieldResurrectionOwnerTarget | undefined => {
    if (positional()) return undefined;
    const ownerKey = authoring?.ownerKey;
    const owner = authoring?.owner;
    if (!ownerKey || !owner) return undefined;
    if (owner.$tag === "TypeFieldOwner") {
      return { ownerKey, ownerKind: "type", storageName: owner.localId };
    }
    if (owner.$tag === "FunctionFieldOwner") {
      return { ownerKey, ownerKind: "function", storageName: owner.id };
    }
    return undefined;
  });
  const resurrectionCatalog = createAsyncValue(
    resurrectionTarget,
    (target) => client.getFieldResurrectionCatalog(target),
  );
  const persistedFacetSource = () => {
    const id = fieldId();
    const realm = currentIdentityRealm();
    return id && (realm === "account" || realm === "local") ? id : undefined;
  };
  const persistedFacetDrafts = createAsyncValue(persistedFacetSource, async (id) => {
    const response = await client.getFieldFacetInstances();
    const rows = (response?.dispatchInstances ?? response?.specInstances ?? []) as InstanceApiRow[];
    const drafts: FieldFacetDrafts = {};
    for (const row of rows) {
      const draft = apiRowToDraft(row);
      if (draft.typeName === "Codeable" || draft.args[0] !== id) continue;
      drafts[instanceKey(draft)] = draft;
    }
    return { fieldId: id, drafts };
  });
  let priorFieldId: string | null = null;
  createEffect(
    () => fieldId(),
    (id) => {
      if (id === priorFieldId) return;
      priorFieldId = id;
      setFacetDirty(false);
      setFacetLoadApplied(false);
    },
  );
  createEffect(
    () => catalog(),
    (page) => {
      if (!page) return;
      setExtraReuseRows([]);
      setNextCursor(page.nextCursor);
    },
  );
  const reuseCandidates = () => {
    const supplied = props.reuseCandidates ?? authoring?.reuseCandidates;
    if (supplied && supplied.length > 0) return supplied;
    return [...(catalog()?.fields ?? []), ...extraReuseRows()];
  };
  const facetInterfaceNames = () => {
    const supplied = props.facetInterfaceNames ?? authoring?.facetInterfaceNames;
    const names = supplied && supplied.length > 0
      ? supplied
      : (catalog()?.facetInterfaceNames ?? []);
    return names.filter((name) => name !== "Codeable");
  };
  const canonicalIdentityLocked = () => reusedIdentityLocked()
    || (!!fieldId() && (currentIdentity.loading || !!currentIdentity.error))
    || currentCatalogField()?.realm === "repository"
    || (currentCatalogField()?.owners?.length ?? 0) > 1;
  const repositoryIdentity = () => currentIdentityRealm() === "repository";
  const facets = () => props.facets
    ?? (fieldId() && authoring ? (authoring.facetsByFieldId[fieldId()!] ?? {}) : localFacets());
  const facetDraftsReady = () => props.facets !== undefined
    || facetLoadApplied()
    || (!!fieldId() && !!authoring
      && Object.prototype.hasOwnProperty.call(authoring.facetsByFieldId, fieldId()!));
  const writeFacets = (next: FieldFacetDrafts) => {
    setFacetDirty(true);
    if (props.onFacetsChange) props.onFacetsChange(next);
    else if (fieldId() && authoring) authoring.onFieldFacetsChange(fieldId()!, next);
    else setLocalFacets(next);
  };
  const forgetFacets = (id: string | null) => {
    if (!id) return;
    if (props.onFacetsForget) props.onFacetsForget();
    else if (authoring) authoring.onFieldFacetsForget(id);
    else setLocalFacets({});
  };
  createEffect(
    () => ({ id: fieldId(), realm: currentIdentityRealm(), persisted: persistedFacetDrafts(), suppliedFacets: props.facets }),
    ({ id, realm, persisted, suppliedFacets }) => {
      if (!id || realm === undefined) return;
    if (realm === "repository") {
      forgetFacets(id);
      setFacetDirty(false);
      setFacetLoadApplied(true);
      return;
    }
    if (
      realm !== "account" && realm !== "local"
      || persisted === undefined
      || persisted.fieldId !== id
      || suppliedFacets !== undefined
      || facetLoadApplied()
    ) return;
    const loaded = persisted.drafts;
    if (authoring) {
      // An owned field map is complete; missing facets can be authored deletions.
      const hasDraftState = Object.prototype.hasOwnProperty.call(authoring.facetsByFieldId, id);
      if (!hasDraftState) {
        (authoring.onFieldFacetsHydrate ?? authoring.onFieldFacetsChange)(id, loaded);
      }
    } else {
      setLocalFacets((current) => facetDirty() ? { ...loaded, ...current } : loaded);
    }
    setFacetDirty(false);
    setFacetLoadApplied(true);
  });

  const reuseRows = createMemo(() => {
    const query = reuseQuery().trim().toLocaleLowerCase();
    const rows = reuseCandidates();
    if (!query) return rows.slice(0, 100);
    return rows
      .filter((row) =>
        row.fieldId.toLocaleLowerCase().includes(query)
        || row.codeName.toLocaleLowerCase().includes(query)
        || row.label?.toLocaleLowerCase().includes(query)
        || row.owners?.some((owner) => owner.toLocaleLowerCase().includes(query)),
      )
      .slice(0, 100);
  });

  function reuseSelected() {
    const selected = reuseCandidates().find((row) => row.fieldId === selectedReuseId());
    if (!selected) return;
    const normalized = tryReuseNamedFieldOccurrence(props.field, selected);
    if (!normalized.ok) {
      setNormalizationError(normalized.error.message);
      return;
    }
    if (props.beforeChange?.(normalized.value) === false) return;
    // Reuse changes identity + current canonical Codeable only. The occurrence
    // type remains local. Do not emit an empty facet replacement here: that
    // would make the bundle planner delete the selected field's canonical
    // facets merely because another occurrence started reusing its identity.
    const previousId = fieldId();
    forgetFacets(previousId);
    forgetFacets(selected.fieldId);
    props.onChange(normalized.value);
    const resurrected = localResurrectionId();
    if (resurrected) authoring?.onFieldResurrectionChange?.(resurrected, false);
    setLocalResurrectionId(undefined);
    setNormalizationError("");
    setReuseOpen(false);
    setReusedIdentityLocked(true);
    setSelectedReuseId("");
  }

  function resurrectSelected() {
    const owner = authoring?.owner;
    const selected = resurrectionCatalog()?.fields.find(
      (row) => row.fieldId === selectedResurrectionId(),
    );
    if (!owner || !selected) return;
    const normalized = tryResurrectNamedFieldOccurrence(props.field, selected, owner);
    if (!normalized.ok) {
      setNormalizationError(normalized.error.message);
      return;
    }
    if (props.beforeChange?.(normalized.value) === false) return;
    forgetFacets(fieldId());
    forgetFacets(selected.fieldId);
    props.onChange(normalized.value);
    authoring?.onFieldResurrectionChange?.(selected.fieldId, true);
    setLocalResurrectionId(selected.fieldId);
    setNormalizationError("");
    setResurrectionOpen(false);
    setReusedIdentityLocked(true);
    setSelectedResurrectionId("");
  }

  async function loadMoreReuseRows() {
    const cursor = nextCursor();
    if (!cursor || loadingMore()) return;
    setLoadingMore(true);
    try {
      const page = await client.getFieldAuthoringCatalog(reuseQuery(), cursor);
      setExtraReuseRows((rows) => [...rows, ...page.fields]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function removeOccurrence() {
    if (props.beforeRemove?.() === false) return;
    // Occurrence removal is not a global facet edit. The server-side liveness
    // plan retains facets while any reuse remains and removes them only when
    // the durable Field is tombstoned after its final occurrence disappears.
    const resurrected = localResurrectionId();
    if (resurrected) authoring?.onFieldResurrectionChange?.(resurrected, false);
    forgetFacets(fieldId());
    props.onRemove?.();
  }

  // What a person types as the field's name is its label (a Labelable facet);
  // the code name follows it while the field is new and its code name was
  // never edited on its own. Label-first needs somewhere to keep the facet (an
  // authoring owner or a facet-owning host) and a decided identity: a new field,
  // or an account/local field whose facets are loaded (writing an unloaded map
  // would replace its other facets).
  const [codeEdited, setCodeEdited] = createSignal(false);
  void loadFieldNaming();
  const newField = () => !positional() && !!fieldId() && !reusedIdentityLocked() && !localResurrectionId()
    && (!!authoring?.isMintedField?.(fieldId()!)
      || !currentIdentity.loading && !currentIdentity.error && currentIdentity()?.fieldId === fieldId() && currentCatalogField() === undefined);
  const labelFirst = () => !positional() && !!fieldId() && (!!props.onFacetsChange || !!authoring);
  const labelEditable = () => labelFirst() && (newField()
    || ((currentIdentityRealm() === "account" || currentIdentityRealm() === "local") && facetDraftsReady() && !reusedIdentityLocked()));
  const labelText = () => fieldId() ? fieldLabelFacetText(facets(), fieldId()!) : undefined;
  // A new field nobody named yet shows an empty name (its default code name
  // is not text to append to).
  const labelInputValue = () => fieldLabelInputValue(props.field, labelText(), newField() && !codeEdited());
  function changeLabel(text: string) {
    const follows = newField() && !codeEdited() && fieldCodeFollowsLabel(props.field, labelText());
    const next = relabelFieldOccurrence(props.field, facets(), text, follows);
    if (next.field !== props.field && !changeOccurrence(next.field)) return false;
    writeFacets(next.facets);
    return true;
  }
  function changeCodeName(name: string) {
    if (!changeOccurrence({ ...props.field, name })) return false;
    setCodeEdited(true);
    return true;
  }

  function changeOccurrence(next: FieldDef) {
    if (props.beforeChange?.(next) === false) return false;
    props.onChange(next);
    return true;
  }
  let approvedType: { field: FieldDef; type: FenelType } | undefined;
  function beforeTypeChange(type: FenelType) {
    approvedType = undefined;
    if (props.beforeChange?.({ ...props.field, type }) === false) return false;
    const current = { field: props.field, type };
    approvedType = current;
    queueMicrotask(() => { if (approvedType === current) approvedType = undefined; });
    return true;
  }
  function changeType(type: FenelType) {
    if (approvedType?.field === props.field && approvedType.type === type) {
      approvedType = undefined;
      props.onChange({ ...props.field, type });
    } else changeOccurrence({ ...props.field, type });
  }

  return (
    <div class={{ "field-occurrence": true, "field-occurrence--compact": !!props.compact, "field-occurrence--simple": !!props.simple }}
      data-field-id={fieldId() ?? undefined}>
      <Show when={(props.errors?.length ?? 0) > 0}>
        <div class="admin-form-errors">
          <For each={props.errors}>{(error) => <div class="admin-form-error">{error}</div>}</For>
        </div>
      </Show>

      <Show when={normalizationError()}>
        <div class="admin-form-error">{normalizationError()}</div>
      </Show>

      <Show when={persistedFacetDrafts.error}>
        <div class="admin-form-error">
          Field facets unavailable: {persistedFacetDrafts.error instanceof Error
            ? persistedFacetDrafts.error.message
            : String(persistedFacetDrafts.error)}
        </div>
      </Show>

      <Show when={!fieldId() && !positional()}>
        <div class="admin-form-error">
          Named field <code>{props.field.name || "(unnamed)"}</code> has no explicit Field UUID. Migrate the owner before saving.
        </div>
      </Show>

      <div class="field-occurrence__head">
        <Show when={labelFirst()}>
          <label class="field-occurrence__name">
            <span>{props.simple ? "Name" : "Label"}</span>
            <input
              class={{ "tb-row__name": true, mono: labelText() === undefined }}
              data-field-label-input=""
              value={labelInputValue()}
              placeholder={props.simple ? undefined : "Field name"}
              disabled={!labelEditable()}
              onInput={(event) => {
                if (!changeLabel(event.currentTarget.value)) event.currentTarget.value = labelInputValue();
              }}
            />
          </label>
        </Show>
        <Show when={!labelFirst() || !props.simple}>
          <label class="field-occurrence__name">
            <span>{positional() ? `Position ${(props.field.key as { index: number }).index} · wire name` : props.simple ? "Name" : "Codeable"}</span>
            <input
              class="tb-row__name mono"
              data-field-code-input=""
              value={props.field.name}
              placeholder="fieldName"
              disabled={!positional() && canonicalIdentityLocked()}
              onInput={(event) => {
                if (!changeCodeName(event.currentTarget.value)) event.currentTarget.value = props.field.name;
              }}
            />
          </label>
        </Show>
        <div class="field-occurrence__type">
          <span class="field-occurrence__section-label">{props.simple ? "Type" : "Occurrence type"}</span>
          {props.renderTypeEditor({
            get value() { return props.field.type; },
            beforeChange: beforeTypeChange,
            onChange: changeType,
            get optionsOpen() { return props.simple ? advancedOpen() : undefined; },
          })}
        </div>
        <div class="field-occurrence__actions">
          <Show when={props.onMoveUp || props.onMoveDown}>
            <button type="button" class="tb-add-btn" aria-label="Move field up" disabled={!props.onMoveUp} onClick={() => props.onMoveUp?.()}>↑</button>
            <button type="button" class="tb-add-btn" aria-label="Move field down" disabled={!props.onMoveDown} onClick={() => props.onMoveDown?.()}>↓</button>
          </Show>
          <Show when={props.simple}>
            <button type="button" class="tb-add-btn" aria-label="Field options" aria-expanded={advancedOpen() ? "true" : "false"} onClick={() => setAdvancedOpen(!advancedOpen())}>•••</button>
          </Show>
          <Show when={!!props.onRemove}>
            <button type="button" class="tb-remove-btn" data-tooltip="Remove field occurrence" aria-label="Remove field occurrence" onClick={removeOccurrence}>×</button>
          </Show>
        </div>
      </div>
      <Show when={!props.simple || advancedOpen()}>
      <div class="field-occurrence__options">
        <Show when={labelFirst() && props.simple}>
          <label class="field-occurrence__name field-occurrence__code-name">
            <span>Code name</span>
            <input
              class="tb-row__name mono"
              data-field-code-input=""
              value={props.field.name}
              placeholder="fieldName"
              disabled={canonicalIdentityLocked()}
              onInput={(event) => {
                if (!changeCodeName(event.currentTarget.value)) event.currentTarget.value = props.field.name;
              }}
            />
          </label>
        </Show>
        <Show when={!positional()}><button type="button" class="tb-add-btn tb-add-btn--sub" onClick={() => setIdentityOpen(!identityOpen())}>
          {identityOpen() ? "hide identity" : "identity"}
        </button></Show>
        <Show when={!positional() && (catalog.loading || catalog.error || catalog() || reuseCandidates().length > 0)}>
          <button type="button" class="tb-add-btn tb-add-btn--sub" onClick={() => setReuseOpen(!reuseOpen())}>
            reuse existing
          </button>
        </Show>
        <Show when={!positional() && !!authoring?.owner && (resurrectionCatalog.loading || resurrectionCatalog.error || (resurrectionCatalog()?.fields.length ?? 0) > 0)}>
          <button type="button" class="tb-add-btn tb-add-btn--sub" onClick={() => setResurrectionOpen(!resurrectionOpen())}>
            resurrect retired
          </button>
        </Show>
        <Show when={canonicalIdentityLocked()}>
          <span class="text-muted" data-tooltip="This field's name is shared by its occurrences.">
            canonical name shared
          </span>
        </Show>
      </div>
      </Show>

      <Show when={!positional() && identityOpen()}>
        <div class="field-occurrence__identity">
          <span class="mono">{fieldId() ?? "missing"}</span>
          <Show when={fieldId()}>
            {(id) => (
              <button
                type="button"
                class="reps-panel__btn"
                onClick={() => void navigator.clipboard?.writeText(id())}
              >
                copy UUID
              </button>
            )}
          </Show>
        </div>
      </Show>

      <Show when={!positional() && reuseOpen()}>
        <div class="field-occurrence__reuse">
          <Show when={catalog.error}>
            <div class="admin-form-error">
              Field catalog unavailable: {catalog.error instanceof Error ? catalog.error.message : String(catalog.error)}
            </div>
          </Show>
          <input
            class="reps-panel__icon-input"
            value={reuseQuery()}
            placeholder="Search code name, UUID, or owner"
            onInput={(event) => setReuseQuery(event.currentTarget.value)}
          />
          <LocusSelect
            class="reps-panel__icon-input"
            label="Existing field"
            value={selectedReuseId()}
            fallbackOption={selectedReuseId() ? undefined : { value: "", label: "Choose an existing field" }}
            options={reuseRows().map((row) => ({
              value: row.fieldId,
              label: `${row.codeName}${row.label ? ` — ${row.label}` : ""} · ${row.fieldId.slice(0, 8)} · ${row.owners?.join(", ") ?? "unowned"} · ${row.occurrenceTypes?.join(" | ") ?? "type varies by occurrence"}`,
              tooltip: `${row.fieldId}\n${row.owners?.join(", ") ?? ""}`,
            }))}
            onChange={(value) => { if (value !== selectedReuseId()) setSelectedReuseId(value); }}
          />
          <Show when={nextCursor()}>
            <button type="button" class="reps-panel__btn" disabled={loadingMore()} onClick={() => void loadMoreReuseRows()}>
              {loadingMore() ? "Loading…" : "Load more"}
            </button>
          </Show>
          <button type="button" class="reps-panel__btn reps-panel__btn--save" disabled={!selectedReuseId()} onClick={reuseSelected}>
            Reuse identity
          </button>
        </div>
      </Show>

      <Show when={!positional() && resurrectionOpen()}>
        <div class="field-occurrence__reuse">
          <Show when={resurrectionCatalog.error}>
            <div class="admin-form-error">
              Retired fields unavailable: {resurrectionCatalog.error instanceof Error
                ? resurrectionCatalog.error.message
                : String(resurrectionCatalog.error)}
            </div>
          </Show>
          <LocusSelect
            class="reps-panel__icon-input"
            label="Retired field"
            value={selectedResurrectionId()}
            fallbackOption={selectedResurrectionId() ? undefined : { value: "", label: "Choose a retired field" }}
            options={(resurrectionCatalog()?.fields ?? []).map((row) => ({ value: row.fieldId, label: `${row.codeName} · ${row.fieldId.slice(0, 8)}` }))}
            onChange={(value) => { if (value !== selectedResurrectionId()) setSelectedResurrectionId(value); }}
          />
          <button
            type="button"
            class="reps-panel__btn reps-panel__btn--save"
            disabled={!selectedResurrectionId()}
            onClick={resurrectSelected}
          >
            Resurrect identity
          </button>
        </div>
      </Show>

      <Show when={!!fieldId() && repositoryIdentity()}>
        <div class="text-muted">Repository field presentation is immutable.</div>
      </Show>

      <Show when={!!fieldId() && (currentIdentityRealm() === "account" || currentIdentityRealm() === "local") && facetDraftsReady() && !!facets() && facetInterfaceNames().length > 0}>
        <details class="field-occurrence__facets">
          <summary>Field presentation (global)</summary>
          <InstanceEditor
            mode="draft"
            variant="display"
            title="Field facets"
            targetId={fieldId()!}
            targetLabel={props.field.name}
            allowedInterfaces={facetInterfaceNames()}
            drafts={facets()}
            onDraftsChange={writeFacets}
            hideScopePriority
          />
        </details>
      </Show>
    </div>
  );
}
