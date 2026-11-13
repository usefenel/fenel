import { dispatchEngineBody, dispatchedJsonLogicToSyntax } from "../engine-bodies-dispatch";
import { compileFieldSlotFromIdentifiedField, type CompileFieldSlot } from "../compile-field-slots";
import { inferRegistryFunctionDraft, type RegistryFunctionDraftInferenceResult,
  type RegistrySignatureFinalizationOptions, type SignatureResolutionRow } from "../signature-inference";
import type { FenelFunction, FunctionSignatureDeclaration, TypeScheme } from "../types";
import type { ModuleRegistry } from "../registry";
import type { AuthoringEnvironment } from "./environment";
import { assertAcyclicAuthoringData } from "./json-value";
import { judgeAuthoringTypeCompatibility, type AuthoringTypeCompatibility } from "./call-guidance";
import { projectAuthoringScheme } from "./scheme-projection";
import { authoringFunctionResultNeedsContainment, projectAuthoringFunctionSaveVerdict } from "./signature-authoring";

/** B3 captured-reader adapter to the canonical whole-function inference rule.
 * The existing Fenel surface walker selects references, including lexical
 * guard/where scopes. This adapter only captures their admitted schemes and
 * exact routes; it neither projects independent parameter schemes nor builds
 * another registry. A call back to the edited identity uses the new candidate. */
