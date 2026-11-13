import { describe, expect, test } from "bun:test";

// Execute the actual receiver and strict copier with controlled semantic and
// host ports. Source helper tests own constructor interpretation and physical
// field choice; these controls prove reader binding and faithful transport.
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
  throw new Error("The reader record receiver fixture boundary moved.");
const workerCode = compile(workerSource.slice(workerStart)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const project = "project-reader-record-slots", edit = "edit-reader-record-field", methods = [project, edit];
const ok = value => ({ $tag: "Ok", _0: value });
const err = value => ({ $tag: "Err", _0: value });
const just = value => ({ $tag: "Just", _0: value });
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry, enumerable: false });

function fixture() {
  const calls = [], representations = [], lowerResolutions = [], copies = [], replies = [], turns = [], scopeCalls = [];
  const registry = { marker: "Local checked registry" };
  const constructors = { ReaderRecord: ["title", "count"] };
  const frame = { marker: "Local reader frame", _constructors: constructors, _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const state = {
    slots: () => [{ field: "title", slot: ok({ wire: "_0", value: just("owner observed") }) }],
    edit: () => ok({ $tag: "ReaderRecord", _0: "owner edited", _1: 7 }),
    lower: () => ({ $ref: "selected-lower" }),
    representation: selected => ({ ...selected, marker: "representation reader", selected }),
  };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: value => replies.push(structuredClone(value)) },
    registryTransportSnapshot(value, label, mode) {
      copies.push({ value, label, mode });
      return transport(value, label, mode);
    },
    fieldRecordSlotsPlan(value, fields, selectedFrame) {
      calls.push({ method: project, value, fields, frame: selectedFrame });
      return state.slots(value, fields, selectedFrame);
    },
    fieldRecordEditPlan(value, field, edited, selectedFrame) {
      calls.push({ method: edit, value, field, edited, frame: selectedFrame });
      return state.edit(value, field, edited, selectedFrame);
    },
    resolveRuntimeRepresentationMethod(selectedFrame, typeName, field) {
      lowerResolutions.push({ frame: selectedFrame, typeName, field });
      return state.lower(selectedFrame, typeName, field);
    },
    runtimeRepresentationNativeContext(selectedFrame, typeName) {
      const derived = state.representation(selectedFrame, typeName);
      representations.push({ frame: selectedFrame, typeName, derived });
      return derived;
    },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      const selected = { ...base, registry: { marker: "scoped checked registry" },
        evaluateContext: { marker: scope.draft?.id ?? "scoped reader frame",
          _constructors: { ScopedRecord: ["different", "fields"] } } };
      scopeCalls.push({ base, scope, selected });
      return selected;
    },
    createAccountAuthoringSession() { throw new Error("Unexpected account scope in Local record controls."); },
  };
  const api = new Function(...Object.keys(bindings), `${workerCode}; return {
    run, cancelled,
    install(session, local = true) {
      base = session;
      localFieldSource = local ? { sourceId: "tab-a", snapshot: { owners: [], fields: [], facets: [] } } : undefined;
    },
    installContext(id, session) { contexts.set(id, session); },
    installModule(name, session) { moduleContexts.set(name, { catalog: [], session }); },
  };`)(...Object.values(bindings));
  api.install(session);
  let nextId = 10;
  const answer = id => replies.find(reply => reply.id === id && "ok" in reply);
  const payload = method => ({ method, contextId: 0, value: { $tag: "ReaderRecord", _0: "before", _1: 7 },
    ...(method === project ? { fields: ["title"] } : { field: "title", edited: "after" }) });
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  async function run(method, extra = {}) {
    const id = nextId++, request = { id, ...payload(method), ...extra };
    const pending = api.run(request);
    await release(); await pending;
    return answer(id);
  }
  return { api, session, registry, frame, constructors, calls, representations, lowerResolutions, copies, replies,
    scopeCalls, state, payload, answer, release, run, start: request => api.run(request) };
}

