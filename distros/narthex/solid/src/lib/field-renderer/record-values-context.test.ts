// Run with --conditions=browser --conditions=development for staged writes.
import { describe, expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush, type Accessor } from "solid-js";

// Exercise the production RecordEditor's context preparation without mounting
// its unrelated browser/media leaves or rebuilding an engine registry.
const source = await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text();
const recordStart = source.indexOf("function RecordEditor(");
const start = source.indexOf("  const obj =", recordStart);
const end = source.indexOf("  const hasFields", start);
const body = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const prepare = new Function("props", `${body}; return obj;`) as (
  props: { readonly value: unknown },
) => Accessor<Record<string, unknown>>;

describe("shared record sibling context", () => {
  test("a mounted descendant observes replacement data without losing context identity", () => {
    const fixture = createRoot(dispose => {
      const original = Object.freeze({ $tag: "Input", fromUnit: "g", toUnit: "lb" });
      const [value, setValue] = createSignal<unknown>(original);
      const context = prepare({ get value() { return value(); } });
      // useContext reads once during descendant setup; dependent plans then
      // invoke that same accessor inside dependent plans. The evaluator reads
      // own data descriptors, which do not subscribe to store proxy getters.
      const captured = context;
      const sibling = createMemo(() => Object.getOwnPropertyDescriptor(captured(), "fromUnit")?.value);
      const keys = createMemo(() => Object.keys(captured()).sort());
      return { original, context, captured, sibling, keys, setValue, dispose };
    });
    try {
      expect(fixture.sibling()).toBe("g");
      fixture.setValue({ $tag: "Input", fromUnit: "B", toUnit: "lb", extra: "retained" });
      flush();
      expect(fixture.context).toBe(fixture.captured);
      expect(fixture.sibling()).toBe("B");
      expect(fixture.captured().toUnit).toBe("lb");
      expect(fixture.captured().extra).toBe("retained");
      expect(fixture.keys()).toEqual(["$tag", "extra", "fromUnit", "toUnit"]);
      expect(fixture.original).toEqual({ $tag: "Input", fromUnit: "g", toUnit: "lb" });
      fixture.setValue({ $tag: "Input", fromUnit: "B", toUnit: "bit" });
      flush();
      expect(fixture.captured().toUnit).toBe("bit");
      expect(fixture.keys()).not.toContain("extra");
      fixture.setValue(undefined);
      flush();
      expect(fixture.sibling()).toBeUndefined();
      expect(fixture.keys()).toEqual([]);
    } finally { fixture.dispose(); }
  });

  test("each nested record's stable context follows only its own replacements", () => {
    const fixture = createRoot(dispose => {
      const [outer, setOuter] = createSignal<unknown>({ selected: "outer" });
      const [inner, setInner] = createSignal<unknown>({ selected: "inner" });
      const outerContext = prepare({ get value() { return outer(); } });
      const innerContext = prepare({ get value() { return inner(); } });
      const outerValue = createMemo(() => Object.getOwnPropertyDescriptor(outerContext(), "selected")?.value);
      const innerValue = createMemo(() => Object.getOwnPropertyDescriptor(innerContext(), "selected")?.value);
      return { outerValue, innerValue, setOuter, setInner, dispose };
    });
    try {
      expect(fixture.outerValue()).toBe("outer");
      expect(fixture.innerValue()).toBe("inner");
      fixture.setInner({ selected: "updated inner" });
      flush();
      expect(fixture.innerValue()).toBe("updated inner");
      expect(fixture.outerValue()).toBe("outer");
      fixture.setOuter({ selected: "updated outer" });
      flush();
      expect(fixture.outerValue()).toBe("updated outer");
      expect(fixture.innerValue()).toBe("updated inner");
    } finally { fixture.dispose(); }
  });
});
