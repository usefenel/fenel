import type {
  EditDisplay,
  Expression,
  FieldDef,
  FenelType,
  LayoutDef,
  ListDisplayConfig,
  LocaleString,
  ReadDisplay,
  SelectOption,
  TemplateRule,
  TypeView,
} from "../types";
import type { ModuleRegistry } from "../registry";
import { resolveIdentifiedFieldView } from "../identified-field-view";
import {
  dispatchedSurfaceDefaultTemplateName,
  dispatchedSurfaceConditionContext,
  dispatchedSurfaceConditionScopeForType,
  dispatchedSurfaceDefaultLayoutForType,
  dispatchedSurfaceDefaultListDisplayForType,
  dispatchedSurfaceBuiltinTypeViews,
  dispatchedSurfaceFieldCandidates,
  dispatchedSurfaceMergeDisplay,
  dispatchedSurfaceMergeEdit,
  dispatchedSurfaceMergeRead,
  dispatchedSurfacePlanForType,
  dispatchedSurfaceListDisplayRenderPlan,
  dispatchedSurfaceResolveDefaultTemplate,
  dispatchedSurfaceTargetTypeOptions,
  dispatchedSurfaceTypeViewsForSurface,
  dispatchEngineBody,
} from "../engine-bodies-dispatch";
import { truthy, type EvaluateContext } from "../json-logic";
import { resolveEvaluator } from "../evaluator-class";
import {
  Just,
  type Maybe,
  Nothing,
  peelMaybeValue,
  refHandle as rawRefHandle,
} from "../type-foundation";
import type {
  AuthoringCatalogSnapshot,
  AuthoringEnvironment,
} from "./environment";
import { refHandle as authoringRefHandle, resolveAuthoringTypeRef } from "./environment";
import { peelListForAuthoring, peelMaybeForAuthoring } from "./type-authoring";

export type SurfaceMode = "read" | "edit" | "list";

export type SurfaceTargetTypeOption = {
  value: string;
  label: string;
  group: "Scalar" | "Format" | "Entity" | "Domain" | "Other";
  description?: string;
  type?: FenelType;
  entityId?: string;
};

export type SurfaceFieldCandidate = {
  path: string;
  label: string;
  type: FenelType;
  field: FieldDef;
  depth: number;
  source: "record-field" | "list-item-field" | "synthetic";
};

export type SurfaceConditionScope = {
  mode: SurfaceMode;
  channel: string;
  variables: Array<{ name: string; label?: string; source?: string }>;
};

export type ReadDisplayDraft = {
  format?: string;
  transform?: string;
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
  icon?: string;
  emptyText?: LocaleString;
  prefix?: LocaleString;
  suffix?: LocaleString;
  refTemplate?: string;
};

export type EditDisplayDraft = {
  widget?: string;
  placeholder?: LocaleString;
  helpText?: LocaleString;
  prefix?: LocaleString;
  suffix?: LocaleString;
  options?: SelectOption[];
  format?: string;
  columns?: number;
  refFilter?: Expression;
};

export type TypeViewDraft = {
  name: string;
  description?: LocaleString;
  extends?: string;
  targetTypeName?: string;
  /** Full authored type, including inline and polymorphic targets. */
  targetType?: FenelType;
  component?: string;
  readComponent?: string;
  editComponent?: string;
  readDisplay?: ReadDisplayDraft;
  editDisplay?: EditDisplayDraft;
  layout?: LayoutDef;
  listDisplay?: ListDisplayConfig;
};

export type SurfaceCatalogSnapshot = {
  authoring?: AuthoringCatalogSnapshot;
  views: TypeView[];
  targetTypeOptions: SurfaceTargetTypeOption[];
  componentNames: string[];
  defaultViewByTypeName: Readonly<Record<string, string>>;
};

export type SurfaceEnvironment = {
  /** Explicit product/account context for UUID field presentation. */
  registry?: ModuleRegistry;
  authoring?: AuthoringEnvironment;
  catalog: SurfaceCatalogSnapshot;
  resolveNamedType?: (name: string) => FenelType | undefined;
  resolveTypeRef?: (type: FenelType) => FenelType | undefined;
  resolveView?: (name: string) => TypeView | undefined;
  defaultViewForTypeName?: (typeName: string) => string | undefined;
};

export type SurfacePlanSource =
  | "explicit"
  | "account-override"
  | "user-override"
  | "entity-default"
  | "matching-view"
  | "inferred-structural"
  | "universal";

export type SurfacePlan = {
  mode: SurfaceMode;
  type: FenelType;
  source: SurfacePlanSource;
  view?: TypeView;
  layout?: LayoutDef;
  listDisplay?: ListDisplayConfig;
  readDisplay?: ReadDisplay;
  editDisplay?: EditDisplay;
  componentName?: string;
  fallback: "universal-renderer";
  fieldCandidates: SurfaceFieldCandidate[];
  conditionScope: SurfaceConditionScope;
};

export type SurfaceReadValueFallbackKind = "read-display" | "scalar";

export type SurfaceReadValuePlan = {
  kind: "text" | "badge" | "chip" | "link" | "date-short" | "relative-time";
  text: string;
  color?: string;
  href?: string;
  hostFormat?: "date-short" | "relative-time";
  empty: boolean;
  raw: unknown;
  fallbackKind: SurfaceReadValueFallbackKind;
};

export type SurfaceSlotFallbackKind = "missing-field" | "field-renderer" | "read-display" | "scalar";

export type SurfaceLayoutSlotPlan = {
  fieldName: string;
  label: string;
  span?: number;
  field?: FieldDef;
  value: unknown;
  error?: string;
  templateName?: string;
  template?: TypeView;
  componentName?: string;
  display?: SurfaceReadValuePlan;
  fallbackKind: SurfaceSlotFallbackKind;
};

