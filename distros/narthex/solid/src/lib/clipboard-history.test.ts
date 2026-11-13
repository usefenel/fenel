import { captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
// C2: exercise the source Fenel transitions, including ordinary list edits.
import { runLocalOrdinaryOperation } from "./local-ordinary-operations";
import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../../../../implementations/typescript/engine/src/registry";
import { evaluate } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdModule } from "../../../../../implementations/typescript/engine/src/modules/std";
import { pictureModule } from "../../../../../implementations/typescript/engine/src/modules/picture";
import { viewModule } from "../../../../../implementations/typescript/engine/src/modules/view";
import { decodeTransferItem, encodeTransferItem } from "./data-transfer";
import { prepareTransferItem } from "./data-transfer/type-candidate";
import { expressionForTransfer } from "./data-transfer/expressions";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { Anything, List } from "@fenel/engine/type-foundation";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { surfaceLayoutRenderPlan } from "@fenel/engine/authoring/surface";
import { recordFieldsForType } from "@fenel/engine/authoring/expression";
import { typePhrase } from "@fenel/engine/authoring/expression";
import { locusAddressMembers } from "./locus-address";
import type { LocalTabData } from "./local-locus-data";

const surfaceLibrary = loadFenelModule(await Bun.file(new URL("../../../../../fenel/modules/engine/surface-library.fenel", import.meta.url)).text(), "engine");
const registry = createRegistry([stdModule, pictureModule, viewModule, surfaceLibrary]);
const context = registry.evaluateContext();
const sourceViews = evaluate({ call: ["engine:surfaceBuiltinTypeViews"] }, {}, context) as any[];
const clipboardView = sourceViews.find(view => view.name === "clipboard-entry");
const clipboardEntity = registry.getIdentifiedEntity("ClipboardEntry")!;
const clipboardInstance = viewModule.instances!.find(instance => instance.typeName === "Viewable" && instance.args[0] === "ClipboardEntry")!;
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted(result: { $tag: string; _0: any }): LocalTabData {
  if (result.$tag !== "Ok") throw new Error(String(result._0));
  return result._0;
}
const initial = () => call<LocalTabData>("tabDataWithClipboard", call("defaultTabData", "tab", { kind: "grid" }));
function copy(state: LocalTabData, id: string, bytes = 100, data: unknown = id) {
  const transfer = encodeTransferItem({ value: data, typeName: "String", source: "fenel",
    typeCandidate: { type: { $ref: "String" }, identities: [{ path: "", reference: "String" }] } });
  return call("tabClipboardCopy", state, id, data, "String", transfer, bytes, 1234, "fenel: /demo");
}
const entries = (state: LocalTabData) => call<any[]>("tabClipboardEntries", state);
function edit(state: LocalTabData, command: unknown) {
  return call("applyTabDataCommands", state, state.revision, [command]);
}

