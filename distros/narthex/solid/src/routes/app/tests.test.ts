// C1: run the route's actual fixture and scoring expressions without mounting the full page.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parse } from "@fenel/engine/fenel-parser";
import { contains, type MaybeBool } from "@fenel/engine/set-algebra";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { evaluate, pureEvaluateContext } from "@fenel/engine/expressions";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { decidableMembershipModule } from "@fenel/engine/modules/decidable-membership";
import { regexStringToPattern } from "@fenel/engine/regex-shim";
import { validateWithHints } from "@fenel/engine/validation-hints";
import { Just } from "@fenel/engine/type-foundation";
import { setExprEntityModule } from "../../../../../../implementations/typescript/engine/src/modules/set-expr-entities";
import { publicCheckDemoModule, publicPasswordRecordDemoModule } from "../../../../../../implementations/typescript/engine/src/modules/public-demos";
import type { SetExpr } from "@fenel/engine/types";

await prepareEngineBodyDispatch();

const source = readFileSync(new URL("./tests.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("tests.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
const constraint = declarations.find(declaration => declaration.name.getText(ast) === "UNIQUE_CONTACT_EMAILS");
const cases = declarations.find(declaration => declaration.name.getText(ast) === "TEST_CASES")?.initializer;
if (!constraint?.initializer || !cases || !ts.isArrayLiteralExpression(cases)) throw new Error("Missing contact fixtures");

const ids = ["nest-no-duplicate-emails", "nest-duplicate-emails-rejected", "nest-empty-contact-emails"];
const contactFixtures = cases.elements.filter(element => ts.isObjectLiteralExpression(element) && element.properties.some(property =>
  ts.isPropertyAssignment(property) && property.name.getText(ast) === "id" && ts.isStringLiteral(property.initializer) && ids.includes(property.initializer.text),
));
const fixtureSource = `const UNIQUE_CONTACT_EMAILS = ${constraint.initializer.getText(ast)}; return [${contactFixtures.map(fixture => fixture.getText(ast)).join(",")}];`;
const fixtures = new Function("parseFenel", fixtureSource)(parse) as { id: string; constraint: SetExpr; value: unknown; expected: boolean }[];
const undecidedFixtureNode = cases.elements.find(element => ts.isObjectLiteralExpression(element) && element.properties.some(property =>
  ts.isPropertyAssignment(property) && property.name.getText(ast) === "id" && ts.isStringLiteral(property.initializer) && property.initializer.text === "where-even-fail",
));
if (!undecidedFixtureNode) throw new Error("Missing legacy undecided fixture");
const undecidedFixture = new Function(`return (${undecidedFixtureNode.getText(ast)});`)() as { constraint: SetExpr; value: unknown; expected: boolean };

let matchExpression: string | undefined;
function findScore(node: ts.Node): void {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "match") matchExpression ??= node.initializer.getText(ast);
  ts.forEachChild(node, findScore);
}
findScore(ast);
if (!matchExpression) throw new Error("Missing fixture score expression");
const score = new Function("actual", "tc", `return ${matchExpression};`) as (actual: MaybeBool, tc: { expected: boolean }) => boolean;

type DiagnosticFixture = { id: string; constraint: SetExpr; value: unknown; expected: boolean };
type DiagnosticState = { actual: MaybeBool; criteria: { label: string; verdict: MaybeBool }[] };
const dependencyNames = ["passwordContext", "PW_BASIC", "PW_HARDENED", "PW_SMART", "US_ADDRESS_ZIP"];
const functionNames = ["regexSet", "passwordEvaluationContext", "diagnosticVerdict", "diagnosticState"];
const dependencies = ast.statements.filter(statement =>
  ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.some(declaration => dependencyNames.includes(declaration.name.getText(ast)))
    : ts.isFunctionDeclaration(statement) && !!statement.name && functionNames.includes(statement.name.text),
);
const diagnosticFixtures = cases.elements.filter(element => ts.isObjectLiteralExpression(element) && element.properties.some(property =>
  ts.isPropertyAssignment(property) && property.name.getText(ast) === "id" && ts.isStringLiteral(property.initializer)
    && (property.initializer.text.startsWith("pw-") || property.initializer.text.startsWith("nest-address-zip")),
));
const harnessSource = `${dependencies.map(statement => statement.getText(ast)).join("\n")}
return { fixtures: [${diagnosticFixtures.map(fixture => fixture.getText(ast)).join(",")}], verdict: diagnosticVerdict, state: diagnosticState };`;
const harnessBindings = { parseFenel: parse, contains, evaluate, pureEvaluateContext, createRegistry, stdModule,
  decidableMembershipModule, setExprEntityModule, publicCheckDemoModule, publicPasswordRecordDemoModule,
  regexStringToPattern, validateWithHints, Just };
const diagnostic = new Function(...Object.keys(harnessBindings), new Bun.Transpiler({ loader: "ts" }).transformSync(harnessSource))(
  ...Object.values(harnessBindings),
) as { fixtures: DiagnosticFixture[]; verdict: (fixture: DiagnosticFixture, value: unknown) => MaybeBool;
  state: (fixture: DiagnosticFixture, value: unknown) => DiagnosticState };
const diagnosticFixture = (id: string) => {
  const fixture = diagnostic.fixtures.find(candidate => candidate.id === id);
  if (!fixture) throw new Error(`Missing diagnostic fixture ${id}`);
  return fixture;
};

describe("validator page verdict honesty", () => {
  test("the actual contact fixtures distinguish unique, duplicate and empty lists", () => {
    expect(fixtures.map(fixture => fixture.id)).toEqual(ids);
    for (const fixture of fixtures) {
      const actual = contains(fixture.constraint, fixture.value, null);
      expect(actual).toEqual({ $tag: "Just", _0: fixture.expected });
      expect(score(actual, fixture)).toBe(true);
    }
  });

  test.each([true, false])("an undecided membership cannot match expected %s", expected => {
    const actual = contains({ $tag: "SeRef", handle: "quality-batch-unregistered-membership" }, "example", null);
    expect(actual).toEqual({ $tag: "Nothing" });
    expect(score(actual, { expected })).toBe(false);
  });

  test("the legacy odd-number fixture's abstention does not count as a rejection", () => {
    const actual = contains(undecidedFixture.constraint, undecidedFixture.value, null);
    expect(undecidedFixture.expected).toBe(false);
    expect(actual).toEqual({ $tag: "Nothing" });
    expect(score(actual, undecidedFixture)).toBe(false);
  });

  test.each([true, false])("a definite verdict matches only its own expected result: %s", verdict => {
    const actual: MaybeBool = { $tag: "Just", _0: verdict };
    expect(score(actual, { expected: verdict })).toBe(true);
    expect(score(actual, { expected: !verdict })).toBe(false);
  });
});

describe("actual diagnostic password and ZIP fixtures", () => {
  test("all password and nested ZIP examples receive their expected definite verdict", () => {
    expect(diagnostic.fixtures).toHaveLength(13);
    for (const fixture of diagnostic.fixtures) {
      const actual = diagnostic.verdict(fixture, fixture.value);
      expect(actual).toEqual({ $tag: "Just", _0: fixture.expected });
      expect(score(actual, fixture)).toBe(true);
    }
  });

  test("password bodies remain unavailable in the default membership harness", () => {
    const fixture = diagnosticFixture("pw-hardened-pass");
    expect(contains(fixture.constraint, fixture.value, null)).toEqual({ $tag: "Nothing" });
    expect(diagnostic.verdict(fixture, fixture.value)).toEqual({ $tag: "Just", _0: true });
  });

  test.each(["Wq$5mPxyz!vR2n", "Wq$5mPABC!vR2n", "Wq$5mP123!vR2n"])("the hardened fixture refuses ascending ASCII triples: %s", value => {
    expect(diagnostic.verdict(diagnosticFixture("pw-hardened-pass"), value)).toEqual({ $tag: "Just", _0: false });
  });

  test("edited values update the same source-owned breakdown and preserve the run-policy distinction", () => {
    const fixture = diagnosticFixture("pw-hardened-pass");
    const repeated = "AAAb1!kcwpmzvq";
    const failed = diagnostic.state(fixture, repeated);
    expect(failed.actual).toEqual({ $tag: "Just", _0: false });
    expect(failed.criteria.find(criterion => criterion.label.startsWith("No repeated triple:"))?.verdict).toEqual({ $tag: "Just", _0: false });
    const restored = diagnostic.state(fixture, fixture.value);
    expect(restored.actual).toEqual({ $tag: "Just", _0: true });
    expect(restored.criteria.every(criterion => criterion.verdict.$tag === "Just" && criterion.verdict._0)).toBe(true);
    expect(diagnostic.state(diagnosticFixture("pw-smart-runs-pass"), repeated).actual).toEqual({ $tag: "Just", _0: true });
    const tooFew = diagnostic.state(diagnosticFixture("pw-smart-runs-short"), "AAAAAbbbbb11111!!!!!");
    expect(tooFew.criteria.find(criterion => criterion.label.startsWith("Ten consecutive runs:"))?.verdict).toEqual({ $tag: "Just", _0: false });
  });

  test.each([["Ab1!cd2?E", false], ["Ab1!cd2?Ef", true]] as const)("the smart policy's ten-run boundary: %s", (value, expected) => {
    expect(diagnostic.verdict(diagnosticFixture("pw-smart-runs-pass"), value)).toEqual({ $tag: "Just", _0: expected });
  });

  test.each(["ABCDE", "１２３４５", "12 45", "123456", "1234"])("the US ZIP fixture refuses length-only, non-ASCII and malformed text: %s", zip => {
    const fixture = diagnosticFixture("nest-address-zip-country");
    expect(diagnostic.verdict(fixture, { address: { country: "US", zip } })).toEqual({ $tag: "Just", _0: false });
  });

  test("a repaired ZIP and the unchanged non-US bypass recover through the same diagnostic control", () => {
    const fixture = diagnosticFixture("nest-address-zip-country");
    expect(diagnostic.state(fixture, { address: { country: "US", zip: "ABCDE" } }).actual).toEqual({ $tag: "Just", _0: false });
    expect(diagnostic.state(fixture, { address: { country: "US", zip: "10001" } }).actual).toEqual({ $tag: "Just", _0: true });
    expect(diagnostic.verdict(fixture, { address: { country: "FR", zip: "ABCDE" } })).toEqual({ $tag: "Just", _0: true });
  });

  test("undecided edited membership supplies no Boolean-looking breakdown", () => {
    const state = diagnostic.state(undecidedFixture as DiagnosticFixture, 7);
    expect(state).toEqual({ actual: { $tag: "Nothing" }, criteria: [] });
  });

  test("a source-owned unknown criterion remains unknown beside a decided rejection", () => {
    const fixture = {
      ...diagnosticFixture("pw-hardened-pass"),
      constraint: { $tag: "SeNone" } as SetExpr,
      criteriaExpression: parse('[{ name = "Unresolved criterion", verdict = Nothing, explanation = "No answer" }]'),
    };
    expect(diagnostic.state(fixture, "invented text")).toEqual({
      actual: { $tag: "Just", _0: false },
      criteria: [{ label: "Unresolved criterion: No answer", verdict: { $tag: "Nothing" } }],
    });
  });
});