export type SurfaceLayoutRowPlan = {
  gap: string;
  slots: SurfaceLayoutSlotPlan[];
};

export type SurfaceLayoutSectionPlan = {
  title?: LocaleString;
  description?: LocaleString;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  rows: SurfaceLayoutRowPlan[];
};

export type SurfaceLayoutRenderPlan = {
  sections: SurfaceLayoutSectionPlan[];
  context: Record<string, unknown>;
};

export type SurfaceListColumnPlan = {
  fieldName: string;
  label: string;
  span?: number;
  editable: boolean;
  field?: FieldDef;
  templateName?: string;
  template?: TypeView;
  componentName?: string;
  readDisplay?: ReadDisplay;
  fallbackKind: "missing-field" | "read-display" | "scalar";
};

export type SurfaceListDisplayRenderPlan = {
  style: ListDisplayConfig["style"];
  addLabel?: LocaleString;
  emptyText?: LocaleString;
  itemTemplate?: string;
  columns: SurfaceListColumnPlan[];
};

export type PlanSurfaceOptions = {
  explicitViewName?: string;
  accountOverrideViewName?: string;
  userOverrideViewName?: string;
  entityDefaultViewName?: string;
  channel?: string;
};

const EMPTY_CATALOG: SurfaceCatalogSnapshot = {
  views: [],
  targetTypeOptions: [],
  componentNames: [],
  defaultViewByTypeName: {},
};

let builtinTypeViewsCache: TypeView[] | null = null;

export function surfaceBuiltinTypeViews(): TypeView[] {
  if (!builtinTypeViewsCache) {
    builtinTypeViewsCache = dispatchedSurfaceBuiltinTypeViews() as TypeView[];
  }
  return [...builtinTypeViewsCache];
}

export function surfaceBuiltinTypeView(name: string): TypeView | undefined {
  return surfaceBuiltinTypeViews().find((view) => view.name === name);
}

function textOf(value: LocaleString | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return value.en ?? Object.values(value)[0] ?? "";
}

function cleanString(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function maybeSlot<T>(value: T | undefined): ReturnType<typeof Just<T>> | typeof Nothing {
  return value === undefined ? Nothing : Just(value);
}

function readDisplayHasSlots(d: ReadDisplayDraft | undefined): d is ReadDisplayDraft {
  return !!d && Object.keys(d).length > 0;
}

function editDisplayHasSlots(d: EditDisplayDraft | undefined): d is EditDisplayDraft {
  return !!d && Object.keys(d).length > 0;
}

export function readDraftToReadDisplay(d: ReadDisplayDraft): ReadDisplay {
  return {
    format: maybeSlot(d.format),
    transform: maybeSlot(d.transform),
    colorMap: maybeSlot(d.colorMap),
    labelMap: maybeSlot(d.labelMap),
    icon: maybeSlot(d.icon),
    emptyText: maybeSlot(d.emptyText),
    prefix: maybeSlot(d.prefix),
    suffix: maybeSlot(d.suffix),
    refTemplate: maybeSlot(d.refTemplate),
  };
}

export function editDraftToEditDisplay(d: EditDisplayDraft): EditDisplay {
  return {
    widget: maybeSlot(d.widget),
    placeholder: maybeSlot(d.placeholder),
    helpText: maybeSlot(d.helpText),
    options: maybeSlot(d.options),
    columns: maybeSlot(d.columns),
    refFilter: maybeSlot(d.refFilter),
    prefix: maybeSlot(d.prefix),
    suffix: maybeSlot(d.suffix),
    format: maybeSlot(d.format),
  };
}

export function readDisplayToDraft(r: ReadDisplay | undefined): ReadDisplayDraft {
  if (!r) return {};
  const out: ReadDisplayDraft = {};
  const format = peelMaybeValue(r.format); if (format !== null) out.format = format;
  const transform = peelMaybeValue(r.transform); if (transform !== null) out.transform = transform;
  const colorMap = peelMaybeValue(r.colorMap); if (colorMap !== null) out.colorMap = colorMap;
  const labelMap = peelMaybeValue(r.labelMap); if (labelMap !== null) out.labelMap = labelMap;
  const icon = peelMaybeValue(r.icon); if (icon !== null) out.icon = icon;
  const emptyText = peelMaybeValue(r.emptyText); if (emptyText !== null) out.emptyText = emptyText;
  const prefix = peelMaybeValue(r.prefix); if (prefix !== null) out.prefix = prefix;
  const suffix = peelMaybeValue(r.suffix); if (suffix !== null) out.suffix = suffix;
  const refTemplate = peelMaybeValue(r.refTemplate); if (refTemplate !== null) out.refTemplate = refTemplate;
  return out;
}

export function editDisplayToDraft(e: EditDisplay | undefined): EditDisplayDraft {
  if (!e) return {};
  const out: EditDisplayDraft = {};
  const widget = peelMaybeValue(e.widget); if (widget !== null) out.widget = widget;
  const placeholder = peelMaybeValue(e.placeholder); if (placeholder !== null) out.placeholder = placeholder;
  const helpText = peelMaybeValue(e.helpText); if (helpText !== null) out.helpText = helpText;
  const options = peelMaybeValue(e.options); if (options !== null) out.options = options;
  const columns = peelMaybeValue(e.columns); if (columns !== null) out.columns = columns;
  const refFilter = peelMaybeValue(e.refFilter); if (refFilter !== null) out.refFilter = refFilter;
  const prefix = peelMaybeValue(e.prefix); if (prefix !== null) out.prefix = prefix;
  const suffix = peelMaybeValue(e.suffix); if (suffix !== null) out.suffix = suffix;
  const format = peelMaybeValue(e.format); if (format !== null) out.format = format;
  return out;
}

export function targetTypeName(t: FenelType | undefined): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  return authoringRefHandle(t) ?? rawRefHandle(t);
}

