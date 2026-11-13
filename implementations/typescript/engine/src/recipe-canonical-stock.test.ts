// C1: source pool isolation and actual native mediation; no method executes.
import { expect, test } from "bun:test";
import { createStockDispatchRegistry, dispatchRegistry } from "./system-entities";
import { getInterfaceTypeSchemeSource } from "./signature-declaration-transport";
import { createRegistry } from "./registry";
import { noPerformEvaluateContext } from "./json-logic";
import { stdModule } from "./modules/std";
import { emailModule } from "./modules/email";
import { loadFenelModule } from "./fenel-module";
import { cloneStockSourceData, stockSourceModule } from "./stock-source-module";
import { codecModule } from "./modules/codec";
import { reflectionCanonicalFunctionDeclaration } from "./engine-bodies-dispatch";
import { repositoryIdentityLock } from "./repository-identity-manifest";

test("stock sources precede in-place global class and instance mutations", () => {
  const core = dispatchRegistry.getClass("Reprable")!;
  const moduleClass = dispatchRegistry.getClass("CanonicalListDomain")!;
  const instance = dispatchRegistry.listInstances("Reprable").find(row => row.args[0] === "JsRuntime" && row.args[1] === "List")!;
  const stdRow = dispatchRegistry.listInstances("Codeable").find(row => row.args[0] === "std:some")!;
  expect(core.params?.length).toBeGreaterThan(0);
  expect(moduleClass.params?.length).toBeGreaterThan(0);
  expect(instance).toBeDefined();
  expect(stdRow).toBeDefined();
  const expectedCore = cloneStockSourceData(core);
  const expectedModule = cloneStockSourceData(moduleClass);
  const originalLift = instance.methods.lift;
  const originalStdMethods = cloneStockSourceData(stdRow.methods);
  const stdKey = Object.keys(stdRow.methods)[0]!;
  const originalStdValue = stdRow.methods[stdKey];
  core.params![0]!.name = "poisoned-core-param";
  core.methods[0]!.name = "poisoned-core-method";
  moduleClass.params![0]!.name = "poisoned-module-param";
  moduleClass.methods[0]!.name = "poisoned-module-method";
  instance.methods.lift = { $ref: "std:id" };
  stdRow.methods[stdKey] = "poisoned-std-name";
  try {
    // Deliberately the first factory call in this file.
    const stock = createStockDispatchRegistry();
    expect(stock.getClass("Reprable")).toEqual(expectedCore);
    expect(stock.getClass("CanonicalListDomain")).toEqual(expectedModule);
    expect(stock.listInstances("Reprable").find(row => row.args[0] === "JsRuntime" && row.args[1] === "List")?.methods.lift).toEqual(originalLift);
    const sourceDefinition = stockSourceModule(stdModule);
    expect(sourceDefinition.instances?.find(row => row.typeName === "Codeable" && row.args[0] === "std:some")?.methods).toEqual(originalStdMethods);
  } finally {
    core.params![0]!.name = expectedCore.params![0]!.name;
    core.methods[0]!.name = expectedCore.methods[0]!.name;
    moduleClass.params![0]!.name = expectedModule.params![0]!.name;
    moduleClass.methods[0]!.name = expectedModule.methods[0]!.name;
    instance.methods.lift = originalLift;
    stdRow.methods[stdKey] = originalStdValue;
  }
}, 900_000);

test("stock pool and module copies do not expose their private method or byte templates", () => {
  const first = createStockDispatchRegistry();
  const expected = cloneStockSourceData(first.getClass("Reprable"));
  first.getClass("Reprable")!.params![0]!.name = "changed-copy-param";
  first.getClass("Reprable")!.methods[0]!.name = "changed-copy-method";
  first.listInstances("Reprable").find(row => row.args[0] === "JsRuntime" && row.args[1] === "List")!.methods.lift = { $ref: "std:id" };
  const second = createStockDispatchRegistry();
  expect(second.getClass("Reprable")).toEqual(expected);
  expect(second.listInstances("Reprable").find(row => row.args[0] === "JsRuntime" && row.args[1] === "List")?.methods.lift).not.toEqual({ $ref: "std:id" });
  const bytes = (sourceDefinition: typeof codecModule): Uint8Array => {
    const row = sourceDefinition.instances?.find(item => item.typeName === "Exemplifiable" && item.args[0] === "Bytes");
    return (row?.methods.examples as Uint8Array[]).find(value => value.length > 0)!;
  };
  const left = bytes(stockSourceModule(codecModule));
  const expectedByte = left[0];
  left[0] = (left[0]! + 1) % 256;
  expect(bytes(stockSourceModule(codecModule))[0]).toBe(expectedByte);
}, 900_000);

