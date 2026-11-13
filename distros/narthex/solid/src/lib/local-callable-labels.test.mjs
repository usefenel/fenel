import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The actual production helper body, extracted without its module's worker,
// storage and Solid imports (the established Bun.Transpiler pattern).
const source = readFileSync(new URL("./local-locus-data.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const from = source.indexOf("export function catalogCallableLabels(");
const to = source.indexOf("\n}\n", from);
if (from < 0 || to < 0) throw new Error("catalogCallableLabels source boundary moved");
const { catalogCallableLabels } = new Function(new Bun.Transpiler({ loader: "ts" })
  .transformSync(source.slice(from, to + 3)).replaceAll("export ", "") + "; return { catalogCallableLabels };")();

const fn = (id, label, targetId) => ({ id, label, kind: "function", params: [], ...(targetId ? { targetId } : {}) });

describe("dependency labels for catalogue callables", () => {
  test("a {$ref} identity route labels the bound function like its code name", () => {
    const count = fn("std:countByKey", "Count by key");
    const labels = catalogCallableLabels({ functions: [count, fn("std:reverse", "Reverse")], exactFunctionRoutes: [
      { sourceName: "std.countByKey", targetId: "std:countByKey", status: "resolved", entry: count },
      { sourceName: "c64c4ac2-uuid", targetId: "c64c4ac2-uuid", status: "resolved", entry: { ...count, targetId: "c64c4ac2-uuid" } },
      { sourceName: "ambiguous-uuid", targetId: "ambiguous-uuid", status: "ambiguous" },
      { sourceName: "fenced-uuid", targetId: "fenced-uuid", status: "fenced", entry: count },
    ] });
    expect(labels).toEqual([
      { id: "std:countByKey", label: "Count by key" }, { id: "std:reverse", label: "Reverse" },
      { id: "c64c4ac2-uuid", label: "Count by key" },
    ]);
  });

  test("code names keep their rows, no identity is listed twice, and routes are optional", () => {
    const aliased = fn("alias", "Aliased", "target-id");
    expect(catalogCallableLabels({ functions: [aliased] })).toEqual([{ id: "target-id", label: "Aliased" }]);
    expect(catalogCallableLabels({ functions: [aliased], exactFunctionRoutes: [
      { sourceName: "target-id", targetId: "target-id", status: "resolved", entry: { ...aliased, label: "Other" } },
    ] })).toEqual([{ id: "target-id", label: "Aliased" }]);
  });
});