export function normalizeTypeViewDraft(draft: TypeViewDraft): TypeView {
  const read = readDisplayHasSlots(draft.readDisplay)
    ? Just(readDraftToReadDisplay(draft.readDisplay))
    : Nothing;
  const edit = editDisplayHasSlots(draft.editDisplay)
    ? Just(editDraftToEditDisplay(draft.editDisplay))
    : Nothing;

  const view: TypeView = {
    name: draft.name.trim(),
    display: read.$tag === "Just" || edit.$tag === "Just"
      ? Just({ read, edit })
      : Nothing,
  };
  const description = typeof draft.description === "string"
    ? cleanString(draft.description)
    : draft.description;
  if (description) view.description = description;
  const parent = cleanString(draft.extends);
  if (parent) view.extends = parent;
  const target = cleanString(draft.targetTypeName);
  if (draft.targetType !== undefined) view.targetType = draft.targetType;
  else if (target) view.targetType = { $ref: target };
  const component = cleanString(draft.component);
  if (component) view.component = component;
  const readComponent = cleanString(draft.readComponent);
  if (readComponent) view.readComponent = readComponent;
  const editComponent = cleanString(draft.editComponent);
  if (editComponent) view.editComponent = editComponent;
  if (draft.layout) view.layout = draft.layout;
  if (draft.listDisplay) view.listDisplay = draft.listDisplay;
  return view;
}

export function typeViewToDraft(view: TypeView): TypeViewDraft {
  const display = peelMaybeValue(view.display);
  return {
    name: view.name,
    description: view.description,
    extends: view.extends,
    targetTypeName: targetTypeName(view.targetType),
    targetType: view.targetType,
    component: view.component,
    readComponent: view.readComponent,
    editComponent: view.editComponent,
    readDisplay: readDisplayToDraft(peelMaybeValue(display?.read ?? Nothing) ?? undefined),
    editDisplay: editDisplayToDraft(peelMaybeValue(display?.edit ?? Nothing) ?? undefined),
    layout: view.layout,
    listDisplay: view.listDisplay,
  };
}

export function targetTypeOptionsForCatalog(
  snapshot: AuthoringCatalogSnapshot,
): SurfaceTargetTypeOption[] {
  return dispatchedSurfaceTargetTypeOptions(
    snapshot.types.map((entry) => ({
      value: entry.entityId ?? entry.name ?? "",
      label: entry.name,
      category: entry.category,
      description: entry.description,
      type: entry.type,
      entityId: entry.entityId,
    })),
  ) as SurfaceTargetTypeOption[];
}

export function buildSurfaceCatalogSnapshot(
  authoring?: AuthoringCatalogSnapshot,
  options: {
    views?: readonly TypeView[];
    componentNames?: readonly string[];
    defaultViewByTypeName?: Readonly<Record<string, string>>;
  } = {},
): SurfaceCatalogSnapshot {
  return {
    authoring,
    views: [...(options.views ?? [])],
    targetTypeOptions: authoring ? targetTypeOptionsForCatalog(authoring) : [],
    componentNames: [...(options.componentNames ?? [])],
    defaultViewByTypeName: options.defaultViewByTypeName ?? {},
  };
}

export function createSurfaceEnvironment(options: {
  registry?: ModuleRegistry;
  authoring?: AuthoringEnvironment;
  catalog?: SurfaceCatalogSnapshot;
  resolveNamedType?: (name: string) => FenelType | undefined;
  resolveTypeRef?: (type: FenelType) => FenelType | undefined;
  resolveView?: (name: string) => TypeView | undefined;
  defaultViewForTypeName?: (typeName: string) => string | undefined;
} = {}): SurfaceEnvironment {
  const catalog = options.catalog ?? EMPTY_CATALOG;
  return {
    registry: options.registry,
    authoring: options.authoring,
    catalog,
    resolveNamedType: options.resolveNamedType,
    resolveTypeRef: options.resolveTypeRef,
    resolveView: options.resolveView ?? ((name) => catalog.views.find((v) => v.name === name)),
    defaultViewForTypeName: options.defaultViewForTypeName,
  };
}

function resolveType(env: SurfaceEnvironment | undefined, type: FenelType): FenelType {
  const fromEnv = env?.resolveTypeRef?.(type);
  if (fromEnv) return fromEnv;
  const fromAuthoring = env?.authoring
    ? resolveAuthoringTypeRef(env.authoring, type)
    : undefined;
  if (fromAuthoring) return fromAuthoring;
  const handle = targetTypeName(type);
  if (handle) {
    // `undefined` from the authoring resolver is authoritative for a known
    // fenced callable. Do not reinterpret the same spelling as a nominal type.
    if (env?.authoring?.hasFunctionRefLiteral(handle) === true) return type;
    const named = env?.resolveNamedType?.(handle) ?? env?.authoring?.resolveNamedType?.(handle);
    if (named) return named;
  }
  return type;
}

type SurfaceTypeWire =
  | { $tag: "SfNamed"; name: string; raw: FenelType }
  | { $tag: "SfRecord"; fields: SurfaceFieldWire[]; raw: FenelType }
  | { $tag: "SfVariant"; raw: FenelType }
  | { $tag: "SfTuple"; raw: FenelType }
  | { $tag: "SfMap"; raw: FenelType }
  | { $tag: "SfList"; elem: SurfaceTypeWire; raw: FenelType }
  | { $tag: "SfMaybe"; value: SurfaceTypeWire; raw: FenelType }
  | { $tag: "SfRefined"; base: SurfaceTypeWire; raw: FenelType }
  | { $tag: "SfOpaque"; pure: SurfaceTypeWire; name: string; raw: FenelType }
  | { $tag: "SfOther"; raw: FenelType };

