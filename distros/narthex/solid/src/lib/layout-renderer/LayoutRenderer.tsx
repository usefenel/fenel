// ---------------------------------------------------------------------------
// Web Template Renderer — interprets TypeViews as SolidJS JSX
//
// Two modes:
//   ReadValue  — renders a value for display (badges, formatted text, etc.)
//   EditValue  — renders an editor (delegates to FieldRenderer, with overrides)
//
// LayoutRenderer — renders layout templates (sections, rows, columns)
//   Used by AdminForm when a form/field has a layout template.
//
// Component escape hatch: if a template specifies component/readComponent/
// editComponent, the renderer looks it up in the TemplateRegistry and
// delegates to the registered SolidJS component.
// ---------------------------------------------------------------------------

import { isLocalRegistryToken, LOCAL_REGISTRY_TOOLS_PENDING } from "../local-registry-token";
import { Show, For, createMemo, createSignal } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import type {
  TypeView,
  FieldDef,
  FenelType,
  LayoutDef,
} from "@fenel/engine/types";
import type { TemplateRegistry } from "@fenel/engine/template-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import {
  createSurfaceEnvironment,
  surfaceLayoutRenderPlan,
  surfaceReadValuePlan,
  type SurfaceLayoutRowPlan,
  type SurfaceLayoutRenderPlan,
  type SurfaceLayoutSectionPlan,
  type SurfaceLayoutSlotPlan,
  type SurfaceReadValuePlan,
} from "@fenel/engine/authoring/surface";
import { canonical } from "@fenel/engine/locale";
import { fieldType, fieldMeta, type FieldMetadata } from "@fenel/engine";
import { FieldRenderer } from "~/lib/field-renderer";
import type { Component } from "solid-js";
import { Nothing, peelMaybeValue } from "@fenel/engine/type-foundation";
import { TypedReadValue } from "./TypedReadValue";
import type { ContainedValuePreview } from "~/lib/data-transfer/DataValueSurface";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "~/lib/data-occurrence";

// ---------------------------------------------------------------------------
// Template component props contract
// ---------------------------------------------------------------------------

/** Browser occurrence transport; source/path policy remains with its owner. */
export type DataReadOccurrenceProps = {
  occurrence?: DataOccurrenceSource;
  dataPath?: readonly (string | number)[];
  onDataContext?: (event: MouseEvent, data: ContainedValuePreview) => void;
};

export type TemplateComponentProps = DataReadOccurrenceProps & {
  field: FieldDef;
  type: FenelType;
  meta: FieldMetadata;
  value: unknown;
  onChange?: (value: unknown) => void;
  mode: "read" | "edit";
  template: TypeView;
  context: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// ReadValue — renders a value in read-only mode using a template
// ---------------------------------------------------------------------------

export function ReadValue(props: DataReadOccurrenceProps & {
  value: unknown;
  template: TypeView;
  registry: TemplateRegistry;
  /** Explicit repository/account field presentation context. */
  fieldRegistry?: ModuleRegistry;
  field?: FieldDef;
  context?: Record<string, unknown>;
  /** An inert reader projection; null is a prepared display miss. */
  readPlan?: SurfaceReadValuePlan | null;
  /** The existing typed owner supplies compound fallback without redispatch. */
  fallback?: JSX.Element;
}) {
  // Check for custom readComponent
  const customName = () => props.template.readComponent ?? props.template.component;
  const custom = () => customName() ? props.registry.getComponent(customName()!) as Component<TemplateComponentProps> | null : null;
  const readDisplay = () => peelMaybeValue(peelMaybeValue(props.template.display)?.read ?? Nothing) ?? undefined;
  const plannedRead = createMemo(() => {
    if (props.readPlan !== undefined) return props.readPlan;
    const display = readDisplay();
    return display ? surfaceReadValuePlan(props.value, display, "read-display") : null;
  }, { lazy: true });
  const valueType = () => props.field ? props.readPlan !== undefined ? props.field.type : fieldType(props.field) : undefined;

  return (
    <DataOccurrenceBoundary value={props.value} type={valueType()} occurrence={props.occurrence}
      dataPath={props.dataPath} onDataContext={props.onDataContext}>
    <Show when={custom()} fallback={
      <Show when={plannedRead()} fallback={props.fallback ?? <TypedReadValue value={props.value}
        type={valueType()} fieldRegistry={props.fieldRegistry}
        occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext} />}>
      {plan => <ReadPlanValue plan={plan()} />}
      </Show>
    }>{(component) => <Dynamic component={component()}
      field={props.field ?? { name: "", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }}
      type={valueType() ?? { $ref: "String" }}
      meta={props.field ? props.readPlan !== undefined ? props.field.meta : fieldMeta(props.field) : {}}
      value={props.value}
      mode="read"
      template={props.template}
      context={props.context ?? {}}
      occurrence={props.occurrence}
      dataPath={props.dataPath}
      onDataContext={props.onDataContext}
    />}</Show>
    </DataOccurrenceBoundary>
  );
}

