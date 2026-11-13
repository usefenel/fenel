// Explicit product registry constructors for field-identity Phase 2a. This is
// the only browser/runtime edge to the generated physical repository lock.
import { carryOwnerRegistryInput } from "./owner-input-provenance";
import {
  createRegistry,
  createRegistryAsync,
  type CreateRegistryOptions,
  type ModuleRegistry,
} from "./registry";
import {
  REPOSITORY_IDENTITY_MANIFEST,
  repositoryIdentityKinds,
  repositoryIdentityLock,
} from "./repository-identity-manifest";
import type {
  BodyFieldSpellingPolicy,
  ExternalFieldDescriptor,
  FieldIdentityRealm,
} from "./field-identity";
import type { FenelModule } from "./types";
import { repositoryFieldFacetModule } from "./repository-field-facet-module";
import { REPOSITORY_PARTITION, withEngineBodyMemoPartition } from "./engine-body-memo";
import { dispatchRegistry as systemDispatchRegistry } from "./system-entities";

type SharedRegistryOptions = Omit<
  CreateRegistryOptions,
  "codeNameLock" | "fieldIdentity" | "publishCatalogEntities"
>;

/** Repository source in product/runtime mode. Every declaration must be pinned
 * by the embedded full physical lock; missing rows are fatal. */
export function createRepositoryRegistry(
  modules: FenelModule[],
  options: SharedRegistryOptions = {},
): ModuleRegistry {
  const lock = repositoryIdentityLock();
  // S1 engine-body memo — a repository build's kernel inputs are repository
  // data, so its caller-less engine-body calls may share the public
  // "repository" memo partition. That holds on the system dispatch pool
  // (omitted, or passed explicitly as the authoring worker does); another
  // caller-supplied pool may carry account rows, so such a build opens no
  // partition (no memo). Synchronous only: the async variant opens none.
  const build = (): ModuleRegistry => createRegistry(carryOwnerRegistryInput(modules, [...modules, repositoryFieldFacetModule()]), {
    ...options,
    codeNameLock: lock,
    fieldIdentity: {
      mode: "strict-embedded",
      defaultRealm: "repository-source",
      lock,
      identityKinds: repositoryIdentityKinds(),
      cacheKey: `repository:${REPOSITORY_IDENTITY_MANIFEST.digest}`,
      bodySpellingPolicy: "reject",
    },
  });
  return options.dispatchRegistry === undefined || options.dispatchRegistry === systemDispatchRegistry
    ? withEngineBodyMemoPartition(REPOSITORY_PARTITION, build)
    : build();
}

/** Browser-friendly equivalent of the complete, checked repository build. */
export function createRepositoryRegistryAsync(
  modules: FenelModule[],
  options: SharedRegistryOptions = {},
): Promise<ModuleRegistry> {
  const lock = repositoryIdentityLock();
  return createRegistryAsync(carryOwnerRegistryInput(modules, [...modules, repositoryFieldFacetModule()]), {
    ...options,
    codeNameLock: lock,
    fieldIdentity: {
      mode: "strict-embedded",
      defaultRealm: "repository-source",
      lock,
      identityKinds: repositoryIdentityKinds(),
      cacheKey: `repository:${REPOSITORY_IDENTITY_MANIFEST.digest}`,
      bodySpellingPolicy: "reject",
    },
  });
}

/** C2 generator constructor. It deliberately consumes the current physical
 * disk union rather than the possibly stale embedded artifact. Because missing
 * field ids are the output of this pass, its SourceHandle-bearing views stop
 * before signature judgment; the generator's following StrictEmbedded rebuild
 * is the authoritative signature gate. */
export function createRepositoryRequirementsRegistry(
  modules: FenelModule[],
  physicalLock: ReadonlyMap<string, string>,
  options: SharedRegistryOptions = {},
): ModuleRegistry {
  const lock = new Map(physicalLock);
  return createRegistry([...modules, repositoryFieldFacetModule()], {
    ...options,
    codeNameLock: lock,
    fieldIdentity: {
      mode: "collect-requirements",
      defaultRealm: "repository-source",
      lock,
    },
  });
}

/** Explicit source-handle constructor for tools/tests only. */
export function createRepositorySourceRegistry(
  modules: FenelModule[],
  options: SharedRegistryOptions = {},
): ModuleRegistry {
  return createRegistry([...modules, repositoryFieldFacetModule()], {
    ...options,
    fieldIdentity: {
      mode: "source-handles",
      defaultRealm: "repository-source",
    },
  });
}

