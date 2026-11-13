// Fresh-process probe for field-identity Phase 4b's D1' cold-boot gate.
//
// Keep the edited source roster above the registry/artifact imports below: the
// point of this executable is to reproduce a checkout whose engine source has
// changed before the first repository registry (and therefore before the first
// compiled-parser serving decision) exists in this process. All value imports
// are dynamic so their evaluation order is visible and load-bearing here.
import type { FenelModule } from "./types";

const TOUCHED_ENTRY = "engine:lexAll" as const;
const UNTOUCHED_ENTRY = "engine:defaultFixityTable" as const;
const RESOLVER_ENTRY = "dispatch:rsvResolveBareName" as const;
const EDITED_LITERAL = "phase4b fresh-process edited engine body";

const { engineModule } = await import("./modules/engine");
const functions = engineModule.functions?.map((fn) => fn.id === TOUCHED_ENTRY
  ? { ...fn, body: { literal: EDITED_LITERAL } }
  : fn);
if (functions === undefined) {
  throw new Error("cold-shard probe: engine source roster has no functions");
}
const editedEngineModule: FenelModule = { ...engineModule, functions };
const editedBeforeRegistry = editedEngineModule.functions?.some((fn) =>
  fn.id === TOUCHED_ENTRY
  && typeof fn.body === "object"
  && fn.body !== null
  && "literal" in fn.body
  && fn.body.literal === EDITED_LITERAL
) === true;
if (!editedBeforeRegistry) {
  throw new Error("cold-shard probe: edited engine body was not installed before registry construction");
}

// These imports are deliberately delayed until the edited source roster above
// is complete. In particular, getParserNamespace's registry-local WeakMap is
// cold when this executable starts and is not consulted until after the edited
// repository registry has been built.
const [
  parserArtifact,
  resolverArtifact,
  { createDispatchRegistry },
  {
    compiledArtifactRuntimeInputHash,
    computeParserEntryClosureIds,
    getParserNamespace,
    getResolverNamespace,
  },
  { createRepositoryRegistry },
  { dispatchModule },
  { localeModule },
  { stdModule },
] = await Promise.all([
  import("./generated/compiled-parser.generated"),
  import("./generated/compiled-resolver.generated"),
  import("./dispatch-registry"),
  import("./engine-bodies-dispatch"),
  import("./repository-registry"),
  import("./modules/dispatch"),
  import("./modules/locale"),
  import("./modules/std"),
]);

const rawShards = (parserArtifact as unknown as Record<string, unknown>).PARSER_SHARDS;
const rawResolverShards = (resolverArtifact as unknown as Record<string, unknown>).RESOLVER_SHARDS;
if (rawShards === undefined || rawResolverShards === undefined) {
  throw new Error("cold-shard probe: final generated shard metadata is absent");
}
if (rawShards === null || typeof rawShards !== "object") {
  throw new Error("cold-shard probe: PARSER_SHARDS is not a record");
}
if (rawResolverShards === null || typeof rawResolverShards !== "object") {
  throw new Error("cold-shard probe: RESOLVER_SHARDS is not a record");
}
const shards = rawShards as Record<string, {
  readonly runtimeInputHash: string;
}>;
const touchedShard = shards[TOUCHED_ENTRY];
const untouchedShard = shards[UNTOUCHED_ENTRY];
const resolverShard = (rawResolverShards as Record<string, {
  readonly runtimeInputHash: string;
}>)[RESOLVER_ENTRY];
if (touchedShard === undefined || untouchedShard === undefined) {
  throw new Error("cold-shard probe: generated parser shard metadata is incomplete");
}
if (resolverShard === undefined) {
  throw new Error("cold-shard probe: generated resolver shard metadata is incomplete");
}

const registry = createRepositoryRegistry(
  [stdModule, editedEngineModule, dispatchModule, localeModule],
  { dispatchRegistry: createDispatchRegistry() },
);
const registeredTouched = registry.getFunction(TOUCHED_ENTRY);
if (
  registeredTouched === undefined
  || typeof registeredTouched.body !== "object"
  || registeredTouched.body === null
  || !("literal" in registeredTouched.body)
  || registeredTouched.body.literal !== EDITED_LITERAL
) {
  throw new Error("cold-shard probe: repository registry did not retain the edited source body");
}

const touchedClosure = computeParserEntryClosureIds(registry, TOUCHED_ENTRY);
const untouchedClosure = computeParserEntryClosureIds(registry, UNTOUCHED_ENTRY);
if (!touchedClosure.includes(TOUCHED_ENTRY) || untouchedClosure.includes(TOUCHED_ENTRY)) {
  throw new Error("cold-shard probe: touched and untouched entry closures are not disjoint at the edited body");
}
if (compiledArtifactRuntimeInputHash("parser", registry, TOUCHED_ENTRY) === touchedShard.runtimeInputHash) {
  throw new Error("cold-shard probe: edited parser shard unexpectedly remained fresh");
}
if (compiledArtifactRuntimeInputHash("parser", registry, UNTOUCHED_ENTRY) !== untouchedShard.runtimeInputHash) {
  throw new Error("cold-shard probe: unrelated parser shard unexpectedly became stale");
}
if (compiledArtifactRuntimeInputHash("resolver", registry, RESOLVER_ENTRY) !== resolverShard.runtimeInputHash) {
  throw new Error("cold-shard probe: engine edit unexpectedly made the resolver shard stale");
}

if (getParserNamespace(registry, TOUCHED_ENTRY) !== null) {
  throw new Error("cold-shard probe: touched parser shard was served compiled despite its stale body");
}
const namespace = getParserNamespace(registry, UNTOUCHED_ENTRY);
const compiledEntry = namespace?.defaultFixityTable;
if (typeof compiledEntry !== "function") {
  throw new Error("cold-shard probe: untouched parser shard was not served compiled");
}
const value = compiledEntry();
if (!Array.isArray(value) || value.length === 0) {
  throw new Error("cold-shard probe: untouched compiled entry returned an invalid fixity table");
}
const resolverNamespace = getResolverNamespace(registry, RESOLVER_ENTRY);
if (typeof resolverNamespace?.rsvResolveBareName !== "function") {
  throw new Error("cold-shard probe: resolver shard was not served compiled after the unrelated engine edit");
}

console.log("PHASE4B_COLD_SHARD_PROBE " + JSON.stringify({
  editedBeforeRegistry,
  touchedStale: true,
  untouchedServedCompiled: true,
  resolverServedCompiled: true,
  fixityRows: value.length,
}));
