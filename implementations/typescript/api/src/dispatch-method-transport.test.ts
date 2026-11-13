// @ts-nocheck -- Real route closures with only IO/auth/context dependencies stubbed.
import { describe, expect, test } from "bun:test";
import { instanceFromJsonWire, instanceToJsonWire, INSTANCE_JSON_ENCODING, isInstanceJsonEncoding } from "@fenel/engine/authoring/type";
import { evaluate } from "@fenel/engine";
import { Nothing } from "@fenel/engine/type-foundation";
import { readNativeJson, NATIVE_JSON_HEADER } from "./native-json";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
const source = await Bun.file(new URL("./routes/dashboard.ts", import.meta.url)).text();
const take = (start, end) => { const index = source.indexOf(start); return source.slice(index, source.indexOf(end, index + start.length)); };
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
  take("function objectRecord(", "/** Classify") +
  take("function dispatchInstanceResponse(", "const FIELD_REPRESENTATIONAL_TYPES") +
  take("async function createDispatchInstanceRoute(", 'dashboardRoutes.get("/dispatch-instances"'),
);
const field = (name, type) => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const entries = {
  Reprable: { id: "Reprable", params: ["target", "a"], type: { $record: { fields: [field("native", { $type: true })] } } },
  RawUnion: { id: "RawUnion", type: { $record: { fields: [field("payload", { $union: [{ $ref: "Bytes" }, { $ref: "Any" }] })] } } },
  Callable: { id: "Callable", type: { $record: { fields: [field("run", { $arrow: { params: [], returns: { $ref: "Bytes" } } })] } } },
};
const registry = { getIdentifiedEntity: (name) => entries[name], getEntity: (name) => entries[name], getFieldRepresentation: () => undefined };

function harness() {
  const rows = new Map(); const events = [];
  let nextFailure;
  const invokeIOActionAs = async (_account, _profile, action, params) => {
    if (action === "dashboard:getSpecInstanceById") return rows.has(params.id) ? { $tag: "Just", _0: rows.get(params.id) } : { $tag: "Nothing" };
    events.push({ action, params: structuredClone(params) });
    if (nextFailure) { const failure = nextFailure; nextFailure = undefined; throw failure; }
    if (action === "dashboard:deleteAccountSpecInstance") { rows.delete(params.id); return null; }
    const prior = rows.get(params.id);
    const instance = { ...params.body.instance, typeName: params.body.typeName ?? prior.typeName, args: params.body.args ?? params.body.instance.args ?? prior.args };
    const row = { id: params.id ?? params.body.id ?? "row", typeName: instance.typeName, args: instance.args, instance };
    rows.set(row.id, row); return row;
  };
  const scope = {
    getAccountId: () => "account", // rights R2a — the extracted route closures now read the minted authority
    // from the Hono context. These harnesses stub every IO leaf, so an opaque
    // handle is all the closure needs; the gate has its own pins.
    authorityOf: () => ({}), getRuntimeAccountFieldRegistry: async () => registry,
    instanceFromJsonWire, instanceToJsonWire, INSTANCE_JSON_ENCODING, isInstanceJsonEncoding, invokeIOActionAs,
    invokeDataAction: invokeIOActionAs, readNativeJson,
    toMaybe: (value) => value === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: value },
    isFieldControlPlaneWrite: async () => false, isFieldControlPlaneWriteConflict: () => false,
    rejectFieldControlPlaneWrite: () => { throw new Error("unexpected field write"); },
    getInstanceById: async (_account, id) => { const row = rows.get(id); return row ? { entityType: row.typeName, data: row.instance } : null; },
  };
  const make = new Function("scope", `const { ${Object.keys(scope).join(",")} } = scope; ${code}; return { create: createDispatchInstanceRoute, update: updateDispatchInstanceRoute, delete: deleteDispatchInstanceRoute };`);
  const routes = make(scope);
  const ctx = (body, id = "row", encoding) => ({ req: { raw: { body: body === undefined ? null : {} }, json: async () => structuredClone(body), param: () => id, header: (name) => name === NATIVE_JSON_HEADER ? encoding : undefined }, json: (data, status = 200) => ({ status, data: JSON.parse(JSON.stringify(data)) }) });
  return { rows, events, rejectNext: (error) => { nextFailure = error; }, create: (body) => routes.create(ctx(body)), update: (body) => routes.update(ctx(body)), delete: (body, encoding) => routes.delete(ctx(body, "row", encoding)) };
}

