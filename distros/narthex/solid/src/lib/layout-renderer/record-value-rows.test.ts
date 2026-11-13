import { describe, expect, test } from "bun:test";

// Record display rule (2026-11-06): the density decision of the one record
// owner. Extracted from the source so no Solid/DOM runtime is needed.
const source = await Bun.file(new URL("./record-value-rows.tsx", import.meta.url)).text();
const start = source.indexOf("export function recordDensity("), end = source.indexOf("export function RecordValueRows(");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`const DENSE_WIDTH = ${/DENSE_WIDTH = (\d+)/.exec(source)![1]};\n${source.slice(start, end)}`).replace(/^export /gm, "");
const recordDensity = new Function(`${code}; return recordDensity;`)();
const base = { hasDense: true, mode: "rows", inline: false, tight: false, layout: "one-line", width: 400 };

describe("record display density", () => {
  test("a record with room reads as rows; a nested record is one line", () => {
    expect(recordDensity(base)).toBe("rows");
    expect(recordDensity({ ...base, mode: "line", width: 50 })).toBe("line");
  });
  test("a one-line inline or compact cell, or a narrow one, keeps the per-field strip", () => {
    expect(recordDensity({ ...base, inline: true })).toBe("dense");
    expect(recordDensity({ ...base, tight: true })).toBe("dense");
    expect(recordDensity({ ...base, width: 120 })).toBe("dense");
  });
  test("a two-line preview card has room for rows; without a strip, rows always", () => {
    expect(recordDensity({ ...base, inline: true, layout: "two-line" })).toBe("rows");
    expect(recordDensity({ ...base, hasDense: false, width: 80, tight: true })).toBe("rows");
  });
});

// Nov 12 regression: the linked-data graph's row-limit context was created with an
// `undefined` default. Solid 2's useContext THROWS (ContextNotFoundError, an empty
// message in the production build) when a context is unset and its default is
// undefined, so every record drawn outside the graph replaced its lens with
// "Could not load data." (/demo/People and projects/Fenel). Evaluate the real
// declaration with Solid's own createContext/useContext, outside and inside a provider.
describe("record row limit context", () => {
  const declaration = /export const RecordRowLimitContext[^;]*;/.exec(source)?.[0];
  test("is read without a provider (every record outside the graph) and inside one", async () => {
    expect(declaration).toBeDefined();
    const { createContext, createRoot, useContext } = await import("solid-js") as any;
    const context = new Function("createContext", `${new Bun.Transpiler({ loader: "ts" })
      .transformSync(declaration!).replace(/^export /gm, "")}; return RecordRowLimitContext;`)(createContext);
    // RecordValueRows reads `useContext(RecordRowLimitContext)` and then its row limit.
    const readLimit = /useContext\(RecordRowLimitContext\)(\.\w+)?/.exec(source)?.[1] ?? "";
    const read = () => { const value = useContext(context); return readLimit ? value[readLimit.slice(1)] : value; };
    const outside = createRoot((dispose: () => void) => { try { return read(); } finally { dispose(); } });
    expect(outside).toBeUndefined();
    const provided = /<RecordRowLimitContext value=\{([^}]*\}?)\}/.exec(await Bun.file(new URL("../linked-data-graph-view.tsx", import.meta.url)).text())?.[1];
    expect(provided).toBeDefined();
    // The graph view's provider, as it writes it (`value={…}` with its CARD_ROWS = 2).
    const value = new Function("CARD_ROWS", `return (${provided});`)(2);
    const inside = createRoot((dispose: () => void) => {
      try { return context({ value, get children() { return read(); } })(); } finally { dispose(); }
    });
    expect(inside).toBe(2);
  });
});

// Polish item 1 (Nov 8): which field values open the small in-place editor.
const editStart = source.indexOf("export function fieldEditInPlace("), editEnd = source.indexOf("/** The density decision");
const fieldEditInPlace = editStart < 0 ? undefined : new Function(`${new Bun.Transpiler({ loader: "ts" })
  .transformSync(source.slice(editStart, editEnd)).replace(/^export /gm, "")}; return fieldEditInPlace;`)();

describe("in-place field editing", () => {
  test("a field edits in place only with the host's write port, outside templates, never a list", () => {
    expect(typeof fieldEditInPlace).toBe("function");
    expect(fieldEditInPlace({ port: true, templateOnly: false, value: { year: 2026, month: 11, day: 3 } })).toBe(true);
    expect(fieldEditInPlace({ port: true, templateOnly: false, value: "Sam Lee" })).toBe(true);
    expect(fieldEditInPlace({ port: false, templateOnly: false, value: "Sam Lee" })).toBe(false);
    expect(fieldEditInPlace({ port: true, templateOnly: true, value: 20 })).toBe(false);
    expect(fieldEditInPlace({ port: true, templateOnly: false, value: [1, 2] })).toBe(false);
  });
});
