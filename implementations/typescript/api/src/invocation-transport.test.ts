// @ts-nocheck -- Execute the production route closures with isolated host IO leaves.
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { nativeJsonResponse, readNativeJson, NATIVE_JSON_HEADER } from "./native-json";

const source = await Bun.file(new URL("./routes/dashboard.ts", import.meta.url)).text();
function install(app, method, path, dependencies) {
  const begin = source.indexOf('dashboardRoutes.' + method + '("' + path + '"');
  expect(begin).toBeGreaterThan(-1);
  const end = source.indexOf("\n});", begin) + 4;
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(begin, end));
  const scope = { dashboardRoutes: app, getAccountId: () => "account", // rights R2a — the extracted route closures now read the minted authority
    // from the Hono context. These harnesses stub every IO leaf, so an opaque
    // handle is all the closure needs; the gate has its own pins.
    authorityOf: () => ({}), nativeJsonResponse, readNativeJson, ...dependencies };
  new Function("scope", "const {" + Object.keys(scope).join(",") + "} = scope; " + code)(scope);
}
const typeValue = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
const native = { bytes: Uint8Array.of(0, 255), type: typeValue, number: NaN, zero: -0, raw: { $fenelCheckpoint: ["number", "+infinity"] } };
function request(app, path, value, encoding = CHECKPOINT_VALUE_ENCODING) {
  return app.request(path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(encoding == null ? {} : { [NATIVE_JSON_HEADER]: encoding }) },
    body: JSON.stringify(encoding === CHECKPOINT_VALUE_ENCODING ? encodeCheckpointValue(value) : value),
  });
}
async function responseValue(response) {
  expect(response.status).toBe(200);
  expect(response.headers.get(NATIVE_JSON_HEADER)).toBe(CHECKPOINT_VALUE_ENCODING);
  return decodeCheckpointValue(await response.json(), response.headers.get(NATIVE_JSON_HEADER));
}
function harness(durable = false) {
  const app = new Hono();
  const fn = { id: "test:echo", params: [{ name: "value" }], returns: { $ref: "Any" } };
  const effects = [];
  let stored;
  install(app, "post", "/io/invoke", {
    getSystemRegistry: () => ({ getFunction: () => fn }),
    invokeIOActionAs: async (_account, _profile, action, params) => {
      if (action === "dashboard:decideInvoke") return durable ? { $tag: "DurableStart", dbFnId: "stored" }
        : params.mode === "stop" ? { $tag: "OneShotStop", action: "stop" } : { $tag: "OneShotRun", action: "echo" };
      if (action === "state:getFunctionInstance") return { $tag: "Just", _0: { status: "completed", variables: { _lastResult: stored } } };
      effects.push(structuredClone(params)); return params.value;
    },
    startFunctionInstance: async (_account, _function, _profile, _trigger, params) => { effects.push(structuredClone(params)); stored = params.value; return "run"; },
    prepareIOStop: (_registry, _fn, _action, args) => ({ params: { value: args[0] }, complete: () => ({ stopped: true }) }),
    IOStopContractError: class extends Error {},
  });
  return { app, effects, call: (value, mode = "run", encoding = CHECKPOINT_VALUE_ENCODING) => request(app, "/io/invoke", { fnId: fn.id, args: [value], mode }, encoding) };
}

test("one-shot, durable and Stop calls preserve native values and raw marker data", async () => {
  for (const [durable, mode] of [[false, "run"], [true, "run"], [false, "stop"]]) {
    const h = harness(durable);
    const result = await responseValue(await h.call(native, mode));
    expect(h.effects).toEqual([{ value: native }]);
    expect(result.value).toEqual(native);
    if (mode === "stop") expect(result.stopped).toBe(true);
    if (durable) expect(result.instanceId).toBe("run");
  }
});

test("legacy input never acquires marker semantics; unknown or malformed formats cannot execute", async () => {
  const h = harness();
  const raw = { $fenelCheckpoint: ["number", "+infinity"] };
  expect((await responseValue(await h.call(raw, "run", null))).value).toEqual(raw);
  expect(h.effects).toEqual([{ value: raw }]);
  expect((await h.call(raw, "run", "unknown")).status).toBe(400);
  const malformed = await h.app.request("/io/invoke", { method: "POST", headers: { [NATIVE_JSON_HEADER]: CHECKPOINT_VALUE_ENCODING, "Content-Type": "application/json" }, body: JSON.stringify({ fnId: "test:echo", args: [{ $fenelCheckpoint: ["uint8array", [256]] }] }) });
  expect(malformed.status).toBe(400);
  expect(h.effects).toHaveLength(1);
});

