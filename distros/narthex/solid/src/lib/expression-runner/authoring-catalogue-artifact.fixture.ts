// Test fixture: one fresh process = one fresh catalogue worker. Builds the
// Local registry exactly like authoring-catalog-worker-main.ts, then writes the
// structured-clone bytes of the worker reply for the requested path.
//   bun authoring-catalogue-artifact.fixture.ts <case> <live|worker|both|refusal> <out>
// "both" runs the worker path first, then the live projection, in this one
// process over the same registry, and writes <out>-worker / <out>-live.
// Match official Bun startup before engine dependencies seal the host. The
// existing host owns Proxy detection and optional replay/env admission.
import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { readFile, writeFile } from "node:fs/promises";
import { evaluateContextForCatalog } from "./authoring-catalog";
import { buildLocalReaderFieldRegistry } from "../reader-registry";
import { mintAnonymousAuthority } from "../../../../../../implementations/typescript/runtime/src/authority-mint";
import { LOCAL_BROWSER_SOURCE_ID } from "../browser-data-storage";
import { REPOSITORY_IDENTITY_MANIFEST } from "@fenel/engine/repository-identity-manifest";
import { encodeAuthoringCatalogue, decodeAuthoringCatalogue, authoringCatalogueChunkDigest, AUTHORING_CATALOGUE_SCHEMA, loadAuthoringCatalogue, localCatalogue,
  projectLocalAuthoringCatalogue, repositoryCatalogueFingerprint, repositoryCatalogueFingerprintShape, type AuthoringCatalogueIndex, type LocalCatalogueInput } from "./authoring-catalogue-artifact";
import type { InstanceDraft } from "../instances/instance-draft";
import { localCatalogueDelta, localCatalogueScope } from "./authoring-catalogue-delta";
import { engineBodyMemoStats, exportEngineBodyMemoEntries } from "../../../../../../implementations/typescript/engine/src/engine-body-memo";

const [caseName, mode, out] = process.argv.slice(2) as [string, "live" | "worker" | "both" | "diagnostic" | "base" | "refusal", string];
const startedAt = performance.now();
let baseHostChecks: Array<Array<{ leaf: string; kind: string }>> | undefined;
const memoSummary = () => {
  const stats = engineBodyMemoStats();
  const rows = Object.values(stats.byFn);
  const base = stats.byFn["engine:collectFieldIdentitiesBase"];
  if (base && baseHostChecks === undefined) baseHostChecks = exportEngineBodyMemoEntries(`local:${LOCAL_BROWSER_SOURCE_ID}`)
    .filter(entry => entry.fnId === "engine:collectFieldIdentitiesBase")
    .map(entry => (entry.hostChecks ?? []).map(([leaf, fingerprint]) => ({ leaf,
      kind: fingerprint.startsWith("case:") ? "case" : fingerprint === "engine:unknown" ? "unknown" : "engine" })));
  return { entries: stats.entries, bytes: stats.bytes, evictions: stats.evictions,
    totals: Object.fromEntries((["calls", "hits", "computed", "hostBound", "artifactHits", "repositoryHits"] as const)
      .map(key => [key, rows.reduce((total, row) => total + row[key], 0)])),
    base: base && { calls: base.calls, hits: base.hits, computed: base.computed, hostBound: base.hostBound,
      artifactHits: base.artifactHits, repositoryHits: base.repositoryHits, refused: base.refused, notStored: base.notStored,
      hostChecks: baseHostChecks },
  };
};
const progress = (phase: string, includeMemo = false) => {
  if (process.env.FENEL_CATALOGUE_PROGRESS === "1") console.error(JSON.stringify({ fixture: "catalogue", case: caseName,
    phase, elapsedMs: Math.round(performance.now() - startedAt), ...(includeMemo ? { memo: memoSummary() } : {}) }));
};
progress("start");
// A reader locale other than the build machine's: every default
// localeCompare (the live builder's comparators) collates in this locale.
if (process.env.FENEL_TEST_COLLATION) {
  const collator = new Intl.Collator(process.env.FENEL_TEST_COLLATION);
  Object.defineProperty(String.prototype, "localeCompare", { configurable: true, writable: true,
    value(this: string, that: string) { return collator.compare(String(this), String(that)); } });
}
const empty = { owners: [], fields: [], facets: [] };
// The captured 4964-byte Local initialize graph used by the A/B runner: one
// Local function owner (the graph's decoded `initialize` payload, verbatim).
const smoke = {
  id: "425cd119-f879-4af6-9dd6-ff25d0223385", params: [], returns: { $ref: "String" },
  signatureDeclaration: { functionId: "425cd119-f879-4af6-9dd6-ff25d0223385", declarationName: "nativeSmoke1792096073248",
    codeName: "nativeSmoke1792096073248", params: [], returns: { $tag: "Absent" },
    scheme: { quantified: [], body: { $arrow: { params: [], returns: { $ref: "Number" } } } } },
  body: "fenel local smoke 2026-10-15T20:25:18.708Z",
};
// A nullary Local function that takes over std:negate's repository UUID.
const takeover = { id: "cc2ba039-a660-42fc-aa32-46f1b71d8d29", params: [], returns: { $ref: "Number" }, body: 123 };
const relabel: InstanceDraft = { typeName: "Labelable", args: ["std:negate"], methods: { label: "Local negate" }, priority: 1000,
  scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } };
