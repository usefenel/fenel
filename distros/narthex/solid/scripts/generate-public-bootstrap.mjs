// GP-19 / C2 build tooling: evaluate the existing pure Fenel preference plan
// and carry the existing repository projection to an inert browser snapshot.
// No account reader, definition body, or alternative default is introduced.
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { publicBootstrapExactInputs as exact, publicBootstrapInputRoots as roots, isPublicBootstrapInput } from "../public-bootstrap-inputs.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const output = fileURLToPath(new URL("../src/lib/generated/public-bootstrap.json", import.meta.url));
const corpusOutput = fileURLToPath(new URL("../src/lib/generated/seed-values.json", import.meta.url));

// C2 closed inference-result transport, not another type judgment. Only the
// canonical projection's Solved type may replace an earlier presentation hint.
function projectCheckedPublicSeedValue(example, inferred) {
  const { type: _priorType, ...source } = example;
  return inferred?.outcome?.$tag === "Solved" && inferred.type
    ? { ...source, type: inferred.type }
    : source;
}

// The API already offers the distro's recorded replay by default. Generation
// can use the same optional host path; the host adapter still owns every epoch,
// integrity, harness and native-fingerprint check. Explicit empty/custom values
// win, and current --check/--ensure exits never acquire the optional artifact.
const recordedReplay = fileURLToPath(new URL("../.engine-body-replay/seed.gz", import.meta.url));
function configureGenerationReplay() {
  if (process.env["FENEL_ENGINE_BODY_REPLAY"] !== undefined) return;
  try {
    if (statSync(recordedReplay).isFile()) process.env["FENEL_ENGINE_BODY_REPLAY"] = recordedReplay;
  } catch { /* Missing or unreadable optional replay leaves ordinary computation. */ }
}

async function prepareGenerationHost(stage) {
  const started = performance.now();
  configureGenerationReplay();
  console.log(`[public-bootstrap] ${stage}: starting`);
  await import("../../../../implementations/typescript/engine/src/engine-body-host-install.ts");
  return started;
}

async function inputDigest() {
  const paths = [...exact];
  for (const root of roots) for await (const path of new Bun.Glob(`${root}/**/*`).scan({ cwd: repository, onlyFiles: true })) {
    if (isPublicBootstrapInput(path)) paths.push(path.replaceAll("\\", "/"));
  }
  paths.sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const bytes = await readFile(resolve(repository, path));
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest("hex");
}
const sourceDigest = await inputDigest();
// Repository authoring catalogue for the Local worker: an index module (checked
// like the snapshots) and content-addressed per-area chunks served statically.
const catalogueIndexOutput = fileURLToPath(new URL("../src/lib/generated/authoring-catalogue.json", import.meta.url));
const catalogueDirectory = fileURLToPath(new URL("../public/generated/authoring-catalogue/", import.meta.url));
if (process.argv.includes("--authoring-catalogue")) {
  const started = await prepareGenerationHost("authoring catalogue");
  await generateAuthoringCatalogue(started);
  process.exit(0);
}
// Lane S (Nov 8): the public (repository-only) worker's own catalogue, a
// second index and chunk directory with the same transport and checks.
const repositoryCatalogueIndexOutput = fileURLToPath(new URL("../src/lib/generated/repository-authoring-catalogue.json", import.meta.url));
const repositoryCatalogueDirectory = fileURLToPath(new URL("../public/generated/repository-authoring-catalogue/", import.meta.url));
if (process.argv.includes("--repository-catalogue")) {
  const started = await prepareGenerationHost("repository authoring catalogue");
  await generateRepositoryAuthoringCatalogue(started);
  process.exit(0);
}
// L4 first paint: the empty Local tab's first publication, computed by the
// Local worker's own projected model and closed operations in a fresh process.
const localBootstrapOutput = fileURLToPath(new URL("../src/lib/generated/local-bootstrap.json", import.meta.url));
if (process.argv.includes("--local-bootstrap")) {
  const started = await prepareGenerationHost("Local first paint");
  await generateLocalBootstrap(started);
  process.exit(0);
}
let priorCatalogue;
try { priorCatalogue = JSON.parse(await readFile(catalogueIndexOutput, "utf8")); } catch { /* Generated below. */ }
let priorRepositoryCatalogue;
try { priorRepositoryCatalogue = JSON.parse(await readFile(repositoryCatalogueIndexOutput, "utf8")); } catch { /* Generated below. */ }
// Explicit arguments: an absent index must read as stale, never as a default.
async function catalogueCurrent(prior, directory) {
  if (prior?.schema !== "fenel.authoring-catalogue.v2" || prior.sourceDigest !== sourceDigest
    || !Array.isArray(prior.chunks)) return false;
  // Every named chunk must exist with its recorded digest (a corrupted or
  // partial chunk is stale, not current).
  for (const { file, sha256 } of prior.chunks) {
    const bytes = await readFile(resolve(directory, file)).catch(() => undefined);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== sha256) return false;
  }
  return true;
}
// Each catalogue is its own fresh process, exactly as its worker is.
function runCatalogueChild() {
  configureGenerationReplay();
  for (const [flag, name] of [["--authoring-catalogue", "authoring"], ["--repository-catalogue", "repository authoring"]]) {
    const child = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url), flag], {
      cwd: process.cwd(), env: process.env, stdout: "inherit", stderr: "inherit" });
    if (child.exitCode !== 0) throw new Error(`The ${name} catalogue generation failed.`);
  }
}
let priorLocalBootstrap;
try { priorLocalBootstrap = JSON.parse(await readFile(localBootstrapOutput, "utf8")); } catch { /* Generated below. */ }
/** L4: current inputs, and the packet bytes still have the digest recorded
 * after the generator compared them with the evaluator (an edit is stale). */
