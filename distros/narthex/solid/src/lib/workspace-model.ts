// Browser transport and invocation boundary for view.WorkspacePreferences.
// Defaults, transitions, preference precedence and tiling are Fenel-bodied.
import { availableEarlyAuthoringRealm } from "./expression-runner/authoring-catalog-early-realm";
import { createRegistryPreparationHost, acquireRegistryPreparationWorker } from "../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import { Nothing, Just, peelMaybeValue } from "@fenel/engine/type-foundation";
import { DETACHED_AUTHORING_SESSION, type AuthoringSession } from "./expression-runner/authoring-session";
import { evaluateContextForCatalog } from "./expression-runner/authoring-catalog";
import { createRepositoryRegistry, createRepositoryRegistryAsync } from "@fenel/engine/repository-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { PROJECTED_WORKSPACE_MODULES } from "./workspace-model-modules";
import { mintAnonymousAuthority } from "../../../../../implementations/typescript/runtime/src/authority-mint";
import { withinWorkspaceLimit } from "./workspace-module-preload";
import { workspaceProjectionModelFor } from "./workspace-projection-model";
import type { LocusLayoutChoice } from "./locus-layout-options";
import { layoutFromWorkspaceCode, type WorkspacePreferences, type WorkspaceCommand, type WorkspacePresentation } from "./workspace-wire";
export * from "./workspace-wire";

function workspaceModelFor(read: () => Pick<AuthoringSession, "registry" | "evaluateContext">) {
  const { workspaceCall, sourceTypeReference, allDataRootTypes, allDataRootDescriptions } = workspaceProjectionModelFor(read);

  function applyWorkspace(workspace: WorkspacePreferences, commands: readonly WorkspaceCommand[]): WorkspacePreferences {
    const result = workspaceCall<unknown>("applyWorkspaceCommands", workspace, commands);
    const verdict = result as { $tag?: string; _0?: unknown };
    if (verdict?.$tag !== "Ok") throw new Error(String(verdict?._0 ?? "Could not update the workspace."));
    return verdict._0 as WorkspacePreferences;
  }

  function defaultWorkspace(accountId?: string): WorkspacePreferences {
    return workspaceCall("workspaceDefaultForAccount", crypto.randomUUID(), accountId ? Just(accountId) : Nothing);
  }

  function workspaceLayout(presentation: WorkspacePresentation): LocusLayoutChoice | undefined {
    const code = workspaceCall<string>("workspacePresentationCode", presentation);
    return layoutFromWorkspaceCode(code);
  }

  function workspacePresentation(kind: LocusLayoutChoice): WorkspacePresentation {
    const result = workspaceCall<{ $tag: string; _0: unknown }>("workspacePresentationFromCode", kind);
    if (result.$tag !== "Ok") throw new Error(String(result._0));
    return result._0 as WorkspacePresentation;
  }

  function workspaceValueType() {
    const handle = read().registry.getUuid("WorkspacePreferences");
    if (!handle) throw new Error("The WorkspacePreferences type has no repository identity.");
    return { $ref: handle };
  }

  function readWorkspaceValue(value: unknown): WorkspacePreferences | undefined {
    return peelMaybeValue(workspaceCall("workspacePreferencesFromValue", value)) as WorkspacePreferences | undefined;
  }
  return Object.freeze({ workspaceCall, sourceTypeReference, applyWorkspace, defaultWorkspace, workspaceLayout, workspacePresentation,
    workspaceValueType, allDataRootTypes, allDataRootDescriptions, readWorkspaceValue });
}

const detached = workspaceModelFor(() => DETACHED_AUTHORING_SESSION);
export const { workspaceCall, sourceTypeReference, applyWorkspace, defaultWorkspace, workspaceLayout, workspacePresentation,
  workspaceValueType, allDataRootTypes, allDataRootDescriptions, readWorkspaceValue } = detached;

/** The projected model also publishes its checked registry for repository-only
 * readers (sign-in and profile forms) that need no Local or account data. */
export type ProjectedWorkspaceModel = typeof detached & { readonly checkedRegistry: ModuleRegistry };

const projectedPreparationHost = createRegistryPreparationHost(async () => {
  if (availableEarlyAuthoringRealm()) {
    const workers = await import("./expression-runner/authoring-catalog-worker");
    const lease = workers.acquireEarlyLocalEnginePreparation();
    if (lease) return lease;
  }
  return acquireRegistryPreparationWorker();
});
let projectedPreparation: Promise<ProjectedWorkspaceModel> | undefined;

/** Literal server projections use the checked seed/system intersection.
 * Its pure preference helpers run in an anonymous repository frame; account
 * functions, source modules and reader authority never enter this model. */
export function prepareProjectedWorkspaceModel(options: { preparation?: "inline" } = {}): Promise<ProjectedWorkspaceModel> {
  if (!projectedPreparation) {
    // A waiting deadline cannot cancel checked registry construction. Retain
    // that work so Retry cannot overlap another registry and its worker.
    const preparing = (async () => {
      const registry = options.preparation === "inline"
        ? createRepositoryRegistry(PROJECTED_WORKSPACE_MODULES, { dispatchRegistry })
        : await createRepositoryRegistryAsync(PROJECTED_WORKSPACE_MODULES, { dispatchRegistry, preparationHost: projectedPreparationHost });
      const evaluateContext = Object.freeze({ ...evaluateContextForCatalog(registry),
        _authority: mintAnonymousAuthority(registry), _dictStack: [], _activeTags: [], _importStack: [],
      });
      return Object.freeze({ ...workspaceModelFor(() => ({ registry, evaluateContext })), checkedRegistry: registry });
    })();
    projectedPreparation = preparing;
    void preparing.catch(() => { if (projectedPreparation === preparing) projectedPreparation = undefined; });
  }
  const preparing = projectedPreparation;
  return withinWorkspaceLimit("your lenses", () => preparing, undefined, "preparation");
}
