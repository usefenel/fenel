import { Show, createEffect, createSignal, getOwner, isDisposed, latest, untrack } from "solid-js";
import "../admin-form/admin-form.css";
import type { JSX } from "@solidjs/web";

export type StringInputSurfaceProps = {
  readonly class?: string;
  readonly inputType?: JSX.InputHTMLAttributes<HTMLInputElement>["type"];
  readonly name?: string;
  readonly labelId?: string;
  readonly required?: boolean;
  readonly autocomplete?: JSX.InputHTMLAttributes<HTMLInputElement>["autocomplete"];
  readonly value: string;
  readonly placeholder?: string;
  readonly textarea?: boolean;
  readonly rows?: number;
  readonly onChange?: (value: string) => void;
  readonly onBlur?: () => void;
  readonly readonly?: boolean;
};

/** The canonical native string field DOM, with presentation already resolved. */
export function StringInputSurface(props: StringInputSurfaceProps) {
  // Native blur can run after the surrounding Show disposed this control.
  const owner = getOwner();
  let model = untrack(() => props.value);
  const [draft, setDraft] = createSignal(model);
  // A same-model paint while an enclosing semantic plan is pending must not
  // overwrite the native draft. A changed external model still owns the text.
  createEffect(() => props.value, value => {
    if (value === model) return;
    model = value;
    setDraft(value);
  });
  const input = (element: HTMLInputElement | HTMLTextAreaElement) => {
    const value = element.value;
    if (props.readonly) return;
    setDraft(value);
    props.onChange?.(value);
  };
  return (
    <Show when={props.textarea} fallback={
      <input
        class={props.class ?? "fe-input"}
        type={props.inputType}
        name={props.name}
        aria-labelledby={props.labelId}
        required={props.required}
        autocomplete={props.autocomplete}
        readonly={props.readonly}
        value={latest(draft)}
        placeholder={props.placeholder ?? ""}
        onInput={(e) => input(e.currentTarget)}
        onBlur={() => {
          if (owner && isDisposed(owner)) return;
          if (!props.readonly) props.onBlur?.();
        }}
      />
    }>
      <textarea
        class={props.class ?? "fe-input fe-textarea"}
        name={props.name}
        aria-labelledby={props.labelId}
        required={props.required}
        autocomplete={props.autocomplete}
        readonly={props.readonly}
        value={latest(draft)}
        placeholder={props.placeholder ?? ""}
        onInput={(e) => input(e.currentTarget)}
        onBlur={() => {
          if (owner && isDisposed(owner)) return;
          if (!props.readonly) props.onBlur?.();
        }}
        rows={props.rows ?? 3}
      />
    </Show>
  );
}
