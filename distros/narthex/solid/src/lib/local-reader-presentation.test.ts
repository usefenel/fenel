import { describe, expect, test } from "bun:test";
import { createLocalReaderPresentation } from "./local-reader-presentation";
import type { PreparedReaderWorker } from "./expression-runner/authoring-catalog-worker";
import type { AuthoringWorkerPayload, AuthoringWorkerResult } from "./expression-runner/authoring-worker-protocol";
import type { FenelType } from "@fenel/engine/types";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function harness(answer: (payload: AuthoringWorkerPayload, handle: PreparedReaderWorker) => AuthoringWorkerResult | Promise<AuthoringWorkerResult>) {
  let handle = Object.freeze({}) as PreparedReaderWorker;
  const calls: Array<{ handle: PreparedReaderWorker; payload: AuthoringWorkerPayload }> = [];
  const cache = createLocalReaderPresentation({
    worker: () => handle,
    catalog: () => [{ id: "fns", name: "Functions", entries: [{ id: "demo:double", name: "double", description: "", category: "function", fn: { id: "demo:double" } }] }] as never,
    run: async (target, payload, signal) => {
      calls.push({ handle: target, payload });
      const result = await answer(payload, target);
      signal?.throwIfAborted();
      return result;
    },
    knownIcons: () => ["hash"],
    views: () => ({ views: [], componentNames: [] }),
  });
  return { cache, calls, replace: () => { handle = Object.freeze({}) as PreparedReaderWorker; } };
}

const metadata = (payload: AuthoringWorkerPayload) => payload.method === "project-reader-metadata"
  ? { entries: payload.targets.map(target => ({ target, representations: [{ typeName: "Labelable", methods: { label: `L-${target}` } }],
    ownPresentation: { label: `Label ${target}` } })) } as AuthoringWorkerResult
  : payload.method === "project-reader-references"
    ? { references: payload.targets.map(target => ({ target, ...(target === "uuid-1" ? { reference: { fn: { id: "demo:double" }, handle: "uuid-1" } } : {}) })) } as AuthoringWorkerResult
    : payload.method === "project-reader-values"
      ? { valueReads: payload.inputs.map(input => ({ root: { glyph: {}, value: input.value }, children: [] })) } as unknown as AuthoringWorkerResult
    : { typePresentations: (payload as unknown as { types: unknown[] }).types.map(type => ({ type, label: "Shape", icon: "hash" })) } as AuthoringWorkerResult;