describe("dedicated dispatch method wire boundaries", () => {
  test("create/update decode typed method input once and return encoded Type values", async () => {
    const h = harness();
    const type = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
    const raw = { typeName: "Reprable", args: ["JsRuntime", "T"], methods: { native: type } };
    const created = await h.create({ typeName: raw.typeName, args: raw.args, instance: instanceToJsonWire(raw, registry), valueEncoding: "fenel-instance-json-v1" });
    expect(created.status).toBe(201);
    expect(h.events[0].params.body.instance.methods.native.$refined.set.pattern.max).toBe(Infinity);
    expect(h.events[0].params.body.valueEncoding).toBeUndefined();
    expect(created.data.definition.valueEncoding).toBe(INSTANCE_JSON_ENCODING);
    expect(created.data.definition.instance.methods.native.$refined.set.pattern.max).toBe("unbounded");
    const updated = await h.update({ instance: instanceToJsonWire(raw, registry), valueEncoding: "fenel-instance-json-v1" });
    expect(updated.status).toBe(200);
    expect(h.events.at(-1).params.body.instance.methods.native).toEqual(type);
  });
  test("marker-shaped ordinary method data is not revived by a second decode", async () => {
    const h = harness();
    const payload = { $fenelUnion: { version: 1, branch: { $ref: "Bytes" }, value: [9, 8] } };
    const raw = { typeName: "RawUnion", args: [], methods: { payload } };
    const result = await h.create({ typeName: raw.typeName, args: [], instance: instanceToJsonWire(raw, registry), valueEncoding: "fenel-instance-json-v1" });
    expect(h.events[0].params.body.instance.methods.payload).toEqual(payload);
    expect(instanceFromJsonWire(result.data.definition.instance, registry, undefined, result.data.definition.valueEncoding).methods.payload).toEqual(payload);
  });
  test("v2 native closures cross create/update replies without double decoding captures or defaults", async () => {
    const h = harness();
    const captured = { bytes: Uint8Array.of(7, 255), limit: Infinity, business: { $fenelCheckpoint: ["number", "+infinity"] } };
    const closure = evaluate({ fn: [[], { var: ["missing", captured.bytes] }] }, { captured });
    const raw = { typeName: "Callable", args: [], methods: { run: closure } };
    const wire = instanceToJsonWire(raw, registry, undefined, INSTANCE_JSON_ENCODING);
    const created = await h.create({ typeName: raw.typeName, args: raw.args, instance: wire, valueEncoding: INSTANCE_JSON_ENCODING });
    expect(h.events[0].params.body.instance.methods.run).toEqual(closure);
    const reopened = instanceFromJsonWire(created.data.definition.instance, registry, undefined, created.data.definition.valueEncoding);
    expect(reopened.methods.run).toEqual(closure);
    expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened.methods.run })).toEqual(captured.bytes);
    const updated = await h.update({ instance: wire, valueEncoding: INSTANCE_JSON_ENCODING });
    expect(instanceFromJsonWire(updated.data.definition.instance, registry, undefined, updated.data.definition.valueEncoding).methods.run).toEqual(closure);
  });
  test("unknown method formats and missing update targets fail explicitly", async () => {
    const h = harness();
    expect((await h.create({ typeName: "Reprable", args: [], instance: { methods: {} }, valueEncoding: "wrong" })).status).toBe(422);
    expect(h.events).toEqual([]);
    expect((await h.update({ instance: { methods: {} } })).status).toBe(404);
  });
  test("draft creation forwards its stable identity and updates decode the original instance independently", async () => {
    const h = harness();
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const original = { typeName: "Reprable", args: ["JsRuntime", "Before"], methods: { native: { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } } } };
    const created = await h.create({ id, typeName: original.typeName, args: original.args, instance: instanceToJsonWire(original, registry), valueEncoding: INSTANCE_JSON_ENCODING });
    expect(created.data.definition.id).toBe(id);
    expect(h.events[0].params.body.id).toBe(id);
    // This harness addresses row; use the returned original baseline even
    // when the newly edited argument now refers to a different type.
    h.rows.set("row", h.rows.get(id));
    const edited = { ...original, args: ["JsRuntime", "After"] };
    const result = await h.update({ instance: instanceToJsonWire(edited, registry), expectedInstance: instanceToJsonWire(original, registry), valueEncoding: INSTANCE_JSON_ENCODING });
    expect(result.status).toBe(200);
    expect(h.events.at(-1).params.body.instance.args).toEqual(edited.args);
    expect(h.events.at(-1).params.body.expectedInstance).toEqual(original);
    expect(h.events.at(-1).params.body.expectedInstance.methods.native.$refined.set.pattern.max).toBe(Infinity);
  });
  test("stale updates and deletes return the shared persistence diagnostic", async () => {
    const h = harness();
    const original = { typeName: "Reprable", args: [], methods: {} };
    h.rows.set("row", { id: "row", ...original, instance: original });
    const conflict = () => Object.assign(new Error("Data changed since this draft was opened"), { name: "DispatchInstancePersistenceConflict" });
    h.rejectNext(conflict());
    const update = await h.update({ instance: original, expectedInstance: original });
    expect(update.status).toBe(409);
    expect(update.data.diagnostic.$tag).toBe("PersistenceConflict");
    h.rejectNext(conflict());
    const deleted = await h.delete({ expectedInstance: original });
    expect(deleted.status).toBe(409);
    expect(deleted.data.diagnostic.$tag).toBe("PersistenceConflict");
    expect(h.events.at(-1).params.expectedInstance).toEqual({ $tag: "Just", _0: original });
    h.rows.clear();
    expect((await h.update({ instance: original, expectedInstance: original })).status).toBe(409);
  });
  test("native delete baselines retain atoms and literal markers, while omitted baselines remain compatible", async () => {
    const h = harness();
    const original = { typeName: "Callable", args: [], methods: { run: { captured: { bytes: Uint8Array.of(2, 255), limit: Infinity, zero: -0, literal: { $fenelCheckpoint: ["number", "+infinity"] } } } } };
    const result = await h.delete(encodeCheckpointValue({ expectedInstance: original }), CHECKPOINT_VALUE_ENCODING);
    expect(result.status).toBe(200);
    expect(h.events.at(-1).params.expectedInstance).toEqual({ $tag: "Just", _0: original });
    expect((await h.delete()).status).toBe(200);
    expect(h.events.at(-1).params.expectedInstance).toEqual({ $tag: "Nothing" });
    expect((await h.delete({ expectedInstance: [] })).status).toBe(422);
    expect((await h.update({ instance: { methods: {} }, expectedInstance: [] })).status).toBe(422);
  });
});
