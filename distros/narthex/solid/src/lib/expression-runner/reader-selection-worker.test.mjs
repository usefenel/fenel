import { describe, expect, test } from "bun:test";

// Run the actual worker receiver and strict copier with controlled semantic
// adapters. These controls establish reader routing and transport fidelity;
// Fenel's existing selection/edit plans retain their own semantic tests.
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
  throw new Error("The reader selection receiver fixture boundary moved.");
const workerCode = compile(workerSource.slice(workerStart)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const choice = "project-reader-choice-selection";
const list = "project-reader-list-selection";
const edit = "edit-reader-list-chips";
const methods = [choice, list, edit];
const just = value => ({ $tag: "Just", _0: value });
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry, enumerable: false });

function fixture() {
  const calls = [], copies = [], replies = [], turns = [], scopeCalls = [];
  const registry = { marker: "Local registry" };
  const frame = { marker: "Local reader frame", _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const state = {
    choice: () => ({ selectedIndex: just(0) }),
    list: () => ({ occurrences: [just(0)], selected: [true] }),
    edit: (_type, value) => ({ $tag: "Ok", _0: value }),
  };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: value => replies.push(structuredClone(value)) },
    registryTransportSnapshot(value, label, mode) {
      copies.push({ value, label, mode });
      return transport(value, label, mode);
    },
    fieldChoiceSelectionPlan(options, value, selectedFrame) {
      const call = { method: choice, options, value, frame: selectedFrame };
      calls.push(call);
      return state.choice(options, value, selectedFrame);
    },
    fieldListChipsSelectionPlan(options, value, selectedFrame) {
      const call = { method: list, options, value, frame: selectedFrame };
      calls.push(call);
      return state.list(options, value, selectedFrame);
    },
    fieldListChipsEditPlan(type, value, action, selectedFrame, selectedRegistry, declarationType) {
      const call = { method: edit, type, value, action, frame: selectedFrame,
        registry: selectedRegistry, declarationType };
      calls.push(call);
      return state.edit(type, value, action, selectedFrame, selectedRegistry, declarationType);
    },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      const selected = { ...base, registry: { marker: "draft registry" },
        evaluateContext: { marker: scope.draft?.id ?? "scoped reader frame" } };
      scopeCalls.push({ base, scope, selected });
      return selected;
    },
    createAccountAuthoringSession() { throw new Error("Unexpected account scope in a Local selection fixture."); },
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
  const payload = method => method === edit
    ? { method, contextId: 0, type: { $ref: "ChoiceList" }, value: [{ z: 1, a: 2 }],
      action: { $tag: "FieldListRemoveOccurrence", index: 0, expected: { z: 1, a: 2 } },
      declarationType: { $ref: "DeclaredChoices" } }
    : { method, contextId: 0, options: [{ label: "First", value: { z: 1, a: 2 } }],
      value: method === list ? [{ z: 1, a: 2 }] : { z: 1, a: 2 } };
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
  return { api, session, registry, frame, calls, copies, replies, scopeCalls, state, payload,
    answer, release, run, start: request => api.run(request) };
}

