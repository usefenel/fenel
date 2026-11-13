// R0.5 (2026-08-28) — THE EXECUTE-PROFILE REGISTRY-BOOT SENTINEL.
//
// WHY THIS FILE EXISTS. `POST /api/auth/login` returned 500 for five and a half
// weeks (2026-07-19 → 2026-08-28) and every gate stayed green throughout. The
// R0 repair window fixed the app; it also established the structural reason
// nobody noticed, and did not change it
// (`workstreams/rights/notes/2026-08-28-r0-login-repair.md` §8.2):
//
//   **no CI gate constructs the EXECUTE-PROFILE runtime registry, and nothing
//   exercises a route.**
//
// Read that claim precisely, because the imprecise version is false. CI DOES
// build engine-side registries — `generate-signature-honesty-claims.ts --check`
// constructs the SYSTEM and SEED registries on every push, and
// `strict-repository-registry.test.ts` constructs a strict REPOSITORY registry
// over `engineModule`. What no gate built was the registry the durable runtime
// actually boots: `modulesFor("execute")` with the storage swap, plus every
// handler registration, plus BOTH branches of `registerFenelBodyDispatchers`.
// The discrimination is measurable rather than argued — R0 measured the SEED
// profile constructing cleanly while the EXECUTE profile threw.
//
// `strict-repository-registry.test.ts` is the nearest precedent for HOW to add
// a named cold-build sentinel, and it is not a substitute for one: it builds
// `createRepositoryRegistry([engineModule])` — ONE module, engine side, no
// handler registration, no `registerFenelBodyDispatchers`, no route.
//
// WHAT IT COVERS. One round-trip through the public `invokeIOAction` transits
// registry construction, signature inference, and both branches of
// `registerFenelBodyDispatchers` — which is all three of R0's registry-boot
// throw classes:
//   (a) the signature-inference throw   (`SignatureAnnotationRequiredError`,
//       raised while `createRepositoryRegistry` builds the execute module set);
//   (b) the BODIED native/IO descriptor collision (`perform: native/IO
//       descriptor collision at "std:min"`);
//   (b′) the BODYLESS `aliasIOHandler` collision (same, at `dispatch:lookupOne`).
// A commit that re-introduces any of the three turns this file red.
//
// WHAT IT DOES NOT COVER is written out in the workflow comment beside its job
// in `.github/workflows/audit.yml`, deliberately as prose rather than left
// implied: route mounting, auth middleware, cookie/bearer sessions, DB
// connectivity/schema/seeding, per-account registries, durable persistence
// WRITES (R0 defect (e)'s three production placements), and staging
// configuration. "Server started" is never a login sentinel — `server.ts:87-109`
// CATCHES and logs an admin-bootstrap failure and then announces `Fenel API
// running` at `:118`. Only a login round-trip asserting 200 is, and that is B2.
//
// PROCESS FRESHNESS IS LOAD-BEARING, for a different reason than the strict
// repository sentinel's. `loadRegistry` memoises into a module-level
// `_cachedReg` (`evaluator.ts`, durable-eval-perf Phase 1b), so a sentinel that
// runs after ANY other runtime call in the same process asserts nothing at all.
// This file is therefore invoked by CI AS ITS OWN `bun test` target. CI names
// test files individually and does NOT discover them, so a renamed file, or one
// committed without its workflow line, is a green gate over an absent sentinel.
//
// ONE ASSERTION SHAPE, on purpose. Everything this file can detect is detected
// by the boot completing; extra invariants asserted after it buy churn, not
// coverage.

import { afterAll, describe, expect, it } from "bun:test";

// DB-LESS IS THE DESIGNED MODE, not a hack: `loadRegistry` is memory-first and
// installs the `Db` backend only when one of these two is set (storage-as-effect
// Phase 2). CI has no `.env`, so both are already absent there; a developer host
// has a `.env` carrying `DATABASE_URL`, which `bun` loads unless `--no-env-file`
// is passed. Removing them HERE — before the evaluator module is imported below,
// and before `loadRegistry` reads them — makes the sentinel assert the same
// thing on both, instead of silently testing a different backend locally.
//
// RESTORED IN `afterAll`, and that is not hygiene — it is a measured leak.
// `bun test` over a DIRECTORY loads many files into ONE process, and
// `db/src/field-definition-transaction.test.ts:32-33` reads `DATABASE_URL` at
// MODULE scope to choose `describe` vs `describe.skip`. Without the restore,
// a broad local run that loaded this file first would silently skip that
// file's entire DB integration suite and report green. CI invokes this file
// alone, so the restore is defence for the local broad run, not for the gate.
const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

