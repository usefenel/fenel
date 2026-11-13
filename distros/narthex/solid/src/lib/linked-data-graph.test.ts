import { expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { collectionLinkedGraph, collectionMemberReferences, heldReferences, labelledEdges, linkedEdgePoints, linkedIncomingGroups, linkedRoutes, linkedSiblingGroups, settleOverlaps, linkedGraphFit, linkedGraphLayout, linkedCardTitle,
  type LayoutCard, type LinkedEdge } from "./linked-data-graph";

const ref = (id: string): ExprNode => ({ kind: "ref", savedExprId: id });
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const field = (name: string, value: ExprNode) => ({ name, value });
const construct = (tag: string, fields: { name: string; value: ExprNode }[]): ExprNode => literal({ __construct: { tag, fields } });
const list = (items: ExprNode[]): ExprNode => literal({ __list: items });

test("a member's held references are its saved references and the code identities it holds, by value position", () => {
  const project = construct("Project", [
    field("name", literal("Primal Diet")),
    field("authors", list([ref("aajonus")])),
    field("formulas", list([literal({ $ref: "lube" }), literal({ $ref: "hydration" })])),
    field("emblems", list([construct("Emblem", [field("plant", ref("giant")), field("meaning", literal("fire"))])])),
    // A call computes a value: its arguments are not positions of the project.
    field("logoSet", { kind: "call", fnId: "fennelsIn", args: [list([ref("fennel")])] } as ExprNode),
    // Raw literal data is never read for identities.
    field("notes", literal({ text: "see", $ref: "not-a-holding" })),
  ]);
  expect(heldReferences(project)).toEqual([
    { identity: "aajonus", path: ["authors", 0] },
    { identity: "lube", path: ["formulas", 0] },
    { identity: "hydration", path: ["formulas", 1] },
    { identity: "giant", path: ["emblems", 0, "plant"] },
  ]);
  expect(heldReferences(ref("rom"))).toEqual([{ identity: "rom", path: [] }]);
  expect(heldReferences(undefined)).toEqual([]);
});

test("a collection's members are its entries that reference saved data; computed lists and listed types are not", () => {
  const collection = literal({ __record: { fields: [
    field("People", { kind: "call", fnId: "showcasePeople", args: [] } as ExprNode),
    field("Rom", ref("rom")), field("Fenel", ref("fenel")),
    field("Person", literal({ $ref: "PublicPerson" })),
  ] } });
  expect(collectionMemberReferences(collection)).toEqual([{ identity: "rom", path: ["Rom"] }, { identity: "fenel", path: ["Fenel"] }]);
  expect(collectionMemberReferences(list([ref("a"), literal(3), ref("b")]))).toEqual([{ identity: "a", path: [0] }, { identity: "b", path: [2] }]);
  // A constructed datum is one datum, even when it references two others directly.
  expect(collectionMemberReferences(construct("Mascot", [field("mascotOf", ref("fenel")), field("plant", ref("fennel"))]))).toEqual([]);
});

test("the collection keeps its members and what they hold, drawn from the holder, with Fenel's labels joined", () => {
  const members = [{ id: "rom", label: "Rom" }, { id: "fenel", label: "Fenel" }, { id: "healthfully", label: "Healthfully" }];
  const held = new Map<string, Set<string>>([["fenel", new Set(["rom", "lisp"])], ["healthfully", new Set(["rom"])], ["rom", new Set()]]);
  const graph = collectionLinkedGraph({ members, held: holder => held.get(holder) ?? new Set(),
    walk: { nodes: [{ id: "rom", label: "Rom" }, { id: "lisp", label: "Lisp" }, { id: "rom-picture", label: "Rom's picture" }, { id: "demo", label: "Demo" }],
      edges: [
        { from: "rom", to: "fenel", labels: ["Authors"] },
        { from: "lisp", to: "fenel", labels: ["Inspired By Languages"] },
        { from: "rom", to: "fenel", labels: ["Authors", "Maintainers"] },
        { from: "rom", to: "healthfully", labels: ["Authors"] },
        // A computation inside Rom's card (his picture call) is not drawn.
        { from: "rom-picture", to: "rom", labels: [] },
        // A user outside the collection (the Demo holding it) is not drawn.
        { from: "fenel", to: "demo", labels: ["People and projects"] },
      ] } });
  expect(graph.nodes.map(node => node.id)).toEqual(["rom", "fenel", "healthfully", "lisp"]);
  expect(graph.edges).toEqual([
    { from: "fenel", to: "rom", labels: ["Authors", "Maintainers"] },
    { from: "fenel", to: "lisp", labels: ["Inspired By Languages"] },
    { from: "healthfully", to: "rom", labels: ["Authors"] },
  ]);
});

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function peopleAndProjects() {
  const cards: LayoutCard[] = [];
  const add = (id: string, height: number) => cards.push({ id, width: 232, height });
  for (const person of ["rom", "bayne", "aajonus"]) add(person, 92);
  for (const project of ["fenel", "primal", "healthfully", "bayneos", "drip", "cat", "fen"]) add(project, 150);
  const languages = ["lisp", "smalltalk", "prolog", "sql", "erlang", "coq", "haskell", "ocaml", "scratch", "typescript"];
  for (const language of languages) add(language, 112);
  for (const plant of ["fennel", "giant", "fennels", "lube", "hydration"]) add(plant, 118);
  const links = [
    ["fenel", "rom"], ["healthfully", "rom"], ["healthfully", "bayne"], ["cat", "rom"], ["bayneos", "bayne"], ["drip", "bayne"],
    ["primal", "aajonus"], ["healthfully", "primal"], ["primal", "lube"], ["primal", "hydration"], ["fen", "fenel"], ["fen", "fennel"],
    ["fenel", "fennel"], ["fenel", "giant"], ["fenel", "fennels"], ...languages.map(language => ["fenel", language]),
  ].map(([from, to]) => ({ from: from!, to: to! }));
  return { cards, links, central: new Set(["rom", "bayne", "aajonus", "fenel", "primal", "healthfully", "bayneos", "drip", "cat", "fen"]) };
}

test("the layout places every card without overlap, spread to the pane's shape, and the same input gives the same picture", () => {
  const { cards, links, central } = peopleAndProjects();
  const layout = linkedGraphLayout(cards, links, { aspect: 1.7, central });
  expect(layout.cards).toHaveLength(cards.length);
  for (let a = 0; a < layout.cards.length; a++)
    for (let b = a + 1; b < layout.cards.length; b++) expect(overlaps(layout.cards[a]!, layout.cards[b]!)).toBe(false);
  for (const card of layout.cards) {
    expect(card.x).toBeGreaterThanOrEqual(0); expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(layout.width); expect(card.y + card.height).toBeLessThanOrEqual(layout.height);
  }
  // Wider than tall for a wide pane, and compact enough to read when fitted to 1240 x 720.
  expect(layout.width / layout.height).toBeGreaterThan(1.1);
  expect(linkedGraphFit(layout, { width: 1240, height: 720 })).toBeGreaterThan(0.45);
  expect(linkedGraphLayout(cards, links, { aspect: 1.7, central })).toEqual(layout);
  // A linked pair sits nearer than the drawing's half width (short lines).
  const centre = (id: string) => { const card = layout.cards.find(placed => placed.id === id)!; return { x: card.x + card.width / 2, y: card.y + card.height / 2 }; };
  const distance = (a: string, b: string) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
  for (const [a, b] of [["primal", "aajonus"], ["bayneos", "bayne"], ["fenel", "haskell"]] as const) expect(distance(a, b)).toBeLessThan(layout.width / 2);
});

test("a line runs from border to border; several links under one name are named once", () => {
  const from = { id: "a", x: 0, y: 0, width: 100, height: 50 }, to = { id: "b", x: 300, y: 0, width: 100, height: 50 };
  const [start, end] = linkedEdgePoints(from, to);
  expect(start).toEqual({ x: 102, y: 25 });
  expect(end).toEqual({ x: 297, y: 25 });
  const edges: LinkedEdge[] = [{ from: "fenel", to: "lisp", labels: ["Inspired By Languages"] }, { from: "fenel", to: "coq", labels: ["Inspired By Languages"] },
    { from: "fenel", to: "rom", labels: ["Authors"] }, { from: "fen", to: "fenel", labels: [] }];
  const shown = labelledEdges(edges, edge => edge.to === "coq" ? 10 : 50);
  expect([...shown].map(edge => edge.to).sort()).toEqual(["coq", "rom"]);
});

test("fit never enlarges and keeps the whole drawing in the pane", () => {
  expect(linkedGraphFit({ width: 600, height: 300 }, { width: 1200, height: 700 })).toBe(1);
  expect(linkedGraphFit({ width: 2400, height: 700 }, { width: 1200, height: 700 })).toBe(0.5);
  expect(linkedGraphFit({ width: 0, height: 0 }, { width: 1200, height: 700 })).toBe(1);
});

// People and projects, placed by hand: Healthfully's authors split to Rom and
// Bayne; Rom is reached by three projects and Bayne by three; the Primal Diet
// holds two recipes; Healthfully is inspired by the Primal Diet.
function placedPeople() {
  const card = (id: string, x: number, y: number) => ({ id, x, y, width: 120, height: 60 });
  const cards = new Map([
    card("rom", 400, 300), card("bayne", 700, 300),
    card("fenel", 200, 0), card("cat", 300, 600), card("healthfully", 550, 0),
    card("bayneos", 900, 100), card("drip", 900, 500),
    card("primal", 1000, 0), card("lube", 1250, -150), card("hydration", 1250, 150),
  ].map(c => [c.id, c] as const));
  const authors = (from: string, to: string): LinkedEdge => ({ from, to, labels: ["Authors"] });
  const edges: LinkedEdge[] = [authors("fenel", "rom"), authors("cat", "rom"), authors("healthfully", "rom"), authors("healthfully", "bayne"),
    authors("bayneos", "bayne"), authors("drip", "bayne"), { from: "healthfully", to: "primal", labels: ["Inspired By"] },
    { from: "primal", to: "lube", labels: ["Formulas"] }, { from: "primal", to: "hydration", labels: ["Formulas"] }];
  const kind = (id: string) => ["fenel", "cat", "healthfully", "bayneos", "drip", "primal"].includes(id) ? "Project"
    : ["rom", "bayne"].includes(id) ? "PublicPerson" : "Recipe";
  return { cards, edges, kind };
}

test("outgoing links of one field split from one stem; incoming links of one kind and field join into one trunk with one head", () => {
  const { cards, edges, kind } = placedPeople();
  const routes = linkedRoutes(edges, cards, kind);
  // Splits: Healthfully > Authors (Rom, Bayne) and Primal Diet > Formulas (two recipes); nothing else splits.
  expect(routes.stems.map(stem => [stem.from, [...stem.to].sort()])).toEqual([["healthfully", ["bayne", "rom"]], ["primal", ["hydration", "lube"]]]);
  // Joins: Rom's three projects and Bayne's three projects, each one trunk into the person.
  expect(routes.trunks.map(trunk => [trunk.to, [...trunk.from].sort()])).toEqual([
    ["rom", ["cat", "fenel", "healthfully"]], ["bayne", ["bayneos", "drip", "healthfully"]]]);
  // A joined link has no head of its own; the trunk carries it. A plain link keeps its head.
  const segment = (from: string, to: string) => routes.segments.find(row => row.edge.from === from && row.edge.to === to)!;
  expect(segment("bayneos", "bayne").head).toBe(false);
  expect(segment("healthfully", "primal").head).toBe(true);
  // Healthfully's link to Rom runs from its split junction to Rom's join junction: one line through both.
  const stem = routes.stems.find(row => row.from === "healthfully")!;
  const romTrunk = routes.trunks.find(row => row.to === "rom")!;
  expect(segment("healthfully", "rom").points).toEqual([stem.points[1], romTrunk.points[0]]);
  // The trunk ends on Rom's border.
  const rom = cards.get("rom")!, end = romTrunk.points[1];
  const outside = Math.max(rom.x - end.x, end.x - (rom.x + rom.width), rom.y - end.y, end.y - (rom.y + rom.height));
  expect(outside).toBeGreaterThan(2);
  expect(outside).toBeLessThan(4);
});

test("no junction is shared by two fields, two holders' stems or two targets' trunks", () => {
  const { cards, edges, kind } = placedPeople();
  // Fenel holds two fields towards the same pair of targets: each field keeps its own stem.
  const more: LinkedEdge[] = [...edges, { from: "fenel", to: "lube", labels: ["Named After"] }, { from: "fenel", to: "hydration", labels: ["Named After"] },
    { from: "fenel", to: "lube", labels: ["Emblems"] }, { from: "fenel", to: "hydration", labels: ["Emblems"] }];
  const routes = linkedRoutes(more, cards, kind);
  const junctions = [...routes.stems.map(stem => ({ key: stem.key, at: stem.points[1] })), ...routes.trunks.map(trunk => ({ key: trunk.key, at: trunk.points[0] }))];
  expect(new Set(junctions.map(row => row.key)).size).toBe(junctions.length);
  for (let a = 0; a < junctions.length; a++)
    for (let b = a + 1; b < junctions.length; b++)
      expect(Math.hypot(junctions[a]!.at.x - junctions[b]!.at.x, junctions[a]!.at.y - junctions[b]!.at.y)).toBeGreaterThan(1);
  // A holder of another kind reaching the same target through the same field gets its own line, not the trunk.
  const other = linkedRoutes([...edges, { from: "lube", to: "rom", labels: ["Authors"] }], cards, kind);
  expect(other.trunks.find(row => row.to === "rom")!.from).not.toContain("lube");
  expect(other.segments.find(row => row.edge.from === "lube")!.head).toBe(true);
});

test("each field name is written once and clear of every card", () => {
  const { cards, edges, kind } = placedPeople();
  const routes = linkedRoutes(edges, cards, kind);
  const count = (text: string) => routes.labels.filter(label => label.text === text).length;
  // Formulas once (its stem), Inspired By once (its plain link), Authors on Healthfully's stem and on each trunk fed by unnamed links.
  expect(count("Formulas")).toBe(1);
  expect(count("Inspired By")).toBe(1);
  expect(count("Authors")).toBe(3);
  for (const label of routes.labels) {
    const half = label.text.length * 6.2 / 2 + 3;
    for (const card of cards.values()) {
      const overlaps = label.at.x + half > card.x && label.at.x - half < card.x + card.width && label.at.y + 3 > card.y && label.at.y - 13 < card.y + card.height;
      expect(overlaps).toBe(false);
    }
  }
});

test("siblings (one holder, one field) are laid out together on one side of their holder", () => {
  const { cards, links, central } = peopleAndProjects();
  const languages = ["lisp", "smalltalk", "prolog", "sql", "erlang", "coq", "haskell", "ocaml", "scratch", "typescript"];
  const layout = linkedGraphLayout(cards, links, { aspect: 1.7, central, siblings: [{ holder: "fenel", members: languages }] });
  const centre = (id: string) => { const placed = layout.cards.find(row => row.id === id)!; return { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 }; };
  const fenel = centre("fenel");
  const middle = languages.map(centre).reduce((sum, at) => ({ x: sum.x + at.x / languages.length, y: sum.y + at.y / languages.length }), { x: 0, y: 0 });
  const side = { x: middle.x - fenel.x, y: middle.y - fenel.y };
  expect(Math.hypot(side.x, side.y)).toBeGreaterThan(150);
  // Most languages sit on the side of Fenel their middle is on.
  const sameSide = languages.filter(id => { const at = centre(id); return (at.x - fenel.x) * side.x + (at.y - fenel.y) * side.y > 0; });
  expect(sameSide.length).toBeGreaterThanOrEqual(8);
  for (let a = 0; a < layout.cards.length; a++)
    for (let b = a + 1; b < layout.cards.length; b++) expect(overlaps(layout.cards[a]!, layout.cards[b]!)).toBe(false);
});

// The real People and projects graph as the page builds it before routing
// (captured from the public registry by linked-data-graph-query.test.ts).
test("on the real People and projects graph, the projects' Authors links join into one trunk into Rom and one into Bayne, and every name is clear of every card", async () => {
  const fixture = await Bun.file(new URL("./linked-data-graph.real-graph.json", import.meta.url)).json() as {
    nodes: Array<{ id: string; label: string; kind: string | null }>; edges: LinkedEdge[] };
  const label = new Map(fixture.nodes.map(node => [node.id, node.label] as const));
  const kind = new Map(fixture.nodes.map(node => [node.id, node.kind ?? undefined] as const));
  const sizes: Record<string, number> = { PublicPerson: 92, Project: 170, ProgrammingLanguage: 130, PlantSpecies: 190 };
  const cards: LayoutCard[] = fixture.nodes.map(node => ({ id: node.id, width: 232, height: sizes[node.kind ?? ""] ?? 140 }));
  // The same groups the view hands the layout (linked-data-graph-view.tsx).
  const siblings = [
    ...linkedSiblingGroups(fixture.edges).filter(group => group.length >= 2).map(group => ({ holder: group[0]!.from, members: group.map(edge => edge.to) })),
    ...linkedIncomingGroups(fixture.edges, id => kind.get(id)).filter(group => group.length >= 2).map(group => ({ holder: group[0]!.to, members: group.map(edge => edge.from) })),
  ];
  const layout = linkedGraphLayout(cards, fixture.edges, { aspect: 1.8, central: new Set(fixture.nodes.slice(0, 10).map(node => node.id)), siblings });
  const placed = new Map(layout.cards.map(card => [card.id, card] as const));
  const routes = linkedRoutes(fixture.edges, placed, id => kind.get(id));
  const trunkInto = (name: string) => routes.trunks.find(trunk => label.get(trunk.to) === name)?.from.map(id => label.get(id)).sort();
  expect(trunkInto("Rom")).toEqual(["7CatYear", "Fenel", "Healthfully"]);
  expect(trunkInto("Bayne")).toEqual(["BayneOS", "DripCollector", "Healthfully"]);
  for (const name of routes.labels) {
    const half = name.text.length * 6.2 / 2 + 3;
    for (const card of layout.cards) {
      const under = name.at.x + half > card.x && name.at.x - half < card.x + card.width && name.at.y + 3 > card.y && name.at.y - 13 < card.y + card.height;
      if (under) console.log(`name "${name.text}" under ${label.get(card.id)}`);
    }
  }
  const hidden = routes.labels.filter(name => layout.cards.some(card => {
    const half = name.text.length * 6.2 / 2 + 3;
    return name.at.x + half > card.x && name.at.x - half < card.x + card.width && name.at.y + 3 > card.y && name.at.y - 13 < card.y + card.height;
  }));
  expect(hidden.map(name => name.text)).toEqual([]);
  // No line runs behind a card it is not attached to, and no two names touch (12 px apart).
  const behind = routes.segments.flatMap(segment => segment.points.slice(1).flatMap((point, index) => layout.cards
    .filter(card => card.id !== segment.edge.from && card.id !== segment.edge.to && segmentCrossesCard(segment.points[index]!, point, card))
    .map(card => `${label.get(segment.edge.from)} -> ${label.get(segment.edge.to)} behind ${label.get(card.id)}`)));
  expect(behind).toEqual([]);
  expect(namesTooClose(routes.labels)).toEqual([]);
});

function segmentCrossesCard(a: { x: number; y: number }, b: { x: number; y: number }, card: { x: number; y: number; width: number; height: number }): boolean {
  for (let step = 1; step < 40; step++) {
    const t = step / 40, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x > card.x + 1 && x < card.x + card.width - 1 && y > card.y + 1 && y < card.y + card.height - 1) return true;
  }
  return false;
}

