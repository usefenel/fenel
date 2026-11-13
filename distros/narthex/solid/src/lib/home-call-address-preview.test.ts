// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { describe, expect, test } from "bun:test";
import { createLoadingBoundary, createMemo, createRoot, createSignal, flush, latest, onCleanup, untrack } from "solid-js";
import { createAsyncValue } from "./async-value";
import type { ExprNode } from "@fenel/engine/authoring/expression";

// The shared Call's actual request, async preview, evaluated result, Run and
// edit callbacks execute with the real shim and Solid 2 Loading boundary.
// Only the existing worker/reader interfaces are held; no evaluator is added.
const source = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
function section(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Shared Call preview boundary changed: ${startMarker}`);
  return source.slice(start, end);
}
const requestState = section("  const [addressRunRequest, setAddressRunRequest]", "  let addressInitialized = false;");
const preview = section("  const addressPreview = createAsyncValue(", "  const displayedResult = createMemo(");
const editing = section("  function setArg(idx: number, expr: ExprNode)", "  // Modal header uses the human-readable Labelable.");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(requestState + preview + editing);
type WorkerResult = { result: unknown; trace: readonly unknown[] };
type PreviewState = { loading: boolean; error: unknown; result: WorkerResult | undefined };
type Evaluated = WorkerResult | { result: undefined; trace: readonly unknown[]; error: string } | null;
type View = { mounted: true; state: PreviewState; evaluated: Evaluated } | { mounted: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); flush(); }

function harness() {
  const workerCalls: Array<{ node: ExprNode; saved: ReadonlyMap<string, ExprNode>; signal: AbortSignal; job: ReturnType<typeof deferred<WorkerResult>> }> = [];
  const session = { fixture: "reader-session" }, scope = { fixture: "original-account-scope" };
  const savedNode: ExprNode = { kind: "literal", value: "saved in the same reader" };
  let unavailable = false, mounts = 0;
  let dispose!: () => void;
  let callbacks!: { tryInput: () => void; setArg: (index: number, node: ExprNode) => void };
  const rendered = createRoot(end => {
    dispose = end;
    return createLoadingBoundary(() => {
      mounts++;
      const [args, setArgs] = createSignal<ExprNode[]>([{ kind: "literal", value: "first" }]);
      const [issues, setIssues] = createSignal<string[]>([]);
      const bindings = {
        createSignal, createMemo, createAsyncValue, latest, onCleanup, untrack,
        props: { addressInputs: [{ name: "s", text: "first" }] },
        fn: () => ({ id: "probe:identity" }),
        inputIssue: () => undefined,
        addressIssues: issues,
        setAddressIssues: setIssues,
        isIO: () => false,
        reader: { revision: () => 2 },
        sessionEpoch: () => 7,
        authoringSession: () => session,
        concreteAuthoringSession: (captured: unknown) => captured,
        authoringSessionAccountScope: (captured: unknown) => { expect(captured).toBe(session); return scope; },
        callExpr: () => ({ kind: "call", fnId: "probe:identity", args: args() }),
        cloneDraftValue: structuredClone,
        savedCtx: { list: () => [{ id: "same-reader-value", expr: savedNode }] },
        argExprs: args,
        setArgExprs: setArgs,
        evaluateExpressionInWorker: (captured: unknown, node: ExprNode, saved: ReadonlyMap<string, ExprNode>, signal: AbortSignal, accountScope: unknown) => {
          expect(captured).toBe(session); expect(accountScope).toBe(scope);
          if (unavailable) return undefined;
          const job = deferred<WorkerResult>(); workerCalls.push({ node, saved, signal, job }); return job.promise;
        },
        evaluateAuthoringExpression: () => { throw new Error("The URL preview must never use synchronous evaluation"); },
      };
      const owner = new Function(...Object.keys(bindings), `${code}; return { tryInput, setArg, addressPreviewState, evaluated };`)(...Object.values(bindings)) as
        typeof callbacks & { addressPreviewState: () => PreviewState; evaluated: () => Evaluated };
      callbacks = owner;
      return createMemo(() => ({ mounted: true, state: owner.addressPreviewState(), evaluated: owner.evaluated() }));
    }, () => ({ mounted: false }));
  });
  flush();
  return { workerCalls, dispose, view: rendered as () => View, mounts: () => mounts,
    run: () => { callbacks.tryInput(); flush(); },
    edit: (text: string) => { callbacks.setArg(0, { kind: "literal", value: text }); flush(); },
    noWorker: () => { unavailable = true; },
    savedNode,
  };
}
function mounted(h: ReturnType<typeof harness>) {
  const view = h.view(); expect(view.mounted).toBe(true);
  if (!view.mounted) throw new Error("An inline Call preview replaced its mounted content with outer Loading");
  expect(h.mounts()).toBe(1); return view;
}

describe("explicit URL Run remains inline in the shared Call", () => {
  test("idle to first Run keeps the mounted form and reports pending without executing before Run", async () => {
    const h = harness();
    try {
      expect(h.workerCalls).toHaveLength(0); expect(mounted(h).state).toMatchObject({ loading: false, error: undefined, result: undefined });
      h.run(); await settle();
      expect(h.workerCalls).toHaveLength(1);
      expect(h.workerCalls[0]!.saved.get("same-reader-value")).toBe(h.savedNode);
      expect(mounted(h).state).toMatchObject({ loading: true, error: undefined, result: undefined });
      expect(mounted(h).evaluated).toBeNull();
      const answer: WorkerResult = { result: "first", trace: [] }; h.workerCalls[0]!.job.resolve(answer); await settle();
      expect(mounted(h).state).toMatchObject({ loading: false, error: undefined, result: answer });
      expect(mounted(h).evaluated).toBe(answer);
    } finally { h.dispose(); }
  });

  test("a subsequent Run clears the prior result while its new worker response is held", async () => {
    const h = harness();
    try {
      h.run(); await settle(); h.workerCalls[0]!.job.resolve({ result: "prior", trace: [] }); await settle();
      expect(mounted(h).evaluated).toEqual({ result: "prior", trace: [] });
      h.run(); await settle();
      expect(h.workerCalls).toHaveLength(2); expect(h.workerCalls[0]!.signal.aborted).toBe(true);
      expect(mounted(h).state).toMatchObject({ loading: true, error: undefined, result: undefined }); expect(mounted(h).evaluated).toBeNull();
      const answer: WorkerResult = { result: "latest", trace: [] }; h.workerCalls[1]!.job.resolve(answer); await settle();
      expect(mounted(h).evaluated).toBe(answer);
    } finally { h.dispose(); }
  });

  test("worker failure stays inline, and a retry does not retain its prior error", async () => {
    const h = harness();
    try {
      h.run(); await settle(); const failure = new Error("worker refused call"); h.workerCalls[0]!.job.reject(failure); await settle();
      expect(mounted(h).state.error).toBe(failure); expect(mounted(h).evaluated).toEqual({ result: undefined, trace: [], error: "worker refused call" });
      h.run(); await settle();
      expect(mounted(h).state).toMatchObject({ loading: true, error: undefined, result: undefined }); expect(mounted(h).evaluated).toBeNull();
      h.workerCalls[1]!.job.resolve({ result: "recovered", trace: [] }); await settle();
      expect(mounted(h).state.error).toBeUndefined(); expect(mounted(h).evaluated).toEqual({ result: "recovered", trace: [] });
    } finally { h.dispose(); }
  });

  test("editing cancels a held Run and prevents its late response from reappearing", async () => {
    const h = harness();
    try {
      h.run(); await settle(); h.edit("edited input"); await settle();
      expect(h.workerCalls[0]!.signal.aborted).toBe(true); expect(h.workerCalls).toHaveLength(1);
      expect(mounted(h).state).toMatchObject({ loading: false, error: undefined, result: undefined }); expect(mounted(h).evaluated).toBeNull();
      h.workerCalls[0]!.job.resolve({ result: "obsolete", trace: [] }); await settle();
      expect(mounted(h).evaluated).toBeNull();
      h.run(); await settle();
      expect(h.workerCalls).toHaveLength(2);
      expect(h.workerCalls[1]!.node).toEqual({ kind: "call", fnId: "probe:identity", args: [{ kind: "literal", value: "edited input" }] });
      h.workerCalls[1]!.job.resolve({ result: "edited input", trace: [] }); await settle();
      expect(mounted(h).evaluated).toEqual({ result: "edited input", trace: [] });
    } finally { h.dispose(); }
  });

  test("unavailable editing tools report an inline issue without a synchronous fallback", async () => {
    const h = harness();
    try {
      h.noWorker(); h.run(); await settle();
      expect(h.workerCalls).toHaveLength(0);
      expect(mounted(h).state.loading).toBe(false);
      expect((mounted(h).state.error as Error).message).toContain("editing tools are not ready");
    } finally { h.dispose(); }
  });
});
