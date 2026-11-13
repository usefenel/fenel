// ---------------------------------------------------------------------------
// representations-dispatch.test.ts — module-substrate Phase 3w,
// AMENDED BY rights R3a (2026-09-13).
//
// ⚠ WHAT THIS FILE USED TO PIN IS NOW WITHDRAWN, and that is the point of the
// amendment rather than a workaround. `engine:setRepresentation` is a dispatch
// REGISTRATION, so after R3a it is a mediated write whose owner is DERIVED from
// the writing frame's authenticated authority. `dispatchedSetRepresentation`
// takes no context — it calls `dispatchEngineBody` with no frame — so there is
// no account to derive and the write REFUSES. The old round-trip asserted the
// opposite and is now the negative that names the withdrawal, exactly as R3a
// withdrawal (c) did for `getFunctionByCodeName`.
//
// This is brief §12 trap 28, decided in advance: *"`setRepresentation` and the
// field-provider wrappers have no production caller — a later finding of one is
// R4's item, not a reason to add an `owner` parameter."* Re-verified here: the
// only non-test reference is the `index.ts` re-export.
//
// The ORIGINAL claim is kept, by the two halves that survive the fence:
//   * Phase 3v.6 Surprise #63 was that `setRepresentation`'s body passed a BARE
//     LIST `[targetId]` as the dispatchRegister key, which
//     `dispatchKeyToInstanceArgs` rejects, so the registration silently no-op'd.
//     The 3w fix flips it to the typed `ByType { target = targetId }` key. The
//     write cannot be driven any more, so that half is pinned on the BODY —
//     stated as a source assertion, not dressed up as behaviour.
//   * `getRepresentation` is a READ and is driven end to end, over a boot row.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dispatchedSetRepresentation,
  dispatchedGetRepresentation,
  dispatchedRepresentationsForTarget,
} from "./engine-bodies-dispatch";
import { dispatchRegistry } from "./system-entities";

// Synthetic class name — buckets by typeName in the dispatch registry, so a
// test-only name keeps the round-trip isolated from real Representational
// classes (Labelable / Iconable / …) and their enumeration walks.
const CLASS = "ReprRoundTripTest";

describe("Phase 3w — setRepresentation round-trips through dispatch (no-op fix)", () => {
  // rights R3a withdrawal (e).
  //
  // Neuter: make `registrationOwner` fall back to any constant account.
  // RED: the write goes through and the registry gains a row.
  test("R3a — a frameless setRepresentation REFUSES, and writes nothing", () => {
    const target = "ReprTarget.alpha";
    const before = dispatchRegistry.listInstances(CLASS).length;

    expect(() => dispatchedSetRepresentation(CLASS, target, { label: "Alpha" }))
      .toThrow(/account frame/);

    // NOT MERELY A THROW: the registry is untouched, and the read agrees.
    expect(dispatchRegistry.listInstances(CLASS)).toHaveLength(before);
    expect(dispatchedGetRepresentation(CLASS, target)).toBeUndefined();

    // …and the argued scope buys nothing — `"global"` refuses identically. The
    // caller cannot talk its way out of having no frame, which is the whole
    // ownership rule in one assertion.
    expect(() => dispatchedSetRepresentation(CLASS, target, { label: "Alpha" }, "global"))
      .toThrow(/account frame/);
    expect(dispatchRegistry.listInstances(CLASS)).toHaveLength(before);
  });

  // ⚠ SOURCE ASSERTION, SAID PLAINLY. Surprise #63's fix cannot be driven
  // through the wrapper any more, so this reads the body. It is weaker than the
  // round trip it replaces and is recorded as such.
  test("Phase 3w (structural) — the body still builds a TYPED ByType key", () => {
    const body = readFileSync(
      join(import.meta.dir, "../../../../fenel/modules/engine/identifiable.fenel"),
      "utf8",
    );
    const at = body.indexOf("setRepresentation typeName targetId");
    expect(at).toBeGreaterThan(-1);
    const decl = body.slice(at, at + 800);
    // the typed key, not the bare list that no-op'd
    expect(decl).toContain("ByType");
    expect(/dispatchRegister\s+\[\s*targetId\s*\]/.test(decl)).toBe(false);
  });

  test("getRepresentation reads a boot row end to end; enumeration does not throw", () => {
    const target = "ReprTarget.beta";
    // ⚠ WRITTEN AS A BOOT ROW. The mediated write path is withdrawn above; the
    // READ body is what this half was always testing, and it still runs.
    dispatchRegistry.addInstance({
      typeName: CLASS, args: [target], methods: { icon: "star" },
      scope: { kind: "global" },
    });
    expect(dispatchedGetRepresentation(CLASS, target)?.methods).toEqual({
      icon: "star",
    });
    // representationsForTarget only walks classes tagged Representational, so a
    // synthetic class won't surface there — but the by-target enumeration must
    // not throw for an untagged class.
    expect(() => dispatchedRepresentationsForTarget(target)).not.toThrow();
  });
});
