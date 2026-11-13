// ---------------------------------------------------------------------------
// ActionResult — the action-handler return-shape ADT (Phase 13a-1).
//
// Surfaces the ActionResult ADT declared in fenel/modules/core/action-result.fenel
// through the engine catalog so:
//   - Fenel bodies in forms / inventory / purchases / payments / profiles /
//     imports can return ActionOk / ActionErr constructors directly.
//   - The constructor picker / type-catalog / self-host matrix all see the
//     ADT as first-class.
// The TS-side adapter at core/src/actions/registry.ts:actionResultAdtToTs
// translates the ADT shape to the existing ActionResult TS interface
// (backward-compat for downstream consumers).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import ACTION_RESULT_FENEL from "../../../../../fenel/modules/core/action-result.fenel?raw";

// This projection is itself part of SYSTEM_REGISTRY_MODULES, which backs the
// default Fenel parser on cache misses. Parse through the sanctioned bootstrap
// mirror so module initialization cannot re-enter that still-initializing
// profile. The exported module stays an ordinary data-only object: strict
// registry ingestion never has to invoke an accessor supplied by a module.
const adtModule = loadFenelModule(ACTION_RESULT_FENEL, "core-action-result", {
  bootstrapParser: "typescript",
});

export const actionResultModule: FenelModule = {
  name: "action-result",
  label: "Action Result",
  functions: [],
  instances: [],
  entities: adtModule.entities ?? [],
};
