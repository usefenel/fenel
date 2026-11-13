import type {
  EditDisplay,
  Expression,
  FieldDef,
  FenelType,
  InputChannel,
  LocaleString,
  SelectOption,
  SetExpr,
  TextChannel,
} from "../types";
import type { ModuleRegistry } from "../registry";
import type { EvaluateContext } from "../json-logic";
import { constructorDeclaredFieldNames, constructorSemanticFieldRead, resolveCompleteMethodForEvaluation, withRuntimeRepresentationProjection } from "../json-logic";
import { representationValueSnapshot } from "../representation-value";
import { resolveEffect, typeConstructorOf } from "../effect-dispatch";
import { contains } from "../set-algebra";
import { validateValue, type ValidateOptions } from "../validate";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "./signature-authoring";
import { frameAccount } from "../authority";
import { GLOBAL_ONLY } from "../dispatch-registry";
import type { FieldPresentationOverride } from "../field-representations";
import {
  dispatchedFieldEditPlan,
  dispatchedFieldTypeLabelPlan,
  dispatchEngineBody,
  marshalTraversalType,
  dispatchedTypeToSetProjection,
  print,
} from "../engine-bodies-dispatch";
import { peelListForAuthoring as dispatchedPeelList, peelMaybeForAuthoring as dispatchedPeelMaybe, defaultValueForAuthoring } from "./type-authoring";
import { resolveIdentifiedFieldView } from "../identified-field-view";
import { peelEl } from "../dependent-types";
import {
  defaultFilterFor,
  enumOptionLabel,
  fieldMeta,
  fieldType,
  phantomEntityName,
  type DefaultRegistry,
} from "../field-meta";
import { dispatchRegistry } from "../system-entities";
import { getCatalogEntry } from "../type-catalog";
import { widgetForField, type WidgetHint } from "../widget-hint";
import {
  Just,
  type Maybe,
  Nothing,
} from "../type-foundation";
import {
  refHandle,
} from "./environment";

export type FieldTypeWire =
  | { $tag: "FtNamed"; name: string; raw: FenelType }
  | { $tag: "FtRefined"; base: FieldTypeWire; set: SetExpr; raw: FenelType }
  | { $tag: "FtOpaque"; name: string; pure: FieldTypeWire; raw: FenelType }
  | { $tag: "FtMaybe"; value: FieldTypeWire; raw: FenelType }
  | { $tag: "FtList"; elem: FieldTypeWire; raw: FenelType }
  | { $tag: "FtRecord"; fields: FieldDef[]; raw: FenelType }
  | { $tag: "FtVariant"; cases: FieldVariantCasePlan[]; discriminator: string; raw: FenelType }
  | { $tag: "FtMap"; keys: SetExpr; values: FieldTypeWire; raw: FenelType }
  | { $tag: "FtTagged"; value: FieldTypeWire; phantom: FieldTypeWire; phantomTypeName: string; entityType: string; raw: FenelType }
  | { $tag: "FtArrow"; params: Array<FieldDef & { typeWire: FieldTypeWire }>; returns: FieldTypeWire; raw: FenelType }
  | { $tag: "FtType"; raw: FenelType }
  | { $tag: "FtEl"; resolved: Maybe<FieldTypeWire>; raw: FenelType }
  | { $tag: "FtOther"; kind: string; raw: FenelType };

export type FieldBoundsPlan = {
  lo: number;
  hi: number;
  integer: boolean;
  step: number;
};

export type FieldMatrixRowPlan = {
  key: string;
  label: string;
};

export type FieldVariantCasePlan = {
  name: string;
  fields: FieldDef[];
  defaultValue: Record<string, unknown>;
};

