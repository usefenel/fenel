import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDispatchRegistry, GLOBAL_ONLY, type DispatchRegistry } from "./dispatch-registry";
import { resolveEffect } from "./effect-dispatch";
import { deriveResolveSchema, dispatchedRepresentationsForTarget, dispatchedTraversalSemanticSlotsError, withInterpretedResolver } from "./engine-bodies-dispatch";
import { mintTestAuthorityForAccount, testDescriptorEnvelope } from "./authority-test-support";
import { createEngineBootstrapRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { Nothing } from "./type-foundation";
import { identifiedDefinitionView, normalizeFieldDeclarations, type FieldDeclarationRootInput } from "./field-identity";
import { repositoryIdentityLock, repositoryTypeIdentity } from "./repository-identity-manifest";
import { pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { loadFenelModule } from "./fenel-module";
import { defineFunction } from "./function-builder";
import type { FenelFunction, FenelModule, FenelType, Instance } from "./types";

const callableId = "88e5d5f4-6c81-452f-96e3-b66d5acb710a";
const arrow: Extract<FenelType, { $arrow: unknown }> = {
  $arrow: {
    params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} }],
    returns: { $ref: "Number" },
  },
};
const callable: FenelFunction = {
  id: callableId,
  params: arrow.$arrow.params,
  returns: arrow.$arrow.returns,
};
let registry: ModuleRegistry;
let base: EvaluateContext;
let accountEnvelope: unknown;
const checkedEntities = new Map<string, FenelType>();
let checkedApply: FenelFunction;

beforeAll(() => {
  // C2: a finite source-only test region; owner regeneration runs after the
  // last production byte, so these focused pins do not serve stale artifacts.
  // Display projection needs registered declarations, not a contract verdict.
  // This private C2 fixture never escapes into a product reader.
  registry = withInterpretedResolver(() => createEngineBootstrapRegistry([
    stdModule, engineModule, { name: "callableIconProbe", label: { en: "Callable icon probe" }, functions: [callable] },
  ], { dispatchRegistry, functionIdentityLock: repositoryIdentityLock() }));
  base = registry.evaluateContext();
  // Exercise real source declarations through the canonical identity kernel,
  // without pretending the deliberately incomplete bootstrap is a reader.
  const roots: FieldDeclarationRootInput[] = ["Color", "Image"].map(name => {
    const entity = stdModule.entities?.find(entity => entity.id === name);
    if (entity === undefined) throw new Error(`missing std declaration ${name}`);
    return { kind: "type", realm: "repository-source", entity: { ...entity, module: "std" } };
  });
  const list = systemEntities.find(entity => entity.id === "List");
  if (list?.type === undefined) throw new Error("missing List declaration owner");
  roots.push({ kind: "type", realm: "repository-source", entity: { ...list, type: list.type, module: "system" } });
  const apply = registry.getFunction("std.$");
  if (apply === undefined) throw new Error("missing std.$ declaration");
  roots.push({ kind: "function", realm: "repository-source", module: "std", fn: apply });
  const collection = withInterpretedResolver(() => normalizeFieldDeclarations(roots, { mode: "strict-embedded", lock: repositoryIdentityLock() }));
  roots.forEach((root, index) => {
    if (root.kind !== "type" || index >= 2) return;
    const identified = identifiedDefinitionView(root.entity.type, collection.viewPlans[index]!);
    checkedEntities.set(root.entity.id, identified);
    const identity = repositoryTypeIdentity("std", root.entity.id);
    if (identity === undefined) throw new Error(`missing std type identity ${root.entity.id}`);
    checkedEntities.set(identity, identified);
  });
  checkedApply = identifiedDefinitionView(apply, collection.viewPlans[roots.length - 1]!);
  accountEnvelope = withInterpretedResolver(() => testDescriptorEnvelope([
    "dispatch:listAllInstances", "dispatch:lookupOne",
  ], registry));
});

function pool() {
  const result = createDispatchRegistry();
  for (const type of dispatchRegistry.listClasses()) result.defineClass(type);
  for (const row of dispatchRegistry.listInstances()) result.addInstance(row);
  return result;
}

function frame(instances: ReturnType<typeof pool>, account?: string, expose = true): EvaluateContext {
  return {
    ...base,
    _specRegistry: instances,
    ...(account ? { _authority: withInterpretedResolver(() => mintTestAuthorityForAccount(account, accountEnvelope, registry)) } : {}),
    getFunction: name => name === callableId ? (expose ? callable : undefined) : base.getFunction?.(name),
    getEntityType: name => checkedEntities.get(name) ?? base.getEntityType?.(name),
  };
}

