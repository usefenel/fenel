import { beforeAll, describe, expect, test } from "bun:test";
import { createRegistry, type ModuleRegistry } from "./registry";
import { inferJsonLogicType, type JsonLogicInferenceOptions } from "./signature-inference";
import {
  dispatchEngineBody,
  dispatchedJsonLogicToExpr,
  dispatchedJsonLogicToSyntax,
} from "./engine-bodies-dispatch";

// A list literal of plain data is ONE pureData-marked SLit
// (`json-logic-to-syntax.fenel:syntaxListLiteral`) instead of an N-deep
// lit-marked appendItem chain, which every pass used to recurse through: a
// 40 by 40 image literal overflowed the stack. TCB ledger row
// `infer.pure-data-literal`: the SLit is typed exactly as the chain, and
// desugar re-expands it into the chain's Expr.

type Pixel = { r: number; g: number; b: number; a: number };

let registry: ModuleRegistry;
beforeAll(async () => {
  const { stdModule } = await import("./modules/std");
  registry = createRegistry([stdModule], {
    publishCatalogEntities: false,
    fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source" },
  });
}, 600_000);

function options(bindings: JsonLogicInferenceOptions["bindings"] = {}): JsonLogicInferenceOptions {
  return {
    bindings,
    resolveFunction(name) {
      // The synthetic list call asks for the exact spelling `std.appendItem`.
      const id = registry.getIdentifiedFunction(name) ? name : name.replace(".", ":");
      const fn = registry.getIdentifiedFunction(id);
      if (!fn) return undefined;
      return {
        params: fn.params, returns: fn.returns, scheme: registry.getFunctionScheme(id),
        targetId: fn.id, signatureOutcome: registry.getFunctionSignatureInfo(id)?.outcome,
      };
    },
  };
}

const numberScheme = { quantified: [], body: { $ref: "Number" } };
const stringScheme = { quantified: [], body: { $ref: "String" } };

function image(width: number, height: number): { width: number; height: number; pixels: Pixel[] } {
  const pixels = Array.from({ length: width * height }, (_, index) => ({
    r: index % 256, g: (index * 7) % 256, b: (index * 13) % 256, a: 255,
  }));
  return { width, height, pixels };
}

/** The same image with one channel replaced by a variable: never plain data,
 *  so it keeps the lit-marked appendItem chain. */
function chainImage(width: number, height: number): unknown {
  const value = image(width, height);
  return { ...value, pixels: [{ ...value.pixels[0], r: { var: "n" } }, ...value.pixels.slice(1)] };
}

function infer(logic: unknown, bindings: JsonLogicInferenceOptions["bindings"] = {}) {
  const started = performance.now();
  const result = inferJsonLogicType(logic, options(bindings));
  return { ...result, ms: performance.now() - started };
}

