// ---------------------------------------------------------------------------
// widget-hint.ts — Type → UI widget mapping
//
// Given a FenelType (+ metadata for form-only data like file constraints),
// determine the best UI widget. More precise types → more specific widgets.
// This is the "types ARE the UI" principle: refinement types are UX specs.
// ---------------------------------------------------------------------------

import type {
  FenelType,
  SetExpr,
  FieldDef,
  MeasureExpr,
  EditDisplay,
} from "./types";
import { formatMeasure } from "./units";
import { fieldType, fieldMeta, phantomEntityName, phantomUnitOf, phantomGeoLevelOf, type FieldMetadata } from "./field-meta";
import { draftStringFromTaggedLevel } from "./places";
import { peelMaybe, peelList } from "./set-algebra";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { refHandle } from "./type-foundation";
import { peelSetExpr } from "./set-marker";
// ---------------------------------------------------------------------------
// WidgetHint type
// ---------------------------------------------------------------------------

export type WidgetHint = {
  /** Primary widget type */
  widget: string;
  /** Why this widget was chosen */
  reason: string;
  /** Configuration derived from type constraints */
  config?: Record<string, unknown>;
  /** Alternative widgets that could also work */
  alternatives?: string[];
};

// ---------------------------------------------------------------------------
// SetExpr helpers (unchanged — operate on the universal constraint algebra)
// ---------------------------------------------------------------------------

// set-algebra-to-fenel Phase 3b-3b/3b-3d — the pure-structural SetExpr readers +
// the 3 per-base-type PICKERS are now `.fenel` bodies
// (`fenel/modules/engine/widget-hint.fenel`, registered as `engine:impliesInteger`
// / `:extractInterval` / `:extractEnum` / `:hasNamed` (3b-3b sub-readers) +
// `engine:numberWidgetFor` / `:stringWidgetFor` / `:dateWidgetFor` (3b-3d pickers)).
// The bodies read the registered `$tag` `Se*` ADT directly (dual-reading the legacy
// `$`-key form as transition tolerance). The pickers CALL the sub-readers in Fenel
// (no TS hop), so the 3b-3b TS wrappers for `impliesInteger`/`extractInterval`/
// `hasNamed` are RETIRED (net-negative TS); only `extractEnum` survives — still
// used by `widgetForType`'s list multi-select detection below.
//
// The picker wrappers keep the `!set` unconstrained guard TS-side (a `.fenel` body
// can't take `undefined`; Step-0 §B) and dispatch the Fenel body for a concrete
// `set`. `widgetForType` + the phantom-unit lift stay TS (the FenelType `$`-walk —
// the legitimate `$`-barrier residual).

type MaybeResult<T> = { $tag: "Just"; _0: T } | { $tag: "Nothing" };

function extractEnum(set: SetExpr): unknown[] | null {
  const r = dispatchEngineBody("engine:extractEnum", [set]) as MaybeResult<unknown[]>;
  return r.$tag === "Just" ? r._0 : null;
}

// ---------------------------------------------------------------------------
// Per-base-type widget pickers — thin dispatch seams over the `.fenel` bodies.
// The `!set` unconstrained case stays TS (Step-0 §B); the Fenel bodies are total
// over a concrete `set`.
// ---------------------------------------------------------------------------

function numberWidgetFor(set: SetExpr | undefined, _meta: FieldMetadata): WidgetHint {
  if (!set) return { widget: "number-input", reason: "unconstrained number" };
  return dispatchEngineBody("engine:numberWidgetFor", [set]) as WidgetHint;
}

function stringWidgetFor(set: SetExpr | undefined, _meta: FieldMetadata): WidgetHint {
  if (!set) return { widget: "text-input", reason: "unconstrained string" };
  return dispatchEngineBody("engine:stringWidgetFor", [set]) as WidgetHint;
}

