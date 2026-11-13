import { beforeAll, describe, expect, test } from "bun:test";
import { loadFenelModule } from "@fenel/engine";
import { createRegistry, registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { buildAuthoringCatalogSnapshot, createAuthoringEnvironment, inferAuthoringFunctionDraft, projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelFunction, FenelModule, FenelType, FieldDef, FunctionSignatureDeclaration, TypeScheme } from "@fenel/engine/types";
import { Just, List, Nothing } from "@fenel/engine/type-foundation";
import { createLocalAuthoringSession, localAuthoringScopeForSession, type AuthoringSession, type LocalAuthoringScope } from "./account-authoring-session";
import type { AuthoringFunctionBodySaveIssue, AuthoringFunctionDraftInference, AuthoringWorkerLifecycle, AuthoringWorkerMessage, AuthoringWorkerRequest, AuthoringWorkerResponse } from "./authoring-worker-protocol";
import { authoringExpressionAdmissionRequired, evaluateAuthoringExpressionInSession } from "./expression-evaluation";
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";
import { shareSavedExpressionMap } from "../saved-expression-map";
import * as savedTransport from "../saved-expression-map";
import { evaluate, invokeCallable, pureEvaluateContext, readerSourceMetadataEvaluateContext, resolveCompleteMethodForEvaluation, type EvaluateContext } from "@fenel/engine/expressions";
import { authoringMembershipEvaluateContext, authoringValidationMembership, buildAuthoringSignatureDeclaration, closeAuthoringMembershipType } from "@fenel/engine/authoring/signature-authoring";
import { literalMembershipAuthority, literalMembershipFor } from "./literal-membership";
import { validateValue, type ValidationAdmissionObservation } from "@fenel/engine/validation";
import { contains } from "@fenel/engine/set-algebra";
import { typeToSetExpr } from "@fenel/engine/fenel-check";
import { peelSetExpr } from "@fenel/engine/set-marker";
import { inlineWidgetFor } from "./inline-widgets";
import { repositoryIdentityKinds, repositoryIdentityLock } from "@fenel/engine/repository-identity-manifest";
import { dispatchEngineBody, dispatchedReifyInReader } from "@fenel/engine/engine-bodies-dispatch";
import { compileConstructorCatalogCandidates } from "../../../../../../implementations/typescript/engine/src/compile-field-slots";
import { evaluatorStrategiesModule } from "../../../../../../implementations/typescript/engine/src/modules/evaluator-strategies";
import { resolveEl } from "@fenel/engine/dependent-types";
import REFLECTION_SOURCE from "../../../../../../fenel/modules/engine/reflect.fenel?raw";
import { functionBodySaveIssue } from "./creation-validation";
import type { ReaderSourceMetadata } from "../reader-source-metadata";
import { readerSourceMetadataNative } from "../../../../../../fenel/modules/view/ffi/source-metadata";

const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const ref = (savedExprId: string): ExprNode => ({ kind: "ref", savedExprId });
const food = (name: string) => ({ $tag: name });
const apply = (target: ExprNode, args: ExprNode[]): ExprNode => literal({ __apply: { target, args } });

function diagnosticResult(body: () => unknown) {
  try {
    const value = body();
    return value === undefined ? { kind: "undefined" } : { kind: "value", value };
  } catch (error) {
    return { kind: "error", name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error) };
  }
}

function diagnosticScopePorts(context: EvaluateContext) {
  return { sourceFunction: context._sourceFunction,
    getFunction: typeof context.getFunction === "function",
    getFunctionImportFrame: typeof context.getFunctionImportFrame === "function",
    getFunctionSignatureInfo: typeof context.getFunctionSignatureInfo === "function",
    moduleMember: typeof context._moduleMember === "function",
    moduleNames: context._moduleNames === undefined ? { present: false } : { present: true, names: [...context._moduleNames] },
    callSiteTyping: context._callSiteTyping !== undefined,
    typeFamilyOwner: typeof context._typeFamilyOwner === "function",
    typeDeclarationScope: typeof (context as EvaluateContext & { _typeDeclarationScope?: unknown })._typeDeclarationScope === "function",
    imports: context._importStack?.map(frame => ({ names: Object.keys(frame.names).length,
      canonical: frame.names.canonical, rank: frame.names.rank, stdHead: frame.names["std.head"], aliases: frame.aliases })),
  };
}

function typedSaved(_expressions: undefined, rows: Array<{ id: string; query: {
  expr: ExprNode; valueType?: FenelType; valueScheme: TypeScheme;
} }>) {
  const saved = shareSavedExpressionMap(undefined, rows.map(row => ({ id: row.id,
    query: { expr: row.query.expr, valueType: row.query.valueType ?? row.query.valueScheme.body },
  })));
  savedTransport.restoreSavedExpressionDeclarations(saved, rows.map(row => [row.id, { scheme: row.query.valueScheme }] as const));
  return saved;
}

/** C1: exercise the real source declarations under the same metadata protocol
 * as the repository generator, without writing identities to production. */
function strictReflectionFixtureRegistry(modules: FenelModule[]) {
  const lock = repositoryIdentityLock();
  const kinds = repositoryIdentityKinds();
  const requirements = createRegistry(modules, { publishCatalogEntities: false, codeNameLock: lock,
    fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock, identityKinds: kinds },
  });
  let nextType = 1;
  for (const entity of requirements.listIdentifiedEntities()) {
    const key = dispatchEngineBody("engine:typeIdentityLockKey", [entity.module === undefined
      ? { $tag: "Nothing" } : { $tag: "Just", _0: entity.module }, entity.id]);
    if (typeof key !== "string") throw new Error("Reflection fixture type identity key unavailable");
    if (lock.has(key)) continue;
    const identity = `75000000-0000-4000-8000-${String(nextType++).padStart(12, "0")}`;
    lock.set(key, identity);
    kinds.set(identity, "type");
  }
  const candidates = compileConstructorCatalogCandidates({
    listIdentifiedEntities: () => requirements.listIdentifiedEntities(), identityLock: lock, identityKinds: kinds,
  });
  const constructorKeys = dispatchEngineBody("engine:constructorFunctionLockRequirements", [
    candidates, requirements.listFunctions().map(fn => fn.id),
  ]);
  if (!Array.isArray(constructorKeys) || constructorKeys.some(key => typeof key !== "string")) {
    throw new Error("Reflection fixture constructor requirements unavailable");
  }
  let nextConstructor = 1;
  for (const key of constructorKeys as string[]) {
    if (lock.has(key)) continue;
    const identity = `76000000-0000-4000-8000-${String(nextConstructor++).padStart(12, "0")}`;
    lock.set(key, identity);
    kinds.set(identity, "function");
  }
  let nextField = 1;
  for (const request of requirements.listFieldLockRequests()) {
    if (lock.has(request.name)) continue;
    const identity = request.preferredId ?? `77000000-0000-4000-8000-${String(nextField++).padStart(12, "0")}`;
    lock.set(request.name, identity);
    kinds.set(identity, "field");
  }
  return createRegistry(modules, { publishCatalogEntities: false, codeNameLock: lock,
    fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: kinds },
  });
}