type SurfaceFieldWire = {
  $tag: "SurfaceField";
  name: string;
  label: string;
  type: SurfaceTypeWire;
  raw: FieldDef;
};

type SurfaceViewWire = {
  name: string;
  hasDescription: boolean;
  description?: LocaleString;
  hasExtends: boolean;
  extendsName: string;
  hasTarget: boolean;
  targetName: string;
  targetKey: string;
  targetType?: FenelType;
  display: TypeView["display"];
  hasLayout: boolean;
  hasListDisplay: boolean;
  hasReadDisplay: boolean;
  hasEditDisplay: boolean;
  component: string;
  readComponent: string;
  editComponent: string;
  layout?: LayoutDef;
  listDisplay?: ListDisplayConfig;
  readDisplay?: ReadDisplay;
  editDisplay?: EditDisplay;
  raw: TypeView;
};

function candidateLabel(env: SurfaceEnvironment | undefined, field: FieldDef): string {
  if (!env?.registry) return field.name;
  return textOf(resolveIdentifiedFieldView(env.registry, field).presentation.label);
}

function objectType(type: FenelType): Record<string, unknown> | null {
  return type && typeof type === "object" && !Array.isArray(type)
    ? type as Record<string, unknown>
    : null;
}

function typeKey(type: FenelType | undefined): string {
  return JSON.stringify(type ?? null);
}

function marshalSurfaceField(env: SurfaceEnvironment | undefined, field: FieldDef, seen: ReadonlySet<string>): SurfaceFieldWire {
  return {
    $tag: "SurfaceField",
    name: field.name,
    label: candidateLabel(env, field),
    type: marshalSurfaceType(env, field.type, seen),
    raw: field,
  };
}

function marshalSurfaceType(
  env: SurfaceEnvironment | undefined,
  type: FenelType,
  seen: ReadonlySet<string> = new Set(),
): SurfaceTypeWire {
  const handle = targetTypeName(type);
  if (handle && seen.has(handle)) return { $tag: "SfNamed", name: handle, raw: type };
  const nextSeen = handle ? new Set([...seen, handle]) : seen;
  const resolved = resolveType(env, type);
  const obj = objectType(resolved);
  if (!obj) return { $tag: "SfOther", raw: type };

  const resolvedHandle = targetTypeName(resolved);
  if (resolvedHandle) return { $tag: "SfNamed", name: resolvedHandle, raw: type };

  const maybe = peelMaybeForAuthoring(resolved);
  if (maybe) {
    return {
      $tag: "SfMaybe",
      value: marshalSurfaceType(env, maybe.value, nextSeen),
      raw: type,
    };
  }

  const list = peelListForAuthoring(resolved);
  if (list) {
    return {
      $tag: "SfList",
      elem: marshalSurfaceType(env, list.elem, nextSeen),
      raw: type,
    };
  }

  if ("$refined" in obj) {
    const refined = obj.$refined as { base?: FenelType };
    if (refined?.base) {
      return {
        $tag: "SfRefined",
        base: marshalSurfaceType(env, refined.base, nextSeen),
        raw: type,
      };
    }
  }

  if ("$opaque" in obj) {
    const opaque = obj.$opaque as { pure?: FenelType; name?: unknown };
    if (opaque?.pure) {
      return {
        $tag: "SfOpaque",
        pure: marshalSurfaceType(env, opaque.pure, nextSeen),
        name: typeof opaque.name === "string" ? opaque.name : "",
        raw: type,
      };
    }
  }

  if ("$record" in obj) {
    const record = obj.$record as { fields?: FieldDef[] };
    return {
      $tag: "SfRecord",
      fields: (record.fields ?? []).map((field) => marshalSurfaceField(env, field, nextSeen)),
      raw: type,
    };
  }

  if ("$variant" in obj) return { $tag: "SfVariant", raw: type };
  if ("$tuple" in obj) return { $tag: "SfTuple", raw: type };
  if ("$map" in obj) return { $tag: "SfMap", raw: type };
  return { $tag: "SfOther", raw: type };
}

function stripCandidate(candidate: unknown): SurfaceFieldCandidate {
  const c = candidate as SurfaceFieldCandidate & { typeShape?: unknown };
  const { typeShape: _typeShape, ...rest } = c;
  return rest;
}

function stripCandidates(candidates: unknown[]): SurfaceFieldCandidate[] {
  return candidates.map(stripCandidate);
}

export function fieldCandidatesForType(
  env: SurfaceEnvironment | undefined,
  type: FenelType | undefined,
  options: { maxDepth?: number } = {},
): SurfaceFieldCandidate[] {
  if (!type) return [];
  return stripCandidates(
    dispatchedSurfaceFieldCandidates(
      marshalSurfaceType(env, type),
      options.maxDepth ?? 1,
    ),
  );
}

export function defaultLayoutForType(
  env: SurfaceEnvironment | undefined,
  type: FenelType,
): LayoutDef {
  return dispatchedSurfaceDefaultLayoutForType(
    marshalSurfaceType(env, type),
  ) as LayoutDef;
}

export function defaultListDisplayForType(
  env: SurfaceEnvironment | undefined,
  type: FenelType,
): ListDisplayConfig {
  return dispatchedSurfaceDefaultListDisplayForType(
    marshalSurfaceType(env, type),
  ) as ListDisplayConfig;
}

export function surfaceConditionScopeForType(
  env: SurfaceEnvironment | undefined,
  type: FenelType | undefined,
  mode: SurfaceMode,
  channel = "web",
): SurfaceConditionScope {
  if (!type) return { mode, channel, variables: [
    { name: "_mode", label: "Mode", source: "surface" },
    { name: "_channel", label: "Channel", source: "surface" },
  ] };
  return dispatchedSurfaceConditionScopeForType(
    marshalSurfaceType(env, type),
    mode,
    channel,
  ) as SurfaceConditionScope;
}

