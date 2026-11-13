import { Show, For, createSignal, createMemo } from "solid-js";
import { revalidate, useNavigate } from "@solidjs/router";
import { api, getTypes } from "~/lib/api";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import {
  ExpressionEditor,
  LambdaParamsContext,
  toLogic,
  type ExprNode,
  type LambdaParam,
} from "~/lib/expression-runner";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import type { FieldOwnerMutation } from "@fenel/engine/field-authoring";
import {
  FieldAuthoringProvider,
  createFieldResurrectionSelection,
  createNewNamedFieldOccurrence,
  desiredFieldFacetValues,
  fieldFacetReplacementIds,
  forgetFieldFacetDrafts,
  persistedRootFieldOwner,
  type FieldFacetDraftMap,
} from "~/lib/field-occurrence";

// ---------------------------------------------------------------------------
// Funnels — forms-collapse Phase 1b (D-REG=B) + Phase 3a (the funnel IS a
// function). A funnel is the auto-derived input UX of a registered Fenel
// `$record` type AND, optionally, a behavior — submitting it is *calling a
// per-funnel function with the typed input*. Authoring a funnel:
//
//   1. REGISTER ITS INPUT TYPE — "+ New Funnel" drives the universal
//      `TypeBuilder` (reuse — NOT a fork) → the `register_type` action
//      (fenel/modules/types/register.fenel). The type's auto-derived input UX
//      is the form (FieldRenderer).
//   2. (Phase 3a, optional) AUTHOR ITS BEHAVIOR — the universal
//      `ExpressionEditor` (reuse — NOT a fork), the input record bound as the
//      body's lambda param (`input`). "Create funnel" then writes the funnel
//      FUNCTION (a user-function row, param = the input type) via
//      the atomic definition bundle ALONGSIDE the type. An EMPTY body → the funnel is
//      capture-only (the Phase-2 generic capture path); no function is written.
//
// At submit, `types:submit` resolves the per-type function by name and,
// when one exists, calls it (the dissolved onSubmit — body + returned value, no
// directive protocol; see design/forms-collapse.md Q3). The type detail
// stays the existing `/app/types/entity:<name>` type surface (instances =
// captures); the function is editable at `/app/functions/<name>`.
//
// forms-collapse Phase 3b (2026-06-08) — the type-funnel path is the ONLY path.
// `create_form`/`submit_form` + the `form`-row submit branch RETIRED; the
// "Legacy forms" `DataTable entity="form"` list is gone (the route no longer
// serves `form` rows). The dead `form` rows + the `form` entity delete in
// Phase 4. See design/forms-collapse.md + workstreams/forms-collapse/roadmap.md.
// ---------------------------------------------------------------------------

const EMPTY_RECORD: FenelType = { $record: { fields: [] } } as FenelType;
// The R1 transitional return type for a funnel function — a dynamic record the
// `funnelRedirect`/`funnelPage` helpers shape ({redirect}/{page}). Held as an
// empty `$record` (the precise typed-return is R2, Phase 3b-view).
const FUNNEL_RETURN: FenelType = { $record: { fields: [] } } as FenelType;
// An un-authored body — the editor's empty literal node. A funnel left at this
// is capture-only (no function written; the Phase-2 generic capture serves it).
const EMPTY_BODY: ExprNode = { kind: "literal", value: null };

