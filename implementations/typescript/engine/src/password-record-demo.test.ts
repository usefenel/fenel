import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/password-record-demo.fenel?raw";
import CHECK from "../../../../fenel/modules/publicdemo/check-demo.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { contains } from "./set-algebra";
import { validateWithHints } from "./validation-hints";
import { Just, Nothing } from "./type-foundation";
import type { FenelType } from "./types";
import { parse } from "./fenel-parser";

// Extends ledgered C1: execute source-owned policies and the existing concrete
// membership boundary. No test-local password, ZIP or whole-record checker.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, setExprEntityModule, decidableMembershipModule,
    loadFenelModule(CHECK, "CheckDemo"), loadFenelModule(SOURCE, "PasswordRecordDemo")]);
  context = registry.evaluateContext();
}, 120_000);

function call(name: string, ...args: unknown[]): unknown {
  return invokeCallable({ $ref: `PasswordRecordDemo:${name}` }, args, context);
}
function membership(typeName: string, candidate: unknown): unknown {
  const type: FenelType = registry.getEntity(typeName)!.type;
  if (!("$refined" in type)) throw new Error(`${typeName} must retain its source refinement`);
  return contains(type.$refined.set, candidate, null, undefined, context);
}
type Criterion = { name: string; verdict: unknown; explanation: string };
type Report = { candidate: unknown; criteria: Criterion[]; verdict: unknown; explanation: string };
const valid = "K9$mPx!vR2@nWq";
const credentials = (password = valid, confirm = password) => ({ $tag: "CredentialsDraft", password, confirm });
function order(): Record<string, unknown> {
  return {
    $tag: "NestedOrderDraft",
    customer: { $tag: "OrderExampleCustomer", name: "Alice", country: { $tag: "OrderUnitedStates" } },
    items: [{ $tag: "OrderExampleItem", name: "Notebook", quantity: 2 }],
    shipping: { $tag: "OrderExampleShipping", country: { $tag: "OrderUnitedStates" }, zip: "10001" },
  };
}

