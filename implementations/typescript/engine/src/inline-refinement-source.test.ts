// C1 test harness: exact source trees, both parser paths and evaluator laziness.
import { describe, expect, it } from "bun:test";
import { parse } from "./fenel-parser";
import { PARSE_VIA_FENEL_FAIL, marshalParsedFrames, parseViaFenelParser, print } from "./engine-bodies-dispatch";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { Expression } from "./types";

const CASES = [
  "sample : { count: (Number where value > 0), label: String }",
  "sample : { count: (Number where value > 0, value < 10), label: String }",
  "sample : (count: (Number where value > 0, value < 10), label: String) -> Boolean",
  "sample : ((Number where value > 0, value < 10), String)",
  "sample : { check: ((count: (Number where value > 0), label: String) -> Boolean), enabled: Boolean }",
  "sample : Maybe (a where accepts value)",
  "sample : { value: (f a where accepts value), enabled: Boolean }",
  "sample : Number where value > 0, value < 10, value != 5",
  "sample : Number where (value : Number)",
  "sample : Number where (value : a)",
  "sample : { count: (Number where accepts (value : Box a)), label: String }",
  'sample : Boolean where eq { mk = "ref", name = "a" } { mk = "ref", name = "a" }',
] as const;

describe("inline refinement source — exact source round trips", () => {
  for (const source of CASES) {
    it(source, () => {
      const original = parse(source);
      const printed = print(original as never);
      expect(parse(printed)).toEqual(original);
      expect(print(parse(printed) as never)).toBe(printed);
      if (source.includes(", value")) expect(printed).toContain(", value");
    }, 60_000);
  }

  it("word-and remains a callable while comma conjunctions remain structural", () => {
    const commas = parse("sample : Number where value > 0, value < 10") as any;
    const word = parse("sample : Number where value > 0 and value < 10") as any;
    expect(commas.type_sig.type.$refined.set.pred).toHaveProperty("and");
    expect(word.type_sig.type.$refined.set.pred.call[0]).toBe("and");
    expect(parse(print(commas))).toEqual(commas);
    expect(parse(print(word))).toEqual(word);
  }, 60_000);

  it("comma conjunctions retain short circuit behavior after printing", () => {
    let calls = 0;
    const ctx = { natives: { probe: () => { calls++; return true; } } } as unknown as EvaluateContext;
    for (const first of [false, true]) {
      const original = parse(`sample : Number where ${first}, probe 1`) as any;
      const reparsed = parse(print(original)) as any;
      for (const tree of [original, reparsed]) {
        calls = 0;
        expect(evaluate(tree.type_sig.type.$refined.set.pred as Expression, {}, ctx)).toBe(first);
        expect(calls).toBe(first ? 1 : 0);
      }
    }
  }, 60_000);

  it("unsupported raw conjunction arities and nesting print an explicit gap", () => {
    for (const pred of [{ and: [] }, { and: [true] }, { and: [true, { and: [true, false] }] }]) {
      const tree = { type_sig: { name: "sample", type: { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred } } } } };
      const printed = print(tree as never);
      expect(printed).toContain("<no surface syntax:");
      expect(() => parse(printed)).toThrow();
    }
  }, 60_000);

  it("structural conjunctions nested in expressions refuse a misleading callable spelling", () => {
    const conjunction = { and: [false, { call: ["probe", 1] }] };
    const expressions = [
      { if: [conjunction, 1, 2] },
      { call: ["accepts", conjunction] },
      { let: { checked: conjunction } },
      { checked: conjunction, label: "rules" },
      [conjunction],
      { fn: [["value"], conjunction] },
    ];
    for (const expression of expressions) {
      const printed = print(expression as never);
      expect(printed).toContain("<no surface syntax: structural conjunctions outside flat refinement predicates>");
      expect(() => parse(printed)).toThrow();
      const type = { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred: expression } } };
      const refinedSource = print({ type_sig: { name: "sample", type } } as never);
      expect(refinedSource).toContain("<no surface syntax:");
      expect(() => parse(refinedSource)).toThrow();
    }
  }, 60_000);

  it("flat refinement clauses also refuse deeper structural conjunctions", () => {
    const pred = { and: [true, { if: [{ and: [false, true] }, true, false] }] };
    const type = { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred } } };
    const printed = print({ type_sig: { name: "sample", type } } as never);
    expect(printed).toContain("<no surface syntax:");
    expect(() => parse(printed)).toThrow();
  }, 60_000);

  it("callable-and and an ordinary and field keep their existing source", () => {
    for (const source of [
      "sample value = if value and true then 1 else 2",
      "sample value = accepts (value and true)",
      'sample = { and = [true, false], label = "rules" }',
    ]) {
      const original = parse(source);
      const printed = print(original as never);
      expect(printed).not.toContain("<no surface syntax:");
      expect(parse(printed)).toEqual(original);
    }
  }, 60_000);

  it("structural disjunctions refuse a misleading callable spelling at every expression depth", () => {
    const disjunction = { or: [true, { call: ["probe", 1] }] };
    const expressions = [
      disjunction,
      { or: [] },
      { or: [true] },
      { or: [false, true, { call: ["probe", 1] }] },
      { or: [false, disjunction] },
      { if: [disjunction, 1, 2] },
      { call: ["accepts", disjunction] },
      { let: { checked: disjunction } },
      { checked: disjunction, label: "rules" },
      [disjunction],
      { fn: [["value"], disjunction] },
    ];
    for (const expression of expressions) {
      const original = JSON.stringify(expression);
      const printed = print(expression as never);
      expect(printed).toContain("<no surface syntax: structural disjunctions>");
      expect(() => parse(printed)).toThrow();
      expect(JSON.stringify(expression)).toBe(original);
      const type = { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred: expression } } };
      const refinedSource = print({ type_sig: { name: "sample", type } } as never);
      expect(refinedSource).toContain("<no surface syntax: structural disjunctions>");
      expect(() => parse(refinedSource)).toThrow();
    }
  }, 60_000);

  it("flat refinement clauses refuse structural disjunctions without rewriting their tree", () => {
    const pred = { and: [true, { or: [true, { call: ["probe", 1] }] }] };
    const type = { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred } } };
    const original = JSON.stringify(type);
    const printed = print({ type_sig: { name: "sample", type } } as never);
    expect(printed).toContain("<no surface syntax: structural disjunctions>");
    expect(() => parse(printed)).toThrow();
    expect(JSON.stringify(type)).toBe(original);
  }, 60_000);

  it("stored disjunctions keep lazy evaluation while callable-or remains eager", () => {
    let calls = 0;
    const ctx = { natives: { probe: () => { calls++; return false; } } } as unknown as EvaluateContext;
    for (const first of [false, true]) {
      const structural = { or: [first, { call: ["probe", 1] }] };
      expect(print(structural as never)).toContain("<no surface syntax: structural disjunctions>");
      calls = 0;
      expect(evaluate(structural as Expression, {}, ctx)).toBe(first);
      expect(calls).toBe(first ? 0 : 1);
      const callable = parse(`${first} or probe 1`);
      const reparsed = parse(print(callable as never));
      expect(reparsed).toEqual(callable);
      for (const expression of [callable, reparsed]) {
        calls = 0;
        expect(evaluate(expression as Expression, {}, ctx)).toBe(first);
        expect(calls).toBe(1);
      }
    }
  }, 60_000);

  it("callable-or and an ordinary or field keep their exact source trees", () => {
    for (const source of [
      "sample value = if value or true then 1 else 2",
      "sample value = accepts (value or true)",
      "sample : Boolean where value or true",
      "sample : Boolean where true, value or true",
      'sample = { or = [true, false], label = "rules" }',
    ]) {
      const original = parse(source);
      const printed = print(original as never);
      expect(printed).not.toContain("<no surface syntax:");
      expect(parse(printed)).toEqual(original);
    }
  }, 60_000);
});

