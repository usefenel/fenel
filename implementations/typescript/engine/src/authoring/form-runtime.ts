import type {
  FieldDef,
  FenelType,
  FormDefinition,
  LayoutDef,
  LocaleString,
  SlideConfig,
  SlideDef,
} from "../types";
import type { FieldError } from "../validate";
import type { ModuleRegistry } from "../registry";
import {
  dispatchedFormDefaultsPlan,
  dispatchedFormFieldsPlan,
  dispatchedFormRecordDrillPlan,
  dispatchedFormSessionPlan,
  dispatchedFormSlidePlan,
  dispatchedFormSuccessPlan,
  dispatchedFormValidationPlan,
} from "../engine-bodies-dispatch";
import { defaultValueFor, formDefinitionFields } from "../field-meta";
import { canonical } from "../locale";
import { dispatchRegistry } from "../system-entities";
import {
  Just,
  type Maybe,
  Nothing,
} from "../type-foundation";
import { fieldEditPlan } from "./field-render";

export type FormRenderMode = "sequential" | "layout" | "slide";

export type FormValidationPlan = {
  errors: Array<{ path: string; message: string }>;
  errorMap: Record<string, string>;
  hasErrors: boolean;
};

export type FormFieldSessionPlan = {
  name: string;
  label: string;
  field: FieldDef;
  value: unknown;
  error?: string;
  columns?: number;
  drillable: boolean;
};

export type FormSessionPlan = {
  fields: FormFieldSessionPlan[];
  values: Record<string, unknown>;
  validation: FormValidationPlan;
  submitLabel: string;
  savingLabel: string;
  renderMode: FormRenderMode;
  layout?: LayoutDef;
};

export type FormSuccessPlan =
  | { kind: "none" }
  | { kind: "thank-you"; text: string }
  | { kind: "link"; url: string; label: string }
  | { kind: "typed-read-plan"; value: unknown; text: string }
  | { kind: "unsupported"; text: string };

export type FormSlideFieldPlan = FormFieldSessionPlan;

export type FormSlide = {
  title?: string;
  fields: FormSlideFieldPlan[];
};

export type FormSlidePlan = {
  slides: FormSlide[];
};

export type FormRecordDrillPlan = {
  label: string;
  prefix: string;
  slides: FormSlide[];
};

export type FormDefinitionInput = Partial<FormDefinition> & {
  submit_label?: LocaleString;
  fields?: unknown;
};

export type FormRuntimeSource = {
  /** Explicit product/account presentation context. Omit only for transient
   * authoring facts, which intentionally receive no global field facets. */
  registry?: ModuleRegistry;
  definition?: FormDefinitionInput;
  type?: FenelType;
  fields?: readonly FieldDef[];
};

export type FormSessionPlanArgs = FormRuntimeSource & {
  currentValues?: Record<string, unknown>;
  initialValues?: Record<string, unknown>;
  errors?: readonly FieldError[];
  layout?: LayoutDef | null;
  submitLabel?: LocaleString;
  savingLabel?: LocaleString;
  defaultSubmitLabel?: string;
  defaultSavingLabel?: string;
  submitLabelPriority?: "override-first" | "definition-first";
  renderMode?: FormRenderMode | "auto";
};

type FormFieldFact = {
  name: string;
  label: string;
  field: FieldDef;
  columns: Maybe<number>;
  children: FormFieldFact[];
  hasDefault: boolean;
  defaultValue: unknown;
};

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return canonical(value as LocaleString);
  return String(value);
}

