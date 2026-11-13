// SUBSTRATE
/** Process-local memoization for the executable self-host observation seam.
 *
 * A matrix row is keyed by canonical fnId. Repeated module projections may
 * enumerate the same fnId more than once, but compiling or executing it again
 * cannot add evidence: it only burns toolchain time and lets stateful samples
 * observe a different process state. These helpers make the exactly-once
 * boundary explicit without consulting expected-gap declarations. */

import {
  exactImmutableDataEqual,
  exactImmutableDataSnapshot,
} from "./self-host-immutable-data";
import {
  assertExactRepositoryFunctionNamespaceAgreement,
  exactRepositoryFunctionNamespacePolicy,
} from "./compiler-metadata-view";

export function memoizeFnIdClassification<Result>(
  classify: (fnId: string) => Result,
): (fnId: string) => Result {
  const results = new Map<string, Result>();
  return (fnId) => {
    if (results.has(fnId)) return results.get(fnId)!;
    const result = classify(fnId);
    results.set(fnId, result);
    return result;
  };
}

export function memoizeAsyncFnIdClassification<Result>(
  classify: (fnId: string) => Promise<Result>,
): (fnId: string) => Promise<Result> {
  const results = new Map<string, Promise<Result>>();
  return (fnId) => {
    const cached = results.get(fnId);
    if (cached !== undefined) return cached;
    // Cache the in-flight promise before yielding so concurrent callers also
    // share one compiler/runtime observation.
    const result = classify(fnId);
    results.set(fnId, result);
    return result;
  };
}

export type ClassificationBatchProgress<Result> =
  | {
      readonly phase: "start";
      readonly fnId: string;
      readonly index: number;
      readonly total: number;
    }
  | {
      readonly phase: "complete";
      readonly fnId: string;
      readonly index: number;
      readonly total: number;
      readonly elapsedMs: number;
      readonly result: Result;
    };

export type ClassificationBatchOptions<Result> = {
  readonly onProgress?: (event: ClassificationBatchProgress<Result>) => void;
};

export function classifyFnIdsOnce<Result>(
  fnIds: Iterable<string>,
  classify: (fnId: string) => Result,
  options: ClassificationBatchOptions<Result> = {},
): ReadonlyMap<string, Result> {
  const out = new Map<string, Result>();
  const uniqueFnIds = [...new Set(fnIds)];
  for (let index = 0; index < uniqueFnIds.length; index += 1) {
    const fnId = uniqueFnIds[index]!;
    options.onProgress?.({ phase: "start", fnId, index, total: uniqueFnIds.length });
    const startedAt = performance.now();
    const result = classify(fnId);
    out.set(fnId, result);
    options.onProgress?.({
      phase: "complete",
      fnId,
      index,
      total: uniqueFnIds.length,
      elapsedMs: performance.now() - startedAt,
      result,
    });
  }
  return out;
}

export async function classifyFnIdsOnceAsync<Result>(
  fnIds: Iterable<string>,
  classify: (fnId: string) => Promise<Result>,
  options: ClassificationBatchOptions<Result> = {},
): Promise<ReadonlyMap<string, Result>> {
  const out = new Map<string, Result>();
  const uniqueFnIds = [...new Set(fnIds)];
  // Deliberately sequential inside one target: effect samples and native
  // toolchains own process-global state. Batching deduplicates; it does not
  // invent unsafe concurrency.
  for (let index = 0; index < uniqueFnIds.length; index += 1) {
    const fnId = uniqueFnIds[index]!;
    options.onProgress?.({ phase: "start", fnId, index, total: uniqueFnIds.length });
    const startedAt = performance.now();
    const result = await classify(fnId);
    out.set(fnId, result);
    options.onProgress?.({
      phase: "complete",
      fnId,
      index,
      total: uniqueFnIds.length,
      elapsedMs: performance.now() - startedAt,
      result,
    });
  }
  return out;
}

export type SelfHostCandidateModule<T> = {
  readonly name: string;
  readonly functionNamespace?: string;
  readonly functionNamespaceOverrides?: readonly {
    readonly functionId: string;
    readonly namespace: string;
  }[];
  readonly functions?: readonly T[];
};

export type OwnedFnIdDefinition<T> = {
  readonly moduleName: string;
  readonly functionNamespace: string;
  readonly fnId: string;
  readonly definition: T;
};

export type SelfHostCandidateIndex<T> = {
  /** The one accepted definition for each canonical fnId, with its defining
   * module retained as part of the selection fact. */
  readonly ownedDefinitions: readonly OwnedFnIdDefinition<T>[];
  /** Compatibility projection consumed by the existing matrix/test surfaces. */
  readonly definitions: readonly T[];
  /** Exact fnId lookup. Cross-module duplicates are rejected before this map is
   * constructed, so lookup cannot acquire first/last-module-wins meaning. */
  readonly byFnId: ReadonlyMap<string, OwnedFnIdDefinition<T>>;
};

