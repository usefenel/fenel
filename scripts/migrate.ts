/**
 * Migration runner — pushes Drizzle schema to PostgreSQL.
 *
 * Run: bun scripts/migrate.ts
 * Requires: DATABASE_URL env var
 *
 * For v1, we use drizzle-kit push (schema-first, no migration files).
 * This is safe for dev/staging. Production should use versioned migrations.
 */

import { execSync } from "child_process";

console.log("=== Pushing Drizzle schema to database ===\n");

try {
  execSync("bun x --bun drizzle-kit push", {
    stdio: "inherit",
    env: { ...process.env, PATH: process.env["PATH"] },
  });
  console.log("\n=== Migration complete ===");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
}
