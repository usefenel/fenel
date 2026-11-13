import { expect, test } from "bun:test";
import { formatRuntimeValue } from "./runtime-value-display";

test("runtime display distinguishes native values from ordinary strings and records", () => {
  const value = { bytes: Uint8Array.of(0, 255), buffer: Uint8Array.of(4).buffer, max: Infinity, nan: NaN, zero: -0,
    text: "Infinity", raw: { $fenelCheckpoint: ["number", "+infinity"] }, absent: null };
  const display = formatRuntimeValue(value, 2);
  expect(display).toContain('"bytes": Bytes [00 ff]');
  expect(display).toContain('"buffer": ArrayBuffer [04]');
  expect(display).toContain('"max": Infinity');
  expect(display).toContain('"nan": NaN');
  expect(display).toContain('"zero": -0');
  expect(display).toContain('"text": "Infinity"');
  expect(display).toContain('"$fenelCheckpoint": [');
  expect(display).toContain('"absent": null');
  expect(value.bytes).toEqual(Uint8Array.of(0, 255));
});

test("inspection never evaluates accessors and reports cyclic and absent data", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  Object.defineProperty(cyclic, "getter", { enumerable: true, get() { throw new Error("must not execute"); } });
  expect(formatRuntimeValue(cyclic)).toBe('{"self": <cycle>, "getter": <accessor>}');
  expect(formatRuntimeValue([, null])).toBe("[<absent>, null]");
});
