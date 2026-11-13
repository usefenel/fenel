import { describe, expect, test } from "bun:test";

// Run the actual receiver and strict copier with controlled semantic ports.
// Numeric parsing stays in the existing Fenel codec; these are transport and
// captured-reader invocation controls and do not build an engine registry.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const read = path => Bun.file(new URL(path, import.meta.url)).text();
const [workerSource, registrySource] = await Promise.all([
  read("./authoring-catalog-worker-main.ts"),
  read("../../../../../../implementations/typescript/engine/src/registry-transport.ts"),
]);
const compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const start = workerSource.indexOf("const scope =");
if (start < 0) throw new Error("The numeric worker receiver boundary moved.");
const workerCode = compile(workerSource.slice(start)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
if (transportStart < 0 || transportEnd < transportStart) throw new Error("The numeric transport fixture boundary moved.");
const snapshot = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const codec = () => ({ methods: { decode: { $ref: "source.decode" }, encode: { $ref: "source.encode" } } });

function fixture() {
  const calls = [], plans = [], copies = [], replies = [], turns = [], scopes = [];
  const registry = { marker: "Local numeric registry" };
  const frame = { marker: "Local numeric frame", _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const state = { plan: () => codec().methods, run: (_session, _codec, direction) => direction === "encode"
    ? { ok: true, value: "source-produced text" } : { ok: true, value: { exact: "source-produced value" } } };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: message => replies.push(structuredClone(message)) },
    registryTransportSnapshot(value, label, mode) {
      copies.push({ value, label, mode });
      return snapshot(value, label, mode);
    },
    runNumericTextCodec(selected, selectedCodec, direction, value) {
      calls.push({ session: selected, codec: selectedCodec, direction, value });
      return state.run(selected, selectedCodec, direction, value);
    },
    fieldNumericTextCodecPlan(typeName, selectedFrame) {
      plans.push({ typeName, frame: selectedFrame });
      return state.plan(typeName, selectedFrame);
    },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      scopes.push({ base, scope });
      return { ...base, evaluateContext: { ...base.evaluateContext, marker: scope.draft?.id ?? "Local scope" } };
    },
    createAccountAuthoringSession() { throw new Error("A Local numeric request must not construct an account frame."); },
  };
  const api = new Function(...Object.keys(bindings), `${workerCode}; return {
    run, cancelled,
    install(selected, local = true) { base = selected; localFieldSource = local ? { sourceId: "tab-a", snapshot: {} } : undefined; },
    installModule(name, selected) { moduleContexts.set(name, { catalog: [], session: selected }); },
  };`)(...Object.values(bindings));
  api.install(session);
  let nextId = 10;
  const payload = () => ({ method: "decode-reader-numeric-text", contextId: 0, codec: codec(), value: "source lexeme" });
  const answer = id => replies.find(reply => reply.id === id && "ok" in reply);
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  async function run(extra = {}) {
    const id = nextId++;
    const pending = api.run({ id, ...payload(), ...extra });
    await release(); await pending;
    return answer(id);
  }
  return { api, calls, plans, copies, replies, scopes, registry, frame, session, state, payload, answer, release, run };
}