function maybeNumber(value: number | undefined): Maybe<number> {
  return typeof value === "number" ? Just(value) : Nothing;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readOptionalMaybe<T>(value: unknown): T | undefined {
  const record = asRecord(value);
  if (!record) return value === null || value === undefined ? undefined : value as T;
  if (record.$tag === "Nothing") return undefined;
  if (record.$tag === "Just") return record._0 as T;
  return value as T;
}

function readOptionalString(value: unknown): string | undefined {
  const v = readOptionalMaybe<unknown>(value);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const v = readOptionalMaybe<unknown>(value);
  return typeof v === "number" ? v : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  const v = readOptionalMaybe<unknown>(value);
  return typeof v === "boolean" ? v : undefined;
}

function resolveFields(source: FormRuntimeSource): FieldDef[] {
  if (source.fields) return [...source.fields];
  if (source.definition) {
    return formDefinitionFields(source.definition as { type?: FenelType; fields?: unknown }) as FieldDef[];
  }
  if (source.type) {
    return formDefinitionFields({ type: source.type }) as FieldDef[];
  }
  return [];
}

function defaultFact(field: FieldDef): { hasDefault: boolean; defaultValue: unknown } {
  // Boundary blocker: atomic HasDefault lookup still depends on the mutable
  // dispatch registry. Fenel owns record assembly and override semantics once
  // this registry-derived fact is supplied.
  const value = defaultValueFor(field.type, dispatchRegistry);
  return { hasDefault: value !== null && value !== undefined, defaultValue: value };
}

function marshalFormField(
  registry: ModuleRegistry | undefined,
  field: FieldDef,
  recordValues?: Record<string, unknown>,
  depth = 0,
): FormFieldFact {
  // Child-field synthesis is already Fenel-owned by fieldEditPlan. This wrapper
  // only reuses that public plan and forwards child facts into form-runtime.
  const plan = fieldEditPlan({ registry, field, recordValues });
  const defaulted = defaultFact(field);
  let children: FormFieldFact[] = [];
  if (depth < 4 && (plan.editor.kind === "record" || plan.editor.kind === "freeform-record")) {
    children = plan.editor.fields.map((child) => marshalFormField(registry, child, recordValues, depth + 1));
  }
  return {
    name: field.name,
    label: plan.label,
    field,
    columns: maybeNumber(plan.columns),
    children,
    ...defaulted,
  };
}

function marshalFields(
  registry: ModuleRegistry | undefined,
  fields: readonly FieldDef[],
  recordValues?: Record<string, unknown>,
): FormFieldFact[] {
  return fields.map((field) => marshalFormField(registry, field, recordValues));
}

function marshalErrors(errors: readonly FieldError[] | undefined): Array<{ path: string; message: string }> {
  return (errors ?? []).map((error) => ({
    path: error.path,
    message: textOf(error.message),
  }));
}

function normalizeFieldPlan(value: unknown): FormFieldSessionPlan | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const field = readOptionalMaybe<FieldDef>(record.field);
  if (!field) return undefined;
  return {
    name: typeof record.name === "string" ? record.name : field.name,
    label: typeof record.label === "string" ? record.label : field.name,
    field,
    value: readOptionalMaybe(record.value),
    error: readOptionalString(record.error),
    columns: readOptionalNumber(record.columns),
    drillable: readOptionalBoolean(record.drillable) ?? record.drillable === true,
  };
}

function normalizeValidationPlan(value: unknown): FormValidationPlan {
  const record = asRecord(value) ?? {};
  const rawErrors = Array.isArray(record.errors) ? record.errors : [];
  const errorMap = asRecord(record.errorMap) ?? {};
  return {
    errors: rawErrors.map((error) => {
      const e = asRecord(error) ?? {};
      return {
        path: typeof e.path === "string" ? e.path : "",
        message: typeof e.message === "string" ? e.message : textOf(e.message),
      };
    }),
    errorMap: Object.fromEntries(
      Object.entries(errorMap).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    hasErrors: record.hasErrors === true,
  };
}

function normalizeLayout(value: unknown): LayoutDef | undefined {
  const record = asRecord(value);
  return Array.isArray(record?.sections) ? record as LayoutDef : undefined;
}

function normalizeRenderMode(value: unknown): FormRenderMode {
  return value === "layout" || value === "slide" ? value : "sequential";
}

function normalizeSessionPlan(value: unknown): FormSessionPlan {
  const record = asRecord(value) ?? {};
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const fields = fieldsRaw.map(normalizeFieldPlan).filter((field): field is FormFieldSessionPlan => !!field);
  const values = asRecord(record.values) ?? {};
  return {
    fields,
    values,
    validation: normalizeValidationPlan(record.validation),
    submitLabel: typeof record.submitLabel === "string" ? record.submitLabel : "Submit",
    savingLabel: typeof record.savingLabel === "string" ? record.savingLabel : "Saving...",
    renderMode: normalizeRenderMode(record.renderMode),
    layout: normalizeLayout(record.layout),
  };
}

function normalizeSlide(value: unknown): FormSlide | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const rawFields = Array.isArray(record.fields) ? record.fields : [];
  return {
    title: readOptionalString(record.title),
    fields: rawFields.map(normalizeFieldPlan).filter((field): field is FormSlideFieldPlan => !!field),
  };
}

function normalizeSlidePlan(value: unknown): FormSlidePlan {
  const record = asRecord(value) ?? {};
  const slides = Array.isArray(record.slides) ? record.slides : [];
  return {
    slides: slides.map(normalizeSlide).filter((slide): slide is FormSlide => !!slide),
  };
}

export function formFieldsPlan(source: FormRuntimeSource): FieldDef[] {
  const fields = resolveFields(source);
  return dispatchedFormFieldsPlan({ fields }) as FieldDef[];
}

