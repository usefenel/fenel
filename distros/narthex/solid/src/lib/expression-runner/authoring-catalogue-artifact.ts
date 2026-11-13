// Repository authoring catalogue: one build-owned projection, reused by the
// Local catalogue worker. `scripts/generate-public-bootstrap.mjs` (the existing
// owner of public repository projections) produces it with the SAME live
// projection below, for an empty Local source, keyed by its source and
// repository identity digests. The worker adopts it only when the Fenel
// admission finds that no Local fact can change a repository row, and then
// adds Local's own rows (authoring-catalogue-delta.ts); any doubt runs the
// unchanged live build.
// Transport/merge glue only: no type, name or presentation judgment lives here.
import type { AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import type { CatalogSection, EvaluateContext } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import { getCatalog } from "@fenel/engine";
import { Nothing } from "@fenel/engine/type-foundation";
import { invokeCallable } from "@fenel/engine/expressions";
import { buildSessionCatalog, sessionCatalogSections } from "./authoring-catalog";
import { createReaderPresentation, type ReaderPresentation } from "../reader-presentation";
import { localCatalogueDelta, mergeLocalCatalogueDelta, observeLocalCatalogue, repositoryFingerprintShape,
  type LocalCatalogueObservation } from "./authoring-catalogue-delta";

import { AUTHORING_CATALOGUE_SCHEMA, CATALOGUE_ANCHOR_SCHEMA, CATALOGUE_TRANSPORT_MARK as MARK, chunkIntegrity, decodeCatalogueTransport,
  type AuthoringCatalogueIndex, type CatalogueChunk as Chunk, type CatalogueEncoded as Encoded } from "./authoring-catalogue-transport";
export { AUTHORING_CATALOGUE_SCHEMA, chunkIntegrity, type AuthoringCatalogueIndex };

const NOTHING_ANCHOR = "foundation.Nothing";

/** Validate the external runtime object without invoking any accessor. The
 * anchor is selected by producer identity; this only checks its current wire
 * contract before binding or reusing a cached graph. */
function catalogueAnchorIsCurrent(): boolean {
  try {
    if (Object.getPrototypeOf(Nothing) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(Nothing);
    const tag = Object.getOwnPropertyDescriptor(Nothing, "$tag");
    return keys.length === 1 && keys[0] === "$tag" && tag !== undefined && Object.hasOwn(tag, "value")
      && tag.value === "Nothing" && tag.enumerable === true;
  } catch { return false; }
}

function catalogueAnchorBindings() {
  if (!catalogueAnchorIsCurrent()) throw new Error("The runtime catalogue anchor is unavailable.");
  return new Map([[NOTHING_ANCHOR, { encoded: { $tag: "Nothing" }, value: Nothing }]]);
}

export type LocalCatalogueInput = {
  localSourceId: string;
  snapshot: FieldPersistenceSnapshot;
  entities: readonly { id: string; type: FenelType; module?: string }[];
  functions?: readonly FenelFunction[];
  localRepresentations?: readonly unknown[];
  /** IDs from the same admitted Local candidate; data stays outside the catalogue. */
  localValueIds?: readonly string[];
  sourceModules?: readonly unknown[];
};
export type LocalCatalogueResult = { catalog: AuthoringCatalogSnapshot; displayCatalog: CatalogSection[] };

/** The worker's live Local projection, unchanged (moved here so the build
 * tool, the worker and the equality test run one implementation). */
export function projectLocalAuthoringCatalogue(registry: ModuleRegistry, frame: EvaluateContext,
  data: LocalCatalogueInput): LocalCatalogueResult & { presentationFor: (id: string) => ReaderPresentation | undefined } {
  const sections = getCatalog(registry);
  // B3: retain this initialization's projected rosters while its catalogue
  // reads scoped presentation; cold lookups resolve in this same frame.
  const presentationSource = { registry,
    session: { evaluateContext: frame }, catalog: sections,
    types: data.entities.map(entity => ({ id: entity.id, name: entity.id })),
    functionRows: (data.functions ?? []).map(fn => ({ id: fn.id, name: fn.id, function: fn })),
  };
  const presentation = createReaderPresentation(() => presentationSource);
  const presentationFor = retainedPresentation(frame, presentation);
  const named = (id: string) => {
    const resolved = presentationFor(id);
    return { name: resolved?.label ?? id, description: resolved?.description ?? "" };
  };
  const displayCatalog = sessionCatalogSections(registry, sections, named, named);
  const catalog = buildSessionCatalog(registry, undefined, { sections: displayCatalog, presentation: presentationFor });
  return { catalog, displayCatalog, presentationFor };
}

/** A2/B3: this local initialization owns its source, anonymous frame and
 * private pool through the synchronous catalogue build. Retain only completed
 * reader projections; the ordinary reader stays dynamic. */
function retainedPresentation(frame: EvaluateContext, presentation: ReturnType<typeof createReaderPresentation>) {
  const completed = new Map<string, ReturnType<typeof presentation.presentation>>();
  const pool = (frame as { _specRegistry?: { version(): unknown } })._specRegistry;
  const readVersion = (): number | undefined => {
    try {
      const value = pool?.version();
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    } catch { return undefined; }
  };
  const version = readVersion();
  let retaining = version !== undefined;
  const retire = () => { retaining = false; completed.clear(); };
  return (id: string) => {
    if (!retaining) return presentation.presentation(id);
    if (readVersion() !== version) {
      retire();
      return presentation.presentation(id);
    }
    if (completed.has(id)) return completed.get(id);
    const resolved = presentation.presentation(id);
    if (readVersion() !== version) retire();
    else completed.set(id, resolved);
    return resolved;
  };
}

// ---------------------------------------------------------------------------
// Admission. The Fenel owner decides from observed identity sets; any fact the
// worker could not observe reads as unobserved and refuses.

/** Host observation only: the Local roster's identities, counts and observed
 * identity sets, as the record the Fenel `view.localCatalogueAdmission` declares. */
export function localCatalogueRoster(data: LocalCatalogueInput, catalogueSourceId: string, observation: LocalCatalogueObservation) {
  const owners = data.snapshot.owners as readonly { kind?: unknown; definition?: { id?: unknown } }[];
  return { sourceId: data.localSourceId, catalogueSourceId,
    observed: observation.observed, repositoryFingerprint: observation.repositoryFingerprint, catalogueFingerprint: observation.catalogueFingerprint,
    ownerKinds: owners.map(owner => typeof owner.kind === "string" ? owner.kind : ""),
    ownerIds: owners.map(owner => typeof owner.definition?.id === "string" ? owner.definition.id : ""),
    functionIds: (data.functions ?? []).map(fn => fn.id),
    entityIds: data.entities.map(entity => entity.id),
    fieldIds: data.snapshot.fields.map(field => field.id), fieldRealms: data.snapshot.fields.map(field => String(field.realm)),
    facetFieldIds: data.snapshot.facets.map(facet => facet.fieldId),
    localIdentities: observation.localIdentities, localValueIds: observation.localValueIds, localRowTargets: observation.localRowTargets,
    representationCount: data.localRepresentations?.length ?? 0, sourceModuleCount: data.sourceModules?.length ?? 0,
    repositoryMentions: observation.repositoryMentions, repositoryValueMentions: observation.repositoryValueMentions, entityCollisions: observation.entityCollisions,
    nameCollisions: observation.nameCollisions, typeNameCollisions: observation.typeNameCollisions,
    repositoryKeepsTypeNames: observation.repositoryKeepsTypeNames, localShapesTypeNames: observation.localShapesTypeNames,
    localTakesTypeNames: observation.localTakesTypeNames, rootCollisions: observation.rootCollisions };
}

export type LocalCatalogueRoster = ReturnType<typeof localCatalogueRoster>;

/** Existing A2/B3 invocation boundary: the reader supplies the exact source
 * owner; only its typed verdict controls repository-catalogue reuse. */
export function admitLocalCatalogue(registry: ModuleRegistry, frame: EvaluateContext, data: LocalCatalogueInput,
  catalogueSourceId: string, observation: LocalCatalogueObservation): { admitted: true } | { admitted: false; reason: string } {
  try {
    const owner = registry.getIdentifiedFunction("view.localCatalogueAdmission");
    const identity = owner && (registry.getUuid(owner.id) ?? owner.id);
    if (!owner || !identity || registry.getFunction(identity)?.id !== owner.id) {
      return { admitted: false, reason: "admission-unavailable" };
    }
    const verdict = invokeCallable({ $ref: identity }, [localCatalogueRoster(data, catalogueSourceId, observation)], frame) as
      { $tag?: unknown; _0?: unknown } | undefined;
    if (verdict?.$tag === "Ok") return { admitted: true };
    return { admitted: false, reason: verdict?.$tag === "Err" && typeof verdict._0 === "string" ? verdict._0 : "admission-failed" };
  } catch { return { admitted: false, reason: "admission-failed" }; }
}

/** The worker cannot consume response bodies while a synchronous registry
 * build occupies its event loop. Give the verified read a bounded completion
 * window after that build; a one-turn grace can abort already-arrived large
 * chunks and unnecessarily select the much slower live projection. */
export const REPOSITORY_READ_GRACE_MS = 10_000;

/** Shape of the checked registry that the repository catalogue was projected
 * from, Local's own rows removed (authoring-catalogue-delta.ts). Equal
 * fingerprints mean the same repository rosters (functions, entities, modules,
 * roots, constructors, capability methods, identity handles) and the same
 * GLOBAL_ONLY dispatch rows. */
export async function repositoryCatalogueFingerprint(registry: ModuleRegistry, frame: EvaluateContext): Promise<string> {
  const shape = repositoryCatalogueFingerprintShape(registry, frame);
  // Two unreadable observations must never become matching fingerprints.
  // The generator refuses the artifact; the worker takes its live path.
  if (shape.pool === null || shape.operators === null) throw new Error("The repository dispatch pool could not be observed.");
  return sha256Hex(JSON.stringify(shape));
}

export function repositoryCatalogueFingerprintShape(registry: ModuleRegistry, frame: EvaluateContext) {
  return repositoryFingerprintShape(registry, frame);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Transport: sharing-preserving JSON, split into per-area chunks so a later
// selective load can fetch only some areas. Loading every chunk restores the
// exact value (same keys, order, undefined slots, Map, non-finite numbers,
// shared objects): equal structured-clone bytes to the live projection.

function collectionsOf(result: LocalCatalogueResult): { path: (string | number)[]; values: unknown[] }[] {
  const out: { path: (string | number)[]; values: unknown[] }[] = [];
  for (const [key, value] of Object.entries(result.catalog)) if (Array.isArray(value)) out.push({ path: ["catalog", key], values: value });
  result.displayCatalog.forEach((section, index) => out.push({ path: ["displayCatalog", index, "entries"], values: section.entries }));
  return out;
}

/** Grouping hint for future selective loading only; never affects values. */
function areaOf(value: unknown): string {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const nested = (record.entry && typeof record.entry === "object" ? record.entry : {}) as Record<string, unknown>;
  const fn = (record.fn && typeof record.fn === "object" ? record.fn : {}) as Record<string, unknown>;
  const candidates = [record.parentModule, nested.parentModule, record.sourceName, fn.id, record.id, record.targetId];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const parts = candidate.split(/[.:/]/).filter(Boolean);
    const head = parts[0] === "@ctor" || parts[0] === "op" ? parts[1] : parts[0];
    if (head && /^[a-z][a-z0-9-]*$/.test(head) && parts.length > 1 && !["entity", "tc", "ctor", "format", "unit"].includes(head)) return head;
  }
  return "core";
}

export function encodeAuthoringCatalogue(result: LocalCatalogueResult, smallArea = 64 * 1024):
  { collections: AuthoringCatalogueIndex["collections"]; chunks: { area: string; text: string }[] } {
  if (!catalogueAnchorIsCurrent()) throw new Error("The runtime catalogue anchor is unavailable.");
  const counts = new Map<object, number>();
  const count = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    const prior = counts.get(value);
    counts.set(value, (prior ?? 0) + 1);
    if (prior !== undefined) return;
    if (value instanceof Map) { for (const entry of value) count(entry); return; }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Catalogue transport refuses symbol keys.");
      if (key === MARK) throw new TypeError("Catalogue transport reserves its marker key.");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Catalogue transport refuses accessors.");
      if (Array.isArray(value) && key === "length") continue;
      count(descriptor.value);
    }
  };
  count(result);
  // Record this exact producer object, even when it occurs only once. Equal
  // authored records are ordinary data and never acquire an anchor.
  if (counts.has(Nothing)) counts.set(Nothing, Math.max(2, counts.get(Nothing)!));
  const ids = new Map<object, number>();
  const chunks = new Map<string, Chunk>();
  const chunk = (area: string) => {
    let found = chunks.get(area);
    if (!found) chunks.set(area, found = { area, nodes: [], items: [] });
    return found;
  };
  const collections = collectionsOf(result);
  if (collections.some(collection => counts.get(collection.values) !== 1)) throw new TypeError("Catalogue transport needs unshared collections.");
  const holes = new Set<unknown>(collections.map(collection => collection.values));
  const encode = (value: unknown, area: string, root = false): Encoded => {
    if (value === undefined) return { [MARK]: ["u"] };
    if (typeof value === "number") {
      if (Number.isNaN(value)) return { [MARK]: ["n", "NaN"] };
      if (!Number.isFinite(value)) return { [MARK]: ["n", value > 0 ? "Infinity" : "-Infinity"] };
      if (Object.is(value, -0)) return { [MARK]: ["n", "-0"] };
      return value;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value !== "object") throw new TypeError(`Catalogue transport refuses ${typeof value}.`);
    if (!root && holes.has(value)) return { [MARK]: ["c"] };
    if (!root && (counts.get(value) ?? 0) > 1) {
      let id = ids.get(value);
      if (id === undefined) {
        ids.set(value, id = ids.size);
        chunk(area).nodes.push([id, encode(value, area, true)]);
      }
      return { [MARK]: id };
    }
    if (value instanceof Map) {
      if (Object.getPrototypeOf(value) !== Map.prototype) throw new TypeError("Catalogue transport refuses Map subclasses.");
      return { [MARK]: ["m", [...value].map(([key, item]) => [encode(key, area), encode(item, area)])] };
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("Catalogue transport refuses array subclasses.");
      const out: Encoded[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError("Catalogue transport refuses sparse arrays.");
        out.push(encode(value[index], area));
      }
      return out;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Catalogue transport refuses class instances.");
    const out: Record<string, Encoded> = {};
    for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: encode((value as Record<string, unknown>)[key], area), enumerable: true, writable: true, configurable: true });
    return out;
  };
  chunk("core").skeleton = encode(result, "core", true);
  collections.forEach((collection, collectionIndex) => collection.values.forEach((item, itemIndex) => {
    const area = areaOf(item);
    chunk(area).items.push([collectionIndex, itemIndex, encode(item, area)]);
  }));
  const nothingNode = ids.get(Nothing);
  // The envelope lives inside the integrity-checked core chunk, alongside the
  // existing shared node table. It is not unverified index-side metadata.
  chunk("core").anchors = { schema: CATALOGUE_ANCHOR_SCHEMA,
    nodes: nothingNode === undefined ? [] : [{ name: NOTHING_ANCHOR, node: nothingNode }] };
  // Fold tiny areas into "misc" (fewer requests); values are unaffected.
  const texts: { area: string; text: string }[] = [];
  const misc: Chunk = { area: "misc", nodes: [], items: [] };
  for (const value of chunks.values()) {
    const text = JSON.stringify(value);
    if (value.area !== "core" && text.length < smallArea) { misc.nodes.push(...value.nodes); misc.items.push(...value.items); }
    else texts.push({ area: value.area, text });
  }
  if (misc.nodes.length || misc.items.length) texts.push({ area: "misc", text: JSON.stringify(misc) });
  return { collections: collections.map(collection => ({ path: collection.path, length: collection.values.length })), chunks: texts };
}

