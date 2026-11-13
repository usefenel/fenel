import { describe, expect, test } from "bun:test";

// Execute the actual invocation and browser routing adapters with controlled
// callable/worker ports. No numeric parser or engine registry is reproduced.
const source = await Bun.file(new URL("./numeric-text-codec.ts", import.meta.url)).text();
const start = source.indexOf("/** Existing scoped invocation");
if (start < 0) throw new Error("The shared numeric invocation boundary moved.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)
  .replace('import("./expression-runner/authoring-catalog-worker")', "loadWorkers()"))
  .replace(/^export /gm, "");
const methods = () => ({ decode: { $ref: "source.decode" }, encode: { $ref: "source.encode" } });
const settle = async () => { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); };

function fixture({ remoteOnly = false } = {}) {
  const calls = [], resolutions = [], plans = [], requests = [], lookups = [];
  const frame = { marker: "captured numeric frame" };
  const session = { evaluateContext: frame, registry: {
    getFunction(handle) {
      if (remoteOnly) throw new Error("Main-thread function lookup");
      resolutions.push(handle);
      return state.functions.get(handle);
    },
    getUuid(id) { return state.uuids.get(id); },
  } };
  let loads = 0;
  const state = {
    functions: new Map([["source.decode", { id: "decode.owner" }], ["source.encode", { id: "encode.owner" }]]),
    uuids: new Map([["decode.owner", "decode.uuid"], ["encode.owner", "encode.uuid"]]),
    result: { $tag: "Ok", _0: "source value" },
    plan: methods(), worker: {}, lookupError: undefined, loadError: undefined,
    run: () => Promise.resolve({ decoded: { ok: true, value: "remote value" } }),
  };
  const workers = {
    preparedReaderWorkerForSession(selected) {
      lookups.push(selected);
      if (state.lookupError) throw state.lookupError;
      return state.worker;
    },
    runPreparedReaderWorker(worker, payload, signal) {
      requests.push({ worker, payload, signal });
      return state.run(worker, payload, signal);
    },
  };
  const bindings = {
    invokeCallable(callable, args, selectedFrame) {
      if (remoteOnly) throw new Error("Main-thread numeric invocation");
      calls.push({ callable, args, frame: selectedFrame });
      if (state.result instanceof Error) throw state.result;
      return state.result;
    },
    Ref: handle => ({ $ref: handle }),
    refHandle: method => method && typeof method === "object" && typeof method.$ref === "string" ? method.$ref : undefined,
    fieldNumericTextCodecPlan(typeName, selectedFrame) {
      if (remoteOnly) throw new Error("Main-thread numeric plan");
      plans.push({ typeName, frame: selectedFrame });
      return state.plan;
    },
    async loadWorkers() { loads++; if (state.loadError) throw state.loadError; return workers; },
  };
  const api = new Function(...Object.keys(bindings), `${code}; return { runNumericTextCodec, numericTextCodec };`)(...Object.values(bindings));
  return { api, calls, resolutions, plans, requests, lookups, frame, session, workers, state, loads: () => loads };
}

