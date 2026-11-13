// ---------------------------------------------------------------------------
// childValueType — the type of the value at one key INSIDE a container value.
//
// Extracted verbatim from `DataValueSurface`'s private `childType`, because a
// second caller arrived: the locus scope stack, which renders a container's
// children as cards and needs each card's type for exactly the same reason the
// nested field editor did. Two copies of "peel the container, then read the
// field / element type" would drift, and the drift would be silent — a wrong
// child type does not throw, it just renders the wrong editor.
//
// This is a MOVE, not a rewrite. `DataValueSurface` now calls it.
// ---------------------------------------------------------------------------

import type { FenelType } from "@fenel/engine/types";
import { recordFieldsForType, peelToVariantType } from "@fenel/engine/authoring/expression";
import { peelListForAuthoring, resolveValueType } from "@fenel/engine/authoring/type";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { isInertAuthoringSession, type AuthoringSession } from "../expression-runner/account-authoring-session";
import { transferContainerShape } from "./expressions";

/** The declared type of `container[key]`, when the container's own type is
 *  known well enough to say. `undefined` means "no claim" — the caller falls
 *  back to inference from the value, never to a guess. */
export function childValueType(
  container: unknown,
  containerType: FenelType | undefined,
  key: string | number,
  session: AuthoringSession,
): FenelType | undefined {
  if (!containerType) return undefined;
  // B4 wave 4 lane S: the frame is read only for a dependent (`$el`) type. A
  // frameless (Local) page session has none there: its `$el` stays undecided.
  const frameless = isInertAuthoringSession(session);
  const shape = transferContainerShape(containerType, session.environment, () => frameless ? undefined : session.evaluateContext);
  if (frameless && "$el" in shape) return undefined;
  if (typeof key === "number") return peelListForAuthoring(shape)?.elem;
  // Record constructors can retain a runtime `$tag`. Their declaration owns
  // the fields; only a genuine variant uses the tag to select a case.
  const recordFields = recordFieldsForType(shape, session.environment);
  const tag = container && typeof container === "object"
    ? (container as { $tag?: unknown }).$tag : undefined;
  const fields = recordFields ?? (typeof tag === "string"
    ? peelToVariantType(shape, session.environment)?.cases.find((entry) => entry.name === tag)?.fields
    : undefined);
  return fields?.find((field) => field.name === key)?.type;
}

/** B4 wave 4 lane S: `typedReadDisplayType`'s display choice for a frameless
 * (Local) reader, resolved through its structure environment alone: a generic
 * declared type (a type variable, or one whose value projection is Any) yields
 * to a concrete observed type. Only the page reflection step is skipped (a
 * Local reader has no page frame); with both generic, the declared type stays. */
export function framelessDisplayType(declared: FenelType | undefined, observed: FenelType | undefined,
  environment: AuthoringEnvironment): FenelType | undefined {
  const resolve = (name: string) => environment.resolveTypeRef?.({ $ref: name }) ?? environment.resolveNamedType?.(name);
  const generic = (type: FenelType) => {
    if ("$var" in type) return true;
    if ("$refined" in type || "$tagged" in type) return false;
    const projected = "$ref" in type ? resolve(type.$ref) ?? type : type;
    if ("$ref" in projected) return false;
    if ("$refined" in projected || "$tagged" in projected) return false;
    const resolved = resolveValueType(projected, resolve);
    return "$complement" in resolved && "$void" in resolved.$complement;
  };
  if (declared && !generic(declared)) return declared;
  if (observed && !generic(observed)) return observed;
  return declared ?? observed;
}
