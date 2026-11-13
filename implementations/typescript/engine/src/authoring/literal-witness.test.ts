// Shipped format refinements use the standard engine Pattern registration.
import "../format-presets";
import { beforeAll, describe, expect, test } from "bun:test";
import { contains } from "../set-algebra";
import { typeToSetExpr } from "../fenel-check";
import { validateValue, type ValidationAdmissionObservation } from "../validate";
import { getSystemRegistry } from "../system-registry";
import { moduleSourceCoordinate } from "../json-logic";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "./signature-authoring";
import { loadFenelModule } from "../fenel-module";
import { createRegistry } from "../registry";
import { stdModule } from "../modules/std";
import { Just, List, Nothing } from "../type-foundation";
import type { FieldDef, FenelType, TypeScheme } from "../types";
import {
  exprNodeToLogic,
  inferAuthoringExpression,
  peelToArrowType,
  type AuthoringFunctionEntry,
  type AuthoringInferenceContext,
  type ExprNode,
} from "./expression-authoring";
import {
  inferAuthoringExpressionWithLiteralWitnesses,
  prepareAuthoringLiteralWitnesses,
  type AuthoringLiteralMembership,
} from "./literal-witness";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./environment";
import { projectAuthoringScheme } from "./scheme-projection";
import { checkAuthoringSchemeStructure } from "../signature-inference";
import { engineRequire } from "../engine-require";
import { expectedTypeConsumer, inferCallScheme } from "./call-scheme";
import { eagerLiteralWitnessSource, loadLiteralWitnessOracle } from "./test-support/literal-guidance-oracle";

const ref = (name: string): FenelType => ({ $ref: name });
const lit = (value: unknown): ExprNode => ({ kind: "literal", value });
const call = (fnId: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", fnId, args });
let fieldOrdinal = 0;
const field = (name: string, type: FenelType): FieldDef => ({
  name, type, label: Nothing, ui: Nothing, meta: {},
  key: { $tag: "NamedField", ref: { $ref: `11111111-1111-4111-8111-${String(++fieldOrdinal).padStart(12, "0")}` } },
});
const color: FenelType = { $record: { fields: ["r", "g", "b", "a"].map((name) => field(name, ref("Nat"))) } };
const image: FenelType = { $record: { fields: [
  field("width", ref("Nat")), field("height", ref("Nat")), field("pixels", List(color)),
] } };
const imageScheme: TypeScheme = { quantified: [], body: ref("Image") };
const emptyImage = { width: 0, height: 0, pixels: [] };
const boundedRadius: FenelType = { $refined: { base: ref("Number"), set: {
  $tag: "SeInterval", interval: {
    lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }),
  },
} } };

