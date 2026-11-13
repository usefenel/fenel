// C1 controlled seams for request-lifecycle tests, never imported by the app.
// The complete production form hosts, async shim, router, signals and DOM stay
// intact. Registry hydration, Fenel form/read planning and the scalar renderer
// are controlled here so this test does not prepare the entire language graph.
import type { JSX } from "@solidjs/web";

const field = { name: "email" };
export async function buildLocalAccountFieldRegistry() { return {}; }
export function resolveLocalIdentifiedType() { return { $record: { fields: [field] } }; }

export function formSessionPlan(options: {
  currentValues: Record<string, unknown>;
  submitLabel?: string;
  definition?: { config?: { submitLabel?: string } };
  defaultSubmitLabel: string;
  defaultSavingLabel: string;
}) {
  return {
    fields: [{ name: "email", field, value: options.currentValues.email ?? "" }],
    values: options.currentValues,
    submitLabel: options.submitLabel ?? options.definition?.config?.submitLabel ?? options.defaultSubmitLabel,
    savingLabel: options.defaultSavingLabel,
  };
}
export function formSuccessPlan(_value: unknown, options: { thankYouText: string }) {
  return { kind: "thank-you", text: options.thankYouText };
}
export function surfaceReadValuePlan(value: unknown) { return value; }
export function ReadPlanValue(props: { plan: unknown }): JSX.Element { return <span>{String(props.plan)}</span>; }

export function FieldRenderer(props: {
  field: { name: string };
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  return <div class="fr-field">
    <label class="fr-label" for="fixture-email">Email</label>
    <div class="fr-input-wrap"><input class="fe-input" id="fixture-email" name={props.field.name} type="text"
      value={String(props.value ?? "")} onInput={event => props.onChange(event.currentTarget.value)} /></div>
  </div>;
}
