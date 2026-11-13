// Registry-local product view for an identified field occurrence.
//
// FieldDef.label/ui are declaration-era structural slots. Phase 2b keeps them
// empty and resolves product presentation from UUID-keyed facets instead. This
// file is deliberately only a structural adapter over the Fenel-owned
// resolveFieldPresentation body exposed by field-representations.ts.

import type { ModuleRegistry } from "./registry";
import type {
  EditDisplay,
  FieldDef,
  IdentifiedFieldDef,
} from "./types";
import type {
  FieldPresentation,
  FieldPresentationOverride,
  UnresolvedFieldPresentationDiagnostic,
} from "./field-representations";

// Keep this adapter free of runtime dependencies. In particular, importing
// type-foundation here would move its Fenel module bootstrap ahead of
// engine-bodies-dispatch when product readers import this leaf, reopening the
// registry/bootstrap ESM cycle this adapter is meant to sit outside of.
const Nothing = { $tag: "Nothing" } as const;

export type IdentifiedFieldView = {
  readonly field: NamedIdentifiedFieldDef;
  readonly fieldId: string;
  readonly presentation: FieldPresentation;
  /** Structural projection of Displayable.hint / contextual display. */
  readonly display?: EditDisplay;
};

export type NamedIdentifiedFieldDef = IdentifiedFieldDef & {
  readonly key: Extract<IdentifiedFieldDef["key"], { readonly $tag: "NamedField" }>;
};

export type UnidentifiedFieldViewDiagnostic = {
  readonly $tag: "UnidentifiedFieldView";
  readonly message: string;
  readonly fieldName: string;
};

export type FieldViewDiagnostic =
  | UnidentifiedFieldViewDiagnostic
  | UnresolvedFieldPresentationDiagnostic;

export class UnidentifiedFieldViewError extends Error {
  readonly diagnostic: UnidentifiedFieldViewDiagnostic;

  constructor(diagnostic: UnidentifiedFieldViewDiagnostic) {
    super(diagnostic.message);
    this.name = "UnidentifiedFieldViewError";
    this.diagnostic = diagnostic;
  }
}

export class UnresolvedIdentifiedFieldViewError extends Error {
  readonly diagnostic: UnresolvedFieldPresentationDiagnostic;

  constructor(diagnostic: UnresolvedFieldPresentationDiagnostic) {
    super(diagnostic.message);
    this.name = "UnresolvedIdentifiedFieldViewError";
    this.diagnostic = diagnostic;
  }
}

function identifiedField(
  field: FieldDef,
): NamedIdentifiedFieldDef | UnidentifiedFieldViewDiagnostic {
  if (field.key?.$tag !== "NamedField") {
    return {
      $tag: "UnidentifiedFieldView",
      message: `identified field view: named field ${JSON.stringify(field.name)} has no NamedField UUID`,
      fieldName: field.name,
    };
  }
  return field as NamedIdentifiedFieldDef;
}

/** One authoritative wire-name projection for an identified value slot. Unlike
 * labels, a field Codeable is a non-empty machine string, never LocaleString. */
export function resolveFieldWireName(registry: ModuleRegistry, field: FieldDef): string {
  const identified = identifiedField(field);
  if ("message" in identified) throw new UnidentifiedFieldViewError(identified);
  const fieldId = identified.key.ref.$ref;
  const codeName = registry.getFieldRepresentation("Codeable", fieldId)?.methods.codeName;
  if (typeof codeName !== "string" || codeName.length === 0) throw new UnresolvedIdentifiedFieldViewError({
    $tag: "UnresolvedFieldPresentation", fieldId, message: `unresolved field wire name: no string Codeable for ${fieldId}`,
  });
  return codeName;
}

/** Canonical structural lift from the open field_ui_hint record to the full
 * host EditDisplay carrier. Missing optional methods are Maybe.Nothing; no
 * presentation choice is made here. */
function completeDisplay(value: unknown): EditDisplay {
  const display = value && typeof value === "object"
    ? value as Partial<EditDisplay>
    : {};
  return {
    widget: display.widget ?? Nothing,
    placeholder: display.placeholder ?? Nothing,
    helpText: display.helpText ?? Nothing,
    prefix: display.prefix ?? Nothing,
    suffix: display.suffix ?? Nothing,
    options: display.options ?? Nothing,
    format: display.format ?? Nothing,
    columns: display.columns ?? Nothing,
    refFilter: display.refFilter ?? Nothing,
  };
}

/**
 * Resolve the one product-facing field view in an explicit registry/account
 * context. No declaration label/UI is read and the input graph is not mutated.
 */
export function tryResolveIdentifiedFieldView(
  registry: ModuleRegistry,
  field: FieldDef,
  override?: FieldPresentationOverride,
):
  | { ok: true; value: IdentifiedFieldView }
  | { ok: false; error: FieldViewDiagnostic } {
  const identified = identifiedField(field);
  if ("message" in identified) return { ok: false, error: identified };
  const fieldId = identified.key.ref.$ref;
  let presentation: FieldPresentation;
  try {
    presentation = registry.resolveFieldPresentation(fieldId, override);
  } catch (error) {
    const diagnostic = (error as { diagnostic?: UnresolvedFieldPresentationDiagnostic })?.diagnostic;
    if (diagnostic?.$tag === "UnresolvedFieldPresentation") {
      return { ok: false, error: diagnostic };
    }
    throw error;
  }
  return {
    ok: true,
    value: {
      field: identified,
      fieldId,
      presentation,
      ...(presentation.display === undefined
        ? {}
        : { display: completeDisplay(presentation.display) }),
    },
  };
}

export function resolveIdentifiedFieldView(
  registry: ModuleRegistry,
  field: FieldDef,
  override?: FieldPresentationOverride,
): IdentifiedFieldView {
  const result = tryResolveIdentifiedFieldView(registry, field, override);
  if (!result.ok) {
    if (result.error.$tag === "UnresolvedFieldPresentation") {
      throw new UnresolvedIdentifiedFieldViewError(result.error);
    }
    throw new UnidentifiedFieldViewError(result.error);
  }
  return result.value;
}