export function ReadPlanValue(props: { plan: SurfaceReadValuePlan }) {
  const colorClass = () => props.plan.color ? ` ${props.plan.kind}-${props.plan.color}` : "";
  const dateText = () => {
    const d = new Date(String(props.plan.raw ?? ""));
    return Number.isNaN(d.getTime()) ? props.plan.text : d.toLocaleDateString();
  };
  return (
    <>
      <Show when={props.plan.kind === "badge"}>
        <span class={`badge${colorClass()}`}>{props.plan.text}</span>
      </Show>
      <Show when={props.plan.kind === "chip"}>
        <span class={`chip${colorClass()}`}>{props.plan.text}</span>
      </Show>
      <Show when={props.plan.kind === "link"}>
        <a href={props.plan.href ?? String(props.plan.raw ?? "")} class="link">{props.plan.text}</a>
      </Show>
      <Show when={props.plan.hostFormat === "date-short"}>
        <span class="mono text-muted">
          {props.plan.empty ? props.plan.text : dateText()}
        </span>
      </Show>
      <Show when={props.plan.hostFormat === "relative-time"}>
        <span class="text-muted">{formatRelative(props.plan.raw)}</span>
      </Show>
      <Show when={props.plan.kind === "text"}>
        {/* A number is never broken across lines. */}
        <span style={typeof props.plan.raw === "number" || typeof props.plan.raw === "bigint" ? "white-space: nowrap;" : undefined}>{props.plan.text}</span>
      </Show>
    </>
  );
}

