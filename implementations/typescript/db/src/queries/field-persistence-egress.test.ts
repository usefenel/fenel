import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("production Field insert/update binding accepts null-prototype data without changing own keys", () => {
  const result = spawnSync(process.execPath, ["--no-env-file",
    fileURLToPath(new URL("./field-persistence-egress.fixture.ts", import.meta.url))], {
    encoding: "utf8", timeout: 30_000, windowsHide: true,
    env: { ...process.env, FENEL_PARSER_LEGACY: "1" },
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS production Field insert/update Drizzle binding");
}, 35_000);
