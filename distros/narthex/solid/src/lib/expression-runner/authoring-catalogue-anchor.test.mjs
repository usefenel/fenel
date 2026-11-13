// The exact production codec/cache, isolated from registry initialization.
// A fresh external object stands for this realm's canonical binding so the
// mutation controls never modify the real engine singleton.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CATALOGUE_ANCHOR_SCHEMA, CATALOGUE_TRANSPORT_MARK, decodeCatalogueTransport } from "./authoring-catalogue-transport.ts";

const source = readFileSync(new URL("./authoring-catalogue-artifact.ts", import.meta.url), "utf8");
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`Catalogue source boundary moved: ${from}`);
  return source.slice(start, end);
};
const code = new Bun.Transpiler({ loader: "ts" }).transformSync([
  slice("const NOTHING_ANCHOR =", "export type LocalCatalogueInput"),
  slice("async function sha256Hex(", "\n// ---------------------------------------------------------------------------"),
  slice("function collectionsOf(", "/** The optional read gets"),
  slice("let realmCatalogue:", "\nconst collatedBases ="),
].join("\n").replace(/export\s+(?=(?:async\s+)?function)/g, ""));
const create = nothing => new Function("Nothing", "MARK", "CATALOGUE_ANCHOR_SCHEMA", "decodeCatalogueTransport", `${code}\nreturn {
  encodeAuthoringCatalogue, decodeAuthoringCatalogue, loadAuthoringCatalogue, realmRepositoryCatalogue, sha256Hex
};`)(nothing, CATALOGUE_TRANSPORT_MARK, CATALOGUE_ANCHOR_SCHEMA, decodeCatalogueTransport);

const fixture = () => {
  const nothing = { $tag: "Nothing" }, authored = { $tag: "Nothing" };
  const codec = create(nothing);
  const value = { catalog: { functions: [
    { id: "std:a", ui: nothing, authored }, { id: "view:b", ui: nothing, authored },
  ] }, displayCatalog: [] };
  const encoded = codec.encodeAuthoringCatalogue(value, 0);
  const texts = encoded.chunks.map(chunk => chunk.text);
  return { nothing, authored, codec, value, encoded, texts };
};

function withInheritedDescriptorValue(value, action) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  const pollution = Object.assign(Object.create(null), { value, configurable: true, writable: true });
  Object.defineProperty(Object.prototype, "value", pollution);
  try { return action(); }
  finally {
    Reflect.deleteProperty(Object.prototype, "value");
    if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
  }
}

