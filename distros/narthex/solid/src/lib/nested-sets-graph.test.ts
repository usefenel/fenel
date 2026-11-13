import { describe, expect, test } from "bun:test";
import { bracketEmphasis, cardWidthFor, crossSetTints, fitScale, nestedSetsGraph, nestedSetsGraphLayout, nestedSetsRepresentation, nestedSetsTreeLayout,
  nextDrawing, treeLevels, type SetGraph, type SetGraphNode } from "./nested-sets-graph";
import { speciesCountText, type FamilySet, type GenusSet, type NestedSetsModel, type SpeciesChip } from "./nested-sets-format";

const chip = (common: string | undefined, scientific: string): SpeciesChip => ({ common, scientific });
const fennel = chip("Fennel", "Foeniculum vulgare");
const giant = chip("Giant fennel", "Ferula communis");
const carrot = chip("Carrot", "Daucus carota");
const sunflower = chip("Sunflower", "Helianthus annuus");
const artichoke = chip("Jerusalem artichoke", "Helianthus tuberosus");
const genus = (name: string, species: SpeciesChip[], verdict: GenusSet["verdict"] = "true"): GenusSet =>
  ({ name, count: species.length, countText: speciesCountText(species.length), verdict, species });
const family = (name: string, commonName: string | undefined, genera: GenusSet[]): FamilySet => {
  const count = genera.reduce((sum, row) => sum + row.count, 0);
  return { name, commonName, count, countText: speciesCountText(count), genera, relations: [] };
};
const apiaceae = family("Apiaceae", "carrot family", [genus("Foeniculum", [fennel]), genus("Ferula", [giant]), genus("Daucus", [carrot])]);
const asteraceae = family("Asteraceae", "daisy family", [genus("Helianthus", [sunflower, artichoke])]);
const collection: Extract<NestedSetsModel, { kind: "collection" }> = {
  kind: "collection", coverage: "", families: [apiaceae, asteraceae],
  lifeForms: [
    { key: "PlantAnnual", title: "Annuals", count: 1, countText: speciesCountText(1), species: [sunflower] },
    { key: "PlantPerennial", title: "Perennials", count: 3, countText: speciesCountText(3), species: [fennel, giant, artichoke] },
  ],
  namedSets: [{ name: "Fennels", count: 2, countText: speciesCountText(2), species: [fennel, giant],
    answers: [{ taxon: "Apiaceae", family: undefined, verdict: "true", others: [carrot] },
      { taxon: "Foeniculum", family: "Apiaceae", verdict: "false", others: [] }] }],
};