export function decodeAuthoringCatalogue(index: Pick<AuthoringCatalogueIndex, "collections">, chunkTexts: readonly string[]): LocalCatalogueResult {
  return decodeCatalogueTransport(index, chunkTexts, catalogueAnchorBindings()) as LocalCatalogueResult;
}

/** Read and verify every chunk the index names; undefined on any mismatch. */
export async function loadAuthoringCatalogue(index: AuthoringCatalogueIndex,
  readChunk: (file: string, sha256: string) => Promise<string>, options: { readerVerifies?: boolean } = {}): Promise<LocalCatalogueResult | undefined> {
  try {
    // A reader that verifies natively (fetch integrity, a synchronous hash)
    // saves the asynchronous digest hop after the registry is ready.
    const texts = options.readerVerifies
      ? await Promise.all(index.chunks.map(({ file, sha256 }) => readChunk(file, sha256)))
      : await readAuthoringCatalogueChunks(index, readChunk);
    return texts ? decodeAuthoringCatalogue(index, texts) : undefined;
  } catch { return undefined; }
}

/** Every chunk the index names, each matching its recorded digest, or
 * undefined (missing, unreadable or changed). Also the generator's check. */
export async function readAuthoringCatalogueChunks(index: Pick<AuthoringCatalogueIndex, "chunks">,
  readChunk: (file: string, sha256: string) => Promise<string>): Promise<string[] | undefined> {
  try {
    return await Promise.all(index.chunks.map(async ({ file, sha256 }) => {
      const text = await readChunk(file, sha256);
      if (await sha256Hex(text) !== sha256) throw new Error("stale chunk");
      return text;
    }));
  } catch { return undefined; }
}

