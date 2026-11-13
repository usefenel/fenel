import { dispatchRegistry, getCatalog, getCodeName, getDescription, getExamples, getLabel, stdNatives, stdNativesCtx, type CatalogSection, type FenelType, type EvaluateContext, type LocaleString } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { canonical } from "@fenel/engine/locale";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment, type AuthoringCatalogSnapshot, type AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { declaringModuleForFunction, mergeBrowserEvaluateContext } from "./authoring-session-scope";
import { GLOBAL_ONLY, instanceVisible } from "@fenel/engine";
import { readerSourceDeclarations, type ReaderSourceDeclarations } from "../reader-registry";
import type { ReaderPresentation } from "../reader-presentation";

/** `registry` is the reader's registry the catalog was built from: its bundle
 * members are what `bundle.member…` spellings name to inference
 * (modules-as-values Phase 5a), as the evaluate context resolves them. */
export function environmentForCatalog(catalog: AuthoringCatalogSnapshot, registry?: ModuleRegistry): AuthoringEnvironment {
  const environment: AuthoringEnvironment = createAuthoringEnvironment(catalog, {
    examplesForTypeName: (name) => getExamples(name),
    // This callback runs after construction and must read the same owned
    // catalogue as the environment's other resolution helpers.
    resolveSchemaType: (name) => environment.catalog.types.some((entry) => entry.entityId === name || entry.name === name)
      ? ({ $ref: name } as FenelType) : undefined,
    ...(registry === undefined ? {} : { moduleMembers: registry }),
  });
  return environment;
}

export function evaluateContextForCatalog(registry: ModuleRegistry): EvaluateContext {
  return mergeBrowserEvaluateContext(registry.evaluateContext(),
    stdNatives as Record<string, (...args: unknown[]) => unknown>, stdNativesCtx);
}

export type EntityPresentation = (id: string) => { name: LocaleString; description: LocaleString };
const repositoryEntityPresentation: EntityPresentation = (id) => ({
  name: getLabel(id) ?? id,
  description: getDescription(id) ?? "",
});
const scopedSections = new WeakMap<ModuleRegistry, {
  source: readonly CatalogSection[];
  presentation: EntityPresentation;
  sections: CatalogSection[];
}>();

/** The one admission for a catalogue declaration. Ordinary owners come from
 * the captured roster; class-only records are admitted once by the registry
 * after that roster, and intentionally have no ordinary roster entry. */
function catalogEntityInReader(registry: ModuleRegistry, ownersByName: Map<string, Set<string | undefined>>, requestedId: string) {
  const owners = ownersByName.get(requestedId);
  if ((owners?.size ?? 0) > 1) return undefined;
  const entity = registry.getIdentifiedEntity(requestedId);
  return !entity || entity.id !== requestedId || (owners?.size === 1 && !owners.has(entity.module)) ? undefined : entity;
}

/** The engine's compatibility catalog scopes functions to its argument, but
 * its entity rows still include types registered by earlier account sessions.
 * Project entity identities through this reader's registry before an editor
 * can retain their names or shapes. The identified definition also replaces a
 * same-named raw declaration from another registry. This is a host-registry
 * projection (A2/B3), not a second type/name resolver. */
