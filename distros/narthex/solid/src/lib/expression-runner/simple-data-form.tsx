// ---------------------------------------------------------------------------
// SimpleDataForm — the canonical expression editor's "simple" lens for a new
// record (demo 1, 2026-11-08): one row per declared field, the field's human
// label and its own input. It edits the same constructor draft as the full
// editor; the New data dialog's "Advanced" shows that draft unchanged.
//
// Rows reuse the universal pieces: `FieldLabel` (the field's Labelable label),
// `FieldRenderer` over the field's data (as LocusQuickEdit does) and
// `SavedValuePicker` for a field whose type has saved records. Issues are the
// form's own plain words, shown after a row was left or Create was tried.
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal, useContext } from "solid-js";
import { constructorFieldsForTag, recordFieldsForType, type ExprNode } from "./expr-node-codec";
import { FieldLabel, FieldRenderer, PlainFieldsContext, createLocalFieldLabel } from "~/lib/field-renderer/FieldRenderer";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { useAuthoringSession, type AuthoringSession } from "./authoring-session";
import { inlineWidgetFor } from "./inline-widgets";
import { constructorExpression, seedExpressionForType } from "./creation-seed";
import {
  NOT_DATA, dataOfNode, replaceRow, rootConstructorTag, rowIssue, simpleFormModel,
  type SimpleFormModel, type SimpleFormRow,
} from "./simple-data-form-model";
import {
  SavedValuePicker, SavedValuesContext, editorEnvironment, editorFieldRegistry, editorTypeCaption, editorWidgetEnvironment,
} from "./index";
import { savedValueShownName } from "../locus-expression-sources";
import "./simple-data-form.css";

/** The simple lens applies to this draft (a constructor of named fields). */
export function useSimpleFormModel(node: () => ExprNode | undefined, session: () => AuthoringSession) {
  const reader = useReaderRuntime();
  const saved = useContext(SavedValuesContext);
  return createMemo(() => {
    const current = node();
    if (!current) return undefined;
    try {
      return simpleFormModel(current, {
        constructorFields: (tag) => constructorFieldsForTag(tag, editorEnvironment(session())),
        hasWidget: (type) => !!inlineWidgetFor(type, undefined, editorWidgetEnvironment(session(), reader)),
        saved: () => saved?.list() ?? [],
      });
    } catch { return undefined; }
  });
}

export function SimpleDataForm(props: {
  model: SimpleFormModel;
  onChange: (next: ExprNode) => void;
  /** A Create was tried: every row says what it still needs. */
  showIssues?: boolean;
}) {
  return <PlainFieldsContext value={true}><div class="simple-data-form" role="group" aria-label="Fields">
    <For each={props.model.rows} keyed={false}>{(row) =>
      <SimpleDataRow row={row()} showIssues={!!props.showIssues}
        onChange={(next) => props.onChange(replaceRow(props.model, row().index, next))} />}
    </For>
  </div></PlainFieldsContext>;
}

/** A structural record of plain inputs (a CalendarDate's year, month, day):
 * its 2 to 4 fields, when each has a scalar input; otherwise `undefined`.
 * `type` is the widget's resolved type (`inlineWidgetFor(...).type`). */
export function scalarRecordParts(type: FenelType, session: AuthoringSession, reader: ReturnType<typeof useReaderRuntime>): readonly FieldDef[] | undefined {
  const shape = "$refined" in type ? type.$refined.base : type;
  if (!("$record" in shape)) return undefined;
  const fields = shape.$record.fields;
  return fields.length > 1 && fields.length <= 4
    && fields.every((field) => inlineWidgetFor(field.type, undefined, editorWidgetEnvironment(session, reader))?.kind === "scalar")
    ? fields : undefined;
}

/** A record's parts as their own inputs, each written straight into the
 * latest record: the whole-record editor's checked edits dropped a part typed
 * while the previous part's check was in flight (demo 1, Nov 8). Shared by
 * the simple form and the in-place field editor (LocusQuickEdit). */
export function RecordPartsEditor(props: { fields: readonly FieldDef[]; value: unknown; onChange: (record: Record<string, unknown>) => void }) {
  return <div class="simple-data-form__parts">
    <For each={props.fields}>{(part) => <div class="simple-data-form__part">
      <FieldLabel field={part} typeName="" />
      <FieldRenderer identityMode="transient" field={part} compact
        value={(props.value as Record<string, unknown> | undefined)?.[part.name]}
        onChange={(value) => {
          // Read the latest record at the moment of the edit (never a captured copy).
          const current = props.value;
          const record = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
          props.onChange({ ...record, [part.name]: value });
        }} />
    </div>}</For>
  </div>;
}