describe("authoring invocation admission uses actual inputs and whole outputs", () => {
  let session: AuthoringSession;
  let recipeType: TypeScheme;
  beforeAll(() => {
    const source = loadFenelModule(`module AdmissionRecipe where
Food = Butter | Honey | Egg
rank : (food: Food) -> Number
rank food = case food of Butter -> 0; Honey -> 1; Egg -> 2
after : (previous: Number) -> (foods: List Food) -> Bool
after previous foods = case std.head foods of
  Nothing -> true
  Just food -> previous < rank food && after (rank food) (std.fromMaybe [] (std.tail foods))
canonical : (foods: List Food) -> Bool
canonical foods = case std.head foods of
  Nothing -> true
  Just food -> after (rank food) (std.fromMaybe [] (std.tail foods))
Pantry = List Food | canonical value
Ingredients = List Food | canonical value && std.length value > 0
Recipe = (Pantry -> List Ingredients) | if true then true else true
NamedFn = (Number -> Number) | if true then true else true
CallableChoice = HasCallable callback: NamedFn | NoCallable
ownedScalarPositive : (value: Number) -> Bool
ownedScalarPositive value = value > 0
OwnedScalar = Number | ownedScalarPositive value
recipe : (pantry: Pantry) -> List Ingredients
recipe pantry = if std.length pantry > 0 then [pantry] else []
receiveRecipe : (recipe: Recipe) -> Number
receiveRecipe recipe = 1
applyRecipe : (recipe: Recipe) -> (pantry: Pantry) -> List Ingredients
applyRecipe recipe pantry = recipe pantry
@native
tick : (pantry: Pantry) -> Pantry
@native
undecidable : (foods: List Food) -> Bool
Mystery = List Food | undecidable value
mysteryRecipe : (pantry: Mystery) -> List Ingredients
mysteryRecipe pantry = []
unknownOutput : (pantry: Pantry) -> Mystery
unknownOutput pantry = []
taggedRecipe : (marker: Number) -> (pantry: Pantry) -> List Ingredients
taggedRecipe marker pantry = if std.length pantry > 0 then [pantry] else []
`, "AdmissionRecipe");
    const lock = repositoryIdentityLock();
    const kinds = repositoryIdentityKinds();
    for (const [index, name] of ["Food", "Pantry", "Ingredients", "Recipe", "Mystery", "NamedFn", "CallableChoice", "FiniteStringMapBoundary", "OwnedScalar", "OwnedScalarUnion", "ScalarAlias"].entries()) {
      const identity = `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const key = dispatchEngineBody("engine:typeIdentityLockKey", [{ $tag: "Just", _0: "AdmissionRecipe" }, name]);
      if (typeof key !== "string") throw new Error("Fixture type identity key unavailable");
      lock.set(key, identity);
      kinds.set(identity, "type");
    }
    const finiteMapBoundary: FenelType = { $map: { keys: { $tag: "SeInterval", interval: {
      lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 1, inclusive: false }),
    } }, values: { $ref: "String" } } };
    const ownedScalarUnion: FenelType = { $union: [{ $ref: "OwnedScalar" }, { $ref: "String" }] };
    const scalarAlias: FenelType = { $ref: "system.String" };
    const fixture = { ...source, entities: [...(source.entities ?? []).map(entity => {
      if ((entity.id !== "Food" && entity.id !== "CallableChoice") || !("$variant" in entity.type)) return entity;
      const type = { $variant: { ...entity.type.$variant, cases: entity.type.$variant.cases.map((entry, index) => {
        const identity = `${entity.id === "Food" ? "71000000" : "71100000"}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        kinds.set(identity, "function");
        return { ...entry, constructorFunction: { $ref: identity } };
      }) } };
      return { ...entity, type, ...(entity.typeScheme ? { typeScheme: { ...entity.typeScheme, body: type } } : {}) };
    }), { id: "FiniteStringMapBoundary", type: finiteMapBoundary,
      typeScheme: { quantified: [], body: finiteMapBoundary },
    }, { id: "OwnedScalarUnion", type: ownedScalarUnion,
      typeScheme: { quantified: [], body: ownedScalarUnion },
    }, { id: "ScalarAlias", type: scalarAlias,
      typeScheme: { quantified: [], body: scalarAlias },
    }] };
    const modules = [stdModule, fixture];
    const requirements = createRegistry(modules, { publishCatalogEntities: false, codeNameLock: lock,
      fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock, identityKinds: kinds },
    });
    let nextType = 1;
    for (const entity of requirements.listIdentifiedEntities()) {
      const key = dispatchEngineBody("engine:typeIdentityLockKey", [entity.module === undefined
        ? { $tag: "Nothing" } : { $tag: "Just", _0: entity.module }, entity.id]);
      if (typeof key !== "string") throw new Error("Fixture type identity key unavailable");
      if (lock.has(key)) continue;
      const identity = `73000000-0000-4000-8000-${String(nextType++).padStart(12, "0")}`;
      lock.set(key, identity);
      kinds.set(identity, "type");
    }
    let nextField = 1;
    for (const request of requirements.listFieldLockRequests()) {
      if (lock.has(request.name)) continue;
      const identity = request.preferredId ?? `74000000-0000-4000-8000-${String(nextField++).padStart(12, "0")}`;
      lock.set(request.name, identity);
      kinds.set(identity, "field");
    }
    const strictRegistry = () => createRegistry(modules, { publishCatalogEntities: false, codeNameLock: lock,
      fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: kinds },
    });
    // Requirement collection intentionally has no finalized public type-owner
    // ports. Resolve actual branches only after its locks support a strict reader.
    const seedRegistry = strictRegistry();
    const fixtureReader = seedRegistry.evaluateContext();
    const fixtureSource = seedRegistry.getFunction("AdmissionRecipe:recipe");
    if (!fixtureSource) throw new Error("Actual fixture source function unavailable");
    const resolveInDeclaration = seedRegistry.callSiteTyping.resolveTypeInDeclaration;
    if (!resolveInDeclaration) throw new Error("Actual strict declaration resolver unavailable");
    const unionBranches = ["OwnedScalar", "String"].map(name => {
      const owner = fixtureReader._typeFamilyOwner?.(name, fixtureSource.id);
      if (!owner) throw new Error("Actual scoped union branch declaration unavailable");
      const resolved = resolveInDeclaration({ $ref: owner.name }, owner.ownerIdentity);
      if (!resolved.ok) throw new Error("Actual owned union branch scheme unavailable");
      const type = closeAuthoringMembershipType(resolved.type, fixtureReader);
      const nominal = resolved.type.nominals?.find(owner => owner.path.length === 0);
      if (!type || !("$ref" in type) || !nominal || nominal.identity !== owner.ownerIdentity || type.$ref !== owner.identity) {
        throw new Error("Actual closed union branch owner unavailable");
      }
      return { type, nominal };
    });
    const closedUnion: FenelType = { $union: unionBranches.map(branch => branch.type) };
    const closedUnionScheme: TypeScheme = { quantified: [], body: closedUnion,
      nominals: unionBranches.map((branch, index) => ({ path: ["$union", String(index)],
        identity: branch.nominal.identity, publicName: branch.type.$ref })),
    };
    // Match public authoring's actual closed-reference packet. Bare branch
    // spellings would instead exercise the separate anonymous type path.
    fixture.entities = fixture.entities.map(entity => entity.id === "OwnedScalarUnion"
      ? { ...entity, type: closedUnion, typeScheme: closedUnionScheme } : entity);
    const registry = strictRegistry();
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], { registry, sourceModule: "AdmissionRecipe" }));
    session = { mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: registry.evaluateContext() };
    const entry = environment.getFunctionEntry?.("recipe");
    if (!entry?.scheme) throw new Error("Fixture recipe declaration unavailable");
    recipeType = entry.scheme;
  }, 180_000);

  function savedRecipe(body: ExprNode, params = ["pantry"]) {
    const valueType = recipeType.body;
    return typedSaved(undefined, [{ id: "recipe", query: {
      expr: literal({ __lambda: { params, body } }), valueType, valueScheme: recipeType,
    } }]);
  }
  function runSaved(body: ExprNode, pantry: unknown) {
    const saved = savedRecipe(body);
    return evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal(pantry)]), id => saved.get(id), session, {}, { trace: false });
  }

  type FunctionSemanticRequest = Extract<AuthoringWorkerRequest, { method: "infer-function-draft" | "function-body-save-issue" }>;

  // C1: execute the unchanged production worker run handler with this describe's
  // already checked reader. Only the message boundary and pause timer are hosted
  // here; this makes no claim about actual browser Worker thread isolation.
  async function functionSemanticWorker(current: AuthoringSession,
    observeSaveFrame?: (frame: EvaluateContext | undefined,
      declaration: ReturnType<typeof savedTransport.savedExpressionDeclaration>) => void) {
    const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf("const scope =")))
      .replaceAll("import.meta.env.BASE_URL", '"/"');
    const replies: AuthoringWorkerResponse[] = [];
    const turns = new Map<number, () => void>();
    let nextTurn = 0;
    const workerScope: { onmessage?: (event: { data: AuthoringWorkerRequest }) => void;
      postMessage: (message: AuthoringWorkerMessage) => void } = {
      postMessage: message => { if ("ok" in message) replies.push(structuredClone(message)); },
    };
    const imports = { fixtureSession: current, globalThis: workerScope, registryTransportSnapshot, inferAuthoringFunctionDraft, createLocalAuthoringSession,
      functionBodySaveIssue: (...args: Parameters<typeof functionBodySaveIssue>) => {
        observeSaveFrame?.(args[3]?.evaluateContext, savedTransport.savedExpressionDeclaration(args[0]));
        return functionBodySaveIssue(...args);
      },
      readerSourceMetadataEvaluateContext,
      isReaderExtensionMethod, runReaderExtension,
      restoreSavedExpressionDeclaration: savedTransport.restoreSavedExpressionDeclaration,
      restoreSavedExpressionDeclarations: savedTransport.restoreSavedExpressionDeclarations,
      setTimeout: (resume: () => void) => { const id = ++nextTurn; turns.set(id, resume); return id; },
      clearTimeout: (id: number) => { turns.delete(id); },
    };
    const worker = new Function(...Object.keys(imports), `${code}\nbase = fixtureSession; return { run, contexts, active, cancelled };`)
      (...Object.values(imports)) as { run: (request: FunctionSemanticRequest) => Promise<void>;
        contexts: Map<number, AuthoringSession>; active: Set<number>; cancelled: Set<number> };
    worker.contexts.set(7, current);
    return {
      context: (id: number) => worker.contexts.get(id),
      forgetContext: (id: number) => worker.contexts.delete(id),
      async run(request: FunctionSemanticRequest, cancel = false): Promise<AuthoringWorkerResponse | undefined> {
        const pending = worker.run(structuredClone(request));
        try {
          // Only an actual missing-context reply may finish before pause.
          // Every semantic operation retains the existing one-turn assertion.
          if (turns.size === 0) {
            expect(cancel).toBe(false);
            expect(replies.find(reply => reply.id === request.id)).toMatchObject({ ok: false, code: "context-missing" });
          } else {
            expect(turns.size).toBe(1);
            if (cancel) workerScope.onmessage?.({ data: { id: request.id, method: "cancel" } });
            const [id, resume] = turns.entries().next().value!;
            turns.delete(id); resume();
          }
          await pending;
          expect(turns.size).toBe(0);
          expect(worker.active.size).toBe(0);
          expect(worker.cancelled.size).toBe(0);
          return replies.find(reply => reply.id === request.id);
        } finally { turns.clear(); }
      },
      dispose() { turns.clear(); worker.contexts.clear(); },
    };
  }

  function functionSemanticCandidate(parameterTypes: FenelType[], returns: FenelType, body: FenelFunction["body"],
    inferResult: boolean, variables: string[] = []): { fn: FenelFunction; declaration: FunctionSignatureDeclaration } {
    const params = parameterTypes.map((type, index): FieldDef => ({ name: `input${index}`, type,
      key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} }));
    const id = "AdmissionRecipe:recipe";
    const authored = { $tag: "Authored", source: { $tag: "HostSpec", module: "worker-function-parity" } } as const;
    const declaration: FunctionSignatureDeclaration = { functionId: id, declarationName: "recipe", codeName: "recipe",
      params: params.map(() => authored), returns: inferResult ? { $tag: "Absent" } : authored,
      scheme: { quantified: variables.map(sourceName => ({ id: `worker-function:${sourceName}`, sourceName, kind: { $tag: "KType" } })),
        body: { $arrow: { params, returns } } } };
    return { fn: { id, params, returns, body, signatureDeclaration: declaration }, declaration };
  }

  test("production worker whole-function inference matches the same checked reader and complete evidence", async () => {
    const worker = await functionSemanticWorker(session);
    const a: FenelType = { $var: "a" };
    const string: FenelType = { $ref: "String" };
    const generic = functionSemanticCandidate([a], string, { var: "input0" }, true, ["a"]);
    const recursive = functionSemanticCandidate([a], string,
      { if: [true, { var: "input0" }, { call: ["AdmissionRecipe:recipe", { var: "input0" }] }] }, true, ["a"]);
    const applied: FenelType = { $el: { call: ["f", a] } };
    const higherKinded = functionSemanticCandidate([applied], string, { var: "input0" }, true, ["f", "a"]);
    const kind = { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } } as const;
    higherKinded.declaration = { ...higherKinded.declaration, scheme: { ...higherKinded.declaration.scheme!,
      quantified: [{ id: "worker-function:f", sourceName: "f", kind }, higherKinded.declaration.scheme!.quantified[1]!],
      applications: [{ path: ["$arrow", "params", "0", "type"], headVarId: "worker-function:f", args: [a], kind }],
    } };
    higherKinded.fn.signatureDeclaration = higherKinded.declaration;
    const pantry = projectAuthoringScheme(recipeType, ["$arrow", "params", "0", "type"])!;
    const nominal = functionSemanticCandidate([pantry.body], pantry.body, { var: "input0" }, false);
    nominal.declaration = { ...nominal.declaration, scheme: { ...nominal.declaration.scheme!,
      nominals: ["params", "returns"].flatMap(slot => (pantry.nominals ?? []).map(owner => ({ ...owner,
        path: slot === "params" ? ["$arrow", "params", "0", "type", ...owner.path] : ["$arrow", "returns", ...owner.path],
      }))),
    } };
    nominal.fn.signatureDeclaration = nominal.declaration;
    const mismatch = functionSemanticCandidate([], string, 42, false);
    const unknown = functionSemanticCandidate([], string, { call: ["pending:callable", 1] }, true);
    const wrongOwner = functionSemanticCandidate([], string, "value", false);
    wrongOwner.declaration = { ...wrongOwner.declaration, functionId: "different:function" };
    const cases = [
      { name: "Absent identity", candidate: generic, solved: true },
      { name: "current recursive identity", candidate: recursive, solved: true },
      { name: "higher-kinded applications", candidate: higherKinded, solved: true },
      { name: "actual nominal declaration", candidate: nominal, solved: true },
      { name: "explicit result", candidate: functionSemanticCandidate([], string, "value", false), solved: true },
      { name: "explicit mismatch", candidate: mismatch, solved: false },
      { name: "unknown callable", candidate: unknown, solved: undefined },
      { name: "declaration identity refusal", candidate: wrongOwner, solved: false },
    ];
    try {
      for (const [index, { name, candidate, solved }] of cases.entries()) {
        const before = structuredClone(candidate);
        const expected = registryTransportSnapshot(inferAuthoringFunctionDraft(candidate.fn, candidate.declaration,
          session.environment, { registry: session.registry }), `direct parity ${name}`);
        const request: FunctionSemanticRequest = { id: 100 + index, method: "infer-function-draft", contextId: index % 2 ? 7 : 0,
          fn: candidate.fn, declaration: candidate.declaration };
        const reply = await worker.run(request);
        expect(reply?.ok, name).toBe(true);
        if (!reply?.ok) throw new Error(`Production inference did not return: ${name}`);
        const actual = reply.result as AuthoringFunctionDraftInference;
        expect(actual, name).toEqual(structuredClone(expected));
        if (solved === true) {
          expect(actual.outcome.$tag, name).toBe("Solved");
          expect(actual.fn, name).toBeDefined();
          expect(actual.info?.scheme, name).toEqual(actual.scheme);
          expect(actual.info?.trust, name).toEqual(expected.info?.trust);
          expect(actual.info?.implementationOrigin, name).toEqual({ $tag: "FenelBody" });
        } else if (solved === false) expect(actual.outcome.$tag, name).not.toBe("Solved");
        if (candidate === generic || candidate === recursive || candidate === higherKinded) {
          expect(actual.info?.returns.$tag, name).toBe("Inferred");
          expect(candidate.declaration.returns).toEqual({ $tag: "Absent" });
        }
        if (candidate === higherKinded) expect(actual.scheme?.applications).toHaveLength(2);
        if (candidate === nominal) {
          expect(pantry.nominals?.length).toBeGreaterThan(0);
          expect(actual.scheme?.nominals).toEqual(nominal.declaration.scheme?.nominals);
        }
        expect(candidate, name).toStrictEqual(before);
      }
      expect(await worker.run({ id: 130, method: "infer-function-draft", contextId: 0,
        fn: generic.fn, declaration: generic.declaration }, true)).toBeUndefined();
      const nonplain = { ...generic.fn, body: new Date(0) as unknown as FenelFunction["body"] };
      expect(await worker.run({ id: 131, method: "infer-function-draft", contextId: 0,
        fn: nonplain, declaration: generic.declaration })).toMatchObject({ ok: false, error: expect.stringMatching(/transport|plain|prototype|object/i) });
    } finally { worker.dispose(); }
  }, 120_000);

  test("production worker function save gate matches the same reader and shadows absent metadata", async () => {
    const packet = (generation: string): ReaderSourceMetadata => ({ $tag: "ReaderSourceMetadata",
      source: { $tag: "ThisTabSource" }, rootId: "function-parity", generation, expressions: [], occurrences: [], callableLabels: [] });
    const old = packet("old-base"), first = packet("A"), second = packet("B");
    const frame = Object.freeze({ ...session.evaluateContext, _readerSourceMetadata: old });
    const current = Object.freeze({ ...session, evaluateContext: frame });
    const before = Object.getOwnPropertyDescriptors(frame);
    const observed: Array<{ frame: EvaluateContext | undefined;
      declaration: ReturnType<typeof savedTransport.savedExpressionDeclaration> }> = [];
    const worker = await functionSemanticWorker(current, (checked, declaration) => { observed.push({ frame: checked, declaration }); });
    const string: FenelType = { $ref: "String" };
    const definition = (inferred: boolean) => functionSemanticCandidate([], string, "old body", inferred).fn;
    const pantry = projectAuthoringScheme(recipeType, ["$arrow", "params", "0", "type"])!;
    const declaredNode = savedTransport.restoreSavedExpressionDeclaration({ kind: "param", name: "input0" }, { scheme: pantry });
    const declaredDefinition = functionSemanticCandidate([pantry.body], pantry.body, { var: "input0" }, false).fn;
    expect(savedTransport.savedExpressionDeclaration(declaredNode)).toStrictEqual({ scheme: pantry });
    expect(pantry.nominals?.length).toBeGreaterThan(0);
    const cases: Array<{ name: string; node: ExprNode; fn: FenelFunction; issue: "absent" | "present" | "parity" }> = [
      { name: "empty String", node: literal(""), fn: definition(true), issue: "absent" },
      { name: "zero", node: literal(0), fn: definition(true), issue: "absent" },
      { name: "false", node: literal(false), fn: definition(true), issue: "absent" },
      { name: "incomplete slot", node: literal(undefined), fn: definition(true), issue: "present" },
      { name: "explicit mismatch", node: literal(42), fn: definition(false), issue: "present" },
      { name: "explicit unknown", node: { kind: "call", fnId: "pending:callable", args: [literal(1)] }, fn: definition(false), issue: "parity" },
      { name: "Absent unknown", node: { kind: "call", fnId: "pending:callable", args: [literal(1)] }, fn: definition(true), issue: "present" },
      { name: "saved root with complete nominal scheme", node: declaredNode, fn: declaredDefinition, issue: "parity" },
    ];
    try {
      for (const [index, fixture] of cases.entries()) {
        const sourceMetadata = [first, second, undefined][index % 3];
        const rootDeclaration = savedTransport.savedExpressionDeclaration(fixture.node);
        const raw = structuredClone({ fn: fixture.fn, node: fixture.node, rootDeclaration });
        const request: FunctionSemanticRequest = { id: 200 + index, method: "function-body-save-issue", contextId: index % 2 ? 7 : 0,
          node: fixture.node, definition: fixture.fn, ...(rootDeclaration ? { rootDeclaration } : {}),
          ...(sourceMetadata ? { sourceMetadata } : {}) };
        const expectedFrame = readerSourceMetadataEvaluateContext(frame, sourceMetadata);
        const expected = registryTransportSnapshot({ issue: functionBodySaveIssue(fixture.node, fixture.fn, current.environment,
          { registry: current.registry, evaluateContext: expectedFrame }) }, `direct save parity ${fixture.name}`);
        const reply = await worker.run(request);
        expect(reply?.ok, fixture.name).toBe(true);
        if (!reply?.ok) throw new Error(`Production save gate did not return: ${fixture.name}`);
        const actual = reply.result as AuthoringFunctionBodySaveIssue;
        expect(actual, fixture.name).toEqual(structuredClone(expected));
        if (fixture.issue === "absent") expect(actual.issue, fixture.name).toBeUndefined();
        if (fixture.issue === "present") expect(actual.issue, fixture.name).toBeDefined();
        const observation = observed.at(-1)!;
        const checked = observation.frame!;
        expect(checked).not.toBe(frame);
        expect(observation.declaration, fixture.name).toStrictEqual(rootDeclaration);
        expect(readerSourceMetadataNative(checked)).toEqual(sourceMetadata ? { $tag: "Just", _0: sourceMetadata } : Nothing);
        expect(Object.getOwnPropertyDescriptors(frame)).toEqual(before);
        expect(frame._readerSourceMetadata).toBe(old);
        expect({ fn: fixture.fn, node: fixture.node, rootDeclaration }, fixture.name).toStrictEqual(raw);
      }
    } finally { worker.dispose(); }
  }, 120_000);

  test("production worker constructs and retains a distinct actual Local draft scope", async () => {
    // C1 literal source data only: this module is NOT installed in another
    // registry. Both sides reuse this describe's one checked beforeAll reader.
    // Positional source syntax supplies a semantic key without pretending a
    // raw named source field has passed its normal field-identity admission.
    const loaded = loadFenelModule(`module ScopedWorkerDraft where
onlyDraft : a -> a
onlyDraft _0 = _0
`, "ScopedWorkerDraft");
    const source = loaded.functions?.find(fn => fn.id === "ScopedWorkerDraft:onlyDraft");
    const ingress = loaded.functionSignatureDeclarations?.find(row => row.functionId === source?.id);
    if (!source || !ingress?.scheme) throw new Error("Actual scoped draft source declaration unavailable");
    const authoredScheme = ingress.scheme;
    if (!("$arrow" in authoredScheme.body)) throw new Error("Actual scoped draft source arrow unavailable");
    expect(authoredScheme.body.$arrow.params[0]?.key).toEqual({ $tag: "PositionalField", index: 0 });
    expect(source.params[0]?.name).toBe(authoredScheme.body.$arrow.params[0]?.name);
    // Raw loader compatibility params discard semantic FieldKeys. A Local
    // editor owns the canonical arrow and uses UUID/HostSpec ingress; keep the
    // parser's entire authored scheme instead of treating an uninstalled
    // source module's compatibility function as a ready editor draft.
    const localId = "78000000-0000-4000-8000-000000000031";
    const localIngress = buildAuthoringSignatureDeclaration({ functionId: localId,
      declarationName: "onlyDraft", codeName: "onlyDraft", ownerModule: `authoring-${localId}`,
      parameterCount: authoredScheme.body.$arrow.params.length, inferResult: false, scheme: authoredScheme });
    const localDraft: FenelFunction = { ...source, id: localId,
      params: authoredScheme.body.$arrow.params, returns: authoredScheme.body.$arrow.returns,
      signatureDeclaration: localIngress };
    expect(localIngress.scheme).toBe(authoredScheme);
    expect(localIngress.scheme).toStrictEqual(ingress.scheme);
    const packet = (generation: string): ReaderSourceMetadata => ({ $tag: "ReaderSourceMetadata",
      source: { $tag: "ThisTabSource" }, rootId: "distinct-local-draft", generation,
      expressions: [], occurrences: [], callableLabels: [] });
    const oldPacket = packet("base"), jobPacket = packet("scoped-job");
    const base: AuthoringSession = Object.freeze({ ...session,
      evaluateContext: Object.freeze({ ...session.evaluateContext, _readerSourceMetadata: oldPacket }) });
    const baseFrameBefore = Object.getOwnPropertyDescriptors(base.evaluateContext);
    const rawScope: LocalAuthoringScope = { sourceId: "distinct-local-draft", functions: [],
      draft: localDraft };
    const capturedScope = registryTransportSnapshot(rawScope, "distinct Local scope capture");
    const candidate = registryTransportSnapshot(capturedScope.draft!, "distinct Local candidate");
    const declaration = candidate.signatureDeclaration!;
    const direct = createLocalAuthoringSession(base, capturedScope);
    expect(base.registry.getFunction(candidate.id)).toBeUndefined();
    expect(base.environment.getFunctionEntry?.(candidate.id)).toBeUndefined();
    expect(base.evaluateContext.getFunction?.(candidate.id)).toBeUndefined();
    expect(direct).not.toBe(base);
    expect(direct.registry).toBe(base.registry);
    expect(direct.evaluateContext._authority).toBe(base.evaluateContext._authority);
    // A later caller edit cannot change the already captured roster or retry.
    rawScope.draft!.body = "caller changed after capture";
    const expectedInference = registryTransportSnapshot(inferAuthoringFunctionDraft(candidate, declaration,
      direct.environment, { registry: direct.registry }), "distinct Local direct inference");
    if (expectedInference.outcome.$tag === "Invalid") console.error("[distinct-local-draft:direct-inference]", JSON.stringify({
      candidate, declaration, loaderCompatibility: { params: source.params, returns: source.returns },
      outcome: expectedInference.outcome,
    }));
    expect(expectedInference.outcome).toMatchObject({ $tag: "Solved" });
    const observed: Array<{ frame: EvaluateContext | undefined;
      declaration: ReturnType<typeof savedTransport.savedExpressionDeclaration> }> = [];
    const worker = await functionSemanticWorker(base, (frame, savedDeclaration) => {
      observed.push({ frame, declaration: savedDeclaration });
    });
    const contextId = 31;
    const first: FunctionSemanticRequest = { id: 300, method: "infer-function-draft", contextId,
      scope: capturedScope, fn: candidate, declaration };
    try {
      expect(worker.context(contextId)).toBeUndefined();
      const firstReply = await worker.run(first);
      expect(firstReply?.ok).toBe(true);
      if (!firstReply?.ok) throw new Error("Actual Local scoped inference failed");
      expect(firstReply.result).toStrictEqual(structuredClone(expectedInference));
      const selected = worker.context(contextId);
      if (!selected) throw new Error("The production request did not construct a Local context");
      expect(selected).not.toBe(base);
      expect(selected).not.toBe(direct);
      expect(Object.isFrozen(selected)).toBe(true);
      expect(selected.registry).toBe(base.registry);
      expect(selected.evaluateContext._authority).toBe(base.evaluateContext._authority);
      expect(selected.evaluateContext._activeTags).toBe(base.evaluateContext._activeTags);
      expect(structuredClone(selected.environment.getFunctionEntry?.(candidate.id)?.scheme)).toStrictEqual(structuredClone(declaration.scheme));
      expect(structuredClone(selected.evaluateContext.getFunction?.(candidate.id))).toStrictEqual(structuredClone(candidate));
      expect(structuredClone(selected.evaluateContext.getFunction?.(candidate.id)?.signatureDeclaration)).toStrictEqual(structuredClone(localIngress));
      expect(structuredClone(localAuthoringScopeForSession(selected))).toStrictEqual(structuredClone(capturedScope));
      // This is the real evaluator and actual new scoped callable, not a
      // fixture getContext binding of the same old base to another number.
      expect(evaluate({ call: [candidate.id, "scoped callable"] }, {}, selected.evaluateContext))
        .toBe("scoped callable");
      const reused: FunctionSemanticRequest = { id: 301, method: "infer-function-draft", contextId,
        fn: candidate, declaration };
      expect(Object.hasOwn(reused, "scope")).toBe(false);
      const reusedReply = await worker.run(reused);
      expect(reusedReply?.ok).toBe(true);
      if (!reusedReply?.ok) throw new Error("Actual Local context reuse failed");
      expect(reusedReply.result).toStrictEqual(structuredClone(expectedInference));
      expect(worker.context(contextId)).toBe(selected);

      const returnScheme = projectAuthoringScheme(declaration.scheme!, ["$arrow", "returns"]);
      if (!returnScheme) throw new Error("Actual scoped result declaration unavailable");
      const node = savedTransport.restoreSavedExpressionDeclaration({ kind: "param", name: candidate.params[0]!.name },
        { scheme: returnScheme });
      const rootDeclaration = savedTransport.savedExpressionDeclaration(node);
      expect(rootDeclaration).toStrictEqual({ scheme: returnScheme });
      const expectedSave = (sourceMetadata?: ReaderSourceMetadata) => registryTransportSnapshot({
        issue: functionBodySaveIssue(node, candidate, direct.environment, { registry: direct.registry,
          evaluateContext: readerSourceMetadataEvaluateContext(direct.evaluateContext, sourceMetadata) }),
      }, "distinct Local direct Save");
      const save: FunctionSemanticRequest = { id: 302, method: "function-body-save-issue", contextId,
        node, definition: candidate, ...(rootDeclaration ? { rootDeclaration } : {}), sourceMetadata: jobPacket };
      const saveReply = await worker.run(save);
      expect(saveReply?.ok).toBe(true);
      if (!saveReply?.ok) throw new Error("Actual Local scoped Save check failed");
      expect(saveReply.result).toStrictEqual(structuredClone(expectedSave(jobPacket)));
      expect((saveReply.result as AuthoringFunctionBodySaveIssue).issue).toBeUndefined();
      expect(worker.context(contextId)).toBe(selected);
      expect(structuredClone(observed.at(-1)?.declaration)).toStrictEqual(structuredClone(rootDeclaration));
      expect(observed.at(-1)?.frame?._authority).toBe(base.evaluateContext._authority);
      expect(readerSourceMetadataNative(observed.at(-1)!.frame!)).toEqual({ $tag: "Just", _0: jobPacket });
      expect(readerSourceMetadataNative(selected.evaluateContext)).toEqual({ $tag: "Just", _0: oldPacket });

      // Simulate a lost/evicted context in the actual worker-owned Map. This
      // does not claim to test its capacity threshold or automatic client retry.
      expect(worker.forgetContext(contextId)).toBe(true);
      const missing = await worker.run({ ...reused, id: 303 });
      expect(missing).toMatchObject({ id: 303, ok: false, code: "context-missing" });
      expect(worker.context(contextId)).toBeUndefined();
      const retry = await worker.run({ ...first, id: 304, scope: capturedScope });
      expect(retry?.ok).toBe(true);
      if (!retry?.ok) throw new Error("Actual Local captured-scope reconstruction failed");
      expect(retry.result).toStrictEqual(structuredClone(expectedInference));
      const restored = worker.context(contextId)!;
      expect(restored).not.toBe(base);
      expect(restored).not.toBe(selected);
      expect(restored.registry).toBe(base.registry);
      expect(structuredClone(restored.evaluateContext.getFunction?.(candidate.id))).toStrictEqual(structuredClone(candidate));
      expect(structuredClone(localAuthoringScopeForSession(restored))).toStrictEqual(structuredClone(capturedScope));
      const withoutMetadata: FunctionSemanticRequest = { id: 305, method: "function-body-save-issue", contextId,
        node, definition: candidate, ...(rootDeclaration ? { rootDeclaration } : {}) };
      const restoredSave = await worker.run(withoutMetadata);
      expect(restoredSave?.ok).toBe(true);
      if (!restoredSave?.ok) throw new Error("Actual restored Local Save check failed");
      expect(restoredSave.result).toStrictEqual(structuredClone(expectedSave()));
      expect(structuredClone(observed.at(-1)?.declaration)).toStrictEqual(structuredClone(rootDeclaration));
      expect(readerSourceMetadataNative(observed.at(-1)!.frame!)).toEqual(Nothing);
      expect(structuredClone(candidate.signatureDeclaration)).toStrictEqual(structuredClone(localIngress));
      expect(candidate.signatureDeclaration?.scheme).toStrictEqual(authoredScheme);
      expect(capturedScope.draft).toStrictEqual(candidate);
      expect(Object.getOwnPropertyDescriptors(base.evaluateContext)).toEqual(baseFrameBefore);
      expect(base.registry.getFunction(candidate.id)).toBeUndefined();
      expect(base.environment.getFunctionEntry?.(candidate.id)).toBeUndefined();
      expect(base.evaluateContext.getFunction?.(candidate.id)).toBeUndefined();
    } finally { worker.dispose(); }
  }, 120_000);


  test("named declared call admits empty and canonical pantries", () => {
    for (const pantry of [[], [food("Butter"), food("Egg")]]) {
      let output;
      try {
        output = evaluateAuthoringExpressionInSession({ kind: "call", fnId: "AdmissionRecipe:recipe", args: [literal(pantry)] }, undefined, session, {}, { trace: false, admitInvocations: true });
      } catch (error) {
        const expected = projectAuthoringScheme(recipeType, ["$arrow", "params", "0", "type"])!;
        const reader = session.evaluateContext;
        const imports = reader.getFunctionImportFrame?.("AdmissionRecipe:recipe");
        const context = authoringMembershipEvaluateContext({ ...reader, _sourceFunction: "AdmissionRecipe:recipe",
          _importStack: imports === undefined ? undefined : [imports] });
        const pure = pureEvaluateContext(context);
        const pantryOwner = reader._typeFamilyOwner?.("Pantry", "AdmissionRecipe:recipe");
        const canonical = reader.getFunction?.("AdmissionRecipe:canonical");
        const canonicalFacts = (frame: EvaluateContext) => ({ ports: diagnosticScopePorts(frame),
          result: diagnosticResult(() => canonical === undefined ? undefined : invokeCallable({ $ref: canonical.id }, [[]], frame)),
        });
        const directRefinement = diagnosticResult(() => {
          if (!pantryOwner || !("$refined" in pantryOwner.type)) return undefined;
          const scope = (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
            owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
          } | undefined })._typeDeclarationScope?.(pantryOwner.ownerIdentity);
          if (!scope) return undefined;
          const checking = authoringMembershipEvaluateContext({ ...reader, _sourceFunction: scope.sourceFunction,
            _importStack: [{ names: scope.names, aliases: {} }] });
          const set = pantryOwner.type.$refined.set;
          const layer = peelSetExpr(set);
          return { scope, ports: diagnosticScopePorts(checking), set, layer,
            contains: diagnosticResult(() => contains(set, [], null, {}, checking)),
            canonical: canonicalFacts(checking),
            predicate: diagnosticResult(() => layer?.kind === "SeWhere" ? evaluate(layer.pred, { value: [] }, checking) : undefined),
          };
        });
        const closed = closeAuthoringMembershipType(expected, context);
        const plans: unknown[] = [], observations: unknown[] = [];
        const checked = closed && validateValue(closed, pantry, null, { registry: session.registry, functions: context, coerce: false,
          strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
          observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
        });
        console.info("S5 positive admission facts", JSON.stringify({ expected, closed, checked, plans, observations,
          authority: closed && literalMembershipAuthority({ ...expected, body: closed }, session.environment, { registry: session.registry }),
          member: session.registry.callSiteTyping.member(expected, pantry, null, context),
          literal: literalMembershipFor(session.environment, { registry: session.registry, evaluateContext: context })(pantry, expected),
          hasDeclarationScope: "_typeDeclarationScope" in context,
          pantryOwner: pantryOwner === undefined ? { kind: "undefined" } : { identity: pantryOwner.identity,
            ownerIdentity: pantryOwner.ownerIdentity, type: pantryOwner.type,
            refinementSet: "$refined" in pantryOwner.type ? pantryOwner.type.$refined.set : { kind: "undefined" } },
          canonical: canonical === undefined ? { kind: "undefined" } : { id: canonical.id, params: canonical.params,
            returns: canonical.returns, body: canonical.body },
          canonicalCalls: { reader: canonicalFacts(reader), checking: canonicalFacts(context), pure: canonicalFacts(pure) },
          directRefinement,
        }));
        throw error;
      }
      expect(output.result).toEqual(pantry.length ? [pantry] : []);
    }
  });

  test("a stale catalogue cannot borrow a named body missing from the reader", () => {
    let fallbackExecutions = 0;
    const original = session.evaluateContext.getFunction;
    const current = { ...session, evaluateContext: { ...session.evaluateContext,
      getFunction: (id: string) => id === "AdmissionRecipe:recipe" || id === "recipe" ? undefined : original?.(id),
      natives: { ...session.evaluateContext.natives, "AdmissionRecipe:recipe": () => { fallbackExecutions++; return []; } },
    } };
    expect(() => evaluateAuthoringExpressionInSession({ kind: "call", fnId: "AdmissionRecipe:recipe", args: [literal([])] },
      undefined, current, {}, { trace: false, admitInvocations: true })).toThrow(/unavailable|reader|membership/i);
    expect(fallbackExecutions).toBe(0);
  });

  test("the saved Recipe alias and saved Pantry use the same persisted-type path as the starter", () => {
    const recipe = session.evaluateContext._typeFamilyOwner?.("Recipe", "AdmissionRecipe:recipe");
    const pantry = session.evaluateContext._typeFamilyOwner?.("Pantry", "AdmissionRecipe:recipe");
    if (!recipe || !pantry) throw new Error("Fixture declarations unavailable");
    const rows = (output?: unknown) => shareSavedExpressionMap(undefined, [
      { id: "pantry", query: { expr: literal([food("Butter")]), valueType: { $ref: pantry.identity } } },
      { id: "recipe", query: { valueType: { $ref: recipe.identity }, expr: literal({ __lambda: { params: ["pantry"],
        body: output === undefined ? literal({ __list: [{ kind: "param", name: "pantry" }] }) : literal(output),
      } }) } },
    ]);
    const node = apply(ref("recipe"), [ref("pantry")]);
    const initial = rows();
    console.info("S5 saved Recipe declaration facts", JSON.stringify({ recipe,
      ports: diagnosticScopePorts(session.evaluateContext),
      written: diagnosticResult(() => session.evaluateContext._callSiteTyping?.resolveType({ $ref: recipe.identity }, "AdmissionRecipe:recipe")),
      declaration: diagnosticResult(() => session.evaluateContext._callSiteTyping?.resolveTypeInDeclaration?.(recipe.type, recipe.ownerIdentity)),
    }));
    expect(evaluateAuthoringExpressionInSession(node, id => initial.get(id), session, {}, { trace: false }).result).toEqual([[food("Butter")]]);
    const edited = rows([[]]);
    expect(() => evaluateAuthoringExpressionInSession(node, id => edited.get(id), session, {}, { trace: false })).toThrow(/result|output/i);
    const hook = session.evaluateContext as typeof session.evaluateContext & { _typeDeclarationScope?: (identity: string) => unknown };
    const reader = { ...session, evaluateContext: { ...session.evaluateContext,
      _typeDeclarationScope: (identity: string) => identity === recipe.ownerIdentity ? undefined : hook._typeDeclarationScope?.(identity),
    } } as AuthoringSession;
    expect(() => evaluateAuthoringExpressionInSession(node, id => initial.get(id), reader, {}, { trace: false })).toThrow(/declaration|scope|reader/i);
  });

  test("a type-only physical Recipe declaration survives a saved callable argument", () => {
    const owner = session.evaluateContext._typeFamilyOwner?.("Recipe", "AdmissionRecipe:recipe");
    if (!owner || owner.identity === owner.name || !session.registry.getIdentifiedEntity(owner.identity)) {
      throw new Error("Actual physical Recipe declaration unavailable");
    }
    const valueType: FenelType = { $ref: owner.identity };
    const saved = shareSavedExpressionMap(undefined, [{ id: "recipe", query: { valueType,
      expr: literal({ __lambda: { params: ["pantry"], body: literal([]) } }),
    } }]);
    expect(savedTransport.savedExpressionDeclaration(saved.get("recipe")!)).toEqual({ type: valueType });
    const node: ExprNode = { kind: "call", fnId: "AdmissionRecipe:receiveRecipe", args: [ref("recipe")] };
    expect(evaluateAuthoringExpressionInSession(node, id => saved.get(id), session, {}, { trace: false }).result).toBe(1);
  });

  test.each([
    ["duplicate", [food("Butter"), food("Butter")]],
    ["descending", [food("Egg"), food("Butter")]],
    ["foreign", [food("UnknownFood")]],
    ["malformed", "not a pantry"],
  ])("named and saved closures refuse %s inputs before running their body", (_name, pantry) => {
    let executions = 0;
    const current = { ...session, evaluateContext: { ...session.evaluateContext,
      natives: { ...session.evaluateContext.natives,
        "AdmissionRecipe:recipe": () => { executions++; return []; },
        "AdmissionRecipe:tick": (value: unknown) => { executions++; return value; },
      },
    } };
    const node: ExprNode = { kind: "call", fnId: "AdmissionRecipe:recipe", args: [literal(pantry)] };
    expect(() => evaluateAuthoringExpressionInSession(node, undefined, current, {}, { trace: false, admitInvocations: true })).toThrow(/input|argument/i);
    const saved = savedRecipe(literal({ __list: [{ kind: "call", fnId: "AdmissionRecipe:tick", args: [{ kind: "param", name: "pantry" }] }] }));
    expect(() => evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal(pantry)]), id => saved.get(id), current, {}, { trace: false })).toThrow(/input|argument/i);
    expect(executions).toBe(0);
  });

  test.each([
    ["empty preparation", [[]]],
    ["duplicate", [[food("Butter"), food("Butter")]]],
    ["descending", [[food("Egg"), food("Butter")]]],
    ["foreign", [[food("UnknownFood")]]],
    ["mixed", [[food("Butter")], []]],
    ["malformed", "not preparations"],
  ])("saved closure refuses the whole %s output", (_name, output) => {
    expect(() => runSaved(literal(output), [])).toThrow(/result|output/i);
  });

  test("saved closure admits empty result and canonical preparations without normalizing", () => {
    for (const output of [[], [[food("Butter")]], [[food("Butter")], [food("Honey"), food("Egg")]]]) {
      let evaluated;
      try {
        evaluated = runSaved(literal(output), []);
      } catch (error) {
        const expected = projectAuthoringScheme(recipeType, ["$arrow", "returns"]);
        const reader = session.evaluateContext;
        const checking = authoringMembershipEvaluateContext(reader);
        const imports = reader.getFunctionImportFrame?.("AdmissionRecipe:recipe");
        const namedChecking = authoringMembershipEvaluateContext({ ...reader, _sourceFunction: "AdmissionRecipe:recipe",
          _importStack: imports === undefined ? undefined : [imports] });
        const frameFacts = (frame: EvaluateContext) => diagnosticResult(() => {
          if (!expected) return undefined;
          const resolved = frame._callSiteTyping?.resolveType(expected.body, frame._sourceFunction);
          const exact = expected.nominals?.length ? expected : resolved?.ok ? resolved.type : undefined;
          const closedType = exact && closeAuthoringMembershipType(exact, frame);
          const plans: ValidationAdmissionObservation[] = [];
          const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
          return { ports: diagnosticScopePorts(frame), resolved, exact, closedType,
            literal: diagnosticResult(() => literalMembershipFor(session.environment,
              { registry: session.registry, evaluateContext: frame })(output, expected)),
            member: diagnosticResult(() => exact === undefined ? undefined : session.registry.callSiteTyping.member(exact, output, null, frame)),
            plans, observations, validator: diagnosticResult(() => {
              if (!closedType) return undefined;
              const checked = validateValue(closedType, output, null, { registry: session.registry, functions: frame, coerce: false,
                strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
                observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
              });
              return { checked, classifier: authoringValidationMembership(checked, observations, plans) };
            }),
          };
        });
        const ingredients = reader._typeFamilyOwner?.("Ingredients", "AdmissionRecipe:recipe");
        const projections = expected?.nominals?.map(nominal => {
          const projected = projectAuthoringScheme(expected, nominal.path);
          const handle = reader._typeFamilyNominalHandle?.(nominal.identity, nominal.publicName, nominal.identity);
          const owner = handle === undefined ? undefined : reader._typeFamilyOwner?.(handle);
          return { nominal, projected, handle, owner,
            declaration: diagnosticResult(() => owner === undefined ? undefined
              : reader._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity)),
          };
        });
        console.info("S5 saved closure result admission facts", JSON.stringify({ candidate: output, recipeType, expected, projections,
          ingredients, ingredientsDeclaration: diagnosticResult(() => ingredients === undefined ? undefined
            : reader._callSiteTyping?.resolveTypeInDeclaration?.(ingredients.type, ingredients.ownerIdentity)),
          reader: frameFacts(reader), checking: frameFacts(checking), namedChecking: frameFacts(namedChecking),
        }));
        throw error;
      }
      expect(evaluated.result).toEqual(output);
    }
  });

  test("scoped result fields require the reader's exact target handle and owner", () => {
    const expected = projectAuthoringScheme(recipeType, ["$arrow", "returns"]);
    const reader = session.evaluateContext;
    const owner = reader._typeFamilyOwner?.("Food", "AdmissionRecipe:recipe");
    const handle = owner && reader._typeFamilyNominalHandle?.(owner.ownerIdentity, owner.name, owner.ownerIdentity);
    const imports = reader.getFunctionImportFrame?.("AdmissionRecipe:recipe");
    if (!expected || !owner || !handle || !imports) throw new Error("Actual result declaration fixture unavailable");
    const checking = { ...reader, _sourceFunction: "AdmissionRecipe:recipe", _importStack: [imports] };
    const value = [[food("Butter")]];
    expect(literalMembershipFor(session.environment, { registry: session.registry, evaluateContext: checking })(value, expected))
      .toEqual({ $tag: "Just", _0: true });
    const noHandle = { ...checking, _typeFamilyNominalHandle: (identity: string, spelling: string, explicit: string) =>
      identity === owner.ownerIdentity ? undefined : reader._typeFamilyNominalHandle?.(identity, spelling, explicit),
    };
    const wrongOwner = { ...checking, _entityNominalIdentity: (coordinate: string) =>
      coordinate === handle ? "different-field-target-owner" : reader._entityNominalIdentity?.(coordinate),
    };
    const scopeHook = (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
      owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
    } | undefined })._typeDeclarationScope;
    if (!scopeHook) throw new Error("Actual field-target declaration scope unavailable");
    const missingScope = { ...checking, _typeDeclarationScope: (identity: string) =>
      identity === owner.ownerIdentity ? undefined : scopeHook(identity),
    };
    const wrongScope = { ...checking, _typeDeclarationScope: (identity: string) => {
      const scope = scopeHook(identity);
      return identity === owner.ownerIdentity && scope ? { ...scope, owner: "different-field-declaration" } : scope;
    } };
    for (const unavailable of [noHandle, wrongOwner, missingScope, wrongScope]) {
      // The registry still supplies its real declaration/field index; only its
      // existing reader observation port is unavailable or inconsistent.
      const registry = { ...session.registry, evaluateContext: () => unavailable };
      expect(literalMembershipFor(session.environment, { registry, evaluateContext: unavailable })(value, expected))
        .toEqual({ $tag: "Nothing" });
    }
  });

  test("partial saved callable retains its owning remaining arrow contract", () => {
    const base = literal({ __lambda: { params: ["ignored", "pantry"], body: literal([[]]) } });
    const saved = typedSaved(undefined, [{ id: "recipe", query: {
      expr: apply(base, [literal(1)]), valueType: recipeType.body, valueScheme: recipeType,
    } }]);
    expect(() => evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal([])]), id => saved.get(id), session, {}, { trace: false })).toThrow(/result|output/i);
    expect(() => evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal([food("Egg"), food("Butter")])]), id => saved.get(id), session, {}, { trace: false })).toThrow(/input|membership|inhabit/i);
  });

  test("owned predicates use their actual declaration and an anonymous clone keeps the caller scope", () => {
    let shadowCalls = 0;
    const reader: EvaluateContext = { ...session.evaluateContext, _sourceFunction: "AdmissionRecipe:recipe",
      _importStack: [{ names: { canonical: "AdmissionRecipe:undecidable" }, aliases: {} }],
      natives: { ...session.evaluateContext.natives, "AdmissionRecipe:undecidable": () => { shadowCalls++; return false; } },
    };
    const owner = reader._typeFamilyOwner?.("Ingredients", "AdmissionRecipe:recipe");
    const scopeHook = (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
      owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
    } | undefined })._typeDeclarationScope;
    if (!owner || !scopeHook) throw new Error("Actual Ingredients declaration unavailable");
    const saved = savedRecipe(literal([[food("Butter")]]));
    const node = apply(ref("recipe"), [literal([])]);
    const current = { ...session, evaluateContext: reader };
    expect(evaluateAuthoringExpressionInSession(node, id => saved.get(id), current, {}, { trace: false }).result)
      .toEqual([[food("Butter")]]);
    expect(shadowCalls).toBe(0);

    for (const mismatch of [false, true]) {
      const unavailable = { ...reader, _typeDeclarationScope: (identity: string) => {
        const scope = scopeHook(identity);
        return identity !== owner.ownerIdentity ? scope : mismatch && scope
          ? { ...scope, owner: "different-predicate-declaration" } : undefined;
      } };
      expect(() => evaluateAuthoringExpressionInSession(node, id => saved.get(id), { ...session, evaluateContext: unavailable },
        {}, { trace: false })).toThrow(/result|output/i);
    }
    expect(shadowCalls).toBe(0);

    const anonymous = reader._callSiteTyping?.resolveTypeInDeclaration?.(structuredClone(owner.type), owner.ownerIdentity);
    if (!anonymous?.ok) throw new Error("Actual anonymous refinement fixture unavailable");
    expect(literalMembershipFor(session.environment, { registry: session.registry, evaluateContext: reader })(
      [food("Butter")], anonymous.type,
    )).toEqual({ $tag: "Just", _0: false });
    expect(shadowCalls).toBeGreaterThan(0);

    const actual = reader.getEntityType?.(owner.identity);
    if (!actual) throw new Error("Actual shared predicate declaration unavailable");
    const field = (index: number, type: FenelType) => ({ name: `_${index}`,
      key: { $tag: "PositionalField" as const, index }, type, label: { $tag: "Nothing" as const },
      ui: { $tag: "Nothing" as const }, meta: {},
    });
    // Both occurrences share the actual set object, but only the first names
    // its declaration. A raw-set-only sidecar would lend its scope to the
    // anonymous shallow clone later in this same validation run.
    const record: FenelType = { $record: { fields: [
      field(0, { $ref: owner.identity }), field(1, { ...actual }),
    ] } };
    shadowCalls = 0;
    const plans: ValidationAdmissionObservation[] = [];
    const checked = validateValue(record, { _0: [food("Butter")], _1: [food("Butter")] }, null, {
      registry: session.registry, functions: reader, coerce: false,
      strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
      observeAdmission: fact => plans.push(fact),
    });
    expect(checked.valid).toBe(false);
    expect(authoringValidationMembership(checked, [], plans)).toEqual({ $tag: "Just", _0: false });
    expect(shadowCalls).toBeGreaterThan(0);
  });

  for (const mode of ["strict form", "admission"] as const) {
    test(`owned scalar unions keep declaration predicates under caller shadow in ${mode}`, () => {
      for (const [value, callerVerdict, expected] of [[1, false, true], [-1, true, false]] as const) {
        let shadowCalls = 0;
        const typing = session.evaluateContext._callSiteTyping;
        if (!typing) throw new Error("Actual union membership port unavailable");
        const queries: Array<{ scheme: TypeScheme; candidate: unknown; verdict: string; account: string | null;
          sourceFunction?: string; ports?: ReturnType<typeof diagnosticScopePorts> }> = [];
        const reader: EvaluateContext = { ...session.evaluateContext, _sourceFunction: "AdmissionRecipe:recipe",
          _importStack: [{ names: { ownedScalarPositive: "AdmissionRecipe:undecidable" }, aliases: {} }],
          _callSiteTyping: { ...typing, member: (scheme, candidate, account, context) => {
            const verdict = typing.member(scheme, candidate, account, context);
            queries.push({ scheme, candidate, verdict, account, sourceFunction: context?._sourceFunction,
              ports: context === undefined ? undefined : diagnosticScopePorts(context) });
            return verdict;
          } },
          natives: { ...session.evaluateContext.natives, "AdmissionRecipe:undecidable": () => {
            shadowCalls++;
            return callerVerdict;
          } },
        };
        const owner = reader._typeFamilyOwner?.("OwnedScalarUnion", "AdmissionRecipe:recipe");
        if (!owner) throw new Error("Actual owned union declaration unavailable");
        const plans: ValidationAdmissionObservation[] = [];
        const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
        const checked = validateValue({ $ref: owner.identity }, value, null, {
          registry: session.registry, functions: reader, coerce: false,
          strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false,
            ...(mode === "admission" ? { membership: true } : {}) },
          ...(mode === "admission" ? { observeAdmission: (plan: ValidationAdmissionObservation) => plans.push(plan),
            observeMembership: (verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean }) => observations.push(verdict),
          } : {}),
        });
        const verdict = mode === "admission" ? authoringValidationMembership(checked, observations, plans) : undefined;
        if (checked.valid !== expected || checked.value !== value || shadowCalls !== 0
          || (mode === "admission" && (expected ? verdict?.$tag !== "Just" || !verdict._0 : verdict?.$tag === "Just" && verdict._0))) {
          const scalar = reader._typeFamilyOwner?.("OwnedScalar", "AdmissionRecipe:recipe");
          const scopeHook = (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => unknown })._typeDeclarationScope;
          console.info("S5 union shadow validation facts", JSON.stringify({ mode, value, callerVerdict, expected, shadowCalls,
            checked, verdict, plans, observations, queries, ports: diagnosticScopePorts(reader), unionOwner: owner, scalarOwner: scalar,
            unionScope: diagnosticResult(() => scopeHook?.(owner.ownerIdentity)),
            scalarScope: diagnosticResult(() => scalar === undefined ? undefined : scopeHook?.(scalar.ownerIdentity)),
            predicate: reader.getFunction?.("AdmissionRecipe:ownedScalarPositive"),
            observationMode: mode === "admission" ? "Validator admission observations enabled" : "Strict form; admission observations remain disabled",
            queryOrigin: "Only actual validator call-site member queries are recorded; no whole-literal helper query was added",
            baselineComparison: "No pre414 comparison was run here; root must run that baseline separately",
          }));
        }
        expect(checked.valid).toBe(expected);
        expect(checked.value).toBe(value);
        expect(shadowCalls).toBe(0);
        if (mode === "admission") {
          if (expected) expect(verdict).toEqual({ $tag: "Just", _0: true });
          else expect(verdict).not.toEqual({ $tag: "Just", _0: true });
        }
      }
    });
  }

  test("saved named partial validates its captured and newly supplied arguments", () => {
    const node = apply(ref("recipe"), [literal([food("Butter")])]);
    const partial = (marker: unknown) => typedSaved(undefined, [{ id: "recipe", query: {
      expr: { kind: "call", fnId: "AdmissionRecipe:taggedRecipe", args: [literal(marker)] }, valueScheme: recipeType,
    } }]);
    const valid = partial(1);
    let output;
    try {
      output = evaluateAuthoringExpressionInSession(node, id => valid.get(id), session, {}, { trace: false });
    } catch (error) {
      const declared = session.registry.getFunctionSignatureInfo("AdmissionRecipe:taggedRecipe")?.scheme;
      const expected = declared && projectAuthoringScheme(declared, ["$arrow", "params", "0", "type"]);
      const imports = session.evaluateContext.getFunctionImportFrame?.("AdmissionRecipe:taggedRecipe");
      const context = authoringMembershipEvaluateContext({ ...session.evaluateContext, _sourceFunction: "AdmissionRecipe:taggedRecipe",
        _importStack: imports === undefined ? undefined : [imports] });
      const numberDiagnostics = diagnosticResult(() => {
        const resolvedNumber = context._callSiteTyping?.resolveType({ $ref: "Number" }, context._sourceFunction);
        const closedResolvedNumber = resolvedNumber?.ok ? closeAuthoringMembershipType(resolvedNumber.type, context) : undefined;
        const expectedResolution = expected && expected.quantified.length === 0 && !expected.nominals?.length
          ? context._callSiteTyping?.resolveType(expected.body, context._sourceFunction) : undefined;
        const exact = expectedResolution ? expectedResolution.ok ? expectedResolution.type : undefined : expected;
        const rawExpectedClosed = expected && closeAuthoringMembershipType(expected, context);
        const closed = exact && closeAuthoringMembershipType(exact, context);
        const resolutions: unknown[] = [];
        const resolve = (name: string) => {
          const owner = context._typeFamilyOwner?.(name, context._sourceFunction);
          const resolved = owner && context._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity);
          const closed = resolved?.ok ? closeAuthoringMembershipType(resolved.type, context) : undefined;
          resolutions.push({ name, owner, resolved, closed });
          return closed;
        };
        const scoped = { ...session.environment,
          resolveTypeRef: (ref: FenelType) => "$ref" in ref ? resolve(ref.$ref) : undefined, resolveNamedType: resolve,
        };
        const nominal = exact?.nominals?.find(owner => owner.path.length === 0);
        const scope = nominal && expected && "$ref" in expected.body
          ? (context as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
            owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
          } | undefined })._typeDeclarationScope?.(nominal.identity) : undefined;
        const membershipContext = scope ? { ...context, _sourceFunction: scope.sourceFunction,
          _importStack: [{ names: { ...scope.names }, aliases: {} }] } : context;
        const widget = inlineWidgetFor(closed, undefined, scoped, { seed: false });
        const rawContains = (frame?: EvaluateContext) => diagnosticResult(() => widget === undefined ? undefined
          : contains(typeToSetExpr(widget.type), 1, null, {}, frame));
        const validate = (type: FenelType | undefined) => {
          const plans: ValidationAdmissionObservation[] = [];
          const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
          return { plans, observations, result: diagnosticResult(() => {
            if (type === undefined) return undefined;
            const checked = validateValue(type, 1, null, { registry: session.registry, functions: membershipContext, coerce: false,
              strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
              observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
            });
            return { type, checked, final: authoringValidationMembership(checked, observations, plans) };
          }) };
        };
        return { resolvedNumber, closedResolvedNumber, expectedResolution, exact, rawExpectedClosed, closed, widget, resolutions,
          scope, membershipPorts: diagnosticScopePorts(membershipContext),
          widgetSet: widget && typeToSetExpr(widget.type),
          rawContains: { checking: rawContains(membershipContext), reader: rawContains(session.evaluateContext), noContext: rawContains() },
          member: diagnosticResult(() => exact === undefined ? undefined : session.registry.callSiteTyping.member(exact, 1, null, membershipContext)),
          widgetValidation: validate(widget?.type), closedValidation: validate(closed),
          numberOwner: diagnosticResult(() => context._typeFamilyOwner?.("Number", context._sourceFunction)),
        };
      });
      console.info("S5 named partial collected-input facts", JSON.stringify({ expected, ports: diagnosticScopePorts(context),
        membership: diagnosticResult(() => expected === undefined ? undefined : literalMembershipFor(session.environment,
          { registry: session.registry, evaluateContext: context })(1, expected)),
        numberDiagnostics,
      }));
      throw error;
    }
    expect(output.result).toEqual([[food("Butter")]]);
    const invalid = partial("not a marker");
    expect(() => evaluateAuthoringExpressionInSession(node, id => invalid.get(id), session, {}, { trace: false })).toThrow(/input|membership|inhabit/i);
  });

  test("a declared saved recipe cannot become a noncallable value", () => {
    const saved = typedSaved(undefined, [{ id: "recipe", query: { expr: literal(42), valueScheme: recipeType } }]);
    expect(() => evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal([])]), id => saved.get(id), session, {}, { trace: false })).toThrow(/callable/i);
  });

  test("a declared unary recipe cannot silently return an underapplied closure", () => {
    const saved = savedRecipe(literal([]), ["pantry", "extra"]);
    expect(() => evaluateAuthoringExpressionInSession(apply(ref("recipe"), [literal([])]), id => saved.get(id), session, {}, { trace: false })).toThrow(/input|parameter|contract/i);
  });

  test("ordinary saved data retain union, tagged and List declarations", () => {
    if (!("$arrow" in recipeType.body)) throw new Error("Fixture arrow unavailable");
    const cases: Array<[FenelType, unknown]> = [
      [{ $union: [{ $ref: "String" }, { $ref: "Number" }] }, 1],
      [{ $tagged: { value: { $ref: "String" }, phantom: { $unit: true } } }, "data"],
      [recipeType.body.$arrow.params[0]!.type, []],
    ];
    for (const [body, value] of cases) {
      const saved = typedSaved(undefined, [{ id: "data", query: { expr: literal(value), valueScheme: { quantified: [], body } } }]);
      expect(evaluateAuthoringExpressionInSession(ref("data"), id => saved.get(id), session, {}, { trace: false }).result).toEqual(value);
    }
  });

  test("a changed saved definition rechecks its whole output", () => {
    const good = savedRecipe(literal([[food("Butter")]]));
    const bad = savedRecipe(literal([[]]));
    const node = apply(ref("recipe"), [literal([])]);
    expect(evaluateAuthoringExpressionInSession(node, id => good.get(id), session, {}, { trace: false }).result).toEqual([[food("Butter")]]);
    expect(() => evaluateAuthoringExpressionInSession(node, id => bad.get(id), session, {}, { trace: false })).toThrow();
  });

  test("undecided input membership refuses instead of becoming admitted data", () => {
    expect(() => evaluateAuthoringExpressionInSession({ kind: "call", fnId: "AdmissionRecipe:mysteryRecipe", args: [literal([])] }, undefined, session, {}, { trace: false, admitInvocations: true })).toThrow(/input|argument|membership|inhabit/i);
  });
  test("undecided output membership refuses instead of becoming admitted data", () => {
    expect(() => evaluateAuthoringExpressionInSession({ kind: "call", fnId: "AdmissionRecipe:unknownOutput", args: [literal([])] }, undefined, session, {}, { trace: false, admitInvocations: true })).toThrow(/result|output/i);
  });

  test("the argument and effectful callback body each run once", () => {
    let ticks = 0;
    const current = { ...session, evaluateContext: { ...session.evaluateContext,
      natives: { ...session.evaluateContext.natives, "AdmissionRecipe:tick": (value: unknown) => { ticks++; return value; } },
    } };
    const ticked: ExprNode = { kind: "call", fnId: "AdmissionRecipe:tick", args: [literal([food("Butter")])] };
    const body: ExprNode = literal({ __list: [{ kind: "call", fnId: "AdmissionRecipe:tick", args: [{ kind: "param", name: "pantry" }] }] });
    const saved = savedRecipe(body);
    const output = evaluateAuthoringExpressionInSession(apply(ref("recipe"), [ticked]), id => saved.get(id), current, {}, { trace: false });
    expect(output.result).toEqual([[food("Butter")]]);
    expect(ticks).toBe(2);
  });

  test("the production worker retains a saved lambda's live arrow and rechecks edits", async () => {
    const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf("const scope =")))
      .replaceAll("import.meta.env.BASE_URL", '"/"');
    const replies: Array<{ id: number; ok: boolean; result?: { result: unknown }; error?: string }> = [];
    const imports = {
      fixtureSession: session,
      globalThis: { postMessage: (reply: (typeof replies)[number] | AuthoringWorkerLifecycle) => {
        if ("ok" in reply) replies.push(structuredClone(reply));
      } },
      createAccountFieldRegistry: () => session.registry, modulesFor: () => [], dispatchRegistry: {}, registerCatalogEntities: () => {},
      evaluateContextForCatalog: () => session.evaluateContext, getCatalog: () => [], buildSessionCatalog: () => session.catalog,
      createDetachedAuthoringEnvironment: (environment: unknown) => environment, environmentForCatalog: () => session.environment,
      expressionMediaScheduling: () => ({ picture: false, sampled: false, weight: 1 }), readerSourceMetadataEvaluateContext,
      authoringExpressionAdmissionRequired, evaluateAuthoringExpressionInSession,
      isReaderExtensionMethod, runReaderExtension,
      restoreSavedExpressionDeclaration: savedTransport.restoreSavedExpressionDeclaration,
      restoreSavedExpressionDeclarations: (savedTransport as Record<string, unknown>).restoreSavedExpressionDeclarations,
    };
    // C1: run/transport/admission use the actual prepared reader. Catalogue
    // boot is covered by the separate worker suite, not these acquisition stubs.
    const worker = new Function(...Object.keys(imports), `${code}\nbase = fixtureSession; return { run };`)(...Object.values(imports)) as {
      run: (request: Record<string, unknown>) => Promise<void>;
    };
    const node = apply(ref("recipe"), [literal([])]);
    for (const [index, output] of [[], [[]], [[food("Butter")]]].entries()) {
      const saved = savedRecipe(literal(output));
      await worker.run(structuredClone({ id: index + 2, method: "evaluate-expression", contextId: 0, node,
        savedExpressions: [...saved], savedDeclarations: [["recipe", { scheme: recipeType }]],
      }));
      const reply = replies.at(-1)!;
      if (index === 1) expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/result|output/i) });
      else expect(reply).toMatchObject({ ok: true, result: { result: output } });
    }
    const owner = session.evaluateContext._typeFamilyOwner?.("Recipe", "AdmissionRecipe:recipe");
    if (!owner || owner.identity === owner.name || !session.registry.getIdentifiedEntity(owner.identity)) {
      throw new Error("Actual physical Recipe declaration unavailable");
    }
    const valueType: FenelType = { $ref: owner.identity };
    const cases: Array<{ output: unknown; pantry: unknown; issue?: RegExp }> = [
      { output: [], pantry: [] },
      { output: [[]], pantry: [], issue: /result|output/i },
      { output: [[food("Butter")]], pantry: [] },
      { output: [], pantry: [food("Egg"), food("Butter")], issue: /input 2/i },
      { output: [], pantry: [] },
    ];
    for (const [index, current] of cases.entries()) {
      // Match Home's persisted Type-only nominal declaration. No hand-supplied
      // arrow scheme or callable-contract table crosses the worker message.
      const saved = shareSavedExpressionMap(undefined, [{ id: "recipe", query: { valueType,
        expr: literal({ __lambda: { params: ["pantry"], body: literal(current.output) } }),
      } }]);
      const savedDeclarations = savedTransport.savedExpressionDeclarationEntries([...saved]);
      expect(savedDeclarations).toEqual([["recipe", { type: valueType }]]);
      const node: ExprNode = { kind: "call", fnId: "AdmissionRecipe:applyRecipe",
        args: [ref("recipe"), literal(current.pantry)] };
      await worker.run(structuredClone({ id: index + 20, method: "evaluate-expression", contextId: 0,
        node, savedExpressions: [...saved], savedDeclarations,
      }));
      const reply = replies.at(-1)!;
      if (current.issue) expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(current.issue) });
      else expect(reply).toMatchObject({ ok: true, result: { result: current.output } });
    }
  });

  test("qualified source calls retain the captured target before a redirected native can run", () => {
    let redirectedExecutions = 0;
    const current = { ...session, evaluateContext: { ...session.evaluateContext,
      natives: { ...session.evaluateContext.natives, "AdmissionRecipe:tick": () => {
        redirectedExecutions++;
        return [];
      } },
    } };
    const qualified: ExprNode = { kind: "call", fnId: "AdmissionRecipe:recipe", callSyntax: "method",
      sourceHead: "AdmissionRecipe.recipe", sourceTargetId: "AdmissionRecipe:recipe",
      args: [literal([food("Butter")])],
    };
    expect(evaluateAuthoringExpressionInSession(qualified, undefined, current, {}, {
      trace: false, admitInvocations: true,
    }).result).toEqual([[food("Butter")]]);
    expect(() => evaluateAuthoringExpressionInSession({ ...qualified, sourceHead: "AdmissionRecipe.tick" },
      undefined, current, {}, { trace: false, admitInvocations: true })).toThrow(/captured call target changed/i);
    expect(redirectedExecutions).toBe(0);
  });

  test("the production worker restores a direct saved root's callable declaration", async () => {
    const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf("const scope =")))
      .replaceAll("import.meta.env.BASE_URL", '"/"');
    const replies: Array<{ id: number; ok: boolean; result?: { result: unknown }; error?: string }> = [];
    const imports = {
      fixtureSession: session,
      globalThis: { postMessage: (reply: (typeof replies)[number] | AuthoringWorkerLifecycle) => {
        if ("ok" in reply) replies.push(structuredClone(reply));
      } },
      createAccountFieldRegistry: () => session.registry, modulesFor: () => [], dispatchRegistry: {}, registerCatalogEntities: () => {},
      evaluateContextForCatalog: () => session.evaluateContext, getCatalog: () => [], buildSessionCatalog: () => session.catalog,
      createDetachedAuthoringEnvironment: (environment: unknown) => environment, environmentForCatalog: () => session.environment,
      expressionMediaScheduling: () => ({ picture: false, sampled: false, weight: 1 }), readerSourceMetadataEvaluateContext,
      authoringExpressionAdmissionRequired, evaluateAuthoringExpressionInSession,
      isReaderExtensionMethod, runReaderExtension,
      restoreSavedExpressionDeclaration: savedTransport.restoreSavedExpressionDeclaration,
      restoreSavedExpressionDeclarations: savedTransport.restoreSavedExpressionDeclarations,
    };
    const worker = new Function(...Object.keys(imports), `${code}\nbase = fixtureSession; return { run, prepareEvaluation, startSlice };`)(...Object.values(imports)) as {
      run: (request: Record<string, unknown>) => Promise<void>;
      prepareEvaluation: (request: Record<string, unknown>) => { requiresAdmission?: boolean; error?: unknown };
      startSlice: (request: Record<string, unknown>) => unknown;
    };
    const cases = [
      { expr: literal(42), issue: /callable/i },
      { expr: literal({ __lambda: { params: ["pantry", "extra"], body: literal([]) } }), issue: /input|parameter|contract/i },
      { expr: literal({ __lambda: { params: ["pantry"], body: literal([]) } }), issue: undefined },
    ];
    for (const [index, fixture] of cases.entries()) {
      const saved = typedSaved(undefined, [{ id: "recipe", query: { expr: fixture.expr, valueScheme: recipeType } }]);
      const node = saved.get("recipe")!;
      const rootDeclaration = savedTransport.savedExpressionDeclaration(node);
      expect(rootDeclaration).toBeDefined();
      const request = structuredClone({ id: index + 2, method: "evaluate-expression", contextId: 0,
        node, rootDeclaration, savedExpressions: [],
      });
      const prepared = worker.prepareEvaluation(request);
      if (index > 0) expect(prepared.requiresAdmission).toBe(true);
      expect(worker.startSlice(request)).toBe("plain");
      await worker.run(request);
      if (fixture.issue) expect(replies.at(-1)).toMatchObject({ ok: false, error: expect.stringMatching(fixture.issue) });
      else expect(replies.at(-1)).toMatchObject({ ok: true, result: { result: { __fenelFn: true, params: ["pantry"] } } });
    }
  });

  describe("named higher-former admission fences", () => {
    const identityClosure = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };

    function named(name: string) {
      const reader = session.evaluateContext;
      const declared = session.registry.callSiteTyping.resolveType({ $ref: `AdmissionRecipe.${name}` }, undefined);
      const list = session.registry.callSiteTyping.resolveType(List({ $ref: `AdmissionRecipe.${name}` }), undefined);
      const owner = reader._typeFamilyOwner?.(name, "AdmissionRecipe:recipe");
      if (!declared.ok || !list.ok || !owner) throw new Error("Actual named higher-former fixture unavailable");
      return { reader, declared: declared.type, list: list.type, owner };
    }

    function nestedMember(value: unknown, expected: TypeScheme, reader: EvaluateContext) {
      expect(session.registry.callSiteTyping.member(expected, value, null, reader)).toBe("unknown");
      return literalMembershipFor(session.environment, { registry: session.registry, evaluateContext: reader })(value, expected);
    }

    test("a source arrow alias in a native List retains the callable-validation fence", () => {
      const { reader, declared, list, owner } = named("NamedFn");
      const body = "$refined" in owner.type ? owner.type.$refined.base : owner.type;
      expect("$arrow" in body).toBe(true);
      expect(session.registry.callSiteTyping.member(declared, identityClosure, null, reader)).toBe("yes");
      expect(nestedMember([identityClosure], list, reader)).toEqual({ $tag: "Nothing" });
      // Raw legacy function-name strings do not acquire an arrow witness.
      expect(session.registry.callSiteTyping.member(declared, "AdmissionRecipe:recipe", null, reader)).toBe("unknown");
      expect(nestedMember(["AdmissionRecipe:recipe"], list, reader)).toEqual({ $tag: "Nothing" });
    });

    test("a registered ground finite-map boundary alias retains the map-validation fence", () => {
      // This is the registered `$map` boundary fixture above. A source Vec
      // application would exercise `$el` rather than the map node at issue.
      const { reader, declared, list, owner } = named("FiniteStringMapBoundary");
      expect("$map" in owner.type).toBe(true);
      expect(session.registry.callSiteTyping.member(declared, ["ok"], null, reader)).toBe("yes");
      expect(nestedMember([["ok"]], list, reader)).toEqual({ $tag: "Nothing" });
      // Even a primitive carrier cannot bypass a resolved map's existing
      // unsupported flag if its current judgment supplies a legacy YES.
      expect(nestedMember(["x"], list, reader)).toEqual({ $tag: "Nothing" });
    });

    test("a source ADT checks only its actual chosen branch's callable fields", () => {
      const { reader, list, owner } = named("CallableChoice");
      if (!("$variant" in owner.type)) throw new Error("Actual callable-choice variant unavailable");
      const cases = owner.type.$variant.cases;
      const construct = (name: string, args: unknown[]) => {
        const constructor = cases.find(entry => entry.name === name)?.constructorFunction;
        if (!constructor) throw new Error("Actual chosen constructor identity unavailable");
        const value = invokeCallable(constructor, args, reader);
        expect(value).toMatchObject({ $tag: name });
        return value;
      };
      expect(nestedMember([construct("HasCallable", [identityClosure])], list, reader)).toEqual({ $tag: "Nothing" });
      expect(nestedMember([construct("NoCallable", [])], list, reader)).toEqual({ $tag: "Just", _0: true });
    });
  });

  describe("exact owned named String admission", () => {
    function fixture() {
      const reader = session.evaluateContext;
      const declared = session.registry.callSiteTyping.resolveType({ $ref: "system.String" }, undefined);
      if (!declared.ok) throw new Error("Actual canonical String scheme unavailable");
      const closed = closeAuthoringMembershipType(declared.type, reader);
      if (!closed || !("$ref" in closed)) throw new Error("Actual physical String coordinate unavailable");
      const owner = reader._typeFamilyOwner?.(closed.$ref);
      const nominal = declared.type.nominals?.find(row => row.path.length === 0);
      if (!owner || !nominal || owner.ownerIdentity !== nominal.identity) throw new Error("Actual String owner unavailable");
      const scopeHook = (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
        owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
      } | undefined })._typeDeclarationScope;
      const scope = scopeHook?.(owner.ownerIdentity);
      if (!scopeHook || scope?.owner !== owner.ownerIdentity) throw new Error("Actual String declaration scope unavailable");
      return { reader, declared: declared.type, closed, owner, scopeHook, scope };
    }

    function admit(value: unknown, reader: EvaluateContext, physical: FenelType) {
      const typing = reader._callSiteTyping;
      if (!typing) throw new Error("Actual call-site membership owner unavailable");
      const queries: Array<{ scheme: TypeScheme; candidate: unknown; verdict: string;
        sourceFunction?: string; ports?: ReturnType<typeof diagnosticScopePorts> }> = [];
      const checking = authoringMembershipEvaluateContext({ ...reader, _callSiteTyping: { ...typing,
        member: (scheme, candidate, account, context) => {
          const verdict = typing.member(scheme, candidate, account, context);
          queries.push({ scheme, candidate, verdict, sourceFunction: context?._sourceFunction,
            ports: context === undefined ? undefined : diagnosticScopePorts(context) });
          return verdict;
        },
      } });
      const plans: ValidationAdmissionObservation[] = [];
      const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
      const checked = validateValue(physical, value, null, {
        registry: { ...session.registry, evaluateContext: () => checking }, functions: checking, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeAdmission: plan => plans.push(plan), observeMembership: verdict => observations.push(verdict),
      });
      return { checked, plans, queries, verdict: authoringValidationMembership(checked, observations, plans) };
    }

    test("the physical source Named node uses exact String membership in both directions", () => {
      const { reader, declared, closed, owner, scope } = fixture();
      const knownPositive = session.registry.callSiteTyping.member(declared, "canonical text", null, reader);
      const knownNegative = session.registry.callSiteTyping.member(declared, 42, null, reader);
      const ownerType = reader._callSiteTyping?.resolveTypeInDeclaration?.(owner.type, owner.ownerIdentity);
      const facts = () => ({ declared, closed, owner: { identity: owner.identity, ownerIdentity: owner.ownerIdentity,
        name: owner.name, typeKeys: Object.keys(owner.type),
        opaqueName: "$opaque" in owner.type ? owner.type.$opaque.name : undefined },
        ownerType: ownerType?.ok ? { ok: true, quantified: ownerType.type.quantified,
          bodyKeys: Object.keys(ownerType.type.body), nominals: ownerType.type.nominals } : ownerType,
        scope: { owner: scope.owner, sourceFunction: scope.sourceFunction, names: Object.keys(scope.names) },
        knownPositive, knownNegative, ports: diagnosticScopePorts(reader),
      });
      if (knownPositive !== "yes" || knownNegative !== "no") console.info("S5 exact String query preconditions", JSON.stringify(facts()));
      expect(knownPositive).toBe("yes");
      expect(knownNegative).toBe("no");
      for (const [value, expected] of [["canonical text", true], [42, false]] as const) {
        const result = admit(value, reader, closed);
        // The physical coordinate must reach the source Named judgment. A
        // primitive-name presentation fast path cannot satisfy this control.
        const queried = result.queries.some(query => query.scheme.nominals?.some(row => row.path.length === 0
          && row.identity === owner.ownerIdentity));
        if (!queried || result.verdict.$tag !== "Just" || result.verdict._0 !== expected) {
          console.info("S5 exact String Named facts", JSON.stringify({ value, expected, ...facts(), ...result }));
        }
        expect(queried).toBe(true);
        expect(result.verdict).toEqual({ $tag: "Just", _0: expected });
        expect(result.checked.valid).toBe(expected);
        expect(result.checked.value).toBe(value);
      }
    });

    test("missing exact owner or declaration scope keeps physical String admission undecided", () => {
      const { reader, closed, owner, scopeHook } = fixture();
      const noOwner: EvaluateContext = { ...reader,
        _entityNominalIdentity: coordinate => {
          const selected = reader._entityNominalIdentity?.(coordinate);
          return selected === owner.ownerIdentity ? undefined : selected;
        },
        _typeFamilyOwner: (name, source) => {
          const selected = reader._typeFamilyOwner?.(name, source);
          return selected?.ownerIdentity === owner.ownerIdentity ? undefined : selected;
        },
      };
      const noScope = { ...reader, _typeDeclarationScope: (identity: string) =>
        identity === owner.ownerIdentity ? undefined : scopeHook(identity),
      };
      for (const [label, unavailable] of [["noOwner", noOwner], ["noScope", noScope]] as const) {
        const result = admit("canonical text", unavailable, closed);
        const observedUnknown = result.plans.some(plan => plan.$tag === "ValidationAdmissionMember" && plan.verdict.$tag === "Nothing");
        if (!observedUnknown || result.verdict.$tag !== "Nothing") {
          console.info("S5 missing String declaration facts", JSON.stringify({ label, closed, owner: owner.ownerIdentity,
            ports: diagnosticScopePorts(unavailable), ...result }));
        }
        expect(observedUnknown).toBe(true);
        expect(result.verdict).toEqual({ $tag: "Nothing" });
      }
    });

    test("noncoercing strict schema forms reuse exact scalar membership without admission observations", () => {
      const { reader, closed, owner } = fixture();
      const typing = reader._callSiteTyping;
      if (!typing) throw new Error("Actual call-site membership owner unavailable");
      const queries: Array<{ scheme: TypeScheme; context: EvaluateContext | undefined }> = [];
      const checking: EvaluateContext = { ...reader, _callSiteTyping: { ...typing,
        member: (scheme, candidate, account, context) => {
          queries.push({ scheme, context });
          return typing.member(scheme, candidate, account, context);
        },
      } };
      for (const [value, expected] of [["canonical text", true], [42, false]] as const) {
        const result = validateValue(closed, value, null, {
          registry: session.registry, functions: checking, coerce: false,
          strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false },
        });
        expect(result.valid).toBe(expected);
        expect(result.value).toBe(value);
      }
      expect(queries.length).toBe(2);
      for (const query of queries) {
        expect(query.scheme.nominals?.some(row => row.path.length === 0 && row.identity === owner.ownerIdentity)).toBe(true);
        expect(query.context?._performTable).toBeUndefined();
        expect(query.context?._ioHandlerContext).toBeUndefined();
        expect(query.context?._authority).toBe(reader._authority);
        expect(query.context?._sourceFunction).toBe(reader._sourceFunction);
      }
      const ordinary = validateValue({ $ref: "Number" }, "12", null, {
        registry: session.registry, functions: reader, coerce: true,
      });
      expect(ordinary.valid).toBe(true);
      expect(ordinary.value).toBe(12);
    });

    for (const mode of ["strict form", "admission"] as const) {
      test(`selected root and alias definitions cannot borrow registered String membership in ${mode}`, () => {
        const { reader, closed } = fixture();
        const alias = reader._typeFamilyOwner?.("ScalarAlias", "AdmissionRecipe:recipe");
        if (!alias) throw new Error("Actual registered scalar alias unavailable");
        const excluded: FenelType = { $opaque: { name: "Excluded", pure: {
          $variant: { cases: [{ name: "OnlyExcluded", fields: [], label: Nothing }] },
        } } };
        const cases: Array<{ type: FenelType; definitions: Record<string, FenelType> }> = [
          { type: closed, definitions: { [closed.$ref]: excluded } },
          { type: { $ref: alias.identity }, definitions: { "system.String": excluded } },
        ];
        const check = (type: FenelType, definitions?: Record<string, FenelType>) => {
          const plans: ValidationAdmissionObservation[] = [];
          const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
          const checked = validateValue(type, "canonical text", null, {
            registry: session.registry, functions: reader, coerce: false, $defs: definitions,
            strict: { primitiveTypes: true, rejectOmitted: true, rejectAdded: false,
              ...(mode === "admission" ? { membership: true } : {}) },
            ...(mode === "admission" ? { observeAdmission: (plan: ValidationAdmissionObservation) => plans.push(plan),
              observeMembership: (verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean }) => observations.push(verdict),
            } : {}),
          });
          return { checked, verdict: mode === "admission" ? authoringValidationMembership(checked, observations, plans) : undefined };
        };
        for (const candidate of cases) {
          const baseline = check(candidate.type);
          expect(baseline.checked.valid).toBe(true);
          if (mode === "admission") expect(baseline.verdict).toEqual({ $tag: "Just", _0: true });
          const overridden = check(candidate.type, candidate.definitions);
          expect(overridden.checked.valid).toBe(false);
          expect(overridden.checked.value).toBe("canonical text");
          if (mode === "admission") expect(overridden.verdict).not.toEqual({ $tag: "Just", _0: true });
        }
      });
    }

  });
});

