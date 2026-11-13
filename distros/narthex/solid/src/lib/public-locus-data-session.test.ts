// C1: verify the source-owned examples against the product's detached reader.
import { expect, test } from "bun:test";
import { typeCode, type ExprNode } from "@fenel/engine/authoring/expression";
import { Anything, List, Nothing, functionRefHandle } from "@fenel/engine/type-foundation";
import { DETACHED_AUTHORING_SESSION, prepareDetachedAuthoringSession } from "./expression-runner/authoring-session";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { SEED_VALUES } from "./expression-runner/seed-values";
import { PUBLIC_DATA_DEMO, PUBLIC_DATA_MEMBERS, PUBLIC_DATA_SEED_NAMES, PUBLIC_DEMO_NAMES, PUBLIC_FINISHED_DEMOS, PUBLIC_SEED_NAMES, PUBLIC_UNFINISHED_DEMOS, arrangePublicDemos, publicLocusDataForSession, publicSourceMetadataForSession, publicShowcaseSourceForSession, publicSourceDemoValues } from "./public-locus-data";
import { evaluateLocusCard, readLocusCardResult } from "./locus-card-evaluation";
import { evaluateAuthoringExpressionInSession } from "./expression-runner/expression-evaluation";
import { assertReaderSourceMetadata, sourceExecutableSlots } from "./reader-source-metadata";
import { expressionAt } from "./locus-expression-edit";
import { invokeCallable } from "@fenel/engine/expressions";
import { expectedTypeForName } from "./expression-runner/creation-seed";
import { linkedDemoProjection, planLinkedDemoCommands } from "./linked-demo-plan";
import { createReaderPresentation } from "./reader-presentation";

test("actual public examples keep checked String/Number labels under the detached reader's exact-name fence", () => {
  const registry = DETACHED_AUTHORING_SESSION.registry;
  const environment = DETACHED_AUTHORING_SESSION.environment;
  expect(environment.getFunctionEntry?.("appendItem")).toBeUndefined();
  const session = { registry, environment } as AuthoringSession;
  Object.defineProperty(session, "evaluateContext", { get: () => { throw new Error("Browsing requested a demo evaluator"); } });
  const demos = PUBLIC_DEMO_NAMES.map(name => SEED_VALUES.find(entry => entry.name === name)!);
  const data = publicLocusDataForSession(session, demos, List(Anything), Nothing);
  const type = data.root.items.find(item => item.id === "demo")!.valueType!;
  if (!("$record" in type)) throw new Error("The demos must retain their record type");
  expect(type.$record.fields.map(field => [field.name, typeCode(field.type, handle => registry.getIdentifiedEntity(handle)?.id ?? handle)])).toEqual([
    [PUBLIC_DEMO_NAMES[0], "String"], [PUBLIC_DEMO_NAMES[1], "Number"], [PUBLIC_DEMO_NAMES[2], "String"],
  ]);
}, 120_000);

test("the three public calls use the checked read session and retain the same card result for editor handoff", async () => {
  const session = await prepareDetachedAuthoringSession();
  const saved = new Map();
  const results = [];
  for (const name of PUBLIC_DEMO_NAMES) {
    const example = SEED_VALUES.find(entry => entry.name === name)!;
    const result = await evaluateLocusCard(example.expr, saved, session);
    expect(readLocusCardResult(example.expr, saved, session)).toBe(result);
    expect(evaluateLocusCard(example.expr, saved, session)).toBe(result);
    results.push(result.result);
  }
  expect(results[0]).toBe("LENEF!!!");
  expect(results[1]).toBeCloseTo(1628.894626777442, 10);
  expect(results[2]).toBe("fox brown quick the");
}, 120_000);

