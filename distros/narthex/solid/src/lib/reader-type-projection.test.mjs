import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// C1 host wiring only: execute bounded production source with the semantic
// projector/worker and Solid lifetime supplied as fixtures. No engine imports.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const presentation = read("./reader-presentation.ts");
const component = read("./layout-renderer/TypedReadValue.tsx");
const registry = read("../../../../../implementations/typescript/engine/src/registry-transport.ts");
const transpiler = new Bun.Transpiler({ loader: "ts" });

function slice(source, first, last) {
  const start = source.indexOf(first);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(first, start + first.length)).toBe(-1);
  const end = source.indexOf(last, start + first.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const bindingSource = slice(presentation,
  "export function projectReaderTypeDescriptionsInSession(",
  "/** A2/B3 snapshot transport only.");
const bind = projector => new Function("projectLocusTypeDescriptions",
  `${transpiler.transformSync(bindingSource.replace("export function", "function"))}\nreturn projectReaderTypeDescriptionsInSession;`)(projector);

const inputSource = slice(component,
  "  const completePreview = () =>",
  "  let pendingProjection:");
const selectInput = (session, props, workerForSession, reader) => new Function(
  "createMemo", "session", "props", "preparedReaderWorkerForSession", "reader", "localSession",
  `${transpiler.transformSync(inputSource)}\nreturn projectionInput();`,
)(callback => callback, () => session, props, workerForSession, reader,
  () => reader?.kind === "local" && (!props.fieldRegistry || props.fieldRegistry === session.registry) ? session : undefined);

const descriptionSource = slice(component,
  "  const description = (type: FenelType) => {",
  "  const fieldLabel = (field: FieldDef)");
const describeRoot = (input, type, main) => new Function("projectionInput", "currentProjection", "props",
  "descriptions", "projectLocusTypeDescriptions", "resolveType", "session", "completePreview", "previewRow",
  `${transpiler.transformSync(descriptionSource)}\nreturn description(props.type);`,
)(() => input, () => undefined, { type }, main, main, () => undefined, () => ({ evaluateContext: {} }),
  () => !!input?.complete, () => { throw new Error("This type preview is unavailable."); });

const lifetimeSource = slice(component,
  "  let pendingProjection: AbortController | undefined;",
  "  const previewMaps = createMemo(");
function lifetime(input) {
  let currentInput = input;
  let dispose;
  const calls = [];
  const createAsyncValue = (source, fetcher) => {
    let value, error, pending = false, generation = 0;
    const readValue = () => value;
    Object.defineProperties(readValue, {
      loading: { get: () => pending },
      error: { get: () => error },
    });
    readValue.refetch = () => {
      const mine = ++generation;
      pending = true;
      error = undefined;
      let result;
      try { result = fetcher(source()); }
      catch (failure) { result = Promise.reject(failure); }
      return Promise.resolve(result).then(answer => {
        if (mine === generation) { value = answer; pending = false; }
      }, failure => {
        if (mine === generation) { error = failure; pending = false; }
      });
    };
    readValue.first = readValue.refetch();
    return readValue;
  };
  const run = (worker, payload, signal) => new Promise((resolve, reject) => {
    calls.push({ worker, payload, signal, resolve, reject });
  });
  const result = new Function("createAsyncValue", "projectionInput", "onSettled", "runPreparedReaderWorker", "LUCIDE_BY_NAME",
    `${transpiler.transformSync(lifetimeSource)}\nreturn { projected, currentProjection };`,
  )(createAsyncValue, () => currentInput, callback => { dispose = callback(); }, run, { star: {}, utensils: {} });
  return { ...result, calls, dispose: () => dispose?.(),
    change: next => { currentInput = next; return result.projected.refetch(); } };
}

const captionSource = slice(read("./value-card.tsx"), "export function valueCardTypeLabel(", "/** Shared card chrome");
const caption = new Function(`${transpiler.transformSync(captionSource.replace("export function", "function"))}; return valueCardTypeLabel;`)();
const callbacksSource = slice(component, "  const previewMaps = createMemo(", "  const unavailable = () =>");
const ownIconStart = component.indexOf("ownTypeIcon={type => completePreview()");
const ownIconEnd = component.indexOf("\n", ownIconStart);
expect(ownIconStart).toBeGreaterThan(0);
expect(ownIconEnd).toBeGreaterThan(ownIconStart);
const ownIconSource = component.slice(ownIconStart + "ownTypeIcon={".length, ownIconEnd).trimEnd().replace(/}$/, "");
function previewCallbacks(type, packet, options = {}) {
  const forbidden = () => { throw new Error("Local main-thread semantic work"); };
  const bindings = {
    createMemo: fn => fn, currentProjection: () => packet && ({ preview: packet }), props: { type },
    completePreview: () => true, projectionInput: () => ({ complete: true }),
    session: forbidden, reader: new Proxy({}, { get: forbidden }), registry: forbidden, resolveType: forbidden,
    typedReadTypePresentation: forbidden, typedReadTypeOwnIcon: forbidden,
    typedReadTypeLabel: forbidden, typePhrase: forbidden, typeCode: forbidden,
    readerResultTypeLabel: forbidden, projectLocusTypeDescriptions: forbidden,
    valueCardTypeLabel: caption, valueCardLabel: forbidden, ...options,
  };
  return new Function(...Object.keys(bindings), `${transpiler.transformSync(callbacksSource)}
    return { typeEntry, description, fieldLabel, shape, variantCaseType,
      ownTypeIcon: ${transpiler.transformSync(`const selected = ${ownIconSource};`).replace(/^const selected = /, "").replace(/;\s*$/, "")} };`,
  )(...Object.values(bindings));
}

