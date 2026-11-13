import { carryCanonicalEntityProjectionOrigin, observeOwnerModuleRoleInput, observeOwnerModuleRoleRoster } from "./owner-input-provenance";
// BOUNDARY-ADAPTER
import { engineRequire } from "./engine-require";
import type { ModuleRegistry } from "./registry";
import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
} from "./self-host-immutable-data";
import type { FenelFunction, FenelModule } from "./types";
import { projectEntityFieldFacetDirectives } from "./field-representations";

type IdentifiedEntity = ReturnType<ModuleRegistry["listIdentifiedEntities"]>[number];

export type RepositoryCompilerMetadataView = {
  /** Exact canonical function-id lookup. Bare Codeable aliases are deliberately
   * excluded: a compiler metadata view must never inherit registry last-wins
   * short-name routing. */
  readonly getIdentifiedFunction: (fnId: string) => FenelFunction | undefined;
  readonly listIdentifiedEntities: () => readonly IdentifiedEntity[];
};

export type RepositoryCompilerConstructorMetadataView = Pick<
  RepositoryCompilerMetadataView,
  "listIdentifiedEntities"
>;

type FunctionSource = {
  readonly moduleName: string;
  readonly functionNamespace: string;
  readonly exactDefinition: FenelFunction;
  readonly profileIndexes: Set<number>;
};

type FunctionNamespacePolicy = {
  readonly moduleName: string;
  readonly namespaceFor: (functionId: string) => string | undefined;
};

export type ExactFunctionNamespaceModule = {
  readonly name: string;
  readonly functionNamespace?: string;
  readonly functionNamespaceOverrides?: readonly {
    readonly functionId: string;
    readonly namespace: string;
  }[];
};

export type ExactRepositoryCompilerFunctionModule = ExactFunctionNamespaceModule & {
  readonly functions?: readonly FenelFunction[];
};

export type ExactRepositoryCompilerModuleFunctionProjection = {
  readonly moduleName: string;
  readonly exactDefinitions: readonly FenelFunction[];
  readonly functionIds: readonly string[];
  readonly namespacePolicy: FunctionNamespacePolicy;
};

export type ExactRepositoryCompilerEntityModule = Pick<
  FenelModule,
  "name" | "entities" | "fieldFacetDirectives"
>;

let cached: RepositoryCompilerMetadataView | undefined;
let constructorCached: RepositoryCompilerConstructorMetadataView | undefined;

/** Clone a compiler-metadata data graph without invoking accessors. The clone
 * preserves null prototypes, hostile own keys, non-enumerable data, aliases,
 * and cycles, and is deeply frozen before crossing the tooling boundary. */
export function exactRepositoryCompilerMetadataSnapshot<T>(
  value: T,
  context: string,
  errorPrefix = "repository compiler metadata",
): T {
  const snapshot = exactImmutableDataSnapshot(value);
  if (snapshot.status === "uncacheable") {
    throw new Error(`${errorPrefix}: ${context} cannot be isolated: ${snapshot.reason}`);
  }
  return snapshot.value;
}

function exactFunctionId(fn: FenelFunction, context: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(fn, "id");
  if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new Error(`repository compiler metadata: ${context} must have an own string id data property`);
  }
  if (descriptor.value.length === 0) {
    throw new Error(`repository compiler metadata: ${context} id must be non-empty`);
  }
  return descriptor.value;
}

export function assertExactRepositoryFunctionOwner(
  moduleName: string,
  fnId: string,
  functionNamespace = moduleName,
  context = "repository compiler metadata",
): void {
  const ownerPrefix = `${functionNamespace}:`;
  if (
    moduleName.length === 0
    || functionNamespace.length === 0
    || functionNamespace.includes(":")
    || !fnId.startsWith(ownerPrefix)
    || fnId.length === ownerPrefix.length
  ) {
    throw new Error(
      `${context}: function ${fnId} is not owned by defining module ${moduleName} `
        + `(expected namespace ${functionNamespace}:<non-empty local name>)`,
    );
  }
}

function exactOwnDataValue(
  source: object,
  key: string,
  context: string,
  errorPrefix = "repository compiler metadata",
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) {
    if (key in source) {
      throw new Error(`${errorPrefix}: ${context} must not be inherited`);
    }
    return { present: false };
  }
  if (!("value" in descriptor)) {
    throw new Error(`${errorPrefix}: ${context} must be an own data property`);
  }
  return { present: true, value: descriptor.value };
}

/** Capture the narrow source-module envelope needed by compiler ownership.
 * The repository module also carries native functions and runtime handlers,
 * so snapshotting the whole object would be both over-broad and impossible.
 * Capture each relevant own data descriptor exactly once, isolate the Fenel
 * function roster, then resolve policy from a stable ordinary projection. */
