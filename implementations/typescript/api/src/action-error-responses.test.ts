import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("action responses conceal database details and retain domain validation errors", async () => {
  // Isolate module mocks from the rest of the API suite; no database is used.
  const child = Bun.spawn([process.execPath, "--no-env-file",
    fileURLToPath(new URL("./action-error-responses.fixture.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(exitCode).toBe(0);
}, 120_000);
