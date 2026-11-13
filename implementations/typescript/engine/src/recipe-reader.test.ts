// C1: actual reader acquisition, not caller-authored admission flags. Concrete
// recipe evaluation is unnecessary for these reflection/route contracts.
import { beforeAll, describe, expect, test } from "bun:test";
import { createRegistry } from "./registry";
import { evaluate, invokeCallable, reflectionNativeRoute, withInstance, type EvaluateContext } from "./json-logic";
import { stdModule, stdNativesCtx } from "./modules/std";
import { unitsModule } from "./modules/units";
import { publicRecipeFunctionsModule } from "./modules/public-demos";
import { recipeAnalysisSnapshotInReader, recipeDomainSnapshotInReader } from "./recipe-reader";
import { dispatchRecipeEngineBody, observeRecipeRepresentationInReader } from "./engine-bodies-dispatch";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import { loadFenelModule, resolveLocalCallHeads } from "./fenel-module";
import { Maybe, Nothing } from "./type-foundation";
import { parse } from "./fenel-parser";
import { compileConstructorCatalogCandidates } from "./compile-field-slots";

let reader: EvaluateContext;
let descriptor: any;
const representationProbe = loadFenelModule(`module RecipeRepresentationProbe where
using std (eq, head)
swapMaybe : (value: Maybe Number) -> Maybe Number
swapMaybe value = case value of
  Nothing -> Just 1
  Just number -> if eq number 1 then Nothing else Just number
inspectHead : (unit: Unit) -> Bool
inspectHead unit = case head [1] of
  Nothing -> false
  Just number -> true
`, "RecipeRepresentationProbe");

beforeAll(() => {
  // Preserve the actual stock declaration identities. Only missing identities
  // required by the test-only representation probe are supplied in these copies.
  const lock = repositoryIdentityLock();
  const kinds = repositoryIdentityKinds();
  const modules = [stdModule, unitsModule, publicRecipeFunctionsModule, representationProbe];
  const requirements = createRegistry(modules, {
    codeNameLock: lock,
    fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock, identityKinds: kinds },
  });
  let nextType = 10;
  for (const entity of requirements.listIdentifiedEntities()) {
    const key = dispatchRecipeEngineBody("engine:typeIdentityLockKey", [entity.module === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: entity.module }, entity.id]) as string;
    if (lock.has(key)) continue;
    let id: string;
    do { id = `20000000-0000-4000-8000-${String(nextType++).padStart(12, "0")}`; } while (kinds.has(id));
    lock.set(key, id);
    kinds.set(id, "type");
  }
  let nextField = 1;
  for (const request of requirements.listFieldLockRequests()) {
    if (lock.has(request.name)) continue;
    let id = request.preferredId;
    if (id === undefined) {
      do { id = `30000000-0000-4000-8000-${String(nextField++).padStart(12, "0")}`; } while (kinds.has(id));
    }
    lock.set(request.name, id);
    kinds.set(id, "field");
  }
  const constructors = compileConstructorCatalogCandidates({
    listIdentifiedEntities: () => requirements.listIdentifiedEntities(), identityLock: lock, identityKinds: kinds,
  });
  const constructorKeys = dispatchRecipeEngineBody("engine:constructorFunctionLockRequirements", [
    constructors, requirements.listFunctions().map(fn => fn.id),
  ]);
  if (!Array.isArray(constructorKeys)) throw new Error("Fixture constructor requirements unavailable");
  let nextConstructor = 1;
  for (const key of constructorKeys) {
    if (typeof key !== "string") throw new Error("Fixture constructor requirement is unreadable");
    if (lock.has(key)) continue;
    const retained = constructors.filter(candidate => candidate.functionKey === key && candidate.functionId !== undefined);
    if (new Set(retained.map(candidate => candidate.functionId)).size > 1) throw new Error("Fixture constructor identities disagree");
    let id = retained[0]?.functionId;
    if (id === undefined) {
      do { id = `40000000-0000-4000-8000-${String(nextConstructor++).padStart(12, "0")}`; } while (kinds.has(id));
    }
    lock.set(key, id);
    kinds.set(id, "function");
  }
  reader = createRegistry(modules, {
    codeNameLock: lock,
    fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: kinds },
  }).evaluateContext();
  descriptor = invokeCallable({ $ref: "RecipeFunctions:recipeDomainDescriptor" }, [], reader);
}, 900_000);

