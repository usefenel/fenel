import { describe, expect, test } from "bun:test";
import { projectAuthoredRead } from "./locus-expression-edit";
import { followLocusPath } from "./locus-reference";
import { resolveLocusCatalogReference } from "./locus-catalog-reference";
import { valueAt, childrenOf } from "./locus-scope";
import { Nothing } from "@fenel/engine/type-foundation";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { reactiveAuthoringSession, concreteAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { ModuleRegistry } from "@fenel/engine/registry";

// Execute Home's value-lens read with its memos as plain functions. A retired
// worker (a Local rebuild of this source, or its worker restoration) is a
// preparing state; it must never surface as the lens's failure answer.
const source = (await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const start = source.indexOf("  const valueScopeWorker");
const startRetired = source.indexOf("  // A retired worker (a rebuild of this source is running");
const end = source.indexOf("  const [valueScopeRefreshes", start);
if (start < 0 || end <= start) throw new Error("Home's value scope read moved.");
const slice = source.slice(startRetired >= 0 && startRetired < start ? startRetired : start, end);
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(`function read() {\n${slice}\nreturn valueScopeResult; }`);
const referencesFrom = source.indexOf("function localReferenceResolver("), referencesTo = source.indexOf("/** B4 wave 4 lane H", referencesFrom);
if (referencesFrom < 0 || referencesTo < referencesFrom) throw new Error("Home reference resolver moved");
const referenceResolver = new Function("resolveLocusCatalogReference", "runLocalReaderAction",
  new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(referencesFrom, referencesTo)) + "; return localReferenceResolver;")
  (resolveLocusCatalogReference, () => { throw new Error("The scalar source fixture requested unrelated reference IO"); });

async function outcome(value: unknown): Promise<unknown> {
  if (!(value instanceof Promise)) return value;
  return Promise.race([value, new Promise(resolve => setTimeout(() => resolve("pending"), 50))]);
}

function fixture(options: { expression?: ExprNode; path?: readonly (string | number)[]; type?: FenelType;
  result?: unknown; childType?: (value: unknown, type: FenelType | undefined, key: string | number) => FenelType | undefined } = {}) {
  let retired = false;
  const worker = { token: {} };
  const session = { registry: { getIdentifiedEntity: () => undefined }, evaluateContext: {}, environment: {} };
  const item = { id: "card" };
  const expression = options.expression ?? { kind: "literal", value: 1 };
  const reads: unknown[] = [], projections: unknown[] = [];
  const replaced = () => { throw new Error("This authoring snapshot was replaced. Retry with the current data."); };
  const bindings = {
    createMemo: <T>(compute: () => T) => compute,
    untrack: <T>(read: () => T) => read(),
    scope: () => ({ kind: "value", viewId: "list", itemId: "card", path: options.path ?? [] }),
    transferSession: () => session,
    reader: { kind: "local", catalog: () => [], templates: () => ({ list: () => [], listComponentNames: () => [] }),
      catalogLookups: { fn: () => undefined, entityType: () => undefined, typeFamilyOwner: () => undefined, entry: () => undefined } },
    webRegistry: {}, LUCIDE_BY_NAME: {},
    authoringWorkerReplacementPending: () => retired,
    authoringWorkerRetired: () => retired,
    authoringWorkerSnapshot: () => retired ? replaced() : worker.token,
    draftRevision: () => 0,
    rowById: () => ({ id: "list", view: {} }),
    viewPersistence: { read: () => ({ items: [item] }) },
    asView: (view: unknown) => view,
    findLocusItem: () => item,
    savedExprById: () => new Map(),
    resolveExpr: () => expression,
    expressionEditOptions: (captured: unknown) => { expect(captured).toBe(session); return {}; },
    projectAuthoredRead,
    getCatalog: () => [],
    createReaderPresentation: () => ({ catalogEntry: () => undefined }),
    resolveLocusCatalogReference: () => undefined,
    homeData: { type: () => options.type },
    savedQueryForItem: () => undefined,
    rootSourceTicket: () => undefined,
    root: () => ({ revision: 3 }),
    scopeKey: () => "value:card",
    sessionEpoch: () => 0,
    evaluateLocusCard: async (node: unknown) => { reads.push(node); return retired ? replaced() : { result: Object.hasOwn(options, "result") ? options.result : 1 }; },
    preparedReaderWorkerForSession: () => retired ? undefined : worker.token,
    runPreparedReaderWorker: async (handle: unknown, request: unknown) => { expect(handle).toBe(worker.token); projections.push(request); return { valueReads: [{ root: {}, children: [] }] }; },
    projectReaderValueReadInSession: () => { throw new Error("Local read escaped to the page"); },
    assertCurrentSession: () => {},
    client: {},
    assertSourceTicket: () => {},
    localReferenceResolver: referenceResolver,
    followLocusPath,
    readLocusCatalogReference: () => undefined,
    childValueType: options.childType ?? (() => undefined),
    valueAt,
    resolveValueType: () => undefined,
    isFenelTypeLike: () => false,
    childrenOf,
  };
  const read = new Function(...Object.keys(bindings), `${code}; return read();`)(...Object.values(bindings)) as () => unknown;
  return { read, reads, projections, expression, retire: () => { retired = true; }, restore: () => { retired = false; worker.token = {}; } };
}

const record = (fields: Record<string, ExprNode>): ExprNode => ({ kind: "literal", value: { __record: {
  fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
} } });
const recordType = (fields: Record<string, FenelType>): FenelType => ({ $record: { fields: Object.entries(fields).map(([name, type]) => ({
  name, type, label: Nothing, ui: Nothing, meta: {},
})) } });

describe("Home value lens during a worker retirement", () => {
  test("a scoped record read evaluates only its selected producer and preserves the original source and edit path", async () => {
    const selected: ExprNode = { kind: "ref", savedExprId: "project" };
    const unrelated: ExprNode = { kind: "call", fnId: "unrelated-heavy-work", args: [] };
    const source = record({ Demo: record({ Fenel: selected, Other: unrelated }), Std: unrelated });
    const f = fixture({ expression: source, path: ["Demo", "Fenel"],
      type: recordType({ Demo: recordType({ Fenel: { $ref: "Project" }, Other: { $ref: "Any" } }), Std: { $ref: "Any" } }), result: { name: "Fenel" } });
    const answer = await outcome(f.read()) as { sourceExpression: ExprNode };
    expect(answer).toMatchObject({ ok: true, rootValue: { name: "Fenel" }, container: { name: "Fenel" },
      basePath: ["Demo", "Fenel"], rootValueType: { $ref: "Project" } });
    expect(f.reads).toEqual([selected]);
    expect(answer.sourceExpression).toBe(source);
    expect(f.projections).toHaveLength(1);
  });

  test("residual computed paths use the actual producer value and type", async () => {
    const computed: ExprNode = { kind: "call", fnId: "computed", args: [] };
    const value = { answer: 42 }, computedType = recordType({ answer: { $ref: "Number" } });
    const f = fixture({ expression: record({ selected: computed }), path: ["selected", "answer"],
      type: recordType({ selected: computedType }), result: value,
      childType: (actual, type, key) => { expect(actual).toBe(value); expect(type).toBe(computedType); expect(key).toBe("answer"); return { $ref: "Number" }; } });
    expect(await outcome(f.read())).toMatchObject({ ok: true, container: 42, containerType: { $ref: "Number" }, basePath: ["selected"] });
    expect(f.reads).toEqual([computed]);
  });

  test("dependent prefixes retain the enclosing source rather than invent a parent value", async () => {
    const source = record({ selected: { kind: "literal", value: 42 } });
    const value = { selected: 42 };
    const f = fixture({ expression: source, path: ["selected"], type: recordType({ selected: { $el: { var: "sibling" } } }), result: value,
      childType: actual => { expect(actual).toBe(value); return { $ref: "Number" }; } });
    expect(await outcome(f.read())).toMatchObject({ ok: true, container: 42, basePath: [] });
    expect(f.reads).toEqual([source]);
  });
  test("stays pending while retired and answers again once the worker is restored", async () => {
    const f = fixture();
    expect(await outcome(f.read())).toMatchObject({ ok: true, rootValue: 1 });
    f.retire();
    let answer: unknown;
    try { answer = await outcome(f.read()); }
    catch (error) { answer = { thrown: (error as Error).message }; }
    expect(answer).toBe("pending");
    f.restore();
    expect(await outcome(f.read())).toMatchObject({ ok: true, rootValue: 1 });
  });

  test("a retirement during the read is pending, not a failure answer", async () => {
    const f = fixture();
    const reading = f.read();
    f.retire();
    expect(await outcome(reading)).toBe("pending");
  });
});

describe("projected producer ancestor reads and public handoff", () => {
  const from = source.indexOf("  function assertValueScopeCurrent("), to = source.indexOf("  async function liftItem(", from);
  if (from < 0 || to < from) throw new Error("Projected ancestor read boundary moved");
  const helperCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(from, to));
  function ancestorFixture() {
    const session = {}, worker = {}, ticket = {};
    const selectedValue = { items: [1, 2] };
    const expression = record({ selected: record({ items: { kind: "literal", value: [1, 2] } }), unrelated: { kind: "call", fnId: "heavy", args: [] } });
    const state = { rootValue: selectedValue, rootValueType: recordType({ items: { $ref: "List" } }), basePath: ["selected"],
      itemType: recordType({ selected: recordType({ items: { $ref: "List" } }), unrelated: { $ref: "Any" } }),
      sourceExpression: expression, sourceSnapshot: new Map(), sourceSession: session, sourceWorker: worker,
      expressionOptions: {}, epoch: 7, scopeIdentity: "original-scope", rootRevision: 3, sourceTicket: ticket };
    const runtime = { active: state as unknown, epoch: 7, scope: state.scopeIdentity, revision: 3, session, worker, ticket,
      cached: undefined as undefined | { result: unknown }, controller: new AbortController() };
    const calls: unknown[] = [];
    let finish!: (answer: { result: unknown }) => void;
    const bindings = { valueAt, projectAuthoredRead, valueScope: () => runtime.active,
      assertCurrentSession: (epoch: number) => { if (epoch !== runtime.epoch) throw new Error("Source epoch changed"); },
      client: { signal: runtime.controller.signal }, assertSourceTicket: (value: unknown) => { if (value !== runtime.ticket) throw new Error("Source ticket changed"); },
      scope: () => ({}), scopeKey: () => runtime.scope, root: () => ({ revision: runtime.revision }),
      transferSession: () => runtime.session, authoringWorkerSnapshot: () => runtime.worker,
      readLocusCardResult: (node: unknown, saved: unknown, owner: unknown) => { expect(node).toBe(expression); expect(saved).toBe(state.sourceSnapshot); expect(owner).toBe(session); return runtime.cached; },
      evaluateLocusCard: (node: unknown, saved: unknown, owner: unknown, options: { signal: unknown }) => {
        expect(node).toBe(expression); expect(saved).toBe(state.sourceSnapshot); expect(owner).toBe(session);
        expect(options.signal).toBe(runtime.controller.signal); calls.push(node);
        return new Promise<{ result: unknown }>(resolve => { finish = resolve; });
      } };
    const api = new Function(...Object.keys(bindings), `${helperCode}; return { valueScopeParentValue, valueScopeBreadcrumbRead };`)(...Object.values(bindings));
    return { ...api, state, runtime, calls, selectedValue, finish: (value: unknown) => finish({ result: value }) };
  }

  test("ancestor previews never evaluate a missing parent and descendants retain the true producer base", () => {
    const f = ancestorFixture();
    expect(f.valueScopeBreadcrumbRead(f.state, [])).toEqual({ known: false, type: f.state.itemType });
    expect(f.valueScopeBreadcrumbRead(f.state, ["selected", "items"]))
      .toEqual({ known: true, value: f.selectedValue, type: f.state.rootValueType, path: ["items"] });
    expect(f.calls).toEqual([]);
    f.runtime.cached = { result: { selected: f.selectedValue, unrelated: "already read" } };
    expect(f.valueScopeBreadcrumbRead(f.state, []).value).toBe(f.runtime.cached.result);
    expect(f.calls).toEqual([]);
  });

  test("an explicit ancestor read uses the original source and same captured reader", async () => {
    const f = ancestorFixture();
    expect(await f.valueScopeParentValue(f.state, ["selected", "items"])).toBe(f.selectedValue.items);
    expect(f.calls).toEqual([]);
    const pending = f.valueScopeParentValue(f.state, []), parent = { selected: f.selectedValue, unrelated: "whole parent" };
    expect(f.calls).toEqual([f.state.sourceExpression]);
    f.finish(parent);
    expect(await pending).toBe(parent);
  });

  test("an explicit parent read refuses changed scope, state, revision, session, worker, epoch or source", async () => {
    for (const axis of ["scope", "active", "revision", "session", "worker", "epoch", "ticket", "closed"]) {
      const f = ancestorFixture(), pending = f.valueScopeParentValue(f.state, []);
      if (axis === "scope") f.runtime.scope = "another scope";
      else if (axis === "active") f.runtime.active = {};
      else if (axis === "revision") f.runtime.revision++;
      else if (axis === "epoch") f.runtime.epoch++;
      else if (axis === "closed") f.runtime.controller.abort();
      else f.runtime[axis as "session" | "worker" | "ticket"] = {};
      f.finish({ selected: f.selectedValue });
      await expect(pending).rejects.toThrow();
    }
  });

  test("public handoff retains only its exact source-capture facade without borrowing an account session", () => {
    const start = source.indexOf("  function transferSession()"), end = source.indexOf("  // References are followed", start);
    if (start < 0 || end < start) throw new Error("Source session boundary moved");
    const install = new Function("props", "reader", "homeAuthoringSession", "concreteAuthoringSession",
      `${new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end))}; return transferSession;`);
    const environment = createAuthoringEnvironment();
    const base: AuthoringSession = { mode: "detached", registry: {} as ModuleRegistry, catalog: environment.catalog, environment, evaluateContext: {} };
    const facade = reactiveAuthoringSession(() => base);
    expect(install({ publicData: { session: base } }, { kind: "public" }, () => facade, concreteAuthoringSession)()).toBe(facade);
    expect(install({ publicData: { session: base } }, { kind: "account" }, () => { throw new Error("Account was borrowed"); }, concreteAuthoringSession)()).toBe(base);
    const other: AuthoringSession = { ...base, registry: {} as ModuleRegistry };
    expect(() => install({ publicData: { session: base } }, { kind: "public" }, () => other, concreteAuthoringSession)()).toThrow("reader changed");
  });
});
