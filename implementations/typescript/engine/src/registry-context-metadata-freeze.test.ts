// C1 actual-source host controls. This deliberately imports no engine registry,
// harness, compiled owner or semantic stand-in. Full-registry acceptance stays
// with registry-authoring-nominal-projection.test.ts and the owning gates.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./registry.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const prior = readFileSync(new URL("../scripts/fixtures/registry-context-metadata-before.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`Metadata source boundary changed: ${start}`);
  return text.slice(from, to);
}
const compile = (text: string) => transpiler.transformSync(text).replace(/^export /gm, "");
const freezerBody = between(source, "const FREEZE_UNKNOWN = 0;", "/** Only the routing-table publisher")
  + between(source, "function deepFreezeRegistryValue<T>(", "type RegistryDataDefiner =");
type Freezer = { freeze(value: unknown, keys: boolean): unknown; code(value: object): number | undefined; keys(): number };
const createFreezer = new Function(compile(freezerBody) + `
  return { freeze(value, keys) { return deepFreezeRegistryValue(value, undefined, undefined, false, keys); },
    code(value) { return registryFreezeMemo().code(value); }, keys() { return bootstrapKeysFreezeNodes; } };
`) as () => Freezer;
const readers = between(source, "function ownDataProperty(", "/** Positional semantic authority");
const target = between(source, "function registryConstructorTargetId(", "/** B3: marshal a Fenel-verified constructor");
const definer = between(source, "function registryDataDefiner():", "function deepCloneRegistryValue<T>(");
const constructorBody = between(source, "  function buildConstructorTables():", "  type IdentifiedCtorField =");
const originalConstructorBody = between(prior, "  function buildConstructorTables():", "// END CONSTRUCTOR OWNER");
type Freeze = (value: unknown, seen?: unknown, memo?: unknown, shared?: boolean, keys?: boolean) => unknown;
type ConstructorTables = { constructors: Record<string, string[]>; caseOwner: Record<string, string>; constructorWireNames: Record<string, string> };
type ConstructorBuilder = (allEntities: readonly unknown[], freeze: Freeze, descriptors: boolean) => ConstructorTables;
const makeConstructorBuilder = (body: string) => new Function("allEntities", "deepFreezeRegistryValue", "bootstrapFreezeByDescriptors",
  compile(readers + target + definer + body) + "\nreturn buildConstructorTables();") as ConstructorBuilder;
const constructorOriginal = makeConstructorBuilder(originalConstructorBody);
const constructorCurrent = makeConstructorBuilder(constructorBody);
const fieldBody = between(source, "      const fieldCurrentWire: Record<string, string> = Object.create(null);", "      // Build the polymorphic-sample");
const fieldCurrentPublication = between(source, "        _fieldCurrentWire: deepFreezeRegistryValue(fieldCurrentWire,", "        // Committed legacy account bodies");
const fieldOriginalPublication = between(prior, "        _fieldCurrentWire: deepFreezeRegistryValue(fieldCurrentWire),", "// END FIELD PUBLICATION");
type FieldTables = { _fieldCurrentWire: Record<string, unknown>; _fieldCurrentWireAmbiguous: Record<string, true> };
type FieldBuilder = (fieldEntities: readonly unknown[], freeze: Freeze, exposed: boolean, descriptors: boolean) => FieldTables;
const makeFieldBuilder = (publication: string) => new Function("fieldEntities", "deepFreezeRegistryValue", "authoringNominalInputsExposed", "bootstrapFreezeByDescriptors",
  compile(fieldBody + "\nreturn {\n" + publication + "\n};")) as FieldBuilder;
const fieldOriginal = makeFieldBuilder(fieldOriginalPublication);
const fieldCurrent = makeFieldBuilder(fieldCurrentPublication);
const freezeWith = (owner: Freezer): Freeze => (value, _seen, _memo, _shared, keys = false) => owner.freeze(value, keys);

/** Complete own-key/descriptor/prototype/freeze-code graph, with node IDs so
 * every alias edge is compared in both directions, not only matching values. */
