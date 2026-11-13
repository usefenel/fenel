import type { CatalogEntry, CatalogSection } from "../type-catalog";
export { inferAuthoringFunctionDraft, judgeAuthoringFunctionDraftSave, type AuthoringFunctionDraftSaveVerdict } from "./function-draft";
export { reconcileAuthoringSchemeBody, type AuthoringSchemeBodyResult } from "./scheme-body";
export { projectAuthoringChildExpectation, type AuthoringChildExpectation, type AuthoringChildTypeSlot } from "./scheme-projection";
export {
  expectedSchemeForType,
  inferAuthoringCallGuidance,
  judgeAuthoringSchemeCompatibility,
  judgeAuthoringTypeCompatibility,
  projectAuthoringScheme,
  rankAuthoringFunctionSuggestions,
  type AuthoringCallGuidance,
  type AuthoringExpectedType,
  type AuthoringFunctionSuggestion,
  type AuthoringSuggestionMatch,
  type AuthoringSuggestionOptions,
  type AuthoringTypeCompatibility,
} from "./call-guidance";
export {
  inferAuthoringExpressionWithLiteralWitnesses,
  prepareAuthoringLiteralWitnesses,
  type AuthoringLiteralCheck,
  type AuthoringLiteralMembership,
  type AuthoringLiteralWitnessOptions,
} from "./literal-witness";
import type {
  FieldDef,
  FenelFunction,
  FenelType,
  InferenceOutcome,
  Interface,
  LocaleString,
  TypeScheme,
} from "../types";
import {
  universeFunctionsMatchingReturn,
  type ContainmentDispatchOptions,
} from "../engine-bodies-dispatch";
import { peelEl } from "../dependent-types";
import {
  isRef,
  refHandle as rawRefHandle,
  refType,
  type RefValue,
} from "../type-foundation";
import {
  exactOperatorAliasId,
  expandAuthoringParamPaths,
  inferAuthoringExpression,
  operatorAliasNotation,
  peelToVariantType,
  type AuthoringBinding,
  type AuthoringFunctionEntry,
  type AuthoringKernelContext,
  type ExprNode,
} from "./expression-authoring";
import type { ModuleRegistry } from "../registry";
import { engineRequire } from "../engine-require";
import { tryResolveIdentifiedFieldView } from "../identified-field-view";
import { Just, Nothing } from "../type-foundation";

export type AuthoringCatalogFunctionKind = "function" | "constructor" | "method";

export type AuthoringCatalogFunctionEntry = AuthoringFunctionEntry & {
  label: string;
  description: string;
  codeName?: string;
  kind: AuthoringCatalogFunctionKind;
  parentInterface?: string;
  parentModule?: string;
  ownerIdentity?: string;
  targetId?: string;
  functionId?: string;
  signatureOutcome?: InferenceOutcome;
  notation?: string;
};

export type AuthoringCatalogTypeEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  type?: FenelType;
  entityId?: string;
};

export type AuthoringCapabilityEntry = {
  name: string;
  description: string;
};

export type AuthoringOperatorInstanceSnapshot = {
  args: readonly unknown[];
  methods?: Record<string, unknown>;
  fixity?: "prefix" | "infix";
};

export type AuthoringOperatorRoute = {
  aliasId: string;
  notation: string;
  arity: number;
  codeName: string;
  targetId: string;
};

export type AuthoringExactFunctionRoute = {
  sourceName: string;
  targetId: string;
  status: "resolved" | "ambiguous" | "missing" | "fenced";
  entry?: AuthoringCatalogFunctionEntry;
};

export type AuthoringExactConstructorRoute = {
  sourceName: string;
  targetId: string;
  functionId?: string;
  status: "resolved" | "ambiguous" | "missing" | "fenced";
};

export type AuthoringReferenceRoute = {
  sourceName: string;
  targetId: string;
  status: "resolved" | "ambiguous" | "missing" | "fenced";
  handles?: readonly string[];
};

export type BuildAuthoringCatalogOptions = {
  /** Explicit repository/account presentation context. */
  registry?: ModuleRegistry;
  codeNameFor?: (id: string) => string | undefined;
  descriptionFor?: (id: string) => string | undefined;
  operatorInstances?: readonly AuthoringOperatorInstanceSnapshot[];
  /** Registry-less display compatibility only. Registry-backed method rows are
   * selected explicitly by immutable owner name below. */
  interfaces?: readonly Interface[];
  capabilityMethodOwners?: "all" | readonly string[];
  /** Optional defining module for alias-qualified authoring expressions. The
   * registry's frozen import snapshot is used; caller-owned imports are never
   * accepted at this boundary. */
  sourceModule?: string;
};

export type AuthoringCatalogSnapshot = {
  types: AuthoringCatalogTypeEntry[];
  functions: AuthoringCatalogFunctionEntry[];
  /** All semantic constructor owners, including duplicate source spellings.
   * Duplicate picker entries use their exact target ids; this side table keeps
   * the original source spelling for pattern and qualified-name lookup. */
  patternConstructors?: AuthoringCatalogFunctionEntry[];
  capabilities: AuthoringCapabilityEntry[];
  catalogTypes: FenelType[];
  operatorCodeNameByNotation: ReadonlyMap<string, string>;
  operatorRoutes?: readonly AuthoringOperatorRoute[];
  /** Exact module/alias-qualified routing, kept separate from picker rows so a
   * complete capability-method roster cannot override runtime module priority. */
  exactFunctionRoutes?: readonly AuthoringExactFunctionRoute[];
  /** Registry-owned constructor routes for the same frozen source frame. */
  exactConstructorRoutes?: readonly AuthoringExactConstructorRoute[];
  /** Current name-to-identity projections for source printing; never names
   * reconstructed from an internal constructor token. */
  referenceRoutes?: readonly AuthoringReferenceRoute[];
};

export type AuthoringEnvironmentOptions = {
  getFunction?: (id: string) => FenelFunction | undefined;
  resolveSavedExpr?: (id: string) => ExprNode | undefined;
  examplesForTypeName?: (typeName: string) => readonly unknown[] | undefined;
  resolveSchemaType?: (entityName: string) => FenelType | undefined;
  /** modules-as-values Phase 5a — the registry whose bundle members
   * `bundle.member…` spellings name (A2/B3 plumbing: inference reads its
   * member facts; nothing here judges them). */
  moduleMembers?: AuthoringKernelContext["moduleMembers"];
};

export type AuthoringEnvironment = AuthoringKernelContext & {
  catalog: AuthoringCatalogSnapshot;
  functionById: ReadonlyMap<string, AuthoringCatalogFunctionEntry>;
  functionByCodeName: ReadonlyMap<string, AuthoringCatalogFunctionEntry>;
  resolveFunctionId: (name: string) => string | undefined;
  /** Existence/classification only; never grants signature authority. */
  hasFunctionRefLiteral: (handle: string) => boolean;
  /** Authoritative callable projection. Fenced or scheme-less rows are absent. */
  functionForRefLiteral: (handle: string) => FenelFunction | undefined;
  /** Recover an exact runtime source spelling for a stored function target. */
  functionCodeName: (id: string) => string | undefined;
  /** Recover the source constructor spelling used by runtime JSON Logic. */
  constructorCodeName: (id: string) => string | undefined;
  operatorCodeName: (aliasIdOrNotation: string, arity?: number) => string | undefined;
};

/** Keep the catalog aggregator off the authoring module's evaluation path.
 * `type-catalog` itself imports the Fenel dispatch harness, while registry
 * bootstrap imports `type-catalog`; eagerly importing it here can cache a
 * partially initialized registry namespace before the first inference call. */
function defaultEntityTypeByName(name: string): FenelType | undefined {
  const { getEntityTypeByName } = engineRequire("type-catalog") as typeof import("../type-catalog");
  return getEntityTypeByName(name);
}

