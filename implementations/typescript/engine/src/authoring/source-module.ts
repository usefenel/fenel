// Existing source-loader / FieldKey marshalling boundary. The Fenel field
// kernel owns occurrence selection and identity projection; the host supplies
// optional UUID entropy and persists only its explicit lock, never schemes.
import { loadFenelModule } from "../fenel-module";
import {
  identifiedDefinitionView, normalizeFieldDeclarations,
  type ExternalFieldDescriptor, type FieldDeclarationRootInput,
} from "../field-identity";
import { createAccountRegistry,
  createAccountRegistryAsync, createRepositoryRegistry } from "../repository-registry";
import { SYSTEM_REGISTRY_MODULES } from "../system-registry-modules";
import type { FenelModule } from "../types";
import type { ModuleRegistry } from "../registry";
import { moduleSourceCoordinate, withImports, type EvaluateContext } from "../json-logic";
import { getCatalog, type CatalogSection } from "../type-catalog";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./environment";
import {
  bindInstanceMethodValue, bindMethodValue, carryInstanceProvenance, createDispatchRegistry, lowerMaybeFunctionReferences,
  withoutInstanceDeclaration, type DispatchRegistry,
} from "../dispatch-registry";
import { dispatchRegistry as repositoryDispatchRegistry } from "../system-entities";
import { seedFromType } from "../effect-dispatch";
import { sha256Bytes } from "../validation-canonical-bytes";
import { dispatchEngineBody } from "../engine-bodies-dispatch";
import { modulesFor } from "../module-manifest";
import { projectAccountFieldRegistrySnapshot } from "../account-field-registry";
import type { FieldPersistenceSnapshot } from "../field-authoring";
export { DIRECTIVE_POLICY } from "../fenel-module";

export type SourceModuleIdentity = {
  readonly version: 1;
  readonly fields: readonly (readonly [string, string])[];
};
export type SourceModuleDocument = {
  readonly id: string;
  readonly slug: string;
  readonly version: string;
  readonly source: string;
  readonly contentHash?: string;
  readonly namespace?: string;
  readonly identity?: SourceModuleIdentity;
};

export type InstalledSourceModuleRow = {
  readonly registry: {
    readonly id?: string; readonly source: string; readonly slug: string; readonly version?: string;
    readonly contentHash?: string; readonly module?: Record<string, unknown> | null;
    readonly dependencies?: readonly { readonly registry: string; readonly version: string }[];
  };
};

