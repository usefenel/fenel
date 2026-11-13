// C1/C2: real source admission/CAS and the existing host-value codec. No native
// replacement or browser storage implementation participates in these checks.
import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../../../../implementations/typescript/engine/src/registry";
import { evaluate } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdModule } from "../../../../../implementations/typescript/engine/src/modules/std";
import { viewModule } from "../../../../../implementations/typescript/engine/src/modules/view";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "../../../../../implementations/typescript/engine/src/checkpoint-json";

const registry = createRegistry([stdModule, viewModule]);
const context = registry.evaluateContext();
const sourceId = "fenel-browser-local";
const absent = { $tag: "Nothing" };
const present = (value: unknown) => ({ $tag: "Just", _0: value });
type Verdict<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted<T>(result: Verdict<T>): T {
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}
const emptyState = () => call("defaultTabData", sourceId, { kind: "grid" });
const recordFor = (data = emptyState(), generation = 1) => ({ schema: "fenel.local-data.v1", generation, data });
const read = (record: unknown) => call<Verdict<any>>("browserDataStoredState", sourceId, present(record));
const save = (record: unknown, expected: unknown, state = emptyState()) =>
  call<Verdict<any>>("browserDataStoragePlan", sourceId, record, expected, state);
const valueRow = (id: string, value: unknown) => ({ id, value: { id, slug: id,
  query: { kind: "expression", expr: { kind: "literal", value } } } });

