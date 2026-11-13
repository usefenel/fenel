// C1/C2 host-boundary controls. Fresh realms and source-extracted admission
// functions avoid importing dispatch or constructing the registry/harness.
import "./engine-body-host-install";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRelativePath } from "../scripts/lib/artifact-bytes";
import { censusSourceAcquisitions } from "../scripts/lib/compiled-artifact-acquisition";
import { sealEngineBodyHostState } from "./engine-body-host-state";
import { ENGINE_BODY_MEMO_KEY_FORMAT } from "./engine-body-memo";
import { openPinnedReplayArtifactText, openStampedReplayArtifactText, replayArtifactText } from "./engine-body-replay";

const here = dirname(fileURLToPath(import.meta.url));
const epoch = "e".repeat(64);
const otherEpoch = "f".repeat(64);
const transpiler = new Bun.Transpiler({ loader: "ts" });

function runRealm(code, env = {}) {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], {
    cwd: here, stdout: "pipe", stderr: "pipe", timeout: 5_000,
    env: { ...process.env, FENEL_ENGINE_BODY_REPLAY: "", FENEL_SIMULATE_BROWSER: "",
      FENEL_ENGINE_BODY_MEMO: "1", FENEL_ENGINE_BODY_MEMO_MB: "", NODE_ENV: "production", ...env },
  });
  if (result.exitCode !== 0) throw new Error(`child realm failed: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString().trim());
}

function actualFunction(file, name) {
  const source = readFileSync(join(here, file), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`missing top-level function ${file}:${name}`);
  return transpiler.transformSync(source.slice(start, end + 2));
}

const admissionCode = actualFunction("engine-bodies-dispatch.ts", "activeReplayArtifact");
const browserInstallCode = actualFunction("engine-bodies-dispatch.ts", "installEngineBodyReplayArtifactText");
const captureCode = actualFunction("engine-body-host-install.ts", "captureReplay");

test("the bounded portable import closure cannot acquire either host adapter, even indirectly", () => {
  const portable = new Set(["engine-body-host-state", "engine-require", "engine-body-memo",
    "engine-body-replay", "engine-body-value-transport", "validation-canonical-bytes",
    "proxy-tracking", "proxy-tracking-state"]);
  const moduleKinds = new Set(["static-module", "dynamic-module", "commonjs-module", "module-resolve"]);
  for (const name of portable) {
    const source = readFileSync(join(here, `${name}.ts`), "utf8");
    const census = censusSourceAcquisitions(repositoryRelativePath(`implementations/typescript/engine/src/${name}.ts`), source);
    expect(census.computedFileAcquisitions).toEqual([]);
    expect(census.dynamicCodeConstructors).toEqual([]);
    expect(census.hostSensitiveOperations).toEqual([]);
    if (name === "engine-body-host-state") expect(census.acquisitions).toEqual([]);
    for (const edge of census.acquisitions) {
      // Existing lazy canary lookup: this test deliberately does not claim to
      // census the full engine dependency graph reached by engineRequire.
      if (name === "proxy-tracking" && edge.kind === "engine-require" && edge.specifier === "type-foundation") continue;
      expect(moduleKinds.has(edge.kind)).toBe(true);
      expect(edge.specifier.startsWith("./")).toBe(true);
      expect(portable.has(edge.specifier.slice(2).replace(/\.ts$/, ""))).toBe(true);
    }
  }
});

function fixtureCapture() {
  const text = replayArtifactText({ sourceEpoch: epoch, harnessCertificate: "certificate", hookGeneration: 4 }, [
    { keyDigest: "key", fnId: "engine:fixture", value: { answer: 42 } },
  ]);
  return { epoch, text, stamp: {
    schema: "fenel.engine-body-replay.stamp.v1", artifactSha256: "a".repeat(64),
    textDigest: createHash("sha256").update(text, "utf16le").digest("hex"),
    sourceEpoch: epoch, keyFormat: ENGINE_BODY_MEMO_KEY_FORMAT,
  }, verifyEpoch: () => true };
}

function admission(captured, { certificate = "certificate", beforeCertificate = () => {} } = {}) {
  const events = [];
  const scope = {
    engineBodyReplayHostCapture: () => captured,
    engineHarnessCertificate: () => { events.push("certificate"); beforeCertificate(); return certificate; },
    evaluatorHookGenerationForMemo: () => 4,
    openStampedReplayArtifactText: (...args) => { events.push("open"); return openStampedReplayArtifactText(...args); },
    openPinnedReplayArtifactText,
  };
  const api = new Function(...Object.keys(scope), `let replayArtifactState;
    ${admissionCode}
    ${browserInstallCode}
    return { active: activeReplayArtifact, installBrowser: installEngineBodyReplayArtifactText,
      decision: () => replayArtifactState };`)(...Object.values(scope));
  return { ...api, events };
}

function captureObserver({ file = "fixture.gz", args = [], simulate = "", origin = 100,
  initialEpoch = { digest: epoch, latestMtimeMs: 99 }, opened = fixtureCapture() } = {}) {
  let current = initialEpoch;
  const events = [];
  const scope = {
    process: { env: { FENEL_ENGINE_BODY_REPLAY: file, FENEL_SIMULATE_BROWSER: simulate }, execArgv: args },
    performance: { timeOrigin: origin }, repositoryRoot: "controlled-repository",
    computeEngineBodyReplaySourceEpoch: (root) => {
      events.push(["epoch", root]);
      if (current instanceof Error) throw current;
      return current;
    },
    readPinnedReplayArtifactFile: (path) => { events.push(["read", path]); return opened; },
  };
  const capture = new Function(...Object.keys(scope), `${captureCode}; return captureReplay;`)(...Object.values(scope));
  return { capture, events, setEpoch: (next) => { current = next; } };
}

describe("explicit engine host startup", () => {
  test("a root without preload seals an empty handoff and rejects a late installation", () => {
    expect(runRealm(`
      const root = await import("./engine-require.ts");
      const state = await import("./engine-body-host-state.ts");
      const empty = state.sealEngineBodyHostState();
      let lateRejected = false;
      try { state.installEngineBodyHostState({}); } catch { lateRejected = true; }
      console.log(JSON.stringify({ keys: Object.keys(empty), frozen: Object.isFrozen(empty), lateRejected,
        memoEmpty: root.engineBodyMemoHostServices() === undefined,
        replayEmpty: root.engineBodyReplayHostCapture() === undefined,
        binding: root.engineBodyReplaySourceEpochBinding() }));
    `)).toEqual({ keys: [], frozen: true, lateRejected: true, memoEmpty: true, replayEmpty: true,
      binding: { refused: "host replay preload was not installed" } });
  });

  test("installation copies and freezes the snapshot, services, capture and stamp", () => {
    expect(runRealm(`
      const state = await import("./engine-body-host-state.ts");
      const stamp = { sourceEpoch: "original", textDigest: "digest" };
      const verifyEpoch = () => true;
      const memo = { buildFingerprint: "original-host" };
      const replay = { epoch: "original", text: "original text", stamp, verifyEpoch };
      const supplied = { memo, replay };
      state.installEngineBodyHostState(supplied);
      let duplicateRejected = false;
      try { state.installEngineBodyHostState({}); } catch { duplicateRejected = true; }
      stamp.sourceEpoch = "changed";
      memo.buildFingerprint = "changed-host";
      replay.text = "changed text";
      replay.verifyEpoch = () => false;
      supplied.replay = {};
      const root = await import("./engine-require.ts");
      const captured = root.engineBodyReplayHostCapture();
      const installed = state.sealEngineBodyHostState();
      console.log(JSON.stringify({ duplicateRejected,
        copies: installed !== supplied && installed.memo !== memo && captured !== replay && captured.stamp !== stamp,
        frozen: [installed, installed.memo, captured, captured.stamp].every(Object.isFrozen),
        memo: installed.memo.buildFingerprint, text: captured.text, epoch: captured.stamp.sourceEpoch,
        originalVerifier: captured.verifyEpoch === verifyEpoch && captured.verifyEpoch(),
        sameRootCapture: installed.replay === captured }));
    `)).toEqual({ duplicateRejected: true, copies: true, frozen: true, memo: "original-host",
      text: "original text", epoch: "original", originalVerifier: true, sameRootCapture: true });
  });

  test("the official host installer publishes working native services without loading the engine graph", () => {
    expect(runRealm(`
      const { createHash } = await import("node:crypto");
      await import("./engine-body-host-install.ts");
      const rootWasLoaded = require.cache[require.resolve("./engine-require.ts")] !== undefined;
      const root = await import("./engine-require.ts");
      const host = root.engineBodyMemoHostServices();
      const value = "native \\ud800 hash";
      const bytes = Uint8Array.from([0, 1, 127, 255]);
      const pair = Proxy.revocable({}, {});
      pair.revoke();
      const enabled = host.memoEnabled();
      process.env.FENEL_ENGINE_BODY_MEMO = "0";
      process.env.FENEL_ENGINE_BODY_MEMO_MB = "3";
      console.log(JSON.stringify({ rootWasLoaded, frozen: Object.isFrozen(host),
        proxy: host.isProxy(pair.proxy) && !host.isProxy({}),
        hash: host.sha256Encoding(value) === createHash("sha256").update(value, "utf16le").digest("hex"),
        roundTrip: [...host.inflateKey(host.deflateKey(bytes))], now: Number.isFinite(host.now()),
        fingerprint: host.buildFingerprint.startsWith("engine:bun-"), enabled, disabled: !host.memoEnabled(),
        cap: host.memoCapBytes(), replay: root.engineBodyReplayHostCapture(),
        graphLoaded: ["./registry.ts", "./engine-bodies-dispatch.ts"].some(path => require.cache[require.resolve(path)] !== undefined) }));
    `)).toEqual({ rootWasLoaded: false, frozen: true, proxy: true, hash: true, roundTrip: [0, 1, 127, 255],
      now: true, fingerprint: true, enabled: true, disabled: true, cap: 3 * 1024 * 1024,
      replay: { refused: "no artifact configured" }, graphLoaded: false });
  });

  test("simulated browser installation leaves memo services empty and never binds source bytes", () => {
    expect(runRealm(`
      await import("./engine-body-host-install.ts");
      const root = await import("./engine-require.ts");
      console.log(JSON.stringify({ memoEmpty: root.engineBodyMemoHostServices() === undefined,
        replay: root.engineBodyReplayHostCapture(), unavailable: root.hostRequireUnavailable() }));
    `, { FENEL_SIMULATE_BROWSER: "1", FENEL_ENGINE_BODY_REPLAY: "unreadable-fixture.gz" }))
      .toEqual({ memoEmpty: true, replay: { refused: "no host to bind a source epoch" }, unavailable: true });
  });
});

describe("actual replay admission with a controlled harness", () => {
  test("initializes the certificate before rechecking source bytes, then admits exact captured text once", () => {
    const captured = fixtureCapture();
    const realm = admission(captured);
    captured.verifyEpoch = () => { realm.events.push("verify"); return true; };
    const artifact = realm.active();
    expect(artifact?.lookup("key")).toEqual({ value: { answer: 42 } });
    expect(realm.events).toEqual(["certificate", "verify", "open"]);
    captured.verifyEpoch = () => { throw new Error("must not recheck a decided realm"); };
    expect(realm.active()).toBe(artifact);
    expect(realm.events).toEqual(["certificate", "verify", "open"]);
  });

  for (const [name, verifier] of [["missing", undefined], ["false", () => false],
    ["non-boolean", () => 1], ["throwing", () => { throw new Error("unreadable source"); }]]) {
    test(`${name} source verifier refuses before artifact opening and caches the refusal`, () => {
      const captured = { ...fixtureCapture(), verifyEpoch: verifier };
      const realm = admission(captured);
      expect(realm.active()).toBeUndefined();
      expect(realm.decision()).toEqual({ artifact: undefined, refused: "source epoch changed before replay admission" });
      captured.verifyEpoch = () => true;
      expect(realm.active()).toBeUndefined();
      expect(realm.events).toEqual(["certificate"]);
    });
  }

  test("absent host capture and incomplete captures never initialize the harness or open text", () => {
    for (const captured of [undefined, {}, { epoch }, { epoch, text: "incomplete" }, { refused: "capture refused" }]) {
      const realm = admission(captured);
      expect(realm.active()).toBeUndefined();
      expect(realm.events).toEqual([]);
      expect(realm.decision().refused).toBe(captured?.refused ?? "host replay preload was not installed");
    }
  });

  test("portable integrity refusal remains cached even if the offered bytes are repaired", () => {
    const captured = fixtureCapture();
    const originalText = captured.text;
    captured.text += "tampered";
    const realm = admission(captured);
    expect(realm.active()).toBeUndefined();
    expect(realm.decision().refused).toBe("artifact digest differs from its pin");
    captured.text = originalText;
    expect(realm.active()).toBeUndefined();
    expect(realm.events).toEqual(["certificate", "open"]);
  });

  test("sealing an empty host handoff does not block the separate browser artifact installation", () => {
    expect(Object.isFrozen(sealEngineBodyHostState())).toBe(true);
    const captured = fixtureCapture();
    const realm = admission(undefined);
    const pin = { textDigest: captured.stamp.textDigest, sourceEpoch: epoch };
    expect(realm.installBrowser(captured.text, pin)).toEqual({ accepted: true });
    expect(realm.active()?.lookup("key")).toEqual({ value: { answer: 42 } });
    expect(realm.installBrowser(captured.text, pin)).toEqual({
      accepted: false, refused: "an artifact decision was already made in this realm",
    });
    expect(realm.events).toEqual(["certificate"]);
  });
});

describe("actual startup capture with controlled source observations", () => {
  test("an unconfigured artifact performs no source hashing or file read", () => {
    const observer = captureObserver({ file: "" });
    expect(observer.capture()).toEqual({ refused: "no artifact configured" });
    expect(observer.events).toEqual([]);
  });

  for (const arg of ["--hot", "--watch", "--hot=true", "--watch=always"]) {
    test(`${arg} refuses before source hashing or file read`, () => {
      const observer = captureObserver({ args: [arg] });
      expect(observer.capture()).toEqual({ refused: "the process runs under --hot/--watch" });
      expect(observer.events).toEqual([]);
    });
  }

  test("bytes changed before capture cannot match an older artifact stamp", () => {
    const observer = captureObserver({ initialEpoch: { digest: otherEpoch, latestMtimeMs: 99 } });
    expect(observer.capture()).toEqual({ epoch: otherEpoch, refused: "source epoch differs" });
    expect(observer.events).toEqual([["epoch", "controlled-repository"], ["read", "fixture.gz"]]);
  });

  test("source modification since process start refuses before artifact IO", () => {
    for (const settings of [{ initialEpoch: { digest: epoch, latestMtimeMs: 101 } }, { origin: NaN }]) {
      const observer = captureObserver(settings);
      expect(observer.capture()).toEqual({ refused: "a source file was modified after the process started" });
      expect(observer.events).toEqual([["epoch", "controlled-repository"]]);
    }
  });

  test("the observer closes source drift during artifact IO and engine/harness loading", () => {
    for (const next of [{ digest: otherEpoch, latestMtimeMs: 99 }, { digest: epoch, latestMtimeMs: 101 },
      new Error("source became unreadable")]) {
      const observer = captureObserver();
      const captured = observer.capture();
      expect(captured.epoch).toBe(epoch);
      const realm = admission(captured, { beforeCertificate: () => observer.setEpoch(next) });
      expect(realm.active()).toBeUndefined();
      expect(realm.decision().refused).toBe("source epoch changed before replay admission");
      expect(realm.events).toEqual(["certificate"]);
      expect(observer.events).toEqual([["epoch", "controlled-repository"], ["read", "fixture.gz"],
        ["epoch", "controlled-repository"]]);
    }
  });

  test("unchanged captured bytes admit through the actual portable opener", () => {
    const observer = captureObserver();
    const captured = observer.capture();
    const realm = admission(captured);
    expect(realm.active()?.lookup("key")).toEqual({ value: { answer: 42 } });
    expect(observer.events).toEqual([["epoch", "controlled-repository"], ["read", "fixture.gz"],
      ["epoch", "controlled-repository"]]);
  });

  test("unreadable source or refused artifact is kept as a non-executable refusal", () => {
    const unavailable = captureObserver({ initialEpoch: new Error("unreadable") });
    expect(unavailable.capture()).toEqual({ refused: "source epoch unavailable" });
    expect(unavailable.events).toEqual([["epoch", "controlled-repository"]]);
    const observer = captureObserver({ opened: { refused: "artifact digest differs from its pin" } });
    const captured = observer.capture();
    expect(captured).toEqual({ epoch, refused: "artifact digest differs from its pin" });
    const realm = admission(captured);
    expect(realm.active()).toBeUndefined();
    expect(realm.events).toEqual([]);
  });
});
