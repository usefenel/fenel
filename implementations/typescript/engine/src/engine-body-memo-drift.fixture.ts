// Test fixture (S1 drift gate): the seed build with a chosen field cache key
// and the full registry value digest, shared by engine-body-memo-drift.test.ts
// and its separate memo-OFF cold realm. Run as a script with `cold` it builds
// the seed with the memo OFF in a fresh realm and prints the digest as JSON.
import "./engine-body-host-install";
import { modulesFor } from "./module-manifest";
import { createRegistry, type ModuleRegistry } from "./registry";
import {
  REPOSITORY_IDENTITY_MANIFEST,
  repositoryIdentityKinds,
  repositoryIdentityLock,
} from "./repository-identity-manifest";
import { repositoryFieldFacetModule } from "./repository-field-facet-module";
import { compileConstructorSlotConflicts, compileConstructorSlotTable } from "./compile-field-slots";
import { __setEngineBodyMemoForTests, withEngineBodyMemoPartition } from "./engine-body-memo";

/** The repository build of `createRepositoryRegistry`, with a chosen field
 * cache key (a fresh key bypasses the registry's module-keyed field memos). */
export function seedBuild(tag: string): ModuleRegistry {
  const lock = repositoryIdentityLock();
  return withEngineBodyMemoPartition("repository", () => createRegistry([...modulesFor("seed"), repositoryFieldFacetModule()], {
    codeNameLock: lock,
    fieldIdentity: {
      mode: "strict-embedded",
      defaultRealm: "repository-source",
      lock,
      identityKinds: repositoryIdentityKinds(),
      cacheKey: `s1-drift:${tag}:${REPOSITORY_IDENTITY_MANIFEST.digest}`,
      bodySpellingPolicy: "reject",
    },
  }));
}

/** Value digest (Merkle per object, so shared subgraphs cost once): own keys
 * in `Reflect.ownKeys` order with each property's attribute triple, each
 * object's extensibility and prototype kind, accessors marked (never called),
 * Map/Set/Bytes and functions (by name) encoded, cycles marked. Sharing is
 * NOT part of the digest: a replay legitimately loses aliasing with inputs.
 * A 64-bit non-cryptographic hash (two independent 32-bit FNV-1a lanes) per
 * object: a test-equality digest over one machine, not a security boundary;
 * one memo per registry so shared subgraphs across parts are hashed once. */
type Hash = { a: number; b: number };
function hashString(h: Hash, s: string): void {
  let a = h.a ^ s.length;
  let b = h.b ^ (s.length * 31);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  h.a = a;
  h.b = b;
}
function hex(h: Hash): string {
  return (h.a >>> 0).toString(16).padStart(8, "0") + (h.b >>> 0).toString(16).padStart(8, "0");
}
function makeDigestValue(): (root: unknown) => string {
  const memo = new WeakMap<object, string>();
  const onStack = new Set<object>();
  const leaf = (v: unknown): string | undefined => {
    if (v === null) return "n";
    switch (typeof v) {
      case "string": return `s${v.length}:${v}`;
      case "number": return Object.is(v, -0) ? "d-0;" : `d${v};`;
      case "boolean": return v ? "T" : "F";
      case "undefined": return "u";
      case "bigint": return `b${v};`;
      case "symbol": return `y${String(v.description)};`;
      case "function": return `f${(v as { name?: string }).name ?? ""};`;
    }
    return undefined;
  };
  const visit = (v: unknown): string => {
    const l = leaf(v);
    if (l !== undefined) {
      if (l.length <= 24) return l;
      const h = { a: 0x811c9dc5, b: 0x2166136 };
      hashString(h, l);
      return `h${hex(h)}`;
    }
    const o = v as object;
    const prior = memo.get(o);
    if (prior !== undefined) return prior;
    if (onStack.has(o)) return "^cycle";
    onStack.add(o);
    const h = { a: 0x811c9dc5, b: 0x2166136 };
    const proto = Object.getPrototypeOf(o);
    hashString(h, `${Object.isExtensible(o) ? "e" : "x"}:${proto === null ? "null" : proto?.constructor?.name ?? "?"}|`);
    if (o instanceof Uint8Array) { for (const byte of o) hashString(h, String.fromCharCode(byte)); }
    else if (o instanceof Map) { for (const [k, x] of o) hashString(h, `M${visit(k)}=${visit(x)};`); }
    else if (o instanceof Set) { for (const x of o) hashString(h, `S${visit(x)};`); }
    else {
      for (const key of Reflect.ownKeys(o)) {
        const d = Object.getOwnPropertyDescriptor(o, key)!;
        const name = typeof key === "symbol" ? `@@${String(key.description)}` : key;
        const attrs = `${d.enumerable ? "e" : "-"}${d.configurable ? "c" : "-"}${"value" in d ? (d.writable ? "w" : "-") : "a"}`;
        hashString(h, `k${name.length}:${name}/${attrs}=`);
        hashString(h, "value" in d ? visit(d.value) : "accessor");
        hashString(h, ";");
      }
    }
    onStack.delete(o);
    const out = `#${hex(h)}`;
    memo.set(o, out);
    return out;
  };
  return visit;
}

