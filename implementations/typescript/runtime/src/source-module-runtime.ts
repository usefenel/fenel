// Lazy installation bridge: validate against the same durable registry profile
// without executing a function or publishing any registry.
import type { AccountFieldDefinitionGraph } from "@fenel/engine/field-authoring";
import type { InstalledSourceModuleRow } from "@fenel/engine/authoring/source-module";
export {
  loadAccountSourceModulesState,
  getSourceRegistryByIdState,
  listVisibleSourceRegistriesState,
  publishSourceRegistryVersionState,
  installSourceRegistryVersionState,
  uninstallSourceRegistryVersionState,
} from "./state-source-modules";

export async function validateSourceModuleInstallation(
  accountId: string,
  graph: AccountFieldDefinitionGraph,
  rows: readonly InstalledSourceModuleRow[],
  candidateId: string,
) {
  const runtime = await import("./evaluator");
  return runtime.validateSourceModuleInstallation(accountId, graph, rows, candidateId);
}