function fn(id: string, types: FenelType[], returns: FenelType, quantified: TypeScheme["quantified"] = []): AuthoringFunctionEntry {
  const params: FieldDef[] = types.map((type, index) => ({
    name: `_${index}`, type, key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {},
  }));
  return { id, params, returns, scheme: { quantified, body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" } };
}
const entries = new Map([
  fn("sample", [ref("Nat")], ref("Image")),
  fn("posterize", [ref("Image"), ref("Nat")], ref("Image")),
  fn("labelImage", [ref("Image"), ref("String")], ref("Image")),
  fn("bounded", [boundedRadius], ref("Number")),
  fn("boundedPair", [boundedRadius, ref("String")], ref("Number")),
  fn("id", [{ $var: "a" }], { $var: "a" }, [{ id: "id:a", sourceName: "a", kind: { $tag: "KType" } }]),
].map((entry) => [entry.id, entry]));

const membership: AuthoringLiteralMembership = (value, expected) => {
  if ("$ref" in expected.body && expected.body.$ref === "Image") {
    const checked = validateValue(image, value, null, {
      functions: {}, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false },
    });
    return { $tag: "Just", _0: checked.valid };
  }
  return contains(typeToSetExpr(expected.body), value, null);
};
const context: AuthoringInferenceContext = {
  getFunctionEntry: (id) => entries.get(id),
  resolveNamedType: (name) => name === "Image" ? image : name === "RgbaPixel" ? color : undefined,
  literalMembership: membership,
};

beforeAll(() => { contains(typeToSetExpr(ref("Nat")), 0, null); }, 180_000);

describe("source annotations retain scoped literal membership evidence", () => {
  const annotated = (value: unknown, type: FenelType): ExprNode => lit({ __ann: { expr: lit(value), type } });

  test("an explicitly typed empty list receives its declaration only after positive membership", () => {
    const type = List(ref("Number"));
    const node = annotated([], type);
    const original = structuredClone(node);
    const seen: TypeScheme[] = [];
    const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership: Object.assign((_value: unknown, expected: TypeScheme) => {
      seen.push(expected); return Just(true);
    }, { resolveAnnotationScheme: (body: FenelType) => ({ quantified: [], body }) }) });
    expect(seen).toEqual([{ quantified: [], body: type }]);
    expect(Object.values(checked.bindings)).toEqual([{ quantified: [], body: type }]);
    expect(((checked.node as { kind: "literal"; value: { __ann: { expr: ExprNode } } }).value.__ann.expr).kind).toBe("param");
    expect(node).toEqual(original);
  });

  test("annotation payload bindings cannot replace the captured lexical environment", () => {
    const type = ref("Number");
    const scoped = (identity: string): TypeScheme => ({ quantified: [], body: ref("Item"), nominals: [
      { path: [], identity, publicName: "Item" },
    ] });
    const ownerA = '["captured_a","Item"]';
    const ownerB = '["captured_b","Item"]';
    const base = fn("useScopedItem", [ref("Item")], type);
    const entry: AuthoringFunctionEntry = { ...base, scheme: { ...base.scheme!, nominals: [
      { path: ["$arrow", "params", "0", "type"], identity: ownerA, publicName: "Item" },
    ] } };
    const cases: [TypeScheme, TypeScheme, boolean][] = [
      [scoped(ownerA), scoped(ownerB), true], [scoped(ownerB), scoped(ownerA), false],
    ];
    for (const [captured, payload, admitted] of cases) {
      const bindings = { captured };
      const child = lit({ __do: [call(entry.id, { kind: "param", name: "captured" }), lit(5)] });
      const node = lit({ __ann: { expr: child, type }, bindings: { captured: payload } });
      const unchanged = structuredClone(node);
      const seen: TypeScheme[] = [];
      const literalMembership = Object.assign((_value: unknown, expected: TypeScheme) => {
        seen.push(expected); return Just(true);
      }, { resolveAnnotationScheme: (body: FenelType) => ({ quantified: [], body }) });
      const context: AuthoringInferenceContext = { bindings,
        getFunctionEntry: (id) => id === entry.id ? entry : undefined };
      expect(inferAuthoringExpression(child, context).outcome.$tag === "Solved").toBe(admitted);
      const checked = prepareAuthoringLiteralWitnesses(node, context, { literalMembership });
      expect(checked.literalChecks).toEqual(admitted ? [
        { verdict: Just(true), path: "$expression.__ann.expr.__do[1]" },
      ] : []);
      expect(seen).toEqual(admitted ? [{ quantified: [], body: type }] : []);
      expect(checked.bindings.captured).toBe(captured);
      expect(Object.values(checked.bindings)).toEqual(admitted ? [captured, { quantified: [], body: type }] : [captured]);
      if (!admitted) expect(checked.node).toEqual(node);
      expect(node).toEqual(unchanged);
      expect(bindings).toEqual({ captured });
    }
  });

  test("malformed annotation payload bindings remain inert data", () => {
    const type = List(ref("Number"));
    const literalMembership = Object.assign(() => Just(true), {
      resolveAnnotationScheme: (body: FenelType) => ({ quantified: [], body }),
    });
    for (const bindings of [17, { malformed: 17 }]) {
      const node = lit({ __ann: { expr: lit([]), type }, bindings });
      const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership });
      expect(checked.literalChecks).toEqual([
        { verdict: Just(true), path: "$expression.__ann.expr" },
      ]);
      expect(Object.values(checked.bindings)).toEqual([{ quantified: [], body: type }]);
    }
  });

  test("unknown, refused and thrown annotation membership cannot supply a fact", () => {
    const node = annotated([], List(ref("Number")));
    for (const verdict of [() => Nothing, () => Just(false), () => { throw new Error("unavailable"); }]) {
      const literalMembership = Object.assign(verdict, { resolveAnnotationScheme: (body: FenelType) => ({ quantified: [], body }) });
      const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership });
      expect(Object.keys(checked.bindings)).toEqual([]);
      expect(checked.node).toEqual(node);
    }
  });

  test("unbound annotations and computed children do not gain a literal fact", () => {
    let calls = 0;
    const literalMembership = Object.assign(() => { calls++; return Just(true); }, {
      resolveAnnotationScheme: (body: FenelType) => ({ quantified: [], body }),
    });
    const unbound = prepareAuthoringLiteralWitnesses(annotated(7, { $var: "missing" }), {}, { literalMembership });
    expect(Object.keys(unbound.bindings)).toEqual([]);
    const computed = prepareAuthoringLiteralWitnesses(lit({ __ann: {
      expr: call("unknownComputed", lit(7)), type: ref("String"),
    } }), {}, { literalMembership });
    expect(Object.keys(computed.bindings)).toEqual([]);
    expect(calls).toBe(0);
  });

  test("missing, unreadable and universal annotation owners cannot certify raw spellings", () => {
    const node = annotated(5, { $refined: { base: ref("Number"), set: { $tag: "SeEnum", values: [5] } } });
    let calls = 0;
    const accept = () => { calls++; return Just(true); };
    for (const literalMembership of [accept,
      Object.assign(() => accept(), { resolveAnnotationScheme: () => undefined }),
      Object.assign(() => accept(), { resolveAnnotationScheme: () => { throw new Error("unreadable owner"); } }),
      Object.assign(() => accept(), { resolveAnnotationScheme: (body: FenelType) => ({
        quantified: [{ id: "owner:a", sourceName: "a", kind: { $tag: "KType" as const } }], body,
      }) }),
    ]) {
      const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership });
      expect(Object.keys(checked.bindings)).toEqual([]);
      expect(checked.node).toEqual(node);
    }
    expect(calls).toBe(0);
  });

  test("a nested private Number annotation cannot gain a fact from a spelling-based membership acceptance", () => {
    const type: FenelType = { $refined: { base: ref("Number"), set: { $tag: "SeEnum", values: [5] } } };
    const node = lit({ __where: { bindings: [], body: annotated(5, type) } });
    const declared: TypeScheme = { quantified: [], body: type,
      nominals: [{ path: ["$refined", "base"], identity: '["private_numbers","Number"]', publicName: "Number" }] };
    const seen: TypeScheme[] = [];
    const literalMembership = Object.assign((_value: unknown, expected: TypeScheme) => { seen.push(expected); return Just(true); }, {
      resolveAnnotationScheme: () => declared,
    });
    const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership });
    expect(seen).toEqual([]);
    expect(Object.keys(checked.bindings)).toEqual([]);
    expect(checked.node).toEqual(node);
  });

  test("a later annotation resolver failure retains an earlier definite refusal", () => {
    const refused = annotated(5, ref("Number"));
    const unavailable = annotated([], List(ref("Number")));
    const node = lit({ __do: [refused, unavailable] });
    const literalMembership = Object.assign(() => Just(false), {
      resolveAnnotationScheme: (body: FenelType): TypeScheme => {
        if ("$opaque" in body) throw new Error("later owner unavailable");
        return { quantified: [], body };
      },
    });
    const checked = prepareAuthoringLiteralWitnesses(node, {}, { literalMembership });
    expect(checked.literalChecks.some(check => check.verdict.$tag === "Just" && !check.verdict._0)).toBe(true);
    expect(Object.keys(checked.bindings)).toEqual([]);
    expect(checked.node).toEqual(node);
  });
});

