import { describe, expect, it } from "bun:test";

import {
  compileCallBindingsByFnId,
  compileModuleCallBindings,
  compileRegistryDeclarationCallBindings,
  isCompilerOwnedCallBindings,
} from "./compile-call-bindings";
import type { RegistryConstructorSignature } from "./registry";
import {
  compileConstructorSlotConflicts,
  compileConstructorSlotTable,
  compileFieldSlotListOccurrences,
  positionalCompileFieldSlots,
} from "./compile-field-slots";
import {
  compileSourceFromUnknown,
  type CompileSource,
} from "./compilable";
import {
  dispatchEngineBody,
  dispatchedNormaliseToCore,
  dispatchedSerializeJsModule,
} from "./engine-bodies-dispatch";
import { compileFenelToJsNative } from "./modules/compile-js";
import {
  compileFenelToLlvmNative,
  serializeLlvmModuleNative,
} from "./modules/compile-llvm";
import {
  compileFenelToWasmNative,
  serializeWasmModuleNative,
} from "./modules/compile-wasm";
import type { FenelModule } from "./types";

const demoModule: FenelModule = {
  name: "demo",
  label: "Compiler module-call binding fixture",
  functions: [
    {
      id: "demo:helper",
      params: [],
      returns: { $ref: "Number" },
      body: 42,
    },
    {
      id: "demo:caller",
      params: [],
      returns: { $ref: "Number" },
      body: { call: ["helper"] },
    },
  ],
};

const callBindings = compileModuleCallBindings(demoModule);

const otherCallBindings = compileModuleCallBindings({
  name: "other",
  functions: [{
    id: "other:helper",
    params: [],
    returns: { $ref: "Number" },
    body: 99,
  }],
});

const recursiveBindings = compileModuleCallBindings({
  name: "demo",
  functions: [
    {
      id: "demo:spin",
      params: [],
      returns: { $ref: "a" },
      body: { call: ["spin"] },
    },
    {
      id: "demo:nest",
      params: [],
      returns: { $record: { fields: [] } },
      body: { value: { call: ["nest"] } },
    },
  ],
});

