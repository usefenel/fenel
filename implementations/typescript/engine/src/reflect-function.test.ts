// recipe-functions S2 — the reader-owned reflection boundary (ledger §5, §12,
// §13 C0): `dispatchedReifyInReader` / the `reflectFunction` context native,
// and the 8 `introspectFnForReify` consumers on the reader path.
//
// The first two describe blocks are the P0b probe (formerly
// `workstreams/recipe-functions/probes/p2-reify.probe.test.ts`) with every
// `EXPECTED-TO-CHANGE (S2)` assertion flipped deliberately; the rest pin the
// C0 contract.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, readerSourceMetadataEvaluateContext, resolveCompleteMethodForEvaluation, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { mintAuthority } from "./authority";
import { stdModule } from "./modules/std";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import {
  dispatchedReify,
  dispatchedReifyInReader,
  dispatchedSolveFn,
  dispatchedSolveFnAll,
  dispatchedSolveFnSymbolic,
  dispatchedJsonLogicToExpr,
  dispatchedExprToJsonLogic,
  dispatchedPartialEvalDetailed,
  dispatchedNormaliseToCore,
  dispatchedSerializeJsModule,
  parserBaseRuntimeForTests,
  dispatchEngineBody,
  reflectFunctionNativeCtx,
} from "./engine-bodies-dispatch";
import { publicRecipeDemoModule } from "./modules/public-demos";
import { createPerformTableController } from "./perform";
import { SYSTEM_RESOLVER } from "./resolver";
import { compileModuleCallBindings } from "./compile-call-bindings";
import { compileFenelToJsNative } from "./modules/compile-js";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import { entitySchemaFields } from "./field-meta";
import REFLECTION_SOURCE from "../../../../fenel/modules/engine/reflect.fenel?raw";
import { resolveEl } from "./dependent-types";

const SOURCE = `module RecipeProbe where

import std (includes, filter, length, some, and, or, eq, gte, add, sub)

Food = Butter | CoconutCream | Cream | Honey | LemonJuice | Egg | Tomato | Watermelon | Cucumber

has : (food: Food) -> (pantry: List Food) -> Boolean
has food pantry = includes pantry food

lube : (pantry: List Food) -> List (List Food)
lube pantry = if has Butter pantry && has Honey pantry then [[Butter, Honey]] else if has CoconutCream pantry then [[CoconutCream, Honey]] else []

lubeLam : (pantry: List Food) -> List (List Food)
lubeLam = \\pantry -> if includes pantry Butter then [[Butter]] else []

mkHas : (food: Food) -> ((List Food) -> Boolean)
mkHas food = \\pantry -> includes pantry food

viaHelper : (u: Number) -> ((List Food) -> List (List Food))
viaHelper u = \\pantry -> if has Butter pantry then [[Butter]] else []

withLet : (u: Number) -> ((List Food) -> List (List Food))
withLet u = \\pantry -> do
    let fat = has Butter pantry
    if fat then [[Butter]] else []
  end

shadowHas : (u: Number) -> ((Food -> (List Food) -> Boolean) -> (List Food) -> Boolean)
shadowHas u = \\has pantry -> has Butter pantry

multi : (u: Number) -> (Number -> Number -> Number -> Number)
multi u = \\a b c -> a

partialHas : (u: Number) -> ((List Food) -> Boolean)
partialHas u = has Butter

named3 : (a: Number) -> (b: Number) -> (c: Number) -> Number
named3 a b c = a

shadowNamed : (has: Food -> (List Food) -> Boolean) -> (pantry: List Food) -> Boolean
shadowNamed has pantry = has Butter pantry

mkShadow : (has: Food -> (List Food) -> Boolean) -> ((List Food) -> Boolean)
mkShadow has = \\pantry -> has Butter pantry

countdown : (n: Number) -> Number
countdown n = if eq n 0 then 0 else countdown (sub n 1)

isFat : (food: Food) -> Boolean
isFat food = case food of
  Butter -> True
  Cream -> True
  _ -> False

fatty : (pantry: List Food) -> Boolean
fatty pantry = some pantry isFat

@native
probeLeaf : (x: Number) -> Number

@native
reflectFunction : (fn: a -> b) -> ReifyOutcome

reflectLube : (u: Number) -> ReifyOutcome
reflectLube u = reflectFunction lube

reflectMkHas : (u: Number) -> ReifyOutcome
reflectMkHas u = reflectFunction (mkHas Butter)

reflectPartial : (u: Number) -> ReifyOutcome
reflectPartial u = reflectFunction (has Butter)

isSeven : (x: Number) -> Boolean
isSeven x = eq x 7
`;

type R = { $tag: string; _0?: { body?: any; captures?: any; reason?: string } };
type Outcome = { $tag: string; package?: any; identity?: string; params?: string[] };
let ctx: EvaluateContext;
let registry: ModuleRegistry;
const id = (n: string) => `RecipeProbe:${n}`;
const callTop = (n: string, ...args: unknown[]) => invokeCallable({ $ref: id(n) }, args, ctx);
const probeModule = () => ({
  ...loadFenelModule(SOURCE, "RecipeProbe"),
  nativeImplsCtx: { "RecipeProbe:reflectFunction": reflectFunctionNativeCtx },
});
const reflect = (fn: unknown, reader: EvaluateContext = ctx) => dispatchedReifyInReader(fn, reader) as Outcome;
const pkg = (outcome: Outcome) => {
  expect(outcome.$tag).toBe("Reified");
  expect(outcome.package.$tag).toBe("ReifiedFunction");
  return outcome.package;
};
const UNAVAILABLE = { $tag: "Unavailable" };

beforeAll(() => {
  registry = createRegistry([stdModule, probeModule()]);
  ctx = registry.evaluateContext();
}, 900_000);

describe("P2 — what the probe registry exposes (A2 context reachable from a ctx-native)", () => {
  test("getFunction / import frame / constructors for a source function", () => {
    const spec = ctx.getFunction?.(id("lube")) as any;
    expect(spec?.id).toBe(id("lube"));
    expect(spec.params.map((p: any) => p.name)).toEqual(["pantry"]);
    expect(spec.body).toBeDefined();
    expect((ctx.getFunctionImportFrame?.(id("lube")) as any).names.has).toBe(id("has"));
    expect(Object.keys((ctx as any)._constructors).filter(k => /Butter/.test(k)))
      .toEqual(["Butter", "@ctor/RecipeProbe/Food/Butter"]);
    expect((dispatchedJsonLogicToExpr(spec.body) as R).$tag).toBe("Ok");
  });
});

describe("P2 — reify (Result contract), flipped at S2", () => {
  test("harness engine function by canonical ref, no reader: Ok (harness behaviour kept)", () => {
    const r = dispatchedReify({ $ref: "engine:reifyFilterCaptures" }) as R;
    expect(r.$tag).toBe("Ok");
  }, 900_000);

  test("S2: a source function by canonical ref is Ok in its reader (still Err without one)", () => {
    expect((dispatchedReify({ $ref: id("lube") }) as R).$tag).toBe("Err");
    const r = dispatchedReify({ $ref: id("lube") }, ctx) as R;
    expect(r.$tag).toBe("Ok");
    expect(JSON.stringify(r._0!.body)).toContain('"fnId":"RecipeProbe:has"');
  });

  test("S2: a publicdemo source function (RecipeDemo:recipeIdAdmitted) is Ok in a reader holding it", () => {
    const reader = createRegistry([stdModule, publicRecipeDemoModule]).evaluateContext();
    expect((dispatchedReify({ $ref: "RecipeDemo:recipeIdAdmitted" }) as R).$tag).toBe("Err");
    expect((dispatchedReify({ $ref: "RecipeDemo:recipeIdAdmitted" }, reader) as R).$tag).toBe("Ok");
    const outcome = reflect({ $ref: "RecipeDemo:recipeIdAdmitted" }, reader);
    expect(pkg(outcome).source).toEqual({ $tag: "NamedDefinition", identity: "RecipeDemo:recipeIdAdmitted" });
  }, 900_000);

  test("S2: a saved-function-like registry entry (JSON body module) is Ok in its reader", () => {
    const saved = { name: "Saved", label: "Saved", functions: [{ id: "Saved:f", params: [{ name: "x", type: { $ref: "Number" } }], body: { call: ["add", { var: "x" }, 1] }, returns: { $ref: "Number" } }] };
    const reader = createRegistry([stdModule, saved as any]).evaluateContext();
    expect((dispatchedReify({ $ref: "Saved:f" }) as R).$tag).toBe("Err");
    const r = dispatchedReify({ $ref: "Saved:f" }, reader) as R;
    expect(r.$tag).toBe("Ok");
    expect(r._0!.body).toEqual({ $tag: "ECall", fnId: "add", args: [{ $tag: "EVar", name: "x" }, { $tag: "ELit", value: 1 }] });
  }, 900_000);

  test("closure with captures: mkHas Butter ⇒ Ok, captures = {food: Butter}", () => {
    const v = callTop("mkHas", { $tag: "Butter" }) as any;
    const r = dispatchedReify(v) as R;
    expect(r.$tag).toBe("Ok");
    expect(r._0!.captures).toEqual([{ name: "food", value: { $tag: "Butter" } }]);
  });

  test("unused / multiple parameters: the Result body still drops params; the package keeps them", () => {
    const r = dispatchedReify(callTop("multi", 0)) as R;
    expect(r._0!.body).toEqual({ $tag: "EVar", name: "a" });
    expect(pkg(reflect(callTop("multi", 0))).params).toEqual(["a", "b", "c"]);
  });

  test("S2: partial application `has Butter` reconstructs in its reader", () => {
    const v = callTop("partialHas", 0) as any;
    expect(v.__fenelPartial).toBe(true);
    const r = dispatchedReify(v, ctx) as R;
    expect(r.$tag).toBe("Ok");
    expect(r._0!.captures).toEqual([{ name: "food", value: { $tag: "Butter" } }]);
  });

  test("harness compiler metadata cannot see the source partial `has Butter`", () => {
    expect((dispatchedReify(callTop("partialHas", 0)) as R).$tag).toBe("Err");
  }, 900_000);

  test("native without body: std elem stays Err Unsupported on the Result path", () => {
    const r = dispatchedReify({ $ref: "std:elem" }) as R;
    expect(r.$tag).toBe("Err");
    expect(reflect({ $ref: "std:elem" }).$tag).toBe("OpaqueBody");
    // `includes` may be native (before S1) or Fenel-bodied (after S1): either
    // outcome is honest; it is never Unavailable in a reader that holds it.
    expect(["OpaqueBody", "Reified"]).toContain(reflect({ $ref: "std:includes" }).$tag);
  });

  test("S2: import-closing KEEPS the list-literal `lit` marker", () => {
    const lam = evaluate({ call: [id("lubeLam")] }, {}, ctx) as any;
    expect(JSON.stringify(dispatchedJsonLogicToExpr(lam.body))).toContain('"lit":true');
    expect(JSON.stringify(dispatchedReify(lam))).toContain('"lit":true');
    expect(JSON.stringify(pkg(reflect(lam)).body)).toContain('"lit":true');
  });

  test("let lowers to `$` of an ELambda; a shadowing parameter call is `$dyn:<name>`; a helper closes to its identity", () => {
    const withLet = dispatchedReify(callTop("withLet", 0)) as R;
    expect(withLet._0!.body.fnId).toBe("$");
    expect(withLet._0!.body.args[0].$tag).toBe("ELambda");
    const shadow = dispatchedReify(callTop("shadowHas", 0)) as R;
    expect(shadow._0!.body.fnId).toBe("$dyn:has");
    const helper = dispatchedReify(callTop("viaHelper", 0)) as R;
    expect(helper._0!.body.args[0].fnId).toBe("RecipeProbe:has");
  });
});