function namesTooClose(names: ReadonlyArray<{ text: string; at: { x: number; y: number } }>): string[] {
  const box = (name: { text: string; at: { x: number; y: number } }) => { const half = name.text.length * 6.2 / 2 + 3;
    return { left: name.at.x - half, right: name.at.x + half, top: name.at.y - 13, bottom: name.at.y + 3 }; };
  const close: string[] = [];
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
    const one = box(names[a]!), two = box(names[b]!);
    const apartX = Math.max(two.left - one.right, one.left - two.right), apartY = Math.max(two.top - one.bottom, one.top - two.bottom);
    if (apartX < 11.5 && apartY < 11.5) close.push(`${names[a]!.text} / ${names[b]!.text}`);
  }
  return close;
}

test("a line goes round a card it is not attached to by one corner; names stay 12 px apart", () => {
  const card = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 60 });
  const cards = new Map([card("fenel", 0, 0), card("fennels", 250, 0), card("rom", 500, 0), card("x", 250, 200)].map(c => [c.id, c] as const));
  const routes = linkedRoutes([{ from: "fenel", to: "rom", labels: ["Authors"] }, { from: "fenel", to: "x", labels: ["Logo Inspired By"] },
    { from: "x", to: "fennels", labels: ["Inspired By"] }], cards);
  const toRom = routes.segments.find(segment => segment.edge.to === "rom")!;
  expect(toRom.points.length).toBeGreaterThanOrEqual(3);
  for (let index = 1; index < toRom.points.length; index++) expect(segmentCrossesCard(toRom.points[index - 1]!, toRom.points[index]!, cards.get("fennels")!)).toBe(false);
  expect(namesTooClose(routes.labels)).toEqual([]);
});