afterAll(async () => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  // Restoring the VARIABLES is not enough, and review round 3 caught why:
  // `loadRegistry` has by now memoised a Memory-backed registry into
  // `_cachedReg` and returns it BEFORE re-reading `DATABASE_URL` or calling
  // `installDbBackend`. A later file in the same process would then see the
  // restored URL while every `state:*` call still went to Memory — a DB
  // integration test could pass without touching PostgreSQL. Dropping the memo
  // makes the next `loadRegistry()` re-read the environment.
  const { resetRegistryCache } = await import("./evaluator");
  resetRegistryCache();
});

// A FLOOR, never an equality. The system-entity catalog grows; an equality pin
// would turn every catalog addition into a false red, and the sentinel is about
// the boot completing, not about the catalog's size. R0.5 measured 106 rows.
const ROW_FLOOR = 100;

// The account id is inert on this route — `dispatch.list_system_entities` reads
// the engine's in-process `systemEntities` and ignores the IO context entirely
// (`handlers/dispatch.ts`). What the id is NOT inert about is which registry
// gets loaded, and that is why this line changed.
//
// ⚠ THIS SENTINEL WAS RED FROM `178ffe1c` UNTIL rights R1 (2026-09-11), and the
// red was never observed. Measured both ways during the R1 window: at
// `e5482d8b` with every R1 change stashed, this file failed in 75.4 s with
// `DATABASE_URL environment variable is required` at
// `db/src/queries/registries.ts:98` (`listAccountImports`), and identically at
// 76.5 s with them applied.
//
// The cause is a premise this file states as a header claim: "DB-LESS IS THE
// DESIGNED MODE". `178ffe1c` added an unconditional
// `loadAccountSourceModulesState(accountId)` to the ACCOUNT branch of
// `loadAccountExecutionRegistry`, so any NON-EMPTY account id now requires a
// database before the registry is built. A well-formed placeholder took that
// branch; the empty id does not (`if (!accountId) return base`).
//
// The empty id is what this sentinel always meant. Its stated coverage is
// registry CONSTRUCTION, signature inference, and both branches of
// `registerFenelBodyDispatchers` — all of which live in `buildExecutionRegistry`
// and none of which are in the account merge. So the repair loses no coverage;
// it removes an account-source-module DB read the file never claimed to test
// and its own comment called inert.
//
// The account-branch merge is genuinely untested by any DB-less gate. That is a
// separate, real gap and it is NOT closed here — it needs a DB double, and this
// file deliberately stubs nothing. Recorded in the R1 completion note.
const PLACEHOLDER_ACCOUNT = "";

describe("execute-profile registry boot — the R0 sentinel", () => {
  it("boots the durable runtime registry and serves one DB-free IO action", async () => {
    expect(process.env["DATABASE_URL"]).toBeUndefined();
    expect(process.env["FENEL_STORAGE_DB_FIRST"]).toBeUndefined();

    // Imported dynamically so the deletions above are already in effect: a
    // static import is hoisted above them, and `@fenel/db` reads the URL.
    const { invokeIOActionAs, loadRegistry } = await import("./evaluator");
    const { mintAuthority } = await import("@fenel/engine/authority");

    // rights R2a — the sentinel now mints its own authority, which is itself
    // part of what it proves: the registry boots far enough to evaluate
    // `authority:roleEnvelope` over its own descriptor list. A boot
    // that produced a registry whose CHECKER could not run would refuse every
    // act, and this line is where that would surface.
    const rows = await invokeIOActionAs(
      // rights R2a — a `test` issuer, not a product lane: `InterimWorkerLane` is
      // R4's census of lanes the PRODUCT mints, and a harness borrowing one
      // would make that census over-report.
      mintAuthority(loadRegistry(), {
        envelope: loadRegistry().evaluateAuthorityFunction(
          "authority:descriptorEnvelope", [loadRegistry().listPerformDescriptors()],
        ),
        issuer: "test", accountId: PLACEHOLDER_ACCOUNT, principal: null, lane: null, grant: null, mintedAt: 0,
      }),
      null,
      "dispatch.list_system_entities",
      {},
    );

    expect(Array.isArray(rows)).toBe(true);
    expect((rows as unknown[]).length).toBeGreaterThanOrEqual(ROW_FLOOR);
  }, 2_400_000);
});
