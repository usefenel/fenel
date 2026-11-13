import type { FenelModule } from "./types";
import { modulesFor } from "./module-manifest";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";

/** The anonymous projected workspace model's modules: the seed modules the
 * SYSTEM registry also loads, as the original seed objects in seed order. The
 * SYSTEM profile selects the smaller dependency surface; its extra modules
 * must not introduce candidates absent from the complete detached
 * repository's name routing. One owner for the browser model
 * (`workspace-model-modules.ts`) and the replay recorder's `projected`
 * profile, so both build the same registry. */
export function projectedWorkspaceModules(): FenelModule[] {
  return modulesFor("seed").filter(module => SYSTEM_REGISTRY_MODULES.some(system => system.name === module.name));
}
