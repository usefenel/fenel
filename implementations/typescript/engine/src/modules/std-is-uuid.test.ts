import { describe, expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";

// std:isUuid (fenel/modules/std/isUuid.fenel): the canonical text form of an
// RFC 4122 UUID, the syntax a runtime body can check (the engine's
// `fieldIdentityIsUuid` is not in the execute profile).
const context = createRegistry([stdModule]).evaluateContext();
const isUuid = (text: string) => evaluate({ call: ["isUuid", { var: "text" }] }, { text }, context);

describe("std:isUuid", () => {
  test("accepts the canonical form in either case, for versions 1-5 and the RFC variant", () => {
    for (const text of [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "0F8FAD5B-D9CB-469F-A165-70867728950E",
      "123e4567-e89b-12d3-a456-426614174000",
      "c9bf9e57-1685-5c89-bafb-ff5af830be8a",
    ]) expect(isUuid(text), text).toBe(true);
  });

  test("refuses the wrong length, a misplaced hyphen, a non-hex digit, and an unknown version or variant", () => {
    for (const text of [
      "",
      "bad-id",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaa",
      "aaaaaaaaa-aaa-4aaa-8aaa-aaaaaaaaaaaa",
      "gaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa",
      "aaaaaaaa aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]) expect(isUuid(text), text).toBe(false);
  });
});
