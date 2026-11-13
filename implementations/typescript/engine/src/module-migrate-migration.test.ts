// ---------------------------------------------------------------------------
// module-migrate-migration.test.ts — module-substrate Phase 3i parity proof.
//
// migration is a DISJOINT plain/ctx module: the 3 forward/backward record
// transforms (`profileDemoV1ToV2` / `profileDemoV2ToV1` /
// `profileDemoV2ToV1Narrow`) are plain natives; the 2 law-check witnesses
// (`roundtripCheck` / `forwardTotalCheck`) are ctx natives (they re-enter the
// evaluator to apply a migration's forward/backward). 0 Fenel-bodied. Since
// modules-as-values Phase 2d it declares the 3 demo record types
// (ProfileDemoV1 / ProfileDemoV2 / ProfileDemoV1Narrow) its instances name. This is a PARITY migration — the ~515-LOC hand-assembled
// engine/src/modules/migration.ts (5 defineFunction specs + inline native impls
// + helpers) was replaced by types.fenel (declarative, `module migration where`
// header + 5 @native foreign decls) + ffi/migration-ffi.ts (the 5 native impls
// split into plain + ctx maps) + a thin seam, with NOTHING dropped. The
// instances.fenel sidecar (the 2 worked Migration instances) is UNCHANGED.
//
// The deeper behavioural proof (compose / path-finding / law-check
// end-to-end) lives in migration.test.ts; this asserts the migration's
// structural parity.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  migrationModule,
  migrationDemoV1ToV2,
  migrationDemoV2ToV1Narrow,
  demoV1Samples,
  demoV2Samples,
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
} from "./modules/migration";
import { findMigration } from "./migration";
import { createRegistry } from "./registry";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `ctx: true` == the native lands in `nativeImplsCtx`; `ctx: false` == plain.
type Expected = { label: string; tags: string[]; description: string; ctx: boolean };
const NATIVES: Record<string, Expected> = {
  profileDemoV1ToV2: {
    label: "profile_demo: V1 → V2",
    tags: ["migration", "forward", "profile_demo"],
    description:
      "Forward migration of the demo profile entity: copy firstName / lastName, default email to empty string. The Lossless invariant holds: backward composes to identity on values whose email is `\"\"`.",
    ctx: false,
  },
  profileDemoV2ToV1: {
    label: "profile_demo: V2 → V1",
    tags: ["migration", "backward", "profile_demo"],
    description:
      "Backward migration of the demo profile entity: drop the email field. Combined with profileDemoV1ToV2 it produces the Lossless `Migration<ProfileDemoV1, ProfileDemoV2>` instance (backward(forward(v1)) = Ok v1 for every v1 in the sample set).",
    ctx: false,
  },
  profileDemoV2ToV1Narrow: {
    label: "profile_demo: V2 → V1Narrow (drop lastName)",
    tags: ["migration", "forward", "lossy", "profile_demo"],
    description:
      "Lossy forward migration: V2 → V1Narrow drops the lastName field. The companion Migration instance declares `Lossy { reason: \"lastName is dropped on forward\" }` and carries `{$tag: \"Nothing\"}` as backward — there's no way to recover the dropped value. Demonstrates the Lossy variant of the typeclass shape.",
    ctx: false,
  },
  roundtripCheck: {
    label: "Migration Roundtrip Check",
    tags: ["migration", "law", "roundtrip", "check"],
    description:
      "Backs the `migration-roundtrip-lossless` law. Iterates the per-instance sample list, applies forward then backward, and asserts deepEq with the original v1. Returns `Just true` when every sample passes, `Just false` on refutation, `Nothing` when the instance is Lossy or has no samples (vacuous).",
    ctx: true,
  },
  forwardTotalCheck: {
    label: "Migration Forward Totality Check",
    tags: ["migration", "law", "forward", "check"],
    description:
      "Backs the `migration-forward-total` law. Iterates the per-instance sample list and asserts every `forward(v1)` returns `Ok _`. Returns `Just true` on success, `Just false` if any forward returns `Err _`, `Nothing` when no samples are supplied.",
    ctx: true,
  },
};

