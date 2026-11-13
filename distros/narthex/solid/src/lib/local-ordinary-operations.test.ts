// C1/C2: closed host invocation and graph-shape tests. The registry-free
// source-owner fixture follows local-browser-synchronization.test.ts; no
// checked registry, worker, IndexedDB or reader lifetime is acquired here.
import { describe, expect, test } from "bun:test";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import type { WorkspaceModel } from "./workspace-model-loader";
import type { LocalTabData } from "./local-locus-data";
import type { WorkspacePreferences, WorkspaceLens } from "./workspace-wire";
import { assertLocalOrdinaryOperation, runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";

// GLOBAL_ONLY: literal fixture data and exact Fenel bodies; no scoped admission
// or repository identity/preparation claim is made by this source-owner test.
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [
  ["view/types.fenel", "view"], ["view/local-data.fenel", "view"], ["view/address.fenel", "view"],
  ["view/dependencies.fenel", "view"], ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"],
  ["std/native/collection-native.fenel", "std"],
]) {
  const owner = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!,
    { bootstrapParser: "typescript" });
  for (const fn of owner.functions ?? []) {
    functions.set(fn.id, fn);
    functions.set(fn.id.replace(":", "."), fn);
    functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] } };
function call<T>(name: string, ...args: unknown[]): T {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context) as T;
}
const descriptions: ReturnType<WorkspaceModel["allDataRootDescriptions"]> = [];
const model = { workspaceCall: call,
  allDataRootDescriptions: () => descriptions,
  sourceTypeReference: (owner: string, name: string) => ({ $ref: `${owner}.${name}` }),
  workspaceValueType: () => ({ $ref: "fixture.WorkspacePreferences" }),
  allDataRootTypes: () => ({ type: { $ref: "fixture.ListTarget" }, targetType: { $ref: "fixture.Target" } }),
} as unknown as WorkspaceModel;
const nothing = { $tag: "Nothing" } as const;
const rootType = { $ref: "Anything" };
const initial = () => call<LocalTabData>("tabDataWithClipboard", call("defaultLocalTabData", "fenel-browser-local"));
function ok<T>(verdict: { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string }): T {
  if (verdict.$tag !== "Ok") throw new Error(verdict._0);
  return verdict._0;
}

