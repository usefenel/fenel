import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { FenelType, SchemeVar, TypeScheme } from "@fenel/engine/types";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import {
  editAuthoringGenericParameters,
  authoringKindType,
  type AuthoringGenericEdit,
  type AuthoringGenericParameter,
} from "@fenel/engine/authoring/generic-parameters";
import { FieldRenderer, displayTypeLabel } from "~/lib/field-renderer";
import { TypeBuilder } from "~/lib/type-builder";
import { FieldAuthoringProvider } from "~/lib/field-occurrence/context";
import { IconPlus, IconTrash } from "~/lib/icons";
import "./generic-parameters-editor.css";

export type GenericParametersEditorProps = {
  scheme: TypeScheme;
  onChange: (scheme: TypeScheme) => void;
  /** A declaration owner can apply the original operation across its scheme,
   * body annotations and requirements atomically. It owns controlled updates;
   * the scheme-only helper and callbacks are not called on this path. */
  onEdit?: (edit: AuthoringGenericEdit) => { ok: true } | { ok: false; message: string };
  /** A type constructor's existing parameter declaration, when applicable. */
  params?: readonly AuthoringGenericParameter[];
  onParamsChange?: (params: readonly AuthoringGenericParameter[]) => void;
  /** Unapplied drafts and source refusals prevent a parent from saving a
   * different declaration than the one currently being edited. */
  onIssueChange?: (issue: string | undefined) => void;
  /** "simple" keeps the declaration quiet until the author asks for a
   * parameter: no pending name input, only an add button. "full" (default)
   * always shows the pending row. Editing semantics are identical. */
  presentation?: "simple" | "full";
};

const NAME_FIELD = { name: "Name", type: { $ref: "String" } as const,
  label: Just("Name"), ui: Nothing, meta: {} };
const NEW_NAME_FIELD = { ...NAME_FIELD, name: "New type parameter", label: Just("New type parameter") };

/** Scheme variables are declaration binders, never global Field identities.
 * Solid owns local input drafts and browser entropy; source policy owns edits. */
