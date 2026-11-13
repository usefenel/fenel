// rights R1 §8.13 — runner switched from `vitest` to `bun:test`.
//
// Probe 3 is now a NAMED CI step, and every other named test line in
// `.github/workflows/audit.yml` is a `bun test` invocation of ONE file.
// `vitest run <path>` takes that path as a SUBSTRING FILTER, not a file: on a
// working tree carrying `.tmp-dependency-refresh/solid-build-*/` scratch copies
// it ran THREE copies of this file (measured 2026-09-11), which is a gate whose
// subject depends on what else is lying around. `bun test <path>` runs exactly
// the file named. The file uses only `describe` / `expect` / `it`, which
// `bun:test` provides identically.
import { describe, expect, it } from "bun:test";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { Nothing } from "@fenel/engine/type-foundation";
import { registerStateHandlers } from "./handlers/state";
import { mintAuthority, type AuthorityRef } from "@fenel/engine/authority";
import { GLOBAL_ONLY } from "@fenel/engine";
import {
  effectDispatchEnabledForTest,
  handleIOForTest,
} from "./evaluator";

// ⚠ REPAIRED BY rights R2b, AND IT HAD BEEN RED SINCE R2a.
//
// R2a made `authority` a REQUIRED field of `IOHandlerContext` and made `perform`
// fail closed on an absent one. This file builds its IO context as a literal
// `{ accountId, profileId }`, and it is in no tsconfig — `runtime/tsconfig.tests.json`
// covers two files and its own header says so — so the missing field was
// invisible to the compiler and both probes have been failing with
// `authority refused "state.load_type" (absent)` ever since. It is the SAME
// class of defect R2a's own note §3.7 records against
// `durable-runtime-regressions.test.ts`, found a second time.
//
// The repair is a real authority naming exactly the descriptor under test, so
// each probe still observes what it was written to observe — that a legacy
// action and a typeclass-routed descriptor both ENTER `perform` — rather than
// observing the gate refusing them.
function dockAuthority(reg: ReturnType<typeof createRegistry>, descriptors: readonly string[]): AuthorityRef {
  return mintAuthority(reg, {
    envelope: reg.evaluateAuthorityFunction("authority:descriptorEnvelope", [[...descriptors]]),
    issuer: "test",
    accountId: "rights-loading-dock",
    principal: null,
    lane: null,
    grant: null,
    mintedAt: 0,
  });
}

describe("rights Landing 1 — perform loading dock", () => {
  it("Probe 3: a legacy state action enters perform from the durable frame", async () => {
    // The dedicated Probe-3 command sets FENEL_LEGACY_DISPATCH=1 before this
    // fresh test process imports evaluator.
    expect(effectDispatchEnabledForTest).toBe(
      process.env.FENEL_LEGACY_DISPATCH !== "1",
    );

    const reg = createRegistry([stdModule]);
    registerStateHandlers(reg);
    let leafHits = 0;
    const stateLeaf = async () => {
      leafHits++;
      return { action: "continue" as const, value: null };
    };
    reg.registerIOHandler("state.load_type", stateLeaf);
    // IO leaves reside only in perform's private table; the compatibility
    // face is a synthesized gated wrapper, never the registered raw leaf.
    expect(reg.getIOHandler("state.load_type")).not.toBe(stateLeaf);

    const result = await handleIOForTest(
      {
        action: "state.load_type",
        params: { typeId: "rights:missing-type" },
        stepPath: Nothing,
        letName: Nothing,
      },
      {
        accountId: "rights-loading-dock",
        profileId: "",
        authority: dockAuthority(reg, ["state.load_type", "state:loadType"]),
      },
      reg,
    );

    expect(result).toEqual({ action: "continue", value: null });
    expect(leafHits).toBe(1);
  }, 120_000);

  it("B3: a declared HasStateIO descriptor enters perform through typeclass routing", async () => {
    // Probe 3's dedicated fresh process deliberately selects the legacy arm.
    // The ordinary suite pins the complementary authored-instance route.
    if (!effectDispatchEnabledForTest) return;

    const reg = createRegistry([stdModule]);
    registerStateHandlers(reg);
    expect(
      reg.evaluateContext()._specRegistry?.resolve("account", "HasStateIO", GLOBAL_ONLY)
        ?.getInstance,
    ).toBe("state.get_instance");
    let leafHits = 0;
    const stateLeaf = async () => {
      leafHits++;
      return { action: "continue" as const, value: { $tag: "Nothing" } };
    };
    reg.registerIOHandler("state.get_instance", stateLeaf);
    expect(reg.getIOHandler("state.get_instance")).not.toBe(stateLeaf);

    const result = await handleIOForTest(
      {
        action: "state.get_instance",
        params: {
          typeId: "rights:missing-type",
          instanceId: "rights:missing-instance",
        },
        stepPath: Nothing,
        letName: Nothing,
      },
      {
        accountId: "rights-typeclass-dock",
        profileId: "",
        authority: dockAuthority(reg, ["state.get_instance", "state:getInstance"]),
      },
      reg,
    );

    expect(result).toEqual({
      action: "continue",
      value: { $tag: "Nothing" },
    });
    expect(leafHits).toBe(1);
  }, 120_000);
});
