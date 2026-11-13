// ---------------------------------------------------------------------------
// AdminForm - renders a FormDefinition through the form runtime plan plus
// FieldRenderer/LayoutRenderer leaves.
//
// Replaces hand-coded dashboard forms. Same form definitions work in the web
// dashboard, Telegram bot, or any future channel.
//
// If the form (or its resolved template) has a layout, LayoutRenderer handles
// sections/rows/columns. Otherwise, fields render sequentially.
//
// Usage:
//   <AdminForm
//     definition={createProfileForm}
//     initialValues={existingProfile}   // optional, for edit mode
//     onSubmit={async (data) => { ... }}
//     submitLabel="Create Profile"
//   />
// ---------------------------------------------------------------------------

import { isLocalRegistryToken, LOCAL_REGISTRY_TOOLS_PENDING } from "../local-registry-token";
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { FormDefinition, FieldDef, RefResolver } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { RefCreator } from "~/lib/field-renderer";
import { validateForm, type FieldError } from "@fenel/engine/validation";
import { formSessionPlan } from "@fenel/engine/authoring/form-runtime";
import { webRegistry } from "~/lib/web-template-registry";
import { FieldRenderer, RefResolverProvider, RefCreatorProvider, EntityComponentProvider, ParamsProvider, CountrySelect, useFieldPresentationRegistry } from "~/lib/field-renderer";
import type { EntityComponentLookup } from "~/lib/field-renderer";
import { LayoutRenderer } from "~/lib/layout-renderer";
import { ensureUserRegistriesLoaded, userViews } from "~/lib/user-registries";
import "./admin-form.css";

// Entity-specific edit components are plain map entries — no engine dispatch.
webRegistry.registerComponent("country-select", CountrySelect);

// Track which user-view names have been pushed into webRegistry so the
// effect doesn't double-register on signal changes.
const registeredUserViewNames = new Set<string>();

/**
 * Entity component lookup — resolves a template name to a registered edit component.
 * Used by RefEditor to render custom editors for entities with defaultTemplate.editComponent.
 */
export const entityComponentLookup: EntityComponentLookup = (templateName: string) => {
  const tmpl = webRegistry.resolve(templateName);
  if (!tmpl?.editComponent) return null;
  return webRegistry.getComponent(tmpl.editComponent) as any;
};

/** Register a custom template for web rendering */
export function registerTemplate(...args: Parameters<typeof webRegistry.register>) {
  webRegistry.register(...args);
}

/** Register a custom component for web rendering */
export function registerComponent(...args: Parameters<typeof webRegistry.registerComponent>) {
  webRegistry.registerComponent(...args);
}

export { webRegistry };

export type AdminFormProps = {
  /** Explicit repository/account context when `definition` is an identified
   * product graph. Omit only for intentionally transient form definitions. */
  fieldRegistry?: ModuleRegistry;
  /** The form definition (from engine constants or API) */
  definition: FormDefinition;
  /** Initial values — for edit mode or defaults */
  initialValues?: Record<string, unknown>;
  /** Called with validated data on submit */
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  /** Submit button text */
  submitLabel?: string;
  /** Saving button text */
  savingLabel?: string;
  /** Called when user cancels (if provided, a cancel button is shown) */
  onCancel?: () => void;
  /** Resolver for ref fields — fetches entity candidates per channel */
  refResolver?: RefResolver;
  /** Creator for inline ref creation — opens creation UI per entity type */
  refCreator?: RefCreator;
  /** Typed parameters available to expression-editing widgets (e.g.
   *  email-template body's `recipient`, `account`). Read by widgets via
   *  `useParams()`. */
  params?: FieldDef[];
};

