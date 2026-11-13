// D7: an owned spelling for the already-shipped universal type. These checks
// deliberately include declared input/result admission; evaluating a solver
// body alone did not detect the public refusal this repair addresses.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./authoring/environment";
import { inferAuthoringExpressionWithLiteralWitnesses, type AuthoringLiteralMembership } from "./authoring/literal-witness";
import { projectAuthoringScheme } from "./authoring/scheme-projection";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "./authoring/signature-authoring";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, moduleSourceCoordinate, type EvaluateContext } from "./json-logic";
import { publicImageDemoModule, publicSolverDemoModule } from "./modules/public-demos";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { stdModule } from "./modules/std";
import { createRegistry, type ModuleRegistry } from "./registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import { Anything, Just, Nothing } from "./type-foundation";
import type { TypeScheme } from "./types";
import { validateValue, type ValidationAdmissionObservation } from "./validate";

let registry: ModuleRegistry;
let context: EvaluateContext;
let missingImportRegistry: ModuleRegistry;
let privateRegistry: ModuleRegistry;

beforeAll(() => {
  const absentProvider = loadFenelModule(`module SolverContractAbsent where
identity : Number -> Number
identity value = value
`, "SolverContractAbsent");
  const missingSelection = loadFenelModule(`module SolverContractMissing where
using SolverContractAbsent (Anything)
identity : Number -> Number
identity value = value
`, "SolverContractMissing");
  // Retain the original six-module reader for the missing-import control.
  missingImportRegistry = createRegistry([
    stdModule, setExprEntityModule, publicSolverDemoModule, publicImageDemoModule,
    absentProvider, missingSelection,
  ], { publishCatalogEntities: false });
  // Use the existing repository fixture contract without manufacturing identities.
  const lock = repositoryIdentityLock();
  registry = createRegistry([
    stdModule, setExprEntityModule, publicSolverDemoModule, publicImageDemoModule,
  ], {
    publishCatalogEntities: false, codeNameLock: lock,
    fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: repositoryIdentityKinds() },
  });
  context = registry.evaluateContext();
  // A separate reader has a real private declaration with the same spelling.
  // Its captured scheme must not turn into system.Anything in the public reader.
  privateRegistry = createRegistry([loadFenelModule(`module SolverContractPrivate where
Anything = PrivateAnything value: String
identity : Anything -> Anything
identity value = value
`, "SolverContractPrivate")], { publishCatalogEntities: false });
}, 300_000);

function declared(name: string, owner = "SolverDemo", current = registry): TypeScheme {
  const resolved = current.callSiteTyping.resolveType({ $ref: name }, moduleSourceCoordinate(owner));
  if (!resolved.ok) throw new Error(`Unresolved ${owner}.${name}: ${resolved.message}`);
  return resolved.type;
}

function slot(name: string, path: string[]): TypeScheme {
  const scheme = registry.getFunctionScheme(`SolverDemo:${name}`);
  if (!scheme) throw new Error(`Missing checked SolverDemo.${name} signature`);
  const projected = projectAuthoringScheme(scheme, path);
  if (!projected) throw new Error(`Missing SolverDemo.${name} slot ${path.join("/")}`);
  return projected;
}

// Compose the existing captured-owner closure and strict original-input
// validation admission boundary, as the public authoring membership path does.
// No local type rule, coerced/projected value, or error-text classification is
// used as evidence. A missing captured owner stays Nothing.
function admission(
  value: unknown, expected: TypeScheme, current = registry,
  observe?: (checked: ReturnType<typeof validateValue>, plans: readonly ValidationAdmissionObservation[]) => void,
) {
  const reader = authoringMembershipEvaluateContext(current.evaluateContext());
  const closed = closeAuthoringMembershipType(expected, reader);
  if (!closed) return Nothing;
  const observations: Array<ReturnType<AuthoringLiteralMembership>> = [];
  const plans: ValidationAdmissionObservation[] = [];
  const checked = validateValue(closed, value, null, {
    registry: current, functions: reader, coerce: false,
    strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
    observeMembership: verdict => observations.push(verdict),
    observeAdmission: plan => plans.push(plan),
  });
  observe?.(checked, plans);
  return authoringValidationMembership(checked, observations, plans);
}

