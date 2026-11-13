// Demo 10 (2026-11-08) — refinement types as live UI hints.
//
// One hint per refinement rule, derived from the type alone: the Fenel
// `engine:refinementConjuncts` splits the set, the existing Tri `contains`
// and the Fenel `regexHint` cursor judge each rule, and the Fenel
// `engine:refinementRuleHints` names its state. Extends ledgered C1: these
// fixtures execute source-owned types through the shipped judgment; no
// test-local checker.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { contains } from "./set-algebra";
import { validateWithHints, type RuleHint, type MembershipHints } from "./validation-hints";
import * as validationHints from "./validation-hints";
import { patternToRegex } from "./regex-shim";

// Read through the namespace so a tree without the API fails per test (red
// runs), not at module link.
const membershipHints = (value: unknown, set: SetExpr, ctx?: EvaluateContext): MembershipHints =>
  (validationHints as unknown as { membershipHints: (v: unknown, s: SetExpr, c?: EvaluateContext) => MembershipHints })
    .membershipHints(value, set, ctx);
import { buildSetExpr } from "./set-marker";
import { parse } from "./fenel-parser";
import { dispatchEngineBody, harnessForTests } from "./engine-bodies-dispatch";
import { Just, Nothing } from "./type-foundation";
import type { FenelType, SetExpr } from "./types";
import "./format-presets";

const SOURCE = `module HintProbe where

HintPassword = String | value ∈ /^.{8,}$/ ∩ /[A-Z]/ ∩ /[0-9]/ ∩ /^\\S*$/

CommaRules = String | length value >= 8 && value != "password" && length value <= 64

AdultAge = Number | value ∈ [18..150]

HintPerson = HintPerson name: String age: Number

AdultPerson = HintPerson | value.age >= 18

IncompatibleGrowing = String | value ∈ /^a[0-9]$/ ∩ /^a[A-Z]$/

PassingButIncompatible = String | value ∈ /^a$/ ∩ /^ab$/
`;

let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  // The probe source parses its regex set literals through the engine harness.
  harnessForTests();
  registry = createRegistry([stdModule, setExprEntityModule, decidableMembershipModule, loadFenelModule(SOURCE, "HintProbe")]);
  context = pureEvaluateContext(registry.evaluateContext());
  // Shapes, for the lane report.
  for (const name of ["HintPassword", "CommaRules", "AdultAge", "AdultPerson"]) {
    const t = registry.getEntity(name)?.type as { $refined?: { set: unknown } } | undefined;
    console.log(`shape ${name}: ${JSON.stringify(t?.$refined?.set)}`);
  }
  const pw = (registry.getEntity("HintPassword")!.type as { $refined: { set: { branches: Array<{ pattern: unknown }> } } }).$refined.set;
  for (const b of pw.branches) console.log(`regex of branch: ${patternToRegex(b.pattern as never)}`);
}, 300_000);

function refinedSet(name: string): SetExpr {
  const type: FenelType = registry.getEntity(name)!.type;
  if (!("$refined" in type)) throw new Error(`${name} must be a refinement`);
  return type.$refined.set;
}
function rules(value: unknown, set: SetExpr): RuleHint[] {
  return membershipHints(value, set, context).rules;
}
const states = (value: unknown, set: SetExpr) => rules(value, set).map(rule => `${rule.label}: ${rule.state.$tag}`);

describe("item 0 — the demo's refinement forms parse as type definitions", () => {
  test("an intersection of four patterns stays four branches", () => {
    const set = refinedSet("HintPassword") as { $tag: string; branches?: unknown[] };
    expect(set.$tag).toBe("SeIntersect");
    expect(set.branches).toHaveLength(4);
  });
  test("a type definition takes && rules (calls of and); the comma form is for signatures only", () => {
    const set = refinedSet("CommaRules") as { $tag: string; pred?: { call?: unknown[] } };
    expect(set.$tag).toBe("SeWhere");
    expect(set.pred?.call?.[0]).toBe("and");
    expect(() => parse("X = String where length value >= 8, value != \"password\"")).toThrow();
    const signature = parse("sample : (String where length value >= 8, value != \"password\") -> String") as unknown;
    expect(JSON.stringify(signature)).toContain('"and":[');
  });
  test("an age interval is a numeric refinement", () => {
    expect(contains(refinedSet("AdultAge"), 17, null, undefined, context)).toEqual(Just(false));
    expect(contains(refinedSet("AdultAge"), 18, null, undefined, context)).toEqual(Just(true));
  });
});

