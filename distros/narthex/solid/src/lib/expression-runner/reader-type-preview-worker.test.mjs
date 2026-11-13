import { describe, expect, test } from "bun:test";

// Run the actual receiver with controlled semantic/host ports. These controls
// establish frame selection and transport, without building a registry.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const read = path => Bun.file(new URL(path, import.meta.url)).text();
const [workerSource, registrySource] = await Promise.all([
  read("./authoring-catalog-worker-main.ts"),
  read("../../../../../../implementations/typescript/engine/src/registry-transport.ts"),
]);
const compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerCode = compile(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", '"/"');
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
if (transportStart < 0 || transportEnd < 0) throw new Error("Registry transport fixture boundary moved.");
const transport = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();

function fixture() {
  const calls = [], copies = [], replies = [], turns = [], scopeCalls = [];
  const registry = { marker: "Local registry" };
  const frame = { marker: "Local reader frame", _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const source = { catalog: [{ id: "function", entries: [] }], types: [{ id: "committed-type" }],
    functionRows: [{ id: "committed-fn" }] };
  const state = { project(type) {
    return { root: type, rows: [{ type, description: { type, previewShape: type },
      presentation: { type, label: "Selected Local type" } }], fieldLabels: [] };
  } };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: value => replies.push(structuredClone(value)) },
    registryTransportSnapshot(value, label) { copies.push({ value, label }); return transport(value, label); },
    projectReaderTypePreviewInSession(type, selected, lookup, captured, knownIcons) {
      calls.push({ type, session: selected, lookup, source: captured, knownIcons });
      return state.project(type, selected, lookup, captured, knownIcons);
    },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      scopeCalls.push({ base, scope });
      return { ...base, evaluateContext: { ...base.evaluateContext, marker: scope.draft?.id ?? "scoped" } };
    },
    createAccountAuthoringSession() { throw new Error("A Local preview must not create an account frame."); },
  };
  const api = new Function(...Object.keys(bindings), `${workerCode}; return {
    run, cancelled,
    install(session, source, local = true) {
      base = session; readerPresentationSource = source;
      localFieldSource = local ? { sourceId: "tab-a", snapshot: { owners: [], fields: [], facets: [] } } : undefined;
    },
    installContext(id, session) { contexts.set(id, session); },
    installModule(name, session) { moduleContexts.set(name, { catalog: [], session }); },
  };`)(...Object.values(bindings));
  api.install(session, source);
  let nextId = 10;
  const answer = id => replies.find(reply => reply.id === id && "ok" in reply);
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  const payload = () => ({ method: "project-reader-type-preview", contextId: 0,
    type: { $ref: "Selected" }, typeLookup: "session", knownIcons: ["star", "utensils"] });
  const start = request => api.run(request);
  async function run(extra = {}) {
    const id = nextId++, request = { id, ...payload(), ...extra };
    const pending = start(request);
    await release(); await pending;
    return answer(id);
  }
  return { api, session, source, registry, frame, calls, copies, replies, scopeCalls,
    state, payload, answer, release, start, run };
}

