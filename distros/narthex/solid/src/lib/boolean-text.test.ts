import { describe, expect, test } from "bun:test";
import { booleanText } from "./boolean-text";

describe("booleanText: a Bool read as data, the words the table lens already uses", () => {
  // "Foods from nightshades" showed "Every Species Gives a Food  false": the expression literal, lower case,
  // where a record's field is data. The table lens (DataTable.tsx) has always read a Bool as Yes / No.
  test("true reads Yes, false reads No; anything else is not a Bool", () => {
    expect(booleanText(true)).toBe("Yes");
    expect(booleanText(false)).toBe("No");
    expect(booleanText("false")).toBeUndefined();
    expect(booleanText(0)).toBeUndefined();
    expect(booleanText(undefined)).toBeUndefined();
  });
});
