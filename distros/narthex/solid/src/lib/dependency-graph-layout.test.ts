import { expect, test } from "bun:test";
import { dependencyGraphLayout, dependencyGraphRows, type DependencyLayout } from "./dependency-graph-layout";

const node = (id: string, label = id) => ({ id, label });
const edge = (from: string, to: string, labels: string[] = []) => ({ from, to, labels });

const column = (layout: DependencyLayout, id: string) => layout.nodes.find(placed => placed.id === id)?.column;

test("a two-step upstream node goes two columns left; a two-step user goes two columns right", () => {
  // grandparent -> parent -> focus -> user -> grandchild (an arrow points from used data to its user)
  const layout = dependencyGraphLayout({ focus: "focus",
    nodes: [node("focus"), node("parent"), node("grandparent"), node("user"), node("grandchild")],
    edges: [edge("grandparent", "parent"), edge("parent", "focus"), edge("focus", "user"), edge("user", "grandchild")] }, { width: 1400 });
  expect(column(layout, "grandparent")).toBe(-2);
  expect(column(layout, "parent")).toBe(-1);
  expect(column(layout, "focus")).toBe(0);
  expect(column(layout, "user")).toBe(1);
  expect(column(layout, "grandchild")).toBe(2);
  const x = (id: string) => layout.nodes.find(placed => placed.id === id)!.x;
  expect(x("grandparent")).toBeLessThan(x("parent"));
  expect(x("parent")).toBeLessThan(x("focus"));
  expect(x("focus")).toBeLessThan(x("user"));
});

test("a cycle keeps the first distance it was reached at", () => {
  const layout = dependencyGraphLayout({ focus: "focus", nodes: [node("focus"), node("a"), node("b")],
    edges: [edge("a", "focus"), edge("focus", "a"), edge("focus", "b"), edge("b", "a")] }, { width: 900 });
  expect(column(layout, "a")).toBe(-1);
  expect(column(layout, "b")).toBe(1);
  // Both edges between focus and a are still drawn.
  expect(layout.edges.filter(routed => [routed.from, routed.to].sort().join() === "a,focus")).toHaveLength(2);
});

test("an 800-node graph renders at most the cap per column plus an exact +k chip", () => {
  const users = Array.from({ length: 800 }, (_, index) => node(`user-${index}`));
  const layout = dependencyGraphLayout({ focus: "focus", nodes: [node("focus"), ...users],
    edges: users.map(user => edge("focus", user.id)) }, { width: 900, cap: 8 });
  const shown = layout.nodes.filter(placed => placed.column === 1);
  expect(shown).toHaveLength(8);
  expect(layout.more).toEqual([expect.objectContaining({ column: 1, count: 792 })]);
  // Edges to hidden nodes are not drawn.
  expect(layout.edges).toHaveLength(8);
  expect(layout.nodes.find(placed => placed.focus)?.id).toBe("focus");
});

test("the focus is never hidden, even in a crowded column", () => {
  const siblings = Array.from({ length: 30 }, (_, index) => node(`s-${index}`));
  const layout = dependencyGraphLayout({ focus: "focus", nodes: [...siblings, node("focus")], edges: [] }, { width: 900, cap: 6 });
  expect(layout.nodes.some(placed => placed.id === "focus" && placed.focus)).toBe(true);
  // Data with no link to the focus is neither drawn nor counted.
  expect(layout.nodes.filter(placed => placed.column === 0)).toHaveLength(1);
  expect(layout.more).toEqual([]);
});

const crosses = (segment: { x1: number; y1: number; x2: number; y2: number }, box: { x: number; y: number; width: number; height: number }) => {
  const left = Math.min(segment.x1, segment.x2), right = Math.max(segment.x1, segment.x2);
  const top = Math.min(segment.y1, segment.y2), bottom = Math.max(segment.y1, segment.y2);
  // Strict interior overlap: touching a card's border (where an edge starts or ends) is not crossing it.
  return left < box.x + box.width - 0.5 && right > box.x + 0.5 && top < box.y + box.height - 0.5 && bottom > box.y + 0.5;
};

function assertNoEdgeCrossesACard(layout: DependencyLayout) {
  for (const routed of layout.edges) {
    expect(routed.points.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < routed.points.length; index++) {
      const [a, b] = [routed.points[index - 1]!, routed.points[index]!];
      // Routes are axis-aligned: every segment is horizontal or vertical.
      expect(a.x === b.x || a.y === b.y).toBe(true);
      const segment = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      for (const box of [...layout.nodes, ...layout.more]) {
        if (crosses(segment, box)) throw new Error(`edge ${routed.from} -> ${routed.to} crosses ${"id" in box ? box.id : "a +more chip"}`);
      }
    }
  }
}