export function AdminForm(props: AdminFormProps) {
  const inheritedFieldRegistry = useFieldPresentationRegistry();
  const fieldRegistry = () => props.fieldRegistry ?? inheritedFieldRegistry();
  // Pull any user-defined TypeViews / functions into the shared
  // registries on first render. Fire-and-forget — built-ins serve the
  // first frame; user records flow in once the fetch resolves.
  void ensureUserRegistriesLoaded();

  // Whenever the userViews signal updates, register any new ones into
  // webRegistry. Idempotent via the registeredUserViewNames set.
  createEffect(
    () => userViews(),
    (views) => {
      for (const v of views) {
        if (!v.name || registeredUserViewNames.has(v.name)) continue;
        webRegistry.register(v);
        registeredUserViewNames.add(v.name);
      }
    },
  );

  const [values, setValues] = createSignal<Record<string, unknown>>({});
  const [errors, setErrors] = createSignal<FieldError[]>([]);
  const [saving, setSaving] = createSignal(false);

  function setValue(fieldId: string, value: unknown) {
    setValues((v) => ({ ...v, [fieldId]: value }));
  }

  // Resolve layout template for the form
  const layout = createMemo(() => {
    const name = props.definition.template;
    if (!name) return null;
    const tmpl = webRegistry.resolve(name);
    return tmpl?.layout ?? null;
  });

  const session = createMemo(() => {
    // B4 wave 4 lane S: a Local reader's registry is a token with no page
    // registry to plan a form over: refuse visibly, never read its members.
    if (isLocalRegistryToken(fieldRegistry())) throw new Error(LOCAL_REGISTRY_TOOLS_PENDING);
    return formSessionPlan({
    registry: fieldRegistry(),
    definition: props.definition,
    initialValues: props.initialValues,
    currentValues: values(),
    errors: errors(),
    layout: layout(),
    submitLabel: props.submitLabel,
    savingLabel: props.savingLabel,
    defaultSubmitLabel: "Save",
    defaultSavingLabel: "Saving...",
    submitLabelPriority: "definition-first",
    renderMode: "auto",
  });
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setErrors([]);

    const result = validateForm(props.definition, session().values, null, {
      registry: fieldRegistry(),
    });
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    try {
      await props.onSubmit(result.data);
    } finally {
      setSaving(false);
    }
  }

  const formBody = () => (
    <>
      <Show when={session().validation.hasErrors}>
        <div class="admin-form-errors">
          <For each={session().validation.errors}>
            {(err) => <div class="admin-form-error">{err.path}: {err.message}</div>}
          </For>
        </div>
      </Show>

      {/* Layout template path: sections/rows/columns */}
      <Show when={session().renderMode === "layout" ? session().layout : null} fallback={
        /* Fallback: sequential field rendering */
        <For each={session().fields}>
          {(fieldPlan) => (
            <div
              style={fieldPlan.columns ? { "grid-column": `span ${fieldPlan.columns}` } : undefined}
            >
              <FieldRenderer
                registry={fieldRegistry()}
                field={fieldPlan.field}
                value={fieldPlan.value}
                onChange={(v) => setValue(fieldPlan.name, v)}
              />
              <Show when={fieldPlan.error}>
                <div class="admin-form-error">{fieldPlan.error}</div>
              </Show>
            </div>
          )}
        </For>
      }>
        {(l) => (
          <LayoutRenderer
            layout={l()}
            fields={session().fields.map((fieldPlan) => fieldPlan.field)}
            values={session().values}
            onChange={setValue}
            registry={webRegistry}
            fieldRegistry={fieldRegistry()}
            mode="edit"
            errors={session().validation.errorMap}
          />
        )}
      </Show>

      <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem">
        <button class="btn btn-primary" type="submit" disabled={saving()}>
          {saving() ? session().savingLabel : session().submitLabel}
        </button>
        <Show when={props.onCancel}>
          <button class="btn" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </Show>
      </div>
    </>
  );

  const wrappedBody = () => {
    let body = formBody();
    // Always provide entity component lookup (for static entities like country)
    body = <EntityComponentProvider value={entityComponentLookup}>{body}</EntityComponentProvider>;
    if (props.params && props.params.length > 0) {
      body = <ParamsProvider value={props.params}>{body}</ParamsProvider>;
    }
    if (props.refCreator) {
      body = <RefCreatorProvider value={props.refCreator}>{body}</RefCreatorProvider>;
    }
    if (props.refResolver) {
      body = <RefResolverProvider value={props.refResolver!}>{body}</RefResolverProvider>;
    }
    return body;
  };

  return (
    <form class="admin-form card" onSubmit={handleSubmit} style="margin-bottom: 1rem">
      {wrappedBody()}
    </form>
  );
}