describe("ordinary tab Clipboard", () => {
  test("the empty collection keeps its declared payload type and restores it on older retained occurrences", () => {
    const state = initial();
    const type = List(Anything);
    const root = call("tabDataRoot", state, type);
    expect(root.items[0].valueType).toEqual(type);
    expect(typePhrase(type, id => registry.getIdentifiedEntity(id)?.id ?? id)).toBe("A list of anything");
    const older = structuredClone(state);
    delete older.entries[0]!.value.valueType;
    const restored = call("tabDataRoot", older, type);
    expect(restored.items[0].valueType).toEqual(type);
    expect(restored.id).toBe(older.tabId);
    expect(restored.revision).toBe(older.revision);
    expect(entries(older)).toEqual(entries(state));
    expect(call<LocalTabData>("tabDataWithClipboard", older)).toEqual(older);
  });
  test("built-in collection is stable and keeps quoted data, original transfer type and provenance", () => {
    const empty = initial();
    expect(empty.entries).toHaveLength(1);
    expect(locusAddressMembers(call("tabDataRoot", empty, List(Anything)), { kind: "root" }).members[0]).toMatchObject({ name: "clipboard", aliases: ["Clipboard"] });
    expect(call<LocalTabData>("tabDataWithClipboard", empty)).toEqual(empty);
    const data = { call: ["never-evaluate-this"] };
    const next = accepted(copy(empty, "one", 500, data));
    const entry = entries(next)[0].value;
    expect(entry).toMatchObject({ $tag: "ClipboardEntry", id: "one", data, copiedAt: 1234, source: "fenel: /demo" });
    expect(decodeTransferItem(entry.transfer)).toMatchObject({ value: data, typeCandidate: { type: { $ref: "String" } } });
    const repeated = prepareTransferItem({ value: entry, typeName: "ClipboardEntry", source: "fenel" }, {} as AuthoringEnvironment, registry, context);
    expect(repeated).toMatchObject({ value: data, typeCandidate: { type: { $ref: "String" } } });
    expect(call<{ $tag: string }>("clipboardEntryTransfer", { data, transfer: entry.transfer })).toEqual({ $tag: "Nothing" });
    expect(prepareTransferItem({ value: "ordinary", typeName: "String", source: "fenel" }, {} as AuthoringEnvironment, registry, context).value).toBe("ordinary");
    expect(next.revision).toBe(1);
    expect(entries(empty)).toEqual([]);
  });

  test("count and byte limits evict oldest copies; a single large copy leaves history unchanged", () => {
    let state = initial();
    for (let index = 0; index < 23; index++) state = accepted(copy(state, String(index)));
    expect(entries(state).map(entry => entry.value.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 3)));
    state = accepted(copy(state, "large-a", 6 * 1024 * 1024));
    state = accepted(copy(state, "large-b", 6 * 1024 * 1024));
    expect(entries(state).map(entry => entry.value.id)).toEqual(["large-b"]);
    expect(copy(state, "too-large", 10485761)).toMatchObject({ $tag: "Err" });
    expect(entries(state).map(entry => entry.value.id)).toEqual(["large-b"]);
  });

  test("ordinary editor can remove or clear entries, but cannot remove collection or tamper with entry accounting", () => {
    const state = accepted(copy(accepted(copy(initial(), "one")), "two"));
    const id = call<string>("tabClipboardIdentity", state);
    expect(edit(state, { $tag: "TabEditRoot", command: { kind: "remove", itemId: id } }).$tag).toBe("Err");
    expect(edit(state, { $tag: "TabEditValues", commands: [{ $tag: "LocusRemove", id }] }).$tag).toBe("Err");
    const replacement = (list: unknown[]) => ({ $tag: "TabPatchValue", id, patch: { query: {
      kind: "expression", expr: { kind: "literal", value: { __list: list } },
    } } });
    const tampered = structuredClone(entries(state));
    tampered[0].value.bytes = -10000000;
    expect(edit(state, replacement(tampered)).$tag).toBe("Err");
    expect(edit(state, replacement([entries(state)[0], entries(state)[0]])).$tag).toBe("Err");
    expect(edit(state, replacement([{ kind: "call", fnId: "unexpected", args: [] }])).$tag).toBe("Err");
    const removed = accepted(edit(state, replacement(entries(state).slice(1))));
    expect(entries(removed)).toHaveLength(1);
    const cleared = accepted(edit(removed, replacement([])));
    expect(entries(cleared)).toEqual([]);
    expect(cleared.entries).toHaveLength(1);
    expect(entries(accepted(copy(cleared, "after-clear")))[0].value.id).toBe("after-clear");
    const canonical = expressionForTransfer({ value: [entries(state)[1].value], typeName: "List", source: "fenel" }, {} as AuthoringEnvironment);
    const ordinaryEdit = accepted(edit(state, { $tag: "TabPatchValue", id, patch: { query: { kind: "expression", expr: canonical } } }));
    expect(entries(ordinaryEdit).map(entry => entry.value.id)).toEqual(["two"]);
    const canonicalEmpty = expressionForTransfer({ value: [], typeName: "List", source: "fenel" }, {} as AuthoringEnvironment);
    expect(entries(accepted(edit(ordinaryEdit, { $tag: "TabPatchValue", id, patch: { query: { kind: "expression", expr: canonicalEmpty } } })))).toEqual([]);
  });
  test("source Viewable presents only copied data through the shared field layout", () => {
    expect(clipboardInstance.methods).toEqual({ defaultView: "clipboard-entry", defaultInlineView: "clipboard-entry" });
    const value = entries(accepted(copy(initial(), "one", 240, "Hello from Fenel")))[0].value;
    const fields = recordFieldsForType(clipboardEntity.type)!;
    const plan = surfaceLayoutRenderPlan({ layout: clipboardView.layout, fields, values: value, mode: "read" });
    const slots = plan.sections.flatMap(section => section.rows.flatMap(row => row.slots));
    expect(slots.map(slot => slot.fieldName)).toEqual(["data"]);
    expect(slots[0].value).toBe("Hello from Fenel");
    expect(slots[0].field).toBe(fields.find(field => field.name === "data"));
    expect(slots[0].fallbackKind).not.toBe("missing-field");
  });
});