export default function FunnelsPage() {
  const navigate = useNavigate();
  const userDefs = createMemo(() => getTypes().catch(() => null));
  const userTypes = () => {
    const data = userDefs();
    if (!data?.types) return [] as any[];
    return data.types.filter((d: any) => !d.isSystem);
  };

  const [showForm, setShowForm] = createSignal(false);
  const [name, setName] = createSignal("");
  const [schema, setSchema] = createSignal<FenelType>(EMPTY_RECORD);
  const [inputParam] = createSignal(createNewNamedFieldOccurrence("input", EMPTY_RECORD));
  const [fieldFacets, setFieldFacets] = createSignal<FieldFacetDraftMap>({});
  const fieldResurrections = createFieldResurrectionSelection();
  const [body, setBody] = createSignal<ExprNode>(EMPTY_BODY);
  const [showBehavior, setShowBehavior] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  // The funnel's input record bound as the body's single lambda param `input`
  // — its fields surface as `param` refs (e.g. `input.application_type`) in the
  // ExpressionEditor. The param's type tracks the TypeBuilder schema (read at
  // editor mount per the Solid context contract).
  const lambdaParams = (): LambdaParam[] => [{ name: "input", type: schema() }];

  // A body is "authored" once it's no longer the empty literal node. Empty →
  // capture-only (no function written).
  const hasBody = () => {
    const b = body();
    return !(b.kind === "literal" && b.value === null);
  };

  async function handleCreate(e: Event) {
    e.preventDefault();
    const fnName = name().trim();
    if (!fnName) {
      setError("A name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ownerMutations: FieldOwnerMutation[] = [{
        kind: "upsert",
        owner: {
          ownerKey: `type:${fnName}`,
          kind: "type",
          storageName: fnName,
          definition: { id: fnName, type: schema() },
        },
      }];
      if (hasBody()) {
        ownerMutations.push({
          kind: "upsert",
          owner: {
            ownerKey: `function:${fnName}`,
            kind: "function",
            storageName: fnName,
            definition: {
              id: fnName,
              params: [{ ...inputParam(), type: { $ref: fnName } }],
              returns: FUNNEL_RETURN,
              body: toLogic(body(), () => undefined) as FenelFunction["body"],
            },
          },
        });
      }
      await api.definitionBundleSave({
        ownerMutations,
        desiredFacets: desiredFieldFacetValues(fieldFacets()),
        replaceFacetFieldIds: fieldFacetReplacementIds(fieldFacets()),
        resurrectFieldIds: fieldResurrections.fieldIds().length > 0
          ? [...fieldResurrections.fieldIds()]
          : undefined,
      });
      revalidate(["types", "functions"]);
      navigate(`/app/types/entity:${fnName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create funnel");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem">
        <h1 class="page-title" style="margin-bottom: 0">Funnels</h1>
        <button class="btn btn-primary" onClick={() => setShowForm(!showForm())}>
          {showForm() ? "Cancel" : "+ New Funnel"}
        </button>
      </div>

      <Show when={showForm()}>
        <form class="card" style="margin-bottom: 1.5rem" onSubmit={handleCreate}>
          <div class="card-title">New funnel</div>
          <p class="text-muted" style="font-size: 0.8rem; margin: 0 0 1rem">
            A funnel is a registered type — define its input fields below. The
            type's auto-derived input UX is the form.
          </p>
          <div class="form-row" style="margin-bottom: 1rem">
            <label class="form-label">Name</label>
            <input
              class="input mono"
              placeholder="e.g. Waitlist"
              value={name()}
              onInput={(ev) => setName(ev.currentTarget.value)}
            />
          </div>
          <div class="form-row" style="margin-bottom: 1rem">
            <label class="form-label">Input fields</label>
            <FieldAuthoringProvider
              facetsByFieldId={fieldFacets()}
              onFieldFacetsChange={(fieldId, next) => setFieldFacets((current) => ({ ...current, [fieldId]: next }))}
              onFieldFacetsForget={(fieldId) => setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId))}
              ownerKey={name().trim() ? `type:${name().trim()}` : undefined}
              owner={name().trim() ? persistedRootFieldOwner("type", name().trim()) : undefined}
              resurrectFieldIds={fieldResurrections.fieldIds()}
              onFieldResurrectionChange={fieldResurrections.onChange}
            >
              <TypeBuilder value={schema()} onChange={setSchema} lockKind="record" />
            </FieldAuthoringProvider>
          </div>

          <div class="form-row" style="margin-bottom: 1rem">
            <div style="display: flex; justify-content: space-between; align-items: center">
              <label class="form-label" style="margin-bottom: 0">Behavior (optional)</label>
              <button type="button" class="btn btn-sm" onClick={() => setShowBehavior(!showBehavior())}>
                {showBehavior() ? "Hide" : "Add behavior"}
              </button>
            </div>
            <p class="text-muted" style="font-size: 0.78rem; margin: 0.25rem 0 0">
              The funnel IS a function: author what happens on submit. The input
              record is the param <code class="mono">input</code> (its fields are
              available as params). Return <code class="mono">funnelRedirect url</code>
              {" "}or <code class="mono">funnelPage name</code> for the next screen.
              Leave empty to capture only.
            </p>
            <Show when={showBehavior()}>
              <div style="margin-top: 0.5rem">
                <LambdaParamsContext value={lambdaParams}>
                  <ExpressionEditor expr={body()} onChange={setBody} paramName="input" />
                </LambdaParamsContext>
              </div>
            </Show>
          </div>

          <Show when={error()}>
            <div class="form-error" style="margin-bottom: 0.75rem">{error()}</div>
          </Show>
          <div style="display: flex; gap: 0.5rem">
            <button type="submit" class="btn btn-primary" disabled={saving()}>
              {saving() ? "Creating…" : "Create funnel"}
            </button>
            <button type="button" class="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      </Show>

      <Show when={userTypes().length > 0} fallback={
        <p class="text-muted" style="margin-bottom: 1.5rem">No funnels yet — create one above.</p>
      }>
        <div class="entity-type-grid" style="margin-bottom: 2rem">
          <For each={userTypes()}>
            {(def: any) => (
              <a href={`/app/types/entity:${def.name}`} class="entity-type-card">
                <div class="entity-type-card__header">
                  <span class="entity-type-card__name">{def.label ?? def.name}</span>
                </div>
                <Show when={def.description}>
                  <p class="entity-type-card__desc">{def.description}</p>
                </Show>
                <div class="entity-type-card__meta">
                  <span class="mono">{def.name}</span>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