export function GenericParametersEditor(props: GenericParametersEditorProps) {
  const [newName, setNewName] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const quiet = () => props.presentation === "simple" && !adding() && !newName();
  const [issues, setIssues] = createSignal<Record<string, string>>({});
  const issue = createMemo(() => Object.values(issues())[0]);
  createEffect(issue, value => { props.onIssueChange?.(value); });

  function report(id: string, message?: string) {
    setIssues(current => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  function apply(id: string, edit: AuthoringGenericEdit) {
    let result: { ok: true } | { ok: false; message: string };
    if (props.onEdit) result = props.onEdit(edit);
    else {
      if (props.params !== undefined && !props.onParamsChange) {
        report(id, "Type parameters cannot be edited in this context.");
        return false;
      }
      const edited = editAuthoringGenericParameters(props.scheme, edit, props.params);
      result = edited;
      if (edited.ok) {
        if (edited.params !== undefined) props.onParamsChange?.(edited.params);
        props.onChange(edited.scheme);
      }
    }
    if (!result.ok) {
      report(id, result.message);
      return false;
    }
    report(id);
    if (edit.kind === "remove") {
      report(`name:${id}`);
      report(`kind:${id}`);
    }
    return true;
  }

  return <section class="generic-parameters" aria-label="Type parameters">
    <Show when={!quiet() || props.scheme.quantified.length > 0}>
      <div class="generic-parameters__heading">Type parameters</div>
    </Show>
    <For each={props.scheme.quantified} keyed={variable => variable.id}>
      {variable => <GenericParameterRow variable={variable()}
        issue={issues()[variable().id]}
        onDismissIssue={() => report(variable().id)}
        onDraftIssue={(part, message) => report(`${part}:${variable().id}`, message)}
        onEdit={edit => apply(variable().id, edit)} />}
    </For>
    <Show when={!quiet()} fallback={<div class="generic-parameters__add">
      <button type="button" class="tb-add-btn" onClick={() => setAdding(true)}><IconPlus size={12} /> Add type parameter</button>
    </div>}>
    <div class="generic-parameters__add">
      <FieldRenderer identityMode="transient" field={NEW_NAME_FIELD} value={newName()}
        onChange={value => {
          if (typeof value !== "string") return;
          setNewName(value);
          report("new", value ? "Add or clear the new type parameter before saving." : undefined);
        }} />
      <button type="button" class="tb-add-btn" disabled={!newName()} onClick={() => {
        // Browser entropy leaf: minted once for this explicit Add attempt.
        const id = crypto.randomUUID();
        if (apply("new", { kind: "add", variable: { id, sourceName: newName(), kind: { $tag: "KType" } } })) { setNewName(""); setAdding(false); }
      }}><IconPlus size={12} /> Add type parameter</button>
      <Show when={props.presentation === "simple"}>
        <button type="button" class="tb-add-btn" onClick={() => { setNewName(""); setAdding(false); report("new"); }}>Cancel</button>
      </Show>
    </div>
    </Show>
    <Show when={issues().new}><p class="generic-parameters__issue" role="alert">{issues().new}</p></Show>
  </section>;
}

function GenericParameterRow(props: {
  variable: SchemeVar;
  issue?: string;
  onDismissIssue: () => void;
  onDraftIssue: (part: "name" | "kind", message?: string) => void;
  onEdit: (edit: AuthoringGenericEdit) => boolean;
}) {
  const declaredName = createMemo(() => props.variable.sourceName);
  const declaredKind = createMemo(() => props.variable.kind);
  const [name, setName] = createSignal(declaredName);
  const projection = createMemo(() => authoringKindType(declaredKind()));
  const [kindDraft, setKindDraft] = createSignal<FenelType | null>(() => {
    const result = projection();
    return result.ok ? result.type : null;
  });
  const [kindChanged, setKindChanged] = createSignal(false);
  createEffect(() => projection(), result => {
    if (!result.ok) props.onDraftIssue("kind", result.message);
  });
  return <div class="generic-parameter-row" data-generic-id={props.variable.id}>
    <div class="generic-parameter-row__controls">
      <FieldRenderer identityMode="transient" field={NAME_FIELD} value={name()}
        onChange={value => {
          if (typeof value !== "string") return;
          setName(value);
          props.onDraftIssue("name", value === props.variable.sourceName ? undefined : "Apply or cancel the type parameter name before saving.");
        }} />
      <Show when={name() !== props.variable.sourceName}>
        <button type="button" class="tb-add-btn" onClick={() => {
          if (props.onEdit({ kind: "rename", id: props.variable.id, sourceName: name() })) props.onDraftIssue("name");
        }}>Apply name</button>
        <button type="button" class="tb-add-btn" onClick={() => { setName(props.variable.sourceName); props.onDraftIssue("name"); props.onDismissIssue(); }}>Cancel name</button>
      </Show>
      <button type="button" class="tb-remove-btn" aria-label={`Remove type parameter ${props.variable.sourceName}`}
        onClick={() => props.onEdit({ kind: "remove", id: props.variable.id })}><IconTrash size={12} /></button>
    </div>
    <Show when={kindDraft()} fallback={<p class="generic-parameters__issue" role="alert">{projection().ok ? "Kind unavailable" : (projection() as { message: string }).message}</p>}>
      <details class="generic-parameter-row__kind">
        <summary>Kind · {displayTypeLabel(kindDraft()!)}</summary>
        <FieldAuthoringProvider facetsByFieldId={{}} onFieldFacetsChange={() => {}} onFieldFacetsForget={() => {}}>
          <TypeBuilder value={kindDraft()} presentation="simple" onChange={type => {
            setKindDraft(type); setKindChanged(true);
            props.onDraftIssue("kind", "Apply or cancel the type parameter kind before saving.");
          }} />
        </FieldAuthoringProvider>
        <Show when={kindChanged()}>
          <div class="generic-parameter-row__controls">
            <button type="button" class="tb-add-btn" onClick={() => {
              if (props.onEdit({ kind: "set-kind", id: props.variable.id, type: kindDraft()! })) {
                setKindChanged(false); props.onDraftIssue("kind");
              }
            }}>Apply kind</button>
            <button type="button" class="tb-add-btn" onClick={() => {
              const result = projection();
              if (result.ok) { setKindDraft(result.type); setKindChanged(false); props.onDraftIssue("kind"); props.onDismissIssue(); }
            }}>Cancel kind</button>
          </div>
        </Show>
      </details>
    </Show>
    <Show when={props.issue}>
      <p class="generic-parameters__issue" role="alert">{props.issue}</p>
      <button type="button" class="tb-add-btn" onClick={() => {
        setName(props.variable.sourceName); props.onDraftIssue("name");
        const result = projection();
        if (result.ok) { setKindDraft(result.type); setKindChanged(false); props.onDraftIssue("kind"); }
        props.onDismissIssue();
      }}>Keep current parameter</button>
    </Show>
  </div>;
}
