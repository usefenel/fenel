// ---------------------------------------------------------------------------
// Template Registry — resolves TypeViews by name
//
// Flat namespace. Templates can extend other templates. Per-FenelType
// defaults can be set so a renderer can ask "what TypeView should I use
// for a $record?" without each field carrying an explicit template.
//
// Component registrations are per-channel — each channel (web, telegram)
// registers its own implementations. The registry stores them by name.
//
// Resolution order for a FieldDef:
//   1. Per-type default-rules (conditional, JSON Logic)
//   2. Per-type fallback default
//   3. Null (use built-in renderer)
// ---------------------------------------------------------------------------

import type { TypeView, FieldDef, TemplateRule, EditDisplay, ReadDisplay } from "./types";
import {
  mergeSurfaceDisplay,
  mergeSurfaceEditDisplay,
  mergeSurfaceReadDisplay,
  resolveSurfaceDefaultTemplate,
  resolveSurfaceTypeView,
  type SurfaceTemplateDefault,
  type SurfaceTemplateRuleGroup,
} from "./authoring/surface";
import { type Maybe } from "./type-foundation";

/** Right-biased Maybe-aware merge of two EditDisplay-bearing Maybes. */
export function mergeEdit(parent: Maybe<EditDisplay>, child: Maybe<EditDisplay>): Maybe<EditDisplay> {
  return mergeSurfaceEditDisplay(parent, child);
}

/** Right-biased Maybe-aware merge of two ReadDisplay-bearing Maybes. */
export function mergeRead(parent: Maybe<ReadDisplay>, child: Maybe<ReadDisplay>): Maybe<ReadDisplay> {
  return mergeSurfaceReadDisplay(parent, child);
}

/** Right-biased Maybe-aware merge of two TypeView.display values. Phase 7d
 *  sibling of mergeRead/mergeEdit. */
export function mergeDisplay(
  parent: TypeView["display"],
  child: TypeView["display"],
): TypeView["display"] {
  return mergeSurfaceDisplay(parent, child);
}

export type TemplateRegistry = {
  // ---- Templates (data) ----
  register(template: TypeView): void;
  registerAll(templates: TypeView[]): void;
  get(name: string): TypeView | null;
  /** Resolve with inheritance (extends chain) */
  resolve(name: string): TypeView | null;
  /** Resolve the template for a field in context */
  resolveForField(field: FieldDef, context: Record<string, unknown>): TypeView | null;
  list(): TypeView[];

  // ---- Schema type defaults ----
  setDefault(schemaType: string, templateName: string): void;
  /** Conditional defaults for a schema type */
  setDefaultRules(schemaType: string, rules: TemplateRule[]): void;
  getDefault(schemaType: string, context: Record<string, unknown>): TypeView | null;

  // ---- Components (code, per-channel) ----
  registerComponent(name: string, impl: unknown): void;
  getComponent(name: string): unknown | null;
  /** Host code availability only; component implementations stay private. */
  listComponentNames?(): string[];
};

export function createTemplateRegistry(): TemplateRegistry {
  const templates = new Map<string, TypeView>();
  const components = new Map<string, unknown>();
  const defaults = new Map<string, string>();
  const defaultRules = new Map<string, TemplateRule[]>();

  const templateList = () => Array.from(templates.values());
  const defaultEntries = (): SurfaceTemplateDefault[] =>
    Array.from(defaults.entries()).map(([schemaType, templateName]) => ({
      schemaType,
      templateName,
    }));
  const defaultRuleGroups = (): SurfaceTemplateRuleGroup[] =>
    Array.from(defaultRules.entries()).map(([schemaType, rules]) => ({
      schemaType,
      rules,
    }));

  function get(name: string): TypeView | null {
    return templates.get(name) ?? null;
  }

  function resolve(name: string): TypeView | null {
    return resolveSurfaceTypeView(templateList(), name) ?? null;
  }

  function resolveForField(
    field: FieldDef,
    context: Record<string, unknown>,
  ): TypeView | null {
    // 1. Type-shape default (with conditional rules) — uses the FenelType's
    //    top-level constructor name as the registry key.
    const typeKey = Object.keys(field.type)[0];
    if (typeKey) return resolveSurfaceDefaultTemplate(
      templateList(),
      defaultEntries(),
      defaultRuleGroups(),
      typeKey,
      context,
    ) ?? null;

    // 2. No template
    return null;
  }

  return {
    register(template) {
      templates.set(template.name, template);
    },
    registerAll(list) {
      for (const t of list) templates.set(t.name, t);
    },
    get,
    resolve,
    resolveForField,
    list: templateList,

    setDefault(schemaType, templateName) {
      defaults.set(schemaType, templateName);
    },
    setDefaultRules(schemaType, rules) {
      defaultRules.set(schemaType, rules);
    },
    getDefault(schemaType, context) {
      return resolveSurfaceDefaultTemplate(
        templateList(),
        defaultEntries(),
        defaultRuleGroups(),
        schemaType,
        context,
      ) ?? null;
    },

    registerComponent(name, impl) {
      components.set(name, impl);
    },
    getComponent(name) {
      return components.get(name) ?? null;
    },
    listComponentNames() {
      return Array.from(components.keys());
    },
  };
}
