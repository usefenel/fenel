import { expect, test } from "bun:test";
import { assertJsonAuthoringValue } from "./json-value";

test("actual raw values cannot silently lose undefined record fields", () => {
  expect(() => assertJsonAuthoringValue({ a: undefined, b: 1 }, new Set(), "value", true)).toThrow("undefined value cannot be saved");
  expect(() => assertJsonAuthoringValue({ a: { b: undefined } }, new Set(), "value", true)).toThrow("value.a.b");
  expect(() => assertJsonAuthoringValue({ a: null, b: 1 }, new Set(), "value", true)).not.toThrow();
});

test("optional definition metadata remains omittable at its separate transport boundary", () => {
  expect(() => assertJsonAuthoringValue({ id: "example", description: undefined })).not.toThrow();
});