/** The optional read gets `ms` once the registry is ready; a stalled read is
 * aborted and the worker takes its live build well inside its deadline. */
export function settleWithin<T>(promise: Promise<T> | undefined, ms: number, onTimeout?: () => void): Promise<T | undefined> {
  if (!promise) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const timer = setTimeout(() => { onTimeout?.(); resolve(undefined); }, ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}

const collate = (left: string, right: string) => left.localeCompare(right);

/** Sort with the live comparator; undefined if it ties two distinct entries,
 * because the live build's order then depends on its insertion order. */
function strictSort<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] | undefined {
  const sorted = [...values].sort(compare);
  for (let index = 1; index < sorted.length; index++) if (compare(sorted[index - 1]!, sorted[index]!) === 0) return undefined;
  return sorted;
}

/** The build machine's collation is not the reader's. Reapply the live
 * builder's own comparators (buildAuthoringCatalogSnapshot: default
 * localeCompare) and the orders derived from them; undefined when a derived
 * order cannot be rebuilt exactly (then the live build runs). */
export function collateRepositoryCatalogue(base: LocalCatalogueResult,
  referenceRouteSplit: number | null | undefined): LocalCatalogueResult | undefined {
  const catalog = base.catalog;
  const types = strictSort(catalog.types, (a, b) => collate(a.name, b.name));
  const capabilities = strictSort(catalog.capabilities, (a, b) => collate(a.name, b.name));
  const functions = strictSort(catalog.functions, (a, b) => collate(a.label, b.label) || collate(a.id, b.id));
  if (!types || !capabilities || !functions) return undefined;
  // exactFunctionRoutes = sorted module routes (qualified, dotted names), then
  // identity routes appended in function order (projectCatalogFunctionIdentities).
  const routes = catalog.exactFunctionRoutes ?? [];
  const split = routes.findIndex(route => !route.sourceName.includes("."));
  const moduleRoutes = split < 0 ? routes : routes.slice(0, split);
  const identityRoutes = split < 0 ? [] : routes.slice(split);
  if (identityRoutes.some(route => route.sourceName.includes(".") || route.entry === undefined)) return undefined;
  const sortedModuleRoutes = strictSort(moduleRoutes, (a, b) => collate(a.sourceName, b.sourceName) || collate(a.targetId, b.targetId));
  if (!sortedModuleRoutes) return undefined;
  const functionPosition = new Map(functions.map((entry, index) => [entry.id, index]));
  if (identityRoutes.some(route => !functionPosition.has(route.entry!.id))) return undefined;
  const sortedIdentityRoutes = [...identityRoutes].sort((a, b) => functionPosition.get(a.entry!.id)! - functionPosition.get(b.entry!.id)!);
  const routePosition = new Map(sortedModuleRoutes.map((route, index) => [route.sourceName, index]));
  if (routePosition.size !== sortedModuleRoutes.length) return undefined;
  const changed = sortedModuleRoutes.some((route, index) => route !== moduleRoutes[index]);
  let exactConstructorRoutes = catalog.exactConstructorRoutes;
  let referenceRoutes = catalog.referenceRoutes;
  if (changed) {
    const constructors = catalog.exactConstructorRoutes ?? [];
    if (constructors.some(route => !routePosition.has(route.sourceName))) return undefined;
    exactConstructorRoutes = [...constructors].sort((a, b) => routePosition.get(a.sourceName)! - routePosition.get(b.sourceName)!);
    const references = catalog.referenceRoutes ?? [];
    if (typeof referenceRouteSplit !== "number" || referenceRouteSplit > references.length) return undefined;
    const derived = references.slice(0, referenceRouteSplit);
    if (derived.some(route => !routePosition.has(route.sourceName))) return undefined;
    referenceRoutes = [...derived.sort((a, b) => routePosition.get(a.sourceName)! - routePosition.get(b.sourceName)!),
      ...references.slice(referenceRouteSplit)];
  }
  // Operator routes: notation, then fixity (spelled in the alias of a shared
  // notation), then target. The notation map keeps that order.
  const operatorRoutes = catalog.operatorRoutes ?? [];
  const notationCounts = new Map<string, number>();
  for (const route of operatorRoutes) notationCounts.set(route.notation, (notationCounts.get(route.notation) ?? 0) + 1);
  const fixity = (route: (typeof operatorRoutes)[number]) => /^op:@:([a-z]+):/.exec(route.aliasId)?.[1];
  if (operatorRoutes.some(route => notationCounts.get(route.notation)! > 1 && fixity(route) === undefined)) return undefined;
  // Live: notation, then fixity, then target, always. Fixity is only spelled
  // for a shared notation; two distinct notations that collate equal are a
  // tie whose live order is the build's insertion order (strictSort refuses).
  const sortedOperators = strictSort(operatorRoutes, (a, b) => collate(a.notation, b.notation)
    || (a.notation !== b.notation ? 0 : collate(fixity(a)!, fixity(b)!) || collate(a.targetId, b.targetId)));
  if (!sortedOperators) return undefined;
  const notationMap = catalog.operatorCodeNameByNotation;
  let operatorCodeNameByNotation = notationMap;
  if (notationMap instanceof Map) {
    const rebuilt = new Map(sortedOperators.filter(route => notationCounts.get(route.notation) === 1)
      .map(route => [route.notation, route.codeName] as [string, string]));
    if (rebuilt.size !== notationMap.size || [...rebuilt].some(([key, value]) => notationMap.get(key) !== value)) return undefined;
    operatorCodeNameByNotation = rebuilt;
  }
  return { displayCatalog: base.displayCatalog, catalog: { ...catalog, types, capabilities, functions,
    exactFunctionRoutes: [...sortedModuleRoutes, ...sortedIdentityRoutes], exactConstructorRoutes, referenceRoutes,
    operatorRoutes: sortedOperators, operatorCodeNameByNotation } };
}

