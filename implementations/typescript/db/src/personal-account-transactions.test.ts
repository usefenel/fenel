import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("personal identity creation and every membership write use locked Fenel decisions", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./personal-account-transactions.fixture.ts", import.meta.url))],
    { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("personal identity transactions preserve the private partition");
}, 120_000);
