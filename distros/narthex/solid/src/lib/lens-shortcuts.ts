// Existing B3/Solid boundary: carry Fenel shortcut data into the captured
// reader's checker and canonical expression codec. Planning never runs recipes.
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { Expr } from "@fenel/engine";
import { invokeCallable, pureEvaluateContext } from "@fenel/engine/expressions";
import { Just, Nothing, functionRefHandle, type Maybe } from "@fenel/engine/type-foundation";
import { isFenelType } from "@fenel/engine/dependent-types";
import { assertJsonAuthoringValue, exprNodeToLogic, inferAuthoringExpression, logicToExprNode, type ExprNode } from "@fenel/engine/authoring/expression";
import { dispatchedDataExpressionValue, dispatchedExprToJsonLogic, dispatchedJsonLogicToExpr, dispatchedSurfaceReturnedExpressionReadable } from "@fenel/engine/engine-bodies-dispatch";
import { exactImmutableDataSnapshot } from "../../../../../implementations/typescript/engine/src/self-host-immutable-data";
import { compileConstructorSlotTable, compileFieldSlotFromIdentifiedField } from "../../../../../implementations/typescript/engine/src/compile-field-slots";
import { inferAuthoringExpressionWithLiteralWitnesses, judgeAuthoringSchemeCompatibility, projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { literalMembershipFor } from "./expression-runner/literal-membership";
import { concreteAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import { constructorExpression } from "./expression-runner/creation-seed";
import { expressionForTransfer, inferTransferExpression, scopedConcreteType } from "./data-transfer/expressions";
import type { WorkspaceFocus, WorkspacePresentation, WorkspaceSource } from "./workspace-wire";

export type LensShortcutSubject = { $tag: "CurrentDataSubject" | "ProducerExpressionSubject" };
export type LensShortcutDisposition = { $tag: "PresentExistingData" | "ApplyToDraft" | "CreateDerivedData" };
export type LensFunctionRecipe = { $tag: "LensFunctionRecipe"; inputType: FenelType; argumentsType: FenelType;
  resultType: FenelType; callableType: FenelType; callable: unknown; arguments: unknown };
export type LensShortcut = { $tag: "LensShortcut"; id: string; label: string; icon: string;
  operation: { $tag: "PresentLensSubject"; subject: LensShortcutSubject }
    | { $tag: "InvokeLensRecipe"; recipe: LensFunctionRecipe };
  disposition: LensShortcutDisposition; presentation: Maybe<WorkspacePresentation> };
export type LensTypedSubject = { $tag: "LensTypedSubject"; dataType: FenelType; data: unknown;
  originSource: WorkspaceSource; originFocus: WorkspaceFocus; producer: Maybe<Expr>; producerInput: Maybe<string>;
  producerBinding: Maybe<Expr> };
export type LensShortcutInput = { expression: ExprNode; value: unknown; type: FenelType;
  source: WorkspaceSource; focus: WorkspaceFocus; scheme?: TypeScheme;
  originExpression?: ExprNode; originType?: FenelType; producerTemplate?: ExprNode; retainedBinding?: ExprNode };
export type PreparedLensRecipe = { kind: "recipe"; shortcut: LensShortcut; node: ExprNode;
  resultType: FenelType; resultScheme: TypeScheme; input: LensShortcutInput; producer: Expr; producerInput: string;
  producerBinding?: Expr;
  /** Invocation/result publication must still belong to this exact reader. */
  reader: AuthoringSession };
export type PreparedLensShortcut = PreparedLensRecipe | { kind: "subject"; subject: LensShortcutSubject;
  presentation: Maybe<WorkspacePresentation> };
export type LensShortcutPreparation = { ok: true; plan: PreparedLensShortcut } | { ok: false; issue: string };
export type LensSubjectAdmission = { ok: true; subject: LensTypedSubject } | { ok: false; issue: string };

type FenelResult<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
type RecipeTypes = { $tag: "LensRecipeTypes"; inputType: FenelType; argumentsType: FenelType;
  resultType: FenelType; callableType: FenelType };

/** Exact captured names/identities only. A callable held in saved data never
 * installs another reader, imports, authority or a JavaScript callback. */
function shortcutFunction(session: AuthoringSession, name: string): string {
  const target = session.environment.resolveFunctionId(`view.${name}`)
    ?? session.environment.resolveFunctionId(`view:${name}`);
  const declaration = target && session.evaluateContext.getFunction?.(target);
  // Internal Fenel policy/data helpers have authored dependent parameters.
  // Their unresolved static scheme is not a callable-admission verdict: the
  // actual recipe callable is independently checked below, and these helpers
  // receive only resolved/admitted data at their consumption boundary.
  if (!target || !declaration || declaration.body === undefined
    || session.registry.getFunctionSignatureInfo(target)?.outcome.$tag === "Invalid") {
    throw new Error("Lens shortcuts are unavailable in this reader. Retry when its data is ready.");
  }
  return target;
}

function shortcutData<T>(session: AuthoringSession, name: string, ...args: unknown[]): T {
  const context = pureEvaluateContext(session.evaluateContext);
  return invokeCallable({ $ref: shortcutFunction(session, name) }, args, { ...context,
    _constructors: session.evaluateContext._constructors,
    _constructorWireNames: session.evaluateContext._constructorWireNames,
    _ctorFieldKeys: session.evaluateContext._ctorFieldKeys,
    _callSiteTyping: session.evaluateContext._callSiteTyping,
  }) as T;
}

// Suggestions share this captured-reader, no-perform policy boundary.
export { shortcutData as lensPolicyData };

function catalogRecipeTypes(session: AuthoringSession, name: string): RecipeTypes {
  const entry = session.environment.getFunctionEntry?.(shortcutFunction(session, name));
  const scheme = entry?.scheme;
  const input = scheme && projectAuthoringScheme(scheme, ["$arrow", "params", "0", "type"]);
  const arguments_ = scheme && projectAuthoringScheme(scheme, ["$arrow", "params", "1", "type"]);
  const result = scheme && projectAuthoringScheme(scheme, ["$arrow", "returns"]);
  if (entry?.signatureOutcome?.$tag !== "Solved" || !scheme || !("$arrow" in scheme.body)
    || scheme.body.$arrow.params.length !== 2 || !input || !arguments_ || !result) {
    throw new Error("This reader has no checked shortcut signature.");
  }
  return { $tag: "LensRecipeTypes", inputType: input.body, argumentsType: arguments_.body,
    resultType: result.body, callableType: scheme.body };
}

export function defaultLensShortcuts(reader: AuthoringSession): LensShortcut[] {
  return shortcutData(concreteAuthoringSession(reader), "defaultLensShortcuts");
}

export function textLensShortcuts(reader: AuthoringSession): LensShortcut[] {
  const session = concreteAuthoringSession(reader);
  return shortcutData(session, "textLensShortcuts", catalogRecipeTypes(session, "lensTextReverse"),
    catalogRecipeTypes(session, "lensTextUppercase"), catalogRecipeTypes(session, "lensTextUppercaseThenReverse"),
    catalogRecipeTypes(session, "lensTextSplit"));
}

function concreteRecipeType(session: AuthoringSession, recipe: LensFunctionRecipe, field: "inputType" | "argumentsType" | "resultType" | "callableType"): FenelType | undefined {
  if (!isFenelType(recipe[field])) return undefined;
  return scopedConcreteType(recipe[field], session.evaluateContext, session.environment, session.registry, recipe);
}

function dependentFieldType(session: AuthoringSession, entity: "LensFunctionRecipe" | "LensTypedSubject",
  field: "callable" | "arguments" | "data", values: Record<string, unknown>): FenelType | undefined {
  const declaration = session.registry.getIdentifiedEntity(`view.${entity}`) ?? session.registry.getIdentifiedEntity(entity);
  if (!declaration || declaration.module !== "view" || !("$record" in declaration.type)) return undefined;
  const declared = declaration.type.$record.fields.find(parameter => parameter.name === field)?.type;
  return declared && scopedConcreteType(declared, session.evaluateContext, session.environment, session.registry, values);
}

function groundScheme(session: AuthoringSession, type: FenelType, sourceFunctionId?: string): TypeScheme | undefined {
  const resolved = session.registry.callSiteTyping.resolveType(type, sourceFunctionId);
  return resolved.ok ? resolved.type : undefined;
}

function constructorSlots(session: AuthoringSession) {
  // Already-admitted exact catalog routes carry the named/positional field
  // identities. New source record constructors may not yet have a compiled
  // owner row; project their existing identified parameter slots mechanically.
  const table = { ...compileConstructorSlotTable(session.registry) };
  for (const entry of session.catalog.patternConstructors ?? session.catalog.functions) {
    if (entry.kind !== "constructor") continue;
    const target = entry.targetId ?? entry.id;
    if (session.environment.resolveConstructorTarget?.(target) !== target) continue;
    table[target] = entry.params.map(field => compileFieldSlotFromIdentifiedField(field));
  }
  return table;
}

/** The dependent field is resolved before it enters the shared typed argument
 * editor. Merely finding a Type-valued sibling is never admission. */
export function lensRecipeArgumentType(reader: AuthoringSession, recipe: LensFunctionRecipe): FenelType | undefined {
  const session = concreteAuthoringSession(reader);
  try { return dependentFieldType(session, "LensFunctionRecipe", "arguments", recipe); } catch { return undefined; }
}

export function withLensShortcutArguments(reader: AuthoringSession, shortcut: LensShortcut, args: unknown): LensShortcut {
  const session = concreteAuthoringSession(reader);
  if (shortcut.operation.$tag !== "InvokeLensRecipe") return shortcut;
  const recipe = shortcutData<LensFunctionRecipe>(session, "lensShortcutWithRecipeArguments", shortcut.operation.recipe, args);
  return shortcutData(session, "lensShortcutWithRecipe", shortcut, recipe);
}

export function withLensShortcutDisposition(reader: AuthoringSession, shortcut: LensShortcut,
  disposition: LensShortcutDisposition): LensShortcut {
  return shortcutData(concreteAuthoringSession(reader), "lensShortcutWithDisposition", shortcut, disposition);
}

export function lensShortcutProducerInput(reader: AuthoringSession): string {
  return shortcutData(concreteAuthoringSession(reader), "lensShortcutProducerInput");
}

/** Compose retained derivations over one source binding. Live-origin types
 * come from the original reader; an edited binding supplies its own positively
 * inferred ground type. A result never stands in for its producer's input. */
export function lensTypedSubjectInput(reader: AuthoringSession, subject: LensTypedSubject,
  originExpression: ExprNode, originType: FenelType): LensShortcutInput | undefined {
  const session = concreteAuthoringSession(reader);
  try {
    const producerInput = lensShortcutProducerInput(session);
    // The template stays parameterized; the recorded edited binding belongs
    // to the single outer binding, never another execution inside the template.
    const producerTemplate = lensTypedSubjectExpression(session, { ...subject, producerBinding: Nothing },
      { kind: "param", name: producerInput });
    if (!producerTemplate) return undefined;
    const retainedBinding = subject.producerBinding?.$tag === "Just"
      ? coreExpressionNode(session, subject.producerBinding._0) : undefined;
    const retainedType = retainedBinding && retainedBindingGroundType(session, retainedBinding);
    if (retainedBinding && !retainedType) return undefined;
    return { expression: originExpression, value: subject.data, type: subject.dataType,
      source: subject.originSource, focus: subject.originFocus, originExpression,
      originType: retainedType?.body ?? originType, producerTemplate,
      ...(retainedBinding === undefined ? {} : { retainedBinding }) };
  } catch { return undefined; }
}

function coreExpressionNode(session: AuthoringSession, expression: Expr): ExprNode {
  return logicToExprNode(dispatchedExprToJsonLogic(expression), [], session.environment.resolveFunctionId,
    session.environment.resolveConstructorTarget, session.environment.getFunctionEntry);
}

/** B3 read transport only: inspect returned Expr data through the canonical
 * codec. The source readability check refuses shapes whose egress would lose
 * literal identity. No producer, reflection, capture or invocation is used. */
export function returnedExpressionNode(reader: AuthoringSession, expression: unknown): ExprNode | undefined {
  try {
    const session = concreteAuthoringSession(reader);
    // A pinned owner is authoritative; only lockless readers use the bare
    // system registration, whose owner and declaration are checked below.
    const owner = session.registry.getTypeUuid("system", "Expr");
    const declaration = session.registry.getIdentifiedEntity(owner ?? "Expr");
    if (declaration?.module !== "system" || declaration.id !== "Expr") return undefined;
    const snapshot = exactImmutableDataSnapshot(expression);
    if (snapshot.status !== "ok") return undefined;
    assertJsonAuthoringValue(snapshot.value);
    if (!dispatchedSurfaceReturnedExpressionReadable(snapshot.value)) return undefined;
    return coreExpressionNode(session, snapshot.value as Expr);
  } catch { return undefined; }
}

function retainedBindingGroundType(session: AuthoringSession, expression: ExprNode): TypeScheme | undefined {
  // This existing inference adapter routes the kernel's literal-list append
  // primitive through the captured std declaration. It judges no types itself.
  const inferred = inferTransferExpression(expression, session.environment);
  if (inferred.outcome.$tag !== "Solved" || !inferred.scheme || inferred.scheme.quantified.length !== 0) return undefined;
  const resolved = groundScheme(session, inferred.type ?? inferred.scheme.body);
  return resolved && judgeAuthoringSchemeCompatibility(inferred.scheme, resolved, { registry: session.registry }) === "compatible"
    ? resolved : undefined;
}

function member(session: AuthoringSession, value: unknown, type: TypeScheme): Maybe<boolean> {
  // GLOBAL_ONLY: no authored account coordinate is accepted here. The exact
  // captured reader frame and nominal scheme remain the membership authority.
  return literalMembershipFor(session.environment, { registry: session.registry,
    evaluateContext: session.evaluateContext })(value, type);
}

function refused(issue: string): LensShortcutPreparation { return { ok: false, issue }; }

/** Recipe applicability is checked on every click using the actual captured
 * function scheme, ground input/argument types and result association. No
 * generic validator's permissive function/$el fallback supplies these facts. */
export function prepareLensShortcut(reader: AuthoringSession, shortcut: LensShortcut, input: LensShortcutInput,
  draftType?: FenelType): LensShortcutPreparation {
  const session = concreteAuthoringSession(reader);
  try {
    if (shortcut.operation.$tag === "PresentLensSubject") {
      const planned = shortcutData<FenelResult<{ subject: LensShortcutSubject; presentation: Maybe<WorkspacePresentation> }>>(
        session, "lensShortcutPlan", shortcut, Nothing, Nothing);
      return planned.$tag === "Err" ? refused(planned._0)
        : { ok: true, plan: { kind: "subject", subject: planned._0.subject, presentation: planned._0.presentation } };
    }
    const recipe = shortcut.operation.recipe;
    if (!recipe.callable || typeof recipe.callable !== "object" || !functionRefHandle(recipe.callable)) {
      return refused("This shortcut needs a checked function reference in this reader.");
    }
    const inputType = concreteRecipeType(session, recipe, "inputType");
    const argumentType = dependentFieldType(session, "LensFunctionRecipe", "arguments", recipe);
    const resultType = concreteRecipeType(session, recipe, "resultType");
    const callableType = dependentFieldType(session, "LensFunctionRecipe", "callable", recipe);
    if (!inputType || !argumentType || !resultType || !callableType) return refused("The shortcut's dependent types could not be resolved.");
    const callable = inferAuthoringExpression({ kind: "literal", value: recipe.callable }, session.environment);
    if (callable.outcome.$tag !== "Solved" || !callable.scheme) return refused("This reader could not check the shortcut's callable.");
    const sourceFunctionId = functionRefHandle(recipe.callable);
    const inputScheme = groundScheme(session, inputType, sourceFunctionId);
    const argumentScheme = groundScheme(session, argumentType, sourceFunctionId);
    const resultScheme = groundScheme(session, resultType, sourceFunctionId);
    const declaredCallable = groundScheme(session, callableType, sourceFunctionId);
    if (!inputScheme || !argumentScheme || !resultScheme || !declaredCallable) return refused("The shortcut's types are unavailable in this reader.");
    const options = { registry: session.registry };
    if (judgeAuthoringSchemeCompatibility(callable.scheme, declaredCallable, options) !== "compatible"
      || judgeAuthoringSchemeCompatibility(declaredCallable, callable.scheme, options) !== "compatible") {
      return refused("The shortcut's callable does not match its declared type.");
    }
    const association = session.registry.callSiteTyping.infer({ scheme: callable.scheme,
      arguments: [inputScheme, argumentScheme], expected: resultScheme, path: "lens-shortcut" });
    if (association.$tag !== "Solved"
      || judgeAuthoringSchemeCompatibility(association.resultType, resultScheme, options) !== "compatible") {
      return refused("The shortcut's input, arguments and result could not be associated with its callable.");
    }
    const subjectType = scopedConcreteType(input.type, session.evaluateContext, session.environment, session.registry);
    const subjectScheme = input.scheme ?? (subjectType && groundScheme(session, subjectType));
    if (!subjectScheme || judgeAuthoringSchemeCompatibility(subjectScheme, inputScheme, options) !== "compatible") {
      return refused("This shortcut does not accept the selected data.");
    }
    const inputAdmission = member(session, input.value, inputScheme);
    const argumentsAdmission = member(session, recipe.arguments, argumentScheme);
    if (argumentsAdmission.$tag !== "Just" || !argumentsAdmission._0) return refused("The shortcut's arguments could not be checked. Complete them before running.");
    const draftScheme = draftType && groundScheme(session, draftType);
    const draftAdmission = draftScheme
      ? judgeAuthoringSchemeCompatibility(resultScheme, draftScheme, options) === "compatible" ? Just(true) : Nothing
      : Nothing;
    const planned = shortcutData<FenelResult<unknown>>(session, "lensShortcutPlan", shortcut, inputAdmission, draftAdmission);
    if (planned.$tag === "Err") return refused(planned._0);
    const transferredArguments = expressionForTransfer({ value: recipe.arguments, type: argumentType,
      typeName: "Record", source: "fenel" }, session.environment,
    { registry: session.registry, evaluateContext: session.evaluateContext });
    const argumentConstructor = transferredArguments.kind === "call"
      ? session.environment.getFunctionEntry?.(transferredArguments.fnId) : undefined;
    const argumentsExpression = transferredArguments.kind === "call" && argumentConstructor?.kind === "constructor"
      ? constructorExpression(transferredArguments.fnId, argumentConstructor.params, transferredArguments.args)
      : transferredArguments;
    const codec = { constructorName: session.environment.constructorCodeName,
      fnCodeName: (id: string) => session.environment.functionCodeName(id) ?? id };
    const constructors = constructorSlots(session);
    const argumentLift = dispatchedJsonLogicToExpr(exprNodeToLogic(argumentsExpression, codec), constructors) as FenelResult<Expr>;
    if (argumentLift.$tag !== "Ok") return refused("The shortcut's arguments cannot be retained by the expression codec.");
    const argumentLogic = dispatchedExprToJsonLogic(argumentLift._0);
    const decodedArguments = dispatchedDataExpressionValue(argumentLogic, session.evaluateContext);
    if (decodedArguments.$tag !== "Concrete"
      || !shortcutData<boolean>(session, "lensShortcutArgumentsPreserved", recipe, decodedArguments.value)) {
      return refused("The expression codec cannot preserve these shortcut arguments. Choose supported argument data.");
    }
    const canonicalArguments = logicToExprNode(argumentLogic, [], session.environment.resolveFunctionId,
      session.environment.resolveConstructorTarget, session.environment.getFunctionEntry);
    // Existing structural application is a codec marker, never a new IR body.
    // Keep the originating expression/ref intact instead of flattening it to
    // the observed result. Shared Call/evaluation owns explicit execution.
    const producerInput = lensShortcutProducerInput(session);
    const retainedGroundType = input.retainedBinding && retainedBindingGroundType(session, input.retainedBinding);
    if (input.retainedBinding && !retainedGroundType) return refused("The edited origin's type could not be inferred and checked.");
    if (input.producerTemplate) {
      const originType = input.originType && scopedConcreteType(input.originType, session.evaluateContext, session.environment, session.registry);
      const originScheme = retainedGroundType ?? (originType && groundScheme(session, originType));
      if (!originScheme) return refused("The derivation's original input type could not be checked.");
      const prior = inferAuthoringExpression(input.producerTemplate, { ...session.environment,
        bindings: { [producerInput]: originScheme } });
      if (prior.outcome.$tag !== "Solved" || !prior.scheme
        || judgeAuthoringSchemeCompatibility(prior.scheme, subjectScheme, options) !== "compatible") {
        return refused("This reader could not check the retained derivation's input and result association.");
      }
    }
    const application: ExprNode = { kind: "literal", value: { __apply: {
      target: { kind: "literal", value: recipe.callable }, args: [input.producerTemplate ?? { kind: "param", name: producerInput }, canonicalArguments],
    } } };
    // The existing codec consumes a checked Ref call into the exact ordinary
    // call target. Core Expr deliberately has no identity-reference literal
    // egress; preserve that fence rather than adding a new Ref form.
    const template = logicToExprNode(exprNodeToLogic(application, codec), [], session.environment.resolveFunctionId,
      session.environment.resolveConstructorTarget, session.environment.getFunctionEntry);
    const lifted = dispatchedJsonLogicToExpr(exprNodeToLogic(template, codec), constructors) as FenelResult<Expr>;
    if (lifted.$tag !== "Ok") return refused("This shortcut's producer cannot be retained by the expression codec.");
    const canonicalTemplate = logicToExprNode(dispatchedExprToJsonLogic(lifted._0), [],
      session.environment.resolveFunctionId, session.environment.resolveConstructorTarget, session.environment.getFunctionEntry);
    let producerBinding: Expr | undefined;
    let bindingExpression = input.originExpression ?? input.expression;
    if (input.retainedBinding) {
      let missingReference = false;
      const bindingLogic = exprNodeToLogic(input.retainedBinding, { ...codec,
        onMissingRef: () => { missingReference = true; } });
      if (missingReference) return refused("This edited input contains a reference that cannot be retained by the expression codec.");
      const consumedBinding = logicToExprNode(bindingLogic, [], session.environment.resolveFunctionId,
        session.environment.resolveConstructorTarget, session.environment.getFunctionEntry);
      const binding = dispatchedJsonLogicToExpr(exprNodeToLogic(consumedBinding, codec), constructors) as FenelResult<Expr>;
      if (binding.$tag !== "Ok") return refused("This edited input cannot be retained by the expression codec.");
      bindingExpression = coreExpressionNode(session, binding._0);
      const bindingScheme = input.producerTemplate ? retainedGroundType : subjectScheme;
      if (!bindingScheme) return refused("The edited origin's type could not be checked.");
      const inferredBinding = inferAuthoringExpressionWithLiteralWitnesses(bindingExpression, session.environment, {
        expectedScheme: bindingScheme, literalMembership: literalMembershipFor(session.environment,
          { registry: session.registry, evaluateContext: session.evaluateContext }),
      });
      if (inferredBinding.outcome.$tag !== "Solved" || !inferredBinding.scheme
        || judgeAuthoringSchemeCompatibility(inferredBinding.scheme, bindingScheme, options) !== "compatible") {
        return refused("The edited origin does not match its checked input type.");
      }
      producerBinding = binding._0;
    }
    const node: ExprNode = { kind: "literal", value: { __let: { bindings: [
      { name: producerInput, expr: bindingExpression }, { name: "_", expr: canonicalTemplate },
    ] } } };
    return { ok: true, plan: { kind: "recipe", shortcut, node, resultType, resultScheme, input, reader: session,
      producer: lifted._0, producerInput, ...(producerBinding === undefined ? {} : { producerBinding }) } };
  } catch (problem) { return refused(problem instanceof Error ? problem.message : "This reader could not prepare the shortcut."); }
}

/** Typed saved subjects are rechecked in the receiving reader, including their
 * declared dependent type and source/focus provenance. */
export function checkLensTypedSubject(reader: AuthoringSession, subject: LensTypedSubject,
  currentSource: WorkspaceSource, currentFocus: WorkspaceFocus = subject.originFocus): LensSubjectAdmission {
  const session = concreteAuthoringSession(reader);
  try {
    if (!shortcutData<boolean>(session, "lensTypedSubjectOriginAdmission", subject, currentSource, currentFocus)) {
      return { ok: false, issue: "The lens data belongs to another source or focus." };
    }
    const type = dependentFieldType(session, "LensTypedSubject", "data", subject);
    const scheme = type && groundScheme(session, type);
    if (!scheme) return { ok: false, issue: "The lens data type is unavailable in this reader." };
    const verdict = shortcutData<FenelResult<LensTypedSubject>>(session, "lensTypedSubjectAdmission", subject,
      member(session, subject.data, scheme));
    return verdict.$tag === "Err" ? { ok: false, issue: verdict._0 } : { ok: true, subject: verdict._0 };
  } catch { return { ok: false, issue: "The lens data could not be checked for this reader." }; }
}

export function admitLensShortcutResult(reader: AuthoringSession, plan: PreparedLensRecipe, value: unknown,
  currentSource: WorkspaceSource = plan.input.source): LensSubjectAdmission {
  const session = concreteAuthoringSession(reader);
  if (session !== plan.reader) return { ok: false, issue: "The reader changed while running this shortcut. Try again." };
  try {
    const subject: LensTypedSubject = { $tag: "LensTypedSubject", dataType: plan.resultType, data: value,
      originSource: plan.input.source, originFocus: plan.input.focus, producer: Just(plan.producer), producerInput: Just(plan.producerInput),
      producerBinding: plan.producerBinding === undefined ? Nothing : Just(plan.producerBinding) };
    if (!shortcutData<boolean>(session, "lensTypedSubjectOriginAdmission", subject, currentSource, plan.input.focus)) {
      return { ok: false, issue: "The source changed while running this shortcut. Try again." };
    }
    const verdict = shortcutData<FenelResult<LensTypedSubject>>(session, "lensTypedSubjectAdmission", subject,
      member(session, value, plan.resultScheme));
    return verdict.$tag === "Err" ? { ok: false, issue: verdict._0 } : { ok: true, subject: verdict._0 };
  } catch { return { ok: false, issue: "The shortcut result could not be checked for this reader." }; }
}

/** Canonical core Expr -> Syntax -> JSON Logic -> ExprNode. A retained input
 * parameter is bound to the caller's current source expression/ref using the
 * ordinary let codec; saved-reference identity is never reverse-reified. */
export function lensTypedSubjectExpression(reader: AuthoringSession, subject: LensTypedSubject,
  sourceExpression?: ExprNode): ExprNode | undefined {
  const session = concreteAuthoringSession(reader);
  try {
    if (subject.producer?.$tag !== "Just") return undefined;
    const template = coreExpressionNode(session, subject.producer._0);
    if (subject.producerInput?.$tag !== "Just") return template;
    const binding = subject.producerBinding?.$tag === "Just"
      ? coreExpressionNode(session, subject.producerBinding._0) : sourceExpression;
    if (!binding) return undefined;
    return { kind: "literal", value: { __let: { bindings: [
      { name: subject.producerInput._0, expr: binding }, { name: "_", expr: template },
    ] } } };
  } catch { return undefined; }
}
