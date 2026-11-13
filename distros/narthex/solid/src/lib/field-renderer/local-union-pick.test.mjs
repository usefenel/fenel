import { describe, expect, test } from "bun:test";

// B4 F1: UnionEditor's case pick runs its "already selected?" check through
// the reader's worker for a Local reader whose page session throws on every
// registry/evaluator read; Account keeps the synchronous page check. While a
// Local pick waits the cases are busy and refuse further picks; a reply that
// arrives after its data or worker moved shows a short message, never a
// silent drop; unmounting publishes nothing.
const source = (await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compile = code => transpiler.transformSync(code).replace(/^export /gm, "");
function section(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < start) throw new Error(`The union pick fixture boundary moved: ${begin}`);
  return text.slice(start, finish);
}
const owner = section(source, "function localFieldSelectionWorker(", "/** Adapts the Fenel-owned edit plan");
const union = source.slice(source.indexOf("function UnionEditor("));
const pick = section(union, "function pickVariant(", "\n  return (");
const pickStart = union.indexOf("function pickVariant(");
const asyncPick = union.slice(pickStart - 6, pickStart) === "async ";
const changedCopy = /const UNION_PICK_CHANGED = ("[^"]*");/.exec(source)?.[1];
const settle = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };

function harness(kind, options = {}) {
  const pageReads = [], requests = [], published = [], errors = [], synchronous = [], busy = [];
  const token = { snapshot: "registry token" };
  const session = { label: "page session" };
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    pageReads.push(key);
    if (kind === "account") return key === "evaluateContext" ? { frame: "account" } : key === "registry" ? token : {};
    throw new Error(`Page session ${key} read for a Local reader`);
  } });
  // Hoisted: the Account session's registry is this same token.
  const foreign = { foreign: true, evaluateContext: () => ({ frame: "foreign" }) };
  let worker = { worker: "one" }, input = { input: 1 };
  const reader = { kind, session: () => session, registry: () => token };
  const lease = { callback: value => published.push(value) };
  const bindings = {
    reader, frame: () => session, presentationRegistry: () => options.foreign ? foreign : token,
    latest: read => read(), DETACHED_AUTHORING_SESSION: { detached: true },
    preparation: { input: () => input, ready: () => true,
      paint: () => ({ coordinate: { discriminator: "$tag", cases: [{ name: "A", defaultValue: { $tag: "A" } }, { name: "B", defaultValue: { $tag: "B" } }] } }) },
    publication: () => lease, tagSlot: () => ({ $tag: "Ok", _0: { value: { $tag: "Just", _0: "A" } } }), variantKey: () => "A",
    setEditError: message => errors.push(message), setPicking: value => busy.push(value),
    preparedReaderWorkerForSession: () => worker, registryHasSnapshotOwner: () => false,
    runPreparedReaderWorker: (handle, payload, signal) => new Promise(resolve => requests.push({ handle, payload, signal, resolve })),
    fieldChoiceSelectionPlan: (...args) => { synchronous.push(args); return { selectedIndex: args[0][0].value === args[1] ? { $tag: "Just", _0: 0 } : { $tag: "Nothing" } }; },
    UNION_PICK_CHANGED: changedCopy === undefined ? undefined : JSON.parse(changedCopy),
  };
  const names = Object.keys(bindings);
  const api = new Function(...names, `let alive = true, pickFlight; ${compile(owner)}\n${compile(`${asyncPick ? "async " : ""}${pick}`)};
    return { pickVariant, unmount: () => { alive = false; pickFlight?.abort(); } };`)(...names.map(name => bindings[name]));
  return { run: api.pickVariant, unmount: api.unmount, pageReads, requests, published, errors, synchronous, busy,
    changeValue: () => { input = { input: 2 }; }, replaceWorker: () => { worker = { worker: "two" }; }, worker: () => worker };
}
const unselected = { selection: { selectedIndex: { $tag: "Nothing" } } };

describe("B4 F1: Local union case pick", () => {
  test("a Local pick asks the worker, shows busy, and publishes only after its answer", async () => {
    const h = harness("local");
    const flight = h.run("B"); await settle();
    expect(h.pageReads).toEqual([]);
    expect(h.synchronous).toEqual([]);
    expect(h.requests.map(row => row.payload)).toEqual([{ method: "project-reader-choice-selection", options: [{ value: "B", label: "B" }], value: "A" }]);
    expect(h.requests[0].handle).toBe(h.worker());
    expect(h.busy).toEqual([true]);
    expect(h.published).toEqual([]);
    h.requests[0].resolve(unselected); await flight; await settle();
    expect(h.published).toEqual([{ $tag: "B" }]);
    expect(h.busy).toEqual([true, false]);
  });

  test("a second pick while one waits is refused (the cases are busy), and the first still lands", async () => {
    const h = harness("local");
    const first = h.run("B"); await settle();
    await h.run("A"); await settle();
    expect(h.requests).toHaveLength(1);
    expect(h.busy).toEqual([true]);
    h.requests[0].resolve(unselected); await first; await settle();
    expect(h.published).toEqual([{ $tag: "B" }]);
  });

  test("a value change during the check shows the changed message instead of a silent drop", async () => {
    expect(changedCopy).toBeDefined();
    const h = harness("local");
    const flight = h.run("B"); await settle();
    h.changeValue();
    h.requests[0].resolve(unselected); await flight; await settle();
    expect(h.published).toEqual([]);
    expect(h.errors).toEqual([JSON.parse(changedCopy)]);
    expect(h.busy).toEqual([true, false]);
  });

  test("a worker change during the check shows the changed message", async () => {
    const h = harness("local");
    const flight = h.run("B"); await settle();
    h.replaceWorker();
    h.requests[0].resolve(unselected); await flight; await settle();
    expect(h.published).toEqual([]);
    expect(h.errors).toEqual([JSON.parse(changedCopy)]);
  });

  test("unmounting aborts the check; nothing is published or shown", async () => {
    const h = harness("local");
    const flight = h.run("B"); await settle();
    h.unmount();
    expect(h.requests[0].signal.aborted).toBe(true);
    h.requests[0].resolve(unselected); await flight; await settle();
    expect(h.published).toEqual([]); expect(h.errors).toEqual([]);
  });

  test("a Local reselection of the current case publishes nothing", async () => {
    const h = harness("local");
    const flight = h.run("A"); await settle();
    h.requests[0].resolve({ selection: { selectedIndex: { $tag: "Just", _0: 0 } } }); await flight; await settle();
    expect(h.published).toEqual([]); expect(h.pageReads).toEqual([]);
  });

  test("a malformed Local answer refuses with copy and publishes nothing", async () => {
    const h = harness("local");
    const flight = h.run("B"); await settle();
    h.requests[0].resolve({}); await flight; await settle();
    expect(h.published).toEqual([]); expect(h.errors).toEqual(["This choice selection could not be read."]);
  });

  test("a Local reader with a foreign presentation registry checks in that registry's frame, not the page session's", async () => {
    const h = harness("local", { foreign: true });
    await h.run("B");
    expect(h.requests).toEqual([]);
    expect(h.synchronous[0][2]).toEqual({ frame: "foreign" });
    expect(h.pageReads).toEqual([]);
    expect(h.published).toEqual([{ $tag: "B" }]);
  });

  test("Account keeps its synchronous page check", async () => {
    const h = harness("account");
    await h.run("B");
    expect(h.requests).toEqual([]);
    expect(h.synchronous).toHaveLength(1);
    expect(h.published).toEqual([{ $tag: "B" }]);
  });
});
