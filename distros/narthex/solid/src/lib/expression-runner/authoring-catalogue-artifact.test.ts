// Install the official Bun host before engine dependencies seal startup.
// Pool observations require its real Proxy detector even with the memo off.
import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import { cp, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serialize } from "bun:jsc";
import { decodeAuthoringCatalogue, encodeAuthoringCatalogue, loadAuthoringCatalogue, readAuthoringCatalogueChunks, settleWithin,
  localCatalogueRoster, REPOSITORY_READ_GRACE_MS, chunkIntegrity, forgetRealmRepositoryCatalogue, realmRepositoryCatalogue,
  repositoryCatalogueFingerprint, repositoryCatalogueFingerprintShape,
  repositoryCatalogueRealmKey, authoringCatalogueChunkDigest, type AuthoringCatalogueIndex, type RepositoryCatalogue } from "./authoring-catalogue-artifact";
import { decodeCatalogueTransport } from "./authoring-catalogue-transport";
import { isPublicBootstrapInput } from "../../../public-bootstrap-inputs.mjs";
import { createEngineBootstrapRegistry } from "../../../../../../implementations/typescript/engine/src/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { viewModule } from "../../../../../../implementations/typescript/engine/src/modules/view";
import { invokeCallable } from "@fenel/engine/expressions";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { mergeLocalCatalogueDelta, type LocalCatalogueDelta } from "./authoring-catalogue-delta";
import type { LocalCatalogueResult } from "./authoring-catalogue-artifact";

const fixture = fileURLToPath(new URL("./authoring-catalogue-artifact.fixture.ts", import.meta.url));
const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));

