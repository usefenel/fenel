// B4 wave 3 lane A (census unit D): Home's three Local starters ("numbers",
// people and projects, recipes) planned from a reader's own session. Moved
// VERBATIM out of Home's `createLinkedDemo` so a Local reader's worker runs it
// (`plan-reader-linked-demo` in `expression-runner/authoring-worker-reader-extensions.ts`)
// in its own frame; the page then only transacts the returned commands. Host
// boundaries only (existing "Central reader worker transport" kind): UUID
// acquisition, checked type/ExprNode transport and identity lookups. Fenel owns
// all example data, references and commands (`view.*`, `RecipeFunctions.*`,
// `ShowcaseDemo.*`). `project` is the Local source's `view` invocation under
// this same frame (the page's former `source.project`).
import { invokeCallable, List, type FenelType } from "@fenel/engine";
import { Ref, functionRefHandle } from "@fenel/engine/type-foundation";
import { dispatchedReifyInReader } from "@fenel/engine/engine-bodies-dispatch";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { expectedTypeForName } from "./expression-runner/creation-seed";
import { returnedExpressionNode } from "./lens-shortcuts";
import { placedListType } from "./locus-canvas-data";

export type LinkedDemoKind = "numbers" | "showcase" | "recipe";
export type LinkedDemoCommand = { $tag: string; [key: string]: unknown };

/** The Local source's `view` function invocation in this session's frame. */
export function linkedDemoProjection(session: AuthoringSession) {
  return <T,>(name: string, ...args: unknown[]): T => invokeCallable(Ref(`view:${name}`), args, session.evaluateContext) as T;
}