export type FieldEditorPlan =
  | {
      kind: "text";
      rawType: FenelType;
      set?: SetExpr;
      widget: string;
      inputType: string;
      icon?: "mail" | "phone" | "link" | "user" | string;
      prefix?: string;
      suffix?: string;
      placeholder?: string;
      validationFormat?: string;
    }
  | {
      kind: "number";
      rawType: FenelType;
      representation: "number" | "rational";
      numericTypeName: string;
      textCodec?: { decode: unknown; encode: unknown };
      set?: SetExpr;
      widget: string;
      bounds?: FieldBoundsPlan;
      integer: boolean;
      prefix?: string;
      suffix?: string;
      placeholder?: string;
    }
  | {
      kind: "date";
      rawType: FenelType;
      set?: SetExpr;
      inputType: string;
      min?: string;
      max?: string;
      placeholder?: string;
    }
  | {
      kind: "select";
      rawType: FenelType;
      options: SelectOption[];
      radio: boolean;
      multi: boolean;
      placeholder?: string;
    }
  | { kind: "boolean"; rawType: FenelType }
  | { kind: "locale-string"; rawType: FenelType }
  | { kind: "file"; rawType: FenelType }
  | {
      kind: "ref";
      rawType: FenelType;
      entityType: string;
      filter?: Expression;
      filterSource: "field-ui" | "filterable-default" | "legacy-meta" | "none" | string;
      placeholder?: string;
    }
  | {
      kind: "list";
      rawType: FenelType;
      itemType: FenelType;
      itemTypeLabel: string;
      itemDefault?: unknown;
      choices?: SelectOption[];
      canonical?: boolean;
    }
  | { kind: "record"; rawType: FenelType; fields: FieldDef[] }
  | { kind: "freeform-record"; rawType: FenelType; fields: FieldDef[] }
  | {
      kind: "variant";
      rawType: FenelType;
      discriminator: string;
      cases: FieldVariantCasePlan[];
      toggle: boolean;
    }
  | { kind: "matrix"; rawType: FenelType; rows: FieldMatrixRowPlan[]; columns: FieldDef[] }
  | { kind: "map"; rawType: FenelType }
  | { kind: "markup"; rawType: FenelType; set?: SetExpr; expression: boolean }
  | { kind: "string-expression"; rawType: FenelType; placeholder?: string }
  | { kind: "expression"; rawType: FenelType; leaf?: "terms" | string }
  | { kind: "custom"; rawType: FenelType; leaf: "address-autocomplete" | string; placeholder?: string; channel?: InputChannel }
  | { kind: "arrow"; rawType: FenelType }
  | { kind: "type"; rawType: FenelType }
  | { kind: "unsupported"; rawType: FenelType; reason: string; channel?: InputChannel };

export type FieldEditPlan = {
  name: string;
  label: string;
  typeLabel: string;
  required: boolean;
  helpText?: string;
  columns?: number;
  editor: FieldEditorPlan;
};

export type FieldEditPlanArgs = {
  /** Product reads pass their explicit repository/account registry. Omission is
   * reserved for transient authoring shapes and yields no global facets. */
  registry?: ModuleRegistry;
  /** The actual reader frame also owns choices in transient Call fields. */
  evaluateContext?: EvaluateContext;
  field: FieldDef;
  presentationOverride?: FieldPresentationOverride;
  value?: unknown;
  /** B3: retain a named declaration's owner while its concrete type supplies
   * the editor shape. Whole-value checks resolve in that original scope. */
  declarationType?: FenelType;
  recordValues?: Record<string, unknown>;
  channel?: InputChannel;
};

export type FieldReaderPlanArgs = Omit<FieldEditPlanArgs, "channel" | "declarationType"> & {
  fieldMode: "identified" | "transient";
  channelId?: string;
  channelsEnabled: boolean;
};
export type FieldReaderPlan = {
  plan: FieldEditPlan;
  channels: InputChannel[];
  activeChannelId?: string;
};

const TERMINAL_BASE_NAMES = new Set([
  "String",
  "Number",
  "Rational",
  "ℚ",
  "Int",
  "Nat",
  "Boolean",
  "Date",
  "File",
  "Char",
  "Bytes",
  "Markup",
  "ℝ",
  "ℤ",
  "ℕ",
]);

function textOf(value: LocaleString | undefined | null): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value.en ?? Object.values(value)[0] ?? "";
}

function maybeText(value: Maybe<LocaleString> | undefined): Maybe<string> {
  if (!value || value.$tag === "Nothing") return Nothing;
  return Just(textOf(value._0));
}

function maybeString(value: Maybe<string> | undefined): Maybe<string> {
  return value && value.$tag === "Just" ? Just(value._0) : Nothing;
}

function maybeNumber(value: Maybe<number> | undefined): Maybe<number> {
  return value && value.$tag === "Just" ? Just(value._0) : Nothing;
}

function maybeOptions(value: Maybe<SelectOption[]> | undefined): Maybe<SelectOption[]> {
  return value && value.$tag === "Just" ? Just(value._0) : Nothing;
}

function maybeExpr(value: Maybe<Expression> | undefined): Maybe<Expression> {
  return value && value.$tag === "Just" ? Just(value._0) : Nothing;
}

function emptyUiWire() {
  return {
    widget: Nothing as Maybe<string>,
    placeholder: Nothing as Maybe<string>,
    helpText: Nothing as Maybe<string>,
    prefix: Nothing as Maybe<string>,
    suffix: Nothing as Maybe<string>,
    options: Nothing as Maybe<SelectOption[]>,
    format: Nothing as Maybe<string>,
    columns: Nothing as Maybe<number>,
    refFilter: Nothing as Maybe<Expression>,
  };
}

function marshalUi(ui: Partial<EditDisplay> | undefined) {
  if (!ui) return emptyUiWire();
  return {
    widget: maybeString(ui.widget),
    placeholder: maybeText(ui.placeholder),
    helpText: maybeText(ui.helpText),
    prefix: maybeText(ui.prefix),
    suffix: maybeText(ui.suffix),
    options: maybeOptions(ui.options),
    format: maybeString(ui.format),
    columns: maybeNumber(ui.columns),
    refFilter: maybeExpr(ui.refFilter),
  };
}