export const authoringCatalogueChunkDigest = sha256Hex;

// ---------------------------------------------------------------------------
// Realm cache (W1). A realm reused for its holder's next snapshot keeps the
// verified repository catalogue it already read: the same index, repository
// identity manifest, Local source and page session epoch name the same bytes.
// Only a read that delivered a verified catalogue is kept; a failed, aborted
// or refused read is forgotten so the next initialization reads again.

export type RepositoryCatalogue = { index: AuthoringCatalogueIndex; result: LocalCatalogueResult };

/** The realm key: every input the delivered bytes depend on. */
export function repositoryCatalogueRealmKey(index: AuthoringCatalogueIndex,
  localSourceId: string, sessionEpoch: number | undefined): string {
  // Collection paths and the reference-route split also interpret the bytes;
  // equal chunk hashes alone do not identify the decoded projection.
  return JSON.stringify([index, localSourceId, sessionEpoch ?? null]);
}

let realmCatalogue: { key: string; read: Promise<RepositoryCatalogue | undefined>; settled?: RepositoryCatalogue } | undefined;

/** The realm's repository catalogue for `key`: the retained one, the read in
 * flight, or a new read. A different key (another epoch or index) replaces the
 * retained catalogue before reading. */
export function realmRepositoryCatalogue(key: string, read: () => Promise<RepositoryCatalogue | undefined>): Promise<RepositoryCatalogue | undefined> {
  if (!catalogueAnchorIsCurrent()) { realmCatalogue = undefined; return Promise.resolve(undefined); }
  if (realmCatalogue?.key === key) return realmCatalogue.settled ? Promise.resolve(realmCatalogue.settled) : realmCatalogue.read;
  const entry: NonNullable<typeof realmCatalogue> = { key, read: Promise.resolve(undefined) };
  realmCatalogue = entry;
  entry.read = read().then(value => {
    if (!catalogueAnchorIsCurrent()) {
      if (realmCatalogue === entry) realmCatalogue = undefined;
      return undefined;
    }
    if (realmCatalogue !== entry) return value;
    if (value) entry.settled = deepFreeze(value);
    else realmCatalogue = undefined;
    return value;
  }, error => {
    if (realmCatalogue === entry) realmCatalogue = undefined;
    throw error;
  });
  return entry.read;
}