export function surfaceConditionContext(
  values: Record<string, unknown>,
  mode: SurfaceMode,
  channel = "web",
): Record<string, unknown> {
  return dispatchedSurfaceConditionContext(values, mode, channel);
}

function resolveViewByName(env: SurfaceEnvironment, name: string | undefined): TypeView | undefined {
  if (!name) return undefined;
  return env.resolveView?.(name) ?? env.catalog.views.find((view) => view.name === name);
}

function canonicalLocaleSlot(slot: Maybe<LocaleString>): Maybe<string> {
  const value = peelMaybeValue(slot);
  return value === null ? Nothing : Just(textOf(value));
}

function marshalReadDisplayForPlan(display: ReadDisplay): ReadDisplay {
  return {
    ...display,
    emptyText: canonicalLocaleSlot(display.emptyText),
    prefix: canonicalLocaleSlot(display.prefix),
    suffix: canonicalLocaleSlot(display.suffix),
  };
}

function marshalSurfaceView(view: TypeView): SurfaceViewWire {
  const display = peelMaybeValue(view.display);
  const readDisplay = peelMaybeValue(display?.read ?? Nothing) ?? undefined;
  const editDisplay = peelMaybeValue(display?.edit ?? Nothing) ?? undefined;
  const renderReadDisplay = readDisplay ? marshalReadDisplayForPlan(readDisplay) : undefined;
  return {
    name: view.name,
    hasDescription: view.description !== undefined,
    description: view.description,
    hasExtends: view.extends !== undefined,
    extendsName: view.extends ?? "",
    hasTarget: view.targetType !== undefined,
    targetName: targetTypeName(view.targetType) ?? "",
    targetKey: typeKey(view.targetType),
    targetType: view.targetType,
    display: view.display,
    hasLayout: view.layout !== undefined,
    hasListDisplay: view.listDisplay !== undefined,
    hasReadDisplay: readDisplay !== undefined,
    hasEditDisplay: editDisplay !== undefined,
    component: view.component ?? "",
    readComponent: view.readComponent ?? "",
    editComponent: view.editComponent ?? "",
    layout: view.layout,
    listDisplay: view.listDisplay,
    readDisplay: renderReadDisplay,
    editDisplay,
    raw: view,
  };
}

function unmarshalSurfaceView(value: unknown): TypeView | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const wire = value as Partial<SurfaceViewWire>;
  if (typeof wire.name !== "string" || wire.name.length === 0) return undefined;

  const view: TypeView = {
    name: wire.name,
    display: wire.display ?? Nothing,
  };
  if (wire.hasDescription && wire.description !== undefined) {
    view.description = wire.description;
  }
  if (wire.hasExtends && wire.extendsName) {
    view.extends = wire.extendsName;
  }
  if (wire.hasTarget && wire.targetType) {
    view.targetType = wire.targetType;
  }
  if (wire.hasLayout && wire.layout) {
    view.layout = wire.layout;
  }
  if (wire.hasListDisplay && wire.listDisplay) {
    view.listDisplay = wire.listDisplay;
  }
  if (wire.component) view.component = wire.component;
  if (wire.readComponent) view.readComponent = wire.readComponent;
  if (wire.editComponent) view.editComponent = wire.editComponent;
  return view;
}

type SurfaceValueWire = {
  tag: string;
  text: string;
  key: string;
  raw: unknown;
  missing: boolean;
  children: Record<string, SurfaceValueWire>;
};

type SurfaceRenderFieldWire = {
  name: string;
  label: string;
  raw: FieldDef;
};

type SurfaceRenderSlotWire = {
  visible: boolean;
  field: string;
  span?: number;
  templateName?: string;
  template: Maybe<SurfaceViewWire>;
};

type SurfaceRenderRowWire = {
  visible: boolean;
  gap: string;
  slots: SurfaceRenderSlotWire[];
};

type SurfaceRenderSectionWire = {
  visible: boolean;
  title?: LocaleString;
  description?: LocaleString;
  collapsible: boolean;
  defaultCollapsed: boolean;
  rows: SurfaceRenderRowWire[];
};

type SurfaceRenderLayoutWire = {
  sections: SurfaceRenderSectionWire[];
};

type SurfaceRenderListColumnWire = {
  field: string;
  label: string;
  span?: number;
  editable: boolean;
  templateName?: string;
  template: Maybe<SurfaceViewWire>;
};

type SurfaceRenderListDisplayWire = {
  style: ListDisplayConfig["style"];
  addLabel?: LocaleString;
  emptyText?: LocaleString;
  itemTemplate?: string;
  columns: SurfaceRenderListColumnWire[];
};

function maybe<T>(value: T | null | undefined): Maybe<T> {
  return value == null ? Nothing : Just(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function marshalSurfaceValue(value: unknown): SurfaceValueWire {
  const missing = value === null || value === undefined || value === "";
  const record = asRecord(value);
  let tag = "string";
  let text = "";
  let key = "";
  let raw = value;

  if (missing) {
    tag = "missing";
    raw = null;
  } else if (value instanceof Date) {
    tag = "date";
    text = Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
    key = String(value);
  } else if (typeof value === "string") {
    tag = "string";
    text = value;
    key = value;
  } else if (typeof value === "number") {
    tag = "number";
    text = String(value);
    key = String(value);
  } else if (typeof value === "boolean") {
    tag = "boolean";
    text = String(value);
    key = String(value);
  } else if (record) {
    tag = "object";
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
    key = text;
  } else {
    tag = typeof value;
    text = String(value);
    key = text;
  }

  const children: Record<string, SurfaceValueWire> = {};
  if (record) {
    for (const [k, v] of Object.entries(record)) {
      children[k] = marshalSurfaceValue(v);
    }
  }

  return { tag, text, key, raw, missing, children };
}

function marshalSurfaceValueRecord(values: Record<string, unknown>): Record<string, SurfaceValueWire> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, marshalSurfaceValue(value)]),
  );
}

