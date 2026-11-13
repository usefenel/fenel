import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { evaluate, evaluateWithTrace, type EvaluateContext } from "@fenel/engine/expressions";
import type { FenelFunction, TypeScheme } from "@fenel/engine/types";
import { Nothing } from "@fenel/engine/type-foundation";
import type { AuthoringSession } from "./account-authoring-session";
import {
  authoringSessionScopeForFunction,
  declaringModuleForFunction,
  detachedAuthoringIdentities,
  mergeBrowserEvaluateContext,
} from "./authoring-session-scope";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import { exprNodeToLogic, logicToExprNode } from "./expr-node-codec";
import { createMemo } from "solid-js";

function registryWithModules(
  modules: Array<{ name: string; functionNamespace?: string; functionIds: string[] }>,
): Pick<ModuleRegistry, "modules"> {
  return {
    modules: modules.map(({ name, functionNamespace, functionIds }) => ({
      name,
      ...(functionNamespace === undefined ? {} : { functionNamespace }),
      functions: functionIds.map((id) => ({ id })),
    })) as unknown as ModuleRegistry["modules"],
  };
}

describe("expression-runner authoring sessions", () => {
  test("uses exact registry membership as source owner, never the function id namespace", () => {
    const registry = registryWithModules([
      {
        name: "declaring-container",
        functionNamespace: "wire-namespace",
        functionIds: ["wire-namespace:run"],
      },
    ]);

    expect(declaringModuleForFunction(registry, "wire-namespace:run")).toEqual({
      status: "resolved",
      moduleName: "declaring-container",
    });
    expect(authoringSessionScopeForFunction(registry, "wire-namespace:run")).toEqual({
      mode: "module",
      sourceModule: "declaring-container",
    });
  });

  test("missing and multiply-declared owners fail closed to detached mode", () => {
    const missing = registryWithModules([{ name: "one", functionIds: ["one:known"] }]);
    expect(authoringSessionScopeForFunction(missing, "ghost:missing")).toEqual({
      mode: "detached",
    });

    const ambiguous = registryWithModules([
      { name: "left", functionIds: ["shared:run"] },
      { name: "right", functionIds: ["shared:run"] },
    ]);
    expect(declaringModuleForFunction(ambiguous, "shared:run")).toEqual({
      status: "ambiguous",
      moduleNames: ["left", "right"],
    });
    expect(authoringSessionScopeForFunction(ambiguous, "shared:run")).toEqual({
      mode: "detached",
    });

    const duplicateContainerName = registryWithModules([
      { name: "same-container", functionIds: ["wire:run"] },
      { name: "same-container", functionIds: [] },
    ]);
    expect(declaringModuleForFunction(duplicateContainerName, "wire:run")).toEqual({
      status: "ambiguous",
      moduleNames: ["same-container", "same-container"],
    });
    expect(authoringSessionScopeForFunction(duplicateContainerName, "wire:run")).toEqual({
      mode: "detached",
    });
  });

  test("detached mode admits exact/canonical targets while bare and import-alias spellings stay negative", () => {
    const identities = detachedAuthoringIdentities(
      [
        { id: "localRun", targetId: "runtime:run", kind: "function" },
        {
          id: "Dup",
          targetId: "@ctor/left/Dup",
          kind: "constructor",
          parentModule: "LeftModule",
          codeName: "Dup",
        },
        { id: "op:plus", targetId: "std:add", kind: "function", notation: "+" },
      ],
      [{
        id: "Dup",
        targetId: "@ctor/right/Dup",
        kind: "constructor",
        parentModule: "RightModule",
      }],
      [
        {
          sourceName: "RuntimeModule.run",
          status: "resolved",
          entry: {
            id: "runtime:run",
            targetId: "runtime:run",
            kind: "function",
            parentModule: "RuntimeModule",
          },
        },
        {
          sourceName: "alias.run",
          status: "resolved",
          entry: {
            id: "runtime:run",
            targetId: "runtime:run",
            kind: "function",
            parentModule: "RuntimeModule",
          },
        },
      ],
    );

    expect(identities.functions.has("runtime:run")).toBe(true);
    expect(identities.functions.has("localRun")).toBe(false);
    expect(identities.functions.has("RuntimeModule.run")).toBe(true);
    expect(identities.functions.has("alias.run")).toBe(false);
    expect(identities.constructors.has("@ctor/left/Dup")).toBe(true);
    expect(identities.constructors.has("@ctor/right/Dup")).toBe(true);
    expect(identities.constructors.has("LeftModule.Dup")).toBe(true);
    expect(identities.constructors.has("RightModule.Dup")).toBe(true);
    expect(identities.constructors.has("Dup")).toBe(false);
    expect(identities.operatorAliases.has("op:plus")).toBe(true);
  });

  test("detached environment resolves exact and canonical rows without bare/alias fallback", () => {
    const stringType = { $ref: "String" } as const;
    const fn = {
      id: "runtime:run",
      targetId: "runtime:run",
      codeName: "run",
      label: "run",
      description: "run",
      params: [],
      returns: stringType,
      scheme: { quantified: [], body: { $arrow: { params: [], returns: stringType } } },
      kind: "function" as const,
      parentModule: "RuntimeModule",
    };
    const ctor = {
      id: "Dup",
      targetId: "@ctor/LeftModule/LeftType/Dup",
      codeName: "Dup",
      label: "Dup",
      description: "Dup",
      params: [],
      returns: { $ref: "LeftType" } as const,
      scheme: {
        quantified: [],
        body: { $arrow: { params: [], returns: { $ref: "LeftType" } as const } },
      },
      kind: "constructor" as const,
      parentModule: "LeftModule",
      parentEntity: "LeftType",
      ownerIdentity: "LeftModule:LeftType",
    };
    const base = createAuthoringEnvironment({
      types: [],
      functions: [fn, ctor],
      patternConstructors: [ctor],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: new Map(),
      exactFunctionRoutes: [
        { sourceName: "RuntimeModule.run", targetId: fn.targetId, status: "resolved", entry: fn },
        { sourceName: "alias.run", targetId: fn.targetId, status: "resolved", entry: fn },
      ],
    });
    const detached = createDetachedAuthoringEnvironment(base);

    expect(detached.resolveFunctionId("runtime:run")).toBe("runtime:run");
    expect(detached.resolveFunctionId("RuntimeModule.run")).toBe("runtime:run");
    expect(detached.resolveFunctionId("run")).toBeUndefined();
    expect(detached.resolveFunctionId("alias.run")).toBeUndefined();
    expect(detached.functionForRefLiteral("RuntimeModule.run")?.id).toBe("runtime:run");
    expect(detached.functionCodeName("RuntimeModule.run")).toBe("RuntimeModule.run");
    expect(detached.resolveConstructorTarget?.(ctor.targetId)).toBe(ctor.targetId);
    expect(detached.resolveConstructorTarget?.("LeftModule.Dup")).toBe(ctor.targetId);
    expect(detached.resolveConstructorTarget?.("Dup")).toBeUndefined();
    expect(detached.constructorCodeName("LeftModule.Dup")).toBe("LeftModule.Dup");
    expect(Object.isFrozen(detached)).toBe(true);
    expect(detached.functionById).not.toHaveProperty("set");
    expect(detached.functionByCodeName).not.toHaveProperty("set");
    expect(() => {
      (detached as { resolveFunctionId: (name: string) => string | undefined })
        .resolveFunctionId = () => "forged:target";
    }).toThrow();
    expect(detached.resolveFunctionId("alias.run")).toBeUndefined();
  });

  test("detached registry catalogs retain exact constructor identity when source syntax is unavailable", async () => {
    const { createRegistry } = await import("@fenel/engine/registry");
    const { loadFenelModule, parseFenel, printFenel } = await import("@fenel/engine");
    const module = loadFenelModule("module ImportDemo where\nImportTextInput = ImportTextInput text: String\n", "ImportDemo");
    const registry = createRegistry([module]);
    // This is the catalog boundary used without a sourceModule by a detached
    // reader. Its constructor metadata is registry-derived, not a route fixture.
    const catalog = buildAuthoringCatalogSnapshot([], { registry });
    expect(catalog.exactConstructorRoutes).toEqual([]);
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment(catalog));
    const entry = environment.catalog.patternConstructors?.find((candidate) => candidate.id === "ImportTextInput");
    expect(entry?.targetId).toBeDefined();
    const targetId = entry!.targetId!;
    const original = { construct: [targetId, { text: "hello" }] };
    const code = printFenel(original, undefined, { constructorRoutes: environment.catalog.exactConstructorRoutes });
    expect(code).toContain("<no surface syntax: constructor unavailable in this scope>");
    expect(() => parseFenel(code)).toThrow();
    expect(evaluate(original, {}, registry.evaluateContext())).toEqual({ $tag: "ImportTextInput", text: "hello" });
    expect(environment.resolveFunctionId("ImportTextInput")).toBeUndefined();
    expect(environment.resolvePatternConstructor?.("ImportTextInput", undefined)).toEqual({ status: "missing" });
    expect(environment.catalog.exactConstructorRoutes?.some((route) => route.sourceName === "ImportTextInput")).toBe(false);
    expect(Object.isFrozen(environment.catalog.exactConstructorRoutes)).toBe(true);
    expect(environment.catalog.exactConstructorRoutes?.every(Object.isFrozen)).toBe(true);
  }, 180_000);

  test("detached constructor source facts exclude ambient aliases and retain resolution refusals", () => {
    const targetId = "@ctor/Owner/Value/Item";
    const constructor = { id: "Item", targetId, kind: "constructor" as const, parentModule: "Owner",
      parentEntity: "Value", ownerIdentity: "Owner:Value", label: "Item", description: "", params: [],
      returns: { $ref: "Value" } as const };
    const base = createAuthoringEnvironment({ types: [], functions: [constructor], patternConstructors: [constructor],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(), exactConstructorRoutes: [
        { sourceName: "Item", targetId, status: "resolved" },
        { sourceName: "alias.Item", targetId, status: "resolved" },
      ] });
    for (const status of ["missing", "ambiguous", "fenced"] as const) {
      const environment = createDetachedAuthoringEnvironment({ ...base,
        resolvePatternConstructor: (name, scrutinee, owner) => name === "Owner.Item"
          ? status === "fenced"
            ? { status: "resolved", targetId, params: [], returns: constructor.returns,
              signatureOutcome: { $tag: "AnnotationRequired", reason: "fixture" } as never }
            : { status }
          : base.resolvePatternConstructor!(name, scrutinee, owner),
      });
      expect(environment.catalog.exactConstructorRoutes?.find((route) => route.sourceName === "Owner.Item")?.status).toBe(status);
      expect(environment.catalog.exactConstructorRoutes?.some((route) => ["Item", "alias.Item"].includes(route.sourceName))).toBe(false);
      expect(environment.resolvePatternConstructor?.("Item", undefined)).toEqual({ status: "missing" });
      expect(environment.resolvePatternConstructor?.("alias.Item", undefined)).toEqual({ status: "missing" });
    }
  });

  test("browser native overrides preserve registry lookup and exact constructor wire transport", () => {
    const registryFunction = {
      id: "owner:run",
      body: { bytes: new Uint8Array([4, 2]) },
    } as never;
    const baseNative = () => "base";
    const browserNative = () => "browser";
    let routingReads = 0;
    let internalDispatchWrite = false;
    const dispatchInstance = {
      typeName: "Demo",
      args: ["String"],
      methods: { run: "owner:run" },
    };
    const specRegistry = {
      defineClass: () => { internalDispatchWrite = true; },
      addInstance: () => { internalDispatchWrite = true; },
      registerValue: () => { internalDispatchWrite = true; },
      removeInstancesByScope: () => { internalDispatchWrite = true; },
      removeInstance: () => { internalDispatchWrite = true; },
      getClass: () => undefined,
      satisfies: () => true,
      resolve: () => dispatchInstance.methods,
      listMatchingInstances: (_type: unknown, _typeName: string, filter?: (value: never) => boolean) =>
        filter === undefined || filter(dispatchInstance as never) ? [dispatchInstance] : [],
      listClasses: () => [],
      listInstances: () => [dispatchInstance],
      implementedBy: () => [],
      version: () => 1,
    } as unknown as NonNullable<EvaluateContext["_specRegistry"]>;
    const context = mergeBrowserEvaluateContext(
      {
        getFunction: (name) => name === "owner:run" ? registryFunction : undefined,
        getFunctionSignatureInfo: () => ({ trust: { $tag: "Trusted" } }),
        natives: Object.assign(Object.create(null), {
          shared: baseNative,
          registryOnly: baseNative,
        }),
        _constructors: { "@ctor/owner/Dup": ["leftField"] },
        _constructorWireNames: { "@ctor/owner/Dup": "Dup" },
        _moduleNames: new Set(["owner"]),
        _uuidBySlug: new Map([["owner:run", "uuid-owner-run"]]),
        _routingTable: () => {
          routingReads += 1;
          return {
            $tag: "RoutingTable",
            routes: [],
            routeIdx: Object.create(null),
            posIdx: Object.create(null),
            ownerIdx: Object.create(null),
            instanceIdx: Object.create(null),
            generalIdx: Object.create(null),
          };
        },
        _patternPlans: new WeakMap(),
        _specRegistry: specRegistry,
      },
      { shared: browserNative },
      {},
    );

    const firstFunction = context.getFunction?.("owner:run") as unknown as {
      body: { bytes: Uint8Array };
    };
    expect(firstFunction).not.toBe(registryFunction);
    expect(Object.isFrozen(firstFunction)).toBe(true);
    firstFunction.body.bytes[0] = 9;
    const secondFunction = context.getFunction?.("owner:run") as unknown as {
      body: { bytes: Uint8Array };
    };
    expect(secondFunction.body.bytes[0]).toBe(4);
    expect((registryFunction as { body: { bytes: Uint8Array } }).body.bytes[0]).toBe(4);
    expect(context.getFunctionSignatureInfo?.("owner:run")?.trust?.$tag).toBe("Trusted");
    expect(context._constructors?.["@ctor/owner/Dup"]).toEqual(["leftField"]);
    expect(context._constructorWireNames?.["@ctor/owner/Dup"]).toBe("Dup");
    expect(context.natives?.shared).toBe(browserNative);
    expect(context.natives?.registryOnly).toBe(baseNative);
    expect(Object.getPrototypeOf(context.natives)).toBeNull();
    expect(context.natives?.toString).toBeUndefined();
    expect(context._patternPlans).toBeUndefined();
    expect(context._moduleNames).not.toHaveProperty("add");
    expect(context._uuidBySlug).not.toHaveProperty("set");
    expect(routingReads).toBe(0);
    expect(() => {
      context._constructors!["@ctor/owner/Dup"]![0] = "poison";
    }).toThrow();
    expect(context._constructors?.["@ctor/owner/Dup"]).toEqual(["leftField"]);
    const routing = context._routingTable?.() as { routeIdx: Record<string, unknown> };
    expect(routingReads).toBe(1);
    expect(Object.isFrozen(routing)).toBe(true);
    expect(() => {
      routing.routeIdx.poison = { $tag: "RDirect" };
    }).toThrow();
    expect(() => context._specRegistry?.addInstance(dispatchInstance as never)).toThrow();
    expect(internalDispatchWrite).toBe(false);
    const publicInstances = context._specRegistry?.listInstances() ?? [];
    expect(Object.isFrozen(publicInstances)).toBe(true);
    expect(Object.isFrozen(publicInstances[0])).toBe(true);
    expect(() => {
      (publicInstances[0] as { args: string[] }).args[0] = "Poison";
    }).toThrow();
    expect(dispatchInstance.args[0]).toBe("String");

    const explicitPrototypeName = mergeBrowserEvaluateContext(
      { natives: Object.create(null) },
      { toString: () => "explicit" },
      {},
    );
    expect(explicitPrototypeName.natives?.toString?.()).toBe("explicit");
  });

  test("account and draft sessions expose only their live exact-id roster", async () => {
    const { createAccountAuthoringSession } = await import("./account-authoring-session");
    const stringType = { $ref: "String" } as const;
    const baseEnvironment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({
      types: [],
      functions: [],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: new Map(),
    }));
    const baseSession: AuthoringSession = Object.freeze({
      mode: "detached",
      registry: registryWithModules([]) as ModuleRegistry,
      catalog: baseEnvironment.catalog,
      environment: baseEnvironment,
      evaluateContext: Object.freeze({}),
    });
    const accountAFunctions: FenelFunction[] = [{
      id: "acct-a:helper",
      params: [{ name: "value", label: Nothing, type: stringType, meta: {}, ui: Nothing }],
      returns: stringType,
      body: { var: "value" },
    }];
    const accountBFunctions: FenelFunction[] = [{
      id: "acct-b:helper",
      params: [],
      returns: stringType,
      body: "B",
    }];
    const draft: FenelFunction = {
      id: "acct-a:recursive-draft",
      params: [{ name: "value", label: Nothing, type: stringType, meta: {}, ui: Nothing }],
      returns: stringType,
    };

    const accountA = createAccountAuthoringSession(baseSession, {
      accountId: "account-a",
      functions: accountAFunctions,
      draft,
    });
    const accountB = createAccountAuthoringSession(baseSession, {
      accountId: "account-b",
      functions: accountBFunctions,
    });
    const editedAccountA = createAccountAuthoringSession(baseSession, {
      accountId: "account-a",
      functions: accountAFunctions,
      draft: {
        ...accountAFunctions[0]!,
        returns: { $ref: "Boolean" },
      },
    });

    expect(accountA.environment.resolveFunctionId("acct-a:helper")).toBe("acct-a:helper");
    expect(accountA.environment.resolveFunctionId(draft.id)).toBe(draft.id);
    expect(accountA.environment.functionForRefLiteral(draft.id)?.id).toBe(draft.id);
    expect(accountA.environment.resolveFunctionId("acct-b:helper")).toBeUndefined();
    expect(accountB.environment.resolveFunctionId("acct-a:helper")).toBeUndefined();
    expect(accountB.environment.resolveFunctionId("acct-b:helper")).toBe("acct-b:helper");
    expect(editedAccountA.environment.functionForRefLiteral("acct-a:helper")?.returns)
      .toEqual({ $ref: "Boolean" });
    expect(editedAccountA.evaluateContext.getFunction?.("acct-a:helper")?.returns)
      .toEqual({ $ref: "Boolean" });
    expect(accountA.environment.functionForRefLiteral("acct-a:helper")?.returns)
      .toEqual(stringType);
    expect(evaluate(
      { call: ["acct-a:helper", "live"] },
      {},
      accountA.evaluateContext,
    )).toBe("live");
    expect(accountA.evaluateContext.getFunction?.(draft.id)?.id).toBe(draft.id);

    expect(Object.isFrozen(accountA.catalog)).toBe(true);
    expect(Object.isFrozen(accountA.catalog.functions)).toBe(true);
    expect(accountA.catalog).toBe(accountA.environment.catalog);
    expect(() => {
      accountA.catalog.functions.push(accountA.catalog.functions[0]!);
    }).toThrow();

    accountAFunctions[0]!.id = "poisoned-after-session";
    accountAFunctions.push(accountBFunctions[0]!);
    expect(accountA.environment.resolveFunctionId("acct-a:helper")).toBe("acct-a:helper");
    expect(accountA.environment.resolveFunctionId("acct-b:helper")).toBeUndefined();
    expect(accountA.evaluateContext.getFunction?.("acct-a:helper")?.id).toBe("acct-a:helper");
  }, 180_000);

  test("local function references and drafts stay in their explicit source without an account", async () => {
    const { createLocalAuthoringSession, localAuthoringScopeForSession } = await import("./account-authoring-session");
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types: [], functions: [],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() }));
    const authority = Object.freeze({}) as NonNullable<EvaluateContext["_authority"]>;
    const base: AuthoringSession = Object.freeze({ mode: "detached", registry: registryWithModules([]) as ModuleRegistry,
      catalog: environment.catalog, environment, evaluateContext: Object.freeze({ _authority: authority }) });
    const id = "43c1aff4-c49c-4082-b36b-4a803b506956";
    const fn: FenelFunction = { id, params: [{ name: "data", type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} }],
      returns: { $ref: "String" }, body: { var: "data" } };
    const first = createLocalAuthoringSession(base, { sourceId: "tab-first", functions: [fn] });
    const second = createLocalAuthoringSession(base, { sourceId: "tab-second", functions: [{ ...fn, body: "other source" }] });
    const draft = createLocalAuthoringSession(first, { sourceId: "tab-first", functions: [fn], draft: { ...fn, body: "edited" } });
    expect(evaluate({ call: [{ $ref: id }, "original"] }, {}, first.evaluateContext)).toBe("original");
    expect(evaluate({ call: [{ $ref: id }, "original"] }, {}, second.evaluateContext)).toBe("other source");
    expect(evaluate({ call: [{ $ref: id }, "original"] }, {}, draft.evaluateContext)).toBe("edited");
    expect(first.evaluateContext._authority).toBe(authority);
    expect(draft.evaluateContext._authority).toBe(authority);
    expect(localAuthoringScopeForSession(first)?.sourceId).toBe("tab-first");
    expect(localAuthoringScopeForSession(first)).not.toHaveProperty("accountId");
    fn.body = "caller mutation";
    expect(evaluate({ call: [{ $ref: id }, "original"] }, {}, first.evaluateContext)).toBe("original");
    expect(localAuthoringScopeForSession(first)?.functions[0]?.body).toEqual({ var: "data" });
    expect(() => createLocalAuthoringSession(base, { sourceId: "", functions: [] })).toThrow(/sourceId/);
  });

  test("saved generic signatures survive worker scope clones and infer drafts cannot inherit checked results", async () => {
    const { createAccountAuthoringSession, createLocalAuthoringSession } = await import("./account-authoring-session");
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types: [], functions: [],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() }));
    const params = [{ name: "data", type: { $var: "a" }, label: Nothing, ui: Nothing, meta: {} }];
    const scheme: TypeScheme = { quantified: [{ id: "retained:a", sourceName: "a", kind: { $tag: "KType" } }],
      body: { $arrow: { params, returns: { $var: "a" } } }, applications: [], nominals: [], diagnostics: [] };
    const fn: FenelFunction = { id: "retained", params, returns: { $var: "a" }, body: { var: "data" },
      signatureDeclaration: { functionId: "retained", declarationName: "retained", codeName: "retained", scheme,
        params: [{ $tag: "Authored", source: { $tag: "HostSpec", module: "retained" } }],
        returns: { $tag: "Authored", source: { $tag: "HostSpec", module: "retained" } } } };
    const base: AuthoringSession = { mode: "detached", registry: registryWithModules([]) as ModuleRegistry,
      catalog: environment.catalog, environment, evaluateContext: { getFunctionSignatureInfo: () => ({ scheme }) } };
    const source = await readFile(new URL("./authoring-session.ts", import.meta.url), "utf8");
    const start = source.indexOf("const accountScopeIds =");
    const end = source.indexOf("export function accountAuthoringSession(", start);
    if (start < 0 || end < 0) throw new Error("Account worker-scope transport moved");
    const transportCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)).replace(/^export /gm, "");
    const scopeTransport = new Function("concreteAuthoringSession", `${transportCode}; return { rememberAccountScope, authoringSessionAccountScope };`)((session: AuthoringSession) => session);
    for (const session of [
      createAccountAuthoringSession(base, structuredClone({ accountId: "account", functions: [fn], draft: fn })),
      createLocalAuthoringSession(base, structuredClone({ sourceId: "tab", functions: [fn], draft: fn })),
    ]) {
      expect(session.environment.getFunctionEntry?.(fn.id)?.scheme).toEqual(scheme);
      expect(session.evaluateContext.getFunctionSignatureInfo?.(fn.id)?.scheme).toEqual(scheme);
      const inferred = { ...fn, signatureDeclaration: { ...fn.signatureDeclaration!, returns: { $tag: "Absent" as const } } };
      const editing = createLocalAuthoringSession(session, structuredClone({ sourceId: "tab", functions: [fn], draft: inferred }));
      expect(editing.environment.getFunctionEntry?.(fn.id)?.scheme).toBeUndefined();
      expect(editing.environment.functionForRefLiteral(fn.id)).toBeUndefined();
      expect(editing.evaluateContext.getFunctionSignatureInfo?.(fn.id)).toBeUndefined();
      expect(editing.evaluateContext.getFunction?.(fn.id)?.signatureDeclaration?.scheme).toEqual(scheme);
      expect(session.environment.getFunctionEntry?.(fn.id)?.scheme).toEqual(scheme);
      const accountDraft = scopeTransport.rememberAccountScope(createAccountAuthoringSession(base, {
        accountId: "account", functions: [fn], draft: inferred,
      }), { accountId: "account", functions: [fn], draft: inferred });
      const workerScope = structuredClone(scopeTransport.authoringSessionAccountScope(accountDraft));
      expect(workerScope.draft.signatureDeclaration.returns).toEqual({ $tag: "Absent" });
      const workerSession = createAccountAuthoringSession(base, workerScope);
      expect(workerSession.evaluateContext.getFunctionSignatureInfo?.(fn.id)).toBeUndefined();
      expect(workerSession.environment.functionForRefLiteral(fn.id)).toBeUndefined();
    }
  });

  test("the shared product evaluator executes an exact persisted constructor with its short wire tag", async () => {
    const targetId = "@ctor/Owner/Result/Done";
    const resultType = { $ref: "Result" } as const;
    const constructor = {
      id: "Done",
      targetId,
      codeName: "Done",
      label: "Done",
      description: "Done",
      params: [],
      returns: resultType,
      scheme: {
        quantified: [],
        body: { $arrow: { params: [], returns: resultType } },
      },
      kind: "constructor" as const,
      parentModule: "Owner",
      parentEntity: "Result",
      ownerIdentity: "Owner:Result",
    };
    const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({
      types: [],
      functions: [constructor],
      patternConstructors: [constructor],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: new Map(),
    }));
    const constructorFields: string[] = [];
    Object.freeze(constructorFields);
    const constructors: Record<string, string[]> = { [targetId]: constructorFields };
    Object.freeze(constructors);
    const session: AuthoringSession = Object.freeze({
      mode: "detached",
      registry: registryWithModules([]) as ModuleRegistry,
      catalog: environment.catalog,
      environment,
      evaluateContext: Object.freeze({
        _constructors: constructors,
        _constructorWireNames: Object.freeze({ [targetId]: "Done" }),
      }),
    });

    const logic = exprNodeToLogic({ kind: "call", fnId: targetId, args: [] }, {
      fnCodeName: (id) => environment.functionCodeName(id) ?? id,
      constructorName: (id) => environment.constructorCodeName(id),
      operatorCodeName: (_notation, call) =>
        environment.operatorCodeName(call.aliasId, call.arity),
    });
    const evaluated = evaluateWithTrace(logic, {}, session.evaluateContext);
    expect(evaluated.result).toMatchObject({ $tag: constructor.id });
    expect((evaluated.result as { $tag: string }).$tag).not.toStartWith("@ctor/");
  }, 180_000);

  test("the product function editor threads one owner-derived session end to end", async () => {
    // A CRLF checkout (core.autocrlf) must not break the multi-line anchors.
    const home = (await readFile(
      new URL("../../routes/app/home.tsx", import.meta.url),
      "utf8",
    )).replace(/\r\n/g, "\n");
    expect(home).toContain("prepareAuthoringSessionForFunction(");
    expect(home).toContain("functions: userFunctions()");
    expect(home).toContain("accountAuthoringSession({");
    expect(home).toContain("authoringSession={newFunctionAuthoringSession()}");
    expect(home).toContain("functionSourceAuthoringSession(),");
    expect(home).toContain("const functionAuthoringSession = createMemo");
    expect(home).toContain("params: [...arrow.$arrow.params]");
    expect(home).toContain("draft,");
    expect(home).toContain("authoringSession={functionAuthoringSession()}");
    // Save lowers the body through the session captured with the save intent,
    // which is the same owner-derived function session.
    expect(home).toContain("const facade = needsBodyCheck ? functionAuthoringSession() : undefined;");
    expect(home).toContain("session: facade ? concreteAuthoringSession(facade) : undefined");
    expect(home).toContain("bodyExpr,\n            undefined,\n            intent.session,");
    expect(home).toContain("evaluateAuthoringExpression");
    expect(home).not.toContain("STD_CONTEXT");
    expect(home).not.toContain("createRepositoryRegistry");

    const values = await readFile(
      new URL("../../routes/app/values.tsx", import.meta.url),
      "utf8",
    );
    expect(values).toContain("evaluateAuthoringExpression");
    expect(values).not.toContain("STD_CONTEXT");
    expect(values).not.toContain("createRepositoryRegistry");

    const runner = await readFile(new URL("./index.tsx", import.meta.url), "utf8");
    expect(runner).toContain("export function evaluateAuthoringExpression(");
    expect(runner).toContain("evaluateAuthoringExpressionInSession(node, resolver, session, data, options)");
    const evaluator = await readFile(new URL("./expression-evaluation.ts", import.meta.url), "utf8");
    // Lowering takes the run's exact session; the admission observer rides along,
    // and a run calls registered functions by their exact identity.
    expect(evaluator).toContain("authoringExpressionLogic(node, resolver, session, admission.observe, \"exact\")");
    expect(evaluator).toContain("session.evaluateContext");

    const layout = await readFile(
      new URL("../../routes/app.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain("setUserRegistryAccountScope(accountId)");
    expect(layout).toContain("ensureUserRegistriesLoaded(accountId)");
    const userRegistries = await readFile(
      new URL("../user-registries.ts", import.meta.url),
      "utf8",
    );
    expect(userRegistries).toContain("setUserFunctions([])");
    expect(userRegistries).toContain("desiredAccountId !== accountId || loadEpoch !== epoch");
  });
});

