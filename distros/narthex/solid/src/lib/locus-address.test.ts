import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { List } from "@fenel/engine/type-foundation";
import type { LocusRootData } from "./locus-root-data";
import type { LayoutItem } from "./locus-view-model";
import type { WorkspaceModel } from "./workspace-model-loader";
import { ROOT_SCOPE, parentScope, scopeAncestors, scopeKey, type LocusScope } from "./locus-scope";
import { scopeFromWorkspace, scopeToWorkspace, workspaceSourceKey, type WorkspaceSource } from "./workspace-wire";
import { loadPublicBootstrap } from "./public-bootstrap";
import { decodeLocusAddress, encodeLocusAddress, locusAddressForScope, locusAddressMembers, locusSegmentUsesHostRoute, resolveLocusAddress, type LocusAddressValues, type LocusAddressOperate } from "./locus-address";

// C1 transport integration: production adapters call the current Fenel owner.
// GLOBAL_ONLY: the source fixture has no account or host authority; all data
// comes from literal fixtures or the existing checked anonymous bootstrap.
const owner = loadFenelModule(readFileSync(new URL("../../../../../fenel/modules/view/address.fenel", import.meta.url), "utf8"), "view");
const functionsById = new Map((owner.functions ?? []).map(fn => [fn.id, fn]));
const functionsByName = new Map((owner.functions ?? []).map(fn => [fn.id.split(":").at(-1)!, fn]));
const context: EvaluateContext = {
  getFunction: name => functionsById.get(name) ?? functionsByName.get(name),
  natives: Object.assign(Object.create(null), stdNatives),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"] },
};
const model: Pick<WorkspaceModel, "workspaceCall"> = {
  workspaceCall<T>(name: string, ...args: unknown[]): T {
    return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
      Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
  },
};
const operate: LocusAddressOperate = async (operation, options) => {
  options?.assertCurrent?.();
  return model.workspaceCall(operation.kind, ...operation.args);
};
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const heldRecord = (fields: Array<{ name: string; value: ExprNode }>): ExprNode => literal({ __record: { fields } });
function item(id: string, value: unknown, caption?: string): LayoutItem {
  return { id, caption, source: { kind: "expr", expr: literal(value) } };
}
function rootOf(items: LayoutItem[]): LocusRootData {
  return { id: "address-fixture", name: "All data", type: { $ref: "AddressFixtureRoot" },
    expr: literal({ __list: items.map(entry => entry.source?.kind === "expr" ? entry.source.expr : literal(undefined)) }),
    revision: 0, persisted: false, canEdit: false, layout: { kind: "grid" }, items, lists: [],
    expressions: {}, referenceId: "locus:address-fixture" };
}
const focus = (root: LocusRootData, id: string, path: Array<string | number> = []): Extract<LocusScope, { kind: "value" }> =>
  ({ kind: "value", viewId: root.id, itemId: id, path, rootItem: true });
async function resolve(root: LocusRootData, pathname: string) {
  return (await resolveLocusAddress(root, decodeLocusAddress(pathname), operate));
}
const nothing = { $tag: "Nothing" } as const;
function recordType(names: string[], ids: string[] = []): FenelType {
  return { $record: { fields: names.map((name, index) => ({ name, type: { $ref: "String" }, label: nothing,
    ui: nothing, meta: {}, ...(ids[index] ? { key: { $tag: "NamedField" as const, ref: { $ref: ids[index]! } } } : {}) })) } };
}

