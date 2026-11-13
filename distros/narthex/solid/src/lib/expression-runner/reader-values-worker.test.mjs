import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Execute the production receiver and its actual value-read copier. The
// projector is controlled: source tests own scalar/structural classification,
// while these controls establish reader routing and native-value transport.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const read = path => Bun.file(new URL(path, import.meta.url)).text();
const [workerSource, registrySource] = await Promise.all([
  read("./authoring-catalog-worker-main.ts"),
  read("../../../../../../implementations/typescript/engine/src/registry-transport.ts"),
]);
const compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerStart = workerSource.indexOf("const scope =");
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
if (workerStart < 0 || transportStart < 0 || transportEnd < transportStart)
  throw new Error("The reader values receiver fixture boundary moved.");
const workerCode = compile(workerSource.slice(workerStart)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry, enumerable: false });
const input = (value, extra = {}) => ({ value, typeLookup: "session", views: [], componentNames: [], ...extra });
const packet = value => ({ root: { body: "scalar", structure: "leaf", recordLabel: "Captured value",
  numeric: false, glyph: {}, readPlan: null,
  field: { name: "value", type: { $ref: "Value" }, label: { $tag: "Nothing" },
    ui: { $tag: "Nothing" }, meta: { transportObservation: value } } }, children: [] });

function fixture({ omitPublicIndex = false } = {}) {
  const calls = [], copies = [], posted = [], replies = [], turns = [], scopeCalls = [];
  const registry = { marker: "Local checked registry" };
  const frame = { marker: "Local reader frame", _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const source = { catalog: [{ id: "function", entries: [] }], types: [{ id: "committed-type" }],
    functionRows: [{ id: "committed-function" }] };
  const partitionEvents = [];
  let openPartition;
  const state = { project: entry => packet(entry.value), failInitializePublication: false };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage(value) {
      if (state.failInitializePublication && value.ok === true && value.result?.catalog) {
        state.failInitializePublication = false;
        throw new Error("controlled adoption publication failure");
      }
      posted.push(value); replies.push(structuredClone(value));
    } },
    withEngineBodyMemoPartition(partition, operation) {
      const previous = openPartition; openPartition = partition;
      partitionEvents.push({ kind: "open", partition });
      try { return operation(); }
      finally { partitionEvents.push({ kind: "close", partition }); openPartition = previous; }
    },
    clearEngineBodyMemoPartition(partition) { partitionEvents.push({ kind: "clear", partition }); },
    buildLocalReaderFieldRegistry: async () => registry,
    evaluateContextForCatalog: () => frame,
    realmRepositoryCatalogue: () => Promise.resolve({}),
    repositoryCatalogueRealmKey: () => "controlled repository",
    localCatalogue: async () => ({ catalog: [], displayCatalog: [] }),
    createDetachedAuthoringEnvironment: value => value,
    environmentForCatalog: () => session.environment,
    mintAnonymousAuthority: () => ({}),
    LOCAL_BROWSER_SOURCE_ID: "controlled-tab",
    repositoryCatalogueIndex: {},
    publicRepositoryCatalogueIndex: {},
    registryTransportSnapshot(value, label, mode) {
      const result = transport(value, label, mode);
      copies.push({ value, label, mode, result });
      return result;
    },
    projectReaderValueReadInSession(entry, selected, captured, knownIcons, physicalScope) {
      calls.push({ entry, session: selected, source: captured, knownIcons, partition: openPartition });
      return state.project(entry, selected, captured, knownIcons, physicalScope);
    },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      const selected = { ...base, registry: { marker: "scoped checked registry" },
        evaluateContext: { marker: scope.draft?.id ?? "scoped reader frame" } };
      scopeCalls.push({ base, scope, selected });
      return selected;
    },
    createAccountAuthoringSession() { throw new Error("Unexpected account scope in Local value controls."); },
  };
  if (omitPublicIndex) delete bindings.publicRepositoryCatalogueIndex;
  const api = new Function(...Object.keys(bindings), `${workerCode}; return {
    run, cancelled, releaseSnapshotState, partition: () => physicalPreviewPartition,
    install(session, captured, local = true, repository = false) {
      releaseSnapshotState();
      base = session; readerPresentationSource = captured;
      physicalPreviewPartition = session ? "reader-physical:" + (++nextPhysicalPreviewSnapshot) : undefined;
      localFieldSource = local ? { sourceId: "tab-a", snapshot: { owners: [], fields: [], facets: [] } } : undefined;
      repositoryOnlySnapshot = repository;
    },
    installContext(id, session) { contexts.set(id, session); },
    installModule(name, session) { moduleContexts.set(name, { catalog: [], session }); },
  };`)(...Object.values(bindings));
  api.install(session, source);
  let nextId = 10;
  const answer = id => replies.find(reply => reply.id === id && "ok" in reply);
  const payload = () => ({ method: "project-reader-values", contextId: 0,
    inputs: [input({ z: 2, a: 1 })], knownIcons: ["star", "utensils"] });
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  async function run(extra = {}) {
    const id = nextId++, request = { id, ...payload(), ...extra };
    const pending = api.run(request);
    await release(); await pending;
    return answer(id);
  }
  return { api, session, registry, frame, source, calls, copies, posted, replies,
    scopeCalls, state, payload, answer, release, run, partitionEvents, openPartition: () => openPartition, start: request => api.run(request) };
}

