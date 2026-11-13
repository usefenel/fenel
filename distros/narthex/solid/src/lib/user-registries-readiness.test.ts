import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("user registry readiness handles complete loads, retries, and stale completions", async () => {
  // Bun's module mock registry outlives mock.restore(). Keep the API and codec
  // stubs in a child process so they cannot replace imports in other tests.
  const child = Bun.spawn([
    process.execPath, "--no-env-file",
    fileURLToPath(new URL("./user-registries-readiness.fixture.ts", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("PASS complete account roster");
  expect(stdout).toContain("PASS managed system copies preserve source authority");
  expect(stdout).toContain("PASS partial failure and retry");
  expect(stdout).toContain("PASS stale account completion");
  expect(stdout).toContain("PASS workspace catalog session revocation and committed snapshot changes");
}, 30_000);