describe("checking-only structural data projection", () => {
  const expected: TypeScheme = { quantified: [], body: {
    $record: { fields: [field("amount", boundedRadius), field("label", ref("String"))] },
  } };
  const record = (amount: unknown): ExprNode => lit({ __record: { fields: [
    { name: "amount", value: lit(amount) }, { name: "label", value: lit("Bounded amount") },
  ] } });

  test("bounded record data receives a fact only after its actual whole-type membership succeeds", () => {
    for (const amount of [12, 13]) {
      const node = record(amount);
      const original = structuredClone(node);
      const prepared = prepareAuthoringLiteralWitnesses(node, context, {
        expectedScheme: expected,
        expressionData: () => ({ $tag: "Concrete", value: { amount, label: "Bounded amount" } }),
      });
      expect(prepared.literalChecks).toEqual([{ verdict: Just(amount === 12), path: "$expression" }]);
      expect(Object.keys(prepared.bindings).length).toBe(amount === 12 ? 1 : 0);
      expect(node).toEqual(original);
      if (amount === 12) expect(prepared.node.kind).toBe("param");
      else expect(prepared.node).toEqual(node);
    }
  });

  test("residual, unknown, thrown and unsafe projections supply no typing fact", () => {
    const node = record(12);
    for (const expressionData of [
      () => ({ $tag: "Residual" as const, expr: node }),
      () => { throw new Error("Projection unavailable"); },
      () => ({ $tag: "Concrete" as const, value: { $ref: "hidden-function" } }),
      () => ({ $tag: "Concrete" as const, value: { __fenelClosure: true, amount: 12 } }),
    ]) {
      let checks = 0;
      const prepared = prepareAuthoringLiteralWitnesses(node, context, {
        expectedScheme: expected, expressionData,
        literalMembership: () => { checks++; return Just(true); },
      });
      expect(Object.keys(prepared.bindings)).toEqual([]);
      expect(checks).toBe(0);
    }
    const unknown = prepareAuthoringLiteralWitnesses(node, context, {
      expectedScheme: expected,
      expressionData: () => ({ $tag: "Concrete", value: { amount: 12, label: "Bounded amount" } }),
      literalMembership: () => Nothing,
    });
    expect(unknown.literalChecks).toEqual([{ verdict: Nothing, path: "$expression" }]);
    expect(Object.keys(unknown.bindings)).toEqual([]);
  });

  test("call projection stays residual and open/function/reference subjects receive no projected fact", () => {
    let projections = 0;
    let checks = 0;
    const options = {
      expectedScheme: expected,
      expressionData: (node: ExprNode) => { projections++; return { $tag: "Residual" as const, expr: node }; },
      literalMembership: () => { checks++; return Just(true); },
    };
    prepareAuthoringLiteralWitnesses(call("effectfulUnknownFunction"), context, options);
    expect(projections).toBe(1);
    expect(checks).toBe(0);
    for (const node of [{ kind: "ref", savedExprId: "unavailable" }, { kind: "param", name: "argument" }] as const) {
      prepareAuthoringLiteralWitnesses(node, context, options);
    }
    for (const body of [{ $var: "a" }, { $arrow: { params: [], returns: ref("Number") } }] as FenelType[]) {
      prepareAuthoringLiteralWitnesses(record(12), context, { ...options, expectedScheme: { quantified: [], body } });
    }
    expect(projections).toBe(1);
    expect(checks).toBe(0);
  });

  test("a concrete projection cannot invoke a data getter during checking", () => {
    let reads = 0;
    let checks = 0;
    const value = Object.defineProperty({}, "amount", { enumerable: true, get: () => { reads++; return 12; } });
    const prepared = prepareAuthoringLiteralWitnesses(record(12), context, {
      expectedScheme: expected, expressionData: () => ({ $tag: "Concrete", value }),
      literalMembership: () => { checks++; return Just(true); },
    });
    expect(Object.keys(prepared.bindings)).toEqual([]);
    expect(reads).toBe(0);
    expect(checks).toBe(0);
  });
});

