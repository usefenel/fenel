// @ts-nocheck -- C2 extracted host callback harness; transitions use real Fenel.
import { runLocalOrdinaryOperation } from "./local-ordinary-operations";
import { captureRegistryTransportRoundTrip } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { describe, expect, test } from "bun:test";

const source = (await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const start = source.indexOf("  const saveDefinitions =");
const end = source.indexOf("  const metadata =", start);
const leaseStart = source.indexOf("  const usingOrdinary =");
const leaseEnd = source.indexOf("  const storage:", leaseStart);
const leaseCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(leaseStart, leaseEnd));
const production = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
let runtime;
async function commands() {
  return runtime ??= (async () => {
    const [{ createRegistry }, { evaluate }, { stdModule }, { pictureModule }, { viewModule }] = await Promise.all([
      import("../../../../../implementations/typescript/engine/src/registry"), import("../../../../../implementations/typescript/engine/src/json-logic"),
      import("../../../../../implementations/typescript/engine/src/modules/std"), import("../../../../../implementations/typescript/engine/src/modules/picture"),
      import("../../../../../implementations/typescript/engine/src/modules/view"),
    ]);
    const context = createRegistry([stdModule, pictureModule, viewModule]).evaluateContext();
    return (name, ...args) => evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
      Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context);
  })();
}
function accepted(result) { if (result.$tag !== "Ok") throw Error(result._0); return result._0; }
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(options = {}) {
  const call = await commands();
  const oldDefinitions = { owners: [{ kind: "function", ownerKey: "function:fn", storageName: "fn",
    definition: { id: "fn", params: [], returns: { $ref: "String" }, body: "hello" } }], fields: [], facets: [] };
  const newDefinitions = { ...oldDefinitions, owners: [{ ...oldDefinitions.owners[0],
    definition: { ...oldDefinitions.owners[0].definition, body: "hi" } }] };
  const item = { id: "occurrence", source: { kind: "expr", expr: { kind: "literal", value: { $ref: "fn" } } } };
  const initial = accepted(call("applyTabDataCommands", call("defaultTabData", "tab", { kind: "grid" }), 0, [
    { $tag: "TabSetDefinitions", definitions: oldDefinitions },
    { $tag: "TabEditRoot", command: { kind: "append", item } },
    { $tag: "TabEditValues", commands: [{ $tag: "LocusAppend", entry: { id: "saved", value: { id: "saved", slug: "",
      query: { kind: "expression", expr: { kind: "literal", value: "hello" } } } } }] },
  ]));
  const oldSnapshot = { id: "old-reader" }, newSnapshot = { id: "prepared-reader" };
  const lifetime = new AbortController();
  const calls = [], gate = deferred(), preparationEntered = deferred();
  let current = initial, currentSnapshot = oldSnapshot, publications = 0, discarded = 0;
  const prepare = async () => {
    calls.push("prepare");
    preparationEntered.resolve();
    if (options.holdPreparation) await gate.promise;
    return newSnapshot;
  };
  const make = new Function("initial", "initialSnapshot", "enqueue", "readyTools", "assertActive", "planDefinitions",
    "id", "prepareSnapshot", "lifetime", "invoke", "runLocalOrdinaryOperation", "captureRegistryTransportRoundTrip", "beginRebuild", `
    let state = initial, snapshot = initialSnapshot, publications = 0, discarded = 0;
    const stateGuard = () => { const captured = state, reader = snapshot; return () => {
      assertActive(); if (state !== captured || snapshot !== reader) throw Error("This tab data changed before this edit.");
    }; };
    const prepareOrdinary = async (operation, guard, signal) => {
      assertActive(); signal?.throwIfAborted(); guard();
      const capture = captureRegistryTransportRoundTrip(operation, "atomic fixture graph");
      if (capture.kind !== "captured") throw Error(capture.reason);
      const received = structuredClone(capture.wire);
      const value = runLocalOrdinaryOperation({ workspaceCall: invoke }, received);
      const reply = structuredClone({ operation: received, value });
      return { kind: "prepared", value: capture.reattach(reply.operation, reply.value),
        assertCurrent: () => { assertActive(); signal?.throwIfAborted(); guard(); capture.assertCurrent(); }, release: capture.release };
    };
    ${leaseCode}
    const preparePublication = (next, candidate, run) => run({ kind: "publication", args: [next, { $ref: "Anything" }, { callableLabels: [] }] });
    const publish = (next, packet, prepared) => { state = next; snapshot = prepared; publications++; };
    const discardUnpublished = candidate => { if (candidate && candidate !== snapshot) discarded++; };
    const endRebuild = candidate => discardUnpublished(candidate);
    const root = () => ({ id: state.tabId, revision: state.revision, items: state.entries.map(entry => entry.value) });
    ${production}
    return { saveDefinitions, read: () => ({ state, snapshot, publications, discarded }), external: next => { state = next; } };`);
  const boundary = make(initial, oldSnapshot, work => Promise.resolve().then(work), async () => {},
    () => lifetime.signal.throwIfAborted(), async () => { calls.push("plan"); return newDefinitions; }, "tab", prepare, lifetime,
    (name, ...args) => { calls.push(name); return call(name, ...args); }, runLocalOrdinaryOperation, captureRegistryTransportRoundTrip, () => { calls.push("retire"); });
  const card = { ...item, representations: { Iconable: { icon: "star" } } };
  const mutation = { expectedRevision: initial.revision, commands: [
    { $tag: "TabPatchValue", id: "saved", patch: { query: { kind: "expression", expr: { kind: "literal", value: "hi" } } } },
    { $tag: "TabEditRoot", command: { kind: "replace", itemId: item.id, item: card } },
  ] };
  return { call, initial, oldDefinitions, newDefinitions, oldSnapshot, newSnapshot, lifetime, calls, gate,
    preparationEntered: preparationEntered.promise, boundary, mutation, card };
}

