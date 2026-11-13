import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";

// B4 wave 1 lane C (census unit E) parity: the Local API client's name lookups
// and instance wire, answered by the worker's handlers over the worker's own
// Local registry, equal the page's direct calls on its page registry. Both
// registries are built from the same captured snapshot by the same builder, as
// the page and the worker build them. The page side is compared RAW (never
// through the transport copy), with its own-key order, so a key-sorting or
// Date-refusing transport fails here. Heavy: two Local registries; run alone in
// the shared heavy slot.
const SOURCE = "fenel-browser-local";
const [reader, catalogue, mint, extensions, wire] = await Promise.all([
  import("../reader-registry"), import("./authoring-catalog"),
  import("../../../../../../implementations/typescript/runtime/src/authority-mint"), import("./authoring-worker-reader-extensions"),
  import("@fenel/engine/authoring/type"),
]);
const typeId = "dc3c62d2-33e9-4daf-8152-bc4080454dd7";
const blobId = "7b1f8a4e-2c55-4d0e-9c1b-3f6f0a2d9e11";
const functionId = "cab5b305-906e-41a7-a6c1-96c6d0d3a521";
const fieldId = "ee783858-9480-4b68-aefd-afdf22f7c2a8";
const noteFieldId = "0a3c5e7f-9b1d-4f2a-8c6e-1d3f5a7b9c0e";
const dataFieldId = "5e7a9c1b-3d5f-4a7c-9e1b-3d5f7a9c1e3a";
const nothing = { $tag: "Nothing" } as const;
const numberType = { $ref: "Number" };
const named = (name: string, id: string, type: object) => ({ name, key: { $tag: "NamedField", ref: { $ref: id } }, type, label: nothing, ui: nothing, meta: {} });
const parameter = named("amount", fieldId, numberType);
const field = (id: string, currentCodeName: string) => ({ id, currentCodeName, status: "live", realm: "account", reuseVisibility: "account" });
const snapshot = await reader.planLocalDefinitionBundle(SOURCE, { owners: [],
  fields: [field(fieldId, "amount"), field(noteFieldId, "note"), field(dataFieldId, "data")], facets: [] } as never, { ownerMutations: [
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${typeId}`, storageName: typeId,
    definition: { id: typeId, type: { $record: { fields: [parameter] } } } } },
  // Field order "note" before "data": a key-sorting copy reorders it.
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${blobId}`, storageName: blobId,
    definition: { id: blobId, type: { $record: { fields: [named("note", noteFieldId, { $ref: "String" }), named("data", dataFieldId, { $ref: "Bytes" })] } } } } },
  { kind: "upsert", owner: { kind: "function", ownerKey: `function:${functionId}`, storageName: functionId,
    definition: { id: functionId, params: [parameter], returns: numberType, body: { var: "amount" } } } },
] } as never);
const representations = [
  { typeName: "Labelable", args: [typeId], methods: { label: "Payment" }, scope: { kind: "tag", tag: SOURCE }, priority: 5 },
  // The tab's function is code-named "add", like the repository's std add.
  { typeName: "Codeable", args: [functionId], methods: { codeName: "add" }, scope: { kind: "tag", tag: SOURCE }, priority: 5 },
];
console.info("[instance-wire-parity] building the page and worker registries");
const page = await reader.buildLocalReaderFieldRegistry(SOURCE, snapshot, { preparation: "inline", representations: representations as never });
const workerRegistry = await reader.buildLocalReaderFieldRegistry(SOURCE, snapshot, { preparation: "inline", representations: representations as never });
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(workerRegistry), _authority: mint.mintAnonymousAuthority(workerRegistry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const session = Object.freeze({ mode: "detached", registry: workerRegistry, evaluateContext: frame }) as unknown as AuthoringSession;
console.info("[instance-wire-parity] ready");
const constructorId = page.listConstructorSignatures().find(row => row.ownerName === typeId)?.functionId;
const names = [typeId, blobId, functionId, ...(constructorId ? [constructorId] : []),
  "std.add", "std:add", "add", "Number", "String", "Bytes", "Maybe", "List", "Labelable", "missing-name", ""];
/** The reply as the page receives it: one structured clone (postMessage). */
const received = <T>(value: T) => structuredClone(value);
/** Own-key order of every object node, depth first. */
function keyOrder(value: unknown, path = "$"): string[] {
  if (!value || typeof value !== "object" || value instanceof Date || ArrayBuffer.isView(value)) return [];
  const keys = Object.keys(value);
  return [`${path}:${keys.join(",")}`, ...keys.flatMap(key => keyOrder((value as Record<string, unknown>)[key], `${path}.${key}`))];
}
const ask = (query: unknown) => extensions.runReaderExtension(query as never, session, undefined, async () => {});

describe("B4 unit E: worker answers equal the page registry's", () => {
  test("the instance editor roster and selected method type come from this reader's declarations", async () => {
    const roster = received(await ask({ method: "project-reader-instance-interfaces", priority: "guidance" })) as
      { instanceInterfaces: { $tag: "Ok"; _0: { interfaces: Array<{ iface: { name: string }; parameterNames: string[] }>; representational: string[] } } };
    expect(roster.instanceInterfaces.$tag).toBe("Ok");
    const entries = roster.instanceInterfaces._0.interfaces;
    for (const name of ["Codeable", "Labelable", "Describable", "Reprable"]) {
      const entry = entries.find(row => row.iface.name === name);
      expect(entry).toBeDefined();
      const expected = frame._specRegistry!.getClass(name);
      if (expected === undefined) throw new Error(`Missing registered interface: ${name}`);
      expect(entry!.iface).toEqual(expected);
      if (name !== "Reprable") expect(roster.instanceInterfaces._0.representational).toContain(name);
    }
    expect(entries.find(row => row.iface.name === "Reprable")!.parameterNames).toEqual(["target", "a"]);
    for (const [typeName, args] of [["Codeable", [typeId]], ["Labelable", [typeId]], ["Describable", [typeId]],
      ["Reprable", ["JsRuntime", "String"]], ["Reprable", ["JsRuntime", "Bytes"]]] as Array<[string, unknown[]]>) {
      const iface = frame._specRegistry!.getClass(typeName)!;
      const expected = wire.instanceMethodsValueType(typeName, args, workerRegistry, iface);
      const projected = received(await ask({ method: "project-reader-instance-methods-type", typeName, args, priority: "guidance" }));
      expect(projected).toEqual({ instanceMethodsType: { $tag: "Ok", _0: expected } });
      expect(keyOrder(projected)).toEqual(keyOrder({ instanceMethodsType: { $tag: "Ok", _0: expected } }));
      // RAW comparison above retains the identified field keys; a seed-only
      // record has method names but omits those identities.
      expect(projected).not.toEqual({ instanceMethodsType: { $tag: "Ok", _0: wire.instanceMethodsValueType(typeName, args, undefined, iface) } });
    }
    expect(await ask({ method: "project-reader-instance-methods-type", typeName: "not-a-class", args: [], priority: "guidance" })).toEqual({
      instanceMethodsType: { $tag: "Err", _0: "This interface is unavailable in the current reader." } });
    await expect(ask({ method: "project-reader-instance-methods-type", typeName: "Codeable", args: {}, priority: "guidance" })).rejects.toThrow("could not be read");
  });

  test("name lookups (getIdentifiedEntity, getFunction) over a corpus, including a tab name that shadows a repository one", async () => {
    expect(constructorId).toBeDefined();
    const reply = received(await ask({ method: "project-reader-references", targets: names, definitions: true })) as
      { references: Array<{ target: string; reference?: { definition?: { entity?: { id: string; type: unknown }; fn?: { id: string } } } }> };
    const answered = reply.references;
    expect(answered.map(entry => entry.target)).toEqual(names);
    let hits = 0;
    for (const [index, name] of names.entries()) {
      const definition = answered[index]!.reference?.definition;
      const entity = page.getIdentifiedEntity(name);
      const fn = page.getFunction(name);
      expect(definition?.entity).toEqual(entity === undefined ? undefined : { id: entity.id, type: entity.type });
      expect(definition?.fn).toEqual(fn);
      if (entity || fn) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(8);
    expect(answered.find(entry => entry.target === "missing-name")!.reference).toBeUndefined();
    // "add" resolves to the same function on both sides, whichever the registry selects.
    expect(answered.find(entry => entry.target === "add")!.reference?.definition?.fn?.id).toBe(page.getFunction("add")?.id);
  });

  test("instance decoding and encoding (v1 and v2) keep values, Bytes, Dates and key order", async () => {
    const drafts = [
      { typeName: "Labelable", args: [typeId], methods: { label: "Payment" }, priority: 5 },
      { typeName: "Codeable", args: [functionId], methods: { codeName: "add" } },
      { typeName: "Describable", args: [typeId], methods: { description: "A payment ∞" } },
      // A tab type: its NamedField wire names come from this registry.
      { typeName: blobId, args: [], methods: { note: "z", data: Uint8Array.of(1, 2, 255) } },
    ];
    for (const valueEncoding of ["fenel-instance-json-v1", wire.INSTANCE_JSON_ENCODING] as const) {
      const pageEncoded = drafts.map(draft => wire.instanceToJsonWire(draft, page, undefined, valueEncoding));
      const encoded = received(await ask({ method: "encode-reader-instances", instances: drafts.map(instance => ({ instance, valueEncoding })) }));
      expect(encoded).toEqual({ instances: pageEncoded });
      expect(keyOrder(encoded)).toEqual(keyOrder({ instances: pageEncoded }));
      const pageDecoded = pageEncoded.map(instance => wire.instanceFromJsonWire(instance, page, undefined, valueEncoding));
      const decoded = received(await ask({ method: "decode-reader-instances", instances: pageEncoded.map(instance => ({ instance, valueEncoding })) })) as
        { instances: Array<{ methods: Record<string, unknown> }> };
      expect(decoded).toEqual({ instances: pageDecoded });
      expect(keyOrder(decoded)).toEqual(keyOrder({ instances: pageDecoded }));
      expect(decoded.instances[3]!.methods.data).toBeInstanceOf(Uint8Array);
      expect(Object.keys(decoded.instances[3]!.methods)).toEqual(["note", "data"]);
    }
    // Raw data under an untyped key (a Date) crosses unchanged, in authored order.
    const stamped = { typeName: "Labelable", args: [typeId], methods: { label: "Seen", at: new Date(Date.UTC(2026, 9, 31)) } };
    const pageStamped = wire.instanceFromJsonWire(stamped, page);
    const decodedStamped = received(await ask({ method: "decode-reader-instances", instances: [{ instance: stamped }] })) as
      { instances: Array<{ methods: Record<string, unknown> }> };
    expect(decodedStamped).toEqual({ instances: [pageStamped] });
    expect(decodedStamped.instances[0]!.methods.at).toBeInstanceOf(Date);
    expect(Object.keys(decodedStamped.instances[0]!.methods)).toEqual(["label", "at"]);
  });
});
