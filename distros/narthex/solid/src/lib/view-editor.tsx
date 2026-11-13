// ---------------------------------------------------------------------------
// LayoutDefEditor + ListDisplayEditor — typed editors for the structural
// slots on a TypeView.
//
// LayoutDef is sections → rows → slots, each level a list with optional
// metadata. ListDisplayConfig picks a display style (stack / table /
// chips / inline / cards) and an optional column list.
//
// Each level uses ExpressionPicker for the optional `when` predicate so
// users can author conditional layouts without writing JSON Logic by
// hand. Field and column paths are planner-aware datalist inputs: the
// engine supplies valid candidates from the target type, while manual
// advanced paths remain allowed.
// ---------------------------------------------------------------------------

import { For, Show, createUniqueId } from "solid-js";
import type {
  LayoutDef,
  LayoutSection,
  LayoutRow,
  FieldSlot,
  ListDisplayConfig,
  ListColumn,
  Expression,
  SelectOption,
  FenelType,
} from "@fenel/engine/types";
import type {
  SurfaceConditionScope,
  SurfaceFieldCandidate,
} from "@fenel/engine/authoring/surface";
import { ExpressionPicker } from "./expression-builder";
import { LocaleStringEditor } from "./representations/LocaleStringEditor";
import { LocusSelect } from "./locus-select";
import { FieldRenderer } from "./field-renderer";
import { Nothing } from "@fenel/engine/type-foundation";
import { defaultValueForAuthoring } from "@fenel/engine/authoring/type";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blankSlot(): FieldSlot { return { field: "" }; }
function blankRow(): LayoutRow { return { slots: [blankSlot()] }; }
function blankSection(): LayoutSection { return { rows: [blankRow()] }; }
function blankColumn(): ListColumn { return { field: "" }; }

function setIn<T>(arr: T[], i: number, next: T): T[] {
  const copy = [...arr];
  copy[i] = next;
  return copy;
}

function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, j) => j !== i);
}

// ---------------------------------------------------------------------------
// LayoutDefEditor
// ---------------------------------------------------------------------------

export function LayoutDefEditor(props: {
  value: LayoutDef | undefined;
  onChange: (v: LayoutDef | undefined) => void;
  fieldCandidates?: SurfaceFieldCandidate[];
  conditionScope?: SurfaceConditionScope;
  /** Responsive variants reuse this editor without nesting new breakpoints. */
  responsiveVariant?: boolean;
}) {
  const sections = () => props.value?.sections ?? [];
  const candidateListId = createUniqueId();
  const candidates = () => props.fieldCandidates ?? [];

  function setSections(next: LayoutSection[]) {
    if (next.length === 0 && !props.value?.responsive?.length) {
      props.onChange(undefined);
      return;
    }
    props.onChange({ ...(props.value ?? {}), sections: next });
  }

  return (
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <CandidateDatalist id={candidateListId} candidates={candidates()} />
      <For each={sections()}>
        {(section, i) => (
          <SectionEditor
            section={section}
            onChange={(next) => setSections(setIn(sections(), i(), next))}
            onRemove={() => setSections(removeAt(sections(), i()))}
            index={i()}
            fieldCandidates={candidates()}
            candidateListId={candidateListId}
            conditionScope={props.conditionScope}
          />
        )}
      </For>
      <button
        type="button"
        onClick={() => setSections([...sections(), blankSection()])}
        style="align-self: flex-start; font-size: 0.78rem; padding: 0.3rem 0.6rem; border: 1px dashed #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; color: #6b7280;"
      >
        + Add Section
      </button>
      <Show when={sections().length === 0}>
        <p class="text-muted" style="font-size: 0.75rem;">No sections yet — add one to start defining the layout.</p>
      </Show>
      <Show when={!props.responsiveVariant}>
        <For keyed={false} each={props.value?.responsive ?? []}>{(override, index) => <fieldset>
          <legend>Responsive layout {index + 1}</legend>
          <label>Maximum width (px) <input type="number" min="0" value={override().maxWidth}
            onInput={(event) => props.onChange({ sections: sections(), ...props.value,
              responsive: (props.value?.responsive ?? []).map((value, i) => i === index ? { ...value, maxWidth: Number(event.currentTarget.value) } : value),
            })} /></label>
          <LayoutDefEditor responsiveVariant value={{ sections: override().sections }}
            fieldCandidates={props.fieldCandidates} conditionScope={props.conditionScope}
            onChange={(layout) => props.onChange({ sections: sections(), ...props.value,
              responsive: (props.value?.responsive ?? []).map((value, i) => i === index ? { ...value, sections: layout?.sections ?? [] } : value),
            })} />
          <button type="button" onClick={() => props.onChange({ sections: sections(), ...props.value,
            responsive: props.value?.responsive?.filter((_, i) => i !== index),
          })}>Remove responsive layout</button>
        </fieldset>}</For>
        <button type="button" onClick={() => props.onChange({ sections: sections(), ...props.value,
          responsive: [...(props.value?.responsive ?? []), { maxWidth: 640, sections: [] }],
        })}>+ Responsive layout</button>
      </Show>
    </div>
  );
}

