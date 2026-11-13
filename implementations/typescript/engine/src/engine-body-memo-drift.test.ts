// S1a DRIFT gate (heavy: four seed registry builds, ~3-5 GB, many minutes).
// Run alone: bun test --timeout 3600000 ./implementations/typescript/engine/src/engine-body-memo-drift.test.ts
//
// Four seed repository builds:
//   cold    — memo OFF, in its OWN fresh realm (a subprocess running the
//             fixture), the reference computation;
// and, in this test's realm,
//   record  — memo ON, a fresh key, so every kernel runs and is recorded;
//   replay  — memo ON, another fresh key, so the registry's own field/facet/
//             body-spelling memos cannot serve it: the field kernel and facet
//             projection are replayed from stored copies; authored signature
//             plans are served by the earlier S3a exact-row reuse layer;
//   warm    — memo ON, the record build's key again, so the registry's field
//             memos serve fields/facets (the ordinary warm rebuild).
// cold == record == replay is the gate. warm == cold is asserted separately,
// and the warm leg's memo misses are reported (an inherited input-shape
// difference between warm and cold builds would show there).
import "./engine-body-host-install";
import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  __setEngineBodyMemoForTests,
  clearEngineBodyMemo,
  engineBodyMemoStats,
  type EngineBodyMemoFnStats,
} from "./engine-body-memo";
import { fullDigest, seedBuild } from "./engine-body-memo-drift.fixture";
import type { ModuleRegistry } from "./registry";
import { signaturePlanReuseStats } from "./signature-inference";

const timings: Record<string, number> = {};
const digests: Record<string, Record<string, string>> = {};
let warmMisses: Record<string, Pick<EngineBodyMemoFnStats, "calls" | "hits" | "computed">> = {};

function timed(label: string, build: () => ModuleRegistry): Record<string, string> {
  const t = performance.now();
  const reg = build();
  timings[label] = Math.round(performance.now() - t);
  const rss = () => Math.round(process.memoryUsage().rss / 1048576);
  console.log(`[s1-drift] ${label} built in ${timings[label]} ms, rss ${rss()} MB`);
  const t2 = performance.now();
  const digest = fullDigest(reg);
  console.log(`[s1-drift] ${label} digested in ${Math.round(performance.now() - t2)} ms, rss ${rss()} MB`);
  return digest;
}

describe("engine-body memo drift (seed, one realm)", () => {
  afterAll(() => {
    __setEngineBodyMemoForTests(null);
    clearEngineBodyMemo();
    console.log(`[s1-drift] timings ms ${JSON.stringify(timings)}`);
    console.log(`[s1-drift] warm-leg misses ${JSON.stringify(warmMisses)}`);
  });

  test("memo-OFF cold == recorded == replayed: full structural digest", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cold = Bun.spawnSync(["bun", join(here, "engine-body-memo-drift.fixture.ts"), "cold"], {
      cwd: here, env: { ...process.env }, stdout: "pipe", stderr: "pipe",
    });
    if (cold.exitCode !== 0) throw new Error(`cold realm failed: ${cold.stderr.toString()}`);
    const coldOut = JSON.parse(cold.stdout.toString().trim().split("\n").at(-1)!) as {
      buildMs: number; digestMs: number; digest: Record<string, string>;
    };
    timings.cold = coldOut.buildMs;
    console.log(`[s1-drift] cold (own realm) built in ${coldOut.buildMs} ms, digested in ${coldOut.digestMs} ms`);
    digests.cold = coldOut.digest;

    __setEngineBodyMemoForTests(true);
    clearEngineBodyMemo();
    digests.record = timed("record", () => seedBuild("record"));
    const afterRecord = engineBodyMemoStats().byFn;
    expect(afterRecord["engine:collectFieldIdentitiesKernel"]?.stored).toBe(1);
    expect(afterRecord["engine:projectFieldFacets"]?.stored).toBe(1);

    const signaturesBeforeReplay = signaturePlanReuseStats();
    digests.replay = timed("replay", () => seedBuild("replay"));
    const afterReplay = engineBodyMemoStats().byFn;
    const signaturesAfterReplay = signaturePlanReuseStats();
    const authoredPlanHits = signaturesAfterReplay.authoredHits - signaturesBeforeReplay.authoredHits;
    console.log(`[s1-drift] replay authored signature plan hits ${authoredPlanHits}`);

    expect(digests.record).toEqual(digests.cold!);
    expect(digests.replay).toEqual(digests.cold!);

    // Fields and facets were served by the NEW memo from stored copies.
    expect(afterReplay["engine:collectFieldIdentitiesKernel"]?.hits).toBe(1);
    expect(afterReplay["engine:projectFieldFacets"]?.hits).toBe(1);
    // S3a retains exact row plans before dispatch: reused rows never enter
    // the engine-body memo, so its authored-planner hit counter stays zero.
    expect(authoredPlanHits).toBeGreaterThan(0);
  }, 3_600_000);

  test("warm rebuild (registry field memos ON) == cold", () => {
    const before = engineBodyMemoStats().byFn;
    digests.warm = timed("warm", () => seedBuild("record"));
    const after = engineBodyMemoStats().byFn;
    warmMisses = {};
    for (const [fn, row] of Object.entries(after)) {
      const prior = before[fn];
      const calls = row.calls - (prior?.calls ?? 0);
      const hits = row.hits - (prior?.hits ?? 0);
      if (calls !== hits) warmMisses[fn] = { calls, hits, computed: row.computed - (prior?.computed ?? 0) };
    }
    expect(digests.warm).toEqual(digests.cold!);
  }, 3_600_000);
});
