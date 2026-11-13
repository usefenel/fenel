import { describe, expect, test } from "bun:test";
import fixture from "./nested-sets-classification.fixture.json";
import { classificationBoxes, classificationChildren, classificationGraph, classificationInlineText, classificationRoots, crossAnswersToWrite, crossAnswerText,
  partsNotes, readClassification, type ClassificationModel } from "./nested-sets-classification";
import { readNestedSets } from "./nested-sets-format";
import { nestedSetsGraphLayout, nestedSetsTreeLayout, treeLevels } from "./nested-sets-graph";

// Real values (fixture note): the tree of life (99 sets, the fennels), its 63
// leaves, and the foods by kind (83 sets), from the pending Fenel patch.
const life = fixture.life as unknown;
const foods = fixture.foods as unknown;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const just = (value: unknown) => ({ $tag: "Just", _0: value });
const nothing = { $tag: "Nothing" };

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}
const model = (value: unknown): ClassificationModel => must(readClassification(value));
const set = (read: ClassificationModel, key: string) => must(read.sets.find((row) => row.key === key));
/** The tree of life with one set's raw record changed. */
function lifeWith(key: string, change: (row: Record<string, unknown>) => void): unknown {
  const copy = clone(life) as { sets: Array<Record<string, unknown> & { item: { $tag: string } }> };
  change(must(copy.sets.find((row) => row.item.$tag === key)));
  return copy;
}

describe("readClassification: the contract's fields of a LifeClassification / FoodClassification", () => {
  test("the tree of life: every set, its names, rank, leaves, parents and the fennels", () => {
    const read = model(life);
    expect(read.kind).toBe("classification");
    expect(read.coverage).toBe("These sets contain the living things described in this collection. Other species are not listed here.");
    expect(read.sets).toHaveLength(99);
    expect(read.sets.filter((row) => row.leaf)).toHaveLength(63);
    const tomato = set(read, "SolanumLycopersicum");
    expect(tomato).toMatchObject({ item: { $tag: "SolanumLycopersicum" }, name: "Tomato", scientificName: "Solanum lycopersicum",
      rank: "RankSpecies", leaf: true, parents: [{ whole: "Solanaceae", verdict: "true" }], members: ["SolanumLycopersicum"],
      parts: undefined, link: { relation: "gives", items: [{ $tag: "TomatoFood" }] } });
    const root = set(read, "AllLife");
    expect(root).toMatchObject({ name: "All life", scientificName: undefined, leaf: false, parents: [], count: 63, countText: "63 species", parts: undefined, link: undefined });
    expect(set(read, "Solanaceae")).toMatchObject({ name: "Nightshade family", scientificName: "Solanaceae", parts: { apart: "true", cover: "true" }, countText: "6 species" });
    expect(read.crossSets.map((row) => [row.name, row.count, row.answers.map((answer) => [answer.whole, answer.verdict])])).toEqual([
      ["Fennels", 2, [["Plantae", "true"], ["Magnoliopsida", "true"], ["Apiaceae", "true"]]],
    ]);
  });

  test("the foods: a food comes from a living thing, a kind from none, and there is no crossSets field", () => {
    const read = model(foods);
    expect(read.sets).toHaveLength(83);
    expect(read.crossSets).toEqual([]);
    expect(set(read, "TomatoFood")).toMatchObject({ name: "Tomato", scientificName: undefined, leaf: true, rank: "FoodRankFood",
      link: { relation: "comes-from", items: [{ $tag: "SolanumLycopersicum" }] } });
    expect(set(read, "AllFoods")).toMatchObject({ leaf: false, link: undefined, countText: "70 foods", parents: [] });
    expect(set(read, "Fruits")).toMatchObject({ countText: "16 foods", parts: { apart: "true", cover: "true" } });
  });

  test("never reads constraint or source: removing them changes nothing", () => {
    const stripped = clone(life) as { sets: Array<Record<string, unknown>>; crossSets: Array<Record<string, unknown>> };
    for (const row of stripped.sets) { delete row.constraint; delete row.source; }
    for (const row of stripped.crossSets) { delete row.constraint; delete row.meaning; }
    expect(readClassification(stripped)).toEqual(readClassification(life));
  });

  test("the old species sets and a classification do not read as each other", () => {
    expect(readNestedSets(life)).toBeUndefined();
    expect(readNestedSets(foods)).toBeUndefined();
    expect(readClassification({ coverage: "x", families: nothing })).toBeUndefined();
    expect(readClassification({ coverage: "x", sets: [] })).toBeUndefined();
    // An unknown verdict shape is not a judgment this reader knows.
    expect(readClassification(lifeWith("Solanaceae", (row) => { row.parents = [{ whole: { $tag: "Magnoliopsida" }, within: just("yes") }]; }))).toBeUndefined();
  });

  test("parts = Nothing is 'not asked' (no words); only an answer the drawing would get wrong is written", () => {
    const read = model(life);
    expect(set(read, "Plantae").parts).toBeUndefined();
    expect(partsNotes(set(read, "Plantae"))).toEqual([]);
    expect(partsNotes(set(read, "Solanaceae"))).toEqual([]);
    const undecided = model(lifeWith("Solanaceae", (row) => { row.parts = just({ $tag: "LifeSetPartition", apart: nothing, cover: just(false) }); }));
    expect(partsNotes(set(undecided, "Solanaceae"))).toEqual(["Whether these sets are apart: not decided", "Together they do not fill Nightshade family"]);
  });
});

