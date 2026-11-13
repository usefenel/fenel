// C1 host-boundary regression: execute current production source with isolated
// dependencies. These controls make no registry, membership or inference claim.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadLiteralWitnessOracle, type LiteralWitnessOracleDependencies } from "./test-support/literal-guidance-oracle";

const source = readFileSync(new URL("./literal-witness.ts", import.meta.url), "utf8");
let unexpectedCalls = 0;
const unexpected = () => { unexpectedCalls++; throw new Error("This own-data fixture must not enter a semantic dependency."); };
const dependencies = {
  checkAuthoringSchemeStructure: unexpected, engineRequire: unexpected,
  inferAuthoringExpression: unexpected, peelToArrowType: unexpected,
  projectAuthoringScheme: unexpected, expectedTypeConsumer: unexpected, inferCallScheme: unexpected,
} as unknown as LiteralWitnessOracleDependencies;
const oracle = loadLiteralWitnessOracle(source, dependencies);
const initialPrototypeValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
afterEach(() => {
  expect(unexpectedCalls).toBe(0);
  expect(Object.getOwnPropertyDescriptor(Object.prototype, "value")).toEqual(initialPrototypeValue);
});

function dataDescriptor(value: unknown): PropertyDescriptor {
  return Object.assign(Object.create(null), { value, writable: true, configurable: true, enumerable: true });
}

function withPrototypeSlot<T>(key: string, descriptor: PropertyDescriptor | undefined, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
    return run();
  } finally {
    if (previous) Object.defineProperty(Object.prototype, key, Object.assign(Object.create(null), previous));
    else Reflect.deleteProperty(Object.prototype, key);
  }
}
function withPrototypeValue<T>(descriptor: PropertyDescriptor | undefined, run: () => T): T {
  return withPrototypeSlot("value", descriptor, run);
}

