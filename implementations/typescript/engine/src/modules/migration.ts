// ---------------------------------------------------------------------------
// Migration — module-substrate Phase 3i seam (DISJOINT plain/ctx).
//
// migration registers ONE worked Migration instance family (the Lossless
// DemoV1→DemoV2 + the Lossy DemoV2→DemoV1Narrow) plus the law-check natives
// (`roundtripCheck` / `forwardTotalCheck`) the typeclass laws delegate to. It
// is a DISJOINT plain/ctx module: the 3 forward/backward record transforms are
// plain natives; the 2 law-check witnesses are ctx natives (they re-enter the
// evaluator to apply a migration's forward/backward). 3 entities (the demo
// record types ProfileDemoV1 / ProfileDemoV2 / ProfileDemoV1Narrow, declared
// in types.fenel since modules-as-values Phase 2d), 0 Fenel-bodied helpers.
//
// The ~515-LOC hand-assembled module (5 `defineFunction` specs + inline native
// impls + helpers) is RETIRED. The source of truth is now:
//   - `fenel/modules/migration/types.fenel` — the `module migration where`
//     header + the 5 `@native` foreign declarations;
//   - `fenel/modules/migration/ffi/migration-ffi.ts` — the 5 native impls
//     split into `migrationNatives` (plain) + `migrationNativesCtx` (ctx);
//   - `fenel/modules/migration/instances.fenel` — the 2 worked
//     `Migration <V1> <V2>` instances (loaded `{ dispatchInstanceFile: true }`),
//     projected here via `pickMigrationInst`, which also lowers
//     `backward = Just migration.x` by the class's declared field type
//     (the dispatch registry's `lowerMaybeFunctionReferences`,
//     modules-as-values Phase 2d).
//
// This file is the thin SEAM: load the declarative types.fenel, load the
// instances.fenel, import the ffi leaf, route BOTH native maps via
// `rekeyNativesById`, project the 2 instance consts, run the `registerMigration`
// side-effects (the migration-graph index), and re-export the `*Native` fns +
// `demoV1Samples`/`demoV2Samples` so no consumer needs an edit. No `@nativeCtx`
// marker (seam-routing suffices — axis #4).
//
// PARITY contract preserved byte-for-byte: the `demoV1Samples`/`demoV2Samples`
// arrays (exported + test-consumed), the 2 `registerMigration(...)` side-effect
// calls, the `pickMigrationInst` projection, and the 2 exported instance consts
// (`migrationDemoV1ToV2` / `migrationDemoV2ToV1Narrow` — `registerMigration` +
// `findMigrationPath` rely on the SAME object identity).
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { lowerMaybeFunctionReferences } from "../dispatch-registry";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { migration, registerMigration } from "../migration";
import {
  migrationNatives,
  migrationNativesCtx,
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
  roundtripCheckNative,
  forwardTotalCheckNative,
  type DemoV1,
  type DemoV2,
} from "../../../../../fenel/modules/migration/ffi/migration-ffi";
import MIGRATION_TYPES_FENEL from "../../../../../fenel/modules/migration/types.fenel?raw";
import MIGRATION_INSTANCES_FENEL from "../../../../../fenel/modules/migration/instances.fenel?raw";

// Declarative half — header + the 5 `@native` foreign declarations.
// `loaded.instances` holds the per-function identity ClassInstances.
const loaded = loadFenelModule(MIGRATION_TYPES_FENEL, "migration", { label: "Migration" });

// ---------------------------------------------------------------------------
// Sample v1 / v2 values driving the laws. Exported + consumed independently by
// migration.test.ts; the instances.fenel `roundtripSamples` are deep-equal to
// them. Pure data — preserved byte-for-byte from the retired module.
// ---------------------------------------------------------------------------

const demoV1Samples: DemoV1[] = [
  { firstName: "Ada", lastName: "Lovelace" },
  { firstName: "Grace", lastName: "Hopper" },
  { firstName: "Linus", lastName: "Torvalds" },
  { firstName: "", lastName: "" },
  { firstName: "Edge", lastName: "Case" },
];

const demoV2Samples: DemoV2[] = [
  { firstName: "Bob", lastName: "Smith", email: "bob@example.com" },
  { firstName: "", lastName: "", email: "" },
  { firstName: "Carol", lastName: "Singh", email: "carol@example.org" },
];