if (process.env.FENEL_CLIPBOARD_CAPTURE === "1") {
  const before = call<LocalTabData>("defaultTabData", "tab", { kind: "grid" });
  const empty = initial();
  const filled = accepted(copy(empty, "copied-greeting", 240, "Hello from Fenel"));
  await Bun.write(new URL("../../../../../.tmp/clipboard-visuals/source-data.json", import.meta.url), JSON.stringify({
    before: call("tabDataRoot", before, List(Anything)), empty: call("tabDataRoot", empty, List(Anything)),
    after: call("tabDataRoot", filled, List(Anything)), value: entries(filled).map(entry => entry.value),
    presentation: { entities: [clipboardEntity], caseOwners: { ClipboardEntry: clipboardEntity.id },
      representations: [{ typeName: "Viewable", id: clipboardEntity.id, methods: clipboardInstance.methods }], templates: [clipboardView],
      plans: [{ template: "clipboard-entry", layout: clipboardView.layout, fields: recordFieldsForType(clipboardEntity.type)!, values: entries(filled)[0].value,
        plan: surfaceLayoutRenderPlan({ layout: clipboardView.layout, fields: recordFieldsForType(clipboardEntity.type)!, values: entries(filled)[0].value, mode: "read" }) }] },
  }, null, 2));
}

