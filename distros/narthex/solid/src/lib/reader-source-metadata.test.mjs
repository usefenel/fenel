import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// Match the established actual-source fixture's engine initialization order.
// Importing these modules does not build or initialize a registry.
import "../../../../../implementations/typescript/engine/src/fenel-module.ts";
import { ownDataRead } from "../../../../../implementations/typescript/engine/src/json-logic.ts";
import "../../../../../fenel/modules/std/ffi/std-ffi.ts";
const stage = text => { if (process.env.FENEL_METADATA_TEST_DIAGNOSTICS) console.log(text); };
stage("Loading canonical expression codec");
const { observeExprNode } = await import("../../../../../implementations/typescript/engine/src/authoring/expression-authoring.ts");
stage("Loading reader reflection leaf");
const { readerSourceMetadataNative } = await import("../../../../../fenel/modules/view/ffi/source-metadata.ts");
stage("Reading production facade identity boundary");

// Actual canonical codec observer + host packet/lifetime adapter bodies. Load
// their source through the existing Bun.Transpiler extraction pattern so the
// unrelated account session environment barrel cannot initialize a registry.
// Facade identity functions below are the actual production bodies, isolated
// from that environment import; no alternative semantic query is supplied.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const sessionSource = readFileSync(new URL("./expression-runner/account-authoring-session.ts", import.meta.url), "utf8");
const sessionFrom = sessionSource.indexOf("const facadeSources =");
const sessionTo = sessionSource.indexOf("export type AccountAuthoringScope", sessionFrom);
if (sessionFrom < 0 || sessionTo < 0) throw new Error("Concrete session source boundary moved");
const { registerAuthoringSessionFacade, concreteAuthoringSession } = new Function(
  transpiler.transformSync(sessionSource.slice(sessionFrom, sessionTo)).replaceAll("export ", "")
    + "; return { registerAuthoringSessionFacade, concreteAuthoringSession };")();
stage("Reading production metadata adapter");
const adapterSource = readFileSync(new URL("./reader-source-metadata.ts", import.meta.url), "utf8");
const adapterFrom = adapterSource.indexOf("export function sourceExecutableSlots(");
if (adapterFrom < 0) throw new Error("Reader metadata adapter source boundary moved");
const { sourceExecutableSlots, readerSourceMetadataPacket, assertReaderSourceMetadata,
  captureReaderSourceMetadata, readerSourceMetadataFrame } = new Function("observeExprNode", "concreteAuthoringSession", "ownDataRead",
  transpiler.transformSync(adapterSource.slice(adapterFrom)).replaceAll("export ", "")
    + "; return { sourceExecutableSlots, readerSourceMetadataPacket, assertReaderSourceMetadata, captureReaderSourceMetadata, readerSourceMetadataFrame };")
  (observeExprNode, concreteAuthoringSession, ownDataRead);
stage("Running metadata transport cases");

// No registry, reader construction, worker, account, storage or image evaluator.
const source = { $tag: "ThisTabSource" };
const literal = value => ({ kind: "literal", value });
const ref = savedExprId => ({ kind: "ref", savedExprId });
const call = (fnId, ...args) => ({ kind: "call", fnId, args });
const Nothing = { $tag: "Nothing" };
const slots = (...rows) => rows;
const reference = identity => ({ $tag: "SourceReference", identity });
const fieldReference = (identity, field) => ({ $tag: "SourceFieldReference", identity, field });
const callable = identity => ({ $tag: "SourceCall", identity });
const observedLiteral = { $tag: "SourceLiteral" };

