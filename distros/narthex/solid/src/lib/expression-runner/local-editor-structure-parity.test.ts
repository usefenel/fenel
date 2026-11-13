import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";

// B4 F2 parity over a real Local registry (the F1 parity fixture's tab: one
// function with an identified parameter, over the repository): what a Local
// expression editor now reads instead of its page session answers what the
// page session answered.
// - The published structure environment equals the session's own environment
//   on every structure read, over every catalogue type and function.
// - Worker parameter names (`project-reader-field-names`), composed on the
//   page, equal `parameterDisplayName` over the page registry.
// - Engine-body draft analyses (binding names, call candidates) answer the
//   same with no page frame; occurrence inspection finds the occurrence with
//   none (the Local registry's page frame refuses it: recorded divergence).
// - Page-side call guidance with abstaining literal membership gives the
//   page's slots, except where a literal witness specialized a type variable:
//   there it equals the page's plan with those inputs blank (more generic,
//   never a guessed type; recorded divergence).
// - `judge-reader-compatibility` equals the page's judgments with its registry.
// Heavy: one Local registry; run alone in the heavy slot.
const fixture = await import("./reader-function-options.fixture");
const [catalogue, mint, extensions, accountSession, detached, environmentTools, codec, seeds, widgets, display, fieldNames, membership,
  plan, bindings] = await Promise.all([
  import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("./account-authoring-session"), import("./detached-authoring-environment"),
  import("@fenel/engine/authoring/environment"), import("./expr-node-codec"), import("./creation-seed"), import("./inline-widgets"),
  import("./call-display"), import("./local-field-names"), import("./literal-membership"), import("./call-argument-plan"),
  import("@fenel/engine/authoring/binding-edits"),
]);
console.info("[f2-parity] building the Local registry");
const { registry } = await fixture.buildParityRegistry();
const catalog = catalogue.buildSessionCatalog(registry);
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([fixture.SOURCE]) as unknown as string[] });
const base = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame }) as unknown as AuthoringSession;
const local = accountSession.createLocalAuthoringSession(base, { sourceId: fixture.SOURCE, functions: [fixture.definition as never] });
const published = accountSession.publishedAuthoringEnvironment(local)!;
console.info(`[f2-parity] ready: ${local.environment.catalog.functions.length} functions, ${local.environment.catalog.types.length} types`);

const functions = local.environment.catalog.functions;
const types: FenelType[] = [...local.environment.catalog.types.flatMap(row => row.type ? [row.type] : []),
  ...local.environment.catalog.types.map(row => ({ $ref: row.entityId ?? row.name }) as FenelType),
  ...functions.slice(0, 400).flatMap(entry => [...entry.params.map(param => param.type), entry.returns])];