// C1: a registry contains actual constructor Functions beyond the source
// declaration roster used by artifact emitters. Only the captured constructor
// signatures establish that difference; UUID syntax supplies no evidence.
describe("registry declaration lexical roster", () => {
  const actConstructorId = "c4858054-836d-44de-9897-51e65a9c34b8";
  const constructorSignature = (functionId: string | undefined): RegistryConstructorSignature => ({
    name: "Act", ...(functionId === undefined ? {} : { functionId }),
    targetId: "@ctor/authority/Act/Act", ownerIdentity: "act-owner-fixture", ownerName: "Act",
    ownerModule: "authority", params: [], returns: { $ref: "Any" }, outcome: { $tag: "Solved" },
  });
  const actConstructor = { id: actConstructorId, params: [], returns: { $ref: "Any" } } as NonNullable<FenelModule["functions"]>[number];
  Object.defineProperty(actConstructor, "body", { get: () => {
    throw new Error("Lexical declaration projection read a synthesized constructor body");
  } });

  it("excludes only proved constructor identities and equals unchanged worker source bindings", () => {
    const worker = compileCallBindingsByFnId([demoModule]);
    const functions = [...demoModule.functions!, actConstructor];
    expect(() => compileCallBindingsByFnId([{ functions }])).toThrow(actConstructorId);
    const projected = compileRegistryDeclarationCallBindings({
      listFunctions: () => functions,
      listConstructorSignatures: () => [constructorSignature(actConstructorId)],
    });
    expect([...projected]).toEqual([...worker]);
    expect(projected.has(actConstructorId)).toBe(false);
    expect(functions).toHaveLength(3);
    for (const bindings of projected.values()) {
      expect(Object.isFrozen(bindings)).toBe(true);
      expect(Object.getPrototypeOf(bindings)).toBeNull();
      expect(isCompilerOwnedCallBindings(bindings)).toBe(true);
    }
  });

  it("requires current constructor proof even for the original failing UUID", () => {
    for (const signatures of [[], [constructorSignature(undefined)], [constructorSignature("90000000-0000-4000-8000-000000000001")]]) {
      expect(() => compileRegistryDeclarationCallBindings({
        listFunctions: () => [...demoModule.functions!, actConstructor],
        listConstructorSignatures: () => signatures,
      })).toThrow("has no full owner:name id");
    }
  });

  it("does not silently admit ordinary UUIDs, malformed names or duplicate source declarations", () => {
    for (const id of ["90000000-0000-4000-8000-000000000002", "unowned", ":helper", "demo:"]) {
      expect(() => compileRegistryDeclarationCallBindings({
        listFunctions: () => [...demoModule.functions!, actConstructor, { ...demoModule.functions![0]!, id }],
        listConstructorSignatures: () => [constructorSignature(actConstructorId)],
      })).toThrow("has no full owner:name id");
    }
    expect(() => compileRegistryDeclarationCallBindings({
      listFunctions: () => [...demoModule.functions!, demoModule.functions![0]!, actConstructor],
      listConstructorSignatures: () => [constructorSignature(actConstructorId)],
    })).toThrow("duplicate local declaration");
  });

  it("uses constructor evidence independently of the identity's textual shape", () => {
    const namedConstructor = { ...demoModule.functions![0]!, id: "authority:Act" };
    expect([...compileRegistryDeclarationCallBindings({
      listFunctions: () => [...demoModule.functions!, namedConstructor],
      listConstructorSignatures: () => [constructorSignature(namedConstructor.id)],
    })]).toEqual([...compileCallBindingsByFnId([demoModule])]);
  });

  it("retains native, appendItem and projected dynamic-dispatch ABI decisions", () => {
    const runtimeModule: Pick<FenelModule, "functions"> = { functions: [
      { id: "std:nativeLeaf", params: [], returns: { $ref: "Number" } },
      { id: "std:appendItem", params: [], returns: { $ref: "Any" }, body: 0 },
      { id: "std:ordinary", params: [], returns: { $ref: "Number" }, body: 1 },
      { id: "std:dispatchMethod", params: [], returns: { $ref: "Number" }, body: 2 },
    ] };
    const options = { preserveBare: new Set(["dispatchMethod"]) };
    const worker = compileCallBindingsByFnId([demoModule, runtimeModule], options);
    const projected = compileRegistryDeclarationCallBindings({
      listFunctions: () => [...demoModule.functions!, ...runtimeModule.functions!, actConstructor],
      listConstructorSignatures: () => [constructorSignature(actConstructorId)],
    }, options);
    expect([...projected]).toEqual([...worker]);
    expect({ ...projected.get("std:ordinary") }).toEqual({ ordinary: "std:ordinary" });
    expect(projected.get("std:nativeLeaf")?.nativeLeaf).toBeUndefined();
    expect(projected.get("std:appendItem")?.appendItem).toBeUndefined();
    expect(projected.get("std:dispatchMethod")?.dispatchMethod).toBeUndefined();
  });
});

function callerSource(body: unknown = { call: ["helper"] }): CompileSource {
  return {
    name: "caller",
    params: [],
    body,
    ctorDefs: {},
    callBindings,
  };
}

