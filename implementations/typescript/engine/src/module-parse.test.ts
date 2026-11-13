import { describe, it, expect } from "vitest";
import { parse } from "./fenel-parser";
import { loadFenelModule } from "./fenel-module";

// ---------------------------------------------------------------------------
// module-substrate Phase 2a — parser `module … where` header + Haskell
// `import` forms (syntax → AST + capture). ADDITIVE + SYNTACTIC only: nothing
// resolves here (no name resolution, no `Module` value, no import taking
// effect — that is Phase 2b). These assert the parsed AST node shapes and the
// `loadFenelModule` capture (FenelModule.name from the header, imports list),
// plus the regression guard that header-less files and the contextual
// keywords-as-identifiers still behave.
// ---------------------------------------------------------------------------

describe("parse — module header", () => {
  it("bare name → module_decl", () =>
    expect(parse("module Telegram where")).toEqual({ module_decl: { name: "Telegram" } }));
  it("dotted / nested name kept as one string", () =>
    expect(parse("module Telegram.Notify where")).toEqual({
      module_decl: { name: "Telegram.Notify" },
    }));
});

describe("parse — import forms", () => {
  it("qualified-only", () =>
    expect(parse("import Telegram")).toEqual({
      import_decl: { module: "Telegram", qualified: true },
    }));
  it("qualified-only, dotted module name", () =>
    expect(parse("import Telegram.Notify")).toEqual({
      import_decl: { module: "Telegram.Notify", qualified: true },
    }));
  it("selective, unqualified", () =>
    expect(parse("import Telegram (run_collector, stop_collector)")).toEqual({
      import_decl: { module: "Telegram", names: ["run_collector", "stop_collector"] },
    }));
  it("selective, single name + trailing-comma tolerant", () =>
    expect(parse("import Telegram (run_collector)")).toEqual({
      import_decl: { module: "Telegram", names: ["run_collector"] },
    }));
  it("alias", () =>
    expect(parse("import Telegram as Tg")).toEqual({
      import_decl: { module: "Telegram", as: "Tg" },
    }));
  it("exclusion (hiding)", () =>
    expect(parse("import Telegram hiding (run_collector)")).toEqual({
      import_decl: { module: "Telegram", hiding: ["run_collector"] },
    }));
});

describe("loadFenelModule — header drives the module name (OQ3)", () => {
  it("header overrides the arg-supplied name + flows into function ids", () => {
    const mod = loadFenelModule(
      `
      module Demo where

      addOne : Number -> Number
      addOne x = x + 1

      double x = x * 2
      `,
      "fallback-arg",
    );
    expect(mod.name).toBe("Demo");
    expect(mod.functions).toHaveLength(2);
    expect(mod.functions!.map((f) => f.id)).toEqual(["Demo:addOne", "Demo:double"]);
    // The defs round-trip unchanged — the header doesn't disturb the def stream.
    expect(mod.functions![0]!.body).toEqual({ call: ["add", { var: "x" }, 1] });
    expect(mod.functions![1]!.body).toEqual({ call: ["mul", { var: "x" }, 2] });
  });

  it("captures all four import forms onto FenelModule.imports", () => {
    const mod = loadFenelModule(
      `
      module Demo where

      import Telegram
      import Util (helperA, helperB)
      import Telegram as Tg
      import Other hiding (skipMe)

      addOne x = x + 1
      `,
      "fallback-arg",
    );
    expect(mod.name).toBe("Demo");
    expect(mod.imports).toEqual([
      { module: "Telegram", qualified: true },
      { module: "Util", names: ["helperA", "helperB"] },
      { module: "Telegram", as: "Tg" },
      { module: "Other", hiding: ["skipMe"] },
    ]);
    // Imports don't resolve in 2a — the def still loads against the header name.
    expect(mod.functions).toHaveLength(1);
    expect(mod.functions![0]!.id).toBe("Demo:addOne");
  });
});

describe("loadFenelModule — header-less files keep the arg fallback (143-file regression guard)", () => {
  it("no header → arg-supplied name + no imports key", () => {
    const mod = loadFenelModule(
      `
      addOne : Number -> Number
      addOne x = x + 1
      `,
      "demo",
    );
    expect(mod.name).toBe("demo");
    expect(mod.functions![0]!.id).toBe("demo:addOne");
    expect(mod.imports).toBeUndefined();
  });
});

describe("module / import / as / hiding stay ordinary identifiers (contextual, not reserved)", () => {
  it("bare `module` / `import` are plain variables", () => {
    expect(parse("module")).toEqual({ var: "module" });
    expect(parse("import")).toEqual({ var: "import" });
    expect(parse("as")).toEqual({ var: "as" });
    expect(parse("hiding")).toEqual({ var: "hiding" });
  });
  it("`as` / `hiding` / `module` usable as function params + body refs", () => {
    const mod = loadFenelModule(
      `
      pick as hiding module = as
      `,
      "demo",
    );
    const fn = mod.functions![0]!;
    expect(fn.params.map((p) => p.name)).toEqual(["as", "hiding", "module"]);
    expect(fn.body).toEqual({ var: "as" });
  });
  it("`import foo` (lowercase arg) is application, NOT an import decl", () => {
    // The guard requires an uppercase module name, so a lowercase argument
    // falls through to ordinary application parsing.
    const out = parse("import foo");
    expect(out).not.toHaveProperty("import_decl");
  });
});
