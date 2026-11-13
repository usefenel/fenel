import { describe, expect, test } from "bun:test";
import type { CatalogSection, FenelType } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment, refLiteralKind, type AuthoringCatalogFunctionEntry, type AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import { evaluate } from "@fenel/engine/expressions";
import { sessionCatalogSections, projectCatalogFunctionIdentities, environmentForCatalog } from "./authoring-catalog";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import { exprNodeToLogic } from "./expr-node-codec";
import { displayFunctionName } from "./call-display";

type Entity = NonNullable<ReturnType<ModuleRegistry["getIdentifiedEntity"]>>;
const publicType: FenelType = { $variant: { cases: [{ name: "Public", fields: [], label: { $tag: "Nothing" } }] } };
const privateType: FenelType = { $variant: { cases: [{ name: "PrivateCustomer", fields: [], label: { $tag: "Nothing" } }] } };
const sections: CatalogSection[] = [{
  id: "entity", label: "Types", description: "",
  entries: [
    { id: "entity:SharedName", name: "Previous account's label", description: "Previous account's notes",
      category: "entity", entity: { id: "SharedName", type: privateType } },
    { id: "entity:PrivateOnly", name: "PrivateOnly", description: "Private account notes",
      category: "entity", entity: { id: "PrivateOnly", type: privateType } },
  ],
}, {
  id: "format", label: "Formats", description: "",
  entries: [{ id: "email", name: "Email", description: "Email address", category: "format" }],
}];

function registry(entities: Entity[]): ModuleRegistry {
  return { getIdentifiedEntity: (id: string) => entities.find((entity) => entity.id === id),
    listIdentifiedEntities: () => entities } as ModuleRegistry;
}

