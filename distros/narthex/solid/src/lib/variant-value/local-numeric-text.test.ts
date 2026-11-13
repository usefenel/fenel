import { describe, expect, test } from "bun:test";
// The client Solid graph (bun resolves "solid-js" to its server build).
// @ts-expect-error untyped dist entry
import { createMemo, createRoot, createSignal, createStore, flush, isPending, refresh, onSettled, NotReadyError } from "../../../node_modules/solid-js/dist/solid.dev.js";

// B3 fix 3: a Local numeric value inside a structural read (a record holding
// Rational 1/2) shows the worker's numeric text, not its raw fields.
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(asyncSource.slice(asyncSource.indexOf("const LOADING:"))).replace(/^export /gm, "")};return createAsyncValue;`)(
  createMemo, createSignal, isPending, refresh);
const source = (await Bun.file(new URL("./VariantValueRenderer.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  // B3: a Local reader reflects values and encodes numeric text");
const end = source.indexOf("  return (", start);
if (start < 0 || end < start) throw new Error("VariantValueRenderer numeric boundary moved");
const block = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const workerSource = await Bun.file(new URL("../expression-runner/authoring-catalog-worker.ts", import.meta.url)).text();
const sessionCode = workerSource.slice(workerSource.indexOf("export function localReadSession("), workerSource.indexOf("/** Bind only a scope"));
const localReadSession = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(sessionCode).replace(/^export /gm, "")}; return localReadSession;`)();
// B4 F1: the Local variant routes by snapshot owner; a snapshot owner and its
// registry are 1:1, so a fixture session's owner is its registry.
const localReaderReadSession = new Function("preparedSnapshotOwnerOf", "registryHasSnapshotOwner",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(sessionCode).replace(/^export /gm, "")}; return localReaderReadSession;`)(
  (session: { registry: unknown }) => session.registry, () => false);
const registrySource = await Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts", import.meta.url)).text();
const transportCode = registrySource.slice(registrySource.indexOf("export function registryTransportSnapshot<"), registrySource.indexOf("/** An injective text encoding of a transport value,"));
const registryTransportSnapshot = new Function(`${new Bun.Transpiler({ loader: "ts" }).transformSync(transportCode).replace(/^export /gm, "")}; return registryTransportSnapshot;`)();
const settle = async () => { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); } };

function harness(type: unknown, packetType?: unknown, options: { draft?: boolean; module?: boolean; value?: unknown; fail?: boolean;
  depth?: number; compact?: boolean; root?: unknown } = {}) {
  const requests: Array<{ method: string; codec: unknown; value: unknown; inputs?: unknown[] }> = [];
  const workers: unknown[] = [];
  let fail = !!options.fail;
  const registry = {}, base = { registry, mode: "detached" }, draft = {
    registry, mode: options.module ? "module" : "detached" };
  const baseWorker = { base: true }, draftWorker = { draft: true };
  let replace!: (value: unknown) => void;
  let edit!: (value: number) => void;
  let api!: { numericText: () => string | undefined; localNumericPending: () => boolean;
    localNumeric: { error: unknown; refetch: () => Promise<void> } };
  const dispose = createRoot((dispose: () => void) => {
    const [record, setRecord] = createStore({ num: 1, den: 2 });
    const [value, setValue] = createSignal(Object.hasOwn(options, "value") ? options.value : record);
    replace = next => setValue(() => next);
    edit = next => setRecord((value: { num: number }) => { value.num = next; });
    const reader = { kind: "local", session: () => base, registry: () => registry,
      readerWorker: () => { throw new Error("committed worker bypass"); },
      valueState: () => { throw new Error("committed reflection bypass"); } };
    const scope = {
      createMemo, createAsyncValue, onSettled, NotReadyError, registryTransportSnapshot,
      reader, authoring: options.draft || options.module ? draft : base, type: () => type,
      depth: () => options.depth ?? 0, binary: () => value() instanceof Uint8Array || value() instanceof ArrayBuffer,
      localReadSession, localReaderReadSession, preparedReaderWorkerForSession: (session: unknown) => session === draft ? draftWorker : baseWorker,
      props: { get value() { return value(); }, compact: options.compact, resolveType: () => undefined },
      nativeValueTypeName: (candidate: { $ref?: string }) => ["Rational", "Number"].includes(candidate?.$ref ?? "") ? candidate.$ref : undefined,
      resolveValueType: (candidate: unknown) => candidate,
      fieldNumericTextCodecPlan: (name: string) => ["Rational", "Number"].includes(name) ? { decode: 1, encode: 1 } : undefined,
      typeConstructorOf: () => { throw new Error("page reflection for Local data"); },
      numericTextCodec: () => { throw new Error("page codec for Local data"); },
      runPreparedReaderWorker: async (worker: unknown, payload: { method: string; codec: unknown; value: unknown }) => {
        requests.push(payload); workers.push(worker);
        if (fail) throw new Error("held worker failure");
        if (payload.method === "project-reader-values") return { valueReads: [{ root: Object.hasOwn(options, "root") ? options.root : { valueType: packetType } }] };
        const value = payload.value;
        return { encoded: { ok: true, value: typeof value === "number" ? Object.is(value, -0) ? "-0" : String(value)
          : `${(value as { num: number }).num}/2` } };
      },
    };
    api = new Function(...Object.keys(scope), `${block}; return { numericText, localNumericPending, localNumeric };`)(...Object.values(scope));
    return dispose;
  });
  return { api, requests, workers, baseWorker, draftWorker, dispose, replace, edit, succeed: () => { fail = false; } };
}

describe("B3 Local numeric text", () => {
  test("a declared Rational is encoded by the worker", async () => {
    const h = harness({ $ref: "Rational" });
    try {
      expect(h.api.localNumericPending()).toBe(true);
      expect(h.api.numericText()).toBeUndefined();
      await settle();
      expect(h.api.numericText()).toBe("1/2");
      expect(h.api.localNumericPending()).toBe(false);
      expect(h.requests).toEqual([{ method: "encode-reader-numeric-text", codec: { typeName: "Rational" }, value: { num: 1, den: 2 } }]);
    } finally { h.dispose(); }
  });

  for (const type of [{ $var: "a" }, { $void: true }, { $complement: { $void: true } }]) {
    test(`a generic ${JSON.stringify(type)} slot reflects and encodes in its draft worker`, async () => {
      const h = harness(type, { $ref: "Rational" }, { draft: true });
      try {
        await settle(); expect(h.api.numericText()).toBe("1/2");
        expect(h.requests.map(request => request.method)).toEqual(["project-reader-values", "encode-reader-numeric-text"]);
        expect(h.workers).toEqual([h.draftWorker, h.draftWorker]);
      } finally { h.dispose(); }
    });
  }

  test("deep numeric edits capture a fresh value and do not repaint the prior text", async () => {
    const h = harness({ $ref: "Rational" });
    try {
      await settle(); expect(h.api.numericText()).toBe("1/2");
      h.edit(3); flush(); expect(h.api.numericText()).toBeUndefined();
      await settle(); expect(h.api.numericText()).toBe("3/2");
      expect(h.requests[0].value).toEqual({ num: 1, den: 2 });
      expect(h.requests[1].value).toEqual({ num: 3, den: 2 });
    } finally { h.dispose(); }
  });

  test("a prepared function module keeps its scoped codec", async () => {
    const h = harness({ $void: true }, { $ref: "Rational" }, { module: true });
    try {
      await settle(); expect(h.api.numericText()).toBe("1/2");
      expect(h.workers).toEqual([h.draftWorker, h.draftWorker]);
    } finally { h.dispose(); }
  });

  test("signed zero and NaN settle without losing their source text", async () => {
    const h = harness({ $ref: "Number" }, undefined, { value: -0 });
    try {
      await settle(); expect(h.api.numericText()).toBe("-0");
      h.replace(NaN); await settle(); expect(h.api.numericText()).toBe("NaN");
      expect(h.api.localNumericPending()).toBe(false);
    } finally { h.dispose(); }
  });

  test("failed numeric requests recover through the same current draft", async () => {
    const h = harness({ $void: true }, { $ref: "Rational" }, { draft: true, fail: true });
    try {
      await settle(); expect(h.api.localNumeric.error).toBeInstanceOf(Error);
      expect(h.api.numericText()).toBeUndefined(); expect(h.api.localNumericPending()).toBe(false);
      h.succeed(); const retry = h.api.localNumeric.refetch(); await settle(); await retry;
      expect(h.api.numericText()).toBe("1/2");
      expect(h.workers.every(worker => worker === h.draftWorker)).toBe(true);
    } finally { h.dispose(); }
  });

  for (const options of [{ depth: 16 }, { depth: 2, compact: true }, { value: new Uint8Array([1, 2]) }]) {
    test(`invisible or binary numeric slots do not request worker projections ${JSON.stringify(options)}`, async () => {
      const h = harness({ $void: true }, { $ref: "Rational" }, options);
      try {
        await settle(); expect(h.requests).toEqual([]);
        expect(h.api.localNumericPending()).toBe(false);
      } finally { h.dispose(); }
    });
  }

  for (const root of [true, [], null, { valueType: 42 }]) {
    test(`malformed reflection root ${JSON.stringify(root)} refuses instead of displaying raw structure`, async () => {
      const h = harness({ $void: true }, undefined, { root });
      try {
        await settle(); expect(h.api.localNumeric.error).toBeInstanceOf(Error);
        expect(h.requests).toHaveLength(1); expect(h.api.numericText()).toBeUndefined();
      } finally { h.dispose(); }
    });
  }
});
