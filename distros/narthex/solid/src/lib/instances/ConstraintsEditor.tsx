import { For, latest } from "solid-js";
import { dispatchRegistry } from "@fenel/engine";
import type { Constraint } from "@fenel/engine/types";
import type { CaptureTypePickerTarget } from "../type-builder/TypePicker";
import { draftValueFingerprint } from "../native-draft";
import { TypeArgumentEditor, TypeArgumentReferenceCaption } from "./TypeArgumentEditor";

/** Indexed rows retain their containing requirement and argument identity
 * across picker IO; the caller owns the enclosing function draft/lifetime. */
export function ConstraintsEditor(props: {
  value: readonly Constraint[];
  onChange: (next: Constraint[]) => void;
  captureTarget: CaptureTypePickerTarget;
  disabled?: boolean;
  label?: string;
}) {
  let editRevision = 0;
  function change(next: Constraint[]) {
    if (props.disabled) return;
    editRevision++;
    props.onChange(next);
  }
  function replace(index: number, value: Constraint) {
    change(props.value.map((constraint, i) => i === index ? value : constraint));
  }
  function captureArgument(index: number, argIndex: number): (() => boolean) | undefined {
    return latest(() => {
    if (props.disabled) return undefined;
    const parentCurrent = props.captureTarget();
    const rows = props.value, row = rows[index], argument = row?.args[argIndex];
    if (!parentCurrent || !row) return undefined;
    const fingerprint = draftValueFingerprint(rows), revision = editRevision;
    return () => latest(() => !props.disabled && editRevision === revision && props.value === rows
      && props.value[index] === row && row.args[argIndex] === argument
      && draftValueFingerprint(props.value) === fingerprint && parentCurrent());
    });
  }
  return <div class="instance-constraints" aria-label={props.label ?? "Constraints"}>
    <For keyed={false} each={props.value}>{(constraint, index) => <div class="instance-constraint">
      <TypeArgumentReferenceCaption reference={constraint().class.entityId} />
      <input aria-label="Required interface" class="reps-panel__icon-input" list="instance-constraint-interfaces"
        value={constraint().class.entityId} disabled={props.disabled}
        onInput={(event) => replace(index, { ...constraint(), class: { $tag: "Id", entityId: event.currentTarget.value } })} />
      <For keyed={false} each={constraint().args}>{(arg, argIndex) => <div>
        <TypeArgumentEditor value={arg()} disabled={props.disabled} captureTarget={() => captureArgument(index, argIndex)}
          onChange={(next) => replace(index, { ...constraint(), args: constraint().args.map((value, i) => i === argIndex ? next : value) })} />
        <button type="button" class="reps-panel__btn" disabled={props.disabled} aria-label="Remove constraint argument" onClick={() => replace(index, { ...constraint(), args: constraint().args.filter((_, i) => i !== argIndex) })}>×</button>
      </div>}</For>
      <button type="button" class="reps-panel__btn" disabled={props.disabled} onClick={() => replace(index, { ...constraint(), args: [...constraint().args, "Type"] })}>+ Argument</button>
      <button type="button" class="reps-panel__btn" disabled={props.disabled} aria-label="Remove requirement" onClick={() => change(props.value.filter((_, i) => i !== index))}>Remove requirement</button>
    </div>}</For>
    <datalist id="instance-constraint-interfaces"><For each={dispatchRegistry.listClasses()}>{(iface) => <option value={iface.name} />}</For></datalist>
    <button type="button" class="reps-panel__btn" disabled={props.disabled} onClick={() => change([...props.value, { class: { $tag: "Id", entityId: "" }, args: [] }])}>+ Requirement</button>
  </div>;
}
