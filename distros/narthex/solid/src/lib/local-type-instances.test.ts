// Demo 1 (Rom, Nov 8): "See all <Type>" reads the data of a type in a Local tab
// as ONE live list. The tab's Fenel projection (`view:tabDataRoot`) publishes,
// per declared named type, the list of its cards' references under
// `<tab>:instances:<type>`; evaluating that reference gives exactly the saved
// values of the type, follows each card's edits, and a new card joins it.
import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../../../../implementations/typescript/engine/src/registry";
import { evaluate } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdModule } from "../../../../../implementations/typescript/engine/src/modules/std";
import { pictureModule } from "../../../../../implementations/typescript/engine/src/modules/picture";
import { viewModule } from "../../../../../implementations/typescript/engine/src/modules/view";
import { exprNodeToLogic, type ExprNode } from "@fenel/engine/authoring/expression";
import { Anything, List } from "@fenel/engine/type-foundation";
import type { LocalTabData } from "./local-locus-data";

const registry = createRegistry([stdModule, pictureModule, viewModule]);
const context = registry.evaluateContext();
function call<T = any>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
function accepted(result: { $tag: string; _0: any }): LocalTabData {
  if (result.$tag !== "Ok") throw new Error(String(result._0));
  return result._0;
}
function append(state: LocalTabData, item: Record<string, unknown>): LocalTabData {
  return accepted(call("applyTabDataCommands", state, state.revision, [call("tabDataRootCommand", { kind: "append", item })]));
}
function replace(state: LocalTabData, item: Record<string, unknown>): LocalTabData {
  return accepted(call("applyTabDataCommands", state, state.revision,
    [call("tabDataRootCommand", { kind: "replace", itemId: item.id, item })]));
}
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const card = (id: string, value: unknown, type?: unknown) => ({ id, source: { kind: "expr", expr: literal(value) },
  ...(type === undefined ? {} : { valueType: type }) });
const TX = "11111111-2222-4333-8444-555555555555";
const PERSON = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const tx = (id: string, date: string, amount: number) => card(id, { date, amount, person: "Alex" }, { $ref: TX });

/** The list published for `type`, evaluated as a card reading it would be. */
function instances(state: LocalTabData, type: string): unknown {
  const root = call<{ expressions: Record<string, ExprNode> }>("tabDataRoot", state, List(Anything));
  const reference: ExprNode = { kind: "ref", savedExprId: `${state.tabId}:instances:${type}` };
  let missing: string | undefined;
  const logic = exprNodeToLogic(reference, { resolver: id => root.expressions[id], onMissingRef: id => { missing = id; } });
  if (missing) throw new Error(`unresolved ${missing}`);
  return evaluate(logic as never, {}, context);
}

function demo(): LocalTabData {
  let state = call<LocalTabData>("defaultTabData", "tab", { kind: "grid" });
  state = append(state, card("type-tx", { $ref: TX }));
  state = append(state, card("type-person", { $ref: PERSON }));
  state = append(state, card("alex", { name: "Alex" }, { $ref: PERSON }));
  state = append(state, tx("tx1", "2026-11-01", 12));
  state = append(state, card("note", "a plain note"));
  state = append(state, tx("tx2", "2026-11-03", 30));
  state = append(state, tx("tx3", "2026-11-03", 7));
  return state;
}

describe("a type's data in a Local tab (See all <Type>)", () => {
  test("lists exactly the saved values of that type, in card order", () => {
    const state = demo();
    expect(instances(state, TX)).toEqual([
      { date: "2026-11-01", amount: 12, person: "Alex" },
      { date: "2026-11-03", amount: 30, person: "Alex" },
      { date: "2026-11-03", amount: 7, person: "Alex" },
    ]);
    // Another type's values are not in it, and that type has its own list.
    expect(instances(state, PERSON)).toEqual([{ name: "Alex" }]);
  });

  test("the list holds the cards' references, so it is live", () => {
    let state = demo();
    const root = call<{ expressions: Record<string, ExprNode> }>("tabDataRoot", state, List(Anything));
    expect(root.expressions[`tab:instances:${TX}`]).toEqual(literal({ __list: ["tx1", "tx2", "tx3"]
      .map(id => ({ kind: "ref", savedExprId: `tab:${id}` })) }));
    // A new value of the type joins the list.
    state = append(state, tx("tx4", "2026-11-05", 1));
    expect((instances(state, TX) as unknown[]).length).toBe(4);
    expect((instances(state, TX) as unknown[])[3]).toEqual({ date: "2026-11-05", amount: 1, person: "Alex" });
    // Editing one value in place changes the list's value.
    state = replace(state, tx("tx2", "2026-11-24", 30));
    expect((instances(state, TX) as { date: string }[]).map(row => row.date))
      .toEqual(["2026-11-01", "2026-11-24", "2026-11-03", "2026-11-05"]);
  });

  test("a type's own card publishes its list before its first data", () => {
    let state = call<LocalTabData>("defaultTabData", "tab", { kind: "grid" });
    state = append(state, card("type-tx", { $ref: TX }));
    expect(instances(state, TX)).toEqual([]);
    state = append(state, tx("tx1", "2026-11-01", 12));
    expect(instances(state, TX)).toEqual([{ date: "2026-11-01", amount: 12, person: "Alex" }]);
  });

  test("a card listing the type's data (typed List T) is not one of its values", () => {
    let state = demo();
    state = append(state, { id: "all-tx", caption: "All Transaction",
      source: { kind: "expr", expr: { kind: "ref", savedExprId: `tab:instances:${TX}` } }, valueType: List({ $ref: TX }) });
    expect((instances(state, TX) as unknown[]).length).toBe(3);
    // The new card reads the list through its own reference.
    const root = call<{ expressions: Record<string, ExprNode> }>("tabDataRoot", state, List(Anything));
    const logic = exprNodeToLogic({ kind: "ref", savedExprId: "tab:all-tx" }, { resolver: id => root.expressions[id] });
    expect((evaluate(logic as never, {}, context) as unknown[]).length).toBe(3);
  });
});
