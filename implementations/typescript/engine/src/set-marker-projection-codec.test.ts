import { describe, expect, test } from "bun:test";
import {
  buildSetExpr as se,
  isDegradedTypeProjection,
  markDegradedTypeProjection,
  peelSetExpr,
  setExprToDollarKey,
  setExprToTag,
} from "./set-marker";
import type { SetExpr } from "./types";

const FLAG = "semanticProjectionDegraded";
const fieldKey = { $tag: "PositionalField", index: 0 } as const;
const exact = () => se.enum([1]);
const degraded = () => markDegradedTypeProjection(se.complement(se.all()));
const jsonRoundtrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const legacyForms: [string, SetExpr][] = [
  ["all", se.all()],
  ["none", se.none()],
  ["enum", exact()],
  ["interval", se.interval({ lo: { $tag: "Nothing" }, hi: { $tag: "Nothing" } })],
  ["ref", se.ref("Number")],
  ["pattern", se.pattern({ t: "match", pred: exact() })],
  ["where", se.where({ "==": [{ var: "x" }, 1] })],
  ["union", se.union([exact(), se.none()])],
  ["intersect", se.intersect([exact(), se.all()])],
  ["diff", se.diff(se.all(), exact())],
  ["complement", se.complement(se.all())],
];

const nestedForms: [string, (child: SetExpr) => SetExpr][] = [
  ["union", (child) => se.union([exact(), child])],
  ["intersection", (child) => se.intersect([exact(), child])],
  ["difference left", (child) => se.diff(child, exact())],
  ["difference right", (child) => se.diff(exact(), child)],
  ["complement", (child) => se.complement(child)],
  ["double complement", (child) => se.complement(se.complement(child))],
  ["constructor field", (child) => se.ctor("Box", [se.ctorField(fieldKey, "value", child)])],
  ["mu body", (child) => se.mu("x", child)],
  ["arrow parameter", (child) => se.arrow([se.arrowParam(fieldKey, "value", child)], exact())],
  ["arrow return", (child) => se.arrow([], child)],
  ["pattern predicate", (child) => se.pattern({
    t: "seq",
    a: { t: "eps" },
    b: { t: "alt", a: { t: "empty" }, b: {
      t: "rep", min: 0, max: 2, child: { t: "match", pred: child },
    } },
  })],
  ["pattern group type", (child) => se.pattern({
    t: "group", name: "capture", child: { t: "eps" }, type: child,
  })],
];

describe("SetExpr projection provenance through production codecs", () => {
  for (const [name, canonical] of legacyForms) {
    test(`${name}: exact historical envelope stays unchanged and unmarked`, () => {
      const legacy = setExprToDollarKey(canonical);
      expect(Object.keys(legacy as object)).toEqual([`$${name}`]);
      expect(isDegradedTypeProjection(legacy)).toBe(false);
      expect(setExprToTag(jsonRoundtrip(legacy))).toEqual(canonical);
    });

    test(`${name}: the marker survives canonical, legacy, JSON, and canonical again`, () => {
      const marked = markDegradedTypeProjection(canonical);
      const legacy = setExprToDollarKey(marked);
      expect(Object.getOwnPropertyDescriptor(legacy, FLAG)).toMatchObject({
        value: true, enumerable: true,
      });
      expect(peelSetExpr(legacy)?.kind).toBe(canonical.$tag);
      expect(isDegradedTypeProjection(legacy)).toBe(true);
      const restored = setExprToTag(jsonRoundtrip(legacy));
      expect(restored).toEqual(marked);
      expect(isDegradedTypeProjection(restored)).toBe(true);
      expect(setExprToDollarKey(restored)).toEqual(legacy);
    });
  }

  for (const [name, wrap] of nestedForms) {
    test(`${name}: nested marked slots survive both codecs`, () => {
      const source = wrap(degraded());
      expect(isDegradedTypeProjection(source)).toBe(true);
      const legacy = setExprToDollarKey(source);
      expect(isDegradedTypeProjection(legacy)).toBe(true);
      // Remove the optional root summary. Descendant provenance must survive
      // on its own when this value later becomes a refinement or map key.
      delete (legacy as Record<string, unknown>)[FLAG];
      expect(isDegradedTypeProjection(legacy)).toBe(true);
      const restored = setExprToTag(jsonRoundtrip(legacy));
      expect(isDegradedTypeProjection(restored)).toBe(true);
      expect(restored).toEqual(setExprToTag(source));
    });

    test(`${name}: directly authored all/complement shapes remain exact`, () => {
      const source = wrap(se.complement(se.all()));
      const legacy = setExprToDollarKey(source);
      expect(isDegradedTypeProjection(legacy)).toBe(false);
      expect(setExprToTag(jsonRoundtrip(legacy))).toEqual(source);
    });
  }

  test("marker-shaped enum values are ordinary data, not SetExpr provenance", () => {
    const source = se.enum([{ [FLAG]: true }, markDegradedTypeProjection(se.all())]);
    const legacy = setExprToDollarKey(source);
    expect(isDegradedTypeProjection(legacy)).toBe(false);
    expect(setExprToTag(jsonRoundtrip(legacy))).toEqual(source);
  });

  test("legacy sidecars only admit an own true data marker", () => {
    for (const bad of [
      { $all: true, [FLAG]: false },
      { $all: true, [FLAG]: "true" },
      { $all: true, [FLAG]: true, extra: 1 },
      { $all: true, $none: true, [FLAG]: true },
      { [FLAG]: true },
      Object.defineProperty({ $all: true, [FLAG]: true }, "extra", { value: 1 }),
      { $all: true, [FLAG]: true, [Symbol("extra")]: 1 },
    ]) {
      expect(peelSetExpr(bad)).toBeNull();
      expect(() => setExprToTag(bad)).toThrow();
    }
    let reads = 0;
    const accessor = Object.defineProperty({ $all: true }, FLAG, {
      enumerable: true,
      get() { reads += 1; return true; },
    });
    expect(peelSetExpr(accessor)).toBeNull();
    expect(() => setExprToTag(accessor)).toThrow();
    expect(reads).toBe(0);

    const inherited = Object.assign(Object.create({ [FLAG]: true }), { $all: true });
    expect(isDegradedTypeProjection(inherited)).toBe(false);
    expect(setExprToTag(inherited)).toEqual(se.all());
  });
});