function ownDataValue(
  object: object,
  key: PropertyKey,
  context: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    throw new Error(`${context} has no own ${String(key)} data`);
  }
  if (!("value" in descriptor)) {
    throw new Error(`${context}.${String(key)} must not be an accessor`);
  }
  return descriptor.value;
}

function ownStringData(
  object: object,
  key: PropertyKey,
  context: string,
): string {
  const value = ownDataValue(object, key, context);
  if (typeof value !== "string") {
    throw new Error(`${context}.${String(key)} must be a string`);
  }
  return value;
}

function optionalOwnDataValue(
  object: object,
  key: PropertyKey,
  context: string,
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    if (key in object) {
      throw new Error(`${context}.${String(key)} must not be inherited`);
    }
    return { present: false };
  }
  if (!("value" in descriptor)) {
    throw new Error(`${context}.${String(key)} must not be an accessor`);
  }
  return { present: true, value: descriptor.value };
}

function exactCandidateSnapshot<T>(
  value: T,
  context: string,
): T {
  const snapshot = exactImmutableDataSnapshot(value);
  if (snapshot.status === "uncacheable") {
    throw new Error(`${context} cannot be isolated: ${snapshot.reason}`);
  }
  return snapshot.value;
}

function candidateId<T extends object>(definition: T, context: string): string {
  const id = ownStringData(definition, "id", context);
  if (id.length === 0) {
    throw new Error(`${context}.id must be non-empty`);
  }
  return id;
}

/** Capture the exact data-only module envelope used by self-host tooling. The
 * source module may also carry native implementations and other executable
 * runtime fields, so snapshotting the whole object would be both over-broad and
 * impossible. */
function projectSelfHostModule<T extends object>(
  sourceModule: SelfHostCandidateModule<T>,
  includeBodyless: boolean,
): SelfHostCandidateModule<T> {
  const context = "self-host candidate projection";
  const name = ownStringData(sourceModule, "name", context);
  const functionsSlot = optionalOwnDataValue(sourceModule, "functions", context);
  if (functionsSlot.present && !Array.isArray(functionsSlot.value)) {
    throw new Error(`${context}.functions must be an array when present`);
  }
  const exactFunctions = exactCandidateSnapshot(
    functionsSlot.present ? functionsSlot.value : [],
    `${context}.functions`,
  ) as T[];
  const allFunctionIds = new Set(exactFunctions.map((definition, definitionIndex) =>
    candidateId(definition, `${context}.functions[${definitionIndex}]`)
  ));
  const functions = Object.freeze(includeBodyless
    ? exactFunctions
    : exactFunctions.filter((definition, definitionIndex) => {
        const bodySlot = optionalOwnDataValue(
          definition,
          "body",
          `${context}.functions[${definitionIndex}]`,
        );
        return bodySlot.present && bodySlot.value !== undefined;
      }));
  const retainedFunctionIds = new Set(functions.map((definition, definitionIndex) =>
    candidateId(definition, `${context}.retainedFunctions[${definitionIndex}]`)
  ));

  const projection = Object.create(null) as SelfHostCandidateModule<T>;
  Object.defineProperty(projection, "name", { value: name, enumerable: true });
  Object.defineProperty(projection, "functions", { value: functions, enumerable: true });
  for (const key of ["functionNamespace", "functionNamespaceOverrides"] as const) {
    const slot = optionalOwnDataValue(sourceModule, key, context);
    if (!slot.present) continue;
    let value = exactCandidateSnapshot(slot.value, `${context}.${key}`);
    if (!includeBodyless && key === "functionNamespaceOverrides" && Array.isArray(value)) {
      // Overrides for intentionally excluded bodyless declarations do not
      // belong to the executable projection. Preserve malformed or genuinely
      // stale targets so the shared policy still rejects them fail-closed.
      value = Object.freeze(value.filter((entry, entryIndex) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
        const functionIdSlot = optionalOwnDataValue(
          entry,
          "functionId",
          `${context}.${key}[${entryIndex}]`,
        );
        if (!functionIdSlot.present || typeof functionIdSlot.value !== "string") return true;
        return retainedFunctionIds.has(functionIdSlot.value)
          || !allFunctionIds.has(functionIdSlot.value);
      }));
    }
    Object.defineProperty(projection, key, { value, enumerable: true });
  }
  return projection;
}

/** Build the target-neutral executable projection used by the JS, Wasm, and
 * LLVM classifiers. Bodyless declarations are intentionally absent because
 * they cannot be compiled as self-host candidates. */
export function projectSelfHostCandidateModule<T extends object>(
  sourceModule: SelfHostCandidateModule<T>,
): SelfHostCandidateModule<T> {
  return projectSelfHostModule(sourceModule, false);
}

