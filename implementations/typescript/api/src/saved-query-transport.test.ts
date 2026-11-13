import { expect, test } from "bun:test";
import { Hono } from "hono";
import { nativeJsonResponse, readNativeJson, NATIVE_JSON_HEADER } from "./native-json";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";

// Execute the actual saved-query route closures. IO and metadata validation are
// isolated so this transport regression does not build the entire app registry.
const source = await Bun.file(new URL("./routes/dashboard.ts", import.meta.url)).text();
const start = source.indexOf("// ---- Saved Queries ----");
const end = source.indexOf("// ---- Home Views", start);
if (start < 0 || end < start) throw new Error("Missing saved-query route block");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const pattern = { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } };
const query = { entity: "profile", filter: { name: pattern }, data: Uint8Array.of(0, 255), raw: { $fenelCheckpoint: ["number", "+infinity"] } };

function fixture() {
  let row: Record<string, any> | undefined;
  const validation: Record<string, unknown>[] = [];
  const calls: { action: string; params: Record<string, any> }[] = [];
  const app = new Hono();
  const scope = {
    dashboardRoutes: app, nativeJsonResponse, readNativeJson, getAccountId: () => "account", // rights R2a — the extracted route closures now read the minted authority
    // from the Hono context. These harnesses stub every IO leaf, so an opaque
    // handle is all the closure needs; the gate has its own pins.
    authorityOf: () => ({}),
    validateBody: async (_account: string, _c: unknown, _name: string, body: Record<string, unknown>) => { validation.push(body); return { ...body, query: { mustNotReplaceRawQuery: true } }; },
    invokeIOActionAs: async (_account: string, _profile: unknown, action: string, params: Record<string, any>) => {
      calls.push({ action, params });
      if (action === "std:isUuid") return typeof params.text === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.text);
      if (action === "dashboard:createSavedQueryBody") return row = { id: "saved", ...params.data };
      if (action === "dashboard:updateSavedQueryBody") {
        if (!row) return { $tag: "Nothing" };
        if (params.expectedQuery?.$tag === "Just" && !Bun.deepEquals(encodeCheckpointValue(row.query), encodeCheckpointValue(params.expectedQuery._0))) return { $tag: "Nothing" };
        for (const key of ["name", "slug", "description", "query"]) if (params[key].$tag === "Just") row[key] = params[key]._0;
        return { $tag: "Just", _0: row };
      }
      if (action === "dashboard:listSavedQueriesAggregated") return { queries: row ? [row] : [], categories: [] };
      if (action === "dashboard:getSavedQueryById") return row ? { $tag: "Just", _0: row } : { $tag: "Nothing" };
      if (action === "dashboard:deleteSavedQueryBody") {
        if (!row || (params.expectedQuery?.$tag === "Just" && !Bun.deepEquals(encodeCheckpointValue(row.query), encodeCheckpointValue(params.expectedQuery._0)))) return false;
        row = undefined;
        return true;
      }
      return false;
    },
  };
  const actions = { ...scope, invokeDataAction: scope.invokeIOActionAs };
  new Function(...Object.keys(actions), code)(...Object.values(actions));
  const send = (value: unknown, method = "POST", encoding: string | null = CHECKPOINT_VALUE_ENCODING) => app.request(new Request(`http://test/saved-queries${method === "PUT" || method === "DELETE" ? "/saved" : ""}`, {
    method, headers: { "Content-Type": "application/json", ...(encoding === null ? {} : { [NATIVE_JSON_HEADER]: encoding }) },
    body: JSON.stringify(encoding === CHECKPOINT_VALUE_ENCODING ? encodeCheckpointValue(value) : value),
  }));
  return { app, send, calls, validation };
}
const read = async (response: Response) => decodeCheckpointValue(await response.json(), response.headers.get(NATIVE_JSON_HEADER)) as any;

test("saved-query POST/PUT/GET retain native body data and never coerce it through the empty-record placeholder", async () => {
  const h = fixture();
  const created = await h.send({ name: "Native", slug: "native", query });
  expect(created.status).toBe(201);
  expect(created.headers.get(NATIVE_JSON_HEADER)).toBe(CHECKPOINT_VALUE_ENCODING);
  expect((await read(created)).query.query).toEqual(query);
  expect(h.validation[0]).not.toHaveProperty("query");
  expect(h.calls[0]!.params.data.query).toEqual(query);
  expect((await read(await h.send({ name: "Renamed" }, "PUT"))).query.query).toEqual(query);
  expect(h.calls.at(-1)!.params.query).toEqual({ $tag: "Nothing" });
  const next = { ...query, filter: { name: { $tag: "SeEnum", values: ["next"] } } };
  expect((await read(await h.send({ query: next }, "PUT"))).query.query).toEqual(next);
  expect((await read(await h.app.request("http://test/saved-queries"))).queries[0].query).toEqual(next);
  expect((await read(await h.app.request("http://test/saved-queries/saved"))).query.query).toEqual(next);
});

test("legacy marker-shaped query data stays literal and invalid native versions/null query values reject before writes", async () => {
  const h = fixture();
  const legacy = { name: "Legacy", slug: "legacy", query: { literal: query.raw } };
  expect((await read(await h.send(legacy, "POST", null))).query.query).toEqual(legacy.query);
  const before = h.calls.length;
  expect((await h.send(legacy, "POST", "unknown-v99")).status).toBe(400);
  for (const value of [null, [], Uint8Array.of(1)]) {
    expect((await h.send({ name: "Bad", slug: "bad", query: value })).status).toBe(422);
    expect((await h.send({ query: value }, "PUT")).status).toBe(422);
  }
  expect(h.calls.length).toBe(before);
});

test("saved-query routes preserve opening baselines and refuse stale edit/delete", async () => {
  const h = fixture();
  expect((await h.send({ slug: "native", query })).status).toBe(201);
  const next = { ...query, data: Uint8Array.of(2, 3) };
  expect((await h.send({ query: next, expectedQuery: query }, "PUT")).status).toBe(200);
  expect(h.calls.at(-1)!.params.expectedQuery).toEqual({ $tag: "Just", _0: query });
  expect(h.validation.at(-1)).not.toHaveProperty("expectedQuery");
  expect((await h.send({ query, expectedQuery: query }, "PUT")).status).toBe(409);
  expect((await read(await h.app.request("http://test/saved-queries/saved"))).query.query).toEqual(next);
  expect((await h.send({ expectedQuery: query }, "DELETE")).status).toBe(409);
  expect((await h.send({ expectedQuery: next }, "DELETE")).status).toBe(200);
  expect((await h.send({ query, expectedQuery: next }, "PUT")).status).toBe(409);
});

test("saved-query creates retain an optional UUID and reject malformed baselines", async () => {
  const h = fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  expect((await read(await h.send({ id, slug: "native", query }))).query.id).toBe(id);
  expect(h.calls.at(-1)!.params.data.id).toBe(id);
  const before = h.calls.length;
  expect((await h.send({ id: "invalid", slug: "native", query })).status).toBe(422);
  expect(h.calls.slice(before).every((call) => call.action === "std:isUuid")).toBe(true);
  for (const expectedQuery of [null, [], Uint8Array.of(1)]) {
    expect((await h.send({ query, expectedQuery }, "PUT")).status).toBe(422);
    expect((await h.send({ expectedQuery }, "DELETE")).status).toBe(422);
  }
});
