import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { typeToSetExpr } from "./fenel-check";
import { dispatchEngineBody, dispatchedTypeToSetProjection, marshalTraversalType } from "./engine-bodies-dispatch";
import { contains, decideEmpty, isSubset, isDisjoint, normalize } from "./set-algebra";
import { isDegradedTypeProjection, markDegradedTypeProjection } from "./set-marker";
import type { FenelType, FieldDef, SetExpr } from "./types";

setDefaultTimeout(600_000);
const NO = { $tag: "Nothing" } as const;
const NUM: FenelType = { $ref: "Number" };
const ALL: SetExpr = { $tag: "SeAll" };
const NONE: SetExpr = { $tag: "SeNone" };
const ENUM: SetExpr = { $tag: "SeEnum", values: [7] };
const LOST: FenelType = { $tuple: [NUM] };
const castType = (value: unknown) => value as FenelType;
const not = (inner: FenelType): FenelType => ({ $complement: inner });
const interval = (upper: number): SetExpr => ({ $tag: "SeInterval", interval: {
  lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
  hi: { $tag: "Just", _0: { value: upper, inclusive: false } },
} });
const field = (type: FenelType): FieldDef => ({
  name: "x",
  key: { $tag: "NamedField", ref: { $ref: "64000000-0000-4000-8000-000000000001" } },
  type,
  label: { $tag: "Nothing" },
  ui: { $tag: "Nothing" },
  meta: {},
});
const envelope = (type: FenelType) => dispatchedTypeToSetProjection(marshalTraversalType(type));