describe("literal-witness own-data descriptor admission (isolated current source)", () => {
  for (const target of ["literal", "bindings"] as const) {
    for (const pollution of ["data", "getter"] as const) {
      test(`${target} accessor remains unread through clean/${pollution}-polluted/restored calls`, () => {
        const observations = [];
        for (const arm of ["clean", "polluted", "restored"] as const) {
          let reads = 0;
          let inheritedReads = 0;
          let membershipCalls = 0;
          const payload = Object.create(null);
          Object.defineProperty(payload, "amount", Object.assign(Object.create(null), {
            get: () => { reads++; return 5; }, enumerable: true, configurable: true,
          }));
          Object.defineProperty(payload, "label", dataDescriptor("probe"));
          const node = { kind: "literal" as const, value: target === "literal" ? payload : 5 };
          const context = target === "bindings" ? { bindings: payload } : {};
          const options = { literalMembership: () => { membershipCalls++; return { $tag: "Nothing" as const }; } };
          const descriptor = pollution === "data" ? dataDescriptor(0) : Object.assign(Object.create(null), {
            get: () => { inheritedReads++; throw new Error("Inherited descriptor value must remain unread."); }, configurable: true,
          });
          const result = withPrototypeValue(arm === "polluted" ? descriptor : undefined,
            () => oracle.prepareAuthoringLiteralWitnesses(node, context, options));
          observations.push({ reads, inheritedReads, membershipCalls,
            sameNode: result.node === node, checks: result.literalChecks.length });
        }
        expect(observations).toEqual(Array.from({ length: 3 }, () => ({
          reads: 0, inheritedReads: 0, membershipCalls: 0, sameNode: true, checks: 0,
        })));
      });
    }
  }

  for (const target of ["context", "options"] as const) {
    test(`${target} accessor preflight refuses inherited descriptor values`, () => {
      let reads = 0;
      const context = {};
      const options = { literalMembership: () => ({ $tag: "Nothing" as const }) };
      const accessor = Object.assign(Object.create(null), {
        get: () => { reads++; return undefined; }, configurable: true, enumerable: true,
      });
      Object.defineProperty(target === "context" ? context : options,
        target === "context" ? "resolveSavedExpr" : "expectedScheme", accessor);
      const node = target === "context" ? { kind: "ref" as const, savedExprId: "probe" }
        : { kind: "literal" as const, value: 5 };
      const result = withPrototypeValue(dataDescriptor(0),
        () => oracle.prepareAuthoringLiteralWitnesses(node, context, options));
      expect(reads).toBe(0);
      expect(result.node).toBe(node);
      expect(result.literalChecks).toEqual([]);
    });
  }

  test("annotation resolver accessor cannot borrow an inherited callable descriptor value", () => {
    let reads = 0;
    let forgedCalls = 0;
    let membershipCalls = 0;
    const membership = () => { membershipCalls++; return { $tag: "Nothing" as const }; };
    Object.defineProperty(membership, "resolveAnnotationScheme", Object.assign(Object.create(null), {
      get: () => { reads++; return unexpected; }, configurable: true,
    }));
    const node = { kind: "literal" as const, value: { __ann: {
      expr: { kind: "literal" as const, value: 5 }, type: { $ref: "Number" },
    } } };
    const result = withPrototypeValue(dataDescriptor(() => { forgedCalls++; throw new Error("Forged resolver"); }),
      () => oracle.prepareAuthoringLiteralWitnesses(node, {}, { literalMembership: membership }));
    expect({ reads, forgedCalls, membershipCalls }).toEqual({ reads: 0, forgedCalls: 0, membershipCalls: 0 });
    expect(result.literalChecks).toEqual([]);
    expect(Object.keys(result.bindings)).toEqual([]);
  });

  test("inference wrapper keeps the original-context fallback without spreading accessors", () => {
    let reads = 0;
    const context = Object.defineProperty({}, "unused", Object.assign(Object.create(null), {
      get: () => { reads++; return 5; }, enumerable: true, configurable: true,
    }));
    const seenContexts: unknown[] = [];
    const fallback = { outcome: { $tag: "Invalid" as const, diagnostics: [] } };
    const wrapper = loadLiteralWitnessOracle(source, {
      ...dependencies,
      inferAuthoringExpression: (_node, current) => { seenContexts.push(current); return fallback; },
    });
    const result = withPrototypeValue(dataDescriptor(0),
      () => wrapper.inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value: 5 }, context));
    expect(reads).toBe(0);
    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]).toBe(context);
    expect(result).toBe(fallback);
  });

  test("ordinary own data still reaches the supplied positive membership callback", () => {
    let calls = 0;
    const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
    const expectedScheme = { quantified: [], body: { $ref: "Number" } };
    const result = prepared.prepareAuthoringLiteralWitnesses({ kind: "literal", value: 5 }, {}, {
      expectedScheme, literalMembership: () => { calls++; return { $tag: "Just", _0: true }; },
    });
    expect(calls).toBe(1);
    expect(result.node.kind).toBe("param");
    expect(Object.values(result.bindings)).toEqual([expectedScheme]);
    expect(result.literalChecks).toEqual([{ verdict: { $tag: "Just", _0: true }, path: "$expression" }]);
  });

  for (const key of ["bindings", "literalMembership", "expressionData", "literalMembershipChecks", "expectedScheme"]) {
    test(`absent ${key} does not read an inherited descriptor-map or option getter`, () => {
      let reads = 0;
      const options = key === "literalMembership" ? {} : { literalMembership: () => ({ $tag: "Nothing" as const }) };
      const descriptor = Object.assign(Object.create(null), {
        get: () => { reads++; return undefined; }, configurable: true,
      });
      const before = Object.getOwnPropertyDescriptor(Object.prototype, key);
      const result = withPrototypeSlot(key, descriptor,
        () => oracle.prepareAuthoringLiteralWitnesses({ kind: "literal", value: 5 }, {}, options));
      expect(reads).toBe(0);
      expect(result.literalChecks).toEqual([]);
      expect(Object.keys(result.bindings)).toEqual([]);
      expect(Object.getOwnPropertyDescriptor(Object.prototype, key)).toEqual(before);
    });
  }

  test("an inherited bindings descriptor cannot inject a lexical binding", () => {
    const injected = { quantified: [], body: { $ref: "Number" } };
    const result = withPrototypeSlot("bindings", dataDescriptor({ value: { injected } }),
      () => oracle.prepareAuthoringLiteralWitnesses({ kind: "literal", value: 5 }, {}, {
        literalMembership: () => ({ $tag: "Nothing" }),
      }));
    expect(Object.keys(result.bindings)).toEqual([]);
  });

  for (const key of ["literalMembership", "expressionData", "literalMembershipChecks"] as const) {
    test(`an inherited ${key} descriptor cannot supply a checking callback`, () => {
      let forgedCalls = 0;
      const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
      const options = {
        expectedScheme: { quantified: [], body: { $ref: "Number" } },
        ...(key === "literalMembership" ? {} : { literalMembership: () => ({ $tag: "Nothing" as const }) }),
      };
      const forged = () => { forgedCalls++; return key === "expressionData"
        ? { $tag: "Residual" } : key === "literalMembershipChecks" ? [] : { $tag: "Nothing" }; };
      const node = { kind: "literal" as const, value: key === "expressionData" ? { __record: { fields: [] } } : 5 };
      const result = withPrototypeSlot(key, dataDescriptor({ value: forged }),
        () => prepared.prepareAuthoringLiteralWitnesses(node, {}, options));
      expect(forgedCalls).toBe(0);
      expect(Object.keys(result.bindings)).toEqual([]);
    });
  }

  test("own undefined options retain the existing fallback to the own context callback", () => {
    let calls = 0;
    const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
    const context = { literalMembership: () => { calls++; return { $tag: "Nothing" as const }; } };
    const inherited = { value: () => { throw new Error("Inherited option must not replace own undefined."); } };
    const result = withPrototypeSlot("literalMembership", dataDescriptor(inherited),
      () => prepared.prepareAuthoringLiteralWitnesses({ kind: "literal", value: 5 }, context, {
        literalMembership: undefined, expectedScheme: { quantified: [], body: { $ref: "Number" } },
      }));
    expect(calls).toBe(1);
    expect(result.literalChecks).toEqual([{ verdict: { $tag: "Nothing" }, path: "$expression" }]);
  });

  test("an absent option keeps the own context callback despite an inherited option descriptor", () => {
    let calls = 0;
    let forgedCalls = 0;
    const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
    const context = { literalMembership: () => { calls++; return { $tag: "Nothing" as const }; } };
    const inherited = { value: () => { forgedCalls++; return { $tag: "Nothing" }; } };
    const result = withPrototypeSlot("literalMembership", dataDescriptor(inherited),
      () => prepared.prepareAuthoringLiteralWitnesses({ kind: "literal", value: 5 }, context, {
        expectedScheme: { quantified: [], body: { $ref: "Number" } },
      }));
    expect({ calls, forgedCalls }).toEqual({ calls: 1, forgedCalls: 0 });
    expect(result.literalChecks).toEqual([{ verdict: { $tag: "Nothing" }, path: "$expression" }]);
  });

  test("expected scheme keeps its late observation after saved-expression callbacks", () => {
    const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
    const initial = { quantified: [], body: { $ref: "String" } };
    const replacement = { quantified: [], body: { $ref: "Number" } };
    const seen: unknown[] = [];
    const options = { expectedScheme: initial, literalMembership: (_value: unknown, expected: unknown) => {
      seen.push(expected); return { $tag: "Just" as const, _0: true };
    } };
    const result = prepared.prepareAuthoringLiteralWitnesses({ kind: "ref", savedExprId: "probe" }, {
      resolveSavedExpr: () => { options.expectedScheme = replacement; return { kind: "literal", value: 5 }; },
    }, options);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(replacement);
    expect(result.node.kind).toBe("param");
    expect(Object.values(result.bindings)).toEqual([replacement]);
  });

  test("an expected-scheme accessor introduced after preflight refuses without invocation", () => {
    let reads = 0;
    let calls = 0;
    const prepared = loadLiteralWitnessOracle(source, { ...dependencies, peelToArrowType: () => undefined });
    const options = { expectedScheme: { quantified: [], body: { $ref: "Number" } },
      literalMembership: () => { calls++; return { $tag: "Just" as const, _0: true }; } };
    const node = { kind: "ref" as const, savedExprId: "probe" };
    const result = prepared.prepareAuthoringLiteralWitnesses(node, {
      resolveSavedExpr: () => {
        Object.defineProperty(options, "expectedScheme", Object.assign(Object.create(null), {
          get: () => { reads++; return { quantified: [], body: { $ref: "Number" } }; }, configurable: true,
        }));
        return { kind: "literal", value: 5 };
      },
    }, options);
    expect({ reads, calls }).toEqual({ reads: 0, calls: 0 });
    expect(result.node).toBe(node);
    expect(result.literalChecks).toEqual([]);
  });
});
