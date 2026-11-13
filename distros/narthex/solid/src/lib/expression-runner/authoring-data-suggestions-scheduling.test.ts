import { describe, expect, test } from "bun:test";
import type { AuthoringWorkerMessage } from "./authoring-worker-protocol";

// C1/C2: execute the production worker handler and shared host-yield leaf.
// Discovery is a controlled boundary: these checks establish scheduling,
// transport and cancellation, without claiming applicability or inference.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const sourceBody = source.slice(source.indexOf("const scope ="))
  .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/"));
const oldYield = /yieldControl: async \(\) => \{\s*if \(performance\.now\(\) - start >= 8\) \{\s*await yieldToInput\(\);\s*start = performance\.now\(\);\s*\}\s*\},/g;
if ([...sourceBody.matchAll(oldYield)].length !== 1) throw new Error("The production discovery scheduling boundary changed.");
const beforeCode = transpiler.transformSync(sourceBody.replace(oldYield, "yieldControl: pause,"));
const afterCode = transpiler.transformSync(sourceBody);
const extensionSource = await Bun.file(new URL("./authoring-worker-reader-extensions.ts", import.meta.url)).text();
const methodsStart = extensionSource.indexOf("const METHODS:");
const methodsEnd = extensionSource.indexOf("type PresentationRows", methodsStart);
if (methodsStart < 0 || methodsEnd < methodsStart) throw new Error("Reader extension selector boundary moved");
const extensionCode = transpiler.transformSync(extensionSource.slice(methodsStart, methodsEnd)).replace(/^export /gm, "");
const isReaderExtensionMethod = new Function(`${extensionCode}; return isReaderExtensionMethod;`)();
const yieldSource = await Bun.file(new URL("./async-suggestions.ts", import.meta.url)).text();
const yieldCode = transpiler.transformSync(yieldSource.slice(yieldSource.indexOf("export function yieldToInput")))
  .replace(/^export /gm, "");

type Request = { id: number; method: string; contextId?: number; input?: { revision: string }; options?: { maxOperations: number } };
type Reply = { id: number; ok: boolean; result?: unknown; error?: string };