// C1: the original cases run against the actual Fenel owner. The harness only
// supplies its source registry/frame; no TypeScript admission policy remains.
describe("Local catalogue admission (view.localCatalogueAdmission)", () => {
  const registry = createEngineBootstrapRegistry([stdModule, viewModule]);
  const frame = registry.evaluateContext();
  const admit = (roster: ReturnType<typeof localCatalogueRoster>) => invokeCallable(
    { $ref: registry.getFunction("view.localCatalogueAdmission")!.id }, [roster], frame) as { $tag: string; _0?: string };
  const fn = { id: "f1", params: [], returns: { $ref: "Number" }, body: 1 };
  const plain = { localSourceId: "fenel-browser-local", entities: [], functions: [fn], localRepresentations: [],
    snapshot: { owners: [{ ownerKey: "function:f1", storageName: "f1", kind: "function", definition: fn }], fields: [], facets: [] } };
  // A Local type T with its account field and the field's Codeable facet.
  const field = { id: "fld", currentCodeName: "n", status: "live", realm: "account", reuseVisibility: "account" };
  const typed = { ...plain, entities: [{ id: "T", type: { $ref: "Number" } }],
    snapshot: { owners: [...plain.snapshot.owners, { ownerKey: "type:T", storageName: "T", kind: "type", definition: { id: "T" } }],
      fields: [field], facets: [{ fieldId: "fld", typeName: "Codeable", methods: { codeName: "n" }, scope: "account", priority: 100 }] } };
  const seen: Parameters<typeof localCatalogueRoster>[2] = { observed: true, repositoryFingerprint: "r", catalogueFingerprint: "r", localIdentities: ["f1", "T", "fld"],
    localValueIds: [], localRowTargets: ["T", "fld"], repositoryMentions: [], repositoryValueMentions: [], entityCollisions: [], nameCollisions: [], typeNameCollisions: [], repositoryKeepsTypeNames: [], localShapesTypeNames: [],
    localTakesTypeNames: [], rootCollisions: [] };
  const roster = (data: unknown, source = "fenel-browser-local", observation: Partial<typeof seen> = {}) =>
    localCatalogueRoster(data as never, source, { ...seen, localValueIds: (data as { localValueIds?: string[] }).localValueIds ?? [], ...observation });
  test("admits Local functions, types, account fields and their facets", () => {
    expect(admit(roster(plain)).$tag).toBe("Ok");
    expect(admit(roster({ ...plain, functions: [], snapshot: { owners: [], fields: [], facets: [] } })).$tag).toBe("Ok");
    expect(admit(roster(typed)).$tag).toBe("Ok");
    expect(admit(roster({ ...typed, localRepresentations: [{ typeName: "Labelable", args: ["T"], methods: { label: "Local type" } }] })).$tag).toBe("Ok");
  });
  test("admits Local type names the type list places", () => {
    expect(admit(roster(typed, undefined, { typeNameCollisions: ["Person"], localTakesTypeNames: ["Person"] })).$tag).toBe("Ok");
    expect(admit(roster(typed, undefined, { typeNameCollisions: ["Number"], repositoryKeepsTypeNames: ["Number"] })).$tag).toBe("Ok");
    expect(admit(roster(typed, undefined, { typeNameCollisions: ["Date"], localShapesTypeNames: ["Date"] })).$tag).toBe("Ok");
    expect(admit(roster(typed, undefined, { typeNameCollisions: ["Person", "Number", "Date"], localTakesTypeNames: ["Person"],
      repositoryKeepsTypeNames: ["Number"], localShapesTypeNames: ["Date"] })).$tag).toBe("Ok");
  });
  test("admits representation targets witnessed by the admitted saved data identities", () => {
    const saved = { ...plain, localValueIds: ["saved-number"] };
    expect(admit(roster(saved, undefined, { localRowTargets: ["saved-number"] })).$tag).toBe("Ok");
    expect(admit(roster(saved, undefined, { localRowTargets: ["saved-number", "f1"] })).$tag).toBe("Ok");
  });
  test("only represented saved identities participate in repository collision refusal", () => {
    const saved = { ...plain, localValueIds: ["saved-number", "std:negate"] };
    expect(admit(roster(saved, undefined, { localRowTargets: ["saved-number"], repositoryValueMentions: ["std:negate"] })).$tag).toBe("Ok");
    for (const id of ["std:negate", "repository-uuid", "Number", "repository-field", "repository-label"]) {
      expect(admit(roster({ ...plain, localValueIds: [id] }, undefined, { localRowTargets: [id], repositoryValueMentions: [id] })))
        .toEqual({ $tag: "Err", _0: "LocalValueIdentityCollides" });
    }
  });
  test("saved identity evidence cannot admit unknown, malformed or structural row targets", () => {
    for (const ids of [[], ["saved-number"]]) {
      expect(admit(roster({ ...plain, localValueIds: ids }, undefined, { localRowTargets: ["unknown"] })))
        .toEqual({ $tag: "Err", _0: "LocalRowTargetsRepository" });
      expect(admit(roster({ ...plain, localValueIds: ids }, undefined, { localRowTargets: [""] })))
        .toEqual({ $tag: "Err", _0: "LocalRowTargetsRepository" });
    }
    for (const ids of [[""], [42], [undefined], ["saved-number", ""], "saved-number"]) {
      expect(admit(roster({ ...plain, localValueIds: ids }, undefined, { localRowTargets: [""] })))
        .toEqual({ $tag: "Err", _0: "InvalidLocalValueIdentities" });
    }
    expect(admit(roster({ ...plain, localValueIds: ["saved-number"] }, undefined, { localRowTargets: ["saved-number", "std:negate"] })))
      .toEqual({ $tag: "Err", _0: "LocalRowTargetsRepository" });
    // New evidence does not reorder any existing source/fingerprint refusal.
    expect(admit(roster({ ...plain, localValueIds: [""] }, "other"))).toEqual({ $tag: "Err", _0: "OtherLocalSource" });
    expect(admit(roster({ ...plain, localValueIds: [""] }, undefined, { catalogueFingerprint: "other" })))
      .toEqual({ $tag: "Err", _0: "RepositoryChanged" });
  });
  const refusals: [string, unknown, string?, Partial<typeof seen>?][] = [
    ["OtherLocalSource", plain, "another-source"],
    ["LocalRowTargetsRepository", { ...plain, localRepresentations: [{ typeName: "Labelable", args: ["std:negate"], methods: {} }] }, undefined,
      { localRowTargets: ["std:negate"] }],
    ["LocalSourceModulesPresent", { ...plain, sourceModules: [{}] }],
    ["DuplicateLocalFunctions", { ...plain, functions: [fn, fn], snapshot: { ...plain.snapshot, owners: [plain.snapshot.owners[0], plain.snapshot.owners[0]] } }],
    ["DuplicateLocalTypes", { ...typed, entities: [typed.entities[0], typed.entities[0]] }],
    ["UnsupportedLocalOwner", { ...plain, snapshot: { ...plain.snapshot, owners: [{ ...plain.snapshot.owners[0], kind: "other" }] } }],
    ["UnmatchedLocalOwners", { ...plain, snapshot: { ...plain.snapshot, owners: [{ ...plain.snapshot.owners[0], definition: { id: "other" } }] } }],
    ["UnmatchedLocalOwners", { ...plain, snapshot: { ...plain.snapshot, owners: [] } }],
    ["UnmatchedLocalOwners", { ...typed, entities: [] }],
    ["RepositoryFieldInLocal", { ...typed, snapshot: { ...typed.snapshot, fields: [{ ...field, realm: "repository" }] } }],
    ["LocalFacetTargetsRepository", { ...typed, snapshot: { ...typed.snapshot, facets: [{ ...typed.snapshot.facets[0], fieldId: "repository-field" }] } }],
    ["LocalFactsUnobserved", typed, undefined, { observed: false }],
    ["RepositoryChanged", typed, undefined, { catalogueFingerprint: "other" }],
    ["LocalRowTargetsRepository", typed, undefined, { localRowTargets: ["T", "std:negate"] }],
    ["LocalRowTargetsRepository", typed, undefined, { localRowTargets: [""] }],
    ["LocalIdentityCollides", typed, undefined, { repositoryMentions: ["T"] }],
    ["LocalTypeCollides", typed, undefined, { entityCollisions: ["T"] }],
    ["LocalNameCollides", typed, undefined, { nameCollisions: ["Count"] }],
    ["LocalNameCollides", typed, undefined, { nameCollisions: ["Count"], typeNameCollisions: ["Person"], localTakesTypeNames: ["Person"] }],
    ["LocalTypeNameCollides", typed, undefined, { typeNameCollisions: ["Person"] }],
    ["LocalTypeNameCollides", typed, undefined, { typeNameCollisions: ["Person", "Date"], localTakesTypeNames: ["Person"] }],
    ["LocalRootShadowsRepository", typed, undefined, { rootCollisions: ["std"] }],
  ];
  for (const [reason, data, source, observation] of refusals) test(`refuses: ${reason}`, () => {
    expect(admit(roster(data, source ?? "fenel-browser-local", observation))).toEqual({ $tag: "Err", _0: reason });
  });
});