export function sessionCatalogSections(
  registry: ModuleRegistry,
  sections: readonly CatalogSection[] = getCatalog(registry),
  presentation: EntityPresentation = repositoryEntityPresentation,
  sourcePresentation?: EntityPresentation,
  declaredSources?: ReaderSourceDeclarations,
): CatalogSection[] {
  const cached = scopedSections.get(registry);
  if (!sourcePresentation && !declaredSources && cached?.source === sections && cached.presentation === presentation) return cached.sections;
  const { capturedEntities, ownersByName, sections: sourceSections } = readerSourceSections(registry, sourcePresentation, declaredSources);
  const projected = sections.map((section) => ({ ...section, entries: section.entries.flatMap((entry) => {
    if (!entry.entity) return [entry.fn && sourcePresentation ? { ...entry, ...sourcePresentation(entry.fn.id) } : entry];
    const entity = catalogEntityInReader(registry, ownersByName, entry.entity.id);
    if (!entity) return [];
    return [{ ...entry, ...presentation(entity.id), entity: {
      id: entity.id,
      type: entity.type,
      ...(entity.params === undefined ? {} : { params: entity.params.map((param) =>
        typeof param === "string" ? { name: param, constraints: [] } : param) }),
    } }];
  }) }));
  projected.push(...sourceSections);
  // Private reader builds deliberately do not publish into the process-wide
  // catalogue. Carry their missing registered types from this captured registry
  // instead: labels remain presentation, and an ambiguous name gains no row.
  const present = new Set(projected.flatMap(section => section.entries.flatMap(entry =>
    entry.entity ? [entry.entity.id] : [])));
  const missing: CatalogSection["entries"] = [];
  for (const candidate of capturedEntities) {
    if (present.has(candidate.id) || ownersByName.get(candidate.id)?.size !== 1) continue;
    const entity = registry.getIdentifiedEntity(candidate.id);
    const owner = registry.getEntityNominalIdentity(candidate.id);
    const handle = registry.getUuid(candidate.id);
    if (!entity || entity.id !== candidate.id || entity.module !== candidate.module || !owner || !handle
      || registry.getFunction(handle) || registry.getEntityNominalIdentity(handle) !== owner) continue;
    missing.push({ id: `entity:${handle}`, ...(sourcePresentation ?? presentation)(entity.id), category: "entity",
      entity: { id: entity.id, type: entity.type,
        ...(entity.params === undefined ? {} : { params: entity.params.map(param =>
          typeof param === "string" ? { name: param, constraints: [] } : param) }),
      },
    });
    present.add(entity.id);
  }
  if (missing.length) projected.push({ id: "entity", label: "Types",
    description: "Types available here", entries: missing });
  if (!sourcePresentation && !declaredSources) scopedSections.set(registry, { source: sections, presentation, sections: projected });
  return projected;
}

/** The source-module account fallback already owns its function/constructor
 * routes, but its engine snapshot preceded this frontend catalogue boundary.
 * Reuse the normal guarded snapshot producer for both type rosters: its
 * catalogue-shape roster deliberately retains incoming declarations that
 * share a display name, so it cannot be derived from the deduplicated picker
 * rows or matched back to owners by structural shape. No registry is built.
 * Every non-type field of the existing catalogue is retained verbatim. */
export function projectSessionCatalogTypes(registry: ModuleRegistry, catalog: AuthoringCatalogSnapshot,
  sourceModule: string, installedSourceNames: readonly string[]): AuthoringCatalogSnapshot {
  // These are the names of the prepared modules already admitted by the
  // source-module registry, exactly the input used by sourceModuleSessionFor.
  // Its account source declarations need not have repository UUID aliases.
  const names = new Set(installedSourceNames);
  const declaredSources: ReaderSourceDeclarations = { functions: [], entities: registry.listIdentifiedEntities()
    .filter(entity => entity.module !== undefined && names.has(entity.module))
    .map(entity => ({ id: entity.id, module: entity.module! })) };
  const sections = sessionCatalogSections(registry, getCatalog(registry), repositoryEntityPresentation, undefined, declaredSources);
  const projected = buildSessionCatalog(registry, sourceModule, { sections });
  return { ...catalog, types: projected.types, catalogTypes: projected.catalogTypes };
}

/** The two "Installed module" sections of this reader's checked source (empty
 * without captured source declarations), with the identified-entity roster
 * they were selected from. The Local catalogue delta reuses this exact code. */
export function readerSourceSections(registry: ModuleRegistry, sourcePresentation?: EntityPresentation,
  declaredSources: ReaderSourceDeclarations | undefined = readerSourceDeclarations(registry)) {
  const capturedEntities = registry.listIdentifiedEntities();
  const ownersByName = new Map<string, Set<string | undefined>>();
  for (const entity of capturedEntities) {
    const owners = ownersByName.get(entity.id) ?? new Set<string | undefined>();
    owners.add(entity.module);
    ownersByName.set(entity.id, owners);
  }
  const sections: CatalogSection[] = declaredSources === undefined ? [] : [{
    id: "function", label: "Installed module functions", description: "Functions from canonical source",
    entries: readerSourceFunctionEntries(registry, declaredSources, sourcePresentation),
  }, {
    id: "entity", label: "Installed module types", description: "Types from canonical source",
    entries: capturedEntities.filter(entity => ownersByName.get(entity.id)?.size === 1 && declaredSources.entities.some(owner =>
      owner.id === entity.id && owner.module === entity.module)).map(entity => ({
      id: entity.id, ...(sourcePresentation?.(entity.id) ?? { name: entity.id, description: "" }), category: "entity", entity: { id: entity.id, type: entity.type,
        ...(entity.params === undefined ? {} : { params: entity.params.map(param =>
          typeof param === "string" ? { name: param, constraints: [] } : param) }),
      },
    })),
  }];
  return { capturedEntities, ownersByName, sections };
}

