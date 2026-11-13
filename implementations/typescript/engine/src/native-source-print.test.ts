// C1 tooling harness: actual source printer -> parser -> source evaluator.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { capturePrintSourceRepresentations, dispatchEngineBody, print, printType, type PrintSourceContext } from "./engine-bodies-dispatch";
import { parse } from "./fenel-parser";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { unitsModule } from "./modules/units";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { parseEntityDef, printEntityDef } from "./entity-def-printer";
import type { FenelType } from "./types";

let context: EvaluateContext | undefined;
function sourceFrame(): PrintSourceContext {
  const ctx = context ??= createRegistry([stdModule, unitsModule], { fieldIdentity: {
    mode: "source-handles", defaultRealm: "repository-source", cacheKey: "native-source-print:checked-source-context",
  } }).evaluateContext();
  return {
    evaluateContext: ctx,
    representationSources: capturePrintSourceRepresentations({ $tag: "Rational", num: "0", den: "1" }, ctx),
  };
}

// Prepare the owning registry and private source printer once. Cold source
// preparation has its own bound; individual round trips retain their 60s gate.
beforeAll(() => {
  print({ $tag: "Rational", num: "0", den: "1" }, undefined, sourceFrame());
}, 180_000);

function evaluatePrinted(value: unknown): unknown {
  const frame = sourceFrame();
  const source = print(value, undefined, frame);
  expect(source).not.toContain("<no surface syntax:");
  expect(source).not.toContain('Rational { num = "');
  return evaluate(parse(source), {}, frame.evaluateContext!);
}

function evaluatePrintedType(type: FenelType, frame = sourceFrame()): FenelType {
  const source = printType(type, frame);
  expect(source).not.toContain("<no surface syntax:");
  const parsed = parse(`reading : ${source}`) as { type_sig: { type: { $el: object } } };
  return evaluate(parsed.type_sig.type.$el, {}, frame.evaluateContext!) as FenelType;
}

afterAll(() => {
  if (process.env.SOURCE_PRINTER_MEDIA !== "1") return;
  const frame = sourceFrame();
  const unit = evaluate(parse("units.celsius"), {}, frame.evaluateContext!);
  const quantity = invokeCallable({ $ref: "units:measureType" }, [
    { $ref: "Rational" }, { $tag: "MeasureAtom", unit },
  ], frame.evaluateContext!) as FenelType;
  const after = printEntityDef("Reading", "Reading", [
    { id: "amount", type: quantity }, { id: "note", type: { $ref: "String" } },
  ], undefined, frame);
  const parsed = parseEntityDef(after);
  expect("error" in parsed).toBe(false);
  writeFileSync(".tmp/ui-feedback/unit-code-after.fenel", after);
  writeFileSync(".tmp/ui-feedback/source-printer-media-data.json", JSON.stringify({
    before: readFileSync(".tmp/ui-feedback/unit-code-before.fenel", "utf8"), after, quantity, unit,
  }, null, 2));
  const choicePath = ".tmp-diag/typed-choice-identity/source-facts.json";
  if (existsSync(choicePath)) {
    const facts = JSON.parse(readFileSync(choicePath, "utf8")) as { options: { label: string; value: unknown }[]; beforeOptions?: unknown };
    facts.beforeOptions = facts.options.map((option, index) => index === 6 || index === 7
      ? { ...option, label: print(option.value, undefined, frame) } : option);
    writeFileSync(choicePath, JSON.stringify(facts, null, 2));
  }
});