describe("ordinary addressed reader data", () => {
  test("existing public std names resolve to their canonical Home focus", async () => {
    const { root } = await loadPublicBootstrap();
    for (const name of ["reverse", "upper"]) {
      const resolved = (await resolve(root, `/std/${name}`));
      expect(resolved.missing).toBeUndefined();
      expect(resolved.focus).toEqual(focus(root, "std", [name]));
      expect((await locusAddressForScope(root, resolved.focus, operate))).toBe(`/std/${name}`);
    }
    expect((await resolve(root, "/reverse")).missing).toBe("reverse");
    expect((await resolve(root, "/std/string/reverse")).missing).toBe("string");
  });

  test("existing captions alias Codeable names while canonical links retain source names", async () => {
    const { root } = await loadPublicBootstrap();
    const resolved = (await resolve(root, "/Standard%20library/reverse"));
    expect(resolved.focus).toEqual(focus(root, "std", ["reverse"]));
    expect(resolved.segments).toEqual(["std", "reverse"]);
    expect((await locusAddressForScope(root, resolved.focus, operate))).toBe("/std/reverse");
  });

  test("checked initial results expose computed collection positions without executing them", async () => {
    const { root } = await loadPublicBootstrap();
    const address = encodeLocusAddress(["demo", "Countries of the world", "Countries", "1"]);
    const resolved = (await resolve(root, address));
    expect(resolved.missing).toBeUndefined();
    expect(resolved.focus).toEqual(focus(root, "demo", ["Countries of the world", "Countries", 0]));
    expect((await locusAddressForScope(root, resolved.focus, operate))).toBe(address);
    expect(locusAddressMembers(root, resolved.focus).members.length).toBeGreaterThan(0);
  });

  test("spaces, Unicode and encoded slashes are exact field names", async () => {
    const names = ["Reversed words", "Ελλάδα", "a/b", "100%", "e\u0301"];
    const demo: LayoutItem = { id: "demo", caption: "Demo", representations: { Codeable: { codeName: "demo" } },
      source: { kind: "expr", expr: heldRecord(names.map(name => ({ name, value: literal(name) }))) }, valueType: recordType(names) };
    const root = rootOf([demo]);
    for (const name of names) {
      const address = encodeLocusAddress(["demo", name]);
      const resolved = (await resolve(root, address));
      expect(resolved.missing).toBeUndefined();
      expect(resolved.focus).toEqual(focus(root, "demo", [name]));
      expect((await locusAddressForScope(root, resolved.focus, operate))).toBe(address);
    }
    expect((await resolve(root, "/demo/a/b")).missing).toBe("a");
  });

  test("root and held list positions are one-based and preserve numeric focus steps", async () => {
    const root = rootOf([item("list", { __list: [literal("A"), literal("B")] }, "letters")]);
    const resolved = (await resolve(root, "/1/2"));
    expect(resolved.focus).toEqual(focus(root, "list", [1]));
    expect(resolved.segments).toEqual(["letters", "2"]);
    expect((await locusAddressForScope(root, resolved.focus, operate))).toBe("/letters/2");
    for (const path of ["/letters/0", "/letters/02", "/letters/+2", "/letters/2.0", "/letters/3"]) {
      expect((await resolve(root, path)).missing).toBeDefined();
    }
  });

  test("plain list values use the same position owner", async () => {
    const root = rootOf([item("list", ["A", { nested: "B" }], "letters")]);
    const resolved = (await resolve(root, "/letters/2/nested"));
    expect(resolved.focus).toEqual(focus(root, "list", [1, "nested"]));
    expect((await locusAddressForScope(root, resolved.focus, operate))).toBe("/letters/2/nested");
  });

  test("record field '1' remains distinct from list index zero", async () => {
    const root = rootOf([item("record", { "1": "record field" }, "record"), item("list", ["list item"], "list")]);
    const record = (await resolve(root, "/record/1"));
    const list = (await resolve(root, "/list/1"));
    expect(record.focus).toEqual(focus(root, "record", ["1"]));
    expect(list.focus).toEqual(focus(root, "list", [0]));
    expect(scopeKey(record.focus)).not.toBe(scopeKey(list.focus));
  });

  test("named list-row navigation keeps the existing view scope", async () => {
    const root = rootOf([item("collection", [], "collection")]);
    root.lists.push({ id: "collection", name: "Collection", active: false, view: { kind: "list", items: [item("row", "value", "row")] },
      referenceId: "collection:expression", sourceReferenceId: "collection:source", rootRevision: 0,
      valueType: { $ref: "List" }, derivedCanvas: false });
    const resolved = (await resolve(root, "/collection/row"));
    expect(resolved.focus).toEqual({ kind: "value", viewId: "collection", itemId: "row", path: [] });
    expect((await locusAddressForScope(root, resolved.focus, operate))).toBe("/collection/row");
  });

  test("unnamed occurrences and duplicate captions retain identity addresses", async () => {
    const root = rootOf([item("unnamed", "value"), item("first", "one", "same"), item("second", "two", "same")]);
    expect((await resolve(root, "/_unnamed")).focus).toEqual(focus(root, "unnamed"));
    expect((await resolve(root, "/same")).missing).toBe("same");
    for (const id of ["first", "second"]) {
      const resolved = (await resolve(root, `/_${id}`));
      expect(resolved.focus).toEqual(focus(root, id));
      expect((await locusAddressForScope(root, resolved.focus, operate))).toBe(`/_${id}`);
    }
  });

  test("the Codeable underscore marker means no name without reserving record fields", async () => {
    const unnamed = item("identity", "value");
    unnamed.representations = { Codeable: { codeName: "_" } };
    const root = rootOf([unnamed, item("record", { "_": "field" }, "record")]);
    expect((await locusAddressForScope(root, focus(root, "identity"), operate))).toBe("/_identity");
    expect((await resolve(root, "/_")).missing).toBe("_");
    expect((await resolve(root, "/record/_")).focus).toEqual(focus(root, "record", ["_"]));
  });

  test("declared field identities provide aliases without exposing type transport keys", async () => {
    const record: LayoutItem = { id: "record", caption: "record", source: { kind: "expr", expr: heldRecord([{ name: "name", value: literal("Fenel") }]) },
      valueType: recordType(["name"], ["field-identity"]) };
    const root = rootOf([record]);
    const resolved = (await resolve(root, "/record/_field-identity"));
    expect(resolved.focus).toEqual(focus(root, "record", ["name"]));
    expect(resolved.segments).toEqual(["record", "name"]);
    expect((await resolve(root, "/record/$record")).missing).toBe("$record");
  });

  test("typed plain-object dot fields roundtrip through their declared identity addresses", async () => {
    const record = item("record", { ".": "current field", "..": "parent field" }, "record");
    record.valueType = recordType([".", ".."], ["dot-field", "parent-field"]);
    const root = rootOf([record]);
    for (const [name, id] of [[".", "dot-field"], ["..", "parent-field"]] as const) {
      const fieldFocus = focus(root, "record", [name]);
      const address = (await locusAddressForScope(root, fieldFocus, operate));
      expect(address).toBe(`/record/_${id}`);
      if (address === undefined) throw new Error("A typed field identity must have an address.");
      expect(new URL(address, "https://fenel.invalid").pathname).toBe(address);
      const resolved = (await resolve(root, address));
      expect(resolved.missing).toBeUndefined();
      expect(resolved.focus).toEqual(fieldFocus);
      expect(resolved.segments).toEqual(["record", `_${id}`]);
    }
  });

  test("raw dot fields without declared identity refuse an address instead of naming an ancestor", async () => {
    const root = rootOf([item("record", { ".": "current field", "..": "parent field" }, "record")]);
    for (const name of [".", ".."]) {
      expect((await locusAddressForScope(root, focus(root, "record", [name]), operate))).toBeUndefined();
      expect(() => encodeLocusAddress(["record", name])).toThrow("path instruction");
      const selected = (await resolveLocusAddress(root, ["record", name], operate));
      expect(selected.focus).toEqual(focus(root, "record"));
      expect(selected.segments).toEqual(["record"]);
      expect(selected.missing).toBe(name);
    }
    for (const name of ["...", ".config", "%2E", "%2E%2E"]) {
      const ordinary = rootOf([item("record", { [name]: "data" }, "record")]);
      const address = encodeLocusAddress(["record", name]);
      expect(new URL(address, "https://fenel.invalid").pathname).toBe(address);
      expect((await resolve(ordinary, address)).focus).toEqual(focus(ordinary, "record", [name]));
    }
  });

  test("a miss reports the deepest ancestor and does not open a neighbour", async () => {
    const root = rootOf([item("record", { child: { leaf: "value" }, neighbour: "other" }, "record")]);
    const resolved = (await resolve(root, "/record/child/missing/later"));
    expect(resolved.focus).toEqual(focus(root, "record", ["child"]));
    expect(resolved.segments).toEqual(["record", "child"]);
    expect(resolved.missing).toBe("missing");
    expect(resolved.detail).toContain("no readable data");
  });

  test("strings and references remain terminal data", async () => {
    const root = rootOf([item("string", "Fenel", "string"), item("ref", { $ref: "function-id" }, "ref")]);
    for (const id of ["string", "ref"]) {
      expect(locusAddressMembers(root, focus(root, id)).members).toEqual([]);
      expect((await resolve(root, `/${id}/1`)).focus).toEqual(focus(root, id));
      expect((await resolve(root, `/${id}/1`)).missing).toBe("1");
    }
    expect((await resolve(root, "/ref/$ref")).missing).toBe("$ref");
  });

  test("inherited prototype keys stay unavailable while own keys stay inert data", async () => {
    const inherited = Object.assign(Object.create({ private: "hidden" }), { safe: "visible" });
    const ordinary = JSON.parse('{"__proto__":{"nested":"data"},"safe":"visible"}');
    const root = rootOf([item("inherited", inherited, "inherited"), item("ordinary", ordinary, "ordinary")]);
    for (const name of ["private", "constructor", "toString", "__proto__"]) {
      expect((await resolve(root, `/inherited/${name}`)).missing).toBe(name);
    }
    expect((await resolve(root, "/ordinary/__proto__/nested")).focus).toEqual(focus(root, "ordinary", ["__proto__", "nested"]));
    expect(Object.hasOwn(Object.prototype, "nested")).toBe(false);
  });

  test("root links, trailing slashes and malformed URI input have explicit boundaries", async () => {
    const root = rootOf([item("data", "value", "data")]);
    expect((await resolve(root, "/")).focus).toEqual(ROOT_SCOPE);
    expect((await locusAddressForScope(root, ROOT_SCOPE, operate))).toBe("/");
    expect((await resolve(root, "/data/")).focus).toEqual(focus(root, "data"));
    for (const pathname of ["data", "//data", "/data//child", "/%", "/%GG", "/%C3%28"]) {
      expect(() => decodeLocusAddress(pathname)).toThrow();
    }
  });

  test("cached local and account producers expose root positions through the supplied reader only", async () => {
    for (const kind of ["local", "account"]) {
      const producer: ExprNode = { kind: "call", fnId: `${kind}:computed`, args: [] };
      const sibling: ExprNode = { kind: "call", fnId: `${kind}:unselected`, args: [] };
      const root = rootOf([
        { id: "computed", caption: "computed", source: { kind: "ref", ref: { kind: "savedExpr", id: "saved-computed" } } },
        { id: "other", caption: "other", source: { kind: "expr", expr: sibling } },
      ]);
      root.id = `${kind}-root`; root.persisted = kind === "account"; root.canEdit = true;
      const observed = [{ name: "First", score: 1 }, { name: "Second", score: 2 }];
      const reads: ExprNode[] = [];
      const values: LocusAddressValues = {
        expression: id => id === "saved-computed" ? producer : undefined,
        read: node => { reads.push(node); return node === producer ? { value: observed } : undefined; },
      };
      const resolved = (await resolveLocusAddress(root, ["1", "2", "score"], operate, values));
      expect(resolved.missing).toBeUndefined();
      expect(resolved.needsValue).toBeUndefined();
      expect(resolved.focus).toEqual(focus(root, "computed", [1, "score"]));
      expect(resolved.segments).toEqual(["computed", "2", "score"]);
      expect((await locusAddressForScope(root, resolved.focus, operate, values))).toBe("/computed/2/score");
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every(node => node === producer)).toBe(true);
    }
  });

  test("dynamic resolution and serialization request the same selected producer before reading children", async () => {
    const producer: ExprNode = { kind: "call", fnId: "fixture:rows", args: [] };
    const nested: LayoutItem = { id: "nested", caption: "nested", source: { kind: "expr", expr: heldRecord([
      { name: "rows", value: producer }, { name: "untouched", value: literal("other") },
    ]) } };
    const root = rootOf([nested]);
    const observations = new Map<ExprNode, { value: unknown }>();
    const values: LocusAddressValues = { read: node => observations.get(node) };
    const pending = (await resolveLocusAddress(root, ["nested", "rows", "2"], operate, values));
    expect(pending.focus).toEqual(focus(root, "nested", ["rows"]));
    expect(pending.segments).toEqual(["nested", "rows"]);
    expect(pending.missing).toBe("2");
    expect(pending.needsValue).toBe(producer);
    const requested: ExprNode[] = [];
    const target = focus(root, "nested", ["rows", 1]);
    expect((await locusAddressForScope(root, target, operate, values, node => requested.push(node)))).toBeUndefined();
    expect(requested).toEqual([producer]);
    observations.set(producer, { value: ["first", "second"] });
    const ready = (await resolveLocusAddress(root, ["nested", "rows", "2"], operate, values));
    expect(ready.focus).toEqual(target);
    expect(ready.missing).toBeUndefined();
    expect(ready.needsValue).toBeUndefined();
    requested.length = 0;
    expect((await locusAddressForScope(root, target, operate, values, node => requested.push(node)))).toBe("/nested/rows/2");
    expect(requested).toEqual([]);
  });

  test("completed undefined and falsy results stay leaves rather than restarting their producer", async () => {
    const producer: ExprNode = { kind: "call", fnId: "fixture:leaf", args: [] };
    const root = rootOf([{ id: "computed", caption: "computed", source: { kind: "expr", expr: producer } }]);
    for (const value of [undefined, false, 0, ""]) {
      const values: LocusAddressValues = { read: node => node === producer ? { value } : undefined };
      expect(locusAddressMembers(root, focus(root, "computed"), values).members).toEqual([]);
      expect(locusAddressMembers(root, focus(root, "computed"), values).needsValue).toBeUndefined();
      const resolved = (await resolveLocusAddress(root, ["computed", "1"], operate, values));
      expect(resolved.focus).toEqual(focus(root, "computed"));
      expect(resolved.missing).toBe("1");
      expect(resolved.needsValue).toBeUndefined();
    }
    expect(locusAddressMembers(root, focus(root, "computed"), { read: () => undefined }).needsValue).toBe(producer);
  });

  test("current reader child-type facts retain declared field identity inside computed list rows", async () => {
    const producer: ExprNode = { kind: "call", fnId: "fixture:typedRows", args: [] };
    const root = rootOf([{ id: "computed", caption: "computed", source: { kind: "expr", expr: producer } }]);
    const rowType = recordType([".", "name"], ["row-dot", "row-name"]);
    const listType = List(rowType);
    root.items[0]!.valueType = listType;
    const rows = [{ ".": "first", name: "First" }, { ".": "second", name: "Second" }];
    const facts = new Map<unknown, Map<string | number, FenelType>>([
      [rows, new Map([[0, rowType], [1, rowType]])],
      [rows[0], new Map([[".", { $ref: "String" }], ["name", { $ref: "String" }]])],
      [rows[1], new Map([[".", { $ref: "String" }], ["name", { $ref: "String" }]])],
    ]);
    const typeReads: Array<{ value: unknown; type: FenelType | undefined; step: string | number }> = [];
    const values: LocusAddressValues = {
      read: node => node === producer ? { value: rows } : undefined,
      childType: (value, type, step) => { typeReads.push({ value, type, step }); return facts.get(value)?.get(step); },
    };
    const resolved = (await resolveLocusAddress(root, ["computed", "2", "_row-dot"], operate, values));
    expect(resolved.focus).toEqual(focus(root, "computed", [1, "."]));
    expect(resolved.missing).toBeUndefined();
    expect((await locusAddressForScope(root, resolved.focus, operate, values))).toBe("/computed/2/_row-dot");
    expect(locusAddressMembers(root, resolved.focus, values).members).toEqual([]);
    expect(typeReads.some(read => read.value === rows && read.type === listType && read.step === 1)).toBe(true);
    expect(typeReads.some(read => read.value === rows[1] && read.type === rowType && read.step === ".")).toBe(true);
  });

  test("pass-through breadcrumb omissions retain every structural step in a resolvable URL", async () => {
    const root = rootOf([item("placed", [{ item: { title: "A" }, placement: { x: 0, y: 0 } }], "placed")]);
    const target: LocusScope = { ...focus(root, "placed", [0, "item", "title"]), passThrough: [1] };
    expect(scopeAncestors(target).some(ancestor => ancestor.kind === "value" && ancestor.path.length === 1)).toBe(false);
    const address = (await locusAddressForScope(root, target, operate));
    expect(address).toBe("/placed/1/item/title");
    expect((await resolve(root, address!)).focus).toEqual(focus(root, "placed", [0, "item", "title"]));
    const nestedRoot = rootOf([item("collection", [], "collection")]);
    nestedRoot.lists.push({ id: "collection", name: "Collection", active: false,
      view: { kind: "list", items: [item("placed-item", [{ item: { title: "B" } }], "placed")] },
      referenceId: "collection:expression", sourceReferenceId: "collection:source", rootRevision: 0,
      valueType: { $ref: "List" }, derivedCanvas: true });
    const nestedTarget: LocusScope = { kind: "value", viewId: "collection", itemId: "placed-item",
      path: [0, "item", "title"], passThrough: [1] };
    expect((await locusAddressForScope(nestedRoot, nestedTarget, operate))).toBe("/collection/placed/1/item/title");
    expect((await resolve(nestedRoot, "/collection/placed/1/item/title")).focus)
      .toEqual({ kind: "value", viewId: "collection", itemId: "placed-item", path: [0, "item", "title"] });
  });

  test("ref source dictionaries prefer own bindings and allow inherited-looking names in the reader fallback", async () => {
    const producer: ExprNode = { kind: "call", fnId: "fixture:fallback", args: [] };
    const ownProducer: ExprNode = { kind: "call", fnId: "fixture:own", args: [] };
    for (const id of ["toString", "constructor", "__proto__"]) {
      const root = rootOf([{ id: "computed", caption: "computed", source: { kind: "ref", ref: { kind: "savedExpr", id } } }]);
      const values: LocusAddressValues = {
        expression: handle => handle === id ? producer : undefined,
        read: node => node === producer ? { value: ["fallback"] } : node === ownProducer ? { value: ["own", "second"] } : undefined,
      };
      const fallback = (await resolveLocusAddress(root, ["computed", "1"], operate, values));
      expect(fallback.needsValue).toBeUndefined();
      expect(fallback.missing).toBeUndefined();
      expect(fallback.focus).toEqual(focus(root, "computed", [0]));
      Object.defineProperty(root.expressions, id, { value: ownProducer, enumerable: true, configurable: true });
      const own = (await resolveLocusAddress(root, ["computed", "2"], operate, values));
      expect(own.missing).toBeUndefined();
      expect(own.focus).toEqual(focus(root, "computed", [1]));
      expect(Object.hasOwn(Object.prototype, "fnId")).toBe(false);
    }
  });

  test("framework path protection chooses a real unambiguous identity only at the first member", async () => {
    for (const name of ["app", "login", "p", "api", "webhooks", "r", "reverse", "rabbit", "apiClient",
      "fonts", "assets", "src", "node_modules", "favicon.png", "__dev-ts.txt"]) {
      const root = rootOf([item("identity", { app: "nested data" }, name)]);
      const target = focus(root, "identity", ["app"]);
      expect((await locusAddressForScope(root, target, operate))).toBe(`/${name}/app`);
      expect((await locusAddressForScope(root, target, operate, undefined, undefined, true))).toBe("/_identity/app");
      expect((await resolve(root, "/_identity/app")).focus).toEqual(target);
      root.items.push(item("other", "collision", "_identity"));
      expect((await locusAddressForScope(root, target, operate, undefined, undefined, true))).toBeUndefined();
    }
  });
});