describe("realm repository catalogue (W1)", () => {
  const index = { schema: "fenel.authoring-catalogue.v1", sourceDigest: "s", identityDigest: "i", sourceId: "fenel-browser-local",
    fingerprint: "f", chunks: [{ sha256: "c" }] } as never;
  test("one verified read per realm key; another epoch or index reads again; a failed read is forgotten", async () => {
    forgetRealmRepositoryCatalogue();
    let reads = 0;
    const value = { index, result: { catalog: { functions: [{ id: "a" }] }, displayCatalog: [] } } as never as RepositoryCatalogue;
    const read = async () => { reads++; return value; };
    const key = repositoryCatalogueRealmKey(index, "fenel-browser-local", 1);
    expect(await realmRepositoryCatalogue(key, read)).toBe(value);
    expect(await realmRepositoryCatalogue(key, read)).toBe(value);
    expect(reads).toBe(1);
    // The retained rows are shared by later initializations: frozen.
    expect(Object.isFrozen((value.result.catalog.functions as unknown as object[])[0])).toBe(true);
    expect(await realmRepositoryCatalogue(repositoryCatalogueRealmKey(index, "fenel-browser-local", 2), read)).toBe(value);
    expect(reads).toBe(2);
    expect(await realmRepositoryCatalogue(repositoryCatalogueRealmKey({ ...(index as object), fingerprint: "g" } as never, "fenel-browser-local", 2), read)).toBe(value);
    expect(reads).toBe(3);
    const failed = repositoryCatalogueRealmKey(index, "fenel-browser-local", 3);
    expect(await realmRepositoryCatalogue(failed, async () => { reads++; return undefined; })).toBeUndefined();
    expect(await realmRepositoryCatalogue(failed, read)).toBe(value);
    expect(reads).toBe(5);
    forgetRealmRepositoryCatalogue();
  });

  test("byte interpretation participates in the realm key", () => {
    const key = repositoryCatalogueRealmKey(index, "fenel-browser-local", 1);
    expect(repositoryCatalogueRealmKey({ ...(index as object), referenceRouteSplit: 3 } as never, "fenel-browser-local", 1)).not.toBe(key);
    expect(repositoryCatalogueRealmKey({ ...(index as object), collections: [{ path: ["catalog", "types"], length: 1 }] } as never,
      "fenel-browser-local", 1)).not.toBe(key);
  });
});