describe("atomic local definition publication", () => {
  test("prepares definitions then publishes definition, saved data and occurrence once at the authored revision", async () => {
    const f = await fixture();
    const result = await f.boundary.saveDefinitions({}, f.lifetime.signal, f.mutation);
    const committed = f.boundary.read();
    expect(committed.state.revision).toBe(f.initial.revision + 1);
    expect(committed.state.definitions).toEqual(f.newDefinitions);
    expect(committed.state.values[0].value.query.expr.value).toBe("hi");
    expect(committed.state.entries[0].value).toEqual(f.card);
    expect(committed.snapshot).toBe(f.newSnapshot);
    expect(committed.publications).toBe(1);
    expect(result.root.revision).toBe(committed.state.revision);
    expect(f.initial.definitions).toEqual(f.oldDefinitions);
    expect(f.calls.indexOf("applyTabDataCommands")).toBeLessThan(f.calls.indexOf("plan"));
    // The published reader's worker is retired before the replacement starts.
    expect(f.calls.indexOf("retire")).toBeGreaterThan(-1);
    expect(f.calls.indexOf("retire")).toBeLessThan(f.calls.indexOf("prepare"));
    expect(f.calls.indexOf("prepare")).toBeLessThan(f.calls.lastIndexOf("tabDataRoot"));
  }, 180_000);

  test("external root or definition changes refuse the entire transaction and preserve its snapshot", async () => {
    for (const command of [
      { $tag: "TabEditRoot", command: { kind: "append", item: { id: "external", expr: { kind: "literal", value: 0 } } } },
      { $tag: "TabSetDefinitions", definitions: { owners: [], fields: [], facets: [] } },
    ]) {
      const f = await fixture();
      const external = accepted(f.call("applyTabDataCommands", f.initial, f.initial.revision, [command]));
      f.boundary.external(external);
      await expect(f.boundary.saveDefinitions({}, f.lifetime.signal, f.mutation)).rejects.toThrow("changed");
      const retained = f.boundary.read();
      expect(retained.state).toBe(external);
      expect(retained.snapshot).toBe(f.oldSnapshot);
      expect(retained.publications).toBe(0);
      expect(retained.discarded).toBe(0);
      expect(f.calls).not.toContain("plan");
      expect(f.calls).not.toContain("prepare");
    }
  }, 180_000);

  test("a revision change during preparation still refuses the final publication", async () => {
    const f = await fixture({ holdPreparation: true });
    const pending = f.boundary.saveDefinitions({}, f.lifetime.signal, f.mutation);
    await f.preparationEntered;
    const external = accepted(f.call("applyTabDataCommands", f.initial, f.initial.revision,
      [{ $tag: "TabSetDefinitions", definitions: { owners: [], fields: [], facets: [] } }]));
    f.boundary.external(external);
    f.gate.resolve();
    await expect(pending).rejects.toThrow("changed");
    expect(f.boundary.read().state).toBe(external);
    expect(f.boundary.read().snapshot).toBe(f.oldSnapshot);
    expect(f.boundary.read().publications).toBe(0);
    expect(f.boundary.read().discarded).toBe(1);
  }, 180_000);

  test("a malformed later occurrence command cannot publish an earlier definition or saved-value patch", async () => {
    const f = await fixture();
    const mutation = { ...f.mutation, commands: [...f.mutation.commands.slice(0, 1),
      { $tag: "TabEditRoot", command: { kind: "replace", itemId: "missing", item: f.card } }] };
    await expect(f.boundary.saveDefinitions({}, f.lifetime.signal, mutation)).rejects.toThrow();
    expect(f.boundary.read().state).toBe(f.initial);
    expect(f.boundary.read().snapshot).toBe(f.oldSnapshot);
    expect(f.boundary.read().publications).toBe(0);
  }, 180_000);

  test("cancellation while the checked definition snapshot prepares publishes neither half", async () => {
    const f = await fixture({ holdPreparation: true });
    const pending = f.boundary.saveDefinitions({}, f.lifetime.signal, f.mutation);
    await f.preparationEntered;
    f.lifetime.abort(Error("Reader closed")); f.gate.resolve();
    await expect(pending).rejects.toThrow("Reader closed");
    const retained = f.boundary.read();
    expect(retained.state).toBe(f.initial);
    expect(retained.snapshot).toBe(f.oldSnapshot);
    expect(retained.publications).toBe(0);
    expect(retained.discarded).toBe(1);
  }, 180_000);
});
