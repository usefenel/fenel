import { expect, test } from "bun:test";
import { readableIdentities } from "./readable-ids";

test("a type identity in a checker message reads as the reader's label for it (polish lane 2)", () => {
  const labels: Record<string, string> = { "f582abdc-9959-43fd-be5a-10049b855d8c": "Person" };
  expect(readableIdentities("String is not f582abdc-9959-43fd-be5a-10049b855d8c", id => labels[id])).toBe("String is not Person");
  expect(readableIdentities("String is not 00000000-0000-4000-8000-000000000000", id => labels[id]))
    .toBe("String is not 00000000-0000-4000-8000-000000000000");
  expect(readableIdentities("no identities here", () => { throw new Error("unused"); })).toBe("no identities here");
});
