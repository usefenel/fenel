// Phase 7g-parser — the producer PIN (the authoritative tripwire).
//
// 7g-parser flipped the LAST producer of a type reference: the `.fenel` parser.
// Where it emitted `{$ref: name}` for a user-WRITTEN type name in type
// position, it now emits `{$ref: name}` (the parser analogue of the GUI
// `pickTypeRef` producers; the handle is the code-name, D3). This file pins that
// contract PRECISELY — the exact `{$ref}` shape per producer site AND that the
// parser-SYNTHESIZED FenelType scaffolding stays `{$ref}`, while the canonical
// `$map.keys` SetExpr slot uses `SeRef` and the raw refinement parser retains
// its historical `{$ref}` spelling. It uses the RAW parser (no fold), so a
// regression that reverts the producer — or one that over-reaches into the
// scaffolding — trips here. The broad round-trip suites (`fenel-syntax` etc.)
// fold `{$ref}`≡`{$ref}` because the ref form is incidental to what they test;
// THIS file is where the form itself is the subject.

import { describe, it, expect } from "bun:test";
import { parse } from "./fenel-parser";
import { Ref, Nothing } from "./type-foundation";
import {
  dispatchEngineBody, dispatchedSourceSyntaxToJsonLogic, marshalParsedFrames,
  withInterpretedResolver,
} from "./engine-bodies-dispatch";
import { exprNodeToLogic, inferAuthoringExpression, logicToExprNode } from "./authoring/expression-authoring";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "./authoring/environment";
import { createRegistry } from "./registry";
import { evaluate, pureEvaluateContext } from "./json-logic";
import { resolveLocalCallHeads } from "./fenel-module";
import type { FenelModule, FenelType } from "./types";

const identity = "12345678-1234-4234-8234-123456789abc";
const stringScheme = { quantified: [], body: { $arrow: { params: [], returns: { $ref: "String" } } } };

