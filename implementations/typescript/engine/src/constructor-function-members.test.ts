import { beforeAll, describe, expect, test } from "bun:test";
import { dispatchedConstructorFunctionBody } from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { createAccountRegistry } from "./repository-registry";
import { repositoryIdentityKinds } from "./repository-identity-manifest";
import { createConstructorFunctionSpec, type ModuleRegistry } from "./registry";
import { Nothing } from "./type-foundation";
import type { FenelModule, FenelType } from "./types";

const functionId = "f6e35b55-1db2-40fb-81c1-1e45cb013291";
const higherOrderId = "71aa65c6-fbef-4f34-9d56-bf3e1e6e0a53";
const type: FenelType = { $variant: { cases: [{
  name: "Wrapped", label: Nothing, constructorFunction: { $ref: functionId },
  fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 },
    type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} }],
}] } };
const hof = loadFenelModule(`module constructorProbe where
applyTwice : (a -> b) -> a -> List b
applyTwice _0 _1 = [_0 _1, _0 _1]
`, "constructorProbe");
const module: FenelModule = { name: "constructorProbe", label: "Constructor probe",
  entities: [{ id: "Wrapper", type, typeScheme: { quantified: [], body: type } }],
  functions: hof.functions?.map(fn => ({ ...fn, id: higherOrderId })),
  functionSignatureDeclarations: hof.functionSignatureDeclarations?.map(declaration => ({ ...declaration, functionId: higherOrderId })),
  instances: [{ typeName: "Codeable", args: [higherOrderId], methods: { codeName: "system" } }] };
const identityKinds = () => new Map([[functionId, "function"], [higherOrderId, "function"]]);

let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createAccountRegistry([], [module], { identityKinds: identityKinds() });
  context = registry.evaluateContext();
}, 60000);