describe("repository catalogue dispatch observation", () => {
  const registry = { modules: [], listFunctions: () => [], listIdentifiedEntities: () => [],
    listConstructorSignatures: () => [], listCapabilityMethodSignatures: () => [], evaluateContext: () => ({ _moduleNames: new Set() }) } as never;
  const row = (label: unknown) => ({ typeName: "Labelable", args: ["repository-function"], methods: { label }, priority: 0 });
  const frame = (rows: unknown[]) => ({ _specRegistry: { listClasses: () => [], listInstances: () => rows } }) as never;
  const observe = (rows: unknown[]) => repositoryCatalogueFingerprintShape(registry, frame(rows)).pool;

  test("method data and equal-priority dispatch order change the fingerprint", () => {
    const first = row("First"), second = row("Second");
    expect(observe([first])).not.toBeNull();
    expect(observe([first])).not.toBe(observe([second]));
    expect(observe([first, second])).not.toBe(observe([second, first]));
    expect(observe([row(undefined)])).not.toBe(observe([row(null)]));
    const repository = repositoryCatalogueFingerprintShape(registry, { _specRegistry: dispatchRegistry } as never);
    expect(repository.pool).not.toBeNull();
    expect(repository.operators).not.toBeNull();
  });

  test("unreadable observations cannot produce a reusable fingerprint", async () => {
    expect(observe([row(() => "host callable")])).toBeNull();
    await expect(repositoryCatalogueFingerprint(registry, frame([row(() => "host callable")]))).rejects.toThrow("could not be observed");
    await expect(repositoryCatalogueFingerprint(registry, {} as never)).rejects.toThrow("could not be observed");
  });
});

describe("Local reference root placement", () => {
  const catalog = (): LocalCatalogueResult["catalog"] => ({ types: [], functions: [], capabilities: [], catalogTypes: [],
    patternConstructors: [], operatorCodeNameByNotation: new Map(), operatorRoutes: [], exactFunctionRoutes: [], exactConstructorRoutes: [], referenceRoutes: [] });
  const sections = (): LocalCatalogueResult["displayCatalog"] => [
    { id: "function", label: "Installed module functions", description: "", entries: [] },
    { id: "entity", label: "Installed module types", description: "", entries: [] },
  ];
  const route = (sourceName: string, targetId: string) => ({ sourceName, targetId, status: "resolved" as const, handles: [targetId] });
  const base = { catalog: { ...catalog(), referenceRoutes: [route("repo.Type", "r"), route("system.Type", "s")] }, displayCatalog: sections() };
  const type = { $ref: "Number" };
  const localSections = sections();
  localSections[1]!.entries.push({ id: "l", name: "Local", description: "", category: "entity", entity: { id: "l", type } });
  const delta: LocalCatalogueDelta = {
    scope: { functionIds: new Set(), entityIds: new Set(["l"]), entityKeys: new Set(), modules: new Set(["local"]), mixedModules: [] },
    catalog: { ...catalog(), types: [{ id: "l", name: "Local", description: "", category: "entity", entityId: "l", type }],
      catalogTypes: [type], referenceRoutes: [route("local.Type", "l")] },
    sections: localSections, identities: ["l"], constructorOrder: [],
    rootOrder: ["repo", "local", "system"],
  };

  test("places Local type references before a following synthetic repository root", () => {
    const merged = mergeLocalCatalogueDelta(base, delta, 0, {} as never);
    expect(merged?.catalog.referenceRoutes?.map(row => row.sourceName)).toEqual(["repo.Type", "local.Type", "system.Type"]);
  });

  test("refuses missing root observations and ambiguous placements", () => {
    expect(mergeLocalCatalogueDelta(base, { ...delta, rootOrder: ["repo", "system"] }, 0, {} as never)).toBeUndefined();
    expect(mergeLocalCatalogueDelta(base, { ...delta, rootOrder: [...delta.rootOrder, "local"] }, 0, {} as never)).toBeUndefined();
    const duplicate = { ...delta, catalog: { ...delta.catalog, referenceRoutes: [route("repo.Type", "l")] } };
    expect(mergeLocalCatalogueDelta(base, duplicate, 0, {} as never)).toBeUndefined();
  });

  test("keeps the retained sequence of multiple members within each root", () => {
    const repository = { ...base, catalog: { ...base.catalog, referenceRoutes: [route("repo.Z", "r"), route("repo.A", "r2"), route("system.Type", "s")] } };
    const local = { ...delta, identities: ["l", "l2"], catalog: { ...delta.catalog, referenceRoutes: [route("local.Z", "l"), route("local.A", "l2")] } };
    expect(mergeLocalCatalogueDelta(repository, local, 0, {} as never)?.catalog.referenceRoutes?.map(row => row.sourceName))
      .toEqual(["repo.Z", "repo.A", "local.Z", "local.A", "system.Type"]);
  });

  test("accepts a uniquely attributed dotted root and refuses ambiguous prefixes", () => {
    const dotted = { ...delta, rootOrder: ["repo", "local.nested", "system"],
      catalog: { ...delta.catalog, referenceRoutes: [route("local.nested.Type", "l")] } };
    expect(mergeLocalCatalogueDelta(base, dotted, 0, {} as never)?.catalog.referenceRoutes?.map(row => row.sourceName))
      .toEqual(["repo.Type", "local.nested.Type", "system.Type"]);
    expect(mergeLocalCatalogueDelta(base, { ...dotted, rootOrder: ["repo", "local", "local.nested", "system"] }, 0, {} as never)).toBeUndefined();
  });

  test("refuses a root shared by repository and Local rows even when their names differ", () => {
    const shared = { ...delta, catalog: { ...delta.catalog, referenceRoutes: [route("repo.LocalType", "l")] } };
    expect(mergeLocalCatalogueDelta(base, shared, 0, {} as never)).toBeUndefined();
  });
});