describe("Local selection worker receiver", () => {
  test("choice and list selection forward copied options and raw values to the exact reader frame", async () => {
    for (const method of [choice, list]) {
      const h = fixture(), raw = { z: { second: 2, first: 1 }, a: undefined };
      const options = [{ label: "Second", value: raw }, { label: "Duplicate", value: raw }];
      const value = method === list ? [raw, raw] : raw;
      const answer = await h.run(method, { options, value, registry: { marker: "forged registry" },
        evaluateContext: { marker: "forged frame" } });
      expect(answer.ok).toBe(true);
      expect(h.calls).toHaveLength(1);
      const call = h.calls[0];
      expect(call.method).toBe(method);
      expect(call.frame).toBe(h.frame);
      expect(call.options).toEqual(options);
      expect(call.options).not.toBe(options);
      expect(call.options[0].value).not.toBe(raw);
      expect(call.options[0].value).toBe(call.options[1].value);
      expect(method === list ? call.value[0] : call.value).toBe(call.options[0].value);
      expect(method === list ? call.value[1] : call.value).toBe(call.options[0].value);
      expect(Object.keys(call.options[0].value)).toEqual(["z", "a"]);
      expect(Object.keys(call.options[0].value.z)).toEqual(["second", "first"]);
      expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
        { label: "worker reader selection request", mode: "equality" },
        { label: "worker reader selection result", mode: "equality" },
      ]);
      expect(answer.result).toEqual(method === choice
        ? { selection: { selectedIndex: just(0) } }
        : { selection: { occurrences: [just(0)], selected: [true] } });
    }
  });

  test("list edits forward the selected registry, raw type, declaration and exact action carrier", async () => {
    const h = fixture(), expected = { z: 1, a: 2 }, value = [expected];
    const type = { $ref: "RuntimeChoices" }, declarationType = { $ref: "DeclaredChoices" };
    const action = { $tag: "FieldListToggleChoice", index: 3, expected };
    const answer = await h.run(edit, { type, declarationType, action, value });
    expect(answer.ok).toBe(true);
    const call = h.calls[0];
    expect(call.frame).toBe(h.frame);
    expect(call.registry).toBe(h.registry);
    expect(call.type).toEqual(type);
    expect(call.type).not.toBe(type);
    expect(call.declarationType).toEqual(declarationType);
    expect(call.declarationType).not.toBe(declarationType);
    expect(call.action).toEqual(action);
    expect(call.action).not.toBe(action);
    expect(call.action.expected).toBe(call.value[0]);
    expect(call.value).not.toBe(value);
    expect(answer.result.edit).toEqual({ $tag: "Ok", _0: value });
    expect(answer.result.edit._0).not.toBe(call.value);
    expect(Object.keys(answer.result.edit._0[0])).toEqual(["z", "a"]);
    expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
      { label: "worker reader selection request", mode: "equality" },
      { label: "worker reader list edit result", mode: "equality" },
    ]);
    expect((await h.run(edit, { declarationType: undefined })).ok).toBe(true);
    expect(h.calls[1].declarationType).toBeUndefined();
  });

  test("scoped, cached and module operations retain their selected frame and registry", async () => {
    for (const method of methods) {
      const h = fixture(), scope = { sourceId: "tab-a", functions: [], draft: { id: "draft frame" } };
      expect((await h.run(method, { contextId: 4, scope })).ok).toBe(true);
      const selected = h.scopeCalls[0].selected;
      expect(h.scopeCalls[0].base).toBe(h.session);
      expect(h.scopeCalls[0].scope).toBe(scope);
      expect(h.calls[0].frame).toBe(selected.evaluateContext);
      expect((await h.run(method, { contextId: 4 })).ok).toBe(true);
      expect(h.calls[1].frame).toBe(selected.evaluateContext);
      const module = { ...h.session, registry: { marker: "module registry" },
        evaluateContext: { marker: "module frame" } };
      h.api.installModule("chosen", module);
      expect((await h.run(method, { sourceModule: "chosen" })).ok).toBe(true);
      expect(h.calls[2].frame).toBe(module.evaluateContext);
      if (method === edit) {
        expect(h.calls[0].registry).toBe(selected.registry);
        expect(h.calls[1].registry).toBe(selected.registry);
        expect(h.calls[2].registry).toBe(module.registry);
      }
      expect(h.frame._activeTags).toEqual(["tab-a"]);
    }
  });

  test("public/account initialization and unprepared or missing contexts fail closed", async () => {
    for (const method of methods) {
      const h = fixture();
      h.api.install(h.session, false);
      const nonLocal = await h.run(method, { localSourceId: "tab-a", sourceId: "tab-a" });
      expect(nonLocal.ok).toBe(false);
      expect(nonLocal.error).toContain("Local selection tools are unavailable");
      h.api.install(h.session);
      const missing = await h.run(method, { contextId: 77 });
      expect(missing.ok).toBe(false);
      expect(missing.code).toBe("context-missing");
      h.api.install(undefined);
      expect((await h.run(method)).error).toContain("editing worker is not ready");
      expect(h.calls).toHaveLength(0);
    }
  });

  test("missing and unreadable option arrays refuse before the semantic selection owner", async () => {
    for (const method of [choice, list]) {
      const h = fixture();
      for (const options of [undefined, null, "choices", {}]) {
        const answer = await h.run(method, { options });
        expect(answer.ok).toBe(false);
        expect(answer.error).toContain("selection choices could not be read");
      }
      expect(h.calls).toHaveLength(0);
    }
  });

  test("equality requests retain different record insertion orders without normalizing raw values", async () => {
    for (const method of methods) {
      const h = fixture(), first = { z: 1, a: 2 }, second = { a: 2, z: 1 };
      const options = [{ label: "First", value: first }, { label: "Second", value: second }];
      const value = method === choice ? first : [first, second];
      expect((await h.run(method, { options, value })).ok).toBe(true);
      const call = h.calls[0];
      if (method !== edit) {
        expect(Object.keys(call.options[0].value)).toEqual(["z", "a"]);
        expect(Object.keys(call.options[1].value)).toEqual(["a", "z"]);
      }
      if (method !== choice) {
        expect(Object.keys(call.value[0])).toEqual(["z", "a"]);
        expect(Object.keys(call.value[1])).toEqual(["a", "z"]);
      }
    }
  });

  test("equality requests reject hidden record fields and hidden array extras before semantic calls", async () => {
    for (const method of methods) {
      const h = fixture();
      for (const value of [hidden({ visible: 1 }, "hidden", 2), hidden([1], "hidden", 2),
        hidden([1], "0", 1)]) {
        const answer = await h.run(method, { value });
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/non-enumerable|array properties/);
      }
      const options = [{ label: "Unreadable", value: hidden({ visible: 1 }, "hidden", 2) }];
      expect((await h.run(method, method === edit
        ? { action: { $tag: "FieldListToggleChoice", index: 0, expected: options[0].value } }
        : { options })).ok).toBe(false);
      expect(h.calls).toHaveLength(0);
    }
  });

  test("strict requests reject executable, accessor, cyclic and host data without invoking accessors", async () => {
    for (const method of methods) {
      const h = fixture();
      let reads = 0;
      const accessor = {};
      Object.defineProperty(accessor, "value", { enumerable: true, get() { reads++; return 1; } });
      const cycle = {}; cycle.self = cycle;
      for (const value of [{ host: () => true }, accessor, cycle, new Map([["value", 1]])]) {
        const answer = await h.run(method, { value });
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/executable|accessor|cyclic|non-plain/);
      }
      expect(reads).toBe(0);
      expect(h.calls).toHaveLength(0);
    }
  });

  test("equality replies preserve list-edit values and shared insertion order through browser clone", async () => {
    const h = fixture(), shared = { z: { last: 2, first: 1 }, a: undefined };
    const result = { $tag: "Ok", _0: [shared, shared] };
    h.state.edit = () => result;
    const answer = await h.run(edit);
    expect(answer.ok).toBe(true);
    expect(answer.result.edit).toEqual(result);
    expect(answer.result.edit).not.toBe(result);
    expect(answer.result.edit._0[0]).not.toBe(shared);
    expect(answer.result.edit._0[0]).toBe(answer.result.edit._0[1]);
    expect(Object.keys(answer.result.edit._0[0])).toEqual(["z", "a"]);
    expect(Object.keys(answer.result.edit._0[0].z)).toEqual(["last", "first"]);
    answer.result.edit._0[0].z.last = 99;
    expect(shared.z.last).toBe(2);
  });

  test("strict equality replies refuse hidden fields, array extras, accessors and executable leaves", async () => {
    for (const method of methods) {
      const h = fixture(), stateKey = method === choice ? "choice" : method === list ? "list" : "edit";
      let reads = 0;
      const accessor = {};
      Object.defineProperty(accessor, "result", { enumerable: true, get() { reads++; return []; } });
      for (const result of [hidden({ visible: 1 }, "hidden", 2), hidden([1], "hidden", 2),
        accessor, { host: () => true }]) {
        h.state[stateKey] = () => result;
        const answer = await h.run(method);
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/non-enumerable|array properties|accessor|executable/);
      }
      expect(reads).toBe(0);
      expect(h.replies.filter(reply => "ok" in reply).every(reply => reply.ok === false)).toBe(true);
    }
  });

  test("semantic refusals and exceptions return no fabricated selection or successful edit", async () => {
    for (const method of methods) {
      const h = fixture(), stateKey = method === choice ? "choice" : method === list ? "list" : "edit";
      h.state[stateKey] = () => { throw new Error("selected reader refused semantic work"); };
      const answer = await h.run(method);
      expect(answer.ok).toBe(false);
      expect(answer.error).toContain("selected reader refused semantic work");
      expect(answer.result).toBeUndefined();
      if (method === edit) {
        h.state.edit = () => ({ $tag: "Err", _0: "current value refused" });
        expect((await h.run(edit)).result.edit).toEqual({ $tag: "Err", _0: "current value refused" });
      }
    }
  });

  test("cancellation before projection or during completion suppresses operation results", async () => {
    for (const method of methods) {
      const h = fixture(), id = 71;
      const pending = h.start({ id, ...h.payload(method) });
      h.api.cancelled.add(id);
      await h.release(); await pending;
      expect(h.calls).toHaveLength(0);
      expect(h.answer(id)).toBeUndefined();
      const completedId = 72, stateKey = method === choice ? "choice" : method === list ? "list" : "edit";
      h.state[stateKey] = () => { h.api.cancelled.add(completedId); return { cancelled: true }; };
      const completed = h.start({ id: completedId, ...h.payload(method) });
      await h.release(); await completed;
      expect(h.calls).toHaveLength(1);
      expect(h.answer(completedId)).toBeUndefined();
      expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, completedId]);
    }
  });
});