// Execute the existing recursive body's member preparation and callback props.
// JSX is an inert node fixture; this establishes binding, not DOM appearance.
const bodySource = read("./type-data-preview.tsx");
const bodyStart = bodySource.indexOf("export function TypeDataPreviewBody(");
const bodyEnd = bodySource.indexOf('  return <div class={["type-data-preview",', bodyStart);
expect(bodyEnd).toBeGreaterThan(bodyStart);
const jsxTranspiler = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: {
  jsx: "react", jsxFactory: "node", jsxFragmentFactory: "fragment",
} } });
const node = (tag, props, ...children) => ({ tag, props: props ?? {}, children });
const bodyBindings = {
  node, createMemo: fn => fn, useValueCardInline: () => () => false,
  peelMaybeValue: maybe => maybe?._0,
  ValueCard: "ValueCard", ValueCardCaption: "ValueCardCaption", Show: "Show", IconByName: "IconByName",
  TYPE_ICON_FALLBACKS: { Type: "type-badge" },
};
const bodyModel = new Function(...Object.keys(bodyBindings), `${jsxTranspiler.transformSync(
  `${bodySource.slice(bodyStart, bodyEnd).replace("export function", "function")}
  return { props, shape, details, fields, cases, members, body, preview, typeLine }; }`)}
  return TypeDataPreviewBody;`)(...Object.values(bodyBindings));
const arrowStart = bodySource.indexOf("      <FunctionCardBody inputs=");
const arrowEnd = bodySource.indexOf(" />", arrowStart);
expect(arrowEnd).toBeGreaterThan(arrowStart);
const arrowModel = new Function("node", "FunctionCardBody", "props", "shape", "preview", jsxTranspiler.transformSync(
  `return (${bodySource.slice(arrowStart, arrowEnd + 3).trim()});`));

const transportSource = slice(registry,
  "export function registryTransportSnapshot<T>(",
  "/** An injective text encoding of a transport value,");
const snapshot = new Function(
  `${transpiler.transformSync(transportSource.replace(/^export /gm, ""))}\nreturn registryTransportSnapshot;`,
)();

const typePresentationSource = slice(component,
  "export function typedReadTypePresentation(",
  "/** The typed read surface shared");
const sharedTypePresentationSource = slice(presentation,
  "export function readerTypePresentationInSession(", "export type ReaderTypePreviewPacket =");
const sharedTypePresentation = new Function("presentedTypeTarget", "readerTypeLabelInSession",
  "typeIconForPresentation", "resolveEffect",
  `${transpiler.transformSync(sharedTypePresentationSource.replace("export function", "function"))}\nreturn readerTypePresentationInSession;`,
)(type => type.$ref, () => "Type label", () => "type-badge", () => { throw new Error("Unexpected global lookup"); });
const typePresentation = new Function("readerTypePresentationInSession", "valueCardTypeLabel", "LUCIDE_BY_NAME",
  `${transpiler.transformSync(typePresentationSource.replace("export function", "function"))}\nreturn typedReadTypePresentation;`,
)(sharedTypePresentation, caption, {});