describe("closed Local ordinary host operations", () => {
  const invalid = [undefined, null, [], "tabDataRoot", {}, { kind: "missing", args: [] },
    { kind: "toString", args: [] }, { kind: "constructor", args: [] },
    { kind: "tabDataRoot", args: [] }, { kind: "tabDataRoot", args: [{}, {}, "extra"] },
    { kind: "tabDataValues", args: { 0: {}, length: 1 } }, { kind: "tabDataValues", args: new Array(1) },
    { kind: "workspaceValueType", args: [], contextId: 1 }, { kind: "workspaceValueType", args: [], sourceModule: "owner" },
    { kind: "publication", args: [{}, {}, { earlyTypeDescriptions: 1 }] },
    { kind: "publication", args: [{}, {}, { callableLabels: {} }] },
    { kind: "publication", args: [{}, {}, { callableLabels: [{ id: "x" }] }] },
    { kind: "publication", args: [{}, {}, { registry: {} }] },
  ];
  test.each(invalid.map((input, index) => ({ input, index })))("refuses malformed envelope $index before invoking the model", ({ input }) => {
    let calls = 0;
    const unavailable = { workspaceCall: () => { calls++; throw new Error("Model must not run"); } } as unknown as WorkspaceModel;
    expect(() => assertLocalOrdinaryOperation(input)).toThrow();
    expect(() => runLocalOrdinaryOperation(unavailable, input as LocalOrdinaryOperation)).toThrow();
    expect(calls).toBe(0);
  });

  test("refuses hidden/symbol/accessor/inherited command slots without reading getters", () => {
    let reads = 0;
    for (const input of [
      Object.assign(Object.create({ kind: "workspaceValueType" }), { args: [] }),
      Object.defineProperty({ args: [] }, "kind", { enumerable: true, get: () => { reads++; return "workspaceValueType"; } }),
      Object.defineProperty({ kind: "workspaceValueType", args: [] }, "hidden", { value: true }),
      { kind: "workspaceValueType", args: [], [Symbol("context")]: {} },
      { kind: "tabDataValues", args: Object.defineProperty([], "0", { enumerable: true, get: () => { reads++; return {}; } }) },
      { kind: "workspaceValueType", args: Object.assign([], { extra: true }) },
    ]) expect(() => assertLocalOrdinaryOperation(input)).toThrow();
    expect(reads).toBe(0);
  });

  test("keeps unknown admission data under Fenel and has no arbitrary invocation escape", () => {
    const payload = { authored: "not a tab state" };
    let captured: unknown[] | undefined;
    const direct = { workspaceCall: (name: string, ...args: unknown[]) => { captured = [name, ...args]; return { $tag: "Err", _0: "Fenel refused" }; } } as unknown as WorkspaceModel;
    const result = runLocalOrdinaryOperation(direct, { kind: "validateTabData", args: [payload] });
    expect(result).toEqual({ $tag: "Err", _0: "Fenel refused" });
    expect(captured).toEqual(["validateTabData", payload]);
    expect(captured![1]).toBe(payload);
    expect(() => assertLocalOrdinaryOperation({ kind: "workspaceCall", args: ["arbitrary"] })).toThrow();
  });

  test("refuses authored argument and callable-label array behavior without invoking it", () => {
    let effects = 0;
    const label = { id: "fn", label: "Exact label" };
    const iteratedLabels = Object.defineProperty([], Symbol.iterator, { enumerable: true,
      value: function* () { effects++; yield label; } });
    const getterLabels = Object.defineProperty([], "0", { enumerable: true,
      get: () => { effects++; return label; } });
    class AuthoredArray extends Array<unknown> {
      override [Symbol.iterator]() { effects++; return super[Symbol.iterator](); }
    }
    const subclassLabels = new AuthoredArray(label);
    const customLabels = Object.setPrototypeOf([label], { [Symbol.iterator]: function* () { effects++; yield label; } });
    const subclassArgs = new AuthoredArray("view", "Image");
    const customArgs = Object.setPrototypeOf(["view", "Image"], { [Symbol.iterator]: function* () { effects++; yield "view"; yield "Image"; } });
    const inputs = [
      ...[iteratedLabels, getterLabels, subclassLabels, customLabels].map(callableLabels =>
        ({ kind: "publication", args: [{}, {}, { callableLabels }] })),
      ...[subclassArgs, customArgs].map(args => ({ kind: "sourceTypeReference", args })),
    ];
    for (const input of inputs) {
      expect(() => assertLocalOrdinaryOperation(input)).toThrow();
      expect(effects).toBe(0);
    }
  });
});