export function exactRepositoryCompilerModuleFunctionProjection(
  sourceModule: ExactRepositoryCompilerFunctionModule,
  context = "source module",
): ExactRepositoryCompilerModuleFunctionProjection {
  const nameSlot = exactOwnDataValue(sourceModule, "name", `${context} name`);
  if (!nameSlot.present || typeof nameSlot.value !== "string" || nameSlot.value.length === 0) {
    throw new Error(
      `repository compiler metadata: ${context} name must be an own non-empty string data property`,
    );
  }
  const moduleName = nameSlot.value;
  const functionsSlot = exactOwnDataValue(
    sourceModule,
    "functions",
    `${context} ${moduleName} functions`,
  );
  const namespaceSlot = exactOwnDataValue(
    sourceModule,
    "functionNamespace",
    `${context} ${moduleName} functionNamespace`,
  );
  const overridesSlot = exactOwnDataValue(
    sourceModule,
    "functionNamespaceOverrides",
    `${context} ${moduleName} functionNamespaceOverrides`,
  );
  const rawFunctions = functionsSlot.present ? functionsSlot.value : [];
  if (!Array.isArray(rawFunctions)) {
    throw new Error(
      `repository compiler metadata: ${context} ${moduleName} functions must be an array`,
    );
  }
  const exactDefinitions = exactRepositoryCompilerMetadataSnapshot(
    rawFunctions,
    `${context} ${moduleName} functions`,
  ) as readonly FenelFunction[];
  const functionIds = Object.freeze(exactDefinitions.map((fn, functionIndex) =>
    exactFunctionId(fn, `${context} ${moduleName} function[${functionIndex}]`)
  ));
  if (new Set(functionIds).size !== functionIds.length) {
    throw new Error(
      `repository compiler metadata: ${context} ${moduleName} function roster contains duplicate ids`,
    );
  }

  const stablePolicyModule = Object.create(null) as {
    name: string;
    functionNamespace?: string;
    functionNamespaceOverrides?: readonly {
      readonly functionId: string;
      readonly namespace: string;
    }[];
  };
  Object.defineProperty(stablePolicyModule, "name", {
    value: moduleName,
    enumerable: true,
  });
  if (namespaceSlot.present) {
    Object.defineProperty(stablePolicyModule, "functionNamespace", {
      value: namespaceSlot.value,
      enumerable: true,
    });
  }
  if (overridesSlot.present) {
    Object.defineProperty(stablePolicyModule, "functionNamespaceOverrides", {
      value: overridesSlot.value,
      enumerable: true,
    });
  }
  const namespacePolicy = exactRepositoryFunctionNamespacePolicy(
    stablePolicyModule,
    functionIds,
  );
  return Object.freeze({
    moduleName,
    exactDefinitions,
    functionIds,
    namespacePolicy,
  });
}

/** Project only the repository-owned inputs that can affect identified entity
 * and field-facet metadata. Function/signature/runtime slots are deliberately
 * never read: constructor reflection must not trigger function inference, and
 * a hostile irrelevant accessor must not gain execution at this boundary. */
export function exactRepositoryCompilerModuleEntityProjection(
  sourceModule: ExactRepositoryCompilerEntityModule,
  context = "source module",
): FenelModule {
  const nameSlot = exactOwnDataValue(sourceModule, "name", `${context} name`);
  if (!nameSlot.present || typeof nameSlot.value !== "string" || nameSlot.value.length === 0) {
    throw new Error(
      `repository compiler metadata: ${context} name must be an own non-empty string data property`,
    );
  }
  const moduleName = nameSlot.value;
  const entitiesSlot = exactOwnDataValue(
    sourceModule,
    "entities",
    `${context} ${moduleName} entities`,
  );
  const rawEntities = entitiesSlot.present ? entitiesSlot.value : [];
  if (!Array.isArray(rawEntities)) {
    throw new Error(
      `repository compiler metadata: ${context} ${moduleName} entities must be an array`,
    );
  }
  const entities = exactRepositoryCompilerMetadataSnapshot(
    rawEntities,
    `${context} ${moduleName} entities`,
  ) as NonNullable<FenelModule["entities"]>;

  const directivesSlot = exactOwnDataValue(
    sourceModule,
    "fieldFacetDirectives",
    `${context} ${moduleName} fieldFacetDirectives`,
  );
  let fieldFacetDirectives: NonNullable<FenelModule["fieldFacetDirectives"]> | undefined;
  if (directivesSlot.present) {
    if (!Array.isArray(directivesSlot.value)) {
      throw new Error(
        `repository compiler metadata: ${context} ${moduleName} fieldFacetDirectives must be an array`,
      );
    }
    const admittedDirectives = exactRepositoryCompilerMetadataSnapshot(
      directivesSlot.value,
      `${context} ${moduleName} fieldFacetDirectives`,
    ) as NonNullable<FenelModule["fieldFacetDirectives"]>;
    fieldFacetDirectives = Object.freeze(projectEntityFieldFacetDirectives(admittedDirectives)) as NonNullable<FenelModule["fieldFacetDirectives"]>;
  }

  const projected = Object.freeze({
    name: moduleName,
    label: `Compiler entity projection for ${moduleName}`,
    entities,
    ...(fieldFacetDirectives === undefined ? {} : { fieldFacetDirectives }),
  });
  carryCanonicalEntityProjectionOrigin(sourceModule, projected);
  return projected;
}

