// Rom (Nov 12): the recipe's graph read "List of as": a node typed by `concat`'s
// declared result `List a` spoke the variable as a plural word. In words an
// unconstrained variable is "anything"; the code keeps the variable.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/reader-presentation-type-variables.test.ts
import { expect, test } from "bun:test";
import type { FenelType } from "@fenel/engine/types";
import { typeCode, typePhrase } from "@fenel/engine/authoring/expression";
import { List } from "@fenel/engine/type-foundation";
import { speakableTypeVariables } from "./reader-presentation";

test("a type variable is spoken as anything; the code keeps the variable; a type without one is unchanged", () => {
  const listOfA = List({ $var: "a" } as FenelType);
  expect(typePhrase(listOfA)).toBe("A list of as");
  expect(typePhrase(speakableTypeVariables(listOfA))).toBe("A list of anything");
  expect(typeCode(listOfA)).toBe("List a");
  const arrow = { $arrow: { params: [{ name: "items", type: listOfA }], returns: { $var: "a" } } } as unknown as FenelType;
  expect(typePhrase(speakableTypeVariables(arrow))).toBe("A function from a list of anything to anything");
  const plain = List({ $ref: "Food" } as FenelType);
  expect(speakableTypeVariables(plain)).toBe(plain);
});
