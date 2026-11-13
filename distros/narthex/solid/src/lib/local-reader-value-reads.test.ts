import { describe, expect, test } from "bun:test";
import { createLocalReaderPresentation } from "./local-reader-presentation";
import type { PreparedReaderWorker } from "./expression-runner/authoring-catalog-worker";
import type { AuthoringWorkerPayload, AuthoringWorkerResult } from "./expression-runner/authoring-worker-protocol";
import type { SourceReaderValueReadInput, SourceReaderValueReadPacket } from "./reader-presentation";

// Keyed display reads of the Local presentation cache (2026-11-11): the real
// cache and its real transport key; the worker is a controlled `run` that
// records every message and answers when the test says so.
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Call = { handle: PreparedReaderWorker; payload: Extract<AuthoringWorkerPayload, { method: "project-reader-values" }>;
  signal?: AbortSignal; answer: () => void; refuse: (error: Error) => void };

function harness(options: { hold?: boolean; refuse?: (value: unknown) => boolean } = {}) {
  let handle = Object.freeze({}) as PreparedReaderWorker;
  let roster = { views: [{ name: "first-view" }], componentNames: ["first"] };
  const calls: Call[] = [];
  const packet = (input: SourceReaderValueReadInput) => ({ root: { glyph: {}, observed: input.value }, children: [] }) as unknown as SourceReaderValueReadPacket;
  const cache = createLocalReaderPresentation({
    worker: () => handle, catalog: () => [], knownIcons: () => ["hash"],
    views: () => roster as never,
    run: (target, payload, signal) => new Promise<AuthoringWorkerResult>((resolve, reject) => {
      if (payload.method !== "project-reader-values") { reject(new Error("Unexpected request")); return; }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      const answer = () => {
        if (payload.inputs.some(input => options.refuse?.(input.value))) reject(new Error("The worker refused this value."));
        else resolve({ valueReads: payload.inputs.map(packet) } as AuthoringWorkerResult);
      };
      calls.push({ handle: target, payload, signal, answer, refuse: error => reject(error) });
      if (!options.hold) answer();
    }),
  });
  const wire = (value: unknown, extra: Partial<SourceReaderValueReadInput> = {}): SourceReaderValueReadInput =>
    ({ value, typeLookup: "session", views: roster.views as never, componentNames: roster.componentNames, ...extra });
  return { cache, calls, wire, handle: () => handle,
    replace: () => { handle = Object.freeze({}) as PreparedReaderWorker; return handle; },
    setRoster: (next: typeof roster) => { roster = next; } };
}
const values = (call: Call) => call.payload.inputs.map(input => input.value);
const observed = (reply: { valueReads: SourceReaderValueReadPacket[] }) => (reply.valueReads[0]!.root as unknown as { observed: unknown }).observed;

describe("keyed display reads: one request per worker incarnation, roster and value", () => {
  test("two consumers of the same value share one request and one packet", async () => {
    const h = harness({ hold: true });
    const first = h.cache.readValue(h.handle(), h.wire({ name: "Ada", tags: ["x"] }))!;
    const second = h.cache.readValue(h.handle(), h.wire({ name: "Ada", tags: ["x"] }))!;
    await tick();
    expect(h.calls).toHaveLength(1);
    expect(values(h.calls[0]!)).toEqual([{ name: "Ada", tags: ["x"] }]);
    h.calls[0]!.answer();
    const [a, b] = await Promise.all([first, second]);
    expect(a.valueReads).toHaveLength(1);
    expect(a.valueReads[0]).toBe(b.valueReads[0]);
  });

  test("an answered value is not asked again: a publication or a remount that changes nothing sends nothing", async () => {
    const h = harness();
    const reply = await h.cache.readValue(h.handle(), h.wire({ amount: 12 }))!;
    expect(h.calls).toHaveLength(1);
    // The surface captures its value again (a new object each time) and asks.
    for (let publication = 0; publication < 5; publication++) {
      const again = await h.cache.readValue(h.handle(), h.wire({ amount: 12 }), new AbortController().signal)!;
      expect(again.valueReads[0]).toBe(reply.valueReads[0]);
    }
    await tick();
    expect(h.calls).toHaveLength(1);
  });

  test("a changed value, type or flag is another key; equal content in another object is the same key", async () => {
    const h = harness();
    const ask = async (input: SourceReaderValueReadInput) => observed(await h.cache.readValue(h.handle(), input)!);
    await ask(h.wire({ a: 1, b: 2 }));
    await ask(h.wire({ a: 1, b: 2 }));                              // same content: no request
    expect(h.calls).toHaveLength(1);
    await ask(h.wire({ a: 1, b: 3 }));                              // an actual change of the value
    await ask(h.wire({ b: 2, a: 1 }));                              // key order is observable
    await ask(h.wire({ a: 1, b: 2 }, { compact: true }));
    await ask(h.wire({ a: 1, b: 2 }, { thumbnail: true }));
    await ask(h.wire({ a: 1, b: 2 }, { type: { $ref: "Pair" } as never }));
    await ask(h.wire({ a: 1, b: 2 }, { typeLookup: "registry" }));
    expect(await ask(h.wire(0))).toBe(0);
    expect(Object.is(await ask(h.wire(-0)), -0)).toBe(true);
    expect(await ask(h.wire(new Date(5)))).toEqual(new Date(5));
    await ask(h.wire(new Date(6)));
    expect(h.calls).toHaveLength(11);
  });

  test("a render pass travels in ordered messages of sixteen values that share one roster", async () => {
    const h = harness();
    const replies = await Promise.all(Array.from({ length: 40 }, (_, index) => h.cache.readValue(h.handle(), h.wire(`value ${index}`))!));
    expect(h.calls.map(call => call.payload.inputs.length)).toEqual([16, 16, 8]);
    expect(h.calls.flatMap(values)).toEqual(Array.from({ length: 40 }, (_, index) => `value ${index}`));
    expect(replies.map(observed)).toEqual(Array.from({ length: 40 }, (_, index) => `value ${index}`));
    const inputs = h.calls.flatMap(call => call.payload.inputs);
    expect(inputs.every(input => input.views === inputs[0]!.views && input.componentNames === inputs[0]!.componentNames)).toBe(true);
    expect(h.calls[0]!.payload.knownIcons).toEqual(["hash"]);
  });
});

