import { beforeAll, describe, expect, test } from "bun:test";
import { createDispatchRegistry, dispatchRegistry, resolveEffect, type FenelFunction, type FenelType } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { builtinTemplates } from "@fenel/engine/templates";
import { createTemplateRegistry } from "@fenel/engine/template-registry";
import { stdModule } from "@fenel/engine/modules/std";
import { publicImportDemoModule } from "../../../../../implementations/typescript/engine/src/modules/public-demos";
import { createReaderPresentation, ownPresentationFromReaderSnapshot, projectReaderTypeDescriptions, projectReaderTypeDescriptionsInSession, readerPresentationDto, readerResultTypeLabel, readerTypeLabelInSession, type ReaderPresentationSource } from "./reader-presentation";
import { List, Nothing, Result, Str } from "@fenel/engine/type-foundation";
import { projectLocusTypeDescriptions } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { userFnItems, userTypeItems, matchesUserQuery } from "./data-items/user-items";
import { createLocalApiClient, type LocalTabSource } from "./local-locus-data";
import { sessionEpoch } from "./browser-session";
import { sessionCatalogSections } from "./expression-runner/authoring-catalog";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { ReaderFunctionRow, ReaderTypeRow } from "./reader-runtime";

const identity = "efbc4ec6-7ec5-4e0a-a9af-94b2582e6f34";
const sourceHandle = "std:catalogue-presentation-fixture";
const expected = { label: "Local label", description: "Local help", icon: "star", emoji: "🧭", codeName: "friendlyFn" };