describe("native representations use registered source projections", () => {
  test("fractions and huge coprime integer parts survive source re-entry", () => {
    for (const value of [
      { $tag: "Rational", num: "3", den: "10" },
      { $tag: "Rational", num: "1", den: "3" },
      { $tag: "Rational", num: "900719925474099312345678901234567891", den: "1000000000000000000000000000000000000" },
      { $tag: "Rational", num: "-123456789012345678901234567890123456789", den: "1000000000000000000000000000000000000000" },
    ]) {
      expect(print(value, undefined, sourceFrame())).toContain("std.parseRational");
      expect(evaluatePrinted(value)).toEqual(value);
    }
  }, 60_000);

  test("nested constructors and lists keep their exact children", () => {
    const value = { $tag: "Just", _0: [
      { $tag: "Rational", num: "1", den: "3" },
      { $tag: "Rational", num: "12345678901234567890123456789", den: "10000000000000000000000000000" },
    ] };
    expect(evaluatePrinted(value)).toEqual(value);
  }, 60_000);

  // Known source-owner gap: List has Reprable methods but no captured complete
  // Membership/Eq profile, so the printer refuses an otherwise expressible Cons.
  test.todo("pure list constructors retain their authored source form", () => {
    const frame = sourceFrame();
    const value = evaluate(parse("Cons 1 Nil"), {}, frame.evaluateContext!);
    const source = print(value, undefined, { evaluateContext: frame.evaluateContext });
    expect(source).not.toContain("<no surface syntax:");
    expect(evaluate(parse(source), {}, frame.evaluateContext!)).toEqual(value);
  }, 60_000);

  test("mathematically equal codec output cannot replace observable data fields", () => {
    const frame = sourceFrame();
    const ordinaryRational = { $tag: "Rational", num: 1, den: 2 };
    const ordinarySource = print(ordinaryRational, undefined, frame);
    expect(ordinarySource).toContain("std.rationalRepresentationLower");
    expect(evaluate(parse(ordinarySource), {}, frame.evaluateContext!)).toEqual(ordinaryRational);
    const rational = { $tag: "Rational", num: "2", den: "4" };
    const decodedRational = evaluate(parse('std.parseRational "2/4"'), {}, frame.evaluateContext!) as { $tag: string; _0: unknown };
    expect(decodedRational.$tag).toBe("Ok");
    expect(invokeCallable({ $ref: "std:ratEqM" }, [rational, decodedRational._0], frame.evaluateContext!))
      .toEqual({ $tag: "Just", _0: true });
    const numeratorSource = parse("std.intToExactText value.num");
    expect(evaluate(numeratorSource, { value: rational }, frame.evaluateContext!)).toBe("2");
    expect(evaluate(numeratorSource, { value: decodedRational._0 }, frame.evaluateContext!)).toBe("1");
    expect(print(rational, undefined, frame)).toContain("round trip changed data fields or abstained");
    const lowerFrame = { ...frame, representationSources: frame.representationSources!.map(({ encodeText: _encode, decodeText: _decode, ...row }) => row) };
    expect(print(rational, undefined, lowerFrame)).toContain("round trip changed data fields or abstained");

    const negativeZero = { $tag: "Int", magnitude: 0, negative: true };
    const decodedInt = evaluate(parse('std.parseIntExact "-0"'), {}, frame.evaluateContext!) as { $tag: string; _0: unknown };
    expect(decodedInt.$tag).toBe("Ok");
    expect(invokeCallable({ $ref: "std:intEqM" }, [negativeZero, decodedInt._0], frame.evaluateContext!))
      .toEqual({ $tag: "Just", _0: true });
    const signSource = parse("case value of Int { negative = sign } -> sign");
    expect(evaluate(signSource, { value: negativeZero }, frame.evaluateContext!)).toBe(true);
    expect(evaluate(signSource, { value: decodedInt._0 }, frame.evaluateContext!)).toBe(false);
    expect(print(negativeZero, undefined, { evaluateContext: frame.evaluateContext }))
      .toContain("round trip changed data fields or abstained");
    expect(print({ $tag: "Rational", num: { $tag: "Int", magnitude: 1, negative: false }, den: 2 }, undefined, frame))
      .toContain("round trip changed data fields or abstained");
  }, 60_000);

  test("the owning frame captures exact Nat and Int codecs for large carriers", () => {
    const frame = { evaluateContext: sourceFrame().evaluateContext };
    for (const expression of [
      'std.parseNatExact "900719925474099312345678901234567891"',
      'std.parseIntExact "-900719925474099312345678901234567891"',
    ]) {
      const result = evaluate(parse(expression), {}, frame.evaluateContext!) as { $tag: string; _0: unknown };
      expect(result.$tag).toBe("Ok");
      const source = print(result._0, undefined, frame);
      expect(source).not.toContain("<no surface syntax:");
      expect(evaluate(parse(source), {}, frame.evaluateContext!)).toEqual(result._0);
    }
    expect(print({ $tag: "Rational", num: "3", den: "10" }, undefined, { ...frame, representationSources: [] }))
      .toContain("representation projection unavailable in this source frame");
    expect(print({ $tag: "Rational", num: "3", den: "10" }, undefined, {}))
      .toContain("owning source frame unavailable");
  }, 60_000);

  test("malformed, ambiguous and lossy projections remain readable refusals", () => {
    const frame = sourceFrame();
    for (const value of [
      { $tag: "Rational", num: "broken", den: "10" },
      { $tag: "Rational", num: "1", den: "0" },
      { $tag: "Rational", num: "1".repeat(4097), den: "1" },
    ]) expect(print(value, undefined, frame)).toContain("representation admission refused or abstained");
    const value = { $tag: "Rational", num: "3", den: "10" };
    expect(print(value, undefined, { ...frame, representationSources: [...frame.representationSources!, ...frame.representationSources!] }))
      .toContain("ambiguous representation projection");
    const alwaysFalse = evaluate(parse("std.const false"), {}, frame.evaluateContext!);
    expect(print(value, undefined, { ...frame, representationSources: frame.representationSources!.map((row) => ({
      ...row, equals: alwaysFalse,
    })) })).toContain("representation round trip failed");
    expect(print(value, undefined, { ...frame, representationSources: frame.representationSources!.map((row) => ({
      ...row, equals: row.encodeText,
    })) })).toContain("representation round trip failed");
    expect(print(value, undefined, { ...frame, representationSources: frame.representationSources!.map((row) => ({
      ...row, equals: { $ref: "std.ratNeqM" },
    })) })).toContain("representation round trip failed");
  }, 60_000);

  test("unreadable capture returns a source refusal", () => {
    const frame = sourceFrame();
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("unreadable source value"); } });
    expect(print(hostile, undefined, frame)).toContain("<no surface syntax:");
    expect(print({ $tag: "Rational", num: "3", den: "10" }, undefined, {
      evaluateContext: { ...frame.evaluateContext!, getEntityType: () => { throw new Error("unreadable source type"); } },
    })).toContain("<no surface syntax:");
  }, 60_000);

  test("the captured construction reference obeys lexical shadowing", () => {
    const frame = sourceFrame();
    expect(print({ $tag: "Rational", num: "3", den: "10" }, undefined, { ...frame, boundNames: ["std"] }))
      .toContain("construction function is shadowed");
  }, 60_000);
});

