import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("production dispatch queries round-trip the editor payload through SQL writes and reads", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./dispatch-instance-persistence.fixture.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("create/read/update/read preserves");
  expect(stdout).toContain("empty account enumeration skips the codec registry");
  expect(stdout).toContain("stable draft identities and locked native-preserving stale update/delete preconditions pass");
}, 120_000);
