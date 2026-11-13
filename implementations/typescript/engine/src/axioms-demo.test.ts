// C1: source/default execution through the existing evaluator and judgment.
// The actual public A4 forwards enter the existing engine bodies and add no rule.
import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/axioms-demo.fenel?raw";
import { evaluateWithTrace, invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { createRepositoryRegistry } from "./repository-registry";
import { stdModule } from "./modules/std";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { publicAxiomsDemoModule, publicCheckDemoModule, publicClaimsDemoModule, publicEncyclopediaDemoModule, publicGreekAlphabetDemoModule } from "./modules/public-demos";
import { proverModule } from "./modules/prover";
import { dispatchEngineBody, withInterpretedResolver } from "./engine-bodies-dispatch";
import { Just, Nothing } from "./type-foundation";
import { peelSetExpr } from "./set-marker";
import { repositoryIdentityLock, repositoryTypeIdentity } from "./repository-identity-manifest";
import { validateValue } from "./validate";
import type { FenelType } from "./types";

let registry: ModuleRegistry;
let context: EvaluateContext;
let defaults: Array<{ function: { $ref: string }; arguments: unknown[] }>;

function call(name: string, ...args: unknown[]): any {
  return withInterpretedResolver(() => invokeCallable({ $ref: `AxiomsDemo:${name}` }, args, context));
}

function success(name: string, ...args: unknown[]): any {
  const result = call(name, ...args);
  expect(result.$tag).toBe("Ok");
  return result._0;
}

function starting(name: string): unknown[] {
  const row = defaults.find(row => row.function.$ref === `AxiomsDemo:${name}`);
  if (!row) throw new Error(`Missing source-owned starting inputs for ${name}`);
  return row.arguments;
}

beforeAll(() => withInterpretedResolver(() => {
  const evidenceTypes = { ...proverModule, functions: [], functionSignatureDeclarations: [], functionNamespaceOverrides: [], instances: [], nativeImpls: {}, nativeImplsCtx: {} };
  registry = createRegistry([stdModule, setExprEntityModule, decidableMembershipModule, evidenceTypes,
    publicCheckDemoModule, publicClaimsDemoModule, publicEncyclopediaDemoModule, publicGreekAlphabetDemoModule, publicAxiomsDemoModule]);
  context = registry.evaluateContext();
  defaults = call("axiomsDemoStartingInputs");
// Shared-host cold registry initialization exceeded 60s while support/build
// jobs ran. Raise that hook's budget only; behavior assertions stay unchanged.
}), 180_000);

describe("seven source-owned floor families", () => {
  test("the shipped module retains the source and every declared default argument", () => {
    expect(SOURCE).toContain("module AxiomsDemo where");
    for (const row of defaults) {
      const fn = registry.getFunction(row.function.$ref)!;
      expect(row.arguments.length).toBe(fn.params.length);
    }
  });
  test("every family is assumed inspectable data with callable examples and no certificate", () => {
    const families = call("axiomsFamilies");
    expect(families).toHaveLength(7);
    expect(new Set(families.map((family: any) => family.title)).size).toBe(7);
    for (const family of families) {
      expect(family.basis.evidence).toEqual({ $tag: "Assumed" });
      expect(family.basis.certificate).toEqual(Nothing);
      expect(family.basis.kernelVerdict).toEqual(Nothing);
      expect(family.basis.definition.$ref).toStartWith("AxiomsDemo:");
      expect(family.canonicalSource).toContain("floor-kernel.md, section 3.2");
      expect(family.fragment.length).toBeGreaterThan(40);
      for (const example of family.examples) {
        expect(example.function).toHaveProperty("$ref");
        expect(registry.getFunction(example.function.$ref)).toBeDefined();
        expect(Array.isArray(example.arguments)).toBe(true);
      }
    }
  });

  test("all seven starting examples execute their actual source bodies", () => {
    expect(defaults).toHaveLength(7);
    for (const row of defaults) {
      const result = withInterpretedResolver(() => invokeCallable(row.function, row.arguments, context)) as any;
      expect(result).toBeDefined();
      expect(result.$tag).not.toBe("Err");
      expect(result.__fenelPartial).toBeUndefined();
    }
  });
});

describe("concrete set and arrow judgments", () => {
  test("concrete law data reuses the original engine claim type and its repository field identities", () => {
    const canonical = registry.getEntity("FloorLawClaim")!;
    expect(canonical).toBeDefined();
    const identityRegistry = withInterpretedResolver(() => createRepositoryRegistry([stdModule, setExprEntityModule]));
    const originalIdentity = repositoryTypeIdentity("engine", "FloorLawClaim");
    expect(originalIdentity).toBeDefined();
    expect(identityRegistry.getEntity(originalIdentity!)!.type).toEqual(canonical.type);
    expect(identityRegistry.getEntityNominalIdentity("FloorLawClaim"))
      .toBe(identityRegistry.getEntityNominalIdentity(originalIdentity!));
    expect(identityRegistry.getEntity("FloorLawClaim")!.type).toEqual(canonical.type);
    const identities = identityRegistry.listFieldIdentities().filter(identity => identity.owner.$tag === "TypeFieldOwner"
      && identity.owner.localId === "FloorLawClaim" && identity.owner.module.$tag === "Just"
      && identity.owner.module._0 === "engine");
    expect(identities.map(identity => identity.sourceField.name).sort()).toEqual(["lhs", "name", "rhs"]);
    const lock = repositoryIdentityLock();
    for (const identity of identities) {
      expect(identity.field.key?.$tag).toBe("NamedField");
      if (identity.field.key?.$tag !== "NamedField" || !identity.lockName) throw new Error("The canonical field lost its identity.");
      const locked = lock.get(identity.lockName);
      if (locked === undefined) throw new Error("The canonical field lost its identity lock entry.");
      expect(identity.field.key.ref.$ref).toBe(locked);
    }
    for (const name of ["axiomsLawDiffDef", "axiomsLawDeMorgan", "axiomsLawIdempotent", "axiomsLawSingletonUnion"]) {
      expect(registry.getFunction(`AxiomsDemo:${name}`)!.returns).toEqual({ $ref: "FloorLawClaim" });
    }
    const result = success("axiomsLattice", ...starting("axiomsLattice"));
    const identified = identityRegistry.getIdentifiedEntity("FloorLawClaim")!;
    const baseline = dispatchEngineBody("engine:lawDiffDef", [
      { $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [2, 3] },
    ]);
    expect(result.law.claim).toEqual(baseline);
    // GLOBAL_ONLY: closed repository-source fixture, without account data or IO.
    const actualValidation = withInterpretedResolver(() => validateValue(identified.type, result.law.claim, null,
      { registry: identityRegistry, coerce: false }));
    const baselineValidation = withInterpretedResolver(() => validateValue(identified.type, baseline, null,
      { registry: identityRegistry, coerce: false }));
    expect(actualValidation).toEqual(baselineValidation);
    expect(actualValidation.valid).toBe(false);
    expect(actualValidation.errors).toEqual([{ path: "", message: "The engine could not decide membership for this type and value" }]);
  });

  test("finite enumeration, candidate membership and floor-law faces remain distinct", () => {
    const result = success("axiomsLattice", ...starting("axiomsLattice"));
    expect(result.union.members).toEqual([1, 2, 3]);
    expect(result.intersection.members).toEqual([2]);
    expect(result.complement.members).toEqual([0, 3]);
    expect(result.difference.members).toEqual([1]);
    expect(result.union.membership).toEqual(Just(true));
    expect(result.intersection.membership).toEqual(Just(true));
    expect(result.complement.membership).toEqual(Just(false));
    expect(result.difference.membership).toEqual(Just(false));
    expect(result.law.claim.$tag).toBe("FloorLawClaim");
    expect(result.law.bySubset).toEqual(Just(true));
    expect(result.law.byEmpty).toEqual(Just(true));
    const outsideEnumeration = success("axiomsLattice", [1], [2], [0, 1], 4, { $tag: "DifferenceDefinition" });
    expect(outsideEnumeration.complement.members).toEqual([0]);
    expect(outsideEnumeration.complement.membership).toEqual(Just(true));
    const changed = success("axiomsLattice", [1], [2], [1, 2], 2, { $tag: "DeMorganIntersection" });
    expect(changed.intersection.membership).toEqual(Just(false));
    expect(changed.law.byEmpty).toEqual(Just(true));
    expect(call("axiomsLattice", [21], [], [], 1, { $tag: "UnionIdempotence" }).$tag).toBe("Err");
  });

  test("singleton equality and the real finite picker use the shared membership judgment", () => {
    const before = success("axiomsSingleton", ...starting("axiomsSingleton"));
    expect(before.membership).toEqual(Just(true));
    expect(before.pickerMembership).toEqual(Just(true));
    expect(before.decomposition.byEmpty).toEqual(Just(true));
    const changed = success("axiomsSingleton", "Alpha", "Beta", ["Alpha", "Beta"]);
    expect(changed.membership).toEqual(Just(false));
    expect(changed.pickerMembership).toEqual(Just(true));
    expect("$refined" in changed.pickerType).toBe(true);
    expect(peelSetExpr(changed.pickerType.$refined.set)).toEqual({ kind: "SeEnum", values: ["Alpha", "Beta"] });
    expect(call("axiomsSingleton", "long".repeat(6), "Alpha", []).$tag).toBe("Err");
  });

  test("finite arrow variance and non-callable refusal execute the real judgment", () => {
    const result = success("axiomsArrow", [1, 2], [1, 2], { $tag: "PlainNumber" });
    expect(result.variance).toEqual(Just(true));
    expect(result.reverseVariance).toEqual(Just(false));
    expect(result.membership).toEqual(Just(false));
    expect(result.emptyReturnMembership).toEqual(Just(false));
    const dependent = success("axiomsArrow", [1, 2], [1, 2], { $tag: "DependentChoice" });
    expect(dependent.membership).toEqual(Nothing);
    const emptyDomain = success("axiomsArrow", [], [1], { $tag: "PlainNumber" });
    expect(emptyDomain.membership).toEqual(Just(false));
    expect(call("axiomsArrow", [21], [], { $tag: "ExistingFloor" }).$tag).toBe("Err");
  });

  test("a real closed source lambda accepts and refuses edited finite codomains without bypassing the registered-signature fence", () => {
    const result = success("axiomsArrow", ...starting("axiomsArrow"));
    expect(result.callable).toHaveProperty("__fenelFn", true);
    expect(result.callable.body).toBe(1);
    expect(result.membership).toEqual(Just(true));
    expect(result.emptyReturnMembership).toEqual(Nothing);
    expect(success("axiomsArrow", [1, 2], [2], { $tag: "SourceConstant" }).membership).toEqual(Just(false));
    expect(success("axiomsArrow", [1, 2], [1], { $tag: "SourceConstant" }).membership).toEqual(Just(true));
    const registered = success("axiomsArrow", [1, 2], [1, 2], { $tag: "ExistingFloor" });
    expect(registered.callable).toHaveProperty("$ref", "std:floor");
    expect(registered.membership).toEqual(Nothing);
    expect(registered.emptyReturnMembership).toEqual(Nothing);
  });
});

describe("recursive, dependent and reflected data", () => {
  test("ordinary List editing checks the canonical positional spine and preserves the unguarded unknown", () => {
    const result = success("axiomsRecursion", ...starting("axiomsRecursion"));
    expect(result.data).toEqual([1, 2]);
    expect(result.pureList).toEqual({ $tag: "Cons", _0: 1, _1: { $tag: "Cons", _0: 2, _1: { $tag: "Nil" } } });
    expect(result.constraint.$tag).toBe("SeMu");
    expect(result.unfolded.$tag).toBe("SeUnion");
    expect(result.positive).toBe(true);
    expect(result.guarded).toBe(true);
    expect(result.membership).toEqual(Just(true));
    expect(success("axiomsRecursion", [1, 2], [1, 3], { $tag: "GuardedList" }).membership).toEqual(Just(false));
    expect(success("axiomsRecursion", [1, 2], [], { $tag: "GuardedList" }).membership).toEqual(Just(true));
    const unknown = success("axiomsRecursion", [1, 2], [1, 2], { $tag: "UnguardedReference" });
    expect(unknown.positive).toBe(true);
    expect(unknown.guarded).toBe(false);
    expect(unknown.membership).toEqual(Nothing);
    expect(call("axiomsRecursion", [1], Array(9).fill(1), { $tag: "GuardedList" }).$tag).toBe("Err");
  });

  test("the real $el input changes with the earlier alphabet selection", () => {
    const fn = registry.getFunction("AxiomsDemo:axiomsDependency")!;
    const dependentType = fn.params[1]!.type;
    if (!("$el" in dependentType)) throw new Error("The source lost its actual dependent input.");
    for (const [selection, included, excluded] of [["UppercaseGreek", "Α", "α"], ["LowercaseGreek", "α", "Α"]]) {
      const input = { selection: { $tag: selection } };
      const type = withInterpretedResolver(() => evaluateWithTrace(dependentType.$el, input, context).result) as FenelType;
      if (!("$refined" in type)) throw new Error("The dependent input did not retain its finite type.");
      const finite = peelSetExpr(type.$refined.set);
      expect(finite?.kind).toBe("SeEnum");
      if (finite?.kind !== "SeEnum") throw new Error("The input set is not finite.");
      expect(finite.values).toContain(included);
      expect(finite.values).not.toContain(excluded);
      const accepted = call("axiomsDependency", input.selection, included);
      expect(accepted.exploration.membership).toEqual(Just(true));
      expect(accepted.generalContainment).toEqual(Nothing);
      expect(call("axiomsDependency", input.selection, excluded).exploration.membership).toEqual(Just(false));
    }
  });

  test("runtime reflection and the actual temporary Type draft make no universe/freshness proof", () => {
    const reflected = call("axiomsUniverse", ...starting("axiomsUniverse"));
    expect(reflected.data.email).toBe("hello@usefenel.com");
    expect(reflected.reflectedType).toHaveProperty("$ref", "CheckContactInput");
    expect(reflected.generalContainment).toEqual(Nothing);
    const mint = call("axiomsFreshIdentities", ...starting("axiomsFreshIdentities"));
    expect(mint.schema).toEqual({ $record: { fields: [] } });
    expect(mint.observedFreshness).toEqual(Nothing);
    expect(mint.instructions).toContain("Add field twice");
    expect(mint.explanation).toContain("does not mint or fabricate IDs");
    const inputType = registry.getFunction("AxiomsDemo:axiomsFreshIdentities")!.params[0]!.type;
    expect(inputType).toEqual({ $type: true });
  });
});