describe("nesting only where within = Just true", () => {
  test("every shipped inclusion nests: one root, kingdoms under it, salmon's family straight under the animals", () => {
    const read = model(life);
    expect(classificationRoots(read).map((row) => row.key)).toEqual(["AllLife"]);
    const children = classificationChildren(read);
    expect(must(children.get("AllLife")).map((row) => row.key)).toEqual(["Plantae", "Fungi", "Animalia"]);
    expect(must(children.get("Animalia")).map((row) => row.key)).toContain("Salmonidae");
    expect(classificationInlineText(read)).toBe("All life ⊇ Plants, Fungi, Animals");
  });

  test("a parent decided false or not decided is written out, never drawn as nesting or as an arrow", () => {
    for (const [within, words] of [[just(false), "Not within"], [nothing, "not decided"]] as const) {
      const read = model(lifeWith("Solanaceae", (row) => { row.parents = [{ $tag: "LifeSetInclusion", whole: { $tag: "Magnoliopsida" }, within }]; }));
      expect(classificationRoots(read).map((row) => row.key)).toEqual(["AllLife", "Solanaceae"]);
      const graph = classificationGraph(read);
      expect(graph.edges.some((edge) => edge.from === "set:Solanaceae")).toBe(false);
      expect(graph.edges.every((edge) => edge.decided === "true")).toBe(true);
      const node = must(graph.nodes.find((row) => row.id === "set:Solanaceae"));
      expect(node.holders).toEqual([]);
      expect(node.detail).toContain(words);
      const boxes = classificationBoxes(read);
      expect(boxes.map((box) => box.set.key)).toEqual(["AllLife", "Solanaceae"]);
      expect(must(boxes[1]).notes.join(" ")).toContain(words);
    }
  });

  test("a set that cuts across writes its smallest whole and every answer not decided true", () => {
    const read = model(life);
    expect(crossAnswersToWrite(read, must(read.crossSets[0])).map((answer) => answer.whole)).toEqual(["Apiaceae"]);
    const copy = clone(life) as { crossSets: Array<{ answers: Array<{ within: unknown }> }> };
    must(must(copy.crossSets[0]).answers[0]).within = nothing;
    const changed = model(copy);
    expect(crossAnswersToWrite(changed, must(changed.crossSets[0])).map((answer) => [answer.whole, answer.verdict]))
      .toEqual([["Plantae", "undecided"], ["Apiaceae", "true"]]);
  });

  test("a set that cuts across answers in words", () => {
    const read = model(life);
    const fennels = must(read.crossSets[0]);
    expect(fennels.answers.map((answer) => crossAnswerText(read, answer))).toEqual(["Within Plants", "Within Magnoliopsida", "Within Carrot family"]
      .map((text) => text.replace("Magnoliopsida", set(read, "Magnoliopsida").name)));
  });
});

