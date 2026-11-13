import { describe, expect, test } from "bun:test";

import { loadFenelModule } from "./fenel-module";
import { evaluate, withImports } from "./json-logic";
import { createEngineBootstrapRegistry, createRegistry } from "./registry";
import { Nothing } from "./type-foundation";
import type {
  FenelFunction,
  FenelModule,
  FenelType,
  FunctionSignatureDeclaration,
  SignatureDeclarationSource,
  SlotDeclaration,
} from "./types";

const stringType: FenelType = { $ref: "String" };
const field = (name: string, type: FenelType) => ({
  name,
  type,
  label: Nothing,
  ui: Nothing,
  meta: {},
});
const authored = (module: string): SlotDeclaration => ({
  $tag: "Authored",
  source: { $tag: "HostSpec", module },
});

function moduleFor(
  name: string,
  functions: FenelFunction[],
  options: Partial<FenelModule> = {},
): FenelModule {
  return {
    name,
    label: name,
    functions,
    instances: functions.map((fn) => ({
      typeName: "Codeable",
      args: [fn.id],
      methods: { codeName: fn.id.slice(fn.id.indexOf(":") + 1) },
    })),
    ...options,
  };
}

function declarationFor(
  fn: FenelFunction,
  params: readonly SlotDeclaration[],
  returns: SlotDeclaration,
): FunctionSignatureDeclaration {
  return {
    functionId: fn.id,
    declarationName: fn.id.slice(fn.id.indexOf(":") + 1),
    codeName: fn.id.slice(fn.id.indexOf(":") + 1),
    params,
    returns,
  };
}