describe("shared numeric text invocation", () => {
  test("resolves the exact source function through its physical handle and invokes only the captured frame", () => {
    const h = fixture();
    const value = { numerator: "3", denominator: "7" };
    h.state.result = { $tag: "Ok", _0: value };
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "3/7")).toEqual({ ok: true, value });
    expect(h.calls[0]).toEqual({ callable: { $ref: "decode.uuid" }, args: ["3/7"], frame: h.frame });
    expect(h.resolutions).toEqual(["source.decode"]);
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "3/7").value).toBe(value);
    h.state.result = { $tag: "Ok", _0: "3/7" };
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "encode", value)).toEqual({ ok: true, value: "3/7" });
    expect(h.calls.at(-1)).toEqual({ callable: { $ref: "encode.uuid" }, args: [value], frame: h.frame });
    expect(h.loads()).toBe(0);
  });

  test("type-name selection uses the same frame, misses refuse, and Fenel closure data passes unchanged", () => {
    const h = fixture();
    expect(h.api.runNumericTextCodec(h.session, { typeName: "Rational" }, "decode", "3/7").ok).toBe(true);
    expect(h.plans).toEqual([{ typeName: "Rational", frame: h.frame }]);
    h.state.plan = undefined;
    expect(h.api.runNumericTextCodec(h.session, { typeName: "Unavailable" }, "decode", "7").ok).toBe(false);
    h.state.functions.clear();
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "7").ok).toBe(false);
    expect(h.calls).toHaveLength(1);
    const closure = { __fenelFn: true, body: { var: "text" }, closure: {} };
    expect(h.api.runNumericTextCodec(h.session, { methods: { decode: closure, encode: closure } }, "decode", "7").ok).toBe(true);
    expect(h.calls.at(-1).callable).toBe(closure);
  });

  test("source errors and malformed Result values never become successful numeric text", () => {
    const h = fixture();
    h.state.result = { $tag: "Err", _0: "Exact numeric source issue" };
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "unfinished"))
      .toEqual({ ok: false, error: "Exact numeric source issue" });
    for (const result of [undefined, { ok: true, value: 4 }, { $tag: "Just", _0: 4 }, { $tag: "Err", _0: 4 }, { $tag: "Ok" }]) {
      h.state.result = result;
      expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "x").ok).toBe(false);
    }
    h.state.result = { $tag: "Ok", _0: 4 };
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "encode", 4).ok).toBe(false);
    h.state.result = new Error("Exact invocation refusal");
    expect(h.api.runNumericTextCodec(h.session, { methods: methods() }, "decode", "x"))
      .toEqual({ ok: false, error: "Exact invocation refusal" });
  });

  test("the existing raw-method and wrapped sync signatures stay synchronous without loading a worker", () => {
    const h = fixture();
    for (const supplied of [methods(), { methods: methods() }, { typeName: "Rational" }]) {
      const codec = h.api.numericTextCodec(h.session, supplied);
      const decoded = codec.decode("source lexeme");
      expect(decoded).not.toBeInstanceOf(Promise);
      expect(decoded).toEqual({ ok: true, value: "source value" });
      expect(codec.encode(4)).toEqual({ ok: true, value: "source value" });
    }
    expect(h.loads()).toBe(0);
  });
});

