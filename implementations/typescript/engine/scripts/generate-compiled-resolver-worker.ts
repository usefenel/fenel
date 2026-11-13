/**
 * Generate `src/generated/compiled-resolver.generated.ts` — the compiled-RESOLVER
 * PERFORMANCE BRANCH for resolution-substrate Phase 5.2.
 *
 * The Fenel bare-name dispatch resolver's entry (`dispatch:rsvResolveBareName`)
 * + its transitive Fenel-bodied closure (19 fns — the entry, 17 `rsv*`
 * helpers, and `std:$`) are lowered to JS once by the SHIPPED self-host pipeline
 * (compileFenelToJsNative → serializeJsModule, all Fenel-bodied) and checked in
 * as data-as-code. The runtime hook in engine-bodies-dispatch.ts serves the
 * compiled path ONLY when the embedded entry-shard manifest hash matches the
 * live registry bodies (a stale shard ⇒ interpreted fallback). The retained
 * whole-artifact hash is a transition cross-check.
 *
 * This is the CLAUDE.md opaque-repr-for-functions pattern (the compiled-parser
 * precedent): the `.fenel` `dispatch.fenel` bodies stay the registry bodies +
 * source of truth; this artifact is GENERATED from them. It is NOT a natives-map
 * shadow. The Phase-5.4 bare-name and qualified-method callers use this path.
 *
 * Run:
 *   bun implementations/typescript/engine/scripts/generate-compiled-resolver.ts
 *   bun implementations/typescript/engine/scripts/generate-compiled-resolver.ts --check
 *
 * `--check` re-generates in-memory and diffs against the committed file, exiting
 * non-zero on drift (CI mode — the matrix / codename-lock / compiled-parser
 * precedent).
 */

import type { CompileSource } from "../src/compilable";
import type { CompiledIdentityDomain } from "./lib/compiled-artifact-identity-domain";
import type { ColdSourceProjectionRequest } from "./lib/compiled-artifact-cold-projection-protocol";
import { encodeColdSourceObservation } from "./lib/compiled-artifact-cold-projection-protocol";
import { encodeProducerObservation, encodePreparationContractObservation } from "./lib/compiled-artifact-producer-observation";
import {
  prepareCompileSource,
  capturePreparedCompileCell,
  preparedCompileSourceAttempts,
  immutablePreparationMetadata,
  encodePreparationObservation,
  type PreparedCompileCell,
  type PreparedCompiledArtifact,
} from "./lib/compiled-artifact-preparation";

type BuildDependencies = {
  readonly inputPolicy: typeof import("../src/owner-input-policy-evaluator");
  readonly identityDomains: typeof import("../src/repository-compiled-identity-domain");
  readonly provenance: typeof import("../src/owner-input-provenance");
  readonly repositoryRegistry: typeof import("../src/repository-registry");
  readonly registry: typeof import("../src/registry");
  readonly std: typeof import("../src/modules/std");
  readonly engine: typeof import("../src/modules/engine");
  readonly dispatchModule: typeof import("../src/modules/dispatch");
  readonly locale: typeof import("../src/modules/locale");
  readonly targetEntities: typeof import("../src/modules/compiler-target-entities");
  readonly compileJs: typeof import("../src/modules/compile-js");
  readonly dispatch: typeof import("../src/engine-bodies-dispatch");
  readonly fieldSlots: typeof import("../src/compile-field-slots");
  readonly callBindings: typeof import("../src/compile-call-bindings");
  readonly metadata: typeof import("../src/compiler-metadata-view");
  readonly effects: typeof import("../src/effect-bootstrap-helpers");
  readonly parseCache: typeof import("../src/parse-cache");
  readonly immutable: typeof import("../src/self-host-immutable-data");
  readonly transport: typeof import("../src/engine-body-value-transport");
};

export async function runCompiledResolverColdInputWorkerMain(request: ColdSourceProjectionRequest): Promise<void> {
  const { observeColdCanonicalModule } = await import("../src/owner-input-cold-projection");
  process.stdout.write(new TextDecoder().decode(encodeColdSourceObservation(await observeColdCanonicalModule(request))));
}

function reportProgress(stage: string, detail = ""): void {
  console.error(
    `[compiled-resolver:progress] ${stage}${detail.length === 0 ? "" : ` — ${detail}`}`,
  );
}