// ---------------------------------------------------------------------------
// `backward = Just migration.x` — registry-time lowering (modules-as-values
// Phase 2d). The loader gives it as `{$tag:"Just", var:"migration.x"}`; the
// class's declared field type, `Maybe (v2 -> Result MigrationError v1)`, makes
// the Just payload a function reference. The lowering is the dispatch
// registry's own (`dispatch-registry.ts` `lowerMaybeFunctionReferences`, run by
// `addInstance` for every row); this seam applies the same function once more,
// before `registerMigration`, because the migration-graph index holds the
// instance before (and by the same identity as) the dispatch registration.
// Re-exported here for the tests that import it from this seam.
// ---------------------------------------------------------------------------

export { lowerMaybeFunctionReferences };

// ---------------------------------------------------------------------------
// The 2 worked Migration instances — Fenel-authored typed values in
// `instances.fenel` (Phase 3.2 of typeclass-substrate-completion). The
// `loadFenelModule` projection produces the byte-identical `{typeName, args,
// methods, label}` shape. The exported consts below are thin projection
// lookups, preserved because the engine barrel (index.ts) re-exports them,
// migration.test.ts imports them, AND `registerMigration` + `findMigrationPath`
// rely on the registered reference (so the lookup result must be the SAME
// object passed to `registerMigration`).
// ---------------------------------------------------------------------------

const migrationFenelInstances = loadFenelModule(MIGRATION_INSTANCES_FENEL, "migration", { dispatchInstanceFile: true }).instances ?? [];
// modules-as-values Phase 2d — `backward = Just migration.profileDemoV2ToV1`
// reaches here as the loader's `{$tag:"Just", var:"migration.…"}`; the
// Migration class declares `backward : Maybe (v2 -> Result MigrationError v1)`,
// so the Just payload is a function reference. Lowered once, here, before
// the instance is registered anywhere.
const pickMigrationInst = (arg0: string, arg1: string): Instance => {
  const found = migrationFenelInstances.find(
    (i) => i.typeName === "Migration" && i.args[0] === arg0 && i.args[1] === arg1,
  );
  if (!found) throw new Error(`migration: missing Fenel instance Migration ${arg0} ${arg1}`);
  return lowerMaybeFunctionReferences(found, migration);
};

export const migrationDemoV1ToV2: Instance = pickMigrationInst("ProfileDemoV1", "ProfileDemoV2");
export const migrationDemoV2ToV1Narrow: Instance = pickMigrationInst("ProfileDemoV2", "ProfileDemoV1Narrow");

// Register the demo migrations with the migration-graph index. The
// typeclass-registry registration happens via SYSTEM_MODULES (the instances
// flow through `migrationInstances` below).
registerMigration(migrationDemoV1ToV2);
registerMigration(migrationDemoV2ToV1Narrow);

const migrationInstances: Instance[] = [
  ...(loaded.instances ?? []),
  migrationDemoV1ToV2,
  migrationDemoV2ToV1Narrow,
];

// ---------------------------------------------------------------------------
// Module export — picked up by SYSTEM_MODULES in system-entities.ts and
// system-registry.ts.
// ---------------------------------------------------------------------------

export const migrationModule: FenelModule = {
  ...loaded,
  instances: migrationInstances,
  // Plain natives (forward/backward) → `nativeImpls`; ctx natives (law checks)
  // → `nativeImplsCtx`. Both rekeyed codeName → `migration:codeName`.
  nativeImpls: rekeyNativesById(migrationNatives, "migration"),
  nativeImplsCtx: rekeyNativesById(migrationNativesCtx, "migration") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the natives + samples for direct use in tests (avoids constructing
// a full module registry just to exercise the underlying migrations).
// Preserved byte-for-byte from the retired seam, so no consumer needs an edit.
export {
  migrationNatives,
  migrationNativesCtx,
  demoV1Samples,
  demoV2Samples,
  profileDemoV1ToV2Native,
  profileDemoV2ToV1Native,
  profileDemoV2ToV1NarrowNative,
  roundtripCheckNative,
  forwardTotalCheckNative,
};