describe("P2 — carriers (§12: reflection executes no getter; malformed carriers)", () => {
  test("S2: a getter-bearing closure carrier is NOT read (the getter never runs)", () => {
    let ran = 0;
    const carrier = { __fenelFn: true, params: ["x"], closure: {}, get body() { ran++; return { var: "x" }; } };
    expect((dispatchedReify(carrier) as R).$tag).toBe("Err");
    expect(reflect(carrier)).toEqual(UNAVAILABLE);
    expect(ran).toBe(0);
  });

  test("S2: a getter in the captured scope is not run either", () => {
    let ran = 0;
    const scope = { get y() { ran++; return 1; } };
    const carrier = { __fenelFn: true, params: ["x"], body: { call: ["add", { var: "x" }, { var: "y" }] }, closure: scope };
    expect(reflect(carrier)).toEqual(UNAVAILABLE);
    expect((dispatchedReify(carrier) as R).$tag).toBe("Err");
    expect(ran).toBe(0);
  });

  test("S2: malformed carrier (params a String) is refused", () => {
    const malformed = { __fenelFn: true, params: "x", body: { var: "x" }, closure: {} };
    expect((dispatchedReify(malformed) as R).$tag).toBe("Err");
    expect(reflect(malformed)).toEqual(UNAVAILABLE);
  });

  test("S2: reify takes the reader", () => {
    expect(dispatchedReify.length).toBe(2);
    expect(dispatchedReifyInReader.length).toBe(2);
  });
});

describe("S2 — the reified package (C0)", () => {
  test("source function through the reflectFunction context native, in the calling reader", () => {
    const p = pkg(callTop("reflectLube", 0) as Outcome);
    expect(p.params).toEqual(["pantry"]);
    expect(p.source).toEqual({ $tag: "NamedDefinition", identity: id("lube") });
    expect(p.captures).toEqual([]);
    const body = JSON.stringify(p.body);
    expect(body).toContain('"fnId":"RecipeProbe:has"');
    expect(body).toContain('"lit":true');
    expect(p.constructors).toContainEqual({ $tag: "ConstructorRef", written: "Butter", target: "@ctor/RecipeProbe/Food/Butter" });
    expect(p.constructors).toContainEqual({ $tag: "ConstructorRef", written: "Honey", target: "@ctor/RecipeProbe/Food/Honey" });
    const deps = p.dependencies.map((d: any) => d.identity);
    expect(deps).toContain(id("has"));
    expect(deps).toContain("std:includes");
    expect(new Set(deps).size).toBe(deps.length);
  });

  test("closure: free-var-filtered captures with ClosureScope origin; nullary constructors lift to EConstruct", () => {
    const p = pkg(callTop("reflectMkHas", 0) as Outcome);
    expect(p.params).toEqual(["pantry"]);
    expect(p.source).toEqual({ $tag: "SourceClosure" });
    expect(p.captures).toEqual([{ $tag: "ReifiedCapture", name: "food", value: { $tag: "Butter" }, origin: { $tag: "ClosureScope" } }]);
    const lam = pkg(reflect(evaluate({ call: [id("lubeLam")] }, {}, ctx)));
    expect(JSON.stringify(lam.body)).toContain('{"$tag":"EConstruct","args":[],"ctor":"Butter"}');
  });

  test("partial: collected arguments become PartialArgument captures; remaining params kept", () => {
    for (const outcome of [callTop("reflectPartial", 0), reflect(callTop("partialHas", 0))] as Outcome[]) {
      const p = pkg(outcome);
      expect(p.params).toEqual(["pantry"]);
      expect(p.captures).toEqual([{ $tag: "ReifiedCapture", name: "food", value: { $tag: "Butter" }, origin: { $tag: "PartialArgument", index: 0 } }]);
      expect(p.source).toEqual({ $tag: "PartialOf", base: { $tag: "NamedDefinition", identity: id("has") }, collected: 1 });
      expect(p.dependencies.map((d: any) => d.identity)).toContain("std:includes");
    }
  });

  test("native without source ⇒ OpaqueBody with identity and ordered params", () => {
    expect(reflect({ $ref: id("probeLeaf") })).toEqual({ $tag: "OpaqueBody", identity: id("probeLeaf"), params: ["x"] });
    expect(reflect({ __fenelPartial: true, fn: { $ref: id("named3") }, collected: [1], arity: 3 }).$tag).toBe("Reified");
  });

  test("missing and inaccessible identities share ONE outcome; no harness/compiler-metadata fallback", () => {
    const missing = reflect({ $ref: id("noSuchFunction") });
    const alias = reflect({ $ref: "lube" }); // a short alias resolves to another owner's id
    const elsewhere = reflect({ $ref: id("lube") }, createRegistry([stdModule]).evaluateContext());
    const harnessOnly = reflect({ $ref: "engine:reifyFilterCaptures" });
    for (const outcome of [missing, alias, elsewhere, harnessOnly]) expect(outcome).toEqual(UNAVAILABLE);
    expect((dispatchedReify({ $ref: "engine:reifyFilterCaptures" }, ctx) as R).$tag).toBe("Err");
  }, 900_000);

  test("params kept: unused and multiple parameters, named and closure", () => {
    expect(pkg(reflect({ $ref: id("named3") })).params).toEqual(["a", "b", "c"]);
    expect(pkg(reflect(callTop("multi", 0))).params).toEqual(["a", "b", "c"]);
  });

  test("shadowing kept: a parameter or capture named like an import is not closed to the import", () => {
    const named = pkg(reflect({ $ref: id("shadowNamed") }));
    expect(named.body.fnId).toBe("$dyn:has");
    expect(named.dependencies).toEqual([]);
    const captured = pkg(reflect(callTop("mkShadow", { $ref: id("has") })));
    expect(captured.body.fnId).toBe("$dyn:has");
    expect(captured.captures).toEqual([{ $tag: "ReifiedCapture", name: "has", value: { $ref: id("has") }, origin: { $tag: "ClosureScope" } }]);
  });

  test("helper dependency recorded once, shallow, with its own outcome; self-recursion is not a dependency", () => {
    const p = pkg(reflect(callTop("viaHelper", 0)));
    const has = p.dependencies.find((d: any) => d.identity === id("has"));
    expect(has.$tag).toBe("ReifiedDependency");
    const hasPkg = pkg(has.outcome);
    expect(hasPkg.params).toEqual(["food", "pantry"]);
    expect(hasPkg.dependencies).toEqual([]);
    expect(p.dependencies.map((d: any) => d.identity)).toContain("std:includes");
    expect(pkg(reflect({ $ref: id("countdown") })).dependencies.map((d: any) => d.identity)).not.toContain(id("countdown"));
    // a helper passed as a value (HOF argument) is a dependency too
    expect(pkg(reflect({ $ref: id("fatty") })).dependencies.map((d: any) => d.identity)).toContain(id("isFat"));
  });

  test("constructor patterns are mapped too", () => {
    const p = pkg(reflect({ $ref: id("isFat") }));
    expect(p.constructors).toContainEqual({ $tag: "ConstructorRef", written: "Cream", target: "@ctor/RecipeProbe/Food/Cream" });
  });

  test("the same identity under two reader snapshots answers each reader's definition", () => {
    const twin = (k: number) => createRegistry([stdModule, {
      name: "Twin", label: "Twin",
      functions: [{ id: "Twin:f", params: [{ name: "x", type: { $ref: "Number" } }], body: { call: ["add", { var: "x" }, k] }, returns: { $ref: "Number" } }],
    } as any]).evaluateContext();
    const one = pkg(reflect({ $ref: "Twin:f" }, twin(1)));
    const two = pkg(reflect({ $ref: "Twin:f" }, twin(2)));
    expect(one.body.args[1]).toEqual({ $tag: "ELit", value: 1 });
    expect(two.body.args[1]).toEqual({ $tag: "ELit", value: 2 });
  }, 900_000);
});

