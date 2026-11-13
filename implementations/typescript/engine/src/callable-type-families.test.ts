import { beforeAll, describe, expect, test } from "bun:test";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { eagerEvaluatorInstance, evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { createDispatchRegistry } from "./dispatch-registry";
import { loadFenelModule } from "./fenel-module";
import { parse } from "./fenel-parser";
import { evaluate, invokeCallable, moduleSourceCoordinate, resolveCompleteMethodForEvaluation, type EvaluateContext } from "./json-logic";
import { peelEl } from "./dependent-types";
import { projectCallableTypeFamily } from "./callable-type-families";
import { Nothing } from "./type-foundation";
import { mintAuthority } from "./authority";
import { turn } from "../../runtime/src/evaluator";
import { compileRegistryDeclarationCallBindings } from "./compile-call-bindings";
import { inferAuthoringFunctionDraft } from "./authoring/function-draft";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./authoring/environment";
import { print } from "./engine-bodies-dispatch";
import type { FenelModule, FenelType } from "./types";

let registry: ModuleRegistry;
let ctx: EvaluateContext;
const PRIVATE_FAMILY = "49b58f36-01db-4e9f-9c15-3d8785f135d7";
beforeAll(() => {
  const fixture = loadFenelModule(`module familyTest where
Phantom a b = MkPhantom a
Box f a = MkBox value: f a
identity : a -> a
identity a = a
typeIdentity : Type -> Type
typeIdentity value = value
`, "familyTest");
  const consumer = { ...loadFenelModule(String.raw`module familyConsumer where
fromAlias : Type -> Type
fromAlias input = fam.Box Maybe input
shadow : Type -> Type
shadow input = (\fam -> fam.Box input) { Box = \value -> value, note = 0 }
`, "familyConsumer"), imports: [{ module: "familyTest", as: "fam" }] };
  const privateBody: FenelType = { $variant: { cases: [{ name: "PrivateFamilyValue", label: Nothing, fields: [{
    name: "_0", key: { $tag: "PositionalField", index: 0 }, type: { $var: "a" }, label: Nothing, ui: Nothing, meta: {},
  }] }] } };
  const privateFamily: FenelModule = { name: "privateFamily", label: "Private family", entities: [{
    id: PRIVATE_FAMILY, type: privateBody, params: ["a"], typeScheme: {
      quantified: [{ id: "private-family-a", sourceName: "a", kind: { $tag: "KType" } }], body: privateBody,
    },
  }] };
  registry = createRegistry([stdModule, evaluatorStrategiesModule, fixture, consumer, privateFamily], {
    publishCatalogEntities: false,
    fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source", identityKinds: new Map([[PRIVATE_FAMILY, "type"]]) },
  });
  ctx = { ...registry.evaluateContext(), _sourceFunction: moduleSourceCoordinate("familyTest") };
}, 180_000);

const run = (source: string) => evaluate(parse(source), {}, ctx);

describe("declared type families as callable data", () => {
  test("real source maps Maybe over Type data and expands once", () => {
    const actual = run("map Maybe [Number, String]") as FenelType[];
    expect(actual).toHaveLength(2);
    expect(actual[0]).toHaveProperty("$el");
    expect(actual[1]).toHaveProperty("$el");
    const number = peelEl(actual[0]!, {}, ctx);
    const string = peelEl(actual[1]!, {}, ctx);
    expect(number).toBeDefined();
    expect(string).toBeDefined();
    expect(JSON.stringify(number)).toContain("Number");
    expect(JSON.stringify(string)).toContain("String");
    expect(number).not.toEqual(string);
  });

  test("Result partial application is an ordinary reusable callable", () => {
    const partial = run("Result String");
    const result = invokeCallable(partial, [{ $ref: "Number" }], ctx) as FenelType;
    expect(result).toEqual(run("Result String Number") as FenelType);
    expect(result).toHaveProperty("$el");
    expect(peelEl(result, {}, ctx)).toHaveProperty("$variant");
  });

  test("repeated calls preserve the family handle and constructor field identity", () => {
    const first = run("Maybe Number") as FenelType;
    const second = run("Maybe Number") as FenelType;
    expect(first).toEqual(second);
    expect(peelEl(first, {}, ctx)).toEqual(peelEl(second, {}, ctx));
    expect(registry.getFunction("Maybe")?.params).toHaveLength(1);
    expect(registry.getFunctionScheme("Maybe")?.quantified).toEqual([]);
  });

  test("invalid data and excess arguments fail at application", () => {
    expect(() => run("Maybe 42")).toThrow("kind");
    expect(() => run("Maybe Number String")).toThrow("too many");
    expect(() => run("Result 42")).toThrow("kind");
    expect(() => run("Maybe Maybe")).toThrow("wrong kind");
    let reads = 0;
    const accessor = Object.defineProperty({}, "$ref", { get() { reads++; return "Number"; } });
    expect(() => invokeCallable({ $ref: "Maybe" }, [accessor], ctx)).toThrow("Accessor");
    expect(reads).toBe(0);
    expect(() => invokeCallable({ $ref: "Maybe" }, [{ $record: { fields: [{ name: "bad", type: 42 }] } }], ctx)).toThrow();
  });

  test("declared unused parameters remain runtime parameters; forall does not", () => {
    expect(registry.getFunction("Phantom")?.params.map(param => param.name)).toEqual(["a", "b"]);
    expect(registry.getFunction("familyTest:identity")?.params).toHaveLength(1);
    expect(registry.getFunction("familyTest:identity")?.params[0]?.type).not.toEqual({ $type: true });
  });

  test("higher-kinded parameters are ordinary Type arrows", () => {
    const owner = ctx._typeFamilyOwner?.("Box", ctx._sourceFunction);
    expect(owner).toBeDefined();
    const projected = projectCallableTypeFamily(owner!);
    expect(projected?.fn.params[0]?.type).toHaveProperty("$arrow");
    const result = run("familyTest.Box Maybe Number") as FenelType;
    expect(result).toHaveProperty("$el");
    expect(peelEl(result, {}, ctx)).toBeDefined();
    expect(() => run("familyTest.Box Number Number")).toThrow("wrong kind");
    const partial = run("familyTest.Box (Result String) Number") as FenelType;
    const expanded = peelEl(partial, {}, ctx) as { $record: { fields: Array<{ type: FenelType }> } };
    expect(peelEl(expanded.$record.fields[0]!.type, {}, ctx)).toHaveProperty("$variant");
    expect(() => run("familyTest.Box identity Number")).toThrow("kind");
    const ordinary = run("familyTest.Box typeIdentity Number") as FenelType;
    const expandedOrdinary = peelEl(ordinary, {}, ctx) as { $record: { fields: Array<{ type: FenelType }> } };
    const ordinaryField = expandedOrdinary.$record.fields[0]!.type as Extract<FenelType, { $el: unknown }>;
    expect(evaluate(ordinaryField.$el, {}, ctx)).toEqual({ $ref: "Number" });
    // This remains a genuine dependent expression. The reader now owns the
    // strategy's actual nominal declaration and its existing implementation.
    expect(resolveCompleteMethodForEvaluation(ctx, "Evaluator", "eval", ["EagerStrategy"])?.$tag).toBe("Resolved");
    expect(peelEl(ordinaryField, {}, ctx)).toEqual({ $ref: "Number" });
  });

  test("unresolved source strategy arguments still refuse complete selection without polluting other readers", () => {
    const actual = ctx._specRegistry;
    if (actual === undefined) throw new Error("The actual fixture dispatch registry is unavailable");
    const dependent: FenelType = { $el: { var: "type" } };
    const absent = createRegistry([stdModule], { publishCatalogEntities: false }).evaluateContext();
    expect(resolveCompleteMethodForEvaluation(absent, "Evaluator", "eval", ["EagerStrategy"]))
      .not.toMatchObject({ $tag: "Resolved" });
    expect(peelEl(dependent, { type: { $ref: "Number" } }, absent)).toBeUndefined();
    // A fresh pool is essential: a source-backed registry forwards writes to
    // that source and would leak this deliberately unresolved row to other tests.
    const isolated = createDispatchRegistry();
    for (const cls of actual.listClasses()) isolated.defineClass(cls);
    for (const row of actual.listInstances()) isolated.addInstance(row);
    const general = loadFenelModule(`module familyGeneralEvaluator where
unresolvedEvaluator : Evaluator MissingStrategy
unresolvedEvaluator = Evaluator { eval = evaluatorStrategies.eagerEval }
`, "familyGeneralEvaluator", { dispatchInstanceFile: true });
    const row = general.instances?.find(instance => instance.typeName === "Evaluator");
    if (row === undefined) throw new Error("The actual unresolved source instance is unavailable");
    isolated.addInstance(row, { declaringModule: general.name });
    const generalReader = createRegistry([stdModule, evaluatorStrategiesModule, general], {
      dispatchRegistry: isolated, publishCatalogEntities: false,
    }).evaluateContext();
    expect(resolveCompleteMethodForEvaluation(generalReader, "Evaluator", "eval", ["EagerStrategy"]))
      .toMatchObject({ $tag: "CompleteUnsupported", _0: expect.stringContaining("general instance") });
    expect(peelEl(dependent, { type: { $ref: "Number" } }, generalReader)).toBeUndefined();

    // An actual complete block selection still precedes pooled general rows.
    const scoped: EvaluateContext = { ...generalReader, _dictStack: [{
      typeName: eagerEvaluatorInstance.typeName, args: [...eagerEvaluatorInstance.args],
      methods: eagerEvaluatorInstance.methods,
    }] };
    expect(resolveCompleteMethodForEvaluation(scoped, "Evaluator", "eval", ["EagerStrategy"]))
      .toMatchObject({ $tag: "Resolved" });
    expect(peelEl(dependent, { type: { $ref: "Number" } }, scoped)).toEqual({ $ref: "Number" });
    const incomplete: EvaluateContext = { ...generalReader, _dictStack: [{
      typeName: eagerEvaluatorInstance.typeName, args: [{ $var: "strategy" }], methods: eagerEvaluatorInstance.methods,
    }] };
    expect(resolveCompleteMethodForEvaluation(incomplete, "Evaluator", "eval", ["EagerStrategy"]))
      .toMatchObject({ $tag: "CompleteUnsupported", _0: expect.stringContaining("block frame") });
    expect(resolveCompleteMethodForEvaluation(ctx, "Evaluator", "eval", ["EagerStrategy"]))
      .toMatchObject({ $tag: "Resolved" });
  }, 180_000);

  test("source aliases select the family and lexical data shadows the alias", () => {
    const aliased: EvaluateContext = {
      ...ctx, _sourceFunction: moduleSourceCoordinate("familyConsumer"),
      _importStack: [registry.getModuleImportFrame("familyConsumer")!],
    };
    expect(evaluate(parse("fam.Box Maybe Number"), {}, aliased)).toEqual(run("familyTest.Box Maybe Number"));
    expect(run("familyConsumer.shadow Number")).toEqual({ $ref: "Number" });
    expect(registry.resolveFunctionDraftReferences("familyConsumer:fromAlias", ["fam.Box"])[0]?.status).toBe("resolved");
  });

  test("closures without checked kind evidence refuse without evaluating their bodies", () => {
    let calls = 0;
    const observed: EvaluateContext = { ...ctx, natives: { ...ctx.natives, marked: () => { calls++; return { $ref: "Number" }; } } };
    const closure = evaluate(parse(String.raw`\type -> marked type`), {}, observed);
    expect(() => invokeCallable({ $ref: "Box" }, [closure, { $ref: "Number" }], observed)).toThrow("no established Type or type-generator kind");
    expect(calls).toBe(0);
  });

  test("captured whole-function draft inference sees the same family callable scheme", () => {
    const registered = registry.getFunction("familyConsumer:fromAlias")!;
    const fn = { ...registered, body: { call: ["Maybe", { var: "input" }] } };
    const slot = { $tag: "Authored" as const, source: { $tag: "HostSpec" as const, module: "familyConsumer" } };
    const declaration = { functionId: fn.id, declarationName: "fromAlias", codeName: "fromAlias", params: fn.params.map(() => slot), returns: slot,
      scheme: { quantified: [], body: { $arrow: { params: fn.params, returns: { $type: true } } } } } as const;
    const snapshot = buildAuthoringCatalogSnapshot([], { registry, sourceModule: "familyConsumer",
      codeNameFor: identity => identity === PRIVATE_FAMILY ? "PrivateFamily" : undefined });
    const captured = createAuthoringEnvironment(snapshot);
    expect(captured.getFunctionEntry?.("PrivateFamily")?.id).toBe(PRIVATE_FAMILY);
    expect(captured.getFunctionEntry?.("Maybe")?.params[0]?.type).toEqual({ $type: true });
    expect(captured.getFunctionEntry?.("fam.Box")?.params[0]?.type).toHaveProperty("$arrow");
    const inferred = inferAuthoringFunctionDraft(fn, declaration, captured, { registry });
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.fn?.returns).toEqual({ $type: true });
    expect(inferred.fn?.params).toEqual(fn.params);
    const callBindings = compileRegistryDeclarationCallBindings(registry);
    expect(callBindings.has("familyTest:identity")).toBe(true);
    expect(callBindings.has("Maybe")).toBe(false);
    expect(callBindings.has(PRIVATE_FAMILY)).toBe(false);
  });

  test("application sidecars and reader misses stay authoritative", () => {
    const owner = ctx._typeFamilyOwner!("Box", ctx._sourceFunction)!;
    const incomplete = { ...owner, typeScheme: { ...owner.typeScheme!, applications: [] } };
    const incompleteFrame: EvaluateContext = {
      ...ctx, _typeFamilyOwner: (name, source) => name === owner.identity ? incomplete : ctx._typeFamilyOwner!(name, source),
    };
    expect(peelEl(run("familyTest.Box Maybe Number") as FenelType, {}, incompleteFrame)).toBeUndefined();
    const hidden: EvaluateContext = {
      ...ctx, getFunction: name => name === owner.identity ? undefined : ctx.getFunction?.(name),
      _typeFamilyOwner: (name, source) => name === owner.identity ? undefined : ctx._typeFamilyOwner!(name, source),
    };
    expect(() => invokeCallable({ $ref: owner.identity }, [{ $ref: "Maybe" }, { $ref: "Number" }], hidden)).toThrow("not a function");
  });

  test("a captured private family keeps the existing Type UUID and is unreadable in another registry", () => {
    const result = invokeCallable({ $ref: PRIVATE_FAMILY }, [{ $ref: "Number" }], ctx) as FenelType;
    expect(result).toEqual({ $el: { call: [PRIVATE_FAMILY, { $ref: "Number" }] } });
    expect(peelEl(result, {}, ctx)).toHaveProperty("$variant");
    expect(registry.getFunction(PRIVATE_FAMILY)?.id).toBe(PRIVATE_FAMILY);
    expect(registry.getIdentifiedEntity(PRIVATE_FAMILY)).toBeDefined();
    const other = createRegistry([], { publishCatalogEntities: false });
    expect(other.getFunction(PRIVATE_FAMILY)).toBeUndefined();
    expect(invokeCallable({ $ref: PRIVATE_FAMILY }, [{ $ref: "Number" }], other.evaluateContext())).toBeNull();
  }, 120_000);

  test("locked family expansion resolves owner aliases before inserting the reader's argument", () => {
    const owner = loadFenelModule("module ownerAtoms where\nShared = OwnerShared", "ownerAtoms");
    const reader = loadFenelModule("module readerAtoms where\nShared = ReaderShared", "readerAtoms");
    const family = { ...loadFenelModule("module lexicalFamily where\nLexFamily a = WrapLex fixed: chosen.Shared value: a", "lexicalFamily"),
      imports: [{ module: "ownerAtoms", as: "chosen" }] };
    const consumer = { ...loadFenelModule("module lexicalReader where", "lexicalReader"), imports: [{ module: "readerAtoms", as: "chosen" }, { module: "lexicalFamily", as: "F" }] };
    const familyId = "40e1443d-d03d-4216-805a-026761d7c808";
    const ownerId = "616bf1b5-a34f-4c5e-919a-ae8e477ae1a6";
    const readerId = "7519e83b-7aaf-4e92-b0df-b0f75958aa88";
    const locked = createRegistry([stdModule, owner, reader, family, consumer], { publishCatalogEntities: false, codeNameLock: new Map([
      ["type/module/lexicalFamily/LexFamily", familyId], ["type/module/ownerAtoms/Shared", ownerId], ["type/module/readerAtoms/Shared", readerId],
    ]) });
    const frame = { ...locked.evaluateContext(), _sourceFunction: moduleSourceCoordinate("lexicalReader"), _importStack: [locked.getModuleImportFrame("lexicalReader")!] };
    const application = invokeCallable({ $ref: familyId }, [{ $ref: readerId }], frame) as FenelType;
    expect(application).toEqual({ $el: { call: [familyId, { $ref: readerId }] } });
    const expanded = peelEl(application, {}, frame) as { $record: { fields: Array<{ name: string; type: FenelType }> } };
    expect(expanded.$record.fields.find(field => field.name === "fixed")?.type).toEqual({ $ref: ownerId });
    expect(expanded.$record.fields.find(field => field.name === "value")?.type).toEqual({ $ref: readerId });
    const snapshot = buildAuthoringCatalogSnapshot([], { registry: locked, sourceModule: "lexicalReader" });
    const authoring = createAuthoringEnvironment(snapshot);
    expect(authoring.getFunctionEntry?.("F.LexFamily")?.id).toBe(familyId);
    const originalRoute = snapshot.exactFunctionRoutes?.find(route => route.sourceName === "F.LexFamily");
    if (originalRoute) originalRoute.targetId = readerId;
    expect(authoring.getFunctionEntry?.("F.LexFamily")?.id).toBe(familyId);
    const source = print({ call: [familyId, { $ref: readerId }] }, undefined, { referenceRoutes: authoring.catalog.referenceRoutes });
    expect(source).toContain("LexFamily");
    expect(source).not.toContain(familyId);
    expect(evaluate(parse(source), {}, frame)).toEqual(application);
  }, 120_000);

  test("durable evaluation uses the ordinary pure callable path", () => {
    const authority = mintAuthority(registry, {
      envelope: registry.evaluateAuthorityFunction("authority:descriptorEnvelope", [[]]),
      issuer: "test", accountId: "callable-families", principal: null, lane: null, grant: null, mintedAt: 0,
    });
    const result = turn({ stack: [{ exprs: [parse("map Maybe [Number, String]")], index: 0 }], env: {}, letTarget: Nothing }, registry, authority);
    expect(result.outcome).toBe("done");
    if (result.outcome === "done") expect(result.value).toEqual(run("map Maybe [Number, String]"));
  });
});
