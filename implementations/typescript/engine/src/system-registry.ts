// ---------------------------------------------------------------------------
// System registry — the function/entity catalog that backs validation and
// dependent-type evaluation in non-runtime contexts (api, core, frontend).
//
// The runtime (implementations/typescript/runtime) builds its own registry that ALSO registers
// IO handlers and provider handlers — necessary for evaluating effectful
// expressions. Validation does not need those: type definitions are pure
// by design (see `pureEvaluateContext`), and `validateForm({ functions })`
// only resolves `call` / `pipe` / `apply` operators against pure function
// specs (body or native impl).
//
// Cached per-process. Per-account typeclass instances are picked up live
// through the shared `dispatchRegistry` argument, so per-account Codeable /
// Labelable / Categorizable additions are visible without invalidating
// this cache.
// ---------------------------------------------------------------------------

import { type ModuleRegistry } from "./registry";
import { createRepositoryRegistry } from "./repository-registry";
import { dispatchRegistry } from "./system-entities";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import type { EvaluateContext } from "./json-logic";
import type { FenelFunction } from "./types";

let cachedRegistry: ModuleRegistry | null = null;

export function getSystemRegistry(): ModuleRegistry {
  if (!cachedRegistry) {
    cachedRegistry = createRepositoryRegistry(
      SYSTEM_REGISTRY_MODULES,
      { dispatchRegistry },
    );
  }
  return cachedRegistry;
}

/** The already-built system registry, or null when none exists yet. Peek-only:
 * callers that merely want to CONSULT the repository view (catalog name
 * resolution, marshal-time identified substitution) must not trigger — or
 * re-enter — registry construction. */
export function peekSystemRegistry(): ModuleRegistry | null {
  return cachedRegistry;
}

/**
 * The system function registry exposed as an `EvaluateContext` — for callers
 * outside the runtime (validation, dependent-type checks, hint generation)
 * who need to resolve `call` / `pipe` / `apply` operators in JSON Logic
 * without standing up their own `createRegistry()`.
 *
 * Combine with `pureEvaluateContext()` before passing to
 * `validateForm({ functions })` — type definitions are pure by design,
 * so IO functions must be filtered out.
 */
export function getSystemEvaluateContext(): EvaluateContext {
  return getSystemRegistry().evaluateContext();
}

/**
 * Overlay user-defined functions on top of a base `EvaluateContext`. User
 * functions take precedence — `{ call: ["fnId", ...] }` resolves the user
 * spec first, falling back to the base context (typically the system one).
 *
 * Per-request use case: a route handler loads user functions for the
 * current account from the DB, overlays them on `getSystemEvaluateContext()`,
 * and passes the result to `validate(type, value, { functions: ctx })`.
 *
 *   const sys = getSystemEvaluateContext();
 *   const ctx = overlayUserFunctions(sys, userFns);
 *   validate(type, value, { functions: ctx });
 *
 * Lookup by `fn.id` — matches whatever name the call expression uses.
 * Codename reverse lookup falls through to the base context, so users can
 * still call system functions by codename in the same expression.
 */
export function overlayUserFunctions(
  baseCtx: EvaluateContext,
  userFunctions: readonly FenelFunction[],
): EvaluateContext {
  if (userFunctions.length === 0) return baseCtx;
  const userFnMap = new Map<string, FenelFunction>();
  for (const fn of userFunctions) {
    if (fn.id) userFnMap.set(fn.id, fn);
  }
  return {
    // Preserve the complete live frame. Landing 1's protected native
    // descriptors need the private perform handle, envelope, dispatch registry,
    // and residency index just as system functions do; projecting only
    // `natives` + `getFunction` silently stripped that exercise authority from
    // user-authored bodies.
    ...baseCtx,
    getFunction: (name) => userFnMap.get(name) ?? baseCtx.getFunction?.(name),
  };
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("system-registry") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_system_registry from "./system-registry";
import { registerEngineModule as __reg_system_registry } from "./engine-require";
__reg_system_registry("system-registry", __self_system_registry);