describe("S2 — consumers on the reader path", () => {
  const isFive = { name: "Saved", label: "Saved", functions: [{ id: "Saved:isFive", params: [{ name: "x", type: { $ref: "Number" } }], body: { call: ["eq", { var: "x" }, 5] }, returns: { $ref: "Boolean" } }] };

  test("solveFn / solveFnAll: a reader-held definition solves; without the reader it does not", () => {
    const reader = createRegistry([stdModule, isFive as any]).evaluateContext();
    expect(dispatchedSolveFn({ $ref: "Saved:isFive" })).toEqual({ $tag: "Nothing" });
    expect(dispatchedSolveFn({ $ref: "Saved:isFive" }, reader)).toEqual({ $tag: "Just", _0: 5 });
    expect(dispatchedSolveFnAll({ $ref: "Saved:isFive" }, reader)).toEqual({ $tag: "Just", _0: [5] });
  }, 900_000);

  test("a plain closure answers the same with and without a reader", () => {
    const closure = { __fenelFn: true, params: ["x"], body: { call: ["eq", { var: "x" }, 7] }, closure: {} };
    expect(dispatchedSolveFn(closure, ctx)).toEqual(dispatchedSolveFn(closure));
    expect(dispatchedSolveFn(closure)).toEqual({ $tag: "Just", _0: 7 });
  });
});

// ---------------------------------------------------------------------------
// S2 fix round (Astra review 2026-10-18, items 4-9)
// ---------------------------------------------------------------------------

const closureOf = (params: string[], body: unknown, scope: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ __fenelFn: true, params, body, closure: scope, ...extra });
const EQ_XY = { call: ["eq", { var: "x" }, { var: "y" }] };

test("public reflection fields resolve their actual declared types for heterogeneous packages", () => {
  const source = loadFenelModule(REFLECTION_SOURCE, "engine");
  // Dependent Type evaluation dispatches through the requesting reader's
  // Evaluator instance, so this fixture owns that real source dependency too.
  const declared = createRegistry([stdModule, evaluatorStrategiesModule, source]);
  const reader = declared.evaluateContext();
  const actualDeclaration = (spelling: string) => {
    // A source-qualified name belongs to nominal resolution, not the registry's
    // exact bare-id/UUID map. Use its actual owner and assert that the family
    // observation selects that same declaration before reading any field.
    const resolved = declared.callSiteTyping.resolveType({ $ref: spelling }, undefined);
    if (!resolved.ok) throw new Error(`unresolved actual declaration ${spelling}: ${JSON.stringify(resolved)}`);
    const nominal = resolved.type.nominals?.find(row => row.path.length === 0);
    if (nominal === undefined) throw new Error(`missing actual nominal owner ${spelling}`);
    const key = declared.callSiteTyping.legacyKey(nominal);
    if (!key.ok) throw new Error(`unavailable exact declaration key ${spelling}: ${JSON.stringify(key)}`);
    const owner = declared.getIdentifiedEntity(key.key);
    if (owner === undefined) throw new Error(`missing registered declaration ${spelling} at ${key.key}`);
    const family = reader._typeFamilyOwner?.(key.key);
    if (family === undefined) throw new Error(`missing registered declaration family ${spelling} at ${key.key}`);
    expect(family.ownerIdentity).toBe(nominal.identity);
    return { owner, family };
  };
  const helper = reader.getFunction?.("engine:reflectionValueType");
  expect(helper).toBeDefined();
  if (helper === undefined) throw new Error("missing actual reflection payload Type helper");
  const universal = { $complement: { $void: true } } as const;
  expect(evaluate({ call: [helper.id, 0] }, {}, reader)).toEqual(universal);
  const { owner: payloadOwner, family: payloadFamily } = actualDeclaration("engine.ReflectionValue");
  const payloadScope = reader._typeDeclarationScope?.(payloadFamily.ownerIdentity);
  if (!("$refined" in payloadOwner.type) || payloadScope === undefined) {
    throw new Error(`unavailable actual reflection payload alias: ${JSON.stringify({
      refined: "$refined" in payloadOwner.type, scope: payloadScope, family: payloadFamily, rawType: payloadOwner.type,
    })}`);
  }
  const ownedReader: EvaluateContext = { ...reader, _sourceFunction: payloadScope.sourceFunction,
    _importStack: [{ names: { ...payloadScope.names }, aliases: {} }] };
  expect(resolveCompleteMethodForEvaluation(ownedReader, "Evaluator", "eval", ["EagerStrategy"]))
    .toMatchObject({ $tag: "Resolved" });
  expect(resolveEl(payloadOwner.type.$refined.base, {}, ownedReader)).toEqual(universal);
  const missingHelper: EvaluateContext = { ...ownedReader, getFunction: (name) => {
    const fn = ownedReader.getFunction?.(name);
    return fn?.id === helper.id ? undefined : fn;
  } };
  expect(resolveEl(payloadOwner.type.$refined.base, {}, missingHelper)).toBeUndefined();
  for (const [identity, fieldName] of [["engine.ReifiedFunction", "body"], ["engine.ReifiedCapture", "value"]] as const) {
    const { owner, family } = actualDeclaration(identity);
    const field = entitySchemaFields(owner).find(candidate => candidate.name === fieldName);
    expect(field).toBeDefined();
    if (field === undefined) throw new Error(`missing actual declared field ${identity}.${fieldName}`);
    const resolution = reader._callSiteTyping?.resolveTypeInDeclaration?.(field.type, family.ownerIdentity);
    expect(resolution).toMatchObject({ ok: true });
  }
  const outcome = pkg(reflect(closureOf(["x"], [{ var: "left" }, { var: "right" }, { var: "x" }], { left: 7, right: "text" }), reader));
  expect(outcome.captures.map((capture: { value: unknown }) => capture.value)).toEqual([7, "text"]);
}, 900_000);
const depIds = (p: any) => p.dependencies.map((d: any) => d.identity);
const savedReader = (functions: unknown[], name = "Saved") =>
  createRegistry([stdModule, { name, label: name, functions } as any]).evaluateContext();

describe("S2 fix 4 — a partial argument shadows a captured value of the same name", () => {
  test("closure: params [x,y], captured x=99, partial x=5 — invocation, solver and package agree on x=5", () => {
    const base = closureOf(["x", "y"], EQ_XY, { x: 99 });
    const partial = { __fenelPartial: true, fn: base, collected: [5], arity: 2 };
    expect(invokeCallable(partial, [5], ctx)).toBe(true);
    expect(invokeCallable(partial, [99], ctx)).toBe(false);
    expect(dispatchedSolveFn(partial)).toEqual({ $tag: "Just", _0: 5 });
    expect(dispatchedSolveFn(partial, ctx)).toEqual({ $tag: "Just", _0: 5 });
    const p = pkg(reflect(partial));
    expect(p.params).toEqual(["y"]);
    expect(p.captures).toEqual([{ $tag: "ReifiedCapture", name: "x", value: 5, origin: { $tag: "PartialArgument", index: 0 } }]);
  });

  test("named definition: lexical x=99, partial x=5", () => {
    const base = savedReader([{ id: "Saved:eqxy", params: [{ name: "x", type: { $ref: "Number" } }, { name: "y", type: { $ref: "Number" } }], body: EQ_XY, returns: { $ref: "Boolean" } }]);
    const reader = { ...base, getFunctionLexicalData: (fnId: string) => fnId === "Saved:eqxy" ? { x: 99 } : base.getFunctionLexicalData?.(fnId) } as EvaluateContext;
    const partial = { __fenelPartial: true, fn: { $ref: "Saved:eqxy" }, collected: [5], arity: 2 };
    expect(invokeCallable(partial, [5], reader)).toBe(true);
    expect(dispatchedSolveFn(partial, reader)).toEqual({ $tag: "Just", _0: 5 });
    const p = pkg(reflect(partial, reader));
    expect(p.captures).toEqual([{ $tag: "ReifiedCapture", name: "x", value: 5, origin: { $tag: "PartialArgument", index: 0 } }]);
  }, 900_000);
});

