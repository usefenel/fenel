// signature-substrate slice 3j1 (§6-1) — THE STRICT REPOSITORY-REGISTRY SENTINEL.
//
// WHY THIS FILE EXISTS. Slice 3j added a named field to a Fenel ADT
// (`PrimitiveRootRow.refutations`) without regenerating the field-identity
// chain, and shipped it under FOUR green gates. The result-review reproduced
// the break in one line:
//
//   createRepositoryRegistry([engineModule])
//     -> FieldIdentityKernelError: missing embedded repository lock row
//        "field:type%3Aengine%3APrimitiveRootRow/named%3Arefutations"
//
// None of the gates could see it, and the reason is NOT "everything is
// memoized" (the first diagnosis, corrected in the 3j handoff §2):
//
//   * `tsc` executes no registry at all;
//   * `audit-effects` uses a cached `getSystemRegistry()` whose strict profile
//     EXCLUDES the full `engineModule`;
//   * the signature suites use a cached BOOTSTRAP registry, which skips
//     field-identity normalization entirely.
//
// So the missing check was specific: **nothing in the gate constructed a
// strict REPOSITORY registry containing the changed module.** This file is
// that construction, and nothing else.
//
// PROCESS FRESHNESS IS LOAD-BEARING. `createRegistry`'s field-identity work is
// memoized per process on `(cacheKey, mode, module identities)`
// (`registry.ts:1313-1323` `fieldMemoKey`). A registry constructed inside a
// suite that already built the same combination proves nothing about a cold
// build. This file therefore imports only what it needs and is invoked by CI
// AS ITS OWN `bun test` target — CI names test files individually and does NOT
// discover them, so a differently-named file, or this one committed without
// the workflow line, is a green gate over an absent sentinel.
//
// NON-VACUITY, and how it is established. This assertion has ALREADY FAILED in
// anger — the 3j landing is the demonstration, and an observed real failure is
// stronger evidence than a synthetic mutation. What a synthetic mutation WOULD
// add is coverage of one further class: the constructor silently degrading to a
// permissive realm, under which `(a)` would pass while checking nothing. A
// second `createRepositoryRegistry` call costs ~5 min of the same cold build,
// so that class is covered PARTIALLY instead, by reading the CONSTRUCTED
// registry: the field-identity pass must have run to completion (every named
// field resolved to a canonical UUID handle) and the specific row whose absence
// broke 3j is pinned by owner and field name. Stated honestly, that does NOT
// prove `strict-embedded` specifically — `collect-requirements` also resolves
// every key when the lock is complete — so the residual class is "the
// constructor was switched to a permissive realm", and it is recorded here
// rather than silently claimed closed.

import { describe, expect, it } from "bun:test";

import { engineModule } from "./modules/engine";
import { createRepositoryRegistry } from "./repository-registry";

describe("strict repository registry — the field-identity sentinel", () => {
  it("(a) constructs a strict repository registry over engineModule", () => {
    // The exact reproduction from the 3j result review. A missing lock row for
    // ANY declaration reachable from this module is fatal here and invisible
    // everywhere else in the gate.
    const registry = createRepositoryRegistry([engineModule]);
    expect(registry).toBeTruthy();
    expect(typeof registry.evaluateContext).toBe("function");

    // The strict pass RAN and produced the normalized view the product reads.
    const identities = registry.listFieldIdentities();
    expect(identities.length).toBeGreaterThan(0);

    // Every named field carries a resolved canonical UUID handle.
    //
    // READ THIS FOR WHAT IT SHOWS, not for more. It shows the field-identity
    // pass ran to completion and resolved every key — it does NOT prove
    // `strict-embedded` specifically, because `collect-requirements` also emits
    // UUIDs when the lock happens to be complete. The claim this file makes is
    // the one `(a)` demonstrates empirically: this construction THREW in 3j on
    // a missing lock row. A dedicated strict-mode fixture would cost a second
    // ~5-minute cold build; the trade is recorded rather than hidden.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const unresolved = identities
      .filter((identity) => identity.field.key.$tag === "NamedField")
      .filter((identity) => {
        const key = identity.field.key as { $tag: "NamedField"; ref: { $ref: string } };
        return !uuid.test(key.ref.$ref);
      })
      .map((identity) => identity.qualifiedName);
    expect(unresolved).toEqual([]);

    // The 3j row itself: `PrimitiveRootRow.refutations` is the field whose
    // missing lock row threw under four green gates. The FIELD NAME is matched
    // exactly and only the owner is matched by substring — a first attempt at a
    // fully exact owner pin guessed the wrong `FieldOwner` tag (`TypeOwner`; the
    // real union is `TypeFieldOwner | FunctionFieldOwner |
    // InlineNominalFieldOwner`) and `tsc` caught it, which is the same lesson
    // this slice learned the expensive way elsewhere.
    const pinned = identities.filter(
      (identity) => identity.field.name === "refutations"
        && identity.qualifiedName.includes("PrimitiveRootRow"),
    );
    expect(pinned.length).toBeGreaterThan(0);
  }, 900_000);
});
