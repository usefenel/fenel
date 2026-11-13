import { afterAll, describe, expect, test } from "bun:test";
import { publicSectionTarget } from "./public-section-presentation";
import { flush } from "solid-js";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "../../../../../implementations/typescript/engine/src/checkpoint-json";
import { captureRegistryTransportObservation, registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";

// C1: execute the production acquisition boundaries with the complete checked
// model/session held. These are scheduling and publication checks only.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const preferenceSource = await Bun.file(new URL("./workspace-preferences.ts", import.meta.url)).text();
const preferenceCode = new Bun.Transpiler({ loader: "ts" }).transformSync(preferenceSource)
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");
const projectionSource = await Bun.file(new URL("./public-locus-data.ts", import.meta.url)).text();
const projectionStart = projectionSource.indexOf("export function preparePublicLocusData");
if (projectionStart < 0) throw new Error("Public preparation boundary changed");
const projectionCode = new Bun.Transpiler({ loader: "ts" }).transformSync(projectionSource.slice(projectionStart))
  .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");
const generatorSource = await Bun.file(new URL("../../scripts/generate-public-bootstrap.mjs", import.meta.url)).text();
const checkedSeedStart = generatorSource.indexOf("function projectCheckedPublicSeedValue");
// The function alone: the generator text after it now reads import.meta (a
// module-only form that a Function body cannot parse).
const checkedSeedEnd = generatorSource.indexOf("\n}", checkedSeedStart) + 2;
if (checkedSeedStart < 0 || checkedSeedEnd < checkedSeedStart) throw new Error("Checked public seed transport boundary changed");
const projectCheckedPublicSeedValue = new Function(`${generatorSource.slice(checkedSeedStart, checkedSeedEnd)}; return projectCheckedPublicSeedValue;`)() as
  (example: Record<string, unknown>, inferred: unknown) => Record<string, unknown>;

/** The bundled bootstrap, the repository manifest and this build's identity. */
function bootstrapModules(path: string, snapshot: unknown): object | undefined {
  if (path === "./public-bootstrap") return { loadPublicBootstrap: async () => {
    if (snapshot === undefined) throw new Error("no bundled snapshot"); return snapshot; } };
  if (path === "@fenel/engine/repository-identity-manifest") return { REPOSITORY_IDENTITY_MANIFEST: { digest: "repository" } };
  if (path === "./expression-runner/authoring-build-identity") return { AUTHORING_BUILD_IDENTITY: "build" };
  return undefined;
}

async function settle() { for (let tick = 0; tick < 8; tick++) await Promise.resolve(); }

describe("public literal lens and complete data preparation", () => {
  test("anonymous checked lens preferences borrow ordinary operations without account or page model acquisition", async () => {
    const sourceFlight = deferred<object>();
    const calls: unknown[] = [];
    const preferences = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "" };
    const allDataRoot = { id: "all-data", canEdit: false, persisted: false };
    const packet = { $tag: "WorkspaceBootstrapPlan", value: preferences, itemId: { $tag: "Nothing" }, visibleLenses: [],
      activeLens: { $tag: "Nothing" }, tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [], shortcuts: [] };
    const source = { epoch: 7, ordinary: async (operation: { kind: string; args: unknown[] }) => {
      calls.push([operation.kind, operation.args[0]]);
      return operation.kind === "validateWorkspacePreferences" ? { $tag: "Ok", _0: preferences } : packet;
    } };
    const bindings = {
      sessionEpoch: () => 7,
      assertCurrentSession: (epoch: number) => { if (epoch !== 7) throw new Error("stale"); },
      createSignal: (initial: unknown) => {
        let value = initial;
        return [() => value, (next: unknown) => { value = next; }];
      },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      createAccountApiClient: () => { throw new Error("Anonymous lenses requested account storage"); },
      loadWorkspaceBootstrap: () => { throw new Error("Anonymous lenses requested account bootstrap"); },
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value: preferences }, allDataRoot }),
      loadWorkspaceModel: () => { throw new Error("Literal lenses requested a page model"); },
      preloadWorkspaceSlice: () => { throw new Error("Literal preferences requested authored evaluation"); },
      workspaceExpression: () => { throw new Error("Anonymous preferences tried to persist"); },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7, undefined, undefined, { ordinarySource: (epoch: number) => { calls.push(epoch); return sourceFlight.promise; } });
    expect(store.value()).toBe(preferences);
    expect(store.prepared()).toBe(false);
    expect(store.projection().shortcuts).toBeUndefined();
    expect(store.allDataRoot).toBe(allDataRoot);
    expect(store.persistent).toBe(false);
    const first = store.prepare();
    expect(store.prepare()).toBe(first);
    await settle();
    expect(calls).toEqual([7]);
    sourceFlight.resolve(source);
    expect(await first).toBeUndefined();
    expect(store.prepared()).toBe(true);
    expect(store.projection()).toBe(packet);
    expect(calls).toEqual([7, ["validateWorkspacePreferences", preferences], ["workspaceRenderPublication", preferences]]);
    expect(await store.flush()).toBe(true);
    store.dispose();
  });

  test("public rebind keeps displayed lenses while retiring old-epoch preparation and account lenses", async () => {
    // 2026-10-16 landing race: /auth/me answered Anonymous while the model
    // loaded; the epoch moved and the anonymous store's flight failed.
    let epoch = 7;
    const value = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "" };
    const flights: Array<ReturnType<typeof deferred<object>>> = [];
    const ordinarySource = () => { const flight = deferred<object>(); flights.push(flight); return flight.promise; };
    const source = (epoch: number) => ({ epoch, ordinary: async (operation: { kind: string }) => operation.kind === "validateWorkspacePreferences"
      ? { $tag: "Ok", _0: value } : { $tag: "WorkspaceBootstrapPlan", value, visibleLenses: [], activeLens: { $tag: "Nothing" },
        tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [], shortcuts: [] } });
    const bindings = {
      sessionEpoch: () => epoch,
      assertCurrentSession: (expected: number) => { if (expected !== epoch) throw new Error("The session changed while this request was in flight"); },
      createSignal: (initial: unknown) => { let current = initial; return [() => current, (next: unknown) => { current = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      createAccountApiClient: () => ({ dispose: () => {} }),
      loadWorkspaceBootstrap: () => { throw new Error("Unexpected bootstrap read"); },
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value } }),
      loadWorkspaceModel: () => { throw new Error("Literal lenses requested a page model"); },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const anonymous = await load(undefined, 7, undefined, undefined, { ordinarySource });
    const account = await load("A", 7, { accountId: "A", epoch: 7, personalAccountId: "A", accounts: [], root: { id: "root", items: [] },
      workspace: { status: "ready", value, itemId: "settings" } }, undefined, { ordinarySource });
    const anonymousPreparation = anonymous.prepare().catch((error: Error) => error.message);
    const accountPreparation = account.prepare().catch((error: Error) => error.message);
    await settle();
    epoch = 8;
    anonymous.rebindPublicSession(8);
    for (const flight of flights) flight.resolve(source(7));
    expect(await anonymousPreparation).toContain("changed");
    expect(anonymous.value()).toBe(value);
    expect(anonymous.prepared()).toBe(false);
    expect(anonymous.modelError()).toBeUndefined();
    expect(await accountPreparation).toBe("The session changed while this request was in flight");
    expect(account.prepared()).toBe(false);
    expect(() => account.rebindPublicSession(8)).toThrow("original session");
    const next = anonymous.prepare();
    await settle(); flights.at(-1)!.resolve(source(8));
    await next;
    expect(anonymous.prepared()).toBe(true);
    anonymous.dispose(); account.dispose();
  });

  test("same-epoch public rebinding preserves pending preparation, operations and readiness", async () => {
    const sourceFlight = deferred<object>(), operationFlight = deferred<boolean>();
    let acquisitions = 0;
    const value = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "" };
    const packet = { $tag: "WorkspaceBootstrapPlan", value, itemId: { $tag: "Nothing" }, visibleLenses: [],
      activeLens: { $tag: "Nothing" }, tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [], shortcuts: [] };
    const bindings = {
      sessionEpoch: () => 7,
      assertCurrentSession: (epoch: number) => { if (epoch !== 7) throw new Error("stale"); },
      createSignal: (initial: unknown) => { let current = initial; return [() => current, (next: unknown) => { current = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value } }),
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7, undefined, undefined, { ordinarySource: () => { acquisitions++; return sourceFlight.promise; } });
    const preparation = store.prepare();
    await settle();
    store.rebindPublicSession(7); store.rebindPublicSession(7);
    expect(store.prepare()).toBe(preparation);
    expect(acquisitions).toBe(1);
    sourceFlight.resolve({ epoch: 7, ordinary: (operation: { kind: string }) => operation.kind === "validateWorkspacePreferences"
      ? Promise.resolve({ $tag: "Ok", _0: value }) : operation.kind === "workspaceFocusEqual" ? operationFlight.promise : Promise.resolve(packet) });
    await preparation;
    expect(store.prepared()).toBe(true);
    const operation = store.operate({ kind: "workspaceFocusEqual", args: [{ $tag: "RootFocus" }, { $tag: "RootFocus" }] });
    await settle();
    store.rebindPublicSession(7); store.rebindPublicSession(7);
    expect(store.prepared()).toBe(true);
    expect(store.projection()).toBe(packet);
    operationFlight.resolve(true);
    expect(await operation).toBe(true);
    await store.prepare();
    expect(acquisitions).toBe(1);
    store.dispose();
  });

  test("closed anonymous preferences never acquire or publish a late ordinary source", async () => {
    const sourceFlight = deferred<object>();
    const bindings = {
      sessionEpoch: () => 7, assertCurrentSession: () => {},
      createSignal: (initial: unknown) => { let value = initial; return [() => value, (next: unknown) => { value = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value: {} } }),
      loadWorkspaceModel: () => { throw new Error("Unexpected page acquisition"); },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7, undefined, undefined, { ordinarySource: () => sourceFlight.promise });
    const pending = store.prepare();
    await settle();
    store.dispose();
    sourceFlight.resolve({ epoch: 7, ordinary: () => { throw new Error("A closed lens checked late data"); } });
    await expect(pending).rejects.toThrow();
    expect(store.prepared()).toBe(false);
  });

  test("a public rebind during the default lazy import cannot acquire the retired Local owner", async () => {
    let epoch = 7, acquisitions = 0, imports = 0;
    const moduleFlight = deferred<object>();
    const value = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "" };
    const bindings = {
      sessionEpoch: () => epoch,
      assertCurrentSession: (expected: number) => { if (expected !== epoch) throw new Error("session changed"); },
      createSignal: (initial: unknown) => { let current = initial; return [() => current, (next: unknown) => { current = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value, visibleLenses: [], activeLens: { $tag: "Nothing" },
        tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [] } }),
      loadModule: (path: string) => { expect(path).toBe("./local-locus-data"); imports++; return moduleFlight.promise; },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7);
    expect(imports).toBe(0);
    const old = store.prepare().catch((problem: Error) => problem);
    await settle();
    expect(imports).toBe(1);
    epoch = 8; store.rebindPublicSession(8);
    moduleFlight.resolve({ localTabDataSource: () => {
      acquisitions++;
      return { epoch, ordinary: async (operation: { kind: string }) => operation.kind === "validateWorkspacePreferences"
        ? { $tag: "Ok", _0: value } : { $tag: "WorkspaceBootstrapPlan", value, itemId: { $tag: "Nothing" }, visibleLenses: [],
          activeLens: { $tag: "Nothing" }, tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [], shortcuts: [] },
        dispose: () => { throw new Error("Borrowed owner was disposed"); } };
    } });
    expect(await old).toBeInstanceOf(Error);
    expect(acquisitions).toBe(0);
    expect(store.value()).toBe(value);
    await store.prepare();
    expect(imports).toBe(2); expect(acquisitions).toBe(1);
    store.dispose();
  });

  for (const mutation of ["timestamp", "equal child"] as const) test(`Date ${mutation} mutation during startup import refuses before Local acquisition`, async () => {
    let acquisitions = 0;
    const moduleFlight = deferred<object>();
    const date = new Date(1234), data = { date };
    const value = { $tag: "WorkspacePreferences", lenses: [{ subject: { $tag: "Just", _0: { data } } }], activeLensId: "" };
    const bindings = {
      sessionEpoch: () => 7, assertCurrentSession: () => {},
      createSignal: (initial: unknown) => { let current = initial; return [() => current, (next: unknown) => { current = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value, visibleLenses: [], activeLens: { $tag: "Nothing" },
        tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [] } }),
      loadModule: (path: string) => { expect(path).toBe("./local-locus-data"); return moduleFlight.promise; },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7);
    const preparation = store.prepare().catch((problem: Error) => problem);
    await settle();
    if (mutation === "timestamp") date.setTime(5678); else data.date = new Date(1234);
    moduleFlight.resolve({ localTabDataSource: () => { acquisitions++; throw new Error("A mutated startup graph acquired Local data"); } });
    expect(await preparation).toBeInstanceOf(Error);
    expect(acquisitions).toBe(0);
    expect(store.prepared()).toBe(false);
    store.dispose();
  });

  test("unsupported ordinary operation carriers refuse before startup acquisition", async () => {
    let acquisitions = 0;
    const bindings = {
      sessionEpoch: () => 7, assertCurrentSession: () => {},
      createSignal: (initial: unknown) => { let current = initial; return [() => current, (next: unknown) => { current = next; }]; },
      flushSolid: flush, captureRegistryTransportObservation, registryTransportSnapshot,
      loadPublicBootstrap: async () => ({ workspace: { status: "ready", value: {} } }),
      loadModule: () => { acquisitions++; throw new Error("An unsupported operation acquired Local data"); },
    };
    const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
    const store = await load(undefined, 7);
    for (const input of [new Map(), new Set(), new Uint8Array(new SharedArrayBuffer(4)), Object.create({ inherited: true })]) {
      await expect(store.operate({ kind: "workspaceReadPreferences", args: [input] })).rejects.toThrow();
    }
    expect(acquisitions).toBe(0);
    store.dispose();
  });

  test("public root projection waits for the complete cooperative session and retains its exact registry", async () => {
    const sessionFlight = deferred<object>();
    const preparationStarted = deferred<void>();
    let preparationRequests = 0;
    const events: string[] = [];
    const registry = { identity: "complete repository" };
    const session = { registry };
    const names = ["first", "second"];
    const examples = names.map(name => ({ name, expr: { kind: "literal", value: name } }));
    const bindings = {
      PUBLIC_SEED_NAMES: names,
      loadModule: async (path: string) => {
        if (path === "./expression-runner/authoring-session") return { prepareDetachedAuthoringSession: () => {
          preparationRequests++;
          if (preparationRequests === 1) { events.push("complete preparation"); preparationStarted.resolve(); }
          return sessionFlight.promise;
        } };
        if (path === "./expression-runner/seed-values") return { SEED_VALUES: examples };
        if (path === "@fenel/engine/type-foundation") return { List: (type: unknown) => ({ list: type }), Anything: "Anything", Nothing: "Nothing" };
        const bootstrap = bootstrapModules(path, undefined);
        if (bootstrap) return bootstrap;
        throw new Error(`Unexpected import ${path}`);
      },
      createReaderPresentation: (read: () => { registry: unknown; session: unknown; catalog: unknown[] }) => {
        expect(read()).toEqual({ registry, session, catalog: [] }); return { exact: true };
      },
      publicSourceDemoValues: (value: unknown) => { expect(value).toBe(registry); events.push("source projection"); return []; },
      arrangePublicDemos: (values: unknown) => values,
      publicShowcaseSourceForSession: () => undefined,
      publicLocusDataForSession: (value: unknown, demos: unknown) => {
        expect(value).toBe(session); expect(demos).toEqual(examples); events.push("root projection"); return { registry, session };
      },
    };
    const load = new Function(...Object.keys(bindings), `let prepared; ${projectionCode}; return preparePublicLocusData;`)(...Object.values(bindings));
    const first = load();
    const concurrent = load();
    await preparationStarted.promise;
    await settle();
    expect(events).toEqual(["complete preparation"]);
    expect(preparationRequests).toBe(1);
    sessionFlight.resolve(session);
    const [result, sharedResult] = await Promise.all([first, concurrent]);
    expect(sharedResult).toBe(result);
    expect(result.registry).toBe(registry);
    expect(events).toEqual(["complete preparation", "source projection", "root projection"]);
    // Each reader reattaches the shared session's worker. Those promise
    // wrappers are distinct; the underlying session and root stay shared.
    expect(preparationRequests).toBe(3);
    expect(await load()).toBe(result);
    expect(preparationRequests).toBe(4);
    expect(events).toEqual(["complete preparation", "source projection", "root projection"]);
  });

  test("this build's bootstrap supplies its derived projections; another build or identity recomputes them (lane E, Nov 8)", async () => {
    const root = { previewMetadata: { entries: ["bundled"] }, typeDescriptions: ["bundled descriptions"] };
    const cases = [
      { snapshot: { identityDigest: "repository", sourceDigest: "build", root }, expected: { previewMetadata: root.previewMetadata, typeDescriptions: root.typeDescriptions } },
      { snapshot: { identityDigest: "other repository", sourceDigest: "build", root }, expected: undefined },
      { snapshot: { identityDigest: "repository", sourceDigest: "other build", root }, expected: undefined },
      { snapshot: undefined, expected: undefined },
    ];
    for (const { snapshot, expected } of cases) {
      let supplied: unknown = "not called";
      const session = { registry: {} };
      const bindings = {
        PUBLIC_SEED_NAMES: [],
        loadModule: async (path: string) => {
          if (path === "./expression-runner/authoring-session") return { prepareDetachedAuthoringSession: async () => session };
          if (path === "./expression-runner/seed-values") return { SEED_VALUES: [] };
          if (path === "@fenel/engine/type-foundation") return { List: () => ({}), Anything: "Anything", Nothing: "Nothing" };
          return bootstrapModules(path, snapshot) ?? {};
        },
        createReaderPresentation: () => ({}),
        publicSourceDemoValues: () => [],
        arrangePublicDemos: (values: unknown) => values,
        publicShowcaseSourceForSession: () => undefined,
        publicLocusDataForSession: (...args: unknown[]) => { supplied = args[5]; return { session }; },
      };
      const load = new Function(...Object.keys(bindings), `let prepared; ${projectionCode}; return preparePublicLocusData;`)(...Object.values(bindings));
      await load();
      expect(supplied).toEqual(expected);
    }
  });

  test("refused complete public preparation cannot publish a root and remains retryable", async () => {
    let attempts = 0;
    let projected = 0;
    const bindings = {
      PUBLIC_SEED_NAMES: [],
      loadModule: async (path: string) => path === "./expression-runner/authoring-session"
        ? { prepareDetachedAuthoringSession: async () => { attempts++; throw new Error("checked repository refused"); } }
        : path === "./expression-runner/seed-values" ? { SEED_VALUES: [] } : {},
      createReaderPresentation: () => { projected++; },
      publicSourceDemoValues: () => { projected++; },
      arrangePublicDemos: () => { projected++; },
      publicLocusDataForSession: () => { projected++; },
    };
    const load = new Function(...Object.keys(bindings), `let prepared; ${projectionCode}; return preparePublicLocusData;`)(...Object.values(bindings));
    await expect(load()).rejects.toThrow("checked repository refused");
    await expect(load()).rejects.toThrow("checked repository refused");
    expect(attempts).toBe(2);
    expect(projected).toBe(0);
  });
});