const ref = (name: string) => ({ $ref: `SolverDemo:${name}` });
type Binding = { name: string; value: unknown };
type Solutions = {
  $tag: string;
  answer?: Binding[];
  answers?: Binding[][];
  reason?: string;
  evidence?: { method: string; checked: string; steps: string[]; note: string };
};
const returnPath = ["$arrow", "returns"];

describe("public solver Anything ownership and admission", () => {
  test("the explicit system import selects the existing canonical universal type", () => {
    expect(registry.getIdentifiedEntity("Anything")).toMatchObject({ module: "system", type: Anything });
    const expected = declared("Anything");
    const owner = registry.getEntityNominalIdentity("Anything");
    expect(owner).toBeDefined();
    expect(expected.nominals).toEqual([{ path: [], identity: owner!, publicName: "Anything" }]);
    for (const value of [null, 42, "data", { num: 7, den: 5 }, [1, "two"], ref("ticketsSold")]) {
      expect(admission(value, expected)).toEqual(Just(true));
    }
  }, 180_000);

  test("unknown names and an explicit missing import do not select the universal type", () => {
    for (const name of ["Any", "NotAnAnythingDeclaration"]) {
      expect(registry.callSiteTyping.resolveType({ $ref: name }, moduleSourceCoordinate("SolverDemo")).ok).toBe(false);
    }
    expect(missingImportRegistry.callSiteTyping.resolveType(
      { $ref: "Anything" }, moduleSourceCoordinate("SolverContractMissing"),
    ).ok).toBe(false);
    const forged: TypeScheme = {
      quantified: [], body: { $ref: "Anything" },
      nominals: [{ path: [], identity: '["unavailable-owner","Anything"]', publicName: "Anything" }],
    };
    expect(admission(42, forged)).toEqual(Nothing);
  }, 180_000);

  test("a same-spelled private declaration retains its constraint and refuses a foreign reader", () => {
    const expected = declared("Anything", "SolverContractPrivate", privateRegistry);
    expect(expected.nominals?.[0]?.identity).not.toBe(registry.getEntityNominalIdentity("Anything"));
    expect(admission({ $tag: "PrivateAnything", value: "owned" }, expected, privateRegistry)).toEqual(Just(true));
    expect(admission({ $tag: "PrivateAnything", value: 42 }, expected, privateRegistry)).toEqual(Just(false));
    expect(admission(42, expected, privateRegistry)).toEqual(Just(false));
    expect(admission({ $tag: "PrivateAnything", value: "owned" }, expected)).toEqual(Nothing);
  }, 180_000);

  test("the five public leaves admit their data while typed containers and sibling fields still reject", () => {
    const predicate = slot("solve", ["$arrow", "params", "0", "type"]);
    expect(predicate.nominals?.some(owner => owner.identity === registry.getEntityNominalIdentity("Anything"))).toBe(true);
    expect(admission(ref("ticketsSold"), predicate)).toEqual(Just(true));
    const binding = declared("SolveBinding");
    const domain = declared("SolveDomain");
    for (const value of ["Marseille", 190, { num: 9, den: 1 }, null]) {
      expect(admission({ $tag: "SolveBinding", name: "answer", value }, binding)).toEqual(Just(true));
    }
    expect(admission({ $tag: "ChoicesFor", options: [[1, "two", null, ref("ticketsSold")]] }, domain)).toEqual(Just(true));
    expect(admission({ $tag: "FromFacts", relations: [{ row: "data" }, 42], rules: [null, "data"] }, domain)).toEqual(Just(true));
    for (const value of [
      { $tag: "SolveBinding", name: 42, value: 190 },
    ]) expect(admission(value, binding)).toEqual(Just(false));
    // Strict validation refuses the absent value field. Its unsupported
    // presence evidence remains Nothing at the membership boundary.
    const omittedValue = { $tag: "SolveBinding", name: "answer" };
    const omittedBefore = structuredClone(omittedValue);
    let refusalObserved = false;
    const omittedVerdict = admission(omittedValue, binding, registry, (checked, plans) => {
      refusalObserved = true;
      expect(checked.valid).toBe(false);
      expect(checked.errors.some(error => error.path === "value")).toBe(true);
      expect(plans.some(plan => plan.$tag === "ValidationAdmissionNode" && !plan.supported)).toBe(true);
    });
    expect(refusalObserved).toBe(true);
    expect(omittedVerdict).toEqual(Nothing);
    expect(omittedValue).toStrictEqual(omittedBefore);
    for (const value of [
      { $tag: "ChoicesFor", options: [42] },
      { $tag: "FromFacts", relations: 42, rules: [] },
      { $tag: "FromFacts", relations: [], rules: 42 },
      { $tag: "WholeNumbers", low: "zero", high: 5 },
    ]) expect(admission(value, domain)).toEqual(Just(false));
  }, 180_000);

  test("an ordinary authoring Solve call does not retain the arrow-versus-named refusal", () => {
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], { registry }), { moduleMembers: registry });
    const solve = environment.getFunctionEntry?.("SolverDemo.solve");
    const predicate = environment.getFunctionEntry?.("SolverDemo.ticketsSold");
    if (!solve?.scheme || !predicate?.scheme) throw new Error("Missing shipped Solve or ticketsSold authoring signature");
    expect(solve.signatureOutcome?.$tag).toBe("Solved");
    expect(predicate.signatureOutcome?.$tag).toBe("Solved");
    const inferred = inferAuthoringExpressionWithLiteralWitnesses({
      kind: "call", fnId: solve.id, args: [
        { kind: "literal", value: { $ref: predicate.id } },
        { kind: "literal", value: { $tag: "AllNumbers" } },
      ],
    }, { ...environment, literalMembership: (value, expected) => admission(value, expected) });
    // A documented set-former annotation fence remains honest abstention.
    // Invalid is still a public refusal, even when direct evaluation succeeds.
    expect(inferred.outcome.$tag, JSON.stringify(inferred.outcome)).not.toBe("Invalid");
  }, 180_000);

  test("the public Solve answer is admitted against its captured declared result", () => {
    const result = invokeCallable(ref("solve"), [ref("ticketsSold"), { $tag: "AllNumbers" }], context) as Solutions;
    expect(result.$tag).toBe("OneAnswer");
    expect(Object.fromEntries(result.answer!.map(binding => [binding.name, binding.value]))).toEqual({
      adults: { num: 9, den: 1 }, children: { num: 11, den: 1 },
    });
    const expected = slot("solve", returnPath);
    const before = structuredClone(result);
    expect(admission(result, expected)).toEqual(Just(true));
    expect(result).toEqual(before);
    expect(admission({ ...result, answer: [{ ...result.answer![0], name: 42 }] }, expected)).toEqual(Just(false));
    expect(admission({ ...result, evidence: { ...result.evidence!, steps: 42 } }, expected)).toEqual(Just(false));
    expect(admission({ $tag: "UnregisteredSolution", answer: result.answer }, expected)).toEqual(Just(false));
  }, 180_000);

  test("the train answer closes SolveBinding.value without losing its declared envelope", () => {
    const links = invokeCallable(ref("railLinks"), [0], context);
    const result = invokeCallable(ref("oneChangeTrips"), [
      { $tag: "Paris" }, { $tag: "Nice" }, 360, links,
    ], context) as Solutions;
    expect(result.$tag).toBe("EveryAnswer");
    expect(result.answers!.map(row => Object.fromEntries(row.map(binding => [binding.name, binding.value]))))
      .toEqual([{ change: { $tag: "Marseille" }, first: 190, second: 150 }]);
    const expected = slot("oneChangeTrips", returnPath);
    const before = structuredClone(result);
    expect(admission(result, expected)).toEqual(Just(true));
    expect(result).toEqual(before);
    expect(admission({ ...result, answers: [42] }, expected)).toEqual(Just(false));
    expect(admission({ ...result, answers: [[{ name: 42, value: "Marseille" }]] }, expected)).toEqual(Just(false));
  }, 180_000);

  test("a solver fragment refusal remains an admitted Unknown answer with its reason", () => {
    const result = invokeCallable(ref("solve"), [ref("circleOfRadiusFive"), { $tag: "AllNumbers" }], context) as Solutions;
    expect(result.$tag).toBe("UnknownAnswer");
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
    const expected = slot("solve", returnPath);
    expect(admission(result, expected)).toEqual(Just(true));
    expect(admission({ ...result, reason: 42 }, expected)).toEqual(Just(false));
  }, 180_000);
});
