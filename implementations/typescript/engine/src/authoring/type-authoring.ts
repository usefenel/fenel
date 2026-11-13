import type { Constraint, Expression, FenelType, FieldDef, TypeExpr } from "../types";
import { List, Maybe, Nothing, Result, refHandle } from "../type-foundation";
import { engineRequire } from "../engine-require";

export type TypeKind =
  | "void" | "unit" | "named" | "var" | "type"
  | "record" | "variant" | "tuple" | "map"
  | "list" | "maybe" | "result"
  | "union" | "intersect" | "complement"
  | "el-call" | "refined" | "mu"
  | "tagged" | "opaque" | "arrow"
  | "el";

export const TYPE_KIND_LABELS: Record<TypeKind, string> = {
  void: "Void",
  unit: "Unit",
  named: "Named",
  var: "Type Var",
  type: "Type",
  record: "Record",
  variant: "Variant",
  tuple: "Tuple",
  map: "Map",
  list: "List",
  maybe: "Maybe",
  result: "Result",
  union: "Union",
  intersect: "Intersection",
  complement: "Complement",
  "el-call": "Generic App",
  refined: "Refined",
  mu: "Recursive",
  tagged: "Tagged",
  opaque: "Nominal/Opaque",
  arrow: "Function",
  el: "Dependent",
};

export const TYPE_KIND_GROUPS: { label: string; kinds: TypeKind[] }[] = [
  { label: "atoms", kinds: ["named", "var", "type", "unit", "void"] },
  { label: "structures", kinds: ["record", "variant", "tuple", "map"] },
  { label: "containers", kinds: ["list", "maybe", "result"] },
  { label: "functions", kinds: ["arrow"] },
  { label: "lattice", kinds: ["union", "intersect", "complement", "refined"] },
  { label: "dependent", kinds: ["el", "el-call", "mu", "tagged", "opaque"] },
];

export const PICKABLE_TYPE_KINDS: ReadonlySet<TypeKind> = new Set(
  TYPE_KIND_GROUPS.flatMap((g) => g.kinds),
);

/** B3 positional authoring carrier: no named identity or entropy is needed. */
export function newPositionalTypeField(index: number): FieldDef {
  return { name: `_${index}`, key: { $tag: "PositionalField", index }, type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} };
}

/** B3 list projection after insertion/removal/reordering. Names are wire
 * projections and remain stable; a positional key always follows its ordinal. */
export function reindexPositionalTypeFields(fields: FieldDef[]): FieldDef[] {
  return fields.map((field, index) => field.key?.$tag === "PositionalField"
    ? { ...field, key: { $tag: "PositionalField", index } } : field);
}

/** B3 occurrence projection for authoring facet retention. Unlike a record
 * schema projection, this includes fields in variants, arrows and wrappers. */
export function typeFieldOccurrences(type: FenelType): FieldDef[] {
  const fields: FieldDef[] = [];
  const visit = (node: FenelType): void => {
    if ("$record" in node) { for (const field of node.$record.fields) { fields.push(field); visit(field.type); } }
    else if ("$variant" in node) { for (const entry of node.$variant.cases) for (const field of entry.fields ?? []) { fields.push(field); visit(field.type); } }
    else if ("$arrow" in node) { for (const field of node.$arrow.params) { fields.push(field); visit(field.type); } visit(node.$arrow.returns); }
    else if ("$tuple" in node) node.$tuple.forEach(visit);
    else if ("$union" in node) node.$union.forEach(visit);
    else if ("$intersect" in node) node.$intersect.forEach(visit);
    else if ("$complement" in node) visit(node.$complement);
    else if ("$refined" in node) visit(node.$refined.base);
    else if ("$opaque" in node && node.$opaque.pure) visit(node.$opaque.pure);
    else if ("$mu" in node) visit(node.$mu.body);
    else if ("$map" in node) visit(node.$map.values);
    else if ("$tagged" in node) { visit(node.$tagged.value); visit(node.$tagged.phantom); }
  };
  visit(type);
  return fields;
}

export const PARAMETERIZED_BY_NAME: Record<string, () => FenelType> = {
  List: () => List({ $ref: "String" }),
  Maybe: () => Maybe({ $ref: "String" }),
  Result: () => Result({ $ref: "String" }, { $ref: "String" }),
  Tuple: () => ({ $tuple: [{ $ref: "String" }] }),
  Map: () => ({ $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } } }),
};

/** Authoring projections deliberately accept identity-incomplete drafts. They
 * select an editor, never prove membership/equality or create field identities.
 * In particular, asking whether an arbitrary record is a Maybe must not run
 * that record through a semantic-slot validator before its fields can be edited.
 */