function marshalChannel(channel: InputChannel | undefined): Maybe<InputChannel> {
  if (!channel) return Nothing;
  return Just({ ...channel });
}

function marshalWidgetHint(hint: WidgetHint | undefined) {
  return {
    widget: hint ? Just(hint.widget) : Nothing,
    reason: hint?.reason ?? "",
    config: hint?.config ?? {},
    alternatives: hint?.alternatives ?? [],
  };
}

function authoringWidgetHint(field: FieldDef, ui: Partial<EditDisplay> | undefined): WidgetHint | undefined {
  try { return widgetForField(field, ui); }
  catch (error) {
    // Draft-only structural fields deliberately have no persisted identity.
    // Widget hints are optional projections; the field plan still renders the
    // complete raw type. Malformed/hostile type envelopes remain errors.
    if (error instanceof TypeError && error.message.startsWith("field-identity semantic boundary")) return undefined;
    throw error;
  }
}

function kindOf(type: FenelType): string {
  const keys = Object.keys(type as Record<string, unknown>);
  return keys[0] ?? "";
}

function resolveDependentType(type: FenelType, values?: Record<string, unknown>, caller?: EvaluateContext): FenelType {
  if (!values) return type;
  return "$el" in type ? peelEl(type, values, caller) ?? type : type;
}

/** Host-only binding for the legacy frameless default/label/filter adapters.
 * Their algorithms stay unchanged; canonical dispatch uses this actual reader
 * frame instead of treating an optional registry as an account coordinate. */
function fieldReaderDefaults(caller?: EvaluateContext): DefaultRegistry {
  // GLOBAL_ONLY: standalone compatibility callers supply no reader frame;
  // the legacy adapters explicitly constrain their repository lookup.
  if (caller === undefined) return dispatchRegistry;
  return { resolve: (type, typeName) => caller._specRegistry
    ? resolveEffect(caller, caller._specRegistry, typeName, type)?.methods : undefined };
}

function variantCaseDefault(discriminator: string, caseDef: { name: string; fields?: FieldDef[] }, caller?: EvaluateContext): Record<string, unknown> {
  const out: Record<string, unknown> = { [discriminator || "$tag"]: caseDef.name };
  for (const field of caseDef.fields ?? []) {
    out[field.name] = defaultValueForAuthoring(field.type, fieldReaderDefaults(caller));
  }
  return out;
}

export function marshalFieldEditType(
  type: FenelType,
  options: { recordValues?: Record<string, unknown>; evaluateContext?: EvaluateContext } = {},
): FieldTypeWire {
  const resolved = "$el" in type ? resolveDependentType(type, options.recordValues, options.evaluateContext) : type;
  if (resolved !== type) return marshalFieldEditType(resolved, options);

  // Native JS values carry an opaque pure definition in the language. Marshal
  // their runtime representation as an atom, before the planner sees a sum or
  // a recursive list (Bool is a boolean; String is not a list of characters).
  const nativeAtom = dispatchEngineBody("engine:fieldNativeAtomNamePlan", [marshalTraversalType(type)], options.evaluateContext) as Maybe<string>;
  if (nativeAtom.$tag === "Just") {
    return { $tag: "FtNamed", name: nativeAtom._0, raw: type };
  }

  if ("$refined" in type) {
    return {
      $tag: "FtRefined",
      base: marshalFieldEditType(type.$refined.base, options),
      set: type.$refined.set,
      raw: type,
    };
  }

  const maybe = dispatchedPeelMaybe(type);
  if (maybe) {
    return {
      $tag: "FtMaybe",
      value: marshalFieldEditType(maybe.value, options),
      raw: type,
    };
  }

  const list = dispatchedPeelList(type);
  if (list) {
    return {
      $tag: "FtList",
      elem: marshalFieldEditType(list.elem, options),
      raw: type,
    };
  }

  if ("$opaque" in type && type.$opaque.pure) {
    return {
      $tag: "FtOpaque",
      name: type.$opaque.name ?? "",
      pure: marshalFieldEditType(type.$opaque.pure, options),
      raw: type,
    };
  }

  const handle = refHandle(type);
  if (handle !== undefined) {
    return { $tag: "FtNamed", name: handle, raw: type };
  }

  if ("$record" in type) {
    return { $tag: "FtRecord", fields: [...type.$record.fields], raw: type };
  }

  if ("$variant" in type) {
    const discriminator = type.$variant.discriminator ?? "$tag";
    return {
      $tag: "FtVariant",
      discriminator,
      cases: type.$variant.cases.map((c) => ({
        name: c.name,
        fields: c.fields ? [...c.fields] : [],
        defaultValue: variantCaseDefault(discriminator, c, options.evaluateContext),
      })),
      raw: type,
    };
  }

  if ("$map" in type) {
    return {
      $tag: "FtMap",
      keys: type.$map.keys,
      values: marshalFieldEditType(type.$map.values, options),
      raw: type,
    };
  }

  if ("$tagged" in type) {
    const phantom = marshalFieldEditType(type.$tagged.phantom, options);
    return {
      $tag: "FtTagged",
      value: marshalFieldEditType(type.$tagged.value, options),
      phantom,
      phantomTypeName: dispatchEngineBody("engine:fieldNominalTypeNamePlan", [phantom], options.evaluateContext) as string,
      entityType: phantomEntityName(type) ?? "",
      raw: type,
    };
  }

  if ("$arrow" in type) {
    return {
      $tag: "FtArrow",
      params: type.$arrow.params.map((p) => ({
        ...p,
        typeWire: marshalFieldEditType(p.type, options),
      })),
      returns: marshalFieldEditType(type.$arrow.returns, options),
      raw: type,
    };
  }

  if ("$type" in type) return { $tag: "FtType", raw: type };

  if ("$el" in type) {
    return { $tag: "FtEl", resolved: Nothing, raw: type };
  }

  return { $tag: "FtOther", kind: kindOf(type), raw: type };
}

