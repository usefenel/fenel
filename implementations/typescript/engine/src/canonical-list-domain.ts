// A2/B3: observe the current reader's nominal declaration and scoped provider.
// The source record owns the provider contract; domain admission stays Fenel.
import type { EvaluateContext } from "./json-logic";
import { invokeCallable, ownDataRead, resolveCompleteMethodForEvaluation } from "./json-logic";
import { recipeDomainSnapshotInReader } from "./recipe-reader";

/** The requested type supplies its actual nominal handle. Provider selection
 * uses the existing complete resolver and the reader's authenticated frame;
 * the selected source getter executes under that same frame. */
export function canonicalListDomainInReader(reader: EvaluateContext, type: unknown): { snapshot: unknown; declaration: unknown } | undefined {
  try {
    const reference = type !== null && typeof type === "object" && !Array.isArray(type)
      ? ownDataRead(type, "$ref") : undefined;
    const handle = typeof type === "string" ? type : reference?.found ? reference.value : undefined;
    if (typeof handle !== "string") return undefined;
    const owner = reader._typeFamilyOwner?.(handle, reader._sourceFunction);
    if (owner === undefined) return undefined;
    const key = reader._callSiteTyping?.legacyKey({ identity: owner.ownerIdentity, publicName: owner.name });
    if (key?.ok !== true) return undefined;
    const selected = resolveCompleteMethodForEvaluation(reader, "CanonicalListDomain", "describe", [key.key]);
    if (selected === undefined || selected.$tag !== "Resolved") return undefined;
    const method = selected._0;
    const descriptor = invokeCallable(typeof method === "string" ? { $ref: method } : method, [{}], reader);
    const acquisition = recipeDomainSnapshotInReader(descriptor, reader);
    if (acquisition === null || typeof acquisition !== "object") return undefined;
    const tag = ownDataRead(acquisition, "$tag");
    const payload = ownDataRead(acquisition, "_0");
    return tag.found && tag.value === "Ok" && payload.found
      ? { snapshot: payload.value, declaration: owner.type } : undefined;
  } catch {
    return undefined;
  }
}