test("a card that grows pushes only what it now overlaps; the others keep their places", () => {
  const settled = settleOverlaps([{ id: "a", x: 0, y: 0, width: 100, height: 200 }, { id: "b", x: 0, y: 150, width: 100, height: 60 },
    { id: "c", x: 400, y: 0, width: 100, height: 60 }]);
  expect(settled.find(card => card.id === "c")).toEqual({ id: "c", x: 400, y: 0, width: 100, height: 60 });
  const [a, b] = [settled[0]!, settled[1]!];
  expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(24);
});

test("a card holding a function by reference is titled with that function's shown name; a record titles itself", () => {
  const names: Record<string, { text: string; code: boolean }> = {
    "uuid-formula": { text: "Sports formula", code: false },
    "uuid-plain": { text: "plainFormula", code: true },
  };
  const name = (id: string) => names[id];
  // A function held as a value (a project's formula): its authored label, as the app names a function.
  expect(linkedCardTitle({ $ref: "uuid-formula" }, name)).toEqual({ text: "Sports formula", code: false });
  // No authored label: its code name, marked as code (shown in monospace).
  expect(linkedCardTitle({ $ref: "uuid-plain" }, name)).toEqual({ text: "plainFormula", code: true });
  // Nothing known for that function: no title (the card stays as it was).
  expect(linkedCardTitle({ $ref: "uuid-unknown" }, name)).toBeUndefined();
  // A record, a list or a scalar draws its own heading in its body: no second title.
  expect(linkedCardTitle({ $tag: "Project", name: "Primal Diet" }, name)).toBeUndefined();
  expect(linkedCardTitle({ $ref: "uuid-formula", extra: 1 }, name)).toBeUndefined();
  expect(linkedCardTitle([{ $ref: "uuid-formula" }], name)).toBeUndefined();
  expect(linkedCardTitle("text", name)).toBeUndefined();
});