describe("canonical address traversal proves reader-independent namespaces conservatively", () => {
  test("the actual public demo address uses its authored parent and checked result", async () => {
    const { root } = await loadPublicBootstrap();
    const resolved = (await resolve(root, "/demo/Unfinished%20demos"));
    expect(resolved.missing).toBeUndefined();
    expect(resolved.focus).toEqual(focus(root, "demo", ["Unfinished demos"]));
    expect(resolved.readerIndependent).toBe(true);
    // A value inside a nested section resolves, but like every collection's
    // item it keeps its reader: only an authored root's own fields are proven.
    const nested = (await resolve(root, "/demo/Unfinished%20demos/Reversed%20shouting"));
    expect(nested.missing).toBeUndefined();
    expect(nested.focus).toEqual(focus(root, "demo", ["Unfinished demos", "Reversed shouting"]));
    expect(nested.readerIndependent).toBeUndefined();
    expect((await resolve(root, "/std/reverse")).readerIndependent).toBe(true);
    expect((await resolve(root, "/Demo")).readerIndependent).toBe(true);
  });

  test("different retained values cannot change direct authored names or field identities", async () => {
    const source = heldRecord([{ name: "named", value: literal("source value") }]);
    const root = rootOf([{ id: "record", caption: "record", source: { kind: "expr", expr: source }, valueType: recordType(["named"], ["field-id"]) }]);
    let childTypes = 0, externalExpressions = 0;
    const values: LocusAddressValues = {
      read: () => ({ value: { different: "another retained value", _field_id: "another name" } }),
      childType: () => { childTypes++; return recordType(["collision"], ["field-id"]); },
      expression: () => { externalExpressions++; return heldRecord([{ name: "external", value: literal("external") }]); },
    };
    for (const segments of [["record", "named"], ["record", "_field-id"]]) {
      expect((await resolveLocusAddress(root, segments, operate, values))).toEqual((await resolveLocusAddress(root, segments, operate)));
      expect((await resolveLocusAddress(root, segments, operate)).readerIndependent).toBe(true);
    }
    expect(childTypes).toBe(0); expect(externalExpressions).toBe(0);
  });

  test("nested, referenced, alias-typed and incomplete parents retain the original reader", async () => {
    const nested = heldRecord([{ name: "leaf", value: literal("source value") }]);
    const root = rootOf([{ id: "record", caption: "record", source: { kind: "expr", expr: heldRecord([{ name: "nested", value: nested }]) },
      valueType: { $record: { fields: [{ name: "nested", type: recordType(["leaf"]), label: nothing, ui: nothing, meta: {} }] } } }]);
    expect((await resolve(root, "/record/nested/leaf")).readerIndependent).toBeUndefined();
    root.items[0]!.valueType = { $ref: "NamedRecord" };
    expect((await resolve(root, "/record/nested")).readerIndependent).toBeUndefined();
    root.items[0]!.valueType = recordType([]);
    expect((await resolve(root, "/record/nested")).readerIndependent).toBeUndefined();
    root.expressions["saved"] = nested;
    root.items[0]!.source = { kind: "ref", ref: { kind: "savedExpr", id: "saved" } };
    root.items[0]!.valueType = recordType(["leaf"]);
    expect((await resolve(root, "/record/leaf")).readerIndependent).toBeUndefined();
    expect((await resolve(root, "/record/missing")).readerIndependent).toBeUndefined();
  });

  test("a successful raw computed-row name cannot bypass a typed identity collision", async () => {
    const root = rootOf([{ ...item("rows", [{ named: "first", _alias: "second" }], "rows"), valueType: List({ $ref: "Row" }) }]);
    const early = (await resolve(root, "/rows/1/_alias"));
    expect(early.missing).toBeUndefined();
    expect(early.readerIndependent).toBeUndefined();
    const complete = (await resolveLocusAddress(root, ["rows", "1", "_alias"], operate, {
      read: () => undefined,
      childType: () => recordType(["named", "_alias"], ["alias"]),
    }));
    expect(complete.missing).toBe("_alias");
    expect(complete.detail).toContain("more than one item");
    expect(complete.focus).toEqual(focus(root, "rows", [0]));
  });
});

