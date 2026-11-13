// Browser event/shape boundary (B3), with entropy delegated to the existing
// field-authoring leaf (A1). Set substitution remains the Fenel engine's job.
import { Show, createSignal, useContext, For } from "solid-js";
import type { SetExpr, SetCtorField, SetArrowParam } from "@fenel/engine/types";
import { buildSetExpr, type SetExprView } from "@fenel/engine/set-marker";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import { createNewNamedFieldOccurrence } from "~/lib/field-occurrence/model";
import { SetExprEditor, SetBindersContext } from "./SetExprEditor";

type View<K extends SetExprView["kind"]> = Extract<SetExprView<SetExpr>, { kind: K }>;
type Axis = SetCtorField | SetArrowParam;

function SetAxes(props: { values: Axis[]; arrow?: boolean; onChange: (axes: Axis[]) => void }) {
  // Ordinal keys follow their containing list. Named keys survive every move,
  // wire rename and constraint edit unchanged.
  const emit = (values: Axis[]) => props.onChange(values.map((axis, index) => axis.key.$tag === "PositionalField"
    ? { ...axis, key: { $tag: "PositionalField", index } } : axis));
  function add(positional: boolean) {
    const index = props.values.length;
    const wireName = positional ? `_${index}` : `${props.arrow ? "arg" : "field"}${index + 1}`;
    const key = positional ? { $tag: "PositionalField" as const, index } : createNewNamedFieldOccurrence(wireName).key!;
    emit([...props.values, props.arrow ? buildSetExpr.arrowParam(key, wireName, buildSetExpr.all()) : buildSetExpr.ctorField(key, wireName, buildSetExpr.all())]);
  }
  return <div class="sev-axes">
    <For keyed={false} each={props.values}>{(axis, index) => <div class="sev-axis" role="group" aria-label={`${props.arrow ? "Parameter" : "Field"} ${index + 1}`}>
      <div class="sev-axis__head">
        <input class="sev-input" aria-label="Wire name" value={axis().wireName}
          onInput={(e) => emit(props.values.map((value, i) => i === index ? { ...value, wireName: e.currentTarget.value } : value))} />
        <button class="sev-x" type="button" aria-label="Move up" disabled={index === 0} onClick={() => {
          const next = [...props.values]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; emit(next);
        }}>↑</button>
        <button class="sev-x" type="button" aria-label="Move down" disabled={index === props.values.length - 1} onClick={() => {
          const next = [...props.values]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; emit(next);
        }}>↓</button>
        <button class="sev-x" type="button" aria-label="Remove axis" onClick={() => emit(props.values.filter((_, i) => i !== index))}>×</button>
      </div>
      <div class="sev-hint">{axis().key.$tag === "NamedField" ? "Named field identity" : `Position ${index}`}</div>
      <Show when={axis().key.$tag === "NamedField"}>
        <input class="sev-input" aria-label="Field identity" value={(axis().key as { ref: { $ref: string } }).ref.$ref}
          onChange={(e) => {
            if (!e.currentTarget.value.trim()) return;
            emit(props.values.map((value, i) => i === index ? { ...value, key: { $tag: "NamedField", ref: { $ref: e.currentTarget.value.trim() } } } : value));
          }} />
      </Show>
      <SetExprEditor compact value={axis().set} onChange={(set) => emit(props.values.map((value, i) => i === index ? { ...value, set: set ?? buildSetExpr.all() } : value))} />
    </div>}</For>
    <div class="sev-axis__head"><button class="sev-add" type="button" onClick={() => add(false)}>Add named {props.arrow ? "parameter" : "field"}</button>
      <button class="sev-add" type="button" onClick={() => add(true)}>Add positional {props.arrow ? "parameter" : "field"}</button></div>
  </div>;
}

export function SetConstructorFields(props: { value: View<"SeCtor">; onChange: (set: SetExpr) => void }) {
  return <div class="sev-structure">
    <label class="sev-bound__label">Constructor tag <input class="sev-input" aria-label="Constructor tag" value={props.value.ctor} placeholder="Empty for an untagged record"
      onInput={(e) => props.onChange(buildSetExpr.ctor(e.currentTarget.value, props.value.fields))} /></label>
    <SetAxes values={props.value.fields} onChange={(fields) => props.onChange(buildSetExpr.ctor(props.value.ctor, fields as SetCtorField[]))} />
  </div>;
}

export function SetArrowBody(props: { value: View<"SeArrow">; onChange: (set: SetExpr) => void }) {
  return <div class="sev-structure">
    <div class="sev-hint">Parameters are ordered. A function accepts each parameter set and returns a value in the result set.</div>
    <SetAxes arrow values={props.value.params} onChange={(params) => props.onChange(buildSetExpr.arrow(params as SetArrowParam[], props.value.returns))} />
    <div class="sev-bound__label">Returns</div>
    <SetExprEditor compact value={props.value.returns} onChange={(returns) => props.onChange(buildSetExpr.arrow(props.value.params, returns ?? buildSetExpr.all()))} />
  </div>;
}

export function SetRecursiveBody(props: { value: View<"SeMu">; onChange: (set: SetExpr) => void }) {
  const inherited = useContext(SetBindersContext);
  const [error, setError] = createSignal("");
  return <div class="sev-structure">
    <label class="sev-bound__label">Recursion variable <input class="sev-input" aria-label="Recursion variable" value={props.value.var}
      onChange={(e) => {
        const name = e.currentTarget.value.trim();
        if (!name || name === props.value.var) return;
        try {
          const handles = dispatchEngineBody("engine:seRefHandles", [props.value.body, []]) as string[];
          if (handles.includes(name)) { setError("This name already occurs in the body. Choose a fresh name to keep its references distinct."); return; }
          const body = dispatchEngineBody("engine:substSet", [props.value.var, buildSetExpr.ref(name), props.value.body]) as SetExpr;
          props.onChange(buildSetExpr.mu(name, body));
          setError("");
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }} /></label>
    <Show when={error()}><div class="sev-err" role="alert">{error()}</div></Show>
    <SetBindersContext value={() => [props.value.var, ...inherited().filter((name) => name !== props.value.var)]}>
      <SetExprEditor compact value={props.value.body} onChange={(body) => props.onChange(buildSetExpr.mu(props.value.var, body ?? buildSetExpr.none()))} />
    </SetBindersContext>
  </div>;
}