describe("catalogue external graph anchors", () => {
  test("binds producer identity while equal authored records remain distinct", () => {
    const { nothing, codec, encoded, texts } = fixture();
    const decoded = codec.decodeAuthoringCatalogue(encoded, texts);
    const [first, second] = decoded.catalog.functions;
    expect(first.ui).toBe(nothing);
    expect(second.ui).toBe(nothing);
    expect(first.authored).not.toBe(nothing);
    expect(first.authored).toBe(second.authored);
    const ordinary = decodeCatalogueTransport(encoded, texts);
    expect(ordinary.catalog.functions[0].ui).not.toBe(nothing);
    expect(ordinary.catalog.functions[0].ui).toBe(ordinary.catalog.functions[1].ui);
    expect(ordinary.catalog.functions[0].authored).not.toBe(ordinary.catalog.functions[0].ui);
  });

  test("a single producer occurrence is anchored and joins a later Local row exactly", () => {
    const nothing = { $tag: "Nothing" }, codec = create(nothing);
    const base = { catalog: { functions: [{ id: "a", ui: nothing }] }, displayCatalog: [] };
    const encoded = codec.encodeAuthoringCatalogue(base, 0);
    const decoded = codec.decodeAuthoringCatalogue(encoded, encoded.chunks.map(chunk => chunk.text));
    const local = { id: "b", ui: nothing };
    const merged = { catalog: { functions: [...decoded.catalog.functions, local] }, displayCatalog: [] };
    const live = { catalog: { functions: [...base.catalog.functions, local] }, displayCatalog: [] };
    const wire = value => JSON.stringify(codec.encodeAuthoringCatalogue(structuredClone(value), Infinity));
    expect(wire(merged)).toBe(wire(live));
    expect(decoded.catalog.functions[0].ui).toBe(nothing);
  });

  const corruptions = {
    missing(parts, core) { delete core.anchors; },
    version(parts, core) { core.anchors.schema = "unknown"; },
    unknown(parts, core) { core.anchors.nodes[0].name = "unknown"; },
    duplicate(parts, core) { core.anchors.nodes.push({ ...core.anchors.nodes[0] }); },
    duplicateId(parts, core) { core.anchors.nodes.push({ name: "other", node: core.anchors.nodes[0].node }); },
    negative(parts, core) { core.anchors.nodes[0].node = -1; },
    absentNode(parts, core) { core.anchors.nodes[0].node = 9_999; },
    payload(parts, core) {
      const id = core.anchors.nodes[0].node;
      const entry = parts.flatMap(part => part.nodes).find(([node]) => node === id);
      entry[1] = { $tag: "Just" };
    },
    secondEnvelope(parts, core) { parts.push({ area: "other", nodes: [], items: [], anchors: structuredClone(core.anchors) }); },
    secondRoot(parts, core) { parts.push({ area: "other", nodes: [], items: [], skeleton: structuredClone(core.skeleton) }); },
    nonRootEnvelope(parts, core) {
      parts.push({ area: "other", nodes: [], items: [], anchors: core.anchors });
      delete core.anchors;
    },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) test(`refuses malformed anchor: ${name}`, () => {
    const { codec, encoded, texts } = fixture();
    const parts = texts.map(text => JSON.parse(text));
    const core = parts.find(part => part.skeleton !== undefined);
    corrupt(parts, core);
    expect(() => codec.decodeAuthoringCatalogue(encoded, parts.map(part => JSON.stringify(part)))).toThrow();
  });

  test("changing anchor provenance fails the existing core chunk integrity check", async () => {
    const { codec, encoded, texts } = fixture();
    const files = new Map(texts.map((text, index) => [`chunk-${index}`, text]));
    const index = { collections: encoded.collections, chunks: await Promise.all(texts.map(async (text, position) => ({
      file: `chunk-${position}`, sha256: await codec.sha256Hex(text),
    }))) };
    expect(await codec.loadAuthoringCatalogue(index, async file => files.get(file))).toBeDefined();
    const coreAt = texts.findIndex(text => JSON.parse(text).anchors !== undefined);
    const core = JSON.parse(texts[coreAt]);
    const original = core.anchors.nodes[0].node;
    const lookalike = texts.flatMap(text => JSON.parse(text).nodes)
      .find(([id, value]) => id !== original && JSON.stringify(value) === JSON.stringify({ $tag: "Nothing" }));
    expect(lookalike).toBeDefined();
    core.anchors.nodes[0].node = lookalike[0];
    files.set(`chunk-${coreAt}`, JSON.stringify(core));
    expect(await codec.loadAuthoringCatalogue(index, async file => files.get(file))).toBeUndefined();
  });
});

