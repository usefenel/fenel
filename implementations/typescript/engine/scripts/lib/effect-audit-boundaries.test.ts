import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isInstalledSolidLifecycleImport, isApprovedReaderReflectionBoundary } from "./effect-audit-boundaries";

const fixtureParent = resolve(import.meta.dir, "../../../../../.tmp/effect-audit-boundary-tests");
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (dirname(resolve(root)) !== fixtureParent) throw new Error("Fixture cleanup escaped its repository directory");
    rmSync(root, { recursive: true, force: true });
  }
});

const workspace = "distros/narthex/solid";
const importers = [
  `${workspace}/src/lib/field-occurrence/authoring-coverage.test.ts`,
  `${workspace}/src/lib/expression-builder/inline-tester-provenance.test.ts`,
  `${workspace}/src/lib/variant-value/local-numeric-text.test.ts`,
];
const specifier = "../../../node_modules/solid-js/dist/solid.dev.js";
const target = `${workspace}/node_modules/solid-js/dist/solid.dev.js`;
const version = "2.0.0-rc.7";
const manifestPath = `${workspace}/package.json`;
const installedPath = `${workspace}/node_modules/solid-js/package.json`;

function write(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function fixture(): string {
  mkdirSync(fixtureParent, { recursive: true });
  const root = mkdtempSync(join(fixtureParent, "case-"));
  temporaryRoots.push(root);
  write(root, manifestPath, { dependencies: { "solid-js": version } });
  write(root, installedPath, { name: "solid-js", version,
    exports: { ".": { browser: { development: { import: { default: "./dist/solid.dev.js" } } } } } });
  write(root, "bun.lock", { lockfileVersion: 1, workspaces: {
    [workspace]: { dependencies: { "solid-js": version } },
  }, packages: { "solid-js": [`solid-js@${version}`] } });
  return root;
}

function change(root: string, path: string, mutate: (value: any) => void): void {
  const value = JSON.parse(readFileSync(join(root, path), "utf8"));
  mutate(value);
  write(root, path, value);
}

describe("effect audit exact host boundaries", () => {
  test("unregistered context natives never acquire a reflection classification", () => {
    expect(isApprovedReaderReflectionBoundary({ id: "view:otherContextNative", params: [] })).toBe(false);
    expect(isApprovedReaderReflectionBoundary({ id: "RecipeFunctions:otherReader", params: ["fn"] })).toBe(false);
    expect(isApprovedReaderReflectionBoundary(undefined)).toBe(false);
  });

  for (const [id, arity] of [["view:readerSourceMetadata", 0], ["RecipeFunctions:reflectFunction", 1],
    ["RecipeFunctions:recipeReaderSnapshot", 2], ["RecipeFunctions:recipeReaderSnapshotWithFunctions", 3]] as const) {
    test(`${id} requires its exact registered reflection arity`, () => {
      expect(isApprovedReaderReflectionBoundary({ id, params: Array.from({ length: arity }) })).toBe(true);
      expect(isApprovedReaderReflectionBoundary({ id, params: Array.from({ length: arity + 1 }) })).toBe(false);
      if (arity > 0) expect(isApprovedReaderReflectionBoundary({ id, params: Array.from({ length: arity - 1 }) })).toBe(false);
    });
  }

  for (const importer of importers) describe(importer, () => {
    test(`${importer} requires the exact installed lifecycle export and both lock pins`, () => {
      const root = fixture();
      expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(true);
      const lock = readFileSync(join(root, "bun.lock"), "utf8");
      writeFileSync(join(root, "bun.lock"), `// Bun JSONC\n${lock.replace(/}$/, ",}")}`);
      expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(true);
    });

    test("nearby importers, package files and project helpers retain ordinary hygiene findings", () => {
      const root = fixture();
      for (const [from, name, to] of [
        [importer.replace(".test.ts", "-other.test.ts"), specifier, target],
        [importer.replace(".test.ts", ".ts"), specifier, target],
        [importer, "../../../node_modules/solid-js/dist/server.dev.js", target.replace("solid.dev.js", "server.dev.js")],
        [importer, specifier, target.replace("node_modules/solid-js", "fixtures/solid-js")],
        [importer, specifier, target.replace("solid-js", "other-package")],
      ]) expect(isInstalledSolidLifecycleImport(root, from!, name!, to!)).toBe(false);
    });

    for (const [label, path, mutate] of [
      ["removed dependency", manifestPath, (value: any) => { delete value.dependencies["solid-js"]; }],
      ["declaration version", manifestPath, (value: any) => { value.dependencies["solid-js"] = "2.0.0-rc.8"; }],
      ["installed name", installedPath, (value: any) => { value.name = "other-package"; }],
      ["installed version", installedPath, (value: any) => { value.version = "2.0.0-rc.8"; }],
      ["workspace lock pin", "bun.lock", (value: any) => { value.workspaces[workspace].dependencies["solid-js"] = "2.0.0-rc.8"; }],
      ["package lock resolution", "bun.lock", (value: any) => { value.packages["solid-js"][0] = "solid-js@2.0.0-rc.8"; }],
      ["lock format", "bun.lock", (value: any) => { value.lockfileVersion = 0; }],
      ["browser export", installedPath, (value: any) => { value.exports["."].browser.development.import.default = "./dist/server.dev.js"; }],
      ["escaping export", installedPath, (value: any) => { value.exports["."].browser.development.import.default = "../solid.dev.js"; }],
    ] as const) {
      test(`${label} mismatch cannot suppress an untracked import`, () => {
        const root = fixture();
        change(root, path, mutate);
        expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(false);
      });
    }

    test("missing, malformed and duplicate metadata fail closed", () => {
      const root = fixture();
      writeFileSync(join(root, installedPath), "not JSON");
      expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(false);
      writeFileSync(join(root, installedPath), '{"name":"solid-js","name":"solid-js"}');
      expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(false);
      rmSync(join(root, installedPath));
      expect(isInstalledSolidLifecycleImport(root, importer, specifier, target)).toBe(false);
    });
  });
});