function dateWidgetFor(set: SetExpr | undefined, _meta: FieldMetadata): WidgetHint {
  if (!set) return { widget: "date-picker", reason: "date type", config: {} };
  return dispatchEngineBody("engine:dateWidgetFor", [set]) as WidgetHint;
}

// ---------------------------------------------------------------------------
// Internal: split a FenelType into (base, set, …) for the simple atomic case
// ---------------------------------------------------------------------------

type AtomShape = { base: FenelType; set?: SetExpr };

function peelAtom(t: FenelType): AtomShape {
  if ("$refined" in t) return { base: t.$refined.base, set: t.$refined.set };
  if ("$opaque" in t && t.$opaque.pure) return peelAtom(t.$opaque.pure);
  return { base: t };
}

// ---------------------------------------------------------------------------
// Public — FenelType-native API
// ---------------------------------------------------------------------------

/** Determine best UI widget from a FenelType (+ optional metadata). */
export function widgetForType(type: FenelType, meta: FieldMetadata = {}): WidgetHint {
  // `{$ref}`/`{$named}` in type position — typed-function-references Phase 7e.
  // 7g-retire-4a INVERT: a bare reference falls through to the atom/peelAtom
  // path below, whose name-handle switch (`refHandle(base)`, the 2b fold) yields
  // the same hint for `{$ref}` and `{$named}` (was: rewrite `{$ref}`→`{$named}` +
  // re-run). The `named type <name>` text fallback handles unknown handles.

  // Maybe falls through to the text-input fallback. Callers that want the
  // inner widget should peel Maybe themselves. (Recognizes both `$maybe`
  // shorthand and canonical `$variant { Nothing | Just }`.)
  if (peelMaybe(type)) return { widget: "text-input", reason: "fallback" };

  // A typed measure preserves its base scalar's editor and adds source-owned
  // unit presentation. Place and typed entity references keep their own paths.
  if ("$tagged" in type) {
    const taggedValue = (type as { $tagged: { value: FenelType } }).$tagged.value;
    // 7g-retire-2 fold: the phantom inner-value handle may be `{$named}` or `{$ref}`.
    const innerNamed = refHandle(taggedValue);
    if (innerNamed === "GeoPath") {
      // Phase 4 of field-meta-collapse — Place : GeoLevel -> Type.
      // The depth-as-type fact lives in the phantom; surface it as
      // the picker's level config so the renderer knows how deep
      // the user can drill.
      const level = phantomGeoLevelOf(type);
      return {
        widget: "place-picker",
        reason: "place type — geo-located value at a precision level",
        config: level
          ? { level: draftStringFromTaggedLevel(level) }
          : {},
      };
    }
    if (phantomUnitOf(type) === null && innerNamed !== "Number" && innerNamed !== "Rational") {
      const entityType = phantomEntityName(type);
      return {
        widget: "entity-picker",
        reason: "reference type",
        config: entityType ? { entityType } : {},
      };
    }
    // Typed unit scalars continue through their underlying scalar below.
  }

  // Refinements and tagged-unit metadata preserve the underlying scalar type.
  let { base, set } = peelAtom(type);
  let unitFromPhantom: MeasureExpr | null = null;
  if ("$tagged" in base) {
    const taggedValue = (base as { $tagged: { value: FenelType } }).$tagged.value;
    unitFromPhantom = phantomUnitOf(base);
    if (unitFromPhantom !== null) {
      base = taggedValue;
    }
  }

  // 7g-retire-2b fold: the atom handle may be `{$named}` or its `{$ref}` twin.
  const baseName = refHandle(base);
  if (baseName !== undefined) {
    switch (baseName) {
      case "String": {
        return stringWidgetFor(set, meta);
      }
      case "Number":
      case "Nat":
      case "Int":
      case "Rational": {
        const hint = numberWidgetFor(set, meta);
        // A MeasureExpr phantom carries the complete typed unit expression.
        if (unitFromPhantom !== null) {
          hint.config = {
            ...(hint.config ?? {}),
            unit: unitFromPhantom,
            unitLabel: formatMeasure(unitFromPhantom),
          };
        }
        return hint;
      }
      case "Boolean":
        return { widget: "toggle", reason: "boolean type", alternatives: ["checkbox"] };
      case "Date":
        return dateWidgetFor(set, meta);
      case "File":
        // accept / maxSize / maxCount constraints encode as $where SetExpr
        // on the wrapping $refined. The picker reads them from the type
        // when it resolves the widget at render-time.
        return { widget: "file-upload", reason: "file type", config: {} };
      case "Markup":
        return { widget: "markup-editor", reason: "markup type" };
    }
    // Unknown $named — text fallback.
    return { widget: "text-input", reason: `named type ${baseName}` };
  }

  {
    const list = peelList(type);
    if (list) {
      // Phase 5c of field-meta-collapse — `$list ($refined String $enum [...])`
      // is the substrate encoding of the retired `meta.multiple` flag.
      // Disambiguate against generic list-of-record-or-other by peeling
      // the element to its atomic base + set: a String inner with an
      // $enum set surfaces as `multi-select`; a String inner without an
      // enum surfaces as `tag-input`; everything else falls through to
      // the generic repeater.
      const inner = peelAtom(list.elem);
      if (refHandle(inner.base) === "String") {
        if (inner.set) {
          const enumVals = extractEnum(inner.set);
          if (enumVals) {
            return {
              widget: "multi-select",
              reason: "list of strings from enum",
              config: { options: enumVals },
            };
          }
        }
        return { widget: "tag-input", reason: "list of strings" };
      }
      return {
        widget: "repeater",
        reason: "list type",
        config: {},
        alternatives: ["table"],
      };
    }
  }

  if ("$record" in type) {
    return { widget: "fieldset", reason: "record type", alternatives: ["card", "inline-fields"] };
  }

  if ("$variant" in type) {
    const discriminator = type.$variant.discriminator;
    return {
      widget: "discriminated-union",
      reason: "union type — discriminator + variant fields",
      config: discriminator ? { discriminator } : {},
    };
  }

  if ("$map" in type) {
    // Disambiguate via the keys SetExpr: a finite $enum keys → matrix
    // (fixed-row × typed-column). Anything else (locale-string-like) →
    // locale-text-input.
    const keysSet = type.$map.keys;
    const isMatrix = peelSetExpr(keysSet)?.kind === "SeEnum";
    if (isMatrix) {
      return { widget: "matrix-editor", reason: "fixed-row × typed-column matrix", alternatives: ["table-editor"] };
    }
    return { widget: "locale-text-input", reason: "translatable string" };
  }

  if ("$var" in type) {
    return {
      widget: "polymorphic-input",
      reason: `polymorphic placeholder — type variable "${type.$var}"`,
      config: { typeVar: type.$var },
      alternatives: ["text-input"],
    };
  }

  return { widget: "text-input", reason: "fallback" };
}

// ---------------------------------------------------------------------------
// FieldDef wrapper — derives FenelType + meta and applies UI overrides.
// ---------------------------------------------------------------------------

/** Determine widget from a full FieldDef and an already-resolved presentation
 * display. Callers obtain `ui` from resolveIdentifiedFieldView; this leaf never
 * reads the retired declaration-level FieldDef.ui slot. */
export function widgetForField(field: FieldDef, ui?: Partial<EditDisplay>): WidgetHint {
  const hint = widgetForType(fieldType(field), fieldMeta(field));

  // If field has explicit UI hint, prefer it.
  if (ui?.widget?.$tag === "Just") {
    return {
      widget: ui.widget._0,
      reason: "explicit UI hint overrides type-derived widget",
      config: hint.config,
      alternatives: [hint.widget, ...(hint.alternatives ?? [])],
    };
  }

  return hint;
}