/** Validate one module's exact function-id namespace policy without consulting
 * registry routing or inferring a namespace from a function id. Exported only
 * so focused policy tests can exercise hostile metadata envelopes directly. */
export function exactRepositoryFunctionNamespacePolicy(
  sourceModule: ExactFunctionNamespaceModule,
  functionIds: readonly string[],
  context = "repository compiler metadata",
): FunctionNamespacePolicy {
  const nameSlot = exactOwnDataValue(sourceModule, "name", "module name", context);
  if (!nameSlot.present || typeof nameSlot.value !== "string" || nameSlot.value.length === 0) {
    throw new Error(`${context}: module name must be an own non-empty string data property`);
  }
  const moduleName = nameSlot.value;
  const namespaceSlot = exactOwnDataValue(
    sourceModule,
    "functionNamespace",
    `module ${moduleName} functionNamespace`,
    context,
  );
  const defaultNamespace = namespaceSlot.present ? namespaceSlot.value : moduleName;
  if (
    typeof defaultNamespace !== "string"
    || defaultNamespace.length === 0
    || defaultNamespace.includes(":")
  ) {
    throw new Error(
      `${context}: module ${moduleName} functionNamespace must be a non-empty colon-free string`,
    );
  }

  const overridesSlot = exactOwnDataValue(
    sourceModule,
    "functionNamespaceOverrides",
    `module ${moduleName} functionNamespaceOverrides`,
    context,
  );
  const rawOverrides = overridesSlot.present ? overridesSlot.value : [];
  const overrides = exactRepositoryCompilerMetadataSnapshot(
    rawOverrides,
    `module ${moduleName} function namespace overrides`,
    context,
  );
  if (!Array.isArray(overrides)) {
    throw new Error(
      `${context}: module ${moduleName} functionNamespaceOverrides must be an array`,
    );
  }
  const knownIds = new Set(functionIds);
  const byFunctionId = new Map<string, string>();
  for (let index = 0; index < overrides.length; index += 1) {
    const entry = overrides[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `${context}: module ${moduleName} namespace override ${index} must be a record`,
      );
    }
    const functionIdSlot = exactOwnDataValue(
      entry,
      "functionId",
      `module ${moduleName} namespace override ${index} functionId`,
      context,
    );
    const namespaceValueSlot = exactOwnDataValue(
      entry,
      "namespace",
      `module ${moduleName} namespace override ${index} namespace`,
      context,
    );
    if (
      !functionIdSlot.present
      || typeof functionIdSlot.value !== "string"
      || functionIdSlot.value.length === 0
      || !namespaceValueSlot.present
      || typeof namespaceValueSlot.value !== "string"
      || namespaceValueSlot.value.length === 0
    ) {
      throw new Error(
        `${context}: module ${moduleName} namespace override ${index} must carry non-empty functionId/namespace strings`,
      );
    }
    if (!knownIds.has(functionIdSlot.value)) {
      throw new Error(
        `${context}: module ${moduleName} namespace override targets absent function ${functionIdSlot.value}`,
      );
    }
    if (byFunctionId.has(functionIdSlot.value)) {
      throw new Error(
        `${context}: module ${moduleName} has duplicate namespace overrides for ${functionIdSlot.value}`,
      );
    }
    byFunctionId.set(functionIdSlot.value, namespaceValueSlot.value);
  }
  const resolved = new Map<string, string>();
  for (const functionId of functionIds) {
    const namespace = byFunctionId.get(functionId) ?? defaultNamespace;
    assertExactRepositoryFunctionOwner(moduleName, functionId, namespace, context);
    resolved.set(functionId, namespace);
  }
  return Object.freeze({
    moduleName,
    namespaceFor: (functionId: string) => resolved.get(functionId),
  });
}

