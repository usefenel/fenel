// Node/Bun startup only. Official host entries load this before the engine;
// portable engine source never imports it. Compiler owners use the empty host
// handoff and retain their independent, capability-denying render environment.
import crypto from "node:crypto";
import zlib from "node:zlib";
import { types } from "node:util";
import { fileURLToPath } from "node:url";
import { computeEngineBodyReplaySourceEpoch } from "../scripts/lib/engine-body-replay-epoch";
import { readPinnedReplayArtifactFile } from "./engine-body-replay-host";
import { installEngineBodyHostState, type EngineBodyReplayHostCapture } from "./engine-body-host-state";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const versions = process.versions;
const buildFingerprint = typeof versions.bun === "string"
  ? `engine:bun-${versions.bun}-webkit-${versions.webkit ?? "?"}`
  : `engine:node-${versions.node}-v8-${versions.v8}-icu-${versions.icu ?? "?"}-unicode-${versions.unicode ?? "?"}`;

function captureReplay(): EngineBodyReplayHostCapture {
  const file = process.env["FENEL_ENGINE_BODY_REPLAY"];
  if (file === undefined || file === "") return { refused: "no artifact configured" };
  if (process.execArgv.some((arg) => /^--(hot|watch)(=|$)/.test(arg))) {
    return { refused: "the process runs under --hot/--watch" };
  }
  if (process.env["FENEL_SIMULATE_BROWSER"] === "1") return { refused: "no host to bind a source epoch" };
  try {
    // Bind before engine evaluation; the later admission observer also closes
    // the interval occupied by artifact IO and loading the engine graph.
    const epoch = computeEngineBodyReplaySourceEpoch(repositoryRoot);
    if (!Number.isFinite(performance.timeOrigin) || epoch.latestMtimeMs > performance.timeOrigin) {
      return { refused: "a source file was modified after the process started" };
    }
    const opened = readPinnedReplayArtifactFile(file);
    if ("refused" in opened) return { epoch: epoch.digest, refused: opened.refused };
    if (opened.stamp.sourceEpoch !== epoch.digest) return { epoch: epoch.digest, refused: "source epoch differs" };
    const origin = performance.timeOrigin;
    return { epoch: epoch.digest, text: opened.text, stamp: { ...opened.stamp }, verifyEpoch() {
      try {
        const current = computeEngineBodyReplaySourceEpoch(repositoryRoot);
        return current.digest === epoch.digest && current.latestMtimeMs <= origin;
      } catch { return false; }
    } };
  } catch {
    return { refused: "source epoch unavailable" };
  }
}

installEngineBodyHostState({
  memo: process.env["FENEL_SIMULATE_BROWSER"] === "1" ? undefined : {
    isProxy: types.isProxy,
    sha256Encoding(encoding) {
      const hash = crypto.createHash("sha256");
      const chunk = 1 << 20;
      for (let offset = 0; offset < encoding.length; offset += chunk) hash.update(encoding.slice(offset, offset + chunk), "utf16le");
      return hash.digest("hex");
    },
    sha256Bytes: (bytes) => crypto.createHash("sha256").update(bytes).digest("hex"),
    deflateKey: (bytes) => zlib.deflateRawSync(bytes, { level: 1 }),
    inflateKey: (bytes) => zlib.inflateRawSync(bytes),
    now: () => performance.now(),
    buildFingerprint,
    // These existing controls affect only optional caching and eviction.
    // Replay identity, artifact bytes and build fingerprint stay captured.
    memoEnabled: () => process.env["FENEL_ENGINE_BODY_MEMO"] !== "0" && process.env["NODE_ENV"] !== "test",
    memoCapBytes() {
      const raw = process.env["FENEL_ENGINE_BODY_MEMO_MB"];
      const mb = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(mb) && mb >= 0 ? mb * 1024 * 1024 : 160 * 1024 * 1024;
    },
  },
  replay: captureReplay(),
});
