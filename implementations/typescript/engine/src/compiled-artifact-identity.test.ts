import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeParserClosureIds,
  computeParserEntryClosureIds,
  computeResolverClosureIds,
  computeResolverEntryClosureIds,
  compiledArtifactBootstrapRuntimeInputHash,
  compiledArtifactManifestHashesForBuild,
  COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS,
  getParserNamespace,
  getResolverNamespace,
  compiledArtifactRuntimeInputHash,
  PARSER_ENTRY_FN_IDS,
  parserManifestHash,
  parserShardManifestHash,
  RESOLVER_ENTRY_FN_IDS,
  resolverManifestHash,
  resolverShardManifestHash,
} from "./engine-bodies-dispatch";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  tryNormalizeFieldDeclarations,
  type FieldDeclarationRootInput,
} from "./field-identity";
import {
  PARSER_CLOSURE_IDS,
  PARSER_BOOTSTRAP_RUNTIME_INPUT_HASH,
  PARSER_ENTRY_CODES,
  PARSER_FN_BODIES,
  PARSER_MANIFEST_HASH,
  PARSER_RUNTIME_INPUT_HASH,
  PARSER_REQUIRED_NATIVES,
  PARSER_SHARDS,
} from "./generated/compiled-parser.generated";
import {
  RESOLVER_CLOSURE_IDS,
  RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH,
  RESOLVER_ENTRY_CODES,
  RESOLVER_FN_BODIES,
  RESOLVER_MANIFEST_HASH,
  RESOLVER_RUNTIME_INPUT_HASH,
  RESOLVER_REQUIRED_NATIVES,
  RESOLVER_SHARDS,
} from "./generated/compiled-resolver.generated";
import { engineModule } from "./modules/engine";
import { localeModule } from "./modules/locale";
import { stdModule } from "./modules/std";
import {
  createRepositoryRegistry,
} from "./repository-registry";
import {
  createEngineBootstrapRegistry,
  isEngineBootstrapRegistry,
  type ModuleRegistry,
} from "./registry";
import { COMPILER_TARGET_ENTITY_MODULES } from "./modules/compiler-target-entities";
import { List } from "./type-foundation";
import { compileCallBindingsByFnId, compileRegistryDeclarationCallBindings } from "./compile-call-bindings";
import type { FenelFunction, FenelType, FieldDef } from "./types";

const LIST_HEAD_UUID = "ffd5bf84-d5d7-4755-a3c9-649b4adbf994";
const LIST_TAIL_UUID = "f604d45e-9b60-4b72-83ce-755d2780162c";
const STD_CHARS_PARAM_UUID = "061f3c68-f25b-4a8d-929d-7e514365e22a";

type MutableListCarrier = {
  $opaque: {
    pure: {
      $variant: {
        cases: Array<{ name: string; fields?: FieldDef[] }>;
      };
    };
  };
};

function legacyKeyedList(headUuid = LIST_HEAD_UUID): FenelType {
  const list = structuredClone(List({ $ref: "String" })) as unknown as MutableListCarrier;
  const cons = list.$opaque.pure.$variant.cases.find((item) => item.name === "Cons");
  if (cons?.fields?.length !== 2) throw new Error("test fixture: canonical List.Cons fields absent");
  cons.fields[0] = {
    ...cons.fields[0]!,
    key: { $tag: "NamedField", ref: { $ref: headUuid } },
  };
  cons.fields[1] = {
    ...cons.fields[1]!,
    key: { $tag: "NamedField", ref: { $ref: LIST_TAIL_UUID } },
  };
  return list as unknown as FenelType;
}

const parserRegistry = (): ModuleRegistry =>
  createRepositoryRegistry([
    stdModule,
    engineModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ], {
    dispatchRegistry: createDispatchRegistry(),
  });

const resolverRegistry = async (): Promise<ModuleRegistry> => {
  const { dispatchModule } = await import("./modules/dispatch");
  return createRepositoryRegistry([
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ], {
    dispatchRegistry: createDispatchRegistry(),
  });
};

const combinedArtifactRegistry = async (): Promise<ModuleRegistry> => {
  const { dispatchModule } = await import("./modules/dispatch");
  return createRepositoryRegistry([
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ], {
    dispatchRegistry: createDispatchRegistry(),
  });
};