describe("named constructor contextual literal witnesses", () => {
  let environment: ReturnType<typeof createAuthoringEnvironment>;
  let namedContext: AuthoringInferenceContext;
  let rules: AuthoringFunctionEntry;
  let plan: AuthoringFunctionEntry;
  const named = (tag: string, fields: Array<[string, ExprNode]>): ExprNode => lit({
    __construct: { tag, fields: fields.map(([name, value]) => ({ name, value })) },
  });

  beforeAll(() => {
    const source = loadFenelModule(`module NumericWitnessProbe where
PreparationMinutes = Number | value ∈ [0..240]
Rules = Rules label: String maximum: PreparationMinutes
Plan = Plan rules: Rules finish: Nat
`, "NumericWitnessProbe");
    const other = loadFenelModule(`module OtherNumericWitnessProbe where
OtherPreparationMinutes = Number | value ∈ [300..500]
Rules = Rules label: String maximum: OtherPreparationMinutes
`, "OtherNumericWitnessProbe");
    const registry = createRegistry([stdModule, source, other]);
    const sections = [{
      id: "entity" as const, label: "Fixture types", description: "Checked source declarations",
      entries: ["PreparationMinutes", "OtherPreparationMinutes"].map((name) => {
        const entity = registry.getIdentifiedEntity(name);
        if (!entity?.type) throw new Error(`Missing registered numeric declaration ${name}`);
        if (entity.params?.length) throw new Error(`Numeric fixture declaration ${name} must be monomorphic`);
        return { id: entity.id, name, description: "", category: "entity" as const, entity: { ...entity, params: undefined } };
      }),
    }];
    environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(sections, {
      registry, sourceModule: "NumericWitnessProbe",
    }));
    const ruleEntry = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "NumericWitnessProbe" && entry.parentEntity === "Rules" && entry.id === "Rules");
    const planEntry = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "NumericWitnessProbe" && entry.parentEntity === "Plan" && entry.id === "Plan");
    if (ruleEntry?.kind !== "constructor" || ruleEntry.signatureOutcome?.$tag !== "Solved"
      || planEntry?.kind !== "constructor" || planEntry.signatureOutcome?.$tag !== "Solved") {
      throw new Error("Named constructor fixture has no checked declaration authority");
    }
    rules = ruleEntry;
    plan = planEntry;
    namedContext = {
      ...environment,
      literalMembership: (value, expected) => {
        const type = environment.resolveTypeRef?.(expected.body) ?? expected.body;
        return contains(typeToSetExpr(type), value, null, {}, registry.evaluateContext());
      },
    };
  }, 180_000);

  test("named fields receive their exact checked schemes regardless of source order", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target || !rules.scheme) throw new Error("Expected an exact constructor scheme");
    const node = named(target, [["maximum", lit(10)], ["label", lit("bounded")]]);
    const original = structuredClone(node);
    const seen: TypeScheme[] = [];
    const current = {
      ...namedContext,
      literalMembership: (value: unknown, expected: TypeScheme) => {
        seen.push(expected);
        return namedContext.literalMembership!(value, expected);
      },
    };
    expect(inferAuthoringExpression(node, current).outcome.$tag).toBe("Invalid");
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, current);
    expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
    const maximumIndex = rules.params.findIndex((param) => param.name === "maximum");
    const maximumScheme = projectAuthoringScheme(rules.scheme, ["$arrow", "params", String(maximumIndex), "type"]);
    expect(maximumScheme?.nominals?.length).toBeGreaterThan(0);
    expect(seen).toContainEqual(maximumScheme!);
    expect(node).toEqual(original);
    expect(exprNodeToLogic(node)).toEqual({ construct: [target, { maximum: 10, label: "bounded" }] });
  });

  test("nested named constructors admit valid numeric boundaries and keep original values", () => {
    const ruleTarget = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    const planTarget = environment.resolveConstructorTarget?.(plan.targetId ?? plan.id);
    if (!ruleTarget || !planTarget) throw new Error("Expected exact constructor targets");
    for (const maximum of [0, 10, 240]) {
      const node = named(planTarget, [["finish", lit(0)], ["rules", named(ruleTarget,
        [["maximum", lit(maximum)], ["label", lit("nested")]])]]);
      const original = structuredClone(node);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, namedContext);
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
      expect(inferred.type).toEqual(plan.returns);
      expect(node).toEqual(original);
    }
  });

  test("different owners with the same field and constructor spellings retain their own schemes", () => {
    const ownTarget = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    const other = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "OtherNumericWitnessProbe" && entry.parentEntity === "Rules" && entry.id === "Rules");
    const otherTarget = other && environment.resolveConstructorTarget?.(other.targetId ?? other.id);
    if (!ownTarget || !otherTarget) throw new Error("Expected exact owner-qualified constructor targets");
    expect(otherTarget).not.toBe(ownTarget);
    for (const [target, value, expectedTag] of [
      [ownTarget, 10, "Solved"], [otherTarget, 300, "Solved"],
      [ownTarget, 300, "Invalid"], [otherTarget, 10, "Invalid"],
    ] as const) {
      const node = named(target, [["maximum", lit(value)], ["label", lit("owner")]]);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, namedContext);
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe(expectedTag);
    }
  });

  test("definite named-field refusals survive nesting and a later membership or resolver throw", () => {
    const ruleTarget = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    const planTarget = environment.resolveConstructorTarget?.(plan.targetId ?? plan.id);
    if (!ruleTarget || !planTarget) throw new Error("Expected exact constructor targets");
    for (const maximum of [-1, 241]) {
      const node = named(planTarget, [["finish", lit(0)], ["rules", named(ruleTarget,
        [["maximum", lit(maximum)], ["label", lit("nested")]])]]);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, namedContext);
      expect(inferred.outcome.$tag).toBe("Invalid");
      if (inferred.outcome.$tag !== "Invalid") throw new Error("Expected named-field membership refusal");
      expect(inferred.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
      expect(inferred.outcome.diagnostics[0]?.path).toEqual(["$expression.__construct.fields[1].value.__construct.fields[0].value"]);
    }
    const badNat = named(planTarget, [["finish", lit(-1)], ["rules", named(ruleTarget,
      [["maximum", lit(10)], ["label", lit("nested")]])]]);
    for (const current of [
      { ...namedContext, literalMembership: (value: unknown, expected: TypeScheme) => {
        if (value === "nested") throw new Error("Unavailable later membership");
        return namedContext.literalMembership!(value, expected);
      } },
      { ...namedContext, resolveConstructorTarget: (id: string) => {
        if (id === ruleTarget) throw new Error("Unavailable later constructor lookup");
        return environment.resolveConstructorTarget!(id);
      } },
    ]) {
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(badNat, current);
      expect(inferred.outcome.$tag).toBe("Invalid");
      if (inferred.outcome.$tag !== "Invalid") throw new Error("Expected retained earlier refusal");
      expect(inferred.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
      expect(inferred.outcome.diagnostics[0]?.path).toEqual(["$expression.__construct.fields[0].value"]);
    }
  });

  test("unknown and throwing membership retain ordinary constructor inference and unchanged expressions", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target) throw new Error("Expected an exact constructor target");
    const node = named(target, [["maximum", lit(10)], ["label", lit("unknown")]]);
    const original = structuredClone(node);
    for (const literalMembership of [() => Nothing, () => { throw new Error("Unavailable membership"); }]) {
      const current = { ...namedContext, literalMembership };
      const prepared = prepareAuthoringLiteralWitnesses(node, current);
      expect(Object.keys(prepared.bindings)).toEqual([]);
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, current)).toEqual(inferAuthoringExpression(node, current));
      expect(node).toEqual(original);
    }
  });

  test("missing, fenced, non-constructor and hostile lookup results grant no named-field facts", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target) throw new Error("Expected an exact constructor target");
    const node = named(target, [["maximum", lit(10)], ["label", lit("lookup")]]);
    let reads = 0;
    const hostile = Object.defineProperty({ ...rules }, "scheme", {
      enumerable: true, get: () => { reads++; return rules.scheme; },
    });
    const lookupContexts: AuthoringInferenceContext[] = [
      { ...namedContext, resolveConstructorTarget: undefined },
      { ...namedContext, resolveConstructorTarget: () => undefined },
      { ...namedContext, resolveConstructorTarget: () => { throw new Error("Unavailable captured route"); } },
      { ...namedContext, getFunctionEntry: () => undefined },
      { ...namedContext, getFunctionEntry: () => { throw new Error("Unavailable captured declaration"); } },
      { ...namedContext, getFunctionEntry: () => ({ ...rules, kind: "function" }) },
      { ...namedContext, getFunctionEntry: () => ({ ...rules, signatureOutcome: { $tag: "AnnotationRequired", diagnostics: [] } }) },
      { ...namedContext, getFunctionEntry: () => ({ ...rules, scheme: undefined }) },
      { ...namedContext, getFunctionEntry: () => hostile },
    ];
    for (const current of lookupContexts) {
      const prepared = prepareAuthoringLiteralWitnesses(node, current);
      expect(Object.keys(prepared.bindings)).toEqual([]);
      expect(prepared.node).toEqual(node);
    }
    expect(reads).toBe(0);
  });
  test("list witnesses follow saved constructor references and ordinary nested lists without changing sources", () => {
    const ruleTarget = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    const planTarget = environment.resolveConstructorTarget?.(plan.targetId ?? plan.id);
    if (!ruleTarget || !planTarget) throw new Error("Expected exact constructor targets");
    const savedRef = (savedExprId: string): ExprNode => ({ kind: "ref", savedExprId });
    const list = (...children: ExprNode[]): ExprNode => lit({ __list: children });
    const saved = new Map<string, ExprNode>([
      ["rules", named(ruleTarget, [["maximum", lit(10)], ["label", lit("shared rules")]])],
      ["first", named(planTarget, [["finish", lit(0)], ["rules", savedRef("rules")]])],
      ["second", named(planTarget, [["finish", lit(1)], ["rules", savedRef("rules")]])],
      ["all", list(savedRef("first"), savedRef("second"))],
    ]);
    const original = structuredClone([...saved]);
    const current = { ...namedContext, resolveSavedExpr: (id: string) => saved.get(id) };
    for (const node of [savedRef("all"), list(list(savedRef("first"), savedRef("second")))]) {
      const unchanged = structuredClone(node);
      expect(inferAuthoringExpression(node, current).outcome.$tag).toBe("Invalid");
      const prepared = prepareAuthoringLiteralWitnesses(node, current);
      expect(prepared.literalChecks).toHaveLength(6);
      expect(prepared.literalChecks.every(check => check.verdict.$tag === "Just" && check.verdict._0 === true)).toBe(true);
      expect(Object.keys(prepared.bindings)).toHaveLength(6);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, current);
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
      expect(inferred.scheme?.nominals?.some(owner => owner.identity === plan.scheme?.nominals?.find(
        owner => owner.path.join("/") === "$arrow/returns")?.identity)).toBe(true);
      expect(node).toEqual(unchanged);
      expect([...saved]).toEqual(original);
    }
  });

  test("list witnesses preserve constructor ownership and recheck changed saved values", () => {
    const ownTarget = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    const other = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "OtherNumericWitnessProbe" && entry.parentEntity === "Rules" && entry.id === "Rules");
    const otherTarget = other && environment.resolveConstructorTarget?.(other.targetId ?? other.id);
    if (!ownTarget || !otherTarget) throw new Error("Expected distinct owner-qualified constructor targets");
    expect(ownTarget).not.toBe(otherTarget);
    const node: ExprNode = { kind: "ref", savedExprId: "all" };
    const saved = new Map<string, ExprNode>([["all", lit({ __list: [{ kind: "ref", savedExprId: "item" }] })]]);
    const current = { ...namedContext, resolveSavedExpr: (id: string) => saved.get(id) };
    for (const [target, maximum, expectedTag] of [
      [ownTarget, 10, "Solved"], [ownTarget, 300, "Invalid"],
      [otherTarget, 300, "Solved"], [otherTarget, 10, "Invalid"],
    ] as const) {
      saved.set("item", named(target, [["maximum", lit(maximum)], ["label", lit("owner")]]));
      const before = structuredClone([...saved]);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, current);
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe(expectedTag);
      if (inferred.outcome.$tag === "Invalid") {
        expect(inferred.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
        expect(inferred.outcome.diagnostics[0]?.path).toEqual(["$expression.__list[0].__construct.fields[0].value"]);
      }
      expect([...saved]).toEqual(before);
      expect(node).toEqual({ kind: "ref", savedExprId: "all" });
    }
  });

  test("list witnesses keep unknown membership and missing or cyclic references unproven", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target) throw new Error("Expected exact constructor target");
    const item = named(target, [["maximum", lit(10)], ["label", lit("unknown")]]);
    const node = lit({ __list: [{ kind: "ref", savedExprId: "item" }] });
    for (const literalMembership of [() => Nothing, () => { throw new Error("Unavailable membership"); }]) {
      const current = { ...namedContext, literalMembership, resolveSavedExpr: (id: string) => id === "item" ? item : undefined };
      expect(Object.keys(prepareAuthoringLiteralWitnesses(node, current).bindings)).toEqual([]);
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, current).outcome.$tag).not.toBe("Solved");
    }
    const root: ExprNode = { kind: "ref", savedExprId: "all" };
    const saved = new Map<string, ExprNode>([
      ["all", lit({ __list: [{ kind: "ref", savedExprId: "cycle" }, { kind: "ref", savedExprId: "missing" }] })],
      ["cycle", root],
    ]);
    const original = structuredClone([...saved]);
    const reads: string[] = [];
    const prepared = prepareAuthoringLiteralWitnesses(root, { ...namedContext,
      resolveSavedExpr: (id: string) => { reads.push(id); return saved.get(id); },
    });
    expect(reads).toEqual(["all", "cycle", "missing"]);
    expect(prepared.literalChecks).toEqual([]);
    expect(Object.keys(prepared.bindings)).toEqual([]);
    expect(prepared.node).toEqual(lit({ __list: [root, { kind: "ref", savedExprId: "missing" }] }));
    expect([...saved]).toEqual(original);
  });

  test("list witnesses reserve names from later saved children before allocating checking bindings", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target) throw new Error("Expected exact constructor target");
    const reserved = "\u0000authoring-literal-0";
    const node = lit({ __list: [
      named(target, [["maximum", lit(10)], ["label", lit("first")]]),
      { kind: "ref", savedExprId: "later" },
    ] });
    const unchanged = structuredClone(node);
    const prepared = prepareAuthoringLiteralWitnesses(node, { ...namedContext,
      resolveSavedExpr: (id: string) => id === "later" ? { kind: "param", name: reserved } : undefined,
    });
    expect(prepared.literalChecks).toHaveLength(2);
    expect(Object.hasOwn(prepared.bindings, reserved)).toBe(false);
    expect(Object.keys(prepared.bindings)).toEqual(["\u0000authoring-literal-1", "\u0000authoring-literal-2"]);
    expect(prepared.node).toMatchObject({ kind: "literal", value: { __list: [
      { kind: "literal" }, { kind: "param", name: reserved },
    ] } });
    expect(node).toEqual(unchanged);
  });

  test("nominal and refined owner results match the preserved eager oracle", () => {
    const target = environment.resolveConstructorTarget?.(rules.targetId ?? rules.id);
    if (!target) throw new Error("Expected exact constructor owner");
    for (const maximum of [10, 300]) {
      const node = named(target, [["maximum", lit(maximum)], ["label", lit("owner")]]);
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, namedContext))
        .toEqual(eagerWitnessOracle.inferAuthoringExpressionWithLiteralWitnesses(node, namedContext));
    }
  }, 180_000);
});

