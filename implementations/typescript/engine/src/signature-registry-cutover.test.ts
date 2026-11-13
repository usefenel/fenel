import { describe, expect, test } from "bun:test";

import { loadFenelModule } from "./fenel-module";
import { evaluate } from "./json-logic";
import { createIdentityProjectionRegistry, createRegistry } from "./registry";
import { createAccountRegistry } from "./repository-registry";
import { repositoryIdentityLock } from "./repository-identity-manifest";
import { Nothing } from "./type-foundation";
import { isFenelType } from "./dependent-types";
import EVENTS_SOURCE from "../../../../fenel/modules/events/types.fenel?raw";
import GAMES_SOURCE from "../../../../fenel/modules/games/types.fenel?raw";
import MOVIE_SOURCE from "../../../../fenel/modules/movie/types.fenel?raw";
import type {
  FieldDef,
  FenelFunction,
  FenelModule,
  FenelType,
  FunctionSignatureDeclaration,
} from "./types";

const field = (name: string, type: FenelType) => ({
  name,
  type,
  label: Nothing,
  ui: Nothing,
  meta: {},
});

const positionalField = (
  name: string,
  index: number,
  type: FenelType,
): FieldDef => ({
  ...field(name, type),
  key: { $tag: "PositionalField", index },
});

function moduleFor(
  fn: FenelFunction,
  extra: Partial<FenelModule> = {},
): FenelModule {
  return {
    name: "cutover",
    label: "Cutover",
    entities: [],
    functions: [fn],
    instances: [{
      typeName: "Codeable",
      args: [fn.id],
      methods: { codeName: fn.id.slice(fn.id.indexOf(":") + 1) },
    }],
    ...extra,
  };
}