describe("B4 F2: a Local editor's replacements for its page session answer as the page session", () => {
  test("the published environment answers every structure read as the session's environment", () => {
    expect(published).toBeDefined();
    expect(types.length).toBeGreaterThan(100);
    const own = local.environment;
    let compared = 0;
    for (const type of types) {
      const same = <T>(read: (env: typeof own) => T) => {
        let left: unknown, right: unknown;
        try { left = read(published); } catch (error) { left = `throws ${String(error)}`; }
        try { right = read(own); } catch (error) { right = `throws ${String(error)}`; }
        expect(left).toEqual(right);
        compared++;
      };
      same(env => seeds.seedExpressionForType(type, env));
      same(env => codec.recordFieldsForType(type, env));
      same(env => environmentTools.expectedSchemeForType(type, env));
      same(env => widgets.inlineWidgetFor(type, undefined, env));
      same(env => codec.typeDisplayName(type, env));
      same(env => codec.peelToArrowType(type, env));
    }
    for (const entry of functions) {
      for (const id of [entry.id, entry.targetId ?? entry.id]) {
        expect(published.getFunctionEntry?.(id, entry.params.length)).toEqual(own.getFunctionEntry?.(id, entry.params.length));
        expect(published.resolveFunctionId(id)).toEqual(own.resolveFunctionId(id));
        expect(published.functionCodeName(id)).toEqual(own.functionCodeName(id));
      }
      if (entry.kind === "constructor") expect(codec.constructorFieldsForTag(entry.id, published)).toEqual(codec.constructorFieldsForTag(entry.id, own));
    }
    console.info(`[f2-parity] structure reads compared: ${compared} over ${types.length} types, ${functions.length} functions`);
  });

  test("worker parameter names, composed on the page, equal the page registry's", async () => {
    const params: Array<{ field: FieldDef; ordinal: number }> = [];
    for (const fn of registry.listFunctions()) fn.params?.forEach((field, ordinal) => {
      if (field.key?.$tag === "NamedField") params.push({ field, ordinal });
    });
    params.push(...fixture.definition.params.map((field, ordinal) => ({ field: field as unknown as FieldDef, ordinal })));
    expect(params.length).toBeGreaterThan(0);
    const ids = [...new Set(params.map(({ field }) => (field.key as { ref: { $ref: string } }).ref.$ref))];
    const answers = new Map<string, unknown>();
    for (let start = 0; start < ids.length; start += extensions.READER_FIELD_NAMES_LIMIT) {
      const chunk = ids.slice(start, start + extensions.READER_FIELD_NAMES_LIMIT);
      const reply = structuredClone(await extensions.runReaderExtension({ method: "project-reader-field-names", fieldIds: chunk, priority: "guidance" } as never,
        local, undefined, async () => {})) as { fieldNames: unknown[] };
      chunk.forEach((id, index) => answers.set(id, reply.fieldNames[index]));
    }
    let compared = 0, unavailable = 0;
    for (const { field, ordinal } of params) {
      const answer = answers.get((field.key as { ref: { $ref: string } }).ref.$ref) as { unavailable?: true; label?: string; codeName?: string };
      let page: unknown;
      try { page = display.parameterDisplayName(field, ordinal, registry); } catch { page = "throws"; }
      if (answer.unavailable) { unavailable++; expect(page).toBe("throws"); continue; }
      expect(fieldNames.localParameterName(field, ordinal, answer) as unknown).toEqual(page);
      compared++;
    }
    console.info(`[f2-parity] parameter names compared: ${compared}, unavailable (the page throws): ${unavailable}`);
    await expect(extensions.runReaderExtension({ method: "project-reader-field-names", fieldIds: ids.slice(0, 1) } as never,
      local, undefined, async () => {})).rejects.toThrow("could not be read");
  });

  test("engine-body draft analyses answer the same with no page frame", () => {
    const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
    const drafts: ExprNode[] = [literal(1), { kind: "call", fnId: "add", args: [literal(1), literal(2)] },
      literal({ __let: { bindings: [{ name: "x", expr: literal(1) }], body: { kind: "param", name: "x" } } }),
      literal({ __let: { bindings: [{ name: "1bad", expr: literal(1) }], body: literal(2) } }),
      literal({ __lambda: { params: ["n"], body: { kind: "param", name: "n" } } })];
    for (const draft of drafts) expect(bindings.authoringBindingNameIssue(draft, undefined)).toEqual(bindings.authoringBindingNameIssue(draft, frame));
    for (const requiresInput of [false, true]) expect(bindings.selectAuthoringCallCandidates(functions, requiresInput, undefined))
      .toEqual(bindings.selectAuthoringCallCandidates(functions, requiresInput, frame));
    // Occurrence inspection: with no frame the engine body finds the
    // occurrence; under this Local registry's frame (with or without the
    // tab's tag) it refuses ("Binding path is not a list"). A Local editor no
    // longer offers the engine body its page frame: recorded divergence (B4 F2).
    const root = drafts[1]!, inner = (root as { args: ExprNode[] }).args[1]!;
    const free = bindings.inspectAuthoringExpressionOccurrence(root, inner, undefined);
    expect(free).toMatchObject({ ok: true, value: { path: ["args", 1] } });
    const untagged = Object.freeze({ ...frame, _activeTags: Object.freeze([]) as unknown as string[] });
    console.info(`[f2-parity] occurrence inspection: no frame ${JSON.stringify(free.ok)}, tab frame ${JSON.stringify(
      bindings.inspectAuthoringExpressionOccurrence(root, inner, frame).ok)}, frame without the tab's tag ${JSON.stringify(
      bindings.inspectAuthoringExpressionOccurrence(root, inner, untagged).ok)}`);
  });

  test("call guidance with abstaining literal membership equals the page's, except what a literal witness specializes", () => {
    const pageContext = { ...local.environment, bindings: {},
      literalMembership: membership.literalMembershipFor(local.environment, { registry, evaluateContext: frame }) };
    const localContext = { ...published, bindings: {}, literalMembership: () => ({ $tag: "Nothing" }) as never };
    const argsFor = (entry: (typeof functions)[number]): ExprNode[][] => [[],
      entry.params.map(() => ({ kind: "literal", value: undefined })),
      entry.params.map(param => ({ kind: "literal", value: "$ref" in param.type && param.type.$ref === "String" ? "a" : 1 }))];
    let compared = 0, dataDifferences = 0, outcomeOnly = 0;
    const unexplained: string[] = [];
    // Diagnostic: a data-only membership judge (no registry, no frame).
    const dataContext = { ...published, bindings: {}, literalMembership: membership.literalMembershipFor(published, {}) };
    const differences: string[] = [];
    for (const entry of functions.filter(candidate => candidate.signatureOutcome?.$tag === "Solved" && candidate.params.length <= 3).slice(0, 40)) {
      for (const args of argsFor(entry)) {
        const node = { kind: "call" as const, fnId: entry.targetId ?? entry.id, args };
        let page: unknown, mine: unknown;
        // The editor reads a plan's params and paramSchemes (its slots); the
        // plan's own outcome is not read (outcome-only differences counted).
        const shown = (run: () => { params: unknown; paramSchemes: unknown; outcome: unknown }) => {
          try { const result = run(); return { params: result.params, paramSchemes: result.paramSchemes, outcome: result.outcome }; }
          catch (error) { return `throws ${String(error)}`; }
        };
        const pagePlan = shown(() => plan.callArgumentPlan(node, entry, undefined, pageContext as never));
        const localPlan = shown(() => plan.callArgumentPlan(node, entry, undefined, localContext as never));
        if (typeof pagePlan === "object" && typeof localPlan === "object" && !Bun.deepEquals(pagePlan.outcome, localPlan.outcome)) outcomeOnly++;
        page = typeof pagePlan === "object" ? { params: pagePlan.params, paramSchemes: pagePlan.paramSchemes } : pagePlan;
        mine = typeof localPlan === "object" ? { params: localPlan.params, paramSchemes: localPlan.paramSchemes } : localPlan;
        if (!Bun.deepEquals(page, mine)) {
          differences.push(`${entry.id}(${args.map(arg => JSON.stringify((arg as { value?: unknown }).value)).join(", ")})`);
          if (differences.length === 1) console.info(`[f2-parity] first difference: page ${JSON.stringify(page)} local ${JSON.stringify(mine)}`);
          // The only allowed difference: Local guidance takes nothing from a
          // literal witness (abstains), so it equals the page's plan for the
          // same call with those inputs left blank.
          const blank = shown(() => plan.callArgumentPlan({ ...node, args: node.args.map(() => ({ kind: "literal" as const, value: undefined })) },
            entry, undefined, pageContext as never));
          if (!Bun.deepEquals(mine, typeof blank === "object" ? { params: blank.params, paramSchemes: blank.paramSchemes } : blank))
            unexplained.push(differences.at(-1)!);
          const data = shown(() => plan.callArgumentPlan(node, entry, undefined, dataContext as never));
          if (!Bun.deepEquals(page, typeof data === "object" ? { params: data.params, paramSchemes: data.paramSchemes } : data)) dataDifferences++;
        }
        compared++;
      }
    }
    console.info(`[f2-parity] call guidance compared: ${compared}, slot differences: ${differences.length} (data-only judge: ${dataDifferences}), outcome differences: ${outcomeOnly} ${differences.slice(0, 10).join("; ")}`);
    expect(unexplained).toEqual([]);
    expect(differences.length).toBeLessThan(compared / 10);
  });

  test("a record constructor's caption: the worker's owner facts select exactly the page's", () => {
    // What the editor's constructor entry carries (exact targets resolve to
    // the semantic owner rows, `patternConstructors`).
    const owners = [...functions, ...(local.environment.catalog.patternConstructors ?? [])]
      .filter(entry => entry.kind === "constructor" && entry.parentEntity && entry.ownerIdentity);
    expect(owners.length).toBeGreaterThan(0);
    const names = [...new Set(owners.map(entry => entry.parentEntity!))];
    const { references } = extensions.projectReaderReferences(names, local);
    const facts = new Map(references.map(row => [row.target, row.reference]));
    let records = 0;
    for (const entry of owners) {
      const owner = registry.getIdentifiedEntity(entry.parentEntity!);
      const page = registry.getEntityNominalIdentity(entry.parentEntity!) === entry.ownerIdentity && !!owner?.type && "$record" in owner.type;
      const reference = facts.get(entry.parentEntity!);
      const worker = !!reference?.entityType && typeof reference.entityType === "object" && "$record" in reference.entityType
        && reference.entityOwner?.nominalIdentity === entry.ownerIdentity;
      expect({ ctor: entry.id, worker }).toEqual({ ctor: entry.id, worker: page });
      if (page) { records++; expect(reference!.entityOwner!.id).toBe(owner!.id); }
    }
    console.info(`[f2-parity] record-owner captions compared: ${owners.length} constructors, ${records} record owners`);
  });

  test("judge-reader-compatibility equals the page's judgments with its registry", async () => {
    const solved = functions.filter(entry => entry.signatureOutcome?.$tag === "Solved" && entry.scheme && entry.kind !== "constructor").slice(0, 40);
    const expected: FenelType[] = [{ $ref: "Number" }, { $ref: "String" }, { $ref: "Bool" }];
    const items: Array<{ entry: (typeof solved)[number]; expected: FenelType } | { scheme: import("@fenel/engine/types").TypeScheme; expected: FenelType }> =
      solved.flatMap(entry => expected.flatMap(want => {
        const scheme = environmentTools.projectAuthoringScheme(entry.scheme!, ["$arrow", "returns"]);
        return [{ entry, expected: want }, ...(scheme ? [{ scheme, expected: want }] : [])];
      }));
    const reply = structuredClone(await extensions.runReaderExtension({ method: "judge-reader-compatibility", items } as never,
      local, undefined, async () => {})) as { verdicts: unknown[] };
    const page = items.map(item => "scheme" in item
      ? { compatibility: environmentTools.judgeAuthoringSchemeCompatibility(item.scheme, item.expected, { registry }) }
      : { match: environmentTools.rankAuthoringFunctionSuggestions([item.entry], item.expected, { registry })[0]!.match });
    expect(reply.verdicts).toEqual(page);
    console.info(`[f2-parity] compatibility verdicts compared: ${items.length}`);
  });
});