// Exercise the real asynchronous address coordinator and the same canonical
// Fenel owner above. Only router/browser scheduling and reader acquisition are
// held; no matching result, focus or evaluator verdict is canned.
const coordinatorSource = await Bun.file(new URL("./workspace-address.ts", import.meta.url)).text();
const coordinatorCode = new Bun.Transpiler({ loader: "ts" }).transformSync(coordinatorSource)
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
function addressCoordinator(root: LocusRootData, path: string, suppliedValues: LocusAddressValues & { load?: (node: ExprNode) => Promise<void> },
  options: { holdValues?: Promise<void>; holdPrepare?: Promise<void>; holdFocus?: Promise<void>;
    refuseFocus?: () => boolean; holdOperation?: (operation: Parameters<LocusAddressOperate>[0]) => Promise<void> } = {}) {
  const location = { pathname: path, search: "", key: "first", state: undefined };
  const effects: Array<{ compute: () => any; apply: (value: any) => void }> = [];
  const cleanups: Array<() => void> = [];
  const counts = { prepare: 0, values: 0, loads: 0 };
  const focuses: Array<{ source: WorkspaceSource; focus: LocusScope }> = [];
  const failures: Array<string | undefined> = [];
  const navigations: string[] = [];
  const operations: string[] = [];
  let incarnation = 0;
  let currentRoot = root;
  let active: any;
  const bindings = {
    createSignal: (initial: unknown) => {
      let current = initial;
      return [() => current, (next: unknown) => { current = typeof next === "function" ? next(current) : next; }];
    },
    createEffect: (compute: () => any, apply: (value: any) => void) => { effects.push({ compute, apply }); },
    onCleanup: (cleanup: () => void) => { cleanups.push(cleanup); }, untrack: (read: () => unknown) => read(),
    useLocation: () => location, useNavigate: () => (path: string) => { navigations.push(path); },
    scopeFromWorkspace, workspaceSourceKey, parentScope, decodeLocusAddress, encodeLocusAddress,
    locusAddressForScope, resolveLocusAddress, locusSegmentUsesHostRoute,
  };
  const install = new Function(...Object.keys(bindings), `${coordinatorCode}; return installWorkspaceAddress;`)(...Object.values(bindings));
  const owner = install({ enabled: true, active: () => active, accounts: () => [{ id: "authorized", slug: "authorized" }],
    prepare: async () => { counts.prepare++; await options.holdPrepare; },
    root: async () => currentRoot,
    captureCurrent: (_source: WorkspaceSource, capturedRoot?: LocusRootData) => {
      const capturedIncarnation = incarnation;
      return () => {
        if (capturedIncarnation !== incarnation || capturedRoot && currentRoot !== capturedRoot)
          throw new Error("The selected reader or root was replaced.");
      };
    },
    operate: async (operation: Parameters<LocusAddressOperate>[0]) => {
      operations.push(operation.kind);
      const result = await operate(operation);
      await options.holdOperation?.(operation);
      return result;
    },
    values: async () => { counts.values++; await options.holdValues; return { ...suppliedValues, load: async (node: ExprNode) => {
      counts.loads++; await suppliedValues.load?.(node);
    } }; },
    focus: async (source: WorkspaceSource, selected: LocusScope, assertCurrent?: () => void) => {
      await options.holdFocus;
      assertCurrent?.();
      if (options.refuseFocus?.()) return false;
      focuses.push({ source, focus: selected }); active = { id: "focused", source, focus: scopeToWorkspace(selected) }; return true;
    }, failed: (message: string | undefined) => { failures.push(message); },
  });
  const start = () => { const effect = effects[0]!; effect.apply(effect.compute()); };
  return { owner, counts, focuses, failures, navigations, operations, start,
    outgoing: () => { const effect = effects[1]!; effect.apply(effect.compute()); },
    select: (source: WorkspaceSource, selected: LocusScope, subject?: unknown) => {
      active = { id: "focused", source, focus: scopeToWorkspace(selected), ...(subject ? { subject } : {}) };
    },
    replaceSubject: (subject: unknown) => { active = { ...active, subject }; },
    replaceReader: () => { incarnation++; },
    replaceRoot: () => { currentRoot = { ...currentRoot, revision: currentRoot.revision + 1 }; },
    republishRoot: () => { currentRoot = { ...currentRoot }; },
    close: () => { cleanups.forEach(cleanup => cleanup()); },
    navigate: (path: string) => { location.pathname = path; location.key = "later"; start(); } };
}
async function settleAddress() { for (let turn = 0; turn < 100; turn++) await Promise.resolve(); }
function addressGate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

