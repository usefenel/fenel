import { describe, expect, test } from "bun:test";
import { fieldEditPlan, fieldReaderPlan } from "./field-render";
import { dispatchEngineBody, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";
import { createDispatchRegistry } from "../dispatch-registry";
import { Bool, Char, Int, Just, List, Nat, Nothing, Rational, Str } from "../type-foundation";
import { mintAuthority } from "../authority";
import { dispatchRegistry as repositoryDispatch } from "../system-entities";

const field = (type, name = "value") => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const text = { $ref: "String" };
const channel = (id, extra = {}) => ({ id, kind: "text", name: id, ...extra });
const plan = args => fieldReaderPlan({ field: field(text), fieldMode: "transient", channelsEnabled: true, ...args });
const source = run => withInterpretedCompiledArtifacts(run);
const emptyUi = values => ({ widget: Nothing, helpText: Nothing, options: Nothing, columns: Nothing,
  refFilter: Nothing, prefix: Nothing, suffix: Nothing, format: Nothing, placeholder: Nothing, ...values });

describe("source-owned reader field planning", () => {
  test("the current reader selects Inputable and channel ids survive reordering", () => source(() => {
    const registry = createDispatchRegistry();
    const native = channel("native"), address = channel("address", { strategy: "autocomplete-address", config: { countries: ["FR"] } });
    registry.addInstance({ typeName: "Inputable", args: ["String"], methods: { channels: [native] }, scope: "global", priority: 0 });
    registry.addInstance({ typeName: "Inputable", args: ["String"], methods: { channels: [native, address] }, scope: { kind: "tag", tag: "reader" }, priority: 10 });
    registry.addInstance({ typeName: "Inputable", args: ["String"], methods: { channels: [channel("foreign")] }, scope: { kind: "tag", tag: "foreign" }, priority: 100 });
    const evaluateContext = { _specRegistry: registry, _activeTags: ["reader"] };
    const selected = plan({ evaluateContext, channelId: "address" });
    expect(selected.activeChannelId).toBe("address");
    expect(selected.channels).toEqual([native, address]);
    expect(selected.plan.editor).toMatchObject({ kind: "custom", leaf: "address-autocomplete", channel: address });
    const reordered = dispatchEngineBody("engine:fieldReaderChannelSelectionPlan", [Just([address, native]), Just("address")]);
    expect(reordered).toMatchObject({ $tag: "Ok", _0: { activeChannelId: Just("address"), channel: Just(address) } });
    expect(plan({ evaluateContext, channelId: "removed" }).activeChannelId).toBe("native");
    expect(plan({ evaluateContext, channelsEnabled: false }).channels).toEqual([]);
  }));

  test("duplicate and unreadable channel ids refuse in the existing source planner", () => source(() => {
    for (const channels of [[channel("same"), channel("same")], [channel("")], [channel(5)], "not a list"]) {
      expect(dispatchEngineBody("engine:fieldReaderChannelSelectionPlan", [Just(channels), Nothing]).$tag).toBe("Err");
    }
    expect(dispatchEngineBody("engine:fieldReaderChannelSelectionPlan", [Nothing, Nothing])).toEqual({
      $tag: "Ok", _0: { channels: [], channel: Nothing, activeChannelId: Nothing },
    });
  }));

  test("source normalizes Maybe/refinement channels and tagged targets", () => source(() => {
    const raw = text;
    const named = { $tag: "FtNamed", name: "String", raw };
    const optional = { $tag: "FtMaybe", value: { $tag: "FtRefined", base: named, set: {}, raw }, raw };
    expect(dispatchEngineBody("engine:fieldReaderInputableTargetPlan", [true, optional])).toEqual(Just("String"));
    expect(dispatchEngineBody("engine:fieldReaderInputableTargetPlan", [false, optional])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:fieldReaderInputableTargetPlan", [true, { $tag: "FtTagged", entityType: "Person", raw }])).toEqual(Just("Person"));
  }));

  test("native and custom opaque channels retain nominal ownership", () => source(() => {
    const registry = createDispatchRegistry();
    for (const [name, id] of [["String", "string"], ["Boolean", "boolean"], ["ReaderSecret", "secret"]]) {
      registry.addInstance({ typeName: "Inputable", args: [name], methods: { channels: [channel(id)] } });
    }
    const evaluateContext = { _specRegistry: registry };
    expect(plan({ evaluateContext, field: field(Str) }).activeChannelId).toBe("string");
    expect(plan({ evaluateContext, field: field(text) }).activeChannelId).toBe("string");
    expect(plan({ evaluateContext, field: field(Bool) }).activeChannelId).toBe("boolean");
    const nominal = { $opaque: { name: "ReaderSecret", pure: text } };
    expect(plan({ evaluateContext, field: field(nominal) }).activeChannelId).toBe("secret");
    const missing = { $opaque: { name: "NoInputable", pure: text } };
    expect(plan({ evaluateContext, field: field(missing) }).channels).toEqual([]);
  }));

  test("declaration fallback is demand-lazy and retains original presentation", () => source(() => {
    const reads = [];
    const declaration = { $refined: { base: text, set: { $tag: "SeRef", handle: "format:email" } } };
    const registry = { evaluateContext: () => ({}), getIdentifiedEntity(name) { reads.push(name); return name === "ReaderAlias" ? { id: name, type: declaration } : undefined; } };
    const presentationOverride = { display: emptyUi({ helpText: Just("Original field help"), columns: Just(7) }) };
    const selected = plan({ registry, field: field({ $ref: "ReaderAlias" }, "originalName"), channelsEnabled: false, presentationOverride });
    expect(reads).toEqual(["ReaderAlias"]);
    expect(selected.plan).toMatchObject({ name: "originalName", label: "originalName", typeLabel: "ReaderAlias", helpText: "Original field help", columns: 7 });
    expect(selected.plan.editor.kind).toBe("text");
    reads.length = 0;
    plan({ registry, channelsEnabled: false });
    expect(reads).toEqual([]);
  }));

  test("a selected nominal channel avoids reading its declaration", () => source(() => {
    const registry = createDispatchRegistry();
    registry.addInstance({ typeName: "Inputable", args: ["ReaderAlias"], methods: { channels: [channel("map", { kind: "widget", widget: "map" })] } });
    let reads = 0;
    const owner = { getIdentifiedEntity(name) { reads++; return { id: name, get type() { throw Error("Alias fallback was eagerly read"); } }; } };
    const selected = plan({ registry: owner, evaluateContext: { _specRegistry: registry }, field: field({ $ref: "ReaderAlias" }) });
    expect(reads).toBe(1);
    expect(selected.activeChannelId).toBe("map");
    expect(selected.plan.editor).toMatchObject({ kind: "unsupported", reason: "widget channel not yet available" });
  }));

  test("sibling-dependent types resolve through the existing Fenel evaluator", () => source(() => {
    const selected = plan({ field: field({ $el: { var: "selectedType" } }), recordValues: { selectedType: text }, channelsEnabled: false });
    expect(selected.plan.editor.kind).toBe("text");
    expect(selected.plan.typeLabel).toBe("String");
    const unresolved = plan({ field: field({ $el: { var: "selectedType" } }), recordValues: {}, channelsEnabled: false });
    expect(unresolved.plan.editor.kind).toBe("unsupported");
    expect(plan({ field: field({ $el: { var: "selectedType" } }), recordValues: { selectedType: { $ref: "Number" } },
      channelsEnabled: false }).plan.editor.kind).toBe("number");
  }));

  test("native opaque carriers retain the existing scalar editor lattice", () => source(() => {
    for (const [type, kind] of [[Bool, "boolean"], [Int, "number"], [Nat, "number"], [Rational, "number"], [Str, "text"], [Char, "text"]]) {
      const selected = plan({ field: field(type), channelsEnabled: false });
      expect(selected.plan.editor.kind).toBe(kind);
      expect(selected.plan.editor.rawType).toEqual(type);
    }
  }));

  test("generic native carriers use the actual builtin Inputable pool without deriving a second resolver", () => source(() => {
    const timings = {};
    for (const name of ["Value", "Any", "Bytes"]) {
      const started = performance.now();
      const selected = plan({ field: field({ $ref: name }), evaluateContext: { _specRegistry: repositoryDispatch } });
      timings[name] = Math.round((performance.now() - started) * 100) / 100;
      expect(selected.channels).toEqual([]);
      expect(selected.plan.editor.rawType).toEqual({ $ref: name });
    }
    console.log("[field-reader-generic-builtin-pool-ms]", JSON.stringify(timings));
  }));

  test("generic $el applications use the reader's existing callable-family expansion", () => source(() => {
    const item = { ...field({ $var: "a" }, "_0"), key: { $tag: "PositionalField", index: 0 } };
    const body = { $record: { fields: [item] } };
    const owner = { identity: "ReaderBox", name: "ReaderBox", ownerIdentity: '["reader","ReaderBox"]', type: body,
      typeScheme: { quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" } }], body } };
    const evaluateContext = { _typeFamilyOwner: name => name === "ReaderBox" ? owner
      : name === "String" ? { identity: "String", name: "String", ownerIdentity: '["system","String"]', type: text,
        typeScheme: { quantified: [], body: text } } : undefined };
    const selected = plan({ evaluateContext, field: field({ $el: { call: ["ReaderBox", text] } }), channelsEnabled: false });
    expect(selected.plan.editor).toMatchObject({ kind: "record", fields: [{ name: "_0", type: text }] });
    expect(owner.type.$record.fields[0].type).toEqual({ $var: "a" });
  }));

  test("authenticated defaults, filters and string choices use the actual reader", () => source(() => {
    const registry = createDispatchRegistry();
    const authority = mintAuthority({ evaluateAuthorityFunction: () => Nothing }, {
      envelope: {}, issuer: "field-plan-test", accountId: "current", principal: null, lane: null, grant: null, mintedAt: 0,
    });
    const filter = { var: "candidate.current" };
    for (const [typeName, target, methods] of [
      ["HasDefault", "ReaderElement", { default: "current-default" }],
      ["Filterable", "ReaderPerson", { defaultFilter: filter }],
      ["Labelable", "ReaderChoice.a", { label: "Current label" }],
    ]) {
      registry.addInstance({ typeName, args: [target], methods, scope: { kind: "account", accountId: "current" }, priority: 10 });
      registry.addInstance({ typeName, args: [target], methods: Object.fromEntries(Object.keys(methods).map(key => [key, "foreign"])),
        scope: { kind: "account", accountId: "foreign" }, priority: 100 });
    }
    const evaluateContext = { _specRegistry: registry, _authority: authority,
      getEntityType: name => name === "ReaderChoice" ? { $refined: { base: text, set: { $tag: "SeEnum", values: ["a", "b"] } } } : undefined };
    const list = fieldEditPlan({ field: field(List({ $ref: "ReaderElement" })), evaluateContext });
    expect(list.editor).toMatchObject({ kind: "list", itemDefault: "current-default" });
    const reference = fieldEditPlan({ field: field({ $tagged: { value: { $ref: "Id" }, phantom: { $refined: { base: text,
      set: { $tag: "SeEnum", values: ["ReaderPerson"] } } } } }), evaluateContext });
    expect(reference.editor).toMatchObject({ kind: "ref", filterSource: "filterable-default", filter });
    const choice = fieldEditPlan({ field: field({ $ref: "ReaderChoice" }), evaluateContext });
    expect(choice.editor).toMatchObject({ kind: "select", options: [{ value: "a", label: "Current label" }, { value: "b", label: "b" }] });
  }));
});