/** Build the complete function-roster projection used by the matrix catalog.
 * Unlike the executable projection, this retains bodyless declarations so the
 * document can distinguish Fenel bodies from intentional TS leaves. Ownership,
 * namespace overrides, accessors, and exact duplicate definitions are still
 * judged by the same candidate-index boundary. */
export function projectSelfHostRosterModule<T extends object>(
  sourceModule: SelfHostCandidateModule<T>,
): SelfHostCandidateModule<T> {
  return projectSelfHostModule(sourceModule, true);
}

/** Build the shared JS/Wasm/LLVM self-host candidate universe.
 *
 * A canonical function id has one defining module. Repeated exact own-data
 * projections from that same module may collapse (repository profiles can
 * legitimately overlap), but the same id in two different modules is an
 * ownership conflict even when the payloads are otherwise exactly equal.
 * Keeping the owner beside the definition prevents target-specific Map
 * construction from silently choosing first- or last-wins semantics. */
export function buildSelfHostCandidateIndex<T extends { readonly id: string }>(
  modules: readonly SelfHostCandidateModule<T>[],
): SelfHostCandidateIndex<T> {
  const byFnId = new Map<string, OwnedFnIdDefinition<T>>();

  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
    const moduleContext = `self-host classification: candidate module[${moduleIndex}]`;
    const sourceModule = modules[moduleIndex]!;
    const candidateModule = exactCandidateSnapshot(sourceModule, moduleContext);
    const moduleName = ownStringData(candidateModule, "name", moduleContext);
    if (moduleName.length === 0) {
      throw new Error("self-host classification: defining module name must be non-empty");
    }
    const functionsDescriptor = Object.getOwnPropertyDescriptor(candidateModule, "functions");
    const functions = functionsDescriptor === undefined
      ? undefined
      : ownDataValue(candidateModule, "functions", moduleContext);
    if (functions !== undefined && !Array.isArray(functions)) {
      throw new Error(`${moduleContext}.functions must be an array when present`);
    }
    const definitions = (functions ?? []) as T[];
    const functionIds = definitions.map((definition, definitionIndex) =>
      candidateId(
        definition,
        `${moduleContext}.functions[${definitionIndex}]`,
      )
    );
    const namespacePolicy = exactRepositoryFunctionNamespacePolicy(
      candidateModule,
      functionIds,
      "self-host classification",
    );
    for (let definitionIndex = 0; definitionIndex < (functions?.length ?? 0); definitionIndex += 1) {
      const definition = definitions[definitionIndex]!;
      const fnId = functionIds[definitionIndex]!;
      const functionNamespace = namespacePolicy.namespaceFor(fnId)!;
      const prior = byFnId.get(fnId);
      if (prior === undefined) {
        byFnId.set(fnId, {
          moduleName,
          functionNamespace,
          fnId,
          definition,
        });
        continue;
      }
      // The shared policy keeps the candidate gate's fail-closed duplicate
      // diagnostics: conflicting defining modules or resolved namespaces are
      // rejected before exact definition graphs may deduplicate.
      assertExactRepositoryFunctionNamespaceAgreement(
        fnId,
        prior.moduleName,
        prior.functionNamespace,
        moduleName,
        functionNamespace,
        "self-host classification",
      );
      if (!exactImmutableDataEqual(prior.definition, definition)) {
        throw new Error(
          `self-host classification: conflicting definitions for ${fnId} `
            + `in defining module ${moduleName}`,
        );
      }
    }
  }

  const ownedDefinitions = Object.freeze(
    [...byFnId.values()].map((owned) => Object.freeze(owned)),
  );
  const definitions = Object.freeze(
    ownedDefinitions.map(({ definition }) => definition),
  );
  const selectedByFnId = new Map(
    ownedDefinitions.map((owned) => [owned.fnId, owned] as const),
  );
  return Object.freeze({
    ownedDefinitions,
    definitions,
    byFnId: selectedByFnId as ReadonlyMap<string, OwnedFnIdDefinition<T>>,
  });
}

/** Collapse repeated module projections to one canonical fnId definition.
 * Exact-own-data-divergent duplicates fail closed instead of acquiring first/last-wins
 * matrix meaning. */
export function uniqueFnIdDefinitions<T extends { readonly id: string }>(
  definitions: Iterable<T>,
): T[] {
  const byId = new Map<string, T>();
  let index = 0;
  for (const sourceDefinition of definitions) {
    const context = `self-host classification: candidate definition[${index}]`;
    const definition = exactCandidateSnapshot(sourceDefinition, context);
    const fnId = candidateId(definition, context);
    const prior = byId.get(fnId);
    if (prior === undefined) {
      byId.set(fnId, definition);
      index += 1;
      continue;
    }
    if (!exactImmutableDataEqual(prior, definition)) {
      throw new Error(
        `self-host classification: conflicting definitions for ${fnId}`,
      );
    }
    index += 1;
  }
  return [...byId.values()];
}
