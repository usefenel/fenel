import { describe, expect, test } from "bun:test";

// B4 slice 2 scheduling/transport fixture only. The production worker message
// handler, pump and branches are extracted unchanged; semantic adapters are
// controlled and record their order. Parity of the semantics themselves is
// pinned against the real engine in authoring-expression-worker.test.ts.
// No engine module, registry or actual Worker is imported here.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const workerSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const workerCode = transpiler.transformSync(workerSource.slice(workerSource.indexOf("const scope =")))
  .replace(/^export /gm, "").replaceAll("import.meta.env.BASE_URL", '"/"');
const clone = value => structuredClone(value);
const node = value => ({ kind: "literal", value });
async function settle() { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); }

function workerHarness() {
  const replies = [], order = [], turns = [], calls = [];
  const session = { registry: { fixture: "exact-registry", getIdentifiedEntity: name => name === "Scores" ? { type: { $list: { $ref: "Number" } } } : undefined },
    environment: { fixture: "exact-environment" }, evaluateContext: { fixture: "base-frame" } };
  const scope = { postMessage: value => replies.push(clone(value)) };
  const label = data => typeof data?.value === "string" ? data.value : "?";
  const imports = {
    globalThis: scope, initialSession: session,
    isReaderExtensionMethod: () => false,
    registryTransportSnapshot: value => clone(value),
    draftSaveIssue(value, environment, options) { order.push(`save:${label(value)}`); calls.push({ method: "check", value, environment, options }); return undefined; },
    evaluateAuthoringExpressionInSession(value) { order.push(`evaluate:${label(value)}`); return { result: `value of ${label(value)}`, trace: [] }; },
    expressionMediaScheduling: value => label(value).startsWith("sound") ? { weight: 2 } : { weight: 0 },
    authoringExpressionAdmissionRequired: () => false,
    restoreSavedExpressionDeclarations() {}, restoreSavedExpressionDeclaration: value => value,
    readerSourceMetadataEvaluateContext: (base, packet) => packet ? { ...base, metadata: packet } : base,
    checkRegistryPreparationBuild() {}, AUTHORING_BUILD_IDENTITY: "fixture-build",
    runRegistryPreparation: request => { order.push(`prepare:${request.kind}`); return { prepared: true }; },
    registryPreparationFailure: error => ({ error: String(error) }),
    LIVE_INFERENCE_BATCH_LIMIT: 64,
    peelListForAuthoring: type => type?.$list ? { elem: type.$list } : undefined,
    resolveValueType: (type, resolve) => type.$ref ? resolve(type.$ref) ?? type : type,
    literalMembershipFor: (environment, options) => ({ fixture: "worker-membership", environment, options }),
    inferAuthoringExpressionWithLiteralWitnesses(value, context, options) {
      order.push(`infer:${label(value)}`); calls.push({ method: "infer", value, context, options });
      return { outcome: { $tag: "Solved", diagnostics: [] }, type: { $ref: "Number" } };
    },
    judgeAuthoringResult(value, expected, scheme, judgeLabel, result, framed) {
      calls.push({ method: "judge", value, expected, scheme, label: judgeLabel, result, framed });
      return { mismatch: true, message: `judged ${label(value)}`, graphIssue: undefined };
    },
    // The reader-scoped wrappers the worker calls today (literal-membership.ts,
    // data-suggestions.ts): identity over the controlled owners above.
    inferScopedAuthoringExpression: (...args) => imports.inferAuthoringExpressionWithLiteralWitnesses(...args),
    scopedResultRequirement: (_session, requirement) => requirement,
    scopedExpectedType: (_session, expected) => expected,
    setTimeout(callback) { turns.push(callback); return turns.length; },
    // A controlled clock: each inference takes 10 ms.
    performance: { timeOrigin: 0, now: () => clock.now, measure() {} },
  };
  const clock = { now: 1000 };
  const realInfer = imports.inferAuthoringExpressionWithLiteralWitnesses;
  imports.inferAuthoringExpressionWithLiteralWitnesses = (...args) => { clock.now += 10; return realInfer(...args); };
  const api = new Function(...Object.keys(imports), `${workerCode}; base = initialSession; return { cancelled };`)(...Object.values(imports));
  const post = data => scope.onmessage({ data: clone(data) });
  const step = async () => { for (const callback of turns.splice(0)) callback(); await settle(); };
  const release = async () => { for (let round = 0; round < 20 && turns.length; round++) { for (const callback of turns.splice(0)) callback(); await settle(); } };
  return { api, post, step, release, order, calls, replies, session, answers: () => replies.filter(row => "ok" in row) };
}

