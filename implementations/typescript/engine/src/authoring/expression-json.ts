import type { Expression, FenelFunction, FenelType, FieldDef, LayoutSection, Pattern, SetExpr, TypeConstructorParam, TypeScheme, TypeView } from "../types";
import type { FieldOwnerDefinition, FieldPersistenceSnapshot } from "../field-authoring";
import { setExprToJsonWire, setExprToTag, isSetExpr } from "../set-marker";
import { isFenelTypeLike, peelListForAuthoring } from "./type-authoring";
import { unfold } from "../set-algebra";
import { valueFromJsonWire, valueToJsonWire, valueToNativeJsonProjection, valueFromNativeJsonProjection } from "./value-authoring";
import { assertAcyclicAuthoringData, assertJsonAuthoringValue, assertNativeAuthoringValue } from "./json-value";
import { encodeCheckpointValue } from "../checkpoint-json";
import { RUNTIME_AUTHORING_OPERATORS } from "./expression-operators";

const RUNTIME_OPERATOR_KEYS = new Set(RUNTIME_AUTHORING_OPERATORS.map(({ op }) => op));

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const mapRecord = (value: RecordValue, map: (value: unknown, key: string) => unknown): RecordValue =>
  Object.fromEntries(Object.entries(value).map(([key, child]) => [key, map(child, key)]));

/** B3 syntax-role transport. These are the evaluator/authoring codec's operand
 * roles, not a recursive shape-based JSON replacer. Raw var defaults, patterns,
 * tagged payloads and closure captures never acquire executable/type roles. */
