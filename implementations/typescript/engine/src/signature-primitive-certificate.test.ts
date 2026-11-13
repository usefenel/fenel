// ---------------------------------------------------------------------------
// signature-primitive-certificate.test.ts — P4-D5 primitive roots.
//
// SLICE 2b SCOPE: the PRE-VERIFICATION root inventory only. Manifest
// authority, the private issuer brand, claim authentication, composite
// native+fallback verification, and handler epochs are slice-3 additions to
// this file (they are authority machinery; the inventory deliberately runs
// BEFORE any certificate is consulted).
//
// The property under test is the anti-circularity one: a row's classification
// is computed from inventory facts ALONE, so no root can end up "eligible only
// because a certificate happened to verify".
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import {
  dispatchedPrimitiveRootInventory,
  type PrimitiveRootRowInput,
} from "./engine-bodies-dispatch";

const base: PrimitiveRootRowInput = {
  functionId: "std:example",
  origin: "HostNative",
  tier: "natives",
  key: "std:example",
  handlerInstalled: false,
  bodyPresent: false,
  groundScheme: true,
  requires: [],
  refutations: [],
  attested: true,
  attestedPure: true,
  attestedTotal: true,
  attestedHonest: true,
};

const row = (overrides: Partial<PrimitiveRootRowInput>): PrimitiveRootRowInput =>
  ({ ...base, ...overrides });

type Classified = {
  functionId: string;
  classification: { $tag: string; reason?: { $tag: string }; policy?: Record<string, unknown> };
};

function inventory(rows: readonly PrimitiveRootRowInput[]): {
  rows: readonly Classified[];
  convertToFenel: number;
  rootRequired: number;
  fenced: number;
} {
  return dispatchedPrimitiveRootInventory("TEST", rows) as never;
}

const classify = (input: Partial<PrimitiveRootRowInput>): Classified["classification"] =>
  inventory([row(input)]).rows[0]!.classification;

describe("P4-D5 root inventory — the pre-verification partition", () => {
  // TIMEOUT, and it is PRE-EXISTING (verified at the slice-3j1 entry pin
  // `8b77a476`: 17 pass / 1 fail, this test, the same 5 s default). It is the
  // FIRST test in the file to dispatch an engine body, so it pays the cold
  // registry-warm cost — ~6.7 s measured on a Windows host against bun's 5 s
  // default. Nothing about the assertion is slow; the bound is generous on
  // purpose, to stop a hang rather than to police duration. A test that fails
  // because it went first trains the next session to ignore the file.
  it("an attested ground native is RootRequired with an admissible claim policy", () => {
    const classification = classify({});
    expect(classification.$tag).toBe("VrcRootRequired");
    const policy = classification.policy as Record<string, unknown>;
    expect(policy["$tag"]).toBe("ClaimAdmissible");
    // The policy STATES the claims that would be acceptable; it supplies no
    // authenticity or checker evidence of its own.
    expect(policy["requiredSignatureHonesty"]).toBe(true);
    expect(policy["requiredPurityEffect"]).toBe("pure");
    expect(policy["requiredTotality"]).toBe("total");
  }, 120_000);

  it("a declared external handler with no installed implementation is fenced", () => {
    // `ImplementationOrigin.ExternalHandler` does not prove a handler exists.
    // This is the live S3 counterexample class (the authoritative census
    // registries have EMPTY handler maps).
    const classification = classify({
      functionId: "ai:callLLM",
      origin: "ExternalHandler",
      tier: "handler",
      key: "ai.call",
      handlerInstalled: false,
    });
    expect(classification.$tag).toBe("VrcFenced");
    expect(classification.reason?.$tag).toBe("RsnMissingActiveHandler");
  });

  it("an installed external handler is classified on its claims, not its origin", () => {
    expect(
      classify({ origin: "ExternalHandler", handlerInstalled: true }).$tag,
    ).toBe("VrcRootRequired");
    expect(
      classify({ origin: "ExternalHandler", handlerInstalled: true, attested: false }).$tag,
    ).toBe("VrcFenced");
  });

  it("a native carrying an active Fenel body is ConvertToFenel, never a minted root", () => {
    const classification = classify({ origin: "NativeWithFallback", bodyPresent: true });
    expect(classification.$tag).toBe("VrcConvertToFenel");
  });

  it("a non-ground scheme fences (the primitive fragment is ground-only)", () => {
    const classification = classify({ groundScheme: false });
    expect(classification.$tag).toBe("VrcFenced");
    expect(classification.reason?.$tag).toBe("RsnUnsupportedRankOrKind");
  });

  it("an empty `requires` does NOT confer purity — only an attestation does", () => {
    // The S3 amendment: effective `requires` is NEGATIVE evidence only. A
    // bodyless root with no declared requires and no attestation stays fenced.
    const unattested = classify({ requires: [], attested: false });
    expect(unattested.$tag).toBe("VrcFenced");
    expect(unattested.reason?.$tag).toBe("RsnMissingPrimitiveCertificate");
  });

  it("each missing positive claim fences with its own exact reason", () => {
    expect(classify({ attestedPure: false }).reason?.$tag).toBe("RsnEffectfulScEff");
    expect(classify({ attestedTotal: false }).reason?.$tag).toBe("RsnTotalityUnknown");
    expect(classify({ attestedHonest: false }).reason?.$tag).toBe("RsnPrimitiveClaimMismatch");
  });

  it("an honestly effectful root never becomes a required root", () => {
    const classification = classify({
      requires: ["HasNetwork"], attestedPure: false,
    });
    expect(classification.$tag).toBe("VrcFenced");
    // the fence carries the effect closure that caused it
    expect((classification.reason as Record<string, unknown>)["requires"]).toEqual(["HasNetwork"]);
  });
});