describe("Local value-read worker receiver", () => {
  test("projects each ordered input with the exact selected session, captured source and shared icon roster", async () => {
    const h = fixture(), shared = { z: { second: 2, first: 1 }, a: undefined };
    const type = { $ref: "AuthoredType" }, observedType = { $ref: "ObservedType" };
    const first = input(shared, { type, observedType, compact: true, thumbnail: false, templateOnly: true,
      views: [{ id: "source-view" }], componentNames: ["SourceComponent"] });
    const second = input("second", { typeLookup: "registry" });
    const inputs = [first, second, first], knownIcons = ["utensils", "star", "utensils"];
    const answer = await h.run({ inputs, knownIcons, registry: { marker: "forged registry" },
      evaluateContext: { marker: "forged reader" }, catalog: ["forged source"], types: ["forged type"] });
    expect(answer.ok).toBe(true);
    expect(h.calls).toHaveLength(3);
    expect(h.calls.map(call => call.entry.value)).toEqual([shared, "second", shared]);
    expect(h.calls.every(call => call.session === h.session && call.source === h.source)).toBe(true);
    expect(h.calls[0].session.registry).toBe(h.registry);
    expect(h.calls[0].session.evaluateContext).toBe(h.frame);
    expect(h.calls[0].entry).toEqual(first);
    expect(h.calls[0].entry).not.toBe(first);
    expect(h.calls[0].entry).toBe(h.calls[2].entry);
    expect(h.calls[0].entry.type).not.toBe(type);
    expect(h.calls[0].entry.observedType).not.toBe(observedType);
    expect(h.calls[0].knownIcons).toEqual(knownIcons);
    expect(h.calls[0].knownIcons).not.toBe(knownIcons);
    expect(h.calls.every(call => call.knownIcons === h.calls[0].knownIcons)).toBe(true);
    expect(Object.keys(h.calls[0].entry.value)).toEqual(["z", "a"]);
    expect(Object.keys(h.calls[0].entry.value.z)).toEqual(["second", "first"]);
    const result = answer.result.valueReads;
    expect(result).toHaveLength(3);
    expect(result[0].root.field.meta.transportObservation).toEqual(shared);
    expect(result[0].root.field.meta.transportObservation).toBe(result[2].root.field.meta.transportObservation);
    expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
      { label: "worker reader value request", mode: "value-read" },
      { label: "worker reader value result", mode: "value-read" },
    ]);
  });

  test("scoped, cached and module requests keep the same committed source while selecting their own reader", async () => {
    const h = fixture(), scope = { sourceId: "tab-a", functions: [], draft: { id: "draft reader" } };
    expect((await h.run({ contextId: 4, scope })).ok).toBe(true);
    const selected = h.scopeCalls[0].selected;
    expect(h.scopeCalls[0].base).toBe(h.session);
    expect(h.scopeCalls[0].scope).toBe(scope);
    expect(h.calls[0].session).toBe(selected);
    expect((await h.run({ contextId: 4 })).ok).toBe(true);
    expect(h.calls[1].session).toBe(selected);
    const module = { ...h.session, registry: { marker: "module checked registry" },
      evaluateContext: { marker: "module reader" } };
    h.api.installModule("chosen", module);
    expect((await h.run({ sourceModule: "chosen" })).ok).toBe(true);
    expect(h.calls[2].session).toBe(module);
    expect(h.calls.every(call => call.source === h.source)).toBe(true);
    expect(h.source.types).toEqual([{ id: "committed-type" }]);
    expect(h.frame._activeTags).toEqual(["tab-a"]);
  });

  test("native Dates, backing buffers and views retain native slots through both strict copies", async () => {
    const h = fixture(), date = new Date("2026-10-22T13:14:15.123Z"), buffer = new ArrayBuffer(12);
    const bytes = new Uint8Array(buffer); bytes.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const words = new Uint16Array(buffer, 2, 3), view = new DataView(buffer, 4, 5);
    const value = { date, sameDate: date, buffer, bytes, words, view, sameView: view };
    const answer = await h.run({ inputs: [input(value)] });
    expect(answer.ok).toBe(true);
    const captured = h.calls[0].entry.value;
    expect(captured.date).toBeInstanceOf(Date);
    expect(captured.date.getTime()).toBe(date.getTime());
    expect(captured.date).not.toBe(date);
    expect(captured.date).toBe(captured.sameDate);
    expect(captured.buffer).toBeInstanceOf(ArrayBuffer);
    expect(captured.buffer).not.toBe(buffer);
    expect(captured.bytes).toBeInstanceOf(Uint8Array);
    expect(captured.words).toBeInstanceOf(Uint16Array);
    expect(captured.view).toBeInstanceOf(DataView);
    expect(captured.bytes.buffer).toBe(captured.buffer);
    expect(captured.words.buffer).toBe(captured.buffer);
    expect(captured.view.buffer).toBe(captured.buffer);
    expect(captured.view).toBe(captured.sameView);
    expect(captured.words.byteOffset).toBe(2);
    expect(captured.words.length).toBe(3);
    expect(captured.view.byteOffset).toBe(4);
    expect(captured.view.byteLength).toBe(5);
    const strictReply = h.posted.find(reply => reply.ok === true).result.valueReads[0].root.field.meta.transportObservation;
    expect(strictReply.date).toBe(strictReply.sameDate);
    expect(strictReply.words.buffer).toBe(strictReply.buffer);
    const delivered = answer.result.valueReads[0].root.field.meta.transportObservation;
    expect(delivered.date).toBeInstanceOf(Date);
    expect(delivered.date.getTime()).toBe(date.getTime());
    expect(delivered.sameDate.getTime()).toBe(date.getTime());
    // Bun may duplicate Date aliases in structuredClone; the actual copier's
    // alias contract above remains strict, while the delivered time is exact.
    expect(delivered.bytes.buffer).toBe(delivered.buffer);
    expect(delivered.words.buffer).toBe(delivered.buffer);
    expect(delivered.view.buffer).toBe(delivered.buffer);
    expect(delivered.view).toBe(delivered.sameView);
    expect(delivered.words.byteOffset).toBe(2);
    expect(delivered.view.byteLength).toBe(5);
    expect([...new Uint8Array(delivered.buffer)]).toEqual([...bytes]);
    delivered.bytes[0] = 99;
    expect(bytes[0]).toBe(1);
    expect(captured.bytes[0]).toBe(1);
  });

  test("empty batches return empty and missing Local source, presentation, context or preparation refuse", async () => {
    const h = fixture();
    expect((await h.run({ inputs: [] })).result).toEqual({ valueReads: [] });
    h.api.install(h.session, h.source, false);
    expect((await h.run({ localSourceId: "tab-a" })).error).toContain("Local value presentation is unavailable");
    h.api.install(h.session, undefined);
    expect((await h.run()).error).toContain("Local value presentation is unavailable");
    h.api.install(h.session, h.source);
    const missing = await h.run({ contextId: 77 });
    expect(missing.code).toBe("context-missing");
    h.api.install(undefined, h.source);
    expect((await h.run()).error).toContain("editing worker is not ready");
    expect(h.calls).toHaveLength(0);
  });

  test("malformed arrays, flags and lookup modes refuse the complete batch before projection", async () => {
    const h = fixture();
    for (const extra of [{ inputs: undefined }, { inputs: null }, { inputs: {} }, { inputs: "values" },
      { knownIcons: undefined }, { knownIcons: "star" }, { knownIcons: ["star", 3] }]) {
      expect((await h.run(extra)).ok).toBe(false);
    }
    for (const entry of [null, [], "value", input(1, { typeLookup: "global" }), input(1, { typeLookup: undefined }),
      input(1, { views: undefined }), input(1, { views: {} }), input(1, { componentNames: undefined }),
      input(1, { componentNames: [3] }), input(1, { compact: "true" }), input(1, { thumbnail: 1 }),
      input(1, { templateOnly: null })]) {
      const answer = await h.run({ inputs: [input("valid first"), entry] });
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    expect(h.calls).toHaveLength(0);
  });

  test("raw scalar and optional declared type observations reach the owner without receiver classification", async () => {
    const h = fixture();
    const values = [undefined, null, false, 0, -0, NaN, Infinity, 3n, "", [1], { $tag: "Just", _0: 1 }];
    const answer = await h.run({ inputs: values.map(value => input(value)) });
    expect(answer.ok).toBe(true);
    expect(h.calls).toHaveLength(values.length);
    for (let index = 0; index < values.length; index++) {
      if (values[index] === null || typeof values[index] !== "object")
        expect(Object.is(h.calls[index].entry.value, values[index])).toBe(true);
      else expect(h.calls[index].entry.value).toEqual(values[index]);
    }
  });

  test("strict inputs reject callbacks, registry instances, hidden data and accessors without invoking getters", async () => {
    const h = fixture();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get() { reads++; return 1; } });
    class Registry { getType() {} }
    const cycle = {}; cycle.self = cycle;
    for (const value of [{ host: () => true }, new Registry(), accessor, cycle,
      hidden({ z: 1 }, "hidden", 2), hidden([1], "hidden", 2)]) {
      const answer = await h.run({ inputs: [input(value)] });
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    const inputs = [];
    Object.defineProperty(inputs, "0", { enumerable: true, get() { reads++; return input(1); } });
    expect((await h.run({ inputs })).ok).toBe(false);
    expect(reads).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("strict replies reject executable or accessor-bearing projector data with no partial packet", async () => {
    const h = fixture();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "body", { enumerable: true, get() { reads++; return "scalar"; } });
    class Registry { getType() {} }
    for (const value of [{ host: () => true }, accessor, new Registry(), hidden({ z: 1 }, "hidden", 2)]) {
      h.state.project = () => packet(value);
      const answer = await h.run();
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    expect(reads).toBe(0);
    expect(h.replies.filter(reply => "ok" in reply).every(reply => reply.ok === false)).toBe(true);
  });

  test("a later projector error rejects the batch without publishing earlier results", async () => {
    const h = fixture();
    h.state.project = entry => {
      if (entry.value === "refuse") throw new Error("selected reader refused this value");
      return packet(entry.value);
    };
    const answer = await h.run({ inputs: [input("first"), input("refuse"), input("unvisited")] });
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("selected reader refused this value");
    expect(answer.result).toBeUndefined();
    expect(h.calls.map(call => call.entry.value)).toEqual(["first", "refuse"]);
  });

  test("cancellation before projection and during completion suppresses result packets", async () => {
    const h = fixture(), id = 71;
    const pending = h.start({ id, ...h.payload() });
    h.api.cancelled.add(id);
    await h.release(); await pending;
    expect(h.calls).toHaveLength(0);
    expect(h.answer(id)).toBeUndefined();
    const completedId = 72;
    h.state.project = entry => { h.api.cancelled.add(completedId); return packet(entry.value); };
    const completed = h.start({ id: completedId, ...h.payload() });
    await h.release(); await completed;
    expect(h.calls).toHaveLength(1);
    expect(h.answer(completedId)).toBeUndefined();
    expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, completedId]);
  });
});

