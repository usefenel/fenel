// C1/C2: actual physical transport, graph copier and ordinary adapter. The
// controlled Worker port performs native clones; no app registry is acquired.
import { afterEach, describe, expect, test } from "bun:test";
import { prepareAuthoringLocalOperation } from "./authoring-worker-local-ordinary";
import { closeAuthoringTransport, createAuthoringWorkerTransport } from "./authoring-worker-transport";

const transports = [];
afterEach(() => { for (const transport of transports.splice(0)) closeAuthoringTransport(transport, "fixture closed"); });
function fixture() {
  const worker = {
    sent: [], postMessage(message) { this.sent.push(structuredClone(message)); }, terminate() {},
    reply(result, id = this.sent[0].id) { this.onmessage({ data: structuredClone({ id, ok: true, result }) }); },
  };
  const transport = createAuthoringWorkerTransport(worker, 1);
  transports.push(transport);
  let current = true;
  return { worker, transport, stale() { current = false; },
    options: { assertCurrent() { if (!current) throw new Error("reader changed"); } },
    pair(value, operation = worker.sent[0].operation) { worker.reply({ localOrdinary: { operation, value } }); },
  };
}
const operationFor = value => ({ kind: "validateTabData", args: [value] });

describe("ordinary worker paired graph adapter", () => {
  test("reattaches real sharing and keeps equal distinct nodes distinct", async () => {
    const h = fixture(), shared = { pixels: [[1, 2, 3], [4, 5, 6]] }, distinct = { pixels: [[1, 2, 3], [4, 5, 6]] };
    const state = { shared, again: shared, distinct };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(state), h.options);
    const received = h.worker.sent[0].operation.args[0];
    h.pair({ $tag: "Ok", _0: { original: received, retained: received.shared, equal: received.distinct,
      fresh: { pixels: [[1, 2, 3], [4, 5, 6]] } } });
    const result = await flight;
    expect(result.kind).toBe("prepared");
    expect(result.value._0.original).toBe(state);
    expect(result.value._0.retained).toBe(shared);
    expect(result.value._0.equal).toBe(distinct);
    expect(result.value._0.fresh).toEqual(shared);
    expect(result.value._0.fresh).not.toBe(shared);
    result.assertCurrent(); result.release();
    expect(() => result.assertCurrent()).toThrow("released");
  });

  test("reattaches typed views and their exact shared backing", async () => {
    const h = fixture(), buffer = new ArrayBuffer(12), bytes = new Uint8Array(buffer, 2, 6), view = new DataView(buffer, 4, 2);
    bytes.set([1, 2, 3, 4, 5, 6]);
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor({ buffer, bytes, view }), h.options);
    const received = h.worker.sent[0].operation.args[0];
    h.pair({ $tag: "Ok", _0: { bytes: received.bytes, view: received.view, buffer: received.buffer } });
    const result = await flight;
    expect(result.value._0.bytes).toBe(bytes); expect(result.value._0.view).toBe(view); expect(result.value._0.buffer).toBe(buffer);
    result.release();
  });

  test("a layout-only result retains an image without interning the new layout", async () => {
    const h = fixture(), image = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => [11, 22, 33, 255]));
    const state = { image, layout: { kind: "list" } };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(state), h.options);
    const received = h.worker.sent[0].operation.args[0];
    h.pair({ $tag: "Ok", _0: { image: received.image, layout: { kind: "grid" } } });
    const result = await flight;
    expect(result.value._0.image).toBe(image); expect(result.value._0.layout).not.toBe(state.layout);
    result.release();
  });

  test("separately cloning the paired input and value cannot fabricate reference reuse", async () => {
    const h = fixture(), state = { nested: { x: 1 } };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(state), h.options);
    const received = h.worker.sent[0].operation;
    h.pair(structuredClone({ $tag: "Ok", _0: received.args[0] }), structuredClone(received));
    const result = await flight;
    expect(result.value._0).toEqual(state); expect(result.value._0).not.toBe(state);
    result.release();
  });

  test("deep mutation after posting refuses without a second request", async () => {
    const h = fixture(), state = { child: { value: 1 } };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(state), h.options);
    state.child.value = 2;
    h.pair({ $tag: "Ok", _0: h.worker.sent[0].operation.args[0] });
    await expect(flight).rejects.toThrow("changed"); expect(h.worker.sent).toHaveLength(1);
  });

  test("native byte mutation is checked again after awaited preparation", async () => {
    const h = fixture(), state = { bytes: new Uint8Array([1, 2, 3]) };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(state), h.options);
    h.pair({ $tag: "Ok", _0: h.worker.sent[0].operation.args[0] });
    const result = await flight;
    await Promise.resolve(); state.bytes[0] = 7;
    expect(() => result.assertCurrent()).toThrow("bytes changed");
    result.release();
  });

  test("caller freshness fences both delivery and later publication", async () => {
    const before = fixture(), first = prepareAuthoringLocalOperation(before.transport, operationFor({}), before.options);
    before.stale(); before.pair({ $tag: "Ok", _0: {} });
    await expect(first).rejects.toThrow("reader changed");
    const after = fixture(), second = prepareAuthoringLocalOperation(after.transport, operationFor({}), after.options);
    after.pair({ $tag: "Ok", _0: {} });
    const prepared = await second;
    after.stale(); expect(() => prepared.assertCurrent()).toThrow("reader changed"); prepared.release();
  });

  test("request graph tampering and alias splitting refuse", async () => {
    for (const tamper of [operation => { operation.args[0].left.x = 8; },
      operation => { operation.args[0].right = structuredClone(operation.args[0].right); }]) {
      const h = fixture(), child = { x: 1 };
      const flight = prepareAuthoringLocalOperation(h.transport, operationFor({ left: child, right: child }), h.options);
      const received = h.worker.sent[0].operation;
      tamper(received); h.pair({ $tag: "Ok", _0: received.args[0] });
      await expect(flight).rejects.toThrow("transport");
    }
  });

  test.each([null, [], {}, { localOrdinary: [] }, { localOrdinary: {} },
    { localOrdinary: { operation: {}, value: 1, extra: 1 } }, { localOrdinary: { operation: {} }, extra: 1 }].map(value => [value]))(
    "malformed response refuses: %p", async reply => {
      const h = fixture(), flight = prepareAuthoringLocalOperation(h.transport, operationFor({}), h.options);
      h.worker.reply(reply); await expect(flight).rejects.toThrow("response"); expect(h.worker.sent).toHaveLength(1);
    });

  test("unsupported initial native Date sends nothing; Fenel-shaped dates remain data", async () => {
    const h = fixture();
    const result = await prepareAuthoringLocalOperation(h.transport, operationFor({ date: new Date(0) }), h.options);
    expect(result.kind).toBe("unsupported"); expect(h.worker.sent).toEqual([]);
    const date = { $tag: "Date", year: 2026, month: 10, day: 29 };
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor(date), h.options);
    h.pair({ $tag: "Ok", _0: h.worker.sent[0].operation.args[0] });
    const prepared = await flight; expect(prepared.value._0).toBe(date); prepared.release();
  });

  test("unsupported result carriers reject after posting without fallback", async () => {
    const h = fixture(), flight = prepareAuthoringLocalOperation(h.transport, operationFor({}), h.options);
    h.pair({ $tag: "Ok", _0: new Map([[1, 2]]) });
    await expect(flight).rejects.toThrow(); expect(h.worker.sent).toHaveLength(1);
  });

  test("closed operation validation precedes posting and cannot select an arbitrary function", async () => {
    const h = fixture();
    await expect(prepareAuthoringLocalOperation(h.transport, { kind: "perform", args: [] }, h.options)).rejects.toThrow("operation");
    expect(h.worker.sent).toEqual([]);
  });

  test("publication envelope never invokes authored label iterators or getters", async () => {
    let executions = 0;
    const withIterator = Object.defineProperty([], Symbol.iterator, { enumerable: true,
      value: function* () { executions++; yield { id: "fn", label: "label" }; } });
    const withGetter = Object.defineProperty([], "0", { enumerable: true,
      get() { executions++; return { id: "fn", label: "label" }; } });
    class CustomLabels extends Array { *[Symbol.iterator]() { executions++; yield { id: "fn", label: "label" }; } }
    for (const callableLabels of [withIterator, withGetter, new CustomLabels()]) {
      const h = fixture();
      await expect(prepareAuthoringLocalOperation(h.transport,
        { kind: "publication", args: [{}, {}, { callableLabels }] }, h.options)).rejects.toThrow();
      expect(executions).toBe(0); expect(h.worker.sent).toEqual([]);
    }
  });

  test("cancellation before and after posting refuses without retaining a publication", async () => {
    const h = fixture(), early = new AbortController(); early.abort(new Error("closed before request"));
    await expect(prepareAuthoringLocalOperation(h.transport, operationFor({}), { ...h.options, signal: early.signal })).rejects.toThrow("closed before request");
    expect(h.worker.sent).toEqual([]);
    const abort = new AbortController();
    const flight = prepareAuthoringLocalOperation(h.transport, operationFor({}), { ...h.options, signal: abort.signal });
    abort.abort(new Error("reader cancelled"));
    await expect(flight).rejects.toThrow("reader cancelled");
    expect(h.worker.sent.map(row => row.method)).toEqual(["run-local-ordinary", "cancel"]);
    h.pair({ $tag: "Ok", _0: {} });
  });

  test("worker failure stays a refusal and does not create another physical owner", async () => {
    const h = fixture(), flight = prepareAuthoringLocalOperation(h.transport, operationFor({}), h.options);
    closeAuthoringTransport(h.transport, "worker failed");
    await expect(flight).rejects.toThrow("worker failed"); expect(h.worker.sent).toHaveLength(1);
  });
});