/** A per-item part: each item is read, digested and dropped in turn; the part's
 * digest is the ordered list of item digests. */
class Streamed {
  constructor(private readonly items: readonly string[], private readonly read: (id: string) => unknown) {}
  digest(): string {
    const h = { a: 0x811c9dc5, b: 0x2166136 };
    for (const id of this.items) {
      hashString(h, makeDigestValue()(this.read(id)));
      hashString(h, ";");
    }
    return `#${hex(h)}:${this.items.length}`;
  }
}
const streamed = (items: readonly string[], read: (id: string) => unknown): Streamed => new Streamed(items, read);

export function fullDigest(reg: ModuleRegistry): Record<string, string> {
  const ids = reg.listFunctions().map((fn) => fn.id);
  const moduleNames = reg.modules.map((m) => m.name);
  const table = compileConstructorSlotTable(reg as never);
  const parts: Record<string, () => unknown> = {
    functions: () => ids,
    signatureInfos: () => streamed(ids, (id) => [id, reg.getFunctionSignatureInfo(id) ?? null]),
    functionSchemes: () => streamed(ids, (id) => [id, reg.getFunctionScheme(id) ?? null]),
    functionUuids: () => ids.map((id) => [id, reg.getUuid(id) ?? null]),
    identifiedFunctions: () => streamed(ids, (id) => reg.getIdentifiedFunction(id) ?? null),
    functionOptions: () => reg.functionOptions(),
    entities: () => reg.listEntities(),
    identifiedEntities: () => reg.listIdentifiedEntities(),
    entityUuids: () => reg.listEntities().map((e) => [e.id, reg.getUuid(e.id) ?? null]),
    typeUuids: () => REPOSITORY_IDENTITY_MANIFEST.types.map(([owner, name]) => [owner, name, reg.getTypeUuid(owner, name) ?? null]),
    // View plans and attachments have no accessor of their own: they are
    // observable only through the identified views above and these rows.
    fieldIdentities: () => reg.listFieldIdentities(),
    fieldEntities: () => reg.listFieldEntities(),
    fieldLockRequests: () => reg.listFieldLockRequests(),
    facetInstances: () => reg.listFieldRepresentations(),
    repositoryReusableFieldIds: () => reg.listRepositoryReusableFieldIds(),
    constructorSignatures: () => reg.listConstructorSignatures(),
    capabilityMethodSignatures: () => reg.listCapabilityMethodSignatures(),
    sourceFunctionResolutions: () => moduleNames.map((m) => [m, reg.listSourceFunctionResolutions(m)]),
    sourceConstructorResolutions: () => moduleNames.map((m) => [m, reg.listSourceConstructorResolutions(m)]),
    sourceFunctionRouteEvidence: () => moduleNames.map((m) => [m, reg.listSourceFunctionRouteEvidence(m)]),
    sourceConstructorRouteEvidence: () => moduleNames.map((m) => [m, reg.listSourceConstructorRouteEvidence(m)]),
    moduleMembers: () => moduleNames.map((m) => [m, reg.listModuleMembers(m)]),
    importFrames: () => moduleNames.map((m) => [m, reg.getModuleImportFrame(m) ?? null]),
    ambiguousBareNames: () => reg.ambiguousBareNames(),
    routingTable: () => reg.routingTable(),
    constructorSlots: () => table,
    constructorConflicts: () => compileConstructorSlotConflicts(table),
  };
  const out: Record<string, string> = {};
  for (const [label, read] of Object.entries(parts)) {
    const value = read();
    out[label] = value instanceof Streamed ? value.digest() : makeDigestValue()(value);
  }
  return out;
}


