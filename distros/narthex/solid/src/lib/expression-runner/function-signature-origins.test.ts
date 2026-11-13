import { describe, expect, test } from "bun:test";
import { functionSignatureOrigins } from "./function-signature-origins";

const authored = { $tag: "Authored", source: { $tag: "SourceTypeSig", module: "demo", declaration: "squareFormula" } } as const;
const inferred = { $tag: "Inferred", engine: "fenel", version: "1", derivation: null } as const;
const absent = { $tag: "Absent" } as const;

describe("a function's signature origins come from its declaration", () => {
  test("a written slot is declared; an inferred or absent slot is inferred", () => {
    expect(functionSignatureOrigins({ params: [authored, absent, inferred], returns: authored }))
      .toEqual({ params: ["declared", "inferred", "inferred"], returns: "declared" });
    expect(functionSignatureOrigins({ params: [authored], returns: absent })).toEqual({ params: ["declared"], returns: "inferred" });
  });

  test("no declaration: the origin is unknown, never guessed", () => {
    expect(functionSignatureOrigins(undefined)).toBeUndefined();
  });

  test("the focused function page hands its origins to the read frame", async () => {
    const home = (await Bun.file(new URL("../../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
    const start = home.indexOf("  const functionReadSource = createMemo(() => {\n    if (!props.functionExpression");
    const memo = home.slice(start, home.indexOf("\n  });\n", start));
    expect(memo).toContain("origins = functionSignatureOrigins(fn.signatureDeclaration);");
    expect(memo).toContain("return { node: shown, origins, current:");
    const reader = (await Bun.file(new URL("../layout-renderer/TypedReadValue.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
    expect(reader).toContain("signatureOrigins={props.functionSource?.origins}");
  });
});