describe("prepared repository-only public value-read receiver", () => {
  test("the prepared public base uses the same projector and snapshot partition without acquiring Local fields", async () => {
    const h = fixture(), source = { catalog: [{ id: "public" }] };
    const session = { ...h.session, registry: { marker: "public registry" }, evaluateContext: { marker: "public frame" } };
    h.api.install(session, source, false, true);
    h.state.project = (entry, selected, captured, icons, physical) => {
      expect(selected).toBe(session); expect(captured).toBe(source);
      expect(captured.types).toBeUndefined(); expect(captured.functionRows).toBeUndefined();
      expect(physical(() => { expect(h.openPartition()).toBe(h.api.partition()); return true; })).toBe(true);
      return packet(entry.value);
    };
    const answer = await h.run({ registry: h.registry, evaluateContext: h.frame, catalog: ["forged"], localSourceId: "forged-local" });
    expect(answer.ok).toBe(true);
    expect(answer.result.valueReads).toEqual([packet({ z: 2, a: 1 })]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].session).toBe(session);
  });

  test("caller flags, non-base contexts and module/draft scopes cannot qualify a public projection", async () => {
    const h = fixture();
    h.api.install(h.session, h.source, false);
    expect((await h.run({ repositoryOnly: true, localSourceId: "forged" })).ok).toBe(false);
    h.api.install(h.session, h.source, false, true);
    h.api.installContext(7, h.session); h.api.installModule("public-module", h.session);
    for (const extra of [{ contextId: 7 }, { sourceModule: "public-module" }, { scope: { sourceId: "forged", functions: [] } }]) {
      const answer = await h.run(extra);
      expect(answer.ok).toBe(false);
      expect(answer.error).toContain("prepared repository context");
    }
    expect(h.calls).toHaveLength(0);
    expect(h.scopeCalls).toHaveLength(0);
  });

  test("replacement during the yield cannot publish or refill the retired public partition", async () => {
    const h = fixture(); h.api.install(h.session, h.source, false, true);
    const oldPartition = h.api.partition(), id = 902;
    const pending = h.start({ id, ...h.payload() });
    h.api.install({ ...h.session }, h.source, false, true);
    await h.release(); await pending;
    expect(h.answer(id).ok).toBe(false);
    expect(h.answer(id).error).toContain("reader was replaced");
    expect(h.calls).toHaveLength(0);
    expect(h.partitionEvents.some(event => event.kind === "clear" && event.partition === oldPartition)).toBe(true);
    expect(h.partitionEvents.some(event => event.kind === "open" && event.partition === oldPartition)).toBe(false);
  });
});