/** Browser/server use the same existing SHA-256 host-byte primitive. */
export function sourceModuleContentHash(source: string): string {
  return Array.from(sha256Bytes(new TextEncoder().encode(source)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Registry coordinates are account/file pairs; this is the documented file
 * namespace fallback when source has no module header, not an opaque fn ID. */
export function sourceModuleFallbackName(slug: string): string { return slug.slice(slug.lastIndexOf("/") + 1); }

export function sortedSourceModuleRows<T extends InstalledSourceModuleRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    (left.registry.id ?? "").localeCompare(right.registry.id ?? "")
    || left.registry.slug.localeCompare(right.registry.slug)
    || (left.registry.version ?? "").localeCompare(right.registry.version ?? ""));
}

export function sourceModuleRowsFingerprint(rows: readonly InstalledSourceModuleRow[]): string {
  return JSON.stringify(sortedSourceModuleRows(rows).map(({ registry }) => [registry.id, registry.slug, registry.contentHash ?? sourceModuleContentHash(registry.source), registry.version, registry.module?.sourceNamespace, registry.module?.sourceIdentity, [...(registry.dependencies ?? [])].sort((a, b) => a.registry.localeCompare(b.registry) || a.version.localeCompare(b.version))]));
}
export type PreparedSourceModule = {
  readonly module: FenelModule;
  readonly identity: SourceModuleIdentity;
  readonly fields: readonly ExternalFieldDescriptor[];
  readonly registryId?: string;
};

/** Database/runtime rows may wrap a registry document in `registry`. The only
 * carried module metadata admitted here is the server-owned FieldKey lock. */
export function prepareSourceModulesFromRows(rows: readonly InstalledSourceModuleRow[]): PreparedSourceModule[] {
  const sorted = sortedSourceModuleRows(rows);
  const prepared = sorted.map(({ registry }) => {
    if (registry.contentHash !== undefined && sourceModuleContentHash(registry.source) !== registry.contentHash) throw new Error(`Source module content hash mismatch: ${registry.slug}`);
    const namespace = typeof registry.module?.sourceNamespace === "string" ? registry.module.sourceNamespace : sourceModuleFallbackName(registry.slug);
    return { ...prepareSourceModule(registry.source, namespace, registry.module?.sourceIdentity as SourceModuleIdentity | undefined), registryId: registry.id };
  });
  for (let index = 0; index < prepared.length; index++) {
    const importer = prepared[index]!;
    for (const imported of importer.module.imports ?? []) {
      const dependencyIndex = prepared.findIndex((entry) => entry.module.name === imported.module);
      if (dependencyIndex < 0 || dependencyIndex === index) continue;
      const target = sorted[dependencyIndex]!.registry;
      if (!(sorted[index]!.registry.dependencies ?? []).some((pin) => pin.registry === target.slug && pin.version === target.version)) throw new Error(`Source import ${imported.module} requires an exact dependency pin: ${target.slug}@${target.version}`);
    }
  }
  return prepared;
}

/** Registry coordinates/versions are host-owned package metadata. This graph
 * walk never interprets bodies or derives signature authority. */
export function sourceModuleVersionClosure<T extends InstalledSourceModuleRow>(rows: readonly T[], rootId: string): T[] {
  const root = rows.find((row) => row.registry.id === rootId);
  if (!root) throw new Error(`Source version is unavailable: ${rootId}`);
  const selected = new Set<T>();
  const pending = [root];
  while (pending.length) {
    const row = pending.shift()!;
    if (selected.has(row)) continue;
    selected.add(row);
    for (const pin of row.registry.dependencies ?? []) {
      const matches = rows.filter((entry) => entry.registry.slug === pin.registry && entry.registry.version === pin.version);
      if (matches.length !== 1) throw new Error(`Source dependency is unavailable or ambiguous: ${pin.registry}@${pin.version}`);
      pending.push(matches[0]!);
    }
  }
  return sortedSourceModuleRows([...selected]);
}

export function prepareSourceModule(
  source: string,
  fallbackName: string,
  prior?: SourceModuleIdentity,
  mint?: () => string,
): PreparedSourceModule {
  const module = loadFenelModule(source, fallbackName);
  const entities = module.entities ?? [];
  const functions = module.functions ?? [];
  const roots: FieldDeclarationRootInput[] = [
    ...entities.map((entity) => ({ kind: "type" as const, realm: "repository-source" as const, entity: { ...entity, module: module.name } })),
    ...functions.map((fn) => ({ kind: "function" as const, realm: "repository-source" as const, fn, module: module.name })),
  ];
  const lock = new Map(prior?.fields ?? []);
  let projection = normalizeFieldDeclarations(roots, { mode: "collect-requirements", lock });
  for (const request of projection.lockRequests) {
    if (lock.has(request.name)) continue;
    const id = mint?.();
    if (id === undefined) throw new Error(`Source module is missing its field identity: ${request.name}`);
    lock.set(request.name, id);
  }
  projection = normalizeFieldDeclarations(roots, { mode: "strict-embedded", lock });
  const identifiedEntities = entities.map((entity, index) => ({
    ...entity,
    type: identifiedDefinitionView(entity.type, projection.viewPlans[index]!),
    ...(entity.typeScheme === undefined ? {} : { typeScheme: {
      ...entity.typeScheme,
      body: identifiedDefinitionView(entity.typeScheme.body, projection.viewPlans[index]!),
    } }),
  }));
  const identifiedFunctions = functions.map((fn, index) =>
    identifiedDefinitionView(fn, projection.viewPlans[entities.length + index]!),
  );
  return {
    module: { ...module, entities: identifiedEntities, functions: identifiedFunctions },
    identity: { version: 1, fields: [...lock] },
    fields: projection.entities.map((field) => ({ id: field.id, currentCodeName: field.currentCodeName, origin: field.origin })),
  };
}

/** rights R2b — the reserved module names, read from a REGISTRY rather than
 *  re-derived from the manifests.
 *
 *  ⚠ WHY THIS IS A PARAMETER AND NOT A COMPUTATION. The old body built the
 *  reserved set from `[...SYSTEM_REGISTRY_MODULES, ...modulesFor("seed")]`, and
 *  the `authority` and `subject` modules appear in NEITHER list: `authority` is
 *  PREPENDED to every registry by `createRegistrySteps` and `subject` is a
 *  nested header inside the auth union. So an account could install
 *  `module authority where`, and the merged registry then had no checker —
 *  measured: `authority seam: "authority:topEnvelope" has no body in this
 *  registry`, i.e. every act in that account refused. Fail-closed HELD, which is
 *  evidence FOR the design, but it is a self-inflicted account outage one module
 *  away, and `design/authority.md` §0.2's "the applicant's registry cannot
 *  redefine the checker" has to be a FENCE rather than a lock's accident. A
 *  colliding `authority:permits` was refused only by the field-identity lock's
 *  UUID conflict — a different substrate's side effect, not a rule.
 *
 *  The registry's own module-name set is the closed set the repository owns, so
 *  a module that becomes reachable by any route — prepended, nested, folded —
 *  is reserved by construction rather than by someone remembering to list it. */
export function assertSourceModuleNamespaces(
  prepared: readonly PreparedSourceModule[],
  reserved: ReadonlySet<string>,
): void {
  const repository = [...SYSTEM_REGISTRY_MODULES, ...modulesFor("seed")];
  const names = new Set<string>(reserved);
  const types = new Set(repository.flatMap((module) => (module.entities ?? []).map((entity) => entity.id)));
  names.add("system");
  for (const { module } of prepared) {
    if (names.has(module.name)) throw new Error(`Source module namespace is reserved or already installed: ${module.name}`);
    names.add(module.name);
    for (const entity of module.entities ?? []) {
      if (dispatchEngineBody("engine:validationPrimitiveName", [entity.id]) === true) throw new Error(`Source type name is a reserved primitive: ${entity.id}`);
      if (types.has(entity.id)) throw new Error(`Source type name is reserved or already installed: ${entity.id}`);
      types.add(entity.id);
    }
  }
}

/** Exact data projected from the successful repository-only namespace build.
 * Account/source registries never populate this process-wide memo. */
export type RepositorySourceModuleProjection = {
  readonly namespaces: ReadonlySet<string>;
  readonly entities: ReturnType<ModuleRegistry["listEntities"]>;
  readonly identifiedEntities: readonly ReturnType<ModuleRegistry["listIdentifiedEntities"]>[number][];
};
let executeProfileProjection: RepositorySourceModuleProjection | undefined;

/** ⚠ MODULES THE RUNTIME PREPENDS, WHICH THE ENGINE CANNOT SEE FROM HERE.
 *  `buildExecutionRegistry` (runtime) puts `representationBridgeModule` in front
 *  of `modulesFor("execute")`, so the registry that actually runs an installed
 *  module reserves one name more than this profile does. The engine cannot import
 *  the runtime, so this is a MIRROR — and a mirror is only safe while something
 *  ties it to the measurement: `rights-r2b-partition.test.ts` asserts set EQUALITY
 *  between this function and the live `loadRegistry().listReservedNamespaces()`.
 *
 *  Measured before the mirror existed (review round 3): 48 here versus 49 there.
 *  A header-less source published as `representation-bridge` passed the authoring
 *  check and `POST /api/modules` (which runs NO namespace check — it takes
 *  `sourceNamespace` from `body.name`), then 422'd at install, leaving a
 *  published, uninstallable version. The build gate is the fail-closed one; this
 *  only makes the authoring surface agree with it. */
const RUNTIME_PREPENDED_MODULE_NAMES: readonly string[] = ["representation-bridge"];

/** rights R2b — THE reserved set, for callers that do not hold a registry.
 *  Exported so the authoring surfaces reserve the SAME names the installer
 *  does; a second, hand-derived list is how `authority` came to be admitted. */
export function reservedSourceModuleNamespaces(): ReadonlySet<string> {
  return reservedModuleNames();
}
function reservedModuleNames(): ReadonlySet<string> {
  return repositorySourceModuleProjection().namespaces;
}

/** A worker can replay the existing raw/identified catalog publication on its
 * caller's thread without constructing another execute registry. Keep the
 * original raw order, qualified owners and parameter metadata: display catalog
 * rows are deduplicated and cannot substitute for this checked projection.
 * No registry, evaluator or host callable crosses this data boundary. */
export function repositorySourceModuleProjection(): RepositorySourceModuleProjection {
  if (executeProfileProjection === undefined) {
    const registry = createRepositoryRegistry(modulesFor("execute"));
    executeProfileProjection = Object.freeze({
      namespaces: new Set([
        ...registry.listReservedNamespaces(),
        ...RUNTIME_PREPENDED_MODULE_NAMES,
      ]),
      entities: Object.freeze([...registry.listEntities()]),
      identifiedEntities: Object.freeze(registry.listIdentifiedEntities()),
    });
  }
  return executeProfileProjection;
}

function sourceModuleRegistryInputs(prepared: readonly PreparedSourceModule[]) {
  assertSourceModuleNamespaces(prepared, reservedModuleNames());
  const fields = prepared.flatMap((entry) => [...entry.fields]);
  const dispatch = sourceModuleDispatchRegistry(prepared);
  return {
    dispatch,
    repositoryModules: modulesFor("execute"),
    accountModules: prepared.map((entry) => entry.module),
    options: {
      externalFields: fields,
      identityKinds: new Map(fields.map((field) => [field.id, "field"])),
      dispatchRegistry: dispatch,
    },
  };
}

export function sourceModuleRegistry(prepared: readonly PreparedSourceModule[]): ModuleRegistry {
  const inputs = sourceModuleRegistryInputs(prepared);
  const registry = createAccountRegistry(inputs.repositoryModules, inputs.accountModules, inputs.options);
  inputs.dispatch.bindSourceMethods(registry);
  return registry;
}

/** The same registry, built through the preparation worker instead of on the
 * calling thread. Identical inputs and identical output — `createAccountRegistry`
 * and `createAccountRegistryAsync` differ only in how the build's phases are
 * scheduled — so this is a PERFORMANCE variant, not a second build.
 *
 * It exists because the browser pays for this build twice at startup: once for
 * the committed account registry (worker-assisted, ~32s) and once here, on the
 * main thread, where it measured 78s. */
export async function sourceModuleRegistryAsync(
  prepared: readonly PreparedSourceModule[],
): Promise<ModuleRegistry> {
  const inputs = sourceModuleRegistryInputs(prepared);
  const registry = await createAccountRegistryAsync(inputs.repositoryModules, inputs.accountModules, inputs.options);
  inputs.dispatch.bindSourceMethods(registry);
  return registry;
}

export function validateSourceAwareAccountSnapshot(accountId: string, snapshot: FieldPersistenceSnapshot, prepared: readonly PreparedSourceModule[]): void {
  assertSourceModuleNamespaces(prepared, reservedModuleNames());
  const sourceTypes = new Set(prepared.flatMap((entry) => (entry.module.entities ?? []).map((entity) => entity.id)));
  for (const owner of snapshot.owners) if (owner.kind === "type" && sourceTypes.has(owner.definition.id)) throw new Error(`Account type collides with installed source type: ${owner.definition.id}`);
  const projection = projectAccountFieldRegistrySnapshot(accountId, snapshot);
  const fields = prepared.flatMap((entry) => [...entry.fields]);
  const dispatch = sourceModuleDispatchRegistry(prepared);
  const registry = createAccountRegistry(modulesFor("execute"), [...projection.ownerModules, ...prepared.map((entry) => entry.module)], {
    externalFields: [...projection.externalFields, ...fields],
    identityKinds: new Map([...projection.identityKinds, ...fields.map((field) => [field.id, "field"] as const)]),
    fieldRepresentations: projection.fieldRepresentations,
    dispatchRegistry: dispatch,
    bodySpellingPolicy: "reject",
  });
  dispatch.bindSourceMethods(registry);
}

export type SourceModuleDispatchRegistry = DispatchRegistry & { bindSourceMethods: (registry: ModuleRegistry) => void };

/** Bind source-provided records/instances to a private dispatch frame. The
 * existing seedFromType owns method/default/law/superclass interpretation. */
export function sourceModuleDispatchRegistry(
  prepared: readonly PreparedSourceModule[],
  base: DispatchRegistry = repositoryDispatchRegistry,
): SourceModuleDispatchRegistry {
  const local = createDispatchRegistry();
  for (const type of base.listClasses()) local.defineClass(type);
  for (const instance of base.listInstances()) local.addInstance(instance);
  const records = prepared.flatMap(({ module }) => (module.entities ?? [])
    .filter((entity) => entity.params?.length && "$record" in entity.type)
    .map((entity) => ({ module, entity })));
  // modules-as-values Phase 2d — both passes keep EVERY declared class
  // parameter (`Both s a` → `[s, a]`), so a multi-parameter source class is
  // fenced to the return position and selected by its complete type, never by
  // its first argument. No override applies to source modules (Reprable's
  // routing override is a repository seed's).
  for (const { entity } of records) {
    if (local.getClass(entity.id)) throw new Error(`Source dispatch type ${entity.id} is already registered`);
    local.defineClass(seedFromType(entity.id, entity.type, entity.params![0]!, { typeScheme: entity.typeScheme, classParams: entity.params! }));
  }
  for (const { module, entity } of records) local.defineClass(seedFromType(entity.id, entity.type, entity.params![0]!, {
    classParams: entity.params!,
    typeScheme: entity.typeScheme, sourceModule: module,
    methodDefaults: module.methodDefaults?.[entity.id],
    isRegisteredClass: (name) => local.getClass(name) !== undefined,
  }));
  // modules-as-values Phase 2d — lowered here with the registry's own
  // `lowerMaybeFunctionReferences` (the one `addInstance` runs) so the object
  // `bindSourceMethods` binds below IS the registered row.
  // modules-as-values Phase 5a — the registered row never carries the loader's
  // `declaration` (`withoutInstanceDeclaration`; a spread alone keeps a
  // hand-built enumerable one).
  const instances = prepared.flatMap(({ module }) => (module.instances ?? []).map((instance) => {
    const copy = { ...withoutInstanceDeclaration(instance), methods: { ...instance.methods } };
    carryInstanceProvenance(instance, copy);
    const cls = local.getClass(copy.typeName);
    return { module, instance: cls === undefined ? copy : lowerMaybeFunctionReferences(copy, cls) };
  }));
  for (const { module, instance } of instances) local.addInstance(instance, { declaringModule: module.name });
  return Object.assign(local, { bindSourceMethods(registry: ModuleRegistry) {
    const context = registry.evaluateContext();
    // modules-as-values Phase 2d (review round 3) — the declaring module's
    // lexical owner. Instance-owned code (a method default, an instance
    // method, a callable nested in a `Maybe (arrow)` payload) belongs to no
    // named function, so beside the module's Name frame it gets the module-owner
    // source coordinate: every closure built below captures it, and a written
    // type inside resolves in the DECLARING module whoever invokes it.
    const scopedIn = (moduleName: string): EvaluateContext => {
      const frame = registry.getModuleImportFrame(moduleName);
      if (!frame) throw new Error(`Missing source scope for ${moduleName}`);
      return { ...context, _importStack: [frame], _sourceFunction: moduleSourceCoordinate(moduleName) };
    };
    // The binding itself is THE instance method binder
    // (`dispatch-registry.ts` `bindInstanceMethodValue` / `bindMethodValue`),
    // shared with the bundle member index (modules-as-values Phase 5a).
    for (const { module, entity } of records) {
      const seed = local.getClass(entity.id)!;
      const scoped = scopedIn(module.name);
      for (const method of seed.methods) if (method.body !== undefined) method.body = bindMethodValue(method.body, method.params.length, scoped) as typeof method.body;
    }
    for (const { module, instance } of instances) {
      const scoped = scopedIn(module.name);
      for (const [name, value] of Object.entries(instance.methods)) {
        const method = local.getClass(instance.typeName)?.methods.find((method) => method.name === name);
        if (method) instance.methods[name] = bindInstanceMethodValue(value, method, scoped);
      }
    }
  } });
}

export function sourceModuleAuthoringSession(prepared: readonly PreparedSourceModule[], sourceModule: string) {
  return sourceModuleSessionFor(sourceModuleRegistry(prepared), prepared, sourceModule);
}

/** Assemble the session from an ALREADY-BUILT source-module registry, so a
 * caller that prepared one asynchronously does not rebuild it. */
export function sourceModuleSessionFor(
  registry: ModuleRegistry,
  prepared: readonly PreparedSourceModule[],
  sourceModule: string,
) {
  const source = registry.modules.find((module) => module.name === sourceModule);
  if (!source) throw new Error(`Source module ${sourceModule} is not loaded`);
  const sourceIds = new Set(prepared.flatMap((entry) => (entry.module.functions ?? []).map((fn) => fn.id)));
  const sourceNames = new Set(prepared.map((entry) => entry.module.name));
  const sections: CatalogSection[] = [...getCatalog(), {
    id: "function", label: "Installed module functions", description: "Functions from canonical source",
    entries: registry.listFunctions().filter((fn) => sourceIds.has(fn.id)).map((fn) => ({ id: fn.id, name: fn.id, description: "", category: "function", fn })),
  }, {
    id: "entity", label: "Installed module types", description: "Types from canonical source",
    entries: registry.listIdentifiedEntities().filter((entity) => sourceNames.has(entity.module ?? "")).map((entity) => ({ id: entity.id, name: entity.id, description: "", category: "entity", entity: { id: entity.id, type: entity.type } })),
  }];
  const catalog = buildAuthoringCatalogSnapshot(sections, { registry, sourceModule, capabilityMethodOwners: "all" });
  const environment = createAuthoringEnvironment(catalog, { moduleMembers: registry });
  const evaluateContext = withImports(registry.evaluateContext(), registry.getModuleImportFrame(sourceModule) ?? registry.buildImportFrame(source.imports ?? []), (context) => context);
  return Object.freeze({ mode: "module" as const, sourceModule, registry, catalog, environment, evaluateContext });
}