function projection(decode: boolean, nativeAtoms = false) {
  function rawData<T>(value: T): T {
    if (!decode) {
      if (nativeAtoms) assertNativeAuthoringValue(value, "expression data");
      else assertJsonAuthoringValue(value, new Set(), "expression data", true);
    }
    return value;
  }
  function expectedView(expected?: FenelType): FenelType | undefined {
    const seen = new Set<FenelType>();
    let current = expected;
    while (current && !seen.has(current)) {
      seen.add(current);
      if ("$refined" in current) current = current.$refined.base;
      else if ("$tagged" in current) current = current.$tagged.value;
      else if ("$opaque" in current && current.$opaque.pure) current = current.$opaque.pure;
      else if ("$mu" in current) current = unfold(current);
      else return current;
    }
    return undefined;
  }
  function literal(value: unknown, expected?: FenelType): unknown {
    // Inline schema and canonical native names supply a real value role. An
    // unresolved alias requires its registry and must not use an ambient one.
    if (expected && (!("$ref" in expected) || ["Any", "Value", "Bytes", "SetExpr", "Type", "FenelType"].includes(expected.$ref))) {
      return decode ? nativeAtoms ? valueFromNativeJsonProjection(expected, value, null) : valueFromJsonWire(expected, value, null) : nativeAtoms
        ? valueToNativeJsonProjection(expected, value, null) : valueToJsonWire(expected, value, null);
    }
    return rawData(value);
  }
  function fields(values: FieldDef[]): FieldDef[] {
    return values.map((field) => ({ ...field, type: type(field.type) }));
  }
  function type(value: FenelType): FenelType {
    if (!record(value)) return value;
    if ("$refined" in value) return { ...value, $refined: { ...value.$refined, base: type(value.$refined.base), set: set(value.$refined.set) } };
    if ("$map" in value) return { ...value, $map: { ...value.$map, keys: set(value.$map.keys), values: type(value.$map.values) } };
    if ("$record" in value) return { ...value, $record: { ...value.$record, fields: fields(value.$record.fields) } };
    if ("$variant" in value) return { ...value, $variant: { ...value.$variant, cases: value.$variant.cases.map((entry) => ({ ...entry, ...(entry.fields ? { fields: fields(entry.fields) } : {}) })) } };
    if ("$arrow" in value) return { ...value, $arrow: { ...value.$arrow, params: fields(value.$arrow.params), returns: type(value.$arrow.returns) } };
    if ("$tuple" in value) return { ...value, $tuple: value.$tuple.map(type) };
    if ("$union" in value) return { ...value, $union: value.$union.map(type) };
    if ("$intersect" in value) return { ...value, $intersect: value.$intersect.map(type) };
    if ("$complement" in value) return { ...value, $complement: type(value.$complement) };
    if ("$mu" in value) return { ...value, $mu: { ...value.$mu, body: type(value.$mu.body) } };
    if ("$tagged" in value) return { ...value, $tagged: { ...value.$tagged, value: type(value.$tagged.value), phantom: type(value.$tagged.phantom) } };
    if ("$opaque" in value && value.$opaque.pure) return { ...value, $opaque: { ...value.$opaque, pure: type(value.$opaque.pure) } };
    if ("$el" in value) return { ...value, $el: expression(value.$el) as Expression };
    return value;
  }
  function pattern(value: Pattern): Pattern {
    switch (value.t) {
      case "match": return { ...value, pred: set(value.pred) };
      case "seq": case "alt": return { ...value, a: pattern(value.a), b: pattern(value.b) };
      case "rep": return { ...value, child: pattern(value.child) };
      case "group": return { ...value, child: pattern(value.child), ...(value.type === undefined ? {} : { type: set(value.type) }) };
      default: return value;
    }
  }
  function set(value: unknown): SetExpr {
    const node = setExprToTag(value);
    let mapped: SetExpr;
    switch (node.$tag) {
      case "SeWhere": mapped = { ...node, pred: expression(node.pred) as Expression }; break;
      case "SeInterval": mapped = { ...node, interval: { ...node.interval, ...Object.fromEntries(["lo", "hi"].map((key) => {
        const bound = node.interval[key as "lo" | "hi"];
        return [key, bound.$tag === "Just" && record(bound._0.value) && "$expr" in bound._0.value
          ? { ...bound, _0: { ...bound._0, value: { ...bound._0.value, $expr: expression(bound._0.value.$expr) } } } : bound];
      })) } }; break;
      case "SePattern": mapped = { ...node, pattern: pattern(node.pattern) }; break;
      case "SeUnion": case "SeIntersect": mapped = { ...node, branches: node.branches.map(set) }; break;
      case "SeDiff": mapped = { ...node, left: set(node.left), right: set(node.right) }; break;
      case "SeComplement": mapped = { ...node, inner: set(node.inner) }; break;
      case "SeMu": mapped = { ...node, body: set(node.body) }; break;
      case "SeCtor": mapped = { ...node, fields: node.fields.map((field) => ({ ...field, set: set(field.set) })) }; break;
      case "SeArrow": mapped = { ...node, params: node.params.map((param) => ({ ...param, set: set(param.set) })), returns: set(node.returns) }; break;
      default: mapped = node;
    }
    // Only the SetExpr grammar owns max:"unbounded". Neither raw data nor
    // arbitrary numbers are rewritten, and the decoder leaves Infinity intact.
    return (decode ? mapped : setExprToJsonWire(mapped)) as SetExpr;
  }
  function matchPattern(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(matchPattern);
    if (!record(value)) return rawData(value);
    if (Array.isArray(value.$guard)) return { ...value, $guard: value.$guard.map((child, index) => index === 0 ? matchPattern(child) : index === 1 ? expression(child) : child) };
    if (typeof value.$bind === "string") return rawData(value);
    return mapRecord(value, (child, key) => key === "$tag" ? child : matchPattern(child));
  }
  function declared(value: unknown): unknown {
    if (!record(value)) return rawData(value);
    return {
      ...value,
      ...(isFenelTypeLike(value.alias) ? { alias: type(value.alias) } : {}),
      ...(isFenelTypeLike(value.refined) ? { refined: type(value.refined) } : {}),
      ...(isFenelTypeLike(value.kindSig) ? { kindSig: type(value.kindSig) } : {}),
      ...(Array.isArray(value.constructors) ? { constructors: value.constructors.map((entry) => !record(entry) ? entry : {
        ...entry,
        ...(Array.isArray(entry.fields) ? { fields: fields(entry.fields as FieldDef[]) } : {}),
        ...(isFenelTypeLike(entry.type) ? { type: type(entry.type) } : {}),
      }) } : {}),
    };
  }
  function expression(value: unknown, expected?: FenelType): unknown {
    if (Array.isArray(value)) {
      const element = expected && peelListForAuthoring(expected)?.elem;
      if (element) return value.map((child) => expression(child, element));
      const shape = expectedView(expected);
      return value.map((child, index) => expression(child, shape && "$tuple" in shape ? shape.$tuple[index] : element));
    }
    const shape = expectedView(expected);
    if (!record(value)) return rawData(value);
    // An already-native binary literal belongs to the v2 outer atom carrier.
    // Lowering it to an array here would make the expression reader treat it
    // as a list before reaching the declared Bytes value slot.
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return decode || nativeAtoms ? rawData(value) : literal(value, expected);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    // Only v2 authorizes these declared value carriers in an expression slot.
    // The writer routes original marker-shaped literals through the same value
    // codec, escaping them once before this reader unwraps one transport frame.
    if (decode && nativeAtoms && expected && shape && Object.keys(value).length === 1
      && ("$union" in shape && "$fenelUnion" in value || "$intersect" in shape && "$fenelIntersection" in value)) return literal(value, expected);
    // Callable descriptors are literal data. Only their declared Arrow schema
    // can assign an expression role to a body; captures remain raw values.
    if (value.__fenelFn === true || value.__fenelPartial === true) return literal(value, expected);
    if (shape && "$ref" in shape && shape.$ref === "SetExpr" && isSetExpr(value)) return set(value);
    if ("$tag" in value) return literal(value, expected);
    if (isFenelTypeLike(value)) return type(value);
    if (Object.keys(value).some((key) => key.startsWith("$"))) return nativeAtoms && !decode && expected ? literal(value, expected) : rawData(value);
    const keys = Object.keys(value);
    const recordFieldType = (name: string) => shape && "$record" in shape
      ? shape.$record.fields.find((field) => field.name === name)?.type
      : shape && "$map" in shape ? shape.$map.values : undefined;
    if (keys.length !== 1) return mapRecord(value, (child, key) => expression(child, recordFieldType(key)));
    const op = keys[0]!;
    const raw = value[op];
    // The evaluator consumes these operands as data, including a var's entire
    // fallback value. A Type-shaped record there remains exactly that data.
    if (op === "var" || op === "missing" || op === "missing_some") return rawData(value);
    const args = Array.isArray(raw) ? raw : [raw];
    const restore = (next: unknown[]) => ({ ...value, [op]: Array.isArray(raw) ? next : next[0] });
    if (op === "ann") {
      const annotation = isFenelTypeLike(args[1]) ? args[1] : undefined;
      return restore(args.map((child, index) => index === 0 ? expression(child, annotation ?? expected) : index === 1 && annotation ? type(annotation) : child));
    }
    if (op === "fn") return restore(args.map((child, index) => index === args.length - 1
      ? expression(child, expected && "$arrow" in expected ? expected.$arrow.returns : undefined) : child));
    if (op === "type_def") return restore(args.map((child, index) => index === 0 ? declared(child) : child));
    if (op === "match") return restore(args.map((child, index) => index === 0 ? expression(child)
      : index % 2 === 0 || index === args.length - 1 ? expression(child, expected) : matchPattern(child)));
    if (op === "where") return restore(args.map((child, index) => index === 0 ? expression(child, expected)
      : index === 1 && record(child) ? mapRecord(child, (entry) => expression(entry)) : child));
    if (op === "let") return restore(args.map((child, index) => index === 0 && record(child)
      ? mapRecord(child, (entry) => expression(entry)) : child));
    if (op === "call" || op === "method" || op === "construct") return restore(args.map((child, index) =>
      index < (op === "method" ? 2 : 1) && typeof child === "string" ? child : expression(child)));
    if (op === "if" || op === "?:") return restore(args.map((child, index) => expression(child,
      index % 2 === 1 || index === args.length - 1 ? expected : undefined)));
    if (op === "do") return restore(args.map((child, index) => record(child) && record(child.let)
      ? { ...child, let: mapRecord(child.let, (entry) => expression(entry)) }
      : expression(child, index === args.length - 1 ? expected : undefined)));
    if (op === "withInstance") return restore(args.map((child, index) => expression(child, index === 1 ? expected : undefined)));
    // Eager operators, key-as-function calls and ordinary record fields all
    // evaluate their child values. Retain the original scalar/array carrier.
    return { ...value, [op]: expression(raw, RUNTIME_OPERATOR_KEYS.has(op) || op.includes(":") ? undefined : recordFieldType(op)) };
  }
  return { expression, type };
}