const producerStart = presentation.indexOf("export function projectReaderTypePreviewInSession(");
expect(producerStart).toBeGreaterThan(0);
const producerCode = transpiler.transformSync(presentation.slice(producerStart)).replace(/^export /gm, "");
function producerFixture() {
  const projections = [], walks = [], presentations = [], labels = [];
  const frame = { marker: "captured frame" };
  const definitions = new Map();
  const registry = {
    getIdentifiedEntity: ref => definitions.get(ref),
    getFieldRepresentation(cls, ref) { labels.push({ cls, ref }); return { methods: { label: `Selected ${ref}` } }; },
  };
  const fallbackReads = [];
  const session = { registry, evaluateContext: frame, environment: {
    catalog: { referenceRoutes: ["reference"], exactConstructorRoutes: ["constructor"], patternConstructors: ["target"] },
    resolveTypeRef: ref => { fallbackReads.push(ref); return { $ref: "environment-type" }; },
  } };
  const source = { catalog: [{ id: "function" }], types: [{ id: "source-type" }], functionRows: [] };
  const plans = new Map();
  const descriptions = new Map();
  const state = { describe: type => descriptions.get(type) ?? { type, previewShape: type },
    walk: type => plans.get(type) ?? [type] };
  const reader = { captured: undefined };
  const bindings = {
    createReaderPresentation(read) { reader.captured = read(); return reader; },
    marshalTraversalType: type => ({ node: type, ...(type.invalid ? { invalid: true } : {}) }),
    dispatchEngineBody(name, args, selectedFrame) {
      if (walks.length > 80) throw new Error("Packet traversal did not terminate");
      walks.push({ name, args, frame: selectedFrame });
      return state.walk(args[0].node);
    },
    projectReaderTypeDescriptions(root, printSource, resolveName, resolveCode, resolveType) {
      if (projections.length > 80) throw new Error("Packet projection did not terminate");
      projections.push({ root, printSource, resolveName, resolveCode, resolveType });
      const description = state.describe(root.type);
      return Array.isArray(description) ? description : description ? [description] : [];
    },
    readerTypePresentationInSession(type, selectedSession, selectedReader, selectedRegistry, knownIcons) {
      presentations.push({ type, session: selectedSession, reader: selectedReader, registry: selectedRegistry, knownIcons });
      return { type, label: "Selected type", icon: "star" };
    },
    valueCardLabel: value => value,
  };
  const project = new Function(...Object.keys(bindings), `${producerCode}; return projectReaderTypePreviewInSession;`)(...Object.values(bindings));
  return { project, registry, frame, session, source, reader, plans, descriptions, state,
    projections, walks, presentations, labels, definitions, fallbackReads };
}

describe("selected reader presentation transport", () => {
  test("type-as-data carries the same selected icon/emoji without changing its type badge", () => {
    const type = { $ref: "physical-type" };
    for (const selected of [{ icon: "star" }, { emoji: "🥒" }, {}]) {
      let reads = 0;
      const reader = { presentation: target => { reads++; expect(target).toBe("physical-type"); return selected; },
        get ownIcon() { throw new Error("Do not select icon and emoji through different projections"); } };
      const result = typePresentation(type, { registry: {}, evaluateContext: {} }, reader);
      expect(result.ownIcon).toBe(selected.icon);
      expect(result.ownEmoji).toBe(selected.emoji);
      expect(result.icon).toBe("type-badge");
      expect(reads).toBe(1);
    }
  });

  test("an anonymous type does not invent a named emoji lookup", () => {
    const result = typePresentation({ $record: { fields: [] } }, { registry: {}, evaluateContext: {} },
      { presentation: () => { throw new Error("No nominal target"); } });
    expect(result.ownIcon).toBeUndefined();
    expect(result.ownEmoji).toBeUndefined();
    expect(result.icon).toBe("type-badge");
  });
});

describe("reader type projection source binding", () => {
  test("uses the exact original projector and reader frame without adding routes", () => {
    const root = { type: { $ref: "Chosen" } };
    const frame = {};
    const selected = { $record: { fields: [] } };
    let environmentReads = 0;
    const session = { evaluateContext: frame,
      get catalog() { throw new Error("The original type preview does not read source routes."); },
      registry: { getIdentifiedEntity: name => name === "Chosen" ? { type: selected } : undefined },
      environment: { resolveTypeRef: () => { environmentReads++; return { $ref: "wrong" }; } } };
    const rows = [{ type: root.type }];
    const project = bind((supplied, name, code, resolve, caller) => {
      expect(supplied).toBe(root);
      expect(caller).toBe(frame);
      expect(name).toBeUndefined(); expect(code).toBeUndefined();
      expect(resolve("Chosen")).toBe(selected);
      return rows;
    });
    expect(project(root, session, "session")).toBe(rows);
    expect(environmentReads).toBe(0);
  });

  test("an explicit field registry miss never falls back to the environment", () => {
    let reads = 0;
    const fallback = { $ref: "environment-owner" };
    const session = { registry: { getIdentifiedEntity: () => undefined },
      catalog: {}, evaluateContext: {},
      environment: { resolveTypeRef: ref => { reads++; expect(ref).toEqual({ $ref: "missing" }); return fallback; } } };
    const project = bind((_root, _name, _code, resolve) => resolve("missing"));
    expect(project({}, session, "registry")).toBeUndefined();
    expect(reads).toBe(0);
    expect(project({}, session, "session")).toBe(fallback);
    expect(reads).toBe(1);
  });

  test("an explicitly different field owner does not borrow the reader worker", () => {
    const session = { registry: {} };
    let reads = 0;
    expect(selectInput(session, { type: { $ref: "Any" }, fieldRegistry: {} }, () => { reads++; return {}; })).toBeUndefined();
    expect(reads).toBe(0);
    const worker = {};
    expect(selectInput(session, { type: { $ref: "Any" }, fieldRegistry: session.registry }, () => worker))
      .toEqual({ type: { $ref: "Any" }, worker, typeLookup: "registry", complete: false });
    expect(selectInput(session, { type: { $ref: "Any" } }, () => worker).typeLookup).toBe("session");
  });

  test("retirement is an error input, not selection of the direct projection", () => {
    const error = new Error("retired");
    const input = selectInput({ registry: {} }, { type: { $ref: "Any" } }, () => { throw error; });
    expect(input.error).toBe(error);
  });

  test("Local without an admitted worker refuses without calling the page root projector", async () => {
    const type = { $ref: "Any" };
    const input = selectInput({ registry: {} }, { type }, () => undefined, { kind: "local" });
    expect(input.error.message).toBe("This reader's editing tools are not ready.");
    let pageCalls = 0;
    const main = () => { pageCalls++; throw new Error("The Local page must not project this root"); };
    expect(describeRoot(input, type, main)).toBeUndefined();
    expect(pageCalls).toBe(0);
    const run = lifetime(input);
    await run.projected.first;
    expect(run.projected.error).toBe(input.error);
    expect(run.calls).toHaveLength(0);
    run.dispose();
  });

  test("standalone readers retain their route while a different Local field owner refuses", () => {
    const session = { registry: {} };
    const props = { type: { $ref: "Any" } };
    expect(selectInput(session, props, () => undefined)).toBeUndefined();
    expect(selectInput(session, props, () => undefined, { kind: "public" })).toBeUndefined();
    expect(selectInput(session, props, () => undefined, { kind: "account" })).toBeUndefined();
    let workerReads = 0;
    expect(selectInput(session, { ...props, fieldRegistry: {} }, () => { workerReads++; return undefined; }, { kind: "local" }).error.message)
      .toBe("Type details are unavailable here.");
    expect(workerReads).toBe(0);
  });
});

