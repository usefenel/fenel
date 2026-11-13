import { describe, expect, test } from "bun:test";

// Execute the production receiver and its strict copier. Controlled semantic
// and host ports establish exact reader binding and transport fidelity without
// building the registry or replacing the source-owned field/channel policies.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const read = path => Bun.file(new URL(path, import.meta.url)).text();
const [workerSource, registrySource] = await Promise.all([
  read("./authoring-catalog-worker-main.ts"),
  read("../../../../../../implementations/typescript/engine/src/registry-transport.ts"),
]);
const compile = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerStart = workerSource.indexOf("const scope =");
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
if (workerStart < 0 || transportStart < 0 || transportEnd < transportStart)
  throw new Error("The reader field plan fixture boundary moved.");
const workerCode = compile(workerSource.slice(workerStart)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compile(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const hidden = (value, key, entry) => Object.defineProperty(value, key, { value: entry, enumerable: false });
const nothing = () => ({ $tag: "Nothing" });
const field = type => ({ name: "chosen", key: { $tag: "NamedField", ref: { $ref: "original-field-id" } },
  type, label: nothing(), ui: nothing(), meta: {} });

function fixture() {
  const calls = [], copies = [], replies = [], turns = [], scopeCalls = [];
  const registry = { marker: "Local checked registry" };
  const frame = { marker: "Local reader frame", _activeTags: ["tab-a"] };
  const session = { mode: "detached", registry, evaluateContext: frame, environment: {} };
  const state = { project(args) {
    const channel = { kind: "text", id: "canonical-channel-id", name: "Selected channel", strategy: "reader-strategy" };
    return { plan: { name: args.field.name, label: "Reader-owned label", typeLabel: "Reader-owned type",
      required: true, editor: { kind: "custom", leaf: "reader-leaf", rawType: args.field.type, channel } },
    channels: [channel], activeChannelId: channel.id };
  } };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: value => replies.push(structuredClone(value)) },
    registryTransportSnapshot(value, label, mode) {
      copies.push({ value, label, mode });
      return transport(value, label, mode);
    },
    fieldReaderPlan(args) { calls.push(args); return state.project(args); },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession(base, scope) {
      const selected = { ...base, registry: { marker: "scoped checked registry" },
        evaluateContext: { marker: scope.draft?.id ?? "scoped reader frame" } };
      scopeCalls.push({ base, scope, selected });
      return selected;
    },
    createAccountAuthoringSession() { throw new Error("Unexpected account scope in Local field plan controls."); },
  };
  const api = new Function(...Object.keys(bindings), `${workerCode}; return {
    run, cancelled,
    install(session, local = true) {
      base = session;
      localFieldSource = local ? { sourceId: "tab-a", snapshot: { owners: [], fields: [], facets: [] } } : undefined;
    },
    installContext(id, session) { contexts.set(id, session); },
    installModule(name, session) { moduleContexts.set(name, { catalog: [], session }); },
  };`)(...Object.values(bindings));
  api.install(session);
  let nextId = 10;
  const answer = id => replies.find(reply => reply.id === id && "ok" in reply);
  const payload = () => ({ method: "project-reader-field-plan", contextId: 0,
    field: field({ $ref: "OriginalDeclaration" }), value: { z: 1, a: 2 },
    recordValues: { sibling: { z: 1, a: 2 } }, fieldMode: "identified", channelsEnabled: true,
    channelId: "selected-channel" });
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  async function run(extra = {}) {
    const id = nextId++, request = { id, ...payload(), ...extra };
    const pending = api.run(request);
    await release(); await pending;
    return answer(id);
  }
  return { api, session, registry, frame, calls, copies, replies, scopeCalls, state, payload,
    answer, release, run, start: request => api.run(request) };
}

