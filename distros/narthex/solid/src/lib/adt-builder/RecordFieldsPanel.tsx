// RecordFieldsPanel is a focused record-only facade over the one shared field
// occurrence editor. Field identity stays in FieldDef.key; renaming edits the
// Codeable projection and never rebuilds a map key as identity.

import { Show, For } from "solid-js";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { FieldOccurrenceEditor } from "~/lib/field-occurrence/FieldOccurrenceEditor";
import { createNewNamedFieldOccurrence } from "~/lib/field-occurrence/model";

export type RecordFieldsPanelProps = {
  value: FenelType;
  onChange: (t: FenelType) => void;
};

export function RecordFieldsPanel(props: RecordFieldsPanelProps) {
  const record = () => (
    props.value && typeof props.value === "object" && "$record" in props.value
      ? props.value.$record
      : { fields: [] as FieldDef[] }
  );
  const fields = () => record().fields ?? [];

  function setFields(next: FieldDef[]) {
    props.onChange({ $record: { ...record(), fields: next } });
  }

  function addField() {
    const used = new Set(fields().map((field) => field.name));
    let codeName = "field";
    let suffix = 1;
    while (used.has(codeName)) codeName = `field${++suffix}`;
    setFields([...fields(), createNewNamedFieldOccurrence(codeName)]);
  }

  return (
    <div class="rfp">
      <div class="rfp-header">Fields</div>
      <Show when={fields().length > 0} fallback={<div class="rfp-empty">No fields yet.</div>}>
        <For keyed={false} each={fields()}>
          {(field, index) => (
            <FieldOccurrenceEditor
              field={field()}
              onChange={(next) => setFields(fields().map((value, i) => i === index ? next : value))}
              onRemove={() => setFields(fields().filter((_, i) => i !== index))}
              compact
            />
          )}
        </For>
      </Show>
      <button type="button" class="rfp-add" onClick={addField}>+ Add field</button>
    </div>
  );
}
