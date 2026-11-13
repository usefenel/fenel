// GP-24 step 1 — the measurement spike that decides how Fenel stops runaway
// server-side evaluation (docs/gopublic-server-safety-design.md § "GP-24").
//
// SKIPPED by default. Run it alone, under the machine-wide heavy lock:
//   FENEL_CELL_SPIKE=1 bun test --timeout 900000 ./implementations/typescript/api/src/cells.spike.test.ts
//
// It writes throwaway fixture scripts into the gitignored `.tmp-browser/cells-spike/`
// and prints one `[cells-spike]` JSON line per measurement plus a summary.
// It asserts almost nothing on purpose: a spike records what the host does.
//
// Safety caps (the host had under 2 GB free when this was written):
// - the in-process Worker experiments never allocate;
// - the memory experiment runs in a CHILD process, its hog allocates 8 MB
//   every ~10 ms, stops itself at 640 MB, and the parent kills the child
//   once it reports more than 512 MB above its baseline;
// - the registry boots are polled with `tasklist` and killed above 1500 MB.
//
// RESULTS (2026-09-24, Windows 10 Pro 19045, 8 logical CPUs, 16 GB RAM with
// 2-3 GB free, Bun 1.3.13, one run each; other sessions were working on the
// machine, so times are indicative):
//
// (a) Worker.terminate() DOES stop `while(true){}`. The close event arrived
//     1.2-11.8 ms after terminate() (median 1.6 ms, 5 runs); this process
//     burnt 0 CPU in the 500 ms after; a loop bumping a shared counter had
//     advanced 0 times in the 500 ms after close.
// (b) Workers accept `resourceLimits` and IGNORE it. With
//     maxOldGenerationSizeMb 64 the hog kept allocating: the host process went
//     from 112 MB to 638 MB RSS in about 1 s (the hog had 488 MB live), with no
//     error and no close event, until the test killed the host (62 ms).
//     An unbounded worker grows the whole process until the OS stops it.
// (c) Bun.spawn with `ipc` works on Windows: spawn to first message 45-56 ms,
//     IPC round trip median 0.1 ms (max 2.1 ms). A child spinning in
//     `while(true){}` stops answering and dies on kill("SIGKILL") in
//     10.8-14.9 ms; a booted cell with a 1.3 GB heap dies in 108 ms.
//     TRAP: an allowlisted `env` is not enough. Bun loads `.env` from the
//     cwd, so the child saw DATABASE_URL; with `--no-env-file` it did not.
// (d) Registry boot in a child (FENEL_PARSER_LEGACY=1, against a clean HEAD
//     snapshot of engine + fenel, because the working tree's engine was
//     mid-edit by another session and failed with FieldIdentityKernelError):
//     - std only, createRegistry([stdModule]) (480 functions): ready after
//       82.7 s = imports 44.0 s + build 36.5 s + first evaluation 1.6 s; warm
//       `add` under 0.05 ms; RSS 1300 MB after a full GC (heap 478 MB,
//       maxRSS 1.35 GB);
//     - system, getSystemRegistry() (what an API cell needs): did NOT finish
//       under the 1500 MB guard; working set about 1.07 GB at 5 s and 1.28 GB
//       at 21 s, killed at 1531 MB after 24.7 s. Under `bun --smol` it was
//       killed at 1519 MB after 31.9 s. So one API cell needs more than 1.5 GB
//       and more than 25 s to boot; its full cost is unmeasured on this machine;
//     - runtime, loadRegistry(): measured only against the working tree, where
//       it failed at the same identity error after 30.5 s at about 1.45 GB.
//     (d) ran before `--no-env-file` became the default here; the pure
//     registries read no database, so the numbers do not depend on it.
//
// VERDICT: cells (killable child processes). A Worker stops a loop as fast as
// a kill does, but it has no memory cap (resourceLimits is ignored) and shares
// the API's process and secrets; a worker also needs its own registry heap, so
// it saves nothing on boot. Fuel stops neither natives nor memory. The numbers
// also say a cell is EXPENSIVE: more than 1.5 GB and more than 25 s (likely
// minutes) per API cell, so pools must stay small, a kill costs a long
// rebuild, and cutting registry boot memory and time is its own work item.
// The watchdog cannot rely on the cell reporting its own RSS while it
// evaluates (evaluation holds the main thread): sample it from outside
// (cgroup MemoryMax on Linux; tasklist here worked at 500 ms).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const enabled = process.env["FENEL_CELL_SPIKE"] === "1";

