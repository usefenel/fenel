import { expect, spyOn, test } from "bun:test";
import * as registry from "./registry";
import { getCatalogEntry, getEntityTypeByName, registerCatalogEntities } from "./type-catalog";
import type { FenelType } from "./types";

test("cold entity lookup does not construct the function registry", () => {
  const constructor = spyOn(registry, "createRegistry").mockImplementation(() => {
    throw new Error("Entity lookup attempted to build a callable registry");
  });
  try {
    const first: FenelType = { $tuple: [{ $ref: "String" }] };
    const second: FenelType = { $tuple: [{ $ref: "Number" }] };
    expect(getEntityTypeByName("ColdEntityLookupRegression")).toBeUndefined();
    registerCatalogEntities([
      { id: "ColdEntityLookupRegression", module: "FirstLookupOwner", type: first },
      { id: "ColdEntityLookupRegression", module: "SecondLookupOwner", type: second },
    ]);
    expect(getEntityTypeByName("ColdEntityLookupRegression")).toEqual(first);
    expect(getCatalogEntry("entity:FirstLookupOwner.ColdEntityLookupRegression")?.entity?.type).toEqual(first);
    expect(getEntityTypeByName("SecondLookupOwner.ColdEntityLookupRegression")).toEqual(second);
    expect(getCatalogEntry("entity:MissingLookupOwner.ColdEntityLookupRegression")).toBeUndefined();
    expect(constructor).not.toHaveBeenCalled();
  } finally { constructor.mockRestore(); }
}, 180_000);