/** Freeze owned graph nodes once. The explicitly bound external singleton
 * stays runtime-owned and is validated again on every reuse/adoption. */
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === Nothing) return value;
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) { for (const [key, item] of value) { deepFreeze(key, seen); deepFreeze(item, seen); } }
  else for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  return Object.freeze(value);
}

/** Test seam: forget the realm's repository catalogue. */
export function forgetRealmRepositoryCatalogue(): void { realmCatalogue = undefined; }

const collatedBases = new WeakMap<LocalCatalogueResult, { split: number | null | undefined; base: LocalCatalogueResult | undefined }>();

/** The reader-collated base for one retained repository catalogue, once per realm. */
function collatedRepositoryCatalogue(loaded: RepositoryCatalogue): LocalCatalogueResult | undefined {
  const prior = collatedBases.get(loaded.result);
  if (prior && prior.split === loaded.index.referenceRouteSplit) return prior.base;
  const base = collateRepositoryCatalogue(loaded.result, loaded.index.referenceRouteSplit);
  collatedBases.set(loaded.result, { split: loaded.index.referenceRouteSplit, base });
  return base;
}

// ---------------------------------------------------------------------------
// Public (repository-only) catalogue. The public worker's own projection is
// not the Local one: no Local presentation, no `_activeTags`, and its display
// catalogue is the raw section list the page scopes itself. The same build
// tool records THIS projection over the same fresh repository registry, and
// the public worker adopts it under the same identity checks as Local
// (schema, source, repository identity digest, chunk integrity, anchor,
// reader collation, repository fingerprint). No Local fact exists here, so
// the Local admission has nothing to judge; any doubt runs the live build.