const holderText = await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text();
const holderCode = new Bun.Transpiler({ loader: "ts" }).transformSync(holderText.slice(
  holderText.indexOf("export function createBrowserDataSource("), holderText.indexOf("/** Local endpoint transport:")))
  .replace(/^export /gm, "").replace(/\bimport\(("[^"]+")\)/g, "load($1)");
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function holderFixture(options: { hold?: boolean; fail?: boolean } = {}) {
  let epoch = 0, preparationCount = 0, shouldFail = options.fail;
  const entered = deferred(), release = deferred();
  const publications: LocalTabData[] = [];
  const listeners: Array<() => void> = [];
  const bindings = {
    captureRegistryTransportObservation, runLocalOrdinaryOperation,
    bindCoreAuthoringOwner: () => {}, inheritCoreAuthoringOwner: () => {},
    spawnEarlyAuthoringRealm: () => {}, discardEarlyAuthoringRealm: () => {},
    createSignal: (initial: number) => { let value = initial; return [() => value, (next: number | ((current: number) => number)) => { value = typeof next === "function" ? next(value) : next; }]; },
    untrack: (read: () => number) => read(), sessionEpoch: () => epoch,
    assertCurrentSession: (expected: number) => { if (expected !== epoch) throw Error("Session changed"); },
    onBrowserSessionChange: (fn: () => void) => { listeners.push(fn); return () => {}; },
    planLocalDefinitionBundle: () => { throw Error("Unexpected definition plan"); },
    load: async (name: string) => {
      if (name === "@fenel/engine") return { invokeCallable: (ref: { $ref: string }, args: unknown[]) => call(ref.$ref.slice(5), ...args) };
      if (name === "@fenel/engine/type-foundation") return { List: () => ({ $ref: "List" }), Anything: {}, Ref: ($ref: string) => ({ $ref }) };
      if (name === "./workspace-model-loader") return { loadWorkspaceModel: async () => ({ workspaceCall: call }) };
      if (name === "./reader-presentation") return { representationsFromReaderSnapshot: () => [], createReaderPresentation: () => ({ presentation: () => undefined }) };
      if (name.endsWith("authoring-catalog-worker")) return { discardPreparedAuthoringWorker: () => {}, discardWarmAuthoringRealm: () => {} };
      throw Error(`Unexpected import ${name}`);
    },
  };
  const create = new Function(...Object.keys(bindings), `${holderCode}; return createBrowserDataSource;`)(...Object.values(bindings));
  const source = create({ id: "tab", clipboard: true, progressiveRead: true,
    ordinary: async (operation: Parameters<typeof runLocalOrdinaryOperation>[1], guard: { assertCurrent(): void }) => {
      guard.assertCurrent();
      return { kind: "prepared", value: runLocalOrdinaryOperation({ workspaceCall: call, allDataRootDescriptions: () => [] } as any, operation),
        assertCurrent: guard.assertCurrent, release: () => {} };
    }, onPublish: (state: LocalTabData) => publications.push(state),
    prepareSnapshot: async () => {
      preparationCount++; entered.resolve();
      if (options.hold) await release.promise;
      if (shouldFail) throw Error("Preparation failed");
      return { registry: {}, session: { evaluateContext: {} } };
    },
  });
  const retain = (id: string) => source.retainClipboard({ id, value: id, typeName: "String", transfer: "encoded", bytes: 100, copiedAt: 1, source: "fenel" });
  return { source, retain, entered: entered.promise, release: release.resolve, publications,
    count: () => preparationCount, recover: () => { shouldFail = false; },
    changeSession: () => { epoch++; listeners.forEach(fn => fn()); } };
}

describe("Clipboard holder preparation and session races", () => {
  test("copy before opening This tab retains in the same state without preparing any reader", async () => {
    const f = holderFixture();
    await f.retain("first");
    expect(f.count()).toBe(0);
    const retained = f.source.state();
    await f.source.ready();
    expect(f.source.state()).toBe(retained);
    expect(entries(f.source.state())[0].value.id).toBe("first");
    f.source.dispose();
  });
  test("copy racing reader preparation survives publication, then ordinary transactions use its revision", async () => {
    const f = holderFixture({ hold: true });
    const ready = f.source.ready();
    await f.entered;
    await f.retain("racing");
    const retained = f.source.state();
    f.release(); await ready;
    expect(f.source.state()).toBe(retained);
    await f.source.transact([{ $tag: "TabSetLayout", layout: { kind: "list" } }]);
    expect(f.source.state().revision).toBe(2);
    expect(entries(f.source.state())[0].value.id).toBe("racing");
    f.source.dispose();
  });
  test("a failed reader followed by Retry keeps copied data", async () => {
    const f = holderFixture({ fail: true });
    await f.retain("before-failure");
    await expect(f.source.ready()).rejects.toThrow("Preparation failed");
    await f.retain("after-failure");
    f.recover(); await f.source.ready();
    expect(entries(f.source.state()).map(entry => entry.value.id)).toEqual(["before-failure", "after-failure"]);
    f.source.dispose();
  });
  test("closed epoch refuses pending copy publication", async () => {
    const f = holderFixture();
    const pending = f.retain("expired");
    f.changeSession();
    await expect(pending).rejects.toThrow("Session changed");
    expect(f.publications).toEqual([]);
  });
});