function projected<T>(value: T, decode: boolean, visit: (mapper: ReturnType<typeof projection>) => unknown): T {
  assertAcyclicAuthoringData(value);
  const result = visit(projection(decode));
  if (!decode) assertJsonAuthoringValue(result);
  return result as T;
}

export function expressionToJsonWire<T>(value: T, expectedType?: FenelType): T {
  return projected(value, false, (mapper) => mapper.expression(value, expectedType));
}
export function expressionFromJsonWire<T>(value: T, expectedType?: FenelType): T {
  return projected(value, true, (mapper) => mapper.expression(value, expectedType));
}
/** Intermediate projection used only beneath the explicit value-v2 carrier.
 * The value codec wraps the complete result once; this helper emits no frame. */
export function expressionToNativeJsonProjection<T>(value: T, expectedType?: FenelType): T {
  assertAcyclicAuthoringData(value);
  const result = projection(false, true).expression(value, expectedType);
  encodeCheckpointValue(result);
  return result as T;
}
export function expressionFromNativeJsonProjection<T>(value: T, expectedType?: FenelType): T {
  assertAcyclicAuthoringData(value);
  return projection(true, true).expression(value, expectedType) as T;
}
export function typeToJsonWire<T extends FenelType>(value: T): T {
  return projected(value, false, (mapper) => mapper.type(value));
}
export function typeFromJsonWire<T extends FenelType>(value: T): T {
  return projected(value, true, (mapper) => mapper.type(value));
}