export function peelMaybeForAuthoring(type: FenelType): { value: FenelType } | null {
  if ("$refined" in type) return peelMaybeForAuthoring(type.$refined.base);
  if (!("$variant" in type) || type.$variant.cases.length !== 2) return null;
  const nothing = type.$variant.cases.find((entry) => entry.name === "Nothing");
  const just = type.$variant.cases.find((entry) => entry.name === "Just");
  if (!nothing || (nothing.fields?.length ?? 0) !== 0 || just?.fields?.length !== 1) return null;
  const field = just.fields[0]!;
  if (field.key?.$tag === "PositionalField" ? field.key.index === 0 : !field.key && field.name === "_0") return { value: field.type };
  return null;
}

export function peelListForAuthoring(type: FenelType): { elem: FenelType } | null {
  const { dispatchedPeelListForAuthoring } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
  return dispatchedPeelListForAuthoring(type);
}

export function peelResultForAuthoring(t: FenelType): { err: FenelType; ok: FenelType } | null {
  if (!t || typeof t !== "object") return null;
  if ("$refined" in t) return peelResultForAuthoring(t.$refined.base);
  if (!("$variant" in t)) return null;
  const cases = t.$variant.cases ?? [];
  if (cases.length !== 2) return null;
  const err = cases.find((c) => c.name === "Err");
  const ok = cases.find((c) => c.name === "Ok");
  if (err?.fields?.length !== 1 || ok?.fields?.length !== 1) return null;
  const errField = err?.fields?.find((f) => f.name === "value" || f.name === "_0");
  const okField = ok?.fields?.find((f) => f.name === "value" || f.name === "_0");
  if (!errField?.type || !okField?.type) {
    const errPos = err.fields[0]!;
    const okPos = ok.fields[0]!;
    return errPos.key?.$tag === "PositionalField" && errPos.key.index === 0 && okPos.key?.$tag === "PositionalField" && okPos.key.index === 0
      ? { err: errPos.type, ok: okPos.type } : null;
  }
  return { err: errField.type, ok: okField.type };
}

/** B3 authoring lens: edit the one payload occurrence selected by the engine's
 * sugar recognizer. Rebuilding List/Maybe/Result from their smart constructors
 * would discard refinements, nominal names, discriminator and field identity.
 * The recognizers return the original raw payload type; no equality or type
 * decision is introduced here. A failed lens leaves the original untouched.
 */
export function replaceTypeSugarArgument(
  type: FenelType,
  argument: "element" | "inner" | "err" | "ok",
  replacement: FenelType,
): FenelType {
  const target = argument === "element" ? peelListForAuthoring(type)?.elem
    : argument === "inner" ? peelMaybeForAuthoring(type)?.value
    : peelResultForAuthoring(type)?.[argument];
  if (!target) return type;
  const caseName = argument === "element" ? "Cons" : argument === "inner" ? "Just" : argument === "err" ? "Err" : "Ok";
  const visit = (node: FenelType): FenelType => {
    if ("$refined" in node) return { $refined: { ...node.$refined, base: visit(node.$refined.base) } };
    if ("$opaque" in node && node.$opaque.pure) return { $opaque: { ...node.$opaque, pure: visit(node.$opaque.pure) } };
    if ("$mu" in node) return { $mu: { ...node.$mu, body: visit(node.$mu.body) } };
    if ("$variant" in node) return { $variant: { ...node.$variant, cases: node.$variant.cases.map((entry) => entry.name !== caseName ? entry : {
      ...entry, fields: entry.fields?.map((field) => field.type === target ? { ...field, type: replacement } : field),
    }) } };
    return node;
  };
  return visit(type);
}

export function detectTypeKind(t: FenelType | null | undefined): TypeKind | null {
  if (!t || typeof t !== "object") return null;
  if ("$void" in t) return "void";
  if ("$unit" in t) return "unit";
  if (refHandle(t) !== undefined) return "named";
  if ("$var" in t) return "var";
  if ("$type" in t) return "type";
  if (peelListForAuthoring(t)) return "list";
  if (peelMaybeForAuthoring(t)) return "maybe";
  if (peelResultForAuthoring(t)) return "result";
  if ("$record" in t) return "record";
  if ("$variant" in t) return "variant";
  if ("$tuple" in t) return "tuple";
  if ("$map" in t) return "map";
  if ("$union" in t) return "union";
  if ("$intersect" in t) return "intersect";
  if ("$complement" in t) return "complement";
  if ("$refined" in t) return "refined";
  if ("$mu" in t) return "mu";
  if ("$tagged" in t) return "tagged";
  if ("$opaque" in t) return "opaque";
  if ("$arrow" in t) return "arrow";
  if ("$el" in t) {
    const e = (t as { $el?: unknown }).$el;
    if (e && typeof e === "object" && !Array.isArray(e) && "call" in e) {
      return "el-call";
    }
    return "el";
  }
  return null;
}