describe("public address adapter acquisition follows canonical traversal proof", () => {
  test("the actual checked demo opens without acquiring the result-reader adapter", async () => {
    const { root } = await loadPublicBootstrap();
    const h = addressCoordinator(root, "/demo/Unfinished%20demos", { read: () => { throw new Error("Direct public fields cannot need another read"); } });
    h.start(); await settleAddress();
    expect(h.counts).toEqual({ prepare: 1, values: 0, loads: 0 });
    expect(h.focuses).toEqual([{ source: { $tag: "PublicSource" }, focus: focus(root, "demo", ["Unfinished demos"]) }]);
    expect(h.owner.initialLoading()).toBe(false); expect(h.failures).toEqual([undefined]); h.close();
  });

  test("typed computed aliases still acquire the reader and refuse the same collision", async () => {
    const root = rootOf([{ ...item("rows", [{ named: "first", _alias: "second" }], "rows"), valueType: List({ $ref: "Row" }) }]);
    let childTypes = 0;
    const h = addressCoordinator(root, "/rows/1/_alias", { read: () => undefined, childType: () => {
      childTypes++; return recordType(["named", "_alias"], ["alias"]);
    } });
    h.start(); await settleAddress();
    expect(h.counts).toEqual({ prepare: 1, values: 1, loads: 0 }); expect(childTypes).toBeGreaterThan(0);
    expect(h.focuses[0]!.focus).toEqual(focus(root, "rows", [0]));
    expect(h.failures[0]).toContain("more than one item"); h.close();
  });

  test("missing computed results still load through the same reader before acceptance", async () => {
    const producer: ExprNode = { kind: "call", fnId: "fixture:computed", args: [] };
    const root = rootOf([{ id: "computed", caption: "computed", source: { kind: "expr", expr: producer } }]);
    let completed = false;
    const h = addressCoordinator(root, "/computed/1", {
      read: node => node === producer && completed ? { value: ["first"] } : undefined,
      load: async node => { expect(node).toBe(producer); completed = true; },
    });
    h.start(); await settleAddress();
    expect(h.counts).toEqual({ prepare: 1, values: 1, loads: 1 });
    expect(h.focuses[0]!.focus).toEqual(focus(root, "computed", [0])); expect(h.failures).toEqual([undefined]); h.close();
  });

  test("account and temporary sources retain the existing reader even for direct fields", async () => {
    const root = rootOf([{ id: "record", caption: "record", source: { kind: "expr", expr: heldRecord([{ name: "leaf", value: literal("data") }]) },
      valueType: recordType(["leaf"]) }]);
    for (const [path, source] of [["/@authorized/record/leaf", { $tag: "AccountSource", accountId: "authorized" }],
      ["/~/record/leaf", { $tag: "ThisTabSource" }],
      ["/~tab/record/leaf", { $tag: "ThisTabSource" }]] as const) {
      const h = addressCoordinator(root, path, { read: () => undefined }); h.start(); await settleAddress();
      expect(h.counts.values).toBe(1); expect(h.focuses[0]!.source).toEqual(source); h.close();
    }
  });

  test("an unresolved public name does not turn a partial proof into acceptance", async () => {
    const { root } = await loadPublicBootstrap();
    const h = addressCoordinator(root, "/demo/no-such-field", { read: () => undefined }); h.start(); await settleAddress();
    expect(h.counts.values).toBe(1); expect(h.failures[0]).toContain("no-such-field");
    expect(h.focuses[0]!.focus).toEqual(focus(root, "demo")); h.close();
  });

  test("a retired address cannot accept a late reader or skip a changed source", async () => {
    const { root } = await loadPublicBootstrap();
    const held = addressGate();
    const h = addressCoordinator(root, "/demo/no-such-field", { read: () => undefined }, { holdValues: held.promise });
    h.start(); await settleAddress(); expect(h.counts.values).toBe(1);
    h.close(); held.release(); await settleAddress(); expect(h.focuses).toEqual([]); expect(h.failures).toEqual([]);
    const preparation = addressGate();
    const changed = addressCoordinator(root, "/demo/Unfinished%20demos/Reversed%20shouting", { read: () => undefined }, { holdPrepare: preparation.promise });
    changed.start(); changed.navigate("/@authorized/demo/Unfinished%20demos/Reversed%20shouting"); preparation.release(); await settleAddress();
    expect(changed.counts.values).toBe(1); expect(changed.focuses).toHaveLength(1);
    expect(changed.focuses[0]!.source).toEqual({ $tag: "AccountSource", accountId: "authorized" }); changed.close();
  });
});

