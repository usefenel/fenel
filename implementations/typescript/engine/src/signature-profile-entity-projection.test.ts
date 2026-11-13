import { describe, expect, test } from "bun:test";

import { modulesFor } from "./module-manifest";
import { createRepositoryRegistry } from "./repository-registry";
import type { RegistryConstructorSignature } from "./registry";
import { inferJsonLogicType } from "./signature-inference";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "./authoring/signature-authoring";
import { validateValue, type ValidationAdmissionObservation } from "./validate";
import { Just, Nothing } from "./type-foundation";
import type { TypeScheme } from "./types";
import { loadFenelModule } from "./fenel-module";
import { constructorSemanticFieldRead, evaluate, moduleSourceCoordinate, type EvaluateContext } from "./json-logic";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import PATTERN_ALGEBRA_FENEL from "../../../../fenel/modules/engine/pattern-algebra.fenel?raw";
import REFLECT_FENEL from "../../../../fenel/modules/engine/reflect.fenel?raw";
import LISP_TOOLS_FENEL from "../../../../fenel/modules/publicdemo/lisp-tools.fenel?raw";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import { actionResultModule } from "./modules/action-result";
import { COMPILER_TARGET_ENTITY_MODULES } from "./modules/compiler-target-entities";
import {
  FLOOR_LAW_ENTITY_IDS,
  PAT_ENTITY_IDS,
  PUBLIC_RECIPE_ENTITY_IDS,
  SET_EXPR_ENTITY_IDS,
  setExprEntityModule,
} from "./modules/set-expr-entities";

function exactConstructorResolver(signatures: readonly RegistryConstructorSignature[]) {
  return (sourceName: string) => {
    const separator = sourceName.indexOf(".");
    const ownerModule = separator < 0 ? undefined : sourceName.slice(0, separator);
    const constructorName = separator < 0 ? sourceName : sourceName.slice(separator + 1);
    const matches = signatures.filter((signature) =>
      signature.name === constructorName
      && (ownerModule === undefined || signature.ownerModule === ownerModule)
    );
    if (matches.length !== 1) {
      return { status: matches.length === 0 ? "missing" : "ambiguous" } as const;
    }
    const selected = matches[0]!;
    if (selected.outcome.$tag !== "Solved" || selected.scheme === undefined) {
      return { status: "missing" } as const;
    }
    return {
      status: "resolved" as const,
      targetId: selected.targetId,
      params: selected.params,
      returns: selected.returns,
      scheme: selected.scheme,
    };
  };
}

