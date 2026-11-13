import { exprNodeToLogic, logicToExprNode, observeExprNode, type ExprNode } from "@fenel/engine/authoring/expression";
import { inferTransferExpression } from "./data-transfer/expressions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FieldDef, FenelFunction, FenelType, LocaleString } from "@fenel/engine/types";
import type { Nothing } from "@fenel/engine/type-foundation";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { LocusCatalogLookups } from "./locus-catalog-reference";
import type { LocusRootData } from "./locus-root-data";
import type { LayoutItem } from "./locus-view-model";
import { createReaderPresentation, projectReaderTypeDescriptions, readerPresentationDto } from "./reader-presentation";
import { invokeCallable } from "@fenel/engine/expressions";
import { readerSourceMetadataPacket, type ReaderSourceMetadataCapture, type ReaderSourceMetadataRoster } from "./reader-source-metadata";
import { functionRefHandle } from "@fenel/engine/type-foundation";
import { expectedTypeForName } from "./expression-runner/creation-seed";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { publicSectionTarget } from "./public-section-presentation";
import { recordPublicDataDeclaration } from "./public-data-declaration";

export type PublicSourceBindings = {
  readonly values: readonly { id: string; slug: string; name: string; query: { kind: string; expr: ExprNode; valueType: FenelType } }[];
  readonly items: readonly LayoutItem[];
};

export type PublicDemoReferent = { readonly addresses: readonly string[]; readonly path: readonly (string | number)[] };
export type PublicDemoValue = {
  readonly name: string;
  readonly description: string;
  readonly expr: ExprNode;
  readonly type?: FenelType;
  readonly referents?: readonly PublicDemoReferent[];
  readonly bindings?: PublicSourceBindings;
  /** The section's mark on its card and page header (an app line icon). */
  readonly icon?: string;
};
/** A demo value that holds other demo values: an ordinary record of them,
 * shown by the same renderers as the Demo root (types = UI = app). */
export type PublicDemoGroup = {
  readonly name: string;
  readonly description: string;
  readonly icon?: string;
  /** Its members as even tiles (value and name only, rows of one height): a
   * page meant to be seen at once, such as `Data instead of files`. */
  readonly layout?: "tiles";
  readonly members: readonly PublicDemoEntry[];
};
export type PublicDemoEntry = PublicDemoValue | PublicDemoGroup;
type ReaderMetadataEntry = NonNullable<LocusRootData["previewMetadata"]>["entries"][number];
export type PublicCatalogPath = { readonly itemId: string; readonly path: (string | number)[] };
export type PublicLocusProjections = Pick<LocusRootData, "previewMetadata" | "typeDescriptions">;
export type PublicLocusData = {
  readonly root: LocusRootData;
  readonly registry: ModuleRegistry;
  readonly session: AuthoringSession;
  readonly catalogLookups: LocusCatalogLookups;
  readonly catalogPaths: ReadonlyMap<string, PublicCatalogPath>;
  readonly sourceBindings?: PublicSourceBindings;
};

/** B3 source projection: public bindings use the same authored record
 * programme as Local copies, but retain their owning declaration identities.
 * Image bodies and the fennels selection stay calls; no copy, storage or image
 * workload is performed. */
export function publicShowcaseSourceForSession(session: AuthoringSession): PublicSourceBindings {
  const registry = session.registry;
  const exact = (name: string) => {
    const declaration = registry.getFunction(name);
    const identity = declaration && registry.getUuid(declaration.id);
    if (!declaration || !identity || registry.getFunction(identity)?.id !== declaration.id)
      throw new Error(`The public source ${name} has no exact repository identity.`);
    return { declaration, identity };
  };
  const source = exact("ShowcaseDemo.showcasePublicBindingSources");
  const sources = invokeCallable({ $ref: source.identity }, [], session.evaluateContext) as {
    bindings: Record<string, unknown>; calls: Record<string, unknown>;
  };
  const identityOf = (reference: unknown) => {
    const handle = functionRefHandle(reference);
    if (!handle) throw new Error("A public source binding has no retained declaration reference.");
    return exact(handle).identity;
  };
  const ids = Object.fromEntries(Object.entries(sources.bindings).flatMap(([key, reference]) => {
    const identity = identityOf(reference);
    return [[key, identity], [`${key}Item`, identity]];
  }));
  const heads = Object.fromEntries(Object.entries(sources.calls).map(([key, reference]) => [key, identityOf(reference)]));
  const types = ["PublicPerson", "Project", "Mascot", "PlantFamily", "PlantGenus", "PlantSpecies", "BotanicalIllustration", "ProgrammingLanguage", "PlantNamedSpeciesSet"]
    .map(name => expectedTypeForName(name, session.environment));
  if (types.some(type => !type)) throw new Error("The public linked source's checked types are unavailable.");
  const programme = exact("ShowcaseDemo.showcaseSourceRecords");
  const records = registryTransportSnapshot(invokeCallable({ $ref: programme.identity }, [ids, heads, ...types], session.evaluateContext),
    "Public linked source") as PublicSourceBindings;
  const constructorSignatures = registry.listConstructorSignatures();
  // The canonical codec alone visits executable slots. Validate calls with the
  // same declaring-source route used by opted-in public source expressions.
  // Constructor wire tags stay unchanged only when this reader selects the
  // exact constructor admitted by that source frame; ambiguity refuses.
  for (const row of records.values) observeExprNode(row.query.expr, { onExpression: node => {
    if (node.kind === "call") {
      const selected = registry.getFunction(node.fnId);
      const spelling = selected && registry.getUuid(selected.id) === node.fnId ? selected.id : node.fnId;
      const route = registry.resolveFunctionDraftReferences(programme.declaration.id, [spelling])[0];
      if (route?.status !== "resolved") throw new Error(`The public expression cannot resolve ${node.fnId} in its source frame.`);
      if (node.fnId !== exact(route.targetId).identity)
        throw new Error(`The public expression has no exact identity for ${node.fnId}.`);
    } else if (node.kind === "literal" && node.value && typeof node.value === "object") {
      const construct = (node.value as { __construct?: { tag?: string } }).__construct;
      if (typeof construct?.tag !== "string") return;
      const route = registry.resolveFunctionDraftReferences(programme.declaration.id, [`$ctor:${construct.tag}`])[0];
      const source = route?.status === "resolved" ? constructorSignatures.find(row => row.targetId === route.targetId) : undefined;
      // An explicit constructor marker is not a bare function-name lookup.
      // Detached readers intentionally reject that lookup. Retain the short
      // wire tag only when its one admitted owner and physical constructor
      // function match the declaring-source route and current registry.
      const admitted = (session.environment.catalog.patternConstructors ?? []).filter(row => row.id === construct.tag);
      if (!source || source.name !== construct.tag || !source.functionId || typeof source.ownerIdentity !== "string" || source.ownerIdentity === ""
        || source.outcome?.$tag !== "Solved" || admitted.length === 0
        || admitted.some(row => row.targetId !== source.targetId || row.ownerIdentity !== source.ownerIdentity || row.functionId !== source.functionId || row.signatureOutcome?.$tag !== "Solved")
        || session.environment.resolveConstructorTarget?.(source.targetId) !== source.targetId
        || registry.getFunction(source.functionId)?.id !== source.functionId || registry.getUuid(source.functionId) !== source.functionId)
        throw new Error(`The public expression cannot retain ${construct.tag} in its source frame.`);
    }
  } });
  return records;
}

/** A2/B3: the public reader admits its own immutable repository projection
 * through the same Fenel roster and payload-free packet as other readers.
 * A public coordinate grants no access; the caller retains its lifetime. */
