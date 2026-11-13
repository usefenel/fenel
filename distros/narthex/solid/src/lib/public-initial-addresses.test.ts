import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LocusRootData } from "./locus-root-data";
import type { LayoutItem } from "./locus-view-model";
import type { WorkspaceModel } from "./workspace-model-loader";
import { resolveLocusAddress, type LocusAddressOperate } from "./locus-address";
import { loadPublicBootstrap, readPublicInitialAddress } from "./public-bootstrap";
import { admitPublicInitialAddresses, PUBLIC_INITIAL_ADDRESSES_SCHEMA, publicInitialAddressKey,
  type PublicInitialAddresses } from "./public-initial-addresses";
import { projectPublicInitialAddresses } from "./public-initial-address-projection";

// C1: the build's address record is produced by the production resolver with the
// CURRENT Fenel address owner (the same single-module harness as
// locus-address.test.ts; no registry). The page side is exact lookup only.
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
const section = (fields: Record<string, ExprNode>): ExprNode =>
  literal({ __record: { fields: Object.entries(fields).map(([name, value]) => ({ name, value })) } });
const call: ExprNode = { kind: "call", fnId: "fixture:computed", args: [] };
function item(id: string, expr: ExprNode, caption?: string, codeName?: string): LayoutItem {
  return { id, caption, source: { kind: "expr", expr }, ...(codeName ? { representations: { Codeable: { codeName } } } : {}) };
}
function rootOf(items: LayoutItem[], lists: LocusRootData["lists"] = []): LocusRootData {
  return { id: "public-fixture", name: "Fenel", type: { $ref: "Any" },
    expr: literal({ __list: items.map(entry => entry.source?.kind === "expr" ? entry.source.expr : literal(undefined)) }),
    revision: 0, persisted: false, canEdit: false, layout: { kind: "grid" }, items, lists,
    expressions: {}, referenceId: "locus:public-fixture" };
}
const place = (itemId: string, ...path: string[]) => ({ kind: "value" as const, viewId: "public-fixture", itemId, path, rootItem: true });
const demo = section({
  "Tree of life": section({ "Tree of life": call, "Every species": literal([1, 2, 3]), "Plain record": literal({ name: "inert data" }) }),
  "Unfinished demos": section({ Axioms: section({ Lattice: literal("x"), Deeper: section({ "Too deep": literal(1) }) }) }),
  "Computed section": call,
  "A/B and spaces": literal(1),
});
const fixture = () => rootOf([
  item("demo", demo, "Demo", "demo"),
  item("std", section({ abs: literal(1), add: literal(2), all: literal(3) }), "Standard library", "std"),
  // Two items that share a caption and have no code name: the owner refuses the name, so no row names them.
  item("twin-a", literal(1), "Twin"), item("twin-b", literal(2), "Twin"),
  // Its name is the spelling of another item's position: the owner calls that ambiguous.
  item("numbered", literal(3), "1"),
]);
const digests = { sourceDigest: "exact source", identityDigest: "exact identity" };
const record = (root: LocusRootData, entries: PublicInitialAddresses["entries"]): PublicInitialAddresses =>
  ({ schema: PUBLIC_INITIAL_ADDRESSES_SCHEMA, ...digests, rootId: root.id, entries });

