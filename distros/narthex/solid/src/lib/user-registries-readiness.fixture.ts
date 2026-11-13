import { mock } from "bun:test";
import assert from "node:assert/strict";

let loadResponse: (path: string) => Promise<unknown> = async () => ({});
mock.module("./api", () => ({ apiRead: (path: string) => loadResponse(path) }));
mock.module("@fenel/engine/authoring/expression", () => ({
  functionDefinitionFromJsonWire: (value: unknown) => value,
  viewDefinitionFromJsonWire: (value: unknown) => value,
}));
mock.module("@fenel/engine/module-manifest", () => ({
  modulesFor: () => [{ name: "std", functions: [{ id: "std:id" }, { id: "std:appendItem" }] }],
}));

const {
  ensureUserRegistriesLoaded,
  setUserRegistryAccountScope,
  userRegistriesLoadedFor,
  userFunctions,
} = await import("./user-registries");

// A completed roster is ready only for the current account.
{
  const reads: string[] = [];
  loadResponse = async (path) => { reads.push(path); return {}; };
  setUserRegistryAccountScope("account-a");
  const pending = ensureUserRegistriesLoaded("account-a");
  assert.equal(userRegistriesLoadedFor("account-a"), false);
  await pending;
  assert.deepEqual(reads.sort(), ["/functions", "/modules/installed", "/views"]);
  assert.equal(userRegistriesLoadedFor("account-a"), true);
  assert.equal(userRegistriesLoadedFor("account-b"), false);
  setUserRegistryAccountScope("account-b");
  assert.equal(userRegistriesLoadedFor("account-a"), false);
  setUserRegistryAccountScope(undefined);
  console.log("PASS complete account roster");
}

// System provenance alone is not an exclusion: backend-only actions remain,
// while exact repository-owned seed copies cannot replace source schemes.
{
  const fn = (id: string) => ({ id, params: [], returns: { $ref: "String" }, body: id });
  loadResponse = async (path) => path === "/functions" ? { functions: [
    { function: fn("std:id"), isSystem: true, sourceRegistryId: null },
    { function: fn("std:appendItem"), isSystem: true },
    { function: fn("account:mine"), isSystem: false },
    { function: fn("core-only:submit"), isSystem: true },
    { function: fn("installed:owned"), sourceRegistryId: "source-registry" },
  ] } : {};
  setUserRegistryAccountScope("account-roster");
  await ensureUserRegistriesLoaded("account-roster");
  assert.equal(userRegistriesLoadedFor("account-roster"), true);
  assert.deepEqual(userFunctions().map((entry) => entry.id), ["account:mine", "core-only:submit"]);
  setUserRegistryAccountScope(undefined);
  console.log("PASS managed system copies preserve source authority");
}

// A swallowed partial failure stays unavailable until a successful retry.
{
  let failModules = true;
  loadResponse = async (path) => {
    if (path === "/modules/installed" && failModules) throw new Error("temporary failure");
    return {};
  };
  setUserRegistryAccountScope("account-a");
  await ensureUserRegistriesLoaded("account-a");
  assert.equal(userRegistriesLoadedFor("account-a"), false);
  failModules = false;
  await ensureUserRegistriesLoaded("account-a");
  assert.equal(userRegistriesLoadedFor("account-a"), true);
  setUserRegistryAccountScope(undefined);
  console.log("PASS partial failure and retry");
}

// A late completion cannot make a replaced account ready.
{
  let resolveModules!: (value: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  loadResponse = async (path) => {
    if (path !== "/modules/installed") return {};
    return new Promise((resolve) => {
      resolveModules = resolve;
      markStarted();
    });
  };
  setUserRegistryAccountScope("account-a");
  const pending = ensureUserRegistriesLoaded("account-a");
  await started;
  setUserRegistryAccountScope("account-b");
  resolveModules({});
  await pending;
  assert.equal(userRegistriesLoadedFor("account-a"), false);
  assert.equal(userRegistriesLoadedFor("account-b"), false);
  setUserRegistryAccountScope(undefined);
  console.log("PASS stale account completion");
}

// Home's scoped catalog follows committed snapshots and never boots a global
// repository catalog while the current account is absent or being revoked.
{
  const reads: unknown[] = [];
  mock.module("@fenel/engine", () => ({
    getCatalog: (registry: unknown) => { reads.push(registry); return [registry]; },
    getCatalogEntry: (_id: string, registry: unknown) => { reads.push(registry); return registry; },
  }));
  const { getCatalog, getCatalogEntry } = await import("./workspace-catalog");
  const { clearAccountFieldRegistry, installCommittedAccountFieldSnapshot } = await import("./account-field-registry");
  type Registry = import("@fenel/engine/registry").ModuleRegistry;
  const snapshot = { owners: [], fields: [], facets: [] };
  const accountA = { marker: "A" } as unknown as Registry;
  const accountB = { marker: "B" } as unknown as Registry;
  const revisedB = { marker: "B revision 2" } as unknown as Registry;
  clearAccountFieldRegistry();
  assert.deepEqual(getCatalog(), []);
  assert.equal(getCatalogEntry("function"), undefined);
  assert.deepEqual(reads, []);
  await installCommittedAccountFieldSnapshot("A", snapshot, () => accountA);
  assert.equal(getCatalog()[0], accountA);
  assert.equal(getCatalogEntry("function"), accountA);
  clearAccountFieldRegistry();
  assert.deepEqual(getCatalog(), []);
  await installCommittedAccountFieldSnapshot("B", snapshot, () => accountB);
  assert.equal(getCatalog()[0], accountB);
  await installCommittedAccountFieldSnapshot("B", snapshot, () => revisedB);
  assert.equal(getCatalogEntry("function"), revisedB);
  clearAccountFieldRegistry();
  assert.deepEqual(getCatalog(), []);
  assert.deepEqual(reads, [accountA, accountA, accountB, revisedB]);
  console.log("PASS workspace catalog session revocation and committed snapshot changes");
}
