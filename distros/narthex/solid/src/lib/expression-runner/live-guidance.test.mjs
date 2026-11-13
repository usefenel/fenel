// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/live-guidance.test.mjs
import { describe, expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import { createLiveGuidance, openLiveGuidance } from "./live-guidance";

// B4 slice 2: the production latest-wins scheduler with a controlled frame
// clock and worker. No engine module, registry or Worker is imported.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); } }

function world() {
  const frames = [], requests = [];
  const [revision, setRevision] = createSignal(1);
  let currentRevision = 1, currentMetadata = 1;
  const frame = callback => { frames.push(callback); return () => { const index = frames.indexOf(callback); if (index >= 0) frames.splice(index, 1); }; };
  const guidance = createLiveGuidance({
    // Source metadata is not a signal: only the after-reply check sees it change.
    capture: () => ({ revision: revision(), metadata: currentMetadata }),
    sameCapture: (a, b) => a.revision === b.revision && a.metadata === b.metadata,
    current: capture => capture.revision === currentRevision && capture.metadata === currentMetadata,
    key: item => JSON.stringify(item),
    send: (items, capture, signal) => {
      const held = deferred();
      requests.push({ items, capture, signal, ...held });
      return held.promise;
    },
    frame,
  });
  return { guidance, requests, frames,
    runFrame: async () => { for (const callback of frames.splice(0)) callback(); await settle(); },
    bumpRevision: () => { currentRevision++; setRevision(currentRevision); },
    changeMetadata: () => { currentMetadata++; },
    answer: async (index, replies) => { requests[index].resolve(replies ?? requests[index].items.map(item => `answer for ${item}`)); await settle(); } };
}

function mount(w, initial = "a") {
  return createRoot(dispose => {
    const [draft, setDraft] = createSignal(initial);
    const verdict = createMemo(() => w.guidance.read(draft()));
    // A rendered reader of the verdict (memos are lazy).
    let shown;
    const read = () => { shown = verdict(); return shown; };
    return { dispose, read, edit: async value => { setDraft(value); w.guidance.touch(); await settle(); read(); } };
  });
}

describe("live guidance is latest wins and never runs at mount", () => {
  test("mounting and reading an untouched draft sends nothing", async () => {
    const w = world(), m = mount(w);
    m.read(); await settle(); m.read();
    await w.runFrame();
    expect(w.requests).toHaveLength(0);
    expect(m.read()).toBeUndefined();
    m.dispose();
  });

  test("twenty edits in one frame send one request, for the last draft only", async () => {
    const w = world(), m = mount(w);
    for (let index = 0; index < 20; index++) await m.edit(`edit ${index}`);
    expect(w.requests).toHaveLength(0);
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].items).toEqual(["edit 19"]);
    await w.answer(0);
    expect(m.read()).toBe("answer for edit 19");
    m.dispose();
  });

  test("twenty edits while a job runs leave at most one queued, which carries the latest draft", async () => {
    const w = world(), m = mount(w);
    await m.edit("first");
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    for (let index = 0; index < 20; index++) { await m.edit(`edit ${index}`); await w.runFrame(); }
    // The running job is never pre-empted; nothing else is sent meanwhile.
    expect(w.requests).toHaveLength(1);
    expect(w.guidance.lane.waiting).toBe(true);
    await w.answer(0);
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].items).toEqual(["edit 19"]);
    // The answer for "first" never shows for a later draft.
    expect(m.read()).toBeUndefined();
    await w.answer(1);
    expect(m.read()).toBe("answer for edit 19");
    await w.runFrame();
    expect(w.requests).toHaveLength(2);
    m.dispose();
  });

  test("an edit between request and reply drops that reply for the new draft and asks for the new one", async () => {
    const w = world(), m = mount(w);
    await m.edit("before");
    await w.runFrame();
    await m.edit("after");
    await w.answer(0);
    expect(m.read()).toBeUndefined();
    await w.runFrame();
    expect(w.requests.at(-1).items).toEqual(["after"]);
    await w.answer(w.requests.length - 1);
    expect(m.read()).toBe("answer for after");
    m.dispose();
  });

  test("a revision bump between request and reply drops the reply and sends again under the new revision", async () => {
    const w = world(), m = mount(w);
    await m.edit("draft");
    await w.runFrame();
    w.bumpRevision();
    await w.answer(0);
    expect(m.read()).toBeUndefined();
    await w.runFrame();
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].items).toEqual(["draft"]);
    expect(w.requests[1].capture).toEqual({ revision: 2, metadata: 1 });
    await w.answer(1);
    expect(m.read()).toBe("answer for draft");
    m.dispose();
  });

  test("a reply whose capture no longer holds after it arrives is dropped and asked for again", async () => {
    const w = world(), m = mount(w);
    await m.edit("draft");
    await w.runFrame();
    w.changeMetadata();
    await w.answer(0);
    expect(m.read()).toBeUndefined();
    await w.runFrame();
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].capture).toEqual({ revision: 1, metadata: 2 });
    await w.answer(1);
    expect(m.read()).toBe("answer for draft");
    m.dispose();
  });

  test("a partial answer (the worker yielded) is kept; only the rest is asked again, without an edit", async () => {
    const frames = [], requests = [];
    const guidance = createLiveGuidance({ capture: () => ({}), sameCapture: () => true, current: () => true, key: String,
      send: items => { const held = deferred(); requests.push({ items, ...held }); return held.promise; },
      frame: callback => { frames.push(callback); return () => {}; } });
    const m = createRoot(dispose => ({ dispose, verdicts: createMemo(() => ["a", "b", "c"].map(item => guidance.read(item))) }));
    const run = async () => { for (const callback of frames.splice(0)) callback(); await settle(); };
    guidance.touch();
    await settle(); m.verdicts(); await run();
    expect(requests.map(row => row.items)).toEqual([["a", "b", "c"]]);
    requests[0].resolve(["A"]);
    await settle(); m.verdicts(); await run();
    expect(m.verdicts()).toEqual(["A", undefined, undefined]);
    expect(requests.map(row => row.items)).toEqual([["a", "b", "c"], ["b", "c"]]);
    requests[1].resolve(["B", "C"]);
    await settle();
    expect(m.verdicts()).toEqual(["A", "B", "C"]);
    m.dispose();
  });

  test("a failure is checking until the next edit asks again", async () => {
    const w = world(), m = mount(w);
    await m.edit("draft");
    await w.runFrame();
    w.requests[0].reject(new Error("The operation took too long."));
    await settle();
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    expect(m.read()).toBeUndefined();
    await m.edit("draft again");
    await w.runFrame();
    expect(w.requests).toHaveLength(2);
    m.dispose();
  });

  test("cancel (Save) aborts the running job and drops the queued one", async () => {
    const w = world(), m = mount(w);
    await m.edit("draft");
    await w.runFrame();
    await m.edit("newer");
    await w.runFrame();
    w.guidance.cancel();
    expect(w.requests[0].signal.aborted).toBe(true);
    await w.answer(0);
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    expect(m.read()).toBeUndefined();
    m.dispose();
  });

  test("after an edit, the edited node and its ancestors are asked first, in their own batch", async () => {
    const frames = [], requests = [];
    const guidance = createLiveGuidance({ capture: () => ({}), sameCapture: () => true, current: () => true,
      key: item => JSON.stringify(item.node), identity: item => item.node,
      send: items => { const held = deferred(); requests.push({ items: items.map(item => item.node.id), ...held }); return held.promise; },
      frame: callback => { frames.push(callback); return () => {}; } });
    const leaf = (id, value) => ({ id, value });
    const [tree, setTree] = createSignal({ id: "root", children: [{ id: "a", children: [leaf("a1", 1)] },
      { id: "b", children: [leaf("b1", 1), leaf("b2", 2)] }] });
    const walk = (node, out = []) => { out.push(node); for (const child of node.children ?? []) walk(child, out); return out; };
    const m = createRoot(dispose => ({ dispose, verdicts: createMemo(() => walk(tree()).map(node => guidance.read({ node }))) }));
    const run = async () => { for (const callback of frames.splice(0)) callback(); await settle(); };
    m.verdicts();
    guidance.touch();
    await settle(); m.verdicts(); await run();
    expect(requests.map(row => row.items)).toEqual([["root", "a", "a1", "b", "b1", "b2"]]);
    requests[0].reject(new Error("The operation took too long."));
    await settle();
    // Edit a1: a1, a and root become new objects; b's subtree is unchanged.
    const before = tree();
    setTree({ ...before, children: [{ ...before.children[0], children: [leaf("a1", 5)] }, before.children[1]] });
    guidance.touch();
    await settle(); m.verdicts(); await run();
    expect(requests.map(row => row.items)).toEqual([["root", "a", "a1", "b", "b1", "b2"], ["root", "a", "a1"]]);
    requests[1].resolve(["root!", "a!", "a1!"]);
    await settle(); m.verdicts(); await run();
    expect(requests.map(row => row.items)).toEqual([["root", "a", "a1", "b", "b1", "b2"], ["root", "a", "a1"], ["b", "b1", "b2"]]);
    expect(m.verdicts()).toEqual(["root!", "a!", "a1!", undefined, undefined, undefined]);
    requests[2].resolve(["b!", "b1!", "b2!"]);
    await settle();
    expect(m.verdicts()).toEqual(["root!", "a!", "a1!", "b!", "b1!", "b2!"]);
    m.dispose();
  });

  test("a complete draft asks exactly once at open and shows its hint; an empty draft asks nothing", async () => {
    const w = world();
    const complete = value => value !== undefined && value !== "";
    const mounted = initial => createRoot(dispose => {
      const [draft, setDraft] = createSignal(initial);
      const verdict = createMemo(() => w.guidance.read(draft()));
      openLiveGuidance(w.guidance, () => complete(draft()));
      return { dispose, verdict, setDraft };
    });
    const empty = mounted("");
    await settle(); empty.verdict(); await w.runFrame();
    expect(w.requests).toHaveLength(0);
    empty.dispose();
    const v = world();
    const m = createRoot(dispose => {
      const [draft] = createSignal("seeded");
      const verdict = createMemo(() => v.guidance.read(draft()));
      openLiveGuidance(v.guidance, () => complete(draft()));
      return { dispose, verdict };
    });
    await settle(); m.verdict(); await v.runFrame();
    expect(v.requests).toHaveLength(1);
    expect(v.requests[0].items).toEqual(["seeded"]);
    await v.answer(0);
    expect(m.verdict()).toBe("answer for seeded");
    // Open asks once: nothing more is sent without an edit.
    await v.runFrame();
    expect(v.requests).toHaveLength(1);
    m.dispose();
  });

  test("a draft that becomes complete after open (seeded later) asks once, then only edits ask", async () => {
    const w = world();
    const m = createRoot(dispose => {
      const [draft, setDraft] = createSignal(undefined);
      const verdict = createMemo(() => draft() === undefined ? undefined : w.guidance.read(draft()));
      openLiveGuidance(w.guidance, () => draft() !== undefined);
      return { dispose, verdict, setDraft };
    });
    await settle(); m.verdict(); await w.runFrame();
    expect(w.requests).toHaveLength(0);
    m.setDraft("seeded"); await settle(); m.verdict(); await w.runFrame();
    expect(w.requests.map(row => row.items)).toEqual([["seeded"]]);
    m.dispose();
  });

  test("a partial reply arriving after a newer edit never puts the older draft's items ahead of the new path", async () => {
    const frames = [], requests = [];
    const guidance = createLiveGuidance({ capture: () => ({}), sameCapture: () => true, current: () => true,
      key: item => JSON.stringify(item.node), identity: item => item.node,
      send: items => { const held = deferred(); requests.push({ items: items.map(item => `${item.node.id}${item.node.value ?? ""}`), ...held }); return held.promise; },
      frame: callback => { frames.push(callback); return () => {}; } });
    const make = value => ({ id: "root", children: [{ id: "a", children: [{ id: "leaf", value }] }] });
    const [tree, setTree] = createSignal(make(1));
    const walk = (node, out = []) => { out.push(node); for (const child of node.children ?? []) walk(child, out); return out; };
    const m = createRoot(dispose => ({ dispose, verdicts: createMemo(() => walk(tree()).map(node => guidance.read({ node }))) }));
    const run = async () => { for (const callback of frames.splice(0)) callback(); await settle(); };
    m.verdicts(); guidance.touch(); await settle(); m.verdicts(); await run();
    requests[0].resolve(["r", "a", "l"]); await settle();
    // Edit 1: its path is asked first.
    setTree(make(2)); guidance.touch(); await settle(); m.verdicts(); await run();
    expect(requests[1].items).toEqual(["root", "a", "leaf2"]);
    // Edit 2 while edit 1's path is in flight; then edit 1's path yields a prefix.
    setTree(make(3)); guidance.touch(); await settle(); m.verdicts(); await run();
    requests[1].resolve(["r2"]); await settle(); m.verdicts(); await run();
    expect(requests[2].items).toEqual(["root", "a", "leaf3"]);
    m.dispose();
  });

  test("more than one batch of items goes in successive requests of at most 64", async () => {
    const frames = [], requests = [];
    const guidance = createLiveGuidance({ capture: () => ({}), sameCapture: () => true, current: () => true, key: String,
      send: items => { requests.push(items); return Promise.resolve(items.map(item => item)); },
      frame: callback => { frames.push(callback); return () => {}; } });
    guidance.touch();
    for (let index = 0; index < 100; index++) guidance.read(index);
    for (let round = 0; round < 4; round++) { for (const callback of frames.splice(0)) callback(); await settle(); }
    expect(requests.map(items => items.length)).toEqual([64, 36]);
  });
});

describe("B4 F2 fix round (M3): busy only while a request is queued or in flight", () => {
  test("busy while waiting and running; not after an answer, a failure, or with no worker", async () => {
    const w = world(), m = mount(w);
    expect(w.guidance.busy()).toBe(false);
    await m.edit("b");
    expect(w.guidance.busy()).toBe(true);
    await w.runFrame();
    expect(w.requests).toHaveLength(1);
    expect(w.guidance.busy()).toBe(true);
    await w.answer(0);
    expect(w.guidance.busy()).toBe(false);
    await m.edit("c");
    await w.runFrame();
    w.requests[1].reject(new Error("worker closed"));
    await settle();
    expect(w.guidance.busy()).toBe(false);
    m.dispose();
    // A surface with no worker (no capture) is never busy.
    let capture;
    const idle = createLiveGuidance({ capture: () => capture, sameCapture: () => true, current: () => true, key: item => item,
      send: () => Promise.resolve([]), frame: callback => { queueMicrotask(callback); return () => {}; } });
    idle.touch(); idle.read("x");
    await settle();
    expect(idle.busy()).toBe(false);
  });
});
