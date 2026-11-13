// Public registry facade. The private bootstrap factory and raw field-identity
// context intentionally remain reachable only through internal relative imports
// of `registry.ts`; product intent is expressed by repository-registry.ts.
import {
  createRegistry as createLegacyRegistry,
  type CreateRegistryOptions as InternalCreateRegistryOptions,
  type ModuleRegistry,
} from "./registry";
import type { FenelModule } from "./types";

export type CreateRegistryOptions = Pick<
  InternalCreateRegistryOptions,
  "dispatchRegistry" | "codeNameLock"
>;

/** Legacy ad-hoc/test constructor: repository SourceHandles only. Product code
 * is source-gated to the explicit repository/account constructors below. */
export function createRegistry(
  modules: FenelModule[],
  options: CreateRegistryOptions = {},
): ModuleRegistry {
  return createLegacyRegistry(modules, options);
}

export type {
  ModuleRegistry,
  RegistryCapabilityMethodSignature,
  RegistryConstructorSignature,
  RoutingTableValue,
} from "./registry";
export type {
  FunctionSignatureInfo,
  ImplementationOrigin,
  InferenceOutcome,
  Kind,
  SchemeApplication,
  SchemeVar,
  SignatureTrust,
  SlotDeclaration,
  TypeScheme,
} from "./types";
export {
  createAccountRegistry,
  createRepositoryRegistry,
  createRepositoryRequirementsRegistry,
  createRepositorySourceRegistry,
  type AccountRegistryOptions,
} from "./repository-registry";
