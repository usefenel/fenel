import { describe, expect, test } from "bun:test";
import {
  isLocusCatalogReference, locusCatalogReference, locusCatalogReferenceMetadata, locusCatalogReferenceValue,
  readLocusCatalogReference, resolveLocusCatalogReference,
} from "./locus-catalog-reference";

describe("ordinary Fenel references in the catalog surface", () => {
  test("new authoring emits the canonical Ref and legacy metadata stays a read adapter", () => {
    expect(locusCatalogReference("std:negate")).toEqual({ $ref: "std:negate" });
    expect(readLocusCatalogReference({ $ref: "std:negate" })).toEqual({ id: "std:negate" });
    expect(readLocusCatalogReference({ $pin: "function", id: "std:negate", name: "Old label" }))
      .toEqual({ id: "std:negate", kind: "function", name: "Old label" });
    expect(() => locusCatalogReference("")).toThrow(/identifier/);
  });

  test("card metadata comes from the current resolver without rewriting the reference", () => {
    const value = { $ref: "std:negate" };
    const requests: unknown[] = [];
    expect(locusCatalogReferenceMetadata(value, (reference) => {
      requests.push(reference);
      return { value: { body: "definition" }, kind: "function", name: "Negate" };
    })).toEqual({ $pin: "function", id: "std:negate", name: "Negate" });
    expect(requests).toEqual([{ id: "std:negate" }]);
    expect(value).toEqual({ $ref: "std:negate" });
  });

  test("account changes and stale legacy hints cannot grant or classify a target", () => {
    const old = { $pin: "function", id: "type-id", name: "Old label" };
    expect(locusCatalogReferenceMetadata(old, () => ({ value: {}, kind: "type", name: "Current type" })))
      .toEqual({ $pin: "type", id: "type-id", name: "Current type" });
    expect(locusCatalogReferenceMetadata(old, () => undefined)).toBeUndefined();
  });

  test("ordinary records, applied types and hostile host properties are not flattened into links", () => {
    let reads = 0;
    const getter = Object.defineProperty({}, "$ref", { enumerable: true, get: () => { reads++; return "hidden"; } });
    for (const value of [null, [], {}, { $ref: "" }, { $ref: "List", args: ["String"] },
      { $ref: "x", caption: "business data" }, { $ref: "x", $pin: "function", id: "x" },
      Object.create({ $ref: "inherited" }), getter]) {
      expect(isLocusCatalogReference(value)).toBe(false);
      expect(locusCatalogReferenceMetadata(value, () => { throw new Error("Unexpected resolution"); })).toBeUndefined();
    }
    expect(reads).toBe(0);
  });

  test("the existing engine codec, evaluator and inference preserve a typed function Ref", async () => {
    const [{ exprNodeToLogic, expressionFromJsonWire, expressionToJsonWire, inferAuthoringExpression },
      { evaluate }, { stdModule }] = await Promise.all([
      import("@fenel/engine/authoring/expression"), import("@fenel/engine/expressions"), import("@fenel/engine/modules/std"),
    ]);
    const fn = stdModule.functions!.find((entry) => entry.id === "std:negate")!;
    expect(fn).toBeDefined();
    const node = { kind: "literal" as const, value: locusCatalogReference(fn.id) };
    const roundTrip = expressionFromJsonWire(expressionToJsonWire(node));
    expect(roundTrip).toEqual(node);
    const logic = exprNodeToLogic(node);
    expect(logic).toEqual(node.value);
    expect(evaluate(logic, {}, { getFunction: (id) => {
      if (id === fn.id) throw new Error("A Ref literal must not execute its referent");
      return undefined;
    } })).toEqual(node.value);
    // An admitted callable needs authoritative scheme evidence. A raw module
    // function alone cannot supply that captured registry fact.
    const inferred = inferAuthoringExpression(node, { getFunctionEntry: (id) => id === fn.id ? fn : undefined });
    expect(inferred.outcome.$tag).toBe("Invalid");
    if (inferred.outcome.$tag !== "Invalid") throw new Error("Missing callable scheme must refuse");
    expect(inferred.outcome.diagnostics[0]?.code).toBe("INFERENCE_RESOLVER_SIGNATURE_BOUNDARY");
    expect(inferred.type).toBeUndefined();
    expect(inferAuthoringExpression(node, {}).outcome.$tag).toBe("AnnotationRequired");
  }, 120_000);
});

