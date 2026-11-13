import { describe, expect, test } from "bun:test";

// Queue classes of the one Local worker (2026-11-11). The production message
// handler, `nextForeground`, `pump` and `run` are extracted unchanged; every
// semantic owner is a controlled stub that records when it ran and how long it
// took on a controlled clock. No engine module or real Worker is loaded.
//
// The fixture models the browser's two task sources: a message posted by the
// page is delivered only when the worker yields (`inbox`), and a timer fires
// after every message that was already posted. A stub may post messages while
// it runs (`during`), exactly as a page does while a job holds the worker, and
// the page may answer a reply some time later (`page`).
const transpiler = new Bun.Transpiler({ loader: "ts" });
const workerSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const workerCode = transpiler.transformSync(workerSource.slice(workerSource.indexOf("const scope =")))
  .replace(/^export /gm, "").replaceAll("import.meta.env.BASE_URL", '"/"');
async function settle() { for (let turn = 0; turn < 16; turn++) await Promise.resolve(); }

function harness() {
  const clock = { now: 1000 };
  const replies = [], order = [], inbox = [], timers = [], storage = [];
  const cost = {}, during = {}, hooks = {};
  const session = { mode: "detached", registry: { fixture: "registry" }, environment: {}, evaluateContext: { fixture: "frame" } };
  const scope = { postMessage: value => { const row = structuredClone(value); replies.push(row); if ("ok" in row) hooks.reply?.(row); } };
  // One unit of stub work: record it, let the page post meanwhile, spend time.
  const work = (label, fallback) => {
    order.push(label);
    during[label]?.();
    clock.now += cost[label] ?? fallback;
  };
  const text = node => typeof node?.value === "string" ? node.value : "?";
  const imports = {
    globalThis: scope, initialSession: session,
    performance: { timeOrigin: 0, now: () => clock.now, measure() {} },
    setTimeout(callback, delay) { timers.push({ at: clock.now + (Number(delay) || 0), callback }); return timers.length; },
    registryTransportSnapshot: value => value,
    withEngineBodyMemoPartition: (_partition, operation) => operation(),
    clearEngineBodyMemoPartition() {},
    isReaderExtensionMethod: method => method === "print-reader-expression-text",
    async runReaderExtension(data, _session, _rows, pause, isCancelled) {
      await pause();
      if (isCancelled()) return undefined;
      work(`print:${data.label}`, 9000);
      return { printed: { $tag: "Ok", _0: { text: data.label, readable: true } } };
    },
    projectReaderValueReadInSession(entry, selected) {
      work(`read:${entry.value}@${selected.scoped ?? "base"}`, 50);
      return { root: { body: "scalar" }, children: [], value: entry.value };
    },
    assertLocalOrdinaryOperation() {},
    loadWorkspaceModel: async () => ({ fixture: "model" }),
    runLocalOrdinaryOperation(_model, operation) { work(`ordinary:${operation.kind}`, 5); return operation.kind; },
    expressionMediaScheduling: () => ({ weight: 0 }),
    authoringExpressionAdmissionRequired: () => false,
    restoreSavedExpressionDeclarations() {}, restoreSavedExpressionDeclaration: value => value,
    readerSourceMetadataEvaluateContext: base => base,
    evaluateAuthoringExpressionInSession(node, _resolve, selected) {
      work(`evaluate:${text(node)}@${selected.scoped ?? "base"}`, 1000);
      return { result: `value of ${text(node)}`, trace: [] };
    },
    draftSaveIssue(node) { work(`check:${text(node)}`, 8000); return undefined; },
    createLocalAuthoringSession: (base, requested) => ({ ...base, scoped: requested.marker }),
    createAccountAuthoringSession() { throw new Error("Unexpected account scope."); },
    createBrowserDataStorage: () => ({
      async load() { work("storage:load", 20); return storage.at(-1); },
      async commit(next, generation) {
        work("storage:commit", 30);
        const record = { schema: "fixture", generation: generation + 1, data: next };
        storage.push(record);
        return record;
      },
    }),
    // Snapshot preparation (`initialize`), controlled as in reader-values-worker.test.mjs.
    registerCatalogEntities() {},
    realmRepositoryCatalogue: () => Promise.resolve({}), repositoryCatalogueRealmKey: () => "fixture",
    repositoryCatalogueIndex: {}, publicRepositoryCatalogueIndex: {}, LOCAL_BROWSER_SOURCE_ID: "fixture-tab",
    buildLocalReaderFieldRegistry: async () => { work("initialize", 90000); return { fixture: "next registry" }; },
    evaluateContextForCatalog: () => ({ fixture: "next frame" }), mintAnonymousAuthority: () => ({}),
    localCatalogue: async () => ({ catalog: [], displayCatalog: [] }),
    createDetachedAuthoringEnvironment: value => value, environmentForCatalog: () => ({}),
  };
  const api = new Function(...Object.keys(imports), `${workerCode};
    base = initialSession; readerPresentationSource = { catalog: [] }; physicalPreviewPartition = "reader-physical:fixture";
    localFieldSource = { sourceId: "tab-a", snapshot: { owners: [], fields: [], facets: [] } };
    return { cancelled, active, contexts, waiting: () => waiting.map(job => job.id) };`)(...Object.values(imports));
  /** The page posts a message: the worker sees it at its next yield. */
  const send = message => { inbox.push(message); };
  /** The page does something `delay` ms from now (its own task, like a timer). */
  const page = (delay, action) => { timers.push({ at: clock.now + delay, callback: action }); };
  /** One turn of the worker's event loop: posted messages, then due timers.
   * With nothing posted and no timer due, time passes until the next timer. */
  async function turn() {
    if (inbox.length) { for (const message of inbox.splice(0)) scope.onmessage({ data: message }); await settle(); }
    if (!timers.length) return inbox.length > 0;
    if (!timers.some(timer => timer.at <= clock.now)) clock.now = Math.min(...timers.map(timer => timer.at));
    const due = timers.filter(timer => timer.at <= clock.now);
    for (const timer of due) timers.splice(timers.indexOf(timer), 1);
    for (const timer of due) timer.callback();
    await settle();
    return true;
  }
  /** Run until no message is posted and no timer is armed. */
  async function drain(limit = 4000) {
    for (let count = 0; count < limit; count++) if (!(await turn())) return;
    throw new Error("The fixture worker never went idle.");
  }
  const answers = () => replies.filter(row => "ok" in row);
  const started = () => replies.filter(row => row.event === "started").map(row => row.id);
  return { api, clock, cost, during, hooks, order, replies, storage, send, page, turn, drain, answers, started, session };
}