describe("inline refinement source — Fenel parser parity", () => {
  for (const source of CASES) {
    it(source, () => {
      const fenel = parseViaFenelParser(source);
      expect(fenel).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(fenel).toEqual(parse(source));
    }, 180_000);
  }

  it("callable-or source agrees across parsers while structural disjunction gaps are refused", () => {
    for (const source of [
      "sample value = if value or true then 1 else 2",
      "sample : Boolean where true, value or true",
      'sample = { or = [true, false], label = "rules" }',
    ]) {
      const original = parse(source);
      const printed = print(original as never);
      expect(parseViaFenelParser(source)).toEqual(original);
      expect(parseViaFenelParser(printed)).toEqual(original);
    }
    const disjunction = { or: [true, { call: ["probe", 1] }] };
    const type = { $refined: { base: { $ref: "Boolean" }, set: { $tag: "SeWhere", pred: disjunction } } };
    for (const expression of [disjunction, { if: [disjunction, 1, 2] }, { type_sig: { name: "sample", type } }]) {
      expect(parseViaFenelParser(print(expression as never))).toBe(PARSE_VIA_FENEL_FAIL);
    }
  }, 180_000);

  it("refinements remain outside the expression annotation fragment", () => {
    const source = "sample x = (x : Maybe (Int where value > 0))";
    expect(() => parse(source)).toThrow();
    expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
  }, 180_000);

  it("ungrouped inline refinements do not consume field or parameter delimiters", () => {
    for (const source of [
      "sample : { count: Number where value > 0, label: String }",
      "sample : (count: Number where value > 0, label: String) -> Boolean",
    ]) {
      expect(() => parse(source)).toThrow();
      expect(parseViaFenelParser(source)).toBe(PARSE_VIA_FENEL_FAIL);
    }
  }, 180_000);
});

