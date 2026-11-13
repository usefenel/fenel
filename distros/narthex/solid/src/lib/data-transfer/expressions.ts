import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { evaluate, invokeCallable, pureEvaluateContext, type EvaluateContext } from "@fenel/engine/expressions";
import { expectedSchemeForType, judgeAuthoringSchemeCompatibility, type AuthoringEnvironment, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { peelListForAuthoring, peelMaybeForAuthoring } from "@fenel/engine/authoring/type";
import { inferAuthoringExpression, peelToVariantType, recordFieldsForType, typeDisplayName, type ExprNode } from "@fenel/engine/authoring/expression";
import { validateValue } from "@fenel/engine/validation";
import { isFenelType, peelEl } from "@fenel/engine/dependent-types";
import { substituteTypeVars, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { expectedTypeForName } from "../expression-runner/creation-seed";
import { inlineWidgetFor } from "../expression-runner/inline-widgets";
import { literalMembershipAuthority, literalMembershipFor } from "../expression-runner/literal-membership";
import { classifyData, withinExpressionBudget } from "./data";
import { TransferError, TRANSFER_LIMITS, type TransferItem } from "./types";
import { receiverTypeCandidate } from "./type-candidate";
export { prepareTransferItem } from "./type-candidate";

const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const record = (fields: { name: string; value: ExprNode }[]): ExprNode => literal({ __record: { fields } });

/** Form validation may normalize a bare payload into Just even with input
 * parsers disabled. Only unchanged data is a membership fact; normalization
 * must be an explicit conversion in this adapter. Extra record fields remain
 * valid by width subtyping and are deliberately retained. */
function preservesValidatedData(value: unknown, checked: unknown): boolean {
  if (Object.is(value, checked)) return true;
  if (!value || !checked || typeof value !== "object" || typeof checked !== "object") return false;
  if (Array.isArray(value) || Array.isArray(checked)) return Array.isArray(value) && Array.isArray(checked)
    && value.length === checked.length && checked.every((entry, index) => preservesValidatedData(value[index], entry));
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(checked) || checked instanceof ArrayBuffer) {
    const bytes = (input: unknown) => input instanceof ArrayBuffer ? new Uint8Array(input)
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : undefined;
    const before = bytes(value), after = bytes(checked);
    return !!before && !!after && before.length === after.length && before.every((byte, index) => byte === after[index]);
  }
  return Object.keys(checked).every((key) => Object.hasOwn(value, key)
    && preservesValidatedData((value as Record<string, unknown>)[key], (checked as Record<string, unknown>)[key]));
}

/** Catalog rows are DISPLAY projections of a type; their records are keyless,
 * so they cannot carry the field identity the validator's semantic access plan
 * requires. The validator ranks a supplied definition ABOVE the registry, so an
 * unfiltered catalog map silently shadows the registry's identified definition
 * and its nested records stop validating ("invalid named field"). Only names
 * the registry does not identify may fall back to a catalog definition; every
 * name it owns resolves through the registry exactly as literalMembershipFor
 * already resolves it. */
function catalogDefinitions(
  environment: AuthoringEnvironment,
  registry?: ModuleRegistry,
): Record<string, FenelType> {
  const identified = (name: string) => registry?.getIdentifiedEntity(name)?.type
    ?? registry?.getIdentifiedEntity(`entity:${name}`)?.type;
  return Object.fromEntries(environment.catalog.types.flatMap((entry) => entry.type
    ? [entry.entityId ?? entry.name, entry.name]
      .filter((name) => identified(name) === undefined)
      .map((name) => [name, entry.type!] as const)
    : []));
}

function nativeScalarMembership(value: unknown, type: FenelType, environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext },
): boolean | undefined {
  if (!inlineWidgetFor(type, undefined, environment)?.scalarType) return undefined;
  // Keep the native name (Number/String and their refinements). Expanding its
  // identified mathematical definition here loses the native value carrier.
  const fact = literalMembershipFor(environment, options)(value, { quantified: [], body: type });
  return fact.$tag === "Just" && fact._0;
}