export type LetBindingDraft = {
  name: string;
  type?: FenelType;
  scheme?: TypeScheme;
  expr: ExprNode;
};

function textOf(value: LocaleString | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return value.en ?? Object.values(value)[0] ?? "";
}

function fieldCopy(field: FieldDef, registry?: ModuleRegistry): FieldDef {
  const presented = registry === undefined
    ? undefined
    : tryResolveIdentifiedFieldView(registry, field);
  const view = presented?.ok ? presented.value : undefined;
  return {
    name: field.name,
    ...(field.key === undefined ? {} : { key: field.key }),
    label: view ? Just(view.presentation.label) : Nothing,
    type: field.type,
    meta: field.meta ?? {},
    ui: view?.display ? Just(view.display) : Nothing,
  };
}

function functionCodeName(id: string, explicit?: string): string {
  if (explicit) return explicit;
  const parts = id.split(":");
  return parts.length > 1 ? parts[parts.length - 1]! : id;
}

function entryDescription(entry: CatalogEntry): string {
  return textOf(entry.description);
}

function entryName(entry: CatalogEntry): string {
  return textOf(entry.name);
}

function catalogTypeEntry(section: CatalogSection, entry: CatalogEntry): AuthoringCatalogTypeEntry | null {
  if (section.id === "function") return null;
  const name = entryName(entry);
  if (!name) return null;
  return {
    id: entry.id,
    name,
    description: entryDescription(entry),
    category: String(section.id),
    type: entry.entity?.type,
    entityId: entry.entity?.id,
  };
}

function capabilityEntry(section: CatalogSection, entry: CatalogEntry): AuthoringCapabilityEntry | null {
  if (section.id !== "interface" && !entry.typeclass) return null;
  const name = entryName(entry) || entry.typeclass?.name || entry.id.replace(/^interface:/, "");
  if (!name) return null;
  return {
    name,
    description: entryDescription(entry),
  };
}

function functionEntryFromCatalog(
  entry: CatalogEntry,
  options: BuildAuthoringCatalogOptions,
): AuthoringCatalogFunctionEntry | null {
  const catalogFn = entry.fn;
  if (!catalogFn) return null;
  const fn = options.registry?.getIdentifiedFunction(catalogFn.id) ?? catalogFn;
  const scheme = options.registry === undefined
    ? entry.scheme
    : options.registry.getFunctionScheme(catalogFn.id);
  const signatureOutcome = options.registry?.getFunctionSignatureInfo(catalogFn.id)?.outcome;
  const codeName = options.codeNameFor?.(fn.id);
  return {
    id: fn.id,
    label: entryName(entry) || functionCodeName(fn.id, codeName),
    description: entryDescription(entry),
    codeName,
    params: fn.params.map((field) => fieldCopy(field, options.registry)),
    returns: fn.returns,
    ...(scheme === undefined ? {} : { scheme }),
    targetId: fn.id,
    ...(signatureOutcome === undefined ? {} : { signatureOutcome }),
    kind: "function",
  };
}

function constructorEntriesFromEntity(
  entry: CatalogEntry,
  ctx: AuthoringKernelContext,
  registry?: ModuleRegistry,
): AuthoringCatalogFunctionEntry[] {
  const entity = entry.entity;
  if (!entity?.type) return [];
  const variant = peelToVariantType(entity.type, ctx);
  if (!variant) return [];
  return variant.cases.map((caseDef) => ({
    id: caseDef.name,
    label: caseDef.name,
    description: `${caseDef.name} - constructor of ${entity.id}`,
    params: (caseDef.fields ?? []).map((field) => fieldCopy(field, registry)),
    returns: { $ref: entity.id } as FenelType,
    kind: "constructor",
    parentEntity: entity.id,
  }));
}

function constructorEntriesFromRegistry(
  registry: ModuleRegistry,
): AuthoringCatalogFunctionEntry[] {
  return registry.listConstructorSignatures().map((constructor) => ({
    id: constructor.name,
    label: constructor.name,
    description: `${constructor.name} - constructor of ${constructor.ownerName}`,
    params: constructor.params.map((field) => fieldCopy(field, registry)),
    returns: constructor.returns,
    ...(constructor.scheme === undefined ? {} : { scheme: constructor.scheme }),
    kind: "constructor",
    parentEntity: constructor.ownerName,
    ...(constructor.ownerModule === undefined
      ? {}
      : { parentModule: constructor.ownerModule }),
    ownerIdentity: constructor.ownerIdentity,
    targetId: constructor.targetId,
    ...(constructor.functionId === undefined ? {} : { functionId: constructor.functionId }),
    signatureOutcome: constructor.outcome,
  }));
}

function constructorTargetId(entry: AuthoringCatalogFunctionEntry): string {
  return entry.targetId
    ?? `@ctor/${encodeURIComponent(entry.parentModule ?? "")}/${encodeURIComponent(entry.parentEntity ?? "")}/${entry.id}`;
}

function constructorOwnerKey(entry: AuthoringCatalogFunctionEntry): string {
  return JSON.stringify([
    entry.ownerIdentity ?? [entry.parentModule ?? null, entry.parentEntity ?? null],
    entry.id,
  ]);
}

function constructorPickerEntries(
  constructors: readonly AuthoringCatalogFunctionEntry[],
  occupiedIds: ReadonlySet<string>,
): AuthoringCatalogFunctionEntry[] {
  const countByName = new Map<string, number>();
  for (const constructor of constructors) {
    countByName.set(constructor.id, (countByName.get(constructor.id) ?? 0) + 1);
  }
  return constructors.map((constructor) => {
    const needsExactId = (countByName.get(constructor.id) ?? 0) > 1
      || occupiedIds.has(constructor.id);
    if (!needsExactId) return constructor;
    const targetId = constructorTargetId(constructor);
    return {
      ...constructor,
      id: targetId,
      codeName: constructor.codeName ?? constructor.id,
      targetId,
    };
  });
}

/** An operator instance argues its function by handle (`std.add`; modules-as-
 * values Phase 2e). Resolve it through the registry (A2/B3 authoring routing) to
 * the function id the catalog keys on. A `Class.method` handle (`Monad.bind`)
 * names a class method and never reaches `getFunction`, whose capability-method
 * fallback would answer with one instance's body. With no registry, or no
 * resolution, the handle itself is the key. */