describe("authoring catalogue transport", () => {
  test("a verified read can finish after the registry releases the event loop", async () => {
    expect(REPOSITORY_READ_GRACE_MS).toBeGreaterThanOrEqual(1_000);
    expect(REPOSITORY_READ_GRACE_MS).toBeLessThanOrEqual(10_000);
    let aborted = false;
    const started = performance.now();
    expect(await settleWithin(new Promise<string>(resolve => setTimeout(() => resolve("verified"), 100)),
      REPOSITORY_READ_GRACE_MS, () => { aborted = true; })).toBe("verified");
    expect(aborted).toBe(false);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(await settleWithin(Promise.resolve("ready"), REPOSITORY_READ_GRACE_MS)).toBe("ready");
    expect(chunkIntegrity("00ff")).toBe("sha256-AP8=");
  });

  test("a stalled optional read settles at its deadline and aborts", async () => {
    let aborted = false;
    const started = performance.now();
    const value = await settleWithin(new Promise<never>(() => {}), 50, () => { aborted = true; });
    expect(value).toBeUndefined();
    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await settleWithin(Promise.resolve(7), 50)).toBe(7);
    expect(await settleWithin(Promise.reject(new Error("x")), 50)).toBeUndefined();
  });

  test("a corrupted or missing chunk is stale, never a smaller catalogue", async () => {
    const value = { catalog: { functions: [{ id: "std:a", label: "a" }, { id: "telegram:b", label: "b" }] }, displayCatalog: [] };
    const encoded = encodeAuthoringCatalogue(value as never, 0);
    const files = new Map<string, string>();
    const index = { collections: encoded.collections, chunks: await Promise.all(encoded.chunks.map(async chunk => {
      const file = `${chunk.area}.json`;
      files.set(file, chunk.text);
      return { area: chunk.area, file, bytes: chunk.text.length, sha256: await authoringCatalogueChunkDigest(chunk.text) };
    })) } as unknown as AuthoringCatalogueIndex;
    const read = async (file: string) => { const text = files.get(file); if (text === undefined) throw new Error("missing"); return text; };
    expect(await loadAuthoringCatalogue(index, read)).toEqual(value as never);
    files.set("telegram.json", files.get("telegram.json")!.replace("telegram:b", "telegram:c"));
    expect(await readAuthoringCatalogueChunks(index, read)).toBeUndefined();
    expect(await loadAuthoringCatalogue(index, read)).toBeUndefined();
    files.delete("telegram.json");
    expect(await loadAuthoringCatalogue(index, read)).toBeUndefined();
  });

  test("restores every value the worker reply can carry, sharing included", () => {
    const shared = { $ref: "String", meta: {} };
    const proto = JSON.parse('{"__proto__": {"x": 1}}');
    const value = {
      catalog: { functions: [{ id: "std:a", label: "a", codeName: undefined, scheme: shared, nested: { scheme: shared } },
        { id: "telegram:send", label: "b", max: Infinity, min: -Infinity, nan: NaN, zero: -0, proto }],
      operatorCodeNameByNotation: new Map([["+", "add"]]), operatorRoutes: [] },
      displayCatalog: [{ id: "function", label: "F", description: "", entries: [{ id: "x", name: "x", description: "", fn: shared }] }],
    };
    const encoded = encodeAuthoringCatalogue(value as never, 0);
    expect(encoded.chunks.map(chunk => chunk.area).sort()).toEqual(["core", "std", "telegram"]);
    const decoded = decodeAuthoringCatalogue(encoded, encoded.chunks.map(chunk => chunk.text));
    expect(Buffer.from(serialize(decoded)).equals(Buffer.from(serialize(structuredClone(value))))).toBe(true);
    const functions = (decoded as unknown as typeof value).catalog.functions;
    expect(functions[0]!.scheme).toBe(functions[0]!.nested!.scheme);
    expect(Object.hasOwn(functions[0]!, "codeName")).toBe(true);
    // A missing chunk is never silently a smaller catalogue.
    expect(() => decodeAuthoringCatalogue(encoded, encoded.chunks.filter(chunk => chunk.area !== "std").map(chunk => chunk.text))).toThrow();
  });

  test("the bootstrap input roster covers the catalogue worker's import closure", () => {
    const ts = new Bun.Transpiler({ loader: "ts" }), tsx = new Bun.Transpiler({ loader: "tsx" });
    const seen = new Set<string>();
    const unresolved: string[] = [];
    const stack = [fileURLToPath(new URL("./authoring-catalog.worker.ts", import.meta.url))];
    while (stack.length) {
      const file = stack.pop()!.replaceAll("\\", "/");
      if (seen.has(file) || file.includes("/node_modules/")) continue;
      seen.add(file);
      if (!/\.(?:m?[jt]sx?)$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const entry of (file.endsWith(".tsx") ? tsx : ts).scanImports(source)) {
        if (entry.path.startsWith("node:") || entry.path.startsWith("bun:")) continue;
        // The build plugin's replay pin (engine-body-replay-plugin.mjs): build
        // output, not a source the catalogue projects.
        if (entry.path === "virtual:fenel-engine-body-replay") continue;
        try { stack.push(Bun.resolveSync(entry.path, file.slice(0, file.lastIndexOf("/")))); }
        catch { unresolved.push(`${file} -> ${entry.path}`); }
      }
    }
    const root = repository.replaceAll("\\", "/");
    // Generated outputs of this same tool are not inputs.
    const uncovered = [...seen].filter(file => file.startsWith(root)).map(file => file.slice(root.length))
      .filter(path => !isPublicBootstrapInput(path) && !path.startsWith("distros/narthex/solid/src/lib/generated/"));
    expect(unresolved).toEqual([]);
    expect(uncovered).toEqual([]);
  });
});

