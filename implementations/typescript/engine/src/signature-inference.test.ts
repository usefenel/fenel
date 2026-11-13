import { describe, expect, test } from "bun:test";

import {
  dispatchEngineBody,
  dispatchedJsonLogicToSyntax,
  marshalTraversalType,
  print,
} from "./engine-bodies-dispatch";
import { parse } from "./fenel-parser";
import {
  finalizeRegistryFunctionSignatures,
  inferJsonLogicType,
  type JsonLogicInferenceOptions,
  type RegistryFunctionSignatureCandidate,
  type SignatureResolutionRow,
} from "./signature-inference";
import {
  inferAuthoringExpression,
  logicToExprNode,
  type AuthoringFunctionEntry,
} from "./authoring/expression-authoring";
import { List, Nothing } from "./type-foundation";
import type {
  FieldDef,
  FenelFunction,
  FenelType,
  TypeScheme,
} from "./types";

const ref = (name: string): FenelType => ({ $ref: name });

function positionalField(name: string, index: number, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function namedField(name: string, handle: string, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "NamedField", ref: { $ref: handle } },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

describe("tagged record authoring inference", () => {
  const fields = [
    namedField("name", "11111111-1111-4111-8111-111111111111", ref("String")),
    namedField("country", "22222222-2222-4222-8222-222222222222", ref("Number")),
  ];
  const values = [
    { $tag: "Customer", name: "Ada", country: 7 },
    { country: 7, $tag: "Customer", name: "Ada" },
  ];
  const optionsFor = (params: FieldDef[]): JsonLogicInferenceOptions => ({
    resolvePatternConstructor: (name) => name === "Customer"
      ? { status: "resolved", targetId: "33333333-3333-4333-8333-333333333333", params,
          returns: ref("Customer"),
          scheme: { quantified: [], body: { $arrow: { params, returns: ref("Customer") } } },
        }
      : { status: "missing" },
  });

  test("checks permuted tagged data against the same exact checked constructor fields", () => {
    for (const params of [fields, [...fields].reverse()]) {
      const options = optionsFor(params);
      const results = values.map((value) => inferJsonLogicType(value, options));
      for (const result of results) {
        expect(result.outcome.$tag, JSON.stringify(result.outcome)).toBe("Solved");
        expect(result.type).toEqual(ref("Customer"));
      }
      expect(results[1]?.scheme).toEqual(results[0]?.scheme);
    }
  }, 60_000);

  test("retains refusals when field values have the wrong types in either object order", () => {
    for (const value of [
      { $tag: "Customer", name: 7, country: "Ada" },
      { country: "Ada", $tag: "Customer", name: 7 },
    ]) {
      const result = inferJsonLogicType(value, optionsFor(fields));
      expect(result.outcome.$tag).toBe("Invalid");
      expect(result.type).toBeUndefined();
    }
  });

  test("preserves the inferred scheme across tagged data, Code and explicit named construction", () => {
    const value = values[1]!;
    const original = structuredClone(value);
    const options = optionsFor(fields);
    const source = print(value);
    const parsed = parse(source);
    const direct = inferJsonLogicType(value, options);
    const reopened = inferJsonLogicType(parsed, options);
    expect(direct.outcome.$tag, JSON.stringify(direct.outcome)).toBe("Solved");
    expect(reopened.outcome.$tag, JSON.stringify(reopened.outcome)).toBe("Solved");
    expect(reopened.scheme).toEqual(direct.scheme);
    expect(parsed).toEqual({ construct: ["Customer", { country: 7, name: "Ada" }] });
    expect(value).toEqual(original);
  });
});

/** Isolated registry convenience belongs in tests: production finalization
 * consumes only the exact routing rows supplied by the real registry. */
function fixtureResolutionRows(
  candidates: readonly RegistryFunctionSignatureCandidate[],
): SignatureResolutionRow[] {
  const bindings = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const name of [candidate.fn.id, candidate.declaration.codeName]) {
      const ids = bindings.get(name) ?? new Set<string>();
      ids.add(candidate.fn.id);
      bindings.set(name, ids);
    }
  }
  return [...bindings]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, ids]) => ids.size === 1
      ? { name, status: "resolved" as const, targetId: [...ids][0]! }
      : { name, status: "ambiguous" as const, targetId: "" });
}

function finalizeFixture(
  candidates: readonly RegistryFunctionSignatureCandidate[],
) {
  return finalizeRegistryFunctionSignatures(candidates, {
    resolutions: fixtureResolutionRows(candidates),
  });
}

function solvedType(
  logic: unknown,
  options: JsonLogicInferenceOptions = {},
): FenelType {
  const result = inferJsonLogicType(logic, options);
  if (result.outcome.$tag !== "Solved" || result.type === undefined) {
    throw new Error(`expected Solved, received ${JSON.stringify(result.outcome)}`);
  }
  return result.type;
}

function arrow(type: FenelType): Extract<FenelType, { $arrow: unknown }>["$arrow"] {
  if (!("$arrow" in type)) throw new Error(`expected arrow, received ${JSON.stringify(type)}`);
  return type.$arrow;
}

function opaqueVariantCaseNames(type: FenelType): string[] {
  if (!("$opaque" in type) || type.$opaque.pure === undefined) return [];
  const pure = type.$opaque.pure;
  return "$variant" in pure ? pure.$variant.cases.map(({ name }) => name) : [];
}

type RawInferenceOutcome =
  | { $tag: "Solved"; plan: { scheme: { body: unknown } } }
  | { $tag: "AnnotationRequired" | "Invalid"; diagnostics: Array<{ code: string }> };

type InternalArrowBody = {
  tag: "ItArrow";
  params: Array<{
    key: { $tag: "PositionalField"; index: number } | { $tag: "NamedField" };
    keyToken: string;
    wireName: string;
  }>;
};

function unify(left: FenelType, right: FenelType): RawInferenceOutcome {
  return dispatchEngineBody("engine:inferTraversalEquation", [
    marshalTraversalType(left),
    marshalTraversalType(right),
    "tests/signature-inference/equation",
  ]) as RawInferenceOutcome;
}

function surfaceSyntax(logic: unknown): unknown {
  const converted = dispatchedJsonLogicToSyntax(logic) as {
    readonly $tag: "Ok" | "Err";
    readonly _0?: unknown;
  };
  if (converted.$tag !== "Ok") {
    throw new Error(`expected Syntax, received ${JSON.stringify(converted)}`);
  }
  return converted._0;
}

// The routing rows a registry gives the operator spellings of a countdown when
// they name the std primitives (`>` ⇒ gt ⇒ std:gt, …). The size-change oracle
// reads facts only off those canonical ids (2026-10-03).
type RoutingRow = { name: string; status: string; targetId: string };
const stdPrimitiveRows: RoutingRow[] = ["gt", "gte", "lt", "lte", "sub", "and", "or"].map((name) => ({
  name,
  status: "resolved",
  targetId: `std:${name}`,
}));

function inferredGroupTotal(
  id: string,
  sourceName: string,
  body: unknown,
  status: "resolved" | "ambiguous" | "missing" = "resolved",
  primitiveRows: RoutingRow[] = stdPrimitiveRows,
): boolean {
  const resolutions = [{
    name: sourceName,
    status,
    targetId: status === "resolved" ? id : "",
  }, ...primitiveRows];
  return dispatchEngineBody("engine:inferenceGroupTotal", [[{
    id,
    paramNames: ["n"],
    body: surfaceSyntax(body),
    resolutions,
  }], resolutions]) as boolean;
}

function inferredGroupTrustTag(
  id: string,
  sourceName: string,
  body: unknown,
): string {
  const resolutions = [{
    name: sourceName,
    status: "resolved" as const,
    targetId: id,
  }, ...stdPrimitiveRows];
  const group = [{
    id,
    paramNames: ["n"],
    body: surfaceSyntax(body),
    callees: [id],
    resolutions,
  }];
  const trust = dispatchEngineBody("engine:inferenceGroupTrust", [
    group,
    resolutions,
    [],
    [],
    false,
    false,
  ]) as { readonly $tag: string };
  return trust.$tag;
}

const numberType = ref("Number");
const stringType = ref("String");
const authoredHostSlot = {
  $tag: "Authored" as const,
  source: { $tag: "HostSpec" as const, module: "inference-test" },
};

function monomorphicScheme(
  params: readonly FieldDef[],
  returns: FenelType,
): TypeScheme {
  return { quantified: [], body: { $arrow: { params: [...params], returns } } };
}

const addSignature = {
  params: [
    positionalField("left", 0, numberType),
    positionalField("right", 1, numberType),
  ],
  returns: numberType,
  scheme: monomorphicScheme([
    positionalField("left", 0, numberType),
    positionalField("right", 1, numberType),
  ], numberType),
};

const resolverOptions: JsonLogicInferenceOptions = {
  resolveFunction: (id) => {
    if (id === "add") return addSignature;
    if (id === "inc") {
      return {
        params: [positionalField("value", 0, numberType)],
        returns: numberType,
        scheme: monomorphicScheme([positionalField("value", 0, numberType)], numberType),
      };
    }
    return undefined;
  },
};