function choiceTextEncoder(value: unknown, caller?: EvaluateContext): Maybe<unknown> {
  if (caller === undefined) return Nothing;
  try {
    return withRuntimeRepresentationProjection(caller, frame => {
      const owner = typeConstructorOf(value, frame);
      if (owner === undefined) return Nothing;
      const selected = resolveCompleteMethodForEvaluation(frame, "Encodable", "encode", ["String", owner]);
      return selected?.$tag === "Resolved"
        ? Just(typeof selected._0 === "string" ? { $ref: selected._0 } : selected._0) : Nothing;
    });
  } catch { return Nothing; }
}

function resolveEnumOptions(type: FenelType, ui?: Partial<EditDisplay>, registry?: ModuleRegistry, caller?: EvaluateContext,
  listChoices = false): Maybe<SelectOption[]> {
  const provided = dispatchEngineBody("engine:fieldChoiceOptionsPlan", [maybeOptions(ui?.options), Nothing]) as Maybe<SelectOption[]>;
  if (provided.$tag === "Just") return provided;
  let current = type;
  const seen = new Set<string>();
  let atom: string | undefined;
  for (let i = 0; i < 8; i++) {
    const h = refHandle(current);
    if (!h || TERMINAL_BASE_NAMES.has(h) || seen.has(h)) break;
    seen.add(h);
    atom = h;
    const resolved = registry !== undefined
      ? (registry.getIdentifiedEntity(h) ?? registry.getEntity(h))?.type
      : caller !== undefined ? caller.getEntityType?.(h)
      : (getCatalogEntry(`entity:${h}`) as { entity?: { type?: FenelType } } | undefined)?.entity?.type;
    if (!resolved) break;
    current = resolved;
  }

  const values = dispatchEngineBody(listChoices ? "engine:fieldNullaryListChoiceValuesPlan" : "engine:fieldFiniteChoiceValuesPlan",
    [marshalFieldEditType(current, { evaluateContext: caller })], caller) as Maybe<unknown[]>;
  const optionRegistry = caller === undefined ? undefined : fieldReaderDefaults(caller);
  const derived = values.$tag === "Just" ? Just(values._0.map((value) => ({
    value,
    label: typeof value === "string"
      ? enumOptionLabel(atom ?? "", value, optionRegistry)
      : dispatchEngineBody("engine:fieldChoiceLabelPlan", [value, choiceTextEncoder(value, caller),
        print(value, undefined, caller === undefined ? undefined : { evaluateContext: caller })], caller) as string,
  }))) : Nothing;
  return dispatchEngineBody("engine:fieldChoiceOptionsPlan", [Nothing, derived]) as Maybe<SelectOption[]>;
}

/** B3 invocation only: Fenel owns equality and selection; the host renders
 * browser handles for the resulting ordinal without changing the value. */
export function fieldChoiceSelectionPlan(options: readonly SelectOption[], value: unknown, caller?: EvaluateContext): { selectedIndex: Maybe<number> } {
  return dispatchEngineBody("engine:fieldChoiceSelectionPlan", [[...options], value], caller) as { selectedIndex: Maybe<number> };
}

export type FieldListChipsAction =
  | { $tag: "FieldListAppendChoice"; index: number; expected: unknown }
  | { $tag: "FieldListRemoveOccurrence"; index: number; expected: unknown }
  | { $tag: "FieldListToggleChoice"; index: number; expected: unknown };

/** B3 ordinal/selection transport; equality remains source-owned. */
export function fieldListChipsSelectionPlan(options: readonly SelectOption[], value: unknown,
  caller?: EvaluateContext): { occurrences: Maybe<number>[]; selected: boolean[] } {
  return dispatchEngineBody("engine:fieldListChipsSelectionPlan", [[...options], value], caller) as
    { occurrences: Maybe<number>[]; selected: boolean[] };
}