function select(context: EvaluateContext | undefined, instances: ReturnType<typeof pool>, target: unknown) {
  return withInterpretedResolver(() => resolveEffect(context, instances, "Iconable", target));
}

describe("scoped callable Iconable through the canonical structural matcher", () => {
  test("the internal pattern handle resolves its qualified spelling to the exact registered predicate", () => {
    const predicate = base.getFunction?.("engine.isArrowType");
    expect(predicate).toBeDefined();
    expect(base.getFunction?.(predicate!.id)?.id).toBe(predicate!.id);
  });

  test("constructor schema reads retain Vec and Maybe without entering presentation programs", () => {
    for (const name of ["Vec", "Maybe"]) {
      const registered = systemEntities.find(entity => entity.id === name && entity.params?.length);
      expect(registered?.type).toBeDefined();
      expect(deriveResolveSchema(name)).toBe(registered!.type);
    }
    expect(deriveResolveSchema("unknown-callable-schema")).toBeUndefined();
  });

  test("the authored boot rule supplies a neutral function icon for a checked anonymous arrow", () => {
    const instances = pool();
    const result = select(frame(instances), instances, arrow);
    expect(result?.methods.icon).toBe("function");
    expect(result?.source.kind).toBe("instance");
    if (result?.source.kind !== "instance") throw new Error("expected the structural instance");
    expect(result.source.instance.args as unknown).toEqual([{ $pattern: "engine.isArrowType" }]);
  });

  test("raw input and output arrows share the representation, including nullary arrows", () => {
    const instances = pool();
    const context = frame(instances);
    const higherOrder: Extract<FenelType, { $arrow: unknown }> = {
      $arrow: {
        params: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, type: arrow, label: Nothing, ui: Nothing, meta: {} }],
        returns: arrow,
      },
    };
    expect(select(context, instances, higherOrder)?.methods.icon).toBe("function");
    expect(select(context, instances, higherOrder.$arrow.params[0]!.type)?.methods.icon).toBe("function");
    expect(select(context, instances, higherOrder.$arrow.returns)?.methods.icon).toBe("function");
    expect(select(context, instances, { $arrow: { params: [], returns: { $unit: true } } })?.methods.icon).toBe("function");
  });

  test("unnamed positional arrow presentation remains callable while invalid named identities refuse", () => {
    const instances = pool();
    const context = frame(instances);
    const anonymous: FenelType = { $arrow: { params: [{ ...arrow.$arrow.params[0]!, name: "" }], returns: { $unit: true } } };
    expect(select(context, instances, anonymous)?.methods.icon).toBe("function");
    const invalidField = { ...arrow.$arrow.params[0]!, name: "invalid", key: { $tag: "NamedField" as const, ref: { $ref: "" } } };
    expect(select(context, instances, { $arrow: { params: [invalidField], returns: { $unit: true } } })).toBeUndefined();
    expect(select(context, instances, { $record: { fields: [invalidField] } })).toBeUndefined();
  });

  test("Color and Image reuse the captured identified fields, including reference transport", () => {
    const instances = pool();
    const context = frame(instances);
    for (const name of ["Color", "Image"]) {
      const identified = checkedEntities.get(name);
      expect(identified).toBeDefined();
      expect(deriveResolveSchema(name, context)).toEqual(identified);
      expect(withInterpretedResolver(() => dispatchedTraversalSemanticSlotsError(identified))).toEqual({ $tag: "Nothing" });
      expect(() => select(context, instances, name)).not.toThrow();
      expect(select(context, instances, { $ref: name })?.methods.icon).toBe(select(context, instances, name)?.methods.icon);
      const identity = repositoryTypeIdentity("std", name)!;
      expect(() => select(context, instances, identity)).not.toThrow();
      expect(select(context, instances, { $ref: identity })?.methods.icon).toBe(select(context, instances, name)?.methods.icon);
    }
    const color = checkedEntities.get("Color");
    if (color === undefined || !("$record" in color)) throw new Error("expected checked Color record");
    const variant: FenelType = { $variant: { cases: [{ name: "Checked", label: Nothing, fields: [color.$record.fields[0]!] }] } };
    expect(() => select(context, instances, variant)).not.toThrow();
    expect(select(context, instances, variant)).toBeUndefined();
  });

  test("the real std.$ declaration and its checked function input retain arrow Iconable", () => {
    const instances = pool();
    const context = frame(instances);
    const captured = { ...context, getFunction: (name: string) => name === checkedApply.id ? checkedApply : context.getFunction?.(name) };
    expect(select(captured, instances, checkedApply.id)?.methods.icon).toBe("function");
    const input = checkedApply.params[0]!.type;
    expect("$arrow" in input).toBe(true);
    expect(select(captured, instances, input)?.methods.icon).toBe("function");
  });

  test("captured type declarations and authoritative misses never share a nominal result cache", () => {
    const instances = pool();
    const context = frame(instances);
    const target = "captured-structural-type";
    const arrowFrame = { ...context, getEntityType: (name: string) => name === target ? arrow : undefined };
    const unitFrame = { ...context, getEntityType: (name: string) => name === target ? { $unit: true } as FenelType : undefined };
    expect(select(arrowFrame, instances, target)?.methods.icon).toBe("function");
    expect(select(unitFrame, instances, target)).toBeUndefined();
    expect(select({ ...context, getEntityType: () => undefined }, instances, target)).toBeUndefined();
    expect(select(arrowFrame, instances, { $ref: target })?.methods.icon).toBe("function");
    expect(withInterpretedResolver(() => dispatchedRepresentationsForTarget(target, arrowFrame)).get("Iconable")?.methods.icon).toBe("function");
    expect(withInterpretedResolver(() => dispatchedRepresentationsForTarget(target, unitFrame)).has("Iconable")).toBe(false);
  });

  test("a reader without engine definitions executes private scoped predicates and binds their selected methods", () => {
    const instances = pool();
    const context = frame(instances, "icon-reader-A");
    const predicate: FenelFunction = { id: "88e5d5f4-6c81-452f-96e3-b66d5acb710b", params: arrow.$arrow.params, returns: { $ref: "Bool" }, body: true };
    const privateRow = { typeName: "Iconable", args: [{ $pattern: predicate.id } as never], methods: { icon: "raw-private" }, priority: 100,
      scope: { kind: "account" as const, accountId: "icon-reader-A" } };
    instances.addInstance(privateRow);
    const bind: NonNullable<EvaluateContext["_dispatchInstanceMethods"]> = row =>
      row.methods.icon === privateRow.methods.icon ? { icon: "bound-private" } : undefined;
    const captured = { ...context, getFunction: (name: string) => name === predicate.id ? predicate : undefined,
      _dispatchInstanceMethods: bind };
    expect(select(captured, instances, arrow)?.methods.icon).toBe("bound-private");
    expect(select({ ...captured, _authority: frame(instances, "icon-reader-B")._authority }, instances, arrow)?.methods.icon).toBe("function");
    expect(select({ ...context, getFunction: () => undefined }, instances, arrow)?.methods.icon).toBe("function");
    expect(select({ ...context, getFunction: () => undefined }, instances, callableId)).toBeUndefined();
  });

  test("private qualified and imported predicate callbacks retain their captured bundle lookup", () => {
    const instances = pool();
    const context = frame(instances, "icon-reader-A");
    const callback: FenelFunction = { id: "88e5d5f4-6c81-452f-96e3-b66d5acb710c", params: arrow.$arrow.params, returns: { $ref: "Bool" }, body: true };
    for (const path of ["privateBundle.accepts", "P.accepts"]) {
      const predicate: FenelFunction = { id: "88e5d5f4-6c81-452f-96e3-b66d5acb710d", params: arrow.$arrow.params,
        returns: { $ref: "Bool" }, body: { apply: [{ var: path }, [{ var: "_0" }]] } };
      const row = { typeName: "Iconable", args: [{ $pattern: predicate.id } as never], methods: { icon: "qualified-private" }, priority: 100,
        scope: { kind: "account" as const, accountId: "icon-reader-A" } };
      instances.addInstance(row);
      const captured: EvaluateContext = { ...context,
        getFunction: name => name === predicate.id ? predicate : name === callback.id ? callback : undefined,
        getFunctionImportFrame: name => name === predicate.id ? { names: {}, aliases: { P: "privateBundle" } } : undefined,
        _moduleNames: new Set(["privateBundle"]),
        _moduleMember: (bundle, member) => bundle === "privateBundle" && member === "accepts"
          ? { kind: "function", id: callback.id } : { kind: "missing" },
      };
      expect(select(captured, instances, arrow)?.methods.icon).toBe("qualified-private");
      expect(select({ ...captured, _moduleMember: () => ({ kind: "missing" }) }, instances, arrow)?.methods.icon).toBe("function");
      expect(select({ ...captured, _authority: frame(instances, "icon-reader-B")._authority }, instances, arrow)?.methods.icon).toBe("function");
    }
  });

  test("pure frames retain captured checked type facts and authoritative misses", () => {
    const instances = pool();
    const context = frame(instances);
    const target = "pure-captured-structural-type";
    const captured = { ...context, getEntityType: (name: string) => name === target ? arrow : undefined };
    expect(select(pureEvaluateContext(captured), instances, target)?.methods.icon).toBe("function");
    expect(select(pureEvaluateContext({ ...captured, getEntityType: () => undefined }), instances, target)).toBeUndefined();
    const carrier = { getFunction: () => undefined, getEntityType: () => undefined };
    expect(pureEvaluateContext({ ...captured, _dispatchTypeFunctions: carrier })._dispatchTypeFunctions).toBe(carrier);
    expect(select(pureEvaluateContext({ ...captured, _dispatchTypeFunctions: carrier }), instances, target)).toBeUndefined();
  });

  test("a private structural predicate observes the original right-associated arrow layers", () => {
    const instances = pool();
    const context = frame(instances, "icon-reader-A");
    const predicate: FenelFunction = { id: "88e5d5f4-6c81-452f-96e3-b66d5acb710e",
      params: [{ ...arrow.$arrow.params[0]!, name: "t", type: { $ref: "TraversalType" } }], returns: { $ref: "Bool" },
      body: { and: [
        { call: ["eq", { call: ["length", { var: "t.params" }] }, 1] },
        { call: ["eq", { var: "t.returns.$tag" }, "TtArrow"] },
        { call: ["eq", { call: ["length", { var: "t.returns.params" }] }, 1] },
      ] },
    };
    instances.addInstance({ typeName: "Iconable", args: [{ $pattern: predicate.id } as never], methods: { icon: "nested-private" }, priority: 100,
      scope: { kind: "account", accountId: "icon-reader-A" } });
    const captured = { ...context, getFunction: (name: string) => name === predicate.id ? predicate : context.getFunction?.(name) };
    const nested: FenelType = { $arrow: { params: arrow.$arrow.params, returns: arrow } };
    expect(select(captured, instances, nested)?.methods.icon).toBe("nested-private");
    expect(select(captured, instances, arrow)?.methods.icon).toBe("function");
  });

  test("a caller declaration uses only its own paired signature posture in helper execution", () => {
    // C2: execute the actual context adapter with finite host stubs. The real
    // bootstrap deliberately has no trust certificates, so a synthetic helper
    // sidecar is needed to expose the ownership error without mutating it.
    const source = readFileSync(new URL("./engine-bodies-dispatch.ts", import.meta.url), "utf8");
    const start = source.indexOf("export function dispatchEngineBody(");
    const end = source.indexOf("\n/** floor-kernel Phase 4", start);
    if (start < 0 || end < 0) throw new Error("missing engine context adapter source");
    const program = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end).replace("export function", "function"));
    const helperCertificate = { trust: { $tag: "TrustedPrimitive" }, scheme: { quantified: [] } };
    const helperContext: EvaluateContext = { getFunction: () => callable, getFunctionSignatureInfo: () => helperCertificate };
    const invoke = new Function("getHarness", "withCompiledArtifactEvaluationSnapshot", "parserInterpretedForced", "evaluate",
      `${program}\nreturn dispatchEngineBody;`)(
      () => ({ ctx: helperContext, reg: { getFunction: () => ({ params: [], body: true }) } }),
      (_registry: unknown, run: () => unknown) => run(), () => true,
      (_body: unknown, _data: unknown, context: EvaluateContext) => context,
    ) as (_id: string, _args: unknown[], caller: EvaluateContext) => EvaluateContext;
    const caller: EvaluateContext = { getFunction: () => callable, getFunctionSignatureInfo: () => undefined };
    expect(invoke("context-probe", [], caller).getFunctionSignatureInfo?.(callableId)).toBeUndefined();
    const callerCertificate = { trust: { $tag: "Advisory" }, scheme: { quantified: [] } };
    expect(invoke("context-probe", [], { ...caller, getFunctionSignatureInfo: () => callerCertificate }).getFunctionSignatureInfo?.(callableId)).toBe(callerCertificate);
    expect(invoke("context-probe", [], { ...caller, getFunction: () => undefined }).getFunctionSignatureInfo?.(callableId)).toBe(helperCertificate);
  });

  test("an exact callable UUID and a typed callable reference use only the captured declaration", () => {
    const instances = pool();
    const context = frame(instances);
    expect(select(context, instances, callableId)?.methods.icon).toBe("function");
    expect(select(context, instances, { $ref: callableId })?.methods.icon).toBe("function");
    expect(select(frame(instances, undefined, false), instances, callableId)).toBeUndefined();
  });

  test("a real registered UUID supplies its canonical declaration without a source-name fallback", () => {
    const instances = pool();
    const uuid = callableId;
    expect(registry.getFunction(uuid)?.id).toBe(uuid);
    expect(base.getFunction?.(uuid)?.id).toBe(uuid);
    expect(select({ ...base, _specRegistry: instances }, instances, uuid)?.methods.icon).toBe("function");
    expect(select({ ...base, _specRegistry: instances, getFunction: undefined }, instances, uuid)).toBeUndefined();
  });

  test("the actual std source defaults resolve by legacy identity and UUID without changing the source rows", () => {
    const instances = base._specRegistry!;
    for (const [name, icon] of [["join", "link"], ["words", "list"], ["reverse", "repeat"]] as const) {
      const legacy = `std:${name}`;
      const uuid = registry.getUuid(legacy);
      if (uuid === undefined) throw new Error(`missing std.${name} function identity`);
      expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(registry.getFunction(uuid!)?.id).toBe(legacy);
      const source = stdModule.instances!.find(row => row.typeName === "Iconable" && row.args[0] === `std.${name}`);
      expect(source?.methods.icon).toBe(icon);
      expect(source?.sourceArgumentReferences).toEqual([`std.${name}`]);
      for (const target of [legacy, uuid!, { $ref: uuid! }]) {
        const selected = select(base, instances, target);
        expect(selected?.methods.icon).toBe(icon);
        expect(selected?.source.kind).toBe("instance");
        if (selected?.source.kind !== "instance") throw new Error(`missing std.${name} source instance`);
        expect(selected.source.instance.args).toEqual([uuid]);
      }
      expect(instances.resolve(uuid!, "Labelable", GLOBAL_ONLY)?.label).toBeDefined();
      expect(source?.args).toEqual([`std.${name}`]);
    }
  });

  test("the eighteen actual representation instances retain their complete nominal type tuples", () => {
    const expected = ["JsRuntime", "Jsonb"].flatMap(target =>
      ["Boolean", "Nat", "Int", "Rational", "Real", "Number", "List", "String", "Char"].map(type => [target, type]));
    const sourceRows = dispatchRegistry.listInstances("Reprable");
    const projected = base._specRegistry!.listInstances("Reprable");
    expect(sourceRows.map(row => row.args)).toEqual(expected);
    expect(projected.map(row => row.args)).toEqual(expected);
    expect(projected.every(row => row.args.every(argument => typeof argument === "string"))).toBe(true);
    for (const target of ["JsRuntime", "Jsonb"]) {
      const row = sourceRows.find(row => row.args[0] === target && row.args[1] === "Boolean");
      expect(row?.sourceArgumentReferences?.[0]).toBe(target);
      expect(projected.find(row => row.args[0] === target && row.args[1] === "Boolean")?.args).toEqual([target, "Boolean"]);
    }
  });

  test("value-specific and innermost frame overrides precede the structural type icon", () => {
    const instances = pool();
    instances.addInstance({ typeName: "Iconable", args: [callableId], methods: { icon: "star" }, priority: 10 });
    const context = frame(instances);
    expect(select(context, instances, callableId)?.methods.icon).toBe("star");
    expect(select(context, instances, { $ref: callableId })?.methods.icon).toBe("star");
    expect(select({ ...context, _dictStack: [
      { typeName: "Iconable", args: [callableId], methods: { icon: "circle" } },
      { typeName: "Iconable", args: [callableId], methods: { icon: "heart" } },
    ] }, instances, { $tag: "ByType", target: callableId })?.methods.icon).toBe("heart");
  });

  test("account and tag overrides compete only inside the reader's visible pool", () => {
    const instances = pool();
    instances.addInstance({ typeName: "Iconable", args: [callableId], methods: { icon: "star" }, priority: 10,
      scope: { kind: "account", accountId: "icon-reader-A" } });
    instances.addInstance({ typeName: "Iconable", args: [callableId], methods: { icon: "heart" }, priority: 20,
      scope: { kind: "tag", tag: "icon-reader-tag" } });
    expect(select(frame(instances, "icon-reader-A"), instances, callableId)?.methods.icon).toBe("star");
    expect(select(frame(instances, "icon-reader-B"), instances, callableId)?.methods.icon).toBe("function");
    expect(select({ ...frame(instances, "icon-reader-A"), _activeTags: ["icon-reader-tag"] }, instances, callableId)?.methods.icon).toBe("heart");
  });

  test("structural account overrides respect visibility for anonymous and callable witnesses", () => {
    const instances = pool();
    instances.addInstance({ typeName: "Iconable", args: [{ $pattern: "engine.isArrowType" } as never],
      methods: { icon: "bot" }, priority: 100, scope: { kind: "account", accountId: "icon-reader-A" } });
    const accountA = frame(instances, "icon-reader-A");
    const accountB = frame(instances, "icon-reader-B");
    for (const target of [arrow, callableId]) {
      expect(select(accountA, instances, target)?.methods.icon).toBe("bot");
      expect(select(accountB, instances, target)?.methods.icon).toBe("function");
      expect(withInterpretedResolver(() => resolveEffect(accountA, instances, "Iconable", target, GLOBAL_ONLY))?.methods.icon).toBe("function");
    }
  });

  test("same-pool callable misses and anonymous witnesses never share a stale result", () => {
    const instances = pool();
    const context = frame(instances);
    expect(select(frame(instances, undefined, false), instances, callableId)).toBeUndefined();
    expect(select(context, instances, callableId)?.methods.icon).toBe("function");
    expect(select(frame(instances, undefined, false), instances, callableId)).toBeUndefined();
    expect(select(context, instances, arrow)?.methods.icon).toBe("function");
    expect(select(context, instances, { $void: true })).toBeUndefined();
    expect(select(context, instances, arrow)?.methods.icon).toBe("function");
  });

  test("the curated metadata helper retains exact reader declarations and authoritative misses", () => {
    const instances = pool();
    const context = frame(instances, "icon-reader-A");
    const projected = withInterpretedResolver(() => dispatchedRepresentationsForTarget(callableId, context));
    expect(projected.get("Iconable")?.methods.icon).toBe("function");
    const missing = withInterpretedResolver(() => dispatchedRepresentationsForTarget(callableId, frame(instances, "icon-reader-B", false)));
    expect(missing.has("Iconable")).toBe(false);
    // A helper-visible std declaration also remains missing when the reader
    // explicitly cannot see that identity; helper execution stays available.
    const fn = registry.getFunction("std.avg")!;
    const hidden = { ...context, getFunction: (name: string) => name === fn.id ? undefined : context.getFunction?.(name) };
    const hiddenProjection = withInterpretedResolver(() => dispatchedRepresentationsForTarget(fn.id, hidden));
    expect(hiddenProjection.has("Iconable")).toBe(false);
  });

  test("unrelated types, unknown identities and absent frames retain their existing misses", () => {
    const instances = pool();
    const context = frame(instances);
    expect(select(context, instances, "unknown-callable-identity")).toBeUndefined();
    expect(select(context, instances, { unknown: true })).toBeUndefined();
    expect(select(context, instances, { $record: { fields: [] } })).toBeUndefined();
    expect(select(context, instances, { $ref: "Number" })?.methods.icon).toBe(select(context, instances, "Number")?.methods.icon);
    expect(select(context, instances, "Number")?.methods.icon).not.toBe("function");
    expect(select(undefined, instances, arrow)).toBeUndefined();
    expect(select(context, instances, { $tag: "ByValue", value: callableId })).toBeUndefined();
  });

  test("hostile type envelopes do not invoke accessors or receive a guessed function icon", () => {
    const instances = pool();
    let reads = 0;
    const hostile = Object.defineProperty({}, "$arrow", { enumerable: true, get() { reads++; return arrow.$arrow; } });
    expect(select(frame(instances), instances, hostile)).toBeUndefined();
    expect(reads).toBe(0);
  });
});