describe("Local ordinary source-owner parity", () => {
  test("ordinary read, validation, transitions, list adapters and recovery use the actual Fenel bodies", () => {
    const state = initial();
    const operations: LocalOrdinaryOperation[] = [
      { kind: "validateTabData", args: [state] }, { kind: "defaultLocalTabData", args: [state.tabId] },
      { kind: "tabDataCheckRoot", args: [state, state.tabId] }, { kind: "tabDataCheckRoot", args: [state, "other"] },
      { kind: "tabDataWithClipboard", args: [state] },
      { kind: "applyTabDataCommands", args: [state, state.revision, [{ $tag: "TabSetLayout", layout: { kind: "grid" } }]] },
      { kind: "applyTabDataCommands", args: [state, state.revision + 1, []] },
      { kind: "tabDataRootCommand", args: [{ kind: "layout", layout: { kind: "list" } }] },
      { kind: "browserDataListCommand", args: ["list", { active: true }] },
      { kind: "tabDataRoot", args: [state, rootType] }, { kind: "tabDataValues", args: [state] },
      { kind: "tabDataValue", args: [state, "absent"] }, { kind: "tabDataRepresentationRows", args: [state, ""] },
      { kind: "tabDataMetadataTargets", args: [state] }, { kind: "browserDataList", args: [state, "absent"] },
      { kind: "browserDataActiveList", args: [state] }, { kind: "browserDataStorageSnapshot", args: [state] },
      { kind: "browserDataRestoreSnapshot", args: [state, state] }, { kind: "tabClipboardPreserved", args: [state, state] },
      { kind: "tabClipboardCopy", args: [state, "copy", "text", "String", "wire", 4, 123, "local"] },
      { kind: "tabExternalTransferCandidate", args: [{ files: [], html: "", internal: "" }] },
      { kind: "tabExternalTransferTypes", args: [[{ source: "text", value: "text", typeName: "String" }]] },
      { kind: "tabExternalTransferCommands", args: [[{ source: "text", value: "text", typeName: "String" }], ["entry"], [rootType]] },
      { kind: "dependencyMetadataRoster", args: [call("tabDataRoot", state, rootType), [], []] },
    ];
    for (const operation of operations) {
      expect(runLocalOrdinaryOperation(model, operation), operation.kind).toEqual(call(operation.kind, ...operation.args));
    }
    const validation = runLocalOrdinaryOperation(model, { kind: "applyTabDataCommands", args: [state, state.revision, []] });
    expect(ok(validation).revision).toBe(state.revision);
  });

  test("publication keeps ordinary snapshot and source identities in one graph", () => {
    const bytes = new Uint8Array([1, 3, 5]);
    const saved = { id: "saved", slug: "saved", query: { kind: "expression", expr: { kind: "literal", value: bytes } } };
    const state = { ...initial(), values: [{ id: saved.id, value: saved }] };
    const publication = runLocalOrdinaryOperation(model, { kind: "publication", args: [state, rootType,
      { callableLabels: [{ id: "fn", label: "Exact callable label" }], earlyTypeDescriptions: true }] });
    expect(publication.state).toBe(state);
    expect(publication.savedValues[0]).toBe(saved);
    expect(publication.ordinarySnapshot.values).toBe(state.values);
    expect(publication.ordinarySnapshot.entries).toBe(state.entries);
    expect(publication.savedValues[0]!.query.expr).toBe(saved.query.expr);
    expect(publication.root.typeDescriptions).toBe(descriptions);
    expect(publication.dependencyRoster).toEqual(call("dependencyMetadataRoster", publication.root, publication.savedValues,
      [{ id: "fn", label: "Exact callable label" }]));
    const plain = runLocalOrdinaryOperation(model, { kind: "publication", args: [state, rootType] });
    expect(Object.hasOwn(plain, "dependencyRoster")).toBe(false);
    expect(Object.hasOwn(plain.root, "typeDescriptions")).toBe(false);
  });

  test("preferences packet, type-sensitive presentations and address verdicts retain actual Fenel results", () => {
    const value = call<WorkspacePreferences>("workspaceDefaultForAccount", "preference-id", nothing);
    const lens = value.lenses[0]!;
    const members = [{ id: "a", name: "same", aliases: ["alias"], position: 0 },
      { id: "b", name: "same", aliases: [], position: 1 }];
    const operations: LocalOrdinaryOperation[] = [
      { kind: "validateWorkspacePreferences", args: [value] }, { kind: "applyWorkspaceCommands", args: [value, []] },
      { kind: "workspaceDefaultForAccount", args: ["preference-id", nothing] },
      { kind: "workspacePresentationCode", args: [lens.presentation] }, { kind: "workspacePresentationFromCode", args: ["table"] },
      { kind: "workspacePreferencesFromValue", args: [value] }, { kind: "workspaceReadPreferences", args: [value] },
      { kind: "workspacePreferenceEntry", args: [[{ id: "settings", value }]] },
      { kind: "workspaceBootstrapReady", args: [value, nothing, 900] },
      { kind: "workspaceActiveLens", args: [value] }, { kind: "workspaceVisibleLenses", args: [value] },
      { kind: "workspaceTilePlan", args: [value, 900] },
      { kind: "defaultWorkspaceLens", args: ["new", { $tag: "ThisTabSource" }] },
      { kind: "workspaceFocusEqual", args: [lens.focus, { $tag: "RootFocus" }] },
      { kind: "workspaceSourceEqual", args: [lens.source, { $tag: "PublicSource" }] },
      { kind: "workspaceLensWithFocus", args: [lens, { $tag: "RootFocus" }] },
      { kind: "workspaceLensWithPresentation", args: [lens, { $tag: "TablePresentation" }] },
      { kind: "workspaceLensWithPlacement", args: [lens, { $tag: "DockedPlacement" }] },
      { kind: "workspaceGroupedDisplay", args: [value] }, { kind: "workspacePresentationFor", args: [value, lens, nothing] },
      { kind: "workspaceLensShortcuts", args: [lens] }, { kind: "allDataRootTargets", args: [[{ $tag: "ThisTabSource" }]] },
      { kind: "addressMemberIndex", args: [members, "same", false] },
      { kind: "addressMemberIndex", args: [members, "alias", false] },
      { kind: "addressMemberIndex", args: [members, "2", true] },
      { kind: "addressMemberSegment", args: [members, 0, false] },
    ];
    for (const operation of operations) expect(runLocalOrdinaryOperation(model, operation), operation.kind).toEqual(call(operation.kind, ...operation.args));
    expect(runLocalOrdinaryOperation(model, { kind: "addressMemberIndex", args: [members, "same", false] }).$tag).toBe("Err");
    const bootstrap = runLocalOrdinaryOperation(model, { kind: "workspaceBootstrapReady", args: [value, nothing, 900] });
    expect(bootstrap.value).toBe(value);
    expect(bootstrap.activeLens).toEqual(call("workspaceActiveLens", value));
    const emptyLens = { ...lens, shortcuts: { $tag: "Just" as const, _0: [] } };
    const empty = { ...value, lenses: [emptyLens] };
    const publication = runLocalOrdinaryOperation(model, { kind: "workspaceRenderPublication", args: [empty, nothing, 900] });
    expect(publication.value).toBe(empty);
    expect(publication.visibleLenses[0]).toBe(emptyLens);
    expect(publication.shortcuts).toEqual([{ lensId: lens.id, shortcuts: [] }]);
    expect(runLocalOrdinaryOperation(model, { kind: "workspaceRenderPublication", args: [value, nothing, 900] }).shortcuts)
      .toEqual([{ lensId: lens.id, shortcuts: call("workspaceLensShortcuts", lens) }]);
    const preferred = { ...value, presentations: [{ $tag: "WorkspacePresentationPreference" as const,
      target: { $tag: "InhabitantsPresentationTarget" as const, typeRef: "exact-type" }, presentation: { $tag: "TablePresentation" as const } }] };
    const automatic = { ...lens, presentation: { $tag: "AutomaticPresentation" as const } } as WorkspaceLens;
    expect(runLocalOrdinaryOperation(model, { kind: "workspacePresentationFor", args: [preferred, automatic, { $tag: "Just", _0: "exact-type" }] }))
      .toEqual({ $tag: "TablePresentation" });
    expect(runLocalOrdinaryOperation(model, { kind: "workspacePresentationProjection", args: [preferred, automatic, { $tag: "Just", _0: "exact-type" }] }))
      .toEqual({ presentation: { $tag: "TablePresentation" }, code: "table" });
    expect(runLocalOrdinaryOperation(model, { kind: "workspacePresentationProjection", args: [preferred, automatic, nothing] }).code).toBe("auto");
  });

  test("identity wrappers forward supplied coordinates without acquiring a model", () => {
    expect(runLocalOrdinaryOperation(model, { kind: "sourceTypeReference", args: ["media", "Image"] })).toEqual({ $ref: "media.Image" });
    expect(runLocalOrdinaryOperation(model, { kind: "workspaceValueType", args: [] })).toEqual(model.workspaceValueType());
    expect(runLocalOrdinaryOperation(model, { kind: "allDataRootTypes", args: [] })).toEqual(model.allDataRootTypes());
    expect(runLocalOrdinaryOperation(model, { kind: "allDataRootDescriptions", args: [call("tabDataRoot", initial(), rootType)] })).toBe(descriptions);
  });

  test("focus equality keeps the Fenel pass-through and field/index distinctions", () => {
    const focus = { $tag: "ValueFocus" as const, listId: "list", itemId: "item", rootItem: false,
      path: [{ $tag: "FieldStep" as const, name: "1" }], passThrough: [0] };
    expect(runLocalOrdinaryOperation(model, { kind: "workspaceFocusEqual", args: [focus, { ...focus, passThrough: [1] }] })).toBe(true);
    expect(runLocalOrdinaryOperation(model, { kind: "workspaceFocusEqual", args: [focus,
      { ...focus, path: [{ $tag: "IndexStep", index: 1 }] }] })).toBe(false);
  });
});
