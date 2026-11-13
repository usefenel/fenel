// ---------------------------------------------------------------------------
// FieldDef metadata sidecar + helpers
//
// FenelType captures the data shape of a field. Form-only metadata that
// doesn't fit a pure type (pre-processing transforms, physical units,
// granularity, ref filters, list constraints, matrix row keys) lives here
// and travels alongside on each FieldDef as `meta`.
//
// Optional fields are genuinely optional — only fields present on the
// original FieldDef appear here.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type {
  FenelType,
  FieldDef,
  MeasureExpr,
  InputChannel,
  Expression,
} from "./types";
import type { GeoLevel } from "./places";
import { peelMaybe, peelList } from "./set-algebra";
import { refHandle } from "./type-foundation";
import { GLOBAL_ONLY, type InstanceVisibility } from "./dispatch-registry";
// 3b-2 — the Id-phantom's `$refined.set` is a SetExpr slot; dual-read it.
import { peelSetExpr } from "./set-marker";

/** Form-only metadata sidecar — structurally empty after canonical-maybe
 *  Phase 11 (2026-05-27). The former unit slot retired (migrated
 *  by `0066`); units live on the type via `measureType : MeasureExpr -> Type`.
 *  Field-meta-collapse Phase 3–5d (migrations
 *  0048–0052) earlier retired the runtime readers; this is the structural
 *  cleanup. The named type is kept (not inlined) because Phase 8's
 *  `fieldMetadataUndefinable` preview-instance dispatches on `$named:
 *  "FieldMetadata"` for codec-boundary Undefinable lookups.
 *  `Record<string, never>` for strictness — accidental key injection
 *  becomes a compile-time error. If a real use case demands a slot back,
 *  lift via canonical Maybe (Option B in the Phase 11 brief), don't
 *  un-retire the `?:` slot. */
export type FieldMetadata = Record<string, never>;

/** Trivial accessor — kept for symmetry with `fieldMeta`. */
export function fieldType(f: FieldDef): FenelType {
  return f.type;
}

/**
 * Arrow-domain projection — a function's parameter list IS a record type.
 *
 * `action-subsumption` Phase 1 / Decision D2: a function signature is a
 * type, so validating a call's *arguments* is the same `validate(Type, Value)`
 * over the function's arrow-domain-record. This is the resolver that turns a
 * function (its `params: FieldDef[]`) into that `{$record:{fields}}` — the
 * record the `*_params` system entity used to mirror redundantly. The
 * `*_params` entity *was* this projection, hand-maintained alongside the
 * function; deleting it loses nothing because the function already holds the
 * params.
 *
 * `exclude` drops context-injected params (the dispatcher supplies these from
 * `ActionContext`, the caller does not) from the validated domain — for the
 * pilot the only entry is `adapter` (D4 keeps it an explicit param; the
 * Channel arc removes the param and the exclusion both).
 */
export function paramRecordOf(
  fn: { params: readonly FieldDef[] },
  exclude?: ReadonlySet<string>,
): FenelType {
  const fields = exclude
    ? fn.params.filter((p) => !exclude.has(p.name))
    : [...fn.params];
  return { $record: { fields } };
}

/** Derive the form-only metadata sidecar of a FieldDef.
 *  Canonical-maybe Phase 9 (2026-05-27): `?? {}` defensive fallback
 *  retired. `FieldDef.meta` is now mandatory `FieldMetadata`; the
 *  `{}` empty-record is the natural absence-marker. Any unmigrated
 *  row reaching this accessor is a real bug, not a soft case. */
export function fieldMeta(f: FieldDef): FieldMetadata {
  return f.meta;
}

/**
 * Entity name encoded in a `$tagged` ref's phantom type. The canonical
 * pattern for entity refs is:
 *   `{ $tagged: { value: { $named: "Id" }, phantom: { $refined: {
 *      base: { $named: "String" }, set: { $enum: ["<entity_name>"] } } } } }`
 *
 * Returns the entity name from the `$enum` set, or `null` if the type
 * isn't a `$tagged`-with-phantom-enum shape.
 *
 * Field-identity Phase 3 — TS remains a thin public shim. The boundary emits
 * an optional descriptor-safe TraversalType; Fenel owns tagged/refined/enum
 * recognition and the final string check.
 */
export function phantomEntityName(type: FenelType | undefined): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPhantomEntityName } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPhantomEntityName(type);
}

/** The entity name a `$tagged` ref points at — derived from the phantom
 *  type. Returns null when the field isn't a typed entity reference.
 *
 *  Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 *  Fenel-bodied `engine:refEntityTypeOf` (delegates to phantomEntityName). */
export function refEntityTypeOf(f: FieldDef): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedRefEntityTypeOf } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedRefEntityTypeOf(f);
}