describe("authoring catalog reader scope", () => {
  test("a public session drops private names and replaces same-named private shapes and metadata", () => {
    const described: string[] = [];
    const projected = sessionCatalogSections(registry([{ id: "SharedName", type: publicType }]), sections,
      (id) => { described.push(id); return { name: id, description: "Repository type" }; });
    expect(projected[0]!.entries.map((entry) => entry.id)).toEqual(["entity:SharedName"]);
    expect(projected[0]!.entries[0]!.entity!.type).toBe(publicType);
    expect(projected[0]!.entries[0]!.name).toBe("SharedName");
    expect(described).toEqual(["SharedName"]);
    expect(JSON.stringify(projected)).not.toContain("Private");
    expect(JSON.stringify(projected)).not.toContain("Previous account");
    expect(projected[1]!.entries[0]).toBe(sections[1]!.entries[0]);
    expect(sections[0]!.entries[0]!.entity!.type).toBe(privateType);
    expect(sections[0]!.entries).toHaveLength(2);
  });

  test("the same source catalog retains private types only for the account registry that owns them", () => {
    const account = registry([{ id: "SharedName", type: privateType }, { id: "PrivateOnly", type: privateType }]);
    const presentation = (id: string) => ({ name: id, description: "" });
    const first = sessionCatalogSections(account, sections, presentation);
    const guest = sessionCatalogSections(registry([{ id: "SharedName", type: publicType }]), sections, presentation);
    const second = sessionCatalogSections(account, sections, presentation);
    expect(first[0]!.entries.map((entry) => entry.entity!.id)).toEqual(["SharedName", "PrivateOnly"]);
    expect(second).toEqual(first);
    expect(first[0]!.entries[0]!.entity!.type).toBe(privateType);
    expect(guest[0]!.entries[0]!.entity!.type).toBe(publicType);
    expect(guest[0]!.entries).toHaveLength(1);
  });

  test("type-family parameters come from the selected declaration, and stale parameters are removed", () => {
    const parameterized = [{ ...sections[0]!, entries: [
      { ...sections[0]!.entries[0]!, entity: { id: "SharedName", type: privateType,
        params: [{ name: "privateParameter", constraints: [] }] } },
    ] }];
    const presentation = (id: string) => ({ name: id, description: "" });
    const parametric = sessionCatalogSections(registry([{ id: "SharedName", type: publicType, params: ["a"] }]), parameterized, presentation);
    expect(parametric[0]!.entries[0]!.entity!.params).toEqual([{ name: "a", constraints: [] }]);
    const concrete = sessionCatalogSections(registry([{ id: "SharedName", type: publicType }]), parameterized, presentation);
    expect(concrete[0]!.entries[0]!.entity!.params).toBeUndefined();
  });

  test("a private reader's missing module types enter its own authoring environment without global catalogue publication", () => {
    const personId = "f7dcff34-2675-4885-8598-0b5ed7ac000c";
    const linkId = "26e6b5ba-70a0-42e5-8949-902272c360c8";
    const nothing = { $tag: "Nothing" } as const;
    const link: FenelType = { $record: { fields: [{ name: "url", type: { $ref: "UrlStr" }, label: nothing, ui: nothing, meta: {} }] } };
    const person: FenelType = { $record: { fields: [{ name: "name", type: { $ref: "String" }, label: nothing, ui: nothing, meta: {} },
      { name: "link", type: { $ref: "SocialLink" }, label: nothing, ui: nothing, meta: {} }] } };
    const entities: Entity[] = [{ id: "PublicPerson", module: "ShowcaseDemo", type: person }, { id: "SocialLink", module: "ShowcaseDemo", type: link }];
    const handles = new Map([["PublicPerson", personId], ["SocialLink", linkId]]);
    const owners = new Map([["PublicPerson", "person-owner"], [personId, "person-owner"], ["SocialLink", "link-owner"], [linkId, "link-owner"]]);
    const captured = { ...registry(entities), getUuid: (id: string) => handles.get(id),
      getEntityNominalIdentity: (id: string) => owners.get(id), getFunction: () => undefined } as unknown as ModuleRegistry;
    const empty: CatalogSection[] = [];
    const projected = sessionCatalogSections(captured, empty, id => ({ name: id, description: "Source-owned type" }));
    expect(empty).toEqual([]);
    expect(projected.flatMap(section => section.entries.map(entry => entry.id))).toEqual([`entity:${personId}`, `entity:${linkId}`]);
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot(projected));
    expect(environment.resolveNamedType?.("PublicPerson")).toEqual(person);
    expect(environment.resolveNamedType?.("SocialLink")).toEqual(link);
    expect(environment.resolveTypeRef?.({ $ref: "PublicPerson" })).toEqual(person);
    expect(environment.resolveNamedType?.("PrivateOnly")).toBeUndefined();
    expect(projected[0]!.entries[0]!.entity!.type).toBe(person);
  });

  test("missing type projection refuses ambiguous owners, mismatched UUIDs and function handles", () => {
    const candidates: Entity[] = [{ id: "Shared", module: "First", type: publicType }, { id: "Shared", module: "Second", type: privateType },
      { id: "WrongTarget", module: "First", type: publicType }, { id: "Callable", module: "First", type: publicType }];
    const captured = { ...registry(candidates), getUuid: (id: string) => `${id}-handle`,
      getEntityNominalIdentity: (id: string) => id === "WrongTarget-handle" ? "another-owner"
        : id.replace(/-handle$/, ""), getFunction: (id: string) => id === "Callable-handle" ? { id } : undefined } as unknown as ModuleRegistry;
    const projected = sessionCatalogSections(captured, [], id => ({ name: id, description: "" }));
    expect(projected).toEqual([]);
    const stale: CatalogSection[] = [{ id: "entity", label: "Types", description: "", entries: [
      { id: "entity:Shared", name: "Shared", description: "", category: "entity", entity: { id: "Shared", type: privateType } },
    ] }];
    expect(sessionCatalogSections(captured, stale, id => ({ name: id, description: "" }))[0]!.entries).toEqual([]);
  });

  test("missing parametric type metadata remains scoped to the selected reader declaration", () => {
    const handle = "f6a8ba92-94a7-4e4a-9e64-705893ac7c4e";
    const captured = { ...registry([{ id: "ReaderBox", module: "Reader", type: publicType, params: ["a"] }]),
      getUuid: () => handle, getEntityNominalIdentity: () => "reader-owner", getFunction: () => undefined } as unknown as ModuleRegistry;
    const projected = sessionCatalogSections(captured, [], id => ({ name: id, description: "" }));
    expect(projected[0]!.entries[0]!.entity!.params).toEqual([{ name: "a", constraints: [] }]);
    expect(sessionCatalogSections(registry([]), [], id => ({ name: id, description: "" }))).toEqual([]);
  });
});