/** The kernel lowers list DATA to its canonical appendItem primitive. Detached
 * editors intentionally have no ambient bare function aliases; route only this
 * internally generated helper to the exact standard-library declaration.
 *
 * Tagged DATA is the same case one level down: a stored `{ $tag: "Just", … }`
 * reaches inference as its constructor's wire name, which a detached editor
 * does not resolve. A tag in data names a constructor, not an ambient alias,
 * so it binds to the one catalog constructor with that wire name. Two
 * constructors sharing the name leave it unresolved, as before; and a value
 * whose fields do not fit the constructor still fails inference. */
export function transferInferenceContext(environment: AuthoringEnvironment): AuthoringEnvironment {
  const append = environment.resolveFunctionId("std:appendItem") ?? environment.resolveFunctionId("std.appendItem");
  return { ...environment,
    getFunctionEntry: (id, arity) => id === "appendItem" && append
      ? environment.getFunctionEntry?.(append, arity) : environment.getFunctionEntry?.(id, arity),
    resolvePatternConstructor: (name, scrutineeTypeName, scrutineeOwnerIdentity) => {
      const direct = environment.resolvePatternConstructor?.(name, scrutineeTypeName, scrutineeOwnerIdentity)
        ?? { status: "missing" as const };
      if (direct.status !== "missing") return direct;
      const exact = dataConstructorTarget(environment, name);
      return exact === undefined ? direct
        : environment.resolvePatternConstructor?.(exact, scrutineeTypeName, scrutineeOwnerIdentity) ?? direct;
    },
  };
}

export function inferTransferExpression(node: ExprNode, environment: AuthoringEnvironment) {
  return inferAuthoringExpression(node, transferInferenceContext(environment));
}

/** The exact target of the one catalog constructor whose wire name is `tag`. */
function dataConstructorTarget(environment: AuthoringEnvironment, tag: string): string | undefined {
  const matches = environment.catalog.functions.filter((entry) => entry.kind === "constructor" && entry.codeName === tag);
  return matches.length === 1 ? matches[0]!.targetId ?? matches[0]!.id : undefined;
}

/** Data encoding, not inference: raw one-key objects can be calls in the wire.
 * Build those through the standard record function. Known safe native Images
 * and tagged data remain compact literals, including every original pixel. */
export function expressionForTransfer(item: TransferItem, environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext } = {},
): ExprNode {
  if (item.typeCandidate && !item.type) {
    const type = typeForTransfer(item, environment, options);
    return expressionForTransfer({ ...item, type, typeCandidate: undefined }, environment, options);
  }
  if (!["Image", "File", "Bytes"].includes(classifyData(item.value)) && !withinExpressionBudget(item.value)) {
    throw new TransferError("This value has too many items to edit at once. Copy a smaller part or import the original file.");
  }
  try { return expressionForData(item.value, environment, item.type ?? transferredType(item, environment, options)); }
  catch (error) {
    // A malformed or foreign discriminator is still copied data. It is not
    // permission to fabricate the missing constructor fields or its type.
    if (isRecord(item.value) && typeof item.value.$tag === "string") return literal(item.value);
    throw error;
  }
}

export function transferredType(item: TransferItem, environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext } = {},
): FenelType | undefined {
  if (item.type) return item.type;
  if (options.registry && options.evaluateContext) {
    const policy = options.registry.getFunction("view.tabExternalTransferType");
    if (policy) {
      // The shared Fenel source classifies actual decoder output; this boundary
      // transports only its exact repository declaration identity. File does
      // not inherit a same-named account or integration declaration.
      const declaration = invokeCallable({ $ref: options.registry.getUuid(policy.id) ?? policy.id },
        [item], options.evaluateContext) as { $tag: "Nothing" } | { $tag: "Just"; _0: { owner: string; name: string } };
      if (declaration.$tag === "Just") {
        const handle = options.registry.getTypeUuid(declaration._0.owner, declaration._0.name);
        if (!handle) throw new TransferError("The pasted data's standard type is unavailable in this reader.");
        return { $ref: handle };
      }
    }
  }
  if (item.source === "fenel" && isRecord(item.value) && typeof item.value.$tag === "string") return undefined;
  const actualName = classifyData(item.value);
  // A sender cannot turn a Number into a String or an arbitrary record into
  // Image merely by naming it so. Sender metadata carries no type authority.
  const typeName = item.source === "fenel" ? actualName : item.typeName;
  // The catalog's File/List/Record rows are generic presentation categories.
  // They are not evidence that a structural value has a new nominal identity.
  if (["File", "List", "Record"].includes(typeName)) return undefined;
  if (typeName === "Markup") {
    const declaration = environment.catalog.functions.find((entry) => entry.kind === "constructor"
      && entry.parentModule === "templates" && entry.parentEntity === "Markup");
    return declaration ? declaration.returns : expectedTypeForName("Markup", environment);
  }
  return expectedTypeForName(typeName, environment);
}

