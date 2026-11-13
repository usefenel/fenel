import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("DB writer stamps explicit value encoding and retains first-class unbounded types", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./entity-value-provenance.fixture.ts", import.meta.url))], { encoding: "utf8", timeout: 120_000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS typed DB writer provenance");
}, 130_000);

test("encoding migration adds provenance without reinterpreting existing data", async () => {
  const sql = await Bun.file(new URL("../migrations/0091_entity_instance_value_encoding.sql", import.meta.url)).text();
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS data_encoding text");
  expect(sql).not.toMatch(/UPDATE\s+entity_instances/i);
  expect(sql).toContain("data_encoding IS NULL");
});