describe("checked callable identity projection", () => {
  const handle = "b314488a-e3dc-4326-afa0-3b0878d1676e";
  const foreignHandle = "fe1983ca-4aed-4934-96bb-e9a4d05786d1";
  const number: FenelType = { $ref: "Number" };
  const nothing = { $tag: "Nothing" } as const;
  const params = [{ name: "x", type: number, label: nothing, ui: nothing, meta: {} }];
  const arrow: FenelType = { $arrow: { params, returns: number } };
  const entry: AuthoringCatalogFunctionEntry = { id: "formula:identity", targetId: "formula:identity",
    kind: "function", codeName: "identity", label: "Identity formula", description: "", params, returns: number,
    scheme: { quantified: [], body: arrow }, parentModule: "Formula" };
  const fn = { id: entry.id, params, returns: number, body: { var: "x" } };
  function catalog(functions: AuthoringCatalogFunctionEntry[] = [entry]): AuthoringCatalogSnapshot {
    return { types: [], functions, capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() };
  }
  function identityRegistry(uuidDeclaration = fn): ModuleRegistry {
    return { getUuid: (id: string) => id === entry.id ? handle : undefined,
      getIdentifiedFunction: (id: string) => id === entry.id ? fn : id === handle ? uuidDeclaration : undefined,
    } as unknown as ModuleRegistry;
  }
  const environment = (snapshot: AuthoringCatalogSnapshot) => createDetachedAuthoringEnvironment(createAuthoringEnvironment(snapshot));

  test("the same admitted callable resolves by UUID with its checked arrow and unchanged reference payload", () => {
    const input = catalog();
    const before = environment(input);
    expect(before.hasFunctionRefLiteral(handle)).toBe(false);
    expect(refLiteralKind({ $ref: handle }, id => before.hasFunctionRefLiteral(id))).toBe("type");
    const projected = projectCatalogFunctionIdentities(identityRegistry(), input);
    const after = environment(projected);
    expect(projected.functions).toBe(input.functions);
    expect(input.exactFunctionRoutes).toBeUndefined();
    expect(after.hasFunctionRefLiteral(handle)).toBe(true);
    expect(refLiteralKind({ $ref: handle }, id => after.hasFunctionRefLiteral(id))).toBe("function");
    expect(after.resolveTypeRef?.({ $ref: handle })).toEqual(arrow);
    expect(after.functionForRefLiteral(handle)).toMatchObject({ id: handle, params, returns: number });
    expect(displayFunctionName(after.getFunctionEntry!(handle) as AuthoringCatalogFunctionEntry)).toBe("Identity formula");
    const value = { $ref: handle };
    const logic = exprNodeToLogic({ kind: "literal", value });
    expect(logic).toEqual(value);
    const context = { getFunction: (id: string) => id === entry.id || id === handle ? fn : undefined };
    expect(evaluate({ call: [logic, 4] }, {}, context)).toBe(4);
    expect(evaluate({ call: [entry.id, 4] }, {}, context)).toBe(4);
    expect(after.hasFunctionRefLiteral("identity")).toBe(false);
    expect(after.resolveFunctionId("identity")).toBeUndefined();
    expect(after.hasFunctionRefLiteral(foreignHandle)).toBe(false);
  });

  test("a known foreign callable and a mismatched registry identity do not gain admission", () => {
    const foreign = identityRegistry();
    expect(projectCatalogFunctionIdentities(foreign, catalog([])).exactFunctionRoutes).toEqual([]);
    const mismatched = identityRegistry({ ...fn, id: "private:identity" });
    const after = environment(projectCatalogFunctionIdentities(mismatched, catalog()));
    expect(after.hasFunctionRefLiteral(handle)).toBe(false);
    expect(after.getFunctionEntry?.(handle)).toBeUndefined();
    expect(after.resolveTypeRef?.({ $ref: handle })).toBeUndefined();
    const foreignRoute = { ...catalog(), exactFunctionRoutes: [{ sourceName: foreignHandle, targetId: foreignHandle,
      status: "resolved" as const, entry: { ...entry, id: foreignHandle, targetId: foreignHandle } }] };
    expect(environment(foreignRoute).hasFunctionRefLiteral(foreignHandle)).toBe(false);
    expect(environment(foreignRoute).getFunctionEntry?.(foreignHandle)).toBeUndefined();
  });

  test("existing refused or conflicting routes stay authoritative", () => {
    for (const status of ["missing", "ambiguous", "fenced"] as const) {
      const input = { ...catalog(), exactFunctionRoutes: [{ sourceName: handle, targetId: handle, status }] };
      const projected = projectCatalogFunctionIdentities(identityRegistry(), input);
      expect(projected.exactFunctionRoutes).toEqual(input.exactFunctionRoutes);
      const after = environment(projected);
      expect(after.hasFunctionRefLiteral(handle)).toBe(false);
      expect(after.getFunctionEntry?.(handle)).toBeUndefined();
    }
    const collision = { ...catalog(), exactFunctionRoutes: [{ sourceName: handle, targetId: foreignHandle,
      status: "resolved" as const, entry: { ...entry, id: foreignHandle, targetId: foreignHandle } }] };
    const projected = projectCatalogFunctionIdentities(identityRegistry(), collision);
    expect(projected.exactFunctionRoutes).toEqual(collision.exactFunctionRoutes);
    expect(environment(projected).hasFunctionRefLiteral(handle)).toBe(false);
  });

  test("identity lookup requires no name and leaves constructor/operator selections untouched", () => {
    // No human label or Codeable spelling: the admitted identity is the fallback.
    const unnamed = { ...entry, codeName: undefined, label: "" };
    const input = catalog([unnamed, { ...entry, id: "alias:operator", notation: "+" },
      { ...entry, id: "Constructor", kind: "constructor" }]);
    const projected = projectCatalogFunctionIdentities(identityRegistry(), input);
    expect(projected.exactFunctionRoutes).toHaveLength(1);
    const after = environment(projected);
    expect(after.hasFunctionRefLiteral(handle)).toBe(true);
    const selected = after.getFunctionEntry!(handle) as AuthoringCatalogFunctionEntry;
    expect(selected.codeName).toBeUndefined();
    expect(displayFunctionName(selected)).toBe(handle);
    expect(after.resolveTypeRef?.({ $ref: handle })).toEqual(arrow);
  });

  // Preserve the original pre-label-first fixture as an unresolved case:
  // id/label = "formula:identity", targetId = handle, codeName = undefined.
  // Its old oracle expected handle; current display returns "formula:identity".
  // TODO.md tracks the naming decision; the truly unnamed case above is distinct.
  test.todo("UUID-route display when its synthesized label equals the legacy ID", () => {
    const synthesized = { ...entry, codeName: undefined, label: entry.id };
    const projected = projectCatalogFunctionIdentities(identityRegistry(), catalog([synthesized]));
    const selected = environment(projected).getFunctionEntry!(handle) as AuthoringCatalogFunctionEntry;
    expect(displayFunctionName(selected)).toBe(handle);
  });

  test("self-equal bare and legacy names cannot masquerade as identity carriers", () => {
    for (const name of ["identity", "private:identity", "not-a-uuid"]) {
      const rogue = { ...entry, id: name, targetId: name, codeName: name, parentModule: undefined };
      const input = { ...catalog(), exactFunctionRoutes: [{ sourceName: name, targetId: name,
        status: "resolved" as const, entry: rogue }] };
      expect(environment(input).hasFunctionRefLiteral(name)).toBe(false);
      expect(environment(input).getFunctionEntry?.(name)).toBeUndefined();
    }
    const bareAlias = { ...catalog(), exactFunctionRoutes: [{ sourceName: "identity", targetId: "identity",
      status: "resolved" as const, entry: { ...entry, targetId: "identity" } }] };
    expect(environment(bareAlias).hasFunctionRefLiteral("identity")).toBe(false);
    expect(environment(bareAlias).resolveFunctionId("identity")).toBeUndefined();
  });
});

