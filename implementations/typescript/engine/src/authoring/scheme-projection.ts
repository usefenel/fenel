import type { FenelType, FieldKey, InferenceOutcome, TypeScheme } from "../types";
import { dispatchedAuthoringChildTypePathPlan } from "../engine-bodies-dispatch";
import { Just, Nothing } from "../type-foundation";
import { checkAuthoringSchemeStructure } from "../signature-inference";
import type { AuthoringTypeResolver } from "./expression-authoring";
import { assertAcyclicAuthoringData } from "./json-value";

/** Project an existing scheme without inventing binders or losing owner/kind
 * information. Paths use the public FenelType transport, just like sidecars. */
export function projectAuthoringScheme(
  scheme: TypeScheme,
  path: readonly string[],
): TypeScheme | undefined {
  let body: unknown = scheme.body;
  for (const segment of path) {
    if (body === null || typeof body !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(body, segment);
    if (!descriptor || !("value" in descriptor)) return undefined;
    body = descriptor.value;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const within = (candidate: readonly string[]) => path.every((segment, index) => candidate[index] === segment);
  return {
    quantified: scheme.quantified,
    body: body as FenelType,
    ...(scheme.applications === undefined ? {} : {
      applications: scheme.applications.filter((item) => within(item.path))
        .map((item) => ({ ...item, path: item.path.slice(path.length) })),
    }),
    ...(scheme.nominals === undefined ? {} : {
      nominals: scheme.nominals.filter((item) => within(item.path))
        .map((item) => ({ ...item, path: item.path.slice(path.length) })),
    }),
    ...(scheme.diagnostics === undefined ? {} : { diagnostics: scheme.diagnostics }),
  };
}

export type AuthoringChildTypeSlot =
  | { readonly kind: "list-element" }
  | { readonly kind: "record-field"; readonly name: string; readonly key?: FieldKey };

export type AuthoringChildExpectation =
  | { readonly state: "absent"; readonly type?: undefined; readonly scheme?: undefined; readonly outcome?: undefined }
  | { readonly state: "known"; readonly type: FenelType; readonly scheme: TypeScheme; readonly outcome?: undefined }
  | { readonly state: "unresolved"; readonly type?: undefined; readonly scheme?: undefined; readonly outcome: InferenceOutcome };

function childProjectionUnavailable(message: string): AuthoringChildExpectation {
  return { state: "unresolved", outcome: { $tag: "AnnotationRequired", diagnostics: [{
    code: "authoring.child-expectation-unavailable", functionId: "<authoring-child>", message,
  }] } };
}

/** B3/A2 invocation and original-carrier reattachment. A raw shape resolver
 * cannot supply nominal/binder authority: named and applied parents remain
 * unresolved until their captured declaration scheme is available. */
export function projectAuthoringChildExpectation(
  parent: TypeScheme | undefined,
  slot: AuthoringChildTypeSlot,
  _context?: AuthoringTypeResolver,
): AuthoringChildExpectation {
  if (parent === undefined) return { state: "absent" };
  try {
    assertAcyclicAuthoringData({ parent, slot });
    const plan = dispatchedAuthoringChildTypePathPlan(parent.body, {
      kind: slot.kind, name: slot.kind === "record-field" ? slot.name : "",
      key: slot.kind === "record-field" && slot.key !== undefined ? Just(slot.key) : Nothing,
    });
    if (!plan.known) return childProjectionUnavailable(plan.message);
    const scheme = projectAuthoringScheme(parent, plan.path);
    if (scheme === undefined) return childProjectionUnavailable("The child expectation path is unreadable.");
    const checked = checkAuthoringSchemeStructure(scheme);
    if (!checked.ok) return childProjectionUnavailable(checked.message);
    return { state: "known", type: scheme.body, scheme };
  } catch (error) {
    return childProjectionUnavailable(error instanceof Error ? error.message : "The child expectation transport is unreadable.");
  }
}
