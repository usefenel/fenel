import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { evaluate } from "@fenel/engine";
import { prepareSourceModule, sourceModuleRegistry, sourceModuleSessionFor,
  type PreparedSourceModule, type SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { buildReaderFieldRegistry, readerSourceDeclarations } from "../reader-registry";
import { buildSessionCatalog, environmentForCatalog, evaluateContextForCatalog, sessionCatalogSections } from "./authoring-catalog";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import { declaringModuleForFunction } from "./authoring-session-scope";
import type { AuthoringSession } from "./account-authoring-session";

// The established source-scope corpus includes explicit imports, two same-named
// functions, returned callbacks, generic signatures, constructors and a private
// class method default. Compare the original execute-profile source session
// with the existing checked reader composition now reused by account startup.
const fixture = await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/authoring/source-module.fixture.fenel", import.meta.url)).text();
const origin = await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/authoring/source-module-origin.fixture.fenel", import.meta.url)).text();
const accountField = "b225f6a1-d50d-4bdd-b3ee-b142e9226fae";
const snapshot: FieldPersistenceSnapshot = {
  owners: [{ ownerKey: "type:Gp33AccountRecord", kind: "type", storageName: "Gp33AccountRecord",
    definition: { id: "Gp33AccountRecord", type: { $record: { fields: [{ name: "title",
      key: { $tag: "NamedField", ref: { $ref: accountField } }, type: { $ref: "String" },
      label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
    }] } } } }],
  fields: [{ id: accountField, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
  facets: [{ fieldId: accountField, typeName: "Labelable", methods: { label: "My title" }, scope: "account", priority: 100 }],
};

describe("committed source registry preserves source authoring authority", () => {
  let prepared: PreparedSourceModule[], old: AuthoringSession, current: AuthoringSession, root: AuthoringSession;
  beforeAll(async () => {
    prepared = [prepareSourceModule(origin, "origin", undefined, randomUUID), prepareSourceModule(fixture, "fixture", undefined, randomUUID)];
    const documents: SourceModuleDocument[] = prepared.map((entry, index) => ({
      id: `gp33-source-${index}`, slug: `gp33/${index}`, version: "1", source: index === 0 ? origin : fixture,
      namespace: entry.module.name, identity: entry.identity,
    }));
    old = sourceModuleSessionFor(sourceModuleRegistry(prepared), prepared, "SourceParityFixture");
    const registry = await buildReaderFieldRegistry("gp33", snapshot, documents);
    current = sourceModuleSessionFor(registry, prepared, "SourceParityFixture");
    const catalog = buildSessionCatalog(registry);
    const environment = createDetachedAuthoringEnvironment(environmentForCatalog(catalog));
    root = { mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: evaluateContextForCatalog(registry) };
    if (process.env.FENEL_GP33_PICKER_ARTIFACT) {
      await Bun.write(process.env.FENEL_GP33_PICKER_ARTIFACT, JSON.stringify({ catalog: { ...root.catalog,
        operatorCodeNameByNotation: [...root.catalog.operatorCodeNameByNotation] },
        sourceDeclarations: readerSourceDeclarations(registry), source: fixture,
        sourceFunctionIds: prepared.flatMap(entry => (entry.module.functions ?? []).map(fn => fn.id)),
        sources: [{ source: origin, namespace: "SourceOrigin" }, { source: fixture, namespace: "SourceParityFixture" }],
        selectedId: "SourceParityFixture:identity" }));
    }
  }, 900_000);

  test("source schemes and exact declaring owners match the prior source registry", () => {
    for (const entry of prepared) for (const fn of entry.module.functions ?? []) {
      expect(current.registry.getFunctionScheme(fn.id)).toEqual(old.registry.getFunctionScheme(fn.id));
      expect(current.registry.getFunctionSignatureInfo(fn.id)?.outcome).toEqual(old.registry.getFunctionSignatureInfo(fn.id)?.outcome);
      expect(declaringModuleForFunction(current.registry, fn.id)).toEqual(declaringModuleForFunction(old.registry, fn.id));
      expect(current.environment.resolveFunctionId(fn.id)).toBe(old.environment.resolveFunctionId(fn.id));
    }
    expect(current.environment.resolveFunctionId("SourceParityFixture.addOne")).toBe("SourceParityFixture:addOne");
    expect(current.environment.resolveFunctionId("Origin.callback")).toBe("SourceOrigin:callback");
    expect(current.environment.resolveFunctionId("addOne")).toBe("SourceParityFixture:addOne");
  });

  test("the committed reader root preserves source picker rows, exact targets and generic references", () => {
    const previous = createDetachedAuthoringEnvironment(old.environment);
    for (const entry of prepared) for (const fn of entry.module.functions ?? []) {
      expect(root.environment.resolveFunctionId(fn.id)).toBe(previous.resolveFunctionId(fn.id));
      expect(root.catalog.functions.find(candidate => candidate.id === fn.id)?.scheme).toEqual(old.catalog.functions.find(candidate => candidate.id === fn.id)?.scheme);
      const qualified = `${entry.module.name}.${fn.id.split(":")[1]}`;
      expect(root.environment.resolveFunctionId(qualified)).toBe(previous.resolveFunctionId(qualified));
    }
    expect(root.environment.resolveFunctionId("Origin.callback")).toBeUndefined();
    expect(root.environment.resolveFunctionId("addOne")).toBeUndefined();
    expect(root.environment.getFunctionEntry?.("SourceParityFixture:identity")?.scheme?.quantified.map(variable => variable.sourceName)).toEqual(["a"]);
    const sourceTypes = sessionCatalogSections(root.registry).flatMap(section => section.entries).filter(entry => entry.entity?.id === "SourceDisplay");
    expect(sourceTypes).toHaveLength(1);
    expect(sourceTypes[0]!.entity!.params).toEqual([{ name: "a", constraints: [] }]);
    expect(root.environment.resolveNamedType?.("SourceDisplay")).toEqual(root.registry.getIdentifiedEntity("SourceDisplay")!.type);
  });

  test("imports, shadowed names, callbacks and source method defaults keep their outputs", () => {
    for (const [id, input, result] of [
      ["SourceParityFixture:addOne", 4, 5], ["SourceParityFixture:same", 2, 102],
      ["SourceOrigin:same", 2, 12], ["SourceParityFixture:useOrigin", 2, 15],
      ["SourceParityFixture:render", 4, "default"], ["SourceParityFixture:identity", "exact", "exact"],
    ] as const) {
      expect(evaluate({ call: [id, input] }, {}, current.evaluateContext)).toEqual(result);
      expect(evaluate({ call: [id, input] }, {}, old.evaluateContext)).toEqual(result);
    }
  });

  test("exact constructor schemes, short wire tags and source field UUIDs are preserved", () => {
    const previous = old.catalog.patternConstructors?.find(entry => entry.ownerIdentity === old.registry.getEntityNominalIdentity("SourceChoice") && entry.label === "SourceFirst");
    expect(previous).toBeDefined();
    const next = current.catalog.patternConstructors?.find(entry => entry.targetId === previous!.targetId);
    expect(next?.scheme).toEqual(previous!.scheme);
    expect(next?.ownerIdentity).toBe(previous!.ownerIdentity);
    expect(current.environment.resolveConstructorTarget?.(previous!.targetId ?? previous!.id)).toBe(old.environment.resolveConstructorTarget?.(previous!.targetId ?? previous!.id));
    const logic = { construct: [previous!.targetId ?? previous!.id] };
    expect(evaluate(logic, {}, current.evaluateContext)).toEqual(evaluate(logic, {}, old.evaluateContext));
    for (const entry of prepared) for (const field of entry.fields) {
      const { token: oldToken, ...before } = old.registry.getFieldIdentityByHandle(field.id)!;
      const { token: currentToken, ...after } = current.registry.getFieldIdentityByHandle(field.id)!;
      expect(after).toEqual(before);
      expect(current.registry.resolveFieldPresentation(field.id)).toEqual(old.registry.resolveFieldPresentation(field.id));
    }
  });

  test("repository operators and committed account field facets remain in the same registry", () => {
    expect(current.environment.operatorCodeName("std:add", 2)).toBe(old.environment.operatorCodeName("std:add", 2));
    expect(current.registry.getFieldIdentityByHandle(accountField)).toBeDefined();
    expect(current.registry.resolveFieldPresentation(accountField).label).toBe("My title");
    expect(old.registry.getIdentifiedEntity("Gp33AccountRecord")).toBeUndefined();
    expect(current.registry.getIdentifiedEntity("Gp33AccountRecord")).toBeDefined();
    expect(current.registry.modules.some(module => module.name === "picture")).toBe(true);
    expect(old.registry.modules.some(module => module.name === "picture")).toBe(true);
  });


  test("protected source namespace collisions retain the existing rejection", async () => {
    const text = "module authority where\nvalue = 1";
    const entry = prepareSourceModule(text, "authority", undefined, randomUUID);
    expect(() => sourceModuleRegistry([entry])).toThrow("namespace is reserved");
    await expect(buildReaderFieldRegistry("gp33", snapshot, [{ id: "collision", slug: "gp33/authority", version: "1", source: text, identity: entry.identity }])).rejects.toThrow("namespace is reserved");
  });
});