// Two Local record types with account fields, as the Local planner commits
// them (planLocalDefinitionBundle): each type, its constructor function, its
// field and the field's Codeable facet.
const typed = {"owners":[{"ownerKey":"type:6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001","storageName":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001","kind":"type","definition":{"id":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001","type":{"$record":{"fields":[{"name":"count","key":{"$tag":"NamedField","ref":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000a"}},"type":{"$ref":"Number"},"label":{"$tag":"Nothing"},"ui":{"$tag":"Nothing"},"meta":{}}]}},"constructorFunction":{"$ref":"87e6fdc0-dd61-461f-ab95-c88744336639"}}},{"ownerKey":"function:87e6fdc0-dd61-461f-ab95-c88744336639","storageName":"87e6fdc0-dd61-461f-ab95-c88744336639","kind":"function","definition":{"id":"87e6fdc0-dd61-461f-ab95-c88744336639","params":[{"name":"count","key":{"$tag":"NamedField","ref":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000a"}},"type":{"$ref":"Number"},"label":{"$tag":"Nothing"},"ui":{"$tag":"Nothing"},"meta":{}}],"returns":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001"},"body":{"construct":["@ctor/local-owner-%255B%2522fenel-browser-local%2522%252C%2522type%253A6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001%2522%255D/6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001/6a0d3a52-91c1-4f7e-8f5b-0d4c1a000001",{"count":{"var":"count"}}]}}},{"ownerKey":"type:6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002","storageName":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002","kind":"type","definition":{"id":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002","type":{"$record":{"fields":[{"name":"title","key":{"$tag":"NamedField","ref":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000b"}},"type":{"$ref":"String"},"label":{"$tag":"Nothing"},"ui":{"$tag":"Nothing"},"meta":{}}]}},"constructorFunction":{"$ref":"6d588bd7-e94c-4ea7-b626-b75a926cf92d"}}},{"ownerKey":"function:6d588bd7-e94c-4ea7-b626-b75a926cf92d","storageName":"6d588bd7-e94c-4ea7-b626-b75a926cf92d","kind":"function","definition":{"id":"6d588bd7-e94c-4ea7-b626-b75a926cf92d","params":[{"name":"title","key":{"$tag":"NamedField","ref":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000b"}},"type":{"$ref":"String"},"label":{"$tag":"Nothing"},"ui":{"$tag":"Nothing"},"meta":{}}],"returns":{"$ref":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002"},"body":{"construct":["@ctor/local-owner-%255B%2522fenel-browser-local%2522%252C%2522type%253A6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002%2522%255D/6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002/6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002",{"title":{"var":"title"}}]}}}],"fields":[{"id":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000a","currentCodeName":"count","status":"live","realm":"account","reuseVisibility":"account"},{"id":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000b","currentCodeName":"title","status":"live","realm":"account","reuseVisibility":"account"}],"facets":[{"fieldId":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000a","typeName":"Codeable","methods":{"codeName":"count"},"scope":"account","priority":100},{"fieldId":"6a0d3a52-91c1-4f7e-8f5b-0d4c1a00000b","typeName":"Codeable","methods":{"codeName":"title"},"scope":"account","priority":100}]} as unknown as LocalCatalogueInput["snapshot"];
const ownersOf = (snapshot: LocalCatalogueInput["snapshot"]): Pick<LocalCatalogueInput, "entities" | "functions"> => ({
  entities: snapshot.owners.flatMap(owner => owner.kind === "type" ? [{ id: owner.definition.id, type: owner.definition.type }] : []),
  functions: snapshot.owners.flatMap(owner => owner.kind === "function" ? [owner.definition] : []) });
const withSmoke = { ...typed, owners: [...typed.owners, { ownerKey: `function:${smoke.id}`, storageName: smoke.id, kind: "function", definition: smoke }] } as never as LocalCatalogueInput["snapshot"];
// Synthetic rejected input: a facet targets std:negate's immutable repository
// parameter without a live Local field row. Hydration drops it; catalogue
// admission still refuses the raw roster as LocalFacetTargetsRepository.
const repositoryFacet = { ...typed, facets: [...typed.facets, { fieldId: "4df208e5-c5c1-44d2-a94a-d91ea17b9b00", typeName: "Labelable",
  methods: { label: "Local x label" }, scope: "account", priority: 1000 }] } as never as LocalCatalogueInput["snapshot"];
// Normal named Local authoring keeps type/function presentation in this pool,
// separately from the declaration and field facets.
const localNames: InstanceDraft[] = [
  { typeName: "Codeable", args: [typed.owners[0]!.definition.id], methods: { codeName: "CatalogueItem" } },
  { typeName: "Labelable", args: [typed.owners[0]!.definition.id], methods: { label: "Catalogue item" } },
  { typeName: "Codeable", args: [smoke.id], methods: { codeName: "catalogueSmoke" } },
  { typeName: "Labelable", args: [smoke.id], methods: { label: "Catalogue smoke" } },
].map(row => ({ ...row, priority: 1000, scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } })) as InstanceDraft[];
const typeOnly = { owners: [{ ownerKey: "type:df633d74-aa37-407e-9927-ff75d5ed4996", storageName: "df633d74-aa37-407e-9927-ff75d5ed4996",
  kind: "type", definition: { id: "df633d74-aa37-407e-9927-ff75d5ed4996", type: { $ref: "Number" } } }], fields: [], facets: [] } as LocalCatalogueInput["snapshot"];
// The admitted saved Number remains ordinary data. Only its ID and installed
// Labelable row cross this catalogue boundary; no body enters a declaration.
const savedNumber = { id: "8ccac484-7f28-477d-8d9d-0c0ca1100001", query: {
  kind: "expression", expr: { kind: "literal", value: 42 }, valueType: { $ref: "Number" },
} };
const savedNumberLabel: InstanceDraft = { typeName: "Labelable", args: [savedNumber.id],
  methods: { label: "Saved Number catalogue control" }, priority: 1000, scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } };
const cases: Record<string, LocalCatalogueInput> = {
  empty: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: empty, entities: [], functions: [], localRepresentations: [] },
  captured: { localSourceId: LOCAL_BROWSER_SOURCE_ID,
    snapshot: { owners: [{ ownerKey: `function:${smoke.id}`, storageName: smoke.id, kind: "function", definition: smoke }], fields: [], facets: [] } as never,
    entities: [], functions: [smoke as never], localRepresentations: [] },
  uuid: { localSourceId: LOCAL_BROWSER_SOURCE_ID,
    snapshot: { owners: [{ ownerKey: `function:${takeover.id}`, storageName: takeover.id, kind: "function", definition: takeover }], fields: [], facets: [] } as never,
    entities: [], functions: [takeover as never], localRepresentations: [] },
  presentation: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: empty, entities: [], functions: [], localRepresentations: [relabel] },
  types: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: typed, ...ownersOf(typed), localRepresentations: [] },
  mixed: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: withSmoke, ...ownersOf(withSmoke), localRepresentations: [] },
  named: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: withSmoke, ...ownersOf(withSmoke), localRepresentations: localNames },
  "type-only": { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: typeOnly, ...ownersOf(typeOnly), localRepresentations: [] },
  "saved-number": { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: empty, entities: [], functions: [],
    // A saved-only name matching a repository callable cannot create or
    // replace a callable/reference route; complete encoded parity checks it.
    localValueIds: [savedNumber.id], localRepresentations: [savedNumberLabel,
      { ...savedNumberLabel, typeName: "Codeable", methods: { codeName: "negate" } }] },
  "saved-mixed": { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: withSmoke, ...ownersOf(withSmoke),
    localValueIds: [savedNumber.id], localRepresentations: [...localNames, savedNumberLabel] },
  // New type's Name row names Local types like repository type rows: Person
  // (listed after Local's rows) and Number (shaped before them).
  person: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: typed, ...ownersOf(typed), localRepresentations: [
    { typeName: "Codeable", args: [typed.owners[0]!.definition.id], methods: { codeName: "Person" }, priority: 1000,
      scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } },
    { typeName: "Codeable", args: [typed.owners[2]!.definition.id], methods: { codeName: "Number" }, priority: 1000,
      scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } },
  ] as InstanceDraft[] },
  // A Local type named like the shapeless Date atom row supplies its shape.
  "date-name": { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: typed, ...ownersOf(typed), localRepresentations: [
    { typeName: "Codeable", args: [typed.owners[0]!.definition.id], methods: { codeName: "Date" }, priority: 1000,
      scope: { kind: "tag", tag: LOCAL_BROWSER_SOURCE_ID } },
  ] as InstanceDraft[] },
  facet: { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: repositoryFacet, ...ownersOf(repositoryFacet), localRepresentations: [] },
};
const data = cases[caseName];
if (!data) throw new Error(`unknown case ${caseName}`);
if (mode === "refusal") {
  if (caseName !== "uuid") throw new Error("The refusal fixture requires the repository UUID collision case.");
  let rejection: unknown;
  try {
    await buildLocalReaderFieldRegistry(data.localSourceId, data.snapshot, { preparation: "inline" });
  } catch (error) { rejection = error; }
  const diagnostic = (rejection as { diagnostic?: { $tag?: string; handle?: string; repositoryKind?: string; message?: string } } | undefined)?.diagnostic;
  if (diagnostic?.$tag !== "ReservedDefinitionIdentity" || diagnostic.handle !== takeover.id
    || diagnostic.repositoryKind !== "function") {
    throw new Error(`Expected the structured repository UUID refusal; received ${JSON.stringify(diagnostic)}`);
  }
  // The failed admission must not publish or poison this process's repository
  // aliases. Recover through the actual Local registry owner, before projecting
  // any catalogue; no fixture-only registry or reset can establish this proof.
  const valid = cases.captured!;
  const recovered = await buildLocalReaderFieldRegistry(valid.localSourceId, valid.snapshot, { preparation: "inline" });
  const canonical = recovered.getFunction("std:negate");
  const identified = recovered.getIdentifiedFunction(takeover.id);
  if (!canonical || canonical.id !== "std:negate" || !identified || identified.id !== canonical.id
    || identified.params.length !== 1 || JSON.stringify(identified.body) !== JSON.stringify(canonical.body)
    || identified.body === takeover.body) throw new Error("The recovered registry lost std:negate's canonical identity/body.");
  if (recovered.getFunction(smoke.id)?.id !== smoke.id) throw new Error("The valid Local recovery owner was not installed.");
  await writeFile(out, JSON.stringify({ refusal: diagnostic, recovery: {
    kind: "same-process", functionId: smoke.id, repositoryId: takeover.id, canonicalId: identified.id,
    canonicalParameterCount: identified.params.length, canonicalBodyMatches: true,
  } }));
  progress("refusal-and-recovery-complete", true);
  process.exit(0);
}