const parserBootstrapRegistry = (): ModuleRegistry =>
  createEngineBootstrapRegistry([
    stdModule,
    engineModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ]);

const resolverBootstrapRegistry = async (): Promise<ModuleRegistry> => {
  const { dispatchModule } = await import("./modules/dispatch");
  return createEngineBootstrapRegistry([
    stdModule,
    engineModule,
    dispatchModule,
    localeModule,
    ...COMPILER_TARGET_ENTITY_MODULES,
  ]);
};

const shortCode = (id: string): string => {
  const separator = id.indexOf(":");
  return separator < 0 ? id : id.slice(separator + 1);
};

function manifestBatchFixture(): {
  readonly registry: ModuleRegistry;
  readonly functions: FenelFunction[];
  readonly identifiedReads: Map<string, number>;
  readonly constructorReads: { count: number };
} {
  const functions: FenelFunction[] = [...new Set([
    ...PARSER_ENTRY_FN_IDS,
    ...RESOLVER_ENTRY_FN_IDS,
    ...COMPILED_ARTIFACT_PIPELINE_ENTRY_FN_IDS,
  ])].map((id) => ({ id, params: [], returns: { $unit: true }, body: { literal: id } }));
  const identifiedReads = new Map<string, number>();
  const constructorReads = { count: 0 };
  const projection: Pick<ModuleRegistry,
    "listFunctions" | "getFunction" | "getIdentifiedFunction" | "listConstructorSignatures"
  > = {
    listFunctions: () => [...functions],
    getFunction: (id) => functions.find((fn) => fn.id === id),
    getIdentifiedFunction: (id) => {
      identifiedReads.set(id, (identifiedReads.get(id) ?? 0) + 1);
      return functions.find((fn) => fn.id === id);
    },
    listConstructorSignatures: () => {
      constructorReads.count++;
      return [];
    },
  };
  return { registry: projection as ModuleRegistry, functions, identifiedReads, constructorReads };
}

function requiredManifestHash(hash: string | null): string {
  if (hash === null) throw new Error("The Node manifest hash oracle is unavailable.");
  return hash;
}

function auditArtifact(
  closureIds: readonly string[],
  requiredNatives: readonly string[],
  entryCodes: Readonly<Record<string, string>>,
  bodies: Readonly<Record<string, string>>,
): void {
  expect(Object.isFrozen(closureIds)).toBe(true);
  expect(Object.isFrozen(requiredNatives)).toBe(true);
  expect(Object.getPrototypeOf(entryCodes)).toBeNull();
  expect(Object.getPrototypeOf(bodies)).toBeNull();
  expect(Object.isFrozen(entryCodes)).toBe(true);
  expect(Object.isFrozen(bodies)).toBe(true);

  const closureBefore = [...closureIds];
  const nativesBefore = [...requiredNatives];
  expect(() => (closureIds as string[]).push("hostile:late-closure"))
    .toThrow();
  expect(() => (requiredNatives as string[]).push("hostileLateNative"))
    .toThrow();
  expect(closureIds).toEqual(closureBefore);
  expect(requiredNatives).toEqual(nativesBefore);

  const closure = new Set(closureIds);
  const ownerByCode = new Map<string, string>();
  for (const id of closureIds) {
    const code = shortCode(id);
    expect(ownerByCode.get(code), `duplicate short loader code ${code}`).toBeUndefined();
    ownerByCode.set(code, id);
    expect(Object.prototype.hasOwnProperty.call(bodies, code), id).toBe(true);
  }
  expect(Object.keys(bodies)).toHaveLength(closureIds.length);
  for (const [id, code] of Object.entries(entryCodes)) {
    expect(closure.has(id), id).toBe(true);
    expect(code).toBe(shortCode(id));
    expect(Object.prototype.hasOwnProperty.call(bodies, code), id).toBe(true);
  }

  const bracketRef = /\$fenel\[("(?:\\.|[^"\\])*")\]/g;
  for (const [code, source] of Object.entries(bodies)) {
    let match: RegExpExecArray | null;
    while ((match = bracketRef.exec(source)) !== null) {
      const ref = JSON.parse(match[1]!) as string;
      if (ref.includes(":")) {
        expect(closure.has(ref), `${code} emits unaliased canonical ref ${ref}`).toBe(true);
      }
    }
  }
}