describe("reader type projection request lifetime", () => {
  test("Local sends complete preview requests with the current AST, exact handle and known icons", async () => {
    const session = { registry: {} }, worker = {};
    const type = { $ref: "Local" };
    const input = selectInput(session, { type }, () => worker, { kind: "local" });
    expect(input).toEqual({ type, worker, typeLookup: "session", complete: true });
    const run = lifetime(input);
    expect(run.calls[0].worker).toBe(worker);
    expect(run.calls[0].payload).toEqual({ method: "project-reader-type-preview", type,
      typeLookup: "session", knownIcons: ["star", "utensils"] });
    const root = structuredClone(type);
    const preview = { root, rows: [{ type: root }], fieldLabels: [] };
    run.calls[0].resolve({ preview });
    await run.projected.first;
    expect(run.currentProjection().preview).toBe(preview);
    run.dispose();
  });

  test("complete previews reject missing or malformed packets without a page fallback", async () => {
    for (const reply of [undefined, null, [], {}, { descriptions: [{ type: {} }] },
      { preview: null }, { preview: {} }, { preview: { root: {}, rows: [], fieldLabels: null } },
      { preview: { root: {}, rows: {}, fieldLabels: [] } }]) {
      const run = lifetime({ type: { $ref: "Local" }, worker: {}, typeLookup: "session", complete: true });
      run.calls[0].resolve(reply);
      await run.projected.first;
      expect(run.projected.error.message).toBe("This type preview is unavailable.");
      expect(run.currentProjection()).toBeUndefined();
      run.dispose();
    }
  });

  test("a complete packet is current only for its exact type, lookup mode, worker and projection kind", async () => {
    for (const change of [
      first => ({ ...first, type: { $ref: "Next" } }),
      first => ({ ...first, typeLookup: "registry" }),
      first => ({ ...first, worker: {} }),
      first => ({ ...first, complete: false }),
    ]) {
      const first = { type: { $ref: "Local" }, worker: {}, typeLookup: "session", complete: true };
      const run = lifetime(first);
      const root = structuredClone(first.type);
      run.calls[0].resolve({ preview: { root, rows: [{ type: root }], fieldLabels: [] } });
      await run.projected.first;
      expect(run.currentProjection()).toBeDefined();
      const next = run.change(change(first));
      expect(run.currentProjection()).toBeUndefined();
      run.dispose();
      expect(run.calls[1].signal.aborted).toBe(true);
      run.calls[1].reject(new Error("aborted"));
      await next;
    }
  });

  test("a superseded pending complete packet cannot publish after a replacement or clear its abort", async () => {
    const first = { type: { $ref: "Before" }, worker: {}, typeLookup: "session", complete: true };
    const run = lifetime(first);
    const nextInput = { ...first, type: { $ref: "After" } };
    const next = run.change(nextInput);
    expect(run.calls[0].signal.aborted).toBe(true);
    run.calls[0].resolve({ preview: { root: first.type, rows: [{ type: first.type }], fieldLabels: [] } });
    await run.projected.first;
    expect(run.currentProjection()).toBeUndefined();
    run.dispose();
    expect(run.calls[1].signal.aborted).toBe(true);
    run.calls[1].resolve({ preview: { root: nextInput.type, rows: [{ type: nextInput.type }], fieldLabels: [] } });
    await next;
  });

  test("sends only the admitted AST operation and keeps the exact handle", async () => {
    const input = { type: { $ref: "A" }, worker: {}, typeLookup: "registry", complete: false };
    const run = lifetime(input);
    expect(run.calls).toHaveLength(1);
    const call = run.calls[0];
    expect(call.worker).toBe(input.worker);
    expect(call.payload).toEqual({ method: "project-reader-types", root: { type: input.type }, typeLookup: "registry" });
    const row = { type: structuredClone(input.type), previewShape: { $record: { fields: [] } } };
    call.resolve({ descriptions: [row] });
    await run.projected.first;
    expect(run.currentProjection().descriptions[0]).toBe(row);
    run.dispose();
  });

  test("a changed root rejects the held answer before its replacement arrives", async () => {
    const worker = {};
    const first = { type: { $ref: "A" }, worker, typeLookup: "session", complete: false };
    const run = lifetime(first);
    run.calls[0].resolve({ descriptions: [{ type: first.type }] });
    await run.projected.first;
    const second = { ...first, type: { $ref: "B" } };
    const next = run.change(second);
    expect(run.currentProjection()).toBeUndefined();
    expect(run.calls[1].signal.aborted).toBe(false);
    run.calls[1].resolve({ descriptions: [{ type: second.type }] });
    await next;
    expect(run.currentProjection().type).toBe(second.type);
    run.dispose();
  });

  test("replacement handles and lookup modes cannot publish a held result", async () => {
    const first = { type: { $ref: "A" }, worker: {}, typeLookup: "session", complete: false };
    const run = lifetime(first);
    run.calls[0].resolve({ descriptions: [{ type: first.type }] });
    await run.projected.first;
    const second = { ...first, worker: {}, typeLookup: "registry" };
    const next = run.change(second);
    expect(run.currentProjection()).toBeUndefined();
    run.calls[1].resolve({ descriptions: [{ type: second.type }] });
    await next;
    expect(run.currentProjection().worker).toBe(second.worker);
    expect(run.currentProjection().typeLookup).toBe("registry");
    run.dispose();
  });

  test("obsolete completion cannot clear a newer abort controller", async () => {
    const first = { type: { $ref: "A" }, worker: {}, typeLookup: "session", complete: false };
    const run = lifetime(first);
    const next = run.change({ ...first, type: { $ref: "B" } });
    expect(run.calls[0].signal.aborted).toBe(true);
    run.calls[0].resolve({ descriptions: [{ type: first.type }] });
    await run.projected.first;
    run.dispose();
    expect(run.calls[1].signal.aborted).toBe(true);
    run.calls[1].reject(new Error("aborted"));
    await next;
  });

  test("disabling the route aborts rather than retaining its pending work", async () => {
    const run = lifetime({ type: { $ref: "A" }, worker: {}, typeLookup: "session", complete: false });
    await run.change(undefined);
    expect(run.calls[0].signal.aborted).toBe(true);
    expect(run.currentProjection()).toBeUndefined();
    run.calls[0].resolve({ descriptions: [{ type: { $ref: "A" } }] });
    await run.projected.first;
    run.dispose();
  });

  test("refused or empty worker projections remain errors", async () => {
    const run = lifetime({ type: { $ref: "A" }, worker: {}, typeLookup: "session", complete: false });
    run.calls[0].reject(new Error("worker refusal"));
    await run.projected.first;
    expect(run.projected.error.message).toBe("worker refusal");
    const next = run.change({ type: { $ref: "B" }, worker: {}, typeLookup: "session", complete: false });
    run.calls[1].resolve({ descriptions: [] });
    await next;
    expect(run.projected.error.message).toBe("This type description is unavailable.");
    expect(run.currentProjection()).toBeUndefined();
    run.dispose();
  });
});

