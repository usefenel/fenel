// S1b — the replay artifact's value transport and its acceptance checks.
// No registry is built here.
import "./engine-body-host-install";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRelativePath } from "../scripts/lib/artifact-bytes";
import { censusSourceAcquisitions } from "../scripts/lib/compiled-artifact-acquisition";
import {
  __replayPinDigestsForTests,
  decodeReplayValue,
  encodeReplayValue,
  openPinnedReplayArtifactText,
  openPinnedReplayArtifactTextAsync,
  openReplayArtifactText,
  replayArtifactText,
  type ReplayAcceptance,
  type ReplayArtifactPin,
} from "./engine-body-replay";
import { loadReplayArtifactFile, readPinnedReplayArtifactFile, writeReplayArtifact } from "./engine-body-replay-host";
import {
  copyEngineBodyValue,
  ENGINE_BODY_MEMO_KEY_FORMAT,
  sha256OfEncoding,
  snapshotEngineBodyArguments,
} from "./engine-body-memo";

const roundTrip = (v: unknown): unknown => decodeReplayValue(encodeReplayValue(v));

describe("replay value transport", () => {
  test("scalars, including the ones JSON cannot carry", () => {
    const back = roundTrip([1, "s", true, null, undefined, -0, NaN, Infinity, -Infinity, 12n]) as unknown[];
    expect(back.length).toBe(10);
    expect(back[4]).toBeUndefined();
    expect(Object.is(back[5], -0)).toBe(true);
    expect(Number.isNaN(back[6])).toBe(true);
    expect(back.slice(7)).toEqual([Infinity, -Infinity, 12n]);
  });

  test("the decoded graph has the original's canonical encoding (attributes, extensibility, sharing, cycles, Bytes)", () => {
    const shared = Object.freeze({ v: 1 });
    const hidden = Object.defineProperty({ a: 1 }, "h", { value: [2], enumerable: false, writable: false, configurable: true });
    const partly: unknown[] = [1, 2];
    Object.defineProperty(partly, 1, { writable: false });
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const original = [
      Object.freeze([shared, shared]), Object.assign(Object.create(null), { k: 2 }), Object.seal({ s: 3 }),
      hidden, partly, cyclic, new Uint8Array([0, 255, 7]), JSON.parse('{"__proto__": {"x": 1}}'),
      Object.preventExtensions({ p: 1 }),
    ];
    const back = roundTrip(original) as unknown[];
    const a = snapshotEngineBodyArguments([original]);
    const b = snapshotEngineBodyArguments([back]);
    if (!a.ok || !b.ok) throw new Error("unencodable");
    expect(b.key).toBe(a.key);
    const pair = back[0] as object[];
    expect(pair[0]).toBe(pair[1]);
    expect((back[5] as Record<string, unknown>).self).toBe(back[5]);
  });

  test("a decoded value can be copied by the memo's copier (it is plain data)", () => {
    expect(copyEngineBodyValue(roundTrip({ x: [1, { y: "z" }] })).ok).toBe(true);
  });

  test("functions, symbols, accessors and class instances are refused at write", () => {
    expect(() => encodeReplayValue({ f: () => 1 })).toThrow();
    expect(() => encodeReplayValue({ s: Symbol("x") })).toThrow();
    expect(() => encodeReplayValue(Object.defineProperty({}, "g", { get: () => 1, enumerable: true }))).toThrow();
    expect(() => encodeReplayValue(new Map())).toThrow();
  });
});

