import { Show, createEffect, createMemo, createSignal, createUniqueId, isPending, latest, onSettled } from "solid-js";

export type NumberTextResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The typed owner supplies parsing and formatting. The DOM leaf keeps only
 * the user's draft and forwards a successfully decoded value unchanged. */
export type NumberTextCodec<T = unknown> = {
  decode: (text: string, signal?: AbortSignal) => NumberTextResult<T> | Promise<NumberTextResult<T>>;
  encode: (value: unknown, signal?: AbortSignal) => NumberTextResult<string> | Promise<NumberTextResult<string>>;
};

/** Keep the native editor's lexeme while numeric values echo through the owner.
 * Assigning 100 back to the input while typing 1e2 would destroy the exponent;
 * assigning anything for the intermediate 1e would destroy the draft entirely. */
export function NumberInput<T = number>(props: {
  value: unknown;
  onChange: (value: T) => void;
  textCodec?: NumberTextCodec<T>;
  class?: string;
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  name?: string;
  required?: boolean;
  readonly?: boolean;
}) {
  let input!: HTMLInputElement;
  let initialized = false;
  let lastModel: unknown;
  let lastCodec: NumberTextCodec<T> | undefined;
  let lastEncodedModel: string | undefined;
  let pendingEcho: { value: T; text?: string } | undefined;
  let touched = false;
  let alive = true;
  let modelGeneration = 0;
  let draftGeneration = 0;
  let modelRequest: AbortController | undefined;
  let modelFlight: Promise<void> | undefined;
  type Draft = { generation: number; controller: AbortController; codec: NumberTextCodec<T> | undefined;
    model: unknown; text: string; publish: boolean; showError: boolean;
    onChange: (value: T) => void; validation?: NumberTextResult<T> };
  let draft: Draft | undefined;
  const errorId = createUniqueId();
  const [invalid, setInvalid] = createSignal("");
  const [showError, setShowError] = createSignal(false);
  // Imperative reads enter through this owned inert memo, rather than reaching
  // a For row's internal accessor lazily while latest builds its shadow state.
  const inputFrame = createMemo(() => ({ value: props.value, codec: props.textCodec,
    readonly: props.readonly, onChange: props.onChange }));
  const specialValue = () => typeof props.value === "number" && !Number.isFinite(props.value) ? String(props.value) : undefined;
  /** A held model's decimal text when its codec cannot print it: only a
   * finite native number (or bigint) has one; anything else stays unprinted. */
  const heldNumberText = (value: unknown): string | undefined => typeof value === "bigint" ? String(value)
    : typeof value !== "number" || !Number.isFinite(value) ? undefined : Object.is(value, -0) ? "-0" : String(value);
  const problem = (error: unknown): { ok: false; error: string } => ({ ok: false,
    error: error instanceof Error ? error.message : "This number's text representation could not be read." });
  // Preserve synchronous owners' event timing. Only actual asynchronous codec
  // requests cross a promise boundary; the DOM never interprets numeric text.
  const receive = <V,>(result: NumberTextResult<V> | Promise<NumberTextResult<V>>,
    complete: (value: NumberTextResult<V>) => void,
    failed: (error: unknown) => void = error => complete(problem(error))): Promise<void> | undefined => {
    if ("then" in result) return Promise.resolve(result).then(complete, failed);
    complete(result);
    return undefined;
  };
  const cancelDraft = () => { draft?.controller.abort(); draft = undefined; draftGeneration++; };
  onSettled(() => () => { alive = false; modelGeneration++; cancelDraft(); modelRequest?.abort(); });

  createEffect(
    () => { const frame = inputFrame(); return { value: frame.value, codec: frame.codec }; },
    ({ value, codec }) => {
      if (initialized && Object.is(value, lastModel) && codec === lastCodec) return;
      const priorModel = lastModel, priorCodec = lastCodec, priorEncoded = lastEncodedModel;
      const wasInitialized = initialized;
      initialized = true;
      lastModel = value;
      lastCodec = codec;
      modelRequest?.abort();
      const generation = ++modelGeneration;
      const current = () => {
        if (!alive || generation !== modelGeneration) return false;
        const frame = latest(inputFrame);
        return frame.codec === codec && Object.is(frame.value, value);
      };
      const complete = (encoded?: NumberTextResult<string>) => {
        if (!current()) return;
        const equalModelEcho = wasInitialized && codec === priorCodec && encoded?.ok && encoded.value === priorEncoded;
        const echo = pendingEcho && (Object.is(value, pendingEcho.value) || encoded?.ok && encoded.value === pendingEcho.text);
        lastEncodedModel = encoded?.ok ? encoded.value : undefined;
        if (equalModelEcho || echo) {
          // A model may clone an exact carrier. Its canonical text confirms the
          // echo without assigning back over the user's original lexeme.
          if (draft && draft.codec === codec && Object.is(draft.model, priorModel)) draft.model = value;
          if (echo) pendingEcho = undefined;
          return;
        }
        pendingEcho = undefined;
        // A gesture started after this model replacement already names its
        // new value. Its lexeme owns the DOM while its codec request settles.
        if (draft && draft.codec === codec && Object.is(draft.model, value)) return;
        cancelDraft();
        // Demo 1 (Nov 8): a codec that cannot print a held finite number (the
        // Local worker's Encodable selection refusing Int) never wipes it: the
        // number shows as its decimal text, and that tooling refusal is no
        // error of the person typing.
        const held = codec && encoded && !encoded.ok ? heldNumberText(value) : undefined;
        input.value = codec ? encoded?.ok ? encoded.value : held ?? ""
          : value == null || typeof value === "number" && !Number.isFinite(value) ? "" : Object.is(value, -0) ? "-0" : String(value);
        const message = encoded && !encoded.ok && held === undefined ? encoded.error : "";
        input.setCustomValidity(message);
        touched = false;
        setInvalid(message);
        setShowError(!!message);
      };
      if (pendingEcho && codec === priorCodec && Object.is(value, pendingEcho.value)) {
        complete(pendingEcho.text === undefined ? undefined : { ok: true, value: pendingEcho.text });
        return;
      }
      if (!codec || value === undefined) { complete(); return; }
      const controller = new AbortController(); modelRequest = controller;
      try {
        const flight = receive(codec.encode(value, controller.signal), complete);
        if (flight) {
          const tracked = flight.finally(() => { if (modelFlight === tracked) modelFlight = undefined; });
          modelFlight = tracked;
        }
      } catch (error) { complete(problem(error)); }
    });

  const currentDraft = (captured: Draft) => {
    if (!alive || draft !== captured || captured.generation !== draftGeneration || captured.controller.signal.aborted) return false;
    const frame = latest(inputFrame);
    return frame.codec === captured.codec && Object.is(frame.value, captured.model) && !frame.readonly;
  };
  const afterModelEcho = (captured: Draft, complete: () => void) => {
    if (!alive || draft !== captured || captured.controller.signal.aborted) return;
    const pending = modelFlight;
    if (pending && !Object.is(latest(inputFrame).value, captured.model)) {
      void pending.then(() => { if (currentDraft(captured)) complete(); });
    } else if (currentDraft(captured)) complete();
  };
  function validateDraft(publish: boolean, show: boolean) {
    if (!alive) return;
    draft?.controller.abort();
    const frame = latest(inputFrame);
    const captured: Draft = { generation: ++draftGeneration, controller: new AbortController(),
      codec: frame.codec, model: frame.value, text: input.value,
      publish, showError: show, onChange: frame.onChange };
    draft = captured;
    const complete = (decoded: NumberTextResult<T>) => afterModelEcho(captured, () => {
      captured.validation = decoded;
      const message = decoded.ok ? "" : decoded.error;
      input.setCustomValidity(message);
      setInvalid(message);
      if (decoded.ok) setShowError(false);
      else if (captured.showError) setShowError(true);
      if (!decoded.ok || !captured.publish) return;
      const accept = (encoded?: NumberTextResult<string>) => afterModelEcho(captured, () => {
        pendingEcho = { value: decoded.value, text: encoded?.ok ? encoded.value : undefined };
        captured.onChange(decoded.value);
      });
      if (!captured.codec) { accept(); return; }
      const refused = (error: unknown) => afterModelEcho(captured, () => {
        const issue = problem(error);
        input.setCustomValidity(issue.error); setInvalid(issue.error); setShowError(true);
      });
      try { receive(captured.codec.encode(decoded.value, captured.controller.signal), accept, refused); }
      catch (error) { refused(error); }
    });
    if (captured.codec) {
      try { receive(captured.codec.decode(captured.text, captured.controller.signal), complete); }
      catch (error) { complete(problem(error)); }
    } else {
      const value = input.valueAsNumber;
      const valid = captured.text !== "" && !input.validity.badInput && Number.isFinite(value);
      complete(valid ? { ok: true, value: value as T } : { ok: false, error: "Enter a complete, finite number." });
    }
  }

  return <>
    <input
      ref={input}
      class={props.class}
      type={props.textCodec ? "text" : "number"}
      name={props.name}
      required={props.required}
      readonly={props.readonly}
      min={props.min}
      max={props.max}
      step={props.step}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      aria-labelledby={props.ariaLabelledBy}
      aria-invalid={invalid() ? "true" : undefined}
      aria-describedby={showError() && invalid() ? errorId : undefined}
      onInput={() => {
        if (!alive || latest(inputFrame).readonly) return;
        touched = true;
        validateDraft(true, false);
      }}
      onBlur={() => {
        if (!alive || !touched) return;
        // Leaving the field shows its draft's refusal even while a transition
        // is pending (Nov 13: a refused decode looked fine because this
        // handler returned before marking the draft).
        // A pending blur may run inside a render effect: the signal write waits
        // for a microtask; a validation still in flight shows on completion.
        if (draft && draft.text === input.value) {
          const shown = draft;
          shown.showError = true;
          queueMicrotask(() => { if (alive && draft === shown && shown.validation) setShowError(!shown.validation.ok); });
        }
        if (isPending(() => latest(inputFrame)) || latest(inputFrame).readonly) return;
        if (draft && draft.text === input.value && draft.codec === latest(inputFrame).codec) {
          draft.showError = true;
          if (draft.validation) setShowError(!draft.validation.ok);
        } else validateDraft(false, true);
      }}
    />
    <Show when={specialValue()}>{(value) => <small class="numeric-native-value" role="status">Current value: {value()}</small>}</Show>
    <Show when={showError() && invalid()}>
      <small id={errorId} role="alert" class="numeric-input-error" style="color: var(--danger, #b91c1c);">{invalid()}</small>
    </Show>
  </>;
}
