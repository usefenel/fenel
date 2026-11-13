// The existing reader-reference projection shared by the worker transport
// and frame-bearing readers. Registry ownership and language resolution stay
// with the captured session; this leaf adds no resolver or registry.
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import type { AuthoringSession } from "./account-authoring-session";

export type ReaderCatalogReference = {
  /** The function a handle names in this frame (`getFunction`). */
  fn?: FenelFunction;
  /** The handle Fenel resolves for `fn` (its UUID when it has one). */
  handle?: string;
  typeFamilyOwner?: { identity: string; type: unknown; typeScheme?: { quantified: readonly unknown[] } };
  /** The identified entity's type for this handle. */
  entityType?: FenelType;
  /** B4 F2: with `entityType`, the identified entity's id and the registry's
   * nominal identity for the handle (a record constructor's caption). */
  entityOwner?: { id: string; module?: string; nominalIdentity?: string };
  /** The handle of the identified function this source name declares
   * (`getIdentifiedFunction`), kept apart from `fn` so catalogue resolution
   * keeps its exact `getFunction` meaning. */
  identifiedHandle?: string;
  /** Only when the request asks for `definitions` (B4 unit E, the Local API
   * client's name lookups): this registry's own `getIdentifiedEntity` and
   * `getFunction` answers for the name, as the page read them. Such a reply
   * carries nothing else. */
  definition?: ReaderDefinitionLookup;
};
export type AuthoringReaderReferences = { references: Array<{ target: string; reference?: ReaderCatalogReference }> };
/** The exact lookups the page's Local `catalogLookups` ran on its own
 * registry, evaluated here in the worker frame of the request's session. */
export function projectReaderReferences(targets: readonly string[], session: AuthoringSession,
  definitions = false): AuthoringReaderReferences {
  return { references: targets.map(target => {
    // B4 unit E: a definitions request answers only the registry's two
    // lookups; the frame's catalogue lookups would duplicate `fn` and the type.
    if (definitions) {
      const definition = readerDefinitionLookup(target, session);
      return definition ? { target, reference: { definition } } : { target };
    }
    const fn = session.evaluateContext.getFunction?.(target) as FenelFunction | undefined;
    const owner = session.evaluateContext._typeFamilyOwner?.(target) as ReaderCatalogReference["typeFamilyOwner"];
    const entity = session.registry.getIdentifiedEntity(target);
    const entityType = entity?.type;
    const nominalIdentity = entity ? session.registry.getEntityNominalIdentity?.(target) : undefined;
    const identified = session.registry.getIdentifiedFunction?.(target);
    const identifiedHandle = identified ? session.registry.getUuid(identified.id) ?? identified.id : undefined;
    if (!fn && !owner && entityType === undefined && !identifiedHandle) return { target };
    const reference: ReaderCatalogReference = {
      ...(fn ? { fn, handle: session.registry.getUuid(fn.id) ?? fn.id } : {}),
      ...(owner ? { typeFamilyOwner: owner } : {}),
      ...(entityType !== undefined ? { entityType, entityOwner: { id: entity!.id,
        ...(entity!.module !== undefined ? { module: entity!.module } : {}),
        ...(nominalIdentity !== undefined ? { nominalIdentity } : {}) } } : {}),
      ...(identifiedHandle ? { identifiedHandle } : {}),
    };
    return { target, reference };
  }) };
}

export type ReaderDefinitionLookup = {
  /** `getIdentifiedEntity(name)`: the identified entity's id and type. */
  entity?: { id: string; type: FenelType };
  /** `getFunction(name)` (the registry's lookup, not the frame's). */
  fn?: FenelFunction;
};

function readerDefinitionLookup(target: string, session: AuthoringSession): ReaderDefinitionLookup | undefined {
  const entity = session.registry.getIdentifiedEntity(target);
  const fn = session.registry.getFunction(target);
  if (!entity && !fn) return undefined;
  return { ...(entity ? { entity: { id: entity.id, type: entity.type } } : {}), ...(fn ? { fn } : {}) };
}