describe("public typed-read capture uses only its prepared base owner", () => {
  const typedSource = readFileSync(new URL("../layout-renderer/TypedReadValue.tsx", import.meta.url), "utf8");
  const from = typedSource.indexOf("  const readInput = createMemo<"), to = typedSource.indexOf("  const projectedRead =", from);
  if (from < 0 || to < from) throw new Error("Typed read capture boundary moved");
  const sessionSource = readFileSync(new URL("./account-authoring-session.ts", import.meta.url), "utf8");
  const sessionFrom = sessionSource.indexOf("const facadeSources ="), sessionTo = sessionSource.indexOf("export type AccountAuthoringScope", sessionFrom);
  const identities = new Function("untrack", `${compile(sessionSource.slice(sessionFrom, sessionTo))}; return { concreteAuthoringSession, registerAuthoringSessionFacade };`)(read => read());
  function captureFixture(change = {}) {
    const registry = {}, environment = {}, evaluateContext = {};
    const base = { mode: "detached", registry, environment, evaluateContext };
    const templates = { list: () => [], listComponentNames: () => [] };
    const lifetime = new AbortController(), runtime = { worker: {}, calls: [] };
    const props = { value: { name: "Fenel" }, type: { $ref: "Project" }, ...change };
    const reader = { kind: "public", session: () => base, registry: () => registry,
      templates: () => templates, revision: () => 0, client: { signal: lifetime.signal } };
    const bindings = { reader, props, inheritedSession: { marker: "unrelated inherited session" },
      concreteAuthoringSession: identities.concreteAuthoringSession,
      localReaderReadSession: () => { throw new Error("Public capture consulted Local fields"); },
      preparedReaderWorkerForSession: session => {
        runtime.calls.push(session);
        if (identities.concreteAuthoringSession(session) !== base) throw new Error("Foreign source worker");
        return runtime.worker;
      }, registryTransportSnapshot: transport,
      createMemo: compute => { let done = false, value; return () => { if (!done) { value = compute(); done = true; } return value; }; },
      latest: read => read(), NotReadyError: class extends Error {},
    };
    const api = new Function(...Object.keys(bindings), `let alive = true; ${compile(typedSource.slice(from, to))}; return { readInput, current, close: () => { alive = false; } };`)(...Object.values(bindings));
    return { ...api, base, props, reader, runtime, templates, lifetime };
  }

  test("the exact public owner captures its real value and type and refuses missing or replaced workers", () => {
    const h = captureFixture(), input = h.readInput();
    expect(input.session).toBe(h.base);
    expect(input.wire.value).toEqual(h.props.value);
    expect(input.wire.value).not.toBe(h.props.value);
    expect(input.wire.type).toEqual(h.props.type);
    expect(input.templates).toBe(h.templates);
    expect(h.current(input)).toBe(true);
    h.runtime.worker = {};
    expect(h.current(input)).toBe(false);
    const absent = captureFixture(); absent.runtime.worker = undefined;
    expect(absent.readInput().error.message).toContain("display tools are not ready");
  });

  test("module, foreign field/session and altered same-concrete frames keep their original scoped body", () => {
    for (const change of [{ readSession: { mode: "module", sourceModule: "other" } }, { readSession: { mode: "detached" } }, { fieldRegistry: {} }]) {
      const h = captureFixture(change);
      expect(h.readInput()).toBeUndefined(); expect(h.runtime.calls).toEqual([]);
    }
    const h = captureFixture(), changed = { ...h.base, evaluateContext: { marker: "different frame" } };
    identities.registerAuthoringSessionFacade(changed, () => h.base);
    h.props.readSession = changed;
    expect(h.readInput()).toBeUndefined(); expect(h.runtime.calls).toEqual([]);
  });

  test("reader closure or component release refuses an otherwise current public packet", () => {
    const h = captureFixture(), input = h.readInput();
    h.lifetime.abort();
    expect(h.current(input)).toBe(false);
    const closed = captureFixture(), captured = closed.readInput(); closed.close();
    expect(closed.current(captured)).toBe(false);
  });
});

