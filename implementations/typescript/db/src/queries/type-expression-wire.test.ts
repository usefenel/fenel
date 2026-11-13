import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("native Type definition query writes and reads preserve unbounded refinements", () => {
  const result = spawnSync(process.execPath, ["--no-env-file", fileURLToPath(new URL("./type-expression-wire.fixture.ts", import.meta.url))], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS type query JSON persistence");
}, 35_000);
