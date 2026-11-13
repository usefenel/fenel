// Recipe-functions S3 C1 harness: execute the Fenel proposer, with concrete
// evaluation used only as an oracle. Fixtures deliberately use a tiny domain;
// production extraction never materialises the pantry assignments below.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { exactEqualityNativesCtx } from "./engine-bodies-dispatch";

type Row = Record<string, any>;
const tag = ($tag: string, fields: Row = {}): Row => ({ $tag, ...fields });
const lit = (value: unknown) => tag("ELit", { value });
const variable = (name: string) => tag("EVar", { name });
const call = (fnId: string, ...args: Row[]) => tag("ECall", { fnId, args });
const lambda = (params: string[], body: Row) => tag("ELambda", { params, body });
const food = (rank: number) => tag("EConstruct", { ctor: `F${rank}`, args: [], fields: [] });
const slot = (wireName: string) => tag("CompileFieldSlot", { key: tag("NamedField", { ref: tag("FieldRef", { handle: `fixture/Pair/${wireName}` }) }), wireName, type: { $ref: "Any" } });
const list = (...items: Row[]): Row => items.reduce((array, item) => ({ ...call("appendItem", item, array), lit: true }), lit([]));
const when = (condition: Row, yes: Row, no: Row) => call("if", condition, yes, no);
const has = (rank: number) => call("native:includes", variable("pantry"), food(rank));
const none = tag("Nothing");
const constructors = [0, 1, 2].map(rank => tag("ConstructorRef", { written: `F${rank}`, target: `Food/F${rank}` }));
const packageOf = (body: Row, params = ["pantry"], identity = "fixture:recipe", captures: Row[] = []): Row => tag("ReifiedFunction", {
  params, body, captures, source: tag("NamedDefinition", { identity }), dependencies: [], constructors, generation: none,
});
const roles = {
  includes: "RecipeIncludes", eq: "RecipeEq", filter: "RecipeFilter", some: "RecipeSome",
  distinctCount: "RecipeDistinctCount", gte: "RecipeGreaterEqual", concat: "RecipeConcat",
};
const snapshotOf = (body: Row): Row => {
  const dummy = packageOf(lit(true), ["value"], "fixture:domain");
  return tag("RecipeAnalysisSnapshot", {
    recipe: packageOf(body),
    domain: tag("RecipeDomainSnapshot", {
      foodType: {}, pantryType: {}, ingredientsType: {}, scopes: [], rankVersion: 1,
      foods: [0, 1, 2].map(rank => tag("RecipeFoodRank", { rank, identity: `Food/F${rank}`, value: tag(`F${rank}`) })),
      rankFunction: dummy, canonicalFunction: dummy, canonicalAfterFunction: dummy,
    }),
    facts: {}, rule: tag("Unavailable"), generation: none, callables: [], sources: [], functions: [],
    representations: [...[0, 1, 2].map(rank => tag("RecipeRepresentationAdmission", { constructor: `Food/F${rank}`, owner: "fixture/Food", admitted: true })), tag("RecipeRepresentationAdmission", { constructor: "fixture/Pair", owner: "fixture/PairType", admitted: true })],
    constructorIdentities: [...[0, 1, 2].map(rank => tag("RecipeConstructorIdentity", { target: `Food/F${rank}`, functionId: `Food/F${rank}` })), tag("RecipeConstructorIdentity", { target: "fixture/Pair", functionId: "fixture/Pair" })],
    primitives: Object.entries(roles).map(([identity, role]) => tag("RecipePrimitiveAdmission", { identity: `native:${identity}`, role: tag(role), admitted: true, constructors: [] })),
  });
};

