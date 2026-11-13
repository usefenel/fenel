import { ownDataRead, type AuthoringInvocationContract, type EvaluateContext } from "@fenel/engine/expressions";
import { judgeAuthoringSchemeCompatibility, projectAuthoringScheme, type AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { snapshotAuthoringSchemeTransport } from "@fenel/engine/inference-transport";
import { dispatchEngineBody, marshalStoredBodyForValidation } from "@fenel/engine/engine-bodies-dispatch";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { SetExpr } from "@fenel/engine/types";
import { frameAccount } from "@fenel/engine/authority";
import { contains } from "@fenel/engine/set-algebra";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { literalMembershipFor } from "./literal-membership";
import { savedExpressionDeclaration } from "../saved-expression-map";

/** A2/B3: retain the reader-owned declarations observed by canonical lowering.
 * No contract is stored on a Fenel value, and no host callable enters data.
 * Admission uses the existing Fenel membership/validation owners exclusively. */
export function authoringInvocationAdmission(environment: AuthoringEnvironment, registry: ModuleRegistry,
  base: EvaluateContext, enabled = false, entrypoint?: ExprNode): { observe: (node: ExprNode, logic: unknown) => void;
    required: () => boolean; hooks: NonNullable<EvaluateContext["_authoringInvocation"]> } {
  let active = enabled;
  let pending = false;
  const sources = new WeakMap<object, { scheme: TypeScheme; callable: boolean; unavailable?: unknown }>();
  const named = new Map<string, TypeScheme>();
  const callSites = new WeakMap<object, AuthoringInvocationContract>();
  const unavailableCalls = new WeakSet<object>();
  const values = new WeakMap<object, AuthoringInvocationContract>();
  // Recipes card (Nov 11): a bare function reference takes its declared arrow
  // only when this reader's own lowering wrote it or one of its own
  // expressions produced it. The same reference inside a registered body, a
  // native or a reflective reader belongs to that definition's checked code:
  // admitting it there re-judged library-internal data (a whole recipe
  // snapshot) at every call, so a Local card with a declared recipe never
  // finished, or refused when such a check was unavailable.
  const authoredLogic = new WeakSet<object>();
  const authoredReferences = new WeakSet<object>();
  const isFunctionReference = (value: unknown, context: Pick<EvaluateContext, "getFunction">): value is object => {
    if (value === null || typeof value !== "object") return false;
    const reference = ownDataRead(value, "$ref");
    return reference.found && typeof reference.value === "string" && context.getFunction?.(reference.value) !== undefined;
  };
  const declarations = new WeakMap<TypeScheme, Pick<EvaluateContext, "_importStack" | "_sourceFunction">>();
  const expanded = new WeakMap<TypeScheme, { arrow: TypeScheme; frame: Pick<EvaluateContext, "_importStack" | "_sourceFunction">;
    guards: Array<{ set: SetExpr; frame: Pick<EvaluateContext, "_importStack" | "_sourceFunction"> }> }>();
  const ground = (scheme: TypeScheme) => dispatchEngineBody("engine:authoringInvocationGroundScheme", [marshalStoredBodyForValidation(scheme)]) === true;
  const namedScheme = (id: string): TypeScheme | undefined => {
    const entry = environment.getFunctionEntry?.(id);
    if (entry?.signatureOutcome?.$tag === "Solved" && entry.scheme && ground(entry.scheme)) return entry.scheme;
    const spec = base.getFunction?.(entry?.targetId ?? id);
    const declaration = spec?.signatureDeclaration;
    const scheme = declaration?.scheme;
    if (!spec || !declaration || !scheme || dispatchEngineBody("engine:authoringInvocationHasDeclaration", [marshalStoredBodyForValidation(declaration)]) !== true
      || !ground(scheme)) return undefined;
    if (scheme.nominals?.length) return snapshotAuthoringSchemeTransport(scheme);
    const resolved = base._callSiteTyping?.resolveType(scheme.body, spec.id);
    return resolved?.ok ? resolved.type : undefined;
  };
  const valueContract = (value: unknown): AuthoringInvocationContract | undefined => {
    if (!active) return undefined;
    if (value === null || typeof value !== "object") return undefined;
    const retained = values.get(value);
    if (retained) return retained;
    if (!authoredReferences.has(value)) return undefined;
    const reference = ownDataRead(value, "$ref");
    if (!reference.found || typeof reference.value !== "string") return undefined;
    const spec = base.getFunction?.(reference.value);
    const scheme = spec && namedScheme(spec.id);
    if (!spec || !scheme) return undefined;
    const lexical = base.getFunctionImportFrame?.(spec.id);
    declarations.set(scheme, { ...(lexical ? { _importStack: [lexical] } : {}), _sourceFunction: spec.id });
    return { scheme, argumentOffset: 0 };
  };
  const resolve = (type: FenelType): TypeScheme => {
    const layer = dispatchEngineBody("engine:authoringInvocationTypeLayer", [marshalStoredBodyForValidation(type)]) as {
      kind: string; reference: string;
    };
    if (layer.kind === "reference") {
      const owner = base._typeFamilyOwner?.(layer.reference, base._sourceFunction);
      const scope = owner && (base as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
        owner: string; names: Readonly<Record<string, string>>; aliases?: Readonly<Record<string, string>>; sourceFunction?: string;
      } | undefined })._typeDeclarationScope?.(owner.ownerIdentity);
      const declaration = owner && scope && base._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity);
      if (!owner || !scope || !declaration?.ok) throw new Error("This function's declared type is unavailable in this reader.");
      // B3: keep the declared reference and its authenticated root owner.
      // arrow() closes the actual owned declaration and retains all of its
      // parameter/result sidecars under this same reader's declaration frame.
      return snapshotAuthoringSchemeTransport({ quantified: declaration.type.quantified, body: type,
        nominals: [{ path: [], identity: owner.ownerIdentity, publicName: layer.reference }],
      });
    }
    const resolved = base._callSiteTyping?.resolveType(type, base._sourceFunction);
    if (!resolved?.ok) throw new Error("This function's declared type is unavailable in this reader.");
    return resolved.type;
  };
  const observe = (node: ExprNode, logic: unknown) => {
    if (logic !== null && typeof logic === "object") {
      authoredLogic.add(logic);
      if (isFunctionReference(logic, base)) authoredReferences.add(logic);
    }
    const declaration = savedExpressionDeclaration(node);
    if (declaration) {
      let scheme: TypeScheme;
      let unavailable: unknown;
      try { scheme = declaration.scheme ?? resolve(declaration.type!); }
      catch (error) { scheme = { quantified: [], body: declaration.type! }; unavailable = error; pending = true; }
      // Snapshot the complete transport, including nominal/application sidecars.
      const captured = snapshotAuthoringSchemeTransport(scheme);
      let callable = false;
      try { callable = arrow(captured) !== undefined; } catch (error) { unavailable = error; pending = true; }
      if (callable) active = true;
      if (logic === null || typeof logic !== "object") {
        if (callable) throw new Error("This saved function no longer evaluates to a callable value.");
      } else {
        const previous = sources.get(logic);
        if (previous && (previous.callable || callable)) {
          for (const match of [judgeAuthoringSchemeCompatibility(previous.scheme, captured, { registry }),
            judgeAuthoringSchemeCompatibility(captured, previous.scheme, { registry })]) {
            const verdict = dispatchEngineBody("engine:authoringInvocationCallableMembership", [match]);
            const issue = dispatchEngineBody("engine:authoringInvocationMembershipIssue", [verdict, "saved alias declaration"]) as { $tag: string; _0?: string };
            if (issue.$tag === "Just") throw new Error(issue._0);
          }
        } else if (!previous) {
          sources.set(logic, { scheme: captured, callable, unavailable });
        }
      }
    }
    if (node.kind !== "call" || (node !== entrypoint && !declaration)) return;
    const entry = environment.getFunctionEntry?.(node.fnId);
    const scheme = namedScheme(node.fnId);
    if (!entry || !scheme || !base.getFunction?.(entry.targetId ?? entry.id)) {
      const known = entry?.scheme ?? base.getFunction?.(node.fnId)?.signatureDeclaration?.scheme;
      if ((!known || ground(known)) && logic !== null && typeof logic === "object") unavailableCalls.add(logic);
      return;
    }
    named.set(entry.targetId ?? entry.id, scheme);
    named.set(entry.id, scheme);
    if (logic !== null && typeof logic === "object") callSites.set(logic, { scheme, argumentOffset: 0,
      functionId: base.getFunction?.(entry.targetId ?? entry.id)?.id ?? entry.id });
    const frame = base.getFunctionImportFrame?.(entry.id);
    declarations.set(scheme, { ...(frame ? { _importStack: [frame] } : {}), _sourceFunction: entry.id });
  };
  const arrow = (original: TypeScheme) => {
    const previous = expanded.get(original);
    if (previous) return previous;
    let scheme = original;
    let frame = declarations.get(original) ?? {};
    const guards: Array<{ set: SetExpr; frame: Pick<EvaluateContext, "_importStack" | "_sourceFunction"> }> = [];
    const seen = new Set<string>();
    for (;;) {
      const plan = dispatchEngineBody("engine:authoringInvocationTypeLayer", [marshalStoredBodyForValidation(scheme.body)]) as {
        kind: string; reference: string; path: string[]; setPath: string[];
      };
      if (plan.kind === "arrow") {
        const result = { arrow: scheme, frame, guards };
        expanded.set(original, result);
        return result;
      }
      if (plan.kind === "data") return undefined;
      if (plan.kind === "refinement") {
        let set: unknown = scheme.body;
        for (const key of plan.setPath) {
          if (set === null || typeof set !== "object") throw new Error("This function's refinement is unavailable in this reader.");
          const read = ownDataRead(set, key);
          if (!read.found) throw new Error("This function's refinement is unavailable in this reader.");
          set = read.value;
        }
        guards.push({ set: set as SetExpr, frame });
        const projected = projectAuthoringScheme(scheme, plan.path);
        if (!projected) throw new Error("This function's declared arrow is unavailable in this reader.");
        scheme = projected;
        continue;
      }
      if (plan.kind !== "reference") throw new Error("This function's declared arrow is unavailable in this reader.");
      const nominal = scheme.nominals?.find(owner => owner.path.length === 0);
      const handle = nominal ? base._typeFamilyNominalHandle?.(nominal.identity, plan.reference, nominal.identity) : plan.reference;
      const owner = handle ? base._typeFamilyOwner?.(handle, frame._sourceFunction) : undefined;
      if (nominal && owner?.ownerIdentity !== nominal.identity) throw new Error("This function's captured declaration is unavailable in this reader.");
      if (!owner || seen.has(owner.ownerIdentity)) throw new Error("This function's declared arrow is unavailable in this reader.");
      seen.add(owner.ownerIdentity);
      const scope = (base as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
        owner: string; names: Readonly<Record<string, string>>; aliases?: Readonly<Record<string, string>>; sourceFunction?: string;
      } | undefined })._typeDeclarationScope?.(owner.ownerIdentity);
      const resolved = base._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity);
      if (!scope || !resolved?.ok) throw new Error("This function's declaration scope is unavailable in this reader.");
      scheme = resolved.type;
      frame = { _sourceFunction: scope.sourceFunction, _importStack: [{ names: { ...scope.names }, aliases: { ...(scope.aliases ?? {}) } }] };
    }
  };
  const check = (scheme: TypeScheme | undefined, value: unknown, position: string, context: EvaluateContext) => {
    if (!scheme) throw new Error(`This function's ${position} type is unavailable in this reader.`);
    // Keep the reader/account and dynamic scope. Only this checking frame loses
    // perform; the actual invocation runs once under its original live frame.
    const checking = { ...context, _authoringInvocation: undefined, _performTable: undefined,
      _ioHandlerContext: undefined, onStep: undefined };
    const callable = valueContract(value);
    const verdict = callable
      ? dispatchEngineBody("engine:authoringInvocationCallableMembership", [judgeAuthoringSchemeCompatibility(callable.scheme, scheme, { registry })])
      : literalMembershipFor(environment, { registry, evaluateContext: checking })(value, scheme);
    const issue = dispatchEngineBody("engine:authoringInvocationMembershipIssue", [verdict, position]) as { $tag: string; _0?: string };
    if (issue.$tag === "Just") throw new Error(issue._0);
  };
  return { observe, required: () => active || pending, hooks: {
    sourceContract: source => {
      if (!active || source === null || typeof source !== "object") return undefined;
      if (unavailableCalls.has(source)) throw new Error("This function's input/result membership is unavailable in this reader.");
      return callSites.get(source);
    },
    valueContract,
    namedContract: (spec, context, inherited) => {
      if (!active) return undefined;
      if (inherited?.functionId && inherited.functionId !== spec.id) throw new Error("This function's captured call target changed in this reader.");
      const scheme = named.get(spec.id) ?? (inherited ? namedScheme(spec.id) : undefined);
      if (!scheme) return undefined;
      if (context.getFunction?.(spec.id) !== base.getFunction?.(spec.id)) {
        throw new Error("This function's declaration changed during invocation.");
      }
      if (inherited) {
        if (inherited.scheme === scheme) return inherited;
        const actual = arrow(scheme), required = arrow(inherited.scheme);
        if (!actual || !required || !("$arrow" in actual.arrow.body) || !("$arrow" in required.arrow.body)) throw new Error("This function's declared arrow is unavailable in this reader.");
        const expectedCount = actual.arrow.body.$arrow.params.length - inherited.argumentOffset;
        const issue = dispatchEngineBody("engine:authoringInvocationContractIssue", [marshalStoredBodyForValidation(required.arrow), expectedCount]) as { $tag: string; _0?: string };
        if (issue.$tag === "Just") throw new Error(issue._0);
        const compatible = (left: TypeScheme | undefined, right: TypeScheme | undefined) => {
          const match = left && right ? judgeAuthoringSchemeCompatibility(left, right, { registry }) : "unknown";
          const verdict = dispatchEngineBody("engine:authoringInvocationCallableMembership", [match]);
          const issue = dispatchEngineBody("engine:authoringInvocationMembershipIssue", [verdict, "callable declaration"]) as { $tag: string; _0?: string };
          if (issue.$tag === "Just") throw new Error(issue._0);
        };
        for (let index = 0; index < expectedCount; index++) compatible(
          projectAuthoringScheme(required.arrow, ["$arrow", "params", String(index), "type"]),
          projectAuthoringScheme(actual.arrow, ["$arrow", "params", String(index + inherited.argumentOffset), "type"]));
        compatible(projectAuthoringScheme(actual.arrow, ["$arrow", "returns"]), projectAuthoringScheme(required.arrow, ["$arrow", "returns"]));
        return inherited;
      }
      return { scheme, argumentOffset: 0 };
    },
    retainContract: (value, contract) => { if (value !== null && typeof value === "object") values.set(value, contract); },
    result: (source, value, context) => {
      if (source === null || typeof source !== "object") return value;
      // A reference this reader's own expression evaluated to (a parameter,
      // a field, a call's result) is the reader's value from here on.
      if (authoredLogic.has(source) && isFunctionReference(value, context)) authoredReferences.add(value);
      const declaration = sources.get(source);
      if (!declaration) return value;
      const { scheme } = declaration;
      if (value === null || typeof value !== "object") {
        if (declaration.callable) throw new Error("This saved function no longer evaluates to a callable value.");
        return value;
      }
      const fn = ownDataRead(value, "__fenelFn"), partial = ownDataRead(value, "__fenelPartial"), reference = ownDataRead(value, "$ref");
      const functionReference = reference.found && typeof reference.value === "string" && context.getFunction?.(reference.value) !== undefined;
      if (!(fn.found && fn.value === true) && !(partial.found && partial.value === true)
        && !functionReference) {
        if (declaration.callable) throw new Error("This saved function no longer evaluates to a callable value.");
        return value;
      }
      active = true;
      if (declaration.unavailable) throw declaration.unavailable;
      const copy = Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value)) as object;
      const collected = partial.found && partial.value === true ? ownDataRead(value, "collected") : undefined;
      const previous = values.get(value);
      if (previous && collected?.found && Array.isArray(collected.value)) {
        const original = arrow(previous.scheme);
        if (!original) throw new Error("This partial function's declaration is unavailable in this reader.");
        for (let index = previous.argumentOffset; index < collected.value.length; index++) {
          check(projectAuthoringScheme(original.arrow, ["$arrow", "params", String(index - previous.argumentOffset), "type"]),
            collected.value[index], `collected input ${index + 1}`, { ...context, ...original.frame });
        }
      }
      const materialized = arrow(scheme);
      if (!materialized) throw new Error("This function's declared arrow is unavailable in this reader.");
      const params = fn.found && fn.value === true ? ownDataRead(value, "params") : undefined;
      const arity = partial.found && partial.value === true ? ownDataRead(value, "arity") : undefined;
      const runtimeArity = params?.found && Array.isArray(params.value) ? params.value.length
        : arity?.found && typeof arity.value === "number" && collected?.found && Array.isArray(collected.value)
          ? arity.value - collected.value.length
          : reference.found && typeof reference.value === "string" ? context.getFunction?.(reference.value)?.params.length : undefined;
      if (runtimeArity === undefined) throw new Error("This saved function's callable parameters are unavailable in this reader.");
      const arityIssue = dispatchEngineBody("engine:authoringInvocationContractIssue", [marshalStoredBodyForValidation(materialized.arrow), runtimeArity]) as { $tag: string; _0?: string };
      if (arityIssue.$tag === "Just") throw new Error(arityIssue._0);
      for (const guard of materialized.guards) {
        const checking = { ...context, ...guard.frame, _authoringInvocation: undefined, _performTable: undefined, _ioHandlerContext: undefined, onStep: undefined };
        const verdict = contains(guard.set, value, frameAccount(context), {}, checking);
        const issue = dispatchEngineBody("engine:authoringInvocationMembershipIssue", [verdict, "callable refinement"]) as { $tag: string; _0?: string };
        if (issue.$tag === "Just") throw new Error(issue._0);
      }
      values.set(copy, { scheme, argumentOffset: collected?.found && Array.isArray(collected.value) ? collected.value.length : 0 });
      return copy;
    },
    invoke: (contract, args, context, execute) => {
      const materialized = arrow(contract.scheme);
      if (!materialized) throw new Error("This function's declared arrow is unavailable in this reader.");
      const scheme = materialized.arrow;
      const invocationContext = { ...context, ...materialized.frame };
      const issue = dispatchEngineBody("engine:authoringInvocationContractIssue", [marshalStoredBodyForValidation(scheme), args.length]) as { $tag: string; _0?: string };
      if (issue.$tag === "Just") throw new Error(issue._0);
      for (let index = 0; index < args.length; index++) {
        check(projectAuthoringScheme(scheme, ["$arrow", "params", String(index), "type"]), args[index], `input ${index + 1}`, invocationContext);
      }
      const result = execute();
      check(projectAuthoringScheme(scheme, ["$arrow", "returns"]), result, "result", invocationContext);
      return result;
    },
  } };
}
