// @ts-nocheck -- Actual state/query closures and Drizzle SQL; only DB IO is simulated.
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as orm from "drizzle-orm";
import { savedQueries } from "./schema/saved-queries";
import { queryCategories, queryCategoryMembers } from "./schema/query-categories";
import { functionInstances } from "./schema/functions";
import { decodeSavedQueryRow, savedQueryColumns } from "./queries/saved-queries";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointRow } from "@fenel/engine/checkpoint-json";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherAccount = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const instant = "2026-09-08T00:00:00.000Z";
const stateSource = await Bun.file(new URL("../../runtime/src/handlers/state.ts", import.meta.url)).text();
const querySource = await Bun.file(new URL("./queries/entity-query.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const marker = { $fenelCheckpoint: ["number", "+infinity"] };
const constraint = { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } };
const nativeQuery = { entity: "profile", filter: { name: constraint }, metadata: { bytes: Uint8Array.of(0, 255), raw: marker, zero: -0 }, $fenelCheckpoint: "a user query key" };

function fixture() {
  const rows = [], calls = [];
  const categories = [{ id: "category", account_id: account, slug: "all", name: "All" }];
  const members = [];
  const parameter = (token, params) => /^\$\d+$/.test(token.trim()) ? params[Number(token.trim().slice(1)) - 1] : null;
  const decode = (name, value) => name === "query" && typeof value === "string" ? JSON.parse(value) : value;
  const db = drizzle(async (sql, params) => {
    calls.push({ sql, params });
    const table = sql.match(/(?:from|into|update) "([^"]+)"/)?.[1];
    const source = table === "query_categories" ? categories : table === "query_category_members" ? members : rows;
    let selected = source.filter(row => !sql.includes('"account_id" =') || params.includes(row.account_id));
    for (const name of ["id", "slug", "category_id"]) {
      const equal = sql.match(new RegExp(`"${name}" = (\\$\\d+)`));
      if (equal) selected = selected.filter(row => row[name] === parameter(equal[1], params));
    }
    if (/\"id\" in /.test(sql)) selected = selected.filter(row => params.includes(row.id));
    const search = params.find(value => typeof value === "string" && value.startsWith("%"));
    if (search) selected = selected.filter(row => [row.name, row.slug, row.description].some(value => String(value ?? "").toLowerCase().includes(search.slice(1, -1).toLowerCase())));
    if (sql.startsWith('insert into "saved_queries"')) {
      const names = sql.match(/^insert into "saved_queries" \(([^)]+)\)/)[1].split(/,\s*/).map(name => name.replaceAll('"', ""));
      const tokens = sql.match(/ values \(([^)]+)\)/)[1].split(/,\s*/);
      const row = { id: "row-" + rows.length, created_at: instant, updated_at: instant, query_encoding: null };
      tokens.forEach((token, index) => { if (token !== "default") row[names[index]] = decode(names[index], parameter(token, params)); });
      rows.push(row); selected = [row];
    } else if (sql.startsWith('update "saved_queries"')) {
      for (const row of selected) for (const match of sql.matchAll(/"([^"]+)" = (\$\d+)/g)) {
        if (match.index > sql.indexOf(" where ")) break;
        row[match[1]] = decode(match[1], parameter(match[2], params));
      }
    } else if (sql.startsWith('delete from "saved_queries"')) {
      for (const row of selected) rows.splice(rows.indexOf(row), 1);
    }
    const projection = sql.includes(" returning ") ? sql.split(" returning ")[1] : sql.match(/^select ([\s\S]*?) from /)?.[1];
    if (!projection) return { rows: [] };
    const columns = projection.split(/,\s*/).map(expression => [...expression.matchAll(/"([^"]+)"/g)].at(-1)[1]);
    return { rows: selected.map(row => columns.map(column => row[column] ?? null)) };
  });
  let transactionQueue = Promise.resolve();
  const storage = {
    select: (...args) => db.select(...args), insert: (...args) => db.insert(...args),
    update: (...args) => db.update(...args), delete: (...args) => db.delete(...args),
    transaction: (operation) => {
      const result = transactionQueue.then(() => operation(db));
      transactionQueue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const dbExports = { getDb: () => storage, savedQueries, queryCategories, queryCategoryMembers, decodeSavedQueryRow, savedQueryColumns };
  const engineExports = { dispatchEngineBody };
  function handler(name) {
    const start = stateSource.indexOf('reg.registerIOHandler("state.' + name + '"');
    if (start < 0) throw new Error("Missing production handler " + name);
    const bodyStart = stateSource.indexOf("async (", start);
    const bodyEnd = stateSource.indexOf("\n  });", bodyStart);
    const body = (stateSource.slice(bodyStart, bodyEnd) + "\n}").replaceAll('await import("@fenel/db")', "dbExports").replaceAll('await import("drizzle-orm")', "orm").replaceAll('await import("@fenel/engine/engine-bodies-dispatch")', "engineExports");
    const maybeStart = stateSource.indexOf("  const unwrapMaybe =");
    const maybeEnd = stateSource.indexOf("\n  };", maybeStart) + 5;
    const code = transpiler.transformSync(stateSource.slice(maybeStart, maybeEnd) + "\n const handler = " + body + ";");
    return new Function("dbExports", "orm", "engineExports", code + "; return handler;")(dbExports, orm, engineExports);
  }
  const refStart = querySource.indexOf("async function resolveQueryRefs(");
  const refEnd = querySource.indexOf("\nexport async function executeQuery(", refStart);
  const normalStart = querySource.indexOf("function normalizeRows(");
  const normalEnd = querySource.indexOf("\n// ---------------------------------------------------------------------------", normalStart);
  const code = transpiler.transformSync(querySource.slice(refStart, refEnd) + querySource.slice(normalStart, normalEnd) + querySource.slice(querySource.indexOf("export class QueryError")).replace("export class", "class"));
  const query = new Function("getDb", "savedQueries", "functionInstances", "and", "eq", "decodeSavedQueryRow", "decodeCheckpointRow", code + "; return { resolveQueryRefs, normalizeRows };")(() => db, savedQueries, functionInstances, orm.and, orm.eq, decodeSavedQueryRow, decodeCheckpointRow);
  return { rows, calls, members, query, call: (name, params = {}, scope = account) => handler(name)(params, { accountId: scope }) };
}

test("saved-query state create/read/search/category/update keep native filters and literal marker data through SQL JSON", async () => {
  const h = fixture();
  const created = (await h.call("create_saved_query", { data: { slug: "native", name: "Native", query: nativeQuery } })).value;
  expect(created.query).toEqual(nativeQuery);
  expect(created).not.toHaveProperty("queryEncoding");
  expect(h.rows[0].query_encoding).toBe(CHECKPOINT_VALUE_ENCODING);
  expect(h.rows[0].query.entity).toBe("profile");
  expect(h.rows[0].query.$fenelCheckpoint).toBe("a user query key");
  expect((await h.call("list_saved_queries")).value[0].query).toEqual(nativeQuery);
  expect((await h.call("search_saved_queries", { q: "Native" })).value[0].query).toEqual(nativeQuery);
  h.members.push({ category_id: "category", query_id: created.id });
  expect((await h.call("list_saved_queries_by_category", { categorySlug: "all" })).value[0].query).toEqual(nativeQuery);
  expect((await h.call("get_saved_query", { id: created.id })).value._0.query).toEqual(nativeQuery);
  const renamed = await h.call("update_saved_query", { id: created.id, patch: { name: { $tag: "Just", _0: "Renamed" } } });
  expect(renamed.value._0.query).toEqual(nativeQuery);
  expect(h.calls.at(-1).sql.split(" where ")[0]).not.toContain('"query_encoding"');
  const next = { ...nativeQuery, metadata: { ...nativeQuery.metadata, bytes: Uint8Array.of(7, 9) } };
  const changed = await h.call("update_saved_query", { id: created.id, patch: { query: { $tag: "Just", _0: next } } });
  expect(changed.value._0.query).toEqual(next);
  expect(h.calls.at(-1).sql).toContain('"query_encoding" =');
  expect((await h.call("get_saved_query", { id: created.id }, otherAccount)).value.$tag).toBe("Nothing");
  expect(h.calls.some(({ sql, params }) => sql.startsWith('insert into "saved_queries"') && params.some(value => typeof value === "string" && value.includes('"+infinity"')))).toBe(true);
});

test("saved-query references and generic query row projection decode only physical provenance", async () => {
  const h = fixture();
  await h.call("create_saved_query", { data: { slug: "native", name: "Native", query: nativeQuery } });
  const resolved = await h.query.resolveQueryRefs(account, { entity: "profile", filter: { $ref: "query:native" } });
  expect(resolved.filter.name).toEqual(constraint);
  h.rows.push({ id: "legacy", account_id: account, slug: "legacy", name: "Legacy", query: { literal: marker }, query_encoding: null });
  h.rows.push({ id: "null", account_id: account, slug: "null", name: "Null", query: null, query_encoding: null });
  const rows = h.query.normalizeRows(h.rows, { table: savedQueries, columns: { id: "id", name: "name" } });
  expect(rows[0].query).toEqual(nativeQuery);
  expect(rows[1].query).toEqual({ literal: marker });
  expect(rows[2].query).toBeNull();
  expect(rows.every(row => !Object.hasOwn(row, "query_encoding") && !Object.hasOwn(row, "queryEncoding"))).toBe(true);
  await expect(h.query.resolveQueryRefs(account, { entity: "profile", filter: { $ref: "query:null" } })).rejects.toThrow("not an executable query object");
  await expect(h.call("create_saved_query", { data: { slug: "bad", name: "Bad", query: null } })).rejects.toThrow("record");
  await expect(h.call("update_saved_query", { id: "legacy", patch: { query: { $tag: "Just", _0: [] } } })).rejects.toThrow("object");
});

test("saved-query malformed formats fail explicitly and migration never rewrites legacy data", async () => {
  expect(() => decodeSavedQueryRow({ query: {}, queryEncoding: "unknown-v99" })).toThrow("Unsupported checkpoint encoding");
  expect(() => decodeSavedQueryRow({ query: null, queryEncoding: CHECKPOINT_VALUE_ENCODING })).toThrow("Malformed checkpoint variables");
  expect(() => decodeSavedQueryRow({ query: { value: { $fenelCheckpoint: ["wrong", 0] } }, queryEncoding: CHECKPOINT_VALUE_ENCODING })).toThrow("Unknown checkpoint atom");
  expect(decodeSavedQueryRow({ query: null, queryEncoding: null }).query).toBeNull();
  const migration = await Bun.file(new URL("./migrations/0094_saved_query_value_encoding.sql", import.meta.url)).text();
  expect(migration).toContain("query_encoding IS NULL");
  expect(migration).not.toMatch(/UPDATE\s+saved_queries/i);
});

test("saved-query preconditions preserve native and legacy data and refuse stale edits or deletes", async () => {
  const h = fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  const created = (await h.call("create_saved_query", { data: { id, slug: "native", query: nativeQuery } })).value;
  expect(created.id).toBe(id);
  expect(h.rows[0].id).toBe(id);
  const next = { ...nativeQuery, metadata: { ...nativeQuery.metadata, bytes: Uint8Array.of(2, 255) } };
  const saved = await h.call("update_saved_query", { id, patch: { query: { $tag: "Just", _0: next }, expectedQuery: { $tag: "Just", _0: nativeQuery } } });
  expect(saved.value._0.query).toEqual(next);
  const writes = h.calls.filter(call => call.sql.startsWith('update "saved_queries"')).length;
  const refused = await h.call("update_saved_query", { id, patch: { query: { $tag: "Just", _0: nativeQuery }, expectedQuery: { $tag: "Just", _0: nativeQuery } } });
  expect(refused.value.$tag).toBe("Nothing");
  expect(h.calls.filter(call => call.sql.startsWith('update "saved_queries"'))).toHaveLength(writes);
  expect((await h.call("delete_saved_query", { id, expectedQuery: { $tag: "Just", _0: nativeQuery } })).value).toBe(false);
  expect((await h.call("get_saved_query", { id })).value._0.query).toEqual(next);
  expect((await h.call("delete_saved_query", { id, expectedQuery: { $tag: "Just", _0: next } })).value).toBe(true);
  expect(h.calls.filter(call => call.sql.endsWith("for update")).length).toBeGreaterThanOrEqual(4);
  const legacy = { literal: marker };
  h.rows.push({ id: "legacy", account_id: account, slug: "legacy", query: legacy, query_encoding: null });
  expect((await h.call("update_saved_query", { id: "legacy", patch: { query: { $tag: "Just", _0: { changed: true } }, expectedQuery: { $tag: "Just", _0: legacy } } })).value.$tag).toBe("Just");
  await expect(h.call("create_saved_query", { data: { id: "invalid", slug: "invalid", query: {} } })).rejects.toThrow("UUID");
});

test("two saved-query commands sharing one baseline leave the second draft uncommitted", async () => {
  const h = fixture();
  const created = (await h.call("create_saved_query", { data: { slug: "native", query: nativeQuery } })).value;
  const results = await Promise.all([1, 2].map(value => h.call("update_saved_query", {
    id: created.id, patch: { query: { $tag: "Just", _0: { value } }, expectedQuery: { $tag: "Just", _0: nativeQuery } },
  })));
  expect(results.map(result => result.value.$tag).sort()).toEqual(["Just", "Nothing"]);
  expect(h.calls.filter(call => call.sql.startsWith('update "saved_queries"'))).toHaveLength(1);
  expect((await h.call("get_saved_query", { id: created.id })).value._0.query).toEqual({ value: 1 });
});