export function isFenelTypeLike(value: unknown): value is FenelType {
  return detectTypeKind(value as FenelType | null | undefined) !== null;
}

export function defaultTypeForKind(kind: TypeKind): FenelType {
  switch (kind) {
    case "void": return { $void: true };
    case "unit": return { $unit: true };
    case "named": return { $ref: "String" };
    case "var": return { $var: "a" };
    case "type": return { $type: true };
    case "record": return { $record: { fields: [] } };
    case "variant": return { $variant: { cases: [] } };
    case "tuple": return { $tuple: [{ $ref: "String" }] };
    case "map": return { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } } };
    case "list": return List({ $ref: "String" });
    case "maybe": return Maybe({ $ref: "String" });
    case "result": return Result({ $ref: "String" }, { $ref: "String" });
    case "union": return { $union: [{ $ref: "String" }, { $ref: "Number" }] };
    case "intersect": return { $intersect: [{ $ref: "String" }, { $ref: "String" }] };
    case "complement": return { $complement: { $ref: "String" } };
    case "el-call": return { $el: { call: ["List", { $ref: "String" }] } };
    case "refined": return { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: [] } } };
    case "mu": return { $mu: { var: "X", body: { $variant: { cases: [] } } } };
    case "tagged": return { $tagged: { value: { $ref: "String" }, phantom: { $var: "id" } } };
    case "opaque": return { $opaque: { name: "Type", pure: { $ref: "String" } } };
    case "arrow": return { $arrow: { params: [], returns: { $ref: "String" } } };
    case "el": return { $el: { var: "" } };
  }
}

export type ElMode = "sibling" | "call" | "if" | "match" | "expression";

export function detectElMode(expr: Expression | undefined): ElMode {
  if (!expr || typeof expr !== "object" || Array.isArray(expr)) return "expression";
  if (typeof (expr as { var?: unknown }).var === "string") return "sibling";
  if (Array.isArray((expr as { call?: unknown }).call)) return "call";
  if (Array.isArray((expr as { if?: unknown }).if)) return "if";
  if (Array.isArray((expr as { match?: unknown }).match)) return "match";
  return "expression";
}

export function defaultElExpressionForMode(mode: ElMode): Expression {
  switch (mode) {
    case "sibling":
      return { var: "" };
    case "call":
      return { call: ["Vec", { var: "n" }, { $ref: "String" }] };
    case "if":
      return { if: [{ var: "condition" }, { $ref: "String" }, { $ref: "Number" }] };
    case "match":
      return { match: [{ var: "tag" }, "_", { $ref: "String" }] };
    case "expression":
      return { var: "type" };
  }
}

export { defaultValueForAuthoring, nativeValueTypeName, resolveValueType, variantValueDiscriminator, pureValueType, isNativeValueRepresentation, valueToJsonWire, valueFromJsonWire, instanceMethodsValueType, instanceToJsonWire, instanceFromJsonWire, assertJsonAuthoringValue, VALUE_JSON_ENCODING, INSTANCE_JSON_ENCODING, isValueJsonEncoding, isInstanceJsonEncoding, type ValueJsonEncoding, type InstanceJsonEncoding } from "./value-authoring";

export type ConstraintDraft = {
  interfaceName: string;
  args: FenelType[];
};

export function typeExprToFenelType(expr: TypeExpr): FenelType {
  if (typeof expr === "string") return { $ref: expr };
  if ("$var" in expr) return { $var: expr.$var };
  if ("$el" in expr) {
    const call = expr.$el.call;
    return {
      $el: {
        call: [call[0], ...call.slice(1).map((arg) => typeExprToFenelType(arg))],
      },
    };
  }
  return { $ref: "String" };
}

export function fenelTypeToTypeExpr(type: FenelType): TypeExpr {
  const handle = refHandle(type);
  if (handle) return handle;
  if ("$var" in type) return { $var: type.$var };
  if ("$el" in type) {
    const expr = type.$el;
    if (expr && typeof expr === "object" && !Array.isArray(expr)) {
      const call = (expr as { call?: unknown }).call;
      if (Array.isArray(call) && typeof call[0] === "string") {
        return {
          $el: {
            call: [call[0], ...call.slice(1).map((arg) =>
              isFenelTypeLike(arg) ? fenelTypeToTypeExpr(arg) : "String"
            )],
          },
        };
      }
    }
  }
  if ("$type" in type) return "Type";
  return "String";
}

export function constraintToDraft(constraint: Constraint): ConstraintDraft {
  return {
    interfaceName: constraint.class.entityId,
    args: constraint.args.map(typeExprToFenelType),
  };
}

export function constraintDraftToConstraint(draft: ConstraintDraft): Constraint {
  return {
    class: { $tag: "Id", entityId: draft.interfaceName },
    args: draft.args.map(fenelTypeToTypeExpr),
  };
}
