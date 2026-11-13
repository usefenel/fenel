import { describe, expect, test } from "bun:test";
import { valueToJsonWire, valueFromJsonWire, VALUE_JSON_ENCODING } from "./value-authoring";
import { evaluate } from "../json-logic";
import { Nothing } from "../type-foundation";
import type { FenelType } from "../types";

const boxType: FenelType = { $variant: { cases: [{ name: "TransportBytesBox", label: Nothing, fields: [{
  name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, ui: Nothing, meta: {}, type: { $ref: "Bytes" },
}] }] } };
const unions: [string, FenelType][] = [
  ["union", { $union: [boxType, { $ref: "String" }] }],
  ["intersection", { $intersect: [boxType, boxType] }],
];

describe("v2 typed callable literal carriers are inverse projections", () => {
  for (const [kind, returns] of unions) for (const position of ["direct", "if", "do"] as const) {
    test(`${kind} ${position} tagged Bytes literal reopens as the original callable value`, () => {
      const value = { $tag: "TransportBytesBox", _0: Uint8Array.of(1, 255) };
      const body = position === "if" ? { if: [true, value, value] } : position === "do" ? { do: [0, value] } : value;
      const closure = evaluate({ fn: [[], body] });
      const schema: FenelType = { $arrow: { params: [], returns } };
      const wire = valueToJsonWire(schema, closure, null, VALUE_JSON_ENCODING);
      const reopened = valueFromJsonWire(schema, JSON.parse(JSON.stringify(wire)), null, VALUE_JSON_ENCODING);
      expect(reopened).toEqual(closure);
      expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(value);
    });
  }
});