describe("S2 fix 5 — dependencies from admitted identity facts, any spelling, captures included", () => {
  test("a UUID-headed call is a dependency, resolved through the reader's own UUID for the id", () => {
    const UUID = "3f0c2b1e-8d4a-4c9b-9e7f-1a2b3c4d5e6f";
    const reader = {
      ...ctx,
      getFunction: (n: string) => ctx.getFunction?.(n === UUID ? id("has") : n),
      _uuidBySlug: new Map([[id("has"), UUID]]),
    } as EvaluateContext;
    const closure = closureOf(["food", "pantry"], { call: [UUID, { var: "food" }, { var: "pantry" }] });
    const dep = pkg(reflect(closure, reader)).dependencies.find((d: any) => d.identity === UUID);
    expect(dep).toBeDefined();
    expect(pkg(dep.outcome).source).toEqual({ $tag: "NamedDefinition", identity: id("has") });
    expect(pkg(reflect({ $ref: UUID }, reader)).source).toEqual({ $tag: "NamedDefinition", identity: id("has") });
    // the same spelling without the reader's UUID fact owns nothing
    expect(reflect({ $ref: UUID }, { ...reader, _uuidBySlug: new Map() } as EvaluateContext)).toEqual(UNAVAILABLE);
  });

  test("a captured helper reference is a dependency; its body change shows while the reference stays the same", () => {
    const g = (k: number) => savedReader([{ id: "Saved:g", params: [{ name: "x", type: { $ref: "Number" } }], body: { call: ["add", { var: "x" }, k] }, returns: { $ref: "Number" } }]);
    const closure = closureOf(["x"], { call: [{ var: "h" }, { var: "x" }] }, { h: { $ref: "Saved:g" } });
    const one = pkg(reflect(closure, g(1)));
    const two = pkg(reflect(closure, g(2)));
    expect(one.captures).toEqual(two.captures);
    const depOne = one.dependencies.find((d: any) => d.identity === "Saved:g");
    const depTwo = two.dependencies.find((d: any) => d.identity === "Saved:g");
    expect(pkg(depOne.outcome).body.args[1]).toEqual({ $tag: "ELit", value: 1 });
    expect(pkg(depTwo.outcome).body.args[1]).toEqual({ $tag: "ELit", value: 2 });
  }, 900_000);

  test("a captured closure's own references are dependencies; unresolved names stay explicit as Unavailable", () => {
    const inner = closureOf(["p"], { call: [id("has"), { var: "food" }, { var: "p" }] }, { food: { $tag: "Butter" } });
    const outer = closureOf(["x"], { call: [{ var: "k" }, { var: "x" }] }, { k: inner });
    expect(depIds(pkg(reflect(outer)))).toContain(id("has"));
    const unknown = pkg(reflect(closureOf(["x"], { call: ["zzzNoSuchHelper", { var: "x" }] })));
    expect(unknown.dependencies).toContainEqual({ $tag: "ReifiedDependency", identity: "zzzNoSuchHelper", outcome: UNAVAILABLE });
  });
});

describe("S2 fix 6 — admitted-value snapshot boundary", () => {
  test("a used host function capture refuses; an unused one is dropped", () => {
    const used = closureOf(["x"], { call: [{ var: "h" }, { var: "x" }] }, { h: () => 1 });
    expect(reflect(used)).toEqual(UNAVAILABLE);
    expect((dispatchedReify(used) as R).$tag).toBe("Err");
    const unused = closureOf(["x"], EQ_XY, { h: () => 1, y: 3 });
    expect(pkg(reflect(unused)).captures).toEqual([{ $tag: "ReifiedCapture", name: "y", value: 3, origin: { $tag: "ClosureScope" } }]);
    expect(dispatchedSolveFn(unused)).toEqual({ $tag: "Just", _0: 3 });
  });

  test("a nested opaque handle and an authority handle refuse", () => {
    const nested = closureOf(["x"], EQ_XY, { y: { inner: new Map() } });
    expect(reflect(nested)).toEqual(UNAVAILABLE);
    expect((dispatchedReify(nested) as R).$tag).toBe("Err");
    const authority = mintAuthority(registry, {
      envelope: registry.evaluateAuthorityFunction("authority:descriptorEnvelope", [[]]),
      issuer: "test", accountId: null, principal: null, lane: null, grant: null, mintedAt: 0,
    });
    const held = closureOf(["x"], EQ_XY, { y: authority });
    expect(reflect(held)).toEqual(UNAVAILABLE);
    expect((dispatchedReify(held) as R).$tag).toBe("Err");
  });

  test("a prohibited partial argument refuses", () => {
    const partial = { __fenelPartial: true, fn: closureOf(["x", "y"], EQ_XY), collected: [() => 1], arity: 2 };
    expect(reflect(partial)).toEqual(UNAVAILABLE);
    expect((dispatchedReify(partial) as R).$tag).toBe("Err");
  });

  test("a later mutation of the original never changes an earlier reflection", () => {
    const scope = { y: { k: 1 } };
    const p = pkg(reflect(closureOf(["x"], EQ_XY, scope)));
    const r = dispatchedReify(closureOf(["x"], EQ_XY, scope)) as R;
    scope.y.k = 2;
    expect(p.captures[0].value).toEqual({ k: 1 });
    expect(Object.isFrozen(p.captures[0].value)).toBe(true);
    expect(r._0!.captures).toEqual([{ name: "y", value: { k: 1 } }]);
  });
});

describe("S2 fix 7 — guards, scope-aware substitution, closure metadata", () => {
  test("a capture used only in a match guard is captured", () => {
    const body = { match: [{ var: "x" }, { $guard: [{ $bind: "n" }, { call: ["gt", { var: "n" }, { var: "y" }] }] }, true, false] };
    const closure = closureOf(["x"], body, { y: 3, unused: 4 });
    expect(pkg(reflect(closure)).captures).toEqual([{ $tag: "ReifiedCapture", name: "y", value: 3, origin: { $tag: "ClosureScope" } }]);
    expect((dispatchedReify(closure) as R)._0!.captures).toEqual([{ name: "y", value: 3 }]);
  });

  test("substituteCaptures keeps fields, substitutes guards, and never reaches through a binder", () => {
    const caps = [{ name: "y", value: 1 }];
    const sub = (e: unknown) => dispatchEngineBody("engine:substituteCaptures", [e, caps]) as any;
    const lam = { $tag: "ELambda", params: ["y"], body: { $tag: "EVar", name: "y" } };
    expect(sub(lam)).toEqual(lam);
    const lit = { $tag: "ECall", fnId: "appendItem", args: [{ $tag: "EVar", name: "y" }, { $tag: "ELit", value: [] }], lit: true };
    expect(sub(lit)).toEqual({ ...lit, args: [{ $tag: "ELit", value: 1 }, { $tag: "ELit", value: [] }] });
    const match = {
      $tag: "EMatch",
      scrutinee: { $tag: "EVar", name: "x" },
      arms: [
        { pattern: { $tag: "PatVar", name: "n" }, guard: { $tag: "ECall", fnId: "gt", args: [{ $tag: "EVar", name: "n" }, { $tag: "EVar", name: "y" }] }, body: { $tag: "EVar", name: "y" } },
        { pattern: { $tag: "PatVar", name: "y" }, body: { $tag: "EVar", name: "y" } },
      ],
    };
    const out = sub(match);
    expect(out.arms[0].guard.args[1]).toEqual({ $tag: "ELit", value: 1 });
    expect(out.arms[0].body).toEqual({ $tag: "ELit", value: 1 });
    expect(out.arms[1].body).toEqual({ $tag: "EVar", name: "y" });
  });

  test("a closure with a fix self-binding or a source-function coordinate abstains", () => {
    const fixed = closureOf(["n"], { var: "n" }, {}, { fix: "self" });
    expect(reflect(fixed)).toEqual({ $tag: "OpaqueBody", identity: "", params: ["n"] });
    expect((dispatchedReify(fixed) as R).$tag).toBe("Err");
    const sourced = closureOf(["n"], { var: "n" }, {}, { sourceFunction: id("lube") });
    expect(reflect(sourced)).toEqual({ $tag: "OpaqueBody", identity: "", params: ["n"] });
    expect((dispatchedReify(sourced) as R).$tag).toBe("Err");
  });
});

