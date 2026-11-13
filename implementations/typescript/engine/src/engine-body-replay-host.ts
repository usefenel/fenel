// S1b host-only file transport. No engine module is evaluated by importing this
// file or reading a pinned artifact: the host preload must bind its source
// epoch and capture the artifact before the engine graph starts. The engine
// never imports this adapter. Its bytes remain in the engine/src epoch universe.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ReplayAcceptance, ReplayArtifact, ReplayArtifactEntry, ReplayArtifactHeader, ReplayArtifactStamp } from "./engine-body-replay";

export type PinnedReplayArtifactText = {
  readonly text: string;
  readonly stamp: ReplayArtifactStamp;
};

/** Read and decompress only after verifying the compressed byte pin. No
 * engine imports; final key-format and live-realm checks stay in the core. */
export function readPinnedReplayArtifactFile(file: string): PinnedReplayArtifactText | { readonly refused: string } {
  let bytes: Uint8Array;
  let stamp: ReplayArtifactStamp;
  try {
    bytes = readFileSync(file);
    const stampText = readFileSync(`${file}.stamp.json`, "utf8");
    try {
      stamp = JSON.parse(stampText) as ReplayArtifactStamp;
    } catch {
      return { refused: "malformed stamp" };
    }
  } catch {
    return { refused: "unreadable artifact or stamp" };
  }
  const hex = /^[0-9a-f]{64}$/;
  if (stamp === null || typeof stamp !== "object" || Array.isArray(stamp)
    || stamp.schema !== "fenel.engine-body-replay.stamp.v1"
    || typeof stamp.artifactSha256 !== "string" || !hex.test(stamp.artifactSha256)
    || typeof stamp.textDigest !== "string" || !hex.test(stamp.textDigest)
    || typeof stamp.sourceEpoch !== "string" || !hex.test(stamp.sourceEpoch)
    || !Number.isSafeInteger(stamp.keyFormat) || stamp.keyFormat < 0) return { refused: "malformed stamp" };
  if (createHash("sha256").update(bytes).digest("hex") !== stamp.artifactSha256) {
    return { refused: "artifact digest differs from its pin" };
  }
  let text: string;
  try {
    text = gunzipSync(bytes).toString("utf8");
  } catch {
    return { refused: "unreadable artifact" };
  }
  const textHash = createHash("sha256");
  const chunkChars = 1 << 20;
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    textHash.update(text.slice(offset, offset + chunkChars), "utf16le");
  }
  if (textHash.digest("hex") !== stamp.textDigest) {
    return { refused: "artifact digest differs from its pin" };
  }
  return Object.freeze({ text, stamp: Object.freeze(stamp) });
}

/** Compatibility for host tests/tools that already loaded the engine. The
 * preload uses readPinnedReplayArtifactFile, which never evaluates this core. */
export function loadReplayArtifactFile(file: string, live: ReplayAcceptance): ReplayArtifact | { readonly refused: string } {
  const captured = readPinnedReplayArtifactFile(file);
  if ("refused" in captured) return captured;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openStampedReplayArtifactText } = require("./engine-body-replay") as typeof import("./engine-body-replay");
  return openStampedReplayArtifactText(captured.text, captured.stamp, live);
}

/** Artifact bytes and their integrity stamp. Recorder-side only; its source
 * epoch is already bound and its engine graph already loaded before writing. */
export function writeReplayArtifact(
  header: Omit<ReplayArtifactHeader, "schema" | "entries" | "keyFormat">,
  entries: readonly ReplayArtifactEntry[],
): { readonly bytes: Uint8Array; readonly stamp: ReplayArtifactStamp } {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { replayArtifactText } = require("./engine-body-replay") as typeof import("./engine-body-replay");
  const { ENGINE_BODY_MEMO_KEY_FORMAT, sha256OfEncoding } = require("./engine-body-memo") as typeof import("./engine-body-memo");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const text = replayArtifactText(header, entries);
  const bytes = gzipSync(Buffer.from(text, "utf8"), { level: 9 });
  return {
    bytes,
    stamp: {
      schema: "fenel.engine-body-replay.stamp.v1",
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
      textDigest: sha256OfEncoding(text),
      sourceEpoch: header.sourceEpoch,
      keyFormat: ENGINE_BODY_MEMO_KEY_FORMAT,
    },
  };
}
