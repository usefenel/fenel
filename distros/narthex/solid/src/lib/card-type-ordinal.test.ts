import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { cardConstructorKey, cardTypeOrdinal } from "./card-type-ordinal";

const construct = (tag: string): ExprNode => ({ kind: "literal", value: { __construct: { tag, fields: [] } } }) as ExprNode;
const cards: Array<{ id: string; expr: ExprNode }> = [
  { id: "person-1", expr: construct("Person") },
  { id: "tx-1", expr: construct("Transaction") },
  { id: "number", expr: { kind: "literal", value: 21 } as ExprNode },
  { id: "tx-2", expr: construct("Transaction") },
  { id: "call", expr: { kind: "call", fnId: "Transaction", args: [{ kind: "literal", value: 1 }] } as unknown as ExprNode },
  { id: "tx-3", expr: construct("Transaction") },
];
const keyOf = (card: { expr: ExprNode }) => cardConstructorKey(card.expr);

describe("card type ordinal (unnamed records read as their type and number)", () => {
  test("counts only cards built by the same constructor, in order", () => {
    expect(cards.map(card => cardTypeOrdinal(cards, card, keyOf))).toEqual([1, 1, undefined, 2, undefined, 3]);
  });
  test("a card outside the list has no ordinal", () => {
    expect(cardTypeOrdinal(cards, { id: "elsewhere", expr: construct("Transaction") }, keyOf)).toBeUndefined();
  });
});