test("the actual public std parent and its direct Encyclopedia child produce the same ordinary contents", async () => {
  const session = await prepareDetachedAuthoringSession();
  const data = publicLocusDataForSession(session, [], List(Anything), Nothing);
  const standard = data.root.items.find(item => item.id === "std")!.source!;
  if (standard.kind !== "expr" || standard.expr.kind !== "literal") throw new Error("The public library must retain its structural record source");
  const fields = (standard.expr.value as { __record: { fields: Array<{ name: string; value: ExprNode }> } }).__record.fields;
  expect(fields.some(field => field.name === "$" && field.value.kind === "literal")).toBe(true);
  const encyclopedia = fields.find(field => field.name === "Encyclopedia")!.value;
  const parent = (await evaluateLocusCard(standard.expr, new Map(), session)).result as Record<string, unknown>;
  const direct = (await evaluateLocusCard(encyclopedia, new Map(), session)).result;
  expect(parent.Encyclopedia).toEqual(direct);
  expect(Object.keys(parent.Encyclopedia as object).filter(key => key !== "$tag")).toEqual(["livingThings", "countries", "writing", "emoji", "programmingLanguages"]);
  expect(parent.$).toEqual((fields.find(field => field.name === "$")!.value as Extract<ExprNode, { kind: "literal" }>).value);
}, 120_000);

test("the three public recipe calls project from source and return one preparation, two, then none", async () => {
  const session = await prepareDetachedAuthoringSession();
  const recipes = publicSourceDemoValues(session.registry, Nothing).find(demo => demo.name === "Recipe functions")!;
  const type = recipes.type!;
  if (!("$record" in type)) throw new Error("Recipe functions must remain ordinary record data");
  expect(type.$record.fields.map(field => field.name)).toEqual(["Moisturizing-lubrication formula", "Sports formula", "Examples", "Facts and types"]);
  const lube = session.registry.getFunction("RecipeFunctions.lubeFormula")!;
  const tags = (rows: unknown) => (rows as Array<Array<{ $tag: string }>>).map(row => row.map(food => food.$tag));
  const results = ["With butter", "With butter and coconut cream", "Without honey"].map(label => {
    const expression = expressionAt(recipes.expr, ["Examples", label])!;
    if (expression.kind !== "call") throw new Error(`${label} must stay a call to the formula`);
    const lubeId = session.registry.getUuid(lube.id);
    if (lubeId === undefined) throw new Error("the moisturizing-lubrication formula has no identity in this session");
    expect(expression.fnId).toBe(lubeId);
    return tags(evaluateAuthoringExpressionInSession(expression, undefined, session, {}, { trace: false }).result);
  });
  expect(results).toEqual([
    [["Butter", "Honey", "LemonJuice", "Egg"]],
    [["Butter", "Honey", "LemonJuice", "Egg"], ["CoconutCream", "Honey", "LemonJuice", "Egg"]],
    [],
  ]);
}, 120_000);

test("the public source packet executes the same dependency query and refuses foreign or retired captures", async () => {
  const session = await prepareDetachedAuthoringSession();
  const data = publicLocusDataForSession(session, [], List(Anything), Nothing);
  let active = true;
  const capture = publicSourceMetadataForSession(data, "public-regression", [], () => active);
  expect(capture.packet.source).toEqual({ $tag: "PublicSource" });
  expect(capture.packet.expressions.map(row => row.id).sort()).toEqual(Object.keys(data.root.expressions).sort());
  const target = session.environment.resolveFunctionId("view.dependencyQueryLinked");
  if (!target) throw new Error("The public source query must be available by its exact reader route");
  const query: ExprNode = { kind: "call", fnId: target, args: [
    { kind: "literal", value: { $tag: "DependencySourceLocator", source: { $tag: "PublicSource" }, rootId: data.root.id, occurrenceId: "std" } },
    { kind: "literal", value: 1 },
  ] };
  const evaluate = (node: ExprNode, sourceMetadata?: typeof capture) => evaluateAuthoringExpressionInSession(node, undefined, session, {}, { trace: false, sourceMetadata }).result as { $tag: string };
  expect(evaluate(query, capture).$tag).toBe("Ok");
  expect(evaluate(query).$tag).toBe("Err");
  const foreign: ExprNode = { ...query, args: [
    { kind: "literal", value: { $tag: "DependencySourceLocator", source: { $tag: "AccountSource", accountId: "private-other" }, rootId: data.root.id, occurrenceId: "std" } },
    query.args[1]!,
  ] };
  expect(evaluate(foreign, capture).$tag).toBe("Err");
  expect(() => assertReaderSourceMetadata(capture, {} as AuthoringSession)).toThrow("current reader");
  active = false;
  expect(() => evaluate(query, capture)).toThrow("current reader");
}, 120_000);