describe("authoring catalog schema-reference isolation", () => {
  const originalId = "db46cba1-8a15-411c-a6a4-afef51468d69";
  const replacementId = "84f05794-4d96-4a90-978d-8d232040db6c";
  const schemaCatalog = (): AuthoringCatalogSnapshot => ({
    types: [{ id: `entity:${originalId}`, name: "SavedShape", entityId: originalId,
      description: "", category: "entity", type: { $record: { fields: [] } } }],
    functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
  });

  test("schema references keep the same captured names and identities as the owned catalogue", () => {
    const input = schemaCatalog();
    const environment = environmentForCatalog(input);
    expect(environment.resolveSchemaType?.(originalId)).toEqual({ $ref: originalId });
    expect(environment.resolveSchemaType?.("SavedShape")).toEqual({ $ref: "SavedShape" });
    expect(environment.resolveNamedType?.(originalId)).toEqual({ $record: { fields: [] } });

    input.types[0]!.entityId = replacementId;
    input.types[0]!.name = "ReplacementShape";
    expect(environment.catalog.types[0]!.entityId).toBe(originalId);
    expect(environment.catalog.types[0]!.name).toBe("SavedShape");
    expect(environment.resolveSchemaType?.(originalId)).toEqual({ $ref: originalId });
    expect(environment.resolveSchemaType?.("SavedShape")).toEqual({ $ref: "SavedShape" });
    expect(environment.resolveSchemaType?.(replacementId)).toBeUndefined();
    expect(environment.resolveSchemaType?.("ReplacementShape")).toBeUndefined();
    input.types.length = 0;
    expect(environment.resolveSchemaType?.(originalId)).toEqual({ $ref: originalId });
  });

  test("later raw catalogue accessors are not read by a captured schema reference", () => {
    const input = schemaCatalog();
    const environment = environmentForCatalog(input);
    let reads = 0;
    Object.defineProperty(input, "types", { configurable: true, get() {
      reads += 1;
      throw new Error("raw catalogue read after snapshot");
    } });
    expect(environment.resolveSchemaType?.(originalId)).toEqual({ $ref: originalId });
    expect(environment.resolveSchemaType?.("missing")).toBeUndefined();
    expect(reads).toBe(0);
  });

  test("a later environment captures its own updated catalogue without rewriting the first", () => {
    const input = schemaCatalog();
    const first = environmentForCatalog(input);
    input.types[0]!.entityId = replacementId;
    input.types[0]!.name = "ReplacementShape";
    const second = environmentForCatalog(input);
    expect(first.resolveSchemaType?.(originalId)).toEqual({ $ref: originalId });
    expect(first.resolveSchemaType?.(replacementId)).toBeUndefined();
    expect(second.resolveSchemaType?.(originalId)).toBeUndefined();
    expect(second.resolveSchemaType?.(replacementId)).toEqual({ $ref: replacementId });
    expect(second.resolveSchemaType?.("ReplacementShape")).toEqual({ $ref: "ReplacementShape" });
    expect(first.catalog.types).not.toBe(second.catalog.types);
  });
});