describe("Local field plan worker receiver", () => {
  test("forwards the original field declaration and sibling values with the exact checked reader", async () => {
    const h = fixture(), value = { z: { second: 2, first: 1 }, a: undefined };
    const type = { $el: { var: "siblingType" } }, original = field(type);
    const recordValues = { siblingType: { $ref: "SiblingDeclaration" }, chosen: value };
    const presentationOverride = { display: { placeholder: "Scoped placeholder" } };
    const answer = await h.run({ field: original, value, recordValues, presentationOverride,
      registry: { marker: "forged registry" }, evaluateContext: { marker: "forged reader" },
      owner: "foreign owner", accountId: "foreign account", localSourceId: "foreign source",
      declarationType: { $ref: "MustNotReplaceOriginal" } });
    expect(answer.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0];
    expect(call.registry).toBe(h.registry);
    expect(call.evaluateContext).toBe(h.frame);
    expect(call.field).toEqual(original);
    expect(call.field).not.toBe(original);
    expect(call.field.type).toEqual(type);
    expect(call.field.type).not.toBe(type);
    expect(call.field.key).toEqual(original.key);
    expect(call.fieldMode).toBe("identified");
    expect(call.channelId).toBe("selected-channel");
    expect(call.channelsEnabled).toBe(true);
    expect(call.presentationOverride).toEqual(presentationOverride);
    expect(call.presentationOverride).not.toBe(presentationOverride);
    expect(call.recordValues).toEqual(recordValues);
    expect(call.recordValues).not.toBe(recordValues);
    expect(call.recordValues.chosen).toBe(call.value);
    expect(call.value).not.toBe(value);
    expect(call.declarationType).toBeUndefined();
    expect(call.owner).toBeUndefined();
    expect(call.accountId).toBeUndefined();
    expect(call.localSourceId).toBeUndefined();
    expect(Object.keys(call.value)).toEqual(["z", "a"]);
    expect(Object.keys(call.value.z)).toEqual(["second", "first"]);
    expect(h.copies.map(({ label, mode }) => ({ label, mode }))).toEqual([
      { label: "worker reader field plan request", mode: "equality" },
      { label: "worker reader field plan result", mode: "equality" },
    ]);
    expect(answer.result.fieldPlan.plan.editor.rawType).toEqual(type);
    expect(original.type).toBe(type);
  });

  test("transient fields retain the reader registry and frame while leaving facet policy to the owner", async () => {
    const h = fixture();
    const answer = await h.run({ fieldMode: "transient", channelsEnabled: false,
      channelId: undefined, recordValues: undefined, presentationOverride: undefined, value: undefined });
    expect(answer.ok).toBe(true);
    expect(h.calls[0].registry).toBe(h.registry);
    expect(h.calls[0].evaluateContext).toBe(h.frame);
    expect(h.calls[0].fieldMode).toBe("transient");
    expect(h.calls[0].channelsEnabled).toBe(false);
    expect(h.calls[0].channelId).toBeUndefined();
    expect(h.calls[0].recordValues).toBeUndefined();
    expect(h.calls[0].presentationOverride).toBeUndefined();
    expect(h.calls[0].value).toBeUndefined();
  });

  test("scoped, cached and module requests use their selected registry and reader frame", async () => {
    const h = fixture(), scope = { sourceId: "tab-a", functions: [], draft: { id: "draft reader" } };
    expect((await h.run({ contextId: 4, scope })).ok).toBe(true);
    const selected = h.scopeCalls[0].selected;
    expect(h.scopeCalls[0].base).toBe(h.session);
    expect(h.scopeCalls[0].scope).toBe(scope);
    expect(h.calls[0].evaluateContext).toBe(selected.evaluateContext);
    expect(h.calls[0].registry).toBe(selected.registry);
    expect((await h.run({ contextId: 4 })).ok).toBe(true);
    expect(h.calls[1].evaluateContext).toBe(selected.evaluateContext);
    expect(h.calls[1].registry).toBe(selected.registry);
    const module = { ...h.session, registry: { marker: "module checked registry" },
      evaluateContext: { marker: "module reader" } };
    h.api.installModule("chosen", module);
    expect((await h.run({ sourceModule: "chosen" })).ok).toBe(true);
    expect(h.calls[2].evaluateContext).toBe(module.evaluateContext);
    expect(h.calls[2].registry).toBe(module.registry);
    expect(h.frame._activeTags).toEqual(["tab-a"]);
  });

  test("returns owner-selected channel identities, order and active identity without a second selection", async () => {
    const h = fixture(), type = { $ref: "OriginalDeclaration" };
    const first = { kind: "text", id: "source-channel-z", name: "Duplicate label", strategy: "exact-z" };
    const second = { kind: "text", id: "source-channel-a", name: "Duplicate label", strategy: "exact-a" };
    const result = { plan: { name: "chosen", label: "Source label", typeLabel: "Source type", required: true,
      editor: { kind: "custom", leaf: "source-leaf", rawType: type, channel: second } },
    channels: [first, second], activeChannelId: second.id };
    h.state.project = () => result;
    const answer = await h.run({ channelId: first.id });
    expect(answer.ok).toBe(true);
    const projected = answer.result.fieldPlan;
    expect(projected).toEqual(result);
    expect(projected).not.toBe(result);
    expect(projected.channels.map(channel => channel.id)).toEqual([first.id, second.id]);
    expect(projected.activeChannelId).toBe(second.id);
    expect(projected.plan.editor.channel).toBe(projected.channels[1]);
    expect(projected.plan.editor.channel).not.toBe(second);
    h.state.project = () => ({ plan: result.plan, channels: [] });
    const noActive = await h.run();
    expect(noActive.result.fieldPlan.channels).toEqual([]);
    expect(Object.hasOwn(noActive.result.fieldPlan, "activeChannelId")).toBe(false);
  });

  test("public/account sources, missing contexts and unready workers fail before semantic work", async () => {
    const h = fixture();
    h.api.install(h.session, false);
    const nonLocal = await h.run({ sourceId: "tab-a", localSourceId: "tab-a" });
    expect(nonLocal.ok).toBe(false);
    expect(nonLocal.error).toContain("Local");
    h.api.install(h.session);
    const missing = await h.run({ contextId: 77 });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("context-missing");
    h.api.install(undefined);
    expect((await h.run()).error).toContain("editing worker is not ready");
    expect(h.calls).toHaveLength(0);
  });

  test("malformed request envelopes refuse before the field plan owner", async () => {
    const h = fixture();
    for (const extra of [
      { field: undefined }, { field: null }, { field: [] }, { field: "chosen" },
      { fieldMode: undefined }, { fieldMode: "global" },
      { channelsEnabled: undefined }, { channelsEnabled: 1 },
      { channelId: null }, { channelId: 3 },
      { recordValues: null }, { recordValues: [] }, { recordValues: "siblings" },
      { presentationOverride: null }, { presentationOverride: [] }, { presentationOverride: "display" },
    ]) {
      const answer = await h.run(extra);
      expect(answer.ok).toBe(false);
      expect(answer.result).toBeUndefined();
    }
    expect(h.calls).toHaveLength(0);
  });

  test("equality copies preserve raw insertion order, aliases and output records", async () => {
    const h = fixture(), raw = { z: { second: 2, first: 1 }, a: undefined };
    const type = { $ref: "OriginalDeclaration" };
    let generated;
    h.state.project = args => {
      generated = { plan: { name: args.field.name, label: "Source label", typeLabel: "Source type",
        required: true, editor: { kind: "select", rawType: args.field.type,
          options: [{ label: "Original value", value: args.value }] } },
      channels: [], activeChannelId: "source-id" };
      return generated;
    };
    const answer = await h.run({ field: field(type), value: raw, recordValues: { zSibling: raw, aSibling: raw } });
    expect(answer.ok).toBe(true);
    const call = h.calls[0];
    expect(Object.keys(call.recordValues)).toEqual(["zSibling", "aSibling"]);
    expect(call.recordValues.zSibling).toBe(call.value);
    expect(call.recordValues.aSibling).toBe(call.value);
    const delivered = answer.result.fieldPlan.plan.editor.options[0].value;
    expect(delivered).toEqual(raw);
    expect(delivered).not.toBe(raw);
    expect(delivered).not.toBe(call.value);
    expect(Object.keys(delivered)).toEqual(["z", "a"]);
    expect(Object.keys(delivered.z)).toEqual(["second", "first"]);
    delivered.z.second = 9;
    expect(raw.z.second).toBe(2);
    expect(generated.plan.editor.options[0].value.z.second).toBe(2);
    expect(h.copies.map(({ mode }) => mode)).toEqual(["equality", "equality"]);
  });

  test("strict equality requests reject hidden data, accessors and executable values without reading them", async () => {
    const h = fixture();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get() { reads++; return 1; } });
    const cycle = {}; cycle.self = cycle;
    for (const value of [hidden({ visible: 1 }, "hidden", 2), hidden([1], "hidden", 2),
      hidden([1], "0", 1), accessor, { host: () => true }, cycle, new Map()]) {
      const answer = await h.run({ value });
      expect(answer.ok).toBe(false);
      expect(answer.error).toMatch(/non-enumerable|array properties|accessor|executable|cyclic|non-plain/);
    }
    const nested = hidden({ visible: 1 }, "hidden", 2);
    for (const extra of [{ recordValues: { sibling: nested } },
      { field: { ...field({ $ref: "OriginalDeclaration" }), meta: { hidden: nested } } },
      { presentationOverride: { display: { hidden: nested } } }]) {
      expect((await h.run(extra)).ok).toBe(false);
    }
    expect(reads).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  test("strict equality replies refuse unreadable channels and plans without a partial result", async () => {
    const h = fixture();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "name", { enumerable: true, get() { reads++; return "must not run"; } });
    for (const malformed of [hidden({ visible: 1 }, "hidden", 2), hidden([1], "hidden", 2),
      accessor, { host: () => true }]) {
      for (const location of ["plan", "channels"]) {
        h.state.project = () => location === "plan" ? { plan: malformed, channels: [] }
          : { plan: {}, channels: [malformed] };
        const answer = await h.run();
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/non-enumerable|array properties|accessor|executable/);
        expect(answer.result).toBeUndefined();
      }
    }
    expect(reads).toBe(0);
    expect(h.replies.filter(reply => "ok" in reply).every(reply => reply.ok === false)).toBe(true);
  });

  test("source refusal returns an error instead of a fabricated fallback field plan", async () => {
    const h = fixture();
    h.state.project = () => { throw new Error("the current reader refused the channel declaration"); };
    const answer = await h.run();
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("current reader refused");
    expect(answer.result).toBeUndefined();
    expect(h.calls).toHaveLength(1);
  });

  test("cancellation before planning and during completion suppresses result packets", async () => {
    const h = fixture(), id = 71;
    const pending = h.start({ id, ...h.payload() });
    h.api.cancelled.add(id);
    await h.release(); await pending;
    expect(h.calls).toHaveLength(0);
    expect(h.answer(id)).toBeUndefined();
    const completedId = 72;
    h.state.project = () => { h.api.cancelled.add(completedId); return { plan: {}, channels: [] }; };
    const completed = h.start({ id: completedId, ...h.payload() });
    await h.release(); await completed;
    expect(h.calls).toHaveLength(1);
    expect(h.answer(completedId)).toBeUndefined();
    expect(h.replies.filter(reply => reply.event === "finished").map(reply => reply.id)).toEqual([id, completedId]);
  });
});