if (import.meta.main && process.argv[2] === "cold") {
  __setEngineBodyMemoForTests(false);
  const t = performance.now();
  const reg = seedBuild("cold");
  const buildMs = Math.round(performance.now() - t);
  const t2 = performance.now();
  const digest = fullDigest(reg);
  console.log(JSON.stringify({ buildMs, digestMs: Math.round(performance.now() - t2), digest }));
  process.exit(0);
}

// `replay`: a fresh realm with the memo ON (the caller sets
// FENEL_ENGINE_BODY_REPLAY to a recorded artifact and NODE_ENV=production);
// prints the digest, the artifact verdict and how many caller-less calls were
// served from it versus computed.
if (import.meta.main && process.argv[2] === "replay") {
  const { engineBodyMemoStats } = await import("./engine-body-memo");
  const { engineBodyReplayStatus } = await import("./engine-bodies-dispatch");
  const t = performance.now();
  const reg = seedBuild("replay-realm");
  const buildMs = Math.round(performance.now() - t);
  const stats = engineBodyMemoStats();
  const sum = (key: "calls" | "hits" | "artifactHits" | "computed") =>
    Object.values(stats.byFn).reduce((n, row) => n + row[key], 0);
  const t2 = performance.now();
  const digest = fullDigest(reg);
  console.log(JSON.stringify({
    buildMs, digestMs: Math.round(performance.now() - t2), digest, status: engineBodyReplayStatus(),
    calls: sum("calls"), hits: sum("hits"), artifactHits: sum("artifactHits"), computed: sum("computed"),
  }));
  process.exit(0);
}

// Production-path modes (S1b round 3): the seed through `createRepositoryRegistry`
// and a Local tab through `createLocalFieldRegistry`, exactly as product code
// builds them (no fixture cache keys).
//   prod-cold              memo OFF, seed only
//   prod-replay            memo ON (+ artifact from FENEL_ENGINE_BODY_REPLAY), seed only
//   prod-replay-local-first  memo ON (+ artifact), a Local tab build FIRST, then the seed
async function localTabBuild(): Promise<{ readonly calls: number; readonly computed: number }> {
  const fieldsAuthoring = await import("./field-authoring");
  const catalog = await import("./repository-field-catalog");
  const identity = await import("./repository-identity-manifest");
  const accountFields = await import("./account-field-registry");
  const dispatchModule = await import("./dispatch-registry");
  const entities = await import("./system-entities");
  const { engineBodyMemoStats } = await import("./engine-body-memo");
  const sourceId = "s1-drift-local-tab";
  const typeId = "6b6f3f8e-3a1e-4d55-9a37-0d0f6a1c2b01";
  const fieldId = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
  const fnId = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
  const nothing = { $tag: "Nothing" };
  const empty = {
    owners: [],
    fields: [{ id: fieldId, currentCodeName: "count", status: "live", realm: "account", reuseVisibility: "account" }],
    facets: [],
  };
  const bundle = { ownerMutations: [
    { kind: "upsert", owner: { kind: "type", ownerKey: `type:${typeId}`, storageName: typeId,
      definition: { id: typeId, type: { $record: { fields: [{ name: "count", key: { $tag: "NamedField", ref: { $ref: fieldId } },
        type: { $ref: "Number" }, label: nothing, ui: nothing, meta: {} }] } } } } },
    { kind: "upsert", owner: { kind: "function", ownerKey: `function:${fnId}`, storageName: fnId,
      definition: { id: fnId, params: [], returns: { $ref: "Number" }, body: 17 } } },
  ] };
  const owners = fieldsAuthoring.projectFieldOwnerMutations(empty.owners as never, bundle.ownerMutations as never);
  let counter = 0;
  const ownerMutations = fieldsAuthoring.prepareLocalConstructorFunctionMutations(sourceId, empty as never,
    { ...empty, owners } as never, bundle.ownerMutations as never,
    () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, identity.repositoryIdentityKinds());
  const snapshot = fieldsAuthoring.planFieldPersistence({
    currentOwners: empty.owners, currentFields: empty.fields, currentFacets: empty.facets,
    ...bundle, ownerMutations, repositoryFields: catalog.REPOSITORY_REUSABLE_DURABLE_FIELDS,
    identityKinds: identity.repositoryIdentityKinds(),
  } as never).snapshot;
  const pool = dispatchModule.createDispatchRegistry();
  for (const cls of entities.dispatchRegistry.listClasses()) pool.defineClass(cls);
  for (const instance of entities.dispatchRegistry.listInstances()) {
    if (dispatchModule.instanceVisible(instance, dispatchModule.GLOBAL_ONLY)) pool.addInstance(instance);
  }
  const before = engineBodyMemoStats().byFn;
  accountFields.createLocalFieldRegistry(modulesFor("seed"), sourceId, snapshot, { dispatchRegistry: pool });
  const after = engineBodyMemoStats().byFn;
  let calls = 0;
  let computed = 0;
  for (const [fn, row] of Object.entries(after)) {
    calls += row.calls - (before[fn]?.calls ?? 0);
    computed += row.computed - (before[fn]?.computed ?? 0);
  }
  return { calls, computed };
}