// Shared picker catalogue boundary controls. The two raw lookup substitutions
// are held registry replies, not claimed language admission. The class/source
// controls below use one actual source registry and its identified owners.
import { createRegistry } from "@fenel/engine/registry";
import type { FenelModule } from "@fenel/engine/types";
import type { AuthoringEnvironment, AuthoringEnvironmentOptions } from "@fenel/engine/authoring/environment";
import * as catalogOwners from "./authoring-catalog";

const pickerSourceName = "PickerCatalogueSource";
const pickerSourceModule: FenelModule = { name: pickerSourceName, label: "Picker catalogue source",
  entities: [{ id: "PickerSourceText", type: { $ref: "String" } }, { id: "PickerSourceNumber", type: { $ref: "Number" } }] };
const pickerOtherModule: FenelModule = { name: "PickerOtherSource", label: "Other source",
  entities: [{ id: "PickerOtherType", type: { $ref: "Boolean" } }] };
let pickerSourceRegistry: ModuleRegistry | undefined;
function actualPickerRegistry(): ModuleRegistry {
  // The public constructor publishes its ordinary raw catalogue by default;
  // the explicit raw section inputs below do not claim private isolation.
  return pickerSourceRegistry ??= createRegistry([pickerSourceModule, pickerOtherModule]);
}
function heldPickerRegistry(entities: Entity[], selected: Entity | undefined): ModuleRegistry {
  return { ...registry(entities), getIdentifiedEntity: () => selected,
    getUuid: () => undefined, getEntityNominalIdentity: () => undefined,
    getFunction: () => undefined } as ModuleRegistry;
}
const pickerRawSection = (id: string): CatalogSection[] => [{ id: "entity", label: "Types", description: "",
  entries: [{ id: `entity:${id}`, name: "Held stale label", description: "", category: "entity",
    entity: { id, type: privateType } }] }];