describe("Local packet-only type preview callbacks", () => {
  function packetFixture() {
    const leaf = { $ref: "String" };
    const field = { name: "stored-field-name", key: { $tag: "NamedField", ref: { $ref: "physical-field" } }, type: leaf };
    const caseType = { $record: { fields: [field] } };
    const emptyCase = { $record: { fields: [] } };
    const variant = { $variant: { cases: [{ name: "Selected", fields: [field] }, { name: "Empty", fields: [] }] } };
    const record = { $record: { fields: [field] } };
    const root = { $arrow: { params: [{ name: "input", type: variant }], returns: record } };
    const rows = [root, variant, record, caseType, emptyCase, leaf].map((type, index) => ({ type,
      description: { type, previewShape: type, previewDetails: { summary: `Details ${index}`, dependent: { $tag: "Nothing" } } },
      presentation: { type, label: `a Selected ${index}`, icon: "type-badge", ownIcon: "star", ownEmoji: "🧭" },
      ...(type === variant ? { caseRecords: [caseType, emptyCase] } : {}),
    }));
    const packet = structuredClone({ root, rows, fieldLabels: [{ field, label: "Selected field label" }] });
    const original = structuredClone(root);
    const callbacks = previewCallbacks(original, packet);
    const props = { type: original, describeType: callbacks.typeEntry, describeDetails: type => callbacks.description(type)?.previewDetails,
      resolveShape: callbacks.shape, variantCaseType: callbacks.variantCaseType, fieldLabel: callbacks.fieldLabel,
      ownTypeIcon: callbacks.ownTypeIcon };
    return { original, packet, callbacks, props };
  }

  test("arrow inputs, nested variants and record fields use only packet nodes and inert labels", () => {
    const { original, packet, callbacks, props } = packetFixture();
    const root = bodyModel(props);
    expect(callbacks.shape(original)).toBe(packet.root);
    expect(callbacks.typeEntry(original).label).toBe("Selected 0");
    expect(callbacks.ownTypeIcon(original)).toBe("star");
    const arrow = arrowModel(node, "FunctionCardBody", root.props, root.shape, root.preview);
    expect(arrow.props.inputs[0].type).toBe(packet.root.$arrow.params[0].type);
    expect(arrow.props.output.type).toBe(packet.root.$arrow.returns);
    const preview = arrow.props.previewType(arrow.props.inputs[0]);
    const child = preview.children[0];
    expect(child.props.variantCaseType).toBe(callbacks.variantCaseType);
    expect(child.props.ownTypeIcon).toBe(callbacks.ownTypeIcon);
    const variant = child.tag(child.props);
    const members = variant.members();
    expect(members.map(member => member.label)).toEqual(["Selected", "Empty"]);
    expect(members[0].type).toBe(packet.rows[1].caseRecords[0]);
    expect(members[1].type).toBe(packet.rows[1].caseRecords[1]);
    const nested = variant.body(members[0].type);
    const record = nested.tag(nested.props);
    expect(record.members()).toEqual([{ label: "Selected field label", type: packet.rows.at(-1).type, icon: "type-badge" }]);
    expect(record.details().summary).toBe("Details 3");
    expect(callbacks.ownTypeIcon(record.fields()[0].type)).toBe("star");
    expect(record.typeLine(record.fields()[0].type).children.at(-1)).toBe("Selected 5");
    const outputPreview = arrow.props.previewType(arrow.props.output);
    expect(outputPreview.children[0].tag(outputPreview.children[0].props).members()[0].label).toBe("Selected field label");
  });

  test("missing rows, shapes, field labels and synthetic cases fail closed without semantic fallback", () => {
    const { original, packet, callbacks } = packetFixture();
    expect(() => callbacks.typeEntry(structuredClone(packet.root))).toThrow("type preview is unavailable");
    expect(() => callbacks.fieldLabel({ name: "outside packet" })).toThrow("type preview is unavailable");
    expect(() => callbacks.variantCaseType(packet.rows[1].type, 10)).toThrow("type preview is unavailable");
    packet.rows[0].description.previewShape = undefined;
    expect(() => callbacks.shape(original)).toThrow("type preview is unavailable");
    const missing = previewCallbacks(original, undefined);
    expect(() => missing.description(original)).toThrow("type preview is unavailable");
    expect(() => missing.ownTypeIcon(original)).toThrow("type preview is unavailable");
  });

  test("public/account and explicitly different owners keep their direct callback route", () => {
    for (const kind of ["public", "account", "local"]) {
      const type = { $ref: "Unmigrated" }, nested = { $ref: "Nested" };
      const calls = [];
      const field = { name: "stored", key: { $tag: "NamedField", ref: { $ref: "field" } }, type: nested };
      const registry = { getFieldRepresentation(cls, ref) { calls.push([cls, ref]); return { methods: { label: "Existing field label" } }; } };
      const direct = { type, previewShape: { $record: { fields: [field] } } };
      const callbacks = previewCallbacks(type, undefined, {
        completePreview: () => false, projectionInput: () => undefined, reader: { kind },
        session: () => ({ evaluateContext: {} }), registry: () => registry, resolveType: () => undefined,
        projectLocusTypeDescriptions: ({ type }) => { calls.push(type); return [type === direct.type ? direct : { type }]; },
        typedReadTypePresentation: current => { calls.push(current); return { type: current, label: "Existing label" }; },
        typedReadTypeOwnIcon: current => { calls.push(current); return "existing-icon"; },
        valueCardLabel: value => value,
      });
      expect(callbacks.shape(type)).toBe(direct.previewShape);
      expect(callbacks.typeEntry(type).label).toBe("Existing label");
      expect(callbacks.fieldLabel(field)).toBe("Existing field label");
      expect(callbacks.ownTypeIcon(type)).toBe("existing-icon");
      expect(calls).toContainEqual(["Labelable", "field"]);
    }
  });
});