/** Strict index reads (noUncheckedIndexedAccess): a missing value fails the test here. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}
const graphOf = (model: NestedSetsModel): SetGraph => nestedSetsGraph(model)!;
const ids = (graph: SetGraph, column: number) => graph.nodes.filter((node) => node.column === column).map((node) => node.id);
const edge = (graph: SetGraph, from: string, to: string) => graph.edges.find((row) => row.from === from && row.to === to);

describe("nestedSetsGraph: the same model as the boxes, as nodes and arrows", () => {
  test("species on the left, genera then cross-cutting sets in the middle, families on the right, in the model's order", () => {
    const graph = graphOf(collection);
    expect(ids(graph, 0)).toEqual(["species:Foeniculum vulgare", "species:Ferula communis", "species:Daucus carota",
      "species:Helianthus annuus", "species:Helianthus tuberosus"]);
    expect(ids(graph, 1)).toEqual(["genus:Apiaceae/Foeniculum", "genus:Apiaceae/Ferula", "genus:Apiaceae/Daucus",
      "genus:Asteraceae/Helianthus", "life-form:PlantAnnual", "life-form:PlantPerennial", "named:Fennels"]);
    expect(ids(graph, 2)).toEqual(["family:Apiaceae", "family:Asteraceae"]);
  });

  test("every species points into its genus and every genus into its family; tree arrows come first", () => {
    const graph = graphOf(collection);
    expect(edge(graph, "species:Helianthus tuberosus", "genus:Asteraceae/Helianthus")).toMatchObject({ relation: "subset", decided: "true", tree: true });
    expect(edge(graph, "genus:Asteraceae/Helianthus", "family:Asteraceae")).toMatchObject({ decided: "true", tree: true });
    const firstCross = graph.edges.findIndex((row) => !row.tree);
    expect(firstCross).toBeGreaterThan(0);
    expect(graph.edges.slice(firstCross).every((row) => !row.tree)).toBe(true);
  });

  test("a species has one more arrow for each set that cuts across families and holds it", () => {
    const graph = graphOf(collection);
    const out = graph.edges.filter((row) => row.from === "species:Foeniculum vulgare").map((row) => row.to);
    expect(out).toEqual(["genus:Apiaceae/Foeniculum", "life-form:PlantPerennial", "named:Fennels"]);
    expect(graph.edges.filter((row) => row.to === "life-form:PlantAnnual").map((row) => row.from)).toEqual(["species:Helianthus annuus"]);
  });

  test("a set by name points into a family it is decided within; a 'not within' answer draws nothing", () => {
    const graph = graphOf(collection);
    expect(edge(graph, "named:Fennels", "family:Apiaceae")).toMatchObject({ decided: "true", tree: false });
    expect(graph.edges.some((row) => row.from === "named:Fennels" && row.to.startsWith("genus:"))).toBe(false);
  });

  test("only a decided-true verdict is a solid arrow: undecided is marked undecided, false or absent draws nothing", () => {
    const undecided = family("Solanaceae", undefined, [genus("Solanum", [chip("Potato", "Solanum tuberosum")], "undecided"),
      genus("Datura", [chip("Thorn apple", "Datura stramonium")], "false"), { ...genus("Atropa", [chip(undefined, "Atropa belladonna")]), verdict: undefined }]);
    const graph = graphOf({ kind: "family", family: undecided });
    expect(edge(graph, "genus:Solanaceae/Solanum", "family:Solanaceae")).toMatchObject({ decided: "undecided" });
    expect(edge(graph, "genus:Solanaceae/Solanum", "family:Solanaceae")?.tooltip).toContain("not decided");
    expect(edge(graph, "genus:Solanaceae/Datura", "family:Solanaceae")).toBeUndefined();
    expect(edge(graph, "genus:Solanaceae/Atropa", "family:Solanaceae")).toBeUndefined();
    // Every node is still drawn.
    expect(ids(graph, 1)).toEqual(["genus:Solanaceae/Solanum", "genus:Solanaceae/Datura", "genus:Solanaceae/Atropa"]);
    // An undecided set-by-name answer is an undecided arrow too.
    const named = graphOf({ ...collection, namedSets: [{ name: "Fennels", count: 1, countText: "1 species", species: [fennel],
      answers: [{ taxon: "Apiaceae", family: undefined, verdict: "undecided", others: [] }] }] });
    expect(edge(named, "named:Fennels", "family:Apiaceae")).toMatchObject({ decided: "undecided" });
  });

  test("card texts: species common name over its italic scientific name; genus italic with its count; family with its common name and count", () => {
    const graph = graphOf(collection);
    const node = (id: string) => graph.nodes.find((row) => row.id === id);
    expect(node("species:Foeniculum vulgare")).toMatchObject({ kind: "species", title: "Fennel", detail: "Foeniculum vulgare", titleItalic: false, detailItalic: true });
    expect(node("genus:Asteraceae/Helianthus")).toMatchObject({ kind: "genus", title: "Helianthus", detail: "2 species", titleItalic: true, detailItalic: false });
    expect(node("family:Apiaceae")).toMatchObject({ kind: "family", title: "Apiaceae", detail: "carrot family · 3 species" });
    expect(node("life-form:PlantPerennial")).toMatchObject({ kind: "life-form", title: "Perennials", detail: "3 species" });
    expect(node("named:Fennels")).toMatchObject({ kind: "named-set", title: "Fennels", detail: "2 species" });
    // A species without a common name shows its scientific name, in italics.
    const bare = graphOf({ kind: "family", family: family("Solanaceae", undefined, [genus("Atropa", [chip(undefined, "Atropa belladonna")])]) });
    expect(bare.nodes[0]).toMatchObject({ title: "Atropa belladonna", titleItalic: true, detail: undefined });
  });

  test("a species carrying a picture keeps it for its card", () => {
    const picture = { width: 1, height: 1, pixels: [{ r: 0, g: 0, b: 0, a: 255 }] } as unknown as NonNullable<SpeciesChip["picture"]>;
    const graph = graphOf({ kind: "family", family: family("Apiaceae", undefined, [genus("Foeniculum", [{ ...fennel, picture }])]) });
    expect(graph.nodes[0]!.picture).toBe(picture);
  });

  test("an undecided collection selection has no graph", () => {
    expect(nestedSetsGraph({ kind: "collection", coverage: "", families: undefined })).toBeUndefined();
  });
});

describe("nestedSetsGraphLayout: one column per kind, every node drawn, natural size", () => {
  test("columns read left to right; nothing is folded", () => {
    const graph = graphOf(collection);
    const layout = nestedSetsGraphLayout(graph, { width: 0 });
    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.more).toEqual([]);
    const x = (id: string) => layout.nodes.find((node) => node.id === id)!.x;
    expect(x("species:Foeniculum vulgare")).toBeLessThan(x("genus:Apiaceae/Foeniculum"));
    expect(x("genus:Apiaceae/Foeniculum")).toBe(x("named:Fennels"));
    expect(x("genus:Apiaceae/Foeniculum")).toBeLessThan(x("family:Apiaceae"));
    expect(layout.edges).toHaveLength(graph.edges.length);
    expect(layout.width).toBeGreaterThan(3 * 150);
  });

  test("a genus sits beside its species and a family beside its genera, so the tree's arrows never cross", () => {
    const graph = graphOf(collection);
    const layout = nestedSetsGraphLayout(graph, { width: 0 });
    const card = (id: string) => must(layout.nodes.find((node) => node.id === id));
    const centre = (id: string) => card(id).y + card(id).height / 2;
    // One species, one genus: level with it.
    expect(centre("genus:Apiaceae/Ferula")).toBe(centre("species:Ferula communis"));
    // Two species: between them.
    expect(centre("genus:Asteraceae/Helianthus")).toBe((centre("species:Helianthus annuus") + centre("species:Helianthus tuberosus")) / 2);
    // Each column keeps the model's order from top to bottom, cards never overlap.
    for (const column of [0, 1, 2]) {
      const cards = layout.nodes.filter((node) => node.column === column);
      cards.slice(1).forEach((node, index) => expect(node.y).toBeGreaterThanOrEqual(cards[index]!.y + cards[index]!.height));
    }
    // The cross-cutting sets sit under the genera.
    expect(card("life-form:PlantAnnual").y).toBeGreaterThan(card("genus:Asteraceae/Helianthus").y);
    // Tree arrows: the order of their sources matches the order of their targets.
    const tree = graph.edges.filter((row) => row.tree);
    for (const a of tree) for (const b of tree) {
      if (graph.nodes.find((n) => n.id === a.from)!.column !== graph.nodes.find((n) => n.id === b.from)!.column) continue;
      if (card(a.from).y < card(b.from).y) expect(card(a.to).y).toBeLessThanOrEqual(card(b.to).y);
    }
  });

  test("tree arrows are drawn first, cross-cutting arrows after them (above)", () => {
    const graph = graphOf(collection);
    const layout = nestedSetsGraphLayout(graph, { width: 0 });
    const kinds = layout.edges.map((row) => graph.edges[row.edgeIndex]!.tree);
    expect(kinds.indexOf(false)).toBeGreaterThan(0);
    expect(kinds.slice(kinds.indexOf(false)).includes(true)).toBe(false);
  });

  test("a wide container centres the drawing; a narrow one keeps its natural width (it scrolls)", () => {
    const graph = graphOf(collection);
    const natural = nestedSetsGraphLayout(graph, { width: 0 });
    const narrow = nestedSetsGraphLayout(graph, { width: 390 });
    expect(narrow.width).toBe(natural.width);
    const wide = nestedSetsGraphLayout(graph, { width: natural.width + 400 });
    expect(wide.width).toBe(natural.width + 400);
    expect(wide.nodes[0]!.x).toBe(natural.nodes[0]!.x + 200);
  });
});

describe("nestedSetsRepresentation: the reader's choice between the two drawings", () => {
  test("boxes by default; graph only when chosen and drawable", () => {
    expect(nestedSetsRepresentation(undefined, true)).toBe("boxes");
    expect(nestedSetsRepresentation("graph", true)).toBe("graph");
    expect(nestedSetsRepresentation("graph", false)).toBe("boxes");
    expect(nestedSetsRepresentation("boxes", true)).toBe("boxes");
  });
});

// Round 2: the same graph top to bottom ("Tree"), fit-to-width, tints.
const node = (id: string, kind: SetGraphNode["kind"], holders: string[], across = false): SetGraphNode =>
  ({ id, kind, column: 0, title: id, detail: undefined, titleItalic: false, detailItalic: false, label: id, holders, across });
// A deeper classification than the model has today: a root, two kingdoms, then families, genera, species.
const deep: SetGraph = {
  nodes: [
    node("life", "taxon", []), node("plantae", "taxon", ["life"]), node("animalia", "taxon", ["life"]),
    node("apiaceae", "family", ["plantae"]), node("felidae", "family", ["animalia"]),
    node("foeniculum", "genus", ["apiaceae"]), node("felis", "genus", ["felidae"]),
    node("fennel", "species", ["foeniculum"]), node("cat", "species", ["felis"]),
    node("perennials", "life-form", [], true),
  ],
  edges: [
    { from: "fennel", to: "foeniculum", relation: "subset", decided: "true", tree: true },
    { from: "cat", to: "felis", relation: "subset", decided: "true", tree: true },
    { from: "foeniculum", to: "apiaceae", relation: "subset", decided: "true", tree: true },
    { from: "felis", to: "felidae", relation: "subset", decided: "undecided", tree: true, tooltip: "felis is within felidae: not decided" },
    { from: "apiaceae", to: "plantae", relation: "subset", decided: "true", tree: true },
    { from: "felidae", to: "animalia", relation: "subset", decided: "true", tree: true },
    { from: "plantae", to: "life", relation: "subset", decided: "true", tree: true },
    { from: "fennel", to: "perennials", relation: "subset", decided: "true", tree: false },
  ],
};

describe("treeLevels: rows by height above the species, for any depth", () => {
  test("a root and two extra levels above the families become higher rows; the cross-cutting sets a row under the species", () => {
    const levels = treeLevels(deep);
    expect(Object.fromEntries(levels)).toEqual({ life: 0, plantae: 1, animalia: 1, apiaceae: 2, felidae: 2,
      foeniculum: 3, felis: 3, fennel: 4, cat: 4, perennials: 5 });
  });

  test("the model's three ranks: families on top, then genera, species, then the sets that cut across", () => {
    const levels = treeLevels(graphOf(collection));
    expect(levels.get("family:Apiaceae")).toBe(0);
    expect(levels.get("genus:Asteraceae/Helianthus")).toBe(1);
    expect(levels.get("species:Helianthus annuus")).toBe(2);
    expect(levels.get("life-form:PlantAnnual")).toBe(3);
    expect(levels.get("named:Fennels")).toBe(3);
  });

  test("a set whose subset verdict is false still sits above its members (the row is structure, the arrow is the judgment)", () => {
    const graph = graphOf({ kind: "family", family: family("Solanaceae", undefined, [genus("Datura", [chip("Thorn apple", "Datura stramonium")], "false")]) });
    expect(Object.fromEntries(treeLevels(graph))).toEqual({ "family:Solanaceae": 0, "genus:Solanaceae/Datura": 1, "species:Datura stramonium": 2 });
    expect(nestedSetsTreeLayout(graph).brackets.some((row) => row.parent === "family:Solanaceae")).toBe(false);
  });
});

describe("nestedSetsTreeLayout: top to bottom", () => {
  test("rows go down by level; species are compact tiles; each set is centred over its members", () => {
    const layout = nestedSetsTreeLayout(deep);
    const card = (id: string) => must(layout.nodes.find((row) => row.id === id));
    const order = ["life", "plantae", "apiaceae", "foeniculum", "fennel", "perennials"];
    order.slice(1).forEach((id, index) => expect(card(id).y).toBeGreaterThan(card(must(order[index])).y + card(must(order[index])).height));
    expect(card("plantae").y).toBe(card("animalia").y);
    expect(card("fennel").width).toBe(112);
    expect(card("fennel").height).toBeGreaterThan(card("foeniculum").height);
    const centre = (id: string) => card(id).x + card(id).width / 2;
    expect(centre("foeniculum")).toBe(centre("fennel"));
    expect(centre("life")).toBe((centre("plantae") + centre("animalia")) / 2);
  });

  test("tree arrows keep the model's order: no two cross", () => {
    const graph = graphOf(collection);
    const layout = nestedSetsTreeLayout(graph);
    const card = (id: string) => must(layout.nodes.find((row) => row.id === id));
    const tree = graph.edges.filter((row) => row.tree);
    for (const a of tree) for (const b of tree) {
      if (card(a.from).y !== card(b.from).y) continue;
      if (card(a.from).x < card(b.from).x) expect(card(a.to).x).toBeLessThanOrEqual(card(b.to).x);
    }
  });
});

// Round 3: one bracket per parent (trunk, bus, one vertical per child).
describe("tree brackets: the classification", () => {
  // Apiaceae with its six genera of the demo, one species each.
  const six = ["Foeniculum", "Ferula", "Daucus", "Apium", "Coriandrum", "Anethum"];
  const apiaceaeSix = family("Apiaceae", "carrot family", six.map((name) => genus(name, [chip(name, `${name} species`)])));
  const layout = nestedSetsTreeLayout(graphOf({ ...collection, families: [apiaceaeSix, asteraceae] }));
  const card = (id: string) => must(layout.nodes.find((row) => row.id === id));
  const bracketOf = (parent: string) => must(layout.brackets.find((row) => row.parent === parent));
  const centreX = (id: string) => card(id).x + card(id).width / 2;

  test("six children: one trunk from the middle of the parent's bottom edge, a bus midway, one vertical from the middle of each child's top edge", () => {
    const bracket = bracketOf("family:Apiaceae");
    const parent = card("family:Apiaceae");
    const children = six.map((name) => card(`genus:Apiaceae/${name}`));
    const busY = (parent.y + parent.height + must(children[0]).y) / 2;
    expect(bracket.trunk).toEqual([{ x: centreX("family:Apiaceae"), y: busY }, { x: centreX("family:Apiaceae"), y: parent.y + parent.height }]);
    expect(bracket.connectors.map((row) => row.child)).toEqual(children.map((child) => child.id));
    bracket.connectors.forEach((connector, index) => {
      const child = must(children[index]);
      const [first, second] = [must(connector.points[0]), must(connector.points[1])];
      expect(first).toEqual({ x: child.x + child.width / 2, y: child.y });
      expect(second).toEqual({ x: child.x + child.width / 2, y: busY });
      // Along the bus to the trunk: the bus is the union of these stretches.
      expect(must(connector.points[connector.points.length - 1])).toEqual({ x: centreX("family:Apiaceae"), y: busY });
    });
  });

  test("children wider than their parent on both sides: the bus spans from the leftmost to the rightmost child", () => {
    const parent = card("family:Apiaceae");
    const xs = bracketOf("family:Apiaceae").connectors.map((row) => must(row.points[0]).x);
    expect(Math.min(...xs)).toBeLessThan(parent.x);
    expect(Math.max(...xs)).toBeGreaterThan(parent.x + parent.width);
  });

  test("one child: a straight line under its parent", () => {
    const bracket = bracketOf("genus:Apiaceae/Foeniculum");
    expect(bracket.connectors).toHaveLength(1);
    const xs = new Set([...must(bracket.connectors[0]).points, ...bracket.trunk].map((point) => point.x));
    expect(xs.size).toBe(1);
  });

  test("one arrowhead per bracket: one bracket per parent, its trunk a single upright segment into the parent", () => {
    const parents = layout.brackets.map((row) => row.parent);
    expect(new Set(parents).size).toBe(parents.length);
    expect(parents.filter((id) => id.startsWith("family:"))).toEqual(["family:Apiaceae", "family:Asteraceae"]);
  });

  test("nothing enters a card from the side: every trunk ends upright on its parent, every vertical leaves its child upright", () => {
    for (const bracket of nestedSetsTreeLayout(graphOf(collection)).brackets) {
      const [from, tip] = [must(bracket.trunk[0]), must(bracket.trunk[1])];
      expect(from.x).toBe(tip.x);
      for (const connector of bracket.connectors) expect(must(connector.points[1]).x).toBe(must(connector.points[0]).x);
    }
  });

  test("a set by name is never bracketed into a family in the tree (its arrow would cross the classification)", () => {
    expect(bracketOf("family:Apiaceae").connectors.some((row) => row.child === "named:Fennels")).toBe(false);
  });
});

describe("tree brackets: decided, undecided, false", () => {
  test("an undecided child's vertical is dashed, a false one is absent, the bus and trunk stay for the true ones", () => {
    const solanaceae = family("Solanaceae", undefined, [genus("Solanum", [chip("Potato", "Solanum tuberosum")], "undecided"),
      genus("Datura", [chip("Thorn apple", "Datura stramonium")], "true"), genus("Atropa", [chip(undefined, "Atropa belladonna")], "false")]);
    const layout = nestedSetsTreeLayout(graphOf({ kind: "family", family: solanaceae }));
    const bracket = must(layout.brackets.find((row) => row.parent === "family:Solanaceae"));
    expect(bracket.connectors.map((row) => [row.child, row.undecided])).toEqual([
      ["genus:Solanaceae/Solanum", true], ["genus:Solanaceae/Datura", false]]);
    expect(must(bracket.connectors[0]).tooltip).toContain("not decided");
  });

  test("no child decided true: no bus and no trunk", () => {
    const layout = nestedSetsTreeLayout(deep);
    expect(layout.brackets.some((row) => row.parent === "felidae")).toBe(false);
    // animalia ⊆ life is not in the data (false): life's bracket holds plantae only.
    expect(must(layout.brackets.find((row) => row.parent === "life")).connectors.map((row) => row.child)).toEqual(["plantae"]);
  });
});

describe("tree brackets: the sets that cut across, mirrored under the species", () => {
  const graph = graphOf(collection);
  const layout = nestedSetsTreeLayout(graph);
  const card = (id: string) => must(layout.nodes.find((row) => row.id === id));
  const across = layout.brackets.filter((row) => row.across);

  test("one bracket per set, its trunk leaving the set's top edge upright, its head on the set", () => {
    expect(across.map((row) => row.parent)).toEqual(["life-form:PlantAnnual", "life-form:PlantPerennial", "named:Fennels"]);
    for (const bracket of across) {
      const set = card(bracket.parent);
      expect(must(bracket.trunk[1])).toEqual({ x: set.x + set.width / 2, y: set.y });
      expect(must(bracket.trunk[0]).x).toBe(set.x + set.width / 2);
      expect(must(bracket.trunk[0]).y).toBeLessThan(set.y);
    }
  });

  test("their buses sit at distinct heights between the species and the sets, in the sets' order", () => {
    const species = card("species:Foeniculum vulgare");
    const buses = across.map((row) => must(row.trunk[0]).y);
    buses.slice(1).forEach((y, index) => expect(y).toBeGreaterThan(must(buses[index])));
    for (const y of buses) {
      expect(y).toBeGreaterThan(species.y + species.height);
      expect(y).toBeLessThan(card("life-form:PlantAnnual").y);
    }
  });

  test("drops under one tile do not overlap and stay centred under it; each leaves the tile's bottom edge upright", () => {
    const tile = card("species:Foeniculum vulgare");
    const drops = across.flatMap((row) => row.connectors.filter((connector) => connector.child === tile.id));
    expect(drops).toHaveLength(2);
    const xs = drops.map((row) => must(row.points[0]).x);
    expect(new Set(xs).size).toBe(2);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(tile.x + tile.width / 2);
    for (const drop of drops) {
      expect(must(drop.points[0]).y).toBe(tile.y + tile.height);
      expect(must(drop.points[1]).x).toBe(must(drop.points[0]).x);
    }
  });
});

describe("bracketEmphasis: pointing at a card", () => {
  const layout = nestedSetsTreeLayout(graphOf(collection));
  const bracket = must(layout.brackets.find((row) => row.parent === "family:Apiaceae"));

  test("nothing pointed at: nothing changes", () => {
    expect(bracketEmphasis(bracket, undefined)).toEqual({ trunk: undefined, connectors: bracket.connectors.map(() => undefined) });
  });

  test("a child: its vertical, its stretch of bus and the trunk light up; its siblings dim", () => {
    const emphasis = bracketEmphasis(bracket, "genus:Apiaceae/Daucus");
    expect(emphasis.trunk).toBe("lit");
    expect(emphasis.connectors).toEqual(bracket.connectors.map((row) => row.child === "genus:Apiaceae/Daucus" ? "lit" : "dim"));
  });

  test("the parent lights its whole bracket; any other card dims it", () => {
    expect(bracketEmphasis(bracket, "family:Apiaceae")).toEqual({ trunk: "lit", connectors: bracket.connectors.map(() => "lit") });
    expect(bracketEmphasis(bracket, "family:Solanaceae")).toEqual({ trunk: "dim", connectors: bracket.connectors.map(() => "dim") });
  });
});

describe("the left-to-right graph: no turn right before an arrowhead", () => {
  test("every arrow's last segment is horizontal and at least 14 px long", () => {
    const layout = nestedSetsGraphLayout(graphOf(collection), { width: 0 });
    for (const edge of layout.edges) {
      const tip = must(edge.points[edge.points.length - 1]), before = must(edge.points[edge.points.length - 2]);
      expect(tip.y).toBe(before.y);
      expect(Math.abs(tip.x - before.x)).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("card width, fit scale, tints and the drawing cycle", () => {
  test("a family card is wide enough for its longest line, within a maximum", () => {
    const solanaceae = node("family:Solanaceae", "family", []);
    expect(cardWidthFor({ ...solanaceae, title: "Solanaceae", detail: "nightshade family · 3 species" })).toBeGreaterThanOrEqual(220);
    expect(cardWidthFor({ ...solanaceae, detail: "x".repeat(200) })).toBe(300);
    expect(cardWidthFor({ ...solanaceae, title: "A", detail: "1 species" })).toBe(150);
  });

  test("fit scale: never above 1, the card's width over the drawing's", () => {
    expect(fitScale(2000, 1000)).toBe(0.5);
    expect(fitScale(800, 1000)).toBe(1);
    expect(fitScale(800, 0)).toBe(1);
  });

  test("each cross-cutting set gets its own tint, by set order, stable across redraws", () => {
    const tints = crossSetTints(graphOf(collection));
    expect([...tints.entries()]).toEqual([["life-form:PlantAnnual", 0], ["life-form:PlantPerennial", 1], ["named:Fennels", 2]]);
    expect(crossSetTints(graphOf(collection))).toEqual(tints);
    expect(tints.has("genus:Apiaceae/Foeniculum")).toBe(false);
  });

  test("the switch cycles Boxes, Tree, Graph; the tree is the one after the boxes", () => {
    expect(nextDrawing("boxes")).toBe("tree");
    expect(nextDrawing("tree")).toBe("graph");
    expect(nextDrawing("graph")).toBe("boxes");
    expect(nestedSetsRepresentation("tree", true)).toBe("tree");
    expect(nestedSetsRepresentation("tree", false)).toBe("boxes");
  });
});