describe("resolving a catalog reference in one account", () => {
  const fn = { id: "std:negate", params: [], returns: { $ref: "Number" } };
  const person = { $record: { fields: [] } };
  const lookups = (functions: Record<string, unknown>, entries: Record<string, object>, entities: Record<string, unknown> = {}) => ({
    fn: (id: string) => functions[id],
    entry: (id: string) => entries[id],
    entityType: (name: string) => entities[name],
  });

  test("a canonical Ref resolves a function before a type, as the engine's refType does", () => {
    const tables = lookups({ Person: fn }, { "entity:Person": { entity: { type: person } } });
    expect(resolveLocusCatalogReference({ id: "Person" }, tables)).toEqual({ value: fn, kind: "function" });
    expect(resolveLocusCatalogReference({ id: "Person" }, lookups({}, { "entity:Person": { entity: { type: person } } })))
      .toEqual({ value: person, kind: "type" });
    expect(resolveLocusCatalogReference({ id: "Missing" }, lookups({}, {}))).toBeUndefined();
  });

  test("a real callable family reopens its sole type owner while invocation stays callable", async () => {
    const [{ createRegistry }, { stdModule }] = await Promise.all([
      // C1 fixture: controlled source identity classification, no account IO.
      import("../../../../../implementations/typescript/engine/src/registry"), import("@fenel/engine/modules/std"),
    ]);
    const ownerId = "7f4e204c-0caf-4f06-994e-8f2039ddadcb";
    const type = { $tuple: [{ $var: "a" }] } as const;
    const registry = createRegistry([stdModule, { name: "typeOwnership", label: "Type ownership", entities: [{
      id: ownerId, type: { $tuple: [...type.$tuple] }, params: ["a"], typeScheme: {
        quantified: [{ id: "ownership-a", sourceName: "a", kind: { $tag: "KType" } }],
        body: { $tuple: [...type.$tuple] },
      },
    }] }], { publishCatalogEntities: false, fieldIdentity: {
      mode: "source-handles", defaultRealm: "repository-source", identityKinds: new Map([[ownerId, "type"]]),
    } });
    const context = registry.evaluateContext();
    const tables = {
      fn: (id: string) => registry.getFunction(id), entry: () => undefined,
      entityType: (id: string) => registry.getIdentifiedEntity(id)?.type,
      typeFamilyOwner: (id: string) => context._typeFamilyOwner?.(id),
    };
    expect(tables.fn(ownerId)?.id).toBe(ownerId);
    const reference = locusCatalogReferenceValue({ kind: "type", id: ownerId }, tables);
    expect(reference).toEqual({ $ref: ownerId });
    expect(locusCatalogReferenceMetadata(reference, request => resolveLocusCatalogReference(request, tables))?.$pin).toBe("type");
    expect(resolveLocusCatalogReference({ id: ownerId }, tables)).toMatchObject({ value: type, kind: "type", callable: { id: ownerId } });
    expect(resolveLocusCatalogReference({ id: ownerId, kind: "function" }, tables)?.kind).toBe("type");
    expect(tables.fn(ownerId)?.params).toHaveLength(1);
    expect(resolveLocusCatalogReference({ id: ownerId }, { ...tables, fn: () => ({ id: "different-function" }) })?.kind).toBe("function");
  }, 180_000);

  test("a legacy pin resolves only in the table its kind names", () => {
    const tables = lookups({ "std:negate": fn }, { "entity:Person": { entity: { type: person } } });
    expect(resolveLocusCatalogReference({ id: "std:negate", kind: "function" }, tables)).toEqual({ value: fn, kind: "function" });
    expect(resolveLocusCatalogReference({ id: "entity:Person", kind: "entity" }, tables)).toEqual({ value: person, kind: "entity" });
    expect(resolveLocusCatalogReference({ id: "entity:Person", kind: "function" }, tables)).toBeUndefined();
    expect(resolveLocusCatalogReference({ id: "std:negate", kind: "type" }, tables)).toBeUndefined();
  });

  test("catalog-only types resolve from their catalog row", () => {
    const color = { $record: { fields: [] } };
    const email = { $refined: { base: { $ref: "String" }, set: { kind: "email" } } };
    const tables = {
      ...lookups({}, { string: {}, "format:email": {}, color: { entity: { id: "Color" } } }, { Color: color }),
      catalogType: (id: string) => id === "string" ? { $ref: "String" } : id === "format:email" ? email : undefined,
    };
    expect(resolveLocusCatalogReference({ id: "string", kind: "type" }, tables)).toEqual({ value: { $ref: "String" }, kind: "type" });
    expect(resolveLocusCatalogReference({ id: "format:email", kind: "type" }, tables)).toEqual({ value: email, kind: "type" });
    expect(resolveLocusCatalogReference({ id: "color", kind: "entity" }, tables)).toEqual({ value: color, kind: "entity" });
    // "color" is the catalog's key for the entity `Color`: a new reference names Color.
    expect(locusCatalogReferenceValue({ kind: "entity", id: "color" }, tables)).toEqual({ $ref: "Color" });
    // An atom has no handle this account resolves canonically, so its pin stays.
    expect(locusCatalogReferenceValue({ kind: "type", id: "string" }, tables)).toEqual({ $pin: "type", id: "string", name: "string" });
  });

  test("new references are canonical only when the handle names the same referent", () => {
    const tables = lookups({ "std:negate": fn }, { "entity:Person": { entity: { type: person } } });
    expect(locusCatalogReferenceValue({ kind: "function", id: "std:negate" }, tables)).toEqual({ $ref: "std:negate" });
    expect(locusCatalogReferenceValue({ kind: "entity", id: "entity:Person" }, tables)).toEqual({ $ref: "Person" });
    // A function with the type's bare name would capture the Ref.
    const shadowed = lookups({ Person: fn }, { "entity:Person": { entity: { type: person } } });
    expect(locusCatalogReferenceValue({ kind: "entity", id: "entity:Person", name: "Person" }, shadowed))
      .toEqual({ $pin: "entity", id: "entity:Person", name: "Person" });
    // Qualified module entities, catalog-only kinds and missing targets keep the pin.
    for (const address of [{ kind: "entity", id: "entity:telegram.Animation" }, { kind: "typeclass", id: "spec:Ord" },
      { kind: "function", id: "std:missing" }]) {
      expect(locusCatalogReferenceValue(address, tables)).toEqual({ $pin: address.kind, id: address.id, name: address.id });
    }
  });
});
