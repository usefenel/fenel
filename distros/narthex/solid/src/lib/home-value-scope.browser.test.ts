import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("Home retains loaded data through reader handoff and rejects superseded worker results (Chromium)", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  for (const [runtime, filename] of [["bun", "home-value-scope.browser-fixture.mjs"], ["node", "home-value-scope.browser-smoke.mjs"]]) {
    const child = Bun.spawn([runtime!, fileURLToPath(new URL(filename!, import.meta.url))],
      { cwd: repository, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`${filename}: ${stdout}\n${stderr}`);
    if (runtime === "node") { expect(stdout).toContain("PASS actual Home value scope"); console.log(stdout.trim()); }
  }
}, 30_000);
