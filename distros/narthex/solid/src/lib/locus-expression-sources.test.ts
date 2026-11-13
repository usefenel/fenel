import { expect, test } from "bun:test";
import { expressionSourceIndex, locusExpressionSources, savedValueOptions } from "./locus-expression-sources";
import type { LocusRootData } from "./locus-root-data";

test("root references have the same expressions in every editor and never resolve another account", () => {
  const expr = { kind: "literal" as const, value: [1, 2] };
  const root = { id: "a", name: "All data", referenceId: "locus:a", items: [{ id: "photos", caption: "Photos" }],
    lists: [], expressions: { "locus:a:photos": expr } } as unknown as LocusRootData;
  const index = expressionSourceIndex(locusExpressionSources(root));
  expect(index.get("locus:a:photos")?.expr).toBe(expr);
  expect(index.get("locus:a:photos")?.name).toBe("All data / Photos");
  expect(index.get("locus:b:photos")).toBeUndefined();
  expect(locusExpressionSources(undefined)).toEqual([]);
});

test("a saved value published under its own id is listed once, by its name (no phantom Value rows)", () => {
  const person = { kind: "literal" as const, value: { __construct: { tag: "Person", fields: [] } } };
  const root = { id: "tab", name: "Local", referenceId: "tab", items: [{ id: "card" }], lists: [],
    expressions: { "tab:card": { kind: "ref", savedExprId: "alex" }, alex: person } } as unknown as LocusRootData;
  const options = savedValueOptions(root, [{ id: "alex", name: "Alex Martin", expr: person }]);
  expect(options.filter(option => option.id === "alex").map(option => option.name)).toEqual(["Alex Martin"]);
  expect(options.map(option => option.name)).not.toContain("Value");
});

// Launch night (Nov 13): a Person made from its type card is an uncaptioned
// root card; its picker row read "Local / Value" and a search for its name
// ("Rom") found nothing.
test("an unnamed card reads as its card heading in a typed picker, and its data's text is searchable", async () => {
  const sources = await import("./locus-expression-sources");
  const lit = (value: unknown) => ({ kind: "literal" as const, value });
  const person = (name: string) => lit({ __construct: { tag: "person-ctor", fields: [
    { name: "name", value: lit(name) }, { name: "email", value: lit(`${name.toLowerCase()}@usefenel.com`) }] } });
  const root = { id: "tab", name: "Local", referenceId: "tab", lists: [],
    items: [{ id: "type" , caption: "Person" }, { id: "p1" }, { id: "other" }, { id: "p2" }],
    expressions: { "tab:type": lit("a type"), "tab:p1": person("Rom"), "tab:other": lit(3),
      "tab:p2": { kind: "ref", savedExprId: "sam" }, sam: person("Sam") } } as unknown as LocusRootData;
  const options = savedValueOptions(root, []);
  const byId = (id: string) => options.find(option => option.id === id)!;
  expect(sources.savedValueShownName(byId("tab:p1"), "Person")).toBe("Person 1");
  expect(sources.savedValueShownName(byId("tab:p2"), "Person")).toBe("Person 2");
  // Without a type label, or for a named card, the existing name stands.
  expect(sources.savedValueShownName(byId("tab:p1"))).toBe("Local / Value");
  expect(sources.savedValueShownName(byId("tab:type"), "Person")).toBe("Local / Person");
  const resolve = (id: string) => byId(id)?.expr;
  expect(sources.savedValueMatches(byId("tab:p1"), "Rom", "Person", resolve)).toBe(true);
  expect(sources.savedValueMatches(byId("tab:p1"), "person 1", "Person", resolve)).toBe(true);
  expect(sources.savedValueMatches(byId("tab:p2"), "sam", "Person", resolve)).toBe(true);
  expect(sources.savedValueMatches(byId("tab:p1"), "sam", "Person", resolve)).toBe(false);
  expect(sources.savedValueMatches(byId("tab:p1"), "", "Person", resolve)).toBe(true);
});
