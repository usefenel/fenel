// ---------------------------------------------------------------------------
// The identity driver's codename-lock and repository-field-catalog phases, run
// in ONE fresh child process (docs/perf/2026-09-23-regen-and-test-battery.md,
// item 7).
//
// In-process, the two phases left the coordinator holding their strict
// registries (about 3 GB) through the owner renders that follow, and each
// render peaks near 5 GB on a 16 GB host. The work here is exactly what the
// in-process phases did, in the same order, sharing the strict registries the
// same way; only the process boundary moved. The child inherits the
// coordinator's environment unchanged (not the render children's), so the
// parser choice is the same as before.
//
// Output: progress may go to stdout; the LAST line is one JSON receipt.
// ---------------------------------------------------------------------------

import { runCodenameLock } from "./generate-codename-lock";
import { runFieldCatalog } from "./generate-repository-field-catalog";

const lock = runCodenameLock({ check: false });
if (!lock.ok) {
  console.error("codename lock returned a check-only verdict in write mode");
  process.exit(1);
}
const catalog = runFieldCatalog({
  check: false,
  shared: { registries: lock.strictRegistries, manifestDigest: lock.digest, lock: lock.manifestLock },
});
process.stdout.write(`${JSON.stringify({
  minted: lock.minted.map((row) => ({ ...row })),
  requiredCount: lock.requiredCount,
  physicalCount: lock.physicalCount,
  digest: lock.digest,
  catalog: `${catalog.fieldCount} fields; sha256 ${catalog.digest}`,
})}\n`);