describe("compiler module-local call bindings", () => {
  it("mechanically projects one immutable bare-name to full-fnId index", () => {
    expect({ ...callBindings }).toEqual({
      helper: "demo:helper",
      caller: "demo:caller",
    });
    expect(Object.isFrozen(callBindings)).toBe(true);
    expect(otherCallBindings.helper).toBe("other:helper");
    expect(callBindings.helper).toBe("demo:helper");
    expect(compileModuleCallBindings({
      name: "demo",
      functions: [{
        id: "demo:nativeLeaf",
        params: [],
        returns: { $ref: "Number" },
      }],
    })["nativeLeaf"]).toBeUndefined();

    const stdBindings = compileModuleCallBindings({
      name: "std",
      functions: [
        {
          id: "std:appendItem",
          params: [],
          returns: { $ref: "a" },
          body: { call: ["concat", { var: "arr" }, [{ var: "item" }]] },
        },
        {
          id: "std:helper",
          params: [],
          returns: { $ref: "Number" },
          body: 1,
        },
      ],
    });
    expect({ ...stdBindings }).toEqual({ helper: "std:helper" });
  });

  it("keeps list-literal appendItem primitive while resolving ordinary std calls", () => {
    const stdBindings = compileModuleCallBindings({
      name: "std",
      functions: [
        {
          id: "std:appendItem",
          params: [],
          returns: { $ref: "a" },
          body: { call: ["concat", { var: "arr" }, [{ var: "item" }]] },
        },
        {
          id: "std:helper",
          params: [],
          returns: { $ref: "Number" },
          body: 1,
        },
      ],
    });

    const literal = dispatchedNormaliseToCore({
      name: "std:literal",
      params: [],
      body: [1],
      ctorDefs: {},
      callBindings: stdBindings,
    });
    expect(literal).toMatchObject({
      $tag: "Ok",
      _0: { body: { $tag: "ECall", fnId: "appendItem" } },
    });

    const ordinary = dispatchedNormaliseToCore({
      name: "std:caller",
      params: [],
      body: { call: ["helper"] },
      ctorDefs: {},
      callBindings: stdBindings,
    });
    expect(ordinary).toMatchObject({
      $tag: "Ok",
      _0: { body: { $tag: "ECall", fnId: "std:helper" } },
    });
  });

  it("preserves only projected dynamic-dispatch names as bare calls", () => {
    const routedBindings = compileModuleCallBindings(demoModule, {
      preserveBare: new Set(["helper"]),
    });
    expect({ ...routedBindings }).toEqual({ caller: "demo:caller" });

    const routed = dispatchedNormaliseToCore({
      ...callerSource(),
      callBindings: routedBindings,
    });
    expect(routed).toMatchObject({
      $tag: "Ok",
      _0: { body: { $tag: "ECall", fnId: "helper" } },
    });

    const ordinary = dispatchedNormaliseToCore(callerSource());
    expect(ordinary).toMatchObject({
      $tag: "Ok",
      _0: { body: { $tag: "ECall", fnId: "demo:helper" } },
    });
  });

  it("fails closed on declarations that cannot form one exact module namespace", () => {
    expect(() => compileModuleCallBindings({
      name: "demo",
      functions: [{ ...demoModule.functions![0]!, id: "foreign:helper" }],
    })).toThrow("is not owned by module");
    expect(() => compileModuleCallBindings({
      name: "demo",
      functions: [demoModule.functions![0]!, demoModule.functions![0]!],
    })).toThrow("duplicate local declaration");
    expect(() => compileModuleCallBindings({
      name: "demo",
      functions: [{ ...demoModule.functions![0]!, id: "demo:" }],
    })).toThrow("empty local name");
  });

  it("keeps raw source bodies opaque to emitted-IR slot validation", () => {
    expect(compileFieldSlotListOccurrences({
      name: "converter",
      params: [],
      body: {
        match: [
          { var: "expr" },
          { $tag: "EConstruct", fields: { $bind: "fields" } },
          { construct: ["CeConstruct", { fields: { var: "fields" } }] },
        ],
      },
      ctorDefs: {},
    }).map((occurrence) => occurrence.path)).toEqual(["$.params"]);
  });

  it("Fenel recursively resolves exact local heads and preserves all other heads", () => {
    const result = dispatchedNormaliseToCore({
      ...callerSource({
        call: [
          "helper",
          { call: ["external"] },
          { call: ["demo:alreadyQualified"] },
          { call: ["$dyn:f"] },
        ],
      }),
      // `f` is a parameter: a dynamic head must name a binder in scope.
      params: positionalCompileFieldSlots(["f"]),
      callBindings: {
        ...callBindings,
        "demo:alreadyQualified": "evil:qualified",
        "$dyn:f": "evil:dynamic",
      },
    });
    expect(result.$tag).toBe("Ok");
    if (result.$tag !== "Ok") return;
    expect(result._0.body).toEqual({
      $tag: "ECall",
      fnId: "demo:helper",
      args: [
        { $tag: "ECall", fnId: "external", args: [] },
        { $tag: "ECall", fnId: "demo:alreadyQualified", args: [] },
        { $tag: "ECall", fnId: "$dyn:f", args: [] },
      ],
    });
  });

  it("Fenel visits every recursive child of the seven-case Expr", () => {
    const localCall = { $tag: "ECall", fnId: "helper", args: [] };
    const expr = {
      $tag: "EMatch",
      scrutinee: localCall,
      arms: [{
        pattern: { $tag: "PatWildcard" },
        guard: localCall,
        body: {
          $tag: "ERecord",
          fields: [
            {
              name: "lambda",
              value: { $tag: "ELambda", params: [], body: localCall },
            },
            {
              name: "construct",
              value: {
                $tag: "EConstruct",
                ctor: "Box",
                args: [localCall, { $tag: "ELit", value: 1 }],
                fields: [{ wireName: "value", key: { $tag: "PositionalField", index: 0 } }],
              },
            },
            { name: "variable", value: { $tag: "EVar", name: "x" } },
          ],
        },
      }],
    };
    const resolved = dispatchEngineBody("engine:compileResolveCalls", [expr, callBindings]) as any;
    expect(resolved.scrutinee.fnId).toBe("demo:helper");
    expect(resolved.arms[0].guard.fnId).toBe("demo:helper");
    expect(resolved.arms[0].body.fields[0].value.body.fnId).toBe("demo:helper");
    expect(resolved.arms[0].body.fields[1].value.args[0].fnId).toBe("demo:helper");
    expect(resolved.arms[0].body.fields[1].value.fields).toEqual(
      expr.arms[0]!.body.fields[1]!.value.fields,
    );
    expect(resolved.arms[0].body.fields[2].value).toEqual({ $tag: "EVar", name: "x" });
  });

  it("JS preserves the full runtime key and executes without a short alias", () => {
    const compiled = compileFenelToJsNative(callerSource());
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    expect(compiled._0.entry.body).toMatchObject({
      $tag: "JsCall",
      callee: {
        $tag: "JsMember",
        property: "demo:helper",
      },
    });

    const serialized = dispatchedSerializeJsModule(compiled._0);
    expect(serialized).toEqual({
      $tag: "Ok",
      _0: "(() => $fenel[\"demo:helper\"]())",
    });
    if (serialized.$tag !== "Ok") return;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialized._0};`)({
      "demo:helper": () => 42,
      helper: () => -1,
    }) as () => unknown;
    expect(fn()).toBe(42);
  });

  it("Wasm preserves the full function id as the exact import name", () => {
    const compiled = compileFenelToWasmNative(callerSource());
    expect(compiled.$tag).toBe("Ok");
    if (compiled.$tag !== "Ok") return;
    expect(compiled._0.imports).toContainEqual(expect.objectContaining({
      $tag: "WasmFuncImport",
      module: "$fenel",
      name: "demo:helper",
    }));

    const encoded = serializeWasmModuleNative(compiled._0);
    expect(encoded.$tag).toBe("Ok");
    if (encoded.$tag !== "Ok") return;
    const module = new WebAssembly.Module(encoded._0 as unknown as BufferSource);
    const instance = new WebAssembly.Instance(module, {
      $fenel: { "demo:helper": () => 42, helper: () => -1 },
    });
    expect((instance.exports["caller"] as () => unknown)()).toBe(42);
  });

  it("LLVM carries the full id through a reversible collision-free symbol", () => {
    const symbol = "fenel_fn_64656D6F3A68656C706572";
    const caller = compileFenelToLlvmNative(callerSource());
    expect(caller.$tag).toBe("Ok");
    if (caller.$tag !== "Ok") return;
    expect(caller._0.declarations).toContainEqual(expect.objectContaining({ name: symbol }));
    const callerIr = serializeLlvmModuleNative(caller._0);
    expect(callerIr).toMatchObject({ $tag: "Ok" });
    if (callerIr.$tag !== "Ok") return;
    expect(callerIr._0).toContain(`@${symbol}()`);

    const helper = compileFenelToLlvmNative({
      name: "demo:helper",
      params: [],
      body: "answer",
      ctorDefs: {},
      callBindings,
    });
    expect(helper.$tag).toBe("Ok");
    if (helper.$tag !== "Ok") return;
    expect(helper._0.definitions.at(-1)?.name).toBe(symbol);
    const helperIr = serializeLlvmModuleNative(helper._0);
    expect(helperIr).toMatchObject({ $tag: "Ok" });
    if (helperIr.$tag !== "Ok") return;
    expect(helperIr._0).toContain(`define ptr @${symbol}()`);
  });

  it("keeps recursive self identity exact without any short runtime alias", () => {
    const source = (name: "demo:spin" | "demo:nest", body: unknown): CompileSource => ({
      name,
      params: [],
      body,
      ctorDefs: {},
      callBindings: recursiveBindings,
    });
    const spinBody = { call: ["spin"] };
    const nestBody = { value: { call: ["nest"] } };

    const jsSpin = compileFenelToJsNative(source("demo:spin", spinBody));
    expect(jsSpin).toMatchObject({ $tag: "Ok", _0: { entry: { $tag: "JsLoopFn" } } });
    const jsNest = compileFenelToJsNative(source("demo:nest", nestBody));
    expect(jsNest).toMatchObject({
      $tag: "Ok",
      _0: { entry: { $tag: "JsArrow" } },
    });
    if (jsNest.$tag !== "Ok") return;
    const jsNestText = dispatchedSerializeJsModule(jsNest._0);
    expect(jsNestText).toMatchObject({ $tag: "Ok" });
    if (jsNestText.$tag !== "Ok") return;
    expect(jsNestText._0).toContain('$fenel["demo:nest"]()');
    expect(jsNestText._0).not.toContain("$fenel.nest");

    const wasmNest = compileFenelToWasmNative(source("demo:nest", nestBody));
    expect(wasmNest).toMatchObject({ $tag: "Ok" });
    if (wasmNest.$tag !== "Ok") return;
    expect(wasmNest._0.imports).toContainEqual(expect.objectContaining({
      module: "$fenel",
      name: "demo:nest",
    }));
    expect(wasmNest._0.imports).not.toContainEqual(expect.objectContaining({ name: "nest" }));

    const llvmNest = compileFenelToLlvmNative(source("demo:nest", nestBody));
    expect(llvmNest).toMatchObject({ $tag: "Ok" });
    if (llvmNest.$tag !== "Ok") return;
    const symbol = "fenel_fn_64656D6F3A6E657374";
    expect(llvmNest._0.definitions.at(-1)?.name).toBe(symbol);
    expect(llvmNest._0.declarations).not.toContainEqual(expect.objectContaining({ name: symbol }));
    const llvmNestText = serializeLlvmModuleNative(llvmNest._0);
    expect(llvmNestText).toMatchObject({ $tag: "Ok" });
    if (llvmNestText.$tag !== "Ok") return;
    expect(llvmNestText._0).toContain(`call ptr @${symbol}()`);
  });

  it("rejects malformed host call-binding metadata before Fenel dispatch", () => {
    const result = compileSourceFromUnknown({
      ...callerSource(),
      callBindings: { helper: 42 },
    });
    expect(result).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported" },
    });
    expect(compileSourceFromUnknown({
      ...callerSource(),
      callBindings: { helper: "helper" },
    })).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported" },
    });
  });

  it("carries constructor conflicts as capability metadata and rejects only a used ambiguity", () => {
    const key = (id: string) => ({ $tag: "NamedField" as const, ref: { $ref: id } });
    const field = (name: string, id: string) => ({
      name,
      key: key(id),
      label: { $tag: "Nothing" as const },
      type: { $ref: "Number" } as const,
      meta: {},
      ui: { $tag: "Nothing" as const },
    });
    const noLabel = { $tag: "Nothing" as const };
    const entities = [
        {
          id: "LeftOwner",
          module: "left",
          type: { $variant: { cases: [
            { name: "Clash", label: noLabel, fields: [field("left", "11111111-1111-4111-8111-111111111111")] },
            { name: "Zero", label: noLabel, fields: [] },
          ] } },
        },
        {
          id: "RightOwner",
          module: "right",
          type: { $variant: { cases: [
            { name: "Clash", label: noLabel, fields: [field("right", "22222222-2222-4222-8222-222222222222")] },
            { name: "Zero", label: noLabel, fields: [] },
          ] } },
        },
      ];
    let registryScans = 0;
    const registry = {
      listIdentifiedEntities: () => {
        registryScans += 1;
        return entities;
      },
    };
    const ctorDefs = compileConstructorSlotTable(registry);
    expect(ctorDefs["Clash"]).toBeUndefined();
    expect(ctorDefs["Zero"]).toBeUndefined();
    expect(compileConstructorSlotConflicts(ctorDefs)).toEqual(["Clash", "Zero"]);

    const preferred = compileConstructorSlotTable(registry, {
      preferredOwnerIds: ["LeftOwner"],
    });
    expect(preferred["Clash"]?.map((slot) => slot.wireName)).toEqual(["left"]);
    expect(preferred["Zero"]).toEqual([]);
    expect(compileConstructorSlotConflicts(preferred)).toEqual([]);
    // Canonical-equivalent projections share one plan/table, but an arbitrary
    // public registry is re-enumerated on every request so replacing its entity
    // roster cannot leave that plan stale. The frozen repository metadata view
    // retains the identity-only fast path.
    expect(compileConstructorSlotTable(registry, {
      preferredOwnerIds: ["LeftOwner", "LeftOwner"],
    })).toBe(preferred);
    expect(compileConstructorSlotTable(registry)).toBe(ctorDefs);
    expect(registryScans).toBe(4);

    expect(dispatchedNormaliseToCore({
      name: "unrelated",
      params: [],
      body: 1,
      ctorDefs,
    }).$tag).toBe("Ok");
    expect(dispatchedNormaliseToCore({
      name: "ambiguous",
      params: [],
      body: { construct: ["Clash", { left: 1 }] },
      ctorDefs,
    })).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported", reason: "constructor name has ambiguous metadata" },
    });
    expect(dispatchedNormaliseToCore({
      name: "ambiguousZero",
      params: [],
      body: { construct: ["Zero"] },
      ctorDefs,
    })).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported", reason: "constructor name has ambiguous metadata" },
    });
    expect(dispatchedNormaliseToCore({
      name: "ambiguousTaggedValue",
      params: [],
      body: { $tag: "Clash", left: 1 },
      ctorDefs,
    })).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported", reason: "constructor name has ambiguous metadata" },
    });
    expect(dispatchedNormaliseToCore({
      name: "ambiguousTaggedPattern",
      params: [],
      body: {
        match: [
          1,
          { $tag: "Clash", left: { var: "x" } },
          { var: "x" },
        ],
      },
      ctorDefs,
    })).toMatchObject({
      $tag: "Err",
      _0: { $tag: "Unsupported", reason: "constructor name has ambiguous metadata" },
    });
  });
});

// A compiler refuses what it cannot compile correctly. A call head that is not
// a function the compiler resolves and not a local binder in scope used to
// lower to a direct JS variable call (`std.add(1, 2)`, a free name) or to a
// runtime key no `$fenel` provides (`$fenel["std.nothere"]`).
describe("compilers refuse call heads they cannot resolve", () => {
  const source = (body: unknown, params: string[] = []): CompileSource => ({
    name: "demo:probe",
    params: positionalCompileFieldSlots(params),
    body,
    ctorDefs: {},
    callBindings,
  });
  const unresolvable: Array<[string, unknown]> = [
    ["a dotted var head whose root is not in scope", { call: [{ var: "std.add" }, 1, 2] }],
    ["a dotted string head the compiler cannot resolve", { call: ["std.nothere", 1] }],
    ["a var head that names no binder in scope", { call: [{ var: "g" }, 1] }],
    // A function VALUE is a reference too: `std.add $ 1` lowered to
    // `$fenel.$(std.add, 1)`, a free JS variable.
    ["a dotted function value passed to `$`", { call: ["$", { var: "std.add" }, 1] }],
    [
      "a let-bound dotted function reference",
      { do: [{ let: { g: { var: "std.add" } } }, { call: [{ var: "g" }, 1, 2] }] },
    ],
    // Function names are lowercase; an uppercase free name is no function
    // value any runtime namespace provides.
    ["an uppercase free name passed as a value", { call: [{ var: "g" }, { var: "Nothere" }] }],
    ["a qualified function value", { call: [{ var: "g" }, { var: "demo:helper" }] }],
    // `_` names nothing: the synthetic do-block lambda parameter is discarded
    // when sequencing is reconstituted, so `_ 1` would call a free `_`.
    ["a call of `_` after a do-block statement", { do: [0, { call: [{ var: "_" }, 1] }] }],
    ["a reference to `_` after a do-block statement", { do: [0, { var: "_" }] }],
    // The parser reads the text `_ 1` as a string head `_`: no runtime entry.
    ["a `_` call head", { do: [0, { call: ["_", 1] }] }],
  ];

  for (const [label, body] of unresolvable) {
    it(`JS, Wasm and LLVM refuse ${label}`, () => {
      for (const compile of [compileFenelToJsNative, compileFenelToWasmNative, compileFenelToLlvmNative]) {
        expect({ target: compile.name, result: compile(source(body)) }).toMatchObject({
          target: compile.name,
          result: { $tag: "Err", _0: { $tag: "Unsupported" } },
        });
      }
    });
  }

  it("names the refused head in the reason", () => {
    const refused = compileFenelToJsNative(source({ call: [{ var: "std.add" }, 1, 2] }));
    expect(refused.$tag).toBe("Err");
    if (refused.$tag !== "Err") return;
    expect(JSON.stringify(refused._0)).toContain("std.add");
  });

  it("names the refused function value in the reason", () => {
    const refused = compileFenelToJsNative(source({ call: ["$", { var: "std.add" }, 1] }));
    expect(refused.$tag).toBe("Err");
    if (refused.$tag !== "Err") return;
    expect(JSON.stringify(refused._0)).toContain("std.add");
  });

  it("a call through a local parameter, a member of one, or a lambda parameter still compiles and runs", () => {
    const run = (body: unknown, params: string[], args: unknown[]): unknown => {
      const compiled = compileFenelToJsNative(source(body, params));
      expect(compiled.$tag).toBe("Ok");
      if (compiled.$tag !== "Ok") return undefined;
      const serialized = dispatchedSerializeJsModule(compiled._0);
      expect(serialized.$tag).toBe("Ok");
      if (serialized.$tag !== "Ok") return undefined;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function("$fenel", `return ${serialized._0};`)({}) as (...a: unknown[]) => unknown;
      return fn(...args);
    };
    expect(run({ call: [{ var: "f" }, { var: "x" }] }, ["f", "x"], [(n: number) => n + 1, 41])).toBe(42);
    expect(run({ call: [{ var: "r.f" }, 2] }, ["r"], [{ f: (n: number) => n * 21 }])).toBe(42);
    const lambda = run({ fn: ["g", { call: [{ var: "g" }, 6] }] }, [], []) as (g: unknown) => unknown;
    expect(lambda((n: number) => n * 7)).toBe(42);
  });

  it("local function values (let-bound, parameter, lambda parameter, pattern binder) still compile and run", () => {
    const run = (body: unknown, params: string[], args: unknown[]): unknown => {
      const compiled = compileFenelToJsNative(source(body, params));
      expect({ body, tag: compiled.$tag }).toEqual({ body, tag: "Ok" });
      if (compiled.$tag !== "Ok") return undefined;
      const serialized = dispatchedSerializeJsModule(compiled._0);
      expect(serialized.$tag).toBe("Ok");
      if (serialized.$tag !== "Ok") return undefined;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      // The pattern match tests field presence through the runtime.
      const runtime = { hasOwn: (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) };
      const fn = new Function("$fenel", `return ${serialized._0};`)(runtime) as (...a: unknown[]) => unknown;
      return fn(...args);
    };
    const apply41 = (h: (n: number) => number): number => h(41);
    // A let-bound lambda passed as a value.
    expect(run(
      { do: [{ let: { f: { fn: ["x", { call: ["add", { var: "x" }, 1] }] } } }, { call: [{ var: "g" }, { var: "f" }] }] },
      ["g"],
      [apply41],
    )).toBe(42);
    // A parameter passed as a value.
    expect(run({ call: [{ var: "g" }, { var: "h" }] }, ["g", "h"], [apply41, (n: number) => n + 1])).toBe(42);
    // A lambda parameter passed as a value.
    const viaLambda = run({ fn: ["h", { call: [{ var: "g" }, { var: "h" }] }] }, ["g"], [apply41]) as (h: unknown) => unknown;
    expect(viaLambda((n: number) => n + 1)).toBe(42);
    // A pattern binder passed as a value.
    expect(run(
      { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "h" } }, { call: [{ var: "g" }, { var: "h" }] }, { $tag: "Nothing" }, 0] },
      ["g", "m"],
      [apply41, { $tag: "Just", _0: (n: number) => n + 1 }],
    )).toBe(42);
  });

  // A function passed as a VALUE lowers to the same runtime reference a call
  // head lowers to: `$fenel["demo:helper"]` for a function the module binding
  // index resolves, `$fenel.isString` for a bare runtime function such as a
  // native. It used to stay a free JS variable (`((g) => g(helper))`), which
  // only the compiled parser's `with` namespace could bind.
  const runJs = (
    body: unknown,
    params: string[],
    runtime: Record<string, unknown>,
    args: unknown[],
  ): { emitted: string; result: unknown } => {
    const compiled = compileFenelToJsNative(source(body, params));
    expect({ body, tag: compiled.$tag }).toEqual({ body, tag: "Ok" });
    if (compiled.$tag !== "Ok") return { emitted: "", result: undefined };
    const serialized = dispatchedSerializeJsModule(compiled._0);
    expect(serialized.$tag).toBe("Ok");
    if (serialized.$tag !== "Ok") return { emitted: "", result: undefined };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("$fenel", `return ${serialized._0};`)(runtime) as (...a: unknown[]) => unknown;
    return { emitted: serialized._0, result: fn(...args) };
  };
  const callIt = (h: () => unknown): unknown => h();

  it("a function value the module binding index resolves runs through its canonical runtime key", () => {
    const run = runJs(
      { call: [{ var: "g" }, { var: "helper" }] },
      ["g"],
      { "demo:helper": () => 42 },
      [callIt],
    );
    expect(run.emitted).toBe("((g) => g($fenel[\"demo:helper\"]))");
    expect(run.result).toBe(42);
    // Inside a lambda too: a global is no closure capture.
    const viaLambda = runJs(
      { fn: ["g", { call: [{ var: "g" }, { var: "helper" }] }] },
      [],
      { "demo:helper": () => 42 },
      [],
    ).result as (g: unknown) => unknown;
    expect(viaLambda(callIt)).toBe(42);
  });

  it("a local binder named like a module function shadows it", () => {
    const runtime = { "demo:helper": () => -1, hasOwn: (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) };
    const local = (): number => 7;
    // A parameter.
    expect(runJs({ call: [{ var: "g" }, { var: "helper" }] }, ["g", "helper"], runtime, [callIt, local]).result).toBe(7);
    // A lambda parameter.
    const viaLambda = runJs(
      { fn: ["helper", { call: [{ var: "g" }, { var: "helper" }] }] },
      ["g"],
      runtime,
      [callIt],
    ).result as (h: unknown) => unknown;
    expect(viaLambda(local)).toBe(7);
    // A let binding.
    expect(runJs(
      { do: [{ let: { helper: { fn: ["u", 7] } } }, { call: [{ var: "g" }, { var: "helper" }] }] },
      ["g"],
      runtime,
      [(h: (u: unknown) => unknown) => h(0)],
    ).result).toBe(7);
    // A pattern binder.
    expect(runJs(
      { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "helper" } }, { call: [{ var: "g" }, { var: "helper" }] }, { $tag: "Nothing" }, 0] },
      ["g", "m"],
      runtime,
      [callIt, { $tag: "Just", _0: local }],
    ).result).toBe(7);
  });

  it("`null` stays the null literal, never a runtime reference", () => {
    // `Nothing -> null` (form-runtime's formValueAt) must not become
    // `$fenel.null`, which reads undefined.
    const run = runJs(
      { match: [{ var: "m" }, { $tag: "Just", _0: { $bind: "v" } }, { var: "v" }, { $tag: "Nothing" }, { var: "null" }] },
      ["m"],
      { hasOwn: (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) },
      [{ $tag: "Nothing" }],
    );
    expect(run.emitted).not.toContain("$fenel.null");
    expect(run.result).toBeNull();
    expect(runJs({ call: [{ var: "g" }, { var: "null" }] }, ["g"], {}, [(x: unknown) => x === null]).result).toBe(true);
  });

  it("a native function value runs through the runtime namespace (map isString xs)", () => {
    const body = { call: ["map", { var: "isString" }, { var: "xs" }] };
    const natives = {
      map: (f: (x: unknown) => unknown, xs: unknown[]) => xs.map((x) => f(x)),
      isString: (x: unknown) => typeof x === "string",
    };
    const run = runJs(body, ["xs"], natives, [["a", 1]]);
    expect(run.emitted).toBe("((xs) => $fenel.map($fenel.isString, xs))");
    expect(run.result).toEqual([true, false]);
    // The compiled parser and resolver artifacts evaluate under `with($ns)`
    // where `$fenel` is the namespace itself; the reference resolves there too.
    const ns: Record<string, unknown> = { ...natives };
    ns["$fenel"] = ns;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const viaWith = new Function("$ns", `with($ns){ return (${run.emitted}); }`)(ns) as (xs: unknown[]) => unknown;
    expect(viaWith(["a", 1])).toEqual([true, false]);
  });

  it("Wasm and LLVM refuse a global function value instead of emitting a free reference", () => {
    for (const body of [
      { call: [{ var: "g" }, { var: "helper" }] },
      { call: ["map", { var: "isString" }, { var: "xs" }] },
    ]) {
      for (const compile of [compileFenelToWasmNative, compileFenelToLlvmNative]) {
        expect({ target: compile.name, result: compile(source(body, ["g", "xs"])) }).toMatchObject({
          target: compile.name,
          result: { $tag: "Err", _0: { $tag: "Unsupported" } },
        });
      }
    }
  });
});
