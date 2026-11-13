import { afterEach, describe, expect, test } from "bun:test";
import type { AccountFieldDefinitionGraph } from "@fenel/db";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { sourceModuleContentHash } from "@fenel/engine/authoring/source-module";
import {
  clearRuntimeAccountFieldRegistry,
  getRuntimeAccountFieldRegistry,
} from "./account-field-registry";

const EMPTY: AccountFieldDefinitionGraph = {
  currentOwners: [],
  currentFields: [],
  currentFacets: [],
  storageIssues: [],
};

afterEach(() => clearRuntimeAccountFieldRegistry());

describe("runtime account field registry", () => {
  test("keeps a bounded set of account registries", async () => {
    let builds = 0;
    const dependencies = { load: async () => EMPTY, build: () => ({ build: ++builds } as unknown as ModuleRegistry) };
    const first = await getRuntimeAccountFieldRegistry("cache-0", dependencies);
    for (let index = 1; index <= 32; index++) await getRuntimeAccountFieldRegistry(`cache-${index}`, dependencies);
    expect(await getRuntimeAccountFieldRegistry("cache-0", dependencies)).not.toBe(first);
    expect(builds).toBe(34);
  });
  test("source row changes invalidate cached account authority without altering the state read gateway", async () => {
    let rows: { registry: { id: string; source: string; slug: string; version: string; contentHash: string } }[] = [];
    let builds = 0;
    const dependencies = { load: async () => EMPTY, loadSources: async () => rows, build: () => ({ build: ++builds } as unknown as ModuleRegistry) };
    const first = await getRuntimeAccountFieldRegistry("source-account", dependencies);
    expect(await getRuntimeAccountFieldRegistry("source-account", dependencies)).toBe(first);
    rows = [{ registry: { id: "empty-module", source: "module EmptySource where\n", slug: "EmptySource", version: "1", contentHash: sourceModuleContentHash("module EmptySource where\n") } }];
    expect(await getRuntimeAccountFieldRegistry("source-account", dependencies)).not.toBe(first);
    expect(builds).toBe(2);
    rows = [{ registry: { id: "empty-module", source: "module ???", slug: "EmptySource", version: "2", contentHash: sourceModuleContentHash("module ???") } }];
    await expect(getRuntimeAccountFieldRegistry("source-account", dependencies)).rejects.toThrow();
    expect(builds).toBe(2);
  }, 120_000);
  test("reuses an unchanged committed snapshot and swaps when it changes", async () => {
    let graph = EMPTY;
    let builds = 0;
    const dependencies = {
      load: async () => graph,
      build: () => ({ build: ++builds } as unknown as ModuleRegistry),
    };

    const first = await getRuntimeAccountFieldRegistry("acct", dependencies);
    const same = await getRuntimeAccountFieldRegistry("acct", dependencies);
    expect(same).toBe(first);
    expect(builds).toBe(1);

    graph = {
      ...EMPTY,
      currentFields: [{
        id: "a04c06c4-700a-4ce7-95fb-0cb3f0ddd51e",
        currentCodeName: "title",
        status: "tombstoned",
        realm: "account",
        reuseVisibility: "account",
      }],
    };
    const changed = await getRuntimeAccountFieldRegistry("acct", dependencies);
    expect(changed).not.toBe(first);
    expect(builds).toBe(2);
  });

  test("rejects ambiguous storage before registry construction", async () => {
    let builds = 0;
    await expect(getRuntimeAccountFieldRegistry("broken", {
      load: async () => ({
        ...EMPTY,
        storageIssues: [{
          ownerKind: "function",
          storageName: "duplicate",
          rowIds: ["one", "two"],
          reason: "multiple-current",
        }],
      }),
      build: () => {
        builds++;
        return {} as ModuleRegistry;
      },
    })).rejects.toThrow("ambiguous current owner");
    expect(builds).toBe(0);
  });
});
