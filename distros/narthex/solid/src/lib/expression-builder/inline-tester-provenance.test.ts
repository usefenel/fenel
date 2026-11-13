import { describe, expect, test } from "bun:test";
// The client Solid graph (bun resolves "solid-js" to its server build).
// @ts-expect-error untyped dist entry
import { createMemo, createRoot, createSignal, flush, isPending, refresh } from "../../../node_modules/solid-js/dist/solid.dev.js";

const asyncSource = await Bun.file(new URL("../async-value.ts", import.meta.url)).text();
const createAsyncValue = new Function("createMemo", "createSignal", "isPending", "refresh",
  `${new Bun.Transpiler({ loader: "ts" }).transformSync(asyncSource.slice(asyncSource.indexOf("const LOADING:"))).replace(/^export /gm, "")};return createAsyncValue;`)(
  createMemo, createSignal, isPending, refresh);

// B3 fix 4: while a new Local membership check runs, the inline tester shows
// no verdict, never the previous input's definite answer.
const source = (await Bun.file(new URL("./ExpressionDisplay.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const start = source.indexOf("  const localInput = createMemo(");
const end = source.indexOf("  const candidateDecision = createMemo(", start);
if (start < 0 || end < start) throw new Error("Inline tester boundary moved");
const block = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
const Nothing = { $tag: "Nothing" };
const settle = async () => { for (let turn = 0; turn < 6; turn++) { await Promise.resolve(); flush(); } };

describe("B3 inline set tester", () => {
  test("a running check never shows the previous verdict", async () => {
    const replies: Array<(value: unknown) => void> = [];
    let verdict!: () => { $tag: string; _0?: boolean };
    let setCandidate!: (value: unknown) => void;
    const dispose = createRoot((dispose: () => void) => {
      const [candidate, set] = createSignal<unknown>({ z: 1 }, { ownedWrite: true });
      setCandidate = set;
      const scope = {
        createMemo, createAsyncValue, Nothing, contains: () => Nothing, context: () => undefined,
        reader: { kind: "local" }, authoring: {}, cursorPos: () => 0, parsedValue: () => undefined,
        props: { set: { $tag: "SeAll" }, get candidate() { return { value: candidate() }; } },
        preparedReaderWorkerForSession: () => ({}),
        runPreparedReaderWorker: () => new Promise(resolve => replies.push(resolve)),
        useReaderRuntime: () => ({ kind: "local" }), useAuthoringSession: () => ({}),
      };
      verdict = new Function(...Object.keys(scope), `${block}; return candidateVerdict;`)(...Object.values(scope));
      return dispose;
    });
    try {
      verdict(); await settle();
      replies.shift()!({ verdicts: [{ $tag: "Just", _0: true }] }); await settle();
      expect(verdict()).toEqual({ $tag: "Just", _0: true });
      setCandidate({ a: 2 }); await settle();
      // The second check is in flight: no verdict, not the first one's "true".
      expect(verdict()).toEqual(Nothing);
      replies.shift()!({ verdicts: [{ $tag: "Just", _0: false }] }); await settle();
      expect(verdict()).toEqual({ $tag: "Just", _0: false });
    } finally { dispose(); }
  });
});