export function publicSourceMetadataForSession(data: PublicLocusData, generation: string,
  callableLabels: readonly { id: string; label: string }[], current: () => boolean): ReaderSourceMetadataCapture {
  if (!current()) throw new Error("This public reader was closed.");
  const session = data.session;
  const declaration = session.registry.getFunction(data.sourceBindings ? "view.dependencyMetadataRosterWithBindings" : "view.dependencyMetadataRoster");
  const target = declaration && session.registry.getUuid(declaration.id);
  if (!declaration || !target || session.registry.getFunction(target)?.id !== declaration.id)
    throw new Error("This reader's dependency source is not ready yet.");
  const args = [data.root, data.sourceBindings?.values ?? [], callableLabels,
    ...(data.sourceBindings ? [data.sourceBindings.items] : [])];
  const roster = invokeCallable({ $ref: target }, args, session.evaluateContext) as ReaderSourceMetadataRoster;
  const packet = readerSourceMetadataPacket({ $tag: "PublicSource" }, data.root.id, generation, roster);
  if (!current()) throw new Error("This public reader changed while its metadata was being captured. Try again.");
  return { session, packet, generationToken: Object.freeze({}), current };
}

/** A render projection of repository definitions, never an account snapshot.
 * The registry owns names, referents and signatures. This adapter only carries
 * those existing identities into the Locus's ordinary record/list expressions
 * and `$ref` values (the ledgered host-reflection / `$`-key boundary).
 * No module value, definition body, account read or publication is created. */
