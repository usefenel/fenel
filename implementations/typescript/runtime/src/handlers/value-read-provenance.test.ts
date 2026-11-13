import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("versioned and legacy values survive SQL, storage FFI, and state read projections", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./value-read-provenance.fixture.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("PASS value read provenance");
}, 120_000);
