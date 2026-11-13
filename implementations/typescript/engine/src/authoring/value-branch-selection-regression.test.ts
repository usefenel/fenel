import { describe, expect, test } from "bun:test";
import { VALUE_JSON_ENCODING, valueFromJsonWire, valueToJsonWire } from "./value-authoring";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue } from "../checkpoint-json";
import { evaluate } from "../json-logic";
import type { FenelType } from "../types";

const bytesType: FenelType = { $ref: "Bytes" };
const callableType: FenelType = { $arrow: { params: [], returns: bytesType } };
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const selectedBranch = (wire: unknown) => (decodeCheckpointValue(wire, CHECKPOINT_VALUE_ENCODING) as { $fenelUnion: { branch: unknown } }).$fenelUnion.branch;

// These are transport tests. Successful encoding is not a membership judgment.
describe("v2 union carriers retain the compatible declared branch", () => {
  test("adding native raw transport does not select String for Bytes", () => {
    const schema: FenelType = { $union: [{ $ref: "String" }, bytesType] };
    const remaining: FenelType = { $union: [bytesType] };
    const value = Uint8Array.of(0, 255);
    const legacy = valueToJsonWire(schema, value, null, "fenel-value-json-v1");
    expect((legacy as { $fenelUnion: { branch: unknown } }).$fenelUnion.branch).toEqual(bytesType);
    const wire = json(valueToJsonWire(schema, value, null, VALUE_JSON_ENCODING));
    expect(selectedBranch(wire)).toEqual(bytesType);
    expect(valueFromJsonWire(remaining, wire, null, VALUE_JSON_ENCODING)).toEqual(value);
    expect(valueFromJsonWire(remaining, json(legacy), null, "fenel-value-json-v1")).toEqual(value);
  });

  test("compatibility selects the Arrow branch but v2 performs its actual projection", () => {
    const schema: FenelType = { $union: [{ $ref: "String" }, callableType] };
    const value = Uint8Array.of(4, 5);
    const closure = evaluate({ fn: [[], value] });
    const wire = json(valueToJsonWire(schema, closure, null, VALUE_JSON_ENCODING));
    expect(selectedBranch(wire)).toEqual(callableType);
    const reopened = valueFromJsonWire({ $union: [callableType] }, wire, null, VALUE_JSON_ENCODING);
    expect(reopened).toEqual(closure);
    expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(value);
  });

  test("a v2-only native callable fallback remains encodable without changing v1", () => {
    const schema: FenelType = { $union: [callableType] };
    const value = Uint8Array.of(8, 9);
    const closure = evaluate({ fn: [[], { var: ["missing", value] }] });
    expect(() => valueToJsonWire(schema, closure, null, "fenel-value-json-v1")).toThrow();
    const wire = json(valueToJsonWire(schema, closure, null, VALUE_JSON_ENCODING));
    expect(selectedBranch(wire)).toEqual(callableType);
    const reopened = valueFromJsonWire(schema, wire, null, VALUE_JSON_ENCODING);
    expect(reopened).toEqual(closure);
    expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(value);
  });
});