/** Rows of the "Installed module functions" section: this reader's checked
 * source functions, in declaration order, under its source presentation. */
export function readerSourceFunctionEntries(registry: ModuleRegistry,
  declaredSources: NonNullable<ReturnType<typeof readerSourceDeclarations>>,
  sourcePresentation?: EntityPresentation): CatalogSection["entries"] {
  return declaredSources.functions.map(id => {
    const fn = registry.getIdentifiedFunction(id);
    if (!fn || fn.id !== id) throw new Error(`The checked source function ${id} is unavailable.`);
    return { id, ...(sourcePresentation?.(id) ?? { name: id, description: "" }), category: "function", fn };
  });
}

/** Attach the declaring module of plain function rows (buildSessionCatalog). */
export function withDeclaringModules(registry: ModuleRegistry,
  functions: AuthoringCatalogSnapshot["functions"]): AuthoringCatalogSnapshot["functions"] {
  return functions.map((entry) => {
    if (entry.kind !== "function" || entry.parentModule !== undefined) return entry;
    const owner = declaringModuleForFunction(registry, entry.targetId ?? entry.id);
    return owner.status === "resolved" ? { ...entry, parentModule: owner.moduleName } : entry;
  });
}

/** Immutable presentation projection over an already checked registry. Kept
 * independent from Solid so the exact same catalog builder can run in a worker. */
export function projectCatalogFunctionIdentities(
  registry: ModuleRegistry,
  catalog: AuthoringCatalogSnapshot,
): AuthoringCatalogSnapshot {
  const routes = [...(catalog.exactFunctionRoutes ?? [])];
  const retained = new Set(routes.map((route) => route.sourceName));
  for (const entry of catalog.functions) {
    if (entry.kind !== "function" || entry.notation !== undefined) continue;
    const target = entry.targetId ?? entry.id;
    const handle = registry.getUuid(target);
    if (handle === undefined || handle === target || retained.has(handle)) continue;
    const declaration = registry.getIdentifiedFunction(target);
    if (declaration === undefined || registry.getIdentifiedFunction(handle)?.id !== declaration.id) continue;
    // Reflect an identity of this admitted declaration, retaining its checked
    // signature and optional names; no new source spelling or function is added.
    routes.push({ sourceName: handle, targetId: handle, status: "resolved",
      entry: { ...entry, targetId: handle } });
    retained.add(handle);
  }
  return { ...catalog, exactFunctionRoutes: routes };
}

export function buildSessionCatalog(registry: ModuleRegistry, sourceModule?: string,
  options: { sections?: readonly CatalogSection[]; presentation?: (id: string) => ReaderPresentation | undefined } = {}): AuthoringCatalogSnapshot {
  const snapshot = buildAuthoringCatalogSnapshot(options.sections ?? sessionCatalogSections(registry, getCatalog(registry)), {
    registry,
    ...(sourceModule === undefined ? {} : { sourceModule }),
    codeNameFor: (id) => {
      const declared = options.presentation ? options.presentation(id)?.codeName : getCodeName(id);
      return declared ? canonical(declared) : undefined;
    },
    descriptionFor: (id) => canonical((options.presentation ? options.presentation(id)?.description : getDescription(id)) ?? ""),
    // rights R3a — GLOBAL_ONLY, DECLARED (§8.1b). Operator FIXITY is repository
    // grammar: `Infixable` / `Prefixable` rows are boot `.fenel` instances, and
    // an account-registered fixity changing how EVERY account's editor parses an
    // operator is the leak, not a feature.
    operatorInstances: [
      ...dispatchRegistry.listInstances("Infixable")
        .filter((instance) => instanceVisible(instance, GLOBAL_ONLY))
        .map((instance) => ({ ...instance, fixity: "infix" as const })),
      ...dispatchRegistry.listInstances("Prefixable")
        .filter((instance) => instanceVisible(instance, GLOBAL_ONLY))
        .map((instance) => ({ ...instance, fixity: "prefix" as const })),
    ],
    capabilityMethodOwners: "all",
  });
  return projectCatalogFunctionIdentities(registry, { ...snapshot, functions: withDeclaringModules(registry, snapshot.functions) });
}
