import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest } from "../../../node_modules/solid-js/dist/solid.dev.js";

// Run the actual per-child publication closures. Semantic record/list/native
// transforms are controlled ports: these checks cover host callback lineage.
const source = await Bun.file(new URL("./VariantValueEditor.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const cases = [
  ["variant", "function VariantBody(", "publishField"],
  ["native", "function NativeRepresentationEditor(", "publishStructure"],
  ["list", "function ListEditor(", "publishItem"],
  ["record", "function RecordEditor(", "publishField"],
  ["tuple", "function TupleEditor(", "publishIndex"],
  ["map", "function MapEditor(", "publishValue"],
];
function fixture(kind, component, name) {
  const section = source.slice(source.indexOf(component));
  const match = section.match(new RegExp(`const ${name} = createMemo\\(\\(\\) => \\{[\\s\\S]*?return publication;\\s*\\}\\);`));
  if (!match) throw new Error(`Publication fixture boundary moved: ${component}`);
  const code = transpiler.transformSync(`${match[0]}; return ${name};`);
  let dispose;
  const h = createRoot(close => {
    dispose = close;
    const [publisher, setPublisher] = createSignal("first publisher");
    const [parent, setParent] = createSignal({ amount: 1 });
    const [shape, setShape] = createSignal({ label: "first shape" });
    const [selected, setSelected] = createSignal("FirstCase");
    const [session, setSession] = createSignal({ label: "first frame" });
    const [index, setIndex] = createSignal(0);
    const writes = [], calls = []; let getterReads = 0;
    const props = { get onChange() { getterReads++; const id = publisher(); return value => writes.push({ id, value }); },
      get value() { return parent(); }, get view() { return shape(); }, get type() { return shape(); },
      get typeName() { return "Rational"; }, get fields() { return shape(); }, get elements() { return shape(); },
      get elementType() { return shape(); }, get valueType() { return shape(); } };
    const setSlot = (slot, value, publish) => { calls.push({ slot, value, publish }); publish({ slot, value }); };
    const imports = { props, createMemo, latest, f: { name: "amount" }, field: () => ({ name: "amount" }), k: "amount", i: kind === "tuple" ? index : 0,
      currentCase: selected, mode: selected, frame: session,
      setField: setSlot, setItem: setSlot, setIndex: setSlot, setValue: setSlot,
      changeStructure: (value, publish) => { calls.push({ value, publish }); publish(value); } };
    const publication = new Function(...Object.keys(imports), code)(...Object.values(imports));
    createEffect(publication, () => {});
    return { publication, writes, calls, setPublisher, setParent, setShape, setSelected, setSession, setIndex,
      getterReads: () => getterReads };
  });
  flush(); return { ...h, dispose: () => { dispose(); flush(); } };
}

describe("nested numeric publisher lineage", () => {
  for (const [kind, component, name] of cases) {
    test(`${kind} accepts a JSX publisher getter that creates a new closure on each read`, () => {
      const h = fixture(kind, component, name);
      try {
        const callback = h.publication().callback, reads = h.getterReads(); callback("decoded");
        expect(h.writes).toHaveLength(1); expect(h.writes[0].id).toBe("first publisher");
        expect(h.calls[0].publish).toBeFunction(); expect(h.getterReads()).toBe(reads);
      } finally { h.dispose(); }
    });
    for (const change of ["publisher", "parent", "shape"]) test(`${kind} rejects a pending numeric result after ${change} replacement`, () => {
      const h = fixture(kind, component, name);
      try {
        const old = h.publication().callback;
        if (change === "publisher") h.setPublisher("next publisher");
        else if (change === "parent") h.setParent({ amount: "replacement" });
        else h.setShape({ label: "next shape" });
        flush(); old("obsolete decoded value"); expect(h.writes).toEqual([]);
        h.publication().callback("current decoded value"); expect(h.writes).toHaveLength(1);
        expect(h.writes[0].id).toBe(change === "publisher" ? "next publisher" : "first publisher");
      } finally { h.dispose(); }
    });
    for (const change of ["publisher", "parent", "shape"]) test(`${kind} never executes a newly queued publisher as an updater before flush (${change})`, () => {
      const h = fixture(kind, component, name);
      try {
        const old = h.publication().callback;
        if (change === "publisher") h.setPublisher("queued publisher");
        else if (change === "parent") h.setParent({ amount: "queued replacement" });
        else h.setShape({ label: "queued shape" });
        old("obsolete decoded value");
        expect(h.writes).toEqual([]); expect(h.calls).toEqual([]);
        flush(); expect(h.writes).toEqual([]); expect(h.calls).toEqual([]);
        h.publication().callback("current decoded value"); expect(h.writes).toHaveLength(1);
      } finally { h.dispose(); }
    });
  }
  for (const coordinate of ["case", "frame"]) test(`native conversion rejects a captured ${coordinate} replacement`, () => {
    const h = fixture("native", "function NativeRepresentationEditor(", "publishStructure");
    try {
      const old = h.publication().callback;
      if (coordinate === "case") h.setSelected("OtherMode"); else h.setSession({ label: "new frame" });
      flush(); old("obsolete"); expect(h.writes).toEqual([]);
    } finally { h.dispose(); }
  });
  test("tuple slot movement rejects the previous slot publisher", () => {
    const h = fixture("tuple", "function TupleEditor(", "publishIndex");
    try { const old = h.publication().callback; h.setIndex(1); flush(); old("obsolete"); expect(h.writes).toEqual([]); }
    finally { h.dispose(); }
  });
});