describe("existing strict AST transport scope", () => {
  test("preserves shared AST leaves and Bytes while refusing executable output", () => {
    const bytes = new Uint8Array([0, 255]);
    const leaf = { $ref: "physical-owner" };
    const input = { root: { type: { $arrow: { params: [{ type: leaf }], returns: leaf } } }, bytes, sameBytes: bytes };
    const copied = snapshot(input, "C1 type input");
    expect(copied.root.type.$arrow.params[0].type).toBe(copied.root.type.$arrow.returns);
    expect(copied.bytes).toBe(copied.sameBytes);
    expect(copied.bytes).not.toBe(bytes);
    expect([...copied.bytes]).toEqual([0, 255]);
    expect(() => snapshot({ descriptions: [{ host: () => true }] }, "C1 type result")).toThrow("executable transport");
  });

  test("refuses accessors before reading them and does not promise arbitrary value parity", () => {
    let reads = 0;
    const type = {};
    Object.defineProperty(type, "$ref", { enumerable: true, get() { reads++; return "hidden"; } });
    expect(() => snapshot({ type }, "C1 type input")).toThrow("accessor property");
    expect(reads).toBe(0);
    const cycle = {}; cycle.self = cycle;
    expect(() => snapshot(cycle, "C1 cycle")).toThrow("cyclic transport");
    expect(() => snapshot(new Date(0), "C1 date")).toThrow("non-plain transport");
    expect(() => snapshot(new Array(1), "C1 sparse")).toThrow("sparse array slot");
    expect(Object.keys(snapshot({ b: 1, a: 2 }, "C1 order"))).toEqual(["a", "b"]);
  });
});

