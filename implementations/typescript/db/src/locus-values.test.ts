// @ts-nocheck -- Actual state closures and Drizzle SQL; only the DB driver is simulated.
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as orm from "drizzle-orm";
import { locusViews } from "./schema/locus-views";
import { decodeLocusViewRow } from "./queries/locus-view-values";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import * as rootModel from "./queries/locus-root-model";

const stateSource = await Bun.file(new URL("../../runtime/src/handlers/state.ts", import.meta.url)).text();
const rootSource = await Bun.file(new URL("./queries/locus-root.ts", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
function rootQueries(db) {
  // Load the actual query module with only its driver replaced, matching the
  // state-closure fixture below. No Bun.mock leaks into other account tests.
  const source = rootSource.replace(/^import[\s\S]*?;\r?$/gm, "").replace(/^export /gm, "");
  const names = [...rootSource.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]);
  const dependencies = { ...orm, ...rootModel, getDb: () => db, locusViews, decodeLocusViewRow, CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue };
  return new Function(...Object.keys(dependencies), transpiler.transformSync(source) + `; return {${names.join(",")}};`)(...Object.values(dependencies));
}
function handler(name, dbExports) {
  const start = stateSource.indexOf('reg.registerIOHandler("' + name + '"');
  expect(start).toBeGreaterThan(-1);
  const bodyStart = stateSource.indexOf("async (", start);
  const bodyEnd = stateSource.indexOf("\n  });", bodyStart);
  const body = (stateSource.slice(bodyStart, bodyEnd) + "\n}")
    .replaceAll('await import("@fenel/db")', "dbExports").replaceAll('await import("drizzle-orm")', "orm");
  const maybeStart = stateSource.indexOf("  const unwrapMaybe =");
  const maybeEnd = stateSource.indexOf("\n  };", maybeStart) + 5;
  const code = transpiler.transformSync(stateSource.slice(maybeStart, maybeEnd) + "\n const handler = " + body + ";");
  return new Function("dbExports", "orm", "decodeLocusViewRow", "encodeCheckpointValue", "CHECKPOINT_VALUE_ENCODING",
    code + "; return handler;")(dbExports, orm, decodeLocusViewRow, encodeCheckpointValue, CHECKPOINT_VALUE_ENCODING);
}
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const instant = "2026-09-08T00:00:00.000Z";
function fixture() {
  const rows = [], calls = [];
  const jsonColumns = new Set(["view"]);
  const decode = (column, value) => jsonColumns.has(column) && typeof value === "string" ? JSON.parse(value) : value;
  const parameter = (token, params) => /^\$\d+$/.test(token.trim()) ? params[Number(token.trim().slice(1)) - 1] : null;
  const driver = drizzle(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    let selected = rows.filter(row => params.includes(row.account_id));
    const idPredicate = sql.slice(sql.indexOf(" where ")).match(/"(?:locus_views"\.")?id" = (\$\d+)/);
    const targetId = idPredicate ? parameter(idPredicate[1], params) : undefined;
    if (targetId) selected = selected.filter(row => row.id === targetId);
    let columns;
    if (sql.startsWith('insert into "locus_views"')) {
      const names = sql.match(/^insert into "locus_views" \(([^)]+)\)/)[1].split(/,\s*/).map(name => name.replaceAll('"', ""));
      const tokens = sql.match(/ values \(([^)]+)\)/)[1].split(/,\s*/);
      const row = { id: "row-" + rows.length, created_at: instant, updated_at: instant };
      tokens.forEach((token, index) => { if (token !== "default") row[names[index]] = decode(names[index], parameter(token, params)); });
      if (rows.some((existing) => existing.id === row.id)) throw new Error("duplicate root identity");
      rows.push(row); selected = [row];
    } else if (sql.startsWith('update "locus_views"')) {
      // The production pin leaf scopes its read to the account then writes by
      // that owned id. Other update leaves repeat the account predicate.
      if (!selected.length && targetId && !sql.includes('"account_id"')) selected = rows.filter(row => row.id === targetId);
      for (const row of selected) for (const match of sql.matchAll(/"([^"]+)" = (\$\d+)/g)) {
        if (match.index > sql.indexOf(" where ")) break;
        row[match[1]] = decode(match[1], parameter(match[2], params));
      }
    } else if (sql.startsWith('delete from "locus_views"')) {
      for (const row of selected) rows.splice(rows.indexOf(row), 1);
    }
    if (/ where .*"active" =/i.test(sql)) selected = selected.filter(row => row.active);
    const projection = sql.includes(" returning ") ? sql.split(" returning ")[1] : sql.match(/^select ([\s\S]*?) from /)?.[1];
    if (!projection) return { rows: [] };
    columns = projection.split(/,\s*/).map(expression => [...expression.matchAll(/"([^"]+)"/g)].at(-1)[1]);
    return { rows: selected.map(row => columns.map(column => row[column] ?? null)) };
  });
  let queue = Promise.resolve();
  const db = new Proxy(driver, { get(target, key) {
    if (key !== "transaction") return Reflect.get(target, key);
    return (work) => {
      const running = queue.then(async () => {
        const before = structuredClone(rows);
        try { return await work(driver); }
        catch (error) { rows.splice(0, rows.length, ...before); throw error; }
      });
      queue = running.catch(() => {});
      return running;
    };
  } });
  const queries = rootQueries(db);
  return { rows, calls, queries, call: (name, params = {}, selectedAccount = account) => handler(name, queries)(params, { accountId: selectedAccount }) };
}