test("no edge segment passes behind a card (the build drew one through the focus card)", () => {
  // The case seen in the build: All Transaction feeds Group by date and Sum;
  // Sum is the focus and Group by date sits on the far side of it.
  const layout = dependencyGraphLayout({ focus: "sum",
    nodes: [node("sum", "Sum"), node("all", "All Transaction"), node("group", "Group by date"), node("chart", "Chart")],
    edges: [edge("all", "sum"), edge("all", "group"), edge("sum", "chart"), edge("group", "chart")] }, { width: 900 });
  assertNoEdgeCrossesACard(layout);
});

test("long, backward and same-column edges route around every card", () => {
  const nodes = [node("focus"), ...["a", "b", "c", "d", "e", "f", "g", "h"].map(id => node(id))];
  const layout = dependencyGraphLayout({ focus: "focus", nodes,
    edges: [edge("a", "focus"), edge("b", "a"), edge("b", "focus"), edge("focus", "c"), edge("c", "d"), edge("b", "d"),
      edge("d", "b"), edge("focus", "e"), edge("e", "c"), edge("a", "f"), edge("f", "g"), edge("g", "h"), edge("h", "a")] }, { width: 1100 });
  assertNoEdgeCrossesACard(layout);
  // Every edge between drawn nodes is drawn.
  const drawn = new Set(layout.nodes.map(placed => placed.id));
  expect(layout.edges).toHaveLength([["a", "focus"], ["b", "a"], ["b", "focus"], ["focus", "c"], ["c", "d"], ["b", "d"], ["d", "b"], ["focus", "e"],
    ["e", "c"], ["a", "f"], ["f", "g"], ["g", "h"], ["h", "a"]].filter(([from, to]) => drawn.has(from!) && drawn.has(to!)).length);
  expect(layout.edges.length).toBeGreaterThanOrEqual(8);
});

test("a narrow panel keeps fewer, readable columns: the farthest are counted, never squeezed", () => {
  const layout = dependencyGraphLayout({ focus: "focus", nodes: [node("focus"), node("a"), node("b"), node("c"), node("d")],
    edges: [edge("b", "a"), edge("a", "focus"), edge("focus", "c"), edge("c", "d")] }, { width: 600 });
  expect(Object.fromEntries(layout.nodes.map(placed => [placed.id, placed.column]))).toEqual({ a: -1, focus: 0, c: 1 });
  // A dropped column's chip points the way its data lies.
  expect(layout.more.map(chip => [chip.column, chip.count, chip.direction]).sort()).toEqual([[-1, 1, "left"], [1, 1, "right"]]);
  for (const placed of layout.nodes) expect(placed.width).toBeGreaterThanOrEqual(140);
  // Nothing sits under the 18 px edge fade or past the panel edge.
  for (const box of [...layout.nodes, ...layout.more]) {
    expect(box.x).toBeGreaterThanOrEqual(30);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.width - 30);
  }
  for (const routed of layout.edges) for (const point of routed.points) {
    expect(point.x).toBeGreaterThanOrEqual(18); expect(point.x).toBeLessThanOrEqual(layout.width - 18);
  }
  for (const one of layout.nodes) for (const other of layout.nodes) {
    if (one === other) continue;
    const overlap = one.x < other.x + other.width && other.x < one.x + one.width && one.y < other.y + other.height && other.y < one.y + one.height;
    expect(overlap).toBe(false);
  }
  expect(layout.width).toBeGreaterThanOrEqual(Math.max(...layout.nodes.map(placed => placed.x + placed.width)));
  assertNoEdgeCrossesACard(layout);
});