/** The repository catalogue's source coordinate (no browser source). */
export const REPOSITORY_CATALOGUE_SOURCE_ID = "fenel-repository";

/** The public worker's live projection, unchanged (moved here so the build
 * tool, the worker and the equality test run one implementation). */
export function projectRepositoryAuthoringCatalogue(registry: ModuleRegistry): LocalCatalogueResult {
  return { catalog: buildSessionCatalog(registry), displayCatalog: getCatalog(registry) };
}

/** Leading referenceRoutes derived from module routes, for reader-locale
 * re-collation (collateRepositoryCatalogue); null when it cannot be confirmed. */
export function referenceRouteSplitFor(registry: ModuleRegistry, catalog: AuthoringCatalogSnapshot): number | null {
  const derived = (catalog.exactFunctionRoutes ?? []).filter(route => route.sourceName.includes(".")).filter(route => {
    const target = registry.getUuid(route.targetId);
    return target !== undefined && registry.getIdentifiedFunction(target) !== undefined;
  }).map(route => route.sourceName);
  return JSON.stringify((catalog.referenceRoutes ?? []).slice(0, derived.length).map(route => route.sourceName))
    === JSON.stringify(derived) ? derived.length : null;
}

/** Public catalogue for the worker: the build-owned repository projection when
 * its fingerprint matches this checked registry, else the live projection. */
