// Native/structural representation switching of the variant value editor
// (B4 wave 1 lane B). Moved verbatim out of `NativeRepresentationEditor` so the
// page (Account and public readers) and a Local reader's worker run the same
// code: the selected `Reprable JsRuntime` row lifts/lowers/inspects, and the
// existing `validateValue` admits the edited representation and its owner. No
// language fact is decided here (ledgered kind: Central reader worker
// transport, `design/ts-exceptions/2026-10-20.md`).
import type { FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { isNativeValueRepresentation, pureValueType, defaultValueForAuthoring as defaultValueFor } from "@fenel/engine/authoring/type";
import { invokeRuntimeRepresentationMethod, resolveRuntimeRepresentationMethod, runtimeRepresentationInspect,
  runtimeRepresentationNativeType, type EvaluateContext } from "@fenel/engine/expressions";
import { validateValue } from "@fenel/engine/validation";
import { frameAccount } from "@fenel/engine/authority";

export type NativeRepresentationMode = "representation" | "structural";

/** The reader frame a switch runs in. `nativeContext` is the representation
 * owner's lexical frame (`runtimeRepresentationNativeContext`). */
export type NativeRepresentationFrame = {
  evaluateContext: EvaluateContext;
  registry: ModuleRegistry;
  resolveNamedType: (name: string) => FenelType | undefined;
  nativeContext: () => EvaluateContext;
};

/** The existing user copy; a Local refusal shows exactly the page's text. */
export const NATIVE_REPRESENTATION_UNAVAILABLE = "This representation is unavailable for this data.";
export const NATIVE_REPRESENTATION_EDIT_REFUSED = "This representation cannot accept the edited data.";
export const NATIVE_REPRESENTATION_CREATE_REFUSED = "This representation cannot create data for this type.";
/** A Local edit made on a view that no longer shows the current data. */
export const NATIVE_REPRESENTATION_CHANGED = "This data changed while its representation was preparing.";
/** A Local reader with no worker coming (the record operations' copy). */
export const NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE = "This reader's editing tools are not ready.";

/** The type and value a non-native mode edits. Throws when unavailable. */
export function projectNativeRepresentation(mode: NativeRepresentationMode, typeName: string, ownerType: FenelType,
  value: unknown, frame: NativeRepresentationFrame): { type: FenelType; value: unknown } {
  const context = frame.evaluateContext;
  if (mode === "representation") {
    const type = runtimeRepresentationNativeType(context, typeName);
    const lift = resolveRuntimeRepresentationMethod(context, typeName, "lift");
    if (!type || lift === undefined) throw new Error("Representation unavailable");
    return { type, value: value == null ? value : invokeRuntimeRepresentationMethod(lift, [value], context) };
  }
  const type = pureValueType(ownerType, frame.resolveNamedType);
  if (!type) throw new Error("Constructors unavailable");
  let projected = value;
  if (projected != null && isNativeValueRepresentation(typeName, projected)) {
    if (resolveRuntimeRepresentationMethod(context, typeName, "lower") === undefined) throw new Error("Constructors unavailable");
    projected = runtimeRepresentationInspect(projected, context, typeName);
    if (isNativeValueRepresentation(typeName, projected)) throw new Error("A constructor layer is unavailable");
  }
  return { type, value: projected };
}

/** The owner value an edit of the projected data publishes. Throws when the
 * edited representation or the owner refuses it. */
export function editNativeRepresentation(mode: NativeRepresentationMode, typeName: string, ownerType: FenelType,
  edited: unknown, frame: NativeRepresentationFrame): unknown {
  const context = frame.evaluateContext;
  const options = { registry: frame.registry, functions: context, coerce: false, strict: { primitiveTypes: true, membership: true } };
  const account = frameAccount(context);
  let changed = edited;
  if (mode === "representation") {
    const nativeType = resolveRuntimeRepresentationMethod(context, typeName, "native") as FenelType | undefined;
    const nativeContext = frame.nativeContext();
    if (!nativeType || !validateValue(nativeType, edited, account, { ...options, functions: nativeContext }).valid) throw new Error("Native representation admission refused");
    const lower = resolveRuntimeRepresentationMethod(context, typeName, "lower");
    if (lower === undefined) throw new Error("Representation unavailable");
    changed = invokeRuntimeRepresentationMethod(lower, [edited], context);
  }
  if (!validateValue(ownerType, changed, account, options).valid) throw new Error("Owner admission refused");
  return changed;
}

/** The admitted default a "Create data" gesture publishes. Throws on refusal. */
export function createNativeRepresentation(mode: NativeRepresentationMode, typeName: string, ownerType: FenelType,
  frame: NativeRepresentationFrame): unknown {
  const seed = defaultValueFor(ownerType);
  const context = frame.evaluateContext;
  const projected = mode === "structural" ? runtimeRepresentationInspect(seed, context, typeName) : seed;
  if (mode === "structural" && isNativeValueRepresentation(typeName, projected)) throw new Error("A constructor layer is unavailable");
  if (!validateValue(ownerType, projected, frameAccount(context), { registry: frame.registry, functions: context, coerce: false, strict: { primitiveTypes: true, membership: true } }).valid) throw new Error("Default admission refused");
  return projected;
}