test("Home creation, reopening, update and language pin keep native inline expressions through SQL JSON", async () => {
  const h = fixture();
  const value = { bytes: Uint8Array.of(0, 255), max: Infinity, zero: -0, raw: { $fenelCheckpoint: ["number", "+infinity"] } };
  const view = { kind: "tree", items: [{ id: "inline", source: { kind: "expr", expr: { kind: "literal", value } } }] };
  const created = (await h.call("state.create_locus_view", { data: { name: "Home", view, active: true } })).value;
  expect(created.view).toEqual(view);
  expect(created).not.toHaveProperty("viewEncoding");
  expect(h.rows[0].view_encoding).toBe(CHECKPOINT_VALUE_ENCODING);
  expect((await h.call("state.list_locus_views")).value.find((row) => row.id === created.id).view).toEqual(view);
  expect((await h.call("state.get_active_locus_view")).value._0.view).toEqual(view);
  const changed = { ...view, kind: "canvas" };
  expect((await h.call("state.update_locus_view", { id: created.id, patch: { view: { $tag: "Just", _0: { kind: "locus-list-command", expectedRevision: created.rootRevision, view: changed } } } })).value._0.view).toEqual(changed);
  await h.call("state.pin_to_view", { value, caption: "Native" });
  const pinned = (await h.call("state.get_active_locus_view")).value._0.view;
  expect(pinned.items[0]).toEqual(view.items[0]);
  expect(pinned.items[1].source.expr.value).toEqual(value);
  expect((await h.call("state.list_locus_views", {}, "another-account")).value).toEqual([]);
  expect((await h.call("state.read_locus_root", {}, "another-account")).value.items).toEqual([]);
  expect(h.calls.some(call => call.sql.includes('"view_encoding"') && call.params.includes(CHECKPOINT_VALUE_ENCODING))).toBe(true);
  expect((await h.call("state.delete_locus_view_by_id", { id: created.id })).value._0.view).toEqual(pinned);
});

test("legacy Home marker records stay raw on reads, activation and append; unknown versions refuse", async () => {
  const h = fixture();
  const raw = { $fenelCheckpoint: ["number", "+infinity"] };
  h.rows.push({ id: "legacy", account_id: account, name: "Legacy", active: true, view: { kind: "canvas", items: [], raw }, view_encoding: null, created_at: instant, updated_at: instant });
  const activated = (await h.call("state.update_locus_view", { id: "legacy", patch: { active: { $tag: "Just", _0: true } } })).value._0;
  expect(activated.view.raw).toEqual(raw);
  expect(h.rows[0].view_encoding).toBeNull();
  await h.call("state.pin_to_view", { value: Uint8Array.of(5) });
  expect((await h.call("state.get_active_locus_view")).value._0.view.raw).toEqual(raw);
  // The original remains an exact archive, including legacy provenance.
  expect(h.rows[0].view_encoding).toBeNull();
  expect(h.rows.find((row) => row.id === account).view_encoding).toBe(CHECKPOINT_VALUE_ENCODING);
  h.rows.find((row) => row.id === account).view_encoding = "future";
  await expect(h.call("state.get_active_locus_view")).rejects.toThrow("Unsupported checkpoint encoding");
});

