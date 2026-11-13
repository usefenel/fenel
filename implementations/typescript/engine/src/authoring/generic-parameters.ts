import { dispatchEngineBody, marshalStoredBodyForValidation, marshalTraversalType } from "../engine-bodies-dispatch";
import { Just, Nothing } from "../type-foundation";
import type { Constraint, FenelType, Kind, SchemeVar, TypeConstructorParam, TypeExpr, TypeScheme } from "../types";
import type { ExprNode } from "./expression-authoring";
import { assertAcyclicAuthoringData } from "./json-value";

export type AuthoringGenericParameter = string | TypeConstructorParam;
export type AuthoringGenericEdit =
  | { readonly kind: "add"; readonly variable: SchemeVar }
  | { readonly kind: "rename"; readonly id: string; readonly sourceName: string }
  | { readonly kind: "set-kind"; readonly id: string; readonly type: FenelType }
  | { readonly kind: "remove"; readonly id: string };
export type AuthoringGenericEditResult =
  | { readonly ok: true; readonly scheme: TypeScheme; readonly params?: readonly AuthoringGenericParameter[] }
  | { readonly ok: false; readonly message: string };

export type AuthoringGenericDeclarationDraft = {
  readonly scheme: TypeScheme;
  /** Existing type-family parameters, not a function's value parameters. */
  readonly params?: readonly AuthoringGenericParameter[];
  readonly body?: ExprNode;
  readonly requires?: readonly Constraint[];
};
export type AuthoringGenericDeclarationEditResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

type GenericEditPlan = {
  readonly ok: boolean;
  readonly message: string;
  readonly action: "add" | "rename" | "remove" | "set-kind";
  readonly index: number;
  readonly paths: readonly (readonly string[])[];
};

type GenericRoot = { path: readonly string[]; scope: readonly string[]; type: unknown };
type GenericScanPlan = {
  ok: boolean;
  message: string;
  annotations: Array<{ path: readonly string[]; scope: readonly string[] }>;
};

type KindTypeMarker = { form: "type" } | { form: "arrow"; input: KindTypeMarker; output: KindTypeMarker };
function decodeKindType(marker: KindTypeMarker): FenelType {
  if (marker.form === "type") return { $type: true };
  return { $arrow: {
    params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: decodeKindType(marker.input), label: Nothing, ui: Nothing, meta: {} }],
    returns: decodeKindType(marker.output),
  } };
}

/** B3: render a source-owned Kind projection using the ordinary TypeBuilder. */
export function authoringKindType(kind: Kind): { ok: true; type: FenelType } | { ok: false; message: string } {
  try {
    assertAcyclicAuthoringData(kind);
    // GLOBAL_ONLY: deterministic Kind metadata projection, no lookup/perform.
    const plan = dispatchEngineBody("engine:authoringGenericKindTypePlan", [kind]) as {
      ok: boolean; message: string; marker: KindTypeMarker;
    };
    return plan.ok ? { ok: true, type: decodeKindType(plan.marker) } : { ok: false, message: plan.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid generic kind transport" };
  }
}

function readOriginal(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (value === null || typeof value !== "object") throw new TypeError("Invalid generic annotation path");
    const slot = Object.getOwnPropertyDescriptor(value, key);
    if (!slot || !("value" in slot)) throw new TypeError("Invalid generic annotation slot");
    value = slot.value;
  }
  return value;
}

function optionalDeclarationSlot(value: object, key: string): unknown {
  const slot = Object.getOwnPropertyDescriptor(value, key);
  if (slot && !("value" in slot)) throw new TypeError("Accessor-bearing generic declaration slot");
  return slot?.value;
}

/** B3: reattach a source-selected leaf path to the original graph. Untouched
 * containers/sidecars and explicit undefined properties are never serialized. */
