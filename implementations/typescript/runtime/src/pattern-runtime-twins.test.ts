import { describe, expect, it } from "vitest";
import { matchPattern } from "@fenel/engine/expressions";
import {
  createAccountRegistry,
  type CtorFieldKey,
  type EvaluateContext,
  type FenelModule,
  type FenelType,
  type FieldDef,
} from "@fenel/engine";
import { rtMatchPattern } from "./evaluator";

const FIELD_ID = "41111111-1111-4111-8111-111111111111";
const SLOT: CtorFieldKey = {
  wire: "payload",
  key: { $tag: "NamedField", ref: { $ref: FIELD_ID } },
};

function table(entries: Array<[string, readonly CtorFieldKey[]]>): EvaluateContext["_ctorFieldKeys"] {
  const result: Record<string, readonly CtorFieldKey[]> = Object.create(null);
  for (const [tag, slots] of entries) result[tag] = slots;
  return result;
}

function context(
  slots: EvaluateContext["_ctorFieldKeys"] = table([["Box", [SLOT]]]),
  strict = false,
): EvaluateContext {
  return {
    _constructors: Object.assign(Object.create(null), { Box: ["payload"] }),
    _ctorFieldKeys: slots,
    _patternPlans: new WeakMap(),
    _strictPatternFields: strict,
  };
}

function plainBindings(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value === null ? null : Object.fromEntries(Object.entries(value));
}

function isolatedTwinContexts(seed: EvaluateContext): {
  engine: EvaluateContext;
  runtime: EvaluateContext;
} {
  return {
    engine: { ...seed, _patternPlans: new WeakMap() },
    runtime: { ...seed, _patternPlans: new WeakMap() },
  };
}

function expectParity(
  scrutinee: unknown,
  pattern: unknown,
  seed: EvaluateContext,
  runtimeFirst = false,
): Record<string, unknown> | null {
  const twins = isolatedTwinContexts(seed);
  expect(twins.engine).not.toBe(twins.runtime);
  expect(twins.engine._patternPlans).not.toBe(twins.runtime._patternPlans);

  let engineResult: Record<string, unknown> | null;
  let runtimeResult: Record<string, unknown> | null;
  if (runtimeFirst) {
    runtimeResult = rtMatchPattern(scrutinee, pattern, twins.runtime);
    engineResult = matchPattern(scrutinee, pattern, twins.engine);
  } else {
    engineResult = matchPattern(scrutinee, pattern, twins.engine);
    runtimeResult = rtMatchPattern(scrutinee, pattern, twins.runtime);
  }
  expect(plainBindings(runtimeResult)).toEqual(plainBindings(engineResult));
  return plainBindings(engineResult);
}