export function inferAuthoringFunctionDraft(
  fn: FenelFunction,
  declaration: FunctionSignatureDeclaration,
  environment: AuthoringEnvironment,
  options: { readonly registry?: ModuleRegistry } = {},
): RegistryFunctionDraftInferenceResult {
  try {
    assertAcyclicAuthoringData(fn);
    assertAcyclicAuthoringData(declaration);
    const candidate = { fn, declaration, implementationOrigin: { $tag: "FenelBody" as const } };
    const syntax = dispatchedJsonLogicToSyntax(fn.body) as { $tag: string; _0?: unknown };
    const names = syntax.$tag === "Ok"
      ? dispatchEngineBody("engine:inferenceSurfaceReferences", [syntax._0]) as string[] : [];
    if (!Array.isArray(names) || names.some(name => typeof name !== "string")) {
      throw new TypeError("Function draft reference projection was not a string array.");
    }
    const captured = options.registry?.resolveFunctionDraftReferences(fn.id, names);
    const byName = new Map(captured?.map(row => [row.name, row]));
    const resolutions: SignatureResolutionRow[] = [];
    const externalCallables: NonNullable<RegistrySignatureFinalizationOptions["externalCallables"]>[number][] = [];
    const constructorSlots: Record<string, readonly CompileFieldSlot[]> = Object.create(null);
    for (const name of names) {
      // Exact recursive identity is the current candidate, even if the reader
      // still exposes a previous checked signature for that saved identity.
      if (name === fn.id) {
        resolutions.push({ name, targetId: fn.id, status: "resolved" });
        continue;
      }
      const route = byName.get(name);
      if (route !== undefined && route.status !== "resolved") {
        resolutions.push(route);
        continue;
      }
      if (route?.targetId === fn.id) {
        resolutions.push(route);
        continue;
      }
      const constructorName = name.startsWith("$ctor:") ? name.slice(6) : undefined;
      const constructor = constructorName === undefined ? undefined
        : environment.resolvePatternConstructor?.(constructorName, undefined);
      const entry = constructor?.status === "resolved" ? constructor
        : environment.getFunctionEntry?.(route?.targetId ?? name);
      if (entry !== undefined) assertAcyclicAuthoringData(entry);
      if (entry === undefined || entry.scheme === undefined) {
        resolutions.push({ name, targetId: route?.targetId ?? "", status: constructor?.status === "ambiguous" ? "ambiguous" : "missing" });
        continue;
      }
      if (route !== undefined && entry.targetId !== undefined && route.targetId !== entry.targetId) {
        throw new TypeError("Function draft callable disagrees with its captured route.");
      }
      const targetId = route?.targetId ?? entry.targetId ?? name;
      if (entry.signatureOutcome !== undefined && entry.signatureOutcome.$tag !== "Solved") {
        resolutions.push({ name, targetId, status: "fenced", verdict: entry.signatureOutcome.$tag,
          diagnostics: entry.signatureOutcome.diagnostics });
        continue;
      }
      resolutions.push({ name, targetId, status: "resolved" });
      externalCallables.push({ name, targetId, scheme: entry.scheme,
        trust: options.registry?.getFunctionSignatureInfo(targetId)?.trust ?? { $tag: "Advisory" } });
      if (constructorName !== undefined) constructorSlots[constructorName] = entry.params.map(compileFieldSlotFromIdentifiedField);
    }
    return inferRegistryFunctionDraft(candidate, {
      resolutions, externalCallables,
      constructorSlotsForCandidate: () => constructorSlots,
      ...(options.registry === undefined ? {} : { resolveCandidateNominalReferences:
        (functionId: string, nominalNames: readonly string[]) => options.registry!.resolveFunctionDraftNominalReferences(functionId, nominalNames) }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Function draft preparation failed.";
    return { outcome: { $tag: "Invalid", diagnostics: [{ code: "INFERENCE_FUNCTION_DRAFT_CAPTURE", message, functionId: "<authoring-function>" }] } };
  }
}

export type AuthoringFunctionDraftSaveVerdict = {
  readonly inferred: RegistryFunctionDraftInferenceResult;
  readonly invalid: boolean;
  readonly needsAnnotation: boolean;
  /** Present only when the existing containment verdict refused an authored
   * result that the canonical equation could not decide. */
  readonly resultMismatch?: { readonly actual: TypeScheme; readonly expected: TypeScheme };
};

/** B3 Save adapter. The canonical equation abstains at a set former (Void,
 * union, intersection, complement), and an authored result is trusted without
 * a body check once saved. The source policy then asks for the existing
 * containment verdict of the body's own inferred result against the declared
 * result; this adapter only supplies that verdict. No type is compared here. */
export function judgeAuthoringFunctionDraftSave(
  fn: FenelFunction,
  declaration: FunctionSignatureDeclaration,
  environment: AuthoringEnvironment,
  options: { readonly registry?: ModuleRegistry } = {},
): AuthoringFunctionDraftSaveVerdict {
  const inferred = inferAuthoringFunctionDraft(fn, declaration, environment, options);
  const inferResult = declaration.returns.$tag === "Absent";
  let compatibility: AuthoringTypeCompatibility = "unknown";
  let resultMismatch: AuthoringFunctionDraftSaveVerdict["resultMismatch"];
  if (authoringFunctionResultNeedsContainment(inferResult, inferred.outcome) && declaration.scheme !== undefined) {
    const expected = projectAuthoringScheme(declaration.scheme, ["$arrow", "returns"]);
    const bodyOnly = inferAuthoringFunctionDraft(fn, { ...declaration, returns: { $tag: "Absent" } }, environment, options);
    const actual = bodyOnly.outcome.$tag === "Solved" && bodyOnly.scheme !== undefined
      ? projectAuthoringScheme(bodyOnly.scheme, ["$arrow", "returns"]) : undefined;
    if (actual !== undefined && expected !== undefined) {
      compatibility = judgeAuthoringTypeCompatibility(actual.body, expected.body, { registry: options.registry });
      if (compatibility === "incompatible") resultMismatch = { actual, expected };
    }
  }
  const verdict = projectAuthoringFunctionSaveVerdict(inferResult, inferred.outcome, compatibility);
  return { inferred, invalid: verdict.invalid, needsAnnotation: verdict.needsAnnotation,
    ...(verdict.invalid && resultMismatch !== undefined ? { resultMismatch } : {}) };
}