export type AccountRegistryOptions = SharedRegistryOptions & {
  readonly externalFields?: readonly ExternalFieldDescriptor[];
  readonly identityKinds?: ReadonlyMap<string, string>;
  /** Direct/new account registries reject by default. The committed-snapshot
   * adapter alone selects `defer-legacy-db` for boot compatibility. */
  readonly bodySpellingPolicy?: BodyFieldSpellingPolicy;
};

/** Mixed product registry. Realm assignment is by the exact module objects the
 * caller placed in each array, never by a code/module name. Repository roots
 * use the embedded lock; account roots must carry explicit UUID field keys. */
export function createAccountRegistry(
  repositoryModules: FenelModule[],
  accountModules: FenelModule[],
  options: AccountRegistryOptions = {},
): ModuleRegistry {
  const inputs = accountRegistryInputs(repositoryModules, accountModules, options);
  return createRegistry(inputs.modules, inputs.options);
}

export function createAccountRegistryAsync(
  repositoryModules: FenelModule[],
  accountModules: FenelModule[],
  options: AccountRegistryOptions = {},
): Promise<ModuleRegistry> {
  const inputs = accountRegistryInputs(repositoryModules, accountModules, options);
  return createRegistryAsync(inputs.modules, inputs.options);
}

/** Isolated tab-authored definitions use the same product fences with the
 * existing transient realm. A source coordinate confers no account authority. */
export function createLocalRegistry(repositoryModules: FenelModule[], localModules: FenelModule[],
  options: AccountRegistryOptions = {}): ModuleRegistry {
  const inputs = accountRegistryInputs(repositoryModules, localModules, options, "transient-draft");
  return createRegistry(inputs.modules, inputs.options);
}

export function createLocalRegistryAsync(repositoryModules: FenelModule[], localModules: FenelModule[],
  options: AccountRegistryOptions = {}): Promise<ModuleRegistry> {
  const inputs = accountRegistryInputs(repositoryModules, localModules, options, "transient-draft");
  return createRegistryAsync(inputs.modules, inputs.options);
}

function accountRegistryInputs(
  repositoryModules: FenelModule[],
  accountModules: FenelModule[],
  options: AccountRegistryOptions,
  authoredRealm: FieldIdentityRealm = "account-authored",
): { modules: FenelModule[]; options: CreateRegistryOptions } {
  const lock = repositoryIdentityLock();
  // S2 starts from public repository kinds; every authored addition remains
  // in the separate complete map that Delta and full normalization receive.
  const baseIdentityKinds = repositoryIdentityKinds();
  const identityKinds = new Map(baseIdentityKinds);
  if (options.identityKinds !== undefined) {
    for (const [id, kind] of options.identityKinds) {
      const prior = identityKinds.get(id);
      if (prior !== undefined && prior !== kind) {
        throw new Error(
          `account registry: UUID ${id} has conflicting identity kinds ${prior}/${kind}`,
        );
      }
      identityKinds.set(id, kind);
    }
  }
  const moduleRealms = new Map<FenelModule, FieldIdentityRealm>();
  for (const repositoryModule of repositoryModules) {
    moduleRealms.set(repositoryModule, "repository-source");
  }
  for (const accountModule of accountModules) {
    if (moduleRealms.has(accountModule)) {
      throw new Error(
        `account registry: module object ${JSON.stringify(accountModule.name)} cannot be both repository and account authored`,
      );
    }
    moduleRealms.set(accountModule, authoredRealm);
  }
  const {
    externalFields,
    identityKinds: _callerKinds,
    bodySpellingPolicy = "reject",
    ...registryOptions
  } = options;
  return { modules: [...repositoryModules, repositoryFieldFacetModule(), ...accountModules], options: {
    ...registryOptions,
    // Account-authored entity definitions are scoped to this registry. Never
    // leak them into the process-global first-registration-wins type catalog.
    publishCatalogEntities: false,
    codeNameLock: lock,
    fieldIdentity: {
      mode: "strict-embedded",
      defaultRealm: "repository-source",
      moduleRealms,
      lock,
      ...(externalFields === undefined ? {} : { externalFields }),
      identityKinds,
      baseIdentityKinds,
      // S2: a build without account/Local roots still keeps the base the next
      // build with one extends (an empty delta; the Fenel delta decides).
      emptyDeltaBase: true,
      bodySpellingPolicy,
      ...(externalFields === undefined && _callerKinds === undefined
        ? { cacheKey: `account:${REPOSITORY_IDENTITY_MANIFEST.digest}` }
        : {}),
    },
  } };
}