function patchOriginal(value: unknown, path: readonly string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  if (value === null || typeof value !== "object") throw new TypeError("Invalid generic edit patch path");
  const [key, ...rest] = path;
  const slot = Object.getOwnPropertyDescriptor(value, key!);
  if (!slot || !("value" in slot)) throw new TypeError("Invalid generic edit patch slot");
  const next = patchOriginal(slot.value, rest, replacement);
  if (Object.is(next, slot.value)) return value;
  if (Array.isArray(value)) {
    const copy = value.slice();
    Object.defineProperty(copy, key!, { ...slot, value: next });
    return copy;
  }
  return Object.defineProperties(Object.create(Object.getPrototypeOf(value)), {
    ...Object.getOwnPropertyDescriptors(value),
    [key!]: { ...slot, value: next },
  });
}

/** B3: TypeExpr permits bare reference strings at the constraint seam. */
function constraintType(type: TypeExpr): FenelType {
  if (typeof type === "string") return { $ref: type };
  if ("$el" in type) return {
    $el: { call: [type.$el.call[0], ...type.$el.call.slice(1).map(constraintType)] },
  };
  return type;
}

/** Edit an explicit declaration, never infer its binders. Entropy belongs to
 * the caller: an add carries the SchemeVar id, spelling and Kind. Families
 * supply their existing parameter vector; ordinary polymorphic functions omit
 * it. All validation, occurrence selection and capture policy is Fenel-owned. */
export function editAuthoringGenericParameters(
  scheme: TypeScheme,
  edit: AuthoringGenericEdit,
  params?: readonly AuthoringGenericParameter[],
): AuthoringGenericEditResult {
  const edited = editAuthoringGenericDeclaration({ scheme, ...(params === undefined ? {} : { params }) }, edit);
  return edited.ok ? { ok: true, ...edited.value } : edited;
}

/** One transaction over the declaration's scheme, executable annotation sites
 * and required class arguments. Source selects every type root and rename
 * patch before the original graph is changed. Unsupported contexts refuse the
 * whole edit; body holes and every unrelated declaration property survive. */
