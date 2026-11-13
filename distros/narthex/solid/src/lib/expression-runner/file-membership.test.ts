import { beforeAll, describe, expect, test } from "bun:test";
import type { CatalogSection } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { invokeCallable, type EvaluateContext } from "@fenel/engine/expressions";
import { projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { buildSessionCatalog, environmentForCatalog } from "./authoring-catalog";
import { draftSaveIssue } from "./creation-validation";
import { literalMembershipFor } from "./literal-membership";

// C1: the actual seed profile and shared browser catalogue/gate, with no
// replacement owner, renderer or membership algorithm. Keep browser imports
// in the Solid test project so engine checking does not acquire UI aliases.
const seedDescribe = process.env.FENEL_FILE_SEED_CHECK === "1" ? describe : describe.skip;
seedDescribe("File slots and calls in the captured browser catalogue", () => {
  let registry: ModuleRegistry;
  let context: EvaluateContext;
  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { mintAnonymousAuthority }] = await Promise.all([
      import("@fenel/engine/module-manifest"), import("@fenel/engine/repository-registry"),
      import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
    ]);
    registry = createRepositoryRegistry(modulesFor("seed"));
    context = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
  }, 180_000);

  test("captured File schemes admit ordinary metadata and preserve other-owner and malformed-data refusals", () => {
    const sections: CatalogSection[] = [{ id: "function", label: "Captured functions", description: "", entries: registry.listFunctions()
      .map(fn => ({ id: fn.id, name: fn.id, description: "", category: "function", fn })) },
      { id: "entity", label: "Captured types", description: "", entries: registry.listIdentifiedEntities()
        .map(entity => ({ id: entity.id, name: entity.id, description: "", category: "entity", entity: { id: entity.id, type: entity.type } })) }];
    const environment = environmentForCatalog(buildSessionCatalog(registry, "ImportDemo", { sections }), registry);
    const judge = literalMembershipFor(environment, { registry, evaluateContext: context });
    const provider = registry.getFunction("ImportDemo.fileDemoStartingInputs")!;
    const providerIdentity = registry.getUuid(provider.id)!;
    expect(registry.getFunction(providerIdentity)?.id).toBe(provider.id);
    const recipes = invokeCallable({ $ref: providerIdentity }, [], context) as Array<{
      function: { $ref: string }; arguments: Array<Record<string, unknown>>;
    }>;
    expect(recipes).toHaveLength(3);
    for (const recipe of recipes) {
      const entry = environment.getFunctionEntry?.(recipe.function.$ref)!;
      expect(entry.signatureOutcome?.$tag).toBe("Solved");
      const expected = projectAuthoringScheme(entry.scheme!, ["$arrow", "params", "0", "type"])!;
      const literal = { kind: "literal" as const, value: recipe.arguments[0]! };
      const call = { kind: "call" as const, fnId: recipe.function.$ref, args: [literal] };
      expect(judge(literal.value, expected)).toEqual(Just(true));
      expect(draftSaveIssue(literal, environment, { expectedScheme: expected, registry, evaluateContext: context })).toBeUndefined();
      expect(draftSaveIssue(call, environment, { registry, evaluateContext: context })).toBeUndefined();
      for (const value of [{ ...literal.value, size: -1 }, { ...literal.value, hash: 5 }, { ...literal.value, name: 5 }]) {
        expect(judge(value, expected)).toEqual(Just(false));
        expect(draftSaveIssue({ ...call, args: [{ kind: "literal", value }] }, environment, { registry, evaluateContext: context })).toBeDefined();
      }
      const unavailable = { ...expected, nominals: expected.nominals?.map(owner => ({ ...owner, identity: '["UnavailableOwner","File"]' })) };
      expect(judge(literal.value, unavailable)).toEqual(Nothing);
      const telegram = { ...expected, nominals: expected.nominals?.map(owner => ({ ...owner, identity: '["telegram","File"]' })) };
      expect(judge(literal.value, telegram)).toEqual(Just(false));
    }
  }, 120_000);
});