describe("keyed display reads: consumers and cancellation", () => {
  test("one consumer leaving keeps the shared request; the last one leaving cancels it", async () => {
    const h = harness({ hold: true });
    const a = new AbortController(), b = new AbortController();
    const first = h.cache.readValue(h.handle(), h.wire("shared"), a.signal)!;
    const second = h.cache.readValue(h.handle(), h.wire("shared"), b.signal)!;
    await tick();
    expect(h.calls).toHaveLength(1);
    a.abort(new Error("first surface closed"));
    await expect(first).rejects.toThrow("first surface closed");
    await tick();
    expect(h.calls[0]!.signal!.aborted).toBe(false);
    b.abort(new Error("second surface closed"));
    await expect(second).rejects.toThrow("second surface closed");
    await tick();
    expect(h.calls[0]!.signal!.aborted).toBe(true);
    // A later consumer starts a fresh request.
    const third = h.cache.readValue(h.handle(), h.wire("shared"))!;
    await tick();
    expect(h.calls).toHaveLength(2);
    h.calls[1]!.answer();
    expect(observed(await third)).toBe("shared");
  });

  test("a surface that drops its request and asks the same value in the same turn keeps the request in flight", async () => {
    const h = harness({ hold: true });
    let controller = new AbortController();
    let pending = h.cache.readValue(h.handle(), h.wire({ card: 1 }), controller.signal)!;
    pending.catch(() => undefined);
    await tick();
    // Five publications arrive while the worker is busy: each re-captures the
    // same value, aborts its own request and asks again.
    for (let publication = 0; publication < 5; publication++) {
      controller.abort(new Error("superseded"));
      controller = new AbortController();
      pending = h.cache.readValue(h.handle(), h.wire({ card: 1 }), controller.signal)!;
      pending.catch(() => undefined);
      await tick();
    }
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.signal!.aborted).toBe(false);
    h.calls[0]!.answer();
    expect(observed(await pending)).toEqual({ card: 1 });
  });

  test("a message is cancelled only when none of its values has a consumer; unsent values are dropped", async () => {
    const h = harness({ hold: true });
    const a = new AbortController(), b = new AbortController();
    const first = h.cache.readValue(h.handle(), h.wire("kept"), a.signal)!;
    const second = h.cache.readValue(h.handle(), h.wire("left"), b.signal)!;
    second.catch(() => undefined);
    await tick();
    expect(h.calls).toHaveLength(1);
    b.abort();
    await tick();
    expect(h.calls[0]!.signal!.aborted).toBe(false);
    h.calls[0]!.answer();
    expect(observed(await first)).toBe("kept");
    // The value nobody waited for was answered by the same message: it is kept.
    expect(observed(await h.cache.readValue(h.handle(), h.wire("left"))!)).toBe("left");
    expect(h.calls).toHaveLength(1);
    // A value dropped before its message is sent is never sent.
    const c = new AbortController();
    const unsent = h.cache.readValue(h.handle(), h.wire("unsent"), c.signal)!;
    unsent.catch(() => undefined);
    c.abort();
    await tick();
    expect(h.calls).toHaveLength(1);
  });

  test("an already aborted signal rejects without a request", async () => {
    const h = harness();
    const controller = new AbortController(); controller.abort(new Error("closed"));
    await expect(h.cache.readValue(h.handle(), h.wire("late"), controller.signal)!).rejects.toThrow("closed");
    await tick();
    expect(h.calls).toHaveLength(0);
  });
});