describe("build-owned public example type transport", () => {
  test("a Solved result retains the exact type and lossless original expression", () => {
    const example = { name: "Original example", previousName: "Earlier label", description: "Source text",
      expr: { kind: "literal", value: { bytes: new Uint8Array([0, 255]), exact: -0 } } };
    const type = { $ref: "CanonicalCheckedType" };
    const projected = projectCheckedPublicSeedValue(example, { outcome: { $tag: "Solved" }, type });
    expect(projected.type).toBe(type);
    expect(projected.expr).toBe(example.expr);
    expect(projected.previousName).toBe(example.previousName);
    expect(example).not.toHaveProperty("type");
    const decoded = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(projected))), CHECKPOINT_VALUE_ENCODING);
    expect(decoded).toEqual(projected);
  });

  test("an abstention or incomplete result removes an earlier unverified type", () => {
    const example = { name: "Unknown example", expr: { kind: "call", fnId: "absent", args: [] },
      type: { $ref: "EarlierUnverifiedType" } };
    for (const inferred of [
      { outcome: { $tag: "Unknown" }, type: { $ref: "ProposedType" } },
      { outcome: { $tag: "Refuted" }, type: { $ref: "ProposedType" } },
      { outcome: { $tag: "Failed" }, type: { $ref: "ProposedType" } },
      { outcome: { $tag: "Solved" } },
      undefined,
    ]) {
      const projected = projectCheckedPublicSeedValue(example, inferred);
      expect(projected).not.toHaveProperty("type");
      expect(projected.expr).toBe(example.expr);
      expect(projected.name).toBe(example.name);
    }
  });

  test("the real generator moves only the three public examples' inference to the build", async () => {
    const snapshot = await Bun.file(new URL("./generated/seed-values.json", import.meta.url)).json();
    const corpus = decodeCheckpointValue(snapshot.values, snapshot.encoding) as Array<Record<string, unknown>>;
    const names = ["Reversed shouting", "Compound interest", "Reversed words"];
    const examples = names.map(name => corpus.find(entry => entry.name === name)!);
    expect(examples.every(Boolean)).toBe(true);
    const unrelated = { name: "Unchanged other example", expr: { kind: "literal", value: new Uint8Array([9, 4]) } };
    const sourceValues = [...examples, unrelated];
    const types = [{ $ref: "String" }, { $ref: "Number" }, { $ref: "String" }];
    const calls: unknown[] = [];
    const environment = {};
    const start = generatorSource.indexOf("const demos = PUBLIC_SEED_NAMES.map");
    const end = generatorSource.indexOf("const corpus =", start);
    if (start < 0 || end < start) throw new Error("Public corpus projection changed");
    const projectCorpus = new Function("SEED_VALUES", "PUBLIC_SEED_NAMES", "session", "inferTransferExpression", "projectCheckedPublicSeedValue",
      `${generatorSource.slice(start, end)}; return { demos, projectedSeedValues };`);
    const projected = projectCorpus(sourceValues, names, { environment }, (expr: unknown, actual: unknown) => {
      expect(actual).toBe(environment);
      calls.push(expr);
      return { outcome: { $tag: "Solved" }, type: types[calls.length - 1] };
    }, projectCheckedPublicSeedValue) as { demos: Array<Record<string, unknown>>; projectedSeedValues: Array<Record<string, unknown>> };
    expect(calls).toEqual(examples.map(entry => entry.expr));
    expect(projected.projectedSeedValues.at(-1)).toBe(unrelated);
    expect(projected.demos.map(entry => entry.type)).toEqual(types);
    expect(projected.demos.map(entry => entry.expr)).toEqual(examples.map(entry => entry.expr));
    const decoded = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(projected.projectedSeedValues))), CHECKPOINT_VALUE_ENCODING);
    expect(decoded).toEqual(projected.projectedSeedValues);

    const rootStart = projectionSource.indexOf("export function publicLocusDataForSession");
    const rootEnd = projectionSource.indexOf("let prepared:", rootStart);
    const rootCode = new Bun.Transpiler({ loader: "ts" }).transformSync(projectionSource.slice(rootStart, rootEnd)).replace(/^export /gm, "");
    const projectRoot = new Function("inferTransferExpression", "projectReaderTypeDescriptions", "publicSectionTarget", `${rootCode}; return publicLocusDataForSession;`)(() => {
      throw new Error("A typed public example requested runtime inference");
    }, () => [], publicSectionTarget);
    const registry = { modules: [], listModuleMembers: () => [], getFunction: () => undefined,
      getUuid: () => undefined, getIdentifiedEntity: () => undefined, getEntityNominalIdentity: () => undefined };
    const session = { registry, get environment() { throw new Error("The public projection requested its held picker catalogue"); } };
    const result = projectRoot(session, projected.demos, { $ref: "HeldRootType" }, { $tag: "Nothing" });
    expect(result.registry).toBe(registry);
    expect(result.root.items.find((item: { id: string }) => item.id === "demo").valueType.$record.fields.map((field: { name: string; type: unknown }) => [field.name, field.type]))
      .toEqual(names.map((name, index) => [name, types[index]]));
  });
});

