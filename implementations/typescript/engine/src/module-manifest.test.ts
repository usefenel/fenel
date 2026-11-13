// registry-unification Phase 1 — the anti-drift guard.
//
// Before the manifest, the seed list (A) and the durable-execute list (B) were
// hand-maintained separately and drifted — `dashboard` was in B but not A, so
// `seedSystemFunctions` never wrote its fns and every `dashboard:*` call threw
// "Function not found" (prod-down 2026-07-05, fixed by `ec3c46be`). This test
// FAILS if that drift class ever recurs. See `module-manifest.ts` header +
// `workstreams/registry-unification/notes/phase-0-module-role-matrix.md`.

import { describe, expect, it } from "bun:test";
import { MODULE_MANIFEST, modulesFor, type ManifestEntry, type ModuleRole } from "./module-manifest";
import { PUBLIC_DEMO_MODULES } from "./modules/public-demos";
import { dispatchRegistry } from "./system-entities";
import { GLOBAL_ONLY } from "./dispatch-registry";

/** List B (durable execute) order, captured from `runtime/evaluator.ts`
 *  `loadRegistry` at the phase-1 landing (excluding the runtime-only
 *  `representationBridgeModule` native shim, which is not a manifest module).
 *  ORDER matters — `createRegistry`'s codeName map is LAST-WINS. */
const EXPECTED_EXECUTE_ORDER = [
  "std", "control", "io", "time", "email", "ecom", "twitter", "social", "license",
  "templates", "ai", "telegram", "notion", "state", "storage", "crypto", "dispatch", "codec",
  "emailWebhooks", "notify", "dashboard", "webhooks", "subscriptions", "proxyLinks",
  "pages", "receipt", "inventory", "purchases", "payments", "profiles", "imports",
  "items", "types", "plans", "entitlements", "channels", "action-result", "auth",
  // `permissions` was HERE until rights R2a (`7956cf89`) deleted the module with the
  // second policy engine, the `permission_policies` table and the `System` subject.
  // `module-manifest.ts` lost the entry in that commit; this captured list did not,
  // so both assertions have been RED since 2026-09-11 and no remote run saw it.
  // Removed 2026-09-18 as an intentional deletion rather than the drift this test
  // guards: the module directory is gone, and `module-manifest.ts:174` records the
  // retirement next to the dependency it left behind.
  // modules-as-values (2026-09-24) renamed three containers to identifiers:
  // `decidable-membership` → `set`, `compile-js` → `compileJs`,
  // `evaluator-strategies` → `evaluatorStrategies` (function ids unchanged).
  "set", "prover", "compileJs",
  "evaluatorStrategies", "query",
  // GP-13: append the existing pure-media seed order without reordering the
  // original execute prefix. Authoring and runtime receive the same definitions.
  "picture", "sound", "animation", "movie", "track", "events", "games",
  "crossmodal", "path", "view",
  "SolverDemo", "ImageDemo", "CheckDemo", "LocaleDemo", "DrawingDemo",
  "StatisticsDemo", "ImportDemo", "AnimationDemo", "RecipeDemo",
  "EncyclopediaDemo", "DocumentDemo", "GreekAlphabetDemo", "ClaimsDemo", "AxiomsDemo", "PasswordRecordDemo", "UtilityDemo", "ShowcaseDemo", "RasterMigration", "locale", "units",
];

/** List A (seed + catalog) set, captured from `type-catalog.ts` `ALL_MODULES` at
 *  the phase-1 landing. Order is NON-semantic (id-keyed dedup + upsert) → asserted
 *  as a SET. */
const EXPECTED_SEED_SET = new Set([
  ...EXPECTED_EXECUTE_ORDER,
  "picture", "sound", "animation", "movie", "track", "events", "games",
  "crossmodal", "path", "view", "engine",
]);

const names = (ms: { name?: string }[]) => ms.map((m) => m.name);

