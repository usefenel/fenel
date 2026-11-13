import { describe, expect, test } from "bun:test";
// The reactive (browser) build: Bun's default conditions select Solid's server build.
import { NotReadyError, createMemo, createRoot, createSignal, flush } from "../../../node_modules/solid-js/dist/solid.dev.js";
import { exactTransportKey, registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry-transport";

// Local `/~/<function>` (Nov 12 night): a Local reader's focused function drew
// "Function body unavailable in this reader." with a spinner that never ended.
// Home's `functionReadSource` memo re-runs whenever the Local presentation
// cache answers anything, handing TypedReadValue a new `functionSource` object
// for the same source; the reader read's input memo rebuilt itself each time
// (same worker, same wire), its new read made the painted body not current
// (`readCurrent`), and the graph fell back to the "unavailable" branch. The
// production memo is extracted unchanged from TypedReadValue.tsx; its worker,
// session and transport seams are controlled here.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = (await Bun.file(new URL("./TypedReadValue.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Production fixture boundary changed: ${start}`);
  return source.slice(first, last);
}
const readInputCode = transpiler.transformSync(section("  const readInput = createMemo<LocalTypedReadInput | undefined>(",
  "  const current = (input: ReturnType<typeof readInput>) => {"));

function world() {
  let built;
  const dispose = createRoot(dispose => { built = owned(); return dispose; });
  flush();
  return { ...built, dispose };
}
function owned() {
  const [revision, setRevision] = createSignal(1);
  // The upstream owner re-notifies with the same held value (a memo that
  // re-ran), or hands a new capture of the same function source.
  const [upstream, setUpstream] = createSignal(0);
  const held = { $ref: "hello-handle" };
  const [value, setValue] = createSignal(held);
  const firstSource = { node: { kind: "literal", value: { __lambda: { params: [], body: { kind: "literal", value: "hi" } } } }, current: () => true };
  const [functionSource, setFunctionSource] = createSignal(firstSource);
  const session = { label: "local-session" }, worker = { label: "worker" };
  const templates = { list: () => [], listComponentNames: () => [] };
  const reader = { kind: "local", session: () => session, registry: () => ({ label: "registry" }), templates: () => templates,
    revision: () => revision() };
  const props = {
    get value() { upstream(); return value(); },
    type: { $arrow: { params: [], returns: { $ref: "String" } } },
    get functionSource() { upstream(); return functionSource(); },
    get fallback() { return undefined; },
  };
  const imports = {
    createMemo, NotReadyError, registryTransportSnapshot, exactTransportKey,
    reader, props, inheritedSession: session,
    localReaderReadSession: base => base,
    preparedReaderWorkerForSession: () => worker,
  };
  const readInput = new Function(...Object.keys(imports), `${readInputCode}; return readInput;`)(...Object.values(imports));
  return { readInput, held, firstSource, setUpstream, setValue, setFunctionSource, setRevision };
}

describe("TypedReadValue: a Local reader's read input", () => {
  test("an upstream re-run with the same value and a new capture of the same function source keep the read (no new worker read)", () => {
    const w = world();
    const first = w.readInput();
    expect(first && "worker" in first).toBe(true);
    w.setUpstream(1); flush();
    expect(w.readInput()).toBe(first);
    const next = { ...w.firstSource, current: () => true };
    w.setFunctionSource(next); flush();
    expect(w.readInput()).toBe(first);
    // The body still reads the owner's current capture, never a retained one.
    expect(w.readInput().ui.functionSource).toBe(next);
    w.dispose();
  });
  test("a different question is a new read: new value bytes or a new reader revision", () => {
    const w = world();
    const first = w.readInput();
    w.setValue({ $ref: "other-handle" }); flush();
    const second = w.readInput();
    expect(second).not.toBe(first);
    expect(second.wire.value).toEqual({ $ref: "other-handle" });
    w.setRevision(2); flush();
    expect(w.readInput()).not.toBe(second);
    expect(w.readInput().revision).toBe(2);
    w.dispose();
  });
});
