// S1b DRIFT gate for the artifact (heavy: four fresh realms in sequence, each
// ~2-3 GB, many minutes on a loaded host). Run alone, in the shared heavy slot:
//   bun test --timeout 3600000 ./implementations/typescript/engine/src/engine-body-replay-drift.test.ts
//
// Every build goes through the PRODUCTION constructors (`createRepositoryRegistry`,
// `createLocalFieldRegistry`), not a fixture copy:
//   1. the tracked recorder writes a seed artifact + pin (its own realm);
//   2. a fresh realm with that artifact builds the seed: every caller-less
//      call is served from the artifact, none computed;
//   3. a fresh realm with that artifact builds a Local tab FIRST, then the
//      seed (a different order): the seed's calls are still all served;
//   4. a fresh realm with the memo OFF builds the seed;
// and the full registry digests of 2, 3 and 4 are equal. Each realm is its own
// process, so memory stays bounded to one build at a time.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, "..", "..", "..", "..");

function run(args: string[], env: Record<string, string>): string {
  const result = Bun.spawnSync(["bun", ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, FENEL_PARSER_LEGACY: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`realm failed (${args.join(" ")}): ${result.stderr.toString().slice(-2000)}`);
  return result.stdout.toString();
}

const lastJson = (out: string): Record<string, unknown> =>
  JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;

describe("replay artifact drift (seed, fresh realms, production constructors)", () => {
  test("record -> served realms (seed only, Local first) == memo-off realm", () => {
    const dir = join(repositoryRoot, ".tmp", `s1-replay-drift-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    try {
      const artifact = join(dir, "seed.gz");
      const recorded = run(["implementations/typescript/engine/scripts/record-engine-body-replay.ts", artifact, "seed"],
        { NODE_ENV: "production" });
      console.log(`[s1-replay-drift] ${recorded.trim().split("\n").at(-1)}`);
      expect(existsSync(`${artifact}.stamp.json`)).toBe(true);

      const fixture = join(here, "engine-body-memo-drift.fixture.ts");
      const served = (mode: string) => {
        const out = lastJson(run([fixture, mode], { NODE_ENV: "production", FENEL_ENGINE_BODY_REPLAY: artifact }));
        console.log(`[s1-replay-drift] ${mode}: seed build ${out.buildMs} ms, digest ${out.digestMs} ms, ${JSON.stringify(out.status)}, local ${JSON.stringify(out.local)}, seed calls ${out.calls} artifactHits ${out.artifactHits} hits ${out.hits} computed ${out.computed}`);
        expect((out.status as { accepted: boolean }).accepted).toBe(true);
        expect(out.computed).toBe(0);
        expect(out.calls as number).toBeGreaterThan(7000);
        return out;
      };
      const seedOnly = served("prod-replay");
      const localFirst = served("prod-replay-local-first");
      expect((localFirst.local as { calls: number }).calls).toBeGreaterThan(0);

      const cold = lastJson(run([fixture, "prod-cold"], { NODE_ENV: "test" }));
      console.log(`[s1-replay-drift] prod-cold: seed build ${cold.buildMs} ms, digest ${cold.digestMs} ms`);
      expect(seedOnly.digest).toEqual(cold.digest);
      expect(localFirst.digest).toEqual(cold.digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 5_400_000);
});