describe("initial address source publication", () => {
  test("a same-revision Local root publication keeps the preview and reacquires the current URL", async () => {
    const root = rootOf([]), held = addressGate();
    const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE);
    h.start(); await settleAddress();
    expect(h.counts.values).toBe(1);
    h.republishRoot(); held.release(); await settleAddress();
    expect(h.focuses).toEqual([]); expect(h.failures).toEqual([]);
    expect(h.owner.initialLoading()).toBe(true);
    // Deliver the existing retry signal's effect (the harness owns scheduling).
    h.start(); await settleAddress();
    expect(h.focuses).toEqual([{ source: { $tag: "ThisTabSource" }, focus: ROOT_SCOPE }]);
    expect(h.owner.initialLoading()).toBe(false); expect(h.owner.initialFailure()).toBeUndefined(); h.close();
  });

  test("repeated source churn stops at visible Retry, which starts a fresh bounded attempt", async () => {
    const root = rootOf([]);
    let held = addressGate();
    const options = { holdValues: held.promise };
    const h = addressCoordinator(root, "/~", { read: () => undefined }, options);
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE);
    for (let attempt = 0; attempt < 3; attempt++) {
      h.start(); await settleAddress();
      h.republishRoot(); held.release(); await settleAddress();
      expect(h.focuses).toEqual([]); expect(h.failures).toEqual([]);
      expect(h.owner.initialLoading()).toBe(attempt < 2);
      held = addressGate(); options.holdValues = held.promise;
    }
    expect(h.owner.initialFailure()).toContain("kept changing");
    h.outgoing(); await settleAddress(); expect(h.navigations).toEqual([]);
    h.owner.retry(); h.start(); held.release(); await settleAddress();
    expect(h.focuses).toEqual([{ source: { $tag: "ThisTabSource" }, focus: ROOT_SCOPE }]);
    expect(h.owner.initialFailure()).toBeUndefined(); expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  test("a newer active lens is not replaced by an initial source retry", async () => {
    const root = rootOf([]), held = addressGate();
    const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE); h.start(); await settleAddress();
    h.republishRoot(); h.select({ $tag: "AccountSource", accountId: "authorized" }, ROOT_SCOPE);
    held.release(); await settleAddress();
    expect(h.focuses).toEqual([]); expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  for (const changed of ["lens", "subject"] as const) {
    test(`a ${changed} changed after queueing is newer than the initial source retry`, async () => {
      const root = rootOf([]), held = addressGate();
      const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
      h.select({ $tag: "PublicSource" }, ROOT_SCOPE, { $tag: "Nothing" }); h.start(); await settleAddress();
      h.republishRoot(); held.release(); await settleAddress();
      if (changed === "lens") h.select({ $tag: "AccountSource", accountId: "authorized" }, ROOT_SCOPE);
      else h.replaceSubject({ $tag: "Just", _0: { data: "newer" } });
      h.start(); await settleAddress();
      expect(h.focuses).toEqual([]); expect(h.owner.initialLoading()).toBe(false); h.close();
    });
  }

  test("explicit navigation releases an exhausted initial failure and publishes its own address", async () => {
    const root = rootOf([]);
    let held = addressGate();
    const options = { holdValues: held.promise };
    const h = addressCoordinator(root, "/~", { read: () => undefined }, options);
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE);
    for (let attempt = 0; attempt < 3; attempt++) {
      h.start(); await settleAddress(); h.republishRoot(); held.release(); await settleAddress();
      held = addressGate(); options.holdValues = held.promise;
    }
    h.outgoing(); await settleAddress(); expect(h.navigations).toEqual([]);
    h.owner.navigationStarted(); h.select({ $tag: "AccountSource", accountId: "authorized" }, ROOT_SCOPE);
    h.owner.navigated(); held.release(); h.outgoing(); await settleAddress();
    expect(h.owner.initialFailure()).toBeUndefined(); expect(h.navigations).toEqual(["/@authorized"]); h.close();
  });

  test("a cancelled queued source retry cannot resurrect its URL", async () => {
    const root = rootOf([]), held = addressGate();
    const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE); h.start(); await settleAddress();
    h.republishRoot(); held.release(); await settleAddress();
    expect(h.owner.initialLoading()).toBe(true);
    h.owner.navigationStarted(); h.select({ $tag: "AccountSource", accountId: "authorized" }, ROOT_SCOPE);
    h.start(); await settleAddress();
    expect(h.focuses).toEqual([]); expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  test("refused navigation resumes the initial URL when retries coalesce", async () => {
    const root = rootOf([]), held = addressGate();
    const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE); h.start(); await settleAddress();
    h.republishRoot(); held.release(); await settleAddress();
    const resume = h.owner.navigationStarted({ retainInitial: true });
    resume(); h.start(); await settleAddress();
    expect(h.focuses).toEqual([{ source: { $tag: "ThisTabSource" }, focus: ROOT_SCOPE }]);
    expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  test("a later route wins while the previous source retry is queued", async () => {
    const root = rootOf([]), held = addressGate();
    const h = addressCoordinator(root, "/~", { read: () => undefined }, { holdValues: held.promise });
    h.select({ $tag: "PublicSource" }, ROOT_SCOPE); h.start(); await settleAddress();
    h.republishRoot(); held.release(); await settleAddress();
    expect(h.owner.initialLoading()).toBe(true);
    h.navigate("/@authorized"); await settleAddress();
    expect(h.focuses).toEqual([{ source: { $tag: "AccountSource", accountId: "authorized" }, focus: ROOT_SCOPE }]);
    expect(h.owner.initialLoading()).toBe(false); h.close();
  });
});

describe("async address replies retain their captured navigation", () => {
  for (const kind of ["addressMemberIndex", "addressMemberSegment"] as const) {
    test(`a later route retires a delayed ${kind} reply`, async () => {
      const root = rootOf([item("first", "one", "first"), item("second", "two", "second")]);
      const held = addressGate();
      let waiting = true;
      const h = addressCoordinator(root, "/first", { read: () => undefined }, {
        holdOperation: async operation => {
          if (waiting && operation.kind === kind) { waiting = false; await held.promise; }
        },
      });
      h.start(); await settleAddress();
      expect(h.focuses).toEqual([]);
      h.navigate("/second"); await settleAddress();
      held.release(); await settleAddress();
      expect(h.focuses).toEqual([{ source: { $tag: "PublicSource" }, focus: focus(root, "second") }]);
      expect(h.failures).toEqual([undefined]); h.close();
    });
  }

  for (const replacement of ["reader", "root", "subject"] as const) {
    test(`a changed ${replacement} refuses an incoming member result`, async () => {
      const root = rootOf([item("child", "data", "child")]);
      const held = addressGate();
      const h = addressCoordinator(root, "/child", { read: () => undefined }, {
        holdOperation: async () => { await held.promise; },
      });
      h.select({ $tag: "PublicSource" }, ROOT_SCOPE, { $tag: "Nothing" });
      h.start(); await settleAddress();
      if (replacement === "reader") h.replaceReader();
      else if (replacement === "root") h.replaceRoot();
      else h.replaceSubject({ $tag: "Just", _0: { data: "changed" } });
      held.release(); await settleAddress();
      expect(h.focuses).toEqual([]); expect(h.failures).toEqual([]); h.close();
    });
  }

  test("the input guard stays live until the final focus mutation", async () => {
    const root = rootOf([item("child", "data", "child")]);
    const held = addressGate();
    const h = addressCoordinator(root, "/child", { read: () => undefined }, { holdFocus: held.promise });
    h.start(); await settleAddress();
    expect(h.operations).toEqual(["addressMemberIndex", "addressMemberSegment"]);
    h.replaceReader(); held.release(); await settleAddress();
    expect(h.focuses).toEqual([]); expect(h.failures).toEqual([]); h.close();
  });

  test("an intentional focus publication can acknowledge its own address", async () => {
    const root = rootOf([item("child", "data", "child")]);
    const h = addressCoordinator(root, "/child", { read: () => undefined });
    h.select({ $tag: "ThisTabSource" }, ROOT_SCOPE);
    h.start(); await settleAddress();
    expect(h.focuses).toEqual([{ source: { $tag: "PublicSource" }, focus: focus(root, "child") }]);
    expect(h.failures).toEqual([undefined]); expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  test("a later lens focus retires a delayed outgoing spelling", async () => {
    const root = rootOf([item("first", "one", "first"), item("second", "two", "second")]);
    const held = addressGate();
    let waiting = true;
    const h = addressCoordinator(root, "/app", { read: () => undefined }, {
      holdOperation: async operation => {
        if (waiting && operation.kind === "addressMemberSegment") { waiting = false; await held.promise; }
      },
    });
    h.select({ $tag: "ThisTabSource" }, focus(root, "first")); h.outgoing(); await settleAddress();
    h.select({ $tag: "ThisTabSource" }, focus(root, "second")); h.outgoing(); await settleAddress();
    held.release(); await settleAddress();
    expect(h.navigations).toEqual(["/~/second"]); expect(h.failures).toEqual([]); h.close();
  });

  test("a changed subject retires an outgoing spelling at the same focus", async () => {
    const root = rootOf([item("child", "data", "child")]);
    const held = addressGate();
    const h = addressCoordinator(root, "/app", { read: () => undefined }, {
      holdOperation: async () => { await held.promise; },
    });
    h.select({ $tag: "ThisTabSource" }, focus(root, "child"), { $tag: "Nothing" }); h.outgoing(); await settleAddress();
    h.replaceSubject({ $tag: "Just", _0: { data: "new subject" } }); held.release(); await settleAddress();
    expect(h.navigations).toEqual([]); expect(h.failures).toEqual([]); h.close();
  });

  test("ambiguous field admission awaits serialization before deciding", async () => {
    const root = rootOf([item("record", { ".": "data" }, "record")]);
    const held = addressGate();
    const h = addressCoordinator(root, "/app", { read: () => undefined }, {
      holdOperation: async () => { await held.promise; },
    });
    let completed = false;
    const pending = h.owner.permitsFocusAddress({ $tag: "ThisTabSource" }, focus(root, "record", ["."]))
      .then((permitted: boolean) => { completed = true; return permitted; });
    await settleAddress(); expect(completed).toBe(false);
    held.release(); expect(await pending).toBe(false);
    expect(h.failures).toEqual(["This field needs an unambiguous identity address before it can be opened."]); h.close();
  });

  test("a refused focus waits for the retained lens address before restoring history", async () => {
    const root = rootOf([item("first", "one", "first"), item("second", "two", "second")]);
    const held = addressGate();
    const h = addressCoordinator(root, "/second", { read: () => undefined }, {
      refuseFocus: () => true,
      holdOperation: async operation => {
        if (operation.kind === "addressMemberSegment" && operation.args[1] === 0) await held.promise;
      },
    });
    h.select({ $tag: "ThisTabSource" }, focus(root, "first")); h.start(); await settleAddress();
    expect(h.navigations).toEqual([]); expect(h.owner.initialLoading()).toBe(true);
    held.release(); await settleAddress();
    expect(h.navigations).toEqual(["/~/first"]);
    expect(h.failures).toEqual(["Save or discard your pending changes before opening another data address."]);
    expect(h.owner.initialLoading()).toBe(false); h.close();
  });

  test("a newer route retires a delayed retained-lens restoration", async () => {
    const root = rootOf([item("first", "one", "first"), item("second", "two", "second")]);
    const held = addressGate();
    let refuse = true, waiting = true;
    const h = addressCoordinator(root, "/second", { read: () => undefined }, {
      refuseFocus: () => { const answer = refuse; refuse = false; return answer; },
      holdOperation: async operation => {
        if (waiting && operation.kind === "addressMemberSegment" && operation.args[1] === 0) {
          waiting = false; await held.promise;
        }
      },
    });
    h.select({ $tag: "ThisTabSource" }, focus(root, "first")); h.start(); await settleAddress();
    h.navigate("/first"); await settleAddress(); held.release(); await settleAddress();
    expect(h.navigations).toEqual([]);
    expect(h.focuses).toEqual([{ source: { $tag: "PublicSource" }, focus: focus(root, "first") }]);
    expect(h.failures).toEqual([undefined]); h.close();
  });
});
