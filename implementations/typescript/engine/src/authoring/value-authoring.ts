import type { FenelType, FieldDef } from "../types";
import type { ModuleRegistry } from "../registry";
import { fenelTypeToJsonWire, setExprToJsonWire, setExprToTag } from "../set-marker";
import { unfold } from "../set-algebra";
import { peelEl } from "../dependent-types";
import { structuralView } from "../structural";
import { getEntityTypeByName } from "../type-catalog";
import { Nothing, builtinTypes, foundationEntityRegs, substituteTypeVars } from "../type-foundation";
import type { Interface } from "../class-types";
import { GLOBAL_ONLY } from "../dispatch-registry";
import type { TypeExpr } from "../types";
import { engineRequire } from "../engine-require";
import { resolveFieldWireName } from "../identified-field-view";
import type { DefaultRegistry } from "../field-meta";
import { peelMaybeForAuthoring as peelMaybe, peelListForAuthoring as peelList, peelResultForAuthoring as peelResult, typeExprToFenelType } from "./type-authoring";
import { assertAcyclicAuthoringData, assertJsonAuthoringValue, assertNativeAuthoringValue } from "./json-value";
import { expressionToJsonWire, expressionFromJsonWire, expressionToNativeJsonProjection, expressionFromNativeJsonProjection } from "./expression-json";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "../checkpoint-json";
export { assertJsonAuthoringValue } from "./json-value";
export const VALUE_JSON_ENCODING = "fenel-value-json-v2" as const;
export const INSTANCE_JSON_ENCODING = "fenel-instance-json-v2" as const;
export type ValueJsonEncoding = "fenel-value-json-v1" | typeof VALUE_JSON_ENCODING;
export type InstanceJsonEncoding = "fenel-instance-json-v1" | typeof INSTANCE_JSON_ENCODING;
export const isValueJsonEncoding = (value: unknown): value is ValueJsonEncoding => value === "fenel-value-json-v1" || value === VALUE_JSON_ENCODING;
export const isInstanceJsonEncoding = (value: unknown): value is InstanceJsonEncoding => value === "fenel-instance-json-v1" || value === INSTANCE_JSON_ENCODING;
const DEFAULT_FOR_NAMED: Record<string, unknown> = {
  String: "",
  Char: "",
  Int: 0,
  Nat: 0,
  // Rational's default is supplied by its Fenel representation body below.
  Rational: undefined,
  Number: 0,
  Real: 0,
  Bool: false,
  Boolean: false,
  Unit: null,
};

/** Native representations must be recognized before exposing their pure ADT. */
export function nativeValueTypeName(type: FenelType): string | undefined {
  const name = "$ref" in type ? type.$ref : "$opaque" in type ? type.$opaque.name : undefined;
  if ("$opaque" in type && (name === "Rational" || name === "Nat" || name === "Int")) {
    const source = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
    if (source.dispatchEngineBody("engine:canonicalRepresentationName", [source.marshalTraversalType(type)]) !== name) return undefined;
  }
  return name && Object.hasOwn(DEFAULT_FOR_NAMED, name) ? name : undefined;
}

function lookupValueType(name: string): FenelType | undefined {
  return builtinTypes[name] ?? (name === "Boolean" ? builtinTypes.Bool : undefined)
    ?? foundationEntityRegs.find((entry) => entry.codeName === name)?.type
    ?? getEntityTypeByName(name);
}

/** Resolve native representation's pure definition only when that view is
 * requested. In particular a Number's tagged tower must never become a double
 * merely because its editor was opened. */
export function pureValueType(type: FenelType, resolveType: (name: string) => FenelType | undefined = lookupValueType): FenelType | undefined {
  if ("$refined" in type) return pureValueType(type.$refined.base, resolveType);
  if ("$tagged" in type) return pureValueType(type.$tagged.value, resolveType);
  const declared = "$ref" in type ? resolveType(type.$ref) : type;
  if (declared && "$opaque" in declared) return declared.$opaque.pure;
  if (declared && "$mu" in declared) return unfold(declared);
  return undefined;
}

