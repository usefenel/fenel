import { expect, test } from "bun:test";
import { dependencyGraphCentre, dependencyGraphNested } from "./dependency-graph-centre";

const graph = { focus: "people-and-projects", nodes: [{ id: "people-and-projects" }, { id: "showcase-rom" }, { id: "showcase-fenel" }] };

test("a nested value centres the first of its identities that is a node of its card's graph", () => {
  expect(dependencyGraphCentre(graph, ["not-drawn", "showcase-fenel", "showcase-rom"])).toBe("showcase-fenel");
});

test("without a drawn identity the card keeps its own focus", () => {
  expect(dependencyGraphCentre(graph, ["not-drawn"])).toBe("people-and-projects");
  expect(dependencyGraphCentre(graph, [])).toBe("people-and-projects");
  expect(dependencyGraphCentre(graph, undefined)).toBe("people-and-projects");
});

test("a nested value made of several identities shows only those parts and its card", () => {
  const card = { focus: "demo", nodes: [{ id: "demo" }, { id: "rom" }, { id: "bayne" }, { id: "plant" }, { id: "other" }],
    edges: [{ from: "rom", to: "demo" }, { from: "bayne", to: "demo" }, { from: "plant", to: "demo" }, { from: "other", to: "plant" }] };
  const shown = dependencyGraphNested(card, ["rom", "bayne", "not-drawn"]);
  expect(shown.focus).toBe("demo");
  expect(shown.nodes.map(node => node.id)).toEqual(["demo", "rom", "bayne"]);
  expect(shown.edges).toEqual([{ from: "rom", to: "demo" }, { from: "bayne", to: "demo" }]);
});

test("a nested value made of one identity centres it with its own direct links", () => {
  const library = { focus: "std", nodes: [{ id: "std" }, { id: "add" }, { id: "sub" }, { id: "user" }],
    edges: [{ from: "add", to: "std" }, { from: "sub", to: "std" }, { from: "add", to: "user" }] };
  const shown = dependencyGraphNested(library, ["add"]);
  expect(shown.focus).toBe("add");
  expect(shown.nodes.map(node => node.id)).toEqual(["std", "add", "user"]);
  expect(shown.edges).toEqual([{ from: "add", to: "std" }, { from: "add", to: "user" }]);
});

test("without a drawn identity the card's whole graph is kept", () => {
  const card = { focus: "demo", nodes: [{ id: "demo" }, { id: "rom" }], edges: [{ from: "rom", to: "demo" }] };
  expect(dependencyGraphNested(card, ["not-drawn"])).toBe(card);
  expect(dependencyGraphNested(card, undefined)).toBe(card);
});

test("a retained reference's own graph is kept whole", () => {
  const own = { focus: "fenel", nodes: [{ id: "fenel" }, { id: "rom" }, { id: "fennel" }, { id: "genus" }],
    edges: [{ from: "rom", to: "fenel" }, { from: "fennel", to: "fenel" }, { from: "genus", to: "fennel" }] };
  expect(dependencyGraphNested(own, ["fenel"])).toBe(own);
});