describe("classificationGraph: the same Tree and Graph drawings, at any depth", () => {
  test("a node per set and per set that cuts across; columns are heights above the leaves", () => {
    const graph = classificationGraph(model(life));
    expect(graph.nodes).toHaveLength(100);
    const column = (id: string) => must(graph.nodes.find((node) => node.id === id)).column;
    expect([column("set:SolanumLycopersicum"), column("set:Solanaceae"), column("set:Magnoliopsida"), column("set:Plantae"), column("set:AllLife")])
      .toEqual([0, 1, 2, 3, 4]);
    expect([column("set:SalmoSalar"), column("set:Salmonidae"), column("set:Animalia"), column("cross:Fennels")]).toEqual([0, 1, 3, 1]);
    const tomato = must(graph.nodes.find((node) => node.id === "set:SolanumLycopersicum"));
    expect(tomato).toMatchObject({ kind: "species", title: "Tomato", detail: "Solanum lycopersicum", detailItalic: true,
      item: { $tag: "SolanumLycopersicum" }, link: { relation: "gives", items: [{ $tag: "TomatoFood" }] }, holders: ["set:Solanaceae"] });
    const family = must(graph.nodes.find((node) => node.id === "set:Solanaceae"));
    expect(family).toMatchObject({ kind: "taxon", title: "Nightshade family", detail: "Solanaceae · 6 species", detailItalic: false, item: { $tag: "Solanaceae" } });
    expect(must(graph.nodes.find((node) => node.id === "set:AllLife"))).toMatchObject({ title: "All life", detail: "63 species", holders: [] });
  });

  test("an arrow per inclusion decided true, the fennels' members into it, and the fennels into their smallest whole", () => {
    const graph = classificationGraph(model(life));
    const has = (from: string, to: string, tree: boolean) => graph.edges.some((edge) => edge.from === from && edge.to === to && edge.tree === tree);
    expect(graph.edges.filter((edge) => edge.tree)).toHaveLength(98);
    expect(has("set:SolanumLycopersicum", "set:Solanaceae", true)).toBe(true);
    expect(has("set:Salmonidae", "set:Animalia", true)).toBe(true);
    expect(has("set:FoeniculumVulgare", "cross:Fennels", false)).toBe(true);
    expect(has("set:FerulaCommunis", "cross:Fennels", false)).toBe(true);
    expect(has("cross:Fennels", "set:Apiaceae", false)).toBe(true);
    expect(graph.edges.filter((edge) => edge.from === "cross:Fennels")).toHaveLength(1);
  });

  test("the tree: All life on top, then kingdoms, classes, families, every leaf in the bottom row, the fennels under them", () => {
    const graph = classificationGraph(model(life));
    const levels = treeLevels(graph);
    expect(["set:AllLife", "set:Plantae", "set:Magnoliopsida", "set:Solanaceae", "set:SolanumLycopersicum", "cross:Fennels"].map((id) => levels.get(id)))
      .toEqual([0, 1, 2, 3, 4, 5]);
    expect(levels.get("set:Salmonidae")).toBe(3);
    const layout = nestedSetsTreeLayout(graph);
    const bottom = layout.nodes.filter((node) => node.level === 4 && !node.across);
    expect(bottom).toHaveLength(63);
    // One bracket per set that holds others, plus the fennels'.
    expect(layout.brackets.filter((bracket) => !bracket.across)).toHaveLength(36);
    expect(layout.brackets.filter((bracket) => bracket.across).map((bracket) => bracket.parent)).toEqual(["cross:Fennels"]);
    // Too wide for one row of 63 tiles: it wraps (nested-sets-tree-wrap.test.ts).
    expect(layout.width).toBeLessThan(63 * 112);
  });

  test("the graph lays out every node and routes every arrow, the long ones too", () => {
    const graph = classificationGraph(model(life));
    const layout = nestedSetsGraphLayout(graph, { width: 0 });
    expect(layout.nodes).toHaveLength(100);
    expect(layout.edges).toHaveLength(graph.edges.length);
    const salmonidae = must(layout.nodes.find((node) => node.id === "set:Salmonidae"));
    const animalia = must(layout.nodes.find((node) => node.id === "set:Animalia"));
    expect(animalia.x).toBeGreaterThan(salmonidae.x + salmonidae.width);
  });

  test("the foods: three rows, every food under its kind", () => {
    const graph = classificationGraph(model(foods));
    const levels = treeLevels(graph);
    expect([levels.get("set:AllFoods"), levels.get("set:Fruits"), levels.get("set:TomatoFood")]).toEqual([0, 1, 2]);
    expect(graph.edges.filter((edge) => edge.tree)).toHaveLength(82);
    expect(must(graph.nodes.find((node) => node.id === "set:TomatoFood"))).toMatchObject({ title: "Tomato", detail: undefined,
      link: { relation: "comes-from", items: [{ $tag: "SolanumLycopersicum" }] } });
  });
});

describe("classificationBoxes: boxes inside boxes, leaves as chips", () => {
  test("All life holds the kingdoms; a family holds its species; no words where everything is decided true", () => {
    const boxes = classificationBoxes(model(life));
    expect(boxes.map((box) => box.set.key)).toEqual(["AllLife"]);
    const root = must(boxes[0]);
    expect(root.boxes.map((box) => box.set.name)).toEqual(["Plants", "Fungi", "Animals"]);
    const find = (box: typeof root, key: string): typeof root | undefined =>
      box.set.key === key ? box : box.boxes.map((inner) => find(inner, key)).find((hit) => hit !== undefined);
    expect(must(find(root, "Solanaceae")).leaves.map((leaf) => leaf.name)).toEqual(["Potato", "Cutleaf nightshade", "Thorn apple", "Tomato", "Aubergine", "Sweet pepper"]);
    expect(must(find(root, "Animalia")).boxes.map((box) => box.set.key)).toContain("Salmonidae");
    const notes = (box: typeof root): string[] => [...box.notes, ...box.boxes.flatMap(notes)];
    expect(notes(root)).toEqual([]);
  });

  test("the leaves item is the tile grid's list: 63 bare constructors, the tree's leaves", () => {
    const leaves = fixture.leaves as Array<Record<string, unknown>>;
    expect(leaves).toHaveLength(63);
    expect(leaves.every((leaf) => Object.keys(leaf).length === 1 && typeof leaf.$tag === "string")).toBe(true);
    const read = model(life);
    expect(leaves.map((leaf) => leaf.$tag)).toEqual(read.sets.filter((row) => row.leaf).map((row) => row.key));
  });
});