describe("list witnesses with shipped data refinements", () => {
  test("list witnesses admit actual Phone and CalendarDate values but retain their original-input refusals", () => {
    const registry = getSystemRegistry();
    const reader = authoringMembershipEvaluateContext(registry.evaluateContext());
    // This fixture checks an actual nonempty list. Its ordinary inference path
    // requires the shipped std.appendItem signature, as the constructor/list
    // fixtures above already provide through their registry-backed environment.
    // Capture the standard library through the existing authoring owner; never
    // synthesize a local list signature or change the membership decision.
    const standard = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], {
      registry: createRegistry([stdModule], { publishCatalogEntities: false }),
    }));
    const appendItem = standard.getFunctionEntry?.("std.appendItem");
    if (!appendItem?.scheme || appendItem.signatureOutcome?.$tag !== "Solved") {
      throw new Error("Missing checked shipped std.appendItem signature for list fixture");
    }
    const membership: AuthoringLiteralMembership = (value, expected) => {
      const closed = closeAuthoringMembershipType(expected, reader);
      if (!closed) return Nothing;
      const observations: Array<ReturnType<AuthoringLiteralMembership>> = [];
      const plans: ValidationAdmissionObservation[] = [];
      // The same existing original-input validation observations and source-owned
      // classification as the public literal-admission boundary. No projected
      // form output or handwritten Phone/calendar predicate supplies a fact.
      const checked = validateValue(closed, value, null, {
        registry, functions: reader, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeMembership: verdict => observations.push(verdict),
        observeAdmission: plan => plans.push(plan),
      });
      return authoringValidationMembership(checked, observations, plans);
    };
    for (const fixture of [
      { name: "Phone", valid: "+14155552671", invalid: "not a phone" },
      { name: "CalendarDate", valid: { year: 2026, month: 11, day: 3 }, invalid: { year: 2026, month: 13, day: 3 } },
    ]) {
      // Exact public Phone identity; an unscoped spelling does not select this fixture owner.
      const owner = reader._typeFamilyOwner?.(
        fixture.name === "Phone" ? "f582abdc-9959-43fd-be5a-10049b855d8c" : fixture.name,
        fixture.name === "CalendarDate" ? moduleSourceCoordinate("time") : undefined);
      if (!owner) throw new Error(`Missing actual shipped ${fixture.name} owner`);
      const resolved = reader._callSiteTyping?.resolveTypeInDeclaration?.({ $ref: owner.name }, owner.ownerIdentity);
      if (!resolved?.ok) throw new Error(`Missing captured ${fixture.name} declaration scheme`);
      const consumer = expectedTypeConsumer(resolved.type);
      const node: ExprNode = { kind: "ref", savedExprId: "all" };
      const saved = new Map<string, ExprNode>([["all", lit({ __list: [
        call(consumer.id, { kind: "ref", savedExprId: "value" }),
      ] })]]);
      const current: AuthoringInferenceContext = {
        getFunctionEntry: id => id === consumer.id ? consumer : standard.getFunctionEntry?.(id),
        resolveSavedExpr: id => saved.get(id), literalMembership: membership,
      };
      for (const [value, admitted] of [[fixture.valid, true], [fixture.invalid, false]] as const) {
        saved.set("value", lit(value));
        const original = structuredClone([...saved]);
        expect(membership(value, resolved.type), fixture.name).toEqual(Just(admitted));
        const prepared = prepareAuthoringLiteralWitnesses(node, current);
        expect(prepared.literalChecks).toEqual([
          { verdict: Just(admitted), path: "$expression.__list[0].args[0]" },
        ]);
        expect(Object.keys(prepared.bindings)).toHaveLength(admitted ? 1 : 0);
        const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, current);
        expect(inferred.outcome.$tag, `${fixture.name}: ${JSON.stringify(inferred.outcome)}`).toBe(admitted ? "Solved" : "Invalid");
        if (inferred.outcome.$tag === "Invalid") {
          expect(inferred.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
          expect(inferred.outcome.diagnostics[0]?.path).toEqual(["$expression.__list[0].args[0]"]);
        }
        expect([...saved]).toEqual(original);
        expect(node).toEqual({ kind: "ref", savedExprId: "all" });
      }
    }
  }, 180_000);
});