function operatorTargetId(handle: string, registry?: ModuleRegistry): string {
  if (/^[A-Z][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*$/.test(handle)) return handle;
  return registry?.getFunction(handle)?.id ?? handle;
}

function operatorEntries(
  instances: readonly AuthoringOperatorInstanceSnapshot[] | undefined,
  functionsById: ReadonlyMap<string, AuthoringCatalogFunctionEntry>,
  options: BuildAuthoringCatalogOptions,
): {
  entries: AuthoringCatalogFunctionEntry[];
  notationMap: Map<string, string>;
  routes: AuthoringOperatorRoute[];
} {
  type Candidate = {
    notation: string;
    codeName: string;
    targetId: string;
    fixity: "prefix" | "infix" | "call";
    fn: AuthoringCatalogFunctionEntry;
  };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const inst of instances ?? []) {
    const handle = inst.args[0];
    const notation = inst.methods?.notation;
    if (typeof handle !== "string" || typeof notation !== "string") continue;
    const fnId = operatorTargetId(handle, options.registry);
    const fn = functionsById.get(fnId);
    if (!fn) continue;
    const targetId = fn.targetId ?? fn.id;
    const fixity = inst.fixity
      ?? (fn.params.length === 1 ? "prefix" : fn.params.length === 2 ? "infix" : "call");
    const identity = JSON.stringify([notation, fixity, fn.params.length, targetId]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push({
      notation,
      codeName: functionCodeName(fnId, options.codeNameFor?.(fnId)),
      targetId,
      fixity,
      fn,
    });
  }
  candidates.sort((a, b) =>
    a.notation.localeCompare(b.notation)
    || a.fixity.localeCompare(b.fixity)
    || a.targetId.localeCompare(b.targetId)
  );

  const notationCounts = new Map<string, number>();
  for (const candidate of candidates) {
    notationCounts.set(candidate.notation, (notationCounts.get(candidate.notation) ?? 0) + 1);
  }

  const entries: AuthoringCatalogFunctionEntry[] = [];
  const notationMap = new Map<string, string>();
  const routes: AuthoringOperatorRoute[] = [];
  for (const candidate of candidates) {
    const { notation, codeName, targetId, fixity, fn } = candidate;
    const aliasId = notationCounts.get(notation) === 1
      ? `op:${notation}`
      : exactOperatorAliasId(notation, targetId, fixity, fn.params.length);
    if (notationCounts.get(notation) === 1) notationMap.set(notation, codeName);
    routes.push({ aliasId, notation, arity: fn.params.length, codeName, targetId });
    entries.push({
      id: aliasId,
      label: notation,
      description: options.descriptionFor?.(targetId) ?? `${notation} - ${targetId}`,
      codeName,
      params: fn.params.map((field) => fieldCopy(field, options.registry)),
      returns: fn.returns,
      ...(fn.scheme === undefined ? {} : { scheme: fn.scheme }),
      targetId: fn.targetId ?? fn.id,
      ...(fn.signatureOutcome === undefined
        ? {}
        : { signatureOutcome: fn.signatureOutcome }),
      kind: "function",
      notation,
    });
  }
  return { entries, notationMap, routes };
}

function methodEntries(
  interfaces: readonly Interface[] | undefined,
  registry?: ModuleRegistry,
  capabilityMethodOwners?: "all" | readonly string[],
): AuthoringCatalogFunctionEntry[] {
  const entries: AuthoringCatalogFunctionEntry[] = [];
  if (registry !== undefined) {
    if (capabilityMethodOwners === undefined) return entries;
    const selectedOwners = capabilityMethodOwners === "all"
      ? undefined
      : new Set(capabilityMethodOwners);
    // The eagerly frozen registry table is both roster and signature authority.
    // Do not revisit caller-owned Interface objects here: a provider/UI object
    // can be mutated after registry construction and never licenses a phantom
    // method or a reconstructed scheme.
    for (const signature of registry.listCapabilityMethodSignatures()) {
      if (selectedOwners !== undefined && !selectedOwners.has(signature.ownerName)) continue;
      entries.push({
        id: signature.targetId,
        label: signature.targetId,
        description: textOf(signature.description) || signature.targetId,
        params: signature.params.map((field) => fieldCopy(field, registry)),
        returns: signature.returns,
        ...(signature.scheme === undefined ? {} : { scheme: signature.scheme }),
        targetId: signature.targetId,
        signatureOutcome: signature.outcome,
        kind: "method",
        parentInterface: signature.ownerName,
      });
    }
    return entries;
  }

  // Registry-less compatibility snapshots have no semantic authority. They
  // retain the historical display-only method projection for isolated UI
  // fixtures, and inference will fence because no registry TypeScheme exists.
  for (const iface of interfaces ?? []) {
    for (const method of iface.methods ?? []) {
      const qualifiedId = `${iface.name}.${method.name}`;
      entries.push({
        id: qualifiedId,
        label: qualifiedId,
        description: textOf(method.description) || qualifiedId,
        params: method.params.map((field) => fieldCopy(field)),
        returns: method.returns,
        kind: "method",
        parentInterface: iface.name,
      });
    }
  }
  return entries;
}

function registryFunctionDeclaringModule(
  registry: ModuleRegistry,
  targetId: string,
): string | undefined {
  const matches = registry.modules.filter((candidateModule) =>
    (candidateModule.functions ?? []).some((fn) => fn.id === targetId)
  );
  return matches.length === 1 ? matches[0]!.name : undefined;
}

function registryFunctionRouteEntry(
  registry: ModuleRegistry,
  sourceName: string,
  targetId: string,
): AuthoringCatalogFunctionEntry | undefined {
  const fn = registry.getIdentifiedFunction(targetId);
  if (fn !== undefined) {
    const scheme = registry.getFunctionScheme(targetId);
    const signatureOutcome = registry.getFunctionSignatureInfo(targetId)?.outcome;
    const constructor = registry.listConstructorSignatures().find((row) => row.functionId === fn.id);
    return {
      id: targetId,
      label: sourceName,
      description: sourceName,
      params: fn.params.map((field) => fieldCopy(field, registry)),
      returns: fn.returns,
      ...(scheme === undefined ? {} : { scheme }),
      targetId,
      ...(signatureOutcome === undefined ? {} : { signatureOutcome }),
      kind: "function",
      ...(constructor === undefined ? {} : { constructorTarget: constructor.targetId }),
      // The target namespace can deliberately differ from its declaring
      // display/container module (`compileJs` -> `compile-js:*`, or a
      // per-function `auth` -> `subject:*` seam). Preserve the exact
      // declaring module from registry membership; never parse ownership from
      // the target id.
      parentModule: registryFunctionDeclaringModule(registry, targetId),
    };
  }
  const method = registry.getCapabilityMethodSignature(targetId);
  if (method === undefined) return undefined;
  return {
    id: targetId,
    label: sourceName,
    description: textOf(method.description) || sourceName,
    params: method.params.map((field) => fieldCopy(field, registry)),
    returns: method.returns,
    ...(method.scheme === undefined ? {} : { scheme: method.scheme }),
    targetId,
    signatureOutcome: method.outcome,
    kind: "method",
    parentInterface: method.ownerName,
  };
}

function exactModuleFunctionRoutes(
  options: BuildAuthoringCatalogOptions,
): AuthoringExactFunctionRoute[] {
  const registry = options.registry;
  if (registry === undefined) return [];
  if (!Array.isArray(registry.modules) || typeof registry.listModuleMembers !== "function") {
    return [];
  }

  const routes = new Map<string, AuthoringExactFunctionRoute>();
  const constructorFunctions = new Set(registry.listConstructorSignatures().flatMap((row) =>
    row.functionId === undefined ? [] : [row.functionId]));
  if (
    options.sourceModule !== undefined
    && typeof registry.listSourceFunctionResolutions === "function"
  ) {
    for (const row of registry.listSourceFunctionResolutions(options.sourceModule)) {
      if (constructorFunctions.has(row.targetId)
        && registry.getFunction(row.name)?.id !== row.targetId) continue;
      const entry = row.status === "resolved" || row.status === "fenced"
        ? registryFunctionRouteEntry(registry, row.name, row.targetId)
        : undefined;
      routes.set(row.name, {
        sourceName: row.name,
        targetId: row.targetId,
        status: entry === undefined && row.status === "resolved" ? "missing" : row.status,
        ...(entry === undefined ? {} : { entry }),
      });
    }
  }

  const exposedRoots = typeof registry.evaluateContext === "function" ? registry.evaluateContext()._moduleNames : undefined;
  const moduleNames = new Set(exposedRoots ?? registry.modules.map(({ name }) => name));
  const addModuleRoutes = (moduleName: string, qualifier: string): void => {
    for (const member of registry.listModuleMembers(moduleName)) {
      const select = (path: readonly string[]): void => {
        const selected = registry.resolveModuleMember(moduleName, member, path);
        const targetId = selected.kind === "function" ? selected.id
          : selected.kind === "type" ? refHandle(selected.value as FenelType) : undefined;
        if (targetId === undefined || registry.getIdentifiedFunction(targetId) === undefined) return;
        const sourceName = [qualifier, member, ...path].join(".");
        const existing = routes.get(sourceName);
        if (existing !== undefined) {
          if (existing.targetId === targetId && existing.entry !== undefined
            && existing.entry.parentModule === undefined) routes.set(sourceName, {
              ...existing, entry: { ...existing.entry, parentModule: moduleName },
            });
          return;
        }
        const entry = registryFunctionRouteEntry(registry, sourceName, targetId);
        if (entry === undefined) return;
        routes.set(sourceName, {
          sourceName, targetId,
          status: entry.signatureOutcome !== undefined && entry.signatureOutcome.$tag !== "Solved" ? "fenced" : "resolved",
          entry: { ...entry, parentModule: moduleName },
        });
      };
      select([]);
      const selected = registry.resolveModuleMember(moduleName, member);
      if (selected.kind === "type") {
        for (const field of registry.listModuleMembers(moduleName, member)) select([field]);
      }
    }
  };

  for (const moduleName of [...moduleNames].sort()) {
    addModuleRoutes(moduleName, moduleName);
  }

  const sourceModule = (() => {
    if (options.sourceModule === undefined) return undefined;
    const matches = registry.modules.filter(({ name }) => name === options.sourceModule);
    if (matches.length !== 1) {
      throw new TypeError(
        `authoring source module ${JSON.stringify(options.sourceModule)} must select exactly one registry module; received ${matches.length}`,
      );
    }
    return matches[0]!;
  })();
  if (sourceModule?.imports !== undefined) {
    const frame = registry.buildImportFrame(sourceModule.imports);
    for (const [alias, moduleName] of Object.entries(frame.aliases)
      .sort(([left], [right]) => left.localeCompare(right))) {
      // Runtime checks a registered module head before consulting an alias of
      // the same spelling. Preserve that discriminator exactly.
      if (moduleNames.has(alias)) continue;
      addModuleRoutes(moduleName, alias);
    }
  }

  return [...routes.values()].sort((left, right) =>
    left.sourceName.localeCompare(right.sourceName)
    || left.targetId.localeCompare(right.targetId)
  );
}

function exactSourceConstructorRoutes(
  options: BuildAuthoringCatalogOptions,
  functions: readonly AuthoringExactFunctionRoute[],
): AuthoringExactConstructorRoute[] {
  const registry = options.registry;
  if (
    registry === undefined
  ) {
    return [];
  }
  const constructors = registry.listConstructorSignatures();
  const sourceRows = options.sourceModule === undefined || typeof registry.listSourceConstructorResolutions !== "function"
    ? [] : registry.listSourceConstructorResolutions(options.sourceModule);
  const routes: AuthoringExactConstructorRoute[] = sourceRows.map((row) => {
    const constructor = constructors.find((candidate) => candidate.targetId === row.targetId);
    const ordinary = functions.find((route) => route.sourceName === row.name
      && route.targetId === constructor?.functionId && route.entry?.kind === "function");
    return {
      sourceName: row.name,
      targetId: row.targetId,
      ...(ordinary === undefined ? {} : { functionId: constructor!.functionId }),
      status: row.status,
    };
  });
  for (const ordinary of functions) {
    if (ordinary.entry?.kind !== "function") continue;
    const constructor = constructors.find((row) => row.functionId === ordinary.targetId);
    if (constructor === undefined) continue;
    const projected = { sourceName: ordinary.sourceName, targetId: constructor.targetId,
      functionId: ordinary.targetId, status: ordinary.status };
    const index = routes.findIndex((route) => route.sourceName === ordinary.sourceName);
    if (index < 0) routes.push(projected); else routes[index] = projected;
  }
  return routes;
}

/** B3 projection of names the current registry actually exposes. The renderer
 * chooses usable source spellings; aliases here are identity proofs only. */
function referenceRoutesForCatalog(
  registry: ModuleRegistry | undefined,
  functions: readonly AuthoringExactFunctionRoute[],
): AuthoringReferenceRoute[] {
  if (registry === undefined || typeof registry.getUuid !== "function"
    || typeof registry.getIdentifiedFunction !== "function") return [];
  const routes: AuthoringReferenceRoute[] = [];
  for (const route of functions) {
    const targetId = registry.getUuid(route.targetId);
    if (targetId === undefined) continue;
    const selected = registry.getIdentifiedFunction(targetId);
    if (selected === undefined) continue;
    const handles = [route.targetId, route.entry?.id].filter((handle): handle is string =>
      handle !== undefined && registry.getIdentifiedFunction(handle)?.id === selected.id);
    routes.push({ sourceName: route.sourceName, targetId, status: route.status, handles });
  }
  if (typeof registry.evaluateContext !== "function" || typeof registry.listModuleMembers !== "function"
    || typeof registry.resolveModuleMember !== "function" || typeof registry.getIdentifiedEntity !== "function") return routes;
  const roots = registry.evaluateContext()._moduleNames ?? new Set(registry.modules.map(({ name }) => name));
  for (const root of roots) {
    for (const member of registry.listModuleMembers(root)) {
      const value = registry.resolveModuleMember(root, member);
      if (value.kind !== "type") continue;
      const handle = refHandle(value.value as FenelType);
      if (handle === undefined) continue;
      const selected = registry.getIdentifiedEntity(handle);
      const targetId = selected === undefined ? undefined : registry.getUuid(handle);
      if (targetId === undefined || registry.getIdentifiedEntity(targetId)?.id !== selected?.id) continue;
      const handles = [handle];
      if (registry.getUuid(selected!.id) === targetId) handles.push(selected!.id);
      routes.push({ sourceName: `${root}.${member}`, targetId, status: "resolved", handles });
    }
  }
  return routes;
}

export function buildAuthoringCatalogSnapshot(
  sections: readonly CatalogSection[],
  options: BuildAuthoringCatalogOptions = {},
): AuthoringCatalogSnapshot {
  const types: AuthoringCatalogTypeEntry[] = [];
  const capabilities: AuthoringCapabilityEntry[] = [];
  const catalogTypes: FenelType[] = [];
  const functions: AuthoringCatalogFunctionEntry[] = [];
  const patternConstructors: AuthoringCatalogFunctionEntry[] = [];
  const functionsById = new Map<string, AuthoringCatalogFunctionEntry>();
  const typeResolver: AuthoringKernelContext = {
    resolveNamedType: (name) => {
      for (const section of sections) {
        for (const entry of section.entries) {
          if (entry.entity?.id === name && entry.entity.type) return entry.entity.type;
        }
      }
      return undefined;
    },
    resolveTypeRef: (type) => {
      const handle = refHandle(type);
      return handle ? typeResolver.resolveNamedType?.(handle) : undefined;
    },
  };

  // A callable family is another projection of its existing Type owner. The
  // registry supplies its ordinary callable signature; no Function owner or
  // independent declaration enters the catalog.
  if (options.registry !== undefined && typeof options.registry.listFunctions === "function"
    && typeof options.registry.getEntityNominalIdentity === "function") {
    for (const fn of options.registry.listFunctions()) {
      if (options.registry.getEntityNominalIdentity(fn.id) === undefined) continue;
      const entity = options.registry.getIdentifiedEntity(fn.id);
      const codeName = options.codeNameFor?.(fn.id);
      const label = codeName ?? entity?.id ?? fn.id;
      const selected = registryFunctionRouteEntry(options.registry, label, fn.id);
      if (selected === undefined || functionsById.has(selected.id)) continue;
      const entry = { ...selected, ...(codeName === undefined ? {} : { codeName }) };
      functionsById.set(entry.id, entry);
      functions.push(entry);
    }
  }

  for (const section of sections) {
    for (const entry of section.entries) {
      const typeEntry = catalogTypeEntry(section, entry);
      if (typeEntry) {
        const existing = types.find((type) => type.name === typeEntry.name);
        if (!existing) types.push(typeEntry);
        else if (existing.type === undefined && typeEntry.type !== undefined) {
          // The atom/foundation rows precede the entity section and may carry
          // presentation only. Keep their display identity, but do not discard
          // the later declaration that makes this type usable by an editor.
          existing.type = typeEntry.type;
          existing.entityId = typeEntry.entityId;
        }
        if (typeEntry.type) catalogTypes.push(typeEntry.type);
      }
      const capability = capabilityEntry(section, entry);
      if (capability && !capabilities.some((c) => c.name === capability.name)) {
        capabilities.push(capability);
      }
      if (section.id === "function") {
        const fn = functionEntryFromCatalog(entry, options);
        if (fn && !functionsById.has(fn.id)) {
          functionsById.set(fn.id, fn);
          functions.push(fn);
        }
      } else if (
        options.registry === undefined
        && (section.id === "entity" || section.id === "constructor")
      ) {
        for (const ctor of constructorEntriesFromEntity(entry, typeResolver, options.registry)) {
          patternConstructors.push(ctor);
        }
      }
    }
  }


  if (options.registry !== undefined) {
    for (const ctor of constructorEntriesFromRegistry(options.registry)) {
      patternConstructors.push(ctor);
    }
  }

  for (const ctor of constructorPickerEntries(patternConstructors, new Set(functionsById.keys()))) {
    if (ctor.functionId !== undefined) {
      const existing = functionsById.get(ctor.functionId);
      if (existing !== undefined) {
        if (existing.kind === "function") existing.constructorTarget = ctor.targetId;
        continue;
      }
      const ordinary = options.registry === undefined ? undefined
        : registryFunctionRouteEntry(options.registry, ctor.label, ctor.functionId);
      if (ordinary !== undefined && !functionsById.has(ordinary.id)) {
        const entry = { ...ordinary, label: ctor.label, description: ctor.description,
          parentEntity: ctor.parentEntity };
        functionsById.set(entry.id, entry);
        functions.push(entry);
      }
      continue;
    }
    if (!functionsById.has(ctor.id)) {
      functionsById.set(ctor.id, ctor);
      functions.push(ctor);
    }
  }

  const ops = operatorEntries(options.operatorInstances, functionsById, options);
  for (const op of ops.entries) {
    if (!functionsById.has(op.id)) {
      functionsById.set(op.id, op);
      functions.push(op);
    }
  }
  for (const method of methodEntries(
    options.interfaces,
    options.registry,
    options.capabilityMethodOwners,
  )) {
    if (!functionsById.has(method.id)) {
      functionsById.set(method.id, method);
      functions.push(method);
    }
  }

  types.sort((a, b) => a.name.localeCompare(b.name));
  if (!capabilities.some((capability) => capability.name === "HasStateIO")) {
    capabilities.push({ name: "HasStateIO", description: "state capability" });
  }
  capabilities.sort((a, b) => a.name.localeCompare(b.name));
  functions.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const exactFunctionRoutes = exactModuleFunctionRoutes(options);
  const exactConstructorRoutes = exactSourceConstructorRoutes(options, exactFunctionRoutes);
  const referenceRoutes = referenceRoutesForCatalog(options.registry, exactFunctionRoutes);
  return {
    types,
    functions,
    patternConstructors,
    capabilities,
    catalogTypes,
    operatorCodeNameByNotation: ops.notationMap,
    operatorRoutes: ops.routes,
    exactFunctionRoutes,
    exactConstructorRoutes,
    referenceRoutes,
  };
}

/** Authoring snapshots cross a host/UI boundary and then become resolution
 * authority. Copy and freeze their plain data once so later caller mutation of
 * a route, entry, scheme, or array cannot rewrite an already-created session. */
function cloneFrozenAuthoringData<T>(
  value: T,
  context: string,
  definition: PropertyDescriptor,
  active = new WeakSet<object>(),
  completed = new WeakMap<object, unknown>(),
): T {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${context}: executable or symbol catalog data is not allowed`);
  }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) {
    throw new TypeError(`${context}: cyclic catalog data is not allowed`);
  }
  // Catalog routes often share the same schemes, fields and source entries.
  // Reuse only a completed owned copy; checking active first still rejects a
  // cycle, and no caller object is ever returned or stored as the copy.
  const prior = completed.get(value);
  if (prior !== undefined) return prior as T;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${context}: non-plain catalog data is not allowed`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${context}: symbol catalog properties are not allowed`);
  }
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${context}: accessor property ${JSON.stringify(key)} is not allowed`);
    }
  }
  if (Array.isArray(value)) {
    // Every successful index needs its own captured descriptor. Their count,
    // excluding mandatory length, bounds all slots even for a Proxy whose
    // live length changes. Native creation bypasses inherited numeric setters;
    // truncate any unused slots after the original length-observing loop.
    const slots = Object.create(null) as { length: number };
    slots.length = keys.length - 1;
    const out: unknown[] = Array.from<unknown>(slots);
    let index = 0;
    for (; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${context}: sparse catalog array slot ${index} is not allowed`);
      }
      out[index] = cloneFrozenAuthoringData(
        descriptor.value,
        `${context}[${index}]`,
        definition,
        active,
        completed,
      );
    }
    out.length = index;
    active.delete(value);
    const frozen = Object.freeze(out) as T;
    completed.set(value, frozen);
    return frozen;
  }
  const out = Object.create(prototype) as Record<string, unknown>;
  for (const key of keys.sort()) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable) continue;
    definition.value = cloneFrozenAuthoringData(
      descriptor.value,
      `${context}.${key}`,
      definition,
      active,
      completed,
    );
    try {
      Object.defineProperty(out, key, definition);
    } finally {
      definition.value = undefined;
    }
  }
  active.delete(value);
  const frozen = Object.freeze(out) as T;
  completed.set(value, frozen);
  return frozen;
}

/** A frozen object facade, rather than `Object.freeze(new Map())`: freezing a
 * native Map does not disable `.set`, while this view publishes no mutator and
 * keeps its actual map in a closure. */
function immutableMapView<K, V>(data: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    size: data.size,
    has: (key: K) => data.has(key),
    get: (key: K) => data.get(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    values: () => data.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) => data.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => data[Symbol.iterator](),
  }) as ReadonlyMap<K, V>;
  return view;
}

function immutableAuthoringMap(
  source: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (Object.getPrototypeOf(source) !== Map.prototype) {
    throw new TypeError("authoring catalog operatorCodeNameByNotation must be a native Map");
  }
  const data = new Map<string, string>();
  Map.prototype.forEach.call(source, (value: unknown, key: unknown) => {
    if (typeof key !== "string" || typeof value !== "string") {
      throw new TypeError("authoring catalog operator routes must map strings to strings");
    }
    data.set(key, value);
  });
  return immutableMapView(data);
}

function snapshotAuthoringCatalog(
  snapshot: AuthoringCatalogSnapshot,
): {
  readonly catalog: AuthoringCatalogSnapshot;
  readonly operatorCodeNames: ReadonlyMap<string, string>;
} {
  const descriptor = Object.getOwnPropertyDescriptor(
    snapshot,
    "operatorCodeNameByNotation",
  );
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(
      "authoring catalog operatorCodeNameByNotation must be an own data property",
    );
  }
  const operatorCodeNames = immutableAuthoringMap(
    descriptor.value as ReadonlyMap<string, string>,
  );
  // One private native-definition carrier for this complete copy. Its null
  // prototype prevents inherited descriptor fields from changing definitions.
  const definition = Object.assign(Object.create(null), {
    value: undefined,
    enumerable: true,
    configurable: false,
    writable: false,
  }) as PropertyDescriptor;
  const data: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(
    Object.getOwnPropertyDescriptors(snapshot),
  )) {
    if (key === "operatorCodeNameByNotation" || !candidate.enumerable) continue;
    if (!Object.hasOwn(candidate, "value")) {
      throw new TypeError(
        `authoring catalog: accessor property ${JSON.stringify(key)} is not allowed`,
      );
    }
    definition.value = candidate.value;
    try {
      Object.defineProperty(data, key, definition);
    } finally {
      definition.value = undefined;
    }
  }
  const owned = cloneFrozenAuthoringData(data, "authoring catalog", definition);
  const catalog = Object.freeze({
    ...owned,
    operatorCodeNameByNotation: operatorCodeNames,
  }) as AuthoringCatalogSnapshot;
  return { catalog, operatorCodeNames };
}

export function createAuthoringEnvironment(
  snapshot: AuthoringCatalogSnapshot = {
    types: [],
    functions: [],
    capabilities: [],
    catalogTypes: [],
    operatorCodeNameByNotation: new Map(),
  },
  options: AuthoringEnvironmentOptions = {},
): AuthoringEnvironment {
  const owned = snapshotAuthoringCatalog(snapshot);
  snapshot = owned.catalog;
  const getFunction = options.getFunction;
  const resolveSavedExpr = options.resolveSavedExpr;
  const examplesForTypeName = options.examplesForTypeName;
  const resolveSchemaType = options.resolveSchemaType;
  const byId = new Map<string, AuthoringCatalogFunctionEntry>();
  const byCodeName = new Map<string, AuthoringCatalogFunctionEntry>();
  for (const fn of snapshot.functions) {
    if (!byId.has(fn.id)) byId.set(fn.id, fn);
    const codeName = functionCodeName(fn.id, fn.codeName);
    const current = byCodeName.get(codeName);
    if (!current || (current.notation && !fn.notation)) byCodeName.set(codeName, fn);
  }
  const exactFunctionRouteBySource = new Map(
    (snapshot.exactFunctionRoutes ?? []).map((route) => [route.sourceName, route] as const),
  );
  const exactFunctionBySource = new Map<string, AuthoringCatalogFunctionEntry>();
  const exactFunctionByTarget = new Map<string, AuthoringCatalogFunctionEntry>();
  for (const route of snapshot.exactFunctionRoutes ?? []) {
    if (route.entry === undefined) continue;
    exactFunctionBySource.set(route.sourceName, route.entry);
    if (!exactFunctionByTarget.has(route.targetId)) {
      exactFunctionByTarget.set(route.targetId, route.entry);
    }
  }
  const canonicalSourceByTarget = new Map<string, string>();
  for (const route of snapshot.exactFunctionRoutes ?? []) {
    if (route.entry === undefined) continue;
    const parentModule = route.entry.parentModule;
    const canonicalPrefix = parentModule === undefined ? undefined : `${parentModule}.`;
    const isCanonicalSource = canonicalPrefix !== undefined
      && route.sourceName.startsWith(canonicalPrefix);
    if (
      !canonicalSourceByTarget.has(route.targetId)
      || isCanonicalSource
    ) {
      canonicalSourceByTarget.set(route.targetId, route.sourceName);
    }
  }
  const operatorRoutes = snapshot.operatorRoutes ?? snapshot.functions.flatMap((entry) => {
    if (entry.notation === undefined) return [];
    return [{
      aliasId: entry.id,
      notation: entry.notation,
      arity: entry.params.length,
      codeName: functionCodeName(entry.targetId ?? entry.id, entry.codeName),
      targetId: entry.targetId ?? entry.id,
    }];
  });
  const operatorRouteByAliasId = new Map(
    operatorRoutes.map((route) => [route.aliasId, route] as const),
  );
  const operatorRoutesByNotation = new Map<string, AuthoringOperatorRoute[]>();
  for (const route of operatorRoutes) {
    const routes = operatorRoutesByNotation.get(route.notation) ?? [];
    routes.push(route);
    operatorRoutesByNotation.set(route.notation, routes);
  }
  const resolveOperatorAlias = (
    aliasId: string,
    notation: string = operatorAliasNotation(aliasId) ?? aliasId,
    arity?: number,
  ): string | undefined => {
    if (operatorRouteByAliasId.has(aliasId)) return aliasId;
    const candidates = (operatorRoutesByNotation.get(notation) ?? [])
      .filter((route) => arity === undefined || route.arity === arity);
    return candidates.length === 1 ? candidates[0]!.aliasId : undefined;
  };
  const constructorsByName = new Map<string, AuthoringCatalogFunctionEntry[]>();
  const constructorEntryByTarget = new Map<string, AuthoringCatalogFunctionEntry>();
  const seenConstructorOwners = new Set<string>();
  const constructorSource = snapshot.patternConstructors
    ?? snapshot.functions.filter((entry) => entry.kind === "constructor");
  for (const constructor of constructorSource) {
    const ownerKey = constructorOwnerKey(constructor);
    if (seenConstructorOwners.has(ownerKey)) continue;
    seenConstructorOwners.add(ownerKey);
    const targetId = constructorTargetId(constructor);
    constructorEntryByTarget.set(targetId, constructor);
    const names = new Set<string>([constructor.id, targetId]);
    if (constructor.parentModule !== undefined) {
      names.add(`${constructor.parentModule}.${constructor.id}`);
      names.add(`${constructor.parentModule}:${constructor.id}`);
    }
    for (const name of names) {
      const entries = constructorsByName.get(name) ?? [];
      entries.push(constructor);
      constructorsByName.set(name, entries);
    }
  }
  const exactConstructorRouteBySource = new Map(
    (snapshot.exactConstructorRoutes ?? []).map((route) => [route.sourceName, route] as const),
  );
  // A hand-built/legacy snapshot can still carry one first-hit constructor at
  // its bare id. Never expose that entry when the semantic side table says the
  // spelling has multiple owners.
  for (const [name, constructors] of constructorsByName) {
    if (constructors.length > 1 && constructors.every((entry) => entry.id === name)) {
      if (byId.get(name)?.kind === "constructor") byId.delete(name);
      if (byCodeName.get(name)?.kind === "constructor") byCodeName.delete(name);
    }
  }
  const resolveNamedType = (name: string): FenelType | undefined => {
    const typeEntry = snapshot.types.find((entry) => entry.entityId === name || entry.name === name);
    return typeEntry?.type;
  };
  const functionRefEntry = (
    handle: string,
  ): AuthoringCatalogFunctionEntry | undefined => {
    const route = exactFunctionRouteBySource.get(handle);
    if (route !== undefined) return route.entry;
    return exactFunctionByTarget.get(handle) ?? byId.get(handle) ?? byCodeName.get(handle);
  };
  const authoritativeFunctionArrow = (
    entry: AuthoringCatalogFunctionEntry | undefined,
  ): Extract<FenelType, { $arrow: unknown }> | undefined => {
    if (
      entry === undefined
      || entry.kind === "constructor"
      || (entry.signatureOutcome !== undefined && entry.signatureOutcome.$tag !== "Solved")
      || entry.scheme === undefined
    ) {
      return undefined;
    }
    const body = entry.scheme.body;
    return body !== null && typeof body === "object" && "$arrow" in body
      ? body as Extract<FenelType, { $arrow: unknown }>
      : undefined;
  };
  const hasFunctionRefLiteral = (handle: string): boolean => {
    const route = exactFunctionRouteBySource.get(handle);
    if (route !== undefined) return route.entry !== undefined && route.entry.kind !== "constructor";
    const entry = functionRefEntry(handle);
    if (entry !== undefined) return entry.kind !== "constructor";
    return getFunction?.(handle) !== undefined;
  };
  const functionForRefLiteral = (handle: string): FenelFunction | undefined => {
    const entry = functionRefEntry(handle);
    const arrow = authoritativeFunctionArrow(entry);
    if (entry === undefined || arrow === undefined) return undefined;
    return {
      id: entry.targetId ?? entry.id,
      params: arrow.$arrow.params,
      returns: arrow.$arrow.returns,
    } as FenelFunction;
  };
  const resolveTypeRef = (type: FenelType): FenelType | undefined => {
    const handle = refHandle(type);
    if (!handle) return undefined;
    const functionEntry = functionRefEntry(handle);
    if (functionEntry !== undefined) return authoritativeFunctionArrow(functionEntry);
    if (exactFunctionRouteBySource.has(handle)) return undefined;
    return resolveNamedType(handle);
  };
  const resolvePatternConstructor: NonNullable<
    AuthoringKernelContext["resolvePatternConstructor"]
  > = (name, scrutineeTypeName, scrutineeOwnerIdentity) => {
    const route = exactConstructorRouteBySource.get(name);
    if (route !== undefined && route.status !== "resolved" && route.status !== "fenced") {
      return { status: route.status };
    }
    const routed = route === undefined
      ? undefined
      : constructorEntryByTarget.get(route.targetId);
    const candidates = route === undefined
      ? constructorsByName.get(name) ?? []
      : routed === undefined ? [] : [routed];
    if (candidates.length === 0) return { status: "missing" };
    const exact = scrutineeOwnerIdentity !== undefined
      ? candidates.filter((entry) => entry.ownerIdentity === scrutineeOwnerIdentity)
      : scrutineeTypeName === undefined
      ? candidates
      : candidates.filter((entry) => entry.parentEntity === scrutineeTypeName);
    // A unique global spelling is still exact when this reference belongs to
    // a nested payload whose owner is not the top-level scrutinee. Duplicate
    // spellings never fall through to first-hit selection. This fallback is
    // bare-name-only: an exact target/qualified spelling cannot escape a
    // conflicting scrutinee owner.
    const selected = exact.length === 0
      && candidates.length === 1
      && candidates[0]!.id === name
      ? candidates
      : exact;
    if (selected.length === 0) return { status: "ambiguous" };
    if (selected.length !== 1) return { status: "ambiguous" };
    const entry = selected[0]!;
    return {
      status: "resolved",
      targetId: constructorTargetId(entry),
      params: entry.params,
      returns: entry.returns,
      ...(entry.scheme === undefined ? {} : { scheme: entry.scheme }),
      ...(entry.signatureOutcome === undefined
        ? {}
        : { signatureOutcome: entry.signatureOutcome }),
    };
  };
  const uniqueConstructor = (id: string): AuthoringCatalogFunctionEntry | undefined => {
    const route = exactConstructorRouteBySource.get(id);
    if (route !== undefined) {
      if (route.status !== "resolved" && route.status !== "fenced") return undefined;
      return constructorEntryByTarget.get(route.targetId);
    }
    const candidates = constructorsByName.get(id) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  /** Ordinary call syntax follows runtime routing before the constructor
   * namespace is consulted. Constructor picker entries remain addressable by
   * their exact `@ctor/...` target, while a colliding Module.member,
   * source-alias member, function/codeName, capability method, or operator
   * keeps the meaning the evaluator and inference registry assign to a call. */
  const ordinaryFunctionEntry = (
    id: string,
    arity?: number,
  ): AuthoringCatalogFunctionEntry | undefined => {
    const exactFunction = exactFunctionBySource.get(id);
    if (exactFunction !== undefined) return exactFunction;
    const exactTarget = exactFunctionByTarget.get(id);
    if (exactTarget !== undefined) return exactTarget;
    const direct = byId.get(id);
    if (direct !== undefined && direct.kind !== "constructor") return direct;
    const byName = byCodeName.get(id);
    if (byName !== undefined && byName.kind !== "constructor") return byName;
    const aliasId = resolveOperatorAlias(
      id,
      operatorAliasNotation(id) ?? id,
      arity,
    );
    const operator = aliasId === undefined ? undefined : byId.get(aliasId);
    return operator?.kind === "constructor" ? undefined : operator;
  };

  const env: AuthoringEnvironment = {
    catalog: snapshot,
    functionById: immutableMapView(byId),
    functionByCodeName: immutableMapView(byCodeName),
    getFunctionEntry: (id, arity) => {
      const exactConstructor = constructorEntryByTarget.get(id);
      if (exactConstructor !== undefined) return exactConstructor;
      const exactRoute = exactFunctionRouteBySource.get(id);
      if (exactRoute !== undefined && exactRoute.entry === undefined) return undefined;
      return ordinaryFunctionEntry(id, arity);
    },
    resolveConstructorTarget: (id) => {
      const exactConstructor = constructorEntryByTarget.get(id);
      if (exactConstructor !== undefined) return constructorTargetId(exactConstructor);
      if (ordinaryFunctionEntry(id) !== undefined) return undefined;
      const entry = uniqueConstructor(id);
      return entry === undefined ? undefined : constructorTargetId(entry);
    },
    resolveOperatorAlias,
    resolvePatternConstructor,
    resolveTypeRef,
    resolveNamedType,
    resolveSavedExpr,
    examplesForTypeName,
    resolveDependentType: (type, values) => dependentTypeForValuePath(env, type, values),
    resolveSchemaType,
    ...(options.moduleMembers === undefined ? {} : { moduleMembers: options.moduleMembers }),
    catalogTypes: () => snapshot.catalogTypes,
    resolveFunctionId: (name) => {
      const exactConstructor = constructorEntryByTarget.get(name);
      if (exactConstructor !== undefined) return constructorTargetId(exactConstructor);
      const exactRoute = exactFunctionRouteBySource.get(name);
      if (exactRoute !== undefined && exactRoute.entry === undefined) return undefined;
      const ordinary = ordinaryFunctionEntry(name);
      if (ordinary !== undefined) return ordinary.targetId ?? ordinary.id;
      return undefined;
    },
    hasFunctionRefLiteral,
    functionForRefLiteral,
    functionCodeName: (id) => {
      const canonicalSource = canonicalSourceByTarget.get(id);
      if (canonicalSource !== undefined) return canonicalSource;
      if (exactFunctionBySource.has(id)) return id;
      const entry = byId.get(id) ?? byCodeName.get(id);
      if (entry === undefined || entry.kind === "constructor") return undefined;
      if (entry.kind === "method") return entry.targetId ?? entry.id;
      return functionCodeName(entry.targetId ?? entry.id, entry.codeName);
    },
    constructorCodeName: (id) => {
      const entry = constructorEntryByTarget.get(id) ?? uniqueConstructor(id);
      if (entry === undefined) return undefined;
      const bareCandidates = constructorsByName.get(entry.id) ?? [];
      return id === entry.id && bareCandidates.length === 1
        ? entry.id
        : constructorTargetId(entry);
    },
    operatorCodeName: (aliasIdOrNotation, arity) => {
      const exact = operatorRouteByAliasId.get(aliasIdOrNotation);
      if (exact) return exact.codeName;
      const notation = operatorAliasNotation(aliasIdOrNotation) ?? aliasIdOrNotation;
      const aliasId = resolveOperatorAlias(aliasIdOrNotation, notation, arity);
      return aliasId === undefined
        ? owned.operatorCodeNames.get(notation)
        : operatorRouteByAliasId.get(aliasId)?.codeName;
    },
  };
  return Object.freeze(env);
}

export function typePositionRefHandle(t: FenelType | null | undefined): string | null {
  if (!t || typeof t !== "object") return null;
  return isRef(t) ? (t as unknown as RefValue).$ref : null;
}

export function refHandle(t: unknown): string | undefined {
  const handle = rawRefHandle(t);
  if (handle !== undefined) return handle;
  if (typeof t !== "object" || t === null) return undefined;
  const named = (t as { $named?: unknown }).$named;
  return typeof named === "string" ? named : undefined;
}

export function resolveRefToType(
  t: FenelType,
  getFunction: (id: string) => FenelFunction | undefined,
  getEntityType?: (name: string) => FenelType | undefined,
): FenelType | undefined {
  if (!isRef(t)) return undefined;
  const resolved = refType(
    t as unknown as RefValue,
    getFunction,
    getEntityType ?? defaultEntityTypeByName,
  );
  return "$void" in resolved ? undefined : resolved;
}

export function resolveAuthoringTypeRef(
  env: AuthoringEnvironment | AuthoringKernelContext,
  type: FenelType,
): FenelType | undefined {
  const resolved = env.resolveTypeRef?.(type);
  if (resolved) return resolved;
  const handle = refHandle(type);
  if (!handle) return undefined;
  if (env.hasFunctionRefLiteral?.(handle) === true) return undefined;
  return env.resolveNamedType?.(handle);
}

export function refLiteralKind(
  v: unknown,
  getFunction: (id: string) => unknown,
): "function" | "type" | null {
  if (!isRef(v)) return null;
  return getFunction((v as unknown as RefValue).$ref) ? "function" : "type";
}

export function dependentTypeForValuePath(
  _env: AuthoringEnvironment | AuthoringKernelContext,
  type: FenelType,
  values: Record<string, unknown>,
): FenelType {
  if (type && typeof type === "object" && "$el" in type) {
    return peelEl(type, values) ?? type;
  }
  return type;
}

export function filterAuthoringFunctionsByReturn(
  functions: readonly AuthoringCatalogFunctionEntry[],
  expected: FenelType | undefined,
  options?: ContainmentDispatchOptions,
): AuthoringCatalogFunctionEntry[] {
  if (!expected) return [...functions];
  const ids = new Set(
    universeFunctionsMatchingReturn(
      functions.map((fn) => ({ id: fn.id, returns: fn.returns })),
      expected,
      options,
    ),
  );
  return functions.filter((fn) => ids.has(fn.id));
}

/** Search order of a matching type entry (lower first): the exact name or
 * code name, then a name prefix, then a word of the name, then any other part
 * of the name, then a description/category-only match. */
function authoringTypeSearchTier(entry: AuthoringCatalogTypeEntry, f: string): number {
  const name = entry.name.toLowerCase(), id = entry.id.toLowerCase();
  if (name === f || id === f) return 0;
  if (name.startsWith(f) || id.startsWith(f)) return 1;
  if (entry.name.split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u).some((word) => word.toLowerCase().startsWith(f))) return 2;
  return name.includes(f) ? 3 : 4;
}

export function filterAuthoringTypeEntries(
  entries: readonly AuthoringCatalogTypeEntry[],
  query: string,
  limit = 100,
): AuthoringCatalogTypeEntry[] {
  const f = query.toLowerCase();
  if (!f) return entries.slice(0, limit);
  // Ranked before the cut, so an exact match is never dropped by the limit;
  // the sort is stable, so catalogue order holds within a tier.
  return entries
    .filter(
      (t) =>
        t.name.toLowerCase().includes(f)
        || t.description.toLowerCase().includes(f)
        || t.category.toLowerCase().includes(f),
    )
    .map((entry) => ({ entry, tier: authoringTypeSearchTier(entry, f) }))
    .sort((a, b) => a.tier - b.tier)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function effectiveLetBinding(
  bindings: readonly LetBindingDraft[],
  index: number,
  inherited: readonly AuthoringBinding[],
  ctx: AuthoringKernelContext = {},
): Omit<AuthoringBinding, "name"> | undefined {
  const binding = bindings[index];
  if (!binding) return undefined;
  if (binding.scheme !== undefined) {
    const type = binding.type ?? binding.scheme.body;
    return { type, scheme: binding.scheme };
  }
  if (binding.type !== undefined) {
    return {
      type: binding.type,
      scheme: { quantified: [], body: binding.type },
    };
  }

  const priorParamTypes: Record<string, FenelType | TypeScheme> = {};
  for (const ip of inherited) priorParamTypes[ip.name] = ip.scheme ?? ip.type;
  for (let j = 0; j < index; j++) {
    const prior = bindings[j]!;
    let priorBinding: Omit<AuthoringBinding, "name"> | undefined;
    if (prior.scheme !== undefined) {
      priorBinding = { type: prior.type ?? prior.scheme.body, scheme: prior.scheme };
    } else if (prior.type !== undefined) {
      priorBinding = {
        type: prior.type,
        scheme: { quantified: [], body: prior.type },
      };
    } else {
      const inferred = inferAuthoringExpression(prior.expr, {
        ...ctx,
        bindings: priorParamTypes,
      });
      if (inferred.type !== undefined) {
        priorBinding = {
          type: inferred.type,
          ...(inferred.scheme === undefined ? {} : { scheme: inferred.scheme }),
        };
      }
    }
    if (priorBinding !== undefined) {
      priorParamTypes[prior.name] = priorBinding.scheme ?? priorBinding.type;
    }
  }
  const inferred = inferAuthoringExpression(binding.expr, {
    ...ctx,
    bindings: priorParamTypes,
  });
  if (inferred.type !== undefined) {
    return {
      type: inferred.type,
      ...(inferred.scheme === undefined ? {} : { scheme: inferred.scheme }),
    };
  }
  return undefined;
}

export function effectiveLetBindingType(
  bindings: readonly LetBindingDraft[],
  index: number,
  inherited: readonly AuthoringBinding[],
  ctx: AuthoringKernelContext = {},
): FenelType | undefined {
  return effectiveLetBinding(bindings, index, inherited, ctx)?.type;
}

export function authoringScopeForLetBinding(
  bindings: readonly LetBindingDraft[],
  index: number,
  inherited: readonly AuthoringBinding[],
  ctx: AuthoringKernelContext = {},
): AuthoringBinding[] {
  const typedPrior: AuthoringBinding[] = [];
  for (let i = 0; i < index; i++) {
    const binding = bindings[i]!;
    const effective = effectiveLetBinding(bindings, i, inherited, ctx);
    if (effective !== undefined) typedPrior.push({ name: binding.name, ...effective });
  }
  return expandAuthoringParamPaths([...inherited, ...typedPrior], ctx);
}

export function authoringScopeForDoBlock(
  body: readonly ExprNode[],
  inherited: readonly AuthoringBinding[],
  ctx: AuthoringKernelContext = {},
): AuthoringBinding[][] {
  const out: AuthoringBinding[][] = [];
  const accumulated: AuthoringBinding[] = [];
  for (let i = 0; i < body.length; i++) {
    out.push([...accumulated]);
    const stmt = body[i]!;
    if (
      stmt.kind !== "literal"
      || !stmt.value
      || typeof stmt.value !== "object"
      || Array.isArray(stmt.value)
      || !("__let" in stmt.value)
    ) {
      continue;
    }
    const letValue = (stmt.value as {
      __let?: { bindings?: LetBindingDraft[] };
    }).__let;
    const bindings = Array.isArray(letValue?.bindings) ? letValue.bindings : [];
    for (let bi = 0; bi < bindings.length; bi++) {
      const binding = bindings[bi]!;
      const effective = effectiveLetBinding(
        bindings,
        bi,
        [...inherited, ...accumulated],
        ctx,
      );
      if (effective) accumulated.push({ name: binding.name, ...effective });
    }
  }
  return out;
}