describe("Fenel-owned public password and whole-record examples", () => {
  test("input hints use the same captured pure source context as membership", () => {
    const type = registry.getEntity("HardenedExamplePassword")!.type;
    if (!("$refined" in type)) throw new Error("The source password policy must stay refined");
    const pure = pureEvaluateContext(context);
    expect(validateWithHints(valid, type.$refined.set).valid).toBe(false);
    for (const [candidate, accepted] of [[valid, true], ["AAAb1!kcwpmzvq", false], [valid, true]] as const) {
      const hint = validateWithHints(candidate, type.$refined.set, undefined, undefined, pure);
      expect(hint.valid).toBe(accepted);
      expect(hint.constraints.every(criterion => criterion.passed)).toBe(accepted);
      expect(contains(type.$refined.set, candidate, null, undefined, pure)).toEqual(Just(accepted));
    }
    // A replacement reader without the helper must abstain; global functions
    // cannot supply a source definition outside this captured registry.
    const missing: EvaluateContext = { ...pure, getFunction: name => /passwordHardenedAdmitted/.test(name)
      ? undefined : pure.getFunction?.(name) };
    expect(contains(type.$refined.set, valid, null, undefined, missing)).toEqual(Nothing);
    expect(validateWithHints(valid, type.$refined.set, undefined, undefined, missing).valid).toBe(false);
  });
  test("the hint context boundary does not run context-native host callbacks", () => {
    const native = loadFenelModule("module FeedbackSafety where\n@native\nhostCheck : String -> Boolean\n", "FeedbackSafety")
      .functions?.find(fn => fn.id === "FeedbackSafety:hostCheck");
    expect(native).toBeDefined();
    if (!native) throw new Error("The feedback safety fixture must declare its native hostCheck function");
    let hostCalls = 0;
    const raw: EvaluateContext = { ...context,
      getFunction: name => name === "hostCheck" || name === native.id ? native : context.getFunction?.(name),
      nativesCtx: { ...context.nativesCtx, [native.id]: () => { hostCalls++; return true; } },
    };
    const hint = validateWithHints(valid, { $tag: "SeWhere", pred: parse("hostCheck value") }, undefined, undefined, raw);
    expect(hint.valid).toBe(false);
    expect(hostCalls).toBe(0);
  });
  test("the declared whitespace rule matches the current ASCII pattern fragment", () => {
    const ascii = (call("passwordBasicCriteria", `${valid} `) as Criterion[])[0]!;
    expect(ascii.name).toBe("No ASCII whitespace");
    expect(ascii.verdict).toEqual(Just(false));
    for (const space of ["\u00a0", "\u2003"]) {
      const criterion = (call("passwordBasicCriteria", valid + space) as Criterion[])[0]!;
      expect(criterion.name).toBe("No ASCII whitespace");
      expect(criterion.verdict).toEqual(Just(true));
      expect(membership("HardenedExamplePassword", valid + space)).toEqual(Just(true));
    }
  });
  test("source helper composition decides through the same membership proof frame", () => {
    for (const predicate of ["passwordNoRepeatedTriple value", "passwordNoAscendingTriple value", "not (includes (passwordExampleBlocklist ()) value)", "passwordHardenedAdmitted value", "passwordSmartAdmitted value"]) {
      expect(contains({ $tag: "SeWhere", pred: parse(predicate) }, valid, null, undefined, context)).toEqual(Just(true));
    }
    expect(contains({ $tag: "SeWhere", pred: parse("passwordPredicateVerdict Nothing") }, valid, null, undefined, context)).toEqual(Nothing);
  });
  test.each([
    [valid, true], ["Ab1!", false], ["tr0ub4dor&3", false],
    ["AAAb1!kcwpmzvq", false], ["Wq$5mPxyz!vR2n", false],
    ["M0nk3y$ecure!", false], ["Maple!42Stone", true],
    ["Maple!42 Stone", false],
  ])("fixed password %s has actual membership %s", (candidate, accepted) => {
    expect(call("passwordHardenedAdmitted", candidate)).toBe(accepted);
    expect(membership("HardenedExamplePassword", candidate)).toEqual(Just(accepted));
    const report = call("checkHardenedPassword", candidate) as Report;
    expect(report.candidate).toBe(candidate);
    expect(report.verdict).toEqual(Just(accepted));
    expect(report.criteria).toHaveLength(10);
    expect(report.criteria.every(criterion => criterion.explanation.length > 0)).toBe(true);
  });

  test("the alternate consecutive-run policy has a different real outcome", () => {
    expect(call("passwordCountRuns", "")).toBe(0);
    expect(call("passwordCountRuns", "AAAbb")).toBe(2);
    expect(call("passwordCountRuns", "AAAb1!kcwpmzvq")).toBe(12);
    expect(call("passwordNoRepeatedTriple", "AAAb1!kcwpmzvq")).toBe(false);
    expect(call("passwordSmartAdmitted", "AAAb1!kcwpmzvq")).toBe(true);
    expect(membership("SmartExamplePassword", "AAAb1!kcwpmzvq")).toEqual(Just(true));
    expect((call("checkSmartPassword", "AAAb1!kcwpmzvq") as Report).verdict).toEqual(Just(true));
    expect(membership("SmartExamplePassword", "AAAbb1!C")).toEqual(Just(false));
    expect(call("passwordNoRepeatedTriple", "😀😀😀A")).toBe(false);
    expect(call("passwordCountRuns", "😀😀A😀")).toBe(3);
  });

  test.each([["xyz", false], ["XYZ", false], ["123", false], ["xYz", true], ["zyx", true], ["αβγ", true]])(
    "ascending fragment %s obeys the stated ASCII scope", (candidate, accepted) => {
      expect(call("passwordNoAscendingTriple", candidate)).toBe(accepted);
    });

  test("source refinement and criteria agree on whole-record confirmation", () => {
    for (const [candidate, accepted] of [[credentials(), true], [credentials(valid, "different"), false], [credentials("AAAb1!kcwpmzvq"), false]] as const) {
      expect(membership("MatchingCredentials", candidate)).toEqual(Just(accepted));
      const report = call("checkCredentialsRecord", candidate) as Report;
      expect(report.candidate).toEqual(candidate);
      expect(report.verdict).toEqual(Just(accepted));
      expect(report.criteria.at(-1)?.name).toBe("Confirmation matches");
    }
  });

  test.each([["10001", true], ["100", false], ["ABCDE", false], ["12a45", false], ["１２３４５", false], ["10001\n", false]])(
    "US ZIP %s uses five ASCII digits, not five-character length", (zip, accepted) => {
      const candidate = order();
      (candidate.shipping as Record<string, unknown>).zip = zip;
      expect(membership("CheckedNestedOrder", candidate)).toEqual(Just(accepted));
      const report = call("checkNestedOrder", candidate) as Report;
      expect(report.candidate).toEqual(candidate);
      expect(report.verdict).toEqual(Just(accepted));
      expect(report.criteria.at(-1)?.verdict).toEqual(Just(accepted));
    });

  test("every item and whole-record country agreement use the same order", () => {
    const candidate = order();
    (candidate.items as Array<Record<string, unknown>>).push({ $tag: "OrderExampleItem", name: "Pencil", quantity: 0 });
    expect(membership("CheckedNestedOrder", candidate)).toEqual(Just(false));
    (candidate.items as Array<Record<string, unknown>>)[1]!.quantity = 1;
    expect(membership("CheckedNestedOrder", candidate)).toEqual(Just(true));
    (candidate.shipping as Record<string, unknown>).country = { $tag: "OrderFrance" };
    expect(membership("CheckedNestedOrder", candidate)).toEqual(Just(false));
    (candidate.customer as Record<string, unknown>).country = { $tag: "OrderFrance" };
    (candidate.shipping as Record<string, unknown>).zip = "ABCDE";
    expect(membership("CheckedNestedOrder", candidate)).toEqual(Just(true));
    expect((call("checkNestedOrder", candidate) as Report).criteria.at(-1)?.name).toBe("No France postal rule");
  });

  test("undecided criteria remain undecided unless a known refusal decides the conjunction", () => {
    expect(call("passwordConjoin", Nothing, Just(true))).toEqual(Nothing);
    expect(call("passwordConjoin", Just(true), Nothing)).toEqual(Nothing);
    expect(call("passwordConjoin", Nothing, Just(false))).toEqual(Just(false));
    expect(call("passwordPredicateVerdict", Nothing)).toEqual(Nothing);
    expect(call("passwordCriteriaVerdict", [{ $tag: "InputCriterion", name: "unsupported", verdict: Nothing, explanation: "Unknown" }])).toEqual(Nothing);
  });

  test("starting inputs carry ordinary function references and exactly the declared nested shapes", () => {
    const examples = call("passwordRecordDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(examples.map(example => example.function)).toEqual([
      { $ref: "PasswordRecordDemo:checkHardenedPassword" }, { $ref: "PasswordRecordDemo:checkSmartPassword" },
      { $ref: "PasswordRecordDemo:checkCredentialsRecord" }, { $ref: "PasswordRecordDemo:checkNestedOrder" },
    ]);
    expect(examples[2]!.arguments).toEqual([credentials()]);
    const expected = order();
    (expected.shipping as Record<string, unknown>).zip = "ABCDE";
    expect(examples[3]!.arguments).toEqual([expected]);
    for (const example of examples) expect(registry.getFunction(example.function.$ref)?.body).toBeDefined();
  });
});