const productionMode = process.argv[2];
if (import.meta.main && (productionMode === "prod-cold" || productionMode === "prod-replay" || productionMode === "prod-replay-local-first")) {
  const { createRepositoryRegistry } = await import("./repository-registry");
  const { engineBodyMemoStats } = await import("./engine-body-memo");
  const { engineBodyReplayStatus } = await import("./engine-bodies-dispatch");
  if (productionMode === "prod-cold") __setEngineBodyMemoForTests(false);
  const local = productionMode === "prod-replay-local-first" ? await localTabBuild() : undefined;
  const before = engineBodyMemoStats().byFn;
  const t = performance.now();
  const reg = createRepositoryRegistry(modulesFor("seed"));
  const buildMs = Math.round(performance.now() - t);
  const after = engineBodyMemoStats().byFn;
  const sum = (key: "calls" | "hits" | "artifactHits" | "computed") =>
    Object.entries(after).reduce((n, [fn, row]) => n + row[key] - (before[fn]?.[key] ?? 0), 0);
  const t2 = performance.now();
  const digest = fullDigest(reg);
  console.log(JSON.stringify({
    buildMs, digestMs: Math.round(performance.now() - t2), digest, status: engineBodyReplayStatus(), local,
    calls: sum("calls"), hits: sum("hits"), artifactHits: sum("artifactHits"), computed: sum("computed"),
  }));
  process.exit(0);
}

// `harness-certificate-stability` (certificate v2, 2026-11-01): every part of
// the harness certificate, digested right after the harness build, equals the
// same parts digested again after a whole realm boot: a replay installation
// through the browser seam, a Local tab build and the seed build, with the
// memo on (NODE_ENV=production). The recorder states its certificate after
// its builds and a worker states it at boot, before any build, so any part
// that a build moves would refuse every artifact.
if (import.meta.main && productionMode === "harness-certificate-stability") {
  const dispatch = await import("./engine-bodies-dispatch");
  const { createRepositoryRegistry } = await import("./repository-registry");
  const { replayArtifactText } = await import("./engine-body-replay");
  const { sha256OfEncoding, engineBodyMemoStats } = await import("./engine-body-memo");
  const { evaluatorHookGenerationForMemo } = await import("./json-logic");
  const parts = () => dispatch.harnessCertificatePartDigests(dispatch.harnessCertificateInput());
  const before = parts();
  const certificate = dispatch.engineHarnessCertificate();
  const text = replayArtifactText({ sourceEpoch: "s1-certificate-stability", harnessCertificate: certificate ?? "",
    hookGeneration: evaluatorHookGenerationForMemo() }, []);
  const install = dispatch.installEngineBodyReplayArtifactText(text,
    { textDigest: sha256OfEncoding(text), sourceEpoch: "s1-certificate-stability" });
  const local = await localTabBuild();
  const seedStarted = performance.now();
  createRepositoryRegistry(modulesFor("seed"));
  const seedMs = Math.round(performance.now() - seedStarted);
  const seedCalls = Object.values(engineBodyMemoStats().byFn).reduce((n, row) => n + row.calls, 0);
  const after = parts();
  console.log(JSON.stringify({ before, after, certificate, install, local, seedMs, seedCalls }));
  process.exit(0);
}