/** Marshal the existing source's optional occurrence names in this reader. */
export function transferCaptions(items: readonly TransferItem[],
  options: { registry: ModuleRegistry; evaluateContext: EvaluateContext },
): Array<string | undefined> {
  const policy = options.registry.getFunction("view.tabExternalTransferCaptions");
  if (!policy) throw new TransferError("The pasted data's naming policy is unavailable in this reader.");
  const captions = invokeCallable({ $ref: options.registry.getUuid(policy.id) ?? policy.id },
    [items], options.evaluateContext) as Array<Maybe<string>>;
  return captions.map(caption => (peelMaybeValue(caption) ?? undefined) as string | undefined);
}

/** Ask the same authoring kernel used by the editor for structural imported
 * values. Do not infer millions of Image fields when its declared type exists. */
export function typeForTransfer(item: TransferItem, environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext } = {},
): FenelType | undefined {
  if (item.typeCandidate) {
    const sourceType = receiverTypeCandidate(item, environment, options.registry);
    if (!sourceType) throw new TransferError("The original copied type could not be verified here.");
    const concrete = scopedConcreteType(sourceType, options.evaluateContext, environment, options.registry);
    if (!concrete) throw new TransferError("The original copied type could not be resolved for this data.");
    const selected = "$ref" in concrete ? options.registry?.getIdentifiedEntity(concrete.$ref)?.type
      ?? environment.resolveTypeRef?.(concrete) ?? concrete : concrete;
    let valid = false;
    try {
      const native = nativeScalarMembership(item.value, sourceType, environment, options);
      const checked = native === undefined ? validateValue(selected, item.value, null, {
        registry: options.registry, functions: options.evaluateContext ?? {}, coerce: false,
        $defs: catalogDefinitions(environment, options.registry),
        strict: { primitiveTypes: true, rejectAdded: false, rejectOmitted: true },
      }) : undefined;
      valid = native ?? (!!checked?.valid && preservesValidatedData(item.value, checked.value));
    } catch { /* Preserve the value and report an unproven source type. */ }
    if (!valid) {
      const expression = expressionForData(item.value, environment, sourceType);
      const actual = inferTransferExpression(expression, environment);
      const wanted = expectedSchemeForType(sourceType, environment);
      valid = !!actual.scheme && actual.outcome.$tag === "Solved" && wanted !== undefined
        && judgeAuthoringSchemeCompatibility(actual.scheme, wanted, { registry: options.registry }) === "compatible";
    }
    if (!valid) throw new TransferError("The copied value does not satisfy its original type here.");
    return sourceType;
  }
  if (!item.type && isRecord(item.value) && typeof item.value.$tag === "string"
    && (item.source === "fenel" || (item.source === "json" && item.typeName === "Record"))) return undefined;
  const declared = transferredType(item, environment, options);
  // Scalar carriers and a decoded native canvas have concrete representation
  // facts. A discriminator spelling alone does not prove an ADT: check its
  // complete constructor expression through the same inference kernel.
  if (declared && !(isRecord(item.value) && typeof item.value.$tag === "string")) return declared;
  const largeList = Array.isArray(item.value) && item.value.length > 16;
  const candidate = largeList ? { ...item, value: (item.value as unknown[]).slice(0, 16) } : item;
  const result = inferTransferExpression(expressionForTransfer(candidate, environment), environment);
  if (result.outcome.$tag !== "Solved" || !result.type) return undefined;
  if (largeList) {
    // The kernel proposes a type from a bounded prefix; only its existing
    // strict validator over the ENTIRE original list may establish that type.
    // A late incompatible member never inherits the prefix's type.
    const concrete = scopedConcreteType(result.type, options.evaluateContext, environment, options.registry);
    if (!concrete || result.scheme?.quantified.length) return undefined;
    try {
      const checked = validateValue(concrete, item.value, null, {
        registry: options.registry, functions: options.evaluateContext ?? {}, coerce: false,
        strict: { primitiveTypes: true, rejectAdded: false, rejectOmitted: true },
      });
      if (!checked.valid || !preservesValidatedData(item.value, checked.value)) return undefined;
    } catch { return undefined; }
  }
  if (isRecord(item.value) && typeof item.value.$tag === "string") {
    const resolved = scopedConcreteType(result.type, options.evaluateContext, environment, options.registry);
    if (!resolved) return undefined;
    const selected = "$ref" in resolved ? options.registry?.getIdentifiedEntity(resolved.$ref)?.type
      ?? environment.resolveTypeRef?.(resolved) ?? resolved : resolved;
    try {
      const checked = validateValue(selected, item.value, null, {
        registry: options.registry, functions: options.evaluateContext ?? {}, coerce: false,
        $defs: catalogDefinitions(environment, options.registry),
        strict: { primitiveTypes: true, rejectAdded: false, rejectOmitted: true },
      });
      if (!checked.valid || !preservesValidatedData(item.value, checked.value)) return undefined;
    } catch { return undefined; }
  }
  return result.type;
}

