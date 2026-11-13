import { expectedSchemeForType, inferAuthoringExpressionWithLiteralWitnesses, projectAuthoringScheme, type AuthoringEnvironment, type AuthoringLiteralCheck, type AuthoringLiteralMembership, type AuthoringLiteralWitnessOptions } from "@fenel/engine/authoring/environment";
import type { AuthoringInferenceContext, AuthoringInferenceResult, ExprNode } from "@fenel/engine/authoring/expression";
import { checkAuthoringSchemeStructure, inferJsonLogicType, snapshotAuthoringSchemeTransport } from "../../../../../../implementations/typescript/engine/src/signature-inference";
import type { EvaluateContext } from "@fenel/engine/expressions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { validateValue } from "@fenel/engine/validation";
import type { ValidationAdmissionObservation } from "@fenel/engine/validation";
import { contains } from "@fenel/engine/set-algebra";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import { inlineWidgetFor } from "./inline-widgets";
import { frameAccount } from "@fenel/engine/authority";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "@fenel/engine/authoring/signature-authoring";

/** A2/B3: keep an unreadable expected carrier from losing its host-boundary
 * refusal. This isolated binding asks the existing marshaller to read its
 * sidecars; its inferred type never supplies authority for the actual draft.
 * Semantic preparation fences retain the unchanged literal-witness policy. */
export function inferScopedAuthoringExpression(
  node: ExprNode,
  context: AuthoringInferenceContext = {},
  options: AuthoringLiteralWitnessOptions = {},
): AuthoringInferenceResult {
  let expected: TypeScheme | undefined;
  try {
    const slot = Object.getOwnPropertyDescriptor(options, "expectedScheme");
    if (slot && "value" in slot && slot.value !== undefined) expected = snapshotAuthoringSchemeTransport(slot.value);
  } catch (error) {
    // The ExprNode bridge's existing host-boundary Invalid transport. A failed
    // strict snapshot must not be retried through its lossy expression copy.
    return { outcome: { $tag: "Invalid", diagnostics: [{
      code: "authoring-boundary-invalid", functionId: "<authoring-expression>",
      message: error instanceof Error ? error.message : "The required type could not be read.",
    }] } };
  }
  if (expected !== undefined && !checkAuthoringSchemeStructure(expected).ok) {
    const checked = inferJsonLogicType({ var: "required" }, { bindings: { required: expected } });
    if (checked.outcome.$tag === "Invalid"
      && checked.outcome.diagnostics.some(item => item.code === "INFERENCE_BINDING_BOUNDARY")) return checked;
  }
  return inferAuthoringExpressionWithLiteralWitnesses(node, context, options);
}

/** Solid/B3 catalogue composition only. Fenel owns reference walking and
 * capture-avoiding substitution; opaque atoms retain native representation. */
export function checkScopedDataMembership(
  type: FenelType,
  value: unknown,
  environment: AuthoringEnvironment,
  options: { evaluateContext?: EvaluateContext } = {},
) {
  // Account visibility comes from the authenticated frame; a detached reader
  // has no request account. The captured catalogue stays authoritative.
  return contains(typeToSetExpr(type), value, frameAccount(options.evaluateContext), {}, options.evaluateContext, ref => {
    if (!("$ref" in ref)) return { $void: true };
    const definition = environment.resolveNamedType?.(ref.$ref) ?? environment.resolveTypeRef?.(ref);
    // The existing abstention sentinel retains unreadable/native nominal leaves.
    if (definition === undefined || "$opaque" in definition) return { $void: true };
    // RefResolve's historical type signature is FenelType; contains accepts an
    // already projected SetExpr and refuses a structural schema at this seam.
    return typeToSetExpr(definition) as unknown as FenelType;
  });
}

/** Check admitted data against its declared type under this session's
 * authority. The validator's projected form value is deliberately unused:
 * checking never rewrites pixels, strips extra record fields or coerces input. */
