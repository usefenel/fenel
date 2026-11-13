import { describe, expect, test } from "bun:test";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import { publicDataDeclaredScheme, recordPublicDataDeclaration, type PublicDataDeclarationEntry } from "./public-data-declaration";

// RecipeFunctions.lubeWithButter as the B26 public catalogue carries it: the
// raw `returns` spells `Ingredients` bare; the checked scheme owns it.
const listOfIngredients = (): FenelType => ({ $opaque: { name: "List", pure: { $variant: { cases: [
  { name: "Cons", fields: [
    { name: "tail", type: { $ref: "List" } },
    { name: "head", type: { $ref: "Ingredients" } },
  ] },
  { name: "Nil", fields: [] },
] } } } }) as unknown as FenelType;
const ownedReturns = (body: FenelType): TypeScheme => ({ quantified: [], body, nominals: [{
  path: ["$opaque", "pure", "$variant", "cases", "0", "fields", "1", "type"],
  identity: '["RecipeFunctions","Ingredients"]', publicName: "Ingredients",
}] } as unknown as TypeScheme);

function catalogue(entries: Record<string, PublicDataDeclarationEntry>) {
  return (id: string) => entries[id];
}
const projectReturns = (scheme: TypeScheme) => ({ ...scheme, body: (scheme.body as { $arrow: { returns: FenelType } }).$arrow.returns });

describe("publicDataDeclaredScheme", () => {
  test("a public data field's raw type reads its declaration's owned result scheme", () => {
    const returns = listOfIngredients();
    recordPublicDataDeclaration(returns, "lube-with-butter");
    const declared = { signatureOutcome: { $tag: "Solved" },
      scheme: { quantified: [], body: { $arrow: { params: [], returns } } } as unknown as TypeScheme };
    const scheme = publicDataDeclaredScheme(returns, catalogue({ "lube-with-butter": declared }),
      scheme => ownedReturns(projectReturns(scheme).body));
    expect(scheme?.nominals?.[0]?.identity).toBe('["RecipeFunctions","Ingredients"]');
    expect(scheme?.body).toBe(returns);
  });

  test("anything else keeps the caller's existing check", () => {
    const returns = listOfIngredients();
    recordPublicDataDeclaration(returns, "a");
    const solved = { signatureOutcome: { $tag: "Solved" },
      scheme: { quantified: [], body: { $arrow: { params: [], returns } } } as unknown as TypeScheme };
    const lookup = catalogue({ a: solved, b: solved, unsolved: { signatureOutcome: { $tag: "Invalid" } } });
    // An equal copy is not the declaration's object.
    expect(publicDataDeclaredScheme(listOfIngredients(), lookup, projectReturns)).toBeUndefined();
    expect(publicDataDeclaredScheme(undefined, lookup, projectReturns)).toBeUndefined();
    expect(publicDataDeclaredScheme(returns, undefined, projectReturns)).toBeUndefined();
    // Two declarations claiming one object are ambiguous.
    recordPublicDataDeclaration(returns, "b");
    expect(publicDataDeclaredScheme(returns, lookup, projectReturns)).toBeUndefined();
    const unsolved = listOfIngredients();
    recordPublicDataDeclaration(unsolved, "unsolved");
    expect(publicDataDeclaredScheme(unsolved, lookup, projectReturns)).toBeUndefined();
  });
});