describe("identity literal source boundary", () => {
  it("keeps bare identity data separate from explicit applications and type refs", () => {
    expect(P(`@{${identity}}`)).toEqual({ $ref: identity });
    expect(P(`@{${identity}} ()`)).toEqual({ call: [{ $ref: identity }] });
    expect(P(`@{${identity}} 1`)).toEqual({ call: [{ $ref: identity }, 1] });
    expect(P(`(7 : @{${identity}})`)).toEqual({ ann: [7, { $ref: identity }] });
    expect(P(`@{"${identity}"}`)).toEqual({ $ref: identity });
    expect(P("std.add 2 3")).toEqual({ call: ["std.add", 2, 3] });
    expect(P("system.Expr.ELit 42")).toEqual({ call: ["system.Expr.ELit", 42] });
  });

  it("rejects malformed literals and unsupported identity expressions inside types", () => {
    for (const source of ['@{}', '@{""}', '@{not-a-uuid}', '@{"missing}', '@{"bad\\q"}', '@{"std.add"}', '@{"@ctor/source/type/Counter"}',
      `(7 : Vec Int (@{${identity}} 1))`, `f : Vec Int (@{${identity}} 1)\nf = 7`,
      `f : Int where @{${identity}} it\nf = 7`]) expect(() => P(source)).toThrow();
    expect(() => P('@{"a\\\"b\\\\c"}')).toThrow();
  });

  it("Fenel egress changes only explicit source sites, leaving SLit lookalikes opaque", () => withInterpretedResolver(() => {
    const site = { $tag: "SVar", name: identity, identity: true };
    expect(dispatchedSourceSyntaxToJsonLogic(site)).toEqual({ $ref: identity });
    expect(dispatchedSourceSyntaxToJsonLogic({ $tag: "SCall", fnId: identity, args: [], identityHead: site }))
      .toEqual({ call: [{ $ref: identity }] });
    expect(dispatchedSourceSyntaxToJsonLogic({ $tag: "SLit", value: site })).toEqual(site);
  }));

  it("the Fenel lexer and grammar author the same bare reference as the B1 mirror", () => withInterpretedResolver(() => {
    const source = `@{${identity}}`;
    const tokens = dispatchEngineBody("engine:lexAll", [source]);
    const layout = dispatchEngineBody("engine:layoutTokens", [tokens]);
    const table = dispatchEngineBody("engine:defaultFixityTable", []);
    const parsed = dispatchEngineBody("engine:parseExprToks", [table, null, layout]) as { $tag: string; _0: unknown };
    expect(parsed.$tag).toBe("Just");
    expect(dispatchedSourceSyntaxToJsonLogic(parsed._0)).toEqual(P(source));
  }));

  it("retains a declaration predicate refusal through source binding and frame egress", () => withInterpretedResolver(() => {
    const site = { $tag: "SVar", name: identity, identity: true };
    const predicate = { $tag: "SCall", fnId: identity, identityHead: site, args: [{ $tag: "SVar", name: "it" }] };
    const elements = [{ frame: { kind: "sig", name: "f", ty: {
      mk: "refined", base: { mk: "ref", name: "Int" }, set: { mk: "where", syntax: predicate },
    } }, directives: [] }];
    const frames = dispatchEngineBody("engine:programToFrames", [elements]) as unknown[];
    expect(() => marshalParsedFrames(frames)).toThrow();
  }));

  it("refuses a reference cell aliased into opaque data, while retaining repeated executable uses", () => withInterpretedResolver(() => {
    const site = { $tag: "SVar", name: identity, identity: true };
    const record = (data: unknown) => ({ $tag: "SRecord", fields: [
      { name: "data", value: data }, { name: "reference", value: site },
    ] });
    expect(() => dispatchedSourceSyntaxToJsonLogic(record({ $tag: "SLit", value: site }))).toThrow();
    expect(dispatchedSourceSyntaxToJsonLogic(record(site))).toEqual({ data: { $ref: identity }, reference: { $ref: identity } });
  }));

  it("uses current admitted function and constructor kinds, preserving saved refs and inert tagged data", () => withInterpretedResolver(() => {
    const fn = { id: identity, kind: "function" as const, params: [], returns: { $ref: "String" }, scheme: stringScheme };
    const convert = (entry: typeof fn) => logicToExprNode(P(`@{${identity}} ()`), [], name => name, () => undefined, () => entry);
    expect(exprNodeToLogic(convert(fn))).toEqual({ call: [identity] });
    const literal = { $tag: "ELit", value: { call: [identity] } };
    expect(exprNodeToLogic(logicToExprNode(literal))).toEqual(literal);
    expect(exprNodeToLogic({ kind: "ref", savedExprId: "saved" }, { resolver: () => ({ kind: "literal", value: 42 }) })).toBe(42);
  }));

  it("admits a bridged repository UUID without replacing its checked declaration", () => withInterpretedResolver(() => {
    const entry = { id: "std:add", kind: "function" as const, params: [], returns: { $ref: "String" }, scheme: stringScheme };
    const node = logicToExprNode(P(`@{${identity}} ()`), [], () => "std:add", () => undefined, () => entry);
    expect(exprNodeToLogic(node)).toEqual({ call: [identity] });
  }));

  it("uses actual constructor slots to distinguish named fields from a positional record payload", () => withInterpretedResolver(() => {
    const target = "87654321-4321-4321-8321-cba987654321";
    const field = { name: "count", key: { $tag: "NamedField" as const, ref: { $ref: identity } }, type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} };
    const entry = { id: "Counter", targetId: target, kind: "constructor" as const, params: [field], returns: { $ref: identity } };
    const named = logicToExprNode(P(`@{"${target}"} { count = 7 }`), [], name => name, name => name, () => entry);
    expect(exprNodeToLogic(named)).toEqual({ construct: [target, { count: 7 }] });
    const positional = { ...entry, params: [{ ...field, name: "_0", key: { $tag: "PositionalField" as const, index: 0 } }] };
    const payload = logicToExprNode(P(`@{"${target}"} { left = 1, right = 2 }`), [], name => name, name => name, () => positional);
    expect(payload.kind).toBe("call");
    expect(exprNodeToLogic(payload)).toEqual({ construct: [target, { left: 1, right: 2 }] });
  }));

  it("requires a type-only projection for Type references, including named arrow types", () => withInterpretedResolver(() => {
    const node = { kind: "literal" as const, value: { $ref: identity } };
    const overloaded = inferAuthoringExpression(node, { getFunctionEntry: () => undefined, resolveTypeRef: () => stringScheme.body });
    expect(overloaded.outcome.$tag).not.toBe("Solved");
    const type = inferAuthoringExpression(node, { getFunctionEntry: () => undefined, resolveNamedType: () => stringScheme.body });
    expect(type.outcome.$tag).toBe("Solved");
    expect(type.type).toEqual({ $type: true });
    expect(inferAuthoringExpression(node, {}).outcome.$tag).not.toBe("Solved");
    const constructorAlias = { id: identity, targetId: "@ctor/type/Counter", kind: "constructor" as const,
      params: [], returns: { $ref: identity }, scheme: stringScheme };
    const aliasContext = { getFunctionEntry: () => constructorAlias, resolveFunctionId: () => constructorAlias.targetId,
      resolveNamedType: () => stringScheme.body };
    expect(inferAuthoringExpression(node, aliasContext).type).toEqual({ $type: true });
    expect(() => logicToExprNode(P(`@{${identity}} ()`), [], aliasContext.resolveFunctionId,
      () => constructorAlias.targetId, aliasContext.getFunctionEntry)).toThrow();
    expect(inferAuthoringExpression({ kind: "literal", value: { $ref: constructorAlias.targetId } }, {
      getFunctionEntry: () => constructorAlias,
    }).outcome.$tag).not.toBe("Solved");
  }));

  it("inspects identity callbacks as own data without invoking accessors", () => {
    for (const key of ["resolveTypeRef", "resolveNamedType", "resolveFunctionId"]) {
      let reads = 0;
      const context = Object.defineProperty({}, key, { get: () => { reads++; return () => undefined; } });
      const result = inferAuthoringExpression({ kind: "literal", value: { $ref: identity } }, context);
      expect(result.outcome.$tag).toBe("Invalid");
      expect(reads).toBe(0);
    }
  });

  it("refuses unavailable applied references before generic call, dollar or apply fallback", () => {
    const held = { $ref: identity };
    expect(logicToExprNode(held, [], () => undefined, () => undefined, () => undefined)).toEqual({ kind: "literal", value: held });
    for (const body of [{ call: [held, 7] }, { call: ["$", held, 7] }, { apply: [held, [7]] }]) {
      expect(() => logicToExprNode(body, [], () => undefined, () => undefined, () => undefined)).toThrow();
    }
    expect(() => logicToExprNode({ call: [{ var: "f" }, 7] }, [], () => undefined,
      () => undefined, () => undefined)).not.toThrow();
  });

  it("uses captured constructor Function slots before evaluating a named record argument", () => withInterpretedResolver(() => {
    const field = { name: "count", key: { $tag: "NamedField" as const, ref: { $ref: "447cf214-1123-4717-9bfc-73f0c87c429d" } },
      type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} };
    const entry = { id: identity, targetId: identity, kind: "function" as const,
      constructorTarget: "Counter", params: [field], returns: { $ref: "Counter" } };
    const convert = (source: string) => logicToExprNode(P(source), [], () => identity,
      () => undefined, () => entry);
    const context = pureEvaluateContext({ _constructors: { Counter: ["count"], ELit: ["value"] } });
    const counter = convert(`@{${identity}} { count = 7 }`);
    expect((counter as any).value.__construct.fields[0].key).toEqual(field.key);
    expect(evaluate(exprNodeToLogic(counter), {}, context)).toEqual({ $tag: "Counter", count: 7 });
    const valueField = { ...field, name: "value", key: { $tag: "NamedField" as const,
      ref: { $ref: "82d12175-9e51-4c61-9341-a2bc8412f671" } } };
    const litEntry = { ...entry, constructorTarget: "ELit", params: [valueField], returns: { $ref: "Expr" } };
    const lit = logicToExprNode(P("system.Expr.ELit { value = 42 }"), [], () => identity,
      () => undefined, () => litEntry);
    expect((lit as any).value.__construct.fields[0].key).toEqual(valueField.key);
    expect(evaluate(exprNodeToLogic(lit), {}, context)).toEqual({ $tag: "ELit", value: 42 });
    const payload = { $tag: "Inert", call: ["unavailable", 99] };
    const positional = { ...entry, constructorTarget: "Payload", params: [{ ...field, name: "_0",
      key: { $tag: "PositionalField" as const, index: 0 } }] };
    const node = logicToExprNode({ call: [{ $ref: identity }, payload] }, [], () => identity,
      () => undefined, () => positional);
    expect(exprNodeToLogic(node)).toEqual({ call: [identity, payload] });
    expect(logicToExprNode(P(`@{${identity}} 7`), [], () => identity, () => undefined, () => entry).kind).toBe("call");
  }));

  it("uses the same ordinary member Function for named calls, held references and higher-order calls", () => withInterpretedResolver(() => {
    const functionId = "f6e35b55-1db2-40fb-81c1-1e45cb013291";
    const emptyId = "81273963-98c6-4aaf-914b-d23c0e1185af";
    const type: FenelType = { $variant: { cases: [{ name: "Wrapped", label: Nothing,
      constructorFunction: { $ref: functionId }, fields: [{ name: "_0",
        key: { $tag: "PositionalField", index: 0 }, type: { $ref: "Number" },
        label: Nothing, ui: Nothing, meta: {} }],
    }, { name: "Empty", label: Nothing, constructorFunction: { $ref: emptyId }, fields: [] }] } };
    const module: FenelModule = { name: "memberProbe", label: "Member probe", entities: [{ id: "Wrapper", type,
      typeScheme: { quantified: [], body: type } }], functions: [], instances: [] };
    // Explicit lockless fixture: Type names are legacy source handles here,
    // while the constructor occurrence already owns a genuine Function UUID.
    const registry = createRegistry([module], { fieldIdentity: { mode: "source-handles",
      defaultRealm: "repository-source", identityKinds: new Map([[functionId, "function"], [emptyId, "function"]]) } });
    const snapshot = buildAuthoringCatalogSnapshot([], { registry });
    const environment = createAuthoringEnvironment(snapshot, { moduleMembers: registry });
    const name = "memberProbe.Wrapper.Wrapped";
    const entry = environment.getFunctionEntry?.(name);
    expect(entry?.kind).toBe("function");
    expect(entry?.targetId).toBe(functionId);
    expect(snapshot.referenceRoutes?.find((route) => route.sourceName === name)?.targetId).toBe(functionId);
    expect(snapshot.patternConstructors?.find((row) => row.id === "Wrapped")?.functionId).toBe(functionId);
    expect(snapshot.functions.filter((row) => row.id === functionId || row.functionId === functionId)).toHaveLength(1);
    expect(snapshot.functions.find((row) => row.id === functionId)?.kind).toBe("function");
    expect(environment.getFunctionEntry?.("memberProbe.Wrapped")).toBeUndefined();
    expect(environment.resolveFunctionId("memberProbe.Wrapped")).toBeUndefined();
    expect(snapshot.exactConstructorRoutes?.find((route) => route.sourceName === name)?.functionId).toBe(functionId);
    expect(registry.getFunctionSignatureInfo(emptyId)?.outcome.$tag).toBe("Solved");
    expect(registry.getFunctionScheme(emptyId)?.nominals?.[0]?.path).toEqual(["$arrow", "returns"]);
    const context = registry.evaluateContext();
    const convert = (source: string) => logicToExprNode(resolveLocalCallHeads(P(source), []), [], environment.resolveFunctionId,
      environment.resolveConstructorTarget, environment.getFunctionEntry);
    const call = convert(`${name} 45`);
    const inferredCall = inferAuthoringExpression(call, environment);
    expect(inferredCall.outcome.$tag).toBe("Solved");
    expect(evaluate(exprNodeToLogic(call), {}, context)).toEqual({ $tag: "Wrapped", _0: 45 });
    const held = convert(name);
    expect(inferAuthoringExpression(held, environment).outcome.$tag).toBe("Solved");
    expect(evaluate(exprNodeToLogic(held), {}, context)).toEqual({ $ref: functionId });
    const higher = convert(`(use ${name}) where use = \\f -> f 46`);
    const inferredHigher = inferAuthoringExpression(higher, environment);
    expect(inferredHigher.outcome.$tag).toBe("AnnotationRequired");
    if (inferredHigher.outcome.$tag === "AnnotationRequired") {
      expect(inferredHigher.outcome.diagnostics.some((diagnostic) => diagnostic.code === "inference.effect-polymorphism")).toBe(true);
    }
    expect(evaluate(exprNodeToLogic(higher), {}, context)).toEqual({ $tag: "Wrapped", _0: 46 });
    expect(inferAuthoringExpression(convert(`@{${functionId}}`), environment).outcome.$tag).toBe("Solved");
    expect(inferAuthoringExpression(convert("memberProbe.Wrapper"), environment).type).toEqual({ $type: true });
    expect(inferAuthoringExpression(convert(`${name} 45`), { ...environment,
      bindings: { memberProbe: { $record: { fields: [] } } } }).outcome.$tag).not.toBe("Solved");
    expect(inferAuthoringExpression(convert("memberProbe.Wrapper.Absent"), environment).outcome.$tag).not.toBe("Solved");
    for (const wrong of [{ kind: "type" as const, value: { $ref: "Wrapper" } },
      { kind: "function" as const, id: emptyId }]) {
      const facts = { ...registry, resolveModuleMember: (root: string, member: string, path: readonly string[] = []) =>
        path.length > 0 ? wrong : registry.resolveModuleMember(root, member, path) };
      expect(inferAuthoringExpression(held, { ...environment, moduleMembers: facts }).outcome.$tag).toBe("Invalid");
    }
  }));
});

