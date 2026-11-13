import { Show, Switch, Match, createSignal, createMemo, latest, For } from "solid-js";
import type { TypeExpr } from "@fenel/engine/types";
import { TypePicker, type CaptureTypePickerTarget } from "../type-builder/TypePicker";
import { LocusSelect } from "../locus-select";
import { draftValueFingerprint } from "../native-draft";
import { useReaderRuntime } from "../reader-runtime";
import { useAuthoringSession } from "../expression-runner/authoring-session";
import { isInertAuthoringSession } from "../expression-runner/account-authoring-session";
import { readerTypeLabelInSession } from "../reader-presentation";
import { ValueTypeCaption } from "../value-card";

/** Captions re-enter the held reader's Labelable owner after every reload;
 * no picked-row label is retained as identity or presentation authority. */
export function TypeArgumentReferenceCaption(props: { reference: string }) {
  const reader = useReaderRuntime();
  const session = useAuthoringSession();
  const label = createMemo(() => !props.reference ? undefined : reader?.kind === "local" || isInertAuthoringSession(session)
    ? reader?.typePresentation?.({ $ref: props.reference })?.label
    : readerTypeLabelInSession({ $ref: props.reference }, session, reader));
  return <Show when={label()}>{caption => <ValueTypeCaption label={caption()} />}</Show>;
}

/** TypeExpr retains its string reference wire. Picker IO may commit only to
 * the captured containing draft/occurrence; labels never become references. */
export function TypeArgumentEditor(props: {
  value: TypeExpr;
  onChange: (next: TypeExpr) => void;
  captureTarget: CaptureTypePickerTarget;
  disabled?: boolean;
}) {
  const [picking, setPicking] = createSignal(false);
  let editRevision = 0;
  const mode = () => typeof props.value === "string" ? "name" : "$var" in props.value ? "variable" : "application";
  const call = () => typeof props.value !== "string" && "$el" in props.value ? props.value.$el.call : ["", ...[]] as [string, ...TypeExpr[]];
  function change(next: TypeExpr) {
    if (props.disabled) return;
    editRevision++;
    props.onChange(next);
  }
  function captureTarget(): (() => boolean) | undefined {
    return latest(() => {
    if (props.disabled) return undefined;
    const parentCurrent = props.captureTarget();
    if (!parentCurrent) return undefined;
    const value = props.value, fingerprint = draftValueFingerprint(value), revision = editRevision;
    return () => latest(() => !props.disabled && editRevision === revision && props.value === value
      && draftValueFingerprint(props.value) === fingerprint && parentCurrent());
    });
  }
  function closePicker() { editRevision++; setPicking(false); }
  function setCall(next: [string, ...TypeExpr[]]) { change({ $el: { call: next } }); }
  return <div class="instance-type-argument">
    <LocusSelect label="Type argument kind" value={mode()} disabled={props.disabled}
      options={[
        { value: "name", label: "Named type or target" },
        { value: "variable", label: "Type variable" },
        { value: "application", label: "Type application" },
      ]}
      onChange={(kind) => change(kind === "name" ? "Type"
        : kind === "variable" ? { $var: "a" } : { $el: { call: ["List", "String"] } })} />
    <Switch>
      <Match when={mode() === "name"}>
        <TypeArgumentReferenceCaption reference={props.value as string} />
        <input aria-label="Type or target name" class="reps-panel__icon-input" value={props.value as string} disabled={props.disabled} onInput={(event) => change(event.currentTarget.value)} />
        <button type="button" class="reps-panel__btn" disabled={props.disabled} onClick={() => { editRevision++; setPicking(true); }}>Pick</button>
        <Show when={picking()}><TypePicker captureTarget={captureTarget}
          onPick={(selection) => { if (selection.kind === "type") change(selection.reference); closePicker(); }} onCancel={closePicker} /></Show>
      </Match>
      <Match when={mode() === "variable"}>
        <input aria-label="Type variable name" class="reps-panel__icon-input" value={(props.value as { $var: string }).$var} disabled={props.disabled} onInput={(event) => change({ $var: event.currentTarget.value })} />
      </Match>
      <Match when={mode() === "application"}>
        <input aria-label="Type constructor name" class="reps-panel__icon-input" value={call()[0]} disabled={props.disabled} onInput={(event) => setCall([event.currentTarget.value, ...call().slice(1)])} />
        <For keyed={false} each={call().slice(1)}>{(arg, index) => <div class="instance-type-argument__child">
          <TypeArgumentEditor value={arg()} disabled={props.disabled} captureTarget={() => {
            const current = captureTarget(), args = call(), value = arg();
            return current && (() => current() && call() === args && call()[index + 1] === value);
          }} onChange={(next) => { const args = [...call()] as [string, ...TypeExpr[]]; args[index + 1] = next; setCall(args); }} />
          <button type="button" class="reps-panel__btn" disabled={props.disabled} aria-label="Remove type argument" onClick={() => setCall([call()[0], ...call().slice(1).filter((_, i) => i !== index)])}>×</button>
        </div>}</For>
        <button type="button" class="reps-panel__btn" disabled={props.disabled} onClick={() => setCall([...call(), "Type"])}>+ Argument</button>
      </Match>
    </Switch>
  </div>;
}
