import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/check-demo.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { evaluate, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { membershipHints } from "./validation-hints";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { Just, Nothing } from "./type-foundation";
import "./format-presets";

// C1 behavior fixture over the complete source and shipped membership surface.
// No replacement checker, parser, dispatcher or native implementation.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, setExprEntityModule, decidableMembershipModule,
    loadFenelModule(SOURCE, "CheckDemo")]);
  context = registry.evaluateContext();
}, 300_000);

function call(name: string, ...args: unknown[]): Record<string, unknown> {
  return evaluate({ call: [`CheckDemo:${name}`, ...args] }, {}, context) as Record<string, unknown>;
}

describe("source-owned public input checks", () => {
  test.each([
    ["checkEmailInput", "rom@usefenel!.com", "rom@usefenel.com"],
    ["checkDateInput", "25/12/202", "25/12/2025"],
    ["checkUuidInput", "123e4567-e89b-12d3-a456-42661417400", "123e4567-e89b-12d3-a456-426614174000"],
    ["checkQuantityInput", 6, 3],
  ])("%s retains the exact rejected and corrected candidate", (name, invalid, valid) => {
    expect(call(name, invalid)).toMatchObject({ candidate: invalid, verdict: Just(false) });
    expect(call(name, valid)).toMatchObject({ candidate: valid, verdict: Just(true) });
  });

  test("contact fields report independent failures and correct the same structured candidate", () => {
    const wrongEmail = { email: "rom@usefenel!.com", quantity: 3 };
    const wrongQuantity = { email: "rom@usefenel.com", quantity: 6 };
    const corrected = { email: "rom@usefenel.com", quantity: 3 };
    expect(call("checkContactInput", wrongEmail)).toMatchObject({ candidate: wrongEmail,
      email: { verdict: Just(false) }, quantity: { verdict: Just(true) } });
    expect(call("checkContactInput", wrongQuantity)).toMatchObject({ candidate: wrongQuantity,
      email: { verdict: Just(true) }, quantity: { verdict: Just(false) } });
    expect(call("checkContactInput", corrected)).toMatchObject({ candidate: corrected,
      email: { verdict: Just(true) }, quantity: { verdict: Just(true) } });
  });

  test("undecided explanations remain distinct from accepted and rejected membership", () => {
    expect(evaluate({ call: ["CheckDemo:checkDemoExplanation", Nothing] }, {}, context)).toBe("Membership was not decided.");
    expect(evaluate({ call: ["CheckDemo:checkDemoExplanation", Just(true)] }, {}, context)).toContain("belongs");
    expect(evaluate({ call: ["CheckDemo:checkDemoExplanation", Just(false)] }, {}, context)).toContain("does not belong");
  });

  test("source starting inputs contain function values and the declared native email field", () => {
    const inputs = evaluate({ call: ["CheckDemo:checkDemoStartingInputs"] }, {}, context) as Array<{ function: unknown; arguments: unknown[] }>;
    expect(inputs).toHaveLength(7);
    expect(inputs.every(input => typeof input.function === "object" && input.function !== null && "$ref" in input.function)).toBe(true);
    expect(inputs[4]!.arguments).toEqual([{ email: "rom@usefenel!.com", quantity: 6 }]);
    const input = registry.getEntity("CheckContactInput")!.type;
    expect(input).toHaveProperty("$record");
    if (!("$record" in input)) throw new Error("The contact must retain its ordinary typed record");
    expect(input.$record.fields.map(field => [field.name, field.type])).toEqual([
      ["email", { $ref: "CheckEmailInput" }], ["quantity", { $ref: "CheckQuantityInput" }],
    ]);
    expect(registry.getFunction("CheckDemo:checkContactInput")!.body).toBeDefined();
  });

  test("the sign-up types give one live hint per rule, from the source types alone (demo 10)", () => {
    const set = (name: string) => {
      const type = registry.getEntity(name)!.type;
      if (!("$refined" in type)) throw new Error(`${name} must stay a refinement`);
      return type.$refined.set;
    };
    const tags = (value: unknown, name: string) => membershipHints(value, set(name), pureEvaluateContext(context)).rules.map(rule => rule.state.$tag);
    // Six rules (2026-11-12): length, uppercase, digit, special character,
    // no birth year, no character three times in a row.
    expect(membershipHints("abc", set("HintPassword"), pureEvaluateContext(context)).rules.map(rule => rule.label))
      .toEqual(["at least 8 characters", "contains an uppercase letter", "contains a digit",
        "contains a special character", "contains no birth year", "repeats no character three times"]);
    expect(tags("abc", "HintPassword")).toEqual(["HintNotMet", "HintNotMet", "HintNotMet", "HintNotMet", "HintPass", "HintPass"]);
    expect(tags("Secret12", "HintPassword")).toEqual(["HintPass", "HintPass", "HintPass", "HintNotMet", "HintPass", "HintPass"]);
    expect(tags("Abc1987!!!", "HintPassword")).toEqual(["HintPass", "HintPass", "HintPass", "HintPass", "HintNotMet", "HintNotMet"]);
    expect(tags("Secret12!", "HintPassword")).toEqual(["HintPass", "HintPass", "HintPass", "HintPass", "HintPass", "HintPass"]);
    expect(membershipHints("Secret12!", set("HintPassword"), pureEvaluateContext(context)).state.$tag).toBe("HintPass");
    const check = (name: string, text: string) => evaluate({ call: [`CheckDemo:${name}`, text] }, {}, context);
    for (const [text, expected] of [["abc!", true], ["abc 1", false], ["", false], ["a_b", true]] as const)
      expect([text, check("containsASpecialCharacter", text)]).toEqual([text, expected]);
    for (const [text, expected] of [["1987", false], ["12051987", false], ["12/05/1987", false], ["x2019y", false],
      ["1201987", false], ["119201", false], ["1899", true], ["2100", true], ["x201y", true], ["19a87", true], ["", true]] as const)
      expect([text, check("containsNoBirthYear", text)]).toEqual([text, expected]);
    for (const [text, expected] of [["aab", true], ["aaab", false], ["abaa!!!", false], ["", true], ["aabbaa", true]] as const)
      expect([text, check("repeatsNoCharacterThreeTimes", text)]).toEqual([text, expected]);
    expect(tags("test@gmail", "HintEmail")).toEqual(["HintNotYet"]);
    expect(tags("test@gmail?", "HintEmail")).toEqual(["HintBlocked"]);
    expect(tags("https://usefenel", "HintUrl")).toEqual(["HintPass"]);
    expect(tags({ name: "Ada", age: 17 }, "AdultPerson")).toEqual(["HintNotMet"]);
    expect(tags({ name: "Ada", age: 36 }, "AdultPerson")).toEqual(["HintPass"]);
    const draft = registry.getEntity("SignUpDraft")!.type;
    if (!("$record" in draft)) throw new Error("The sign-up draft must stay an ordinary record");
    expect(draft.$record.fields.map(field => field.name)).toEqual(["email", "website", "password", "person"]);
  });

  test("the whole source fits the native parser and agrees with its compatibility oracle", async () => {
    const [{ parseViaFenelParser, PARSE_VIA_FENEL_FAIL }, { parse }] = await Promise.all([
      import("./engine-bodies-dispatch"), import("./fenel-parser"),
    ]);
    const native = parseViaFenelParser(SOURCE, { mode: "build-verification" });
    expect(native).not.toBe(PARSE_VIA_FENEL_FAIL);
    expect(native).toEqual(JSON.parse(JSON.stringify(parse(SOURCE))));
  }, 60_000);
});