describe("item 1 — the email hint and the email check are one definition", () => {
  const email = buildSetExpr.ref("format:email");
  const corpus = [
    "a@b.c", "a@b.12", "test@gmail.com", "rom@usefenel.com", "first.last@sub.example.org", "x+tag@example.co",
    "o'brien@example.ie", "a?b@example.com", "a@b", "test@gmail", "@example.com", "a@", "a@@b.com", "a@b..com",
    "a@-b.com", "a@b-.com", "a@b.c-", "a@b.c.", "rom@usefenel!.com", "rom@usefenel?", "a b@c.com", "a@b c.com",
    "a@b_c.com", "a@1.2.3.4", "a@xn--bcher-kva.example", "", "a", "@", "a@b.com.", ".a@b.com", "a.@b.com",
    `a@${"x".repeat(63)}.com`, `a@${"x".repeat(64)}.com`, `a@b.${"y".repeat(63)}`, `a@b.${"y".repeat(64)}`,
    "UPPER@EXAMPLE.COM", "digits123@456.789", "a@b.c.d.e.f", "üser@example.com", "a@exämple.com",
  ];
  test.each(corpus)("%s: the hint accepts exactly what the check accepts", (candidate) => {
    const verdict = contains(email, candidate, null, undefined, context);
    expect(verdict.$tag).toBe("Just");
    const cursor = validateWithHints(candidate, email).cursor;
    expect(cursor?.canEnd ?? false).toBe((verdict as { _0: boolean })._0);
  });
  test("the short top-level domains the check accepts are not shown as incomplete", () => {
    for (const candidate of ["a@b.c", "a@b.12"]) {
      expect(validateWithHints(candidate, email).cursor).toMatchObject({ canMatch: true, canEnd: true });
    }
  });
  test("a 64-character domain label is refused by both, at the 64th character", () => {
    const candidate = `a@${"x".repeat(64)}.com`;
    expect(contains(email, candidate, null, undefined, context)).toEqual(Just(false));
    expect(validateWithHints(candidate, email).cursor?.canMatch).toBe(false);
  });
});

