// SSR fixture for function-read.test.ts (no browser): the read frame of a
// function (ExpressionEditor's held inspection of a lambda), as the focused
// function page draws it, over a stub reader presentation.
import { renderToString } from "@solidjs/web";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { Nothing } from "@fenel/engine/maybe-value";
import { ExpressionEditor, heldConstructorGlyph, type HeldCallablePresentation, type HeldExpressionPresentation } from "./ExpressionEditor";
import { heldFunctionLambda } from "./expression-structure";
import type { FunctionSignatureOrigins } from "./function-signature-origins";

const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, meta: {}, ui: Nothing }) as FieldDef;
const number: FenelType = { $ref: "Number" };
const food: FenelType = { $ref: "Food" };
const foods: FenelType = { $ref: "Foods" };
const preparations: FenelType = { $ref: "Preparations" };
const boolean: FenelType = { $ref: "Boolean" };
const any: FenelType = { $ref: "Any" };
const labels: Record<string, string> = { Number: "Number", Food: "Food", Foods: "List of foods", Preparations: "List of preparations",
  Boolean: "Boolean", Any: "Anything" };

const callables: Record<string, { name: string; params: FieldDef[]; returns: FenelType }> = {
  mul: { name: "Multiply", params: [field("a", number), field("b", number)], returns: number },
  elem: { name: "Element of", params: [field("item", { $var: "a" } as FenelType), field("items", { $var: "b" } as FenelType)], returns: boolean },
  all: { name: "All", params: [field("items", foods), field("test", { $var: "p" } as FenelType)], returns: boolean },
  prepare: { name: "Prepare", params: [field("items", foods)], returns: preparations },
};

const presentation: HeldExpressionPresentation = {
  callable: id => callables[id] ? { id, ...callables[id]! } : undefined,
  typeLabel: type => "$ref" in type ? labels[String(type.$ref)] ?? String(type.$ref) : undefined,
  typeIcon: type => "$ref" in type && type.$ref === "Number" ? "hash" : undefined,
};

const param = (name: string): ExprNode => ({ kind: "param", name });
const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const arrow = (params: FieldDef[], returns: FenelType): FenelType => ({ $arrow: { params, returns } }) as FenelType;

function read(node: ExprNode, type: FenelType, origins?: FunctionSignatureOrigins) {
  return renderToString(() => <ExpressionEditor expr={node} fieldDef={field("function", type)}
    inspection={presentation} graphAuthoring={false} hideLabel onChange={() => {}} signatureOrigins={origins} />);
}

export function cases(): Record<string, string> {
  const square = heldFunctionLambda(["x"], call("mul", param("x"), param("x")));
  const squareType = arrow([field("x", number)], number);
  // lubeFormula foods = let has = \food -> elem food foods; let essentials = [..]; if all essentials has then prepare foods else []
  const recipe = heldFunctionLambda(["foods"], literal({ __do: [
    literal({ __let: { bindings: [{ name: "has", expr: heldFunctionLambda(["food"], call("elem", param("food"), param("foods"))) }] } }),
    literal({ __let: { bindings: [{ name: "essentials", expr: literal({ __list: [literal("Honey"), literal("Egg")] }) }] } }),
    literal({ __operator: { op: "if", args: [call("all", param("essentials"), param("has")), call("prepare", param("foods")), literal({ __list: [] })] } }),
  ] }));
  return {
    square: read(square, squareType, { params: ["declared"], returns: "declared" }),
    squareInferred: read(square, squareType, { params: ["inferred"], returns: "inferred" }),
    squareUnknownOrigin: read(square, squareType),
    unsettled: read(heldFunctionLambda(["x"], call("mul", param("x"), param("x"))), arrow([field("x", any)], any),
      { params: ["inferred"], returns: "inferred" }),
    identity: read(heldFunctionLambda(["x"], param("x")), squareType, { params: ["declared"], returns: "declared" }),
    recipe: read(recipe, arrow([field("foods", foods)], preparations), { params: ["declared"], returns: "declared" }),
  };
}

/** A nullary constructor item's own mark in a graph list (Sports formula's
 * [Tomato, Watermelon, Cucumber]): the reader's presentation of the
 * constructor, with its picture, as the data cards' marks draw it. */
export function constructorGlyph(): unknown {
  const picture = { $tag: "GlyphPictureReference", handle: "tomato-picture" };
  const marked: HeldExpressionPresentation = { ...presentation,
    callable: id => id === "Tomato" ? { id, name: "Tomato", emoji: "\u{1F345}", picture, isConstructor: true } as HeldCallablePresentation : undefined };
  return heldConstructorGlyph({ kind: "call", fnId: "Tomato", args: [], callSyntax: "construct" }, marked);
}
