// An unnamed card's place among the cards built by the same constructor
// (polish lane 2, Nov 9: saved Transactions read "Transaction 1, 2, 3", not
// "Data"). The key is the authored data's own constructor (a record created
// as `Transaction { … }`), never a field name or a computed result: a call,
// a reference to computed data or untagged data has no ordinal.

import type { ExprNode } from "@fenel/engine/authoring/expression";
import { rootConstructorTag } from "./expression-runner/simple-data-form-model";

/** The constructor of authored record data, if the card holds one. */
export function cardConstructorKey(expr: ExprNode | null | undefined): string | undefined {
  return expr && expr.kind === "literal" ? rootConstructorTag(expr) : undefined;
}

/** 1-based position of `item` among `items` with the same constructor. */
export function cardTypeOrdinal<T extends { id: string }>(items: readonly T[], item: T,
  keyOf: (card: T) => string | undefined): number | undefined {
  const key = keyOf(item);
  if (key === undefined) return undefined;
  let ordinal = 0;
  for (const card of items) {
    if (keyOf(card) === key) ordinal += 1;
    if (card.id === item.id) return ordinal;
  }
  return undefined;
}