export function publicLocusDataForSession(
  session: AuthoringSession,
  demoValues: readonly PublicDemoEntry[],
  rootType: FenelType,
  nothing: typeof Nothing,
  presentation?: Pick<ReturnType<typeof createReaderPresentation>, "representation"> & Partial<Pick<ReturnType<typeof createReaderPresentation>, "presentation">>,
  /** The build-time public bootstrap's copies of the two derived projections
   * (same sources, same repository identity). Supplied, they are used as is:
   * recomputing them costs minutes of browser main thread (700+ library
   * functions), and the reader's bootstrap comparison still checks the rest. */
  projections?: PublicLocusProjections,
): PublicLocusData {
  const registry = session.registry;
  const catalogPaths = new Map<string, PublicCatalogPath>();
  const fields = new Map<string, ExprNode>();
  const fieldTypes = new Map<string, FenelType>();
  const namedFunctions = new Set<string>();
  const stdItemId = "std";

  function addFunction(name: string, id: string, as: "reference" | "data" = "reference"): void {
    const fn = registry.getFunction(id);
    if (!fn) return;
    const handle = registry.getUuid(fn.id) ?? fn.id;
    // A presentation must not turn a stale identity into a different value.
    if (registry.getFunction(handle)?.id !== fn.id) return;
    if (fields.has(name)) return;
    if (as === "data" && fn.params.length === 0) {
      // Ordinary data: the inert zero-argument call and its declared result
      // type, evaluated where it is displayed (as the demo collections' data).
      fields.set(name, { kind: "call", fnId: handle, args: [] });
      fieldTypes.set(name, fn.returns);
    } else {
      fields.set(name, { kind: "literal", value: Object.freeze({ $ref: handle }) });
      fieldTypes.set(name, { $arrow: { params: fn.params, returns: fn.returns } });
    }
    namedFunctions.add(fn.id);
    const path = { itemId: stdItemId, path: [name] };
    catalogPaths.set(fn.id, path);
    catalogPaths.set(handle, path);
  }

  // The Encyclopedia belongs to the library's surface, listed first: its
  // contents as data (the inert zero-argument call), so opening it shows the
  // living things, countries, writing systems and emoji, not the function's
  // shape (lane E, Nov 8; was an inert reference). Absent source adds none.
  const encyclopedia = registry.getFunction("Encyclopedia.encyclopedia");
  if (encyclopedia && encyclopedia.params.length === 0) addFunction("Encyclopedia", encyclopedia.id, "data");

  // This is the registry's source-name projection, not a second parser for
  // legacy colon ids. Its qualified lookup also handles namespace overrides.
  for (const name of registry.listModuleMembers("std")) {
    const fn = registry.getFunction(`std.${name}`);
    if (fn) addFunction(name, fn.id);
  }
  for (const bundle of registry.modules) {
    if (bundle.name !== "std") continue;
    for (const fn of bundle.functions ?? []) {
      // Names are optional. An unnamed member remains reachable by identity.
      if (!namedFunctions.has(fn.id)) addFunction(`_${registry.getUuid(fn.id) ?? fn.id}`, fn.id);
    }
    for (const entity of bundle.entities ?? []) {
      const selected = registry.getIdentifiedEntity(entity.id);
      if (!selected || selected.module !== bundle.name || fields.has(entity.id)) continue;
      const handle = registry.getUuid(entity.id) ?? entity.id;
      const owner = registry.getEntityNominalIdentity(entity.id);
      if (!owner || registry.getEntityNominalIdentity(handle) !== owner || registry.getFunction(handle)) continue;
      fields.set(entity.id, { kind: "literal", value: Object.freeze({ $ref: handle }) });
      fieldTypes.set(entity.id, { $type: true });
      const path = { itemId: stdItemId, path: [entity.id] };
      for (const address of [entity.id, handle, `entity:${entity.id}`, `entity:${bundle.name}.${entity.id}`]) {
        catalogPaths.set(address, path);
      }
    }
  }

  const std: ExprNode = { kind: "literal", value: {
    __record: { fields: [...fields].map(([name, value]) => ({ name, value })) },
  } };
  // The registry already owns every signature. Carry that exact record shape
  // to the shared renderer instead of asking it to infer the whole library on
  // each entry. A type reference is a value of Type, not an instance of it.
  const stdType: FenelType = { $record: { fields: [...fieldTypes].map(([name, type]): FieldDef => ({
    name, type, label: nothing, ui: nothing, meta: {},
  })) } };
  // Callable references remain inert. Source-owned sample-data calls use
  // the normal expression evaluation path when their data is displayed.
  // A group is an ordinary record of its members, at any depth: its value,
  // type and addresses nest exactly as the Demo root's own record does.
  const demoRecord = (entries: readonly PublicDemoEntry[]): ExprNode => ({ kind: "literal", value: {
    __record: { fields: entries.map((entry) => ({ name: entry.name, value: "members" in entry ? demoRecord(entry.members) : entry.expr })) },
  } });
  const demoRecordType = (entries: readonly PublicDemoEntry[]): FenelType => ({ $record: { fields: entries.map(entry => {
    if ("members" in entry) return { name: entry.name, type: demoRecordType(entry.members), label: nothing, ui: nothing, meta: {} };
    // Expressions without a declared projection use the same checked inference
    // as the editor. Browsing never evaluates the expression or its functions.
    const inferred = entry.type ? undefined
      : inferTransferExpression(entry.expr, session.environment);
    return {
      name: entry.name, type: entry.type ?? (inferred?.outcome.$tag === "Solved" ? inferred.type : undefined)
        ?? { $ref: "Any" }, label: nothing, ui: nothing, meta: {},
    };
  }) } });
  const demoLeaves = (entries: readonly PublicDemoEntry[], prefix: readonly string[]): { entry: PublicDemoValue; path: string[] }[] =>
    entries.flatMap(entry => "members" in entry ? demoLeaves(entry.members, [...prefix, entry.name])
      : [{ entry, path: [...prefix, entry.name] }]);
  const demo = demoRecord(demoValues);
  const demoType = demoRecordType(demoValues);
  const leaves = demoLeaves(demoValues, []);
  for (const { entry, path: at } of leaves) {
    for (const referent of entry.referents ?? []) {
      const path = { itemId: "demo", path: [...at, ...referent.path] };
      for (const address of referent.addresses) catalogPaths.set(address, path);
    }
  }
  // The Fenel page lists the Demo first, then the Standard library.
  const items: LayoutItem[] = [
    { id: "demo", caption: "Demo", source: { kind: "expr", expr: demo }, valueType: demoType,
      representations: { Codeable: { codeName: "demo" }, Labelable: { label: "Demo" }, Iconable: { icon: "play" },
        Describable: { description: PUBLIC_DEMO_DESCRIPTION } } },
    { id: stdItemId, caption: "Standard library", source: { kind: "expr", expr: std }, valueType: stdType,
      representations: { Codeable: { codeName: "std" }, Labelable: { label: "Standard library" }, Iconable: { icon: "stack" },
        Describable: { description: PUBLIC_STD_DESCRIPTION } } },
  ];
  const id = "public-fenel";
  const referenceId = `locus:${id}`;
  const expr: ExprNode = { kind: "literal", value: { __list: [demo, std] } };
  const expressions: Record<string, ExprNode> = {
    [referenceId]: expr,
    [`locus:${id}:std`]: std,
    [`locus:${id}:demo`]: demo,
  };
  const sourceValues = new Map<string, PublicSourceBindings["values"][number]>();
  const sourceItems = new Map<string, LayoutItem>();
  for (const { entry } of leaves) if (entry.bindings) {
    for (const row of entry.bindings.values) {
      if (sourceValues.has(row.id) && sourceValues.get(row.id) !== row) throw new Error("The public source has ambiguous binding identities.");
      sourceValues.set(row.id, row);
      expressions[row.id] = row.query.expr;
    }
    for (const item of entry.bindings.items) {
      if (sourceItems.has(item.id) && sourceItems.get(item.id) !== item) throw new Error("The public source has ambiguous occurrence identities.");
      sourceItems.set(item.id, item);
    }
  }
  // Copy the caller's already-scoped dispatch facts (including misses), never
  // rows or callable bodies. Carrying checked signatures needs no evaluator.
  const projectPreviewMetadata = () => {
    const previewTargets = new Set<string>();
    for (const address of catalogPaths.keys()) {
      const fn = registry.getFunction(address);
      if (fn) {
        previewTargets.add(registry.getUuid(fn.id) ?? fn.id);
        previewTargets.add(fn.id);
        for (const parameter of fn.params) {
          if (parameter.key?.$tag === "NamedField") previewTargets.add(parameter.key.ref.$ref);
        }
      }
      else {
        const entity = registry.getIdentifiedEntity(address);
        const owner = entity && registry.getEntityNominalIdentity(entity.id);
        if (owner) {
          previewTargets.add(owner);
          const handle = registry.getUuid(entity!.id);
          if (handle) previewTargets.add(handle);
          // Declared type refs already carry this registered identity; retain
          // that lookup too without publishing catalog/function wire aliases.
          previewTargets.add(entity!.id);
        }
      }
    }
    // Each demo section's own description and mark, keyed by its address
    // (public-section-presentation.ts). The shell reads them for its cards
    // and page header; nothing else resolves these keys.
    const sections = (entries: readonly PublicDemoEntry[], path: readonly string[]): ReaderMetadataEntry[] => entries.flatMap(entry => {
      const at = [...path, entry.name];
      const own = { ...(typeof entry.description === "string" && entry.description.trim() ? { description: entry.description } : {}), ...(entry.icon ? { icon: entry.icon } : {}),
        ...("members" in entry && entry.layout ? { layout: entry.layout } : {}) };
      return [...(Object.keys(own).length ? [{ target: publicSectionTarget("demo", at), ownPresentation: own, representations: [] }] : []),
        ...("members" in entry ? sections(entry.members, at) : [])];
    });
    return { entries: [...[...previewTargets].map((target): ReaderMetadataEntry => {
      const callable = registry.getFunction(target);
      const icon = presentation?.representation("Iconable", target);
      const label = presentation?.representation("Labelable", target);
      const code = presentation?.representation("Codeable", target);
      const own = presentation?.presentation?.(target);
      // B3/Undefinable egress: omit absent optional DTO fields before the exact
      // checkpoint roundtrip. Keep defined facts, including localized labels,
      // verbatim; their meaning stays with the scoped source projection.
      const ownPresentation = own === undefined ? undefined : {
        ...(own.label === undefined ? {} : { label: own.label }),
        ...(own.description === undefined ? {} : { description: own.description }),
        ...(own.codeName === undefined ? {} : { codeName: own.codeName }),
        ...(own.icon === undefined ? {} : { icon: own.icon }),
        ...(own.emoji === undefined ? {} : { emoji: own.emoji }),
      };
      return { target, ...(callable ? { canonicalTarget: registry.getUuid(callable.id) ?? callable.id } : {}),
        ...(ownPresentation === undefined ? {} : { ownPresentation }), representations: [
        ...(icon ? [{ typeName: "Iconable", methods: { icon: icon.icon } }] : []),
        ...(label ? [{ typeName: "Labelable", methods: { label: label.label } }] : []),
        ...(typeof code?.codeName === "string" ? [{ typeName: "Codeable", methods: { codeName: code.codeName } }] : []),
      ] };
    }), ...sections(demoValues, [])] };
  };
  const describe = (root: Parameters<typeof projectReaderTypeDescriptions>[0]) => projectReaderTypeDescriptions(root, {
    evaluateContext: session.evaluateContext,
    get referenceRoutes() { return session.environment.catalog.referenceRoutes; },
    get constructorRoutes() { return session.environment.catalog.exactConstructorRoutes; },
    get constructorTargets() { return session.environment.catalog.patternConstructors; },
  }, handle => {
    const label = presentation?.representation("Labelable", handle)?.label;
    const codeName = presentation?.representation("Codeable", handle)?.codeName;
    return readerPresentationDto({ label: label as LocaleString }).label
      || (typeof codeName === "string" ? codeName : "") || registry.getIdentifiedEntity(handle)?.id || handle;
  }, handle => {
    const codeName = presentation?.representation("Codeable", handle)?.codeName;
    return (typeof codeName === "string" ? codeName : "") || registry.getIdentifiedEntity(handle)?.id || handle;
  }, handle => registry.getIdentifiedEntity(handle)?.type);
  // A function whose signature is declared as a named type (`lubeFormula :
  // Recipe`) is spoken by that name before the reader answers, as it is after
  // (Rom, Nov 12: "a recipe's type is Recipe"). Its field keeps the unfolded
  // arrow as its type; only that arrow's words and code are the declared
  // type's. The arrow is matched by its parameters' own field identities.
  const projectTypeDescriptions = () => {
    const declaredByParameters = new Map<string, FenelType>();
    for (const address of catalogPaths.keys()) {
      const fn = registry.getFunction(address);
      const key = fn && declaredArrowKey(fn.params);
      const declared = fn && key ? declaredFunctionType(registry, fn) : undefined;
      if (key && declared) declaredByParameters.set(key, declared);
    }
    return describe({ type: rootType, items }).map(description => {
      const key = "$arrow" in description.type ? declaredArrowKey(description.type.$arrow.params) : undefined;
      const declared = key ? declaredByParameters.get(key) : undefined;
      const named = declared && describe({ type: declared }).find(entry => JSON.stringify(entry.type) === JSON.stringify(declared));
      return named?.phrase ? { ...description, phrase: named.phrase, code: named.code } : description;
    });
  };
  const root: LocusRootData = Object.freeze({
    id, name: "All data", type: rootType, expr, revision: 0, persisted: false,
    canEdit: false, layout: { kind: "list" as const }, items, lists: [], expressions, referenceId,
    previewMetadata: projections ? projections.previewMetadata : projectPreviewMetadata(),
    typeDescriptions: projections ? projections.typeDescriptions : projectTypeDescriptions(),
  });
  const catalogLookups: LocusCatalogLookups = Object.freeze({
    fn: (handle: string) => registry.getFunction(handle),
    typeFamilyOwner: (handle: string) => session.evaluateContext._typeFamilyOwner?.(handle),
    entry: () => undefined,
    entityType: (handle: string) => registry.getIdentifiedEntity(handle)?.type,
  });
  return Object.freeze({ root, registry, session, catalogLookups, catalogPaths,
    ...(sourceValues.size ? { sourceBindings: { values: [...sourceValues.values()], items: [...sourceItems.values()] } } : {}) });
}