let ctx: EvaluateContext;
beforeAll(() => {
  const sources = ["rel-solve.fenel", "reflect.fenel", "recipe-symbolic-types.fenel", "recipe-source-owner.fenel", "recipe-symbolic.fenel"];
  const source = sources.map(name => readFileSync(new URL(`../../../../fenel/modules/engine/${name}`, import.meta.url), "utf8").replace(/^module engine where\s*$/gm, "")).join("\n");
  const engine = loadFenelModule(`module engine where\n${source}`, "engine");
  // Carry the actual solver quantifier and its source declaration sidecar into
  // this focused registry, so list HOFs still have to select std.some explicitly.
  const solve = loadFenelModule(readFileSync(new URL("../../../../fenel/modules/engine/solve.fenel", import.meta.url), "utf8"), "engine");
  const quantifier = solve.functions?.find(fn => fn.id === "engine:some");
  const declaration = solve.functionSignatureDeclarations?.find(row => row.functionId === quantifier?.id);
  if (!quantifier || !declaration) throw new Error("The actual engine.some declaration fixture is missing");
  const curated = createRegistry([stdModule, { ...engine, functions: [...(engine.functions ?? []), quantifier], functionSignatureDeclarations: [...(engine.functionSignatureDeclarations ?? []), declaration] }]).evaluateContext();
  ctx = { ...curated, nativesCtx: { ...curated.nativesCtx, ...exactEqualityNativesCtx(curated, curated) } };
}, 900_000);
function sourceAdmissions(snapshot: Row, extra: Row[] = []): Row {
  const seen = new Set(snapshot.sources.map((row: Row) => JSON.stringify({ ...row.source, dependencies: [] })));
  const pending = [snapshot.recipe, ...extra];
  for (const outcome of [snapshot.rule, ...snapshot.functions, ...snapshot.callables.map((row: Row) => row.outcome)]) if (outcome.$tag === "Reified") pending.push(outcome.package);
  while (pending.length) {
    const current = pending.shift()!;
    const key = JSON.stringify({ ...current, dependencies: [] });
    if (seen.has(key)) continue;
    seen.add(key);
    snapshot.sources.push(tag("RecipeSourceAdmission", { source: current, admitted: true }));
    for (const dependency of current.dependencies) if (dependency.outcome.$tag === "Reified") pending.push(dependency.outcome.package);
  }
  return snapshot;
}
const propose = (snapshot: Row, budget = 3000): Row => invokeCallable({ $ref: "engine:proposeRecipeAnalysis" }, [sourceAdmissions(snapshot), budget], ctx) as Row;
const application = (snapshot: Row, source: Row, args: Row[], budget = 100): Row => {
  if (source !== snapshot.recipe && !snapshot.functions.some((outcome: Row) => outcome.$tag === "Reified" && outcome.package === source)) snapshot.functions.push(tag("Reified", { package: source }));
  return invokeCallable({ $ref: "engine:proposeRecipeApplication" }, [sourceAdmissions(snapshot, [source]), source, args, budget], ctx) as Row;
};

function accepts(c: Row, pantry: number[]): boolean {
  switch (c.$tag) {
    case "RcAll": return true;
    case "RcNone": return false;
    case "RcHasFood": return pantry.includes(c.rank);
    case "RcAnd": return c.terms.every((term: Row) => accepts(term, pantry));
    case "RcOr": return c.terms.some((term: Row) => accepts(term, pantry));
    case "RcNot": return !accepts(c.inner, pantry);
    case "RcCardinality": { const n = new Set(c.ranks.filter((rank: number) => pantry.includes(rank))).size; return c.lower <= n && n <= c.upper; }
    default: throw new Error(`Cannot concretise ${c.$tag}`);
  }
}
function outcome(proposal: Row, pantry: number[]): number[][] {
  return proposal.outcomes.filter((row: Row) => accepts(row.condition, pantry)).flatMap((row: Row) => row.preparations.filter((q: Row) => accepts(q.available, pantry)).map((q: Row) => q.foods.filter((food: Row) => accepts(food.included, pantry)).map((food: Row) => food.rank)));
}
const pantries = Array.from({ length: 8 }, (_, mask) => [0, 1, 2].filter(rank => mask & (1 << rank)));

