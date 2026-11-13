import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("dashboard live counts reach their static handler while function details retain their route", async () => {
  // Run the real Hono router with IO mocks isolated from other API tests.
  const child = Bun.spawn([process.execPath, "--no-env-file",
    fileURLToPath(new URL("./dashboard-routing.fixture.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("PASS live counts, function details and authentication routing");
}, 120_000);