describe("Local type preview worker receiver", () => {
  test("forwards the exact selected session, retained source, lookup mode and icons through strict copies", async () => {
    const h = fixture();
    const leaf = { $ref: "Shared" };
    const type = { $arrow: { params: [{ type: leaf }], returns: leaf } };
    const knownIcons = ["utensils", "star"];
    const answer = await h.run({ type, typeLookup: "registry", knownIcons,
      sourceId: "foreign", catalog: ["uncommitted"], types: ["foreign"] });
    expect(answer.ok).toBe(true);
    const call = h.calls[0];
    expect(call.session).toBe(h.session);
    expect(call.session.evaluateContext).toBe(h.frame);
    expect(call.source).toBe(h.source);
    expect(call.lookup).toBe("registry");
    expect(call.knownIcons).toEqual(knownIcons);
    expect(call.knownIcons).not.toBe(knownIcons);
    expect(call.type).not.toBe(type);
    expect(call.type.$arrow.params[0].type).toBe(call.type.$arrow.returns);
    const packet = answer.result.preview;
    expect(packet.root).not.toBe(call.type);
    expect(packet.root).toBe(packet.rows[0].type);
    expect(packet.root).toBe(packet.rows[0].description.type);
    expect(packet.root).toBe(packet.rows[0].presentation.type);
    expect(packet.root.$arrow.params[0].type).toBe(packet.root.$arrow.returns);
    expect(h.copies.map(copy => copy.label)).toEqual([
      "worker reader type preview request", "worker reader type preview result",
    ]);
  });

  test("scoped, cached and module frames keep the same committed Local presentation source", async () => {
    const h = fixture();
    const scoped = { sourceId: "tab-a", functions: [], draft: { id: "draft-frame" } };
    expect((await h.run({ contextId: 4, scope: scoped })).ok).toBe(true);
    const selected = h.calls[0].session;
    expect(selected.evaluateContext.marker).toBe("draft-frame");
    expect(h.scopeCalls[0].base).toBe(h.session);
    expect(h.scopeCalls[0].scope).toBe(scoped);
    expect((await h.run({ contextId: 4 })).ok).toBe(true);
    expect(h.calls[1].session).toBe(selected);
    const moduleSession = { ...h.session, evaluateContext: { marker: "module-frame" } };
    h.api.installModule("chosen", moduleSession);
    expect((await h.run({ sourceModule: "chosen" })).ok).toBe(true);
    expect(h.calls[2].session).toBe(moduleSession);
    expect(h.calls.every(call => call.source === h.source)).toBe(true);
    expect(h.source.types).toEqual([{ id: "committed-type" }]);
    expect(h.frame._activeTags).toEqual(["tab-a"]);
  });

  test("public/account initialization, missing source, missing context and unready workers refuse before projection", async () => {
    const h = fixture();
    h.api.install(h.session, h.source, false);
    expect((await h.run()).error).toContain("Local type presentation is unavailable");
    h.api.install(h.session, undefined);
    expect((await h.run()).error).toContain("Local type presentation is unavailable");
    h.api.install(h.session, h.source);
    const missingContext = await h.run({ contextId: 77 });
    expect(missingContext.ok).toBe(false);
    expect(missingContext.code).toBe("context-missing");
    h.api.install(undefined, h.source);
    expect((await h.run()).error).toContain("editing worker is not ready");
    expect(h.calls).toHaveLength(0);
  });

  test("malformed mode, type and icon packets refuse before the semantic owner", async () => {
    const h = fixture();
    for (const extra of [
      { typeLookup: "global" }, { typeLookup: undefined },
      { type: undefined }, { type: null }, { type: [] }, { type: "Selected" },
      { knownIcons: undefined }, { knownIcons: "star" }, { knownIcons: ["star", 2] },
    ]) {
      const answer = await h.run(extra);
      expect(answer.ok).toBe(false);
      expect(answer.error).toContain("could not be read");
    }
    expect(h.calls).toHaveLength(0);
  });

  test("request methods and accessors refuse without executing them", async () => {
    const h = fixture();
    expect((await h.run({ type: { host: () => true } })).error).toContain("executable transport");
    let reads = 0;
    const type = {};
    Object.defineProperty(type, "$ref", { enumerable: true, get() { reads++; return "hidden"; } });
    expect((await h.run({ type })).error).toContain("accessor");
    expect(reads).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("reply methods and accessors refuse, with no partial packet delivered", async () => {
    const h = fixture();
    h.state.project = () => ({ root: {}, rows: [{ presentation: { host: () => true } }], fieldLabels: [] });
    const callable = await h.run();
    expect(callable.ok).toBe(false);
    expect(callable.error).toContain("executable transport");
    let reads = 0;
    h.state.project = () => {
      const packet = {};
      Object.defineProperty(packet, "rows", { enumerable: true, get() { reads++; return []; } });
      return packet;
    };
    const accessor = await h.run();
    expect(accessor.ok).toBe(false);
    expect(accessor.error).toContain("accessor");
    expect(reads).toBe(0);
    expect(h.replies.filter(reply => "ok" in reply).every(reply => reply.ok === false)).toBe(true);
  });

  test("cancellation before projection and during completion suppresses all packet replies", async () => {
    const h = fixture();
    const id = 71;
    const pending = h.start({ id, ...h.payload() });
    h.api.cancelled.add(id);
    await h.release(); await pending;
    expect(h.calls).toHaveLength(0);
    expect(h.answer(id)).toBeUndefined();
    const completedId = 72;
    h.state.project = type => {
      h.api.cancelled.add(completedId);
      return { root: type, rows: [], fieldLabels: [] };
    };
    const completed = h.start({ id: completedId, ...h.payload() });
    await h.release(); await completed;
    expect(h.calls).toHaveLength(1);
    expect(h.answer(completedId)).toBeUndefined();
    expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, completedId]);
  });
});
