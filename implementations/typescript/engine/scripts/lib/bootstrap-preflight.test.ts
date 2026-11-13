import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCacheKey } from "../../src/parse-cache-key";
import { inspectBootstrapPreflight, type BootstrapSeedEntry } from "./bootstrap-preflight";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(input: {
  rawImports?: readonly string[];
  typeFoundationSource?: string;
  files: Readonly<Record<string, string>>;
  recorded?: Readonly<Record<string, string>>;
}) {
  const root = mkdtempSync(join(tmpdir(), "fenel-bootstrap-preflight-"));
  temporaryRoots.push(root);
  const engineSrc = join(root, "implementations", "typescript", "engine", "src");
  mkdirSync(engineSrc, { recursive: true });
  mkdirSync(join(root, "fenel", "std"), { recursive: true });
  writeFileSync(join(root, "fenel", "std", "parser-fixities.fenel"), "fixities = []\n");
  const imports = (input.rawImports ?? []).map((path, index) =>
    `import source${index} from \"../../../../${path}?raw\";`
  ).join("\n");
  writeFileSync(join(engineSrc, "type-foundation.ts"), input.typeFoundationSource ?? imports);
  for (const [path, source] of Object.entries(input.files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
  const seedEntries: Record<string, BootstrapSeedEntry> = {};
  for (const [path, source] of Object.entries(input.recorded ?? {})) {
    seedEntries[path] = { srcHash: parseCacheKey(source), ast: [] };
  }
  // The fixed parser-fixities row is unchanged and should not distract fixtures.
  seedEntries["fenel/std/parser-fixities.fenel"] = {
    srcHash: parseCacheKey("fixities = []\n"),
    ast: [],
  };
  return { root, engineSrc, seedEntries };
}

describe("parser-bootstrap preflight classification", () => {
  test("refuses changed recorded carriers before engine work", () => {
    const path = "fenel/std/carrier.fenel";
    const f = fixture({
      files: { [path]: "x = String | value in /^[A-Z]$/\n" },
      recorded: { [path]: "x = String | value in /^[a-z]$/\n" },
    });
    const result = inspectBootstrapPreflight({
      repoRoot: f.root,
      engineSrc: f.engineSrc,
      seedEntries: f.seedEntries,
    });
    expect(result.ok).toBe(false);
    expect(result.refusals).toEqual([
      expect.objectContaining({ path, kind: "recorded-carrier-drift" }),
    ]);
  });

  test("warns and proceeds for a new late carrier", () => {
    const path = "fenel/std/new-carrier.fenel";
    const f = fixture({ files: { [path]: "x = String | value in /^[A-Z]$/\n" } });
    const result = inspectBootstrapPreflight({
      repoRoot: f.root,
      engineSrc: f.engineSrc,
      seedEntries: f.seedEntries,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({ path, kind: "new-carrier" }));
  });

  test("refuses a new carrier imported during early initialization (R2-5)", () => {
    const path = "fenel/std/new-early-carrier.fenel";
    const f = fixture({
      rawImports: [path],
      files: { [path]: "x = String | value in /^[A-Z]$/\n" },
    });
    const result = inspectBootstrapPreflight({
      repoRoot: f.root,
      engineSrc: f.engineSrc,
      seedEntries: f.seedEntries,
    });
    expect(result.ok).toBe(false);
    expect(result.refusals).toContainEqual(
      expect.objectContaining({ path, kind: "new-early-init-carrier" }),
    );
  });

  test("refuses a single-quoted, line-broken early carrier import", () => {
    const path = "fenel/std/new-early-carrier.fenel";
    const f = fixture({
      typeFoundationSource:
        "import source from\n  '../../../../fenel/std/new-early-carrier.fenel?raw';\n",
      files: { [path]: "x = String | value in /^[A-Z]$/\n" },
    });
    const result = inspectBootstrapPreflight({
      repoRoot: f.root,
      engineSrc: f.engineSrc,
      seedEntries: f.seedEntries,
    });
    expect(result.ok).toBe(false);
    expect(result.refusals).toContainEqual(
      expect.objectContaining({ path, kind: "new-early-init-carrier" }),
    );
  });

  test("warns and proceeds for non-carrier init-cycle drift", () => {
    const path = "fenel/std/foundation.fenel";
    const f = fixture({
      rawImports: [path],
      files: { [path]: "foundation = 2\n" },
      recorded: { [path]: "foundation = 1\n" },
    });
    const result = inspectBootstrapPreflight({
      repoRoot: f.root,
      engineSrc: f.engineSrc,
      seedEntries: f.seedEntries,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path, kind: "non-carrier-drift" }),
    );
  });
});

test("importing the parser-bootstrap CLI is inert and leaves artifact bytes untouched", async () => {
  const artifact = join(
    REPO_ROOT,
    "implementations/typescript/engine/src/generated/parser-bootstrap.generated.ts",
  );
  const before = readFileSync(artifact);
  await import(`../generate-parser-bootstrap.ts?import-only=${Date.now()}`);
  expect(readFileSync(artifact)).toEqual(before);

  const source = readFileSync(
    join(REPO_ROOT, "implementations/typescript/engine/scripts/generate-parser-bootstrap.ts"),
    "utf8",
  );
  expect(source).toContain("if (import.meta.main)");
  expect(source).not.toContain("spawn(");

  // Capture quote variants, line-broken `from` clauses, re-exports, and
  // side-effect imports. Dynamic `import(...)` is intentionally excluded.
  const staticImports = [...source.matchAll(/\b(?:from|import)\s*(["'])([^"']+)\1/g)]
    .map((match) => match[2]);
  expect(staticImports).toEqual([
    "node:fs",
    "node:path",
    "node:url",
    "./lib/bootstrap-carriers",
    "../src/parse-cache-key",
  ]);
  const preflightCall = source.indexOf("prepareBootstrapSources(");
  expect(preflightCall).toBeGreaterThan(-1);
  for (const engineImport of [
    'import("../src/fenel-parser")',
    'import("../src/engine-bodies-dispatch")',
    'import("../src/parse-cache")',
  ]) {
    expect(source.indexOf(engineImport)).toBeGreaterThan(preflightCall);
  }

  const preflightSource = readFileSync(
    join(REPO_ROOT, "implementations/typescript/engine/scripts/lib/bootstrap-preflight.ts"),
    "utf8",
  );
  const preflightImports = [
    ...preflightSource.matchAll(/\b(?:from|import)\s*(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
  expect(preflightImports).toEqual([
    "node:fs",
    "node:path",
    "../../src/generated/parser-bootstrap.generated",
    "../../src/parse-cache-key",
    "./bootstrap-carriers",
  ]);
});
