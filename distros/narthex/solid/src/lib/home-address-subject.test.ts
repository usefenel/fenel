import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LayoutItem } from "./locus-view-model";
import type { LocusScope } from "./locus-scope";
import { expressionAt, type ExpressionEditOptions } from "./locus-expression-edit";
import { readLocusCatalogReference } from "./locus-catalog-reference";

// Existing C1 tooling boundary. Execute Home's actual selection/projection
// source with its real DOM-free data owners; importing Home would prepare the
// complete engine. Reader declarations and the evaluated fallback are held
// interfaces, not another expression interpreter or an authority fixture.
const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
const views = await Bun.file(new URL("./locus-view-model.ts", import.meta.url)).text();
function declaration(source: string, marker: string): string {
  const start = source.indexOf(marker);
  const end = source.indexOf("\n}", start);
  if (start < 0 || end < start) throw new Error(`Address subject regression boundary changed: ${marker}`);
  return source.slice(start, end + 2).replace(/^export /, "");
}
const memoStart = home.indexOf("  const addressExpressionSubject = createMemo");
const memoEnd = home.indexOf("\n  });", memoStart);
if (memoStart < 0 || memoEnd < memoStart) throw new Error("Home's address subject memo changed");
const actual = new Bun.Transpiler({ loader: "ts" }).transformSync([
  declaration(home, "function projectAuthoredExpression("),
  declaration(home, "function itemExpression("),
  declaration(home, "function itemFunction("),
  declaration(home, "function resolveExpr("),
  declaration(home, "function focusedLocusItem("),
  declaration(home, "function findLocusItem("),
  declaration(views, "export function asView("),
  home.slice(memoStart, memoEnd + "\n  });".length),
].join("\n"));
type Selected = { item: LayoutItem; evaluated?: { value: unknown; source?: ExprNode } } | undefined;
type Declaration = { id: string; reader: string };
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const fields = (...entries: Array<[string, ExprNode]>): ExprNode => literal({
  __record: { fields: entries.map(([name, value]) => ({ name, value })) },
});
const chosen = (path: Array<string | number> = []): LocusScope => ({
  kind: "value", viewId: "current-root", itemId: "std", path, rootItem: true,
});
function fixture(options: {
  expression?: ExprNode;
  path?: Array<string | number>;
  functions?: readonly Declaration[];
  fallback?: Selected;
  fallbackMustNotRun?: boolean;
  requested?: boolean;
  missingRow?: boolean;
  missingItem?: boolean;
  saved?: Map<string, ExprNode>;
  savedRoot?: string;
  editOptions?: ExpressionEditOptions;
} = {}) {
  const lookups: string[] = [];
  let fallbackCalls = 0, scopeReads = 0;
  const functions = new Map((options.functions ?? [{ id: "selected-uuid", reader: "current" }]).map(fn => [fn.id, fn]));
  const saved = options.saved ?? new Map<string, ExprNode>();
  const item: LayoutItem = { id: "std", caption: "Standard library",
    representations: { Labelable: { label: "Parent label" } },
    source: options.savedRoot ? { kind: "ref", ref: { kind: "savedExpr", id: options.savedRoot } }
      : { kind: "expr", expr: options.expression ?? fields(["reverse", literal({ $ref: "selected-uuid" })]) } };
  const row = { id: "current-root", view: { kind: "list", items: options.missingItem ? [] : [item] } };
  const session = { registry: { getFunction: (id: string) => { lookups.push(id); return functions.get(id); } } };
  const bindings = {
    expressionAt, readLocusCatalogReference,
    createMemo: <T>(compute: () => T) => compute,
    props: { pane: { addressInputs: () => options.requested === false ? undefined : { id: 1 } } },
    scope: () => { scopeReads++; return chosen(options.path ?? ["reverse"]); },
    rowById: (id: string) => options.missingRow || id !== row.id ? undefined : row,
    viewPersistence: { read: (id: string, view: unknown) => { expect(id).toBe(row.id); return view; } },
    savedExprById: () => saved,
    expressionEditOptions: () => options.editOptions ?? {},
    homeAuthoringSession: () => session,
    scopeLabel: (scope: Extract<LocusScope, { kind: "value" }>) => String(scope.path.at(-1)),
    EMPTY_CANVAS: { kind: "canvas", items: [] },
    lensExpressionSubject: () => {
      fallbackCalls++;
      if (options.fallbackMustNotRun) throw new Error("An authored function reference must not wait for parent evaluation");
      return options.fallback;
    },
    expressionForTransfer: () => { throw new Error("Static selection must not rebuild data from an evaluated result"); },
    classifyData: () => { throw new Error("Static function references need no value classification"); },
    // B4 wave 4 lane H: the Local branches (these are page readers).
    reader: undefined,
    authoringStructureEnvironment: () => { throw new Error("Static selection must not rebuild data from an evaluated result"); },
    resolveLocusCatalogReference: () => { throw new Error("A page reader reads its own registry"); },
  };
  const owner = new Function(...Object.keys(bindings), `${actual}; return { select: addressExpressionSubject, itemFunction, projectAuthoredExpression };`)(...Object.values(bindings)) as {
    select: () => Selected;
    itemFunction: (item: LayoutItem, saved: Map<string, ExprNode>, captured: typeof session) => Declaration | undefined;
    projectAuthoredExpression: (source: ExprNode, path: readonly (string | number)[], edit: ExpressionEditOptions) => { source: ExprNode; sourcePath: readonly (string | number)[] };
  };
  return { ...owner, session, saved, lookups, fallbackCalls: () => fallbackCalls, scopeReads: () => scopeReads };
}