export function literalMembershipFor(
  environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext;
    observeHints?: import("@fenel/engine/validation").ValidateOptions["observeHints"] } = {},
): AuthoringLiteralMembership {
  const membership: AuthoringLiteralMembership = (value, expected) => {
    try {
      const supplied = options.evaluateContext ?? options.registry?.evaluateContext() ?? {
        getEntityType: (name: string) => environment.resolveNamedType?.(name) ?? environment.resolveTypeRef?.({ $ref: name }),
      };
      const checking = authoringMembershipEvaluateContext(supplied);
      let exact = expected;
      if (expected.quantified.length === 0 && !expected.nominals?.length && checking._callSiteTyping) {
        const resolved = checking._callSiteTyping.resolveType(expected.body, checking._sourceFunction);
        if (!resolved.ok) return Nothing;
        exact = resolved.type;
      }
      const closedType = closeAuthoringMembershipType(exact, checking);
      if (!closedType) return Nothing;
      const resolve = (name: string) => {
        const owner = checking._typeFamilyOwner?.(name, checking._sourceFunction);
        const resolved = owner && checking._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity);
        return resolved?.ok ? closeAuthoringMembershipType(resolved.type, checking) : undefined;
      };
      const scoped = options.registry ? { ...environment,
        resolveTypeRef: (ref: FenelType) => "$ref" in ref ? resolve(ref.$ref) : undefined, resolveNamedType: resolve,
      } : environment;
      const nominal = exact.nominals?.find(owner => owner.path.length === 0);
      const scopeHook = (checking as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
        owner: string; names: Readonly<Record<string, string>>; aliases?: Readonly<Record<string, string>>; sourceFunction?: string;
      } | undefined } | undefined)?._typeDeclarationScope;
      const scope = nominal && "$ref" in expected.body && scopeHook ? scopeHook(nominal.identity) : undefined;
      if (nominal && "$ref" in expected.body && scopeHook && !scope) return Nothing;
      const evaluateContext = scope ? { ...checking, _sourceFunction: scope.sourceFunction,
        _importStack: [{ names: { ...scope.names }, aliases: { ...(scope.aliases ?? {}) } }] } : checking;
      const current = { ...options, evaluateContext };
      const widget = inlineWidgetFor(closedType, undefined, scoped, { seed: false });
      if (options.observeHints) {
        // The canonical recursive validator selects the occurrences, sibling
        // scope and declaration frame. Feedback observes its existing hints;
        // its rebuilt data and display state never establish membership.
        validateValue(closedType, value, frameAccount(evaluateContext), {
          registry: options.registry, functions: evaluateContext, coerce: false,
          strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
          observeHints: options.observeHints,
        });
      }
      if (options.registry) {
        // This existing hook closes the checked scheme over captured owners,
        // then calls containment in a purified caller frame. Its exact verdict
        // precedes the compatibility name lookup: a same-named declaration in
        // another module cannot erase the expected scheme's actual owner.
        const verdict = options.registry.callSiteTyping.member(exact, value, frameAccount(evaluateContext), evaluateContext);
        if (verdict === "yes") return Just(true);
        if (verdict === "no") return Just(false);
      }
      if (!literalMembershipAuthority({ ...exact, body: closedType }, scoped, options)) return Nothing;
      if (!widget && !options.registry) {
        return checkScopedDataMembership(closedType, value, scoped, current);
      }
      if (widget?.scalarType && !options.registry) {
        const decision = contains(typeToSetExpr(widget.type), value, frameAccount(evaluateContext), {}, evaluateContext);
        return decision;
      }
      // A renderer capability cannot decide inhabitance. After the exact
      // whole-scheme judgment abstains, the shared source validator can inspect
      // the original closed declaration, retaining its owner through nested
      // aliases instead of expanding it for a presentation widget.
      const validationType = options.registry ? closedType : widget!.type;
      const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
      const plans: ValidationAdmissionObservation[] = [];
      const checked = validateValue(validationType, value, frameAccount(evaluateContext), {
        registry: options.registry,
        functions: evaluateContext,
        coerce: false,
        // Records admit additional fields by width subtyping, including the
        // discriminator emitted by the ordinary record constructor path.
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeMembership: verdict => { observations.push(verdict); },
        observeAdmission: plan => { plans.push(plan); },
      });
      // GLOBAL_ONLY: pure classification of this validator's own typed
      // observations; all value/type checks already ran under the reader.
      return authoringValidationMembership(checked, observations, plans);
    } catch {
      return Nothing;
    }
  };
  if (options.registry) membership.resolveAnnotationScheme = type => {
    const resolved = options.registry!.callSiteTyping.resolveType(type, options.evaluateContext?._sourceFunction);
    return resolved.ok ? resolved.type : undefined;
  };
  return membership;
}