test("stock recipe pools reconstruct source classes and exclude other pool rows", () => {
  const first = createStockDispatchRegistry();
  const original = first.getClass("Reprable");
  expect(original).toBeDefined();
  if (original === undefined) throw new Error("Stock Reprable source is unavailable");
  const owner = "recipe-stock-pool-isolation";
  first.defineClass({ ...original, methods: [] });
  first.addInstance({ typeName: "Reprable", args: ["JsRuntime", "List"],
    methods: { native: { $ref: "List" }, lift: { $ref: "std:id" }, lower: { $ref: "std:id" } },
    scope: { kind: "account", accountId: owner }, priority: 1000 });
  try {
    const second = createStockDispatchRegistry();
    expect(second.getClass("Reprable")?.methods.map(method => method.name))
      .toEqual(original.methods.map(method => method.name));
    expect(second.listInstances("Reprable").some(row => typeof row.scope === "object"
      && row.scope.kind === "account" && row.scope.accountId === owner)).toBe(false);
    for (const name of ["Reprable", "EmailService", "AI", "Social", "CanonicalListDomain"]) {
      const seed = second.getClass(name);
      expect(seed).toBeDefined();
      expect(seed && getInterfaceTypeSchemeSource(seed)?.sourceModule).toBeDefined();
    }
  } finally {
    first.defineClass(original);
    first.removeInstancesOwnedBy(owner);
  }
}, 900_000);

test("actual stock capability seeds mediate a native in no-perform metadata", () => {
  const pool = createStockDispatchRegistry();
  let calls = 0;
  const source = loadFenelModule(`module RecipeCanonicalNativeProbe where
@native
@requires "EmailService"
probe : Bool
`, "RecipeCanonicalNativeProbe");
  const fn = source.functions?.find(candidate => candidate.id === "RecipeCanonicalNativeProbe:probe");
  expect(fn?.requires?.some(requirement => requirement.class.entityId === "EmailService")).toBe(true);
  if (fn === undefined) throw new Error("Native probe source is unavailable");
  const probe = { ...source, nativeImpls: { [fn.id]: () => { calls++; return false; } } };
  const modules = [stdModule, emailModule, probe];
  for (const sourceEntry of modules) {
    for (const instance of sourceEntry.instances ?? []) pool.addInstance(instance, { declaringModule: sourceEntry.name });
  }
  // This control checks mediation only, before regenerated physical rows exist.
  // The production canonical comparison registry still requires strict identity.
  const reg = createRegistry(modules, { dispatchRegistry: pool, publishCatalogEntities: false,
    fieldIdentity: { mode: "source-handles", defaultRealm: "repository-source" } });
  const context = noPerformEvaluateContext(reg.evaluateContext());
  expect(context._performTable).toBeUndefined();
  expect(context._ioHandlerContext).toBeUndefined();
  expect(context._nativePerformDescriptors?.plain[fn.id]).toBe(true);
  expect(context.natives?.[fn.id]).toBeUndefined();
  expect(context.nativesCtx?.[fn.id]).toBeUndefined();
  expect(calls).toBe(0);
}, 900_000);

test("actual stock physical registry supplies the canonical declaration", () => {
  const identity = repositoryIdentityLock().get("std:eq");
  expect(identity).toBeDefined();
  if (identity === undefined) throw new Error("Physical std.eq identity is unavailable");
  const declaration = reflectionCanonicalFunctionDeclaration(identity);
  expect(declaration).toBeDefined();
  expect(declaration?.params).toHaveLength(2);
  expect(reflectionCanonicalFunctionDeclaration("eq")).toBeUndefined();
}, 900_000);
