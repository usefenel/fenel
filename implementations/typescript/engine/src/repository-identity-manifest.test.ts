import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { loadLock, resetLockCache } from "./codename-lock";
import {
  REPOSITORY_IDENTITY_MANIFEST,
  repositoryIdentityKinds,
  repositoryIdentityLock,
} from "./repository-identity-manifest";
import {
  repositoryIdentityEntityProfiles,
  repositoryIdentityProfiles,
} from "./repository-identity-modules";
import { createRepositoryRegistry } from "./repository-registry";
import { stdModule } from "./modules/std";

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe("generated repository identity manifest", () => {
  test("is sorted, unique, digest-pinned, and exactly equals the physical union", () => {
    resetLockCache();
    const physical = loadLock();
    const rows = REPOSITORY_IDENTITY_MANIFEST.entries;
    expect(REPOSITORY_IDENTITY_MANIFEST.schemaVersion).toBe(1);
    expect(rows).toHaveLength(REPOSITORY_IDENTITY_MANIFEST.physicalCount);
    expect(rows.map(([name]) => name)).toEqual(
      rows.map(([name]) => name).sort(ordinal),
    );
    expect(new Set(rows.map(([name]) => name)).size).toBe(rows.length);
    expect(new Map(rows.map(([name, id]) => [name, id]))).toEqual(physical);

    const projection = rows.map(([name, id]) => [name, id]);
    const digest = createHash("sha256")
      .update(JSON.stringify(projection), "utf8")
      .digest("hex");
    expect(digest).toBe(REPOSITORY_IDENTITY_MANIFEST.digest);
    expect(REPOSITORY_IDENTITY_MANIFEST.requiredCount).toBeLessThanOrEqual(rows.length);
  });

  test("returns fresh indexes and retains tombstone UUID reservations", () => {
    const first = repositoryIdentityLock();
    const second = repositoryIdentityLock();
    expect(first).not.toBe(second);
    const sentinel = "test:sentinel";
    first.set(sentinel, "30000000-0000-4000-8000-000000000001");
    expect(second.has(sentinel)).toBe(false);

    const reserved = REPOSITORY_IDENTITY_MANIFEST.entries.find(([, , kind]) =>
      kind === "reserved"
    );
    expect(reserved).toBeDefined();
    if (reserved !== undefined) {
      expect(repositoryIdentityKinds().get(reserved[1])).toBe("reserved");
    }
  });

  test("profile union is explicit and self-host projections keep functions and entities separate", () => {
    const entityProfiles = repositoryIdentityEntityProfiles();
    expect(entityProfiles.map((profile) => profile.id)).toEqual([
      "system",
      "seed-product",
      "engine-identity-types",
      "self-host-functions",
      "self-host-engine-types",
    ]);
    // Measured after View joined system, storage joined seed/execute, and the
    // storage declarations joined system. Both product profiles also retain
    // the directive-only repository-field-facets module.
    // `permissions` left the system roster at rights R2a (`7956cf89`). The
    // public demo modules (SolverDemo, ImageDemo, CheckDemo, LocaleDemo,
    // DrawingDemo, StatisticsDemo, AnimationDemo, ImportDemo, RecipeDemo)
    // and `locale` joined seed-product since.
    expect(entityProfiles.map((profile) => profile.modules.length)).toEqual([36, 76, 1, 0, 5]);
    expect(entityProfiles[4]?.modules.map((module) => module.name)).toEqual([
      "engine",
      "locale",
      "path",
      "dispatch",
      "runtime",
    ]);
    expect(entityProfiles.some((profile) => profile.compilerSemanticModules !== undefined)).toBe(false);

    const profiles = repositoryIdentityProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual([
      "system",
      "seed-product",
      "engine-identity-types",
      "self-host-functions",
      "self-host-engine-types",
    ]);
    expect(profiles.map((profile) => profile.signatureJudgment)).toEqual([
      "authoritative",
      "authoritative",
      "identity-only",
      "identity-only",
      "identity-only",
    ]);
    expect(profiles.map((profile) => profile.compilerSemanticModules !== undefined)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    // The source-only repository field-facet module is an explicit member of
    // both product profiles. Keep these counts pinned so it cannot disappear
    // from only one generation path.
    expect(profiles[0]?.modules).toHaveLength(36);
    expect(profiles[1]?.modules).toHaveLength(76);
    expect(profiles[2]?.modules.flatMap((module) => module.functions ?? [])).toHaveLength(0);
    expect(profiles[2]?.modules.flatMap((module) => module.entities ?? []).length)
      .toBeGreaterThanOrEqual(20);
    expect(profiles[3]?.modules).toHaveLength(6);
    expect(profiles[3]?.modules.flatMap((module) => module.entities ?? [])).toHaveLength(0);
    expect(profiles[3]?.modules.flatMap((module) => module.functions ?? []))
      .toContainEqual(expect.objectContaining({ id: "engine:parseEffectFnId" }));
    expect(profiles[3]?.modules.flatMap((module) => module.functions ?? []))
      .toContainEqual(expect.objectContaining({ id: "formats:handleInstance" }));
    expect(profiles[3]?.compilerSemanticModules?.some(module => module.name === "formats")).toBe(true);
    expect(profiles[4]?.modules.map((module) => module.name)).toEqual([
      "engine",
      "locale",
      "path",
      "dispatch",
      "runtime",
    ]);
    expect(profiles[4]?.modules.flatMap((module) => module.functions ?? [])).toHaveLength(0);
    const selfHostEntityIds = profiles[4]?.modules
      .flatMap((module) => module.entities ?? [])
      .map((entity) => entity.id) ?? [];
    expect(selfHostEntityIds).toEqual(expect.arrayContaining([
      "JsonLogic",
      "CeExpr",
      "CurvePath",
      "LookupResult",
      "TmFilter",
    ]));
  });

  // Both two-registry isolation cases use the real-roster cold-start budget,
  // including when a filtered run has not warmed the engine first.
  test("warm repository construction reuses semantics but returns fresh local field data", () => {
    const first = createRepositoryRegistry([stdModule]);
    const second = createRepositoryRegistry([stdModule]);
    const firstFields = first.listFieldIdentities();
    const secondFields = second.listFieldIdentities();
    expect(firstFields).not.toBe(secondFields);
    expect(firstFields).not.toHaveLength(0);
    expect(secondFields.map((field) => field.qualifiedName)).toEqual(
      firstFields.map((field) => field.qualifiedName),
    );
    expect(secondFields.map((field) => field.ownerLookupKey)).toEqual(
      firstFields.map((field) => field.ownerLookupKey),
    );

    const named = firstFields.find((field) => field.field.key.$tag === "NamedField");
    expect(named).toBeDefined();
    if (named?.field.key.$tag === "NamedField") {
      const secondIdentity = second.getFieldIdentityByHandle(named.field.key.ref.$ref);
      expect(secondIdentity?.qualifiedName).toBe(named.qualifiedName);
      expect(secondIdentity).not.toBe(named);
    }

    const firstFacet = first.listFieldRepresentations("Codeable")[0];
    expect(firstFacet).toBeDefined();
    if (firstFacet !== undefined && typeof firstFacet.args[0] === "string") {
      const secondFacet = second.getFieldRepresentation(
        "Codeable",
        firstFacet.args[0],
        "repository",
      );
      expect(secondFacet).toBeDefined();
      expect(secondFacet).not.toBe(firstFacet);
      expect(secondFacet?.args).not.toBe(firstFacet.args);
      expect(secondFacet?.methods).not.toBe(firstFacet.methods);
      const expectedCodeName = secondFacet?.methods.codeName;
      firstFacet.methods.codeName = "mutated-local-field-facet";
      expect(secondFacet?.methods.codeName).toEqual(expectedCodeName);
    }
  }, 300_000);

  test("warm owner/code-name indexing consumes the Fenel projection without per-occurrence redispatch", async () => {
    const source = await Bun.file(new URL("./registry.ts", import.meta.url)).text();
    expect(source).toContain("`${identity.ownerLookupKey}\\u0000${identity.field.name}`");
    expect(source).not.toContain("qualifiedFieldName(identity.owner, [])");
  });

  test("nested memo DTOs cannot leak mutations into a later registry", () => {
    const first = createRepositoryRegistry([stdModule]);
    const identity = first.listFieldIdentities().find((item) =>
      item.field.key.$tag === "NamedField" &&
      item.owner.$tag === "TypeFieldOwner" &&
      item.path[0]?.$tag === "FieldNamed"
    );
    expect(identity).toBeDefined();
    if (
      identity?.field.key.$tag !== "NamedField" ||
      identity.owner.$tag !== "TypeFieldOwner" ||
      identity.path[0]?.$tag !== "FieldNamed"
    ) return;

    const qualifiedName = identity.qualifiedName;
    const expectedRef = identity.field.key.ref.$ref;
    const expectedLocalId = identity.owner.localId;
    const expectedPathName = identity.path[0].name;
    (identity.field.key.ref as { $ref: string }).$ref = "mutated-field-ref";
    (identity.owner as { localId: string }).localId = "MutatedOwner";
    (identity.path[0] as { name: string }).name = "mutated-path";

    const later = createRepositoryRegistry([stdModule])
      .listFieldIdentities()
      .find((item) => item.qualifiedName === qualifiedName);
    expect(later).toBeDefined();
    expect(later?.field.key.$tag).toBe("NamedField");
    if (later?.field.key.$tag === "NamedField") {
      expect(later.field.key.ref.$ref).toBe(expectedRef);
      expect(later.field.key.ref).not.toBe(identity.field.key.ref);
    }
    expect(later?.owner).not.toBe(identity.owner);
    if (later?.owner.$tag === "TypeFieldOwner") {
      expect(later.owner.localId).toBe(expectedLocalId);
    }
    expect(later?.path[0]).not.toBe(identity.path[0]);
    if (later?.path[0]?.$tag === "FieldNamed") {
      expect(later.path[0].name).toBe(expectedPathName);
    }
  }, 300_000);

  test("Node and embedded repository views agree for a function, type, and field", () => {
    resetLockCache();
    const physical = loadLock();
    const embedded = repositoryIdentityLock();
    const registry = createRepositoryRegistry([stdModule]);
    expect(registry.getUuid("std:add")).toBe(physical.get("std:add"));
    expect(embedded.get("std:add")).toBe(physical.get("std:add"));

    // Type rows are keyed by owner (per-owner type identity); `String` is a
    // system declaration. Assert a real UUID so the comparison cannot pass as
    // undefined === undefined.
    const typeKey = "type/module/system/String";
    expect(physical.get(typeKey)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(embedded.get(typeKey)).toBe(physical.get(typeKey));
    expect(registry.getUuid("String")).toBe(physical.get(typeKey));
    expect(registry.getTypeUuid("system", "String")).toBe(physical.get(typeKey));
    expect(physical.has("String")).toBe(false);

    const named = registry.listFieldIdentities().find((field) =>
      field.field.key.$tag === "NamedField"
    );
    expect(named).toBeDefined();
    if (named !== undefined) {
      expect(embedded.get(named.qualifiedName)).toBe(physical.get(named.qualifiedName));
    }
  });
});

describe("registry architecture source inventory", () => {
  test("production paths use explicit constructors, never legacy createRegistry", async () => {
    const root = new URL("../../../../", import.meta.url);
    const directories = [
      "implementations/typescript/runtime/src",
      "implementations/typescript/api/src",
      "implementations/typescript/core/src",
      "distros/narthex/solid/src",
    ];
    const violations: string[] = [];
    for (const directory of directories) {
      const glob = new Bun.Glob("**/*.{ts,tsx}");
      for await (const relative of glob.scan({
        cwd: fileURLToPath(new URL(directory + "/", root)),
      })) {
        if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
        // Browser fixtures are test harnesses, not production paths.
        if (relative.endsWith(".fixture.tsx") || relative.endsWith(".browser-fixture.tsx")) continue;
        const url = new URL(`${directory}/${relative}`, root);
        const source = await Bun.file(url).text();
        if (/\bcreateRegistry\s*\(/.test(source)) violations.push(`${directory}/${relative}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("only the dispatch harness, JS classifier, and shared backend harness construct bootstrap registries", async () => {
    const root = new URL("./", import.meta.url);
    const glob = new Bun.Glob("**/*.ts");
    const users: string[] = [];
    for await (const relative of glob.scan({ cwd: fileURLToPath(root) })) {
      if (relative.endsWith(".test.ts")) continue;
      const source = await Bun.file(new URL(relative, root)).text();
      if (source.includes("createEngineBootstrapRegistry(")) users.push(relative.replaceAll("\\", "/"));
    }
    expect(users.sort()).toEqual([
      "compile-js-self-host-classifier.ts",
      "engine-bodies-dispatch.ts",
      "registry.ts",
      "self-host-wasm-llvm-bootstrap.ts",
    ]);
  });

  test("strict identity projection registries stay confined to identity/compiler tooling", async () => {
    const root = new URL("./", import.meta.url);
    const glob = new Bun.Glob("**/*.ts");
    const users: string[] = [];
    for await (const relative of glob.scan({ cwd: fileURLToPath(root) })) {
      if (relative.endsWith(".test.ts")) continue;
      const source = await Bun.file(new URL(relative, root)).text();
      if (source.includes("createIdentityProjectionRegistry(")) {
        users.push(relative.replaceAll("\\", "/"));
      }
    }
    expect(users.sort()).toEqual([
      "compiler-metadata-view.ts",
      "registry.ts",
    ]);

    const scriptsRoot = new URL("../scripts/", import.meta.url);
    const scriptUsers: string[] = [];
    for await (const relative of glob.scan({ cwd: fileURLToPath(scriptsRoot) })) {
      const source = await Bun.file(new URL(relative, scriptsRoot)).text();
      if (source.includes("createIdentityProjectionRegistry")) {
        scriptUsers.push(relative.replaceAll("\\", "/"));
      }
    }
    expect(scriptUsers.sort()).toEqual([
      "generate-codename-lock.ts",
      "generate-repository-field-catalog.ts",
    ]);

    // A call-site scan alone would miss `export { factory }`. Pin all public
    // package surfaces as well as the internal-user allowlist above.
    const [facade, barrel, packageJson] = await Promise.all([
      Bun.file(new URL("./registry-public.ts", root)).text(),
      Bun.file(new URL("./index.ts", root)).text(),
      Bun.file(new URL("../package.json", root)).json() as Promise<{
        exports?: Record<string, string>;
      }>,
    ]);
    expect(facade).not.toContain("createIdentityProjectionRegistry");
    expect(barrel).not.toContain("createIdentityProjectionRegistry");
    expect(packageJson.exports?.["./registry"]).toBe("./src/registry-public.ts");
    expect(Object.values(packageJson.exports ?? {})).not.toContain("./src/registry.ts");
  });

  test("the manifest adapter has no filesystem/codename-lock dependency", async () => {
    const source = await Bun.file(
      new URL("./repository-identity-manifest.ts", import.meta.url),
    ).text();
    expect(source).not.toMatch(/node:|codename-lock/);
  });
});