describe("registry signature cutover", () => {
  test("repository cross-module Animation signatures carry the exact animation owner", () => {
    const sourceModules = [
      loadFenelModule(MOVIE_SOURCE, "movie"),
      loadFenelModule(EVENTS_SOURCE, "events"),
      loadFenelModule(GAMES_SOURCE, "games"),
    ];
    const ids = new Set([
      "movie:withAudio",
      "movie:silentMovie",
      "events:behaviorToAnim",
      "games:gameToAnim",
    ]);
    const signatureModules = sourceModules.map((module): FenelModule => ({
      name: module.name,
      label: module.label,
      entities: module.entities,
      functions: module.functions?.filter((fn) => ids.has(fn.id)),
      functionSignatureDeclarations: module.functionSignatureDeclarations?.filter(
        (declaration) => ids.has(declaration.functionId),
      ),
      instances: module.instances?.filter((instance) =>
        typeof instance.args[0] === "string" && ids.has(instance.args[0])
      ),
    }));
    const ownerType: FenelType = { $record: { fields: [] } };
    const ownerModule = (name: "animation" | "telegram"): FenelModule => ({
      name,
      label: name,
      entities: [{ id: "Animation", module: name, type: ownerType }],
      functions: [],
    });
    const registry = createRegistry([
      ownerModule("telegram"),
      ownerModule("animation"),
      ...signatureModules,
    ], { publishCatalogEntities: false });
    const expectedIdentity = '["animation","Animation"]';
    const expected = [
      ["movie:withAudio", ["$arrow", "params", "0", "type"]],
      ["movie:silentMovie", ["$arrow", "params", "0", "type"]],
      ["events:behaviorToAnim", ["$arrow", "returns"]],
      ["games:gameToAnim", ["$arrow", "returns"]],
    ] as const;

    for (const [functionId, path] of expected) {
      expect(registry.getFunctionScheme(functionId)?.nominals).toContainEqual({
        path: [...path],
        identity: expectedIdentity,
        publicName: "animation.Animation",
      });
    }
  }, 180_000);

  test("parsed guards bridge only the intrinsic and exact-system Boolean identities", () => {
    const auth = loadFenelModule(`
      module auth where

      isEmpty : String -> Boolean
      isEmpty key = true

      insertCookie acc key =
        if isEmpty key then acc else acc

      stringLiteral = "cookie"
      numberLiteral = 1
      booleanLiteral = true
    `, "auth");
    const registry = createRegistry([auth], { publishCatalogEntities: false });
    expect(registry.getFunctionScheme("auth:isEmpty")).toMatchObject({
      body: {
        $arrow: {
          returns: { $ref: "Boolean" },
        },
      },
    });
    expect(registry.getFunctionScheme("auth:isEmpty")?.nominals).toBeUndefined();
    expect(registry.getFunctionScheme("auth:insertCookie")).toBeDefined();
    for (const [functionName, publicName] of [
      ["stringLiteral", "String"],
      ["numberLiteral", "Number"],
      ["booleanLiteral", "Boolean"],
    ] as const) {
      expect(registry.getFunctionScheme(`auth:${functionName}`)?.nominals).toContainEqual({
        path: ["$arrow", "returns"],
        identity: `["system","${publicName}"]`,
        publicName,
      });
    }

    const custom = loadFenelModule(`
      module custom where

      Boolean = CustomTruth

      predicate : String -> Boolean
      predicate value = CustomTruth

      guarded value =
        if predicate value then value else value
    `, "custom");
    expect(() => createRegistry([custom], { publishCatalogEntities: false })).toThrow(
      /inference\.nominal-mismatch: \["custom","Boolean"\] is not \["system","Boolean"\]/,
    );
  }, 180_000);

  test("strict identity projections retain FieldKey normalization but expose no semantic signature", () => {
    const raw: FenelFunction = {
      id: "cutover:identityOnly",
      params: [],
      returns: { $var: "compat-return" },
      body: { call: ["missingTarget"] },
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: raw.id,
      declarationName: "identityOnly",
      codeName: "identityOnly",
      params: [],
      returns: { $tag: "Absent" },
    };
    const mod = moduleFor(raw, { functionSignatureDeclarations: [declaration] });
    const lock = repositoryIdentityLock();
    const options = {
      codeNameLock: lock,
      fieldIdentity: {
        mode: "strict-embedded" as const,
        defaultRealm: "repository-source" as const,
        lock,
      },
    };

    const projected = createIdentityProjectionRegistry([mod], options);
    expect(projected.getFunction(raw.id)).not.toBe(raw);
    expect(projected.getFunctionSignatureInfo(raw.id)).toBeUndefined();
    expect(() => createRegistry([mod], options)).toThrow(
      /inference\.(missing-call|unknown-call|dynamic-call|unknown-name)/,
    );
    expect(() => createIdentityProjectionRegistry([mod], {
      fieldIdentity: {
        mode: "source-handles",
        defaultRealm: "repository-source",
      },
    })).toThrow("requires strict-embedded field identity");
  }, 600_000);

  test("all normal faces share one frozen effective view and explicit scheme info", () => {
    const raw: FenelFunction = {
      id: "cutover:identity",
      params: [field("value", { $var: "a" })],
      returns: { $var: "a" },
      body: { var: "value" },
    };
    const mod = moduleFor(raw);
    const registry = createRegistry([mod]);

    const byId = registry.getFunction(raw.id)!;
    expect(byId).not.toBe(raw);
    expect(registry.getIdentifiedFunction(raw.id)).toBe(byId);
    expect(registry.getFunctionByCodeName("identity")).toBe(byId);
    expect(registry.listFunctions()).toEqual([byId]);
    expect(registry.modules[0]!.functions).toEqual([byId]);
    expect(registry.modules[0]!.functionSignatureDeclarations).toBeUndefined();
    expect(Object.isFrozen(byId)).toBe(true);
    expect(Object.isFrozen(byId.params)).toBe(true);

    const info = registry.getFunctionSignatureInfo(raw.id)!;
    expect(registry.getFunctionScheme("identity")).toBe(info.scheme);
    expect(info.scheme.body).toEqual({
      $arrow: { params: byId.params, returns: byId.returns },
    });
    expect(info.params.map((slot) => slot.$tag)).toEqual(["Authored"]);
    expect(info.returns.$tag).toBe("Authored");
    const declaration = info.params[0]!;
    if (declaration.$tag !== "Authored") throw new Error("expected authored slot");
    expect(declaration.source.$tag).toBe("HostSpec");
    expect(info.implementationOrigin).toEqual({ $tag: "FenelBody" });
    expect(info.trust).toEqual({
      $tag: "TrustedPrimitive",
      evidence: {
        authority: "AuthoredSignature",
        origin: "FenelBody",
        posture: "LegacySC-sigUntilP4",
      },
    });
    expect(Object.isFrozen(info)).toBe(true);
    expect(registry.getRawFunctionForDebug(raw.id)).toBe(raw);
  }, 60_000);

  test("nested application paths survive curried source to flattened registry arrows", () => {
    const mod = loadFenelModule(`
      nested : Foo (Bar a) -> String -> Baz (Qux a)
      nested value separator = value
    `, "cutover");
    const registry = createRegistry([mod]);
    const fn = registry.getFunction("cutover:nested")!;
    const scheme = registry.getFunctionScheme("cutover:nested")!;

    expect(fn.params).toHaveLength(2);
    expect(scheme.body).toEqual({
      $arrow: { params: fn.params, returns: fn.returns },
    });
    expect(scheme.applications?.map((application) => ({
      head: "headRef" in application ? application.headRef : application.headVarId,
      path: application.path,
    }))).toEqual([
      {
        head: "Foo",
        path: ["$arrow", "params", "0", "type"],
      },
      {
        head: "Bar",
        path: ["$arrow", "params", "0", "type", "$el", "call", "1"],
      },
      { head: "Baz", path: ["$arrow", "returns"] },
      {
        head: "Qux",
        path: ["$arrow", "returns", "$el", "call", "1"],
      },
    ]);
  }, 60_000);

  test("nested field-bearing application arguments retain the identified function signature", () => {
    // C1/B3 extension: exercise the real source loader and registry field plan.
    // No replacement kinding, inference or field-identity rule lives here.
    const mod = loadFenelModule(`
      Cursor = Cursor offset: Nat
      DocInline = DocText text: String
      Parsed a = Parsed cursor: Cursor value: a
      @native
      parseInlines : (cursor: Cursor) -> Result String (Parsed (List DocInline))
      @native
      parseRecord : (cursor: Cursor) -> Result String (Parsed ({ text: String }))
      @native
      curried : (input: Parsed (List a)) -> String -> Parsed ({ item: a })
    `, "cutover");
    const before = JSON.stringify(mod);
    const registry = createRegistry([mod], { publishCatalogEntities: false });
    for (const name of ["parseInlines", "parseRecord", "curried"]) {
      const fn = registry.getFunction(`cutover:${name}`)!;
      const scheme = registry.getFunctionScheme(fn.id)!;
      expect(scheme.body).toEqual({ $arrow: { params: fn.params, returns: fn.returns } });
      expect(scheme.applications!.length).toBeGreaterThan(0);
      for (const application of scheme.applications!) {
        let selected: unknown = scheme.body;
        for (const segment of application.path) selected = (selected as Record<string, unknown>)[segment];
        const call = (selected as { $el: { call: unknown[] } }).$el.call;
        const expectedArguments: FenelType[] = call.slice(1).map(argument => {
          if (!isFenelType(argument)) throw new Error("The application fixture must retain FenelType arguments");
          return argument;
        });
        expect(application.args).toEqual(expectedArguments);
        expect(Object.isFrozen(application.args)).toBe(true);
        const fields = JSON.stringify(application.args);
        expect(fields).toContain('"NamedField"');
      }
      if (name === "curried") {
        expect(fn.params).toHaveLength(2);
        expect(scheme.quantified).toEqual([{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }]);
        expect(scheme.applications!.map(application => application.path)).toEqual([
          ["$arrow", "params", "0", "type"], ["$arrow", "returns"],
        ]);
      }
    }
    expect(JSON.stringify(mod)).toBe(before);
  }, 60_000);

  test("identified application transport refuses a divergent source argument", () => {
    const mod = loadFenelModule(`
      Parsed a = Parsed value: a
      @native
      mismatched : Parsed (List String)
    `, "cutover");
    const scheme = mod.functionSignatureDeclarations![0]!.scheme!;
    (scheme.applications![0]!.args as FenelType[])[0] = { $ref: "Number" };
    expect(() => createRegistry([mod], { publishCatalogEntities: false })).toThrow(
      /sidecar and traversal application arguments disagree/,
    );
  }, 60_000);

  test("shared module specs never leak mutation or effective objects across registries", () => {
    const raw: FenelFunction = {
      id: "cutover:isolated",
      params: [field("value", { $ref: "String" })],
      returns: { $ref: "String" },
      body: { var: "value" },
    };
    const mod = moduleFor(raw);
    const left = createRegistry([mod]);
    const right = createRegistry([mod]);
    const leftFn = left.getFunction(raw.id)!;
    const rightFn = right.getFunction(raw.id)!;

    expect(leftFn).not.toBe(rightFn);
    expect(left.getFunctionSignatureInfo(raw.id)).not.toBe(
      right.getFunctionSignatureInfo(raw.id),
    );
    expect(raw.params[0]!.key).toBeUndefined();
    expect(raw.requires).toBeUndefined();
    raw.returns = { $ref: "Number" };
    expect(leftFn.returns).toEqual({ $ref: "String" });
    expect(rightFn.returns).toEqual({ $ref: "String" });
  }, 60_000);

  test("native/body twins record the active implementation origin", () => {
    const raw: FenelFunction = {
      id: "cutover:twin",
      params: [field("value", { $ref: "String" })],
      returns: { $ref: "String" },
      body: { var: "value" },
    };
    const registry = createRegistry([moduleFor(raw, {
      nativeImpls: { "cutover:twin": (value) => value },
    })]);
    expect(registry.getFunctionSignatureInfo(raw.id)!.implementationOrigin).toEqual({
      $tag: "NativeWithFallback",
      map: "nativeImpls",
    });
    expect(registry.getFunctionSignatureInfo(raw.id)!.trust.$tag).toBe("TrustedPrimitive");

    const nativeOnly: FenelFunction = {
      id: "cutover:nativeOnly",
      params: [field("value", { $ref: "String" })],
      returns: { $ref: "String" },
    };
    const nativeRegistry = createRegistry([moduleFor(nativeOnly, {
      nativeImplsCtx: { "cutover:nativeOnly": (_ctx, value) => value },
    })]);
    expect(nativeRegistry.getFunctionSignatureInfo(nativeOnly.id)!.implementationOrigin).toEqual({
      $tag: "HostNative",
      map: "nativeImplsCtx",
    });
    expect(nativeRegistry.getFunctionSignatureInfo(nativeOnly.id)!.trust.$tag).toBe(
      "TrustedPrimitive",
    );
  }, 60_000);

  test("native/body twins cannot derive absent signature authority from the fallback body", () => {
    const raw: FenelFunction = {
      id: "cutover:inferableFallback",
      params: [field("value", { $var: "compat-only" })],
      returns: { $var: "compat-return-only" },
      body: { var: "value" },
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: raw.id,
      declarationName: "inferableFallback",
      codeName: "inferableFallback",
      params: [{ $tag: "Absent" }],
      returns: { $tag: "Absent" },
    };
    const fallbackOnly = createRegistry([moduleFor(raw, {
      functionSignatureDeclarations: [declaration],
    })]);
    const fallbackInfo = fallbackOnly.getFunctionSignatureInfo(raw.id)!;
    expect(fallbackInfo.implementationOrigin).toEqual({ $tag: "FenelBody" });
    expect(fallbackInfo.params.map(({ $tag }) => $tag)).toEqual(["Inferred"]);
    expect(fallbackInfo.returns.$tag).toBe("Inferred");
    expect(fallbackInfo.trust.$tag).toBe("InferredDerivation");

    expect(() => createRegistry([moduleFor(raw, {
      functionSignatureDeclarations: [declaration],
      nativeImpls: { [raw.id]: (value) => value },
    })])).toThrow(
      `${raw.id}: inference.native-annotation: parameter value requires a type annotation`,
    );

    const returnOnly: FenelFunction = {
      id: "cutover:inferableFallbackReturn",
      params: [field("value", { $ref: "String" })],
      returns: { $var: "compat-return-only" },
      body: { var: "value" },
    };
    const returnOnlyDeclaration: FunctionSignatureDeclaration = {
      functionId: returnOnly.id,
      declarationName: "inferableFallbackReturn",
      codeName: "inferableFallbackReturn",
      params: [{
        $tag: "Authored",
        source: { $tag: "HostSpec", module: "cutover" },
      }],
      returns: { $tag: "Absent" },
    };
    expect(() => createRegistry([moduleFor(returnOnly, {
      functionSignatureDeclarations: [returnOnlyDeclaration],
      nativeImpls: { [returnOnly.id]: (value) => value },
    })])).toThrow(
      `${returnOnly.id}: inference.native-annotation: return requires a type annotation`,
    );
  }, 180_000);

  test("account registries isolate schemes, provenance, and diagnostics over shared repository modules", () => {
    const sharedId = "cutover-account-shared:marker";
    const sharedRepositoryModule: FenelModule = {
      name: "cutover-account-shared",
      label: "Shared account signature fixture",
      entities: [],
      functions: [{
        id: sharedId,
        params: [],
        returns: { $ref: "String" },
        body: "shared",
      }],
      instances: [{
        typeName: "Codeable",
        args: [sharedId],
        methods: { codeName: "marker" },
      }],
    };
    const accountId = "cutover-account:probe";
    const accountModule = (
      moduleName: string,
      param: FieldDef,
      returns: FenelType,
    ): FenelModule => {
      const authored = {
        $tag: "Authored" as const,
        source: { $tag: "HostSpec" as const, module: moduleName },
      };
      return {
        name: moduleName,
        label: moduleName,
        entities: [],
        functions: [{
          id: accountId,
          params: [param],
          returns,
          body: { var: param.name },
        }],
        functionSignatureDeclarations: [{
          functionId: accountId,
          declarationName: "probe",
          codeName: "probe",
          scheme: {
            quantified: [],
            body: { $arrow: { params: [param], returns } },
            applications: [],
          },
          params: [authored],
          returns: authored,
        }],
        instances: [{
          typeName: "Codeable",
          args: [accountId],
          methods: { codeName: "probe" },
        }],
      };
    };

    const dependentReturn: FenelType = {
      $el: { call: ["Vec", { var: "_0" }] },
    };
    const repositoryModules = [sharedRepositoryModule];
    const left = createAccountRegistry(repositoryModules, [accountModule(
      "cutover-account-left",
      positionalField("_0", 0, { $ref: "Number" }),
      dependentReturn,
    )]);
    const leftInfo = left.getFunctionSignatureInfo(accountId)!;
    const leftSharedInfo = left.getFunctionSignatureInfo(sharedId)!;
    const right = createAccountRegistry(repositoryModules, [accountModule(
      "cutover-account-right",
      positionalField("_0", 0, { $ref: "String" }),
      { $ref: "String" },
    )]);
    const rightInfo = right.getFunctionSignatureInfo(accountId)!;
    const rightSharedInfo = right.getFunctionSignatureInfo(sharedId)!;

    expect(leftInfo).not.toBe(rightInfo);
    expect(leftInfo.scheme).not.toBe(rightInfo.scheme);
    expect(leftInfo.scheme.body).toMatchObject({
      $arrow: { returns: dependentReturn },
    });
    expect(rightInfo.scheme.body).toMatchObject({
      $arrow: { returns: { $ref: "String" } },
    });
    expect(leftInfo.params[0]).toEqual({
      $tag: "Authored",
      source: { $tag: "HostSpec", module: "cutover-account-left" },
    });
    expect(rightInfo.params[0]).toEqual({
      $tag: "Authored",
      source: { $tag: "HostSpec", module: "cutover-account-right" },
    });
    expect(leftInfo.params[0]).not.toBe(rightInfo.params[0]);
    expect(leftInfo.outcome.$tag).toBe("AnnotationRequired");
    if (leftInfo.outcome.$tag === "AnnotationRequired") {
      expect(leftInfo.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.value-dependent-type",
      ]);
    }
    expect(rightInfo.outcome).toEqual({ $tag: "Solved" });
    expect(leftInfo.outcome).not.toBe(rightInfo.outcome);
    expect("diagnostics" in rightInfo.outcome).toBe(false);
    expect(leftInfo.trust.$tag).toBe("Advisory");
    expect(rightInfo.trust.$tag).toBe("TrustedPrimitive");

    expect(leftSharedInfo).not.toBe(rightSharedInfo);
    expect(leftSharedInfo.scheme).not.toBe(rightSharedInfo.scheme);
    expect(leftSharedInfo.returns).not.toBe(rightSharedInfo.returns);
    expect(leftSharedInfo.outcome).not.toBe(rightSharedInfo.outcome);
    expect(leftSharedInfo).toEqual(rightSharedInfo);
    expect(leftSharedInfo.scheme.body).toEqual({
      $arrow: { params: [], returns: { $ref: "String" } },
    });
    expect(leftSharedInfo.outcome).toEqual({ $tag: "Solved" });
  }, 600_000);

  test("falsy primitive bodies remain the active inferred runtime implementation", () => {
    const cases = [
      { id: "cutover:falseBody", body: false, returns: { $ref: "Boolean" } },
      { id: "cutover:zeroBody", body: 0, returns: { $ref: "Number" } },
      { id: "cutover:emptyStringBody", body: "", returns: { $ref: "String" } },
    ] as const;
    const functions: FenelFunction[] = cases.map(({ id, body }) => ({
      id,
      params: [],
      returns: { $var: "compat-return-only" },
      body,
    }));
    const module: FenelModule = {
      name: "cutover",
      label: "Cutover",
      entities: [],
      functions,
      functionSignatureDeclarations: functions.map((fn) => ({
        functionId: fn.id,
        declarationName: fn.id.slice(fn.id.indexOf(":") + 1),
        codeName: fn.id.slice(fn.id.indexOf(":") + 1),
        params: [],
        returns: { $tag: "Absent" },
      })),
      instances: functions.map((fn) => ({
        typeName: "Codeable",
        args: [fn.id],
        methods: { codeName: fn.id.slice(fn.id.indexOf(":") + 1) },
      })),
    };
    const registry = createRegistry([module]);
    const ctx = registry.evaluateContext();

    for (const expected of cases) {
      const effective = registry.getFunction(expected.id)!;
      const info = registry.getFunctionSignatureInfo(expected.id)!;
      expect(effective.returns).toEqual(expected.returns);
      expect(info.implementationOrigin).toEqual({ $tag: "FenelBody" });
      expect(info.outcome.$tag).toBe("Solved");
      expect(evaluate({ call: [expected.id] }, {}, ctx)).toBe(expected.body);
    }
  }, 180_000);

  test("bodyless native Absent slots fail with exact annotation diagnostics", () => {
    const raw: FenelFunction = {
      id: "cutover:nativeMissing",
      params: [field("value", { $var: "compat-only" })],
      returns: { $var: "compat-return-only" },
    };
    const declaration: FunctionSignatureDeclaration = {
      functionId: raw.id,
      declarationName: "nativeMissing",
      codeName: "nativeMissing",
      params: [{ $tag: "Absent" }],
      returns: { $tag: "Absent" },
    };
    expect(() => createRegistry([moduleFor(raw, {
      functionSignatureDeclarations: [declaration],
      nativeImpls: { "cutover:nativeMissing": (value) => value },
    })])).toThrow(
      "cutover:nativeMissing: inference.native-annotation: parameter value requires a type annotation",
    );
  }, 60_000);

  test("function accessors and cycles reject without observation", () => {
    let reads = 0;
    const hostile = {
      id: "cutover:hostile",
      params: [],
    } as unknown as FenelFunction;
    Object.defineProperty(hostile, "returns", {
      enumerable: true,
      get() {
        reads += 1;
        return { $ref: "String" };
      },
    });
    expect(() => createRegistry([moduleFor(hostile)])).toThrow("accessor property");
    expect(reads).toBe(0);

    const body: Record<string, unknown> = {};
    body.self = body;
    const cyclic: FenelFunction = {
      id: "cutover:cyclic",
      params: [],
      returns: { $ref: "String" },
      body,
    };
    expect(() => createRegistry([moduleFor(cyclic)])).toThrow("cyclic transport data");
  });
});