describe("authoritative profile entity projections", () => {
  test("self-host artifact projections expose target constructors without executable functions", () => {
    // modules-as-values (2026-09-24): the containers are identifiers; their
    // function ids keep the `compile-*:` namespaces.
    expect(COMPILER_TARGET_ENTITY_MODULES.map(({ name }) => name)).toEqual([
      "compileJs",
      "compileWasm",
      "compileLlvm",
    ]);
    expect(COMPILER_TARGET_ENTITY_MODULES.map((module) => module.entities?.length)).toEqual([
      5,
      20,
      22,
    ]);
    for (const module of COMPILER_TARGET_ENTITY_MODULES) {
      expect(module.functions).toEqual([]);
      expect(module.instances).toEqual([]);
      expect(module.entities?.every((entity) => entity.module === module.name)).toBe(true);
      expect(module.entities?.every((entity) => entity.typeScheme !== undefined)).toBe(true);
      expect(module.entities?.every((entity) => entity.typeScheme?.quantified.length === 0)).toBe(true);
      expect(module.entities?.every(
        (entity) => !JSON.stringify(entity.typeScheme?.body).includes('"$var"'),
      )).toBe(true);
    }
    expect(COMPILER_TARGET_ENTITY_MODULES[1]?.entities?.some(({ id }) => id === "WasmDomain")).toBe(true);
    expect(COMPILER_TARGET_ENTITY_MODULES[2]?.entities?.some(({ id }) => id === "LlvmDomain")).toBe(true);

    const llvmLowerOutput = COMPILER_TARGET_ENTITY_MODULES[2]?.entities?.find(
      ({ id }) => id === "LlvmLowerOutput",
    )?.typeScheme?.body;
    expect(llvmLowerOutput && "$record" in llvmLowerOutput
      ? llvmLowerOutput.$record.fields.map(({ name, type }) => ({ name, type }))
      : undefined).toEqual([
      { name: "operand", type: { $ref: "LlvmOperand" } },
      { name: "domain", type: { $ref: "LlvmDomain" } },
    ]);

    const wasmLowerOutput = COMPILER_TARGET_ENTITY_MODULES[1]?.entities?.find(
      ({ id }) => id === "LowerOutput",
    )?.typeScheme?.body;
    expect(wasmLowerOutput && "$record" in wasmLowerOutput
      ? wasmLowerOutput.$record.fields.find(({ name }) => name === "domain")?.type
      : undefined).toEqual({ $ref: "WasmDomain" });
  });

  test("system and seed expose exact source owners with only their source Type helper", () => {
    expect(SYSTEM_REGISTRY_MODULES.filter((module) => module === setExprEntityModule)).toHaveLength(1);
    expect(modulesFor("seed").filter((module) => module === setExprEntityModule)).toHaveLength(1);
    expect(modulesFor("execute")).not.toContain(setExprEntityModule);
    expect(setExprEntityModule.name).toBe("engine");
    expect(setExprEntityModule.functions?.map(fn => fn.id)).toEqual(["engine:reflectionValueType"]);
    // Exact canonical declarations, including the floor claim without its helpers.
    const publishedIds = ["FieldRef", "FieldKey", ...SET_EXPR_ENTITY_IDS, ...FLOOR_LAW_ENTITY_IDS, ...PAT_ENTITY_IDS, ...PUBLIC_RECIPE_ENTITY_IDS];
    expect(setExprEntityModule.entities?.map(({ id }) => id)).toEqual(publishedIds);
    expect(setExprEntityModule.entities?.map(({ module }) => module)).toEqual(
      publishedIds.map(() => "engine"),
    );
    expect(setExprEntityModule.entities?.every(({ typeScheme }) => typeScheme !== undefined)).toBe(true);
    expect(setExprEntityModule.entities?.map(({ typeScheme }) => typeScheme?.quantified)).toEqual(
      publishedIds.map(id => ["Pat", "RecipeClaim", "RecipeCountRange", "RecipeKindSpread", "RecipeAlternativeFood", "RecipeAlternative", "CanonicalListDomain"].includes(id)
        ? [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }]
        : []),
    );

    for (const projection of [actionResultModule, setExprEntityModule]) {
      const descriptor = Object.getOwnPropertyDescriptor(projection, "entities");
      expect(descriptor?.get, `${projection.name}.entities must not invoke an accessor`).toBeUndefined();
      expect(descriptor?.set, `${projection.name}.entities must not invoke an accessor`).toBeUndefined();
      expect(descriptor?.value).toBe(projection.entities);
    }
    expect(actionResultModule.entities?.map(({ id, module, typeScheme }) => ({
      id,
      module,
      hasScheme: typeScheme !== undefined,
    }))).toEqual([{
      id: "ActionResult",
      module: "core-action-result",
      hasScheme: true,
    }]);

    // rights R2a deleted the second policy engine, and with it the PolicyView /
    // policiesToWhere / setContainsBool pins that used to sit here. They are not
    // re-homed: a pin whose subject no longer exists is not evidence about
    // anything, and the authority module carries its own projection pins.
  });

  test("seed Pat retains its source scheme and the Lisp PMatch marker payload", () => {
    const source = loadFenelModule(PATTERN_ALGEBRA_FENEL, "engine", { bootstrapParser: "typescript" });
    const canonical = source.entities?.find(entity => entity.id === "Pat");
    const projected = modulesFor("seed").flatMap(module => module.entities ?? [])
      .filter(entity => entity.id === "Pat" && entity.module === "engine");
    expect(projected).toHaveLength(1);
    expect(projected[0]?.type).toEqual(canonical?.type);
    expect(projected[0]?.typeScheme).toEqual(canonical?.typeScheme);
    expect(projected[0]?.typeScheme?.quantified).toEqual([
      { id: "q0", sourceName: "a", kind: { $tag: "KType" } },
    ]);
    expect(setExprEntityModule.functions?.map(fn => fn.id)).toEqual(["engine:reflectionValueType"]);
    expect(setExprEntityModule.instances).toEqual([]);

    const type = projected[0]!.type;
    if (!("$variant" in type)) throw new Error("Source Pat must remain a variant declaration");
    const constructors = Object.fromEntries(type.$variant.cases.map(variant => [
      variant.name, variant.fields?.map(field => field.name) ?? [],
    ]));
    expect(constructors.PMatch).toEqual(["ws"]);
    const context: EvaluateContext = {
      natives: stdNatives,
      nativesCtx: stdNativesCtx,
      _constructors: constructors,
    };
    const lisp = loadFenelModule(LISP_TOOLS_FENEL, "ImportDemo", { bootstrapParser: "typescript" });
    const body = lisp.functions?.find(fn => fn.id === "ImportDemo:lispTokenPattern")?.body;
    if (body === undefined) throw new Error("Missing actual Lisp token pattern source body");
    const data = { tokens: [], kind: { $tag: "LispSymbolToken" } };
    const marker = { tag: "WsEnum", values: [] };
    const pattern = evaluate(body, data, context) as Record<string, unknown>;
    expect(pattern.$tag).toBe("PMatch");
    expect(constructorSemanticFieldRead(pattern, "ws", context)).toEqual({ found: true, value: marker });
    // The source names ws explicitly, preserving its wrapper even when a
    // smaller execution profile lacks Pat's constructor declaration.
    const missingOwner = evaluate(body, data, { ...context, _constructors: {} }) as Record<string, unknown>;
    expect(constructorSemanticFieldRead(missingOwner, "ws", context)).toEqual({ found: true, value: marker });
  });

  test("the actual seed reader owns public reflection payloads without engine policy bodies", () => {
    const admit = (current: ReturnType<typeof createRepositoryRegistry>, declared: TypeScheme, value: unknown, reader: EvaluateContext) => {
      const nominal = declared.nominals?.find(row => row.path.length === 0);
      const scope = nominal && (reader as EvaluateContext & {
        _typeDeclarationScope?: (identity: string) => {
          owner: string; names: Readonly<Record<string, string>>;
          aliases?: Readonly<Record<string, string>>; sourceFunction?: string;
        } | undefined;
      })._typeDeclarationScope?.(nominal.identity);
      if (!scope || scope.owner !== nominal?.identity) return Nothing;
      const checking = authoringMembershipEvaluateContext({ ...reader, _sourceFunction: scope.sourceFunction,
        _importStack: [{ names: { ...scope.names }, aliases: { ...(scope.aliases ?? {}) } }] });
      const closed = closeAuthoringMembershipType(declared, checking);
      if (closed === undefined) return Nothing;
      const observations: Array<{ $tag: "Nothing" } | { $tag: "Just"; _0: boolean }> = [];
      const plans: ValidationAdmissionObservation[] = [];
      const checked = validateValue(closed, value, null, {
        registry: current, functions: checking, coerce: false,
        strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
        observeMembership: verdict => observations.push(verdict), observeAdmission: plan => plans.push(plan),
      });
      return authoringValidationMembership(checked, observations, plans);
    };
    const source = loadFenelModule(REFLECT_FENEL, "engine", { bootstrapParser: "typescript" });
    const helper = source.functions?.find(fn => fn.id === "engine:reflectionValueType");
    const declaration = source.functionSignatureDeclarations?.find(row => row.functionId === helper?.id);
    if (helper === undefined || declaration === undefined) throw new Error("Canonical reflectionValueType source declaration is missing");
    expect(setExprEntityModule.functions?.[0]).toEqual(helper);
    expect(setExprEntityModule.functionSignatureDeclarations).toEqual([declaration]);
    expect(setExprEntityModule.imports).toContainEqual({ module: "prover", names: ["EpistemicStatus"] });
    expect(setExprEntityModule.nativeImpls).toBeUndefined();
    expect(setExprEntityModule.nativeImplsCtx).toBeUndefined();
    expect(setExprEntityModule.instances).toEqual([]);
    const registry = createRepositoryRegistry(modulesFor("seed"));
    const context = registry.evaluateContext();
    // The seed reader must resolve the published RecipeCard's complete data graph.
    const card = registry.callSiteTyping.resolveType(
      { $ref: "RecipeCard" }, moduleSourceCoordinate("RecipeFunctions"),
    );
    expect(card.ok).toBe(true);
    if (!card.ok) throw new Error(card.message);
    const fact = (evidence: unknown) => ({
      $tag: "RecipeFact", title: "This pantry",
      summary: { $tag: "NoSuccessfulPreparation" }, evidence,
    });
    for (const value of [
      [],
      [fact({ $tag: "DirectEvaluation" })],
      [fact({ $tag: "ScopeEvidence", scope: { $tag: "PantryFamily" } })],
      [fact({ $tag: "StatusEvidence", status: { $tag: "Unknown" } })],
    ]) {
      expect(admit(registry, card.type, value, context)).toEqual(Just(true));
    }
    for (const value of [
      [fact({ $tag: "ScopeEvidence", scope: { $tag: "AllFamilies" } })],
      [fact({ $tag: "ScopeEvidence" })],
      [fact({ $tag: "UnregisteredEvidence" })],
    ]) {
      expect(admit(registry, card.type, value, context)).toEqual(Just(false));
    }

    const reflection = context.getFunction?.("RecipeFunctions:recipeReflection");
    if (reflection === undefined) throw new Error("Actual public reflection source is missing");
    const scheme = registry.callSiteTyping.resolveType(reflection.returns, reflection.id);
    expect(scheme.ok).toBe(true);
    if (!scheme.ok) throw new Error(scheme.message);
    expect(scheme.type.nominals?.find(row => row.path.length === 0)?.identity).toBe('["engine","ReifyOutcome"]');
    expect(context.getFunction?.("engine:reflectionValueType")?.body).toEqual(helper?.body);
    expect(context.getFunction?.("engine:checkRecipeAnalysis")).toBeUndefined();
    expect(context.getFunction?.("engine:reflectCarrier")).toBeUndefined();
    const reflected = evaluate({ call: [reflection.id, { $ref: "RecipeFunctions:lubeFormula" }] }, {}, context);
    expect(reflected).toHaveProperty("$tag", "Reified");
    expect(admit(registry, scheme.type, reflected, context)).toEqual(Just(true));
    const unavailable = { ...context, getFunction: (id: string) => {
      const fn = context.getFunction?.(id);
      return fn?.id === helper?.id ? undefined : fn;
    } };
    expect(admit(registry, scheme.type, reflected, unavailable)).toEqual(Nothing);
    expect(context._specRegistry?.getClass("CanonicalListDomain")).toBeDefined();
    const system = createRepositoryRegistry(SYSTEM_REGISTRY_MODULES);
    const systemContext = system.evaluateContext();
    const systemScheme = system.callSiteTyping.resolveType({ $ref: "engine.ReifyOutcome" }, undefined);
    expect(systemScheme.ok).toBe(true);
    if (!systemScheme.ok) throw new Error(systemScheme.message);
    expect(systemScheme.type.nominals?.find(row => row.path.length === 0)?.identity).toBe('["engine","ReifyOutcome"]');
    expect(admit(system, systemScheme.type, reflected, systemContext)).toEqual(Just(true));
    expect(systemContext.getFunction?.("engine:reflectionValueType")?.body).toEqual(helper?.body);
    expect(systemContext.getFunction?.("engine:checkRecipeAnalysis")).toBeUndefined();
    expect(systemContext._specRegistry?.getClass("CanonicalListDomain")).toBeDefined();
  }, 300_000);

  test("qualified inference selects engine/SetExpr and system/ConversationStatus exactly", () => {
    // Strict ingestion reads both bootstrap projections as hostile inputs. This
    // would reject the former lazy accessors before any inference ran.
    const registry = createRepositoryRegistry([actionResultModule, setExprEntityModule]);
    const setExpr = registry.listIdentifiedEntities().filter(({ id }) => id === "SetExpr");
    const actionResult = registry.listIdentifiedEntities().filter(({ id }) => id === "ActionResult");
    const conversationStatus = registry.listIdentifiedEntities().filter(
      ({ id }) => id === "ConversationStatus",
    );
    expect(setExpr.map(({ module }) => module)).toEqual(["engine"]);
    expect(actionResult.map(({ module }) => module)).toEqual(["core-action-result"]);
    expect(conversationStatus.map(({ module }) => module)).toEqual(["system"]);

    const signatures = registry.listConstructorSignatures();
    const setExprConstructors = signatures.filter((signature) =>
      signature.ownerModule === "engine" && signature.ownerName === "SetExpr"
    );
    // a6262194 added the validation-only SeRigid case after this profile test
    // was introduced; constructor reflection must retain its exact owner too.
    expect(setExprConstructors).toHaveLength(15);
    expect(setExprConstructors.map(({ name }) => name).sort()).toEqual([
      "SeAll", "SeArrow", "SeComplement", "SeCtor", "SeDiff", "SeEnum",
      "SeIntersect", "SeInterval", "SeMu", "SeNone", "SePattern", "SeRef",
      "SeRigid", "SeUnion", "SeWhere",
    ]);
    expect(setExprConstructors.every(({ outcome }) => outcome.$tag === "Solved")).toBe(true);
    expect(setExprConstructors.map(({ scheme }) => scheme?.quantified)).toEqual(
      Array.from({ length: 15 }, () => []),
    );
    expect(setExprConstructors.every(
      ({ scheme }) => (scheme?.applications?.length ?? 0) === 0,
    )).toBe(true);
    const resolvePatternConstructor = exactConstructorResolver(signatures);
    for (const [qualifiedConstructor, expectedIdentity] of [
      ["engine.SeAll", '["engine","SetExpr"]'],
      ["engine.SeNone", '["engine","SetExpr"]'],
      ["engine.SeUnion", '["engine","SetExpr"]'],
      ["system.Active", '["system","ConversationStatus"]'],
      ["system.Confirming", '["system","ConversationStatus"]'],
    ] as const) {
      const argument = qualifiedConstructor.endsWith("SeUnion") ? { branches: [] } : undefined;
      const construct = argument === undefined
        ? { construct: [qualifiedConstructor] }
        : { construct: [qualifiedConstructor, argument] };
      const inferred = inferJsonLogicType(construct, { resolvePatternConstructor });
      expect(inferred.outcome.$tag, qualifiedConstructor).toBe("Solved");
      expect(
        inferred.scheme?.nominals?.some(({ identity }) => identity === expectedIdentity),
        `${qualifiedConstructor} should retain ${expectedIdentity}`,
      ).toBe(true);
    }
  }, 300_000);
});
