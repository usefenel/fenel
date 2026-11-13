// The page structured-clones its facets preparation request to the worker,
// which drops the freezing of registry nodes. The facets marshal hands the
// kernel fresh plain data, so an inline call (frozen registry nodes) and a
// transported one (their structured clone) share one engine-body memo key.
import "./engine-body-host-install";
import { afterEach, describe, expect, test } from "bun:test";
import { __transportPlainDataForTests, tryProjectFieldFacets } from "./field-representations";
import { fieldPath, type FieldEntity, type FieldIdentity } from "./field-identity";
import { Nothing } from "./type-foundation";
import type { FieldFacetSourceDirective, IdentifiedFieldDef } from "./types";
import {
  __setEngineBodyMemoForTests,
  clearEngineBodyMemo,
  engineBodyMemoStats,
  snapshotEngineBodyArguments,
  withEngineBodyMemoPartition,
} from "./engine-body-memo";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function fixtures(): { entities: FieldEntity[]; identities: FieldIdentity[]; directives: FieldFacetSourceDirective[] } {
  const owner = deepFreeze({ $tag: "TypeFieldOwner" as const, module: { $tag: "Just" as const, _0: "demo" }, localId: "Demo" });
  const sourceField = { name: "title", type: { $ref: "String" as const }, label: Nothing, ui: Nothing, meta: {} };
  const field: IdentifiedFieldDef = { ...sourceField, key: { $tag: "NamedField", ref: { $ref: ID } } };
  const occurrence: FieldIdentity = {
    owner, path: deepFreeze([fieldPath.named("title")]), qualifiedName: "field:demo/title",
    ownerLookupKey: "field:type%3Ademo%3ADemo/", lockName: "field:demo/title", token: "root0:0",
    ingress: "ordinary-named", realm: "repository-source", declaresEntity: true, sourceField, field,
  };
  const entity: FieldEntity = { id: ID, currentCodeName: "title", occurrences: [occurrence] };
  const directive = (source: FieldFacetSourceDirective["source"]): FieldFacetSourceDirective => ({
    owner: { module: "demo", entityId: "Demo" }, selector: "title", source,
    provenance: deepFreeze({ module: "demo", declaration: "Demo", selector: "title" }),
  });
  return {
    entities: [entity], identities: [occurrence],
    directives: [directive({ kind: "label", label: "Title" }), directive({ kind: "widget", widget: "text" })],
  };
}

afterEach(() => {
  __setEngineBodyMemoForTests(null);
  clearEngineBodyMemo();
});

describe("facets preparation memo key", () => {
  test("a structured clone of the request hits the entry its inline call stored", () => {
    __setEngineBodyMemoForTests(true);
    const inline = fixtures();
    const fn = "engine:projectFieldFacets";
    const run = (request: ReturnType<typeof fixtures>) => withEngineBodyMemoPartition("local:facets-transport",
      () => tryProjectFieldFacets(request.entities, request.identities, request.directives));
    const first = run(inline);
    expect(first.ok).toBe(true);
    expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 1, computed: 1, stored: 1 });
    const transported = run(structuredClone(inline));
    expect(transported).toEqual(first);
    expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 2, computed: 1, stored: 1, hits: 1 });
  });
});

// fix-engine 2026-10-31: the marshal reproduces a structured clone's sharing
// (a node reached twice is one node; a cycle stays a cycle), so inline and
// transported keys agree and a shared node is encoded once.
describe("facets transport copy keeps sharing and cycles", () => {
  const keyOf = (value: unknown) => {
    const snapshot = snapshotEngineBodyArguments([value]);
    if (!snapshot.ok) throw new Error(snapshot.reason);
    return snapshot.key;
  };

  test("a cyclic input does not overflow and stays cyclic", () => {
    const node: Record<string, unknown> = { $tag: "Loop", label: "x" };
    node.self = node;
    const list: unknown[] = [node];
    list.push(list);
    const out = __transportPlainDataForTests({ node, list }) as { node: Record<string, unknown>; list: unknown[] };
    expect(out.node).not.toBe(node);
    expect(out.node.self).toBe(out.node);
    expect(out.list[0]).toBe(out.node);
    expect(out.list[1]).toBe(out.list);
    expect(keyOf(out)).toBe(keyOf(structuredClone({ node, list })));
  });

  test("a shared frozen owner is copied once, keyed as its structured clone and encoded once", () => {
    const owner = deepFreeze({ $tag: "TypeFieldOwner", module: { $tag: "Just", _0: "demo" }, localId: "Demo" });
    const nullPrototype = Object.assign(Object.create(null) as object, { selector: "title" });
    const value = deepFreeze({ occurrences: [{ owner, at: nullPrototype }, { owner, at: nullPrototype }] });
    const out = __transportPlainDataForTests(value) as { occurrences: Array<{ owner: object; at: object }> };
    expect(out.occurrences[0]!.owner).toBe(out.occurrences[1]!.owner);
    expect(out.occurrences[0]!.at).toBe(out.occurrences[1]!.at);
    expect(Object.isFrozen(out.occurrences[0]!.owner)).toBe(false);
    expect(Object.getPrototypeOf(out.occurrences[0]!.at)).toBe(Object.prototype);
    const key = keyOf(out);
    expect(key).toBe(keyOf(structuredClone(value)));
    expect(key).toBe(keyOf(__transportPlainDataForTests(structuredClone(value))));
    // The owner's fields appear once in the key; the second visit is a back-reference.
    expect(key.split("TypeFieldOwner").length - 1).toBe(1);
  });

  test("a shared owner across occurrences: the transported request still hits the inline entry", () => {
    __setEngineBodyMemoForTests(true);
    const inline = fixtures();
    const first = inline.identities[0]!;
    // A second field of the same owner: the owner node is shared.
    const bodyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const sourceField = { name: "body", type: { $ref: "String" as const }, label: Nothing, ui: Nothing, meta: {} };
    const second: FieldIdentity = {
      ...first, path: deepFreeze([fieldPath.named("body")]), qualifiedName: "field:demo/body", lockName: "field:demo/body",
      token: "root0:1", sourceField, field: { ...sourceField, key: { $tag: "NamedField", ref: { $ref: bodyId } } },
    };
    inline.identities.push(second);
    inline.entities.push({ id: bodyId, currentCodeName: "body", occurrences: [second] });
    expect(second.owner).toBe(first.owner);
    const fn = "engine:projectFieldFacets";
    const run = (request: ReturnType<typeof fixtures>) => withEngineBodyMemoPartition("local:facets-shared",
      () => tryProjectFieldFacets(request.entities, request.identities, request.directives));
    const firstRun = run(inline);
    expect(firstRun.ok).toBe(true);
    const transported = run(structuredClone(inline));
    expect(transported).toEqual(firstRun);
    expect(engineBodyMemoStats().byFn[fn]).toMatchObject({ calls: 2, computed: 1, stored: 1, hits: 1 });
  });
});
