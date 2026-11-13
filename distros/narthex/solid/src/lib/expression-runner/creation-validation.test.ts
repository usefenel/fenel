import { beforeAll, describe, expect, test } from "bun:test";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment, expectedSchemeForType, inferAuthoringExpressionWithLiteralWitnesses, judgeAuthoringSchemeCompatibility, projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { Anything, Just, List, Maybe, Nothing, Vec } from "@fenel/engine/type-foundation";
import type { FenelFunction, FenelType, FieldDef, TypeScheme } from "@fenel/engine/types";
import { loadFenelModule } from "@fenel/engine";
import { createRegistry, type ModuleRegistry } from "@fenel/engine/registry";
import { createRepositoryRegistry, createRepositorySourceRegistry } from "@fenel/engine/repository-registry";
import { stdModule } from "@fenel/engine/modules/std";
import { pictureModule } from "@fenel/engine/modules/picture";
import { viewModule } from "../../../../../../implementations/typescript/engine/src/modules/view";
import SHOWCASE_SOURCE from "../../../../../../fenel/modules/publicdemo/showcase-data.fenel?raw";
import { evaluate, invokeCallable, moduleSourceCoordinate, pureEvaluateContext, type EvaluateContext } from "@fenel/engine/expressions";
import { exprNodeToLogic, type ExprNode } from "@fenel/engine/authoring/expression";
import { dispatchedDataExpressionValue } from "@fenel/engine/engine-bodies-dispatch";
import { draftSaveIssue, draftSaveValidation, functionBodySaveIssue } from "./creation-validation";
import { literalMembershipChecksFor, literalMembershipFor } from "./literal-membership";
import { sessionCatalogSections } from "./authoring-catalog";
import { validateValue } from "@fenel/engine/validation";
import { authoringMembershipEvaluateContext, closeAuthoringMembershipType } from "@fenel/engine/authoring/signature-authoring";
import { authoringExpressionLogic } from "./expression-evaluation";
import type { AuthoringSession } from "./account-authoring-session";

const number: FenelType = { $ref: "Number" };
const maybe = Maybe(number);
const valueParam: FieldDef = {
  name: "_0", key: { $tag: "PositionalField", index: 0 },
  type: number, label: Nothing, ui: Nothing, meta: {},
};
const env = createAuthoringEnvironment({
  types: [],
  functions: [{
    id: "test:wrap", targetId: "test:wrap", label: "wrap", description: "", kind: "function",
    params: [valueParam], returns: maybe,
    scheme: { quantified: [], body: { $arrow: { params: [valueParam], returns: maybe } } },
    signatureOutcome: { $tag: "Solved" },
  }],
  capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
});

describe("metadata-rich whole function save gate", () => {
  const isolated = () => createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
    catalogTypes: [], operatorCodeNameByNotation: new Map() });
  test("a source-checked authored function stays positive when value-level arrow membership abstains", () => {
    const expectedScheme: TypeScheme = { quantified: [], body: { $arrow: {
      params: [{ ...valueParam, name: "value" }], returns: number,
    } } };
    const node: ExprNode = { kind: "literal", value: { __lambda: {
      params: ["value"], body: { kind: "param", name: "value" }, arrayParams: true,
    } } };
    const before = structuredClone(node);
    const environment = isolated();
    // No evaluated callable or callback is supplied: the positive evidence is
    // the authored lambda checked in its expected parameter/result scheme.
    const feedback = draftSaveValidation(node, environment, { expectedScheme });
    expect(feedback.issue).toBeUndefined();
    expect(feedback.verdict).toEqual(Just(true));
    expect(feedback.state.$tag).toBe("HintPass");
    expect(node).toEqual(before);
  }, 120_000);
  const definition = (parameterTypes: FenelType[], returns: FenelType, inferResult: boolean, variables: string[] = []): FenelFunction => {
    const params = parameterTypes.map((type, index): FieldDef => ({ name: `input${index}`, type, label: Nothing, ui: Nothing, meta: {},
      key: { $tag: "PositionalField", index } }));
    const authored = { $tag: "Authored", source: { $tag: "HostSpec", module: "save-gate" } } as const;
    return { id: "save-gate:current", params, returns, body: "stale body",
      signatureDeclaration: { functionId: "save-gate:current", declarationName: "current", codeName: "current",
        params: params.map(() => authored), returns: inferResult ? { $tag: "Absent" } : authored,
        scheme: { quantified: variables.map(sourceName => ({ id: `save-gate:${sourceName}`, sourceName, kind: { $tag: "KType" } })),
          body: { $arrow: { params, returns } } } } };
  };

  test("uses the current body and one shared generic binder namespace", () => {
    const a: FenelType = { $var: "a" };
    expect(functionBodySaveIssue({ kind: "param", name: "input0" }, definition([a], { $ref: "String" }, true, ["a"]), isolated())).toBeUndefined();
    expect(functionBodySaveIssue({ kind: "param", name: "input1" }, definition([a, a], a, false, ["a"]), isolated())).toBeUndefined();
    expect(functionBodySaveIssue({ kind: "param", name: "input1" }, definition([a, { $var: "b" }], a, false, ["a", "b"]), isolated())).toBeDefined();
  }, 120_000);

  test("refuses root and nested empty slots before accepting function inference", () => {
    const fn = definition([], { $ref: "String" }, true);
    for (const value of [undefined, null, { unfinished: undefined }, [1, { nested: null }], { $tag: "Just", _0: undefined }]) {
      expect(functionBodySaveIssue({ kind: "literal", value }, fn, isolated())).toContain("Complete the empty value slots");
    }
    expect(functionBodySaveIssue({ kind: "literal", value: "" }, fn, isolated())).toBeUndefined();
    expect(functionBodySaveIssue({ kind: "literal", value: 0 }, fn, isolated())).toBeUndefined();
    expect(functionBodySaveIssue({ kind: "literal", value: false }, fn, isolated())).toBeUndefined();
  }, 120_000);

  test("reports true mismatches and retains explicit unknown without fabricating a false verdict", () => {
    const explicit = definition([], { $ref: "String" }, false);
    expect(functionBodySaveIssue({ kind: "literal", value: 42 }, explicit, isolated())).toBeDefined();
    const invalidApplication: ExprNode = { kind: "call", fnId: "numberOnly", args: [{ kind: "literal", value: "wrong" }] };
    const typedCall = { ...isolated(), getFunctionEntry: (id: string) => id === "numberOnly" ? {
      id, params: [valueParam], returns: number, scheme: { quantified: [], body: { $arrow: { params: [valueParam], returns: number } } },
    } : undefined };
    expect(functionBodySaveIssue(invalidApplication, explicit, typedCall)).toBeDefined();
    const pending: ExprNode = { kind: "call", fnId: "pending:callable", args: [{ kind: "literal", value: 1 }] };
    expect(functionBodySaveIssue(pending, explicit, isolated())).toBeUndefined();
    expect(functionBodySaveIssue(pending, definition([], { $ref: "String" }, true), isolated())).toContain("Add a result type");
  }, 120_000);

  test("an authored set-former result is refused only by a definite containment verdict", () => {
    // The canonical equation abstains at Void, union, intersection and
    // complement; the existing containment verdict then decides Save.
    for (const returns of [{ $void: true }, { $complement: number }] as FenelType[]) {
      expect(functionBodySaveIssue({ kind: "literal", value: 42 }, definition([], returns, false), isolated())).toContain("This expression returns");
    }
    expect(functionBodySaveIssue({ kind: "literal", value: "abc" }, definition([], Anything, false), isolated())).toBeUndefined();
    expect(functionBodySaveIssue({ kind: "literal", value: 42 }, definition([], { $complement: { $void: true } }, false), isolated())).toBeUndefined();
  }, 120_000);
});