/** One function's arrow, named by its parameters' own field identities (each
 * declared parameter has its own); undefined when a parameter has none. */
function declaredArrowKey(params: readonly FieldDef[]): string | undefined {
  const keys = params.map(param => param.key?.$tag === "NamedField" ? param.key.ref.$ref : undefined);
  return keys.length && keys.every(key => typeof key === "string") ? keys.join("|") : undefined;
}

/** The named type a function's signature is declared as (`lubeFormula :
 * Recipe`), read from the registry's own scheme; undefined for a written arrow. */
function declaredFunctionType(registry: ModuleRegistry, fn: FenelFunction): FenelType | undefined {
  // The checked scheme first, then the source declaration (`f : Recipe`).
  for (const body of [registry.getFunctionScheme?.(fn.id)?.body, fn.signatureDeclaration?.scheme?.body]) {
    if (body && typeof body === "object" && "$ref" in body && typeof body.$ref === "string") return body;
  }
  return undefined;
}

/** The two public root values' own descriptions (their cards and page headers). */
const PUBLIC_DEMO_DESCRIPTION = "Things made with Fenel. Open one to read its data, functions and types.";
const PUBLIC_STD_DESCRIPTION = "The built-in functions and types.";

let prepared: Promise<PublicLocusData> | undefined;
export const PUBLIC_DEMO_NAMES = ["Reversed shouting", "Compound interest", "Reversed words"] as const;

/** The finished demos, in the order the public Demo lists them. Every other
 * public demo value keeps its order inside one last entry, `Unfinished demos`.
 * Move a demo from one side to the other by adding or removing its name here. */
export const PUBLIC_FINISHED_DEMOS: readonly string[] = [
  "People and projects",
  "Recipe functions",
  "Solver",
  "Tree of life",
  "Living things",
  "Countries of the world",
  "Greek alphabet",
  "Writing systems",
  "Programming languages",
  "Input checking",
  "Drawing",
];
export const PUBLIC_UNFINISHED_DEMOS = {
  name: "Unfinished demos",
  description: "Earlier demos that have not been reworked yet. They may be rough.",
  icon: "folder",
} as const;

/** Each collection's mark on its card and page header: an app line icon
 * (`icons.tsx`). Our own drawings replace them after launch. */
export const PUBLIC_DEMO_MARKS: Readonly<Record<string, string>> = {
  "People and projects": "users",
  "Recipe functions": "utensils",
  "Solver": "calculator",
  "Tree of life": "binary-tree",
  "Living things": "sprout",
  "Countries of the world": "globe",
  "Greek alphabet": "type",
  "Writing systems": "languages",
  "Programming languages": "code",
  "Input checking": "circle-check",
  "Drawing": "pencil",
  "Types and forms": "shapes",
  "Images": "image",
  "Languages": "message-square",
  "Statistics": "activity",
  "Data import": "file-text",
  "Animation": "play",
  "Recipes and rules": "list-check",
  "Documents": "file-text",
  "Named claims": "shield-check",
  "Axioms": "infinity",
};

/** `Data instead of files` (owner, Nov 12): the first demo, one screen of
 * different kinds of data. It holds no value of its own: each member is an
 * existing value by reference, a gallery example below or a field of another
 * demo (the same expression, type and source bindings, so a change to Rom
 * shows in both places). */
export const PUBLIC_DATA_DEMO = {
  name: "Data instead of files",
  description: "A picture, a text, a list, a function: each is data.",
  icon: "layout-grid",
  layout: "tiles",
} as const;
/** The gallery examples (`seed-values-source.ts`) that only this demo shows. */
export const PUBLIC_DATA_SEED_NAMES = [
  "An iris", "A sentence", "Double 21", "Sorted then reversed",
] as const;
/** Every gallery example the public reader needs: the root's, then this demo's. */
export const PUBLIC_SEED_NAMES: readonly string[] = [...PUBLIC_DEMO_NAMES, ...PUBLIC_DATA_SEED_NAMES];
/** Its members in screen order: a few values, each large enough to be seen
 * without zooming (owner, 01:25: "five or six"), two rows of three at 1280 px
 * with kinds alternating. `[example]` is a gallery example by name,
 * `[label, demo, field]` a field of another demo. */
export const PUBLIC_DATA_MEMBERS: readonly (readonly [string] | readonly [string, string, string])[] = [
  ["An iris"],
  ["Greek alphabet", "Greek alphabet", "Greek alphabet"],
  ["Square formula", "Drawing", "Square formula"],
  ["A sentence"],
  ["Double 21"],
  ["Sorted then reversed"],
];

/** The members of `Data instead of files` found among `values`, by reference.
 * A member whose source is absent is left out (a reader given fewer demos). */
export function publicDataMembers(values: readonly PublicDemoValue[]): PublicDemoValue[] {
  const byName = new Map(values.map(value => [value.name, value]));
  return PUBLIC_DATA_MEMBERS.flatMap((member): PublicDemoValue[] => {
    if (member.length === 1) {
      const example = byName.get(member[0]);
      return example ? [example] : [];
    }
    const [label, from, field] = member;
    const demo = byName.get(from);
    const fields = demo?.expr.kind === "literal"
      ? (demo.expr.value as { __record?: { fields?: readonly { name: string; value: ExprNode }[] } } | undefined)?.__record?.fields : undefined;
    const value = fields?.find(row => row.name === field)?.value;
    if (!demo || !value) return [];
    const type = demo.type && "$record" in demo.type ? demo.type.$record.fields.find(row => row.name === field)?.type : undefined;
    return [{ name: label, description: "", expr: value, ...(type ? { type } : {}),
      ...(value.kind === "ref" && demo.bindings ? { bindings: demo.bindings } : {}) }];
  });
}

/** The public Demo's root order: `Data instead of files`, the finished demos,
 * then one group holding the others. Every value appears exactly once; nothing
 * is renamed. The data demo's own examples appear only there; the fields it
 * borrows stay in their demos too. */
export function arrangePublicDemos(values: readonly PublicDemoValue[]): PublicDemoEntry[] {
  const byName = new Map(values.map(value => [value.name, value]));
  if (byName.size !== values.length || byName.has(PUBLIC_UNFINISHED_DEMOS.name) || byName.has(PUBLIC_DATA_DEMO.name))
    throw new Error("The public demos have a repeated name.");
  const finished = PUBLIC_FINISHED_DEMOS.map(name => {
    const value = byName.get(name);
    if (!value) throw new Error(`The finished public demo ${JSON.stringify(name)} is not available.`);
    return value;
  });
  const listed = new Set(PUBLIC_FINISHED_DEMOS);
  if (listed.size !== PUBLIC_FINISHED_DEMOS.length) throw new Error("A finished public demo is listed twice.");
  const own = new Set<string>(PUBLIC_DATA_SEED_NAMES);
  const unfinished = values.filter(value => !listed.has(value.name) && !own.has(value.name));
  const members = publicDataMembers(values);
  return [...(members.length ? [{ ...PUBLIC_DATA_DEMO, members }] : []), ...finished,
    ...(unfinished.length ? [{ ...PUBLIC_UNFINISHED_DEMOS, members: unfinished }] : [])];
}

/** Reflect the source-owned starting-input provider, without evaluating it.
 * Names select a source roster; exact UUID roundtrips select its values. */
