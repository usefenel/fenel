// The If decision's wiring: the condition flows into one dot above If, and two
// branch dots under If each send an arrow into their own branch, also when a
// narrow screen stacks the branches (the False arrow then takes a side lane
// instead of crossing the True branch).
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/expression-runner/if-graph-geometry.test.ts
import { expect, test } from "bun:test";
import { ifGraphEdges } from "./if-graph-geometry";

const dot = (x: number, y: number) => ({ x, y, radius: 5.5 });
const near = (a: { x: number; y: number }, b: { x: number; y: number }, within: number) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= within;

test("side-by-side branches: one arrow into the condition dot, one arrow from each branch dot into its branch", () => {
  const layout = ifGraphEdges({
    condition: { left: 270, right: 350, top: 80, bottom: 100 },
    conditionDot: dot(310, 140),
    trueDot: dot(299, 190), falseDot: dot(321, 190),
    whenTrue: { left: 0, right: 280, top: 250, bottom: 600 },
    whenFalse: { left: 320, right: 620, top: 250, bottom: 330 },
    gutter: 612,
  });
  expect(layout.stacked).toBe(false);
  // The condition arrow leaves the condition's bottom and stops just short of its dot.
  expect(layout.condition.startX).toBe(310);
  expect(layout.condition.startY).toBe(102);
  expect(near({ x: layout.condition.endX, y: layout.condition.endY }, { x: 310, y: 140 }, 8)).toBe(true);
  expect(layout.condition.endY).toBeLessThan(140);
  // Each branch arrow starts at its own dot and ends on its branch's top centre.
  expect(near({ x: layout.whenTrue.startX, y: layout.whenTrue.startY }, { x: 299, y: 190 }, 8)).toBe(true);
  expect(near({ x: layout.whenFalse.startX, y: layout.whenFalse.startY }, { x: 321, y: 190 }, 8)).toBe(true);
  expect({ x: layout.whenTrue.endX, y: layout.whenTrue.endY }).toEqual({ x: 140, y: 248 });
  expect({ x: layout.whenFalse.endX, y: layout.whenFalse.endY }).toEqual({ x: 470, y: 248 });
  expect(layout.whenTrue.via).toEqual([]);
  expect(layout.whenFalse.via).toEqual([]);
  // Labels sit on the side away from the incoming shaft.
  expect(layout.trueLabelSide).toBe("start");
  expect(layout.falseLabelSide).toBe("end");
  expect(layout.whenFalse.path).toBe(`M ${layout.whenFalse.startX} ${layout.whenFalse.startY} L 470 248`);
});

test("stacked branches: the False arrow runs down a side lane past the True branch, then into False", () => {
  const layout = ifGraphEdges({
    condition: { left: 150, right: 230, top: 80, bottom: 100 },
    conditionDot: dot(190, 140),
    trueDot: dot(179, 190), falseDot: dot(201, 190),
    whenTrue: { left: 10, right: 350, top: 250, bottom: 700 },
    whenFalse: { left: 110, right: 270, top: 760, bottom: 840 },
    gutter: 362,
  });
  expect(layout.stacked).toBe(true);
  expect(layout.whenTrue.via).toEqual([]);
  expect({ x: layout.whenTrue.endX, y: layout.whenTrue.endY }).toEqual({ x: 180, y: 248 });
  const via = layout.whenFalse.via;
  expect(via.length).toBe(2);
  expect(via.every(point => point.x === 362)).toBe(true);
  // The lane passes the True branch's whole height before turning in.
  expect(via[0]!.y).toBeLessThan(250);
  expect(via[1]!.y).toBeGreaterThan(700);
  expect(via[1]!.y).toBeLessThan(758);
  expect({ x: layout.whenFalse.endX, y: layout.whenFalse.endY }).toEqual({ x: 190, y: 758 });
  expect(near({ x: layout.whenFalse.startX, y: layout.whenFalse.startY }, { x: 201, y: 190 }, 8)).toBe(true);
  // The last leg arrives from the right: its label goes left.
  expect(layout.falseLabelSide).toBe("start");
});

test("a condition without a result chip sends its arrow straight down from its bottom to the dot", () => {
  const layout = ifGraphEdges({
    condition: { left: 0, right: 520, top: 20, bottom: 60 }, straightCondition: true,
    conditionDot: dot(200, 140),
    trueDot: dot(189, 190), falseDot: dot(211, 190),
    whenTrue: { left: 0, right: 190, top: 250, bottom: 300 },
    whenFalse: { left: 210, right: 400, top: 250, bottom: 300 },
    gutter: 392,
  });
  expect(layout.condition.startX).toBe(200);
  expect(layout.condition.startY).toBe(62);
  expect(layout.condition.endX).toBe(200);
});