type CanonicalListObservation = { snapshot: unknown; declaration: unknown };
type CanonicalListReader = EvaluateContext & {
  _canonicalListDomain?: (type: FenelType) => CanonicalListObservation | undefined;
  _typeDeclarationScope?: (ownerIdentity: string) => { owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string } | undefined;
};

/** A2/B3 extension: acquire fresh inert observations from the owning reader.
 * A stored checked-looking value is never consulted; Fenel rechecks the actual
 * domain, declaration and dependencies on every presentation and gesture. */
function canonicalListObservation(type: FenelType, caller?: EvaluateContext): Maybe<CanonicalListObservation> {
  try {
    const observed = (caller as CanonicalListReader | undefined)?._canonicalListDomain?.(type);
    return observed === undefined ? Nothing : Just(observed);
  } catch { return Nothing; }
}

/** B3 transport of the existing membership judgment. The account coordinate
 * is derived only from the current authenticated reader frame. */
function fieldListMembership(type: FenelType, value: unknown, caller?: EvaluateContext, registry?: ModuleRegistry): Maybe<boolean> {
  try {
    // GLOBAL_ONLY: a standalone synthetic control has no authenticated frame
    // or account coordinate; named account data cannot be acquired there.
    const account = caller === undefined ? null : frameAccount(caller);
    const typing = caller?._callSiteTyping;
    let validationType = type;
    const validationFrame = authoringMembershipEvaluateContext(caller ?? {});
    if (typing !== undefined) {
      const resolved = typing.resolveType(type, caller?._sourceFunction);
      if (!resolved.ok) return Nothing;
      const closedType = closeAuthoringMembershipType(resolved.type, validationFrame);
      if (closedType === undefined) return Nothing;
      validationType = closedType;
      const owner = resolved.type.nominals?.find(nominal => nominal.path.length === 0)?.identity;
      if (owner !== undefined) {
        const scope = (caller as CanonicalListReader)._typeDeclarationScope?.(owner);
        if (scope === undefined) return Nothing;
        validationFrame._importStack = [{ names: scope.names, aliases: {} }];
        validationFrame._sourceFunction = scope.sourceFunction;
      }
      const verdict = typing.member(resolved.type, value, account, validationFrame);
      if (verdict === "yes") return Just(true);
      if (verdict === "no") return Just(false);
    } else {
      const projected = dispatchedTypeToSetProjection(marshalTraversalType(type));
      if (projected.degraded) return Nothing;
      const membership = contains(projected.set, value, account, {}, validationFrame);
      if (membership.$tag === "Just") return membership;
    }
    const observations: Maybe<boolean>[] = [];
    const plans: Array<Parameters<NonNullable<ValidateOptions["observeAdmission"]>>[0]> = [];
    const checked = validateValue(validationType, value, account, {
      registry, functions: validationFrame, coerce: false,
      strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
      observeMembership: verdict => observations.push(verdict),
      observeAdmission: plan => plans.push(plan),
    });
    return authoringValidationMembership(checked, observations, plans);
  } catch { return Nothing; }
}

/** B3 invocation only: source owns list edits, canonical ordering and refusal.
 * The UI supplies a current ordinal; it never supplies a trusted domain token.
 * Re-plan from the current type/reader instead of trusting a mounted option. */
export function fieldListChipsEditPlan(type: FenelType, value: unknown, action: FieldListChipsAction,
  caller?: EvaluateContext, registry?: ModuleRegistry, declarationType?: FenelType): FieldRecordResult<unknown[]> {
  const list = dispatchedPeelList(type);
  const choices = list ? resolveEnumOptions(list.elem, undefined, registry, caller, true) : Nothing;
  const expected = declarationType ?? type;
  const observed = canonicalListObservation(expected, caller);
  const candidate = dispatchEngineBody("engine:fieldListChipsChoicesCandidate", [choices, value, action, observed,
    observed.$tag === "Just" ? fieldListMembership(expected, value, caller, registry) : Nothing, value === undefined], caller) as FieldRecordResult<unknown[]>;
  const membership = candidate?.$tag === "Ok" ? fieldListMembership(expected, candidate._0, caller, registry) : Nothing;
  return dispatchEngineBody("engine:fieldListChipsAdmission", [candidate, membership], caller) as FieldRecordResult<unknown[]>;
}

/** Source policy supplies function values; the reader invokes them in its
 * captured frame. The host only decodes the optional data record. */
export function fieldNumericTextCodecPlan(name: string, caller?: EvaluateContext): { decode: unknown; encode: unknown } | undefined {
  return maybeOut<{ decode: unknown; encode: unknown }>(dispatchEngineBody("engine:fieldNumericTextCodecPlan", [name], caller));
}

/** Existing branch validation supplies facts; source selects the first
 * admitted presentation without changing the authored value. */
export function fieldUnionBranchSelectionPlan(admitted: readonly boolean[], caller?: EvaluateContext): number | undefined {
  return maybeOut<number>(dispatchEngineBody("engine:fieldUnionBranchSelectionPlan", [[...admitted]], caller));
}