const detachedPreparationSource = (await readFile(new URL("./authoring-session.ts", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const detachedStateStart = detachedPreparationSource.indexOf("let detachedSessionCache:");
const detachedStateEnd = detachedPreparationSource.indexOf("\n\n/** Build", detachedStateStart);
const detachedBodyStart = detachedPreparationSource.indexOf("function detachedSessionForRegistry(");
const detachedBodyEnd = detachedPreparationSource.indexOf("\nconst moduleSessions =", detachedBodyStart);
if ([detachedStateStart, detachedStateEnd, detachedBodyStart, detachedBodyEnd].some(index => index < 0)) {
  throw new Error("Detached authoring preparation boundary moved");
}
const detachedPreparationCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  detachedPreparationSource.slice(detachedStateStart, detachedStateEnd)
    + detachedPreparationSource.slice(detachedBodyStart, detachedBodyEnd),
).replace(/^export /gm, "");

function heldPreparation<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function detachedPreparationHarness() {
  const { concreteAuthoringSession, registerAuthoringSessionFacade } = await import("./account-authoring-session");
  const registry = Object.freeze({ id: "repository" });
  const registryJobs: Array<ReturnType<typeof heldPreparation<object>>> = [];
  const catalogJobs: Array<ReturnType<typeof heldPreparation<object>>> = [];
  const attachments: Array<{ registry: object; catalog: object; session: AuthoringSession; token: object }> = [];
  const discarded: object[] = [];
  const workers = new WeakMap<object, { token: object; retired: boolean }>();
  let synchronousRegistryReads = 0;
  let synchronousCatalogReads = 0;
  const guards = {
    Worker: class {},
    modulesFor: (profile: string) => { expect(profile).toBe("seed"); return []; },
    dispatchRegistry: Object.freeze({}),
    withinWorkspaceLimit: (_name: string, prepare: () => Promise<object>) => prepare(),
    createRepositoryRegistryAsync: () => {
      const job = heldPreparation<object>();
      registryJobs.push(job);
      return job.promise;
    },
    createRepositoryRegistry: () => { synchronousRegistryReads++; return registry; },
    prepareRepositoryCatalogInWorker: () => {
      const job = heldPreparation<object>();
      catalogJobs.push(job);
      return job.promise;
    },
    browserEvaluateContext: (source: object) => Object.freeze({ registry: source }),
    catalogFor: () => { synchronousCatalogReads++; return Object.freeze({ name: "synchronous" }); },
    environmentFor: (catalog: object) => Object.freeze({ catalog }),
    createDetachedAuthoringEnvironment: (environment: object) => environment,
    registerAuthoringSessionFacade,
    authoringWorkerSnapshot: (supplied: AuthoringSession) => {
      const session = concreteAuthoringSession(supplied);
      const worker = workers.get(session);
      if (worker?.retired) throw new Error("Worker retired");
      return worker?.token;
    },
    attachPreparedAuthoringWorker: (source: object, catalog: object, session: AuthoringSession) => {
      const token = Object.freeze({});
      attachments.push({ registry: source, catalog, session, token });
      workers.set(session, { token, retired: false });
    },
    discardPreparedAuthoringCatalog: (catalog: object) => { discarded.push(catalog); },
  };
  const production = new Function(...Object.keys(guards), `${detachedPreparationCode};
    return { prepareDetachedAuthoringSession, DETACHED_AUTHORING_SESSION };`)(...Object.values(guards));
  return { ...production, registry, registryJobs, catalogJobs, attachments, discarded, concreteAuthoringSession,
    snapshot: guards.authoringWorkerSnapshot,
    retire: (session: AuthoringSession) => { workers.get(session)!.retired = true; },
    synchronousRegistryReads: () => synchronousRegistryReads,
    synchronousCatalogReads: () => synchronousCatalogReads,
  };
}

describe("detached authoring preparation lifecycle", () => {
  test("cold facade access stays inert and concurrent consumers share one preparation", async () => {
    const h = await detachedPreparationHarness();
    expect(h.DETACHED_AUTHORING_SESSION.mode).toBe("detached");
    expect(h.snapshot(h.DETACHED_AUTHORING_SESSION)).toBeUndefined();
    expect(h.registryJobs).toHaveLength(0);
    expect(h.catalogJobs).toHaveLength(0);
    expect(h.synchronousRegistryReads()).toBe(0);
    expect(h.synchronousCatalogReads()).toBe(0);
    const first = h.prepareDetachedAuthoringSession();
    const second = h.prepareDetachedAuthoringSession();
    expect(second).toBe(first);
    expect(h.registryJobs).toHaveLength(1);
    expect(h.catalogJobs).toHaveLength(1);
    const catalog = Object.freeze({ name: "prepared" });
    h.registryJobs[0].resolve(h.registry);
    h.catalogJobs[0].resolve(catalog);
    const session = await first;
    expect(await second).toBe(session);
    expect(h.concreteAuthoringSession(h.DETACHED_AUTHORING_SESSION)).toBe(session);
    expect(h.DETACHED_AUTHORING_SESSION.registry).toBe(h.registry);
    expect(h.DETACHED_AUTHORING_SESSION.catalog).toBe(catalog);
    expect(h.snapshot(h.DETACHED_AUTHORING_SESSION)).toBe(h.snapshot(session));
    expect(h.attachments).toHaveLength(1);
    expect(h.synchronousCatalogReads()).toBe(0);
  });

  test("a retired worker is recreated while the public session, registry and catalog retain their identity", async () => {
    const h = await detachedPreparationHarness();
    const first = h.prepareDetachedAuthoringSession();
    const catalog = Object.freeze({ name: "prepared" });
    h.registryJobs[0].resolve(h.registry);
    h.catalogJobs[0].resolve(catalog);
    const session = await first;
    const heldCatalog = session.catalog;
    const oldToken = h.snapshot(session);
    expect(await h.prepareDetachedAuthoringSession()).toBe(session);
    expect(h.catalogJobs).toHaveLength(1);
    h.retire(session);
    const refresh = h.prepareDetachedAuthoringSession();
    expect(h.prepareDetachedAuthoringSession()).toBe(refresh);
    expect(h.registryJobs).toHaveLength(1);
    expect(h.catalogJobs).toHaveLength(2);
    const refreshedCatalog = Object.freeze({ name: "recreated worker" });
    h.catalogJobs[1].resolve(refreshedCatalog);
    expect(await refresh).toBe(session);
    expect(session.registry).toBe(h.registry);
    expect(session.catalog).toBe(heldCatalog);
    expect(h.concreteAuthoringSession(h.DETACHED_AUTHORING_SESSION)).toBe(session);
    expect(h.snapshot(session)).not.toBe(oldToken);
    expect(h.attachments[1]).toMatchObject({ registry: h.registry, catalog: refreshedCatalog, session });
    expect(h.synchronousRegistryReads()).toBe(0);
    expect(h.synchronousCatalogReads()).toBe(0);
  });

  test("a synchronous facade reader that wins the race remains the worker's authoritative owner", async () => {
    const h = await detachedPreparationHarness();
    const pending = h.prepareDetachedAuthoringSession();
    expect(h.DETACHED_AUTHORING_SESSION.registry).toBe(h.registry);
    const winner = h.concreteAuthoringSession(h.DETACHED_AUTHORING_SESSION);
    const otherRegistry = Object.freeze({ id: "asynchronous loser" });
    const catalog = Object.freeze({ name: "prepared" });
    h.registryJobs[0].resolve(otherRegistry);
    h.catalogJobs[0].resolve(catalog);
    expect(await pending).toBe(winner);
    expect(winner.registry).toBe(h.registry);
    expect(winner.catalog).toBe(catalog);
    expect(h.attachments[0]).toMatchObject({ registry: h.registry, catalog, session: winner });
    expect(h.synchronousRegistryReads()).toBe(1);
    expect(h.synchronousCatalogReads()).toBe(0);
  });

  test("a registry failure retires a late completed catalog and a later caller can retry", async () => {
    const h = await detachedPreparationHarness();
    const pending = h.prepareDetachedAuthoringSession();
    h.registryJobs[0].reject(new Error("Registry preparation failed"));
    await expect(pending).rejects.toThrow("Registry preparation failed");
    const abandoned = Object.freeze({ name: "abandoned worker" });
    h.catalogJobs[0].resolve(abandoned);
    await Promise.resolve();
    expect(h.discarded).toEqual([abandoned]);
    expect(h.attachments).toHaveLength(0);
    const retry = h.prepareDetachedAuthoringSession();
    expect(h.registryJobs).toHaveLength(2);
    expect(h.catalogJobs).toHaveLength(2);
    h.registryJobs[1].resolve(h.registry);
    h.catalogJobs[1].resolve(Object.freeze({ name: "retry worker" }));
    expect((await retry).registry).toBe(h.registry);
    expect(h.attachments).toHaveLength(1);
  });

  test("cached public data waits for worker reattachment and returns the existing data unchanged", async () => {
    const h = await detachedPreparationHarness();
    const initial = h.prepareDetachedAuthoringSession();
    h.registryJobs[0].resolve(h.registry);
    h.catalogJobs[0].resolve(Object.freeze({ name: "prepared" }));
    const session = await initial;
    const data = Object.freeze({ root: Object.freeze({}), registry: h.registry, session });
    const publicSource = await readFile(new URL("../public-locus-data.ts", import.meta.url), "utf8");
    const publicStart = publicSource.indexOf("export function preparePublicLocusData()");
    if (publicStart < 0) throw new Error("Public data preparation boundary moved");
    const publicCode = new Bun.Transpiler({ loader: "ts" }).transformSync(publicSource.slice(publicStart))
      .replace(/^export /gm, "")
      .replaceAll('import("./expression-runner/authoring-session")', "Promise.resolve(authoringSessionModule)");
    const preparePublic = new Function("authoringSessionModule", "data", `
      let prepared = Promise.resolve(data);
      ${publicCode}; return preparePublicLocusData;
    `)({ prepareDetachedAuthoringSession: h.prepareDetachedAuthoringSession }, data);
    h.retire(session);
    let completed = false;
    const refreshed = preparePublic().then((value: unknown) => { completed = true; return value; });
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(h.registryJobs).toHaveLength(1);
    expect(h.catalogJobs).toHaveLength(2);
    h.catalogJobs[1].resolve(Object.freeze({ name: "current worker" }));
    expect(await refreshed).toBe(data);
    expect(h.snapshot(session)).toBeDefined();
    expect(await preparePublic()).toBe(data);
    expect(h.catalogJobs).toHaveLength(2);
  });
});