function graph(root: unknown, owner: Freezer): string {
  const ids = new Map<object, number>(), nodes: unknown[] = [];
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return [typeof value,
      typeof value === "number" && Object.is(value, -0) ? "-0" : value];
    const old = ids.get(value);
    if (old !== undefined) return ["ref", old];
    const id = nodes.length; ids.set(value, id); nodes.push(undefined);
    const prototype = Object.getPrototypeOf(value);
    const slots = Reflect.ownKeys(value).map(key => {
      const slot = Object.getOwnPropertyDescriptor(value, key)!;
      return [typeof key === "symbol" ? ["symbol", String(key)] : key, slot.enumerable, slot.configurable,
        Object.hasOwn(slot, "value") ? ["data", slot.writable, visit(slot.value)] : ["accessor", !!slot.get, !!slot.set]];
    });
    nodes[id] = { prototype: prototype === null ? "null" : prototype === Object.prototype ? "Object"
      : prototype === Array.prototype ? "Array" : "other", frozen: Object.isFrozen(value), code: owner.code(value), slots };
    return ["ref", id];
  };
  const entry = visit(root);
  return JSON.stringify({ entry, nodes });
}

function declarations(): unknown[] {
  return [
    { id: "__proto__", module: "constructor", type: { $record: { fields: [{ name: "__proto__" }, { name: "constructor" }] } } },
    { id: "Pure", module: "opaque", type: { $opaque: { pure: { $variant: { cases: [{ name: "None", fields: [] }, { name: "Some", fields: [{ name: "_0" }] }] } } } } },
    ...Array.from({ length: 48 }, (_, index) => ({ id: `Owner${index}`, module: "fixture",
      type: { $variant: { cases: [{ name: `Case${index}`, fields: [{ name: "first" }, { name: "second" }] },
        { name: "Shared", fields: [{ name: String(index) }] }] } } })),
    { id: 5, type: { $record: { fields: [] } } },
    { id: "Invalid", type: { $variant: { cases: [{ name: "Skipped", fields: [{ name: 7 }] }] } } },
  ];
}