describe("strict transport own-data reader bridge", () => {
  test("reads current own data after descriptor admission while preserving order and shared copies", () => {
    const shared = { last: 2, first: 1 };
    const source = { z: "stale z", a: "stale a", again: "stale again" };
    const calls = [];
    const copied = transport(source, "bridge fixture", "equality", (owner, key) => {
      calls.push({ owner, key });
      if (owner === source) return key === "a" ? [shared] : shared;
      return owner[key];
    });
    expect(Object.keys(copied)).toEqual(["z", "a", "again"]);
    expect(Object.keys(copied.z)).toEqual(["last", "first"]);
    expect(copied.z).toEqual(shared);
    expect(copied.z).not.toBe(shared);
    expect(copied.z).toBe(copied.again);
    expect(copied.z).toBe(copied.a[0]);
    expect(calls.filter(call => call.owner === source).map(call => call.key)).toEqual(["z", "a", "again"]);
    expect(calls.filter(call => call.owner === shared).map(call => call.key)).toEqual(["last", "first"]);
    expect(source).toEqual({ z: "stale z", a: "stale a", again: "stale again" });
    copied.z.last = 9;
    expect(shared.last).toBe(2);
  });

  test("record descriptor and prototype fences reject before the first bridge read", () => {
    let getterReads = 0;
    const accessor = { first: "valid data" };
    Object.defineProperty(accessor, "later", { enumerable: true, get() { getterReads++; return 1; } });
    const symbolic = { first: "valid data", [Symbol("hidden")]: true };
    for (const value of [accessor, hidden({ first: "valid data" }, "hidden", 1), symbolic,
      new Map(), new Date(), Object.create({ first: "inherited data" })]) {
      const calls = [];
      expect(() => transport(value, "record bridge fence", "equality", (owner, key) => {
        calls.push({ owner, key });
        return owner[key];
      })).toThrow();
      expect(calls).toHaveLength(0);
    }
    expect(getterReads).toBe(0);
  });

  test("hostile bridge-returned nested data is checked before any nested accessor or read", () => {
    let getterReads = 0;
    const hostile = { first: "valid data" };
    Object.defineProperty(hostile, "later", { enumerable: true, get() { getterReads++; return 1; } });
    const source = { value: "stale data" };
    for (const returned of [hostile, hidden({ first: 1 }, "hidden", 2), { host: () => true },
      new Map(), { [Symbol("hidden")]: true }]) {
      const calls = [];
      expect(() => transport(source, "nested bridge fence", "equality", (owner, key) => {
        calls.push({ owner, key });
        return owner === source ? returned : owner[key];
      })).toThrow();
      expect(calls.every(call => call.owner === source || Object.hasOwn(call.owner, call.key))).toBe(true);
      expect(calls.some(call => call.owner === hostile)).toBe(false);
    }
    expect(getterReads).toBe(0);
    expect(() => transport(source, "cycle bridge fence", "equality", () => source)).toThrow("cyclic");
    const failure = new Error("host reader failed");
    expect(() => transport(source, "throwing bridge", "equality", () => { throw failure; })).toThrow(failure);
  });

  test("array bridge reads the current length and cells instead of stale descriptor values", () => {
    const raw = ["current first", "current second"];
    const value = new Proxy(raw, {
      getOwnPropertyDescriptor(owner, key) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        return descriptor === undefined ? undefined
          : { ...descriptor, value: key === "length" ? 0 : "stale descriptor cell" };
      },
    });
    const calls = [];
    const copied = transport(value, "live array bridge", "equality", (owner, key) => {
      calls.push({ owner, key });
      return owner[key];
    });
    expect(copied).toEqual(raw);
    expect(copied).not.toBe(raw);
    expect(calls.every(call => call.owner === value)).toBe(true);
    expect(calls.map(call => call.key)).toEqual(["length", "0", "1"]);
    expect(Object.getOwnPropertyDescriptor(value, "length").value).toBe(0);
    expect(value.length).toBe(2);
  });

  test("array extras, hidden cells and nonstandard prototypes refuse before bridge reads", () => {
    class HostArray extends Array {}
    const enumerableExtra = [1]; enumerableExtra.extra = "unreadable";
    for (const value of [hidden([1], "hidden", 2), hidden([1], "01", 2),
      hidden([1], "4294967295", 2), hidden([1], "0", 1), enumerableExtra,
      new HostArray(1, 2), Object.setPrototypeOf([1], null)]) {
      const calls = [];
      expect(() => transport(value, "array bridge fence", "equality", (owner, key) => {
        calls.push({ owner, key });
        return owner[key];
      })).toThrow();
      expect(calls).toHaveLength(0);
    }
  });

  test("invalid current array lengths and holes refuse before reading any cell", () => {
    for (const length of [-1, 1.5, NaN, Infinity, "2", undefined, 3]) {
      const value = ["first", "second"], calls = [];
      expect(() => transport(value, "invalid live length", "equality", (owner, key) => {
        calls.push({ owner, key });
        return key === "length" ? length : owner[key];
      })).toThrow();
      expect(calls.map(call => call.key)).toEqual(["length"]);
    }
    const sparse = new Array(2); sparse[0] = "first";
    const calls = [];
    expect(() => transport(sparse, "sparse live array", "equality", (owner, key) => {
      calls.push({ owner, key });
      return owner[key];
    })).toThrow();
    expect(calls.map(call => call.key)).toEqual(["length"]);
  });

  test("Bytes are cloned as native carriers without bridge reads", () => {
    for (const mode of ["canonical", "equality"]) {
      const value = new Uint8Array([0, 1, 255]);
      const copied = transport(value, "Bytes bridge fixture", mode, () => {
        throw new Error("the Bytes leaf must not consult the data reader");
      });
      expect(copied).toEqual(value);
      expect(copied).not.toBe(value);
      expect(copied.buffer).not.toBe(value.buffer);
      expect(Object.getPrototypeOf(copied)).toBe(Uint8Array.prototype);
    }
  });

  test("omitting the bridge retains canonical sorting, equality order and existing hidden-data behavior", () => {
    const shared = { second: 2, first: 1 }, source = { z: shared, a: [shared] };
    const canonical = transport(source, "unchanged default");
    expect(Object.keys(canonical)).toEqual(["a", "z"]);
    expect(Object.keys(canonical.z)).toEqual(["first", "second"]);
    expect(canonical.z).toBe(canonical.a[0]);
    const equality = transport(source, "unchanged equality", "equality");
    expect(Object.keys(equality)).toEqual(["z", "a"]);
    expect(Object.keys(equality.z)).toEqual(["second", "first"]);
    expect(equality.z).toBe(equality.a[0]);
    for (const mode of ["canonical", "equality"]) {
      expect(transport(source, "explicitly absent bridge", mode, undefined)).toEqual(
        transport(source, "omitted bridge", mode));
    }
    const hiddenRecord = hidden({ visible: 1 }, "hidden", 2), hiddenArray = hidden([1], "hidden", 2);
    expect(transport(hiddenRecord, "unchanged hidden record")).toEqual({ visible: 1 });
    expect(transport(hiddenArray, "unchanged hidden array")).toEqual([1]);
    expect(() => transport(hiddenRecord, "unchanged equality hidden record", "equality")).toThrow("non-enumerable");
    expect(() => transport(hiddenArray, "unchanged equality hidden array", "equality")).toThrow("array properties");
  });

  test("polluted descriptor value inheritance cannot turn an accessor into admitted data", () => {
    const source = { first: 1 };
    let ownGetterReads = 0, pollutedGetterReads = 0, bridgeReads = 0, failure;
    Object.defineProperty(source, "later", { enumerable: true, get() { ownGetterReads++; return 2; } });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    try {
      Object.defineProperty(Object.prototype, "value", { configurable: true,
        get() { pollutedGetterReads++; return "inherited descriptor value"; } });
      try {
        transport(source, "polluted descriptor bridge", "equality", (owner, key) => {
          bridgeReads++;
          return owner[key];
        });
      } catch (error) { failure = error; }
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "value", previous);
      else delete Object.prototype.value;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure.message).toContain("accessor");
    expect(ownGetterReads).toBe(0);
    expect(pollutedGetterReads).toBe(0);
    expect(bridgeReads).toBe(0);
  });

  test("an inherited method never becomes an own transported command field", () => {
    const source = { targets: ["first"] }, reads = [];
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "method");
    let copied, hadOwnMethod;
    try {
      Object.defineProperty(Object.prototype, "method", { configurable: true, value: choice });
      copied = transport(source, "inherited command bridge", "equality", (owner, key) => {
        reads.push({ owner, key });
        return owner[key];
      });
      hadOwnMethod = Object.hasOwn(copied, "method");
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "method", previous);
      else delete Object.prototype.method;
    }
    expect(hadOwnMethod).toBe(false);
    expect(reads.some(call => call.key === "method")).toBe(false);
    expect(Object.keys(copied)).toEqual(["targets"]);
    expect(copied).toEqual(source);
  });
});