test("public linked records use admitted source bindings and retain honest reference and image-call edges", async () => {
  const session = await prepareDetachedAuthoringSession();
  const bindings = publicShowcaseSourceForSession(session);
  const data = publicLocusDataForSession(session, publicSourceDemoValues(session.registry, Nothing, undefined, bindings), List(Anything), Nothing);
  const identity = (name: string) => {
    const fn = session.registry.getFunction(name);
    const id = fn && session.registry.getUuid(fn.id);
    if (!id) throw new Error(`The source declaration ${name} must have a checked identity`);
    return id;
  };
  const fenel = identity("ShowcaseDemo.showcaseFenel"), rom = identity("ShowcaseDemo.showcaseRom");
  const fennel = identity("Encyclopedia.commonFennel"), genus = identity("Encyclopedia.foeniculum"), family = identity("Encyclopedia.apiaceae");
  const plate = identity("Encyclopedia.foeniculumVulgareIllustration"), image = identity("Encyclopedia.foeniculumVulgarePlateImage");
  expect(expressionAt(data.root.expressions[`locus:${data.root.id}:demo`]!, ["People and projects", "Fenel"]))
    .toEqual({ kind: "ref", savedExprId: fenel });
  expect(data.root.expressions[fenel]).toBe(bindings.values.find(row => row.id === fenel)!.query.expr);
  const saved = new Map(Object.entries(data.root.expressions));
  const rendered = evaluateAuthoringExpressionInSession({ kind: "ref", savedExprId: fenel }, id => saved.get(id), session, {}, { trace: false }).result;
  expect(rendered).toEqual(invokeCallable({ $ref: fenel }, [], session.evaluateContext));
  let active = true;
  const capture = publicSourceMetadataForSession(data, "public-linked-regression", [], () => active);
  const queryTarget = session.environment.resolveFunctionId("view.dependencyQueryLinked");
  if (!queryTarget) throw new Error("The public linked query must be available");
  const query = (occurrenceId: string, source: unknown = { $tag: "PublicSource" }) => evaluateAuthoringExpressionInSession({
    kind: "call", fnId: queryTarget, args: [
      { kind: "literal", value: { $tag: "DependencySourceLocator", source, rootId: data.root.id, occurrenceId } },
      { kind: "literal", value: 3 },
    ],
  }, undefined, session, {}, { trace: false, sourceMetadata: capture }).result as {
    $tag: string; _0: { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string; labels: string[] }> };
  };
  const graph = query(fenel);
  expect(graph.$tag).toBe("Ok");
  const haskell = identity("Encyclopedia.languageHaskell"), fennels = identity("Encyclopedia.encyclopediaFennels");
  const giant = identity("Encyclopedia.giantFennel");
  for (const [from, to] of [[rom, fenel], [fennel, fenel], [genus, fennel], [family, genus], [haskell, fenel], [fennels, fenel]])
    expect(graph._0.edges.some(edge => edge.from === from && edge.to === to)).toBe(true);
  const fennelsGraph = query(fennels);
  expect(fennelsGraph.$tag).toBe("Ok");
  for (const plant of [fennel, giant]) expect(fennelsGraph._0.edges.some(edge => edge.from === plant && edge.to === fennels)).toBe(true);
  // The bound fennels set is the Encyclopedia's own value.
  expect(evaluateAuthoringExpressionInSession({ kind: "ref", savedExprId: fennels }, id => saved.get(id), session, {}, { trace: false }).result)
    .toEqual(invokeCallable({ $ref: fennels }, [], session.evaluateContext));
  const personEdge = graph._0.edges.find(edge => edge.from === rom && edge.to === fenel)!;
  expect(personEdge.labels.map(label => label.toLowerCase())).toEqual(expect.arrayContaining(["authors"]));
  expect(graph._0.nodes.find(node => node.id === family)?.label).toBe("Apiaceae");
  const plateSlots = capture.packet.expressions.find(row => row.id === plate)!.slots;
  expect(plateSlots.some(slot => slot.$tag === "SourceCall" && slot.identity === image)).toBe(true);
  expect(plateSlots.some(slot => (slot.$tag === "SourceReference" || slot.$tag === "SourceFieldReference") && slot.identity === image)).toBe(false);
  expect(capture.packet.expressions.some(row => row.id === image)).toBe(false);
  expect(query(plate).$tag).toBe("Ok");
  expect(query(fenel, { $tag: "AccountSource", accountId: "private-other" }).$tag).toBe("Err");
  expect(capture.packet.occurrences.some(row => row.id === fenel && row.expressionId === fenel)).toBe(true);
  const referenceTarget = session.environment.resolveFunctionId("view.dependencyQueryLinkedAtReference");
  if (!referenceTarget) throw new Error("The nearest-binding source query must be available");
  const atReference = (parent: string, reference: string) => evaluateAuthoringExpressionInSession({ kind: "call", fnId: referenceTarget, args: [
    { kind: "literal", value: { $tag: "DependencySourceLocator", source: { $tag: "PublicSource" }, rootId: data.root.id, occurrenceId: parent } },
    { kind: "literal", value: reference }, { kind: "literal", value: 2 },
  ] }, undefined, session, {}, { trace: false, sourceMetadata: capture }).result as { $tag: string; _0: { focus: string } };
  expect(atReference("demo", fenel)).toMatchObject({ $tag: "Ok", _0: { focus: fenel } });
  expect(atReference(fenel, rom)).toMatchObject({ $tag: "Ok", _0: { focus: rom } });
  expect(atReference(fenel, genus)).toMatchObject({ $tag: "Ok", _0: { focus: genus } });
  // Every identity below is admitted, but neither parent retains that link.
  expect(atReference(rom, fenel).$tag).toBe("Err");
  expect(atReference(fenel, plate).$tag).toBe("Err");
  expect(atReference("missing-parent", fenel).$tag).toBe("Err");
  expect(atReference("demo", image).$tag).toBe("Err");
  expect(atReference("demo", "missing-source").$tag).toBe("Err");
  active = false;
  expect(() => query(fenel)).toThrow("current reader");
}, 120_000);