/** Cross-profile agreement is separate from prefix validity: repeated source
 * rows must retain both the same display/container module and the same exact
 * resolved function namespace before their definition graphs may deduplicate. */
export function assertExactRepositoryFunctionNamespaceAgreement(
  fnId: string,
  priorModuleName: string,
  priorNamespace: string,
  moduleName: string,
  functionNamespace: string,
  context = "repository compiler metadata",
): void {
  if (priorModuleName !== moduleName) {
    throw new Error(
      `${context}: function ${fnId} has conflicting defining modules `
        + `${priorModuleName}/${moduleName}`,
    );
  }
  if (priorNamespace !== functionNamespace) {
    throw new Error(
      `${context}: function ${fnId} has conflicting function namespaces `
        + `${priorNamespace}/${functionNamespace}`,
    );
  }
}

/** Identity-total compiler metadata over the exact independently-normalized
 * repository profile union used by the lock/catalog generators. Profiles stay
 * separate so nominal ownership/dedup order cannot drift. Repeated function
 * ids must have exactly equal own-data graphs before the first normalized projection can win;
 * constructor spellings remain unscoped and therefore omit semantic-owner
 * collisions until a caller supplies an explicit owner to the slot builder. */
export function getRepositoryCompilerMetadataView(): RepositoryCompilerMetadataView {
  if (cached !== undefined) return cached;
  // This view is generator/classifier tooling, not an engine bootstrap input.
  // Keep its module surface inert: eagerly importing these four namespaces
  // creates repository-identity-modules -> engineModule -> registry <-
  // system-entities cycles while unrelated Bun test files are still
  // initializing. Runtime lookup preserves the intended boundary and occurs
  // only when tooling explicitly asks for the repository-wide compiler view.
  const {
    REPOSITORY_IDENTITY_MANIFEST,
    repositoryIdentityLock,
  } = engineRequire<typeof import("./repository-identity-manifest")>(
    "repository-identity-manifest",
  );
  const { repositoryIdentityProfiles } = engineRequire<
    typeof import("./repository-identity-modules")
  >("repository-identity-modules");
  const { createRegistry } = engineRequire<
    typeof import("./registry")
  >("registry");
  const { dispatchRegistry } = engineRequire<typeof import("./system-entities")>(
    "system-entities",
  );
  const profiles = repositoryIdentityProfiles();
  const functionSources = new Map<string, FunctionSource>();
  profiles.forEach((profile, profileIndex) => {
    profile.modules.forEach((profileModule, moduleIndex) => {
      const {
        exactDefinitions,
        functionIds,
        namespacePolicy,
      } = exactRepositoryCompilerModuleFunctionProjection(
        profileModule,
        `source profile[${profileIndex}] module[${moduleIndex}]`,
      );
      for (let functionIndex = 0; functionIndex < exactDefinitions.length; functionIndex += 1) {
        const exactDefinition = exactDefinitions[functionIndex]!;
        const fnId = functionIds[functionIndex]!;
        const functionNamespace = namespacePolicy.namespaceFor(fnId)!;
        const prior = functionSources.get(fnId);
        if (prior === undefined) {
          functionSources.set(fnId, {
            moduleName: namespacePolicy.moduleName,
            functionNamespace,
            exactDefinition,
            profileIndexes: new Set([profileIndex]),
          });
          continue;
        }
        assertExactRepositoryFunctionNamespaceAgreement(
          fnId,
          prior.moduleName,
          prior.functionNamespace,
          namespacePolicy.moduleName,
          functionNamespace,
        );
        if (!exactImmutableDataEqual(prior.exactDefinition, exactDefinition)) {
          throw new Error(
            `repository compiler metadata: function ${fnId} has conflicting profile definitions`,
          );
        }
        prior.profileIndexes.add(profileIndex);
      }
    });
  });

  const lock = repositoryIdentityLock();
  const registryOptions = (profileId: string) => ({
      dispatchRegistry,
      codeNameLock: lock,
      publishCatalogEntities: false,
      fieldIdentity: {
        mode: "strict-embedded",
        defaultRealm: "repository-source",
        lock,
        cacheKey: `compiler-metadata:${profileId}:${REPOSITORY_IDENTITY_MANIFEST.digest}`,
      },
    } as const);
  const entities = getRepositoryCompilerConstructorMetadataView()
    .listIdentifiedEntities();
  // Effective functions are required only by compiler/classifier callers.
  // Build the exact semantic profile on first lookup, never while a caller is
  // merely asking for constructor ownership. `null` records a profile with no
  // semantic projection so repeated misses remain finite.
  const semanticRegistries: Array<ModuleRegistry | null | undefined> =
    profiles.map(() => undefined);
  const semanticRegistryAt = (profileIndex: number): ModuleRegistry | undefined => {
    const prior = semanticRegistries[profileIndex];
    if (prior !== undefined) return prior ?? undefined;
    const profile = profiles[profileIndex]!;
    const semanticModules = profile.signatureJudgment === "authoritative"
      ? profile.modules
      : profile.compilerSemanticModules;
    const registry = semanticModules === undefined
      ? null
      : createRegistry(
          [...semanticModules],
          registryOptions(`semantic:${profile.id}`),
        );
    semanticRegistries[profileIndex] = registry;
    return registry ?? undefined;
  };
  const identifiedFunctionCache = new Map<string, FenelFunction | undefined>();

  const getIdentifiedFunction = (fnId: string): FenelFunction | undefined => {
    if (identifiedFunctionCache.has(fnId)) return identifiedFunctionCache.get(fnId);
    const exact = functionSources.get(fnId);
    if (exact === undefined) {
      identifiedFunctionCache.set(fnId, undefined);
      return undefined;
    }
    // Preserve repository profile order. Effective inferred schemes can depend
    // on the surrounding semantic topology, so a smaller compiler profile may
    // not replace an earlier authoritative product profile merely as an
    // optimization.
    for (const profileIndex of exact.profileIndexes) {
      // `fnId` came from this profile's exact source roster. Do not fall back to
      // the registry's Codeable lookup: it is intentionally last-wins and is not
      // valid compiler ownership authority when short aliases collide.
      const identified = semanticRegistryAt(profileIndex)?.getIdentifiedFunction(fnId);
      if (identified !== undefined) {
        const immutable = exactRepositoryCompilerMetadataSnapshot(
          identified,
          `identified function ${fnId}`,
        );
        if (exactFunctionId(immutable, `identified function ${fnId}`) !== fnId) {
          continue;
        }
        identifiedFunctionCache.set(fnId, immutable);
        return immutable;
      }
    }
    throw new Error(
      `repository compiler metadata: ${fnId} is present in source ownership but absent from its normalized profile`,
    );
  };

  cached = Object.freeze({
    getIdentifiedFunction,
    listIdentifiedEntities: () => entities,
  });
  return cached;
}