describe("B3 Local presentation cache", () => {
  test("retired picture plans cannot initiate reads in a replacement worker", async () => {
    let retired = false;
    let release!: () => void;
    const h = harness(async payload => {
      if (payload.method !== "project-reader-metadata") return metadata(payload);
      if (retired) await new Promise<void>(resolve => { release = resolve; });
      return { entries: payload.targets.map(target => ({ target,
        representations: [{ typeName: "Picturable", methods: { picture: { $ref: "picture-owner" } } }],
        ownPresentation: { label: "Honey", emoji: "🍯", picture: { $tag: "GlyphPictureReference", handle: "picture-owner" } },
      })) } as AuthoringWorkerResult;
    });
    expect(h.cache.presentation("Honey")).toBeUndefined();
    await tick(); await tick();
    expect(h.cache.presentation("Honey")?.picture).toEqual({ $tag: "GlyphPictureReference", handle: "picture-owner" });
    retired = true; h.replace();
    expect(h.cache.presentation("Honey")).toMatchObject({ label: "Honey", emoji: "🍯", picture: undefined });
    expect(h.cache.representation("Picturable", "Honey")).toBeUndefined();
    await tick();
    release(); await tick(); await tick();
    expect(h.cache.presentation("Honey")?.picture).toEqual({ $tag: "GlyphPictureReference", handle: "picture-owner" });
  });

  test("type captions keep native scalar literals distinct and reuse equal fresh types", async () => {
    const h = harness(metadata);
    const type = (literal: unknown) => ({ $el: { call: ["Vec", literal] } }) as FenelType;
    const literals = [NaN, null, undefined, Infinity, -Infinity, -0, 0];
    for (const literal of literals) expect(h.cache.typeState(type(literal)).kind).toBe("pending");
    await tick(); await tick();
    const requests = h.calls.filter(call => call.payload.method === "project-reader-type-presentations");
    expect(requests).toHaveLength(1);
    const request = requests[0]!.payload;
    if (request.method !== "project-reader-type-presentations") throw new Error("expected a type-caption request");
    expect(request.types).toHaveLength(literals.length);
    for (const literal of literals) {
      const result = h.cache.typeState(type(literal));
      expect(result.kind).toBe("known");
      if (result.kind !== "known") throw new Error("expected a type caption");
      expect(Object.is((result.value.type as { $el: { call: unknown[] } }).$el.call[1], literal)).toBe(true);
    }
    await tick();
    expect(h.calls).toHaveLength(1);
  });

  test("type capture keeps queued bytes stable and rekeys later in-place mutations", async () => {
    const h = harness(metadata);
    const bytes = Uint8Array.of(1, 2);
    const type = { $refined: { base: { $ref: "Bytes" }, set: { $tag: "SeEnum", values: [bytes] } } } as FenelType;
    expect(h.cache.typeState(type).kind).toBe("pending");
    bytes[0] = 9;
    await tick(); await tick();
    const first = h.calls[0]!.payload;
    if (first.method !== "project-reader-type-presentations") throw new Error("expected a type-caption request");
    const capturedType = first.types[0]!;
    if (!("$refined" in capturedType) || capturedType.$refined.set.$tag !== "SeEnum") throw new Error("expected a finite refinement");
    const capturedBytes = capturedType.$refined.set.values[0];
    if (!(capturedBytes instanceof Uint8Array)) throw new Error("expected captured Bytes");
    expect([...capturedBytes]).toEqual([1, 2]);
    expect(h.cache.typeState(type).kind).toBe("pending");
    await tick(); await tick();
    expect(h.cache.typeState(type).kind).toBe("known");
    expect(h.calls).toHaveLength(2);
    const fresh = { $refined: { base: { $ref: "Bytes" }, set: { $tag: "SeEnum", values: [Uint8Array.of(9, 2)] } } } as FenelType;
    expect(h.cache.typeState(fresh).kind).toBe("known");
    await tick();
    expect(h.calls).toHaveLength(2);
  });

  test("typed value packets distinguish native carriers and preserve their captured snapshot", async () => {
    const h = harness(payload => payload.method === "project-reader-values"
      ? { valueReads: payload.inputs.map(input => ({ root: { glyph: {}, valueType: input.type }, children: [] })) } as never
      : metadata(payload));
    const type = (literal: unknown) => ({ $refined: { base: { $ref: "Any" }, set: { $tag: "SeEnum", values: [literal] } } }) as FenelType;
    const buffer = Uint8Array.of(7, 8).buffer;
    const literals = [NaN, null, -0, 0, new Date(0), new Date(NaN), "1970-01-01T00:00:00.000Z",
      buffer, Uint8Array.of(7, 8), new Uint16Array(buffer), new DataView(buffer), { 0: 7, 1: 8 }];
    for (const literal of literals) expect(h.cache.valueState("same value", type(literal)).kind).toBe("pending");
    await tick(); await tick();
    expect(h.calls).toHaveLength(1);
    const request = h.calls[0]!.payload;
    if (request.method !== "project-reader-values") throw new Error("expected a value-read request");
    expect(request.inputs).toHaveLength(literals.length);
    for (const literal of literals) expect(h.cache.valueState("same value", type(literal)).kind).toBe("known");
    new Uint8Array(buffer)[0] = 3;
    expect(h.cache.valueState("same value", type(buffer)).kind).toBe("pending");
    const capturedType = request.inputs[7]!.type;
    if (!capturedType || !("$refined" in capturedType) || capturedType.$refined.set.$tag !== "SeEnum")
      throw new Error("expected a finite refinement");
    const sent = capturedType.$refined.set.values[0];
    if (!(sent instanceof ArrayBuffer)) throw new Error("expected a captured buffer");
    expect([...new Uint8Array(sent)]).toEqual([7, 8]);
    await tick(); await tick();
    expect(h.cache.valueState("same value", type(buffer)).kind).toBe("known");
  });

  test("recursive types are cacheable, but cyclic or accessor carriers fail without executing getters", async () => {
    const h = harness(metadata);
    const recursive = { $mu: { var: "X", body: { $union: [{ $unit: true }, { $var: "X" }] } } } as FenelType;
    expect(h.cache.typeState(recursive).kind).toBe("pending");
    const cyclic: { $el?: unknown } = {}; cyclic.$el = cyclic;
    let reads = 0;
    const accessor = Object.defineProperty({}, "$ref", { enumerable: true, get() { reads++; return "String"; } });
    for (const malformed of [cyclic, accessor]) {
      expect(h.cache.typeState(malformed as FenelType).kind).toBe("failed");
      expect(h.cache.valueState(1, malformed as FenelType).kind).toBe("failed");
      expect(h.cache.observePending(() => h.cache.typeState(malformed as FenelType))).toMatchObject({ pending: true, failed: true });
    }
    expect(reads).toBe(0);
    await tick(); await tick();
    expect(h.cache.typeState(structuredClone(recursive)).kind).toBe("known");
    expect(h.calls).toHaveLength(1);
  });

  test("T1: reads in one tick are one batched worker request per kind", async () => {
    const { cache, calls } = harness(metadata);
    for (let index = 0; index < 10; index++) cache.presentation(`id-${index}`);
    cache.presentation("id-3");
    await tick(); await tick();
    const meta = calls.filter(call => call.payload.method === "project-reader-metadata");
    expect(meta.length).toBe(1);
    expect((meta[0]!.payload as unknown as { targets: string[] }).targets.length).toBe(10);
    expect(cache.presentation("id-3")?.label).toBe("Label id-3" as never);
    expect(cache.representation("Labelable", "id-4")).toEqual({ label: "L-id-4" });
  });

  test("T2: a pending id reports pending, not a miss, and never a guessed name", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { cache } = harness(async payload => { await gate; return metadata(payload); });
    expect(cache.presentation("x")).toBeUndefined();
    expect(cache.presentationPending("x")).toBe(true);
    expect(cache.observePending(() => cache.catalogLookups.fn("x")).pending).toBe(true);
    release(); await tick(); await tick();
    expect(cache.presentationPending("x")).toBe(false);
    expect(cache.presentation("x")?.label).toBe("Label x" as never);
    expect(cache.observePending(() => cache.catalogLookups.fn("x")).pending).toBe(false);
    expect(cache.catalogLookups.fn("x")).toBeUndefined();
  });

  test("T3: a replaced snapshot re-keys (stale display, refetch) and a failure is reported then retried", async () => {
    let fail = false;
    const h = harness(payload => { if (fail) throw new Error("worker failed"); return metadata(payload); });
    h.cache.presentation("a"); await tick(); await tick();
    expect(h.cache.presentation("a")?.label).toBe("Label a" as never);
    h.cache.catalogLookups.fn("uuid-1"); await tick(); await tick();
    expect(h.cache.catalogLookups.fn("uuid-1")).toEqual({ id: "demo:double" });
    h.replace();
    // B3 fix 2: a retired answer is display only. It is "stale", it keeps the
    // name pending for every decision, and a stale reference is never used.
    expect(h.cache.metadataState("a")).toEqual({ kind: "stale", value: expect.anything() });
    expect(h.cache.presentation("a")?.label).toBe("Label a" as never);
    expect(h.cache.presentationPending("a")).toBe(true);
    expect(h.cache.observePending(() => h.cache.presentation("a")).pending).toBe(true);
    expect(h.cache.catalogLookups.fn("uuid-1")).toBeUndefined();
    expect(h.cache.referencePending("uuid-1")).toBe(true);
    await tick(); await tick();
    expect(h.cache.presentationPending("a")).toBe(false);
    expect(h.cache.catalogLookups.fn("uuid-1")).toEqual({ id: "demo:double" });
    expect(h.calls.filter(call => call.payload.method === "project-reader-metadata").length).toBe(2);
    expect(h.cache.metadataState("a")).toEqual({ kind: "known", value: expect.anything() });
    fail = true;
    h.cache.presentation("b"); await tick(); await tick();
    expect(h.cache.metadataState("b").kind).toBe("failed");
    expect(h.cache.presentationPending("b")).toBe(true);
    fail = false;
    h.cache.retry();
    h.cache.presentation("b"); await tick(); await tick();
    expect(h.cache.presentation("b")?.label).toBe("Label b" as never);
  });

  test("references resolve catalogue entries by UUID; type captions and prefill go through the worker", async () => {
    const { cache, calls } = harness(metadata);
    expect(cache.catalogEntry("demo:double")?.id).toBe("demo:double");
    await cache.prefill(["uuid-1", "t-1"]);
    expect(cache.catalogEntry("uuid-1")?.id).toBe("demo:double");
    expect(cache.catalogLookups.fn("uuid-1")).toEqual({ id: "demo:double" });
    expect(cache.presentationPending("t-1")).toBe(false);
    expect(cache.typePresentation({ $ref: "Shape" })).toBeUndefined();
    expect(cache.typePresentationPending({ $ref: "Shape" })).toBe(true);
    await tick(); await tick();
    expect(cache.typePresentation({ $ref: "Shape" })?.icon).toBe("hash");
    expect(calls.some(call => call.payload.method === "project-reader-type-presentations")).toBe(true);
  });

  test.each([
    ["metadata null", "project-reader-metadata", null],
    ["metadata wrong container", "project-reader-metadata", { entries: {} }],
    ["metadata absent target", "project-reader-metadata", { entries: [] }],
    ["metadata wrong target", "project-reader-metadata", { entries: [{ target: "other", representations: [] }] }],
    ["metadata invalid representations", "project-reader-metadata", { entries: [{ target: "uuid-1", representations: null }] }],
    ["metadata invalid methods", "project-reader-metadata", { entries: [{ target: "uuid-1", representations: [{ typeName: "Labelable", methods: null }] }] }],
    ["references null", "project-reader-references", null],
    ["references wrong container", "project-reader-references", { references: {} }],
    ["references absent target", "project-reader-references", { references: [] }],
    ["references wrong target", "project-reader-references", { references: [{ target: "other" }] }],
    ["references invalid row", "project-reader-references", { references: [null] }],
    ["references invalid value", "project-reader-references", { references: [{ target: "uuid-1", reference: null }] }],
    ["types null", "project-reader-type-presentations", null],
    ["types wrong container", "project-reader-type-presentations", { typePresentations: { length: 1, 0: {} } }],
    ["types wrong length", "project-reader-type-presentations", { typePresentations: [] }],
    ["types sparse array", "project-reader-type-presentations", { typePresentations: new Array(1) }],
    ["types invalid row", "project-reader-type-presentations", { typePresentations: [null] }],
    ["types invalid caption", "project-reader-type-presentations", { typePresentations: [{ type: { $ref: "Shape" }, label: 7 }] }],
    ["values wrong container", "project-reader-values", { valueReads: { length: 1, 0: {} } }],
    ["values sparse array", "project-reader-values", { valueReads: new Array(1) }],
    ["values invalid row", "project-reader-values", { valueReads: [null] }],
  ] as const)("malformed fulfilled %s settles as failed and Retry recovers", async (_name, method, reply) => {
    let malformed = true;
    const { cache, calls } = harness(payload => payload.method === method && malformed
      ? reply as unknown as AuthoringWorkerResult : metadata(payload));
    const read = () => method === "project-reader-metadata" ? cache.metadataState("uuid-1")
      : method === "project-reader-references" ? cache.referenceState("uuid-1")
      : method === "project-reader-type-presentations" ? cache.typeState({ $ref: "Shape" })
      : cache.valueState(7);
    expect(read().kind).toBe("pending");
    await tick(); await tick();
    expect(read().kind).toBe("failed");
    expect(cache.observePending(read)).toMatchObject({ pending: true, failed: true });
    malformed = false;
    cache.retry();
    expect(read().kind).toBe("pending");
    await tick(); await tick();
    expect(read().kind).toBe("known");
    expect(calls.filter(call => call.payload.method === method)).toHaveLength(2);
  });

  test("signed zero values keep distinct packets in either request order", async () => {
    for (const values of [[-0, 0], [0, -0]]) {
      const { cache, calls } = harness(metadata);
      for (const value of values) expect(cache.valueState(value).kind).toBe("pending");
      await tick(); await tick();
      const requests = calls.filter(call => call.payload.method === "project-reader-values");
      expect(requests).toHaveLength(1);
      const payload = requests[0]!.payload;
      if (payload.method !== "project-reader-values") throw new Error("Expected value request");
      expect(payload.inputs).toHaveLength(2);
      expect(Object.is(payload.inputs[0]!.value, values[0])).toBe(true);
      expect(Object.is(payload.inputs[1]!.value, values[1])).toBe(true);
      for (const value of values) {
        const state = cache.valueState(value);
        expect(state.kind).toBe("known");
        if (state.kind !== "known") throw new Error("Expected a settled value packet");
        expect(Object.is((state.value.root as unknown as { value: unknown }).value, value)).toBe(true);
      }
    }
  });

  test("a rejection without an error value is still failed and recoverable", async () => {
    let fail = true;
    const { cache } = harness(payload => fail ? Promise.reject(undefined) : metadata(payload));
    const read = () => [cache.metadataState("uuid-1"), cache.referenceState("uuid-1"), cache.typeState({ $ref: "Shape" })];
    expect(read().map(state => state.kind)).toEqual(["pending", "pending", "pending"]);
    await tick(); await tick();
    expect(read().map(state => state.kind)).toEqual(["failed", "failed", "failed"]);
    fail = false;
    cache.retry();
    read(); await tick(); await tick();
    expect(read().map(state => state.kind)).toEqual(["known", "known", "known"]);
  });

  // Astra re-review: an LRU bound below the number of mounted cards re-requested
  // them in a loop. 600 mounted primitive values stay known with no new request.
  test("many mounted primitive values stay known without re-requests", async () => {
    const { cache, calls } = harness(metadata);
    for (let index = 0; index < 600; index++) cache.valueState(index);
    await tick(); await tick();
    const before = calls.filter(call => call.payload.method === "project-reader-values").length;
    for (let index = 0; index < 600; index++) expect(cache.valueState(index).kind).toBe("known");
    await tick(); await tick();
    expect(calls.filter(call => call.payload.method === "project-reader-values").length).toBe(before);
  });

  // B3 fix 5: a failed answer is reported for Retry, and Retry also forgets
  // failed value packets (they live in a WeakMap keyed by the value).
  test("failures surface for Retry and Retry asks failed value packets again", async () => {
    let fail = true;
    const h = harness(payload => { if (fail) throw new Error("worker failed"); return metadata(payload); });
    const value = { a: 1 };
    h.cache.valueState(value); h.cache.presentation("n");
    await tick(); await tick();
    expect(h.cache.valueState(value).kind).toBe("failed");
    expect(h.cache.observePending(() => h.cache.presentation("n"))).toEqual({ value: undefined, pending: true, failed: true });
    fail = false;
    h.cache.retry();
    expect(h.cache.valueState(value).kind).toBe("pending");
    await tick(); await tick();
    expect(h.cache.valueState(value).kind).toBe("known");
    expect(h.cache.observePending(() => h.cache.presentation("n")).failed).toBe(false);
  });
});