/** The typed measure carried by a tagged scalar's MeasureExpr phantom.
 *  Source owns recognition; this boundary preserves the complete unit data. */
export function phantomUnitOf(type: FenelType | undefined): MeasureExpr | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPhantomUnitOf } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPhantomUnitOf(type);
}

/** GeoLevel a `Place`-shaped type carries — extracted from the type's
 *  `$tagged.phantom.$refined.set.$enum[0]` slot. Returns null when the
 *  type isn't a `Place`-shape, i.e. when the inner `$tagged.value.$named`
 *  is not `"GeoPath"`.
 *
 *  Field-identity Phase 3 — symmetric reader for the
 *  `Place : GeoLevel -> Type` constructor in places.ts. Fenel applies the
 *  `TtNamed "GeoPath"` gate and refined-enum selection over the shared
 *  TraversalType, so Q-shape / Id-shape phantoms remain distinct. */
export function phantomGeoLevelOf(
  type: FenelType | undefined,
): GeoLevel | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedPhantomGeoLevelOf } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedPhantomGeoLevelOf(type) as GeoLevel | null;
}

/** Discriminator field name for a `$variant` type — read from the type's
 *  own `discriminator`, since meta.unionDiscriminator was retired.
 *
 *  Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 *  Fenel-bodied `engine:variantDiscriminator`. */
export function variantDiscriminator(type: FenelType): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedVariantDiscriminator } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedVariantDiscriminator(type);
}

/**
 * Synthesize sub-FieldDefs for a composite FieldDef by peeling its
 * FenelType. `$record` yields its fields; `$list` / `$maybe` yield a
 * single inner FieldDef named "item" / "value". Returns an empty array
 * for non-composite types.
 *
 * Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 * Fenel-bodied `engine:subFieldDefs`. The wrapper does dispatched peelList +
 * peelMaybe for the list/maybe arms (already Fenel-bodied per Phase 7c).
 */
export function subFieldDefs(f: FieldDef): FieldDef[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSubFieldDefs } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedSubFieldDefs(f) as FieldDef[];
}

/**
 * Synthesize per-variant payload FieldDefs from a FieldDef whose type
 * is a `$variant`. Returns `{}` when the type isn't a variant.
 *
 * Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 * Fenel-bodied `engine:variantFieldDefs`.
 */
export function variantFieldDefs(f: FieldDef): Record<string, FieldDef[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedVariantFieldDefs } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedVariantFieldDefs(f) as Record<string, FieldDef[]>;
}

/** Loose type-source — engine FenelType OR a raw JSONB Record (from a DB
 *  row before drizzle types it) OR null. Helpers normalize all three. */
type TypeSource = FenelType | Record<string, unknown> | null | undefined;

/**
 * Resolve an EntitySpec's (or EntityRelation's) surface as FieldDef[]
 * by extracting fields from its `$record` type. Non-record types yield
 * an empty list.
 *
 * The parameter is loosened to also accept legacy DB-row shapes that
 * may still carry a pre-Phase-9 `schema` JSONB array.
 *
 * Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 * Fenel-bodied `engine:entitySchemaFields`. The wrapper does asFenelType
 * narrowing + liftLegacyFields TS-side (both stay TS per the DEFER list).
 */
export function entitySchemaFields(
  spec: { type?: TypeSource; schema?: unknown },
): FieldDef[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEntitySchemaFields } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedEntitySchemaFields(spec) as FieldDef[];
}

/**
 * Resolve an EntitySpec's (or EntityRelation's) canonical FenelType.
 *
 * Returns `spec.type` directly. Falls back to lifting a legacy `schema`
 * column into a `$record` FenelType for raw DB rows that haven't been
 * normalized yet. Returns `null` when neither side is populated.
 *
 * Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 * Fenel-bodied `engine:entityRecordType`.
 */
export function entityRecordType(
  spec: { type?: TypeSource; schema?: unknown },
): FenelType | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedEntityRecordType } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedEntityRecordType(spec);
}

/**
 * Resolve a FormDefinition's input fields as FieldDef[]. Mirrors
 * `entitySchemaFields` for forms. Prefers `def.type.$record`; falls
 * back to a legacy `fields` JSONB array for raw DB rows.
 *
 * Phase 10c sub-step 1 — TS body collapsed to a thin shim over the
 * Fenel-bodied `engine:formDefinitionFields`.
 */
export function formDefinitionFields(
  def: { type?: TypeSource; fields?: unknown },
): FieldDef[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedFormDefinitionFields } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchedFormDefinitionFields(def) as FieldDef[];
}