describe("one-sided nominal save admission", () => {
  test("static compatibility cannot admit a mismatched evaluated value", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const node: ExprNode = { kind: "param", name: "candidate" };
    expect(draftSaveIssue(node, { ...isolated, bindings: { candidate: number } }, {
      expectedType: number, evaluatedValue: "not a number",
    })).toBeDefined();
  });

  test("a definite form-validator refusal is Just false", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const expected: TypeScheme = { quantified: [], body: List(number) };
    for (const value of [["not a number"], "not a list"]) {
      const plans: unknown[] = [], observations: unknown[] = [];
      const checked = validateValue(expected.body, value, null, { functions: {}, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
      });
      console.info("S5 List admission facts", JSON.stringify({ value, checked, plans, observations }));
      expect(literalMembershipFor(isolated)(value, expected)).toEqual(Just(false));
    }
  });

  test("unchecked enum-map form compatibility cannot become whole List membership", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const expected: TypeScheme = { quantified: [], body: List({ $map: { keys: { $tag: "SeEnum", values: ["k"] }, values: number } }) };
    for (const value of [[42], [{ k: "bad" }]]) expect(literalMembershipFor(isolated)(value, expected)).toEqual(Nothing);
  });

  test("optional record form omissions cannot establish actual Maybe membership", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const expected: TypeScheme = { quantified: [], body: List({ $record: { fields: [{
      ...valueParam, type: Maybe(number),
    }] } }) };
    for (const value of [[{ _0: null }], [{ _0: undefined }], [{}]]) {
      expect(literalMembershipFor(isolated)(value, expected)).toEqual(Nothing);
    }
    const plans: unknown[] = [], observations: unknown[] = [];
    let checked: unknown;
    try {
      checked = validateValue(expected.body, [{ _0: Nothing }], null, { functions: {}, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
      });
    } catch (error) {
      checked = { error: error instanceof Error ? error.message : String(error) };
    }
    console.info("S5 optional Maybe admission facts", JSON.stringify({ expected, checked, plans, observations }));
    expect(literalMembershipFor(isolated)([{ _0: Nothing }], expected)).toEqual(Just(true));
  });

  test("expression-widget form skips do not bypass actual occurrence admission", () => {
    const fieldId = "d6000000-0000-4000-8000-000000000901";
    const registry = {
      evaluateContext: () => ({}),
      getFieldRepresentation: (typeName: string, identity: string) => typeName === "Codeable" && identity === fieldId
        ? { typeName, args: [identity], methods: { codeName: "amount" } } : undefined,
      resolveFieldPresentation: () => ({ label: "amount", display: { widget: Just("string-expression") }, source: "uuid-field-facet" }),
    } as unknown as ModuleRegistry;
    const expected = List({ $record: { fields: [{ ...valueParam, name: "amount",
      key: { $tag: "NamedField" as const, ref: { $ref: fieldId } },
    }] } });
    const options = { registry, functions: {}, coerce: false,
      strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false } };
    expect(validateValue(expected, [{ amount: "not a number" }], null, options).valid).toBe(true);
    expect(validateValue(expected, [{ amount: "not a number" }], null, {
      ...options, observeAdmission: () => {},
    }).valid).toBe(false);
  });

  test("finite-map unknown and unavailable field plans retain unknown membership", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    expect(literalMembershipFor(isolated)([[1]], { quantified: [], body: List(Vec({ $ref: "UnavailableType" }, 1)) })).toEqual(Nothing);
    const field = { ...valueParam, name: "unavailable", key: { $tag: "NamedField" as const, ref: { $ref: "absent-field-identity" } } };
    expect(literalMembershipFor(isolated)([{ unavailable: "bad" }], {
      quantified: [], body: List({ $record: { fields: [field] } }),
    })).toEqual(Nothing);
  });

  test("same-name refined refusal explains the complete type rather than a missing root declaration", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const actual: TypeScheme = { quantified: [], body: number,
      nominals: [{ path: [], identity: '["system","Number"]', publicName: "Number" }] };
    const wanted: TypeScheme = { quantified: [], body: { $refined: { base: number,
      set: { $tag: "SeInterval", interval: {
        lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }),
      } },
    } } };
    const scoped = { ...isolated, bindings: { candidate: actual } };
    const node: ExprNode = { kind: "param", name: "candidate" };
    expect(draftSaveIssue(node, scoped, { expectedScheme: wanted })).toBeUndefined();
    const issue = draftSaveIssue(node, scoped, { expectedScheme: wanted, evaluatedValue: 13 });
    expect(issue).toContain("their full types do not match");
    expect(issue).not.toContain("declaration");
    expect(draftSaveIssue(node, scoped, { expectedScheme: wanted, evaluatedValue: 12 })).toBeUndefined();
    expect(draftSaveIssue({ kind: "literal", value: 13 }, isolated, { expectedScheme: wanted })).toBeDefined();
    expect(draftSaveIssue({ kind: "literal", value: 12 }, isolated, { expectedScheme: wanted })).toBeUndefined();
  });

  test("equal displayed types cannot replace a missing captured owner", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const raw: TypeScheme = { quantified: [], body: { $ref: "Item" } };
    const owned = (identity: string): TypeScheme => ({
      ...raw, nominals: [{ path: [], identity, publicName: "Item" }],
    });
    const node: ExprNode = { kind: "param", name: "candidate" };
    for (const [actual, wanted, explanation] of [[raw, owned("owner-A"), "missing the required type's declaration"],
      [owned("owner-A"), raw, "required type does not share it"],
      [owned("owner-A"), owned("owner-B"), "different declarations"]] as const) {
      expect(draftSaveIssue(node, { ...isolated, bindings: { candidate: actual! } }, {
        expectedScheme: wanted!,
      })).toContain(explanation);
    }
    for (const actual of [raw, owned("owner-A")]) {
      expect(draftSaveIssue(node, { ...isolated, bindings: { candidate: actual } }, {
        expectedScheme: actual,
      })).toBeUndefined();
    }
  });

  test("non-enumerable owner transport is refused while ordinary unknown references stay undecided", () => {
    const isolated = createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const hidden = (identity: string): TypeScheme => Object.defineProperty({
      quantified: [], body: { $ref: "HiddenSaveItem" },
    }, "nominals", { value: [{ path: [], identity, publicName: "HiddenSaveItem" }], enumerable: false });
    const actual = hidden("hidden-save-owner-A");
    const node: ExprNode = { kind: "param", name: "candidate" };
    expect(draftSaveIssue(node, { ...isolated, bindings: { candidate: actual } }, {
      expectedScheme: hidden("hidden-save-owner-B"),
    })).toContain('non-enumerable inference transport property "nominals"');
    const hiddenUnknown: TypeScheme = Object.defineProperty({ quantified: [], body: { $ref: "UnknownAccountType" } },
      "nominals", { value: [], enumerable: false });
    const scoped = { ...isolated, bindings: { candidate: { quantified: [], body: number } } };
    const refused = draftSaveValidation(node, scoped, { expectedScheme: hiddenUnknown });
    expect(refused.issue).toContain('non-enumerable inference transport property "nominals"');
    expect(refused.issueDiagnostic?.code).toBe("authoring-boundary-invalid");
    expect(refused.verdict).toEqual(Nothing);
    expect(refused.state.$tag).not.toBe("HintPass");
    // Undecidability is a separate, readable carrier. A hidden empty sidecar
    // is a transport refusal, not permission to discard nominal metadata.
    const unknown: TypeScheme = { quantified: [], body: { $ref: "UnknownAccountType" }, nominals: [] };
    expect(draftSaveIssue(node, { ...isolated, bindings: { candidate: { quantified: [], body: number } } }, {
      expectedScheme: unknown,
    })).toBeUndefined();
  });
});