describe("S2 fix 8 — reader semantics reach the solver consumers", () => {
  test("an imported eq (closed to std:eq, owner established) is the solver's eq", () => {
    expect(dispatchedSolveFn({ $ref: id("isSeven") }, ctx)).toEqual({ $tag: "Just", _0: 7 });
    expect(dispatchedSolveFnAll({ $ref: id("isSeven") }, ctx)).toEqual({ $tag: "Just", _0: [7] });
  });

  test("a bare head the reader resolves to its own function is never read as the std primitive", () => {
    const base = savedReader([
      { id: "Shadow:lt", params: [{ name: "a", type: { $ref: "Number" } }, { name: "b", type: { $ref: "Number" } }], body: true, returns: { $ref: "Boolean" } },
      { id: "Shadow:f", params: [{ name: "x", type: { $ref: "Number" } }], body: { call: ["lt", { var: "x" }, 7] }, returns: { $ref: "Boolean" } },
    ], "Shadow");
    // A reader whose bare `lt` denotes its own function (the registry's own
    // last-wins lookup keeps std's here, so the binding is stated directly).
    const reader = { ...base, getFunction: (n: string) => base.getFunction?.(n === "lt" ? "Shadow:lt" : n) } as EvaluateContext;
    expect(reader.getFunction?.("lt")?.id).toBe("Shadow:lt");
    expect(invokeCallable({ $ref: "Shadow:f" }, [100], reader)).toBe(true);
    expect(dispatchedSolveFn({ $ref: "Shadow:f" }, reader)).toEqual({ $tag: "Nothing" });
  }, 900_000);

  test("a reader-only effectful function is an effect site for the symbolic solver", () => {
    const reader = savedReader([
      { id: "Eff:read", params: [], returns: { $ref: "Number" }, requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "scope" }] }] },
    ], "Eff");
    const fn = closureOf([], { call: ["eq", { call: ["Eff:read"] }, 42] });
    expect(dispatchedSolveFnSymbolic(fn, reader)).toEqual({ $tag: "Just", _0: 42 });
  }, 900_000);
});

describe("S2 fix 9 — reader generation and constructor resolution outcomes", () => {
  test("a reader's source generation does not ride on the package", () => {
    // Since 2026-11-11 a live reading carries no generation: the browser
    // reader's counter moves with every saved-value edit of its tab, and two
    // readings are the same when their content is.
    const packet = { $tag: "ReaderSourceMetadata", source: { $tag: "PublicSource" }, rootId: "r", generation: "7", expressions: [], occurrences: [], callableLabels: [] };
    const reader = readerSourceMetadataEvaluateContext(ctx, packet);
    const plain = pkg(reflect({ $ref: id("lube") }));
    expect(plain.generation).toEqual({ $tag: "Nothing" });
    expect(pkg(reflect({ $ref: id("lube") }, reader))).toEqual(plain);
    expect(invokeCallable({ $ref: id("reflectLube") }, [0], reader)).toEqual(invokeCallable({ $ref: id("reflectLube") }, [0], ctx));
  });

  test("an unknown constructor spelling is kept as ConstructorUnknown", () => {
    const lam = evaluate({ call: [id("lubeLam")] }, {}, ctx) as any;
    const body = JSON.parse(JSON.stringify(lam.body).split('"Butter"').join('"Zorp"'));
    const p = pkg(reflect(closureOf(["pantry"], body)));
    expect(p.constructors).toContainEqual({ $tag: "ConstructorUnknown", written: "Zorp" });
  });

  test("an ambiguous constructor spelling is kept with every target", () => {
    const other = { ...loadFenelModule("module OtherFood where\n\nKind = Butter | Lard\n", "OtherFood") };
    const reader = createRegistry([stdModule, probeModule(), other]).evaluateContext();
    const p = pkg(reflect({ $ref: id("lube") }, reader));
    const butter = p.constructors.find((c: any) => c.written === "Butter");
    expect(butter.$tag).toBe("ConstructorAmbiguous");
    expect([...butter.targets].sort()).toEqual(["@ctor/OtherFood/Kind/Butter", "@ctor/RecipeProbe/Food/Butter"]);
  }, 900_000);
});

// ---------------------------------------------------------------------------
// S2 round 3 (Astra re-review 2026-10-18, items R2-1 to R2-4)
// ---------------------------------------------------------------------------

/** Every witness a solver answers must satisfy ordinary invocation in the reader. */
const witnessesHold = (fn: unknown, reader: EvaluateContext) => {
  const one = dispatchedSolveFn(fn, reader) as { $tag: string; _0?: unknown };
  if (one.$tag === "Just") expect(invokeCallable(fn, [one._0], reader)).toBe(true);
  const all = dispatchedSolveFnAll(fn, reader) as { $tag: string; _0?: unknown[] };
  if (all.$tag === "Just") for (const w of all._0!) expect(invokeCallable(fn, [w], reader)).toBe(true);
};

describe("S2 R2-1 — a primitive head is normalised only when the reader's routing is the admitted primitive", () => {
  const bareEq7 = closureOf(["x"], { call: ["eq", { var: "x" }, 7] });

  test("the unchanged reader still solves through the primitive", () => {
    expect(dispatchedSolveFn({ $ref: id("isSeven") }, ctx)).toEqual({ $tag: "Just", _0: 7 });
    expect(dispatchedSolveFn(bareEq7, ctx)).toEqual({ $tag: "Just", _0: 7 });
  });

  test("same id, reader native override: no witness the reader's own invocation rejects", () => {
    const reader = { ...ctx, natives: { ...(ctx as any).natives, "std:eq": () => false } } as EvaluateContext;
    expect(invokeCallable({ $ref: id("isSeven") }, [7], reader)).toBe(false);
    expect(invokeCallable(bareEq7, [7], reader)).toBe(false);
    witnessesHold({ $ref: id("isSeven") }, reader);
    witnessesHold(bareEq7, reader);
  });

  test("same id, reader context-native override: refused the same way", () => {
    const reader = { ...ctx, nativesCtx: { ...((ctx as any).nativesCtx ?? {}), "std:eq": () => false } } as EvaluateContext;
    expect(invokeCallable({ $ref: id("isSeven") }, [7], reader)).toBe(false);
    witnessesHold({ $ref: id("isSeven") }, reader);
  });

  test("same id, changed definition body: no witness the reader's own invocation rejects", () => {
    const natives = { ...(ctx as any).natives };
    delete natives["std:eq"];
    const reader = {
      ...ctx,
      natives,
      getFunction: (n: string) => {
        const spec = ctx.getFunction?.(n);
        return spec?.id === "std:eq" ? { ...spec, body: false } : spec;
      },
    } as EvaluateContext;
    expect(invokeCallable({ $ref: id("isSeven") }, [7], reader)).toBe(false);
    witnessesHold({ $ref: id("isSeven") }, reader);
    witnessesHold(bareEq7, reader);
  });

  test("a reader-owned primitive spelling is refused when its owner differs from the harness", () => {
    const reader = {
      ...ctx,
      getFunction: (name: string) => name === "eq"
        ? { ...ctx.getFunction!("std:eq")!, id: "eq", body: false }
        : ctx.getFunction?.(name),
      natives: { ...ctx.natives, eq: () => false },
    } as EvaluateContext;
    expect(invokeCallable(bareEq7, [7], reader)).toBe(false);
    witnessesHold(bareEq7, reader);
  });

  test("a reader pre-native type-family refusal cannot yield a rejected witness", () => {
    const reader = { ...ctx, _typeFamilyOwner: () => { throw new Error("unavailable type-family guard"); } } as EvaluateContext;
    expect(() => invokeCallable(bareEq7, [7], reader)).toThrow("unavailable type-family guard");
    witnessesHold(bareEq7, reader);
  });

  test("an actual Set's overridden has method can select a bundle root", () => {
    const names = new Set<string>();
    Object.defineProperty(names, "has", { value: () => true });
    const reader = { ...ctx, _moduleNames: names, _moduleMember: () => ({ kind: "value", value: closureOf(["a", "b"], false) }) } as EvaluateContext;
    expect(invokeCallable(bareEq7, [7], reader)).toBe(false);
    witnessesHold(bareEq7, reader);
  });

  test("a receiver-dependent bare classifier is observed with its reader", () => {
    const reader = {
      ...ctx, _routingTable: undefined, _routingTableVersion: undefined,
      _resolveBareName: function(this: EvaluateContext) {
        if (this === reader) throw new Error("reader classifier refusal");
        return { kind: "direct" as const };
      },
    } as EvaluateContext;
    expect(() => invokeCallable(bareEq7, [7], reader)).toThrow("reader classifier refusal");
    witnessesHold(bareEq7, reader);
  });

  test.each(["plain", "context"] as const)("a %s native overriding the root body cannot produce a false witness", (kind) => {
    const reader = kind === "plain"
      ? { ...ctx, natives: { ...ctx.natives, [id("isSeven")]: () => false } } as EvaluateContext
      : { ...ctx, nativesCtx: { ...ctx.nativesCtx, [id("isSeven")]: () => false } } as EvaluateContext;
    const fn = { $ref: id("isSeven") };
    expect(invokeCallable(fn, [7], reader)).toBe(false);
    witnessesHold(fn, reader);
    expect(reflect(fn, reader).$tag).toBe("Reified");
    const partial = { __fenelPartial: true, fn, collected: [], arity: 1 };
    witnessesHold(partial, reader);
  });
});

