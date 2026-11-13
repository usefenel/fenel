// Lane D (2026-11-08, items 4b and "Anything"): while a Local reader's
// inference of a graph occurrence has not answered, its data is pending (never
// "Data not available") and its type keeps a reserved place (never the
// "Anything" a missing type label falls back to). These run the actual source
// regions of the expression editor (`index.tsx`, `ExpressionEditor.tsx`) with
// stub guidance; no registry, worker or DOM is loaded.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/expression-runner/graph-pending-inference.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = async (name: string) => (await readFile(new URL(`./${name}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const editor = await read("index.tsx");
const preview = await read("ExpressionEditor.tsx");
function region(source: string, start: string, end: string): string {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  if (first < 0 || last <= first) throw new Error(`The editor source region moved: ${start}`);
  return source.slice(first, last);
}
function runtime<T>(source: string, result: string, bindings: Record<string, unknown>): T {
  const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(`function fixtureRuntime() {\n${source}\nreturn ${result};\n}`);
  return new Function(...Object.keys(bindings), `${compiled}\nreturn fixtureRuntime();`)(...Object.values(bindings));
}

type Pending = { inferencePending: () => boolean; graphTypePending: () => boolean;
  pendingGraphCapture: { pending: () => boolean; pendingLabel: () => string | undefined } };
function occurrence(state: { guidance: boolean; answer?: object; busy: boolean; captureLoading?: boolean; typeLabel?: string;
  node?: object }): Pending {
  const source = region(editor, "  const graphCaptureChecked = () =>", "  /** The existing result judgment");
  return runtime<Pending>(source, "{ inferencePending, graphTypePending, pendingGraphCapture }", {
    guidance: state.guidance ? { busy: () => state.busy } : undefined,
    currentInference: () => state.answer,
    resultGuidance: () => undefined,
    graphTypeLabel: () => state.typeLabel,
    props: { node: state.node ?? { kind: "literal", value: "Bonjour" } },
    PENDING_FUNCTION_ID: "@pending/choose-function",
    graphCaptureContext: { available: () => true, pending: () => !!state.captureLoading,
      pendingLabel: () => state.captureLoading ? "Computing data…" : undefined },
  });
}

describe("a graph occurrence whose Local inference is pending", () => {
  test("reads as pending data with a reserved type place while the reader's request runs", () => {
    const pending = occurrence({ guidance: true, busy: true });
    expect(pending.inferencePending()).toBe(true);
    expect(pending.pendingGraphCapture.pending()).toBe(true);
    expect(pending.pendingGraphCapture.pendingLabel()).toBe("Checking types…");
    expect(pending.graphTypePending()).toBe(true);
  });

  test("an answered inference, a failed request and a non-Local editor are not pending", () => {
    const answered = occurrence({ guidance: true, busy: false, answer: { outcome: { $tag: "Solved" } }, typeLabel: "String" });
    expect(answered.inferencePending()).toBe(false);
    expect(answered.pendingGraphCapture.pending()).toBe(false);
    expect(answered.graphTypePending()).toBe(false);
    // A request that settled without an answer: today's "not available" stays.
    expect(occurrence({ guidance: true, busy: false }).inferencePending()).toBe(false);
    expect(occurrence({ guidance: false, busy: true }).inferencePending()).toBe(false);
  });

  test("the capture's own evaluation keeps its own pending label", () => {
    const capturing = occurrence({ guidance: true, busy: false, answer: { outcome: { $tag: "Solved" } }, captureLoading: true });
    expect(capturing.pendingGraphCapture.pending()).toBe(true);
    expect(capturing.pendingGraphCapture.pendingLabel()).toBe("Computing data…");
  });

  test("a pending insertion's placeholder call keeps its type place reserved, never \"Anything\"", () => {
    const choosing = occurrence({ guidance: true, busy: false, answer: { outcome: { $tag: "Invalid" } },
      node: { kind: "call", fnId: "@pending/choose-function", args: [] } });
    expect(choosing.graphTypePending()).toBe(true);
    // Its data is not computed until a function is chosen: no pending capture.
    expect(choosing.pendingGraphCapture.pending()).toBe(false);
    expect(occurrence({ guidance: true, busy: false, answer: { outcome: { $tag: "Solved" } },
      node: { kind: "call", fnId: "std.upper", args: [] } }).graphTypePending()).toBe(false);
  });

  test("a known type label is never replaced by the reserved place", () => {
    expect(occurrence({ guidance: true, busy: true, typeLabel: "String" }).graphTypePending()).toBe(false);
  });

  test("the graph's previews and node heading pass the pending type to their value card caption", () => {
    expect(preview).toContain("typePending={!readData && !!props.typePending && !(data()?.typeLabel ?? props.typeLabel)}");
    expect(editor).toContain("typePending={!!props.graphTypePending && !(props.graphTypeLabel ?? typeCaption())}");
    expect(editor.match(/typePending=\{graphTypePending\(\)\}/g)?.length).toBe(3);
    expect(editor).toContain("graphTypePending={graphTypePending()}");
    expect(editor).toContain("<ExpressionGraphCaptureContext value={pendingGraphCapture}>");
  });
});