const REPO = resolve(import.meta.dir, "../../../..");
// Point (d) at a clean snapshot when the working tree's engine is mid-edit:
//   git archive HEAD -- implementations/typescript/engine fenel .fenel.lock | tar -x -C .tmp-browser/cells-head
//   FENEL_CELL_SPIKE_ENGINE_ROOT=.tmp-browser/cells-head
// The engine finds `fenel/` and `.fenel.lock` relative to its own files, so the
// snapshot is self-contained; third-party packages resolve from the repo root.
const ENGINE_ROOT = process.env["FENEL_CELL_SPIKE_ENGINE_ROOT"];
const ENGINE_SRC = join(ENGINE_ROOT ? resolve(REPO, ENGINE_ROOT) : REPO, "implementations/typescript/engine/src");
const RUNTIME_SRC = join(REPO, "implementations/typescript/runtime/src");
const FIXTURES = join(REPO, ".tmp-browser/cells-spike");

const MB = 1024 * 1024;
const results: Record<string, unknown> = {};

function record(name: string, value: unknown): void {
  results[name] = value;
  console.log(`[cells-spike] ${name} ${JSON.stringify(value)}`);
}

function fixture(name: string, source: string): string {
  const file = join(FIXTURES, name);
  writeFileSync(file, source);
  return file;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

const round = (x: number) => Math.round(x * 10) / 10;

/** The environment a pure cell would get: enough for Windows and Bun to run,
 * and deliberately no DATABASE_URL or secrets. */
function allowlistedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE",
    "HOME", "LOCALAPPDATA", "APPDATA", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS"];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Working set of a (possibly busy) process, read from outside via tasklist.
 * The CSV's last field is "123 456 K" in any locale: keep the digits. */
async function workingSetMb(pid: number): Promise<number | null> {
  const p = Bun.spawn({
    cmd: ["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(p.stdout).text();
  await p.exited;
  const fields = text.trim().split(/","/);
  if (fields.length < 5) return null;
  const kb = Number((fields[4] ?? "").replace(/\D/g, ""));
  return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
}

type Spawned = ReturnType<typeof Bun.spawn>;

/** A child `bun` process with an IPC channel; messages are queued so a test
 * can await the next one of a given kind. */
/** `--no-env-file` matters: Bun auto-loads `.env` from the cwd, so without it
 * an allowlisted `env` still hands the child the repo's DATABASE_URL (see (c)). */
function spawnIpcChild(file: string, env: Record<string, string>, bunFlags: string[] = ["--no-env-file"]) {
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  const proc: Spawned = Bun.spawn({
    cmd: [process.execPath, ...bunFlags, file],
    cwd: REPO,
    env,
    stdout: "inherit",
    stderr: "inherit",
    ipc(message) {
      inbox.push({ ...(message as Record<string, unknown>), at: performance.now() });
      for (const wake of waiters.splice(0)) wake();
    },
  });
  async function next(kind: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const i = inbox.findIndex((m) => m["kind"] === kind || m["kind"] === "fatal");
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      if (proc.exitCode !== null || proc.signalCode !== null) {
        throw new Error(`the child exited (${proc.exitCode ?? proc.signalCode}) before a "${kind}" message`);
      }
      const left = deadline - performance.now();
      if (left <= 0) throw new Error(`no "${kind}" message within ${timeoutMs} ms`);
      await Promise.race([new Promise<void>((r) => waiters.push(r)), sleep(Math.min(left, 250))]);
    }
  }
  return { proc, inbox, next };
}

async function timeKill(proc: Spawned): Promise<{ killMs: number; exitCode: number | null; signalCode: string | null }> {
  const t0 = performance.now();
  proc.kill("SIGKILL");
  await proc.exited;
  return { killMs: round(performance.now() - t0), exitCode: proc.exitCode, signalCode: proc.signalCode };
}

describe.skipIf(!enabled)("GP-24 cells spike", () => {
  beforeAll(() => { mkdirSync(FIXTURES, { recursive: true }); });

  afterAll(() => {
    console.log(`[cells-spike] SUMMARY ${JSON.stringify(results, null, 2)}`);
    rmSync(FIXTURES, { recursive: true, force: true });
  });

  // (a) Is a Bun Worker running while(true){} stopped by terminate(), and how fast?
  test("(a) Worker.terminate() on a synchronous loop", async () => {
    const pureLoop = fixture("worker-spin.js", `postMessage("spinning"); while (true) {}`);
    const countingLoop = fixture("worker-spin-count.js", `
      self.onmessage = (e) => {
        const v = new Int32Array(e.data);
        postMessage("spinning");
        while (true) Atomics.add(v, 0, 1);
      };`);

    // Pure `while(true){}`: time from terminate() to the close event, and
    // whether this process keeps burning a CPU afterwards (a still-spinning
    // thread shows up as ~1 CPU-second per wall-second of user time).
    const runs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i++) {
      const w = new Worker(pureLoop);
      await new Promise<void>((r) => w.addEventListener("message", () => r(), { once: true }));
      await sleep(200);
      const closed = new Promise<number>((r) => w.addEventListener("close", () => r(performance.now()), { once: true }));
      const t0 = performance.now();
      w.terminate();
      const closeAt = await Promise.race([closed, sleep(5000).then(() => -1)]);
      const cpu0 = process.cpuUsage();
      const wall0 = performance.now();
      await sleep(500);
      const cpu = process.cpuUsage(cpu0);
      const wall = performance.now() - wall0;
      runs.push({
        closeMs: closeAt < 0 ? "no close event within 5 s" : round(closeAt - t0),
        cpuPerWallAfter: round((cpu.user + cpu.system) / 1000 / wall * 100) / 100,
      });
    }

    // Counter variant: proves the loop itself stopped, not just the event.
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    const w = new Worker(countingLoop);
    const spinning = new Promise<void>((r) => w.addEventListener("message", () => r(), { once: true }));
    w.postMessage(sab);
    await spinning;
    await sleep(200);
    const closed = new Promise<void>((r) => w.addEventListener("close", () => r(), { once: true }));
    const t0 = performance.now();
    w.terminate();
    const closedInTime = await Promise.race([closed.then(() => true), sleep(5000).then(() => false)]);
    const closeMs = round(performance.now() - t0);
    await sleep(50);
    const c1 = Atomics.load(view, 0);
    await sleep(500);
    const c2 = Atomics.load(view, 0);

    record("a.worker_terminate_pure_loop", {
      runs,
      medianCloseMs: median(runs.map((r) => (typeof r["closeMs"] === "number" ? r["closeMs"] : Infinity))),
    });
    record("a.worker_terminate_counting_loop", {
      closedWithin5s: closedInTime,
      closeMs,
      counterAdvancedInTheHalfSecondAfterClose: c2 - c1,
    });
    expect(runs.length).toBe(5);
  }, 120_000);

  // (b) Do Bun Workers accept resourceLimits? What happens to the process that
  // hosts a worker allocating without bound? Run in a child so the experiment
  // can be killed from outside.
  test("(b) Worker resourceLimits and an unbounded allocation", async () => {
    const hog = fixture("worker-hog.js", `
      const keep = [];
      let mb = 0;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (mb < 640) {              // self-cap: last line of defence
        const a = new Array(1 << 20);
        for (let i = 0; i < a.length; i++) a[i] = i + 0.5;   // ~8 MB of doubles
        keep.push(a);
        mb += 8;
        postMessage(mb);
        Atomics.wait(sleeper, 0, 0, 10);
      }
      postMessage("self-cap");
      Atomics.wait(sleeper, 0, 0, 60000);`);
    const host = fixture("worker-hog-host.js", `
      const opts = { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } };
      const base = process.memoryUsage().rss;
      let lastMb = 0;
      let w;
      try {
        w = new Worker(${JSON.stringify(hog)}, opts);
        process.send({ kind: "constructed", baseRss: base });
      } catch (e) {
        process.send({ kind: "constructed", threw: String(e), baseRss: base });
      }
      w.addEventListener("message", (e) => {
        if (typeof e.data === "number") lastMb = e.data;
        else process.send({ kind: "hog", data: String(e.data) });
      });
      w.addEventListener("error", (e) => process.send({ kind: "worker-error", message: String(e.message ?? e), lastMb }));
      w.addEventListener("close", (e) => process.send({ kind: "worker-close", code: e.code, lastMb }));
      setInterval(() => process.send({ kind: "rss", rss: process.memoryUsage().rss, lastMb }), 20);
      process.on("message", (m) => { if (m === "stop") process.exit(0); });`);

    const child = spawnIpcChild(host, allowlistedEnv());
    const constructed = await child.next("constructed", 30_000);
    const baseRss = Number(constructed["baseRss"]);
    const LIMIT = 512 * MB;
    const t0 = performance.now();
    let peakRss = baseRss;
    let lastMb = 0;
    let outcome = "timeout (60 s)";
    const events: string[] = [];
    while (performance.now() - t0 < 60_000) {
      await sleep(10);
      for (const m of child.inbox.splice(0)) {
        if (m["kind"] === "rss") {
          peakRss = Math.max(peakRss, Number(m["rss"]));
          lastMb = Number(m["lastMb"]);
        } else {
          events.push(JSON.stringify(m));
        }
      }
      if (events.some((e) => e.includes("worker-error") || e.includes("worker-close"))) {
        outcome = "the worker was stopped by the runtime (limit honoured?)";
        break;
      }
      if (events.some((e) => e.includes("self-cap"))) {
        outcome = "the worker reached its own 640 MB self-cap: no runtime limit fired";
        break;
      }
      if (peakRss - baseRss > LIMIT) {
        outcome = "the host process grew past base + 512 MB with no runtime limit firing; killed from outside";
        break;
      }
    }
    const elapsed = round(performance.now() - t0);
    const kill = await timeKill(child.proc);
    // After a runtime stop, is the host process still alive? (It was, if it
    // kept reporting RSS until we killed it.)
    record("b.worker_resource_limits", {
      constructed: constructed["threw"] ?? "accepted without error",
      requestedLimit: "maxOldGenerationSizeMb 64, maxYoungGenerationSizeMb 16",
      outcome,
      hogReportedMb: lastMb,
      hostBaseRssMb: round(baseRss / MB),
      hostPeakRssMb: round(peakRss / MB),
      msUntilOutcome: elapsed,
      events,
      killHostMs: kill.killMs,
    });
    expect(kill.killMs).toBeGreaterThanOrEqual(0);
  }, 120_000);

  // (c) Bun.spawn with ipc on Windows; is killing a spinning child immediate?
  test("(c) Bun.spawn ipc and killing a spinning child", async () => {
    const spinner = fixture("child-spin.js", `
      process.send({ kind: "ready", sinceOrigin: performance.now() });
      process.on("message", (m) => {
        if (m === "ping") process.send({ kind: "pong" });
        if (m === "spin") { process.send({ kind: "spinning" }); while (true) {} }
      });`);

    const runs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const child = spawnIpcChild(spinner, allowlistedEnv());
      const ready = await child.next("ready", 30_000);
      const spawnToReadyMs = round(Number(ready["at"]) - t0);

      const rtts: number[] = [];
      for (let k = 0; k < 20; k++) {
        const s = performance.now();
        child.proc.send("ping");
        await child.next("pong", 5000);
        rtts.push(performance.now() - s);
      }

      child.proc.send("spin");
      await child.next("spinning", 5000);
      await sleep(300);
      // A spinning child cannot answer: prove it before killing it.
      child.proc.send("ping");
      let answeredWhileSpinning = true;
      try { await child.next("pong", 500); } catch { answeredWhileSpinning = false; }
      const kill = await timeKill(child.proc);
      runs.push({
        spawnToReadyMs,
        childSawStartAtMs: round(Number(ready["sinceOrigin"])),
        ipcRttMedianMs: round(median(rtts)),
        ipcRttMaxMs: round(Math.max(...rtts)),
        answeredWhileSpinning,
        ...kill,
      });
    }
    record("c.spawn_ipc_and_kill", { runs, medianKillMs: median(runs.map((r) => Number(r["killMs"]))) });

    // Does an env allowlist keep DATABASE_URL out? Only with --no-env-file:
    // Bun loads `.env` from the cwd (the repo root here) on its own.
    const probe = fixture("child-env.js", `process.send({ kind: "env", hasDatabaseUrl: "DATABASE_URL" in process.env });`);
    const envProbe: Record<string, unknown> = {};
    for (const [label, flags] of [["default", []], ["--no-env-file", ["--no-env-file"]]] as const) {
      const child = spawnIpcChild(probe, allowlistedEnv(), [...flags]);
      envProbe[label] = (await child.next("env", 30_000))["hasDatabaseUrl"];
      await timeKill(child.proc);
    }
    record("c.env_allowlist_database_url_visible", envProbe);
    expect(runs.length).toBe(3);
  }, 120_000);

  // (d) Time and resident memory for a child to boot a pure evaluation
  // registry, with the environment allowlist a pure cell would get.
  // - `std`: createRegistry([stdModule]) — the lightest registry that still
  //   evaluates real Fenel (std's bodies, dispatch, the numeric tower);
  // - `system`: getSystemRegistry() — the pure repository registry the API
  //   builds for validation and dependent-type evaluation, what an API cell
  //   would use; `system-smol` is the same under `bun --smol`;
  // - `runtime`: the runtime's execute registry (loadRegistry), what an
  //   account cell builds. It is skipped with a snapshot engine: runtime/src
  //   reaches the engine through the `@fenel/engine` package, i.e. the
  //   working tree's.
  // FENEL_CELL_SPIKE_BOOT picks variants (comma list; default all four).
  const bootVariants = (process.env["FENEL_CELL_SPIKE_BOOT"] ?? "std,system,system-smol,runtime").split(",");
  const GUARD_MB = 1500;
  for (const variant of ["std", "system", "system-smol", "runtime"] as const) {
    const skip = !bootVariants.includes(variant) || (variant === "runtime" && ENGINE_ROOT !== undefined);
    test.skipIf(skip)(`(d) boot a ${variant} registry in a child with an allowlisted env`, async () => {
      const url = (file: string) => JSON.stringify(pathToFileURL(file).href);
      const load = {
        std: `const r = await import(${url(join(ENGINE_SRC, "registry.ts"))});
              const std = await import(${url(join(ENGINE_SRC, "modules/std.ts"))});
              const getRegistry = () => r.createRegistry([std.stdModule]);`,
        system: `const sys = await import(${url(join(ENGINE_SRC, "system-registry.ts"))});
                 const getRegistry = sys.getSystemRegistry;`,
        runtime: `const rt = await import(${url(join(RUNTIME_SRC, "evaluator.ts"))});
                  const getRegistry = rt.loadRegistry;`,
      }[variant === "system-smol" ? "system" : variant];
      const bootFile = fixture(`cell-boot-${variant}.js`, `
        const t0 = performance.now();
        process.on("message", (m) => {
          if (m === "spin") { process.send({ kind: "spinning" }); while (true) {} }
        });
        try {
          ${load}
          const jl = await import(${url(join(ENGINE_SRC, "json-logic.ts"))});
          const t1 = performance.now();
          const rssAfterImport = process.memoryUsage().rss;
          process.send({ kind: "imported", importMs: t1 - t0, rssAfterImportMb: rssAfterImport / ${MB} });
          const reg = getRegistry();
          const ctx = reg.evaluateContext();
          const t2 = performance.now();
          const first = jl.evaluate({ call: ["add", 1, 2] }, {}, ctx);
          const t3 = performance.now();
          const warm = [];
          for (let i = 0; i < 50; i++) {
            const s = performance.now();
            jl.evaluate({ call: ["add", i, 2] }, {}, ctx);
            warm.push(performance.now() - s);
          }
          warm.sort((a, b) => a - b);
          const rssBeforeGc = process.memoryUsage().rss;
          Bun.gc(true);
          const mu = process.memoryUsage();
          process.send({
            kind: "ready",
            processStartToScriptMs: t0,
            importMs: t1 - t0,
            registryBuildMs: t2 - t1,
            firstEvalMs: t3 - t2,
            warmEvalMedianMs: warm[25],
            result: first,
            functions: reg.listFunctions().length,
            rssAfterImportMb: rssAfterImport / ${MB},
            rssBeforeGcMb: rssBeforeGc / ${MB},
            rssAfterGcMb: mu.rss / ${MB},
            heapUsedMb: mu.heapUsed / ${MB},
            maxRssRaw: typeof process.resourceUsage === "function" ? process.resourceUsage().maxRSS : null,
            envHasDatabaseUrl: "DATABASE_URL" in process.env,
          });
        } catch (e) {
          process.send({ kind: "fatal", error: String(e && e.stack || e).slice(0, 1200) });
        }`);

      const env = allowlistedEnv({ FENEL_PARSER_LEGACY: "1", NODE_ENV: "production" });
      const t0 = performance.now();
      const child = spawnIpcChild(bootFile, env, variant === "system-smol" ? ["--no-env-file", "--smol"] : undefined);
      let peakWsMb = 0;
      let guardKilledAtMs: number | null = null;
      const timeline: Array<[number, number]> = [];   // [seconds since spawn, working set MB]
      const poll = (async () => {
        let lastSample = -Infinity;
        while (child.proc.exitCode === null && child.proc.signalCode === null) {
          const ws = await workingSetMb(child.proc.pid);
          const at = performance.now() - t0;
          if (ws !== null) {
            peakWsMb = Math.max(peakWsMb, ws);
            if (at - lastSample >= 5000) { timeline.push([Math.round(at / 1000), Math.round(ws)]); lastSample = at; }
            if (ws > GUARD_MB) { guardKilledAtMs = round(at); child.proc.kill("SIGKILL"); break; }
          }
          await sleep(500);
        }
      })();
      let imported: Record<string, unknown> | null = null;
      let ready: Record<string, unknown>;
      try {
        imported = await child.next("imported", 300_000);
        if (imported["kind"] === "fatal") throw new Error(String(imported["error"]));
        ready = await child.next("ready", 300_000);
      } catch (e) {
        ready = { kind: "fatal", error: String(e).slice(0, 1200) };
      }
      const spawnToReadyMs = round(performance.now() - t0);
      const wsAtReady = child.proc.exitCode === null && child.proc.signalCode === null
        ? await workingSetMb(child.proc.pid) : null;

      let kill: Record<string, unknown> = {};
      if (ready["kind"] === "ready") {
        // Kill a booted cell mid-loop: a large heap must not slow the kill.
        child.proc.send("spin");
        await child.next("spinning", 10_000);
        await sleep(300);
        kill = await timeKill(child.proc);
      } else if (child.proc.exitCode === null && child.proc.signalCode === null) {
        kill = await timeKill(child.proc);
      }
      await poll;

      const rounded = (m: Record<string, unknown> | null) =>
        m && Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "number" ? round(v) : v]));
      record(`d.boot_${variant}_registry`, {
        spawnToReadyMs,
        importedAtMs: imported && imported["at"] !== undefined ? round(Number(imported["at"]) - t0) : null,
        ...rounded(ready),
        workingSetAtReadyMb: wsAtReady === null ? null : round(wsAtReady),
        peakWorkingSetPolledMb: round(peakWsMb),
        guardKilledAtMs,
        workingSetTimeline: timeline,
        killBootedCell: kill,
      });
      expect(ready["kind"] === "ready" || ready["kind"] === "fatal").toBe(true);
    }, 700_000);
  }
});
