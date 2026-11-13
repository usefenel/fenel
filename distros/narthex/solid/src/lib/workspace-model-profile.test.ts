import { beforeAll, describe, expect, test } from "bun:test";
import { createRepositoryRegistryAsync } from "@fenel/engine/repository-registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { invokeCallable, resolveImportedName, type EvaluateContext } from "@fenel/engine/expressions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FieldOwner } from "@fenel/engine/field-identity";
import { collectCalledFunctions, DYN_CALLEE } from "../../../../../implementations/typescript/engine/src/constraint-inference";
import { PROJECTED_WORKSPACE_MODULES } from "./workspace-model-modules";
import { evaluateContextForCatalog } from "./expression-runner/authoring-catalog";
import { mintAnonymousAuthority } from "../../../../../implementations/typescript/runtime/src/authority-mint";
import { frameAccount } from "@fenel/engine/authority";

const modelDependencies = modulesFor("seed").filter(module => ["std", "picture", "view", "engine"].includes(module.name));
const dependencyFunctions = new Set(modelDependencies.flatMap(module => (module.functions ?? []).map(fn => fn.id)));
const modelFieldOwner = (owner: FieldOwner): boolean => {
  if (owner.$tag === "InlineNominalFieldOwner") return modelFieldOwner(owner.parent);
  if (owner.$tag === "FunctionFieldOwner") return dependencyFunctions.has(owner.id);
  const moduleName = owner.module.$tag === "Just" ? owner.module._0 : undefined;
  return modelDependencies.some(module => module.name === moduleName
    && (module.entities ?? []).some(entity => entity.id === owner.localId));
};
const neutral = (registry: ModuleRegistry): EvaluateContext => ({ ...evaluateContextForCatalog(registry),
  _authority: mintAnonymousAuthority(registry), _dictStack: [], _activeTags: [], _importStack: [] });
const call = (registry: ModuleRegistry, name: string, ...args: unknown[]) => {
  const fn = registry.getFunction(`view.${name}`)!;
  return invokeCallable({ $ref: registry.getUuid(fn.id)! }, args, neutral(registry));
};

