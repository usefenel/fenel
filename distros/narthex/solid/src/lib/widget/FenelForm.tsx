import { createEffect, createMemo, createSignal, For, Match, Show, Switch, Loading, onSettled, snapshot } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import type { FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { formSessionPlan, formSuccessPlan, type FormSuccessPlan } from "@fenel/engine/authoring/form-runtime";
import { surfaceReadValuePlan } from "@fenel/engine/authoring/surface";
import { FieldRenderer } from "~/lib/field-renderer";
import { ReadPlanValue } from "~/lib/layout-renderer";
import {
  buildLocalAccountFieldRegistry,
  resolveLocalIdentifiedType,
  type PublicFieldRegistryBundle,
} from "~/lib/account-field-registry";

// ---------------------------------------------------------------------------
// Embeddable form widget - renders a Fenel form by slug and posts submissions
// to the API. Designed to be embedded on external sites via <script> tag.
//
// Now uses the universal FieldRenderer from @fenel/engine types, so all 10
// field types (string, number, boolean, date, enum, file, ref, list, record,
// union) are supported automatically.
// ---------------------------------------------------------------------------

export type FenelFormProps = {
  /** API base URL */
  apiUrl: string;
  /** Account ID (multi-tenant) */
  accountId: string;
  /** Form slug */
  formSlug: string;
  /** Custom submit button text */
  submitLabel?: string;
  /** Callback after successful submission — receives the funnel function's
   *  returned typed value (e.g. a `Link`), or `undefined` when there is none. */
  onSubmit?: (result: unknown) => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Custom CSS class for the form wrapper */
  class?: string;
};

// The API serves a form/funnel as `{ slug, type, config }`; `type` is the
// FenelType the runtime plan renders from (a `$record`, or an `$opaque`-wrapped
// one). forms-collapse Phase 2 made type-funnels and legacy form rows arrive in
// this shape; Phase 15 moved client-side field/default/label planning behind the
// shared form runtime wrapper.
type FormDef = {
  slug: string;
  submit_label?: string;
  config?: { submitLabel?: string; [key: string]: unknown };
  type?: FenelType;
  fieldRegistry: PublicFieldRegistryBundle;
};

type HydratedFormDef = {
  requestKey: string;
  definition: FormDef;
  registry: ModuleRegistry;
};

type LinkSuccess = Extract<FormSuccessPlan, { kind: "link" }>;
type TypedReadSuccess = Extract<FormSuccessPlan, { kind: "typed-read-plan" }>;

export function FenelForm(props: FenelFormProps) {
  const [submitting, setSubmitting] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [values, setValues] = createSignal<Record<string, unknown>>({});
  // The funnel function's returned typed value (rendered on success).
  const [result, setResult] = createSignal<unknown>(undefined);
  const requestSource = createMemo(() => ({
    apiUrl: props.apiUrl,
    accountId: props.accountId,
    formSlug: props.formSlug,
    requestKey: `${props.apiUrl}\u0000${props.accountId}\u0000${props.formSlug}`,
  }));
  // Signal writes commit on the next microtask; claim a request synchronously.
  let activeSubmission: { request: ReturnType<typeof requestSource> } | undefined;
  let disposed = false;
  onSettled(() => () => { disposed = true; activeSubmission = undefined; });

  // Domain failures carry the request key; transport and hydration failures
  // are captured by createAsyncValue. Both render in the widget's error UI.
  const formDef = createAsyncValue(requestSource, async (request): Promise<HydratedFormDef | { requestKey: string; error: string }> => {
    if (!request.accountId) {
      return { requestKey: request.requestKey, error: "Account id required to load form" };
    }
    const apiBase = request.apiUrl.endsWith("/")
      ? request.apiUrl.slice(0, -1)
      : request.apiUrl;
    const formUrl = `${apiBase}/embed/forms/${encodeURIComponent(request.formSlug)}`;
    const res = await fetch(formUrl, {
      headers: { "X-Account-Id": request.accountId },
    });
    if (!res.ok) {
      let detail = `Form not found: ${request.formSlug}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch { /* keep default detail */ }
      return { requestKey: request.requestKey, error: detail };
    }
    const definition = await res.json() as FormDef;
    if (!definition.fieldRegistry?.snapshot) {
      return { requestKey: request.requestKey, error: "Form field registry missing" };
    }
    const registry = await buildLocalAccountFieldRegistry(
      `public-form:${request.accountId}`,
      definition.fieldRegistry.snapshot,
    );
    const type = resolveLocalIdentifiedType(registry, definition.fieldRegistry);
    return { requestKey: request.requestKey, definition: { ...definition, type }, registry };
  });

  createEffect(
    () => requestSource(),
    () => {
      activeSubmission = undefined;
      setSubmitting(false);
      setSubmitted(false);
      setError(null);
      setValues({});
      setResult(undefined);
    },
  );

  const formError = () => {
    const failure = formDef.error;
    if (failure !== undefined) return failure instanceof Error ? failure.message : String(failure);
    const d = formDef();
    return d?.requestKey === requestSource().requestKey && "error" in d ? d.error : null;
  };
  const formData = () => {
    const d = formDef();
    return d?.requestKey === requestSource().requestKey && !("error" in d) ? d : null;
  };
  const session = createMemo(() => {
    const data = formData();
    return formSessionPlan({
      registry: data?.registry,
      definition: data?.definition,
      currentValues: values(),
      submitLabel: props.submitLabel,
      defaultSubmitLabel: "Submit",
      defaultSavingLabel: "Submitting...",
      submitLabelPriority: "override-first",
    });
  });
  const success = createMemo(() => formSuccessPlan(result(), {
    submitted: submitted(),
    thankYouText: "Thank you for your submission!",
  }));
  const successText = createMemo(() => {
    const plan = success();
    return plan.kind === "thank-you" ? plan.text : "Thank you for your submission!";
  });

  function setValue(fieldId: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldId]: value }));
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (disposed) return;
    const request = requestSource();
    if (activeSubmission?.request === request || !formData()) return;
    const submission = { request };
    activeSubmission = submission;
    let succeeded = false;
    setSubmitting(true);
    setError(null);

    try {
      const submittedValues = snapshot(session().values);
      const res = await fetch(
        `${request.apiUrl.endsWith("/") ? request.apiUrl.slice(0, -1) : request.apiUrl}/embed/forms/${encodeURIComponent(request.formSlug)}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Account-Id": request.accountId,
          },
          body: JSON.stringify({ data: submittedValues }),
        },
      );

      const body = await res.json();
      if (activeSubmission !== submission || requestSource() !== request) return;

      if (!res.ok) {
        setError(body?.error ?? "Submission failed");
        props.onError?.(body?.error ?? "Submission failed");
        return;
      }

      // `body` IS the funnel function's returned typed value (the route serves
      // ActionOk.data verbatim). Render its view on success; no auto-navigate —
      // a Link's view is a "Continue →" anchor the visitor clicks (LOCK-1).
      succeeded = true;
      setResult(body);
      setSubmitted(true);
      props.onSubmit?.(body);
    } catch (err: any) {
      if (activeSubmission === submission && requestSource() === request) {
        setError(err.message);
        props.onError?.(err.message);
      }
    } finally {
      if (activeSubmission === submission && requestSource() === request) {
        // Keep a successful request claimed until the form identity changes;
        // submitted() and its disappearing form also commit on a microtask.
        if (!succeeded) activeSubmission = undefined;
        setSubmitting(false);
      }
    }
  }

  return (
    <div class={`fenel-form-widget ${props.class ?? ""}`}>
      <Show when={formError()}>
        <div class="fenel-error">{formError()}</div>
      </Show>

      <Show when={formDef.loading}>
        <div class="fenel-loading">Loading...</div>
      </Show>

      <Show when={submitted()}>
        <div class="fenel-success">
          <Switch fallback={<>{successText()}</>}>
            <Match when={success().kind === "link" ? success() as LinkSuccess : null}>
              {(link) => <a class="fenel-continue" href={link().url}>{link().label}</a>}
            </Match>
            <Match when={success().kind === "typed-read-plan" ? success() as TypedReadSuccess : null}>
              {(typed) => <ReadPlanValue plan={surfaceReadValuePlan(typed().value, undefined, "scalar")} />}
            </Match>
          </Switch>
        </div>
      </Show>

      <Show when={!submitted() ? formData() : null}>
        {(data) => (
          <form class="fenel-form" onSubmit={handleSubmit}>
            <For each={session().fields}>
              {(fieldPlan) => (
                <div class="fenel-field">
                  <FieldRenderer
                    registry={data().registry}
                    field={fieldPlan.field}
                    value={fieldPlan.value}
                    onChange={(v) => setValue(fieldPlan.name, v)}
                  />
                </div>
              )}
            </For>

            <Show when={error()}>
              <div class="fenel-error">{error()}</div>
            </Show>

            <button
              type="submit"
              class="fenel-submit"
              disabled={submitting()}
            >
              {submitting() ? session().savingLabel : session().submitLabel}
            </button>
          </form>
        )}
      </Show>
    </div>
  );
}