describe("S3 lexical symbolic extraction", () => {
  test("let binds once and direct nested partial lambdas preserve lexical shadowing", () => {
    const choose = lambda(["selected", "pantry"], when(call("native:includes", variable("pantry"), variable("selected")), list(list(variable("selected"))), list()));
    const body = call("$", lambda(["selected"], call("$", call("$", choose, food(1)), variable("pantry"))), food(0));
    const proposal = propose(snapshotOf(body));
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) expect(outcome(proposal, pantry)).toEqual(pantry.includes(1) ? [[1]] : []);
    expect(proposal.transitions.filter((step: Row) => step.rule.$tag === "RtLambda").length).toBe(2);
    for (const [index, step] of proposal.transitions.entries()) expect(step.premises.every((premise: number) => premise < index)).toBe(true);
  });

  test("conditional argument and record field share their source value until demanded", () => {
    const bound = tag("ERecord", { fields: [{ name: "choice", value: when(has(0), food(0), food(1)) }] });
    const body = call("$", lambda(["record"], list(list(variable("record.choice")))), bound);
    const proposal = propose(snapshotOf(body));
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) expect(outcome(proposal, pantry)).toEqual([[pantry.includes(0) ? 0 : 1]]);
    expect(proposal.transitions.some((step: Row) => step.result.$tag === "RvRecord" && step.result.fields[0].value.$tag === "RvConditional")).toBe(true);
  });

  test("readable helper captures do not inherit a call site's shadowed binding", () => {
    const snapshot = snapshotOf(call("$", lambda(["selected"], call("fixture:helper", variable("pantry"))), food(1)));
    const helper = packageOf(when(call("native:includes", variable("pantry"), variable("selected")), list(list(variable("selected"))), list()), ["pantry"], "fixture:helper", [tag("ReifiedCapture", { name: "selected", value: tag("F0"), origin: tag("DefinitionLexical") })]);
    snapshot.recipe.dependencies = [tag("ReifiedDependency", { identity: "fixture:helper", outcome: tag("Reified", { package: helper }) })];
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) expect(outcome(proposal, pantry)).toEqual(pantry.includes(0) ? [[0]] : []);
    expect(proposal.transitions.some((step: Row) => step.occurrence.owner.$tag === "NamedSource" && step.occurrence.owner.identity === "fixture:helper")).toBe(true);
  });

  test("ordered match guards and dead short-circuit calls preserve demand", () => {
    const match = tag("EMatch", { scrutinee: food(0), arms: [
      { pattern: tag("PatWildcard"), guard: lit(false), body: call("missing:dead") },
      { pattern: tag("PatConstruct", { ctor: "F0", args: [], fields: [] }), body: list(list(food(0))) },
      { pattern: tag("PatWildcard"), body: call("missing:alsoDead") },
    ] });
    const proposal = propose(snapshotOf(when(call("or", lit(true), call("missing:never")), match, list())));
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([[0]]);
    expect(proposal.transitions.some((step: Row) => step.expression.fnId?.startsWith("missing:"))).toBe(false);
  });

  test("admitted filter and distinct count summarize the canonical pantry symbolically", () => {
    const predicate = lambda(["food"], call("or", call("native:eq", variable("food"), food(0)), call("native:eq", variable("food"), food(2))));
    const body = call("$", lambda(["chosen"], when(call("native:gte", call("native:distinctCount", variable("chosen")), lit(2)), list(variable("chosen")), list())), call("native:filter", predicate, variable("pantry")));
    const proposal = propose(snapshotOf(body));
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) {
      const raw = { if: [{ ">=": [{ call: ["distinctCount", { call: ["filter", { fn: ["food", { or: [{ call: ["eq", { var: "food" }, tag("F0")] }, { call: ["eq", { var: "food" }, tag("F2")] }] }] }, { var: "pantry" }] }] }, 2] }, [[tag("F0"), tag("F2")]], []] };
      const concrete = evaluate(raw, { pantry: pantry.map(rank => tag(`F${rank}`)) }, ctx) as Row[][];
      expect(outcome(proposal, pantry)).toEqual(concrete.map(q => q.map(value => Number(value.$tag.slice(1)))));
    }
    expect(proposal.transitions.some((step: Row) => step.result.$tag === "RvCount")).toBe(true);
    expect(proposal.origins.length).toBeGreaterThan(0);
  });

  test("opaque source and exhausted budget remain explicit residuals", () => {
    const snapshot = snapshotOf(call("opaque:predicate", variable("pantry")));
    snapshot.recipe.dependencies = [tag("ReifiedDependency", { identity: "opaque:predicate", outcome: tag("OpaqueBody", { identity: "opaque:predicate", params: ["pantry"] }) })];
    const opaque = propose(snapshot);
    expect(opaque.residuals.some((row: Row) => row.reason.$tag === "RecipeOpaque")).toBe(true);
    expect(opaque.outcomes).toEqual([]);
    const exhausted = propose(snapshotOf(list(list(food(0)))), 0);
    expect(exhausted.residuals[0].reason.$tag).toBe("RecipeBudgetExhausted");
    expect(exhausted.outcomes).toEqual([]);
  });

  test("constructor equality aligns named fields rather than comparing payload order", () => {
    const left = tag("EConstruct", { ctor: "Pair", args: [lit(1), lit(2)], fields: [slot("a"), slot("b")] });
    const right = tag("EConstruct", { ctor: "Pair", args: [lit(1), lit(2)], fields: [slot("b"), slot("a")] });
    const snapshot = snapshotOf(when(call("native:eq", left, right), list(list(food(0))), list()));
    snapshot.recipe.constructors.push(tag("ConstructorRef", { written: "Pair", target: "fixture/Pair" }));
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([]);
  });

  test("captured anonymous callable uses its own reflected package and constructors", () => {
    const snapshot = snapshotOf(call("$dyn:chosen", variable("pantry")));
    const body = when(has(1), list(list(food(1))), list());
    snapshot.recipe.captures = [tag("ReifiedCapture", { name: "chosen", value: { __fenelFn: true, params: ["pantry"], body: {}, closure: {} }, origin: tag("ClosureScope") })];
    snapshot.callables = [tag("RecipeCallableObservation", { owner: tag("RootSource"), capture: "chosen", path: [], outcome: tag("Reified", { package: { ...packageOf(body), source: tag("SourceClosure") } }) })];
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) expect(outcome(proposal, pantry)).toEqual(pantry.includes(1) ? [[1]] : []);
    expect(proposal.transitions.some((step: Row) => step.occurrence.owner.$tag === "CapturedSource")).toBe(true);
  });

  test("short-circuit operations retain the selected operand value", () => {
    const proposal = propose(snapshotOf(call("and", lit(true), list(list(food(0))))));
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([[0]]);
  });

  test("named constructor subset patterns retain the selected payload", () => {
    const pair = tag("EConstruct", { ctor: "Pair", args: [food(0), food(1)], fields: [slot("a"), slot("b")] });
    const body = tag("EMatch", { scrutinee: pair, arms: [
      { pattern: tag("PatConstruct", { ctor: "Pair", args: [tag("PatVar", { name: "selected" })], fields: [slot("a")] }), body: list(list(variable("selected"))) },
      { pattern: tag("PatWildcard"), body: list() },
    ] });
    const snapshot = snapshotOf(body);
    snapshot.recipe.constructors.push(tag("ConstructorRef", { written: "Pair", target: "fixture/Pair" }));
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([[0]]);
  });

  test("a dependency UUID retains its canonical source's constructor scope", () => {
    const snapshot = snapshotOf(call("uuid-helper", variable("pantry")));
    const helper = packageOf(list(list(food(0))), ["pantry"], "canonical:helper");
    helper.constructors = [tag("ConstructorRef", { written: "F0", target: "Food/F1" })];
    snapshot.recipe.dependencies = [tag("ReifiedDependency", { identity: "uuid-helper", outcome: tag("Reified", { package: helper }) })];
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([[1]]);
  });

  test("callable values nested in captured output are refused as invalid preparations", () => {
    const snapshot = snapshotOf(variable("result"));
    snapshot.recipe.captures = [tag("ReifiedCapture", { name: "result", value: [{ __fenelFn: true, params: [], body: {}, closure: {} }], origin: tag("ClosureScope") })];
    const proposal = propose(snapshot);
    expect(proposal.residuals.map((residual: Row) => residual.reason.$tag)).toContain("RecipeInvalidPreparation");
    expect(proposal.outcomes.flatMap((row: Row) => row.preparations)).toEqual([]);
  });

  test("invoking an opaque direct capture retains its reader observation", () => {
    const snapshot = snapshotOf(call("$dyn:chosen", variable("pantry")));
    snapshot.recipe.captures = [tag("ReifiedCapture", { name: "chosen", value: { $ref: "native:opaque" }, origin: tag("ClosureScope") })];
    snapshot.callables = [tag("RecipeCallableObservation", { owner: tag("RootSource"), capture: "chosen", path: [], outcome: tag("OpaqueBody", { identity: "native:opaque", params: ["pantry"] }) })];
    const proposal = propose(snapshot);
    expect(proposal.residuals.map((residual: Row) => residual.reason.$tag)).toEqual(["RecipeOpaque"]);
    expect(proposal.outcomes).toEqual([]);
  });

  test("captured callable cycles terminate with a typed recursive residual", () => {
    const snapshot = snapshotOf(call("$dyn:self", variable("pantry")));
    snapshot.recipe.captures = [tag("ReifiedCapture", { name: "self", value: { $ref: "fixture:recipe" }, origin: tag("DefinitionLexical") })];
    snapshot.callables = [tag("RecipeCallableObservation", { owner: tag("RootSource"), capture: "self", path: [], outcome: tag("Reified", { package: snapshot.recipe }) })];
    const proposal = propose(snapshot, 20);
    expect(proposal.residuals.some((residual: Row) => residual.reason.$tag === "RecipeRecursive")).toBe(true);
  });

  test("admitted primitive currying keeps its collected symbolic arguments", () => {
    const body = call("$", lambda(["contains"], when(call("$dyn:contains", food(0)), list(list(food(0))), list())), call("native:includes", variable("pantry")));
    const proposal = propose(snapshotOf(body));
    expect(proposal.residuals).toEqual([]);
    for (const pantry of pantries) expect(outcome(proposal, pantry)).toEqual(pantry.includes(0) ? [[0]] : []);
    expect(proposal.transitions.some((step: Row) => step.result.$tag === "RvPrimitive")).toBe(true);
  });

  test("generic application uses the source's own dependency graph", () => {
    const snapshot = snapshotOf(list());
    const helper = packageOf(call("native:eq", variable("item"), food(2)), ["item"], "family:helper");
    const source = packageOf(call("family:helper", variable("food")), ["food"], "family:source");
    source.dependencies = [tag("ReifiedDependency", { identity: "family:helper", outcome: tag("Reified", { package: helper }) })];
    const result = application(snapshot, source, [tag("RvFood", { rank: 2 })]);
    expect(result.residuals).toEqual([]);
    expect(result.result).toEqual(tag("RvBoolean", { constraint: tag("RcAll") }));
    expect(result.snapshot).toEqual(snapshot);
    expect(result.source).toEqual(source);
  });

  test("sole records matching authored formals stay residual at the named-argument boundary", () => {
    const named = tag("ERecord", { fields: [{ name: "x", value: lit(1) }, { name: "y", value: list() }] });
    const body = call("$", call("$", lambda(["x", "y"], variable("y")), named), list(list(food(0))));
    const proposal = propose(snapshotOf(body));
    expect(proposal.residuals.some((residual: Row) => residual.reason.$tag === "RecipeUnsupported")).toBe(true);
  });

  test("shared captured data exhausts one construction quota before its later sibling", () => {
    let shared: Row = {};
    for (let index = 0; index < 13; index++) shared = { left: shared, right: shared };
    const snapshot = snapshotOf(variable("data.right"));
    snapshot.recipe.captures = [tag("ReifiedCapture", { name: "data", value: { left: shared, right: [] }, origin: tag("ClosureScope") })];
    const proposal = propose(snapshot, 200);
    expect(proposal.residuals.some((residual: Row) => residual.reason.$tag === "RecipeBudgetExhausted")).toBe(true);
  });

  test("explicit ordinary Boolean calls retain actual reader owner semantics", () => {
    const condition = { ...call("and", lit(false), lit(true)), structural: false };
    const snapshot = snapshotOf(when(condition, list(list(food(0))), list()));
    const helper = packageOf(variable("right"), ["left", "right"], "fixture:and");
    snapshot.recipe.dependencies = [tag("ReifiedDependency", { identity: "and", outcome: tag("Reified", { package: helper }) })];
    const proposal = propose(snapshot);
    expect(proposal.residuals).toEqual([]);
    expect(outcome(proposal, [])).toEqual([[0]]);
    expect(proposal.transitions.some((step: Row) => step.expression.fnId === "and" && step.expression.structural === false)).toBe(true);
  });

  test("projection from closed application data lifts lists into symbolic list values", () => {
    const snapshot = snapshotOf(list());
    const source = packageOf(variable("data.facts.nutrients"), ["data"], "family:project");
    const result = application(snapshot, source, [tag("RvLiteral", { value: { facts: { nutrients: [] } } })]);
    expect(result.residuals).toEqual([]);
    expect(result.result).toEqual(tag("RvList", { items: [] }));
  });

  test("dotted parameter carriers do not bypass runtime path projection", () => {
    const snapshot = snapshotOf(list());
    const source = packageOf(variable("data.value"), ["data.value"], "family:dotted");
    const result = application(snapshot, source, [tag("RvFood", { rank: 0 })]);
    expect(result.residuals.some((residual: Row) => residual.reason.$tag === "RecipeUnavailable")).toBe(true);
  });

  test("a readable body with refused execution-source admission stays opaque", () => {
    const snapshot = snapshotOf(list(list(food(0))));
    snapshot.sources.push(tag("RecipeSourceAdmission", { source: snapshot.recipe, admitted: false }));
    const proposal = propose(snapshot);
    expect(proposal.residuals.some((residual: Row) => residual.reason.$tag === "RecipeOpaque")).toBe(true);
    expect(proposal.outcomes).toEqual([]);
  });
});