export function publicDemoInputProvider(registry: ModuleRegistry, fnId: string): FenelFunction | undefined {
  const target = registry.getFunction(fnId);
  const targetHandle = target && registry.getUuid(target.id);
  if (!target || !targetHandle || registry.getFunction(targetHandle)?.id !== target.id) return undefined;
  for (const [sourceName, providerName] of [
    ["SolverDemo", "solverDemoStartingInputs"],
    ["ImageDemo", "imageDemoStartingInputs"],
    ["CheckDemo", "checkDemoStartingInputs"],
    ["PasswordRecordDemo", "passwordRecordDemoStartingInputs"],
    ["LocaleDemo", "localeDemoStartingInputs"],
    ["DrawingDemo", "drawingDemoStartingInputs"],
    ["StatisticsDemo", "statisticsDemoStartingInputs"],
    ["ImportDemo", "importDemoStartingInputs"],
    ["AnimationDemo", "animationDemoStartingInputs"],
    ["RecipeDemo", "recipeDemoStartingInputs"],
    // A recipe's call form starts with every food (Fenel batch 4; absent until it lands).
    ["RecipeFunctions", "recipeFunctionsStartingInputs"],
    ["EncyclopediaDemo", "encyclopediaDemoStartingInputs"],
    ["DocumentDemo", "documentDemoStartingInputs"],
    ["GreekAlphabetDemo", "greekAlphabetDemoStartingInputs"],
    ["ClaimsDemo", "claimsDemoStartingInputs"],
    ["AxiomsDemo", "axiomsDemoStartingInputs"],
    ["UtilityDemo", "utilityDemoStartingInputs"],
  ] as const) {
    const owners = registry.modules.filter(module => module.name === sourceName);
    if (owners.length !== 1) continue;
    const owner = owners[0]!;
    if (owner.functionNamespace !== undefined && owner.functionNamespace !== sourceName) continue;
    if (!(owner.functions ?? []).some(member => member.id === target.id && registry.getFunction(member.id) === target)) continue;
    const members = registry.listModuleMembers(sourceName);
    if (!members.some(member => registry.getFunction(`${sourceName}.${member}`) === target)) continue;
    if (!members.includes(providerName)) return undefined;
    const provider = registry.getFunction(`${sourceName}.${providerName}`);
    if (!provider || !(owner.functions ?? []).some(member => member.id === provider.id && registry.getFunction(member.id) === provider)) return undefined;
    const handle = registry.getUuid(provider.id);
    const canonical = handle && registry.getFunction(handle);
    return canonical && canonical.id === provider.id ? canonical : undefined;
  }
  return undefined;
}

/** Host identity/type projection of source-owned examples, matching std's
 * projection above. Fenel bodies own computations and explanations. */