describe("S2 R2-2 — the admitted snapshot preserves sharing", () => {
  const f = closureOf(["p"], { var: "p" });
  const UNIQUE_LEN = { call: ["length", { call: ["unique", { var: "xs" }] }] };

  test("a repeated callable in one collection stays one value", () => {
    const closure = closureOf(["u"], UNIQUE_LEN, { xs: [f, f] });
    expect(invokeCallable(closure, [0], ctx)).toBe(1);
    const v = pkg(reflect(closure)).captures[0].value;
    expect(v[0]).toBe(v[1]);
    expect(Object.isFrozen(v[0])).toBe(true);
    expect(evaluate(UNIQUE_LEN, { xs: v }, ctx)).toBe(1);
    const r = (dispatchedReify(closure) as R)._0!.captures[0].value;
    expect(r[0]).toBe(r[1]);
  });

  test("sharing across capture entries and partial arguments", () => {
    const both = closureOf(["u"], { call: ["eq", { var: "a" }, { var: "b" }] }, { a: f, b: f });
    const caps = pkg(reflect(both)).captures;
    expect(caps.find((c: any) => c.name === "a").value).toBe(caps.find((c: any) => c.name === "b").value);
    const base = closureOf(["k", "x"], { call: ["eq", { var: "k" }, { var: "g" }] }, { g: f });
    const partial = { __fenelPartial: true, fn: base, collected: [f], arity: 2 };
    const pcaps = pkg(reflect(partial)).captures;
    expect(pcaps.find((c: any) => c.name === "k").value).toBe(pcaps.find((c: any) => c.name === "g").value);
  });

  test("sharing between a named definition's lexical data, partial arguments and dependency snapshots", () => {
    const namedId = "Snapshot:compare";
    const spec = {
      id: namedId,
      params: [{ name: "k", type: { $ref: "Number" } }, { name: "u", type: { $ref: "Number" } }],
      body: { call: ["eq", { var: "k" }, { var: "g" }] },
      returns: { $ref: "Boolean" },
    };
    const reader = {
      ...ctx,
      getFunction: (name: string) => name === namedId ? spec : ctx.getFunction?.(name),
      getFunctionLexicalData: (name: string) => name === namedId ? { g: f } : ctx.getFunctionLexicalData?.(name),
    } as EvaluateContext;
    const partial = { __fenelPartial: true, fn: { $ref: namedId }, collected: [f], arity: 2 };
    expect(invokeCallable(partial, [0], reader)).toBe(true);
    const captures = pkg(reflect(partial, reader)).captures;
    expect(captures.find((c: any) => c.name === "k").value).toBe(captures.find((c: any) => c.name === "g").value);
    const root = closureOf(["u"], { call: [namedId, { var: "kept" }, { var: "u" }] }, { kept: f });
    const reflected = pkg(reflect(root, reader));
    const dependency = reflected.dependencies.find((d: any) => d.identity === namedId);
    expect(pkg(dependency.outcome).captures[0].value).toBe(reflected.captures[0].value);
  });

  test("a cycle is still refused", () => {
    const o: Record<string, unknown> = { k: 1 };
    o.self = o;
    expect(reflect(closureOf(["x"], EQ_XY, { y: o }))).toEqual(UNAVAILABLE);
  });

  test("a copied closure capture never becomes a witness that fails ordinary invocation", () => {
    const fn = closureOf(["x"], EQ_XY, { y: f });
    expect(invokeCallable(fn, [f], ctx)).toBe(true);
    witnessesHold(fn, ctx);
    expect(dispatchedSolveFn(fn)).toEqual({ $tag: "Nothing" });
    expect(dispatchedSolveFnAll(fn)).toEqual({ $tag: "Nothing" });
    const partial = { __fenelPartial: true, fn: closureOf(["y", "x"], EQ_XY), collected: [f], arity: 2 };
    expect(invokeCallable(partial, [f], ctx)).toBe(true);
    witnessesHold(partial, ctx);
    const unused = closureOf(["x"], EQ_XY, { y: 7, unused: f });
    expect(dispatchedSolveFn(unused, ctx)).toEqual({ $tag: "Just", _0: 7 });
  });

  test("a copied partial capture never becomes a witness that fails ordinary invocation", () => {
    const partial = { __fenelPartial: true, fn: "std:add", collected: [1], arity: 2 };
    const fn = closureOf(["x"], EQ_XY, { y: partial });
    expect(invokeCallable(fn, [partial], ctx)).toBe(true);
    witnessesHold(fn, ctx);
  });

  test("a copied malformed partial keeps its identity-sensitive refusal", () => {
    const partial = { __fenelPartial: true, fn: 42, collected: [], arity: 1 };
    const fn = closureOf(["x"], EQ_XY, { y: { nested: partial } });
    const original = fn.closure.y;
    expect(invokeCallable(fn, [original], ctx)).toBe(true);
    witnessesHold(fn, ctx);
    expect(pkg(reflect(fn)).dependencies).toContainEqual({ $tag: "ReifiedDependency", identity: "", outcome: UNAVAILABLE });
  });
});

describe("S2 R2-3 — captured callables that abstain stay explicit dependencies", () => {
  const uses = (k: unknown) => closureOf(["x"], { call: [{ var: "k" }, { var: "x" }] }, { k });
  const anonymous = (outcome: unknown) => ({ $tag: "ReifiedDependency", identity: "", outcome });

  test("a sourced captured closure", () => {
    const p = pkg(reflect(uses(closureOf(["n"], { var: "n" }, {}, { sourceFunction: id("lube") }))));
    expect(p.dependencies).toContainEqual(anonymous({ $tag: "OpaqueBody", identity: "", params: ["n"] }));
  });

  test("a fix-bearing captured closure", () => {
    const p = pkg(reflect(uses(closureOf(["n"], { var: "n" }, {}, { fix: "self" }))));
    expect(p.dependencies).toContainEqual(anonymous({ $tag: "OpaqueBody", identity: "", params: ["n"] }));
  });

  test("an unliftable or malformed captured closure", () => {
    const unliftable = { var: 3 };
    expect((dispatchedJsonLogicToExpr(unliftable) as R).$tag).toBe("Err");
    const p = pkg(reflect(uses(closureOf(["n"], unliftable))));
    expect(p.dependencies).toContainEqual(anonymous({ $tag: "OpaqueBody", identity: "", params: ["n"] }));
    const malformed = pkg(reflect(uses({ __fenelFn: true, params: "n", body: { var: "n" }, closure: {} })));
    expect(malformed.dependencies).toContainEqual(anonymous(UNAVAILABLE));
  });

  test("a faithful captured closure adds no anonymous entry", () => {
    const p = pkg(reflect(uses(closureOf(["n"], { var: "n" }))));
    expect(p.dependencies.filter((d: any) => d.identity === "")).toEqual([]);
  });
});

describe("S2 R2-4 — identity-only host handles are not admitted as records", () => {
  test("a perform-table handle and the system resolver refuse, beside Map and AuthorityRef", () => {
    const handle = createPerformTableController({ judge: () => true }).handle;
    for (const value of [handle, SYSTEM_RESOLVER, new Map()]) {
      const used = closureOf(["x"], EQ_XY, { y: value });
      expect(reflect(used)).toEqual(UNAVAILABLE);
      expect((dispatchedReify(used) as R).$tag).toBe("Err");
    }
  });

  test("an empty Fenel record is still admitted, also when its frozen copy is reflected again", () => {
    const closure = closureOf(["x"], EQ_XY, { y: {} });
    expect(pkg(reflect(closure)).captures).toEqual([{ $tag: "ReifiedCapture", name: "y", value: {}, origin: { $tag: "ClosureScope" } }]);
    const outer = closureOf(["u"], { call: [{ var: "k" }, 1] }, { k: closure });
    const copied = pkg(reflect(outer)).captures[0].value;
    expect(Object.isFrozen(copied)).toBe(true);
    expect(pkg(reflect(copied)).captures).toEqual([{ $tag: "ReifiedCapture", name: "y", value: {}, origin: { $tag: "ClosureScope" } }]);
  });

  test("a legitimate pre-frozen empty record remains admitted", () => {
    const value = Object.freeze({});
    const captures = pkg(reflect(closureOf(["x"], EQ_XY, { y: value }))).captures;
    expect(captures[0].value).toEqual({});
    expect(Object.isFrozen(captures[0].value)).toBe(true);
  });
});

describe("S2 structural list syntax keeps its meaning under lexical shadowing", () => {
  test("a parsed list literal round-trips under a reader-owned appendItem", () => {
    const source = `module LiteralShadow where

appendItem : (item: Number) -> (items: List Number) -> List Number
appendItem item items = []

literal : (u: Number) -> List Number
literal u = [1, 2]
`;
    const reader = createRegistry([stdModule, loadFenelModule(source, "LiteralShadow")]).evaluateContext();
    const fn = { $ref: "LiteralShadow:literal" };
    expect(invokeCallable(fn, [0], reader)).toEqual([1, 2]);
    const reflected = pkg(reflect(fn, reader));
    const lowered = dispatchedExprToJsonLogic(reflected.body);
    expect(evaluate(lowered, { u: 0 }, reader)).toEqual([1, 2]);
    expect(reflected.body.fnId).toBe("appendItem");
    expect(reflected.body.lit).toBe(true);
  });

  test("a parsed let stays structural application under its module's dollar override", () => {
    const source = `module std where

reflectionLetProbe : (u: Number) -> Number
reflectionLetProbe u = do
    let x = u
    x
  end
`;
    const probe = loadFenelModule(source, "std");
    const base = createRegistry([{ ...stdModule, functions: [...stdModule.functions ?? [], ...probe.functions ?? []] }]).evaluateContext();
    expect((base.getFunctionImportFrame?.("std:reflectionLetProbe") as any).names.$).toBe("std:$");
    const reader = { ...base, natives: { ...base.natives, "std:$": () => 99 } } as EvaluateContext;
    const fn = { $ref: "std:reflectionLetProbe" };
    expect(invokeCallable(fn, [7], reader)).toBe(7);
    const reflected = pkg(reflect(fn, reader));
    const lowered = dispatchedExprToJsonLogic(reflected.body);
    expect(evaluate(lowered, { u: 7 }, reader)).toBe(7);
    expect(reflected.body.fnId).toBe("$");
  });
});

