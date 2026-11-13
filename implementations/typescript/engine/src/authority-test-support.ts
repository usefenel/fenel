// ---------------------------------------------------------------------------
// Test-only authority helpers.
//
// `design/ts-exceptions-ledger.md` § test/tooling. Nothing here is imported by
// product code, and `audit-effects.ts`'s `authority-minter-sites` rule allows
// the `"test"` issuer literal only in this file and in `*.test.ts` /
// `*.fixture.ts`.
//
// ⚠ THESE HELPERS JUDGE THROUGH THE REAL BODY. A test fixture that built its
// own perform table used to need no judgment at all; now it needs one, and the
// tempting shortcut is a hand-written TypeScript stand-in. That stand-in would
// be a second checker whose agreement with the shipped one nobody pins, so
// every fixture below borrows `registry.performJudge` instead.
//
// There is deliberately NO "permit everything" helper: `EvTop` is refused for
// every issuer but `registry-bootstrap`, and a test that wants a permissive
// frame uses `registry.evaluateContext()` — the bootstrap authority — or names
// the descriptors it expects to reach.
// ---------------------------------------------------------------------------

import { createRegistry, type ModuleRegistry } from "./registry";
import { dispatchModule } from "./modules/dispatch";
import { stdModule } from "./modules/std";
import { mintAuthority, type AuthorityRef } from "./authority";
import { createPerformTableController, type PerformTableController } from "./perform";

let sharedKernel: ModuleRegistry | undefined;

/** A minimal registry whose only job is to carry the authority module, so a
 *  fixture that needs a judge and a mint does not have to build the system
 *  registry. Shared across a test file because building one costs real time. */
export function authorityTestKernel(): ModuleRegistry {
  if (sharedKernel === undefined) sharedKernel = createRegistry([stdModule]);
  return sharedKernel;
}

/** A standalone perform table judged by the real `authority:permits`. */
export function testPerformTable(
  registry: ModuleRegistry = authorityTestKernel(),
): PerformTableController {
  return createPerformTableController({ judge: registry.performJudge });
}

/** Mint a `test`-issuer authority over an explicit Fenel envelope value. */
export function mintTestAuthority(
  envelope: unknown,
  registry: ModuleRegistry = authorityTestKernel(),
): AuthorityRef {
  return mintAuthority(registry, {
    envelope,
    issuer: "test",
    accountId: null,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

/** The one-row envelope over an explicit descriptor enumeration. */
export function testDescriptorEnvelope(
  descriptors: readonly string[],
  registry: ModuleRegistry = authorityTestKernel(),
): unknown {
  return registry.evaluateAuthorityFunction("authority:descriptorEnvelope", [[...descriptors]]);
}

/** rights R3a — a `test`-issuer authority that NAMES AN ACCOUNT.
 *
 *  The ownership coordinate is DERIVED from `authenticateAuthority(...)
 *  .accountId`, so a frame that is going to WRITE a dispatch instance needs an
 *  authority whose record names one. `mintTestAuthority` deliberately names
 *  `null` (the no-account case, which the register natives refuse), so this is
 *  its sibling rather than a parameter on it: the two are used to test opposite
 *  outcomes and conflating them makes a refusal pin look like a permission pin. */
export function mintTestAuthorityForAccount(
  accountId: string,
  envelope: unknown,
  registry: ModuleRegistry = authorityTestKernel(),
): AuthorityRef {
  return mintAuthority(registry, {
    envelope,
    issuer: "test",
    accountId,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

let sharedDispatchKernel: ModuleRegistry | undefined;

/** rights R3a — a registry that can BOTH mint and resolve the registration
 *  disposition. The register natives call `dispatch:registrationScope` through
 *  the caller's own evaluation context, so a fixture frame that cannot resolve
 *  that name does not write at all — which is the decode's fail-closed rule,
 *  not a fixture bug. */
export function dispatchTestKernel(): ModuleRegistry {
  if (sharedDispatchKernel === undefined) {
    sharedDispatchKernel = createRegistry([stdModule, dispatchModule]);
  }
  return sharedDispatchKernel;
}

/** rights R3a — an evaluation frame that derives `accountId` and can resolve the
 *  Fenel registration disposition. `_specRegistry` selects which dispatch pool
 *  the natives read and write. */
export function accountDispatchFrame(
  accountId: string,
  specRegistry?: unknown,
): Record<string, unknown> {
  const kernel = dispatchTestKernel();
  const frame: Record<string, unknown> = {
    ...kernel.evaluateContext(),
    _authority: mintTestAuthorityForAccount(
      accountId,
      testDescriptorEnvelope([], kernel),
      kernel,
    ),
  };
  if (specRegistry !== undefined) frame["_specRegistry"] = specRegistry;
  return frame;
}

/** Mint an authority that permits exactly these descriptors and nothing else. */
export function mintTestAuthorityFor(
  descriptors: readonly string[],
  registry: ModuleRegistry = authorityTestKernel(),
): AuthorityRef {
  return mintTestAuthority(testDescriptorEnvelope(descriptors, registry), registry);
}

/** Mint the empty authority — every act is refused. */
export function mintTestAuthorityForNothing(
  registry: ModuleRegistry = authorityTestKernel(),
): AuthorityRef {
  return mintTestAuthority(
    registry.evaluateAuthorityFunction("authority:emptyEnvelope", [0]),
    registry,
  );
}