describe("known type projection loss is never definite evidence", () => {
  const cases: Array<[string, FenelType]> = [
    ["unit", castType({ $unit: true })],
    ["type universe", castType({ $type: true })],
    ["dependent type", castType({ $el: { var: "t" } })],
    ["type application", castType({ $el: { call: ["UnresolvedType", NUM] } })],
    ["tuple", LOST],
    ["tagged", castType({ $tagged: { value: { $void: true }, phantom: NUM } })],
    ["opaque without pure view", castType({ $opaque: { name: "ProjectionLossOpaque" } })],
    ["free variable", { $var: "a" }],
    ["coercing variant", castType({ $variant: { cases: [{ name: "True", fields: [] }, { name: "False", fields: [] }] } })],
    ["open map", castType({ $map: { values: NUM } })],
    ["negative finite map", castType({ $map: { keys: interval(-1), values: NUM } })],
    ["fractional finite map", castType({ $map: { keys: interval(1.5), values: NUM } })],
  ];
  for (const [name, type] of cases) {
    test(`${name}: direct, complemented, and double complemented projections abstain`, () => {
      for (const input of [type, not(type), not(not(type))]) {
        const projected = typeToSetExpr(input);
        expect(isDegradedTypeProjection(projected)).toBe(true);
        expect(envelope(input).degraded).toBe(true);
        expect(contains(projected, 7, null)).toEqual(NO);
        expect(decideEmpty(projected)).toEqual(NO);
        expect(isSubset(projected, NONE)).toEqual(NO);
        expect(isDisjoint(projected, ALL)).toEqual(NO);
        expect(isDegradedTypeProjection(normalize(projected))).toBe(true);
        expect(normalize(projected).$tag).toBe(projected.$tag);
      }
    });
  }

  test("semantic field errors and benign unknown/future traversal tags fail closed", () => {
    expect(envelope(castType({ $record: { fields: [{ name: "unidentified", type: NUM }] } })).degraded).toBe(true);
    for (const node of [{ $tag: "TtUnknown", raw: {}, invalid: false }, { $tag: "TtFutureConstructor", raw: {} }]) {
      expect(dispatchedTypeToSetProjection(node).degraded).toBe(true);
    }
  });

  test("hostile traversal input remains rejected without evaluating an accessor", () => {
    let calls = 0;
    const input = Object.defineProperty({}, "$ref", { enumerable: true, get: () => { calls++; return "Number"; } });
    expect(() => typeToSetExpr(input as FenelType)).toThrow("own-data type boundary");
    expect(calls).toBe(0);
  });

  test("record/variant/arrow/mu/opaque/union/intersection propagate nested loss", () => {
    const wrapped: FenelType[] = [
      { $record: { fields: [field(LOST)] } },
      { $variant: { cases: [{ name: "Payload", label: { $tag: "Nothing" }, fields: [field(LOST)] }] } },
      { $arrow: { params: [field(LOST)], returns: NUM } },
      { $arrow: { params: [field(NUM)], returns: LOST } },
      { $mu: { var: "X", body: LOST } },
      { $opaque: { name: "LossWrapper", pure: LOST } },
      { $union: [NUM, LOST] },
      { $intersect: [NUM, LOST] },
    ];
    for (const type of wrapped) expect(envelope(type).degraded).toBe(true);
  });

  test("refinement elimination and finite-map guard lowering cannot erase loss", () => {
    const refined: FenelType = { $refined: { base: LOST, set: ENUM } };
    const mapped = castType({ $map: { keys: interval(2), values: LOST } });
    expect(envelope(refined)).toMatchObject({ degraded: true, set: { $tag: "SeEnum", values: [7] } });
    expect(envelope(mapped)).toMatchObject({ degraded: true, set: { $tag: "SeWhere" } });
  });

  test("bound variables remain lexical and free variables remain degraded", () => {
    const bound: FenelType = { $mu: { var: "X", body: { $var: "X" } } };
    const shadowed: FenelType = { $mu: { var: "X", body: { $mu: { var: "X", body: { $var: "X" } } } } };
    const opaque: FenelType = { $opaque: { name: "X", pure: { $var: "X" } } };
    for (const type of [bound, shadowed, opaque]) expect(envelope(type).degraded).toBe(false);
    expect(envelope({ $mu: { var: "Y", body: { $var: "X" } } }).degraded).toBe(true);
  });

  test("pre-marked refinement and key sets retain loss, including direct Fenel nesting", () => {
    const nested: SetExpr = { $tag: "SeComplement", inner: markDegradedTypeProjection(ALL) };
    expect(envelope({ $refined: { base: NUM, set: nested } }).degraded).toBe(true);
    expect(envelope(castType({ $map: { keys: markDegradedTypeProjection(interval(2)), values: NUM } })).degraded).toBe(true);
    const base = marshalTraversalType(NUM);
    const direct = dispatchEngineBody("engine:typeToSetProjection", [{ $tag: "TtRefined", base, set: nested, setView: nested, raw: {} }]) as { degraded: boolean };
    expect(direct.degraded).toBe(true);
    for (const pattern of [
      { t: "group", name: "x", child: { t: "eps" }, type: nested },
      { $tag: "SpGroup", name: "x", child: { $tag: "SpEps" }, type: { $tag: "Just", _0: nested } },
    ]) {
      const set = { $tag: "SePattern", pattern };
      expect((dispatchEngineBody("engine:typeToSetProjection", [{ $tag: "TtRefined", base, set, setView: set, raw: {} }]) as { degraded: boolean }).degraded).toBe(true);
    }
  });

  test("a named complement and directly authored complement(All) remain unmarked controls", () => {
    expect(envelope(not(NUM))).toEqual({ set: { $tag: "SeComplement", inner: { $tag: "SeRef", handle: "ℝ" } }, degraded: false });
    const authored: SetExpr = { $tag: "SeComplement", inner: ALL };
    expect(isDegradedTypeProjection(authored)).toBe(false);
    expect(decideEmpty(authored)).toEqual({ $tag: "Just", _0: true });
    expect(envelope({ $refined: { base: NUM, set: authored } }).degraded).toBe(false);
  });

  test("the compatibility body retains raw presentation shape", () => {
    const raw = dispatchEngineBody("engine:typeToSetExpr", [marshalTraversalType(not(LOST))]);
    expect(raw).toEqual({ $tag: "SeComplement", inner: ALL });
    expect(envelope(not(LOST)).degraded).toBe(true);
  });

  test("every current traversal constructor is classified and host producers use one adapter", () => {
    const root = join(import.meta.dir, "../../../..");
    const traversal = readFileSync(join(root, "fenel/modules/engine/type-traversal.fenel"), "utf8");
    const projection = readFileSync(join(root, "fenel/modules/engine/type-to-set.fenel"), "utf8");
    const roster = traversal.slice(traversal.indexOf("TraversalType ="), traversal.indexOf("FieldKeyInput ="));
    const classifier = projection.slice(projection.indexOf("typeToSetDegradedNode type bound ="), projection.indexOf("typeToSetMarkedSet :"));
    for (const match of roster.matchAll(/^\s*\|?\s*(Tt[A-Z]\w*)\b/gm)) expect(classifier).toContain(`${match[1]} `);
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "generated") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.") && !entry.name.includes("cache")) {
          const source = readFileSync(path, "utf8");
          expect(source).not.toMatch(/dispatchEngineBody\(\s*["']engine:typeToSetExpr["']/);
        }
      }
    };
    visit(import.meta.dir);
  });
});