function fieldRecordDeclaration(value: unknown, caller?: EvaluateContext): Maybe<readonly string[]> {
  if (caller === undefined || value === null || typeof value !== "object") return Nothing;
  try {
    const tag = constructorSemanticFieldRead(value, "$tag", caller);
    const names = tag.found && typeof tag.value === "string" ? constructorDeclaredFieldNames(caller, tag.value) : undefined;
    return names === undefined ? Nothing : Just(names);
  } catch { return Nothing; }
}

/** B3: the descriptor snapshot and captured declaration are observations;
 * source chooses and preserves the physical field spelling. */
export type FieldRecordResult<T> = { $tag: "Err"; _0: string } | { $tag: "Ok"; _0: T };
export type FieldRecordSlot = { wire: string; value: Maybe<unknown> };
export type FieldRecordSlotEntry = { field: string; slot: FieldRecordResult<FieldRecordSlot> };

export function fieldRecordSlotPlan(value: unknown, field: string, caller?: EvaluateContext): FieldRecordResult<FieldRecordSlot> {
  return dispatchEngineBody("engine:fieldRecordSlotPlan", [representationValueSnapshot(value), fieldRecordDeclaration(value, caller), field], caller) as FieldRecordResult<FieldRecordSlot>;
}

/** One descriptor/declaration observation for the existing source slot owner.
 * Request order, duplicate fields and individual refusals stay source-owned. */
export function fieldRecordSlotsPlan(value: unknown, fields: readonly string[], caller?: EvaluateContext): FieldRecordSlotEntry[] {
  return dispatchEngineBody("engine:fieldRecordSlotsPlan", [representationValueSnapshot(value), fieldRecordDeclaration(value, caller), [...fields]], caller) as FieldRecordSlotEntry[];
}

export function fieldRecordEditPlan(value: unknown, field: string, edited: unknown, caller?: EvaluateContext): FieldRecordResult<unknown> {
  return dispatchEngineBody("engine:fieldRecordEditPlan", [representationValueSnapshot(value), fieldRecordDeclaration(value, caller), field, edited], caller) as FieldRecordResult<unknown>;
}

function listDefault(type: FenelType, recordValues?: Record<string, unknown>, caller?: EvaluateContext): Maybe<unknown> {
  const resolved = resolveDependentType(type, recordValues, caller);
  const list = dispatchedPeelList(resolved);
  return list ? Just(defaultValueForAuthoring(list.elem, fieldReaderDefaults(caller))) : Nothing;
}

function defaultRefFilter(type: FenelType, caller?: EvaluateContext): Maybe<Expression> {
  let entityType: string | undefined;
  try { entityType = phantomEntityName(type) ?? undefined; }
  catch (error) {
    if (error instanceof TypeError && error.message.startsWith("field-identity semantic boundary")) return Nothing;
    throw error;
  }
  const filter = defaultFilterFor(entityType, fieldReaderDefaults(caller));
  return filter ? Just(filter) : Nothing;
}

function legacyRefFilter(field: FieldDef): Maybe<Expression> {
  const maybeFilter = (fieldMeta(field) as { refFilter?: Expression }).refFilter;
  return maybeFilter ? Just(maybeFilter) : Nothing;
}

function maybeOut<T>(value: unknown): T | undefined {
  if (!value || typeof value !== "object") return undefined;
  const m = value as Maybe<T>;
  return m.$tag === "Just" ? m._0 : undefined;
}