function harness(options: { before?: boolean; cancelAtYield?: boolean; realTimers?: boolean; scheduler?: boolean } = {}) {
  let clock = 0;
  let hostYields = 0;
  let timers = 0;
  let selectedId = 0;
  let discovering = false;
  let handledCancellationAt: number | undefined;
  const cancellationEvents: string[] = [];
  const rows: number[] = [];
  const checkedInputs: unknown[] = [];
  const signals: AbortSignal[] = [];
  const replies: Reply[] = [];
  const scope: { postMessage: (reply: AuthoringWorkerMessage) => void; onmessage?: (event: { data: Request }) => void } = {
    postMessage: reply => { if (!("event" in reply)) replies.push(structuredClone(reply)); },
  };
  const hostYield = async () => {
    hostYields++;
    if (options.cancelAtYield && hostYields === 1) {
      cancellationEvents.push("yield-requested");
      await new Promise<void>((resolve, reject) => {
        // A real message task delivers Cancel while the worker is suspended;
        // neither a direct callback nor another microtask can establish this.
        const channel = new MessageChannel();
        channel.port1.onmessage = event => {
          try {
            scope.onmessage?.({ data: event.data });
            handledCancellationAt = rows.length;
            cancellationEvents.push("cancel-handled");
            resolve();
          } catch (error) { reject(error); }
          finally { channel.port1.close(); channel.port2.close(); }
        };
        queueMicrotask(() => cancellationEvents.push("microtask-before-message"));
        channel.port2.postMessage({ id: selectedId, method: "cancel" });
      });
    }
    if (options.realTimers) await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  const yieldLeaf = new Function("globalThis", "setTimeout", `${yieldCode}; return yieldToInput;`)(
    options.scheduler ? { scheduler: { yield: hostYield } } : {},
    (resolve: () => void) => { timers++; void hostYield().then(resolve); return timers; },
  ) as () => Promise<void>;
  const catalog = { functions: [], types: [], catalogTypes: [] };
  const imports = {
    isReaderExtensionMethod,
    globalThis: scope,
    performance: { timeOrigin: 0, now: () => clock },
    // Initial worker paint/cancel turn remains separate from discovery slices.
    setTimeout: (resolve: () => void) => {
      if (discovering) { timers++; void hostYield().then(resolve); }
      else void Promise.resolve().then(resolve);
      return 1;
    },
    yieldToInput: yieldLeaf,
    discoverDataSuggestions: async (_session: unknown, input: { revision: string }, request: { maxOperations: number },
      lifetime: { signal: AbortSignal; yieldControl: () => Promise<void> }) => {
      discovering = true;
      const currentRows: number[] = [];
      signals.push(lifetime.signal); checkedInputs.push(structuredClone({ input, request }));
      try {
        await lifetime.yieldControl();
        lifetime.signal.throwIfAborted();
        for (let index = 0; index < request.maxOperations; index++) {
          lifetime.signal.throwIfAborted();
          await lifetime.yieldControl();
          lifetime.signal.throwIfAborted();
          rows.push(index); currentRows.push(index); clock += 0.25;
        }
        await lifetime.yieldControl(); lifetime.signal.throwIfAborted();
        return { revision: input.revision, suggestions: currentRows.map(index => ({ identity: `recipe:${index}`, index })),
          coverage: { operationsChecked: request.maxOperations, operationsAvailable: 2048, truncated: true } };
      } finally {
        discovering = false;
      }
    },
  };
  // For the old source variant, pause supplies its per-plan timer turn. The
  // first run() pause is unchanged; only discovery calls are compared below.
  const code = options.before ? beforeCode : afterCode;
  const worker = new Function(...Object.keys(imports), `${code};
    base = { registry: {}, evaluateContext: {} };
    return { run, active, discoveryAborts, cancelled };`)(...Object.values(imports)) as {
      run(request: Request): Promise<void>; active: Set<number>; discoveryAborts: Map<number, AbortController>; cancelled: Set<number>;
    };
  return { ...worker, rows, checkedInputs, signals, replies, cancellationEvents,
    handledCancellationAt: () => handledCancellationAt,
    hostYields: () => hostYields, timers: () => timers,
    runDiscovery: async (id: number, maxOperations: number) => {
      selectedId = id;
      await worker.run({ id, method: "discover-data-suggestions", contextId: 0, input: { revision: `source:${id}` }, options: { maxOperations } });
    } };
}

describe("bounded host scheduling of current-reader discovery", () => {
  test("retains every recipe's order and the exact expanded budget/result", async () => {
    for (const budget of [128, 512, 1024]) {
      const before = harness({ before: true }), after = harness({ scheduler: true });
      await before.runDiscovery(1, budget); await after.runDiscovery(1, budget);
      expect(after.checkedInputs).toEqual(before.checkedInputs);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows).toHaveLength(budget);
      expect(after.replies).toEqual(before.replies);
      expect(before.hostYields()).toBeGreaterThan(after.hostYields() * 8);
      expect(after.hostYields()).toBeLessThan(budget / 8);
      expect(after.timers()).toBe(0);
      expect(after.active.size).toBe(0);
      expect(after.discoveryAborts.size).toBe(0);
    }
  });

  for (const scheduler of [true, false]) test(`a real Cancel message stops checks with ${scheduler ? "scheduler yield" : "timer fallback"}`, async () => {
      const after = harness({ scheduler, cancelAtYield: true, realTimers: true });
      await after.runDiscovery(1, 512);
      expect(after.cancellationEvents).toEqual(["yield-requested", "microtask-before-message", "cancel-handled"]);
      expect(after.rows.length).toBeGreaterThan(0);
      expect(after.rows.length).toBeLessThan(512);
      expect(after.handledCancellationAt()).toBe(after.rows.length);
      expect(after.signals[0]!.aborted).toBe(true);
      expect(after.replies).toEqual([]);
      expect(after.active.size).toBe(0);
      expect(after.discoveryAborts.size).toBe(0);
      expect(after.cancelled.size).toBe(0);
      const previous = after.rows.length;
      await after.runDiscovery(2, 128);
      expect(after.rows.length - previous).toBe(128);
      expect(after.replies).toHaveLength(1);
      expect(after.replies[0]!.id).toBe(2);
      expect(after.replies[0]!.ok).toBe(true);
      expect(after.signals[1]!.aborted).toBe(false);
      expect(after.replies[0]!.result).toMatchObject({ revision: "source:2", suggestions: Array.from({ length: 128 }, (_, index) => ({ identity: `recipe:${index}`, index })) });
    });

  test("the existing host-yield leaf retains its timer fallback", async () => {
    const after = harness();
    await after.runDiscovery(1, 128);
    expect(after.hostYields()).toBeGreaterThan(0);
    expect(after.timers()).toBe(after.hostYields());
    expect(after.replies[0]!.ok).toBe(true);
  });

  test("records elapsed timer scheduling on the same controlled discovery workload", async () => {
    const before = harness({ before: true, realTimers: true }), after = harness({ realTimers: true });
    const started = performance.now();
    await before.runDiscovery(1, 256);
    const beforeMs = performance.now() - started;
    const next = performance.now();
    await after.runDiscovery(1, 256);
    const afterMs = performance.now() - next;
    expect(after.rows).toEqual(before.rows);
    expect(after.replies).toEqual(before.replies);
    expect(before.hostYields()).toBeGreaterThan(after.hostYields() * 8);
    console.info(JSON.stringify({ scope: "Controlled discovery checks; host timer scheduling only, not source inference/cold performance",
      plans: 256, beforeTurns: before.hostYields(), afterTurns: after.hostYields(), beforeMs, afterMs }));
  });
});