const P = parse as unknown as (src: string) => any;

describe("7g-parser — the producer emits {$ref} for a user-written type name", () => {
  it("FORWARD type-ref: a bare ident in field-type position → {$ref}", () => {
    // `Shape = Circle radius: Bot` — the user wrote the type name `Bot`.
    const ast = P("Shape = Circle radius: Bot");
    const fieldType = ast.type_def.constructors[0].fields[0].type;
    expect(fieldType).toEqual({ $ref: "Bot" });
    // byte-identical to the engine's own reference constructor
    expect(fieldType).toEqual(Ref("Bot"));
    // a single-key `$ref` — no kind tag, no UUID mint (the kind is recovered by
    // the consumer; the Phase-6 lock bridges name→UUID)
    expect(Object.keys(fieldType)).toEqual(["$ref"]);
  });

  it("TYPE-APP ARG: the arg of an applied type → {$ref}; the return too", () => {
    // `f : Maybe Bot -> Number` — `Bot` is the Maybe arg, `Number` the return.
    const sig = P("f : Maybe Bot -> Number\nf x = x").program[0].type_sig;
    const paramType = sig.type.$arrow.params[0].type; // Maybe Bot
    const justInner = paramType.$variant.cases[1].fields[0].type; // the `Just _0`
    expect(justInner).toEqual({ $ref: "Bot" });
    expect(justInner).toEqual(Ref("Bot"));
    expect(sig.type.$arrow.returns).toEqual({ $ref: "Number" });
  });

  it("RECURSIVE SELF-REF: the type's own name in its body → {$ref}", () => {
    // `Tree a = Leaf | Node left: Tree a` — `Tree` is the recursive self-ref.
    const ast = P("Tree a = Leaf | Node left: Tree a");
    const nodeLeft = ast.type_def.constructors[1].fields[0].type; // `Tree a`
    expect(nodeLeft).toEqual({ $ref: "Tree" });
    expect(nodeLeft).toEqual(Ref("Tree"));
  });

  it("explicit declaration type variables emit {$var}, distinct from nominal {$ref}", () => {
    const ast = P("Pair a b = MkPair first: a second: b");
    expect(ast.type_def.constructors[0].fields[0].type).toEqual({ $var: "a" });
    expect(ast.type_def.constructors[0].fields[1].type).toEqual({ $var: "b" });
    expect(ast.type_def.binding.quantified.map((variable: { id: string; sourceName: string }) =>
      [variable.id, variable.sourceName]
    )).toEqual([["q0", "a"], ["q1", "b"]]);
  });
});