describe("authoring admits actual reflection output through its declared type", () => {
  test("ReifyOutcome checks heterogeneous captures, unused params and nested payloads", () => {
    const source = loadFenelModule(REFLECTION_SOURCE, "engine");
    const registry = strictReflectionFixtureRegistry([stdModule, evaluatorStrategiesModule, source]);
    const reader = registry.evaluateContext();
    const environment = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], { registry }));
    const declared = registry.callSiteTyping.resolveType({ $ref: "engine.ReifyOutcome" }, undefined);
    if (!declared.ok) throw new Error("Actual reflection outcome declaration unavailable");
    const payload = registry.callSiteTyping.resolveType({ $ref: "engine.ReflectionValue" }, undefined);
    const payloadType = payload.ok && closeAuthoringMembershipType(payload.type, reader);
    const payloadOwner = payloadType && "$ref" in payloadType ? reader._typeFamilyOwner?.(payloadType.$ref) : undefined;
    const scopeReader = reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
      owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
    } | undefined };
    const payloadScope = payloadOwner && scopeReader._typeDeclarationScope?.(payloadOwner.ownerIdentity);
    const helper = reader.getFunction?.("engine:reflectionValueType");
    if (!payload.ok || !payloadOwner || !("$refined" in payloadOwner.type) || !payloadScope || !helper) {
      throw new Error("Actual reflection payload declaration and evaluator fixture unavailable");
    }
    expect(payloadScope.owner).toBe(payloadOwner.ownerIdentity);
    const payloadReader = authoringMembershipEvaluateContext({ ...reader, _sourceFunction: payloadScope.sourceFunction,
      _importStack: [{ names: { ...payloadScope.names }, aliases: {} }] });
    // This uses the shipped Evaluator class selection and its actual strategy
    // module; direct execution of the Type helper alone is insufficient.
    expect(resolveCompleteMethodForEvaluation(payloadReader, "Evaluator", "eval", ["EagerStrategy"])?.$tag)
      .toBe("Resolved");
    expect(resolveEl(payloadOwner.type.$refined.base, {}, payloadReader)).toEqual({ $complement: { $void: true } });
    const hiddenHelper = (name: string) => {
      const current = reader.getFunction?.(name);
      return current?.id === helper.id ? undefined : current;
    };
    expect(resolveEl(payloadOwner.type.$refined.base, {}, { ...payloadReader, getFunction: hiddenHelper }))
      .toBeUndefined();
    const closure = { __fenelFn: true, params: ["unused", "alsoUnused"],
      body: { left: { var: "left" }, right: { var: "right" } },
      closure: { left: [1, 2], right: "captured text" },
    };
    const outcome = dispatchedReifyInReader(closure, reader) as {
      $tag: string; package: { params: unknown[]; body: { $tag: string; fields: Array<{ name: unknown; value: unknown }> };
        captures: Array<{ name: string; value: unknown; origin: unknown }>; dependencies: unknown[] };
    };
    expect(outcome.$tag).toBe("Reified");
    expect(outcome.package.params).toEqual(["unused", "alsoUnused"]);
    expect(outcome.package.body.$tag).toBe("ERecord");
    expect(outcome.package.captures.map(capture => [capture.name, capture.value])).toEqual([
      ["left", [1, 2]], ["right", "captured text"],
    ]);
    const member = literalMembershipFor(environment, { registry, evaluateContext: reader });
    const verdict = member(outcome, declared.type);
    const payloadScopeHook = scopeReader._typeDeclarationScope;
    if (!payloadScopeHook) throw new Error("Actual reflection payload scope port unavailable");
    const fakePayloadOwner: EvaluateContext = { ...reader, _typeFamilyOwner: (name, sourceFunction) => {
      const current = reader._typeFamilyOwner?.(name, sourceFunction);
      return current?.ownerIdentity === payloadOwner.ownerIdentity ? { ...current, ownerIdentity: "different-reflection-payload-owner" } : current;
    } };
    const fakePayloadScope = { ...reader, _typeDeclarationScope: (identity: string) => {
      const current = payloadScopeHook(identity);
      return identity === payloadOwner.ownerIdentity && current ? { ...current, owner: "different-reflection-payload-scope" } : current;
    } };
    const directPayloadCases = outcome.package.captures.map(capture => ({ name: capture.name, value: capture.value,
      verdict: member(capture.value, payload.type),
      refusals: ([["fakeOwner", fakePayloadOwner], ["fakeScope", fakePayloadScope]] as const).map(([label, current]) => ({ label,
        verdict: literalMembershipFor(environment, { registry, evaluateContext: current })(capture.value, payload.type),
      })),
    }));
    const directPayloadFailed = directPayloadCases.some(candidate => candidate.verdict.$tag !== "Just" || candidate.verdict._0 !== true
      || candidate.refusals.some(refusal => refusal.verdict.$tag !== "Nothing"));
    if (verdict.$tag !== "Just" || verdict._0 !== true || directPayloadFailed) {
      const nominal = declared.type.nominals?.find(owner => owner.path.length === 0);
      const scope = nominal && (reader as EvaluateContext & { _typeDeclarationScope?: (identity: string) => {
        owner: string; names: Readonly<Record<string, string>>; sourceFunction?: string;
      } | undefined })._typeDeclarationScope?.(nominal.identity);
      const checking = authoringMembershipEvaluateContext(scope ? { ...reader, _sourceFunction: scope.sourceFunction,
        _importStack: [{ names: { ...scope.names }, aliases: {} }] } : reader);
      const closed = closeAuthoringMembershipType(declared.type, checking);
      const plans: ValidationAdmissionObservation[] = [];
      const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
      const checked = closed && validateValue(closed, outcome, null, { registry, functions: checking, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeAdmission: plan => plans.push(plan), observeMembership: result => observations.push(result),
      });
      const actualOwner = closed && "$ref" in closed ? checking._typeFamilyOwner?.(closed.$ref, checking._sourceFunction) : undefined;
      const payloadBase = payloadOwner.type.$refined.base;
      const purePayloadReader = pureEvaluateContext(payloadReader);
      const pureRootReader = pureEvaluateContext(checking);
      const payloadFrameFacts = (frame: EvaluateContext) => {
        const lookup = (name: string) => diagnosticResult(() => {
          const selected = frame.getFunction?.(name);
          return selected === undefined ? undefined : { id: selected.id, params: selected.params,
            returns: selected.returns, body: selected.body };
        });
        return { ports: diagnosticScopePorts(frame),
          evaluator: diagnosticResult(() => resolveCompleteMethodForEvaluation(frame, "Evaluator", "eval", ["EagerStrategy"])),
          helper: { exact: lookup(helper.id), bare: lookup("reflectionValueType"), qualified: lookup("engine.reflectionValueType") },
          ownerBaseResolution: diagnosticResult(() => resolveEl(payloadBase, {}, frame)),
        };
      };
      const payloadValidations = outcome.package.captures.map(capture => {
        const payloadPlans: ValidationAdmissionObservation[] = [];
        const payloadObservations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
        return { name: capture.name, value: capture.value, plans: payloadPlans, observations: payloadObservations,
          result: diagnosticResult(() => {
            if (!payloadType) return undefined;
            const result = validateValue(payloadType, capture.value, null, { registry, functions: purePayloadReader, coerce: false,
              strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
              observeAdmission: plan => payloadPlans.push(plan), observeMembership: observed => payloadObservations.push(observed),
            });
            return { checked: result, classifier: authoringValidationMembership(result, payloadObservations, payloadPlans) };
          }),
        };
      });
      console.error("S5 actual reflection output admission", JSON.stringify({ verdict, declared, closed, scope, checked, plans, observations,
        directPayloadCases,
        directPayloadQueryOrigin: "Preexisting whole-literal helper query plus its existing validator fallback; separate strict payload validations below enable admission observations explicitly",
        classifier: checked && authoringValidationMembership(checked, observations, plans),
        reflected: checking._callSiteTyping?.reflect(outcome), actualOwner,
        directResolution: closed && checking._callSiteTyping?.resolveType(closed, checking._sourceFunction),
        ownerResolution: actualOwner && checking._callSiteTyping?.resolveTypeInDeclaration?.(actualOwner.type, actualOwner.ownerIdentity),
        payloadDependentBaseline: { type: payloadType, owner: payloadOwner, scope: payloadScope, base: payloadBase,
          declarationResolution: diagnosticResult(() => reader._callSiteTyping?.resolveTypeInDeclaration?.(payloadOwner.type, payloadOwner.ownerIdentity)),
          rawBridgeObservation: "The actual validationResolveEl rawType is not observed here; base is the owning declaration's baseline.",
          noPerform: payloadFrameFacts(payloadReader), pure: payloadFrameFacts(purePayloadReader),
          rootPure: payloadFrameFacts(pureRootReader), validations: payloadValidations,
        },
      }));
    }
    for (const candidate of directPayloadCases) {
      expect(candidate.verdict).toEqual({ $tag: "Just", _0: true });
      for (const refusal of candidate.refusals) expect(refusal.verdict).toEqual({ $tag: "Nothing" });
    }
    expect(verdict).toEqual({ $tag: "Just", _0: true });

    const missingHelper = { ...reader, getFunction: hiddenHelper };
    // Hide the one exact declaration through every alias while retaining the
    // schema and reader ports; no private helper may fill the reader's miss.
    expect(literalMembershipFor(environment, { registry, evaluateContext: missingHelper })(outcome, declared.type))
      .not.toEqual({ $tag: "Just", _0: true });

    const outcomeType = closeAuthoringMembershipType(declared.type, reader);
    const outcomeOwner = outcomeType && "$ref" in outcomeType ? reader._typeFamilyOwner?.(outcomeType.$ref) : undefined;
    const declarationScope = scopeReader._typeDeclarationScope;
    if (!outcomeOwner || !declarationScope) throw new Error("Actual reflection declaration owner unavailable");
    const ownerUnavailable = { ...reader, _typeFamilyOwner: (name: string, sourceFunction?: string) => {
      const current = reader._typeFamilyOwner?.(name, sourceFunction);
      return current?.ownerIdentity === outcomeOwner.ownerIdentity ? undefined : current;
    } };
    const ownerMismatch = { ...reader, _typeDeclarationScope: (identity: string) => {
      const current = declarationScope(identity);
      return identity === outcomeOwner.ownerIdentity && current ? { ...current, owner: "different-declaration" } : current;
    } };
    const scopeUnavailable = { ...reader, _typeDeclarationScope: (identity: string) =>
      identity === outcomeOwner.ownerIdentity ? undefined : declarationScope(identity),
    };
    for (const unavailable of [ownerUnavailable, ownerMismatch, scopeUnavailable]) {
      expect(literalMembershipFor(environment, { registry, evaluateContext: unavailable })(outcome, declared.type))
        .toEqual({ $tag: "Nothing" });
    }

    const badParam = structuredClone(outcome);
    badParam.package.params[0] = 42;
    const genericRecordPayload = structuredClone(outcome);
    genericRecordPayload.package.body.fields[0]!.name = 42;
    // ERecord.fields is the generic payload a, so Expr ReflectionValue admits
    // this data. EVar.name is a separate, genuinely String-typed schema field.
    expect(member(genericRecordPayload, declared.type)).toEqual({ $tag: "Just", _0: true });
    const badExprName = { ...structuredClone(outcome), package: { ...structuredClone(outcome.package),
      body: { $tag: "EVar", name: 42 },
    } };
    const badCaptureOrigin = structuredClone(outcome);
    badCaptureOrigin.package.captures[0]!.origin = { $tag: "PartialArgument", index: "not a number" };
    const badDependency = structuredClone(outcome);
    badDependency.package.dependencies.push({ $tag: "ReifiedDependency", identity: "unavailable", outcome: { $tag: "ForgedOutcome" } });
    for (const [label, forged] of [["parameter", badParam], ["expression variable name", badExprName],
      ["capture origin", badCaptureOrigin], ["dependency outcome", badDependency]] as const) {
      const result = member(forged, declared.type);
      if (result.$tag === "Just" && result._0) console.error("S5 unexpected forged reflection admission", JSON.stringify({ label, result }));
      expect(result).not.toEqual({ $tag: "Just", _0: true });
    }
  }, 180_000);
});