// One fresh process per case, like one fresh worker. Each run builds the full
// checked Local registry (minutes), runs the worker path (repository catalogue
// + Local merge, or fallback) first, then the unchanged live projection over
// the same registry, and compares them as canonical transport text.
async function run(caseName: string, directory: string, collation?: string) {
  const out = join(directory, `${caseName}-${collation ?? "default"}.txt`);
  const child = Bun.spawnSync([process.execPath, fixture, caseName, "both", out], {
    cwd: repository, env: { ...process.env, FENEL_PARSER_LEGACY: "1", ...(collation ? { FENEL_TEST_COLLATION: collation } : {}) }, stdout: "ignore", stderr: "pipe" });
  const stderr = child.stderr.toString().split("\n").filter(line => !/parse cache STALE|compiled-resolver/.test(line)).join("\n");
  if (child.exitCode !== 0) throw new Error(`${caseName} failed (${child.exitCode} ${child.signalCode}): ${stderr.slice(-2000)}`);
  const read = async (path: "worker" | "live") => ({ bytes: await readFile(`${out}-${path}`),
    meta: JSON.parse(await readFile(`${out}-${path}.json`, "utf8")) as { source: string; reason?: string; elapsedMs: number } });
  return { worker: await read("worker"), live: await read("live") };
}