// ---------------------------------------------------------------------------
// defaultValueFor — type-driven default value resolution
//
// Phase 9.E: defaults belong to the type, not to a per-field slot.
// Atomic types ($named) resolve through the HasDefault typeclass registry;
// composites ($list / $record / $variant / $maybe / $tagged / $map) recurse
// structurally so callers don't need a HasDefault instance for every shape.
// $refined / $opaque peel to their base.
// ---------------------------------------------------------------------------

/** Minimal typeclass-registry interface this module needs.
 *
 *  ⚠ rights R3a — THIS IS A HAND-TYPED STRUCTURAL FACADE, and it is a CENSUS
 *  target rather than something the compiler floor covers on its own (Ruling 2).
 *  Its `resolve` mirrors the third parameter so a `DispatchRegistry` still
 *  satisfies it and so a future hand-built implementation cannot quietly drop
 *  the visibility.
 *
 *  Every call below states `GLOBAL_ONLY`: these are DISPLAY and default-value
 *  reads (`HasDefault` / `Labelable` / `Inputable` / `Filterable`) reached from
 *  renderers and authoring surfaces that hold no frame to derive an account
 *  from. That closes the leak — account B's overlays no longer render for
 *  account A — and DECLARES the loss: account-authored defaults, enum labels,
 *  input channels and default filters stop being consulted here until
 *  R3a-tail's registry-identity filter or R4's decider authority restores them
 *  (brief §8.1b). */
export type DefaultRegistry = {
  resolve(
    type: string,
    typeName: string,
    visibility: InstanceVisibility,
  ): Record<string, unknown> | undefined;
};

/**
 * Derive a default value for any FenelType.
 *
 * Composite shapes recurse structurally; atomic shapes look up `HasDefault`
 * in the typeclass registry. When no HasDefault instance is registered for
 * an atomic type, falls back to a sensible primitive default
 * (`""` for strings, `0` for numbers, `false` for Boolean, `null` else).
 */