const generated = new URL("../generated/", import.meta.url);
const chunks = new URL("../../../public/generated/authoring-catalogue/", import.meta.url);
// Same order as the worker: start the read, then build the checked registry.
const repository = mode === "worker" || mode === "both" || mode === "base" ? (async () => {
  // Fixture-only persisted base: the producer exits before the reader builds
  // its registry, avoiding two full registry heaps in one correctness run.
  // The existing chunk reader still verifies every stored byte and decodes
  // the same transport. This never changes production snapshots or pins.
  if (mode !== "base" && process.env.FENEL_CATALOGUE_BASE_FILE) {
    progress("base-file-read");
    const saved = JSON.parse(await readFile(process.env.FENEL_CATALOGUE_BASE_FILE, "utf8")) as {
      schema: string; index: AuthoringCatalogueIndex; chunks: Record<string, string>;
    };
    const { index } = saved;
    if (saved.schema !== "fenel.catalogue-oracle-base.v1" || index.schema !== AUTHORING_CATALOGUE_SCHEMA
      || index.sourceId !== data.localSourceId || index.identityDigest !== REPOSITORY_IDENTITY_MANIFEST.digest)
      throw new Error("The fixture base belongs to another identity/source generation.");
    const result = await loadAuthoringCatalogue(index, async file => {
      const text = saved.chunks[file];
      if (typeof text !== "string") throw new Error("The fixture base is missing a chunk.");
      return text;
    });
    if (!result) throw new Error("The fixture base failed chunk verification.");
    progress("base-file-verified");
    return { index, result };
  }
  // A focused correctness oracle needs no generated-artifact refresh. Build
  // the empty Local source with the same live owner, then cross the actual
  // codec before the worker consumes its base. Production still uses only the
  // independently generated artifact and its ordinary freshness checks.
  if (mode === "base" || process.env.FENEL_CATALOGUE_IN_MEMORY_BASE === "1") {
    const input = cases.empty!;
    progress("base-registry-start");
    const baseRegistry = await buildLocalReaderFieldRegistry(input.localSourceId, input.snapshot, { preparation: "inline" });
    progress("base-registry-complete", true);
    const baseFrame = Object.freeze({ ...evaluateContextForCatalog(baseRegistry), _authority: mintAnonymousAuthority(baseRegistry),
      _activeTags: Object.freeze([input.localSourceId]) as unknown as string[] });
    progress("base-catalogue-start");
    const { catalog, displayCatalog } = projectLocalAuthoringCatalogue(baseRegistry, baseFrame, input);
    progress("base-catalogue-complete", true);
    const encoded = encodeAuthoringCatalogue({ catalog, displayCatalog });
    const routes = (catalog.exactFunctionRoutes ?? []).filter(route => route.sourceName.includes("."));
    const derived = routes.filter(route => {
      const id = baseRegistry.getUuid(route.targetId);
      return id !== undefined && baseRegistry.getIdentifiedFunction(id) !== undefined;
    }).map(route => route.sourceName);
    const referenceRouteSplit = JSON.stringify((catalog.referenceRoutes ?? []).slice(0, derived.length).map(route => route.sourceName))
      === JSON.stringify(derived) ? derived.length : null;
    const index = { schema: AUTHORING_CATALOGUE_SCHEMA, sourceDigest: "fixture", identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
      sourceId: input.localSourceId, fingerprint: await repositoryCatalogueFingerprint(baseRegistry, baseFrame),
      referenceRouteSplit, collections: encoded.collections, chunks: await Promise.all(encoded.chunks.map(async (chunk, position) => ({
        area: chunk.area, file: `fixture-${position}.json`, bytes: new TextEncoder().encode(chunk.text).length,
        sha256: await authoringCatalogueChunkDigest(chunk.text),
      }))) } as AuthoringCatalogueIndex;
    if (process.env.FENEL_CATALOGUE_FINGERPRINT === "1") await writeFile(`${out}-base.json`, JSON.stringify({
      fingerprint: index.fingerprint, shape: repositoryCatalogueFingerprintShape(baseRegistry, baseFrame) }));
    if (mode === "base") {
      await writeFile(out, JSON.stringify({ schema: "fenel.catalogue-oracle-base.v1", index,
        chunks: Object.fromEntries(index.chunks.map((chunk, position) => [chunk.file, encoded.chunks[position]!.text])) }));
      progress("base-file-written");
      return undefined;
    }
    return { index, result: decodeAuthoringCatalogue(index, encoded.chunks.map(chunk => chunk.text)) };
  }
  const index = JSON.parse(await readFile(new URL("authoring-catalogue.json", generated), "utf8")) as AuthoringCatalogueIndex;
  if (index.schema !== AUTHORING_CATALOGUE_SCHEMA || index.sourceId !== data.localSourceId
    || index.identityDigest !== REPOSITORY_IDENTITY_MANIFEST.digest) return undefined;
  // Like the browser's fetch integrity: the reader verifies natively, so no
  // asynchronous digest hop remains once the registry is ready.
  const result = await loadAuthoringCatalogue(index, async (file, sha256) => {
    const text = await readFile(new URL(file, chunks), "utf8");
    if (new Bun.CryptoHasher("sha256").update(text).digest("hex") !== sha256) throw new Error("stale chunk");
    return text;
  }, { readerVerifies: true });
  return result && { index, result };
})() : undefined;
if (mode === "base") {
  await repository;
  process.exit(0);
}
// Serialize registry preparation in the in-memory oracle on the shared host.
if (process.env.FENEL_CATALOGUE_IN_MEMORY_BASE === "1" || process.env.FENEL_CATALOGUE_BASE_FILE) {
  await repository;
  // Release fixture decoding intermediates before allocating the one reader
  // registry. This offline harness does not benchmark browser GC behavior.
  Bun.gc(true);
}
progress("reader-registry-start");
const registry = await buildLocalReaderFieldRegistry(data.localSourceId, data.snapshot as never,
  { preparation: "inline", representations: data.localRepresentations as InstanceDraft[] });
