import { beforeAll, describe, expect, test } from "bun:test";
import type { CatalogSection } from "../../../../../../implementations/typescript/engine/src/type-catalog";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { exprNodeToLogic } from "@fenel/engine/authoring/expression";
import { evaluate, invokeCallable, type EvaluateContext } from "@fenel/engine/expressions";
import type { TypeScheme } from "@fenel/engine/types";
import { buildSessionCatalog, environmentForCatalog } from "../expression-runner/authoring-catalog";
import { adaptTransferToTarget, typeForTransfer } from "./expressions";
import { ingestTransfer } from "./index";
import type { TransferItem } from "./types";

// C1: the same actual source profile and captured catalogue as browser Call,
// plus actual browser File ingestion. No replacement File type or judgment.
const seedDescribe = process.env.FENEL_FILE_SEED_CHECK === "1" ? describe : describe.skip;
seedDescribe("File transfer into captured source-owned targets", () => {
  let registry: ModuleRegistry;
  let changedRegistry: ModuleRegistry;
  let context: EvaluateContext;
  let environment: AuthoringEnvironment;
  let expected: TypeScheme;
  let defaults: Array<{ function: { $ref: string }; arguments: Array<Record<string, unknown>> }>;

  beforeAll(async () => {
    const [{ modulesFor }, { createRepositoryRegistry }, { mintAnonymousAuthority }] = await Promise.all([
      import("@fenel/engine/module-manifest"), import("@fenel/engine/repository-registry"),
      import("../../../../../../implementations/typescript/runtime/src/authority-mint"),
    ]);
    const modules = modulesFor("seed");
    registry = createRepositoryRegistry(modules);
    context = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
    const sections: CatalogSection[] = [{ id: "function", label: "Captured functions", description: "", entries: registry.listFunctions()
      .map(fn => ({ id: fn.id, name: fn.id, description: "", category: "function", fn })) },
      { id: "entity", label: "Captured types", description: "", entries: registry.listIdentifiedEntities()
        .map(entity => ({ id: entity.id, name: entity.id, description: "", category: "entity", entity: { id: entity.id, type: entity.type } })) }];
    environment = environmentForCatalog(buildSessionCatalog(registry, "ImportDemo", { sections }), registry);
    const provider = registry.getFunction("ImportDemo.fileDemoStartingInputs")!;
    defaults = invokeCallable({ $ref: registry.getUuid(provider.id)! }, [], context) as typeof defaults;
    const entry = environment.getFunctionEntry?.(defaults[0]!.function.$ref)!;
    expected = projectAuthoringScheme(entry.scheme!, ["$arrow", "params", "0", "type"])!;
    expect(expected.nominals?.some(owner => owner.identity === '["std","File"]')).toBe(true);
    const std = modules.find(module => module.name === "std")!;
    const telegram = modules.find(module => module.name === "telegram")!;
    // A new snapshot containing the actual Telegram owner but no std.File
    // declaration. Retain source declarations and physical identities; no clone.
    changedRegistry = createRepositoryRegistry([
      { ...std, entities: std.entities?.filter(entity => entity.id !== "File") }, telegram,
    ]);
  }, 180_000);

  const adapt = (items: TransferItem[], scheme = expected, activeRegistry = registry) => adaptTransferToTarget(items, {
    expectedScheme: scheme, typeName: "File", currentValue: defaults[0]!.arguments[0],
    environment, registry: activeRegistry, evaluateContext: context, mode: "replace",
  });
  const fileItem = (value: unknown): TransferItem => ({ value, typeName: "File", source: "file" });

  test("flat source-owned File defaults retain exact data through transfer adaptation", () => {
    for (const recipe of defaults) {
      const entry = environment.getFunctionEntry?.(recipe.function.$ref)!;
      const wanted = projectAuthoringScheme(entry.scheme!, ["$arrow", "params", "0", "type"])!;
      const value = recipe.arguments[0]!;
      const result = adapt([fileItem(value)], wanted);
      expect(result.value).toBe(value);
      expect(evaluate(exprNodeToLogic(result.expr), {}, context)).toEqual(value);
      expect((invokeCallable(recipe.function, [result.value], context) as { $tag: string }).$tag).toBe("Ok");
    }
  }, 60_000);

  test("an actually selected UTF-8 browser File fits the captured root and feeds the existing CSV parser", async () => {
    const source = "name,code\n🦊,001";
    const items = await ingestTransfer({ files: [new File([source], "selected.csv", { type: "text/csv" })],
      text: "", html: "", uriList: "", internal: "" });
    expect(items).toHaveLength(1);
    expect(items[0]!.typeName).toBe("File");
    expect(typeForTransfer(items[0]!, environment, { registry, evaluateContext: context }))
      .toEqual({ $ref: registry.getTypeUuid("std", "File")! });
    const original = structuredClone(items[0]!.value);
    const result = adapt(items);
    expect(result.value).toEqual(original);
    expect(evaluate(exprNodeToLogic(result.expr), {}, context)).toEqual(original);
    const fn = registry.getFunction("ImportDemo.fileCsv")!;
    const parsed: any = invokeCallable({ $ref: registry.getUuid(fn.id)! }, [result.value], context);
    expect(parsed.$tag).toBe("Ok");
    expect(parsed._0.text).toBe(source);
    expect(parsed._0.inspection.table.rows).toEqual([["🦊", "001"]]);
  }, 60_000);

  test("malformed metadata, foreign/missing owners and a changed snapshot keep the current value", () => {
    const current = structuredClone(defaults[0]!.arguments[0]);
    const value = defaults[0]!.arguments[0]!;
    for (const invalid of [{ ...value, name: 5 }, { ...value, hash: 5 }, { ...value, size: -1 }]) {
      expect(() => adapt([fileItem(invalid)])).toThrow();
    }
    const withOwner = (identity: string): TypeScheme => ({ ...expected,
      nominals: expected.nominals?.map(owner => ({ ...owner, identity })),
    });
    expect(() => adapt([fileItem(value)], withOwner('["telegram","File"]'))).toThrow();
    expect(() => adapt([fileItem(value)], withOwner('["UnavailableOwner","File"]'))).toThrow();
    expect(() => adapt([fileItem(value)], expected, changedRegistry)).toThrow();
    expect(() => adapt([{ ...fileItem(value), typeCandidate: {
      type: expected.body, identities: [{ path: "", reference: "File", identity: '["UnavailableOwner","File"]' }],
    } }])).toThrow();
    expect(defaults[0]!.arguments[0]).toEqual(current);
  }, 60_000);
});
