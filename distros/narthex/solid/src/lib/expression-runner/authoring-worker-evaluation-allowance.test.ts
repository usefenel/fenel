import { describe, expect, test } from "bun:test";
import { closeAuthoringTransport, createAuthoringWorkerTransport, requestAuthoringTransport,
  AUTHORING_JOB_ALLOWANCE_MS } from "./authoring-worker-transport";

// Recipes lane 2 (Nov 8): a Local recipe card's first evaluation runs minutes;
// at the ordinary 180 s allowance the transport closed the whole worker and
// the card never appeared. A data card's own evaluation asks for the 600 s
// evaluation allowance; every other job keeps 180 s.
function fakeWorker() {
  const posted: Array<{ id: number }> = [];
  const worker = { postMessage: (message: { id: number }) => { posted.push(message); }, terminate: () => {},
    onmessage: null as null | ((event: { data: unknown }) => void) };
  return { worker, posted };
}
function started(transport: ReturnType<typeof createAuthoringWorkerTransport>, worker: ReturnType<typeof fakeWorker>["worker"], id: number) {
  worker.onmessage!({ data: { id, event: "started", startedAt: performance.timeOrigin + performance.now() } });
  const job = transport.jobs.get(id) as { executionDeadline?: number } | undefined;
  return (job?.executionDeadline ?? 0) - (performance.timeOrigin + performance.now());
}
const evaluate = { method: "evaluate-expression", node: { kind: "literal", value: 1 }, savedExpressions: [] } as never;

describe("a data card's evaluation allowance", () => {
  test("an evaluation that asks for it runs up to 600 s; an ordinary job keeps 180 s", () => {
    const { worker, posted } = fakeWorker();
    const transport = createAuthoringWorkerTransport(worker as unknown as Worker, 1);
    try {
      void requestAuthoringTransport(transport, evaluate, undefined, undefined, undefined, "evaluation").catch(() => {});
      const long = started(transport, worker, posted[0]!.id);
      expect(long).toBeGreaterThan(590_000);
      expect(long).toBeLessThanOrEqual(600_000);
      void requestAuthoringTransport(transport, evaluate).catch(() => {});
      const ordinary = started(transport, worker, posted[1]!.id);
      expect(ordinary).toBeGreaterThan(AUTHORING_JOB_ALLOWANCE_MS - 10_000);
      expect(ordinary).toBeLessThanOrEqual(AUTHORING_JOB_ALLOWANCE_MS);
    } finally { closeAuthoringTransport(transport, "test over"); }
  });
  test("initialization keeps its own bound whatever the request says", () => {
    const { worker, posted } = fakeWorker();
    const transport = createAuthoringWorkerTransport(worker as unknown as Worker, 1);
    try {
      void requestAuthoringTransport(transport, { method: "initialize" } as never, undefined, undefined, undefined, "evaluation").catch(() => {});
      expect((transport.jobs.get(posted[0]!.id) as { allowanceMs?: number } | undefined)?.allowanceMs).toBeUndefined();
    } finally { closeAuthoringTransport(transport, "test over"); }
  });
});