function functionProjection<T extends FenelFunction>(value: T, decode: boolean): T {
  return projected(value, decode, (mapper) => ({
    ...value,
    params: value.params.map((field) => ({ ...field, type: mapper.type(field.type) })),
    returns: mapper.type(value.returns),
    ...(value.body === undefined ? {} : { body: mapper.expression(value.body, value.returns) }),
    ...(value.signatureDeclaration === undefined ? {} : { signatureDeclaration: {
      ...value.signatureDeclaration,
      ...(value.signatureDeclaration.scheme === undefined ? {} : {
        scheme: schemeProjection(value.signatureDeclaration.scheme, mapper),
      }),
    } }),
  }));
}

/** B3 roles within the existing scheme carrier. Binder/kind/nominal identity
 * remains inert data; only body and redundant application arguments are Types. */
function schemeProjection(value: TypeScheme, mapper: ReturnType<typeof projection>): TypeScheme {
  return { ...value, body: mapper.type(value.body),
    ...(value.applications === undefined ? {} : { applications: value.applications.map(application => ({
      ...application, args: application.args.map(argument => mapper.type(argument)),
    })) }),
  };
}
export function functionDefinitionToJsonWire<T extends FenelFunction>(value: T): T { return functionProjection(value, false); }
export function functionDefinitionFromJsonWire<T extends FenelFunction>(value: T): T { return functionProjection(value, true); }

type TypeDefinitionTransport = { type?: unknown; $defs?: Record<string, FenelType>;
  params?: readonly (string | TypeConstructorParam)[]; typeScheme?: TypeScheme };
