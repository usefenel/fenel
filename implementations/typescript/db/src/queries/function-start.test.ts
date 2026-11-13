import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("new runs require the active installed account version while historical rows remain stored", () => {
  const child = spawnSync(process.execPath, ["--no-env-file", fileURLToPath(new URL("./function-start.fixture.ts", import.meta.url))], {
    encoding: "utf8", timeout: 120_000, windowsHide: true,
  });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain("PASS active/install/account selection");
}, 130_000);