describe("contextual literal witnesses", () => {
  test("native numeric widgets supply proven Nat arguments without changing the original expression", () => {
    const node = call("sample", lit(0));
    const original = structuredClone(node);
    expect(inferAuthoringExpression(node, context).outcome.$tag).toBe("Invalid");
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, context);
    expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
    expect(inferred.type).toEqual(ref("Image"));
    expect(node).toEqual(original);
    expect(exprNodeToLogic(node)).toEqual({ call: ["sample", 0] });
  });

  test("raw Image canvas data and numeric widgets compose through nested calls", () => {
    for (const node of [call("posterize", lit(emptyImage), lit(4)), call("posterize", call("sample", lit(0)), lit(4))]) {
      const original = exprNodeToLogic(node);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, context);
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
      expect(inferred.type).toEqual(ref("Image"));
      expect(exprNodeToLogic(node)).toEqual(original);
    }
    const root = inferAuthoringExpressionWithLiteralWitnesses(lit(emptyImage), context, { expectedScheme: imageScheme });
    expect(root.outcome.$tag, JSON.stringify(root.outcome)).toBe("Solved");
    expect(root.type).toEqual(ref("Image"));
  });

  test("negative Nat, a scalar in an Image slot and another invalid sibling are still rejected", () => {
    for (const node of [
      call("sample", lit(-1)),
      call("posterize", lit(4), lit(4)),
      call("posterize", lit({ width: "bad", height: 0, pixels: [] }), lit(4)),
      call("labelImage", lit(emptyImage), lit(8)),
    ]) {
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, context).outcome.$tag).toBe("Invalid");
    }
  });

  test("definite contextual refinement refusals survive broad literal inference at root and nested calls", () => {
    for (const node of [call("bounded", lit(13)), call("id", call("bounded", lit(13)))]) {
      const original = structuredClone(node);
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, context);
      expect(inferred.outcome.$tag).toBe("Invalid");
      if (inferred.outcome.$tag !== "Invalid") throw new Error("expected membership refusal");
      expect(inferred.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
      expect(inferred.outcome.diagnostics[0]?.path?.[0]).toContain("args[0]");
      expect(inferred.outcome.diagnostics[0]?.functionId).toBe("<authoring-expression>");
      expect(inferred.type).toBeUndefined();
      expect(node).toEqual(original);
    }
    expect(inferAuthoringExpressionWithLiteralWitnesses(lit(13), context, {
      expectedScheme: { quantified: [], body: boundedRadius },
    }).outcome.$tag).toBe("Invalid");
    for (const value of [2, 8, 12]) {
      expect(inferAuthoringExpressionWithLiteralWitnesses(call("bounded", lit(value)), context).outcome.$tag).toBe("Solved");
    }
  });

  test("unknown membership retains the original inference outcome and a later throw cannot erase a refusal", () => {
    const node = call("bounded", lit(13));
    const unknown = { ...context, literalMembership: () => Nothing };
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, unknown)).toEqual(inferAuthoringExpression(node, unknown));
    const result = inferAuthoringExpressionWithLiteralWitnesses(call("boundedPair", lit(13), lit("ok")), {
      ...context, literalMembership: (value, expected) => {
        if (value === "ok") throw new Error("unavailable sibling membership");
        return membership(value, expected);
      },
    });
    expect(result.outcome.$tag).toBe("Invalid");
    if (result.outcome.$tag !== "Invalid") throw new Error("expected retained membership refusal");
    expect(result.outcome.diagnostics[0]?.code).toBe("authoring.literal-membership");
    expect(result.outcome.diagnostics[0]?.path).toEqual(["$expression.args[0]"]);
  });

  test("malformed plain Tri carriers never turn truthiness into a membership refusal or typing fact", () => {
    const malformed: unknown[] = [null, undefined, false, 0, {}, { $tag: "Unknown" }, { $tag: "Just" },
      ...[undefined, null, 0, "", "false", 1, [], {}, { $tag: "False" }].map(value => ({ $tag: "Just", _0: value }))];
    for (const verdict of malformed) {
      const current = { ...context, literalMembership: () => verdict as ReturnType<AuthoringLiteralMembership> };
      for (const node of [lit(13), call("bounded", lit(13))]) {
        const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, current, {
          expectedScheme: { quantified: [], body: boundedRadius },
        });
        expect(inferred).toEqual(inferAuthoringExpression(node, current));
        expect(inferred.outcome.diagnostics?.some(row => row.code === "authoring.literal-membership")).not.toBe(true);
      }
    }
  });

  test("membership verdict getters and cycles are ignored without inspecting their payloads", () => {
    let reads = 0;
    const getter = Object.defineProperty({ $tag: "Just" }, "_0", {
      enumerable: true, get: () => { reads++; return false; },
    });
    const tagGetter = Object.defineProperty({ _0: false }, "$tag", {
      enumerable: true, get: () => { reads++; return "Just"; },
    });
    const cyclic: { $tag: string; _0?: unknown } = { $tag: "Just" };
    cyclic._0 = cyclic;
    const node = call("bounded", lit(13));
    for (const verdict of [getter, tagGetter, cyclic]) {
      const current = { ...context, literalMembership: () => verdict as ReturnType<AuthoringLiteralMembership> };
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, current)).toEqual(inferAuthoringExpression(node, current));
    }
    expect(reads).toBe(0);
  });

  test("saved literals are checked under the current membership authority without retaining a previous verdict", () => {
    const node = call("bounded", { kind: "ref", savedExprId: "radius" });
    const current = { ...context, resolveSavedExpr: () => lit(13) };
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, { ...current, literalMembership: () => Just(true) }).outcome.$tag).toBe("Solved");
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, current).outcome.$tag).toBe("Invalid");
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, { ...current, literalMembership: () => Nothing }))
      .toEqual(inferAuthoringExpression(node, { ...current, literalMembership: () => Nothing }));
  });

  test("a closed expected result specializes id and nested id before witnessing its literal argument", () => {
    for (const node of [call("id", lit(emptyImage)), call("id", call("id", lit(emptyImage))),
      call("posterize", call("id", lit(emptyImage)), lit(4))]) {
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, context, { expectedScheme: imageScheme });
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
      expect(inferred.type).toEqual(ref("Image"));
    }
  });

  test("result-bearing structural children can use the same closed expectation", () => {
    for (const node of [lit({ __where: { body: call("id", lit(emptyImage)), bindings: [] } }),
      lit({ __do: [call("sample", lit(0)), call("id", lit(emptyImage))] })]) {
      const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, context, { expectedScheme: imageScheme });
      expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
      expect(inferred.type).toEqual(ref("Image"));
    }
    const lambda = lit({ __lambda: { params: [], arrayParams: true, body: call("id", lit(emptyImage)) } });
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(lambda, context, {
      expectedScheme: { quantified: [], body: { $arrow: { params: [], returns: ref("Image") } } },
    });
    expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).toBe("Solved");
    expect(inferred.type).toEqual({ $arrow: { params: [], returns: ref("Image") } });
  });

  test("unresolved generic slots, unknown decisions and throwing membership never invent type facts", () => {
    let genericChecks = 0;
    const generic = prepareAuthoringLiteralWitnesses(call("id", lit(emptyImage)), {
      ...context, literalMembership: () => { genericChecks++; return { $tag: "Just", _0: true }; },
    });
    expect(genericChecks).toBe(0);
    expect(Object.keys(generic.bindings)).toEqual([]);
    for (const literalMembership of [() => ({ $tag: "Nothing" } as const), () => { throw new Error("undecided"); }]) {
      expect(inferAuthoringExpressionWithLiteralWitnesses(call("sample", lit(0)), { ...context, literalMembership }).outcome.$tag)
        .toBe("Invalid");
    }
  });

  test("references, callables and executable literal envelopes never receive whole-value witnesses", () => {
    let checks = 0;
    for (const value of [{ $ref: "sample" }, { call: ["sample", 0] }, { hiddenNative: [] }, { __lambda: { params: [], body: lit(0) } },
      { __fenelClosure: true, body: { call: ["sample", 0] } }]) {
      prepareAuthoringLiteralWitnesses(lit(value), context, {
        expectedScheme: imageScheme,
        literalMembership: () => { checks++; return { $tag: "Just", _0: true }; },
      });
    }
    expect(checks).toBe(0);
    const arrow: TypeScheme = { quantified: [], body: { $arrow: { params: [], returns: ref("Image") } } };
    prepareAuthoringLiteralWitnesses(lit("sample"), context, {
      expectedScheme: arrow,
      literalMembership: () => { checks++; return { $tag: "Just", _0: true }; },
    });
    expect(checks).toBe(0);
    prepareAuthoringLiteralWitnesses(lit("sample"), {
      ...context, resolveNamedType: (name) => name === "Callback" ? arrow.body : undefined,
    }, {
      expectedScheme: { quantified: [], body: ref("Callback") },
      literalMembership: () => { checks++; return { $tag: "Just", _0: true }; },
    });
    expect(checks).toBe(0);
  });

  test("a saved-reference shaped data record does not resolve an expression", () => {
    let reads = 0;
    prepareAuthoringLiteralWitnesses(lit({ kind: "ref", savedExprId: "plain-data" }), {
      ...context, resolveSavedExpr: () => { reads++; return lit(0); },
    }, { expectedScheme: imageScheme });
    expect(reads).toBe(0);
  });

  test("fresh checker bindings cannot capture an existing binding or saved expression name", () => {
    const existing = "\u0000authoring-literal-0";
    const originalBindings = { [existing]: { quantified: [], body: ref("String") } };
    const node = call("labelImage", lit(emptyImage), { kind: "ref", savedExprId: "saved" });
    const prepared = prepareAuthoringLiteralWitnesses(node, {
      ...context, bindings: originalBindings,
      resolveSavedExpr: () => ({ kind: "param", name: existing }),
    });
    expect(prepared.bindings[existing]).toBe(originalBindings[existing]);
    expect(Object.keys(originalBindings)).toEqual([existing]);
    expect(Object.keys(prepared.bindings)).toContain("\u0000authoring-literal-1");
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, {
      ...context, bindings: originalBindings, resolveSavedExpr: () => ({ kind: "param", name: existing }),
    }).outcome.$tag).toBe("Solved");
  });

  test("constructor record metadata remains in emitted data despite the validator's field projection", () => {
    const value = { ...emptyImage, $tag: "Image", extra: "preserved" };
    const node = call("posterize", lit(value), lit(4));
    expect(inferAuthoringExpressionWithLiteralWitnesses(node, context).outcome.$tag).toBe("Solved");
    expect(exprNodeToLogic(node)).toEqual({ call: ["posterize", value, 4] });
    expect(value.extra).toBe("preserved");
    expect(value.$tag).toBe("Image");
  });

  test("hostile data is left to the ordinary boundary without reading getters", () => {
    let reads = 0;
    const value = Object.defineProperty({}, "pixels", { enumerable: true, get: () => { reads++; return []; } });
    const result = inferAuthoringExpressionWithLiteralWitnesses(call("posterize", lit(value), lit(4)), context);
    expect(result.outcome.$tag).toBe("Invalid");
    expect(reads).toBe(0);
  });

  test("missing signature authority and hostile resolver entries cannot grant literal facts", () => {
    const uncertified = { ...entries.get("sample")!, signatureOutcome: undefined };
    expect(Object.keys(prepareAuthoringLiteralWitnesses(call("sample", lit(0)), {
      ...context, getFunctionEntry: () => uncertified,
    }).bindings)).toEqual([]);
    let reads = 0;
    const hostile = Object.defineProperty({ ...entries.get("sample")! }, "scheme", {
      enumerable: true, get: () => { reads++; return entries.get("sample")!.scheme; },
    });
    expect(inferAuthoringExpressionWithLiteralWitnesses(call("sample", lit(0)), {
      ...context, getFunctionEntry: () => hostile,
    }).outcome.$tag).toBe("Invalid");
    expect(reads).toBe(0);
  });
});