function normalizeEditor(raw: unknown): FieldEditorPlan {
  const editor = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = typeof editor.kind === "string" ? editor.kind : "unsupported";
  const rawType = (editor.rawType && typeof editor.rawType === "object" ? editor.rawType : { $void: true }) as FenelType;

  switch (kind) {
    case "text":
      return {
        kind,
        rawType,
        set: maybeOut<SetExpr>(editor.set),
        widget: typeof editor.widget === "string" ? editor.widget : "text",
        inputType: typeof editor.inputType === "string" ? editor.inputType : "text",
        icon: maybeOut<string>(editor.icon),
        prefix: maybeOut<string>(editor.prefix),
        suffix: maybeOut<string>(editor.suffix),
        placeholder: maybeOut<string>(editor.placeholder),
        validationFormat: maybeOut<string>(editor.validationFormat),
      };
    case "number":
      return {
        kind,
        rawType,
        representation: editor.representation as "number" | "rational",
        numericTypeName: editor.numericTypeName as string,
        textCodec: maybeOut<{ decode: unknown; encode: unknown }>(editor.textCodec),
        set: maybeOut<SetExpr>(editor.set),
        widget: typeof editor.widget === "string" ? editor.widget : "number-input",
        bounds: maybeOut<FieldBoundsPlan>(editor.bounds),
        integer: editor.integer === true,
        prefix: maybeOut<string>(editor.prefix),
        suffix: maybeOut<string>(editor.suffix),
        placeholder: maybeOut<string>(editor.placeholder),
      };
    case "date":
      return {
        kind,
        rawType,
        set: maybeOut<SetExpr>(editor.set),
        inputType: typeof editor.inputType === "string" ? editor.inputType : "date",
        min: maybeOut<string>(editor.min),
        max: maybeOut<string>(editor.max),
        placeholder: maybeOut<string>(editor.placeholder),
      };
    case "select":
      return {
        kind,
        rawType,
        options: Array.isArray(editor.options) ? (editor.options as SelectOption[]) : [],
        radio: editor.radio === true,
        multi: editor.multi === true,
        placeholder: maybeOut<string>(editor.placeholder),
      };
    case "boolean":
    case "locale-string":
    case "file":
    case "arrow":
    case "type":
    case "map":
      return { kind, rawType } as FieldEditorPlan;
    case "ref":
      return {
        kind,
        rawType,
        entityType: typeof editor.entityType === "string" ? editor.entityType : "unknown",
        filter: maybeOut<Expression>(editor.filter),
        filterSource: typeof editor.filterSource === "string" ? editor.filterSource : "none",
        placeholder: maybeOut<string>(editor.placeholder),
      };
    case "list":
      return {
        kind,
        rawType,
        itemType: (editor.itemType && typeof editor.itemType === "object" ? editor.itemType : { $void: true }) as FenelType,
        itemTypeLabel: typeof editor.itemTypeLabel === "string" ? editor.itemTypeLabel : "",
        itemDefault: maybeOut<unknown>(editor.itemDefault),
        choices: maybeOut<SelectOption[]>(editor.choices),
        canonical: editor.canonical === true,
      };
    case "record":
    case "freeform-record":
      return {
        kind,
        rawType,
        fields: Array.isArray(editor.fields) ? (editor.fields as FieldDef[]) : [],
      } as FieldEditorPlan;
    case "variant":
      return {
        kind,
        rawType,
        discriminator: typeof editor.discriminator === "string" ? editor.discriminator : "$tag",
        cases: Array.isArray(editor.cases) ? (editor.cases as FieldVariantCasePlan[]) : [],
        toggle: editor.toggle !== false,
      };
    case "matrix":
      return {
        kind,
        rawType,
        rows: Array.isArray(editor.rows) ? (editor.rows as FieldMatrixRowPlan[]) : [],
        columns: Array.isArray(editor.columns) ? (editor.columns as FieldDef[]) : [],
      };
    case "markup":
      return {
        kind,
        rawType,
        set: maybeOut<SetExpr>(editor.set),
        expression: editor.expression === true,
      };
    case "string-expression":
      return {
        kind,
        rawType,
        placeholder: maybeOut<string>(editor.placeholder),
      };
    case "expression":
      return {
        kind,
        rawType,
        leaf: typeof editor.leaf === "string" ? editor.leaf : undefined,
      };
    case "custom":
      return {
        kind,
        rawType,
        leaf: typeof editor.leaf === "string" ? editor.leaf : "",
        placeholder: maybeOut<string>(editor.placeholder),
        channel: editor.channel as InputChannel | undefined,
      };
    default:
      return {
        kind: "unsupported",
        rawType,
        reason: typeof editor.reason === "string" ? editor.reason : `Unsupported editor kind ${kind}`,
        channel: editor.channel as InputChannel | undefined,
      };
  }
}

function normalizePlan(raw: unknown): FieldEditPlan {
  const plan = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: typeof plan.name === "string" ? plan.name : "",
    label: typeof plan.label === "string" ? plan.label : "",
    typeLabel: typeof plan.typeLabel === "string" ? plan.typeLabel : "",
    required: plan.required === true,
    helpText: maybeOut<string>(plan.helpText),
    columns: maybeOut<number>(plan.columns),
    editor: normalizeEditor(plan.editor),
  };
}

export function fieldTypeLabelPlan(
  type: FenelType | undefined,
  recordValues?: Record<string, unknown>,
  caller?: EvaluateContext,
): string {
  if (!type) return "";
  return dispatchedFieldTypeLabelPlan(marshalFieldEditType(type, { recordValues, evaluateContext: caller }), caller);
}

