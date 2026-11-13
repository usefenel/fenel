import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("checkpoint-backed DB and state projections preserve native language values", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./checkpoint-projections.fixture.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("checkpoint projections preserve native values and legacy markers");
}, 120_000);
