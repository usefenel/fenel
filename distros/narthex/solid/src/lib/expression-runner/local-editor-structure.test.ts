import { describe, expect, test } from "bun:test";
import { createAuthoringEnvironment, expectedSchemeForType, type AuthoringCatalogFunctionEntry, type AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import type { FenelFunction, FenelType, FieldDef } from "@fenel/engine/types";
import { authoringStructureEnvironment, createAccountAuthoringSession, createLocalAuthoringSession, publishedAuthoringEnvironment,
  registerAuthoringSessionFacade, type AuthoringSession } from "./account-authoring-session";
import { expectedTypeForName, seedExpressionForType } from "./creation-seed";
import { constructorFieldsForTag, recordFieldsForType, typeDisplayName } from "./expr-node-codec";
import { inlineWidgetFor } from "./inline-widgets";
import { authoringExpressionLogic } from "./expression-evaluation";
import { localParameterName } from "./local-field-names";
import { parameterDisplayName } from "./call-display";

// B4 F2: a Local session publishes, when it is built, the structure
// environment the expression editor reads (seeds, fields, widgets, routes,
// entries, type names, codec names): its own environment over the worker
// catalogue without the page registry's module facts. Read through a facade
// whose registry, frame, environment and catalogue getters THROW, it answers
// exactly what the session's own environment answers; Account is unchanged.
const text: FenelType = { $ref: "String" };
const number: FenelType = { $ref: "Number" };
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const maybe = Maybe(text);
const point: FenelType = { $record: { fields: [field("x", number), field("y", number)] } };
const shape: FenelType = { $variant: { cases: [{ name: "Circle", fields: [field("_0", number)], label: Nothing },
  { name: "Dot", fields: [], label: Nothing }] } };
function constructor(owner: string, name: string, params: FieldDef[], returns: FenelType): AuthoringCatalogFunctionEntry {
  return { id: name, targetId: `@ctor/test/${owner}/${name}`, codeName: name, label: name, description: "", kind: "constructor",
    parentEntity: owner, parentModule: "test", params, returns, scheme: { quantified: [], body: { $arrow: { params, returns } } },
    signatureOutcome: { $tag: "Solved" } };
}
const area: AuthoringCatalogFunctionEntry = { id: "area", codeName: "area", label: "Area", description: "", kind: "function",
  params: [field("shape", { $ref: "Shape" })], returns: number,
  scheme: { quantified: [], body: { $arrow: { params: [field("shape", { $ref: "Shape" })], returns: number } } }, signatureOutcome: { $tag: "Solved" } };
const pageReads: string[] = [];
const pageRegistry = new Proxy({}, { get(_target, key) { pageReads.push(`registry.${String(key)}`); throw new Error("Page registry read"); } });

function baseSession(): AuthoringSession {
  const environment = createAuthoringEnvironment({
    types: [
      { id: "maybe", name: "Maybe", description: "", category: "type", entityId: "Maybe", type: maybe },
      { id: "point", name: "Point", description: "", category: "type", entityId: "Point", type: point },
      { id: "shape", name: "Shape", description: "", category: "type", entityId: "Shape", type: shape },
    ],
    functions: [constructor("Maybe", "Just", [field("_0", text)], maybe), constructor("Maybe", "Nothing", [], maybe),
      constructor("Shape", "Circle", [field("_0", number)], { $ref: "Shape" }), constructor("Shape", "Dot", [], { $ref: "Shape" }), area],
    capabilities: [], catalogTypes: [maybe, point, shape], operatorCodeNameByNotation: new Map(),
  }, { moduleMembers: pageRegistry as never });
  return Object.freeze({ mode: "detached", registry: pageRegistry as never, catalog: environment.catalog, environment,
    evaluateContext: Object.freeze({}) as never });
}
/** A facade over `session` whose page getters throw and record. */
function throwingFacade(session: AuthoringSession): AuthoringSession {
  const facade = {} as AuthoringSession;
  // `mode` is a plain session fact (the facade's tracked read), not a page read.
  Object.defineProperty(facade, "mode", { get: () => session.mode });
  for (const key of ["registry", "evaluateContext", "environment", "catalog", "sourceModule"])
    Object.defineProperty(facade, key, { get() { pageReads.push(`session.${key}`); throw new Error(`Page session ${key} read`); } });
  registerAuthoringSessionFacade(facade, () => session);
  return facade;
}
const draftFn: FenelFunction = { id: "tab:double", params: [field("n", number)], returns: number, body: { "*": [{ var: "n" }, 2] } } as FenelFunction;

describe("B4 F2: a Local session's published structure environment", () => {
  test("is the session's own environment over the worker catalogue, without the page registry's module facts", () => {
    pageReads.length = 0;
    const local = createLocalAuthoringSession(baseSession(), { sourceId: "tab", functions: [] });
    const published = publishedAuthoringEnvironment(local)!;
    expect(published).toBeDefined();
    expect(Object.isFrozen(published)).toBe(true);
    expect("moduleMembers" in published).toBe(false);
    expect(local.environment.moduleMembers).toBe(pageRegistry as never);
    expect(published.catalog).toBe(local.environment.catalog);
    expect(pageReads).toEqual([]);
  });

  test("read through a throwing page facade, it answers every structure read exactly as the session's environment", () => {
    pageReads.length = 0;
    const local = createLocalAuthoringSession(baseSession(), { sourceId: "tab", functions: [] });
    const facade = throwingFacade(local);
    const structure = authoringStructureEnvironment(facade);
    const own: AuthoringEnvironment = local.environment;
    for (const type of [point, shape, maybe, text, number, List(number), { $ref: "Point" }, { $ref: "Shape" }, { $ref: "Maybe" }] as FenelType[]) {
      expect(seedExpressionForType(type, structure)).toEqual(seedExpressionForType(type, own));
      expect(recordFieldsForType(type, structure)).toEqual(recordFieldsForType(type, own));
      expect(expectedSchemeForType(type, structure)).toEqual(expectedSchemeForType(type, own));
      expect(inlineWidgetFor(type, undefined, structure)).toEqual(inlineWidgetFor(type, undefined, own));
      expect(typeDisplayName(type, structure)).toEqual(typeDisplayName(type, own));
    }
    for (const name of ["Point", "Shape", "Maybe", "Missing"]) expect(expectedTypeForName(name, structure)).toEqual(expectedTypeForName(name, own));
    for (const tag of ["Circle", "Dot", "Just", "Nothing", "Missing"]) {
      expect(constructorFieldsForTag(tag, structure)).toEqual(constructorFieldsForTag(tag, own));
      expect(structure.resolveConstructorTarget?.(tag)).toEqual(own.resolveConstructorTarget?.(tag));
    }
    for (const id of ["area", "Circle", "@ctor/test/Shape/Circle", "missing"]) {
      expect(structure.getFunctionEntry?.(id)).toEqual(own.getFunctionEntry?.(id));
      expect(structure.resolveFunctionId(id)).toEqual(own.resolveFunctionId(id));
    }
    // Unit C's codec names (toLogic) come from it too.
    const node = { kind: "call" as const, fnId: "area", args: [{ kind: "call" as const, fnId: "@ctor/test/Shape/Circle", args: [{ kind: "literal" as const, value: 2 }] }] };
    expect(authoringExpressionLogic(node, undefined, facade)).toEqual(authoringExpressionLogic(node, undefined, local));
    expect(pageReads).toEqual([]);
  });

  test("a draft overlay publishes its draft's entry; an Account session keeps reading its own environment", () => {
    pageReads.length = 0;
    const local = createLocalAuthoringSession(baseSession(), { sourceId: "tab", functions: [draftFn] });
    const draft = createLocalAuthoringSession(local, { sourceId: "tab", functions: [draftFn], draft: { ...draftFn, returns: text } as FenelFunction });
    const structure = authoringStructureEnvironment(throwingFacade(draft));
    expect(structure.getFunctionEntry?.("tab:double")).toEqual(draft.environment.getFunctionEntry?.("tab:double"));
    expect(structure.getFunctionEntry?.("tab:double")?.returns).toEqual(text);
    expect(pageReads).toEqual([]);
    const account = createAccountAuthoringSession(baseSession(), { accountId: "acct", functions: [] });
    expect(publishedAuthoringEnvironment(account)).toBeUndefined();
    expect(() => authoringStructureEnvironment(throwingFacade(account))).toThrow("Page session environment read");
  });

  test("a parameter's Local name composes the worker's registry answer as the page composes its own", () => {
    const named = (label?: string): FieldDef => ({ name: "amount", key: { $tag: "NamedField", ref: { $ref: "field-1" } } as never,
      type: number, label: label ? { $tag: "Just", _0: label } as never : Nothing, ui: Nothing, meta: {} });
    // Without a Labelable the page reads only the Codeable fact: compared with
    // the page's own composition over such a registry.
    const registry = (code?: string) => ({
      getFieldRepresentation: (kind: string) => kind === "Codeable" && code ? { methods: { codeName: code } } : undefined,
    }) as never;
    for (const code of ["amt", undefined]) for (const field of [named(), named("Old label")])
      expect(localParameterName(field, 0, code ? { codeName: code } : {})).toEqual(parameterDisplayName(field, 0, registry(code)));
    // A label the worker resolved is shown as the page shows a resolved label.
    expect(localParameterName(named("Old label"), 0, { label: "Amount" })).toEqual({ text: "Amount", code: false });
    // Unanswered: the field's own label, else its name, as with no registry.
    expect(localParameterName(named("Shown"), 0, undefined)).toEqual({ text: "Shown", code: false });
    expect(localParameterName(named(), 0, undefined)).toEqual({ text: "amount", code: true });
  });
});

describe("B4 F2 fix round: a live trace crosses the worker boundary as data", () => {
  test("steps that cannot be structured-cloned are replaced by a visible marker; the rest pass unchanged", async () => {
    const { transferableTrace, TRACE_STEP_UNAVAILABLE } = await import("./expression-evaluation");
    const plain = { fnName: "add", op: "call", args: [1, 2], result: 3 };
    const closure = { fnName: "map", op: "call", args: [{ __fenelFn: "f", closure: () => 1 }], result: [2] };
    const trace = transferableTrace([plain, closure] as never);
    expect(() => structuredClone(trace)).not.toThrow();
    expect(trace[0] as unknown).toEqual(plain);
    expect(trace[1]).toEqual({ fnName: "map", op: "call", args: [], result: TRACE_STEP_UNAVAILABLE });
  });
});
