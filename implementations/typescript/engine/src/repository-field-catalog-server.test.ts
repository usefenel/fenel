import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_FIELD_CATALOG_REGEN_COMMAND,
  createRepositoryFieldCatalogIdentityDeficitReporter,
  repositoryFieldCatalogIdentityStampMismatch,
} from "./repository-field-catalog-server";

const ROOT = new URL("../../../../", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);

async function source(path: string): Promise<string> {
  return Bun.file(new URL(path, ROOT)).text();
}

describe("repository field-catalog identity freshness", () => {
  test("matching stamps are silent and the committed pair matches", () => {
    const lines: string[] = [];
    const report = createRepositoryFieldCatalogIdentityDeficitReporter({
      catalogIdentityManifestDigest: "same-digest",
      identityManifestDigest: "same-digest",
      error: (message) => lines.push(message),
    });

    expect(() => {
      report();
      report();
    }).not.toThrow();
    expect(lines).toEqual([]);
    expect(repositoryFieldCatalogIdentityStampMismatch()).toBeUndefined();
  });

  test("a mismatch emits one memoized, one-line, fail-open deficit", () => {
    const lines: string[] = [];
    const report = createRepositoryFieldCatalogIdentityDeficitReporter({
      catalogIdentityManifestDigest: "catalog-digest",
      identityManifestDigest: "manifest-digest",
      error: (message) => lines.push(message),
    });

    expect(() => {
      report();
      report();
    }).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("field-catalog-stale");
    expect(lines[0]).toContain("catalog-digest");
    expect(lines[0]).toContain("manifest-digest");
    expect(lines[0]).toContain(REPOSITORY_FIELD_CATALOG_REGEN_COMMAND);
    expect(lines[0]).not.toContain("\n");
  });

  test("the identity-only blind spots and complete detector stay explicit", async () => {
    const helper = await source(
      "implementations/typescript/engine/src/repository-field-catalog-server.ts",
    );
    for (const blindSpot of [
      "kind-only tombstone flips",
      "`@fieldReusable` facet changes",
      "owner/occurrence-type changes",
      "label/facet method edits",
      "representation-family membership",
      "`generate-repository-field-catalog.ts --check`",
    ]) {
      expect(helper).toContain(blindSpot);
    }

    // Equal identity stamps deliberately cannot detect either blind-spot half.
    expect(repositoryFieldCatalogIdentityStampMismatch("same", "same")).toBeUndefined();
  });
});

test("the server-only subpath is isolated and every reached process entry reports at boot", async () => {
  const [packageJson, index, browserCatalog, api, bot] = await Promise.all([
    source("implementations/typescript/engine/package.json"),
    source("implementations/typescript/engine/src/index.ts"),
    source("implementations/typescript/engine/src/repository-field-catalog.ts"),
    source("implementations/typescript/api/src/server.ts"),
    source("implementations/typescript/bot/src/index.ts"),
  ]);

  expect(JSON.parse(packageJson).exports["./repository-field-catalog-server"])
    .toBe("./src/repository-field-catalog-server.ts");
  expect(index).not.toContain("repository-field-catalog-server");
  expect(browserCatalog).not.toContain("repository-field-catalog-server");
  expect(browserCatalog).not.toContain("repository-identity-manifest");

  for (const entry of [api, bot]) {
    expect(entry).toMatch(
      /(?:from\s+|import\()"@fenel\/engine\/repository-field-catalog-server"/,
    );
    expect(entry).toContain("reportRepositoryFieldCatalogIdentityDeficit();");
  }
});

test("the blocking audit dimension is wired through every aggregate", async () => {
  const audit = await source("implementations/typescript/engine/scripts/audit-effects.ts");
  expect(audit).toContain("fieldCatalogStale: RepositoryFieldCatalogIdentityStampMismatch[]");
  expect(audit).toContain("fieldCatalogStale,");
  expect(audit).toContain("report.fieldCatalogStale.length > 0");
  expect(audit).toContain("report.fieldCatalogStale.length +");
  expect(audit).toContain("`${report.fieldCatalogStale.length} field-catalog-stale`");
  expect(audit).toContain(
    "formatRepositoryFieldCatalogIdentityDeficit(report.fieldCatalogStale[0])",
  );
});

test("Solid authoring has no generated catalog import and waits for an authoritative realm", async () => {
  const glob = new Bun.Glob("distros/narthex/solid/src/**/*.{ts,tsx}");
  for await (const path of glob.scan({ cwd: ROOT_PATH, onlyFiles: true })) {
    const text = await Bun.file(new URL(path.replaceAll("\\", "/"), ROOT)).text();
    expect(text).not.toContain("@fenel/engine/repository-field-catalog");
    for (const catalogValue of [
      "REPOSITORY_FIELD_CATALOG",
      "repositoryFieldCatalog",
      "fieldRepresentationalInterfaceNames",
      "queryRepositoryFieldReuse",
      "queryAvailableFieldReuse",
    ]) {
      expect(text).not.toContain(catalogValue);
    }
  }

  const editor = await source(
    "distros/narthex/solid/src/lib/field-occurrence/FieldOccurrenceEditorBase.tsx",
  );
  expect(editor).not.toContain("REPOSITORY_FIELD_IDS");
  expect(editor).toContain("A settled `{ field: null }` is a decided absence");
  expect(editor).toContain(
    "(!!fieldId() && (currentIdentity.loading || !!currentIdentity.error))",
  );
  expect(editor).not.toContain("currentIdentityRealm() === undefined");
  expect(editor.match(/currentIdentityRealm\(\) === "account"/g)?.length).toBeGreaterThanOrEqual(2);
  expect(editor).toContain('if (!id || realm === undefined) return;');
  expect(editor).toContain('realm !== "account"');
}, 60_000);