describe("checked call return expectations", () => {
  let fixture: {
    environment: ReturnType<typeof createAuthoringEnvironment>;
    expected: TypeScheme;
    node: ExprNode;
    evaluatedValue: unknown;
  };

  beforeAll(() => {
    // C1: ordinary source declarations supply the nested Result/List nominal
    // transport. The real parser, registry and inference establish its owner.
    const source = loadFenelModule(`module ReturnGuidanceProbe where
Purchase = Purchase id: String
sample : Result String (List Purchase)
sample = Ok [Purchase { id = "p1" }]
`, "ReturnGuidanceProbe");
    const registry = createRegistry([stdModule, source]);
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], {
      registry, sourceModule: "ReturnGuidanceProbe",
    }));
    const entry = environment.getFunctionEntry?.("sample");
    if (!entry?.scheme || entry.signatureOutcome?.$tag !== "Solved") throw new Error("Fixture signature unavailable");
    const expected = projectAuthoringScheme(entry.scheme, ["$arrow", "returns"]);
    if (!expected?.nominals?.length) throw new Error("Fixture nominal return authority unavailable");
    fixture = {
      environment, expected,
      node: { kind: "call", fnId: "sample", args: [] },
      evaluatedValue: invokeCallable({ $ref: "ReturnGuidanceProbe:sample" }, [], registry.evaluateContext()),
    };
  }, 120_000);

  test("nested nominal returns preserve the selected declaration's checked scheme", () => {
    const { environment, expected, node, evaluatedValue } = fixture;
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(node, environment);
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.scheme?.nominals).toEqual(expected.nominals);
    expect(judgeAuthoringSchemeCompatibility(inferred.scheme!, expected.body)).toBe("incompatible");
    expect(judgeAuthoringSchemeCompatibility(inferred.scheme!, expected)).toBe("compatible");
    expect(draftSaveIssue(node, environment, { expectedType: expected.body, evaluatedValue })).toBeDefined();
    expect(draftSaveIssue(node, environment, { expectedType: expected.body, expectedScheme: expected, evaluatedValue })).toBeUndefined();
    expect(draftSaveIssue(node, environment, { expectedScheme: expected })).toBeUndefined();
  });

  test("matching displayed return types do not erase a different nested nominal owner", () => {
    const { environment, expected, node, evaluatedValue } = fixture;
    const wrongOwner: TypeScheme = {
      ...expected,
      nominals: expected.nominals!.map(nominal => ({ ...nominal, identity: '["AnotherAccount","Purchase"]' })),
    };
    expect(draftSaveIssue(node, environment, {
      expectedType: expected.body, expectedScheme: wrongOwner, evaluatedValue,
    })).toBeDefined();
    expect(draftSaveIssue(node, environment, {
      expectedScheme: { quantified: [], body: { $ref: "String" } }, evaluatedValue,
    })).toBeDefined();
  });

  test("authoritative expectations retain definite refusals and unknown membership", () => {
    const { environment } = fixture;
    const radius: FenelType = { $refined: { base: number, set: { $tag: "SeInterval", interval: {
      lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }),
    } } } };
    expect(draftSaveIssue({ kind: "literal", value: 12 }, environment, {
      expectedScheme: { quantified: [], body: radius },
    })).toBeUndefined();
    expect(draftSaveIssue({ kind: "literal", value: 13 }, environment, {
      expectedScheme: { quantified: [], body: radius },
    })).toBeDefined();
    expect(draftSaveIssue({ kind: "literal", value: 13 }, environment, {
      expectedScheme: { quantified: [], body: { $refined: { base: number,
        set: { $tag: "SeRef", handle: "UnpublishedRadius" },
      } } },
    })).toBeUndefined();
  });
});

