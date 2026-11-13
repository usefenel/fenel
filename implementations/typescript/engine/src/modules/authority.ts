// ---------------------------------------------------------------------------
// Authority — the seam for `fenel/modules/authority/authority.fenel`.
//
// rights R2a. This module carries THE authority judgment (`authority:permits`),
// its admission predicate, and the envelope constructors this phase ships. It
// is prepended to EVERY registry by `createRegistry`, because `perform` is
// fail-closed and a registry whose checker is unresolvable refuses every act.
//
// There is no `ffi/` leaf and there are no natives: the whole module is pure
// Fenel over `std`. That is the point — the reference monitor's judgment must
// not be able to reach a host act, and the smallest way to guarantee that is
// for it to have no host implementation of its own.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import AUTHORITY_FENEL from "../../../../../fenel/modules/authority/authority.fenel?raw";

const loaded = loadFenelModule(AUTHORITY_FENEL, "authority", { label: "Authority" });

export const authorityModule: FenelModule = loaded;

/** The one judgment `perform` consults. Exported as a constant so the gate, the
 *  kernel-frame allowlist and the audit rule all spell it once. */
export const AUTHORITY_PERMITS_ID = "authority:permits";

/** Every `authority:` function the host mint seam is allowed to invoke.
 *
 *  ⚠ ENFORCED (rights R2b). Until R2b this constant was exported and read by
 *  NOTHING — `evaluateAuthorityFunction` checked only the `authority:` prefix,
 *  so every body in the policy module was a host-reachable entry point,
 *  including the internal shape predicates and the recursion helpers.
 *  `registry.ts` now consults this list. A new entry is a new host-reachable
 *  policy entry point; add it deliberately.
 *
 *  The checker's OWN internal calls are not affected: they resolve through the
 *  kernel frame's `getFunction`, which admits every requires-free `authority:` /
 *  `std:` body. The allowlist governs what the HOST may ask for. */
export const AUTHORITY_SEAM_FUNCTION_IDS = Object.freeze([
  "authority:permits",
  "authority:envelopeWellFormed",
  "authority:mintRefusalReason",
  "authority:topIssuerRefusalReason",
  "authority:descriptorEnvelope",
  "authority:identityRealmDescriptors",
  "authority:sessionLeafDescriptors",
  "authority:membershipLeafDescriptors",
  "authority:membershipRoleArguedDescriptors",
  "authority:membershipDeleteDescriptors",
  "authority:membershipModuleDescriptors",
  "authority:membershipReadDescriptors",
  "authority:accountArguedStateDescriptors",
  "authority:discoveryDescriptors",
  "authority:acquisitionDescriptors",
  "authority:acquisitionFormsClosureDescriptors",
  "authority:outboundFetchDescriptors",
  "authority:knownRoles",
  "authority:storageReadMethods",
  "authority:topEnvelope",
  "authority:emptyEnvelope",
  "authority:roleEnvelope",
  "authority:acquisitionEnvelope",
  "authority:identityRealmEnvelope",
] as const);