/** Throws the page's existing refusal sentences. */
export function planLinkedDemoCommands(kind: LinkedDemoKind, session: AuthoringSession,
  project: <T>(name: string, ...args: unknown[]) => T, randomUUID: () => string): LinkedDemoCommand[] {
  let commands: LinkedDemoCommand[];
  if (kind === "recipe") {
    type RecipeResult<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
    // These are existing host reflection / $-key marshalling boundaries.
    // The source roster owns the examples, configured criteria and labels.
    const sourceData = <T,>(name: string, ...args: unknown[]): T => {
      const declaration = session.registry.getIdentifiedFunction(name);
      const handle = declaration && session.registry.getUuid(declaration.id);
      if (!declaration || declaration.body === undefined || !handle
        || session.registry.getFunction(handle)?.id !== declaration.id) {
        throw new Error("The recipe starter's source data is unavailable in this reader.");
      }
      return invokeCallable(Ref(handle), args, session.evaluateContext) as T;
    };
    // Examples take a pantry; criteria take the recipe and its pantry set.
    const callable = (value: unknown, arity: number) => {
      const handle = functionRefHandle(value);
      const fn = handle && session.registry.getIdentifiedFunction(handle);
      if (!handle || !fn || session.registry.getFunction(handle)?.id !== fn.id || fn.params.length !== arity
        || session.registry.getFunctionSignatureInfo(fn.id)?.outcome.$tag !== "Solved") {
        throw new Error("A recipe example has no exact checked callable in this reader.");
      }
      return { fn, handle };
    };
    const nominal = (name: string, owner: string): FenelType => {
      const type = session.evaluateContext._typeFamilyOwner?.(name, owner);
      if (!type || !session.registry.getIdentifiedEntity(type.identity)) {
        throw new Error("A recipe example's declared type is unavailable in this reader.");
      }
      return { $ref: type.identity };
    };
    const roster = sourceData<Array<{ name: string; callable: unknown; pantries: unknown }>>("RecipeFunctions.recipeDemoSources");
    const criteria = sourceData<Array<{ name: string; callable: unknown }>>("RecipeFunctions.recipeDemoCriteria").map(entry => {
      const target = callable(entry.callable, 2);
      if (!("$ref" in target.fn.returns)) throw new Error("A recipe criterion has no closed result type.");
      return { name: entry.name, fnId: target.handle, resultType: nominal(target.fn.returns.$ref, target.fn.id) };
    });
    const examples = roster.map(entry => {
      const target = callable(entry.callable, 1);
      const parameter = target.fn.params[0]!.type;
      if (!("$ref" in parameter)) throw new Error("A recipe example has no declared pantry type.");
      const reflected = dispatchedReifyInReader(entry.callable, session.evaluateContext);
      const copy = sourceData<RecipeResult<unknown>>("view.recipeDemoFunctionExpression", reflected);
      if (copy.$tag === "Err") throw new Error(copy._0);
      const expression = returnedExpressionNode(session, copy._0);
      if (!expression) throw new Error("This recipe body cannot be retained by the shared expression editor. No data was added.");
      // The example's own pantry type must still resolve in this reader.
      nominal(parameter.$ref, target.fn.id);
      return { name: entry.name, expression, pantries: entry.pantries, recipeType: nominal("Recipe", target.fn.id),
        pantriesType: nominal("PantrySet", target.fn.id) };
    });
    const pantriesType = examples[0]?.pantriesType;
    if (!pantriesType || !("$ref" in pantriesType) || examples.some(example => !("$ref" in example.pantriesType)
      || example.pantriesType.$ref !== pantriesType.$ref)) throw new Error("The recipe starter's pantry owners do not match.");
    const fresh = () => ({ value: randomUUID(), item: randomUUID() });
    const identities = examples.map(() => ({ recipe: fresh(), pantries: fresh(), analyses: criteria.map(fresh) }));
    const copiedExpressionType = sourceData<FenelType>("view.recipeDemoCopiedExpressionType");
    const plan = project<RecipeResult<{ commands: LinkedDemoCommand[] }>>(
      "recipeDemoCommands", identities, examples, criteria, copiedExpressionType, pantriesType);
    if (plan.$tag === "Err") throw new Error(plan._0);
    commands = plan._0.commands;
  } else if (kind === "showcase") {
    const types = ["PublicPerson", "Project", "Mascot", "PlantFamily", "PlantGenus", "PlantSpecies", "BotanicalIllustration",
      "ProgrammingLanguage", "PlantNamedSpeciesSet"].map(name => expectedTypeForName(name, session.environment));
    const exact = (name: string) => {
      // A source name ("ShowcaseDemo.x") or a retained reference's handle.
      const fn = session.registry.getIdentifiedFunction(name) ?? session.registry.getFunction(name);
      const handle = fn && session.registry.getUuid(fn.id);
      return fn && handle && session.registry.getFunction(handle)?.id === fn.id ? handle : undefined;
    };
    const plannerId = exact("ShowcaseDemo.showcaseCommands");
    const sourcesId = exact("ShowcaseDemo.showcasePublicBindingSources");
    // The source roster names every linked record (one fresh copy identity
    // each) and every function a record calls (the plate Images, the fennels
    // selection), which stay calls by exact identity, as in public.
    const sources = sourcesId ? invokeCallable(Ref(sourcesId), [], session.evaluateContext) as
      { bindings?: Record<string, unknown>; calls?: Record<string, unknown> } : undefined;
    const heads = Object.fromEntries(Object.entries(sources?.calls ?? {}).map(([key, reference]) => {
      const handle = functionRefHandle(reference);
      return [key, handle ? exact(handle) : undefined];
    }));
    if (types.some(type => !type) || !plannerId || !sources?.bindings || !sources.calls
      || Object.keys(heads).length === 0 || Object.values(heads).some(head => !head)) {
      throw new Error("The people and projects example's checked types or source identity are unavailable.");
    }
    const ids = Object.fromEntries(Object.keys(sources.bindings)
      .flatMap(name => [[name, randomUUID()], [`${name}Item`, randomUUID()]]));
    const plan = invokeCallable(Ref(plannerId), [ids, heads, ...types], session.evaluateContext) as
      { commands: LinkedDemoCommand[] };
    commands = plan.commands;
  } else {
    const numberType = expectedTypeForName("Number", session.environment);
    const multiply = session.registry.getIdentifiedFunction("std:mul");
    const add = session.registry.getIdentifiedFunction("std:add");
    const placeAll = session.registry.getIdentifiedFunction("view:placeAll");
    const multiplyId = multiply && session.registry.getUuid(multiply.id);
    const addId = add && session.registry.getUuid(add.id);
    const placeAllId = placeAll && session.registry.getUuid(placeAll.id);
    if (!numberType || !multiplyId || !addId || !placeAllId) throw new Error("The linked demo's checked function identities or Number type are unavailable.");
    const ids = { source: randomUUID(), doubled: randomUUID(), result: randomUUID(),
      list: randomUUID(), canvas: randomUUID(), sourceItem: randomUUID(),
      doubledItem: randomUUID(), resultItem: randomUUID(), listItem: randomUUID(), canvasItem: randomUUID() };
    const plan = project<{ commands: LinkedDemoCommand[] }>(
      "linkedDemoCommands", ids, { multiply: multiplyId, add: addId, placeAll: placeAllId },
      numberType, List(numberType), placedListType(numberType));
    commands = plan.commands;
  }
  return commands;
}