export function publicSourceDemoValues(registry: ModuleRegistry, nothing: typeof Nothing,
  presentation?: Pick<ReturnType<typeof createReaderPresentation>, "representation">,
  sourceBindings?: PublicSourceBindings): PublicDemoValue[] {
  const collection = (name: string, description: string, module: string,
    functions: readonly (readonly [string, string, string?])[], types: readonly (readonly [string, string, string?])[] = [],
    data: readonly (readonly [string, string, "expression"?])[] = [],
    /** Data entries listed first, before the functions (same rules as `data`). */
    leadingData: readonly (readonly [string, string, "expression"?])[] = [],
    /** Nested collections listed after the functions: a second group on the
     * page, an ordinary record field whose addresses nest under its name. */
    groups: readonly PublicDemoValue[] = []): PublicDemoValue => {
    const values: Array<{ name: string; value: ExprNode }> = [];
    const fields: FieldDef[] = [];
    const referents: PublicDemoReferent[] = [];
    let usesBindings = groups.some(group => !!group.bindings);
    // Ordinary sample data uses an inert Call and its declared result type.
    // Explicit source-expression entries expose authored calls without running them.
    const addData = (entries: readonly (readonly [string, string, "expression"?])[]) => {
      for (const [label, member, projection] of entries) {
        const fn = registry.getFunction(`${module}.${member}`);
        const handle = fn && registry.getUuid(fn.id);
        if (!fn || fn.params.length !== 0 || !handle || registry.getFunction(handle)?.id !== fn.id) {
          throw new Error(`The public data ${module}.${member} has no exact zero-argument repository identity.`);
        }
        // A2/B3 host reflection: only an explicit source-expression entry
        // projects its body. Other data retains its inert zero-argument call.
        // Freeze source/import selections into exact identities before moving
        // the expression into the public reader's frame; no body is executed.
        let expression: ExprNode = { kind: "call", fnId: handle, args: [] };
        if (sourceBindings?.values.some(row => row.id === handle)) {
          expression = { kind: "ref", savedExprId: handle };
          usesBindings = true;
          referents.push({ addresses: [fn.id, handle], path: [label] });
        } else if (projection === "expression") {
          const body = fn.body;
          if (body === undefined) throw new Error(`The public expression ${module}.${member} has no source body.`);
          const bound = logicToExprNode(body, [], name => {
            const route = registry.resolveFunctionDraftReferences(fn.id, [name])[0];
            if (route?.status !== "resolved") throw new Error(`The public expression ${module}.${member} cannot resolve ${name} in its source frame.`);
            const target = registry.getFunction(route.targetId);
            const identity = target && registry.getUuid(target.id);
            if (!target || !identity || registry.getFunction(identity)?.id !== target.id) {
              throw new Error(`The public expression ${module}.${member} has no exact identity for ${name}.`);
            }
            return identity;
          });
          expression = logicToExprNode(exprNodeToLogic(bound, {
            preserveSourceHeads: false, fnCodeName: identity => identity,
            constructorName: () => undefined,
          }));
        }
        values.push({ name: label, value: expression });
        // The raw returns lacks the declaration's nested owners: readers check
        // this data against the declaration's own scheme (public-data-declaration.ts).
        recordPublicDataDeclaration(fn.returns, handle);
        fields.push({ name: label, type: fn.returns, label: nothing, ui: nothing, meta: {} });
      }
    };
    addData(leadingData);
    for (const [label, member, sourceOwner = module] of functions) {
      const fn = registry.getFunction(`${sourceOwner}.${member}`);
      const handle = fn && registry.getUuid(fn.id);
      if (!fn || !handle || registry.getFunction(handle)?.id !== fn.id) throw new Error(`The public example ${sourceOwner}.${member} has no exact repository identity.`);
      values.push({ name: label, value: { kind: "literal", value: Object.freeze({ $ref: handle }) } });
      fields.push({ name: label, type: { $arrow: { params: fn.params, returns: fn.returns } }, label: nothing, ui: nothing, meta: {} });
      referents.push({ addresses: [fn.id, handle], path: [label] });
    }
    // Types come last on a collection page: its data and functions first,
    // then its groups (a second, separate part of the page).
    addData(data);
    for (const group of groups) {
      if (!group.type) throw new Error(`The public group ${group.name} has no record type.`);
      values.push({ name: group.name, value: group.expr });
      fields.push({ name: group.name, type: group.type, label: nothing, ui: nothing, meta: {} });
      for (const referent of group.referents ?? []) referents.push({ addresses: referent.addresses, path: [group.name, ...referent.path] });
    }
    for (const [label, member, sourceOwner = module] of types) {
      const entity = registry.getIdentifiedEntity(member);
      const handle = entity && registry.getUuid(entity.id);
      const owner = entity && registry.getEntityNominalIdentity(entity.id);
      if (!entity || entity.module !== sourceOwner || !handle || !owner || registry.getEntityNominalIdentity(handle) !== owner || registry.getFunction(handle)) {
        throw new Error(`The public example type ${module}.${member} has no exact repository identity.`);
      }
      values.push({ name: label, value: { kind: "literal", value: Object.freeze({ $ref: handle }) } });
      fields.push({ name: label, type: { $type: true }, label: nothing, ui: nothing, meta: {} });
      referents.push({ addresses: [entity.id, handle, `entity:${entity.id}`, `entity:${sourceOwner}.${entity.id}`], path: [label] });
    }
    const icon = PUBLIC_DEMO_MARKS[name];
    return { name, description, ...(icon ? { icon } : {}), expr: { kind: "literal", value: { __record: { fields: values } } }, type: { $record: { fields } }, referents,
      ...(usesBindings ? { bindings: sourceBindings } : {}) };
  };
  // B3: carry source-owned ordinary records and their scoped presentation.
  // Their fields/signatures/references stay in Fenel; browsing never runs them.
  const sourceRecords: PublicDemoValue[] = [];
  if (presentation) for (const member of ["textTools", "numberTools", "colorTools", "dateTools", "unitTools"] as const) {
    const fn = registry.getFunction(`UtilityDemo.${member}`);
    const handle = fn && registry.getUuid(fn.id);
    if (!fn || fn.params.length !== 0 || !handle || registry.getFunction(handle)?.id !== fn.id) {
      throw new Error(`The public data UtilityDemo.${member} has no exact zero-argument repository identity.`);
    }
    const label = presentation.representation("Labelable", handle)?.label;
    const description = presentation.representation("Describable", handle)?.description;
    // An unavailable reader projection supplies no public presentation facts.
    if (label === undefined || description === undefined) continue;
    const projected = readerPresentationDto({ label: label as LocaleString, description: description as LocaleString });
    sourceRecords.push({ name: projected.label!, description: projected.description!,
      expr: { kind: "call", fnId: handle, args: [] }, type: fn.returns,
      referents: [{ addresses: [fn.id, handle], path: [] }],
    });
  }
  // The utility records follow the collections (they sit inside
  // `Unfinished demos`; see PUBLIC_FINISHED_DEMOS).
  return [
    collection("People and projects", "People, projects and a mascot are ordinary typed data. Rom is Fenel's author; Aajonus is the Primal Diet's, whose two formulas are references to recipe functions; Healthfully, by Bayne and Rom, names the Primal Diet as its inspiration. Fenel is named after common fennel, takes giant fennel as its emblem, is inspired by ten programming languages, and its logo by the fennels. Edit in Local copies them into Local with the plants, their genera and family; open a project's dependencies to follow the links. A change to a person or a plant updates everything that references it. Unconfirmed personal details and social links stay absent.", "ShowcaseDemo", [], [
      ["Person", "PublicPerson"], ["Project", "Project"], ["Logo", "Logo"], ["Mascot", "Mascot"], ["Social link", "SocialLink"],
    ], [["People", "showcasePeople"], ["Projects", "showcaseProjects"],
      ["Rom", "showcaseRom"], ["Bayne", "showcaseBayne"], ["Aajonus", "showcaseAajonus"], ["Fenel", "showcaseFenel"],
      ["Primal Diet", "showcasePrimalDiet"], ["Healthfully", "showcaseHealthfully"], ["BayneOS", "showcaseBayneOS"],
      ["DripCollector", "showcaseDripCollector"], ["7CatYear", "showcaseSevenCatYear"],
      ["Fen", "showcaseFen"]]),
    collection("Types and forms", "Open the contact input type, change its temporary draft and fill in the generated input beside it. Reset restores the example.", "CheckDemo", [
      ["Change the type, change the input", "typeFormDemo"],
    ], [["Contact input", "CheckContactInput"]]),
    collection("Solver", "Call solve on an ordinary predicate function and a domain: exact answers to linear systems, every answer in a finite domain, train routes and meeting slots over typed rows, and honest Unknown answers. Change typed inputs and inspect the evidence.", "SolverDemo", [
      ["Solve", "solve"],
      ["Where can I go by train?", "destinationsFrom"], ["One change, under a time limit", "oneChangeTrips"],
      ["Reachable from one city but not another", "reachableOnlyFrom"], ["Find a meeting slot", "meetingSlots"],
      ["Solve an equation", "affineEquation"], ["Find grandparents", "grandparentsOf"],
      ["Find book buyers", "bookBuyersBefore"], ["Empty or undecided?", "finiteIntersection"],
      ["An unsupported equation", "quadraticEquation"],
    ], [["Customer", "SolverCustomer"], ["Purchase", "SolverPurchase"]], [
      ["Solve: tickets sold", "solveTicketsSold", "expression"], ["Solve: the same line twice", "solveSameLineTwice", "expression"],
      ["Solve: circle over whole numbers", "solveCircleWholeNumbers", "expression"], ["Solve: circle over all numbers", "solveCircleAllNumbers", "expression"],
    ]),
    collection("Images", "Edit a small encoded image as ordinary rows of RGBA pixel data, explore the supplied market photograph and a photo expression with rotation, colour inversion, blur and a layered landscape, then explore the original landscape and composed raster filters. Color frequencies and spectra retain separate source data.", "ImageDemo", [
      ["Edit pixel data", "imageMatrixDemo"], ["Image to rows", "imageRows"], ["Rows to image", "imageFromRows"],
      ["Images: one to many", "imageFilterDemo"], ["Soft grayscale", "softGrayscale"],
      ["Soft edges", "softEdges"], ["Retro landscape", "retroLandscape"],
    ], [["Image filter results", "ImageFilterResults"], ["Image matrix result", "ImageMatrixResults"]],
    [["Fennel at the market", "marketPhoto"], ["Photo editing chain", "marketPhotoPipeline", "expression"], ["Small image", "imageMatrixSample"], ["Pixel rows", "imageMatrixSampleRows"], ["Empty image", "imageMatrixEmpty"]]),
    collection("Input checking", "Correct typed inputs, compare fixed password rules and check whole credentials or nested orders through the same membership judgment.", "CheckDemo", [
      ["Sign up with live hints", "checkSignUp"],
      ["Check an email", "checkEmailInput"], ["Try a date mask", "checkDateInput"],
      ["Try a UUID mask", "checkUuidInput"], ["Check a quantity", "checkQuantityInput"],
      ["Check a contact record", "checkContactInput"],
      ["Check a fixed password policy", "checkHardenedPassword", "PasswordRecordDemo"],
      ["Compare a consecutive-run password policy", "checkSmartPassword", "PasswordRecordDemo"],
      ["Inspect fixed password criteria", "passwordHardenedCriteria", "PasswordRecordDemo"],
      ["Inspect consecutive-run criteria", "passwordSmartCriteria", "PasswordRecordDemo"],
      ["Check a whole credentials record", "checkCredentialsRecord", "PasswordRecordDemo"],
      ["Check a nested order", "checkNestedOrder", "PasswordRecordDemo"],
    ], [
      ["Password with one hint per rule", "HintPassword"],
      ["Fixed password type", "HardenedExamplePassword", "PasswordRecordDemo"],
      ["Consecutive-run password type", "SmartExamplePassword", "PasswordRecordDemo"],
      ["Whole credentials type", "MatchingCredentials", "PasswordRecordDemo"],
      ["Nested order type", "CheckedNestedOrder", "PasswordRecordDemo"],
    ]),
    collection("Languages", "Choose a reader language while the multilingual data and source stay unchanged.", "LocaleDemo", [
      ["One value, two languages", "languagePreview"], ["Multilingual label", "localeDemoLabel"],
      ["Description with a missing translation", "localeDemoDescription"],
    ]),
    collection("Drawing", "Edit a function of x, inspect its typed points and path, then compose circles, lines and a filled polygon into an image.", "DrawingDemo", [
      ["Formula to curve", "formulaCurve"], ["Draw layered shapes", "layeredDrawing"],
      ["Formula to chart", "formulaChart"], ["Chart point data", "pointLineChart"],
      ["Square formula", "squareFormula"], ["Sample a formula", "formulaPoints"],
      ["Project math coordinates", "curveCoordinates"], ["Join points with lines", "straightPath"],
      ["Draw a sampled curve", "curvePicture"], ["Compose picture layers", "layeredPicture"],
      ["Triangle path", "drawingTriangle"], ["Diagonal line path", "drawingLine"],
    ], [["Formula curve result", "FormulaCurveResult"], ["Layered drawing result", "LayeredDrawingResult"], ["Point line chart", "PointLineChart"]]),
    collection("Statistics", "Edit numbers or customer purchases, then inspect Fenel-computed summaries, grouped totals and a chart of the original numbers.", "StatisticsDemo", [
      ["Summarize numbers", "numberStatistics"], ["Chart numbers", "numberChart"],
      ["Summarize purchases", "purchaseStatistics"],
      ["Customer totals", "customerBreakdown"], ["Sample numbers", "statisticsSampleNumbers"],
      ["Sample customers", "statisticsSampleCustomers"], ["Sample purchases", "statisticsSamplePurchases"],
      ["Sample customer totals", "statisticsSampleBreakdown"],
      ["Total calculation", "statisticsTotal"], ["Summary calculation", "summarizeNumbers"],
      ["Per-customer calculation", "statisticsCustomerSummary"],
    ], [["Number summary", "NumberSummary"], ["Number statistics", "NumberStatistics"],
      ["Purchase statistics", "PurchaseStatistics"], ["Customer", "StatisticsCustomer"],
      ["Purchase", "StatisticsPurchase"], ["Customer purchase summary", "CustomerPurchaseSummary"]],
    [["Number data", "statisticsSampleNumbers"], ["Customer data", "statisticsSampleCustomers"],
      ["Purchase data", "statisticsSamplePurchases"], ["Customer totals data", "statisticsSampleBreakdown"]]),
    collection("Data import", "Inspect named regex groups or bounded Lisp trees, decode retained UTF-8 files, format JSON, or convert CSV text tables and JSON records while preserving every cell as text. The declared purchase format adds checked purchases and customer totals. Invalid input keeps its errors.", "ImportDemo", [
      ["Inspect regex", "inspectRegexInput"],
      ["Inspect Lisp", "inspectLispInput"], ["Format Lisp", "formatLispInput"],
      ["File as text", "fileText"], ["JSON file data", "fileJson"], ["CSV file data", "fileCsv"],
      ["Inspect JSON", "inspectJsonInput"], ["Format JSON", "formatJsonInput"],
      ["Minify JSON", "minifyJsonInput"], ["Inspect JSON data", "inspectJsonValue"],
      ["Inspect CSV", "inspectCsvInput"], ["CSV text to JSON", "csvTextToJsonInput"],
      ["JSON text to CSV", "jsonTextToCsvInput"],
      ["Check a JSON purchase", "checkPurchaseJsonInput"],
      ["Read CSV purchases", "purchasesFromCsvInput"], ["Read JSON purchases", "purchasesFromJsonInput"],
      ["Convert CSV to JSON", "csvToJsonInput"], ["Convert JSON to CSV", "jsonToCsvInput"],
      ["Statistics from CSV", "statisticsFromCsvInput"], ["Statistics from JSON", "statisticsFromJsonInput"],
      ["Write purchases as CSV", "purchasesToCsv"], ["Write purchases as JSON", "purchasesToJson"],
      ["Read one CSV line", "importCsvLine"],
      ["Sample CSV", "importSampleCsv"], ["Sample JSON", "importSampleJson"], ["Sample Lisp", "lispSampleText"],
    ], [["Regex inspection", "RegexInspection"], ["Regex semantic node", "RegexNodeBreakdown"],
      ["Lisp inspection", "LispInspection"], ["Lisp syntax tree", "LispNode"],
      ["File text", "FileText"], ["JSON file inspection", "FileJson"], ["CSV file inspection", "FileCsv"],
      ["JSON purchase check", "ImportJsonCheck"], ["JSON inspection", "JsonInspection"],
      ["CSV table", "CsvTable"], ["CSV inspection", "CsvInspection"], ["JSON data type", "JsonValue", "codec"]],
    [["CSV data", "importSampleCsv"], ["JSON data", "importSampleJson"], ["Lisp data", "lispSampleText"]]),
    collection("Animation", "Move the Drawing scene with a Fenel time formula, play a bounded frame sequence, and inspect exact snapshots.", "AnimationDemo", [
      ["Play the drawing", "animationClip"], ["Inspect one instant", "animationSnapshot"],
      ["Four fixed snapshots", "animationSnapshots"], ["Motion formula", "motionFormula"],
      ["Drawing over time", "drawingAnimation"], ["Picture at a time", "animationPicture"],
    ], [["Animation snapshot", "AnimationSnapshot"]]),
    // Rom (Nov 12): this page shows the two recipes; the calls, facts and
    // types are other data, so they follow as two groups of their own.
    collection("Recipe functions", "Two recipes, each a pure function: the moisturizing-lubrication formula and the sports formula. Each takes the foods you have and returns every preparation it allows with them. Open one to see its expression and the facts derived from it. Examples gives the moisturizing-lubrication formula three lists of foods: one preparation comes out, then two, then none. Edit in Local copies the moisturizing-lubrication formula, the foods it chooses from and its facts into Local; change the function or turn foods off and on to recompute its facts. The examples make no health claim.", "RecipeFunctions", [
      ["Moisturizing-lubrication formula", "lubeFormula"], ["Sports formula", "hydrationFormula"],
    ], [], [], [], [
      collection("Examples", "The moisturizing-lubrication formula given three lists of foods: one preparation comes out, then two, then none.", "RecipeFunctions", [], [], [
        ["With butter", "lubeWithButter", "expression"], ["With butter and coconut cream", "lubeWithButterAndCoconutCream", "expression"],
        ["Without honey", "lubeWithoutHoney", "expression"],
      ]),
      collection("Facts and types", "The facts derived from a recipe's expression, the functions that derive them, and the recipe types.", "RecipeFunctions", [
        ["Recipe facts", "recipeCard"],
        ["Reflect a recipe", "recipeReflection"], ["Guaranteed foods", "guaranteed"], ["Necessary foods", "necessary"],
        ["Required fat-rich family", "requiredFatRich"], ["Two of the hydration foods", "hydrationThreshold"],
        ["Preparation size range", "countRange"], ["Kind spread with unknown distances", "recipeKindSpread"],
        ["Conditional substitutes", "substitutes"], ["Strictly optional honey", "optionalHoney"],
      ], [["Food", "Food"], ["Foods", "Pantry"], ["Preparation", "Ingredients"], ["Recipe", "Recipe"], ["Foods to choose from", "PantrySet"]]),
    ]),
    collection("Recipes and rules", "Catalogue-based planning: choose ingredients, personal exclusions and preparation time, then inspect which catalogue recipes qualify and each rule's reasons. The separate Recipe functions example edits functions and derives criteria from their bodies.", "RecipeDemo", [
      ["Plan recipes", "planRecipes"], ["Change the time window", "recipesInWindow"],
      ["Change the recipe rules", "recipesWithRules"], ["Explain recipe rules", "recipeReasons"],
      ["Food catalogue", "recipeFoodCatalogue"], ["Recipe catalogue", "recipeCatalogue"],
    ], [["Planning input", "RecipePlanInput"], ["Recipe rules", "RecipeRules"],
      ["Recipe decision", "RecipeDecision"], ["Recipe plan", "RecipePlan"], ["Recipe choice", "RecipeFunnel"]],
    [["Food data", "recipeFoodCatalogue"], ["Recipe data", "recipeCatalogue"]]),
    collection("Countries of the world", "Browse the existing country data, filter by currency and use the matching country codes as a generated input type. Changes stay local.", "EncyclopediaDemo", [
      ["Filter and choose a country", "countryEncyclopedia"],
      ["Countries using one currency", "countriesUsingCurrency"], ["Country choice type", "countryCodeType"],
    ], [["Country data", "EncyclopediaCountry"], ["Country choice result", "CountryEncyclopediaResult"]],
    [["Countries", "encyclopediaCountries"]]),
    collection("Living things", "A plant family is the set of its species, and each genus a subset of it; the sets by life form cut across the families. The fennels are a set made by people, not by botany: common fennel and giant fennel, whose smallest common botanical group also holds carrot. Fenel's set judgment decides each subset, disjointness, union and intersection on the species records. The sets hold the species described in this collection; other species are not listed.", "Encyclopedia", [], [],
    [["Species sets", "encyclopediaPlantSpeciesSets"], ["Plant species", "encyclopediaPlantSpecies"], ["Plant families", "encyclopediaPlantFamilies"], ["Fennels", "encyclopediaFennels"]]),
    collection("Tree of life", "All life, then kingdoms, classes, families and species, with the pictures we made. Each set is judged inside the one above it by Fenel's set judgment; foods name the living thing they come from.", "Encyclopedia", [], [["Living thing", "LivingThing"], ["Food", "Foodstuff"]], [["Tree of life", "encyclopediaTreeOfLife"], ["Every species", "encyclopediaTreeOfLifeLeaves"], ["Foods by kind", "encyclopediaFoods"], ["Living things by the food they give", "encyclopediaFoodSourceSets"], ["Nightshades and their foods", "encyclopediaNightshades"], ["Foods from nightshades", "encyclopediaNightshadeFoods"]]),
    collection("Programming languages", "Ten programming languages Fenel learns from, each with the year it first appeared and what Fenel takes from it. Fenel's project record points at this list.", "Encyclopedia", [],
      [["Programming language", "ProgrammingLanguage"]], [["Programming languages", "programmingLanguages"]]),
    collection("Documents", "Author a typed document, derive its outline and email draft, export Markdown or XHTML-compatible HTML, and read bounded XHTML or Markdown back into editable data. Markdown headings form an outline. Unsupported input returns an error.", "DocumentDemo", [
      ["Edit a document", "editDocument"], ["Document example", "documentSample"],
      ["Document outline", "outlineDocument"], ["Document as plain text", "plainTextDocument"],
      ["Compose an email draft", "composeDocumentEmail"], ["Preview an email draft", "previewDocumentEmail"],
      ["Document as HTML", "exportDocumentHtml"], ["Document as Markdown", "exportDocumentMarkdown"],
      ["Document from XHTML", "importDocumentHtml"],
      ["Document from Markdown", "importDocumentMarkdown"],
    ], [["Document type", "RichDocument", "std"]], [["A typed document", "documentSample"],
      ["An exportable document", "documentFormatSample"], ["XHTML source", "documentHtmlSample"],
      ["Markdown source", "documentMarkdownSample"]]),
    collection("Greek alphabet", "Browse the modern Greek alphabet, combine letter sets and try bounded unaccented text against the same selected characters.", "GreekAlphabetDemo", [
      ["Explore a letter set", "greekAlphabetExplore"], ["Combine letter sets", "greekAlphabetSets"],
      ["Check Greek text", "greekAlphabetText"], ["Letter choice type", "greekLetterType"],
    ], [], [["Greek alphabet", "greekAlphabet"], ["Character data", "greekCharacters"], ["Sources and scope", "greekAlphabetSources"]]),
    collection("Writing systems", "More alphabets beside the Greek one: the 26 Latin letters, the 33 letters of the Russian alphabet with a Latin transliteration, the 24 runes of the Elder Futhark with their reconstructed names, and the 46 basic hiragana and katakana with their Hepburn readings. Each mark comes first, its reading in the corner.", "Encyclopedia", [],
      [["Latin letter", "LatinLetter"], ["Russian letter", "CyrillicLetter"], ["Rune", "ElderFutharkRune"], ["Kana", "KanaCharacter"]],
      [["Latin alphabet", "latinAlphabet"], ["Russian alphabet", "russianAlphabet"], ["Elder Futhark", "elderFuthark"], ["Hiragana", "hiragana"], ["Katakana", "katakana"]]),
    collection("Named claims", "Inspect a claim's definition, finite domain, exact kernel verdict or sample evidence. Concrete counterexamples and undecided answers retain their own grades.", "ClaimsDemo", [
      ["Check a finite number subset", "finiteNumberSubset"], ["Check currency choices", "paymentCurrencyChoices"],
      ["Try positive-number samples", "positiveNumberSamples"],
    ], [["Named claim", "NamedClaim"]], [["Claim library", "namedClaims"], ["An open-domain claim", "openPositiveClaim"]]),
    collection("Axioms", "Explore seven families of Fenel's foundations through ordinary data and editable examples. Assumed foundations, concrete checks and undecided answers keep their own meaning.", "AxiomsDemo", [
      ["Combine sets", "axiomsLattice"], ["Exactly one value", "axiomsSingleton"],
      ["A function's contract", "axiomsArrow"], ["Recursive lists", "axiomsRecursion"],
      ["One choice shapes the next", "axiomsDependency"], ["Types are data", "axiomsUniverse"],
      ["Create field identities", "axiomsFreshIdentities"],
    ], [["Axiom family", "AxiomFamily"]], [
      ["Lattice", "axiomsLatticeFamily"], ["Singletons", "axiomsSingletonFamily"],
      ["Functions", "axiomsArrowFamily"], ["Recursion", "axiomsRecursionFamily"],
      ["Dependency", "axiomsDependencyFamily"], ["Types as data", "axiomsUniverseFamily"],
      ["Fresh identities", "axiomsFreshIdentityFamily"],
    ]),
    ...sourceRecords,
  ];
}