describe("S2 ambiguous callable carriers refuse rather than choose different runtime semantics", () => {
  const apparent = closureOf(["x"], { call: ["eq", { var: "x" }, 7] });
  const partial = { __fenelPartial: true, fn: apparent, collected: [], arity: 1 };
  const cases = [
    ["closure plus partial", { ...apparent, __fenelPartial: true, fn: closureOf(["x"], false), collected: [], arity: 1 }],
    ["reference plus closure", { ...apparent, $ref: "std:not" }],
    ["reference plus partial", { ...partial, $ref: "std:not" }],
    ["inherited reference plus closure", Object.assign(Object.create({ $ref: "std:not" }), apparent)],
  ] as const;

  test.each(cases)("%s", (_name, carrier) => {
    expect(invokeCallable(carrier, [7], ctx)).toBe(false);
    witnessesHold(carrier, ctx);
    expect(reflect(carrier)).toEqual(UNAVAILABLE);
  });

  test("a captured ambiguous carrier keeps its unavailable dependency outcome", () => {
    const carrier = { ...apparent, __fenelPartial: true, fn: closureOf(["x"], false), collected: [], arity: 1 };
    const outer = closureOf(["x"], { call: [{ var: "h" }, { var: "x" }] }, { h: carrier });
    expect(pkg(reflect(outer)).dependencies).toContainEqual({ $tag: "ReifiedDependency", identity: "", outcome: UNAVAILABLE });
  });
});

describe("S2 Boolean control provenance", () => {
  test("parsed ordinary and/or calls keep their reader-owned eager meaning", () => {
    const source = `module BooleanShadow where

and : (a: Boolean) -> (b: Boolean) -> Boolean
and a b = False

or : (a: Boolean) -> (b: Boolean) -> Boolean
or a b = False

ordinaryAnd : (u: Number) -> Boolean
ordinaryAnd u = and True True

ordinaryOr : (u: Number) -> Boolean
ordinaryOr u = or True False
`;
    const reader = createRegistry([stdModule, loadFenelModule(source, "BooleanShadow")]).evaluateContext();
    for (const name of ["ordinaryAnd", "ordinaryOr"]) {
      const fn = { $ref: `BooleanShadow:${name}` };
      expect(invokeCallable(fn, [0], reader)).toBe(false);
      const body = pkg(reflect(fn, reader)).body;
      expect(evaluate(dispatchedExprToJsonLogic(body), { u: 0 }, reader)).toBe(false);
      expect(body.structural).toBe(false);
      expect(body.fnId).toBe(`BooleanShadow:${name === "ordinaryAnd" ? "and" : "or"}`);
    }
  });

  test.each([
    ["and", [17, 23], 23],
    ["and", [0, { call: ["BooleanProbe:explode"] }], 0],
    ["or", [0, 19], 19],
    ["or", ["kept", { call: ["BooleanProbe:explode"] }], "kept"],
  ] as const)("raw %s keeps selected operands and skips dead arguments", (head, args, expected) => {
    let calls = 0;
    const reader = { ...ctx, natives: { ...ctx.natives, "BooleanProbe:explode": () => { calls++; throw new Error("dead argument"); } } } as EvaluateContext;
    const raw = { [head]: args };
    expect(evaluate(raw, {}, reader)).toBe(expected);
    const body = pkg(reflect(closureOf(["u"], raw, {}, { lexicalImports: [{ names: { [head]: "std:not" }, aliases: {} }] }), reader)).body;
    expect(evaluate(dispatchedExprToJsonLogic(body), { u: 0 }, reader)).toBe(expected);
    expect(body.structural).toBe(true);
    expect(body.fnId).toBe(head);
    expect(calls).toBe(0);
  });

  test("partial evaluation preserves ordinary eager calls and their dead-looking throws", () => {
    const raw = { call: ["and", { var: "x" }, { call: ["BooleanProbe:explode"] }] };
    const leaf = { id: "BooleanProbe:explode", params: [], returns: { $ref: "Boolean" } };
    const reader = { ...ctx, getFunction: (name: string) => name === leaf.id ? leaf : ctx.getFunction?.(name), natives: { ...ctx.natives, [leaf.id]: () => { throw new Error("eager argument"); } } } as EvaluateContext;
    expect(() => evaluate(raw, { x: false }, reader)).toThrow("eager argument");
    const residual = dispatchedPartialEvalDetailed(raw, undefined, 100, [leaf]);
    expect(residual.$tag).toBe("Residual");
    if (residual.$tag === "Residual") expect(() => evaluate(dispatchedExprToJsonLogic(residual.expr), { x: false }, reader)).toThrow("eager argument");
  });

  test("normalisation preserves raw controls and resolves ordinary shadowing", () => {
    const bindings = compileModuleCallBindings({ name: "BooleanShadow", functions: [{ id: "BooleanShadow:and", params: [], returns: { $ref: "Boolean" }, body: false }] });
    const normalise = (body: unknown) => dispatchedNormaliseToCore({ name: "BooleanShadow:caller", params: [], body, ctorDefs: {}, callBindings: bindings }) as any;
    expect(normalise({ and: [1, 2] })).toMatchObject({ $tag: "Ok", _0: { body: { fnId: "and", structural: true } } });
    expect(normalise({ call: ["and", 1, 2] })).toMatchObject({ $tag: "Ok", _0: { body: { fnId: "BooleanShadow:and", structural: false } } });
  });

  // A module without a local and/or declaration imports the target native ABI.
  const booleanBindings = compileModuleCallBindings({ name: "BooleanProbe", functions: [] });
  const compileBoolean = (body: unknown, params: string[] = [], runtime: Record<string, unknown> = {}) => {
    const compiled = compileFenelToJsNative({ name: "BooleanProbe:compiled", params: positionalCompileFieldSlots(params), body, ctorDefs: {}, callBindings: booleanBindings });
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return () => undefined;
    const serialized = dispatchedSerializeJsModule(compiled._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag !== "Ok") return () => undefined;
    return new Function("$fenel", `return ${serialized._0};`)({ ...parserBaseRuntimeForTests(), ...runtime }) as (...args: unknown[]) => unknown;
  };
  const ordinaryBoolean = (head: string, args: unknown[], runtime: Record<string, unknown> = {}) =>
    compileBoolean({ call: [head, ...args] }, [], runtime)();

  test.each([["and", [17, 23]], ["or", [0, 19]]] as const)("compiled ordinary %s returns the native Boolean result", (head, args) => {
    expect(ordinaryBoolean(head, [...args])).toBe(true);
  });

  test("compiled ordinary calls preserve the actual runtime implementation", () => {
    expect(ordinaryBoolean("and", [true, true], { and: () => false })).toBe(false);
  });

  test("compiled ordinary calls evaluate all arguments once in order", () => {
    const order: number[] = [];
    const runtime = { "BooleanProbe:tick": (n: number) => { order.push(n); return n; } };
    const value = ordinaryBoolean("and", [0, 2, 3].map(n => ({ call: ["BooleanProbe:tick", n] })), runtime);
    expect(order).toEqual([0, 2, 3]);
    expect(value).toBe(false);
  });

  test("compiled ordinary calls evaluate a surplus throwing argument", () => {
    const runtime = { "BooleanProbe:explode": () => { throw new Error("trailing argument"); } };
    expect(() => ordinaryBoolean("or", [true, false, { call: ["BooleanProbe:explode"] }], runtime)).toThrow("trailing argument");
  });

  test.each(["and", "or"])("compiled ordinary %s agrees with stock Bool-carrier normalization", head => {
    for (const operands of [[{ $tag: "False" }, true], [{ $tag: "True" }, false], [false, { $tag: "False" }]]) {
      expect(ordinaryBoolean(head, operands)).toBe(evaluate({ call: [head, ...operands] }, {}, ctx));
    }
  });

  test("compiled ordinary Boolean underapplication remains unsupported", () => {
    for (const head of ["and", "or"]) {
      for (const args of [[], [true]]) {
        expect(compileFenelToJsNative({ name: "BooleanProbe:underApplied", params: [], body: { call: [head, ...args] }, ctorDefs: {}, callBindings: booleanBindings }).$tag).toBe("Err");
      }
    }
  });

  test.each(["std:and", "std:or"])("canonical ordinary %s stays callable with its declared arity", head => {
    expect(ordinaryBoolean(head, [17, 23])).toBe(true);
  });

  test.each([
    ["std:and", []], ["std:and", [false]],
    ["std:or", []], ["std:or", [false]],
  ] as const)("canonical ordinary %s underapplication keeps the partial boundary (%j)", (head, args) => {
    expect(invokeCallable({ $ref: head }, [...args], ctx)).toMatchObject({ __fenelPartial: true, arity: 2 });
    expect(compileFenelToJsNative({ name: "BooleanProbe:canonicalUnderApplied", params: [], body: { call: [head, ...args] }, ctorDefs: {}, callBindings: booleanBindings }).$tag).toBe("Err");
  });

  test.each(["and", "or"])("compiled raw %s retains empty and singleton identities", head => {
    expect(compileBoolean({ [head]: [] })()).toBe(head === "and");
    expect(compileBoolean({ [head]: [17] })()).toBe(17);
  });

  test("compiled raw variadic controls select an operand", () => {
    for (const head of ["and", "or"]) {
      expect(compileBoolean({ [head]: [17, 23, 29] })()).toBe(evaluate({ [head]: [17, 23, 29] }, {}, ctx));
    }
  });

  test.each(["and", "or"])("compiled raw %s preserves evaluator truthiness and selected values", head => {
      const raw = { [head]: [{ var: "x" }, { var: "y" }] };
      const fn = compileBoolean(raw, ["x", "y"]);
      for (const x of ["0", [], { $tag: "False" }, { $tag: "True" }, false, true, 17]) {
        const y = { selected: "right" };
        expect(fn(x, y)).toBe(evaluate(raw, { x, y }, ctx));
      }
  });

  test("compiled raw controls skip throwing dead arguments", () => {
    let deadCalls = 0;
    const runtime = { "BooleanProbe:explode": () => { deadCalls++; throw new Error("compiled dead argument"); } };
    expect(compileBoolean({ and: ["0", { call: ["BooleanProbe:explode"] }] }, [], runtime)()).toBe("0");
    expect(compileBoolean({ or: [19, { call: ["BooleanProbe:explode"] }] }, [], runtime)()).toBe(19);
    expect(deadCalls).toBe(0);
  });
});