describe("registry signature declaration transport", () => {
  test("the serialized module sidecar overrides the exact-object WeakMap fallback", () => {
    const mod = loadFenelModule(`
      prefer : String -> String
      prefer value = value
    `, "precedence");
    const original = mod.functionSignatureDeclarations![0]!;
    const source: SignatureDeclarationSource = {
      $tag: "HostSpec",
      module: "authoritative-module-sidecar",
    };
    mod.functionSignatureDeclarations = [{
      ...original,
      params: [{ $tag: "Authored", source }],
      returns: { $tag: "Authored", source },
    }];

    const info = createRegistry([mod]).getFunctionSignatureInfo("precedence:prefer")!;
    expect(info.params).toEqual([{ $tag: "Authored", source }]);
    expect(info.returns).toEqual({ $tag: "Authored", source });
  }, 180_000);

  test("duplicate declarations for one function id fail before finalization", () => {
    const fn: FenelFunction = {
      id: "transport:duplicate",
      params: [],
      returns: stringType,
      body: "ok",
    };
    const declaration = declarationFor(fn, [], authored("transport"));
    const mod = moduleFor("transport", [fn], {
      functionSignatureDeclarations: [declaration, { ...declaration }],
    });

    expect(() => createRegistry([mod])).toThrow(
      "registry module transport: duplicate function signature declaration transport:duplicate",
    );
  });

  test("duplicate canonical function definitions reject before authored/inferred plans can cross-wire", () => {
    const functionId = "duplicate-owner:entry";
    const authoredFn: FenelFunction = {
      id: functionId,
      params: [],
      returns: stringType,
      body: "authored",
    };
    const missingFn: FenelFunction = {
      id: functionId,
      params: [],
      returns: { $var: "missing-return" },
      body: "inferred",
    };
    const authoredModule = moduleFor("authored-owner", [authoredFn], {
      functionSignatureDeclarations: [declarationFor(
        authoredFn,
        [],
        authored("authored-owner"),
      )],
    });
    const inferredModule = moduleFor("inferred-owner", [missingFn], {
      functionSignatureDeclarations: [declarationFor(
        missingFn,
        [],
        { $tag: "Absent" },
      )],
    });

    for (const modules of [
      [authoredModule, inferredModule],
      [inferredModule, authoredModule],
    ]) {
      expect(() => createRegistry(modules)).toThrow(
        `registry: duplicate canonical function id ${functionId}`,
      );
    }
  });

  test("sparse declaration parameter arrays are rejected without prototype fallback", () => {
    const fn: FenelFunction = {
      id: "transport:sparse",
      params: [field("value", stringType)],
      returns: stringType,
      body: { var: "value" },
    };
    const params = new Array<SlotDeclaration>(1);
    const declaration = declarationFor(fn, params, authored("transport"));

    expect(() => createRegistry([moduleFor("transport", [fn], {
      functionSignatureDeclarations: [declaration],
    })])).toThrow(
      "registry modules[1].functionSignatureDeclarations[0].params: sparse array slot 0 is not allowed",
    );
  });

  test("bootstrap registries expose no fabricated signature trust", () => {
    const fn: FenelFunction = {
      id: "transport:bootstrap",
      params: [],
      returns: stringType,
      body: "ok",
    };
    const registry = createEngineBootstrapRegistry([moduleFor("transport", [fn])]);

    expect(registry.getFunctionSignatureInfo(fn.id)).toBeUndefined();
    expect(registry.evaluateContext().getFunctionSignatureInfo?.(fn.id)).toBeUndefined();
  });

  test("selective imports resolve a cross-prefix canonical id exactly like runtime", () => {
    const crossPrefix: FenelFunction = {
      id: "actual:target",
      params: [field("value", stringType)],
      returns: stringType,
      body: { var: "value" },
    };
    const collision: FenelFunction = {
      id: "other:target",
      params: [field("value", { $ref: "Number" })],
      returns: { $ref: "Number" },
      body: { var: "value" },
    };
    const caller: FenelFunction = {
      id: "caller:useTarget",
      params: [field("value", stringType)],
      returns: { $var: "compat-return" },
      body: { call: ["target", { var: "value" }] },
    };
    const wrapper = moduleFor("wrapper", [crossPrefix]);
    const other = moduleFor("other", [collision]);
    const callerModule = moduleFor("caller", [caller], {
      imports: [{ module: "actual", names: ["target"] }],
      functionSignatureDeclarations: [declarationFor(
        caller,
        [authored("caller")],
        { $tag: "Absent" },
      )],
    });

    const registry = createRegistry([wrapper, other, callerModule]);
    expect(registry.getFunctionByCodeName("target")).toBeDefined();
    expect(registry.getFunctionSignatureInfo(caller.id)!.returns.$tag).toBe("Inferred");
    expect(registry.getFunction(caller.id)!.returns).toEqual(stringType);

    const frame = registry.buildImportFrame(callerModule.imports!);
    expect(frame.names.target).toBe("actual:target");
    expect(withImports(registry.evaluateContext(), frame, (ctx) =>
      evaluate({ call: ["target", "round-trip"] }, {}, ctx)
    )).toBe("round-trip");
  }, 180_000);

  test("module-qualified calls stay exact when the bare codeName is ambiguous", () => {
    const stdSome: FenelFunction = {
      id: "std:some",
      params: [field("value", stringType)],
      returns: stringType,
      body: { var: "value" },
    };
    const engineSome: FenelFunction = {
      id: "engine:some",
      params: [field("value", { $ref: "Number" })],
      returns: { $ref: "Number" },
      body: { var: "value" },
    };
    const caller: FenelFunction = {
      id: "permissions:useSome",
      params: [field("value", stringType)],
      returns: { $var: "compat-return" },
      body: { call: ["std.some", { var: "value" }] },
    };
    const fullyAuthored = (module: string, fn: FenelFunction) => declarationFor(
      fn,
      fn.params.map(() => authored(module)),
      authored(module),
    );

    const registry = createRegistry([
      moduleFor("std", [stdSome], {
        functionSignatureDeclarations: [fullyAuthored("std", stdSome)],
      }),
      moduleFor("engine", [engineSome], {
        functionSignatureDeclarations: [fullyAuthored("engine", engineSome)],
      }),
      moduleFor("permissions", [caller], {
        functionSignatureDeclarations: [declarationFor(
          caller,
          [authored("permissions")],
          { $tag: "Absent" },
        )],
      }),
    ]);

    const info = registry.getFunctionSignatureInfo(caller.id)!;
    expect(info.outcome.$tag).toBe("Solved");
    expect(info.returns.$tag).toBe("Inferred");
    expect(registry.getFunction(caller.id)!.returns).toEqual(stringType);
    expect(evaluate(
      { call: ["useSome", "round-trip"] },
      {},
      registry.evaluateContext(),
    )).toBe("round-trip");
  }, 180_000);

  test("registry-local import snapshots preserve routing and canonicalize selector order", () => {
    const target: FenelFunction = {
      id: "actual:target",
      params: [field("value", stringType)],
      returns: stringType,
      body: { var: "value" },
    };
    const collision: FenelFunction = {
      id: "other:target",
      params: [field("value", { $ref: "Number" })],
      returns: { $ref: "Number" },
      body: { var: "value" },
    };
    const caller = (module: string): FenelFunction => ({
      id: `${module}:useTarget`,
      params: [field("value", stringType)],
      returns: { $var: "compat-return" },
      body: { call: ["target", { var: "value" }] },
    });
    const regularCaller = caller("caller-regular");
    const permutedCaller = caller("caller-permuted");
    const regularImports: NonNullable<FenelModule["imports"]> = [
      { module: "actual", names: ["unused", "target"] },
      { module: "ghost", hiding: ["z", "target", "x"] },
    ];
    const permutedNames = {
      names: ["target", "unused"],
      module: "actual",
    };
    const permutedHiding = {
      hiding: ["x", "z", "target"],
      module: "ghost",
    };
    const permutedImports: NonNullable<FenelModule["imports"]> = [
      permutedNames,
      permutedHiding,
    ];
    const regularModule = moduleFor("caller-regular", [regularCaller], {
      imports: regularImports,
      functionSignatureDeclarations: [declarationFor(
        regularCaller,
        [authored("caller-regular")],
        { $tag: "Absent" },
      )],
    });
    const permutedModule = moduleFor("caller-permuted", [permutedCaller], {
      imports: permutedImports,
      functionSignatureDeclarations: [declarationFor(
        permutedCaller,
        [authored("caller-permuted")],
        { $tag: "Absent" },
      )],
    });

    const registry = createRegistry([
      moduleFor("wrapper", [target]),
      moduleFor("other", [collision]),
      regularModule,
      permutedModule,
    ]);
    expect(registry.getFunction(regularCaller.id)!.returns).toEqual(stringType);
    expect(registry.getFunction(permutedCaller.id)!.returns).toEqual(stringType);

    const regularSnapshot = registry.modules.find(({ name }) => name === "caller-regular")!.imports;
    const permutedSnapshot = registry.modules.find(({ name }) => name === "caller-permuted")!.imports;
    expect(permutedSnapshot).toEqual(regularSnapshot);
    expect(JSON.stringify(permutedSnapshot)).toBe(JSON.stringify(regularSnapshot));
    expect(Object.isFrozen(regularSnapshot)).toBe(true);
    expect(Object.isFrozen(regularSnapshot![0]!.names)).toBe(true);
    expect(Object.isFrozen(regularSnapshot![1]!.hiding)).toBe(true);
  }, 180_000);

});
