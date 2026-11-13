// @ts-nocheck -- Bun UI harness executes the production metadata composition
// without mounting a browser renderer.
import { describe, expect, test } from "bun:test";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { queryFieldReuseCatalogCandidates } from "@fenel/engine/field-authoring";
import { fieldRepresentationalInterfaceNames } from "@fenel/engine/repository-field-catalog";
import { canonical } from "@fenel/engine/locale";
import { typeCode } from "@fenel/engine/authoring/expression";
import { createNewNamedFieldOccurrence, namedFieldId, namedFieldOccurrence } from "./field-occurrence/model";
import { cloneDraftValue } from "./native-draft";

await prepareEngineBodyDispatch();
const source = await Bun.file(new URL("./type-data-playground.tsx", import.meta.url)).text();
const builder = await Bun.file(new URL("./type-builder/TypeBuilder.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const start = source.indexOf("const repositoryReuseByRegistry =");
const end = source.indexOf("/** A local composition", start);
const makeClient = new Function("queryFieldReuseCatalogCandidates", "fieldRepresentationalInterfaceNames", "canonical", "typeCode", "namedFieldId",
  `${transpiler.transformSync(source.slice(start, end).replace("export function", "function"))}; return createTypePlaygroundFieldClient;`)(
    queryFieldReuseCatalogCandidates, fieldRepresentationalInterfaceNames, canonical, typeCode, namedFieldId);
const initialFrom = source.indexOf("  const sourceType = untrack(");
const initialize = new Function("props", "untrack", "cloneDraftValue",
  `${transpiler.transformSync(source.slice(initialFrom, source.indexOf("  const initialValue =", initialFrom)))}; return { sourceType, initialType };`);

describe("captured type playground definition", () => {
  test("a positively resolved UUID reference opens its record definition while preserving the original source", () => {
    const original = { $ref: "11111111-1111-4111-8111-111111111111" };
    const definition = { $record: { fields: [
      namedFieldOccurrence("22222222-2222-4222-8222-222222222222", "email"),
      namedFieldOccurrence("33333333-3333-4333-8333-333333333333", "quantity", { $ref: "Number" }),
    ] } };
    const result = initialize({ type: original, initialType: definition, session: { environment: {
      resolveTypeRef: () => { throw new Error("Do not lose the captured catalogue definition and look up its UUID by display name"); },
    } } }, fn => fn(), cloneDraftValue);
    expect(result.sourceType).toEqual(original);
    expect(result.initialType).toEqual(definition);
    expect(result.initialType.$record.fields.map(field => field.name)).toEqual(["email", "quantity"]);
    result.initialType.$record.fields.push(namedFieldOccurrence("44444444-4444-4444-8444-444444444444", "age", { $ref: "Number" }));
    expect(definition.$record.fields).toHaveLength(2);
    expect(original).toEqual({ $ref: "11111111-1111-4111-8111-111111111111" });
  });

  test("unresolved references and dependent expressions remain unchanged rather than being evaluated", () => {
    const session = { environment: { resolveTypeRef: () => undefined, resolveNamedType: () => undefined },
      evaluateContext: { evaluate: () => { throw new Error("No expression evaluation belongs in initialization"); } } };
    for (const type of [{ $ref: "missing" }, { $el: { call: ["effectful-type"] } }]) {
      const result = initialize({ type, session }, fn => fn(), cloneDraftValue);
      expect(result.sourceType).toEqual(type);
      expect(result.initialType).toEqual(type);
    }
  });
});

function metadataFixture() {
  const sourceField = namedFieldOccurrence("11111111-1111-4111-8111-111111111111", "originalName");
  const reusableField = namedFieldOccurrence("22222222-2222-4222-8222-222222222222", "reusableName");
  const accountField = namedFieldOccurrence("33333333-3333-4333-8333-333333333333", "accountName");
  const rows = new Map([
    [namedFieldId(sourceField), { realm: "repository-source", field: sourceField, ownerLookupKey: "Fixture.original" }],
    [namedFieldId(reusableField), { realm: "repository-source", field: reusableField, ownerLookupKey: "Fixture.reusable" }],
    [namedFieldId(accountField), { realm: "account-authored", field: accountField, ownerLookupKey: "Account.type" }],
  ]);
  let reuseReads = 0;
  const calls = [];
  const remoteError = new Error("Field metadata HTTP 401");
  const registry = {
    getFieldIdentityByHandle: id => rows.get(id),
    getFieldRepresentation: (name, id, realm) => {
      expect(name).toBe("Codeable");
      expect(realm).toBe("repository");
      return { methods: { codeName: id === namedFieldId(reusableField) ? "currentReusableName" : "currentOriginalName" } };
    },
    listRepositoryReusableFieldIds: () => { reuseReads++; return [namedFieldId(reusableField), namedFieldId(accountField), "absent-id"]; },
    listFieldEntities: () => { throw new Error("Local inspection must not expand the whole field inventory"); },
  };
  const inherited = {
    unrelatedRead: () => "inherited client",
    getFieldAuthoringCatalog: async () => { throw new Error("Unexpected remote catalog query"); },
    getFieldAuthoringIdentity: async id => { calls.push(id); throw remoteError; },
  };
  return { registry, inherited, calls, remoteError, sourceField, reusableField, accountField, reuseReads: () => reuseReads };
}

describe("local type playground field metadata", () => {
  test("source identities use captured positive facts without querying or expanding catalogs", async () => {
    const fixture = metadataFixture();
    const local = makeClient(fixture.registry, fixture.inherited, "detached");
    expect(fixture.reuseReads()).toBe(0);
    const result = await local.client.getFieldAuthoringIdentity(namedFieldId(fixture.sourceField));
    expect(result.field.realm).toBe("repository");
    expect(result.field.codeName).toBe("currentOriginalName");
    expect(fixture.sourceField.name).toBe("originalName");
    expect(fixture.calls).toEqual([]);
    expect(fixture.reuseReads()).toBe(0);
    expect(local.client.unrelatedRead()).toBe("inherited client");
  });

  test("only explicit newly minted fields get decided local absence; errors and durable collisions retain locks", async () => {
    const fixture = metadataFixture();
    const local = makeClient(fixture.registry, fixture.inherited, "detached");
    const fresh = createNewNamedFieldOccurrence("age", { $ref: "Number" });
    const id = namedFieldId(fresh);
    await expect(local.client.getFieldAuthoringIdentity(id)).rejects.toBe(fixture.remoteError);
    local.onFieldCreated(fresh);
    expect(await local.client.getFieldAuthoringIdentity(id)).toEqual({ field: null });
    local.onFieldCreated(fixture.sourceField);
    expect((await local.client.getFieldAuthoringIdentity(namedFieldId(fixture.sourceField))).field.realm).toBe("repository");
    local.onFieldCreated(fixture.accountField);
    await expect(local.client.getFieldAuthoringIdentity(namedFieldId(fixture.accountField))).rejects.toBe(fixture.remoteError);
    await expect(local.client.getFieldAuthoringIdentity("unknown-persisted-id")).rejects.toBe(fixture.remoteError);
    local.reset();
    await expect(local.client.getFieldAuthoringIdentity(id)).rejects.toBe(fixture.remoteError);
  });

  test("reuse search uses canonical filtering over captured reusable repository identities, cached per registry", async () => {
    const fixture = metadataFixture();
    const local = makeClient(fixture.registry, fixture.inherited, "detached");
    expect((await local.client.getFieldAuthoringCatalog("currentReusableName")).fields.map(row => row.fieldId)).toEqual([namedFieldId(fixture.reusableField)]);
    expect((await local.client.getFieldAuthoringCatalog("originalName")).fields).toEqual([]);
    expect((await local.client.getFieldAuthoringCatalog("accountName")).fields).toEqual([]);
    const second = makeClient(fixture.registry, fixture.inherited, "detached");
    expect((await second.client.getFieldAuthoringCatalog()).fields).toHaveLength(1);
    expect(fixture.reuseReads()).toBe(1);
    expect(fixture.calls).toEqual([]);
  });

  test("account and module sessions preserve their inherited authorized reuse catalog", async () => {
    const fixture = metadataFixture();
    const calls = [];
    const page = { fields: [{ fieldId: namedFieldId(fixture.accountField), codeName: "accountName", realm: "account" }], facetInterfaceNames: [] };
    fixture.inherited.getFieldAuthoringCatalog = async (search, cursor) => { calls.push({ search, cursor }); return page; };
    for (const mode of ["account", "module"]) {
      const local = makeClient(fixture.registry, fixture.inherited, mode);
      expect(await local.client.getFieldAuthoringCatalog("name", "next")).toBe(page);
      const fresh = createNewNamedFieldOccurrence("local");
      local.onFieldCreated(fresh);
      expect(await local.client.getFieldAuthoringIdentity(namedFieldId(fresh))).toEqual({ field: null });
    }
    expect(calls).toEqual([{ search: "name", cursor: "next" }, { search: "name", cursor: "next" }]);
    expect(fixture.reuseReads()).toBe(0);
  });
});

// B4 wave 4 lane S: a Local Home card's playground has a frameless session
// whose registry is a token: every member read throws.
const tokenRegistry = () => new Proxy({}, { get(_target, key) {
  if (key === "then" || typeof key === "symbol") return undefined;
  throw new Error(`LocalPageRegistryRead: ${String(key)}`);
} });
describe("a Local (frameless) playground reads no page registry", () => {
  test("identities and the reuse catalogue come from the inherited Local client; Add records without a registry probe", async () => {
    const reads = [];
    const durable = namedFieldOccurrence("55555555-5555-4555-8555-555555555555", "durable");
    const page = { fields: [{ fieldId: "local-field", codeName: "localName", realm: "local" }], facetInterfaceNames: [] };
    const inherited = {
      getFieldAuthoringCatalog: async (search, cursor) => { reads.push(["catalog", search, cursor]); return page; },
      getFieldAuthoringIdentity: async id => {
        reads.push(["identity", id]);
        if (id === namedFieldId(durable)) return { field: { fieldId: id, codeName: "durable", realm: "local" } };
        throw new Error("Unknown field");
      },
    };
    const local = makeClient(tokenRegistry(), inherited, "detached", true);
    expect(await local.client.getFieldAuthoringCatalog("name", "next")).toBe(page);
    const fresh = createNewNamedFieldOccurrence("age", { $ref: "Number" });
    await expect(local.client.getFieldAuthoringIdentity(namedFieldId(fresh))).rejects.toThrow("Unknown field");
    local.onFieldCreated(fresh);
    expect(await local.client.getFieldAuthoringIdentity(namedFieldId(fresh))).toEqual({ field: null });
    // A durable identity the client knows wins over an Add of the same id.
    local.onFieldCreated(durable);
    expect((await local.client.getFieldAuthoringIdentity(namedFieldId(durable))).field.codeName).toBe("durable");
    local.reset();
    await expect(local.client.getFieldAuthoringIdentity(namedFieldId(fresh))).rejects.toThrow("Unknown field");
    expect(reads[0]).toEqual(["catalog", "name", "next"]);
  });

  test("Check data runs in the worker for its snapshot; no worker or a replaced one refuses; undecided stays Nothing", async () => {
    const checkFrom = source.indexOf("export async function checkTypePlaygroundMembershipInWorker");
    const checkTo = source.indexOf("/** Solid/B3 catalogue composition only.", checkFrom);
    if (checkFrom < 0 || checkTo < 0) throw new Error("The worker membership check is missing.");
    const requests = [];
    let snapshot = {}, worker = { handle: true }, verdict = { $tag: "Just", _0: true };
    const check = new Function("preparedReaderWorkerForSession", "authoringWorkerSnapshot", "runPreparedReaderWorker", "typeToSetExpr",
      `${transpiler.transformSync(source.slice(checkFrom, checkTo).replace("export async function", "async function"))}; return checkTypePlaygroundMembershipInWorker;`)(
      () => worker, () => snapshot, async (selected, payload) => { requests.push({ selected, payload }); return { verdicts: [verdict] }; },
      type => ({ $tag: "SeFrom", type }));
    const session = { registry: tokenRegistry(), get evaluateContext() { throw new Error("LocalPageFrameRead"); } };
    expect(await check({ $ref: "Number" }, 3, session)).toEqual({ $tag: "Just", _0: true });
    expect(requests).toEqual([{ selected: worker, payload: { method: "check-set-membership", set: { $tag: "SeFrom", type: { $ref: "Number" } }, values: [3] } }]);
    verdict = { $tag: "Nothing" };
    expect(await check({ $ref: "Number" }, 3, session)).toEqual({ $tag: "Nothing" });
    verdict = { $tag: "Just", _0: "yes" };
    await expect(check({ $ref: "Number" }, 3, session)).rejects.toThrow("could not be read");
    verdict = { $tag: "Just", _0: false };
    const stale = check({ $ref: "Number" }, 3, session); snapshot = {};
    await expect(stale).rejects.toThrow("replaced");
    worker = undefined;
    await expect(check({ $ref: "Number" }, 3, session)).rejects.toThrow("editing tools are not ready");
  });
});

describe("canonical type-builder Add actions", () => {
  for (const [component, action, initial, publishedFields] of [
    ["RecordBody", "addField", { $record: { fields: [] } }, value => value.$record.fields],
    ["CaseRow", "addField", { name: "Case", fields: [] }, value => value.fields],
    ["ArrowBody", "addParam", { $arrow: { params: [], returns: { $unit: true } } }, value => value.$arrow.params],
  ]) {
    test(`${component} reports the same minted field before publishing it`, () => {
      const from = builder.indexOf(`function ${component}(`);
      const body = builder.slice(from, builder.indexOf("  return (", from));
      const notifications = [];
      let published;
      const props = { value: initial, onChange: value => {
        expect(notifications).toHaveLength(1);
        published = value;
      } };
      // The source body ends before JSX. Invoke its actual event handler.
      const execute = new Function("props", "useFieldAuthoringContext", "createNewNamedFieldOccurrence", "reindexPositionalTypeFields",
        `${transpiler.transformSync(body.slice(body.indexOf("}) {") + 4))}; return ${action};`);
      execute(props, () => ({ onFieldCreated: field => notifications.push(field) }), createNewNamedFieldOccurrence, fields => fields)();
      expect(publishedFields(published)[0]).toBe(notifications[0]);
      expect(namedFieldId(notifications[0])).toBeTruthy();
    });
  }
});