test("run, resume and instance-list arguments reach production IO closures intact", async () => {
  const app = new Hono(), effects = [];
  const dependencies = {
    getSystemRegistry: () => ({ getFunction: () => ({ params: [{ name: "value" }] }) }),
    FunctionStartUnavailable: class extends Error {},
    startFunctionInstanceByName: async (_a, _name, _profile, _trigger, payload) => { effects.push(payload); return "run"; },
    invokeIOActionAs: async (_a, _p, action, params) => {
      if (action === "state:findProfileById") return { $tag: "Just", _0: { id: "profile" } };
      if (action === "dashboard:resolveAwaiting") { effects.push(params.value); return { ok: true, value: params.value }; }
      if (action === "dashboard:listIoInstancesBase") return { runs: [], listAction: { $tag: "Just", _0: "list" } };
      effects.push(params.value); return [params.value];
    },
  };
  install(app, "post", "/functions/:name/run", dependencies);
  install(app, "post", "/io/awaiting/:instanceId/resolve", dependencies);
  install(app, "post", "/io/instances", dependencies);
  expect((await request(app, "/functions/echo/run", { profileId: "profile", payload: native })).status).toBe(201);
  expect((await responseValue(await request(app, "/io/awaiting/run/resolve", { value: native }))).value).toEqual(native);
  expect((await responseValue(await request(app, "/io/instances", { fnId: "echo", args: [native] }))).deployments).toEqual([native]);
  expect(effects).toEqual([native, native, native]);
});

test("instance rows, timelines, type activity, prompts and last results survive HTTP JSON", async () => {
  const cases = [
    ["/function-instances", "/function-instances", [native], "instances"],
    ["/functions/:id/instances", "/functions/fn/instances", [native], "instances"],
    ["/functions/:fnId/instances/:instId/timeline", "/functions/fn/instances/run/timeline", { $tag: "Just", _0: native }, null],
    ["/types/:typeName/activity", "/types/Bytes/activity", [native], "traces"],
    ["/io/awaiting", "/io/awaiting", [native], "awaiting"],
    ["/io/last-result", "/io/last-result?fnId=echo", { $tag: "Just", _0: native }, "instance"],
  ];
  for (const [route, path, result, key] of cases) {
    const app = new Hono();
    install(app, "get", route, { invokeIOActionAs: async () => result });
    const value = await responseValue(await app.request(path));
    expect(key ? value[key] : value).toEqual(Array.isArray(result) ? [native] : native);
  }
});

test("Home HTTP create/update/read keeps inline native expressions", async () => {
  const app = new Hono();
  let row = { id: "home", name: "Home", view: { kind: "canvas", items: [{ source: { kind: "expr", expr: { kind: "literal", value: native } } }] } };
  const dependencies = {
    toMaybe: value => value === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: value },
    invokeIOActionAs: async (_a, _p, action, params) => {
      if (action === "dashboard:createLocusViewBody") { row = { ...row, ...params }; return row; }
      if (action === "dashboard:updateLocusViewBody" && params.view.$tag === "Just") row = { ...row, view: params.view._0 };
      return action === "dashboard:listLocusViewsAll" ? [row] : { $tag: "Just", _0: row };
    },
  };
  for (const [method, path] of [["get", "/locus-views"], ["get", "/locus-views/active"], ["post", "/locus-views"], ["put", "/locus-views/:id"], ["post", "/locus-views/:id/activate"]]) install(app, method, path, dependencies);
  const created = await request(app, "/locus-views", { name: row.name, view: row.view });
  expect(created.status).toBe(201);
  expect(decodeCheckpointValue(await created.json(), created.headers.get(NATIVE_JSON_HEADER)).locusView.view.items[0].source.expr.value).toEqual(native);
  const next = { kind: "tree", items: row.view.items };
  const updated = await app.request("/locus-views/home", { method: "PUT", headers: { "Content-Type": "application/json", [NATIVE_JSON_HEADER]: CHECKPOINT_VALUE_ENCODING }, body: JSON.stringify(encodeCheckpointValue({ view: next })) });
  expect((await responseValue(updated)).locusView.view).toEqual(next);
  expect((await responseValue(await app.request("/locus-views"))).locusViews[0].view).toEqual(next);
  expect((await responseValue(await app.request("/locus-views/active"))).locusView.view).toEqual(next);
  expect((await responseValue(await request(app, "/locus-views/home/activate", {}))).locusView.view).toEqual(next);
});