function SectionEditor(props: {
  section: LayoutSection;
  index: number;
  onChange: (next: LayoutSection) => void;
  onRemove: () => void;
  fieldCandidates: SurfaceFieldCandidate[];
  candidateListId: string;
  conditionScope?: SurfaceConditionScope;
}) {
  function patch(p: Partial<LayoutSection>) {
    props.onChange({ ...props.section, ...p });
  }
  function setRows(next: LayoutRow[]) { patch({ rows: next }); }

  return (
    <fieldset style="border: 1px solid #d1d5db; border-radius: 6px; padding: 0.6rem; background: #fafafa;">
      <legend style="font-size: 0.75rem; font-weight: 600; color: #374151; padding: 0 0.3rem;">
        Section {props.index + 1}
        <button type="button" onClick={props.onRemove} style="margin-left: 0.5rem; font-size: 0.7rem; color: #c00; background: none; border: none; cursor: pointer;">remove</button>
      </legend>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin-bottom: 0.5rem;">
        <FieldRow label="title">
          <LocaleStringEditor value={props.section.title} onChange={(title) => patch({ title })} />
        </FieldRow>
        <FieldRow label="description">
          <LocaleStringEditor value={props.section.description} onChange={(description) => patch({ description })} />
        </FieldRow>
      </div>

      <div style="display: flex; gap: 1rem; margin-bottom: 0.5rem;">
        <CheckboxRow
          label="collapsible"
          checked={!!props.section.collapsible}
          onChange={(v) => patch({ collapsible: v || undefined })}
        />
        <CheckboxRow
          label="default collapsed"
          checked={!!props.section.defaultCollapsed}
          onChange={(v) => patch({ defaultCollapsed: v || undefined })}
        />
      </div>

      <WhenRow
        when={props.section.when}
        onChange={(when) => patch({ when })}
        label="when (visibility predicate)"
        conditionScope={props.conditionScope}
      />

      {/* Rows */}
      <div style="display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem;">
        <For each={props.section.rows}>
          {(row, i) => (
            <RowEditor
              row={row}
              onChange={(next) => setRows(setIn(props.section.rows, i(), next))}
              onRemove={() => setRows(removeAt(props.section.rows, i()))}
              index={i()}
              fieldCandidates={props.fieldCandidates}
              candidateListId={props.candidateListId}
              conditionScope={props.conditionScope}
            />
          )}
        </For>
        <button
          type="button"
          onClick={() => setRows([...props.section.rows, blankRow()])}
          style="align-self: flex-start; font-size: 0.75rem; padding: 0.25rem 0.5rem; border: 1px dashed #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; color: #6b7280;"
        >
          + Add Row
        </button>
      </div>
    </fieldset>
  );
}