describe("module-manifest", () => {
  it("public utility source annotations are enrolled in the existing presentation pool", () => {
    // GLOBAL_ONLY: this boot-registration test observes repository annotations,
    // without an account or a runtime operation.
    for (const [member, label] of [["textTools", "Text tools"], ["numberTools", "Number and duration tools"], ["unitTools", "Unit tools"], ["dateTools", "Date tools"]]) {
      expect(dispatchRegistry.resolve(`UtilityDemo:${member}`, "Labelable", GLOBAL_ONLY)?.label).toBe(label);
      expect(dispatchRegistry.resolve(`UtilityDemo:${member}`, "Describable", GLOBAL_ONLY)?.description)
        .toEqual(expect.any(String));
    }
  });

  it("modulesFor('execute') preserves the execute prefix, media and public-demo append order", () => {
    expect(names(modulesFor("execute"))).toEqual(EXPECTED_EXECUTE_ORDER);
  });

  it("keeps legacy polymorphic sample/render names single-bound and picture source members stable", () => {
    const execute = modulesFor("execute");
    const targets = (codeName: string) => [...new Set(execute.flatMap((module) =>
      (module.instances ?? []).filter((instance) => instance.typeName === "Codeable"
        && instance.methods.codeName === codeName).map((instance) => instance.args[0]),
    ))];
    // Two bindings hard-error before the direct native path: these classes
    // currently declare return-position methods, so bare collision dispatch
    // cannot choose the picture implementation.
    expect(targets("sample")).toEqual(["dispatch:sample"]);
    expect(targets("render")).toEqual(["dispatch:render"]);
    expect(targets("pictureSample")).toEqual(["picture:sample"]);
    expect(targets("pictureRender")).toEqual(["picture:render"]);
    const picture = execute.find((module) => module.name === "picture")!;
    expect(picture.functionSignatureDeclarations?.find((declaration) => declaration.functionId === "picture:sample"))
      .toMatchObject({ declarationName: "sample", codeName: "pictureSample" });
    expect(picture.functionSignatureDeclarations?.find((declaration) => declaration.functionId === "picture:render"))
      .toMatchObject({ declarationName: "render", codeName: "pictureRender" });
  });

  it("public demos add no module, function, type or Codeable name collisions", () => {
    const execute = modulesFor("execute");
    const existing = execute.filter((module) => !PUBLIC_DEMO_MODULES.includes(module));
    const moduleNames = new Set(existing.map((module) => module.name));
    const functionIds = new Set(existing.flatMap((module) => (module.functions ?? []).map((fn) => fn.id)));
    const entityIds = new Set(modulesFor("seed").filter((module) => !PUBLIC_DEMO_MODULES.includes(module))
      .flatMap((module) => (module.entities ?? []).map((entity) => entity.id)));
    const codeNames = new Set(existing.flatMap((module) => (module.instances ?? [])
      .filter((instance) => instance.typeName === "Codeable")
      .map((instance) => instance.methods.codeName)));

    for (const module of PUBLIC_DEMO_MODULES) {
      expect(moduleNames.has(module.name)).toBe(false);
      moduleNames.add(module.name);
      for (const fn of module.functions ?? []) {
        expect(functionIds.has(fn.id)).toBe(false);
        functionIds.add(fn.id);
      }
      for (const entity of module.entities ?? []) {
        expect(entityIds.has(entity.id)).toBe(false);
        entityIds.add(entity.id);
      }
      for (const instance of module.instances ?? []) {
        if (instance.typeName !== "Codeable") continue;
        expect(codeNames.has(instance.methods.codeName)).toBe(false);
        codeNames.add(instance.methods.codeName);
      }
    }

    const targets = (codeName: string) => execute.flatMap((module) => (module.instances ?? [])
      .filter((instance) => instance.typeName === "Codeable" && instance.methods.codeName === codeName)
      .map((instance) => instance.args[0]));
    expect(targets("bound")).toEqual(["sound:bound"]);
    expect(targets("solverDemoBound")).toEqual(["SolverDemo:solverDemoBound"]);
  });

  it("modulesFor('seed') is the same SET as list A (order non-semantic)", () => {
    const seed = names(modulesFor("seed"));
    expect(new Set(seed)).toEqual(EXPECTED_SEED_SET);
    // no duplicates — a dup would break the id-keyed dedup assumption.
    expect(seed.length).toBe(EXPECTED_SEED_SET.size);
  });

  it("no module appears twice in the manifest", () => {
    const seen = new Set<unknown>();
    for (const e of MODULE_MANIFEST) {
      expect(seen.has(e.module)).toBe(false);
      seen.add(e.module);
    }
  });

  // THE INVARIANT: every durably-executable module is seeded, so
  // `seedSystemFunctions` covers everything a seeded body can reach via
  // `callUserFunction`. (Sole sanctioned gap: the 6 engine representation fns,
  // covered by the runtime `representationBridgeModule` native shim.)
  it("seed invariant: modulesFor('execute') ⊆ modulesFor('seed')", () => {
    const missing = checkSeedInvariant(MODULE_MANIFEST);
    expect(missing).toEqual([]);
  });

  // RED-test proof: reproduce the ORIGINAL bug shape (dashboard executable but
  // NOT seeded) and confirm the invariant checker catches it.
  it("the invariant checker catches an execute-but-not-seeded module (the ec3c46be bug)", () => {
    const broken: ManifestEntry[] = MODULE_MANIFEST.map((e) =>
      e.module.name === "dashboard"
        ? { module: e.module, roles: ["execute"] as ModuleRole[] } // drop "seed"
        : e,
    );
    expect(checkSeedInvariant(broken)).toEqual(["dashboard"]);
  });
});

/** Returns the names of modules tagged `execute` but not `seed` (the drift the
 *  guard forbids). Exported shape mirrors what a CI script would report. */
function checkSeedInvariant(manifest: ManifestEntry[]): string[] {
  const seed = new Set(
    manifest.filter((e) => e.roles.includes("seed")).map((e) => e.module),
  );
  return manifest
    .filter((e) => e.roles.includes("execute") && !seed.has(e.module))
    .map((e) => e.module.name ?? "<anon>");
}