test("public linked source projection refuses a constructor whose declaring source route is unavailable", async () => {
  const session = await prepareDetachedAuthoringSession();
  const registry = { ...session.registry, resolveFunctionDraftReferences: (source: string, names: readonly string[]) =>
    names.includes("$ctor:Project") ? names.map(name => ({ name, status: "missing" as const, targetId: "" }))
      : session.registry.resolveFunctionDraftReferences(source, names) };
  expect(() => publicShowcaseSourceForSession({ ...session, registry })).toThrow("cannot retain Project in its source frame");
}, 120_000);

test("public constructor projection rejects missing, ambiguous, foreign-owner and mismatched-function metadata", async () => {
  const session = await prepareDetachedAuthoringSession();
  const constructors = session.environment.catalog.patternConstructors!;
  const plant = constructors.find(row => row.id === "PlantFamily")!;
  expect(plant).toBeDefined();
  expect(session.environment.resolveConstructorTarget?.("PlantFamily")).toBeUndefined();
  expect(session.environment.resolveConstructorTarget?.(plant.targetId!)).toBe(plant.targetId);
  for (const replacement of [
    constructors.filter(row => row.id !== "PlantFamily"),
    [...constructors, { ...plant, targetId: "foreign-constructor-target", ownerIdentity: "foreign-owner" }],
    constructors.map(row => row === plant ? { ...row, ownerIdentity: "foreign-owner" } : row),
    constructors.map(row => row === plant ? { ...row, functionId: "foreign-constructor-function" } : row),
    constructors.map(row => row === plant ? { ...row, signatureOutcome: undefined } : row),
  ]) {
    const environment = { ...session.environment, catalog: { ...session.environment.catalog, patternConstructors: replacement } };
    expect(() => publicShowcaseSourceForSession({ ...session, environment })).toThrow("cannot retain PlantFamily in its source frame");
  }
  const signatures = session.registry.listConstructorSignatures();
  const registry = { ...session.registry, listConstructorSignatures: () => signatures.map(row => row.name === "PlantFamily" ? { ...row, ownerIdentity: "" } : row) };
  const environment = { ...session.environment, catalog: { ...session.environment.catalog,
    patternConstructors: constructors.map(row => row === plant ? { ...row, ownerIdentity: "" } : row) } };
  expect(() => publicShowcaseSourceForSession({ ...session, registry, environment })).toThrow("cannot retain PlantFamily in its source frame");
}, 120_000);

