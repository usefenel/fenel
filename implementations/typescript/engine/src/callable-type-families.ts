import {
  dispatchEngineBody,
  dispatchedCollectTypeNames,
  dispatchedSourceSyntaxToJsonLogic,
  marshalTraversalType,
} from "./engine-bodies-dispatch";
import { Nothing, Just } from "./type-foundation";
import type { EvaluateContext } from "./json-logic";
import type { FenelFunction, FenelType, FunctionSignatureInfo, Kind, TypeScheme } from "./types";
import { assertAcyclicAuthoringData } from "./authoring/json-value";

/** A reader's selected existing declaration; never a separately stored function. */
export type CallableTypeFamilyOwner = {
  readonly identity: string;
  readonly name: string;
  readonly type: FenelType;
  readonly ownerIdentity: string;
  readonly typeScheme?: TypeScheme;
  readonly parameterNames?: readonly string[];
};

type TypeMarker = { form: "type" | "arrow"; input?: TypeMarker; output?: TypeMarker };
type Projection = { names: string[]; parameterTypes: TypeMarker[]; body: unknown };
type Substitution = { path: string[]; index: number; application: boolean };
type ScanRoot = { path: string[]; scope: string[]; type: unknown };

function resultValue<T>(value: unknown): T {
  if (own(value, "$tag") === "Ok") return own(value, "_0") as T;
  if (own(value, "$tag") === "Err") throw new TypeError(String(own(value, "_0")));
  throw new TypeError("The type family source returned an unreadable result.");
}

/** B3: kind-to-Type policy is source-owned; this edge authors only $ keys. */
function kindType(marker: TypeMarker): FenelType {
  if (marker.form === "type") return { $type: true };
  return { $arrow: {
    params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: kindType(marker.input!), label: Nothing, ui: Nothing, meta: {} }],
    returns: kindType(marker.output!),
  } };
}

export function projectCallableTypeFamily(owner: CallableTypeFamilyOwner): {
  readonly fn: FenelFunction;
  readonly signature: FunctionSignatureInfo;
} | undefined {
  if (!owner.typeScheme?.quantified.length) return undefined;
  assertAcyclicAuthoringData(owner);
  // GLOBAL_ONLY: projection reads only this captured declaration and invokes
  // pure framework syntax factories; it neither selects an instance nor reads
  // another reader's registry. Invocation supplies the actual reader below.
  const decision = dispatchEngineBody("engine:typeFamilyProjection", [
    owner.identity, owner.typeScheme.quantified,
    owner.parameterNames === undefined ? Nothing : Just(owner.parameterNames),
  ]);
  if (own(decision, "$tag") === "Err") return undefined;
  const plan = resultValue<Projection>(decision);
  const params = plan.names.map((name, index) => ({
    name, key: { $tag: "PositionalField" as const, index }, type: kindType(plan.parameterTypes[index]!), label: Nothing, ui: Nothing, meta: {},
  }));
  const returns: FenelType = { $type: true };
  const body = dispatchedSourceSyntaxToJsonLogic(plan.body) as FenelFunction["body"];
  const fn: FenelFunction = { id: owner.identity, params, returns, body };
  const scheme: TypeScheme = { quantified: [], body: { $arrow: { params, returns } } };
  const source = { $tag: "Inferred" as const, engine: "type-family-projection", version: "1", derivation: owner.identity };
  return { fn, signature: {
    functionId: fn.id, scheme, params: params.map(() => source), returns: source,
    outcome: { $tag: "Solved" }, trust: { $tag: "Advisory", reason: "Callable projection of the existing declared type family." },
    implementationOrigin: { $tag: "FenelBody" },
  } };
}

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new TypeError("A type argument cannot contain accessors.");
  return descriptor.value;
}

function ownerKind(owner: CallableTypeFamilyOwner, ctx: EvaluateContext): unknown {
  const variables = owner.typeScheme?.quantified ?? [];
  return dispatchEngineBody("engine:typeFamilyKind", [variables.map(variable => variable.kind)], ctx);
}