describe("replay artifact acceptance", () => {
  const E = "e".repeat(64);
  const live = (over: Partial<{ epoch: string | undefined; certificate: string | undefined; hooks: number }> = {}): ReplayAcceptance => ({
    sourceEpoch: () => ("epoch" in over ? over.epoch : E),
    harnessCertificate: () => ("certificate" in over ? over.certificate : "C"),
    hookGeneration: () => over.hooks ?? 4,
  });
  const header = { sourceEpoch: E, harnessCertificate: "C", hookGeneration: 4 };
  const entries = [
    { keyDigest: "d1", fnId: "engine:a", value: { ok: [1, 2] } },
    { keyDigest: "d2", fnId: "engine:b", hostChecks: [["std:lower", "case:X"]] as const, value: "v" },
  ];
  const text = replayArtifactText(header, entries);

  test("a matching realm accepts and looks entries up by key digest, fresh graph per lookup", () => {
    const opened = openReplayArtifactText(text, live());
    if ("refused" in opened) throw new Error(opened.refused);
    expect(opened.header.keyFormat).toBe(ENGINE_BODY_MEMO_KEY_FORMAT);
    const first = opened.lookup("d1");
    const second = opened.lookup("d1");
    expect(first?.value).toEqual({ ok: [1, 2] });
    expect(first?.value).not.toBe(second?.value);
    expect(opened.lookup("d2")).toEqual({ value: "v", hostChecks: [["std:lower", "case:X"]] });
    expect(opened.lookup("absent")).toBeUndefined();
  });

  test("every header mismatch refuses the whole artifact", () => {
    expect(openReplayArtifactText(text, live({ epoch: "f".repeat(64) }))).toEqual({ refused: "source epoch differs" });
    expect(openReplayArtifactText(text, live({ epoch: undefined }))).toEqual({ refused: "source epoch differs" });
    expect(openReplayArtifactText(text, live({ certificate: "other" }))).toEqual({ refused: "harness certificate differs" });
    expect(openReplayArtifactText(text, live({ hooks: 5 }))).toEqual({ refused: "hook generation differs" });
    const otherFormat = text.replace(`"keyFormat":${ENGINE_BODY_MEMO_KEY_FORMAT}`, `"keyFormat":${ENGINE_BODY_MEMO_KEY_FORMAT + 1}`);
    expect(openReplayArtifactText(otherFormat, live())).toEqual({ refused: "key format differs" });
    expect(openReplayArtifactText("garbage", live())).toEqual({ refused: "malformed artifact" });
  });

  test("malformed headers and index rows refuse through direct and pinned admission", () => {
    const fullHeader = JSON.parse(text.slice(0, text.indexOf("\n")));
    const rows: unknown[] = [
      null, 3, "row", {}, [],
      ["d", "engine:a", 4, 0, 1],
      ["d", "engine:a", [["std:lower"]], 0, 1],
      ["d", "engine:a", [["std:lower", 1]], 0, 1],
      ["d", "engine:a", null, -1, 1],
      ["d", "engine:a", null, 0.5, 1],
      ["d", "engine:a", null, 0, -1],
      ["d", "engine:a", null, 0, 4],
      ["d", "engine:a", null, 4, 0],
    ];
    const cases = [
      "null\n[]\n", "3\n[]\n", "[]\n[]\n",
      ...rows.map((row) => `${JSON.stringify({ ...fullHeader, entries: 1 })}\n${JSON.stringify([row])}\n0`),
      `${JSON.stringify({ ...fullHeader, entries: 2 })}\n${JSON.stringify([["d", "engine:a", null, 0, 1], ["d", "engine:b", null, 0, 1]])}\n0`,
    ];
    for (const body of cases) {
      expect("refused" in openReplayArtifactText(body, live())).toBe(true);
      expect("refused" in openPinnedReplayArtifactText(body, { textDigest: sha256OfEncoding(body), sourceEpoch: E }, live())).toBe(true);
    }
  });

  test("server: the integrity pin is verified before opening; any failure refuses", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".tmp", `s1-replay-pin-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    try {
      const file = join(dir, "a.gz");
      const { bytes, stamp } = writeReplayArtifact(header, entries);
      writeFileSync(file, bytes);
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "unreadable artifact or stamp" });
      writeFileSync(`${file}.stamp.json`, JSON.stringify(stamp));
      const capture = readPinnedReplayArtifactFile(file);
      if ("refused" in capture) throw new Error(capture.refused);
      expect(Object.isFrozen(capture)).toBe(true);
      expect(Object.isFrozen(capture.stamp)).toBe(true);
      expect(capture.text).toBe(text);
      const opened = loadReplayArtifactFile(file, live());
      expect("refused" in opened ? opened.refused : "accepted").toBe("accepted");
      const tampered = Uint8Array.from(bytes);
      tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
      writeFileSync(file, tampered);
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "artifact digest differs from its pin" });
      writeFileSync(file, bytes);
      writeFileSync(`${file}.stamp.json`, JSON.stringify({ ...stamp, keyFormat: 99 }));
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "malformed stamp" });
      writeFileSync(`${file}.stamp.json`, JSON.stringify({ ...stamp, sourceEpoch: "f".repeat(64) }));
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "source epoch differs" });
      writeFileSync(`${file}.stamp.json`, JSON.stringify({ ...stamp, textDigest: "f".repeat(64) }));
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "artifact digest differs from its pin" });
      for (const malformed of ["null", "[]", "{}", "not JSON"]) {
        writeFileSync(`${file}.stamp.json`, malformed);
        expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "malformed stamp" });
      }
      const notGzip = Buffer.from("not a gzip artifact");
      writeFileSync(file, notGzip);
      writeFileSync(`${file}.stamp.json`, JSON.stringify({ ...stamp, artifactSha256: createHash("sha256").update(notGzip).digest("hex") }));
      expect(loadReplayArtifactFile(file, live())).toEqual({ refused: "unreadable artifact" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("browser: the pinned text digest and a bundle epoch are required", () => {
    const pin = { textDigest: sha256OfEncoding(text), sourceEpoch: E };
    const rest = { harnessCertificate: () => "C", hookGeneration: () => 4 };
    expect("refused" in openPinnedReplayArtifactText(text, pin, rest)).toBe(false);
    expect(openPinnedReplayArtifactText(text, { ...pin, sourceEpoch: undefined }, rest))
      .toEqual({ refused: "no bundle source epoch (dev/serve mode)" });
    expect(openPinnedReplayArtifactText(text + " ", pin, rest)).toEqual({ refused: "artifact digest differs from its pin" });
  });

  // 1c (2026-11-01, fix round): the explicit `bytes-digest` pin. The loader
  // hands in the exact gzip bytes it decompressed; their SHA-256 against the
  // pinned 64-hex `artifactSha256` replaces the text digest. The wrong
  // `textDigest` below proves the skip: a checked text digest would refuse it.
  test("browser: a bytes-digest pin checks the bytes digest instead of the text digest", async () => {
    const rest = { harnessCertificate: () => "C", hookGeneration: () => 4 };
    const gzip = new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
    const artifactSha256 = createHash("sha256").update(gzip).digest("hex");
    const wrongText = "0".repeat(64);
    const pin = { kind: "bytes-digest", artifactSha256, bytes: gzip, textDigest: wrongText, sourceEpoch: E } as const;
    const before = __replayPinDigestsForTests();
    expect("refused" in openPinnedReplayArtifactText(text, pin, rest)).toBe(false);
    expect("refused" in await openPinnedReplayArtifactTextAsync(text, pin, rest)).toBe(false);
    // With a platform digest (WebCrypto) the same verdict.
    const subtle = { digest: (algorithm: string, data: Uint8Array<ArrayBuffer>) => crypto.subtle.digest(algorithm, data) };
    expect("refused" in await openPinnedReplayArtifactTextAsync(text, pin, rest, subtle)).toBe(false);
    const after = __replayPinDigestsForTests();
    expect({ text: after.text - before.text, bytes: after.bytes - before.bytes }).toEqual({ text: 0, bytes: 3 });
    // The skip is the text digest only: the epoch and the live checks still refuse.
    expect(openPinnedReplayArtifactText(text, { ...pin, sourceEpoch: undefined }, rest))
      .toEqual({ refused: "no bundle source epoch (dev/serve mode)" });
    expect(openPinnedReplayArtifactText(text, pin, { ...rest, harnessCertificate: () => "other" }))
      .toEqual({ refused: "harness certificate differs" });
  });

  test("browser: a tampered byte, a malformed or missing artifact digest, or missing bytes refuse a bytes-digest pin", async () => {
    const rest = { harnessCertificate: () => "C", hookGeneration: () => 4 };
    const gzip = new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
    const artifactSha256 = createHash("sha256").update(gzip).digest("hex");
    // Even with the CORRECT text digest: the pin kind is bytes-digest, so only the bytes count.
    const pin = { kind: "bytes-digest", artifactSha256, bytes: gzip, textDigest: sha256OfEncoding(text), sourceEpoch: E } as const;
    const tampered = new Uint8Array(gzip);
    tampered[20] = tampered[20]! ^ 1;
    const refusals: Record<string, readonly [ReplayArtifactPin, string]> = {
      tamperedByte: [{ ...pin, bytes: tampered }, "artifact bytes differ from their pin"],
      otherDigest: [{ ...pin, artifactSha256: "ab".repeat(32) }, "artifact bytes differ from their pin"],
      malformedHex: [{ ...pin, artifactSha256: "zz".repeat(32) }, "malformed bytes pin"],
      shortHex: [{ ...pin, artifactSha256: artifactSha256.slice(2) }, "malformed bytes pin"],
      upperHex: [{ ...pin, artifactSha256: artifactSha256.toUpperCase() }, "malformed bytes pin"],
      noDigest: [{ kind: "bytes-digest", bytes: gzip, textDigest: pin.textDigest, sourceEpoch: E }, "malformed bytes pin"],
      noBytes: [{ kind: "bytes-digest", artifactSha256, textDigest: pin.textDigest, sourceEpoch: E }, "malformed bytes pin"],
    };
    for (const [name, [refused, reason]] of Object.entries(refusals)) {
      expect({ name, opened: openPinnedReplayArtifactText(text, refused, rest) }).toEqual({ name, opened: { refused: reason } });
      expect({ name, opened: await openPinnedReplayArtifactTextAsync(text, refused, rest) }).toEqual({ name, opened: { refused: reason } });
    }
    // Every other pin checks the text digest: the default, the text-digest kind, an unknown kind.
    for (const other of [{ textDigest: "0".repeat(64), sourceEpoch: E }, { ...pin, kind: "text-digest", textDigest: "0".repeat(64) },
      { ...pin, kind: "fetch-integrity" as never, textDigest: "0".repeat(64) }] as ReplayArtifactPin[]) {
      expect(openPinnedReplayArtifactText(text, other, rest)).toEqual({ refused: "artifact digest differs from its pin" });
    }
  });
});

describe("replay host boundary", () => {
  test("the portable module has no file acquisition or host-adapter import", () => {
    const path = "implementations/typescript/engine/src/engine-body-replay.ts";
    const source = readFileSync(new URL("./engine-body-replay.ts", import.meta.url), "utf8");
    const census = censusSourceAcquisitions(repositoryRelativePath(path), source);
    expect(census.computedFileAcquisitions).toEqual([]);
    expect(census.hostSensitiveOperations).toEqual([]);
    expect(census.acquisitions.map((edge) => edge.specifier)).not.toContain("./engine-body-replay-host");
    expect(census.acquisitions.filter((edge) => edge.specifier.startsWith("node:"))).toEqual([]);
  });

  test("importing the host adapter and reading an artifact does not initialize the engine root", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const hostPath = join(here, "engine-body-replay-host.ts").replaceAll("\\", "/");
    const rootPath = join(here, "engine-require.ts").replaceAll("\\", "/");
    const dir = join(here, "..", "..", "..", "..", ".tmp", `s1-replay-host-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    try {
      const file = join(dir, "a.gz");
      const { bytes, stamp } = writeReplayArtifact({ sourceEpoch: "e".repeat(64), harnessCertificate: "C", hookGeneration: 4 }, []);
      writeFileSync(file, bytes);
      writeFileSync(`${file}.stamp.json`, JSON.stringify(stamp));
      const code = [
        `const host = await import(${JSON.stringify(hostPath)});`,
        `const root = require.resolve(${JSON.stringify(rootPath)});`,
        `const captured = host.readPinnedReplayArtifactFile(${JSON.stringify(file)});`,
        `const missing = host.readPinnedReplayArtifactFile(${JSON.stringify(join(dir, "missing.gz"))});`,
        'console.log(JSON.stringify({ accepted: !("refused" in captured), missing, rootLoaded: require.cache[root] !== undefined }));',
      ].join("\n");
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], {
        cwd: here, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, FENEL_ENGINE_BODY_REPLAY: "" },
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      expect(JSON.parse(result.stdout.toString())).toEqual({
        accepted: true, missing: { refused: "unreadable artifact or stamp" }, rootLoaded: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