const ALL_NAMES = Object.keys(NATIVES);
const PLAIN_NATIVES = ALL_NAMES.filter((n) => !NATIVES[n]!.ctx); // 3 forward/backward
const CTX_NATIVES = ALL_NAMES.filter((n) => NATIVES[n]!.ctx); // 2 law checks

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("migration migration — header-driven identity", () => {
  test("the `module migration where` header is authoritative (lowercase prefix preserved)", () => {
    expect(migrationModule.name).toBe("migration");
  });

  test("all 5 functions registered under the legacy `migration:` id-prefix", () => {
    expect((migrationModule.functions ?? []).map((f) => f.id).sort()).toEqual(
      ALL_NAMES.map((n) => `migration:${n}`).sort(),
    );
  });

  test("migration contributes exactly the 3 demo record types (modules-as-values Phase 2d)", () => {
    expect((migrationModule.entities ?? []).map((e) => e.id)).toEqual(["ProfileDemoV1", "ProfileDemoV2", "ProfileDemoV1Narrow"]);
  });

  test("module label preserved", () => {
    expect(JSON.stringify(migrationModule.label)).toContain("Migration");
  });
});

describe("migration migration — the `ffi/` split + the DISJOINT plain/ctx seam (axis #3)", () => {
  test("all 5 native-backed functions are BODYLESS foreign declarations", () => {
    const bodyless = (migrationModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(ALL_NAMES.map((n) => `migration:${n}`).sort());
  });

  test("nativeImpls (PLAIN map) holds exactly the 3 forward/backward transforms, id-keyed", () => {
    expect(Object.keys(migrationModule.nativeImpls ?? {}).sort()).toEqual(
      PLAIN_NATIVES.map((n) => `migration:${n}`).sort(),
    );
  });

  test("nativeImplsCtx (CTX map) is PRESENT, holds exactly the 2 law checks, id-keyed", () => {
    expect(migrationModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(migrationModule.nativeImplsCtx ?? {}).sort()).toEqual(
      CTX_NATIVES.map((n) => `migration:${n}`).sort(),
    );
  });

  test("the plain and ctx maps are disjoint (axis #4: seam routes, no marker)", () => {
    const plain = new Set(Object.keys(migrationModule.nativeImpls ?? {}));
    const ctx = new Set(Object.keys(migrationModule.nativeImplsCtx ?? {}));
    for (const k of ctx) expect(plain.has(k), `${k} must not be in both maps`).toBe(false);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(migrationModule.ioHandlers).toBeUndefined();
    expect(migrationModule.credentialRequirements).toBeUndefined();
  });
});

describe("migration migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = migrationModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `migration:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): migration declares no @category, so NONE
  // carry a stored Categorizable — the `migration` category derives at read time
  // (displayCategory → the id's module-prefix).
  test("Categorizable: NONE stored — migration declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `migration:${n}`)).toBeUndefined();
    }
  });

  test("Labelable + Describable + Taggable: byte-identical for all 5 natives", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `migration:${n}`)).toEqual({ label: NATIVES[n]!.label });
      expect(methodOf(insts, "Describable", `migration:${n}`)).toEqual({ description: NATIVES[n]!.description });
      expect(methodOf(insts, "Taggable", `migration:${n}`)).toEqual({ tags: NATIVES[n]!.tags });
    }
  });

  // Phase 3j: Categorizable drops 5→0 (no @category). Labelable stays 5.
  test("identity-facet counts: 5 Codeable/Labelable/Describable/Taggable, 0 Categorizable (none @category), 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(5);
    expect(counts.Labelable).toBe(5);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.Describable).toBe(5);
    expect(counts.Taggable).toBe(5);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("migration migration — the 2 Migration instances ride (instances.fenel sidecar)", () => {
  const insts = migrationModule.instances ?? [];
  const migInsts = insts.filter((i) => i.typeName === "Migration");

  test("exactly 2 Migration dispatch instances", () => {
    expect(migInsts.length).toBe(2);
  });

  test("the Lossless V1→V2 instance carries the right forward/backward/losslessness + label", () => {
    expect(migrationDemoV1ToV2.typeName).toBe("Migration");
    expect(migrationDemoV1ToV2.args).toEqual(["ProfileDemoV1", "ProfileDemoV2"]);
    // modules-as-values Phase 2d: qualified references (the Just one lowered
    // by the declared field type in the seam).
    expect(migrationDemoV1ToV2.methods.forward).toEqual({ $ref: "migration.profileDemoV1ToV2" });
    expect(migrationDemoV1ToV2.methods.backward).toEqual({ $tag: "Just", _0: { $ref: "migration.profileDemoV2ToV1" } });
    expect(migrationDemoV1ToV2.methods.losslessness).toEqual({ $tag: "Lossless" });
    expect(migrationDemoV1ToV2.label).toContain("add email");
  });

  test("the Lossy V2→V1Narrow instance carries Nothing-backward + Lossy reason", () => {
    expect(migrationDemoV2ToV1Narrow.args).toEqual(["ProfileDemoV2", "ProfileDemoV1Narrow"]);
    expect(migrationDemoV2ToV1Narrow.methods.forward).toEqual({ $ref: "migration.profileDemoV2ToV1Narrow" });
    expect(migrationDemoV2ToV1Narrow.methods.backward).toEqual({ $tag: "Nothing" });
    const loss = migrationDemoV2ToV1Narrow.methods.losslessness as { $tag: string; reason?: string };
    expect(loss.$tag).toBe("Lossy");
    expect(loss.reason).toContain("lastName");
  });

  test("registerMigration side-effect: findMigration returns the SAME object identity (path-finder relies on it)", () => {
    expect(findMigration("ProfileDemoV1", "ProfileDemoV2")).toBe(migrationDemoV1ToV2);
    expect(findMigration("ProfileDemoV2", "ProfileDemoV1Narrow")).toBe(migrationDemoV2ToV1Narrow);
  });
});