describe("source constructors use the ordinary function table", () => {
  test("the Fenel factory preserves a record payload and the existing nullary representation", () => {
    const ctx = pureEvaluateContext({ _constructors: { Wrapped: ["_0"] } });
    const body = dispatchedConstructorFunctionBody("Wrapped", ["_0"]);
    expect(evaluate(body, { _0: { var: "inert", note: 7 } }, ctx))
      .toEqual({ $tag: "Wrapped", _0: { var: "inert", note: 7 } });
    expect(evaluate(dispatchedConstructorFunctionBody("True", []), {}, ctx)).toBe(true);
  });

  test("one Function UUID owns the ordinary spec, scheme and constructor field", () => {
    const row = registry.listConstructorSignatures().find(entry => entry.ownerName === "Wrapper");
    expect(row?.functionId).toBe(functionId);
    expect(registry.getIdentifiedFunction(functionId)?.id).toBe(functionId);
    expect(registry.getUuid(functionId)).toBe(functionId);
    expect(registry.getFunctionSignatureInfo(functionId)?.implementationOrigin).toEqual({ $tag: "FenelBody" });
    expect(registry.getFunctionScheme(functionId)).toEqual(row?.scheme);
    expect(registry.resolveModuleMember("Wrapper", "Wrapped")).toEqual({ kind: "function", id: functionId });
    expect(registry.resolveModuleMemberScheme("Wrapper", "Wrapped")).toEqual({ kind: "function", id: functionId });
  });

  test("the same ordinary Ref works in a Fenel higher-order function and partial application", () => {
    expect(invokeCallable({ $ref: higherOrderId }, [{ $ref: functionId }, 48], context))
      .toEqual([{ $tag: "Wrapped", _0: 48 }, { $tag: "Wrapped", _0: 48 }]);
    const partial = invokeCallable({ $ref: functionId }, [], context);
    expect(invokeCallable(partial, [49], context)).toEqual({ $tag: "Wrapped", _0: 49 });
  });

  test("a held Type value projects an ordinary Ref without invoking it", () => {
    expect(evaluate({ var: "t.Wrapped" }, { t: { $ref: "Wrapper" } }, context)).toEqual({ $ref: functionId });
    expect(invokeCallable({ $ref: functionId }, [45], context)).toEqual({ $tag: "Wrapped", _0: 45 });
    expect(evaluate({ call: [{ var: "t.Wrapped" }, 46] }, { t: { $ref: "Wrapper" } }, context))
      .toEqual({ $tag: "Wrapped", _0: 46 });
  });

  test("unknown fields and unknown roots stay missing", () => {
    expect(registry.resolveModuleMember("Wrapper", "Absent")).toEqual({ kind: "missing" });
    expect(registry.resolveModuleMember("unknown", "Wrapper", ["Wrapped"])).toEqual({ kind: "missing" });
    expect(registry.listModuleMembers("unknown")).toEqual([]);
  });

  test("a bound ordinary root shadows the system root, including a missing tail", () => {
    const local = { Expr: { ELit: { $ref: functionId } } };
    expect(evaluate({ var: "system.Expr.ELit" }, { system: local }, context)).toEqual({ $ref: functionId });
    expect(evaluate({ call: [{ var: "system.Expr.ELit" }, 47] }, { system: local }, context))
      .toEqual({ $tag: "Wrapped", _0: 47 });
    expect(evaluate({ var: ["system.Expr.ELit", "missing"] }, { system: {} }, context)).toBe("missing");
  });

  test("the ordinary system root wins over a global Function name while selected imports keep their binding", () => {
    expect(registry.getFunction("system")?.id).toBe(higherOrderId);
    const root = evaluate({ var: "system" }, {}, context);
    expect(root).toBe(registry.resolveModuleMember("system", "").kind === "value"
      ? (registry.resolveModuleMember("system", "") as { kind: "value"; value: unknown }).value : undefined);
    expect(evaluate({ var: "held.Expr" }, { held: root }, context)).toEqual(evaluate({ var: "system.Expr" }, {}, context));
    expect(() => evaluate({ call: ["system", { $ref: functionId }, 53] }, {}, context)).toThrow("system is a value, not a function");
    expect(evaluate({ call: [{ $ref: higherOrderId }, { $ref: functionId }, 53] }, {}, context))
      .toEqual([{ $tag: "Wrapped", _0: 53 }, { $tag: "Wrapped", _0: 53 }]);
    const imported = { ...context, _importStack: [{ names: { system: functionId }, aliases: {} }] };
    expect(evaluate({ var: "system" }, {}, imported)).toEqual({ $ref: functionId });
    expect(evaluate({ call: ["system", 54] }, {}, imported)).toEqual({ $tag: "Wrapped", _0: 54 });
    const absent = { ...context, _importStack: [{ names: { system: "absent:function" }, aliases: {} }] };
    expect(evaluate({ var: ["system", "missing"] }, {}, absent)).toBe("missing");
  });

  test("actual system constructor calls and held-system projection denote the same Function", () => {
    const member = registry.resolveModuleMember("system", "Expr", ["ELit"]);
    expect(member.kind).toBe("function");
    expect(registry.listModuleMembers("system")).toContain("Expr");
    expect(registry.listModuleMembers("system")).not.toContain("ELit");
    expect(registry.resolveModuleMember("system", "ELit")).toEqual({ kind: "missing" });
    expect(registry.resolveModuleMemberScheme("system", "ELit")).toEqual({ kind: "missing" });
    expect(registry.getFunction("system.ELit")).toBeUndefined();
    const root = evaluate({ var: "system" }, {}, context);
    const direct = evaluate({ var: "system.Expr.ELit" }, {}, context);
    expect(repositoryIdentityKinds().get((direct as { $ref: string }).$ref)).toBe("function");
    expect(evaluate({ var: "held.Expr.ELit" }, { held: root }, context)).toEqual(direct);
    expect(evaluate({ call: ["system.Expr.ELit", 51] }, {}, context)).toEqual({ $tag: "ELit", value: 51 });
    expect(invokeCallable(direct, [52], context)).toEqual({ $tag: "ELit", value: 52 });
    expect(invokeCallable({ $ref: higherOrderId }, [direct, 55], context))
      .toEqual([{ $tag: "ELit", value: 55 }, { $tag: "ELit", value: 55 }]);
  });

  test("a persisted canonical Function owner is reused, while a divergent owner is refused", () => {
    const spec = createConstructorFunctionSpec({ name: "Wrapped", ownerId: "Wrapper",
      ownerModule: { $tag: "Just", _0: "constructorProbe" }, kind: "variant",
      functionId, functionPath: ["type", "$variant", "cases", 0, "constructorFunction"],
      fields: [{ wireName: "_0", key: { $tag: "PositionalField", index: 0 }, type: { $ref: "Number" } }] });
    const persisted = { ...module, functions: [...(module.functions ?? []), spec] };
    const selected = createAccountRegistry([], [persisted], { identityKinds: identityKinds() });
    expect(selected.listFunctions().filter(fn => fn.id === functionId)).toHaveLength(1);
    expect(invokeCallable({ $ref: functionId }, [50], selected.evaluateContext())).toEqual({ $tag: "Wrapped", _0: 50 });
    const divergent = { ...persisted, functions: [...(module.functions ?? []), { ...spec, body: 1 }] };
    expect(() => createAccountRegistry([], [divergent], { identityKinds: identityKinds() }))
      .toThrow("divergent ordinary function");
  });
});