export function isNativeValueRepresentation(typeName: string | undefined, value: unknown): boolean {
  if (value == null) return true;
  if (typeName === "List") return Array.isArray(value);
  if (typeName === "String" || typeName === "Char") return typeof value === "string";
  if (typeName === "Bool" || typeName === "Boolean") return typeof value === "boolean";
  if (typeName === "Unit") return value === null;
  if (typeName === "Nat") return (engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch")).dispatchEngineBody("std:natNativeRepresentation", [value]) as boolean;
  if (typeName === "Int") return (engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch")).dispatchEngineBody("std:intNativeRepresentation", [value]) as boolean;
  if (typeName === "Rational") return (engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch")).dispatchEngineBody("std:rationalNativeRepresentation", [value]) as boolean;
  return typeof value === "number";
}

function mappedTypeValue(type: FenelType, decode: boolean): unknown {
  if (!decode) return fenelTypeToJsonWire(type);
  const fields = (xs: FieldDef[]) => xs.map((field) => ({ ...field, type: mappedTypeValue(field.type, true) }));
  if ("$refined" in type) return { ...type, $refined: { ...type.$refined, base: mappedTypeValue(type.$refined.base, true), set: setExprToTag(type.$refined.set) } };
  if ("$map" in type) return { ...type, $map: { ...type.$map, keys: setExprToTag(type.$map.keys), values: mappedTypeValue(type.$map.values, true) } };
  if ("$record" in type) return { ...type, $record: { ...type.$record, fields: fields(type.$record.fields) } };
  if ("$variant" in type) return { ...type, $variant: { ...type.$variant, cases: type.$variant.cases.map((c) => ({ ...c, ...(c.fields ? { fields: fields(c.fields) } : {}) })) } };
  if ("$arrow" in type) return { ...type, $arrow: { ...type.$arrow, params: fields(type.$arrow.params), returns: mappedTypeValue(type.$arrow.returns, true) } };
  if ("$tuple" in type) return { ...type, $tuple: type.$tuple.map((child) => mappedTypeValue(child, true)) };
  if ("$union" in type) return { ...type, $union: type.$union.map((child) => mappedTypeValue(child, true)) };
  if ("$intersect" in type) return { ...type, $intersect: type.$intersect.map((child) => mappedTypeValue(child, true)) };
  if ("$complement" in type) return { ...type, $complement: mappedTypeValue(type.$complement, true) };
  if ("$mu" in type) return { ...type, $mu: { ...type.$mu, body: mappedTypeValue(type.$mu.body, true) } };
  if ("$tagged" in type) return { ...type, $tagged: { ...type.$tagged, value: mappedTypeValue(type.$tagged.value, true), phantom: mappedTypeValue(type.$tagged.phantom, true) } };
  if ("$opaque" in type && type.$opaque.pure) return { ...type, $opaque: { ...type.$opaque, pure: mappedTypeValue(type.$opaque.pure, true) } };
  return type;
}

function canonicalSchemaKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
}

/** Transport identity contains semantic slots and actual wire names, never
 * labels/UI/meta or record declaration order. Stored old schemas use their
 * historical field.name; a missing historical renamed wire is not guessed. */
function valueTransportSchema(type: FenelType, registry?: ModuleRegistry | null): unknown {
  if (!type || typeof type !== "object" || Array.isArray(type)) throw new TypeError("Invalid stored value branch schema; migrate this value explicitly");
  const visit = (child: FenelType) => valueTransportSchema(child, registry);
  const field = (f: FieldDef) => ({
    ...(f.key ? { key: f.key } : {}),
    name: registry && f.key?.$tag === "NamedField" ? resolveFieldWireName(registry, f) : f.name,
    type: visit(f.type),
  });
  const fields = (xs: FieldDef[]) => xs.map(field).sort((a, b) => canonicalSchemaKey(a.key ?? a.name).localeCompare(canonicalSchemaKey(b.key ?? b.name)));
  const branches = (xs: FenelType[]) => xs.map(visit).sort((a, b) => canonicalSchemaKey(a).localeCompare(canonicalSchemaKey(b)));
  if ("$record" in type) return { $record: { fields: fields(type.$record.fields) } };
  if ("$variant" in type) return { $variant: { discriminator: type.$variant.discriminator ?? "$tag", cases: type.$variant.cases.map((c) => ({ name: c.name, fields: fields(c.fields ?? []) })).sort((a, b) => a.name.localeCompare(b.name)) } };
  if ("$tuple" in type) return { $tuple: type.$tuple.map(visit) };
  if ("$arrow" in type) return { $arrow: { params: type.$arrow.params.map(field), returns: visit(type.$arrow.returns) } };
  if ("$union" in type) return { $union: branches(type.$union) };
  if ("$intersect" in type) return { $intersect: branches(type.$intersect) };
  if ("$map" in type) return { $map: { keys: setExprToJsonWire(type.$map.keys), values: visit(type.$map.values) } };
  if ("$refined" in type) return { $refined: { base: visit(type.$refined.base), set: setExprToJsonWire(type.$refined.set) } };
  if ("$tagged" in type) return { $tagged: { phantom: visit(type.$tagged.phantom), value: visit(type.$tagged.value) } };
  if ("$opaque" in type) return { $opaque: { name: type.$opaque.name, ...(type.$opaque.pure ? { pure: visit(type.$opaque.pure) } : {}) } };
  if ("$mu" in type) return { $mu: { var: type.$mu.var, body: visit(type.$mu.body) } };
  if ("$complement" in type) return { $complement: visit(type.$complement) };
  if ("$ref" in type) return { $ref: type.$ref };
  if ("$var" in type) return { $var: type.$var };
  if ("$el" in type) return { $el: type.$el };
  if ("$type" in type) return { $type: type.$type };
  if ("$unit" in type) return { $unit: type.$unit };
  if ("$void" in type) return { $void: type.$void };
  return type;
}

function valueJsonProjection(schema: FenelType, value: unknown, registry: ModuleRegistry | null | undefined, decode: boolean, active = new Set<string>(), nativeAtoms = false): unknown {
  const project = (child: FenelType, next: unknown, direction = decode, seen = new Set<string>()) => valueJsonProjection(child, next, registry, direction, seen, nativeAtoms);
  const check = (next: unknown) => nativeAtoms ? encodeCheckpointValue(next) : assertJsonAuthoringValue(next);
  const raw = () => {
    if (!decode) {
      if (nativeAtoms) assertNativeAuthoringValue(value);
      else assertJsonAuthoringValue(value, new Set(), "value", true);
    }
    return value;
  };
  if (!decode && value === undefined) return raw();
  const lookup = (name: string) => registry?.getIdentifiedEntity(name)?.type ?? registry?.getEntity(name)?.type ?? (registry === undefined ? lookupValueType(name) : undefined);
  if ("$el" in schema) {
    if (registry === null) return raw();
    const values = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const resolved = peelEl(schema, values);
    if (resolved && resolved !== schema) return project(resolved, value, decode, active);
  }
  if ("$type" in schema) return value && typeof value === "object" ? mappedTypeValue(value as FenelType, decode) : value;
  const handle = "$ref" in schema ? schema.$ref : undefined;
  const entity = handle && registry ? registry.getIdentifiedEntity(handle) ?? registry.getEntity(handle) : undefined;
  const name = entity?.id ?? handle ?? ("$opaque" in schema ? schema.$opaque.name : undefined);
  if (name === "Bytes") {
    if (value instanceof Uint8Array) return decode ? new Uint8Array(value) : Array.from(value);
    if (!decode && value instanceof ArrayBuffer) return { $fenelBytes: { version: 1, carrier: "array-buffer", values: Array.from(new Uint8Array(value)) } };
    if (!decode && Array.isArray(value)) {
      if (!value.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new TypeError("Bytes array must contain only integers from 0 to 255");
      return { $fenelBytes: { version: 1, carrier: "array", values: [...value] } };
    }
    if (decode && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && "$fenelBytes" in value) {
      const wire = (value as { $fenelBytes: { version?: unknown; carrier?: unknown; values?: unknown } }).$fenelBytes;
      if (wire?.version !== 1 || !Array.isArray(wire.values) || !wire.values.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new TypeError("Invalid Bytes carrier envelope");
      if (wire.carrier === "array") return [...wire.values];
      if (wire.carrier === "array-buffer") return Uint8Array.from(wire.values).buffer;
      throw new TypeError("Unknown Bytes carrier");
    }
    if (decode && Array.isArray(value)) {
      if (!value.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new TypeError("Bytes wire must contain only integers from 0 to 255");
      return Uint8Array.from(value);
    }
    // Tagged structural byte values are kept separate from the native byte array.
    if (value && typeof value === "object" && "$tag" in value) return raw();
    if (value == null) return value;
    throw new TypeError("Bytes value must be a Uint8Array, ArrayBuffer, or byte array");
  }
  if (name === "SetExpr") return value == null ? value : decode ? setExprToTag(value) : setExprToJsonWire(value);
  if (name === "Type" || name === "FenelType") return value && typeof value === "object" ? mappedTypeValue(value as FenelType, decode) : value;
  const nativeName = nativeValueTypeName(schema);
  if (nativeName && isNativeValueRepresentation(nativeName, value)) return value;
  if ("$ref" in schema) {
    if (value === null || typeof value !== "object") return raw();
    if (schema.$ref === "Any" || schema.$ref === "Value" || active.has(schema.$ref)) return raw();
    const resolved = lookup(schema.$ref);
    if (!resolved || resolved === schema) return raw();
    return project(resolved, value, decode, new Set(active).add(schema.$ref));
  }
  if ("$refined" in schema) return project(schema.$refined.base, value, decode, active);
  if ("$tagged" in schema) return project(schema.$tagged.value, value, decode, active);
  if ("$arrow" in schema) {
    const expression = decode ? nativeAtoms ? expressionFromNativeJsonProjection : expressionFromJsonWire : nativeAtoms ? expressionToNativeJsonProjection : expressionToJsonWire;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const callable = value as Record<string, unknown>;
      if (callable.__fenelFn === true) {
        if (!decode && Object.hasOwn(callable, "closure")) {
          if (nativeAtoms) assertNativeAuthoringValue(callable.closure, "value.closure");
          else assertJsonAuthoringValue(callable.closure, new Set(), "value.closure", true);
        }
        return { ...callable, body: expression(callable.body, schema.$arrow.returns) };
      }
      if (callable.__fenelPartial === true) {
        if (!decode && Object.hasOwn(callable, "collected")) {
          if (nativeAtoms) assertNativeAuthoringValue(callable.collected, "value.collected");
          else assertJsonAuthoringValue(callable.collected, new Set(), "value.collected", true);
        }
        return { ...callable, fn: project(schema, callable.fn) };
      }
    }
    return expression(value, schema);
  }
  const list = peelList(schema);
  if (list && Array.isArray(value)) return value.map((item) => project(list.elem, item));
  if ("$opaque" in schema) return schema.$opaque.pure && value !== null && typeof value === "object" ? project(schema.$opaque.pure, value, decode, active) : raw();
  if ("$mu" in schema) return project(unfold(schema), value, decode, active);
  if ("$tuple" in schema && Array.isArray(value)) return value.map((item, index) => project(schema.$tuple[index] ?? { $ref: "Any" }, item));
  const record = value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  if ("$map" in schema && record) return Object.fromEntries(Object.entries(value as object).map(([key, child]) => [key, project(schema.$map.values, child)]));
  let fields: FieldDef[] | undefined;
  if ("$record" in schema) fields = schema.$record.fields;
  if ("$variant" in schema && value && typeof value === "object") {
    const tag = (value as Record<string, unknown>)[schema.$variant.discriminator ?? "$tag"];
    fields = schema.$variant.cases.find((entry) => entry.name === tag)?.fields;
  }
  if (fields && record) {
    const output = { ...value } as Record<string, unknown>;
    const known = new Set<string>();
    for (const field of fields) {
      const wire = registry && field.key?.$tag === "NamedField" ? resolveFieldWireName(registry, field) : field.name;
      known.add(wire);
      const childSchema = "$el" in field.type && registry !== null ? peelEl(field.type, output) ?? field.type : field.type;
      if (Object.hasOwn(output, wire)) output[wire] = project(childSchema, output[wire]);
    }
    if (!decode) for (const [wire, child] of Object.entries(output)) if (!known.has(wire)) {
      if (nativeAtoms) assertNativeAuthoringValue(child, `value.${wire}`);
      else assertJsonAuthoringValue(child, new Set(), `value.${wire}`, true);
    }
    return output;
  }
  if ("$intersect" in schema) {
    const mergedRecord = (): FenelType | undefined => {
      if (!schema.$intersect.length || !schema.$intersect.every((part) => "$record" in part)) return undefined;
      const merged = new Map<string, FieldDef>();
      for (const part of schema.$intersect) for (const field of (part as Extract<FenelType, { $record: unknown }>).$record.fields) {
        const wire = registry && field.key?.$tag === "NamedField" ? resolveFieldWireName(registry, field) : field.name;
        const prior = merged.get(wire);
        merged.set(wire, prior ? { ...prior, type: { $intersect: [prior.type, field.type] } } : field);
      }
      return { $record: { fields: [...merged.values()] } };
    };
    const envelope = record && Object.keys(value as object).length === 1 && "$fenelIntersection" in (value as object)
      ? (value as { $fenelIntersection: unknown }).$fenelIntersection : undefined;
    if (decode && envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const wire = envelope as { version?: unknown; branches?: unknown; record?: unknown; value?: unknown };
      if (wire.version !== 1 || !Array.isArray(wire.branches) || !wire.branches.length || !Object.hasOwn(wire, "value")) throw new TypeError("Invalid intersection value transport envelope");
      const branches = wire.branches.map((encoded) => {
        const branch = schema.$intersect.find((part) => canonicalSchemaKey(valueTransportSchema(part, registry)) === canonicalSchemaKey(valueTransportSchema(encoded as FenelType)));
        if (!branch) throw new TypeError("Stored intersection branch was removed or changed; migrate this value explicitly");
        return branch;
      });
      if (wire.record === true) {
        const merged = mergedRecord();
        if (!merged || branches.length !== schema.$intersect.length) throw new TypeError("Stored intersection record schema changed; migrate this value explicitly");
        return project(merged, wire.value, true);
      }
      // Encoding composition is inverted in reverse order, including repeated
      // carrier slots. This is transport, not intersection membership checking.
      return branches.reverse().reduce((current, part) => project(part, current, true), wire.value);
    }
    if (!decode && (schemaHasValueTransport(schema, registry) || envelope !== undefined)) {
      // One branch may already describe the whole JSON carrier. This avoids
      // reinterpreting a Bytes wire array as an unrelated union/list inhabitant.
      for (const branch of schema.$intersect) {
        try {
          const projected = project(branch, value, false);
          check(projected);
          return { $fenelIntersection: { version: 1, branches: [valueTransportSchema(branch, registry)], value: projected } };
        } catch { /* disjoint typed record slots can need combined projection */ }
      }
      const merged = mergedRecord();
      if (merged) return { $fenelIntersection: { version: 1, record: true, branches: schema.$intersect.map((part) => valueTransportSchema(part, registry)), value: project(merged, value, false) } };
      const projected = schema.$intersect.reduce((current, part) => project(part, current, false), value);
      check(projected);
      return { $fenelIntersection: { version: 1, branches: schema.$intersect.map((part) => valueTransportSchema(part, registry)), value: projected } };
    }
    return [...schema.$intersect].reverse().reduce((current, part) => project(part, current), value);
  }
  if ("$union" in schema) {
    const branchKey = (branch: FenelType) => canonicalSchemaKey(valueTransportSchema(branch, registry));
    const envelope = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && "$fenelUnion" in value
      ? (value as { $fenelUnion: unknown }).$fenelUnion : undefined;
    if (decode && envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const wire = envelope as { version?: unknown; branch?: unknown; value?: unknown };
      if (wire.version !== 1 || !Object.hasOwn(wire, "branch") || !Object.hasOwn(wire, "value")) throw new TypeError("Invalid union value transport envelope");
      const key = canonicalSchemaKey(valueTransportSchema(wire.branch as FenelType));
      const branch = schema.$union.find((candidate) => branchKey(candidate) === key);
      if (!branch) throw new TypeError("Stored union branch was removed or changed; migrate this value explicitly");
      return project(branch, wire.value, true);
    }
    const candidates: { branch: FenelType; value: unknown }[] = [];
    // Preserve the pre-v2 typed carrier preference. Native raw fallback must
    // not make an earlier String branch shadow the Bytes/Arrow carrier that
    // v1 already knew how to represent. This ranks codecs, not membership.
    const legacyCompatible = nativeAtoms && !decode ? schema.$union.filter((branch) => {
      try {
        assertJsonAuthoringValue(valueJsonProjection(branch, value, registry, false));
        return true;
      } catch { return false; }
    }) : [];
    const ordered = legacyCompatible.length ? legacyCompatible : schema.$union;
    for (const branch of ordered) {
      try {
        // Re-project with v2 after choosing the branch: its Arrow body may
        // contain a native literal that v1 would otherwise lower to an array.
        const candidate = project(branch, value);
        if (!decode) check(candidate);
        candidates.push({ branch, value: candidate });
      } catch { /* try another explicitly declared branch */ }
    }
    if (candidates.length === 0) return raw();
    const first = candidates[0]!;
    if (decode && candidates.some((candidate) => (candidate.value instanceof Uint8Array) !== (first.value instanceof Uint8Array) || canonicalSchemaKey(candidate.value) !== canonicalSchemaKey(first.value))) {
      throw new TypeError("Legacy union data has ambiguous carrier identity; an explicit migration is required");
    }
    if (!decode && (schema.$union.some((branch) => schemaHasValueTransport(branch, registry)) || envelope !== undefined)) {
      // This envelope is recognized only beneath an explicit union schema.
      // The canonical branch type survives branch reordering. An envelope-like
      // ordinary record is nested as a child, so its keys never become magic.
      return { $fenelUnion: { version: 1, branch: valueTransportSchema(first.branch, registry), value: first.value } };
    }
    return first.value;
  }
  return raw();
}

function schemaHasValueTransport(schema: FenelType, registry?: ModuleRegistry | null, seen = new Set<string>()): boolean {
  if ("$type" in schema) return true;
  // Any callable body can contain a Type/SetExpr literal in an intermediate
  // expression, independently of the function's declared result type.
  if ("$arrow" in schema) return true;
  if ("$ref" in schema) {
    if (["Bytes", "SetExpr", "Type", "FenelType"].includes(schema.$ref)) return true;
    if (schema.$ref === "Any" || schema.$ref === "Value" || seen.has(schema.$ref) || nativeValueTypeName(schema)) return false;
    const type = registry?.getIdentifiedEntity(schema.$ref)?.type ?? registry?.getEntity(schema.$ref)?.type ?? (registry === undefined ? lookupValueType(schema.$ref) : undefined);
    return type ? schemaHasValueTransport(type, registry, new Set(seen).add(schema.$ref)) : false;
  }
  if ("$opaque" in schema) return schema.$opaque.name === "Bytes" || schema.$opaque.name === "SetExpr" || !!schema.$opaque.pure && schemaHasValueTransport(schema.$opaque.pure, registry, new Set(seen).add(schema.$opaque.name));
  if ("$record" in schema) return schema.$record.fields.some((field) => schemaHasValueTransport(field.type, registry, seen));
  if ("$variant" in schema) return schema.$variant.cases.some((entry) => entry.fields?.some((field) => schemaHasValueTransport(field.type, registry, seen)));
  if ("$tuple" in schema) return schema.$tuple.some((type) => schemaHasValueTransport(type, registry, seen));
  if ("$union" in schema) return schema.$union.some((type) => schemaHasValueTransport(type, registry, seen));
  if ("$intersect" in schema) return schema.$intersect.some((type) => schemaHasValueTransport(type, registry, seen));
  if ("$map" in schema) return schemaHasValueTransport(schema.$map.values, registry, seen);
  if ("$refined" in schema) return schemaHasValueTransport(schema.$refined.base, registry, seen);
  if ("$tagged" in schema) return schemaHasValueTransport(schema.$tagged.value, registry, seen);
  if ("$mu" in schema) return schemaHasValueTransport(schema.$mu.body, registry, seen);
  return "$el" in schema;
}

/** null means syntax-local transport with no ambient named-type catalogue. */
export function valueToJsonWire(schema: FenelType, value: unknown, registry?: ModuleRegistry | null, encoding: ValueJsonEncoding = "fenel-value-json-v1"): unknown {
  if (!isValueJsonEncoding(encoding)) throw new TypeError("Unsupported value encoding");
  assertAcyclicAuthoringData(value);
  const projected = valueJsonProjection(schema, value, registry, false, undefined, encoding === VALUE_JSON_ENCODING);
  if (encoding === VALUE_JSON_ENCODING) return encodeCheckpointValue(projected);
  assertJsonAuthoringValue(projected);
  return projected;
}

export function valueFromJsonWire(schema: FenelType, value: unknown, registry?: ModuleRegistry | null, encoding: ValueJsonEncoding = "fenel-value-json-v1"): unknown {
  if (!isValueJsonEncoding(encoding)) throw new TypeError("Unsupported value encoding");
  assertAcyclicAuthoringData(value);
  const nativeAtoms = encoding === VALUE_JSON_ENCODING;
  const decoded = nativeAtoms ? decodeCheckpointValue(value, CHECKPOINT_VALUE_ENCODING) : value;
  return valueJsonProjection(schema, decoded, registry, true, undefined, nativeAtoms);
}

/** Intermediate expression-literal adapter. Its owner must encode the complete
 * v2 payload exactly once; this helper never emits a native-atom frame itself. */
export function valueToNativeJsonProjection(schema: FenelType, value: unknown, registry?: ModuleRegistry | null): unknown {
  assertAcyclicAuthoringData(value);
  const projected = valueJsonProjection(schema, value, registry, false, undefined, true);
  encodeCheckpointValue(projected);
  return projected;
}
/** Inverse for an expression literal after the v2 owner decoded its outer
 * native-atom layer. Applying that outer decoder here would revive raw data. */
export function valueFromNativeJsonProjection(schema: FenelType, value: unknown, registry?: ModuleRegistry | null): unknown {
  assertAcyclicAuthoringData(value);
  return valueJsonProjection(schema, value, registry, true, undefined, true);
}

/** The methods record is ordinary typed data. Registry definitions retain
 * exact method field identities; the class seed is the transient UI fallback. */
export function instanceMethodsValueType(typeName: string, args: unknown[], registry?: ModuleRegistry, declaredInterface?: Interface): FenelType {
  const entry = registry?.getIdentifiedEntity(typeName) ?? registry?.getEntity(typeName);
  const iface = declaredInterface ?? entry?.interface ?? (engineRequire("system-entities") as typeof import("../system-entities")).dispatchRegistry.getClass(typeName);
  const names = entry?.params?.map((parameter) => typeof parameter === "string" ? parameter : parameter.name) ?? iface?.params?.map((parameter) => parameter.name) ?? [];
  const bindings: Record<string, FenelType> = {};
  names.forEach((name, index) => {
    const arg = args[index];
    if (typeof arg === "string" || arg && typeof arg === "object" && ("$var" in arg || "$el" in arg)) bindings[name] = typeExprToFenelType(arg as TypeExpr);
  });
  if (entry?.type) return substituteTypeVars(entry.type, bindings);
  if (!iface) return { $ref: "Any" };
  return { $record: { fields: iface.methods.map((method) => ({
    name: method.name, label: Nothing, ui: Nothing, meta: {},
    type: substituteTypeVars(method.params.length ? { $arrow: { params: method.params, returns: method.returns } } : method.returns, bindings),
  })) } };
}

export function instanceToJsonWire<T extends Record<string, unknown>>(instance: T, registry?: ModuleRegistry, iface?: Interface, encoding: InstanceJsonEncoding = "fenel-instance-json-v1"): T {
  if (!isInstanceJsonEncoding(encoding)) throw new TypeError("Unsupported instance encoding");
  const typeName = typeof instance.typeName === "string" ? instance.typeName : typeof instance.type === "string" ? instance.type : "";
  const args = Array.isArray(instance.args) ? instance.args : [];
  return { ...instance, methods: valueToJsonWire(instanceMethodsValueType(typeName, args, registry, iface), instance.methods, registry, encoding === INSTANCE_JSON_ENCODING ? VALUE_JSON_ENCODING : "fenel-value-json-v1") };
}

/** Called only after an explicit fenel-instance-json-v1 provenance marker. */
export function instanceFromJsonWire<T extends Record<string, unknown>>(instance: T, registry?: ModuleRegistry, iface?: Interface, encoding: InstanceJsonEncoding = "fenel-instance-json-v1"): T {
  if (!isInstanceJsonEncoding(encoding)) throw new TypeError("Unsupported instance encoding");
  const typeName = typeof instance.typeName === "string" ? instance.typeName : typeof instance.type === "string" ? instance.type : "";
  const args = Array.isArray(instance.args) ? instance.args : [];
  return { ...instance, methods: valueFromJsonWire(instanceMethodsValueType(typeName, args, registry, iface), instance.methods, registry, encoding === INSTANCE_JSON_ENCODING ? VALUE_JSON_ENCODING : "fenel-value-json-v1") };
}

/** Resolve aliases and erased wrappers without turning native values into ADTs. */
export function resolveValueType(type: FenelType, resolveType: (name: string) => FenelType | undefined = lookupValueType): FenelType {
  if ("$ref" in type && (type.$ref === "Any" || type.$ref === "Value" || type.$ref === "Bytes")) return type;
  const seen = new Set<string>();
  let current = type;
  while (!nativeValueTypeName(current)) {
    if ("$refined" in current) { current = current.$refined.base; continue; }
    if ("$tagged" in current) { current = current.$tagged.value; continue; }
    if (!("$ref" in current) || seen.has(current.$ref)) break;
    seen.add(current.$ref);
    const resolved = resolveType(current.$ref);
    if (!resolved) break;
    current = resolved;
  }
  return current;
}

export function variantValueDiscriminator(type: FenelType): string {
  let current = resolveValueType(type);
  const seen = new Set<FenelType>();
  while (!seen.has(current)) {
    seen.add(current);
    if ("$variant" in current) return current.$variant.discriminator ?? "$tag";
    if ("$opaque" in current && current.$opaque.pure) current = current.$opaque.pure;
    else if ("$mu" in current) current = current.$mu.body;
    else break;
  }
  return "$tag";
}

export function defaultValueForAuthoring(type: FenelType, registry?: DefaultRegistry, seen = new Set<FenelType>()): unknown {
  if (seen.has(type)) return null;
  const nextSeen = new Set(seen).add(type);
  const nestedDefault = (child: FenelType) => defaultValueForAuthoring(child, registry, nextSeen);
  const name = "$ref" in type ? type.$ref : "$opaque" in type ? type.$opaque.name : undefined;
  if (name && registry) {
    // rights R3a — GLOBAL_ONLY, DECLARED (brief §8.1b). Authoring surfaces hold
    // no frame to derive an account from; an account-authored `HasDefault` is
    // no longer consulted here until R3a-tail / R4 restore it.
    const methods = registry.resolve(name, "HasDefault", GLOBAL_ONLY);
    if (methods && Object.hasOwn(methods, "default")) return methods.default;
  }
  if (name === "Bytes") return new Uint8Array(0);
  const resolved = resolveValueType(type);
  if (resolved !== type) return nestedDefault(resolved);
  const nativeName = nativeValueTypeName(type);
  if (nativeName === "Rational") {
    // A2/B3 — GLOBAL_ONLY: this frameless stock default invokes the fixed
    // Fenel body without authority or perform; HasDefault was consulted above.
    const { dispatchEngineBody } = engineRequire("engine-bodies-dispatch") as typeof import("../engine-bodies-dispatch");
    const { withRuntimeRepresentationProjection } = engineRequire("json-logic") as typeof import("../json-logic");
    return withRuntimeRepresentationProjection({}, frame => dispatchEngineBody("std:rationalZero", [], frame));
  }
  if (nativeName) return DEFAULT_FOR_NAMED[nativeName];
  if ("$void" in type) return null;
  if ("$unit" in type) return null;
  if ("$ref" in type) return null;
  // Recognise Maybe/List/Result canonical and shorthand forms first so they
  // get their semantic defaults (Nothing / [] / Ok-of-ok) instead of the generic
  // $variant or $opaque fallbacks.
  if (peelMaybe(type)) return Nothing;
  if (peelList(type)) return [];
  {
    const result = peelResult(type);
    if (result) return { $tag: "Ok", _0: nestedDefault(result.ok) };
  }
  if ("$map" in type) return {};
  if ("$tuple" in type) return type.$tuple.map(nestedDefault);
  if ("$record" in type) {
    const out: Record<string, unknown> = {};
    for (const f of type.$record.fields) out[f.name] = nestedDefault(f.type);
    return out;
  }
  if ("$variant" in type) {
    const first = type.$variant.cases[0];
    if (!first) return null;
    const out: Record<string, unknown> = { [type.$variant.discriminator ?? "$tag"]: first.name };
    for (const f of first.fields ?? []) out[f.name] = nestedDefault(f.type);
    return out;
  }
  if ("$mu" in type) {
    const view = structuralView(type);
    if (!view || view.cases.length === 0) return null;
    const c = view.cases[0]!;
    const out: Record<string, unknown> = { [variantValueDiscriminator(type)]: c.name };
    for (const f of c.fields) {
      out[f.name] = f.isRecursive ? null : nestedDefault(f.type);
    }
    return out;
  }
  if ("$tagged" in type) return nestedDefault(type.$tagged.value);
  if ("$refined" in type) return nestedDefault(type.$refined.base);
  if ("$opaque" in type) return type.$opaque.pure ? nestedDefault(type.$opaque.pure) : null;
  if ("$union" in type) return type.$union[0] ? nestedDefault(type.$union[0]) : null;
  if ("$intersect" in type) {
    const values = type.$intersect.map(nestedDefault);
    return values.every((value) => value && typeof value === "object" && !Array.isArray(value))
      ? Object.assign({}, ...values) : values[0] ?? null;
  }
  // $arrow: empty string is "no callable selected yet" — the editor surfaces
  // it as a function picker. A picked function is stored as its codeName
  // (string); a partial appears as { call: [name, ...args] }.
  if ("$arrow" in type) return "";
  if ("$var" in type) return null;
  return null;
}