/** Runtime reflection is a host boundary. The Fenel body decides every kind
 * relation; names/identities are read only through the exact current reader. */
export function callableTypeArgumentKind(value: unknown, ctx: EvaluateContext, depth = 0): unknown {
  if (depth > 64) return Nothing;
  assertAcyclicAuthoringData(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return Nothing;
  // The existing closure carrier has no authoritative parameter/result scheme.
  // Reflecting it cannot establish a Type-generator kind by running its body.
  if (own(value, "__fenelFn") === true) return Nothing;
  if (own(value, "__fenelPartial") === true) {
    const collected = own(value, "collected");
    if (!Array.isArray(collected)) return Nothing;
    const fn = own(value, "fn");
    const head = typeof fn === "string" ? { $ref: fn } : fn;
    return dispatchEngineBody("engine:typeFamilyApplyKind", [
      callableTypeArgumentKind(head, ctx, depth + 1),
      collected.map(argument => callableTypeArgumentKind(argument, ctx, depth + 1)),
    ], ctx);
  }
  const handle = own(value, "$ref");
  if (typeof handle === "string") {
    const owner = ctx._typeFamilyOwner?.(handle, ctx._sourceFunction);
    if (owner !== undefined) return Just(ownerKind(owner, ctx));
    const fn = ctx.getFunction?.(handle);
    if (fn === undefined) return Nothing;
    return dispatchEngineBody("engine:typeFamilyCallableKind", [
      marshalTraversalType({ $arrow: { params: fn.params, returns: fn.returns } }),
    ], ctx);
  }
  const type = value as FenelType;
  const facts = dispatchedCollectTypeNames(type).map(name => {
    const owner = ctx._typeFamilyOwner?.(name, ctx._sourceFunction);
    return { name, kind: owner === undefined ? Nothing : Just(ownerKind(owner, ctx)) };
  });
  return dispatchEngineBody("engine:typeFamilyStructuralKind", [marshalTraversalType(type), facts, []], ctx);
}

export function assertCallableTypeFamilyArguments(
  owner: CallableTypeFamilyOwner,
  args: readonly unknown[],
  ctx: EvaluateContext,
): Kind {
  return resultValue<Kind>(dispatchEngineBody("engine:typeFamilyArgumentCheck", [
    (owner.typeScheme?.quantified ?? []).map(variable => variable.kind),
    args.map(value => callableTypeArgumentKind(value, ctx)),
  ], ctx));
}

function atPath(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = own(value, key);
  return value;
}

/** B3: expose the existing reference/partial runtime carrier to source. */
function applicationHead(value: unknown, depth = 0): unknown {
  if (depth > 64) return { form: "unknown" };
  if (typeof value === "string") return { form: "reference", handle: value };
  const handle = own(value, "$ref");
  if (typeof handle === "string") return { form: "reference", handle };
  const collected = own(value, "collected");
  if (own(value, "__fenelPartial") === true && Array.isArray(collected)) return {
    form: "partial", target: applicationHead(own(value, "fn"), depth + 1), collected,
  };
  return { form: "unknown" };
}

/** B3: source-selected paths reattach to the original identified graph. */
function patch(value: unknown, path: readonly string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  if (value === null || typeof value !== "object") throw new TypeError("Invalid type-family substitution path.");
  const [key, ...rest] = path;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptor = descriptors[key!];
  if (!descriptor || !("value" in descriptor)) throw new TypeError("Invalid type-family substitution slot.");
  const next = patch(descriptor.value, rest, replacement);
  if (Array.isArray(value)) {
    const copy = value.slice();
    Object.defineProperty(copy, key!, { ...descriptor, value: next });
    return copy;
  }
  return Object.defineProperties(Object.create(Object.getPrototypeOf(value)), {
    ...descriptors, [key!]: { ...descriptor, value: next },
  });
}

/** Recognized nominal applications expand once from the SAME declaration.
 * This keeps peelEl from re-evaluating a family into the same application. */
export function expandCallableTypeFamily(
  type: FenelType,
  ctx: EvaluateContext,
): { readonly handled: false } | { readonly handled: true; readonly type: FenelType } {
  const expression = own(type, "$el");
  const call = own(expression, "call");
  if (!Array.isArray(call)) return { handled: false };
  if (typeof call[0] !== "string") {
    if (own(call[0], "__fenelPartial") !== true) return { handled: false };
    assertAcyclicAuthoringData(call);
    const plan = resultValue<{ handle: string; arguments: FenelType[] }>(dispatchEngineBody(
      "engine:typeFamilyApplicationHeadPlan", [applicationHead(call[0]), call.slice(1), 64], ctx,
    ));
    return { handled: true, type: { $el: { call: [plan.handle, ...plan.arguments] } } };
  }
  const owner = ctx._typeFamilyOwner?.(call[0], ctx._sourceFunction);
  if (!owner?.typeScheme?.quantified.length) return { handled: false };
  const args = call.slice(1);
  const remaining = assertCallableTypeFamilyArguments(owner, args, ctx);
  if (remaining.$tag !== "KType") throw new TypeError("A type family is not fully applied.");
  const scheme = owner.typeScheme;
  const roots: ScanRoot[] = [{ path: ["scheme", "body"], scope: [], type: marshalTraversalType(scheme.body) }];
  const applications = (scheme.applications ?? []).map(application => ({
    path: [...application.path], headVarId: application.headVarId ?? "", headRef: application.headRef ?? "",
    kind: application.kind, args: application.args.map(marshalTraversalType),
  }));
  for (;;) {
    const scan = dispatchEngineBody("engine:authoringGenericScanPlan", [roots, scheme.quantified, applications], ctx) as {
      ok: boolean; message: string; annotations: Array<{ path: string[]; scope: string[] }>;
    };
    if (!scan.ok) throw new TypeError(scan.message);
    if (scan.annotations.length === 0) break;
    for (const annotation of scan.annotations) roots.push({
      ...annotation, type: marshalTraversalType(atPath({ scheme }, annotation.path)),
    });
  }
  const plan = resultValue<Substitution[]>(dispatchEngineBody("engine:typeFamilySpecializationPlan", [
    roots, scheme.quantified, applications,
    owner.parameterNames === undefined ? Nothing : Just(owner.parameterNames),
  ], ctx));
  let graph: unknown = { scheme };
  // Resolve the declaration's own nominals before inserting argument graphs:
  // the caller's Type arguments must never be read in the owner's name frame.
  const nominalRoots: ScanRoot[] = [{ path: ["scheme", "body"], scope: [], type: marshalTraversalType(scheme.body) }];
  let nominalPlan: {
    annotations: Array<{ path: string[]; scope: string[] }>;
    occurrences: Array<{ path: string[]; name: string; identity: string }>;
  };
  for (;;) {
    nominalPlan = resultValue(dispatchEngineBody("engine:typeFamilyNominalScanPlan", [
      nominalRoots, scheme.quantified, scheme.nominals ?? [],
    ], ctx));
    if (nominalPlan.annotations.length === 0) break;
    for (const annotation of nominalPlan.annotations) nominalRoots.push({
      ...annotation, type: marshalTraversalType(atPath({ scheme }, annotation.path)),
    });
  }
  for (const occurrence of nominalPlan.occurrences) {
    const identity = ctx._typeFamilyNominalHandle?.(owner.ownerIdentity, occurrence.name, occurrence.identity);
    if (identity === undefined) throw new TypeError(`The type family's declared nominal ${occurrence.name} is unavailable in its owner scope.`);
    graph = patch(graph, occurrence.path, identity);
  }
  for (const change of plan) {
    const argument = args[change.index];
    const handle = own(argument, "$ref");
    graph = patch(graph, change.application ? change.path : change.path.slice(0, -1),
      change.application && typeof handle === "string" ? handle : argument);
  }
  return { handled: true, type: atPath(graph, ["scheme", "body"]) as FenelType };
}

import * as callableTypeFamiliesModule from "./callable-type-families";
import { registerEngineModule } from "./engine-require";
registerEngineModule("callable-type-families", callableTypeFamiliesModule);