// C1: keep the surface's progress wrapper paired with the store's current
// preparation. Read both production bodies on every run; fixture packets hold
// only acquisition/operation answers, never preference or validation policy.
const preparationSurface = await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text();
const preparationStart = preparationSurface.indexOf("  let modelPreparation:");
const preparationEnd = preparationSurface.indexOf("  let layoutTransition:", preparationStart);
if (preparationStart < 0 || preparationEnd < preparationStart) throw new Error("Surface preparation boundary moved");
const surfacePreparationCode = new Bun.Transpiler({ loader: "ts" }).transformSync(preparationSurface.slice(preparationStart, preparationEnd));
const preparationUnhandled: unknown[] = [];
const observePreparationUnhandled = (problem: unknown) => { preparationUnhandled.push(problem); };
process.on("unhandledRejection", observePreparationUnhandled);
afterAll(() => { process.off("unhandledRejection", observePreparationUnhandled); });

async function awaitPreparation<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_yes, no) => { timer = setTimeout(() => no(new Error(`Deadlock: ${label}`)), 1_000); });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}
async function untilPreparation(check: () => boolean, label: string) {
  for (let tick = 0; tick < 100; tick++) { if (check()) return; await Promise.resolve(); }
  throw new Error(`Expected host event: ${label}`);
}
type PreparationOutcome = { kind: "ok"; value: unknown } | { kind: "error"; error: unknown };
type PreparationOperation = { kind: string; args: unknown[] };
type PreparationOrdinarySource = { epoch: number; ordinary: (operation: PreparationOperation) => Promise<unknown> };

