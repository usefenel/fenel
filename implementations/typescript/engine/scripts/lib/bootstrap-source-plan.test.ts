import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseCacheKey } from "../../src/parse-cache-key";
import { prepareBootstrapSources } from "./bootstrap-source-plan";
import { PARSER_BOOTSTRAP_JSON } from "../../src/generated/parser-bootstrap.generated";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("generated bootstrap seed embeds source text matching every recorded content key", () => {
  const entries = Object.values(JSON.parse(PARSER_BOOTSTRAP_JSON)) as Array<{ srcHash: string; source?: string }>;
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(typeof entry.source).toBe("string");
    expect(parseCacheKey(entry.source!)).toBe(entry.srcHash);
  }
});

function fixture(early = false) {
  const repoRoot = mkdtempSync(join(tmpdir(), "fenel-historical-bootstrap-"));
  roots.push(repoRoot);
  const path = "fenel/std/carrier.fenel";
  const fixed = "fenel/std/parser-fixities.fenel";
  const engineSrc = join(repoRoot, "implementations/typescript/engine/src");
  mkdirSync(engineSrc, { recursive: true });
  mkdirSync(join(repoRoot, "fenel/std"), { recursive: true });
  const old = "code = String | value in /^[a-z]$/\n";
  const current = "code = String | value in /^[A-Z]$/\n";
  writeFileSync(join(repoRoot, path), current);
  writeFileSync(join(repoRoot, fixed), "fixities = []\n");
  writeFileSync(join(engineSrc, "type-foundation.ts"), early ? `import raw from "../../../../${path}?raw";` : "");
  const seedEntries = {
    [path]: { srcHash: parseCacheKey(old), ast: {} },
    [fixed]: { srcHash: parseCacheKey("fixities = []\n"), ast: {} },
  };
  return { repoRoot, engineSrc, path, old, current, seedEntries };
}

test("historical warmup accepts only exact recorded bytes, without touching current source", () => {
  const f = fixture(true);
  const plan = prepareBootstrapSources({ ...f, findHistorical: () => f.old });
  expect(plan.ok).toBe(true);
  expect(plan.historical).toEqual([f.path]);
  expect(plan.sources.get(join(f.repoRoot, f.path))).toBe(f.old);
  expect(readFileSync(join(f.repoRoot, f.path), "utf8")).toBe(f.current);
  for (const candidate of [undefined, f.current]) {
    const denied = prepareBootstrapSources({ ...f, findHistorical: () => candidate });
    expect(denied.ok).toBe(false);
    expect(denied.refusals.join("\n")).toContain("no historical bytes match");
  }
});

test("new early carriers remain a pre-engine refusal; late carriers wait for warmup", () => {
  for (const early of [true, false]) {
    const f = fixture(early);
    const seedEntries = Object.fromEntries(Object.entries(f.seedEntries).filter(([path]) => path !== f.path));
    const plan = prepareBootstrapSources({ ...f, seedEntries });
    expect(plan.ok).toBe(!early);
    expect(plan.sources.has(join(f.repoRoot, f.path))).toBe(false);
  }
});

test("an uncommitted seed retains verified source bytes for the next edit", () => {
  const f = fixture(true);
  const seedEntries = { ...f.seedEntries, [f.path]: { ...f.seedEntries["fenel/std/carrier.fenel"], source: f.old } };
  const plan = prepareBootstrapSources({ ...f, seedEntries, findHistorical: () => { throw new Error("Git history is unnecessary for embedded recorded bytes"); } });
  expect(plan.ok).toBe(true);
  expect(plan.sources.get(join(f.repoRoot, f.path))).toBe(f.old);
  const invalid = prepareBootstrapSources({ ...f, seedEntries, recordedSources: { [f.path]: f.current } });
  expect(invalid.ok).toBe(false);
  const recovered = prepareBootstrapSources({ ...f, recordedSources: { [f.path]: f.old } });
  expect(recovered.ok).toBe(true);
});

test("an incompatible seed AST ABI refuses before any historical lookup or engine import", () => {
  const f = fixture();
  const plan = prepareBootstrapSources({
    ...f, seedVersion: -1,
    findHistorical: () => { throw new Error("must not inspect historical source with incompatible ABI"); },
  });
  expect(plan.ok).toBe(false);
  expect(plan.refusals.join("\n")).toContain("AST ABI is incompatible");
  expect(plan.sources.size).toBe(0);
});

