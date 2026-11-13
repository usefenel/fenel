import { describe, expect, test } from "bun:test";
import type { AuthoringWorkerMessage } from "./authoring-worker-protocol";
import { AUTHORING_CATALOGUE_SCHEMA, chunkIntegrity } from "./authoring-catalogue-transport";
import { canonical } from "@fenel/engine/locale";
import { Nothing } from "@fenel/engine/type-foundation";
import { dispatchedReaderPresentationFromSnapshot } from "@fenel/engine/engine-bodies-dispatch";
import { checkRegistryPreparationBuild, registryPreparationFailure, RegistryPreparationBuildMismatch, type RegistryPreparationRequest, type RegistryPreparationResult } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
// L5a-finish: this worker bundle's build identity, as the worker sees it.
const BUILD = "worker-build";

// C1: execute production initialization and reader presentation with registry
// acquisition controlled. The historical closure is an allocation control;
// registry acquisition stays controlled; both use the actual shared projection.
const workerSource = (await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
// The Local projection moved verbatim into the catalogue artifact owner; the
// worker calls it through localCatalogue (live path when not admitted).
const artifactSource = (await Bun.file(new URL("./authoring-catalogue-artifact.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const presentationSource = await Bun.file(new URL("../reader-presentation.ts", import.meta.url)).text();
const capturedSource = `const presentationSource = { registry,
    session: { evaluateContext: frame }, catalog: sections,
    types: data.entities.map(entity => ({ id: entity.id, name: entity.id })),
    functionRows: (data.functions ?? []).map(fn => ({ id: fn.id, name: fn.id, function: fn })),
  };
  const presentation = createReaderPresentation(() => presentationSource);`;
const historicalSource = `const presentation = createReaderPresentation(() => ({ registry,
    session: { evaluateContext: frame }, catalog: sections,
    types: data.entities.map(entity => ({ id: entity.id, name: entity.id })),
    functionRows: (data.functions ?? []).map(fn => ({ id: fn.id, name: fn.id, function: fn })),
  }));`;
if (artifactSource.split(capturedSource).length !== 2) throw new Error("The captured worker presentation boundary changed.");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const readerCode = transpiler.transformSync(presentationSource.replace(/^import[^;]*;\r?\n/gm, ""))
  .replace(/^export /gm, "");
const stripImports = (source: string) => source.replace(/^import[\s\S]*?;\n/gm, "");
const artifactCode = (historical: boolean) => transpiler.transformSync(stripImports(
  historical ? artifactSource.replace(capturedSource, historicalSource) : artifactSource)).replace(/^export /gm, "");
// Module-only syntax of the (never admitted here) repository catalogue read.
const workerCode = transpiler.transformSync(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/")).replaceAll("await import(", "await dynamicImport(");

type FunctionRow = { id: string; body: string };
type Input = {
  id: number; method: "initialize"; localSourceId?: string; accountId?: string; repositoryOnly?: boolean;
  snapshot: { owners: object[]; fields: object[]; facets: object[] };
  entities: Array<{ id: string }>; functions?: FunctionRow[];
};
type CapturedSource = {
  registry: object; session: { evaluateContext: { _authority?: object; _activeTags?: string[] } };
  catalog: object[]; types: Array<{ id: string; name: string }>;
  functionRows: Array<{ id: string; name: string; function: FunctionRow }>;
};

/** `acquire` replaces the checked registry acquisition (W1 realm reuse);
 * `retainReads: false` keeps no captured presentation source alive. */
function harness(historical = false, options: { acquire?: () => Promise<object>; retainReads?: boolean;
  prepare?: (request: RegistryPreparationRequest) => RegistryPreparationResult;
  /** Lane S: the public worker's build-owned repository catalogue read. */
  repository?: { index: Record<string, unknown>; result: { catalog: object; displayCatalog: object[] }; shape: object } } = {}) {
  const functions = [{ id: "first", body: "first body" }, { id: "second", body: "second body" },
    { id: "first", body: "duplicate occurrence" }];
  const entities = [{ id: "Record" }, { id: "Record" }, { id: "Other" }];
  const maps = { entities: 0, functions: 0 };
  const counted = <T>(rows: T[], kind: keyof typeof maps): T[] => {
    Object.defineProperty(rows, "map", { value: function(this: T[], callback: (row: T, index: number, rows: T[]) => unknown) {
      maps[kind]++;
      return Array.prototype.map.call(this, callback);
    } });
    return rows;
  };
  const input = (id = 1, sourceId = "this-source"): Input => ({ id, method: "initialize", localSourceId: sourceId,
    snapshot: { owners: [], fields: [], facets: [] }, entities: counted([...entities], "entities"),
    functions: counted([...functions], "functions") });
  const sections = [{ id: "function", entries: functions.slice(0, 2).map(fn => ({
    id: `function:${fn.id}`, name: `Fallback ${fn.id}`, description: "Fallback description", fn,
  })) }, { id: "entity", entries: [{ id: "entity:Record", name: "Fallback Record", entity: { id: "Record" } }] }];
  const registry = {
    getFunction: (id: string) => functions.find(fn => fn.id === id),
    getUuid: (id: string) => id,
    getIdentifiedEntity: (id: string) => entities.find(entity => entity.id === id),
    getEntityNominalIdentity: (id: string) => id,
  };
  const pool = {};
  const authority = {};
  const frame = { _specRegistry: pool, _authority: { previous: true }, preserved: "evaluation hook" };
  const reads: CapturedSource[] = [];
  const resolutions: Array<{ frame: object; pool: object; typeName: string; target: string }> = [];
  const replies: Array<{ id: number; ok: boolean; result?: unknown; error?: string }> = [];
  const workerGlobal: Record<string | symbol, unknown> = { location: { href: "http://fenel.test/" }, postMessage: (reply: AuthoringWorkerMessage) => { if (!("event" in reply)) replies.push(reply); } };
  let label = "First label";
  let failure: "registry" | "presentation" | undefined;
  let readers = 0;
  let acquisitions = 0;
  const preparationCalls: RegistryPreparationRequest[] = [];
  const preparationPartitions: string[] = [];
  const clearedPartitions: string[] = [];
  const createReader = new Function("resolveEffect", "dispatchedReaderPresentationFromSnapshot", "canonical", `${readerCode}; return createReaderPresentation;`)(
    (context: CapturedSource["session"]["evaluateContext"], currentPool: object, typeName: string, target: string) => {
      resolutions.push({ frame: context, pool: currentPool, typeName, target });
      if (failure === "presentation") throw new Error("Scoped presentation refused");
      return target === "first" && context._activeTags?.[0] === "this-source" && typeName === "Labelable"
        ? { methods: { label } } : undefined;
    }, dispatchedReaderPresentationFromSnapshot, canonical);
  const imports = {
    AUTHORING_CATALOGUE_SCHEMA, chunkIntegrity,
    globalThis: workerGlobal, dispatchRegistry: {}, modulesFor: () => [],
    registerCatalogEntities: () => {}, createAccountFieldRegistry: () => registry, createRepositoryRegistry: () => registry,
    buildLocalReaderFieldRegistry: async () => {
      acquisitions++;
      if (failure === "registry") throw new Error("Checked registry refused");
      return options.acquire ? options.acquire() : registry;
    },
    evaluateContextForCatalog: () => frame, mintAnonymousAuthority: () => authority, getCatalog: () => sections,
    createReaderPresentation: (read: () => CapturedSource) => {
      readers++;
      return createReader(() => { const captured = read(); if (options.retainReads !== false) reads.push(captured); return captured; });
    },
    sessionCatalogSections: (_registry: object, catalog: typeof sections, named: (id: string) => object) => catalog.map(section => ({
      ...section, entries: section.entries.map(entry => ({ ...entry, ...named(entry.id) })),
    })),
    buildSessionCatalog: (_registry: object, _module: unknown, options: {
      sections?: typeof sections; presentation?: (id: string) => object;
    } = {}) => ({ live: true, display: options.sections ?? sections,
      presentations: options.presentation ? ["first", "function:first", "second", "entity:Record", "first"]
        .map((id, index) => {
          if (index === 4) label = "Updated label";
          return options.presentation!(id);
        }) : [] }),
    environmentForCatalog: (catalog: object) => ({ catalog }), createDetachedAuthoringEnvironment: (value: object) => value,
  };
  const artifactImports = { ...imports, ...(options.repository ? { Nothing, repositoryFingerprintShape: () => options.repository!.shape } : {}) };
  const artifact = new Function(...Object.keys(artifactImports), `${artifactCode(historical)}; return {
    localCatalogue, realmRepositoryCatalogue, repositoryCatalogueRealmKey, repositoryOnlyCatalogue, REPOSITORY_CATALOGUE_SOURCE_ID,
    chunkIntegrity, AUTHORING_CATALOGUE_SCHEMA, forgetRealmRepositoryCatalogue };`)(...Object.values(artifactImports));
  const workerImports = { ...imports, ...artifact, LOCAL_BROWSER_SOURCE_ID: "fenel-browser-local",
    registryPreparationFailure, checkRegistryPreparationBuild, AUTHORING_BUILD_IDENTITY: BUILD,
    runRegistryPreparation: (request: RegistryPreparationRequest) => {
      preparationCalls.push(request);
      return options.prepare?.(request) ?? [];
    },
    clearEngineBodyMemoPartition: (partition: string) => { clearedPartitions.push(partition); },
    REPOSITORY_PARTITION: "repository",
    withEngineBodyMemoPartition: (partition: string, run: () => unknown) => {
      preparationPartitions.push(partition);
      return run();
    },
    REPOSITORY_IDENTITY_MANIFEST: { digest: options.repository ? "repository-identity" : "unused" },
    loadAuthoringCatalogue: async (index: object) => options.repository && index === options.repository.index
      ? structuredClone(options.repository.result) : undefined,
    repositoryCatalogueIndex: { chunks: [] }, publicRepositoryCatalogueIndex: options.repository?.index ?? { chunks: [] },
    dynamicImport: async () => { throw new Error("The repository catalogue is not admitted here."); } };
  const worker = new Function(...Object.keys(workerImports), `${workerCode}; return {
    run, current: () => base, active, discoveryAborts, cancelled, contexts, moduleContexts,
    message: data => scope.onmessage({ data }) };`)(...Object.values(workerImports)) as {
    run(input: Input): Promise<void>; current(): { registry: object; evaluateContext: object } | undefined;
    active: Set<number>; discoveryAborts: Map<number, object>; cancelled: Set<number>;
    contexts: Map<number, object>; moduleContexts: Map<string, object>; message(data: object): void;
  };
  return { ...worker, probe: () => workerGlobal[Symbol.for("fenel.authoring-catalogue.initialize")], input, maps, reads, replies, resolutions, functions, entities, registry, sections, pool, authority, frame,
    preparationCalls, preparationPartitions, clearedPartitions,
    readers: () => readers, acquisitions: () => acquisitions, fail: (value: typeof failure) => { failure = value; } };
}

describe("same-realm Local registry preparation", () => {
  const request = { kind: "fields" as const, roots: [], options: { mode: "strict-embedded" as const,
    lock: new Map([["field/repository", "field-id"]]) } };
  const command = (id: number, initializationId = 1, localSourceId = "this-source") => ({
    id, method: "prepare-registry-step", initializationId, localSourceId, request, build: BUILD,
  } as unknown as Input);

  test("the exact initialized source invokes the existing closed runner in its private partition", async () => {
    const h = harness(false, { prepare: captured => {
      expect(captured).toBe(request);
      if (captured.kind !== "fields") throw new Error("Unexpected preparation request");
      expect(captured.options.lock).toBe(request.options.lock);
      return [];
    } });
    await h.run(h.input());
    expect(h.replies[0]).toMatchObject({ ok: true });
    await h.run(command(2));
    expect(h.replies.at(-1)).toEqual({ id: 2, ok: true, result: { registryPreparation: { ok: true, value: [], build: BUILD } } });
    expect(h.preparationCalls).toEqual([request]);
    expect(h.preparationPartitions).toEqual(["local:this-source"]);
    expect(h.current()?.registry).toBe(h.registry);
    expect(h.active.size).toBe(0);
  });

  test("uninitialized, account, wrong-source, old-generation and authored-context requests refuse", async () => {
    for (const mode of ["uninitialized", "account", "source", "generation", "draft"] as const) {
      const h = harness();
      if (mode === "account") await h.run({ ...h.input(), localSourceId: undefined, accountId: "account" });
      else if (mode !== "uninitialized") await h.run(h.input());
      const data = command(2, mode === "generation" ? 0 : 1, mode === "source" ? "other-source" : "this-source");
      await h.run(mode === "draft" ? { ...data, contextId: 9 } as unknown as Input : data);
      expect(h.replies.at(-1)?.ok).toBe(false);
      expect(h.preparationCalls).toEqual([]);
      expect(h.preparationPartitions).toEqual([]);
    }
  });

  test("publication seals this generation, and an old seal cannot close a newer one", async () => {
    const h = harness();
    await h.run(h.input());
    h.message({ id: 2, method: "seal-registry-preparation", initializationId: 1, localSourceId: "this-source" });
    await h.run(command(3));
    expect(h.replies.at(-1)?.ok).toBe(false);
    expect(h.preparationCalls).toEqual([]);
    await h.run(h.input(4));
    h.message({ id: 5, method: "seal-registry-preparation", initializationId: 1, localSourceId: "this-source" });
    await h.run(command(6, 4));
    expect(h.replies.at(-1)?.ok).toBe(true);
    await h.run(command(7, 1));
    expect(h.replies.at(-1)?.ok).toBe(false);
    expect(h.preparationCalls).toHaveLength(1);
  });

  test("a seal carried by an authored context cannot close host preparation", async () => {
    const h = harness();
    await h.run(h.input());
    for (const scope of [{ contextId: 0 }, { scope: {} }, { sourceModule: "local" }])
      h.message({ id: 2, method: "seal-registry-preparation", initializationId: 1, localSourceId: "this-source", ...scope });
    await h.run(command(3));
    expect(h.replies.at(-1)?.ok).toBe(true);
    expect(h.preparationCalls).toHaveLength(1);
  });

  test("release and failed reinitialization invalidate the prior generation", async () => {
    for (const stop of ["release", "failed initialization"] as const) {
      const h = harness();
      await h.run(h.input());
      if (stop === "release") h.message({ id: 2, method: "release" });
      else { h.fail("registry"); await h.run(h.input(2)); }
      await h.run(command(3));
      expect(h.replies.at(-1)?.ok).toBe(false);
      expect(h.preparationCalls).toEqual([]);
    }
  });

  test("cancellation during the scheduling turn never enters the kernel", async () => {
    const h = harness();
    await h.run(h.input());
    const waiting = h.run(command(2));
    h.message({ id: 2, method: "cancel" });
    await waiting;
    expect(h.replies.filter(reply => reply.id === 2)).toEqual([]);
    expect(h.preparationCalls).toEqual([]);
    expect(h.active.size).toBe(0);
  });

  test("kernel errors leave the checked worker alive and retain their diagnostic envelope", async () => {
    const { FieldIdentityKernelError } = await import("../../../../../../implementations/typescript/engine/src/field-identity");
    const diagnostic = { $tag: "FieldIdentityDuplicateCodeName", message: "Fixture duplicate field" } as never;
    const error = new FieldIdentityKernelError(diagnostic);
    const h = harness(false, { prepare: () => { throw error; } });
    await h.run(h.input());
    await h.run(command(2));
    expect(h.replies.at(-1)).toEqual({ id: 2, ok: true, result: {
      registryPreparation: { ok: false, ...registryPreparationFailure(error), build: BUILD },
    } });
    expect(h.current()?.registry).toBe(h.registry);
    expect(h.active.size).toBe(0);
  });
});

// L5a: the two signature borrow operations take the same Local gate as every
// preparation step (exact initialization, source and generation; sealed by
// publication; the build, L5a-finish) and run in the source's private memo
// partition.
describe("Local signature borrow operations", () => {
  const borrows = [
    { kind: "signatureAuthoredPlans" as const, rows: [{ id: "row-a" }], path: "registry/signatures/authored",
      keys: ["registry/signatures/authored\u0002row-a-key"] },
    { kind: "signatureInference" as const, arguments: [[], [], [], [], "registry/signatures"], key: "page-key" },
  ];
  const command = (id: number, request: RegistryPreparationRequest, initializationId = 1, localSourceId = "this-source",
    build: string | null = BUILD) => ({
    id, method: "prepare-registry-step", initializationId, localSourceId, request, ...(build === null ? {} : { build }),
  } as unknown as Input);

  for (const request of borrows) test(`${request.kind} runs under local:<source> for the exact initialization`, async () => {
    const answer = { status: "Solved", items: ["plan"] } as unknown as RegistryPreparationResult;
    const h = harness(false, { prepare: captured => { expect(captured).toEqual(request); return answer; } });
    await h.run(h.input());
    await h.run(command(2, request));
    expect(h.replies.at(-1)).toEqual({ id: 2, ok: true, result: { registryPreparation: { ok: true, value: answer, build: BUILD } } });
    expect(h.preparationPartitions).toEqual(["local:this-source"]);
  });

  for (const request of borrows) test(`${request.kind} refuses a wrong initialization, a wrong source and a sealed generation`, async () => {
    for (const mode of ["generation", "source", "sealed", "uninitialized"] as const) {
      const h = harness();
      if (mode !== "uninitialized") await h.run(h.input());
      if (mode === "sealed") h.message({ id: 2, method: "seal-registry-preparation", initializationId: 1, localSourceId: "this-source" });
      await h.run(command(3, request, mode === "generation" ? 0 : 1, mode === "source" ? "other-source" : "this-source"));
      expect(h.replies.at(-1)?.ok).toBe(false);
      expect(h.preparationCalls).toEqual([]);
      expect(h.preparationPartitions).toEqual([]);
    }
  });

  // L5a-finish: every borrowed kind (the existing field, delta, facet and
  // constructor steps too) is refused before any work for a page of another
  // build, or one that names none; the refusal names this worker's build.
  const everyKind: RegistryPreparationRequest[] = [
    { kind: "fields", roots: [], options: { mode: "strict-embedded", lock: new Map() } },
    { kind: "fieldsDelta", roots: [], options: { mode: "strict-embedded", lock: new Map() }, baseKey: "key", roster: [] },
    { kind: "facets", entities: [], identities: [], directives: [] },
    { kind: "constructors", entities: [] },
    ...borrows,
  ];
  for (const request of everyKind) test(`a ${request.kind} request of another build is refused before any work`, async () => {
    for (const build of ["page-build", "", null]) {
      const h = harness(false, { prepare: () => { throw new Error("planned for another build"); } });
      await h.run(h.input());
      await h.run(command(2, request, 1, "this-source", build));
      expect(h.replies.at(-1)).toEqual({ id: 2, ok: true, result: {
        registryPreparation: { ok: false, ...registryPreparationFailure(new RegistryPreparationBuildMismatch()), build: BUILD } } });
      expect(h.preparationCalls).toEqual([]);
      expect(h.preparationPartitions).toEqual([]);
    }
  });
});

describe("captured local catalogue preparation", () => {
  test("the production callback preserves output and every scoped lookup while projecting each roster once", async () => {
    const before = harness(true), after = harness();
    await before.run(before.input());
    await after.run(after.input());
    expect(after.replies).toEqual(before.replies);
    expect(after.replies[0]?.ok).toBe(true);
    expect(after.reads.length).toBe(8);
    expect(before.maps).toEqual({ entities: 8, functions: 8 });
    expect(after.maps).toEqual({ entities: 1, functions: 1 });
    expect(new Set(before.reads).size).toBe(8);
    expect(new Set(after.reads).size).toBe(1);
    expect(after.resolutions.map(({ typeName, target }) => ({ typeName, target })))
      .toEqual(before.resolutions.map(({ typeName, target }) => ({ typeName, target })));
    for (const captured of after.reads) {
      expect(captured.registry).toBe(after.registry);
      expect(captured.catalog).toBe(after.sections);
      expect(captured.session.evaluateContext === after.current()?.evaluateContext).toBe(true);
      expect(captured.session.evaluateContext._authority).toBe(after.authority);
      expect(captured.session.evaluateContext._activeTags).toEqual(["this-source"]);
      expect(captured.types).toEqual(Array.from(after.entities, entity => ({ id: entity.id, name: entity.id })));
      expect(captured.functionRows.map(row => row.function)).toEqual(after.functions);
      expect(captured.functionRows[2]?.function).toBe(after.functions[2]);
    }
    const result = after.replies[0]?.result as { catalog: { presentations: Array<{ label?: string }> } };
    expect(result.catalog.presentations[0]?.label).toBe("First label");
    expect(result.catalog.presentations[4]?.label).toBe("Updated label");
    expect(after.resolutions.every(row => row.pool === after.pool && row.frame === after.current()?.evaluateContext)).toBe(true);
    expect(after.current()?.evaluateContext).toMatchObject({ preserved: "evaluation hook" });
    expect(after.active.size).toBe(0);
  });

  test("new initialization captures its own rosters and source tags without retaining prior scoped labels", async () => {
    const h = harness();
    await h.run(h.input());
    const first = h.reads[0]!;
    const other = h.input(2, "other-source");
    other.entities = [];
    other.functions = undefined;
    await h.run(other);
    const next = h.reads[8]!;
    expect(next).not.toBe(first);
    expect(next.types).toEqual([]);
    expect(next.functionRows).toEqual([]);
    expect(next.session.evaluateContext._activeTags).toEqual(["other-source"]);
    expect(first.session.evaluateContext._activeTags).toEqual(["this-source"]);
    const result = h.replies[1]?.result as { catalog: { presentations: Array<{ label?: string }> } };
    expect(result.catalog.presentations[0]?.label).toBe("Fallback first");
    expect(h.readers()).toBe(2);
  });

  test("account and repository initialization retain their unprojected catalogue path", async () => {
    for (const repositoryOnly of [false, true]) {
      const h = harness();
      await h.run({ id: 1, method: "initialize", snapshot: { owners: [], fields: [], facets: [] }, entities: [],
        ...(repositoryOnly ? { repositoryOnly: true } : { accountId: "account" }) });
      expect(h.replies[0]?.ok).toBe(true);
      expect(h.readers()).toBe(0);
      expect(h.maps).toEqual({ entities: 0, functions: 0 });
      if (repositoryOnly) {
        expect(h.current()?.evaluateContext).not.toBe(h.frame);
        expect(h.current()?.evaluateContext).toMatchObject({ _authority: h.authority, preserved: "evaluation hook" });
        expect(h.current()?.evaluateContext).not.toHaveProperty("_activeTags");
      } else expect(h.current()?.evaluateContext).toBe(h.frame);
      expect(h.active.size).toBe(0);
    }
  });

  test("invalid source identities refuse before acquisition or roster projection", async () => {
    for (const historical of [false, true]) {
      const h = harness(historical);
      const invalid = h.input();
      invalid.accountId = "account";
      await h.run(invalid);
      expect(h.replies).toEqual([{ id: 1, ok: false, error: "The authoring source identity is unavailable." }]);
      expect(h.acquisitions()).toBe(0);
      expect(h.maps).toEqual({ entities: 0, functions: 0 });
      expect(h.current()).toBeUndefined();
      expect(h.active.size).toBe(0);
    }
  });

  test("checked registry and scoped presentation failures retain the admitted session and refusal cleanup", async () => {
    for (const historical of [false, true]) for (const failure of ["registry", "presentation"] as const) {
      const h = harness(historical);
      await h.run(h.input());
      const admitted = h.current();
      h.fail(failure);
      expect(admitted).toBeDefined();
      await h.run(h.input(2));
      expect(h.replies[1]).toEqual({ id: 2, ok: false,
        error: failure === "registry" ? "Checked registry refused" : "Scoped presentation refused" });
      // W1: a re-initialization releases the admitted snapshot before it
      // builds; a refused one leaves the realm empty (its host terminates it).
      expect(h.current()).toBeUndefined();
      expect(h.active.size).toBe(0);
      expect(h.cancelled.size).toBe(0);
      expect(h.discoveryAborts.size).toBe(0);
    }
  });
});

// Lane S (Nov 8): the public (repository-only) worker adopts its build-owned
// catalogue under the repository identity checks, like the Local worker,
// instead of rebuilding it (84 s in the browser worker); any doubt is live.
describe("public worker repository catalogue", () => {
  const catalog = { types: [{ name: "Beta" }, { name: "Alpha" }], capabilities: [], functions: [{ label: "f", id: "std:f" }],
    exactFunctionRoutes: [], operatorRoutes: [], operatorCodeNameByNotation: new Map(), shipped: true };
  const displayCatalog = [{ id: "function", label: "Functions", entries: [] }];
  const shape = { functions: ["std:f"], pool: "pool", operators: "operators" };
  const digest = async (value: object) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const index = async (overrides: Record<string, unknown> = {}) => ({ schema: AUTHORING_CATALOGUE_SCHEMA, sourceDigest: "build",
    identityDigest: "repository-identity", sourceId: "fenel-repository", fingerprint: await digest(shape), referenceRouteSplit: 0,
    collections: [], chunks: [], ...overrides });
  let last: ReturnType<typeof harness> | undefined;
  const initialize = async (repositoryIndex: Record<string, unknown>, fingerprintShape: object = shape) => {
    const h = harness(false, { repository: { index: repositoryIndex, result: { catalog, displayCatalog }, shape: fingerprintShape } });
    await h.run({ id: 1, method: "initialize", snapshot: { owners: [], fields: [], facets: [] }, entities: [], repositoryOnly: true });
    expect(h.replies[0]?.ok).toBe(true);
    last = h;
    return h.replies[0]!.result as { catalog: Record<string, unknown>; displayCatalog: object[] };
  };

  test("adopts the shipped repository projection, collated for this reader", async () => {
    const result = await initialize(await index());
    const h = last!;
    expect(result.catalog.live).toBeUndefined();
    expect(result.catalog.shipped).toBe(true);
    expect(result.catalog.types).toEqual([{ name: "Alpha" }, { name: "Beta" }]);
    expect(result.displayCatalog).toEqual(displayCatalog);
    expect(h.probe()).toMatchObject({ repositoryOnly: true, source: "repository" });
  });

  test("another repository identity, source or registry shape runs the live projection", async () => {
    for (const [repositoryIndex, fingerprintShape] of [
      [await index({ identityDigest: "another-identity" }), shape],
      [await index({ sourceId: "fenel-browser-local" }), shape],
      [await index(), { ...shape, functions: ["std:f", "std:g"] }],
    ] as const) {
      const result = await initialize(repositoryIndex, fingerprintShape);
      expect(result.catalog.live).toBe(true);
      expect(result.catalog.shipped).toBeUndefined();
    }
    expect(last?.probe()).toMatchObject({ repositoryOnly: true, source: "live", reason: "fingerprint" });
  });
});

// W1: a realm reused for its holder's next snapshot never keeps two Local
// registries alive, and a released realm answers nothing for the old snapshot.
describe("released and reused Local catalogue realm", () => {
  test("release drops the snapshot's registry, sessions and sources; later requests refuse", async () => {
    const h = harness();
    await h.run(h.input());
    // Stand-ins for a scoped draft session and a module frame of this snapshot.
    h.contexts.set(7, { registry: h.current()!.registry });
    h.moduleContexts.set("module", { session: { registry: h.current()!.registry } });
    expect(h.current()).toBeDefined();
    h.message({ id: 3, method: "release" });
    expect(h.clearedPartitions).toEqual(["reader-physical:1"]);
    expect(h.current()).toBeUndefined();
    expect(h.contexts.size).toBe(0);
    expect(h.moduleContexts.size).toBe(0);
    await h.run({ id: 4, method: "project-reader-presentations", contextId: 0, targets: ["first"] } as unknown as Input);
    expect(h.replies.at(-1)).toEqual({ id: 4, ok: false, error: "The editing worker is not ready." });
    expect(h.active.size).toBe(0);
  });

  test("the next initialization makes the previous registry unreachable before it builds", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let built = 0;
    const observed: { previous?: WeakRef<object>; collected?: boolean; current?: unknown } = {};
    const fresh = () => ({ getFunction: () => undefined, getUuid: (id: string) => id,
      getIdentifiedEntity: () => undefined, getEntityNominalIdentity: (id: string) => id, build: ++built });
    let h!: ReturnType<typeof harness>;
    h = harness(false, { retainReads: false, acquire: async () => {
      if (built === 0) { const first = fresh(); observed.previous = new WeakRef(first); return first; }
      observed.current = h.current();
      await gate;
      return fresh();
    } });
    await h.run(h.input());
    expect(observed.previous?.deref()).toBeDefined();
    const next = h.run(h.input(2));
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
    expect(observed.current).toBeUndefined();
    for (let attempt = 0; attempt < 5 && observed.previous?.deref(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      Bun.gc(true);
    }
    observed.collected = observed.previous?.deref() === undefined;
    release();
    await next;
    expect(observed.collected).toBe(true);
    expect(h.replies.map(reply => reply.ok)).toEqual([true, true]);
    expect((h.current()?.registry as { build?: number }).build).toBe(2);
  });
});


describe("pre-initialization repository registry preparation", () => {
  const request: RegistryPreparationRequest = { kind: "fields", roots: [], options: { mode: "strict-embedded", lock: new Map() } };
  const settle = async (h: ReturnType<typeof harness>, count: number) => {
    for (let i = 0; i < 200 && h.replies.length < count; i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(h.replies.length).toBe(count);
  };
  test("repository steps precede later initialization and run outside memo partitions", async () => {
    const h = harness();
    h.message({ id: 20, method: "prepare-repository-registry-step", request, build: BUILD });
    h.message(h.input(21));
    await settle(h, 2);
    expect(h.replies.map(reply => reply.id)).toEqual([20, 21]);
    expect(h.replies.every(reply => reply.ok)).toBe(true);
    expect(h.preparationCalls).toEqual([request]);
    expect(h.preparationPartitions).toEqual([]);
    h.message({ id: 22, method: "prepare-repository-registry-step", request, build: BUILD });
    await settle(h, 3);
    expect(h.replies.at(-1)?.ok).toBe(false);
    expect(h.preparationCalls).toHaveLength(1);
  });
  test("authored coordinates and fieldsDelta never reach the kernel", async () => {
    for (const key of ["contextId", "scope", "sourceModule", "initializationId", "localSourceId", "fieldsDelta"]) {
      const h = harness();
      h.message({ id: 20, method: "prepare-repository-registry-step", request: key === "fieldsDelta" ? { ...request, kind: "fieldsDelta" } : request,
        build: BUILD, ...(key === "fieldsDelta" ? {} : { [key]: undefined }) });
      await settle(h, 1);
      expect(h.replies[0]?.ok).toBe(false);
      expect(h.preparationCalls).toEqual([]);
    }
  });
  // Lane S (Nov 8): the page's build of the same repository borrows the public
  // worker's steps after its repository-only snapshot, in the repository memo
  // partition that worker's checked build filled; any step kind (signature
  // plans included). A Local snapshot never answers repository steps.
  test("after a repository-only snapshot, every step kind runs in the repository partition", async () => {
    const h = harness();
    h.message({ id: 1, method: "initialize", snapshot: { owners: [], fields: [], facets: [] }, entities: [], repositoryOnly: true });
    await settle(h, 1);
    expect(h.replies[0]?.ok).toBe(true);
    const signature = { kind: "signatureInference", arguments: [], key: "k" } as unknown as RegistryPreparationRequest;
    const delta = { ...request, kind: "fieldsDelta", baseKey: "b", roster: [] } as unknown as RegistryPreparationRequest;
    h.message({ id: 2, method: "prepare-repository-registry-step", request, build: BUILD });
    h.message({ id: 3, method: "prepare-repository-registry-step", request: signature, build: BUILD });
    h.message({ id: 4, method: "prepare-repository-registry-step", request: delta, build: BUILD });
    await settle(h, 4);
    expect(h.replies.slice(1).map(reply => [reply.id, reply.ok])).toEqual([[2, true], [3, true], [4, true]]);
    expect(h.preparationCalls).toEqual([request, signature, delta]);
    expect(h.preparationPartitions).toEqual(["repository", "repository", "repository"]);
    // A released snapshot no longer lends its realm.
    h.message({ id: 5, method: "release" });
    h.message({ id: 6, method: "prepare-repository-registry-step", request, build: BUILD });
    await settle(h, 5);
    expect(h.replies.at(-1)).toMatchObject({ id: 6, ok: false });
    expect(h.preparationCalls).toHaveLength(3);
  });
  test("a Local snapshot refuses repository steps", async () => {
    const h = harness();
    h.message(h.input(1));
    await settle(h, 1);
    expect(h.replies[0]?.ok).toBe(true);
    h.message({ id: 2, method: "prepare-repository-registry-step", request, build: BUILD });
    await settle(h, 2);
    expect(h.replies[1]).toMatchObject({ id: 2, ok: false });
    expect(h.preparationCalls).toEqual([]);
  });
  test("a repository step of another build is refused before any work and names this worker's build", async () => {
    for (const build of ["page-build", undefined]) {
      const h = harness();
      h.message({ id: 20, method: "prepare-repository-registry-step", request, ...(build === undefined ? {} : { build }) });
      await settle(h, 1);
      expect(h.replies[0]).toEqual({ id: 20, ok: true, result: {
        registryPreparation: { ok: false, ...registryPreparationFailure(new RegistryPreparationBuildMismatch()), build: BUILD } } });
      expect(h.preparationCalls).toEqual([]);
    }
    const h = harness();
    h.message({ id: 20, method: "prepare-repository-registry-step", request, build: BUILD });
    await settle(h, 1);
    expect(h.replies[0]).toEqual({ id: 20, ok: true, result: { registryPreparation: { ok: true, value: [], build: BUILD } } });
  });
});
