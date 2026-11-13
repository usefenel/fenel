/** C2: exact host-boundary classifications; this module does not load the engine. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeBunLock, SUPPORTED_BUN_LOCKFILE_VERSION } from "./compiled-artifact-dependencies";
import { decodeStrictJson } from "./compiled-artifact-toolchain";

/** Exact A2/B3 frame/value observations, never recipe/family callback calls.
 * TCB: eval.scope.reader-metadata and recipe.source.route. */
export function isApprovedReaderReflectionBoundary(fn: { id: string; params: readonly unknown[] } | undefined): boolean {
  if (fn === undefined || !Array.isArray(fn.params)) return false;
  switch (fn.id) {
    case "view:readerSourceMetadata": return fn.params.length === 0;
    case "RecipeFunctions:reflectFunction": return fn.params.length === 1;
    case "RecipeFunctions:recipeReaderSnapshot": return fn.params.length === 2;
    case "RecipeFunctions:recipeReaderSnapshotWithFunctions": return fn.params.length === 3;
    default: return false;
  }
}

/** These tracked lifecycle fixtures deliberately need Solid's browser-development
 * runtime. No other importer, relative dependency file or export is exempt. */
export function isInstalledSolidLifecycleImport(repo: string, importer: string, specifier: string, target: string): boolean {
  const workspace = "distros/narthex/solid";
  if ((importer !== `${workspace}/src/lib/field-occurrence/authoring-coverage.test.ts`
      && importer !== `${workspace}/src/lib/expression-builder/inline-tester-provenance.test.ts`
      && importer !== `${workspace}/src/lib/variant-value/local-numeric-text.test.ts`)
    || specifier !== "../../../node_modules/solid-js/dist/solid.dev.js"
    || target !== `${workspace}/node_modules/solid-js/dist/solid.dev.js`) return false;
  try {
    const manifest = decodeStrictJson(readFileSync(join(repo, workspace, "package.json")), "Solid workspace package.json") as {
      dependencies?: Record<string, unknown>;
    };
    const installed = decodeStrictJson(readFileSync(join(repo, workspace, "node_modules/solid-js/package.json")), "installed solid-js package.json") as {
      name?: unknown; version?: unknown;
      exports?: { "."?: { browser?: { development?: { import?: { default?: unknown } } } } };
    };
    const lock = decodeBunLock(readFileSync(join(repo, "bun.lock"))) as {
      lockfileVersion?: unknown;
      workspaces?: Record<string, { dependencies?: Record<string, unknown> }>;
      packages?: Record<string, unknown>;
    };
    const declared = manifest.dependencies?.["solid-js"];
    const resolution = lock.packages?.["solid-js"];
    return lock.lockfileVersion === SUPPORTED_BUN_LOCKFILE_VERSION
      && typeof declared === "string" && installed.name === "solid-js" && installed.version === declared
      && lock.workspaces?.[workspace]?.dependencies?.["solid-js"] === declared
      && Array.isArray(resolution) && resolution[0] === `solid-js@${declared}`
      && installed.exports?.["."]?.browser?.development?.import?.default === "./dist/solid.dev.js";
  } catch { return false; }
}