// 7g-retire-2b retired `Str` in favour of the canonical registered `String`.
// FenelType reference slots carry `{$ref}`; `$map.keys` is instead a SetExpr
// slot and therefore carries the canonical `SeRef` form.
describe("7g-retire-2b — synthesized references use their slot's canonical form", () => {
  it("Map-key is the canonical `SeRef String` SetExpr (Str retired, #2a)", () => {
    const sig = P("f : Map String Number -> Number\nf x = x").program[0].type_sig;
    const mapType = sig.type.$arrow.params[0].type;
    expect(mapType.$map.keys).toEqual({ $tag: "SeRef", handle: "String" });
    expect(mapType.$map.values).toEqual({ $ref: "Number" });
  });

  it("EntityRef expands to {$ref:Id} + {$ref:String} scaffolding", () => {
    const sig = P('f : EntityRef<"Bot"> -> Number\nf x = x').program[0].type_sig;
    const tagged = sig.type.$arrow.params[0].type.$tagged;
    expect(tagged.value).toEqual({ $ref: "Id" });
    expect(tagged.phantom.$refined.base).toEqual({ $ref: "String" });
  });

  it("refinement SET ref (`format:`) also emits {$ref} (a set-name is a type-ref too, D3)", () => {
    const ast = P("read(String{email})");
    expect(ast.call[1].schema.set).toEqual({ $ref: "format:email" });
  });
});
