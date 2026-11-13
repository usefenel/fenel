import { describe, it, expect } from "vitest";
import { loadFenelModule as loadModuleRaw } from "./fenel-module";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { Nothing } from "./type-foundation";

// 7g-parser: the parser emits a user-written type-name ref as `{$ref:H}` (was
// `{$ref:H}`). These loader tests assert param/return/entity-type STRUCTURE,
// where the reference's value form is incidental — fold `{$ref:H}`→`{$ref:H}`
// in the TYPE positions only (params / returns / entity types), NEVER in bodies
// (a body may hold a value-position `{$ref}` function reference, which must
// stay). The producer form is pinned in `typed-ref-parser-producer.test.ts`.
function foldRefs(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(foldRefs);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string" && Object.keys(o).length === 1) {
      return { $ref: o.$ref };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = foldRefs(o[k]);
    return out;
  }
  return t;
}
function loadFenelModule(...args: Parameters<typeof loadModuleRaw>): ReturnType<typeof loadModuleRaw> {
  const mod = loadModuleRaw(...args);
  return {
    ...mod,
    functions: mod.functions?.map((f) => ({
      ...f,
      params: foldRefs(f.params) as typeof f.params,
      returns: foldRefs(f.returns) as typeof f.returns,
    })) as typeof mod.functions,
    entities: mod.entities?.map((e) => ({ ...e, type: foldRefs(e.type) as typeof e.type })) as typeof mod.entities,
  };
}
describe("loadFenelModule — basic", () => {
  it("def-only slots are independent Absent obligations, never one shared generic", () => {
    const mod = loadFenelModule(`addOne x = x + 1`, "demo");
    expect(mod.functions).toHaveLength(1);
    const fn = mod.functions![0]!;
    expect(fn.id).toBe("demo:addOne");
    expect(fn.params).toEqual([{
      name: "x",
      label: Nothing,
      type: { $var: "__absent__demo:addOne__param-0" },
      meta: {},
      ui: Nothing,
    }]);
    expect(fn.returns).toEqual({ $var: "__absent__demo:addOne__return" });
    expect(fn.params[0]!.type).not.toEqual(fn.returns);
    expect(mod.functionSignatureDeclarations).toEqual([expect.objectContaining({
      functionId: "demo:addOne",
      declarationName: "addOne",
      codeName: "addOne",
      params: [{ $tag: "Absent" }],
      returns: { $tag: "Absent" },
    })]);
    expect(fn.body).toEqual({ call: ["add", { var: "x" }, 1] });
  });

  it("type sig + def produces a typed FenelFunction", () => {
    const mod = loadFenelModule(`
      addOne : Number -> Number
      addOne x = x + 1
    `, "demo");
    expect(mod.functions).toHaveLength(1);
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([{ name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }]);
    expect(fn.returns).toEqual({ $ref: "Number" });
    const declaration = mod.functionSignatureDeclarations![0]!;
    expect(declaration.params).toEqual([{
      $tag: "Authored",
      source: { $tag: "SourceTypeSig", module: "demo", declaration: "addOne" },
    }]);
    expect(declaration.returns).toEqual({
      $tag: "Authored",
      source: { $tag: "SourceTypeSig", module: "demo", declaration: "addOne" },
    });
    expect(declaration.scheme).toBeDefined();
  });

  it("multi-param signature pairs with def param names", () => {
    const mod = loadFenelModule(`
      add : (Number, Number) -> Number
      add x y = x + y
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([
      { name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "y", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
    ]);
  });

  it("curried arrow signature pairs each layer with each def param", () => {
    const mod = loadFenelModule(`
      add3 : Number -> Number -> Number -> Number
      add3 x y z = x + y + z
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([
      { name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "y", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "z", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
    ]);
    expect(fn.returns).toEqual({ $ref: "Number" });
  });

  it("curried sig with mixed multi-arg and curried layers", () => {
    const mod = loadFenelModule(`
      f : (Number, String) -> Bool -> Number
      f n s b = n
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([
      { name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "s", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
      { name: "b", label: Nothing, type: { $ref: "Bool" }, meta: {}, ui: Nothing },
    ]);
    expect(fn.returns).toEqual({ $ref: "Number" });
  });

  it("curried sig with arrow-typed param (function as data)", () => {
    const mod = loadFenelModule(`
      apply2 : (Number -> Number) -> Number -> Number
      apply2 f x = f x
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([
      {
        name: "f",
        label: Nothing,
        type: {
          $arrow: {
            params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
            returns: { $ref: "Number" },
          },
        },
        meta: {},
        ui: Nothing,
      },
      { name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
    ]);
    expect(fn.returns).toEqual({ $ref: "Number" });
  });

  it("def with more params than sig records the trailing slot as Absent", () => {
    const mod = loadFenelModule(`
      partial : Number -> String
      partial x y = x
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([
      { name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
      { name: "y", label: Nothing, type: { $var: "__absent__demo:partial__param-1" }, meta: {}, ui: Nothing },
    ]);
    expect(fn.returns).toEqual({ $ref: "String" });
    const declaration = mod.functionSignatureDeclarations![0]!;
    expect(declaration.params.map((slot) => slot.$tag)).toEqual(["Authored", "Absent"]);
    expect(declaration.returns.$tag).toBe("Authored");
  });

  it("def with fewer params than sig has arrow layers leaves return as remaining arrow", () => {
    const mod = loadFenelModule(`
      curried : Number -> Number -> Number
      curried x = x
    `, "demo");
    const fn = mod.functions![0]!;
    expect(fn.params).toEqual([{ name: "x", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }]);
    expect(fn.returns).toEqual({
      $arrow: {
        params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
        returns: { $ref: "Number" },
      },
    });
  });

  it("emits Codeable unconditionally; NO Labelable/Categorizable without @label/@category (Phase 3j)", () => {
    const mod = loadFenelModule(`addOne x = x + 1`, "demo");
    const codeable = mod.instances!.find((i) => i.typeName === "Codeable");
    const cat = mod.instances!.find((i) => i.typeName === "Categorizable");
    const label = mod.instances!.find((i) => i.typeName === "Labelable");
    expect(codeable?.methods.codeName).toBe("addOne");
    // Phase 3j (identity-as-fallback): the loader no longer auto-stamps a
    // module-name Categorizable or humanized-codeName Labelable default — an
    // undecorated def carries Codeable ONLY; the category/label derive at read
    // time (displayCategory / displayLabel). Symmetric with defineFunction.
    expect(cat).toBeUndefined();
    expect(label).toBeUndefined();
  });
});

describe("loadFenelModule — type defs", () => {
  it("multi-constructor ADT becomes a $variant entity", () => {
    const mod = loadFenelModule(`Color = Red | Green | Blue`, "demo");
    const type = {
      $variant: {
        cases: [
          { name: "Red", label: Nothing, fields: [] },
          { name: "Green", label: Nothing, fields: [] },
          { name: "Blue", label: Nothing, fields: [] },
        ],
      },
    };
    expect(mod.entities).toEqual([{
      id: "Color",
      module: "demo",
      type,
      typeScheme: { quantified: [], body: type, applications: [], diagnostics: [] },
    }]);
  });

  it("single-record constructor becomes a $record entity", () => {
    const mod = loadFenelModule(`
      Profile = Profile name: String age: Number
    `, "demo");
    const type = {
      $record: {
        fields: [
          { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "age", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
        ],
      },
    };
    expect(mod.entities).toEqual([{
      id: "Profile",
      module: "demo",
      type,
      typeScheme: { quantified: [], body: type, applications: [], diagnostics: [] },
    }]);
  });

  it("ADT with positional payload constructors", () => {
    const mod = loadFenelModule(`Maybe<T> = Nothing | Some T`, "demo");
    const ent = mod.entities![0]!;
    expect(ent.id).toBe("Maybe");
    expect(ent.type).toEqual({
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing, fields: [] },
          { name: "Some", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $var: "T" }, meta: {}, ui: Nothing }] },
        ],
      },
    });
    expect(ent.params).toEqual(["T"]);
    expect(ent.typeScheme).toEqual({
      quantified: [{ id: "q0", sourceName: "T", kind: { $tag: "KType" } }],
      body: ent.type,
      applications: [],
      diagnostics: [],
    });
  });

  it("preserves parser-origin positional keys without classifying `_n` names", () => {
    const mod = loadFenelModule(
      `Mixed = Mixed :Number named: String`,
      "demo",
    );
    expect(mod.entities![0]!.type).toEqual({
      $variant: {
        cases: [{
          name: "Mixed",
          label: Nothing,
          fields: [
            { name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
            { name: "named", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          ],
        }],
      },
    });
  });
});

describe("loadFenelModule — parser-origin function params", () => {
  it("reindexes flattened positional keys by occurrence order", () => {
    const mod = loadFenelModule(
      `@native
foreignCall : (named: String) -> Number -> String`,
      "demo",
    );
    expect(mod.functions![0]!.params).toEqual([
      {
        name: "named",
        label: Nothing,
        type: { $ref: "String" },
        meta: {},
        ui: Nothing,
      },
      {
        name: "_1",
        key: { $tag: "PositionalField", index: 1 },
        label: Nothing,
        type: { $ref: "Number" },
        meta: {},
        ui: Nothing,
      },
    ]);
  });
});

describe("loadFenelModule — end-to-end via registry", () => {
  it("registered function is callable through the evaluator", () => {
    const mod = loadFenelModule(`
      echo : String -> String
      echo x = x
    `, "demo");
    const reg = createRegistry([mod]);
    const ctx = reg.evaluateContext();
    expect(evaluate({ call: ["echo", "loaded"] }, {}, ctx)).toBe("loaded");
  }, 60_000);

  it("a module function can call another module function", () => {
    const mod = loadFenelModule(`
      echo : String -> String
      echo x = x

      echoTwice : String -> String
      echoTwice x = echo (echo x)
    `, "demo");
    const reg = createRegistry([mod]);
    const ctx = reg.evaluateContext();
    expect(evaluate({ call: ["echoTwice", "nested"] }, {}, ctx)).toBe("nested");
  }, 60_000);
});

describe("loadFenelModule — fixity decls", () => {
  it("fixity declarations don't crash the loader", () => {
    const mod = loadFenelModule(`
      infixl 6 +

      double : Number -> Number
      double x = x + x
    `, "demo");
    expect(mod.functions).toHaveLength(1);
  });

  it("surfaces fixity declarations on the module", () => {
    const mod = loadFenelModule(`
      infixl 9 .
      infixl 1 |>
      infixr 5 ::
    `, "demo");
    expect(mod.fixities).toEqual([
      { op: ".", assoc: "l", prec: 9 },
      { op: "|>", assoc: "l", prec: 1 },
      { op: "::", assoc: "r", prec: 5 },
    ]);
  });

  it("module with no fixities omits the field", () => {
    const mod = loadFenelModule(`addOne x = x + 1`, "demo");
    expect(mod.fixities).toBeUndefined();
  });
});

describe("loadFenelModule — custom operator definitions", () => {
  it("(.) function composition can be defined and registered", () => {
    const mod = loadFenelModule(`
      (.) f g = \\x -> f (g x)
    `, "demo");
    expect(mod.functions).toHaveLength(1);
    expect(mod.functions![0]!.id).toBe("demo:.");
    const codeable = mod.instances!.find((i) => i.typeName === "Codeable");
    expect(codeable?.methods.codeName).toBe(".");
  });
});

describe("loadFenelModule — empty / edge cases", () => {
  it("empty source", () => {
    const mod = loadFenelModule(``, "demo");
    expect(mod.functions ?? []).toHaveLength(0);
    expect(mod.entities ?? []).toHaveLength(0);
  });

  it("type sig without matching def is dropped", () => {
    const mod = loadFenelModule(`orphan : Number -> Number`, "demo");
    expect(mod.functions ?? []).toHaveLength(0);
  });
});
