import { describe, expect, test } from "bun:test";
import { prepareLocalConstructorFunctionMutations, planFieldPersistence, projectFieldOwnerMutations, type FieldPersistenceSnapshot, type FieldOwnerDefinition } from "./field-authoring";
import { projectLocalFieldRegistrySnapshot, createLocalFieldRegistry } from "./account-field-registry";
import { compileConstructorCatalogCandidates } from "./compile-field-slots";
import { evaluate } from "./json-logic";
import { normalizeFieldDeclarations } from "./field-identity";
import { marshalTraversalType, traversalHasHostileNode } from "./engine-bodies-dispatch";

const TYPE = "0d80afd1-ab25-4f02-92df-30ec085f7962";
const FUNCTION = "155f6489-8ebd-4ad2-8d45-e47f0f8d59ce";
const SECOND = "e41a1474-a274-4593-8d43-f00f4aa236c3";
const FIELD = "4ceace37-511b-4cbc-95aa-1f4a46c7f1d7";
const EMPTY: FieldPersistenceSnapshot = { owners: [], fields: [], facets: [] };
type TypeOwner = Extract<FieldOwnerDefinition, { kind: "type" }>;
const record = (): TypeOwner => ({ ownerKey: `type:${TYPE}`, kind: "type", storageName: TYPE,
  definition: { id: TYPE, type: { $record: { fields: [] } } } });
const apply = (current: FieldPersistenceSnapshot, owner: ReturnType<typeof record>, ids: string[]) => {
  const mutations = [{ kind: "upsert" as const, owner }];
  const desired = { ...current, owners: projectFieldOwnerMutations(current.owners, mutations) };
  let minted = 0;
  const prepared = prepareLocalConstructorFunctionMutations("retained-source", current, desired, mutations,
    () => { minted++; return ids.shift()!; });
  const snapshot = planFieldPersistence({ currentOwners: current.owners, currentFields: current.fields,
    currentFacets: current.facets, ownerMutations: prepared }).snapshot;
  return { snapshot, minted };
};

