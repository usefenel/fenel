import { describe, it, expect, vi } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { timeModule } from "./time";
import { Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, timeModule]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("time module — registration", () => {
  it("registers Timestamp as a record entity", () => {
    const ent = reg.getEntity("Timestamp");
    expect(ent?.type).toMatchObject({
      $record: { fields: [{ name: "epochMs", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
    });
  });

  it("registers Duration as a record entity", () => {
    const ent = reg.getEntity("Duration");
    expect(ent?.type).toMatchObject({
      $record: { fields: [{ name: "ms", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
    });
  });

  it("exposes natives and source-defined functions through the registry", () => {
    expect(reg.getFunctionByCodeName("now")).toBeTruthy();
    expect(reg.getFunctionByCodeName("timestamp")).toBeTruthy();
    expect(reg.getFunctionByCodeName("duration")).toBeTruthy();
    expect(reg.getFunctionByCodeName("parseIsoTimestamp")).toBeTruthy();
    expect(reg.getFunctionByCodeName("formatIsoTimestamp")).toBeTruthy();
    expect(reg.getFunctionByCodeName("addDuration")).toBeTruthy();
    expect(reg.getFunctionByCodeName("diffTimestamps")).toBeTruthy();
    expect(reg.getFunctionByCodeName("before")).toBeTruthy();
    expect(reg.getFunctionByCodeName("after")).toBeTruthy();
    expect(reg.getFunctionByCodeName("seconds")).toBeTruthy();
    expect(reg.getFunctionByCodeName("minutes")).toBeTruthy();
    expect(reg.getFunctionByCodeName("hours")).toBeTruthy();
    expect(reg.getFunctionByCodeName("days")).toBeTruthy();
  });
});

describe("time module — primitives", () => {
  it("timestamp builds a record with epochMs", () => {
    expect(call("timestamp", 1700000000000)).toEqual({ $tag: "Timestamp", epochMs: 1700000000000 });
  });

  it("duration builds a record with ms", () => {
    expect(call("duration", 5000)).toEqual({ $tag: "Duration", ms: 5000 });
  });

  it("now reads the current wall-clock time", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      expect(call("now")).toEqual({ $tag: "Timestamp", epochMs: 1700000000000 });
    } finally {
      spy.mockRestore();
    }
  });

  // parseIsoTimestamp is declared `returns: Maybe Timestamp` — Fenel-callable
  // view wraps in Just/Nothing; host-language null only lives in the
  // TS-internal `parseIsoTimestampNative` helper.
  it("parseIsoTimestamp accepts a valid ISO 8601 string", () => {
    expect(call("parseIsoTimestamp", "2024-01-01T00:00:00Z")).toEqual({
      $tag: "Just",
      _0: { $tag: "Timestamp", epochMs: Date.parse("2024-01-01T00:00:00Z") },
    });
  });

  it("parseIsoTimestamp is Nothing on garbage", () => {
    expect(call("parseIsoTimestamp", "not a date")).toEqual({ $tag: "Nothing" });
  });

  it("formatIsoTimestamp round-trips with parseIsoTimestamp", () => {
    const iso = "2024-06-15T12:34:56.000Z";
    const r = call("parseIsoTimestamp", iso) as { $tag: "Just"; _0: unknown };
    expect(r.$tag).toBe("Just");
    expect(call("formatIsoTimestamp", r._0)).toBe(iso);
  });
});

describe("time module — arithmetic", () => {
  it("addDuration shifts a timestamp forward", () => {
    const t = call("timestamp", 1000);
    const d = call("duration", 500);
    expect(call("addDuration", t, d)).toEqual({ $tag: "Timestamp", epochMs: 1500 });
  });

  it("diffTimestamps returns the span between two timestamps", () => {
    const a = call("timestamp", 5000);
    const b = call("timestamp", 1000);
    expect(call("diffTimestamps", a, b)).toEqual({ $tag: "Duration", ms: 4000 });
  });

  it("before is true when the first timestamp is earlier", () => {
    const a = call("timestamp", 1000);
    const b = call("timestamp", 2000);
    expect(call("before", a, b)).toBe(true);
    expect(call("before", b, a)).toBe(false);
  });

  it("after is true when the first timestamp is later", () => {
    const a = call("timestamp", 2000);
    const b = call("timestamp", 1000);
    expect(call("after", a, b)).toBe(true);
    expect(call("after", b, a)).toBe(false);
  });
});

describe("time module — duration constructors", () => {
  it("seconds n = n*1000 ms", () => {
    expect(call("seconds", 3)).toEqual({ $tag: "Duration", ms: 3000 });
  });

  it("minutes n = n*60000 ms", () => {
    expect(call("minutes", 2)).toEqual({ $tag: "Duration", ms: 120000 });
  });

  it("hours n = n*3600000 ms", () => {
    expect(call("hours", 1)).toEqual({ $tag: "Duration", ms: 3600000 });
  });

  it("days n = n*86400000 ms", () => {
    expect(call("days", 1)).toEqual({ $tag: "Duration", ms: 86400000 });
  });

  it("composes: 1 day + 2 hours = 26h in ms", () => {
    const oneDay = call("days", 1) as { ms: number };
    const twoHours = call("hours", 2) as { ms: number };
    expect(oneDay.ms + twoHours.ms).toBe(26 * 3600000);
  });
});
