import { projectedWorkspaceModules } from "../../../../../implementations/typescript/engine/src/projected-workspace-modules";

// The engine owns the selection (seed modules the SYSTEM registry also loads,
// in seed order), shared with the replay recorder's `projected` profile.
export const PROJECTED_WORKSPACE_MODULES = projectedWorkspaceModules();