describe("pure-data list literals", () => {
  test("lower to one pureData SLit; any non-data item keeps the chain", () => {
    const pure = dispatchedJsonLogicToSyntax([{ r: 1, g: 2, b: 3, a: 4 }, [1, "x", true, null], []]) as { _0: Record<string, unknown> };
    expect(pure._0).toEqual({
      $tag: "SLit", value: [{ r: 1, g: 2, b: 3, a: 4 }, [1, "x", true, null], []], pureData: true,
    });
    const mixed = dispatchedJsonLogicToSyntax([1, { var: "n" }]) as { _0: Record<string, unknown> };
    expect(mixed._0).toMatchObject({ $tag: "SCall", fnId: "appendItem", lit: true });
    // The empty list keeps its historical unmarked shape.
    expect((dispatchedJsonLogicToSyntax([]) as { _0: unknown })._0).toEqual({ $tag: "SLit", value: [] });
    // Single-key objects are operator forms, never plain data.
    const operator = dispatchedJsonLogicToSyntax([{ var: "n" }, 1]) as { _0: Record<string, unknown> };
    expect(operator._0).toMatchObject({ $tag: "SCall", fnId: "appendItem", lit: true });
  }, 600_000);

  test("the grammar's buildList and the JSON-Logic adapter build the same list Syntax", () => {
    // The Syntax-space parser differential compares exactly these two
    // builders; both go through syntaxListLiteral.
    const SLit = (value: unknown) => ({ $tag: "SLit", value });
    const SRecord = (fields: [string, unknown][]) => ({
      $tag: "SRecord", fields: fields.map(([name, value]) => ({ name, value })),
    });
    const cases: [unknown[], unknown][] = [
      [[SLit(1), SLit(2), SLit(3)], [1, 2, 3]],
      [[SRecord([["a", SLit(1)], ["b", SLit("x")]]), SRecord([["a", SLit(2)], ["b", SLit("y")]])],
        [{ a: 1, b: "x" }, { a: 2, b: "y" }]],
      [[SLit(1), { $tag: "SVar", name: "x" }], [1, { var: "x" }]],
      [[], []],
      // Nested lists and records with null, Boolean and empty members: the
      // adapter's JSON-level fast path must build what the general path builds.
      [[
        { $tag: "SLit", value: [1, 2], pureData: true },
        SLit([]),
        SRecord([["a", SLit(null)], ["b", { $tag: "SLit", value: [true], pureData: true }], ["c", SRecord([])]]),
      ], [[1, 2], [], { a: null, b: [true], c: {} }]],
    ];
    for (const [items, logic] of cases) {
      expect(dispatchEngineBody("engine:buildList", [items]))
        .toEqual((dispatchedJsonLogicToSyntax(logic) as { _0: unknown })._0);
    }
    // A $-prefixed key is still the general path's lowering error.
    let dollar: unknown;
    try { dollar = dispatchedJsonLogicToSyntax([{ $x: 1, y: 2 }, 3]); }
    catch (error) { dollar = { $tag: "Err", thrown: String(error) }; }
    expect(dollar).toMatchObject({ $tag: "Err" });
  }, 600_000);

  test("record name guards preserve pure-data lowering and duplicate-field fallback", () => {
    const SLit = (value: unknown) => ({ $tag: "SLit", value });
    const SRecord = (fields: Array<{ name: unknown; value: unknown }>) => ({ $tag: "SRecord", fields });
    const chain = (item: unknown) => ({
      $tag: "SCall", fnId: "appendItem", args: [item, SLit([])], lit: true,
    });
    const nothing = { $tag: "Nothing" };
    // Construct field lists directly: a JS object cannot carry duplicate names.
    // Equal duplicate values are still duplicate fields and must keep the chain.
    const cases: Array<{ entries: Array<[string, number]>; unique: boolean }> = [
      { entries: [], unique: true },
      { entries: [["a", 1], ["b", 2]], unique: true },
      { entries: [["", 1], ["A", 2], ["a", 3], ["é", 4], ["e\u0301", 5]], unique: true },
      { entries: [["a", 1], ["a", 1]], unique: false },
      { entries: [["a", 1], ["a", 2]], unique: false },
      { entries: [["a", 1], ["b", 2], ["a", 3]], unique: false },
      { entries: [["", 1], ["", 2]], unique: false },
    ];
    for (const { entries, unique } of cases) {
      const fields = entries.map(([name, value]) => ({ name, value: SLit(value) }));
      const record = SRecord(fields);
      const jlFields = entries.map(([name, value]) => ({ name, value: { $tag: "JlNumber", value } }));
      const raw = Object.fromEntries(entries);
      const expected = unique ? { $tag: "SLit", value: [raw], pureData: true } : chain(record);
      expect(dispatchEngineBody("engine:syntaxPureRecord", [fields]))
        .toEqual(unique ? { $tag: "Just", _0: raw } : nothing);
      expect(dispatchEngineBody("engine:jlsPureObject", [jlFields, null]))
        .toEqual(unique ? { $tag: "Just", _0: raw } : nothing);
      expect(dispatchEngineBody("engine:buildList", [[record]])).toEqual(expected);
      // Exercise the JSON-Logic adapter with its real tagged input, retaining
      // duplicate names all the way through its general lowering path.
      expect(dispatchEngineBody("engine:jsonLogicToSyntax", [
        { $tag: "JlArray", items: [{ $tag: "JlObject", fields: jlFields }] }, [], null,
      ])).toEqual({ $tag: "Ok", _0: expected });
    }

    const nonliteral = SRecord([
      { name: "a", value: SLit(1) }, { name: "b", value: { $tag: "SVar", name: "n" } },
    ]);
    expect(dispatchEngineBody("engine:syntaxPureRecord", [nonliteral.fields])).toEqual(nothing);
    expect(dispatchEngineBody("engine:buildList", [[nonliteral]])).toEqual(chain(nonliteral));
    expect(dispatchedJsonLogicToSyntax([{ a: 1, b: { var: "n" } }]))
      .toEqual({ $tag: "Ok", _0: chain(nonliteral) });

    // Existing field-shape/name guards must still refuse before object writes.
    for (const fields of [
      [{ name: 1, value: SLit(1) }, { name: "b", value: SLit(2) }],
      [{ name: "__proto__", value: SLit(1) }, { name: "b", value: SLit(2) }],
      [{ name: "1a", value: SLit(1) }, { name: "b", value: SLit(2) }],
      [{ name: "a", value: SLit(1), metadata: true }, { name: "b", value: SLit(2) }],
    ]) {
      expect(dispatchEngineBody("engine:syntaxPureRecord", [fields])).toEqual(nothing);
      expect(dispatchEngineBody("engine:buildList", [[SRecord(fields)]])).toEqual(chain(SRecord(fields)));
    }
    const numberNamed = [
      { name: 1, value: { $tag: "JlNumber", value: 1 } },
      { name: "b", value: { $tag: "JlNumber", value: 2 } },
    ];
    expect(dispatchEngineBody("engine:jlsPureObject", [numberNamed, null])).toEqual(nothing);
  }, 600_000);

  test("desugar re-expands to exactly the chain's Expr, and the JSON round-trips", () => {
    const ELit = (value: unknown) => ({ $tag: "ELit", value });
    const chain = (items: unknown[]) => items.reduce<unknown>(
      (acc, item) => ({ $tag: "ECall", fnId: "appendItem", args: [item, acc], lit: true }), ELit([]));
    const record = (fields: [string, unknown][]) => ({
      $tag: "ERecord", fields: fields.map(([name, value]) => ({ name, value })),
    });
    const logic = [{ r: 1, g: 2, b: 3, a: 4 }, { r: 5, g: 6, b: 7, a: 8 }];
    expect((dispatchedJsonLogicToExpr(logic) as { _0: unknown })._0).toEqual(chain([
      record([["r", ELit(1)], ["g", ELit(2)], ["b", ELit(3)], ["a", ELit(4)]]),
      record([["r", ELit(5)], ["g", ELit(6)], ["b", ELit(7)], ["a", ELit(8)]]),
    ]));
    expect((dispatchedJsonLogicToExpr([[1, 2], [], ["x"]]) as { _0: unknown })._0).toEqual(chain([
      chain([ELit(1), ELit(2)]), ELit([]), chain([ELit("x")]),
    ]));
    const syntax = (dispatchedJsonLogicToSyntax({ width: 2, height: 1, pixels: logic }) as { _0: unknown })._0;
    expect(dispatchEngineBody("engine:syntaxToJsonLogic", [syntax])).toEqual({ width: 2, height: 1, pixels: logic });
  }, 600_000);

  test("infers the same types as the chain for scalars, records, nested lists and mismatches", () => {
    const n = { n: numberScheme };
    expect(infer([1, 2, 3]).type).toEqual(infer([{ var: "n" }, 2, 3], n).type);
    expect(infer(["a", "b"]).type).toEqual(infer([{ var: "s" }, "b"], { s: stringScheme }).type);
    expect(infer([[1, 2], [3]]).type).toEqual(infer([[{ var: "n" }, 2], [3]], n).type);
    const pure = infer(image(2, 2));
    expect(pure.outcome.$tag, JSON.stringify(pure.outcome)).toBe("Solved");
    expect(pure.type).toEqual(infer(chainImage(2, 2), n).type);
    const mismatch = infer([1, "a"]);
    const chainMismatch = infer([{ var: "n" }, "a"], n);
    expect(mismatch.outcome.$tag).toBe("Invalid");
    expect(chainMismatch.outcome.$tag).toBe("Invalid");
    const codes = (outcome: typeof mismatch.outcome) =>
      outcome.$tag === "Invalid" ? outcome.diagnostics.map((diagnostic) => diagnostic.code) : [];
    expect(codes(mismatch.outcome)).toEqual(codes(chainMismatch.outcome));
    // Items are only skipped on an equal flat shape: a changed field kind, or
    // a field name that spells another record's key, is still inferred.
    expect(infer([{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: "x", b: 2 }]).outcome.$tag).toBe("Invalid");
    expect(infer([{ x: 1, y: "s", z: 1 }, { "x:n,y": "s", z: 1 }]).outcome.$tag).toBe("Invalid");
  }, 600_000);

  test("image literals infer without recursion over their pixels: 16x16 fast, 40x40 and 96x64 solved", () => {
    const small = infer(image(2, 2));
    const sixteen = infer(image(16, 16));
    const forty = infer(image(40, 40));
    const large = infer(image(96, 64));
    console.log(`image literal inference: 2x2 ${small.ms.toFixed(0)} ms, 16x16 ${sixteen.ms.toFixed(0)} ms, `
      + `40x40 ${forty.ms.toFixed(0)} ms, 96x64 ${large.ms.toFixed(0)} ms`);
    for (const result of [sixteen, forty, large]) {
      expect(result.outcome.$tag, JSON.stringify(result.outcome).slice(0, 400)).toBe("Solved");
      expect(result.type).toEqual(small.type);
    }
    const lowering = performance.now();
    dispatchedJsonLogicToSyntax(image(40, 40));
    console.log(`40x40 lowering alone (jsonLogicToSyntax): ${(performance.now() - lowering).toFixed(0)} ms`);
    // Interpreted engine bodies (a lane's stale compiled owners) took 3.6 s
    // here; the N-deep chain took 88 s and overflowed at 40x40.
    expect(sixteen.ms).toBeLessThan(20_000);
  }, 600_000);
});
