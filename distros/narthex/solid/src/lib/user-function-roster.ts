import type { FenelFunction } from "@fenel/engine/types";

/** Provenance is on the API row, outside the persisted function definition. */
export type AccountFunctionRow = {
  function: FenelFunction;
  isSystem?: boolean;
  sourceRegistryId?: string | null;
};

/** Repository source supplies its own authoritative schemes. Its seeded or
 * synthesized API rows are presentation copies, not account declarations.
 * System actions absent from this browser's repository profile remain callable
 * through the existing account roster; an isSystem flag alone never drops them.
 */
export function accountFunctionRows<T extends AccountFunctionRow>(
  rows: readonly T[],
  repositoryFunctionIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !row.sourceRegistryId
    && !(row.isSystem === true && repositoryFunctionIds.has(row.function.id)));
}

let repositoryIds: Promise<ReadonlySet<string>> | undefined;

/** The manifest is already the seed-profile ownership authority. Reading its
 * exact members does not build another registry or infer owners from id text. */
export async function repositoryFunctionIdsForAuthoring(): Promise<ReadonlySet<string>> {
  if (!repositoryIds) {
    repositoryIds = import("@fenel/engine/module-manifest").then(({ modulesFor }) =>
      new Set(modulesFor("seed").flatMap((entry) => (entry.functions ?? []).map((fn) => fn.id)))
    );
    void repositoryIds.catch(() => { repositoryIds = undefined; });
  }
  return new Set(await repositoryIds);
}
