import { strict as assert } from "node:assert";

/**
 * Existing Solid/browser tooling exception. Keep the private main field
 * controls and their recursive universal renderer as production source.
 * The caller supplies captured metadata through representation-boundary;
 * unrelated controls fail explicitly if this focused fixture reaches them.
 */
export function buildRepresentationFieldControls(fieldSource, variantModuleId = "fixture:representation-controls") {
  assert.equal(typeof fieldSource, "string", "Production FieldRenderer source is required");
  assert.equal(typeof variantModuleId, "string", "Production variant virtual module id is required");
  const extract = (start, end) => {
    const from = fieldSource.indexOf(start);
    const until = fieldSource.indexOf(end, from);
    assert.ok(from >= 0 && until > from, `Production field component boundary moved: ${start}`);
    return fieldSource.slice(from, until);
  };
  return `
    import { Show, For, createSignal, createMemo, createContext, createUniqueId, useContext, type Accessor, type Component } from "solid-js";
    import { Dynamic, type JSX } from "@solidjs/web";
    import type { FenelType, FieldDef, EditDisplay, InputChannel, TextChannel, LocaleString, SetExpr } from "@fenel/engine/types";
    import type { Pattern } from "@fenel/engine";
    import type { FieldEditPlan, FieldEditorPlan, FieldVariantCasePlan } from "@fenel/engine/authoring/field-render";
    import type { ModuleRegistry } from "@fenel/engine/registry";
    import { FieldPresentationRegistryProvider, useFieldPresentationRegistry } from "./field-renderer/field-presentation-context";
    import { RecordValuesContext } from "./field-renderer/record-values-context";
    import { useParams } from "./field-renderer/params-context";
    import { LocusSelect } from "./locus-select";
    import { NumberInput } from "./number-input";
    import { numericTextCodec } from "./numeric-text-codec";
    import { IconMail, IconPhone, IconLink, IconUser, IconCircleCheck, IconCircleX, IconBolt, IconByName } from "./icons";
    import { VariantValueEditor, RawValueEditor } from ${JSON.stringify(variantModuleId)};
    import { useReaderRuntime, useAuthoringSession, DETACHED_AUTHORING_SESSION, fieldEditPlan,
      fieldTypeLabelPlan, fieldRecordSlotPlan, fieldRecordEditPlan, nativeValueTypeName,
      isNativeValueRepresentation, refHandle, channelsFor, dispatchRegistry, GLOBAL_ONLY,
      instanceVisible, parseInput, peelSetExpr, getNamedPattern, unreachable } from "fixture:representation-boundary";
    const resolveElInType = unreachable, resolveIdentifiedFieldView = unreachable,
      LocaleStringEditor = unreachable, AddressAutocomplete = unreachable, TermsEditor = unreachable,
      ExpressionEditor = unreachable, MarkupExprEditor = unreachable, StringExprEditor = unreachable,
      TypeBuilder = unreachable, SelectEditor = unreachable, DateEditor = unreachable,
      FileEditor = unreachable, RefEditor = unreachable, ListEditor = unreachable,
      FunctionPicker = unreachable, MatrixEditor = unreachable, MarkupEditor = unreachable,
      FreeformRecordEditor = unreachable, ensureMarkupValue = unreachable,
      MaskedTextInput = unreachable, SegmentedInput = unreachable, patternMatch = unreachable;
    ${extract("export type FieldRendererProps =", "const CallableRegistryContext =")}
    ${extract("const CallableRegistryContext =", "import { FieldPresentationRegistryProvider,")}
    ${extract("export const ExprFieldContext =", "function targetSubsetFromSet(")}
    ${extract("function targetSubsetFromSet(", "function fieldForType(")}
    ${extract("function FormatIcon(", "// Per-segment helpers")}
    ${extract("function StringEditor(", "function DateEditor(")}
    ${extract("function BooleanEditor(", "type FunctionPickerSelection =")}
    ${extract("function RecordEditor(", "function FreeformRecordEditor(")}
    ${extract("function UnionEditor(", "function MatrixEditor(")}
    export { RecordEditor as MainRecordEditor, UnionEditor as MainUnionEditor };
  `;
}

export default buildRepresentationFieldControls;