describe("catalogue anchor ownership and reuse", () => {
  test("inherited descriptor value cannot admit a changed accessor anchor or retained catalogue", async () => {
    const { nothing, codec, encoded, texts } = fixture();
    const retained = { index: encoded, result: codec.decodeAuthoringCatalogue(encoded, texts) };
    let reads = 0;
    const read = async () => { reads++; return retained; };
    expect(await codec.realmRepositoryCatalogue("polluted-anchor", read)).toBe(retained);
    let getterReads = 0, decodeError, pending;
    Object.defineProperty(nothing, "$tag", {
      enumerable: true, configurable: true, get() { getterReads++; return "invalid"; },
    });
    withInheritedDescriptorValue("Nothing", () => {
      try { codec.decodeAuthoringCatalogue(encoded, texts); } catch (error) { decodeError = error; }
      pending = codec.realmRepositoryCatalogue("polluted-anchor", read);
    });
    expect(await pending).toBeUndefined();
    expect(decodeError).toBeInstanceOf(Error);
    expect(String(decodeError)).toContain("anchor is unavailable");
    expect(getterReads).toBe(0);
    expect(reads).toBe(1);
    Object.defineProperty(nothing, "$tag", {
      value: "Nothing", enumerable: true, configurable: true, writable: true,
    });
    expect(await codec.realmRepositoryCatalogue("polluted-anchor", read)).toBe(retained);
    expect(reads).toBe(2);
  });

  test("inherited descriptor value cannot let the encoder execute an accessor", () => {
    const { codec, value } = fixture();
    let getterReads = 0, caught;
    Object.defineProperty(value.catalog.functions[0], "payload", {
      enumerable: true, get() { getterReads++; return "unexpected"; },
    });
    withInheritedDescriptorValue("Nothing", () => {
      try { codec.encodeAuthoringCatalogue(value, 0); } catch (error) { caught = error; }
    });
    expect(getterReads).toBe(0);
    expect(caught).toBeInstanceOf(TypeError);
    expect(String(caught)).toContain("refuses accessors");
  });

  test("does not freeze the external object and revalidates an already retained base", async () => {
    const { nothing, codec, encoded, texts } = fixture();
    const value = { index: {}, result: codec.decodeAuthoringCatalogue(encoded, texts) };
    let reads = 0;
    const read = async () => { reads++; return value; };
    const descriptors = Object.getOwnPropertyDescriptors(nothing);
    expect(await codec.realmRepositoryCatalogue("key", read)).toBe(value);
    expect(Object.isFrozen(value.result.catalog.functions[0])).toBe(true);
    expect(Object.getOwnPropertyDescriptors(nothing)).toEqual(descriptors);
    expect(Object.isExtensible(nothing)).toBe(true);
    nothing.extra = true;
    expect(await codec.realmRepositoryCatalogue("key", read)).toBeUndefined();
    expect(reads).toBe(1);
    delete nothing.extra;
    expect(await codec.realmRepositoryCatalogue("key", read)).toBe(value);
    expect(reads).toBe(2);
  });

  test("revalidates after an asynchronous read without freezing an invalid result", async () => {
    const { nothing, codec, encoded, texts } = fixture();
    const value = { index: {}, result: codec.decodeAuthoringCatalogue(encoded, texts) };
    let finish;
    const pending = codec.realmRepositoryCatalogue("key", () => new Promise(resolve => { finish = resolve; }));
    nothing.$tag = "Just";
    finish(value);
    expect(await pending).toBeUndefined();
    expect(Object.isFrozen(value.result)).toBe(false);
  });

  test("refuses a changed external accessor, prototype or key set without executing getters", async () => {
    const { nothing, codec, encoded, texts } = fixture();
    let gets = 0;
    Object.defineProperty(nothing, "$tag", { get() { gets++; return "Nothing"; }, enumerable: true, configurable: true });
    expect(() => codec.decodeAuthoringCatalogue(encoded, texts)).toThrow();
    expect(await codec.realmRepositoryCatalogue("key", async () => ({}))).toBeUndefined();
    expect(gets).toBe(0);
    Object.defineProperty(nothing, "$tag", { value: "Nothing", enumerable: true, configurable: true, writable: true });
    Object.setPrototypeOf(nothing, null);
    expect(() => codec.decodeAuthoringCatalogue(encoded, texts)).toThrow();
    Object.setPrototypeOf(nothing, Object.prototype);
    nothing[Symbol("extra")] = true;
    expect(() => codec.decodeAuthoringCatalogue(encoded, texts)).toThrow();
  });
});