describe("typed singleton phantoms use ordinary dependent Type construction", () => {
  test("nullary data, empty containers and Ref data do not become Type arguments", () => {
    for (const value of [{ $tag: "MeasureOne" }, [], {}]) {
      const type: FenelType = { $tagged: { value: { $ref: "Rational" }, phantom: {
        $refined: { base: { $ref: "Anything" }, set: { $tag: "SeEnum", values: [value] } },
      } } };
      expect(evaluatePrintedType(type)).toEqual(type);
    }
    const type: FenelType = { $tagged: { value: { $ref: "Rational" }, phantom: {
      $refined: { base: { $ref: "Anything" }, set: { $tag: "SeEnum", values: [{ $ref: "11111111-1111-4111-8111-111111111111" }] } },
    } } };
    expect(printType(type, sourceFrame())).toContain("identity data inside a Type argument");
  }, 60_000);

  test("the actual named unit value and its exact calibrations survive", () => {
    const frame = sourceFrame();
    const unit = evaluate(parse("units.celsius"), {}, frame.evaluateContext!);
    const type: FenelType = { $tagged: { value: { $ref: "Rational" }, phantom: {
      $refined: { base: { $ref: "MeasureExpr" }, set: { $tag: "SeEnum", values: [{ $tag: "MeasureAtom", unit }] } },
    } } };
    const restored = evaluatePrintedType(type);
    expect(dispatchEngineBody("engine:deepEqValueTri", [restored, type], frame.evaluateContext!)).toEqual({ $tag: "Just", _0: true });
  }, 60_000);

  test("a full entity declaration carries the actual singleton Type application", () => {
    const frame = sourceFrame();
    const type: FenelType = { $tagged: { value: { $ref: "Rational" }, phantom: {
      $refined: { base: { $ref: "Anything" }, set: { $tag: "SeEnum", values: [{ $tag: "Rational", num: "3", den: "10" }] } },
    } } };
    const source = printEntityDef("Reading", "Exact reading", [{ id: "value", label: "Magnitude", type }], undefined, frame);
    expect(source).not.toContain("Number<");
    const parsed = parseEntityDef(source);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.label).toBe("Exact reading");
    expect(parsed.schema[0]?.label).toBe("Magnitude");
    const expression = parsed.schema[0]!.type as { $el: object };
    expect(evaluate(expression.$el, {}, frame.evaluateContext!)).toEqual(type);
  }, 60_000);
});

describe("entity source uses the canonical declaration grammar", () => {
  test("keyword fields keep their names and unsupported declaration metadata refuses", () => {
    const source = printEntityDef("Branch", "Branch", [
      { id: "then", type: { $ref: "String" } },
      { id: "else", type: { $ref: "String" } },
    ]);
    const parsed = parseEntityDef(source);
    expect(parsed).toEqual({ name: "Branch", label: "Branch", schema: [
      { id: "then", label: undefined, type: { $ref: "String" } },
      { id: "else", label: undefined, type: { $ref: "String" } },
    ] });
    expect(parseEntityDef("Generic a = Generic value: a")).toHaveProperty("error");
    expect(parseEntityDef('Reading = Reading note: String = "hello"')).toHaveProperty("error");
    expect(printEntityDef("11111111-1111-4111-8111-111111111111", "Unnamed", [])).toContain("<no surface syntax:");
  }, 60_000);
});