const pickerPresentation = (id: string) => ({ name: id, description: "Reader-owned" });

function compilePickerOwner<T>(source: string, result: string, bindings: Record<string, unknown>): T {
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(/^export /gm, ""));
  return new Function(...Object.keys(bindings), code + `\nreturn ${result};`)(...Object.values(bindings));
}

// This small fixture omits the full seed-module function roster
// required by getCatalog(registry). Hold only raw catalogue/presentation IO,
// retaining the exact projector, real owner guard and actual snapshot builder.
// This does not qualify full account startup or normal Local Save.
const pickerHeldRawSections: CatalogSection[] = [];
async function pickerProjectorForRawSections(raw: CatalogSection[] = pickerHeldRawSections,
  presentation = pickerPresentation): Promise<typeof catalogOwners.projectSessionCatalogTypes> {
  const source = (await Bun.file(new URL("./authoring-catalog.ts", import.meta.url)).text()).replace(/\r\n/g, "\n");
  expect(new Bun.CryptoHasher("sha256").update(source).digest("hex")).toBe("927b98706a812afd9f632b4e40e304bd47cb8c0a031112feb8f5432e9d6a27c2");
  const start = source.indexOf("export function projectSessionCatalogTypes(");
  const end = source.indexOf('/** The two "Installed module"', start);
  expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
  return compilePickerOwner<typeof catalogOwners.projectSessionCatalogTypes>(source.slice(start, end), "projectSessionCatalogTypes", {
    getCatalog: () => raw, repositoryEntityPresentation: presentation,
    sessionCatalogSections, buildSessionCatalog: catalogOwners.buildSessionCatalog,
  });
}

