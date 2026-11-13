import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { prepareSourceModule, sourceModuleContentHash } from "@fenel/engine/authoring/source-module";
import type { AccountFieldDefinitionGraph } from "@fenel/engine/field-authoring";
import { validateSourceModuleInstallation } from "./evaluator";

const graph = { currentOwners: [], currentFields: [], currentFacets: [], storageIssues: [] } as unknown as AccountFieldDefinitionGraph;

describe("source install validates the actual durable registry without database writes", () => {
  test("canonical source schemes hydrate and only implemented source functions get physical owners", () => {
    const source = "module SourceInstallationParity where\nimport std (add)\n@native\nexternal : Number -> Number\nidentity : (value: a) -> a\nidentity value = value\nplus : Number -> Number\nplus value = add value 1";
    const prepared = prepareSourceModule(source, "source-install", undefined, randomUUID);
    const rows = [{ registry: { id: "source-version", slug: "account/source-install", version: "1", source, contentHash: sourceModuleContentHash(source), module: { sourceIdentity: prepared.identity }, dependencies: [] } }];
    const owners = validateSourceModuleInstallation("account", graph, rows, "source-version");
    expect(owners.map((fn) => fn.id)).toEqual(["SourceInstallationParity:identity", "SourceInstallationParity:plus"]);
    expect(owners.find((fn) => fn.id.endsWith(":identity"))?.params[0]?.name).toBe("value");
  }, 300_000);
});