describe("context metadata keys-only freeze", () => {
  test("three actual constructor outputs equal the retained descriptor owner, including all graph codes and aliases", () => {
    const left = createFreezer(), right = createFreezer();
    const before = constructorOriginal(declarations(), freezeWith(left), false);
    const after = constructorCurrent(declarations(), freezeWith(right), false);
    expect(graph(after, right)).toBe(graph(before, left));
    expect(after.constructors.Case0).toBe(after.constructors["@ctor/fixture/Owner0/Case0"]);
    expect(after.constructors.Shared).toEqual(["47"]);
    expect(Object.getPrototypeOf(after.constructors)).toBe(null);
    expect(left.keys()).toBe(0);
    expect(right.keys()).toBeGreaterThan(40);
  });

  test("the constructor descriptor oracle disables all three actual callsites", () => {
    const flags: unknown[] = [];
    constructorCurrent([], (value, _seen, _memo, _shared, keys) => { flags.push(keys); return value; }, true);
    expect(flags).toEqual([false, false, false]);
    const owner = createFreezer();
    constructorCurrent(declarations(), freezeWith(owner), true);
    expect(owner.keys()).toBe(0);
  });

  test("both field outputs preserve case-collision abstention and complete graph shape", () => {
    const fields = [{ id: "ABCD", currentCodeName: "first" }, { id: "abcd", currentCodeName: "second" },
      { id: "__proto__", currentCodeName: "proto" }, { id: "same", currentCodeName: "before" },
      { id: "same", currentCodeName: "after" }, { id: "", currentCodeName: "ignored" }];
    const left = createFreezer(), right = createFreezer();
    const before = fieldOriginal(fields, freezeWith(left), false, false);
    const after = fieldCurrent(fields, freezeWith(right), false, false);
    expect(graph(after, right)).toBe(graph(before, left));
    expect(Object.hasOwn(after._fieldCurrentWire, "abcd")).toBe(false);
    expect(after._fieldCurrentWireAmbiguous.abcd).toBe(true);
    expect(after._fieldCurrentWire.same).toBe("after");
    expect(Object.getPrototypeOf(after._fieldCurrentWire)).toBe(null);
    expect(Object.getPrototypeOf(after._fieldCurrentWireAmbiguous)).toBe(Object.prototype);
  });

  test.each([[false, false, true], [false, true, false], [true, false, false], [true, true, false]])(
    "actual field callsites retain exposure=%s / descriptor override=%s", (exposed, descriptors, expected) => {
      const flags: unknown[] = [];
      fieldCurrent([], (value, _seen, _memo, _shared, keys) => { flags.push(keys); return value; }, exposed, descriptors);
      expect(flags).toEqual([expected, expected]);
    });

  test("exposed mutable field getters keep the original reads, hidden descendants and freeze codes", () => {
    const execute = (builder: FieldBuilder) => {
      let reads = 0;
      const payload = { visible: "data" };
      Object.defineProperty(payload, "hidden", { value: { nested: "data" }, enumerable: false });
      const field = { id: "Captured" };
      Object.defineProperty(field, "currentCodeName", { get() { reads++; return reads <= 2 ? "checked" : payload; } });
      const owner = createFreezer();
      const value = builder([field], freezeWith(owner), true, false);
      return { reads, graph: graph(value, owner), payload, keys: owner.keys() };
    };
    const before = execute(fieldOriginal), after = execute(fieldCurrent);
    expect(after.graph).toBe(before.graph);
    expect(after.reads).toBe(3);
    expect(after.keys).toBe(0);
    expect(Object.isFrozen(Object.getOwnPropertyDescriptor(after.payload, "hidden")!.value)).toBe(true);
  });

  test("fresh field maps observe later exposed source edits and retain separate output identities", () => {
    const field = { id: "Captured", currentCodeName: "before" }, owner = createFreezer();
    const before = fieldCurrent([field], freezeWith(owner), true, false);
    field.currentCodeName = "after";
    const after = fieldCurrent([field], freezeWith(owner), true, false);
    expect(before._fieldCurrentWire.captured).toBe("before");
    expect(after._fieldCurrentWire.captured).toBe("after");
    expect(after._fieldCurrentWire).not.toBe(before._fieldCurrentWire);
    expect(after._fieldCurrentWireAmbiguous).not.toBe(before._fieldCurrentWireAmbiguous);
  });

  test("own constructor appends bypass inherited numeric setters that acquired the original array", () => {
    const build = (builder: ConstructorBuilder) => {
      const old = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let scalarSetters = 0;
      Object.defineProperty(Array.prototype, "0", { configurable: true, get() { return undefined; }, set(value: unknown) {
        Object.defineProperty(this, "0", { value, writable: true, configurable: true, enumerable: true });
        if (typeof value === "string") { scalarSetters++;
          Object.defineProperty(this, "hidden", { value: { nested: "injected" }, enumerable: false });
        }
      } });
      let result: ConstructorTables;
      const owner = createFreezer();
      try { result = builder([{ id: "Box", module: "probe", type: { $record: { fields: [{ name: "field" }] } } }], freezeWith(owner), false); }
      finally { if (old) Object.defineProperty(Array.prototype, "0", old); else delete Array.prototype[0]; }
      return { fields: result.constructors.Box!, scalarSetters };
    };
    const before = build(constructorOriginal), after = build(constructorCurrent);
    expect(before.scalarSetters).toBe(1);
    expect(Object.hasOwn(before.fields, "hidden")).toBe(true);
    expect(after.scalarSetters).toBe(0);
    expect(Reflect.ownKeys(after.fields)).toEqual(["0", "length"]);
    expect(after.fields).toEqual(["field"]);
    expect(Object.isFrozen(after.fields)).toBe(true);
  });

  test("source declaration accessors keep the same refusal without invocation", () => {
    let reads = 0;
    const entity = { id: "Bad", type: {} };
    Object.defineProperty(entity.type, "$variant", { get() { reads++; return {}; } });
    const errors = [constructorOriginal, constructorCurrent].map(builder => {
      try { builder([entity], value => value, false); return "no failure"; }
      catch (error) { return String(error); }
    });
    expect(errors[0]).toBe(errors[1]);
    expect(errors[0]).toContain('accessor property "$variant" is not allowed');
    expect(reads).toBe(0);
  });

  test("arbitrary hidden/accessor graphs are a failing keys-only premise", () => {
    const make = () => { const value = { visible: "data" };
      Object.defineProperty(value, "hidden", { value: { nested: "data" }, enumerable: false }); return value; };
    const left = createFreezer(), right = createFreezer();
    expect(graph(left.freeze(make(), false), left)).not.toBe(graph(right.freeze(make(), true), right));
  });
});