describe("isolated workspace model repository profile", () => {
  let seed: ModuleRegistry, system: ModuleRegistry;
  beforeAll(async () => {
    for (const [name, modules] of [["seed", modulesFor("seed")], ["intersection", PROJECTED_WORKSPACE_MODULES]] as const) {
      const started = performance.now();
      console.log(`GP33 profile ${name} started (${modules.length} modules)`);
      const registry = await createRepositoryRegistryAsync([...modules], { dispatchRegistry });
      console.log(`GP33 profile ${name} checked in ${Math.round(performance.now() - started)}ms (${registry.listFunctions().length} functions)`);
      if (name === "seed") seed = registry;
      else system = registry;
    }
  }, 900_000);

  test("every workspace helper and its actual checked transitive callees keeps identities, signatures, routing and lexical scope", () => {
    const pending = seed.modules.find(module => module.name === "view")!.functions!.filter(fn => /workspace/i.test(fn.id)).map(fn => fn.id);
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const original = seed.getFunction(id)!;
      for (const profile of [system]) {
        expect(profile.getFunction(id)).toEqual(original);
        expect(profile.getUuid(id)).toBe(seed.getUuid(id));
        expect(profile.getFunctionScheme(id)).toEqual(seed.getFunctionScheme(id));
        expect(profile.getFunctionSignatureInfo(id)).toEqual(seed.getFunctionSignatureInfo(id));
        expect(profile.evaluateContext().getFunctionImportFrame?.(id)).toEqual(seed.evaluateContext().getFunctionImportFrame?.(id));
      }
      const names = new Set<string>();
      collectCalledFunctions(original.body, names, true);
      const lexical = seed.evaluateContext().getFunctionImportFrame?.(id);
      const context = { ...seed.evaluateContext(), _importStack: lexical ? [lexical] : [] };
      for (const name of names) {
        if (name === DYN_CALLEE) continue;
        const target = resolveImportedName(context, name) ?? name;
        const fn = seed.getFunction(target);
        if (!fn) continue; // The existing marshaller also emits ordinary local data variables.
        pending.push(fn.id);
        for (const profile of [system]) {
          expect(profile.getFunction(target)?.id, `${id} resolves ${name}`).toBe(fn.id);
          expect(profile.evaluateContext()._resolveBareName?.(target)).toEqual(seed.evaluateContext()._resolveBareName?.(target));
        }
      }
    }
    console.log(`GP33 checked workspace call closure contains ${seen.size} functions`);
  });

  test("all selected type constructors and field identities are identical repository projections", () => {
    for (const profile of [system]) {
      for (const entity of seed.listIdentifiedEntities().filter(entry => modelDependencies.some(module =>
        (module.entities ?? []).some(input => input.id === entry.id && module.name === entry.module)))) {
        expect(profile.listIdentifiedEntities().find(entry => entry.id === entity.id && entry.module === entity.module))
          .toEqual(seed.listIdentifiedEntities().find(entry => entry.id === entity.id && entry.module === entity.module));
      }
      for (const field of seed.listFieldIdentities().filter(entry => modelFieldOwner(entry.owner))) {
        const current = profile.getFieldIdentity(field.owner, field.path)!;
        expect(current).toBeDefined();
        const { token: originalToken, ...original } = field;
        const { token: selectedToken, ...selected } = current;
        expect(selected).toEqual(original);
      }
      for (const entry of seed.listConstructorSignatures().filter(candidate =>
        modelDependencies.some(module => module.name === candidate.ownerModule))) {
        expect(profile.listConstructorSignatures().find(candidate => candidate.targetId === entry.targetId)).toEqual(entry);
      }
    }
  });

  test("defaults, validation, commands, presentation, active lenses and tiling retain outputs in an anonymous frame", () => {
    const defaults = call(seed, "workspaceDefaultForAccount", "l1", { $tag: "Just", _0: "account" }) as { lenses: unknown[]; display: unknown };
    const layered = { ...defaults, lenses: [defaults.lenses[0],
      { ...(defaults.lenses[0] as object), id: "second" }, { ...(defaults.lenses[0] as object), id: "third" }],
      activeLensId: "second", display: { $tag: "GroupedLenses", activeGroupId: "main",
        groups: [{ $tag: "LensGroup", id: "main", layers: [["l1"], ["second"]], merged: true }] } };
    const cases: Array<[string, unknown[]]> = [
      ["workspaceDefaultForAccount", ["l1", { $tag: "Just", _0: "account" }]],
      ["validateWorkspacePreferences", [defaults]], ["workspacePreferencesFromValue", [defaults]],
      ["workspaceReadPreferences", [defaults]], ["workspaceVisibleLenses", [defaults]],
      ["workspaceActiveLens", [defaults]], ["workspaceTilePlan", [defaults, 1024]],
      ["workspacePresentationCode", [{ $tag: "TablePresentation" }]],
      ["workspacePresentationFromCode", ["table"]],
      ["applyWorkspaceCommands", [defaults, [{ $tag: "SetWorkspaceDisplay", display: { $tag: "TiledLenses" } }]]],
      ["applyWorkspaceCommands", [defaults, [{ $tag: "AddLensGroup", id: "second" }, { $tag: "SelectLensGroup", id: "second" }]]],
      ["applyWorkspaceCommands", [layered, [{ $tag: "SplitWorkspaceLens", id: "third" }]]],
      ["applyWorkspaceCommands", [layered, [{ $tag: "SetCurrentLensLayer", ids: ["third"] }]]],
      ["workspacePathEqual", [[{ $tag: "FieldStep", name: "price" }, { $tag: "IndexStep", index: 0 }], [{ $tag: "FieldStep", name: "price" }, { $tag: "IndexStep", index: 0 }]]],
      ["workspacePathEqual", [[{ $tag: "FieldStep", name: "0" }], [{ $tag: "IndexStep", index: 0 }]]],
      ["validateWorkspacePreferences", [{ ...defaults, activeLensId: "missing" }]],
    ];
    for (const [name, args] of cases) for (const profile of [system]) {
      expect(call(profile, name, ...args)).toEqual(call(seed, name, ...args));
    }
    const changed = call(system, "applyWorkspaceCommands", defaults,
      [{ $tag: "SetWorkspaceDisplay", display: { $tag: "TiledLenses" } }]) as { $tag: string; _0: { display: unknown } };
    expect(changed.$tag).toBe("Ok");
    expect(changed._0.display).toEqual({ $tag: "TiledLenses" });
    for (const [command, layers] of [[{ $tag: "SplitWorkspaceLens", id: "third" }, [["l1"], ["second", "third"]]],
      [{ $tag: "SetCurrentLensLayer", ids: ["third"] }, [["l1"], ["third"]]]] as const) {
      const result = call(system, "applyWorkspaceCommands", layered, [command]) as {
        $tag: string; _0: { display: { groups: Array<{ layers: unknown }> } } };
      expect(result.$tag).toBe("Ok");
      expect(result._0.display.groups[0]!.layers).toEqual(layers);
    }
    expect(call(system, "workspacePathEqual", [{ $tag: "FieldStep", name: "0" }], [{ $tag: "IndexStep", index: 0 }])).toBe(false);
    expect(system.getFunction("state.loadType")).toBeUndefined();
  });

  test("the isolated model holds no authenticated account and refuses an actual protected system native", () => {
    const context = neutral(system);
    expect(frameAccount(context)).toBeNull();
    expect(() => invokeCallable({ $ref: system.getUuid("time:now")! }, [], context)).toThrow("authority refused");
  });
});