describe("the build's address record holds only the address owner's own answers", () => {
  test("names the root itself shows, through authored sections, to the page depth", async () => {
    const root = fixture();
    const { entries, skipped } = await projectPublicInitialAddresses(root, operate);
    expect(skipped).toEqual([]);
    expect(entries.map(entry => JSON.stringify(entry.segments)).sort()).toEqual([
      ["Demo"], ["Standard library"],
      ["demo"], ["demo", "A/B and spaces"], ["demo", "Computed section"], ["demo", "Tree of life"],
      ["demo", "Tree of life", "Every species"], ["demo", "Tree of life", "Plain record"], ["demo", "Tree of life", "Tree of life"],
      ["demo", "Unfinished demos"], ["demo", "Unfinished demos", "Axioms"],
      ["demo", "Unfinished demos", "Axioms", "Deeper"], ["demo", "Unfinished demos", "Axioms", "Lattice"],
      ["std"], ["std", "abs"], ["std", "add"], ["std", "all"],
    ].map(segments => JSON.stringify(segments)).sort());
    // Every row is exactly what the production resolver answers for those segments.
    for (const entry of entries) {
      const resolved = await resolveLocusAddress(root, entry.segments, operate);
      expect(resolved.missing).toBeUndefined();
      expect(resolved.focus).toEqual(entry.focus);
    }
    expect(entries.find(entry => entry.segments.join("/") === "demo/Tree of life/Tree of life")!.focus).toEqual(place("demo", "Tree of life", "Tree of life"));
    expect(entries.find(entry => entry.segments.join("/") === "Demo")!.focus).toEqual(place("demo"));
  });

  test("a computed or plain-data parent, a fifth step and an alias prefix are left to the reader", async () => {
    const paths = (await projectPublicInitialAddresses(fixture(), operate)).entries.map(entry => entry.segments.join("/"));
    expect(paths.some(path => path.startsWith("demo/Computed section/"))).toBe(false);
    expect(paths.some(path => path.startsWith("demo/Tree of life/Plain record/"))).toBe(false);
    expect(paths.some(path => path.startsWith("demo/Unfinished demos/Axioms/Deeper/"))).toBe(false);
    expect(paths.some(path => path.startsWith("Demo/"))).toBe(false);
  });

  test("identity, position, ambiguous and unknown spellings never enter the record although the owner may resolve them", async () => {
    const root = fixture();
    const index = admitPublicInitialAddresses(root, record(root, (await projectPublicInitialAddresses(root, operate)).entries), digests)!;
    expect(index).toBeDefined();
    for (const [segments, resolves] of [[["_demo"], true], [["2"], true], [["_twin-a"], true], [["Twin"], false], [["1"], false],
      [["demo", "tree of life"], false], [["demo", "Tree of life "], false], [["demo", "1"], false], [["missing"], false]] as const) {
      expect((await resolveLocusAddress(root, segments, operate)).missing === undefined, segments.join("/")).toBe(resolves);
      expect(index.get(publicInitialAddressKey(segments)), segments.join("/")).toBeUndefined();
    }
    expect(index.get(publicInitialAddressKey(["demo", "Tree of life"]))).toEqual(place("demo", "Tree of life"));
  });

  test("a namespace over the limit keeps its reader and is reported", async () => {
    const { entries, skipped } = await projectPublicInitialAddresses(fixture(), operate, { depth: 4, level: 3 });
    // The root has five items and the demo four sections: neither is listed; nothing is guessed instead.
    expect(skipped).toEqual([[]]); expect(entries).toEqual([]);
    const limited = await projectPublicInitialAddresses(rootOf([item("demo", demo, "Demo", "demo")]), operate, { depth: 2, level: 4 });
    expect(limited.skipped).toEqual([]);
    expect(limited.entries.map(entry => entry.segments.length).every(length => length <= 2)).toBe(true);
    expect(limited.entries.some(entry => entry.segments.join("/") === "demo/Tree of life")).toBe(true);
  });

  test("a listed root row is a view, which this record does not carry", async () => {
    const listed = item("rows", literal({ __list: [] }), "Rows", "rows");
    const root = rootOf([item("demo", demo, "Demo", "demo"), listed], [{ id: "rows", name: "Rows", active: false,
      view: { kind: "list", items: [] }, referenceId: "locus:rows", sourceReferenceId: "locus:rows", rootRevision: 0,
      valueType: { $ref: "Any" }, derivedCanvas: false }] as unknown as LocusRootData["lists"]);
    const paths = (await projectPublicInitialAddresses(root, operate)).entries.map(entry => entry.segments.join("/"));
    expect(paths).toContain("demo"); expect(paths.some(path => path === "rows" || path === "Rows")).toBe(false);
  });
});

