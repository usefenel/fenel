// Constraint providers — scoped structural dispatch facade.
//
// Registration, duplicate/conflict handling, selection, scalar batching, and
// successful-result merge are Fenel-owned in field-providers.fenel. This file
// is deliberately a thin host facade; the only semantic work left in TS is
// awaiting a provider's external async closure.

import {
  dispatchedConstraintFieldsFor,
  dispatchedGetConstraintBinding,
  dispatchedGetConstraintProvider,
  dispatchedHasConstraintBinding,
  dispatchedListConstraintBindings,
  dispatchedRegisterConstraintBinding,
  dispatchedRegisterConstraintBindings,
  dispatchedRegisterConstraintProvider,
  dispatchedResolveConstraint,
  dispatchedResolveConstraints,
  dispatchedUnregisterConstraintBinding,
  dispatchedUnregisterConstraintProvider,
} from "./engine-bodies-dispatch";
import type {
  ConstraintBinding,
  ConstraintProvider,
  ConstraintResolution,
  ProviderFieldTarget,
  ProviderLookupResult,
  ProviderRegistrationResult,
  ProviderScope,
} from "./types";

export type {
  ConstraintBinding,
  ConstraintProvider,
  ConstraintResolution,
  ProviderFieldTarget,
  ProviderScope,
};

export function registerConstraintProvider(
  scope: ProviderScope,
  provider: ConstraintProvider,
): ProviderRegistrationResult<ConstraintProvider> {
  return dispatchedRegisterConstraintProvider(scope, provider);
}

export function unregisterConstraintProvider(scope: ProviderScope, name: string): void {
  dispatchedUnregisterConstraintProvider(scope, name);
}

export function getConstraintProvider(
  scope: ProviderScope,
  name: string,
): ProviderLookupResult<ConstraintProvider> {
  return dispatchedGetConstraintProvider(scope, name);
}

export function registerConstraintBinding(
  binding: ConstraintBinding,
): ProviderRegistrationResult<ConstraintBinding> {
  return dispatchedRegisterConstraintBinding(binding);
}

export function registerConstraintBindings(
  bindings: ConstraintBinding[],
): ProviderRegistrationResult<ConstraintBinding>[] {
  return dispatchedRegisterConstraintBindings(bindings);
}

export function unregisterConstraintBinding(target: ProviderFieldTarget): void {
  dispatchedUnregisterConstraintBinding(target);
}

export function getConstraintBinding(
  target: ProviderFieldTarget,
): ProviderLookupResult<ConstraintBinding> {
  return dispatchedGetConstraintBinding(target);
}

export function listConstraintBindings(scope: ProviderScope): ConstraintBinding[] {
  return dispatchedListConstraintBindings(scope);
}

export function hasConstraintBinding(target: ProviderFieldTarget): boolean {
  return dispatchedHasConstraintBinding(target);
}

/** Identity-bearing introspection; readable field names are never returned. */
export function constraintFieldsFor(
  scope: ProviderScope,
  owner: string,
): ProviderFieldTarget[] {
  return dispatchedConstraintFieldsFor(scope, owner);
}

export const resolveConstraint = dispatchedResolveConstraint;
export const resolveConstraints = dispatchedResolveConstraints;

// Caching was deleted in the cutover. These remain explicit no-ops so callers
// do not infer that a hidden process-global cache still exists.
export function clearConstraintSessionCache(): void {}
export function clearAllConstraintCaches(): void {}