function marshalRenderField(
  env: SurfaceEnvironment | undefined,
  field: FieldDef,
): SurfaceRenderFieldWire {
  return {
    name: field.name,
    label: candidateLabel(env, field),
    raw: field,
  };
}

function predicateMatched(when: Expression | undefined, context: Record<string, unknown>, caller?: EvaluateContext): boolean {
  if (!when) return true;
  return truthy(resolveEvaluator(caller)(when, context));
}

function marshalLayoutForRenderPlan(
  layout: LayoutDef,
  context: Record<string, unknown>,
  resolveTemplate?: (name: string) => TypeView | undefined,
  caller?: EvaluateContext,
): SurfaceRenderLayoutWire {
  return {
    sections: layout.sections.map((section) => ({
      visible: predicateMatched(section.when, context, caller),
      title: section.title,
      description: section.description,
      collapsible: section.collapsible ?? false,
      defaultCollapsed: section.defaultCollapsed ?? false,
      rows: section.rows.map((row) => ({
        visible: predicateMatched(row.when, context, caller),
        gap: row.gap ?? "0.75rem",
        slots: row.slots.map((slot) => {
          const template = slot.template ? resolveTemplate?.(slot.template) : undefined;
          return {
            visible: predicateMatched(slot.when, context, caller),
            field: slot.field,
            span: slot.span,
            templateName: slot.template,
            template: maybe(template ? marshalSurfaceView(template) : undefined),
          };
        }),
      })),
    })),
  };
}

function readOptionalMaybe<T>(value: unknown): T | undefined {
  const peeled = peelMaybeValue(value as Maybe<T> | null | undefined);
  return peeled === null ? undefined : peeled;
}

function readOptionalValue<T>(value: unknown): T | undefined {
  const record = asRecord(value);
  if (record && (record.$tag === "Just" || record.$tag === "Nothing")) {
    return readOptionalMaybe<T>(value);
  }
  return value == null ? undefined : value as T;
}

function readOptionalString(value: unknown): string | undefined {
  const v = readOptionalValue<unknown>(value);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const v = readOptionalValue<unknown>(value);
  return typeof v === "number" ? v : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  const v = readOptionalValue<unknown>(value);
  return typeof v === "boolean" ? v : undefined;
}

function unmarshalReadValuePlan(value: unknown): SurfaceReadValuePlan | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const kind = typeof record.kind === "string" ? record.kind : "text";
  const hostFormat = readOptionalString(record.hostFormat);
  return {
    kind: kind === "badge" || kind === "chip" || kind === "link" || kind === "date-short" || kind === "relative-time"
      ? kind
      : "text",
    text: typeof record.text === "string" ? record.text : "",
    color: readOptionalString(record.color),
    href: readOptionalString(record.href),
    hostFormat: hostFormat === "date-short" || hostFormat === "relative-time" ? hostFormat : undefined,
    empty: record.empty === true,
    raw: record.raw,
    fallbackKind: record.fallbackKind === "scalar" ? "scalar" : "read-display",
  };
}

function unmarshalSurfaceLayoutPlan(
  value: unknown,
  context: Record<string, unknown>,
): SurfaceLayoutRenderPlan {
  const record = asRecord(value);
  const sectionsRaw = Array.isArray(record?.sections) ? record.sections : [];
  return {
    context,
    sections: sectionsRaw.map((sectionValue) => {
      const section = asRecord(sectionValue) ?? {};
      const rowsRaw = Array.isArray(section.rows) ? section.rows : [];
      return {
        title: section.title as LocaleString | undefined,
        description: section.description as LocaleString | undefined,
        collapsible: section.collapsible === true,
        defaultCollapsed: section.defaultCollapsed === true,
        rows: rowsRaw.map((rowValue) => {
          const row = asRecord(rowValue) ?? {};
          const slotsRaw = Array.isArray(row.slots) ? row.slots : [];
          return {
            gap: typeof row.gap === "string" && row.gap.length > 0 ? row.gap : "0.75rem",
            slots: slotsRaw.map((slotValue) => {
              const slot = asRecord(slotValue) ?? {};
              const template = readOptionalMaybe<SurfaceViewWire>(slot.template);
              const display = readOptionalMaybe<unknown>(slot.display);
              return {
                fieldName: typeof slot.fieldName === "string" ? slot.fieldName : "",
                label: typeof slot.label === "string" ? slot.label : "",
                span: readOptionalNumber(slot.span),
                field: readOptionalMaybe<FieldDef>(slot.field),
                value: readOptionalMaybe(slot.value),
                error: readOptionalString(slot.error),
                templateName: readOptionalString(slot.templateName),
                template: template ? unmarshalSurfaceView(template) : undefined,
                componentName: readOptionalString(slot.componentName),
                display: display ? unmarshalReadValuePlan(display) : undefined,
                fallbackKind: slot.fallbackKind === "field-renderer"
                  ? "field-renderer"
                  : slot.fallbackKind === "read-display"
                    ? "read-display"
                    : slot.fallbackKind === "scalar"
                      ? "scalar"
                      : "missing-field",
              } satisfies SurfaceLayoutSlotPlan;
            }),
          };
        }),
      };
    }),
  };
}

