import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("function writer and reader preserve executable Type values across JSON storage", () => {
  const result = spawnSync(process.execPath, ["--no-env-file", fileURLToPath(new URL("./function-expression-wire.fixture.ts", import.meta.url))], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS function expression wire storage/read/execution");
}, 35_000);