function formatRelative(value: unknown): string {
  if (!value) return "-";
  const d = new Date(String(value));
  const now = Date.now();
  const diff = now - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;

  if (abs < 60_000) return "just now";
  if (abs < 3600_000) {
    const m = Math.floor(abs / 60_000);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400_000) {
    const h = Math.floor(abs / 3600_000);
    return future ? `in ${h}h` : `${h}h ago`;
  }
  const days = Math.floor(abs / 86400_000);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  return d.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// LayoutRenderer — renders sections/rows/columns from a LayoutDef
// ---------------------------------------------------------------------------

export function LayoutRenderer(props: DataReadOccurrenceProps & {
  layout: LayoutDef;
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  registry: TemplateRegistry;
  /** Explicit repository/account field presentation context. */
  fieldRegistry?: ModuleRegistry;
  mode: "read" | "edit";
  errors?: Record<string, string>;
  /** The same source layout owner may prepare this in the reader worker. */
  layoutPlan?: SurfaceLayoutRenderPlan;
  /** Preserve the enclosing data when the source plan has no readable field. */
  fallback?: JSX.Element;
}) {
  const plan = createMemo(() => props.layoutPlan !== undefined ? props.layoutPlan : isLocalRegistryToken(props.fieldRegistry)
    // B4 wave 4 lane S: a Local reader's registry token has no members to
    // plan a layout over on the page: refuse visibly (its worker plans it).
    ? (() => { throw new Error(LOCAL_REGISTRY_TOOLS_PENDING); })() : surfaceLayoutRenderPlan({
    environment: createSurfaceEnvironment({ registry: props.fieldRegistry }),
    layout: props.layout,
    fields: props.fields,
    values: props.values,
    errors: props.errors,
    mode: props.mode,
    resolveTemplate: (name) => props.registry.resolve(name) ?? undefined,
  }));
  const missingFields = createMemo(() => {
    const slots = plan().sections.flatMap(section => section.rows.flatMap(row => row.slots));
    return slots.length > 0 && slots.every(slot => slot.fallbackKind === "missing-field");
  });

  function renderSlot(slot: SurfaceLayoutSlotPlan) {
    if (!slot.field || slot.fallbackKind === "missing-field") return null;
    const style: Record<string, string> = {};
    if (slot.span) style["grid-column"] = `span ${slot.span}`;

    if (slot.componentName) {
      const Comp = props.registry.getComponent(slot.componentName) as Component<TemplateComponentProps> | null;
      if (Comp) {
        return (
          <div style={style}>
            <DataOccurrenceBoundary value={slot.value} type={props.layoutPlan !== undefined ? slot.field.type : fieldType(slot.field)} label={slot.label}
              occurrence={props.occurrence} dataPath={[...(props.dataPath ?? []), slot.fieldName]} onDataContext={props.onDataContext}>
            <Comp
              field={slot.field}
              type={props.layoutPlan !== undefined ? slot.field.type : fieldType(slot.field)}
              meta={props.layoutPlan !== undefined ? slot.field.meta : fieldMeta(slot.field)}
              value={slot.value}
              onChange={props.mode === "edit" ? (v) => props.onChange(slot.fieldName, v) : undefined}
              mode={props.mode}
              template={slot.template ?? { name: slot.templateName ?? "", display: Nothing }}
              context={plan().context}
              occurrence={props.occurrence}
              dataPath={[...(props.dataPath ?? []), slot.fieldName]}
              onDataContext={props.onDataContext}
            />
            </DataOccurrenceBoundary>
          </div>
        );
      }
    }

    if (props.mode === "edit") {
      return (
        <div style={style}>
          <FieldRenderer
            registry={props.fieldRegistry}
            field={slot.field}
            value={slot.value}
            onChange={(v) => props.onChange(slot.fieldName, v)}
          />
          <Show when={slot.error}>
            <div class="admin-form-error">{slot.error}</div>
          </Show>
        </div>
      );
    }

    return (
      <div style={style} class="fr-field">
        <label class="fr-label">{slot.label}</label>
        <Show when={!slot.template || !peelMaybeValue(peelMaybeValue(slot.template.display)?.read ?? Nothing)} fallback={
          <DataOccurrenceBoundary value={slot.value} type={props.layoutPlan !== undefined ? slot.field.type : fieldType(slot.field)} label={slot.label}
            occurrence={props.occurrence} dataPath={[...(props.dataPath ?? []), slot.fieldName]} onDataContext={props.onDataContext}>
            <ReadPlanValue plan={props.layoutPlan !== undefined ? slot.display! : slot.display ?? surfaceReadValuePlan(slot.value, undefined, "scalar")} />
          </DataOccurrenceBoundary>
        }>
          <TypedReadValue type={props.layoutPlan !== undefined ? slot.field.type : fieldType(slot.field)} value={slot.value} fieldRegistry={props.fieldRegistry}
            occurrence={props.occurrence} dataPath={[...(props.dataPath ?? []), slot.fieldName]} onDataContext={props.onDataContext} />
        </Show>
      </div>
    );
  }

  function renderRow(row: SurfaceLayoutRowPlan) {
    return (
      <div
        class="tpl-row"
        style={{
          display: "grid",
          "grid-template-columns": "repeat(12, 1fr)",
          gap: row.gap ?? "0.75rem",
        }}
      >
        <For each={row.slots}>
          {(slot) => renderSlot(slot)}
        </For>
      </div>
    );
  }

  function renderSection(section: SurfaceLayoutSectionPlan) {
    if (section.collapsible) {
      const [collapsed, setCollapsed] = createSignal(section.defaultCollapsed ?? false);
      return (
        <div class="tpl-section tpl-section--collapsible">
          <Show when={section.title}>
            <div
              class="tpl-section-title tpl-section-title--toggle"
              onClick={() => setCollapsed(!collapsed())}
            >
              <span>{section.title ? canonical(section.title) : undefined}</span>
              <span class="tpl-section-chevron">{collapsed() ? "+" : "-"}</span>
            </div>
          </Show>
          <Show when={section.description}>
            <div class="tpl-section-desc">{section.description ? canonical(section.description) : undefined}</div>
          </Show>
          <Show when={!collapsed()}>
            <div class="tpl-section-body">
              <For each={section.rows}>{(row) => renderRow(row)}</For>
            </div>
          </Show>
        </div>
      );
    }

    return (
      <div class="tpl-section">
        <Show when={section.title}>
          <div class="tpl-section-title">{section.title ? canonical(section.title) : undefined}</div>
        </Show>
        <Show when={section.description}>
          <div class="tpl-section-desc">{section.description ? canonical(section.description) : undefined}</div>
        </Show>
        <div class="tpl-section-body">
          <For each={section.rows}>{(row) => renderRow(row)}</For>
        </div>
      </div>
    );
  }

  return (
    <Show when={!missingFields()} fallback={props.fallback}><div class="tpl-layout">
      <For each={plan().sections}>
        {(section) => renderSection(section)}
      </For>
    </div></Show>
  );
}
