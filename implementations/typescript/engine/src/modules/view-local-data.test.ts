import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { pictureModule } from "./picture";
import { viewModule } from "./view";
import { engineModule } from "./engine";
import { Anything, List, Rational } from "../type-foundation";
import { exprNodeToLogic, type ExprNode } from "../authoring/expression-authoring";
import { placedListType } from "../authoring/locus-canvas";
import type { FenelType } from "../types";
import { typeToSetExpr } from "../fenel-check";
import { contains } from "../set-algebra";
import { loadFenelModule } from "../fenel-module";

const context = createRegistry([stdModule, pictureModule, viewModule]).evaluateContext();
type Entry = { id: string; value: Record<string, unknown> };
type State = {
  tabId: string; revision: number; entries: Entry[]; values: Entry[]; representations: Entry[];
  layout: Record<string, unknown>; definitions: unknown;
};
type Result<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };

function call<T = unknown>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
const empty = () => call<State>("defaultTabData", "tab-identity", { kind: "grid" });
function edit(state: State, revision: number, commands: unknown[]): Result<State> {
  return call("applyTabDataCommands", state, revision, commands);
}
function accepted(result: Result<State>): State {
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}
const append = (collection: "Entries" | "Values" | "Representations", entry: Entry) =>
  ({ $tag: `TabEdit${collection}`, commands: [{ $tag: "LocusAppend", entry }] });