describe("the page admits a whole record of its own checked root, or none of it", () => {
  test("another build, another root, an editable root and unreadable rows are refused", async () => {
    const root = fixture();
    const entries = (await projectPublicInitialAddresses(root, operate)).entries;
    const good = record(root, entries);
    expect(admitPublicInitialAddresses(root, good, digests)?.size).toBe(entries.length);
    const row = { segments: ["demo", "Tree of life"], focus: place("demo", "Tree of life") };
    const refused: unknown[] = [
      undefined, null, [], "record", { ...good, schema: "fenel.public-initial-addresses.v0" },
      { ...good, sourceDigest: "other source" }, { ...good, identityDigest: "other identity" }, { ...good, rootId: "other-root" },
      { ...good, entries: undefined }, { ...good, entries: [...entries, entries[0]] },
      ...[{ ...row, segments: [] }, { ...row, segments: ["demo", ""] }, { ...row, segments: ["demo", 1] }, { ...row, focus: undefined },
        { ...row, focus: { kind: "root" } }, { ...row, focus: { kind: "view", viewId: "demo" } },
        { ...row, focus: { ...row.focus, viewId: "other-root" } }, { ...row, focus: { ...row.focus, itemId: "missing" } },
        { ...row, focus: { ...row.focus, rootItem: false } }, { ...row, focus: { ...row.focus, path: [0] } },
        { ...row, focus: { ...row.focus, path: ["Solver"] } }, { ...row, focus: { ...row.focus, path: ["Tree of life", "extra"] } },
        { ...row, focus: { ...row.focus, passThrough: [0] } }, { ...row, focus: Object.assign(Object.create({ kind: "value" }), row.focus) },
      ].map(bad => ({ ...good, entries: [bad] })),
    ];
    for (const candidate of refused) expect(admitPublicInitialAddresses(root, candidate, digests), JSON.stringify(candidate)?.slice(0, 120)).toBeUndefined();
    expect(admitPublicInitialAddresses({ ...root, canEdit: true }, good, digests)).toBeUndefined();
    expect(admitPublicInitialAddresses({ ...root, persisted: true }, good, digests)).toBeUndefined();
    const admitted = admitPublicInitialAddresses(root, good, digests)!.get(publicInitialAddressKey(row.segments))!;
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(admitted).not.toBe(entries.find(entry => entry.segments.join("/") === "demo/Tree of life")!.focus);
  });
});

describe("the bundled public snapshot", () => {
  test("its record, when present, equals a fresh projection; only its own root may read it", async () => {
    const snapshot = await loadPublicBootstrap();
    const { entries, skipped } = await projectPublicInitialAddresses(snapshot.root, operate);
    // The demo sections and their members are listed; the standard library's members keep the reader.
    const paths = new Set(entries.map(entry => entry.segments.join("/")));
    expect(paths.has("demo")).toBe(true); expect(paths.has("std")).toBe(true);
    expect(skipped).toEqual([["std"]]);
    expect(entries.filter(entry => entry.segments[0] === "demo" && entry.segments.length >= 3).length).toBeGreaterThan(100);
    for (const entry of entries) expect((await resolveLocusAddress(snapshot.root, entry.segments, operate)).focus).toEqual(entry.focus);
    if (snapshot.initialAddresses) {
      expect(snapshot.initialAddresses.entries).toEqual(entries);
      for (const entry of entries) expect(readPublicInitialAddress(snapshot.root, entry.segments)).toEqual(entry.focus);
      expect(readPublicInitialAddress({ ...snapshot.root }, ["demo"])).toBeUndefined();
      expect(readPublicInitialAddress(snapshot.root, [])).toBeUndefined();
      expect(readPublicInitialAddress(snapshot.root, ["_demo"])).toBeUndefined();
      expect(readPublicInitialAddress(snapshot.root, ["std", "abs"])).toBeUndefined();
    } else {
      // A snapshot generated before this record existed gives no early page at all.
      expect(readPublicInitialAddress(snapshot.root, ["demo"])).toBeUndefined();
    }
  }, 120_000);
});