describe("snapshot-private S1 physical observation scheduling", () => {
  test("only the supplied physical observation opens the snapshot partition; every scoped projection still runs", async () => {
    const h = fixture(), observed = [];
    h.state.project = (entry, selected, captured, icons, physicalScope) => {
      observed.push({ kind: "before", partition: h.openPartition(), selected });
      const physical = physicalScope(() => {
        observed.push({ kind: "physical", partition: h.openPartition(), selected });
        return false;
      });
      observed.push({ kind: "after", partition: h.openPartition(), selected });
      expect(physical).toBe(false);
      return packet(entry.value);
    };
    const partition = h.api.partition();
    expect((await h.run()).ok).toBe(true);
    expect((await h.run({ contextId: 4, scope: { sourceId: "tab-a", functions: [], draft: { id: "draft" } } })).ok).toBe(true);
    expect(h.calls).toHaveLength(2);
    expect(h.calls.every(call => call.partition === undefined)).toBe(true);
    expect(observed.map(row => row.kind)).toEqual(["before", "physical", "after", "before", "physical", "after"]);
    expect(observed.filter(row => row.kind === "physical").every(row => row.partition === partition)).toBe(true);
    expect(observed.filter(row => row.kind !== "physical").every(row => row.partition === undefined)).toBe(true);
    expect(observed[3].selected).not.toBe(observed[0].selected);
    expect(h.openPartition()).toBeUndefined();
  });

  test("physical observation failure closes its synchronous scope and a new request reruns", async () => {
    const h = fixture(); let attempts = 0;
    h.state.project = (entry, selected, captured, icons, physicalScope) => {
      physicalScope(() => { attempts++; throw new Error("physical source refused"); });
      return packet(entry.value);
    };
    expect((await h.run()).error).toContain("physical source refused");
    expect((await h.run()).error).toContain("physical source refused");
    expect(attempts).toBe(2); expect(h.openPartition()).toBeUndefined();
    expect(h.partitionEvents.filter(row => row.kind === "close")).toHaveLength(2);
  });

  test("release clears the exact private partition and a replacement gets a distinct namespace", async () => {
    const h = fixture(), old = h.api.partition();
    h.api.releaseSnapshotState();
    expect(h.api.partition()).toBeUndefined();
    expect(h.partitionEvents).toContainEqual({ kind: "clear", partition: old });
    expect((await h.run()).ok).toBe(false);
    h.api.install(h.session, h.source);
    expect(h.api.partition()).not.toBe(old);
    expect((await h.run()).ok).toBe(true);
  });

  test("actual initialize replaces the previous partition; failed publication clears the newly adopted one", async () => {
    const h = fixture(), old = h.api.partition();
    const initialization = { method: "initialize", localSourceId: "tab-a", sessionEpoch: 1,
      snapshot: { owners: [], fields: [], facets: [] }, entities: [], functions: [] };
    expect((await h.run(initialization)).ok).toBe(true);
    const adopted = h.api.partition(); expect(adopted).not.toBe(old);
    expect(h.partitionEvents).toContainEqual({ kind: "clear", partition: old });
    h.state.failInitializePublication = true;
    expect((await h.run(initialization)).error).toContain("controlled adoption publication failure");
    expect(h.api.partition()).toBeUndefined();
    const clears = h.partitionEvents.filter(row => row.kind === "clear").map(row => row.partition);
    expect(clears).toContain(adopted);
    expect(clears).toHaveLength(3); // prior snapshot, replacement, failed new adoption
    expect(clears[2]).not.toBe(adopted);
    expect((await h.run()).ok).toBe(false);
  });

  test("a missing imported public catalogue observation refuses actual initialization explicitly", async () => {
    const h = fixture({ omitPublicIndex: true });
    const answer = await h.run({ method: "initialize", localSourceId: "tab-a", sessionEpoch: 1,
      snapshot: { owners: [], fields: [], facets: [] }, entities: [], functions: [] });
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("publicRepositoryCatalogueIndex is not defined");
  });

  test("release during the request yield cannot repopulate a retired partition", async () => {
    const h = fixture(), old = h.api.partition(), id = 81;
    const pending = h.start({ id, ...h.payload() });
    h.api.releaseSnapshotState();
    h.api.install(h.session, h.source);
    await h.release(); await pending;
    expect(h.answer(id).error).toContain("reader was replaced");
    expect(h.calls).toHaveLength(0);
    expect(h.partitionEvents).toContainEqual({ kind: "clear", partition: old });
    expect(h.partitionEvents.filter(row => row.kind === "open")).toHaveLength(0);
  });

  test("page hints cannot supply a physical Boolean or choose a public partition", async () => {
    const h = fixture(), observed = [];
    h.state.project = (entry, selected, captured, icons, physicalScope) => {
      physicalScope(() => { observed.push(h.openPartition()); return false; });
      return packet(entry.value);
    };
    const answer = await h.run({ physicalPreview: true, physicalPreviewPartition: "repository",
      inputs: [input("plain", { physicalPreview: true, physicalPreviewPartition: "repository" })] });
    expect(answer.ok).toBe(true); expect(observed).toEqual([h.api.partition()]);
    expect(observed[0]).not.toBe("repository");
  });
});