function typeDefinitionProjection<T extends TypeDefinitionTransport>(value: T, decode: boolean): T {
  return projected(value, decode, (mapper) => ({
    ...value,
    ...(value.type === undefined ? {} : { type: mapper.type(value.type as FenelType) }),
    ...(value.$defs === undefined ? {} : { $defs: Object.fromEntries(Object.entries(value.$defs).map(([name, entry]) => [name, mapper.type(entry)])) }),
    ...(value.typeScheme === undefined ? {} : { typeScheme: schemeProjection(value.typeScheme, mapper) }),
  }));
}
export function typeDefinitionToJsonWire<T extends TypeDefinitionTransport>(value: T): T { return typeDefinitionProjection(value, false); }
export function typeDefinitionFromJsonWire<T extends TypeDefinitionTransport>(value: T): T { return typeDefinitionProjection(value, true); }

type ViewTransport = Pick<Partial<TypeView>, "targetType" | "display" | "layout">;
function viewProjection<T extends ViewTransport>(value: T, decode: boolean): T {
  return projected(value, decode, (mapper) => {
    const conditional = <Row extends { when?: Expression }>(row: Row): Row => row.when === undefined
      ? row : { ...row, when: mapper.expression(row.when) as Expression };
    const sections = (items: LayoutSection[]) => items.map((section) => ({ ...conditional(section),
      rows: section.rows.map((row) => ({ ...conditional(row), slots: row.slots.map(conditional) })),
    }));
    let display = value.display;
    if (display?.$tag === "Just" && display._0.edit?.$tag === "Just") {
      const edit = display._0.edit._0;
      // Option values are data. Their key spelling cannot establish a Type or
      // expression role, even when the view itself declares a target type.
      if (!decode && edit.options?.$tag === "Just") for (const option of edit.options._0) {
        assertJsonAuthoringValue(option.value, new Set(), "view option value", true);
      }
      if (edit.refFilter?.$tag === "Just") display = { ...display, _0: { ...display._0, edit: { ...display._0.edit,
        _0: { ...edit, refFilter: { ...edit.refFilter, _0: mapper.expression(edit.refFilter._0) as Expression } },
      } } };
    }
    return {
      ...value,
      ...(value.targetType === undefined ? {} : { targetType: mapper.type(value.targetType) }),
      ...(value.display === undefined ? {} : { display }),
      ...(value.layout === undefined ? {} : { layout: { ...value.layout, sections: sections(value.layout.sections),
        ...(value.layout.responsive === undefined ? {} : { responsive: value.layout.responsive.map((entry) => ({ ...entry, sections: sections(entry.sections) })) }),
      } }),
    };
  });
}
export function viewDefinitionToJsonWire<T extends ViewTransport>(value: T): T { return viewProjection(value, false); }
export function viewDefinitionFromJsonWire<T extends ViewTransport>(value: T): T { return viewProjection(value, true); }

export function ownerDefinitionToJsonWire<T extends FieldOwnerDefinition>(owner: T): T {
  return { ...owner, definition: owner.kind === "function" ? functionDefinitionToJsonWire(owner.definition) : typeDefinitionToJsonWire(owner.definition) };
}
export function ownerDefinitionFromJsonWire<T extends FieldOwnerDefinition>(owner: T): T {
  return { ...owner, definition: owner.kind === "function" ? functionDefinitionFromJsonWire(owner.definition) : typeDefinitionFromJsonWire(owner.definition) };
}
export function fieldDefinitionSnapshotToJsonWire<T extends FieldPersistenceSnapshot>(snapshot: T): T {
  return { ...snapshot, owners: snapshot.owners.map(ownerDefinitionToJsonWire) };
}
export function fieldDefinitionSnapshotFromJsonWire<T extends FieldPersistenceSnapshot>(snapshot: T): T {
  return { ...snapshot, owners: snapshot.owners.map(ownerDefinitionFromJsonWire) };
}
