// S1b (c) — exact Proxy detection without node:util, through the realm-local
// tracking wrapper. Each case runs in a FRESH bun realm with
// FENEL_SIMULATE_BROWSER=1 (no host require, so no util.types.isProxy), so the
// memo's encoder can only use the tracker.
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function runRealm(args: string[]): Record<string, unknown> {
  const result = Bun.spawnSync(["bun", ...args], {
    cwd: here,
    env: { ...process.env, FENEL_SIMULATE_BROWSER: "1", NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = result.stdout.toString().trim().split("\n").at(-1) ?? "";
  if (result.exitCode !== 0) throw new Error(`realm failed: ${result.stderr.toString()}`);
  return JSON.parse(out) as Record<string, unknown>;
}

describe("realm-local proxy tracking (no node:util)", () => {
  test("the shared state leaf is inert and the installer imports only that leaf", async () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const state = await Bun.file(join(here, "proxy-tracking-state.ts")).text();
    const installer = await Bun.file(join(here, "proxy-tracking-install.ts")).text();
    const reader = await Bun.file(join(here, "proxy-tracking.ts")).text();
    expect(transpiler.scanImports(state)).toEqual([]);
    expect(transpiler.scanImports(installer).map(({ path, kind }) => ({ path, kind })))
      .toEqual([{ path: "./proxy-tracking-state", kind: "import-statement" }]);
    expect(state).not.toMatch(/\b(?:globalThis|performance|Date|process|require)\b/);
    expect(reader).not.toContain("globalThis");
  });

  test("installation is idempotent, detector publication is single-assignment, and a separate state copy stays empty", () => {
    const code = `
      const state = await import("./proxy-tracking-state.ts");
      const before = state.getProxyTrackingDetector();
      await import("./proxy-tracking-install.ts");
      const constructor = Proxy;
      const detector = state.getProxyTrackingDetector();
      await import("./proxy-tracking-install.ts?again");
      const duplicate = await import("./proxy-tracking-state.ts?duplicate");
      let refused = false;
      try { state.installProxyTrackingDetector(() => false); } catch { refused = true; }
      const pair = Proxy.revocable({}, {});
      pair.revoke();
      console.log(JSON.stringify({ before: before === null, sameConstructor: Proxy === constructor,
        sameDetector: state.getProxyTrackingDetector() === detector, refused,
        separate: duplicate.getProxyTrackingDetector() === null,
        revoked: detector(pair.proxy), functionProxy: detector(new Proxy(() => 1, {})),
        ordinary: [null, undefined, 1, "x", {}, () => 1].every(value => !detector(value)) }));
    `;
    expect(runRealm(["-e", code])).toEqual({ before: true, sameConstructor: true, sameDetector: true,
      refused: true, separate: true, revoked: true, functionProxy: true, ordinary: true });
  });

  test("a forged old global marker cannot supply the detector or claim early installation", () => {
    const code = `
      globalThis[Symbol.for("fenel.proxy-tracking.v1")] = { tracked: new WeakSet() };
      const root = await import("./engine-require.ts");
      const tracking = await import("./proxy-tracking.ts");
      console.log(JSON.stringify({ early: root.proxyTrackingInstalledBeforeEngine(),
        detector: tracking.trackedProxyDetector() === null }));
    `;
    expect(runRealm(["-e", code])).toEqual({ early: false, detector: true });
  });

  test("a canary made before installation still withholds the detector", () => {
    const code = `
      const escaped = new Proxy({}, {});
      await import("./proxy-tracking-install.ts");
      const root = await import("./engine-require.ts");
      root.registerEngineModule("type-foundation", { Str: escaped });
      const tracking = await import("./proxy-tracking.ts");
      console.log(JSON.stringify({ early: root.proxyTrackingInstalledBeforeEngine(),
        detector: tracking.trackedProxyDetector() === null }));
    `;
    expect(runRealm(["-e", code])).toEqual({ early: true, detector: true });
  });

  test("dynamic worker entry preserves early installation and refuses a hoisted engine", () => {
    expect(runRealm([join(here, "proxy-tracking-pattern-entry.fixture.ts")])).toEqual({ order: "ok", proxy: "proxy" });
    const bad = runRealm([join(here, "proxy-tracking-pattern-bad.fixture.ts")]);
    expect(bad.order).toContain("installed after the engine's root");
    expect(bad.proxy).toBe("no host proxy detector");
  });

  test("browser memo keeps exact long keys without the compression-only digest storage", () => {
    const code = `
      await import("./proxy-tracking-install.ts");
      const m = await import("./engine-body-memo.ts");
      let computations = 0;
      const host = {
        codeState: () => "browser-pool",
        deterministicLeaves: () => new Set(),
        hostVariantLeaves: () => new Set(),
        compute: () => { computations++; return { answer: 42 }; },
      };
      const call = () => m.withEngineBodyMemoPartition("browser", () =>
        m.memoizedEngineBodyCall("t:long-browser", ["k".repeat(70_000)], host));
      const first = call();
      const second = call();
      console.log(JSON.stringify({ first, second, computations,
        digestEntries: m.__breakEngineBodyMemoKeyChecksForTests() }));
    `;
    expect(runRealm(["-e", code])).toEqual({
      first: { answer: 42 }, second: { answer: 42 }, computations: 1, digestEntries: 0,
    });
  }, 60_000);

  test("installed first: proxies made by LATER modules (at load and at run time) are refused; plain data is encoded", () => {
    expect(runRealm([join(here, "proxy-tracking-first.fixture.ts")])).toEqual({
      madeAtLoad: "proxy",
      revocableAtLoad: "proxy",
      later: "proxy",
      nested: "proxy",
      plain: "ok",
      constructorStillWorks: true,
      callWithoutNewThrows: true,
    });
  }, 120_000);

  test("installed after an engine module completed: the detector is withheld, every call is refused", () => {
    expect(runRealm([join(here, "proxy-tracking-late.fixture.ts")])).toEqual({ plain: "no host proxy detector" });
  }, 120_000);

  test("not installed: every call is refused", () => {
    const memo = join(here, "engine-body-memo.ts").replace(/\\/g, "/");
    const code = `const m = await import(${JSON.stringify(memo)}); const s = m.snapshotEngineBodyArguments([{ plain: 1 }]); console.log(JSON.stringify({ plain: s.ok ? "ok" : s.reason }));`;
    expect(runRealm(["-e", code])).toEqual({ plain: "no host proxy detector" });
  }, 120_000);
});