describe("migration migration — sample arrays + native callability", () => {
  test("demoV1Samples / demoV2Samples preserved byte-for-byte (exported + test-consumed)", () => {
    expect(demoV1Samples).toEqual([
      { firstName: "Ada", lastName: "Lovelace" },
      { firstName: "Grace", lastName: "Hopper" },
      { firstName: "Linus", lastName: "Torvalds" },
      { firstName: "", lastName: "" },
      { firstName: "Edge", lastName: "Case" },
    ]);
    expect(demoV2Samples).toEqual([
      { firstName: "Bob", lastName: "Smith", email: "bob@example.com" },
      { firstName: "", lastName: "", email: "" },
      { firstName: "Carol", lastName: "Singh", email: "carol@example.org" },
    ]);
  });

  test("the 3 forward/backward natives are directly callable + correct (re-exported from the ffi leaf)", () => {
    expect(profileDemoV1ToV2Native({ firstName: "Ada", lastName: "Lovelace" })).toEqual({
      $tag: "Ok",
      _0: { firstName: "Ada", lastName: "Lovelace", email: "" },
    });
    expect(profileDemoV2ToV1Native({ firstName: "Ada", lastName: "Lovelace", email: "" })).toEqual({
      $tag: "Ok",
      _0: { firstName: "Ada", lastName: "Lovelace" },
    });
    expect(profileDemoV2ToV1NarrowNative({ firstName: "Ada", lastName: "Lovelace", email: "x" })).toEqual({
      $tag: "Ok",
      _0: { firstName: "Ada" },
    });
    // Err path: missing field.
    expect(profileDemoV1ToV2Native({ firstName: "Ada" })).toEqual({
      $tag: "Err",
      _0: { $tag: "FieldMissing", field: "lastName" },
    });
  });
});

describe("migration migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([migrationModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const n of ALL_NAMES) {
      const id = `migration:${n}`;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(n)?.id, `by codeName: ${n}`).toBe(id);
    }
  });

  test("the registry context exposes BOTH native maps", () => {
    const ctx = reg.evaluateContext();
    for (const n of PLAIN_NATIVES) {
      expect(typeof ctx.natives?.[`migration:${n}`], `plain native: migration:${n}`).toBe("function");
    }
    for (const n of CTX_NATIVES) {
      expect(typeof ctx.nativesCtx?.[`migration:${n}`], `ctx native: migration:${n}`).toBe("function");
    }
  });

  test("plain native profileDemoV1ToV2 is callable through the registry context", () => {
    const ctx = reg.evaluateContext();
    const out = ctx.natives!["migration:profileDemoV1ToV2"]!({ firstName: "Grace", lastName: "Hopper" });
    expect(out).toEqual({ $tag: "Ok", _0: { firstName: "Grace", lastName: "Hopper", email: "" } });
  });
});