function marshalListDisplayForRenderPlan(
  display: ListDisplayConfig,
  resolveTemplate?: (name: string) => TypeView | undefined,
): SurfaceRenderListDisplayWire {
  return {
    style: display.style,
    addLabel: display.addLabel,
    emptyText: display.emptyText,
    itemTemplate: display.itemTemplate,
    columns: (display.columns ?? []).map((column) => {
      const template = column.template ? resolveTemplate?.(column.template) : undefined;
      return {
        field: column.field,
        label: column.label ? textOf(column.label) : column.field,
        span: column.span,
        editable: column.editable ?? false,
        templateName: column.template,
        template: maybe(template ? marshalSurfaceView(template) : undefined),
      };
    }),
  };
}

function unmarshalListDisplayRenderPlan(value: unknown): SurfaceListDisplayRenderPlan {
  const record = asRecord(value) ?? {};
  const columnsRaw = Array.isArray(record.columns) ? record.columns : [];
  return {
    style: record.style === "stack" || record.style === "chips" || record.style === "inline" || record.style === "cards"
      ? record.style
      : "table",
    addLabel: record.addLabel as LocaleString | undefined,
    emptyText: record.emptyText as LocaleString | undefined,
    itemTemplate: typeof record.itemTemplate === "string" ? record.itemTemplate : undefined,
    columns: columnsRaw.map((columnValue) => {
      const column = asRecord(columnValue) ?? {};
      const template = readOptionalMaybe<SurfaceViewWire>(column.template);
      return {
        fieldName: typeof column.fieldName === "string" ? column.fieldName : "",
        label: typeof column.label === "string" ? column.label : "",
        span: readOptionalNumber(column.span),
        editable: readOptionalBoolean(column.editable) ?? column.editable === true,
        field: readOptionalMaybe<FieldDef>(column.field),
        templateName: readOptionalString(column.templateName),
        template: template ? unmarshalSurfaceView(template) : undefined,
        componentName: readOptionalString(column.componentName),
        readDisplay: readOptionalMaybe<ReadDisplay>(column.readDisplay),
        fallbackKind: column.fallbackKind === "read-display"
          ? "read-display"
          : column.fallbackKind === "scalar"
            ? "scalar"
            : "missing-field",
      } satisfies SurfaceListColumnPlan;
    }),
  };
}

export function surfaceReadValuePlan(
  value: unknown,
  display?: ReadDisplay,
  fallbackKind: SurfaceReadValueFallbackKind = "read-display",
  caller?: EvaluateContext,
): SurfaceReadValuePlan {
  return unmarshalReadValuePlan(
    dispatchEngineBody("engine:surfaceReadValuePlan", [marshalSurfaceValue(value),
      maybe(display ? marshalReadDisplayForPlan(display) : undefined), fallbackKind], caller),
  ) ?? {
    kind: "text",
    text: value == null || value === "" ? "-" : String(value),
    empty: value == null || value === "",
    raw: value,
    fallbackKind,
  };
}

export function surfaceLayoutRenderPlan(args: {
  environment?: SurfaceEnvironment;
  layout: LayoutDef;
  fields: readonly FieldDef[];
  values: Record<string, unknown>;
  mode: Extract<SurfaceMode, "read" | "edit">;
  errors?: Record<string, string>;
  channel?: string;
  resolveTemplate?: (name: string) => TypeView | undefined;
  evaluateContext?: EvaluateContext;
}): SurfaceLayoutRenderPlan {
  const context = surfaceConditionContext(args.values, args.mode, args.channel ?? "web");
  const result = dispatchEngineBody("engine:surfaceLayoutRenderPlan", [
    marshalLayoutForRenderPlan(args.layout, context, args.resolveTemplate, args.evaluateContext),
    args.fields.map((field) => marshalRenderField(args.environment, field)),
    marshalSurfaceValueRecord(args.values),
    args.errors ?? {},
    args.mode,
  ], args.evaluateContext);
  return unmarshalSurfaceLayoutPlan(result, context);
}

export function surfaceListDisplayRenderPlan(args: {
  environment?: SurfaceEnvironment;
  listDisplay: ListDisplayConfig;
  fields: readonly FieldDef[];
  resolveTemplate?: (name: string) => TypeView | undefined;
}): SurfaceListDisplayRenderPlan {
  return unmarshalListDisplayRenderPlan(
    dispatchedSurfaceListDisplayRenderPlan(
      marshalListDisplayForRenderPlan(args.listDisplay, args.resolveTemplate),
      args.fields.map((field) => marshalRenderField(args.environment, field)),
    ),
  );
}

export type SurfaceTemplateDefault = {
  schemaType: string;
  templateName: string;
};

export type SurfaceTemplateRuleGroup = {
  schemaType: string;
  rules: TemplateRule[];
};

type SurfaceMatchedTemplateRuleGroup = {
  schemaType: string;
  rules: Array<{ template: string; matched: boolean }>;
};

function matchedTemplateRuleGroups(
  groups: readonly SurfaceTemplateRuleGroup[],
  context: Record<string, unknown>,
): SurfaceMatchedTemplateRuleGroup[] {
  const evalFn = resolveEvaluator();
  return groups.map((group) => ({
    schemaType: group.schemaType,
    rules: group.rules.map((rule) => ({
      template: rule.template,
      matched: truthy(evalFn(rule.when, context)),
    })),
  }));
}

export function mergeSurfaceReadDisplay(
  parent: Maybe<ReadDisplay>,
  child: Maybe<ReadDisplay>,
): Maybe<ReadDisplay> {
  return dispatchedSurfaceMergeRead(parent, child) as Maybe<ReadDisplay>;
}

export function mergeSurfaceEditDisplay(
  parent: Maybe<EditDisplay>,
  child: Maybe<EditDisplay>,
): Maybe<EditDisplay> {
  return dispatchedSurfaceMergeEdit(parent, child) as Maybe<EditDisplay>;
}