test("Local showcase commands retain fresh copy identities and the same shared authored record programme", async () => {
  const session = await prepareDetachedAuthoringSession();
  const handle = (name: string) => {
    const declaration = session.registry.getFunction(name);
    const id = declaration && session.registry.getUuid(declaration.id);
    if (!id) throw new Error(`Missing showcase declaration ${name}`);
    return id;
  };
  const sources = invokeCallable({ $ref: handle("ShowcaseDemo.showcasePublicBindingSources") }, [], session.evaluateContext) as {
    bindings: Record<string, unknown>; calls: Record<string, unknown>;
  };
  const ids = Object.fromEntries(Object.keys(sources.bindings).flatMap(key => [[key, `copy-${key}`], [`${key}Item`, `item-${key}`]]));
  const heads = Object.fromEntries(Object.entries(sources.calls).map(([key, value]) => [key, handle(functionRefHandle(value)!)]));
  const types = ["PublicPerson", "Project", "Mascot", "PlantFamily", "PlantGenus", "PlantSpecies", "BotanicalIllustration", "ProgrammingLanguage", "PlantNamedSpeciesSet"]
    .map(name => expectedTypeForName(name, session.environment));
  const args = [ids, heads, ...types];
  const records = invokeCallable({ $ref: handle("ShowcaseDemo.showcaseSourceRecords") }, args, session.evaluateContext) as {
    values: Array<{ id: string; query: { expr: ExprNode } }>; items: Array<{ id: string }>;
  };
  const commands = invokeCallable({ $ref: handle("ShowcaseDemo.showcaseCommands") }, args, session.evaluateContext) as {
    commands: Array<{ $tag: string; commands: Array<{ entry: { value: unknown } }> }>;
  };
  expect(commands.commands.map(command => command.$tag)).toEqual(["TabEditValues", "TabEditEntries"]);
  expect(commands.commands[0]!.commands.map(command => command.entry.value)).toEqual(records.values);
  expect(commands.commands[1]!.commands.map(command => command.entry.value)).toEqual(records.items);
  expect(records.values.every(row => row.id.startsWith("copy-"))).toBe(true);
  expect(records.items.every(row => row.id.startsWith("item-"))).toBe(true);
  const project = records.values.find(row => row.id === "copy-fenel")!;
  const references = sourceExecutableSlots(project.query.expr).filter(slot => slot.$tag === "SourceFieldReference");
  expect(references.some(slot => slot.identity === "copy-rom" && slot.field === "authors")).toBe(true);
  expect(references.some(slot => slot.identity === "copy-commonFennel" && slot.field === "namedAfter")).toBe(true);
  for (const language of ["lisp", "smalltalk", "prolog", "sql", "erlang", "coq", "haskell", "ocaml", "scratch", "typescript"])
    expect(references.some(slot => slot.identity === `copy-${language}` && slot.field === "inspiredByLanguages")).toBe(true);
  // A project names the project that inspired it, and its people, by reference.
  const healthfully = sourceExecutableSlots(records.values.find(row => row.id === "copy-healthfully")!.query.expr)
    .filter(slot => slot.$tag === "SourceFieldReference");
  expect(healthfully.some(slot => slot.identity === "copy-primalDiet" && slot.field === "inspiredBy")).toBe(true);
  expect(healthfully.some(slot => slot.identity === "copy-bayne" && slot.field === "authors")).toBe(true);
  expect(references.some(slot => slot.identity === "copy-fennels" && slot.field === "logoInspiredBy")).toBe(true);
  const fennels = records.values.find(row => row.id === "copy-fennels")!;
  const fennelsSlots = sourceExecutableSlots(fennels.query.expr);
  expect(fennelsSlots.some(slot => slot.$tag === "SourceCall" && slot.identity === handle("Encyclopedia.encyclopediaFennelsIn"))).toBe(true);
  for (const plant of ["copy-commonFennel", "copy-giantFennel"])
    expect(fennelsSlots.some(slot => (slot.$tag === "SourceReference" || slot.$tag === "SourceFieldReference") && slot.identity === plant)).toBe(true);
  expect(records.items.map(row => row.id)).toEqual(expect.arrayContaining(["item-fennels", "item-haskell"]));
}, 120_000);