describe("Local record worker receiver", () => {
  test("projects the copied raw constructor once with ordered duplicate fields and exact reader metadata", async () => {
    const h = fixture(), shared = { z: 2, a: 1 };
    const value = { $tag: "ReaderRecord", _0: shared, _1: 7, extra: shared };
    const fields = ["count", "missing", "title", "title"];
    const repeated = { field: "title", slot: ok({ wire: "_0", value: just(shared) }) };
    const result = [{ field: "count", slot: ok({ wire: "_1", value: just(7) }) },
      { field: "missing", slot: err("owner refused this field") }, repeated, repeated];
    h.state.slots = () => result;
    const answer = await h.run(project, { value, fields, registry: { marker: "forged registry" },
      evaluateContext: { _constructors: { ReaderRecord: ["forged"] } }, owner: "foreign" });
    expect(answer.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0];
    expect(call.frame).toBe(h.frame);
    expect(call.frame._constructors).toBe(h.constructors);
    expect(call.fields).toEqual(fields);
    expect(call.fields).not.toBe(fields);
    expect(call.value).toEqual(value);
    expect(call.value).not.toBe(value);
    expect(call.value._0).toBe(call.value.extra);
    expect(Object.keys(call.value._0)).toEqual(["z", "a"]);
    expect(h.representations).toHaveLength(0);
    expect(h.lowerResolutions).toHaveLength(0);
    expect(answer.result.recordSlots).toEqual(result);
    expect(answer.result.recordSlots).not.toBe(result);
    expect(answer.result.recordSlots[2]).toBe(answer.result.recordSlots[3]);
    expect(answer.result.recordSlots.map(row => row.field)).toEqual(fields);
    expect(answer.result.recordSlots[2].slot._0.wire).toBe("_0");
    expect(Object.keys(answer.result.recordSlots[2].slot._0.value._0)).toEqual(["z", "a"]);
    expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
      { label: "worker reader record request", mode: "equality" },
      { label: "worker reader record slots result", mode: "equality" },
    ]);
  });

  test("record edits forward the raw carrier, requested field and edited value without changing physical aliases", async () => {
    const h = fixture(), shared = { z: 2, a: 1 };
    const value = { $tag: "ReaderRecord", _0: shared, _1: 7, extra: shared };
    h.state.edit = () => ok({ $tag: "ReaderRecord", _0: shared, _1: 7, extra: shared });
    const answer = await h.run(edit, { value, field: "title", edited: shared,
      evaluateContext: { marker: "forged reader" }, registry: { marker: "forged registry" } });
    expect(answer.ok).toBe(true);
    const call = h.calls[0];
    expect(call.frame).toBe(h.frame);
    expect(call.frame._constructors).toBe(h.constructors);
    expect(call.field).toBe("title");
    expect(call.value).toEqual(value);
    expect(call.value).not.toBe(value);
    expect(call.edited).toBe(call.value._0);
    expect(call.edited).toBe(call.value.extra);
    expect(answer.result.edit).toEqual(ok(value));
    const result = answer.result.edit._0;
    expect(Object.hasOwn(result, "_0")).toBe(true);
    expect(Object.hasOwn(result, "title")).toBe(false);
    expect(result._0).toBe(result.extra);
    expect(result._0).not.toBe(shared);
    expect(Object.keys(result._0)).toEqual(["z", "a"]);
    expect(h.representations).toHaveLength(0);
    expect(h.lowerResolutions).toHaveLength(0);
    expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
      { label: "worker reader record request", mode: "equality" },
      { label: "worker reader record edit result", mode: "equality" },
    ]);
  });

  test("scoped, cached and module jobs select their exact constructor frame", async () => {
    for (const method of methods) {
      const h = fixture(), scope = { sourceId: "tab-a", functions: [], draft: { id: "draft reader" } };
      expect((await h.run(method, { contextId: 4, scope })).ok).toBe(true);
      const selected = h.scopeCalls[0].selected;
      expect(h.scopeCalls[0].base).toBe(h.session);
      expect(h.scopeCalls[0].scope).toBe(scope);
      expect(h.calls[0].frame).toBe(selected.evaluateContext);
      expect(h.calls[0].frame._constructors).toBe(selected.evaluateContext._constructors);
      expect((await h.run(method, { contextId: 4 })).ok).toBe(true);
      expect(h.calls[1].frame).toBe(selected.evaluateContext);
      const module = { ...h.session, registry: { marker: "module checked registry" },
        evaluateContext: { marker: "module reader", _constructors: { ModuleRecord: ["module field"] } } };
      h.api.installModule("chosen", module);
      expect((await h.run(method, { sourceModule: "chosen" })).ok).toBe(true);
      expect(h.calls[2].frame).toBe(module.evaluateContext);
      expect(h.frame._activeTags).toEqual(["tab-a"]);
    }
  });

  test("representation context is derived from the selected reader and exact requested type name", async () => {
    for (const method of methods) {
      const h = fixture(), scope = { sourceId: "tab-a", functions: [], draft: { id: "scoped representation reader" } };
      const answer = await h.run(method, { contextId: 4, scope, representationTypeName: "Original.Representation",
        representationContext: { marker: "forged representation frame" }, evaluateContext: { marker: "forged frame" } });
      expect(answer.ok).toBe(true);
      expect(h.representations).toHaveLength(1);
      const observation = h.representations[0], selected = h.scopeCalls[0].selected.evaluateContext;
      // This observes the receiver's guard port. The real native-context
      // helper can perform its own canonical resolution during derivation.
      expect(h.lowerResolutions).toEqual([{ frame: selected, typeName: "Original.Representation", field: "lower" }]);
      expect(observation.frame).toBe(selected);
      expect(observation.typeName).toBe("Original.Representation");
      expect(h.calls[0].frame).toBe(observation.derived);
      expect(h.calls[0].frame.selected).toBe(selected);
      expect(h.calls[0].frame._constructors).toBe(selected._constructors);
      expect(h.frame.marker).toBe("Local reader frame");
    }
  });

  test("an unavailable representation refuses before native context derivation or record projection", async () => {
    for (const method of methods) for (const scenario of ["empty", "unknown", "NoInstance", "resolver-error"]) {
      const h = fixture();
      h.state.lower = () => {
        if (scenario === "resolver-error") throw new Error("complete representation selection unavailable");
        // The public resolver unwraps NoInstance to undefined; it never
        // exposes the dispatch protocol's ADT to this receiver.
        return undefined;
      };
      const scope = { sourceId: "tab-a", functions: [], draft: { id: "guard-selected-reader" } };
      const representationTypeName = scenario === "empty" ? "" : scenario;
      const answer = await h.run(method, { contextId: 4, scope, representationTypeName });
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
      expect(answer.error).toContain(scenario === "resolver-error" ? "complete representation selection unavailable" : "record representation is unavailable");
      expect(h.calls).toHaveLength(0);
      expect(h.representations).toHaveLength(0);
      if (scenario === "empty") expect(h.lowerResolutions).toHaveLength(0);
      else expect(h.lowerResolutions).toEqual([{ frame: h.scopeCalls[0].selected.evaluateContext,
        typeName: representationTypeName, field: "lower" }]);
    }
  });

  test("an admitted native lower without a function specification may retain the selected base frame", async () => {
    for (const method of methods) {
      const h = fixture();
      h.state.lower = () => ({ $ref: "native-lower-without-function-spec" });
      h.state.representation = selected => selected;
      const answer = await h.run(method, { representationTypeName: "NativeLeaf" });
      expect(answer.ok).toBe(true);
      expect(h.frame.getFunction).toBeUndefined();
      expect(h.lowerResolutions).toEqual([{ frame: h.frame, typeName: "NativeLeaf", field: "lower" }]);
      expect(h.representations[0]).toEqual({ frame: h.frame, typeName: "NativeLeaf", derived: h.frame });
      expect(h.calls[0].frame).toBe(h.frame);
      expect(answer.result).toBeDefined();
    }
  });

  test("public/account initialization, missing contexts and unready workers refuse before semantic work", async () => {
    for (const method of methods) {
      const h = fixture();
      h.api.install(h.session, false);
      const nonLocal = await h.run(method, { sourceId: "tab-a", localSourceId: "tab-a" });
      expect(nonLocal.ok).toBe(false);
      expect(nonLocal.error).toContain("Local");
      h.api.install(h.session);
      const missing = await h.run(method, { contextId: 77 });
      expect(missing.ok).toBe(false);
      expect(missing.code).toBe("context-missing");
      h.api.install(undefined);
      expect((await h.run(method)).error).toContain("editing worker is not ready");
      expect(h.calls).toHaveLength(0);
      expect(h.representations).toHaveLength(0);
      expect(h.lowerResolutions).toHaveLength(0);
    }
  });

  test("malformed field requests refuse source helpers and malformed representation selectors refuse frame derivation", async () => {
    const h = fixture();
    for (const fields of [undefined, null, "title", {}, [1], ["title", null]]) {
      const answer = await h.run(project, { fields });
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    for (const field of [undefined, null, 1, ["title"], {}]) {
      const answer = await h.run(edit, { field });
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    for (const method of methods) {
      for (const representationTypeName of [null, 1, [], {}]) {
        expect((await h.run(method, { representationTypeName })).ok).toBe(false);
      }
    }
    expect(h.calls).toHaveLength(0);
    expect(h.representations).toHaveLength(0);
    expect(h.lowerResolutions).toHaveLength(0);
  });

  test("empty projections and source-owned misses or edit refusals stay unchanged", async () => {
    const h = fixture();
    h.state.slots = () => [];
    expect((await h.run(project, { fields: [] })).result.recordSlots).toEqual([]);
    expect(h.calls[0].fields).toEqual([]);
    const missing = [{ field: "missing", slot: ok({ wire: "missing", value: { $tag: "Nothing" } }) },
      { field: "ambiguous", slot: err("duplicate physical field spelling") }];
    h.state.slots = () => missing;
    expect((await h.run(project, { fields: ["missing", "ambiguous"] })).result.recordSlots).toEqual(missing);
    h.state.edit = () => err("duplicate physical field spelling");
    const refused = await h.run(edit);
    expect(refused.ok).toBe(true);
    expect(refused.result.edit).toEqual(err("duplicate physical field spelling"));
    expect(Object.hasOwn(refused.result, "recordSlots")).toBe(false);
  });

  test("strict equality requests reject hidden, executable and accessor data without reading getters", async () => {
    for (const method of methods) {
      const h = fixture();
      let reads = 0;
      const accessor = {};
      Object.defineProperty(accessor, "_0", { enumerable: true, get() { reads++; return "hidden"; } });
      const cycle = {}; cycle.self = cycle;
      for (const value of [hidden({ title: 1 }, "hidden", 2), hidden([1], "hidden", 2), accessor,
        { host: () => true }, cycle, new Map()]) {
        const answer = await h.run(method, { value });
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/non-enumerable|array properties|accessor|executable|cyclic|non-plain/);
      }
      if (method === edit) {
        expect((await h.run(edit, { edited: hidden({ z: 1 }, "hidden", 2) })).ok).toBe(false);
      } else {
        const fields = [];
        Object.defineProperty(fields, "0", { enumerable: true, get() { reads++; return "title"; } });
        expect((await h.run(project, { fields })).ok).toBe(false);
      }
      expect(reads).toBe(0);
      expect(h.calls).toHaveLength(0);
      expect(h.representations).toHaveLength(0);
      expect(h.lowerResolutions).toHaveLength(0);
    }
  });

  test("strict equality replies reject unreadable helper data without a partial result", async () => {
    for (const method of methods) {
      const h = fixture(), key = method === project ? "slots" : "edit";
      let reads = 0;
      const accessor = {};
      Object.defineProperty(accessor, "wire", { enumerable: true, get() { reads++; return "_0"; } });
      for (const value of [hidden({ z: 1 }, "hidden", 2), hidden([1], "hidden", 2), accessor, { host: () => true }]) {
        h.state[key] = () => method === project ? [{ field: "title", slot: ok({ wire: "_0", value: just(value) }) }]
          : ok(value);
        const answer = await h.run(method);
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/non-enumerable|array properties|accessor|executable/);
        expect(answer.result).toBeUndefined();
      }
      expect(reads).toBe(0);
      expect(h.replies.filter(reply => "ok" in reply).every(reply => reply.ok === false)).toBe(true);
    }
  });

  test("source or representation-context errors never fabricate successful output", async () => {
    for (const method of methods) {
      const h = fixture(), key = method === project ? "slots" : "edit";
      h.state[key] = () => { throw new Error("selected constructor owner refused"); };
      const refused = await h.run(method);
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain("selected constructor owner refused");
      expect(refused.result).toBeUndefined();
      h.state.representation = () => { throw new Error("representation owner unavailable"); };
      const unavailable = await h.run(method, { representationTypeName: "Original.Representation" });
      expect(unavailable.ok).toBe(false);
      expect(unavailable.error).toContain("representation owner unavailable");
      expect(h.calls).toHaveLength(1);
    }
  });

  test("cancellation before the semantic turn and during completion suppresses all result packets", async () => {
    for (const method of methods) {
      const h = fixture(), id = 71;
      const pending = h.start({ id, ...h.payload(method), representationTypeName: "Original.Representation" });
      h.api.cancelled.add(id);
      await h.release(); await pending;
      expect(h.calls).toHaveLength(0);
      expect(h.representations).toHaveLength(0);
      expect(h.lowerResolutions).toHaveLength(0);
      expect(h.answer(id)).toBeUndefined();
      const completedId = 72, key = method === project ? "slots" : "edit";
      h.state[key] = () => {
        h.api.cancelled.add(completedId);
        return method === project ? [] : ok({});
      };
      const completed = h.start({ id: completedId, ...h.payload(method) });
      await h.release(); await completed;
      expect(h.calls).toHaveLength(1);
      expect(h.answer(completedId)).toBeUndefined();
      expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, completedId]);
    }
  });
});
