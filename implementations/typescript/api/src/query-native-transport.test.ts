import { expect, test } from "bun:test";
import { createQueryRoutes } from "./routes/query";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import type { EntityQuery, FenelType, QueryResult } from "@fenel/engine";
import { NATIVE_JSON_HEADER } from "./native-json";

const pattern = { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } as const;
const type: FenelType = { $refined: { base: { $ref: "String" }, set: pattern } };
const raw = { $fenelCheckpoint: ["number", "+infinity"] };
const payload = { bytes: Uint8Array.of(0, 255), buffer: Uint8Array.of(1, 2).buffer, type, infinity: Infinity, nan: NaN, negativeZero: -0, raw };
const request = (path: string, value: unknown, encoding: string | null = CHECKPOINT_VALUE_ENCODING) => new Request(`http://test${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(encoding === null ? {} : { [NATIVE_JSON_HEADER]: encoding }) },
  body: JSON.stringify(encoding === CHECKPOINT_VALUE_ENCODING ? encodeCheckpointValue(value) : value),
});
const read = async (response: Response) => decodeCheckpointValue(await response.json(), response.headers.get(NATIVE_JSON_HEADER)) as any;

test("query, comparison, funnel and schema use the native header at their real HTTP boundaries", async () => {
  const calls: { account: string; query: unknown }[] = [];
  const result = (query: EntityQuery): QueryResult => ({ rows: [{ payload }], total: 1, meta: { entity: query.entity, query, executionMs: 1 } });
  const app = createQueryRoutes({ account: () => "account", entities: () => ["profile"], isEntity: (name) => name === "profile",
    fields: () => [{ name: "name", type }], relations: () => ({}),
    execute: async (account, query) => { calls.push({ account, query }); return result(query); },
    compare: async (account, current, previous) => { calls.push({ account, query: { current, previous } }); return { current: result(current), previous: result(previous), diff: [{ payload }] }; },
    funnel: async (account, query) => { calls.push({ account, query }); return { steps: [{ name: "First", count: 1, rate: null }], overall: 1 }; },
  });
  const query = { entity: "profile", filter: { name: pattern } } as EntityQuery;
  const response = await app.request(request("/", query));
  expect(response.status).toBe(200);
  expect(response.headers.get(NATIVE_JSON_HEADER)).toBe(CHECKPOINT_VALUE_ENCODING);
  expect(calls[0]).toEqual({ account: "account", query });
  expect((await read(response)).rows[0].payload).toEqual(payload);
  const compare = await read(await app.request(request("/compare", { current: query, previous: query })));
  expect(compare.current.rows[0].payload).toEqual(payload);
  expect(compare.diff[0].payload).toEqual(payload);
  const funnel = { steps: [{ name: "First", entity: "profile", filter: { name: pattern } }] };
  expect((await app.request(request("/funnel", funnel))).status).toBe(200);
  expect(calls.at(-1)).toEqual({ account: "account", query: funnel });
  expect((await read(await app.request("http://test/schema"))).entities.profile.fields[0].type).toEqual(type);
  expect((await read(await app.request("http://test/schema/profile"))).fields[0].type).toEqual(type);
});

test("legacy marker values remain data; malformed versions, null roots and bad native atoms fail before execution", async () => {
  const calls: unknown[] = [];
  const app = createQueryRoutes({ account: () => "account", entities: () => ["profile"], isEntity: (name) => name === "profile",
    execute: async (_account, query) => { calls.push(query); return { rows: [], meta: { entity: query.entity, query, executionMs: 0 } }; },
  });
  const legacy = { entity: "profile", filter: { name: { $tag: "SeEnum", values: [raw] } } };
  expect((await app.request(request("/", legacy, null))).status).toBe(200);
  expect(calls[0]).toEqual(legacy);
  const before = calls.length;
  expect((await app.request(request("/", legacy, "unknown-v99"))).status).toBe(400);
  const malformed = await app.request(new Request("http://test/", { method: "POST", headers: { "Content-Type": "application/json", [NATIVE_JSON_HEADER]: CHECKPOINT_VALUE_ENCODING }, body: JSON.stringify({ $fenelCheckpoint: ["unknown", 1] }) }));
  expect(malformed.status).toBe(400);
  expect(await malformed.text()).toContain("Unknown checkpoint atom");
  expect((await app.request(request("/", null))).status).toBe(400);
  expect((await app.request(request("/funnel", { steps: [null] }))).status).toBe(400);
  expect((await app.request(request("/", { entity: "profile", limit: Infinity }))).status).toBe(400);
  expect(calls.length).toBe(before);
  const anonymous = createQueryRoutes({ account: () => undefined });
  expect((await anonymous.request(request("/", legacy))).status).toBe(401);
});