describe("Fenel rank-1 signature inference", () => {
  test("infers identity and const principal schemes in source order", () => {
    const identity = arrow(solvedType({ fn: [["x"], { var: "x" }] }));
    expect(identity.params).toHaveLength(1);
    expect(identity.params[0]!.type).toEqual(identity.returns);

    const constant = arrow(solvedType({ fn: [["x", "y"], { var: "x" }] }));
    expect(constant.params.map((param) => param.key)).toEqual([
      { $tag: "PositionalField", index: 0 },
      { $tag: "PositionalField", index: 1 },
    ]);
    expect(constant.returns).toEqual(constant.params[0]!.type);
    expect(constant.returns).not.toEqual(constant.params[1]!.type);

    const compose = inferJsonLogicType({
      fn: [["f", "g", "x"], {
        call: [
          { var: "f" },
          { call: [{ var: "g" }, { var: "x" }] },
        ],
      }],
    });
    expect(compose.outcome.$tag).toBe("AnnotationRequired");
    if (compose.outcome.$tag !== "AnnotationRequired") return;
    expect(compose.outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "inference.effect-polymorphism",
    ]);
  }, 180_000);

  test("instantiates one let-polymorphic identity independently at Number and String", () => {
    const result = inferJsonLogicType({
      do: [
        { let: { id: { fn: [["x"], { var: "x" }] } } },
        { call: [{ var: "id" }, 1] },
        { call: [{ var: "id" }, "done"] },
      ],
    });
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(stringType);
  });

  test("let generalization blocks metas reachable through the current substitution of the environment", () => {
    // consumeRec : forall b. {a: b} -> Boolean solves the parameter x to
    // {a: t}; `let y = x.a` must not quantify t, which x still owns.
    const fieldA = namedField("a", "a1111111-1111-4111-8111-111111111111", { $var: "b" });
    const recordA: FenelType = { $record: { fields: [fieldA] } };
    const options: JsonLogicInferenceOptions = {
      resolveFunction: (id) => {
        if (id === "consumeRec") {
          return {
            params: [positionalField("_0", 0, recordA)],
            returns: ref("Boolean"),
            scheme: {
              quantified: [{ id: "q0", sourceName: "b", kind: { $tag: "KType" } }],
              body: { $arrow: { params: [positionalField("_0", 0, recordA)], returns: ref("Boolean") } },
            },
          };
        }
        if (id === "num" || id === "str") {
          const type = id === "num" ? numberType : stringType;
          return {
            params: [positionalField("_0", 0, type)],
            returns: type,
            scheme: monomorphicScheme([positionalField("_0", 0, type)], type),
          };
        }
        return undefined;
      },
    };
    const body = (...uses: unknown[]) => ({
      fn: [["x"], {
        do: [
          { call: ["consumeRec", { var: "x" }] },
          { let: { y: { var: "x.a" } } },
          ...uses,
        ],
      }],
    });

    const twoUses = inferJsonLogicType(body(
      { call: ["num", { var: "y" }] },
      { call: ["str", { var: "y" }] },
    ), options);
    expect(twoUses.outcome.$tag).toBe("Invalid");
    if (twoUses.outcome.$tag === "Invalid") {
      expect(twoUses.outcome.diagnostics.map(({ code }) => code)).toContain("inference.nominal-mismatch");
    }

    const oneUse = arrow(solvedType(body({ call: ["num", { var: "y" }] }), options));
    const parameter = oneUse.params[0]!.type;
    if (!("$record" in parameter)) throw new Error(`expected a record parameter, received ${JSON.stringify(parameter)}`);
    expect(parameter.$record.fields.map(({ type }) => type)).toEqual([numberType]);
    expect(oneUse.returns).toEqual(numberType);

    // Guard against over-blocking: a let inside the lambda that closes over
    // nothing stays polymorphic.
    const localIdentity = arrow(solvedType({
      fn: [["x"], {
        do: [
          { let: { id: { fn: [["z"], { var: "z" }] } } },
          { call: ["num", { call: [{ var: "id" }, { var: "x" }] }] },
          { call: [{ var: "id" }, "s"] },
        ],
      }],
    }, options));
    expect(localIdentity.params[0]!.type).toEqual(numberType);
    expect(localIdentity.returns).toEqual(stringType);
  }, 180_000);

  test("gives SWhere the same sequential let-polymorphism as SLet", () => {
    const result = inferJsonLogicType({
      where: [
        { var: "text" },
        {
          id: { fn: [["x"], { var: "x" }] },
          number: { call: [{ var: "id" }, 1] },
          text: { call: [{ var: "id" }, "done"] },
        },
      ],
    });
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(stringType);
  }, 180_000);

  test("keeps later SWhere binders out of scope for earlier dependency walks", () => {
    const references = dispatchEngineBody("engine:inferenceSurfaceReferences", [
      surfaceSyntax({
        where: [
          { var: "later" },
          {
            first: { call: ["later", 1] },
            later: 2,
          },
        ],
      }),
    ]);
    expect(references).toEqual(["later"]);
  }, 180_000);

  test("keeps bound-root dotted projections out of external references without weakening qualified routing", () => {
    const references = dispatchEngineBody("engine:inferenceSurfaceReferences", [
      surfaceSyntax({
        fn: [["pair", "tpl"], {
          do: [
            { var: "pair.key" },
            { call: ["mail.send", { var: "tpl.subject" }] },
          ],
        }],
      }),
    ]);
    expect(references).toEqual(["mail.send"]);
  }, 180_000);

  test("defers a bound-root record projection until a later callable equation reveals its record", () => {
    const keyA = "41111111-1111-4111-8111-111111111111";
    const keyB = "42222222-2222-4222-8222-222222222222";
    const pairType: FenelType = {
      $record: {
        fields: [
          namedField("key", keyA, stringType),
          namedField("value", keyB, numberType),
        ],
      },
    };
    const callbackType: FenelType = {
      $arrow: {
        params: [positionalField("pair", 0, pairType)],
        returns: stringType,
      },
    };
    const callbackParam = positionalField("callback", 0, callbackType);
    const result = inferJsonLogicType(
      { call: ["consumePair", { fn: [["pair"], { var: "pair.key" }] }] },
      {
        resolveFunction: (id) => id === "consumePair"
          ? {
              params: [callbackParam],
              returns: stringType,
              scheme: monomorphicScheme([callbackParam], stringType),
            }
          : undefined,
      },
    );
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(stringType);

    const underdetermined = inferJsonLogicType({
      fn: [["row"], { var: "row.key" }],
    });
    expect(underdetermined.outcome.$tag).toBe("AnnotationRequired");
    if (underdetermined.outcome.$tag !== "AnnotationRequired") return;
    expect(underdetermined.outcome.diagnostics.map(({ code }) => code)).toEqual([
      "inference.record-projection",
    ]);
  }, 180_000);

  test("composes substitutions and rejects self-application with a stable occurs check", () => {
    const result = inferJsonLogicType({
      fn: [["x"], { call: [{ var: "x" }, { var: "x" }] }],
    });
    expect(result.outcome.$tag).toBe("Invalid");
    if (result.outcome.$tag !== "Invalid") return;
    expect(result.outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "inference.occurs-check",
    );
  });

  describe("ordered arrow parameter equations", () => {
    const keyA = "41111111-1111-4111-8111-111111111111";
    const keyB = "42222222-2222-4222-8222-222222222222";
    const keyC = "43333333-3333-4333-8333-333333333333";
    const keyD = "44444444-4444-4444-8444-444444444444";
    const callable = (params: readonly FieldDef[], returns = numberType): FenelType =>
      monomorphicScheme(params, returns).body;

    test("equates independently owned parameters without changing their identities", () => {
      const first = callable([namedField("x", keyA, numberType)]);
      const second = callable([namedField("sample", keyC, numberType)]);
      for (const [left, right] of [[first, second], [second, first]] as const) {
        const outcome = unify(left, right);
        expect(outcome.$tag, JSON.stringify(outcome)).toBe("Solved");
        if (outcome.$tag !== "Solved") continue;
        const body = outcome.plan.scheme.body as InternalArrowBody;
        const expectedKey = arrow(left).params[0]!.key;
        expect(expectedKey).toBeDefined();
        expect(body.params[0]!.key).toEqual(expectedKey!);
        expect(body.params[0]!.wireName).toBe(arrow(left).params[0]!.name);
      }
    }, 180_000);

    test("equates named and positional parameters after checked curry flattening", () => {
      const curried = callable([namedField("outer", keyA, numberType)],
        callable([namedField("inner", keyB, stringType)]));
      const flattened = callable([
        positionalField("first", 0, numberType),
        namedField("second", keyC, stringType),
      ]);
      expect(unify(curried, flattened).$tag).toBe("Solved");
      expect(unify(flattened, curried).$tag).toBe("Solved");
    });

    test("threads callback parameter substitutions into its result through the public inference door", () => {
      const variable: FenelType = { $var: "a" };
      const identity: TypeScheme = {
        quantified: [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }],
        body: callable([namedField("value", keyA, variable)], variable),
      };
      const consume = (callbackResult: FenelType) => {
        const callback = callable([namedField("x", keyC, numberType)], callbackResult);
        const params = [positionalField("callback", 0, callback)];
        return inferJsonLogicType({ call: ["consumeCallback", { var: "identity" }] }, {
          bindings: { identity },
          resolveFunction: (id) => id === "consumeCallback" ? {
            params, returns: numberType, scheme: monomorphicScheme(params, numberType),
          } : undefined,
        });
      };
      const accepted = consume(numberType);
      expect(accepted.outcome.$tag, JSON.stringify(accepted.outcome)).toBe("Solved");
      expect(accepted.type).toEqual(numberType);

      // The one quantified variable occurs in both slots. Solving its input
      // to Number must not leave its result free to become String.
      const rejected = consume(stringType);
      expect(rejected.outcome.$tag).toBe("Invalid");
      if (rejected.outcome.$tag !== "Invalid") return;
      expect(rejected.outcome.diagnostics.map(({ code }) => code))
        .toContain("inference.nominal-mismatch");
    }, 180_000);

    test("refuses reordered arguments, unequal domains, unequal results and unequal arities", () => {
      const left = callable([
        namedField("left", keyA, numberType),
        namedField("right", keyB, stringType),
      ]);
      const cases: Array<[string, FenelType, string]> = [
        // The same key/type pairs in a different order are a different
        // calling convention, even though record-style matching would pass.
        ["order", callable([
          namedField("right", keyB, stringType),
          namedField("left", keyA, numberType),
        ]), "inference.nominal-mismatch"],
        ["domain", callable([
          namedField("first", keyC, stringType),
          namedField("second", keyD, stringType),
        ]), "inference.nominal-mismatch"],
        ["result", callable([
          namedField("first", keyC, numberType),
          namedField("second", keyD, stringType),
        ], stringType), "inference.nominal-mismatch"],
        ["arity", callable([namedField("only", keyC, numberType)]), "inference.arity-mismatch"],
      ];
      for (const [label, right, code] of cases) {
        for (const outcome of [unify(left, right), unify(right, left)]) {
          expect(outcome.$tag, label).toBe("Invalid");
          expect("plan" in outcome, label).toBe(false);
          if (outcome.$tag !== "Invalid") continue;
          expect(outcome.diagnostics.map(({ code }) => code), label).toContain(code);
        }
      }
    });

    test("preserves set-former abstention and lets a definite sibling refutation win", () => {
      const top: FenelType = { $complement: { $void: true } };
      const left = callable([namedField("value", keyA, numberType)]);
      const uncertain = callable([namedField("input", keyC, top)]);
      for (const outcome of [unify(left, uncertain), unify(uncertain, left)]) {
        expect(outcome.$tag).toBe("AnnotationRequired");
        if (outcome.$tag === "Solved") continue;
        expect(outcome.diagnostics.map(({ code }) => code))
          .toEqual(["inference.set-former-indeterminate"]);
      }

      for (const fenceFirst of [true, false]) {
        const actual = callable([
          namedField("first", keyA, fenceFirst ? numberType : stringType),
          namedField("second", keyB, fenceFirst ? stringType : numberType),
        ]);
        const wanted = callable([
          namedField("first", keyC, fenceFirst ? top : numberType),
          namedField("second", keyD, fenceFirst ? numberType : top),
        ]);
        for (const outcome of [unify(actual, wanted), unify(wanted, actual)]) {
          expect(outcome.$tag).toBe("Invalid");
          if (outcome.$tag !== "Invalid") continue;
          expect(outcome.diagnostics.map(({ code }) => code))
            .toEqual(["inference.nominal-mismatch"]);
        }
      }
      const returnMismatch = unify(left,
        callable([namedField("input", keyC, top)], stringType));
      expect(returnMismatch.$tag).toBe("Invalid");
      if (returnMismatch.$tag !== "Invalid") return;
      expect(returnMismatch.diagnostics.map(({ code }) => code))
        .toEqual(["inference.nominal-mismatch"]);
    });

    test("keeps record field identity matching inside independently owned arrow parameters", () => {
      const record: FenelType = { $record: { fields: [
        namedField("amount", keyA, numberType),
        namedField("caption", keyB, stringType),
      ] } };
      const reordered: FenelType = { $record: { fields: [
        namedField("renamed-caption", keyB, stringType),
        namedField("renamed-amount", keyA, numberType),
      ] } };
      const differentOwner: FenelType = { $record: { fields: [
        namedField("amount", keyC, numberType),
        namedField("caption", keyB, stringType),
      ] } };
      const actual = callable([namedField("row", keyC, record)]);
      const equivalent = callable([namedField("input", keyD, reordered)]);
      expect(unify(actual, equivalent).$tag).toBe("Solved");
      expect(unify(equivalent, actual).$tag).toBe("Solved");

      const distinct = callable([namedField("input", keyD, differentOwner)]);
      for (const outcome of [unify(actual, distinct), unify(distinct, actual)]) {
        expect(outcome.$tag).toBe("Invalid");
        if (outcome.$tag !== "Invalid") continue;
        expect(outcome.diagnostics.map(({ code }) => code))
          .toContain("inference.field-key-mismatch");
      }
    });
  });

  test("normalizes curry-equivalent arrows bidirectionally at flattened positional identities", () => {
    const curried: FenelType = {
      $arrow: {
        params: [positionalField("outer-wire", 0, numberType)],
        returns: {
          $arrow: {
            params: [positionalField("inner-wire", 0, stringType)],
            returns: numberType,
          },
        },
      },
    };
    const flattened: FenelType = {
      $arrow: {
        params: [
          positionalField("flat-left", 0, numberType),
          positionalField("flat-right", 1, stringType),
        ],
        returns: numberType,
      },
    };

    const curriedToFlat = unify(curried, flattened);
    const flatToCurried = unify(flattened, curried);
    expect(curriedToFlat.$tag).toBe("Solved");
    expect(flatToCurried.$tag).toBe("Solved");
    if (curriedToFlat.$tag !== "Solved" || flatToCurried.$tag !== "Solved") return;

    expect(curriedToFlat.plan.scheme.body).toEqual(flatToCurried.plan.scheme.body);
    const body = curriedToFlat.plan.scheme.body as InternalArrowBody;
    expect(body.tag).toBe("ItArrow");
    expect(body.params.map(({ key, keyToken, wireName }) => ({
      key,
      keyToken,
      wireName,
    }))).toEqual([
      {
        key: { $tag: "PositionalField", index: 0 },
        keyToken: "p:0",
        wireName: "_0",
      },
      {
        key: { $tag: "PositionalField", index: 1 },
        keyToken: "p:1",
        wireName: "_1",
      },
    ]);
  });

  test("rejects duplicate post-flatten named keys and wires symmetrically without a plan", () => {
    const keyA = "31111111-1111-4111-8111-111111111111";
    const keyB = "32222222-2222-4222-8222-222222222222";
    const curried = (outer: FieldDef, inner: FieldDef): FenelType => ({
      $arrow: {
        params: [outer],
        returns: {
          $arrow: {
            params: [inner],
            returns: numberType,
          },
        },
      },
    });
    const flat = (left: FieldDef, right: FieldDef): FenelType => ({
      $arrow: { params: [left, right], returns: numberType },
    });
    const validCurried = curried(
      namedField("outer", keyA, numberType),
      namedField("inner", keyB, numberType),
    );
    const validFlat = flat(
      namedField("outer", keyA, numberType),
      namedField("inner", keyB, numberType),
    );
    expect(unify(validCurried, validFlat).$tag).toBe("Solved");
    expect(unify(validFlat, validCurried).$tag).toBe("Solved");

    const duplicateKey = curried(
      namedField("outer", keyA, numberType),
      namedField("inner", keyA, numberType),
    );
    const duplicateWire = curried(
      namedField("same-wire", keyA, numberType),
      namedField("same-wire", keyB, numberType),
    );
    const rejected = [
      unify(duplicateKey, validFlat),
      unify(validFlat, duplicateKey),
      unify(duplicateKey, duplicateKey),
      unify(duplicateWire, duplicateWire),
    ];
    for (const outcome of rejected) {
      expect(outcome.$tag).toBe("Invalid");
      expect("plan" in outcome).toBe(false);
      if (outcome.$tag !== "Invalid") continue;
      expect(outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.invalid-arrow-fields",
      );
    }
  });

  test("accepts well-formed lock-less SourceHandles in arrows and rejects malformed lookalikes", () => {
    const sourceHandle = "field:function%3Ainference-test%3Asource/named%3Avalue";
    const sourceArrow: FenelType = {
      $arrow: {
        params: [namedField("value", sourceHandle, numberType)],
        returns: numberType,
      },
    };
    expect(unify(sourceArrow, sourceArrow).$tag).toBe("Solved");

    const malformed: FenelType = {
      $arrow: {
        params: [namedField("value", "field:owner//named%3Avalue", numberType)],
        returns: numberType,
      },
    };
    const rejected = unify(malformed, malformed);
    expect(rejected.$tag).toBe("Invalid");
    if (rejected.$tag !== "Invalid") return;
    expect(rejected.diagnostics.map(({ code }) => code)).toEqual([
      "inference.invalid-arrow-fields",
    ]);
  }, 180_000);

  test("returns the remaining arrow for partial application", () => {
    const partial = arrow(solvedType({ call: ["add", 1] }, resolverOptions));
    expect(partial.params).toHaveLength(1);
    expect(partial.params[0]!.key).toEqual({ $tag: "PositionalField", index: 0 });
    expect(partial.params[0]!.type).toEqual(numberType);
    expect(partial.returns).toEqual(numberType);
  });

  test("ground literals use exact system owners and bridge only admitted raw spellings", () => {
    const inferAccepted = (
      literal: string | number | boolean,
      publicName: string,
      identity?: string,
    ) => {
      const type = ref(publicName);
      const param = positionalField("value", 0, type);
      const scheme: TypeScheme = {
        ...monomorphicScheme([param], type),
        ...(identity === undefined
          ? {}
          : {
              nominals: [{
                path: ["$arrow", "params", "0", "type"],
                identity,
                publicName,
              }],
            }),
      };
      return inferJsonLogicType(
        { call: ["accept", literal] },
        {
          resolveFunction: (name) => name === "accept"
            ? { params: [param], returns: type, scheme, targetId: "ground:accept" }
            : undefined,
        },
      );
    };
    const ground = [
      ["text", "String"],
      [1, "Number"],
      [true, "Boolean"],
    ] as const;

    for (const [literal, publicName] of ground) {
      const inferred = inferJsonLogicType(literal);
      expect(inferred.outcome.$tag).toBe("Solved");
      expect(inferred.scheme?.nominals).toEqual([{
        path: [],
        identity: `["system","${publicName}"]`,
        publicName,
      }]);
      expect(inferAccepted(literal, publicName).outcome.$tag).toBe("Solved");

      const custom = inferAccepted(literal, publicName, `["custom","${publicName}"]`);
      expect(custom.outcome.$tag).toBe("Invalid");
      if (custom.outcome.$tag === "Invalid") {
        expect(custom.outcome.diagnostics.map(({ code }) => code)).toContain(
          "inference.nominal-mismatch",
        );
        expect(custom.outcome.diagnostics.find(({ code }) => code === "inference.nominal-mismatch")?.message)
          .toBe(`Both types are called ${publicName}, but they do not refer to the same type declaration.`);
      }
    }

    for (const [literal, distinctName] of [[1, "Int"], [true, "Bool"]] as const) {
      const distinct = inferAccepted(literal, distinctName);
      expect(distinct.outcome.$tag).toBe("Invalid");
      if (distinct.outcome.$tag === "Invalid") {
        expect(distinct.outcome.diagnostics.map(({ code }) => code)).toContain(
          "inference.nominal-mismatch",
        );
      }
    }
  });

  test("canonical List comparison constrains elements and survives a public round-trip", () => {
    const mismatch = unify(List(numberType), List(stringType));
    expect(mismatch.$tag).toBe("Invalid");
    if (mismatch.$tag === "Invalid") {
      expect(mismatch.diagnostics.map(({ code }) => code)).toContain(
        "inference.nominal-mismatch",
      );
    }

    const empty = inferJsonLogicType([]);
    expect(empty.outcome.$tag).toBe("Solved");
    expect(empty.type).toHaveProperty("$el.call.0", "List");
    expect(empty.scheme?.applications?.[0]?.path).toEqual([]);
    expect(empty.scheme?.nominals).toEqual([{
      path: [],
      identity: '["system","List"]',
      publicName: "List",
    }]);

    const listParam = positionalField("_0", 0, List(numberType));
    const acceptNumbers = monomorphicScheme([listParam], ref("Boolean"));
    const consumed = inferJsonLogicType(
      { call: ["acceptNumbers", { var: "numbers" }] },
      {
        bindings: { numbers: empty.scheme! },
        resolveFunction: (name) => name === "acceptNumbers"
          ? {
              params: [listParam],
              returns: ref("Boolean"),
              scheme: acceptNumbers,
              targetId: "consumer:acceptNumbers",
            }
          : undefined,
      },
    );
    expect(consumed.outcome.$tag).toBe("Solved");
    expect(consumed.type).toEqual(ref("Boolean"));
  }, 180_000);

  test("rejects nominal mismatch and checks exact records, tuples, and maps", () => {
    const mismatch = inferJsonLogicType({ call: ["inc", "bad"] }, resolverOptions);
    expect(mismatch.outcome.$tag).toBe("Invalid");
    if (mismatch.outcome.$tag === "Invalid") {
      expect(mismatch.outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "inference.nominal-mismatch",
      );
      expect(mismatch.outcome.diagnostics.find(({ code }) => code === "inference.nominal-mismatch")?.message)
        .toBe("String is not Number");
    }

    const keyA = "11111111-1111-4111-8111-111111111111";
    const keyB = "22222222-2222-4222-8222-222222222222";
    const record: FenelType = {
      $record: {
        fields: [
          namedField("left-wire", keyA, numberType),
          namedField("right-wire", keyB, stringType),
        ],
      },
    };
    const renamedAndReordered: FenelType = {
      $record: {
        fields: [
          namedField("renamed-right", keyB, stringType),
          namedField("renamed-left", keyA, numberType),
        ],
      },
    };
    expect(unify(record, renamedAndReordered).$tag).toBe("Solved");
    const reorderedSameProjection: FenelType = {
      $record: {
        fields: [
          namedField("right-wire", keyB, stringType),
          namedField("left-wire", keyA, numberType),
        ],
      },
    };
    const recordPlan = unify(record, record);
    const reorderedRecordPlan = unify(reorderedSameProjection, reorderedSameProjection);
    expect(recordPlan.$tag).toBe("Solved");
    expect(reorderedRecordPlan.$tag).toBe("Solved");
    if (recordPlan.$tag === "Solved" && reorderedRecordPlan.$tag === "Solved") {
      expect(recordPlan.plan.scheme.body).toEqual(reorderedRecordPlan.plan.scheme.body);
    }
    const duplicateRecord: FenelType = {
      $record: {
        fields: [
          namedField("first", keyA, numberType),
          namedField("duplicate", keyA, numberType),
        ],
      },
    };
    expect(unify(duplicateRecord, duplicateRecord).$tag).toBe("Invalid");
    expect(unify(record, {
      $record: {
        fields: [
          namedField("left-wire", keyB, numberType),
          namedField("right-wire", keyA, stringType),
        ],
      },
    }).$tag).toBe("Invalid");

    expect(unify(
      { $tuple: [numberType, stringType] },
      { $tuple: [numberType, stringType] },
    ).$tag).toBe("Solved");
    expect(unify(
      { $tuple: [numberType] },
      { $tuple: [numberType, stringType] },
    ).$tag).toBe("Invalid");

    const keys = { $tag: "SeEnum" as const, values: ["a"] };
    expect(unify(
      { $map: { keys, values: numberType } },
      { $map: { keys, values: numberType } },
    ).$tag).toBe("Solved");
    expect(unify(
      { $map: { keys, values: numberType } },
      { $map: { keys: { $tag: "SeEnum", values: ["b"] }, values: numberType } },
    ).$tag).toBe("Invalid");
  });

  test("unifies variants as width-exact constructor sets independent of case order", () => {
    const variant = (...caseNames: readonly string[]): FenelType => ({
      $variant: {
        cases: caseNames.map((name) => ({ name, fields: [], label: Nothing })),
      },
    });
    const complete = variant("Failed", "Ready");
    const permuted = variant("Ready", "Failed");

    const forward = unify(complete, permuted);
    const reverse = unify(permuted, complete);
    expect(forward.$tag).toBe("Solved");
    expect(reverse.$tag).toBe("Solved");
    if (forward.$tag === "Solved" && reverse.$tag === "Solved") {
      expect(forward.plan.scheme.body).toEqual(reverse.plan.scheme.body);
    }

    for (const [label, outcome] of [
      ["extra case", unify(complete, variant("Failed", "Pending", "Ready"))],
      ["missing case", unify(complete, variant("Ready"))],
    ] as const) {
      expect(outcome.$tag, label).toBe("Invalid");
      if (outcome.$tag === "Invalid") {
        expect(outcome.diagnostics.map(({ code }) => code), label).toContain(
          "inference.variant-width-mismatch",
        );
      }
    }

    const substituted = unify(complete, variant("Failed", "Pending"));
    expect(substituted.$tag).toBe("Invalid");
    if (substituted.$tag === "Invalid") {
      expect(substituted.diagnostics.map(({ code }) => code)).toContain(
        "inference.constructor-mismatch",
      );
    }
  }, 30_000);

  test("canonicalizes structural records and output-only branch unions", () => {
    const firstRecord: Record<string, unknown> = {};
    firstRecord.name = "Ada";
    firstRecord.age = 42;
    const secondRecord: Record<string, unknown> = {};
    secondRecord.age = 42;
    secondRecord.name = "Ada";
    expect(solvedType(firstRecord)).toEqual(solvedType(secondRecord));

    const forward = solvedType({ if: [true, 1, "x"] });
    const reversed = solvedType({ if: [true, "x", 1] });
    expect(forward).toEqual(reversed);
    expect("$union" in forward ? forward.$union : undefined).toHaveLength(2);
  });

  test("publishes authored functions from the canonical Fenel-planned scheme", () => {
    const sourceList = List({ $var: "a" });
    const param = positionalField("items", 0, sourceList);
    const fn: FenelFunction = {
      id: "inference-test:authoredCanonicalList",
      params: [param],
      returns: numberType,
      body: { call: ["length", { var: "items" }] },
    };
    const [finalized] = finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "authoredCanonicalList",
        codeName: "authoredCanonicalList",
        scheme: {
          quantified: [{
            id: "q0",
            sourceName: "a",
            kind: { $tag: "KType" },
          }],
          body: { $arrow: { params: fn.params, returns: fn.returns } },
        },
        params: [authoredHostSlot],
        returns: authoredHostSlot,
      },
      implementationOrigin: { $tag: "FenelBody" },
    }]);

    expect(finalized).toBeDefined();
    if (finalized === undefined) return;
    expect(finalized.fn).not.toBe(fn);
    expect(finalized.info.scheme.body)
      .toEqual({ $arrow: { params: finalized.fn.params, returns: finalized.fn.returns } });
    expect(fn.params[0]!.type).toBe(sourceList);
    expect(opaqueVariantCaseNames(sourceList)).toEqual(["Nil", "Cons"]);
    expect(opaqueVariantCaseNames(finalized.fn.params[0]!.type)).toEqual(["Cons", "Nil"]);
  }, 180_000);

  test("discharges proved refinement residuals and distinguishes refuted/indeterminate", () => {
    expect(unify(numberType, {
      $refined: { base: numberType, set: { $tag: "SeAll" } },
    }).$tag).toBe("Solved");
    expect(unify(numberType, {
      $refined: { base: numberType, set: { $tag: "SeNone" } },
    }).$tag).toBe("Invalid");
    expect(unify(numberType, {
      $refined: { base: numberType, set: { $tag: "SeWhere", pred: { var: "x" } } },
    }).$tag).toBe("AnnotationRequired");
  });

  test("fences union consumers, unresolved/dependent calls, and reflection", () => {
    const unionConsumer = inferJsonLogicType({
      call: ["inc", { if: [true, 1, "x"] }],
    }, resolverOptions);
    expect(unionConsumer.outcome.$tag).toBe("AnnotationRequired");

    expect(inferJsonLogicType({ call: ["missing", 1] }).outcome.$tag).toBe(
      "AnnotationRequired",
    );
    expect(inferJsonLogicType({
      method: ["Foldable", "foldr", 1],
    }).outcome.$tag).toBe("AnnotationRequired");
    expect(inferJsonLogicType(
      { var: "dependent" },
      { bindings: { dependent: { $el: { var: "typeId" } } as FenelType } },
    ).outcome.$tag).toBe("AnnotationRequired");
  });

  test("recursively fences union callees and every elimination consumer", () => {
    const unionType: FenelType = { $union: [numberType, stringType] };
    const boxedUnion: TypeScheme = {
      quantified: [],
      body: { $tuple: [unionType] },
    };
    const boxedVariable: FenelType = { $tuple: [{ $var: "a" }] };
    const forgetParam = positionalField("value", 0, boxedVariable);
    const forgetScheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }],
      body: {
        $arrow: {
          params: [forgetParam],
          returns: { $unit: true },
        },
      },
    };
    const nestedConsumer = inferJsonLogicType(
      { call: ["forget", { var: "boxed" }] },
      {
        bindings: { boxed: boxedUnion },
        resolveFunction: (name) => name === "forget"
          ? {
              params: [forgetParam],
              returns: { $unit: true },
              scheme: forgetScheme,
              targetId: "inference-test:forget",
            }
          : undefined,
      },
    );
    expect(nestedConsumer.outcome.$tag).toBe("AnnotationRequired");
    if (nestedConsumer.outcome.$tag === "AnnotationRequired") {
      expect(nestedConsumer.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.union-consumer",
      ]);
    }

    const conditionConsumer = inferJsonLogicType({
      if: [{ if: [true, true, "not-boolean"] }, 1, 2],
    });
    expect(conditionConsumer.outcome.$tag).toBe("AnnotationRequired");
    if (conditionConsumer.outcome.$tag === "AnnotationRequired") {
      expect(conditionConsumer.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.union-consumer",
      ]);
    }

    const guardConsumer = inferJsonLogicType({
      match: [
        1,
        { $guard: ["_", { if: [true, true, "not-boolean"] }] },
        1,
        0,
      ],
    });
    expect(guardConsumer.outcome.$tag).toBe("AnnotationRequired");
    if (guardConsumer.outcome.$tag === "AnnotationRequired") {
      expect(guardConsumer.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.union-consumer",
      ]);
    }

    const matchConsumer = inferJsonLogicType({
      match: [{ if: [true, 1, "text"] }, "_", 1],
    });
    expect(matchConsumer.outcome.$tag).toBe("AnnotationRequired");
    if (matchConsumer.outcome.$tag === "AnnotationRequired") {
      expect(matchConsumer.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.union-consumer",
      ]);
    }

    const unaryNumberArrow: FenelType = {
      $arrow: {
        params: [positionalField("value", 0, numberType)],
        returns: numberType,
      },
    };
    const unaryStringArrow: FenelType = {
      $arrow: {
        params: [positionalField("value", 0, numberType)],
        returns: stringType,
      },
    };
    const unionCallee = inferJsonLogicType(
      { call: [{ var: "choice" }, 1] },
      {
        bindings: {
          choice: {
            quantified: [],
            body: { $union: [unaryNumberArrow, unaryStringArrow] },
          },
        },
      },
    );
    expect(unionCallee.outcome.$tag).toBe("AnnotationRequired");
    if (unionCallee.outcome.$tag === "AnnotationRequired") {
      expect(unionCallee.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.union-callee",
      ]);
    }
  }, 180_000);

  test("fences a monomorphic lambda parameter required at higher rank", () => {
    const outcome = inferJsonLogicType({
      fn: [["callback"], {
        do: [
          { call: [{ var: "callback" }, 1] },
          { call: [{ var: "callback" }, "text"] },
        ],
      }],
    });
    expect(outcome.outcome.$tag).toBe("AnnotationRequired");
    if (outcome.outcome.$tag !== "AnnotationRequired") return;
    expect(outcome.outcome.diagnostics.map(({ code }) => code)).toEqual([
      "inference.higher-rank",
    ]);
  }, 180_000);

  test("consumes authoritative higher-kinded scheme applications without evaluating $el", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied: FenelType = { $el: { call: ["f", { $var: "a" }] } };
    const param = positionalField("value", 0, applied);
    const scheme = {
      quantified: [
        { id: "q0", sourceName: "f", kind: k1 },
        { id: "q1", sourceName: "a", kind: kType },
      ],
      body: { $arrow: { params: [param], returns: applied } } as FenelType,
      applications: [
        { path: ["$arrow", "params", "0", "type"], headVarId: "q0", args: [{ $var: "a" }], kind: k1 },
        { path: ["$arrow", "returns"], headVarId: "q0", args: [{ $var: "a" }], kind: k1 },
      ],
    };
    const outcome = inferJsonLogicType({ var: "higher" }, {
      resolveFunction: (id) => id === "higher"
        ? { params: [param], returns: applied, scheme }
        : undefined,
    });
    expect(outcome.outcome.$tag).toBe("Solved");
    expect(outcome.type).toHaveProperty("$arrow");
  });

  test("fences a resolved authoring callable with no registry scheme", () => {
    const outcome = inferJsonLogicType({ call: ["legacy", 1] }, {
      resolveFunction: (id) => id === "legacy"
        ? {
            params: [positionalField("value", 0, numberType)],
            returns: numberType,
          }
        : undefined,
    });
    expect(outcome.outcome.$tag).toBe("Invalid");
    if (outcome.outcome.$tag === "Invalid") {
      expect(outcome.outcome.diagnostics[0]?.message).toContain(
        "no authoritative registry TypeScheme",
      );
    }
  });

  test("the editor bridge and loader boundary return the same Fenel result", () => {
    const logic = { call: ["inc", 1] };
    const direct = inferJsonLogicType(logic, resolverOptions);
    const entry: AuthoringFunctionEntry = {
      id: "inc",
      params: [positionalField("value", 0, numberType)],
      returns: numberType,
      scheme: monomorphicScheme([positionalField("value", 0, numberType)], numberType),
    };
    const authoring = inferAuthoringExpression(logicToExprNode(logic), {
      getFunctionEntry: (id) => id === "inc" ? entry : undefined,
    });
    expect(authoring).toEqual(direct);
  });

  test("rejects hostile options, resolver results, cycles, and malformed keys inertly", () => {
    let getterRuns = 0;
    const hostileOptions = {} as JsonLogicInferenceOptions;
    Object.defineProperty(hostileOptions, "resolveFunction", {
      enumerable: true,
      get() {
        getterRuns += 1;
        return () => undefined;
      },
    });
    expect(inferJsonLogicType({ call: ["inc", 1] }, hostileOptions).outcome.$tag).toBe(
      "Invalid",
    );
    expect(getterRuns).toBe(0);

    const hostileResult = {
      params: [positionalField("value", 0, numberType)],
    } as { params: FieldDef[]; returns: FenelType };
    Object.defineProperty(hostileResult, "returns", {
      enumerable: true,
      get() {
        getterRuns += 1;
        return numberType;
      },
    });
    expect(inferJsonLogicType(
      { call: ["inc", 1] },
      { resolveFunction: () => hostileResult },
    ).outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);

    const cyclic: { $tuple: FenelType[] } = { $tuple: [] };
    cyclic.$tuple.push(cyclic);
    expect(inferJsonLogicType(
      { var: "cycle" },
      { bindings: { cycle: cyclic } },
    ).outcome.$tag).toBe("AnnotationRequired");

    const cyclicKind: Record<string, unknown> = {
      $tag: "KArrow",
      input: { $tag: "KType" },
    };
    cyclicKind.output = cyclicKind;
    expect(inferJsonLogicType(
      { var: "kinded" },
      {
        resolveFunction: (id) => id === "kinded"
          ? {
              params: [],
              returns: numberType,
              scheme: {
                quantified: [{
                  id: "q0",
                  sourceName: "a",
                  kind: cyclicKind as never,
                }],
                body: { $var: "a" },
              },
            }
          : undefined,
      },
    ).outcome.$tag).toBe("Invalid");

    const malformedRemainingParam = {
      ...positionalField("right", 1, numberType),
      key: { $tag: "NamedField", ref: { $ref: "" } },
    } as FieldDef;
    expect(inferJsonLogicType(
      { call: ["badKey", 1] },
      {
        resolveFunction: (id) => id === "badKey"
          ? {
              params: [
                positionalField("left", 0, numberType),
                malformedRemainingParam,
              ],
              returns: numberType,
            }
          : undefined,
      },
    ).outcome.$tag).not.toBe("Solved");
  });

  test("top-level missing-slot planning is invariant to candidate order", () => {
    const candidate = (id: string): RegistryFunctionSignatureCandidate => {
      const fn: FenelFunction = {
        id,
        params: [positionalField("value", 0, { $var: "compat" })],
        returns: { $var: "compat-return" },
        body: { var: "value" },
      };
      return {
        fn,
        declaration: {
          functionId: id,
          declarationName: id.slice(id.indexOf(":") + 1),
          codeName: id.slice(id.indexOf(":") + 1),
          params: [{ $tag: "Absent" }],
          returns: { $tag: "Absent" },
        },
        implementationOrigin: { $tag: "FenelBody" },
      };
    };
    const a = candidate("inference-test:a");
    const z = candidate("inference-test:z");
    const forward = finalizeFixture([a, z]);
    const reversed = finalizeFixture([z, a]);
    const schemes = (rows: typeof forward) => Object.fromEntries(
      rows.map((row) => [row.fn.id, row.info.scheme]),
    );
    expect(schemes(forward)).toEqual(schemes(reversed));
    for (const row of forward) {
      expect(row.info.params[0]).toEqual({
        $tag: "Inferred",
        engine: "fenel-rank1",
        version: "1",
        derivation: row.info.outcome.$tag === "Solved"
          ? row.info.outcome.derivation
          : undefined,
      });
      expect(row.info.returns).toEqual({
        $tag: "Inferred",
        engine: "fenel-rank1",
        version: "1",
        derivation: row.info.outcome.$tag === "Solved"
          ? row.info.outcome.derivation
          : undefined,
      });
    }
  });

  test("registry finalization consumes only an explicit exact routing table", () => {
    expect(finalizeRegistryFunctionSignatures([], { resolutions: [] })).toEqual([]);
    expect(() => finalizeRegistryFunctionSignatures([], undefined as never)).toThrow(
      "requires an explicit exact resolutions table",
    );
    expect(() => finalizeRegistryFunctionSignatures([], {
      resolutions: [{ name: "", status: "missing", targetId: "" }],
    })).toThrow("routing name must be nonempty");
    expect(() => finalizeRegistryFunctionSignatures([], {
      resolutions: [{ name: "x", status: "resolved", targetId: "" }],
    })).toThrow("resolved/fenced rows require a nonempty targetId");
    expect(() => finalizeRegistryFunctionSignatures([], {
      resolutions: [
        { name: "x", status: "missing", targetId: "" },
        { name: "x", status: "missing", targetId: "" },
      ],
    })).toThrow("duplicate exact routing row");
  });

  test("partial schemes reserve authored ids and source names during alpha-normalization", () => {
    const param = positionalField("value", 0, { $var: "a1" });
    const fn: FenelFunction = {
      id: "inference-test:reservedAlphaNames",
      params: [param],
      returns: { $var: "compat-return" },
      body: [],
    };
    const [finalized] = finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "reservedAlphaNames",
        codeName: "reservedAlphaNames",
        scheme: {
          quantified: [{
            id: "a0",
            sourceName: "a1",
            kind: { $tag: "KType" },
          }],
          body: { $arrow: { params: [param], returns: fn.returns } },
          diagnostics: [],
        },
        params: [authoredHostSlot],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    }]);

    expect(finalized!.info.scheme.quantified.map(({ id }) => id)).toEqual(["a0", "a2"]);
    expect(finalized!.info.scheme.quantified.map(({ sourceName }) => sourceName)).toEqual([
      "a1",
      "a2",
    ]);
    expect(finalized!.info.scheme.body).toEqual({
      $arrow: {
        params: [positionalField("_0", 0, { $var: "a1" })],
        returns: { $el: { call: ["List", { $var: "a2" }] } },
      },
    });
  });

  test("rebases authoritative application sidecars across curried arrow flattening", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const appliedA: FenelType = { $el: { call: ["f", { $var: "a" }] } };
    const appliedB: FenelType = { $el: { call: ["f", { $var: "b" }] } };
    const sourceBody: FenelType = {
      $arrow: {
        params: [positionalField("_0", 0, appliedA)],
        returns: {
          $arrow: {
            params: [positionalField("_0", 0, appliedB)],
            returns: appliedA,
          },
        },
      },
    };
    const fn: FenelFunction = {
      id: "inference-test:curriedHigher",
      params: [
        positionalField("left", 0, appliedA),
        positionalField("right", 1, appliedB),
      ],
      returns: appliedA,
      body: { var: "left" },
    };
    const authored = {
      $tag: "Authored" as const,
      source: {
        $tag: "SourceTypeSig" as const,
        module: "inference-test",
        declaration: "curriedHigher",
      },
    };
    const [finalized] = finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "curriedHigher",
        codeName: "curriedHigher",
        scheme: {
          quantified: [
            { id: "q0", sourceName: "f", kind: k1 },
            { id: "q1", sourceName: "a", kind: kType },
            { id: "q2", sourceName: "b", kind: kType },
          ],
          body: sourceBody,
          applications: [
            {
              path: ["$arrow", "params", "0", "type"],
              headVarId: "q0",
              args: [{ $var: "a" }],
              kind: k1,
            },
            {
              path: ["$arrow", "returns", "$arrow", "params", "0", "type"],
              headVarId: "q0",
              args: [{ $var: "b" }],
              kind: k1,
            },
            {
              path: ["$arrow", "returns", "$arrow", "returns"],
              headVarId: "q0",
              args: [{ $var: "a" }],
              kind: k1,
            },
          ],
        },
        params: [authored, authored],
        returns: authored,
      },
      implementationOrigin: { $tag: "FenelBody" },
    }]);

    expect(finalized!.info.scheme.applications?.map((application) => application.path)).toEqual([
      ["$arrow", "params", "0", "type"],
      ["$arrow", "params", "1", "type"],
      ["$arrow", "returns"],
    ]);
  }, 180_000);

  test("decodes Fenel-authored nominal application head kinds without arity synthesis", () => {
    const kType = { $tag: "KType" } as const;
    const residual = { $tag: "KArrow", input: kType, output: kType } as const;
    const nominalHeadKind = {
      $tag: "KArrow",
      input: kType,
      output: residual,
    } as const;
    const applied: FenelType = { $el: { call: ["HigherNominal", { $var: "a" }] } };
    const fn: FenelFunction = {
      id: "inference-test:nominalHeadKind",
      params: [positionalField("value", 0, applied)],
      returns: applied,
      body: { var: "value" },
    };
    const [finalized] = finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "nominalHeadKind",
        codeName: "nominalHeadKind",
        scheme: {
          quantified: [{ id: "q0", sourceName: "a", kind: kType }],
          body: { $arrow: { params: fn.params, returns: fn.returns } },
          applications: [
            {
              path: ["$arrow", "params", "0", "type"],
              headRef: "HigherNominal",
              args: [{ $var: "a" }],
              kind: nominalHeadKind,
            },
            {
              path: ["$arrow", "returns"],
              headRef: "HigherNominal",
              args: [{ $var: "a" }],
              kind: nominalHeadKind,
            },
          ],
          diagnostics: [],
        },
        params: [authoredHostSlot],
        returns: authoredHostSlot,
      },
      implementationOrigin: { $tag: "FenelBody" },
    }]);
    expect(finalized!.info.scheme.applications?.map((application) => application.kind)).toEqual([
      nominalHeadKind,
      nominalHeadKind,
    ]);
  }, 180_000);

  test("top-level absent slots fence higher-order dynamic calls until effect rows exist", () => {
    const fn: FenelFunction = {
      id: "inference-test:dynamicApply",
      params: [
        positionalField("callback", 0, { $var: "compat-callback" }),
        positionalField("value", 1, { $var: "compat-value" }),
      ],
      returns: { $var: "compat-return" },
      body: { call: [{ var: "callback" }, { var: "value" }] },
    };
    expect(() => finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "dynamicApply",
        codeName: "dynamicApply",
        params: [{ $tag: "Absent" }, { $tag: "Absent" }],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    }])).toThrow("inference.effect-polymorphism");
  }, 180_000);

  test("direct inferSyntaxType fences a dynamic call whose effects are polymorphic", () => {
    const outcome = dispatchEngineBody("engine:inferSyntaxType", [
      surfaceSyntax({
        fn: [["callback", "value"], {
          call: [{ var: "callback" }, { var: "value" }],
        }],
      }),
      [],
      [],
      "tests/signature-inference/dynamic-effect",
    ]) as RawInferenceOutcome;
    expect(outcome.$tag).toBe("AnnotationRequired");
    if (outcome.$tag !== "AnnotationRequired") return;
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "inference.effect-polymorphism",
    ]);
  }, 180_000);

  test("fences top-level polymorphic recursion without weakening the ordinary occurs check", () => {
    const fn: FenelFunction = {
      id: "inference-test:polyRecursive",
      params: [positionalField("value", 0, { $var: "compat-param" })],
      returns: { $var: "compat-return" },
      body: {
        call: [
          "polyRecursive",
          { fn: [["ignored"], { var: "value" }] },
        ],
      },
    };
    expect(() => finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "polyRecursive",
        codeName: "polyRecursive",
        params: [{ $tag: "Absent" }],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    }])).toThrow("inference.polymorphic-recursion");

    const ordinaryOccurs = inferJsonLogicType({
      fn: [["x"], { call: [{ var: "x" }, { var: "x" }] }],
    });
    expect(ordinaryOccurs.outcome.$tag).toBe("Invalid");
    if (ordinaryOccurs.outcome.$tag === "Invalid") {
      expect(ordinaryOccurs.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.occurs-check",
      );
    }
  }, 180_000);

  test("accepts mutual recursion across Expr and List Expr carrier boundaries", () => {
    const exprType = ref("Expr");
    const exprListType = List(exprType);
    const candidate = (
      name: "walkExpr" | "walkExprs",
      peer: "walkExpr" | "walkExprs",
      params: [FieldDef, FieldDef],
    ): RegistryFunctionSignatureCandidate => {
      const id = `inference-test:${name}`;
      const returns = exprListType;
      const fn: FenelFunction = {
        id,
        params,
        returns,
        body: {
          call: [peer, { var: params[1]!.name }, { var: params[0]!.name }],
        },
      };
      const sourceSlot = {
        $tag: "Authored" as const,
        source: {
          $tag: "SourceTypeSig" as const,
          module: "inference-test",
          declaration: name,
        },
      };
      return {
        fn,
        declaration: {
          functionId: id,
          declarationName: name,
          codeName: name,
          scheme: {
            quantified: [],
            body: { $arrow: { params, returns } },
            diagnostics: [],
          },
          params: [sourceSlot, sourceSlot],
          returns: sourceSlot,
        },
        implementationOrigin: { $tag: "FenelBody" },
      };
    };
    const walkExpr = candidate("walkExpr", "walkExprs", [
      positionalField("expr", 0, exprType),
      positionalField("exprs", 1, exprListType),
    ]);
    const walkExprs = candidate("walkExprs", "walkExpr", [
      positionalField("exprs", 0, exprListType),
      positionalField("expr", 1, exprType),
    ]);

    const finalized = finalizeFixture([walkExpr, walkExprs]);
    expect(finalized).toHaveLength(2);
    const [walkExprArrow, walkExprsArrow] = finalized.map(({ info }) =>
      arrow(info.scheme.body)
    );
    expect(walkExprArrow!.params[0]!.type).toEqual(exprType);
    expect(walkExprsArrow!.params[1]!.type).toEqual(exprType);
    expect(walkExprArrow!.params[1]!.type).not.toEqual(exprType);
    expect(walkExprsArrow!.params[0]!.type).not.toEqual(exprType);
    expect(walkExprArrow!.returns).not.toEqual(exprType);
    expect(walkExprsArrow!.returns).not.toEqual(exprType);
  }, 180_000);

  test("same-spelled authored q0 binders stay declaration-scoped across a failing mutual SCC", () => {
    const candidate = (
      name: "left" | "right",
      peer: "left" | "right",
    ): RegistryFunctionSignatureCandidate => {
      const id = `inference-test:${name}`;
      const paramType: FenelType = { $var: "a" };
      const returns: FenelType = { $var: `compat-${name}-return` };
      const fn: FenelFunction = {
        id,
        params: [positionalField("value", 0, paramType)],
        returns,
        body: { call: [peer, { var: "value" }] },
      };
      return {
        fn,
        declaration: {
          functionId: id,
          declarationName: name,
          codeName: name,
          scheme: {
            quantified: [{
              id: "q0",
              sourceName: "a",
              kind: { $tag: "KType" },
            }],
            body: { $arrow: { params: fn.params, returns } },
            diagnostics: [],
          },
          params: [authoredHostSlot],
          returns: { $tag: "Absent" },
        },
        implementationOrigin: { $tag: "FenelBody" },
      };
    };
    const left = candidate("left", "right");
    const right = candidate("right", "left");
    expect(() => finalizeFixture([left, right])).toThrow(
      "inference.rigid-mismatch",
    );
    // The failed SCC has no publication channel and the shared source objects
    // remain untouched; in particular, no successful prefix rewrites either
    // compatibility return slot.
    expect(left.fn.returns).toEqual({ $var: "compat-left-return" });
    expect(right.fn.returns).toEqual({ $var: "compat-right-return" });
  }, 180_000);

  test("Fenel host binder discovery follows semantic spines, mu scope, slot provenance, and dense order", () => {
    const params = Array.from({ length: 11 }, (_, index) => {
      const field = positionalField(`p${index}`, index, { $var: `v${index}` });
      if (index === 0) {
        field.meta = {
          poison: { $var: "metadataMustNotBind" },
        } as never;
      }
      return field;
    });
    const fn: FenelFunction = {
      id: "inference-test:denseHostBinders",
      params,
      returns: { $var: "v10" },
      body: { var: "p10" },
    };
    const [finalized] = finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "denseHostBinders",
        codeName: "denseHostBinders",
        params: params.map(() => authoredHostSlot),
        returns: authoredHostSlot,
      },
      implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
    }]);
    expect(finalized!.info.scheme.quantified.map(({ id, sourceName }) => ({ id, sourceName })))
      .toEqual(Array.from({ length: 11 }, (_, index) => ({
        id: `q${index}`,
        sourceName: `v${index}`,
      })));

    const recursive: FenelType = {
      $mu: {
        var: "self",
        body: { $tuple: [{ $var: "self" }, { $var: "free" }] },
      },
    };
    const partialFn: FenelFunction = {
      id: "inference-test:partialHostBinders",
      params: [
        positionalField("value", 0, recursive),
        positionalField("placeholder", 1, { $var: "absentMustNotBind" }),
      ],
      returns: { $var: "absentReturnMustNotBind" },
      body: { var: "value" },
    };
    const [partial] = finalizeFixture([{
      fn: partialFn,
      declaration: {
        functionId: partialFn.id,
        declarationName: "partialHostBinders",
        codeName: "partialHostBinders",
        params: [authoredHostSlot, { $tag: "Absent" }],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    }]);
    expect(partial!.info.scheme.quantified.map(({ id, sourceName }) => ({ id, sourceName })))
      .toEqual([
        { id: "q0", sourceName: "free" },
        { id: "a0", sourceName: "a0" },
      ]);
  }, 180_000);

  test("complete authored source diagnostics fence before trust can be published", () => {
    const fn: FenelFunction = {
      id: "inference-test:malformedComplete",
      params: [positionalField("value", 0, numberType)],
      returns: numberType,
      body: { var: "value" },
    };
    expect(() => finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "malformedComplete",
        codeName: "malformedComplete",
        scheme: {
          quantified: [],
          body: { $arrow: { params: fn.params, returns: fn.returns } },
          diagnostics: [{
            code: "UnboundSourceTypeVariable",
            declaration: "malformedComplete",
            path: ["params", "0"],
            spelling: "loose",
            message: "unbound source type variable loose",
          }],
        },
        params: [authoredHostSlot],
        returns: authoredHostSlot,
      },
      implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
    }])).toThrow("inference.source-scheme");
  }, 180_000);

  test("host HKT spellings fence with an actionable authoritative-sidecar diagnostic", () => {
    const hkt = {
      $el: { call: [{ $var: "f" }, { $var: "a" }] },
    } as unknown as FenelType;
    const fn: FenelFunction = {
      id: "inference-test:hostHktWithoutScheme",
      params: [positionalField("value", 0, hkt)],
      returns: hkt,
      body: { var: "value" },
    };
    expect(() => finalizeFixture([{
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "hostHktWithoutScheme",
        codeName: "hostHktWithoutScheme",
        params: [authoredHostSlot],
        returns: authoredHostSlot,
      },
      implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
    }])).toThrow("inference.host-scheme-sidecar");
  }, 180_000);

  test("totality trust canonicalizes exact recursive spellings and fails closed on an unmatched graph", () => {
    const id = "inference-test:countdown";
    const sourceName = "alias:countdown";
    const decreasing = {
      if: [
        { call: ["and", { call: ["gt", { var: "n" }, 0] }, { call: ["lte", { var: "n" }, 1000] }] },
        {
          call: [
            sourceName,
            { call: ["sub", { var: "n" }, 1] },
          ],
        },
        0,
      ],
    };
    expect(inferredGroupTotal(id, sourceName, decreasing)).toBe(true);
    // Without the upper bound the countdown is no descent over JS Numbers
    // (1e20 - 1 = 1e20): inference trust is withheld.
    const unbounded = { if: [{ call: ["gt", { var: "n" }, 0] }, { call: [sourceName, { call: ["sub", { var: "n" }, 1] }] }, 0] };
    expect(inferredGroupTotal(id, sourceName, unbounded)).toBe(false);
    expect(inferredGroupTrustTag(id, sourceName, decreasing)).toBe("InferredDerivation");
    expect(inferredGroupTotal(id, sourceName, decreasing, "missing")).toBe(false);

    const nonDecreasing = { call: [sourceName, { var: "n" }] };
    expect(inferredGroupTotal(id, sourceName, nonDecreasing)).toBe(false);
    expect(inferredGroupTrustTag(id, sourceName, nonDecreasing)).toBe("Advisory");

    // Bare function references participate in the dependency SCC, but they do
    // not produce an ECall graph for the size-change checker. That mismatch
    // must never take the checker's non-recursive vacuity path to trusted.
    expect(inferredGroupTrustTag(id, sourceName, { var: sourceName })).toBe("Advisory");
  }, 180_000);

  test("totality trust reads facts only off spellings routed to the std primitives", () => {
    const id = "inference-test:countdown";
    const sourceName = "alias:countdown";
    const countdown = {
      if: [
        { call: ["gt", { var: "n" }, 0] },
        { if: [{ call: ["lte", { var: "n" }, 1000] }, { call: [sourceName, { call: ["sub", { var: "n" }, 1] }] }, 0] },
        0,
      ],
    };
    expect(inferredGroupTotal(id, sourceName, countdown)).toBe(true);
    // A module of its own defines `gt` and `sub` (gt a b = True, sub a b = a):
    // the same spellings route to those, and the loop never descends.
    const userRows: RoutingRow[] = stdPrimitiveRows.map((row) =>
      row.name === "gt" || row.name === "sub" ? { ...row, targetId: `inference-test:${row.name}` } : row);
    expect(inferredGroupTotal(id, sourceName, countdown, "resolved", userRows)).toBe(false);
    // Unrouted spellings prove nothing either.
    expect(inferredGroupTotal(id, sourceName, countdown, "resolved", [])).toBe(false);
  }, 180_000);

  test("totality trust refuses a binder that shadows the measured parameter", () => {
    const id = "inference-test:countdown";
    const sourceName = "alias:countdown";
    // loop n = (\\n -> if n > 0 && n <= 1000 then loop (n - 1) else 0) $ 1 never returns.
    const inner = {
      if: [
        { call: ["gt", { var: "n" }, 0] },
        { if: [{ call: ["lte", { var: "n" }, 1000] }, { call: [sourceName, { call: ["sub", { var: "n" }, 1] }] }, 0] },
        0,
      ],
    };
    expect(inferredGroupTotal(id, sourceName, { call: ["$", { fn: ["n", inner] }, 1] })).toBe(false);
    expect(inferredGroupTotal(id, sourceName, inner)).toBe(true);
  }, 180_000);

  test("totality trust resolves var-head calls and refuses an unchecked edge beside a decreasing one", () => {
    const id = "inference-test:countdown";
    const sourceName = "alias:countdown";
    const guarded = (recursion: unknown) => ({ if: [{ call: ["and", { call: ["gt", { var: "n" }, 0] }, { call: ["lte", { var: "n" }, 1000] }] }, recursion, 0] });
    const decreasing = { call: ["sub", { var: "n" }, 1] };

    // A recognised decreasing call must not hide a non-decreasing var-head call.
    const mixedDynamic = guarded({
      call: ["add", { call: [sourceName, decreasing] }, { call: [{ var: sourceName }, { var: "n" }] }],
    });
    expect(inferredGroupTotal(id, sourceName, mixedDynamic)).toBe(false);
    expect(inferredGroupTrustTag(id, sourceName, mixedDynamic)).toBe("Advisory");

    // Nor a value reference: the function handed on can be called with anything.
    const mixedReference = guarded({
      call: ["add", { call: [sourceName, decreasing] }, { call: ["apply", { var: sourceName }, { var: "n" }] }],
    });
    expect(inferredGroupTotal(id, sourceName, mixedReference)).toBe(false);
    expect(inferredGroupTrustTag(id, sourceName, mixedReference)).toBe("Advisory");

    // A var-head call is the same recursion as the named call: the surface
    // dependency walk strips `$dyn:`, so the totality projection must too.
    expect(inferredGroupTotal(id, sourceName, guarded({ call: [{ var: sourceName }, decreasing] }))).toBe(true);
  }, 180_000);

  test("the TS boundary contains no retired kind, trust, or provenance planners", async () => {
    const source = await Bun.file(new URL("./signature-inference.ts", import.meta.url)).text();
    expect(source).not.toMatch(/function\s+kindForArity\b/);
    expect(source).not.toMatch(/function\s+inferredDeclaration\b/);
    expect(source).not.toMatch(/function\s+authoredSignatureTrust\b/);
    expect(source).not.toMatch(/function\s+hostSchemeVariables\b/);
    expect(source).not.toMatch(/function\s+(?:fallback|canonical)Resolutions\b/);
    expect(source).not.toContain('?? "Advisory"');
  });
});