/** The guest workspace uses the repository-only detached session. Importing
 * this module itself is inert; the shell can paint before the engine loads. */
export function preparePublicLocusData(): Promise<PublicLocusData> {
  prepared ??= (async () => {
    const [{ prepareDetachedAuthoringSession }, { SEED_VALUES }, { List, Anything, Nothing }] = await Promise.all([
      import("./expression-runner/authoring-session"),
      import("./expression-runner/seed-values"),
      import("@fenel/engine/type-foundation"),
    ]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // A caller may have prepared only its checked lens preferences. Actual
    // public data retains the complete cooperative repository preparation.
    const session = await prepareDetachedAuthoringSession();
    // The bundled bootstrap of this same build already holds the two derived
    // projections; recomputing them in the browser blocked the page for about
    // two minutes. Soundness rests on the build gate: every vite build runs
    // `scripts/generate-public-bootstrap.mjs --ensure` (the dev server
    // `--check`), which regenerates the snapshot whenever an input under its
    // `sourceDigest` changes, and a Bun parity test keeps the two equal. A
    // snapshot of another repository identity or build recomputes them.
    const [{ loadPublicBootstrap }, { REPOSITORY_IDENTITY_MANIFEST }, { AUTHORING_BUILD_IDENTITY }] = await Promise.all([
      import("./public-bootstrap"), import("@fenel/engine/repository-identity-manifest"),
      import("./expression-runner/authoring-build-identity"),
    ]);
    const snapshot = await loadPublicBootstrap().catch(() => undefined);
    const projections: PublicLocusProjections | undefined = snapshot
      && snapshot.identityDigest === REPOSITORY_IDENTITY_MANIFEST.digest && snapshot.sourceDigest === AUTHORING_BUILD_IDENTITY
      ? { previewMetadata: snapshot.root.previewMetadata, typeDescriptions: snapshot.root.typeDescriptions } : undefined;
    // Existing source examples; no new IR bodies and no eager media workloads.
    const demos = PUBLIC_SEED_NAMES
      .map((name) => {
        const example = SEED_VALUES.find((entry) => entry.name === name);
        if (!example) throw new Error(`The public demo ${JSON.stringify(name)} is no longer available.`);
        return example;
      });
    // GLOBAL_ONLY: the detached public reader is repository-only; retain its
    // existing frame instead of acquiring an account scope or ambient getter.
    const presentation = createReaderPresentation(() => ({ registry: session.registry,
      session, catalog: [] }));
    return publicLocusDataForSession(session,
      arrangePublicDemos([...publicSourceDemoValues(session.registry, Nothing, presentation, publicShowcaseSourceForSession(session)), ...demos]), List(Anything), Nothing, presentation, projections);
  })().catch((error) => {
    prepared = undefined;
    throw error;
  });
  return prepared.then(async data => {
    // Repository data survives login changes; its anonymous worker does not.
    // Reattach that same public session before exposing it to a new reader.
    const { prepareDetachedAuthoringSession } = await import("./expression-runner/authoring-session");
    await prepareDetachedAuthoringSession();
    return data;
  });
}