describe("canonical executable-slot metadata transport", () => {
  test("a shared reference node keeps each authored outer relation", () => {
    const person = ref("person");
    const project = literal({ __record: { fields: [
      { name: "founders", value: literal({ __list: [person] }) },
      { name: "maintainers", value: literal({ __list: [person] }) },
    ] } });
    const named = sourceExecutableSlots(project).filter(slot => slot.$tag === "SourceFieldReference");
    expect(named.some(slot => slot.identity === "person" && slot.field === "founders")).toBe(true);
    expect(named.some(slot => slot.identity === "person" && slot.field === "maintainers")).toBe(true);
    expect(named.every(slot => slot.identity === "person" && ["founders", "maintainers"].includes(slot.field))).toBe(true);
  });

  test("reserved-key authored records expose their actual fields without a synthetic record-constructor dependency", () => {
    const source = literal({ __record: { fields: [
      { name: "$", value: literal({ $ref: "application-function" }) },
      { name: "contents", value: call("actual-source", ref("saved-input")) },
    ] } });
    expect(sourceExecutableSlots(source)).toEqual([
      { $tag: "SourceCodeReference", identity: "application-function" },
      reference("saved-input"), callable("actual-source"), observedLiteral,
    ]);
  });

  test("transports each real codec notification and leaves literals and parameters as payload-free facts", () => {
    expect(sourceExecutableSlots(call("std:reverse", ref("saved-text"), literal("sample"), { kind: "param", name: "input" })))
      .toEqual(slots(reference("saved-text"), observedLiteral, { $tag: "SourceParameter" }, callable("std:reverse")));
  });

  test("only executable structural slots contribute references and calls", () => {
    const dormant = { kind: "call", fnId: "never-call", args: [ref("never-ref")] };
    const annotated = literal({ __ann: { expr: call("real-call", ref("real-ref")), type: { $el: dormant } } });
    expect(sourceExecutableSlots(annotated)).toEqual([reference("real-ref"), callable("real-call"), observedLiteral]);
    for (const value of [{ nested: dormant }, [dormant], { $tag: "Box", _0: dormant }, { $ref: "value-ref", nested: dormant },
      { __fenelFn: true, params: [], body: dormant }, { __fenelPartial: true, args: [dormant] },
      { __var: { path: "input", fallback: dormant, arrayForm: true } }]) {
      expect(sourceExecutableSlots(literal(value))).toEqual([observedLiteral]);
    }
    const structural = literal({ __record: { fields: [{ name: "field", value: ref("field-ref") },
      { name: "nested", value: literal({ __list: [call("nested-call", literal(1))] }) }] } });
    expect(sourceExecutableSlots(structural)).toEqual([fieldReference("field-ref", "field"), observedLiteral,
      callable("nested-call"), observedLiteral, observedLiteral]);
  });

  test("an unreadable executable carrier records refusal alongside prior notifications", () => {
    const invalid = { kind: "unrecognized-expression" };
    const result = sourceExecutableSlots(call("outer-call", ref("visible-ref"), invalid));
    expect(result[0]).toEqual(reference("visible-ref"));
    expect(result.at(-1)?.$tag).toBe("SourceUnknown");
    expect(result.at(-1)?.issue).toContain("Invalid authoring expression kind");
    expect(result).not.toContainEqual(callable("outer-call"));
  });

  test("a named-field constructor head is a constructor slot; its fields keep their references", () => {
    // The codec stores every named-field record construction this way
    // (expression-authoring.ts logicToExprNode). Its head is the retained
    // constructor tag, never a dynamic callable, so it is not a coverage gap.
    const linked = literal({ __construct: { tag: "NamedConstructor", fields: [
      { name: "field", value: ref("retained-child-ref") },
      { name: "items", value: literal({ __list: [ref("listed-ref"), literal("text")] }) }] } });
    expect(sourceExecutableSlots(linked)).toEqual([fieldReference("retained-child-ref", "field"), fieldReference("listed-ref", "items"),
      observedLiteral, observedLiteral, { $tag: "SourceConstructor", identity: "NamedConstructor" }]);
    for (const malformed of [{ tag: "", fields: [] }, { tag: 42, fields: [] }, { fields: [] }]) {
      const observed = sourceExecutableSlots(literal({ __construct: malformed }));
      expect(observed.some(slot => slot.$tag === "SourceConstructor")).toBe(false);
    }
  });

  test("a reference names the outermost field of the expression's own record; call arguments name none", () => {
    const emblem = literal({ __construct: { tag: "Emblem", fields: [{ name: "plant", value: ref("giant-fennel") }] } });
    const project = literal({ __construct: { tag: "SoftwareProject", fields: [
      { name: "founders", value: literal({ __list: [ref("rom")] }) },
      { name: "maintainers", value: literal({ __list: [ref("rom")] }) },
      { name: "emblems", value: literal({ __list: [emblem] }) }] } });
    expect(sourceExecutableSlots(project).filter(slot => slot.$tag === "SourceFieldReference"))
      .toEqual([fieldReference("rom", "founders"), fieldReference("rom", "maintainers"), fieldReference("giant-fennel", "emblems")]);
    expect(sourceExecutableSlots(call("std:reverse", ref("saved-text")))).toEqual([reference("saved-text"), callable("std:reverse")]);
    // A field value's payload is never read for names: only carriers are walked.
    const payload = literal({ __construct: { tag: "Box", fields: [{ name: "data", value: literal({ nested: ref("dormant") }) }] } });
    expect(sourceExecutableSlots(payload).some(slot => slot.identity === "dormant")).toBe(false);
  });

  test("an application whose callable positions are occurrences is an application slot; head and inputs keep their own slots", () => {
    const application = { $tag: "SourceApplication" };
    const parameter = { $tag: "SourceParameter" };
    // "Apply this function": the selected data bound once, then applied.
    const applied = literal({ __do: [
      literal({ __let: { bindings: [{ name: "selectedFunction", expr: ref("saved-function") }] } }),
      literal({ __apply: { target: { kind: "param", name: "selectedFunction" }, args: [ref("saved-input")], syntax: "call" } }),
    ] });
    const observed = sourceExecutableSlots(applied);
    expect(observed).toContainEqual(reference("saved-function"));
    expect(observed).toContainEqual(reference("saved-input"));
    expect(observed).toContainEqual(application);
    expect(observed.some(slot => slot.$tag === "SourceUnknown")).toBe(false);
    expect(sourceExecutableSlots(literal({ __apply: { target: ref("saved-function"), args: [literal(1)] } })))
      .toEqual([reference("saved-function"), observedLiteral, application]);
    expect(sourceExecutableSlots(literal({ __apply: { target: call("std:compose", ref("first"), ref("second")), args: [], syntax: "apply" } })))
      .toEqual([reference("first"), reference("second"), callable("std:compose"), application]);
    const lambdaHead = literal({ __lambda: { params: ["x"], body: call("std:reverse", { kind: "param", name: "x" }), arrayParams: true } });
    expect(sourceExecutableSlots(literal({ __apply: { target: lambdaHead, args: [ref("saved-input")], syntax: "dollar" } })))
      .toEqual([parameter, callable("std:reverse"), observedLiteral, reference("saved-input"), application]);
    for (const binary of [false, true]) {
      expect(sourceExecutableSlots(literal({ __pipe: { value: ref("saved-input"), steps: [{ kind: "param", name: "stage" }, call("std:reverse")], binary } })))
        .toEqual([reference("saved-input"), parameter, callable("std:reverse"), application]);
    }
    // A head named by code identity is the call it makes, never a vanished node.
    const code = identity => ({ $tag: "SourceCodeReference", identity });
    expect(sourceExecutableSlots(literal({ __apply: { target: literal({ $ref: "code-identity" }), args: [ref("saved-input")] } })))
      .toEqual([code("code-identity"), reference("saved-input"), callable("code-identity"), application]);
    expect(sourceExecutableSlots(literal({ __pipe: { value: ref("saved-input"), steps: [{ kind: "param", name: "stage" }, literal({ $ref: "code-identity" })], binary: true } })))
      .toEqual([reference("saved-input"), parameter, code("code-identity"), callable("code-identity"), application]);
    // The checkpoint-3 grouping card: a catalogue function bound by a local
    // name, then applied. The bound code identity keeps its own slot.
    const grouped = literal({ __do: [
      literal({ __let: { bindings: [{ name: "row", expr: literal({ $ref: "count-by-key" }) }] } }),
      literal({ __apply: { target: { kind: "param", name: "row" }, syntax: "call", args: [
        literal({ __lambda: { params: ["row"], body: { kind: "param", name: "row.person" }, arrayParams: true } }), ref("saved-input")] } }),
    ] });
    const groupedSlots = sourceExecutableSlots(grouped);
    expect(groupedSlots).toContainEqual(code("count-by-key"));
    expect(groupedSlots).toContainEqual(reference("saved-input"));
    expect(groupedSlots).toContainEqual(application);
    expect(groupedSlots.some(slot => slot.$tag === "SourceUnknown")).toBe(false);
    // Only an exact single-key code identity is one; other tagged data stays inert.
    expect(sourceExecutableSlots(literal({ $ref: "type-identity" }))).toEqual([code("type-identity")]);
    expect(sourceExecutableSlots(literal({ $ref: "" }))).toEqual([observedLiteral]);
  });

  test("a short-circuit form is structure: its operands keep their slots and nothing is refused", () => {
    const application = { $tag: "SourceApplication" };
    // The recipe starter's body: `if all essentials has then ... else []`.
    expect(sourceExecutableSlots(literal({ __operator: { op: "if", args: [
      call("std:all", ref("saved-essentials"), { kind: "param", name: "has" }), ref("saved-then"), literal({ __list: [] })] } })))
      .toEqual([reference("saved-essentials"), { $tag: "SourceParameter" }, callable("std:all"), reference("saved-then"),
        observedLiteral, application]);
    for (const op of ["if", "?:", "and", "or"]) {
      const observed = sourceExecutableSlots(literal({ __operator: { op, args: [ref("saved-left"), call("std:not", ref("saved-right"))] } }));
      expect(observed).toEqual([reference("saved-left"), reference("saved-right"), callable("std:not"), application]);
    }
    // Any other operator key may name a callable this transport cannot identify.
    for (const op of ["custom-operation", "method", "call", "map", "add"]) {
      expect(sourceExecutableSlots(literal({ __operator: { op, args: [ref("saved-left")] } })).at(-1)?.$tag).toBe("SourceUnknown");
    }
  });

  test("literal executable heads without a retained exact function identity refuse instead of disappearing", () => {
    // A callable position that the codec passes through as data (a code
    // identity, a closure value, a scalar) has no slot of its own, and an
    // operator key is not an occurrence: these keep the refusal.
    const executable = [
      literal({ __apply: { target: literal({ __fenelFn: true, params: [], body: call("hidden-call") }), args: [] } }),
      literal({ __apply: { target: literal("not-a-function"), args: [literal(1)], syntax: "apply" } }),
      literal({ __apply: { target: literal({ $ref: "code-identity", extra: true }), args: [literal(1)] } }),
      literal({ __operator: { op: "custom-operation", args: [literal(1)] } }),
      literal({ __pipe: { value: literal(1), steps: [{ kind: "param", name: "stage" }, literal({ __fenelFn: true, params: [], body: call("hidden-call") })] } }),
      literal({ __pipe: { value: literal(1), steps: [literal(7)], binary: true } }),
    ];
    for (const expression of executable) {
      const observed = sourceExecutableSlots(expression);
      expect(observed.some(slot => slot.$tag === "SourceUnknown")).toBe(true);
      expect(observed.at(-1)?.$tag).not.toBe("SourceLiteral");
    }
    expect(sourceExecutableSlots(call("exact-constructor-function", ref("retained-child-ref"))))
      .toEqual([reference("retained-child-ref"), callable("exact-constructor-function")]);
  });

  test("large image literals never enter the packet or trigger enumeration, copying or evaluation", () => {
    let payloadInspections = 0;
    const bytes = new Uint8Array(4 * 1024 * 1024);
    const opaqueNested = new Proxy({ bytes, sourceLikeData: call("not-executable", ref("not-a-source")) }, {
      ownKeys() { payloadInspections++; throw new Error("Large literal payload was traversed"); },
      getOwnPropertyDescriptor() { payloadInspections++; throw new Error("Large literal payload was copied"); },
    });
    const image = { $tag: "Image", bytes, opaqueNested };
    const expressions = [{ id: "image", label: "Image", expression: literal(image) },
      { id: "consumer", label: "Consumer", expression: call("real-operation", ref("image")) }];
    const occurrences = [{ $tag: "SourceOccurrenceMetadata", id: "image-occurrence", label: "Image", expressionId: "image", referenceId: Nothing }];
    const callableLabels = [{ $tag: "DependencyNode", id: "real-operation", label: "Operation" }];
    const packet = readerSourceMetadataPacket(source, "root", "generation-1", { expressions, occurrences, callableLabels });
    expect(packet.expressions).toEqual([
      { $tag: "SourceExpressionMetadata", id: "image", label: "Image", slots: [observedLiteral] },
      { $tag: "SourceExpressionMetadata", id: "consumer", label: "Consumer", slots: [reference("image"), callable("real-operation")] },
    ]);
    expect(packet.occurrences).toEqual(occurrences);
    expect(packet.callableLabels).toEqual(callableLabels);
    expect(packet.source).toEqual(source);
    expect(packet.occurrences).not.toBe(occurrences);
    expect(packet.callableLabels).not.toBe(callableLabels);
    expect(packet.source).not.toBe(source);
    expect(expressions[0].expression.value).toBe(image);
    expect(image.bytes).toBe(bytes);
    expect(payloadInspections).toBe(0);
    const encoded = JSON.stringify(packet);
    expect(encoded.length).toBeLessThan(1500);
    for (const absent of ["Uint8Array", "opaqueNested", "sourceLikeData", "not-executable", "not-a-source", "bytes"]) expect(encoded).not.toContain(absent);
  });

  test("only declared metadata fields cross the packet boundary and the captured packet cannot drift", () => {
    const callback = () => { throw new Error("Host callback must not cross into a Fenel value"); };
    const source = { $tag: "AccountSource", accountId: "reader-a", callback, payload: new Uint8Array(16) };
    const referenceId = { $tag: "Just", _0: "saved", callback };
    const occurrence = { $tag: "SourceOccurrenceMetadata", id: "occurrence", label: "Data", expressionId: "expr", referenceId, callback };
    const callableLabel = { $tag: "DependencyNode", id: "operation", label: "Operation", callback };
    const roster = { expressions: [{ id: "expr", label: "Data", expression: literal(1), callback }],
      occurrences: [occurrence], callableLabels: [callableLabel], callback };
    const packet = readerSourceMetadataPacket(source, "root", "generation-1", roster);
    expect(Object.keys(packet.source).sort()).toEqual(["$tag", "accountId"]);
    expect(Object.keys(packet.occurrences[0]).sort()).toEqual(["$tag", "expressionId", "id", "label", "referenceId"]);
    expect(Object.keys(packet.occurrences[0].referenceId).sort()).toEqual(["$tag", "_0"]);
    expect(Object.keys(packet.callableLabels[0]).sort()).toEqual(["$tag", "id", "label"]);
    expect(Object.keys(packet.expressions[0]).sort()).toEqual(["$tag", "id", "label", "slots"]);
    source.accountId = "reader-b"; occurrence.label = "Changed data"; referenceId._0 = "changed"; callableLabel.label = "Changed operation";
    expect(packet.source.accountId).toBe("reader-a");
    expect(packet.occurrences[0].label).toBe("Data");
    expect(packet.occurrences[0].referenceId._0).toBe("saved");
    expect(packet.callableLabels[0].label).toBe("Operation");
    for (const value of [packet, packet.source, packet.expressions, packet.expressions[0], packet.expressions[0].slots,
      packet.expressions[0].slots[0], packet.occurrences, packet.occurrences[0], packet.occurrences[0].referenceId,
      packet.callableLabels, packet.callableLabels[0]]) expect(Object.isFrozen(value)).toBe(true);
  });
});

