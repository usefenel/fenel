import "../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { DataSuggestion, DataSuggestionInput } from "./data-suggestions";

// Typed grouping M4 (2026-11-06): Suggestions offer "Group by <field>" for a
// list of records, as ordinary checked applications of std.groupByKey, beside
// the mapped field projections. One actual Local registry (with two Local types,
// Person and Transaction with a time.CalendarDate field, for the recorded
// nominal case); run alone in the shared heavy slot:
//   bun --no-env-file test --timeout 600000 ./src/lib/data-suggestions-grouping.test.ts  (distro dir, FENEL_PARSER_LEGACY=1)
const SOURCE = "fenel-browser-local-grouping";
const [reader, catalogue, artifact, detached, mint, suggestions, foundation, expressions, authoringExpression] = await Promise.all([
  import("./reader-registry"), import("./expression-runner/authoring-catalog"),
  import("./expression-runner/authoring-catalogue-artifact"), import("./expression-runner/detached-authoring-environment"),
  import("../../../../../implementations/typescript/runtime/src/authority-mint"), import("./data-suggestions"),
  import("@fenel/engine/type-foundation"), import("@fenel/engine/expressions"), import("@fenel/engine/authoring/expression"),
]);
const nothing = { $tag: "Nothing" } as const;
const ids = {
  person: "6f1c1d8e-3a43-4c6e-9d55-0b7a9c2f4e11", transaction: "0b2e7a55-8f3d-4f8b-a4a1-5d9c3e6b7f22",
  name: "1c4f0e2a-6b5d-4a3e-8f7c-9d2b1a0e3c44", phone: "2d5a1f3b-7c6e-4b4f-9a8d-0e3c2b1f4d55",
  amount: "3e6b2a4c-8d7f-4c5a-ab9e-1f4d3c2a5e66", personField: "4f7c3b5d-9e8a-4d6b-bc0f-2a5e4d3b6f77",
  date: "5a8d4c6e-af9b-4e7c-8d1a-3b6f5e4c7a88",
  year: "6b9e5d7f-b0ac-4f8d-9e2b-4c7a6f5d8b99", month: "7caf6e80-c1bd-4a9e-8f3c-5d8b7a6e9caa", day: "8db07f91-d2ce-4baf-9a4d-6e9c8b7faddb",
};
const field = (id: string, name: string, type: unknown) => ({ name, key: { $tag: "NamedField", ref: { $ref: id } }, type,
  label: nothing, ui: nothing, meta: {} });
