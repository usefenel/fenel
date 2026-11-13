import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";

// B4 wave 3 lane A (census unit D and item 2), worker side: each new closed
// operation, answered by the real reader-extension router over a structured
// clone in the frame of a real Local registry, equals the page's former code
// run with the same session (the shared owners: `linked-demo-plan.ts`, the
// unchanged `lens-shortcuts.ts`, the transfer helpers and the editor's codec
// adapters). Heavy: one Local registry; run alone in the heavy slot.
const fixture = await import("./reader-function-options.fixture");
const [catalogue, mint, extensions, artifact, plan, lens, transfer, typeCandidate, evaluation, text, slots, engine] = await Promise.all([
  import("./authoring-catalog"), import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
  import("./authoring-worker-reader-extensions"), import("./authoring-catalogue-artifact"), import("../linked-demo-plan"),
  import("../lens-shortcuts"), import("../data-transfer/expressions"), import("../data-transfer/type-candidate"),
  import("./expression-evaluation"), import("./expression-text"), import("@fenel/engine/authoring/signature-authoring"), import("@fenel/engine"),
]);
console.info("[reader-actions] building the Local registry");
const { registry, snapshot } = await fixture.buildParityRegistry();
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([fixture.SOURCE]) as unknown as string[] });
const local = artifact.projectLocalAuthoringCatalogue(registry, frame, { localSourceId: fixture.SOURCE, snapshot,
  entities: [], functions: [fixture.definition as never] });
const environment = catalogue.environmentForCatalog(local.catalog, registry);
const session = Object.freeze({ mode: "detached", registry, evaluateContext: frame, environment, catalog: environment.catalog }) as unknown as AuthoringSession;
console.info("[reader-actions] ready");
const ask = async (query: Record<string, unknown>): Promise<unknown> => structuredClone(await extensions.runReaderExtension(structuredClone(query) as never,
  session, undefined, async () => {}));
const settled = <T>(run: () => T) => { try { return { $tag: "Ok", _0: run() }; } catch (error) { return { $tag: "Err", _0: (error as Error).message }; } };
const literal = (value: unknown) => ({ kind: "literal" as const, value });

describe("B4 unit D: Home's Local starters plan in the worker as on the page", () => {
  for (const kind of ["numbers", "showcase", "recipe"] as const) test(`${kind}: the same commands for the same identities`, async () => {
    // Deterministic identities on both sides (the page's `crypto.randomUUID`).
    let next = 0;
    const original = crypto.randomUUID;
    const counter = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
    const page = settled(() => plan.planLinkedDemoCommands(kind, session, plan.linkedDemoProjection(session), counter));
    next = 0;
    Object.defineProperty(crypto, "randomUUID", { value: counter, configurable: true, writable: true });
    let worker: unknown;
    try { worker = await ask({ method: "plan-reader-linked-demo", kind }); }
    finally { Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true, writable: true }); }
    expect(worker).toEqual({ linkedDemo: structuredClone(page) });
    expect(page).toMatchObject({ $tag: "Ok" });
  });
  test("an unknown starter is refused before any planning", async () => {
    await expect(ask({ method: "plan-reader-linked-demo", kind: "anything" })).rejects.toThrow("could not be read");
  });
});