describe("reader metadata capture admission and frame replacement", () => {
  function fixture() {
    const session = {};
    const packet = readerSourceMetadataPacket(source, "root", "generation-1", { expressions: [], occurrences: [], callableLabels: [] });
    let active = true;
    const capture = { session, packet, generationToken: {}, current: () => active };
    const supplied = { captureSourceMetadata: () => capture };
    registerAuthoringSessionFacade(supplied, () => session);
    return { session, supplied, packet, capture, retire: () => { active = false; } };
  }

  test("a facade admits only the exact concrete reader's current packet", () => {
    const value = fixture();
    expect(captureReaderSourceMetadata(value.supplied)).toBe(value.capture);
    expect(() => assertReaderSourceMetadata(value.capture, value.supplied)).not.toThrow();
    expect(() => assertReaderSourceMetadata(value.capture, {})).toThrow("current reader");
    const crossReader = { captureSourceMetadata: () => value.capture };
    expect(() => captureReaderSourceMetadata(crossReader)).toThrow("current reader");
  });

  test("retired or replaced readers refuse their old capture without returning its last packet", () => {
    const value = fixture();
    const captured = captureReaderSourceMetadata(value.supplied);
    value.retire();
    expect(() => assertReaderSourceMetadata(captured, value.supplied)).toThrow("current reader");
    expect(() => captureReaderSourceMetadata(value.supplied)).toThrow("current reader");
    const other = fixture();
    expect(() => assertReaderSourceMetadata(captured, other.supplied)).toThrow("current reader");
  });

  test("source absence shadows any prior packet in a reused evaluation context", () => {
    const value = fixture();
    const initial = { _readerSourceMetadata: value.packet };
    expect(captureReaderSourceMetadata({})).toBeUndefined();
    expect(readerSourceMetadataNative({ ...initial, ...readerSourceMetadataFrame() })).toEqual(Nothing);
    const frame = readerSourceMetadataFrame(value.capture);
    expect(Object.hasOwn(frame, "_readerSourceMetadata")).toBe(true);
    expect(frame._readerSourceMetadata).toBe(value.packet);
    expect(readerSourceMetadataNative({ ...initial, ...frame })._0).toBe(value.packet);
  });

  test("the packet contains data while its host lifetime token and callbacks stay outside it", () => {
    const value = fixture();
    expect(readerSourceMetadataFrame(value.capture)).toEqual({ _readerSourceMetadata: value.packet });
    const encoded = JSON.stringify(value.packet);
    for (const absent of ["current", "session", "generationToken", "captureSourceMetadata"]) expect(encoded).not.toContain(absent);
  });
});