async function loadBuildDependencies(): Promise<BuildDependencies> {
  reportProgress("imports: start");
  const provenance = await import("../src/owner-input-provenance");
  const repositoryRegistry = await import("../src/repository-registry");
  const registry = await import("../src/registry");
  const std = await import("../src/modules/std");
  const engine = await import("../src/modules/engine");
  const dispatchModule = await import("../src/modules/dispatch");
  const locale = await import("../src/modules/locale");
  const targetEntities = await import("../src/modules/compiler-target-entities");
  reportProgress("imports: source modules ready");
  const compileJs = await import("../src/modules/compile-js");
  const dispatch = await import("../src/engine-bodies-dispatch");
  const fieldSlots = await import("../src/compile-field-slots");
  const callBindings = await import("../src/compile-call-bindings");
  const metadata = await import("../src/compiler-metadata-view");
  const effects = await import("../src/effect-bootstrap-helpers");
  const parseCache = await import("../src/parse-cache");
  const immutable = await import("../src/self-host-immutable-data");
  const transport = await import("../src/engine-body-value-transport");
  const identityDomains = await import("../src/repository-compiled-identity-domain");
  const inputPolicy = await import("../src/owner-input-policy-evaluator");
  reportProgress("imports: compiler support ready");
  return {
    inputPolicy,
    identityDomains,
    provenance,
    repositoryRegistry,
    registry,
    std,
    engine,
    dispatchModule,
    locale,
    targetEntities,
    compileJs,
    dispatch,
    fieldSlots,
    callBindings,
    metadata,
    effects,
    parseCache,
    immutable,
    transport,
  };
}

function withCompiledRecoveryControls<T>(
  dependencies: BuildDependencies,
  operation: (() => T) & (
    Extract<T, PromiseLike<unknown>> extends never ? unknown : never
  ),
): T {
  const previousCache = dependencies.parseCache.parseCacheEnabled();
  const previousLegacy = dependencies.parseCache.fenelParserLegacy();
  dependencies.parseCache.setParseCacheEnabled(false);
  dependencies.parseCache.setFenelParserLegacy(true);
  try {
    if (
      dependencies.parseCache.parseCacheEnabled()
      || !dependencies.parseCache.fenelParserLegacy()
    ) {
      throw new Error("compiled-resolver recovery controls were not installed");
    }
    return dependencies.dispatch.withInterpretedCompiledArtifacts(operation);
  } finally {
    dependencies.parseCache.setFenelParserLegacy(previousLegacy);
    dependencies.parseCache.setParseCacheEnabled(previousCache);
    if (
      dependencies.parseCache.parseCacheEnabled() !== previousCache
      || dependencies.parseCache.fenelParserLegacy() !== previousLegacy
    ) {
      throw new Error("compiled-resolver recovery controls were not restored");
    }
  }
}

// The runtime contract — every native the compiled bodies may reference. This is
// exactly the set `resolverBaseRuntime()` (engine-bodies-dispatch.ts) supplies:
// the parser base natives + the resolver-only non-string `is*`
// value-shape predicates (`isString` is shared with the parser source binder).
// The generator HARD-FAILS if the closure references anything outside it — a new
// native must be added to the runtime deliberately, never silently.
const KNOWN_RESOLVER_NATIVES = new Set<string>([
  "$structuralTruthy", "and", "or", "std:and", "std:or",
  // parser base runtime (parserBaseRuntime)
  "appendItem", "at", "charFromCode", "chars", "concat", "elem", "filter",
  "fromEntries", "hasOwn", "head", "isString", "length", "map", "mapGet", "mapSet", "matchFail",
  "slice", "startsWith", "tail", "toNumber", "toString",
  // resolver-only additions (the typeConstructorOf JS-shape discrimination)
  "isArray", "isBoolean", "isBytes", "isNumber",
]);

// The resolver closure emits every constructor as a `{$tag,…}` object literal
// (verified by the Step-0 probe: 0 bare ctor values), so — unlike the parser —
// it needs NO nullary-ctor `$ns` bindings. The generator asserts NO bare
// Capitalized identifier escapes (a new one would be a missing ctor binding).
const KNOWN_CTOR_BINDINGS = new Set<string>([]);

const shortCode = (id: string): string => (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);

