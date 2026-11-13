import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("DB-free production query and transaction regression cases", async () => {
  // Keep getDb's module mock in a separate process so integration tests cannot
  // accidentally inherit a fake database when a broader suite imports client.
  const child = Bun.spawn([process.execPath, "--no-env-file",
    fileURLToPath(new URL("./db-audit-regressions.fixture.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
  const report = JSON.parse(stdout);
  expect(report.passed).toBe(report.total);
  // 21 since 2026-09-23: the account-switch session check went with `getLiveUserSession`,
  // whose checks `state:getSessionByHash` already performs for `auth:switchAccount`.
  expect(report.total).toBe(21);
}, 120_000);