describe("Local catalogue with the repository catalogue", () => {
  // [case, expected path, reader collation, expected live reason]. The UUID
  // takeover is a separate refused-input/recovery case below. "cs": Czech
  // collation reorders rows. "types": two Local record types with account
  // fields, facets and constructor functions; "mixed" adds a plain function.
  // "facet": rejected raw input targets an immutable repository field; the
  // missing-live-field filter preserves its canonical parameter label.
  const cases: [string, "repository" | "live", string | undefined, string | undefined][] = [
    ["empty", "repository", undefined, undefined], ["captured", "repository", undefined, undefined],
    ["captured", "repository", "cs", undefined], ["captured", "live", "th", "collation"],
    ["presentation", "live", undefined, "LocalRowTargetsRepository"],
    ["types", "repository", undefined, undefined], ["types", "repository", "cs", undefined], ["mixed", "repository", undefined, undefined],
    ["named", "repository", undefined, undefined], ["type-only", "repository", undefined, undefined],
    ["person", "repository", undefined, undefined], ["date-name", "repository", undefined, undefined],
    ["saved-number", "repository", undefined, undefined], ["saved-mixed", "repository", undefined, undefined],
    ["facet", "live", undefined, "LocalFacetTargetsRepository"]];
  const only = process.env.FENEL_CATALOGUE_CASES?.split(",");
  if (!only || only.includes("uuid")) test("uuid: repository takeover refuses, then the same process admits a valid Local snapshot", async () => {
    const scratch = join(repository, ".tmp");
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, "fenel-catalogue-refusal-"));
    try {
      const out = join(directory, "refusal.json");
      const child = Bun.spawnSync([process.execPath, fixture, "uuid", "refusal", out], {
        cwd: repository, env: { ...process.env, FENEL_PARSER_LEGACY: "1" }, stdout: "ignore", stderr: "pipe",
      });
      if (child.exitCode !== 0) throw new Error(`uuid refusal/recovery failed (${child.exitCode} ${child.signalCode}): ${child.stderr.toString().slice(-2000)}`);
      const result = JSON.parse(await readFile(out, "utf8"));
      expect(result.refusal).toMatchObject({ $tag: "ReservedDefinitionIdentity",
        handle: "cc2ba039-a660-42fc-aa32-46f1b71d8d29", repositoryKind: "function" });
      expect(result.recovery).toEqual({ kind: "same-process", functionId: "425cd119-f879-4af6-9dd6-ff25d0223385",
        repositoryId: "cc2ba039-a660-42fc-aa32-46f1b71d8d29", canonicalId: "std:negate",
        canonicalParameterCount: 1, canonicalBodyMatches: true });
    } finally {
      if (process.env.FENEL_CATALOGUE_KEEP) await cp(directory, process.env.FENEL_CATALOGUE_KEEP, { recursive: true });
      await rm(directory, { recursive: true, force: true });
    }
  }, 1_800_000);

  const lives = new Map<string, Buffer>();
  for (const [caseName, expected, collation, reason] of cases) {
    if (only && !only.includes(caseName)) continue;
    test(`${caseName}${collation ? ` (${collation})` : ""}: equals today's live build and takes the ${expected} path`, async () => {
      const scratch = join(repository, ".tmp");
      await mkdir(scratch, { recursive: true });
      const directory = await mkdtemp(join(scratch, "fenel-catalogue-"));
      try {
        const { worker, live } = await run(caseName, directory, collation);
        console.log(caseName, collation ?? "", JSON.stringify(worker.meta), JSON.stringify(live.meta));
        lives.set(`${caseName}/${collation ?? ""}`, live.bytes);
        expect(worker.meta.source).toBe(expected);
        if (reason) expect(worker.meta.reason).toBe(reason);
        expect(worker.bytes.equals(live.bytes)).toBe(true);
        // The Local value really changes repository presentation.
        if (caseName === "presentation") expect(live.bytes.includes("Local negate")).toBe(true);
        if (caseName === "facet") {
          expect(live.bytes.includes("Local x label")).toBe(false);
          const encoded = JSON.parse(live.bytes.toString("utf8")) as {
            collections: AuthoringCatalogueIndex["collections"]; chunks: { text: string }[];
          };
          const decoded = decodeCatalogueTransport(encoded, encoded.chunks.map(chunk => chunk.text)) as LocalCatalogueResult;
          const negate = decoded.catalog.functions.find(entry => entry.id === "std:negate");
          const parameter = negate?.params.find(field => field.key?.$tag === "NamedField"
            && field.key.ref.$ref === "4df208e5-c5c1-44d2-a94a-d91ea17b9b00");
          expect(parameter?.name).toBe("x");
          expect(parameter?.label).toEqual({ $tag: "Just", _0: "X" });
        }
        // Local rows really are in the catalogue the merge produced.
        if (caseName === "types" || caseName === "mixed") expect(live.bytes.includes("6a0d3a52-91c1-4f7e-8f5b-0d4c1a000002")).toBe(true);
        if (caseName === "named") {
          expect(live.bytes.includes("Catalogue item")).toBe(true);
          expect(live.bytes.includes("catalogueSmoke")).toBe(true);
        }
        if (caseName === "saved-number" || caseName === "saved-mixed") {
          // Saved values and their labels never become catalogue declarations.
          expect(live.bytes.includes("8ccac484-7f28-477d-8d9d-0c0ca1100001")).toBe(false);
          expect(live.bytes.includes("Saved Number catalogue control")).toBe(false);
          if (caseName === "saved-mixed") expect(live.bytes.includes("Catalogue item")).toBe(true);
        }
        // The reader locale really reorders the live build.
        if (collation && lives.has(`${caseName}/`)) expect(live.bytes.equals(lives.get(`${caseName}/`)!)).toBe(false);
      } finally {
        if (process.env.FENEL_CATALOGUE_KEEP) await cp(directory, process.env.FENEL_CATALOGUE_KEEP, { recursive: true });
        await rm(directory, { recursive: true, force: true });
      }
    }, 1_800_000);
  }
});