/** C2 preparation only. This is not a complete reusable-input certificate. */
function prepareCompiledResolverInsideRecovery(
  dependencies: BuildDependencies,
): PreparedCompiledArtifact {

  // This generator replaces the resolver artifact whose stale predecessor
  // cannot authorize changing registry/metadata/compiler input stamps. Treat
  // registry construction through emission as one finite interpreted proof,
  // then restore ordinary dispatch before the generated artifact is consumed.
  const {
    createRepositoryRegistry,
  } = dependencies.repositoryRegistry;
  const { createEngineBootstrapRegistry } = dependencies.registry;
  const { stdModule } = dependencies.std;
  const { engineModule } = dependencies.engine;
  const { dispatchModule } = dependencies.dispatchModule;
  const { localeModule } = dependencies.locale;
  const { COMPILER_TARGET_ENTITY_MODULES } = dependencies.targetEntities;
  const {
    computeResolverClosureIds,
    computeResolverEntryClosureIds,
    compiledArtifactBootstrapRuntimeInputHash,
    compiledArtifactRuntimeInputHash,
    compiledArtifactManifestHashesForBuild,
    RESOLVER_ENTRY_FN_IDS,
    RESOLVER_COMPILED_NATIVE_OVERRIDE_FN_IDS,
  } = dependencies.dispatch;
  const {
    compileConstructorSlotTable,
    compileConstructorSlotConflicts,
    compileConstructorWireNames,
    compileFunctionParamSlots,
    compileFunctionTypeOwnerIds,
  } = dependencies.fieldSlots;
  const { compileCallBindingsByFnId } = dependencies.callBindings;
  const { getRepositoryCompilerConstructorMetadataView } = dependencies.metadata;
  const { constraintsToRequiresStrings } = dependencies.effects;
  reportProgress("repository registry: start");
  const reg = createRepositoryRegistry(dependencies.provenance.observeOwnerModuleRoleInput("primary", "compiled-resolver/primary", [
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ]));
  reportProgress("repository registry: ready");
  const bootstrapReg = createEngineBootstrapRegistry(dependencies.provenance.observeOwnerModuleRoleInput("bootstrap", "compiled-resolver/bootstrap", [
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ]));
  reportProgress("bootstrap registry: ready");
  const closureIds = computeResolverClosureIds(reg);
  const bootstrapClosureIds = computeResolverClosureIds(bootstrapReg);
  if (JSON.stringify(bootstrapClosureIds) !== JSON.stringify(closureIds)) {
    throw new Error(
      "compiled-resolver: authoritative/bootstrap whole closures differ",
    );
  }
  reportProgress("resolver closure: ready", `${closureIds.length} functions`);
  reportProgress("resolver manifest inputs: start");
  const manifestHashes = compiledArtifactManifestHashesForBuild("resolver", reg);
  if (manifestHashes === null) {
    throw new Error("compiled-resolver: Node hashing is unavailable");
  }
  reportProgress("resolver manifest inputs: ready");
  const shards = Object.create(null) as Record<string, {
    closureIds: string[];
    manifestHash: string;
    runtimeInputHash: string;
    bootstrapRuntimeInputHash: string;
  }>;
  const shardUnion = new Set<string>();
  for (const entryFnId of RESOLVER_ENTRY_FN_IDS) {
    const shardClosureIds = computeResolverEntryClosureIds(reg, entryFnId);
    const bootstrapShardClosureIds = computeResolverEntryClosureIds(
      bootstrapReg,
      entryFnId,
    );
    if (JSON.stringify(bootstrapShardClosureIds) !== JSON.stringify(shardClosureIds)) {
      throw new Error(
        `compiled-resolver: authoritative/bootstrap closures differ for ${entryFnId}`,
      );
    }
    for (const id of shardClosureIds) shardUnion.add(id);
    const manifestHash = manifestHashes.shards[entryFnId];
    if (manifestHash === undefined) {
      throw new Error(`compiled-resolver: Node shard hashing is unavailable for ${entryFnId}`);
    }
    const shardRuntimeInputHash = compiledArtifactRuntimeInputHash(
      "resolver",
      reg,
      entryFnId,
    );
    if (shardRuntimeInputHash === null) {
      throw new Error(`compiled-resolver: Node shard runtime-input hashing is unavailable for ${entryFnId}`);
    }
    const shardBootstrapRuntimeInputHash = compiledArtifactBootstrapRuntimeInputHash(
      "resolver",
      bootstrapReg,
      manifestHash,
      entryFnId,
    );
    if (shardBootstrapRuntimeInputHash === null) {
      throw new Error(`compiled-resolver: Node shard bootstrap runtime-input hashing is unavailable for ${entryFnId}`);
    }
    shards[entryFnId] = {
      closureIds: shardClosureIds,
      manifestHash,
      runtimeInputHash: shardRuntimeInputHash,
      bootstrapRuntimeInputHash: shardBootstrapRuntimeInputHash,
    };
    reportProgress(
      "resolver shard manifest: ready",
      `${entryFnId} (${shardClosureIds.length} functions)`,
    );
  }
  const unionClosureIds = [...shardUnion].sort();
  if (JSON.stringify(unionClosureIds) !== JSON.stringify(closureIds)) {
    throw new Error(
      "compiled-resolver: per-entry shard union differs from the whole-artifact closure",
    );
  }
  const hash = manifestHashes.manifestHash;
  const runtimeInputHash = compiledArtifactRuntimeInputHash("resolver", reg);
  if (runtimeInputHash === null) {
    throw new Error("compiled-resolver: Node runtime-input hashing is unavailable");
  }
  const bootstrapRuntimeInputHash = compiledArtifactBootstrapRuntimeInputHash(
    "resolver",
    bootstrapReg,
    hash,
  );
  if (bootstrapRuntimeInputHash === null) {
    throw new Error("compiled-resolver: Node bootstrap runtime-input hashing is unavailable");
  }
  reportProgress("resolver manifest: ready", hash);
  reportProgress("compiler metadata: start");
  const compilerMetadata = getRepositoryCompilerConstructorMetadataView();
  reportProgress("compiler metadata: ready");
  const callBindingsByFnId = compileCallBindingsByFnId([
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
  ]);
  reportProgress("call bindings: ready", `${callBindingsByFnId.size} functions`);
  const ctorDefsByOwnerKey = new Map<string, ReturnType<typeof compileConstructorSlotTable>>();

  // The loader ABI is short-code keyed. Reject collisions before compiling so
  // exact owners can never be hidden by record assignment order.
  const ownerByCode = new Map<string, string>();
  for (const id of closureIds) {
    const code = shortCode(id);
    const prior = ownerByCode.get(code);
    if (prior !== undefined && prior !== id) {
      throw new Error(`compiled-resolver: short-code collision ${JSON.stringify(code)} for ${prior}/${id}`);
    }
    ownerByCode.set(code, id);
  }
  const allowedNativeOverrides = new Set<string>(RESOLVER_COMPILED_NATIVE_OVERRIDE_FN_IDS);
  for (const id of allowedNativeOverrides) {
    if (!closureIds.includes(id)) {
      throw new Error(`compiled-resolver: stale native-override policy for absent closure id ${id}`);
    }
  }
  for (const id of closureIds) {
    const code = shortCode(id);
    const collidesWithNative = KNOWN_RESOLVER_NATIVES.has(code);
    const collidesWithCtorBinding = KNOWN_CTOR_BINDINGS.has(code);
    if (allowedNativeOverrides.has(id)) {
      if (!collidesWithNative || collidesWithCtorBinding) {
        throw new Error(`compiled-resolver: invalid native-override policy for ${id}`);
      }
    } else if (collidesWithNative || collidesWithCtorBinding) {
      throw new Error(`compiled-resolver: unapproved closure/runtime collision ${id} (${code})`);
    }
  }

  const cells: PreparedCompileCell[] = [];
  for (let closureIndex = 0; closureIndex < closureIds.length; closureIndex += 1) {
    const id = closureIds[closureIndex]!;
    reportProgress("prepare source: start", `${closureIndex + 1}/${closureIds.length} ${id}`);
    // The strict artifact registry owns the effective function/scheme for this
    // exact resolver topology. Repository-wide metadata supplies only the
    // complete constructor/Field identity union below.
    const cell = capturePreparedCompileCell(id, () => {
      const fn = reg.getIdentifiedFunction(id);
      if (fn === undefined || fn.id !== id || fn.body === undefined) {
        return `${id}: no exact identified compiler definition / body`;
      }
      const preferredOwnerIds = compileFunctionTypeOwnerIds(fn);
      const ownerKey = preferredOwnerIds.join("\0");
      let ctorDefs = ctorDefsByOwnerKey.get(ownerKey);
      if (ctorDefs === undefined) {
        ctorDefs = compileConstructorSlotTable(compilerMetadata, { preferredOwnerIds });
        ctorDefsByOwnerKey.set(ownerKey, ctorDefs);
      }
      const callBindings = callBindingsByFnId.get(id);
      if (callBindings === undefined) {
        return `${id}: no immutable defining-module call bindings`;
      }
      const requires = fn.requires ?? [];
      const source: CompileSource = {
        name: id,
        params: compileFunctionParamSlots(fn),
        body: fn.body,
        ctorDefs,
        ctorWireNames: compileConstructorWireNames(ctorDefs),
        callBindings,
        ...(requires.length === 0 ? {} : { requires: constraintsToRequiresStrings(requires) }),
      };
      return prepareCompileSource(source, compileConstructorSlotConflicts(ctorDefs),
        dependencies.immutable.exactImmutableDataSnapshot, dependencies.callBindings.isCompilerOwnedCallBindings);
    });
    cells.push(cell);
    if (cell.status === "threw") break;
  }
  const entryCodes = Object.create(null) as Record<string, string>;
  for (const id of RESOLVER_ENTRY_FN_IDS) entryCodes[id] = shortCode(id);
  return Object.freeze({
    artifact: "compiled-resolver" as const,
    metadata: immutablePreparationMetadata({
      identityDomain: dependencies.identityDomains.compiledIdentityInput("resolver").domain,
      hash, runtimeInputHash, bootstrapRuntimeInputHash, entryCodes, closureIds, shards,
    }, dependencies.immutable.exactImmutableDataSnapshot),
    cells: Object.freeze(cells),
  });
}

