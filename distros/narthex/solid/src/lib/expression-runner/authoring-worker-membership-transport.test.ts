import { describe, expect, mock, test } from "bun:test";
// Run alone: mock.module replaces @fenel/engine for the whole bun process.
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";

// B3 fix 1: a membership candidate crosses page -> worker -> judgment with its
// own-key order intact. std.entries keeps insertion order, so a `$where`
// predicate on the first entry of {"z":1,"a":2} must see "z", not "a".
const seen: Array<{ where: string; keys: string[] }> = [];
const realEngine = await import("@fenel/engine");
const realExpressions = await import("@fenel/engine/expressions");
mock.module("@fenel/engine", () => ({
  ...realEngine,
  contains: (_set: unknown, value: Record<string, unknown>) => {
    seen.push({ where: "contains", keys: Object.keys(value) });
    return { $tag: "Just", _0: Object.keys(value)[0] === "z" };
  },
  validateWithHints: (value: Record<string, unknown>) => {
    seen.push({ where: "hints", keys: Object.keys(value) });
    return { valid: true, constraints: [], cursor: {}, firstKey: Object.keys(value)[0] };
  },
  evaluateWithTrace: (_pred: unknown, scope: { value: Record<string, unknown> }) => {
    seen.push({ where: "trace", keys: Object.keys(scope.value) });
    return { result: Object.keys(scope.value)[0], trace: [] };
  },
}));
mock.module("@fenel/engine/expressions", () => ({ ...realExpressions, pureEvaluateContext: (frame: unknown) => frame }));
const { runReaderExtension } = await import("./authoring-worker-reader-extensions");

// The page-side mode selection, read from the production client source.
const client = (await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = client.indexOf("export function preparedReaderTransportMode(");
if (start < 0) throw new Error("The prepared reader transport mode moved.");
const end = client.indexOf("\n}\n", start) + 3;
const preparedReaderTransportMode = new Function(`${new Bun.Transpiler({ loader: "ts" })
  .transformSync(client.slice(start, end).replace(/\r\n/g, "\n")).replace(/^export /gm, "")}; return preparedReaderTransportMode;`)() as (method: string) => "canonical" | "equality" | "value-read";

describe("B3 membership transport keeps key order", () => {
  test("candidate, hints and trace keep insertion order through both copies", async () => {
    const payload = { method: "check-set-membership" as const, set: { $tag: "SeWhere" as const, pred: { var: "value" } },
      values: [{ z: 1, a: 2 }], hints: { value: { z: 1, a: 2 }, cursor: 0 }, trace: { value: { z: 1, a: 2 } } };
    const page = registryTransportSnapshot(payload, "test page copy", preparedReaderTransportMode(payload.method));
    const wire = structuredClone(page);
    const session = { evaluateContext: {}, registry: {} } as never;
    const result = await runReaderExtension(wire as never, session, undefined, async () => {}) as {
      verdicts: Array<{ $tag: string; _0?: boolean }>; hints?: { firstKey?: string }; trace?: { result: unknown } };
    expect(seen).toEqual([{ where: "contains", keys: ["z", "a"] }, { where: "hints", keys: ["z", "a"] }, { where: "trace", keys: ["z", "a"] }]);
    expect(result.verdicts[0]).toEqual({ $tag: "Just", _0: true });
    expect(result.trace?.result).toBe("z");
  });

  // B3 fix 6: a request cancelled while it waited for its turn runs nothing.
  test("a request cancelled during its turn makes no semantic call and no reply", async () => {
    seen.length = 0;
    let cancelled = false;
    const result = await runReaderExtension({ method: "check-set-membership", set: { $tag: "SeAll" }, values: [{ z: 1 }] } as never,
      { evaluateContext: {}, registry: {} } as never, undefined, async () => { cancelled = true; }, () => cancelled);
    expect(result).toBeUndefined();
    expect(seen).toEqual([]);
  });
});
