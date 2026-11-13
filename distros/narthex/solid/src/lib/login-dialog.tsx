import { For, Show, createSignal, onSettled } from "solid-js";
import { entitySchemaFields } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { FieldRenderer } from "./field-renderer";
import { login } from "./auth";
import "../routes/login.css";

/** The schema and field presentation belong to auth.LoginInput. This host
 * component only owns browser submission, cancellation and focus. */
export default function LoginDialogContent(props: { registry: ModuleRegistry; onSignedIn: () => void; onClose: () => void }) {
  const registry = props.registry;
  const definition = registry.getIdentifiedEntity("LoginInput");
  if (!definition?.type) throw new Error("The sign-in form type is unavailable.");
  const fields = entitySchemaFields(definition);
  const [values, setValues] = createSignal<Record<string, unknown>>({ email: "", password: "" });
  const [error, setError] = createSignal<string>();
  const [submitting, setSubmitting] = createSignal(false);
  let form: HTMLFormElement | undefined;
  let submission: AbortController | undefined;

  onSettled(() => {
    form?.querySelector<HTMLInputElement>("input")?.focus();
    return () => submission?.abort();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submission) return;
    const attempt = new AbortController();
    submission = attempt;
    setError(undefined);
    setSubmitting(true);
    try {
      const input = values();
      await login({ email: String(input.email ?? ""), password: String(input.password ?? "") }, { signal: attempt.signal });
      if (!attempt.signal.aborted) props.onSignedIn();
    } catch (reason) {
      if (!attempt.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not sign in. Please try again.");
    } finally {
      if (submission === attempt) {
        submission = undefined;
        setSubmitting(false);
      }
    }
  }

  return <form class="login-form" ref={element => { form = element; }} onSubmit={submit}>
    <fieldset class="login-fields" disabled={submitting()}>
      <For each={fields}>{field => <FieldRenderer registry={registry} field={field}
        value={values()[field.name]}
        autocomplete={field.name === "password" ? "current-password" : "email"}
        onChange={value => setValues(previous => ({ ...previous, [field.name]: value }))} />}</For>
    </fieldset>
    <Show when={error()}><p class="public-page-error" role="alert">{error()}</p></Show>
    <div class="confirm-modal__actions">
      <button type="button" class="confirm-modal__btn confirm-modal__btn--cancel" onClick={props.onClose}>Cancel</button>
      <button type="submit" class="confirm-modal__btn confirm-modal__btn--primary login-submit" disabled={submitting()}
        aria-busy={submitting() ? "true" : "false"}>
        <Show when={submitting()}><span class="login-spinner" aria-hidden="true" /></Show>
        {submitting() ? "Signing in…" : "Sign in"}
      </button>
    </div>
  </form>;
}
