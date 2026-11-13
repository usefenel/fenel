// A function passed as a value (`solve ticketsSold AllNumbers`) arrives as the
// literal `{ $ref: id }`. The graph reads it as a named reference card; only
// this exact one-key shape counts, so records that carry more data stay data.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/expression-runner/held-bare-reference.test.ts
import { expect, test } from "bun:test";
import { detectStructuralForm, doLetChainAsWhere, heldBareReference, heldBareReferenceValue, heldDoLetChain, heldFunctionLambda, positionalParameter, whereEditAsDoLetChain } from "./expression-structure";

// The catalogue recipe's body arrives as a do block: `let has = …`, `let
// essentials = …`, then the `if`. Its read is the same local-names frame a
// let chain gets (the Expression panel showed only "do block (3 statements)").
test("a do block of lets ending in one expression reads as local names and a body", () => {
  const has = { kind: "literal" as const, value: 1 };
  const essentials = { kind: "literal" as const, value: 2 };
  const body = { kind: "param" as const, name: "has" };
  const letOf = (name: string, expr: unknown) => ({ kind: "literal" as const, value: { __let: { bindings: [{ name, expr }] } } });
  expect(heldDoLetChain({ kind: "literal", value: { __do: [letOf("has", has), letOf("essentials", essentials), body] } }))
    .toEqual({ body, bindings: [{ name: "has", expr: has }, { name: "essentials", expr: essentials }] });
  // An effect statement (not a let) or a do without lets keeps the do block.
  expect(heldDoLetChain({ kind: "literal", value: { __do: [has, body] } })).toBeUndefined();
  expect(heldDoLetChain({ kind: "literal", value: { __do: [body] } })).toBeUndefined();
  expect(heldDoLetChain(body)).toBeUndefined();
});

// The Expression lens of the same function edits it in the prepared graph,
// which drew the do block as one box. It now gets the where frame (local names,
// then the body), and an edit made there comes back as the same sequential lets.
test("a do block of lets is edited as a where frame and saved back as the same lets", () => {
  const has = { kind: "literal" as const, value: 1 };
  const essentials = { kind: "literal" as const, value: 2 };
  const body = { kind: "param" as const, name: "has" };
  const typed = { $ref: "Number" };
  const block = { kind: "literal" as const, value: { __do: [
    { kind: "literal" as const, value: { __let: { bindings: [{ name: "has", type: typed, expr: has }] } } },
    { kind: "literal" as const, value: { __let: { bindings: [{ name: "essentials", expr: essentials }] } } },
    body,
  ] } };
  const shown = doLetChainAsWhere(block)!;
  expect(detectStructuralForm((shown as { value: unknown }).value, () => true))
    .toEqual({ kind: "where", body, bindings: [{ name: "has", expr: has }, { name: "essentials", expr: essentials }] });
  // Unchanged frame: the same lets, the written type kept by name.
  expect(whereEditAsDoLetChain(shown, block)).toEqual(block);
  // An edited binding stays a let, in order.
  const three = { kind: "literal" as const, value: 3 };
  const edited = { kind: "literal" as const, value: { __where: { body, bindings: [{ name: "has", expr: has }, { name: "essentials", expr: three }] } } };
  expect(whereEditAsDoLetChain(edited, block)).toEqual({ kind: "literal", value: { __do: [
    { kind: "literal", value: { __let: { bindings: [{ name: "has", type: typed, expr: has }] } } },
    { kind: "literal", value: { __let: { bindings: [{ name: "essentials", expr: three }] } } },
    body,
  ] } });
  // No local name left: the body alone. Anything else passes through; a do block with an effect statement is not reframed.
  expect(whereEditAsDoLetChain({ kind: "literal", value: { __where: { body, bindings: [] } } }, block)).toBe(body);
  expect(whereEditAsDoLetChain(body, block)).toBe(body);
  expect(doLetChainAsWhere({ kind: "literal", value: { __do: [has, body] } })).toBeUndefined();
});

// A card whose value REFERENCES a readable catalogue function (the recipe
// "Moisturizing-lubrication formula") reads that function's body as the same graph a
// written lambda gets: its parameters bind the body's names.
test("a referenced function's parameters and body read back as one lambda", () => {
  const body = { kind: "call" as const, fnId: "std.map", args: [{ kind: "param" as const, name: "pantry" }] };
  const lambda = heldFunctionLambda(["pantry"], body);
  expect(lambda.kind).toBe("literal");
  expect(detectStructuralForm((lambda as { value: unknown }).value, () => true)).toEqual({ kind: "lambda", params: ["pantry"], body });
});

// The solver page writes the predicate by name: the node is a name whose
// observed VALUE is the bare reference (the raw `{$ref: …}` the panel printed).
test("an observed value that is a bare reference is recognised; other values are not", () => {
  expect(heldBareReferenceValue({ $ref: "4f07c89f-86b3-4ede-af86-17d54c236484" })).toBe("4f07c89f-86b3-4ede-af86-17d54c236484");
  expect(heldBareReferenceValue({ $ref: "x", low: -5 })).toBeUndefined();
  expect(heldBareReferenceValue({ $tag: "WholeNumbers", low: -5, high: 5 })).toBeUndefined();
  expect(heldBareReferenceValue(undefined)).toBeUndefined();
  expect(heldBareReferenceValue("4f07c89f")).toBeUndefined();
});

const literal = (value: unknown) => ({ kind: "literal" as const, value });

test("a one-key $ref literal is a bare reference", () => {
  expect(heldBareReference(literal({ $ref: "5ffe61ac-ddba-43b1-b716-0f4f19cf4ca0" }))).toBe("5ffe61ac-ddba-43b1-b716-0f4f19cf4ca0");
});

test("data that merely contains a $ref, other literals and other node kinds are not", () => {
  expect(heldBareReference(literal({ $ref: "x", name: "y" }))).toBeUndefined();
  expect(heldBareReference(literal({ $ref: 3 }))).toBeUndefined();
  expect(heldBareReference(literal([{ $ref: "x" }]))).toBeUndefined();
  expect(heldBareReference(literal({ $tag: "AllNumbers" }))).toBeUndefined();
  expect(heldBareReference(literal("x"))).toBeUndefined();
  expect(heldBareReference(literal(undefined))).toBeUndefined();
  expect(heldBareReference({ kind: "param", name: "ticketsSold" })).toBeUndefined();
});

// The recipe's `map (\fat -> ...)` read "Parameters _0": the callback slot of
// `map`'s type only has a position, and its "_0" replaced the lambda's own
// binder. A positional slot names nothing; a named slot may lend its label.
test("a positional parameter slot names nothing; a named one does", () => {
  expect(positionalParameter({ name: "_0", key: { $tag: "PositionalField" } })).toBe(true);
  expect(positionalParameter({ name: "_1" })).toBe(true);
  expect(positionalParameter({ name: "foods", key: { $tag: "NamedField" } })).toBe(false);
  expect(positionalParameter({ name: "fat" })).toBe(false);
  expect(positionalParameter(undefined)).toBe(false);
});