function compilePreparedResolver(
  dependencies: BuildDependencies,
  prepared: PreparedCompiledArtifact,
): {
  identityDomain: PreparedCompiledArtifact["metadata"]["identityDomain"];
  hash: string;
  runtimeInputHash: string;
  bootstrapRuntimeInputHash: string;
  entryCodes: Readonly<Record<string, string>>;
  closureIds: readonly string[];
  shards: PreparedCompiledArtifact["metadata"]["shards"];
  bodies: Record<string, string>;
  requiredNatives: string[];
} {
  const { hash, runtimeInputHash, bootstrapRuntimeInputHash, entryCodes, closureIds, shards } = prepared.metadata;
  const { compileFenelToJsNative } = dependencies.compileJs;
  const { dispatchedSerializeJsModule } = dependencies.dispatch;
  const bodies = Object.create(null) as Record<string, string>;
  const failures: string[] = [];
  const attempts = preparedCompileSourceAttempts(prepared.cells, failures,
    (id, closureIndex) => reportProgress("compile: start", `${closureIndex + 1}/${closureIds.length} ${id}`));
  for (const [closureIndex, input] of attempts) {
    const { name: id } = input.source;
    const source = input.source;
    const code = shortCode(id);
    const compiled = compileFenelToJsNative(source);
    if (compiled.$tag === "Err") {
      failures.push(`${id}: compile — ${JSON.stringify(compiled._0).slice(0, 160)}`);
      continue;
    }
    if (compiled._0.name !== id) {
      failures.push(`${id}: compiler returned mismatched module id ${JSON.stringify(compiled._0.name)}`);
      continue;
    }
    const serialised = dispatchedSerializeJsModule(compiled._0);
    if (serialised.$tag === "Err") {
      failures.push(`${id}: serialise — ${serialised._0}`);
      continue;
    }
    bodies[code] = serialised._0;
    reportProgress("compile: ready", `${closureIndex + 1}/${closureIds.length} ${id}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `compiled-resolver: ${failures.length} closure fn(s) failed to compile — the artifact cannot be generated:\n  ${failures.join("\n  ")}`,
    );
  }

  // Validate the runtime contract: every $fenel.X ref is a closure fn or a KNOWN
  // native; every bare Capitalized ref (string-literal contents stripped first)
  // is a closure fn or a KNOWN ctor binding.
  const closureCodes = new Set(closureIds.map(shortCode));
  const refNative = /\$fenel\.([A-Za-z_$][\w$]*)/g;
  const stripStrings = (s: string): string => s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  const requiredNatives = new Set<string>();
  const unknownNatives = new Set<string>();
  const unknownFullIds = new Set<string>();
  const genuineCtors = new Set<string>();
  const closureIdSet = new Set(closureIds);
  for (const src of Object.values(bodies)) {
    let m: RegExpExecArray | null;
    while ((m = refNative.exec(src)) !== null) {
      const n = m[1]!;
      if (closureCodes.has(n)) continue;
      requiredNatives.add(n);
      if (!KNOWN_RESOLVER_NATIVES.has(n)) unknownNatives.add(n);
    }
    const refBracket = /\$fenel\[("(?:\\.|[^"\\])*")\]/g;
    while ((m = refBracket.exec(src)) !== null) {
      const n = JSON.parse(m[1]!) as string;
      if (closureIdSet.has(n) || closureCodes.has(n)) continue;
      if (n.includes(":")) {
        unknownFullIds.add(n);
        continue;
      }
      requiredNatives.add(n);
      if (!KNOWN_RESOLVER_NATIVES.has(n)) unknownNatives.add(n);
    }
    const bare = stripStrings(src);
    const r = /(?<![\w.$])([A-Z][A-Za-z0-9_]*)\b/g;
    while ((m = r.exec(bare)) !== null) {
      const n = m[1]!;
      if (closureCodes.has(n) || KNOWN_CTOR_BINDINGS.has(n)) continue;
      genuineCtors.add(n);
    }
  }
  if (unknownNatives.size > 0) {
    throw new Error(
      `compiled-resolver: closure references native(s) not in the runtime contract: ${[...unknownNatives].sort().join(", ")} — add them to resolverBaseRuntime() in engine-bodies-dispatch.ts (and KNOWN_RESOLVER_NATIVES here).`,
    );
  }
  if (unknownFullIds.size > 0) {
    throw new Error(
      `compiled-resolver: emitted canonical runtime ref(s) absent from the exact closure: ${[...unknownFullIds].sort().join(", ")}`,
    );
  }
  if (genuineCtors.size > 0) {
    throw new Error(
      `compiled-resolver: closure emits bare constructor value(s) not in the runtime contract: ${[...genuineCtors].sort().join(", ")} — add a binding to the $ns runtime in engine-bodies-dispatch.ts (and KNOWN_CTOR_BINDINGS here).`,
    );
  }

  reportProgress("runtime contract: ready", `${requiredNatives.size} natives`);

  return {
    identityDomain: prepared.metadata.identityDomain,
    hash,
    runtimeInputHash,
    bootstrapRuntimeInputHash,
    entryCodes,
    closureIds,
    shards,
    bodies,
    requiredNatives: [...requiredNatives].sort(),
  };
}

export function prepareCompiledResolver(dependencies: BuildDependencies): PreparedCompiledArtifact {
  return withCompiledRecoveryControls(dependencies, () => prepareCompiledResolverInsideRecovery(dependencies));
}

export function buildCompiledResolver(dependencies: BuildDependencies,
  observePrepared?: (prepared: PreparedCompiledArtifact) => void): ReturnType<typeof compilePreparedResolver> {
  return withCompiledRecoveryControls(dependencies, () => {
    const prepared = prepareCompiledResolverInsideRecovery(dependencies);
    observePrepared?.(prepared);
    return compilePreparedResolver(dependencies, prepared);
  });
}

export async function runCompiledResolverObservedWorkerMain(contract: "all" | "entity-envelope",
  requestedDomain?: CompiledIdentityDomain, operation: "render" | "prepare" = "render",
  policySource?: string): Promise<void> {
  if (operation !== "render" && operation !== "prepare") throw new Error("unknown resolver producer observation operation");
  const { beginOwnerProducerInputScope } = await import("../src/owner-input-producer-state");
  const scope = beginOwnerProducerInputScope(contract);
  let recording: ReturnType<typeof import("../src/owner-input-provenance")["beginOwnerModuleProvenanceRecording"]> | undefined;
  let recordingClosed = false;
  let scopeClosed = false;
  try {
    const provenance = await import("../src/owner-input-provenance");
    recording = provenance.beginOwnerModuleProvenanceRecording();
    const dependencies = await loadBuildDependencies();
    const domain = requestedDomain === undefined
      ? dependencies.identityDomains.allCompiledIdentityDomain("compiled-resolver")
      : dependencies.identityDomains.resolveRepositoryCompiledIdentityDomain(requestedDomain, "compiled-resolver").domain;
    if (contract === "all" && domain.kind !== "all") throw new Error("broad resolver producer cannot inherit an owner identity domain");
    let actualPrepared: PreparedCompiledArtifact | undefined;
    const bytes = dependencies.identityDomains.withCompiledIdentityDomain(domain, () => {
      if (operation === "prepare") {
        actualPrepared = prepareCompiledResolver(dependencies);
        return undefined;
      }
      const built = buildCompiledResolver(dependencies, prepared => { actualPrepared = prepared; });
      return new TextEncoder().encode(renderCompiledResolver(built));
    });
    if (actualPrepared === undefined) throw new Error("full resolver producer did not expose its actual prepared inputs");
    const compileInputsPacket = encodePreparationObservation(actualPrepared, dependencies.transport.encodeReplayValue);
    const sourceEnvelopes = policySource === undefined ? [] : recording.canonicalEnvelopes(
      (await dependencies.inputPolicy.loadOwnerInputPolicy(policySource)).invoke("ownerinputpolicy:ownerEntityInputFields", []));
    recordingClosed = true;
    const roles = recording.finish();
    scopeClosed = true;
    const observedScope = scope.finish();
    if (operation === "prepare") {
      process.stdout.write(new TextDecoder().decode(encodePreparationContractObservation({
        schema: "fenel.compiled-artifact-preparation-contract-observation.v1", artifact: "compiled-resolver", authority: "NONE",
        contract, catalogueAttempts: observedScope.catalogueAttempts, catalogueAttemptDoors: observedScope.catalogueAttemptDoors,
        compileInputsPacket, sourceRolesTransport: dependencies.transport.encodeReplayValue(roles),
      })));
      return;
    }
    if (bytes === undefined) throw new Error("resolver render observation has no actual artifact bytes");
    process.stdout.write(new TextDecoder().decode(encodeProducerObservation({
      schema: "fenel.compiled-artifact-producer-observation.v1", artifact: "compiled-resolver", authority: "NONE",
      contract, identityDomainEstablished: false, catalogueAttempts: observedScope.catalogueAttempts,
      bytesBase64: Buffer.from(bytes).toString("base64"), compileInputsPacket,
      sourceRolesTransport: dependencies.transport.encodeReplayValue(roles),
      sourceEnvelopesTransport: dependencies.transport.encodeReplayValue(sourceEnvelopes),
    })));
  } finally {
    try { if (!recordingClosed) recording?.finish(); }
    finally { if (!scopeClosed) scope.finish(); }
  }
}

export async function runCompiledResolverPreparationContractWorkerMain(): Promise<void> {
  await runCompiledResolverObservedWorkerMain("entity-envelope", undefined, "prepare");
}

/** Invoked only by a controller-selected immutable bootstrap; never a freshness verdict. */
export async function runCompiledResolverPreparationWorkerMain(): Promise<void> {
  if (process.argv.slice(2).length !== 0) throw new Error("compiled preparation worker accepts no arguments");
  const dependencies = await loadBuildDependencies();
  const prepared = prepareCompiledResolver(dependencies);
  process.stdout.write(encodePreparationObservation(prepared, dependencies.transport.encodeReplayValue));
}

export function renderCompiledResolver(
  b: ReturnType<typeof buildCompiledResolver>,
): string {
  const sortedCodes = Object.keys(b.bodies).sort();
  const bodyLines = sortedCodes.map((c) => `    [${JSON.stringify(c)}, ${JSON.stringify(b.bodies[c])}],`);
  const entryLines = Object.entries(b.entryCodes).map(([id, c]) => `    [${JSON.stringify(id)}, ${JSON.stringify(c)}],`);
  const shardLines = Object.entries(b.shards).map(([id, shard]) =>
    `    [${JSON.stringify(id)}, Object.freeze({ identityDomain: RESOLVER_IDENTITY_DOMAIN, closureIds: Object.freeze(${JSON.stringify(shard.closureIds)}), manifestHash: ${JSON.stringify(shard.manifestHash)}, runtimeInputHash: ${JSON.stringify(shard.runtimeInputHash)}, bootstrapRuntimeInputHash: ${JSON.stringify(shard.bootstrapRuntimeInputHash)} })],`
  );
  return `// GENERATED by scripts/generate-compiled-resolver.ts — DO NOT EDIT.
//
// resolution-substrate Phase 5.2 — the compiled-resolver performance branch.
// Each entry below is the JS lowering (shipped self-host pipeline) of a Fenel
// bare-name dispatch resolver body; the runtime hook in engine-bodies-dispatch.ts
// builds the namespace + serves each entry ONLY when its RESOLVER_SHARDS digest
// matches the live registry bodies. Scalar hashes remain whole-artifact
// cross-checks. Regenerate with the script above after any edit to
// the resolver \`.fenel\` sources (\`fenel/modules/engine/dispatch.fenel\` — the
// \`rsv*\` closure) or to the compile pipeline.
/* eslint-disable */

/** Whole-artifact digest retained as a transition cross-check. */
export const RESOLVER_MANIFEST_HASH = ${JSON.stringify(b.hash)};

export const RESOLVER_IDENTITY_DOMAIN = Object.freeze(${JSON.stringify(b.identityDomain)});

/** Whole-artifact runtime certificate retained as a transition cross-check. */
export const RESOLVER_RUNTIME_INPUT_HASH = ${JSON.stringify(b.runtimeInputHash)};

/** Whole-artifact certificate for private engine-bootstrap registries. */
export const RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH = ${JSON.stringify(b.bootstrapRuntimeInputHash)};

/** Per-entry freshness shards. Each closure is independently hash-gated. */
export const RESOLVER_SHARDS: Readonly<Record<string, Readonly<{
  identityDomain: typeof RESOLVER_IDENTITY_DOMAIN;
  closureIds: readonly string[];
  manifestHash: string;
  runtimeInputHash: string;
  bootstrapRuntimeInputHash: string;
}>>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, Readonly<{
    identityDomain: typeof RESOLVER_IDENTITY_DOMAIN;
    closureIds: readonly string[];
    manifestHash: string;
    runtimeInputHash: string;
    bootstrapRuntimeInputHash: string;
  }>>,
  Object.fromEntries([
${shardLines.join("\n")}
  ]),
));

/** The resolver entry fn-ids → their codeName (the namespace keys below). */
export const RESOLVER_ENTRY_CODES: Readonly<Record<string, string>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, string>,
  Object.fromEntries([
${entryLines.join("\n")}
  ]),
));

