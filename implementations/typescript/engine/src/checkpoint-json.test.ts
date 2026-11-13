import { describe, expect, test } from "bun:test";
import { CHECKPOINT_VALUE_ENCODING as ENCODING, encodeCheckpointValue, decodeCheckpointValue, encodeCheckpointVariables, decodeCheckpointVariables, decodeCheckpointRow, checkpointDraftFingerprint } from "./checkpoint-json";
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const round = (value: unknown) => decodeCheckpointValue(json(encodeCheckpointValue(value)), ENCODING);
describe("unfinished checkpoint draft fingerprints", () => {
  test("unfinished slots reuse checkpoint escaping and record omission", () => {
    const marker = { $fenelCheckpoint: ["draft-undefined", null] };
    const values = [undefined, null, [], [undefined], [null], marker, [marker]];
    expect(new Set(values.map(checkpointDraftFingerprint)).size).toBe(values.length);
    expect(checkpointDraftFingerprint({ items: [undefined], omitted: undefined }))
      .toBe(checkpointDraftFingerprint({ items: [undefined] }));
    expect(round(marker)).toEqual(marker);
  });

  test("unfinished slots retain all existing carrier refusals", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    let reads = 0;
    const accessor = Object.defineProperty({}, "item", { enumerable: true, get() { reads++; return 1; } });
    const hidden = Object.defineProperty({}, "item", { value: 1 });
    const extra = Object.assign([1], { item: 2 });
    for (const value of [cycle, Array(1), 1n, new Uint16Array([1]), accessor, hidden, extra, { [Symbol()]: 1 }]) {
      expect(() => checkpointDraftFingerprint(value)).toThrow();
      expect(() => checkpointDraftFingerprint([undefined, value])).toThrow();
      expect(() => checkpointDraftFingerprint([value, undefined])).toThrow();
    }
    expect(reads).toBe(0);
  });

  test("durable value and variable codecs still refuse unfinished slots and atoms", () => {
    for (const value of [undefined, [undefined], { items: [undefined] }]) {
      expect(() => encodeCheckpointValue(value)).toThrow("Unsupported checkpoint undefined value");
      expect(() => encodeCheckpointVariables({ items: [value] })).toThrow();
      const draft = JSON.parse(checkpointDraftFingerprint(value));
      expect(() => decodeCheckpointValue(draft, ENCODING)).toThrow("Unknown checkpoint atom");
      expect(() => decodeCheckpointVariables({ item: draft }, ENCODING)).toThrow("Unknown checkpoint atom");
    }
    expect(encodeCheckpointVariables({ omitted: undefined })).toEqual({});
  });
});

describe("type-neutral native checkpoint transport", () => {
  test("finite JSON and control variable paths stay unchanged", () => {
    const value = { _suspensionId: "nonce", _suspendMeta: { $tag: "WaitEvent", event: "ready" }, body: [{ var: ["x", { $tag: "Literal" }] }], optional: null };
    expect(encodeCheckpointVariables(value)).toEqual(value);
    expect(decodeCheckpointVariables(json(encodeCheckpointVariables(value)), ENCODING)).toEqual(value);
  });
  test("nonfinite numbers, bytes and buffers survive arbitrary metadata positions", () => {
    const value = { metadata: { type: { unrelated: [Infinity, -Infinity, NaN, -0] } }, bytes: new Uint8Array([0, 128, 255]), buffer: new Uint8Array([9, 8]).buffer };
    const decoded = round(value) as typeof value;
    expect(decoded.metadata.type.unrelated).toEqual(value.metadata.type.unrelated);
    expect(Object.is(decoded.metadata.type.unrelated[3], -0)).toBe(true);
    expect(decoded.bytes).toEqual(value.bytes);
    expect(decoded.bytes).not.toBe(value.bytes);
    expect(decoded.buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(decoded.buffer)).toEqual(new Uint8Array([9, 8]));
  });
  test("marker-shaped user records, including root variables, remain literal data", () => {
    const literal = { $fenelCheckpoint: ["number", "+infinity"] };
    expect(round(literal)).toEqual(literal);
    expect(round({ $fenelCheckpoint: ["record", [["x", literal]]] })).toEqual({ $fenelCheckpoint: ["record", [["x", literal]]] });
    const vars = { $fenelCheckpoint: ["number", "+infinity"], nested: literal, actual: Infinity };
    expect(decodeCheckpointVariables(json(encodeCheckpointVariables(vars)), ENCODING)).toEqual(vars);
    expect(decodeCheckpointValue(literal, null)).toBe(literal);
    expect(decodeCheckpointVariables({ nested: literal }, undefined).nested).toBe(literal);
  });
  test("SQL Date DTOs keep ISO behavior and arbitrary toJSON never runs", () => {
    expect(round({ date: new Date("2026-09-08T12:00:00Z") })).toEqual({ date: "2026-09-08T12:00:00.000Z" });
    let calls = 0;
    const date = Object.assign(new Date(0), { toJSON: () => { calls++; return 1; } });
    expect(() => round(date)).toThrow();
    expect(() => round(new Date(NaN))).toThrow();
    expect(calls).toBe(0);
  });
  test("unsupported graphs and forged encodings fail without reading accessors", () => {
    let reads = 0;
    const getter = Object.defineProperty({}, "x", { enumerable: true, get() { reads++; return 1; } });
    const cycle: any = {}; cycle.self = cycle;
    for (const value of [getter, cycle, () => 1, new Map(), new Uint16Array([1]), [undefined], Array(1), { [Symbol()]: 1 }]) expect(() => round(value)).toThrow();
    expect(reads).toBe(0);
    expect(() => decodeCheckpointValue({}, "future-format")).toThrow("Unsupported checkpoint encoding version");
    expect(() => decodeCheckpointValue({ $fenelCheckpoint: ["uint8array", [256]] }, ENCODING)).toThrow();
    expect(() => decodeCheckpointValue({ $fenelCheckpoint: ["record", [["x", 1], ["x", 2]]] }, ENCODING)).toThrow();
  });
  test("prototype wire names survive and physical provenance is omitted from language rows", () => {
    const value = JSON.parse('{"__proto__":{"safe":true},"constructor":"literal"}');
    expect(round(value)).toEqual(value);
    expect(Object.prototype.hasOwnProperty.call(round(value), "__proto__")).toBe(true);
    const row = decodeCheckpointRow({ id: "row", variables: encodeCheckpointVariables({ value: Infinity }), variablesEncoding: ENCODING });
    expect(row).toEqual({ id: "row", variables: { value: Infinity } });
  });
  test("unmarked row projections retain null and undefined while runtime env defaults stay empty", () => {
    expect(decodeCheckpointRow({ id: "legacy", variables: null, variablesEncoding: null })).toEqual({ id: "legacy", variables: null });
    const explicit = decodeCheckpointRow({ variables: undefined, variablesEncoding: undefined });
    expect(Object.hasOwn(explicit, "variables")).toBe(true);
    expect(explicit.variables).toBeUndefined();
    const absent = decodeCheckpointRow({ variablesEncoding: null });
    expect(Object.hasOwn(absent, "variables")).toBe(false);
    expect(decodeCheckpointVariables(null, null)).toEqual({});
    expect(decodeCheckpointVariables(undefined, undefined)).toEqual({});
  });
});