describe("Fenel browser data storage policy", () => {
  test("untrusted storage decoding does not promise an arbitrary result type", () => {
    expect(registry.getFunctionScheme("view:browserDataStoredState")?.quantified).toEqual([]);
    const decorated = { ...emptyState(), reader: "discarded reader", rootProjection: "discarded projection" };
    const restored = accepted(read(recordFor(decorated)))._0;
    expect(Object.keys(restored).sort()).toEqual(["definitions", "entries", "layout", "representations", "revision", "tabId", "values"]);
  });

  test("generation extraction honours its Maybe Number result for untrusted inputs", () => {
    expect(call<unknown>("browserDataStorageGeneration", absent)).toEqual(absent);
    for (const value of [null, false, "record", [], {}, { generation: "1" }, { generation: NaN }, { generation: Infinity }, { generation: 0 }]) {
      expect(call<unknown>("browserDataStorageGeneration", present(value))).toEqual(absent);
    }
    expect(call<unknown>("browserDataStorageGeneration", present({ generation: 1 }))).toEqual(present(1));
  });

  test("absent storage stays absent and the first write projects exactly authored state", () => {
    expect(call<Verdict<typeof absent>>("browserDataStoredState", sourceId, absent)).toEqual({ $tag: "Ok", _0: absent });
    expect(call<typeof absent>("browserDataStorageGeneration", absent)).toEqual(absent);
    const state = { ...emptyState(), rootProjection: { retained: "reader" }, expressionHeads: { placeAll: "temporary" },
      expressionValueIds: ["temporary"], _authority: { forged: true }, registry: { fake: true } };
    const saved = accepted(save(absent, absent, state));
    expect(saved.schema).toBe("fenel.local-data.v1");
    expect(saved.generation).toBe(1);
    expect(Object.keys(saved.data).sort()).toEqual(["definitions", "entries", "layout", "representations", "revision", "tabId", "values"]);
    expect(saved.data.tabId).toBe(sourceId);
    expect(accepted(read(saved))).toEqual(present(saved.data));
    expect(call<ReturnType<typeof present>>("browserDataStorageGeneration", present(saved))).toEqual(present(1));
  });

  test("durable generations are independent of draft revision and reject both stale writers and absent mismatches", () => {
    const first = accepted(save(absent, absent, { ...emptyState(), revision: 40 }));
    const second = accepted(save(present(first), present(1), { ...emptyState(), revision: 3 }));
    expect(second.generation).toBe(2);
    expect(second.data.revision).toBe(3);
    expect(save(present(second), present(1))).toMatchObject({ $tag: "Err" });
    expect(save(present(second), absent)).toMatchObject({ $tag: "Err" });
    expect(save(absent, present(1))).toMatchObject({ $tag: "Err" });
    expect(save(present(first), present("1"))).toMatchObject({ $tag: "Err" });
    expect(save(present(first), present(NaN))).toMatchObject({ $tag: "Err" });
    expect(first.data.revision).toBe(40);
    expect(first.generation).toBe(1);
  });

  test("generation exhaustion cannot overwrite or round the saved counter", () => {
    const last = recordFor(emptyState(), Number.MAX_SAFE_INTEGER);
    expect(read(last).$tag).toBe("Ok");
    expect(save(present(last), present(Number.MAX_SAFE_INTEGER))).toMatchObject({ $tag: "Err" });
    expect(last.generation).toBe(Number.MAX_SAFE_INTEGER);
    const beforeLast = recordFor(emptyState(), Number.MAX_SAFE_INTEGER - 1);
    expect(accepted(save(present(beforeLast), present(Number.MAX_SAFE_INTEGER - 1))).generation).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("Discard advances reader revision even when the saved and draft revisions coincide", () => {
    const current = { ...emptyState(), revision: 6, values: [valueRow("datum", "unsaved draft")] };
    const disk = { ...emptyState(), revision: 6, values: [valueRow("datum", "saved in another tab")] };
    const restored = accepted(call<Verdict<any>>("browserDataRestoreSnapshot", current, disk));
    expect(restored.revision).toBe(7);
    expect(restored.values[0].value.query.expr.value).toBe("saved in another tab");
    const commands = [{ $tag: "TabPatchValue", id: "datum", patch: { query: { kind: "expression", expr: { kind: "literal", value: "late edit" } } } }];
    expect(call("applyTabDataCommands", restored, 6, commands)).toMatchObject({ $tag: "Err" });
    expect(accepted(call<Verdict<any>>("applyTabDataCommands", restored, 7, commands)).revision).toBe(8);
    expect(disk.revision).toBe(6);
    expect(call("browserDataRestoreSnapshot", { ...current, revision: Number.MAX_SAFE_INTEGER }, disk)).toMatchObject({ $tag: "Err" });
    expect(call("browserDataRestoreSnapshot", current, { ...disk, tabId: "foreign" })).toMatchObject({ $tag: "Err" });
  });

  test("Discard recovers an unsavable draft while requiring its source identity and safe reader revision", () => {
    const damaged = { ...emptyState(), revision: 9, definitions: null, values: [null] };
    expect(save(absent, absent, damaged).$tag).toBe("Err");
    const restored = accepted(call<Verdict<any>>("browserDataRestoreSnapshot", damaged, emptyState()));
    expect(restored.revision).toBe(10);
    expect(restored.definitions).toEqual(emptyState().definitions);
    expect(restored.values).toEqual([]);
    expect(call("applyTabDataCommands", restored, 9, []).$tag).toBe("Err");
    expect(call("browserDataRestoreSnapshot", { ...damaged, revision: "9" }, emptyState())).toMatchObject({ $tag: "Err" });
    expect(call("browserDataRestoreSnapshot", { ...damaged, tabId: "" }, emptyState())).toMatchObject({ $tag: "Err" });
  });

  test("type and function definitions, fields, facets and ordinary representation instances retain their complete source wire", () => {
    const typeId = "dc3c62d2-33e9-4daf-8152-bc4080454dd7";
    const functionId = "cab5b305-906e-41a7-a6c1-96c6d0d3a521";
    const fieldId = "ee783858-9480-4b68-aefd-afdf22f7c2a8";
    const numberType = { $ref: "Number" };
    const parameter = { name: "amount", fieldId, type: numberType, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} };
    const definitions = {
      owners: [
        { kind: "type", ownerKey: "type:Payment", storageName: "Payment", storageId: typeId,
          definition: { id: typeId, type: { $record: { fields: [parameter] } } } },
        { kind: "function", ownerKey: "function:double", storageName: "double", storageId: functionId,
          definition: { id: functionId, params: [parameter], returns: numberType,
            body: { call: ["cannot-run-during-storage", { var: "amount" }] }, signatureIntent: { kind: "explicit" } } },
      ],
      fields: [{ id: fieldId, currentCodeName: "amount", status: "live", realm: "account", reuseVisibility: "account" }],
      facets: [{ rowId: "d1a1e410-f92d-4134-9652-08b79d350833", fieldId, typeName: "Iconable", methods: { icon: "coins" }, scope: "account", priority: 10 }],
    };
    const instance = { typeName: "Iconable", args: [typeId], methods: { icon: "coins" }, scope: "global", priority: 5 };
    const state = { ...emptyState(), definitions,
      representations: [{ id: "representation", value: { id: "representation", typeName: instance.typeName, args: instance.args, instance } }] };
    const saved = accepted(save(absent, absent, state));
    const restored = accepted(read(saved))._0;
    expect(restored.definitions).toEqual(definitions);
    expect(restored.representations[0].value.instance).toEqual(instance);
    expect(restored.definitions.owners[1].definition.body.call[0]).toBe("cannot-run-during-storage");
    expect(saved.data.definitions.owners[0].definition.type.$record.fields[0].fieldId).toBe(fieldId);
  });

  test("unknown versions, missing data and nonnumeric or unsafe counters refuse before any write plan", () => {
    const records = [null, undefined, false, "record", [], {}, { schema: "future", generation: 1, data: emptyState() },
      { ...recordFor(), data: undefined }, ...[0, -1, 1.5, "1", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(generation => ({ ...recordFor(), generation }))];
    for (const record of records) {
      expect(read(record).$tag).toBe("Err");
      expect(save(present(record), absent).$tag).toBe("Err");
    }
  });

  test("malformed snapshot lists and definition headers are refused without using empty-list fallbacks", () => {
    const state = emptyState();
    const definitions = state.definitions;
    const damaged = [null, [], { ...state, tabId: "another-source" }, { ...state, revision: "0" },
      { ...state, entries: {} }, { ...state, values: null }, { ...state, representations: "[]" },
      { ...state, layout: [] }, { ...state, definitions: null },
      { ...state, definitions: { ...definitions, owners: {} } },
      { ...state, definitions: { ...definitions, fields: undefined } },
      { ...state, definitions: { ...definitions, facets: 0 } },
      { ...state, definitions: { ...definitions, owners: [null] } },
      { ...state, definitions: { ...definitions, owners: [{ kind: "type", ownerKey: "type:T", storageName: "T", definition: { id: 42 } }] } },
      { ...state, definitions: { ...definitions, owners: [{ kind: "type", ownerKey: "type:T", storageName: "T", definition: { id: "type-id", type: null } }] } },
      { ...state, definitions: { ...definitions, owners: [{ kind: "function", ownerKey: "function:f", storageName: "f", definition: { id: "fn-id", params: null, returns: { $ref: "Number" } } }] } },
      { ...state, definitions: { ...definitions, fields: [{ id: "field", currentCodeName: "x", status: "live", realm: "unknown", reuseVisibility: "owner" }] } },
      { ...state, definitions: { ...definitions, facets: [{ fieldId: "field", typeName: "Iconable", methods: {}, scope: "account", priority: "10" }] } },
      { ...state, entries: [null] }, { ...state, entries: [{ id: "one", value: { id: "two" } }] },
      { ...state, entries: [{ id: "one", value: { id: "one" } }] },
      { ...state, entries: [{ id: "one", value: { id: "one", source: { kind: "expr", expr: { kind: "call", fnId: "not-run", args: {} } } } }] },
      { ...state, entries: [{ id: "one", value: { id: "one", source: { kind: "expr", expr: { kind: "literal", value: 1 } }, children: {} } }] },
      { ...state, values: [{ id: "one", value: { id: "one", query: { kind: "expression", expr: { kind: "call", fnId: "not-run", args: {} } } } }] },
      { ...state, representations: [{ id: "one", value: { id: "one", typeName: "Iconable", args: [], instance: null } }] },
      { ...state, values: [valueRow("same", 1), valueRow("same", 2)] }];
    for (const data of damaged) {
      expect(read(recordFor(data)).$tag).toBe("Err");
      expect(save(absent, absent, data).$tag).toBe("Err");
    }
  });

  test("source calls and quoted executable-looking data remain inert through storage and codec roundtrip", () => {
    const literal = Object.defineProperty({ call: ["never-evaluate", 7], $fenelCheckpoint: ["ordinary-data", "literal"],
      bytes: new Uint8Array([0, 128, 255]), negativeZero: -0, notANumber: NaN, infinity: Infinity }, "__proto__",
      { value: { ordinary: true }, enumerable: true, writable: true, configurable: true });
    const state = { ...emptyState(), values: [valueRow("quoted", literal), { id: "call", value: { id: "call", slug: "call",
      query: { kind: "expression", expr: { kind: "call", fnId: "unknown-cannot-run", args: [{ kind: "literal", value: 3 }] } } } }] };
    const saved = accepted(save(absent, absent, state));
    const physical = JSON.parse(JSON.stringify(encodeCheckpointValue(saved)));
    const decoded = decodeCheckpointValue(physical, CHECKPOINT_VALUE_ENCODING);
    const restored = accepted(read(decoded))._0;
    const payload = restored.values[0].value.query.expr.value;
    expect(payload.bytes).toEqual(new Uint8Array([0, 128, 255]));
    expect(Object.is(payload.negativeZero, -0)).toBe(true);
    expect(Number.isNaN(payload.notANumber)).toBe(true);
    expect(payload.infinity).toBe(Infinity);
    expect(Object.getOwnPropertyDescriptor(payload, "__proto__")?.value).toEqual({ ordinary: true });
    expect(payload.$fenelCheckpoint).toEqual(["ordinary-data", "literal"]);
    expect(restored.values[1].value.query.expr.fnId).toBe("unknown-cannot-run");
  });

  test("all structural ExprNode markers and self references are retained without evaluating or expanding them", () => {
    const markers = ["__do", "__let", "__match", "__construct", "__record", "__lambda", "__list", "__where", "__cat", "__pipe", "__apply", "__var", "__withInstance"];
    const values = markers.map((marker, index) => valueRow(`marker-${index}`, { [marker]: { ordinarySource: marker } }));
    values.push({ id: "self", value: { id: "self", slug: "self", query: { kind: "expression", expr: { kind: "ref", savedExprId: "self" } } } } as any);
    const entries = values.map(row => ({ id: `item-${row.id}`, value: { id: `item-${row.id}`, source: { kind: "expr", expr: row.value.query.expr } } }));
    const saved = accepted(save(absent, absent, { ...emptyState(), values, entries }));
    expect(accepted(read(saved))._0.values).toEqual(values);
    expect(accepted(read(saved))._0.entries).toEqual(entries);
    for (const [index, marker] of markers.entries()) {
      expect(Object.keys(saved.data.values[index].value.query.expr.value)).toEqual([marker]);
    }
    expect(saved.data.values.at(-1).value.query.expr.savedExprId).toBe("self");
  });

  test("Clipboard uses the same snapshot and refuses orphaned or malformed retained entries", () => {
    const empty = call("tabDataWithClipboard", emptyState());
    const copied = accepted(call<Verdict<any>>("tabClipboardCopy", empty, "copy", new Uint8Array([1, 2]), "Bytes", "retained-transfer", 24, 1234, "copy: /~local"));
    const saved = accepted(save(absent, absent, copied));
    const restored = accepted(read(saved))._0;
    const copies = call("tabClipboardEntries", restored);
    expect(copies).toHaveLength(1);
    expect(copies[0].value.data).toEqual(new Uint8Array([1, 2]));
    expect(copies[0].value.transfer).toBe("retained-transfer");
    const brokenRows = copied.values.map((entry: any) => ({ ...entry, value: { ...entry.value,
      query: { kind: "expression", expr: { kind: "literal", value: { __list: [{ kind: "literal", value: { ...copies[0].value, bytes: "24" } }] } } } } }));
    expect(read(recordFor({ ...copied, values: [] })).$tag).toBe("Err");
    expect(read(recordFor({ ...copied, entries: [] })).$tag).toBe("Err");
    expect(read(recordFor({ ...copied, values: brokenRows })).$tag).toBe("Err");
  });

  test("Discard restores the complete saved Clipboard after the draft cleared its entries", () => {
    const empty = call("tabDataWithClipboard", emptyState());
    const disk = accepted(call<Verdict<any>>("tabClipboardCopy", empty, "copy", "saved copy", "String", "original-transfer", 24, 1234, "copy"));
    const identity = call("tabClipboardIdentity", disk);
    const current = accepted(call<Verdict<any>>("applyTabDataCommands", disk, disk.revision, [{ $tag: "TabPatchValue", id: identity,
      patch: { query: { kind: "expression", expr: { kind: "literal", value: { __list: [] } } } } }]));
    expect(call<unknown[]>("tabClipboardEntries", current)).toEqual([]);
    const restored = accepted(call<Verdict<any>>("browserDataRestoreSnapshot", current, disk));
    expect(restored.revision).toBe(current.revision + 1);
    expect(call("tabClipboardEntries", restored)).toHaveLength(1);
    expect(call("tabClipboardEntries", restored)[0].value.transfer).toBe("original-transfer");
    expect(call("browserDataRestoreSnapshot", current, { ...disk, values: [] })).toMatchObject({ $tag: "Err" });
  });
});