function acquire(context = reader, domain = descriptor, recipe: unknown = { $ref: "RecipeFunctions:lubeFormula" }): any {
  return recipeAnalysisSnapshotInReader(recipe, domain, context);
}

function snapshot(context = reader, domain = descriptor): any {
  const result = acquire(context, domain);
  expect(result).toMatchObject({ $tag: "Ok" });
  return result._0;
}

describe("fresh source-owned recipe reader snapshot", () => {
  test("links exact Food function identities, scopes, current primitives and source packages", () => {
    const observed = snapshot();
    const checkedDomain: any = dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed]);
    const primitives = observed.primitives.map((primitive: any) => ({
      role: primitive.role.$tag, identity: primitive.identity, admitted: primitive.admitted,
    }));
    if (primitives.some((primitive: any) => !primitive.admitted) || checkedDomain.$tag !== "Ok") {
      console.info("Actual recipe domain admission diagnostics", JSON.stringify({
        primitives, representations: observed.representations,
        refusedSources: observed.sources.filter((source: any) => !source.admitted)
          .map((source: any) => ({ source: source.source.source, params: source.source.params })),
        checkedDomain,
      }));
    }
    expect(observed.domain.foods.map((food: any) => food.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(observed.domain.foods.map((food: any) => food.identity)).size).toBe(9);
    for (const food of observed.domain.foods) {
      expect(reader.getFunction?.(food.identity)).toBeDefined();
      expect(observed.constructorIdentities.some((bridge: any) => bridge.functionId === food.identity)).toBe(true);
    }
    expect(observed.domain.scopes).toHaveLength(3);
    expect(observed.domain.scopes.every((scope: any) => new Set(scope.bindings.map((binding: any) => binding.name)).size === scope.bindings.length)).toBe(true);
    for (const role of ["RecipeEq", "RecipeHead", "RecipeTail", "RecipeFromMaybe", "RecipeLength", "RecipeFilter", "RecipeSome", "RecipeDistinctCount"]) {
      expect(observed.primitives.find((primitive: any) => primitive.role.$tag === role)?.admitted).toBe(true);
    }
    for (const role of ["RecipeHead", "RecipeTail"]) {
      const constructors = observed.primitives.find((primitive: any) => primitive.role.$tag === role).constructors;
      expect(constructors.map((reference: any) => reference.written).sort()).toEqual(["Just", "Nothing"]);
      for (const reference of constructors) expect(observed.constructorIdentities.some((bridge: any) => bridge.target === reference.target)).toBe(true);
    }
    expect(checkedDomain).toMatchObject({ $tag: "Ok" });
  }, 900_000);

  test("domain-only acquisition contains no invented recipe/fact/rule package", () => {
    const result: any = recipeDomainSnapshotInReader(descriptor, reader);
    expect(result.$tag).toBe("Ok");
    expect(Object.keys(result._0).sort()).toEqual(["constructorIdentities", "domain", "generation", "primitives", "representations", "sources"]);
  }, 900_000);

  test("opaque signature constructors stay in the selected function's declaration scope", () => {
    const headOwner = reader.getFunction?.("std:head")?.id;
    expect(headOwner).toBeDefined();
    if (headOwner === undefined) throw new Error("Selected Head declaration is unavailable");
    const otherDeclaration = reader._typeFamilyOwner?.(descriptor.food.$ref);
    expect(otherDeclaration).toBeDefined();
    for (const selected of [undefined, otherDeclaration]) {
      let selectedScopeRequests = 0;
      const changed: EvaluateContext = {
        ...reader,
        _typeFamilyOwner: (name, sourceFunction) => {
          if (name === "Maybe" && sourceFunction === headOwner) {
            selectedScopeRequests++;
            return selected;
          }
          return reader._typeFamilyOwner?.(name, sourceFunction);
        },
      };
      const observed = snapshot(changed);
      expect(selectedScopeRequests).toBeGreaterThan(0);
      const constructors = observed.primitives.find((primitive: any) => primitive.role.$tag === "RecipeHead").constructors;
      if (selected === undefined) expect(constructors).toEqual([]);
      else expect(constructors.every((reference: any) => reference.written !== "Just" && reference.written !== "Nothing")).toBe(true);
      expect(dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed]))
        .toMatchObject({ $tag: "Err", _0: { $tag: "RecipePrimitiveUnadmitted" } });
    }
  }, 900_000);

  test("inline constructor-name projection cannot admit a malformed native signature", () => {
    const headOwner = reader.getFunction?.("std:head")?.id;
    expect(headOwner).toBeDefined();
    if (headOwner === undefined) throw new Error("Selected Head declaration is unavailable");
    const changed: EvaluateContext = {
      ...reader,
      getFunction: name => {
        const spec = reader.getFunction?.(name);
        return spec?.id === headOwner
          ? { ...spec, returns: { $variant: { cases: [{ name: "Nothing", label: Nothing }, { name: "Just", label: Nothing, fields: [] }] } } }
          : spec;
      },
    };
    expect(Object.is(reflectionNativeRoute(changed, "std:head")?.implementation,
      reflectionNativeRoute(reader, "std:head")?.implementation)).toBe(true);
    const observed = snapshot(changed);
    expect(observed.primitives.find((primitive: any) => primitive.role.$tag === "RecipeHead").admitted).toBe(false);
    expect(dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed])).toMatchObject({ $tag: "Err" });
  }, 900_000);

  test("the actual nine-food recipes check and yield determinate criteria at the public default budget", () => {
    const budget = invokeCallable({ $ref: "RecipeFunctions:recipeAnalysisBudget" }, [], reader);
    expect(budget).toBe(16384);
    for (const name of ["lubeFormula", "hydrationFormula"]) {
      const acquired: any = acquire(reader, descriptor, { $ref: `RecipeFunctions:${name}` });
      expect(acquired.$tag).toBe("Ok");
      const observed = acquired._0;
      const proposal: any = dispatchRecipeEngineBody("engine:proposeRecipeAnalysis", [observed, budget]);
      expect(proposal.residuals).toEqual([]);
      const checked: any = dispatchRecipeEngineBody("engine:checkRecipeAnalysis", [observed, proposal, budget]);
      expect(checked.$tag).toBe("RecipeAnalysisChecked");
      const claim: any = name === "lubeFormula"
        ? dispatchRecipeEngineBody("engine:recipeCriteriaGuaranteed", [observed, proposal, budget])
        : dispatchRecipeEngineBody("engine:recipeCriteriaCountRange", [observed, proposal, budget]);
      expect(claim.$tag).toBe("RecipeKnown");
      if (name === "lubeFormula") expect(claim.value).toEqual([3, 4, 5]);
      else {
        expect(claim.value.minimum).toBe(2);
        expect(claim.value.maximum).toBe(3);
      }
    }
  }, 900_000);

  test("stock context routes differ from a same-owner replacement", () => {
    const stock = reflectionNativeRoute(reader, "std:some");
    expect(stock?.kind).toBe("context");
    expect(Object.is(stock?.implementation, stdNativesCtx.some)).toBe(true);
    const replacement = () => false;
    const changed = { ...reader, nativesCtx: { ...reader.nativesCtx, "std:some": replacement } };
    expect(reflectionNativeRoute(changed, "std:some")?.implementation).toBe(replacement);
    const observed = snapshot(changed);
    expect(observed.primitives.find((primitive: any) => primitive.role.$tag === "RecipeSome").admitted).toBe(false);
  }, 900_000);

  test("a changed source body under the same stock native pointer refuses its summary", () => {
    const original = reader.getFunction?.("std:some");
    expect(original).toBeDefined();
    const changed: EvaluateContext = {
      ...reader,
      getFunction: name => {
        const spec = reader.getFunction?.(name);
        return spec?.id === original!.id ? { ...spec, body: false } : spec;
      },
    };
    const observed = snapshot(changed);
    expect(observed.primitives.find((primitive: any) => primitive.role.$tag === "RecipeSome").admitted).toBe(false);
  }, 900_000);

  test("a reader miss stays unavailable and never falls back to the public recipe", () => {
    const original = reader.getFunction?.("RecipeFunctions:lubeFormula");
    const changed: EvaluateContext = {
      ...reader,
      getFunction: name => {
        const spec = reader.getFunction?.(name);
        return spec?.id === original?.id ? undefined : spec;
      },
    };
    expect(acquire(changed)).toEqual({ $tag: "Err", _0: { $tag: "RecipeUnavailable" } });
  }, 900_000);

  test("a same-owner root native executes differently and cannot replay its displayed source", () => {
    const replacement = [[{ $tag: "Tomato" }]];
    const changed = { ...reader, nativesCtx: { ...reader.nativesCtx, "RecipeFunctions:lubeFormula": () => replacement } };
    expect(invokeCallable({ $ref: "RecipeFunctions:lubeFormula" }, [[]], changed)).toBe(replacement);
    const observed = snapshot(changed);
    const root = observed.sources.find((entry: any) => entry.source.source.identity === "RecipeFunctions:lubeFormula");
    expect(root?.admitted).toBe(false);
  }, 900_000);

  test("a native-shadowed rank and canonical helper withhold the live domain premise", () => {
    for (const name of ["foodRank", "canonicalFood"]) {
      const replacement = name === "foodRank" ? 77 : false;
      const changed = { ...reader, natives: { ...reader.natives, [`RecipeFunctions:${name}`]: () => replacement } };
      expect(invokeCallable({ $ref: `RecipeFunctions:${name}` }, [{ $tag: "Butter" }], changed)).toBe(replacement);
      const observed = snapshot(changed);
      expect(observed.sources.find((entry: any) => entry.source.source.identity === `RecipeFunctions:${name}`)?.admitted).toBe(false);
      expect((dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed]) as any).$tag).toBe("Err");
    }
  }, 900_000);

  test("extra functions are observed atomically without invoking a callback or borrowing root capture scope", () => {
    let executions = 0;
    const changed = { ...reader, natives: { ...reader.natives, "RecipeFunctions:fatRich": () => { executions++; return { $tag: "Nothing" }; } } };
    const result: any = recipeAnalysisSnapshotInReader({ $ref: "RecipeFunctions:lubeFormula" }, descriptor, changed, [{ $ref: "RecipeFunctions:fatRich" }]);
    expect(result.$tag).toBe("Ok");
    expect(executions).toBe(0);
    expect(result._0.functions).toHaveLength(1);
    const extra = result._0.functions[0];
    expect(extra.package.source.identity).toBe("RecipeFunctions:fatRich");
    expect(result._0.sources.find((entry: any) => entry.source.source.identity === "RecipeFunctions:fatRich")?.admitted).toBe(false);
  }, 900_000);

  test("original and extra anonymous captures use distinct typed source owners", () => {
    const recipe = evaluate(resolveLocalCallHeads(parse("\\pantry -> f pantry"), ["f"]), { f: { $ref: "RecipeFunctions:lubeFormula" } }, reader);
    const extra = evaluate(parse("\\food -> f"), { f: false }, reader);
    const originalEmpty = invokeCallable({ $ref: "RecipeFunctions:lubeFormula" }, [[]], reader);
    expect(originalEmpty).toEqual([]);
    expect(invokeCallable(recipe, [[]], reader)).toEqual(originalEmpty);
    const result: any = recipeAnalysisSnapshotInReader(recipe, descriptor, reader, [extra]);
    expect(result.$tag).toBe("Ok");
    expect(result._0.callables.some((entry: any) => entry.owner.$tag === "RootSource" && entry.capture === "f")).toBe(true);
    expect(result._0.callables.some((entry: any) => entry.owner.$tag === "ExtraSource" && entry.owner.index === 0 && entry.capture === "f")).toBe(false);
    expect(result._0.functions[0].package.captures.find((capture: any) => capture.name === "f").value).toBe(false);
  }, 900_000);

  test("a lawful scoped Maybe swap changes actual matching and refuses the unmodeled representation", () => {
    const swap = { $ref: "RecipeRepresentationProbe:swapMaybe" };
    for (const value of [{ $tag: "Nothing" }, { $tag: "Just", _0: 1 }, { $tag: "Just", _0: 2 }]) {
      expect(invokeCallable(swap, [invokeCallable(swap, [value], reader)], reader)).toEqual(value);
    }
    expect(invokeCallable({ $ref: "RecipeRepresentationProbe:inspectHead" }, [{}], reader)).toBe(true);
    withInstance(reader, {
      typeName: "Reprable", args: ["JsRuntime", "Maybe"],
      methods: { native: Maybe({ $ref: "Number" }), lift: swap, lower: swap },
    }, changed => {
      expect(invokeCallable({ $ref: "RecipeRepresentationProbe:inspectHead" }, [{}], changed)).toBe(false);
      const observed = snapshot(changed);
      const maybe = observed.representations.filter((row: any) => row.owner === "Maybe");
      expect(maybe).toHaveLength(2);
      expect(maybe.every((row: any) => row.admitted === false)).toBe(true);
      expect((dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed]) as any).$tag).toBe("Err");
    });
  }, 900_000);

  test("a same-id native override of a selected representation method refuses its stock-source comparison", () => {
    const changed = { ...reader, natives: { ...reader.natives, "std:arrayToList": () => ({ $tag: "Nil" }) } };
    expect(invokeCallable({ $ref: "std:arrayToList" }, [[1]], changed)).toEqual({ $tag: "Nil" });
    const observed = snapshot(changed);
    const list = observed.representations.filter((row: any) => row.owner === "List");
    expect(list).toHaveLength(2);
    expect(list.every((row: any) => row.admitted === false)).toBe(true);
    expect((dispatchRecipeEngineBody("engine:checkRecipeDomain", [observed]) as any).$tag).toBe("Err");
  }, 900_000);

  test("closed representation closures ignore only unused imports and retain used bindings and constructors", () => {
    const method = (source: string, names: Record<string, string>): any => {
      const closure = evaluate(parse(source), {}, { ...reader, _importStack: [{ names, aliases: {} }] });
      const observation: any = withInstance(reader, {
        typeName: "Reprable", args: ["JsRuntime", "Boolean"],
        methods: { native: { $ref: "Boolean" }, lift: closure, lower: closure },
      }, current => observeRecipeRepresentationInReader(current, "Boolean"));
      expect(observation.current.kind).toBe("selected");
      return observation.current.lift;
    };
    const compare = (left: any, right: any): unknown =>
      dispatchRecipeEngineBody("engine:recipeReaderRepresentationMethodEqual", [left, right, []]);
    const left = method("\\b -> if b then true else false", {});
    const unused = method("\\b -> if b then true else false", { unused: "std:id" });
    expect(compare(left, unused)).toBe(true);
    const usedLeft = method("\\b -> f b", { f: "std:not" });
    const usedRight = method("\\b -> f b", { f: "std:id" });
    expect(usedLeft.context.references.length).toBeGreaterThan(0);
    expect(compare(usedLeft, usedRight)).toBe(false);
    const constructorLeft = method("\\b -> if b then True else False", {});
    const constructorRight = method("\\b -> if b then True else False", { unused: "std:id" });
    expect(constructorLeft.context.constructors.length).toBeGreaterThan(0);
    expect(compare(constructorLeft, constructorRight)).toBe(false);
  }, 900_000);

  test("selected representation references follow the reader's actual module function binding", () => {
    let projected = 0;
    const changed: EvaluateContext = { ...reader, _moduleMember: (module, member, path) => {
      if (module === "std" && member === "listToArray" && path === undefined) {
        projected++;
        return { kind: "function", id: "std:arrayToList" };
      }
      return reader._moduleMember?.(module, member, path) ?? { kind: "missing" };
    } };
    const observation: any = observeRecipeRepresentationInReader(changed, "List");
    expect(projected).toBeGreaterThan(0);
    expect(observation.current.kind).toBe("selected");
    expect(observation.current.lift.carrier).toMatchObject({ $tag: "ReflectNamed", identity: "std:arrayToList" });
    expect(observation.current.lift.package).toMatchObject({ $tag: "Reified", package: { source: { $tag: "NamedDefinition", identity: "std:arrayToList" } } });
    expect(dispatchRecipeEngineBody("engine:recipeObservedRepresentationSelected", [observation.current, observation.canonical, []])).toBe(false);
  }, 900_000);

  test("a nonfunction module member refuses representation observation without a fallback", () => {
    let projected = 0;
    const changed: EvaluateContext = { ...reader, _moduleMember: (module, member, path) => {
      if (module === "std" && member === "listToArray" && path === undefined) {
        projected++;
        return { kind: "value", value: { $ref: "std:listToArray" } };
      }
      return reader._moduleMember?.(module, member, path) ?? { kind: "missing" };
    } };
    const observation: any = observeRecipeRepresentationInReader(changed, "List");
    expect(projected).toBeGreaterThan(0);
    expect(observation.current.kind).toBe("unavailable");
  }, 900_000);

  test("a changed nullary constructor wire cannot certify a fabricated Food carrier", () => {
    const baseline = snapshot();
    const food = baseline.domain.foods[0];
    const bridge = baseline.constructorIdentities.find((entry: any) => entry.functionId === food.identity);
    expect(bridge).toBeDefined();
    for (const [wire, actual] of [["RenamedFood", { $tag: "RenamedFood" }], ["True", true], ["False", false]] as const) {
      const changed = { ...reader, _constructorWireNames: { ...reader._constructorWireNames, [bridge.target]: wire } };
      expect(invokeCallable({ $ref: food.identity }, [], changed)).toEqual(actual);
      expect(acquire(changed)).toMatchObject({ $tag: "Err" });
    }
  }, 900_000);

  test("missing or unreadable constructor wires refuse without running a getter", () => {
    const baseline = snapshot();
    const food = baseline.domain.foods[0];
    const target = baseline.constructorIdentities.find((entry: any) => entry.functionId === food.identity).target;
    const missing = { ...reader._constructorWireNames };
    delete missing[target];
    expect(acquire({ ...reader, _constructorWireNames: missing })).toMatchObject({ $tag: "Err" });
    let getterCalls = 0;
    const unreadable = { ...reader._constructorWireNames };
    Object.defineProperty(unreadable, target, { enumerable: true, get() { getterCalls++; return food.value.$tag; } });
    expect(acquire({ ...reader, _constructorWireNames: unreadable })).toMatchObject({ $tag: "Err" });
    expect(getterCalls).toBe(0);
  }, 900_000);

  test("caller overrides of internal snapshot helpers do not replace curated checking math", () => {
    let touched = 0;
    const changed: EvaluateContext = {
      ...reader,
      getFunction: name => {
        if (name === "engine:recipeObservedFoods" || name === "recipeObservedFoods") {
          touched++;
          throw new Error("caller internal-helper override must not run");
        }
        return reader.getFunction?.(name);
      },
    };
    expect(snapshot(changed).domain.foods).toHaveLength(9);
    expect(touched).toBe(0);
  }, 900_000);

  test("facts are an immutable admitted snapshot of the supplied source descriptor", () => {
    const edited = structuredClone(descriptor);
    const observed = snapshot(reader, edited);
    const before = observed.facts.version;
    edited.snapshot.facts.version = before + 1;
    expect(observed.facts.version).toBe(before);
    expect(Object.isFrozen(observed.facts)).toBe(true);
  }, 900_000);
});