describe("inline refinement source — own-data marker boundary", () => {
  const frame = (type: unknown) => [{ type_sig: {
    name: "sample", type,
    scheme: { body: type, quantified: [], applications: [], diagnostics: [] },
  } }];

  it("refuses accessor and inherited predicate slots without reading them", () => {
    let getterCalls = 0;
    const accessor = { mk: "where" };
    Object.defineProperty(accessor, "jl", { enumerable: true, get() { getterCalls++; return true; } });
    for (const set of [accessor, Object.assign(Object.create({ jl: true }), { mk: "where" })]) {
      expect(() => marshalParsedFrames(frame({ mk: "refined", base: { mk: "ref", name: "Boolean" }, set }))).toThrow();
    }
    expect(getterCalls).toBe(0);
  });

  it("refuses unsupported set markers and cycles through a refined base", () => {
    const marker: any = { mk: "refined", base: { mk: "ref", name: "Boolean" }, set: { mk: "setexpr", slice: "Boolean" } };
    expect(() => marshalParsedFrames(frame(marker))).toThrow();
    marker.base = marker;
    marker.set = { mk: "where", jl: true };
    expect(() => marshalParsedFrames(frame(marker))).toThrow();
  });

  it("preserves own __proto__ fields in plain and tagged predicate objects", () => {
    for (const jl of [
      JSON.parse('{"__proto__":{"and":[false,true]},"or":[true,false]}'),
      JSON.parse('{"$tag":"Custom","__proto__":{"and":[false,true]},"or":[true,false]}'),
      JSON.parse('{"$tag":"Custom","child":{"__proto__":{"and":[false,true]}}}'),
    ]) {
      const result = marshalParsedFrames(frame({ mk: "refined", base: { mk: "ref", name: "Boolean" }, set: { mk: "where", jl } })) as any;
      const predicate = result[0].type_sig.type.$refined.set.pred;
      const object = jl.child ? predicate.child : predicate;
      expect(predicate).toEqual(jl);
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(object, "__proto__")).toEqual({
        value: { and: [false, true] }, enumerable: true, configurable: true, writable: true,
      });
      expect(Object.hasOwn(object, "and")).toBe(false);
    }
  });

  it("refuses nested accessor and cyclic predicate graphs without reading accessors", () => {
    let getterCalls = 0;
    const child = {};
    Object.defineProperty(child, "and", { enumerable: true, get() { getterCalls++; return [true, false]; } });
    const cyclic: any = { or: [true] };
    cyclic.or.push(cyclic);
    for (const jl of [{ child }, { child: cyclic }]) {
      expect(() => marshalParsedFrames(frame({ mk: "refined", base: { mk: "ref", name: "Boolean" }, set: { mk: "where", jl } }))).toThrow();
    }
    expect(getterCalls).toBe(0);
  });
});
