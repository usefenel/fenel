import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { evaluate, structuralEq } from "./json-logic";
import { contains, enumerateOf, isDisjoint, isSubset, witnessOf } from "./set-algebra";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import type { SetExpr } from "./types";
import { verify } from "./kernel";
import { decidableSetProof, propEq, reflProof } from "./prover";

setDefaultTimeout(600_000);

// Values enter the evaluator through variables, preserving their prototypes,
// hidden keys, and identities instead of interpreting them as expression ASTs.
function expectEqualityAcrossFaces(a: unknown, b: unknown, equal: boolean) {
  for (const [left, right] of [[a, b], [b, a]]) {
    expect(structuralEq(left, right)).toBe(equal);
    expect(evaluate({ eq: [{ var: "left" }, { var: "right" }] }, { left, right })).toBe(equal);
    expect(evaluate({ neq: [{ var: "left" }, { var: "right" }] }, { left, right })).toBe(!equal);
    expect(dispatchEngineBody("engine:deepEqValue", [left, right])).toBe(equal);
  }
}

const enumSet = (...values: unknown[]): SetExpr => ({ $tag: "SeEnum", values });
const justTrue = { $tag: "Just", _0: true } as const;
const justFalse = { $tag: "Just", _0: false } as const;

describe("empty record value equality", () => {
  test("plain records have structural equality while opaque host values retain identity", () => {
    expect(structuralEq({}, {})).toBe(true);
    expect(structuralEq(Object.create(null), {})).toBe(true);
    expect(structuralEq({ child: {} }, { child: {} })).toBe(true);
    const date = new Date(0);
    expect(structuralEq(date, date)).toBe(true);
    expect(structuralEq(date, new Date(0))).toBe(false);
    expect(structuralEq(date, {})).toBe(false);
    const hidden = Object.defineProperty({}, "private", { value: true });
    expect(structuralEq(hidden, {})).toBe(false);
    expect(structuralEq(() => 1, () => 1)).toBe(false);
  });

  test("evaluator and Fenel equality agree on fresh plain and null-prototype empty records", () => {
    expectEqualityAcrossFaces({}, {}, true);
    expectEqualityAcrossFaces(Object.create(null), Object.create(null), true);
    expectEqualityAcrossFaces(Object.create(null), {}, true);
    expectEqualityAcrossFaces({ child: Object.create(null) }, { child: {} }, true);
    expectEqualityAcrossFaces([Object.create(null)], [{}], true);
  });

  test("zero-key host objects remain identity-only at every equality face", () => {
    class EmptyHostHandle {}
    const factories: Array<() => object> = [
      () => new Date(0),
      () => new Map(),
      () => new Set(),
      () => new EmptyHostHandle(),
      () => Object.create({ hostBrand: "opaque" }),
    ];
    for (const create of factories) {
      const value = create();
      expect(Reflect.ownKeys(value)).toHaveLength(0);
      expectEqualityAcrossFaces(value, value, true);
      expectEqualityAcrossFaces(value, create(), false);
      expectEqualityAcrossFaces(value, {}, false);
      expectEqualityAcrossFaces(value, Object.create(null), false);
    }
  });

  test("hidden and symbol keys exclude an object from the empty-record rule", () => {
    const brand = Symbol("host identity");
    const factories: Array<() => object> = [
      () => Object.defineProperty({}, "private", { value: true }),
      () => ({ [brand]: true }),
      () => Object.defineProperty(Object.create(null), brand, { value: true }),
    ];
    for (const create of factories) {
      const value = create();
      expect(Object.keys(value)).toHaveLength(0);
      expect(Reflect.ownKeys(value)).toHaveLength(1);
      expectEqualityAcrossFaces(value, value, true);
      expectEqualityAcrossFaces(value, create(), false);
      expectEqualityAcrossFaces(value, {}, false);
    }
  });

  test("JSON serialization preserves singleton membership and containment", () => {
    const value = { child: {} };
    const original: SetExpr = { $tag: "SeEnum", values: [value] };
    const restored = JSON.parse(JSON.stringify(original)) as SetExpr;
    expect(contains(restored, value, null)).toEqual({ $tag: "Just", _0: true });
    expect(isSubset(original, restored)).toEqual({ $tag: "Just", _0: true });
    expect(isDisjoint(original, restored)).toEqual({ $tag: "Just", _0: false });
    const left = {};
    const right = {};
    expect(verify(propEq({ $record: { fields: [] } }, left, right), reflProof(left))).toEqual({ $tag: "Ok", _0: { $tag: "Proven" } });
    expect(structuralEq(left, right)).toBe(true);
  }, 120_000);

  test("whole-enum JSON roundtrips preserve empty-record membership, witnesses and deduplication", () => {
    const original = enumSet({}, {}, Object.create(null), { child: {} }, { child: Object.create(null) });
    const restored = JSON.parse(JSON.stringify(original)) as SetExpr;
    for (const set of [original, restored]) {
      for (const member of [{}, Object.create(null), { child: {} }]) {
        expect(contains(set, member, null)).toEqual(justTrue);
      }
      expect(contains(set, { child: 1 }, null)).toEqual(justFalse);
      const enumeration = enumerateOf(set) as { $tag: string; _0: unknown[] };
      expect(enumeration.$tag).toBe("Just");
      expect(enumeration._0).toHaveLength(2);
      expect(isSubset(set, enumSet(...enumeration._0))).toEqual(justTrue);
      expect(isSubset(enumSet(...enumeration._0), set)).toEqual(justTrue);
      const witness = witnessOf(set) as { $tag: string; _0: unknown };
      expect(witness.$tag).toBe("Just");
      const witnessCopy: unknown = JSON.parse(JSON.stringify(witness._0));
      expect(contains(set, witnessCopy, null)).toEqual(justTrue);
      const proof = verify(
        { $tag: "JInhabited", _0: set } as never,
        decidableSetProof("witness", { left: witnessCopy }),
      );
      expect(proof).toEqual({ $tag: "Ok", _0: { $tag: "SolverChecked" } });
    }
    expect(isSubset(original, restored)).toEqual(justTrue);
    expect(isSubset(restored, original)).toEqual(justTrue);
    expect(isDisjoint(original, restored)).toEqual(justFalse);
    expect(isDisjoint(restored, original)).toEqual(justFalse);
  });

  test("callable identity is preserved in runtime equality, enum membership and Refl", () => {
    const left = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    const right = { ...left, closure: {} };
    const partial = { __fenelPartial: true, fn: { $ref: "std:add" }, collected: [1], arity: 2 };
    const otherPartial = { ...partial, collected: [1] };
    expect(structuralEq(left, left)).toBe(true);
    expect(structuralEq(left, right)).toBe(false);
    expect(structuralEq(partial, otherPartial)).toBe(false);
    expect(contains({ $tag: "SeEnum", values: [left] }, right, null)).toEqual({ $tag: "Just", _0: false });
    expect(contains({ $tag: "SeEnum", values: [partial] }, otherPartial, null)).toEqual({ $tag: "Just", _0: false });
    expect(verify(propEq({ $ref: "Any" }, left, right), reflProof(left)).$tag).toBe("Err");
    expect(structuralEq({ $ref: "same-id" }, { $ref: "same-id" })).toBe(true);
    expect(structuralEq({ __fenelFn: false }, { __fenelFn: false })).toBe(true);
  }, 120_000);

  test("callables and serialized references retain their distinct equality contracts across faces", () => {
    const closure = () => ({ __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} });
    const partial = () => ({ __fenelPartial: true, fn: { $ref: "std:add" }, collected: [1], arity: 2 });
    const native = () => (value: unknown) => value;
    for (const create of [closure, partial, native]) {
      const value = create();
      const other = create();
      expectEqualityAcrossFaces(value, value, true);
      expectEqualityAcrossFaces(value, other, false);
      expect(contains(enumSet(value), value, null)).toEqual(justTrue);
      expect(contains(enumSet(value), other, null)).toEqual(justFalse);
      expect(verify(propEq({ $ref: "Any" }, value, value), reflProof(value)).$tag).toBe("Ok");
      expect(verify(propEq({ $ref: "Any" }, value, other), reflProof(value)).$tag).toBe("Err");
    }
    expectEqualityAcrossFaces({ $ref: "same-id" }, { $ref: "same-id" }, true);
    expectEqualityAcrossFaces({ __fenelFn: false }, { __fenelFn: false }, true);
    expectEqualityAcrossFaces({ __fenelPartial: false }, { __fenelPartial: false }, true);
  });

  test("Refl and singleton membership share the null, NaN and empty-record value boundary", () => {
    for (const [left, right, equal] of [
      [{}, Object.create(null), true],
      [null, undefined, true],
      [NaN, NaN, false],
    ] as const) {
      expectEqualityAcrossFaces(left, right, equal);
      expect(contains(enumSet(left), right, null)).toEqual(equal ? justTrue : justFalse);
      expect(verify(propEq({ $ref: "Any" }, left, right), reflProof(left)).$tag)
        .toBe(equal ? "Ok" : "Err");
    }
  });
});