/** Constructor-only tooling surface. Each repository profile retains its
 * exact order, lock, dispatch authority, entity schemes, and type-owned field
 * directives, while every function/signature/runtime slot is absent before
 * registry ingress. This makes the facade independent of function judgment
 * rather than merely deferring that judgment behind the full metadata view. */
export function getRepositoryCompilerConstructorMetadataView():
RepositoryCompilerConstructorMetadataView {
  if (constructorCached !== undefined) return constructorCached;
  const {
    repositoryIdentityLock,
  } = engineRequire<typeof import("./repository-identity-manifest")>(
    "repository-identity-manifest",
  );
  const { repositoryIdentityEntityProfiles } = engineRequire<
    typeof import("./repository-identity-modules")
  >("repository-identity-modules");
  const { createIdentityProjectionRegistry } = engineRequire<
    typeof import("./registry")
  >("registry");
  const { dispatchRegistry } = engineRequire<typeof import("./system-entities")>(
    "system-entities",
  );
  const profiles = repositoryIdentityEntityProfiles();
  profiles.forEach((profile, index) => observeOwnerModuleRoleRoster(
    "constructor", `compiler-constructor/profile[${index}]/${profile.id}`, profile.modules,
  ));
  const lock = repositoryIdentityLock();
  const identityRegistries = profiles.map((profile, profileIndex) =>
    createIdentityProjectionRegistry(
      observeOwnerModuleRoleInput("constructor", `compiler-constructor/profile[${profileIndex}]/${profile.id}`, profile.modules.map((profileModule, moduleIndex) =>
        exactRepositoryCompilerModuleEntityProjection(
          profileModule,
          `constructor profile[${profileIndex}] module[${moduleIndex}]`,
        )
      )),
      {
        dispatchRegistry,
        codeNameLock: lock,
        publishCatalogEntities: false,
        fieldIdentity: {
          mode: "strict-embedded",
          defaultRealm: "repository-source",
          lock,
        },
      },
    )
  );
  const entities = exactRepositoryCompilerMetadataSnapshot(
    identityRegistries.flatMap((registry) => registry.listIdentifiedEntities()),
    "identified entity roster",
  );
  constructorCached = Object.freeze({
    listIdentifiedEntities: () => entities,
  });
  return constructorCached;
}