describe("compiled artifact identity-total runtime contract", () => {
  test("owner manifest batches preserve original preimages and prepare each source input once", () => {
    const fixture = manifestBatchFixture();
    for (const artifact of ["parser", "resolver"] as const) {
      fixture.identifiedReads.clear();
      fixture.constructorReads.count = 0;
      const batch = compiledArtifactManifestHashesForBuild(artifact, fixture.registry)!;
      const entries = artifact === "parser" ? PARSER_ENTRY_FN_IDS : RESOLVER_ENTRY_FN_IDS;
      expect(fixture.constructorReads.count).toBe(1);
      expect([...fixture.identifiedReads.keys()].sort()).toEqual([...entries].sort());
      expect([...fixture.identifiedReads.values()]).toEqual(entries.map(() => 1));
      expect(Object.isFrozen(batch)).toBe(true);
      expect(Object.isFrozen(batch.shards)).toBe(true);
      expect(Object.getPrototypeOf(batch.shards)).toBeNull();
      if (artifact === "parser") {
        expect(batch.manifestHash).toBe(requiredManifestHash(parserManifestHash(fixture.registry)));
        for (const entry of PARSER_ENTRY_FN_IDS) {
          expect(batch.shards[entry]).toBe(requiredManifestHash(parserShardManifestHash(fixture.registry, entry)));
        }
      } else {
        expect(batch.manifestHash).toBe(requiredManifestHash(resolverManifestHash(fixture.registry)));
        for (const entry of RESOLVER_ENTRY_FN_IDS) {
          expect(batch.shards[entry]).toBe(requiredManifestHash(resolverShardManifestHash(fixture.registry, entry)));
        }
      }
    }
  }, 180_000);

  test("owner manifest batches observe later source, compiler and declaration-roster changes", () => {
    const fixture = manifestBatchFixture();
    const before = compiledArtifactManifestHashesForBuild("parser", fixture.registry)!;
    const index = fixture.functions.findIndex((fn) => fn.id === "engine:lexAll");
    fixture.functions[index] = { ...fixture.functions[index]!, body: { literal: "changed source" } };
    const sourceChanged = compiledArtifactManifestHashesForBuild("parser", fixture.registry)!;
    expect(sourceChanged.shards["engine:lexAll"]).not.toBe(before.shards["engine:lexAll"]);
    expect(sourceChanged.manifestHash).toBe(requiredManifestHash(parserManifestHash(fixture.registry)));

    const compilerIndex = fixture.functions.findIndex((fn) => fn.id === "engine:serializeJsModuleEntry");
    fixture.functions[compilerIndex] = {
      ...fixture.functions[compilerIndex]!, body: { literal: "changed compiler" },
    };
    const compilerChanged = compiledArtifactManifestHashesForBuild("parser", fixture.registry)!;
    expect(compilerChanged.shards["engine:defaultFixityTable"])
      .not.toBe(sourceChanged.shards["engine:defaultFixityTable"]);
    expect(compilerChanged.manifestHash).toBe(requiredManifestHash(parserManifestHash(fixture.registry)));

    fixture.functions.push({
      id: "engine:batchNewDeclaration", params: [], returns: { $unit: true }, body: { literal: "new" },
    });
    const rosterChanged = compiledArtifactManifestHashesForBuild("parser", fixture.registry)!;
    expect(rosterChanged.manifestHash).not.toBe(compilerChanged.manifestHash);
    expect(rosterChanged.manifestHash).toBe(requiredManifestHash(parserManifestHash(fixture.registry)));
    fixture.functions.push({ ...fixture.functions[index]! });
    expect(() => compiledArtifactManifestHashesForBuild("parser", fixture.registry))
      .toThrow("duplicate local declaration");
    expect(() => parserManifestHash(fixture.registry)).toThrow("duplicate local declaration");
  }, 180_000);

  test("resolver manifest accepts the actual constructor Function roster without changing worker declarations", async () => {
    const { dispatchModule } = await import("./modules/dispatch");
    const reg = await resolverRegistry();
    const constructorId = "c4858054-836d-44de-9897-51e65a9c34b8";
    const constructor = reg.listConstructorSignatures().find(row => row.functionId === constructorId);
    expect(constructor).toMatchObject({ ownerModule: "authority", ownerName: "Act", name: "Act" });
    expect(constructor?.params.length).toBeGreaterThan(0);
    expect(reg.listFunctions().some(fn => fn.id === constructorId)).toBe(true);
    const actualFunction = reg.getIdentifiedFunction(constructorId)!;
    expect(actualFunction.id).toBe(constructorId);
    expect(actualFunction.body).toBeDefined();
    expect(actualFunction.params).toEqual([...constructor!.params]);
    expect(actualFunction.returns).toEqual(constructor!.returns);

    const worker = compileCallBindingsByFnId([stdModule, engineModule, dispatchModule, localeModule]);
    const projected = compileRegistryDeclarationCallBindings(reg);
    expect(projected.has(constructorId)).toBe(false);
    for (const [id, bindings] of worker) expect(projected.get(id)).toEqual(bindings);
    // Run the authoritative hash which failed during owner generation. It
    // still retains constructor metadata separately; stale artifact constants
    // are deliberately irrelevant to this positive integration control.
    const hash = resolverShardManifestHash(reg, "dispatch:rsvResolveBareName");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  }, 600_000);

  test("generated shard tables are immutable and retain exact whole-closure unions", () => {
    expect(PARSER_ENTRY_FN_IDS).toEqual([
      "engine:defaultFixityTable",
      "engine:lexAll",
      "engine:layoutTokens",
      "engine:parseExprToks",
      "engine:parseProgToks",
      "engine:spliceSetBodies",
      "engine:splitTopLevelDecls",
    ]);
    // modules-as-values Phase 2d — complete-type selection is its own shard.
    expect(RESOLVER_ENTRY_FN_IDS).toEqual([
      "dispatch:rsvResolveBareName",
      "dispatch:rsvResolveComplete",
    ]);

    const auditGeneratedShards = (
      raw: unknown,
      entryIds: readonly string[],
      wholeClosureIds: readonly string[],
    ): void => {
      expect(raw !== null && typeof raw === "object").toBe(true);
      const shards = raw as Record<string, {
        closureIds: readonly string[];
        manifestHash: string;
        runtimeInputHash: string;
        bootstrapRuntimeInputHash: string;
      }>;
      expect(Object.getPrototypeOf(shards)).toBeNull();
      expect(Object.isFrozen(shards)).toBe(true);
      expect(Object.keys(shards).sort()).toEqual([...entryIds].sort());
      const union = new Set<string>();
      for (const entryFnId of entryIds) {
        const shard = shards[entryFnId];
        expect(shard, entryFnId).toBeDefined();
        expect(Object.isFrozen(shard)).toBe(true);
        expect(Object.isFrozen(shard!.closureIds)).toBe(true);
        expect(shard!.closureIds).toContain(entryFnId);
        expect(shard!.manifestHash).toHaveLength(64);
        expect(shard!.runtimeInputHash).toHaveLength(64);
        expect(shard!.bootstrapRuntimeInputHash).toHaveLength(64);
        expect(shard!.bootstrapRuntimeInputHash).not.toBe(shard!.runtimeInputHash);
        for (const id of shard!.closureIds) union.add(id);
      }
      expect([...union].sort()).toEqual([...wholeClosureIds]);
    };

    auditGeneratedShards(
      PARSER_SHARDS,
      PARSER_ENTRY_FN_IDS,
      PARSER_CLOSURE_IDS,
    );
    auditGeneratedShards(
      RESOLVER_SHARDS,
      RESOLVER_ENTRY_FN_IDS,
      RESOLVER_CLOSURE_IDS,
    );
    expect(PARSER_BOOTSTRAP_RUNTIME_INPUT_HASH).toHaveLength(64);
    expect(PARSER_BOOTSTRAP_RUNTIME_INPUT_HASH).not.toBe(PARSER_RUNTIME_INPUT_HASH);
    expect(RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH).toHaveLength(64);
    expect(RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH).not.toBe(RESOLVER_RUNTIME_INPUT_HASH);
  });

  test("bootstrap certificates are manifest-bound and restricted to exact factory identities", async () => {
    const parser = parserBootstrapRegistry();
    const resolver = await resolverBootstrapRegistry();
    expect(isEngineBootstrapRegistry(parser)).toBe(true);
    expect(isEngineBootstrapRegistry(resolver)).toBe(true);

    expect(compiledArtifactBootstrapRuntimeInputHash(
      "parser",
      parser,
      PARSER_MANIFEST_HASH,
    )).toBe(PARSER_BOOTSTRAP_RUNTIME_INPUT_HASH);
    for (const entryFnId of PARSER_ENTRY_FN_IDS) {
      const shard = PARSER_SHARDS[entryFnId]!;
      expect(compiledArtifactBootstrapRuntimeInputHash(
        "parser",
        parser,
        shard.manifestHash,
        entryFnId,
      )).toBe(shard.bootstrapRuntimeInputHash);
    }
    expect(compiledArtifactBootstrapRuntimeInputHash(
      "resolver",
      resolver,
      RESOLVER_MANIFEST_HASH,
    )).toBe(RESOLVER_BOOTSTRAP_RUNTIME_INPUT_HASH);
    for (const entryFnId of RESOLVER_ENTRY_FN_IDS) {
      const shard = RESOLVER_SHARDS[entryFnId]!;
      expect(compiledArtifactBootstrapRuntimeInputHash(
        "resolver",
        resolver,
        shard.manifestHash,
        entryFnId,
      )).toBe(shard.bootstrapRuntimeInputHash);
    }

    const parserEntry = PARSER_ENTRY_FN_IDS[0]!;
    const parserShard = PARSER_SHARDS[parserEntry]!;
    expect(compiledArtifactBootstrapRuntimeInputHash(
      "parser",
      parser,
      "0".repeat(64),
      parserEntry,
    )).not.toBe(parserShard.bootstrapRuntimeInputHash);

    expect(getParserNamespace(parser, parserEntry)).not.toBeNull();
    expect(getResolverNamespace(resolver, RESOLVER_ENTRY_FN_IDS[0]!)).not.toBeNull();

    // A proxy is structurally indistinguishable from its target to ordinary
    // registry consumers, but it does not inherit the private WeakSet brand.
    // It therefore cannot replay the source-only certificate and has no
    // authoritative signature sidecars with which to enter manifest fallback.
    const parserProxy = new Proxy(parser, {}) as ModuleRegistry;
    const resolverProxy = new Proxy(resolver, {}) as ModuleRegistry;
    expect(isEngineBootstrapRegistry(parserProxy)).toBe(false);
    expect(isEngineBootstrapRegistry(resolverProxy)).toBe(false);
    expect(getParserNamespace(parserProxy, parserEntry)).toBeNull();
    expect(getResolverNamespace(resolverProxy, RESOLVER_ENTRY_FN_IDS[0]!)).toBeNull();

    // Freshness is keyed by the current stamp, not just the branded object.
    // Replacing the observable function view on that same exact registry must
    // invalidate the namespace while preserving its provenance identity.
    const originalGetFunction = parser.getFunction;
    const changedFunctions = parser.listFunctions().map((fn) =>
      fn.id === parserEntry
        ? { ...fn, body: { literal: "same bootstrap registry, stale parser body" } }
        : fn
    );
    const changedById = new Map(changedFunctions.map((fn) => [fn.id, fn]));
    parser.listFunctions = () => changedFunctions;
    parser.getFunction = (id: string) => changedById.get(id) ?? originalGetFunction(id);
    expect(isEngineBootstrapRegistry(parser)).toBe(true);
    expect(getParserNamespace(parser, parserEntry)).toBeNull();
  }, 180_000);

  test("entry-shard closure union is exactly the retained whole-artifact closure", async () => {
    const parser = parserRegistry();
    const parserWhole = computeParserClosureIds(parser);
    const parserUnion = new Set<string>();
    const parserShardSizes: number[] = [];
    for (const entryFnId of PARSER_ENTRY_FN_IDS) {
      const closureIds = computeParserEntryClosureIds(parser, entryFnId);
      parserShardSizes.push(closureIds.length);
      for (const id of closureIds) parserUnion.add(id);
    }
    expect([...parserUnion].sort()).toEqual(parserWhole);
    expect(parserShardSizes.some((size) => size < parserWhole.length)).toBe(true);

    const resolver = await resolverRegistry();
    const resolverUnion = new Set<string>();
    for (const entryFnId of RESOLVER_ENTRY_FN_IDS) {
      for (const id of computeResolverEntryClosureIds(resolver, entryFnId)) {
        resolverUnion.add(id);
      }
    }
    expect([...resolverUnion].sort()).toEqual(computeResolverClosureIds(resolver));
  }, 900_000);

  test("an unrelated owner-roster addition does not flip an entry shard certificate", () => {
    const fresh = parserRegistry();
    const entryFnId = "engine:defaultFixityTable" as const;
    const shardBefore = compiledArtifactRuntimeInputHash("parser", fresh, entryFnId);
    const wholeBefore = compiledArtifactRuntimeInputHash("parser", fresh);
    const unrelated: FenelFunction = {
      id: "engine:phase4bUnrelatedRosterFixture",
      params: [],
      returns: { $ref: "String" } as FenelType,
      body: { literal: "unrelated" },
    };
    const functions = [...fresh.listFunctions(), unrelated];
    const byId = new Map(functions.map((fn) => [fn.id, fn]));
    const withUnrelatedRoster = new Proxy(fresh, {
      get(target, property, receiver) {
        if (property === "listFunctions") return () => functions;
        if (property === "getFunction") return (id: string) => byId.get(id);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ModuleRegistry;

    expect(compiledArtifactRuntimeInputHash("parser", withUnrelatedRoster, entryFnId))
      .toBe(shardBefore);
    // The retained monolithic digest deliberately preserves its historical
    // owner-roster cross-check during the transition.
    expect(compiledArtifactRuntimeInputHash("parser", withUnrelatedRoster))
      .not.toBe(wholeBefore);
  }, 180_000);

  test("an edited engine body stales only entry shards whose closure contains it", () => {
    const fresh = parserRegistry();
    const touchedEntry = "engine:lexAll" as const;
    const untouchedEntry = "engine:defaultFixityTable" as const;
    const touchedClosure = computeParserEntryClosureIds(fresh, touchedEntry);
    const untouchedClosure = new Set(computeParserEntryClosureIds(fresh, untouchedEntry));
    const changedId = touchedClosure.find((id) =>
      id !== touchedEntry && !untouchedClosure.has(id)
    );
    expect(changedId, "fixture needs a lex-only closure member").toBeDefined();
    const touchedBefore = compiledArtifactRuntimeInputHash("parser", fresh, touchedEntry);
    const untouchedBefore = compiledArtifactRuntimeInputHash("parser", fresh, untouchedEntry);
    const functions = fresh.listFunctions().map((fn) =>
      fn.id === changedId
        ? { ...fn, body: { literal: "phase4b edited engine body" } }
        : fn
    );
    const byId = new Map(functions.map((fn) => [fn.id, fn]));
    const edited = new Proxy(fresh, {
      get(target, property, receiver) {
        if (property === "listFunctions") return () => functions;
        if (property === "getFunction") return (id: string) => byId.get(id);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ModuleRegistry;

    expect(compiledArtifactRuntimeInputHash("parser", edited, touchedEntry))
      .not.toBe(touchedBefore);
    expect(compiledArtifactRuntimeInputHash("parser", edited, untouchedEntry))
      .toBe(untouchedBefore);
  }, 180_000);

  test("a fresh process with one stale engine body still serves untouched compiled shards", async () => {
    const probePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "compiled-artifact-cold-shard.probe.ts",
    );
    const child = Bun.spawn([process.execPath, probePath], {
      cwd: dirname(probePath),
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 900_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);

    expect(timedOut, `cold-shard probe timed out\n${stderr}`).toBe(false);
    expect(exitCode, `cold-shard probe failed\n${stderr}\n${stdout}`).toBe(0);
    const prefix = "PHASE4B_COLD_SHARD_PROBE ";
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(prefix));
    expect(resultLine, `cold-shard probe emitted no result\n${stderr}\n${stdout}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice(prefix.length)) as {
      readonly editedBeforeRegistry: boolean;
      readonly touchedStale: boolean;
      readonly untouchedServedCompiled: boolean;
      readonly resolverServedCompiled: boolean;
      readonly fixityRows: number;
    };
    expect(result).toMatchObject({
      editedBeforeRegistry: true,
      touchedStale: true,
      untouchedServedCompiled: true,
      resolverServedCompiled: true,
    });
    expect(result.fixityRows).toBeGreaterThan(0);
  }, 1_200_000);

  test("strict lock alone proves a legacy keyed List use against the keyless canonical declaration", () => {
    const template: FieldDeclarationRootInput = {
      kind: "type",
      realm: "repository-source",
      entity: {
        id: "List",
        module: "system",
        params: ["a"],
        type: List({ $var: "a" }),
      },
    };
    const use = (returns: FenelType): FieldDeclarationRootInput => ({
      kind: "function",
      realm: "repository-source",
      fn: { id: "std:chars", params: [], returns },
    });
    const exactLock = new Map([
      ["field:type%3Asystem%3AList/case%3ACons/named%3Ahead", LIST_HEAD_UUID],
      ["field:type%3Asystem%3AList/case%3ACons/named%3Atail", LIST_TAIL_UUID],
    ]);

    expect(tryNormalizeFieldDeclarations(
      [template, use(legacyKeyedList())],
      { mode: "source-handles" },
    ).ok).toBe(false);
    expect(tryNormalizeFieldDeclarations(
      [template, use(legacyKeyedList())],
      { mode: "strict-embedded", lock: exactLock },
    ).ok).toBe(true);
    expect(tryNormalizeFieldDeclarations(
      [template, use(legacyKeyedList(STD_CHARS_PARAM_UUID))],
      { mode: "strict-embedded", lock: exactLock },
    ).ok).toBe(false);
  }, 180_000);

  test("generator and runtime manifest hashes agree under the strict repository lock", async () => {
    const parser = parserRegistry();
    const resolver = await resolverRegistry();
    const parserBuildHashes = compiledArtifactManifestHashesForBuild("parser", parser)!;
    const resolverBuildHashes = compiledArtifactManifestHashesForBuild("resolver", resolver)!;
    expect(parserBuildHashes.manifestHash).toBe(PARSER_MANIFEST_HASH);
    expect(resolverBuildHashes.manifestHash).toBe(RESOLVER_MANIFEST_HASH);
    expect(parserManifestHash(parser)).toBe(PARSER_MANIFEST_HASH);
    expect(compiledArtifactRuntimeInputHash("parser", parser)).toBe(PARSER_RUNTIME_INPUT_HASH);
    expect(resolverManifestHash(resolver)).toBe(RESOLVER_MANIFEST_HASH);
    expect(compiledArtifactRuntimeInputHash("resolver", resolver)).toBe(RESOLVER_RUNTIME_INPUT_HASH);
    for (const entryFnId of PARSER_ENTRY_FN_IDS) {
      expect(parserBuildHashes.shards[entryFnId]).toBe(PARSER_SHARDS[entryFnId]!.manifestHash);
      expect(parserShardManifestHash(parser, entryFnId))
        .toBe(PARSER_SHARDS[entryFnId]!.manifestHash);
      expect(compiledArtifactRuntimeInputHash("parser", parser, entryFnId))
        .toBe(PARSER_SHARDS[entryFnId]!.runtimeInputHash);
    }
    for (const entryFnId of RESOLVER_ENTRY_FN_IDS) {
      expect(resolverBuildHashes.shards[entryFnId]).toBe(RESOLVER_SHARDS[entryFnId]!.manifestHash);
      expect(resolverShardManifestHash(resolver, entryFnId))
        .toBe(RESOLVER_SHARDS[entryFnId]!.manifestHash);
      expect(compiledArtifactRuntimeInputHash("resolver", resolver, entryFnId))
        .toBe(RESOLVER_SHARDS[entryFnId]!.runtimeInputHash);
    }
  }, 1_800_000);

  test("parser body table is prototype-safe and every full-id ref has a closure alias", () => {
    auditArtifact(
      PARSER_CLOSURE_IDS,
      PARSER_REQUIRED_NATIVES,
      PARSER_ENTRY_CODES,
      PARSER_FN_BODIES,
    );
  });

  test("parser closure carries the lowering-introduced Fenel std:$ body", () => {
    const apply = stdModule.functions?.find((fn) => fn.id === "std:$");
    expect(apply?.body, "std:$ must remain Fenel-bodied").toBeDefined();
    expect(PARSER_CLOSURE_IDS).toContain("std:$");
  });

  test("parser freshness and namespace caching are isolated per registry identity", () => {
    const fresh = parserRegistry();
    expect(getParserNamespace(fresh)).not.toBeNull();

    const changed = fresh.listFunctions().find((fn) => fn.id === "engine:lexAll");
    expect(changed?.body).toBeDefined();
    const staleFunctions = fresh.listFunctions().map((fn) =>
      fn.id === "engine:lexAll"
        ? { ...fn, body: { literal: "different registry body" } }
        : fn);
    const staleById = new Map(staleFunctions.map((fn) => [fn.id, fn]));
    const stale = new Proxy(fresh, {
      get(target, property, receiver) {
        if (property === "listFunctions") return () => staleFunctions;
        if (property === "getFunction") return (id: string) => staleById.get(id);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ModuleRegistry;

    expect(getParserNamespace(stale)).toBeNull();
    expect(getParserNamespace(fresh)).not.toBeNull();
  }, 900_000);

  test("parser and resolver freshness include the shared Fenel compiler pipeline", async () => {
    const fresh = await combinedArtifactRegistry();
    const freshParserHash = parserManifestHash(fresh);
    const freshResolverHash = resolverManifestHash(fresh);
    const changedId = "engine:serializeJsModuleEntry";
    const changedFunctions = fresh.listFunctions().map((fn) =>
      fn.id === changedId
        ? { ...fn, body: { literal: "changed compiler pipeline" } }
        : fn);
    expect(changedFunctions.find((fn) => fn.id === changedId)?.body).toEqual({
      literal: "changed compiler pipeline",
    });
    const changedById = new Map(changedFunctions.map((fn) => [fn.id, fn]));
    const changed = new Proxy(fresh, {
      get(target, property, receiver) {
        if (property === "listFunctions") return () => changedFunctions;
        if (property === "getFunction") return (id: string) => changedById.get(id);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ModuleRegistry;

    expect(parserManifestHash(changed)).not.toBe(freshParserHash);
    expect(resolverManifestHash(changed)).not.toBe(freshResolverHash);
  }, 180_000);

  test("freshness revalidates a compiler-body mutation on the same registry object", async () => {
    const source = await combinedArtifactRegistry();
    const functions = source.listFunctions().map((fn) => ({ ...fn }));
    const byId = new Map(functions.map((fn) => [fn.id, fn]));
    const mutable = new Proxy(source, {
      get(target, property, receiver) {
        if (property === "listFunctions") return () => functions;
        if (property === "getFunction") return (id: string) => byId.get(id);
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ModuleRegistry;

    const parserBefore = parserManifestHash(mutable);
    const resolverBefore = resolverManifestHash(mutable);
    expect(getParserNamespace(mutable)).not.toBeNull();
    expect(getResolverNamespace(mutable)).not.toBeNull();
    const changedId = "engine:serializeJsModuleEntry";
    const index = functions.findIndex((fn) => fn.id === changedId);
    expect(index).toBeGreaterThanOrEqual(0);
    const changed = {
      ...functions[index]!,
      body: { literal: "same-registry changed compiler pipeline" },
    };
    functions[index] = changed;
    byId.set(changedId, changed);

    expect(parserManifestHash(mutable)).not.toBe(parserBefore);
    expect(resolverManifestHash(mutable)).not.toBe(resolverBefore);
    expect(getParserNamespace(mutable)).toBeNull();
    expect(getResolverNamespace(mutable)).toBeNull();
  }, 300_000);

  test("resolver body table is prototype-safe and every full-id ref has a closure alias", () => {
    auditArtifact(
      RESOLVER_CLOSURE_IDS,
      RESOLVER_REQUIRED_NATIVES,
      RESOLVER_ENTRY_CODES,
      RESOLVER_FN_BODIES,
    );
  });
});
