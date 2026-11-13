// ---------------------------------------------------------------------------
// query — the live relational-query module (solver-extension Phase 4).
//
//   • bridge.fenel — 2 `@native` BRIDGE fns (`query:rel` / `query:relOne`) that
//     route a production query through the engine's CURATED dispatch harness
//     (`dispatchEngineBody` via the shipped `dispatchedQueryRel` /
//     `dispatchedQueryRelOne` wrappers), NOT the production registry —
//     sidestepping the `std:contains` vs `set:contains` codeName shadow that
//     breaks engine query bodies run directly in the prod registry (the Step-0
//     finding; `fenel/modules/query/ffi/query-ffi.ts` header). The ONLY new TS.
//   • orchestration.fenel — the body-bearing `query:queryEntities` /
//     `query:queryEntitiesOne` (+ the `materializeRelSpecs` helper) that fetch
//     each relSpec's rows via the existing `state:listInstancesByName` leaf,
//     assemble the relDef markers, and call the bridge. Lives HERE (not in the
//     pure-leaf `state` module) the way every consumer composes state leaves
//     from its own module.
//
// Thin seam (the crypto / dispatch template): load BOTH `.fenel` files (the
// "load each .fenel separately, then merge" pattern — concatenating source
// breaks parsing) + import the ffi leaf + route its sync natives via
// `rekeyNativesById` into `nativeImplsCtx`. CTX-ONLY: the natives ignore ctx;
// NO plain `nativeImpls`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { queryNativesCtx } from "../../../../../fenel/modules/query/ffi/query-ffi";
import QUERY_BRIDGE_FENEL from "../../../../../fenel/modules/query/bridge.fenel?raw";
import QUERY_ORCH_FENEL from "../../../../../fenel/modules/query/orchestration.fenel?raw";

// Declarative half — the `module query where` headers: bridge.fenel's 2
// `@native` foreign decls + orchestration.fenel's 2 body-bearing fns + helper
// (+ their per-fn Codeable / Labelable / Describable / Taggable / Categorizable
// identity instances). Loaded separately + merged (concatenating .fenel breaks
// parsing).
const bridge = loadFenelModule(QUERY_BRIDGE_FENEL, "query", { label: "Query (live relational solver)" });
const orch = loadFenelModule(QUERY_ORCH_FENEL, "query");

export const queryModule: FenelModule = {
  name: "query",
  label: "Query (live relational solver)",
  functions: [...(bridge.functions ?? []), ...(orch.functions ?? [])],
  instances: [...(bridge.instances ?? []), ...(orch.instances ?? [])],
  entities: [...(bridge.entities ?? []), ...(orch.entities ?? [])],
  // CTX-ONLY: the 2 bridge ctx natives → `nativeImplsCtx` (rekeyed short-suffix
  // → `query:<suffix>`); the orchestration fns are bodies (no natives).
  nativeImplsCtx: rekeyNativesById(queryNativesCtx, "query") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};
