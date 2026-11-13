import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, isPending, refresh }
  from "../../../node_modules/solid-js/dist/solid.dev.js";

// B4 F1: SetExprExamples' example field for a Local reader whose page session
// throws on every registry/evaluator read: the base type is resolved in the
// worker (`resolve-reader-type-ref`, the page's own resolveAuthoringTypeRef
// there; parity in expression-runner/reader-function-options-parity.test.ts)
// and no field is offered until that answer. Account resolves on the page.
const source = (await Bun.file(new URL("./SetExprExamples.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  const localBaseType = createAsyncValue(") >= 0
  ? source.indexOf("  const localBaseType = createAsyncValue(") : source.indexOf("  const field = createMemo<FieldDef>(");
const end = source.indexOf("  function runExamples()", start);
if (start < 0 || end < start) throw new Error("SetExprExamples field boundary moved.");
const body = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(asyncSource.slice(asyncSource.indexOf("const LOADING:"))).replace(/^export /gm, "")};return createAsyncValue;`)(
  createMemo, createSignal, isPending, refresh);
const settle = async () => { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); } };

function harness(kind, options = {}) {
  const reads = [], requests = [];
  const session = {};
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    reads.push(key);
    if (kind !== "local") return {};
    throw new Error(`Page session ${key} read for a Local reader`);
  } });
  let dispose, field, setBase;
  createRoot(close => {
    dispose = close;
    const [baseType, setBaseType] = createSignal({ $ref: "Email" });
    setBase = setBaseType;
    const worker = options.noWorker ? undefined : { worker: "one" };
    const run = new Function("createMemo", "createAsyncValue", "session", "reader", "props", "Nothing", "resolveAuthoringTypeRef",
      "localWorker", "runPreparedReaderWorker", `${body}; return field;`);
    field = run(createMemo, createAsyncValue, session, { kind }, { get baseType() { return baseType(); } }, { $tag: "Nothing" },
      (_env, type) => ({ resolved: type }), () => worker,
      (handle, payload) => new Promise(resolve => requests.push({ handle, payload, resolve })));
    createEffect(() => field(), () => {});
  });
  flush();
  return { field: () => field(), reads, requests, setBase, dispose: () => { dispose(); flush(); } };
}

describe("B4 F1: SetExprExamples for a Local reader", () => {
  test("the base type is resolved by the worker; no field is offered until its answer, and no page read", async () => {
    const h = harness("local");
    try {
      await settle();
      expect(h.requests.map(row => row.payload)).toEqual([{ method: "resolve-reader-type-ref", type: { $ref: "Email" } }]);
      expect(h.field()).toBeUndefined();
      h.requests[0].resolve({ typeRef: { resolved: { $refined: { base: { $ref: "String" } } } } }); await settle();
      expect(h.field()?.type).toEqual({ $refined: { base: { $ref: "String" } } });
      expect(h.reads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("an unresolved type keeps the base type; a changed base type is asked again", async () => {
    const h = harness("local");
    try {
      await settle();
      h.requests[0].resolve({ typeRef: {} }); await settle();
      expect(h.field()?.type).toEqual({ $ref: "Email" });
      h.setBase({ $ref: "Number" }); await settle();
      expect(h.field()).toBeUndefined();
      expect(h.requests).toHaveLength(2);
    } finally { h.dispose(); }
  });

  test("a missing worker offers no field and reads nothing on the page", async () => {
    const h = harness("local", { noWorker: true });
    try {
      await settle();
      expect(h.requests).toEqual([]); expect(h.field()).toBeUndefined(); expect(h.reads).toEqual([]);
    } finally { h.dispose(); }
  });

  test("Account still resolves the base type through its session", async () => {
    const h = harness("account");
    try {
      await settle();
      expect(h.field()?.type).toEqual({ resolved: { $ref: "Email" } });
      expect(h.reads).toEqual(["environment"]);
      expect(h.requests).toEqual([]);
    } finally { h.dispose(); }
  });
});