export function mergeSurfaceDisplay(
  parent: TypeView["display"],
  child: TypeView["display"],
): TypeView["display"] {
  return dispatchedSurfaceMergeDisplay(parent, child) as TypeView["display"];
}

export function resolveSurfaceTypeView(
  views: readonly TypeView[],
  name: string,
  caller?: EvaluateContext,
): TypeView | undefined {
  return unmarshalSurfaceView(
    peelMaybeValue(dispatchEngineBody("engine:surfaceResolveTypeView", [views.map(marshalSurfaceView), name], caller) as Maybe<unknown>),
  );
}

/** B3 TypeView codec only. The source owns viability, inherited facets and
 * compact/full selection; component implementations never enter its values. */
export function surfaceReaderViewPlan(args: {
  views: readonly TypeView[]; componentNames: readonly string[];
  methods: Record<string, unknown> | undefined; compact: boolean;
  hasFields: boolean; record: boolean; evaluateContext: EvaluateContext;
}): { view?: TypeView; useLayout: boolean } {
  const result = dispatchEngineBody("engine:surfaceReaderViewPlan", [
    args.views.map(marshalSurfaceView), args.componentNames, args.methods ?? {},
    args.compact, args.hasFields, args.record,
  ], args.evaluateContext) as { view: Maybe<unknown>; useLayout: boolean };
  return { view: unmarshalSurfaceView(peelMaybeValue(result.view)), useLayout: result.useLayout };
}

export function surfaceDefaultTemplateName(
  defaults: readonly SurfaceTemplateDefault[],
  ruleGroups: readonly SurfaceTemplateRuleGroup[],
  schemaType: string,
  context: Record<string, unknown> = {},
): string | undefined {
  return dispatchedSurfaceDefaultTemplateName(
    defaults,
    matchedTemplateRuleGroups(ruleGroups, context),
    schemaType,
  );
}

export function resolveSurfaceDefaultTemplate(
  views: readonly TypeView[],
  defaults: readonly SurfaceTemplateDefault[],
  ruleGroups: readonly SurfaceTemplateRuleGroup[],
  schemaType: string,
  context: Record<string, unknown> = {},
): TypeView | undefined {
  return unmarshalSurfaceView(
    dispatchedSurfaceResolveDefaultTemplate(
      views.map(marshalSurfaceView),
      defaults,
      matchedTemplateRuleGroups(ruleGroups, context),
      schemaType,
    ),
  );
}

function surfaceViewsForDispatch(
  env: SurfaceEnvironment,
  options: PlanSurfaceOptions,
  extraNames: readonly string[] = [],
): SurfaceViewWire[] {
  const views = [...env.catalog.views];
  for (const name of [
    options.explicitViewName,
    options.accountOverrideViewName,
    options.userOverrideViewName,
    options.entityDefaultViewName,
    ...extraNames,
  ]) {
    const view = resolveViewByName(env, name);
    if (view && !views.some((v) => v.name === view.name)) views.push(view);
  }
  return views.map(marshalSurfaceView);
}

type SurfacePlanDispatchOptions = {
  explicitViewName: string;
  accountOverrideViewName: string;
  userOverrideViewName: string;
  entityDefaultViewName: string;
  catalogDefaultViewName: string;
};

function surfacePlanOptions(
  env: SurfaceEnvironment,
  type: FenelType,
  options: PlanSurfaceOptions,
): SurfacePlanDispatchOptions {
  const name = targetTypeName(type);
  return {
    explicitViewName: options.explicitViewName ?? "",
    accountOverrideViewName: options.accountOverrideViewName ?? "",
    userOverrideViewName: options.userOverrideViewName ?? "",
    entityDefaultViewName: options.entityDefaultViewName ?? "",
    catalogDefaultViewName: name
      ? env.defaultViewForTypeName?.(name) ?? env.catalog.defaultViewByTypeName[name] ?? ""
      : "",
  };
}

export function typeViewsForSurface(
  env: SurfaceEnvironment | undefined,
  type: FenelType,
  mode: SurfaceMode,
): TypeView[] {
  const surfaceEnv = env ?? createSurfaceEnvironment();
  return dispatchedSurfaceTypeViewsForSurface(
    surfaceEnv.catalog.views.map(marshalSurfaceView),
    targetTypeName(type) ?? "",
    typeKey(type),
    mode,
  ) as TypeView[];
}

export function planSurfaceForType(
  env: SurfaceEnvironment | undefined,
  type: FenelType,
  mode: SurfaceMode,
  options: PlanSurfaceOptions = {},
): SurfacePlan {
  const surfaceEnv = env ?? createSurfaceEnvironment();
  const planOptions = surfacePlanOptions(surfaceEnv, type, options);
  const core = dispatchedSurfacePlanForType({
    surfaceType: marshalSurfaceType(surfaceEnv, type),
    rawType: type,
    views: surfaceViewsForDispatch(surfaceEnv, options, [planOptions.catalogDefaultViewName]),
    typeName: targetTypeName(type) ?? "",
    typeKey: typeKey(type),
    mode,
    options: planOptions,
    channel: options.channel ?? "web",
  });

  return {
    mode,
    type,
    source: core.source as SurfacePlanSource,
    view: core.view as TypeView | undefined,
    layout: core.layout as LayoutDef | undefined,
    listDisplay: core.listDisplay as ListDisplayConfig | undefined,
    readDisplay: core.readDisplay as ReadDisplay | undefined,
    editDisplay: core.editDisplay as EditDisplay | undefined,
    componentName: core.componentName,
    fallback: "universal-renderer",
    fieldCandidates: stripCandidates(core.fieldCandidates),
    conditionScope: core.conditionScope as SurfaceConditionScope,
  };
}