export function editAuthoringGenericDeclaration<T extends AuthoringGenericDeclarationDraft>(
  declaration: T,
  edit: AuthoringGenericEdit,
): AuthoringGenericDeclarationEditResult<T> {
  try {
    assertAcyclicAuthoringData({ declaration, edit });
    const scheme = readOriginal(declaration, ["scheme"]) as TypeScheme;
    const params = optionalDeclarationSlot(declaration, "params") as readonly AuthoringGenericParameter[] | undefined;
    const body = optionalDeclarationSlot(declaration, "body") as ExprNode | undefined;
    const requires = optionalDeclarationSlot(declaration, "requires") as readonly Constraint[] | undefined;
    let editedKind: Kind = { $tag: "KType" };
    if (edit.kind === "set-kind") {
      // GLOBAL_ONLY: source validates an ordinary type as a kind; no lookup/perform.
      const converted = dispatchEngineBody("engine:authoringGenericKindFromTypePlan", [marshalTraversalType(edit.type)]) as {
        ok: boolean; message: string; kind: Kind;
      };
      if (!converted.ok) return { ok: false, message: converted.message };
      editedKind = converted.kind;
    }
    const roots: GenericRoot[] = [{
      path: ["scheme", "body"], scope: [], type: marshalTraversalType(scheme.body),
    }];
    params?.forEach((parameter, parameterIndex) => {
      if (typeof parameter === "string") return;
      parameter.constraints.forEach((constraint, constraintIndex) => {
        constraint.args.forEach((argument, argIndex) => roots.push({
          path: ["params", String(parameterIndex), "constraints", String(constraintIndex), "args", String(argIndex)],
          scope: [], type: marshalTraversalType(constraintType(argument)),
        }));
      });
    });
    requires?.forEach((constraint, constraintIndex) => {
      constraint.args.forEach((argument, argIndex) => roots.push({
        path: ["requires", String(constraintIndex), "args", String(argIndex)],
        scope: [], type: marshalTraversalType(constraintType(argument)),
      }));
    });
    if (body !== undefined) {
      // GLOBAL_ONLY: the existing source ExprNode walker selects annotation
      // slots without resolving/evaluating any term or changing term binders.
      const bodyTypes = dispatchEngineBody("engine:authoringBindingTypeRoots", [
        marshalStoredBodyForValidation(body), ["body"],
      ]) as {
        roots: Array<{ path: readonly (string | number)[]; scope: readonly string[] }>;
        diagnostics: Array<{ message: string }>;
      };
      if (bodyTypes.diagnostics.length > 0) return { ok: false, message: bodyTypes.diagnostics.map((diagnostic) => diagnostic.message).join("\n") };
      for (const annotation of bodyTypes.roots) {
        const path = annotation.path.map(String);
        roots.push({ path, scope: annotation.scope, type: marshalTraversalType(readOriginal(declaration, path)) });
      }
    }
    let original = declaration;
    const applications = (scheme.applications ?? []).map((application) => ({
      path: application.path,
      headVarId: application.headVarId ?? "",
      headRef: application.headRef ?? "",
      kind: application.kind,
      args: application.args.map(marshalTraversalType),
    }));
    while (true) {
      // GLOBAL_ONLY: source-selected type annotation paths in supplied data;
      // no reader lookup or host perform. The host only marshals those paths.
      const scan = dispatchEngineBody("engine:authoringGenericScanPlan", [roots, scheme.quantified, applications]) as GenericScanPlan;
      if (!scan.ok) return { ok: false, message: scan.message };
      if (scan.annotations.length === 0) break;
      for (const annotation of scan.annotations) roots.push({
        ...annotation, type: marshalTraversalType(readOriginal(original, annotation.path)),
      });
    }
    // GLOBAL_ONLY: deterministic explicit-binder metadata edits over supplied
    // data; no reader resolution or host perform occurs in this source policy.
    const plan = dispatchEngineBody("engine:authoringGenericEditPlan", [
      roots,
      scheme.quantified,
      applications,
      params === undefined ? Nothing : Just(params.map((parameter) =>
        typeof parameter === "string" ? parameter : parameter.name)),
      edit.kind === "add"
        ? { action: edit.kind, ...edit.variable }
        : { action: edit.kind, id: edit.id, sourceName: edit.kind === "rename" ? edit.sourceName : "", kind: editedKind },
    ]) as GenericEditPlan;
    if (!plan.ok) return { ok: false, message: plan.message };
    if (plan.action === "rename" && edit.kind === "rename") {
      for (const path of plan.paths) original = patchOriginal(original, path, edit.sourceName) as typeof original;
      original = patchOriginal(original, ["scheme", "quantified", String(plan.index), "sourceName"], edit.sourceName) as typeof original;
      if (params !== undefined) {
        const parameter = original.params![plan.index]!;
        original = patchOriginal(original, typeof parameter === "string"
          ? ["params", String(plan.index)] : ["params", String(plan.index), "name"], edit.sourceName) as typeof original;
      }
    } else if (plan.action === "add" && edit.kind === "add") {
      original = patchOriginal(original, ["scheme", "quantified"], [...original.scheme.quantified, edit.variable]) as typeof original;
      if (params !== undefined) original = patchOriginal(original, ["params"], [
        ...original.params!, { name: edit.variable.sourceName, constraints: [] },
      ]) as typeof original;
    } else if (plan.action === "set-kind" && edit.kind === "set-kind") {
      original = patchOriginal(original, ["scheme", "quantified", String(plan.index), "kind"], editedKind) as typeof original;
    } else if (plan.action === "remove" && edit.kind === "remove") {
      original = patchOriginal(original, ["scheme", "quantified"], original.scheme.quantified.filter((_, index) => index !== plan.index)) as typeof original;
      if (params !== undefined) original = patchOriginal(original, ["params"], original.params!.filter((_, index) => index !== plan.index)) as typeof original;
    } else throw new TypeError("Invalid generic edit plan action");
    return { ok: true, value: original };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid generic declaration transport" };
  }
}
