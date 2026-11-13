import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setExprToSQL } from "./set-expr-sql";

const column = () => sql.raw('"value"');

describe("setExprToSQL boundary normalization", () => {
  test("legacy wire input compiles identically to its canonical SetExpr", () => {
    const legacy = setExprToSQL({ $enum: ["US", "CA"] }, column());
    const canonical = setExprToSQL(
      { $tag: "SeEnum", values: ["US", "CA"] },
      column(),
    );
    expect(legacy.queryChunks).toEqual(canonical.queryChunks);
  });

  test("mixed recursive wire trees normalize before Fenel dispatch", () => {
    const legacy = setExprToSQL(
      {
        $union: [
          { $tag: "SeEnum", values: ["US"] },
          { $complement: { $none: true } },
        ],
      },
      column(),
    );
    const canonical = setExprToSQL(
      {
        $tag: "SeUnion",
        branches: [
          { $tag: "SeEnum", values: ["US"] },
          { $tag: "SeComplement", inner: { $tag: "SeNone" } },
        ],
      },
      column(),
    );
    expect(legacy.queryChunks).toEqual(canonical.queryChunks);
  });

  test("malformed boundary input is rejected instead of entering the body", () => {
    expect(() => setExprToSQL({ $enum: "US" }, column())).toThrow(TypeError);
  });
});