test("Edit in Local plans the same linked programme from the source roster, with fresh identities for every record", async () => {
  const session = await prepareDetachedAuthoringSession();
  let next = 0;
  const commands = planLinkedDemoCommands("showcase", session, linkedDemoProjection(session),
    () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`) as unknown as Array<{ $tag: string; commands: Array<{ entry: { value: { id: string; name: string; query: { expr: ExprNode } } } }> }>;
  expect(commands.map(command => command.$tag)).toEqual(["TabEditValues", "TabEditEntries"]);
  const values = commands[0]!.commands.map(command => command.entry.value);
  // Seventeen original records (three people, six projects, the mascot, five
  // plant records and two plates), the fennels set and ten languages.
  expect(values).toHaveLength(28);
  const byName = (name: string) => values.find(value => value.name === name)!;
  const fenel = byName("Fenel"), fennels = byName("Fennels");
  const fenelReferences = sourceExecutableSlots(fenel.query.expr).filter(slot => slot.$tag === "SourceFieldReference");
  for (const name of ["Rom", "LISP", "SQL", "Haskell", "TypeScript"])
    expect(fenelReferences.some(slot => slot.identity === byName(name).id)).toBe(true);
  expect(fenelReferences.some(slot => slot.identity === fennels.id && slot.field === "logoInspiredBy")).toBe(true);
  const fennelsSlots = sourceExecutableSlots(fennels.query.expr);
  for (const name of ["Common fennel", "Giant fennel"])
    expect(fennelsSlots.some(slot => (slot.$tag === "SourceReference" || slot.$tag === "SourceFieldReference") && slot.identity === byName(name).id)).toBe(true);
  // Every identity is a fresh copy, never a source declaration's.
  expect(values.every(value => value.id.startsWith("00000000-0000-4000-8000-"))).toBe(true);
  const saved = new Map(values.map(value => [value.id, value.query.expr]));
  const copied = evaluateAuthoringExpressionInSession({ kind: "ref", savedExprId: fennels.id }, id => saved.get(id), session, {}, { trace: false }).result;
  expect(copied).toEqual(invokeCallable({ $ref: session.registry.getUuid(session.registry.getFunction("Encyclopedia.encyclopediaFennels")!.id)! }, [], session.evaluateContext));
}, 120_000);

test("every actual public demo is reachable exactly once: Data instead of files, a finished one at the root, every other inside Unfinished demos", async () => {
  const session = await prepareDetachedAuthoringSession();
  const presentation = createReaderPresentation(() => ({ registry: session.registry, session, catalog: [] }));
  const seeds = PUBLIC_SEED_NAMES.map(name => SEED_VALUES.find(entry => entry.name === name)!);
  expect(seeds.every(Boolean)).toBe(true);
  const flat = [...publicSourceDemoValues(session.registry, Nothing, presentation, publicShowcaseSourceForSession(session)), ...seeds];
  // The utility records need the reader presentation; without it they would be missing here.
  expect(flat.length).toBe(21 + 5 + PUBLIC_SEED_NAMES.length);
  const data = publicLocusDataForSession(session, arrangePublicDemos(flat), List(Anything), Nothing, presentation);
  const demo = data.root.expressions[`locus:${data.root.id}:demo`]! as Extract<ExprNode, { kind: "literal" }>;
  type Fields = { __record: { fields: Array<{ name: string; value: ExprNode }> } };
  const rootNames = (demo.value as Fields).__record.fields.map(field => field.name);
  expect(rootNames).toEqual([PUBLIC_DATA_DEMO.name, ...PUBLIC_FINISHED_DEMOS, PUBLIC_UNFINISHED_DEMOS.name]);
  // Data instead of files: every listed member is present, in order; a borrowed
  // field is the very expression its own demo shows.
  const own = expressionAt(demo, [PUBLIC_DATA_DEMO.name]) as Extract<ExprNode, { kind: "literal" }>;
  expect((own.value as Fields).__record.fields.map(field => field.name)).toEqual(PUBLIC_DATA_MEMBERS.map(member => member[0]));
  for (const member of PUBLIC_DATA_MEMBERS) if (member.length === 3)
    expect(expressionAt(demo, [PUBLIC_DATA_DEMO.name, member[0]])).toBe(expressionAt(demo, [member[1], member[2]]));
  const group = expressionAt(demo, [PUBLIC_UNFINISHED_DEMOS.name]) as Extract<ExprNode, { kind: "literal" }>;
  const groupNames = (group.value as Fields).__record.fields.map(field => field.name);
  const shown = [...PUBLIC_FINISHED_DEMOS, ...groupNames, ...PUBLIC_DATA_SEED_NAMES];
  expect(new Set(shown).size).toBe(shown.length);
  expect([...shown].sort()).toEqual(flat.map(entry => entry.name).sort());
  // Each moved value keeps its contents and its addresses follow it. One
  // address may be listed by two demos; its place is then one of theirs.
  const places = new Map<string, string[]>();
  const ownExamples = new Set<string>(PUBLIC_DATA_SEED_NAMES);
  for (const entry of flat) {
    const at = PUBLIC_FINISHED_DEMOS.includes(entry.name) ? [entry.name]
      : ownExamples.has(entry.name) ? [PUBLIC_DATA_DEMO.name, entry.name] : [PUBLIC_UNFINISHED_DEMOS.name, entry.name];
    expect(expressionAt(demo, at)).toEqual(entry.expr);
    for (const referent of ("referents" in entry ? entry.referents : undefined) ?? []) for (const address of referent.addresses)
      places.set(address, [...places.get(address) ?? [], JSON.stringify(at)]);
  }
  expect(places.size).toBeGreaterThan(100);
  for (const [address, owners] of places) {
    const path = data.catalogPaths.get(address)!.path;
    expect(owners).toContain(JSON.stringify(path.slice(0, path[0] === PUBLIC_UNFINISHED_DEMOS.name ? 2 : 1)));
  }
}, 900_000);
