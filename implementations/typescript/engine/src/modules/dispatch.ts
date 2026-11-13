// ---------------------------------------------------------------------------
// Dispatch — module-substrate Phase 3i seam (CTX-ONLY).
//
// dispatch provides value-level polymorphic `sample` / `render` (dispatching on
// the runtime tag of args[0], driven by Sampleable / Renderable instances) plus
// the Fenel-callable scoped-instance-registry surface (register / lookup /
// lookupOne / lookupAll / listAllInstances / getClass) and the dashboard
// registry-enumeration reads. It is a CTX-ONLY module (no plain `nativeImpls`,
// like animation/track): 8 fns are backed by a ctx native; the other 5 are
// ioAction-only (runtime IO handler).
//
// This module must register **after** every modality so `sample` / `render`'s
// codeName overrides the modality-specific ones — SYSTEM_MODULES order is
// unchanged (the export name is preserved), so that ordering still holds.
//
// The ~654-LOC hand-assembled module (13 `defineFunction` specs + inline native
// impls + the lazyDispatchDeps cycle-break) is RETIRED. The source of truth is
// now:
//   - `fenel/modules/dispatch/types.fenel` — the `module dispatch where` header
//     + the 13 `@native` foreign declarations (with `@codeName` / `@ioAction` /
//     `@category "core"` where they diverge from the defaults);
//   - `fenel/modules/dispatch/ffi/dispatch-ffi.ts` — the 8 ctx native impls +
//     the `lazyDispatchDeps` require-cycle break (kept a lazy `require`);
//   - `fenel/modules/engine/dispatch.fenel` — UNCHANGED; the LookupResult ADT
//     (the dispatch-scoped ambiguity surface), loaded here for the entity.
//
// Thin seam: load types.fenel (decls) + engine/dispatch.fenel (LookupResult
// entity) + import the ffi leaf, route the ctx native map via
// `rekeyNativesById`, merge the LookupResult entity, re-export the
// pollySample/Render natives. No plain `nativeImpls` (ctx-only); no
// `@nativeCtx` marker (seam-routing suffices — axis #4).
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { dispatchNativesCtx, pollySampleNative, pollyRenderNative } from "../../../../../fenel/modules/dispatch/ffi/dispatch-ffi";
import DISPATCH_TYPES_FENEL from "../../../../../fenel/modules/dispatch/types.fenel?raw";
import DISPATCH_FENEL from "../../../../../fenel/modules/engine/dispatch.fenel?raw";
import DISPATCH_REGISTRATION_SCOPE_FENEL from "../../../../../fenel/modules/dispatch/registration-scope.fenel?raw";

// Declarative half — header + the 13 `@native` foreign declarations.
// `loaded.instances` holds the per-function identity ClassInstances (incl. the
// 9 IOInvokable for the ioAction-backed fns).
const loaded = loadFenelModule(DISPATCH_TYPES_FENEL, "dispatch", { label: "Dispatch" });

// The LookupResult ADT + (resolution-substrate Phase 5.1) the bare-name dispatch
// resolver — surfaced through the module's entity + function lists so the
// catalog / constructor picker see the ADTs and the registry registers the
// `dispatch:rsv*` resolver bodies. Loaded from engine/dispatch.fenel (the
// resolver's home — it folds over the `RoutingTable` value `registry.ts:
// routingTable()` projects). The compiled-or-interpreted Fenel resolver is live;
// the TS resolver remains its guarded fallback and parity oracle.
const dispatchFenelModule = loadFenelModule(DISPATCH_FENEL, "dispatch");

// rights R3a — the registration-scope DISPOSITION. `RegistrationScope` +
// `dispatch:registrationScope` are the ONE rule both mediated register paths
// consume; the natives on either side only marshal and decode.
//
// ⚠ A THIRD `.fenel` FILE IN THIS SEAM IS INVISIBLE UNTIL IT IS MERGED HERE
// (§12 trap 29). `loadFenelModule` alone registers nothing — the entities,
// functions, signature declarations and instances all have to be concatenated
// below, or the disposition simply has no body and both natives REFUSE. That
// refusal is loud precisely because it refuses rather than defaulting.
const dispatchRegistrationScopeModule = loadFenelModule(
  DISPATCH_REGISTRATION_SCOPE_FENEL, "dispatch",
);

const dispatchEntities = [
  ...(loaded.entities ?? []),
  ...(dispatchFenelModule.entities ?? []),
  ...(dispatchRegistrationScopeModule.entities ?? []),
];
const dispatchFunctions = [
  ...(loaded.functions ?? []),
  ...(dispatchFenelModule.functions ?? []),
  ...(dispatchRegistrationScopeModule.functions ?? []),
];
const dispatchFunctionSignatureDeclarations = [
  ...(loaded.functionSignatureDeclarations ?? []),
  ...(dispatchFenelModule.functionSignatureDeclarations ?? []),
  ...(dispatchRegistrationScopeModule.functionSignatureDeclarations ?? []),
];
const dispatchInstances = [
  ...(loaded.instances ?? []),
  ...(dispatchFenelModule.instances ?? []),
  ...(dispatchRegistrationScopeModule.instances ?? []),
];

export const dispatchModule: FenelModule = {
  ...loaded,
  entities: dispatchEntities,
  functions: dispatchFunctions,
  functionSignatureDeclarations: dispatchFunctionSignatureDeclarations,
  instances: dispatchInstances,
  // CTX-ONLY: the 8 ctx natives → `nativeImplsCtx`; NO plain `nativeImpls`.
  // Rekeyed short-fnId-suffix → `dispatch:<suffix>` (the codeName is a separate
  // longer string for 6 of them — see types.fenel @codeName).
  nativeImplsCtx: rekeyNativesById(dispatchNativesCtx, "dispatch") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the polymorphic dispatch natives — preserved from the retired seam.
export { pollySampleNative, pollyRenderNative };

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/dispatch") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_dispatch from "./dispatch";
import { registerEngineModule as __reg_modules_dispatch } from "../engine-require";
__reg_modules_dispatch("modules/dispatch", __self_modules_dispatch);