describe("ordinary constructor Function ownership", () => {
  test("an explicit record save owns a distinct Function and retains it through reader epochs and edits", () => {
    const saved = apply(EMPTY, record(), [FUNCTION]);
    expect(saved.minted).toBe(1);
    const type = saved.snapshot.owners.find(owner => owner.kind === "type")!;
    expect(type.definition.constructorFunction).toEqual({ $ref: FUNCTION });
    expect(saved.snapshot.owners.find(owner => owner.kind === "function")?.definition.id).toBe(FUNCTION);
    expect(FUNCTION).not.toBe(TYPE);
    const registry = createLocalFieldRegistry([], "retained-source", saved.snapshot);
    const ctor = registry.listConstructorSignatures().find(row => row.ownerName === TYPE)!;
    expect(ctor.functionId).toBe(FUNCTION);
    expect(registry.getFunction(FUNCTION)?.id).toBe(FUNCTION);
    expect(evaluate({ call: [FUNCTION] }, {}, registry.evaluateContext())).toEqual({ $tag: TYPE });
    const reopened = projectLocalFieldRegistrySnapshot("retained-source", JSON.parse(JSON.stringify(saved.snapshot)));
    const reopenedRows = compileConstructorCatalogCandidates({ identityKinds: reopened.identityKinds,
      listIdentifiedEntities: () => reopened.ownerModules.flatMap(module => module.entities ?? []) });
    expect(reopenedRows[0]?.functionId).toBe(FUNCTION);
    const edited = apply(saved.snapshot, { ...record(), definition: { ...type.definition,
      type: { $record: { fields: [{ name: "count", key: { $tag: "NamedField", ref: { $ref: FIELD } },
        type: { $ref: "Number" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }] } } } } as unknown as ReturnType<typeof record>, []);
    expect(edited.minted).toBe(0);
    expect(edited.snapshot.owners.find(owner => owner.kind === "type")?.definition.constructorFunction).toEqual({ $ref: FUNCTION });
    const projection = projectLocalFieldRegistrySnapshot("retained-source", edited.snapshot);
    expect(projection.identityKinds.get(FUNCTION)).toBe("function");
    expect(projection.identityKinds.get(TYPE)).toBe("type");
    expect(projection.identityKinds.get(FIELD)).toBe("field");
    const functionOwner = edited.snapshot.owners.find(owner => owner.kind === "function")!;
    expect(functionOwner.definition.params[0]?.key).toEqual({ $tag: "NamedField", ref: { $ref: FIELD } });
    expect(functionOwner.definition.id).toBe(FUNCTION);
  }, 60_000);

  test("type deletion follows the ordinary Function owner lifecycle and recreation mints a fresh identity", () => {
    const saved = apply(EMPTY, record(), [FUNCTION]).snapshot;
    const deletion = [{ kind: "delete" as const, ownerKey: `type:${TYPE}`, ownerKind: "type" as const, storageName: TYPE }];
    const desired = planFieldPersistence({ currentOwners: saved.owners, currentFields: saved.fields,
      currentFacets: saved.facets, ownerMutations: deletion }).snapshot;
    const mutations = prepareLocalConstructorFunctionMutations("retained-source", saved, desired, deletion,
      () => { throw Error("deletion must not mint"); });
    const deleted = planFieldPersistence({ currentOwners: saved.owners, currentFields: saved.fields,
      currentFacets: saved.facets, ownerMutations: mutations }).snapshot;
    expect(deleted.owners).toEqual([]);
    const recreated = apply(deleted, record(), [SECOND]);
    expect(recreated.minted).toBe(1);
    expect(recreated.snapshot.owners.find(owner => owner.kind === "type")?.definition.constructorFunction).toEqual({ $ref: SECOND });
    expect(recreated.snapshot.owners.some(owner => owner.definition.id === FUNCTION)).toBe(false);
  }, 60_000);

  test("a constructor parameter rename keeps its Field and Function identities", () => {
    const field = { name: "count", key: { $tag: "NamedField" as const, ref: { $ref: FIELD } },
      type: { $ref: "Number" }, label: { $tag: "Nothing" as const }, ui: { $tag: "Nothing" as const }, meta: {} };
    const owner: TypeOwner = { ...record(), definition: { id: TYPE, type: { $record: { fields: [field] } } } };
    const saved = apply(EMPTY, owner, [FUNCTION]);
    const prior = saved.snapshot.owners.find(row => row.kind === "type")!;
    const changed: TypeOwner = { ...prior, definition: { ...prior.definition, type: { $record: { fields: [{ ...field, name: "renamed" }] } } } };
    const edited = apply(saved.snapshot, changed, []);
    expect(edited.minted).toBe(0);
    expect(edited.snapshot.owners.find(row => row.kind === "type")?.definition.constructorFunction).toEqual({ $ref: FUNCTION });
    expect(edited.snapshot.owners.find(row => row.kind === "function")?.definition.params[0]?.key).toEqual(field.key);
  }, 60_000);

  test("a serialized ordinary owner bundle re-enters without a duplicate Function mutation or mint", () => {
    const saved = JSON.parse(JSON.stringify(apply(EMPTY, record(), [FUNCTION]).snapshot)) as FieldPersistenceSnapshot;
    const mutations = saved.owners.map(owner => ({ kind: "upsert" as const, owner }));
    const desired = { ...EMPTY, owners: projectFieldOwnerMutations(EMPTY.owners, mutations) };
    const prepared = prepareLocalConstructorFunctionMutations("retained-source", EMPTY, desired, mutations,
      () => { throw Error("existing constructor Function must not mint"); });
    const restored = planFieldPersistence({ currentOwners: EMPTY.owners, currentFields: EMPTY.fields,
      currentFacets: EMPTY.facets, ownerMutations: prepared }).snapshot;
    expect(restored.owners).toHaveLength(2);
    expect(restored.owners.find(owner => owner.kind === "type")?.definition.constructorFunction).toEqual({ $ref: FUNCTION });
    expect(restored.owners.find(owner => owner.kind === "function")?.definition).toEqual(saved.owners.find(owner => owner.kind === "function")?.definition);
  }, 60_000);

  test("renaming and reordering variant occurrences keeps their explicit Function Refs", () => {
    const owner = { ...record(), definition: { id: TYPE, type: { $variant: { cases: [
      { name: "First", fields: [], label: { $tag: "Nothing" } },
      { name: "Second", fields: [], label: { $tag: "Nothing" } },
    ] } } } } as unknown as ReturnType<typeof record>;
    const saved = apply(EMPTY, owner, [FUNCTION, SECOND]);
    const prior = saved.snapshot.owners.find(row => row.kind === "type")!;
    const cases = (prior.definition.type as any).$variant.cases;
    const edited = apply(saved.snapshot, { ...owner, definition: { ...prior.definition,
      type: { $variant: { cases: [{ ...cases[1], name: "Renamed" }, cases[0]] } } } } as ReturnType<typeof record>, []);
    expect(edited.minted).toBe(0);
    const projection = projectLocalFieldRegistrySnapshot("retained-source", edited.snapshot);
    const rows = compileConstructorCatalogCandidates({ identityKinds: projection.identityKinds,
      listIdentifiedEntities: () => projection.ownerModules.flatMap(module => module.entities ?? []) });
    expect(rows.map(row => [row.name, row.functionId])).toEqual([["First", FUNCTION], ["Renamed", SECOND]]);
    expect(edited.snapshot.owners.filter(row => row.kind === "function")).toHaveLength(2);
  }, 60_000);

  test("missing owners, wrong identity kinds and type identity reuse refuse without minting", () => {
    const owner = { ...record(), definition: { ...record().definition, constructorFunction: { $ref: FUNCTION } } };
    expect(() => apply(EMPTY, owner, [])).toThrow("no ordinary Function owner");
    const projection = projectLocalFieldRegistrySnapshot("retained-source", { ...EMPTY, owners: [owner] });
    expect(() => compileConstructorCatalogCandidates({ identityKinds: new Map([[FUNCTION, "field"]]),
      listIdentifiedEntities: () => projection.ownerModules.flatMap(module => module.entities ?? []) })).toThrow("ordinary Function");
    expect(() => apply(EMPTY, { ...owner, definition: { ...owner.definition, constructorFunction: { $ref: TYPE } } }, []))
      .toThrow("type identity");
    const unrelated: FieldPersistenceSnapshot = { ...EMPTY, owners: [{ kind: "function", ownerKey: `function:${FUNCTION}`,
      storageName: FUNCTION, definition: { id: FUNCTION, params: [], returns: { $ref: "String" }, body: "unrelated" } }] };
    expect(() => apply(unrelated, owner, [])).toThrow("belongs to another occurrence");
    expect(unrelated.owners[0]?.definition).toHaveProperty("body", "unrelated");
    expect(() => apply(EMPTY, record(), [TYPE])).toThrow("collided with a held identity");
    expect(() => apply(unrelated, record(), [FUNCTION])).toThrow("collided with a held identity");
    const heldField = { ...EMPTY, fields: [{ id: FIELD, currentCodeName: "count", status: "tombstoned" as const,
      realm: "account" as const, reuseVisibility: "owner" as const }] };
    expect(() => apply(heldField, record(), [FIELD])).toThrow("collided with a held identity");
    const freshField: TypeOwner = { ...record(), definition: { id: TYPE, type: { $record: { fields: [{
      name: "count", key: { $tag: "NamedField", ref: { $ref: FIELD } }, type: { $ref: "Number" },
      label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
    }] } } } };
    expect(() => apply(EMPTY, freshField, [FIELD])).toThrow("collided with a held identity");
  }, 60_000);

  test("duplicate nominal owners cannot disagree on constructor Function ownership", () => {
    const root = (id: string, variant = false) => ({ kind: "type" as const, realm: "repository-source" as const,
      entity: variant ? { id: "Example", module: "example", type: { $variant: { cases: [
        { name: "Case", constructorFunction: { $ref: id }, fields: [], label: { $tag: "Nothing" as const } },
      ] } } } : { id: "Example", module: "example", constructorFunction: { $ref: id }, type: { $record: { fields: [] } } } });
    for (const variant of [false, true]) {
      expect(() => normalizeFieldDeclarations([root(FUNCTION, variant), root(SECOND, variant)],
        { mode: "source-handles" })).toThrow("conflicting declarations");
      expect(() => normalizeFieldDeclarations([root(FUNCTION, variant), root(FUNCTION, variant)],
        { mode: "source-handles" })).not.toThrow();
    }
  }, 60_000);

  test("constructor carrier boundaries refuse accessors and decorated Refs without invoking getters", () => {
    let gets = 0;
    const variants: any[] = [
      Object.defineProperty({ name: "Case", fields: [] }, "constructorFunction", { enumerable: true, get() { gets++; return { $ref: FUNCTION }; } }),
      { name: "Case", fields: [], constructorFunction: Object.defineProperty({}, "$ref", { enumerable: true, get() { gets++; return FUNCTION; } }) },
      { name: "Case", fields: [], constructorFunction: { $ref: FUNCTION, extra: true } },
    ];
    for (const variant of variants) expect(traversalHasHostileNode(marshalTraversalType({ $variant: { cases: [variant] } }))).toBe(true);
    expect(gets).toBe(0);
    const absent = marshalTraversalType({ $variant: { cases: [{ name: "Case", fields: [], label: { $tag: "Nothing" } }] } }) as any;
    expect(absent.cases[0]).not.toHaveProperty("constructorFunction");
    const entity = { id: "Example", type: { $record: { fields: [] } }, constructorFunction: { $ref: FUNCTION, extra: true } };
    expect(() => compileConstructorCatalogCandidates({ listIdentifiedEntities: () => [entity] })).toThrow("exact own-data Ref");
  }, 60_000);
});