describe("Local numeric text worker receiver", () => {
  test("codec availability belongs to the exact scoped source frame and distinguishes an absent codec from refusal", async () => {
    const h = fixture();
    const selected = codec().methods;
    h.state.plan = () => selected;
    const scope = { sourceId: "tab-a", functions: [], draft: { id: "codec frame" } };
    const answer = await h.run({ method: "project-reader-numeric-codec", typeName: "ExactOwner", contextId: 4, scope });
    expect(answer).toMatchObject({ ok: true, result: { codec: selected } });
    expect(answer.result.codec).not.toBe(selected);
    expect(h.plans).toEqual([{ typeName: "ExactOwner", frame: expect.objectContaining({ marker: "codec frame" }) }]);
    expect(h.plans[0].frame).not.toBe(h.frame);
    h.state.plan = () => undefined;
    const missing = await h.run({ method: "project-reader-numeric-codec", typeName: "NoCodec" });
    expect(missing.ok).toBe(true);
    expect(Object.hasOwn(missing.result, "codec")).toBe(true);
    expect(missing.result.codec).toBeUndefined();
    expect(h.plans[1]).toEqual({ typeName: "NoCodec", frame: h.frame });
    expect(h.copies.map(copy => [copy.label, copy.mode])).toEqual([
      ["worker reader numeric codec request", "equality"], ["worker reader numeric codec result", "equality"],
      ["worker reader numeric codec request", "equality"], ["worker reader numeric codec result", "equality"],
    ]);
    expect(h.calls).toHaveLength(0);
  });

  test("codec availability rejects malformed or hidden packets, source failures and cancellation", async () => {
    const h = fixture();
    h.api.install(h.session, false);
    expect((await h.run({ method: "project-reader-numeric-codec", typeName: "Number" })).error).toContain("Local numeric text tools");
    h.api.install(h.session);
    expect((await h.run({ method: "project-reader-numeric-codec", typeName: 3 })).error).toContain("could not be read");
    expect(h.plans).toHaveLength(0);
    let reads = 0;
    const accessor = Object.defineProperty({ id: 79, method: "project-reader-numeric-codec", contextId: 0 },
      "typeName", { enumerable: true, get() { reads++; return "Number"; } });
    const unread = h.api.run(accessor);
    await h.release(); await unread;
    expect(h.answer(79).error).toContain("accessor");
    expect(reads).toBe(0);
    expect(h.plans).toHaveLength(0);
    h.state.plan = () => Object.defineProperty(codec().methods, "hidden", { value: "must not erase" });
    expect((await h.run({ method: "project-reader-numeric-codec", typeName: "Number" })).error).toContain("non-enumerable");
    h.state.plan = () => { throw new Error("Exact source availability refusal"); };
    expect((await h.run({ method: "project-reader-numeric-codec", typeName: "Number" })).error).toBe("Exact source availability refusal");
    const count = h.plans.length;
    const pending = h.api.run({ id: 78, method: "project-reader-numeric-codec", contextId: 0, typeName: "Number" });
    h.api.cancelled.add(78);
    await h.release(); await pending;
    expect(h.plans).toHaveLength(count);
    expect(h.answer(78)).toBeUndefined();
    h.state.plan = () => { h.api.cancelled.add(80); return codec().methods; };
    const completed = h.api.run({ id: 80, method: "project-reader-numeric-codec", contextId: 0, typeName: "Number" });
    await h.release(); await completed;
    expect(h.plans).toHaveLength(count + 1);
    expect(h.answer(80)).toBeUndefined();
  });

  test("decode and encode retain exact codec data, equality-sensitive value order and the selected frame", async () => {
    const h = fixture();
    const methods = codec();
    const decodedValue = { b: 2, a: 1 };
    h.state.run = () => ({ ok: true, value: decodedValue });
    const decoded = await h.run({ codec: methods });
    expect(decoded).toMatchObject({ ok: true, result: { decoded: { ok: true, value: decodedValue } } });
    expect(Object.keys(decoded.result.decoded.value)).toEqual(["b", "a"]);
    expect(decoded.result.decoded.value).not.toBe(decodedValue);
    expect(h.calls[0]).toMatchObject({ direction: "decode", value: "source lexeme" });
    expect(h.calls[0].session).toBe(h.session);
    expect(h.calls[0].session.evaluateContext).toBe(h.frame);
    expect(h.calls[0].codec).toEqual(methods);
    expect(h.calls[0].codec).not.toBe(methods);
    const input = { b: 2, a: 1 };
    h.state.run = () => ({ ok: true, value: "exact source text" });
    const encoded = await h.run({ method: "encode-reader-numeric-text", codec: { typeName: "Rational" }, value: input });
    expect(encoded).toMatchObject({ ok: true, result: { encoded: { ok: true, value: "exact source text" } } });
    expect(Object.keys(h.calls[1].value)).toEqual(["b", "a"]);
    expect(h.calls[1].value).not.toBe(input);
    expect(h.calls[1].codec).toEqual({ typeName: "Rational" });
    expect(h.calls[1].direction).toBe("encode");
    expect(h.copies.map(copy => [copy.label, copy.mode])).toEqual([
      ["worker reader numeric text request", "equality"], ["worker reader numeric text result", "equality"],
      ["worker reader numeric text request", "equality"], ["worker reader numeric text result", "equality"],
    ]);
  });

  test("scoped and cached requests invoke the current full session, including module frames", async () => {
    const h = fixture();
    const scope = { sourceId: "tab-a", functions: [], draft: { id: "admitted draft" } };
    expect((await h.run({ contextId: 4, scope })).ok).toBe(true);
    const selected = h.calls[0].session;
    expect(selected.registry).toBe(h.registry);
    expect(selected.evaluateContext.marker).toBe("admitted draft");
    expect(h.scopes).toEqual([{ base: h.session, scope }]);
    expect((await h.run({ contextId: 4 })).ok).toBe(true);
    expect(h.calls[1].session).toBe(selected);
    const module = { ...h.session, evaluateContext: { marker: "module frame" } };
    h.api.installModule("chosen", module);
    expect((await h.run({ sourceModule: "chosen" })).ok).toBe(true);
    expect(h.calls[2].session).toBe(module);
    expect(h.frame._activeTags).toEqual(["tab-a"]);
  });

  test("public or account initialization, unready workers and missing contexts refuse before codec invocation", async () => {
    const h = fixture();
    h.api.install(h.session, false);
    expect((await h.run()).error).toContain("Local numeric text tools are unavailable");
    h.api.install(h.session);
    expect(await h.run({ contextId: 77 })).toMatchObject({ ok: false, code: "context-missing" });
    h.api.install(undefined);
    expect((await h.run()).error).toContain("editing worker is not ready");
    expect(h.calls).toHaveLength(0);
  });

  test("malformed codec envelopes and nontext decode arguments refuse before the codec", async () => {
    const h = fixture();
    for (const extra of [
      { codec: undefined }, { codec: null }, { codec: [] }, { codec: "Number" }, { codec: {} },
      { codec: { typeName: 2 } }, { codec: { typeName: "Number", methods: {} } },
      { codec: { methods: null } }, { codec: { methods: [] } }, { value: 2 },
    ]) {
      expect(await h.run(extra)).toMatchObject({ ok: false, error: expect.stringContaining("could not be read") });
    }
    expect(h.calls).toHaveLength(0);
  });

  test("hidden data, accessors and host callables cannot disappear before codec invocation", async () => {
    const h = fixture();
    let reads = 0;
    const accessor = Object.defineProperty({}, "decode", { enumerable: true, get() { reads++; return { $ref: "hidden" }; } });
    for (const extra of [
      { codec: { methods: accessor } },
      { codec: { methods: { decode: () => true, encode: { $ref: "source.encode" } } } },
      { codec: Object.defineProperty(codec(), "hidden", { value: "retained codec" }) },
      { method: "encode-reader-numeric-text", value: Object.defineProperty({ b: 2, a: 1 }, "hidden", { value: "retained value" }) },
    ]) expect((await h.run(extra)).ok).toBe(false);
    expect(reads).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("source failures remain inert results and malformed or hidden output is refused", async () => {
    const h = fixture();
    h.state.run = () => ({ ok: false, error: "Exact Fenel codec issue" });
    expect((await h.run()).result.decoded).toEqual({ ok: false, error: "Exact Fenel codec issue" });
    expect((await h.run({ method: "encode-reader-numeric-text", value: 5 })).result.encoded)
      .toEqual({ ok: false, error: "Exact Fenel codec issue" });
    h.state.run = () => ({ ok: true, value: 5 });
    expect((await h.run({ method: "encode-reader-numeric-text", value: 5 })).error).toContain("result could not be read");
    h.state.run = () => ({ ok: true, value: Object.defineProperty({ a: 1 }, "hidden", { value: "must not erase" }) });
    expect((await h.run()).error).toContain("non-enumerable");
    h.state.run = () => ({ ok: true, value: { host: () => true } });
    expect((await h.run()).error).toContain("executable transport");
    let reads = 0;
    h.state.run = () => ({ ok: true, value: Object.defineProperty({}, "value", { enumerable: true, get() { reads++; return 4; } }) });
    expect((await h.run()).error).toContain("accessor");
    expect(reads).toBe(0);
  });

  test("cancellation before invocation or during completion suppresses all numeric result replies", async () => {
    const h = fixture();
    const id = 71;
    const pending = h.api.run({ id, ...h.payload() });
    h.api.cancelled.add(id);
    await h.release(); await pending;
    expect(h.calls).toHaveLength(0);
    expect(h.answer(id)).toBeUndefined();
    h.state.run = () => { h.api.cancelled.add(72); return { ok: true, value: "cancelled after codec" }; };
    const completed = h.api.run({ id: 72, ...h.payload() });
    await h.release(); await completed;
    expect(h.calls).toHaveLength(1);
    expect(h.answer(72)).toBeUndefined();
    expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, 72]);
  });
});
