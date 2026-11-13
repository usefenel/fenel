// A Local slot typed by an exact reference to an identified declaration (a
// picked std type such as Phone is its UUID handle) must see through that
// reference for its widget capability and its shown caption, as a slot typed
// by the declaration's name does. These run the actual source regions of the
// expression editor (`index.tsx`) with stub readers; `inlineWidgetFor` and the
// authoring environment are the real ones.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/expression-runner/local-slot-capability.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createAuthoringEnvironment, type AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { FenelType, SetExpr } from "@fenel/engine/types";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { inlineWidgetFor } from "./inline-widgets";

const editor = (await readFile(new URL("./index.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
function region(start: string, end: string): string {
  const first = editor.indexOf(start), last = editor.indexOf(end, first);
  if (first < 0 || last <= first) throw new Error(`The editor source region moved: ${start}`);
  return editor.slice(first, last);
}
function runtime<T>(source: string, result: string, bindings: Record<string, unknown>): T {
  const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(`function fixtureRuntime() {\n${source}\nreturn ${result};\n}`);
  return new Function(...Object.keys(bindings), `${compiled}\nreturn fixtureRuntime();`)(...Object.values(bindings));
}

const PHONE_HANDLE = "f582abdc-9959-43fd-be5a-10049b855d8c";
const COUNT_HANDLE = "5d1e3c0a-0000-4000-8000-000000000001";
const phone: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:phone" } as SetExpr } };
const count: FenelType = { $refined: { base: { $ref: "Nat" }, set: { $tag: "SeInterval", interval: {
  lo: Just({ value: 2, inclusive: true }), hi: Nothing } } as SetExpr } };
// The published catalogue names declarations by entity id, never by handle.
const environment: AuthoringEnvironment = createAuthoringEnvironment({
  types: [
    { id: "String", name: "String", category: "type", description: "", type: { $ref: "String" } },
    { id: "entity:PhoneStr", name: "Phone", category: "entity", description: "", entityId: "PhoneStr", type: phone },
  ],
  functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
});

type Lookups = { entityType: (id: string) => unknown; entityOwner?: (id: string) => { id: string } | undefined };
function localReader(lookups: Lookups) {
  return { kind: "local", catalogLookups: lookups };
}
const answered: Lookups = {
  entityType: id => id === PHONE_HANDLE ? phone : id === COUNT_HANDLE ? count : undefined,
  entityOwner: id => id === PHONE_HANDLE ? { id: "PhoneStr" } : id === COUNT_HANDLE ? { id: "Count" } : undefined,
};

function widgetEnvironment(local: boolean) {
  return runtime<(session: unknown, reader: unknown) => AuthoringEnvironment>(
    region("const widgetEnvironments = new WeakMap", "/** The catalogue: a Local session's published one"),
    "editorWidgetEnvironment", { editorEnvironment: () => environment, localStructure: () => local });
}

beforeAll(() => {
  // The first engine set decision initializes its lazy runtime registry.
  inlineWidgetFor({ $ref: "String" }, "String", environment);
}, 30_000);

describe("Local exact type references", () => {
  test("the published catalogue alone cannot see through a handle (the defect)", () => {
    expect(inlineWidgetFor({ $ref: PHONE_HANDLE }, PHONE_HANDLE, environment)).toBeUndefined();
  });

  test("a String refinement referenced by handle enters as text, with its constraint", () => {
    const adapted = widgetEnvironment(true)({}, localReader(answered));
    const widget = inlineWidgetFor({ $ref: PHONE_HANDLE }, PHONE_HANDLE, adapted);
    expect(widget).toMatchObject({ kind: "field", scalarType: "string" });
    expect(widget?.type).toEqual({ $refined: { base: { $ref: "String" }, set: (phone as { $refined: { set: SetExpr } }).$refined.set } });
  });

  test("a Number refinement referenced by handle enters as a number", () => {
    const adapted = widgetEnvironment(true)({}, localReader(answered));
    expect(inlineWidgetFor({ $ref: COUNT_HANDLE }, COUNT_HANDLE, adapted)).toMatchObject({ kind: "field", scalarType: "number", seedValue: 2 });
  });

  test("a pending reference answer offers no capability, and a non-Local session is unchanged", () => {
    const pending = widgetEnvironment(true)({}, localReader({ entityType: () => undefined, entityOwner: () => undefined }));
    expect(inlineWidgetFor({ $ref: PHONE_HANDLE }, PHONE_HANDLE, pending)).toBeUndefined();
    expect(widgetEnvironment(false)({}, localReader(answered))).toBe(environment);
    expect(widgetEnvironment(true)({}, { kind: "account", catalogLookups: answered })).toBe(environment);
  });

  test("names keep resolving through the catalogue first", () => {
    const adapted = widgetEnvironment(true)({}, localReader({ entityType: () => { throw new Error("not asked"); } }));
    expect(inlineWidgetFor({ $ref: "String" }, "String", adapted)).toMatchObject({ scalarType: "string" });
    expect(inlineWidgetFor({ $ref: "PhoneStr" }, "PhoneStr", adapted)).toMatchObject({ scalarType: "string" });
  });
});

describe("Local type captions", () => {
  const caption = (local: boolean, presented: string | undefined) => runtime<(type: FenelType | undefined, session: unknown,
    reader: unknown, spelled?: string) => string | undefined>(
    region("function editorTypeCaption(", "\n/** B4 wave 4 lane E"), "editorTypeCaption", {
      localStructure: () => local,
      editorTypePhrase: (_type: FenelType, _session: unknown, _reader: unknown, fallback: boolean) => fallback ? "fallback" : presented,
      valueCardTypeLabel: (label: string | undefined) => label?.replace(/^(?:a|an)\s+/i, "").replace(/^./, c => c.toUpperCase()),
      typeNameOf: (type: FenelType) => "$ref" in type ? type.$ref : undefined,
      displayTypeLabel: () => "display",
    });

  test("a Local slot shows its worker's presentation, never the handle it is spelled by", () => {
    expect(caption(true, "Phone")({ $ref: PHONE_HANDLE }, {}, {}, PHONE_HANDLE)).toBe("Phone");
    expect(caption(true, "A person")({ $ref: "311a04cf" }, {}, {}, "311a04cf")).toBe("Person");
  });

  test("a pending presentation and other sessions keep the slot's own spelling", () => {
    expect(caption(true, undefined)({ $ref: PHONE_HANDLE }, {}, {}, PHONE_HANDLE)).toBe(PHONE_HANDLE);
    expect(caption(false, "Phone")({ $ref: "PhoneStr" }, {}, {}, "PhoneStr")).toBe("PhoneStr");
    expect(caption(false, "Phone")({ $ref: "PhoneStr" }, {}, {})).toBe("PhoneStr");
    expect(caption(true, "Phone")(undefined, {}, {})).toBeUndefined();
  });
});

describe("detached environments read an exact handle through the catalogue's identity routes", () => {
  const detachedFor = async (routes: { sourceName: string; targetId: string; status: "resolved" | "ambiguous"; handles?: string[] }[],
    extraTypes: { id: string; name: string; category: string; description: string; entityId?: string; type: FenelType }[] = []) => {
    const { createDetachedAuthoringEnvironment } = await import("./detached-authoring-environment");
    return createDetachedAuthoringEnvironment(createAuthoringEnvironment({
      types: [{ id: "entity:PhoneStr", name: "Phone", category: "entity", description: "", entityId: "PhoneStr", type: phone }, ...extraTypes],
      functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(), referenceRoutes: routes,
    }));
  };
  const route = { sourceName: "system.PhoneStr", targetId: PHONE_HANDLE, status: "resolved" as const, handles: [PHONE_HANDLE, "PhoneStr"] };

  test("a picked std refinement's UUID resolves to its declaration and enters as text", async () => {
    const detached = await detachedFor([route]);
    expect(detached.resolveTypeRef?.({ $ref: PHONE_HANDLE })).toBe(phone);
    expect(inlineWidgetFor({ $ref: PHONE_HANDLE }, PHONE_HANDLE, detached)).toMatchObject({ kind: "field", scalarType: "string" });
  });

  test("no resolved route, an unresolved route, or aliases naming different rows resolve nothing", async () => {
    expect((await detachedFor([])).resolveTypeRef?.({ $ref: PHONE_HANDLE })).toBeUndefined();
    expect((await detachedFor([{ ...route, status: "ambiguous" }])).resolveTypeRef?.({ $ref: PHONE_HANDLE })).toBeUndefined();
    const other: FenelType = { $ref: "String" };
    const split = await detachedFor([{ ...route, handles: [PHONE_HANDLE, "PhoneStr", "OtherStr"] }],
      [{ id: "entity:OtherStr", name: "Other", category: "entity", description: "", entityId: "OtherStr", type: other }]);
    expect(split.resolveTypeRef?.({ $ref: PHONE_HANDLE })).toBeUndefined();
  });
});