function RowEditor(props: {
  row: LayoutRow;
  index: number;
  onChange: (next: LayoutRow) => void;
  onRemove: () => void;
  fieldCandidates: SurfaceFieldCandidate[];
  candidateListId: string;
  conditionScope?: SurfaceConditionScope;
}) {
  function patch(p: Partial<LayoutRow>) { props.onChange({ ...props.row, ...p }); }
  function setSlots(next: FieldSlot[]) { patch({ slots: next }); }

  return (
    <fieldset style="border: 1px dashed #d1d5db; border-radius: 4px; padding: 0.5rem; background: #fff;">
      <legend style="font-size: 0.72rem; color: #555; padding: 0 0.3rem;">
        Row {props.index + 1}
        <button type="button" onClick={props.onRemove} style="margin-left: 0.5rem; font-size: 0.7rem; color: #c00; background: none; border: none; cursor: pointer;">remove</button>
      </legend>

      <div style="display: flex; gap: 0.4rem; margin-bottom: 0.4rem; align-items: flex-end;">
        <FieldRow label="gap (CSS)">
          <input
            value={props.row.gap ?? ""}
            onInput={(e) => patch({ gap: e.currentTarget.value || undefined })}
            placeholder="0.5rem, 8px, …"
            style={`${INPUT_STYLE} max-width: 120px;`}
          />
        </FieldRow>
      </div>

      <WhenRow
        when={props.row.when}
        onChange={(when) => patch({ when })}
        label="when (row-level)"
        conditionScope={props.conditionScope}
      />

      {/* Slots */}
      <div style="display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.4rem;">
        <For each={props.row.slots}>
          {(slot, i) => (
            <SlotEditor
              slot={slot}
              onChange={(next) => setSlots(setIn(props.row.slots, i(), next))}
              onRemove={() => setSlots(removeAt(props.row.slots, i()))}
              candidateListId={props.candidateListId}
            />
          )}
        </For>
        <button
          type="button"
          onClick={() => setSlots([...props.row.slots, blankSlot()])}
          style="align-self: flex-start; font-size: 0.72rem; padding: 0.2rem 0.45rem; border: 1px dashed #d1d5db; border-radius: 3px; background: #fff; cursor: pointer; color: #6b7280;"
        >
          + Add Slot
        </button>
      </div>
    </fieldset>
  );
}