describe("Local numeric text remote adapter", () => {
  test("captures one worker, forwards exact source inputs and returns only its inert numeric result", async () => {
    const h = fixture({ remoteOnly: true });
    const supplied = methods();
    const codec = h.api.numericTextCodec(h.session, supplied, { remote: true });
    const controller = new AbortController();
    const value = { b: 2, a: 1 };
    const decoded = { ok: true, value };
    h.state.run = () => Promise.resolve({ decoded });
    expect(await codec.decode("3/7", controller.signal)).toBe(decoded);
    expect(h.requests[0]).toEqual({ worker: h.state.worker,
      payload: { method: "decode-reader-numeric-text", codec: { methods: supplied }, value: "3/7" }, signal: controller.signal });
    const encoded = { ok: true, value: "3/7" };
    h.state.run = () => Promise.resolve({ encoded });
    expect(await codec.encode(value, controller.signal)).toBe(encoded);
    expect(h.requests[1].payload).toEqual({ method: "encode-reader-numeric-text", codec: { methods: supplied }, value });
    expect(h.requests[1].payload.value).toBe(value);
    expect(h.lookups.every(selected => selected === h.session)).toBe(true);
    expect(h.loads()).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect(h.plans).toHaveLength(0);
  });

  test("missing or refused preparation is handled even for an unused adapter and never invokes on the page", async () => {
    for (const problem of ["missing", "lookup", "import"]) {
      const h = fixture({ remoteOnly: true });
      if (problem === "missing") h.state.worker = undefined;
      else if (problem === "lookup") h.state.lookupError = new Error("Retired numeric service");
      else h.state.loadError = new Error("Numeric worker import refused");
      const codec = h.api.numericTextCodec(h.session, { typeName: "Rational" }, { remote: true });
      await settle();
      const issue = problem === "missing" ? "editing tools are not ready"
        : problem === "lookup" ? "Retired numeric service" : "Numeric worker import refused";
      await expect(codec.decode("3/7")).rejects.toThrow(issue);
      await expect(codec.encode(3)).rejects.toThrow(issue);
      expect(h.requests).toHaveLength(0);
      expect(h.calls).toHaveLength(0);
      expect(h.plans).toHaveLength(0);
    }
  });

  test("a replaced handle refuses both before dispatch and after completion without borrowing its successor", async () => {
    const h = fixture({ remoteOnly: true });
    const codec = h.api.numericTextCodec(h.session, { typeName: "Rational" }, { remote: true });
    await settle();
    const captured = h.state.worker;
    h.state.worker = {};
    await expect(codec.decode("3/7")).rejects.toThrow("reader was replaced");
    expect(h.requests).toHaveLength(0);
    h.state.worker = captured;
    let resolve;
    h.state.run = () => new Promise(answer => { resolve = answer; });
    const running = codec.encode(3);
    await settle();
    expect(h.requests[0].worker).toBe(captured);
    h.state.worker = {};
    resolve({ encoded: { ok: true, value: "obsolete result" } });
    await expect(running).rejects.toThrow("reader was replaced");
    expect(h.requests).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });

  test("abort fences surround dispatch and completion, and a worker refusal never falls back", async () => {
    const h = fixture({ remoteOnly: true });
    const codec = h.api.numericTextCodec(h.session, methods(), { remote: true });
    const before = new AbortController();
    const beforeIssue = new Error("Cancelled before numeric dispatch");
    before.abort(beforeIssue);
    await expect(codec.decode("3/7", before.signal)).rejects.toBe(beforeIssue);
    expect(h.requests).toHaveLength(0);
    let resolve;
    h.state.run = () => new Promise(answer => { resolve = answer; });
    const during = new AbortController();
    const running = codec.decode("3/7", during.signal);
    await settle();
    const duringIssue = new Error("Cancelled numeric completion");
    during.abort(duringIssue);
    resolve({ decoded: { ok: true, value: 3 } });
    await expect(running).rejects.toBe(duringIssue);
    const refusal = new Error("Exact worker refusal");
    h.state.run = () => Promise.reject(refusal);
    await expect(codec.encode(3)).rejects.toBe(refusal);
    expect(h.calls).toHaveLength(0);
    expect(h.plans).toHaveLength(0);
  });

  test("malformed replies refuse while a source error remains its exact inert result", async () => {
    const h = fixture({ remoteOnly: true });
    const codec = h.api.numericTextCodec(h.session, { typeName: "Rational" }, { remote: true });
    for (const reply of [null, [], {}, { decoded: undefined }, { decoded: {} }, { decoded: { ok: true } },
      { decoded: { ok: false, error: 4 } }]) {
      h.state.run = () => Promise.resolve(reply);
      await expect(codec.decode("3/7")).rejects.toThrow("text representation could not be read");
    }
    h.state.run = () => Promise.resolve({ encoded: { ok: true, value: 4 } });
    await expect(codec.encode(4)).rejects.toThrow("text representation could not be read");
    const issue = { ok: false, error: "Exact source number issue" };
    h.state.run = () => Promise.resolve({ decoded: issue });
    expect(await codec.decode("3/7")).toBe(issue);
    expect(h.calls).toHaveLength(0);
    expect(h.plans).toHaveLength(0);
  });

  test("source encode Err remains data while a rejected encode keeps its transport failure distinct", async () => {
    const h = fixture({ remoteOnly: true });
    const codec = h.api.numericTextCodec(h.session, { typeName: "Rational" }, { remote: true });
    const sourceIssue = { ok: false, error: "This source value has no text representation" };
    h.state.run = () => Promise.resolve({ encoded: sourceIssue });
    expect(await codec.encode(3)).toBe(sourceIssue);
    const transportIssue = new Error("The numeric reader retired during encoding");
    h.state.run = () => Promise.reject(transportIssue);
    await expect(codec.encode(3)).rejects.toBe(transportIssue);
    expect(h.requests.map(request => request.payload.method)).toEqual([
      "encode-reader-numeric-text", "encode-reader-numeric-text",
    ]);
    expect(h.calls).toHaveLength(0);
    expect(h.plans).toHaveLength(0);
  });
});
