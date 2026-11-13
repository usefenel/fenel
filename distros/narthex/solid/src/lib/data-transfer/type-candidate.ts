import type { FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { invokeCallable, type EvaluateContext } from "@fenel/engine/expressions";
import { expectedSchemeForType, type AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { TransferError, TRANSFER_LIMITS, type TransferItem, type TransferTypeIdentity } from "./types";
import { decodeTransferItem } from "./index";

function identityFor(reference: string, environment: AuthoringEnvironment, registry?: ModuleRegistry): string | undefined {
  return registry?.getEntityNominalIdentity(reference)
    ?? expectedSchemeForType({ $ref: reference }, environment)?.nominals?.find((entry) => entry.path.length === 0)?.identity;
}

/** Traversal of declared TYPE slots only; FieldKey refs and predicate programs
 * are not type names. This transports identity facts, not type equations. */
function typeReferences(type: unknown): { path: string; reference: string }[] {
  const references: { path: string; reference: string }[] = [];
  let nodes = 0;
  function visit(value: unknown, path: string, depth: number): void {
    if (++nodes > TRANSFER_LIMITS.expressionNodes || depth > TRANSFER_LIMITS.depth) throw new TransferError("This copied type is too large or too deeply nested.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TransferError("The copied type descriptor is malformed.");
    const current = value as Record<string, any>;
    const names = Object.keys(current);
    if (names.length !== 1) throw new TransferError("The copied type descriptor is malformed.");
    if (typeof current.$ref === "string") { references.push({ path, reference: current.$ref }); return; }
    if ("$var" in current || "$unit" in current || "$void" in current || "$type" in current) return;
    const children = (fields: unknown, suffix: string) => {
      if (!Array.isArray(fields)) throw new TransferError("The copied type's fields are malformed.");
      fields.forEach((field, index) => visit(field?.type, `${path}${suffix}/${index}/type`, depth + 1));
    };
    if ("$record" in current) { children(current.$record?.fields, "/$record/fields"); return; }
    if ("$variant" in current) {
      if (!Array.isArray(current.$variant?.cases)) throw new TransferError("The copied variants are malformed.");
      current.$variant.cases.forEach((entry: any, index: number) => children(entry.fields ?? [], `/$variant/cases/${index}/fields`));
      return;
    }
    if ("$arrow" in current) { children(current.$arrow?.params, "/$arrow/params"); visit(current.$arrow?.returns, `${path}/$arrow/returns`, depth + 1); return; }
    for (const key of ["$tuple", "$union", "$intersect"]) if (key in current) {
      if (!Array.isArray(current[key])) throw new TransferError("The copied type descriptor is malformed.");
      current[key].forEach((child: unknown, index: number) => visit(child, `${path}/${key}/${index}`, depth + 1));
      return;
    }
    if ("$complement" in current) { visit(current.$complement, `${path}/$complement`, depth + 1); return; }
    if ("$mu" in current) { visit(current.$mu?.body, `${path}/$mu/body`, depth + 1); return; }
    if ("$opaque" in current) {
      if (typeof current.$opaque?.name === "string") references.push({ path: `${path}/$opaque/name`, reference: current.$opaque.name });
      if (current.$opaque?.pure) visit(current.$opaque.pure, `${path}/$opaque/pure`, depth + 1);
      return;
    }
    if ("$refined" in current) { visit(current.$refined?.base, `${path}/$refined/base`, depth + 1); return; }
    if ("$map" in current) { visit(current.$map?.values, `${path}/$map/values`, depth + 1); return; }
    if ("$tagged" in current) {
      visit(current.$tagged?.value, `${path}/$tagged/value`, depth + 1);
      visit(current.$tagged?.phantom, `${path}/$tagged/phantom`, depth + 1);
      return;
    }
    if ("$el" in current) {
      const call = current.$el?.call;
      if (!Array.isArray(call) || typeof call[0] !== "string") throw new TransferError("This computed type must be available as a named type before it can be copied.");
      references.push({ path: `${path}/$el/call/0`, reference: call[0] });
      call.slice(1).forEach((child: unknown, index: number) => visit(child, `${path}/$el/call/${index + 1}`, depth + 1));
      return;
    }
    throw new TransferError("This copied type cannot be verified in this editor.");
  }
  visit(type, "", 0);
  return references;
}

export function prepareTransferItem(item: TransferItem, environment: AuthoringEnvironment, registry?: ModuleRegistry,
  evaluateContext?: EvaluateContext): TransferItem {
  const historyProjection = evaluateContext && registry?.getFunction("view.clipboardEntryTransfer");
  if (historyProjection && registry && evaluateContext) {
    const original = invokeCallable({ $ref: registry.getUuid(historyProjection.id) ?? historyProjection.id }, [item.value], evaluateContext) as { $tag: string; _0?: string };
    if (original.$tag === "Just" && original._0 !== undefined) return decodeTransferItem(original._0);
  }
  if (!item.type) return item;
  return { ...item, typeIdentities: typeReferences(item.type).map((reference) => ({ ...reference,
    identity: identityFor(reference.reference, environment, registry),
  })) };
}

/** Refuse changed or missing owners before any membership evaluation. Only
 * receiver-owned definitions or inert structural types can be validated next. */
export function receiverTypeCandidate(item: TransferItem, environment: AuthoringEnvironment, registry?: ModuleRegistry): FenelType | undefined {
  if (!item.typeCandidate) return item.type;
  const candidate = item.typeCandidate;
  const references = typeReferences(candidate.type);
  for (const reference of references) {
    const sent = candidate.identities.filter((identity) => identity.path === reference.path && identity.reference === reference.reference);
    if (sent.length !== 1) throw new TransferError("The original type identity was not copied. Copy the value again from its original lens.");
    const current = identityFor(reference.reference, environment, registry);
    if (current !== sent[0]!.identity) throw new TransferError(`The original ${reference.reference} type is unavailable or belongs to another definition here.`);
    if (current === undefined && !["String", "Char", "Number", "Nat", "Int", "Rational", "Real", "Boolean", "Bool", "Bytes"].includes(reference.reference)) {
      throw new TransferError(`The original ${reference.reference} type cannot be verified for this data.`);
    }
  }
  if (candidate.identities.length !== references.length) throw new TransferError("The copied type identity metadata does not match its type.");
  const type = candidate.type as FenelType;
  // A reference is interpreted from this receiver's declaration, not a sender
  // supplied body. Structural schemas can contain executable refinements or
  // dependent maps, so those must exactly match a receiver-owned declaration.
  const serialized = JSON.stringify(type);
  const risky = /"\$refined"|"\$map"|"\$complement"/.test(serialized);
  if (risky && !environment.catalog.types.some((entry) => entry.type && JSON.stringify(entry.type) === serialized)) {
    throw new TransferError("The original computed or refined type is not available as a definition here. Copy it from a named type.");
  }
  if (serialized.includes('"$el"')) {
    for (const reference of references.filter((entry) => entry.path.endsWith("/$el/call/0"))) {
      const scheme = expectedSchemeForType({ $ref: reference.reference }, environment);
      const application = scheme?.applications?.find((entry) => entry.path.length === 0);
      if (application?.headRef !== reference.reference) {
        throw new TransferError(`The original ${reference.reference} type constructor cannot be verified here.`);
      }
    }
  }
  return type;
}