function SlotEditor(props: {
  slot: FieldSlot;
  onChange: (next: FieldSlot) => void;
  onRemove: () => void;
  candidateListId: string;
}) {
  function patch(p: Partial<FieldSlot>) { props.onChange({ ...props.slot, ...p }); }

  return (
    <div style="display: flex; gap: 0.4rem; align-items: center; padding: 0.3rem 0.4rem; background: #f9fafb; border-radius: 3px; border: 1px solid #f0f0f0;">
      <FieldPathInput
        value={props.slot.field}
        onInput={(field) => patch({ field })}
        placeholder="field name"
        listId={props.candidateListId}
        style={`${INPUT_STYLE} flex: 2; font-family: ui-monospace, monospace; font-size: 0.78rem;`}
      />
      <input
        type="number"
        min="1"
        max="12"
        value={props.slot.span ?? ""}
        onInput={(e) => {
          const v = e.currentTarget.value;
          patch({ span: v === "" ? undefined : Number(v) });
        }}
        placeholder="span"
        style={`${INPUT_STYLE} width: 70px; font-size: 0.78rem;`}
      />
      <input
        value={props.slot.template ?? ""}
        onInput={(e) => patch({ template: e.currentTarget.value || undefined })}
        placeholder="template (optional)"
        style={`${INPUT_STYLE} flex: 2; font-family: ui-monospace, monospace; font-size: 0.78rem;`}
      />
      <button type="button" onClick={props.onRemove} data-tooltip="Remove slot" style="font-size: 0.78rem; padding: 0.15rem 0.4rem; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; color: #c00;">×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListDisplayEditor
// ---------------------------------------------------------------------------

const LIST_STYLES: { value: ListDisplayConfig["style"]; label: string }[] = [
  { value: "stack", label: "Stack (vertical)" },
  { value: "table", label: "Table" },
  { value: "chips", label: "Chips" },
  { value: "inline", label: "Inline" },
  { value: "cards", label: "Cards" },
];

export function ListDisplayEditor(props: {
  value: ListDisplayConfig | undefined;
  onChange: (v: ListDisplayConfig | undefined) => void;
  fieldCandidates?: SurfaceFieldCandidate[];
}) {
  const v = () => props.value;
  const candidateListId = createUniqueId();
  const candidates = () => props.fieldCandidates ?? [];

  function patch(p: Partial<ListDisplayConfig>) {
    const merged = { ...(v() ?? { style: "stack" as const }), ...p };
    props.onChange(merged);
  }

  function clear() { props.onChange(undefined); }

  return (
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <CandidateDatalist id={candidateListId} candidates={candidates()} />
      <Show when={v()} fallback={
        <button
          type="button"
          onClick={() => props.onChange({ style: "stack" })}
          style="align-self: flex-start; font-size: 0.78rem; padding: 0.3rem 0.6rem; border: 1px dashed #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; color: #6b7280;"
        >
          + Configure list display
        </button>
      }>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
          <FieldRow label="style">
            <LocusSelect
              label="List style"
              value={v()!.style}
              options={LIST_STYLES}
              onChange={(style) => patch({ style: style as ListDisplayConfig["style"] })}
            />
          </FieldRow>
          <FieldRow label="itemTemplate">
            <input
              value={v()!.itemTemplate ?? ""}
              onInput={(e) => patch({ itemTemplate: e.currentTarget.value || undefined })}
              placeholder="template name"
              style={`${INPUT_STYLE} font-family: ui-monospace, monospace; font-size: 0.82rem;`}
            />
          </FieldRow>
          <FieldRow label="addLabel">
            <LocaleStringEditor value={v()!.addLabel} onChange={(addLabel) => patch({ addLabel })} />
          </FieldRow>
          <FieldRow label="emptyText">
            <LocaleStringEditor value={v()!.emptyText} onChange={(emptyText) => patch({ emptyText })} />
          </FieldRow>
        </div>

        {/* Columns (mostly for table/cards) */}
        <ColumnsEditor
          value={v()!.columns}
          onChange={(cols) => patch({ columns: cols })}
          fieldCandidates={candidates()}
          candidateListId={candidateListId}
        />

        <button
          type="button"
          onClick={clear}
          style="align-self: flex-start; font-size: 0.72rem; padding: 0.2rem 0.45rem; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; color: #c00;"
        >
          Clear list display
        </button>
      </Show>
    </div>
  );
}

function ColumnsEditor(props: {
  value: ListColumn[] | undefined;
  onChange: (v: ListColumn[] | undefined) => void;
  fieldCandidates: SurfaceFieldCandidate[];
  candidateListId: string;
}) {
  const cols = () => props.value ?? [];
  function setCols(next: ListColumn[]) {
    props.onChange(next.length ? next : undefined);
  }
  function patchCol(i: number, p: Partial<ListColumn>) {
    setCols(setIn(cols(), i, { ...cols()[i]!, ...p }));
  }

  return (
    <div style="display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.5rem;">
      <div style="font-size: 0.72rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">columns</div>
      <For each={cols()}>
        {(col, i) => (
          <div style="display: flex; gap: 0.4rem; align-items: center; padding: 0.3rem 0.4rem; background: #f9fafb; border-radius: 3px; border: 1px solid #f0f0f0;">
            <FieldPathInput
              value={col.field}
              onInput={(field) => patchCol(i(), { field })}
              placeholder="field"
              listId={props.candidateListId}
              style={`${INPUT_STYLE} flex: 2; font-family: ui-monospace, monospace; font-size: 0.78rem;`}
            />
            <LocaleStringEditor value={col.label} onChange={(label) => patchCol(i(), { label })} />
            <input
              type="number"
              min="1"
              max="12"
              value={col.span ?? ""}
              onInput={(e) => {
                const v = e.currentTarget.value;
                patchCol(i(), { span: v === "" ? undefined : Number(v) });
              }}
              placeholder="span"
              style={`${INPUT_STYLE} width: 70px; font-size: 0.78rem;`}
            />
            <input
              value={col.template ?? ""}
              onInput={(e) => patchCol(i(), { template: e.currentTarget.value || undefined })}
              placeholder="template"
              style={`${INPUT_STYLE} flex: 2; font-family: ui-monospace, monospace; font-size: 0.78rem;`}
            />
            <label><input type="checkbox" checked={col.editable ?? false}
              onChange={(event) => patchCol(i(), { editable: event.currentTarget.checked })} /> Editable</label>
            <button type="button" onClick={() => setCols(removeAt(cols(), i()))} data-tooltip="Remove" style="font-size: 0.78rem; padding: 0.15rem 0.4rem; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; color: #c00;">×</button>
          </div>
        )}
      </For>
      <button
        type="button"
        onClick={() => setCols([...cols(), blankColumn()])}
        style="align-self: flex-start; font-size: 0.72rem; padding: 0.2rem 0.45rem; border: 1px dashed #d1d5db; border-radius: 3px; background: #fff; cursor: pointer; color: #6b7280;"
      >
        + Add Column
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** The select-options specialization edits the same SelectOption data consumed
 * by the field plan. Scalar and localized values use the universal field leaf. */
export function SelectOptionsEditor(props: {
  value: SelectOption[];
  onChange: (value: SelectOption[]) => void;
  targetType?: FenelType;
}) {
  const textField = (name: string) => ({ name, type: { $ref: "String" } as const, label: Nothing, meta: {}, ui: Nothing });
  return <div class="view-select-options">
    <For keyed={false} each={props.value}>{(option, index) => {
      const patch = (value: Partial<SelectOption>) => props.onChange(props.value.map((row, i) => i === index ? { ...row, ...value } : row));
      return <fieldset>
        <legend>Option {index + 1}</legend>
        <FieldRenderer identityMode="transient" field={{ ...textField("value"), type: props.targetType ?? { $ref: "Any" } }}
          value={option().value} onChange={(value) => patch({ value })} />
        <LocaleStringEditor value={option().label} methodName="label" onChange={(label) => patch({ label })} />
        <FieldRenderer identityMode="transient" field={textField("image")} value={option().image ?? ""} onChange={(image) => patch({ image: String(image) || undefined })} />
        <button type="button" onClick={() => props.onChange(props.value.filter((_, i) => i !== index))}>Remove option</button>
      </fieldset>;
    }}</For>
    <button type="button" onClick={() => props.onChange([...props.value, { value: props.targetType ? defaultValueForAuthoring(props.targetType) : undefined, label: "" }])}>+ Add option</button>
  </div>;
}

const INPUT_STYLE = "padding: 0.3rem 0.45rem; border: 1px solid #d1d5db; border-radius: 3px; font-size: 0.85rem;";

function FieldRow(props: { label: string; children: any }) {
  return (
    <div style="display: flex; flex-direction: column; gap: 0.15rem;">
      <label style="font-size: 0.7rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">{props.label}</label>
      {props.children}
    </div>
  );
}

function CheckboxRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style="display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: #555; cursor: pointer;">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      {props.label}
    </label>
  );
}

function WhenRow(props: {
  when: Expression | undefined;
  onChange: (v: Expression | undefined) => void;
  label: string;
  conditionScope?: SurfaceConditionScope;
}) {
  return (
    <div style="display: flex; flex-direction: column; gap: 0.2rem;">
      <label style="font-size: 0.7rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">{props.label}</label>
      <Show when={props.when !== undefined} fallback={
        <button
          type="button"
          onClick={() => props.onChange({ "==": [true, true] } as unknown as Expression)}
          style="align-self: flex-start; font-size: 0.72rem; padding: 0.18rem 0.45rem; border: 1px dashed #d1d5db; border-radius: 3px; background: #fff; cursor: pointer; color: #6b7280;"
        >
          + Add when predicate
        </button>
      }>
        <div style="display: flex; gap: 0.3rem; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <ExpressionPicker
              value={props.when}
              onChange={(v) => props.onChange(v as Expression | undefined)}
              variables={props.conditionScope?.variables}
              inline
            />
          </div>
          <button
            type="button"
            onClick={() => props.onChange(undefined)}
            data-tooltip="Remove predicate"
            style="font-size: 0.78rem; padding: 0.15rem 0.4rem; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; color: #c00;"
          >×</button>
        </div>
      </Show>
    </div>
  );
}

function CandidateDatalist(props: { id: string; candidates: SurfaceFieldCandidate[] }) {
  return (
    <Show when={props.candidates.length > 0}>
      <datalist id={props.id}>
        <For each={props.candidates}>
          {(candidate) => <option value={candidate.path}>{candidate.label}</option>}
        </For>
      </datalist>
    </Show>
  );
}

function FieldPathInput(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  listId: string;
  style: string;
}) {
  return (
    <input
      value={props.value}
      list={props.listId}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      placeholder={props.placeholder}
      style={props.style}
    />
  );
}