describe("shared picker catalogue ownership", () => {
  test("raw catalogue rows refuse a lookup substituted to another declaration id", () => {
    const owned = { id: "PickerRow", module: "Expected", type: publicType };
    const substituted = { id: "OtherDeclaration", module: "Other", type: privateType };
    const raw = pickerRawSection(owned.id);
    const result = sessionCatalogSections(heldPickerRegistry([owned], substituted), raw, pickerPresentation);
    expect(result[0]!.entries).toEqual([]);
    expect(raw[0]!.entries[0]!.entity!.id).toBe(owned.id);
  });

  test("raw catalogue rows refuse a same-id lookup from a different captured module", () => {
    const owned = { id: "PickerRow", module: "Expected", type: publicType };
    const substituted = { id: owned.id, module: "Other", type: privateType };
    expect(sessionCatalogSections(heldPickerRegistry([owned], substituted), pickerRawSection(owned.id), pickerPresentation)[0]!.entries).toEqual([]);
  });

  test("raw catalogue rows retain a unique matching owner but refuse missing and ambiguous owners", () => {
    const owned = { id: "PickerRow", module: "Expected", type: publicType };
    const raw = pickerRawSection(owned.id);
    const matching = sessionCatalogSections(heldPickerRegistry([owned], owned), raw, pickerPresentation);
    expect(matching[0]!.entries[0]!.entity!.id).toBe(owned.id);
    expect(matching[0]!.entries[0]!.entity!.type).toBe(publicType);
    expect(sessionCatalogSections(heldPickerRegistry([owned], undefined), raw, pickerPresentation)[0]!.entries).toEqual([]);
    expect(sessionCatalogSections(heldPickerRegistry([owned, { ...owned, module: "Competing" }], owned), raw, pickerPresentation)[0]!.entries).toEqual([]);
  });

  test("the actual class-only Codeable owner remains available outside the ordinary entity roster", () => {
    const captured = actualPickerRegistry();
    const codeable = captured.getIdentifiedEntity("Codeable");
    expect(codeable).toBeDefined();
    expect(codeable!.id).toBe("Codeable");
    expect(codeable!.module).toBe("system");
    expect(captured.listIdentifiedEntities().filter(entity => entity.id === "Codeable")).toEqual([]);
    const projected = sessionCatalogSections(captured, pickerRawSection("Codeable"), pickerPresentation);
    const selected = projected[0]!.entries[0]!.entity!;
    expect(selected.id).toBe(codeable!.id);
    expect(selected.type).toEqual(codeable!.type);
    expect(selected.params).toEqual(codeable!.params?.map(param => typeof param === "string" ? { name: param, constraints: [] } : param));
  }, 180_000);

  // Candidate-only additions are explicit skips on old production. The raw
  // owner reds and the actual account branch test still execute on baseline.
  const projectionTest = typeof catalogOwners.projectSessionCatalogTypes === "function" ? test : test.skip;
  projectionTest("the actual fallback producer retains installed source types without UUIDs and preserves non-type routes", async () => {
    const captured = actualPickerRegistry();
    const project = await pickerProjectorForRawSections();
    expect(captured.getUuid("PickerSourceText")).toBeUndefined();
    expect(captured.getUuid("PickerSourceNumber")).toBeUndefined();
    const input: AuthoringCatalogSnapshot = { ...buildAuthoringCatalogSnapshot(pickerRawSection("UnownedStaleType")),
      patternConstructors: [], operatorRoutes: [],
      exactFunctionRoutes: [{ sourceName: "source.kept", targetId: "kept", status: "fenced" }],
      exactConstructorRoutes: [{ sourceName: "source.ctor", targetId: "ctor", status: "missing" }],
      referenceRoutes: [{ sourceName: "source.ref", targetId: "ref", status: "ambiguous" }] };
    const projected = project(captured, input, pickerSourceName, [pickerSourceName]);
    expect(projected.types.find(row => row.entityId === "PickerSourceText")?.type).toEqual(captured.getIdentifiedEntity("PickerSourceText")!.type);
    expect(projected.types.find(row => row.entityId === "PickerSourceNumber")?.type).toEqual(captured.getIdentifiedEntity("PickerSourceNumber")!.type);
    expect(projected.types.some(row => row.entityId === "PickerOtherType" || row.entityId === "UnownedStaleType")).toBe(false);
    for (const key of ["functions", "capabilities", "patternConstructors", "operatorCodeNameByNotation", "operatorRoutes",
      "exactFunctionRoutes", "exactConstructorRoutes", "referenceRoutes"] as const) expect(projected[key]).toBe(input[key]);
    expect(input.types.some(row => row.entityId === "UnownedStaleType")).toBe(true);
    const withoutSources = project(captured, input, pickerSourceName, []);
    expect(withoutSources.types.some(row => row.entityId === "PickerSourceText")).toBe(false);
    // Explicit source ingress must not contaminate the cached ordinary view.
    const ordinarySections = sessionCatalogSections(captured, pickerHeldRawSections, pickerPresentation);
    expect(catalogOwners.buildSessionCatalog(captured, pickerSourceName, { sections: ordinarySections }).types.some(row => row.entityId === "PickerSourceText")).toBe(false);
  }, 180_000);

  projectionTest("the actual producer preserves both admitted shapes when presentation deduplicates their rows", async () => {
    const captured = actualPickerRegistry();
    const first = captured.getIdentifiedEntity("PickerSourceText")!;
    const second = captured.getIdentifiedEntity("PickerSourceNumber")!;
    const raw: CatalogSection[] = [{ id: "entity", label: "Types", description: "", entries: [first, second].map(entity => ({
      id: `entity:${entity.id}`, name: "Same authored label", description: "", category: "entity", entity: { id: entity.id, type: entity.type },
    })) }];
    // Only raw catalogue/presentation IO is held. The exact product projector,
    // owner guard and actual snapshot producer all execute without reimplementing
    // their logic or mutating a process-global catalogue/Labelable instance.
    const project = await pickerProjectorForRawSections(raw, () => ({ name: "Same authored label", description: "" }));
    const input = buildAuthoringCatalogSnapshot([]);
    const projected = project(captured, input, pickerSourceName, []);
    expect(projected.types).toHaveLength(1);
    expect(projected.types[0]!.entityId).toBe(first.id);
    expect(projected.catalogTypes).toEqual([first.type, second.type]);
    expect(projected.catalogTypes).toHaveLength(2);
    expect(projected.catalogTypes).not.toEqual(projected.types.flatMap(row => row.type ? [row.type] : []));
    expect(raw[0]!.entries).toHaveLength(2);
  }, 180_000);

  test("the actual account fallback rebuilds type lookups from guarded source rows before detaching", async () => {
    const captured = actualPickerRegistry();
    const project = typeof catalogOwners.projectSessionCatalogTypes === "function" ? await pickerProjectorForRawSections() : undefined;
    const stale = buildAuthoringCatalogSnapshot(pickerRawSection("UnownedStaleType"));
    const oldEnvironment = createAuthoringEnvironment(stale, { moduleMembers: captured });
    expect(oldEnvironment.resolveNamedType?.("UnownedStaleType")).toEqual(privateType);
    // Match sourceModuleSessionFor's actual return: it retains the original
    // construction snapshot separately from its owned environment catalogue.
    const installed = { registry: captured, sourceModule: pickerSourceName, catalog: stale, environment: oldEnvironment };
    expect(Object.getPrototypeOf(installed.catalog.operatorCodeNameByNotation)).toBe(Map.prototype);
    expect(Object.getPrototypeOf(oldEnvironment.catalog.operatorCodeNameByNotation)).not.toBe(Map.prototype);
    const prepared = [{ module: pickerSourceModule }];
    // Extraction tolerates Windows checkout CRLF; canonical raw bytes remain untouched.
    const source = (await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text()).replace(/\r\n/g, "\n");
    const branch = source.indexOf("const installed = ready");
    const afterAcquisition = source.indexOf("sourceModuleAuthoringSession(prepared, prepared[0]!.module.name);", branch);
    const start = source.indexOf("\n", afterAcquisition);
    const end = source.indexOf("\n  }\n  const session =", start);
    expect(branch).toBeGreaterThanOrEqual(0); expect(afterAcquisition).toBeGreaterThan(branch); expect(end).toBeGreaterThan(start);
    const options: AuthoringEnvironmentOptions[] = [];
    const projectedInputs: unknown[][] = [];
    type Result = { registry: ModuleRegistry; catalog: AuthoringCatalogSnapshot; environment: AuthoringEnvironment };
    const base = compilePickerOwner<Result>("let base;\n" + source.slice(start, end), "base", {
      installed, prepared, createDetachedAuthoringEnvironment,
      createAuthoringEnvironment: (snapshot: AuthoringCatalogSnapshot, supplied: AuthoringEnvironmentOptions) => {
        options.push(supplied); return createAuthoringEnvironment(snapshot, supplied);
      },
      projectSessionCatalogTypes: (...args: Parameters<typeof catalogOwners.projectSessionCatalogTypes>) => {
        if (!project) throw new Error("Candidate projector is unavailable");
        projectedInputs.push(args); return project(...args);
      },
      browserEvaluateContext: () => captured.evaluateContext(),
    });
    // Baseline returns the unchanged stale environment and fails here. A
    // visible list-only repair would also fail: these are closed-over lookups.
    expect(base.environment.resolveNamedType?.("UnownedStaleType")).toBeUndefined();
    expect(base.environment.resolveTypeRef?.({ $ref: "UnownedStaleType" })).toBeUndefined();
    expect(base.environment.resolveNamedType?.("PickerSourceText")).toEqual(captured.getIdentifiedEntity("PickerSourceText")!.type);
    expect(base.registry).toBe(captured);
    expect(base.catalog).toBe(base.environment.catalog);
    expect(base.environment).not.toBe(oldEnvironment);
    expect(oldEnvironment.resolveNamedType?.("UnownedStaleType")).toEqual(privateType);
    expect(options).toHaveLength(1);
    expect(Object.keys(options[0]!)).toEqual(["moduleMembers"]);
    expect(options[0]!.moduleMembers).toBe(captured);
    expect(projectedInputs).toHaveLength(1);
    expect(projectedInputs[0]![0]).toBe(captured);
    expect(projectedInputs[0]![1]).toBe(installed.catalog);
    expect(projectedInputs[0]![1]).not.toBe(oldEnvironment.catalog);
    expect(projectedInputs[0]!.slice(2)).toEqual([pickerSourceName, [pickerSourceName]]);
  }, 180_000);
});