const read = (id, label, extra = {}) => ({ id, method: "project-reader-values", contextId: 0, knownIcons: [],
  inputs: [{ value: label, typeLookup: "session", views: [], componentNames: [] }], ...extra });
const ordinary = (id, kind) => ({ id, method: "run-local-ordinary", operation: { kind } });
const evaluate = (id, label, extra = {}) => ({ id, method: "evaluate-expression", contextId: 0,
  node: { kind: "literal", value: label }, savedExpressions: [], ...extra });
const check = (id, label, extra = {}) => ({ id, method: "expression-save-issue", contextId: 0,
  node: { kind: "literal", value: label }, savedExpressions: [], ...extra });
const print = (id, label, extra = {}) => ({ id, method: "print-reader-expression-text", contextId: 0, label, ...extra });
const commit = id => ({ id, method: "commit-local-storage", next: { id }, expectedGeneration: 0 });
const load = id => ({ id, method: "load-local-storage" });
const kinds = order => order.map(row => row.split("@")[0]);

describe("light jobs go ahead of heavy jobs that have not started", () => {
  test("reads and ordinary operations posted during a long job run before the heavy jobs queued ahead of them", async () => {
    const h = harness();
    h.cost["evaluate:long@base"] = 60000;
    // While the long evaluation holds the worker, the page posts two heavy
    // jobs, then a card's reads and a navigation.
    h.during["evaluate:long@base"] = () => {
      h.send(evaluate(2, "second")); h.send(check(3, "save")); h.send(read(4, "card")); h.send(ordinary(5, "navigate")); h.send(read(6, "caption"));
    };
    h.send(evaluate(1, "long"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["evaluate:long", "read:card", "ordinary:navigate", "read:caption", "evaluate:second", "check:save"]);
    expect(h.answers().map(row => row.id)).toEqual([1, 4, 5, 6, 2, 3]);
    expect(h.answers().every(row => row.ok)).toBe(true);
    expect(h.api.waiting()).toEqual([]);
  });

  test("a heavy job never starts before a read that was already posted", async () => {
    const h = harness();
    // One burst to an idle worker: the heavy job's message arrives first.
    h.send(check(1, "save")); h.send(read(2, "card"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["read:card", "check:save"]);
    // A read posted while the last light job ran is seen before the next heavy job begins.
    const next = harness();
    next.during["read:first@base"] = () => next.send(read(3, "child"));
    next.send(read(1, "first")); next.send(evaluate(2, "queued"));
    await next.drain();
    expect(kinds(next.order)).toEqual(["read:first", "read:child", "evaluate:queued"]);
  });

  test("light jobs keep their own order and heavy jobs keep theirs", async () => {
    const h = harness();
    h.during["evaluate:busy@base"] = () => {
      h.send(read(2, "a")); h.send(evaluate(3, "x")); h.send(ordinary(4, "b")); h.send(check(5, "y")); h.send(read(6, "c")); h.send(evaluate(7, "z"));
    };
    h.send(evaluate(1, "busy"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["evaluate:busy", "read:a", "ordinary:b", "read:c", "evaluate:x", "check:y", "evaluate:z"]);
  });

  test("an evaluation that is passed is not prepared: its execution clock has not started", async () => {
    const h = harness();
    let startedWhenRead;
    h.during["check:busy"] = () => { h.send(check(2, "head")); h.send(evaluate(3, "later")); h.send(read(4, "card")); };
    h.during["read:card@base"] = () => { startedWhenRead = h.started(); };
    h.send(check(1, "busy"));
    await h.drain();
    expect(startedWhenRead).toEqual([1, 4]);
    expect(kinds(h.order)).toEqual(["check:busy", "read:card", "check:head", "evaluate:later"]);
  });
});

describe("no starvation of the heavy class", () => {
  test("after ten seconds of light work ahead of it, the oldest heavy job runs; the next one gets the same bound", async () => {
    const h = harness();
    // Every read takes 600 ms and the page posts the next one while it runs.
    let next = 100;
    const trickle = label => {
      h.cost[`read:${label}@base`] = 600;
      h.during[`read:${label}@base`] = () => { if (next < 140) { const id = next++; trickle(`r${id}`); h.send(read(id, `r${id}`)); } };
    };
    trickle("r0");
    h.send(evaluate(1, "heavy")); h.send(evaluate(2, "second")); h.send(read(3, "r0"));
    await h.drain();
    const at = kinds(h.order).indexOf("evaluate:heavy"), second = kinds(h.order).indexOf("evaluate:second");
    // 17 reads of 600 ms reach the 10 s limit; the heavy job then runs.
    expect(at).toBe(17);
    expect(kinds(h.order).slice(0, at).every(row => row.startsWith("read:"))).toBe(true);
    expect(second - at).toBe(18);
    expect(h.order).toHaveLength(43);
    expect(h.answers().every(row => row.ok)).toBe(true);
  });
});

describe("ordered jobs keep their arrival position", () => {
  test("nothing passes a storage commit or load, and neither passes a heavy job", async () => {
    const h = harness();
    h.during["evaluate:busy@base"] = () => {
      h.send(check(3, "heavy")); h.send(read(2, "before")); h.send(commit(4)); h.send(read(5, "after commit"));
      h.send(evaluate(6, "second")); h.send(load(7)); h.send(ordinary(8, "after load"));
    };
    h.send(evaluate(1, "busy"));
    await h.drain();
    // `before` passes the heavy check; the commit stays behind that check; the
    // read behind the commit cannot pass it; the load reads what was committed.
    expect(kinds(h.order)).toEqual(["evaluate:busy", "read:before", "check:heavy", "storage:commit", "read:after commit",
      "evaluate:second", "storage:load", "ordinary:after load"]);
    expect(h.answers().find(row => row.id === 7).result.storageRecord).toEqual(h.storage[0]);
  });

  test("a read posted behind a queued initialization runs on the new snapshot, never before it", async () => {
    const h = harness();
    const initialize = { id: 3, method: "initialize", localSourceId: "tab-a", sessionEpoch: 1,
      snapshot: { owners: [], fields: [], facets: [] }, entities: [], functions: [] };
    h.during["evaluate:busy@base"] = () => { h.send(check(2, "heavy")); h.send(initialize); h.send(read(4, "next snapshot")); };
    h.send(evaluate(1, "busy"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["evaluate:busy", "check:heavy", "initialize", "read:next snapshot"]);
    expect(h.answers().find(row => row.id === 4).ok).toBe(true);
  });
});

describe("requests of one scoped context keep their order", () => {
  const scope = { sourceId: "tab-a", functions: [], marker: "draft" };
  test("a read of a context waits for the queued job that creates it; a base read still passes", async () => {
    const h = harness();
    h.during["evaluate:busy@base"] = () => {
      h.send(check(2, "creator", { contextId: 7, scope }));     // heavy, creates context 7 when it runs
      h.send(read(3, "in context", { contextId: 7 }));          // light, needs context 7
      h.send(read(4, "base"));                                  // light, base context
    };
    h.send(evaluate(1, "busy"));
    await h.drain();
    expect(h.order).toEqual(["evaluate:busy@base", "read:base@base", "check:creator", "read:in context@draft"]);
    expect(h.answers().map(row => [row.id, row.ok])).toEqual([[1, true], [4, true], [2, true], [3, true]]);
    expect(h.replies.some(row => row.code === "context-missing")).toBe(false);
  });

  test("a scoped read does not pass an earlier request of its own context; another context passes", async () => {
    const h = harness();
    h.during["evaluate:busy@base"] = () => {
      h.send(check(2, "of seven", { contextId: 7 }));                       // heavy, context 7, no scope
      h.send(read(3, "creates seven", { contextId: 7, scope }));            // light, would replace context 7 first
      h.send(read(4, "creates eight", { contextId: 8, scope: { ...scope, marker: "other" } }));
    };
    h.send(read(10, "first", { contextId: 7, scope })); h.send(evaluate(1, "busy"));
    await h.drain();
    expect(h.order).toEqual(["read:first@draft", "evaluate:busy@base", "read:creates eight@other", "check:of seven",
      "read:creates seven@draft"]);
  });
});

describe("cancellation and release under the new order", () => {
  test("cancelled queued jobs never start, whatever their class; a cancelled running job publishes nothing", async () => {
    const h = harness();
    h.during["evaluate:busy@base"] = () => {
      h.send(evaluate(2, "stale preview")); h.send(check(3, "stale check")); h.send(read(4, "stale read")); h.send(read(5, "kept"));
      h.send({ id: 2, method: "cancel" }); h.send({ id: 3, method: "cancel" }); h.send({ id: 4, method: "cancel" });
      h.send(evaluate(6, "running"));
    };
    h.send(evaluate(1, "busy"));
    for (let count = 0; count < 100 && !h.started().includes(6); count++) await h.turn();
    expect(h.started()).toContain(6);
    h.send({ id: 6, method: "cancel" });
    await h.drain();
    expect(kinds(h.order)).toEqual(["evaluate:busy", "read:kept"]);
    expect(h.answers().map(row => row.id)).toEqual([1, 5]);
    expect(h.replies.filter(row => row.event === "finished").map(row => row.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h.api.cancelled.size).toBe(0);
    expect(h.api.active.size).toBe(0);
  });

  test("a release drops every queued job, passed or not, and the realm serves the next request", async () => {
    const h = harness();
    h.during["read:running@base"] = () => {
      h.send(evaluate(2, "heavy")); h.send(read(3, "light")); h.send({ id: 4, method: "release" }); h.send(ordinary(5, "after release"));
    };
    h.send(read(1, "running"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["read:running", "ordinary:after release"]);
    expect(h.api.contexts.size).toBe(0);
    expect(h.api.active.size).toBe(0);
  });
});

describe("guidance waits for the page after a foreground reply", () => {
  test("children posted 40 ms after their parent's reply run before the next guidance job", async () => {
    const h = harness();
    // The page answers the parent's reply 40 ms later with its children.
    h.hooks.reply = row => { if (row.id === 3) h.page(40, () => { h.send(read(4, "child")); h.send(read(5, "sibling")); }); };
    h.send(print(1, "hidden text", { priority: "guidance" })); h.send(check(2, "hidden check", { priority: "guidance" })); h.send(read(3, "parent"));
    await h.drain();
    expect(kinds(h.order)).toEqual(["read:parent", "read:child", "read:sibling", "print:hidden text", "check:hidden check"]);
    // The children started 40 ms after the reply, not after a 9 s print.
    expect(h.answers().map(row => row.id)).toEqual([3, 4, 5, 1, 2]);
  });

  test("the wait is bounded: with no further message, guidance starts after the quiet interval", async () => {
    const h = harness();
    h.send(read(1, "parent")); h.send(print(2, "text", { priority: "guidance" }));
    await h.drain();
    expect(kinds(h.order)).toEqual(["read:parent", "print:text"]);
    // 50 ms of read, then 150 ms of quiet, then 9 s of printing.
    expect(h.clock.now).toBe(1000 + 50 + 150 + 9000);
    // With no foreground work at all, guidance starts at once.
    const idle = harness();
    idle.send(print(1, "text", { priority: "guidance" }));
    await idle.drain();
    expect(idle.clock.now).toBe(1000 + 9000);
  });

  test("a steady trickle of foreground work holds guidance for two seconds at most", async () => {
    const h = harness();
    let id = 10;
    // Every reply is followed 100 ms later by one more read of 100 ms.
    h.cost["read:r@base"] = 100;
    h.hooks.reply = row => { if (row.id >= 10 && id < 26) h.page(100, () => h.send(read(id++, "r"))); };
    h.send(print(1, "text", { priority: "guidance" })); h.send(read(id++, "r"));
    await h.drain();
    // Reads end at 1100, 1300, ... ; the quiet wait began at 1100 and gives up at 3100.
    expect(kinds(h.order).indexOf("print:text")).toBe(11);
    expect(h.order).toHaveLength(17);
  });
});
