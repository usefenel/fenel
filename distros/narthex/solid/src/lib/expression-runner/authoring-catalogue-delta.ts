// Local catalogue delta: the build-owned repository catalogue plus Local's own
// rows, equal to the live Local projection whenever the Fenel admission
// (`view.localCatalogueAdmission`) finds that no Local fact can change a
// repository row. Observation, transport and merge glue only: Local's rows are
// produced by the live projection's own builders over a Local-only view of the
// same checked registry, then placed with the live builders' own orders. Any
// shape this file cannot place exactly returns undefined (the live build runs).
import type { AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import { GLOBAL_ONLY, instanceVisible, type CatalogSection, type EvaluateContext } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { digestEngineBodyPool } from "../../../../../../implementations/typescript/engine/src/engine-body-memo";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { buildSessionCatalog, readerSourceSections } from "./authoring-catalog";
import { readerSourceDeclarations } from "../reader-registry";
import type { ReaderPresentation } from "../reader-presentation";
import type { LocalCatalogueInput, LocalCatalogueResult } from "./authoring-catalogue-artifact";

type Catalog = AuthoringCatalogSnapshot;
const SOURCE_FUNCTIONS = "Installed module functions";
const SOURCE_TYPES = "Installed module types";

/** Local's identities as the checked registry records them. */
export type LocalCatalogueScope = {
  functionIds: Set<string>;
  entityIds: Set<string>;
  /** `module\u0000id` of every declared Local entity. */
  entityKeys: Set<string>;
  /** Modules whose every function and entity is Local. */
  modules: Set<string>;
  /** Declared modules that also hold repository content (never admitted). */
  mixedModules: string[];
};

export function localCatalogueScope(registry: ModuleRegistry): LocalCatalogueScope | undefined {
  const declared = readerSourceDeclarations(registry);
  if (!declared) return undefined;
  const functionIds = new Set(declared.functions);
  const entityKeys = new Set(declared.entities.map(entity => `${entity.module ?? ""}\u0000${entity.id}`));
  const entityIds = new Set(declared.entities.map(entity => entity.id));
  const entitiesByModule = new Map<string, { local: number; other: number }>();
  for (const entity of registry.listIdentifiedEntities()) {
    const name = entity.module ?? "";
    const row = entitiesByModule.get(name) ?? { local: 0, other: 0 };
    if (entityKeys.has(`${name}\u0000${entity.id}`)) row.local++; else row.other++;
    entitiesByModule.set(name, row);
  }
  const modules = new Set<string>();
  const declaredModules = new Set<string>([...declared.entities.flatMap(entity => entity.module === undefined ? [] : [entity.module])]);
  for (const module of registry.modules) {
    const functions = module.functions ?? [];
    const entities = entitiesByModule.get(module.name) ?? { local: 0, other: 0 };
    const localFunctions = functions.filter(fn => functionIds.has(fn.id)).length;
    if (localFunctions > 0) declaredModules.add(module.name);
    if (localFunctions + entities.local > 0 && localFunctions === functions.length && entities.other === 0) modules.add(module.name);
  }
  return { functionIds, entityIds, entityKeys, modules, mixedModules: [...declaredModules].filter(name => !modules.has(name)) };
}

/** Repository rows of the checked registry, Local's own rows removed: the
 * fingerprint shape the build-owned catalogue was projected from. `pool` is a
 * digest input over the rows every frame sees (GLOBAL_ONLY), so Local's
 * tag-scoped rows never change it. */
export function repositoryFingerprintShape(registry: ModuleRegistry, frame: EvaluateContext) {
  const scope = localCatalogueScope(registry);
  const localFunctions = scope?.functionIds ?? new Set<string>();
  const localEntities = scope?.entityKeys ?? new Set<string>();
  const localModules = scope?.modules ?? new Set<string>();
  const roots = registry.evaluateContext()._moduleNames;
  const entities = registry.listIdentifiedEntities().filter(entity => !localEntities.has(`${entity.module ?? ""}\u0000${entity.id}`));
  const functions = registry.listFunctions().filter(fn => !localFunctions.has(fn.id));
  return {
    functions: functions.map(fn => fn.id).sort(),
    entities: entities.map(entity => `${entity.module ?? ""}\u0000${entity.id}`).sort(),
    modules: registry.modules.map(module => module.name).filter(name => !localModules.has(name)).sort(),
    roots: roots ? [...roots].filter(name => !localModules.has(name)).sort() : null,
    constructors: registry.listConstructorSignatures().filter(row => !localModules.has(row.ownerModule ?? "")).length,
    capabilityMethods: registry.listCapabilityMethodSignatures().length,
    // Whether this registry captured source declarations at all.
    sourceDeclarations: scope !== undefined,
    // Identity aliases: a Local definition that takes over a repository UUID
    // changes getUuid for the repository name (and the catalogue routes).
    functionHandles: functions.map(fn => `${fn.id}\u0000${registry.getUuid(fn.id) ?? ""}`).sort(),
    entityHandles: entities.map(entity => `${entity.id}\u0000${registry.getUuid(entity.id) ?? ""}`).sort(),
    pool: globalPoolShape((frame as { _specRegistry?: ObservablePool })._specRegistry),
    // buildSessionCatalog reads grammar rows from the repository pool, not
    // the reader's private pool. Bind that distinct input as well.
    operators: globalPoolShape(dispatchRegistry, ["Infixable", "Prefixable"]),
  };
}

type ObservablePool = {
  listClasses(): readonly unknown[];
  listInstances(typeName?: string): readonly { scope?: import("@fenel/engine/types").InstanceScope }[];
};

/** Observe complete inert dispatch data in its existing order. Method data,
 * equal-priority order and class declarations are inputs to the live reader.
 * Reuse the existing pool encoder: JSON alone loses undefined/NaN and a
 * sorted list of keys loses changed methods and tie order. */
function globalPoolShape(pool: ObservablePool | undefined, classes?: readonly string[]): string | null {
  try {
    if (!pool) return null;
    const rows = (classes ? classes.flatMap(name => [...pool.listInstances(name)]) : pool.listInstances())
      .filter(row => instanceVisible(row, GLOBAL_ONLY));
    return digestEngineBodyPool({ classes: pool.listClasses(), rows }) ?? null;
  } catch { return null; }
}

/** Host observation: the first argument of every dispatch row this frame can
 * see that is not GLOBAL_ONLY (Local's tag rows). A non-string argument (a
 * structural pattern) or a row with more arguments reads as "" (never Local). */
function localRowTargets(frame: EvaluateContext): string[] | undefined {
  const pool = (frame as { _specRegistry?: { listInstances(): readonly { args: readonly unknown[] }[] } })._specRegistry;
  try {
    if (!pool) return undefined;
    return pool.listInstances().filter(row => !instanceVisible(row as never, GLOBAL_ONLY))
      .map(row => row.args.length === 1 && typeof row.args[0] === "string" ? row.args[0] : "");
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Local rows, from the live builders over a Local-only view.

export type LocalCatalogueDelta = {
  scope: LocalCatalogueScope;
  sections: CatalogSection[];
  catalog: Catalog;
  /** Local's identity strings (owners, handles, entities, fields, modules, constructors). */
  identities: string[];
  /** Live order of every constructor target (registry order). */
  constructorOrder: string[];
  /** Exact live root order, including synthetic roots. */
  rootOrder: string[];
};

export function localCatalogueDelta(registry: ModuleRegistry, data: LocalCatalogueInput,
  presentationFor: (id: string) => ReaderPresentation | undefined): LocalCatalogueDelta | undefined {
  const scope = localCatalogueScope(registry);
  if (!scope) return undefined;
  const named = (id: string) => {
    const resolved = presentationFor(id);
    return { name: resolved?.label ?? id, description: resolved?.description ?? "" };
  };
  const { capturedEntities, sections } = readerSourceSections(registry, named);
  // Every Local entity is a declared source row; anything else (a Local row in
  // the "Types" section) is a shape this merge does not place.
  const placed = new Set((sections.find(section => section.label === SOURCE_TYPES)?.entries ?? []).map(entry => entry.entity?.id));
  for (const entity of capturedEntities) {
    if (scope.entityKeys.has(`${entity.module ?? ""}\u0000${entity.id}`) && !placed.has(entity.id)) return undefined;
  }
  const constructors = registry.listConstructorSignatures();
  const localConstructors = constructors.filter(row => scope.modules.has(row.ownerModule ?? ""));
  const localFunctionIds = new Set([...scope.functionIds, ...localConstructors.flatMap(row => row.functionId === undefined ? [] : [row.functionId])]);
  const roots = [...(registry.evaluateContext()._moduleNames ?? registry.modules.map(module => module.name))];
  const localRoots = roots.filter(name => scope.modules.has(name));
  const localModules = registry.modules.filter(module => scope.modules.has(module.name));
  const empty: Record<string, unknown> = {
    listFunctions: () => registry.listFunctions().filter(fn => localFunctionIds.has(fn.id) || scope.entityIds.has(fn.id)
      || (registry.getEntityNominalIdentity(fn.id) !== undefined && scope.entityIds.has(registry.getIdentifiedEntity(fn.id)?.id ?? ""))),
    listConstructorSignatures: () => localConstructors,
    listCapabilityMethodSignatures: () => [],
    modules: localModules,
    evaluateContext: () => ({ ...registry.evaluateContext(), _moduleNames: new Set(localRoots) }),
  };
  const view = new Proxy(registry, { get(target, key, receiver) {
    if (typeof key === "string" && Object.hasOwn(empty, key)) return empty[key];
    const value = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as ModuleRegistry;
  const catalog = buildSessionCatalog(view, undefined, { sections, presentation: presentationFor });
  // The registry appends its synthetic system root after Local modules.
  // Retain only root order here: each existing catalogue already carries its
  // complete within-root reference order. The delta need not visit the
  // repository member lists that the artifact already projected.
  const rootOrder = [...(registry.evaluateContext()._moduleNames ?? new Set(registry.modules.map(module => module.name)))];
  const identities = new Set<string>([...scope.functionIds, ...scope.entityIds, ...scope.modules,
    ...data.snapshot.owners.flatMap(owner => [owner.ownerKey, owner.storageName]),
    ...data.snapshot.fields.map(field => field.id),
    ...localConstructors.flatMap(row => [row.targetId, ...(row.functionId === undefined ? [] : [row.functionId])])]);
  for (const id of [...identities]) {
    const handle = registry.getUuid(id);
    if (handle) identities.add(handle);
    const owner = registry.getEntityNominalIdentity(id);
    if (typeof owner === "string") identities.add(owner);
  }
  return { scope, sections, catalog, identities: [...identities].filter(Boolean),
    constructorOrder: constructors.map(row => row.targetId), rootOrder };
}

/** Where the live type list places repository type names relative to
 * Local's rows. The live builder keeps one row per display name in section
 * order, filling a shapeless row from the first later row with a shape
 * (buildAuthoringCatalogSnapshot). Local's rows sit in the two source
 * sections, after `preceding` names and before every other repository name.
 * A Local row of a `preceding` name is not listed: the repository row stays
 * when `shaped`, else it takes the Local row's shape and entity. A Local row
 * of any other repository name takes that name's row. Read from the
 * repository projection's own sections and names only. */
export function repositoryTypeNamePlacement(base: LocalCatalogueResult): { preceding: Set<string>; shaped: Set<string> } | undefined {
  const at = [SOURCE_FUNCTIONS, SOURCE_TYPES].map(label => base.displayCatalog.findIndex(section => section.label === label));
  if (at.some(index => index < 0)) return undefined;
  const preceding = new Set<string>(), shaped = new Set<string>();
  for (const section of base.displayCatalog.slice(0, Math.min(...at))) {
    if (section.id === "function") continue;
    for (const entry of section.entries) {
      const name = typeof entry.name === "string" ? entry.name : entry.name?.en ?? Object.values(entry.name ?? {})[0] ?? "";
      if (!name) continue;
      preceding.add(name);
      if (entry.entity?.type !== undefined) shaped.add(name);
    }
  }
  return { preceding, shaped };
}

// ---------------------------------------------------------------------------
// Observation for the Fenel admission.

const baseStrings = new WeakMap<LocalCatalogueResult, Set<string>>();

/** Every string (values and keys) of the repository catalogue, once per realm. */
function stringsOf(base: LocalCatalogueResult): Set<string> {
  const cached = baseStrings.get(base);
  if (cached) return cached;
  const out = new Set<string>();
  const seen = new Set<object>();
  const stack: unknown[] = [base];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") { out.add(value); continue; }
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) { for (const [key, item] of value) stack.push(key, item); continue; }
    for (const key of Object.keys(value)) { out.add(key); stack.push((value as Record<string, unknown>)[key]); }
  }
  baseStrings.set(base, out);
  return out;
}

export type LocalCatalogueObservation = {
  observed: boolean;
  repositoryFingerprint: string;
  catalogueFingerprint: string;
  localIdentities: string[];
  localValueIds: unknown[];
  localRowTargets: string[];
  repositoryMentions: string[];
  repositoryValueMentions: unknown[];
  entityCollisions: string[];
  nameCollisions: string[];
  /** Local type display names equal to a repository type row's name. */
  typeNameCollisions: string[];
  /** Those whose repository row is listed before Local's rows with a shape. */
  repositoryKeepsTypeNames: string[];
  /** Those whose repository row is listed before Local's rows without a shape. */
  localShapesTypeNames: string[];
  /** Those whose repository row is first listed after Local's rows. */
  localTakesTypeNames: string[];
  rootCollisions: string[];
};

/** Observe only own inert evidence. Malformed carriers become the existing
 * empty-string refusal sentinel; Fenel validates the observed IDs. */
function localValueIds(data: LocalCatalogueInput): unknown[] {
  try {
    const property = Object.getOwnPropertyDescriptor(data, "localValueIds");
    if (!property) return [];
    if (!Object.hasOwn(property, "value")) return [""];
    const values: unknown = property.value;
    if (values === undefined) return [];
    if (!Array.isArray(values)) return [""];
    const ids: unknown[] = [];
    for (let index = 0; index < values.length; index++) {
      const item = Object.getOwnPropertyDescriptor(values, String(index));
      if (!item || !Object.hasOwn(item, "value")) return [""];
      Object.defineProperty(ids, String(index), { value: item.value, enumerable: true, writable: true, configurable: true });
    }
    return ids;
  } catch { return [""]; }
}

/** Host observation only: identity sets for `view.localCatalogueAdmission`. */
export function observeLocalCatalogue(registry: ModuleRegistry, frame: EvaluateContext, data: LocalCatalogueInput,
  base: LocalCatalogueResult, delta: LocalCatalogueDelta | undefined, fingerprints: { repository: string; catalogue: string }): LocalCatalogueObservation {
  const targets = localRowTargets(frame);
  const strings = stringsOf(base);
  const identities = delta?.identities ?? [];
  const valueIds = localValueIds(data);
  const repositoryEntities = new Set(registry.listIdentifiedEntities()
    .filter(entity => !delta?.scope.entityKeys.has(`${entity.module ?? ""}\u0000${entity.id}`)).map(entity => entity.id));
  const names = new Set<string>();
  const typeNames = new Set<string>();
  const collide = (local: readonly string[], repository: Iterable<string>) => {
    const known = new Set(repository);
    for (const name of local) if (known.has(name)) names.add(name);
  };
  if (delta) {
    const local = delta.catalog;
    // Type names are their own observation; Fenel admits only placed ones.
    const repositoryTypeNames = new Set(base.catalog.types.map(type => type.name));
    for (const type of local.types) if (repositoryTypeNames.has(type.name)) typeNames.add(type.name);
    // Function ids, constructor picker names and every route spelling share
    // one namespace per list in the live builder (dedupe, exact-id picker).
    const baseFunctionIds = [...base.catalog.functions.map(entry => entry.id), ...(base.catalog.patternConstructors ?? []).map(entry => entry.id)];
    collide([...local.functions.map(entry => entry.id), ...(local.patternConstructors ?? []).map(entry => entry.id)], baseFunctionIds);
    collide((local.exactFunctionRoutes ?? []).map(route => route.sourceName), (base.catalog.exactFunctionRoutes ?? []).map(route => route.sourceName));
    collide((local.exactConstructorRoutes ?? []).map(route => route.sourceName), (base.catalog.exactConstructorRoutes ?? []).map(route => route.sourceName));
    collide((local.referenceRoutes ?? []).map(route => route.sourceName), (base.catalog.referenceRoutes ?? []).map(route => route.sourceName));
  }
  const repositoryModules = new Set(registry.modules.map(module => module.name).filter(name => !delta?.scope.modules.has(name)));
  const placement = typeNames.size ? repositoryTypeNamePlacement(base) : undefined;
  const placed = (keep: (name: string) => boolean) => placement ? [...typeNames].filter(keep) : [];
  return {
    observed: delta !== undefined && targets !== undefined,
    repositoryFingerprint: fingerprints.repository,
    catalogueFingerprint: fingerprints.catalogue,
    localIdentities: identities,
    localValueIds: valueIds,
    localRowTargets: targets ?? [],
    repositoryMentions: identities.filter(id => strings.has(id)),
    repositoryValueMentions: valueIds.filter(id => typeof id === "string" && strings.has(id)),
    entityCollisions: [...(delta?.scope.entityIds ?? [])].filter(id => repositoryEntities.has(id)),
    nameCollisions: [...names],
    typeNameCollisions: [...typeNames],
    repositoryKeepsTypeNames: placed(name => placement!.shaped.has(name)),
    localShapesTypeNames: placed(name => placement!.preceding.has(name) && !placement!.shaped.has(name)),
    localTakesTypeNames: placed(name => !placement!.preceding.has(name)),
    rootCollisions: [...(delta?.scope.mixedModules ?? []), ...[...(delta?.scope.modules ?? [])].filter(name => repositoryModules.has(name))],
  };
}

// ---------------------------------------------------------------------------
// Merge with the live builders' orders.

const collate = (left: string, right: string) => left.localeCompare(right);

/** Sorted union under the live comparator; undefined on any tie. */
function strictMerge<T>(left: readonly T[], right: readonly T[], compare: (a: T, b: T) => number): T[] | undefined {
  const sorted = [...left, ...right].sort(compare);
  for (let index = 1; index < sorted.length; index++) if (compare(sorted[index - 1]!, sorted[index]!) === 0) return undefined;
  return sorted;
}

/** The live builder's catalogTypes rule (catalogTypeEntry): one type per
 * non-function section entry with a name and an entity type. */
function catalogTypeCount(sections: readonly CatalogSection[]): number {
  let count = 0;
  for (const section of sections) {
    if (section.id === "function") continue;
    for (const entry of section.entries) {
      const name = typeof entry.name === "string" ? entry.name : entry.name?.en ?? Object.values(entry.name ?? {})[0] ?? "";
      if (name && entry.entity?.type !== undefined) count++;
    }
  }
  return count;
}

export function mergeLocalCatalogueDelta(base: LocalCatalogueResult, delta: LocalCatalogueDelta,
  referenceRouteSplit: number | null | undefined, registry: ModuleRegistry): LocalCatalogueResult | undefined {
  const local = delta.catalog;
  const repo = base.catalog;
  // Display: the two empty source sections of the repository catalogue take
  // Local's rows, in the live builder's section order.
  const sourceIndex = (label: string) => base.displayCatalog.findIndex(section => section.label === label);
  const functionsAt = sourceIndex(SOURCE_FUNCTIONS), typesAt = sourceIndex(SOURCE_TYPES);
  const localFunctions = delta.sections.find(section => section.label === SOURCE_FUNCTIONS);
  const localTypes = delta.sections.find(section => section.label === SOURCE_TYPES);
  if (functionsAt < 0 || typesAt < 0 || !localFunctions || !localTypes
    || base.displayCatalog[functionsAt]!.entries.length || base.displayCatalog[typesAt]!.entries.length) return undefined;
  const displayCatalog = base.displayCatalog.map((section, index) => index === functionsAt ? { ...section, entries: localFunctions.entries }
    : index === typesAt ? { ...section, entries: localTypes.entries } : section);
  if (!local.functions.length && !local.types.length && !(local.patternConstructors ?? []).length
    && !(local.exactFunctionRoutes ?? []).length && !(local.referenceRoutes ?? []).length) {
    // Nothing callable or typed from Local: only the display rows differ.
    if ((local.catalogTypes ?? []).length || (local.exactConstructorRoutes ?? []).length) return undefined;
    return { catalog: repo, displayCatalog };
  }
  // Rows the Local view must never produce (repository-only lists), and Local
  // routes that name a repository target (their declaring module and
  // constructor are read from the whole registry by the live builder).
  if ((local.operatorRoutes ?? []).length || local.operatorCodeNameByNotation.size
    || local.capabilities.some(capability => capability.name !== "HasStateIO")) return undefined;
  const identities = new Set(delta.identities);
  if ([...(local.exactFunctionRoutes ?? []), ...(local.exactConstructorRoutes ?? []), ...(local.referenceRoutes ?? [])]
    .some(route => !identities.has(route.targetId))) return undefined;
  // Equal display names, as the live list places them (Fenel admitted them):
  // an earlier repository row keeps the name, taking the Local shape when it
  // has none; a later repository row yields it to the Local row. Other equal
  // collation keys remain ties, which strictMerge refuses.
  const placement = repositoryTypeNamePlacement(base);
  if (!placement) return undefined;
  const localByName = new Map(local.types.map(type => [type.name, type]));
  if (local.types.some(type => type.type === undefined && repo.types.some(row => row.name === type.name))) return undefined;
  const repositoryRows = repo.types.flatMap(row => {
    const own = localByName.get(row.name);
    if (!own || placement.shaped.has(row.name)) return [row];
    return placement.preceding.has(row.name) ? [{ ...row, type: own.type, entityId: own.entityId }] : [];
  });
  const types = strictMerge(repositoryRows, local.types.filter(type => !placement.preceding.has(type.name)),
    (a, b) => collate(a.name, b.name));
  const functions = strictMerge(repo.functions, local.functions, (a, b) => collate(a.label, b.label) || collate(a.id, b.id));
  if (!types || !functions) return undefined;
  // catalogTypes follow section order: Local's after every section before the
  // source types section. The rule is checked against the repository list.
  const repoCatalogTypes = repo.catalogTypes ?? [];
  if (catalogTypeCount(base.displayCatalog) !== repoCatalogTypes.length
    || catalogTypeCount(delta.sections) !== (local.catalogTypes ?? []).length) return undefined;
  const typesSplit = catalogTypeCount(base.displayCatalog.slice(0, typesAt));
  const catalogTypes = [...repoCatalogTypes.slice(0, typesSplit), ...(local.catalogTypes ?? []), ...repoCatalogTypes.slice(typesSplit)];
  // Pattern constructors follow the registry's constructor order.
  const byTarget = new Map<string, Catalog["functions"][number]>();
  for (const row of [...(repo.patternConstructors ?? []), ...(local.patternConstructors ?? [])]) {
    if (row.targetId === undefined || byTarget.has(row.targetId)) return undefined;
    byTarget.set(row.targetId, row);
  }
  if (byTarget.size !== delta.constructorOrder.length) return undefined;
  const patternConstructors = delta.constructorOrder.map(target => byTarget.get(target));
  if (patternConstructors.some(row => row === undefined)) return undefined;
  // Function routes: qualified module routes in (sourceName, target) order,
  // then identity routes in function order (projectCatalogFunctionIdentities).
  const routeParts = (routes: Catalog["exactFunctionRoutes"]) => {
    const all = routes ?? [];
    const at = all.findIndex(route => !route.sourceName.includes("."));
    return at < 0 ? [all, []] as const : [all.slice(0, at), all.slice(at)] as const;
  };
  const [repoModuleRoutes, repoIdentityRoutes] = routeParts(repo.exactFunctionRoutes);
  const [localModuleRoutes, localIdentityRoutes] = routeParts(local.exactFunctionRoutes);
  if ([...repoIdentityRoutes, ...localIdentityRoutes].some(route => route.sourceName.includes(".") || route.entry === undefined)) return undefined;
  const moduleRoutes = strictMerge(repoModuleRoutes, localModuleRoutes, (a, b) => collate(a.sourceName, b.sourceName) || collate(a.targetId, b.targetId));
  if (!moduleRoutes) return undefined;
  const functionPosition = new Map(functions.map((entry, index) => [entry.id, index]));
  const identityRoutes = [...repoIdentityRoutes, ...localIdentityRoutes];
  if (identityRoutes.some(route => !functionPosition.has(route.entry!.id))) return undefined;
  identityRoutes.sort((a, b) => functionPosition.get(a.entry!.id)! - functionPosition.get(b.entry!.id)!);
  const routePosition = new Map(moduleRoutes.map((route, index) => [route.sourceName, index]));
  if (routePosition.size !== moduleRoutes.length) return undefined;
  const byRoute = <T extends { sourceName: string }>(rows: readonly T[]) => {
    if (rows.some(row => !routePosition.has(row.sourceName))) return undefined;
    return [...rows].sort((a, b) => routePosition.get(a.sourceName)! - routePosition.get(b.sourceName)!);
  };
  const exactConstructorRoutes = byRoute([...(repo.exactConstructorRoutes ?? []), ...(local.exactConstructorRoutes ?? [])]);
  // Reference routes: one per module route with an identified UUID target (in
  // route order), then each root's type members in the actual reader order.
  const repoReferences = repo.referenceRoutes ?? [];
  const localReferences = local.referenceRoutes ?? [];
  const localSplit = derivedReferenceCount(localModuleRoutes, localReferences, registry);
  if (typeof referenceRouteSplit !== "number" || referenceRouteSplit > repoReferences.length || localSplit === undefined) return undefined;
  const derived = byRoute([...repoReferences.slice(0, referenceRouteSplit), ...localReferences.slice(0, localSplit)]);
  if (!exactConstructorRoutes || !derived) return undefined;
  const repositoryRootRows = repoReferences.slice(referenceRouteSplit);
  const localRootRows = localReferences.slice(localSplit);
  if (new Set(delta.rootOrder).size !== delta.rootOrder.length) return undefined;
  const rootGroups = new Map<string, { side: "repository" | "local"; rows: (typeof repoReferences)[number][] }>();
  const rootSources = new Set<string>();
  const retainRootRows = (rows: typeof repoReferences, side: "repository" | "local") => {
    for (const row of rows) {
      // The actual emitting root is present in the checked roster. A unique
      // prefix therefore identifies it exactly, including dotted root names;
      // ambiguity refuses instead of guessing a split of the source spelling.
      const matching = delta.rootOrder.filter(root => row.sourceName.startsWith(`${root}.`));
      if (matching.length !== 1 || rootSources.has(row.sourceName)) return false;
      const root = matching[0]!;
      const group = rootGroups.get(root);
      // Existing admission excludes mixed roots. Check it again at placement
      // so no merge invents an ordering between two owners of one root.
      if (group && group.side !== side) return false;
      if (group) group.rows.push(row); else rootGroups.set(root, { side, rows: [row] });
      rootSources.add(row.sourceName);
    }
    return true;
  };
  if (!retainRootRows(repositoryRootRows, "repository") || !retainRootRows(localRootRows, "local")) return undefined;
  const rootRows = delta.rootOrder.flatMap(root => rootGroups.get(root)?.rows ?? []);
  const referenceRoutes = [...derived, ...rootRows];
  return {
    displayCatalog,
    catalog: { ...repo, types, functions, catalogTypes, patternConstructors: patternConstructors as Catalog["functions"],
      exactFunctionRoutes: [...moduleRoutes, ...identityRoutes], exactConstructorRoutes, referenceRoutes },
  };
}

/** How many leading reference routes the Local view derived from its module
 * routes (the generator's split rule), or undefined when unconfirmed. */
function derivedReferenceCount(moduleRoutes: readonly { sourceName: string; targetId: string }[],
  references: readonly { sourceName: string }[], registry: ModuleRegistry): number | undefined {
  const derived = moduleRoutes.filter(route => {
    const target = registry.getUuid(route.targetId);
    return target !== undefined && registry.getIdentifiedFunction(target) !== undefined;
  }).map(route => route.sourceName);
  return JSON.stringify(references.slice(0, derived.length).map(route => route.sourceName)) === JSON.stringify(derived) ? derived.length : undefined;
}