describe("worker type preview packet construction", () => {
  test("one complete raw-tree observation supplies descendant descriptions and syntax plans once", () => {
    const h = producerFixture();
    const leaf = { $ref: "Leaf" };
    const nestedArrow = { $arrow: { params: [{ name: "input", type: leaf }], returns: leaf } };
    const record = { $record: { fields: [{ name: "callback", type: nestedArrow }] } };
    const root = { $arrow: { params: [{ name: "record", type: record }], returns: leaf } };
    const nodes = [root, record, nestedArrow, leaf];
    const descriptions = nodes.map(type => ({ type, previewShape: type }));
    h.plans.set(root, nodes);
    h.state.describe = type => {
      expect(type).toBe(root);
      return descriptions;
    };
    const packet = h.project(root, h.session, "registry", h.source, []);
    expect(h.projections).toHaveLength(1);
    expect(h.walks).toHaveLength(1);
    expect(packet.rows.map(row => row.type)).toEqual(nodes);
    packet.rows.forEach((row, index) => {
      expect(row.description).toEqual(descriptions[index]);
      expect(row.description.type).toBe(nodes[index]);
      expect(row.description.previewShape).toBe(nodes[index]);
    });
    expect(packet.fieldLabels.map(row => row.label)).toEqual(["record", "callback", "input"]);
  });

  test("uses the existing syntax/projector owners and includes observed fields, variant records and arrow returns", () => {
    const h = producerFixture();
    const leaf = { $ref: "Leaf" }, root = { $ref: "Root" }, returned = { $ref: "Returned" };
    const caseField = { name: "value", type: leaf };
    const variant = { $variant: { cases: [{ name: "Some", fields: [caseField] }, { name: "None", fields: [] }] } };
    const param = { name: "arg", type: leaf };
    const arrow = { $arrow: { params: [param], returns: returned } };
    const named = { name: "stored", key: { $tag: "NamedField", ref: { $ref: "named-field" } }, type: variant };
    const functionField = { name: "callback", type: arrow };
    const returnedField = { name: "result", type: leaf };
    const shape = { $record: { fields: [named, functionField] } };
    const returnedShape = { $record: { fields: [returnedField] } };
    h.plans.set(root, [root]); h.plans.set(shape, [shape, variant, leaf, arrow, returned]);
    h.plans.set(variant, [variant, leaf]); h.plans.set(arrow, [arrow, leaf, returned]);
    h.plans.set(returnedShape, [returnedShape, leaf]);
    h.descriptions.set(root, { type: root, previewShape: shape });
    h.descriptions.set(returned, { type: returned, previewShape: returnedShape });
    const packet = h.project(root, h.session, "registry", h.source, ["star", "utensils"]);
    expect(packet.root).toBe(root);
    expect(packet.rows.map(row => row.type)).toContain(arrow);
    expect(packet.rows.map(row => row.type)).toContain(returned);
    expect(packet.rows.map(row => row.type)).toContain(leaf);
    expect(packet.rows.some(row => row.type === shape)).toBe(false);
    const variantRow = packet.rows.find(row => row.type === variant);
    expect(variantRow.caseRecords).toHaveLength(2);
    expect(variantRow.caseRecords[0].$record.fields).toBe(variant.$variant.cases[0].fields);
    expect(variantRow.caseRecords.every(type => packet.rows.some(row => row.type === type))).toBe(true);
    expect(packet.fieldLabels.map(row => row.field)).toEqual([named, functionField, caseField, param, returnedField]);
    expect(packet.fieldLabels[0].label).toBe("Selected named-field");
    expect(packet.fieldLabels[1].label).toBe("callback");
    expect(h.labels).toEqual([{ cls: "Labelable", ref: "named-field" }]);
    expect(h.walks.every(call => call.name === "engine:walkTypePlan" && call.frame === h.frame && call.args[1].length === 0)).toBe(true);
    expect(h.projections.every(call => call.printSource.evaluateContext === h.frame && call.resolveName === undefined && call.resolveCode === undefined)).toBe(true);
    expect(h.reader.captured).toEqual({ ...h.source, registry: h.registry, session: h.session });
    expect(h.presentations.every(call => call.session === h.session && call.reader === h.reader && call.registry === h.registry)).toBe(true);
    expect(h.presentations[0].knownIcons).toEqual({ star: true, utensils: true });
    for (const row of packet.rows) {
      expect(row.type).toBe(row.description.type);
      expect(row.type).toBe(row.presentation.type);
    }
    const copied = snapshot(packet, "type preview packet");
    expect(copied.root).toBe(copied.rows[0].type);
    const copiedVariant = copied.rows.find(row => row.type === copied.rows[0].description.previewShape.$record.fields[0].type);
    expect(copiedVariant.caseRecords[0].$record.fields[0]).toBe(copied.fieldLabels[2].field);
  });

  test("fresh recursive reference carriers reuse their captured declaration without unbounded projection", () => {
    const h = producerFixture();
    const root = { $ref: "Recursive" };
    h.state.describe = type => ({ type, previewShape: { $record: { fields: [
      { name: "next", type: { $ref: "Recursive" } },
    ] } } });
    // Every fresh shape has one newly materialized reference child. Retaining
    // the first captured declaration must terminate this otherwise open chain.
    h.state.walk = type => "$record" in type ? [type, type.$record.fields[0].type] : [type];
    const packet = h.project(root, h.session, "session", h.source, []);
    expect(h.projections).toHaveLength(1);
    expect(packet.rows).toHaveLength(2);
    expect(packet.rows[0].type).toBe(root);
    expect(packet.rows[1].type).not.toBe(root);
    expect(packet.rows[1].type.$ref).toBe("Recursive");
    expect(packet.rows[1].description.previewShape).toBe(packet.rows[0].description.previewShape);
    expect(packet.fieldLabels).toHaveLength(1);
    expect(h.walks.length).toBeLessThan(6);
  });

  test("fresh equal primitive shapes terminate and explicit registry misses never borrow session fallback", () => {
    const h = producerFixture();
    const left = { $ref: "Primitive" }, right = { $ref: "Primitive" };
    const root = { $arrow: { params: [{ name: "input", type: left }], returns: right } };
    h.plans.set(root, [root, left, right]);
    h.state.describe = type => "$ref" in type
      ? { type, previewShape: { $opaque: { name: "Primitive", pure: { $variant: { cases: [] } } } } }
      : { type, previewShape: type };
    const packet = h.project(root, h.session, "registry", h.source, []);
    expect(packet.rows).toHaveLength(3);
    expect(h.projections).toHaveLength(2);
    expect(packet.rows[1].description.previewShape).toBe(packet.rows[2].description.previewShape);
    expect(h.projections[0].resolveType("missing")).toBeUndefined();
    expect(h.fallbackReads).toHaveLength(0);
    h.project({ $ref: "Other" }, h.session, "session", h.source, []);
    expect(h.projections.at(-1).resolveType("missing")).toEqual({ $ref: "environment-type" });
    expect(h.fallbackReads).toEqual([{ $ref: "missing" }]);
    expect(h.projections[0].printSource.referenceRoutes).toEqual(["reference"]);
    expect(h.projections[0].printSource.constructorRoutes).toEqual(["constructor"]);
    expect(h.projections[0].printSource.constructorTargets).toEqual(["target"]);
  });

  test("invalid marshalled syntax and unavailable descriptions refuse without inventing packet facts", () => {
    const h = producerFixture();
    expect(() => h.project({ invalid: true }, h.session, "session", h.source, [])).toThrow("invalid type carrier");
    expect(h.projections).toHaveLength(0);
    h.state.describe = () => undefined;
    expect(() => h.project({ $ref: "Missing" }, h.session, "session", h.source, [])).toThrow("type description is unavailable");
    expect(h.presentations).toHaveLength(0);
    h.state.describe = type => ({ type: structuredClone(type) });
    expect(() => h.project({ $ref: "Changed" }, h.session, "session", h.source, [])).toThrow("type description is unavailable");
  });
});