function localBootstrapCurrent() {
  if (priorLocalBootstrap?.schema !== "fenel.local-bootstrap.v1" || priorLocalBootstrap.sourceDigest !== sourceDigest
    || priorLocalBootstrap.publication === undefined || typeof priorLocalBootstrap.packetDigest !== "string") return false;
  return createHash("sha256").update(JSON.stringify(priorLocalBootstrap.publication)).digest("hex") === priorLocalBootstrap.packetDigest;
}
function runLocalBootstrapChild() {
  configureGenerationReplay();
  const child = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url), "--local-bootstrap"], {
    cwd: process.cwd(), env: process.env, stdout: "inherit", stderr: "inherit" });
  if (child.exitCode !== 0) throw new Error("The Local first-paint bootstrap generation failed.");
}
let prior;
try { prior = JSON.parse(await readFile(output, "utf8")); } catch { /* A missing snapshot is generated below. */ }
let priorCorpus;
try { priorCorpus = JSON.parse(await readFile(corpusOutput, "utf8")); } catch { /* A missing corpus is generated below. */ }
let catalogueOk = false;
let localBootstrapOk = false;
if (process.argv.includes("--check") || process.argv.includes("--ensure")) {
  const snapshotsCurrent = prior?.schema === "fenel.public-bootstrap.v1" && prior.sourceDigest === sourceDigest
    && priorCorpus?.schema === "fenel.seed-values.v1" && priorCorpus.sourceDigest === sourceDigest;
  catalogueOk = await catalogueCurrent(priorCatalogue, catalogueDirectory) && await catalogueCurrent(priorRepositoryCatalogue, repositoryCatalogueDirectory);
  localBootstrapOk = localBootstrapCurrent();
  if (snapshotsCurrent && catalogueOk && localBootstrapOk) {
    console.log("Public bootstrap, example corpus, authoring catalogue and Local first paint are current.");
    process.exit(0);
  }
  // Only the catalogue or the Local first paint is stale or damaged (e.g. a
  // fresh clone without its ignored chunks): regenerate that child alone.
  if (snapshotsCurrent && process.argv.includes("--ensure")) {
    if (!catalogueOk) runCatalogueChild();
    if (!localBootstrapOk) runLocalBootstrapChild();
    process.exit(0);
  }
  if (process.argv.includes("--check")) throw new Error("The public bootstrap, example corpus, authoring catalogue or Local first paint is stale. Run bun scripts/generate-public-bootstrap.mjs from distros/narthex/solid.");
}

// The Local worker's catalogue build needs a fresh engine process, exactly as
// a new worker has: run it first, alone, unless the current inputs and every
// chunk have already passed verification above. The Local first paint uses
// the worker's own model in another fresh process.
if (!catalogueOk) runCatalogueChild();
if (!localBootstrapOk) runLocalBootstrapChild();

