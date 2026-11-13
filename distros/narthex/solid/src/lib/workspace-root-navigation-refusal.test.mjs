import { expect, test } from "bun:test";

// Execute the production host navigation functions with controlled IO/lifetimes.
const source = await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text();
const start = source.indexOf("  async function addLens(");
const end = source.indexOf("  async function setBordersMerged(", start);
if (start < 0 || end < 0) throw new Error("Navigation fixture boundary moved");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

function fixture(options = {}) {
  const lens = { id: "origin", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } };
  const state = { lenses: [lens], activeLensId: lens.id };
  const updates = [], callbacks = [], errors = [];
  let accepted = true, refusals = 0;
  const model = { workspaceCall(name, ...args) {
    if (name === "workspaceFocusEqual" || name === "workspaceSourceEqual") return true;
    if (name === "defaultWorkspaceLens") return { ...lens, id: args[0], source: args[1] };
    if (name === "workspaceLensWithFocus") return { ...args[0], focus: args[1] };
    if (name === "workspaceGroupedDisplay") return { $tag: "GroupedLenses" };
    throw new Error(`Unexpected model call ${name}`);
  } };
  const operate = async operation => model.workspaceCall(operation.kind, ...operation.args);
  const update = async (commands, guard) => {
    if (guard?.() === false || options.updateRefuses) return false;
    if (options.updateThrows) throw new Error("update refused");
    updates.push(commands); return true;
  };
  const bindings = {
    address: { navigationStarted: () => () => {}, navigated() {} },
    active: () => lens, value: () => state, visible: () => [lens],
    props: { epoch: 0, store: {
      prepare: async () => { if (options.prepareThrows) throw new Error("prepare refused"); }, operate, update,
      planUpdate: async (planner, guard) => guard?.() === false ? false : update(await planner(state, operate), guard),
    } },
    surfaceClosed: false, sessionEpoch: () => 0,
    focusRequests: new Map(), presentationRequests: new Map(),
    workspaceSourceKey: value => value.$tag === "ThisTabSource" ? "local" : "public",
    sourceId: () => "public", workspaceSourceFromKey: () => ({ $tag: "ThisTabSource" }),
    scopeToWorkspace: () => ({ $tag: "RootFocus" }),
    flushLenses: async () => !options.flushRefuses,
    animateLayout: callback => {
      if (!options.delayed) return callback();
      return new Promise((resolve, reject) => { callbacks.push(async () => { try { await callback(); resolve(); } catch (error) { reject(error); } }); });
    },
    Nothing: { $tag: "Nothing" }, DEFAULT_FLOATING_LENS: {},
    cloneDraftValue: value => value,
    setMessage: message => errors.push(message), crypto: { randomUUID: () => "new-lens" },
  };
  const api = new Function(...Object.keys(bindings), `${code}; return { addLens, openSavedLens, exploreData };`)(...Object.values(bindings));
  return {
    updates, callbacks, errors,
    refusals: () => refusals,
    invalidate: () => { accepted = false; },
    run: method => method === "add" ? api.addLens(lens, { kind: "root" }, "stack", undefined,
      { $tag: "ThisTabSource" }, false, () => accepted, () => { refusals++; })
      : api.openSavedLens(lens.id, "stack", () => accepted, () => { refusals++; }),
    explore: (source = "public") => api.exploreData(source, () => accepted, () => { refusals++; }),
    settle: async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); },
  };
}

for (const method of ["add", "open"]) {
  test(`${method}: flush refusal releases creation intent once`, async () => {
    const f = fixture({ flushRefuses: true }); await f.run(method);
    expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
  });
  test(`${method}: preparation refusal releases creation intent once`, async () => {
    const f = fixture({ prepareThrows: true }); await f.run(method);
    expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
  });
  test(`${method}: delayed success keeps the intent until publication`, async () => {
    const f = fixture({ delayed: true }); let settled = false;
    const pending = f.run(method).then(() => { settled = true; }); await f.settle();
    expect(f.callbacks).toHaveLength(1); expect(f.refusals()).toBe(0); expect(f.updates).toEqual([]);
    expect(settled).toBe(false);
    await f.callbacks.shift()(); await pending;
    expect(f.refusals()).toBe(0); expect(f.updates).toHaveLength(1);
  });
  test(`${method}: invalidated delayed target releases creation intent`, async () => {
    const f = fixture({ delayed: true }); const pending = f.run(method); await f.settle(); f.invalidate();
    await f.callbacks.shift()(); await pending;
    expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
  });
  test(`${method}: update failure releases creation intent once`, async () => {
    const f = fixture({ updateThrows: true }); await f.run(method);
    expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
  });
  test(`${method}: cancelled publication releases creation intent once`, async () => {
    const f = fixture({ updateRefuses: true }); await f.run(method);
    expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
  });
}

test("explore forwards terminal refusal through the existing-root path", async () => {
  const f = fixture({ flushRefuses: true }); await f.explore(); expect(f.refusals()).toBe(1);
});

test("explore forwards terminal refusal through the new-root path", async () => {
  const f = fixture({ flushRefuses: true }); await f.explore("local"); expect(f.refusals()).toBe(1);
});

test("explore refuses a stale existing target before navigation", async () => {
  const f = fixture(); f.invalidate(); await f.explore();
  expect(f.refusals()).toBe(1); expect(f.updates).toEqual([]);
});

test("a retired navigation refusal cannot clear a newer root intent", () => {
  const first = source.indexOf("  function clearRootIntent(");
  const last = source.indexOf("  function rootIntentCurrent(", first);
  if (first < 0 || last < 0) throw new Error("Root intent fixture boundary moved");
  const clear = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(first, last));
  const old = {}, newer = {};
  const api = new Function("old", "newer", `let currentRootIntent = old, rootIntentGeneration = 0;
    let pending = old; const setPendingRoot = next => { pending = next; };
    ${clear}; return { replace() { currentRootIntent = newer; pending = newer; },
      refuseOld() { clearRootIntent(old); }, read() { return { currentRootIntent, pending, rootIntentGeneration }; } };`)(old, newer);
  api.replace(); api.refuseOld();
  expect(api.read()).toEqual({ currentRootIntent: newer, pending: newer, rootIntentGeneration: 0 });
});
