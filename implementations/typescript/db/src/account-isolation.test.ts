import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// rights R2b review round 8 — the behavioural half of the account-isolation
// guard. The fixture runs in its own process because it replaces `./client`'s
// `getDb` with a capture driver, and `mock.module` is process-wide.
test("every act that argues no account handle carries the account into its statement", async () => {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", fileURLToPath(new URL("./account-isolation.fixture.ts", import.meta.url))],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("account isolation holds for every act that argues no account handle");
}, 120_000);