// Lane S (Nov 8): the public (repository-only) worker adopts the generated
// repository catalogue. One fresh process per case, like one fresh public
// worker: the adopted projection must equal today's live build byte for byte
// (canonical transport text), in the build's and another reader collation;
// a fingerprint that does not name this registry keeps the live build.
describe("public repository catalogue with the generated artifact", () => {
  const repositoryFixture = fileURLToPath(new URL("./repository-catalogue-artifact.fixture.ts", import.meta.url));
  const only = process.env.FENEL_CATALOGUE_CASES?.split(",");
  for (const [variant, collation, expected] of [["current", undefined, "repository"], ["current", "cs", "repository"],
    ["tamper", undefined, "live"]] as const) {
    if (only && !only.includes(`repository-${variant}`)) continue;
    test(`repository ${variant}${collation ? ` (${collation})` : ""}: equals today's live build and takes the ${expected} path`, async () => {
      const scratch = join(repository, ".tmp");
      await mkdir(scratch, { recursive: true });
      const directory = await mkdtemp(join(scratch, "fenel-repository-catalogue-"));
      try {
        const out = join(directory, "repository");
        const child = Bun.spawnSync([process.execPath, repositoryFixture, out, variant], { cwd: repository,
          env: { ...process.env, FENEL_PARSER_LEGACY: "1", ...(collation ? { FENEL_TEST_COLLATION: collation } : {}) }, stdout: "ignore", stderr: "pipe" });
        if (child.exitCode !== 0) throw new Error(`repository ${variant} failed (${child.exitCode}): ${child.stderr.toString().slice(-2000)}`);
        const meta = (path: string) => JSON.parse(readFileSync(`${out}-${path}.json`, "utf8")) as { source: string; reason?: string };
        console.log(variant, collation ?? "", JSON.stringify(meta("worker")), JSON.stringify(meta("live")));
        expect(meta("worker").source).toBe(expected);
        if (variant === "tamper") expect(meta("worker").reason).toBe("fingerprint");
        expect(readFileSync(`${out}-worker`).equals(readFileSync(`${out}-live`))).toBe(true);
      } finally { await rm(directory, { recursive: true, force: true }); }
    }, 1_800_000);
  }
});