async function surfacePreparationFixture(account = false) {
  let epoch = 7, pending = false;
  const spinnerWrites: boolean[] = [], calls: Array<{ epoch: number; operation: string }> = [];
  const sources: Array<{ epoch: number; flight: ReturnType<typeof deferred<PreparationOrdinarySource>> }> = [];
  const observations: Promise<PreparationOutcome>[] = [];
  const value = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "", display: { $tag: "SingleLens" },
    bar: { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } }, presentations: [] };
  const packet = (input: unknown, itemId: unknown) => ({ $tag: "WorkspaceBootstrapPlan", value: input, itemId,
    visibleLenses: [], activeLens: { $tag: "Nothing" }, tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [], shortcuts: [] });
  const checked = { status: "ready", value, valueType: { $ref: "fixture-preferences" }, itemId: "settings",
    visibleLenses: [], activeLens: { $tag: "Nothing" }, tilePlan: { columns: 1, rows: 1, lensIds: [] }, presentations: [] };
  const savedSource = { kind: "expr", expr: { kind: "literal", value } };
  const settingsRoot = { id: "preferences", revision: 4, items: [{ id: "settings", source: savedSource }] };
  const assertCurrentSession = (expected: number) => { if (epoch !== expected) throw new Error("session changed"); };
  const remote = { dispose() {}, revalidate() {}, getLocusRoot: { uncached: async () => ({ root: settingsRoot }) } };
  const bindings = {
    sessionEpoch: () => epoch, assertCurrentSession,
    // Only the signal/imperative host ports are controlled. Coalescing, FIFO
    // order, invalidation, error publication and prepare are production code.
    createSignal: (initial: unknown) => { let state = initial; return [() => state, (next: unknown) => { state = next; }]; },
    flushSolid: () => {}, captureRegistryTransportObservation, registryTransportSnapshot,
    createAccountApiClient: () => remote,
    loadWorkspaceBootstrap: () => { throw new Error("Unexpected uncaptured bootstrap"); },
    loadPublicBootstrap: async () => ({ workspace: checked }),
    loadWorkspaceModel: async () => { if (!account) throw new Error("Anonymous preparation requested a page model"); return {}; },
    preloadWorkspaceSlice: (_name: string, load: () => Promise<unknown>) => load(),
    loadModule: async (name: string) => {
      if (!account || name !== "./workspace-preferences-evaluation") throw new Error(`Unexpected module ${name}`);
      return { selectWorkspacePreferences: (root: unknown) => {
        if (root !== settingsRoot) throw new Error("Unexpected saved-root projection input");
        return { id: "settings", value };
      } };
    },
    workspaceExpression: () => { throw new Error("Preparation tried to persist preferences"); },
    assertAllDataRootSources: () => { throw new Error("Unexpected all-data root"); },
  };
  const load = new Function(...Object.keys(bindings), `${preferenceCode}; return loadWorkspacePreferences;`)(...Object.values(bindings));
  const store = await load(account ? "account" : undefined, epoch, account ? { accountId: "account", epoch,
    personalAccountId: "account", accounts: [], root: settingsRoot, workspace: checked } : undefined, undefined, {
    ordinarySource: (requestedEpoch: number) => {
      const flight = deferred<PreparationOrdinarySource>(); sources.push({ epoch: requestedEpoch, flight }); return flight.promise;
    },
  });
  const props = { store, epoch, publicOnly: !account };
  const helperBindings = { props, untrack: (read: () => unknown) => read(), surfaceClosed: false,
    sessionEpoch: () => epoch, setModelPreparing: (next: boolean) => { pending = next; spinnerWrites.push(next); } };
  const helper = new Function(...Object.keys(helperBindings), `${surfacePreparationCode}; return { prepareModel, current: () => modelPreparation };`)(...Object.values(helperBindings));
  const observe = (promise: Promise<unknown>) => {
    const outcome: Promise<PreparationOutcome> = promise.then(value => ({ kind: "ok", value }), error => ({ kind: "error", error }));
    observations.push(outcome); return { promise, outcome };
  };
  const releaseSource = (index: number) => {
    const current = sources[index];
    if (!current) throw new Error(`Missing source ${index}`);
    current.flight.resolve({ epoch: current.epoch, ordinary: async operation => {
      calls.push({ epoch: current.epoch, operation: operation.kind });
      if (operation.kind === "validateWorkspacePreferences") {
        if (operation.args[0] !== value) throw new Error("Unspecified validation fixture input");
        return { $tag: "Ok", _0: value };
      }
      if (operation.kind === "workspaceRenderPublication") return packet(operation.args[0], operation.args[1]);
      throw new Error(`Unspecified ordinary operation ${operation.kind}`);
    } });
  };
  return { store, sources, calls, spinnerWrites, start: () => observe(helper.prepareModel()), observe,
    pending: () => pending, current: helper.current,
    nextEpoch: (next: number) => { epoch = next; props.epoch = next; }, releaseSource,
    close: async () => {
      store.dispose(); for (let index = 0; index < sources.length; index++) releaseSource(index);
      await awaitPreparation(Promise.all(observations), "fixture cleanup");
    },
  };
}

