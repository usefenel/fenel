// ---------------------------------------------------------------------------
// Dashboard — orchestration + light-IO module (144 fns), fully `.fenel`.
//
// module-substrate Phase 3t (2026-06-01) — the single biggest module (144 fns,
// more than telegram's 53) migrated to the `module dashboard where` cross-file
// header UNION across 8 files. 3t.1 landed the 7 clean orchestration files (124
// fns); **3t.2 (this)** folds in `io.fenel` (the InvokeDecision-ADT decision
// bodies) + PORTS the lone native `maskCredentials` to a Fenel body
// (`std:entries` + `std:fold` + `std:mapSet`) — so `nativeImpls` collapses to
// `{}` (the telegram-3o end state). Every fn now carries its `name : Type` sig +
// `@facet` identity co-located with its body; the ~340-LOC TS spec-wrapper (8
// `loadFenelModule` calls + per-file `*Body` extraction + 144 `defineFunction`
// re-wraps + the maskCredentials native) collapses to ONE `loadFenelModuleUnion`
// call. `requires` INFERRED; Categorizable read-time (3j — category "dashboard"
// === the `dashboard:` id prefix).
//
// CLASSIFICATION (Surprise #48): dashboard is an ORCHESTRATION + light-IO module
// (the telegram-3o shape), NOT a 3k/3l capability module — ZERO capability /
// provider structure, ZERO `ioAction` / `credentialRequirements` facets (those
// words live only in description prose). The InvokeDecision ADT (io.fenel's
// top-level type decl) rides the union's `entities`. The runtime `invokeIOAction`
// dynamic-dispatch that EXECUTES the IO arm is a MARSHALLING BOUNDARY in the
// runtime, OUTSIDE this module (Surprise #47) — untouched; the Fenel side owns
// only the DECISION (the ADT).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import HELPERS_FENEL from "../../../../../fenel/modules/dashboard/helpers.fenel?raw";
import ROUTES_FENEL from "../../../../../fenel/modules/dashboard/routes.fenel?raw";
import PROFILES_FENEL from "../../../../../fenel/modules/dashboard/profiles.fenel?raw";
import REGISTRY_FENEL from "../../../../../fenel/modules/dashboard/registry.fenel?raw";
import IO_FENEL from "../../../../../fenel/modules/dashboard/io.fenel?raw";
import TCT_FENEL from "../../../../../fenel/modules/dashboard/dispatch-triggers-timeline.fenel?raw";
import SQV_FENEL from "../../../../../fenel/modules/dashboard/saved-queries-and-views.fenel?raw";
import STATS_FENEL from "../../../../../fenel/modules/dashboard/stats-and-activity.fenel?raw";

// The `dashboard` cross-file header UNION — all 8 files carry `module dashboard
// where`, so `loadFenelModuleUnion` GROUPS them into ONE `dashboard` module (OQ3
// — the header is identity, not the `name` arg). A duplicate top-level name
// across two files of the group is a load-time error (Haskell semantics). The
// InvokeDecision ADT (io.fenel) rides `entities`; the lone former native
// `maskCredentials` is now a Fenel body (helpers.fenel) → `nativeImpls` is `{}`.
const dashboardGroups = loadFenelModuleUnion([
  { src: HELPERS_FENEL, name: "dashboard" },
  { src: ROUTES_FENEL, name: "dashboard" },
  { src: PROFILES_FENEL, name: "dashboard" },
  { src: REGISTRY_FENEL, name: "dashboard" },
  { src: IO_FENEL, name: "dashboard" },
  { src: TCT_FENEL, name: "dashboard" },
  { src: SQV_FENEL, name: "dashboard" },
  { src: STATS_FENEL, name: "dashboard" },
]);
const dashboardUnionModule = dashboardGroups.find((m) => m.name === "dashboard");
if (!dashboardUnionModule) {
  throw new Error(
    "dashboard: loadFenelModuleUnion did not yield the `dashboard` group — every dashboard/*.fenel must carry `module dashboard where`",
  );
}

export const dashboardModule: FenelModule = {
  name: "dashboard",
  label: "Dashboard helpers",
  functions: dashboardUnionModule.functions ?? [],
  instances: dashboardUnionModule.instances ?? [],
  // InvokeDecision (io.fenel's top-level type decl) is the sole entity.
  entities: dashboardUnionModule.entities ?? [],
  // No TS natives survive — maskCredentials is a Fenel body now.
  nativeImpls: {},
};