const save = (id, value) => ({ id, method: "expression-save-issue", contextId: 0, node: node(value), savedExpressions: [] });
const guidance = (id, value) => ({ id, method: "infer-expression", contextId: 0, priority: "guidance",
  items: [{ node: node(value), judge: { expected: { $ref: "Number" }, label: "Number" } }], savedExpressions: [] });

describe("live guidance waits behind every other worker job", () => {
  test("guidance queued first runs after Save admission, registry preparation and a media evaluation", async () => {
    const h = workerHarness();
    h.post(save(1, "busy"));
    await settle();
    // While the worker is busy, guidance is queued first and the others after it.
    h.post(guidance(2, "live"));
    h.post({ id: 3, method: "evaluate-expression", contextId: 0, node: node("sound track"), savedExpressions: [] });
    h.post(save(4, "save"));
    h.post({ id: 5, method: "prepare-repository-registry-step", request: { kind: "fields" }, build: "fixture-build" });
    await h.release();
    expect(h.order).toEqual(["save:busy", "save:save", "prepare:fields", "evaluate:sound track", "infer:live"]);
    expect(h.answers().map(row => row.id)).toEqual([1, 4, 5, 3, 2]);
    expect(h.answers().every(row => row.ok)).toBe(true);
  });

  test("twenty surfaces opening at once never hold a Save or a registry step", async () => {
    const h = workerHarness();
    h.post(save(1, "busy"));
    await settle();
    // Twenty surfaces each send their one open request (inference or a
    // checked evaluation), then a Save and a registry step arrive.
    for (let index = 0; index < 20; index++) h.post(index % 2 ? guidance(10 + index, `open ${index}`)
      : { id: 10 + index, method: "evaluate-expression", contextId: 0, priority: "guidance", node: node(`open ${index}`), savedExpressions: [], admission: {} });
    h.post(save(2, "save"));
    h.post({ id: 3, method: "prepare-repository-registry-step", request: { kind: "fields" }, build: "fixture-build" });
    for (let round = 0; round < 4; round++) await h.release();
    expect(h.order.slice(0, 3)).toEqual(["save:busy", "save:save", "prepare:fields"]);
    expect(h.order.slice(3).filter(row => !row.startsWith("save:open"))).toHaveLength(20);
    expect(h.answers().slice(0, 3).map(row => row.id)).toEqual([1, 2, 3]);
  });

  test("a queued guidance job starts no clock while other jobs are scheduled before it", async () => {
    const h = workerHarness();
    h.post(save(1, "busy"));
    // A heavy job begins after one turn of the message queue (queue classes, 2026-11-11).
    await h.step();
    h.post({ id: 2, method: "evaluate-expression", contextId: 0, priority: "guidance", node: node("live"), savedExpressions: [], admission: {} });
    h.post(save(3, "save"));
    await settle();
    const started = () => h.replies.filter(row => row.event === "started").map(row => row.id);
    expect(started()).toEqual([1]);
    // The busy job finishes; the scheduler scans the queue and, one message
    // turn later, starts Save. The guidance job is still not started.
    await h.step();
    expect(h.order).toEqual(["save:busy"]);
    expect(started()).toEqual([1]);
    await h.step();
    expect(started()).toEqual([1, 3]);
    await h.release();
    expect(started()).toEqual([1, 3, 2]);
  });

  test("a cancelled queued guidance job never runs", async () => {
    const h = workerHarness();
    h.post(save(1, "busy"));
    await settle();
    h.post(guidance(2, "stale"));
    h.post({ id: 2, method: "cancel" });
    h.post(guidance(3, "latest"));
    await h.release();
    expect(h.order).toEqual(["save:busy", "infer:latest"]);
  });
});

describe("a running guidance batch yields to waiting work", () => {
  test("after a time slice, a waiting Save stops the batch; its finished items come back with the yield", async () => {
    const h = workerHarness();
    h.post({ id: 1, method: "infer-expression", contextId: 0, priority: "guidance", savedExpressions: [],
      items: [{ node: node("first") }, { node: node("second") }, { node: node("third") }] });
    // The batch starts after one turn of the message queue (queue classes,
    // 2026-11-11), infers its first item (10 ms), then yields its slice.
    await h.step();
    await h.step();
    expect(h.order).toEqual(["infer:first"]);
    h.post(save(2, "save"));
    await h.release();
    expect(h.order).toEqual(["infer:first", "save:save"]);
    expect(h.answers()).toEqual([
      { id: 1, ok: true, result: { inferences: [{ outcome: { $tag: "Solved", diagnostics: [] }, type: { $ref: "Number" } }], yielded: true } },
      { id: 2, ok: true, result: {} },
    ]);
  });

  test("with nothing waiting, the batch finishes every item", async () => {
    const h = workerHarness();
    h.post({ id: 1, method: "infer-expression", contextId: 0, priority: "guidance", savedExpressions: [],
      items: [{ node: node("first") }, { node: node("second") }, { node: node("third") }] });
    await h.release();
    expect(h.order).toEqual(["infer:first", "infer:second", "infer:third"]);
    expect(h.answers()[0].result.inferences).toHaveLength(3);
  });
});