/** Share one verdict per data object and expected scheme for the lifetime of
 * the returned membership. Only for data that cannot change meanwhile, such as
 * one worker request's transported snapshot; never for editor drafts, whose
 * store-backed objects keep their identity across edits. */
export function sharedLiteralMembership(membership: AuthoringLiteralMembership): AuthoringLiteralMembership {
  const verdicts = new WeakMap<object, Map<string, ReturnType<AuthoringLiteralMembership>>>();
  const shared: AuthoringLiteralMembership = (value, expected) => {
    if (value === null || typeof value !== "object") return membership(value, expected);
    let key: string | undefined;
    try { key = JSON.stringify(expected); } catch { key = undefined; }
    if (key === undefined) return membership(value, expected);
    const known = verdicts.get(value)?.get(key);
    if (known !== undefined) return known;
    const verdict = membership(value, expected);
    let byScheme = verdicts.get(value);
    if (!byScheme) verdicts.set(value, byScheme = new Map());
    byScheme.set(key, verdict);
    return verdict;
  };
  if (membership.resolveAnnotationScheme) shared.resolveAnnotationScheme = membership.resolveAnnotationScheme;
  return shared;
}

/** Read the existing projected scheme owners at the captured registry boundary.
 * Neither a display name nor a field's broad inferred type supplies authority. */
export function literalMembershipAuthority(
  expected: TypeScheme,
  environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry },
): boolean {
  for (const nominal of expected.nominals ?? []) {
    const projected = projectAuthoringScheme(expected, nominal.path);
    const application = expected.applications?.find((application) => application.path.length === nominal.path.length
      && application.path.every((part, index) => part === nominal.path[index]));
    const head = application?.headRef ? { $ref: application.headRef } : projected?.body;
    const declaration = expectedSchemeForType(head, environment);
    const identity = options.registry && head && "$ref" in head
      ? options.registry.getEntityNominalIdentity(head.$ref)
      : declaration?.nominals?.find((owner) => owner.path.length === 0)?.identity;
    if (identity !== nominal.identity) return false;
  }
  return true;
}

/** Observe scalar verdicts from the same Fenel-owned recursive validator and
 * current sibling scope. Its errors, Boolean validity and rebuilt data are
 * deliberately unused; descendants never establish whole-record/List facts. */
export function literalMembershipChecksFor(
  environment: AuthoringEnvironment,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext } = {},
): (value: unknown, expected: TypeScheme) => readonly AuthoringLiteralCheck[] {
  return (value, expected) => {
    const checks: AuthoringLiteralCheck[] = [];
    try {
      if (!options.registry || !literalMembershipAuthority(expected, environment, options)) return checks;
      const checking = authoringMembershipEvaluateContext(options.evaluateContext ?? options.registry.evaluateContext());
      const closedType = closeAuthoringMembershipType(expected, checking);
      if (!closedType) return checks;
      validateValue(closedType, value, frameAccount(checking), {
        registry: options.registry, functions: checking, coerce: false,
        strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false },
        observeMembership: (verdict, path) => { checks.push({ verdict, path }); },
      });
    } catch {
      // A later unavailable projection cannot erase a recorded scalar verdict.
    }
    return checks;
  };
}