// Recipes demo L3 (T6): the one-recipe starter. Lube only: its editable
// function, its pantry set (every food drawable) and one recipe card called on
// both saved values. The card equals the source card over the same set.
describe("recipe starter: one recipe, its pantry set and its card", () => {
  test("three saved values and three items; the card reads the recipe and the pantry set", async () => {
    let next = 0;
    const commands = plan.planLinkedDemoCommands("recipe", session, plan.linkedDemoProjection(session),
      () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`) as Array<{ $tag: string; commands: Array<{ entry: { value: any } }> }>;
    expect(commands.map(command => command.$tag)).toEqual(["TabEditValues", "TabEditEntries"]);
    const values = commands[0]!.commands.map(command => command.entry.value);
    const items = commands[1]!.commands.map(command => command.entry.value);
    expect(values.map(value => value.name)).toEqual([
      "Moisturizing-lubrication formula", "Moisturizing-lubrication formula · foods", "Moisturizing-lubrication formula · facts",
    ]);
    expect(items).toHaveLength(3);
    expect(items.map(item => item.source.ref.id)).toEqual(values.map(value => value.id));
    const [recipe, pantries, card] = values;
    const nine = engine.invokeCallable({ $ref: "RecipeFunctions:recipeDomainFoods" }, [], frame);
    expect(pantries.query.expr).toEqual({ kind: "literal", value: { $tag: "SubsetsOf", pantry: nine } });
    expect(card.query.expr).toMatchObject({ kind: "call", args: [
      { kind: "ref", savedExprId: recipe.id }, { kind: "ref", savedExprId: pantries.id },
    ] });
    const saved = new Map(values.map(value => [value.id, value.query.expr]));
    // The run's own lowering (exact heads), as the Local worker evaluates the card.
    const evaluated = evaluation.evaluateAuthoringExpressionInSession(card.query.expr, (id: string) => saved.get(id), session, {}, { trace: false }).result;
    const source = engine.invokeCallable({ $ref: "RecipeFunctions:recipeCard" },
      [{ $ref: "RecipeFunctions:lubeFormula" }, { $tag: "SubsetsOf", pantry: nine }], frame);
    expect(evaluated).toEqual(source as typeof evaluated);
    expect((source as Array<{ title: string }>).map(fact => fact.title)[0]).toBe("These foods");
  }, 900_000);

  // The written lowering keeps the module projections (`std.all`, ...), which
  // recipe reflection refuses. A run lowers registered functions by exact
  // identity, so the copy's card is the library recipe's card, with facts.
  test("the card on the copied recipe, run as the Local worker runs it, has the library card's facts", async () => {
    let next = 0;
    const commands = plan.planLinkedDemoCommands("recipe", session, plan.linkedDemoProjection(session),
      () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`) as Array<{ $tag: string; commands: Array<{ entry: { value: any } }> }>;
    const [recipe, pantries, card] = commands[0]!.commands.map(command => command.entry.value);
    const saved = new Map([recipe, pantries, card].map(value => [value.id, value.query.expr]));
    const resolver = (id: string) => saved.get(id);
    expect(JSON.stringify(evaluation.authoringExpressionLogic(card.query.expr, resolver, session))).toContain("std.all");
    const exact = JSON.stringify(evaluation.authoringExpressionLogic(card.query.expr, resolver, session, undefined, "exact"));
    expect(exact).not.toContain("std.all");
    expect(exact).toContain("std:all");
    const evaluated = evaluation.evaluateAuthoringExpressionInSession(card.query.expr, resolver, session, {}, { trace: false }).result as Array<{ title: string; summary: any }>;
    const nine = engine.invokeCallable({ $ref: "RecipeFunctions:recipeDomainFoods" }, [], frame);
    const source = engine.invokeCallable({ $ref: "RecipeFunctions:recipeCard" },
      [{ $ref: "RecipeFunctions:lubeFormula" }, { $tag: "SubsetsOf", pantry: nine }], frame);
    expect(evaluated).toEqual(source as typeof evaluated);
    expect(evaluated.map(fact => fact.summary.$tag)).not.toContain("Missing");
    expect(evaluated[1]).toMatchObject({ title: "Necessary foods",
      summary: { $tag: "Foods", items: [{ $tag: "Honey" }, { $tag: "LemonJuice" }, { $tag: "Egg" }] } });
    expect(evaluated.find(fact => fact.title === "Ingredient count")).toMatchObject({ summary: { $tag: "IngredientCount", minimum: 4, maximum: 4 } });
  }, 1_800_000);

  // The Local worker restores each saved value's declared type (Recipe,
  // PantrySet, RecipeCard) before it runs a card, which turns on invocation
  // admission. Admission judges the reader's own invocations (the card call
  // and the declared recipe) and nothing inside the library's bodies: a
  // function reference there is the library's checked code. Judging those
  // re-checked a whole recipe snapshot at each call (the card never finished
  // in this reader) or refused every derived row where such a check was
  // unavailable (the browser's ten RecipeUnavailable rows).
  test("a Local card over declared saved values has the library card's facts and admits only the reader's own calls", async () => {
    const [declarations, admissionModule, expressions] = await Promise.all([
      import("../saved-expression-map"), import("./invocation-admission"), import("@fenel/engine/expressions")]);
    let next = 0;
    const commands = plan.planLinkedDemoCommands("recipe", session, plan.linkedDemoProjection(session),
      () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`) as Array<{ $tag: string; commands: Array<{ entry: { value: any } }> }>;
    const [recipe, pantries, card] = commands[0]!.commands.map(command => command.entry.value);
    // (A plain read: bun's toMatchObject writes an asymmetric matcher into the object it reads.)
    for (const value of [recipe, pantries, card]) expect(typeof value.query.valueType.$ref).toBe("string");
    // The stored rows (JSON, as the tab's storage keeps them), the page's
    // shared map (declared from each row's valueType), its worker transport
    // and the worker's restored map, as the Local tab runs a card.
    const page = declarations.shareSavedExpressionMap(undefined, [recipe, pantries, card]
      .map(value => ({ id: value.id, query: JSON.parse(JSON.stringify(value.query)) })));
    const entries = [...page];
    const transported = declarations.savedExpressionDeclarationEntries(entries);
    expect(transported.map(([id]) => id)).toEqual([recipe.id, pantries.id, card.id]);
    const saved = new Map(structuredClone(entries));
    declarations.restoreSavedExpressionDeclarations(saved, structuredClone(transported));
    const resolver = (id: string) => saved.get(id);
    const root = { kind: "ref" as const, savedExprId: card.id };
    expect(evaluation.authoringExpressionAdmissionRequired(root, resolver, session)).toBe(true);

    // The run's own admission, observed: a contract for a bare function
    // reference that this reader never wrote fails at once.
    const admission = admissionModule.authoringInvocationAdmission(session.environment, session.registry, session.evaluateContext, undefined, root);
    const invoked: string[] = [];
    const hooks = { ...admission.hooks,
      valueContract: (value: unknown) => {
        const contract = admission.hooks.valueContract(value);
        if (contract && value !== null && typeof value === "object" && Object.keys(value).join() === "$ref") {
          throw new Error(`admission judged a library-internal call of ${(value as { $ref: string }).$ref}`);
        }
        return contract;
      },
      invoke: (contract: Parameters<typeof admission.hooks.invoke>[0], args: unknown[], context: Parameters<typeof admission.hooks.invoke>[2], execute: () => unknown) => {
        invoked.push((contract as { functionId?: string }).functionId ?? "declared value");
        return admission.hooks.invoke(contract, args, context, execute);
      },
    } as typeof admission.hooks;
    const context = expressions.authoringInvocationEvaluateContext(session.evaluateContext, hooks);
    const observed = expressions.evaluate(evaluation.authoringExpressionLogic(root, resolver, session, admission.observe, "exact"), {}, context);
    expect(invoked).toEqual(["RecipeFunctions:recipeCard", "declared value"]);

    const evaluated = evaluation.evaluateAuthoringExpressionInSession(root, resolver, session, {}, { trace: false }).result as Array<{ title: string; summary: any }>;
    const nine = engine.invokeCallable({ $ref: "RecipeFunctions:recipeDomainFoods" }, [], frame);
    const source = engine.invokeCallable({ $ref: "RecipeFunctions:recipeCard" },
      [{ $ref: "RecipeFunctions:lubeFormula" }, { $tag: "SubsetsOf", pantry: nine }], frame);
    expect(observed).toEqual(source);
    expect(evaluated).toEqual(source as typeof evaluated);
    expect(JSON.stringify(evaluated)).not.toContain("RecipeUnavailable");
    expect(evaluated[1]).toMatchObject({ title: "Necessary foods",
      summary: { $tag: "Foods", items: [{ $tag: "Honey" }, { $tag: "LemonJuice" }, { $tag: "Egg" }] } });
  }, 1_800_000);

  test("a function reference the reader wrote keeps its declared contract (admits only the reader's own calls)", () => {
    const applied = (argument: unknown) => ({ kind: "literal" as const, value: { __apply: {
      target: literal({ $ref: "RecipeFunctions:foodFromRank" }), args: [literal(argument)], syntax: "dollar" } } });
    const run = (argument: unknown) => evaluation.evaluateAuthoringExpressionInSession(applied(argument), undefined, session, {},
      { trace: false, admitInvocations: true }).result;
    expect(run(3)).toEqual({ $tag: "Just", _0: { $tag: "Honey" } });
    expect(() => run("three")).toThrow(/input 1/i);
  }, 900_000);
});

describe("B4 unit D: lens shortcut steps answer as the page's lens-shortcuts owners", () => {
  const source = { $tag: "ThisTabSource" }, focus = { $tag: "RootFocus" };
  const shortcuts = [...lens.defaultLensShortcuts(session), ...lens.textLensShortcuts(session)];
  const recipes = shortcuts.filter(shortcut => shortcut.operation.$tag === "InvokeLensRecipe");
  const input = { expression: literal("stressed"), value: "stressed", type: { $ref: "String" }, source, focus } as never;
  test("edit: the argument type and the dialog's two fields, with and without an edit", async () => {
    expect(recipes.length).toBeGreaterThan(0);
    for (const shortcut of recipes) {
      const recipe = (shortcut.operation as { recipe: Parameters<typeof lens.lensRecipeArgumentType>[1] }).recipe;
      const field = (entity: string, name: string) => engine.entitySchemaFields(registry.getIdentifiedEntity(entity)!).find(row => row.name === name);
      const argumentType = lens.lensRecipeArgumentType(session, recipe);
      expect(await ask({ method: "run-reader-lens-shortcut", step: "edit", shortcut })).toEqual({ edited: { $tag: "Ok", _0: structuredClone({
        shortcut, ...(argumentType === undefined ? {} : { argumentType }),
        fields: { arguments: field("LensFunctionRecipe", "arguments"), disposition: field("LensShortcut", "disposition") } }) } });
      const edited = lens.withLensShortcutDisposition(session, lens.withLensShortcutArguments(session, shortcut, recipe.arguments),
        { $tag: "CreateDerivedData" });
      const reply = await ask({ method: "run-reader-lens-shortcut", step: "edit", shortcut, arguments: { value: recipe.arguments },
        disposition: { $tag: "CreateDerivedData" } }) as { edited: { _0: { shortcut: unknown } } };
      expect(reply.edited._0.shortcut).toEqual(structuredClone(edited));
    }
  });
  test("prepare, admit, held subject and presentation code", async () => {
    let checked = 0;
    for (const shortcut of shortcuts) {
      const page = lens.prepareLensShortcut(session, shortcut, input);
      const reply = await ask({ method: "run-reader-lens-shortcut", step: "prepare", shortcut, input }) as { prepared: { ok: boolean; plan?: Record<string, unknown> } };
      const { reader: pageReader, ...pagePlan } = page.ok ? page.plan as Record<string, unknown> : {} as Record<string, unknown>;
      expect(reply.prepared).toEqual(structuredClone(page.ok ? { ok: true, plan: pagePlan } : page));
      if (page.ok && page.plan.kind === "recipe") {
        expect(pageReader).toBe(session);
        for (const value of ["desserts", 5]) {
          const admitted = lens.admitLensShortcutResult(session, page.plan, value, source as never);
          expect(await ask({ method: "run-reader-lens-shortcut", step: "admit", plan: reply.prepared.plan, value, source }))
            .toEqual({ admitted: structuredClone(admitted) });
          if (!admitted.ok) continue;
          const subject = admitted.subject;
          const admission = lens.checkLensTypedSubject(session, subject, source as never, focus as never);
          const expression = admission.ok ? lens.lensTypedSubjectExpression(session, subject, literal("stressed"))
            ?? transfer.expressionForTransfer({ value: admission.subject.data, type: admission.subject.dataType, typeName: "String", source: "fenel" },
              environment, { registry, evaluateContext: frame }) : undefined;
          expect(await ask({ method: "run-reader-lens-shortcut", step: "held-subject", subject, source, focus, origin: literal("stressed") }))
            .toEqual({ heldSubject: structuredClone({ admission, ...(expression ? { expression } : {}) }) });
          const typed = lens.lensTypedSubjectInput(session, subject, literal("stressed"), { $ref: "String" });
          expect(await ask({ method: "run-reader-lens-shortcut", step: "input", subject, origin: literal("stressed"), originType: { $ref: "String" } }))
            .toEqual({ input: structuredClone(typed === undefined ? {} : { input: typed }) });
          checked++;
        }
      }
      const presentation = shortcut.presentation.$tag === "Just" ? shortcut.presentation._0 : undefined;
      if (presentation) {
        const fn = registry.getFunction("view.workspacePresentationCode")!;
        const code = engine.invokeCallable({ $ref: registry.getUuid(fn.id) ?? fn.id }, [presentation], frame);
        expect(await ask({ method: "run-reader-lens-shortcut", step: "presentation-code", presentation }))
          .toEqual({ presentationCode: { $tag: "Ok", _0: code } });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  test("an unknown step or priority is refused", async () => {
    await expect(ask({ method: "run-reader-lens-shortcut", step: "invoke" })).rejects.toThrow("could not be read");
    await expect(ask({ method: "run-reader-lens-shortcut", step: "edit", shortcut: recipes[0], priority: "now" })).rejects.toThrow("could not be read");
  });
});

describe("B4 unit D: the transfer helpers answer as on the page", () => {
  const items = [
    { value: 42, typeName: "Number", type: { $ref: "Number" }, label: "Answer", source: "fenel" },
    { value: "plain words", typeName: "String", source: "text" },
    { value: { b: 1, a: [true, "x"] }, typeName: "Record", source: "json", label: "Order matters" },
  ];
  test("prepare-reader-transfer-item and project-reader-transfer-captions", async () => {
    for (const item of items) expect(await ask({ method: "prepare-reader-transfer-item", item }))
      .toEqual({ transferItem: settled(() => structuredClone(typeCandidate.prepareTransferItem(item as never, environment, registry, frame))) });
    expect(await ask({ method: "project-reader-transfer-captions", items }))
      .toEqual({ captions: settled(() => transfer.transferCaptions(items as never, { registry, evaluateContext: frame })) });
    await expect(ask({ method: "prepare-reader-transfer-item", item: { value: 1 } })).rejects.toThrow("could not be read");
  });
});

describe("B4 item 2: the lowering pair answers as the editor's codec adapters", () => {
  const add = registry.getIdentifiedFunction("std:add")!;
  const addId = registry.getUuid(add.id) ?? add.id;
  const nodes = [
    literal(3), literal({ b: 2, a: 1 }), literal(undefined),
    { kind: "call", fnId: addId, args: [{ kind: "param", name: "x" }, literal(1)] },
    { kind: "call", fnId: addId, args: [literal(undefined), literal(1)] },
    { kind: "ref", savedExprId: "saved" },
  ];
  const saved = new Map([["saved", { kind: "call", fnId: addId, args: [literal(2), literal(3)] }]]);
  test("lower: resolve over the library, refuse with the caller's sentence, or no resolver", async () => {
    const refusal = "Use a parameter for saved data in a function body.";
    for (const node of nodes) {
      const page = (resolver: ((id: string) => unknown) | undefined) => settled(() => {
        const logic = evaluation.authoringExpressionLogic(node as never, resolver as never, session);
        let emptySlot: boolean;
        try { emptySlot = slots.authoringExpressionHasEmptySlot(logic); } catch { emptySlot = true; }
        return structuredClone({ logic, emptySlot });
      });
      expect(await ask({ method: "lower-reader-expression", node, savedExpressions: [...saved] }))
        .toEqual({ lowered: page(id => saved.get(id)) });
      expect(await ask({ method: "lower-reader-expression", node, savedExpressions: [], refusal }))
        .toEqual({ lowered: page(() => { throw new Error(refusal); }) });
      expect(await ask({ method: "lower-reader-expression", node, savedExpressions: [], unresolved: true, priority: "guidance" }))
        .toEqual({ lowered: page(undefined) });
    }
  });
  test("raise: JSON Logic back to the editor's node with the parameter names", async () => {
    for (const node of nodes.slice(0, 5)) {
      const logic = evaluation.authoringExpressionLogic(node as never, undefined, session);
      expect(await ask({ method: "raise-reader-logic", logic, params: ["x"] }))
        .toEqual({ raised: settled(() => structuredClone(text.authoringLogicToExprNode(logic, ["x"], session))) });
    }
    await expect(ask({ method: "raise-reader-logic", logic: 1, params: [1] })).rejects.toThrow("could not be read");
  });
});