describe("named constructor field save checks", () => {
  let environment: ReturnType<typeof createAuthoringEnvironment>;
  let registry: ReturnType<typeof createRegistry>;
  const expected: FenelType = { $ref: "Plan" };
  let rulesTarget: string;
  let planTarget: string;
  let checkedScheme: TypeScheme;
  let undecidedScheme: TypeScheme;
  let windowScheme: TypeScheme;
  const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
  const plan = (maximum: unknown, finish: unknown = 10): ExprNode => literal({
    __construct: { tag: planTarget, fields: [
      { name: "finish", value: literal(finish) },
      { name: "rules", value: literal({ __construct: { tag: rulesTarget, fields: [
        { name: "maximum", value: literal(maximum) },
        { name: "label", value: literal("Preparation limit") },
      ] } }) },
    ] },
  });
  let reportedNatFailure = false;
  const saveIssue = (node: ExprNode) => {
    const reader = registry.evaluateContext();
    const issue = draftSaveIssue(node, environment, { expectedType: expected, registry, evaluateContext: reader });
    if (issue && !reportedNatFailure) {
      reportedNatFailure = true;
      const target = environment.resolveConstructorTarget?.(planTarget);
      const entry = target === undefined ? undefined : environment.getFunctionEntry?.(target);
      const finishIndex = entry?.params.findIndex(param => param.name === "finish");
      const scheme = entry?.scheme && finishIndex !== undefined && finishIndex >= 0
        ? projectAuthoringScheme(entry.scheme, ["$arrow", "params", String(finishIndex), "type"]) : undefined;
      const checking = authoringMembershipEvaluateContext(reader);
      const closed = scheme && closeAuthoringMembershipType(scheme, checking);
      const owner = closed && "$ref" in closed ? checking._typeFamilyOwner?.(closed.$ref, checking._sourceFunction) : undefined;
      console.error("S5 named constructor Nat witness", JSON.stringify({ issue, node, planTarget, target, entry, finishIndex, scheme, closed, owner,
        helper: scheme && literalMembershipFor(environment, { registry, evaluateContext: reader })(10, scheme),
        member: scheme && registry.callSiteTyping.member(scheme, 10, null, checking),
        resolved: checking._callSiteTyping?.resolveType({ $ref: "Nat" }, checking._sourceFunction),
        ownerResolved: owner && checking._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity),
        rawNatOwner: checking._typeFamilyOwner?.("Nat", checking._sourceFunction),
      }));
    }
    return issue;
  };

  beforeAll(() => {
    const source = loadFenelModule(`module NumericSaveProbe where
PreparationMinutes = Number | value ∈ [0..240]
Rules = Rules label: String maximum: PreparationMinutes
Plan = Plan rules: Rules finish: Nat
CheckedPlan = Plan | value.finish <= value.rules.maximum
UndecidedPlan = Plan | (Nothing)
PhoneDraft = String | value ∈ format:phone
ContactDraft = ContactDraft phone: PhoneDraft
PersonDraft = PersonDraft contact: ContactDraft
checkPlan : (candidate: CheckedPlan) -> Nat
checkPlan candidate = candidate.finish
checkUndecidedPlan : (candidate: UndecidedPlan) -> Nat
checkUndecidedPlan candidate = candidate.finish
checkWindow : (candidate: { minimum: Number, maximum: Number } where value.minimum <= value.maximum) -> Number
checkWindow candidate = candidate.maximum
`, "NumericSaveProbe");
    registry = createRegistry([stdModule, source]);
    const entries = ["PreparationMinutes", "Rules", "Plan", "CheckedPlan", "UndecidedPlan", "PhoneDraft", "ContactDraft", "PersonDraft"].map(name => {
      const entity = registry.getIdentifiedEntity(name);
      if (!entity) throw new Error(`Fixture declaration ${name} unavailable`);
      if (entity.params?.length) throw new Error(`Fixture declaration ${name} must be monomorphic`);
      return { id: entity.id, name, description: "Source declaration", category: "entity" as const,
        entity: { ...entity, params: undefined } };
    });
    environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([
      { id: "entity", label: "Source types", description: "Registry declarations", entries },
    ], {
      registry, sourceModule: "NumericSaveProbe",
    }));
    const rules = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "NumericSaveProbe" && entry.parentEntity === "Rules" && entry.id === "Rules");
    const entry = environment.catalog.patternConstructors?.find(entry =>
      entry.parentModule === "NumericSaveProbe" && entry.parentEntity === "Plan" && entry.id === "Plan");
    if (rules?.kind !== "constructor" || entry?.kind !== "constructor"
      || entry.signatureOutcome?.$tag !== "Solved" || !entry.scheme) {
      throw new Error("Named constructor fixture declarations unavailable");
    }
    rulesTarget = rules.targetId ?? rules.id;
    planTarget = entry.targetId ?? entry.id;
    const checked = environment.getFunctionEntry?.("checkPlan");
    const undecided = environment.getFunctionEntry?.("checkUndecidedPlan");
    const window = environment.getFunctionEntry?.("checkWindow");
    const checkedParameter = checked?.scheme && projectAuthoringScheme(checked.scheme, ["$arrow", "params", "0", "type"]);
    const undecidedParameter = undecided?.scheme && projectAuthoringScheme(undecided.scheme, ["$arrow", "params", "0", "type"]);
    const windowParameter = window?.scheme && projectAuthoringScheme(window.scheme, ["$arrow", "params", "0", "type"]);
    if (!checkedParameter || !undecidedParameter || !windowParameter) throw new Error("Whole-record source parameter schemes unavailable");
    checkedScheme = checkedParameter;
    undecidedScheme = undecidedParameter;
    // C1: the dynamic compatibility parser retains legacy path handles for
    // inline fields. This separate test-owned anonymous schema supplies actual
    // Field UUIDs; its source predicate/values are unchanged and no nominal
    // declaration owner is manufactured.
    windowScheme = structuredClone(windowParameter);
    const windowBody = windowScheme.body;
    if (!("$refined" in windowBody) || !("$record" in windowBody.$refined.base)) {
      throw new Error("Expected the parsed two-field inline refinement");
    }
    windowBody.$refined.base.$record.fields.forEach((field, index) => {
      field.key = { $tag: "NamedField", ref: { $ref: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}` } };
    });
  }, 120_000);

  test("real membership admits valid nested named fields in authored order", () => {
    for (const maximum of [0, 10, 240]) expect(saveIssue(plan(maximum))).toBeUndefined();
  }, 60_000);

  test("real membership refuses invalid nested fields and recovers after correction", () => {
    for (const maximum of [-1, 241, Infinity, "10"]) expect(saveIssue(plan(maximum))).toBeDefined();
    for (const finish of [-1, 0.5, "10"]) expect(saveIssue(plan(10, finish))).toBeDefined();
    expect(saveIssue(plan(10, 0))).toBeUndefined();
  }, 60_000);

  test("save checking preserves original constructor data and rejects a different declared root", () => {
    const node = plan(10);
    const before = structuredClone(node);
    expect(saveIssue(node)).toBeUndefined();
    expect(node).toEqual(before);
    expect(draftSaveIssue(node, environment, {
      expectedType: { $ref: "Rules" }, registry, evaluateContext: registry.evaluateContext(),
    })).toBeDefined();
  }, 60_000);

  test("named whole-record refinement checks its whole predicate after canonical containment abstains", () => {
    const expectedScheme = checkedScheme;
    const check = (node: ExprNode) => draftSaveIssue(node, environment, {
      expectedScheme, registry, evaluateContext: registry.evaluateContext(),
    });
    const valid = plan(20, 10);
    const before = structuredClone(valid);
    const projected = dispatchedDataExpressionValue(exprNodeToLogic(valid, {
      constructorName: id => environment.constructorCodeName(id),
    }), registry.evaluateContext());
    expect(projected.$tag).toBe("Concrete");
    if (projected.$tag !== "Concrete") throw new Error("Closed source construction must project to data");
    expect(registry.callSiteTyping.member(expectedScheme, projected.value, null, registry.evaluateContext())).toBe("unknown");
    const judge = literalMembershipFor(environment, { registry, evaluateContext: registry.evaluateContext() });
    expect(judge(projected.value, expectedScheme)).toEqual(Just(true));
    expect(check(valid)).toBeUndefined();
    const invalid = plan(5, 10);
    const invalidProjection = dispatchedDataExpressionValue(exprNodeToLogic(invalid, {
      constructorName: id => environment.constructorCodeName(id),
    }), registry.evaluateContext());
    if (invalidProjection.$tag !== "Concrete") throw new Error("Closed source construction must project to data");
    expect(judge(invalidProjection.value, expectedScheme)).toEqual(Just(false));
    expect(check(invalid)).toBeDefined();
    // Both records have valid fields. The root refinement runs after its base
    // and emits the final fact; descendant successes cannot supply that fact.
    const checking = authoringMembershipEvaluateContext(registry.evaluateContext());
    const closed = closeAuthoringMembershipType(expectedScheme, checking);
    if (!closed) throw new Error("Actual whole-record declaration unavailable");
    for (const [value, accepted] of [[projected.value, true], [invalidProjection.value, false]] as const) {
      const plans: unknown[] = [];
      const checked = validateValue(closed, value, null, { registry, functions: checking, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeAdmission: fact => plans.push(fact),
      });
      expect(checked.valid).toBe(accepted);
      expect(plans.at(-1)).toEqual({ $tag: "ValidationAdmissionMember", verdict: Just(accepted) });
    }
    expect(valid).toEqual(before);
  }, 60_000);

  test("creation feedback recursively retains a nested Phone's real ongoing, blocked and passing states", () => {
    const target = (name: string) => {
      const entry = environment.catalog.patternConstructors?.find(entry => entry.parentModule === "NumericSaveProbe"
        && entry.parentEntity === name && entry.id === name);
      if (!entry) throw new Error(`Missing source constructor ${name}`);
      return entry.targetId ?? entry.id;
    };
    const person = (phone: unknown): ExprNode => literal({ __construct: { tag: target("PersonDraft"), fields: [
      { name: "contact", value: literal({ __construct: { tag: target("ContactDraft"), fields: [
        { name: "phone", value: literal(phone) },
      ] } }) },
    ] } });
    const check = (node: ExprNode) => draftSaveValidation(node, environment, {
      expectedType: { $ref: "PersonDraft" }, registry, evaluateContext: registry.evaluateContext(),
    });
    const ongoingNode = person("+33"), before = structuredClone(ongoingNode);
    const ongoing = check(ongoingNode);
    expect(ongoing.state.$tag).toBe("HintNotYet");
    expect(ongoing.fields.some(field => field.path.includes("phone") && field.hints.state.$tag === "HintNotYet")).toBe(true);
    expect(ongoingNode).toEqual(before);
    const blocked = check(person("+33!"));
    expect(blocked.state.$tag).toBe("HintBlocked");
    expect(blocked.fields.some(field => field.hints.state.$tag === "HintBlocked")).toBe(true);
    const passing = check(person("+33612345678"));
    expect(passing.verdict).toEqual(Just(true));
    expect(passing.state.$tag).toBe("HintPass");
    expect(passing.issue).toBeUndefined();
    expect(check(person(undefined)).state.$tag).toBe("HintNotYet");
  }, 120_000);

  test("creation feedback requires whole positive evidence, preserving whole-record false and unknown", () => {
    const options = { registry, evaluateContext: registry.evaluateContext() };
    expect(draftSaveValidation(plan(20, 10), environment, { ...options, expectedScheme: checkedScheme }).state.$tag).toBe("HintPass");
    const refused = draftSaveValidation(plan(5, 10), environment, { ...options, expectedScheme: checkedScheme });
    expect(refused.state.$tag).not.toBe("HintPass");
    expect(refused.issue).toBeDefined();
    // An undecided whole predicate does not erase a separate source typing
    // error in its authored constructor's Nat argument.
    const independent = draftSaveValidation(plan(20, 10), environment, { ...options, expectedScheme: undecidedScheme });
    expect(independent.verdict).toEqual(Nothing);
    expect(independent.state.$tag).toBe("HintNotMet");
    expect(independent.issue).toBe("Number is not Nat");
    expect(independent.issueDiagnostic?.code).toBe("inference.nominal-mismatch");
    const declaredPlan = expectedSchemeForType({ $ref: "Plan" }, environment);
    if (!declaredPlan) throw new Error("The source Plan scheme is unavailable");
    // A legitimate already-typed Plan binding isolates the undecided extra
    // predicate without manufacturing a constructor-argument proof.
    const unknown = draftSaveValidation({ kind: "param", name: "candidate" }, {
      ...environment, bindings: { candidate: declaredPlan },
    }, { ...options, expectedScheme: undecidedScheme });
    expect(unknown.verdict).toEqual(Nothing);
    expect(unknown.issue).toBeUndefined();
    expect(unknown.state.$tag).toBe("HintUnknown");
  }, 120_000);

  test("an identified inline fixture schema checks positive and negative data and recovers without rewriting source", () => {
    const window = (minimum: number, maximum: number): ExprNode => literal({ __record: { fields: [
      { name: "maximum", value: literal(maximum) }, { name: "minimum", value: literal(minimum) },
    ] } });
    const check = (node: ExprNode) => draftSaveIssue(node, environment, {
      expectedScheme: windowScheme, registry, evaluateContext: registry.evaluateContext(),
    });
    const valid = window(10, 20);
    const before = structuredClone(valid);
    const projected = dispatchedDataExpressionValue(exprNodeToLogic(valid), registry.evaluateContext());
    expect(projected).toEqual({ $tag: "Concrete", value: { maximum: 20, minimum: 10 } });
    expect(check(valid)).toBeUndefined();
    expect(check(window(20, 10))).toBeDefined();
    expect(check(window(10, 10))).toBeUndefined();
    expect(valid).toEqual(before);
    const judge = literalMembershipFor(environment, { registry, evaluateContext: registry.evaluateContext() });
    expect(judge({ minimum: 10, maximum: 20 }, windowScheme)).toEqual(Just(true));
    expect(judge({ minimum: 20, maximum: 10 }, windowScheme)).toEqual(Just(false));
  }, 60_000);

  test("unknown membership and unavailable nominal authority cannot grant a constructed-data fact", () => {
    const expectedScheme = checkedScheme;
    if (!expectedScheme?.nominals?.length) throw new Error("Whole-record nominal source authority unavailable");
    const value = { $tag: "Plan", finish: 10, rules: { $tag: "Rules", label: "Preparation limit", maximum: 20 } };
    const judge = literalMembershipFor(environment, { registry, evaluateContext: registry.evaluateContext() });
    const wrongOwner = { ...expectedScheme, nominals: expectedScheme.nominals.map(nominal => ({
      ...nominal, identity: '["UnavailableAccount","CheckedPlan"]',
    })) };
    expect(judge(value, wrongOwner)).toEqual(Nothing);
    expect(draftSaveIssue(plan(20, 10), environment, {
      expectedScheme: wrongOwner, registry, evaluateContext: registry.evaluateContext(),
    })).toBeDefined();
    expect(judge(value, undecidedScheme)).toEqual(Nothing);
  }, 60_000);

  test("checking constructed fields never executes an arbitrary callback", () => {
    let invocations = 0;
    const node = plan(20, 10);
    if (node.kind !== "literal") throw new Error("Expected constructor marker");
    (node.value as { __construct: { fields: { name: string; value: ExprNode }[] } }).__construct.fields[0]!.value = {
      kind: "call", fnId: "effectfulFixtureCallback", args: [],
    };
    const evaluateContext = { ...registry.evaluateContext(), natives: {
      effectfulFixtureCallback: () => { invocations++; return 10; },
    } };
    draftSaveIssue(node, environment, {
      expectedType: { $ref: "CheckedPlan" }, registry, evaluateContext,
    });
    expect(invocations).toBe(0);
  }, 60_000);
});

describe("captured raw record/list descendant refusals", () => {
  let registry: ReturnType<typeof createRepositoryRegistry>;
  let environment: ReturnType<typeof createAuthoringEnvironment>;
  let listScheme: TypeScheme;
  let target: string;
  // A social link's platform is a nullary SocialPlatform constructor.
  const platform = { $tag: "X" };
  const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
  const person = (url: string): ExprNode => literal({ __construct: { tag: target, fields: [
    { name: "name", value: literal("Person being edited") },
    // PublicPerson gained `picture: Maybe Image` on 2026-11-11 (ccb1f16e).
    { name: "picture", value: { kind: "call", fnId: "@ctor/system/Maybe/Nothing", args: [] } },
    { name: "biography", value: { kind: "call", fnId: "@ctor/system/Maybe/Nothing", args: [] } },
    { name: "birthDate", value: { kind: "call", fnId: "@ctor/system/Maybe/Nothing", args: [] } },
    // The shared record widget's real wire is raw array/record data here.
    { name: "socialLinks", value: literal([{ platform, url }]) },
  ] } });

  beforeAll(() => {
    registry = createRepositoryRegistry([stdModule, pictureModule, viewModule,
      loadFenelModule(SHOWCASE_SOURCE, "ShowcaseDemo")]);
    const sections = sessionCatalogSections(registry, [], id => ({ name: id, description: "Captured source type" }));
    environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(sections, { registry }));
    const constructor = environment.catalog.patternConstructors?.find(entry => entry.parentEntity === "PublicPerson");
    if (!constructor?.scheme || constructor.signatureOutcome?.$tag !== "Solved") throw new Error("Actual PublicPerson constructor unavailable");
    target = constructor.targetId ?? constructor.id;
    const params = constructor.scheme.body;
    if (!("$arrow" in params)) throw new Error("Actual constructor must have a checked arrow");
    const index = params.$arrow.params.findIndex(field => field.name === "socialLinks");
    const projected = projectAuthoringScheme(constructor.scheme, ["$arrow", "params", String(index), "type"]);
    if (!projected?.nominals?.length) throw new Error("Actual List SocialLink owner sidecar unavailable");
    listScheme = projected;
  }, 180_000);

  test("a known-false raw nested URL refuses save and its correction recovers without rewriting source", () => {
    const options = { expectedType: { $ref: "PublicPerson" } as FenelType, registry, evaluateContext: registry.evaluateContext() };
    const invalid = person("not a url");
    const valid = person("https://example.org/fenel-link-test");
    const invalidBefore = structuredClone(invalid);
    const validBefore = structuredClone(valid);
    const invalidIssue = draftSaveIssue(invalid, environment, options);
    const validIssue = draftSaveIssue(valid, environment, options);
    expect(invalidIssue).toContain("does not satisfy");
    expect(validIssue).toBeUndefined();
    expect(invalid).toEqual(invalidBefore);
    expect(valid).toEqual(validBefore);
    const judge = literalMembershipFor(environment, options);
    const checks = literalMembershipChecksFor(environment, options);
    const data = [{ platform, url: "not a url" }];
    const invalidVerdict = judge(data, listScheme);
    const validVerdict = judge([{ ...data[0], url: "https://example.org/fenel-link-test" }], listScheme);
    expect(invalidVerdict).toEqual(Just(false));
    expect(checks(data, listScheme)).toContainEqual({ verdict: Just(false), path: "0.url" });
    expect(validVerdict).toEqual(Just(true));
  }, 60_000);

  test("foreign owner sidecars and validator errors cannot manufacture a descendant refusal", () => {
    const checks = literalMembershipChecksFor(environment, { registry, evaluateContext: registry.evaluateContext() });
    const foreign = { ...listScheme, nominals: listScheme.nominals!.map(nominal => ({ ...nominal, identity: '["ForeignAccount","SocialLink"]' })) };
    expect(checks([{ platform: {}, url: "not a url" }], foreign)).toEqual([]);
    // A platform that is no SocialPlatform contributes schema errors; those errors cannot
    // manufacture a scalar URL refusal.
    expect(checks([{ platform: {}, url: "https://example.org" }], listScheme)
      .some(check => check.verdict.$tag === "Just" && check.verdict._0 === false)).toBe(false);
    const undecided: TypeScheme = { quantified: [], body: { $refined: { base: number,
      set: { $tag: "SeRef", handle: "UnpublishedLiteralBound" } } } };
    expect(checks(12, undecided)).toContainEqual({ verdict: Nothing, path: "" });
  }, 60_000);

  test("container refinements do not become scalar observations or change the original whole verdict", () => {
    const body: FenelType = { $refined: { base: List(number),
      set: { $tag: "SeWhere", pred: { call: ["eq", 1, 2] } } } };
    const expected: TypeScheme = { quantified: [], body };
    const options = { registry, evaluateContext: registry.evaluateContext() };
    const judge = literalMembershipFor(environment, options);
    // Constant false already canonically refutes this whole type at HEAD.
    // The observer must not independently emit that container predicate.
    expect(judge([1, 2], expected)).toEqual(Just(false));
    const checks = literalMembershipChecksFor(environment, options)([1, 2], expected);
    expect(checks.some(check => check.verdict.$tag === "Just" && check.verdict._0 === false)).toBe(false);
    expect(checks.every(check => check.path !== "")).toBe(true);
    expect(judge([1, 2], expected)).toEqual(Just(false));
  }, 60_000);

  const checkUrlObservers = (type: FenelType, functions: EvaluateContext) => {
    const options = { registry, functions, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false } };
    for (const observer of [
      () => { throw new Error("An observer is not a validator"); },
      (verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean }) => { if (verdict.$tag === "Just") verdict._0 = false; },
    ]) {
      let calls = 0;
      const observeMembership = (verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean }) => {
        calls++;
        observer(verdict);
      };
      const valid = validateValue(type, "https://example.org", null, { ...options, observeMembership });
      const invalid = validateValue(type, "not a url", null, { ...options, observeMembership });
      expect(valid.valid).toBe(true);
      expect(valid.errors).toEqual([]);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors[0]?.message).toBe("Invalid url format");
      expect(calls).toBeGreaterThan(0);
    }
  };

  const checkUrlUndecided = (type: FenelType, functions: EvaluateContext) => {
    for (const value of ["https://example.org", "not a url"]) {
      const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
      const result = validateValue(type, value, null, { registry, functions, coerce: false,
        strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false },
        observeMembership: verdict => observations.push(verdict),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => typeof error.message === "string" && error.message.includes("could not decide membership"))).toBe(true);
      expect(observations).not.toContainEqual(Just(false));
    }
  };

  test("membership observation mutation or throws cannot alter the original validation verdict", () => {
    const type: FenelType = { $ref: "system.UrlStr" };
    const functions = registry.evaluateContext();
    expect(registry.callSiteTyping.resolveType(type, functions._sourceFunction).ok).toBe(true);
    checkUrlObservers(type, functions);
  }, 60_000);

  test("URL declaration visibility admits a bare name in an authenticated actual source frame", () => {
    const original = registry.evaluateContext();
    const alias = original.getFunction?.("ShowcaseDemo:showcaseRom");
    const source = alias && original.getFunction?.(alias.id);
    const imports = source && original.getFunctionImportFrame?.(source.id);
    if (source === undefined || source.body === undefined || source.id !== alias?.id || imports === undefined) throw new Error("Actual Showcase source frame unavailable");
    const functions = { ...original, _sourceFunction: source.id, _importStack: [imports] };
    expect(functions.getFunction?.(source.id)).toBe(source);
    const type: FenelType = { $ref: "UrlStr" };
    expect(registry.callSiteTyping.resolveType(type, source.id).ok).toBe(true);
    checkUrlObservers(type, functions);
  }, 60_000);

  test("URL declaration visibility refuses an unscoped bare name", () => {
    const functions = registry.evaluateContext();
    const type: FenelType = { $ref: "UrlStr" };
    expect(functions._sourceFunction).toBeUndefined();
    expect(registry.callSiteTyping.resolveType(type, functions._sourceFunction).ok).toBe(false);
    checkUrlUndecided(type, functions);
  }, 60_000);

  // Demo 1 typed entry (2026-11-07): a type picked in the Local type builder is
  // stored as its exact identity handle. That handle names its one owner, as it
  // already does for callableTypeOwnerFor; it is visible without a source frame.
  test("an exact identity handle is visible without a source frame", () => {
    const functions = registry.evaluateContext();
    const handle = registry.getTypeUuid("system", "UrlStr");
    if (!handle) throw new Error("system.UrlStr has no repository identity; regenerate the identity artifacts first.");
    expect(functions._sourceFunction).toBeUndefined();
    const exact = registry.callSiteTyping.resolveType({ $ref: handle }, undefined);
    const qualified = registry.callSiteTyping.resolveType({ $ref: "system.UrlStr" }, undefined);
    expect(exact.ok).toBe(true);
    const owner = (result: typeof exact) => result.ok ? result.type.nominals?.find(row => row.path.length === 0)?.identity : undefined;
    expect(owner(exact)).toBeDefined();
    expect(owner(exact)).toBe(owner(qualified));
    checkUrlObservers({ $ref: handle }, functions);
    // An unknown UUID and a function's identity handle stay missing.
    expect(registry.callSiteTyping.resolveType({ $ref: "6320dc73-0000-4000-8000-0000000fe7e1" }, undefined).ok).toBe(false);
    const functionHandle = registry.getUuid("std:add") ?? registry.getUuid("add");
    if (!functionHandle) throw new Error("std.add has no repository identity");
    expect(registry.getIdentifiedEntity(functionHandle)).toBeUndefined();
    expect(registry.callSiteTyping.resolveType({ $ref: functionHandle }, undefined).ok).toBe(false);
  }, 60_000);

  test("URL declaration visibility refuses a changed declaration pointer", () => {
    const original = registry.evaluateContext();
    const declaration = registry.getIdentifiedEntity("UrlStr")?.type;
    if (!declaration) throw new Error("Actual URL declaration unavailable");
    expect(original.getEntityType?.("UrlStr")).toBe(declaration);
    const replacement = structuredClone(declaration);
    const functions = { ...original, getEntityType: (name: string) => {
      const selected = original.getEntityType?.(name);
      return selected === declaration ? replacement : selected;
    } };
    checkUrlUndecided({ $ref: "system.UrlStr" }, functions);
  }, 60_000);

  test("URL declaration visibility refuses an unavailable declaration scope", () => {
    const functions = { ...registry.evaluateContext(), _typeDeclarationScope: () => undefined };
    checkUrlUndecided({ $ref: "system.UrlStr" }, functions);
  }, 60_000);

  test("URL declaration visibility refuses unavailable nominal projection", () => {
    const original = registry.evaluateContext();
    const type: FenelType = { $ref: "system.UrlStr" };
    expect(original.getEntityType?.("UrlStr")).toBeDefined();
    expect(registry.callSiteTyping.resolveType(type, original._sourceFunction).ok).toBe(true);
    const functions = { ...original, _typeFamilyNominalHandle: () => undefined };
    checkUrlUndecided(type, functions);
  }, 60_000);

  test("URL declaration visibility cannot borrow an admitted sibling occurrence for a hidden bare name", () => {
    const functions = registry.evaluateContext();
    const admitted: FieldDef = { ...valueParam, type: { $ref: "system.UrlStr" } };
    const denied: FieldDef = { ...valueParam, name: "_1", key: { $tag: "PositionalField", index: 1 }, type: { $ref: "UrlStr" } };
    expect(registry.callSiteTyping.resolveType(admitted.type, functions._sourceFunction).ok).toBe(true);
    expect(registry.callSiteTyping.resolveType(denied.type, functions._sourceFunction).ok).toBe(false);
    const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
    const result = validateValue({ $record: { fields: [admitted, denied] } }, {
      _0: "https://example.org/admitted", _1: "https://example.org/denied",
    }, null, { registry, functions, coerce: false,
      strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false },
      observeMembership: verdict => observations.push(verdict),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path === "_1" && typeof error.message === "string" && error.message.includes("could not decide membership"))).toBe(true);
    expect(observations).not.toContainEqual(Just(false));
  }, 60_000);
});

describe("value creation save checks", () => {
  describe("reserved-field record validation routes", () => {
    let registry: ModuleRegistry;
    let environment: ReturnType<typeof createAuthoringEnvironment>;
    let reader: EvaluateContext;
    let session: AuthoringSession;
    beforeAll(() => {
      registry = createRegistry([stdModule]);
      environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], { registry, sourceModule: "std" }));
      expect(environment.resolveFunctionId("std.fromEntries")).toBeDefined();
      reader = registry.evaluateContext();
      session = { environment, registry, evaluateContext: reader } as AuthoringSession;
    });
    const record = (contents: string | number): ExprNode => ({ kind: "literal", value: { __record: { fields: [
      { name: "$", value: { kind: "literal", value: "kept" } },
      { name: "contents", value: { kind: "literal", value: contents } },
    ] } } });
    const declaration: FenelFunction = { id: "reserved-record-body", params: [], returns: Anything, body: 0,
      signatureDeclaration: { functionId: "reserved-record-body", declarationName: "reservedRecord", codeName: "reservedRecord",
        params: [], returns: { $tag: "Authored", source: { $tag: "HostSpec", module: "reserved-record" } },
        scheme: { quantified: [], body: { $arrow: { params: [], returns: Anything } } } } };
    function check(candidate: ExprNode, node: ExprNode) {
      const resolveSavedExpr = (id: string) => id === "reserved-record" ? node : undefined;
      const value = evaluate(authoringExpressionLogic(candidate, resolveSavedExpr, session), {}, reader);
      const options = { expectedType: Anything, registry, evaluateContext: reader, resolveSavedExpr, evaluatedValue: value };
      const issue = draftSaveIssue(candidate, environment, options);
      const feedback = draftSaveValidation(candidate, environment, options);
      return { value, issue, feedback };
    }
    test("Save and creation feedback lower homogeneous reserved-field records through the reader's exact fromEntries route", () => {
      const node = record("seven"), before = structuredClone(node);
      const checked = check(node, node);
      expect(checked.value).toEqual({ $: "kept", contents: "seven" });
      expect(checked.issue).toBeUndefined();
      expect(checked.feedback.issue).toBeUndefined();
      expect(checked.feedback.verdict).toEqual(Just(true));
      expect(checked.feedback.state.$tag).toBe("HintPass");
      expect(functionBodySaveIssue(node, declaration, environment, { registry, evaluateContext: reader })).toBeUndefined();
      expect(node).toEqual(before);
    }, 120_000);
    test("saved references to homogeneous reserved-field records retain the same reader route and positive source check", () => {
      const node = record("seven"), before = structuredClone(node);
      const checked = check({ kind: "ref", savedExprId: "reserved-record" }, node);
      expect(checked.value).toEqual({ $: "kept", contents: "seven" });
      expect(checked.issue).toBeUndefined();
      expect(checked.feedback.issue).toBeUndefined();
      expect(checked.feedback.verdict).toEqual(Just(true));
      expect(checked.feedback.state.$tag).toBe("HintPass");
      expect(node).toEqual(before);
    }, 120_000);
    test("heterogeneous reserved-field records retain the canonical refusal until their inference integration is repaired", () => {
      // OPEN INFERENCE DEFECT: execution preserves this mixed record, but the
      // runtime lowering is an ordinary fromEntries call whose value:a list
      // currently unifies String with Number. No acceptance override here.
      const node = record(7), before = structuredClone(node);
      for (const candidate of [node, { kind: "ref", savedExprId: "reserved-record" } as ExprNode]) {
        const checked = check(candidate, node);
        expect(checked.value).toEqual({ $: "kept", contents: 7 });
        expect(checked.issue).toBe("Number is not String");
        expect(checked.feedback.issue).toBe(checked.issue);
        expect(checked.feedback.issueDiagnostic?.code).toBe("inference.nominal-mismatch");
        expect(checked.feedback.verdict).toEqual(Nothing);
        expect(checked.feedback.state.$tag).toBe("HintNotMet");
      }
      expect(node).toEqual(before);
    }, 120_000);
    test("reserved-field record construction refuses a missing exact reader route without borrowing a global name", () => {
      const node = record("seven");
      const unavailable = { ...environment, resolveFunctionId: (name: string) => name === "std.fromEntries" ? undefined : environment.resolveFunctionId(name) };
      const options = { expectedType: Anything, registry, evaluateContext: reader };
      expect(draftSaveIssue(node, unavailable, options)).toContain("expression could not be lowered safely");
      const feedback = draftSaveValidation(node, unavailable, options);
      expect(feedback.issueDiagnostic?.code).toBe("authoring-boundary-invalid");
      expect(feedback.verdict).toEqual(Nothing);
      expect(feedback.state.$tag).not.toBe("HintPass");
      expect(() => functionBodySaveIssue(node, declaration, unavailable, { registry, evaluateContext: reader }))
        .toThrow("Record construction is unavailable in this reader");
    }, 120_000);
  });

  test("known final type mismatches are blocked and explain the remaining target", () => {
    expect(draftSaveIssue({ kind: "literal", value: 3 }, env, {
      expectedType: { $ref: "String" }, expectedTypeName: "String",
    })).toContain("Finish with String");
  }, 30_000);

  test("completed values with compatible types can be saved", () => {
    expect(draftSaveIssue({ kind: "literal", value: "hello" }, env, {
      expectedType: { $ref: "String" },
    })).toBeUndefined();
    expect(draftSaveIssue({ kind: "call", fnId: "test:wrap", args: [{ kind: "literal", value: 2 }] }, env, {
      expectedType: maybe,
    })).toBeUndefined();
  });

  test("root and nested null or missing slots cannot be saved", () => {
    for (const value of [null, undefined]) {
      expect(draftSaveIssue({ kind: "literal", value }, env)).toBeDefined();
      expect(draftSaveIssue({ kind: "call", fnId: "test:wrap", args: [{ kind: "literal", value }] }, env)).toBeDefined();
    }
    expect(draftSaveIssue({ kind: "literal", value: { __record: { fields: [{ name: "x", value: { kind: "literal", value: undefined } }] } } }, env)).toBeDefined();
  });

  test("saved references use the caller's current resolver for validation", () => {
    expect(draftSaveIssue({ kind: "ref", savedExprId: "existing" }, env, {
      expectedType: { $ref: "String" },
      resolveSavedExpr: (id) => id === "existing" ? { kind: "literal", value: "hello" } : undefined,
    })).toBeUndefined();
    expect(draftSaveIssue({ kind: "ref", savedExprId: "missing" }, env)).toBeDefined();
  });

  test("an undecided nominal relationship is not mislabeled incompatible", () => {
    expect(draftSaveIssue({ kind: "literal", value: 1 }, env, {
      expectedType: { $ref: "UnknownAccountType" },
    })).toBeUndefined();
  });

  test("literal and computed values satisfy refinements even when their inferred atom type is broad", () => {
    const one: FenelType = { $refined: { base: number, set: { $tag: "SeEnum", values: [1] } } };
    expect(draftSaveIssue({ kind: "literal", value: 1 }, env, { expectedType: one })).toBeUndefined();
    expect(draftSaveIssue({ kind: "literal", value: 2 }, env, { expectedType: one })).toBeDefined();
    expect(draftSaveIssue({ kind: "ref", savedExprId: "one" }, env, {
      expectedType: one,
      resolveSavedExpr: () => ({ kind: "literal", value: 1 }),
      evaluatedValue: 1,
    })).toBeUndefined();
  });

  test("the canonical scalar membership bridge retains true, false and unknown verdicts", () => {
    const radius: FenelType = { $refined: { base: number, set: { $tag: "SeInterval", interval: {
      lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }),
    } } } };
    const judge = literalMembershipFor(env);
    const expected = { quantified: [], body: radius };
    expect(judge(12, expected)).toEqual(Just(true));
    expect(judge(13, expected)).toEqual(Just(false));
    expect(judge(13, { quantified: [], body: { $refined: { base: number, set: { $tag: "SeRef", handle: "UnpublishedRadius" } } } }))
      .toEqual(Nothing);
    expect(judge("13", expected)).toEqual(Just(false));
  });

  test("a refined call argument is refused even when its declared return type accepts the result", () => {
    const radius: FenelType = { $refined: { base: number, set: { $tag: "SeInterval", interval: {
      lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 12, inclusive: true }),
    } } } };
    const param = { ...valueParam, type: radius };
    const scoped = createAuthoringEnvironment({
      types: [], functions: [{
        id: "test:bounded", targetId: "test:bounded", label: "bounded", description: "", kind: "function",
        params: [param], returns: number,
        scheme: { quantified: [], body: { $arrow: { params: [param], returns: number } } },
        signatureOutcome: { $tag: "Solved" },
      }], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    expect(draftSaveIssue({ kind: "call", fnId: "test:bounded", args: [{ kind: "literal", value: 13 }] }, scoped, {
      expectedType: number, evaluatedValue: 13,
    })).toContain("required input type");
    expect(draftSaveIssue({ kind: "call", fnId: "test:bounded", args: [{ kind: "literal", value: 12 }] }, scoped, {
      expectedType: number, evaluatedValue: 12,
    })).toBeUndefined();
  });

  test("concrete value checks do not admit a Number for a Maybe target", () => {
    expect(draftSaveIssue({ kind: "literal", value: 2 }, env, {
      expectedType: maybe, expectedTypeName: "Maybe", evaluatedValue: 2,
    })).toBeDefined();
  });

  test("nested calls must reach the selected constructor owner without needing evaluation", () => {
    const returns: FenelType = { $el: { call: ["Maybe", number] } };
    const scheme: TypeScheme = {
      quantified: [], body: { $arrow: { params: [], returns } },
      applications: [{ path: ["$arrow", "returns"], headRef: "Maybe", args: [number], kind: {
        $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" },
      } }],
      nominals: [{ path: ["$arrow", "returns"], identity: '["system","Maybe"]', publicName: "Maybe" }],
    };
    const scoped = createAuthoringEnvironment({
      types: [{ id: "maybe", name: "Maybe", entityId: "Maybe", type: maybe, description: "", category: "type" }],
      functions: [{
        id: "test:identity", targetId: "test:identity", label: "identity", description: "", kind: "function",
        params: [valueParam], returns: number, signatureOutcome: { $tag: "Solved" },
        scheme: { quantified: [], body: { $arrow: { params: [valueParam], returns: number } } },
      }, {
        id: "Nothing", label: "Nothing", description: "", kind: "constructor", parentEntity: "Maybe",
        params: [], returns, scheme, signatureOutcome: { $tag: "Solved" },
      }],
      capabilities: [], catalogTypes: [maybe], operatorCodeNameByNotation: new Map(),
    });
    expect(draftSaveIssue({ kind: "call", fnId: "test:identity", args: [
      { kind: "call", fnId: "test:identity", args: [{ kind: "literal", value: 3 }] },
    ] }, scoped, { expectedType: { $ref: "Maybe" }, expectedTypeName: "Maybe" })).toContain("Finish with Maybe");
  });
});

describe("original-input refined record admission", () => {
  let registry: ModuleRegistry;
  let reader: EvaluateContext;
  let environment: ReturnType<typeof createAuthoringEnvironment>;
  let judge: ReturnType<typeof literalMembershipFor>;
  const selected = new Map<string, { schema: FenelType; scheme: TypeScheme; ownerIdentity: string }>();
  const strict = { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false };

  beforeAll(() => {
    // Use the existing tooling source-handle constructor and actual source
    // declarations. No fixture UUID, nominal identity or membership hook is
    // manufactured. This is not a generated-owner/Local acceptance claim.
    const source = loadFenelModule(`module OriginalAdmissionProbe where

ExactPair = { left: Int, right: Int } | exactPairValid value
exactPairValid : { left: Int, right: Int } -> Boolean
exactPairValid value = value == { left = value.left, right = value.right }

ExactPairEnvelope = ExactPairEnvelope entry: ExactPair

WidthPair = WidthPair left: Int right: Int
OrderedPair = { left: Int, right: Int } | orderedPairValid value
orderedPairValid : { left: Int, right: Int } -> Boolean
orderedPairValid value = value.left <= value.right

ExtendedPair = { left: Int, right: Int } | not (exactPairValid value)
ExtendedPairEnvelope = ExtendedPairEnvelope entry: ExtendedPair
UndecidedPair = { left: Int, right: Int } | (Nothing)

SiblingRecord = SiblingRecord expected: Int actual: (Int where value == expected)
SiblingEnvelope = SiblingEnvelope expected: Int entry: SiblingRecord
`, "OriginalAdmissionProbe");
    const shadow = loadFenelModule(`module OriginalAdmissionShadow where
orderedPairValid : { left: Int, right: Int } -> Boolean
orderedPairValid value = true
`, "OriginalAdmissionShadow");
    registry = createRepositorySourceRegistry([stdModule, source, shadow]);
    reader = pureEvaluateContext(registry.evaluateContext());
    const names = ["ExactPair", "ExactPairEnvelope", "WidthPair", "OrderedPair", "ExtendedPair", "ExtendedPairEnvelope", "UndecidedPair", "SiblingEnvelope"];
    const entries = names.map(name => {
      const owner = reader._typeFamilyOwner?.(name, moduleSourceCoordinate(source.name));
      if (owner === undefined) throw new Error(`Actual source owner unavailable for ${name}`);
      const declaration = registry.getIdentifiedEntity(owner.identity);
      if (declaration === undefined || declaration.module !== source.name) throw new Error(`Wrong or missing source declaration for ${name}`);
      const schema: FenelType = { $ref: owner.identity };
      const resolved = reader._callSiteTyping?.resolveTypeInDeclaration?.(schema, owner.ownerIdentity);
      if (resolved?.ok !== true) throw new Error(`Actual captured declaration scheme unavailable for ${name}`);
      selected.set(name, { schema, scheme: resolved.type, ownerIdentity: owner.ownerIdentity });
      if (declaration.params?.length) throw new Error(`Fixture declaration ${name} must be monomorphic`);
      return { id: declaration.id, name, description: "Actual source admission control", category: "entity" as const,
        entity: { ...declaration, params: undefined } };
    });
    environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([
      { id: "entity", label: "Original-input controls", description: "Captured source declarations", entries },
    ], { registry }));
    judge = literalMembershipFor(environment, { registry, evaluateContext: reader });
  }, 180_000);

  const captured = (name: string) => {
    const value = selected.get(name);
    if (value === undefined) throw new Error(`Missing captured fixture ${name}`);
    return value;
  };
  const form = (name: string, value: unknown) => validateValue(captured(name).schema, value, null, {
    registry, functions: reader, coerce: false, strict,
  });
  const admission = (name: string, value: unknown) => {
    const plans: unknown[] = [];
    const result = validateValue(captured(name).schema, value, null, {
      registry, functions: reader, coerce: false, strict,
      observeAdmission: fact => plans.push(fact),
    });
    return { result, plans };
  };

  test("exact direct originals reject ordinary and reserved extra keys after whole-scheme abstention", () => {
    for (const original of [{ left: 1, right: 2, note: "retained" }, { $tag: "Pair", left: 1, right: 2 }]) {
      const before = structuredClone(original);
      expect(registry.callSiteTyping.member(captured("ExactPair").scheme, original, null, reader)).toBe("unknown");
      // Normal forms may project the same input; their output is not an
      // original-input membership fact, even with coerce:false.
      const normalized = form("ExactPair", original);
      expect(normalized.valid).toBe(true);
      expect(normalized.value).toEqual({ left: 1, right: 2 });
      expect(judge(original, captured("ExactPair").scheme)).toEqual(Just(false));
      const checked = admission("ExactPair", original);
      expect(checked.result.valid).toBe(false);
      expect(checked.plans.at(-1)).toEqual({ $tag: "ValidationAdmissionMember", verdict: Just(false) });
      expect(original).toEqual(before);
    }
  }, 60_000);

  test("exact nested originals reject ordinary and reserved extra keys at the refined node", () => {
    for (const leaf of [{ left: 1, right: 2, note: "retained" }, { $tag: "Pair", left: 1, right: 2 }]) {
      const original = { entry: leaf };
      const before = structuredClone(original);
      expect(registry.callSiteTyping.member(captured("ExactPairEnvelope").scheme, original, null, reader)).toBe("unknown");
      const normalized = form("ExactPairEnvelope", original);
      expect(normalized.valid).toBe(true);
      expect(normalized.value).toEqual({ entry: { left: 1, right: 2 } });
      expect(judge(original, captured("ExactPairEnvelope").scheme)).toEqual(Just(false));
      expect(original).toEqual(before);
    }
  }, 60_000);

  test("exact valid originals admit in either key order and preserve primitive refusal", () => {
    for (const leaf of [{ left: 1, right: 2 }, { right: 2, left: 1 }]) {
      expect(judge(leaf, captured("ExactPair").scheme)).toEqual(Just(true));
      expect(judge({ entry: leaf }, captured("ExactPairEnvelope").scheme)).toEqual(Just(true));
    }
    const invalid = { left: "1", right: 2 };
    expect(judge(invalid, captured("ExactPair").scheme)).toEqual(Just(false));
    expect(invalid).toEqual({ left: "1", right: 2 });
    // A missing required field must not be admitted. A canonical refusal or
    // the existing unsupported missing-field plan's abstention is legitimate;
    // this repair does not widen that fragment or equate the two verdicts.
    expect([Nothing, Just(false)]).toContainEqual(judge({ left: 1 }, captured("ExactPair").scheme));
    expect([Nothing, Just(false)]).toContainEqual(judge({ entry: { left: 1 } }, captured("ExactPairEnvelope").scheme));
  }, 60_000);

  test("width-allowed records and non-exact refinements retain extra fields as valid originals", () => {
    const original = { right: 2, note: "retained", left: 1 };
    const before = structuredClone(original);
    for (const name of ["WidthPair", "OrderedPair"]) {
      const normalized = form(name, original);
      expect(normalized.valid).toBe(true);
      expect(normalized.value).toEqual({ left: 1, right: 2 });
      expect(judge(original, captured(name).scheme)).toEqual(Just(true));
    }
    expect(original).toEqual(before);
  }, 60_000);

  test("admission checks the original without also demanding its projection satisfy the predicate", () => {
    const leaf = { left: 1, right: 2, note: "required by the authored predicate" };
    for (const [name, original] of [["ExtendedPair", leaf], ["ExtendedPairEnvelope", { entry: leaf }]] as const) {
      const before = structuredClone(original);
      expect(registry.callSiteTyping.member(captured(name).scheme, original, null, reader)).toBe("unknown");
      expect(form(name, original).valid).toBe(false);
      expect(judge(original, captured(name).scheme)).toEqual(Just(true));
      const checked = admission(name, original);
      expect(checked.result.valid).toBe(true);
      expect(checked.result.value).toEqual(original);
      expect(original).toEqual(before);
    }
    expect(judge({ left: 1, right: 2 }, captured("ExtendedPair").scheme)).toEqual(Just(false));
  }, 60_000);

  test("unknown predicates and unavailable declaration authority remain undecided", () => {
    const original = { left: 1, right: 2, note: "retained" };
    expect(judge(original, captured("UndecidedPair").scheme)).toEqual(Nothing);
    const withoutScope = literalMembershipFor(environment, { registry, evaluateContext: {
      ...reader, _typeDeclarationScope: () => undefined,
    } });
    expect(withoutScope(original, captured("ExactPair").scheme)).toEqual(Nothing);
    const scheme = captured("ExactPair").scheme;
    if (!scheme.nominals?.length) throw new Error("Actual nominal authority was not captured");
    const unavailable = { ...scheme, nominals: scheme.nominals.map(nominal => ({
      ...nominal, identity: '["UnavailableAdmissionOwner","ExactPair"]',
    })) };
    expect(judge(original, unavailable)).toEqual(Nothing);
  }, 60_000);

  test("same-named predicates cannot replace the captured source owner", () => {
    const original = { left: 5, right: 2, note: "retained" };
    const actual = registry.getFunction("OriginalAdmissionProbe:orderedPairValid");
    const shadow = registry.getFunction("OriginalAdmissionShadow:orderedPairValid");
    if (actual === undefined || shadow === undefined) throw new Error("Both authored predicate owners must be registered");
    expect(actual.id).not.toBe(shadow.id);
    expect(invokeCallable({ $ref: actual.id }, [original], reader)).toBe(false);
    expect(invokeCallable({ $ref: shadow.id }, [original], reader)).toBe(true);
    expect(judge(original, captured("OrderedPair").scheme)).toEqual(Just(false));
    expect(judge({ left: 1, right: 2 }, captured("OrderedPair").scheme)).toEqual(Just(true));
  }, 60_000);

  test("nested admission retains the current inner sibling scope", () => {
    const good = { expected: 99, entry: { expected: 3, actual: 3 } };
    const bad = { expected: 3, entry: { expected: 99, actual: 3 } };
    const before = structuredClone([good, bad]);
    expect(judge(good, captured("SiblingEnvelope").scheme)).toEqual(Just(true));
    expect(judge(bad, captured("SiblingEnvelope").scheme)).toEqual(Just(false));
    expect([good, bad]).toEqual(before);
  }, 60_000);
});