describe("item 2 — one hint per rule, five honest states", () => {
  test("a short password: the length, uppercase and digit rules are not yet met, no spaces passes", () => {
    expect(states("abc", refinedSet("HintPassword"))).toEqual([
      "at least 8 characters: HintNotYet",
      "contains uppercase letter: HintNotYet",
      "contains digit: HintNotYet",
      "no spaces: HintPass",
    ]);
  });
  test("a space blocks the no-spaces rule at once; the others keep their own state", () => {
    expect(states("Abc defgh1", refinedSet("HintPassword"))).toEqual([
      "at least 8 characters: HintPass",
      "contains uppercase letter: HintPass",
      "contains digit: HintPass",
      "no spaces: HintBlocked",
    ]);
  });
  test("each rule flips as the password is typed key by key", () => {
    const set = refinedSet("HintPassword");
    const typed = "Secret12";
    const pass = (value: string) => rules(value, set).map(rule => rule.state.$tag === "HintPass");
    expect(pass(typed.slice(0, 1))).toEqual([false, true, false, true]);
    expect(pass(typed.slice(0, 7))).toEqual([false, true, true, true]);
    expect(pass(typed)).toEqual([true, true, true, true]);
    expect(validateWithHints(typed, set, undefined, undefined, context).valid).toBe(true);
  });
  test("&& rules and comma rules split into one hint each, with plain labels", () => {
    const hinted = rules("pass", refinedSet("CommaRules"));
    expect(hinted).toHaveLength(3);
    expect(hinted.map(rule => rule.state.$tag)).toEqual(["HintNotMet", "HintPass", "HintPass"]);
    expect(hinted.map(rule => rule.label)).toEqual(["at least 8 characters", "≠ \"password\"", "at most 64 characters"]);
    const comma: SetExpr = { $tag: "SeWhere", pred: { and: [
      { call: ["gte", { call: ["length", { var: "value" }] }, 8] }, { call: ["containsADigit", { var: "value" }] }] } };
    expect(rules("pass", comma).map(rule => rule.label)).toEqual(["at least 8 characters", "contains a digit"]);
  });
  test("an undecided rule is Unknown, never Not met", () => {
    const undecided: SetExpr = { $tag: "SeWhere", pred: { call: ["hintProbeMissingFunction", { var: "value" }] } };
    expect(contains(undecided, "abc", null, undefined, context).$tag).toBe("Nothing");
    const set: SetExpr = { $tag: "SeIntersect", branches: [undecided, buildSetExpr.ref("format:email")] };
    const hinted = rules("abc", set);
    expect(hinted.map(rule => rule.state.$tag)).toEqual(["HintUnknown", "HintNotYet"]);
  });
  test("email: incomplete is Not yet, a bad character after the @ is Blocked at its position, complete passes", () => {
    const email: SetExpr = buildSetExpr.ref("format:email");
    expect(rules("test@gmail", email).map(rule => rule.state.$tag)).toEqual(["HintNotYet"]);
    const bad = rules("test@gmail?", email)[0]!;
    expect(bad.state.$tag).toBe("HintBlocked");
    expect((bad.cursor as { failedAt?: { position: number } }).failedAt?.position).toBe(10);
    expect(rules("test@gmail?", email)[0]!.cursor).toBeDefined();
    expect(rules("test@gmail.com", email).map(rule => rule.state.$tag)).toEqual(["HintPass"]);
    // `?` is legal before the @ (RFC atext): not blocked there.
    expect(rules("te?st", email).map(rule => rule.state.$tag)).toEqual(["HintNotYet"]);
  });
  test("a registered pattern (structured URL, and now format:url itself) is exact", () => {
    const structured: SetExpr = buildSetExpr.ref("format:url:structured");
    expect(rules("https://", structured)[0]!.state.$tag).toBe("HintNotYet");
    expect(rules("https://exa", structured)[0]!.state.$tag).toBe("HintPass"); // a host needs no dot in this format
    expect(rules("https://exa mple.com", structured)[0]!.state.$tag).toBe("HintBlocked");
    const plain: SetExpr = buildSetExpr.ref("format:url");
    expect(rules("javascript:", plain)[0]!.state.$tag).toBe("HintBlocked");
    expect(rules("https://example.com", plain)[0]!.state.$tag).toBe("HintPass");
  });
  test("entry lane 2's pattern-viability cases, now through the one path (format:phone:e164)", () => {
    // Was distros/.../field-renderer/pattern-viability.ts (a second derivative
    // walk for the simple form's error marks); unified onto membershipHints.
    const phone: SetExpr = buildSetExpr.ref("format:phone:e164");
    const tag = (value: string) => membershipHints(value, phone, context).state.$tag;
    expect(tag("+1415")).toBe("HintNotYet");
    expect(tag("+")).toBe("HintNotYet");
    expect(tag("+1?")).toBe("HintBlocked");
    expect(tag("x")).toBe("HintBlocked");
    expect(tag("+14155552671")).toBe("HintPass");
  });
  test("a number below an age bound is Not met (no growth promise for numbers)", () => {
    expect(states(17, refinedSet("AdultAge"))).toEqual(["≥ 18 and ≤ 150: HintNotMet"]);
    expect(states(18, refinedSet("AdultAge"))).toEqual(["≥ 18 and ≤ 150: HintPass"]);
  });
  test("a union is one hint; a complement is one hint", () => {
    const union: SetExpr = { $tag: "SeUnion", branches: [buildSetExpr.ref("format:email"), buildSetExpr.ref("format:uuid")] };
    expect(rules("abc", union)).toHaveLength(1);
    const complement: SetExpr = { $tag: "SeComplement", inner: buildSetExpr.ref("format:email") };
    expect(rules("abc", complement).map(rule => rule.state.$tag)).toEqual(["HintPass"]);
  });
  test("the whole value preserves membership and does not infer a common extension from separate rules", () => {
    const set = refinedSet("HintPassword");
    expect(membershipHints("abc", set, context).state.$tag).toBe("HintNotMet");
    expect(membershipHints("Abc defgh1", set, context).state.$tag).toBe("HintBlocked");
    expect(membershipHints("Secret12", set, context).state.$tag).toBe("HintPass");
    expect(membershipHints("pass", refinedSet("CommaRules"), context).state.$tag).toBe("HintNotMet");
  });
  test("individually extendable patterns need not admit any common extension", () => {
    const result = membershipHints("a", refinedSet("IncompatibleGrowing"), context);
    expect(result.rules.map(rule => rule.state.$tag)).toEqual(["HintNotYet", "HintNotYet"]);
    expect(result.state.$tag).toBe("HintNotMet");
    const passing = membershipHints("a", refinedSet("PassingButIncompatible"), context);
    expect(passing.rules.map(rule => rule.state.$tag)).toEqual(["HintPass", "HintNotYet"]);
    expect(passing.state.$tag).toBe("HintNotMet");
    // One exact rule is the whole predicate and can prove its extension.
    expect(membershipHints("test@gmail", buildSetExpr.ref("format:email"), context).state.$tag).toBe("HintNotYet");
  });
  test("whole-state aggregation preserves Unknown and makes no empty or duplicate-rule growth promise", () => {
    const input = { id: "one", label: "one", source: Nothing, verdict: Just(false), exact: true,
      cursor: Just({ canEnd: false, canMatch: true }) };
    const whole = (verdict: unknown, inputs: unknown[]) =>
      (dispatchEngineBody("engine:membershipHints", [verdict, inputs]) as MembershipHints).state.$tag;
    expect(whole(Nothing, [input])).toBe("HintUnknown");
    expect(whole(Just(false), [])).toBe("HintNotMet");
    expect(whole(Just(true), [])).toBe("HintPass");
    expect(whole(Just(false), [input])).toBe("HintNotYet");
    expect(whole(Just(false), [input, { ...input, id: "duplicate" }])).toBe("HintNotMet");
    expect(whole(Just(false), [{ ...input, verdict: Nothing }])).toBe("HintNotMet");
  });
  test("a structured URL's named groups are the rule's parts, each with its own state", () => {
    const structured: SetExpr = buildSetExpr.ref("format:url:structured");
    const rule = rules("https://example", structured)[0]!;
    expect(rule.parts.map(part => part.name)).toContain("scheme");
    expect(rule.parts.find(part => part.name === "scheme")!.state.$tag).toBe("HintPass");
    const blocked = rules("https://exa mple.com", structured)[0]!;
    expect(blocked.parts.some(part => part.state.$tag === "HintBlocked")).toBe(true);
  });
  test("a record-level rule hints on the whole record", () => {
    const adult = refinedSet("AdultPerson");
    expect(rules({ $tag: "HintPerson", name: "Ada", age: 17 }, adult)[0]!.label).toBe("age ≥ 18");
    expect(membershipHints({ $tag: "HintPerson", name: "Ada", age: 17 }, adult, context).state.$tag).toBe("HintNotMet");
    expect(membershipHints({ $tag: "HintPerson", name: "Ada", age: 36 }, adult, context).state.$tag).toBe("HintPass");
  });
  test("validateWithHints is unchanged for its old callers", () => {
    const set = refinedSet("HintPassword");
    const plain = validateWithHints("abc", set, undefined, undefined, context);
    expect(plain).not.toHaveProperty("rules");
    expect(plain.valid).toBe(false);
    expect(plain.constraints).toHaveLength(4);
  });
  test("per-keystroke cost of the rule hints stays small", () => {
    const set = refinedSet("HintPassword");
    const typed = "Secret12 x";
    const started = performance.now();
    for (let i = 1; i <= typed.length; i++) rules(typed.slice(0, i), set);
    const perKey = (performance.now() - started) / typed.length;
    console.log(`refinement hints: ${perKey.toFixed(1)} ms per keystroke (password, 4 rules)`);
    const email = buildSetExpr.ref("format:email");
    const emailTyped = "rom@usefenel.com";
    const emailStarted = performance.now();
    for (let i = 1; i <= emailTyped.length; i++) rules(emailTyped.slice(0, i), email);
    console.log(`refinement hints: ${((performance.now() - emailStarted) / emailTyped.length).toFixed(1)} ms per keystroke (email)`);
    expect(perKey).toBeLessThan(2000);
  });
});