// These imports use the exact browser projection and corpus. Bun does not
// render their Solid components; the full registry exists only in this tool.
// The corpus's renderer import exposes just this thin codec adapter. Redirect
// that one import to its existing DOM-free implementation, because a Bun tool
// cannot execute Solid 2's compiler-generated JSX entry.
const publicGenerationStarted = await prepareGenerationHost("public data and example corpus");
await Bun.plugin({ name: "public-bootstrap-corpus-codec", setup(build) {
  build.onLoad({ filter: /[\\/]expression-runner[\\/]index\.tsx$/ }, () => ({ loader: "js", contents: `
    import { authoringExpressionLogic } from ${JSON.stringify(fileURLToPath(new URL("../src/lib/expression-runner/expression-evaluation.ts", import.meta.url)))};
    export const toLogic = (node, resolver) => authoringExpressionLogic(node, resolver, globalThis.__fenelPublicBootstrapSession);
  ` }));
} });
const [{ publicLocusDataForSession, publicSourceDemoValues, publicShowcaseSourceForSession, PUBLIC_SEED_NAMES, PUBLIC_DATA_DEMO, arrangePublicDemos }, { invokeCallable }, { Nothing, List, Anything, peelMaybeValue }, { mintAnonymousAuthority }, { REPOSITORY_IDENTITY_MANIFEST },
  { createRepositoryRegistry }, { modulesFor }, { dispatchRegistry }, catalog, { createDetachedAuthoringEnvironment }, { createReaderPresentation }, { inferTransferExpression },
  { evaluateAuthoringExpressionInSession, authoringExpressionSites }, { exprNodeToLogic },
  { expressionRendersSampledMedia }, { detectStructuralForm }] = await Promise.all([
  import("../src/lib/public-locus-data.ts"),
  import("@fenel/engine/expressions"),
  import("@fenel/engine/type-foundation"),
  import("../../../../implementations/typescript/runtime/src/authority-mint.ts"),
  import("@fenel/engine/repository-identity-manifest"),
  import("@fenel/engine/repository-registry"),
  import("@fenel/engine/module-manifest"),
  import("@fenel/engine/system-entities"),
  import("../src/lib/expression-runner/authoring-catalog.ts"),
  import("../src/lib/expression-runner/detached-authoring-environment.ts"),
  import("../src/lib/reader-presentation.ts"),
  import("../src/lib/data-transfer/expressions.ts"),
  import("../src/lib/expression-runner/expression-evaluation.ts"),
  import("@fenel/engine/authoring/expression"),
  import("../src/lib/saved-expression-identity.ts"),
  import("../src/lib/expression-runner/expression-structure.ts"),
]);
// C2: this CLI uses the same complete checked build without browser worker
// transport or its request deadline. Identity/signature gates remain mandatory.
const registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
let environment;
const session = { mode: "detached", registry, evaluateContext: catalog.evaluateContextForCatalog(registry),
  get environment() { return environment ??= createDetachedAuthoringEnvironment(catalog.environmentForCatalog(catalog.buildSessionCatalog(registry))); } };
globalThis.__fenelPublicBootstrapSession = session;
const { SEED_VALUES } = await import("../src/lib/expression-runner/seed-values-source.ts");
delete globalThis.__fenelPublicBootstrapSession;
const demos = PUBLIC_SEED_NAMES.map(name => {
  const example = SEED_VALUES.find(entry => entry.name === name);
  if (!example) throw new Error(`The existing public example ${name} is unavailable.`);
  // Run the same inference the live root used for these unchanged expressions.
  // An undecided example stays untyped and retains the existing runtime path.
  return projectCheckedPublicSeedValue(example, inferTransferExpression(example.expr, session.environment));
});
const projectedSeedValues = SEED_VALUES.map(example => demos.find(demo => demo.name === example.name) ?? example);
const corpus = {
  schema: "fenel.seed-values.v1", sourceDigest,
  identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
  encoding: CHECKPOINT_VALUE_ENCODING,
  values: encodeCheckpointValue(projectedSeedValues),
};
const decodedCorpus = decodeCheckpointValue(JSON.parse(JSON.stringify(corpus.values)), corpus.encoding);
if (!isDeepStrictEqual(decodedCorpus, projectedSeedValues)) throw new Error("Example corpus transport changed an expression, checked type or native value.");
// GLOBAL_ONLY: checked repository-only presentation under this tool's frame.
const presentation = createReaderPresentation(() => ({ registry, session, catalog: [] }));
const data = publicLocusDataForSession(session, arrangePublicDemos([...publicSourceDemoValues(registry, Nothing, presentation, publicShowcaseSourceForSession(session)), ...demos]), List(Anything), Nothing, presentation);
const planner = registry.getFunction("view.workspaceBootstrapPlan");
if (!planner) throw new Error("The repository workspace bootstrap function is unavailable.");
// GLOBAL_ONLY: repository-owned public preferences use their existing pure
// model. An empty authority refuses any accidental host act during the build.
const frame = { ...data.session.evaluateContext, _authority: mintAnonymousAuthority(registry) };
const [{ projectAllDataRoot, PUBLIC_DATA_LOCATIONS }, { workspaceProjectionModelFor }] = await Promise.all([
  import("../src/lib/all-data-root.ts"), import("../src/lib/workspace-projection-model.ts"),
]);
const allDataRoot = projectAllDataRoot(workspaceProjectionModelFor(() => ({ registry, evaluateContext: frame })), PUBLIC_DATA_LOCATIONS);
const result = invokeCallable({ $ref: registry.getUuid(planner.id) ?? planner.id },
  [[], "public-fenel-lens", Nothing, 1280], frame);