test("grouped rows: made from and used by in distance order, field names kept, capped", () => {
  const rows = dependencyGraphRows({ focus: "species",
    nodes: [node("species", "Common fennel"), node("genus", "Foeniculum"), node("family", "Apiaceae"), node("plate", "Köhler plate"),
      ...Array.from({ length: 9 }, (_, index) => node(`user-${index}`))],
    edges: [edge("family", "genus", ["Family"]), edge("genus", "species", ["Genus"]), edge("species", "plate", ["Subject"]),
      ...Array.from({ length: 9 }, (_, index) => edge("species", `user-${index}`))] }, { cap: 6 });
  expect(rows.focus.id).toBe("species");
  expect(rows.groups.map(group => group.kind)).toEqual(["madeFrom", "usedBy"]);
  expect(rows.groups[0]!.rows.map(row => [row.id, row.relation])).toEqual([["genus", "Genus"], ["family", "Family · through Foeniculum"]]);
  expect(rows.groups[1]!.rows).toHaveLength(6);
  expect(rows.groups[1]!.rows[0]).toEqual(expect.objectContaining({ id: "plate", relation: "Subject" }));
  expect(rows.groups[1]!.more).toBe(4);
});

test("the made-from chain goes left and the used-by chain right; parts of a shared user are counted, not drawn", () => {
  // Rom and Common fennel make up Fenel, Foeniculum makes up Common fennel; Demo uses Fenel and also holds
  // the library tools, which have nothing to do with Fenel.
  const tools = Array.from({ length: 12 }, (_, index) => node(`tool-${index}`));
  const layout = dependencyGraphLayout({ focus: "fenel",
    nodes: [node("fenel", "Fenel"), node("rom", "Rom"), node("fennel", "Common fennel"), node("genus", "Foeniculum"), node("demo", "Demo"), ...tools],
    edges: [edge("rom", "fenel", ["Founders"]), edge("fennel", "fenel", ["Named after"]), edge("genus", "fennel", ["Genus"]),
      edge("fenel", "demo"), ...tools.map(tool => edge(tool.id, "demo"))] }, { width: 1000 });
  expect(Object.fromEntries(layout.nodes.map(placed => [placed.id, placed.column])))
    .toEqual({ genus: -2, rom: -1, fennel: -1, fenel: 0, demo: 1 });
  // The other parts of the shared Demo card are not dependencies of Fenel: not drawn, not counted.
  expect(layout.more).toEqual([]);
  assertNoEdgeCrossesACard(layout);
  const rows = dependencyGraphRows({ focus: "fenel", nodes: [node("fenel"), node("rom"), node("demo"), ...tools],
    edges: [edge("rom", "fenel"), edge("fenel", "demo"), ...tools.map(tool => edge(tool.id, "demo"))] });
  expect(rows.groups.map(group => group.kind)).toEqual(["madeFrom", "usedBy"]);
  expect(rows.groups.flatMap(group => group.rows.map(row => row.id))).toEqual(["rom", "demo"]);
  expect(rows.groups.every(group => group.more === 0)).toBe(true);
});

test("cards are 150 to 180 px wide with three or four columns", () => {
  const layout = dependencyGraphLayout({ focus: "f", nodes: [node("f"), node("a"), node("b"), node("c")],
    edges: [edge("b", "a"), edge("a", "f"), edge("f", "c")] }, { width: 900 });
  expect(new Set(layout.nodes.map(placed => placed.column)).size).toBe(4);
  for (const placed of layout.nodes) { expect(placed.width).toBeGreaterThanOrEqual(150); expect(placed.width).toBeLessThanOrEqual(180); }
});

test("data that uses another one-step user sits a column further out (Fen uses Fenel)", () => {
  const layout = dependencyGraphLayout({ focus: "fennel", nodes: [node("fennel"), node("fenel"), node("fen"), node("plate")],
    edges: [edge("fennel", "fenel"), edge("fennel", "fen"), edge("fenel", "fen"), edge("fennel", "plate")] }, { width: 1200 });
  const at = Object.fromEntries(layout.nodes.map(placed => [placed.id, placed.column]));
  expect(at).toEqual({ fennel: 0, fenel: 1, plate: 1, fen: 2 });
  // No edge joins two cards of one column.
  for (const routed of layout.edges) expect(at[routed.from]).not.toBe(at[routed.to]);
});

test("a small graph is centred in the free height it is given", () => {
  const layout = dependencyGraphLayout({ focus: "f", nodes: [node("f"), node("a")], edges: [edge("a", "f")] }, { width: 900, height: 600 });
  expect(layout.height).toBe(600);
  const focus = layout.nodes.find(placed => placed.focus)!;
  expect(Math.abs(focus.y + focus.height / 2 - 300)).toBeLessThan(2);
  const tall = dependencyGraphLayout({ focus: "f", nodes: [node("f"), node("a")], edges: [edge("a", "f")] }, { width: 900, height: 10 });
  expect(tall.height).toBeGreaterThan(52);
});