describe("source argument binding preserves data and each registry's source scope", () => {
  const source = (...lines: string[]) => `${lines.join("\n")}\n`;
  const iconPool = (owner: string, rows: readonly Instance[]): DispatchRegistry => {
    const instances = createDispatchRegistry();
    instances.defineClass(dispatchRegistry.getClass("Iconable")!);
    instances.defineClass(dispatchRegistry.getClass("Labelable")!);
    for (const row of rows) instances.addInstance(row, { declaringModule: owner });
    return instances;
  };
  const bootstrap = (modules: FenelModule[], instances: DispatchRegistry, lock = new Map<string, string>()) =>
    withInterpretedResolver(() => createEngineBootstrapRegistry(modules, {
      dispatchRegistry: instances, functionIdentityLock: lock, publishCatalogEntities: false,
    }));

  test("a quoted dotted key, a nominal type and a structural rule retain their own keys", () => {
    const declared = loadFenelModule(source(
      "module argumentForms where",
      "ArgumentData = ArgumentData value: String",
      "ArgumentFacet a = ArgumentFacet marker: String",
      '_ : Iconable "std.join"', '_ = Iconable { icon = "literal-key" }',
      '_ : Iconable "std:join"', '_ = Iconable { icon = "literal-legacy-key" }',
      "_ : Iconable ArgumentData", '_ = Iconable { icon = "data-type" }',
      "_ : ArgumentFacet JsRuntime", '_ = ArgumentFacet { marker = "runtime-type" }',
      '_ : ArgumentFacet "JsRuntime"', '_ = ArgumentFacet { marker = "runtime-literal" }',
      "_ : ArgumentFacet Jsonb", '_ = ArgumentFacet { marker = "storage-type" }',
      '_ : ArgumentFacet "Jsonb"', '_ = ArgumentFacet { marker = "storage-literal" }',
    ), "argumentForms");
    const pattern: Instance = { typeName: "Iconable", args: [{ $pattern: "engine.isArrowType" } as never], methods: { icon: "structural-rule" } };
    const rows = [...declared.instances!, pattern];
    const instances = iconPool("argumentForms", rows);
    const join = stdModule.functions!.find(fn => fn.id === "std:join")!;
    const uuid = repositoryIdentityLock().get(join.id)!;
    const reg = bootstrap([declared, { name: "std", label: "Std target", functions: [join] }], instances, new Map([[join.id, uuid]]));
    const projected = reg.evaluateContext()._specRegistry!;
    expect(projected.resolve("std.join", "Iconable", GLOBAL_ONLY)?.icon).toBe("literal-key");
    expect(projected.listInstances("Iconable").find(row => row.methods.icon === "literal-legacy-key")?.args).toEqual([join.id]);
    expect(projected.resolve(uuid, "Iconable", GLOBAL_ONLY)).toBeUndefined();
    expect(projected.resolve("ArgumentData", "Iconable", GLOBAL_ONLY)?.icon).toBe("data-type");
    expect(projected.listInstances("Iconable").find(row => row.methods.icon === "structural-rule")).toBe(pattern);
    expect(pattern.args as unknown).toEqual([{ $pattern: "engine.isArrowType" }]);
    expect(declared.instances!.find(row => row.methods.icon === "literal-key")?.sourceArgumentReferences).toEqual([undefined]);
    expect(declared.instances!.find(row => row.methods.icon === "literal-legacy-key")?.sourceArgumentReferences).toEqual([undefined]);
    expect(declared.instances!.find(row => row.methods.icon === "data-type")?.args).toEqual(["ArgumentData"]);
    for (const [target, typeMarker, literalMarker] of [
      ["JsRuntime", "runtime-type", "runtime-literal"], ["Jsonb", "storage-type", "storage-literal"],
    ] as const) {
      const typed = declared.instances!.find(row => row.typeName === "ArgumentFacet" && row.methods.marker === typeMarker);
      const literal = declared.instances!.find(row => row.typeName === "ArgumentFacet" && row.methods.marker === literalMarker);
      expect(typed?.sourceArgumentReferences).toEqual([target]);
      expect(literal?.sourceArgumentReferences).toEqual([undefined]);
      expect(typed?.args).toEqual([target]);
      expect(literal?.args).toEqual([target]);
      expect(projected.listInstances("ArgumentFacet").find(row => row.methods.marker === typeMarker)?.args).toEqual([target]);
      expect(projected.listInstances("ArgumentFacet").find(row => row.methods.marker === literalMarker)?.args).toEqual([target]);
    }
  });

  test("two registries over one pool bind an imported source reference in their own frame in either build order", () => {
    const dependencies = ["depA", "depB"].map(name => loadFenelModule(source(
      `module ${name} where`, "go : Number -> Number", "go x = x",
    ), name));
    const declared = loadFenelModule(source(
      "module iconScope where", "_ : Iconable chosen.go", '_ = Iconable { icon = "scoped-source" }',
    ), "iconScope");
    const raw = declared.instances![0]!;
    const lock = new Map([
      ["depA:go", "88e5d5f4-6c81-452f-96e3-b66d5acb7111"],
      ["depB:go", "88e5d5f4-6c81-452f-96e3-b66d5acb7112"],
    ]);
    for (const order of [["depA", "depB"], ["depB", "depA"]] as const) {
      const instances = iconPool("iconScope", [raw]);
      const built = order.map(dep => ({ dep, reg: bootstrap([
        ...dependencies, { ...declared, imports: [{ module: dep, as: "chosen" }] },
      ], instances, lock) }));
      for (const { dep, reg } of built) {
        const target = lock.get(`${dep}:go`);
        if (target === undefined) throw new Error(`missing fixture function identity ${dep}:go`);
        const projected = reg.evaluateContext()._specRegistry!;
        const other = dep === "depA" ? "depB" : "depA";
        expect(projected.resolve(`${dep}:go`, "Iconable", GLOBAL_ONLY)?.icon).toBe("scoped-source");
        expect(projected.resolve(lock.get(`${dep}:go`)!, "Iconable", GLOBAL_ONLY)?.icon).toBe("scoped-source");
        expect(projected.resolve(`${other}:go`, "Iconable", GLOBAL_ONLY)).toBeUndefined();
        expect(projected.listInstances("Iconable")[0]!.args).toEqual([target]);
      }
      expect(instances.listInstances("Iconable")[0]!.args).toEqual(["chosen.go"]);
      expect(raw.args).toEqual(["chosen.go"]);
    }
  });

  test("a known function's existing facets survive UUID target transport", () => {
    const declared = defineFunction({ id: "facetProbe:visible", params: arrow.$arrow.params, returns: arrow.$arrow.returns }, {
      codeName: "visible", label: "Visible function", icon: "existing-facet",
    });
    const uuid = "88e5d5f4-6c81-452f-96e3-b66d5acb7113";
    const instances = iconPool("facetProbe", declared.instances);
    const reg = bootstrap([{ name: "facetProbe", label: "Facet probe", functions: [declared.fn], instances: declared.instances }],
      instances, new Map([[declared.fn.id, uuid]]));
    const projected = reg.evaluateContext()._specRegistry!;
    expect(projected.resolve(declared.fn.id, "Iconable", GLOBAL_ONLY)?.icon).toBe("existing-facet");
    expect(projected.resolve(uuid, "Iconable", GLOBAL_ONLY)?.icon).toBe("existing-facet");
    expect(projected.resolve(uuid, "Labelable", GLOBAL_ONLY)?.label).toBe("Visible function");
    expect(declared.instances.every(row => row.args[0] === declared.fn.id)).toBe(true);
  });

  test("live legacy-ID additions remain readable and projected UUID removals reach their owned row", () => {
    const owner = "icon-live-owner";
    const visibility = { kind: "frame" as const, account: owner, tags: [] };
    const fn: FenelFunction = { ...callable, id: "liveIcon:target" };
    const uuid = "88e5d5f4-6c81-452f-96e3-b66d5acb7114";
    const instances = iconPool("liveIcon", []);
    const reg = bootstrap([{ name: "liveIcon", label: "Live icon", functions: [fn] }], instances, new Map([[fn.id, uuid]]));
    const projected = reg.evaluateContext()._specRegistry!;
    const version = projected.version();
    projected.addInstance({ typeName: "Iconable", args: [fn.id], methods: { icon: "live-override" }, scope: { kind: "account", accountId: owner } }, { declaringModule: "liveIcon" });
    expect(projected.version()).toBeGreaterThan(version);
    expect(projected.resolve(fn.id, "Iconable", visibility)?.icon).toBe("live-override");
    expect(projected.resolve(uuid, "Iconable", visibility)?.icon).toBe("live-override");
    expect(projected.resolve(uuid, "Iconable", GLOBAL_ONLY)).toBeUndefined();
    projected.removeInstance("Iconable", uuid, owner);
    expect(projected.resolve(fn.id, "Iconable", visibility)).toBeUndefined();
    expect(instances.listInstances("Iconable")).toHaveLength(0);
  });
});