// Run the browser's exact label adapter without mounting the whole renderer.
// Its ordinary path still calls the real shared formatter imported above.
const typedReadSource = (await Bun.file(new URL("./layout-renderer/TypedReadValue.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const typedLabelStart = typedReadSource.indexOf("export function typedReadTypeLabel(");
const typedLabelEnd = typedReadSource.indexOf("/** The same checked type facts", typedLabelStart);
if (typedLabelStart < 0 || typedLabelEnd <= typedLabelStart) throw new Error("Typed-reader label boundary moved");
const typedLabelCode = new Bun.Transpiler({ loader: "ts" }).transformSync(typedReadSource.slice(typedLabelStart, typedLabelEnd));
const typedReadTypeLabel = new Function("readerTypeLabelInSession",
  `${typedLabelCode.replace(/^export /gm, "")}; return typedReadTypeLabel;`)(readerTypeLabelInSession);

describe("public drawing source in the checked reader profile", () => {
  let product: ModuleRegistry;
  beforeAll(async () => {
    const [{ modulesFor }, { publicDrawingDemoModule }] = await Promise.all([
      import("@fenel/engine/module-manifest"), import("../../../../../implementations/typescript/engine/src/modules/public-demos"),
    ]);
    expect(modulesFor("seed").includes(publicDrawingDemoModule)).toBe(true);
    expect(modulesFor("execute").includes(publicDrawingDemoModule)).toBe(true);
    product = createRepositoryRegistry(modulesFor("seed"));
  }, 900_000);

  test("the checked chart UUID dispatches Viewable through the reader and its ordinary TypeView resolves a host leaf", async () => {
    const frame = product.evaluateContext();
    expect(frame._specRegistry).toBeDefined();
    const nominal = product.getEntityNominalIdentity("PointLineChart")!;
    expect(nominal).toBe(JSON.stringify(["DrawingDemo", "PointLineChart"]));
    const handle = product.getUuid("PointLineChart")!;
    expect(handle).toMatch(/^[0-9a-f-]{36}$/i);
    expect(product.getEntityNominalIdentity(handle)).toBe(nominal);
    const reader = createReaderPresentation(() => ({ registry: product, session: { evaluateContext: frame }, catalog: [] }));
    const methods = reader.representation("Viewable", handle)!;
    expect(methods).toEqual({ defaultView: "point-line-chart", defaultInlineView: "point-line-chart" });
    const instance = resolveEffect(frame, frame._specRegistry!, "Viewable", product.getIdentifiedEntity(handle)!.id)!;
    expect(instance).toBeDefined();
    expect(instance.methods.defaultView).toBe("point-line-chart");
    expect(instance.methods.defaultInlineView).toBe("point-line-chart");
    expect(methods).toEqual(instance.methods);
    const templates = createTemplateRegistry();
    templates.registerAll(builtinTemplates());
    const hostLeaf = () => {};
    templates.registerComponent("point-line-chart", hostLeaf);
    const selected = templates.resolve(methods.defaultView as string)!;
    expect(selected.readComponent).toBe("point-line-chart");
    expect(templates.getComponent(selected.readComponent!)).toBe(hostLeaf);
  }, 60_000);
});

describe("reader type-of-types presentation", () => {
  test("a type value's card type is Type, never the Anything fallback", () => {
    const session = { evaluateContext: {}, environment: { catalog: {} }, registry: { getIdentifiedEntity: () => undefined } };
    // The engine formatter speaks it ("A type"); the card strips the article.
    expect(readerTypeLabelInSession({ $type: true }, session as never)).toBe("A type");
    expect(readerTypeLabelInSession(undefined, session as never)).toBe("Anything");
    expect(readerTypeLabelInSession(Str, session as never)).toBe("A string");
  });
});

describe("Local reader type labels", () => {
  const refusePageRead = (): never => { throw new Error("Local page semantic read"); };
  const session = {
    get evaluateContext(): never { return refusePageRead(); },
    get environment(): never { return refusePageRead(); },
    get registry(): never { return refusePageRead(); },
  };
  const displayReader = { kind: "local" as const, presentation: refusePageRead, representation: refusePageRead };

  test("reference and Result labels use the worker caption without page semantic reads", () => {
    const requested: FenelType[] = [];
    const reader = { ...displayReader, typePresentation(type: FenelType) {
      requested.push(type);
      return { type, label: "Worker caption" };
    } };
    const reference: FenelType = { $ref: identity };
    const result = Result(Str, reference);
    expect(typedReadTypeLabel(reference, session, reader)).toBe("Worker caption");
    expect(typedReadTypeLabel(result, session, reader)).toBe("Worker caption");
    expect(requested).toEqual([reference, result]);
    expect(requested[0]).toBe(reference);
    expect(requested[1]).toBe(result);
  });

  test("pending or unavailable captions stay misses and a later worker answer is read", () => {
    const type: FenelType = { $ref: identity };
    let label: string | undefined;
    const reader = { ...displayReader, typePresentation: (type: FenelType) =>
      label === undefined ? undefined : { type, label } };
    expect(typedReadTypeLabel(type, session, reader)).toBe("");
    expect(typedReadTypeLabel(Result(Str, type), session, reader)).toBe("");
    label = "A transaction";
    expect(typedReadTypeLabel(type, session, reader)).toBe("A transaction");
    label = undefined;
    expect(typedReadTypeLabel(type, session, reader)).toBe("");
    expect(typedReadTypeLabel(type, session, displayReader)).toBe("");
  });

  test("an absent type retains Anything without asking the worker", () => {
    expect(typedReadTypeLabel(undefined, session,
      { ...displayReader, typePresentation: refusePageRead })).toBe("Anything");
  });

  test("a public reader retains the semantic formatter and ignores the Local projection", () => {
    const publicSession = { evaluateContext: {}, environment: { catalog: {} }, registry: { getIdentifiedEntity: () => undefined } };
    const reader = { kind: "public" as const, presentation: () => undefined, representation: () => undefined,
      typePresentation: refusePageRead };
    expect(typedReadTypeLabel(Str, publicSession as never, reader)).toBe("A string");
    expect(typedReadTypeLabel(undefined, publicSession as never, reader)).toBe("Anything");
    const result = Result(Str, Str);
    expect(typedReadTypeLabel(result, publicSession as never, reader)).toBe("Result String String");
    expect(typedReadTypeLabel(result, publicSession as never)).toBe("Result String String");
  });

  test("ordinary readers retain captured representation misses and no-reader frame fallback", () => {
    const h = fixture();
    const publicSession = { ...h.source.session, registry: h.source.registry, environment: { catalog: {} } };
    const type: FenelType = { $ref: identity };
    const reader = { ...h.presentation, kind: "public" as const, typePresentation: refusePageRead };
    const withoutReader = readerTypeLabelInSession(type, publicSession as never);
    expect(withoutReader).toMatch(/Local label/i);
    expect(typedReadTypeLabel(type, publicSession as never)).toBe(withoutReader);
    expect(typedReadTypeLabel(type, publicSession as never, reader)).toBe(withoutReader);
    const missing = { kind: "public" as const, presentation: () => undefined, representation: () => undefined,
      typePresentation: refusePageRead };
    const missingLabel = typedReadTypeLabel(type, publicSession as never, missing);
    expect(missingLabel).toBe(readerTypeLabelInSession(type, publicSession as never, missing));
    expect(missingLabel).not.toMatch(/Local label/i);
  });
});

describe("reader Result signature presentation", () => {
  test("early descriptions and ready-reader labels retain both payload types", () => {
    const result = Result(Str, Str);
    const source = { evaluateContext: {} };
    expect(readerResultTypeLabel(result, source)).toBe("Result String String");
    expect(readerResultTypeLabel(Result(Str, List(Str)), source)).toBe("Result String [String]");
    expect(readerResultTypeLabel(Str, source)).toBeUndefined();
    const descriptions = projectReaderTypeDescriptions({ type: { $arrow: { params: [], returns: result } } }, source);
    expect(descriptions.find(entry => entry.type === result)).toMatchObject({ phrase: "Result String String", code: "Result String String" });
  });

  test("captured alias routes retain their source names and unavailable routes keep the fallback", () => {
    const type = Result(Str, { $ref: identity });
    expect(readerResultTypeLabel(type, { evaluateContext: {}, referenceRoutes: [{
      sourceName: "MyText", targetId: identity, status: "resolved",
    }] })).toBe("Result String MyText");
    expect(readerResultTypeLabel(type, { evaluateContext: {}, get referenceRoutes(): never {
      throw new Error("Reader source names are unavailable");
    } })).toBeUndefined();
  });
});

function fixture() {
  const pool = createDispatchRegistry();
  const methods = { Labelable: { label: expected.label }, Describable: { description: expected.description },
    Iconable: { icon: expected.icon }, Emojiable: { emoji: expected.emoji }, Codeable: { codeName: expected.codeName } };
  for (const [typeName, value] of Object.entries(methods)) {
    const cls = dispatchRegistry.getClass(typeName);
    if (!cls) throw new Error(`Missing repository presentation class ${typeName}`);
    pool.defineClass(cls);
    pool.addInstance({ typeName, args: [identity], methods: value, priority: 100, scope: { kind: "tag", tag: "this-source" } });
    pool.addInstance({ typeName, args: [identity], methods: Object.fromEntries(Object.keys(value).map(key => [key, "lower priority"])),
      priority: 10, scope: { kind: "tag", tag: "this-source" } });
    pool.addInstance({ typeName, args: [identity], methods: Object.fromEntries(Object.keys(value).map(key => [key, "other source"])),
      priority: 1000, scope: { kind: "tag", tag: "other-source" } });
  }
  const fn: FenelFunction = { id: sourceHandle, params: [], returns: { $ref: "String" } };
  const registry = { getFunction: (id: string) => id === identity || id === sourceHandle ? fn : undefined,
    getIdentifiedEntity: () => undefined, getEntityNominalIdentity: () => undefined,
    getUuid: (id: string) => id === identity || id === sourceHandle ? identity : undefined } as unknown as ModuleRegistry;
  const source: ReaderPresentationSource = { registry, session: { evaluateContext: { _specRegistry: pool, _activeTags: ["this-source"] } },
    catalog: [{ id: "function", label: "Functions", description: "", entries: [{ id: sourceHandle, name: "Catalogue fallback",
      description: "Catalogue help", category: "function", fn }] }], functionRows: [], types: [] };
  return { source, pool, presentation: createReaderPresentation(() => source) };
}

/** Real semantic-owner parity, sharing the existing ImportDemo test's checked
 * registry/frame. The extra catalogue is inert; no second base is constructed. */
function assertReaderTypeProjectionParity(source: ReaderPresentationSource): void {
  const registry = source.registry;
  const frame = source.session.evaluateContext;
  const nominal = registry.getIdentifiedEntity("ImportDemo:ImportJsonCheck")
    ?? registry.getIdentifiedEntity("ImportJsonCheck");
  expect(nominal).toBeDefined();
  if (!nominal) throw new Error("The actual ImportDemo fixture has no ImportJsonCheck owner.");
  const nominalOwner = registry.getEntityNominalIdentity(nominal.id);
  expect(nominalOwner).toBeDefined();
  const environmentOnly = "C1.EnvironmentOnlyType";
  expect(registry.getIdentifiedEntity(environmentOnly)).toBeUndefined();
  // An inert display alias points to the existing captured type owner. It is
  // absent from the registry; no new type or signature authority is installed.
  const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([...source.catalog, {
    id: "entity", label: "Captured type alias", description: "", entries: [{
      id: nominal.id, name: environmentOnly, description: "", category: "entity",
      entity: { id: nominal.id, type: nominal.type },
    }],
  }]), { moduleMembers: registry });
  const session = { registry, evaluateContext: frame, environment };
  expect(environment.resolveTypeRef?.({ $ref: environmentOnly })).toEqual(nominal.type);

  const signature = registry.getFunctionScheme("ImportDemo:checkPurchaseJsonInput");
  const info = registry.getFunctionSignatureInfo("ImportDemo:checkPurchaseJsonInput");
  expect(signature).toBeDefined();
  expect(info).toBeDefined();
  const sidecars = registryTransportSnapshot({ nominalOwner, entityScheme: nominal.typeScheme, signature, info }, "C1 captured sidecars");
  const transportedSidecars = structuredClone(sidecars);
  expect(transportedSidecars).toStrictEqual(sidecars);
  expect(transportedSidecars.signature?.applications).toEqual(signature?.applications);
  expect(transportedSidecars.signature?.nominals).toEqual(signature?.nominals);
  expect(transportedSidecars.info).toStrictEqual(info);

  const nested: FenelType = { $record: { fields: [
    { name: "first", key: { $tag: "PositionalField", index: 0 }, type: List(Result(Str, Str)), label: Nothing, ui: Nothing, meta: {} },
    { name: "second", key: { $tag: "PositionalField", index: 1 }, type: { $ref: nominal.id }, label: Nothing, ui: Nothing, meta: {} },
  ] } };
  const cases: ReadonlyArray<readonly [string, FenelType]> = [
    ["Result payload", Result(Str, List(Str))],
    ["arrow return preserves the old row roster", { $arrow: { params: [], returns: Result(Str, Str) } }],
    ["nested field order and nominal reference", nested],
    ["generic List", List({ $var: "element" })],
    ["dependent declaration", { $el: { var: "type" } }],
    ["unresolved reference", { $ref: "C1.UnresolvedType" }],
    ["actual captured nominal owner", { $ref: nominal.id }],
    ["environment-only reference", { $ref: environmentOnly }],
  ];
  for (const typeLookup of ["registry", "session"] as const) {
    for (const [label, type] of cases) {
      // This is the exact pre-migration TypeDataPreview owner and resolver.
      const expected = projectLocusTypeDescriptions({ type }, undefined, undefined,
        name => registry.getIdentifiedEntity(name)?.type
          ?? (typeLookup === "session" ? environment.resolveTypeRef?.({ $ref: name }) : undefined), frame);
      const request = structuredClone(registryTransportSnapshot({ root: { type }, typeLookup }, `C1 ${label} request`));
      const actual = projectReaderTypeDescriptionsInSession(request.root, session, request.typeLookup);
      const reply = structuredClone(registryTransportSnapshot({ descriptions: actual }, `C1 ${label} reply`));
      const baseline = structuredClone(registryTransportSnapshot({ descriptions: expected }, `C1 ${label} baseline`));
      expect(reply).toStrictEqual(baseline);
      expect(reply.descriptions).toHaveLength(expected.length);
      expect(reply.descriptions[0]?.type).toEqual(type);
      expect(reply.descriptions[0]?.type).not.toBe(type);
      expect(reply.descriptions[0]?.type).not.toBe(request.root.type);
      expect(Object.getOwnPropertyDescriptors(reply.descriptions[0]!))
        .toEqual(Object.getOwnPropertyDescriptors(baseline.descriptions[0]!));
      expect(Object.getOwnPropertyDescriptors(reply.descriptions[0]!.type))
        .toEqual(Object.getOwnPropertyDescriptors(baseline.descriptions[0]!.type));
      if (label === "environment-only reference") {
        if (typeLookup === "registry") expect(reply.descriptions[0]?.previewShape).toEqual(type);
        else expect(reply.descriptions[0]?.previewShape).not.toEqual(type);
      }
    }
  }
  const after = registryTransportSnapshot({ nominalOwner: registry.getEntityNominalIdentity(nominal.id),
    entityScheme: registry.getIdentifiedEntity(nominal.id)?.typeScheme,
    signature: registry.getFunctionScheme("ImportDemo:checkPurchaseJsonInput"),
    info: registry.getFunctionSignatureInfo("ImportDemo:checkPurchaseJsonInput") }, "C1 unchanged captured sidecars");
  expect(after).toStrictEqual(sidecars);
}

describe("reader presentation from captured scope", () => {
  test("production ImportDemo source metadata reaches JSON and purchase calls through their UUID aliases", () => {
    // C1: source annotations and the real system pool supply metadata. Do not
    // seed test-owned Labelable/Describable rows or use catalogue copy as proof.
    const registry = createRepositoryRegistry([stdModule, publicImportDemoModule], { dispatchRegistry });
    const functions = [
      ["inspectJsonInput", "Inspect JSON"],
      ["formatJsonInput", "Format JSON"],
      ["minifyJsonInput", "Minify JSON"],
      ["inspectJsonValue", "Inspect JSON data"],
      ["checkPurchaseJsonInput", "Check JSON purchase input"],
      ["purchasesFromCsvInput", "Read purchases from CSV"],
      ["purchasesFromJsonInput", "Read purchases from JSON"],
    ] as const;
    const source: ReaderPresentationSource = { registry, session: { evaluateContext: registry.evaluateContext() },
      catalog: [{ id: "function", label: "Functions", description: "", entries: functions.map(([name]) => {
        const handle = `ImportDemo:${name}`;
        const fn = registry.getFunction(handle);
        if (!fn) throw new Error(`Production source function unavailable: ${handle}`);
        return { id: handle, name: "Catalogue fallback", description: "Catalogue help", category: "function", fn };
      }) }], functionRows: [], types: [] };
    assertReaderTypeProjectionParity(source);
    const reader = createReaderPresentation(() => source);
    for (const [name, label] of functions) {
      const handle = `ImportDemo:${name}`;
      const uuid = registry.getUuid(handle);
      if (!uuid) throw new Error(`Production source UUID unavailable: ${handle}`);
      const authoredLabel = publicImportDemoModule.instances?.find(instance =>
        instance.typeName === "Labelable" && instance.args[0] === handle)?.methods;
      const authoredDescription = publicImportDemoModule.instances?.find(instance =>
        instance.typeName === "Describable" && instance.args[0] === handle)?.methods;
      const description = authoredDescription?.description;
      if (typeof description !== "string") throw new Error(`Production source description unavailable: ${handle}`);
      expect(authoredLabel).toEqual({ label });
      expect(authoredDescription?.description).toBeTruthy();
      expect(registry.getFunction(uuid)?.id).toBe(registry.getFunction(handle)?.id);
      for (const alias of [handle, uuid]) {
        expect(reader.representation("Labelable", alias)).toEqual(authoredLabel);
        expect(reader.representation("Describable", alias)).toEqual(authoredDescription);
        const projected = readerPresentationDto(reader.presentation(alias)!);
        expect(projected.label).toBe(label);
        expect(projected.description).toBe(description);
      }
    }
  }, 180_000);

  test("local API display projections reach Browse and picker labels without changing identities", async () => {
    const { source, pool } = fixture();
    const typeId = "b1c9439a-f01d-46f0-8454-66df13cd54c8";
    const type = { $ref: "Number" };
    const entity = { id: typeId, type };
    const fn: FenelFunction = { id: identity, params: [], returns: type, body: 42 };
    source.registry = { getFunction: (id: string) => id === identity ? fn : undefined,
      getIdentifiedEntity: (id: string) => id === typeId ? entity : undefined,
      listIdentifiedEntities: () => [entity],
      getEntityNominalIdentity: () => undefined, getUuid: (id: string) => id } as unknown as ModuleRegistry;
    source.types = [{ id: typeId, name: typeId, type, isSystem: false } as ReaderTypeRow];
    source.functionRows = [{ id: identity, name: identity, function: fn, isSystem: false } as ReaderFunctionRow];
    source.catalog = [{ id: "entity", label: "Types", description: "", entries: [{ id: typeId, name: typeId,
      description: "", category: "entity", entity }] }, { id: "function", label: "Functions", description: "", entries: [{
      id: identity, name: identity, description: "", category: "function", fn }] }];
    pool.addInstance({ typeName: "Labelable", args: [typeId], methods: { label: { en: "Counter", fr: "Compteur" } },
      priority: 100, scope: { kind: "tag", tag: "this-source" } });
    pool.addInstance({ typeName: "Labelable", args: [typeId], methods: { label: "Foreign counter" },
      priority: 1000, scope: { kind: "tag", tag: "other-source" } });
    // C1 worker leaf: retain the real scoped projection while this API fixture
    // supplies the inert metadata reply used by the browser transport tests.
    const presentation = createReaderPresentation(() => source);
    const snapshot = { ...source, readPresentations: async (targets: readonly string[]) => targets.map(target => ({
      target, presentation: presentation.presentation(target),
    })) };
    const local = { id: "this-source", epoch: sessionEpoch(), ready: async () => {}, revision: () => 0,
      snapshot: () => snapshot } as unknown as LocalTabSource;
    const client = createLocalApiClient(local);
    try {
      const types = (await client.getBrowseTypes()).types;
      const functions = (await client.getBrowseFunctions()).functions;
      expect(types[0]).toMatchObject({ id: typeId, name: typeId, label: "Counter", isSystem: false });
      expect(functions[0]).toMatchObject({ id: identity, name: identity, label: expected.label, codeName: expected.codeName,
        icon: expected.icon, isSystem: false });
      const typeItems = userTypeItems(types);
      const fnItems = userFnItems(functions);
      expect(matchesUserQuery(typeItems[0]!, "Counter")).toBe(true);
      expect(typeItems[0]!.routeId).toBe(`entity:${typeId}`);
      expect(fnItems[0]).toMatchObject({ routeId: identity, label: expected.label, codeName: expected.codeName, icon: expected.icon });
      const captured = createReaderPresentation(() => source);
      const named = (id: string) => ({ name: captured.presentation(id)?.label ?? id,
        description: captured.presentation(id)?.description ?? "" });
      const sections = sessionCatalogSections(source.registry, source.catalog, named, named);
      const picker = buildAuthoringCatalogSnapshot(sections, { codeNameFor: id => captured.presentation(id)?.codeName });
      expect(picker.types.find(row => row.entityId === typeId)).toMatchObject({ id: typeId, name: "Counter", type, entityId: typeId });
      expect(picker.functions.find(row => row.id === identity)).toMatchObject({ id: identity, targetId: identity,
        label: expected.label, codeName: expected.codeName });
      expect(readerPresentationDto({ label: { en: "Counter", fr: "Compteur" } }).label).toBe("Counter");
    } finally { client.dispose(); }
  });

  test("catalogue-only data uses all scoped representations through UUID and source handles", () => {
    const { presentation } = fixture();
    expect(presentation.presentation(identity)).toEqual({ ...expected, emoji: undefined });
    expect(presentation.presentation(sourceHandle)).toEqual({ ...expected, emoji: undefined });
    expect(presentation.representation("Labelable", identity)).toEqual({ label: expected.label });
    expect(presentation.representation("Codeable", sourceHandle)).toEqual({ codeName: expected.codeName });
    expect(presentation.representation("Emojiable", identity)).toEqual({ emoji: expected.emoji });
  });

  test("shared caption glyphs prefer own Iconable and otherwise use Emojiable", () => {
    const { source } = fixture();
    const frame = source.session.evaluateContext;
    const label = { label: "Read this data" };
    for (const [icon, emoji, selectedIcon, selectedEmoji] of [
      ["star", "🧭", "star", undefined],
      ["star", undefined, "star", undefined],
      [undefined, "🧭", undefined, "🧭"],
      [undefined, undefined, undefined, undefined],
    ] as const) {
      const methods = new Map<string, Record<string, unknown>>([["Labelable", label]]);
      if (icon !== undefined) methods.set("Iconable", { icon });
      if (emoji !== undefined) methods.set("Emojiable", { emoji });
      expect(ownPresentationFromReaderSnapshot(frame, methods, identity)).toMatchObject({
        label: label.label, icon: selectedIcon, emoji: selectedEmoji,
      });
      expect(methods.get("Emojiable")).toEqual(emoji === undefined ? undefined : { emoji });
    }
  });

  test("a selected picture preserves its own icon/emoji while its media is pending", () => {
    const { source } = fixture();
    const methods = new Map<string, Record<string, unknown>>([
      ["Picturable", { picture: { $ref: "picture-owner" } }],
      ["Iconable", { icon: "star" }], ["Emojiable", { emoji: "🍯" }],
    ]);
    expect(ownPresentationFromReaderSnapshot(source.session.evaluateContext, methods, identity)).toMatchObject({
      picture: { $tag: "GlyphPictureReference", handle: "picture-owner" }, icon: "star", emoji: "🍯",
    });
  });

  test("type and structural icons do not hide a data's Emojiable fallback", () => {
    const { source } = fixture();
    const methods = new Map<string, Record<string, unknown>>([
      ["Labelable", { label: "Read this data" }],
      ["Iconable", { icon: "function" }], ["Emojiable", { emoji: "🧭" }],
    ]);
    for (const key of [{ $pattern: "engine.isArrowType" }, { $var: "a" }, undefined]) {
      expect(ownPresentationFromReaderSnapshot(source.session.evaluateContext, methods, key)).toMatchObject({
        label: "Read this data", icon: undefined, emoji: "🧭",
      });
    }
    expect(methods.get("Iconable")).toEqual({ icon: "function" });
    expect(methods.get("Emojiable")).toEqual({ emoji: "🧭" });
  });

  test("shared emoji fallback follows the current scope and disappears on removal", () => {
    const { source, presentation } = fixture();
    const original = source.session.evaluateContext;
    expect(presentation.presentation(identity)?.emoji).toBeUndefined();
    source.session = { evaluateContext: { ...original, _activeTags: [],
      _dictStack: [{ typeName: "Emojiable", args: [identity], methods: { emoji: "🍅" } }] } };
    expect(presentation.presentation(identity)).toMatchObject({ icon: undefined, emoji: "🍅" });
    source.session = { evaluateContext: { ...original, _activeTags: [],
      _dictStack: [{ typeName: "Emojiable", args: [identity], methods: { emoji: "🥒" } }] } };
    expect(presentation.presentation(sourceHandle)?.emoji).toBe("🥒");
    source.session = { evaluateContext: { ...original, _activeTags: [] } };
    expect(presentation.presentation(identity)?.emoji).toBeUndefined();
  });

  test("authoritative projected misses suppress scoped and catalogue fallback", () => {
    const { source, presentation } = fixture();
    source.metadata = new Map([[identity, new Map()]]);
    expect(presentation.presentation(identity)).toEqual({ label: undefined, description: undefined, icon: undefined,
      emoji: undefined, codeName: undefined });
    expect(presentation.presentation(sourceHandle)?.label).toBeUndefined();
    expect(presentation.representation("Labelable", sourceHandle)).toBeUndefined();
    source.ownPresentations = new Map([[sourceHandle, { label: "Stale alias", icon: "star" }]]);
    expect(presentation.presentation(identity)?.label).toBeUndefined();
    expect(presentation.ownIcon(sourceHandle)).toBeUndefined();
  });

  test("inert own presentation remains separate from the type default and old snapshots omit an unproven icon", () => {
    const { source, presentation } = fixture();
    source.metadata = new Map([[identity, new Map([
      ["Labelable", { label: { en: "Read text", fr: "Lire du texte" } }],
      ["Iconable", { icon: "function" }],
      ["Codeable", { codeName: "readText" }],
    ])]]);
    expect(presentation.ownIcon(sourceHandle)).toBeUndefined();
    expect(presentation.presentation(identity)?.label).toEqual({ en: "Read text", fr: "Lire du texte" });
    expect(presentation.representation("Iconable", sourceHandle)).toEqual({ icon: "function" });
    source.ownPresentations = new Map([[identity, { label: "Read text", codeName: "readText", icon: "book-open" }]]);
    expect(presentation.ownIcon(identity)).toBe("book-open");
    expect(presentation.presentation(sourceHandle)?.label).toBe("Read text");
    expect(presentation.representation("Iconable", identity)?.icon).toBe("function");
    source.ownPresentations = new Map([[identity, { label: "Read text", codeName: "readText" }]]);
    expect(presentation.ownIcon(sourceHandle)).toBeUndefined();
  });

  test("the captured display law prefers Labelable before Codeable and revalidates changed facts", () => {
    const { source, presentation } = fixture();
    source.metadata = new Map([[identity, new Map([["Codeable", { codeName: "readText" }]])]]);
    expect(presentation.presentation(identity)).toMatchObject({ label: "Read Text", codeName: "readText" });
    source.metadata = new Map([[identity, new Map([
      ["Codeable", { codeName: "readText" }], ["Labelable", { label: "Read this text" }],
    ])]]);
    expect(presentation.presentation(identity)?.label).toBe("Read this text");
    source.metadata = new Map([[identity, new Map([["Codeable", { codeName: "writeText" }]])]]);
    expect(presentation.presentation(identity)?.label).toBe("Write Text");
    expect(presentation.ownIcon(identity)).toBeUndefined();
  });

  test("own icons follow current lexical and source selections without borrowing another source", () => {
    const { source, presentation } = fixture();
    expect(presentation.ownIcon(sourceHandle)).toBe("star");
    const original = source.session.evaluateContext;
    source.session = { evaluateContext: { ...original, _dictStack: [{ typeName: "Iconable", args: [identity], methods: { icon: "book-open" } }] } };
    expect(presentation.ownIcon(identity)).toBe("book-open");
    expect(presentation.representation("Iconable", sourceHandle)?.icon).toBe("book-open");
    source.session = { evaluateContext: { ...original, _activeTags: ["other-source"] } };
    expect(presentation.ownIcon(identity)).toBe("other source");
    source.session = { evaluateContext: { ...original, _activeTags: [] } };
    expect(presentation.ownIcon(identity)).toBeUndefined();
  });

  test("source policy reserves structural and wildcard Iconable for the type/body, preserving full method values", () => {
    const { source } = fixture();
    const methods = new Map([["Iconable", { icon: "function" }], ["Codeable", { codeName: "readText" }]]);
    for (const key of [{ $pattern: "engine.isArrowType" }, { $var: "a" }, undefined]) {
      expect(ownPresentationFromReaderSnapshot(source.session.evaluateContext, methods, key)).toMatchObject({
        label: "Read Text", codeName: "readText", icon: undefined,
      });
      expect(methods.get("Iconable")).toEqual({ icon: "function" });
    }
    expect(ownPresentationFromReaderSnapshot(source.session.evaluateContext, methods, identity).icon).toBe("function");
  });

  test("catalogue fallback remains available when no source representation is visible", () => {
    const { source, presentation } = fixture();
    source.session = { evaluateContext: { _specRegistry: source.session.evaluateContext._specRegistry, _activeTags: [] } };
    expect(presentation.presentation(identity)).toEqual({ label: "Catalogue fallback", description: "Catalogue help",
      icon: undefined, emoji: undefined, codeName: undefined });
  });
});