const durable = (id: string, name: string) => ({ id, currentCodeName: name, status: "live" as const, realm: "account" as const, reuseVisibility: "account" as const });
// The bootstrap reader resolves time.CalendarDate by its repository identity.
const bootstrap = await reader.buildLocalReaderFieldRegistry(SOURCE, { owners: [], fields: [], facets: [] }, { preparation: "inline", representations: [] });
const calendarDate = bootstrap.getUuid("CalendarDate");
if (!calendarDate) throw new Error("time.CalendarDate has no repository identity; regenerate the identity artifacts first.");
const saved = await reader.planLocalDefinitionBundle(SOURCE, { owners: [], fields: [
  durable(ids.name, "name"), durable(ids.phone, "phone"), durable(ids.amount, "amount"), durable(ids.personField, "person"), durable(ids.date, "date"),
], facets: [] }, { ownerMutations: [
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${ids.person}`, storageName: ids.person,
    definition: { id: ids.person, type: { $record: { fields: [field(ids.name, "name", { $ref: "String" }), field(ids.phone, "phone", { $ref: "PhoneNumber" })] } } } } },
  { kind: "upsert", owner: { kind: "type", ownerKey: `type:${ids.transaction}`, storageName: ids.transaction,
    definition: { id: ids.transaction, type: { $record: { fields: [field(ids.amount, "amount", { $ref: "Number" }),
      field(ids.personField, "person", { $ref: ids.person }), field(ids.date, "date", { $ref: calendarDate })] } } } } },
] } as never);
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, saved, { preparation: "inline", representations: [] });
// A Local type is referenced by a spelling the frameless reader can see: its
// registered type handle when it has one, else its module-qualified name (a bare
// Local spelling is not visible without a source function).
const handleOf = (id: string) => {
  const declaration = registry.getIdentifiedEntity(id);
  if (!declaration || typeof declaration.module !== "string") throw new Error(`Local type ${id} is not declared`);
  const handle = registry.getTypeUuid(declaration.module, declaration.id) ?? `${declaration.module}.${declaration.id}`;
  console.info("[grouping-local-type]", JSON.stringify({ id, module: declaration.module, handle,
    resolves: registry.callSiteTyping.resolveType({ $ref: handle }, undefined).ok }));
  return handle;
};
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const { catalog } = await artifact.localCatalogue(registry, frame,
  { localSourceId: SOURCE, snapshot: saved, entities: [], functions: [], localRepresentations: [] }, undefined,
  { catalogueSourceId: SOURCE, graceMs: 0 });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const complete: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame });
const wanted = new Set(["std.map", "std.groupByKey", "std.countByKey", "std.sumByKey", "std.reverse"].map(name => environment.resolveFunctionId(name)));
const selected = complete.catalog.functions.filter(entry => wanted.has(entry.targetId ?? entry.id));
if (new Set(selected.map(entry => entry.targetId ?? entry.id)).size !== 5)
  throw new Error("std.map, std.groupByKey, std.countByKey, std.sumByKey and std.reverse are not all in the Local catalogue");
const session: AuthoringSession = Object.freeze({ ...complete,
  catalog: Object.freeze({ ...complete.catalog, functions: Object.freeze(selected) as AuthoringSession["catalog"]["functions"] }) });

const person = (name: string, phone: string) => ({ name, phone });
const tx = (amount: number, who: ReturnType<typeof person>, year: number, month: number, day: number) =>
  ({ amount, person: who, date: { year, month, day } });
const rows = [
  tx(10, person("Alex", "+14155552671"), 2024, 2, 29),
  tx(20, person("Alex", "+14155552672"), 2024, 3, 1),
  tx(30, person("Alex", "+14155552671"), 2024, 2, 29),
  tx(40, person("Sam", "+14155552673"), 2024, 12, 31),
];
// The record shape the mapped projection reflects (anonymous NamedField record
// rows, as workstreams/suggestions/experiments/check-production.mjs): an empty
// declared list and a populated whole-inferred literal.
const rowType = { $record: { fields: [field(ids.amount, "amount", { $ref: "Number" }),
  field(ids.personField, "person", { $record: { fields: [field(ids.name, "name", { $ref: "String" }), field(ids.phone, "phone", { $ref: "String" })] } }),
  field(ids.date, "date", { $record: { fields: [field(ids.year, "year", { $ref: "Number" }), field(ids.month, "month", { $ref: "Number" }), field(ids.day, "day", { $ref: "Number" })] } })] } };
const emptyInput: DataSuggestionInput = { revision: "grouping-empty", value: [],
  expression: { kind: "literal", value: { __ann: { expr: { kind: "literal", value: [] }, type: foundation.List(rowType as never) } } } as never };
const populatedInput: DataSuggestionInput = { revision: "grouping-populated", value: rows, expression: { kind: "literal", value: rows } as never };
const grouped = (batch: { suggestions: DataSuggestion[]; undecided: DataSuggestion[] }) =>
  [...batch.suggestions, ...batch.undecided].filter(row => (row.plan as { $tag: string }).$tag === "SuggestionGroupedProjection");
const evaluateNode = (node: unknown) => expressions.evaluate(authoringExpression.exprNodeToLogic(node as never) as never, {}, session.evaluateContext);
const reportOf = (batch: Awaited<ReturnType<typeof suggestions.discoverDataSuggestions>>) => JSON.stringify({ coverage: batch.coverage,
  rows: [...batch.suggestions, ...batch.undecided].map(row => ({ label: row.label, identity: row.identity, applicability: row.applicability, reasons: row.reasons })) });

describe("Suggestions: Group by <field>", () => {
  for (const [name, selectedInput] of [["empty declared", emptyInput], ["populated", populatedInput]] as const) {
    test(`a ${name} list of transaction rows offers one grouping per field, mirroring the mapped ones`, async () => {
      const batch = await suggestions.discoverDataSuggestions(session, selectedInput, { reuse: false, maxOperations: 0, maxSuggestions: 40 });
      const plans = grouped(batch);
      const report = reportOf(batch);
      expect(plans.map(row => row.label).sort(), report).toEqual(["Group by amount", "Group by date", "Group by person"]);
      const mapped = [...batch.suggestions, ...batch.undecided].filter(row => (row.plan as { $tag: string }).$tag === "SuggestionMappedProjection");
      for (const row of plans) {
        // Same reflected FieldKey as the mapped twin, distinct recipe identity, and
        // the same admission verdict: grouping adds no check of its own. The
        // populated list confirms both; in this detached harness the declared
        // empty list leaves both undecided ("field projection receiver remains
        // underdetermined"), an existing mapped-projection limit, not a grouping one.
        const twin = mapped.find(item => item.identity === row.identity.replace(/^grouped-field:/, "mapped-field:"));
        expect(twin, `${row.label} ${report}`).toBeDefined();
        expect(row.applicability, `${row.label} ${report}`).toEqual(twin!.applicability);
        if (name === "populated") expect(row.applicability, `${row.label} ${report}`).toEqual({ $tag: "Just", _0: true });
        expect(row.family).toBe("grouping");
        expect(row.icon).toBe("layers");
        expect(row.identity.startsWith("grouped-field:")).toBe(true);
        if (name === "populated") expect(row.resultScheme, row.label).toBeDefined();
        expect(mapped.map(item => item.identity)).not.toContain(row.identity);
      }
      if (name === "populated") {
        const byPerson = plans.find(row => row.label === "Group by person")!;
        const prepared = suggestions.prepareDataSuggestion(session, byPerson, selectedInput);
        if (!prepared.ok) throw new Error(prepared.issue);
        const result = evaluateNode(prepared.node) as { $tag: string; _0: { $tag: string; entries: Array<{ key: unknown; value: Array<{ amount: number }> }> } };
        expect(result.$tag).toBe("Just");
        expect(result._0.$tag).toBe("OrdinaryMap");
        expect(result._0.entries.map(entry => ({ key: entry.key, amounts: entry.value.map(t => t.amount) }))).toEqual([
          { key: person("Alex", "+14155552671"), amounts: [10, 30] },
          { key: person("Alex", "+14155552672"), amounts: [20] },
          { key: person("Sam", "+14155552673"), amounts: [40] },
        ]);
        const byDate = plans.find(row => row.label === "Group by date")!;
        const preparedDate = suggestions.prepareDataSuggestion(session, byDate, selectedInput);
        if (!preparedDate.ok) throw new Error(preparedDate.issue);
        const dates = evaluateNode(preparedDate.node) as typeof result;
        expect(dates._0.entries.map(entry => entry.key)).toEqual([{ year: 2024, month: 2, day: 29 }, { year: 2024, month: 3, day: 1 }, { year: 2024, month: 12, day: 31 }]);
        // M9: aggregations per key, derived from the row fields; the checker
        // admits only Number amounts (amount), so person/date are never summed.
        const labels = batch.suggestions.map(row => row.label);
        for (const label of ["Count per amount", "Count per date", "Count per person", "Sum of amount per date", "Sum of amount per person"])
          expect(labels, report).toContain(label);
        expect(labels.filter(label => /^Sum of (person|date) /.test(label)), report).toEqual([]);
        const sumPerPerson = batch.suggestions.find(row => row.label === "Sum of amount per person")!;
        expect(sumPerPerson.family).toBe("aggregate");
        const preparedSum = suggestions.prepareDataSuggestion(session, sumPerPerson, selectedInput);
        if (!preparedSum.ok) throw new Error(preparedSum.issue);
        const sums = evaluateNode(preparedSum.node) as { _0: { entries: Array<{ key: unknown; value: number }> } };
        expect(sums._0.entries.map(entry => [entry.key, entry.value])).toEqual([
          [person("Alex", "+14155552671"), 40], [person("Alex", "+14155552672"), 20], [person("Sam", "+14155552673"), 40]]);
        const countPerPerson = batch.suggestions.find(row => row.label === "Count per person")!;
        const preparedCount = suggestions.prepareDataSuggestion(session, countPerPerson, selectedInput);
        if (!preparedCount.ok) throw new Error(preparedCount.issue);
        expect((evaluateNode(preparedCount.node) as typeof sums)._0.entries.map(entry => entry.value)).toEqual([2, 1, 1]);
        console.info("[grouping-result-schemes]", JSON.stringify(Object.fromEntries(plans.map(row => [row.label, row.resultScheme]))).slice(0, 4000));
      }
    }, 600_000);
  }

  // Demo 1 (2026-11-07), review B4: Home passes the authored copy for checks and
  // the card's own reference (`<root>:<card>`) for new data. The reference never
  // changes discovery: the same rows and verdicts; only the prepared recipe of
  // new data reads it, so the grouping follows the card's edits.
  test("a card reference changes no verdict; the prepared recipe reads the reference and follows an edit", async () => {
    const id = "tab:transactions";
    const body = { kind: "literal", value: rows } as never;
    const referenceInput: DataSuggestionInput = { ...populatedInput, revision: "grouping-reference",
      reference: { kind: "ref", savedExprId: id } as never, savedExpressions: [[id, body]] };
    const verdicts = (batch: Awaited<ReturnType<typeof suggestions.discoverDataSuggestions>>) =>
      [...batch.suggestions, ...batch.undecided].map(row => [row.identity, row.label, row.applicability]);
    const copied = await suggestions.discoverDataSuggestions(session, { ...populatedInput, revision: "grouping-reference" }, { reuse: false, maxOperations: 0, maxSuggestions: 40 });
    const referenced = await suggestions.discoverDataSuggestions(session, referenceInput, { reuse: false, maxOperations: 0, maxSuggestions: 40 });
    expect(verdicts(referenced)).toEqual(verdicts(copied));
    const byPerson = referenced.suggestions.find(row => row.label === "Group by person");
    expect(byPerson?.applicability, reportOf(referenced)).toEqual({ $tag: "Just", _0: true });
    const prepared = suggestions.prepareDataSuggestion(session, byPerson!, referenceInput);
    if (!prepared.ok) throw new Error(prepared.issue);
    expect(JSON.stringify(prepared.node)).toContain(`"savedExprId":"${id}"`);
    const evaluated = (current: unknown) => expressions.evaluate(authoringExpression.exprNodeToLogic(prepared.node,
      { resolver: key => key === id ? current as never : undefined }) as never, {}, session.evaluateContext) as
      { $tag: string; _0: { entries: Array<{ key: { name: string }; value: Array<{ amount: number }> }> } };
    expect(evaluated(body)._0.entries.map(entry => entry.value.map(t => t.amount))).toEqual([[10, 30], [20], [40]]);
    // The same recipe follows a changed source: Sam's transaction now belongs to Alex.
    const moved = { kind: "literal", value: rows.map(row => row.amount === 40 ? { ...row, person: person("Alex", "+14155552671") } : row) };
    expect(evaluated(moved)._0.entries.map(entry => entry.value.map(t => t.amount))).toEqual([[10, 30, 40], [20]]);
    // Apply here prepares over the authored copy only (no reference to the data itself).
    const own = suggestions.prepareDataSuggestion(session, byPerson!, { ...referenceInput, reference: undefined });
    if (!own.ok) throw new Error(own.issue);
    expect(JSON.stringify(own.node)).not.toContain(id);
  }, 600_000);

  // Demo 1 (2026-11-07) Slice 2: the default click. Reverse keeps the list's
  // type (Apply here, Rom: "reverse, sort" apply in place); a grouping changes
  // the type (New data from this).
  test("the default destination: Apply here for a type-keeping result, New data otherwise", async () => {
    const batch = await suggestions.discoverDataSuggestions(session, { ...populatedInput, revision: "disposition" },
      { reuse: false, maxOperations: 8, maxSuggestions: 40 });
    const report = JSON.stringify(batch.suggestions.map(row => [row.label, row.replaceable, row.disposition]));
    const reverse = batch.suggestions.find(row => row.label === "Reverse");
    const byDate = batch.suggestions.find(row => row.label === "Group by date");
    expect(reverse?.replaceable, report).toEqual({ $tag: "Just", _0: true });
    expect(reverse?.disposition, report).toBe("ApplyToDraft");
    expect(byDate?.replaceable, report).toEqual({ $tag: "Just", _0: false });
    expect(byDate?.disposition, report).toBe("CreateDerivedData");
  }, 600_000);

  // Polish lane B 7b (2026-11-08): a grouping with a catalogue function id is a
  // direct, readable call (`groupByKey (\row -> row.date) <data>`), not a
  // do-block binding the callable value; and the grouping card itself is then
  // checked, so its own Suggestions (Count per key) are confirmed, not unresolved.
  test("Group by date prepares a direct call, and the grouping card's own Suggestions check", async () => {
    const batch = await suggestions.discoverDataSuggestions(session, { ...populatedInput, revision: "direct-call" },
      { reuse: false, maxOperations: 0, maxSuggestions: 40 });
    const byDate = batch.suggestions.find(row => row.label === "Group by date");
    expect(byDate, reportOf(batch)).toBeDefined();
    const prepared = suggestions.prepareDataSuggestion(session, byDate!, { ...populatedInput, revision: "direct-call" });
    if (!prepared.ok) throw new Error(prepared.issue);
    const node = prepared.node as { kind: string; fnId?: string; args?: Array<{ kind: string; value?: unknown }> };
    expect(node.kind, JSON.stringify(node).slice(0, 600)).toBe("call");
    expect(node.fnId).toBe(environment.resolveFunctionId("std.groupByKey"));
    expect(node.args?.length).toBe(2);
    expect(JSON.stringify(node.args![0])).toContain("__lambda");
    const countId = environment.resolveFunctionId("std.countPerKey");
    const withCount: AuthoringSession = Object.freeze({ ...complete, catalog: Object.freeze({ ...complete.catalog,
      functions: Object.freeze(complete.catalog.functions.filter(entry => (entry.targetId ?? entry.id) === countId)) as AuthoringSession["catalog"]["functions"] }) });
    const card: DataSuggestionInput = { revision: "grouping-card", expression: prepared.node };
    const own = await suggestions.discoverDataSuggestions(withCount, card, { reuse: false, maxOperations: 8, maxSuggestions: 40 });
    const ownReport = reportOf(own);
    expect(own.coverage.reason ?? "", ownReport).not.toContain("could not be confirmed");
    const count = own.suggestions.find(row => (row.plan as { operation?: { payload: { functionId: string } } }).operation?.payload.functionId === countId);
    expect(count?.applicability, ownReport).toEqual({ $tag: "Just", _0: true });
  }, 600_000);

  // Polish lane B item 6 (2026-11-08): each field-derived action says what it
  // computes (Fenel view.suggestionSentence), shown under its row.
  test("field-derived actions carry their sentence", async () => {
    const batch = await suggestions.discoverDataSuggestions(session, { ...populatedInput, revision: "sentences" },
      { reuse: false, maxOperations: 0, maxSuggestions: 40 });
    const sentenceOf = (label: string) => batch.suggestions.find(row => row.label === label)?.sentence;
    const report = JSON.stringify(batch.suggestions.map(row => [row.label, row.sentence]));
    expect(sentenceOf("Group by date"), report).toBe("Items grouped by date");
    expect(sentenceOf("Count per person"), report).toBe("Number of items per person");
    expect(sentenceOf("Sum of amount per person"), report).toBe("Total amount per person");
    expect(sentenceOf("Get date from each item"), report).toBe("The date of each of the items");
    // Nominal rows read by their type's spoken plural.
    const listType = foundation.List({ $ref: handleOf(ids.transaction) });
    const nominal = rows.map(row => ({ $tag: ids.transaction, ...row, person: { $tag: ids.person, ...row.person } }));
    const typed = await suggestions.discoverDataSuggestions(session, { revision: "sentences-nominal", value: nominal, type: listType,
      expression: { kind: "literal", value: { __ann: { expr: { kind: "literal", value: nominal }, type: listType } } } as never },
      { reuse: false, maxOperations: 0, maxSuggestions: 40 });
    const name = registry.getIdentifiedEntity(ids.transaction)?.id ?? "";
    const grouped = [...typed.suggestions, ...typed.undecided].find(row => row.label === "Group by date");
    console.info("[sentence-nominal]", name, grouped?.sentence);
    if (grouped?.sentence) expect(grouped.sentence.endsWith(" grouped by date")).toBe(true);
  }, 600_000);

  // Recorded, not gated: nominal Local Person/Transaction rows in this detached
  // harness (no Local source function). Whatever it offers for mapped fields, the
  // grouped plans must match one for one.
  test("nominal Local rows: grouped plans mirror the mapped ones", async () => {
    const listType = foundation.List({ $ref: handleOf(ids.transaction) });
    const nominal = rows.map(row => ({ $tag: ids.transaction, ...row, person: { $tag: ids.person, ...row.person } }));
    const seen = new Map<string, unknown>();
    for (const [label, value, viaReference] of [["empty", [], false], ["populated", nominal, false], ["populated by reference", nominal, true]] as const) {
      const authored = { kind: "literal", value: { __ann: { expr: { kind: "literal", value }, type: listType } } } as never;
      // A card reference (demo 1, review B4) is never the checked expression.
      const selectedInput: DataSuggestionInput = { revision: `nominal-${label}`, value, type: listType, expression: authored,
        ...(viaReference ? { reference: { kind: "ref", savedExprId: "tab:nominal" } as never, savedExpressions: [["tab:nominal", authored]] as const } : {}) };
      const batch = await suggestions.discoverDataSuggestions(session, selectedInput, { reuse: false, maxOperations: 0, maxSuggestions: 40 });
      const all = [...batch.suggestions, ...batch.undecided];
      const of = (tag: string) => all.filter(row => (row.plan as { $tag: string }).$tag === tag).map(row => row.identity.replace(/^[a-z]+-field:/, "")).sort();
      console.info("[grouping-nominal]", label, reportOf(batch).slice(0, 1500));
      expect(of("SuggestionGroupedProjection")).toEqual(of("SuggestionMappedProjection"));
      seen.set(label, all.map(row => [row.identity, row.applicability]));
    }
    // Gated (review B4): the reference never changes a verdict for nominal rows.
    expect(seen.get("populated by reference")).toEqual(seen.get("populated"));
  }, 600_000);
});