export function fieldEditPlan(args: FieldEditPlanArgs): FieldEditPlan {
  const caller = args.evaluateContext ?? args.registry?.evaluateContext();
  const view = args.registry === undefined
    ? undefined
    : resolveIdentifiedFieldView(args.registry, args.field, args.presentationOverride);
  const field = view?.field ?? args.field;
  const ui = view?.display ?? (args.registry === undefined
    ? args.presentationOverride?.display as Partial<EditDisplay> | undefined
    : undefined);
  const resolvedType = resolveDependentType(fieldType(field), args.recordValues, caller);
  const genericValue = "$ref" in resolvedType && (resolvedType.$ref === "Value" || resolvedType.$ref === "Any" || resolvedType.$ref === "Bytes");
  const list = dispatchedPeelList(resolvedType);
  const expected = args.declarationType ?? resolvedType;
  const canonicalListContext = list ? canonicalListObservation(expected, caller) : Nothing;
  const input = {
    name: field.name,
    label: view === undefined ? field.name : textOf(view.presentation.label),
    required: genericValue || dispatchedPeelMaybe(resolvedType) === null,
    type: marshalFieldEditType(resolvedType, { recordValues: args.recordValues, evaluateContext: caller }),
    rawField: field,
    value: args.value,
    ui: marshalUi(ui),
    selectOptions: genericValue ? Nothing : resolveEnumOptions(resolvedType, ui, args.registry, caller),
    widgetHint: marshalWidgetHint(genericValue ? undefined : authoringWidgetHint(field, ui)),
    channel: marshalChannel(args.channel),
    listItemDefault: listDefault(resolvedType, args.recordValues, caller),
    listChoices: list ? resolveEnumOptions(list.elem, undefined, args.registry, caller, true) : Nothing,
    canonicalListContext,
    listMembership: canonicalListContext.$tag === "Just" ? fieldListMembership(expected, args.value, caller, args.registry) : Nothing,
    defaultRefFilter: genericValue ? Nothing : defaultRefFilter(resolvedType, caller),
    legacyRefFilter: legacyRefFilter(field),
  };
  return normalizePlan(dispatchedFieldEditPlan(input, caller));
}

/** A2/B3 reader binding. Existing Fenel plans own target normalization,
 * channel selection, the lazy declaration-fallback decision and final merge.
 * The registry supplies exact declarations/facets and the existing $el seam
 * invokes its source evaluator with the current sibling data and reader. */
export function fieldReaderPlan(args: FieldReaderPlanArgs): FieldReaderPlan {
  const caller = args.evaluateContext ?? args.registry?.evaluateContext();
  const fieldRegistry = args.fieldMode === "identified" ? args.registry : undefined;
  const type = peelEl(args.field.type, args.recordValues, caller) ?? args.field.type;
  const field = { ...args.field, type };
  const wire = marshalFieldEditType(type, { evaluateContext: caller });
  const target = maybeOut<string>(dispatchEngineBody("engine:fieldReaderInputableTargetPlan", [args.channelsEnabled, wire], caller));
  const canonicalTarget = target === undefined ? undefined : args.registry?.getIdentifiedEntity(target)?.id ?? target;
  const methods = canonicalTarget !== undefined
    ? fieldReaderDefaults(caller).resolve(canonicalTarget, "Inputable", GLOBAL_ONLY) : undefined;
  const selected = dispatchEngineBody("engine:fieldReaderChannelSelectionPlan", [
    methods?.channels === undefined ? Nothing : Just(methods.channels), args.channelId === undefined ? Nothing : Just(args.channelId),
  ], caller) as FieldRecordResult<{ channels: InputChannel[]; channel: Maybe<InputChannel>; activeChannelId: Maybe<string> }>;
  if (selected.$tag !== "Ok") throw new TypeError(selected._0);
  const selection = selected._0;
  const useValues = dispatchEngineBody("engine:fieldReaderRecordValuesPlan", [wire], caller) as boolean;
  const requested = fieldEditPlan({ ...args, registry: fieldRegistry, evaluateContext: caller, field,
    recordValues: useValues ? args.recordValues : undefined, channel: maybeOut<InputChannel>(selection.channel) });
  const alias = maybeOut<string>(dispatchEngineBody("engine:fieldReaderDeclarationFallbackPlan",
    [requested, selection.channels, marshalTraversalType(type)], caller));
  const declaration = alias === undefined ? undefined : args.registry?.getIdentifiedEntity(alias)?.type;
  let fallback: Maybe<FieldEditPlan> = Nothing;
  if (declaration !== undefined) {
    const concrete = peelEl(declaration, args.recordValues, caller) ?? declaration;
    const concreteWire = marshalFieldEditType(concrete, { evaluateContext: caller });
    const concreteValues = dispatchEngineBody("engine:fieldReaderRecordValuesPlan", [concreteWire], caller) as boolean;
    fallback = Just(fieldEditPlan({ ...args, registry: fieldRegistry, evaluateContext: caller,
      field: { ...args.field, type: concrete }, declarationType: type,
      recordValues: concreteValues ? args.recordValues : undefined }));
  }
  const result = dispatchEngineBody("engine:fieldReaderPlanResult", [requested, fallback, selection], caller) as {
    plan: FieldEditPlan; channels: InputChannel[]; activeChannelId: Maybe<string>;
  };
  const activeChannelId = maybeOut<string>(result.activeChannelId);
  return { plan: result.plan, channels: result.channels, ...(activeChannelId === undefined ? {} : { activeChannelId }) };
}

export function textChannelFromPlan(plan: FieldEditorPlan): TextChannel | undefined {
  if (plan.kind !== "custom" || !plan.channel || plan.channel.kind !== "text") return undefined;
  return plan.channel as TextChannel;
}