describe("named address Call selects authored function data before parent computation", () => {
  test("an exact nested function reference skips computed siblings and the evaluated lens", () => {
    const reference = literal({ $ref: "selected-uuid" });
    const expensive: ExprNode = { kind: "call", fnId: "unrelated-producer", args: [] };
    const root = fields(["nested", fields(["reverse", reference], ["unrelated", expensive])]);
    const h = fixture({ expression: root, path: ["nested", "reverse"], fallbackMustNotRun: true });
    const selected = h.select();
    expect(selected?.item.source).toEqual({ kind: "expr", expr: reference });
    expect(selected?.item.source?.kind === "expr" && selected.item.source.expr).toBe(reference);
    expect(selected?.item.caption).toBe("reverse");
    expect(selected?.item.representations).toBeUndefined();
    expect(h.lookups).toEqual(["selected-uuid"]);
    expect(h.fallbackCalls()).toBe(0);
    expect(h.projectAuthoredExpression(root, ["nested", "reverse"], {})).toEqual({ source: reference, sourcePath: [] });
  });

  test("the same reference is resolved only by the current reader's declaration", () => {
    for (const reader of ["reader-a", "reader-b"]) {
      const fn = { id: "selected-uuid", reader };
      const h = fixture({ functions: [fn], fallbackMustNotRun: true });
      const selected = h.select()!;
      expect(h.itemFunction(selected.item, h.saved, h.session)).toBe(fn);
      expect(h.lookups).toEqual(["selected-uuid", "selected-uuid"]);
    }
    const fallback: Selected = { item: { id: "waiting-for-current-data" } };
    const foreign = fixture({ functions: [{ id: "different-uuid", reader: "foreign" }], fallback });
    expect(foreign.select()).toBe(fallback);
    expect(foreign.lookups).toEqual(["selected-uuid"]);
  });

  test("a saved container uses this reader's saved map without an evaluator", () => {
    const reference = literal({ $ref: "selected-uuid" });
    const h = fixture({ savedRoot: "current-saved", saved: new Map([["current-saved", fields(["reverse", reference])]]), fallbackMustNotRun: true });
    expect(h.select()?.item.source).toEqual({ kind: "expr", expr: reference });
    expect(h.fallbackCalls()).toBe(0);
    const missing = fixture({ savedRoot: "other-reader-saved" });
    expect(missing.select()).toBeUndefined();
    expect(missing.lookups).toEqual([]);
  });

  test("a known parent function with a residual result path cannot replace the result's function", () => {
    const producer = literal({ $ref: "selected-uuid" });
    const fallback: Selected = { item: { id: "computed-function", source: { kind: "expr", expr: literal({ $ref: "result-uuid" }) } } };
    const h = fixture({ expression: producer, path: ["missing"], fallback });
    expect(h.projectAuthoredExpression(producer, ["missing"], {})).toEqual({ source: producer, sourcePath: ["missing"] });
    expect(h.select()).toBe(fallback);
    expect(h.lookups).toEqual([]);
    expect(h.fallbackCalls()).toBe(1);
  });

  test("computed fields retain the evaluated fallback; only declared constructors expose authored fields", () => {
    const reference = literal({ $ref: "selected-uuid" });
    const call: ExprNode = { kind: "call", fnId: "current-constructor", args: [reference] };
    const fallback: Selected = { item: { id: "computed-child" } };
    const computed = fixture({ expression: call, path: ["selected"], fallback });
    expect(computed.select()).toBe(fallback);
    expect(computed.lookups).toEqual([]);
    const constructor = fixture({ expression: call, path: ["selected"], fallbackMustNotRun: true,
      editOptions: { constructorFields: id => id === call.fnId ? ["selected"] : undefined } });
    expect(constructor.select()?.item.source).toEqual({ kind: "expr", expr: reference });
    expect(constructor.fallbackCalls()).toBe(0);
  });

  test("missing scopes and fields stay unavailable without selecting a neighbour", () => {
    for (const options of [{ missingRow: true }, { missingItem: true }, { path: ["not-present"] }]) {
      const h = fixture(options);
      expect(h.select()).toBeUndefined();
      expect(h.lookups).toEqual([]);
      expect(h.fallbackCalls()).toBe(1);
    }
    const inactive = fixture({ requested: false, fallbackMustNotRun: true });
    expect(inactive.select()).toBeUndefined();
    expect(inactive.scopeReads()).toBe(0);
    expect(inactive.fallbackCalls()).toBe(0);
  });

  test("inherited references, accessors and records with extra data cannot impersonate function data", () => {
    let getterReads = 0;
    const accessor = Object.defineProperty({}, "$ref", { enumerable: true, get: () => { getterReads++; return "selected-uuid"; } });
    for (const value of [Object.create({ $ref: "selected-uuid" }), accessor, { $ref: "selected-uuid", extra: "data" }]) {
      const h = fixture({ expression: fields(["reverse", literal(value)]) });
      expect(h.select()).toBeUndefined();
      expect(h.lookups).toEqual([]);
      expect(h.fallbackCalls()).toBe(1);
    }
    const inherited = fixture({ expression: literal(Object.create({ reverse: { $ref: "selected-uuid" } })) });
    expect(inherited.select()).toBeUndefined();
    expect(inherited.lookups).toEqual([]);
    expect(getterReads).toBe(0);
  });
});
