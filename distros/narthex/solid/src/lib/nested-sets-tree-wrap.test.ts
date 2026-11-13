import { describe, expect, test } from "bun:test";
import fixture from "./nested-sets-classification.fixture.json";
import { classificationGraph, readClassification } from "./nested-sets-classification";
import { fitScale, nestedSetsTreeLayout, treeRootCentre, type PlacedSetGraphNode, type SetGraphLayout } from "./nested-sets-graph";

// The real tree of life (99 sets, 63 species) and the foods (83 sets, 70 foods)
// are too wide for one row of leaves (9,767 px and 8,617 px before): the leaves
// under one set wrap into a grid of at most four, the sets under a set into
// rows, so the whole tree reads top to bottom on a desktop card.
const graphOf = (value: unknown) => classificationGraph(readClassification(value)!);
const life = graphOf(fixture.life), foods = graphOf(fixture.foods);
/** The card a 1920-wide window gives the drawing, and a tile's picture size. */
const CARD = 1150, PICTURE = 56;

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, margin = 2) =>
  a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
/** An axis-aligned segment passing through a box's inside (its edges excluded). */
function crosses(from: { x: number; y: number }, to: { x: number; y: number }, box: Box): boolean {
  const inset = 1;
  const left = box.x + inset, right = box.x + box.width - inset, top = box.y + inset, bottom = box.y + box.height - inset;
  if (from.x === to.x) return from.x > left && from.x < right && Math.max(from.y, to.y) > top && Math.min(from.y, to.y) < bottom;
  if (from.y === to.y) return from.y > top && from.y < bottom && Math.max(from.x, to.x) > left && Math.min(from.x, to.x) < right;
  return true; // a diagonal is never drawn
}
/** The lines the tree draws: the classification's, and each member's into a set that cuts across. */
const drawnEdges = (graph: typeof life) => graph.edges.filter((edge) => edge.tree || graph.nodes.find((node) => node.id === edge.to)?.across).length;
const byId = (layout: SetGraphLayout) => new Map(layout.nodes.map((node) => [node.id, node] as const));

function checkDrawing(name: string, layout: SetGraphLayout, treeEdges: number) {
  const nodes = byId(layout);
  // No two cards overlap.
  for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) {
    const a = layout.nodes[i]!, b = layout.nodes[j]!;
    if (overlaps(a, b)) throw new Error(`${name}: ${a.id} overlaps ${b.id}`);
  }
  // Every drawn line is axis-aligned and passes through no card but its own ends.
  let connectors = 0;
  for (const bracket of layout.brackets) {
    const parent = nodes.get(bracket.parent)!;
    for (const connector of bracket.connectors) {
      connectors++;
      const child = nodes.get(connector.child)!;
      const points = [...connector.points, bracket.trunk[1]];
      // It starts at the child's edge middle and ends in the parent's edge middle.
      expect(points[0]!.x).toBeCloseTo(child.x + child.width / 2, 5);
      expect(bracket.trunk[1].x).toBeCloseTo(parent.x + parent.width / 2, 5);
      for (let k = 1; k < points.length; k++) for (const card of layout.nodes) {
        if (card.id === child.id || card.id === parent.id) continue;
        if (crosses(points[k - 1]!, points[k]!, card)) throw new Error(`${name}: ${child.id} -> ${parent.id} crosses ${card.id}`);
      }
    }
  }
  expect(connectors).toBe(treeEdges);
  // Every parent sits above the children it holds.
  for (const bracket of layout.brackets) if (!bracket.across) {
    const parent = nodes.get(bracket.parent)!;
    for (const connector of bracket.connectors) expect(nodes.get(connector.child)!.y).toBeGreaterThan(parent.y + parent.height);
  }
  // Everything lies inside the drawing.
  for (const node of layout.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
    expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
  }
}

describe("a large tree wraps its leaves and its sets into rows", () => {
  test("the tree of life: one root on top, every species a tile, every line routed between the cards", () => {
    const layout = nestedSetsTreeLayout(life);
    expect(layout.nodes).toHaveLength(100);
    checkDrawing("life", layout, drawnEdges(life));
    const nodes = byId(layout);
    const root = nodes.get("set:AllLife")!;
    expect(Math.min(...layout.nodes.map((node) => node.y))).toBe(root.y);
    expect(root.level).toBe(0);
    // Every species keeps the bottom level (it is drawn as a picture tile).
    const leaves = layout.nodes.filter((node) => node.kind === "species");
    expect(leaves).toHaveLength(63);
    expect(new Set(leaves.map((node) => node.level))).toEqual(new Set([4]));
    // The kingdoms stay side by side under All life.
    const kingdoms = ["set:Plantae", "set:Fungi", "set:Animalia"].map((id) => nodes.get(id)!);
    expect(new Set(kingdoms.map((node) => node.y)).size).toBe(1);
    expect(kingdoms[0]!.x).toBeLessThan(kingdoms[1]!.x);
    expect(kingdoms[1]!.x).toBeLessThan(kingdoms[2]!.x);
    // The eight species of the carrot family: two rows of four, under their family.
    const carrots = layout.nodes.filter((node) => layout.brackets.find((row) => row.parent === "set:Apiaceae")!.connectors.some((row) => row.child === node.id));
    expect(carrots).toHaveLength(8);
    expect(new Set(carrots.map((node) => node.y)).size).toBe(2);
    // The fennels hang below their two members.
    const fennels = nodes.get("cross:Fennels")!;
    for (const id of ["set:FoeniculumVulgare", "set:FerulaCommunis"]) expect(fennels.y).toBeGreaterThan(nodes.get(id)!.y + nodes.get(id)!.height);
  });

  test("the tree of life fits a desktop card with Fit at a readable picture size", () => {
    const layout = nestedSetsTreeLayout(life);
    expect(layout.width).toBeLessThanOrEqual(2900);
    expect(fitScale(layout.width, CARD) * PICTURE).toBeGreaterThanOrEqual(20);
  });

  test("the foods by kind wrap the same way", () => {
    const layout = nestedSetsTreeLayout(foods);
    checkDrawing("foods", layout, drawnEdges(foods));
    expect(layout.width).toBeLessThanOrEqual(2900);
  });

  test("the drawing opens on its root: the horizontal centre of All life", () => {
    const layout = nestedSetsTreeLayout(life);
    const root = byId(layout).get("set:AllLife")! as PlacedSetGraphNode;
    expect(treeRootCentre(layout)).toBe(root.x + root.width / 2);
  });
});