/** The transitive closure fn-ids (for reference / the manifest contract). */
export const RESOLVER_CLOSURE_IDS: readonly string[] = Object.freeze(${JSON.stringify(b.closureIds, null, 0)});

/** Base-runtime native names the compiled bodies reference (the $ns runtime must supply each). */
export const RESOLVER_REQUIRED_NATIVES: readonly string[] = Object.freeze(${JSON.stringify(b.requiredNatives, null, 0)});

/** codeName → serialized JS function expression (closes over the $ns namespace). */
export const RESOLVER_FN_BODIES: Readonly<Record<string, string>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, string>,
  Object.fromEntries([
${bodyLines.join("\n")}
  ]),
));
`;
}

export async function renderCompiledResolverBytes(): Promise<Uint8Array> {
  const dependencies = await loadBuildDependencies();
  const rendered = renderCompiledResolver(buildCompiledResolver(dependencies));
  if (!rendered.endsWith("\n") || rendered.includes("\r")) {
    throw new Error("compiled-resolver render must be exact UTF-8 LF bytes");
  }
  return new TextEncoder().encode(rendered);
}

export async function runCompiledResolverWorkerMain(): Promise<void> {
  const unknown = process.argv.slice(2);
  if (unknown.length !== 0) {
    console.error(`[compiled-resolver-worker] unexpected arguments: ${unknown.join(" ")}`);
    throw new Error("compiled-resolver worker accepts no arguments");
  }
  const bytes = await renderCompiledResolverBytes();
  process.stdout.write(`${JSON.stringify({
    schema: "fenel.compiled-artifact-render.v1",
    artifact: "compiled-resolver",
    bytesBase64: Buffer.from(bytes).toString("base64"),
  })}\n`);
}

if (import.meta.main) await runCompiledResolverWorkerMain();
