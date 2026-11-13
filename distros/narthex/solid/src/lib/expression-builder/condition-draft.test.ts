// @ts-nocheck -- Execute actual event handlers without a browser or DOM renderer.
import { describe, expect, test } from "bun:test";
import { cloneDraftValue } from "../native-draft";
const source = await Bun.file(new URL("./ConditionBuilder.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const helpers = source.slice(source.indexOf("export function arrEq"), source.indexOf("// ConditionBuilder — inline")).replaceAll("export function", "function");

describe("condition native snapshots", () => {
  test("drag start retains a detached native condition", () => {
    const start = source.indexOf("  function handleDragStart(");
    const handler = source.slice(start, source.indexOf("  function handleDragEnd", start));
    const condition = { op: "compare", value: Infinity, signed: -0, bytes: Uint8Array.of(1, 2) };
    let saved;
    const run = new Function("props", "cloneDraftValue", `${transpiler.transformSync(handler)} return handleDragStart;`)({ condition, path: [1], dnd: { setSource: (value) => { saved = value; } } }, cloneDraftValue);
    run({ stopPropagation() {}, dataTransfer: { setData() {} } });
    condition.value = null;
    expect(saved.condition.value).toBe(Infinity);
    expect(Object.is(saved.condition.signed, -0)).toBe(true);
    expect(saved.condition.bytes).toEqual(Uint8Array.of(1, 2));
  });
  test("tree moves preserve values and leave the previous tree untouched", () => {
    const start = source.indexOf("  function performDrop()");
    const handler = source.slice(start, source.indexOf("  const dnd:", start));
    const condition = { op: "and", children: [{ op: "a", value: Infinity }, { op: "b", value: -0 }, { op: "c", value: null }] };
    let next;
    const run = new Function("props", "dragSource", "dropTarget", "setDragSource", "setDropTarget", "cloneDraftValue", `${transpiler.transformSync(helpers + handler)} return performDrop;`)(
      { condition, onChange: (value) => { next = value; }, createBlank: () => ({}) }, () => ({ path: [0], condition: condition.children[0] }), () => ({ parentPath: [], index: 3 }), () => {}, () => {}, cloneDraftValue,
    );
    run();
    expect(next.children.map((child) => child.op)).toEqual(["b", "c", "a"]);
    expect(Object.is(next.children[0].value, -0)).toBe(true);
    expect(next.children[2].value).toBe(Infinity);
    expect(condition.children[0].op).toBe("a");
  });
});