function constructorFor(
  tag: string,
  type: FenelType | undefined,
  environment: AuthoringEnvironment,
): AuthoringCatalogFunctionEntry | undefined {
  if (!type) return undefined;
  const application = "$el" in type && type.$el && typeof type.$el === "object" && "call" in type.$el && Array.isArray(type.$el.call)
    ? type.$el.call : undefined;
  const owner = typeDisplayName(type, environment)
    ?? (typeof application?.[0] === "string" ? application[0] : undefined)
    ?? (peelMaybeForAuthoring(type) ? "Maybe" : undefined);
  const pattern = environment.resolvePatternConstructor?.(tag, owner);
  if (pattern?.status === "resolved") {
    const entry = environment.getFunctionEntry?.(pattern.targetId);
    if (entry?.kind === "constructor") return entry as AuthoringCatalogFunctionEntry;
  }
  const candidates = environment.catalog.functions.filter((entry) => entry.kind === "constructor"
    && entry.parentEntity === owner
    && (entry.codeName === tag || entry.label === tag || entry.targetId?.endsWith(`/${tag}`))
    && !!environment.resolveConstructorTarget?.(entry.targetId ?? entry.id));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function expressionForData(value: unknown, environment: AuthoringEnvironment, type?: FenelType, depth = 0): ExprNode {
  if (depth > TRANSFER_LIMITS.depth || value === undefined || value === null) throw new TransferError("Only completed values can be inserted.");
  if (typeof value === "boolean") {
    const constructor = constructorFor(value ? "True" : "False", type ?? expectedTypeForName("Boolean", environment), environment);
    if (constructor && constructor.params.length === 0) return { kind: "call", fnId: constructor.targetId ?? constructor.id, args: [] };
  }
  if (typeof value !== "object") return literal(value);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return literal(value);
  const object = !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (object && typeof object.$tag === "string") {
    const constructor = constructorFor(object.$tag, type, environment);
    const fields = type ? peelToVariantType(type, environment)?.cases.find((entry) => entry.name === object.$tag)?.fields ?? constructor?.params : undefined;
    if (constructor && fields && Object.keys(object).every((key) => key === "$tag" || fields.some((field) => field.name === key))) {
      return { kind: "call", fnId: constructor.targetId ?? constructor.id, args: fields.map((field) => expressionForData(object[field.name], environment, field.type, depth + 1)) };
    }
    // Runtime tagged values are a data boundary; their stored payload is never
    // executed or treated as the expression editor's internal marker objects.
    return literal(value);
  }
  if (safeLiteral(value)) return literal(value);
  if (Array.isArray(value)) {
    const element = type ? peelListForAuthoring(resolveShape(type, environment))?.elem : undefined;
    return literal({ __list: value.map((child) => expressionForData(child, environment, element, depth + 1)) });
  }
  const fields = type ? recordFieldsForType(type, environment) : undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const mapped = entries.map(([name, child]) => ({ name, value: expressionForData(child, environment, fields?.find((field) => field.name === name)?.type, depth + 1) }));
  if (entries.length !== 1 && !entries.some(([name]) => name.startsWith("__") || name.startsWith("$"))) return record(mapped);
  const fnId = environment.resolveFunctionId("std:fromEntries") ?? environment.resolveFunctionId("std.fromEntries");
  if (!fnId) throw new TransferError("Record construction is unavailable while the editing tools are loading. Try again when they are ready.");
  return {
    kind: "call", fnId, callSyntax: "call",
    args: [literal({ __list: mapped.map((field) => record([
      { name: "key", value: literal(field.name) },
      { name: "value", value: field.value },
    ])) })],
  };
}

/** The wire's tagged-data boundary preserves its entire subtree. Otherwise
 * avoid all one-key records, reserved editor envelopes and special $ records. */
function safeLiteral(value: unknown): boolean {
  if (!value || typeof value !== "object") return value !== null && value !== undefined;
  if (Array.isArray(value)) return value.every(safeLiteral);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true;
  const object = value as Record<string, unknown>;
  if (typeof object.$tag === "string") return true;
  const entries = Object.entries(object);
  return entries.length !== 1 && entries.every(([name, child]) => !name.startsWith("__") && !name.startsWith("$") && safeLiteral(child));
}

function projectedTypeApplication(type: FenelType, environment?: AuthoringEnvironment, registry?: ModuleRegistry): FenelType | undefined {
  if (!environment || !("$el" in type) || !type.$el || typeof type.$el !== "object" || !("call" in type.$el) || !Array.isArray(type.$el.call)) return undefined;
  const [head, ...arguments_] = type.$el.call;
  if (typeof head !== "string") return undefined;
  const declaration = expectedSchemeForType({ $ref: head }, environment);
  const application = declaration?.applications?.find((entry) => entry.path.length === 0 && entry.headRef === head);
  if (!application || application.args.length !== arguments_.length || !application.args.every((argument) => "$var" in argument)) return undefined;
  const template = registry?.getIdentifiedEntity(head)?.type
    ?? environment.resolveTypeRef?.({ $ref: head }) ?? environment.resolveNamedType?.(head);
  if (!template || "$el" in template) return undefined;
  if (!arguments_.every((argument) => argument && typeof argument === "object" && !Array.isArray(argument))) return undefined;
  // This is the engine's existing parameter substitution over its own generic
  // declaration. It selects the presentation/runtime shape; the complete
  // authoritative scheme still decides compatibility below.
  return substituteTypeVars(template, Object.fromEntries(application.args.map((argument, index) => [
    (argument as { $var: string }).$var, arguments_[index] as FenelType,
  ])));
}

export function scopedConcreteType(type: FenelType, evaluateContext?: EvaluateContext, environment?: AuthoringEnvironment,
  registry?: ModuleRegistry, values: Record<string, unknown> = {}): FenelType | undefined {
  if ("$refined" in type) {
    const base = scopedConcreteType(type.$refined.base, evaluateContext, environment, registry, values);
    return base ? { $refined: { ...type.$refined, base } } : undefined;
  }
  let current: FenelType = type;
  for (let depth = 0; "$el" in current && depth < 32; depth++) {
    const projected = projectedTypeApplication(current, environment, registry);
    if (projected) { current = projected; continue; }
    if (!evaluateContext) return peelEl(current, values);
    // The existing peelEl bridge currently selects its private harness instead
    // of the supplied evaluator. Type-valued functions must resolve in the
    // destination's own frozen registry, just like ordinary function calls.
    let result: unknown;
    try { result = evaluate(current.$el, values, pureEvaluateContext(evaluateContext)); } catch { return undefined; }
    if (!isFenelType(result)) return undefined;
    current = result;
  }
  return "$el" in current ? undefined : current;
}

export function transferContainerShape(type: FenelType, environment: AuthoringEnvironment,
  evaluateContext?: EvaluateContext | (() => EvaluateContext | undefined), registry?: ModuleRegistry): FenelType {
  let current = type;
  const seen = new Set<FenelType>();
  for (let depth = 0; depth < 32 && !seen.has(current); depth++) {
    seen.add(current);
    if ("$refined" in current) { current = current.$refined.base; continue; }
    if ("$el" in current) {
      // B4 wave 4 lane S: a lazy frame is read only here, for a dependent
      // type, and only after the environment's own type-application
      // projection (which needs no frame) declined. A lazy frame that answers
      // none then leaves the type undecided (never the harness's `peelEl`).
      if (typeof evaluateContext === "function") {
        const projected = projectedTypeApplication(current, environment, registry);
        if (projected) { current = projected; continue; }
      }
      const frame = typeof evaluateContext === "function" ? evaluateContext() : evaluateContext;
      if (typeof evaluateContext === "function" && frame === undefined) return current;
      const next = scopedConcreteType(current, frame, environment, registry);
      if (next) { current = next; continue; }
      return current;
    }
    if ("$ref" in current) {
      // These native carriers must not turn into their mathematical list form.
      if (["String", "Char"].includes(current.$ref)) return current;
      const next = environment.resolveTypeRef?.(current) ?? environment.resolveNamedType?.(current.$ref);
      if (next) { current = next; continue; }
    }
    return current;
  }
  return current;
}

const resolveShape = transferContainerShape;

export type TransferTargetOptions = {
  type?: FenelType;
  expectedScheme?: TypeScheme;
  typeName?: string;
  currentValue?: unknown;
  environment: AuthoringEnvironment;
  registry?: ModuleRegistry;
  evaluateContext?: EvaluateContext;
  /** Container targets append by default; a field/input can request replacement. */
  mode?: "append" | "replace";
};

/** `appended` is set when the transfer only added items to a list: their own
 *  expressions, so a host can append them to the list's authored expression
 *  instead of replacing it with a snapshot that turns its references into
 *  copies. `expr` still describes the whole combined value. */
export type AdaptedTransfer = { expr: ExprNode; value: unknown; typeName?: string; type?: FenelType; appended?: ExprNode[] };

/** One mechanism for root values, fields, lists and constructor payloads.
 * Membership stays with the existing engine; a failure leaves the caller's
 * current value untouched and tells it to present the recoverable error. */
export function adaptTransferToTarget(items: readonly TransferItem[], options: TransferTargetOptions): AdaptedTransfer {
  if (items.length === 0) throw new TransferError("There is no value to insert.");
  const type = options.expectedScheme?.body ?? options.type;
  const environment = options.environment;
  items = items.map((item) => item.typeCandidate ? { ...item,
    type: typeForTransfer(item, environment, options), typeCandidate: undefined,
  } : item);
  if (!type) {
    if (Array.isArray(options.currentValue) && options.mode !== "replace") {
      const incoming = items.flatMap((item) => Array.isArray(item.value) ? item.value : [item.value]);
      const value = [...options.currentValue, ...incoming];
      const candidate: TransferItem = { value, typeName: "List", source: "fenel" };
      const inferred = typeForTransfer(candidate, environment, options);
      if (!inferred) throw new TransferError("This list's element type could not be verified. Choose its type before adding these items; its contents have been kept.");
      return { value, expr: expressionForTransfer(candidate, environment, options), typeName: "List", type: inferred,
        appended: incoming.map((element) => expressionForTransfer({ value: element, typeName: classifyData(element), source: "fenel" }, environment, options)) };
    }
    if (items.length !== 1) throw new TransferError("This slot holds one value. Paste the files into a list or your account's data.");
    return { value: items[0]!.value, expr: expressionForTransfer(items[0]!, environment), typeName: items[0]!.typeName, type: typeForTransfer(items[0]!, environment, options) };
  }
  const shape = resolveShape(type, environment, options.evaluateContext, options.registry);
  const list = peelListForAuthoring(shape);
  if ("$el" in shape && Array.isArray(options.currentValue) && options.mode !== "replace") {
    throw new TransferError("This list's declared type could not be resolved for the current data. Its contents have been kept.");
  }
  const maybe = peelMaybeForAuthoring(shape);
  const maybeField = maybe ? peelToVariantType(shape, environment)?.cases.find((entry) => entry.name === "Just")?.fields?.[0] : undefined;
  const typeName = options.typeName ?? typeDisplayName(type, environment);
  const expectedScheme = options.expectedScheme ?? expectedSchemeForType(type, environment);
  function kernelFits(value: unknown, expected: FenelType): boolean {
    if (!withinExpressionBudget(value)) return false;
    try {
      const candidate = inferTransferExpression(expressionForData(value, environment, expected), environment);
      const wanted = expected === type ? expectedScheme : expectedSchemeForType(expected, environment);
      return !!candidate.scheme && candidate.outcome.$tag === "Solved" && wanted !== undefined
        && judgeAuthoringSchemeCompatibility(candidate.scheme, wanted, { registry: options.registry }) === "compatible";
    } catch { return false; }
  }
  const valueMatches = (value: unknown, expected: FenelType): boolean => {
    try {
      const native = nativeScalarMembership(value, expected, environment, options);
      if (native !== undefined) return native;
      const widget = inlineWidgetFor(expected, undefined, environment);
      if (expected === type && options.expectedScheme && options.registry && (!widget || widget.kind === "field")) {
        // B3: preserve the root slot's captured owner, including a source name
        // shared by another module. Nested slots retain their existing checks.
        const verdict = options.registry.callSiteTyping.member(options.expectedScheme, value, null, options.evaluateContext);
        if (verdict === "yes") return true;
        if (verdict === "no") return false;
        // Keep the existing guarded fallback after an abstention. A missing
        // captured owner cannot become a fact from a same-named declaration;
        // validation below still requires an unchanged data representation.
        if (!literalMembershipAuthority(options.expectedScheme, environment, options)) return false;
      }
      const concrete = scopedConcreteType(expected, options.evaluateContext, environment, options.registry);
      if (!concrete) return false;
      const selected = "$ref" in concrete
        ? options.registry?.getIdentifiedEntity(concrete.$ref)?.type ?? environment.resolveTypeRef?.(concrete) ?? concrete : concrete;
      // Validate the actual declared representation even when the incoming
      // value is scalar. A generic named/applicated type can project to an
      // undecided broad SetExpr; that is not evidence that a Number is Maybe.
      const checked = validateValue(selected, value, null, {
        registry: options.registry, functions: options.evaluateContext, coerce: false,
        strict: { primitiveTypes: true, rejectAdded: false, rejectOmitted: true },
      });
      return checked.valid && preservesValidatedData(value, checked.value);
    } catch { return false; }
  };
  function convert(item: TransferItem, expected: FenelType): unknown {
    const targetShape = resolveShape(expected, environment, options.evaluateContext, options.registry);
    const targetMaybe = peelMaybeForAuthoring(targetShape);
    const targetList = peelListForAuthoring(targetShape);
    const sourceScheme = item.type ? expectedSchemeForType(item.type, environment) : undefined;
    const targetScheme = expected === type ? expectedScheme : expectedSchemeForType(expected, environment);
    const incompatibleOwner = sourceScheme && targetScheme
      && judgeAuthoringSchemeCompatibility(sourceScheme, targetScheme, { registry: options.registry }) === "incompatible";
    // A generic optional field validator can accept a bare form payload. A
    // Fenel Maybe value still requires its constructor; do that conversion
    // explicitly rather than publishing the unwrapped form input.
    const hasCarrier = (!targetMaybe || isRecord(item.value) && ["Nothing", "Just"].includes(String(item.value.$tag)))
      && (!targetList || Array.isArray(item.value));
    if (hasCarrier && !incompatibleOwner && valueMatches(item.value, expected)) return item.value;
    if (!targetMaybe && !targetList && item.text !== undefined && valueMatches(item.text, expected)) return item.text;
    if (targetMaybe) {
      const just = peelToVariantType(targetShape, environment)?.cases.find((entry) => entry.name === "Just");
      const field = just?.fields?.[0];
      if (field) {
        if (item.typeName === "JsonValue" && isRecord(item.value) && item.value.$tag === "JsonNull") return { $tag: "Nothing" };
        const candidate = { $tag: "Just", [field.name]: item.value };
        // A bare Maybe's payload variable is bound by its actual constructor
        // scheme. The shared inference kernel can specialize it from this data.
        if (valueMatches(candidate, expected) || kernelFits(candidate, expected)) return candidate;
        const payload = convert(item, targetMaybe.value);
        const wrapped = { $tag: "Just", [field.name]: payload };
        if (valueMatches(wrapped, expected)) return wrapped;
      }
    }
    if (targetList && Array.isArray(item.value)) {
      const sourceElement = item.type ? peelListForAuthoring(resolveShape(item.type, environment, options.evaluateContext, options.registry))?.elem : undefined;
      const values = item.value.map((value) => convert({ ...item, value, type: sourceElement, typeName: classifyData(value), text: undefined }, targetList.elem));
      if (valueMatches(values, expected)) return values;
    }
    if (!targetMaybe && !targetList) {
      const cases = peelToVariantType(targetShape, environment)?.cases.filter((entry) => entry.fields?.length === 1) ?? [];
      const fitting: unknown[] = [];
      for (const entry of cases) {
        const field = entry.fields![0]!;
        // Self-recursive single-field cases need an explicit constructor choice.
        if (field.type === expected || field.type === targetShape || ("$ref" in field.type && field.type.$ref === typeDisplayName(expected, environment))) continue;
        try {
          const wrapped = { $tag: entry.name, [field.name]: convert(item, field.type) };
          if (valueMatches(wrapped, expected) || kernelFits(wrapped, expected)) fitting.push(wrapped);
        } catch { /* Other constructors may accept the value. */ }
      }
      if (fitting.length === 1) return fitting[0];
      if (fitting.length > 1) throw new TransferError("More than one constructor accepts this value. Choose a constructor, then paste into its field.");
    }
    throw new TransferError(`This value does not fit ${typeDisplayName(expected, environment) ?? "the destination type"}. Choose a compatible field or paste it into your account's data.`);
  }
  let value: unknown;
  let appended: ExprNode[] | undefined;
  if (list) {
    const incoming = items.flatMap((item) => Array.isArray(item.value)
      ? item.value.map((value) => convert({ ...item, value,
        type: item.type ? peelListForAuthoring(resolveShape(item.type, environment, options.evaluateContext, options.registry))?.elem : undefined,
        typeName: classifyData(value), text: undefined }, list.elem))
      : [convert(item, list.elem)]);
    if (options.mode !== "replace" && options.currentValue !== undefined && !Array.isArray(options.currentValue)) {
      throw new TransferError("Wait for this list's value before adding items, or paste into an empty list.");
    }
    value = [...(options.mode === "replace" ? [] : Array.isArray(options.currentValue) ? options.currentValue : []), ...incoming];
    if (options.mode !== "replace" && Array.isArray(options.currentValue)) {
      appended = incoming.map((element) => expressionForData(element, environment, list.elem));
    }
  } else if (maybe && maybeField && options.mode !== "replace" && isRecord(options.currentValue) && options.currentValue.$tag === "Just"
    && (Array.isArray(options.currentValue[maybeField.name]) || isRecord(options.currentValue[maybeField.name]))
    && !items.some((item) => isRecord(item.value) && ["Just", "Nothing", "JsonNull"].includes(String(item.value.$tag)))) {
    const field = maybeField;
    const currentPayload = options.currentValue[field.name];
    const payloadType = "$var" in maybe.value ? typeForTransfer({ value: currentPayload, typeName: classifyData(currentPayload), source: "fenel" }, environment, options) : maybe.value;
    const nested = adaptTransferToTarget(items, { ...options, type: payloadType, expectedScheme: undefined, typeName: undefined, currentValue: currentPayload });
    value = { ...options.currentValue, [field.name]: nested.value };
  } else {
    if (items.length !== 1) throw new TransferError(`This ${typeName} holds one value. Paste multiple files into a list or your account's data.`);
    const item = items[0]!;
    // A record container can fill several of its fields in one paste while
    // retaining existing fields. Field-level targets still replace normally.
    if (!maybe && options.mode !== "replace" && recordFieldsForType(type, environment)
      && isRecord(options.currentValue) && isRecord(item.value) && !("$tag" in item.value)) {
      const merged = Object.assign(Object.create(null), options.currentValue, item.value) as Record<string, unknown>;
      value = valueMatches(merged, type) ? merged : convert(item, type);
    } else value = convert(item, type);
  }
  if (!valueMatches(value, type) && !kernelFits(value, type)) throw new TransferError(`The combined value does not fit ${typeName ?? "the destination type"}. Its existing contents have been kept.`);
  return { value, expr: expressionForData(value, environment, type), typeName, type, ...(appended ? { appended } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
