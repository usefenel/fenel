import { expect, test } from "bun:test";
import { createAccountFieldRegistry, createAccountFieldRegistryAsync, createLocalFieldRegistryAsync } from "./account-field-registry";
import { FieldIdentityKernelError } from "./field-identity";
import type { FieldPersistenceSnapshot } from "./field-authoring";
import { planFieldPersistence, prepareLocalConstructorFunctionMutations } from "./field-authoring";
import { createRepositoryRegistryAsync } from "./repository-registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import { evaluate } from "./json-logic";
import { createRegistry, createRegistryAsync } from "./registry";
import { __catalogHasRegisteredEntityForTests } from "./type-catalog";
import type { FenelModule } from "./types";

const fieldId = "b225f6a1-d50d-4bdd-b3ee-b142e9226fae";
function snapshot(): FieldPersistenceSnapshot {
  return {
    owners: [{ ownerKey: "type:AsyncRecord", kind: "type", storageName: "AsyncRecord",
      definition: { id: "AsyncRecord", type: { $record: { fields: [{ name: "title",
        key: { $tag: "NamedField", ref: { $ref: fieldId } }, type: { $ref: "String" },
        label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
      }] } } } }],
    fields: [{ id: fieldId, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
    facets: [{ fieldId, typeName: "Labelable", methods: { label: "Article title" }, scope: "account", priority: 100 }],
  };
}

test("async committed registry preserves exact field, constructor and signature authority", async () => {
  const input = snapshot();
  const expected = createAccountFieldRegistry([], "async-account", input);
  let heartbeats = 0;
  const heartbeat = setInterval(() => { heartbeats++; }, 10);
  try {
    const actual = await createAccountFieldRegistryAsync([], "async-account", input);
    expect(actual.getIdentifiedEntity("AsyncRecord")).toEqual(expected.getIdentifiedEntity("AsyncRecord"));
    expect(actual.getEntityNominalIdentity("AsyncRecord")).toBe(expected.getEntityNominalIdentity("AsyncRecord"));
    expect(actual.listConstructorSignatures()).toEqual(expected.listConstructorSignatures());
    expect(actual.listFieldEntities()).toEqual(expected.listFieldEntities());
    expect(actual.resolveFieldPresentation(fieldId)).toEqual(expected.resolveFieldPresentation(fieldId));
    expect(heartbeats).toBeGreaterThan(2);
  } finally { clearInterval(heartbeat); }
}, 180_000);

test("async constructor preparation retains the captured repository Function identity and named field", async () => {
  const registry = await createRepositoryRegistryAsync([]);
  const identity = repositoryIdentityLock().get("system.Expr.ELit")!;
  expect(repositoryIdentityKinds().get(identity)).toBe("function");
  const row = registry.listConstructorSignatures().find(entry => entry.ownerName === "Expr" && entry.name === "ELit");
  expect(row?.functionId).toBe(identity);
  expect(registry.resolveModuleMember("system", "Expr", ["ELit"])).toEqual({ kind: "function", id: identity });
  expect(registry.getFunction(identity)?.id).toBe(identity);
  expect(evaluate({ call: ["system.Expr.ELit", 45] }, {}, registry.evaluateContext())).toEqual({ $tag: "ELit", value: 45 });
}, 60000);

test("async constructor preparation retains a saved local Function relation and ordinary owner", async () => {
  const typeId = "b8a590f9-4542-43b7-ae2c-662afba8cf03";
  const functionId = "831802e1-6e9e-48a9-bc02-d2c1bf979e25";
  const current: FieldPersistenceSnapshot = { owners: [], fields: [], facets: [] };
  const owner = { ownerKey: `type:${typeId}`, kind: "type" as const, storageName: typeId,
    definition: { id: typeId, type: { $record: { fields: [] } } } };
  const mutations = [{ kind: "upsert" as const, owner }];
  const prepared = prepareLocalConstructorFunctionMutations("async-constructor", current,
    { ...current, owners: [owner] }, mutations, () => functionId);
  const saved = planFieldPersistence({ currentOwners: [], currentFields: [], currentFacets: [], ownerMutations: prepared }).snapshot;
  const registry = await createLocalFieldRegistryAsync([], "async-constructor", JSON.parse(JSON.stringify(saved)));
  const row = registry.listConstructorSignatures().find(entry => entry.ownerName === typeId);
  expect(row?.functionId).toBe(functionId);
  expect(registry.getFunction(functionId)?.id).toBe(functionId);
  expect(registry.getUuid(functionId)).toBe(functionId);
  expect(evaluate({ call: [functionId] }, {}, registry.evaluateContext())).toEqual({ $tag: typeId });
}, 60000);

test("async committed registry rejects the same invalid field identity", async () => {
  const input = snapshot();
  (input.fields[0] as { status: string }).status = "tombstoned";
  let synchronous: unknown;
  try { createAccountFieldRegistry([], "async-account", input); } catch (error) { synchronous = error; }
  expect(synchronous).toBeInstanceOf(FieldIdentityKernelError);
  try {
    await createAccountFieldRegistryAsync([], "async-account", input);
    throw new Error("The invalid committed registry was accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(FieldIdentityKernelError);
    expect((error as FieldIdentityKernelError).diagnostic).toEqual((synchronous as FieldIdentityKernelError).diagnostic);
  }
}, 180_000);

test("async ingress owns definitions before yielding to caller edits", async () => {
  const input = snapshot();
  const pending = createAccountFieldRegistryAsync([], "async-account", input);
  const owner = input.owners[0]!;
  if (owner.kind === "type" && "$record" in owner.definition.type) owner.definition.type.$record.fields[0]!.name = "impostor";
  (input.fields[0] as { currentCodeName: string }).currentCodeName = "impostor";
  const actual = await pending;
  const type = actual.getIdentifiedEntity("AsyncRecord")!.type;
  expect("$record" in type && type.$record.fields[0]!.name).toBe("title");
}, 180_000);

test("async signature batches preserve complete eager results and publish no prefix", async () => {
  const entityId = "AsyncBatchPublication_Registry";
  const fixture: FenelModule = {
    name: "async-batch-publication",
    label: "Async batch publication",
    entities: [{ id: entityId, type: { $record: { fields: [] } } }],
    functions: Array.from({ length: 257 }, (_, index) => ({
      id: `async-batch-publication:value${index}`, params: [], returns: { $ref: "Number" }, body: index,
    })),
  };
  const expected = createRegistry([fixture], { publishCatalogEntities: false });
  expect(__catalogHasRegisteredEntityForTests(entityId)).toBe(false);
  let resolved = false;
  let exposedPrefix = false;
  let heartbeats = 0;
  const timer = setInterval(() => {
    heartbeats++;
    if (!resolved && __catalogHasRegisteredEntityForTests(entityId)) exposedPrefix = true;
  }, 10);
  try {
    const actual = await createRegistryAsync([fixture]).then((registry) => { resolved = true; return registry; });
    expect(heartbeats).toBeGreaterThan(2);
    expect(exposedPrefix).toBe(false);
    expect(__catalogHasRegisteredEntityForTests(entityId)).toBe(true);
    expect(actual.listFunctions()).toEqual(expected.listFunctions());
    expect(actual.listFunctions().map((fn) => actual.getFunctionSignatureInfo(fn.id)))
      .toEqual(expected.listFunctions().map((fn) => expected.getFunctionSignatureInfo(fn.id)));
    expect(actual.listConstructorSignatures()).toEqual(expected.listConstructorSignatures());
  } finally { clearInterval(timer); }
}, 180_000);