test("the More links control sits right under the graph, and graph and control are centred together", () => {
  const layout = dependencyGraphLayout({ focus: "f", nodes: [node("f"), node("a"), node("b")], edges: [edge("a", "f"), edge("b", "f")] },
    { width: 900, height: 600, footer: 28 });
  const bottom = Math.max(...layout.nodes.map(placed => placed.y + placed.height));
  const top = Math.min(...layout.nodes.map(placed => placed.y));
  expect(layout.footer).toBeDefined();
  expect(layout.footer!.y - bottom).toBeGreaterThan(0);
  expect(layout.footer!.y - bottom).toBeLessThanOrEqual(24);
  const focus = layout.nodes.find(placed => placed.focus)!;
  expect(layout.footer!.x).toBe(focus.x); expect(layout.footer!.width).toBe(focus.width);
  // The block (cards + control) is centred in the 600 px it was given.
  expect(Math.abs((top + layout.footer!.y + layout.footer!.height) / 2 - 300)).toBeLessThan(2);
});

const columnsOf = (layout: DependencyLayout) => Object.fromEntries(layout.nodes.map(placed => [placed.id, placed.column]));
const contiguous = (layout: DependencyLayout) => {
  const used = [...new Set([...layout.nodes.map(placed => placed.column), ...layout.more.map(chip => chip.column)])].sort((a, b) => a - b);
  return used.every((at, index) => index === 0 || at === used[index - 1]! + 1);
};

test("cycles never leave empty columns, and the focus's direct links always stay (width 700)", () => {
  const nodes = [node("focus"), ...["a", "b", "c", "d", "e", "f", "g", "h"].map(id => node(id))];
  const edges = [edge("a", "focus"), edge("b", "a"), edge("b", "focus"), edge("focus", "c"), edge("c", "d"), edge("b", "d"),
    edge("d", "b"), edge("focus", "e"), edge("e", "c"), edge("a", "f"), edge("f", "g"), edge("g", "h"), edge("h", "a")];
  const layout = dependencyGraphLayout({ focus: "focus", nodes, edges }, { width: 700 });
  expect(contiguous(layout)).toBe(true);
  const drawn = columnsOf(layout);
  for (const direct of ["a", "b", "c", "e"]) expect(drawn[direct]).toBeDefined();
  // Whatever linked data is left out is counted somewhere.
  const linked = ["a", "b", "c", "d", "e"];
  const shown = linked.filter(id => drawn[id] !== undefined).length;
  expect(shown + layout.more.reduce((sum, chip) => sum + chip.count, 0)).toBe(linked.length);
});

test("a two-node cycle beside the focus takes two adjacent columns (width 700)", () => {
  const layout = dependencyGraphLayout({ focus: "f", nodes: [node("f"), node("a"), node("b")],
    edges: [edge("f", "a"), edge("a", "b"), edge("b", "a")] }, { width: 700 });
  expect(columnsOf(layout)).toEqual({ f: 0, a: 1, b: 2 });
  expect(layout.width).toBeLessThanOrEqual(700);
});

test("a direct link is never folded away, even when it sits two columns out (width 560)", () => {
  const layout = dependencyGraphLayout({ focus: "fennel", nodes: [node("fennel"), node("fenel"), node("fen"), node("plate")],
    edges: [edge("fennel", "fenel"), edge("fennel", "fen"), edge("fenel", "fen"), edge("fennel", "plate")] }, { width: 560 });
  expect(columnsOf(layout)).toEqual({ fennel: 0, fenel: 1, plate: 1, fen: 2 });
  expect(layout.more).toEqual([]);
});

test("rows never name the focus as the data in between", () => {
  const rows = dependencyGraphRows({ focus: "fennel", nodes: [node("fennel", "Common fennel"), node("fenel", "Fenel"), node("fen", "Fen")],
    edges: [edge("fennel", "fenel"), edge("fennel", "fen"), edge("fenel", "fen")] });
  const fen = rows.groups.flatMap(group => group.rows).find(row => row.id === "fen")!;
  expect(fen.relation ?? "").not.toContain("Common fennel");
});

