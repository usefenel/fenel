// ---------------------------------------------------------------------------
// Seed engine-module functions into the functions table.
//
// Rom's framing: the standard library "lives on the database" — the fact
// that it's bundled with the engine code is a convenience. So every fn
// declared via defineFunction across all engine modules is upserted into
// the `functions` table on api boot, marked is_system = true. User-
// defined functions sit alongside them with is_system = false.
//
// Idempotent: re-runs every boot. Existing rows have their JSON body
// refreshed so a code-side declaration change ("label change", new
// param) propagates automatically without a manual migration.
// ---------------------------------------------------------------------------

import { getCatalog } from "@fenel/engine";
import { seedFunctionsBatch } from "@fenel/db";

export async function seedSystemFunctions(accountId: string): Promise<number> {
  // Collect first, write once. This used to await one `upsertFunction` per
  // entry — 2 serialized round trips each, ~1,534 entries, 25.5 ms median RTT
  // to the staging Postgres. That is >78 s of latency on the boot path before
  // the API can bind its port. The batch does one SELECT plus chunked writes.
  const defs: Array<{ name: string; function: Record<string, unknown>; isSystem: boolean }> = [];
  for (const section of getCatalog()) {
    if (section.id !== "function") continue;
    for (const entry of section.entries) {
      const fn = (entry as { fn?: Record<string, unknown> }).fn;
      if (!fn || typeof fn !== "object" || typeof (fn as { id?: unknown }).id !== "string") {
        continue;
      }
      defs.push({ name: (fn as { id: string }).id, function: fn, isSystem: true });
    }
  }

  const result = await seedFunctionsBatch(accountId, defs);
  if (result.skippedSourceOwned > 0) {
    // Previously one caught-and-logged throw per row; now one line for all.
    console.log(
      `[seed-system-fns] skipped ${result.skippedSourceOwned} source-owned function(s)`,
    );
  }
  return result.updated + result.inserted;
}