/** Same declaration data (catalogue snapshots may clone a field). */
function sameField(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function SimpleDataRow(props: { row: SimpleFormRow; showIssues: boolean; onChange: (next: ExprNode) => void }) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const saved = useContext(SavedValuesContext);
  const [left, setLeft] = createSignal(false);
  const [picking, setPicking] = createSignal(false);
  // "Enter details" on a saved-record row: the record's own fields instead.
  const [details, setDetails] = createSignal(false);
  const registry = () => editorFieldRegistry(session, reader);
  const identified = () => props.row.field.key?.$tag === "NamedField";
  // Every draft edit rebuilds the rows; the field and its input keep their
  // identity, or the field's input would re-plan and drop the edits it still
  // has in flight (a CalendarDate's later parts never reached the draft).
  const declared = createMemo(() => props.row.field, { equals: sameField });
  const widget = createMemo(() => inlineWidgetFor(declared().type, undefined, editorWidgetEnvironment(session, reader)),
    { equals: (a, b) => a === b || !!a && !!b && sameField(a.type, b.type) });
  // A nominal record (Person) is built by its constructor, as the full editor
  // builds it; a structural one (a CalendarDate) stays literal data.
  const construction = createMemo(() => {
    try {
      const environment = editorEnvironment(session);
      const tag = rootConstructorTag(seedExpressionForType(declared().type, environment));
      const fields = tag === undefined ? undefined : constructorFieldsForTag(tag, environment);
      return tag !== undefined && fields?.length ? { tag, fields } : undefined;
    } catch { return undefined; }
  });
  function toNode(value: unknown): ExprNode {
    const ctor = construction();
    if (!ctor || !value || typeof value !== "object" || Array.isArray(value)) return { kind: "literal", value };
    const record = value as Record<string, unknown>;
    return constructorExpression(ctor.tag, ctor.fields, ctor.fields.map((field): ExprNode => ({ kind: "literal", value: record[field.name] })));
  }
  const rendererField = createMemo(() => { const control = widget(); return control ? { ...declared(), type: control.type } : undefined; });
  // A structural record of plain inputs (a CalendarDate's year, month, day)
  // shows its parts as the row's own inputs, each written straight into the
  // latest draft: the whole-record editor's checked edits dropped a part
  // typed while the previous part's check was in flight (demo 1, Nov 8).
  const parts = createMemo(() => {
    const control = widget();
    return !control || construction() ? undefined : scalarRecordParts(control.type, session, reader);
  });
  const typeLabel = () => editorTypeCaption(props.row.field.type, session, reader);
  const kind = () => props.row.kind === "saved" && details() && widget() ? "value" : props.row.kind;
  // The issue names the field as its label does (Labelable), else by name.
  const planLabel = createLocalFieldLabel(() => identified() ? props.row.field : undefined, registry);
  const label = createMemo(() => {
    const name = props.row.field.name.replace(/[_-]+/g, " ").trim();
    return planLabel() || (name ? name.charAt(0).toUpperCase() + name.slice(1) : "value");
  });
  const data = () => {
    const value = props.row.node.kind === "ref" ? undefined : dataOfNode(props.row.node);
    return value === NOT_DATA ? undefined : value;
  };
  const pickedName = () => {
    const picked = props.row.node.kind === "ref" ? saved?.byId(props.row.node.savedExprId) : undefined;
    return picked ? savedValueShownName(picked, typeLabel()) : undefined;
  };
  const issue = () => rowIssue({ ...props.row, kind: kind() }, label().toLowerCase(), typeLabel(), left() || props.showIssues,
    (type) => recordFieldsForType(type, editorEnvironment(session)));
  let rowElement!: HTMLDivElement;

  return <div ref={rowElement} class={["simple-data-form__row", { "simple-data-form__row--issue": !!issue() }]}
    data-field={props.row.field.name}
    onFocusOut={(event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !rowElement.contains(next)) setLeft(true);
    }}>
    <div class="simple-data-form__label">
      <FieldLabel field={props.row.field} typeName="" registry={identified() ? registry() : undefined} />
    </div>
    <div class="simple-data-form__input">
      <Show when={kind() === "value" && !parts() ? rendererField() : undefined}>{(field) =>
        <FieldRenderer registry={registry()} identityMode={identified() ? "identified" : "transient"}
          field={field()} value={data()} compact
          onChange={(value) => props.onChange(toNode(value))} />}
      </Show>
      <Show when={kind() === "value" ? parts() : undefined}>{(fields) =>
        <RecordPartsEditor fields={fields()} value={data()}
          onChange={(record) => props.onChange({ kind: "literal", value: record })} />}
      </Show>
      <Show when={kind() === "saved"}>
        <div class="simple-data-form__saved">
          <button type="button" class="btn simple-data-form__choose" aria-expanded={picking() ? "true" : "false"}
            onClick={() => setPicking(!picking())}>
            {pickedName() ?? (props.row.node.kind === "ref" ? "Saved data" : `Choose ${typeLabel() ? `a ${typeLabel()}` : ""}…`)}
          </button>
          <Show when={widget() && props.row.node.kind !== "ref"}>
            <button type="button" class="simple-data-form__alt" onClick={() => { setPicking(false); setDetails(true); }}>
              Enter details instead
            </button>
          </Show>
        </div>
        <Show when={picking()}>
          <div class="simple-data-form__picker">
            <SavedValuePicker plain fieldType={props.row.field.type} typeName={typeLabel()}
              onPick={(id) => { setPicking(false); setLeft(true); props.onChange({ kind: "ref", savedExprId: id }); }}
              onCancel={() => setPicking(false)} />
          </div>
        </Show>
      </Show>
      <Show when={details() && kind() === "value"}>
        <button type="button" class="simple-data-form__alt" onClick={() => setDetails(false)}>
          Choose saved {typeLabel() ?? "data"} instead
        </button>
      </Show>
      <Show when={kind() === "advanced"}>
        <p class="simple-data-form__advanced text-muted">Set under Advanced.</p>
      </Show>
    </div>
    <Show when={issue()}>{(message) => <p class="simple-data-form__issue" role="alert">{message()}</p>}</Show>
  </div>;
}