test("prepared surface controls do not reacquire a source or restart their progress state", async () => {
  const h = await surfacePreparationFixture();
  try {
    const first = h.start(); await untilPreparation(() => h.sources.length === 1, "ready control acquisition");
    h.releaseSource(0); await awaitPreparation(first.outcome, "ready control publication");
    expect(h.store.prepared()).toBe(true); expect(h.pending()).toBe(false);
    const writes = [...h.spinnerWrites];
    expect((await awaitPreparation(h.start().outcome, "prepared fast path")).kind).toBe("ok");
    expect(h.sources).toHaveLength(1); expect(h.spinnerWrites).toEqual(writes); expect(h.pending()).toBe(false);
  } finally { await h.close(); }
});
describe("surface preparation follows the store flight", () => {
  test("same-epoch calls share the real store preparation and UI wrapper", async () => {
    const h = await surfacePreparationFixture();
    try {
      const first = h.start(), second = h.start(); expect(second.promise).toBe(first.promise);
      await untilPreparation(() => h.sources.length === 1, "first source acquisition");
      expect(h.sources[0]!.epoch).toBe(7); expect(h.pending()).toBe(true);
      h.releaseSource(0); expect((await awaitPreparation(first.outcome, "shared preparation")).kind).toBe("ok");
      expect((await second.outcome).kind).toBe("ok"); expect(h.store.prepared()).toBe(true); expect(h.pending()).toBe(false);
      expect(h.sources).toHaveLength(1);
    } finally { await h.close(); }
  });

  test("a retained anonymous surface starts a new flight after epoch change", async () => {
    const h = await surfacePreparationFixture();
    try {
      const old = h.start(); await untilPreparation(() => h.sources.length === 1, "epoch-7 acquisition");
      h.nextEpoch(8); const next = h.start();
      h.releaseSource(0); expect((await awaitPreparation(old.outcome, "old epoch refusal")).kind).toBe("error");
      for (let tick = 0; tick < 30; tick++) await Promise.resolve();
      expect(h.store.prepared()).toBe(false); expect(h.store.modelError()).toBeUndefined();
      expect(h.sources.map(source => source.epoch)).toEqual([7, 8]);
      expect(next.promise).not.toBe(old.promise);
      expect(h.current()).toBe(next.promise); expect(h.pending()).toBe(true);
      expect(h.spinnerWrites).toEqual([true, true]); expect(h.store.modelError()).toBeUndefined();
      h.releaseSource(1); expect((await awaitPreparation(next.outcome, "new epoch publication")).kind).toBe("ok");
      expect(h.store.prepared()).toBe(true); expect(h.pending()).toBe(false);
    } finally { await h.close(); }
  });

  for (const action of ["discard", "reload"] as const) test(`same-epoch ${action} invalidation starts a new UI flight`, async () => {
    const h = await surfacePreparationFixture(action === "reload");
    try {
      const old = h.start(); await untilPreparation(() => h.sources.length === 1, "initial lifecycle acquisition");
      const restoration = h.observe(h.store[action]()); const next = h.start();
      expect(next.promise).not.toBe(old.promise);
      h.releaseSource(0); expect((await awaitPreparation(old.outcome, "old lifecycle refusal")).kind).toBe("error");
      await untilPreparation(() => h.sources.length === 2, "restoration source acquisition");
      expect(h.sources.map(source => source.epoch)).toEqual([7, 7]);
      expect(h.current()).toBe(next.promise); expect(h.pending()).toBe(true);
      expect(h.spinnerWrites).toEqual([true, true]); expect(h.store.modelError()).toBeUndefined();
      h.releaseSource(1); expect((await awaitPreparation(restoration.outcome, `${action} restoration`)).kind).toBe("ok");
      expect((await awaitPreparation(next.outcome, "replacement lifecycle publication")).kind).toBe("ok");
      expect(h.store.prepared()).toBe(true); expect(h.pending()).toBe(false);
    } finally { await h.close(); }
  });

  test("an operational failure can retry without a stale UI wrapper or unhandled rejection", async () => {
    const h = await surfacePreparationFixture();
    try {
      const first = h.start(); await untilPreparation(() => h.sources.length === 1, "failing acquisition");
      h.sources[0]!.flight.reject(new Error("ordinary source failed"));
      expect((await awaitPreparation(first.outcome, "operational failure")).kind).toBe("error");
      expect(h.store.modelError()).toBe("ordinary source failed"); expect(h.pending()).toBe(false);
      const next = h.start(); expect(next.promise).not.toBe(first.promise);
      await untilPreparation(() => h.sources.length === 2, "retry acquisition");
      h.releaseSource(1); expect((await awaitPreparation(next.outcome, "retry publication")).kind).toBe("ok");
      expect(h.store.prepared()).toBe(true); expect(h.store.modelError()).toBeUndefined(); expect(h.pending()).toBe(false);
    } finally { await h.close(); }
  });
});

test("all controlled rejection paths leave no unhandled promises", async () => {
  await new Promise(resolve => setTimeout(resolve, 0)); expect(preparationUnhandled).toEqual([]);
});