describe("keyed display reads: what is asked again", () => {
  test("a restored or rebuilt worker is a new incarnation: its values are asked again and the old ones refuse", async () => {
    const h = harness({ hold: true });
    const before = h.handle();
    const settled = h.cache.readValue(before, h.wire("settled"))!;
    await tick(); h.calls[0]!.answer(); await settled;
    const inFlight = h.cache.readValue(before, h.wire("in flight"))!;
    inFlight.catch(() => undefined);
    await tick();
    expect(h.calls).toHaveLength(2);
    const after = h.replace();
    // The retired handle is no longer this cache's worker: not served.
    expect(h.cache.readValue(before, h.wire("settled"))).toBeUndefined();
    const again = h.cache.readValue(after, h.wire("settled"))!;
    await expect(inFlight).rejects.toThrow("snapshot was replaced");
    expect(h.calls[1]!.signal!.aborted).toBe(true);
    await tick();
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]!.handle).toBe(after);
    h.calls[2]!.answer();
    expect(observed(await again)).toBe("settled");
  });

  test("a changed template roster is another key", async () => {
    const h = harness();
    await h.cache.readValue(h.handle(), h.wire("card"))!;
    h.setRoster({ views: [{ name: "first-view" }], componentNames: ["first", "suggestion-card"] });
    await h.cache.readValue(h.handle(), h.wire("card"))!;
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.payload.inputs[0]!.componentNames).toEqual(["first", "suggestion-card"]);
    await h.cache.readValue(h.handle(), h.wire("card"))!;
    expect(h.calls).toHaveLength(2);
  });

  test("a refused value fails alone, is not retained, and its neighbours are answered", async () => {
    const h = harness({ refuse: value => value === "bad" });
    const [good, bad, other] = [h.cache.readValue(h.handle(), h.wire("good"))!, h.cache.readValue(h.handle(), h.wire("bad"))!,
      h.cache.readValue(h.handle(), h.wire("other"))!];
    bad.catch(() => undefined);
    expect(observed(await good)).toBe("good");
    expect(observed(await other)).toBe("other");
    await expect(bad).rejects.toThrow("The worker refused this value.");
    // One message of three, then each value alone.
    expect(h.calls.map(values)).toEqual([["good", "bad", "other"], ["good"], ["bad"], ["other"]]);
    await expect(h.cache.readValue(h.handle(), h.wire("bad"))!).rejects.toThrow("The worker refused this value.");
    expect(h.calls).toHaveLength(5);
    await h.cache.readValue(h.handle(), h.wire("good"))!;
    expect(h.calls).toHaveLength(5);
  });

  test("Retry forgets the answered packets of the current incarnation", async () => {
    const h = harness();
    await h.cache.readValue(h.handle(), h.wire("card"))!;
    h.cache.retry();
    await h.cache.readValue(h.handle(), h.wire("card"))!;
    expect(h.calls).toHaveLength(2);
  });
});

describe("keyed display reads: what this cache does not serve", () => {
  test("another worker context, a missing roster and a value too large or not plain enough to key", async () => {
    const h = harness();
    expect(h.cache.readValue(Object.freeze({}) as PreparedReaderWorker, h.wire("scoped draft"))).toBeUndefined();
    expect(h.cache.readValue(h.handle(), h.wire(new Uint8Array(200_000)))).toBeUndefined();
    expect(h.cache.readValue(h.handle(), h.wire("x".repeat(300_000)))).toBeUndefined();
    expect(h.cache.readValue(h.handle(), h.wire({ host: () => true }))).toBeUndefined();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(h.cache.readValue(h.handle(), h.wire(cyclic))).toBeUndefined();
    await tick();
    expect(h.calls).toHaveLength(0);
    // A small binary value is keyed by its bytes.
    await h.cache.readValue(h.handle(), h.wire(new Uint8Array([1, 2, 3])))!;
    await h.cache.readValue(h.handle(), h.wire(new Uint8Array([1, 2, 3])))!;
    await h.cache.readValue(h.handle(), h.wire(new Uint8Array([1, 2, 4])))!;
    expect(h.calls).toHaveLength(2);
    const unready = createLocalReaderPresentation({ worker: () => h.handle(), catalog: () => [], knownIcons: () => [],
      run: async () => { throw new Error("Unexpected request"); }, views: () => undefined });
    expect(unready.readValue(h.handle(), h.wire("card"))).toBeUndefined();
  });
});
