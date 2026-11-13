// Loads the engine registry: a heavy test (one process at a time on the shared host).
import { expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { Anything, List, Nothing } from "@fenel/engine/type-foundation";
import { prepareDetachedAuthoringSession } from "./expression-runner/authoring-session";
import { publicLocusDataForSession, publicShowcaseSourceForSession, publicSourceDemoValues, publicSourceMetadataForSession } from "./public-locus-data";
import { evaluateAuthoringExpressionInSession } from "./expression-runner/expression-evaluation";
import { expressionAt } from "./locus-expression-edit";
import { valueAt } from "./locus-scope";
import { collectionLinkedGraph, heldReferences, linkedIncomingGroups } from "./linked-data-graph";
import { linkedKind, nameUnnamedLinks } from "./linked-data-graph-facts";
import { readLinkedParts, readLinkedValues } from "./linked-data-graph-query";

test("one evaluation of Fenel's walk gives the People and projects graph: people, projects, formulas, languages and fennels, linked by field", async () => {
  const session = await prepareDetachedAuthoringSession();
  const bindings = publicShowcaseSourceForSession(session);
  const data = publicLocusDataForSession(session, publicSourceDemoValues(session.registry, Nothing, undefined, bindings), List(Anything), Nothing);
  const identity = (name: string) => {
    const fn = session.registry.getFunction(name);
    const id = fn && session.registry.getUuid(fn.id);
    if (!id) throw new Error(`The source declaration ${name} must have a checked identity`);
    return id;
  };
  const demo = data.root.expressions[`locus:${data.root.id}:demo`]!;
  const collection = expressionAt(demo, ["People and projects"]);
  // The collection's members are its saved references (its types and list calls are not linked data).
  const members = heldReferences(collection).filter(row => expressionAt(collection, row.path).kind === "ref")
    .map(row => ({ id: row.identity, label: String(row.path[0]) }));
  expect(members.map(member => member.label)).toEqual(["Rom", "Bayne", "Aajonus", "Fenel", "Primal Diet", "Healthfully", "BayneOS", "DripCollector", "7CatYear", "Fen"]);
  const capture = publicSourceMetadataForSession(data, "linked-graph-test", [], () => true);
  const started = performance.now();
  const walk = await readLinkedParts(session, capture, members.map(member => member.id));
  const seconds = (performance.now() - started) / 1000;
  console.log(`linked parts walk: ${seconds.toFixed(2)} s, ${walk.nodes.length} nodes, ${walk.edges.length} edges`);
  const expressions = new Map(Object.entries(data.root.expressions));
  const held = new Map(members.map(member => [member.id, new Set(heldReferences(expressions.get(member.id)).map(row => row.identity))] as const));
  const graph = collectionLinkedGraph({ members, walk, held: holder => held.get(holder) ?? new Set() });
  const ids = new Set(graph.nodes.map(node => node.id));
  const [rom, bayne, aajonus, fenel, primal, healthfully, bayneOS] = ["Rom", "Bayne", "Aajonus", "Fenel", "PrimalDiet", "Healthfully", "BayneOS"]
    .map(name => identity(`ShowcaseDemo.showcase${name}`));
  const lube = identity("RecipeFunctions.lubeFormula"), hydration = identity("RecipeFunctions.hydrationFormula");
  const haskell = identity("Encyclopedia.languageHaskell"), fennel = identity("Encyclopedia.commonFennel"), fennels = identity("Encyclopedia.encyclopediaFennels");
  for (const id of [rom, bayne, aajonus, fenel, primal, healthfully, bayneOS, lube, hydration, haskell, fennel, fennels]) expect(ids.has(id!)).toBe(true);
  // A picture call is a computation inside Rom's card, and the Demo that holds the collection is not drawn.
  expect(ids.has(identity("ShowcaseDemo.romPicture"))).toBe(false);
  expect(ids.has("demo")).toBe(false);
  // The page's own steps before routing: the members' values (one batched read), each part's value
  // where its member holds it, each card's kind, and the names of links Fenel's walk leaves unnamed.
  const memberValues = await readLinkedValues(session, members.map(member => member.id), expressions);
  const valueOf = new Map<string, unknown>(members.map((member, index) => [member.id, memberValues[index]] as const));
  const positions = new Map(members.map(member => [member.id, heldReferences(expressions.get(member.id))] as const));
  for (const node of graph.nodes) {
    if (valueOf.has(node.id)) continue;
    for (const member of members) {
      const at = positions.get(member.id)?.find(row => row.identity === node.id);
      if (at) { valueOf.set(node.id, valueAt(valueOf.get(member.id), at.path)); break; }
    }
  }
  console.log(`unnamed links before naming: ${graph.edges.filter(row => !row.labels.length).length} of ${graph.edges.length}`);
  nameUnnamedLinks(session, graph.edges, link => positions.get(link.from)?.find(row => row.identity === link.to)?.path[0],
    id => ({ value: valueOf.get(id) }));
  const kinds = new Map(graph.nodes.map(node => [node.id, linkedKind(session, undefined, valueOf.get(node.id))] as const));
  const label = new Map(graph.nodes.map(node => [node.id, node.label] as const));
  for (const link of graph.edges) console.log(`link ${label.get(link.from)} [${kinds.get(link.from)}] --${link.labels.join(", ")}--> ${label.get(link.to)}`);
  const joins = linkedIncomingGroups(graph.edges, id => kinds.get(id)).filter(group => group.length >= 2);
  for (const group of joins) console.log(`join into ${label.get(group[0]!.to)} by ${group[0]!.labels.join(", ")}: ${group.map(row => label.get(row.from)).join(", ")}`);
  const sevenCatYear = identity("ShowcaseDemo.showcaseSevenCatYear"), drip = identity("ShowcaseDemo.showcaseDripCollector");
  const joinInto = (target: string) => joins.find(group => group[0]!.to === target && group[0]!.labels.join() === "Authors");
  expect(joinInto(rom!)?.map(row => row.from).sort()).toEqual([fenel!, healthfully!, sevenCatYear].sort());
  expect(joinInto(bayne!)?.map(row => row.from).sort()).toEqual([healthfully!, bayneOS!, drip].sort());
  // The real shape, kept for the pure routing test (linked-data-graph.test.ts).
  const fixture = { note: "Captured by linked-data-graph-query.test.ts from the public registry's People and projects: the page's graph before routing.",
    nodes: graph.nodes.map(node => ({ id: node.id, label: node.label, kind: kinds.get(node.id) ?? null })),
    edges: graph.edges.map(row => ({ from: row.from, to: row.to, labels: row.labels })) };
  await Bun.write(new URL("./linked-data-graph.real-graph.json", import.meta.url), JSON.stringify(fixture, null, 1) + "\n");
  const edge = (from: string, to: string) => graph.edges.find(row => row.from === from && row.to === to);
  expect(edge(healthfully!, primal!)?.labels.map(label => label.toLowerCase())).toEqual(["inspired by"]);
  expect(edge(healthfully!, rom!)?.labels.map(label => label.toLowerCase())).toEqual(["authors"]);
  expect(edge(fenel!, haskell)?.labels.map(label => label.toLowerCase())).toEqual(["inspired by languages"]);
  expect(edge(primal!, aajonus!)).toBeDefined();
  expect(edge(primal!, lube)).toBeDefined();
  expect(edge(primal!, hydration)).toBeDefined();
  // Each part's card shows the value already rendered where its member holds it: no second read.
  const evaluate = (node: ExprNode) => evaluateAuthoringExpressionInSession(node, id => expressions.get(id), session, {}, { trace: false }).result;
  const fenelValue = evaluate({ kind: "ref", savedExprId: fenel! });
  const at = heldReferences(expressions.get(fenel!)).find(row => row.identity === haskell)!;
  expect(valueAt(fenelValue, at.path)).toEqual(evaluate({ kind: "ref", savedExprId: haskell }));
  const primalValue = evaluate({ kind: "ref", savedExprId: primal! });
  const formula = heldReferences(expressions.get(primal!)).find(row => row.identity === lube)!;
  console.log("formula value", JSON.stringify(valueAt(primalValue, formula.path)).slice(0, 200), "at", formula.path);
  expect(valueAt(primalValue, formula.path)).toBeDefined();
  // The members' values in one evaluation of the list of their references, as the cards read them.
  const valuesStarted = performance.now();
  const values = await readLinkedValues(session, members.map(member => member.id), expressions);
  console.log(`members' values: ${((performance.now() - valuesStarted) / 1000).toFixed(2)} s`);
  expect(values).toHaveLength(members.length);
  expect(values[members.findIndex(member => member.id === fenel)]).toEqual(fenelValue);
  expect(seconds).toBeLessThan(20);
}, 1_500_000);