// ---------------------------------------------------------------------------
// slice 3j (D5a-3) — NEGATIVE AUTHORITY PRECEDES EVERY POSITIVE CLAIM.
//
// Two holes were live before the `refutations` arm existed, and both were
// reachable with data the repository ALREADY carries. These are the fixtures
// for exactly those two, plus the marshal's fail-closed guard.
// ---------------------------------------------------------------------------
describe("P4-D5a claim policy — refutation outranks attestation", () => {
  it("a GENERATED WitnessedEscape refutation fences a fully attested root", () => {
    // THE LIVE OCCUPANT: `std:at` carries `WitnessedEscape` in BOTH profiles
    // (`signature-honesty-claims.json` — declared result `a`, out-of-range call
    // returns `null`). Before this arm, a mistaken attestation row for it
    // produced ClaimAdmissible for a signature the artifact mechanically
    // refutes, because the classifier never consulted the artifact at all.
    const classification = classify({
      functionId: "std:at",
      refutations: ["signature-honesty"],
      // every positive claim asserted — the attestation is maximal and WRONG
      attested: true, attestedPure: true, attestedTotal: true, attestedHonest: true,
    });
    expect(classification.$tag).toBe("VrcFenced");
    expect(classification.reason?.$tag).toBe("RsnPrimitiveClaimMismatch");
    expect(String((classification.reason as Record<string, unknown>)["detail"])).toContain(
      "signature-honesty",
    );
  });

  it("a committed hand-audit refutation fences a fully attested root", () => {
    // The other source: `std:replaceAll` is refuted on TOTALITY by an executed
    // in-domain witness (notes/phase-4-slice-3j-root-audit-std-replaceall.md —
    // three conforming Strings on which the native throws RangeError). The
    // policy must not care that this refutation came from a human rather than
    // from the detector.
    const classification = classify({
      functionId: "std:replaceAll",
      refutations: ["totality"],
      attested: true, attestedPure: true, attestedTotal: true, attestedHonest: true,
    });
    expect(classification.$tag).toBe("VrcFenced");
    expect(String((classification.reason as Record<string, unknown>)["detail"])).toContain(
      "totality",
    );
  });

  it("the refutation is read BEFORE any positive claim, not after", () => {
    // ORDERING IS THE CLAIM. A refuted root whose attestation is ALSO absent
    // must fence on the REFUTATION, not on the missing attestation — otherwise
    // the arm is only reached when everything else already passed, and a
    // contradictory register would still let attestation win wherever the
    // positive claims happen to be present.
    const bothWrong = classify({
      refutations: ["purity"],
      attested: false, attestedPure: false, attestedTotal: false, attestedHonest: false,
      groundScheme: false,
    });
    expect(bothWrong.reason?.$tag).toBe("RsnPrimitiveClaimMismatch");
    expect(String((bothWrong.reason as Record<string, unknown>)["detail"])).toContain("purity");
  });

  it("every refuted clause is named in the fence, not just the first", () => {
    const classification = classify({ refutations: ["purity", "totality", "signature-honesty"] });
    const detail = String((classification.reason as Record<string, unknown>)["detail"]);
    expect(detail).toContain("purity");
    expect(detail).toContain("totality");
    expect(detail).toContain("signature-honesty");
  });

  it("a refuted root that carries a Fenel body is still ConvertToFenel", () => {
    // The convert routing is UPSTREAM of the claim class and must stay there:
    // converting a refuted native to a Fenel body is the right answer, and
    // fencing it instead would lose that signal.
    expect(
      classify({ origin: "NativeWithFallback", bodyPresent: true, refutations: ["totality"] }).$tag,
    ).toBe("VrcConvertToFenel");
  });

  it("SENSITIVITY — an ABSENT clause returns the row to RootRequired (the pre-3j behaviour)", () => {
    // NOT a mutation test, and the distinction was a review finding. This
    // deletes the INPUT, not the CHECK, so it cannot show the arm is
    // load-bearing; a true check-deletion mutation is owed alongside the
    // producer.
    //
    // What it DOES show: with the clause absent, the maximally-attested row is
    // `VrcRootRequired` — exactly the pre-3j answer. So `std:at`, which the
    // generated honesty artifact marks `WitnessedEscape` in BOTH profiles,
    // would still classify admissible wherever an empty list is supplied.
    //
    // AND THE PRECISE STATUS, because an earlier version of this comment got it
    // wrong by calling the census harness "the production path". It is not.
    // TWO separate facts hold, and the second is the stronger one:
    //   (1) no PRODUCER exists — D5a-2 was cut, and the only non-test caller
    //       (the counterfactual census harness) passes `refutations: []`; and
    //   (2) no production CONSUMER is known to exist — a repo-wide
    //       direct-reference search finds that same harness as the only
    //       non-test caller, and it is a measurement instrument, not a product
    //       path. That is a MEASURED FACT, not a proof: the static gate's (e4)
    //       clause is a lexical marker scan over three roots and does not cover
    //       `api`/`core`/`db`/`bot` or computed dispatch.
    // Closing (1) alone would NOT close the holes. Wiring a register into the
    // harness and declaring victory is the trap; the successor's gate needs
    // CONSUMER REACHABILITY as well as producer completeness, witnessed
    // POSITIVELY from a named production entry point.
    // See `design/tcb-ledger.md` → `vlg.refutation.first` (SIDE-CONDITIONED).
    expect(classify({ functionId: "std:at", refutations: [] }).$tag).toBe("VrcRootRequired");
  });

  it("the marshal REFUSES an absent list and an unknown clause spelling", () => {
    // Fail-closed at the boundary. Defaulting an absent list to "unrefuted"
    // would turn a caller that forgot the field into a root the policy believes
    // nothing refutes; accepting `"totalty"` would let a typo read as a
    // refutation while refuting nothing checkable.
    const { refutations: _dropped, ...withoutField } = base;
    expect(() =>
      dispatchedPrimitiveRootInventory("TEST", [withoutField as PrimitiveRootRowInput]),
    ).toThrow(/no refutation list/);
    expect(() =>
      dispatchedPrimitiveRootInventory("TEST", [row({ refutations: ["totalty"] })]),
    ).toThrow(/unknown refutation clause/);
  });
});