describe("actual LocalTabSource capture method with controlled source-owner ports", () => {
  // This is the exact production method, not createBrowserDataSource or Local
  // acquisition. Owner readiness/state/read/root/saved/project ports are
  // controlled here; the codec and packet transport are actual production.
  // The pure dependencyMetadataRoster body has separate real-source tests.
  const localSource = readFileSync(new URL("./local-locus-data.ts", import.meta.url), "utf8");
  const from = localSource.indexOf("  const captureSourceMetadata =");
  const to = localSource.indexOf("  const prepareSnapshot =", from);
  if (from < 0 || to < 0) throw new Error("Local source metadata method boundary moved");
  const install = new Function("ports", transpiler.transformSync(`
    let state = ports.state, snapshot = ports.snapshot, captureMetadataPacket = ports.captureMetadataPacket;
    let metadataGeneration = 0, metadataCapture;
    const options = ports.options;
    const assertActive = () => ports.assertActive();
    const read = () => { ports.read(); return state; };
    const root = () => ports.root();
    const savedValues = () => ports.savedValues();
    const project = (name, ...args) => ports.project(name, ...args);
    const cachedPublication = () => ports.cachedPublication();
    ${localSource.slice(from, to)}
    return { capture: captureSourceMetadata, cache: () => metadataCapture, generation: () => metadataGeneration,
      setState: value => { state = value; }, setSnapshot: value => { snapshot = value; },
      state: () => state, snapshot: () => snapshot };
  `));

  function fixture(changes = {}) {
    let closed = false, epoch = 7, readCalls = 0, packetCalls = 0, projectionHook;
    const session = { catalog: { functions: [{ id: "alias", targetId: "exact-call", label: "Call" }, { id: "fallback-id", label: "Fallback" }] } };
    const snapshot = { session };
    const state = { revision: 3 };
    const projectedRoot = { id: "local-root" };
    const saved = [{ id: "saved-source" }];
    const projectCalls = [];
    const roster = changes.roster ?? { expressions: [{ id: "source", label: "Data", expression: literal(1) }],
      occurrences: [], callableLabels: [] };
    const ports = {
      state: Object.hasOwn(changes, "state") ? changes.state : state,
      snapshot: Object.hasOwn(changes, "snapshot") ? changes.snapshot : snapshot,
      options: changes.options ?? { metadataSource: source },
      captureMetadataPacket: Object.hasOwn(changes, "captureMetadataPacket") ? changes.captureMetadataPacket
        : (...args) => { packetCalls++; return readerSourceMetadataPacket(...args); },
      assertActive: () => { if (closed) throw new Error("Source was closed"); if (epoch !== 7) throw new Error("Source epoch changed"); },
      read: () => { readCalls++; }, root: () => projectedRoot, savedValues: () => saved,
      project: (name, ...args) => { projectCalls.push({ name, args }); projectionHook?.(); return roster; },
      cachedPublication: () => { projectCalls.push({ name: "cachedPublication", args: [] }); projectionHook?.(); return { root: projectedRoot, dependencyRoster: roster }; },
    };
    const owner = install(ports);
    return { ...owner, session, projectedRoot, saved, roster, projectCalls, readCalls: () => readCalls, packetCalls: () => packetCalls,
      close: () => { closed = true; }, changeEpoch: () => { epoch++; }, projectHook: hook => { projectionHook = hook; } };
  }

  test("unprepared metadata source, reader snapshot or packet transport stays unavailable", () => {
    for (const options of [{ options: {} }, { snapshot: undefined }, { captureMetadataPacket: undefined }]) {
      const owner = fixture(options);
      expect(owner.capture()).toBeUndefined();
      expect(owner.cache()).toBeUndefined();
      expect(owner.readCalls()).toBe(0);
      expect(owner.projectCalls).toEqual([]);
    }
  });

  test("the exact same state and snapshot reuse one immutable packet while retaining the read dependency", () => {
    const owner = fixture();
    const first = owner.capture(), second = owner.capture();
    expect(second).toBe(first);
    expect(second.packet).toBe(first.packet);
    expect(second.generationToken).toBe(first.generationToken);
    expect(Object.isFrozen(first.generationToken)).toBe(true);
    expect(owner.readCalls()).toBe(2);
    expect(owner.packetCalls()).toBe(1);
    expect(owner.projectCalls).toHaveLength(1);
    expect(owner.projectCalls[0]).toEqual({ name: "cachedPublication", args: [] });
    expect(first.session).toBe(owner.session);
    expect(first.packet.source).toEqual(source);
    expect(first.packet.rootId).toBe("local-root");
    expect(first.current()).toBe(true);
  });

  test("equal-revision replacement state and replacement snapshot retire their prior packet and token", () => {
    const owner = fixture();
    const first = owner.capture();
    owner.setState({ ...owner.state() });
    const second = owner.capture();
    expect(first.current()).toBe(false);
    expect(second.packet).not.toBe(first.packet);
    expect(second.generationToken).not.toBe(first.generationToken);
    expect(second.packet.generation).not.toBe(first.packet.generation);
    owner.setSnapshot({ ...owner.snapshot() });
    const third = owner.capture();
    expect(second.current()).toBe(false);
    expect(third.packet).not.toBe(second.packet);
    expect(third.generationToken).not.toBe(second.generationToken);
    expect(third.packet.generation).not.toBe(second.packet.generation);
    expect(third.current()).toBe(true);
    expect(owner.packetCalls()).toBe(3);
    expect(owner.projectCalls).toHaveLength(3);
  });

  test("source close and epoch replacement refuse capture and make the existing current callback false", () => {
    for (const action of ["close", "changeEpoch"]) {
      const owner = fixture();
      const captured = owner.capture();
      owner[action]();
      expect(captured.current()).toBe(false);
      expect(() => owner.capture()).toThrow(action === "close" ? "closed" : "epoch changed");
      expect(owner.packetCalls()).toBe(1);
    }
  });

  test("state or snapshot drift during projection refuses before any new cache publication", () => {
    for (const axis of ["state", "snapshot"]) {
      const owner = fixture();
      owner.projectHook(() => axis === "state" ? owner.setState({ ...owner.state() }) : owner.setSnapshot({ ...owner.snapshot() }));
      expect(() => owner.capture()).toThrow("changed while its metadata was being captured");
      expect(owner.cache()).toBeUndefined();
      owner.projectHook(undefined);
      const recovered = owner.capture();
      expect(owner.cache().value).toBe(recovered);
      expect(recovered.current()).toBe(true);
      expect(owner.packetCalls()).toBe(2);
    }
    const closed = fixture();
    closed.projectHook(() => closed.close());
    expect(() => closed.capture()).toThrow("closed");
    expect(closed.cache()).toBeUndefined();
  });

  test("a captured Local packet belongs only to its exact admitted session", () => {
    const owner = fixture();
    const captured = owner.capture();
    expect(() => assertReaderSourceMetadata(captured, owner.session)).not.toThrow();
    expect(() => assertReaderSourceMetadata(captured, {})).toThrow("current reader");
    const another = fixture();
    expect(() => assertReaderSourceMetadata(captured, another.session)).toThrow("current reader");
    const crossReader = { captureSourceMetadata: () => captured };
    expect(() => captureReaderSourceMetadata(crossReader)).toThrow("current reader");
  });

  test("the source method's actual packet transport never reads or clones large literal image payloads", () => {
    let inspected = 0;
    const bytes = new Uint8Array(4 * 1024 * 1024);
    const opaque = new Proxy({ bytes }, { ownKeys() { inspected++; throw new Error("Image payload enumerated"); },
      getOwnPropertyDescriptor() { inspected++; throw new Error("Image payload copied"); } });
    const image = { $tag: "Image", bytes, opaque };
    const expression = literal(image);
    const owner = fixture({ roster: { expressions: [{ id: "image", label: "Image", expression }], occurrences: [], callableLabels: [] } });
    const captured = owner.capture();
    expect(captured.packet.expressions[0].slots).toEqual([observedLiteral]);
    expect(inspected).toBe(0);
    expect(expression.value).toBe(image);
    expect(image.bytes).toBe(bytes);
    expect(JSON.stringify(captured.packet).length).toBeLessThan(1000);
    expect(JSON.stringify(captured.packet)).not.toContain("bytes");
    expect(owner.capture()).toBe(captured);
    expect(owner.readCalls()).toBe(2);
    expect(inspected).toBe(0);
  });
});