export function formDefaultsPlan(source: FormRuntimeSource): Record<string, unknown> {
  const fields = marshalFields(source.registry, resolveFields(source));
  const result = dispatchedFormDefaultsPlan({ fields });
  return asRecord(result) ?? {};
}

export function formValidationPlan(errors: readonly FieldError[] | undefined): FormValidationPlan {
  return normalizeValidationPlan(dispatchedFormValidationPlan({ errors: marshalErrors(errors) }));
}

export function formSessionPlan(args: FormSessionPlanArgs): FormSessionPlan {
  const fields = resolveFields(args);
  const recordValues = args.currentValues ?? args.initialValues;
  const layout = args.layout ?? null;
  return normalizeSessionPlan(dispatchedFormSessionPlan({
    fields: marshalFields(args.registry, fields, recordValues),
    initialValues: args.initialValues ?? {},
    currentValues: args.currentValues ?? {},
    errors: marshalErrors(args.errors),
    hasLayout: layout !== null,
    layout,
    requestedMode: args.renderMode ?? "auto",
    submitLabelPriority: args.submitLabelPriority ?? "override-first",
    submitLabelOverride: textOf(args.submitLabel),
    configSubmitLabel: textOf(args.definition?.config?.submitLabel),
    legacySubmitLabel: textOf(args.definition?.submit_label),
    defaultSubmitLabel: args.defaultSubmitLabel ?? "Submit",
    savingLabelOverride: textOf(args.savingLabel),
    defaultSavingLabel: args.defaultSavingLabel ?? "Saving...",
  }));
}

export function formSuccessPlan(
  value: unknown,
  options: {
    submitted?: boolean;
    hasValue?: boolean;
    thankYouText?: string;
  } = {},
): FormSuccessPlan {
  const result = dispatchedFormSuccessPlan({
    submitted: options.submitted === true,
    hasValue: options.hasValue ?? (value !== undefined && value !== null),
    value,
    thankYouText: options.thankYouText ?? "Thank you for your submission!",
  });
  const record = asRecord(result) ?? {};
  const kind = typeof record.kind === "string" ? record.kind : "unsupported";
  switch (kind) {
    case "none":
      return { kind };
    case "thank-you":
      return { kind, text: typeof record.text === "string" ? record.text : "Thank you for your submission!" };
    case "link":
      return {
        kind,
        url: typeof record.url === "string" ? record.url : "",
        label: typeof record.label === "string" ? record.label : "Continue",
      };
    case "typed-read-plan":
      return {
        kind,
        value: record.value,
        text: typeof record.text === "string" ? record.text : "Thank you for your submission!",
      };
    default:
      return { kind: "unsupported", text: typeof record.text === "string" ? record.text : "Unsupported success value" };
  }
}

function marshalSlideDefs(slides: readonly SlideDef[] | undefined): Array<{ title: string; fields: string[] }> {
  return (slides ?? []).map((slide) => ({
    title: textOf(slide.title),
    fields: [...slide.fields],
  }));
}

function normalizeLayoutForSlide(layout: LayoutDef | null | undefined): LayoutDef {
  return layout ?? { sections: [] };
}

export function formSlidePlan(args: {
  registry?: ModuleRegistry;
  layout?: LayoutDef | null;
  fields: readonly FieldDef[];
  values: Record<string, unknown>;
  config?: SlideConfig;
  errors?: readonly FieldError[];
}): FormSlidePlan {
  const facts = marshalFields(args.registry, args.fields, args.values);
  return normalizeSlidePlan(dispatchedFormSlidePlan({
    layout: normalizeLayoutForSlide(args.layout),
    fields: facts,
    values: args.values,
    errors: marshalErrors(args.errors),
    slides: marshalSlideDefs(args.config?.slides),
  }));
}

export function formRecordDrillPlan(
  field: FieldDef,
  args: {
    registry?: ModuleRegistry;
    values: Record<string, unknown>;
    errors?: readonly FieldError[];
  },
): FormRecordDrillPlan {
  const fact = marshalFormField(args.registry, field, args.values);
  const result = dispatchedFormRecordDrillPlan({
    parentName: fact.name,
    parentLabel: fact.label,
    children: fact.children,
    values: args.values,
    errors: marshalErrors(args.errors),
  });
  const record = asRecord(result) ?? {};
  return {
    label: typeof record.label === "string" ? record.label : fact.label,
    prefix: typeof record.prefix === "string" ? record.prefix : fact.name,
    slides: normalizeSlidePlan(record).slides,
  };
}