// Round 4: the public Fenel project — fourteen made-from links into one card.
const fenelGraph = () => {
  const people = ["rom", "thomas", "bayne"].map(id => node(id));
  const languages = ["lisp", "smalltalk", "prolog", "erlang", "coq", "haskell", "ml", "forth", "apl"].map(id => node(id));
  const plants = [node("fennel"), node("giant"), node("fennels")];
  return { focus: "fenel", nodes: [node("fenel"), ...people, ...languages, ...plants, node("fen"), node("demo")],
    edges: [edge("rom", "fenel", ["Founders", "Maintainers"]), edge("thomas", "fenel", ["Founders"]), edge("bayne", "fenel", ["Maintainers"]),
      ...languages.map(language => edge(language.id, "fenel", ["Inspired By"])),
      edge("fennel", "fenel", ["Named After"]), edge("giant", "fenel", ["Named After"]), edge("fennels", "fenel", ["Logo Inspired By"]),
      edge("fenel", "fen"), edge("fenel", "demo"), edge("fen", "demo")] };
};

test("made-from links are grouped by the field that holds them: one heading and one arrow per group", () => {
  const layout = dependencyGraphLayout(fenelGraph(), { width: 600, height: 2000 });
  expect(layout.groups.map(group => [group.label, group.ids.length, group.also])).toEqual([
    ["Founders", 2, 0], ["Maintainers", 1, 1], ["Inspired By", 9, 0], ["Named After", 2, 0], ["Logo Inspired By", 1, 0]]);
  const intoFocus = layout.edges.filter(routed => routed.to === "fenel");
  expect(intoFocus).toHaveLength(5);
  expect(intoFocus.every(routed => routed.labels.length === 0 && !routed.label)).toBe(true);
  // A heading sits above its group's first card.
  for (const group of layout.groups) {
    const firstCard = layout.nodes.find(placed => placed.id === group.ids[0])!;
    expect(group.y + group.height).toBeLessThanOrEqual(firstCard.y);
  }
});

test("arrows entering one card are at least 6 px apart, and never more than 8", () => {
  const layout = dependencyGraphLayout(fenelGraph(), { width: 600, height: 2000 });
  for (const target of layout.nodes) {
    const entering = layout.edges.filter(routed => routed.to === target.id).map(routed => routed.points[routed.points.length - 1]!.y).sort((a, b) => a - b);
    expect(entering.length).toBeLessThanOrEqual(8);
    for (let index = 1; index < entering.length; index++) expect(entering[index]! - entering[index - 1]!).toBeGreaterThanOrEqual(6);
  }
});

test("without field names, many links into one card still share one arrow", () => {
  const sources = Array.from({ length: 12 }, (_, index) => node(`s${index}`));
  const layout = dependencyGraphLayout({ focus: "f", nodes: [node("f"), ...sources], edges: sources.map(source => edge(source.id, "f")) },
    { width: 600, height: 2000 });
  expect(layout.edges.filter(routed => routed.to === "f")).toHaveLength(1);
  expect(layout.groups.map(group => group.label)).toEqual([""]);
});

test("the column cap follows the panel's height (at least 4), and a chip expands its column in place", () => {
  const short = dependencyGraphLayout(fenelGraph(), { width: 600, height: 420 });
  const left = (layout: DependencyLayout) => layout.nodes.filter(placed => placed.column === -1).length;
  expect(left(short)).toBeGreaterThanOrEqual(4);
  const chip = short.more.find(entry => entry.column === -1 && !entry.direction)!;
  expect(left(short) + chip.count).toBe(15);
  const expanded = dependencyGraphLayout(fenelGraph(), { width: 600, height: 420, expanded: [-1] });
  expect(left(expanded)).toBe(15);
  expect(expanded.more.filter(entry => entry.column === -1)).toEqual([]);
  expect(expanded.height).toBeGreaterThan(420);
  const tall = dependencyGraphLayout(fenelGraph(), { width: 600, height: 2000 });
  expect(left(tall)).toBe(15);
});

test("in a 600 px panel the Fenel graph keeps every card inside its canvas and the made-from side and focus in the first view", () => {
  const layout = dependencyGraphLayout(fenelGraph(), { width: 600, height: 800 });
  for (const placed of layout.nodes) { expect(placed.x).toBeGreaterThanOrEqual(0); expect(placed.x + placed.width).toBeLessThanOrEqual(layout.width); }
  const focus = layout.nodes.find(placed => placed.focus)!;
  // At scroll 0 the made-from column and the focus are whole; what lies right scrolls.
  expect(focus.x + focus.width).toBeLessThanOrEqual(600 - 18);
  expect(Math.min(...layout.nodes.map(placed => placed.x))).toBeGreaterThanOrEqual(18);
});