test("read-only migration stays a preview; first authorized root append stores one value and leaves legacy rows intact", async () => {
  const h = fixture();
  const legacy = { id: "legacy", account_id: account, name: "Legacy", active: true, view: { kind: "list", items: [] }, view_encoding: null, created_at: instant, updated_at: instant };
  h.rows.push(structuredClone(legacy));
  const preview = await h.queries.readLocusRoot(account);
  expect(preview.persisted).toBe(false);
  expect(h.rows).toEqual([legacy]);
  const written = await h.queries.editLocusRoot(account, preview.revision, { kind: "append", item: { id: "number", source: { kind: "expr", expr: { kind: "literal", value: 42 } } } });
  expect(written.items.map((item) => item.id)).toEqual(["legacy", "number"]);
  expect(written.persisted).toBe(true);
  expect(h.rows.filter((row) => row.id === account)).toHaveLength(1);
  expect(h.rows[0]).toEqual(legacy);
  await h.queries.editLocusRoot(account, written.revision, { kind: "remove", itemId: "legacy" });
  expect((await h.queries.readLocusRoot(account)).items.map((item) => item.id)).toEqual(["number"]);
  expect(h.rows[0]).toEqual(legacy);
  expect(h.calls.some((call) => call.sql.includes("pg_advisory_xact_lock"))).toBe(true);
  expect(h.calls.some((call) => call.sql.includes("for update"))).toBe(true);
});

test("simultaneous root edits reject the stale revision without overwriting the accepted value", async () => {
  const h = fixture();
  const command = (id) => ({ kind: "append", item: { id, source: { kind: "expr", expr: { kind: "literal", value: id } } } });
  const results = await Promise.allSettled([h.queries.editLocusRoot(account, 0, command("first")), h.queries.editLocusRoot(account, 0, command("second"))]);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1].status).toBe("rejected");
  expect(results[1].reason.name).toBe("LocusRootConflict");
  expect((await h.queries.readLocusRoot(account)).items.map((item) => item.id)).toEqual(["first"]);
  expect(h.rows).toHaveLength(1);
  await expect(h.queries.editLocusRoot(account, 1, { kind: "reorder", itemIds: [] })).rejects.toThrow();
  expect((await h.queries.readLocusRoot(account)).items.map((item) => item.id)).toEqual(["first"]);
});

test("list replacement uses its original root revision and foreign child ids never cross accounts", async () => {
  const h = fixture();
  const child = await h.queries.createLocusRootList(account, { name: "List", view: { kind: "list", items: [] }, active: true });
  await h.queries.editLocusRoot(account, child.rootRevision, { kind: "append", item: { id: "other", source: { kind: "expr", expr: { kind: "literal", value: true } } } });
  await expect(h.queries.patchLocusRootList(account, child.id, { view: { kind: "list", items: [] } }, child.rootRevision)).rejects.toThrow("another session");
  expect(await h.queries.patchLocusRootList("foreign-account", child.id, { name: "Stolen" })).toBeNull();
  expect(h.rows).toHaveLength(1);
  expect((await h.queries.readLocusRoot(account)).lists[0].name).toBe("List");
});

test("an old server writing an archived row is detected and neither version is overwritten", async () => {
  const h = fixture();
  h.rows.push({ id: "legacy", account_id: account, name: "Legacy", active: true, view: { kind: "list", items: [] }, view_encoding: null, created_at: instant, updated_at: instant });
  await h.queries.editLocusRoot(account, 0, { kind: "layout", layout: { kind: "grid" } });
  const rootBefore = structuredClone(h.rows.find((row) => row.id === account));
  h.rows[0].updated_at = "2026-09-21T00:00:00.000Z";
  await expect(h.queries.readLocusRoot(account)).rejects.toThrow("Both versions were preserved");
  await expect(h.queries.editLocusRoot(account, 1, { kind: "layout", layout: { kind: "list" } })).rejects.toThrow("Both versions were preserved");
  expect(h.rows.find((row) => row.id === account)).toEqual(rootBefore);
  expect(h.rows[0].updated_at).toBe("2026-09-21T00:00:00.000Z");
});