describe("P4-D5 root inventory — exhaustive, order-independent accounting", () => {
  const population: readonly PrimitiveRootRowInput[] = [
    row({ functionId: "std:charCode" }),
    row({ functionId: "ai:callLLM", origin: "ExternalHandler", key: "ai.call", handlerInstalled: false }),
    row({ functionId: "std:twin", origin: "NativeWithFallback", bodyPresent: true }),
    row({ functionId: "std:poly", groundScheme: false }),
    row({ functionId: "std:effectful", requires: ["HasStateIO"], attestedPure: false }),
    row({ functionId: "std:unattested", attested: false }),
  ];

  it("every row lands in exactly one bucket and the totals equal the population", () => {
    const result = inventory(population);
    expect(result.rows).toHaveLength(population.length);
    expect(result.convertToFenel + result.rootRequired + result.fenced).toBe(population.length);
    expect(result.convertToFenel).toBe(1);
    expect(result.rootRequired).toBe(1);
    expect(result.fenced).toBe(4);
    for (const classified of result.rows) {
      expect(["VrcConvertToFenel", "VrcRootRequired", "VrcFenced"]).toContain(
        classified.classification.$tag,
      );
    }
  });

  it("classification is independent of row order", () => {
    const forward = inventory(population);
    const reversed = inventory([...population].reverse());
    const byId = (result: ReturnType<typeof inventory>): Record<string, string> =>
      Object.fromEntries(result.rows.map((r) => [r.functionId, r.classification.$tag]));
    expect(byId(reversed)).toEqual(byId(forward));
    expect(reversed.convertToFenel).toBe(forward.convertToFenel);
    expect(reversed.rootRequired).toBe(forward.rootRequired);
    expect(reversed.fenced).toBe(forward.fenced);
  });

  it("an empty inventory is a well-formed zero partition", () => {
    const result = inventory([]);
    expect(result.rows).toEqual([]);
    expect(result.convertToFenel + result.rootRequired + result.fenced).toBe(0);
  });
});