describe("field-identity Phase 4b — engine/runtime pattern twins", () => {
  it("keeps the baseline wildcard, binding, literal, missing-key, and Boolean verdicts in parity", () => {
    const rows: Array<[unknown, unknown, Record<string, unknown> | null]> = [
      [7, "_", {}],
      [7, { $bind: "value" }, { value: 7 }],
      [7, 7, {}],
      [{ name: "Ada" }, { name: { $bind: "name" } }, { name: "Ada" }],
      [{ other: 1 }, { name: { $bind: "name" } }, null],
      [{ $tag: "Box", _0: 8 }, { $tag: "Box", _0: { $bind: "value" } }, { value: 8 }],
      [true, { $tag: "True" }, {}],
      [false, { $tag: "False" }, {}],
      [true, { $tag: "False" }, null],
    ];
    rows.forEach(([scrutinee, pattern, expected], index) => {
      expect(expectParity(scrutinee, pattern, context(), index % 2 === 1)).toEqual(expected);
    });
  });

  it("projects exact constructor pattern targets to runtime wire tags in both twins", () => {
    const boxTarget = "@ctor/runtime-pattern/Owner/Box";
    const trueTarget = "@ctor/runtime-pattern/Boolean/True";
    const seed = context(table([
      ["Box", [SLOT]],
      [boxTarget, [SLOT]],
    ]));
    seed._constructorWireNames = Object.assign(Object.create(null), {
      [boxTarget]: "Box",
      [trueTarget]: "True",
    });

    expect(expectParity(
      { $tag: "Box", payload: 9 },
      { $tag: boxTarget, payload: { $bind: "value" } },
      seed,
    )).toEqual({ value: 9 });
    expect(expectParity(true, { $tag: trueTarget }, seed, true)).toEqual({});
  });

  it("fails closed when a pattern tag remains in or enters the reserved exact-target namespace", () => {
    const exactA = "@ctor/runtime-pattern/Owner/A";
    const exactB = "@ctor/runtime-pattern/Owner/B";
    const rows: Array<[
      patternTag: string,
      scrutineeTag: string,
      wireNames: Record<string, string> | undefined,
    ]> = [
      [exactA, exactA, undefined],
      [exactA, exactB, { [exactA]: exactB }],
      ["Box", exactA, { Box: exactA }],
    ];

    for (const [patternTag, scrutineeTag, wireNames] of rows) {
      const seed = context();
      seed._constructorWireNames = wireNames;
      expect(expectParity(
        { $tag: scrutineeTag },
        { $tag: patternTag },
        seed,
        true,
      )).toBeNull();
    }
  });

  it("independently resolves a known constructor's current spelling in both twins", () => {
    const pattern = { $tag: "Box", payload: { $bind: "value" } };
    expect(expectParity({ $tag: "Box", payload: 9 }, pattern, context())).toEqual({ value: 9 });

    const rebuilt = context(table([["Box", [{ ...SLOT, wire: "afterRename" }]]]), true);
    expect(expectParity({ $tag: "Box", payload: 10 }, pattern, rebuilt)).toBeNull();
  });

  it("keeps engine- and runtime-built plans mutually consumable in an explicitly shared cache", () => {
    const matchers = [
      [matchPattern, rtMatchPattern],
      [rtMatchPattern, matchPattern],
    ] as const;

    matchers.forEach(([build, consume], index) => {
      const pattern = { $tag: "Box", payload: { $bind: `value${index}` } };
      const ctx = context();
      expect(plainBindings(build({ $tag: "Box", payload: 9 }, pattern, ctx))).toEqual({
        [`value${index}`]: 9,
      });

      // Once one twin has judged this exact AST node, the other twin must be
      // able to consume that plan even if the live table is later replaced.
      ctx._ctorFieldKeys!["Box"] = [{ ...SLOT, wire: "afterRename" }];
      expect(plainBindings(consume({ $tag: "Box", payload: 10 }, pattern, ctx))).toEqual({
        [`value${index}`]: 10,
      });
    });
  });

  it("rejects stale spellings in strict contexts but flags and raw-reads legacy ASTs", () => {
    const pattern = { $tag: "Box", beforeRename: { $bind: "value" } };
    const current = table([["Box", [{ ...SLOT, wire: "afterRename" }]]]);
    const events: string[] = [];
    const legacy = context(current, false);
    legacy._onStalePatternField = ({ ctor, spelling }) => events.push(`${ctor}.${spelling}`);

    expect(expectParity({ $tag: "Box", beforeRename: 4 }, pattern, legacy)).toEqual({ value: 4 });
    // The two parity paths own separate caches, so each matcher must perform
    // its own resolution and emit its own diagnostic.
    expect(events).toEqual(["Box.beforeRename", "Box.beforeRename"]);

    expect(expectParity(
      { $tag: "Box", beforeRename: 4 },
      pattern,
      context(current, true),
      true,
    )).toBeNull();
  });

  it("keeps unknown, ambiguous, and anonymous records on raw structural reads", () => {
    const noAuthority = table([]);
    const ambiguous = context(noAuthority, true);
    // `_constructors` still knows Box, but absence from `_ctorFieldKeys` means
    // ambiguity/no authority, not a stale field in a known-unambiguous ctor.
    expect(expectParity(
      { $tag: "Box", legacy: 1 },
      { $tag: "Box", legacy: { $bind: "value" } },
      ambiguous,
    )).toEqual({ value: 1 });
    expect(expectParity(
      { $tag: "Unknown", legacy: 2 },
      { $tag: "Unknown", legacy: { $bind: "value" } },
      context(noAuthority, true),
      true,
    )).toEqual({ value: 2 });
    expect(expectParity(
      { legacy: 3 },
      { legacy: { $bind: "value" } },
      context(undefined, true),
    )).toEqual({ value: 3 });
  });

  it("requires own data fields and never invokes accessors", () => {
    const pattern = { $tag: "Box", payload: { $bind: "value" } };
    const inherited = Object.assign(Object.create({ payload: 1 }), { $tag: "Box" });
    expect(expectParity(inherited, pattern, context())).toBeNull();

    let reads = 0;
    const accessor = { $tag: "Box" } as Record<string, unknown>;
    Object.defineProperty(accessor, "payload", {
      enumerable: true,
      get: () => { reads += 1; return 2; },
    });
    expect(expectParity(accessor, pattern, context(), true)).toBeNull();
    expect(reads).toBe(0);

    const hostilePattern = { $tag: "Box" } as Record<string, unknown>;
    Object.defineProperty(hostilePattern, "__proto__", {
      value: { $bind: "value" }, enumerable: true, configurable: true,
    });
    const hostileValue = { $tag: "Box" } as Record<string, unknown>;
    Object.defineProperty(hostileValue, "__proto__", {
      value: 3, enumerable: true, configurable: true,
    });
    const hostileSlot: CtorFieldKey = { ...SLOT, wire: "__proto__" };
    expect(expectParity(
      hostileValue,
      hostilePattern,
      context(table([["Box", [hostileSlot]]])),
    )).toEqual({ value: 3 });
  });

  it("rejects stale spellings in a real strict account-product context", () => {
    const currentField: FieldDef = {
      name: "afterRename",
      key: SLOT.key,
      type: { $ref: "String" },
      label: { $tag: "Nothing" },
      ui: { $tag: "Nothing" },
      meta: {},
    };
    const accountModule: FenelModule = {
      name: "runtime-pattern-product-context",
      label: "Runtime pattern product context",
      entities: [{
        id: "RuntimePatternProductOwner",
        type: {
          $variant: {
            cases: [{ name: "RuntimePatternProductBox", fields: [currentField] }],
          },
        } as FenelType,
      }],
      functions: [],
    };
    const ctx = createAccountRegistry([], [accountModule]).evaluateContext();

    expect(ctx._strictPatternFields).toBe(true);
    expect(ctx._ctorFieldKeys?.RuntimePatternProductBox?.map((slot) => slot.wire))
      .toEqual(["afterRename"]);
    expect(expectParity(
      { $tag: "RuntimePatternProductBox", beforeRename: 4 },
      { $tag: "RuntimePatternProductBox", beforeRename: { $bind: "value" } },
      ctx,
    )).toBeNull();
    expect(expectParity(
      { $tag: "RuntimePatternProductBox", afterRename: 4 },
      { $tag: "RuntimePatternProductBox", afterRename: { $bind: "value" } },
      ctx,
      true,
    )).toEqual({ value: 4 });
  }, 300_000);
});