describe("Fenel tab-local data", () => {
  test("recipe copies retain the complete lambda, unused parameters and lexical captures without invoking it", () => {
    const copyContext = createRegistry([stdModule, pictureModule, viewModule, engineModule]).evaluateContext();
    const copy = (outcome: unknown) => evaluate({ call: ["view:recipeDemoFunctionExpression", { var: "outcome" }] },
      { outcome }, copyContext);
    const body = { $tag: "ECall", fnId: "never:invoke", args: [{ $tag: "EVar", name: "kept" }] };
    const packageValue = { $tag: "ReifiedFunction", params: ["pantry", "unused"], body,
      captures: [{ $tag: "ReifiedCapture", name: "kept", value: 7, origin: { $tag: "DefinitionLexical" } }],
      source: { $tag: "NamedDefinition", identity: "source-recipe" }, dependencies: [], constructors: [],
      generation: { $tag: "Just", _0: 3 } };
    expect(copy({ $tag: "Reified", package: packageValue })).toEqual({ $tag: "Ok", _0: {
      $tag: "ECall", fnId: "$", args: [
        { $tag: "ELambda", params: ["kept"], body: { $tag: "ELambda", params: ["pantry", "unused"], body } },
        { $tag: "ELit", value: 7 },
      ],
    } });
    for (const outcome of [{ $tag: "Unavailable" }, { $tag: "OpaqueBody", identity: "opaque", params: ["pantry"] }]) {
      expect(copy(outcome)).toMatchObject({ $tag: "Err" });
    }
    expect(packageValue.body).toEqual(body);
    expect(packageValue.captures[0]!.value).toBe(7);
  });

  test("recipe starter keeps authored calls separate and a saved lambda edit recomputes every dependent", () => {
    const probe = loadFenelModule(String.raw`
module RecipeStarterFixture where
using std (length, fold)
numberOfPreparations : (recipe: List Number -> List (List Number)) -> (pantry: List Number) -> Nat
numberOfPreparations recipe pantry = length (recipe pantry)
numberOfIngredients : (recipe: List Number -> List (List Number)) -> (pantry: List Number) -> Nat
numberOfIngredients recipe pantry = fold (\count ingredients -> count + length ingredients) 0 (recipe pantry)
`, "RecipeStarterFixture");
    const reader = createRegistry([stdModule, pictureModule, viewModule, engineModule, probe]).evaluateContext();
    const identity = (value: string) => ({ value, item: value + "-item" });
    const identities = [{ recipe: identity("recipe"), pantries: identity("pantries"),
      analyses: [identity("count"), identity("ingredients")] }];
    const lambda = (value: number[][]): ExprNode => ({ kind: "literal", value: {
      __lambda: { params: ["pantry"], body: { kind: "literal", value } },
    } });
    const pantryType = List(Rational);
    const resultType = List(pantryType);
    const recipeType: FenelType = { $arrow: { params: [{ name: "pantry", type: pantryType,
      label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }], returns: resultType } };
    const criteria = [
      { name: "Number of preparations", fnId: "RecipeStarterFixture:numberOfPreparations", resultType: Rational },
      { name: "Number of ingredients", fnId: "RecipeStarterFixture:numberOfIngredients", resultType: Rational },
    ];
    const expressionType = call<FenelType>("recipeDemoCopiedExpressionType");
    const plan = call<Result<{ commands: unknown[] }>>("recipeDemoCommands", identities, [{
      name: "Recipe fixture", expression: lambda([[1]]), recipeType, pantries: [], pantriesType: pantryType,
    }], criteria, expressionType, pantryType);
    if (plan.$tag !== "Ok") throw new Error(plan._0);
    const kept = { id: "kept", value: { id: "kept", source: { kind: "expr", expr: { kind: "literal", value: "Existing data" } } } };
    const original = accepted(edit(empty(), 0, [append("Entries", kept)]));
    const initial = accepted(edit(original, original.revision, plan._0.commands));
    const read = (state: State, id: string) => {
      const saved = new Map(state.values.map(entry => [entry.id, (entry.value.query as { expr: ExprNode }).expr]));
      return evaluate(exprNodeToLogic({ kind: "ref", savedExprId: id }, { resolver: key => saved.get(key) }), {}, reader);
    };
    expect(initial.entries[0]).toEqual(kept);
    expect(initial.values).toHaveLength(4);
    expect(initial.values.map(entry => entry.value.name)).toEqual([
      "Recipe fixture", "Recipe fixture · foods",
      "Recipe fixture · Number of preparations", "Recipe fixture · Number of ingredients",
    ]);
    expect(read(initial, "pantries")).toEqual([]);
    expect(read(initial, "count")).toBe(1);
    expect(read(initial, "ingredients")).toBe(1);
    for (const id of ["count", "ingredients"]) {
      const query = initial.values.find(entry => entry.id === id)!.value.query as { expr: ExprNode };
      expect(query.expr).toMatchObject({ kind: "call", args: [{ kind: "ref", savedExprId: "recipe" }, { kind: "ref", savedExprId: "pantries" }] });
    }
    const changed = accepted(edit(initial, initial.revision, [{ $tag: "TabPatchValue", id: "recipe",
      patch: { query: { kind: "expression", expr: lambda([[1, 2], [3]]), valueType: recipeType } } }]));
    expect(read(changed, "count")).toBe(2);
    expect(read(changed, "ingredients")).toBe(3);
    expect(changed.values.slice(1)).toEqual(initial.values.slice(1));
    expect(changed.entries).toEqual(initial.entries);
    expect(edit(changed, changed.revision, plan._0.commands).$tag).toBe("Err");
    expect(call<Result<unknown>>("recipeDemoCommands", [], [{
      name: "Recipe fixture", expression: lambda([[1]]), recipeType, pantries: [], pantriesType: pantryType,
    }], criteria, expressionType, pantryType).$tag).toBe("Err");
  });

  test("source projection reads an exact captured reference without evaluating calls or quoted data", () => {
    const source: ExprNode = { kind: "literal", value: { __list: [
      { kind: "ref", savedExprId: "source" }, { kind: "ref", savedExprId: "double" },
    ] } };
    const computed: ExprNode = { kind: "call", fnId: "never:invoke", args: [] };
    const quoted: ExprNode = { kind: "literal", value: { kind: "ref", savedExprId: "unavailable", __list: [] } };
    const captured = { list: source, alias: { kind: "ref", savedExprId: "list" },
      computed, quoted, cycle: { kind: "ref", savedExprId: "cycle" },
      crossed: { kind: "ref", savedExprId: "other" }, other: { kind: "ref", savedExprId: "crossed" } };
    const read = (identity: string) => call("sourceExpressionFromSnapshot", captured, { kind: "ref", savedExprId: identity });
    expect(read("list")).toEqual({ $tag: "Just", _0: source });
    expect(read("computed")).toEqual({ $tag: "Just", _0: computed });
    expect(read("quoted")).toEqual({ $tag: "Just", _0: quoted });
    for (const identity of ["missing", "alias", "cycle", "crossed"]) expect(read(identity)).toEqual({ $tag: "Nothing" });
    expect(call<unknown>("sourceExpressionFromSnapshot", captured, { kind: "ref" })).toEqual({ $tag: "Nothing" });
    expect(call<unknown>("sourceExpressionFromSnapshot", captured, { kind: "ref", savedExprId: 1 })).toEqual({ $tag: "Nothing" });
    expect(captured.list).toBe(source);
  });

  test("the linked demo appends atomically and recalculates canonical refs without replacing identities or other data", () => {
    const identities = { source: "source", doubled: "double", result: "result", list: "list", canvas: "canvas",
      sourceItem: "source-item", doubledItem: "double-item", resultItem: "result-item", listItem: "list-item", canvasItem: "canvas-item" };
    const heads = { multiply: context.getFunction!("std:mul")!.id, add: context.getFunction!("std:add")!.id,
      placeAll: context.getFunction!("view:placeAll")!.id };
    const plan = call<{ commands: unknown[]; canvasItem: Record<string, unknown> }>("linkedDemoCommands", identities, heads,
      Rational, List(Rational), placedListType(Rational));
    const schema = call<FenelType>("linkedDemoCommandsType", Rational, List(Rational), placedListType(Rational));
    if (!("$record" in schema)) throw new Error("The starter did not return its actual record schema.");
    const commandsType = schema.$record.fields.find(field => field.name === "commands")!.type;
    if (!("$el" in commandsType)) throw new Error("The command list application lost its Type payload.");
    const listCall = commandsType.$el as { call: unknown[] };
    expect(listCall.call[0]).toBe("List");
    const commandCall = (listCall.call[1] as { $el: { call: unknown[] } }).$el.call;
    expect(commandCall[0]).toBe("TabDataCommand");
    expect(commandCall).toHaveLength(8);
    // The source-only computed schema has keyless anonymous fields and Type
    // values. Keep the current projection abstention, including malformed
    // payloads; this test does not certify command membership.
    const projected = typeToSetExpr(schema);
    expect(contains(projected, plan, null, {}, context)).toEqual({ $tag: "Nothing" });
    expect(contains(projected, { ...plan, canvasItem: { ...plan.canvasItem, caption: 9 } }, null, {}, context)).toEqual({ $tag: "Nothing" });
    const kept = { id: "kept", value: { id: "kept", expr: { kind: "literal", value: "Existing data" } } };
    const original = accepted(edit(empty(), 0, [append("Entries", kept)]));
    const initial = accepted(edit(original, original.revision, plan.commands));
    const expressions = (state: State) => new Map(state.values.map(entry => [entry.id,
      (entry.value.query as { expr: ExprNode }).expr]));
    const result = (state: State, identity: string) => {
      const saved = expressions(state);
      return evaluate(exprNodeToLogic({ kind: "ref", savedExprId: identity }, { resolver: id => saved.get(id) }), {}, context);
    };
    expect(initial.revision).toBe(original.revision + 1);
    expect(initial.entries[0]).toEqual(kept);
    expect(initial.values).toHaveLength(5);
    expect(initial.entries).toHaveLength(6);
    expect(result(initial, identities.doubled)).toBe(20);
    expect(result(initial, identities.result)).toBe(21);
    expect(result(initial, identities.list)).toEqual([10, 20, 21]);
    const changed = accepted(edit(initial, initial.revision, [{ $tag: "TabPatchValue", id: identities.source,
      patch: { query: { kind: "expression", expr: { kind: "literal", value: 20 }, valueType: Rational } } }]));
    expect(result(changed, identities.doubled)).toBe(40);
    expect(result(changed, identities.result)).toBe(41);
    expect(result(changed, identities.list)).toEqual([20, 40, 41]);
    expect((result(changed, identities.canvas) as Array<{ item: number }>).map(value => value.item)).toEqual([20, 40, 41]);
    expect(changed.values.map(entry => entry.id)).toEqual(initial.values.map(entry => entry.id));
    expect(changed.entries.map(entry => entry.id)).toEqual(initial.entries.map(entry => entry.id));
    expect(changed.values.slice(1)).toEqual(initial.values.slice(1));
    expect(changed.entries[0]).toEqual(kept);
    expect(edit(changed, initial.revision, plan.commands).$tag).toBe("Err");
    expect(edit(changed, changed.revision, plan.commands).$tag).toBe("Err");
    expect(original.values).toEqual([]);
  });

  test("one atomic batch retains authored expressions and representation data without running them", () => {
    const original = empty();
    const expression = { kind: "call", fnId: "never:invoke", args: [] };
    const value = { id: "data", slug: "", query: { kind: "expression", expr: expression, valueType: { $ref: "Number" } } };
    const occurrence = { id: "occurrence", source: { kind: "ref", ref: { kind: "savedExpr", id: "data" } }, caption: "" };
    const representation = { id: "representation", typeName: "Labelable", args: ["data"], instance: { methods: { label: "Example" } } };
    const next = accepted(edit(original, 0, [
      append("Values", { id: "data", value }), append("Entries", { id: "occurrence", value: occurrence }),
      append("Representations", { id: "representation", value: representation }),
    ]));
    expect(next.revision).toBe(1);
    expect(next.values[0]?.value).toEqual(value);
    expect(next.entries[0]?.value).toEqual(occurrence);
    expect(next.representations[0]?.value).toEqual(representation);
    expect(original.revision).toBe(0);
    expect(original.entries).toEqual([]);
  });

  test("revision conflicts, invalid revisions and a failing later command publish no partial result", () => {
    const state = empty();
    const entry = { id: "a", value: { id: "a", expr: { kind: "literal", value: 0 } } };
    for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1]) {
      expect(edit(state, revision, [append("Entries", entry)]).$tag).toBe("Err");
    }
    const failed = edit(state, 0, [append("Entries", entry), append("Entries", entry)]);
    expect(failed.$tag).toBe("Err");
    expect(state.entries).toEqual([]);
    expect(state.revision).toBe(0);
    expect(edit(state, 0, [{ $tag: "UnrecognizedTabCommand" }]).$tag).toBe("Err");
    expect(accepted(edit(state, 0, [])).revision).toBe(0);
    const exhausted = { ...state, revision: Number.MAX_SAFE_INTEGER };
    expect(edit(exhausted, exhausted.revision, [append("Entries", entry)]).$tag).toBe("Err");
  });

  test("stable occurrences survive reorder and edits while identity-changing replacement is refused", () => {
    let state = accepted(edit(empty(), 0, [
      append("Entries", { id: "a", value: { id: "a", expr: { kind: "literal", value: 1 } } }),
      append("Entries", { id: "b", value: { id: "b", expr: { kind: "literal", value: 2 } } }),
    ]));
    state = accepted(edit(state, 1, [{ $tag: "TabEditEntries", commands: [{ $tag: "LocusReorder", ids: ["b", "a"] }] }]));
    expect(state.entries.map(entry => entry.id)).toEqual(["b", "a"]);
    expect(edit(state, 2, [{ $tag: "TabEditEntries", commands: [{ $tag: "LocusReplace", id: "a", entry: { id: "changed", value: {} } }] }]).$tag).toBe("Err");
    state = accepted(edit(state, 2, [{ $tag: "TabEditEntries", commands: [{ $tag: "LocusRemove", id: "a" }] }]));
    expect(state.entries.map(entry => entry.id)).toEqual(["b"]);
  });

  test("patching a retained row preserves unmentioned type, expression and extra fields", () => {
    const value = { id: "data", slug: "old", query: { kind: "expression", expr: { kind: "literal", value: false }, valueType: { $ref: "Boolean" } }, extra: { retained: true } };
    const state = accepted(edit(empty(), 0, [append("Values", { id: "data", value })]));
    const next = accepted(edit(state, 1, [{ $tag: "TabPatchValue", id: "data", patch: { slug: "new" } }]));
    expect(next.values[0]?.value).toEqual({ ...value, slug: "new" });
    expect(call<unknown>("tabDataValue", next, "missing")).toEqual({ $tag: "Nothing" });
    expect(edit(next, 2, [{ $tag: "TabPatchValue", id: "data", patch: { id: "different" } }]).$tag).toBe("Err");
  });

  test("existing root wire batches share the checked Fenel list transition", () => {
    const command = call("tabDataRootCommand", { kind: "batch", commands: [
      { kind: "append", item: { id: "a", expr: { kind: "literal", value: 0 } } },
      { kind: "layout", layout: { kind: "list", axis: "horizontal" } },
    ] });
    const state = accepted(edit(empty(), 0, [command]));
    expect(state.layout).toEqual({ kind: "list", axis: "horizontal" });
    expect(state.entries[0]?.id).toBe("a");
    expect(edit(state, 1, [call("tabDataRootCommand", { kind: "unknown" })]).$tag).toBe("Err");
    expect(edit(state, 1, [{ $tag: "TabSetLayout", layout: { kind: "unknown" } }]).$tag).toBe("Err");
    expect(edit(state, 1, [{ $tag: "TabSetLayout", layout: { kind: "list", axis: "unknown" } }]).$tag).toBe("Err");
    expect(edit(state, 1, [append("Entries", { id: "b", value: { id: "mismatched" } })]).$tag).toBe("Err");
    expect(call<Result<boolean>>("tabDataCheckRoot", state, "different-tab")).toEqual({ $tag: "Err", _0: "This data belongs to a different tab source." });
  });

  test("a saved expression and its occurrence change atomically at the authored revision", () => {
    const item = { id: "occurrence", source: { kind: "ref", ref: { kind: "savedExpr", id: "data" } } };
    const query = { kind: "expression", expr: { kind: "literal", value: 1 } };
    const state = accepted(edit(empty(), 0, [
      append("Values", { id: "data", value: { id: "data", query } }),
      append("Entries", { id: item.id, value: item }),
    ]));
    const changedQuery = { kind: "expression", expr: { kind: "literal", value: 2 } };
    const patch = { $tag: "TabPatchValue", id: "data", patch: { query: changedQuery } };
    const occurrence = call("tabDataRootCommand", { kind: "replace", itemId: item.id, item: { ...item, caption: "Changed" } });
    const changed = accepted(edit(state, state.revision, [patch, occurrence]));
    expect(changed.revision).toBe(state.revision + 1);
    expect(changed.values[0]?.value.query).toEqual(changedQuery);
    expect(changed.entries[0]?.value.caption).toBe("Changed");
    expect(state.values[0]?.value.query).toEqual(query);
    expect(edit(changed, state.revision, [patch, occurrence]).$tag).toBe("Err");
    const missing = call("tabDataRootCommand", { kind: "replace", itemId: "missing", item: { ...item, id: "missing" } });
    expect(edit(state, state.revision, [patch, missing]).$tag).toBe("Err");
    expect(state.values[0]?.value.query).toEqual(query);
  });

  test("root projection retains executable references as source and omits nonexpression rows", () => {
    const source = { kind: "call", fnId: "never:invoke", args: [] };
    const state = accepted(edit(empty(), 0, [
      append("Values", { id: "data", value: { id: "data", query: { kind: "expression", expr: source } } }),
      append("Values", { id: "query", value: { id: "query", query: { kind: "data-search" } } }),
      append("Entries", { id: "occurrence", value: { id: "occurrence", source: { kind: "ref", ref: { kind: "savedExpr", id: "data" } } } }),
    ]));
    const root = call<Record<string, unknown>>("tabDataRoot", state, List(Anything));
    expect(root.persisted).toBe(false);
    expect(root.canEdit).toBe(true);
    expect(root.expr).toEqual({ kind: "literal", value: { __list: [{ kind: "ref", savedExprId: "data" }] } });
    expect((root.expressions as Record<string, unknown>).data).toEqual(source);
    expect((root.expressions as Record<string, unknown>).query).toBeUndefined();
  });

  // Demo 1 (2026-11-07): a Local card is referenceable like an account card
  // (`<root reference>:<occurrence>`), so data derived from it follows its edits.
  test("root projection publishes each card's reference, so a grouping over it follows an edit", () => {
    const row = (day: number, amount: number): ExprNode => ({ kind: "literal", value: { __record: { fields: [
      { name: "day", value: { kind: "literal", value: day } }, { name: "amount", value: { kind: "literal", value: amount } },
    ] } } });
    const list = (rows: ExprNode[]): ExprNode => ({ kind: "literal", value: { __list: rows } });
    const item = { id: "transactions", source: { kind: "expr", expr: list([row(3, 10), row(3, 20), row(10, 30)]) } };
    const saved = { id: "transactions", query: { kind: "expression", expr: { kind: "literal" as const, value: "saved wins" } } };
    const state = accepted(edit(empty(), 0, [append("Entries", { id: item.id, value: item }),
      append("Entries", { id: "other", value: { id: "other", source: { kind: "expr", expr: { kind: "literal", value: 1 } } } })]));
    const root = (current: State) => call<{ expressions: Record<string, ExprNode>; referenceId: string }>("tabDataRoot", current, List(Anything));
    const reference = `${root(state).referenceId}:transactions`;
    expect(reference).toBe("tab-identity:transactions");
    expect(root(state).expressions[reference]).toEqual(item.source.expr);
    expect(root(state).expressions["tab-identity:other"]).toEqual({ kind: "literal", value: 1 });
    const grouping: ExprNode = { kind: "call", fnId: context.getFunction!("std:groupByKey")!.id, args: [
      { kind: "literal", value: { __lambda: { params: ["row"], arrayParams: true, body: { kind: "param", name: "row.day" } } } },
      { kind: "ref", savedExprId: reference },
    ] };
    const keys = (current: State) => {
      const expressions = root(current).expressions;
      const result = evaluate(exprNodeToLogic(grouping, { resolver: id => expressions[id] }), {}, context) as
        { $tag: string; _0: { entries: { key: number; value: { amount: number }[] }[] } };
      expect(result.$tag).toBe("Just");
      return result._0.entries.map(entry => [entry.key, entry.value.map(value => value.amount)]);
    };
    expect(keys(state)).toEqual([[3, [10, 20]], [10, [30]]]);
    const moved = accepted(edit(state, state.revision, [call("tabDataRootCommand", { kind: "replace", itemId: item.id,
      item: { ...item, source: { kind: "expr", expr: list([row(3, 10), row(24, 20), row(10, 30)]) } } })]));
    expect(keys(moved)).toEqual([[3, [10]], [24, [20]], [10, [30]]]);
    // A saved value keeps its own identity when an occurrence id collides with it.
    const colliding = accepted(edit(state, state.revision, [append("Values", { id: "tab-identity:transactions", value: { ...saved, id: "tab-identity:transactions" } })]));
    expect(root(colliding).expressions["tab-identity:transactions"]).toEqual(saved.query.expr);
  });

  test("prepared definitions update atomically and expose the same retained definition", () => {
    const definition = { id: "LocalType", type: { $ref: "String" } };
    const definitions = { owners: [{ kind: "type", storageName: "LocalType", definition }], fields: [], facets: [] };
    const state = accepted(edit(empty(), 0, [{ $tag: "TabSetDefinitions", definitions }]));
    expect(state.definitions).toEqual(definitions);
    expect(call<unknown>("tabDataDefinition", state, "type", "LocalType")).toEqual({ $tag: "Just", _0: definition });
    expect(call<unknown>("tabDataDefinition", state, "function", "LocalType")).toEqual({ $tag: "Nothing" });
    expect(call<boolean>("workspaceSourceEqual", { $tag: "ThisTabSource" }, { $tag: "ThisTabSource" })).toBe(true);
    expect(call<boolean>("workspaceSourceEqual", { $tag: "ThisTabSource" }, { $tag: "PublicSource" })).toBe(false);
  });

  test("metadata enumerates exact targets without choosing duplicate instances or running methods", () => {
    const rows = [
      { id: "first", typeName: "Labelable", args: ["data"], instance: { methods: { label: { call: ["never:invoke"] } } } },
      { id: "second", typeName: "Labelable", args: ["data"], instance: { methods: { label: "Other" }, priority: 4 } },
      { id: "third", typeName: "Iconable", args: ["type"], instance: { methods: { icon: "type" } } },
    ];
    const state = accepted(edit(empty(), 0, rows.map(value => append("Representations", { id: value.id, value }))));
    expect(call<string[]>("tabDataMetadataTargets", state)).toEqual(["data", "type"]);
    expect(call<unknown[]>("tabDataRepresentationRows", state, "Labelable")).toEqual(rows.slice(0, 2));
  });
});