test("historical lookup selects the recorded key from an older commit, not HEAD", () => {
  const f = fixture(true);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: f.repoRoot, windowsHide: true, stdio: "pipe" });
  git("init", "--quiet");
  writeFileSync(join(f.repoRoot, f.path), f.old);
  git("add", "--", f.path);
  git("-c", "user.name=Bootstrap test", "-c", "user.email=bootstrap@example.invalid", "commit", "--quiet", "-m", "recorded seed source");
  writeFileSync(join(f.repoRoot, f.path), f.current);
  git("add", "--", f.path);
  git("-c", "user.name=Bootstrap test", "-c", "user.email=bootstrap@example.invalid", "commit", "--quiet", "-m", "current source");
  const plan = prepareBootstrapSources(f);
  expect(plan.ok).toBe(true);
  expect(plan.sources.get(join(f.repoRoot, f.path))).toBe(f.old);
  expect(readFileSync(join(f.repoRoot, f.path), "utf8")).toBe(f.current);
});

test("Bun raw imports warm from historical bytes and later imports read current bytes", () => {
  const f = fixture();
  const later = join(f.repoRoot, "fenel/std/later.fenel");
  writeFileSync(later, f.current);
  const modulePath = new URL("./bootstrap-source-plan.ts", import.meta.url).href;
  const probe = join(f.repoRoot, "probe.ts");
  writeFileSync(probe, `
    import assert from "node:assert/strict";
    import { withBootstrapSources } from ${JSON.stringify(modulePath)};
    const seedPath = ${JSON.stringify(join(f.repoRoot, f.path))};
    const laterPath = ${JSON.stringify(later)};
    const plan = { ok: true, warnings: [], refusals: [], historical: [], sources: new Map([[seedPath, ${JSON.stringify(f.old)}]]) };
    await withBootstrapSources(plan, async () => {
      const raw = await import(seedPath + "?raw");
      assert.equal(raw.default, ${JSON.stringify(f.old)});
    }, async () => {
      const raw = await import(laterPath + "?raw");
      assert.equal(raw.default, ${JSON.stringify(f.current)});
    });
    console.log("verified-history-and-live-source");
  `);
  const result = spawnSync(process.execPath, ["--no-env-file", probe], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("verified-history-and-live-source");
  expect(readFileSync(join(f.repoRoot, f.path), "utf8")).toBe(f.current);
});

test("an unexpected new imported carrier cannot enter the cold warmup graph", () => {
  const f = fixture();
  const modulePath = new URL("./bootstrap-source-plan.ts", import.meta.url).href;
  const probe = join(f.repoRoot, "probe-denied.ts");
  writeFileSync(probe, `
    import { withBootstrapSources } from ${JSON.stringify(modulePath)};
    await withBootstrapSources({ok:true,warnings:[],refusals:[],historical:[],sources:new Map()}, async () => {
      await import(${JSON.stringify(join(f.repoRoot, f.path) + "?raw")});
    }, async () => { throw new Error("must not reach current-source parsing"); });
  `);
  const result = spawnSync(process.execPath, ["--no-env-file", probe], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("new imported regex carrier cannot warm from the seed");
});

test("driver preflight cannot retain the old bootstrap module in the identity-collector process", () => {
  const f = fixture();
  const probe = join(f.repoRoot, "coordinator-cache.ts");
  const driver = new URL("../generate-identity-artifacts.ts", import.meta.url).href;
  const plan = new URL("./bootstrap-source-plan.ts", import.meta.url).href;
  writeFileSync(probe, `
    import assert from "node:assert/strict";
    import { runIdentityArtifactDriver } from ${JSON.stringify(driver)};
    const cached = () => Object.keys(require.cache).some((path) => path.includes("parser-bootstrap.generated"));
    assert.equal(cached(), false);
    let collected = false;
    const result = await runIdentityArtifactDriver({repositoryRoot:process.cwd(),matrix:"without"}, {
      stdout:()=>{},stderr:()=>{},
      runFreshChild:async()=>({exitCode:0,stdout:new Uint8Array()}),
      runCodenameLock:async()=>{
        assert.equal(cached(), false, "preflight must not pin the old seed before the writer child updates it");
        collected=true; throw new Error("stop before any identity writer");
      },
    });
    assert.equal(cached(),false,"a refusing preflight must not cache the seed either");
    assert.equal(collected,result.phases.find((phase)=>phase.name==="parser-bootstrap-preflight")?.status==="ok");
    await import(${JSON.stringify(plan)});
    assert.equal(cached(),true,"control: an in-process preflight import really does populate Bun's module cache");
    console.log("PASS isolated-preflight-cache");
  `);
  const child = spawnSync(process.execPath, ["--no-env-file", probe], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain("PASS isolated-preflight-cache");
});
