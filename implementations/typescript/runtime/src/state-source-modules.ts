// DB-free lazy facade over the account source-module state read.
export async function loadAccountSourceModulesState(accountId: string) {
  const { loadAccountSourceModulesStateLeaf } = await import("./handlers/state");
  return loadAccountSourceModulesStateLeaf(accountId);
}

export async function loadSourceRegistryVersionGraphState(accountId: string, registryId: string) {
  const { loadSourceRegistryVersionGraphStateLeaf } = await import("./handlers/state");
  return loadSourceRegistryVersionGraphStateLeaf(accountId, registryId);
}

// The source-module registry surface the HTTP layer consumes. Same DB-free
// lazy shape as above: this module names no `@fenel/db` symbol and pulls the
// leaf in only when a call actually happens, which is what keeps the
// core/runtime registration cycle from closing at import time (the reason
// `state-field-definitions.ts` is written this way too).
//
// Parameters are derived from the leaves rather than restated, so the host
// callbacks and the optional transaction seam keep their exact types and this
// file never has to name a `@fenel/db` type.
type StateLeaves = typeof import("./handlers/state");

export async function getSourceRegistryByIdState(
  ...args: Parameters<StateLeaves["getSourceRegistryByIdStateLeaf"]>
) {
  const { getSourceRegistryByIdStateLeaf } = await import("./handlers/state");
  return getSourceRegistryByIdStateLeaf(...args);
}

export async function listVisibleSourceRegistriesState(
  ...args: Parameters<StateLeaves["listVisibleSourceRegistriesStateLeaf"]>
) {
  const { listVisibleSourceRegistriesStateLeaf } = await import("./handlers/state");
  return listVisibleSourceRegistriesStateLeaf(...args);
}

export async function publishSourceRegistryVersionState(
  ...args: Parameters<StateLeaves["publishSourceRegistryVersionStateLeaf"]>
) {
  const { publishSourceRegistryVersionStateLeaf } = await import("./handlers/state");
  return publishSourceRegistryVersionStateLeaf(...args);
}

export async function installSourceRegistryVersionState(
  ...args: Parameters<StateLeaves["installSourceRegistryVersionStateLeaf"]>
): Promise<void> {
  const { installSourceRegistryVersionStateLeaf } = await import("./handlers/state");
  return installSourceRegistryVersionStateLeaf(...args);
}

export async function uninstallSourceRegistryVersionState(
  ...args: Parameters<StateLeaves["uninstallSourceRegistryVersionStateLeaf"]>
): Promise<void> {
  const { uninstallSourceRegistryVersionStateLeaf } = await import("./handlers/state");
  return uninstallSourceRegistryVersionStateLeaf(...args);
}