if (result?.$tag !== "Ok") throw new Error(String(result?._0 ?? "Public preference planning failed."));
const plan = peelMaybeValue(result._0);
const typeHandle = registry.getUuid("WorkspacePreferences");
if (!plan || !typeHandle) throw new Error("The public preference plan has no canonical repository type.");
if (data.root.canEdit !== false || data.root.persisted || plan.value.lenses.some(lens =>
  lens.source.$tag !== "PublicSource" && lens.source.$tag !== "AllDataSource")) {
  throw new Error("A public bootstrap may contain repository data only.");
}
// C2/B3: the existing checked evaluator supplies these build-owned initial
// repository reads. The producer is retained verbatim for later live editing;
// there is no new evaluator, account reader or expression-specific fast path.
// Only authored record/list child slots are traversed. Raw data stays opaque.
// A referenced producer may use only this same public root's admitted source
// closure; the canonical codec refuses missing/cyclic references before a run.
const initialEntries = new Map();
let initialReadBytes = 0;
const initialReadSession = { ...data.session, evaluateContext: frame };
function initialReadSources(expression) {
  const saved = new Map();
  const environment = initialReadSession.environment;
  exprNodeToLogic(expression, {
    fnCodeName: id => environment.functionCodeName(id) ?? id,
    constructorName: id => environment.constructorCodeName(id),
    operatorCodeName: (_notation, call) => environment.operatorCodeName(call.aliasId, call.arity),
    recordFromEntriesTarget: () => environment.resolveFunctionId("std.fromEntries"),
    resolver: id => {
      const slot = data.root.expressions && Object.getOwnPropertyDescriptor(data.root.expressions, id);
      if (!slot || !("value" in slot))
        throw new Error(`public source ${id} is unavailable`);
      const source = slot.value;
      saved.set(id, source);
      return source;
    },
    onMissingRef: id => { throw new Error(`public source ${id} is unavailable or cyclic`); },
  });
  return saved;
}
// `Data instead of files` is first on screen but last in the combined allowance
// below: its pictures must not take the share the other demos' first paint
// already uses. Its fields borrowed from other demos are read there first.
const deferredInitialReads = [];
function prepareInitialRead(expression) {
  if (expression.kind === "literal") {
    const form = detectStructuralForm(expression.value, () => false);
    if (form?.kind === "record") for (const field of form.fields) {
      if (field.name === PUBLIC_DATA_DEMO.name) deferredInitialReads.push(field.value);
      else prepareInitialRead(field.value);
    }
    else if (form?.kind === "list") for (const child of form.content) prepareInitialRead(child);
    return;
  }
  if (expression.kind !== "call" && expression.kind !== "ref") return;
  const key = JSON.stringify(encodeCheckpointValue(expression));
  if (initialEntries.has(key)) return;
  try {
    const saved = initialReadSources(expression);
    const resolver = saved.size ? id => saved.get(id) : undefined;
    const sources = saved.size ? [...saved].map(([id, expression]) => ({ id, expression })) : undefined;
    const record = !expressionRendersSampledMedia(expression, saved, initialReadSession);
    const evaluated = evaluateAuthoringExpressionInSession(expression, resolver, initialReadSession, {}, { trace: false, capture: record });
    const value = evaluated.result;
    const sites = record ? authoringExpressionSites(expression, resolver, initialReadSession).sites : [];
    const observations = record ? (evaluated.captures ?? []).flatMap(capture => {
      const source = sites[capture.site]?.node;
      if (capture.unavailable || !Object.hasOwn(capture, "value") || !source) return [];
      // Carry the existing judgment's concrete list type to the inert reader;
      // a generic declaration like `List a` is not the completed result type.
      let type;
      if (Array.isArray(capture.value)) {
        try {
          const inferred = inferTransferExpression(source, { ...initialReadSession.environment,
            ...(resolver ? { resolveSavedExpr: resolver } : {}) });
          if (inferred?.outcome?.$tag === "Solved") type = inferred.type;
        } catch { /* Optional type presentation cannot erase completed data. */ }
      }
      return [{ expression: source, value: capture.value, ...(type ? { type } : {}) }];
    }) : undefined;
    let entry = { expression, value, ...(sources ? { sources } : {}), ...(observations ? { observations } : {}) };
    let bytes = JSON.stringify(encodeCheckpointValue(entry));
    // Keep the existing final result when optional copied steps exceed the
    // per-root transport allowance. Sampled-media roots never capture steps.
    if (observations && Buffer.byteLength(bytes) > 512 * 1024) {
      entry = { expression, value, ...(sources ? { sources } : {}) };
      bytes = JSON.stringify(encodeCheckpointValue(entry));
    }
    // Bound transport, not evaluation. Trusted source generation still uses
    // the ordinary evaluator; production killable cells remain separate work.
    if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error("initial read exceeds its transport size");
    const entryBytes = Buffer.byteLength(bytes);
    if (initialReadBytes + entryBytes > 4 * 1024 * 1024) throw new Error("initial reads exceed their combined transport size");
    const decoded = decodeCheckpointValue(JSON.parse(bytes), CHECKPOINT_VALUE_ENCODING);
    if (!isDeepStrictEqual(decoded, entry)) throw new Error("initial read transport changed its value");
    initialEntries.set(key, entry);
    initialReadBytes += entryBytes;
  } catch (error) {
    console.log(`Public initial read remains live: ${expression.kind === "ref" ? expression.savedExprId : expression.fnId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const item of data.root.items) if (item.source?.kind === "expr") prepareInitialRead(item.source.expr);
for (const expression of deferredInitialReads.splice(0)) prepareInitialRead(expression);
const initialReads = {
  schema: "fenel.public-initial-reads.v1", sourceDigest,
  identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest, rootId: data.root.id,
  entries: [...initialEntries.values()],
};
// Display-only record of this root's own addresses (src/lib/public-initial-addresses.ts): the
// existing resolver's answers, with the repository's own address owner deciding every member, for
// the names the root itself shows. The page shows that data from this snapshot while its worker
// resolves the same address; the worker's resolution alone focuses a lens. A failure here only
// omits the record: such an address then waits for the worker, as before.
let initialAddresses;
try {
  const [{ projectPublicInitialAddresses }, { admitPublicInitialAddresses, PUBLIC_INITIAL_ADDRESSES_SCHEMA }] = await Promise.all([
    import("../src/lib/public-initial-address-projection.ts"), import("../src/lib/public-initial-addresses.ts"),
  ]);
  // GLOBAL_ONLY: the same repository-owned pure functions the worker calls (workspaceCall), under this
  // tool's anonymous empty authority.
  const addressModel = workspaceProjectionModelFor(() => ({ registry, evaluateContext: frame }));
  const projected = await projectPublicInitialAddresses(data.root,
    async operation => addressModel.workspaceCall(operation.kind, ...operation.args));
  const record = { schema: PUBLIC_INITIAL_ADDRESSES_SCHEMA, sourceDigest,
    identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest, rootId: data.root.id, entries: projected.entries };
  const transported = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(record))), CHECKPOINT_VALUE_ENCODING);
  if (!isDeepStrictEqual(transported, record)) throw new Error("transport changed an address");
  if (admitPublicInitialAddresses(data.root, transported, record)?.size !== record.entries.length) throw new Error("the page would refuse this record");
  initialAddresses = record;
  console.log(`Public address record: ${record.entries.length} addresses`
    + (projected.skipped.length ? `; left to the reader (large namespaces): ${projected.skipped.map(path => `/${path.join("/")}`).join(", ")}` : ""));
} catch (error) {
  console.log(`Public address record omitted: ${error instanceof Error ? error.message : String(error)}`);
}
const snapshot = {
  schema: "fenel.public-bootstrap.v1", sourceDigest,
  identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
  encoding: CHECKPOINT_VALUE_ENCODING,
  workspace: encodeCheckpointValue({ status: "ready", value: plan.value, visibleLenses: plan.visibleLenses,
    activeLens: plan.activeLens, tilePlan: plan.tilePlan, presentations: plan.presentations, valueType: { $ref: typeHandle } }),
  root: encodeCheckpointValue(data.root),
  allDataRoot: encodeCheckpointValue(allDataRoot),
  initialReads: encodeCheckpointValue(initialReads),
  ...(initialAddresses ? { initialAddresses: encodeCheckpointValue(initialAddresses) } : {}),
};
const decodedRoot = decodeCheckpointValue(JSON.parse(JSON.stringify(snapshot.root)), snapshot.encoding);
if (!isDeepStrictEqual(decodedRoot, data.root)) throw new Error("Public root transport changed a native value.");
const decodedAllDataRoot = decodeCheckpointValue(JSON.parse(JSON.stringify(snapshot.allDataRoot)), snapshot.encoding);
if (!isDeepStrictEqual(decodedAllDataRoot, allDataRoot)) throw new Error("Public data locations changed during transport.");
const decodedWorkspace = decodeCheckpointValue(JSON.parse(JSON.stringify(snapshot.workspace)), snapshot.encoding);
if (!isDeepStrictEqual(decodedWorkspace.value, plan.value)) throw new Error("Public preference transport changed a native value.");
if (await inputDigest() !== sourceDigest) throw new Error("Public bootstrap inputs changed during generation. Run the generator again.");
await mkdir(fileURLToPath(new URL("../src/lib/generated/", import.meta.url)), { recursive: true });
const bytes = `${JSON.stringify(snapshot)}\n`;
const corpusBytes = `${JSON.stringify(corpus)}\n`;
// Dev readers must observe a complete old or new JSON artifact during writes.
async function writeAtomically(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
await writeAtomically(output, bytes);
await writeAtomically(corpusOutput, corpusBytes);
console.log(`Public bootstrap generated: ${Buffer.byteLength(bytes)} bytes; ${data.root.items.length} root values. Example corpus: ${Buffer.byteLength(corpusBytes)} bytes; ${SEED_VALUES.length} values.`);
console.log(`Checked initial public reads: ${initialEntries.size}; ${initialReadBytes} expression/result bytes.`);
console.log(`[public-bootstrap] public data and example corpus: finished in ${Math.round(performance.now() - publicGenerationStarted)} ms`);

/** Child mode: the Local worker's initialize projection for an empty Local
 * source (same functions, same fresh process state), transported losslessly. */
async function generateAuthoringCatalogue(started) {
  const [artifact, catalog, { buildLocalReaderFieldRegistry }, { mintAnonymousAuthority }, { LOCAL_BROWSER_SOURCE_ID },
    { REPOSITORY_IDENTITY_MANIFEST }, { readdir }] = await Promise.all([
    import("../src/lib/expression-runner/authoring-catalogue-artifact.ts"),
    import("../src/lib/expression-runner/authoring-catalog.ts"),
    import("../src/lib/reader-registry.ts"),
    import("../../../../implementations/typescript/runtime/src/authority-mint.ts"),
    import("../src/lib/browser-data-storage.ts"),
    import("@fenel/engine/repository-identity-manifest"),
    import("node:fs/promises"),
  ]);
  const data = { localSourceId: LOCAL_BROWSER_SOURCE_ID, snapshot: { owners: [], fields: [], facets: [] },
    entities: [], functions: [], localRepresentations: [] };
  const registry = await buildLocalReaderFieldRegistry(data.localSourceId, data.snapshot,
    { preparation: "inline", representations: data.localRepresentations });
  const frame = Object.freeze({ ...catalog.evaluateContextForCatalog(registry), _authority: mintAnonymousAuthority(registry),
    _activeTags: Object.freeze([data.localSourceId]) });
  const { catalog: projected, displayCatalog } = artifact.projectLocalAuthoringCatalogue(registry, frame, data);
  const result = { catalog: projected, displayCatalog };
  const fingerprint = await artifact.repositoryCatalogueFingerprint(registry, frame);
  // referenceRoutes start with one row per module route whose target has an
  // identified UUID (in route order), then root type members. Record that
  // split for reader-locale re-collation; null when it cannot be confirmed.
  const moduleRoutes = projected.exactFunctionRoutes.filter(route => route.sourceName.includes("."));
  const derived = moduleRoutes.filter(route => {
    const target = registry.getUuid(route.targetId);
    return target !== undefined && registry.getIdentifiedFunction(target) !== undefined;
  }).map(route => route.sourceName);
  const referenceRouteSplit = JSON.stringify(projected.referenceRoutes.slice(0, derived.length).map(route => route.sourceName))
    === JSON.stringify(derived) ? derived.length : null;
  const encoded = artifact.encodeAuthoringCatalogue(result);
  const decoded = artifact.decodeAuthoringCatalogue(encoded, encoded.chunks.map(chunk => chunk.text));
  // The worker's reply crosses postMessage: compare what it delivers, in the
  // canonical transport text (keys, order, undefined, Map, numbers, sharing).
  const canonical = value => JSON.stringify(artifact.encodeAuthoringCatalogue(structuredClone(value), Infinity));
  if (canonical(decoded) !== canonical(result)) {
    throw new Error("Authoring catalogue transport changed the projection.");
  }
  await mkdir(catalogueDirectory, { recursive: true });
  const chunks = [];
  for (const chunk of encoded.chunks) {
    const sha256 = createHash("sha256").update(chunk.text).digest("hex");
    const file = `${chunk.area}.${sha256.slice(0, 16)}.json`;
    // A content-addressed chunk that already holds these bytes stays as is:
    // Windows refuses to replace a file the dev server is serving.
    const target = resolve(catalogueDirectory, file);
    const current = await readFile(target, "utf8").catch(() => undefined);
    if (current === undefined || createHash("sha256").update(current).digest("hex") !== sha256) await writeAtomically(target, chunk.text);
    chunks.push({ area: chunk.area, file, bytes: Buffer.byteLength(chunk.text), sha256 });
  }
  const index = { schema: artifact.AUTHORING_CATALOGUE_SCHEMA, sourceDigest, identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
    sourceId: data.localSourceId, fingerprint, referenceRouteSplit, collections: encoded.collections, chunks };
  await writeAtomically(catalogueIndexOutput, `${JSON.stringify(index)}\n`);
  // Retire chunks no index names (content-addressed, generated files only).
  const named = new Set(chunks.map(chunk => chunk.file));
  for (const file of await readdir(catalogueDirectory)) {
    if (!named.has(file) && /^[a-z0-9-]+\.[0-9a-f]{16}\.json$/.test(file)) await unlink(resolve(catalogueDirectory, file));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  console.log(`Authoring catalogue generated: ${chunks.length} chunks, ${total} bytes, ${Math.round(performance.now() - started)} ms.`);
}

/** Child mode (lane S): the public worker's initialize projection over a fresh
 * repository-only registry (same functions, same fresh process state), with
 * the transport and digests of the Local catalogue above. */
async function generateRepositoryAuthoringCatalogue(started) {
  const [artifact, catalog, { createRepositoryRegistry }, { modulesFor }, { dispatchRegistry }, { mintAnonymousAuthority },
    { REPOSITORY_IDENTITY_MANIFEST }, { readdir }] = await Promise.all([
    import("../src/lib/expression-runner/authoring-catalogue-artifact.ts"),
    import("../src/lib/expression-runner/authoring-catalog.ts"),
    import("@fenel/engine/repository-registry"),
    import("@fenel/engine/module-manifest"),
    import("@fenel/engine"),
    import("../../../../implementations/typescript/runtime/src/authority-mint.ts"),
    import("@fenel/engine/repository-identity-manifest"),
    import("node:fs/promises"),
  ]);
  // authoring-catalog-worker-main.ts, repositoryOnly initialize: registry, frame, projection.
  const registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
  const frame = Object.freeze({ ...catalog.evaluateContextForCatalog(registry), _authority: mintAnonymousAuthority(registry) });
  const result = artifact.projectRepositoryAuthoringCatalogue(registry);
  const fingerprint = await artifact.repositoryCatalogueFingerprint(registry, frame);
  const referenceRouteSplit = artifact.referenceRouteSplitFor(registry, result.catalog);
  const encoded = artifact.encodeAuthoringCatalogue(result);
  const decoded = artifact.decodeAuthoringCatalogue(encoded, encoded.chunks.map(chunk => chunk.text));
  // The worker's reply crosses postMessage: compare what it delivers.
  const canonical = value => JSON.stringify(artifact.encodeAuthoringCatalogue(structuredClone(value), Infinity));
  if (canonical(decoded) !== canonical(result)) {
    throw new Error("Repository authoring catalogue transport changed the projection.");
  }
  await mkdir(repositoryCatalogueDirectory, { recursive: true });
  const chunks = [];
  for (const chunk of encoded.chunks) {
    const sha256 = createHash("sha256").update(chunk.text).digest("hex");
    const file = `${chunk.area}.${sha256.slice(0, 16)}.json`;
    const target = resolve(repositoryCatalogueDirectory, file);
    const current = await readFile(target, "utf8").catch(() => undefined);
    if (current === undefined || createHash("sha256").update(current).digest("hex") !== sha256) await writeAtomically(target, chunk.text);
    chunks.push({ area: chunk.area, file, bytes: Buffer.byteLength(chunk.text), sha256 });
  }
  const index = { schema: artifact.AUTHORING_CATALOGUE_SCHEMA, sourceDigest, identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
    sourceId: artifact.REPOSITORY_CATALOGUE_SOURCE_ID, fingerprint, referenceRouteSplit, collections: encoded.collections, chunks };
  await writeAtomically(repositoryCatalogueIndexOutput, `${JSON.stringify(index)}\n`);
  // Retire chunks no index names (content-addressed, generated files only).
  const named = new Set(chunks.map(chunk => chunk.file));
  for (const file of await readdir(repositoryCatalogueDirectory)) {
    if (!named.has(file) && /^[a-z0-9-]+\.[0-9a-f]{16}\.json$/.test(file)) await unlink(resolve(repositoryCatalogueDirectory, file));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  console.log(`Repository authoring catalogue generated: ${chunks.length} chunks, ${total} bytes, ${Math.round(performance.now() - started)} ms.`);
}

/** Child mode (L4 first paint): what the Local worker publishes first for EMPTY
 * browser storage. The same projected model and closed operation runner the
 * worker uses answer the page's unchanged chain: storage admission of an absent
 * record, defaultLocalTabData, tabDataCheckRoot, tabDataWithClipboard, then the
 * early publication. Anonymous empty repository frame; no reader data. */
async function generateLocalBootstrap(started) {
  const [{ loadWorkspaceModel }, { runLocalOrdinaryOperation }, { LOCAL_BROWSER_SOURCE_ID }, { List, Anything },
    { Nothing }, { REPOSITORY_IDENTITY_MANIFEST }] = await Promise.all([
    import("../src/lib/workspace-model-loader.ts"),
    import("../src/lib/local-ordinary-operations.ts"),
    import("../src/lib/browser-data-storage.ts"),
    import("@fenel/engine/type-foundation"),
    import("@fenel/engine/maybe-value"),
    import("@fenel/engine/repository-identity-manifest"),
  ]);
  // The worker's model: projected profile, inline preparation (no nested worker).
  const model = await loadWorkspaceModel({ projected: true, preparation: "inline" });
  const id = LOCAL_BROWSER_SOURCE_ID;
  // browser-data-storage.ts `load` on an absent IndexedDB record.
  const stored = model.workspaceCall("browserDataStoredState", id, Nothing);
  if (stored?.$tag !== "Ok" || stored._0?.$tag !== "Nothing") throw new Error("Empty browser storage is not admitted as absent data.");
  // local-locus-data.ts admitInitial with no retained data, Local options.
  const run = operation => runLocalOrdinaryOperation(model, operation);
  const initial = run({ kind: "defaultLocalTabData", args: [id] });
  const identity = run({ kind: "tabDataCheckRoot", args: [initial, id] });
  if (identity?.$tag !== "Ok" || identity._0 !== true) throw new Error("The default Local data does not check its own identity.");
  const normalized = run({ kind: "tabDataWithClipboard", args: [initial] });
  // readReady's preparePublication before any reader (no callable labels).
  const publication = run({ kind: "publication", args: [normalized, List(Anything), { earlyTypeDescriptions: true }] });
  if (publication.state !== normalized || publication.root?.canEdit !== true || publication.root.persisted)
    throw new Error("The empty Local publication is not this tab's editable data.");
  const encoded = encodeCheckpointValue(publication);
  const text = JSON.stringify(encoded);
  const decoded = decodeCheckpointValue(JSON.parse(text), CHECKPOINT_VALUE_ENCODING);
  if (!isDeepStrictEqual(decoded, publication)) throw new Error("Local first-paint transport changed the publication.");
  const packet = { schema: "fenel.local-bootstrap.v1", sourceDigest, identityDigest: REPOSITORY_IDENTITY_MANIFEST.digest,
    encoding: CHECKPOINT_VALUE_ENCODING, sourceId: id, packetDigest: createHash("sha256").update(text).digest("hex"),
    publication: encoded };
  if (await inputDigest() !== sourceDigest) throw new Error("Public bootstrap inputs changed during generation. Run the generator again.");
  await mkdir(fileURLToPath(new URL("../src/lib/generated/", import.meta.url)), { recursive: true });
  const bytes = `${JSON.stringify(packet)}\n`;
  await writeAtomically(localBootstrapOutput, bytes);
  console.log(`Local first paint generated: ${Buffer.byteLength(bytes)} bytes; ${publication.root.items.length} root values, ${publication.savedValues.length} saved values, ${Math.round(performance.now() - started)} ms.`);
}
