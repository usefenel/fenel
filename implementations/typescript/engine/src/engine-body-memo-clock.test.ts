// A realm without host services (a browser worker) has no memo clock, so the
// memo's diagnostic timings (encodeMs/computeMs/copyMs/artifactMs) read 0. The
// distro boot hands one in (`setEngineBodyMemoDiagnosticClock`); the engine
// reads no global clock itself. Runs in a FRESH realm without the host preload.
import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function runRealm(code: string): Record<string, unknown> {
  const result = Bun.spawnSync(["bun", "-e", code], {
    cwd: here,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`realm failed: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
}

describe("memo diagnostic clock without host services", () => {
  test("a handed-in clock times the memo's work; the first clock wins", () => {
    const out = runRealm(`
      await import("./proxy-tracking-install.ts");
      const memo = await import("./engine-body-memo.ts");
      let t = 0;
      memo.setEngineBodyMemoDiagnosticClock(() => t);
      memo.setEngineBodyMemoDiagnosticClock(() => 1e9);
      const host = { codeState: () => "pool:1", deterministicLeaves: () => new Set(), hostVariantLeaves: () => new Set(),
        hostFingerprint: () => "engine:test", compute: () => { t += 25; return 1; } };
      memo.withEngineBodyMemoPartition("clock", () => memo.memoizedEngineBodyCall("t:clock", [1], host));
      console.log(JSON.stringify({ computeMs: memo.engineBodyMemoStats().byFn["t:clock"].computeMs }));
    `);
    expect(out).toEqual({ computeMs: 25 });
  });
});
