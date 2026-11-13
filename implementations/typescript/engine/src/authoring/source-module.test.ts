import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import source from "./source-module.fixture.fenel?raw";
import originSource from "./source-module-origin.fixture.fenel?raw";
import { parse } from "../fenel-parser";
import { print } from "../engine-bodies-dispatch";
import { loadFenelModule, DIRECTIVE_POLICY } from "../fenel-module";
import { evaluate } from "../json-logic";
import { dispatchRegistry } from "../system-entities";
import { prepareSourceModule, prepareSourceModulesFromRows, sourceModuleRowsFingerprint, sourceModuleRegistry, sourceModuleVersionClosure, repositorySourceModuleProjection, reservedSourceModuleNamespaces, type PreparedSourceModule } from "./source-module";
import type { ModuleRegistry } from "../registry";
import { parseProvenanceCounts } from "../parse-cache";
import { validate } from "../validate";

describe("canonical source module authoring and scoped installation", () => {
  let prepared: PreparedSourceModule;
  let registry: ModuleRegistry;
  beforeAll(() => {
    prepared = prepareSourceModule(source, "fixture", undefined, randomUUID);
    registry = sourceModuleRegistry([prepareSourceModule(originSource, "origin", undefined, randomUUID), prepared]);
  }, 300_000);

  test("declaration printer preserves module/import/directive/signature data", () => {
    const before = parse(source);
    expect(parse(print(before))).toEqual(before);
    const loaded = loadFenelModule(print(before), "fallback");
    expect(loaded.name).toBe("SourceParityFixture");
    expect(loaded.imports).toEqual([{ module: "std", names: ["add"] }, { module: "SourceOrigin", as: "Origin" }]);
    expect(loaded.methodDefaults?.SourceDisplay?.display).toBeDefined();
    const declarations = (before as { program: Record<string, { directives?: { name: string }[] }>[] }).program;
    const names = new Set(declarations.flatMap((declaration) => Object.values(declaration).flatMap((value) => value.directives?.map((directive) => directive.name) ?? [])));
    expect(DIRECTIVE_POLICY.filter((policy) => !names.has(policy.name))).toEqual([]);
  });

  test("unit bodies and nested unit expressions print as the parser's unit syntax", () => {
    expect(print(null)).toBe("()");
    const before = parse("unit = ()\nnested = [(), (\\x -> ())]");
    expect(parse(print(before))).toEqual(before);
  });

  test("headerless files replay the saved namespace and UUID lock", () => {
    const text = "identity : (value: a) -> a\nidentity value = value";
    const draft = prepareSourceModule(text, "Headerless", undefined, randomUUID);
    const row = { registry: { id: "version-id", source: text, slug: "account/Headerless", version: "1", module: { sourceNamespace: "Headerless", sourceIdentity: draft.identity } } };
    const [reopened] = prepareSourceModulesFromRows([row]);
    expect(reopened?.module.name).toBe("Headerless");
    expect(reopened?.module.functions).toEqual(draft.module.functions);
    expect(reopened?.identity).toEqual(draft.identity);
    expect(sourceModuleRowsFingerprint([row])).not.toBe(sourceModuleRowsFingerprint([{ registry: { ...row.registry, module: { ...row.registry.module, sourceNamespace: "Another" } } }]));
  });

  test("source imports require exact package pins and pinned closure excludes later replacements", () => {
    const origin = prepareSourceModule(originSource, "origin", undefined, randomUUID);
    const base = { registry: { id: "origin-v1", slug: "account/origin", version: "1", source: originSource, module: { sourceIdentity: origin.identity } } };
    const consumer = { registry: { id: "consumer-v1", slug: "account/consumer", version: "1", source, module: { sourceIdentity: prepared.identity }, dependencies: [] as { registry: string; version: string }[] } };
    expect(() => prepareSourceModulesFromRows([base, consumer])).toThrow("requires an exact dependency pin");
    consumer.registry.dependencies.push({ registry: "account/origin", version: "1" });
    expect(prepareSourceModulesFromRows([base, consumer])).toHaveLength(2);
    const replacement = { registry: { ...base.registry, id: "unrelated-new", slug: "account/replacement" } };
    expect(sourceModuleVersionClosure([base, consumer, replacement], "consumer-v1").map((row) => row.registry.id)).toEqual(["consumer-v1", "origin-v1"]);
  });

  test("persisted field locks rehydrate exact UUIDs without storing authoritative schemes", () => {
    const reopened = prepareSourceModule(source, "fixture", prepared.identity);
    expect(reopened.identity).toEqual(prepared.identity);
    expect(reopened.module.entities).toEqual(prepared.module.entities);
    expect(registry.getFunctionSignatureInfo("SourceParityFixture:identity")?.outcome.$tag).toBe("Solved");
    expect(registry.getFunctionScheme("SourceParityFixture:identity")?.quantified.map((variable) => variable.sourceName)).toEqual(["a"]);
  });

  test("imported calls and source method defaults execute only in their private registry", () => {
    const context = registry.evaluateContext();
    expect(evaluate({ call: ["SourceParityFixture:addOne", 4] }, {}, context)).toBe(5);
    expect(evaluate({ call: ["SourceParityFixture:render", 4] }, {}, context)).toBe("default");
    expect(dispatchRegistry.getClass("SourceDisplay")).toBeUndefined();
    expect(dispatchRegistry.listInstances("SourceDisplay")).toEqual([]);
  });

  test("native declarations remain bodyless declarations", () => {
    const external = registry.getFunction("SourceParityFixture:external");
    expect(external).toBeDefined();
    expect(external?.body).toBeUndefined();
    expect(prepared.module.nativeImpls).toBeUndefined();
  });

  test("namespace preparation retains cloneable exact repository owners without installed source types", () => {
    const projection = repositorySourceModuleProjection();
    expect(repositorySourceModuleProjection()).toBe(projection);
    expect(reservedSourceModuleNamespaces()).toBe(projection.namespaces);
    expect(projection.namespaces.has("representation-bridge")).toBe(true);
    expect(projection.namespaces.has("authority")).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.entities)).toBe(true);
    expect(Object.isFrozen(projection.identifiedEntities)).toBe(true);
    for (const owner of ["telegram", "animation"]) {
      const raw = projection.entities.find(entity => entity.id === "Animation" && entity.module === owner);
      const identified = projection.identifiedEntities.find(entity => entity.id === "Animation" && entity.module === owner);
      expect(raw).toBeDefined();
      expect(identified).toBeDefined();
      expect(structuredClone(raw)).toEqual(raw);
      expect(structuredClone(identified)).toEqual(identified);
    }
    expect(projection.entities.some(entity => entity.params?.length)).toBe(true);
    expect(projection.identifiedEntities.some(entity => entity.params?.length)).toBe(true);
    for (const name of ["SourcePayload", "SourceChoice", "SourceHolder", "SourceLater", "SourceDisplay"]) {
      expect(registry.getEntity(name)).toBeDefined();
      expect(projection.entities.some(entity => entity.id === name)).toBe(false);
      expect(projection.identifiedEntities.some(entity => entity.id === name)).toBe(false);
    }
  });

  test("cross-module returned callbacks keep callee Name scope and forward type names resolve", () => {
    expect(evaluate({ call: ["SourceParityFixture:useOrigin", 2] }, {}, registry.evaluateContext())).toBe(15);
    expect(registry.getEntity("SourceLater")?.type).toBeDefined();
    // Entity handles are globally named in the shipped type resolver. Module
    // qualification is a function/method surface, not an entity alias scheme.
    expect(registry.getEntity("SourceParityFixture.SourceLater")).toBeUndefined();
    expect(registry.getEntity("SourceHolder")?.type).toBeDefined();
    // These declarations have named record fields. Positional construction
    // deliberately emits _0; use the named surface to inhabit their schemas.
    const holder = evaluate({ construct: ["SourceHolder", { later: { construct: ["SourceLater", { text: "ok" }] } }] }, {}, registry.evaluateContext());
    expect(validate({ $ref: "SourceHolder" }, holder, null, { registry })).toMatchObject({ valid: true, errors: [] });
    expect(evaluate({ call: ["SourceParityFixture:same", 2] }, {}, registry.evaluateContext())).toBe(102);
  });

  test("cache-miss production parser accepts all import forms and applies local fixities", () => {
    const before = parseProvenanceCounts();
    const imports = loadFenelModule("-- source parser provenance corpus v2\nmodule PrimarySource where\nimport SourceOrigin\nimport SourceOrigin as Origin\nimport std (add)\nimport SourceOrigin hiding (same)\nvalue = 1", "primary");
    expect(imports.imports).toEqual([{ module: "SourceOrigin", qualified: true }, { module: "SourceOrigin", as: "Origin" }, { module: "std", names: ["add"] }, { module: "SourceOrigin", hiding: ["same"] }]);
    const left = loadFenelModule("-- source fixity provenance left\nmodule LeftFixity where\ninfixl 5 <+>\nvalue = 1 <+> 2 <+> 3", "left");
    const right = loadFenelModule("-- source fixity provenance right\nmodule RightFixity where\ninfixr 5 <+>\nvalue = 1 <+> 2 <+> 3", "right");
    expect(left.functions?.[0]?.body).not.toEqual(right.functions?.[0]?.body);
    const after = parseProvenanceCounts();
    expect(after.fenel - before.fenel).toBe(3);
    expect(after.ts - before.ts).toBe(0);
  });
});