const eagerWitnessOracle = loadLiteralWitnessOracle(eagerLiteralWitnessSource(), {
  checkAuthoringSchemeStructure, engineRequire, inferAuthoringExpression, peelToArrowType,
  projectAuthoringScheme, expectedTypeConsumer, inferCallScheme,
});

describe("demanded argument guidance canonical parity", () => {
  const mixed = fn("mixedWitness", [ref("Nat"), { $var: "a" }], { $var: "a" }, [
    { id: "mixedWitness:a", sourceName: "a", kind: { $tag: "KType" } },
  ]);
  const captured = { ...context, getFunctionEntry: (id: string) => id === mixed.id ? mixed : entries.get(id) };

  test("the original oracle agrees on closed, generic, mixed, partial and nested calls", () => {
    const cases: Array<{ node: ExprNode; expectedScheme?: TypeScheme }> = [
      { node: call("sample", lit(0)) },
      { node: call("posterize") },
      { node: call("posterize", lit(emptyImage), lit(4)) },
      { node: call("id", lit(emptyImage)) },
      { node: call("id", lit(emptyImage)), expectedScheme: imageScheme },
      { node: call("id", call("id", lit(emptyImage))), expectedScheme: imageScheme },
      { node: call(mixed.id, lit(0), lit("mixed")) },
      { node: call("posterize", lit(emptyImage)) },
      { node: call("posterize", call("sample", lit(0)), lit(4)) },
      { node: call("bounded", lit(8)) },
      { node: call("boundedPair", lit(8), lit("refined")) },
      { node: call("id", call("bounded", lit(13))) },
    ];
    for (const { node, expectedScheme } of cases) {
      const before = structuredClone(node);
      const options = expectedScheme === undefined ? {} : { expectedScheme };
      expect(prepareAuthoringLiteralWitnesses(node, captured, options))
        .toEqual(eagerWitnessOracle.prepareAuthoringLiteralWitnesses(node, captured, options));
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, captured, options))
        .toEqual(eagerWitnessOracle.inferAuthoringExpressionWithLiteralWitnesses(node, captured, options));
      expect(node).toEqual(before);
    }
  }, 180_000);

  test("saved references retain live membership, callback order and complete final inference", () => {
    const node = call("bounded", { kind: "ref", savedExprId: "radius" });
    for (const value of [8, 13]) {
      const observe = (oracle: typeof eagerWitnessOracle) => {
        const events: string[] = [];
        const current = { ...context,
          resolveSavedExpr: (id: string) => { events.push(`saved:${id}`); return lit(value); },
          getFunctionEntry: (id: string) => { events.push(`function:${id}`); return entries.get(id); },
          literalMembership: (data: unknown, expected: TypeScheme) => {
            events.push("membership"); return membership(data, expected);
          },
        };
        return { inferred: oracle.inferAuthoringExpressionWithLiteralWitnesses(node, current), events };
      };
      const demanded = observe({ prepareAuthoringLiteralWitnesses, inferAuthoringExpressionWithLiteralWitnesses });
      const eager = observe(eagerWitnessOracle);
      expect(demanded).toEqual(eager);
      expect(demanded.events).toContain("membership");
      expect(demanded.inferred.outcome.$tag).toBe(value === 8 ? "Solved" : "Invalid");
    }
  }, 180_000);

  test("negative, unknown and throwing membership keep their original full outcomes", () => {
    const node = call("bounded", lit(13));
    for (const literalMembership of [membership, () => Nothing,
      () => { throw new Error("Unavailable membership"); }]) {
      const current = { ...context, literalMembership };
      expect(inferAuthoringExpressionWithLiteralWitnesses(node, current))
        .toEqual(eagerWitnessOracle.inferAuthoringExpressionWithLiteralWitnesses(node, current));
    }
    for (const wrong of [call("sample", lit(-1)), call("bounded", lit(13)), call("labelImage", lit(emptyImage), lit(8))]) {
      expect(inferAuthoringExpressionWithLiteralWitnesses(wrong, context).outcome.$tag).toBe("Invalid");
    }
  }, 180_000);

  test("closed-slot witness preparation still reaches whole-expression inference for an invalid bound sibling", () => {
    const node = call("boundedPair", lit(8), { kind: "param", name: "label" });
    const current = { ...context, bindings: { label: { quantified: [], body: ref("Number") } } };
    const prepared = prepareAuthoringLiteralWitnesses(node, current);
    expect(prepared.literalChecks).toContainEqual({ verdict: Just(true), path: "$expression.args[0]" });
    const demanded = inferAuthoringExpressionWithLiteralWitnesses(node, current);
    expect(demanded).toEqual(eagerWitnessOracle.inferAuthoringExpressionWithLiteralWitnesses(node, current));
    expect(demanded.outcome.$tag).toBe("Invalid");
  }, 180_000);
});