progress("reader-registry-complete", true);
const frame = Object.freeze({ ...evaluateContextForCatalog(registry), _authority: mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([data.localSourceId]) as unknown as string[] });
// Canonical transport text: keys and order, undefined, Map, numbers and the
// sharing structure. (bun:jsc bytes also encode string representations.)
async function write(target: string, path: "live" | "worker") {
  progress(`${path}-catalogue-start`);
  const started = performance.now();
  const prepared = path === "live"
    ? { ...projectLocalAuthoringCatalogue(registry, frame, data), source: "live" as const }
    : await localCatalogue(registry, frame, data, repository, { catalogueSourceId: LOCAL_BROWSER_SOURCE_ID });
  const elapsed = Math.round(performance.now() - started);
  progress(`${path}-catalogue-complete`, true);
  const reply = structuredClone({ catalog: prepared.catalog, displayCatalog: prepared.displayCatalog });
  await writeFile(target, JSON.stringify(encodeAuthoringCatalogue(reply, Infinity)));
  await writeFile(`${target}.json`, JSON.stringify({ source: prepared.source, reason: (prepared as { reason?: string }).reason,
    fingerprint: process.env.FENEL_CATALOGUE_FINGERPRINT === "1" ? await repositoryCatalogueFingerprintShape(registry, frame) : undefined,
    elapsedMs: elapsed, memo: memoSummary() }));
  progress(`${path}-output-written`);
}
if (mode === "diagnostic") {
  // A bounded placement probe: one checked registry and Local-only rows,
  // without building the full repository catalogue or a reference projection.
  // Labels are irrelevant to these observed ownership/root-order facts.
  const scope = localCatalogueScope(registry);
  const delta = localCatalogueDelta(registry, data, () => undefined);
  await writeFile(out, JSON.stringify({
    scope: scope && { functions: [...scope.functionIds], entities: [...scope.entityKeys],
      modules: [...scope.modules], mixedModules: scope.mixedModules },
    roots: [...(registry.evaluateContext()._moduleNames ?? [])].map(name => ({ name, local: scope?.modules.has(name) ?? false })),
    deltaPresent: delta !== undefined,
    referenceRoutes: delta?.catalog.referenceRoutes,
    exactFunctionRoutes: delta?.catalog.exactFunctionRoutes?.map(route => ({ sourceName: route.sourceName, targetId: route.targetId })),
  }, null, 2));
} else if (mode === "both") {
  // The worker path first, as a fresh worker meets it; then the reference.
  await write(`${out}-worker`, "worker");
  await write(`${out}-live`, "live");
} else await write(out, mode);
