import { createEffect, createMemo, createSignal, For, Show, onSettled, snapshot } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import { useParams } from "@solidjs/router";
import type { FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { formSessionPlan } from "@fenel/engine/authoring/form-runtime";
import { FieldRenderer } from "~/lib/field-renderer";
import { LoadingScreen } from "~/lib/loading-screen";
import {
  buildLocalAccountFieldRegistry,
  resolveLocalIdentifiedType,
  type PublicFieldRegistryBundle,
} from "~/lib/account-field-registry";
import "~/lib/admin-form/admin-form.css";

// storage-as-effect Phase 4f - the page GET serves the resolved type's raw
// record `type` (mirror of /forms GET), not a pre-extracted `fields` array.
// Phase 15 routes client-side field/default/label planning through the shared
// Fenel-owned form runtime wrapper.
type PageData = {
  page: { slug: string; name: string; config: { brandColor?: string; logo?: string; thankYouMessage?: string; redirectUrl?: string } };
  form: { typeName: string; type?: FenelType; submitLabel: string; typeRef: string };
  fieldRegistry: PublicFieldRegistryBundle;
};

type HydratedPageData = PageData & {
  routeKey: string;
  registry: ModuleRegistry;
};

export default function PublicPage() {
  const params = useParams<{ accountSlug: string; pageSlug: string }>();
  const routeSource = createMemo(() => ({
    accountSlug: params.accountSlug,
    pageSlug: params.pageSlug,
    routeKey: `${params.accountSlug}/${params.pageSlug}`,
  }));
  // Signal writes commit on the next microtask; claim a request synchronously.
  let activeSubmission: { request: ReturnType<typeof routeSource> } | undefined;
  let disposed = false;
  onSettled(() => () => { disposed = true; activeSubmission = undefined; });

  const pageData = createAsyncValue(routeSource, async ({ accountSlug, pageSlug, routeKey }) => {
    const res = await fetch(`/api/p/${accountSlug}/${pageSlug}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Page not found" }));
      throw new Error(body.error || "Page not found");
    }
    const data = await res.json() as PageData;
    if (!data.fieldRegistry?.snapshot) {
      throw new Error("Page field registry missing");
    }
    const registry = await buildLocalAccountFieldRegistry(
      `public-page:${accountSlug}`,
      data.fieldRegistry.snapshot,
    );
    const type = resolveLocalIdentifiedType(registry, data.fieldRegistry);
    return {
      ...data,
      routeKey,
      form: { ...data.form, type },
      registry,
    } satisfies HydratedPageData;
  });

  const [values, setValues] = createSignal<Record<string, unknown>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const currentPageData = () => {
    const data = pageData();
    return data?.routeKey === routeSource().routeKey ? data : undefined;
  };
  createEffect(
    () => routeSource(),
    () => {
      activeSubmission = undefined;
      setValues({});
      setSubmitting(false);
      setSubmitted(false);
      setError(null);
    },
  );
  const session = () => {
    const data = currentPageData();
    return formSessionPlan({
      registry: data?.registry,
      definition: data ? {
        slug: data.form.typeRef,
        type: data.form.type,
        config: { submitLabel: data.form.submitLabel },
      } : undefined,
      currentValues: values(),
      defaultSubmitLabel: "Submit",
      defaultSavingLabel: "Submitting...",
      submitLabelPriority: "definition-first",
    });
  };

  function setValue(fieldId: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldId]: value }));
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (disposed) return;
    const request = routeSource();
    if (activeSubmission?.request === request || !currentPageData()) return;
    const submission = { request };
    activeSubmission = submission;
    let succeeded = false;
    setSubmitting(true);
    setError(null);

    try {
      const submittedValues = snapshot(session().values);
      const res = await fetch(`/api/p/${request.accountSlug}/${request.pageSlug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: submittedValues }),
      });
      const result = await res.json();
      if (activeSubmission !== submission || routeSource() !== request) return;

      if (!res.ok) {
        const msg = result.errors?.map((e: any) => e.message).join(", ") || result.error || "Submission failed";
        setError(msg);
        return;
      }

      if (result.redirect) {
        window.location.href = result.redirect;
        succeeded = true;
        return;
      }

      succeeded = true;
      setSubmitted(true);
    } catch {
      if (activeSubmission === submission && routeSource() === request) {
        setError("Network error. Please try again.");
      }
    } finally {
      if (activeSubmission === submission && routeSource() === request) {
        // Success remains claimed through the queued submitted-state commit.
        if (!succeeded) activeSubmission = undefined;
        setSubmitting(false);
      }
    }
  }

  return (
    <div class="public-page-wrap">
      <Show when={pageData.error}>
        <div class="public-page-card">
          <p class="public-page-error">{(pageData.error as Error).message}</p>
        </div>
      </Show>

      <Show when={pageData.loading}>
        <LoadingScreen />
      </Show>

      <Show when={!submitted() ? currentPageData() : undefined}>
        {(data) => {
          const config = () => data().page.config;
          const brandColor = () => config().brandColor || "#1a1a2e";

          return (
            <div class="public-page-card">
              <Show when={config().logo}>
                <div style="text-align: center; margin-bottom: 1.5rem">
                  <img src={config().logo} alt="logo" style="max-height: 48px" />
                </div>
              </Show>

              <h1 class="public-page-title">{data().page.name}</h1>

              <form onSubmit={handleSubmit}>
                <For each={session().fields}>
                  {(fieldPlan) => (
                    <div style="margin-bottom: 1rem">
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
                  <div class="public-page-error">{error()}</div>
                </Show>

                <button
                  type="submit"
                  class="public-page-submit"
                  disabled={submitting()}
                  style={`background: ${brandColor()}`}
                >
                  {submitting() ? session().savingLabel : session().submitLabel}
                </button>
              </form>

              <div class="public-page-powered">
                Powered by <a href="https://usefenel.com">Fenel</a>
              </div>
            </div>
          );
        }}
      </Show>

      <Show when={submitted()}>
        <div class="public-page-card">
          <div class="public-page-success">
            {currentPageData()?.page.config.thankYouMessage || "Thank you for your submission!"}
          </div>
        </div>
      </Show>
    </div>
  );
}