export async function repositoryOnlyCatalogue(registry: ModuleRegistry, frame: EvaluateContext,
  repository?: Promise<RepositoryCatalogue | undefined>, options: { graceMs?: number; abort?: () => void } = {},
): Promise<LocalCatalogueResult & { source: "repository" | "live"; reason?: string }> {
  const live = (reason: string) => ({ ...projectRepositoryAuthoringCatalogue(registry), source: "live" as const, reason });
  let timedOut = false;
  const loaded = await settleWithin(repository, options.graceMs ?? REPOSITORY_READ_GRACE_MS, () => { timedOut = true; options.abort?.(); });
  if (!loaded) return live(timedOut ? "deadline" : "unavailable");
  if (!catalogueAnchorIsCurrent()) return live("anchor-unavailable");
  let base: LocalCatalogueResult | undefined;
  try {
    if (loaded.index.sourceId !== REPOSITORY_CATALOGUE_SOURCE_ID) return live("source");
    if (await repositoryCatalogueFingerprint(registry, frame) !== loaded.index.fingerprint) return live("fingerprint");
    base = collatedRepositoryCatalogue(loaded);
  } catch { return live("observation-unavailable"); }
  if (!base) return live("collation");
  if (!catalogueAnchorIsCurrent()) return live("anchor-unavailable");
  // Like the Local merge: the realm keeps the frozen rows; this snapshot owns
  // its own top-level section list.
  return { catalog: base.catalog, displayCatalog: [...base.displayCatalog], source: "repository" };
}