describe("infer-expression and checked evaluation forward the existing semantics", () => {
  test("each item runs literal-witness inference in the reader's frame and, when asked, the shared judgment", async () => {
    const h = workerHarness();
    const scheme = { quantified: [], body: { $ref: "Number" } };
    h.post({ id: 1, method: "infer-expression", contextId: 0, priority: "guidance", sourceMetadata: { generation: "live" },
      savedExpressions: [["saved", node(2)]], items: [
        { node: node("plain") },
        { node: { kind: "param", name: "x" }, bindings: { x: { $ref: "Number" } }, expectedScheme: scheme,
          judge: { expected: { $ref: "Number" }, scheme, label: "Number" } },
      ] });
    await h.release();
    const [answer] = h.answers();
    expect(answer).toEqual({ id: 1, ok: true, result: { inferences: [
      { outcome: { $tag: "Solved", diagnostics: [] }, type: { $ref: "Number" } },
      { outcome: { $tag: "Solved", diagnostics: [] }, type: { $ref: "Number" }, judgment: { mismatch: true, message: "judged ?", graphIssue: undefined } },
    ] } });
    const infers = h.calls.filter(row => row.method === "infer");
    expect(infers[0].options).toEqual({});
    expect(infers[1].options).toEqual({ expectedScheme: scheme });
    expect(infers[1].context.bindings).toEqual({ x: { $ref: "Number" } });
    expect(infers[0].context.bindings).toEqual({});
    expect(infers[1].context.fixture).toBe("exact-environment");
    expect(infers[1].context.resolveSavedExpr("saved")).toEqual(node(2));
    // The reader's own membership judge, in the request's metadata frame.
    expect(infers[1].context.literalMembership.options.registry).toBe(h.session.registry);
    expect(infers[1].context.literalMembership.options.evaluateContext.metadata).toEqual({ generation: "live" });
    const judge = h.calls.find(row => row.method === "judge");
    expect(judge.label).toBe("Number");
    expect(judge.scheme).toEqual(scheme);
    expect(judge.result).toEqual({ outcome: { $tag: "Solved", diagnostics: [] }, type: { $ref: "Number" } });
    expect(judge.framed.registry).toBe(h.session.registry);
    expect(judge.framed.evaluateContext.metadata).toEqual({ generation: "live" });
  });

  test("more than 64 items refuse before any inference", async () => {
    const h = workerHarness();
    h.post({ id: 1, method: "infer-expression", contextId: 0, savedExpressions: [],
      items: Array.from({ length: 65 }, (_, index) => ({ node: node(index) })) });
    await h.release();
    expect(h.answers()).toEqual([{ id: 1, ok: false, error: "The live inference request could not be read." }]);
    expect(h.calls).toEqual([]);
  });

  test("evaluate-expression with admission checks the value it has just evaluated and returns both", async () => {
    const h = workerHarness();
    h.post({ id: 1, method: "evaluate-expression", contextId: 0, node: node("draft"), savedExpressions: [["saved", node(2)]],
      admission: { expectedListType: { $ref: "Scores" }, expectedTypeName: "Score" } });
    await h.release();
    expect(h.order).toEqual(["evaluate:draft", "save:draft"]);
    const check = h.calls.find(row => row.method === "check");
    expect(check.options.evaluatedValue).toBe("value of draft");
    expect(check.options.expectedType).toEqual({ $ref: "Number" });
    expect(check.options.expectedTypeName).toBe("Score");
    expect(check.options.registry).toBe(h.session.registry);
    expect(check.options.resolveSavedExpr("saved")).toEqual(node(2));
    expect(h.answers()).toEqual([{ id: 1, ok: true, result: { result: "value of draft", trace: [] } }]);
    const plain = workerHarness();
    plain.post({ id: 1, method: "evaluate-expression", contextId: 0, node: node("draft"), savedExpressions: [] });
    await plain.release();
    expect(plain.order).toEqual(["evaluate:draft"]);
  });
});