describe("captured system universal inference fences", () => {
  const nominal = (publicName: string, identity?: string): TypeScheme => ({
    quantified: [],
    body: ref(publicName),
    ...(identity === undefined ? {} : {
      nominals: [{ path: [], identity, publicName }],
    }),
  });
  const universal = nominal("Anything", '["system","Anything"]');
  const number = nominal("Number", '["system","Number"]');
  const functionParams = [positionalField("_0", 0, numberType)];
  const callable = monomorphicScheme(functionParams, numberType);
  const consumer = (expected: TypeScheme) => {
    const params = [positionalField("_0", 0, expected.body)];
    const scheme: TypeScheme = {
      ...monomorphicScheme(params, expected.body),
      quantified: expected.quantified,
      nominals: (expected.nominals ?? []).flatMap(row => [
        { ...row, path: ["$arrow", "params", "0", "type", ...row.path] },
        { ...row, path: ["$arrow", "returns", ...row.path] },
      ]),
    };
    return { params, returns: expected.body, scheme, targetId: "universal:accept" };
  };
  const compare = (actual: TypeScheme, expected: TypeScheme) => {
    const accepted = consumer(expected);
    return inferJsonLogicType({ call: ["accept", { var: "input" }] }, {
      bindings: { input: actual },
      resolveFunction: name => name === "accept" ? accepted : undefined,
    });
  };

  test("keeps arrow and named equations against the captured universal owner indeterminate", () => {
    for (const [actual, expected] of [
      [callable, universal], [universal, callable],
      [number, universal], [universal, number],
    ] as const) {
      const before = structuredClone([actual, expected]);
      const result = compare(actual, expected);
      expect(result.outcome.$tag).toBe("AnnotationRequired");
      if (result.outcome.$tag !== "Solved") {
        expect(result.outcome.diagnostics.map(({ code }) => code))
          .toEqual(["inference.set-former-indeterminate"]);
      }
      expect(result.type).toBeUndefined();
      expect(result.scheme).toBeUndefined();
      expect([actual, expected]).toEqual(before);
    }
  });

  test("retains equal nominal schemes and their original owner evidence", () => {
    for (const expected of [universal, nominal("Anything", '["private","Anything"]')]) {
      const before = structuredClone(expected);
      const result = compare(expected, expected);
      expect(result.outcome.$tag).toBe("Solved");
      expect(result.type).toEqual(expected.body);
      expect(result.scheme?.nominals).toEqual(expected.nominals);
      expect(expected).toEqual(before);
    }
  });

  test("does not grant the universal fence to private, missing or unowned spellings", () => {
    for (const expected of [
      nominal("Anything", '["private","Anything"]'),
      nominal("Anything", '["missing","Anything"]'),
      nominal("Anything"),
    ]) {
      for (const [actual, code] of [
        [callable, "inference.constructor-mismatch"],
        [number, "inference.nominal-mismatch"],
      ] as const) {
        const result = compare(actual, expected);
        expect(result.outcome.$tag).toBe("Invalid");
        if (result.outcome.$tag !== "Solved") {
          expect(result.outcome.diagnostics.map(({ code }) => code)).toEqual([code]);
        }
        expect(result.type).toBeUndefined();
      }
    }
    const binder = { id: "duplicate", sourceName: "unused", kind: { $tag: "KType" as const } };
    const malformed = { ...universal, quantified: [binder, binder] };
    const rejected = compare(malformed, universal);
    expect(rejected.outcome.$tag).toBe("Invalid");
    expect(rejected.type).toBeUndefined();
  });

  test("a universal annotation fence does not hide a definite sibling mismatch", () => {
    for (const first of [true, false]) {
      const actual: TypeScheme = {
        quantified: [],
        body: { $tuple: first ? [callable.body, stringType] : [stringType, callable.body] },
      };
      const expected: TypeScheme = {
        quantified: [],
        body: { $tuple: first ? [universal.body, numberType] : [numberType, universal.body] },
        nominals: [{ ...universal.nominals![0]!, path: ["$tuple", first ? "0" : "1"] }],
      };
      for (const result of [compare(actual, expected), compare(expected, actual)]) {
        expect(result.outcome.$tag).toBe("Invalid");
        if (result.outcome.$tag !== "Solved") {
          expect(result.outcome.diagnostics.map(({ code }) => code))
            .toEqual(["inference.nominal-mismatch"]);
        }
        expect(result.type).toBeUndefined();
      }
    }
  });

  test("a captured function reference remains a value with an annotation fence", () => {
    const accepted = consumer(universal);
    const options: JsonLogicInferenceOptions = {
      resolveFunction: name => name === "accept" ? accepted : name === "predicate" ? {
        params: functionParams, returns: numberType, scheme: callable,
        targetId: "predicate", signatureOutcome: { $tag: "Solved" },
      } : undefined,
    };
    const reference = { $ref: "predicate" };
    const before = structuredClone(reference);
    const original = inferJsonLogicType(reference, options);
    expect(original.outcome.$tag).toBe("Solved");
    expect(original.type).toHaveProperty("$arrow");
    const result = inferJsonLogicType({ call: ["accept", reference] }, options);
    expect(result.outcome.$tag).toBe("AnnotationRequired");
    if (result.outcome.$tag !== "Solved") {
      expect(result.outcome.diagnostics.map(({ code }) => code))
        .toEqual(["inference.set-former-indeterminate"]);
    }
    expect(result.type).toBeUndefined();
    expect(reference).toEqual(before);
    const missing = inferJsonLogicType({ call: ["accept", { $ref: "missing" }] }, options);
    expect(missing.outcome.$tag).toBe("AnnotationRequired");
    if (missing.outcome.$tag !== "Solved") {
      expect(missing.outcome.diagnostics.map(({ code }) => code))
        .toContain("inference.unknown-name");
    }
    expect(missing.type).toBeUndefined();
  });
});