/** Local catalogue for the worker: the build-owned repository projection plus
 * Local's own rows when admitted, else the unchanged live projection. */
export async function localCatalogue(registry: ModuleRegistry, frame: EvaluateContext, data: LocalCatalogueInput,
  repository?: Promise<RepositoryCatalogue | undefined>,
  options: { graceMs?: number; abort?: () => void; catalogueSourceId?: string } = {},
): Promise<LocalCatalogueResult & { source: "repository" | "live"; reason?: string }> {
  const live = (reason: string) => {
    const { catalog, displayCatalog } = projectLocalAuthoringCatalogue(registry, frame, data);
    return { catalog, displayCatalog, source: "live" as const, reason };
  };
  let timedOut = false;
  const loaded = await settleWithin(repository, options.graceMs ?? REPOSITORY_READ_GRACE_MS, () => { timedOut = true; options.abort?.(); });
  if (!loaded) return live(timedOut ? "deadline" : "unavailable");
  if (!catalogueAnchorIsCurrent()) return live("anchor-unavailable");
  let merged: LocalCatalogueResult | undefined;
  let reason = "collation";
  try {
    const base = collatedRepositoryCatalogue(loaded);
    if (base) {
      // Local's own rows, from the live builders over a Local-only view, under
      // the same reader frame. Admission below checks repository independence.
      const presentation = createReaderPresentation(() => ({ registry, session: { evaluateContext: frame }, catalog: base.displayCatalog,
        types: data.entities.map(entity => ({ id: entity.id, name: entity.id })),
        functionRows: (data.functions ?? []).map(fn => ({ id: fn.id, name: fn.id, function: fn })) }));
      const delta = localCatalogueDelta(registry, data, retainedPresentation(frame, presentation));
      const observation = observeLocalCatalogue(registry, frame, data, base, delta,
        { repository: await repositoryCatalogueFingerprint(registry, frame), catalogue: loaded.index.fingerprint });
      const admission = admitLocalCatalogue(registry, frame, data, options.catalogueSourceId ?? data.localSourceId, observation);
      reason = admission.admitted ? "merge" : admission.reason;
      if (admission.admitted && delta) merged = mergeLocalCatalogueDelta(base, delta, loaded.index.referenceRouteSplit, registry);
    }
  } catch {
    // Optional observations/transport are not a second initialization gate.
    // Keep this catch outside the live build: a live failure must stay visible.
    reason = "observation-unavailable";
  }
  if (!catalogueAnchorIsCurrent()) return live("anchor-unavailable");
  return merged ? { ...merged, source: "repository" } : live(reason);
}
