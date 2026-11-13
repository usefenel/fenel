import { preloadWorkspaceModules, preloadWorkspaceSlice } from "./workspace-module-preload";

export type WorkspaceModel = typeof import("./workspace-model");
let pending: Promise<WorkspaceModel> | undefined;
let projected: Promise<WorkspaceModel & import("./workspace-model").ProjectedWorkspaceModel> | undefined;

/** The checked system-profile registry of the projected model. Repository-only
 * forms read their types here instead of preparing the complete seed session. */
export async function loadProjectedWorkspaceRegistry() {
  return (await loadWorkspaceModel({ projected: true }) as Awaited<NonNullable<typeof projected>>).checkedRegistry;
}

/** The initial workspace can use its server-checked projection while the
 * complete browser model prepares. Failure leaves the next request retryable. */
export function loadWorkspaceModel(options: { projected?: boolean; preparation?: "inline" } = {}): Promise<WorkspaceModel> {
  if (options.projected) {
    if (projected) return projected;
    const loading = (async () => {
      await preloadWorkspaceModules();
      const model = await preloadWorkspaceSlice("your lenses", () => import("./workspace-model"));
      const ready = await model.prepareProjectedWorkspaceModel({ preparation: options.preparation });
      return { ...model, ...ready };
    })();
    projected = loading;
    void loading.catch(() => { if (projected === loading) projected = undefined; });
    return loading;
  }
  if (pending) return pending;
  const loading = (async () => {
    await preloadWorkspaceModules();
    const [model, authoring] = await preloadWorkspaceSlice("your lenses", () => Promise.all([
      import("./workspace-model"), import("./expression-runner/authoring-session"),
    ]));
    await authoring.prepareDetachedAuthoringSession();
    return model;
  })();
  pending = loading;
  void loading.catch(() => { if (pending === loading) pending = undefined; });
  return loading;
}