describe("S2 IF control provenance", () => {
  const shadowSpec = { id: "IfProbe:shadow", params: ["condition", "yes", "no"].map(name => ({
    name, key: { $tag: "PositionalField", index: ["condition", "yes", "no"].indexOf(name) },
    type: { $ref: "Boolean" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
  })), returns: { $ref: "Boolean" } } as any;
  const shadowReader = (native: (...args: unknown[]) => unknown): EvaluateContext => ({
    ...ctx, getFunction: name => name === "if" || name === shadowSpec.id ? shadowSpec : ctx.getFunction?.(name),
    natives: { ...ctx.natives, [shadowSpec.id]: native },
  });
  const lift = (logic: unknown) => {
    const lifted = dispatchedJsonLogicToExpr(logic, {}) as any;
    expect(lifted.$tag).toBe("Ok");
    if (lifted.$tag !== "Ok") throw new Error("the actual IF fixture did not lift");
    return lifted._0;
  };

  test("parsed and raw controls carry true provenance and retain lazy selected values", () => {
    const parsed = loadFenelModule("module IfSyntax where\nchoose : Boolean -> Number\nchoose x = if x then 17 else 29\n", "IfSyntax");
    const body = parsed.functions?.find(fn => fn.id === "IfSyntax:choose")?.body;
    expect(body).toBeDefined();
    expect(lift(body)).toMatchObject({ fnId: "if", structural: true });
    let calls = 0;
    const reader = shadowReader(() => { calls++; return "shadow"; });
    const raw = { if: [false, { call: [shadowSpec.id, true, true, true] }, 29] };
    const core = lift(raw);
    expect(core).toMatchObject({ fnId: "if", structural: true });
    expect(evaluate(dispatchedExprToJsonLogic(core), {}, reader)).toBe(29);
    expect(calls).toBe(0);
    const variable = { if: [{ var: "x" }, 17, 29] };
    const variableCore = lift(variable);
    // Interpreter/codec truthiness includes non-Bool legacy carriers. This is
    // separate from the compiler's existing, narrower Bool-condition contract.
    for (const x of ["0", [], { $tag: "False" }, false, true, 17]) {
      expect(evaluate(dispatchedExprToJsonLogic(variableCore), { x }, reader)).toBe(evaluate(variable, { x }, reader));
    }
  });

  test("ordinary if calls retain false provenance, eager operands and their selected reader target", () => {
    const order: string[] = [];
    const base = shadowReader((...args) => { order.push("if"); return { selected: "shadow", args }; });
    const reader = { ...base, natives: { ...base.natives, "IfProbe:tick": (n: unknown) => { order.push(String(n)); return n; } } };
    const ordinary = { call: ["if", false, { call: ["IfProbe:tick", 1] }, { call: ["IfProbe:tick", 2] }] };
    const core = lift(ordinary);
    expect(core).toMatchObject({ fnId: "if", structural: false });
    expect(evaluate(dispatchedExprToJsonLogic(core), {}, reader)).toEqual({ selected: "shadow", args: [false, 1, 2] });
    expect(order).toEqual(["1", "2", "if"]);
    const closure = closureOf(["unused"], ordinary, {}, { lexicalImports: [{ names: { if: shadowSpec.id }, aliases: {} }] });
    const reflected = pkg(reflect(closure, reader));
    expect(reflected.body).toMatchObject({ fnId: shadowSpec.id, structural: false });
    expect(depIds(reflected)).toContain(shadowSpec.id);
  });

  test("ordinary if partial evaluation cannot skip a dead-looking throwing operand", () => {
    const leaf = { id: "IfProbe:explode", params: [], returns: { $ref: "Boolean" } };
    const reader = shadowReader(() => true);
    reader.natives = { ...reader.natives, [leaf.id]: () => { throw new Error("ordinary IF operand"); } };
    const ordinary = { call: ["if", false, { call: [leaf.id] }, 7] };
    expect(() => evaluate(ordinary, {}, reader)).toThrow("ordinary IF operand");
    const residual = dispatchedPartialEvalDetailed(ordinary, undefined, 100, [leaf]);
    expect(residual.$tag).toBe("Residual");
    if (residual.$tag === "Residual") {
      expect(residual.expr).toMatchObject({ fnId: "if", structural: false });
      expect(() => evaluate(dispatchedExprToJsonLogic(residual.expr), {}, reader)).toThrow("ordinary IF operand");
    }
  });

  test("normalisation keeps structural if independent of an ordinary same-name binding", () => {
    const bindings = compileModuleCallBindings({ name: "IfProbe", functions: [{ id: "IfProbe:if", params: [], returns: { $ref: "Boolean" }, body: false }] });
    const normalise = (body: unknown) => dispatchedNormaliseToCore({ name: "IfProbe:caller", params: [], body, ctorDefs: {}, callBindings: bindings }) as any;
    expect(normalise({ if: [true, 17, 29] })).toMatchObject({ $tag: "Ok", _0: { body: { fnId: "if", structural: true } } });
    expect(normalise({ call: ["if", true, 17, 29] })).toMatchObject({ $tag: "Ok", _0: { body: { fnId: "IfProbe:if", structural: false } } });
  });

  test("pruning an outer structural if preserves a selected ordinary if branch", () => {
    const outer = { if: [true, { call: ["if", { var: "x" }, 17, 29] }, 0] };
    const reader = shadowReader(() => "ordinary branch");
    expect(evaluate(outer, { x: false }, reader)).toBe("ordinary branch");
    const residual = dispatchedPartialEvalDetailed(outer, undefined, 100);
    expect(residual.$tag).toBe("Residual");
    if (residual.$tag === "Residual") {
      expect(residual.expr).toMatchObject({ fnId: "if", structural: false });
      expect(evaluate(dispatchedExprToJsonLogic(residual.expr), { x: false }, reader)).toBe("ordinary branch");
    }
  });

  test("compiled ordinary if remains eager while structural if retains Bool-condition behavior", () => {
    const compile = (body: unknown, runtime: Record<string, unknown> = {}) => {
      const result = compileFenelToJsNative({ name: "IfProbe:compiled", params: positionalCompileFieldSlots(["x"]), body, ctorDefs: {},
        callBindings: compileModuleCallBindings({ name: "IfProbe", functions: [] }) });
      expect(result.$tag).toBe("Ok");
      if (result.$tag !== "Ok") throw new Error("IF compilation refused an actual admitted control");
      const serialized = dispatchedSerializeJsModule(result._0);
      expect(serialized.$tag).toBe("Ok");
      if (serialized.$tag !== "Ok") throw new Error("IF serialization failed");
      return new Function("$fenel", `return ${serialized._0};`)({ ...parserBaseRuntimeForTests(), ...runtime }) as (x: unknown) => unknown;
    };
    const calls: number[] = [];
    expect(compile({ call: ["if", { var: "x" }, 17, 29] }, { if: (...args: unknown[]) => { calls.push(args.length); return "ordinary"; } })(false)).toBe("ordinary");
    expect(calls).toEqual([3]);
    const raw = { if: [{ var: "x" }, 17, 29] };
    const compiled = compile(raw);
    for (const x of [false, true]) expect(compiled(x)).toBe(evaluate(raw, { x }, ctx));
  });

  test("a reader-owned ordinary if cannot be certified through the structural branch rule", () => {
    const ordinary = { call: ["if", false, true, false] };
    expect(evaluate(ordinary, {}, shadowReader(() => true))).toBe(true);
    const core = lift(ordinary);
    expect(dispatchEngineBody("engine:checkExpr", [core, [], { $tag: "SeEnum", values: [false] }])).toEqual({ $tag: "Nothing" });
  });
});