export function defaultValueFor(type: FenelType, registry?: DefaultRegistry): unknown {
  // `{$ref}`/`{$named}` in type position — typed-function-references Phase 7e.
  // 7g-retire-4a INVERT: an unresolvable reference falls through to the
  // name-handle arm below, which keys the `HasDefault` registry lookup by the
  // code-name handle (D3) via `refHandle` — so a `{$ref:"X"}` defaults
  // identically to its `{$named:"X"}` twin (was: rewrite `{$ref}`→`{$named}` + recurse).
  if (peelMaybe(type)) return null;
  if ("$void" in type) return null;
  if ("$unit" in type) return null;
  if (peelList(type)) return [];
  if ("$tuple" in type) return type.$tuple.map((t) => defaultValueFor(t, registry));
  if ("$record" in type) {
    const obj: Record<string, unknown> = {};
    // FM-retire-Z — the per-field `default` slot is retired; defaults are
    // type-level (`HasDefault`), resolved by recursing into the field's type.
    for (const f of type.$record.fields) {
      obj[f.name] = defaultValueFor(f.type, registry);
    }
    return obj;
  }
  if ("$variant" in type) {
    // First case is the default; populate its payload fields.
    const first = type.$variant.cases[0];
    if (!first) return null;
    const obj: Record<string, unknown> = { $tag: first.name };
    for (const f of first.fields ?? []) {
      obj[f.name] = defaultValueFor(f.type, registry);
    }
    return obj;
  }
  if ("$tagged" in type) return ""; // ID-shaped reference, empty until selected
  if ("$map" in type) return {};
  if ("$refined" in type) return defaultValueFor(type.$refined.base, registry);
  if ("$opaque" in type && type.$opaque.pure) return defaultValueFor(type.$opaque.pure, registry);
  if ("$mu" in type) return defaultValueFor(type.$mu.body, registry);
  if ("$el" in type) return null; // dependent type / deferred type-app — resolve later
  if ("$var" in type) return null; // unresolved type variable
  // 7g-retire-4a INVERT: name-handle (`{$ref}` OR `{$named}`).
  {
    const handle = refHandle(type);
    if (handle !== undefined) {
      if (registry) {
        const methods = registry.resolve(handle, "HasDefault", GLOBAL_ONLY);
        if (methods && "default" in methods) return methods["default"];
      }
      // Fallback when no instance is registered.
      switch (handle) {
        case "String": return "";
        case "Number": case "Int": case "Nat": case "ℝ": case "ℤ": case "ℕ": return 0;
        case "Boolean": return false;
        case "Date": return "";
        case "File": return null;
        case "Unit": return null;
        default: return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// enumOptionLabel — the per-value display label for an `$enum`-refined atom
//
// FM-retire-E1 Step 3 — the single source of truth for "how does enum value
// `<value>` of atom `<atomName>` display". The renderer (FieldRenderer's
// select derivation) and the generate-then-lock oracle both call this, so the
// derived option set provably reproduces the deleted `fieldUi.options` arrays.
//
// Resolution: the per-value `Labelable` keyed `<atomName>.<value>` (authored as
// `@valueLabel` ONLY for irregular labels humanize can't reproduce) → otherwise
// Fenel's literal-character/word fallback. Word labels retain humanization;
// a literal codepoint retains its exact letter case.
// ---------------------------------------------------------------------------

/** Display label for enum `value` of atom `atomName`: the `<atomName>.<value>`
 *  Labelable, else the Fenel-owned literal-character/word fallback. */
export function enumOptionLabel(
  atomName: string,
  value: string,
  registry?: DefaultRegistry,
): string {
  // This legacy enum-label API has no reader frame; retain its GLOBAL_ONLY
  // projection rather than inferring an account from its optional registry.
  const methods = registry?.resolve(`${atomName}.${value}`, "Labelable", GLOBAL_ONLY);
  const lbl = methods && (methods as Record<string, unknown>)["label"];
  if (typeof lbl === "string") return lbl;
  // B3 String admission retains the legacy falsy wire result and refusal of
  // truthy nonstrings; the Fenel formatter receives actual String data only.
  if (typeof value !== "string") {
    if (!value) return value;
    throw new TypeError("enumOptionLabel: expected String choice data");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");
  return dispatchEngineBody("engine:enumOptionLabelFallback", [value]) as string;
}

// ---------------------------------------------------------------------------
// channelsFor — type-driven default input channels via Inputable
// ---------------------------------------------------------------------------

/** Resolve the default input channels for a FenelType through the
 *  `Inputable` typeclass. Falls back to no channels when no instance is
 *  registered for the type. */
export function channelsFor(type: FenelType, registry?: DefaultRegistry): InputChannel[] {
  // `{$ref}`/`{$named}` in type position — typed-function-references Phase 7e.
  // 7g-retire-4a INVERT: an unresolvable reference falls through to the
  // name-handle arm below, which keys the `Inputable` registry lookup by the
  // code-name handle (D3) via `refHandle` (was: rewrite `{$ref}`→`{$named}` + recurse).
  if ("$refined" in type) return channelsFor(type.$refined.base, registry);
  {
    const maybe = peelMaybe(type);
    if (maybe) return channelsFor(maybe.value, registry);
  }
  if ("$opaque" in type && type.$opaque.pure) return channelsFor(type.$opaque.pure, registry);
  if (!registry) return [];
  // Atomic types — look up Inputable on the named type.
  // 7g-retire-4a INVERT: name-handle (`{$ref}` OR `{$named}`).
  {
    const handle = refHandle(type);
    if (handle !== undefined) {
      const methods = registry.resolve(handle, "Inputable", GLOBAL_ONLY);
      const channels = methods?.["channels"];
      return Array.isArray(channels) ? (channels as InputChannel[]) : [];
    }
  }
  // $tagged refs — look up Inputable on the entity type stored in the
  // phantom set (when phantom is `$refined { set: $enum [entityType] }`).
  if ("$tagged" in type) {
    const phantom = type.$tagged.phantom;
    const phView = "$refined" in phantom ? peelSetExpr(phantom.$refined.set) : null;
    if (phView && phView.kind === "SeEnum") {
      const entityType = phView.values[0];
      if (typeof entityType === "string") {
        const methods = registry.resolve(entityType, "Inputable", GLOBAL_ONLY);
        const channels = methods?.["channels"];
        return Array.isArray(channels) ? (channels as InputChannel[]) : [];
      }
    }
    return [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// defaultFilterFor — per-entity default ref-picker filter via Filterable
//
// Phase 5b.2 of field-meta-collapse — resolves the candidate-entity's
// `Filterable<X>.defaultFilter` Expression for use as the entity-ref
// picker's filter when a field doesn't carry its own `ui.refFilter`
// override. Mirror of `channelsFor` above — both are typeclass-lookup
// helpers keyed on an entity name. Sister to `builtin-classes.ts:filterableClass`.
// ---------------------------------------------------------------------------

/** Resolve the per-entity default ref-picker filter Expression via the
 *  `Filterable` typeclass instance keyed on `entityName`. Returns
 *  `undefined` when no instance is registered (callers fall through to
 *  a legacy field-meta soft-fallback during the migration window). */
export function defaultFilterFor(
  entityName: string | null | undefined,
  registry?: DefaultRegistry,
): Expression | undefined {
  if (!entityName || !registry) return undefined;
  const methods = registry.resolve(entityName, "Filterable", GLOBAL_ONLY);
  const filter = methods?.["defaultFilter"];
  return (filter as Expression | undefined) ?? undefined;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("field-meta") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_field_meta from "./field-meta";
import { registerEngineModule as __reg_field_meta } from "./engine-require";
__reg_field_meta("field-meta", __self_field_meta);
